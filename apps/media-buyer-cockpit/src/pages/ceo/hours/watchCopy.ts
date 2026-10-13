import { minutes, plural, time } from "@/components/ceo/format";
import type { StatusTone } from "@/components/ceo/StatusChip";
import type {
  SlackState,
  WatchBoard,
  WatchIncident,
  WatchKind,
  WatchPerson,
  WatchRecent,
  WatchSettings,
  WatchShot,
  WatchSlot,
} from "@/types/ceo/hoursWatch";
import { hm } from "./hoursFormat";

/**
 * Hubstaff watch, the words and the shift line's geometry: pure, so the
 * screen and its tests read the same sentences. Every sentence says what to
 * do next; a source that cannot be read is said, never shown as zero.
 * Times are Kuwait wall clock (format.ts), like the schedules' default.
 */

const MIN = 60_000;
const SLOT = 10 * MIN;
const HOUR = 60 * MIN;
/** Hubstaff's activity data arrives up to 20 minutes late. */
export const ACTIVITY_LAG_MS = 20 * MIN;
/** Kuwait is UTC+3 all year: an hour boundary in Kuwait is one in UTC. */
const KUWAIT_MS = 3 * HOUR;

const ms = (iso: string | null | undefined) => {
  const v = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(v) ? v : null;
};
/** Percentages are rounded down, so 9.7% under a 10% floor never reads "10%". */
const pctDown = (v: number) => `${Math.floor(v + 1e-9)}%`;
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const strip = (s: string) => s.trim().replace(/\.+$/, "");
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const numOf = (v: unknown) =>
  v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v))
    ? Number(v)
    : null;

/**
 * A note or reason from the server, as words. The server writes sentences,
 * but a bare code (`unreadable`, `rate_limited`, "hubstaff unreadable") must
 * never reach the screen: a known one is said plainly, an unknown one gets
 * the generic sentence.
 */
const HUBSTAFF_CODES: Record<string, string> = {
  unreadable: "Hubstaff sent an answer the watch cannot read",
  hubstaff_unreadable: "Hubstaff sent an answer the watch cannot read",
  refused: "Hubstaff refused the saved key",
  plan_blocked: "Hubstaff's plan does not include API access",
  needs_new_key: "Hubstaff needs a new key",
  missing_key: "Hubstaff is not connected",
  not_connected: "Hubstaff is not connected",
  unreachable: "Hubstaff could not be reached",
  timeout: "Hubstaff did not answer in time",
  rate_limited: "Hubstaff asked the watch to slow down",
  firewall_blocked: "Hubstaff's firewall blocked the request",
};
const AI_CODES: Record<string, string> = {
  refused: "the key was refused",
  unreachable: "the AI could not be reached",
  timeout: "the AI did not answer in time",
  rate_limited: "the AI asked the watch to slow down",
  not_found: "the model was not found",
  model_not_found: "the model was not found",
  unreadable: "the AI's answer could not be read",
};
/** Slack's codes: what happened, and what to do about it. */
const SLACK_CODES: Record<string, [string, string]> = {
  not_in_channel: [
    "the Slack app is not in the channel",
    "Invite the app to the channel in Slack.",
  ],
  channel_not_found: [
    "the channel was not found",
    "Check the channel id in Settings.",
  ],
  is_archived: [
    "the channel is archived",
    "Choose another channel in Settings.",
  ],
  invalid_auth: [
    "the Slack token was refused",
    "The systems manager renews SLACK_BOT_TOKEN.",
  ],
  not_authed: [
    "the Slack token is missing",
    "The systems manager sets SLACK_BOT_TOKEN.",
  ],
  token_revoked: [
    "the Slack token was revoked",
    "The systems manager renews SLACK_BOT_TOKEN.",
  ],
  account_inactive: [
    "the Slack token was revoked",
    "The systems manager renews SLACK_BOT_TOKEN.",
  ],
  missing_scope: [
    "the Slack app may not post there",
    "The systems manager adds the chat:write permission.",
  ],
  ratelimited: [
    "Slack asked the watch to slow down",
    "The next alert tries again.",
  ],
  rate_limited: [
    "Slack asked the watch to slow down",
    "The next alert tries again.",
  ],
};
const isCode = (s: string) => /^[a-z0-9]+(?:[_.:-][a-z0-9]+)*$/i.test(s);
const codeKey = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/[\s.:-]+/g, "_");

