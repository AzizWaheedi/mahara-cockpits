/**
 * Reminders and objections for the webinar funnel, computed on read from
 * what hermes/webinar-pull keeps in Creative Triage:
 *
 * - cockpit_webinar_messages: HighLevel's messages to a registrant since
 *   they registered, with the status HighLevel holds and the WEBBY
 *   template step they matched;
 * - cockpit_webinar_objections: a registrant's sales calls in Fathom,
 *   tagged by deepseek-flash into fixed categories.
 *
 * Pure, so scripts/webinar.test.ts runs it directly.
 */

export type MessageCount = {
  contactId: string;
  channel: "whatsapp" | "sms" | "email" | "other";
  step: string | null;
  status: string | null;
  n: number;
};

export type ObjectionCall = {
  callId: string;
  contactId: string | null;
  categories: string[];
  objections: { category: string; handled: string | null }[];
};

/** The WEBBY reminders in the order they go out (ghl-workflow-builder phase E). */
export const REMINDER_STEPS: { key: string; label: string }[] = [
  { key: "webby_01_registered_question", label: "Registered: a question" },
  { key: "webby_02_survey_gift", label: "Registered: the survey and gift" },
  { key: "webby_03_calendar_nudge", label: "Add it to your calendar" },
  { key: "webby_04_tomorrow", label: "Tomorrow" },
  { key: "webby_05_one_hour", label: "One hour before" },
  { key: "webby_06_fifteen_min", label: "15 minutes before" },
  { key: "webby_07_five_min", label: "5 minutes before" },
  { key: "webby_08_started", label: "We have started" },
  { key: "webby_09_last_call", label: "Last call" },
  { key: "webby_10_attended_book", label: "Came: book a call" },
  { key: "webby_11_attended_question", label: "Came: a question" },
  { key: "webby_12_noshow_vsl", label: "Missed it: the video" },
  { key: "webby_13_noshow_last", label: "Missed it: last message" },
  { key: "webby_14_gift_delivery", label: "The gift" },
];

/** The objection categories, the worker's words (hermes/webinar-pull CATEGORIES). */
export const OBJECTION_NAMES: Record<string, string> = {
  price: "Price or budget",
  timing: "Not now",
  proof: "Proof it works",
  capacity: "No capacity for more work",
  decision_maker: "Someone else decides",
  past_agency: "Burned by an agency before",
  has_leads: "Has enough work already",
  market: "The market is slow",
  terms: "Contract terms",
  fit: "Not a fit for their work",
  other: "Other",
};

type Tally = { sent: number; delivered: number; read: number; failed: number };
const blank = (): Tally => ({ sent: 0, delivered: 0, read: 0, failed: 0 });

/** One message's status into the tally: read counts as delivered too. */
function add(t: Tally, status: string | null, n: number) {
  t.sent += n;
  const s = (status ?? "").toLowerCase();
  if (s === "read" || s === "opened") {
    t.read += n;
    t.delivered += n;
  } else if (s === "delivered") t.delivered += n;
  else if (s === "failed" || s === "undelivered" || s === "error")
    t.failed += n;
}

export type ReminderStats = {
  whatsapp: Tally;
  sms: Tally;
  email: Tally;
  /** Registrants who got at least one message, and who read a WhatsApp one. */
  reached: number;
  readAny: number;
  steps: ({ key: string; label: string } & Tally)[];
};

export function reminderStats(
  rows: MessageCount[],
  contacts: Set<string>,
): ReminderStats | null {
  const mine = rows.filter(r => contacts.has(r.contactId));
  if (!mine.length) return null;
  const out: ReminderStats = {
    whatsapp: blank(),
    sms: blank(),
    email: blank(),
    reached: new Set(mine.map(r => r.contactId)).size,
    readAny: new Set(
      mine
        .filter(r => r.channel === "whatsapp" && r.status === "read")
        .map(r => r.contactId),
    ).size,
    steps: [],
  };
  const steps = new Map<string, Tally>();
  for (const r of mine) {
    if (
      r.channel === "whatsapp" ||
      r.channel === "sms" ||
      r.channel === "email"
    )
      add(out[r.channel], r.status, r.n);
    if (r.step) {
      const t = steps.get(r.step) ?? blank();
      add(t, r.status, r.n);
      steps.set(r.step, t);
    }
  }
  out.steps = REMINDER_STEPS.filter(s => steps.has(s.key)).map(s => ({
    ...s,
    ...(steps.get(s.key) as Tally),
  }));
  return out;
}

export type ObjectionStats = {
  /** Sales calls of the round's registrants that were tagged. */
  calls: number;
  /** Calls where the prospect raised nothing. */
  none: number;
  categories: {
    key: string;
    label: string;
    /** Calls that raised it at least once. */
    calls: number;
    /** Times it was raised, and of those how often the rep answered it. */
    raised: number;
    handled: number;
  }[];
};

export function objectionStats(
  calls: ObjectionCall[],
  contacts: Set<string>,
): ObjectionStats | null {
  const mine = calls.filter(c => c.contactId && contacts.has(c.contactId));
  if (!mine.length) return null;
  const by = new Map<
    string,
    { calls: number; raised: number; handled: number }
  >();
  for (const c of mine) {
    for (const k of new Set(c.categories)) {
      const b = by.get(k) ?? { calls: 0, raised: 0, handled: 0 };
      b.calls++;
      by.set(k, b);
    }
    for (const o of c.objections) {
      const b = by.get(o.category) ?? { calls: 0, raised: 0, handled: 0 };
      b.raised++;
      if (o.handled === "handled") b.handled++;
      by.set(o.category, b);
    }
  }
  return {
    calls: mine.length,
    none: mine.filter(c => !c.objections.length).length,
    categories: [...by.entries()]
      .map(([key, b]) => ({ key, label: OBJECTION_NAMES[key] ?? key, ...b }))
      .sort((a, b) => b.calls - a.calls || b.raised - a.raised),
  };
}
