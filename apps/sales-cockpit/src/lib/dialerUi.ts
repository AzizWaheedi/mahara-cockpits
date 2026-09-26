/**
 * The dialer page's small rules, kept apart so they can be tested: how long
 * a skip holds, what the queue's chips count, the countdown in a few words,
 * the line about leads the dialer cannot call, and what can be sent to a
 * lead who did not answer.
 */

import { countdown, mmss, type QueueItem, type UrgentEvent } from "./dialer";

// ---------------------------------------------------------------------------
// Skips
// ---------------------------------------------------------------------------

/** A skip hides its lead for half an hour at most. */
export const SKIP_MS = 30 * 60_000;

export interface Skip {
  /** When the rep skipped the lead. */
  at: number;
  /** The lead's tier in the queue then. */
  tier: number;
  /** Why the lead was in the queue then (skipReason). */
  reason: string;
}

/**
 * Why a lead is in the queue: the queue's own words, and the moments behind
 * them, so a new message or a new call-back is a new reason to call.
 */
export function skipReason(i: QueueItem): string {
  return [
    i.kind ?? "lead",
    i.why,
    i.appointment?.id ?? "",
    i.inbound_at ?? "",
    i.callback_at ?? "",
  ].join("|");
}

export function skipFor(i: QueueItem, now: number): Skip {
  return { at: now, tier: i.tier, reason: skipReason(i) };
}

/** True while the skip still hides the lead: under 30 minutes, same tier, same reason. */
export function skipHolds(
  s: Skip | undefined,
  i: QueueItem | undefined,
  now: number,
): boolean {
  return Boolean(
    s &&
      i &&
      now - s.at < SKIP_MS &&
      s.tier === i.tier &&
      s.reason === skipReason(i),
  );
}

/**
 * The skips that still hold against this read of the queue. A lead that
 * left the queue, moved tier or came back for another reason is dropped for
 * good. The same object when nothing lapsed, so a state update is a no-op.
 */
export function liveSkips(
  skips: Record<string, Skip>,
  queue: QueueItem[],
  now: number,
): Record<string, Skip> {
  const byId = new Map(queue.map(i => [i.contact_id, i] as const));
  const out: Record<string, Skip> = {};
  let dropped = false;
  for (const [id, s] of Object.entries(skips)) {
    if (skipHolds(s, byId.get(id), now)) out[id] = s;
    else dropped = true;
  }
  return dropped ? out : skips;
}

/**
 * The queue's counts less the leads this page hides (skipped, or saved a
 * moment ago), so a chip never counts a lead the list does not show.
 */
export function countsShown(
  counts: readonly number[],
  queue: readonly QueueItem[],
  shown: readonly QueueItem[],
): number[] {
  const kept = new Set(shown.map(i => i.contact_id));
  const out = [...counts];
  for (const i of queue)
    if (!kept.has(i.contact_id) && out[i.tier] !== undefined)
      out[i.tier] = Math.max(0, out[i.tier] - 1);
  return out;
}

// ---------------------------------------------------------------------------
// The countdown, short enough to sit beside a name on a phone
// ---------------------------------------------------------------------------

/**
 * "Dial within 1:42", "Dial now", "10 min late" (past the two-minute
 * target), or a call-back's "Due in 4 min" / "3 min overdue".
 */
export function shortCountdown(e: UrgentEvent, now: number): string {
  if (e.callback) return countdown(e, now);
  const left = e.deadline - now;
  if (left > 0) return `Dial within ${mmss(left)}`;
  const late = Math.floor(-left / 60_000);
  return late >= 1 ? `${late} min late` : "Dial now";
}

/** The sentence behind a late label, for the line under the title. */
export function lateSentence(e: UrgentEvent, now: number): string | null {
  if (e.callback || e.deadline > now) return null;
  const waited = Math.max(1, Math.floor((now - e.at) / 60_000));
  return `Two-minute target passed, waiting ${waited} min.`;
}

// ---------------------------------------------------------------------------
// Leads the dialer cannot call
// ---------------------------------------------------------------------------

export interface Undialable {
  no_phone?: number | null;
  other?: number | null;
}

const whole = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));

/** One plain line about recent open leads the dialer cannot call, or null when there are none. */
export function undialableLine(
  u: Undialable | null | undefined,
): string | null {
  const none = whole(u?.no_phone);
  const abroad = whole(u?.other);
  const total = none + abroad;
  if (!total) return null;
  const leads = (n: number) => `${n} recent ${n === 1 ? "lead" : "leads"}`;
  const outside = (n: number) =>
    `${n === 1 ? "has a number" : "have numbers"} the dialer has no line for`;
  if (!abroad)
    return `${leads(none)} ${none === 1 ? "has" : "have"} no phone number, so the dialer can't call them.`;
  if (!none)
    return `${leads(abroad)} ${outside(abroad)}. Call ${abroad === 1 ? "it" : "them"} from the Maqsam softphone.`;
  return `${leads(total)} can't be dialed here: ${none} ${none === 1 ? "has" : "have"} no phone number, ${abroad} ${outside(abroad)}. Call ${abroad === 1 ? "that one" : "those"} from the Maqsam softphone.`;
}

