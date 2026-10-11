import { nextSlots } from "./booking";
import { clockCountry, leadClock } from "./leadClock";

/**
 * Booking and rescheduling a lead's calls from wherever the call shows
 * (2026-10-11, the CEO: "it should be very easy on the lead section page to
 * reschedule, book demos or intros very easily, or follow up on calls
 * straight from there"). The words, the row's buttons and the picker's
 * lines, pure so they are tested; the screens are CallsCard, CallPicker and
 * TellThem. The contract with sales-api is the plan's section 3.3: the
 * types below are the app's copies of it.
 *
 * Every time is said on Kuwait's clock, 12-hour ("4:30 pm"), and the lead's
 * own clock beside it when it reads differently ("5:30 pm UAE").
 */

export type As = "setter" | "closer";
export type CallKind = "intro" | "demo" | "follow_up";
export type MoveReason = "they_asked" | "host_cant" | "other";
export type MoveSource = "lead" | "today" | "calendar" | "dialer" | "script";

/** The call as book.create and book.move read it back from HighLevel. */
export interface ApptOut {
  id: string;
  kind: CallKind;
  start: string;
  host_user_id: string | null;
  host_name: string | null;
  /** The call's own video link (HighLevel's demo address), when it has one. */
  meet_url: string | null;
}

/** book.slots, for a new booking or a reschedule. */
export interface Slots {
  kind: CallKind;
  calendar_id: string;
  calendar: string;
  minutes: number;
  with: "me" | "anyone" | "same";
  /** Asked for me (or the same host), found none: these are the team's. */
  fallback: boolean;
  on_team: boolean;
  /** The call's host (reschedule) or me (with me). */
  host?: { user_id: string | null; name: string | null } | null;
  /** The calendar's limits in words. */
  notice: string;
  /** "2026-10-14": the last day this calendar opens. */
  until?: string | null;
  days: { day: string; slots: string[] }[];
  /** Reschedule with "anyone": who takes each time, keyed by the slot's ISO. */
  slot_hosts?: Record<string, { user_id: string; name: string | null }>;
  /** Booking only: the call of this kind already booked. */
  existing: {
    id: string;
    start: string;
    words: string;
    kind?: CallKind;
  } | null;
  /** Reschedule only: the call as it stands. */
  moving?: {
    id: string;
    start: string;
    words: string;
    kind?: CallKind;
    host_name?: string | null;
    after_start?: boolean;
  } | null;
  booking_url?: string | null;
  /** The lead's own link to pick another time (D17); null until its format is confirmed. */
  reschedule_link?: string | null;
}

export interface MoveResult {
  result: "moved" | "checking";
  reschedule_id: string;
  from_start: string;
  start: string;
  host_changed: boolean;
  appointment: ApptOut | null;
  words: string;
}

export interface CheckResult {
  result: "moved" | "not_moved" | "checking" | "unverified";
  start: string | null;
  appointment: ApptOut | null;
}

export interface BookResult {
  verified: boolean;
  words: string;
  appointment?: ApptOut | null;
}

/** The refusal codes the picker answers in place (plan 3.3). */
export type RefusalCode =
  | "not_yours"
  | "client"
  | "over"
  | "held"
  | "late"
  | "taken"
  | "clash"
  | "busy"
  | "refused"
  | "not_moved"
  | "past"
  | "note_needed"
  | "already_booked"
  | "rescheduled"
  // sales-api's codes beyond the plan (builder A's list, 2026-10-11):
  | "calendar"
  | "time"
  | "host"
  | "moving"
  | "dnd"
  | "unread";

const MIN = 60_000;
const KUWAIT_MS = 3 * 3_600_000;
/** A call's window opens five minutes before its start. */
export const WINDOW_BEFORE_MS = 5 * MIN;
/** A call can be rescheduled until twenty minutes after its start, never after. */
export const LATE_AFTER_MS = 20 * MIN;
/** The hold before a picked time goes to HighLevel. */
export const HOLD_MS = 4000;
/** book.move.check every five seconds, for a minute at most. */
export const CHECK_EVERY_MS = 5000;
export const CHECK_FOR_MS = 60_000;

const OVER = new Set(["cancelled", "noshow", "showed", "invalid"]);

export function isCallKind(v: unknown): v is CallKind {
  return v === "intro" || v === "demo" || v === "follow_up";
}

