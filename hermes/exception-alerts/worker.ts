/**
 * hermes/exception-alerts: flag only the broken clients, and tell their owner.
 *
 * Runs inside the lead sync watch's cron line (every 15 minutes), and does its work at
 * most once in 55 minutes. No scheduler of its own (plan 5.5, the database gate).
 *
 *   bun hermes/exception-alerts/worker.ts doctor
 *   bun hermes/exception-alerts/worker.ts run [--apply] [--force] [--report <path>]
 *   bun hermes/exception-alerts/worker.ts replay [--days 30] [--out <path>]
 *   bun hermes/exception-alerts/worker.ts status
 *
 * Switches (named env keys, read from the same files as the lead sync watch, plus
 * ~/.exception-alerts/env):
 *   EXCEPTION_ALERTS=off              skip the step entirely
 *   EXCEPTION_ALERTS_DELIVERY=live    send Slack messages; anything else is a dry run that
 *                                     still writes the state and the ledger (status dry)
 *   EXCEPTION_ALERTS_RULES_OFF=a,b    rules switched off (zero_leads, cpb_over_line,
 *                                     campaign_stopped, lead_sync)
 *   EXCEPTION_ALERTS_FALLBACK=C...    channel for the no-owner digest (#tech-general)
 *
 * Unbreakable by design:
 *   - reads only Creative Triage tables other jobs keep fresh; never calls Meta;
 *   - a count it could not read is null and the rule is unknown: no alert, no close;
 *   - two runs (45+ minutes apart) before an alert; one alert per rule, client, episode
 *     and person, claimed in the ledger before the send; 5 a person a day, the rest in
 *     one digest; an unowned alert goes to the fallback digest, never dropped;
 *   - an interrupted send is looked up in Slack history by its reference tag before it
 *     is tried again (internal alerts, at most 3 attempts);
 *   - its health lands in cockpit_sync_state key exception-alerts, which the reliability
 *     monitor reads through cockpit_native_monitor.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { type Client, type Inputs, loadInputs, nameKey } from "./inputs";
import {
  alertText,
  campaignStopped,
  cpbOverLine,
  decide,
  digestText,
  type Finding,
  floors,
  kuwaitDay,
  kuwaitHour,
  LIMITS,
  leadSync,
  NO_PRIOR,
  type Next,
  type Prior,
  RULE_LABEL,
  RULES,
  type Rule,
  addDays,
  zeroLeads,
} from "./rules";

type Row = Record<string, any>;
type Env = Record<string, string | undefined>;

export const REF = "bldgtotkfmhoxmlzowdx";
export const SUPABASE = `https://${REF}.supabase.co`;
export const COCKPIT = "https://cockpit.maharamedia.com";
export const TECH_GENERAL = "C0AS2JLMJCB";
export const HEALTH_KEY = "exception-alerts";
const LOOKBACK = LIMITS.floorDays + 1;

// ------------------------------------------------------------------ I/O

export function makeIo(env: Env, request: typeof fetch = fetch) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const stats = { requests: 0, rows: 0 };
  async function json(url: string, init: RequestInit = {}, tries = 3): Promise<any> {
    let last: unknown;
    for (let i = 0; i < tries; i++) {
      try {
        stats.requests++;
        const res = await request(url, { ...init, signal: AbortSignal.timeout(45_000) });
        const text = await res.text();
        if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`${res.status} ${text.slice(0, 160)}`), { retry: true });
        if (!res.ok) throw Object.assign(new Error(`${res.status} ${text.slice(0, 240)}`), { retry: false });
        return text ? JSON.parse(text) : null;
      } catch (e) {
        last = e;
        if ((e as any)?.retry === false) break;
        await new Promise(r => setTimeout(r, 1500 * (i + 1)));
      }
    }
    throw last;
  }
  const db = {
    async all(table: string, query: string): Promise<Row[]> {
      const out: Row[] = [];
      for (let from = 0; ; from += 1000) {
        const page = await json(`${SUPABASE}/rest/v1/${table}?${query}`, { headers: { ...h, Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
        out.push(...page);
        stats.rows += page.length;
        if (page.length < 1000) return out;
      }
    },
    async upsert(table: string, rows: Row[], onConflict: string) {
      for (let i = 0; i < rows.length; i += 200)
        await json(`${SUPABASE}/rest/v1/${table}?on_conflict=${onConflict}`, {
          method: "POST",
          headers: { ...h, Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(rows.slice(i, i + 200)),
        });
    },
    /** INSERT ... ON CONFLICT DO NOTHING RETURNING: the row when this call claimed it, else null. */
    async claim(table: string, row: Row, onConflict: string): Promise<Row | null> {
      const r = await json(
        `${SUPABASE}/rest/v1/${table}?on_conflict=${onConflict}`,
        { method: "POST", headers: { ...h, Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify([row]) },
        1,
      );
      return Array.isArray(r) && r.length ? r[0] : null;
    },
    async patch(table: string, filter: string, values: Row) {
      await json(`${SUPABASE}/rest/v1/${table}?${filter}`, { method: "PATCH", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify(values) });
    },
  };
  const slack = async (method: string, params: Record<string, unknown>, post = false) => {
    if (!env.SLACK_BOT_TOKEN) throw Object.assign(new Error("SLACK_BOT_TOKEN is missing"), { slackError: "missing_token" });
    const url = `https://slack.com/api/${method}`;
    const r = post
      ? await json(url, { method: "POST", headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(params) }, 1)
      : await json(`${url}?${new URLSearchParams(params as Record<string, string>)}`, { headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` } });
    if (!r?.ok) throw Object.assign(new Error(`slack ${method}: ${r?.error ?? "no response"}`), { slackError: r?.error });
    return r;
  };
  return { db, slack, stats };
}
export type Io = { db: ReturnType<typeof makeIo>["db"]; slack: ReturnType<typeof makeIo>["slack"]; stats?: { requests: number; rows: number } };

// ------------------------------------------------------------------ owners

export type Recipient = { key: string; name: string; email: string | null; channel: string | null; role: "media_buyer" | "csm" | "fallback" };

/**
 * Who owns a client for a rule. There is no media-buyer owner field yet (plan 4.2), so the
 * media buyers are the ones the cockpit allows on the client, the lead sync watch's rule:
 * active members with the media_buyer role who are not admin or CEO, whose client list is
 * empty or names the client. The CSM is the ClickUp "CSM assigned" on the client card,
 * matched to a cockpit member by name. Cost per booking goes to both; spend with no leads
 * and a stopped campaign to the media buyers; the lead sync gap is already posted by the
 * lead sync watch, so it is mirrored, not sent again.
 */
export function ownersFor(rule: Rule, client: Pick<Client, "name" | "csm">, members: Row[]): Recipient[] {
  if (rule === "lead_sync") return [];
  const roles = (m: Row) => (m.roles ?? []) as string[];
  const person = (m: Row, role: Recipient["role"]): Recipient => ({ key: `person:${String(m.email).toLowerCase()}`, name: String(m.name ?? m.email), email: String(m.email).toLowerCase(), channel: null, role });
  const buyers = members
    .filter(m => m.active !== false && roles(m).includes("media_buyer") && !roles(m).includes("admin") && !roles(m).includes("ceo"))
    .filter(m => !(m.clients ?? []).length || (m.clients ?? []).some((c: string) => nameKey(c) === nameKey(client.name)))
    .map(m => person(m, "media_buyer"));
  if (rule !== "cpb_over_line") return buyers;
  const csm = client.csm ? members.find(m => m.active !== false && roles(m).includes("csm") && nameKey(m.name) === nameKey(client.csm)) : undefined;
  return csm && !buyers.some(b => b.key === `person:${String(csm.email).toLowerCase()}`) ? [...buyers, person(csm, "csm")] : buyers;
}

export const fallbackOf = (env: Env): Recipient => {
  const ch = env.EXCEPTION_ALERTS_FALLBACK || TECH_GENERAL;
  return { key: `channel:${ch}`, name: ch === TECH_GENERAL ? "#tech-general" : ch, email: null, channel: ch, role: "fallback" };
};

export function linkFor(r: Recipient, client: Pick<Client, "name" | "clickupId">): string {
  if (r.role === "csm" && client.clickupId) return `${COCKPIT}/client-success/clients/${encodeURIComponent(client.clickupId)}?tab=ads`;
  return `${COCKPIT}/ads?account=${encodeURIComponent(client.name)}`;
}

// ------------------------------------------------------------------ the rules over one run

export type Verdict = { rule: Rule; client: Client; finding: Finding; prior: Prior; next: Next };

export function judge(inputs: Inputs, priors: Map<string, Row>, nowMs: number, rulesOff: Set<Rule>): Verdict[] {
  const out: Verdict[] = [];
  const through = addDays(inputs.today, -1);
  const from = addDays(through, -(LIMITS.floorDays - 1));
  for (const c of inputs.clients) {
    const fl = floors(c.days, c.targets, from, through);
    for (const rule of RULES) {
      if (rulesOff.has(rule)) continue;
      const finding: Finding =
        rule === "zero_leads"
          ? zeroLeads({ days: c.days, campaigns: c.campaigns, floors: fl, today: inputs.today, nowMs })
          : rule === "cpb_over_line"
            ? cpbOverLine({ days: c.days, floors: fl, targets: c.targets, serviceMode: c.serviceMode, today: inputs.today })
            : rule === "campaign_stopped"
              ? campaignStopped({ campaigns: c.campaigns, accounts: c.accountFacts, budgetsFetchedAt: c.budgetsFetchedAt, today: inputs.today, nowMs })
              : leadSync(inputs.leadSync.get(c.key) as any, c.campaigns.some(k => (k.lastSpendDay ?? "") >= addDays(inputs.today, -LIMITS.recentSpendDays)));
      if (rule === "zero_leads" || rule === "cpb_over_line") finding.evidence.floors = fl;
      const p = priors.get(`${rule}|${c.key}`);
      const prior: Prior = p
        ? { state: p.state, strikes: p.strikes ?? 0, clears: p.clears ?? 0, episodeId: p.episode_id ?? null, firstSeenAt: p.first_seen_at ?? null, openedAt: p.opened_at ?? null, lastStrikeAt: p.last_strike_at ?? null }
        : NO_PRIOR;
      const episode = rule === "lead_sync" && finding.state === "hit" ? `lead_sync:${c.key}:${String(finding.evidence.episode)}` : undefined;
      out.push({ rule, client: c, finding, prior, next: decide(rule, c.key, prior, finding, nowMs, episode) });
    }
  }
  return out;
}

// ------------------------------------------------------------------ the ledger and Slack

type Send = { rule: Rule | "digest"; client: string; to: string; status: string; error?: string };

const SENT_LIKE = new Set(["sending", "sent", "unknown", "dry"]);

/** The person's alerts today that count against the 5 (digest items and failures do not). */
export const countToday = (ledger: Row[], recipient: string, day: string) =>
  ledger.filter(r => r.recipient === recipient && r.alert_day === day && r.kind === "alert" && SENT_LIKE.has(r.status)).length;

async function slackIdFor(io: Io, r: Recipient, cache: Map<string, string | null>): Promise<string | null> {
  if (r.channel) return r.channel;
  if (!r.email) return null;
  if (!cache.has(r.email)) {
    try {
      cache.set(r.email, (await io.slack("users.lookupByEmail", { email: r.email })).user?.id ?? null);
    } catch (e) {
      // Only "no such user" means the person has no Slack account; a dead token or a
      // network fault is reported as itself.
      if ((e as any)?.slackError !== "users_not_found") throw e;
      cache.set(r.email, null);
    }
  }
  return cache.get(r.email) ?? null;
}

/** Look for the reference tag in the conversation before anything is posted again. */
async function findInHistory(io: Io, channel: string | null, ref: string): Promise<string | null> {
  if (!channel) return null;
  const oldest = String(Math.floor((Date.now() - 3 * 86_400_000) / 1000));
  const r = await io.slack("conversations.history", { channel, oldest, limit: "200" });
  return (r.messages ?? []).find((m: Row) => String(m.text ?? "").includes(ref))?.ts ?? null;
}

/**
 * Post one claimed ledger row. A definite Slack refusal is failed (tried again next run,
 * at most 3 attempts); a timeout or network fault is unknown and is looked up in history
 * first.
 */
export async function post(io: Io, row: Row, r: Recipient, ids: Map<string, string | null>): Promise<{ status: string; error?: string }> {
  const ref = `exa:${row.id}`;
  try {
    let channel = row.channel ?? null;
    if (!channel) {
      const id = await slackIdFor(io, r, ids);
      if (!id) throw Object.assign(new Error(`No Slack account found for ${r.email ?? r.name}`), { slackError: "users_not_found" });
      channel = r.channel ? id : (await io.slack("conversations.open", { users: id }, true)).channel?.id;
      if (!channel) throw Object.assign(new Error("conversations.open returned no channel"), { slackError: "no_channel" });
      await io.db.patch("cockpit_exception_alerts", `id=eq.${row.id}`, { channel });
    }
    const res = await io.slack("chat.postMessage", { channel, text: `${row.body}\n_ref ${ref}_`, unfurl_links: false }, true);
    await io.db.patch("cockpit_exception_alerts", `id=eq.${row.id}`, { status: "sent", slack_ts: res.ts, sent_at: new Date().toISOString(), error: null });
    return { status: "sent" };
  } catch (e) {
    const err = String((e as Error)?.message ?? e).slice(0, 300);
    const definite = Boolean((e as any)?.slackError) && (e as any).slackError !== "ratelimited";
    const status = definite ? "failed" : "unknown";
    await io.db.patch("cockpit_exception_alerts", `id=eq.${row.id}`, { status, error: err });
    return { status, error: err };
  }
}

/** Retry or reconcile a row an earlier run left behind. */
async function resume(io: Io, row: Row, r: Recipient, ids: Map<string, string | null>): Promise<{ status: string; error?: string } | null> {
  if (row.status === "failed" && (row.attempts ?? 0) < LIMITS.maxAttempts) {
    await io.db.patch("cockpit_exception_alerts", `id=eq.${row.id}`, { status: "sending", attempts: (row.attempts ?? 0) + 1 });
    return post(io, { ...row, status: "sending" }, r, ids);
  }
  if (row.status === "sending" || row.status === "unknown") {
    let found: string | null = null;
    try {
      found = await findInHistory(io, row.channel, `exa:${row.id}`);
    } catch {
      return { status: "unknown", error: "Slack history could not be read" };
    }
    if (found) {
      await io.db.patch("cockpit_exception_alerts", `id=eq.${row.id}`, { status: "sent", slack_ts: found, sent_at: new Date().toISOString(), error: null });
      return { status: "sent" };
    }
    if ((row.attempts ?? 0) < LIMITS.maxAttempts) {
      await io.db.patch("cockpit_exception_alerts", `id=eq.${row.id}`, { status: "sending", attempts: (row.attempts ?? 0) + 1 });
      return post(io, { ...row, status: "sending" }, r, ids);
    }
    await io.db.patch("cockpit_exception_alerts", `id=eq.${row.id}`, { status: "unknown", error: "Not found in Slack history after 3 attempts; check the conversation, then set the row to sent or failed" });
    return { status: "unknown" };
  }
  return null;
}

const ledgerKey = (r: Row) => `${r.rule}|${r.client_key}|${r.episode_id}|${r.recipient}|${r.kind}`;

export async function deliver(
  io: Io,
  verdicts: Verdict[],
  x: { members: Row[]; ledger: Row[]; leadSyncAlerts: Map<string, Row>; live: boolean; fallback: Recipient; today: string; nowMs: number },
): Promise<{ sends: Send[]; delivery: Map<string, Row[]> }> {
  const sends: Send[] = [];
  const ids = new Map<string, string | null>();
  const byKey = new Map(x.ledger.map(r => [ledgerKey(r), r]));
  const delivery = new Map<string, Row[]>();
  const note = (v: Verdict, to: string, status: string, at: string | null) => {
    const k = `${v.rule}|${v.client.key}`;
    if (!delivery.has(k)) delivery.set(k, []);
    delivery.get(k)!.push({ to, status, at });
  };
  for (const v of verdicts) {
    if (v.next.state !== "open" || !v.next.episodeId) continue;
    const episode = v.next.episodeId;
    if (v.rule === "lead_sync") {
      const ls = x.leadSyncAlerts.get(String(v.finding.evidence.episode));
      if (!ls) continue;
      const k = `lead_sync|${v.client.key}|${episode}|channel:${TECH_GENERAL}|mirror`;
      const have = byKey.get(k);
      if (!have)
        await io.db.claim(
          "cockpit_exception_alerts",
          {
            rule: "lead_sync",
            client_key: v.client.key,
            client_name: v.client.name,
            episode_id: episode,
            recipient: `channel:${TECH_GENERAL}`,
            recipient_name: "#tech-general (lead sync watch)",
            kind: "mirror",
            status: ls.status,
            alert_day: kuwaitDay(Date.parse(ls.created_at)),
            channel: ls.channel ?? TECH_GENERAL,
            slack_ts: ls.slack_ts ?? null,
            body: "Posted by the lead sync watch (cockpit_lead_sync_alerts).",
            sent_at: ls.status === "sent" ? ls.created_at : null,
          },
          "rule,client_key,episode_id,recipient,kind",
        );
      else if (have.status !== ls.status) await io.db.patch("cockpit_exception_alerts", `id=eq.${have.id}`, { status: ls.status, slack_ts: ls.slack_ts ?? null });
      note(v, "#tech-general", ls.status, ls.created_at);
      continue;
    }
    const owners = ownersFor(v.rule, v.client, x.members);
    for (const r of owners.length ? owners : [x.fallback]) {
      const k = `${v.rule}|${v.client.key}|${episode}|${r.key}|alert`;
      let row = byKey.get(k);
      if (!row) {
        const queued = r.role === "fallback" || countToday([...byKey.values()], r.key, x.today) >= LIMITS.perPersonPerDay;
        const status = queued ? "queued" : x.live ? "sending" : "dry";
        const claimed = await io.db.claim(
          "cockpit_exception_alerts",
          {
            rule: v.rule,
            client_key: v.client.key,
            client_name: v.client.name,
            episode_id: episode,
            recipient: r.key,
            recipient_name: r.name,
            kind: "alert",
            status,
            alert_day: x.today,
            body: alertText({ rule: v.rule, client: v.client.name, reason: v.finding.reason, link: linkFor(r, v.client), ref: "" }).replace(/\n_ref _$/, ""),
            attempts: 1,
          },
          "rule,client_key,episode_id,recipient,kind",
        );
        if (!claimed) continue; // another run claimed it first; never two
        row = claimed;
        byKey.set(k, row);
        if (status === "sending") {
          const res = await post(io, row, r, ids);
          row.status = res.status;
          sends.push({ rule: v.rule, client: v.client.name, to: r.name, status: res.status, error: res.error });
        } else sends.push({ rule: v.rule, client: v.client.name, to: r.name, status });
      } else if (x.live) {
        const res = await resume(io, row, r, ids);
        if (res) {
          row.status = res.status;
          sends.push({ rule: v.rule, client: v.client.name, to: r.name, status: res.status, error: res.error });
        }
      }
      note(v, r.name, row.status, row.sent_at ?? row.created_at ?? null);
    }
  }
  return { sends, delivery };
}

/** One digest per person (and one for the no-owner channel) per day, from 16:00 Kuwait. */
export async function digests(
  io: Io,
  x: { ledger: Row[]; members: Row[]; live: boolean; liveSince?: string; fallback: Recipient; today: string; nowMs: number; force: boolean },
): Promise<Send[]> {
  if (!x.force && kuwaitHour(x.nowMs) < LIMITS.digestHourKuwait) return [];
  const out: Send[] = [];
  const ids = new Map<string, string | null>();
  // Rows queued while delivery was a dry run are never sent live (no backlog flood):
  // EXCEPTION_ALERTS_LIVE_SINCE is the go-live time.
  const liveSince = x.liveSince ? Date.parse(x.liveSince) : NaN;
  const queued: Row[] = [];
  for (const r of x.ledger.filter(l => l.kind === "alert" && l.status === "queued")) {
    if (x.live && Number.isFinite(liveSince) && Date.parse(r.created_at) < liveSince) await io.db.patch("cockpit_exception_alerts", `id=eq.${r.id}`, { status: "dry", error: "Queued during the dry run; not sent live" });
    else queued.push(r);
  }
  const recipients = [...new Set(queued.map(r => r.recipient))];
  for (const key of recipients) {
    const items = queued.filter(r => r.recipient === key);
    const m = key.startsWith("person:") ? x.members.find(p => `person:${String(p.email).toLowerCase()}` === key) : null;
    const r: Recipient = key.startsWith("channel:")
      ? { ...x.fallback, key, channel: key.slice(8) }
      : { key, name: String(m?.name ?? key.slice(7)), email: key.slice(7), channel: null, role: "media_buyer" };
    const existing = x.ledger.find(d => d.kind === "digest" && d.recipient === key && d.episode_id === x.today);
    if (existing && existing.status !== "failed") continue; // today's digest went; the rest wait for tomorrow's
    const body = digestText({
      day: x.today,
      unowned: key.startsWith("channel:"),
      ref: "",
      items: items.map(i => ({ rule: i.rule, client: i.client_name, reason: String(i.body).split("\n")[1] ?? "", link: (/<([^|>]+)\|/.exec(String(i.body)) ?? [])[1] ?? COCKPIT })),
    }).replace(/\n_ref _$/, "");
    const row =
      existing ??
      (await io.db.claim(
        "cockpit_exception_alerts",
        { rule: "digest", client_key: "*", client_name: "*", episode_id: x.today, recipient: key, recipient_name: r.name, kind: "digest", status: x.live ? "sending" : "dry", alert_day: x.today, body, attempts: 1 },
        "rule,client_key,episode_id,recipient,kind",
      ));
    if (!row) continue;
    let status = row.status;
    if (x.live) status = (existing ? await resume(io, row, r, ids) : await post(io, row, r, ids))?.status ?? status;
    if (status === "sent" || status === "dry")
      for (const i of items) await io.db.patch("cockpit_exception_alerts", `id=eq.${i.id}`, { status, digest_id: row.id, sent_at: status === "sent" ? new Date().toISOString() : null });
    out.push({ rule: "digest", client: `${items.length} alerts`, to: r.name, status });
  }
  return out;
}

// ------------------------------------------------------------------ run

export type RunResult = { ok: boolean; skipped?: string; note: string; verdicts: Row[]; sends: Send[]; requests?: number; rows?: number };

const STATE_FIELDS = ["state", "reason", "strikes", "clears", "episode_id", "first_seen_at", "opened_at", "last_strike_at", "link", "client_name", "clickup_id"];
const same = (a: Row | undefined, b: Row) =>
  !!a && STATE_FIELDS.every(f => String(a[f] ?? "") === String(b[f] ?? "")) && JSON.stringify(a.evidence ?? {}) === JSON.stringify(b.evidence) && JSON.stringify(a.delivery ?? []) === JSON.stringify(b.delivery);

export async function runExceptions(io: Io, env: Env, opts: { apply: boolean; force?: boolean; nowMs?: number }): Promise<RunResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  if (env.EXCEPTION_ALERTS === "off") return { ok: true, skipped: "EXCEPTION_ALERTS=off", note: "Switched off.", verdicts: [], sends: [] };
  const health = (await io.db.all("cockpit_sync_state", `select=key,last_run_at,ok&key=eq.${HEALTH_KEY}`))[0];
  if (!opts.force && health?.last_run_at && nowMs - Date.parse(health.last_run_at) < LIMITS.runEveryMin * 60_000)
    return { ok: true, skipped: "not due", note: `Last run ${health.last_run_at}; runs at most once in ${LIMITS.runEveryMin} minutes.`, verdicts: [], sends: [] };

  const live = env.EXCEPTION_ALERTS_DELIVERY === "live";
  const rulesOff = new Set(
    String(env.EXCEPTION_ALERTS_RULES_OFF ?? "")
      .split(",")
      .map(s => s.trim())
      .filter((s): s is Rule => (RULES as string[]).includes(s)),
  );
  const fallback = fallbackOf(env);
  const inputs = await loadInputs(io.db, nowMs, LOOKBACK);
  // A read-only run before the migration is applied treats the new tables as empty.
  const before = (e: unknown) => {
    if (opts.apply) throw e;
    return [] as Row[];
  };
  const priors = new Map((await io.db.all("cockpit_exception_state", "select=*").catch(before)).map(r => [`${r.rule}|${r.client_key}`, r]));
  const verdicts = judge(inputs, priors, nowMs, rulesOff);
  const ledger = await io.db.all(
    "cockpit_exception_alerts",
    `select=id,rule,client_key,client_name,episode_id,recipient,kind,status,attempts,alert_day,channel,slack_ts,body,created_at,sent_at&or=(alert_day.gte.${addDays(inputs.today, -1)},status.in.(sending,unknown,failed,queued))`,
  ).catch(before);

  let sends: Send[] = [];
  let delivery = new Map<string, Row[]>();
  if (opts.apply) {
    ({ sends, delivery } = await deliver(io, verdicts, { members: inputs.members, ledger, leadSyncAlerts: inputs.leadSyncAlerts, live, fallback, today: inputs.today, nowMs }));
    const fresh = await io.db.all(
      "cockpit_exception_alerts",
      `select=id,rule,client_key,client_name,episode_id,recipient,kind,status,attempts,alert_day,channel,slack_ts,body,created_at,sent_at&or=(alert_day.gte.${addDays(inputs.today, -1)},status.in.(sending,unknown,failed,queued))`,
    );
    sends.push(
      ...(await digests(io, {
        ledger: fresh,
        members: inputs.members,
        live,
        liveSince: env.EXCEPTION_ALERTS_LIVE_SINCE,
        fallback,
        today: inputs.today,
        nowMs,
        force: Boolean(opts.force && env.EXCEPTION_ALERTS_DIGEST_NOW === "1"),
      })),
    );
  }

  const rows = verdicts.map(v => ({
    rule: v.rule,
    client_key: v.client.key,
    client_name: v.client.name,
    clickup_id: v.client.clickupId,
    state: v.next.state,
    reason: v.finding.reason.slice(0, 600),
    evidence: v.finding.evidence,
    strikes: v.next.strikes,
    clears: v.next.clears,
    episode_id: v.next.episodeId,
    first_seen_at: v.next.firstSeenAt,
    opened_at: v.next.openedAt,
    last_strike_at: v.next.lastStrikeAt,
    link: `${COCKPIT}/ads?account=${encodeURIComponent(v.client.name)}`,
    delivery: v.next.state === "open" ? (delivery.get(`${v.rule}|${v.client.key}`) ?? priors.get(`${v.rule}|${v.client.key}`)?.delivery ?? []) : [],
    checked_at: nowIso,
    updated_at: nowIso,
  }));
  const changed = rows.filter(r => !same(priors.get(`${r.rule}|${r.client_key}`), r));

  const count = (s: string) => rows.filter(r => r.state === s).length;
  const bad = sends.filter(s => s.status === "failed" || s.status === "unknown");
  const stuck = ledger.filter(r => r.kind !== "mirror" && (r.status === "failed" || r.status === "unknown") && nowMs - Date.parse(r.created_at) < 86_400_000);
  const open = rows.filter(r => r.state === "open");
  const note =
    `${inputs.clients.length} clients: ${open.length} open (${RULES.map(rule => [RULE_LABEL[rule].toLowerCase(), open.filter(o => o.rule === rule).length] as const).filter(([, n]) => n).map(([l, n]) => `${n} ${l}`).join(", ") || "none"}), ` +
    `${count("watch")} waiting for a second run, ${count("too_little_data")} too little data, ${count("unknown")} unknown. ` +
    `Delivery ${live ? "live" : "dry run"}: ${sends.length ? sends.map(s => `${s.client} ${s.rule} to ${s.to} ${s.status}`).join("; ") : "nothing new"}.` +
    (bad.length || stuck.length ? ` ${new Set([...bad.map(b => `${b.client}|${b.to}`), ...stuck.map(s => s.id)]).size} sends failed or unknown.` : "");

  if (opts.apply) {
    if (changed.length) await io.db.upsert("cockpit_exception_state", changed, "rule,client_key");
    const ok = !bad.length && !stuck.length;
    const row: Row = {
      key: HEALTH_KEY,
      last_run_at: nowIso,
      ok,
      note: note.slice(0, 500),
      rows_seen: rows.length,
      detail: {
        delivery: live ? "live" : "dry",
        open: open.map(o => ({ rule: o.rule, client: o.client_name, since: o.opened_at })),
        tooLittleData: rows.filter(r => r.state === "too_little_data").map(r => ({ rule: r.rule, client: r.client_name, why: r.reason })),
        unknown: rows.filter(r => r.state === "unknown").map(r => ({ rule: r.rule, client: r.client_name, why: r.reason })),
        sends,
        failed: [...bad, ...stuck.map(s => ({ id: s.id, client: s.client_name, to: s.recipient_name, status: s.status }))],
        rulesOff: [...rulesOff],
        written: changed.length,
        reads: io.stats ? { requests: io.stats.requests, rows: io.stats.rows } : undefined,
      },
      updated_at: nowIso,
    };
    if (ok) row.last_ok_at = nowIso;
    await io.db.upsert("cockpit_sync_state", [row], "key");
  }
  return { ok: !bad.length && !stuck.length, note, verdicts: rows, sends, requests: io.stats?.requests, rows: io.stats?.rows };
}

/** Record a failed run where the monitor looks; never throws. */
export async function recordFailure(io: Io, e: unknown) {
  try {
    const now = new Date().toISOString();
    await io.db.upsert("cockpit_sync_state", [{ key: HEALTH_KEY, last_run_at: now, ok: false, note: `Run failed: ${String((e as Error)?.message ?? e).slice(0, 400)}`, updated_at: now }], "key");
  } catch {}
}

// ------------------------------------------------------------------ doctor and CLI

export function readEnv(): Env {
  const env: Env = { ...process.env };
  const files = [...(process.env.LEAD_SYNC_ENV_FILES ?? "").split(":"), ...(process.env.EXCEPTION_ALERTS_ENV_FILES ?? "").split(":")].filter(Boolean);
  for (const f of files) {
    try {
      const text = readFileSync(f, "utf8");
      if (f.endsWith(".json")) {
        const j = JSON.parse(text);
        for (const [k, v] of Object.entries(j.env ?? j)) if (env[k] === undefined && typeof v === "string") env[k] = v;
      } else
        for (const line of text.split("\n")) {
          const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
          if (m && env[m[1]] === undefined) env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
        }
    } catch {}
  }
  return env;
}

export async function doctor(env: Env) {
  const checks: Row = {};
  for (const k of ["SUPABASE_SERVICE_ROLE_KEY", "SLACK_BOT_TOKEN"]) checks[`key ${k}`] = env[k] ? "set" : "missing";
  checks.delivery = env.EXCEPTION_ALERTS_DELIVERY === "live" ? "live" : "dry run";
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, checks };
  const io = makeIo(env);
  const probe = async (k: string, f: () => Promise<unknown>) => {
    try {
      const v = await f();
      checks[k] = v ?? "ok";
    } catch (e) {
      checks[k] = `FAIL ${String((e as Error)?.message ?? e).slice(0, 160)}`;
    }
  };
  await probe("tables", async () => {
    await io.db.all("cockpit_exception_state", "select=rule&limit=1");
    await io.db.all("cockpit_exception_alerts", "select=id&limit=1");
  });
  let inputs: Inputs | null = null;
  await probe("inputs", async () => {
    inputs = await loadInputs(io.db, Date.now(), LOOKBACK);
    return `${inputs.clients.length} active clients, ${inputs.clients.filter(c => c.days.at(-2)?.spend !== null).length} with yesterday's spend read`;
  });
  if (env.SLACK_BOT_TOKEN) {
    await probe("slack bot", async () => {
      const res = await fetch("https://slack.com/api/auth.test", { headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` } });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error);
      const scopes = String(res.headers.get("x-oauth-scopes") ?? "").split(",");
      const need = ["chat:write", "im:write", "users:read.email", "channels:history", "im:history"];
      const lacking = need.filter(s => !scopes.includes(s));
      return `${body.user} (${body.user_id}); ${lacking.length ? `missing scopes: ${lacking.join(", ")}` : "all scopes present"}`;
    });
    await probe("fallback channel", async () => {
      const ch = fallbackOf(env).channel!;
      const c = await io.slack("conversations.info", { channel: ch });
      if (!c.channel?.is_member) throw new Error(`bot is not a member of ${ch}`);
    });
    if (inputs) {
      const ids = new Map<string, string | null>();
      const people = new Map<string, Recipient>();
      for (const c of (inputs as Inputs).clients) for (const rule of RULES) for (const r of ownersFor(rule, c, (inputs as Inputs).members)) people.set(r.key, r);
      for (const r of people.values()) await probe(`owner ${r.name} (${r.role})`, async () => ((await slackIdFor(io, r, ids)) ? "Slack account found" : "FAIL no Slack account for this email"));
    }
  }
  return { ok: Object.values(checks).every(v => !String(v).startsWith("FAIL") && v !== "missing"), checks };
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

if (import.meta.main) {
  const env = readEnv();
  const cmd = process.argv[2] ?? "run";
  try {
    if (cmd === "doctor") {
      const r = await doctor(env);
      console.log(JSON.stringify(r, null, 1));
      process.exit(r.ok ? 0 : 1);
    }
    if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing named key: SUPABASE_SERVICE_ROLE_KEY");
    const io = makeIo(env);
    if (cmd === "status") {
      for (const r of await io.db.all("cockpit_exception_state", "select=rule,client_name,state,reason&state=neq.ok&order=state,rule,client_name"))
        console.log(`${r.state.padEnd(15)} ${r.rule.padEnd(17)} ${String(r.client_name).slice(0, 30).padEnd(30)} ${r.reason}`);
      process.exit(0);
    }
    if (cmd === "replay") {
      const { replay, replayMarkdown } = await import("./replay");
      const rep = await replay(io.db, { days: Number(arg("--days") ?? 30), nowMs: Date.now() });
      const out = arg("--out");
      if (out) writeFileSync(out, replayMarkdown(rep));
      if (arg("--json")) writeFileSync(arg("--json")!, JSON.stringify(rep, null, 1));
      console.log(replayMarkdown(rep));
      process.exit(0);
    }
    const r = await runExceptions(io, env, { apply: process.argv.includes("--apply"), force: process.argv.includes("--force") });
    const rep = arg("--report");
    if (rep) writeFileSync(rep, JSON.stringify(r, null, 1));
    console.log(`[${new Date().toISOString()}] exception-alerts ${r.skipped ? `skipped (${r.skipped})` : r.ok ? "ok" : "FAILED"}: ${r.note}`);
    process.exit(r.ok ? 0 : 2);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] exception-alerts FAILED: ${String((e as Error)?.stack ?? e).slice(0, 600)}`);
    // Only a writing run records its failure: a read-only run never touches the health row.
    if (process.argv.includes("--apply") && env.SUPABASE_SERVICE_ROLE_KEY) await recordFailure(makeIo(env), e);
    process.exit(1);
  }
}
