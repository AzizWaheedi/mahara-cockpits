/**
 * The early-mark rule for the practice cockpit's dial.save (harness.tsx), as
 * sales-api has it: a call is not marked held, a no-show or not a fit more
 * than ten minutes before its start (lib.ts refuseMark), except
 *
 * - Did the intro now (the CEO, 2026-11-07): a confirmation call's showed
 *   sent with held_now, for an intro at most a day ahead, either on the
 *   dialer's own call for that confirmation, that connected, is still the
 *   open one (not let go, placed in the last two hours) and has gone three
 *   minutes, the least for an intro (dialer.ts heldNowCheck), or, with no
 *   dialer call, on a Maqsam softphone call with the lead (dialer.ts
 *   softphoneHeld, fix pass 2): the harness's `softphone` knob says what
 *   the fake Maqsam has (talk: a 3-minute answered call with this lead;
 *   short; none; unread: Maqsam cannot be read);
 * - the intro had on video in a room the lead joined in the last three
 *   hours (index.ts joinedForCall).
 *
 * In the practice Dialer: the "Confirm, 2.5 h before" lead, Call, three
 * minutes on the call, then Did the intro now, then the held step's Book the
 * demo. With `call=refuse` the same press is refused, as a call Maqsam would
 * not place. Saved without pressing Call (as the setter does after a
 * softphone call), the `softphone` knob decides.
 */

const MIN = 60_000;

/** sales-api's sentences for a refused Did the intro now (dialer.ts HELD_NOW_LINES). */
export const HELD_NOW_REFUSALS = {
  elsewhere:
    "Do the intro from the dialer's call with them. A call made elsewhere is marked at the intro's time.",
  demo: "Only an intro can be marked held on its confirmation call. Mark a demo at its time.",
  far: "This intro is more than a day away, so it cannot be marked held from this call. Save Confirmed, and mark it at its time.",
  notConnected:
    "Maqsam's record says this call did not connect, so the intro cannot be marked held from it. Save No answer, and mark the intro at its time.",
  gone: "This call is no longer open, so the intro cannot be marked held from it. Save Confirmed, and mark the intro at its time.",
  noTalk:
    "Maqsam's record shows no talk time on this call, so the intro cannot be marked held from it. If you did talk, press Save again in a minute, once the record is complete.",
  short:
    "Under 3 minutes on this call is too short for the intro. Do the intro, then press Did the intro now, or save Confirmed and mark the intro at its time.",
  noSeat:
    "Your seat has no Maqsam address, so this call cannot be checked. Save Confirmed, and mark the intro at its time.",
  noPhone:
    "This lead has no phone number in the cockpit, so this call cannot be checked. Save Confirmed, and mark the intro at its time.",
  unread:
    "Maqsam could not be read just now, so this call cannot be checked. Try again in a minute.",
  noCall:
    "Maqsam shows no call between your seat and this lead in the last two hours. Do the intro on a call with them, then press Did the intro now.",
} as const;

/** What the fake Maqsam has for a Did the intro now saved by hand (the harness's `softphone` knob). */
export type SoftphoneKnob = "talk" | "short" | "none" | "unread";

/** The softphone rule's answer for the knob: talk passes, the rest are sales-api's refusals. */
export function softphoneRefusal(knob: string): string | null {
  if (knob === "short") return HELD_NOW_REFUSALS.short;
  if (knob === "none") return HELD_NOW_REFUSALS.noCall;
  if (knob === "unread") return HELD_NOW_REFUSALS.unread;
  return null;
}

/** The mark an item's outcome makes (sales-api dialer.ts appointmentEffect), or null. */
export function markOf(kind: string, outcome: string): string | null {
  if (kind === "intro")
    return outcome === "showed" || outcome === "not_ready"
      ? "showed"
      : outcome === "noshow"
        ? "noshow"
        : outcome === "disqualified"
          ? "invalid"
          : null;
  if (kind !== "confirm") return null;
  if (outcome === "showed") return "showed";
  return ["cancelled", "not_interested", "disqualified", "not_ready"].includes(
    outcome,
  )
    ? "cancelled"
    : null;
}

/** The practice dialer's call, as far as the rule reads it. */
export interface FakeCall {
  state: string;
  manual: boolean;
  item_kind: string;
  appointment_id?: string | null;
  started_at: string;
  /** How Maqsam's record goes for this call (the harness's `call` knob). */
  plan: string;
}

/**
 * Why sales-api refuses this save's mark before anything is saved, or null.
 * `joined`: the lead joined a video room for this lead in the last three
 * hours (the joined step's Held the intro). `softphone`: the knob, for a
 * save with no dialer call for this confirmation (default talk).
 */
export function earlyMarkRefusal(s: {
  kind: string;
  outcome: string;
  heldNow: boolean;
  call: FakeCall | null;
  appointmentId: string;
  appt: { call_type?: unknown; start_at?: unknown } | null;
  joined: boolean;
  now: number;
  softphone?: string;
}): string | null {
  const mark = markOf(s.kind, s.outcome);
  if (!mark || mark === "cancelled") return null;
  const start = s.appt?.start_at
    ? Date.parse(String(s.appt.start_at))
    : Number.NaN;
  if (!Number.isFinite(start) || start <= s.now + 10 * MIN) return null;
  const heldHere = s.kind === "confirm" && s.outcome === "showed";
  if (heldHere && s.joined) return null;
  if (!(heldHere && s.heldNow))
    return "This call has not happened yet. Mark it once its time has passed, or mark it cancelled.";
  // The intro's own checks first, whatever the call (as heldNowCheck).
  if (s.appt?.call_type !== "intro") return HELD_NOW_REFUSALS.demo;
  if (start > s.now + 24 * 60 * MIN) return HELD_NOW_REFUSALS.far;
  const a = s.call;
  // No dialer call for this confirmation: the softphone's word (Maqsam's).
  if (
    !a ||
    a.manual ||
    a.item_kind !== "confirm" ||
    a.appointment_id !== s.appointmentId
  )
    return softphoneRefusal(s.softphone ?? "talk");
  const placed = Date.parse(a.started_at);
  if (a.state === "failed" || (a.plan === "noanswer" && s.now - placed >= 7000))
    return HELD_NOW_REFUSALS.notConnected;
  if (
    a.state === "released" ||
    (Number.isFinite(placed) && placed < s.now - 2 * 60 * MIN)
  )
    return HELD_NOW_REFUSALS.gone;
  // The practice call has no talk time: three minutes since it was placed.
  if (!Number.isFinite(placed) || s.now - placed < 3 * MIN)
    return HELD_NOW_REFUSALS.short;
  return null;
}
