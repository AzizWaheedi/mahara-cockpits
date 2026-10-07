/**
 * The rules of the team meetings, with nothing around them: no Convex, no
 * network. The server (team.ts, teamCalendar.ts), the screen and the tests
 * (scripts/team.test.ts) all use these, so a rule is written once.
 *
 * Team meetings v5, 2026-09-27: the run of show, the wheels, the creative
 * pipeline, and a meeting's Google Calendar series edited from the cockpit.
 */

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const RRULE_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DAY_MS = 86_400_000;

export function clean(s: unknown, max: number): string {
  return String(s ?? "")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, max);
}

// --- days and times --------------------------------------------------------------

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

/** "Thu 25 Sep" from "2026-09-25". */
export function dayLabel(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "13:30" from "13:30:00" or "13:30". */
export function hhmm(time: string | null | undefined): string {
  return String(time ?? "").slice(0, 5);
}

export function addMinutes(time: string, minutes: number): string {
  const [h, m] = hhmm(time).split(":").map(Number);
  const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Minutes the zone is ahead of UTC at a moment. Kuwait has no daylight
 * saving, but a meeting keeps its own time zone, so this asks Intl.
 */
export function zoneOffset(tz: string, atMs: number): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(atMs));
    const get = (t: string) => Number(parts.find(p => p.type === t)?.value);
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
    );
    return Math.round((asUtc - Math.floor(atMs / 60_000) * 60_000) / 60_000);
  } catch {
    return 180; // Asia/Kuwait
  }
}

/** A wall-clock day and time in a zone, as an instant. */
export function zonedToUtc(day: string, time: string, tz: string): Date {
  const guess = Date.parse(`${day}T${hhmm(time)}:00Z`);
  const offset = zoneOffset(tz, guess);
  const at = guess - offset * 60_000;
  // Once more at the found instant, for a zone that changed its offset.
  return new Date(guess - zoneOffset(tz, at) * 60_000);
}

/** An instant as the zone's wall-clock day, time and weekday. */
export function utcToZoned(
  iso: string | number | Date,
  tz: string,
): { day: string; time: string; weekday: number } {
  const ms = new Date(iso).getTime();
  const local = new Date(ms + zoneOffset(tz, ms) * 60_000);
  const text = local.toISOString();
  return {
    day: text.slice(0, 10),
    time: text.slice(11, 16),
    weekday: local.getUTCDay(),
  };
}

/** Google's dateTime for a wall-clock time: "2026-10-04T13:30:00" with a zone. */
export function wallClock(day: string, time: string): string {
  return `${day}T${hhmm(time)}:00`;
}

/** The first day on or after `from` that falls on one of `days`. */
export function nextOn(days: number[], from: string): string {
  for (let i = 0; i < 7; i++) {
    const d = addDays(from, i);
    if (days.includes(weekdayOf(d))) return d;
  }
  return from;
}

/** "Sun and Thu, 13:30 to 14:00, Kuwait time". */
export function seriesLine(s: {
  weekdays: number[] | null;
  startTime: string | null;
  minutes: number | null;
  tz?: string | null;
  rrule?: string | null;
  onDay?: string | null;
}): string {
  const zone =
    !s.tz || s.tz === "Asia/Kuwait"
      ? "Kuwait time"
      : s.tz.replace(/^.*\//, "").replace(/_/g, " ");
  const time =
    s.startTime && s.minutes
      ? `${hhmm(s.startTime)} to ${addMinutes(s.startTime, s.minutes)}, ${zone}`
      : "no time set";
  const freq = rruleParts(s.rrule ?? null).FREQ;
  if (freq === "MONTHLY") return `Monthly, ${time}`;
  if (s.weekdays?.length) {
    const days = [...s.weekdays].sort((a, b) => a - b).map(d => DAY_NAMES[d]);
    const list =
      days.length === 5 && s.weekdays.every(d => d <= 4)
        ? "Sun to Thu"
        : days.length > 1
          ? `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}`
          : days[0];
    const every =
      rruleParts(s.rrule ?? null).INTERVAL === "2" ? "Every other " : "";
    return `${every}${list}, ${time}`;
  }
  if (s.onDay) return `Once, ${dayLabel(s.onDay)}, ${time}`;
  return time === "no time set" ? "No time set yet" : `Once, ${time}`;
}

// --- RRULE ---------------------------------------------------------------------

export function rruleParts(rrule: string | null): Record<string, string> {
  if (!rrule) return {};
  const body = /^RRULE:/i.test(rrule) ? rrule.slice(6) : rrule;
  const out: Record<string, string> = {};
  for (const part of body.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).toUpperCase()] = part.slice(i + 1);
  }
  return out;
}

