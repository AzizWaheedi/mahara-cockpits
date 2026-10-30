import { CPB_GATE, CPL_GATE } from "@/lib/kpi";
import type { Unit } from "@/types/ceo/scoreboard";
import type { DriverKey, Drivers, Projection } from "./goalsModel";
import { project, tidy } from "./goalsModel";

/**
 * The month as a spreadsheet: one tab per month, the days down the side, the
 * metrics across the top, the plan and the pace at the bottom.
 *
 * Aziz, 2026-10-30: "Maybe have that same type of spreadsheet in the Goal CEO
 * section with those objectives there. Maybe I can add some more metrics" and
 * his sheet "MaharaMedia Performance Dashboard": a tab per month, rows for the
 * last 4, 7, 14 and 30 days and the month to date above the days, and This
 * Month Actual, On Pace For, Target and Colour under them.
 *
 * Three things differ from his sheet, on purpose:
 * 1. A rate over a run of days divides the totals. His sheet averages each
 *    day's rate, which is how October's Offer % read 113% and 200%.
 * 2. A number the cockpit measures fills itself in. A typed cell wins over it
 *    and says so; an empty cell is missing, never zero.
 * 3. The plan is the Goals plan. Its targets are `cockpit_goal_targets` rows,
 *    so this sheet and the Goals board read one number.
 */

export type SectionKey =
  | "sales_marketing"
  | "client_success"
  | "sales_x_cs"
  | "finances"
  | "client_media"
  | "call_center"
  | "creative"
  | "custom";

/** The order and names of his outline. */
export const SHEET_SECTIONS: {
  key: SectionKey;
  label: string;
  group: string;
}[] = [
  { key: "sales_marketing", label: "Sales & marketing", group: "front_end" },
  { key: "client_success", label: "Client success", group: "back_end" },
  { key: "sales_x_cs", label: "Sales × client success", group: "money" },
  { key: "finances", label: "Finances", group: "money" },
  { key: "client_media", label: "Client media buying", group: "delivery" },
  { key: "call_center", label: "Call center", group: "calls" },
  { key: "creative", label: "Creative", group: "creative" },
  { key: "custom", label: "Added by you", group: "team" },
];

/** What one day holds. Every number is a part a column adds up or divides. */
export type DayParts = Record<string, number | null | undefined>;

/**
 * How a column turns a run of days into one number.
 * - `sum`: add the days up. Typed cells land here.
 * - `avg`: the mean of the days that have a number.
 * - `last`: the newest day with a number (a headcount).
 * - `perWorkingDay`: the total over the working days in the range.
 * - `ratio`: `over` / `under`, both added up over the range.
 */
export type Rollup =
  | { kind: "sum"; part: string }
  | { kind: "avg"; part: string }
  | { kind: "last"; part: string }
  | { kind: "perWorkingDay"; part: string }
  | { kind: "ratio"; over: string[]; under: string[]; scale?: number };

export type SheetColumn = {
  key: string;
  label: string;
  section: SectionKey;
  unit: Unit;
  direction: "up" | "down";
  rollup: Rollup;
  /** A day's cell can be typed. Ratios are worked out, so they cannot. */
  editable: boolean;
  /** The month's target is typed here and the model reworks what depends on it. */
  driver?: DriverKey;
  /** Plain words: where the actual comes from and what it leaves out. */
  source: string;
  /** Added by Aziz from the sheet: can be removed. */
  custom?: boolean;
};

const sum = (part: string): Rollup => ({ kind: "sum", part });
const ratio = (over: string[], under: string[], scale?: number): Rollup => ({
  kind: "ratio",
  over,
  under,
  scale,
});

function col(
  key: string,
  label: string,
  section: SectionKey,
  unit: Unit,
  direction: "up" | "down",
  rollup: Rollup,
  source: string,
  extra: { driver?: DriverKey } = {},
): SheetColumn {
  return {
    key,
    label,
    section,
    unit,
    direction,
    rollup,
    editable: rollup.kind !== "ratio",
    source,
    ...extra,
  };
}

/**
 * His outline, in his order. The keys are the Goals catalogue's where it has
 * the number, so a target here is the same row the Goals board scores.
 */