export function plainNote(
  note: unknown,
  codes: Record<string, string>,
  generic: string,
): string {
  const s = str(note)?.trim();
  if (!s) return generic;
  const known = codes[codeKey(s)];
  if (known) return known;
  return isCode(s) ? generic : strip(s);
}

/** Slack's own error, said plainly; the code itself stays in brackets for the systems manager. */
export function slackReason(error: string | null | undefined): string {
  const s = str(error)?.trim();
  if (!s) return "no reason given";
  const known = SLACK_CODES[codeKey(s)];
  if (known) return `${known[0]} (${s})`;
  return isCode(s) ? `Slack answered with the code ${s}` : strip(s);
}

/** What to do about Slack's error. */
export function slackFix(error: string | null | undefined): string {
  const s = str(error)?.trim();
  return (
    (s && SLACK_CODES[codeKey(s)]?.[1]) ??
    "Check the channel in Settings, then Check now."
  );
}

/** People on shift now: everyone the watch is looking at this minute. */
const ON_SHIFT = new Set([
  "tracking",
  "not_tracking",
  "on_break",
  "idle",
  "not_work",
  "no_account",
  "cant_tell",
]);
const NEEDS_LOOK = new Set(["not_tracking", "idle", "not_work", "no_account"]);

export function onShift(p: WatchPerson): boolean {
  return ON_SHIFT.has(p.state);
}

/**
 * Inside the allowed lunch break: stopped, no alert yet. The state says it;
 * `onBreak` on a not-tracking row says the same, so a break never reads as
 * needing a look.
 */
export function onBreak(p: WatchPerson): boolean {
  return p.state === "on_break" || (p.onBreak && p.state === "not_tracking");
}

/** Needs a look: on shift and not working, but never on an allowed break. */
export function needsLook(p: WatchPerson): boolean {
  return NEEDS_LOOK.has(p.state) && !onBreak(p);
}

/** The leave window covering `at`, if any. */
function leaveAt(p: WatchPerson, at: number) {
  return p.leave
    .map(l => ({ start: ms(l.start), end: ms(l.end) }))
    .find(
      (l): l is { start: number; end: number } =>
        l.start !== null && l.end !== null && l.start <= at && at < l.end,
    );
}

/** The fix a row carries itself: a missing schedule is set in Team & payroll. */
export function rowFix(
  p: WatchPerson,
): { text: string; action: "team" } | null {
  return p.offReason === "no_schedule"
    ? { text: "Set one in Team & payroll", action: "team" }
    : null;
}

/** True when Hubstaff can be read; a source incident or any other state says it cannot. */
export function hubstaffReadable(b: WatchBoard): boolean {
  return (
    ["connected", "ok"].includes(b.sources.hubstaff.state) &&
    !b.open.some(i => i.kind === "source")
  );
}

/** The chip on each row, with the tone the spec maps it to. */
export function stateChip(
  p: WatchPerson,
  now: number,
): { tone: StatusTone; label: string } {
  if (onBreak(p)) {
    const since = ms(p.since) ?? ms(p.lastActivityAt);
    return {
      tone: "neutral",
      label: since ? `On a break since ${time(since)}` : "On a break",
    };
  }
  if (p.offReason === "no_schedule")
    return { tone: "neutral", label: "No schedule set" };
  switch (p.state) {
    case "tracking":
      return { tone: "good", label: "Working" };
    case "not_tracking": {
      const since = ms(p.since) ?? ms(p.lastActivityAt);
      return {
        tone: "warning",
        label: since ? `Not tracking since ${time(since)}` : "Not tracking",
      };
    }
    case "idle":
      return { tone: "warning", label: "Timer on, no activity" };
    case "not_work":
      return { tone: "critical", label: "Not work on screen" };
    case "no_account":
      return { tone: "neutral", label: "Not in Hubstaff" };
    case "on_leave": {
      const part = leaveAt(p, now);
      return {
        tone: "neutral",
        label: part ? `On leave until ${time(part.end)}` : "On leave",
      };
    }
    case "holiday":
      return { tone: "neutral", label: "Holiday" };
    case "cant_tell":
      return { tone: "neutral", label: "Can't tell" };
    default: {
      if (p.offReason === "leave")
        return { tone: "neutral", label: "On leave" };
      if (p.offReason === "holiday")
        return { tone: "neutral", label: "Holiday" };
      if (p.offReason === "paused") return { tone: "neutral", label: "Paused" };
      if (p.offReason === "not_employed")
        return { tone: "neutral", label: "Not on the team" };
      const start = ms(p.shiftStart);
      const end = ms(p.shiftEnd);
      if (start !== null && now < start)
        return { tone: "neutral", label: `Starts ${time(start)}` };
      if (end !== null && now >= end)
        return { tone: "neutral", label: "Shift ended" };
      return { tone: "neutral", label: "Off today" };
    }
  }
}