export function weekdaysOfRrule(rrule: string | null): number[] | null {
  const p = rruleParts(rrule);
  if (p.FREQ !== "WEEKLY" || !p.BYDAY) return null;
  return [
    ...new Set(
      p.BYDAY.split(",")
        .map(d => RRULE_DAYS.indexOf(d.slice(-2)))
        .filter(d => d >= 0),
    ),
  ].sort((a, b) => a - b);
}

/** The instant a series must end by for `lastDay` to be its last day. */
export function untilStamp(lastDay: string, tz: string): string {
  const end = zonedToUtc(addDays(lastDay, 1), "00:00", tz).getTime() - 1000;
  return new Date(end)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

/**
 * A weekly RRULE on these days, built on the series' own rule so whatever
 * else it says (every other week, the first day of the week) is kept. The
 * end: `until` undefined keeps the rule's own (UNTIL or COUNT), "" drops
 * it, a day makes that day the last.
 */
export function buildRrule(o: {
  weekdays: number[];
  base?: string | null;
  until?: string;
  tz?: string;
}): string {
  const p = rruleParts(o.base ?? null);
  const keep = Object.entries(p)
    .filter(([k]) => !["FREQ", "BYDAY", "UNTIL", "COUNT"].includes(k))
    .map(([k, v]) => `${k}=${v}`);
  const days = [...new Set(o.weekdays)]
    .sort((a, b) => a - b)
    .map(d => RRULE_DAYS[d]);
  let end: string[] = [];
  if (o.until === undefined) {
    if (p.UNTIL) end = [`UNTIL=${p.UNTIL}`];
    else if (p.COUNT) end = [`COUNT=${p.COUNT}`];
  } else if (o.until) {
    end = [`UNTIL=${untilStamp(o.until, o.tz ?? "Asia/Kuwait")}`];
  }
  return `RRULE:${["FREQ=WEEKLY", ...keep, ...end, `BYDAY=${days.join(",")}`].join(";")}`;
}

/** The same rule, ending on `lastDay`. */
export function endRrule(rrule: string, lastDay: string, tz: string): string {
  const p = rruleParts(rrule);
  const keep = Object.entries(p).filter(
    ([k]) => !["UNTIL", "COUNT"].includes(k),
  );
  return `RRULE:${[...keep.map(([k, v]) => `${k}=${v}`), `UNTIL=${untilStamp(lastDay, tz)}`].join(";")}`;
}

// --- changing a series -------------------------------------------------------------

export type SeriesChange = {
  weekdays: number[];
  startTime: string;
  minutes: number;
  /** The first sitting the change applies to. */
  from: string;
};

export type SeriesNow = {
  /** The series' own start, as Google holds it: its first occurrence. */
  startDay: string;
  rrule: string | null;
  tz: string;
};

export type SeriesPlan =
  | {
      mode: "patch";
      start: string; // wall clock
      end: string;
      recurrence: string[] | null;
    }
  | {
      mode: "split";
      /** The old series' rule, ending the day before `from`. */
      oldRecurrence: string[];
      newStartDay: string;
      start: string;
      end: string;
      recurrence: string[];
    };

/**
 * What a change of days, time or length does to a Google series.
 *
 * From the next sitting (or earlier): the series itself changes, so every
 * sitting moves. From a later date: "this and following", the old series
 * ends the day before and a new one starts on the first new day on or after
 * `from`, with the same title, guests and Meet link (the caller copies
 * those). The sittings, notes and spins before it stay with the meeting.
 */
export function planSeriesChange(
  now: SeriesNow,
  change: SeriesChange,
  nextSitting: string | null,
): SeriesPlan {
  const freq = rruleParts(now.rrule).FREQ;
  const at = (day: string) => ({
    start: wallClock(day, change.startTime),
    end: endOf(day, change.startTime, change.minutes),
  });
  // A single event: the same day at the new time, or a series from now on.
  if (!now.rrule) {
    if (!change.weekdays.length)
      return { mode: "patch", ...at(now.startDay), recurrence: null };
    return {
      mode: "patch",
      ...at(nextOn(change.weekdays, change.from)),
      recurrence: [buildRrule({ weekdays: change.weekdays })],
    };
  }
  // A monthly (or other) rule keeps its rule: only the time and length move.
  if (freq !== "WEEKLY")
    return { mode: "patch", ...at(now.startDay), recurrence: [now.rrule] };
  if (!nextSitting || change.from <= nextSitting)
    return {
      mode: "patch",
      ...at(nextOn(change.weekdays, now.startDay)),
      recurrence: [buildRrule({ weekdays: change.weekdays, base: now.rrule })],
    };
  const newStartDay = nextOn(change.weekdays, change.from);
  return {
    mode: "split",
    oldRecurrence: [endRrule(now.rrule, addDays(change.from, -1), now.tz)],
    newStartDay,
    ...at(newStartDay),
    recurrence: [buildRrule({ weekdays: change.weekdays, base: now.rrule })],
  };
}

/** Do not split or notify an unchanged part of a multi-day series. */
export function seriesUnchanged(
  now: {
    start_time: string | null;
    minutes: number | null;
    weekdays: number[] | null;
  },
  change: { weekdays: number[]; startTime: string; minutes: number },
): boolean {
  if (!now.start_time || now.minutes === null) return false;
  const days = (d: number[] | null) =>
    [...new Set(d ?? [])].sort((a, b) => a - b).join(",");
  return (
    hhmm(now.start_time) === hhmm(change.startTime) &&
    now.minutes === change.minutes &&
    days(now.weekdays) === days(change.weekdays)
  );
}

/** Ending before the first sitting cancels it rather than retaining DTSTART. */
export function endPlan(
  rrule: string | null,
  firstDay: string | null,
  lastDay: string,
): "cancel" | "until" | "keep" {
  if (firstDay && firstDay > lastDay) return "cancel";
  return rrule ? "until" : "keep";
}

/** The wall-clock end of a sitting, over midnight if it must. */
export function endOf(day: string, start: string, minutes: number): string {
  const [h, m] = hhmm(start).split(":").map(Number);
  const total = h * 60 + m + minutes;
  const endDay = addDays(day, Math.floor(total / 1440));
  const t = total % 1440;
  return wallClock(
    endDay,
    `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`,
  );
}

// --- guests ------------------------------------------------------------------------

export type Attendee = {
  email: string;
  optional?: boolean;
  organizer?: boolean;
  responseStatus?: string;
  displayName?: string;
  self?: boolean;
  resource?: boolean;
};

export type GuestChange =
  | { email: string; action: "add"; optional: boolean }
  | { email: string; action: "remove" }
  | { email: string; action: "part"; optional: boolean };

/**
 * The guest list after the page's changes. Everyone else stays exactly as
 * Google had them (answers included), the organiser is never taken off,
 * and an address appears once.
 */
export function applyGuestChanges(
  current: Attendee[],
  changes: GuestChange[],
  organizer: string,
): Attendee[] {
  const org = organizer.toLowerCase();
  const out: Attendee[] = [];
  const seen = new Set<string>();
  for (const a of current) {
    const key = a.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...a });
  }
  for (const c of changes) {
    const key = c.email.toLowerCase();
    const i = out.findIndex(a => a.email.toLowerCase() === key);
    if (c.action === "remove") {
      if (i >= 0 && key !== org && !out[i].organizer) out.splice(i, 1);
      continue;
    }
    if (i >= 0) {
      if (key !== org && !out[i].organizer) out[i].optional = c.optional;
      continue;
    }
    if (c.action === "add") out.push({ email: c.email, optional: c.optional });
  }
  return out;
}