export const SHEET_COLUMNS: SheetColumn[] = [
  // Sales & marketing.
  col(
    "spendRetargeting",
    "Hammer Them ad spend",
    "sales_marketing",
    "usd",
    "up",
    sum("spendRetargeting"),
    "Retargeting spend on Mahara's own account, by Meta day. Kept apart from lead gen.",
    { driver: "spendRetargeting" },
  ),
  col(
    "spend",
    "Lead gen ad spend",
    "sales_marketing",
    "usd",
    "up",
    sum("spend"),
    "Lead-gen spend on Mahara's own account, by Meta day. Retargeting is beside it.",
    { driver: "spend" },
  ),
  col(
    "uniqueLinkClicks",
    "Unique link clicks",
    "sales_marketing",
    "count",
    "up",
    sum("uniqueLinkClicks"),
    "Link clicks on the lead-gen campaigns. Read whole months only from B2B's window, so a day is typed. Meta's link clicks, not de-duplicated people.",
  ),
  col(
    "cpc",
    "CPC",
    "sales_marketing",
    "usd",
    "down",
    ratio(["spend"], ["uniqueLinkClicks"]),
    "Lead-gen spend over link clicks.",
  ),
  col(
    "landingPageConversion",
    "Landing page conversion",
    "sales_marketing",
    "rate",
    "up",
    ratio(["leads"], ["uniqueLinkClicks"]),
    "Leads over link clicks. Only as good as the tagging: leads are the ROAS tags.",
  ),
  col(
    "leads",
    "Leads",
    "sales_marketing",
    "count",
    "up",
    sum("leads"),
    "Contacts tagged roas-qualified or roas-unqualified, by the day they were created. Not-ready and untagged contacts are left out.",
  ),
  col(
    "cpl",
    "CPL",
    "sales_marketing",
    "usd",
    "down",
    ratio(["spend"], ["leads"]),
    "Lead-gen spend over those leads.",
    { driver: "cpl" },
  ),
  col(
    "leadToBooked",
    "L2B",
    "sales_marketing",
    "rate",
    "up",
    ratio(["bookedLeads"], ["leads"]),
    "Leads that ever booked an intro or a demo, over leads. Setters tag by hand, so this likely reads high until every lead is tagged.",
    { driver: "leadToBooked" },
  ),
  col(
    "introsBooked",
    "Intro calls",
    "sales_marketing",
    "count",
    "up",
    sum("introsBooked"),
    "Intro calls booked, by the day they were booked.",
  ),
  col(
    "costPerIntroBooked",
    "Cost per intro",
    "sales_marketing",
    "usd",
    "down",
    ratio(["spend"], ["introsBooked"]),
    "Lead-gen spend over intros booked.",
  ),
  col(
    "introsShown",
    "Intros showed",
    "sales_marketing",
    "count",
    "up",
    sum("introsShown"),
    "Intro calls held, by call day. Showed, or confirmed once past.",
  ),
  col(
    "introShowRate",
    "Intro show rate",
    "sales_marketing",
    "rate",
    "up",
    ratio(["introsShown"], ["introsDue"]),
    "Intros shown over intros whose time has passed, the B2B rule.",
    { driver: "introShowRate" },
  ),
  col(
    "costPerIntroShown",
    "Cost per live intro",
    "sales_marketing",
    "usd",
    "down",
    ratio(["spend"], ["introsShown"]),
    "Lead-gen spend over intros held.",
  ),
  col(
    "demosBooked",
    "Demo calls",
    "sales_marketing",
    "count",
    "up",
    sum("demosBooked"),
    "Demo calls booked, by the day they were booked. Direct demos and rebooks included.",
  ),
  col(
    "costPerDemoBooked",
    "Cost per demo",
    "sales_marketing",
    "usd",
    "down",
    ratio(["spend"], ["demosBooked"]),
    "Lead-gen spend over demos booked.",
  ),
  col(
    "introToDemo",
    "Intro to demo %",
    "sales_marketing",
    "rate",
    "up",
    ratio(["introsAdvanced"], ["introsShown"]),
    "Held intros that went on to a demo, B2B's intro_to_demo. Read whole months only; a demo booked straight from a lead is not in it.",
    { driver: "introToDemo" },
  ),
  col(
    "directDemos",
    "Direct demos",
    "sales_marketing",
    "count",
    "up",
    sum("directDemos"),
    "Demos with no held intro before them. Not in his outline; the plan needs it, because 17 of October's 29 demo leads came this way. Typed.",
    { driver: "directDemos" },
  ),
  col(
    "demosShown",
    "Demos showed",
    "sales_marketing",
    "count",
    "up",
    sum("demosShown"),
    "Demo calls held, by call day.",
  ),
  col(
    "demoShowRate",
    "Demo show rate",
    "sales_marketing",
    "rate",
    "up",
    ratio(["demosShown"], ["demosDue"]),
    "Demos shown over demos whose time has passed.",
    { driver: "demoShowRate" },
  ),
  col(
    "costPerDemoShown",
    "Cost per live demo",
    "sales_marketing",
    "usd",
    "down",
    ratio(["spend"], ["demosShown"]),
    "Lead-gen spend over demos held.",
  ),
  col(
    "offersMade",
    "Offers made",
    "sales_marketing",
    "count",
    "up",
    sum("offersMade"),
    "Typed: only the closer knows. The sales EOD carries it on the days one is filed.",
  ),
  col(
    "offerRate",
    "Offer %",
    "sales_marketing",
    "rate",
    "up",
    ratio(["offersMade"], ["demosShown"]),
    "Offers over demos held.",
  ),
  col(
    "closes",
    "Closed deals",
    "sales_marketing",
    "count",
    "up",
    sum("closes"),
    "Closer-form submissions, by the day the form was filled. Voided deals are out.",
  ),
  col(
    "closeRate",
    "Close rate %",
    "sales_marketing",
    "rate",
    "up",
    ratio(["closes"], ["demosShown"]),
    "Signed deals over demos held. The dashboard's close rate over qualified demos reads higher.",
    { driver: "closeRate" },
  ),
  col(
    "newCash",
    "Cash collected",
    "sales_marketing",
    "usd",
    "up",
    sum("newCash"),
    "Money paid on a signed deal, on Whop, Tap, a logged transfer or by hand, on the day it arrived. Bank lines stop at the last uploaded statement.",
  ),
  col(
    "contracted",
    "Contracted rev",
    "sales_marketing",
    "usd",
    "up",
    sum("contracted"),
    "Contract value typed on the closer form.",
  ),
  col(
    "cashShare",
    "UF cash %",
    "sales_marketing",
    "rate",
    "up",
    ratio(["newCash"], ["contracted"]),
    "Cash collected over contracted. The actual includes the rest of earlier deals; the plan means this month's deals only.",
    { driver: "cashShare" },
  ),
  col(
    "aov",
    "AOV",
    "sales_marketing",
    "usd",
    "up",
    ratio(["contracted"], ["closes"]),
    "Contracted over deals.",
    { driver: "aov" },
  ),
  col(
    "roasFrontEnd",
    "FE ROAS",
    "sales_marketing",
    "x",
    "up",
    ratio(["newCash"], ["spend", "spendRetargeting"]),
    "Cash collected over all of Mahara's ad spend.",
  ),
  col(
    "roasContracted",
    "Contracted ROAS",
    "sales_marketing",
    "x",
    "up",
    ratio(["contracted"], ["spend"]),
    "Contracted over lead-gen spend.",
  ),
  col(
    "cac",
    "CAC",
    "sales_marketing",
    "usd",
    "down",
    ratio(["spend"], ["closes"]),
    "Lead-gen spend over deals. Payroll is not in it.",
  ),

  // Client success.
  col(
    "clientsAtStart",
    "Clients at start",
    "client_success",
    "count",
    "up",
    { kind: "last", part: "clientsAtStart" },
    "Active clients on the first of the month, from the churn register. What churn is measured over.",
  ),
  col(
    "clientsChurned",
    "Clients churned",
    "client_success",
    "count",
    "down",
    sum("clientsChurned"),
    "The churn register, by the day the client left. A finished term is logged apart. The Churn page counts only losses before day 90, so it can read lower.",
  ),
  col(
    "churnRate",
    "Churn rate",
    "client_success",
    "rate",
    "down",
    ratio(["clientsChurned"], ["clientsAtStart"]),
    "Clients churned over clients at the start.",
  ),
  col(
    "mrrProjected",
    "Projected MRR",
    "client_success",
    "usd",
    "up",
    { kind: "last", part: "mrrProjected" },
    "The MRR field on active cards on a Monthly plan, the Money tab's book. Split-pay second halves and renewals are not in it.",
    { driver: "mrrDue" },
  ),
  col(
    "mrrCollected",
    "MRR collection",
    "client_success",
    "usd",
    "up",
    { kind: "last", part: "mrrCollected" },
    "Cash on those same cards in the month, every rail, the Money tab's book.",
  ),
  col(
    "mrrCollectionRate",
    "Collection %",
    "client_success",
    "rate",
    "up",
    ratio(["mrrCollected"], ["mrrProjected"]),
    "Collected over projected.",
    { driver: "mrrCollectionRate" },
  ),
  col(
    "extensionsGiven",
    "Client extensions given",
    "client_success",
    "count",
    "down",
    sum("extensionsGiven"),
    "Typed. The Extension form has no real response, so the billing sheet and his word are the record.",
  ),
  col(
    "upsells",
    "Upsells",
    "client_success",
    "count",
    "up",
    sum("upsells"),
    "Typed. Nothing separates an upsell payment from a retainer yet.",
  ),
  col(
    "upsellCash",
    "Upsells cash",
    "client_success",
    "usd",
    "up",
    sum("upsellCash"),
    "Typed, for the same reason.",
    { driver: "upsellCash" },
  ),
  col(
    "refunds",
    "Refunds",
    "client_success",
    "count",
    "down",
    sum("refunds"),
    "Typed. The amount beside it is measured.",
  ),
  col(
    "refundAmount",
    "Refund amount",
    "client_success",
    "usd",
    "down",
    sum("refundAmount"),
    "Refunds on Whop and logged by hand, the Money tab's number.",
  ),
  col(
    "referrals",
    "Referrals",
    "client_success",
    "count",
    "up",
    sum("referrals"),
    "Typed.",
  ),
  col(
    "testimonials",
    "Testimonials",
    "client_success",
    "count",
    "up",
    sum("testimonials"),
    "Typed.",
  ),
  col(
    "googleReviews",
    "Reviews",
    "client_success",
    "count",
    "up",
    sum("googleReviews"),
    "Typed.",
  ),

  // Sales x client success.
  col(
    "totalCash",
    "Total new cash",
    "sales_x_cs",
    "usd",
    "up",
    sum("totalCash"),
    "Every payment in, on every rail: new deals, retainers and upsells. Type a new target here and the plan works back up the funnel.",
  ),
  col(
    "totalContracted",
    "Total contracted",
    "sales_x_cs",
    "usd",
    "up",
    ratio(["contracted", "upsellCash"], ["one"]),
    "Contracted on new deals plus upsells.",
  ),

  // Finances.
  col(
    "marketingExpenses",
    "Marketing expenses",
    "finances",
    "usd",
    "down",
    ratio(["spend", "spendRetargeting", "otherMarketing"], ["one"]),
    "Mahara's ad spend from Meta, plus other marketing if typed. A card that pays Meta is not read from the bank.",
  ),
  col(
    "labour",
    "Labour expenses",
    "finances",
    "usd",
    "down",
    { kind: "last", part: "labour" },
    "Typed. Payroll months are not filled in yet, so the plan prices it from the roster plus commission on this plan.",
    { driver: "labour" },
  ),
  col(
    "software",
    "Software expenses",
    "finances",
    "usd",
    "down",
    { kind: "last", part: "software" },
    "Typed, or the Costs page's active software lines. The bank's own total stops at the last uploaded statement.",
    { driver: "overhead" },
  ),
  col(
    "profit",
    "Total profit",
    "finances",
    "usd",
    "up",
    ratio(["totalCash"], ["one"]),
    "Total new cash less the three expense lines. Fees and refunds are not in it.",
  ),
  col(
    "margin",
    "Margin %",
    "finances",
    "rate",
    "up",
    ratio(["profitParts"], ["totalCash"]),
    "Profit over total new cash.",
  ),

  // Client media buying.
  col(
    "clientCpm",
    "CPM",
    "client_media",
    "usd",
    "down",
    ratio(["clientSyncSpend"], ["clientImpressions"], 1000),
    "Client campaigns in the media buyer's sync. Ads the sync does not hold are not in it.",
  ),
  col(
    "clientLinkCtr",
    "Link CTR",
    "client_media",
    "rate",
    "up",
    ratio(["clientLinkClicks"], ["clientImpressions"]),
    "Link clicks over impressions, same campaigns.",
  ),
  col(
    "clientOptIn",
    "Opt in %",
    "client_media",
    "rate",
    "up",
    ratio(["clientSyncLeads"], ["clientLinkClicks"]),
    "Leads over link clicks, same campaigns.",
  ),
  col(
    "clientCpl",
    "CPL",
    "client_media",
    "usd",
    "down",
    ratio(["clientSpend"], ["clientLeads"]),
    "Spend on client ad accounts over their leads, CEO Delivery's number.",
    { driver: "clientCpl" },
  ),
  col(
    "clientCpb",
    "CPB",
    "client_media",
    "usd",
    "down",
    ratio(["clientSpendMeasured"], ["clientConfirmed"]),
    "Cost per confirmed booking, CEO Delivery's rule. Done With You clients and days the board does not store are out.",
  ),

  // Call center.
  col(
    "callLeadToBooking",
    "Lead to booking",
    "call_center",
    "rate",
    "up",
    ratio(["callBookings"], ["callLeads"]),
    "Confirmed bookings over new client leads in the shared call centre report. Provisional bookings are out.",
    { driver: "callLeadToBooking" },
  ),
  col(
    "callShowRate",
    "Show rate %",
    "call_center",
    "rate",
    "up",
    ratio(["callShows"], ["callShowsAndNoShows"]),
    "Showed over showed plus no-show on marked appointments. An appointment nobody marked is in neither.",
  ),
  col(
    "callLeadQuality",
    "Avg lead quality",
    "call_center",
    "pts",
    "up",
    ratio(["leadQualitySum"], ["leadQualityCount"]),
    "The client's score from 1 to 10 in the portal, averaged over rated meetings. Few are rated.",
  ),
  col(
    "callCloseRate",
    "Close rate %",
    "call_center",
    "rate",
    "up",
    ratio(["clientCloses"], ["callShows"]),
    "Deals the client marked won over shown appointments. Reads low until clients report.",
  ),

  // Creative.
  col(
    "scriptsPerDay",
    "Scripts per day",
    "creative",
    "count",
    "up",
    { kind: "perWorkingDay", part: "scripts" },
    "Scripts typed per day, from the creative director's EOD. A day with no EOD filed is missing, so the month's rate is a floor.",
  ),
  col(
    "newAngles",
    "New angles tested",
    "creative",
    "count",
    "up",
    sum("newAngles"),
    "Typed. New concepts launched, not new cuts of an old one.",
  ),
  col(
    "videosPerDay",
    "Videos per day",
    "creative",
    "count",
    "up",
    { kind: "perWorkingDay", part: "videos" },
    "Videos finished per day, typed from the editors' EODs. A day with no EOD filed is missing.",
  ),
  col(
    "revisionsPerVideo",
    "Revision per video",
    "creative",
    "x",
    "down",
    { kind: "avg", part: "revisionsPerVideo" },
    "Typed. Frame.io versions are not being recorded yet, so nothing measures it.",
  ),
];

