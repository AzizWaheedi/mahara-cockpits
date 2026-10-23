import { hasPaymentProblem, PAYMENT_FILTER } from "@/lib/adBillingStrip";
import { cpbDisplay } from "@/lib/costTone";
import { belowKpi, CPB_GATE, noLeadLine } from "@/lib/kpi";

// biome-ignore lint/suspicious/noExplicitAny: a campaign row from the snapshot
type Campaign = any;

/** One row's numbers on the Ads table, for the picked range. */
export type BoardNumbers =
  | { state: "loading" | "error" }
  | {
      state: "ok";
      spend?: number;
      leads?: number;
      cpl?: number;
      bookings?: number;
      bookingRate?: number;
      costPerBooking?: number;
      /**
       * The media data's last day, when the whole range comes after it
       * (Today): spend and leads are not in yet, so they read n/a, never
       * $0 and 0; the bookings are real and counted (2026-10-22).
       */
      spendNotIn?: string;
    };

/** The numbers a row shows once its range is read. */
export type RowNumbers = Extract<BoardNumbers, { state: "ok" }>;

/**
 * The board's numbers for one campaign. On the 7-day default they are the
 * snapshot's own 7-day read (the one the calls are made on); on any other
 * range they come from the same per-campaign range read the campaign panel
 * and the account page use, so all three agree. [aziz, 2026-10-01] The
 * filters read them too (2026-10-21).
 */
export function boardNumbers(
  c: Campaign,
  ranged: boolean,
  read: Campaign | Error | undefined,
): BoardNumbers {
  if (!ranged)
    return {
      state: "ok",
      spend: c.spend7d,
      leads: c.leads7d,
      cpl: c.cpl,
      bookings: c.bookings7d,
      bookingRate: c.bookingRate,
      costPerBooking: c.costPerBooking,
    };
  if (read === undefined) return { state: "loading" };
  if (read instanceof Error) return { state: "error" };
  const t = read.total ?? {};
  const spendNotIn =
    typeof read.spendNotIn === "string" && read.spendNotIn
      ? read.spendNotIn
      : undefined;
  // Done-with-you accounts have no bookings at all: keep them n/a, not 0.
  const bookings =
    c.bookings7d === undefined
      ? undefined
      : Number(read.bookingsTotal ?? t.bookings ?? 0);
  if (spendNotIn) return { state: "ok", bookings, spendNotIn };
  const spend = Number(t.spend ?? 0);
  const leads = Number(t.leads ?? 0);
  return {
    state: "ok",
    spend,
    leads,
    cpl: leads > 0 ? spend / leads : undefined,
    bookings,
    bookingRate:
      bookings !== undefined && leads > 0
        ? (bookings / leads) * 100
        : undefined,
    costPerBooking:
      bookings && bookings > 0 && spend > 0 ? spend / bookings : undefined,
  };
}

/**
 * Earlier leads that still book within $60 hold a row with no lead (decision
 * 4 with the golden rule, contract 1.4.7): the worker holds it, so it is not
 * critical. The cost per booking is judged on the cents its cell shows.
 */
function bookingsHoldNoLead(n: RowNumbers): boolean {
  if (!n.bookings || n.bookings <= 0) return false;
  const cost = n.costPerBooking ?? (n.spend ?? 0) / n.bookings;
  return Math.round(cost * 100) / 100 <= CPB_GATE;
}

export type AdsFilter = {
  label: string;
  /** Reads the row's numbers for the picked range, not the 7-day snapshot. */
  ranged?: boolean;
  /** `n` is undefined while the row's range is being read or failed. */
  test: (c: Campaign, n: RowNumbers | undefined) => boolean;
};

/**
 * One problem at a time — the filters mirror the way the SOP prioritises the
 * day. A filter on spend, leads or bookings reads the numbers its row shows
 * for the picked range: "Cost per booking over $60" on 30 days is the 30-day
 * cost per booking (Aziz, 2026-10-21: the filters did not follow the time
 * frames). The Call and the day average stay on 7 days, as their columns do.
 */
export const ADS_FILTERS: AdsFilter[] = [
  { label: "Everything", test: () => true },
  // No lead on 2 x the $15 gate or more is critical; under it there is not
  // enough data yet (decision 4, 23 Oct 2026). Judged on the cents the
  // Spend cell shows, so $29.99 is not and $30.00 is. Earlier leads that
  // book within $60 hold it, as the worker does.
  {
    label: "Critical",
    ranged: true,
    test: (c, n) =>
      c.verdict === "kill" ||
      c.verdict === "off board" ||
      (n !== undefined &&
        n.leads === 0 &&
        Math.round((n.spend ?? 0) * 100) / 100 >= noLeadLine() &&
        !bookingsHoldNoLead(n)),
  },
  // Meta flags the ad account: unpaid, restricted, grace period or under
  // review. The Payments strip's count chips turn this on (2026-10-13).
  { label: PAYMENT_FILTER, test: c => hasPaymentProblem(c) },
  // Both numbers (Muhammed, 2026-10-13): a kill on the booking grid, or a
  // hold because the cost per booking is over the gate; over the cost per
  // lead gate alone only where bookings are not tracked. A high cost per lead
  // with bookings within $60 is a watch, not out of KPI (the golden rule,
  // 2026-10-21).
  // A row whose leads are not read gets no verdict: missing is never zero.
  {
    label: "Below KPI",
    ranged: true,
    test: (_c, n) =>
      n !== undefined &&
      typeof n.leads === "number" &&
      Number.isFinite(n.leads) &&
      belowKpi({
        spend7d: n.spend ?? 0,
        leads7d: n.leads,
        cpl: n.cpl,
        bookings7d: n.bookings,
      }),
  },
  {
    label: "Fatiguing",
    test: c => c.verdict === "fatiguing" || (c.daysLive ?? 0) >= 14,
  },
  { label: "Under the floor", test: c => c.dayRate < 30 },
  {
    label: `Cost per booking over $${CPB_GATE}`,
    ranged: true,
    // Judged on the amount the Cost / booking cell shows (cents under $100,
    // 2026-10-22), so a row reading "$60" is never listed as over $60 and a
    // row reading "$60.40" always is. A row with no booking on more than $60
    // of spend ("None on $233") is over it too: one booking costs at least
    // the spend (2026-10-21).
    test: (_c, n) =>
      n !== undefined &&
      (cpbDisplay(n.spend, n.bookings, {
        cost: n.costPerBooking,
        spendNotIn: n.spendNotIn,
      }).judged ?? 0) > CPB_GATE,
  },
  {
    label: "No bookings",
    ranged: true,
    test: (_c, n) => n !== undefined && n.bookings === 0 && (n.spend ?? 0) > 20,
  },
  { label: "Not touched in 4+ days", test: c => (c.daysSinceTouch ?? 99) >= 4 },
  // Needs today's decisions, so the page applies it.
  { label: "Undecided today", test: () => true },
];

/** The filter's own rule on a row, with that row's numbers for the range. */
export function adsFilterPasses(
  label: string,
  c: Campaign,
  n: RowNumbers | undefined,
): boolean {
  return (ADS_FILTERS.find(f => f.label === label) ?? ADS_FILTERS[0]).test(
    c,
    n,
  );
}
