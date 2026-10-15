// Rescheduling a call from the cockpit (the CEO, 2026-10-11: "make sure that
// it's really easy to reschedule any intro or demo calls"). The rules a move
// is judged by, with no network in them, so bun can test every one
// (reschedule.test.ts). index.ts book.slots, book.move, book.move.check and
// book.told run them; sales-mirror's lib.ts keeps a copy of holdStart and
// meetUrl (an Edge Function cannot import from another), with the same tests.
//
// A move is made in place in HighLevel (PUT on the same appointment id), never
// as a cancel and a new booking, so HighLevel's own reminders, the Zoom
// address, the WhatsApp group, the script notes and the closer all stay with
// the call, and the numbers never count a move as a cancel plus a booking.

type Row = Record<string, unknown>;

export type CallKind = "intro" | "demo" | "follow_up";
export type MoveReason = "they_asked" | "host_cant" | "other";
export type MoveSource = "lead" | "today" | "calendar" | "dialer" | "script";
export type MoveState = "moving" | "moved" | "not_moved" | "failed" | "unverified";
export type ToldHow = "whatsapp" | "copy" | "link_whatsapp" | "link_copy";

export const CALL_KINDS: readonly CallKind[] = ["intro", "demo", "follow_up"];
export const MOVE_REASONS: readonly MoveReason[] = ["they_asked", "host_cant", "other"];
export const MOVE_SOURCES: readonly MoveSource[] = ["lead", "today", "calendar", "dialer", "script"];
export const TOLD_HOW: readonly ToldHow[] = ["whatsapp", "copy", "link_whatsapp", "link_copy"];

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const KUWAIT = 3 * HOUR;

/** A call can be rescheduled until this long after its start; after that it is marked and booked again. */
export const LATE_AFTER_MS = 20 * MIN;
/** A "moving" row older than this was cut off half way: it is settled by reading HighLevel before anything else. */
export const STALE_MOVING_MS = 2 * MIN;
/** book.move.check gives up waiting for HighLevel after this long and leaves the move for a person. */
export const CHECK_GIVE_UP_MS = 60_000;
/** A move whose answer was lost is never judged "not moved" while its own PUT could still be on its way. */
export const PUT_MAY_LAND_MS = 30_000;
/** The mirror's hold on a cockpit reschedule warns the run once it is older than this. */
export const HOLD_WARN_MS = HOUR;
/** Two times within this of each other are the same time (HighLevel writes whole minutes). */
export const SAME_TIME_MS = MIN;
/** The early-mark allowance refuseMark uses (lib.ts): a call can be marked from ten minutes before its start. */
export const MARK_EARLY_MS = 10 * MIN;

/** The calendars setting (cockpit_sales_settings.calendars): calendar id → its type and label. */
export type CalendarsSetting = Record<string, { type?: string; label?: string } | undefined>;

/**
 * What kind of call a calendar holds, from the calendars setting: "Demo 2"
 * is a demo, "Follow up call" is a follow-up call, and a calendar the
 * setting does not name (or names as a callback) is none of the three. Never
 * "anything that is not a demo is an intro".
 */
export function kindOfCalendar(calendarId: unknown, calendars: CalendarsSetting | null | undefined): CallKind | null {
  const t = calendars?.[String(calendarId ?? "")]?.type;
  return t === "intro" || t === "demo" || t === "follow_up" ? t : null;
}

/** The one Follow up call calendar in the setting, or null when there is none (or more than one). */
export function followUpCalendar(calendars: CalendarsSetting | null | undefined): string | null {
  const ids = Object.entries(calendars ?? {})
    .filter(([, c]) => c?.type === "follow_up")
    .map(([id]) => id);
  return ids.length === 1 ? (ids[0] as string) : null;
}

/** "intro", "demo", "follow-up call": the call in a sentence. */
export function kindWords(kind: CallKind): string {
  return kind === "follow_up" ? "follow-up call" : kind;
}

/** "an intro", "a demo", "a follow-up call". */
export function kindWithArticle(kind: CallKind): string {
  return kind === "intro" ? "an intro" : `a ${kindWords(kind)}`;
}