/** The call's kind for booking words: a callback is a follow-up call. */
export function kindOf(callType: string | null | undefined): CallKind {
  if (callType === "demo") return "demo";
  if (callType === "follow_up" || callType === "callback") return "follow_up";
  return "intro";
}

/** "intro", "demo", "follow-up call", as a sentence says it. */
export function kindNoun(kind: CallKind): string {
  return kind === "follow_up" ? "follow-up call" : kind;
}

/** "Intro", "Demo", "Follow-up call", at the start of a sentence. */
export function kindTitle(kind: CallKind): string {
  const n = kindNoun(kind);
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/** "an intro", "a demo", "a follow-up call". */
export function aKind(kind: CallKind): string {
  return `${kind === "intro" ? "an" : "a"} ${kindNoun(kind)}`;
}

// ------------------------------------------------------------------ times

const EN_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EN_MONTHS = [
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

interface Wall {
  wd: number;
  day: number;
  month: number;
  hour: number;
  minute: number;
  ymd: string;
}

/** Kuwait's wall clock (UTC+3, never moves). */
function kw(ms: number): Wall {
  const d = new Date(ms + KUWAIT_MS);
  return {
    wd: d.getUTCDay(),
    day: d.getUTCDate(),
    month: d.getUTCMonth(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    ymd: d.toISOString().slice(0, 10),
  };
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>();
function zoneWall(ms: number, zone: string): Wall {
  let f = zoneFormats.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "short",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hourCycle: "h23",
    });
    zoneFormats.set(zone, f);
  }
  const parts = f.formatToParts(new Date(ms));
  const get = (k: string) => parts.find(p => p.type === k)?.value ?? "";
  const month = Number(get("month"));
  const day = Number(get("day"));
  return {
    wd: EN_DAYS.indexOf(get("weekday")),
    day,
    month: month - 1,
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    ymd: `${get("year")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function clock12(w: Wall): { digits: string; ap: "am" | "pm" } {
  return {
    digits: `${w.hour % 12 || 12}:${String(w.minute).padStart(2, "0")}`,
    ap: w.hour < 12 ? "am" : "pm",
  };
}

/** "4:30" and "pm" apart, so the screen sets "pm" small beside the digits. */
export function timeParts(iso: string): { digits: string; ap: "am" | "pm" } {
  return clock12(kw(Date.parse(iso)));
}

/** "4:30 pm", Kuwait time. */
export function time12(iso: string): string {
  const p = timeParts(iso);
  return `${p.digits} ${p.ap}`;
}

/** "Tue 13 Oct", Kuwait time. */
export function dateWords(iso: string): string {
  const w = kw(Date.parse(iso));
  return `${EN_DAYS[w.wd]} ${w.day} ${EN_MONTHS[w.month]}`;
}

/** "Today", "Tomorrow", "Yesterday", or "Tue 13 Oct", by Kuwait's days. */
export function dayWords(iso: string, now = Date.now()): string {
  const t = kw(Date.parse(iso)).ymd;
  if (t === kw(now).ymd) return "Today";
  if (t === kw(now + 86_400_000).ymd) return "Tomorrow";
  if (t === kw(now - 86_400_000).ymd) return "Yesterday";
  return dateWords(iso);
}

/** "Tomorrow, Mon 12 Oct", or "Tue 13 Oct" when it is further off. */
export function dayLine(iso: string, now = Date.now()): string {
  const d = dayWords(iso, now);
  return d === dateWords(iso) ? d : `${d}, ${dateWords(iso)}`;
}

/**
 * A time inside a sentence: "today, 5:00 pm", "tomorrow, 4:30 pm" or
 * "Tue 13 Oct, 5:00 pm" (Kuwait time).
 */
export function whenWords(iso: string, now = Date.now()): string {
  const d = dayWords(iso, now);
  const day = d === dateWords(iso) ? d : d.toLowerCase();
  return `${day}, ${time12(iso)}`;
}

/** After "is": "tomorrow, 4:30 pm", or "on Tue 13 Oct, 5:00 pm". */
export function isWhen(iso: string, now = Date.now()): string {
  const d = dayWords(iso, now);
  return d === dateWords(iso)
    ? `on ${whenWords(iso, now)}`
    : whenWords(iso, now);
}

/** The six Gulf clocks by zone, as a line on the screen names them. */
const GULF: Record<string, { the: string; short: string }> = {
  "Asia/Kuwait": { the: "Kuwait", short: "Kuwait" },
  "Asia/Riyadh": { the: "Saudi", short: "Saudi" },
  "Asia/Dubai": { the: "the UAE", short: "UAE" },
  "Asia/Qatar": { the: "Qatar", short: "Qatar" },
  "Asia/Bahrain": { the: "Bahrain", short: "Bahrain" },
  "Asia/Muscat": { the: "Oman", short: "Oman" },
};

export interface LeadLike {
  contact_id: string;
  name?: string | null;
  company?: string | null;
  country?: string | null;
  phone?: string | null;
  dnd?: boolean | null;
  tags?: readonly string[] | null;
}

/** The lead's clock: a Gulf number's own, else the stored country's; Kuwait when not known. */
export function leadZoneOf(lead: Pick<LeadLike, "country" | "phone">): string {
  return leadClock(clockCountry(lead.country, lead.phone)) ?? "Asia/Kuwait";
}

function place(zone: string): { the: string; short: string } {
  const g = GULF[zone];
  if (g) return g;
  const city = (zone.split("/").pop() ?? zone).replace(/_/g, " ");
  return { the: city, short: city };
}

/**
 * The lead's own clock for a time, when it reads differently from
 * Kuwait's: the time ("5:30 pm", or "Mon 1:00 am" across midnight) and the
 * place. Null on Kuwait's clock (Qatar, Bahrain and Saudi read the same).
 */
function theirClock(
  iso: string,
  lead: LeadLike,
): { time: string; place: { the: string; short: string } } | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const zone = leadZoneOf(lead);
  const k = kw(t);
  const l = zoneWall(t, zone);
  if (l.hour === k.hour && l.minute === k.minute && l.ymd === k.ymd)
    return null;
  const c = clock12(l);
  const day = l.ymd !== k.ymd ? `${EN_DAYS[l.wd]} ` : "";
  return { time: `${day}${c.digits} ${c.ap}`, place: place(zone) };
}

/** The lead's clock under a time: "5:30 pm UAE", or null on Kuwait's clock. */
export function theirTime(iso: string, lead: LeadLike): string | null {
  const c = theirClock(iso, lead);
  return c ? `${c.time} ${c.place.short}` : null;
}

/** The first name a line calls the lead by; nothing for a business's name. */
export function leadFirst(lead: LeadLike): string {
  const name = String(lead.name ?? "").trim();
  if (!name) return "";
  const company = String(lead.company ?? "").trim();
  if (company && company.toLowerCase() === name.toLowerCase()) return "";
  const first = name.split(/\s+/)[0] ?? "";
  return /^(شركة|شركه|مؤسسة|مؤسسه|مكتب|مجموعة|مجموعه|مصنع|معرض|ورشة|ورشه|استوديو|ستوديو|مركز|دار|company|co\.?|corp\.?|group|studio|office|est\.?|establishment|the)$/i.test(
    first,
  )
    ? ""
    : first;
}

function offsetMinutes(zone: string, at: number): number {
  const l = zoneWall(at, zone);
  const k = kw(at);
  const lm = Date.UTC(2000, 0, 1, l.hour, l.minute) + dayDiff(l.ymd, k.ymd);
  const km = Date.UTC(2000, 0, 1, k.hour, k.minute);
  return Math.round((lm - km) / MIN);
}

function dayDiff(a: string, b: string): number {
  return Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`);
}

function hoursWords(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!m) return h === 1 ? "an hour" : `${h} hours`;
  if (m === 30) return h ? `${h} and a half hours` : "half an hour";
  return `${h} h ${m} min`;
}

