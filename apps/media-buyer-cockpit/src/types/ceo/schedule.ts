/**
 * Working hours per person: the days and times of a normal week, plus
 * exceptions for single dates (a day off, or different hours for somebody
 * part-time). Pure helpers with no Convex import, shared by the people
 * module, which checks a schedule before storing it, and the Team & payroll
 * screen, which shows and edits it.
 *
 * Times are wall clock in `timezone`, "HH:MM", 24 hour. A day ends after it
 * starts: a shift across midnight is not a shape this knows, and it says so
 * rather than storing a negative day.
 *
 * The week is stored Monday to Sunday but shown Saturday to Friday, because
 * the company's week starts on Saturday (see convex/ceo/time.ts).
 */

export const DAY_KEYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;
export type DayKey = (typeof DAY_KEYS)[number];

/** The company's week, Saturday first: the order every screen lists the days in. */
export const WEEK_ORDER: readonly DayKey[] = [
  "sat",
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
];

export const DAY_LABEL: Record<DayKey, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export const DAY_SHORT: Record<DayKey, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

/** JavaScript's getUTCDay (0 is Sunday) to a day key. */
const KEY_OF_WEEKDAY: readonly DayKey[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

const MONTHS_SHORT = [
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

export type DayHours = {
  /** False on a day off. The times are kept so switching the day back on remembers them. */
  on: boolean;
  /** "HH:MM", 24 hour. */
  start: string;
  /** "HH:MM", after `start`. */
  end: string;
};

/** One date that replaces its weekday line: off entirely, or different hours. */
export type ScheduleException =
  | { date: string; off: true }
  | { date: string; start: string; end: string };

export type Schedule = {
  /** An IANA zone name; "Asia/Kuwait" unless said otherwise. */
  timezone: string;
  week: Record<DayKey, DayHours>;
  /** Sorted by date, one entry per date. */
  exceptions: ScheduleException[];
};

export const DEFAULT_TIMEZONE = "Asia/Kuwait";
const DEFAULT_START = "10:00";
const DEFAULT_END = "18:00";

/** Saturday to Thursday, 10:00 to 18:00, off on Friday: the company's week. */
export function defaultSchedule(): Schedule {
  const week = {} as Record<DayKey, DayHours>;
  for (const k of DAY_KEYS)
    week[k] = { on: k !== "fri", start: DEFAULT_START, end: DEFAULT_END };
  return { timezone: DEFAULT_TIMEZONE, week, exceptions: [] };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "9:00" as "09:00"; null when the input is not a time of day. */
export function normaliseTime(input: unknown): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(input ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

/** Minutes since midnight of a normalised "HH:MM". */
export function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** Hours between two normalised times, to two decimals. */
function span(start: string, end: string): number {
  return Math.round(((minutesOf(end) - minutesOf(start)) / 60) * 100) / 100;
}

/** A real calendar day written "YYYY-MM-DD". */
export function isRealDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const t = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === day;
}

/** "2026-09-25" as "25 Sep", for a sentence. */
function dayLabel(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** Throws the plain sentence for a window that does not run forwards. */
function checkWindow(start: string, end: string, label: string): void {
  const diff = minutesOf(end) - minutesOf(start);
  if (diff < 0) throw new Error(`${label} ends before it starts.`);
  if (diff === 0) throw new Error(`${label} ends when it starts.`);
}

function timeOf(raw: unknown, fallback: string, label: string): string {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const t = normaliseTime(raw);
  if (t === null) throw new Error(`${label} is not a time like 09:00.`);
  return t;
}

function dayHours(raw: unknown, key: DayKey): DayHours {
  const label = DAY_LABEL[key];
  if (raw === undefined || raw === null)
    return { on: false, start: DEFAULT_START, end: DEFAULT_END };
  if (!isObject(raw))
    throw new Error(`${label} needs on or off, a start and an end.`);
  if (raw.on !== undefined && typeof raw.on !== "boolean")
    throw new Error(`${label} is either on or off.`);
  const on = raw.on === true;
  const start = timeOf(raw.start, DEFAULT_START, `${label}'s start`);
  const end = timeOf(raw.end, DEFAULT_END, `${label}'s end`);
  if (on) checkWindow(start, end, label);
  return { on, start, end };
}

function exception(raw: unknown, position: number): ScheduleException {
  if (!isObject(raw))
    throw new Error(`Exception ${position} needs a date like 2026-09-25.`);
  const date = String(raw.date ?? "").trim();
  if (!isRealDay(date))
    throw new Error(
      `An exception needs a date like 2026-09-25${date ? `, not "${date}"` : ""}.`,
    );
  const label = `The ${dayLabel(date)} exception`;
  if (raw.off === true) return { date, off: true };
  if (raw.off !== undefined && raw.off !== false)
    throw new Error(`${label} is either off, or a start and an end.`);
  const start = normaliseTime(raw.start);
  const end = normaliseTime(raw.end);
  if (start === null || end === null)
    throw new Error(
      `${label} needs a start and an end like 12:00 to 16:00, or off.`,
    );
  checkWindow(start, end, label);
  return { date, start, end };
}

const ZONE_RE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

/**
 * The one place the shape is checked. Returns a fresh schedule in the stored
 * shape, or throws a sentence for the screen: "Tuesday ends before it
 * starts." Missing days are off; a missing timezone is Asia/Kuwait;
 * exceptions come back sorted with one entry per date.
 */
export function normaliseSchedule(input: unknown): Schedule {
  if (!isObject(input) || !isObject(input.week))
    throw new Error("Hours need a week of days.");
  const timezone =
    input.timezone === undefined || input.timezone === null
      ? DEFAULT_TIMEZONE
      : String(input.timezone).trim();
  if (!ZONE_RE.test(timezone))
    throw new Error("The timezone should be a name like Asia/Kuwait.");

  const week = {} as Record<DayKey, DayHours>;
  for (const k of DAY_KEYS) week[k] = dayHours(input.week[k], k);

  const rawList = input.exceptions ?? [];
  if (!Array.isArray(rawList))
    throw new Error("Exceptions are a list of dates.");
  if (rawList.length > 366)
    throw new Error("That is more exceptions than a year has days.");
  const exceptions = rawList
    .map((x, i) => exception(x, i + 1))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < exceptions.length; i++)
    if (exceptions[i].date === exceptions[i - 1].date)
      throw new Error(`${dayLabel(exceptions[i].date)} is listed twice.`);

  return { timezone, week, exceptions };
}

/**
 * A stored value as a schedule, or null: for null, and for a value that no
 * longer fits the shape (only possible by hand in SQL, since every write
 * goes through normaliseSchedule). The roster still lists the person; the
 * row reads "no hours set" and the next save writes a clean shape.
 */
export function parseSchedule(raw: unknown): Schedule | null {
  if (raw === null || raw === undefined) return null;
  try {
    return normaliseSchedule(raw);
  } catch {
    return null;
  }
}

/** Hours in a normal week: the on days only, exceptions aside. */
export function hoursPerWeek(schedule: Schedule): number {
  let total = 0;
  for (const k of DAY_KEYS) {
    const d = schedule.week[k];
    if (d.on) total += span(d.start, d.end);
  }
  return Math.round(total * 100) / 100;
}

/** The working window on a date, an exception first, then the weekday; null on a day off. */
export function windowOn(
  schedule: Schedule,
  day: string,
): { start: string; end: string } | null {
  if (!isRealDay(day)) return null;
  const x = schedule.exceptions.find(e => e.date === day);
  if (x) return "off" in x ? null : { start: x.start, end: x.end };
  const d =
    schedule.week[KEY_OF_WEEKDAY[new Date(`${day}T00:00:00Z`).getUTCDay()]];
  return d.on ? { start: d.start, end: d.end } : null;
}

/** Hours on a date ("YYYY-MM-DD"): 0 on a day off or an off exception. */
export function hoursOn(schedule: Schedule, day: string): number {
  const w = windowOn(schedule, day);
  return w ? span(w.start, w.end) : 0;
}

/** "40 h", "37.5 h". */
export function hoursText(hours: number): string {
  return `${Number(hours.toFixed(2))} h`;
}

/** Runs of days in the shown order: "Sat to Thu", "Sat, Sun and Tue to Thu", "Mon, Wed and Fri". */
function dayRuns(days: DayKey[]): string {
  const positions = days.map(k => WEEK_ORDER.indexOf(k)).sort((a, b) => a - b);
  const items: string[] = [];
  let i = 0;
  while (i < positions.length) {
    let j = i;
    while (j + 1 < positions.length && positions[j + 1] === positions[j] + 1)
      j++;
    const first = DAY_SHORT[WEEK_ORDER[positions[i]]];
    const last = DAY_SHORT[WEEK_ORDER[positions[j]]];
    if (j - i >= 2) items.push(`${first} to ${last}`);
    else
      for (let p = i; p <= j; p++)
        items.push(DAY_SHORT[WEEK_ORDER[positions[p]]]);
    i = j + 1;
  }
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * One line for the row: "Sat to Thu 10:00 to 18:00, 40 h a week, 2 exceptions".
 * Days that share a window are named together; a second window gets its own
 * clause ("Sat to Wed 10:00 to 18:00, Thu 10:00 to 14:00").
 */
export function scheduleSummary(schedule: Schedule): string {
  const on = WEEK_ORDER.filter(k => schedule.week[k].on);
  const parts: string[] = [];
  if (!on.length) parts.push("No working days");
  else {
    const groups = new Map<string, DayKey[]>();
    for (const k of on) {
      const d = schedule.week[k];
      const window = `${d.start} to ${d.end}`;
      const list = groups.get(window);
      if (list) list.push(k);
      else groups.set(window, [k]);
    }
    for (const [window, days] of groups)
      parts.push(`${dayRuns(days)} ${window}`);
  }
  parts.push(`${hoursText(hoursPerWeek(schedule))} a week`);
  const n = schedule.exceptions.length;
  if (n) parts.push(`${n} exception${n === 1 ? "" : "s"}`);
  return parts.join(", ");
}
