// The power dialer's rules, brought over from mahara-power-dialer
// (src/domain.mjs, v0.7.22, tested there) and fitted to the sales
// sub-account: phone routing and caller IDs, the retry ladder, and the order
// the queue is worked in. Pure functions; bun test supabase/functions/sales-api.

import { hoursRefusal, leadZones } from "./sendrules.ts";

/** Where a number rings and which of our lines calls it (the dialer's routes plus Bahrain). */
export const ROUTES: Record<string, { country: string; flag: string; caller: string; pattern: RegExp }> = {
  "966": { country: "Saudi Arabia", flag: "SA", caller: "966115203895", pattern: /^966(?:1[1-467]\d{7}|5\d{8})$/ },
  "965": { country: "Kuwait", flag: "KW", caller: "96522209572", pattern: /^965[24569]\d{7}$/ },
  "971": { country: "United Arab Emirates", flag: "AE", caller: "97148369425", pattern: /^971(?:[234679]\d{7}|5\d{8})$/ },
  "974": { country: "Qatar", flag: "QA", caller: "97440197760", pattern: /^974[34567]\d{7}$/ },
  // The setters already called Bahrain from this line; 102 sales leads are Bahraini.
  "973": { country: "Bahrain", flag: "BH", caller: "97313311365", pattern: /^973[136]\d{7}$/ },
};

export interface Route {
  country: string;
  flag: string;
  caller: string;
  digits: string;
}

/** Normalise a number and pick the caller ID, or say why it cannot be called. */
export function routePhone(input: unknown): { ok: true; route: Route } | { ok: false; error: string } {
  let p = String(input ?? "")
    .trim()
    .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776));
  if (!p) return { ok: false, error: "This lead has no phone number." };
  if (!/^[+\d\s().-]+$/.test(p)) return { ok: false, error: "The number has letters or an extension in it." };
  p = p.replace(/[\s().-]/g, "").replace(/^00/, "+").replace(/^\+/, "");
  // A local Saudi or Kuwaiti number written without the country code.
  if (/^05\d{8}$/.test(p)) p = `966${p.slice(1)}`;
  const r = ROUTES[p.slice(0, 3)];
  if (!r || !r.pattern.test(p))
    return {
      ok: false,
      error: "This number is not a Saudi, Kuwaiti, Emirati, Qatari or Bahraini line the dialer can call. Copy it and call from Maqsam.",
    };
  return { ok: true, route: { country: r.country, flag: r.flag, caller: r.caller, digits: p } };
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KUWAIT = 3 * HOUR;

/** A Kuwait wall-clock time on the day of `ms` (plus `dayOffset`), as epoch ms. */
export function kuwaitAt(ms: number, hour: number, minute = 0, dayOffset = 0): number {
  const d = new Date(ms + KUWAIT);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + dayOffset, hour, minute) - KUWAIT;
}

/** 09:00 on the next working morning in Kuwait (Friday is the day off). */
export function nextWorkingNine(now: number): number {
  let due = kuwaitAt(now, 9, 0, 1);
  if (new Date(due + KUWAIT).getUTCDay() === 5) due = kuwaitAt(due, 9, 0, 1);
  return due;
}

/**
 * The retry ladder for a lead who did not answer: the same day at 17:00
 * (when that is at least an hour away), otherwise the next working morning
 * at 09:00; then the next two working mornings at 09:00; then the lead is
 * left as unreachable. `step` is how many unanswered tries there have been.
 */
export function nextTry(step: number, now: number): { step: number; due: number | null; unreachable: boolean } {
  if (step >= 3) return { step, due: null, unreachable: true };
  const next = step + 1;
  const five = kuwaitAt(now, 17);
  // A first retry must be at least an hour away, or it is just a redial; an
  // evening miss goes to the next working morning, not the next evening.
  const due = next === 1 && five - now >= HOUR ? five : nextWorkingNine(now);
  return { step: next, due, unreachable: false };
}

/**
 * A talk in a video room (a join that stands, or the call moved to the
 * phone) after the dialer's last outcome, when that outcome was Maqsam's
 * No answer (stress2 round 6, joined-step-next-lead-keeps-auto-no-answer):
 * the lead was reached, so the ladder's "unreachable" close from before the
 * talk is lifted and its retry moves to the next working morning after the
 * talk. Any later save (the joined step's own) stands as it is.
 */
export function afterTalk(o: {
  lastOutcome: string | null;
  lastOutcomeAt: number | null;
  closed: string | null;
  due: number | null;
  talkedAt: number | null;
}): { talked: boolean; closed: string | null; due: number | null } {
  const talked = o.talkedAt !== null && o.lastOutcome === "no_answer" && (o.lastOutcomeAt ?? 0) <= o.talkedAt;
  if (!talked || o.talkedAt === null) return { talked: false, closed: o.closed, due: o.due };
  return {
    talked: true,
    closed: o.closed === "unreachable" ? null : o.closed,
    due: Math.max(o.due ?? 0, nextWorkingNine(o.talkedAt)),
  };
}

export const OUTCOMES = [
  "no_answer",
  "callback",
  "booked",
  "not_interested",
  "disqualified",
  "wrong_number",
  "handled",
  // Qualified but not ready for a valid reason (sold the business, looking in
  // six months): long-term nurture, with no "not interested" tag and no
  // disqualification (Aziz's Loom, 2026-11-05).
  "not_ready",
] as const;
export type Outcome = (typeof OUTCOMES)[number];

export const OUTCOME_WORDS: Record<Outcome, string> = {
  no_answer: "No answer",
  callback: "Call back",
  booked: "Booked",
  not_interested: "Not interested",
  disqualified: "Disqualified",
  wrong_number: "Wrong number",
  handled: "Handled",
  not_ready: "Not ready yet (nurture)",
};

/**
 * What an outcome does to the lead's place in the queue. Handled (dealt with
 * another way, a message or a talk already had) keeps a call-back or retry
 * that is still ahead, as the call centre's HANDLED does, and otherwise takes
 * the lead out until something new happens (a reply opens them up again).
 */
export function afterOutcome(
  outcome: Outcome,
  step: number,
  now: number,
  callbackAt: number | null,
  prior: { due: number | null; callback: number | null } = { due: null, callback: null },
): { step: number; due: number | null; closed: string | null; callback: number | null } {
  if (outcome === "no_answer") {
    const n = nextTry(step, now);
    return { step: n.step, due: n.due, closed: n.unreachable ? "unreachable" : null, callback: null };
  }
  if (outcome === "callback") return { step, due: callbackAt, closed: null, callback: callbackAt };
  if (outcome === "booked") return { step: 0, due: null, closed: "booked", callback: null };
  if (outcome === "handled") {
    if (prior.callback !== null && prior.callback > now)
      return { step, due: prior.callback, closed: null, callback: prior.callback };
    if (prior.due !== null && prior.due > now) return { step, due: prior.due, closed: null, callback: null };
    return { step, due: null, closed: "handled", callback: null };
  }
  return { step, due: null, closed: outcome, callback: null };
}

// ---------------------------------------------------------------------------
// How hot a lead is, and what their pipeline stage means
// ---------------------------------------------------------------------------

/** What a stage of the sales pipeline means to the dialer. */
export type StageRole =
  | "new"
  | "intro_booked"
  | "intro_confirmed"
  | "intro_cancelled"
  | "intro_noshow"
  | "no_progress"
  | "demo_booked"
  | "demo_cancelled"
  | "demo_noshow"
  | "hot"
  | "nurture_short"
  | "nurture_long"
  | "deposit"
  | "disqualified"
  | "paused"
  | "won"
  | "lost"
  | "other";

const plainName = (s: unknown) =>
  String(s ?? "")
    .replace(/\p{Extended_Pictographic}|\u{FE0F}|\u{200D}/gu, "")
    .trim()
    .toLowerCase();

/**
 * A stage's role from its name, for stages the settings do not pin by id
 * (the pipeline setting's roles, seeded from HighLevel on 2026-09-26). The
 * order matters: "Demo Cancelled" is a cancellation, not a booking; "Intro
 * Call REQUESTED" is an intro booked (the calendars confirm on booking; the
 * lead's own confirmation is the CONFIRMED stage).
 */
export function stageRole(name: string | null | undefined): StageRole | null {
  const n = plainName(name);
  if (!n) return null;
  if (/disqualif/.test(n)) return "disqualified";
  if (/pause/.test(n)) return "paused";
  if (/offboard/.test(n)) return "won";
  if (/long.?term/.test(n)) return "nurture_long";
  if (/short.?term|nurture/.test(n)) return "nurture_short";
  if (/\bhot\b/.test(n)) return "hot";
  if (/new lead/.test(n)) return "new";
  if (/didn.?t (convert|close)|not convert/.test(n)) return "no_progress";
  if (/cancel/.test(n)) return /demo/.test(n) ? "demo_cancelled" : "intro_cancelled";
  if (/no.?show/.test(n)) return /intro/.test(n) ? "intro_noshow" : "demo_noshow";
  if (/deposit/.test(n)) return "deposit";
  if (/intro.*confirm/.test(n)) return "intro_confirmed";
  if (/intro.*request|intro.*book/.test(n)) return "intro_booked";
  if (/demo.*book|call confirmed|call requested|demo/.test(n)) return "demo_booked";
  if (/closed|won|signed|client/.test(n)) return "won";
  if (/lost|dead/.test(n)) return "lost";
  return "other";
}

/** Stages whose leads the dialer leaves alone until they write or a call-back is due. */
export const RESTING_ROLES: readonly StageRole[] = ["disqualified", "paused", "nurture_long", "won", "lost", "deposit"];

const DIGITS: [RegExp, string][] = [
  [/[٠-٩]/g, "٠"],
  [/[۰-۹]/g, "۰"],
];

/** The yearly revenue a form answer points at, in dollars, or null. */
export function revenueOf(answer: string | null | undefined): number | null {
  let t = String(answer ?? "").toLowerCase();
  if (!t.trim()) return null;
  for (const [re, zero] of DIGITS) t = t.replace(re, c => String(c.charCodeAt(0) - zero.charCodeAt(0)));
  const nums = [...t.matchAll(/(\d[\d,.]*)\s*(k|m|mil|million|ألف|الف|مليون)?/g)]
    .map(m => {
      const n = Number(m[1].replace(/,/g, ""));
      const unit = m[2] ?? "";
      return !Number.isFinite(n) ? null : /^m|mil|مليون/.test(unit) ? n * 1_000_000 : /^k|ألف|الف/.test(unit) ? n * 1_000 : n;
    })
    .filter((n): n is number => n !== null && n > 0);
  if (!nums.length) return null;
  const top = Math.max(...nums);
  // "Less than $100,000" says little; "more than $5M" and "$2.5M+" say the floor.
  if (/أقل|اقل|less|under|below/.test(t)) return top * 0.4;
  if (/أكثر|اكثر|more|over|above|\+/.test(t)) return top;
  return Math.min(...nums);
}