/** Only who is added or taken off hears about it: a part changed is quiet. */
export function guestUpdates(changes: GuestChange[]): "all" | "none" {
  return changes.some(c => c.action !== "part") ? "all" : "none";
}

/**
 * Google sends the invite, the update or the cancellation for a real
 * change. A change whose sittings are all before today tells nobody.
 */
export function sendUpdatesFor(
  lastAffectedDay: string | null,
  today: string,
): "all" | "none" {
  return lastAffectedDay && lastAffectedDay < today ? "none" : "all";
}

// --- the event description: only our part of it --------------------------------

export const MARK_START = "[Team meeting in the cockpit]";
export const MARK_END = "[/Team meeting]";

/**
 * The event's description with our block (the purpose and a link back to
 * the meeting's page) put in or replaced. Everything else in the
 * description is somebody else's and stays as it was.
 */
export function withOurBlock(
  description: string | null | undefined,
  purpose: string | null,
  link: string,
): string {
  const block = [MARK_START, purpose?.trim() || null, link, MARK_END]
    .filter(Boolean)
    .join("\n");
  const text = String(description ?? "");
  const a = text.indexOf(MARK_START);
  const b = text.indexOf(MARK_END);
  if (a >= 0 && b > a)
    return text.slice(0, a) + block + text.slice(b + MARK_END.length);
  return text.trim() ? `${block}\n\n${text}` : block;
}

