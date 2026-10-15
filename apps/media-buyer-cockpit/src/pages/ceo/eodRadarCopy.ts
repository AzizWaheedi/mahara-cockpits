/**
 * EOD Radar's words and days (pure, for the tests): which working days the
 * grid shows, what each dot says, and every missing or failing sentence the
 * card prints. Plain, active, no em dashes.
 */
import { date, plural, relative, time } from "@/components/ceo/format";
import type { StatusTone } from "@/components/ceo/StatusChip";
import type {
  EodCredit,
  EodDay,
  EodPerson,
  EodRadarBoard,
  EodStatus,
} from "@/types/ceo/eodRadar";

/** How many working days the grid shows: today and the 14 before it. */
export const GRID_DAYS = 15;
/** A run older than this is called out: the job runs every 30 minutes. */
export const STALE_RUN_MS = 90 * 60_000;

const KUWAIT_MS = 3 * 3600_000;
const DAY_MS = 86_400_000;

/** The EOD working day at an instant: Kuwait time minus 4 hours. */
export function radarToday(nowMs: number): string {
  return new Date(nowMs + KUWAIT_MS - 4 * 3600_000).toISOString().slice(0, 10);
}

const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
export const isFriday = (day: string) =>
  new Date(`${day}T00:00:00Z`).getUTCDay() === 5;

/** The last `n` working days (Saturday to Thursday) up to and including `today`, oldest first. */
export function workingDays(today: string, n = GRID_DAYS): string[] {
  const out: string[] = [];
  for (let d = today; out.length < n; d = addDays(d, -1))
    if (!isFriday(d)) out.push(d);
  return out.reverse();
}

/** The read's window for the grid: the first and last of those days. */
export function gridWindow(nowMs: number): { from: string; to: string } {
  const days = workingDays(radarToday(nowMs));
  return { from: days[0], to: days[days.length - 1] };
}

const WEEKDAY = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
export const weekdayShort = (day: string) =>
  WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()];
export const dayNumber = (day: string) => String(Number(day.slice(8, 10)));

export const STATUS_LABEL: Record<EodStatus, string> = {
  on_time: "On time",
  late: "Late",
  missed: "Missed",
  pending: "Not in yet",
  leave: "On leave",
  off: "Day off",
  not_read: "Not read",
};

/** The dot's colour, on the CEO kit's tones; the shape says the rest (see the card). */
export const STATUS_TONE: Record<EodStatus, StatusTone> = {
  on_time: "good",
  late: "warning",
  missed: "serious",
  pending: "neutral",
  leave: "neutral",
  off: "neutral",
  not_read: "neutral",
};

const CREDIT_TEXT: Record<EodCredit, string> = {
  poster: "posted by them",
  submitted_by: "Submitted by line",
  name_line: "Name line",
  cockpit_outbox: "filed in the cockpit",
};

/** "28 min", "2 h 7 min", "1 day 3 h". */
export function lateText(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return `${plural(d, "day")}${rh ? ` ${rh} h` : ""}`;
}

/** "22:27", or "Thu 15 Oct, 12:16" when it was not on the EOD day. */
function postedText(iso: string, day: string): string {
  const ms = Date.parse(iso);
  const local = new Date(ms + KUWAIT_MS).toISOString().slice(0, 10);
  return local === day ? time(ms) : `${date(ms)}, ${time(ms)}`;
}

/** What one dot says: "Wed 14 Oct: late by 28 min, posted 22:27 (Submitted by line)". */
export function daySentence(day: string, d: EodDay | undefined): string {
  const when = date(day);
  if (!d) return `${when}: not checked yet`;
  if (d.status === "on_time" || d.status === "late") {
    const lead =
      d.status === "late" && d.lateMinutes
        ? `late by ${lateText(d.lateMinutes)}`
        : "on time";
    const posted = d.postedAt
      ? `, ${d.creditedBy === "cockpit_outbox" ? "filed" : "posted"} ${postedText(d.postedAt, day)}`
      : "";
    const by = d.creditedBy ? ` (${CREDIT_TEXT[d.creditedBy]})` : "";
    const extra = [d.quality, d.note].filter(Boolean).join(". ");
    return `${when}: ${lead}${posted}${by}${extra ? `. ${extra}` : ""}`;
  }
  const label = STATUS_LABEL[d.status].toLowerCase();
  return d.note ? `${when}: ${label}. ${d.note}` : `${when}: ${label}`;
}

export type Tally = {
  onTime: number;
  late: number;
  missed: number;
  due: number;
};

/** On time, late and missed over the grid's days; due counts every day that was owed and settled. */
export function tally(person: EodPerson, days: string[]): Tally {
  const by = new Map(person.days.map(d => [d.day, d]));
  const t: Tally = { onTime: 0, late: 0, missed: 0, due: 0 };
  for (const day of days) {
    const s = by.get(day)?.status;
    if (s === "on_time") t.onTime++;
    else if (s === "late") t.late++;
    else if (s === "missed") t.missed++;
    else continue;
    t.due++;
  }
  return t;
}

/** "11 on time, 2 late, 1 missed"; nothing owed reads as such. */
export function tallyText(t: Tally): string {
  if (!t.due) return "Nothing owed yet";
  const parts = [`${t.onTime} on time`];
  if (t.late) parts.push(`${t.late} late`);
  if (t.missed) parts.push(`${t.missed} missed`);
  return parts.join(", ");
}

