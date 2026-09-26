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
}

export type ItemKind = "lead" | "intro" | "confirm";

export interface Ranked extends Candidate {
  tier: 0 | 1 | 2 | 3;
  kind: ItemKind;
  why: string;
  sort: number;
  heat: number;
  hot_reasons: string[];
}

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

/**
 * Appointment work, before any lead: the intro call itself (intros are phone
 * calls the setter makes at the booked minute), then confirmations of calls
 * booked more than 24 hours ahead (Aziz, 2026-09-26), from the evening
 * before (a morning call) or the morning of the day, and among the "call
 * now" items in its last three hours. A try that reached no one waits two
 * hours (thirty minutes near the call).
 */
export function appointmentWork(
  a: Appt | null,
  now: number,
  as: "setter" | "closer",
  meGhl: string | null,
): { tier: 0 | 1; kind: ItemKind; why: string; sort: number } | null {
  if (!a || ENDED.has(String(a.status ?? ""))) return null;
  const mine = !meGhl || !a.assigned || a.assigned === meGhl;
  if (as === "setter" && a.type === "intro" && mine && now >= a.start - 5 * MIN && now <= a.start + 20 * MIN)
    return { tier: 0, kind: "intro", why: `Intro call now, booked for ${whenWords(a.start, now).replace(/^today at /, "")}`, sort: a.start };
  const farAhead = a.booked !== null && a.start - a.booked > DAY;
  if (a.start <= now || !farAhead || a.confirmed || now < confirmFrom(a.start)) return null;
  // Setters confirm their own intros and help with every demo; a closer
  // confirms their own demos (a manager with no HighLevel user sees all).
  const whose = as === "closer" ? a.type === "demo" && (!meGhl || a.assigned === meGhl) : a.type === "demo" || mine;
  if (!whose) return null;
  const soon = a.start - now <= 3 * HOUR;
  if (a.last_try !== null && now - a.last_try < (soon ? 30 * MIN : 2 * HOUR)) return null;
  return {
    tier: soon ? 0 : 1,
    kind: "confirm",
    why: `Confirm the ${a.type} ${whenWords(a.start, now)}`,
    sort: a.start,
  };
}

function place(out: Ranked[], c: Candidate, h: { score: number; reasons: string[] }, item: Omit<Ranked, keyof Candidate | "heat" | "hot_reasons">) {
  out.push({ ...c, ...item, heat: h.score, hot_reasons: h.reasons });
}

/** A hot lead whose planned follow-up has come, for its owner (or any manager). */
function hotFollowUp(c: Candidate, me: string, now: number, manager: boolean): Omit<Ranked, keyof Candidate | "heat" | "hot_reasons"> | null {
  if (!c.hot || c.hot_next_at === null || c.hot_next_at > now) return null;
  if (!manager && c.hot_owner && c.hot_owner !== me) return null;
  const now10 = now - c.hot_next_at <= 10 * MIN;
  return {
    tier: now10 ? 0 : 1,
    kind: "lead",
    why: now10 ? "Hot lead: the follow-up is due now" : "Hot lead: follow up as planned",
    sort: c.hot_next_at,
  };
}

function order(out: Ranked[]): Ranked[] {
  // Call-now items go by urgency; everything else by heat, then its own order.
  return out.sort(
    (a, b) =>
      a.tier - b.tier ||
      (a.tier === 0 ? 0 : b.heat - a.heat) ||
      a.sort - b.sort ||
      a.contact_id.localeCompare(b.contact_id),
  );
}

/**
 * Which leads a setter should call and in what order. Tier 0 is called
 * first: the intro call that is starting, a lead who arrived or wrote in the
 * last ten minutes, a callback that is due now, and a confirmation in its
 * last three hours. Then today's work (confirmations, fresh leads nobody
 * has reached, replies), then no-shows and retries that are due, then every
 * sales lead of the last 30 days nobody has called. Within a tier the
 * hottest lead goes first.
 *
 * A lead called from the softphone counts: Maqsam's unanswered calls move
 * it down the same retry ladder as the dialer's own No answer.
 *
 * Out: do-not-disturb, closed (booked, unreachable, not interested,
 * disqualified, wrong number, handled), claimed by another rep, and resting
 * stages (disqualified, paused, long-term nurture, won, lost), unless the
 * lead wrote or a call-back is due.
 */