/**
 * A new title for a series. A series a day carries its day in its title
 * ("CSM Daily: Projections"): the meeting's old name is replaced where it
 * appears and the rest is kept. A series named otherwise takes the new name.
 */
export function renamedSummary(
  summary: string,
  oldTitle: string,
  newTitle: string,
  onlyPart: boolean,
): string {
  const at = oldTitle ? summary.indexOf(oldTitle) : -1;
  if (at >= 0)
    return (
      summary.slice(0, at) + newTitle + summary.slice(at + oldTitle.length)
    );
  return onlyPart ? newTitle : summary;
}

// --- a write that must not overwrite somebody else's ------------------------------

export type Sent = { status: number; body: unknown };

/**
 * Change an event with If-Match: the etag of the copy the change was made
 * from. When Google answers 412 (the event changed in between), the event
 * is read again, the one change is made again on the fresh copy, and sent
 * once more. `change` returns null when there is nothing left to do.
 */
export async function patchWithRetry<E extends { etag?: string }>(
  read: () => Promise<E>,
  change: (fresh: E) => Record<string, unknown> | null,
  send: (
    body: Record<string, unknown>,
    etag: string | undefined,
  ) => Promise<Sent>,
): Promise<Sent & { retried: boolean }> {
  let fresh = await read();
  let body = change(fresh);
  if (!body) return { status: 200, body: fresh, retried: false };
  let res = await send(body, fresh.etag);
  if (res.status !== 412) return { ...res, retried: false };
  fresh = await read();
  body = change(fresh);
  if (!body) return { status: 200, body: fresh, retried: true };
  res = await send(body, fresh.etag);
  return { ...res, retried: true };
}

// --- the run of show -----------------------------------------------------------------

export type Block = {
  id: number;
  weekday: number | null;
  position: number;
  minutes: number | null;
  title: string;
  detail: string | null;
};

/** The blocks of one sitting: every-sitting blocks and that day's, in order. */
export function blocksFor<B extends Block>(
  blocks: B[],
  weekday: number | null,
): B[] {
  return blocks
    .filter(b => b.weekday === null || b.weekday === weekday)
    .sort((a, b) => a.position - b.position || a.id - b.id);
}