/**
 * The lead's clock in words, under a picker's title: "Mona is in the UAE,
 * an hour ahead." / "The same time in Saudi." / nothing for Kuwait.
 */
export function clockLine(lead: LeadLike, now = Date.now()): string | null {
  const zone = leadZoneOf(lead);
  if (zone === "Asia/Kuwait") return null;
  const p = place(zone);
  const off = offsetMinutes(zone, now);
  if (off === 0) return `The same time in ${p.the}.`;
  const who = leadFirst(lead) || "They";
  const verb = who === "They" ? "are" : "is";
  return `${who} ${verb} in ${p.the}, ${hoursWords(Math.abs(off))} ${off > 0 ? "ahead" : "behind"}.`;
}

/**
 * The line under a call on its row: "Demo with Ahmad Al Mutairi. 5:30 pm
 * for Mona, in the UAE."
 */
export function callSubLine(
  kind: CallKind,
  host: string | null | undefined,
  iso: string | null,
  lead: LeadLike,
): string {
  const who = host?.trim() ? ` with ${host.trim()}` : "";
  const first = `${kindTitle(kind)}${who}.`;
  if (!iso) return first;
  const c = theirClock(iso, lead);
  if (!c) return first;
  const name = leadFirst(lead) || "them";
  return `${first} ${c.time} for ${name}, in ${c.place.the}.`;
}

