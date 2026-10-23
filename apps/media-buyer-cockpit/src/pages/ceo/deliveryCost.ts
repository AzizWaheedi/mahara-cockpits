import type {
  DeliveryDay,
  DeliveryPayload,
  DeliveryWindow,
} from "@/types/ceo/payloads";

/**
 * One cost per booking for every CEO tab (R10, 2026-10-22): spend over the
 * Client Performance board's confirmed bookings, by the day the booking was
 * made. Delivery, Today, Backend, the timeframe card and Goals all read it
 * from here, so no tab divides by provisional bookings or by a count with a
 * different rule.
 *
 * The spend divided is `spendMeasured`: spend on the days the board stores a
 * booking count for the client. Spend on days or clients it does not store
 * (a cancelled card, an account tied to no client) is left out and named on
 * the Delivery tab, never divided by zero bookings.
 *
 * A payload computed before the refresh that reads the board (no
 * `spendMeasured` on a window, no `confirmed` on a day) reads n/a with that
 * reason, never the old figure under the new label.
 *
 * Done With You clients (the CEO, 23 Oct 2026, cost per booking decisions,
 * 2: "No keep the CPL but ignore CPB") book their own meetings: the refresh
 * leaves their spend out of `spendMeasured` and their stored bookings out of
 * `confirmed`, so every tab's cost per booking leaves them out with no work
 * here. Their spend stays in spend, leads and cost per lead, and each tab's
 * hint names what was left out (doneWithYouOf, doneWithYouOfDays,
 * doneWithYouLine).
 */

/** The label every tab uses for this number. */
export const CPB_CONFIRMED_LABEL = "Cost per confirmed booking";

/** Why a payload from before the board's counts gives no cost per confirmed booking. */
export const BEFORE_CONFIRMED =
  "This refresh predates the confirmed count, so there is no cost per confirmed booking until the delivery section refreshes.";

/** Why a refresh that fell back to the media sync gives no cost per confirmed booking. */
export const FALLBACK_CONFIRMED =
  "Creative Triage could not be read this refresh, so bookings are the media sync's and there is no cost per confirmed booking (the Delivery tab's note says why).";

/** Why a window computed from the board has no count: it stores no day of it. */
export const NOT_STORED =
  "The Client Performance board stores no bookings for these days.";

/** Where the payload's bookings came from, for the reason a cost is missing. */
type Source = DeliveryPayload["bookingSource"];

/** The reason a window or a run of days has no confirmed count. */
const noCount = (source?: Source) =>
  source === "media sync" ? FALLBACK_CONFIRMED : BEFORE_CONFIRMED;

/** A cost per confirmed booking with what it divides and why it is missing. */
export type ConfirmedCost = {
  /** Spend over confirmed bookings, to the cent; null when it cannot be known. */
  value: number | null;
  /** Confirmed bookings made in the window; null when not known. */
  confirmed: number | null;
  /** The spend divided (spend on days the board stores bookings); null when not known. */
  spend: number | null;
  /** One plain sentence when `value` is null; null otherwise. */
  why: string | null;
};

const cents = (x: number) => Math.round(x * 100) / 100;
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** True when the window was computed from the board's confirmed bookings. */
export function windowHasConfirmed(
  w: DeliveryWindow | null | undefined,
): w is DeliveryWindow & { confirmed: number; spendMeasured: number } {
  return !!w && isNum(w.spendMeasured) && isNum(w.confirmed);
}

/**
 * A window's cost per confirmed booking, as the delivery refresh worked it
 * out. `source` is the payload's `bookingSource`, for the reason when the
 * window carries no confirmed count.
 */
export function cpbConfirmedOf(
  w: DeliveryWindow | null | undefined,
  source?: Source,
): ConfirmedCost {
  if (!w)
    return {
      value: null,
      confirmed: null,
      spend: null,
      why: "Delivery numbers are not computed yet.",
    };
  if (!windowHasConfirmed(w))
    return {
      value: null,
      confirmed: null,
      spend: null,
      // A window the refresh computed from the board but whose days it
      // stores none of: not measured, never zero bookings.
      why:
        isNum(w.spendMeasured) && w.confirmed === null
          ? NOT_STORED
          : noCount(source),
    };
  const value = isNum(w.cpbConfirmed) ? w.cpbConfirmed : null;
  return {
    value,
    confirmed: w.confirmed,
    spend: w.spendMeasured,
    why:
      value !== null
        ? null
        : w.confirmed === 0
          ? "No confirmed booking was made in these days."
          : "No spend on the days the board stores bookings.",
  };
}

/** True when every day in the list was computed from the board's counts. */
export function daysHaveConfirmed(rows: readonly DeliveryDay[]): boolean {
  return rows.every(r => r.confirmed !== undefined);
}

/**
 * Cost per confirmed booking over any run of days of the daily series, from
 * `from` to `to` inclusive: the sum of the measured spend over the sum of the
 * confirmed bookings, on the days the board stores. Days it does not store
 * are left out of both and counted in `why` when nothing is left.
 */
