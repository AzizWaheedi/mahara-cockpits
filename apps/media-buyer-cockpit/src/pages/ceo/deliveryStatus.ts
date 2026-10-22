import { money } from "@/components/ceo/format";
import {
  CPB_BAD,
  CPB_GATE,
  CPL_BAD,
  CPL_GATE,
  SHOW_RATE_GOOD,
} from "@/lib/kpi";
import type { DeliveryPayload } from "@/types/ceo/payloads";

/**
 * Aziz's client status rule (2026-09-21) under the golden rule (R5,
 * 2026-10-22), in the words every CEO tab uses for it. The rule itself is
 * hermes/ceo-refresh/native/adapters/delivery.js clientStatus; these lines
 * say what it does, case by case, so the Delivery and Backend hints never
 * describe a narrower rule than the one that judged the row.
 */

type ClientRow = DeliveryPayload["clients"][number];
type Status = ClientRow["status"];

/** Why a row is judged on cost per lead alone. */
export type CplOnly = NonNullable<ClientRow["cplOnly"]>;

/** What each status means, for every client. */
export function statusRule(status: Status): string {
  const cpl = money(CPL_GATE);
  const cplBad = money(CPL_BAD);
  const cpb = money(CPB_GATE);
  const bad = money(CPB_BAD);
  switch (status) {
    case "bad":
      return `Cost per confirmed booking over ${bad}, or over ${cpb} with a cost per lead over ${cplBad}; no confirmed booking after more than ${bad} of spend; or a cost per lead over ${cplBad} (spend with no leads counts as that) with no confirmed booking yet, with bookings not measured, or for a Done With You client.`;
    case "watch":
      return `Cost per confirmed booking within ${cpb} with a cost per lead over ${cpl} or a show rate under ${SHOW_RATE_GOOD}% (a high cost per lead under a good cost per booking is a watch, never off track); cost per confirmed booking from ${cpb} to ${bad} with a cost per lead within ${cplBad}; no confirmed booking yet on spend up to ${bad} with a cost per lead within ${cplBad} (up to ${cpb} is too early to judge); bookings not measured with a cost per lead within ${cplBad}; or a Done With You client with a cost per lead over ${cpl} and within ${cplBad}.`;
    case "good":
      return `Cost per confirmed booking within ${cpb}, cost per lead within ${cpl} and a show rate of at least ${SHOW_RATE_GOOD}% over the last 30 days. A Done With You client is on track with a cost per lead within ${cpl}.`;
    default:
      return "No spend in the last 7 days.";
  }
}

/**
 * Why a row is judged on cost per lead alone: the payload's `cplOnly`, or,
 * on a payload stored before it, bookings the board does not store.
 */
export function cplOnlyOf(r: ClientRow): CplOnly | null {
  if (r.cplOnly !== undefined) return r.cplOnly;
  return r.confirmed7d === null ? "not measured" : null;
}

/** The sentence for a Done With You row's bookings and cost per booking. */
export const DWY_BOOKINGS =
  "Done With You: the client books its own meetings, so its bookings are not ours to count and there is no cost per booking.";

/** The status rule for a row judged on cost per lead alone, and why. */
export function cplOnlyRule(status: Status, why: CplOnly): string {
  const cpl = money(CPL_GATE);
  const cplBad = money(CPL_BAD);
  const lead =
    status === "bad"
      ? `off track: cost per lead over ${cplBad}, or spend with no leads`
      : status === "good"
        ? `on track: cost per lead within ${cpl}`
        : status === "watch"
          ? why === "not measured"
            ? `a watch: cost per lead within ${cplBad}, and never on track while its bookings are not measured`
            : `a watch: cost per lead over ${cpl} and within ${cplBad}`
          : "no spend in the last 7 days";
  if (why === "dwy")
    return `${DWY_BOOKINGS} Judged on cost per lead alone, ${lead}.`;
  if (why === "no service mode")
    return `No client card or Service Mode says whether we book this client's meetings, and no confirmed booking is stored for it in these 7 days, so it is judged on cost per lead alone, ${lead}.`;
  return `The Client Performance board stores none of this client's bookings for these days, so it is judged on cost per lead alone, ${lead}.`;
}