// ------------------------------------------------------------------ rows

export interface CallRowLike {
  appointment_id: string;
  call_type: string | null;
  start_at: string | null;
  status: string | null;
  marked_status?: string | null;
  assigned_user_id?: string | null;
  assigned_user_name?: string | null;
  needs_mark?: boolean;
  rescheduled_at?: string | null;
  crm_rescheduled_at?: string | null;
}

export type RowPhase = "ahead" | "window" | "owed" | "done";

/** Where a call stands: ahead, in its window, past it unmarked, or over. */
export function rowPhase(
  row: CallRowLike,
  now = Date.now(),
  start: string | null = row.start_at,
): RowPhase {
  const status = String(row.marked_status ?? row.status ?? "");
  if (OVER.has(status)) return "done";
  const t = start ? Date.parse(start) : Number.NaN;
  if (!Number.isFinite(t)) return "done";
  if (t - now > WINDOW_BEFORE_MS) return "ahead";
  if (now - t <= LATE_AFTER_MS) return "window";
  // A follow-up call or a callback has no mark: once past, it is over.
  return kindOf(row.call_type) === "follow_up" ? "done" : "owed";
}

export type RowAction =
  | "reschedule"
  | "tell"
  | "showed"
  | "didnt"
  | "disqualify";

/**
 * The buttons a call's row shows (the design's table): ahead, Reschedule
 * and Tell them; in its window, Showed, Didn't happen and Reschedule; past
 * it unmarked, Showed, Didn't happen and Disqualify; a no-show or a
 * cancelled call, Tell them (the latest miss only); a follow-up call has no
 * marks. Nothing for an active client, and no Tell them on do not disturb.
 */
export function rowActions(
  row: CallRowLike,
  now: number,
  ctx: {
    client: boolean;
    dnd: boolean;
    /** This is the lead's latest missed call (a no-show or cancelled). */
    latestMiss?: boolean;
    start?: string | null;
  },
): RowAction[] {
  if (ctx.client) return [];
  const phase = rowPhase(row, now, ctx.start ?? row.start_at);
  const followUp = kindOf(row.call_type) === "follow_up";
  // sales-api reschedules a call on an intro, demo or follow-up call
  // calendar only (409 calendar): a callback request is moved in HighLevel.
  const movable = isCallKind(row.call_type);
  let out: RowAction[];
  if (phase === "ahead") out = ["reschedule", "tell"];
  else if (phase === "window")
    out = followUp ? ["reschedule", "tell"] : ["showed", "didnt", "reschedule"];
  else if (phase === "owed") out = ["showed", "didnt", "disqualify"];
  else {
    const status = String(row.marked_status ?? row.status ?? "");
    out =
      ctx.latestMiss && (status === "noshow" || status === "cancelled")
        ? ["tell"]
        : [];
  }
  if (!movable) out = out.filter(a => a !== "reschedule");
  return ctx.dnd ? out.filter(a => a !== "tell") : out;
}

export interface CallGroups<T> {
  /** The soonest call still ahead or in its window. */
  next: T | null;
  /** Any later calls still ahead. */
  coming: T[];
  /** Past their window and not marked. */
  owed: T[];
  /** Marked, called off or finished, newest first. */
  before: T[];
}