/** Whether the lead said they have money ready to invest (and how much, at least). */
export function readyOf(answer: string | null | undefined): { ready: boolean; floor: number | null } | null {
  const t = String(answer ?? "").toLowerCase();
  if (!t.trim()) return null;
  if (/مو مستعد|مش مستعد|غير مستعد|not ready|no budget/.test(t)) return { ready: false, floor: null };
  const floor = revenueOf(t.replace(/أكثر|اكثر|more than/g, "+"));
  return floor === null ? null : { ready: true, floor };
}

const MIN = 60_000;

/** A lead's heat: a score to order leads of the same kind, and the reasons a rep reads. */
export function heat(c: Candidate, now: number): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  if (c.hot) {
    score += 3;
    reasons.push("On the hot list");
  }
  if (c.lead_class === "qualified") {
    score += 3;
    reasons.push("Qualified");
  } else if (c.lead_class === "unqualified") score += 1;
  const revenue = revenueOf(c.revenue);
  if (revenue !== null && revenue >= 1_000_000) {
    score += 2;
    reasons.push("$1M+ a year");
  } else if (revenue !== null && revenue >= 250_000) {
    score += 1;
    reasons.push("$250k+ a year");
  }
  const ready = readyOf(c.readiness);
  if (ready?.ready) {
    score += ready.floor !== null && ready.floor >= 8_000 ? 2 : 1;
    reasons.push("Ready to invest");
  } else if (ready && !ready.ready) score -= 1;
  if (c.inbound_at !== null && now - c.inbound_at <= DAY) {
    score += 2;
    reasons.push("Wrote to us");
  }
  if (c.created_at !== null && now - c.created_at <= HOUR) {
    score += 2;
    reasons.push("Came in this hour");
  } else if (c.created_at !== null && now - c.created_at <= DAY) score += 1;
  if (c.stage_role === "hot" && !c.hot) {
    score += 2;
    reasons.push("Hot Leads stage");
  }
  if (c.misses >= 3) score -= 1;
  return { score, reasons: reasons.slice(0, 3) };
}

// ---------------------------------------------------------------------------
// The queue
// ---------------------------------------------------------------------------

/** The lead's next intro or demo (from twenty minutes ago on), as the dialer works it. */
export interface Appt {
  id: string;
  type: "intro" | "demo";
  start: number;
  /** When it was booked. */
  booked: number | null;
  /** The status after marks (showed, noshow, cancelled, invalid end the work). */
  status: string | null;
  /** HighLevel user the call is with. */
  assigned: string | null;
  /** The lead confirmed (a call or their reply). */
  confirmed: boolean;
  /** The last confirmation try that did not reach them. */
  last_try: number | null;
  /**
   * The last confirmation call that rang out (a no-answer, never a message
   * sent): the voice note follows a call nobody picked up, not a text. Not
   * given: last_try stands for it.
   */
  last_miss?: number | null;
  /**
   * The lead joined a video room carrying this call and the join stands (not
   * taken back): the intro was had on video, so it never comes back as
   * "Intro call now" while its mark catches up (stress2, round 1).
   */
  room_joined?: boolean;
  /**
   * The lead's country (cockpit_sales_leads.country): the confirmation call
   * comes up only while it is 09:00 to 21:00 on every clock of theirs, as
   * the desk's confirmation message does (stress2 round 5). Unknown: Kuwait's.
   */
  country?: string | null;
}

/** One lead as the queue sees it. */
export interface Candidate {
  contact_id: string;
  name: string | null;
  phone: string | null;
  created_at: number | null;
  stage: string | null;
  lead_class: string | null;
  dnd: boolean;
  /** Last outbound call to this lead by anyone. */
  last_dial_at: number | null;
  /** Any answered call (completed) ever. */
  reached: boolean;
  /** The lead's last message, when it was theirs. */
  inbound_at: number | null;
  /** A future intro or demo on the calendar. */
  booked_at: number | null;
  /** The latest past intro or demo and how it went. */
  last_call_status: string | null;
  last_call_type: string | null;
  last_call_at: number | null;
  /** From the dialer's own state. */
  due_at: number | null;
  callback_at: number | null;
  closed: string | null;
  claimed_by: string | null;
  /** In a sales pipeline, or tagged by the booking form; never a client. */
  sales_lead: boolean;
  stage_role: StageRole | null;
  revenue: string | null;
  readiness: string | null;
  /** Unanswered outbound calls since the lead came in (the softphone's too). */
  misses: number;
  /** On the cockpit's hot list, whose, and when to follow up next. */
  hot: boolean;
  hot_owner: string | null;
  hot_next_at: number | null;
  appt: Appt | null;
  /**
   * The rep whose lead this is (Aziz, 2026-09-27): the setter from the intro
   * they booked, the closer from the demo. Only a working rep's seat counts,
   * so a leaver's leads are nobody's again. Null: the shared queue's.
   */
  owner?: string | null;
  /** The lead's latest call to us in the last day that nobody answered. */
  inbound_call_at?: number | null;
  /** The lead signed (a deal that is not voided): out of the setter's queue too. */
  signed?: boolean;
  /** The owner's seat role (setter, closer, both), when the lead has an owner. */
  owner_role?: string | null;
  /** The host (HighLevel user) of the lead's latest demo in the window, "" with no host; null: no demo. */
  demo_rep?: string | null;
  /**
   * Whose live call-back it is: the rep who set it in the dialer, or the
   * working seat whose Callback / Follow Up calendar it is on. Null: anyone's.
   */
  callback_owner?: string | null;
  /**
   * The lead's own intro booking of the last hour (not one a rep made on
   * the phone or in the cockpit): the call "Booked an intro, call now"
   * (Aziz, 2026-11-05: "if anybody books an intro, still call them then and there").
   */
  just_booked?: { id: string; start: number; booked: number } | null;
  /** Tries nobody answered in the last two hours (the dialer's saves and Maqsam's record, one per call). */
  miss_times?: number[];
  /** The latest voice note the team recorded sending this lead. */
  voice_note_at?: number | null;
  /** The start of the lead's latest intro cancelled in the last seven days (or still ahead). */
  cancelled_intro_at?: number | null;
  /** The lead's latest intro or demo past its twenty minutes that nobody has marked (last seven days). */
  unmarked?: Appt | null;
  /**
   * The same, per kind of call: the setter marks their intros and the closer
   * their demos, so a later call on someone else's calendar never hides one
   * of theirs. Not given: `unmarked` stands for both.
   */
  unmarked_intro?: Appt | null;
  unmarked_demo?: Appt | null;
  /**
   * The lead's first call since it came in, when nobody picked it up (the
   * dialer's save or Maqsam's record, whichever came first); null when the
   * first call was answered or there was none. A lead first called hours
   * after it arrived (overnight, the weekend) still gets the burst from that
   * call (burstAnchor).
   */
  first_try_at?: number | null;
  /** When the dialer closed the lead (cockpit_sales_queue_state.closed_at). */
  closed_at?: number | null;
  /** False when the voice notes could not be read (before 20261105w): no voice-note step is asked for. */
  voice_known?: boolean;
}

/** "14:30", Kuwait time. */
function kuwaitClock(t: number): string {
  return new Date(t + KUWAIT).toISOString().slice(11, 16);
}

/**
 * The lead called us and nobody picked up, and nobody has called them since:
 * the call centre's missed-call rule, the warmest lead there is. Urgent for
 * ten minutes, today's work for the rest of the day.
 */
export function missedCall(c: Candidate, now: number): "now" | "today" | null {
  const t = c.inbound_call_at ?? null;
  if (t === null || now - t > DAY || (c.last_dial_at !== null && c.last_dial_at >= t)) return null;
  return now - t <= 10 * MIN ? "now" : "today";
}

/**
 * A call-back shows five minutes before the agreed time (the call centre's
 * rule) and stays urgent for ten minutes after it.
 */
export function callbackSoon(c: Candidate, now: number): boolean {
  return c.callback_at !== null && c.callback_at - 5 * MIN <= now && now - c.callback_at <= 10 * MIN;
}

function callbackWords(c: Candidate, now: number): string {
  return c.callback_at !== null && c.callback_at > now
    ? `Call back at ${kuwaitClock(c.callback_at)}, as agreed`
    : "Call back now, as agreed";
}

export type ItemKind = "lead" | "intro" | "confirm";

/**
 * What the item is, for the screen to key on rather than read `why`:
 * - intro_now: the rep's own intro, five minutes before to twenty after
 * - new_lead, just_booked, second_try: the "call now, twice" burst
 * - voice_note: a burst or confirmation call nobody answered, no voice note yet
 * - confirm, confirm_last, confirm_early: confirmations (2.5 h, 60 min, the day before)
 * - reply_now, reply_today, reply_booked, reply_waiting: the lead wrote and nobody answered
 * - callback_now, callback_today, callback_late, missed_call_now, missed_call_today
 * - hot_due, hot_planned, intro_noshow, intro_cancelled, demo_noshow, demo_cancelled
 * - mark_call: the rep's own call past its twenty minutes with no mark
 * - showed_not_signed, new_not_reached, new_never_called, retry, never_called
 * Items of kind "lead" carry every code but intro_now and the confirmations;
 * a mark_call item is kind "lead" so an older page shows it as a lead.
 */
export type ItemCode =
  | "intro_now"
  | "new_lead"
  | "just_booked"
  | "second_try"
  | "voice_note"
  | "confirm"
  | "confirm_last"
  | "confirm_early"
  | "reply_now"
  | "reply_today"
  | "reply_booked"
  | "reply_waiting"
  | "callback_now"
  | "callback_today"
  | "callback_late"
  | "missed_call_now"
  | "missed_call_today"
  | "hot_due"
  | "hot_planned"
  | "intro_noshow"
  | "intro_cancelled"
  | "demo_noshow"
  | "demo_cancelled"
  | "mark_call"
  | "showed_not_signed"
  | "new_not_reached"
  | "new_never_called"
  | "retry"
  | "never_called";

/** The step a voice note follows: a new lead's burst, a just-booked lead's, or a confirmation call. */
export type VoiceStep = "new" | "booked" | "confirm";

