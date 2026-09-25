// The power dialer's rules, brought over from mahara-power-dialer
// (src/domain.mjs, v0.7.22, tested there) and fitted to the sales
// sub-account: phone routing and caller IDs, the retry ladder, and the order
// the queue is worked in. Pure functions; bun test supabase/functions/sales-api.

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

/**
 * The retry ladder for a lead who did not answer: the same day at 17:00,
 * then the next two days at 09:00, then the lead is left as unreachable.
 * `step` is how many unanswered tries there have been.
 */
export function nextTry(step: number, now: number): { step: number; due: number | null; unreachable: boolean } {
  if (step >= 3) return { step, due: null, unreachable: true };
  const next = step + 1;
  let due = next === 1 ? kuwaitAt(now, 17) : kuwaitAt(now, 9, 0, 1);
  if (due <= now) due = next === 1 ? kuwaitAt(now, 17, 0, 1) : kuwaitAt(now, 9, 0, 1);
  // A first retry must be at least an hour away, or it is just a redial.
  if (next === 1 && due - now < HOUR) due = kuwaitAt(now, 9, 0, 1);
  return { step: next, due, unreachable: false };
}

export const OUTCOMES = [
  "no_answer",
  "callback",
  "booked",
  "not_interested",
  "disqualified",
  "wrong_number",
  "handled",
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
}

export interface Ranked extends Candidate {
  tier: 0 | 1 | 2 | 3;
  why: string;
  sort: number;
}

/**
 * Which leads a setter should call and in what order. Tier 0 is called
 * first: a lead who arrived or wrote in the last ten minutes, or a callback
 * that is due now. Then the fresh leads nobody has reached, then no-shows and
 * retries that are due, then leads who went quiet.
 *
 * Out: do-not-disturb, closed (booked, unreachable, not interested,
 * disqualified, wrong number), claimed by another rep, a call already on the
 * calendar, and anything not yet due.
 */
export function rankForSetter(items: Candidate[], me: string, now: number): Ranked[] {
  const out: Ranked[] = [];
  for (const c of items) {
    if (c.dnd || c.closed) continue;
    // A number the dialer cannot call is left for the Maqsam softphone.
    if (!routePhone(c.phone).ok) continue;
    if (c.claimed_by && c.claimed_by !== me) continue;
    if (c.booked_at && c.booked_at > now) continue;
    const fresh = c.created_at !== null && now - c.created_at <= 10 * 60_000 && !c.last_dial_at;
    const replied = c.inbound_at !== null && now - c.inbound_at <= 10 * 60_000 && (!c.last_dial_at || c.last_dial_at < c.inbound_at);
    const callbackNow = c.callback_at !== null && c.callback_at <= now && now - c.callback_at <= 10 * 60_000;
    if (fresh || replied || callbackNow) {
      out.push({ ...c, tier: 0, why: callbackNow ? "Call back now, as agreed" : replied ? "Wrote back minutes ago" : "New lead, call now", sort: -(c.callback_at ?? c.inbound_at ?? c.created_at ?? 0) });
      continue;
    }
    if (c.due_at !== null && c.due_at > now) continue;
    const newish = c.created_at !== null && now - c.created_at <= 2 * DAY && !c.reached;
    const unanswered = c.inbound_at !== null && now - c.inbound_at <= DAY && (!c.last_dial_at || c.last_dial_at < c.inbound_at);
    if (newish || unanswered) {
      out.push({ ...c, tier: 1, why: unanswered ? "Wrote back today" : c.last_dial_at ? "New lead, not reached yet" : "New lead, never called", sort: -(c.inbound_at ?? c.created_at ?? 0) });
      continue;
    }
    const noShow = c.last_call_type === "intro" && c.last_call_status === "noshow" && c.last_call_at !== null && now - c.last_call_at <= 7 * DAY;
    const callbackLate = c.callback_at !== null && c.callback_at <= now;
    const retryDue = c.due_at !== null && c.due_at <= now;
    if (noShow || callbackLate || retryDue) {
      out.push({ ...c, tier: 2, why: callbackLate ? "Callback is overdue" : noShow ? "Missed the intro, rebook it" : "Next try is due", sort: c.callback_at ?? c.due_at ?? c.last_call_at ?? 0 });
      continue;
    }
    // The long tail is the tagged leads only (the ROAS tags, the lead rule of
    // 2026-09-21); an untagged or not-ready contact comes in only when they
    // write back or a callback is due.
    const tagged = c.lead_class === "qualified" || c.lead_class === "unqualified";
    const quiet = tagged && c.created_at !== null && now - c.created_at <= 30 * DAY && !c.reached && !c.last_dial_at;
    if (quiet) out.push({ ...c, tier: 3, why: "Never called", sort: -(c.created_at ?? 0) });
  }
  return out.sort((a, b) => a.tier - b.tier || a.sort - b.sort || a.contact_id.localeCompare(b.contact_id));
}