/** The one sentence under the title: who is working, who needs a look. */
export function headline(b: WatchBoard, now: number): string {
  if (!hubstaffReadable(b))
    return "Can't tell who is working: Hubstaff cannot be read.";
  const on = b.people.filter(onShift);
  if (!on.length) {
    const next = b.people
      .map(p => ms(p.shiftStart))
      .filter((v): v is number => v !== null && v > now)
      .sort((a, z) => a - z)[0];
    if (!b.people.length) return "Nobody is watched yet.";
    return next
      ? `Nobody is on shift now. Next shift starts at ${time(next)}.`
      : "Nobody is on shift now.";
  }
  const look = on.filter(needsLook).map(p => p.name);
  const resting = on.filter(onBreak).map(p => p.name);
  const unsure = on.filter(p => p.state === "cant_tell").map(p => p.name);
  const working = on.filter(p => p.state === "tracking").length;
  const names = (list: string[]) =>
    list.length === 1
      ? firstName(list[0])
      : list.length === 2
        ? `${firstName(list[0])} and ${firstName(list[1])}`
        : `${list.length} people`;
  const parts: string[] = [];
  if (look.length)
    parts.push(
      `${names(look)} ${look.length === 1 ? "needs" : "need"} a look.`,
    );
  if (!look.length && !unsure.length && !resting.length)
    parts.push(
      working === 1
        ? `${firstName(on[0].name)} is working.`
        : working === 2
          ? "Both are working."
          : `All ${working} are working.`,
    );
  else if (working)
    parts.push(`${working === 1 ? "1 is" : `${working} are`} working.`);
  if (resting.length)
    parts.push(
      `${names(resting)} ${resting.length === 1 ? "is" : "are"} on a break.`,
    );
  if (unsure.length) parts.push(`Can't tell for ${names(unsure)} yet.`);
  return parts.join(" ");
}

/** A problem with the watch itself, and what to do about it. */
export type WatchProblem = {
  key: "hubstaff" | "ai" | "slack" | "cron" | "run";
  tone: StatusTone;
  text: string;
  /** Where the fix is. */
  action?: "team" | "settings" | "check";
};

const STALE_RUN_MS = 15 * MIN;

/** Every missing or failing piece, in the order to fix them. */
export function problems(b: WatchBoard, now: number): WatchProblem[] {
  const out: WatchProblem[] = [];
  if (!hubstaffReadable(b)) {
    const source = b.open.find(i => i.kind === "source");
    const note = plainNote(
      str(source?.detail.note) ?? b.sources.hubstaff.note,
      HUBSTAFF_CODES,
      "Hubstaff did not answer",
    );
    out.push({
      key: "hubstaff",
      tone: "critical",
      text: `Hubstaff cannot be read: ${note}. Reconnect it in Team & payroll.`,
      action: "team",
    });
  }
  if (!b.cronOn)
    out.push({
      key: "cron",
      tone: "warning",
      text: "The 5-minute check is not scheduled, so nothing is watched on its own. Check now runs it once; the systems manager schedules it.",
      action: "check",
    });
  const last = b.lastRun;
  const anyoneOn = b.people.some(onShift);
  if (!last)
    out.push({
      key: "run",
      tone: "neutral",
      text: "No check has run yet. Check now to run the first.",
      action: "check",
    });
  else if (!last.ok)
    out.push({
      key: "run",
      tone: "warning",
      text: `The last check failed at ${time(ms(last.at))}${last.note ? `: ${plainNote(last.note, HUBSTAFF_CODES, "it stopped before the end")}` : ""}. Check now to try again.`,
      action: "check",
    });
  else if (b.cronOn && anyoneOn && now - (ms(last.at) ?? now) > STALE_RUN_MS)
    out.push({
      key: "run",
      tone: "warning",
      text: `The last check ran at ${time(ms(last.at))}, more than 15 minutes ago. Check now; if it stays old, the 5-minute schedule has stopped.`,
      action: "check",
    });
  if (b.settings.shots) {
    if (b.sources.ai.state === "missing")
      out.push({
        key: "ai",
        tone: "neutral",
        text: AI_KEY_NEEDED,
        action: "settings",
      });
    else if (b.sources.ai.state !== "connected")
      out.push({
        key: "ai",
        tone: "warning",
        text: aiSentence(b.sources.ai, "card"),
        action: "settings",
      });
  }
  if (b.settings.on && b.sources.slack.state === "failing")
    out.push({
      key: "slack",
      tone: "warning",
      text: `Slack refused the last alert: ${slackReason(b.sources.slack.note)}. ${slackFix(b.sources.slack.note)}`,
      action: "settings",
    });
  return out;
}