export const COLUMN_BY_KEY: Record<string, SheetColumn> = Object.fromEntries(
  SHEET_COLUMNS.map(c => [c.key, c]),
);

/** A metric Aziz added from the sheet, as the database holds it. */
export type CustomMetric = {
  key: string;
  label: string;
  section: SectionKey;
  unit: Unit;
  direction: "up" | "down";
  rollup: "sum" | "avg" | "last";
  note: string | null;
};

export function customColumn(m: CustomMetric): SheetColumn {
  return {
    key: m.key,
    label: m.label,
    section: m.section,
    unit: m.unit,
    direction: m.direction,
    rollup: { kind: m.rollup, part: m.key },
    editable: true,
    source: m.note || "Added by you. Typed.",
    custom: true,
  };
}

/** All columns for a tab: his outline, with anything added at the end of its section. */
export function allColumns(custom: CustomMetric[]): SheetColumn[] {
  const extra = custom.map(customColumn);
  return SHEET_SECTIONS.flatMap(s => [
    ...SHEET_COLUMNS.filter(c => c.section === s.key),
    ...extra.filter(c => c.section === s.key),
  ]);
}

const ok = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Saturday to Thursday, the cockpit's working week. */
const WORKING = new Set([6, 0, 1, 2, 3, 4]);

