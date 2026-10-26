/**
 * hermes/lead-sync-watch: are Facebook leads reaching the CRM?
 *
 * For each client: Meta's lead count (from the Graph API, hourly, in the ad
 * account's own time zone, summed over every ad account of the client) against
 * the leads that reached its GoHighLevel sub-account (public.client_leads, kept
 * fresh by the existing GHL lead sync) over the same rolling 24h and 6h
 * windows. A confirmed gap posts once to #tech-general tagging the systems manager,
 * and a "fixed" reply goes in the same thread when the counts match again.
 *
 *   bun hermes/lead-sync-watch/worker.ts doctor
 *   bun hermes/lead-sync-watch/worker.ts run [--apply] [--report <path>]
 *   bun hermes/lead-sync-watch/worker.ts status
 *
 * Unbreakable by design:
 *   - read-only to Meta and GoHighLevel's copy; its own cron line, lock and
 *     tables; never touches the native media feed;
 *   - an account Meta refuses, or a stale CRM copy, makes that client
 *     "unknown" and keeps its episode as it was: missing is never zero and it
 *     never alerts or resolves on missing data;
 *   - a gap must be seen on 2 runs before it alerts and must clear on 3 before
 *     it resolves;
 *   - every Slack post is a ledger row written before the send; a crash
 *     mid-send is reconciled against Slack history, never blindly resent;
 *   - the run's health lands in cockpit_sync_state, which the guardian reads.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { alertText, bucketHour, decide, leadsOf, type Prior, RULES, resolvedText, zonedDay, zonedHourToUtc } from "./rules";

type Row = Record<string, any>;
type Env = Record<string, string | undefined>;

export const REF = "bldgtotkfmhoxmlzowdx";
export const SUPABASE = `https://${REF}.supabase.co`;
export const TECH_GENERAL = "C0AS2JLMJCB";
export const COCKPIT = "https://cockpit.maharamedia.com";
const HEALTH_KEY = "lead-sync-watch";
const HOUR = 3_600_000;
const REQUIRED = ["SUPABASE_SERVICE_ROLE_KEY", "META_SYSTEM_TOKEN", "SLACK_BOT_TOKEN"];

export function readEnv(): Env {
  const env: Env = { ...process.env };
  for (const f of (process.env.LEAD_SYNC_ENV_FILES ?? "").split(":").filter(Boolean)) {
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

// ------------------------------------------------------------------ I/O

export function makeIo(env: Env, request: typeof fetch = fetch) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  let metaCalls = 0;
  async function json(url: string, init: RequestInit = {}, tries = 3): Promise<any> {
    let last: unknown;
    for (let i = 0; i < tries; i++) {
      try {
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
    async insert(table: string, row: Row): Promise<Row> {
      const r = await json(`${SUPABASE}/rest/v1/${table}`, { method: "POST", headers: { ...h, Prefer: "return=representation" }, body: JSON.stringify(row) }, 1);
      return r[0];
    },
    async patch(table: string, filter: string, values: Row) {
      await json(`${SUPABASE}/rest/v1/${table}?${filter}`, { method: "PATCH", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify(values) });
    },
  };
  const meta = async (path: string, params: Record<string, string>) => {
    if (++metaCalls > 400) throw new Error("Meta request budget for one run (400) reached");
    return json(`https://graph.facebook.com/v21.0/${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${env.META_SYSTEM_TOKEN}` } });
  };
  const slack = async (method: string, params: Record<string, string>, post = false) => {
    const url = `https://slack.com/api/${method}`;
    const r = post
      ? await json(url, { method: "POST", headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(params) }, 1)
      : await json(`${url}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${env.SLACK_BOT_TOKEN}` } });
    if (!r?.ok) throw Object.assign(new Error(`slack ${method}: ${r?.error ?? "no response"}`), { slackError: r?.error });
    return r;
  };
  /** Follow a Meta paging.next URL as given (same host, same token header). */
  const metaNext = async (next: string) => {
    if (!next.startsWith("https://graph.facebook.com/")) throw new Error("Meta paging pointed off graph.facebook.com");
    if (++metaCalls > 400) throw new Error("Meta request budget for one run (400) reached");
    const u = new URL(next);
    u.searchParams.delete("access_token");
    return json(u.toString(), { headers: { Authorization: `Bearer ${env.META_SYSTEM_TOKEN}` } });
  };
  return { db, meta, metaNext, slack };
}
type Io = ReturnType<typeof makeIo>;

// ------------------------------------------------------------------ roster

