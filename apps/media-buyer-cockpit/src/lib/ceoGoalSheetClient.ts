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
  windows: { from: string | null; raw: Record<string, any> | null }[];
  cashDaily: { date: string; usd: number }[];
  book: {
    month: string;
    projectedMrr: number;
    collected: number;
    history?: { month: string; projected: number; collected: number }[];
  } | null;
  refundsMonthly: { month: string; refunds: number }[];
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
      }[]
    | null;
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
  args: { month: string },
): Promise<SheetContext> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.month))
    throw new Error("Choose a month like 2026-11");
  const data = (await rpc(client, "cockpit_ceo_goal_sheet_context", {
    p_month: args.month,
  })) as SheetContext;
  if (!data || typeof data !== "object" || data.month !== args.month)
    throw new Error("The sheet answered for the wrong month");
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