export function isWorkingDay(day: string): boolean {
  return WORKING.has(new Date(`${day}T00:00:00Z`).getUTCDay());
}

export function daysOfMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from(
    { length: n },
    (_, i) =>
      `${month}-${String(i + 1)
        .toString()
        .padStart(2, "0")}`,
  );
}

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000)
    .toISOString()
    .slice(0, 10);
}

export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + by, 1)).toISOString().slice(0, 7);
}

/** Totals a run of days. A part nobody recorded stays absent, never zero. */
function addUp(rows: DayParts[], part: string): number | null {
  let total: number | null = null;
  for (const r of rows) {
    const v = r[part];
    if (ok(v)) total = (total ?? 0) + v;
  }
  return total;
}

/**
 * Parts worked out from other parts, added to one day (or to one month's
 * totals) so a ratio never has to know them.
 */
export function withComputed(p: DayParts): DayParts {
  const out: DayParts = { ...p, one: 1 };
  const shows = p.callShows;
  const noShows = p.callNoShows;
  if (ok(shows) || ok(noShows))
    out.callShowsAndNoShows = (shows ?? 0) + (noShows ?? 0);
  return out;
}

/**
 * One column over a run of days, or null when nothing recorded it. `facts`
 * are month-level numbers that do not divide by day (B2B's window, the book):
 * they win for the whole month and are not used on a shorter range.
 */