export function totalMinutes(blocks: Block[]): number {
  return blocks.reduce((n, b) => n + (b.minutes ?? 0), 0);
}

/** Whether the run of show changes from one day to the next. */
export function variesByDay(blocks: Block[]): boolean {
  return blocks.some(b => b.weekday !== null);
}

// --- wheels ----------------------------------------------------------------------------

export type WheelOption = {
  id: number;
  label: string;
  amount: number | null;
  currency: string | null;
  amount_suffix: string | null;
  condition: string | null;
  active: boolean;
  position: number;
};

export function formatAmount(
  amount: number | null,
  currency: string | null,
  suffix: string | null,
): string {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount)))
    return "?";
  const n = Number(amount);
  const text = Number.isInteger(n) ? String(n) : n.toFixed(2);
  if (suffix) return `${text}${suffix}`;
  if (!currency || currency === "USD") return `$${text}`;
  return `${currency} ${text}`;
}

/**
 * "{amount} bonus" with 100 USD reads "$100 bonus"; "{amount} commission
 * bump" with 10 and "%" reads "10% commission bump". The number changes,
 * the sentence does not.
 */
export function renderOption(o: {
  label: string;
  amount: number | null;
  currency: string | null;
  amount_suffix: string | null;
}): string {
  return o.label.includes("{amount}")
    ? o.label
        .split("{amount}")
        .join(formatAmount(o.amount, o.currency, o.amount_suffix))
    : o.label;
}

/** Why this wheel may not spin now, or null when it may. */
export function spinRefusal(
  wheel: {
    kind: string;
    locked_until_goal: boolean;
    active: boolean;
    name: string;
  },
  sitting: { goal_hit: boolean | null } | null,
  choices: number,
): string | null {
  if (!wheel.active) return `The ${wheel.name} wheel is switched off.`;
  if (
    wheel.kind === "prize" &&
    wheel.locked_until_goal &&
    sitting?.goal_hit !== true
  )
    return "This wheel is earned: mark this week's goal as hit to unlock it.";
  if (choices < 1)
    return wheel.kind === "person"
      ? "Nobody is in this sitting to pick from."
      : `The ${wheel.name} wheel has no options yet.`;
  return null;
}

/** A fair pick from n, with a source of random 32-bit numbers. */
export function pickIndex(n: number, random32: () => number): number {
  if (n <= 1) return 0;
  // Rejection sampling: no option is likelier because 2^32 is not a multiple of n.
  const limit = 2 ** 32 - (2 ** 32 % n);
  for (let i = 0; i < 64; i++) {
    const r = random32() >>> 0;
    if (r < limit) return r % n;
  }
  return (random32() >>> 0) % n;
}

export function spinLine(
  wheelName: string,
  result: string,
  forName?: string | null,
): string {
  return `Spun ${wheelName}: ${result}${forName ? ` (for ${forName})` : ""}`;
}

/** Notes with one more line at the end. */
export function withLine(notes: string, line: string): string {
  const text = notes.replace(/\s+$/, "");
  return text ? `${text}\n${line}` : line;
}

/**
 * Add a line to shared notes without overwriting anybody: each write
 * carries the version it read, and a write that lost the race reads again.
 */
export async function appendWithVersion(
  read: () => Promise<{ notes: string; version: number }>,
  write: (notes: string, version: number) => Promise<boolean>,
  line: string,
  tries = 4,
): Promise<{ notes: string; version: number }> {
  for (let i = 0; i < tries; i++) {
    const now = await read();
    const notes = withLine(now.notes, line);
    if (await write(notes, now.version))
      return { notes, version: now.version + 1 };
  }
  throw new Error(
    "The notes kept changing while the spin was being written down. Spin again in a moment.",
  );
}

// --- the creative pipeline ----------------------------------------------------------

export const STAGES = [
  "planned",
  "scripting",
  "footage",
  "editing",
  "review",
  "approved",
  "launched",
  "cut",
] as const;
export type Stage = (typeof STAGES)[number];

