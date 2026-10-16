/**
 * The Client Performance board's columns, and how a cell reads: the words,
 * the formats and the one summary the screen adds (the first break). Every
 * value and status is the database's (boardClient.ts); nothing here judges a
 * number against a target or turns a missing value into 0.
 */
import { count, decimal, isNum, money } from "@/components/ceo/format";
import {
  CELL_STATUSES,
  type Cell,
  type CellStatus,
  type ClientRow,
  type Target,
  type Targets,
} from "./boardClient";

export type Unit =
  | "usd"
  | "count"
  | "percent"
  | "ratio"
  | "times"
  | "score"
  | "minutes";
export type GroupKey = "client" | "ads" | "funnel" | "outcomes" | "calls";

export const GROUPS: { key: GroupKey; label: string }[] = [
  { key: "client", label: "Client" },
  { key: "ads", label: "Ads" },
  { key: "funnel", label: "Funnel" },
  { key: "outcomes", label: "Outcomes" },
  { key: "calls", label: "Calls" },
];

export type BoardColumn = {
  /** The cell's key in a row's values; also the column's id. */
  key: string;
  /** Header text, short. */
  label: string;
  /** The full name, in the help. */
  name: string;
  group: GroupKey;
  unit: Unit;
  /** The target this column is judged against (cockpit_board_default_targets). */
  metric?: string;
  /** Shown before anyone picks columns. */
  key10?: boolean;
  /** What it is and how it is worked out, in one sentence. */
  how: string;
  /** The two figures behind a rate, for the help: [numerator, denominator]. */
  parts?: [{ label: string; unit: Unit }, { label: string; unit: Unit }];
  /** A column drawn by hand: the caller's name, the retention bars. */
  special?: "caller" | "retention";
  /**
   * The cell whose status dot this column carries, when not its own: the
   * count of appointments with no outcome is judged by its share of the
   * meetings due (`metric` is that share's target).
   */
  dotFrom?: string;
};

