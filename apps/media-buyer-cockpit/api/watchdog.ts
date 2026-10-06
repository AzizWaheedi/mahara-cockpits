/**
 * Independent Vercel watchdog: checks Supabase's service-only native monitor
 * and calls each cockpit Edge Function with a harmless GET (405 proves its
 * method guard ran, not merely that the gateway is up). No provider action.
 * CRON_SECRET guards every request. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 * are server-only; no browser or legacy backend credential is accepted.
 * ?dry=1 sends no Slack messages and writes no receipts. ?test=1 sends a DM.
 * Slack history retains the six-hour repeat limit and one recovery message.
 */
import { z } from "zod";
import { monitoredFetch, serviceConfig } from "./tools.js";

declare const process: { env: Record<string, string | undefined> };

const REALERT_MS = 6 * 3600_000;
const LOOKBACK_MS = 24 * 3600_000;
const NATIVE_TIMEOUT_MS = 20_000;
const SLACK_TIMEOUT_MS = 10_000;
const AZIZ_SLACK_ID = "U09305KE2KS";
/**
 * Keys are lower case letters, digits, "-" and ":" only. No dots: Slack turns
 * dotted words such as "feed.fresh" into links, which would break the tag.
 */
const REF = /watchdog:([a-z0-9:-]+)/g;
const CLEAR = "watchdog:clear";

const checkSchema = z.object({
  key: z.string().min(1), name: z.string().min(1), ok: z.boolean(),
  error: z.string().nullable(), at: z.string().nullable(),
  max_age_min: z.number().positive().nullable(),
});
const summarySchema = z.object({
  version: z.literal(1), checked_at: z.string(),
  checks: z.array(checkSchema).min(1),
});
type Summary = z.infer<typeof summarySchema>;
export const REQUIRED_CHECKS = [
  ...["money", "expenses", "growth", "webinar", "b2bAds", "delivery", "calls",
    "clients", "team", "hiring", "portal", "assets", "organic", "machine"].map(k => `section:${k}`),
  "worker:ceo-refresh", "worker:media-core", "worker:team-calendar",
  "queue:ask-ai", "queue:eod", "catalog:native",
];
const EDGE_FUNCTIONS = ["cockpit-media-api", "cockpit-creative-api",
  "cockpit-csm-api", "cockpit-ceo-api", "cockpit-team-api"];
type Problem = { key: string; text: string };
type SlackReply = {
  ok?: boolean;
  error?: string;
  channel?: { id?: string };
  messages?: { text?: string; ts?: string; bot_id?: string }[];
};
/** `unavailable` says why the DM could not be read (then nothing is held back). */
type Memory = {
  recent: Set<string>;
  lastWasAlert: boolean;
  unavailable: string | null;
};
const forgetful = (why: string): Memory => ({
  recent: new Set(),
  lastWasAlert: false,
  unavailable: why,
});

const NATIVE_FIX =
  "Read the native worker doctor and run logs, Supabase function logs and RUNBOOK.md. Missing migrations, credentials or cron entries must be repaired; do not mark old data fresh.";

/** Constant-time check of `Authorization: Bearer <secret>`. */
function sameBearer(header: string | null, secret: string | undefined) {
  if (!secret || !header) return false;
  const want = `Bearer ${secret}`;
  let diff = header.length ^ want.length;
  for (let i = 0; i < Math.max(header.length, want.length); i++)
    diff |= (header.charCodeAt(i) || 0) ^ (want.charCodeAt(i) || 0);
  return diff === 0;
}

