import {
  type RangeRead,
  rangeOf,
  readRange,
  SHEET_TARGET_ALIASES,
  type SheetData,
  type SheetRange,
} from "../pages/ceo/goalsSheetData";
import {
  boardLabelOf,
  COLUMN_BY_KEY,
  colourFor,
  RETIRED_SHEET_KEYS,
  rollUp,
  SHEET_SECTIONS,
  type SheetColumn,
  isLevel as sheetLevel,
} from "../pages/ceo/goalsSheetModel";
import type { Board, PlanRow, TargetRow } from "../types/ceo/goals";
import {
  GROUPS,
  METRIC_BY_KEY,
  METRICS,
  type Payloads,
  scoreboard,
  seriesBounds,
  type Unit,
} from "../types/ceo/scoreboard";
import { addDays } from "../types/ceo/time";

export type GoalContext = {
  plan: Record<string, any> | null;
  plans: Record<string, any>[];
  targets: Record<string, any>[];
  payloads: Payloads;
  scorecardsDone: number | null;
  fingerprint: string;
  today: string;
  callClients?: Board["callClients"];
  costs?: Board["costs"];
  /**
   * The plan month's Goals sheet (2026-11-02, truth/SYNTHESIS.md fix 3): every
   * key it has is read from its own roll-up, so the board and the sheet show
   * one number. Absent or null, those keys read missing with `sheetWhy`.
   */
  sheet?: SheetData | null;
  /** Why the sheet was not read, said on every row it would have answered. */
  sheetWhy?: string | null;
};
const WORKING = new Set([6, 0, 1, 2, 3, 4]);

export type GoalTargetPatch = {
  id: number;
  target?: number | null;
  stretch?: number | null;
  actualManual?: number | null;
};

/** Send only edited cells. A blank clears that cell; untouched human data stays on the server. */
export function goalTargetPatch(
  id: number,
  edits: Partial<Record<"target" | "stretch" | "actualManual", string>>,
): GoalTargetPatch {
  const patch: GoalTargetPatch = { id };
  for (const key of ["target", "stretch", "actualManual"] as const) {
    const text = edits[key];
    if (text === undefined) continue;
    if (text.trim() === "") patch[key] = null;
    else {
      const value = Number(text);
      if (!Number.isFinite(value))
        throw new Error("Goal numbers must be finite");
      patch[key] = value;
    }
  }
  return patch;
}
function workingDaysBetween(from: string, to: string): number {
  let n = 0;
  const end = Date.parse(`${to}T00:00:00Z`);
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 86400000) {
    if (WORKING.has(new Date(t).getUTCDay())) n += 1;
  }
  return n;
}

