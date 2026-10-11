// Booking further out than the lead's booking page, and a custom time (the
// CEO, 2026-10-11, verbatim: "book people carther out ... custom appointment
// the same way on GHL cause I don't want the front end calendar links to have
// far out availability"). The rules, with no network in them, so bun can test every
// one (farout.test.ts runs them on a recording of HighLevel's own answers).
//
// Inside a calendar's public window nothing changes: HighLevel's own free
// slots decide, as before. Past it (up to the booking setting's reach_days,
// 60 by default) the cockpit works the free times out itself, the way
// HighLevel does for its booking page: the host's own availability schedule
// when one lists the calendar (else the calendar's open hours), the call's
// length and step, the buffers, the host's appointments on every calendar and
// their blocked time (Google Calendar events included). That rule matched
// HighLevel's own answer on 90 of 90 calendar-days of Ahmed's calendars
// (2026-10-11). A far time is offered only when HighLevel's own extended
// answer (free-slots with ignoreDateRange=true) agrees, when that could be
// read. Nothing here writes; index.ts reads, checks again right before a
// write, and leaves an audit row saying how each call was placed.
//
// No internal calendar: far-out and custom calls go on the same HighLevel
// calendars, so the B2B numbers, HighLevel's reminder workflows, the Zoom
// link and the lead's owner keep working as for any booking.

import { ghlTime } from "./dialer.ts";
import { CUSTOM_STEP_MIN, firstName, kuwaitDay, kuwaitWords12, SLOT_DAYS } from "./reschedule.ts";

type Row = Record<string, unknown>;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const KUWAIT = 3 * HOUR;

/** The booking setting's reach when the row is absent or not a whole number from 15 to 120 (the CEO's number). */
export const REACH_DAYS_DEFAULT = 60;
export const REACH_DAYS_MIN = 15;
export const REACH_DAYS_MAX = 120;
/** A custom time must be at least this far ahead. */
export const CUSTOM_LEAD_MS = 5 * MIN;
/** HighLevel's free-slots call answers at most 31 days at a time ("Date range cannot be more than 31 days"). */
export const EXTENDED_MAX_DAYS = 31;

/** One rule of a HighLevel availability schedule: a weekday's hours, or one date's (which replaces its weekday). */
export interface ScheduleRule {
  type?: string;
  day?: string;
  date?: string;
  intervals?: { from?: string; to?: string }[];
}

/** GET /calendars/schedules/search: a person's availability, and the calendars it applies to. */
export interface Schedule {
  id?: string;
  userId?: string;
  calendarIds?: string[];
  rules?: ScheduleRule[];
  timezone?: string;
  deleted?: boolean;
}

/** [start, end) in epoch ms. */
export type Interval = [number, number];

/**
 * A stretch of the host's calendar that is taken: `from`/`to` with the
 * buffers HighLevel keeps around it, `start`/`end` as it stands (what a
 * sentence names). "call" is a HighLevel appointment, "busy" blocked time
 * (a Google Calendar event, or a slot blocked by hand). Never its title.
 */
export interface BusyRow {
  from: number;
  to: number;
  start: number;
  end: number;
  what: "call" | "busy";
}

export interface SlotDay {
  day: string;
  slots: string[];
}

export type Placement = "window" | "far_out" | "custom";
export type FarState = "ok" | "none" | "unread";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const SHORT = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type WeekKey = (typeof SHORT)[number];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PLURAL = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A HighLevel length in ms: "mins" (the default), "hours", "days", "weeks", "months". Empty or not a number is 0. */
export function unitMs(n: unknown, unit: unknown, fallback = "mins"): number {
  const v = Number(n);
  if (n === null || n === undefined || n === "" || !Number.isFinite(v) || v <= 0) return 0;
  const u = String(unit ?? fallback) || fallback;
  const per = u.startsWith("hour")
    ? HOUR
    : u.startsWith("day")
      ? DAY
      : u.startsWith("week")
        ? 7 * DAY
        : u.startsWith("month")
          ? 30 * DAY
          : MIN;
  return v * per;
}

/** "2026-10-13" plus n days. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/** Midnight in Kuwait at the start of a Kuwait day. */
export function dayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) - KUWAIT;
}

