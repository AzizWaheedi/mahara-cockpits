import type { SheetContext } from "@/lib/ceoGoalSheetClient";
import type { DriverKey } from "./goalsModel";
import { modelTargets, tidy } from "./goalsModel";
import {
  allColumns,
  type CustomMetric,
  type DayParts,
  dayRow,
  daysOfMonth,
  isWorkingDay,
  type PlanInputs,
  planNumbers,
  type SectionKey,
  SHEET_COLUMNS,
  SHEET_SECTIONS,
  type SheetColumn,
  shiftMonth,
} from "./goalsSheetModel";

/**
 * From the server's answer to what one tab of the sheet draws: the measured
 * parts of each day, the typed cells, and the month-level numbers that do not
 * divide by day. Pure, so the rows can be tested against real numbers.
 */

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

export type SheetData = {
  month: string;
  days: string[];
  columns: SheetColumn[];
  measured: Record<string, DayParts>;
  typed: Record<string, Record<string, number>>;
  plan: Record<string, Record<string, number>>;
  facts: DayParts;
  prevFacts: DayParts;
  through: string | null;
  workingDays: number;
  workedSoFar: number;
};

function factsFor(ctx: SheetContext, month: string): DayParts {
  const from = `${month}-01`;
  const w = ctx.windows.find(x => x.from === from && x.raw)?.raw;
  const facts: DayParts = {};
  if (w) {
    facts.uniqueLinkClicks = num(w.link_clicks);
    facts.introsAdvanced = num(w.intros_advanced);
  }
  const book = ctx.book;
  if (book?.month === month) {
    facts.mrrProjected = num(book.projectedMrr);
    facts.mrrCollected = num(book.collected);
  } else {
    const h = book?.history?.find(x => x.month === month);
    if (h) {
      facts.mrrProjected = num(h.projected);
      facts.mrrCollected = num(h.collected);
    }
  }
  const churnRow = ctx.churnMonths.find(m => m.month === month);
  if (churnRow) {
    facts.clientsAtStart = num(churnRow.activeAtStart);
    // A month from before the register holds only a count.
    facts.clientsChurned =
      ctx.churned.filter(d => String(d.leftOn).startsWith(month)).length +
      (num(churnRow.lostBefore) ?? 0);
  }
  const refunds = ctx.refundsMonthly.find(m => m.month === month);
  if (refunds) facts.refundAmount = num(refunds.refunds);
  // The Costs page's active lines: what software runs at, not what was charged.
  facts.software = num(ctx.softwareMonthly);
  return facts;
}

export function buildSheet(ctx: SheetContext): SheetData {
  const month = ctx.month;
  const days = daysOfMonth(month);
  const measured: Record<string, DayParts> = {};
  const at = (day: string) => (measured[day] ??= {});

  for (const d of ctx.growthDaily) {
    const p = at(String(d.date));
    for (const k of [
      "spend",
      "spendRetargeting",
      "leads",
      "bookedLeads",
      "introsBooked",
      "introsShown",
      "introsDue",
      "demosBooked",
      "demosShown",
      "demosDue",
      "closes",
      "contracted",
    ])
      p[k] = num(d[k]);
    p.newCash = num(d.frontEndPaid);
  }
  for (const d of ctx.cashDaily) at(String(d.date)).totalCash = num(d.usd);
  for (const d of ctx.deliveryDaily) {
    const p = at(String(d.date));
    p.clientSpend = num(d.spend);
    p.clientLeads = num(d.leads);
    p.clientSpendMeasured = num(d.spendMeasured);
    p.clientConfirmed = num(d.confirmed);
  }
  for (const d of ctx.mediaDaily) {
    const p = at(String(d.date));
    p.clientSyncSpend = num(d.spend);
    p.clientImpressions = num(d.impressions);
    p.clientLinkClicks = num(d.clicks);
    p.clientSyncLeads = num(d.leads);
  }
  for (const d of ctx.clientDaily) {
    const p = at(String(d.date));
    p.clientCloses = num(d.closes);
    p.leadQualitySum = num(d.qualitySum);
    p.leadQualityCount = num(d.qualityCount);
  }
  for (const d of ctx.callDaily ?? []) {
    const p = at(d.day);
    p.callLeads = d.leads;
    p.callBookings = d.confirmedBookings;
    p.callShows = d.shows;
    p.callNoShows = d.noShow;
  }
  for (const d of ctx.churned) {
    const p = at(String(d.leftOn));
    p.clientsChurned = (p.clientsChurned ?? 0) + 1;
  }

  const typed: Record<string, Record<string, number>> = {};
  const plan: Record<string, Record<string, number>> = {};
  for (const c of ctx.cells) {
    const into = c.kind === "plan" ? plan : typed;
    const day = String(c.day);
    into[day] ??= {};
    into[day][c.key] = Number(c.value);
  }

  const custom: CustomMetric[] = ctx.metrics.map(m => ({
    key: String(m.key),
    label: String(m.label),
    section: m.section as SectionKey,
    unit: m.unit,
    direction: m.direction,
    rollup: m.rollup,
    note: m.note ?? null,
  }));

  // Numbers run to the newest complete day, as on the Goals board.
  const yesterday = new Date(Date.parse(`${ctx.today}T00:00:00Z`) - 86400000)
    .toISOString()
    .slice(0, 10);
  const last = days[days.length - 1];
  const through =
    yesterday < days[0] ? null : yesterday < last ? yesterday : last;
  const workingDays = days.filter(isWorkingDay).length;
  const workedSoFar = through
    ? days.filter(d => d <= through && isWorkingDay(d)).length
    : 0;

  return {
    month,
    days,
    columns: allColumns(custom),
    measured,
    typed,
    plan,
    facts: factsFor(ctx, month),
    prevFacts: factsFor(ctx, shiftMonth(month, -1)),
    through,
    workingDays,
    workedSoFar,
  };
}

