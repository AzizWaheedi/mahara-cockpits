/**
 * The cron door of eod-radar (JWT check off): only a caller with the shared
 * cron secret (vault cockpit_sync_secret = function secret CRON_SECRET) gets
 * past it, compared in constant time before the body is read. The body is
 * exactly one of:
 *
 *   {"job": "run"}                          today's working day and the lookback before it; 202, works in the background
 *   {"job": "run", "day": "2026-10-14"}     that day and the lookback before it
 *   {"job": "backfill", "days": 45}         the last N days (1 to 45)
 *   {"job": "doctor"}                       the token, its scopes and each channel, read only
 *
 * with "dryRun": true on a run or a backfill to get the rows and the digest
 * text back with nothing written and nothing posted. Anything else is 400.
 */
import { recordFailure, type Job, type RunDeps, type RunResult, runRadar } from "./run.ts";
import { authTest, missingScopes, readChannel } from "./slack.ts";

export type DoorDeps = RunDeps & {
  cronSecret: () => string;
  waitUntil: (work: Promise<unknown>) => void;
  /** Swappable for tests. */
  run?: (deps: RunDeps, job: Job) => Promise<RunResult>;
};

/** Constant-time comparison of two strings. */
export function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const EMAIL = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}\.[a-z]{2,24}$/i;
const ALLOWED = new Set(["job", "day", "days", "dryRun", "requestedBy"]);
const SEND = 'Send {"job": "run"}, {"job": "backfill", "days": 1 to 45} or {"job": "doctor"}, with "dryRun": true for a plan.';

/** The body, strictly; a sentence saying what to send when it is anything else. */
export function readJob(body: unknown): Job | string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return SEND;
  const b = body as Record<string, unknown>;
  if (b.job !== "run" && b.job !== "backfill" && b.job !== "doctor") return SEND;
  const extra = Object.keys(b).filter(k => !ALLOWED.has(k));
  if (extra.length) return `Unknown field ${extra[0].slice(0, 40)}. ${SEND}`;
  if (b.dryRun !== undefined && typeof b.dryRun !== "boolean") return `dryRun must be true or false. ${SEND}`;
  if (b.requestedBy !== undefined && (typeof b.requestedBy !== "string" || !EMAIL.test(b.requestedBy))) return `requestedBy must be an email address. ${SEND}`;
  if (b.day !== undefined && (b.job !== "run" || typeof b.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.day))) return `day goes with a run, as YYYY-MM-DD. ${SEND}`;
  if (b.days !== undefined && (b.job !== "backfill" || !Number.isInteger(b.days) || (b.days as number) < 1 || (b.days as number) > 45)) return `days goes with a backfill, 1 to 45. ${SEND}`;
  return {
    job: b.job,
    ...(typeof b.day === "string" ? { day: b.day } : {}),
    ...(b.job === "backfill" ? { days: typeof b.days === "number" ? b.days : 45 } : {}),
    dryRun: b.dryRun === true,
    requestedBy: typeof b.requestedBy === "string" ? b.requestedBy.toLowerCase() : "cron",
  };
}

/** The token, its scopes and one page of each channel; writes nothing but the call receipts. */
export async function runDoctor(deps: RunDeps): Promise<Record<string, unknown>> {
  const token = deps.token().trim();
  const health = async (row: Parameters<Parameters<typeof authTest>[0]["health"]>[0]) => deps.insertReceipt({ ...row, run_id: null, receipt_index: null });
  if (!token) return { ok: false, note: "SLACK_BOT_TOKEN is not set on eod-radar. Set it in the function's secrets (mahara-club-bot's token)." };
  const slack = { health, fetch: deps.fetch, sleep: deps.sleep };
  const who = await authTest(slack, token);
  if (!who.ok) return { ok: false, note: `Slack refused the token (${who.error}).` };
  const inputs = (await deps.rpc("cockpit_eod_radar_inputs", { p: {} })) as { channels?: { id: string; name: string }[] } | null;
  const channels = [];
  for (const c of inputs?.channels ?? []) {
    const read = await readChannelOnce(slack, token, c.id);
    channels.push({ ...c, ok: read.ok, error: read.ok ? null : read.error });
  }
  const missing = missingScopes(who.scopes);
  const ok = channels.every(c => c.ok) && !missing?.length;
  return {
    ok,
    bot: who.user,
    missingScopes: missing,
    channels,
    note: ok
      ? `Token works as ${who.user ?? "the bot"}; every EOD channel can be read.`
      : [missing?.length ? `Add ${missing.join(", ")} to the Slack app, then reinstall it.` : null,
         ...channels.filter(c => !c.ok).map(c => `#${c.name}: ${c.error}`)].filter(Boolean).join(" "),
  };
}

/** One page of a channel from an hour ago, for the doctor. */
async function readChannelOnce(slack: Parameters<typeof readChannel>[0], token: string, channel: string) {
  return readChannel(slack, token, channel, Date.now() / 1000 - 3600);
}

export function makeDoor(deps: DoorDeps) {
  const run = deps.run ?? runRadar;
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return json({ ok: false, note: "POST only" }, 405);
    const expected = deps.cronSecret().trim();
    const given = (req.headers.get("x-cron-secret") ?? "").trim();
    if (!expected || !given || !sameSecret(given, expected)) return json({ ok: false, note: "not allowed" }, 401);
    let parsed: unknown = null;
    try {
      parsed = await req.json();
    } catch {
      parsed = null;
    }
    const job = readJob(parsed);
    if (typeof job === "string") return json({ ok: false, note: job }, 400);
    try {
      if (job.job === "doctor") return json(await runDoctor(deps));
      if (job.dryRun) return json(await run(deps, job));
      deps.waitUntil(
        run(deps, job).catch(async e => {
          await recordFailure(deps, job, e).catch(() => undefined);
        }),
      );
      return json({ ok: true, started: job.job }, 202);
    } catch (e) {
      return json({ ok: false, note: e instanceof Error ? e.message.slice(0, 240) : "The radar could not start." }, 500);
    }
  };
}