export interface Ranked extends Candidate {
  tier: 0 | 1 | 2 | 3;
  kind: ItemKind;
  why: string;
  sort: number;
  heat: number;
  hot_reasons: string[];
  code: ItemCode;
  /** Order inside the tier before heat: 0 goes first (the intro at its minute; a lead under an hour old). */
  pin: number;
  /** When the work became due: the strip's clock starts here. */
  due_since: number | null;
  /** A voice note is the next step (a call in this step nobody answered, no voice note since). */
  voice_step: VoiceStep | null;
  /** The rep's own call to mark (mark_call), whatever item the lead is on. */
  mark: Appt | null;
}

type Item = Omit<Ranked, keyof Candidate | "heat" | "hot_reasons" | "pin" | "due_since" | "voice_step" | "mark"> &
  Partial<Pick<Ranked, "pin" | "due_since" | "voice_step" | "mark">>;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "today at 16:00", "tomorrow at 10:20", "on Sunday at 09:00", in Kuwait time. */
export function whenWords(ms: number, now: number): string {
  const d = new Date(ms + KUWAIT);
  const hhmm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  const day = (t: number) => Math.floor((t + KUWAIT) / DAY);
  const gap = day(ms) - day(now);
  return gap === 0 ? `today at ${hhmm}` : gap === 1 ? `tomorrow at ${hhmm}` : `on ${DAYS[d.getUTCDay()]} at ${hhmm}`;
}

const ENDED = new Set(["showed", "noshow", "cancelled", "invalid"]);

/**
 * When a confirmation comes up, the call centre's way (mahara-power-dialer
 * domain.mjs): a call before noon is confirmed from 18:00 the evening
 * before, any other from 09:00 on the day (Kuwait time).
 */
export function confirmFrom(start: number): number {
  const hour = new Date(start + KUWAIT).getUTCHours();
  return hour < 12 ? kuwaitAt(start, 18, 0, -1) : kuwaitAt(start, 9);
}

/** An intro is the setter's call from five minutes before it to twenty after. */
function introWindow(a: Appt, now: number): boolean {
  return now >= a.start - 5 * MIN && now <= a.start + 20 * MIN;
}

/**
 * The lead joined a video room for this call as it starts now, the join
 * standing (Appt.room_joined, index.ts candidates): the room carries the
 * call's id, it stored this start (within a second) when it was made, and
 * the join fell inside the call's own window (five minutes before its start
 * to twenty after). A join on a room made for the intro before it was moved,
 * or before its window (a confirmation call's room), never hides the intro
 * as it is booked now (stress2, round 2).
 */
export function roomJoinedFor(
  rooms: readonly Record<string, unknown>[],
  appt: { id: string; start: number },
): boolean {
  const t = (v: unknown) => {
    const n = v ? Date.parse(String(v)) : Number.NaN;
    return Number.isFinite(n) ? n : null;
  };
  return rooms.some(r => {
    // A room asked for this call that does not carry it (a confirmation
    // call's, whose link invited the call now: m1 round 6): a join there,
    // in the three hours before the call to twenty past, is the call had
    // when the lead stayed a talk's length (confirmationRoomHeld), never a
    // quick "yes, talk at 10" (stress2 round 2).
    const asked = !r.appointment_id && String(r.asked_appointment_id ?? "") === appt.id;
    if (String(r.appointment_id ?? "") !== appt.id && !asked) return false;
    const joined = t(r.lead_in_at);
    const undo = t(r.count_undo_at);
    // A join stands after the taken-back join's own time (stress2 round 5).
    const taken = t(r.taken_back_join_at);
    const bound = undo === null ? null : taken === null ? undo : Math.min(taken, undo);
    if (joined === null || (bound !== null && joined <= bound)) return false;
    if (asked)
      return joined >= appt.start - 3 * 60 * MIN && joined <= appt.start + 20 * MIN && confirmationRoomHeld(r);
    const stored = t(r.appointment_start_at);
    if (stored !== null && Math.abs(stored - appt.start) >= 1000) return false;
    return joined >= appt.start - 5 * MIN && joined <= appt.start + 20 * MIN;
  });
}

/** A confirmation call's video room the lead stayed in this long was the call itself, not a quick yes (m1 round 6). */
export const CONFIRM_ROOM_HELD_MIN = 10;

/**
 * A confirmation call's room the lead joined and stayed in for a talk's
 * length (CONFIRM_ROOM_HELD_MIN), or is in now: the intro was had there
 * (m1 round 6, m1-journeys-r6-confirm-call-link-invites-call-now-intro-
 * never-held: its link says "we can talk on video now"). A shorter join is
 * the lead confirming (stress2 round 2), and the intro still comes up.
 */
export function confirmationRoomHeld(r: Record<string, unknown>): boolean {
  const joined = r.lead_in_at ? Date.parse(String(r.lead_in_at)) : Number.NaN;
  if (!Number.isFinite(joined)) return false;
  if (r.state === "lead_in") return true;
  const ended = r.ended_at ? Date.parse(String(r.ended_at)) : Number.NaN;
  return Number.isFinite(ended) && ended - joined >= CONFIRM_ROOM_HELD_MIN * MIN;
}

/** How long an intro that rang out waits before it comes back, inside its window. */
export const INTRO_RETRY = 5 * MIN;

/**
 * An intro the setter just tried and nobody answered: it leaves the queue
 * for five minutes, so Next lead moves on instead of bringing it straight
 * back, and returns while its window is still open (a try at the booked
 * minute, then about every five minutes to twenty past).
 */
export function introWaiting(a: Appt | null, now: number): boolean {
  if (!a || a.type !== "intro" || ENDED.has(String(a.status ?? "")) || !introWindow(a, now)) return false;
  return a.last_try !== null && a.last_try >= a.start - 5 * MIN && now - a.last_try < INTRO_RETRY;
}

/** Every intro and demo nobody has confirmed is called from two and a half hours before it (Aziz, 2026-11-05). */
export const CONFIRM_FROM = 150 * MIN;
/** A confirmation call nobody answered comes back sixty minutes before the call. */
export const CONFIRM_AGAIN = 60 * MIN;
/** A call booked less than three hours before it starts is a just-booked call, not a confirmation. */
export const SHORT_NOTICE = 3 * HOUR;

/**
 * Appointment work, before any lead: the intro call itself (intros are phone
 * calls the setter makes at the booked minute), then confirmations.
 *
 * Confirmations (Aziz, 2026-11-05, replacing the 24-hours-ahead rule of
 * 2026-09-26): every intro (the setter's) and demo (the closer's) nobody has
 * confirmed is a "call now" item from two and a half hours before it; a try
 * nobody answered brings it back sixty minutes before; one nobody answered
 * in the last hour leaves it to the call itself. A call booked less than
 * three hours before its start gets none (the just-booked call covers it).
 * A call booked more than a day ahead also keeps the evening-before (a
 * morning call) or morning-of touch, with two hours between tries.
 *
 * Confirmed means the lead's own yes: a confirmation saved in the cockpit,
 * or the lead in the CONFIRMED stage after the booking (index.ts). Never
 * HighLevel's "confirmed" status: every calendar confirms on booking.
 *
 * Whose: a setter's own intros (and any call with no host); a closer's own
 * demos. A demo on another rep's calendar is theirs to confirm (Aziz,
 * 2026-11-05, owner rule); a manager with no HighLevel user sees all.
 */
export function appointmentWork(
  a: Appt | null,
  now: number,
  as: "setter" | "closer",
  meGhl: string | null,
): (Item & { tier: 0 | 1; pin: number }) | null {
  if (!a || ENDED.has(String(a.status ?? ""))) return null;
  const mine = !meGhl || !a.assigned || a.assigned === meGhl;
  if (as === "setter" && a.type === "intro" && mine && introWindow(a, now)) {
    if (introWaiting(a, now) || a.room_joined === true) return null;
    // The intro is the first thing in Call now at its minute, whatever
    // else is due (an explicit rule: deadline order put new leads and
    // confirmations above it).
    return {
      tier: 0,
      kind: "intro",
      code: "intro_now",
      pin: 0,
      why: `Intro call now, booked for ${whenWords(a.start, now).replace(/^today at /, "")}`,
      sort: a.start,
    };
  }
  if (a.start <= now || a.confirmed) return null;
  const whose = as === "closer" ? a.type === "demo" && (!meGhl || a.assigned === meGhl) : mine;
  if (!whose) return null;
  // Booked at short notice: the just-booked call-now is its confirmation.
  if (a.booked !== null && a.start - a.booked < SHORT_NOTICE) return null;
  // Never a confirmation call (nor the video link after it) at night where
  // the lead is: 09:00 to 21:00 on each of their clocks (sendrules.ts
  // hoursRefusal, a later message), as followups.py confirm_from keeps the
  // desk's confirmation message.
  // A lead whose country is not known keeps the call centre's Kuwait rule.
  const night = () =>
    Boolean(a.country) &&
    hoursRefusal({ segment: "confirm", touch: 2, country: a.country as string, now, followups: {} }) !== null;
  const words = `Confirm the ${a.type} ${whenWords(a.start, now)}${theirClock(a.country, now)}`;
  const from = a.start - CONFIRM_FROM;
  const again = a.start - CONFIRM_AGAIN;
  if (now >= from) {
    const t = a.last_try;
    const tried = t !== null && t >= from;
    // Tried in the last hour too: the call itself is next.
    if (tried && (t as number) >= again) return null;
    // Tried once in the window: back sixty minutes before.
    if (tried && now < again) return null;
    if (night()) return null;
    return {
      tier: 0,
      kind: "confirm",
      code: now >= again ? "confirm_last" : "confirm",
      pin: 1,
      why: tried ? `${words}, second try` : words,
      sort: a.start,
    };
  }
  // A call booked more than a day ahead: the evening before or that morning.
  const farAhead = a.booked !== null && a.start - a.booked > DAY;
  if (!farAhead || now < confirmFrom(a.start)) return null;
  if (a.last_try !== null && now - a.last_try < 2 * HOUR) return null;
  if (night()) return null;
  return { tier: 1, kind: "confirm", code: "confirm_early", pin: 1, why: words, sort: a.start };
}

/**
 * The rep's own call past its twenty minutes that nobody has marked: marked
 * in the dialer, so a call nobody marks does not count as shown (Aziz,
 * 2026-11-05). A setter marks their intros, a closer their demos; only the
 * host or a manager may mark (lib.ts refuseMark), so a call with no host is
 * a manager's.
 */
