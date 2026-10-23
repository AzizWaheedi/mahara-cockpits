import { capitalize, money } from "@/components/ceo/format";
import {
  CPB_BAD,
  CPB_GATE,
  CPL_BAD,
  CPL_GATE,
  NO_LEAD_MULTIPLE,
  noLeadLine,
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

/** Dollars to the cent, with commas: the no-lead lines are named exactly. */
const usd2 = (x: number) =>
  `$${(Math.round(x * 100) / 100)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

/**
 * Spend with no lead, in the words every hint uses (the CEO, 23 Oct 2026,
 * cost per booking decisions, 4: "Depends on how much spend if 2x target cpl
 * then yes bad if below that then not enough data"). The line is the row's
 * own when it carries one, else 2 x the $15 gate, always computed.
 */
export function noLeadClauses(line: number = noLeadLine()): {
  bad: string;
  watch: string;
} {
  const target = line / NO_LEAD_MULTIPLE;
  const of = `${NO_LEAD_MULTIPLE} x the ${money(target)} ${target === CPL_GATE ? "gate" : "cost per lead line"}`;
  return {
    bad: `no lead after ${money(line)} of spend (${of})`,
    watch: `no lead yet on under ${money(line)} (not enough data)`,
  };
}

/**
 * A row's own "too few" note (decision 4): no lead yet on the row's spend,
 * under its no-lead line (2 x its cost per lead line), both to the cent.
 * Empty when the row is not too few or the payload predates the flag.
 */
export function tooFewNote(r: ClientRow): string {
  if (r.tooFew !== true) return "";
  const line =
    typeof r.noLeadLine === "number" && Number.isFinite(r.noLeadLine)
      ? r.noLeadLine
      : noLeadLine();
  return `Too few to judge: no lead yet on ${usd2(r.spend7d)}, under ${usd2(line)} (${NO_LEAD_MULTIPLE} x the ${usd2(line / NO_LEAD_MULTIPLE)} cost per lead line).`;
}

/** What each status means, for every client. */
export function statusRule(status: Status): string {
  const cpl = money(CPL_GATE);
  const cplBad = money(CPL_BAD);
  const cpb = money(CPB_GATE);
  const bad = money(CPB_BAD);
  const noLead = noLeadClauses();
  switch (status) {
    case "bad":
      return `Cost per confirmed booking over ${bad}, or over ${cpb} with a cost per lead over ${cplBad}; no confirmed booking after more than ${bad} of spend; or a cost per lead over ${cplBad} with no confirmed booking yet, with bookings not measured, or for a Done With You client. ${capitalize(noLead.bad)} counts as a cost per lead over ${cplBad}, as does no lead after ${NO_LEAD_MULTIPLE} x a client's own cost per lead line. ${DWY_RULE}`;
    case "watch":
      return `Cost per confirmed booking within ${cpb} with a cost per lead over ${cpl} or a show rate under ${SHOW_RATE_GOOD}% (a high cost per lead under a good cost per booking is a watch, never off track); cost per confirmed booking from ${cpb} to ${bad} with a cost per lead within ${cplBad}; no confirmed booking yet on spend up to ${bad} with a cost per lead within ${cplBad} (up to ${cpb} is too early to judge); bookings not measured with a cost per lead within ${cplBad}; a Done With You client with a cost per lead over ${cpl} and within ${cplBad}; or ${noLead.watch}, which is too few to judge and never off track on leads.`;
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

/**
 * The sentence for a Done With You row's bookings, cost per booking and
 * booking rate (the CEO, 23 Oct 2026, cost per booking decisions, 2), the
 * refresh's own `bookingsWhy` for the row.
 */
export const DWY_BOOKINGS =
  "Done with you: the client books its own meetings, so its cost per booking and booking rate are not judged.";

/** Decision 2 in one sentence, for the status hints. */
export const DWY_RULE =
  "A Done With You client is judged on cost per lead alone, whatever bookings GoHighLevel holds for it, and its spend is left out of every company cost per booking.";

/**
 * The status rule for a row judged on cost per lead alone, and why. `line`
 * is the row's no-lead line (decision 4), 2 x the $15 gate when absent.
 */
export function cplOnlyRule(
  status: Status,
  why: CplOnly,
  line: number = noLeadLine(),
): string {
  const cpl = money(CPL_GATE);
  const cplBad = money(CPL_BAD);
  const noLead = noLeadClauses(line);
  const lead =
    status === "bad"
      ? `off track: cost per lead over ${cplBad}, or ${noLead.bad}`
      : status === "good"
        ? `on track: cost per lead within ${cpl}`
        : status === "watch"
          ? why === "not measured"
            ? `a watch: cost per lead within ${cplBad}, or ${noLead.watch}, and never on track while its bookings are not measured`
            : `a watch: cost per lead over ${cpl} and within ${cplBad}, or ${noLead.watch}`
          : "no spend in the last 7 days";
  if (why === "dwy")
    return `${DWY_BOOKINGS} Judged on cost per lead alone, whatever bookings GoHighLevel holds for it, ${lead}. Its spend is left out of every company cost per booking.`;
  if (why === "no service mode")
    return `No client card or Service Mode says whether we book this client's meetings, and no confirmed booking is stored for it in these 7 days, so it is judged on cost per lead alone, ${lead}.`;
  return `The Client Performance board stores none of this client's bookings for these days, so it is judged on cost per lead alone, ${lead}.`;
}
