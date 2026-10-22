/**
 * The official KPI gates, in one place for the site. Aziz, 2026-09-16: $15 per
 * lead and $60 per booking are what we aim for; anything above needs action.
 * Aziz, 2026-10-13: "The CSM: make it $15 cost per lead and $60 cost per
 * booking", so the client success cockpit judges on the same two.
 *
 * The client success cockpit holds this same file, byte for byte, at
 * apps/client-success-cockpit/src/lib/kpi.ts (an app cannot import from
 * another); scripts/check-shared.sh stops the two drifting. No imports: the
 * cockpit-ceo-api and cockpit-csm-api Edge Functions bundle it. Keep in step
 * with convex/constants.ts and hermes/ceo-refresh/native/constants.js.
 */
export const CPL_GATE = 15;
export const CPB_GATE = 60;
/**
 * The rate gates the client reports use, in percent. The show rate has no gate
 * of its own: it is SHOW_RATE_GOOD below. Keep in step with convex/constants.ts.
 */
export const BOOKING_RATE_GATE = 25;
export const CLOSE_RATE_GATE = 20;
/**
 * The client status rule on the CEO Delivery tab (Aziz, 2026-09-21): good
 * needs a show rate of at least SHOW_RATE_GOOD and a cost per confirmed
 * booking within CPB_GATE; bad is a cost per booking over CPB_BAD, or no
 * booking after more than CPB_BAD of spend (the spend is the least one
 * booking costs). The golden rule (Aziz; written down 2026-10-21): while the
 * cost per booking is known and within CPB_GATE, a cost per lead over
 * CPL_GATE is a watch, never a constraint. Only when the bookings do not
 * already answer it does a bad cost per lead (over CPL_GATE * 1.5) make a
 * client bad. There is one show rate line for clients, 60, and no lower or
 * higher one (Aziz, 2026-09-21 and 2026-10-12): under it is watch, never
 * bad. SHOW_RATE_AIM is what we aim for above it, not a second line. Keep in
 * step with convex/constants.ts.
 */
export const SHOW_RATE_GOOD = 60;
export const CPB_BAD = 80;
/**
 * The client show rate we aim for, in percent: the October KPI. Aziz,
 * 2026-10-13: "The October KPI is what we shoot for, but I don't want to make
 * that the main constraint." The aim, never the main constraint: nothing is
 * judged against it. The line stays SHOW_RATE_GOOD, under it is a watch, and
 * client-facing text keeps "under our 60% line".
 */
export const SHOW_RATE_AIM = 70;
/** Days a change needs before its numbers mean anything. */
export const LEARNING_DAYS = 3;
/** A new campaign is watched twice a day for this long. */
export const LAUNCH_WATCH_DAYS = 3;

/**
 * The call centre lines, from the constraints checklist (mahara-context
 * context/constraints-checklist.md, "2: Appointment booking" and its Section A,
 * the pickup / call centre constraint): pickup 35% or more, conversations over
 * two minutes 25% or more, the first call within 5 minutes, and at least 9
 * attempts over three days (4 on day one, 3 on day two, 2 on day three). Under
 * either rate line is a call centre constraint. Both rates are read per dial,
 * the official denominator; per lead called is context beside it (the CEO's
 * call, 2026-10-13). callCentre.ts judges with these.
 */
export const REACHED_GATE = 35;
export const CONVERSATION_GATE = 25;
export const FIRST_CALL_MINUTES = 5;
export const FOLLOW_UP_ATTEMPTS = 9;

/**
 * Link CTR below this reads as a hook that is not landing.
 *
 * Grounded in Mahara's own tracker rather than a generic 1% "industry floor":
 * across 83 ads with real impressions the median link CTR is 0.77%, so a 1%
 * floor would flag over half of everything. Keep in step with LINK_CTR_FLOOR
 * in convex/sync.ts. [tracker, 2026-09-06]
 */
export const LINK_CTR_FLOOR = 0.3;