export function markWork(
  a: Appt | null | undefined,
  now: number,
  as: "setter" | "closer",
  meGhl: string | null,
): Item | null {
  if (!a || ENDED.has(String(a.status ?? ""))) return null;
  if (a.type !== (as === "closer" ? "demo" : "intro")) return null;
  if (now <= a.start + 20 * MIN || now - a.start > 7 * DAY) return null;
  if (meGhl !== null && a.assigned !== meGhl) return null;
  return {
    tier: 1,
    kind: "lead",
    code: "mark_call",
    why: `Mark the ${a.type} booked for ${whenWords(a.start, now)}`,
    sort: a.start,
    mark: a,
  };
}

/** A fresh lead or a fresh booking is called twice within this long. */
export const BURST = 60 * MIN;
/** The quick second try after the first no-answer of a burst. */
export const SECOND_TRY = 2 * MIN;
/** A lead's own intro booking is a "call now" item this long, until someone calls. */
export const JUST_BOOKED = 30 * MIN;

/**
 * A lead first called within this long of arriving is still a new lead: its
 * first call starts the burst wherever it falls in the day (2026-11-06
 * review: 59% of last month's leads came in outside 09:00 to 18:00, and a
 * lead from the night or the weekend is first called the next working
 * morning).
 */
export const FIRST_CALL_NEW = 3 * DAY;

/**
 * When the lead's "call now, twice" started (Aziz's Loom: call every new
 * lead immediately, twice): their arrival, or their own intro booking, in
 * the last hour; the later of the two. A lead that came in while nobody was
 * calling (the night, the weekend, up to three days) starts it at its first
 * call instead, when nobody picked that call up and it was in the last hour
 * (`first_try_at`): the step is "booked" when they have a call booked ahead.
 */
export function burstAnchor(
  c: Pick<Candidate, "created_at" | "just_booked"> & Partial<Pick<Candidate, "first_try_at" | "booked_at">>,
  now: number,
): { at: number; step: "new" | "booked" } | null {
  const opts: { at: number; step: "new" | "booked" }[] = [];
  if (c.created_at !== null && c.created_at <= now && now - c.created_at <= BURST) opts.push({ at: c.created_at, step: "new" });
  const b = c.just_booked;
  if (b && b.booked <= now && now - b.booked <= BURST) opts.push({ at: b.booked, step: "booked" });
  const f = c.first_try_at ?? null;
  if (
    !opts.length &&
    f !== null &&
    c.created_at !== null &&
    f >= c.created_at &&
    f - c.created_at <= FIRST_CALL_NEW &&
    f <= now &&
    now - f <= BURST
  )
    opts.push({ at: f, step: c.booked_at !== null && c.booked_at !== undefined && c.booked_at > now ? "booked" : "new" });
  return opts.sort((x, y) => y.at - x.at)[0] ?? null;
}

/**
 * The lead's first call since it came in, when nobody picked it up: the
 * earliest of its calls (Maqsam's record or the dialer's save, `miss` when
 * unanswered), or null when that first call was answered, came before the
 * lead did, or there was none.
 */
export function firstTry(calls: readonly { at: number; miss: boolean }[], created: number | null): number | null {
  if (created === null) return null;
  const first = calls.filter(x => x.at >= created).sort((x, y) => x.at - y.at || Number(x.miss) - Number(y.miss))[0];
  return first?.miss ? first.at : null;
}

/** The burst's unanswered tries, oldest first. */
function burstMisses(c: Candidate, at: number): number[] {
  return (c.miss_times ?? []).filter(t => t >= at).sort((x, y) => x - y);
}

/**
 * The burst's second try: after the first no-answer it comes back two
 * minutes later ("wait" until then), not after the ladder's hour; after the
 * second it is the ladder's. A call answered, or any other outcome saved,
 * since the miss ends the burst.
 */
export function secondTry(c: Candidate, now: number): { due: number; step: "new" | "booked" } | "wait" | null {
  const a = burstAnchor(c, now);
  if (!a) return null;
  const misses = burstMisses(c, a.at);
  if (misses.length !== 1) return null;
  const miss = misses[0] as number;
  if (c.last_dial_at !== null && c.last_dial_at > miss + MIN) return null;
  const due = miss + SECOND_TRY;
  return now < due ? "wait" : { due, step: a.step };
}

/**
 * Whether a voice note is the lead's next step (Aziz, 2026-11-05: "we still
 * send a personalized voice note from the setter's phone"): a burst call
 * nobody answered with no voice note since its first miss, or a
 * confirmation call nobody answered (before the call's own window) with no
 * voice note since.
 */
export function voiceNoteDue(c: Candidate, now: number): VoiceStep | null {
  // The voice notes could not be read (before 20261105w): none is asked
  // for, since "I sent the voice note" could not be recorded either.
  if (c.voice_known === false) return null;
  const sent = c.voice_note_at ?? null;
  // A call or a saved outcome after the miss (the second try answered, a
  // call-back agreed, a confirmation saved) means someone spoke to them:
  // no "tried to call you" note to a lead just spoken to (2026-11-06 review).
  const spokeSince = (miss: number) => c.last_dial_at !== null && c.last_dial_at > miss + MIN;
  const a = burstAnchor(c, now);
  if (a) {
    const misses = burstMisses(c, a.at);
    const last = misses.at(-1);
    if (last !== undefined && !spokeSince(last) && !(sent !== null && sent >= (misses[0] as number))) return a.step;
  }
  const ap = c.appt;
  // Only a confirmation call that rang out: a message sent is a try for the
  // confirmation ladder, not a call nobody answered.
  const miss = ap ? (ap.last_miss !== undefined ? ap.last_miss : ap.last_try) : null;
  if (
    ap &&
    !ap.confirmed &&
    !ENDED.has(String(ap.status ?? "")) &&
    miss !== null &&
    miss >= ap.start - CONFIRM_FROM &&
    miss < ap.start - 5 * MIN &&
    now < ap.start &&
    !spokeSince(miss) &&
    !(sent !== null && sent >= miss)
  )
    return "confirm";
  return null;
}

/** A dialer save up to this long after a Maqsam call started is that call (the ringing, then a slow save). */
export const SAME_CALL = 10 * MIN;

/**
 * Maqsam's calls (start times) that are not one of these dialer saves: each
 * save, oldest first, is the latest Maqsam call that started before it (five
 * seconds of clock drift allowed) and in the ten minutes before it, not
 * already another save's. Ringing and a slow save can pass three minutes,
 * and one missed call must count once (2026-11-06 review); a second call
 * started after the first save is never that save's.
 */
export function unpairedCalls(saves: readonly number[], maqsam: readonly number[]): number[] {
  const calls = [...maqsam].sort((x, y) => x - y);
  const used = new Set<number>();
  for (const s of [...saves].sort((x, y) => x - y)) {
    let pick = -1;
    for (let i = 0; i < calls.length; i++) {
      const t = calls[i] as number;
      if (t > s + 5_000) break;
      if (!used.has(i) && s - t <= SAME_CALL) pick = i;
    }
    if (pick >= 0) used.add(pick);
  }
  return calls.filter((_, i) => !used.has(i));
}

/**
 * Merges the dialer's own no-answer saves with Maqsam's unanswered calls, one
 * per call (unpairedCalls: a Maqsam call and the dialer save that followed it
 * are the same call).
 */
export function mergeMisses(saves: readonly number[], maqsam: readonly number[]): number[] {
  return [...saves, ...unpairedCalls(saves, maqsam)].sort((x, y) => x - y);
}

/**
 * Whether a no-answer saved now is the burst's first (the lead comes back
 * two minutes later) rather than a step down the retry ladder: within an
 * hour of the lead arriving or booking, and no earlier unanswered try since.
 */
export function quickRetryDue(
  anchor: { at: number } | null,
  earlierMisses: number,
  now: number,
): number | null {
  if (!anchor || now - anchor.at > BURST || earlierMisses > 0) return null;
  return now + SECOND_TRY;
}

/** The Kuwait day of a moment (days since the epoch, Kuwait time). */
const kuwaitDay = (t: number) => Math.floor((t + KUWAIT) / DAY);

/**
 * " (it is 10:05 there)" for a lead whose clock is not Kuwait's, so the
 * setter sees the hour where the lead is before calling (stress2 round 5).
 * Empty for a lead in Kuwait's hour or whose zone is not known.
 */
