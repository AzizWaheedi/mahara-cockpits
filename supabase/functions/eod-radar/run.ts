/**
 * One EOD Radar run (the Edge Function eod-radar):
 *
 *   1. cockpit_eod_radar_inputs: the window (today's working day and the
 *      lookback before it, or the days asked for), the people who owe an EOD
 *      with each day's off reason and leave, their Slack ids, the cockpit's
 *      sent EODs and the digests already claimed;
 *   2. users.lookupByEmail for anyone whose Slack id is missing or a week old;
 *   3. conversations.history of every EOD channel since the window opened;
 *   4. the credits and every person-day's status (rules.ts);
 *   5. cockpit_eod_radar_apply: the rows, the ids, the sync-state row
 *      eod-radar and one audit row;
 *   6. after today's closeout, with the digest on: claim, post and record
 *      the one closeout message in the digest channel. Nobody is messaged.
 *      While a channel cannot be read the post waits, run after run, until
 *      03:00 Kuwait the next morning (the last runs of that working day), and
 *      then goes with its "Could not read" line. It counts the credits the
 *      database kept from earlier reads (apply's `kept`).
 *
 * A dry run does 1 to 4 and returns the rows and the digest text: nothing is
 * written but the call receipts, and nothing is posted.
 */
import type { Person } from "./match.ts";
import { parsePost, type Post } from "./parse.ts";
import {
  addDays,
  channelIdOrNull,
  creditPosts,
  type DayInfo,
  daysBetween,
  decideDay,
  digestText,
  isFriday,
  kuwaitAt,
  type OutboxRow,
  type Row,
  type Unmatched,
  type Unread,
  workingDayOf,
} from "./rules.ts";
import { type Health, lookupByEmail, missingScopes, postMessage, readChannel, type SlackDeps } from "./slack.ts";

export type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export type ReceiptRow = Parameters<Health>[0] & { run_id: string | null; receipt_index: number | null };

export type RunDeps = {
  rpc: Rpc;
  insertReceipt: (row: ReceiptRow) => Promise<void>;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  /** SLACK_BOT_TOKEN, read by name; empty when it is not set. */
  token: () => string;
  /** A fresh id for the run's receipts. */
  runId?: () => string;
};

export type Job = { job: "run" | "backfill" | "doctor"; day?: string; days?: number; dryRun: boolean; requestedBy: string };

export type RunResult = {
  ok: boolean;
  dryRun: boolean;
  from: string;
  to: string;
  note: string;
  counts: Record<string, number>;
  channels: { id: string; name: string; ok: boolean; error: string | null; posts: number }[];
  unmatched: Unmatched[];
  digest: { day: string; state: string; text: string | null; note?: string } | null;
  rows?: Row[];
  people?: { personId: number; name: string }[];
};

const LOOKUP_EVERY_MS = 7 * 86_400_000;
const MAX_LOOKUPS = 30;
/** While a channel is unread, the closeout post waits until this Kuwait time the next morning (the working day ends at 04:00). */
const HOLD_UNREAD_UNTIL = "03:00";

