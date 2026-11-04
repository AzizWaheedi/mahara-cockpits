import type { SupabaseClient } from "@supabase/supabase-js";
import { parseCallCenterReport } from "../types/ceo/callCenterContract";

export type SheetCell = {
  day: string;
  key: string;
  kind: "actual" | "plan";
  value: number;
  note: string | null;
  by: string;
  at: string;
};

export type LockInRow = {
  id: number;
  month: string;
  section: string;
  sort: number;
  label: string;
  value: string | null;
  status: "measured" | "partial" | "typed" | "missing";
  source: string | null;
  leaves_out: string | null;
  metric_key: string | null;
  client_task_id: string | null;
  answers: Record<string, string>;
  updated_by: string;
  updated_at: string;
};

export type SheetContext = {
  today: string;
  /**
   * The month's lifecycle from the cockpit's own records (20261101q): read
   * loosely through goalsSheetModel's lifecycleOf. Absent before q is live.
   */
  lifecycle?: Record<string, unknown> | null;
  /** Hand-logged payments not checked yet (20261101q); absent before q is live. */
  manualLogged?: Record<string, unknown> | null;
  month: string;
  plan: Record<string, any> | null;
  plans: {
    id: number;
    periodFrom: string;
    periodTo: string;
    title: string;
    status: string;
  }[];
  targets: Record<string, any>[];
  metrics: Record<string, any>[];
  cells: SheetCell[];
  growthDaily: Record<string, any>[];
  windows: {
    from: string | null;
    raw: Record<string, any> | null;
    /** The growth window's front-end cash (20261102m): paidOnWindowDeals for UF cash %. */
    frontEndCash?: {
      paid?: number | null;
      paidOnWindowDeals?: number | null;
    } | null;
  }[];
  cashDaily: { date: string; usd: number }[];
  book: {
    month: string;
    projectedMrr: number;
    collected: number;
    /**
     * Back end only (CEO refresh release goal1102, 2026-11-02): recurring-card
     * payments from clients who were clients before the month, over what those
     * cards owe; `projectedOnDeals` is what is left out as front end. Absent
     * from an older worker.
     */
    collectedBackEnd?: number | null;
    projectedExisting?: number | null;
    projectedOnDeals?: number | null;
    history?: {
      month: string;
      projected: number;
      collected: number;
      collectedBackEnd?: number | null;
      projectedExisting?: number | null;
      projectedOnDeals?: number | null;
    }[];
  } | null;
  /** refundsManual and refundCount arrive with the money refresh's goal1102 release, when passed. */
  refundsMonthly: {
    month: string;
    refunds: number;
    refundsManual?: number;
    refundCount?: number;
  }[];
  bankThrough: string | null;
  deliveryDaily: Record<string, any>[];
  mediaDaily: Record<string, any>[];
  clientDaily: Record<string, any>[];
  churned: { leftOn: string; client: string; reason: string }[];
  churnMonths: {
    month: string;
    activeAtStart: number | null;
    lostBefore: number | null;
  }[];
  softwareMonthly: number | null;
  lockin: LockInRow[];
  locked: { locked_at: string | null; locked_by: string | null } | null;
  /** The shared call centre report by day; null when it could not be read. */
  callDaily:
    | {
        day: string;
        leads: number;
        confirmedBookings: number;
        shows: number;
        noShow: number;
        /** Deals clients marked won, the report's own (2026-11-02): the close rate reads one system. */
        closed?: number;
      }[]
    | null;
  // --- Round 2 (migration 20261102m, 2026-11-02). Each is absent on an older
  // server and null when its store was not read (readsMissing then says why).
  // A ranged store's day inside from..through with no row is 0; outside, not known.
  /** Money in the CEO left out of cashDaily (his own test payment). */
  cashExcluded?:
    | {
        date: string;
        id: string;
        rail: string;
        usd: number;
        reason: string;
        note: string | null;
      }[]
    | null;
  /** The wins ledger by day and kind. */
  winsDaily?:
    | (SheetRanged<{ date: string; kind: string; count: number }> & {
        ledgerFrom?: string;
      })
    | null;
  /** Checked payments tied to an upsell win, by the day paid. */
  upsellCashDaily?:
    | (SheetRanged<{ date: string; usd: number; payments: number }> & {
        ledgerFrom?: string;
      })
    | null;
  /** Signed or paid upsells at their quoted price, by the day signed. */
  upsellContracted?:
    | (SheetRanged<{ date: string; usd: number; count: number }> & {
        ledgerFrom?: string;
      })
    | null;
  /** Refunds by day: Whop (already netted off its charge) and logged by hand. */
  refundsDaily?: SheetRanged<{
    date: string;
    count: number;
    usd: number;
    whopCount: number;
    whopUsd: number;
    manualCount: number;
    manualUsd: number;
  }> | null;
  /** The closer's filed EODs by day; a day with no row is not recorded. */
  salesEodDaily?: {
    rows: { date: string; offers: number | null; eods: number }[];
    source?: string;
  } | null;
  /** Extension grants in the billing log by the day given. */
  extensionsDaily?:
    | (SheetRanged<{
        date: string;
        count: number;
        grants: {
          grantId: number;
          client: string;
          weeks: number;
          state: string;
        }[];
      }> & { logFrom?: string })
    | null;
  /** Overhead per month: a past month's point, today's lines for the current month. */
  softwareByMonth?:
    | {
        month: string;
        usd: number | null;
        basis: "point" | "lines" | "missing" | "not_started";
        capturedAt: string | null;
        source: string;
      }[]
    | null;
  /** Growth's front-end cash by whole month: paidOnWindowDeals is UF cash %'s cash. */
  frontEndMonths?:
    | {
        month: string;
        paid: number;
        paidOnWindowDeals: number | null;
      }[]
    | null;
  /** A sentence for each round-2 read that is not live or failed. */
  readsMissing?: string[] | null;
};