/** One short line for an error, never with a secret in it. */
function short(e: unknown): string {
  const s =
    e instanceof Error ? `${e.name}: ${e.message}` : String(e ?? "unknown");
  const secrets = [
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.SLACK_BOT_TOKEN,
    process.env.CRON_SECRET,
  ].filter((x): x is string => Boolean(x));
  let out = s;
  for (const x of secrets) out = out.split(x).join("[hidden]");
  return out.replace(/\s+/g, " ").slice(0, 120);
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "unknown";

/** Slack reads &, < and > as markup, so service error text is escaped. */
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function parseSummary(value: unknown): Summary {
  const summary = summarySchema.parse(value);
  if (new Set(summary.checks.map(c => c.key)).size !== summary.checks.length)
    throw new Error("Native health contains duplicate check keys");
  return summary;
}

export function judge(s: Summary, now = Date.now()): Problem[] {
  const out: Problem[] = [];
  const snapshotAge = now - Date.parse(s.checked_at);
  if (!Number.isFinite(snapshotAge) || snapshotAge < -60_000 || snapshotAge > 60_000)
    out.push({key: "native-snapshot", text: "The native health response has an invalid or stale observation time."});
  const seen = new Set(s.checks.map(c => c.key));
  for (const key of REQUIRED_CHECKS)
    if (!seen.has(key)) out.push({key: `native-missing:${slug(key)}`, text: `Native health omitted required check ${key}. ${NATIVE_FIX}`});
  for (const c of s.checks) {
    const age = c.at === null ? NaN : (now - Date.parse(c.at)) / 60_000;
    const late = c.max_age_min !== null &&
      (!Number.isFinite(age) || age < -1 || age > c.max_age_min);
    if (!c.ok || late) out.push({
      key: `native:${slug(c.key)}`,
      text: `${c.name}: ${!c.ok ? c.error || "required native state is missing or failed" : "last successful state is missing, future-dated or too old"}${late ? ` (required within ${c.max_age_min} minutes)` : ""}. ${NATIVE_FIX}`,
    });
  }
  return out;
}

/** Fresh checks execute outside the backend they watch. */
async function findProblems(dry: boolean): Promise<Problem[]> {
  const config = serviceConfig();
  if (!config) return [{key: "setup-native", text: "Set server-only SUPABASE_URL to Creative Triage and SUPABASE_SERVICE_ROLE_KEY on Vercel. Native monitoring cannot run without them."}];
  const headers = {apikey: config.key, Authorization: `Bearer ${config.key}`};
  const out: Problem[] = [];
  try {
    const res = await monitoredFetch(`${config.url}/rest/v1/rpc/cockpit_native_monitor`, {
      method: "POST", headers: {...headers, "Content-Type": "application/json"}, body: "{}",
      signal: AbortSignal.timeout(NATIVE_TIMEOUT_MS),
    }, {dry, expected: [200]});
    if (!res.ok) throw new Error(`native monitor RPC HTTP ${res.status}`);
    out.push(...judge(parseSummary(await res.json())));
  } catch (error) {
    out.push({key: "native-unavailable", text: `The service-only native health RPC failed (${short(error)}). The monitor migration, grants or Supabase connection are missing or failing. ${NATIVE_FIX}`});
  }
  const probes = await Promise.all(EDGE_FUNCTIONS.map(async name => {
    try {
      const res = await monitoredFetch(`${config.url}/functions/v1/${name}`, {
        headers, signal: AbortSignal.timeout(10_000),
      }, {dry, expected: [405]});
      const body: unknown = await res.json();
      if (res.status !== 405 || typeof body !== "object" || body === null ||
          !("error" in body) || body.error !== "POST required")
        throw new Error(`HTTP ${res.status}; expected deployed method guard`);
      return null;
    } catch (error) {
      return {key: `edge:${name}`, text: `${name} did not pass its read-only runtime probe (${short(error)}). Check its deployment and gateway configuration.`};
    }
  }));
  for (const problem of probes) if (problem) out.push(problem);
  return out;
}

async function slack(
  method: string,
  token: string,
  opts: { query?: Record<string, string>; body?: unknown },
): Promise<SlackReply> {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [k, v] of Object.entries(opts.query ?? {}))
    url.searchParams.set(k, v);
  try {
    const res = await monitoredFetch(url.href, {
      method: opts.body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(opts.body
          ? { "Content-Type": "application/json; charset=utf-8" }
          : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
    }, {dry: false, expected: [200]});
    const json = (await res.json().catch(() => null)) as SlackReply | null;
    return json ?? { ok: false, error: `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: short(e) };
  }
}

/**
 * What the watchdog already said: its own messages in the DM over the last
 * day. One history call per run, which fits Slack's tightest limit for
 * non-Marketplace apps (one call a minute).
 */
async function recall(token: string, to: string, now: number): Promise<Memory> {
  // A user id needs the DM opened first; a channel or DM id is used as is.
  let channel = /^[CDG][A-Z0-9]+$/.test(to) ? to : undefined;
  if (!channel) {
    const open = await slack("conversations.open", token, {
      body: { users: to },
    });
    channel = open.ok ? open.channel?.id : undefined;
    if (!channel)
      return forgetful(`conversations.open: ${open.error ?? "no DM"}`);
  }
  const history = await slack("conversations.history", token, {
    query: {
      channel,
      oldest: String(Math.floor((now - LOOKBACK_MS) / 1000)),
      limit: "100",
    },
  });
  if (!history.ok) return forgetful(`conversations.history: ${history.error}`);
  // Newest first. Only the bot's own tagged messages count.
  const ours = (history.messages ?? []).filter(
    m => m.bot_id && (m.text ?? "").includes("watchdog:"),
  );
  // Everything alerted in the last 6 hours is held back, even if an all
  // clear came in between: the rule is one message per problem per 6 hours.
  const recent = new Set<string>();
  for (const m of ours)
    if (Number(m.ts ?? 0) * 1000 >= now - REALERT_MS)
      for (const hit of (m.text ?? "").matchAll(REF))
        if (hit[1] !== "clear") recent.add(hit[1]);
  const last = ours[0]?.text ?? "";
  return {
    recent,
    lastWasAlert: !!last && !last.includes(CLEAR),
    unavailable: null,
  };
}

async function post(token: string, to: string, text: string) {
  const r = await slack("chat.postMessage", token, {
    body: { channel: to, text, unfurl_links: false, unfurl_media: false },
  });
  if (!r.ok) throw new Error(`Slack chat.postMessage: ${r.error}`);
}

function alertText(fresh: Problem[], held: string[], memory: Memory) {
  const lines = [
    `Watchdog (outside check from Vercel): ${fresh.length === 1 ? "1 problem" : `${fresh.length} problems`}.`,
    ...fresh.map((p, i) => `${i + 1}. ${esc(p.text)}`),
  ];
  if (held.length)
    lines.push(
      `Still open, already sent in the last 6 hours: ${held.join(", ")}.`,
    );
  if (memory.unavailable)
    lines.push(
      `Repeats are not held back this run: Slack said ${esc(memory.unavailable)}. The watchdog reads this DM to remember what it sent, which needs the im:history and im:write scopes on the Slack app. Until then every 15-minute run that finds a problem sends it again, and no all clear is sent.`,
    );
  lines.push('What each alert means: `RUNBOOK.md`, "Watchdog".');
  lines.push(`(ref ${fresh.map(p => `watchdog:${p.key}`).join(" ")})`);
  return lines.join("\n");
}

export async function GET(request: Request): Promise<Response> {
  if (!process.env.CRON_SECRET) {
    // Without it every run, the cron's included, is refused: say so in the log.
    console.error("watchdog: CRON_SECRET is not set on Vercel");
    return new Response("Unauthorized", { status: 401 });
  }
  if (
    !sameBearer(request.headers.get("authorization"), process.env.CRON_SECRET)
  )
    return new Response("Unauthorized", { status: 401 });
  const params = new URL(request.url).searchParams;
  const now = Date.now();
  const problems = await findProblems(params.has("dry"));
  const keys = problems.map(p => p.key);

  if (params.has("dry"))
    return Response.json({ ok: problems.length === 0, problems });

  const token = process.env.SLACK_BOT_TOKEN;
  const to = process.env.ALERT_SLACK_TO || AZIZ_SLACK_ID;
  if (!token) {
    console.error("watchdog: SLACK_BOT_TOKEN is not set on Vercel");
    return Response.json(
      { ok: false, problems: keys, error: "SLACK_BOT_TOKEN is not set" },
      { status: 500 },
    );
  }

  try {
    if (params.has("test"))
      await post(
        token,
        to,
        `Watchdog test from Vercel: the Slack DM works. Native backend check right now: ${problems.length ? `${problems.length} problem(s), ${keys.join(", ")}` : "all required checks passed"}.`,
      );

    const memory = await recall(token, to, now);
    let sent: string[] = [];
    let held: string[] = [];
    if (problems.length) {
      const fresh = problems.filter(p => !memory.recent.has(p.key));
      held = keys.filter(k => !fresh.some(p => p.key === k));
      if (fresh.length) {
        await post(token, to, alertText(fresh, held, memory));
        sent = fresh.map(p => p.key);
      }
    } else if (memory.lastWasAlert) {
      await post(
        token,
        to,
        `Watchdog: all clear. The native health RPC answers, required sections and producer state are current and passing, queues have no monitored blockage, and the five cockpit Edge Functions pass their read-only method probes. These probes do not exercise user/provider writes. If a problem returns within 6 hours, it is held until that window ends. (ref ${CLEAR})`,
      );
      sent = ["clear"];
    }
    return Response.json({
      ok: problems.length === 0,
      problems: keys,
      sent,
      held,
      memory: memory.unavailable
        ? `unavailable (${memory.unavailable})`
        : "slack",
    });
  } catch (e) {
    console.error(`watchdog: ${short(e)}`);
    return Response.json(
      { ok: false, problems: keys, error: short(e) },
      { status: 502 },
    );
  }
}