/** The one line under the title: when it last looked, and what it will and will not do. */
export function settingsLine(board: EodRadarBoard): string {
  const s = board.settings;
  const nudges =
    s.remindersOn || s.strikesOn
      ? "Reminders or strikes are on"
      : "Reminders and strikes are off";
  const digest = s.digestOn
    ? `the closeout post goes to #${s.digestChannelName} at ${s.closeoutAt}`
    : "the closeout post is off";
  return `${nudges}. Late after ${s.lateAt}, and ${digest}.`;
}

/** "Checked 12 min ago", or that it has not run. */
export function checkedLine(board: EodRadarBoard, nowMs: number): string {
  const at = board.sync?.lastRunAt
    ? Date.parse(board.sync.lastRunAt)
    : Number.NaN;
  return Number.isFinite(at) ? `Checked ${relative(at, nowMs)}` : "Not run yet";
}

/** What a channel refusal means for a person to do. */
export function channelFix(name: string, error: string | null): string {
  const e = error ?? "unknown";
  if (e === "missing_scope")
    return `Could not read #${name}: the Slack app needs the groups:history scope. Add it to mahara-club-bot in the Slack app settings and reinstall the app.`;
  if (e === "not_in_channel" || e === "channel_not_found")
    return `Could not read #${name}: the bot is not in it. Invite @mahara-club-bot to #${name}.`;
  if (e === "no_token")
    return "Could not read any EOD channel: SLACK_BOT_TOKEN is not set on the eod-radar function. Set it to mahara-club-bot's token.";
  if (
    [
      "invalid_auth",
      "not_authed",
      "token_revoked",
      "token_expired",
      "account_inactive",
    ].includes(e)
  )
    return `Could not read #${name}: Slack refused the token (${e}). Check SLACK_BOT_TOKEN on the eod-radar function.`;
  return `Could not read #${name} (${e}). The next run tries again in 30 minutes.`;
}

export type Problem = { tone: StatusTone; text: string };

/**
 * Every line the card owes the reader, most serious first: never run, a stale
 * run, channels that could not be read (their people read "not read", never
 * missed), a missing scope, posts that named nobody, people with no Slack id,
 * roles with no EOD channel, and a closeout post that did not go out.
 */
export function problems(board: EodRadarBoard, nowMs: number): Problem[] {
  const out: Problem[] = [];
  const sync = board.sync;
  if (!sync) {
    out.push({
      tone: "warning",
      text:
        board.kick && !board.kick.ok && board.kick.note
          ? `EOD Radar has not run yet. ${board.kick.note}`
          : "EOD Radar has not run yet. It runs every 30 minutes once the eod-radar function is deployed and its migration applied.",
    });
  } else {
    const at = sync.lastRunAt ? Date.parse(sync.lastRunAt) : Number.NaN;
    if (Number.isFinite(at) && nowMs - at > STALE_RUN_MS)
      out.push({
        tone: "warning",
        text: `The last run was ${relative(at, nowMs)}, so these days may be behind. ${board.kick && !board.kick.ok && board.kick.note ? board.kick.note : "The half-hour job may be stopped: check mahara-eod-radar."}`,
      });
    const tokenless = sync.channels.find(c => c.error === "no_token");
    if (tokenless)
      out.push({
        tone: "warning",
        text: channelFix(tokenless.name, "no_token"),
      });
    else
      for (const c of sync.channels)
        if (!c.ok)
          out.push({ tone: "warning", text: channelFix(c.name, c.error) });
    const missing = (sync.missingScopes ?? []).filter(
      s =>
        s !== "groups:history" ||
        !sync.channels.some(c => c.error === "missing_scope"),
    );
    if (missing.length)
      out.push({
        tone: "warning",
        text: `The Slack token lacks ${missing.join(", ")}. ${missing.includes("users:read.email") ? "Slack ids are not refreshed by email; the saved ids are used." : "Add it to mahara-club-bot and reinstall the app."}`,
      });
    if (sync.unmatched.length) {
      const named = sync.unmatched.find(u => u.name);
      out.push({
        tone: "neutral",
        text: `${plural(sync.unmatched.length, "EOD post")} named nobody on the radar${named ? `, such as "${named.name}"` : ""}, so ${sync.unmatched.length === 1 ? "it was" : "they were"} not credited. A full name on the form fixes it.`,
      });
    }
  }
  const unlinked = board.people.filter(p => p.active && !p.slackLinked);
  if (unlinked.length)
    out.push({
      tone: "neutral",
      text: `No Slack id for ${unlinked.map(p => p.name).join(", ")}: only posts that carry their Name line are found, and a day with none reads "not read". Add their email on the roster.`,
    });
  if (board.notTracked.length)
    out.push({
      tone: "neutral",
      text: `Not on the radar: ${board.notTracked.map(p => `${p.name}${p.role ? ` (${p.role})` : ""}`).join(", ")}. Their role has no EOD channel.`,
    });
  const last = board.digests[0];
  if (last && (last.state === "failed" || last.state === "unknown"))
    out.push({
      tone: "warning",
      text: `The closeout post for ${date(last.day)} ${last.state === "failed" ? `was refused (${last.error ?? "no reason given"})` : "may not have arrived; it is not sent twice"}.`,
    });
  return out;
}

/** The last closeout post, in a few words, for the foot of the card. */
export function digestLine(board: EodRadarBoard): string | null {
  const last = board.digests[0];
  if (!last)
    return board.settings.digestOn ? null : "The closeout post is off.";
  if (last.state === "posted")
    return `Last closeout post: ${date(last.day)}, in #${board.settings.digestChannelName}.`;
  if (last.state === "sending")
    return `Posting the closeout for ${date(last.day)}.`;
  return null;
}