export function rollUp(
  column: SheetColumn,
  rows: DayParts[],
  workingDays: number,
  facts?: DayParts,
): number | null {
  const total = (part: string): number | null => {
    const fact = facts?.[part];
    return ok(fact) ? fact : addUp(rows, part);
  };
  const r = column.rollup;
  switch (r.kind) {
    case "sum":
      return total(r.part);
    case "avg": {
      const values = rows.map(x => x[r.part]).filter(ok);
      return values.length
        ? values.reduce((a, b) => a + b, 0) / values.length
        : null;
    }
    case "last": {
      const fact = facts?.[r.part];
      if (ok(fact)) return fact;
      for (let i = rows.length - 1; i >= 0; i--) {
        const v = rows[i][r.part];
        if (ok(v)) return v;
      }
      return null;
    }
    case "perWorkingDay": {
      const t = total(r.part);
      return t !== null && workingDays > 0 ? t / workingDays : null;
    }
    case "ratio": {
      if (column.key === "totalContracted")
        return plusParts(total("contracted"), total("upsellCash"));
      if (column.key === "marketingExpenses")
        return plusParts(
          total("spend"),
          total("spendRetargeting"),
          total("otherMarketing"),
        );
      if (column.key === "profit") return profitOf(total);
      if (column.key === "margin") {
        const profit = profitOf(total);
        const cash = total("totalCash");
        return profit !== null && ok(cash) && cash > 0 ? profit / cash : null;
      }
      const over = plusParts(...r.over.map(total));
      const under = plusParts(...r.under.map(total));
      return over !== null && under !== null && under > 0
        ? (over / under) * (r.scale ?? 1)
        : null;
    }
  }
}