export interface CloserFacts {
  /** The closer's own demo for this lead: when, and how it went. */
  demo_at: number | null;
  demo_status: string | null;
  /** The lead signed (a deal on the New Client Form). */
  signed: boolean;
}

/**
 * A closer's queue: their demo leads. Tier 0 is a demo leads who wrote back
 * minutes ago, or a demo in the next two hours still unconfirmed (the
 * playbook's confirmation call). Tier 1 is a lead who showed and has not
 * signed, once their follow-up is due. Tier 2 is a missed or cancelled demo
 * in the last two weeks with nothing rebooked.
 */
export function rankForCloser(items: (Candidate & CloserFacts)[], me: string, now: number): Ranked[] {
  const out: Ranked[] = [];
  for (const c of items) {
    if (c.dnd || c.signed) continue;
    if (!routePhone(c.phone).ok) continue;
    if (c.claimed_by && c.claimed_by !== me) continue;
    const replied = c.inbound_at !== null && now - c.inbound_at <= 10 * 60_000 && (!c.last_dial_at || c.last_dial_at < c.inbound_at);
    const unconfirmed = c.demo_at !== null && c.demo_at > now && c.demo_at - now <= 2 * HOUR && c.demo_status === "new";
    const callbackNow = c.callback_at !== null && c.callback_at <= now && now - c.callback_at <= 10 * 60_000;
    if (replied || unconfirmed || callbackNow) {
      out.push({ ...c, tier: 0, why: unconfirmed ? "Demo soon and not confirmed" : callbackNow ? "Call back now, as agreed" : "Wrote back minutes ago", sort: unconfirmed ? (c.demo_at ?? 0) : -(c.inbound_at ?? c.callback_at ?? 0) });
      continue;
    }
    if (c.closed) continue;
    if (c.due_at !== null && c.due_at > now) continue;
    if (c.booked_at && c.booked_at > now) continue;
    const past = c.demo_at !== null && c.demo_at <= now;
    if (past && c.demo_status === "showed" && now - (c.demo_at ?? 0) <= 30 * DAY) {
      out.push({ ...c, tier: 1, why: "Showed, not signed yet", sort: c.due_at ?? c.demo_at ?? 0 });
      continue;
    }
    if (past && (c.demo_status === "noshow" || c.demo_status === "cancelled") && now - (c.demo_at ?? 0) <= 14 * DAY) {
      out.push({ ...c, tier: 2, why: c.demo_status === "noshow" ? "Missed the demo, rebook it" : "Cancelled the demo, rebook it", sort: -(c.demo_at ?? 0) });
    }
  }
  return out.sort((a, b) => a.tier - b.tier || a.sort - b.sort || a.contact_id.localeCompare(b.contact_id));
}

/** Speed to lead in minutes: lead created to the first outbound call, or null if never called. */
export function speedToLead(createdAt: number | null, firstDialAt: number | null): number | null {
  if (createdAt === null || firstDialAt === null || firstDialAt < createdAt) return null;
  return Math.round((firstDialAt - createdAt) / 60_000);
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

export type BookingKind = "intro" | "demo";

export function calendarFor(kind: BookingKind, leadClass: string | null): string {
  if (kind === "demo") return BOOKING_CALENDARS.demo;
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