export function theirClock(country: string | null | undefined, now: number): string {
  if (!country) return "";
  const zone = leadZones(country)?.[0];
  if (!zone) return "";
  const at = (z: string) => new Intl.DateTimeFormat("en-GB", { timeZone: z, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  try {
    const there = at(zone);
    return there === at("Asia/Kuwait") ? "" : ` (it is ${there} there)`;
  } catch {
    return "";
  }
}

function place(out: Ranked[], c: Candidate, h: { score: number; reasons: string[] }, item: Item, now: number) {
  out.push({
    ...c,
    pin: 1,
    due_since: null,
    mark: null,
    ...item,
    voice_step: item.voice_step ?? voiceNoteDue(c, now),
    heat: h.score,
    hot_reasons: h.reasons,
  });
}

/** A hot lead whose planned follow-up has come, for its owner (or any manager). */
function hotFollowUp(c: Candidate, me: string, now: number, manager: boolean): Item | null {
  if (!c.hot || c.hot_next_at === null || c.hot_next_at > now) return null;
  if (!manager && c.hot_owner && c.hot_owner !== me) return null;
  const now10 = now - c.hot_next_at <= 10 * MIN;
  return {
    tier: now10 ? 0 : 1,
    kind: "lead",
    code: now10 ? "hot_due" : "hot_planned",
    why: now10 ? "Hot lead: the follow-up is due now" : "Hot lead: follow up as planned",
    sort: c.hot_next_at,
    due_since: c.hot_next_at,
  };
}

function order(out: Ranked[]): Ranked[] {
  // The intro at its minute first, then Call now by urgency; in the other
  // tiers what is pinned first (newest first), then the hottest lead, then
  // its own order.
  return out.sort(
    (a, b) =>
      a.tier - b.tier ||
      a.pin - b.pin ||
      (a.tier === 0 || a.pin === 0 ? 0 : b.heat - a.heat) ||
      a.sort - b.sort ||
      a.contact_id.localeCompare(b.contact_id),
  );
}

const DEMO_STAGES: readonly StageRole[] = ["demo_booked", "demo_cancelled", "demo_noshow", "deposit", "won"];

/**
 * A stage that only comes after a demo, by its name: "Showed - Didn't Close"
 * is pinned to the no-progress role, which an intro's "Didn't Convert" shares,
 * and a demo older than the calendar's sixty-day window leaves no demo host
 * to go by (2026-11-06 review, campaign lens).
 */
const AFTER_DEMO_NAME = /didn.?t\s*close/i;

/** The lead has not reached a demo: none on the calendar and no demo stage. */
export function introStage(c: Candidate): boolean {
  return (
    (c.demo_rep === null || c.demo_rep === undefined) &&
    !(c.stage_role && DEMO_STAGES.includes(c.stage_role)) &&
    !(c.stage && AFTER_DEMO_NAME.test(c.stage))
  );
}

/**
 * Whether a lead's lead-level work (a new lead, a reply, a no-show or a
 * cancelled intro to rebook, a just-booked call, a voice note, the retry
 * ladder) is on this setter's queue. The owner rule of 2026-09-27, as the
 * critic of 2026-11-05 corrected it: HighLevel's owner came from intros
 * booked while the closer hosted them, so a closer's lead still at the intro
 * stage is the setter's work; a lead past it (a demo) is the closer's. Work
 * on another rep's own calendar (their call-backs and follow-up calls, their
 * demos) stays theirs, and another setter's lead stays hidden. A manager
 * sees every lead.
 */
export function setterScope(c: Candidate, me: string, meGhl: string | null, manager: boolean): boolean {
  if (manager) return true;
  if (c.callback_owner && c.callback_owner !== me) return false;
  if (c.demo_rep && c.demo_rep !== meGhl) return false;
  if (!c.owner || c.owner === me) return true;
  return c.owner_role === "closer" && introStage(c);
}

/** "tomorrow at 10:00", "Saturday at 12:00": a call's start after "booked an intro for". */
const bookedFor = (start: number, now: number) => whenWords(start, now).replace(/^on /, "");

/** The lead's own intro booking still waiting for its first call (at most thirty minutes). */
export function justBookedNow(c: Candidate, now: number): { id: string; start: number; booked: number } | null {
  const b = c.just_booked;
  if (!b || b.booked > now || now - b.booked > JUST_BOOKED || b.start <= now) return null;
  // Called (or an outcome saved) since the booking: done.
  if (c.last_dial_at !== null && c.last_dial_at >= b.booked) return null;
  return b;
}

/** The voice-note item after a burst or confirmation call nobody answered. */
function voiceItem(c: Candidate, voice: VoiceStep): Item {
  return {
    tier: 1,
    kind: "lead",
    code: "voice_note",
    pin: 0,
    why: voice === "confirm" ? "No answer to the confirmation: send a voice note" : "No answer: send a voice note",
    sort: -((c.miss_times ?? []).at(-1) ?? c.appt?.last_miss ?? c.appt?.last_try ?? 0),
    voice_step: voice,
  };
}

/** A confirmation voice note is for the call's host (or a call with none, or a manager with no HighLevel user). */
function confirmVoiceMine(c: Candidate, host: string | null): boolean {
  return host === null || !c.appt?.assigned || c.appt.assigned === host;
}

/** The setter's work on one lead, its lead-level rules in order, or none. */
function setterLeadWork(c: Candidate, now: number, host: string | null): Item | null {
  // Closed: nothing, except the voice note after the confirmation call of a
  // call booked from the dialer (the lead stays closed "booked" while it is
  // ahead), so that step shows on the queue too (2026-11-06 review).
  if (c.closed) return c.closed === "booked" && voiceNoteDue(c, now) === "confirm" && confirmVoiceMine(c, host) ? voiceItem(c, "confirm") : null;
  const unanswered = c.inbound_at !== null && (!c.last_dial_at || c.last_dial_at < c.inbound_at);
  const replyAge = unanswered ? now - (c.inbound_at as number) : null;
  const replied = replyAge !== null && replyAge <= 10 * MIN;
  const fresh = c.created_at !== null && now - c.created_at <= 10 * MIN && !c.last_dial_at;
  const callbackNow = callbackSoon(c, now);
  const missed = missedCall(c, now);
  if (fresh || replied || callbackNow || missed === "now") {
    const booking = c.just_booked && c.just_booked.start > now ? c.just_booked : null;
    return {
      tier: 0,
      kind: "lead",
      code: callbackNow ? "callback_now" : missed === "now" ? "missed_call_now" : replied ? "reply_now" : "new_lead",
      why: callbackNow
        ? callbackWords(c, now)
        : missed === "now"
          ? "Called us, missed it"
          : replied
            ? "Wrote back minutes ago"
            : booking
              ? `New lead, booked an intro for ${bookedFor(booking.start, now)}, call now`
              : "New lead, call now",
      sort: -(c.callback_at ?? c.inbound_call_at ?? c.inbound_at ?? c.created_at ?? 0),
      due_since: callbackNow
        ? c.callback_at
        : missed === "now"
          ? (c.inbound_call_at ?? null)
          : replied
            ? c.inbound_at
            : c.created_at,
    };
  }
  // Booked an intro, any time ahead: call them then and there (Aziz, 2026-11-05).
  const booked = justBookedNow(c, now);
  if (booked)
    return {
      tier: 0,
      kind: "lead",
      code: "just_booked",
      why: `Booked an intro for ${bookedFor(booked.start, now)}, call now`,
      sort: -booked.booked,
      due_since: booked.booked,
    };
  // The burst's second call, two minutes after the first nobody answered.
  const second = secondTry(c, now);
  if (second && second !== "wait")
    return {
      tier: 0,
      kind: "lead",
      code: "second_try",
      why: second.step === "booked" && c.just_booked ? `Second try now (booked an intro for ${bookedFor(c.just_booked.start, now)})` : "Second try now",
      sort: -second.due,
      due_since: second.due,
    };
  // They called us today and nobody answered: before any retry timing.
  if (missed === "today")
    return { tier: 1, kind: "lead", code: "missed_call_today", why: "Called us, missed it", sort: -(c.inbound_call_at ?? 0) };
  // A burst or confirmation call nobody answered: the voice note is next.
  const due = voiceNoteDue(c, now);
  const voice = due === "confirm" && !confirmVoiceMine(c, host) ? null : due;
  if (voice || second === "wait") {
    if (!voice) return null;
    return voiceItem(c, voice);
  }
  // A reply nobody has answered (a call, a saved outcome or a written reply
  // clears it), whatever retry or booking is ahead (Aziz, 2026-11-05).
  if (replyAge !== null && replyAge <= DAY) {
    const ahead = c.booked_at !== null && c.booked_at > now;
    if (ahead) {
      const a = c.appt && c.appt.start === c.booked_at ? c.appt : null;
      // Their own intro (or one with no host): confirmed in one tap.
      const confirmable = a !== null && a.type === "intro" && !a.confirmed && (host === null || !a.assigned || a.assigned === host);
      return {
        tier: 1,
        kind: confirmable ? "confirm" : "lead",
        code: "reply_booked",
        why: `Wrote back, has ${a ? `an ${a.type}` : "a call"} ${whenWords(c.booked_at as number, now)}`,
        sort: -(c.inbound_at ?? 0),
        due_since: c.inbound_at,
      };
    }
    return { tier: 1, kind: "lead", code: "reply_today", why: "Wrote back today", sort: -(c.inbound_at ?? 0), due_since: c.inbound_at };
  }
  // Older replies, up to a week, so nothing drops out.
  if (replyAge !== null && replyAge <= 7 * DAY)
    return { tier: 2, kind: "lead", code: "reply_waiting", why: "Still waiting on you", sort: -(c.inbound_at ?? 0), due_since: c.inbound_at };
  if (c.due_at !== null && c.due_at > now) return null;
  if (c.booked_at && c.booked_at > now) return null;
  const resting = c.stage_role !== null && RESTING_ROLES.includes(c.stage_role);
  const callbackLate = c.callback_at !== null && c.callback_at <= now;
  if (resting && !callbackLate) return null;
  // Tries from the softphone move the ladder too, when the dialer holds no state.
  const ladder =
    c.due_at === null && c.callback_at === null && c.misses > 0 && !c.reached && c.last_dial_at !== null
      ? nextTry(Math.min(c.misses, 4) - 1, c.last_dial_at)
      : null;
  if (ladder && (ladder.unreachable || (ladder.due !== null && ladder.due > now)) && !callbackLate) return null;
  // A call-back missed today is today's work; an older one is overdue.
  if (callbackLate) {
    const today = kuwaitDay(c.callback_at as number) === kuwaitDay(now);
    return {
      tier: today ? 1 : 2,
      kind: "lead",
      code: today ? "callback_today" : "callback_late",
      why: today ? `Call back, missed at ${kuwaitClock(c.callback_at as number)} today` : "Callback is overdue",
      sort: c.callback_at as number,
      due_since: c.callback_at,
    };
  }
  // An intro no-show: today's work for its first day, then due to day seven.
  const noShow = c.last_call_type === "intro" && c.last_call_status === "noshow" && c.last_call_at !== null && now - c.last_call_at <= 7 * DAY;
  if (noShow) {
    const fresh = now - (c.last_call_at as number) < DAY;
    return { tier: fresh ? 1 : 2, kind: "lead", code: "intro_noshow", why: "Missed the intro, rebook it", sort: -(c.last_call_at ?? 0) };
  }
  // An intro the lead cancelled: rebook it within the week (as the closer's demo rule).
  const cancelled = c.cancelled_intro_at ?? null;
  if (cancelled !== null && now - cancelled <= 7 * DAY)
    return { tier: 2, kind: "lead", code: "intro_cancelled", why: "Cancelled the intro, rebook it", sort: -cancelled };
  const newish = c.created_at !== null && now - c.created_at <= 2 * DAY && !c.reached;
  if (newish && (c.sales_lead || c.inbound_at !== null)) {
    // Under an hour old: before the rest of today's work, newest first.
    const young = now - (c.created_at as number) < HOUR;
    return {
      tier: 1,
      kind: "lead",
      code: c.last_dial_at ? "new_not_reached" : "new_never_called",
      why: c.last_dial_at ? "New lead, not reached yet" : "New lead, never called",
      sort: -(c.created_at ?? 0),
      pin: young ? 0 : 1,
      due_since: c.created_at,
    };
  }
  const retryDue = (c.due_at !== null && c.due_at <= now) || (ladder !== null && !ladder.unreachable);
  if (retryDue)
    return {
      tier: 2,
      kind: "lead",
      code: "retry",
      why: c.due_at === null && c.misses ? `Next try is due (${c.misses} unanswered on Maqsam)` : "Next try is due",
      sort: c.due_at ?? c.last_dial_at ?? 0,
    };
  // The long tail: every sales lead of the last 30 days nobody has called,
  // tagged by the form or sitting in a sales pipeline (the ROAS tag alone
  // missed leads booked without the form).
  const quiet = c.sales_lead && c.created_at !== null && now - c.created_at <= 30 * DAY && !c.reached && !c.last_dial_at;
  if (quiet) return { tier: 3, kind: "lead", code: "never_called", why: "Never called", sort: -(c.created_at ?? 0) };
  return null;
}

/** Outcomes that end the sales talk: a call booked before them is not confirmed or called by the setter. */
const ENDING_CLOSES: readonly string[] = ["not_ready", "not_interested", "disqualified", "wrong_number"];

/**
 * The setter closed the lead with an outcome that ends the talk after its
 * call was booked (a lead he reached at the "call now" and had the intro
 * with then and there): the booked intro is not confirmed, nor pinned at its
 * minute. A booking after the close (the lead came back) is worked as usual.
 */
export function endedAfterBooking(c: Candidate): boolean {
  if (!c.closed || !ENDING_CLOSES.includes(c.closed) || !c.appt) return false;
  const booked = c.appt.booked;
  // A call whose booking time is not known is worked as before.
  if (booked === null) return false;
  const closedAt = c.closed_at ?? null;
  return closedAt === null || closedAt > booked;
}

/**
 * Which leads a setter should call and in what order (Aziz, 2026-11-05: one
 * queue all day instead of four Slack channels).
 *
 * Call now (tier 0): the setter's own intro from five minutes before it to
 * twenty after, always first; then a call-back due now, a missed call, a
 * reply, a new lead (ten minutes, never dialed), the lead's own intro
 * booking (thirty minutes, nobody called since), the burst's second try
 * (two minutes after the first no-answer, within the hour), a hot lead's
 * follow-up, and confirmations in their last two and a half hours.
 *
 * Today (tier 1): a voice note after a call nobody answered, leads under an
 * hour old nobody reached (newest first), then by heat: the setter's own
 * intro to mark, the evening-before confirmation, a missed call, a reply of
 * the last day (with a booked call too), a call-back missed today, a fresh
 * intro no-show, the rest of the leads of the last two days nobody reached.
 *
 * Due (tier 2): replies of the last week still waiting, intro no-shows and
 * cancelled intros to rebook, overdue call-backs, retries. Never called
 * (tier 3): every sales lead of the last 30 days nobody has called.
 *
 * A lead called from the softphone counts: Maqsam's unanswered calls move
 * it down the same retry ladder as the dialer's own No answer.
 *
 * Out: do-not-disturb, a signed client or a won stage (always), closed
 * (booked, unreachable, not interested, not ready, disqualified, wrong
 * number, handled), claimed by another rep, another rep's lead
 * (setterScope), and resting stages (disqualified, paused, long-term
 * nurture, lost), unless the lead wrote or a call-back is due.
 */
export function rankForSetter(
  items: Candidate[],
  me: string,
  now: number,
  meGhl: string | null = null,
  manager = false,
): Ranked[] {
  const out: Ranked[] = [];
  // No HighLevel user means every host only for a manager; a rep not linked
  // yet hosts nothing, so other reps' intros stay off their queue (2026-11-04).
  const host = meGhl ?? (manager ? null : "__none__");
  for (const c of items) {
    // A signed client, or a lead in a won stage, is client success's (the
    // CEO, 2026-10-11: a signed client stays in Closed on the pipeline and
    // out of every sales list).
    if (c.dnd || c.signed || c.stage_role === "won") continue;
    // A number the dialer cannot call is left for the Maqsam softphone.
    if (!routePhone(c.phone).ok) continue;
    if (c.claimed_by && c.claimed_by !== me) continue;
    // The intro that just rang out waits its five minutes out of sight.
    if (introWaiting(c.appt, now)) continue;
    const h = heat(c, now);
    // Work on the setter's own calendar comes before whose lead it is, but
    // a lead the setter closed (not ready, not interested, disqualified, a
    // wrong number) after the call was booked is not confirmed or called at
    // its minute: he had the intro then and there (2026-11-06 review).
    const ended = endedAfterBooking(c);
    const job = (ended ? null : appointmentWork(c.appt, now, "setter", host)) ?? hotFollowUp(c, me, now, manager);
    const main = job ?? (setterScope(c, me, meGhl, manager) ? setterLeadWork(c, now, host) : null);
    // Their own intro past its window with no mark: Today's work, unless
    // the lead has something as urgent (the mark rides on that item).
    const mark = markWork(c.unmarked_intro !== undefined ? c.unmarked_intro : c.unmarked, now, "setter", host);
    const item = main && (main.tier <= 1 || !mark) ? main : mark;
    if (item) place(out, c, h, { ...item, mark: item.mark ?? mark?.mark ?? null }, now);
  }
  return order(out);
}

export interface CloserFacts {
  /** The closer's own demo for this lead: when, and how it went. */
  demo_at: number | null;
  demo_status: string | null;
  /** The lead signed (a deal on the New Client Form). */
  signed: boolean;
}

/**
 * A closer's queue: their demo leads. Tier 0 is a demo lead who wrote back
 * minutes ago, a call-back that is due, or a confirmation in its last two
 * and a half hours; tier 1 is a confirmation of a demo booked more than a
 * day ahead, their own demo to mark, and a lead who showed and has not
 * signed once their follow-up is due; tier 2 a missed or cancelled demo in
 * the last two weeks with nothing rebooked.
 */
export function rankForCloser(
  items: (Candidate & CloserFacts)[],
  me: string,
  now: number,
  meGhl: string | null = null,
  manager = false,
): Ranked[] {
  const out: Ranked[] = [];
  const host = meGhl ?? (manager ? null : "__none__");
  for (const c of items) {
    if (c.dnd || c.signed) continue;
    if (!routePhone(c.phone).ok) continue;
    if (c.claimed_by && c.claimed_by !== me) continue;
    const h = heat(c, now);
    const main = appointmentWork(c.appt, now, "closer", host) ?? hotFollowUp(c, me, now, manager) ?? closerLeadWork(c, now);
    const mark = markWork(c.unmarked_demo !== undefined ? c.unmarked_demo : c.unmarked, now, "closer", host);
    const item = main && (main.tier <= 1 || !mark) ? main : mark;
    if (item) place(out, c, h, { ...item, mark: item.mark ?? mark?.mark ?? null }, now);
  }
  return order(out);
}

function closerLeadWork(c: Candidate & CloserFacts, now: number): Item | null {
  const replied = c.inbound_at !== null && now - c.inbound_at <= 10 * MIN && (!c.last_dial_at || c.last_dial_at < c.inbound_at);
  const callbackNow = callbackSoon(c, now);
  const missed = missedCall(c, now);
  if (replied || callbackNow || missed === "now")
    return {
      tier: 0,
      kind: "lead",
      code: callbackNow ? "callback_now" : missed === "now" ? "missed_call_now" : "reply_now",
      why: callbackNow ? callbackWords(c, now) : missed === "now" ? "Called us, missed it" : "Wrote back minutes ago",
      sort: -(c.inbound_call_at ?? c.inbound_at ?? c.callback_at ?? 0),
      due_since: callbackNow ? c.callback_at : missed === "now" ? (c.inbound_call_at ?? null) : c.inbound_at,
    };
  if (missed === "today")
    return { tier: 1, kind: "lead", code: "missed_call_today", why: "Called us, missed it", sort: -(c.inbound_call_at ?? 0) };
  if (c.closed) return null;
  if (c.due_at !== null && c.due_at > now) return null;
  if (c.booked_at && c.booked_at > now) return null;
  const past = c.demo_at !== null && c.demo_at <= now;
  if (past && c.demo_status === "showed" && now - (c.demo_at ?? 0) <= 30 * DAY)
    return { tier: 1, kind: "lead", why: "Showed, not signed yet", code: "showed_not_signed", sort: c.due_at ?? c.demo_at ?? 0 };
  if (past && (c.demo_status === "noshow" || c.demo_status === "cancelled") && now - (c.demo_at ?? 0) <= 14 * DAY)
    return {
      tier: 2,
      kind: "lead",
      code: c.demo_status === "noshow" ? "demo_noshow" : "demo_cancelled",
      why: c.demo_status === "noshow" ? "Missed the demo, rebook it" : "Cancelled the demo, rebook it",
      sort: -(c.demo_at ?? 0),
    };
  return null;
}

// ---------------------------------------------------------------------------
// Maqsam's record of a call, matched to the dialer's attempt
// (mahara-power-dialer src/domain.mjs matchCall and isNoAnswer, v0.7.22)
// ---------------------------------------------------------------------------

/** One call as Maqsam's history (GET /v3/calls) returns it. */
export interface MaqsamCall {
  id?: string | number;
  referenceId?: string | null;
  type?: string;
  state?: string;
  duration?: number | string | null;
  /** Seconds (or milliseconds) since the epoch. */
  timestamp?: number | string;
  calleeNumber?: string | null;
  callee?: string | null;
  agents?: (string | { email?: string | null; identifier?: string | null; id?: string | number | null })[];
}

export interface OpenAttempt {
  phone: string;
  started_at: number;
  maqsam_email: string;
  maqsam_ref?: string | null;
  maqsam_call_id?: string | null;
}

const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/**
 * The one Maqsam call that is this attempt: the same number, the rep's seat,
 * placed from five seconds before the attempt to two minutes after, and the
 * same reference or call id once either is known. Two candidates is no match:
 * an outcome is never guessed.
 */
export function matchCall(a: OpenAttempt, calls: MaqsamCall[]): MaqsamCall | null {
  const phone = digits(a.phone);
  const email = a.maqsam_email.toLowerCase();
  const found = calls.filter(c => {
    const when = Number(c.timestamp) < 1e12 ? Number(c.timestamp) * 1000 : Number(c.timestamp);
    const seat = (c.agents ?? []).some(x =>
      typeof x === "string" ? x.toLowerCase() === email : String(x?.email ?? "").toLowerCase() === email,
    );
    return (
      digits(c.calleeNumber ?? c.callee) === phone &&
      seat &&
      Number.isFinite(when) &&
      when >= a.started_at - 5_000 &&
      when <= a.started_at + 120_000 &&
      (!a.maqsam_call_id || String(c.id) === String(a.maqsam_call_id)) &&
      (!a.maqsam_ref || !c.referenceId || String(c.referenceId) === String(a.maqsam_ref))
    );
  });
  return found.length === 1 ? found[0] : null;
}

/** Maqsam says nobody answered, and no second was spoken. */
export function isNoAnswer(c: MaqsamCall | null): boolean {
  // A completed zero-second call may be an error, voicemail or an incomplete record.
  return !!c && ["no-answer", "no_answer", "unanswered"].includes(String(c.state ?? "").toLowerCase()) && Number(c.duration) === 0;
}

const FINAL = new Set(["completed", "serviced", "no_answer", "no-answer", "unanswered", "busy", "failed", "blocked", "abandoned"]);

/** How the call went, in the words the dialer shows, once Maqsam has it. */
export function callSummary(c: MaqsamCall | null): {
  final: boolean;
  answered: boolean;
  seconds: number;
  words: string;
} | null {
  if (!c) return null;
  const state = String(c.state ?? "").toLowerCase();
  const seconds = Math.max(0, Math.round(Number(c.duration) || 0));
  const answered = (state === "completed" || state === "serviced") && seconds > 0;
  const words = answered
    ? "Answered"
    : state === "busy"
      ? "Busy"
      : state === "no_answer" || state === "no-answer" || state === "unanswered"
        ? "No answer"
        : state === "failed" || state === "blocked"
          ? "Did not connect"
          : state === "abandoned"
            ? "Hung up before it connected"
            : state === "completed" || state === "serviced"
              ? "Connected, no talk time"
              : "In progress";
  return { final: FINAL.has(state), answered, seconds, words };
}

// ---------------------------------------------------------------------------
// Booking from the dialer
// ---------------------------------------------------------------------------

/**
 * The calendars a call is booked on (HighLevel, read 2026-09-25): the intro
 * on the page the lead's class belongs to (15 minutes, Tahrir and Aziz, two
 * hours' notice, three days out); the demo on "Demo" (45 minutes, Ahmed and
 * Aziz, an hour's notice, three days out). "Demo 2" is a copy of it and was
 * last booked on 8 September; "Demo" on 21 September.
 */
export const BOOKING_CALENDARS = {
  intro_qualified: "dsqmJ393Dwl9fDSbIVOI",
  intro_unqualified: "cFeDl0FY8iaXll61lus8",
  demo: "jQqXS1YuFnmGZKLkrE62",
} as const;

/** What can be booked: an intro, a demo, or a follow-up call (2026-10-11, the lead page and the demo script). */
export type BookingKind = "intro" | "demo" | "follow_up";

/**
 * The calendar a new booking goes on. A follow-up call goes on the one
 * calendar the calendars setting names follow_up ("Follow up call"); with
 * no such calendar in the setting it is "", and the booking is refused.
 */
export function calendarFor(
  kind: BookingKind,
  leadClass: string | null,
  calendars?: Record<string, { type?: string } | undefined> | null,
): string {
  if (kind === "demo") return BOOKING_CALENDARS.demo;
  if (kind === "follow_up") {
    const ids = Object.entries(calendars ?? {})
      .filter(([, c]) => c?.type === "follow_up")
      .map(([id]) => id);
    return ids.length === 1 ? (ids[0] as string) : "";
  }
  return leadClass === "qualified" ? BOOKING_CALENDARS.intro_qualified : BOOKING_CALENDARS.intro_unqualified;
}

/**
 * HighLevel's free slots ({"2026-09-26": {slots: [...]}, traceId}) as days in
 * order, each slot an ISO time still ahead of `now`.
 */
export function parseSlots(d: Record<string, unknown>, now: number): { day: string; slots: string[] }[] {
  const out: { day: string; slots: string[] }[] = [];
  for (const [day, v] of Object.entries(d ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const list = ((v as { slots?: unknown })?.slots ?? []) as unknown[];
    const slots = list
      .map(s => String(s))
      .filter(s => Number.isFinite(Date.parse(s)) && Date.parse(s) > now)
      .sort((a, b) => Date.parse(a) - Date.parse(b));
    if (slots.length) out.push({ day, slots });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

/** A start time that is exactly one of the offered slots (same instant). */
export function slotOffered(start: string, days: { slots: string[] }[]): boolean {
  const t = Date.parse(start);
  return Number.isFinite(t) && days.some(d => d.slots.some(s => Date.parse(s) === t));
}

/** "Sat 26 Sep, 10:20" in Kuwait time, for notes and toasts. */
export function kuwaitWords(ms: number): string {
  const d = new Date(ms + KUWAIT);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${day} ${d.getUTCDate()} ${mon}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// The rep's day, as the stats row shows it
// ---------------------------------------------------------------------------

export interface DayStats {
  /** Outcomes saved today, with or without a call through the dialer. */
  saved: number;
  /** Calls Maqsam took from the dialer today. */
  calls: number;
  /** Of those, the ones Maqsam's record shows answered. */
  answered: number;
  /** Of those, the ones whose record Maqsam has not returned yet. */
  unmatched: number;
  talk_s: number;
  booked: number;
  auto_no_answer: number;
}

/** Today's numbers from the dialer's own attempts (Kuwait day from `dayStart`). */
export function dayStats(attempts: Record<string, unknown>[], dayStart: number): DayStats {
  const since = (v: unknown) => {
    const t = v ? Date.parse(String(v)) : Number.NaN;
    return Number.isFinite(t) && t >= dayStart;
  };
  const saved = attempts.filter(a => a.state === "saved" && since(a.saved_at));
  const calls = attempts.filter(a => !a.manual && since(a.started_at) && a.state !== "failed" && a.state !== "dialing");
  const answered = calls.filter(a => ["completed", "serviced"].includes(String(a.call_state ?? "")) && Number(a.call_duration_s ?? 0) > 0);
  return {
    saved: saved.length,
    calls: calls.length,
    answered: answered.length,
    unmatched: calls.filter(a => !a.maqsam_call_id).length,
    talk_s: answered.reduce((s, a) => s + Number(a.call_duration_s ?? 0), 0),
    booked: saved.filter(a => a.outcome === "booked").length,
    auto_no_answer: saved.filter(a => a.auto_saved).length,
  };
}

/**
 * A HighLevel time as epoch ms. The contact's appointment list writes the
 * sub-account's wall time with no zone ("2026-09-24 16:00:00", Kuwait); the
 * calendar endpoints write an offset. Read both the same way.
 */
export function ghlTime(v: unknown): number {
  const s = String(v ?? "").trim();
  if (!s) return Number.NaN;
  if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(s)) return Date.parse(s);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/);
  return m ? Date.parse(`${m[1]}T${m[2]}+03:00`) : Number.NaN;
}

// ---------------------------------------------------------------------------
// Outcomes on appointment work (the intro call itself, confirmations)
// ---------------------------------------------------------------------------

export const APPOINTMENT_OUTCOMES = ["confirmed", "rescheduled", "cancelled", "showed", "noshow"] as const;
export type AnyOutcome = Outcome | (typeof APPOINTMENT_OUTCOMES)[number];

export const ANY_OUTCOME_WORDS: Record<AnyOutcome, string> = {
  ...OUTCOME_WORDS,
  confirmed: "Confirmed the call",
  rescheduled: "Rescheduled the call",
  cancelled: "Cancelled the call",
  showed: "Held the intro",
  noshow: "No-show",
};

export interface Effect {
  /** Mark on the appointment (goes to HighLevel as the calendar's marks do). */
  mark: "showed" | "noshow" | "cancelled" | "invalid" | null;
  /** The lead's own confirmation, kept in the cockpit. */
  confirmation: "confirmed" | "no_answer" | "cancelled" | null;
  /** The lead's retry ladder and queue state move by the lead rules. */
  ladder: boolean;
  /** A cancelled call comes back the next working morning, to be rebooked. */
  rebook: boolean;
}

/**
 * What an outcome does on each kind of dialer item, or null when it does not
 * belong there. On a lead it is the lead rules. On the intro call: held
 * (showed), no-show, no answer (the intro window is still open, the ladder
 * does not move) or not a fit (disqualified: the intro is marked invalid,
 * the lead is closed). On a confirmation: confirmed, no answer, cancelled
 * (marked cancelled, rebooked the next morning) or not interested (the call
 * is cancelled and the lead closed). Moving the call is book.move's.
 */
export function appointmentEffect(kind: ItemKind, outcome: AnyOutcome): Effect | null {
  const none: Effect = { mark: null, confirmation: null, ladder: false, rebook: false };
  if (kind === "lead")
    return (OUTCOMES as readonly string[]).includes(outcome) ? { ...none, ladder: true } : null;
  // Moving the call is book.move's; it records the lead's agreement itself.
  if (outcome === "rescheduled") return none;
  if (kind === "intro") {
    if (outcome === "showed") return { ...none, mark: "showed" };
    if (outcome === "noshow") return { ...none, mark: "noshow" };
    if (outcome === "no_answer") return none;
    if (outcome === "disqualified") return { ...none, mark: "invalid", ladder: true };
    // Held, qualified, and not ready yet for a valid reason: the intro is
    // marked held and the lead goes to long-term nurture (Aziz's Loom).
    if (outcome === "not_ready") return { ...none, mark: "showed", ladder: true };
    return null;
  }
  if (outcome === "confirmed") return { ...none, confirmation: "confirmed" };
  // The intro had on video in the confirmation call's room (m1 round 6):
  // the intro is marked held, and it was confirmed by being had.
  if (outcome === "showed") return { ...none, mark: "showed", confirmation: "confirmed" };
  if (outcome === "no_answer") return { ...none, confirmation: "no_answer" };
  if (outcome === "cancelled") return { ...none, mark: "cancelled", confirmation: "cancelled", rebook: true };
  if (outcome === "not_interested" || outcome === "disqualified" || outcome === "not_ready")
    return { ...none, mark: "cancelled", confirmation: "cancelled", ladder: true };
  return null;
}

/** The next working morning at 10:00 Kuwait time (Friday is off). */
export function nextMorning(now: number): number {
  let t = kuwaitAt(now, 10, 0, 1);
  if (new Date(t + KUWAIT).getUTCDay() === 5) t += DAY;
  return t;
}

/**
 * Where a dialer outcome moves the lead in the sales pipeline, as stage roles
 * to try in order (the first the lead's pipeline has wins), or none to leave
 * the stage alone. Built from what HighLevel does on the sub-account
 * (research of 2026-09-26):
 *
 * - No answer and call back leave the stage: entering a nurture stage
 *   messages the lead at once.
 * - A no-show mark and a disqualified mark on an intro are moved by
 *   HighLevel's own automation, so the dialer does not move them again.
 * - Bookings, the lead's confirmation of an intro, cancellations and a clear
 *   no are what HighLevel leaves where they were; the dialer moves those.
 * - Four unanswered tries: short-term nurture from a fresh stage, long-term
 *   nurture once already nurtured.
 */
export function targetRoles(
  kind: ItemKind,
  outcome: AnyOutcome,
  closed: string | null,
  booked: BookingKind | null = null,
  call: "intro" | "demo" | null = null,
  current: StageRole | null = null,
): StageRole[] {
  // A follow-up call moves no stage (2026-10-11): the lead stays where the demo left them.
  if (outcome === "booked") return booked === "follow_up" ? [] : booked === "demo" ? ["demo_booked"] : ["intro_booked"];
  if (outcome === "confirmed") return call === "intro" ? ["intro_confirmed"] : [];
  if (outcome === "cancelled") return call === "demo" ? ["demo_cancelled"] : ["intro_cancelled"];
  if (outcome === "noshow") return [];
  if (outcome === "disqualified") return kind === "intro" ? [] : ["disqualified"];
  // Not interested and not ready yet both rest in long-term nurture; only
  // "not interested" is tagged (tagsFor), and neither disqualifies.
  if (outcome === "not_interested" || outcome === "not_ready") return ["nurture_long"];
  if (kind === "lead" && outcome === "no_answer" && closed === "unreachable")
    return current === "new" || current === "hot" || current === null ? ["nurture_short"] : ["nurture_long"];
  return [];
}

/** The tags an outcome leaves on the contact (the sub-account's own tags). */
export function tagsFor(outcome: AnyOutcome): string[] {
  if (outcome === "not_interested") return ["not interested"];
  if (outcome === "disqualified") return ["disqualified"];
  if (outcome === "wrong_number") return ["wrong-number"];
  return [];
}

// ---------------------------------------------------------------------------
// The setter's one queue (Aziz, 2026-11-05): who confirmed, the voice note's
// facts, and today's speed to lead
// ---------------------------------------------------------------------------

/**
 * The lead confirmed by their pipeline stage: "Intro Call CONFIRMED" (or the
 * one-call pipeline's "Call CONFIRMED", pinned to the same role in the
 * pipeline setting), entered after this call was booked (the opportunity
 * changed after the booking). The stage confirms the intro; a demo only in
 * the one-call pipeline, whose stage name does not say intro. HighLevel's
 * own "confirmed" status never counts: every calendar confirms on booking.
 */
export function stageConfirms(
  role: StageRole | null,
  stageName: string | null,
  stageAt: number | null,
  a: { type: "intro" | "demo"; booked: number | null },
): boolean {
  if (role !== "intro_confirmed" || stageAt === null || a.booked === null || stageAt < a.booked) return false;
  return a.type === "intro" || !/intro/i.test(String(stageName ?? ""));
}

/** The form's answers and the call, as a voice-note script needs them (nothing is sent). */
export interface VoiceFacts {
  step: VoiceStep;
  first_name: string | null;
  company: string | null;
  country: string | null;
  services: string | null;
  revenue: string | null;
  goal: string | null;
  challenge: string | null;
  projects_12m: string | null;
  ready_to_invest: string | null;
  decision_maker: string | null;
  /** Their booked intro (or the call being confirmed): Kuwait time, and their own clock when it differs. */
  call: { type: "intro" | "demo"; start_at: string; kuwait: string; theirs: string | null } | null;
  /** The language they filled the form in, when it says (ar or en). */
  language: "ar" | "en" | null;
  /** The rep sending it, first name in English and Arabic as the seat has them. */
  rep: { first_name: string | null; first_name_ar: string | null };
  /** What is not known, in the screen's words. */
  missing: string[];
}

const clean = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s ? s : null;
};
const first = (v: unknown): string | null => clean(String(v ?? "").trim().split(/\s+/)[0]);

/** A country code as its name ("SA" → Saudi Arabia), or the stored text. */
export function countryName(code: unknown): string | null {
  const c = clean(code);
  if (!c) return null;
  if (!/^[a-z]{2}$/i.test(c)) return c;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(c.toUpperCase()) ?? c;
  } catch {
    return c;
  }
}

/** "16:00" on a zone's clock. */
function zoneClockWords(ms: number, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
}

/**
 * The facts for the voice note the setter records on their own phone after
 * a call nobody answered (Aziz, 2026-11-05: "a personalized voice note ...
 * a guide with context on what they filled in on their form"). The form no
 * longer asks for projects signed in the last 12 months, so that one is
 * said as not known. The form's language is read from its answers.
 */
export function voiceFacts(
  step: VoiceStep,
  lead: Record<string, unknown>,
  call: { type: "intro" | "demo"; start: number } | null,
  rep: { name?: unknown; name_ar?: unknown },
): VoiceFacts {
  const services = clean(lead.services);
  const answers = [lead.challenge, lead.decision_maker, lead.readiness, lead.revenue, lead.revenue_goal].map(v => String(v ?? ""));
  const arabic = answers.some(a => /[؀-ۿ]/.test(a));
  const english = answers.some(a => /[a-z]{3,}/i.test(a.replace(/\$?\d[\d,.]*\s*[km]?|less than|more than|under|over|million/gi, "")));
  const zone = leadZones(lead.country)?.[0] ?? null;
  let theirs: string | null = null;
  if (call && zone) {
    try {
      const t = zoneClockWords(call.start, zone);
      theirs = t === zoneClockWords(call.start, "Asia/Kuwait") ? null : `${t} their time`;
    } catch {
      theirs = null;
    }
  }
  const facts: VoiceFacts = {
    step,
    first_name: first(lead.name),
    company: clean(lead.company),
    country: countryName(lead.country),
    // "Yes" is the form's tick, not what they do.
    services: services && !/^(yes|no|نعم|لا)$/i.test(services) ? services : null,
    revenue: clean(lead.revenue),
    goal: clean(lead.revenue_goal),
    challenge: clean(lead.challenge),
    projects_12m: null,
    ready_to_invest: clean(lead.readiness),
    decision_maker: clean(lead.decision_maker),
    call: call ? { type: call.type, start_at: new Date(call.start).toISOString(), kuwait: kuwaitWords(call.start), theirs } : null,
    language: arabic ? "ar" : english ? "en" : null,
    rep: { first_name: first(rep.name), first_name_ar: first(rep.name_ar) },
    missing: [],
  };
  const words: [keyof VoiceFacts, string][] = [
    ["first_name", "their name"],
    ["company", "company"],
    ["country", "country"],
    ["services", "what they do"],
    ["revenue", "revenue"],
    ["goal", "revenue goal"],
    ["projects_12m", "projects signed in the last 12 months (the form does not ask)"],
    ["ready_to_invest", "ready to invest"],
    ["decision_maker", "decision maker"],
    ["language", "language"],
  ];
  facts.missing = words.filter(([k]) => facts[k] === null).map(([, w]) => w);
  return facts;
}

/** Today's speed to lead, as the setter's strip shows it. */
export interface SpeedToday {
  /** Today's new sales leads (ROAS-tagged, qualified or unqualified, created since 00:00 Kuwait). */
  leads: number;
  called: number;
  within5: number;
  /** Median minutes to the first call, over the leads called. Null with none called. */
  median_min: number | null;
  not_called: number;
  /** The lead waiting longest for a first call, now. */
  oldest_waiting: { contact_id: string; name: string | null; minutes: number } | null;
}

/** A Maqsam address as the rule compares it. */
export function lineAddress(email: unknown): string {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Whether a sales seat made this call (2026-11-05), the Numbers page's and
 * the CEO cockpit's rule: B2B's rep id on it (a rep on B2B's roster), or a
 * sales seat's Maqsam address (`line`: every cockpit_sales_people and
 * cockpit_sales_reps maqsam_email), so the setter, who has no roster row,
 * counts. A copy of apps/sales-cockpit/src/lib/calls.ts salesLineCall:
 * change both together.
 */
export function salesLineCall(c: { sales_rep_id?: unknown; agent_email?: unknown }, line: ReadonlySet<string>): boolean {
  if (c.sales_rep_id) return true;
  const a = lineAddress(c.agent_email);
  return a.includes("@") && line.has(a);
}

/** A call the strip reads: Maqsam's copy, or one the dialer placed (`seat`: a seat placed it). */
export interface StripCall {
  contact_id?: unknown;
  lead_phone8?: unknown;
  occurred_at?: unknown;
  agent_email?: unknown;
  sales_rep_id?: unknown;
  seat?: boolean;
}

/**
 * Today's speed to lead (Aziz, 2026-11-05): the Numbers page's rule
 * (lib/calls.ts: ROAS-tagged leads, qualified or unqualified, created in the
 * window; the first call by a sales seat, either direction, salesLineCall),
 * plus the dialer's own placed calls, a seat's by definition, which Maqsam's
 * copy picks up a few minutes later. A call counts for the lead it is linked
 * to, else for the lead with its last eight digits. The never-called are
 * counted beside the median, never in it.
 */
export function speedToday(
  leads: readonly { contact_id: string; name?: string | null; phone8?: string | null; lead_created_at?: unknown; lead_class?: unknown }[],
  calls: readonly StripCall[],
  now: number,
  line: ReadonlySet<string> = new Set(),
): SpeedToday {
  const dayStart = kuwaitAt(now, 0);
  const at = (v: unknown) => {
    const t = v ? Date.parse(String(v)) : Number.NaN;
    return Number.isFinite(t) ? t : null;
  };
  const by = new Map<string, number[]>();
  for (const c of calls) {
    if (c.seat !== true && !salesLineCall(c, line)) continue; // never a call-centre agent's
    const t = at(c.occurred_at);
    const k = c.contact_id ? `c:${c.contact_id}` : c.lead_phone8 ? `p:${c.lead_phone8}` : "";
    if (!k || t === null) continue;
    by.set(k, [...(by.get(k) ?? []), t]);
  }
  const mins: number[] = [];
  let within5 = 0;
  let notCalled = 0;
  let oldest: SpeedToday["oldest_waiting"] = null;
  const seen = new Set<string>();
  for (const l of leads) {
    if (seen.has(l.contact_id)) continue;
    seen.add(l.contact_id);
    if (l.lead_class !== "qualified" && l.lead_class !== "unqualified") continue;
    const created = at(l.lead_created_at);
    if (created === null || created < dayStart || created > now) continue;
    const firstCall = [...(by.get(`c:${l.contact_id}`) ?? []), ...(l.phone8 ? (by.get(`p:${l.phone8}`) ?? []) : [])]
      .filter(t => t >= created)
      .sort((x, y) => x - y)[0];
    if (firstCall === undefined) {
      notCalled += 1;
      const minutes = Math.floor((now - created) / MIN);
      if (!oldest || minutes > oldest.minutes) oldest = { contact_id: l.contact_id, name: l.name ?? null, minutes };
      continue;
    }
    const m = (firstCall - created) / MIN;
    mins.push(m);
    if (m <= 5) within5 += 1;
  }
  const sorted = [...mins].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  const median = !sorted.length ? null : sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  return {
    leads: mins.length + notCalled,
    called: mins.length,
    within5,
    median_min: median === null ? null : Math.round(median * 10) / 10,
    not_called: notCalled,
    oldest_waiting: oldest,
  };
}