export const COLUMNS: BoardColumn[] = [
  {
    key: "caller",
    label: "Caller",
    name: "Assigned caller",
    group: "client",
    unit: "count",
    key10: true,
    special: "caller",
    how: "The call centre agent the dialer assigns to this client.",
  },
  // Ads: Meta, to yesterday on each ad account's clock.
  {
    key: "spend",
    label: "Spend",
    name: "Ad spend",
    group: "ads",
    unit: "usd",
    key10: true,
    how: "Meta ad spend in US dollars, at the cockpit's fixed rates.",
  },
  {
    key: "impressions",
    label: "Impressions",
    name: "Impressions",
    group: "ads",
    unit: "count",
    how: "Times the ads were shown on Meta.",
  },
  {
    key: "cpm",
    label: "CPM",
    name: "Cost per 1,000 impressions",
    group: "ads",
    unit: "usd",
    metric: "cpm",
    how: "Spend / impressions × 1,000.",
    parts: [
      { label: "spend", unit: "usd" },
      { label: "impressions", unit: "count" },
    ],
  },
  {
    key: "frequency",
    label: "Frequency",
    name: "Frequency",
    group: "ads",
    unit: "ratio",
    metric: "frequency",
    how: "Impressions / people reached. Over the last 7, 14 and 30 days, this month and last month it is Meta's own; over other days it is the average daily frequency.",
    parts: [
      { label: "impressions", unit: "count" },
      { label: "people reached", unit: "count" },
    ],
  },
  {
    key: "linkCtr",
    label: "Link CTR",
    name: "Link click-through rate",
    group: "ads",
    unit: "percent",
    metric: "link_ctr",
    how: "Link clicks / impressions.",
    parts: [
      { label: "link clicks", unit: "count" },
      { label: "impressions", unit: "count" },
    ],
  },
  {
    key: "linkClicks",
    label: "Link clicks",
    name: "Link clicks",
    group: "ads",
    unit: "count",
    how: "Clicks on the ads' links.",
  },
  {
    key: "cpc",
    label: "CPC",
    name: "Cost per link click",
    group: "ads",
    unit: "usd",
    metric: "cpc",
    how: "Spend / link clicks.",
    parts: [
      { label: "spend", unit: "usd" },
      { label: "link clicks", unit: "count" },
    ],
  },
  {
    key: "optIn",
    label: "Opt-in",
    name: "Opt-in rate",
    group: "ads",
    unit: "percent",
    metric: "opt_in",
    how: "Form leads / link clicks, on lead-form campaigns.",
    parts: [
      { label: "form leads", unit: "count" },
      { label: "link clicks", unit: "count" },
    ],
  },
  {
    key: "hookRate",
    label: "Hook rate",
    name: "Hook rate",
    group: "ads",
    unit: "percent",
    metric: "hook_rate",
    how: "3-second video plays / impressions of video ads.",
    parts: [
      { label: "3-second plays", unit: "count" },
      { label: "video impressions", unit: "count" },
    ],
  },
  {
    key: "holdRate",
    label: "Hold rate",
    name: "Hold rate",
    group: "ads",
    unit: "percent",
    metric: "hold_rate",
    how: "ThruPlays / 3-second plays.",
    parts: [
      { label: "ThruPlays", unit: "count" },
      { label: "3-second plays", unit: "count" },
    ],
  },
  {
    key: "retention50",
    label: "Retention",
    name: "Video retention",
    group: "ads",
    unit: "percent",
    special: "retention",
    how: "Share of video plays watched to 25%, 50%, 75% and 100%. Sorted by the 50% mark.",
  },
  // Funnel.
  {
    key: "metaLeads",
    label: "Meta leads",
    name: "Meta form leads",
    group: "funnel",
    unit: "count",
    how: "Lead-form leads Meta counted on lead campaigns; chat and engagement results are left out.",
  },
  {
    key: "crmLeads",
    label: "CRM leads",
    name: "CRM leads",
    group: "funnel",
    unit: "count",
    key10: true,
    how: "Contacts created in GoHighLevel on these days, WhatsApp chats with no ad left out.",
  },
  {
    key: "cpl",
    label: "CPL",
    name: "Cost per lead",
    group: "funnel",
    unit: "usd",
    metric: "cpl",
    key10: true,
    how: "Lead-campaign spend / Meta form leads.",
    parts: [
      { label: "lead-campaign spend", unit: "usd" },
      { label: "form leads", unit: "count" },
    ],
  },
  {
    key: "confirmedBookings",
    label: "Bookings",
    name: "Confirmed bookings",
    group: "funnel",
    unit: "count",
    key10: true,
    how: "Main and online calendar bookings made on these days, cancelled, invalid and Google Calendar copies left out.",
  },
  {
    key: "leadToBooking",
    label: "Booking rate",
    name: "Lead to booking",
    group: "funnel",
    unit: "percent",
    metric: "lead_to_booking",
    key10: true,
    how: "Confirmed bookings / CRM leads, both by the day they were made.",
    parts: [
      { label: "confirmed bookings", unit: "count" },
      { label: "CRM leads", unit: "count" },
    ],
  },
  {
    key: "costPerBooking",
    label: "Cost per booking",
    name: "Cost per booking",
    group: "funnel",
    unit: "usd",
    metric: "cost_per_booking",
    key10: true,
    how: "Spend / confirmed bookings over the same days, to yesterday.",
    parts: [
      { label: "spend", unit: "usd" },
      { label: "confirmed bookings", unit: "count" },
    ],
  },
  {
    key: "provisionalBookings",
    label: "Provisional",
    name: "Provisional bookings",
    group: "funnel",
    unit: "count",
    how: "Bookings on the not-confirmed calendar, made on these days.",
  },
  // Outcomes: what the client fills in.
  {
    key: "shows",
    label: "Shows",
    name: "Shows",
    group: "outcomes",
    unit: "count",
    how: "Meetings due on these days marked showed (CRM, client sheet or portal). Unmarked is never a no-show.",
  },
  {
    key: "showRate",
    label: "Show rate",
    name: "Show rate",
    group: "outcomes",
    unit: "percent",
    metric: "show_rate",
    key10: true,
    how: "Shows / (shows + no-shows) of the meetings due.",
    parts: [
      { label: "shows", unit: "count" },
      { label: "marked meetings", unit: "count" },
    ],
  },
  {
    key: "quotations",
    label: "Quotations",
    name: "Quotations given",
    group: "outcomes",
    unit: "count",
    how: "Meetings with a quotation given, from the client sheet or the portal.",
  },
  {
    key: "quotationRate",
    label: "Quote rate",
    name: "Quotation rate",
    group: "outcomes",
    unit: "percent",
    metric: "quotation_rate",
    how: "Quotations / shows.",
    parts: [
      { label: "quotations", unit: "count" },
      { label: "shows", unit: "count" },
    ],
  },
  {
    key: "closes",
    label: "Closes",
    name: "Closed deals",
    group: "outcomes",
    unit: "count",
    how: "Closed deals by meeting day, from the client sheet and the portal, each counted once.",
  },
  {
    key: "closeRate",
    label: "Close rate",
    name: "Close rate",
    group: "outcomes",
    unit: "percent",
    metric: "close_rate",
    key10: true,
    how: "Closed deals / shows.",
    parts: [
      { label: "closed deals", unit: "count" },
      { label: "shows", unit: "count" },
    ],
  },
  {
    key: "aov",
    label: "AOV",
    name: "Average order value",
    group: "outcomes",
    unit: "usd",
    metric: "aov",
    how: "Revenue / closed deals that carry a value.",
    parts: [
      { label: "revenue", unit: "usd" },
      { label: "deals with a value", unit: "count" },
    ],
  },
  {
    key: "revenue",
    label: "Revenue",
    name: "Revenue",
    group: "outcomes",
    unit: "usd",
    how: "Closed deal values in US dollars at the cockpit's fixed rates.",
  },
  {
    key: "roas",
    label: "ROAS",
    name: "Return on ad spend",
    group: "outcomes",
    unit: "times",
    metric: "roas",
    key10: true,
    how: "Revenue by meeting day / spend over the same days, to yesterday.",
    parts: [
      { label: "revenue", unit: "usd" },
      { label: "spend", unit: "usd" },
    ],
  },
  {
    key: "leadQuality",
    label: "Lead quality",
    name: "Average lead quality",
    group: "outcomes",
    unit: "score",
    metric: "lead_quality",
    how: "The client portal's score from 1 to 10, averaged over rated meetings.",
    parts: [
      { label: "score total", unit: "score" },
      { label: "rated meetings", unit: "count" },
    ],
  },
  {
    key: "noOutcome",
    label: "No outcome",
    name: "Appointments with no outcome",
    group: "outcomes",
    unit: "count",
    metric: "no_outcome_share",
    key10: true,
    dotFrom: "noOutcomeShare",
    how: "Appointments due in this time frame with no outcome yet: no showed or no-show mark in the CRM, the client sheet or the portal.",
  },
  // Calls.
  {
    key: "dials",
    label: "Dials",
    name: "Dials",
    group: "calls",
    unit: "count",
    how: "The dialer's official dials: outcomes saved with a note, by the day saved.",
  },
  {
    key: "leadsTouched",
    label: "Leads contacted",
    name: "Leads contacted",
    group: "calls",
    unit: "percent",
    metric: "leads_touched",
    how: "Share of the last 30 days' callable leads the call centre has dialled, whatever the time frame.",
    parts: [
      { label: "leads contacted", unit: "count" },
      { label: "callable leads", unit: "count" },
    ],
  },
  {
    key: "leadsCalled",
    label: "Leads called",
    name: "Leads called",
    group: "calls",
    unit: "count",
    how: "Leads created on these days that have a verified dial so far.",
  },
  {
    key: "firstCall",
    label: "First call",
    name: "Time to first call",
    group: "calls",
    unit: "minutes",
    metric: "first_call",
    how: "Median time to the first call in working minutes, last 30 days.",
  },
];