function plusParts(...xs: (number | null)[]): number | null {
  return xs.some(ok)
    ? xs.reduce<number>((n, x) => n + (ok(x) ? x : 0), 0)
    : null;
}

function profitOf(total: (part: string) => number | null): number | null {
  const cash = total("totalCash");
  const labour = total("labour");
  const software = total("software");
  // Payroll or software with no number is a missing profit, not a bigger one.
  if (!ok(cash) || !ok(labour) || !ok(software)) return null;
  const ads = plusParts(
    total("spend"),
    total("spendRetargeting"),
    total("otherMarketing"),
  );
  return ads === null ? null : cash - ads - labour - software;
}

/** A cell typed over what was measured wins for that day. */
export function dayRow(
  measured: DayParts | undefined,
  typed: Record<string, number> | undefined,
): DayParts {
  return withComputed({ ...(measured ?? {}), ...(typed ?? {}) });
}

/** Whether a metric only means something whole: a rate, a cost, a per-day figure. */
export function isLevel(c: SheetColumn): boolean {
  const r = c.rollup;
  if (r.kind === "avg" || r.kind === "last" || r.kind === "perWorkingDay")
    return true;
  if (r.kind !== "ratio") return false;
  return !["totalContracted", "marketingExpenses", "profit"].includes(c.key);
}