/** Each due date, and the stages at which it is still ahead of the row. */
const DUE: {
  field: "script_due" | "footage_due" | "edit_due" | "launch_on";
  until: Stage[];
}[] = [
  { field: "script_due", until: ["planned", "scripting"] },
  { field: "footage_due", until: ["planned", "scripting", "footage"] },
  { field: "edit_due", until: ["planned", "scripting", "footage", "editing"] },
  {
    field: "launch_on",
    until: ["planned", "scripting", "footage", "editing", "review", "approved"],
  },
];

export type CreativeDates = {
  status: string;
  script_due: string | null;
  footage_due: string | null;
  edit_due: string | null;
  launch_on: string | null;
};

/**
 * A slip: a due date that had already passed, for a step not yet done,
 * was moved. One save is one slip however many dates it moves.
 */
export function slipsAdded(
  before: CreativeDates,
  after: CreativeDates,
  today: string,
): number {
  for (const d of DUE) {
    const was = before[d.field];
    if (!was || was >= today) continue;
    if (!(d.until as string[]).includes(before.status)) continue;
    if (after[d.field] !== was) return 1;
  }
  return 0;
}

/** A due date passed for a step not yet done. */
export function overdue(row: CreativeDates, today: string): boolean {
  return DUE.some(
    d =>
      row[d.field] !== null &&
      (row[d.field] as string) < today &&
      (d.until as string[]).includes(row.status),
  );
}

/** "A video with no launch date is not planned." */
export function notPlanned(row: {
  launch_on: string | null;
  status: string;
}): boolean {
  return !row.launch_on && row.status !== "launched" && row.status !== "cut";
}

/** The pipeline's week starts on Saturday, the day of the whole-team meeting. */
export function weekStart(day: string): string {
  return addDays(day, -((weekdayOf(day) + 1) % 7));
}

export function pipelineStrip(
  rows: (CreativeDates & { launched_on: string | null; slip_count: number })[],
  today: string,
): {
  launchedLastWeek: number;
  plannedLastWeek: number;
  launchingThisWeek: number;
  slippedTwice: number;
} {
  const thisWeek = weekStart(today);
  const lastWeek = addDays(thisWeek, -7);
  const nextWeek = addDays(thisWeek, 7);
  const inLast = (d: string | null) =>
    Boolean(d && d >= lastWeek && d < thisWeek);
  return {
    launchedLastWeek: rows.filter(r => inLast(r.launched_on)).length,
    plannedLastWeek: rows.filter(r => inLast(r.launch_on)).length,
    launchingThisWeek: rows.filter(
      r =>
        r.launch_on &&
        r.launch_on >= thisWeek &&
        r.launch_on < nextWeek &&
        r.status !== "launched" &&
        r.status !== "cut",
    ).length,
    slippedTwice: rows.filter(
      r => r.slip_count >= 2 && r.status !== "launched" && r.status !== "cut",
    ).length,
  };
}

// --- reading Google's copy ---------------------------------------------------------

/** The RRULE line of an event's recurrence, or null for a single event. */
export function rruleOf(
  recurrence: string[] | null | undefined,
): string | null {
  return (recurrence ?? []).find(r => /^RRULE:/i.test(r)) ?? null;
}

/** An event's recurrence with its RRULE replaced; exceptions and extra dates kept. */
export function withRrule(
  recurrence: string[] | null | undefined,
  rrule: string,
): string[] {
  const rest = (recurrence ?? []).filter(r => !/^RRULE:/i.test(r));
  return [rrule, ...rest];
}

/**
 * A Google event (a series' own event or a single one) in the cockpit's
 * series columns: start time, length, days, rule, last day, Meet link.
 */