/** No key saved: provider-neutral, since a saved OpenAI key is used first. */
export const AI_KEY_NEEDED =
  "The screenshot check needs an AI key. Paste an OpenAI or Google AI key in Settings.";

/** The provider the key box starts on: OpenAI, the one the watch tries first. */
export const KEY_PROVIDER_FIRST = "openai" as const;

export function aiName(p: WatchBoard["sources"]["ai"]["provider"]): string {
  return p === "openai" ? "OpenAI" : "Google AI";
}

/**
 * The screenshot check's state in one sentence: on the card (where the fix
 * is "in Settings") or inside the settings sheet (where it is right there).
 */
export function aiSentence(
  ai: WatchBoard["sources"]["ai"],
  where: "card" | "settings",
): string {
  const inSettings = where === "card" ? " in Settings" : "";
  switch (ai.state) {
    case "connected":
      return `Connected: ${aiName(ai.provider)}.`;
    case "refused": {
      const why = plainNote(ai.note, AI_CODES, "");
      return `The ${aiName(ai.provider)} key was refused${why && !/\bwas refused\b/i.test(why) ? `: ${why}` : ""}. Paste a new one${inSettings}.`;
    }
    case "failing":
      return `The screenshot check is failing: ${plainNote(ai.note, AI_CODES, "the last screenshots could not be checked")}. Paste a new key${inSettings}.`;
    default:
      return where === "card"
        ? AI_KEY_NEEDED
        : "No key yet. The screenshot check stays off until one is saved.";
  }
}

/** The Slack line under an open alert. */
export function slackLine(
  state: SlackState,
  error: string | null,
  s: Pick<WatchSettings, "channelName" | "channel">,
): { tone: StatusTone; text: string } {
  const where = s.channelName ? `#${s.channelName}` : s.channel;
  switch (state) {
    case "posted":
      return { tone: "good", text: `Sent to ${where}` };
    case "muted":
      return { tone: "neutral", text: "Alerts are off" };
    case "failed":
      return {
        tone: "warning",
        text: `Slack refused: ${slackReason(error)}`,
      };
    case "unknown":
      return {
        tone: "warning",
        text: "Slack did not answer. It may have arrived, so it is not sent again",
      };
    default:
      return { tone: "neutral", text: `Sending to ${where}` };
  }
}

const KIND_NAME: Record<WatchKind, string> = {
  not_tracking: "Not tracking",
  not_work: "Off work on screen",
  idle: "Timer on, no activity",
  source: "Hubstaff could not be read",
};

/** The people the incidents name, by id. */
export type PeopleById = Map<number, Pick<WatchPerson, "name" | "role">>;

/** The incident's own name first (someone off the roster keeps theirs), then the roster's. */
function who(
  people: PeopleById,
  i: { personId: number | null; name?: string | null },
): string {
  return (
    str(i.name)?.trim() ??
    (i.personId === null ? undefined : people.get(i.personId)?.name) ??
    "Someone"
  );
}

/** What the screenshots the alert rests on showed, from the incident or the person's shots. */
function shotWords(
  detail: Record<string, unknown>,
  shots: WatchShot[],
): { flagged: number | null; of: number | null; labels: string[] } {
  const labels = Array.isArray(detail.labels)
    ? detail.labels.filter((l): l is string => typeof l === "string" && !!l)
    : shots.map(s => s.label).filter((l): l is string => !!l);
  return {
    flagged: numOf(detail.count) ?? numOf(detail.flagged) ?? shots.length,
    of: numOf(detail.of) ?? numOf(detail.total),
    labels: [...new Set(labels)].slice(0, 3),
  };
}