function weekdayOf(day: string): number {
  return new Date(Date.parse(`${day}T00:00:00Z`)).getUTCDay();
}

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** A HighLevel time with Kuwait's offset, "2026-10-21T10:00:00+03:00", the shape its free slots come in. */
export function slotString(ms: number): string {
  return `${new Date(ms + KUWAIT).toISOString().slice(0, 19)}+03:00`;
}

/** "HH:MM" → minutes after midnight, or null. "24:00" is the end of the day. */
function minutesOf(s: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const v = Number(m[1]) * 60 + Number(m[2]);
  return v >= 0 && v <= 24 * 60 ? v : null;
}

/** A zone's offset from UTC at an instant, in ms; Kuwait's when the zone is Kuwait, empty, or unknown. */
export function zoneOffsetMs(tz: unknown, at: number): number {
  const zone = String(tz ?? "").trim();
  if (!zone || zone === "Asia/Kuwait") return KUWAIT;
  try {
    const f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const p = Object.fromEntries(f.formatToParts(new Date(at)).map(x => [x.type, x.value]));
    const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
    const off = asUtc - Math.floor(at / 1000) * 1000;
    return Number.isFinite(off) ? off : KUWAIT;
  } catch {
    return KUWAIT;
  }
}

function merged(list: Interval[]): Interval[] {
  const sorted = list.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  for (const [s1, e1] of a)
    for (const [s2, e2] of b) {
      const s = Math.max(s1, s2);
      const e = Math.min(e1, e2);
      if (s < e) out.push([s, e]);
    }
  return merged(out);
}

/**
 * The calendar's own open hours on a Kuwait day, or null when the calendar
 * sets none (HighLevel stores none as [] or {}: then the calendar adds no cut).
 * A calendar with hours for other weekdays only is closed that day ([]).
 */
export function openHoursOn(cal: Row, day: string): Interval[] | null {
  const oh = cal.openHours;
  if (!Array.isArray(oh) || !oh.length) return null;
  const wd = weekdayOf(day);
  const base = dayStartMs(day);
  const out: Interval[] = [];
  for (const o of oh as Row[]) {
    const days = Array.isArray(o?.daysOfTheWeek) ? (o.daysOfTheWeek as unknown[]).map(Number) : [];
    if (!days.includes(wd)) continue;
    for (const h of (Array.isArray(o.hours) ? o.hours : []) as Row[]) {
      const from = Number(h.openHour) * 60 + Number(h.openMinute ?? 0);
      const to = Number(h.closeHour) * 60 + Number(h.closeMinute ?? 0);
      if (Number.isFinite(from) && Number.isFinite(to) && to > from) out.push([base + from * MIN, base + to * MIN]);
    }
  }
  return merged(out);
}

/** One schedule's hours on a date: that date's own rules when it has any (an empty list is a day off), else its weekday's. */
export function scheduleOn(s: Schedule, day: string): Interval[] {
  const rules = Array.isArray(s.rules) ? s.rules : [];
  const dated = rules.filter(r => r?.type === "date" && String(r.date ?? "").slice(0, 10) === day);
  const wd = WEEKDAYS[weekdayOf(day)];
  const use = dated.length ? dated : rules.filter(r => (r?.type ?? "wday") === "wday" && String(r.day ?? "").toLowerCase() === wd);
  const midnight = Date.parse(`${day}T00:00:00Z`) - zoneOffsetMs(s.timezone, Date.parse(`${day}T12:00:00Z`));
  const out: Interval[] = [];
  for (const r of use)
    for (const i of Array.isArray(r.intervals) ? r.intervals : []) {
      const a = minutesOf(i?.from);
      const b = minutesOf(i?.to);
      if (a !== null && b !== null && b > a) out.push([midnight + a * MIN, midnight + b * MIN]);
    }
  return merged(out);
}

/**
 * When the host can take a call on this calendar on a Kuwait day (HighLevel's
 * own rule, as read 2026-10-11):
 * 1. a schedule of the host's that lists the calendar decides;
 * 2. none of theirs does, but another person's does: the host has no hours
 *    on it (HighLevel offers Aziz nothing on the demo calendars);
 * 3. no schedule lists the calendar at all: the calendar's own open hours.
 * Always cut to the calendar's open hours when it has any, and to the day.
 */