/** A lead's calls in the Calls card's groups. `startOf` reads a just-moved call's new time. */
export function groupCalls<T extends CallRowLike>(
  rows: T[],
  now: number,
  startOf: (r: T) => string | null = r => r.start_at,
): CallGroups<T> {
  const at = (r: T) => {
    const s = startOf(r);
    const t = s ? Date.parse(s) : Number.NaN;
    return Number.isFinite(t) ? t : 0;
  };
  const live: T[] = [];
  const owed: T[] = [];
  const before: T[] = [];
  for (const r of rows) {
    const p = rowPhase(r, now, startOf(r));
    if (p === "ahead" || p === "window") live.push(r);
    else if (p === "owed") owed.push(r);
    else before.push(r);
  }
  live.sort((a, b) => at(a) - at(b));
  owed.sort((a, b) => at(b) - at(a));
  before.sort((a, b) => at(b) - at(a));
  return { next: live[0] ?? null, coming: live.slice(1), owed, before };
}

/** The newest no-show or cancelled intro or demo, when nothing of its kind was booked after it. */
export function latestMiss<T extends CallRowLike>(
  rows: T[],
  now = Date.now(),
): T | null {
  const misses = rows
    .filter(r => {
      const s = String(r.marked_status ?? r.status ?? "");
      return (
        (s === "noshow" || s === "cancelled") &&
        r.start_at &&
        Number.isFinite(Date.parse(r.start_at)) &&
        now - Date.parse(r.start_at) < 14 * 86_400_000
      );
    })
    .sort(
      (a, b) => Date.parse(String(b.start_at)) - Date.parse(String(a.start_at)),
    );
  return misses[0] ?? null;
}

/** A later live call of the same kind as a missed one: it was booked again. */
export function bookedAgain<T extends CallRowLike>(
  missed: T,
  rows: T[],
  now = Date.now(),
): T | null {
  const kind = kindOf(missed.call_type);
  const from = Date.parse(String(missed.start_at));
  return (
    rows
      .filter(
        r =>
          r.appointment_id !== missed.appointment_id &&
          kindOf(r.call_type) === kind &&
          r.start_at &&
          Date.parse(r.start_at) > from &&
          ["ahead", "window"].includes(rowPhase(r, now)),
      )
      .sort(
        (a, b) =>
          Date.parse(String(a.start_at)) - Date.parse(String(b.start_at)),
      )[0] ?? null
  );
}

/**
 * The booking the lead's calls suggest when nothing is booked: no intro
 * held, an intro; an intro held, a demo; a demo held and not signed, a
 * follow-up call. Null when a call is booked, or for a signed client.
 */
export function suggestedBook(
  rows: CallRowLike[],
  signed: boolean,
  now = Date.now(),
): CallKind | null {
  if (signed) return null;
  if (rows.some(r => ["ahead", "window"].includes(rowPhase(r, now))))
    return null;
  const held = (k: CallKind) =>
    rows.some(
      r =>
        kindOf(r.call_type) === k &&
        r.call_type !== "callback" &&
        String(r.marked_status ?? r.status ?? "") === "showed",
    );
  if (held("demo")) return "follow_up";
  if (held("intro")) return "demo";
  return "intro";
}

/** The chip a live call wears: Rescheduled for a day after a move, else its state. */
export function liveChip(
  row: CallRowLike,
  now = Date.now(),
  movedHere = false,
): { tone: "good" | "neutral"; label: string } {
  const at = [row.rescheduled_at, row.crm_rescheduled_at]
    .map(s => (s ? Date.parse(s) : Number.NaN))
    .filter(Number.isFinite);
  const recent = at.some(t => now - t < 86_400_000 && now - t > -MIN);
  if (movedHere || recent) return { tone: "good", label: "Rescheduled" };
  const s = String(row.status ?? "");
  if (s === "confirmed") return { tone: "neutral", label: "Confirmed" };
  return { tone: "neutral", label: "Booked" };
}

// ------------------------------------------------------------------ picker

/** Who books a new call by default: the seat itself when it hosts that kind of call, else whoever is free. */
export function defaultWith(
  kind: CallKind,
  role: string | null | undefined,
): "me" | "anyone" {
  const r = String(role ?? "");
  if (r === "manager" || r === "both") return "me";
  if (kind === "intro") return r === "closer" ? "anyone" : "me";
  return r === "setter" ? "anyone" : "me";
}