export function rankForSetter(
  items: Candidate[],
  me: string,
  now: number,
  meGhl: string | null = null,
  manager = false,
): Ranked[] {
  const out: Ranked[] = [];
  for (const c of items) {
    if (c.dnd) continue;
    // A number the dialer cannot call is left for the Maqsam softphone.
    if (!routePhone(c.phone).ok) continue;
    if (c.claimed_by && c.claimed_by !== me) continue;
    const h = heat(c, now);
    const job = appointmentWork(c.appt, now, "setter", meGhl) ?? hotFollowUp(c, me, now, manager);
    if (job) {
      place(out, c, h, job);
      continue;
    }
    if (c.closed) continue;
    const fresh = c.created_at !== null && now - c.created_at <= 10 * MIN && !c.last_dial_at;
    const replied = c.inbound_at !== null && now - c.inbound_at <= 10 * MIN && (!c.last_dial_at || c.last_dial_at < c.inbound_at);
    const callbackNow = c.callback_at !== null && c.callback_at <= now && now - c.callback_at <= 10 * MIN;
    if (fresh || replied || callbackNow) {
      place(out, c, h, {
        tier: 0,
        kind: "lead",
        why: callbackNow ? "Call back now, as agreed" : replied ? "Wrote back minutes ago" : "New lead, call now",
        sort: -(c.callback_at ?? c.inbound_at ?? c.created_at ?? 0),
      });
      continue;
    }
    if (c.due_at !== null && c.due_at > now) continue;
    if (c.booked_at && c.booked_at > now) continue;
    const unanswered = c.inbound_at !== null && now - c.inbound_at <= DAY && (!c.last_dial_at || c.last_dial_at < c.inbound_at);
    if (unanswered) {
      place(out, c, h, { tier: 1, kind: "lead", why: "Wrote back today", sort: -(c.inbound_at ?? 0) });
      continue;
    }
    const resting = c.stage_role !== null && RESTING_ROLES.includes(c.stage_role);
    const callbackLate = c.callback_at !== null && c.callback_at <= now;
    if (resting && !callbackLate) continue;
    // Tries from the softphone move the ladder too, when the dialer holds no state.
    const ladder =
      c.due_at === null && c.callback_at === null && c.misses > 0 && !c.reached && c.last_dial_at !== null
        ? nextTry(Math.min(c.misses, 4) - 1, c.last_dial_at)
        : null;
    if (ladder && (ladder.unreachable || (ladder.due !== null && ladder.due > now)) && !callbackLate) continue;
    const newish = c.created_at !== null && now - c.created_at <= 2 * DAY && !c.reached;
    if (newish && (c.sales_lead || c.inbound_at !== null)) {
      place(out, c, h, {
        tier: 1,
        kind: "lead",
        why: c.last_dial_at ? "New lead, not reached yet" : "New lead, never called",
        sort: -(c.created_at ?? 0),
      });
      continue;
    }
    const noShow = c.last_call_type === "intro" && c.last_call_status === "noshow" && c.last_call_at !== null && now - c.last_call_at <= 7 * DAY;
    const retryDue = (c.due_at !== null && c.due_at <= now) || (ladder !== null && !ladder.unreachable);
    if (noShow || callbackLate || retryDue) {
      place(out, c, h, {
        tier: 2,
        kind: "lead",
        why: callbackLate
          ? "Callback is overdue"
          : noShow
            ? "Missed the intro, rebook it"
            : c.due_at === null && c.misses
              ? `Next try is due (${c.misses} unanswered on Maqsam)`
              : "Next try is due",
        sort: c.callback_at ?? c.due_at ?? c.last_call_at ?? c.last_dial_at ?? 0,
      });
      continue;
    }
    // The long tail: every sales lead of the last 30 days nobody has called,
    // tagged by the form or sitting in a sales pipeline (the ROAS tag alone
    // missed leads booked without the form).
    const quiet = c.sales_lead && c.created_at !== null && now - c.created_at <= 30 * DAY && !c.reached && !c.last_dial_at;
    if (quiet) place(out, c, h, { tier: 3, kind: "lead", why: "Never called", sort: -(c.created_at ?? 0) });
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
 * minutes ago, a call-back that is due, or a confirmation in its last three
 * hours; tier 1 is a confirmation of a demo booked more than a day ahead,
 * and a lead who showed and has not signed once their follow-up is due;
 * tier 2 a missed or cancelled demo in the last two weeks with nothing
 * rebooked.
 */
export function rankForCloser(
  items: (Candidate & CloserFacts)[],
  me: string,
  now: number,
  meGhl: string | null = null,
  manager = false,
): Ranked[] {
  const out: Ranked[] = [];
  for (const c of items) {
    if (c.dnd || c.signed) continue;
    if (!routePhone(c.phone).ok) continue;
    if (c.claimed_by && c.claimed_by !== me) continue;
    const h = heat(c, now);
    const job = appointmentWork(c.appt, now, "closer", meGhl) ?? hotFollowUp(c, me, now, manager);
    if (job) {
      place(out, c, h, job);
      continue;
    }
    const replied = c.inbound_at !== null && now - c.inbound_at <= 10 * MIN && (!c.last_dial_at || c.last_dial_at < c.inbound_at);
    const callbackNow = c.callback_at !== null && c.callback_at <= now && now - c.callback_at <= 10 * MIN;
    if (replied || callbackNow) {
      place(out, c, h, {
        tier: 0,
        kind: "lead",
        why: callbackNow ? "Call back now, as agreed" : "Wrote back minutes ago",
        sort: -(c.inbound_at ?? c.callback_at ?? 0),
      });
      continue;
    }
    if (c.closed) continue;
    if (c.due_at !== null && c.due_at > now) continue;
    if (c.booked_at && c.booked_at > now) continue;
    const past = c.demo_at !== null && c.demo_at <= now;
    if (past && c.demo_status === "showed" && now - (c.demo_at ?? 0) <= 30 * DAY) {
      place(out, c, h, { tier: 1, kind: "lead", why: "Showed, not signed yet", sort: c.due_at ?? c.demo_at ?? 0 });
      continue;
    }
    if (past && (c.demo_status === "noshow" || c.demo_status === "cancelled") && now - (c.demo_at ?? 0) <= 14 * DAY) {
      place(out, c, h, {
        tier: 2,
        kind: "lead",
        why: c.demo_status === "noshow" ? "Missed the demo, rebook it" : "Cancelled the demo, rebook it",
        sort: -(c.demo_at ?? 0),
      });
    }
  }
  return order(out);
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

// ---------------------------------------------------------------------------
// Outcomes on appointment work (the intro call itself, confirmations)
// ---------------------------------------------------------------------------

export const APPOINTMENT_OUTCOMES = ["confirmed", "rescheduled", "cancelled", "showed", "noshow"] as const;
export type AnyOutcome = Outcome | (typeof APPOINTMENT_OUTCOMES)[number];

export const ANY_OUTCOME_WORDS: Record<AnyOutcome, string> = {
  ...OUTCOME_WORDS,
  confirmed: "Confirmed the call",
  rescheduled: "Moved the call",
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
    return null;
  }
  if (outcome === "confirmed") return { ...none, confirmation: "confirmed" };
  if (outcome === "no_answer") return { ...none, confirmation: "no_answer" };
  if (outcome === "cancelled") return { ...none, mark: "cancelled", confirmation: "cancelled", rebook: true };
  if (outcome === "not_interested" || outcome === "disqualified")
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
  if (outcome === "booked") return booked === "demo" ? ["demo_booked"] : ["intro_booked"];
  if (outcome === "confirmed") return call === "intro" ? ["intro_confirmed"] : [];
  if (outcome === "cancelled") return call === "demo" ? ["demo_cancelled"] : ["intro_cancelled"];
  if (outcome === "noshow") return [];
  if (outcome === "disqualified") return kind === "intro" ? [] : ["disqualified"];
  if (outcome === "not_interested") return ["nurture_long"];
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