export type Client = { key: string; name: string; locationId: string | null; accounts: string[]; matchedBy: string };

/**
 * One entry per client. The board's campaign list (cockpit_campaigns) names
 * the live client and its ad account; the CRM link comes from the account map
 * (ghl_client_ad_accounts, clients.ghl_location_id), else from the CRM client
 * list's display name. Accounts with the same sub-account are one client.
 */
export async function loadRoster(io: Io): Promise<Client[]> {
  const camp = await io.db.all("cockpit_campaigns", "select=client_name,meta_account_id&source_deleted=is.false&meta_account_id=not.is.null");
  const clients = await io.db.all("clients", "select=id,name,meta_ad_account_id,ghl_location_id,is_active");
  const map = await io.db.all("ghl_client_ad_accounts", "select=location_id,client_id");
  const ghl = await io.db.all("ghl_clients", "select=location_id,client_name,status");
  const acct = (x: unknown) => String(x ?? "").replace(/^act_/, "").trim();
  const byAccount = new Map<string, Row>();
  for (const c of clients) if (c.meta_ad_account_id) byAccount.set(acct(c.meta_ad_account_id), c);
  const locByClientId = new Map<string, string>();
  for (const m of map) if (m.client_id && m.location_id) locByClientId.set(String(m.client_id), String(m.location_id));
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const ghlByName = new Map<string, string>();
  for (const g of ghl) if (g.client_name && g.status !== "Cancelled") ghlByName.set(norm(String(g.client_name)), String(g.location_id));

  const out = new Map<string, Client>();
  for (const c of camp) {
    const id = acct(c.meta_account_id);
    if (!/^\d{6,}$/.test(id)) continue;
    const name = String(c.client_name ?? "").trim() || `act_${id}`;
    const row = byAccount.get(id);
    let loc: string | null = row?.ghl_location_id ?? (row ? locByClientId.get(String(row.id)) ?? null : null);
    let how = row?.ghl_location_id ? "clients.ghl_location_id" : loc ? "ghl_client_ad_accounts" : "";
    if (!loc && ghlByName.has(norm(name))) {
      loc = ghlByName.get(norm(name))!;
      how = "ghl_clients name";
    }
    const key = loc ?? `act_${id}`;
    const prev = out.get(key);
    if (prev) {
      if (!prev.accounts.includes(id)) prev.accounts.push(id);
    } else out.set(key, { key, name, locationId: loc, accounts: [id], matchedBy: how || "none" });
  }
  if (out.size < 5) throw new Error(`Roster has only ${out.size} clients; refusing to judge against it`);
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ------------------------------------------------------------------ Meta

type MetaRead = { ok: boolean; error?: string; tz?: string; hours: { at: number; leads: number }[]; days: Map<string, number> };

/** Hourly leads for the last ~2 days in the account's own time zone, plus 7 daily totals. */
export async function readMeta(io: Io, accountId: string, nowMs: number): Promise<MetaRead> {
  try {
    const info = await io.meta(`act_${accountId}`, { fields: "timezone_name,account_status" });
    const tz = String(info?.timezone_name || "UTC");
    const since = zonedDay(nowMs - 30 * HOUR, tz);
    const until = zonedDay(nowMs, tz);
    const hours: { at: number; leads: number }[] = [];
    let page = await io.meta(`act_${accountId}/insights`, {
      level: "account",
      time_range: JSON.stringify({ since, until }),
      time_increment: "1",
      breakdowns: "hourly_stats_aggregated_by_advertiser_time_zone",
      fields: "actions,date_start",
      limit: "500",
    });
    for (let n = 0; n < 10; n++) {
      if (!Array.isArray(page?.data)) throw new Error("Meta returned no insights list");
      for (const r of page.data) {
        const hr = bucketHour(r.hourly_stats_aggregated_by_advertiser_time_zone);
        if (hr === null || !r.date_start) continue;
        hours.push({ at: zonedHourToUtc(String(r.date_start), hr, tz), leads: leadsOf(r.actions) });
      }
      const next = page?.paging?.next;
      if (!next) break;
      page = await io.metaNext(String(next));
    }
    const days = new Map<string, number>();
    const d = await io.meta(`act_${accountId}/insights`, {
      level: "account",
      time_range: JSON.stringify({ since: zonedDay(nowMs - 7 * 24 * HOUR, tz), until }),
      time_increment: "1",
      fields: "actions,date_start",
      limit: "50",
    });
    for (const r of d?.data ?? []) days.set(String(r.date_start), leadsOf(r.actions));
    return { ok: true, tz, hours, days };
  } catch (e) {
    return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200), hours: [], days: new Map() };
  }
}