/** A store read over a run of days: from/through are null when no day was read. */
export type SheetRanged<R> = {
  from: string | null;
  through: string | null;
  rows: R[];
  source?: string;
};

async function rpc(
  client: SupabaseClient | null,
  name: string,
  args: Record<string, unknown>,
) {
  if (!client) throw new Error("Sign in before changing goals");
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message || "The sheet could not be reached");
  return data;
}

function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function monthBack(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
}

export async function readGoalSheet(
  client: SupabaseClient | null,
  args: {
    month: string;
    /**
     * The report the screen already holds for this month. The quiet re-read
     * after a save passes it (2026-11-02): a typed cell never changes the
     * call centre's numbers, and reading the slow report again held every
     * save up.
     */
    callDaily?: SheetContext["callDaily"];
  },
): Promise<SheetContext> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.month))
    throw new Error("Choose a month like 2026-11");
  const data = (await rpc(client, "cockpit_ceo_goal_sheet_context", {
    p_month: args.month,
  })) as SheetContext;
  if (!data || typeof data !== "object" || data.month !== args.month)
    throw new Error("The sheet answered for the wrong month");
  if (args.callDaily !== undefined)
    return { ...data, callDaily: args.callDaily };
  // The report is slow and can time out on its own: its columns then read
  // missing, and the rest of the sheet still opens.
  let callDaily: SheetContext["callDaily"] = null;
  const from = monthBack(args.month);
  const to = [monthEnd(args.month), data.today].sort()[0];
  if (to >= from) {
    try {
      const report = parseCallCenterReport(
        await rpc(client, "cockpit_ceo_call_center_report", {
          p_from: from,
          p_to: to,
        }),
        from,
        to,
      );
      callDaily = report.daily.map(d => ({
        day: d.day,
        leads: d.leads,
        confirmedBookings: d.confirmedBookings,
        shows: d.shows,
        noShow: d.noShow,
        // Carried since 2026-11-02 so the close rate divides the report's own
        // closed by its own shows (truth/SYNTHESIS.md fix 12).
        closed: d.closed,
      }));
    } catch {
      callDaily = null;
    }
  }
  return { ...data, callDaily };
}

export async function saveSheetCells(
  client: SupabaseClient | null,
  args: {
    cells: {
      day: string;
      key: string;
      kind: "actual" | "plan";
      value: number | null;
    }[];
  },
) {
  for (const c of args.cells) {
    if (c.value !== null && !Number.isFinite(c.value))
      throw new Error("A cell holds a number or nothing");
  }
  const result = (await rpc(client, "cockpit_ceo_goal_sheet_save_cells", {
    p_cells: args.cells,
  })) as { saved: number };
  if (result?.saved !== args.cells.length)
    throw new Error("Not every cell was saved");
  return result;
}

export async function addSheetMetric(
  client: SupabaseClient | null,
  args: Record<string, unknown>,
) {
  return (await rpc(client, "cockpit_ceo_goal_sheet_add_metric", {
    p_metric: args,
  })) as { key: string };
}

export async function removeSheetMetric(
  client: SupabaseClient | null,
  args: { key: string },
) {
  return rpc(client, "cockpit_ceo_goal_sheet_remove_metric", {
    p_key: args.key,
  });
}

export async function saveLockInRow(
  client: SupabaseClient | null,
  args: {
    id: number;
    value?: string | null;
    status?: LockInRow["status"];
    answers?: Record<string, string>;
  },
) {
  return (await rpc(client, "cockpit_ceo_goal_lockin_save", {
    p_row: args,
  })) as LockInRow;
}

export async function lockMonth(
  client: SupabaseClient | null,
  args: { month: string; lock: boolean; values?: Record<string, string> },
) {
  return rpc(client, "cockpit_ceo_goal_lockin_lock", {
    p_month: args.month,
    p_lock: args.lock,
    p_values: args.values ?? {},
  });
}