export const KEY_COLUMNS = COLUMNS.filter(c => c.key10).map(c => c.key);

export function columnOf(key: string): BoardColumn | undefined {
  return COLUMNS.find(c => c.key === key);
}

// ---------------------------------------------------------------------------
// Formats. Rates arrive as percent (25.5 is 25.5%).

function trim(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

/** 0.75%, 4.5%, 25%, 69.6%: two decimals under 1%, one above, so a rate never rounds across its line. */
export function percent(v: number | null | undefined): string {
  if (!isNum(v)) return "n/a";
  const abs = Math.abs(v);
  return `${trim(abs < 1 ? v.toFixed(2) : v.toFixed(1))}%`;
}

export function formatValue(v: number | null | undefined, unit: Unit): string {
  if (!isNum(v)) return "n/a";
  switch (unit) {
    case "usd":
      return money(v);
    case "percent":
      return percent(v);
    case "ratio":
      return decimal(v, 2);
    case "times":
      return `${decimal(v, 1)}x`;
    case "score":
      return decimal(v, 1);
    case "minutes":
      return `${decimal(v, 1)} min`;
    default:
      return count(v);
  }
}

/** A target's line as words: "at or under $15", "under 2.5", "at or above 25%". */
export function lineText(
  t: Pick<Target, "direction" | "strict">,
  value: number,
  unit: Unit,
): string {
  const v = formatValue(value, unit);
  if (t.direction === "lower")
    return t.strict ? `under ${v}` : `at or under ${v}`;
  return t.strict ? `over ${v}` : `at or above ${v}`;
}

/** "Good at or under $15, watch to $22.50." */
export function targetText(t: Target, unit: Unit): string {
  if (!isNum(t.good)) return "No target.";
  const good = `Good ${lineText(t, t.good, unit)}`;
  if (!isNum(t.watch) || t.watch === t.good)
    return `${good}; ${isNum(t.watch) ? "anything else is off" : "short of it is a watch"}.`;
  return `${good}, watch to ${formatValue(t.watch, unit)}${t.neverOff ? ", never off" : ""}.`;
}

export function targetSource(t: Target): string {
  if (t.source === "client") return "This client's own target";
  if (t.source === "board") return "The board's target";
  return "The official target";
}

export const STATUS_WORDS: Record<CellStatus, string> = {
  good: "On target",
  watch: "Watch",
  off: "Off target",
  too_few: "Too few to judge",
  not_measured: "Not measured",
  not_filled_in: "Not filled in by the client",
};

export function statusOf(cell: Cell | null | undefined): CellStatus | null {
  const s = cell?.status;
  return s && (CELL_STATUSES as readonly string[]).includes(s)
    ? (s as CellStatus)
    : null;
}

/** A value known only as a floor: a cost with nothing yet to divide by, or a sum with days missing. */
export function floorOf(cell: Cell | null | undefined): number | null {
  if (!cell) return null;
  if (typeof cell.atLeast === "number" && Number.isFinite(cell.atLeast))
    return cell.atLeast;
  return null;
}

/** The number a cell sorts by: its value, else its floor; null sorts last. */
export function sortNumber(cell: Cell | null | undefined): number | null {
  if (!cell) return null;
  if (isNum(cell.v)) return cell.v;
  return floorOf(cell);
}

// ---------------------------------------------------------------------------
// The first break: the first step of the funnel that is off its target.

export const FUNNEL_ORDER: { key: string; label: string; metric: string }[] = [
  { key: "cpl", label: "cost per lead", metric: "cpl" },
  { key: "leadToBooking", label: "booking rate", metric: "lead_to_booking" },
  { key: "showRate", label: "show rate", metric: "show_rate" },
  { key: "quotationRate", label: "quote rate", metric: "quotation_rate" },
  { key: "closeRate", label: "close rate", metric: "close_rate" },
  { key: "roas", label: "ROAS", metric: "roas" },
];

export type FirstBreak =
  | { kind: "off" | "watch"; key: string; label: string; metric: string }
  | { kind: "on_target" }
  | { kind: "unknown" };

/**
 * Where this client's funnel breaks first, in funnel order: the first step
 * that is off, else the first one to watch, else on target when at least one
 * step was judged. The statuses are the database's.
 */
export function firstBreak(row: Pick<ClientRow, "values">): FirstBreak {
  for (const kind of ["off", "watch"] as const) {
    const hit = FUNNEL_ORDER.find(s => statusOf(row.values[s.key]) === kind);
    if (hit) return { kind, ...hit };
  }
  return FUNNEL_ORDER.some(s => statusOf(row.values[s.key]) === "good")
    ? { kind: "on_target" }
    : { kind: "unknown" };
}

// ---------------------------------------------------------------------------
// The portfolio line: sums of what the cells carry, with how many clients
// each figure covers. A client whose cell has no value is left out of the
// sum and counted as missing, never as 0.

export type Total = {
  key: string;
  label: string;
  unit: Unit;
  value: number | null;
  /** Clients whose figure is in it, of all clients shown. */
  covered: number;
  of: number;
  /** A floor: a sum with days missing, or a rate over spend not yet priced. */
  atLeast: boolean;
  /**
   * Clients whose rate covers only part of the days (an ad account not read
   * for a day). Missing days take the spend and the leads out together, so
   * the rate is no floor: it is said in words, never with a +.
   */
  partial: number;
};

function sumOf(rows: ClientRow[], key: string) {
  let value = 0;
  let covered = 0;
  let atLeast = false;
  for (const r of rows) {
    const c = r.values[key];
    if (!c || !isNum(c.v)) continue;
    value += c.v;
    covered += 1;
    if (c.atLeast === true || c.partial) atLeast = true;
  }
  return { value: covered ? value : null, covered, atLeast, partial: 0 };
}

/** A rate over every client: the sums of each cell's own two figures. */
function ratioOf(rows: ClientRow[], key: string, scale: number) {
  let n = 0;
  let d = 0;
  let covered = 0;
  let atLeast = false;
  let partial = 0;
  for (const r of rows) {
    const c = r.values[key];
    const s = statusOf(c);
    if (!c || !isNum(c.num) || !isNum(c.den)) continue;
    if (s === "not_measured" || s === "not_filled_in") continue;
    n += c.num;
    d += c.den;
    covered += 1;
    // A cost with no lead yet is a floor for that client, but its spend and
    // its zero are exact in the sums; only unpriced spend makes the total a
    // floor. Missing days drop both figures at once: said, not a floor.
    if (c.atLeast === true) atLeast = true;
    if (c.partial) partial += 1;
  }
  return {
    value: covered && d > 0 ? (n / d) * scale : null,
    covered,
    atLeast,
    partial,
  };
}

export function portfolio(rows: ClientRow[]): Total[] {
  const of = rows.length;
  const t = (
    key: string,
    label: string,
    unit: Unit,
    x: ReturnType<typeof sumOf>,
  ): Total => ({
    key,
    label,
    unit,
    of,
    ...x,
  });
  return [
    t("spend", "Spend", "usd", sumOf(rows, "spend")),
    t("metaLeads", "Meta leads", "count", sumOf(rows, "metaLeads")),
    t("crmLeads", "CRM leads", "count", sumOf(rows, "crmLeads")),
    t("cpl", "Cost per lead", "usd", ratioOf(rows, "cpl", 1)),
    t(
      "confirmedBookings",
      "Bookings",
      "count",
      sumOf(rows, "confirmedBookings"),
    ),
    t("showRate", "Show rate", "percent", ratioOf(rows, "showRate", 100)),
    t("closes", "Closes", "count", sumOf(rows, "closes")),
    t("revenue", "Revenue", "usd", sumOf(rows, "revenue")),
  ];
}

/** The appointments with no outcome across the clients shown. */
export function noOutcomeTotal(rows: ClientRow[]): {
  total: number;
  clients: number;
  unknown: number;
  oldestDays: number | null;
} {
  let total = 0;
  let clients = 0;
  let unknown = 0;
  let oldest: number | null = null;
  for (const r of rows) {
    if (!isNum(r.noOutcome)) {
      unknown += 1;
      continue;
    }
    total += r.noOutcome;
    if (r.noOutcome > 0) clients += 1;
    if (isNum(r.noOutcomeOldestDays))
      oldest =
        oldest === null
          ? r.noOutcomeOldestDays
          : Math.max(oldest, r.noOutcomeOldestDays);
  }
  return { total, clients, unknown, oldestDays: oldest };
}

/** The official list's order (cockpit_board_default_targets): the funnel first, then the ads, then the calls. */
export const TARGET_ORDER = [
  "cpl",
  "cost_per_booking",
  "lead_to_booking",
  "show_rate",
  "quotation_rate",
  "close_rate",
  "aov",
  "roas",
  "lead_quality",
  "no_outcome_share",
  "cpm",
  "frequency",
  "link_ctr",
  "cpc",
  "opt_in",
  "hook_rate",
  "hold_rate",
  "leads_touched",
  "first_call",
];

/** The targets in the official list's order, for the editor and the lever's metric picker. */
export function targetList(
  targets: Targets,
): { metric: string; target: Target }[] {
  const order = TARGET_ORDER;
  const extra = Object.keys(targets).filter(k => !order.includes(k));
  return [...order, ...extra]
    .filter(m => targets[m])
    .map(metric => ({ metric, target: targets[metric] }));
}

/** The board column for a target metric. */
export function columnForMetric(metric: string): BoardColumn | undefined {
  return COLUMNS.find(c => c.metric === metric);
}

/**
 * The no-outcome count in words for its help: its share of the meetings
 * due (what the dot judges) and the oldest one's age.
 */
export function noOutcomeWords(
  row: Pick<ClientRow, "values" | "noOutcome" | "noOutcomeOldestDays">,
): string | null {
  const share = row.values.noOutcomeShare;
  const words: string[] = [];
  if (share && isNum(share.v) && isNum(share.num) && isNum(share.den)) {
    const s = statusOf(share);
    words.push(
      `${count(share.num)} of ${count(share.den)} ${share.den === 1 ? "meeting" : "meetings"} due (${percent(share.v)})${s === "good" || s === "watch" || s === "off" ? `, ${STATUS_WORDS[s].toLowerCase()}` : ""}.`,
    );
  } else if (share?.note) words.push(share.note);
  if (isNum(row.noOutcomeOldestDays) && (row.noOutcome ?? 0) > 0)
    words.push(
      `The oldest is ${row.noOutcomeOldestDays === 1 ? "1 day" : `${row.noOutcomeOldestDays} days`} old.`,
    );
  return words.length ? words.join(" ") : null;
}

/** The unit a target is written in. */
export function targetUnit(t: Target): Unit {
  const u = t.unit;
  return u === "usd" ||
    u === "percent" ||
    u === "ratio" ||
    u === "times" ||
    u === "score" ||
    u === "minutes"
    ? u
    : "count";
}