export function cpbConfirmedOfDays(
  rows: readonly DeliveryDay[] | null | undefined,
  from: string,
  to: string,
  source?: Source,
): ConfirmedCost & { daysNotMeasured: number } {
  const days = (rows ?? []).filter(r => r.date >= from && r.date <= to);
  if (days.length === 0)
    return {
      value: null,
      confirmed: null,
      spend: null,
      why: "No delivery days are kept for these dates.",
      daysNotMeasured: 0,
    };
  if (!daysHaveConfirmed(days))
    return {
      value: null,
      confirmed: null,
      spend: null,
      why: noCount(source),
      daysNotMeasured: 0,
    };
  let confirmed = 0;
  let spend = 0;
  let measured = 0;
  for (const r of days) {
    if (!isNum(r.confirmed)) continue;
    measured += 1;
    confirmed += r.confirmed;
    spend += isNum(r.spendMeasured) ? r.spendMeasured : 0;
  }
  const daysNotMeasured = days.length - measured;
  if (measured === 0)
    return {
      value: null,
      confirmed: null,
      spend: null,
      why: NOT_STORED,
      daysNotMeasured,
    };
  const value = confirmed > 0 && spend > 0 ? cents(spend / confirmed) : null;
  return {
    value,
    confirmed,
    spend: cents(spend),
    why:
      value !== null
        ? null
        : confirmed === 0
          ? "No confirmed booking was made in these days."
          : "No spend on the days the board stores bookings.",
    daysNotMeasured,
  };
}

/** Confirmed bookings over a run of days; null when the days predate the count or none is stored. */
export function confirmedOfDays(
  rows: readonly DeliveryDay[] | null | undefined,
  from: string,
  to: string,
): number | null {
  return cpbConfirmedOfDays(rows, from, to).confirmed;
}

/** Two decimals with thousands commas, for an amount a hint names exactly. */
const dollars2 = (x: number) => {
  const [whole, part] = cents(x).toFixed(2).split(".");
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${part}`;
};

/**
 * The sentence a company booking count adds for decision 2 (contract 1.2
 * B.5): the rule, so it holds whether or not a done-with-you client spent or
 * booked in the window. Starts with a space.
 */
export const DWY_BOOKINGS_LEFT_OUT =
  " Done-with-you clients' bookings are not counted here: they book their own meetings.";

/**
 * DWY_BOOKINGS_LEFT_OUT for a window or run of days computed since 23 Oct
 * 2026; empty for an older payload (null), which still counted them.
 */
export function doneWithYouBookingsLine(
  left: DoneWithYouLeftOut | null,
): string {
  return left === null ? "" : DWY_BOOKINGS_LEFT_OUT;
}

/** Done With You spend a window or a run of days leaves out of its cost per booking. */
export type DoneWithYouLeftOut = {
  /** The spend left out, to the cent. */
  spend: number;
  /** Per client, when the window names them; empty for a run of days. */
  clients: { client: string; spend: number }[];
};

/**
 * The Done With You spend a window's cost per booking leaves out, or null on
 * a payload computed before 23 Oct 2026 (not known, never zero).
 */
export function doneWithYouOf(
  w: DeliveryWindow | null | undefined,
): DoneWithYouLeftOut | null {
  if (!w || !Array.isArray(w.doneWithYou)) return null;
  const clients = w.doneWithYou.filter(x => isNum(x.spend) && x.spend > 0);
  return {
    spend: cents(clients.reduce((n, x) => n + x.spend, 0)),
    clients,
  };
}

/**
 * The Done With You spend over a run of days of the daily series, or null
 * when any day predates 23 Oct 2026 or no day is kept.
 */
export function doneWithYouOfDays(
  rows: readonly DeliveryDay[] | null | undefined,
  from: string,
  to: string,
): DoneWithYouLeftOut | null {
  const days = (rows ?? []).filter(r => r.date >= from && r.date <= to);
  if (days.length === 0 || days.some(r => r.spendDoneWithYou === undefined))
    return null;
  return {
    spend: cents(
      days.reduce(
        (n, r) => n + (isNum(r.spendDoneWithYou) ? r.spendDoneWithYou : 0),
        0,
      ),
    ),
    clients: [],
  };
}

/**
 * The sentence a cost per booking hint adds for decision 2: what it leaves
 * out, with the amount. "$205.05 of نهوض نجد's spend is left out: done with
 * you, the client books its own meetings." Starts with a space. Empty for a
 * payload computed before 23 Oct 2026 (null), which did not leave them out,
 * and when no done-with-you spend falls in the days: there is nothing left
 * out to name, and the payload cannot tell whether such a client exists.
 */
export function doneWithYouLine(left: DoneWithYouLeftOut | null): string {
  if (left === null || !(left.spend > 0)) return "";
  const [one] = left.clients;
  if (left.clients.length === 1 && one)
    return ` ${dollars2(left.spend)} of ${one.client}'s spend is left out: done with you, the client books its own meetings.`;
  if (left.clients.length > 1)
    return ` ${dollars2(left.spend)} of done-with-you clients' spend is left out (${left.clients
      .map(x => `${x.client} ${dollars2(x.spend)}`)
      .join(", ")}): they book their own meetings.`;
  return ` ${dollars2(left.spend)} of done-with-you clients' spend is left out: they book their own meetings.`;
}