export interface Tile {
  iso: string;
  /** "Today", "Tomorrow", "Tue 13 Oct". */
  day: string;
  digits: string;
  ap: "am" | "pm";
  /** The lead's clock when it differs: "7:20 pm UAE". */
  theirs: string | null;
  /** Who takes it, for a reschedule offered with anyone free. */
  host: string | null;
  hostId: string | null;
}

export function tileOf(
  iso: string,
  lead: LeadLike,
  now = Date.now(),
  hosts?: Slots["slot_hosts"],
): Tile {
  const p = timeParts(iso);
  const h = hosts?.[iso] ?? null;
  return {
    iso,
    day: dayWords(iso, now),
    digits: p.digits,
    ap: p.ap,
    theirs: theirTime(iso, lead),
    host: h ? h.name?.split(/\s+/)[0] || h.name || null : null,
    hostId: h?.user_id ?? null,
  };
}

/** The soonest `n` free times as tiles. */
export function tiles(
  slots: Pick<Slots, "days" | "slot_hosts"> | null | undefined,
  lead: LeadLike,
  n = 4,
  now = Date.now(),
): Tile[] {
  return nextSlots(slots?.days, n, now).map(iso =>
    tileOf(iso, lead, now, slots?.slot_hosts),
  );
}

/** Another day's chips: each day with free times still ahead, and how many. */
export function dayChips(
  slots: Pick<Slots, "days"> | null | undefined,
  now = Date.now(),
): { day: string; label: string; count: number; slots: string[] }[] {
  return (slots?.days ?? [])
    .map(d => {
      const ahead = (d.slots ?? []).filter(s => Date.parse(s) > now);
      const first = ahead[0] ?? `${d.day}T12:00:00+03:00`;
      return {
        day: d.day,
        label: dayWords(first, now),
        count: ahead.length,
        slots: ahead,
      };
    })
    .filter(d => d.count > 0);
}

/** How far the calendar opens: "up to Wed 14 Oct", from `until` or the last day with a time. */
export function untilWords(
  slots: Pick<Slots, "days" | "until"> | null | undefined,
): string | null {
  const day =
    slots?.until ||
    [...(slots?.days ?? [])].reverse().find(d => d.slots?.length)?.day ||
    null;
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  return `up to ${dateWords(`${day}T12:00:00+03:00`)}`;
}

/** The first name a line gives the host. */
export function firstOf(name: string | null | undefined): string {
  return (
    String(name ?? "")
      .trim()
      .split(/\s+/)[0] ?? ""
  );
}

/**
 * What the picker is changing, in words: "Now tomorrow, 4:30 pm, with Ahmad
 * (the same person). Kuwait time, 45 minutes." For a booking, the length.
 */
export function pickerLine(o: {
  mode: "reschedule" | "book";
  start?: string | null;
  host?: string | null;
  minutes?: number | null;
  now?: number;
}): string {
  const mins = o.minutes ? `, ${o.minutes} minutes` : "";
  if (o.mode === "book") return `Kuwait time${mins}.`;
  const host = firstOf(o.host);
  const when = o.start ? `Now ${whenWords(o.start, o.now)}` : "Now";
  return `${when}${host ? `, with ${host} (the same person)` : ""}. Kuwait time${mins}.`;
}

/** The hold strip's words: "Rescheduling to Tue 13 Oct, 5:00 pm". */
export function holdWords(
  mode: "reschedule" | "book",
  kind: CallKind,
  iso: string,
  now = Date.now(),
): string {
  return mode === "reschedule"
    ? `Rescheduling to ${whenWords(iso, now)}`
    : `Booking the ${kindNoun(kind)} for ${whenWords(iso, now)}`;
}

/** The done state's title, and the toast's words. */
export function doneTitle(
  mode: "reschedule" | "book",
  kind: CallKind,
  iso: string,
  now = Date.now(),
): string {
  return mode === "reschedule"
    ? `Rescheduled to ${whenWords(iso, now)}`
    : `${kindTitle(kind)} booked for ${whenWords(iso, now)}`;
}