/**
 * Meta's hourly rows are whole hours, so a rolling window is counted on hour
 * boundaries: the last `h` full hours up to the end of the current hour. The
 * CRM side uses the exact same [start, end) so both count the same span.
 */
export function window(nowMs: number, h: number) {
  const end = Math.floor(nowMs / HOUR) * HOUR + HOUR;
  return { start: end - h * HOUR, end };
}
export const sumHours = (hours: { at: number; leads: number }[], w: { start: number; end: number }) =>
  hours.filter(x => x.at >= w.start && x.at < w.end).reduce((s, x) => s + x.leads, 0);

// ------------------------------------------------------------------ Slack

/** The roster role that owns lead-connection alerts (Aziz, 2026-10-26: the systems manager, not the media buyer). */
export const ALERT_OWNER_ROLE = "systems manager";
const roleKey = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim();

export async function mentionsFor(io: Io, _client: Client, cache: Map<string, string | null>): Promise<string[]> {
  // The systems manager(s) on the active team roster (cockpit_people.role). Slack ID by exact
  // email, never guessed by name. Unknown emails are skipped.
  const rows = await io.db.all("cockpit_people", "select=email,role,active&active=is.true");
  const owners = rows.filter(r => roleKey(r.role) === ALERT_OWNER_ROLE && r.email);
  const out: string[] = [];
  for (const b of owners) {
    const email = String(b.email).trim().toLowerCase();
    if (!cache.has(email)) {
      try {
        cache.set(email, (await io.slack("users.lookupByEmail", { email })).user?.id ?? null);
      } catch {
        cache.set(email, null);
      }
    }
    const id = cache.get(email);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * Exactly-once posting. The ledger row is claimed before the network call; a
 * row left in 'sending' or 'unknown' by a crash is looked up in the channel's
 * history by its reference tag before anything is posted again.
 */
export async function deliver(io: Io, x: { episodeId: string; kind: "alert" | "resolved"; client: Client; body: string; threadTs?: string | null }, apply: boolean): Promise<{ ts: string | null; status: string }> {
  const ref = `lsw:${x.episodeId}:${x.kind}`;
  const body = `${x.body}\n_ref ${ref}_`;
  const existing = (await io.db.all("cockpit_lead_sync_alerts", `select=*&episode_id=eq.${encodeURIComponent(x.episodeId)}&kind=eq.${x.kind}`))[0];
  if (existing?.status === "sent") return { ts: existing.slack_ts, status: "sent" };
  if (!apply) return { ts: null, status: "dry" };
  if (existing && (existing.status === "sending" || existing.status === "unknown")) {
    const found = await findInHistory(io, ref, x.threadTs ?? null);
    if (found) {
      await io.db.patch("cockpit_lead_sync_alerts", `id=eq.${existing.id}`, { status: "sent", slack_ts: found, sent_at: new Date().toISOString() });
      return { ts: found, status: "sent" };
    }
    // Not found in history after a crash: hold it for a person rather than risk a double post.
    if (existing.status === "unknown") return { ts: null, status: "unknown" };
    await io.db.patch("cockpit_lead_sync_alerts", `id=eq.${existing.id}`, { status: "unknown", error: "Send interrupted; not found in Slack history" });
    return { ts: null, status: "unknown" };
  }
  let row = existing;
  if (!row)
    row = await io.db.insert("cockpit_lead_sync_alerts", {
      episode_id: x.episodeId,
      kind: x.kind,
      client_key: x.client.key,
      client_name: x.client.name,
      channel: TECH_GENERAL,
      status: "sending",
      thread_ts: x.threadTs ?? null,
      body,
    });
  else await io.db.patch("cockpit_lead_sync_alerts", `id=eq.${row.id}`, { status: "sending", attempts: (row.attempts ?? 0) + 1 });
  try {
    const r = await io.slack("chat.postMessage", { channel: TECH_GENERAL, text: body, unfurl_links: "false", ...(x.threadTs ? { thread_ts: x.threadTs } : {}) } as any, true);
    await io.db.patch("cockpit_lead_sync_alerts", `id=eq.${row.id}`, { status: "sent", slack_ts: r.ts, sent_at: new Date().toISOString(), error: null });
    return { ts: r.ts, status: "sent" };
  } catch (e) {
    const err = String((e as Error)?.message ?? e).slice(0, 300);
    // A definite refusal (not_in_channel, invalid_auth...) is 'failed' and retried next run;
    // a timeout or network fault is 'unknown' and reconciled against history.
    const definite = Boolean((e as any)?.slackError) && (e as any).slackError !== "ratelimited";
    await io.db.patch("cockpit_lead_sync_alerts", `id=eq.${row.id}`, { status: definite ? "failed" : "unknown", error: err });
    return { ts: null, status: definite ? "failed" : "unknown" };
  }
}

async function findInHistory(io: Io, ref: string, threadTs: string | null): Promise<string | null> {
  const oldest = String(Math.floor((Date.now() - 7 * 24 * HOUR) / 1000));
  const r = threadTs
    ? await io.slack("conversations.replies", { channel: TECH_GENERAL, ts: threadTs, oldest, limit: "200" })
    : await io.slack("conversations.history", { channel: TECH_GENERAL, oldest, limit: "200" });
  return (r.messages ?? []).find((m: Row) => String(m.text ?? "").includes(ref))?.ts ?? null;
}

// ------------------------------------------------------------------ run

export async function run(env: Env, apply: boolean, nowMs = Date.now()) {
  const io = makeIo(env);
  const nowIso = new Date(nowMs).toISOString();
  const runRow = apply ? await io.db.insert("cockpit_lead_sync_runs", { started_at: nowIso }) : null;
  const roster = await loadRoster(io);
  const prior = new Map((await io.db.all("cockpit_lead_sync_status", "select=*")).map(r => [String(r.client_key), r]));
  const sync = new Map((await io.db.all("lead_sync_state", "select=location_id,last_synced_at,last_status")).map(r => [String(r.location_id), r]));
  const w24 = window(nowMs, 24);
  const w6 = window(nowMs, 6);
  const slackIds = new Map<string, string | null>();
  const failed: Row[] = [];
  const rows: Row[] = [];
  const sends: Row[] = [];
  let accountsRead = 0;
  let accounts = 0;

  for (const c of roster) {
    const reads = [];
    for (const a of c.accounts) {
      accounts++;
      const r = await readMeta(io, a, nowMs);
      if (r.ok) accountsRead++;
      else failed.push({ client: c.name, account: a, error: r.error });
      reads.push(r);
    }
    const metaOk = reads.length > 0 && reads.every(r => r.ok);
    const hours = reads.flatMap(r => r.hours);
    const tz = reads.find(r => r.tz)?.tz ?? "Asia/Kuwait";
    const s = c.locationId ? sync.get(c.locationId) : undefined;
    const syncedAt = s?.last_synced_at ? Date.parse(s.last_synced_at) : NaN;
    const crmFresh = Boolean(s) && s!.last_status === "success" && Number.isFinite(syncedAt) && nowMs - syncedAt < RULES.crmStaleMin * 60_000;

    let crm24: number | null = null, crmMeta24: number | null = null, crm6: number | null = null;
    const days: Row[] = [];
    if (c.locationId) {
      const since = new Date(Math.min(w24.start, nowMs - 7 * 24 * HOUR)).toISOString();
      const leads = await io.db.all(
        "client_leads",
        `select=created_at,channel,deleted&location_id=eq.${encodeURIComponent(c.locationId)}&created_at=gte.${since}&deleted=is.false`,
      );
      const inW = (w: { start: number; end: number }, l: Row) => {
        const t = Date.parse(l.created_at);
        return t >= w.start && t < w.end;
      };
      crm24 = leads.filter(l => inW(w24, l)).length;
      crmMeta24 = leads.filter(l => inW(w24, l) && l.channel === "Meta").length;
      crm6 = leads.filter(l => inW(w6, l)).length;
      // Seven calendar days in the ad account's time zone, for the panel.
      const metaDays = new Map<string, number>();
      for (const r of reads) for (const [d, v] of r.days) metaDays.set(d, (metaDays.get(d) ?? 0) + v);
      for (let i = 6; i >= 0; i--) {
        const day = zonedDay(nowMs - i * 24 * HOUR, tz);
        const crm = leads.filter(l => zonedDay(Date.parse(l.created_at), tz) === day);
        days.push({ day, meta: metaOk ? (metaDays.get(day) ?? 0) : null, crm: crm.length, crmMeta: crm.filter(l => l.channel === "Meta").length });
      }
    }
    const counts = {
      meta24: metaOk ? sumHours(hours, w24) : null,
      crm24,
      crmMeta24,
      meta6: metaOk ? sumHours(hours, w6) : null,
      crm6,
    };
    const p = prior.get(c.key);
    const pr: Prior = {
      strikes: p?.strikes ?? 0,
      clears: p?.clears ?? 0,
      episodeId: p?.episode_id ?? null,
      gapSince: p?.gap_since ?? null,
      alertTs: p?.alert_ts ?? null,
    };
    const v = decide({ linked: Boolean(c.locationId), metaReadOk: metaOk, crmFresh, counts, prior: pr, nowIso, clientKey: c.key });

    let alertTs = pr.alertTs;
    let episodeId = v.episodeId;
    if (v.sendAlert && v.episodeId) {
      const body = alertText({
        client: c.name,
        state: v.state,
        reason: v.reason,
        ...counts,
        mentions: await mentionsFor(io, c, slackIds),
        cockpitUrl: `${COCKPIT}/ads?account=${encodeURIComponent(c.name)}`,
      });
      const r = await deliver(io, { episodeId: v.episodeId, kind: "alert", client: c, body }, apply);
      sends.push({ client: c.name, kind: "alert", status: r.status });
      if (r.ts) alertTs = r.ts;
    }
    if (v.sendResolved && v.episodeId) {
      const r = await deliver(io, { episodeId: v.episodeId, kind: "resolved", client: c, body: resolvedText({ meta24: counts.meta24, crm24: counts.crm24, since: pr.gapSince }), threadTs: pr.alertTs }, apply);
      sends.push({ client: c.name, kind: "resolved", status: r.status });
      // The episode closes only once its "fixed" reply is in Slack (or there was never an alert).
      if (r.status === "sent" || !pr.alertTs) {
        episodeId = null;
        alertTs = null;
      }
    }

    rows.push({
      client_key: c.key,
      client_name: c.name,
      location_id: c.locationId,
      meta_account_ids: c.accounts,
      matched_by: c.matchedBy,
      state: v.state,
      reason: v.reason,
      meta_24h: counts.meta24,
      crm_24h: counts.crm24,
      crm_meta_24h: counts.crmMeta24,
      meta_6h: counts.meta6,
      crm_6h: counts.crm6,
      missing_24h: v.missing,
      days,
      window_start: new Date(w24.start).toISOString(),
      window_end: new Date(w24.end).toISOString(),
      crm_synced_at: Number.isFinite(syncedAt) ? new Date(syncedAt).toISOString() : null,
      strikes: v.strikes,
      clears: v.clears,
      episode_id: episodeId,
      gap_since: episodeId ? v.gapSince : v.state === "watch" ? v.gapSince : null,
      alert_ts: alertTs,
      checked_at: nowIso,
      updated_at: nowIso,
    });
  }

  const gaps = rows.filter(r => r.state === "gap" || r.state === "stalled").length;
  const allFailed = accounts > 0 && accountsRead === 0;
  const note = allFailed
    ? `Meta refused every ad account (${failed[0]?.error ?? "no error"}). Nothing was judged.`
    : `${roster.length} clients, ${accountsRead}/${accounts} ad accounts read: ${gaps} with Facebook leads not reaching the CRM, ${rows.filter(r => r.state === "unknown").length} unknown, ${rows.filter(r => r.state === "unlinked").length} with no CRM link.`;

  if (apply) {
    // A run that could read nothing does not overwrite the last good picture.
    if (!allFailed) await io.db.upsert("cockpit_lead_sync_status", rows, "client_key");
    await io.db.patch("cockpit_lead_sync_runs", `id=eq.${runRow!.id}`, {
      finished_at: new Date().toISOString(),
      ok: !allFailed && failed.length === 0,
      clients: roster.length,
      accounts,
      read: accountsRead,
      failed,
      gaps,
      note,
    });
    const healthy = !allFailed && failed.length <= Math.max(1, Math.floor(accounts * 0.2)) && !sends.some(s => s.status === "unknown" || s.status === "failed");
    const health: Row = {
      key: HEALTH_KEY,
      last_run_at: nowIso,
      ok: healthy,
      note: note.slice(0, 500),
      rows_seen: rows.length,
      detail: { failed, sends, gaps },
      updated_at: nowIso,
    };
    if (healthy) health.last_ok_at = nowIso;
    await io.db.upsert("cockpit_sync_state", [health], "key");
  }
  return { ok: !allFailed, note, rows, failed, sends };
}

async function doctor(env: Env) {
  const missing = REQUIRED.filter(k => !env[k]);
  if (missing.length) return { ok: false, missing };
  const io = makeIo(env);
  const checks: Row = {};
  const probe = async (k: string, f: () => Promise<unknown>) => {
    try {
      await f();
      checks[k] = "ok";
    } catch (e) {
      checks[k] = String((e as Error)?.message ?? e).slice(0, 160);
    }
  };
  await probe("supabase", () => io.db.all("cockpit_lead_sync_status", "select=client_key&limit=1"));
  await probe("meta", () => io.meta("me", { fields: "id" }));
  await probe("slack", async () => {
    const c = await io.slack("conversations.info", { channel: TECH_GENERAL });
    if (!c.channel?.is_member) throw new Error("bot is not a member of #tech-general");
  });
  await probe("roster", async () => (checks.clients = (await loadRoster(io)).length));
  return { ok: Object.entries(checks).every(([k, v]) => k === "clients" || v === "ok"), checks };
}

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/**
 * Exception alerts (plan 4.1, hermes/exception-alerts) ride this cron line instead of a
 * scheduler of their own. They run at most once in 55 minutes, keep their own health row
 * (cockpit_sync_state key exception-alerts) and their own log line, and never change this
 * check's exit code. EXCEPTION_ALERTS=off in their env file switches them off.
 */
async function exceptionAlerts(apply: boolean) {
  const at = () => new Date().toISOString();
  try {
    const x = await import("../exception-alerts/worker");
    const env = x.readEnv();
    // A budget, so a slow database never holds this job's lock past its 15-minute beat.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<never>((_, fail) => {
      timer = setTimeout(() => fail(new Error("took longer than 4 minutes and was stopped")), 4 * 60_000);
    });
    try {
      const r = await Promise.race([x.runExceptions(x.makeIo(env), env, { apply }), budget]);
      console.log(`[${at()}] exception-alerts ${r.skipped ? `skipped (${r.skipped})` : r.ok ? "ok" : "FAILED"}: ${r.note}`);
    } catch (e) {
      console.error(`[${at()}] exception-alerts FAILED: ${String((e as Error)?.stack ?? e).slice(0, 600)}`);
      if (apply && env.SUPABASE_SERVICE_ROLE_KEY) await x.recordFailure(x.makeIo(env), e);
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.error(`[${at()}] exception-alerts FAILED to load: ${String((e as Error)?.message ?? e).slice(0, 400)}`);
  }
}

if (import.meta.main) {
  const env = readEnv();
  const cmd = process.argv[2] ?? "run";
  try {
    if (cmd === "doctor") {
      const r = await doctor(env);
      console.log(JSON.stringify(r, null, 1));
      process.exit(r.ok ? 0 : 1);
    }
    if (cmd === "status") {
      const io = makeIo(env);
      for (const r of await io.db.all("cockpit_lead_sync_status", "select=client_name,state,meta_24h,crm_24h,meta_6h,crm_6h,reason&order=state,client_name"))
        console.log(`${r.state.padEnd(8)} ${String(r.client_name).slice(0, 34).padEnd(34)} meta24 ${r.meta_24h ?? "?"} crm24 ${r.crm_24h ?? "?"} | 6h ${r.meta_6h ?? "?"}/${r.crm_6h ?? "?"}`);
      process.exit(0);
    }
    const missing = REQUIRED.filter(k => !env[k]);
    if (missing.length) throw new Error(`Missing named keys: ${missing.join(", ")}`);
    const r = await run(env, process.argv.includes("--apply"));
    const rep = arg("--report");
    if (rep) writeFileSync(rep, JSON.stringify(r, null, 1));
    console.log(`[${new Date().toISOString()}] ${r.note}${r.sends.length ? ` Slack: ${r.sends.map(s => `${s.client} ${s.kind} ${s.status}`).join(", ")}` : ""}`);
    if (cmd === "run") await exceptionAlerts(process.argv.includes("--apply"));
    process.exit(r.ok ? 0 : 2);
  } catch (e) {
    console.error(`[${new Date().toISOString()}] lead-sync-watch failed: ${String((e as Error)?.stack ?? e).slice(0, 600)}`);
    // Record the failure where the guardian looks, if the database is reachable.
    try {
      const io = makeIo(env);
      const now = new Date().toISOString();
      await io.db.upsert("cockpit_sync_state", [{ key: HEALTH_KEY, last_run_at: now, ok: false, note: `Run failed: ${String((e as Error)?.message ?? e).slice(0, 400)}`, updated_at: now }], "key");
    } catch {}
    if (cmd === "run") await exceptionAlerts(process.argv.includes("--apply"));
    process.exit(1);
  }
}