/** Cost per lead over this is very high: half again over the gate. */
export const CPL_BAD = CPL_GATE * 1.5;

export type GridVerdict = "scale" | "hold" | "kill";
export type GridRow = "good" | "watch" | "bad" | "early";

/**
 * How an ad or a campaign is judged (Muhammed, 2026-10-13): cost per lead and
 * cost per booking are read together, and neither one decides alone. Rows are
 * the cost per booking over 7 days, columns the cost per lead (up to the gate,
 * up to CPL_BAD, over it). The worker applies it in `judge`
 * (hermes/cockpit-sync/calculator.ts); this copy draws the playbook and the
 * filters. Keep the two in step.
 */
export const AD_GRID: Record<
  GridRow,
  {
    label: string;
    note?: string;
    cells: [GridVerdict, GridVerdict, GridVerdict];
  }
> = {
  good: {
    label: `Up to $${CPB_GATE} a booking`,
    cells: ["scale", "scale", "hold"],
  },
  watch: {
    label: `$${CPB_GATE} to $${CPB_BAD} a booking`,
    note: "or no booking yet after that much spend",
    cells: ["hold", "hold", "kill"],
  },
  bad: {
    label: `Over $${CPB_BAD} a booking`,
    note: "or no booking yet after that much spend",
    cells: ["kill", "kill", "kill"],
  },
  early: {
    label: "No booking yet",
    note: `under $${CPB_GATE} spent`,
    cells: ["hold", "hold", "kill"],
  },
};

export const GRID_COLUMNS = [
  `Up to $${CPL_GATE} a lead`,
  `$${CPL_GATE} to $${CPL_BAD.toFixed(2)}`,
  `Over $${CPL_BAD.toFixed(2)}`,
] as const;

/** Where 7-day spend, leads and bookings land in AD_GRID. Needs leads. */
export function gridCell(
  spend: number,
  leads: number,
  booked: number,
): { row: GridRow; column: 0 | 1 | 2; verdict: GridVerdict } {
  const cpl = spend / leads;
  const column = cpl <= CPL_GATE ? 0 : cpl <= CPL_BAD ? 1 : 2;
  // No booking yet: what it has spent is already the least one booking costs.
  // The $60 and $80 lines judge the cents a cell shows, as the worker's judge
  // and the Ads page's colours do: $60.004 reads "$60" and is not over $60
  // (2026-10-22).
  const cents = (v: number) => Math.round(v * 100) / 100;
  const cpb = cents(booked > 0 ? spend / booked : spend);
  const row: GridRow =
    booked === 0 && cents(spend) <= CPB_GATE
      ? "early"
      : cpb <= CPB_GATE
        ? "good"
        : cpb <= CPB_BAD
          ? "watch"
          : "bad";
  return { row, column, verdict: AD_GRID[row].cells[column] };
}

/**
 * Out of KPI by both numbers: a kill on the grid, or a hold because the cost
 * per booking is between CPB_GATE and CPB_BAD (or nothing was booked on that
 * much spend). A hold on the good row is not out of KPI: its bookings cost
 * CPB_GATE or less and only the cost per lead is high, and the golden rule
 * makes that a watch, never a constraint (2026-10-21; the old rule listed
 * Atlantis at $43.63 a booking as out of KPI). Too early to judge on bookings
 * is not out of KPI either, unless its cost per lead is a kill. Without
 * booking data (Done With You, no GHL) it is the cost per lead gate alone.
 */
export function belowKpi(c: {
  spend7d: number;
  leads7d: number;
  cpl?: number;
  bookings7d?: number | null;
}): boolean {
  if (c.bookings7d === undefined || c.bookings7d === null)
    return c.cpl !== undefined && c.cpl > CPL_GATE;
  if (c.leads7d <= 0) return c.spend7d >= 1;
  const cell = gridCell(c.spend7d, c.leads7d, c.bookings7d);
  return (
    cell.verdict === "kill" || (cell.verdict === "hold" && cell.row === "watch")
  );
}
