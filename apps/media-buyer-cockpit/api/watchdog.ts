/**
 * The outside watchdog. Convex runs the crons, the health ledger and the
 * Slack alerts, so nothing inside Convex notices when Convex itself stalls or
 * its crons stop. This Vercel function runs on a Vercel cron (vercel.json,
 * every 15 minutes), outside Convex, and DMs Aziz when:
 *
 * - the Convex route GET /watchdog (convex/http.ts) does not answer, refuses
 *   the token or answers with an error;
 * - the newest CEO section refresh (or the CEO refresh job) is older than
 *   45 minutes;
 * - the newest smoke check is older than 45 minutes, or it failed;
 * - a CEO section is failing;
 * - Convex's own Slack path is failing, so its alerts cannot reach Aziz.
 *
 * Repeats: the same problem is sent at most once every 6 hours, even when it
 * cleared in between (a section that fails every other run would otherwise
 * send an alert and an all clear every half hour). There is no database
 * here, so the watchdog remembers what it sent by reading its own recent
 * messages in the DM (every alert ends with "ref watchdog:<key>"). If Slack
 * will not let it read the DM (the im:history and im:write scopes are
 * missing), it alerts on every failing run, once per cron run, and says so in
 * the message. When everything is back to normal it sends one "all clear".
 *
 * Environment (Vercel, production): CRON_SECRET (Vercel sends it on every
 * cron call; required), WATCHDOG_TOKEN (same value as on the Convex
 * deployment), SLACK_BOT_TOKEN (same bot as Convex), optional ALERT_SLACK_TO
 * (overrides the recipient, as on Convex). VITE_CONVEX_URL, already set for
 * the site, names the deployment to check.
 *
 * Manual runs, with the cron secret as the bearer token:
 *   ?dry=1   check and return the problems as JSON, send nothing
 *   ?test=1  also send a test DM (no ref tag, so it does not affect repeats)
 *
 * See RUNBOOK.md, "Watchdog".
 */
import { AZIZ_SLACK_ID } from "../convex/constants.js";

declare const process: { env: Record<string, string | undefined> };

const STALE_MIN = 45;
const REALERT_MS = 6 * 3600_000;
const LOOKBACK_MS = 24 * 3600_000;
const CONVEX_TIMEOUT_MS = 20_000;
const SLACK_TIMEOUT_MS = 10_000;
/** The media buyer production deployment (HOSTING.md), if VITE_CONVEX_URL is absent. */
const DEFAULT_SITE = "https://adorable-seahorse-418.convex.site";
/**
 * Keys are lower case letters, digits, "-" and ":" only. No dots: Slack turns
 * dotted words such as "feed.fresh" into links, which would break the tag.
 */
const REF = /watchdog:([a-z0-9:-]+)/g;
const CLEAR = "watchdog:clear";

type Item = { key: string; name: string; error: string };
type Summary = {
  ok: boolean;
  staleAfterMin: number;
  ceo: {
    refreshAgeMin: number | null;
    jobAgeMin: number | null;
    sections: number;
    failingCount: number;
    failing: Item[];
  };
  smoke: {
    ok: boolean | null;
    ageMin: number | null;
    failingCount: number;
    failing: Item[];
  };
  sources: { failingCount: number; failing: Item[] };
};
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

const CONVEX_FIX =
  "Open the Convex dashboard (project mahara-media-buyer, production): Health, Logs and Schedules. If the last deploy failed or nothing is running, run `scripts/ship.sh media-buyer` from the repo root.";

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
    process.env.WATCHDOG_TOKEN,
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

/** Slack reads &, < and > as markup, so text from Convex is escaped. */
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function convexSite(): string {
  const cloud = (process.env.VITE_CONVEX_URL ?? "").trim().replace(/\/+$/, "");
  return /^https:\/\/[a-z0-9-]+\.convex\.cloud$/.test(cloud)
    ? cloud.replace(/\.convex\.cloud$/, ".convex.site")
    : DEFAULT_SITE;
}

function isSummary(x: unknown): x is Summary {
  const s = x as Summary | null;
  return (
    typeof s === "object" &&
    s !== null &&
    typeof s.ok === "boolean" &&
    Array.isArray(s.ceo?.failing) &&
    Array.isArray(s.smoke?.failing) &&
    Array.isArray(s.sources?.failing)
  );
}