// ---------------------------------------------------------------------------
// After a call nobody answered: what can be sent, said plainly
// ---------------------------------------------------------------------------

/** A channel as the conversation read reports it. */
export interface Reach {
  on: boolean;
  dnd: boolean;
  reachable: boolean;
  window?: { open: boolean } | null;
}

export type MissMoment = "missed_call" | "confirm";

export interface AfterMiss {
  title: string;
  text: string;
  /** What the main button opens: WhatsApp with the ready message, the email box, or nothing. */
  send: "whatsapp" | "email" | null;
}

const LEAD_IN: Record<MissMoment, string> = {
  missed_call:
    "A WhatsApp right after a missed call gets answered far more often than an email.",
  confirm:
    "A short WhatsApp asking them to confirm often gets the answer a call did not.",
};
const MESSAGE: Record<MissMoment, string> = {
  missed_call: "missed-call",
  confirm: "confirmation",
};
const TAIL: Record<MissMoment, string> = {
  missed_call: "",
  confirm: " The dialer tries the call again in two hours.",
};
const ASK_WHATSAPP = "No answer. Send them a WhatsApp?";
const ASK_EMAIL = "No answer. Send them an email?";
const NOTHING = "No answer. No message can go from here";
const NO_TEMPLATE =
  "They have not written in the last 24 hours, so WhatsApp takes only an approved template, and none is set up yet";
const MANAGER =
  " A manager connects the templates under Follow-ups, WhatsApp library.";

function blocked(c: Reach, channel: "whatsapp" | "email"): string | null {
  const wa = channel === "whatsapp";
  if (!c.on)
    return `Sending by ${wa ? "WhatsApp" : "email"} is switched off in the cockpit`;
  if (c.dnd)
    return `They asked not to be contacted ${wa ? "on WhatsApp" : "by email"}`;
  if (!c.reachable)
    return wa
      ? "They have no phone number in HighLevel for WhatsApp"
      : "They have no email address in HighLevel";
  return null;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The step after a no-answer. WhatsApp goes free within 24 hours of the
 * lead's last message and as an approved template after that; with no
 * template set up, only email goes. Unknown (still reading) offers WhatsApp
 * and lets the box say what can go.
 */
export function afterMiss(o: {
  moment: MissMoment;
  /** null while the conversation is being read. */
  whatsapp: Reach | null | undefined;
  email: Reach | null | undefined;
  /** Whether any WhatsApp template is live; null while being read. */
  templatesLive: boolean | null;
  /** Whether a ready-made message exists for the moment; null while being read. */
  messageReady: boolean | null;
}): AfterMiss {
  const { moment } = o;
  const tail = TAIL[moment];
  const unknown: AfterMiss = {
    title: ASK_WHATSAPP,
    text: `${LEAD_IN[moment]}${tail}`,
    send: "whatsapp",
  };
  const wa = o.whatsapp;
  if (!wa) return unknown;
  const waWhy = blocked(wa, "whatsapp");
  if (!waWhy) {
    if (wa.window?.open)
      return {
        title: ASK_WHATSAPP,
        text: `${LEAD_IN[moment]} ${
          o.messageReady === false
            ? "Write it in the box, then send."
            : `The ${MESSAGE[moment]} message is ready in the box; read it, then send.`
        }${tail}`,
        send: "whatsapp",
      };
    if (o.templatesLive === null) return unknown;
    if (o.templatesLive)
      return {
        title: ASK_WHATSAPP,
        text: `${LEAD_IN[moment]} They have not written in the last 24 hours, so it goes as an approved template${
          o.messageReady === false
            ? ": write its line in the box, then send."
            : `, with the ${MESSAGE[moment]} line ready in it. Read it, then send.`
        }${tail}`,
        send: "whatsapp",
      };
  }
  // WhatsApp cannot go now: say why, and whether email can.
  const why = waWhy ?? NO_TEMPLATE;
  const manager = waWhy ? "" : MANAGER;
  const emWhy = o.email ? blocked(o.email, "email") : null;
  if (!emWhy)
    return {
      title: ASK_EMAIL,
      text: `${why}: send an email instead.${manager}${tail}`,
      send: "email",
    };
  return {
    title: NOTHING,
    text: `${why}. Email is out too: ${lower(emWhy)}.${manager}${tail}`,
    send: null,
  };
}