/**
 * One alert in a sentence, like the Slack post without its markup or link,
 * built from the detail the watch recorded (count, total, labels, since,
 * pct, note, reason). `detail.text` is the Slack post itself, with Slack's
 * bold and link syntax, so it is never printed here.
 */
export function incidentSentence(
  i: Pick<WatchIncident, "kind" | "personId" | "openedAt" | "detail"> & {
    name?: string | null;
  },
  people: PeopleById,
  shots: WatchShot[] = [],
): string {
  const d = i.detail;
  const name = who(people, i);
  switch (i.kind) {
    case "not_tracking": {
      if (d.reason === "no_account")
        return `${name} is on shift but is not in Hubstaff yet.`;
      const since = ms(str(d.since)) ?? ms(i.openedAt);
      return `${name} has not had Hubstaff on since ${time(since)}.`;
    }
    case "not_work": {
      // Same words as the Slack post (cockpit-hours-watch/text.ts): one
      // screenshot is "the last screenshot", never "1 of the last 1".
      const w = shotWords(d, shots);
      const count =
        w.of !== null && w.of <= 1
          ? "the last screenshot does not"
          : w.flagged !== null && w.of !== null
            ? `${w.flagged} of the last ${w.of} screenshots ${w.flagged === 1 ? "does" : "do"} not`
            : w.flagged === 1
              ? "the last screenshot does not"
              : `${w.flagged ?? "Recent"} recent screenshots do not`;
      return `${name}: ${count} look like work${w.labels.length ? ` (${w.labels.join(", ")})` : ""}.`;
    }
    case "idle": {
      const since = ms(str(d.since)) ?? ms(i.openedAt);
      const pct = numOf(d.activePct) ?? numOf(d.pct);
      return pct === null
        ? `${name}: Hubstaff has been running since ${time(since)} with almost no keyboard and mouse activity.`
        : `${name}: Hubstaff has been running since ${time(since)} with ${pctDown(pct)} keyboard and mouse activity.`;
    }
    default:
      return `Hubstaff watch cannot read Hubstaff: ${plainNote(d.note, HUBSTAFF_CODES, "Hubstaff did not answer")}. Nobody is being watched until it can.`;
  }
}

/** The screenshots an open not-work alert rests on, newest first. */
export function incidentShots(
  i: Pick<WatchIncident, "kind" | "personId" | "openedAt" | "detail">,
  person: WatchPerson | undefined,
  windowMinutes: number,
): WatchShot[] {
  if (i.kind !== "not_work" || !person) return [];
  const ids = Array.isArray(i.detail.shots)
    ? new Set(i.detail.shots.map(Number))
    : Array.isArray(i.detail.shotIds)
      ? new Set(i.detail.shotIds.map(Number))
      : null;
  const from = (ms(i.openedAt) ?? 0) - windowMinutes * MIN;
  return person.shots
    .filter(s =>
      ids ? ids.has(s.id) : s.verdict === "not_work" && (ms(s.at) ?? 0) >= from,
    )
    .sort((a, z) => (ms(z.at) ?? 0) - (ms(a.at) ?? 0));
}

/** How a closed alert ended, by the close reason the watch recorded. */
function closedHow(r: WatchRecent): string {
  switch (r.closeReason) {
    case "shift_ended":
      return "Shift ended.";
    case "not_watched":
      return "No longer watched.";
    case "read_ok":
      return "Hubstaff can be read again.";
    case "linked":
      return "In Hubstaff now.";
    case "back":
      return "Back on Hubstaff.";
    case "active":
      return "Activity back above the floor.";
    case "work":
      return "No more screenshots off work.";
    case "not_judged":
      return "Too little time on the computer to judge activity.";
    default:
      return "Closed.";
  }
}

/** One closed alert, quietly: when, who, what, how long, how it ended. */
export function recentSentence(r: WatchRecent, people: PeopleById): string {
  const opened = ms(r.openedAt);
  const closed = ms(r.closedAt);
  const span =
    opened !== null && closed !== null
      ? ` (${minutes(Math.max(1, Math.round((closed - opened) / MIN)))})`
      : "";
  const when = `${time(opened)} to ${time(closed)}${span}`;
  if (r.kind === "source")
    return `Hubstaff could not be read, ${when}. ${closedHow(r)}`;
  const what =
    r.kind === "not_tracking" && r.detail.reason === "no_account"
      ? "not in Hubstaff"
      : KIND_NAME[r.kind].toLowerCase();
  return `${who(people, r)}: ${what}, ${when}. ${closedHow(r)}`;
}