export function eventSeries(
  ev: {
    start?: { dateTime?: string };
    end?: { dateTime?: string };
    recurrence?: string[];
    hangoutLink?: string;
    conferenceData?: {
      entryPoints?: { entryPointType?: string; uri?: string }[];
    };
  },
  tz: string,
): {
  start_time: string | null;
  minutes: number | null;
  weekdays: number[] | null;
  rrule: string | null;
  ends_on: string | null;
  meet_link: string | null;
  firstDay: string | null;
} {
  const start = ev.start?.dateTime ? utcToZoned(ev.start.dateTime, tz) : null;
  const minutes =
    ev.start?.dateTime && ev.end?.dateTime
      ? Math.round(
          (Date.parse(ev.end.dateTime) - Date.parse(ev.start.dateTime)) /
            60_000,
        )
      : null;
  const rrule = rruleOf(ev.recurrence);
  const p = rruleParts(rrule);
  let weekdays: number[] | null = null;
  if (rrule && p.FREQ === "WEEKLY")
    weekdays = weekdaysOfRrule(rrule) ?? (start ? [start.weekday] : null);
  let ends: string | null = null;
  if (rrule && p.UNTIL) {
    const u = p.UNTIL;
    ends = u.includes("T")
      ? utcToZoned(
          `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}T${u.slice(9, 11)}:${u.slice(11, 13)}:${u.slice(13, 15)}Z`,
          tz,
        ).day
      : `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}`;
  } else if (!rrule && start) ends = start.day;
  const video = ev.conferenceData?.entryPoints?.find(
    e => e.entryPointType === "video",
  )?.uri;
  return {
    start_time: start ? `${start.time}:00` : null,
    minutes,
    weekdays,
    rrule,
    ends_on: ends,
    meet_link: ev.hangoutLink ?? video ?? null,
    firstDay: start?.day ?? null,
  };
}

// --- what a change will do on Google Calendar, in words -----------------------------

/**
 * The lines the page shows before a change of days, time or length is
 * sent, so nobody is surprised by what lands on everybody's calendar.
 */
export function seriesPreview(o: {
  linked: boolean;
  parts: { weekday: number | null }[];
  change: SeriesChange;
  next: string | null;
  tz?: string | null;
  quiet?: boolean;
}): string[] {
  const line = seriesLine({
    weekdays: o.change.weekdays,
    startTime: o.change.startTime,
    minutes: o.change.minutes,
    tz: o.tz,
  });
  if (!o.linked)
    return [
      `The cockpit changes to ${line}.`,
      "It is not on Google Calendar, so no invite goes out.",
    ];
  const later = Boolean(o.next && o.change.from > o.next);
  const tell = o.quiet
    ? "Every sitting is in the past, so Google tells nobody."
    : "Everyone invited gets Google's update.";
  const days = o.parts
    .map(p => p.weekday)
    .filter((d): d is number => d !== null);
  if (o.parts.length > 1 && days.length === o.parts.length) {
    const out: string[] = [];
    for (const d of days) {
      if (o.change.weekdays.includes(d))
        out.push(
          later
            ? `${DAY_NAMES[d]}'s series ends ${dayLabel(addDays(o.change.from, -1))}; a new one starts ${dayLabel(nextOn([d], o.change.from))} at ${hhmm(o.change.startTime)} for ${o.change.minutes} min, same guests and Meet link.`
            : `${DAY_NAMES[d]}'s series moves to ${hhmm(o.change.startTime)} for ${o.change.minutes} min.`,
        );
      else
        out.push(
          `${DAY_NAMES[d]}'s series ends ${dayLabel(addDays(o.change.from, -1))}.`,
        );
    }
    for (const d of o.change.weekdays.filter(x => !days.includes(x)))
      out.push(
        `A new ${DAY_NAMES[d]} series starts ${dayLabel(nextOn([d], o.change.from))} with the same guests and its own Meet link.`,
      );
    return [...out, tell];
  }
  if (later)
    return [
      `The series on Google Calendar ends ${dayLabel(addDays(o.change.from, -1))}.`,
      `A new series starts ${dayLabel(nextOn(o.change.weekdays.length ? o.change.weekdays : [weekdayOf(o.change.from)], o.change.from))}: ${line}, with the same guests and Meet link.`,
      "Past sittings, notes and spins stay with the meeting.",
      tell,
    ];
  return [`Every sitting on Google Calendar moves to ${line}.`, tell];
}