export function hostWindows(schedules: Schedule[], cal: Row, calendarId: string, userId: string | null, day: string): Interval[] {
  const live = (schedules ?? []).filter(s => s && !s.deleted);
  const lists = (s: Schedule) => Array.isArray(s.calendarIds) && s.calendarIds.map(String).includes(calendarId);
  const linked = userId ? live.filter(s => String(s.userId ?? "") === userId && lists(s)) : [];
  const calHours = openHoursOn(cal, day);
  let out: Interval[];
  if (linked.length) {
    const own = scheduleOn(linked[0] as Schedule, day);
    out = calHours === null ? own : intersect(own, calHours);
  } else if (live.some(lists)) out = [];
  else out = calHours ?? [];
  const start = dayStartMs(day);
  return intersect(out, [[start, start + DAY]]);
}

/**
 * The host's taken time: every appointment not deleted, cancelled or
 * invalid (a no-show still held the slot), widened by its own calendar's
 * buffers (a calendar not in the map adds none), and every blocked stretch
 * as it is. `exceptId`: the call being moved, which never blocks itself.
 * A Google event HighLevel itself treats as free (a "Bookable" window)
 * cannot be told apart through the API, so it counts as busy: the safe side.
 */
export function busyOf(events: Row[], blocks: Row[], calendars: Record<string, Row | undefined>, exceptId: string | null = null): BusyRow[] {
  const out: BusyRow[] = [];
  for (const e of events ?? []) {
    if (!e || e.deleted === true) continue;
    if (exceptId && String(e.id ?? "") === exceptId) continue;
    const status = String(e.appointmentStatus ?? e.appoinmentStatus ?? e.status ?? "").toLowerCase();
    if (status === "cancelled" || status === "invalid") continue;
    const start = ghlTime(e.startTime);
    const end = ghlTime(e.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const c = calendars[String(e.calendarId ?? "")] ?? {};
    out.push({
      start,
      end,
      from: start - unitMs(c.preBuffer, c.preBufferUnit),
      to: end + unitMs(c.slotBuffer, c.slotBufferUnit),
      what: "call",
    });
  }
  for (const b of blocks ?? []) {
    if (!b || b.deleted === true) continue;
    const start = ghlTime(b.startTime);
    const end = ghlTime(b.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    out.push({ start, end, from: start, to: end, what: "busy" });
  }
  return out.sort((a, b) => a.from - b.from);
}

/** The call's length, step and buffers on a calendar. */
export function shapeOf(cal: Row): { len: number; step: number; pre: number; post: number } {
  const len = unitMs(cal.slotDuration, cal.slotDurationUnit);
  const step = unitMs(cal.slotInterval, cal.slotIntervalUnit);
  return { len, step: step > 0 ? step : len, pre: unitMs(cal.preBuffer, cal.preBufferUnit), post: unitMs(cal.slotBuffer, cal.slotBufferUnit) };
}

/** The first busy stretch a call at `t` would touch (with both sides' buffers), or null. */
export function clashAt(cal: Row, busy: BusyRow[], t: number): BusyRow | null {
  const { len, pre, post } = shapeOf(cal);
  return busy.find(x => t - pre < x.to && x.from < t + len + post) ?? null;
}

/** The free starts in the host's windows: from each window's start, a step at a time, the whole call inside it, clear of every busy stretch. */
export function freeStarts(cal: Row, windows: Interval[], busy: BusyRow[], notBefore: number): number[] {
  const { len, step } = shapeOf(cal);
  if (!(len > 0) || !(step > 0)) return [];
  const out: number[] = [];
  for (const [a, b] of windows)
    for (let t = a; t + len <= b; t += step) if (t >= notBefore && !clashAt(cal, busy, t)) out.push(t);
  return out;
}

/** The earliest start the calendar takes: now plus its notice ("from 2 hours ahead"). */
export function noticeFrom(cal: Row, now: number): number {
  return now + unitMs(cal.allowBookingAfter, cal.allowBookingAfterUnit, "hours");
}

/** The host's free times on these Kuwait days, by the rule above. */
export function ownDays(o: {
  schedules: Schedule[];
  cal: Row;
  calendarId: string;
  userId: string;
  busy: BusyRow[];
  days: string[];
  now: number;
}): SlotDay[] {
  const notBefore = noticeFrom(o.cal, o.now);
  const out: SlotDay[] = [];
  for (const day of o.days) {
    const starts = freeStarts(o.cal, hostWindows(o.schedules, o.cal, o.calendarId, o.userId, day), o.busy, notBefore);
    if (starts.length) out.push({ day, slots: starts.map(slotString) });
  }
  return out;
}

/** Whether the host has any hours on this calendar on any of these days. */
export function hasHours(schedules: Schedule[], cal: Row, calendarId: string, userId: string, days: string[]): boolean {
  return days.some(d => hostWindows(schedules, cal, calendarId, userId, d).length > 0);
}

/** Every Kuwait day from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * The last day of the calendar's public window: the last day in HighLevel's
 * own free-slots answer (asked for SLOT_DAYS days, as book.slots always
 * has). When that answer is empty, the calendar's own "book up to N days
 * out", counted the way HighLevel counts it (today is day one); a calendar
 * with no limit opens every day that was asked.
 */
export function windowUntil(normalDays: { day: string }[], cal: Row, now: number): string {
  const days = (normalDays ?? []).map(d => d.day).filter(isDay).sort();
  if (days.length) return days[days.length - 1] as string;
  const n = Number(cal.allowBookingFor);
  if (!Number.isFinite(n) || n <= 0) return kuwaitDay(now + SLOT_DAYS * DAY);
  const unit = String(cal.allowBookingForUnit ?? "days");
  if (unit.startsWith("hour")) return kuwaitDay(now + n * HOUR);
  const span = unit.startsWith("week") ? 7 * n : unit.startsWith("month") ? 30 * n : n;
  return addDays(kuwaitDay(now), Math.max(0, span - 1));
}

/** The booking setting's reach in days: absent 60, else a whole number from 15 to 120, anything else 60. */
export function reachDaysOf(v: unknown): number {
  const n = v && typeof v === "object" ? (v as Row).reach_days : undefined;
  return typeof n === "number" && Number.isInteger(n) && n >= REACH_DAYS_MIN && n <= REACH_DAYS_MAX ? n : REACH_DAYS_DEFAULT;
}

/** The last Kuwait day the cockpit books: today plus reach_days − 1. */
export function reachUntil(now: number, reachDays: number): string {
  return addDays(kuwaitDay(now), Math.max(0, reachDays - 1));
}

/**
 * The far-out times: the host's own times on days after the window and up
 * to the reach, kept only where HighLevel's extended answer has them too
 * (agreed). When that answer could not be read (ext null) the cockpit's own
 * times stand: each is still checked by HighLevel when it is booked.
 */
export function farDays(own: SlotDay[], ext: SlotDay[] | null, windowEnd: string | null, reachEnd: string): { days: SlotDay[]; agreed: boolean } {
  const theirs = ext ? new Set(ext.flatMap(d => d.slots.map(s => Date.parse(s))).filter(Number.isFinite)) : null;
  const days = own
    .filter(d => (windowEnd === null || d.day > windowEnd) && d.day <= reachEnd)
    .map(d => ({ day: d.day, slots: theirs ? d.slots.filter(s => theirs.has(Date.parse(s))) : [...d.slots] }))
    .filter(d => d.slots.length);
  return { days, agreed: ext !== null };
}

/**
 * The calls the cockpit is writing for a host this minute, as busy stretches
 * (review, 2026-10-11): a booking being made (cockpit_sales_bookings rows
 * still `creating`) or a move on its way (cockpit_sales_reschedules rows
 * still `moving`). HighLevel does not show them yet, and a custom time is
 * written with HighLevel's own slot check off, so without them two reps
 * pressing the same host's time at once would both land. A move's row keeps
 * no end, so its calendar's call length is used (an hour when that calendar
 * could not be read: the safe side).
 */
export function inFlightBusy(books: Row[], moves: Row[], calendars: Record<string, Row | undefined>): BusyRow[] {
  const events: Row[] = [
    ...(books ?? []).map(b => ({ id: `booking:${b.id}`, calendarId: b.calendar_id, startTime: b.start_at, endTime: b.end_at })),
    ...(moves ?? []).map(m => {
      const start = ghlTime(m.to_start);
      const len = shapeOf(calendars[String(m.calendar_id ?? "")] ?? {}).len || HOUR;
      return {
        id: `move:${m.id}`,
        calendarId: m.calendar_id,
        startTime: m.to_start,
        endTime: Number.isFinite(start) ? new Date(start + len).toISOString() : null,
      };
    }),
  ];
  return busyOf(events, [], calendars);
}

/** How a time is placed: one of HighLevel's own offered times, a far-out time, or a custom time. */
export function placementOf(o: { start: number; windowUntil: string | null; offeredInWindow: boolean; custom: boolean }): Placement {
  if (o.offeredInWindow) return "window";
  if (o.custom) return "custom";
  return o.windowUntil !== null && kuwaitDay(o.start) > o.windowUntil ? "far_out" : "window";
}

/**
 * A custom time judged against the host's calendar (nothing here refuses;
 * the caller does, in this order): past (not 5 minutes ahead), step (not on
 * the 5-minute mark), beyond (after the reach), clash (the first busy
 * stretch it touches, with the buffers), outside (not wholly inside the
 * host's hours that day: allowed, but said).
 */
export function customCheck(o: { cal: Row; windows: Interval[]; busy: BusyRow[]; start: number; now: number; reachUntil: string }): {
  past: boolean;
  step: boolean;
  beyond: boolean;
  clash: { start: number; end: number; what: "call" | "busy" } | null;
  outside: boolean;
} {
  const { len } = shapeOf(o.cal);
  const hit = clashAt(o.cal, o.busy, o.start);
  return {
    past: o.start <= o.now + CUSTOM_LEAD_MS,
    step: o.start % (CUSTOM_STEP_MIN * MIN) !== 0,
    beyond: kuwaitDay(o.start) > o.reachUntil,
    clash: hit ? { start: hit.start, end: hit.end, what: hit.what } : null,
    outside: !o.windows.some(([a, b]) => o.start >= a && o.start + len <= b),
  };
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

/** "2:00 pm" in Kuwait time. */
export function clock12(ms: number): string {
  const d = new Date(ms + KUWAIT);
  const h = d.getUTCHours();
  return `${h % 12 === 0 ? 12 : h % 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** "14:00" in Kuwait time. */
function clock24(ms: number): string {
  return new Date(ms + KUWAIT).toISOString().slice(11, 16);
}

/** "Tue 13 Oct" for a Kuwait day. */
export function dayWords(day: string): string {
  const d = new Date(Date.parse(`${day}T00:00:00Z`));
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** "9:00 am to 6:00 pm", "8:00 am to 12:00 pm and 1:00 pm to 5:00 pm", or "no working hours that day". */
export function hoursWords(windows: Interval[]): string {
  if (!windows.length) return "no working hours that day";
  return windows.map(([a, b]) => `${clock12(a)} to ${clock12(b)}`).join(" and ");
}

const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/** The sentence for a custom time on top of a call the cockpit is booking or moving for the same host right now. */
export function inFlightMessage(c: { start: number; end: number }, hostName: string | null): string {
  const who = firstName(hostName) ?? "the host";
  const oneDay = kuwaitDay(c.start) === kuwaitDay(c.end - 1);
  const span = oneDay ? `from ${clock12(c.start)} to ${clock12(c.end)}` : `from ${kuwaitWords12(c.start)} to ${kuwaitWords12(c.end)}`;
  return `Someone is booking ${who} ${span} (Kuwait time) right now. Pick another time.`;
}

/** The sentence for a custom time on top of the host's own call or busy time. */
export function busyMessage(c: { start: number; end: number; what: "call" | "busy" }, hostName: string | null): string {
  const who = firstName(hostName);
  const oneDay = kuwaitDay(c.start) === kuwaitDay(c.end - 1);
  const span = oneDay ? `from ${clock12(c.start)} to ${clock12(c.end)}` : `from ${kuwaitWords12(c.start)} to ${kuwaitWords12(c.end)}`;
  if (c.what === "call") return `${who ?? "The host"} has another call ${span} (Kuwait time). Pick another time.`;
  return `${who ? possessive(who) : "The host's"} calendar is busy ${span} (Kuwait time). Pick another time.`;
}

/** The sentence for a custom time outside the host's working hours (allowed with Book anyway). */
export function outsideMessage(hostName: string | null, windows: Interval[], day: string): string {
  const who = firstName(hostName);
  const days = PLURAL[weekdayOf(day)] as string;
  if (!windows.length)
    return `${who ?? "The host"} has no working hours on ${days} in HighLevel. Press Book anyway to keep it, or pick another time.`;
  return `That's outside ${who ? possessive(who) : "the host's"} working hours (${hoursWords(windows)} on ${days}). Press Book anyway to keep it, or pick another time.`;
}

/** The line under the custom time when it is free. */
export function freeLine(hostName: string | null): string {
  const who = firstName(hostName);
  return who ? `Free for ${who}, inside working hours.` : "Free, inside working hours.";
}

/**
 * The note under the times when no far-out time is shown for a reason:
 * none (the host has no working hours on this calendar past the window) or
 * unread (the setting or the host's calendar could not be read: never "no
 * free time"). Null when the far times are shown.
 */
export function farNote(state: FarState, hostName: string | null, windowEnd: string | null, why: "calendar" | "setting" = "calendar"): string | null {
  if (state === "ok") return null;
  const who = firstName(hostName);
  if (state === "none")
    return who
      ? `${who} has no working hours on this calendar in HighLevel, so only the booking page's days are offered.`
      : "Nobody on this calendar has working hours in HighLevel past the booking page, so only the booking page's days are offered.";
  const past = windowEnd ? `Times past ${dayWords(windowEnd)}` : "Times past the booking page";
  const cause = why === "setting" ? "the cockpit's booking setting did not answer" : `${who ? possessive(who) : "the host's"} calendar did not answer`;
  return `${past} could not be checked just now: ${cause}. The booking page's days are below.`;
}

/** The host's hours on each weekday of the coming week on this calendar, as "HH:MM" pairs (for Custom time's words). */
export function hostWeek(o: { schedules: Schedule[]; cal: Row; calendarId: string; userId: string; now: number }): Record<WeekKey, [string, string][]> {
  const out = Object.fromEntries(SHORT.map(k => [k, [] as [string, string][]])) as Record<WeekKey, [string, string][]>;
  const today = kuwaitDay(o.now);
  for (let i = 0; i < 7; i++) {
    const day = addDays(today, i);
    out[SHORT[weekdayOf(day)] as WeekKey] = hostWindows(o.schedules, o.cal, o.calendarId, o.userId, day).map(
      ([a, b]) => [clock24(a), b - dayStartMs(day) >= DAY ? "24:00" : clock24(b)] as [string, string],
    );
  }
  return out;
}

/** The page of days book.slots answers: two weeks from `from` (never before today), clipped to the reach. */
export function pageOf(now: number, from: unknown, reachEnd: string): { from: string; to: string; prev: string | null; next: string | null } {
  const today = kuwaitDay(now);
  const last = reachEnd > today ? reachEnd : today;
  let start = isDay(from) && from > today ? from : today;
  if (start > last) start = last;
  const full = addDays(start, SLOT_DAYS - 1);
  const end = full < last ? full : last;
  const back = addDays(start, -SLOT_DAYS);
  return {
    from: start,
    to: end,
    prev: start > today ? (back > today ? back : today) : null,
    next: end < last ? addDays(end, 1) : null,
  };
}

/** The ranges free-slots is asked for, at most 31 days each (HighLevel refuses more). */
export function extendedRanges(from: number, to: number): Interval[] {
  const out: Interval[] = [];
  const max = (EXTENDED_MAX_DAYS - 1) * DAY;
  for (let a = from; a < to; a += max) out.push([a, Math.min(to, a + max)]);
  return out;
}