/** What is wrong right now, as seen from outside Convex. */
async function findProblems(): Promise<Problem[]> {
  const token = process.env.WATCHDOG_TOKEN;
  if (!token)
    return [
      {
        key: "setup-token",
        text: "WATCHDOG_TOKEN is not set on Vercel, so the watchdog cannot check Convex at all. Set it on Vercel and on Convex (`RUNBOOK.md`, Watchdog), then redeploy the site.",
      },
    ];
  const site = convexSite();
  const host = new URL(site).host;
  let res: Response;
  try {
    res = await fetch(`${site}/watchdog`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(CONVEX_TIMEOUT_MS),
    });
  } catch (e) {
    return [
      {
        key: "convex-down",
        text: `Convex (${host}) did not answer within ${CONVEX_TIMEOUT_MS / 1000} seconds (${short(e)}). The portal, its crons, the smoke check for all three cockpits and their Slack alerts run there, so nothing else will tell you. Check status.convex.dev. ${CONVEX_FIX}`,
      },
    ];
  }
  if (res.status === 401)
    return [
      {
        key: "convex-token",
        text: `Convex (${host}) refused the watchdog's token. WATCHDOG_TOKEN is missing on the Convex production deployment, or differs from the value on Vercel (\`RUNBOOK.md\`, Watchdog). Convex itself is answering.`,
      },
    ];
  if (res.status === 404)
    return [
      {
        key: "convex-route",
        text: `Convex (${host}) answers but has no /watchdog route, so the change in \`convex/http.ts\` is not deployed. Run \`scripts/ship.sh media-buyer\`.`,
      },
    ];
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok || !isSummary(body)) {
    const said =
      typeof (body as { error?: unknown } | null)?.error === "string"
        ? `: ${String((body as { error: string }).error).slice(0, 120)}`
        : "";
    return [
      {
        key: "convex-error",
        text: `Convex (${host}) answered the watchdog with HTTP ${res.status}${res.ok ? " and an unreadable body" : ""}${said}. ${CONVEX_FIX}`,
      },
    ];
  }
  return judge(body);
}

function judge(s: Summary): Problem[] {
  const out: Problem[] = [];
  const late = (min: number | null) => min === null || min > STALE_MIN;

  const { refreshAgeMin, jobAgeMin } = s.ceo;
  if (late(refreshAgeMin) || (jobAgeMin !== null && jobAgeMin > STALE_MIN)) {
    const age =
      refreshAgeMin === null
        ? "have never been refreshed"
        : `are ${Math.max(refreshAgeMin, jobAgeMin ?? 0)} minutes old`;
    out.push({
      key: "ceo-stale",
      text: `The CEO cockpit numbers ${age}; the refresh should run every 15 minutes. The Convex crons have probably stopped (look for \`ceo/refresh:refreshAll\`). ${CONVEX_FIX}`,
    });
  }
  for (const f of s.ceo.failing)
    out.push({
      key: `ceo-section:${slug(f.key)}`,
      text: `CEO cockpit, ${f.name}, is failing: ${f.error}. The screen keeps its last good numbers and the section retries every 15 minutes; the Machine tab shows which source is slow or down.`,
    });

  const smokeAge = s.smoke.ageMin;
  if (late(smokeAge))
    out.push({
      key: "smoke-stale",
      text: `The 15-minute smoke check ${smokeAge === null ? "has never run" : `last ran ${smokeAge} minutes ago`}. It is a Convex cron, so the crons have probably stopped, and with them the sync, the feeds and Convex's own alerts. ${CONVEX_FIX}`,
    });
  if (s.smoke.ok === false) {
    if (!s.smoke.failing.length)
      out.push({
        key: "smoke-failed",
        text: "The last smoke check failed without naming a screen. Open portal, Admin to see the cockpit checks.",
      });
    for (const f of s.smoke.failing)
      out.push({
        key: `smoke:${slug(f.key)}`,
        text: `The smoke check failed: ${f.name} (${f.error}). Convex has sent its own alert and filed a fix job for Hermes; if the screen stays broken, see \`RUNBOOK.md\`.`,
      });
  }

  // Convex alerts on every other source itself, but not when its Slack is down.
  const slackSource = s.sources.failing.find(f => f.key === "slack");
  if (slackSource)
    out.push({
      key: "convex-slack",
      text: `Convex cannot send Slack messages (${slackSource.error}), so its own alerts are not reaching you. Fix: see the Slack row in \`RUNBOOK.md\`.`,
    });
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
    const res = await fetch(url, {
      method: opts.body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        ...(opts.body
          ? { "Content-Type": "application/json; charset=utf-8" }
          : {}),
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(SLACK_TIMEOUT_MS),
    });
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
  const problems = await findProblems();
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
        `Watchdog test from Vercel: the Slack DM works. Convex check right now: ${problems.length ? `${problems.length} problem(s), ${keys.join(", ")}` : "all fine"}.`,
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
        `Watchdog: all clear. Convex answers, the CEO refresh and the smoke check are on time and passing, no CEO section is failing, and Convex can send Slack messages. If one of the problems comes back within 6 hours of its alert, it is not sent again until the 6 hours are up. (ref ${CLEAR})`,
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