/** "Intro booked", "Demo booked", "Follow-up call booked": the toast's words. */
export function bookedWords(kind: CallKind): string {
  const w = kindWords(kind);
  return `${w[0]?.toUpperCase()}${w.slice(1)} booked`;
}

/** "Tue 13 Oct, 5:00 pm" in Kuwait time (12-hour, as the lead hears it and the page shows it). */
export function kuwaitWords12(ms: number): string {
  const d = new Date(ms + KUWAIT);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  const h = d.getUTCHours();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${day} ${d.getUTCDate()} ${mon}, ${h12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/** The Kuwait day of an instant, "2026-10-13". */
export function kuwaitDay(ms: number): string {
  return new Date(ms + KUWAIT).toISOString().slice(0, 10);
}

/** A time from any of the shapes we meet (ISO, "2026-10-14 11:00:00+00", epoch ms), or null. */
export function instant(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

/** Two times are the same time (within a minute). */
export function sameTime(a: number | null, b: number | null): boolean {
  return a !== null && b !== null && Math.abs(a - b) < SAME_TIME_MS;
}

/** A refusal the server answers with: its code, its HTTP status and one sentence that says what to do next. */
export interface Refused {
  code: string;
  status: number;
  message: string;
}

/** The first word of a name ("Ahmad" from "Ahmad Al Mutairi"), or null. */
export function firstName(name: unknown): string | null {
  const n = String(name ?? "").trim().split(/\s+/)[0];
  return n ? n : null;
}

export interface MoveCall {
  start_at?: unknown;
  /** HighLevel's status on the cockpit's copy. */
  status?: unknown;
  assigned_user_id?: unknown;
}

const OVER = ["cancelled", "noshow", "showed", "invalid"];
const OVER_WORDS: Record<string, string> = {
  cancelled: "cancelled",
  noshow: "no-show",
  showed: "held",
  invalid: "disqualified",
};

/**
 * Whether this seat may reschedule this call now, or why not, in this order
 * (D41 to D43):
 * - not_yours (403): a manager, the call's host, the lead's owner, or the
 *   seat that booked it may; anyone else is told whose call it is.
 * - client (409): an active client stays out of every sales process.
 * - over (409): marked, or cancelled, no-show, held or disqualified.
 * - held (409): the lead joined the video room for it, so it happened.
 * - late (409): more than 20 minutes past its start: it is marked and booked
 *   again, so a missed call is never hidden by a move.
 */
export function canReschedule(o: {
  appt: MoveCall;
  /** The cockpit's current mark on the call (cockpit_sales_dispositions.status), or null. */
  mark: string | null;
  /** The lead joined the video room for this call (a join that stands). */
  joined: boolean;
  who: { manager?: boolean; email?: string | null; ghl_user_id?: string | null };
  /** The lead's owner in HighLevel (cockpit_sales_leads.assigned_to). */
  owner: string | null;
  /** The seat that booked the call from the cockpit (cockpit_sales_bookings.rep_email), or null. */
  bookerEmail: string | null;
  client: boolean;
  clientMessage: string;
  now: number;
  hostName?: string | null;
  leadName?: string | null;
}): Refused | null {
  const host = o.appt.assigned_user_id ? String(o.appt.assigned_user_id) : null;
  const me = o.who.ghl_user_id ? String(o.who.ghl_user_id) : null;
  const email = String(o.who.email ?? "").toLowerCase();
  const mine =
    Boolean(o.who.manager) ||
    (me !== null && (me === host || me === o.owner)) ||
    (email !== "" && email === String(o.bookerEmail ?? "").toLowerCase());
  if (!mine) {
    const name = firstName(o.hostName);
    return {
      code: "not_yours",
      status: 403,
      message: name
        ? `This call is ${name}'s. Ask ${name} or a manager to reschedule it.`
        : "This call is another rep's. Ask them or a manager to reschedule it.",
    };
  }
  if (o.client) return { code: "client", status: 409, message: o.clientMessage };
  const mark = o.mark && OVER.includes(o.mark) ? o.mark : null;
  const status = String(o.appt.status ?? "");
  if (mark || OVER.includes(status)) {
    const said = OVER_WORDS[mark ?? status] ?? "over";
    return {
      code: "over",
      status: 409,
      message:
        (mark ?? status) === "cancelled"
          ? "This call was cancelled. Book a new one instead."
          : `This call is already marked ${said}. Book a new one instead.`,
    };
  }
  if (o.joined) {
    const lead = firstName(o.leadName);
    return {
      code: "held",
      status: 409,
      message: `${lead ?? "The lead"} joined the video call for this one, so it happened. Mark it instead.`,
    };
  }
  const start = instant(o.appt.start_at);
  if (start !== null && o.now > start + LATE_AFTER_MS)
    return {
      code: "late",
      status: 409,
      message: "This call started more than 20 minutes ago, so it can't be rescheduled. Mark how it went, then book it again.",
    };
  return null;
}

/**
 * HighLevel's own status for the call, read just before a move (D46), when
 * it says the call is over: the cockpit's copy is B2B's and can be a quarter
 * hour behind, so a lead who cancelled through HighLevel's link a minute ago
 * still shows "confirmed" here. Moving that appointment would put a
 * cancelled call at a new time (and tell the lead so) while the page says
 * Rescheduled. Null when HighLevel's status lets it move, or is unknown.
 */
export function overInCrm(status: unknown): Refused | null {
  const s = String(status ?? "").trim().toLowerCase();
  if (!OVER.includes(s)) return null;
  return {
    code: "over",
    status: 409,
    message:
      s === "cancelled"
        ? "This call was cancelled in HighLevel. Book a new one instead."
        : `This call is already marked ${OVER_WORDS[s] ?? "over"} in HighLevel. Book a new one instead.`,
  };
}

/** A call of the lead's that a new time must not overlap. */
export interface LiveCall {
  id: string;
  start: number;
  end: number | null;
  kind?: CallKind | null;
}

/**
 * Another live call of the same lead that overlaps [start, end), or null. A
 * call with no end known is taken as `fallbackMs` long.
 */
export function clash(start: number, end: number, others: LiveCall[], fallbackMs = 45 * MIN): LiveCall | null {
  for (const c of others) {
    const cEnd = c.end !== null && c.end > c.start ? c.end : c.start + fallbackMs;
    if (start < cEnd && c.start < end) return c;
  }
  return null;
}

/** The sentence for a clash. */
export function clashMessage(c: LiveCall): string {
  return `That time overlaps their ${c.kind ? kindWords(c.kind) : "other call"} on ${kuwaitWords12(c.start)} (Kuwait time). Pick another.`;
}

/**
 * What HighLevel's error means for a write: `refused` is an HTTP answer
 * (4xx: HighLevel said no, nothing changed); `unknown` is no answer (a
 * timeout, a 5xx, a page that could not be read), so it may have landed and
 * HighLevel itself is read to find out.
 */
export function classifyGhl(e: unknown): "refused" | "unknown" {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500 ? "refused" : "unknown";
}

/**
 * HighLevel's own time for the call, read back after the move, judged:
 * at the new time it moved; at the old time it did not; anywhere else
 * HighLevel shows something we did not ask for; null when it could not be read.
 */
export function settle(readBack: number | null, from: number, to: number): "moved" | "not_moved" | "unverified" | null {
  if (readBack === null) return null;
  if (sameTime(readBack, to)) return "moved";
  if (sameTime(readBack, from)) return "not_moved";
  return "unverified";
}

/** The words a move HighLevel said yes to but still shows at the old time is kept with (book.move.check reads them). */
export const PUT_OK_NOTE = "HighLevel took the move, but its copy still showed the old time.";

/**
 * Where a move stands once HighLevel's own copy is read (D46, D47):
 * - at the new time: moved;
 * - at a third time: unverified (someone moved it elsewhere; a person checks);
 * - at the old time: HighLevel said yes (`putOk`) and has not caught up, so
 *   it waits a minute, then is left for a person; HighLevel never answered,
 *   so not moved, unless the PUT may still be on its way (`inFlight`);
 * - unreadable: waits a minute, then is left for a person.
 * "moving" means: ask again in a few seconds.
 */
export function moveVerdict(o: {
  readBack: number | null;
  from: number;
  to: number;
  putOk: boolean;
  age: number;
  inFlight: boolean;
}): { state: "moved" | "not_moved" | "unverified" | "moving"; why: string | null } {
  const v = settle(o.readBack, o.from, o.to);
  if (v === "moved") return { state: "moved", why: null };
  if (v === "unverified")
    return { state: "unverified", why: `HighLevel shows the call at ${kuwaitWords12(o.readBack as number)}, a time nobody picked here.` };
  if (v === "not_moved") {
    if (o.putOk) return o.age < CHECK_GIVE_UP_MS ? { state: "moving", why: PUT_OK_NOTE } : { state: "unverified", why: PUT_OK_NOTE };
    return o.inFlight ? { state: "moving", why: null } : { state: "not_moved", why: "HighLevel did not answer, and still shows the old time." };
  }
  return o.age < CHECK_GIVE_UP_MS
    ? { state: "moving", why: null }
    : { state: "unverified", why: "HighLevel's copy of the call could not be read for a minute." };
}

/** The answer when HighLevel never answered and the call is still where it was. */
export function notMovedMessage(from: number): string {
  return `HighLevel did not answer, and the call is still at ${kuwaitWords12(from)}. Press the time again.`;
}

/** HighLevel's reason in a refusal, without the "HighLevel said 422:" lead-in. */
export function ghlReason(e: unknown): string {
  const m = String((e as Error)?.message ?? e ?? "")
    .replace(/^HighLevel said \d+:\s*/, "")
    .trim()
    .replace(/[.\s]+$/, "");
  return m ? m.slice(0, 200) : "no reason given";
}

/** "Why: they asked." and the like, for the note. */
export function reasonWords(reason: MoveReason, note: string | null, hostName: string | null): string {
  if (reason === "they_asked") return "they asked";
  if (reason === "host_cant") return `${firstName(hostName) ?? "the host"} can't make it`;
  const n = String(note ?? "").trim().replace(/[.\s]+$/, "");
  return n || "other";
}

/**
 * The one HighLevel note a move leaves (D18): it names the new time once.
 * "Rescheduled the demo from Mon 12 Oct, 4:30 pm to Tue 13 Oct, 5:00 pm
 * (Kuwait time), with Ahmad Al Mutairi. By Sara Khalil in the cockpit. Why:
 * they asked."
 */
export function moveNoteText(o: {
  kind: CallKind;
  from: number;
  to: number;
  hostName: string | null;
  previousHostName?: string | null;
  hostChanged?: boolean;
  repName: string;
  reason: MoveReason;
  note: string | null;
  afterStart?: boolean;
}): string {
  const host = o.hostName
    ? `, with ${o.hostName}${o.hostChanged && o.previousHostName ? ` (instead of ${o.previousHostName})` : ""}`
    : "";
  const late = o.afterStart ? " The call's start had passed." : "";
  return `Rescheduled the ${kindWords(o.kind)} from ${kuwaitWords12(o.from)} to ${kuwaitWords12(o.to)} (Kuwait time)${host}. By ${o.repName} in the cockpit. Why: ${reasonWords(o.reason, o.note, o.previousHostName ?? o.hostName)}.${late}`;
}

/** The answer when the lead already has a call of this kind ahead (book.create, D40). */
export function alreadyBookedMessage(kind: CallKind, start: number): string {
  return `They already have ${kindWithArticle(kind)} on ${kuwaitWords12(start)} (Kuwait time). Reschedule that one instead of booking a second.`;
}

/** The answer when a mark is pressed against the old time of a call moved in the cockpit (D35). */
export function rescheduledMarkMessage(to: number): string {
  return `This call was rescheduled to ${kuwaitWords12(to)}. Mark it after then.`;
}

/**
 * Whether a confirmation counts for a call as it stands now (D37): a "the
 * lead agreed" kind of row, made for the call's current start (within a
 * minute). A row that names no start counts, as before.
 */
export function confirmationCounts(c: { result?: unknown; start_at?: unknown }, call: { start_at?: unknown }): boolean {
  if (!["confirmed", "reschedule"].includes(String(c.result ?? ""))) return false;
  const at = instant(c.start_at);
  if (at === null) return true;
  return sameTime(at, instant(call.start_at));
}

/** The Zoom join link in a HighLevel address, or null (an intro's address is often the lead's phone). */
export function meetUrl(address: unknown): string | null {
  const a = String(address ?? "").trim();
  return /^https:\/\/[a-z0-9.-]*zoom\.us\//i.test(a) ? a.slice(0, 500) : null;
}

// ---------------------------------------------------------------------------
// The mirror's hold (D34). sales-mirror/lib.ts keeps a copy of this block.
// ---------------------------------------------------------------------------

/** An open reschedule of a call (cockpit_sales_reschedules in state moved, neither caught nor released). */
export interface Hold {
  id: string;
  appointment_id: string;
  from_start: string;
  to_start: string;
  from_user_id?: string | null;
  to_user_id?: string | null;
  created_at: string;
}

export type HoldVerdict =
  | { kind: "none" }
  | { kind: "hold"; start_at: string; assigned_user_id: string | null; ids: string[]; since: number }
  | { kind: "caught"; ids: string[] }
  | { kind: "released"; ids: string[]; why: string };

/** When a hold lapses: the later of a day after the move or an hour after the new start. */
export function holdLapse(h: Hold): number {
  return Math.max((instant(h.created_at) ?? 0) + DAY, (instant(h.to_start) ?? 0) + HOUR);
}

/**
 * What the mirror does with B2B's row for a call the cockpit moved: B2B
 * copies HighLevel every 15 minutes or so, so for a while it still shows the
 * old time, and the mirror would put it back. While B2B shows a time the
 * cockpit moved the call away from, the cockpit's newest time is kept (and
 * its host, when the move changed it). B2B showing the new time ends the hold
 * (caught); any third time means someone moved it again in HighLevel
 * (released). A hold that B2B never catches lapses at the later of a day or
 * an hour after the new start. `holds` are the call's open holds, any order.
 */
export function holdStart(
  row: { start_at?: unknown; assigned_user_id?: unknown },
  holds: Hold[],
  now: number,
): HoldVerdict {
  if (!holds.length) return { kind: "none" };
  const ordered = [...holds].sort((a, b) => (instant(a.created_at) ?? 0) - (instant(b.created_at) ?? 0));
  const newest = ordered[ordered.length - 1] as Hold;
  const ids = ordered.map(h => h.id);
  const shown = instant(row.start_at);
  const to = instant(newest.to_start);
  if (sameTime(shown, to)) return { kind: "caught", ids };
  if (now > holdLapse(newest)) return { kind: "released", ids, why: "lapsed: B2B never showed the new time" };
  const old = ordered.some(h => sameTime(shown, instant(h.from_start)));
  if (!old) return { kind: "released", ids, why: "moved again in HighLevel" };
  const fromUser = newest.from_user_id ? String(newest.from_user_id) : null;
  const toUser = newest.to_user_id ? String(newest.to_user_id) : null;
  const hostMoved = toUser !== null && toUser !== fromUser;
  const shownUser = row.assigned_user_id ? String(row.assigned_user_id) : null;
  return {
    kind: "hold",
    start_at: new Date(to as number).toISOString(),
    assigned_user_id: hostMoved && (shownUser === null || shownUser === fromUser) ? toUser : null,
    ids,
    since: instant(newest.created_at) ?? now,
  };
}

/** Holds grouped by call. */
export function holdsByCall(rows: Row[]): Map<string, Hold[]> {
  const out = new Map<string, Hold[]>();
  for (const r of rows) {
    const id = String(r.appointment_id ?? "");
    if (!id || !r.from_start || !r.to_start) continue;
    out.set(id, [
      ...(out.get(id) ?? []),
      {
        id: String(r.id),
        appointment_id: id,
        from_start: String(r.from_start),
        to_start: String(r.to_start),
        from_user_id: (r.from_user_id as string | null) ?? null,
        to_user_id: (r.to_user_id as string | null) ?? null,
        created_at: String(r.created_at ?? ""),
      },
    ]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The free times (book.slots)
// ---------------------------------------------------------------------------

/** How many days of free times book.slots asks HighLevel for; each calendar still opens only what it opens. */
export const SLOT_DAYS = 14;

/** A custom time is typed to the 5-minute mark (book.check, book.create and book.move with custom). */
export const CUSTOM_STEP_MIN = 5;

/** The sub-account's own domain for HighLevel's public pages (GET /locations/{id} → domain). */
export const BOOKING_DOMAIN = "https://link.maharamedia.com";

/**
 * The lead's own link to pick another time for this call (D17, verified 2026-10-11):
 *   https://link.maharamedia.com/widget/booking/<calendarId>?event_id=<appointmentId>
 * Evidence: on test appointment hAl3lnR1WDbwru7wiSKw (calendar cFeDl0FY8iaXll61lus8, contact
 * VjPfR4Cc1Y0OFvaqeor5) the page's payload carried the appointment (calendarEvent.id, start, host), and
 * pressing Select sent PUT backend.leadconnectorhq.com/calendars/events/appointments/widget/hAl3lnR1WDbwru7wiSKw
 * {eventId, selectedSlot, calendarId, source: "booking_widget"}: a move of that appointment, no contact form.
 * Without event_id the same page asks for name, email and phone (a new booking). link.maharamedia.com is the
 * sub-account's own domain (GET /locations → domain). Only where HighLevel lets the lead reschedule
 * (allowReschedule: intros and Follow up call; demos are false). The lead sees only the booking page's own days.
 * The calendar id, never its slug: a slug changes when a calendar is renamed. The test appointment was
 * cancelled (never deleted) at 16:06 UTC the same day.
 */
export function rescheduleLink(calendarId: unknown, cal: Row | null | undefined, appointmentId: unknown): string | null {
  if (!cal || cal.isActive === false || cal.allowReschedule !== true) return null;
  const c = String(calendarId ?? "").trim();
  const a = String(appointmentId ?? "").trim();
  const ok = /^[A-Za-z0-9_-]{1,80}$/;
  if (!ok.test(c) || !ok.test(a)) return null;
  return `${BOOKING_DOMAIN}/widget/booking/${c}?event_id=${a}`;
}

/**
 * The last day a calendar opens, "2026-10-14": from its own "book up to N
 * days out", or the last day that has a free time, whichever is later
 * (a calendar that counts open days only reaches further than N days). Null
 * when neither is known.
 */
export function openUntil(cal: Row, days: { day: string }[], now: number): string | null {
  const n = Number(cal.allowBookingFor);
  const unit = String(cal.allowBookingForUnit ?? "days");
  const ms = unit.startsWith("week") ? 7 * DAY : unit.startsWith("hour") ? HOUR : unit.startsWith("month") ? 30 * DAY : DAY;
  const byCal = Number.isFinite(n) && n > 0 ? kuwaitDay(now + n * ms) : null;
  const bySlot = days.length ? (days[days.length - 1] as { day: string }).day : null;
  if (byCal && bySlot) return byCal > bySlot ? byCal : bySlot;
  return byCal ?? bySlot;
}

/**
 * The team's free times, each slot with the first teammate who has it
 * (D7's "Show anyone free": each tile names who takes it). `perUser` is in
 * the order to prefer.
 */
export function mergeTeamSlots(
  perUser: { user_id: string; name: string | null; days: { day: string; slots: string[] }[] }[],
): { days: { day: string; slots: string[] }[]; slot_hosts: Record<string, { user_id: string; name: string | null }> } {
  const hosts: Record<string, { user_id: string; name: string | null }> = {};
  const byDay = new Map<string, Map<number, string>>();
  for (const u of perUser)
    for (const d of u.days)
      for (const s of d.slots) {
        const t = instant(s);
        if (t === null) continue;
        const day = byDay.get(d.day) ?? new Map<number, string>();
        if (!day.has(t)) {
          day.set(t, s);
          hosts[s] = { user_id: u.user_id, name: u.name };
        }
        byDay.set(d.day, day);
      }
  const days = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, m]) => ({ day, slots: [...m.entries()].sort(([a], [b]) => a - b).map(([, s]) => s) }))
    .filter(d => d.slots.length);
  return { days, slot_hosts: hosts };
}