/**
 * Where the month ends if it carries on like this. A level number is what it
 * is; a count is its total over the working days so far, times the month's.
 */
export function onPaceFor(
  c: SheetColumn,
  actual: number | null,
  workedSoFar: number,
  workingDays: number,
): number | null {
  if (actual === null) return null;
  if (isLevel(c)) return actual;
  if (workedSoFar <= 0) return null;
  return (actual / workedSoFar) * workingDays;
}

export type Colour = "green" | "yellow" | "red";

/** His Colour row: on the line or better, within a tenth, or further off. */
export function colourFor(
  c: SheetColumn,
  pace: number | null,
  target: number | null,
): Colour | null {
  if (!ok(pace) || !ok(target)) return null;
  if (target === 0)
    return c.direction === "down" ? (pace <= 0 ? "green" : "red") : "green";
  const ratioToTarget = c.direction === "up" ? pace / target : target / pace;
  if (!Number.isFinite(ratioToTarget)) return "green";
  return ratioToTarget >= 1 ? "green" : ratioToTarget >= 0.9 ? "yellow" : "red";
}

/** What a day of plan is worth when no one has typed one: an even share of working days. */
export function evenDailyPlan(
  c: SheetColumn,
  target: number | null,
  day: string,
  workingDays: number,
): number | null {
  if (!ok(target) || !isWorkingDay(day) || workingDays <= 0) return null;
  if (c.rollup.kind === "sum") return target / workingDays;
  if (c.rollup.kind === "perWorkingDay") return target;
  return null;
}

// --- The plan: from the money wanted back up the funnel. ------------------

export type PlanInputs = Drivers & {
  /** Everything the plan has to collect: type it and the spend is worked out. */
  goalCash: number | null;
  /** Share of lead-gen spend that goes on retargeting. */
  hammerShare: number | null;
  /** Lead-gen spend for one link click. */
  cpc: number | null;
  offerRate: number | null;
};

/**
 * The lead-gen spend that collects `goalCash`, walking the same chain as
 * `project` backwards: cash over the deal, deals over the rates, intros over
 * lead to booking, leads at the cost per lead. Null when a rung is empty.
 */
export function solveSpend(i: PlanInputs): number | null {
  const need =
    ok(i.goalCash) && ok(i.mrrDue) && ok(i.mrrCollectionRate)
      ? i.goalCash - i.mrrDue * i.mrrCollectionRate - (i.upsellCash ?? 0)
      : null;
  const perDeal = ok(i.aov) && ok(i.cashShare) ? i.aov * i.cashShare : null;
  if (need === null || !perDeal) return null;
  const closes = need / perDeal;
  if (!ok(i.closeRate) || !ok(i.demoShowRate) || !i.closeRate) return null;
  if (!i.demoShowRate) return null;
  const demos = closes / i.closeRate / i.demoShowRate;
  const fromIntros = demos - (i.directDemos ?? 0);
  if (
    !ok(i.introToDemo) ||
    !ok(i.introShowRate) ||
    !ok(i.leadToBooked) ||
    !ok(i.cpl) ||
    !i.introToDemo ||
    !i.introShowRate ||
    !i.leadToBooked
  )
    return null;
  const leads =
    Math.max(0, fromIntros) / i.introToDemo / i.introShowRate / i.leadToBooked;
  return leads * i.cpl;
}