function toPlan(r: Record<string, any>): PlanRow {
  const from = String(r.period_from);
  const to = String(r.period_to);
  return {
    id: Number(r.id),
    periodKind: r.period_kind,
    periodFrom: from,
    periodTo: to,
    title: String(r.title ?? ""),
    mission: r.mission ? String(r.mission) : null,
    headline: r.headline ? String(r.headline) : null,
    status: r.status,
    workingDays:
      r.working_days == null
        ? workingDaysBetween(from, to)
        : Number(r.working_days),
  };
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * The bar always reads the same way: fuller is better. For a number we want
 * up that is the share of the target reached; for a cost or a churn rate it
 * is how far under the ceiling we are, so a bar at a third means a cost three
 * times what it should be.
 */
function progressOf(
  actual: number | null,
  target: number | null,
  direction: "up" | "down",
): number | null {
  if (target === null || actual === null || target === 0) return null;
  if (direction === "up") return Math.max(0, Math.min(1, r2(actual / target)));
  return actual <= 0 ? 1 : Math.max(0, Math.min(1, r2(target / actual)));
}

/**
 * Whether a target accumulates over the period.
 *
 * A count of leads does; a cost per lead does not, and neither does a rate, a
 * multiple, an average, a headcount or a per-day figure. Pacing one of those
 * would judge a $10 cost per lead against $7.31 three quarters of the way
 * through the month, which is not a target anybody set.
 */
function isLevel(unit: Unit, metricKey: string): boolean {
  if (unit === "rate" || unit === "x") return true;
  return METRIC_BY_KEY[metricKey]?.level === true;
}

/**
 * A number the board takes from the Goals sheet (2026-11-02, fix 3), with
 * what the sheet says about it. The value is the sheet's own, unrounded, so
 * the board writes the very figure the sheet writes (rounding 0.74627% to 4
 * decimals first read 0.8% beside the sheet's 0.7%). Pace is judged on the
 * unrounded figure by the sheet's own colourFor, so a rate is judged on
 * 35.94%, never on a 36% rounded first (2026-11-02).
 */
export type SheetRead = {
  value: number | null;
  /** Where the month ends at this rate (the sheet's paceFor); null unless the run is the sheet's month so far. */
  pace: number | null;
  /** True when it does not accumulate, as the sheet judges it (overhead and labour are the month's, not paced). */
  level: boolean;
  /** The sheet's words: its source line and what it leaves out, or why it is missing. */
  text: string;
  /** Profit and margin: the sheet paces their parts, so the paced target is worked back from the pace. */
  fromParts: boolean;
};

/** Float noise off (24377.360000000004 is 24377.36), never a display digit. */
const clean = (x: number | null) =>
  x === null ? null : Number(x.toPrecision(12));

/** Profit and margin: paceFor works them out from their parts, not from the actual. */
const PACED_FROM_PARTS: ReadonlySet<string> = new Set(["profit", "margin"]);

/**
 * Catalogue keys the sheet holds as parts of one of its columns, not as a
 * column of their own: the call centre's ladder (Lead to booking's leads and
 * bookings) and back-end cash (Total revenue's other part). Read from the
 * sheet too, so the ladder and the rate beside it are one sum.
 */
const SHEET_PARTS: Record<string, string> = {
  callLeads: "callLeadToBooking",
  callBookings: "callLeadToBooking",
  backEndCash: "totalCash",
};

/**
 * Older plan keys for a number the sheet holds under another key (2026-11-02,
 * review of fix 3). The October plan's "Client lead to booking" is the call
 * centre's lead to booking: the catalogue calls it the same number, and the
 * Goals model hands its target on (goalsModel REPLACED). Its "Software and
 * overhead" is the sheet's Overhead expenses: that column's driver is
 * `overhead`, and the sheet's plan reads that target for it. Each reads the
 * sheet's number, pace and words, so neither says "Nothing recorded" beside a
 * number the sheet shows.
 */
export const SHEET_ALIASES: Readonly<Record<string, string>> =
  SHEET_TARGET_ALIASES;

/** The key the sheet holds a target's number under. */
export function sheetKeyOf(key: string): string {
  return SHEET_ALIASES[key] ?? key;
}

/** The groups a sheet section stores its target rows under, a metric added on the sheet among them. */
const SHEET_GROUPS: ReadonlySet<string> = new Set(
  SHEET_SECTIONS.map(s => s.group),
);

/**
 * Whether the board reads this key from the sheet: a column of it, one of its
 * parts, or an older key for one of them. With the sheet not read, a target
 * row's `group` also tells a metric added on the sheet (its key in no
 * catalogue, stored under a sheet section's group, 2026-11-02): it takes the
 * reason the sheet was not read, never "Nothing recorded".
 */
export function sheetReads(
  key: string,
  sheet?: SheetData | null,
  group?: string,
): boolean {
  if (
    key in COLUMN_BY_KEY ||
    key in SHEET_PARTS ||
    key in SHEET_ALIASES ||
    sheet?.columns.some(c => c.key === key)
  )
    return true;
  return (
    !sheet &&
    group !== undefined &&
    SHEET_GROUPS.has(group) &&
    !(key in METRIC_BY_KEY) &&
    !RETIRED_SHEET_KEYS.has(key)
  );
}

/** The call centre report's parts on the sheet: none of them on any day means the report was not read. */
const REPORT_PARTS: ReadonlySet<string> = new Set([
  "callLeads",
  "callBookings",
  "callShows",
  "callShowsAndNoShows",
  "callCloses",
]);
const REPORT_UNREAD =
  "Missing on the sheet: the call centre report was not read for these days. Reload the page to try again.";

/** A part's total over the run, as the sheet adds it up. */
function partTotal(part: string, range: SheetRange): number | null {
  return rollUp(partColumn(part), range.rows, range.worked, range.facts);
}

/**
 * Why a number the sheet has no reason for is missing, in plain words: the
 * call centre report not read, or a rate over a count that is 0 on these days
 * ("Closed deals is 0 on these days, so there is nothing to divide by yet").
 */
function emptyWhy(c: SheetColumn, range: SheetRange): string | null {
  const r = c.rollup;
  if (r.kind !== "ratio" || c.custom) return null;
  const parts = [...r.over, ...r.under].filter(p => p !== "one");
  if (
    parts.length &&
    parts.every(p => REPORT_PARTS.has(p) && partTotal(p, range) === null)
  )
    return REPORT_UNREAD;
  const under = r.under.filter(p => p !== "one");
  if (!under.length) return null;
  const totals = under.map(p => partTotal(p, range));
  if (totals.some(v => v === null || v !== 0)) return null;
  const names = under.map(p => COLUMN_BY_KEY[p]);
  if (names.some(n => !n))
    return "Missing on the sheet: what it divides by is 0 on these days.";
  return `Missing on the sheet: ${names.map(n => boardLabelOf(n as SheetColumn)).join(" and ")} ${under.length > 1 ? "are" : "is"} 0 on these days, so there is nothing to divide by yet.`;
}

/** The sheet's own words beside a number: why it is missing, or where it came from and what it leaves out. */
function sheetWords(r: RangeRead, range: SheetRange): string {
  if (r.value === null) {
    if (r.waits.length) return `Missing on the sheet: ${r.waits.join(" ")}`;
    return (
      emptyWhy(r.column, range) ??
      (r.column.editable
        ? "Missing on the sheet: nothing recorded it on these days yet. Type the days on the sheet above."
        : "Missing on the sheet: what it is worked out from has no number on these days yet.")
    );
  }
  const rev = r.revenue;
  return [
    r.column.source,
    ...r.leaves,
    ...(rev?.leftOut.length
      ? [`Leaves out ${rev.leftOut.join("; ")}: not program money.`]
      : []),
    ...(rev?.notes ?? []),
  ].join(" ");
}

/** A count the sheet adds up as part of a column: the call report's leads or bookings by day, a rate's divisor. */
function partColumn(part: string): SheetColumn {
  return {
    key: part,
    label: part,
    section: "call_center",
    unit: "count",
    direction: "up",
    rollup: { kind: "sum", part },
    editable: false,
    source: METRIC_BY_KEY[part]?.source ?? "",
  };
}

/**
 * Every number the sheet has over `from`..`through`: each column through the
 * sheet's `readRange` (the one rule the grid and the phone read), and the
 * parts above from the same days. Pass `through` as the sheet's newest
 * complete day so the month's facts (MRR, overhead, UF cash %) apply.
 */
export function readSheet(
  sheet: SheetData,
  from: string,
  through: string,
): Record<string, SheetRead> {
  const out: Record<string, SheetRead> = {};
  const range = rangeOf(sheet, from, through);
  let revenue: RangeRead["revenue"] = null;
  for (const c of sheet.columns) {
    const r = readRange(sheet, c.key, from, through);
    if (!r) continue;
    if (c.key === "totalCash" && !c.custom) revenue = r.revenue;
    out[c.key] = {
      value: clean(r.value),
      // Unrounded: the verdict is colourFor on this pace, as the sheet's
      // Colour row reads it, so a pace exactly on its target is green on
      // both (12 digits made 6.818181818181818 read short of itself).
      pace: r.pace,
      level: sheetLevel(r.column),
      text: sheetWords(r, range),
      fromParts: !c.custom && PACED_FROM_PARTS.has(c.key),
    };
  }
  for (const [key, of] of Object.entries(SHEET_PARTS)) {
    const whole = out[of];
    const value =
      key === "backEndCash"
        ? (revenue?.parts.backEndCash ?? null)
        : rollUp(partColumn(key), range.rows, range.worked);
    out[key] = {
      value: clean(value),
      // A count paced like any other: its target times the share of the month gone.
      pace: null,
      level: false,
      text:
        value !== null
          ? (METRIC_BY_KEY[key]?.source ?? "")
          : key !== "backEndCash"
            ? REPORT_UNREAD
            : whole && whole.value === null
              ? whole.text
              : "Missing on the sheet: every payment in was not read on these days.",
      fromParts: false,
    };
  }
  return out;
}

// The existing goal pacing and scoring calculation, fed by the secured SQL context.
export function buildGoalsBoard(
  context: GoalContext,
  today = context.today,
): Board {
  const all = context.plans;
  const plans = all.map(r => ({
    id: Number(r.id),
    title: String(r.title ?? ""),
    periodFrom: String(r.period_from),
    periodTo: String(r.period_to),
    status: String(r.status),
  }));

  const row = context.plan;
  const p = context.payloads;
  const bounds = seriesBounds(p);
  if (!row)
    return {
      plan: null,
      plans,
      pace: null,
      groups: [],
      behind: [],
      catalogue: METRICS,
      bounds,
      measured: {},
      sheetColumns: {},
      callClients: null,
      costs: context.costs ?? null,
    };

  const plan = toPlan(row);
  // The plan month's sheet, only when the plan is that one month.
  const month = plan.periodFrom.slice(0, 7);
  const sheet =
    context.sheet &&
    context.sheet.month === month &&
    plan.periodTo.slice(0, 7) === month
      ? context.sheet
      : null;
  // Numbers run to the newest complete day, never to today, so a plan is
  // never judged on a day that is still happening: a morning's spend
  // against a whole day's target reads as a collapse every morning. With the
  // sheet read, that is the sheet's own newest complete day (2026-11-02), so
  // the board adds up the very days of the sheet's month-to-date row and the
  // month's facts (MRR, overhead, UF cash %) apply to both alike.
  const yesterday = addDays(today, -1);
  const through = (
    sheet?.through
      ? [plan.periodTo, sheet.through]
      : [plan.periodTo, yesterday, bounds.last ?? yesterday]
  )
    .filter(Boolean)
    .sort()[0] as string;
  const worked = Math.min(
    plan.workingDays,
    through >= plan.periodFrom
      ? workingDaysBetween(plan.periodFrom, through)
      : 0,
  );
  const share = plan.workingDays > 0 ? worked / plan.workingDays : 0;
  // One reader per key (fix 3): the sheet answers every key it has, and the
  // catalogue (scoreboard) only the rest, the ladder's bookable leads, AOV
  // and contracted ROAS among them.
  const reads =
    sheet && through >= plan.periodFrom
      ? readSheet(sheet, plan.periodFrom, through)
      : {};
  // The sheet paces on its own working days, Saturday to Thursday.
  const sheetShare =
    sheet && sheet.workingDays > 0
      ? Math.min(1, sheet.workedSoFar / sheet.workingDays)
      : share;
  const unread =
    through < plan.periodFrom
      ? "No day of this plan has ended yet: its first numbers come in the day after it starts."
      : (context.sheetWhy ??
        "The Goals sheet was not read, so this reads missing. Reload the page to try again.");
  const measured: Record<string, number> = {};
  for (const [key, v] of Object.entries(
    scoreboard(p, plan.periodFrom, through),
  ))
    if (!sheetReads(key, sheet)) measured[key] = v;
  for (const [key, r] of Object.entries(reads))
    if (r.value !== null) measured[key] = r.value;
  // Under an older key too, so a copied plan's "Was" and next month's
  // baseline for it are the number the board showed.
  for (const [alias, of] of Object.entries(SHEET_ALIASES)) {
    const v = reads[of]?.value ?? null;
    if (v !== null) measured[alias] = v;
  }
  // What the month's book says is still owed on signed deals (2026-11-02):
  // no column of the sheet, so it is read from the sheet's month facts for
  // Plan next month's box and the plan's own row of it.
  const onDeal = sheet?.facts.onDealDue;
  if (typeof onDeal === "number" && Number.isFinite(onDeal))
    measured.onDealDue = onDeal;
  // The one number the goals tables can answer themselves: how many
  // one-to-ones were actually held and signed off in the period.
  if (plan.periodFrom.slice(0, 7) === plan.periodTo.slice(0, 7)) {
    if (context.scorecardsDone !== null)
      measured.scorecardsDone = context.scorecardsDone;
  }

  const targetRows = context.targets;
  // The sheet's column behind each row it answers, so the screen writes the
  // number as the sheet writes it: a metric added on the sheet and an older
  // key are not in COLUMN_BY_KEY (2026-11-02).
  const sheetColumns: Record<string, SheetColumn> = {};

  const targets: TargetRow[] = targetRows.map(t => {
    const key = String(t.metric_key);
    const def = METRIC_BY_KEY[key];
    const fromSheet = sheetReads(key, sheet, String(t.group_key));
    const of = sheetKeyOf(key);
    // Looked up as readRange looks it up, so the number and its column agree.
    const column = fromSheet
      ? (sheet?.columns.find(c => c.key === of) ?? COLUMN_BY_KEY[of])
      : undefined;
    if (column) sheetColumns[key] = column;
    const unit = (t.unit ?? column?.unit ?? def?.unit ?? "count") as Unit;
    // The sheet's direction where it has the column: its Colour row judges by it.
    const direction = (column?.direction ??
      t.direction ??
      def?.direction ??
      "up") as "up" | "down";
    const target = t.target === null ? null : Number(t.target);
    const common = {
      id: Number(t.id),
      groupKey: String(t.group_key),
      metricKey: key,
      label: String(t.label ?? def?.label ?? key),
      unit,
      direction,
      target,
      stretch: t.stretch === null ? null : Number(t.stretch),
      baseline: t.baseline === null ? null : Number(t.baseline),
      note: t.note ? String(t.note) : null,
      sort: Number(t.sort ?? 0),
    };
    if (fromSheet) {
      // The sheet's number, pace and words. Nothing typed on the plan row
      // stands in for it: a day is typed on the sheet, one rule per key.
      const r = reads[of] ?? null;
      const actual = r?.value ?? null;
      const level = r
        ? r.level
        : column
          ? sheetLevel(column)
          : isLevel(unit, key);
      const pace = r?.pace ?? null;
      const s = pace !== null ? sheetShare : share;
      const plain = target === null ? null : level ? target : target * s;
      // Profit and margin pace from their parts (overhead and labour are the
      // month's, not stretched), so the mark they should be at now is worked
      // back from that pace: with a positive target, the actual is at or past
      // it exactly when the sheet says green.
      const pacedTarget =
        target !== null && r?.fromParts && actual !== null && pace !== null
          ? actual + (target - pace) * (level ? 1 : s)
          : plain;
      // The verdict is the sheet's Colour row (2026-11-02, review of fix 3):
      // on pace exactly when colourFor reads green for the sheet's pace
      // against the target, on the unrounded figures, so 35.9996% against
      // 36% is yellow on both screens, never on pace here and yellow there.
      // With no pace (a run that is not the month so far), the same rule
      // judges the number against the target's share of the days gone. A
      // part (the call centre's leads and bookings, back-end cash) is a
      // count or dollars wanted up, judged the same way.
      const colour =
        pace !== null
          ? colourFor(column ?? partColumn(of), pace, target)
          : colourFor(column ?? partColumn(of), actual, plain);
      const onPace = colour === null ? null : colour === "green";
      return {
        ...common,
        level,
        source: "measured",
        sourceText: r?.text ?? unread,
        actual,
        pacedTarget,
        onPace,
        progress: progressOf(actual, target, direction),
      };
    }
    const manualActual =
      t.actual_manual === null || t.actual_manual === undefined
        ? null
        : Number(t.actual_manual);
    const fromCockpit = measured[key];
    const actual =
      fromCockpit !== undefined
        ? r2(fromCockpit)
        : manualActual !== null
          ? r2(manualActual)
          : null;
    const source: TargetRow["source"] =
      fromCockpit !== undefined
        ? "measured"
        : manualActual !== null
          ? "typed"
          : "none";
    const level = isLevel(unit, key);
    const pacedTarget =
      target === null ? null : level ? target : r2(target * share);
    const onPace =
      actual === null || pacedTarget === null
        ? null
        : direction === "up"
          ? actual >= pacedTarget
          : actual <= pacedTarget;
    return {
      ...common,
      level,
      source,
      sourceText:
        source === "measured"
          ? (def?.source ??
            "Read from the cockpit's own numbers for these days.")
          : source === "typed"
            ? "Typed in: nothing in the cockpit measures this yet."
            : "Nothing recorded for this yet.",
      actual,
      pacedTarget,
      onPace,
      progress: progressOf(actual, target, direction),
    };
  });

  const byGroup = new Map<string, TargetRow[]>();
  for (const t of targets) {
    const list = byGroup.get(t.groupKey) ?? [];
    list.push(t);
    byGroup.set(t.groupKey, list);
  }
  const known = new Map(GROUPS.map(g => [g.key as string, g]));
  const groups = [...byGroup.entries()]
    .map(([key, list]) => ({
      key,
      label: known.get(key)?.label ?? key,
      blurb: known.get(key)?.blurb ?? "",
      targets: list,
    }))
    .sort((x, y) => {
      const order = GROUPS.map(g => g.key as string);
      const a = order.indexOf(x.key);
      const b = order.indexOf(y.key);
      return (a < 0 ? 99 : a) - (b < 0 ? 99 : b);
    });

  // The retired metrics stay off it, as they stay off the board's lists
  // (2026-11-02): what clients still owe on signed deals is no performance.
  const behind = targets
    .filter(t => t.onPace === false && !RETIRED_SHEET_KEYS.has(t.metricKey))
    .map(t => ({
      label: t.label,
      actual: t.actual,
      pacedTarget: t.pacedTarget,
      gap:
        t.pacedTarget && t.actual !== null && t.pacedTarget !== 0
          ? Math.abs(t.actual - t.pacedTarget) / Math.abs(t.pacedTarget)
          : 0,
    }))
    .sort((x, y) => y.gap - x.gap)
    .slice(0, 5)
    .map(({ label, actual, pacedTarget }) => ({
      label,
      actual,
      pacedTarget,
    }));

  return {
    plan,
    plans,
    pace: {
      workingDays: plan.workingDays,
      workedSoFar: worked,
      daysLeft: Math.max(0, plan.workingDays - worked),
      share: r2(share),
      through,
    },
    groups,
    behind,
    catalogue: METRICS,
    bounds,
    measured,
    sheetColumns,
    callClients: context.callClients ?? null,
    costs: context.costs ?? null,
  };
}