type InputPerson = Person & {
  slackSource: string | null;
  slackState: string | null;
  slackCheckedAt: string | null;
  days: DayInfo[];
};
type Inputs = {
  now: string;
  today: string;
  from: string;
  to: string;
  settings: { digestOn: boolean; lateAt: string; closeoutAt: string; digestChannel: string; digestChannelName: string; lookbackDays: number };
  channels: { id: string; name: string }[];
  people: InputPerson[];
  outbox: OutboxRow[];
  digests: { day: string; state: string; attempts: number }[];
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The inputs in the shape the rules read; a shape this does not know stops the run before anything is written. */
export function parseInputs(raw: unknown): Inputs {
  const fail = (what: string): never => {
    throw new Error(`The radar's inputs came back without ${what}; nothing was written.`);
  };
  if (!isObj(raw)) fail("an object");
  const r = raw as Record<string, unknown>;
  const s = isObj(r.settings) ? r.settings : fail("settings");
  const from = str(r.from) ?? fail("a first day");
  const to = str(r.to) ?? fail("a last day");
  const today = str(r.today) ?? fail("today");
  if (![from, to, today].every(d => DAY.test(d))) fail("days as YYYY-MM-DD");
  const lateAt = str(s.lateAt) ?? "22:00";
  const closeoutAt = str(s.closeoutAt) ?? "23:00";
  if (!HHMM.test(lateAt) || !HHMM.test(closeoutAt)) fail("the late and closeout times");
  const people = (Array.isArray(r.people) ? r.people : fail("people")).map(x => {
    const p = isObj(x) ? x : fail("a person");
    if (typeof p.personId !== "number" || typeof p.name !== "string") fail("a person's id and name");
    return {
      personId: p.personId as number,
      name: p.name as string,
      email: str(p.email),
      role: str(p.role),
      channel: str(p.channel),
      channelName: str(p.channelName),
      slackUserId: str(p.slackUserId),
      slackSource: str(p.slackSource),
      slackState: str(p.slackState),
      slackCheckedAt: str(p.slackCheckedAt),
      days: (Array.isArray(p.days) ? p.days : []).filter(isObj).map(d => ({
        day: String(d.day),
        off: (str(d.off) as DayInfo["off"]) ?? null,
        offNote: str(d.offNote),
        leave: str(d.leave),
      })),
    };
  });
  const channels = (Array.isArray(r.channels) ? r.channels : []).filter(isObj).flatMap(c => {
    const id = str(c.id);
    const name = str(c.name);
    return id && name ? [{ id, name }] : [];
  });
  // The CSM's outbox rows name their channel ("#eods-csms"): read as its id, as the database does.
  const idByName = new Map(channels.map(c => [c.name.toLowerCase(), c.id]));
  const outbox = (Array.isArray(r.outbox) ? r.outbox : []).filter(isObj).flatMap(o => {
    const day = str(o.day);
    const named = str(o.channel);
    if (typeof o.id !== "number" || !day || !DAY.test(day) || !named) return [];
    const channel = channelIdOrNull(named) ?? idByName.get(named.replace(/^#/, "").toLowerCase()) ?? named;
    return [{ id: o.id, role: str(o.role) ?? "", day, person: str(o.person) ?? "", slackId: str(o.slackId), channel, slackTs: str(o.slackTs), createdAt: str(o.createdAt) ?? "" }];
  });
  const digests = (Array.isArray(r.digests) ? r.digests : []).filter(isObj).map(g => ({ day: String(g.day), state: String(g.state), attempts: Number(g.attempts) || 0 }));
  return {
    now: str(r.now) ?? new Date().toISOString(),
    today,
    from,
    to,
    settings: {
      digestOn: s.digestOn === true,
      lateAt,
      closeoutAt,
      digestChannel: str(s.digestChannel) ?? "C0B5TL9H370",
      digestChannelName: str(s.digestChannelName) ?? "team-management",
      lookbackDays: Number(s.lookbackDays) || 2,
    },
    channels,
    people,
    outbox,
    digests,
  };
}

/** The receipts of one run, numbered in order. */
function runHealth(deps: RunDeps, runId: string | null): Health {
  let index = 0;
  return async row => {
    index += 1;
    await deps.insertReceipt({ ...row, error: row.error?.slice(0, 240), run_id: runId, receipt_index: runId ? index : null });
  };
}

function windowArgs(job: Job, now: Date): Record<string, string> {
  const today = workingDayOf(now.getTime());
  if (job.job === "backfill") return { from: addDays(today, -((job.days ?? 45) - 1)), to: today };
  if (job.day) return { to: job.day };
  return {};
}

/** Whose Slack id is looked up this run: an email, and no id, or a check older than a week, or one that was refused. */
function wantsLookup(p: InputPerson, now: number): boolean {
  if (!p.email) return false;
  if (!p.slackUserId || p.slackSource !== "lookup" || p.slackState === "refused") return true;
  const checked = p.slackCheckedAt ? Date.parse(p.slackCheckedAt) : Number.NaN;
  return !Number.isFinite(checked) || now - checked > LOOKUP_EVERY_MS;
}

export async function runRadar(deps: RunDeps, job: Job): Promise<RunResult> {
  const runId = deps.runId ? deps.runId() : null;
  const health = runHealth(deps, runId);
  const slack: SlackDeps = { health, fetch: deps.fetch, sleep: deps.sleep };
  const now = deps.now().getTime();
  const inputs = parseInputs(await deps.rpc("cockpit_eod_radar_inputs", { p: windowArgs(job, deps.now()) }));
  const { from, to, settings } = inputs;
  const token = deps.token().trim();
  const problems: string[] = [];

  // 2. Slack ids by email.
  const slackIds: { personId: number; slackUserId: string | null; state: "ok" | "not_found" | "refused"; note: string | null }[] = [];
  let lookupBlocked: string | null = null;
  if (token) {
    let asked = 0;
    for (const p of inputs.people) {
      if (!p.email || !wantsLookup(p, now) || lookupBlocked || asked >= MAX_LOOKUPS) continue;
      asked++;
      const found = await lookupByEmail(slack, token, p.email);
      if (found.state === "ok") {
        p.slackUserId = found.id;
        slackIds.push({ personId: p.personId, slackUserId: found.id, state: "ok", note: null });
      } else if (found.state === "not_found") {
        slackIds.push({ personId: p.personId, slackUserId: null, state: "not_found", note: "Slack has no member with this email" });
      } else if (found.state === "refused") {
        slackIds.push({ personId: p.personId, slackUserId: null, state: "refused", note: `Slack refused the lookup (${found.code})` });
        // The same refusal for everyone (a missing scope, a bad token): stop asking.
        if (found.code !== "ratelimited") lookupBlocked = found.code;
      }
    }
  }
  if (lookupBlocked) problems.push(`Slack ids could not be looked up (${lookupBlocked}${lookupBlocked === "missing_scope" ? ": the Slack app needs users:read.email" : ""}); the saved ids were used`);

  // 3. The EOD channels.
  const oldest = kuwaitAt(from, "00:00") / 1000;
  const posts: Post[] = [];
  const channels: RunResult["channels"] = [];
  let scopes: string | null = null;
  for (const c of inputs.channels) {
    if (!token) {
      channels.push({ id: c.id, name: c.name, ok: false, error: "no_token", posts: 0 });
      continue;
    }
    const read = await readChannel(slack, token, c.id, oldest);
    scopes = read.scopes ?? scopes;
    if (!read.ok) {
      channels.push({ id: c.id, name: c.name, ok: false, error: read.error, posts: 0 });
      continue;
    }
    const mine = read.messages.map(m => parsePost(c.id, m)).filter((p): p is Post => p?.eodLike === true);
    posts.push(...mine);
    channels.push({ id: c.id, name: c.name, ok: true, error: null, posts: mine.length });
  }
  const unread: Unread[] = channels.filter(c => !c.ok).map(c => ({ id: c.id, name: c.name, error: c.error ?? "unknown" }));

  // 4. Credits and every person-day.
  const { credits, unmatched, tests } = creditPosts({ posts, people: inputs.people, outbox: inputs.outbox, from, to });
  const rows: Row[] = [];
  for (const p of inputs.people) {
    const byDay = new Map(p.days.map(d => [d.day, d]));
    for (const day of daysBetween(from, to)) {
      const info = byDay.get(day) ?? { day, off: isFriday(day) ? "friday" : null, offNote: null, leave: null };
      rows.push(decideDay({ person: p, info, credit: credits.get(`${p.personId}:${day}`), now, settings, unread }));
    }
  }
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;

  const missing = missingScopes(scopes);
  if (!token) problems.push("SLACK_BOT_TOKEN is not set on eod-radar, so no channel was read");
  else if (unread.length) problems.push(`Could not read ${unread.map(u => `#${u.name} (${u.error})`).join(", ")}`);
  if (missing?.length) problems.push(`The Slack token lacks ${missing.join(", ")}`);
  const ok = Boolean(token) && !unread.length;
  const read = channels.filter(c => c.ok);
  const note = [
    `Read ${read.length} of ${channels.length} EOD channels (${posts.length} posts${tests ? `, ${tests} test${tests === 1 ? "" : "s"} left out` : ""}) for ${from} to ${to}`,
    unmatched.length ? `${unmatched.length} post${unmatched.length === 1 ? "" : "s"} named nobody on the radar` : null,
    ...problems,
  ].filter(Boolean).join(". ");

  // 6 (planned). The closeout post for today; held while a channel is unread and the morning's runs may still read it.
  const today = inputs.today;
  const closed = !isFriday(today) && today >= from && today <= to && now >= kuwaitAt(today, settings.closeoutAt);
  const held = closed && unread.length > 0 && now < kuwaitAt(addDays(today, 1), HOLD_UNREAD_UNTIL);
  const heldNote = `Waiting to read ${unread.map(u => `#${u.name}`).join(", ")}; posted from ${HOLD_UNREAD_UNTIL} if it stays unread`;

  const result: RunResult = {
    ok, dryRun: job.dryRun, from, to, note, counts, channels, unmatched, digest: null,
  };

  if (job.dryRun) {
    result.rows = rows;
    result.people = inputs.people.map(p => ({ personId: p.personId, name: p.name }));
    const text = closed ? digestText(today, rows, inputs.people, unread) : null;
    result.digest = closed
      ? { day: today, state: !settings.digestOn ? "off" : held ? "held" : "would_post", text, ...(held && settings.digestOn ? { note: heldNote } : {}) }
      : null;
    return result;
  }

  // 5. Write.
  const applied = await deps.rpc("cockpit_eod_radar_apply", {
    p: {
      from, to, mode: job.job, rows, slackIds, ok, note: note.slice(0, 500), requestedBy: job.requestedBy,
      channels: channels.map(c => ({ id: c.id, name: c.name, ok: c.ok, error: c.error, posts: c.posts })),
      unmatched: unmatched.slice(0, 20), scopes: scopes ? { have: scopes, missing } : null,
      lookups: { asked: slackIds.length, blocked: lookupBlocked },
    },
  });

  // 6. Post the closeout message once (a day already posted, unknown or out of tries is not asked again).
  if (!closed) return result;
  const text = digestText(today, withKept(rows, applied), inputs.people, unread);
  const done = inputs.digests.find(g => g.day === today && (g.state !== "failed" || g.attempts >= 3));
  if (done) result.digest = { day: today, state: `already ${done.state}`, text };
  else if (!settings.digestOn) result.digest = { day: today, state: "off", text };
  else if (!text) result.digest = { day: today, state: "nothing_owed", text };
  else if (held) result.digest = { day: today, state: "held", text, note: heldNote };
  else result.digest = await sendDigest(deps, slack, token, today, text);
  return result;
}

/** The run's rows with the credits the database kept (a not_read or pending row it did not write over an on-time or late one). */
export function withKept(rows: Row[], applied: unknown): Row[] {
  const kept = new Map<string, Row["status"]>();
  if (isObj(applied) && Array.isArray(applied.kept))
    for (const k of applied.kept)
      if (isObj(k) && typeof k.personId === "number" && typeof k.day === "string" && (k.status === "on_time" || k.status === "late"))
        kept.set(`${k.personId}:${k.day}`, k.status);
  if (!kept.size) return rows;
  return rows.map(r => {
    const status = kept.get(`${r.personId}:${r.day}`);
    return status ? { ...r, status } : r;
  });
}

/** Claim, send, record. A claim the database refuses (already posted, off, too early) sends nothing. */
async function sendDigest(deps: RunDeps, slack: SlackDeps, token: string, day: string, text: string): Promise<NonNullable<RunResult["digest"]>> {
  const claim = await deps.rpc("cockpit_eod_radar_digest_claim", { p: { day, text } });
  if (!isObj(claim) || claim.claimed !== true) {
    const why = isObj(claim) ? String(claim.reason ?? "done") : "done";
    return { day, state: why === "done" ? `already ${isObj(claim) ? String(claim.state ?? "claimed") : "claimed"}` : why, text };
  }
  const channel = str(claim.channel) ?? "";
  const sent = !token
    ? ({ state: "failed", error: "SLACK_BOT_TOKEN is not set on eod-radar" } as const)
    : await postMessage(slack, token, channel, str(claim.text) ?? text);
  await deps.rpc("cockpit_eod_radar_digest_result", {
    p: { day, state: sent.state, ...(sent.state === "posted" ? { ts: sent.ts } : { error: sent.error.slice(0, 240) }) },
  });
  return { day, state: sent.state, text, ...(sent.state === "posted" ? {} : { note: sent.error }) };
}

/** When the run itself breaks: one sync-state line saying so, written through apply with no rows. */
export async function recordFailure(deps: RunDeps, job: Job, error: unknown): Promise<void> {
  const today = workingDayOf(deps.now().getTime());
  const why = error instanceof Error ? error.message.slice(0, 300) : "The run broke";
  await deps.rpc("cockpit_eod_radar_apply", {
    p: { from: today, to: today, mode: job.job, rows: [], ok: false, note: `The radar run broke before it wrote anything: ${why}`, requestedBy: job.requestedBy, channels: [] },
  });
}