/** The plan's numbers by sheet column, worked out from its inputs. */
export function planNumbers(i: PlanInputs): {
  drivers: Drivers;
  p: Projection;
  byColumn: Record<string, number | null>;
} {
  const spend = solveSpend(i) ?? i.spend;
  const hammer =
    ok(spend) && ok(i.hammerShare) ? spend * i.hammerShare : i.spendRetargeting;
  const drivers: Drivers = { ...i, spend, spendRetargeting: hammer };
  const p = project(drivers);
  const clicks = ok(spend) && ok(i.cpc) && i.cpc > 0 ? spend / i.cpc : null;
  const offers =
    ok(p.demosShown) && ok(i.offerRate) ? p.demosShown * i.offerRate : null;
  const marketing =
    ok(spend) || ok(hammer)
      ? (spend ?? 0) + (hammer ?? 0) + (i.otherMarketing ?? 0)
      : null;
  const totalContracted = ok(p.contracted)
    ? p.contracted + (i.upsellCash ?? 0)
    : null;
  const costs =
    marketing !== null || ok(i.labour) || ok(i.overhead)
      ? (marketing ?? 0) + (i.labour ?? 0) + (i.overhead ?? 0)
      : null;
  const profit = ok(p.totalCash) && costs !== null ? p.totalCash - costs : null;
  const byColumn: Record<string, number | null> = {
    spendRetargeting: hammer,
    spend,
    uniqueLinkClicks: clicks,
    cpc: i.cpc,
    landingPageConversion:
      ok(p.leads) && ok(clicks) && clicks > 0 ? p.leads / clicks : null,
    leads: p.leads,
    cpl: i.cpl,
    leadToBooked: i.leadToBooked,
    introsBooked: p.introsBooked,
    costPerIntroBooked: p.costPerIntroBooked,
    introsShown: p.introsShown,
    introShowRate: i.introShowRate,
    costPerIntroShown: p.costPerIntroShown,
    demosBooked: p.demosBooked,
    costPerDemoBooked: p.costPerDemoBooked,
    introToDemo: i.introToDemo,
    directDemos: i.directDemos,
    demosShown: p.demosShown,
    demoShowRate: i.demoShowRate,
    costPerDemoShown: p.costPerDemoShown,
    offersMade: offers,
    offerRate: i.offerRate,
    closes: p.closes,
    closeRate: i.closeRate,
    newCash: p.newCash,
    contracted: p.contracted,
    cashShare: i.cashShare,
    aov: i.aov,
    roasFrontEnd: ok(p.newCash) && marketing ? p.newCash / marketing : null,
    roasContracted: p.roasContracted,
    cac: p.cac,
    mrrProjected: i.mrrDue,
    mrrCollected: p.backEndCash,
    mrrCollectionRate: i.mrrCollectionRate,
    upsellCash: i.upsellCash,
    totalCash: p.totalCash,
    totalContracted,
    marketingExpenses: marketing,
    labour: i.labour,
    software: i.overhead,
    profit,
    margin:
      ok(profit) && ok(p.totalCash) && p.totalCash > 0
        ? profit / p.totalCash
        : null,
    clientCpl: i.clientCpl,
    clientCpb: p.clientCpb,
    callLeadToBooking: i.callLeadToBooking,
  };
  return { drivers, p, byColumn };
}

/** The first guess at the gates, from the one place they are declared. */
export const GATES = { cpl: CPL_GATE, cpb: CPB_GATE };

/** Column to Goals-catalogue metric: the Goals board scores these by their own key. */
export function planRowsFor(
  byColumn: Record<string, number | null>,
  notes: Record<string, string>,
): {
  key: string;
  unit: Unit;
  value: number;
  note: string | null;
}[] {
  const rows: {
    key: string;
    unit: Unit;
    value: number;
    note: string | null;
  }[] = [];
  for (const c of SHEET_COLUMNS) {
    const v = byColumn[c.key];
    if (!ok(v)) continue;
    rows.push({
      key: c.key,
      unit: c.unit,
      value: tidy(v, c.unit),
      note: notes[c.key] ?? null,
    });
  }
  return rows;
}