/** "Mon 12 Oct" for a day that is not today, else "Today". */
export function dayLabel(iso: string, now: number): string {
  const at = ms(iso);
  if (at === null) return "";
  const day = (v: number) => new Date(v + KUWAIT_MS).toISOString().slice(0, 10);
  if (day(at) === day(now)) return "Today";
  if (day(at) === day(now - 24 * HOUR)) return "Yesterday";
  return new Date(at + KUWAIT_MS).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** The figures beside each row. Missing is said as n/a by the formatters, never 0. */
export function figures(p: WatchPerson): { tracked: string; active: string } {
  return {
    tracked: p.trackedTodayS === null ? "n/a" : hm(p.trackedTodayS),
    active:
      p.activePct30m === null
        ? "n/a"
        : pctDown(Math.max(0, Math.min(100, p.activePct30m))),
  };
}

// --- The shift line ---

export type LineSegment = {
  kind: "outside" | "shift" | "leave" | "tracked" | "idle" | "gap" | "unread";
  from: number;
  to: number;
  /**
   * Keyboard and mouse over keyboard-and-mouse time, 0 to 1, for a tracked
   * block; phone and web timer time alone is the middle shade.
   */
  activity?: number | null;
  /** A tracked or idle block outside the shift. */
  outside?: boolean;
};

export type LineTick = {
  id: number;
  at: number;
  shot: WatchShot;
};

export type LineModel = {
  from: number;
  to: number;
  shift: { start: number; end: number } | null;
  segments: LineSegment[];
  ticks: LineTick[];
  now: number | null;
  hours: number[];
  summary: string;
};

/** The shade of a block made only of phone or web timer time (no activity level). */
export const PHONE_ACTIVITY = 0.5;

/**
 * How busy a tracked block was, 0 to 1: keyboard and mouse over the time
 * tracked with them (`inputTrackedS`), so phone time never reads as idle.
 * Without `inputTrackedS` it falls back to over all tracked time.
 */
export function slotActivity(slot: WatchSlot): number | null {
  if (slot.idle || slot.trackedS <= 0) return null;
  const input = slot.inputTrackedS;
  if (input !== null && input <= 0) return PHONE_ACTIVITY;
  const base = input !== null ? Math.min(input, slot.trackedS) : slot.trackedS;
  return Math.max(0, Math.min(1, slot.overallS / base));
}

/** Part-day leave as instants, inside the shift, oldest first. */
function leaveWindows(
  p: WatchPerson,
  shift: { start: number; end: number } | null,
): { from: number; to: number }[] {
  if (!shift) return [];
  return p.leave
    .map(l => ({
      from: Math.max(ms(l.start) ?? 0, shift.start),
      to: Math.min(ms(l.end) ?? 0, shift.end),
    }))
    .filter(l => l.to > l.from)
    .sort((a, z) => a.from - z.from);
}

/** [a, z) less the leave windows, as the pieces that remain. */
function minusLeave(
  a: number,
  z: number,
  leave: { from: number; to: number }[],
): [number, number][] {
  let pieces: [number, number][] = [[a, z]];
  for (const l of leave)
    pieces = pieces.flatMap(([x, y]): [number, number][] =>
      l.to <= x || l.from >= y
        ? [[x, y]]
        : [
            ...(l.from > x ? [[x, l.from] as [number, number]] : []),
            ...(l.to < y ? [[l.to, y] as [number, number]] : []),
          ],
    );
  return pieces.filter(([x, y]) => y > x);
}

/** One time range for every row, so the bars line up: whole hours, an hour of margin. */
export function lineDomain(
  people: WatchPerson[],
  now: number,
): { from: number; to: number } {
  const points: number[] = [];
  for (const p of people) {
    const s = ms(p.shiftStart);
    const e = ms(p.shiftEnd);
    if (s !== null) points.push(s);
    if (e !== null) points.push(e);
    for (const slot of p.slots) {
      const at = ms(slot.start);
      if (at !== null && slot.trackedS > 0) points.push(at, at + SLOT);
    }
  }
  const dayStart =
    Math.floor((now + KUWAIT_MS) / (24 * HOUR)) * 24 * HOUR - KUWAIT_MS;
  if (!points.length)
    return { from: dayStart + 9 * HOUR, to: dayStart + 19 * HOUR };
  const lo = Math.floor(Math.min(...points) / HOUR) * HOUR - HOUR;
  const hi = Math.ceil(Math.max(...points) / HOUR) * HOUR + HOUR;
  return {
    from: Math.max(lo, dayStart),
    to: Math.min(hi, dayStart + 24 * HOUR),
  };
}

/**
 * The shift line for one person: the shift's track, the time outside it, the
 * tracked blocks (opacity follows keyboard and mouse), idle blocks, gaps past
 * the grace, the time Hubstaff has not sent yet, not-work ticks and the now
 * needle. A block counts as read only up to `readAt - 20 min` (Hubstaff's
 * data arrives up to 20 minutes late); after that, or with no `readAt`, it
 * is unread, never a gap. `known` false (Hubstaff cannot be read, or the
 * watch cannot tell) turns all untracked time into unread.
 */
export function buildLine(
  p: WatchPerson,
  domain: { from: number; to: number },
  now: number,
  graceMinutes: number,
  known = true,
): LineModel {
  const { from, to } = domain;
  const clip = (a: number, z: number) => [Math.max(from, a), Math.min(to, z)];
  const segments: LineSegment[] = [];
  const start = ms(p.shiftStart);
  const end = ms(p.shiftEnd);
  const shift =
    start !== null && end !== null && end > start ? { start, end } : null;
  const push = (seg: LineSegment) => {
    const [a, z] = clip(seg.from, seg.to);
    if (z > a) segments.push({ ...seg, from: a, to: z });
  };

  if (shift) {
    push({ kind: "outside", from, to: shift.start });
    push({ kind: "shift", from: shift.start, to: shift.end });
    push({ kind: "outside", from: shift.end, to });
  } else push({ kind: "outside", from, to });

  // Part-day leave is off time: the de-emphasised fill, never a gap.
  const leave = leaveWindows(p, shift);
  for (const l of leave) push({ kind: "leave", from: l.from, to: l.to });

  const tracked = new Map<number, (typeof p.slots)[number]>();
  for (const slot of p.slots) {
    const at = ms(slot.start);
    if (at === null || slot.trackedS <= 0) continue;
    tracked.set(at, slot);
    const outside = !shift || at + SLOT <= shift.start || at >= shift.end;
    push({
      kind: slot.idle ? "idle" : "tracked",
      from: at,
      to: at + SLOT,
      activity: slotActivity(slot),
      outside,
    });
  }

  // Untracked time in the shift, past the grace, up to now: a gap, or unread
  // when Hubstaff has not sent it yet or cannot be read.
  const offToday = p.offReason !== null;
  if (shift && !offToday) {
    const graceEnd = shift.start + graceMinutes * MIN;
    const stop = Math.min(now, shift.end);
    const read = ms(p.readAt);
    const readUpTo =
      read === null
        ? Number.NEGATIVE_INFINITY
        : Math.min(read, now) - ACTIVITY_LAG_MS;
    // Back from part-day leave, the grace applies again, as at the shift's start.
    const away = leave.map(l => ({
      from: l.from,
      to: Math.min(shift.end, l.to + graceMinutes * MIN),
    }));
    const runs: LineSegment[] = [];
    for (let t = Math.floor(shift.start / SLOT) * SLOT; t < stop; t += SLOT) {
      const a = Math.max(t, graceEnd, shift.start);
      const z = Math.min(t + SLOT, stop);
      if (tracked.has(t) || z <= a) continue;
      const kind: LineSegment["kind"] =
        !known || t + SLOT > readUpTo ? "unread" : "gap";
      for (const [x, y] of minusLeave(a, z, away)) {
        const last = runs.at(-1);
        if (last && last.kind === kind && last.to === x) last.to = y;
        else runs.push({ kind, from: x, to: y });
      }
    }
    for (const run of runs) push(run);
  }

  const ticks: LineTick[] = p.shots
    .filter(s => s.verdict === "not_work")
    .map(s => ({ id: s.id, at: ms(s.at) ?? 0, shot: s }))
    .filter(t => t.at >= from && t.at <= to)
    .sort((a, z) => a.at - z.at);

  const hours: number[] = [];
  for (let h = Math.ceil(from / HOUR) * HOUR; h <= to; h += HOUR) hours.push(h);

  return {
    from,
    to,
    shift,
    segments,
    ticks,
    now: now >= from && now <= to ? now : null,
    hours,
    summary: lineSummary(p, shift, segments, ticks, now),
  };
}

/** The bar read aloud: the shift, what was tracked, the gaps, the screenshots, now. */
function lineSummary(
  p: WatchPerson,
  shift: LineModel["shift"],
  segments: LineSegment[],
  ticks: LineTick[],
  now: number,
): string {
  const out: string[] = [
    shift
      ? `Shift ${time(shift.start)} to ${time(shift.end)}.`
      : "No shift today.",
  ];
  const leave = segments.filter(s => s.kind === "leave");
  if (leave.length)
    out.push(
      `On leave ${leave.map(l => `${time(l.from)} to ${time(l.to)}`).join(", ")}.`,
    );
  const trackedMs = segments
    .filter(s => s.kind === "tracked" || s.kind === "idle")
    .reduce((sum, s) => sum + (s.to - s.from), 0);
  // Unknown tracked time is said as unknown, never as nothing.
  out.push(
    p.trackedTodayS === null
      ? trackedMs
        ? `Tracked ${hm(trackedMs / 1000)} in the blocks shown.`
        : "Tracked time can't be read yet."
      : p.trackedTodayS > 0
        ? `Tracked ${hm(p.trackedTodayS)} today.`
        : "Nothing tracked yet.",
  );
  const gaps = segments.filter(s => s.kind === "gap");
  if (gaps.length)
    out.push(
      `Not tracked ${gaps
        .slice(0, 3)
        .map(g => `${time(g.from)} to ${time(g.to)}`)
        .join(", ")}${gaps.length > 3 ? ` and ${gaps.length - 3} more` : ""}.`,
    );
  const idle = segments.filter(s => s.kind === "idle");
  if (idle.length)
    out.push(
      `${plural(idle.length, "block")} with the timer on and no activity.`,
    );
  if (segments.some(s => s.kind === "unread"))
    out.push("The latest minutes are not in from Hubstaff yet.");
  if (ticks.length) out.push(`${plural(ticks.length, "screenshot")} off work.`);
  out.push(`Now ${time(now)}.`);
  return out.join(" ");
}

/** Ticks closer than this on screen merge into one button. */
export const TICK_MERGE_PX = 12;
/** The bar's width on a 390 px phone, used until the real width is measured. */
export const PHONE_BAR_PX = 326;

/** One button above the bar: a single screenshot, or several too close to tap apart. */
export type TickGroup = {
  key: string;
  /** Oldest and newest screenshot in the group. */
  from: number;
  to: number;
  ticks: LineTick[];
};

/**
 * The ticks as buttons for a bar `widthPx` wide: a tick closer than
 * `minPx` to the one before it joins that one's group, so no two buttons sit
 * closer than a finger can tell apart.
 */
export function tickGroups(
  line: Pick<LineModel, "from" | "to" | "ticks">,
  widthPx: number,
  minPx = TICK_MERGE_PX,
): TickGroup[] {
  const px = (at: number) => (pctOf(at, line) * Math.max(1, widthPx)) / 100;
  const out: TickGroup[] = [];
  for (const t of [...line.ticks].sort((a, z) => a.at - z.at)) {
    const last = out.at(-1);
    if (last && px(t.at) - px(last.to) < minPx) {
      last.ticks.push(t);
      last.to = t.at;
    } else out.push({ key: `t${t.id}`, from: t.at, to: t.at, ticks: [t] });
  }
  return out;
}

/** Position on the bar, in percent. */
export function pctOf(
  at: number,
  line: Pick<LineModel, "from" | "to">,
): number {
  return ((at - line.from) / Math.max(1, line.to - line.from)) * 100;
}

/** The hour label under the bar: "10", "14". */
export function hourLabel(at: number): string {
  return time(at).slice(0, 2);
}

/** Why the card has nothing to show, and what to do. */
export function boardErrorText(message: string): string {
  if (/could not find the function|does not exist|schema cache/i.test(message))
    return "Hubstaff watch is not set up on the server yet. It appears here once its migration is applied.";
  if (/founder access|only the ceo/i.test(message))
    return "Only the CEO can see Hubstaff watch. Sign in again as the CEO.";
  // The client's own sentences already say what to do.
  if (/^Hubstaff watch /.test(message.trim())) return message.trim();
  return `Hubstaff watch could not be read: ${strip(message) || "no answer"}. Open the page again in a minute.`;
}