/** One day as a column reads it: what was measured, with anything typed over it. */
export function rowsOf(
  sheet: SheetData,
  days: string[],
  kind: "actual" | "plan" = "actual",
): DayParts[] {
  return days.map(d =>
    kind === "plan"
      ? dayRow(undefined, sheet.plan[d])
      : dayRow(sheet.measured[d], sheet.typed[d]),
  );
}

/** The cell a typed day is stored under: a per-day column stores the day's count. */
export function cellKey(c: SheetColumn): string {
  const r = c.rollup;
  return r.kind === "ratio" ? c.key : r.part;
}

// --- Targets ---------------------------------------------------------------

export type TargetMap = Record<
  string,
  { value: number; note: string | null; id: number }
>;

export function targetsOf(ctx: SheetContext): TargetMap {
  const out: TargetMap = {};
  for (const t of ctx.targets) {
    const v = num(t.target);
    if (v === null) continue;
    out[String(t.metric_key)] = {
      value: v,
      note: t.note ? String(t.note) : null,
      id: Number(t.id),
    };
  }
  return out;
}

/** The plan's inputs, read back from its targets. */
export function inputsFromTargets(t: TargetMap): PlanInputs {
  const v = (k: string) => t[k]?.value ?? null;
  const spend = v("spend");
  const hammer = v("spendRetargeting");
  return {
    spend,
    cpl: v("cpl"),
    qualifiedShare: null,
    leadToBooked: v("leadToBooked"),
    introShowRate: v("introShowRate"),
    introToDemo: v("introToDemo"),
    directDemos: v("directDemos"),
    demoShowRate: v("demoShowRate"),
    qualifiedDemoShare: null,
    closeRate: v("closeRate"),
    aov: v("aov"),
    cashShare: v("cashShare"),
    spendRetargeting: hammer,
    mrrDue: v("mrrProjected"),
    mrrCollectionRate: v("mrrCollectionRate"),
    upsellCash: v("upsellCash"),
    labour: v("labour"),
    overhead: v("software") ?? v("overhead"),
    otherMarketing: null,
    feeRate: null,
    callLeads: v("callLeads"),
    callLeadToBooking: v("callLeadToBooking"),
    clientCpl: v("clientCpl"),
    goalCash: v("totalCash"),
    hammerShare: spend && hammer !== null ? hammer / spend : null,
    cpc: v("cpc"),
    offerRate: v("offerRate"),
  };
}

/** Which plan input a column's target sets, for the ones outside the Goals model. */
const SHEET_INPUTS: Record<string, keyof PlanInputs> = {
  totalCash: "goalCash",
  cpc: "cpc",
  offerRate: "offerRate",
  directDemos: "directDemos",
};

/** A target that sets something and is not worked out from anything else. */
export function isPlanInput(c: SheetColumn): boolean {
  return Boolean(c.driver || SHEET_INPUTS[c.key]);
}

/** Worked out by the plan: its target cannot be typed. */
export function isWorkedOut(c: SheetColumn, inputs: PlanInputs): boolean {
  if (isPlanInput(c)) return false;
  return planNumbers(inputs).byColumn[c.key] !== undefined;
}

/** The column's input key on the plan, when typing its target changes the chain. */
export function inputKeyOf(c: SheetColumn): keyof PlanInputs | null {
  return (c.driver as DriverKey | undefined) ?? SHEET_INPUTS[c.key] ?? null;
}

const SECTION_GROUP = Object.fromEntries(
  SHEET_SECTIONS.map(s => [s.key, s.group]),
);

/**
 * Every target row a plan's inputs imply, ready for saveTargets. Each worked-out
 * row carries the sentence the Goals model writes, so the board and the formula
 * bar explain a number the same way.
 */
export function targetRows(
  inputs: PlanInputs,
  keptNotes: Record<string, string | null>,
  say: {
    money: (v: number) => string;
    count: (v: number) => string;
    pct: (v: number) => string;
  },
) {
  const { drivers, p, byColumn } = planNumbers(inputs);
  const how = Object.fromEntries(
    modelTargets(drivers, p, say).map(t => [t.key, t.how]),
  );
  const rows: Record<string, unknown>[] = [];
  SHEET_COLUMNS.forEach((c, sort) => {
    const value = byColumn[c.key];
    if (value === null || value === undefined || !Number.isFinite(value))
      return;
    rows.push({
      groupKey: SECTION_GROUP[c.section],
      metricKey: c.key,
      label: c.label,
      unit: c.unit,
      direction: c.direction,
      target: tidy(value, c.unit),
      note: keptNotes[c.key] ?? how[c.key] ?? null,
      sort: 1000 + sort,
    });
  });
  return rows;
}