/** Under the done title: the host, the lead's clock, and what HighLevel does now. */
export function doneSub(o: {
  mode: "reschedule" | "book";
  iso: string;
  lead: LeadLike;
  host: string | null;
  /** The host before a move, when it changed. */
  wasHost?: string | null;
  missed?: boolean;
}): string {
  const host = firstOf(o.host);
  const was = firstOf(o.wasHost);
  const withWho = host
    ? was && was !== host
      ? `, now with ${host} instead of ${was}`
      : `, with ${host}`
    : "";
  const c = theirClock(o.iso, o.lead);
  const name = leadFirst(o.lead) || "them";
  const clock = c ? `; ${c.time} for ${name} in ${c.place.the}` : "";
  const tail =
    o.mode === "reschedule"
      ? "HighLevel's reminders now follow the new time."
      : o.missed
        ? "The missed call is marked, and HighLevel sends them its confirmation."
        : "HighLevel sends them its confirmation.";
  return `Kuwait time${withWho}${clock}. ${tail}`;
}

/** The line a booking made after a missed call starts with. */
export function againLine(
  missedStart: string | null | undefined,
  kind: CallKind,
  rep: string | null | undefined,
): string {
  const at = missedStart
    ? `the ${time12(missedStart)} ${kindNoun(kind)}`
    : `the ${kindNoun(kind)}`;
  const by = firstOf(rep);
  return `Missed ${at}. Booked again${by ? ` by ${by}` : ""}.`;
}

/** The "No free times" line, for a booking and for a reschedule. */
export function noTimesLine(o: {
  mode: "reschedule" | "book";
  host?: string | null;
  until?: string | null;
  withWho?: "me" | "anyone" | "same";
  onTeam?: boolean;
}): string {
  const who = firstOf(o.host) || (o.withWho === "anyone" ? "Nobody" : "You");
  const verb = who === "You" ? "have" : "has";
  const span = o.until ? ` ${o.until}` : " in the days the calendar opens";
  const head = `${who} ${verb} no free time${span}.`;
  if (o.mode === "reschedule")
    return o.withWho === "anyone"
      ? `${head} Reschedule it in HighLevel, or try again later.`
      : `${head} Show anyone free, or reschedule it in HighLevel.`;
  return o.withWho === "me" && o.onTeam
    ? `${head} Try Anyone free.`
    : `${head} Book in HighLevel, or set a call-back in the dialer.`;
}

/** How a refusal is answered inside the picker. */
export interface RefusalAnswer {
  text: string;
  tone: "warn" | "bad";
  /** Read the free times again (the time was taken, or is past). */
  reread: boolean;
  /** The call cannot be rescheduled from here: the times go away. */
  blocked: boolean;
}

/** A refusal's code, read into what the picker does with it; the server's sentence is kept. */
export function refusalLine(
  code: string | null | undefined,
  message: string,
): RefusalAnswer {
  const text = message.trim() || "HighLevel refused it. Try again.";
  switch (code) {
    case "taken":
    case "past":
    // The time could not be read, or its host is not on the calendar: the
    // times are read again so the next press is one the calendar offers.
    case "time":
    case "host":
      return { text, tone: "warn", reread: true, blocked: false };
    case "not_yours":
    case "client":
    case "over":
    case "held":
    case "late":
    case "rescheduled":
    // Not on an intro, demo or follow-up call calendar: moved in HighLevel.
    case "calendar":
      return { text, tone: "warn", reread: false, blocked: true };
    case "refused":
      return { text, tone: "bad", reread: false, blocked: false };
    default:
      return { text, tone: "warn", reread: false, blocked: false };
  }
}

/** The toast after a booking or a move (success only). */
export function toastWords(
  mode: "reschedule" | "book",
  kind: CallKind,
  iso: string,
  now = Date.now(),
): string {
  return `${doneTitle(mode, kind, iso, now)}.`;
}

/** The Why chips of a reschedule. */
export function reasonChips(
  host: string | null | undefined,
): [MoveReason, string][] {
  const h = firstOf(host);
  return [
    ["they_asked", "They asked"],
    ["host_cant", `${h || "The host"} can't make it`],
    ["other", "Other"],
  ];
}

/** True when a key press is one of the picker's keys and not typing. */
export function pickerKey(
  e: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean },
  typing: boolean,
): "1" | "2" | "3" | "4" | "a" | "esc" | null {
  if (e.altKey || e.ctrlKey || e.metaKey) return null;
  if (e.key === "Escape") return "esc";
  if (typing) return null;
  if (/^[1-4]$/.test(e.key)) return e.key as "1" | "2" | "3" | "4";
  if (e.key === "a" || e.key === "A") return "a";
  return null;
}
