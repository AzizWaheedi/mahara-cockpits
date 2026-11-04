import { money } from "@/components/ceo/format";
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
 * Aziz, 2026-11-02: "Remove all the other metrics that aren't in the example
 * spreadsheet I gave ... Total revenue the same way the spreadsheet is." So
 * the sections are his NOV 2026 tab's (lead gen, intro calls, demo calls,
 * collections, customer success, business totals), customer success keeps
 * extensions, referrals, testimonials and reviews, client media buying and
 * call center stay as the cockpit had them, and creative is one typed count.
 * A key is kept wherever the metric already existed, so stored targets and
 * typed days carry over.
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
  | "lead_gen"
  | "intro_calls"
  | "demo_calls"
  | "collections"
  | "customer_success"
  | "business_totals"
  | "client_media"
  | "call_center"
  | "creative"
  | "custom";

/**
 * The order and names of his sheet. `group` is the target group a metric's
 * plan row is stored under: saveTargets upserts on (plan, group, metric), so a
 * metric that moves section keeps its group and never makes a second row.
 */
export const SHEET_SECTIONS: {
  key: SectionKey;
  label: string;
  group: string;
}[] = [
  { key: "lead_gen", label: "Ad spend / lead gen", group: "front_end" },
  { key: "intro_calls", label: "Intro calls", group: "front_end" },
  { key: "demo_calls", label: "Demo calls", group: "front_end" },
  { key: "collections", label: "Collections", group: "back_end" },
  { key: "customer_success", label: "Customer success", group: "back_end" },
  { key: "business_totals", label: "Business totals", group: "money" },
  { key: "client_media", label: "Client media buying", group: "delivery" },
  { key: "call_center", label: "Call center", group: "calls" },
  { key: "creative", label: "Creative", group: "creative" },
  { key: "custom", label: "Added by you", group: "team" },
];

/**
 * The section keys before 2026-11-02, which cockpit_goal_sheet_metrics may
 * still hold (its CHECK allows only these until it is widened). A metric added
 * under one lands at the end of where that section now ends.
 */
const LEGACY_SECTIONS: Record<string, SectionKey> = {
  sales_marketing: "demo_calls",
  client_success: "customer_success",
  sales_x_cs: "business_totals",
  finances: "business_totals",
};

/** A stored section, old or new, as a section of today's sheet. */
export function sectionOf(raw: unknown): SectionKey {
  const key = String(raw);
  if (SHEET_SECTIONS.some(s => s.key === key)) return key as SectionKey;
  return LEGACY_SECTIONS[key] ?? "custom";
}

/**
 * The section key a metric added now is saved under (2026-11-02). The CHECK
 * on cockpit_goal_sheet_metrics.section still allows only the keys from
 * before, so a new key would be refused with a raw constraint error: each
 * section is saved as the old one it falls in and read back by `sectionOf`.
 * Once a migration widens the CHECK this can return the key itself.
 */
const STORED_SECTION: Record<SectionKey, string> = {
  lead_gen: "sales_marketing",
  intro_calls: "sales_marketing",
  demo_calls: "sales_marketing",
  collections: "client_success",
  customer_success: "client_success",
  business_totals: "finances",
  client_media: "client_media",
  call_center: "call_center",
  creative: "creative",
  custom: "custom",
};

export function storedSection(key: SectionKey): string {
  return STORED_SECTION[key];
}

/**
 * The sections the Add a metric form can offer today: those a metric comes
 * back under. One added under Ad spend / lead gen or Intro calls would be
 * saved as Sales & marketing and come back under Demo calls, so those two
 * wait for the CHECK to be widened.
 */
export const ADDABLE_SECTIONS = SHEET_SECTIONS.filter(
  s => sectionOf(storedSection(s.key)) === s.key,
);

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
  /**
   * The name the plan's target row is stored under, where `label` only reads
   * right under its section's header: the Goals board, Edit this plan and
   * Plan next month list the rows with no section, and "Showed calls" or
   * "Show rate %" twice there cannot be told apart (2026-11-02).
   */
  boardLabel?: string;
  section: SectionKey;
  unit: Unit;
  direction: "up" | "down";
  rollup: Rollup;
  /** A day's cell can be typed. Ratios are worked out, so they cannot. */
  editable: boolean;
  /** The month's target is typed here and the model reworks what depends on it. */
  driver?: DriverKey;
  /**
   * A mirror: this column's target, plan and typed cells are another column's
   * (2026-11-02). Its target is read-only here and no target row is written
   * under its own key. Read it with `targetKeyOf`.
   */
  targetKey?: string;
  /** Plain words: where the actual comes from and what it leaves out. */
  source: string;
  /** Added by Aziz from the sheet: can be removed. */
  custom?: boolean;
};

/** The key a column's target, plan and Colour are read under: a mirror's is the column it mirrors. */
export function targetKeyOf(c: SheetColumn): string {
  return c.targetKey ?? c.key;
}

/** Why a column cannot be typed, in plain words (2026-11-02). */
export function fixedHintOf(c: SheetColumn): string {
  if (c.key === "clientsChurned")
    return "From the churn register, so it is not typed here.";
  if (c.rollup.kind === "ratio" && c.rollup.under.join() === "one")
    return "Added up from its parts, so it follows them.";
  return "Worked out from the columns it divides, so it follows them.";
}

/** The column's name on its stored target row, where no section header is beside it. */
export function boardLabelOf(c: SheetColumn): string {
  return c.boardLabel ?? c.label;
}

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
  extra: {
    driver?: DriverKey;
    targetKey?: string;
    boardLabel?: string;
    /** A count its record keeps, never typed (2026-11-02: the churn register). */
    editable?: boolean;
  } = {},
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
 * Metrics the sheet no longer shows (2026-11-02): not on his sheet, and the
 * creative ones he cannot track. Their targets stay on the plan untouched, AOV
 * and direct demos still feed it as inputs, and their typed days are kept. The
 * Goals board hides them too. The instalments owed on signed deals
 * (`onDealDue`, 2026-11-02) are kept off the same way: an input of the plan
 * that was never a column, set in Plan next month.
 */
export const RETIRED_SHEET_KEYS: ReadonlySet<string> = new Set([
  "directDemos",
  "aov",
  "onDealDue",
  "roasContracted",
  "clientsAtStart",
  "churnRate",
  "scriptsPerDay",
  "newAngles",
  "videosPerDay",
  "revisionsPerVideo",
]);

/**
 * His sheet, in his order. The keys are the Goals catalogue's where it has the
 * number, so a target here is the same row the Goals board scores.
 */
export const SHEET_COLUMNS: SheetColumn[] = [
  // Ad spend / lead gen.
  col(
    "spendRetargeting",
    "Hammer Them ad spend",
    "lead_gen",
    "usd",
    "up",
    sum("spendRetargeting"),
    "Retargeting spend on Mahara's own account, by Meta's day: the ad account's own day, Los Angeles time (10 or 11 hours behind Kuwait, by the season), not Kuwait's. Kept apart from lead gen.",
    { driver: "spendRetargeting" },
  ),
  col(
    "spend",
    "Ad spend",
    "lead_gen",
    "usd",
    "up",
    sum("spend"),
    "Lead-gen spend on Mahara's own account, by Meta's day: the ad account's own day, Los Angeles time (10 or 11 hours behind Kuwait, by the season), not Kuwait's, so a day's spend and that day's leads and calls (Kuwait days) are cut at different hours. The webinar's campaigns and Hammer Them retargeting are not in it.",
    { driver: "spend", boardLabel: "Lead gen ad spend" },
  ),
  col(
    "uniqueLinkClicks",
    "Unique link clicks",
    "lead_gen",
    "count",
    "up",
    sum("uniqueLinkClicks"),
    "Each ad's unique link clicks summed by Meta's day (the ad account's own Los Angeles day, as Ad spend), on the same lead-gen ads as Ad spend, the webinar's left out. A person who clicks two ads, or on two days, counts twice (Meta's own account-day sum for October is 2,383). A day Meta gave no unique count for is not known, so a run of days over it reads missing, never a smaller count. An ended month whose days do not carry it reads B2B's whole-month link clicks instead, which count every click and so read higher; the month in progress waits for its days.",
  ),
  col(
    "cpc",
    "CPC",
    "lead_gen",
    "usd",
    "down",
    ratio(["spend"], ["uniqueLinkClicks"]),
    "Ad spend over unique link clicks. A day Meta gave no unique count for leaves the run missing, so its spend never sits over fewer clicks. November's targets were set on inline clicks, which count more, so they read harder than they are.",
  ),
  col(
    "landingPageConversion",
    "LPC (lead per click)",
    "lead_gen",
    "rate",
    "up",
    ratio(["leads"], ["uniqueLinkClicks"]),
    "Lead per click: ROAS leads (CRM) over unique link clicks (Meta). Only as good as the tagging: leads are the ROAS tags.",
  ),
  col(
    "leads",
    "Leads",
    "lead_gen",
    "count",
    "up",
    sum("leads"),
    "Contacts tagged roas-qualified or roas-unqualified, by the day they were created. Not-ready and untagged contacts are left out.",
  ),
  col(
    "cpl",
    "CPL",
    "lead_gen",
    "usd",
    "down",
    ratio(["spend"], ["leads"]),
    "Lead-gen spend over those leads.",
    { driver: "cpl" },
  ),
  col(
    "leadToBooked",
    "L2B %",
    "lead_gen",
    "rate",
    "up",
    ratio(["bookedLeads"], ["leads"]),
    "Leads that ever booked an intro or a demo, over leads. Ever booked: a cancelled booking still counts, so a past month can still rise. Setters tag by hand, so this likely reads high until every lead is tagged.",
    { driver: "leadToBooked" },
  ),

  // Intro calls.
  col(
    "introsBooked",
    "Intro calls booked",
    "intro_calls",
    "count",
    "up",
    sum("introsBooked"),
    "Intro calls booked, by the day they were booked. The webinar's calls are left out.",
  ),
  col(
    "costPerIntroBooked",
    "Cost per intro call",
    "intro_calls",
    "usd",
    "down",
    ratio(["spend"], ["introsBooked"]),
    "Ad spend over intro calls booked.",
  ),
  col(
    "introsDue",
    "Intro calls scheduled for the day",
    "intro_calls",
    "count",
    "up",
    sum("introsDue"),
    "Intro calls set for that day whose time has passed, whatever came of them: cancelled and no-shows are in, the webinar's are out. What the show rate divides by, the B2B rule. Calls later today are not in it yet.",
    { boardLabel: "Intro calls due" },
  ),
  col(
    "introsShown",
    "Showed calls",
    "intro_calls",
    "count",
    "up",
    sum("introsShown"),
    "Intro calls held, by call day: showed, or confirmed or invalid (held, not a fit) once its time passed. Invalid calls count as shown, the B2B rule.",
    { boardLabel: "Intros showed" },
  ),
  col(
    "introShowRate",
    "Show rate %",
    "intro_calls",
    "rate",
    "up",
    ratio(["introsShown"], ["introsDue"]),
    "Showed calls over intro calls scheduled for the day, the two columns beside it.",
    { driver: "introShowRate", boardLabel: "Intro show rate" },
  ),
  col(
    "costPerIntroShown",
    "Cost per live intro call",
    "intro_calls",
    "usd",
    "down",
    ratio(["spend"], ["introsShown"]),
    "Ad spend over intro calls held.",
  ),

  // Demo calls.
  col(
    "demosBooked",
    "Demo calls booked",
    "demo_calls",
    "count",
    "up",
    sum("demosBooked"),
    "Demo calls booked, by the day they were booked. Direct demos and rebooks included.",
  ),
  col(
    "costPerDemoBooked",
    "Cost per demo call",
    "demo_calls",
    "usd",
    "down",
    ratio(["spend"], ["demosBooked"]),
    "Ad spend over demo calls booked.",
  ),
  col(
    "introToDemo",
    "Intro to demo %",
    "demo_calls",
    "rate",
    "up",
    ratio(["introsAdvanced"], ["introsShown"]),
    "Held intros whose contact went on to book a demo, over intros held, by the intro's call day, B2B's intro_to_demo. Read as of the refresh, so a day can still rise. A demo booked straight from a lead is not in it. Not the old sheet's demos booked ÷ intros scheduled.",
    { driver: "introToDemo" },
  ),
  col(
    "demosDue",
    "Demo calls scheduled for the day",
    "demo_calls",
    "count",
    "up",
    sum("demosDue"),
    "Demo calls set for that day whose time has passed, whatever came of them: cancelled and no-shows are in, the webinar's are out. What the show rate divides by. Calls later today are not in it yet.",
    { boardLabel: "Demo calls due" },
  ),
  col(
    "demosShown",
    "Showed calls",
    "demo_calls",
    "count",
    "up",
    sum("demosShown"),
    "Demo calls held, by call day: showed, or confirmed or invalid (held, not a fit) once its time passed. Invalid calls count as shown, the B2B rule.",
    { boardLabel: "Demos showed" },
  ),
  col(
    "demoShowRate",
    "Show rate %",
    "demo_calls",
    "rate",
    "up",
    ratio(["demosShown"], ["demosDue"]),
    "Showed calls over demo calls scheduled for the day, the two columns beside it.",
    { driver: "demoShowRate", boardLabel: "Demo show rate" },
  ),
  col(
    "costPerDemoShown",
    "Cost per live demo",
    "demo_calls",
    "usd",
    "down",
    ratio(["spend"], ["demosShown"]),
    "Ad spend over demo calls held.",
  ),
  col(
    "offersMade",
    "Offers made",
    "demo_calls",
    "count",
    "up",
    sum("offersMade"),
    "The closer's EOD, on the days one was filed; a typed day wins. A day with no EOD is empty, not zero, and the CEO's own demos are on no EOD.",
  ),
  col(
    "offerRate",
    "Offer %",
    "demo_calls",
    "rate",
    "up",
    ratio(["offersMade"], ["demosShown"]),
    "Offers over demos held. An offer made on an intro call counts too, so it can pass 100%.",
  ),
  col(
    "closes",
    "Closed deals",
    "demo_calls",
    "count",
    "up",
    sum("closes"),
    "Closer-form submissions, by the day the form was filled. Voided deals are out.",
  ),
  col(
    "closeRate",
    "Close rate %",
    "demo_calls",
    "rate",
    "up",
    ratio(["closes"], ["demosShown"]),
    "Signed deals over demos held. The dashboard's close rate over qualified demos reads higher.",
    { driver: "closeRate" },
  ),
  col(
    "newCash",
    "Cash collected",
    "demo_calls",
    "usd",
    "up",
    sum("newCash"),
    "Money paid on a signed deal, on Whop, Tap, a logged transfer or by hand, on the day it arrived. Bank lines stop at the last uploaded statement. Instalments on deals signed in an earlier month are in it, not in MRR collected. A plan counts them in its target on a line of their own, the instalments owed on signed deals, collected at its MRR collection rate.",
  ),
  col(
    "contracted",
    "Contracted revenue",
    "demo_calls",
    "usd",
    "up",
    sum("contracted"),
    "Contract value typed on the closer form, by the day the form was filled.",
  ),
  col(
    "cashShare",
    "UF cash %",
    "demo_calls",
    "rate",
    "up",
    ratio(["paidOnWindowDeals"], ["monthContracted"]),
    "Cash paid in the month on deals signed in the month, over the month's contracted revenue, both to the newest refresh. A month measure: a day or a run of days has none. Earlier deals' instalments are in Cash collected, not here, as the plan's share means.",
    { driver: "cashShare" },
  ),
  col(
    "roasFrontEnd",
    "FE ROAS",
    "demo_calls",
    "x",
    "up",
    ratio(["newCash"], ["spend", "spendRetargeting"]),
    "Cash collected over all of Mahara's ad spend, lead gen and Hammer Them retargeting. The plan's FE ROAS divides by the same two.",
  ),
  col(
    "cac",
    "CPA",
    "demo_calls",
    "usd",
    "down",
    ratio(["spend", "spendRetargeting"], ["closes"]),
    "All of Mahara's ad spend, Hammer Them included, over closed deals, his definition (30 Oct). Payroll is not in it. The plan's CPA divides the same two.",
  ),

  // Collections.
  col(
    "mrrProjected",
    "Projected MRR to collect",
    "collections",
    "usd",
    "up",
    { kind: "last", part: "mrrProjected" },
    "What recurring cards owe in the month from clients who were clients before the month (the Money tab's book, back end only). New clients' first payments are in Cash collected, and a card still on its closer-form deal is front end. A whole-month number: a day or a run of days has none of its own.",
    { driver: "mrrDue" },
  ),
  col(
    "mrrCollected",
    "MRR collected",
    "collections",
    "usd",
    "up",
    { kind: "last", part: "mrrCollected" },
    "Payments on those same cards in the month so far, every rail: clients who were clients before the month. New clients' first payments are in Cash collected. A whole-month number: a day or a run of days has none of its own.",
  ),
  col(
    "mrrCollectionRate",
    "Collections %",
    "collections",
    "rate",
    "up",
    ratio(["mrrCollected"], ["mrrProjected"]),
    "MRR collected over projected MRR to collect: clients who were clients before the month. New clients' first payments are in Cash collected.",
    { driver: "mrrCollectionRate" },
  ),

  // Customer success.
  col(
    "clientsChurned",
    "Clients churned",
    "customer_success",
    "count",
    "down",
    sum("clientsChurned"),
    "The churn register, by the day the client left: the register is the record, so this is not typed here. A day the register was read with nobody leaving is 0. A finished term is logged apart. The Churn page counts only losses before day 90, so it can read lower.",
    { editable: false },
  ),
  col(
    "upsells",
    "Upsells",
    "customer_success",
    "count",
    "up",
    sum("upsells"),
    "Upsells signed or paid in the wins ledger, by the day each was signed. A typed day replaces the ledger's count. The ledger opened on 2 Nov 2026; a day before it is not known.",
  ),
  col(
    "upsellCash",
    "Upsell cash",
    "customer_success",
    "usd",
    "up",
    sum("upsellCash"),
    "Checked payments tied to an upsell win in the wins ledger, by the day each was paid. A typed day replaces the ledger's. Paid on a rail, it is already inside Total revenue's back-end cash, so revenue does not add it again.",
    { driver: "upsellCash" },
  ),
  col(
    "refunds",
    "Refunds",
    "customer_success",
    "count",
    "down",
    sum("refunds"),
    "Refunds in the money refresh's rows, Whop and logged by hand, by the day of the refund. A typed day replaces the count read.",
  ),
  col(
    "refundAmount",
    "Refunds amount",
    "customer_success",
    "usd",
    "down",
    sum("refundAmount"),
    "Refunds on Whop and logged by hand, the Money tab's number, by the day of the refund. Total revenue takes off only the ones logged by hand: Whop cash is already net of its refunds. The plan takes the target off its revenue, so a target typed here moves the spend.",
    { driver: "refundAmount" },
  ),
  col(
    "extensionsGiven",
    "Extensions given",
    "customer_success",
    "count",
    "down",
    sum("extensionsGiven"),
    "Extension grants in the billing log (Give more time on the client page, Extend on the billing sheet), by the day given, voids applied. A typed day replaces that day's grants. The log began on 23 Sep 2026; a day before it is not known.",
  ),
  col(
    "referrals",
    "Referrals",
    "customer_success",
    "count",
    "up",
    sum("referrals"),
    "Referral deals logged in the wins ledger, by the win date. A typed day replaces the ledger's count. The ledger opened on 2 Nov 2026; a day before it is not known.",
  ),
  col(
    "testimonials",
    "Testimonials",
    "customer_success",
    "count",
    "up",
    sum("testimonials"),
    "Video testimonials logged in the wins ledger, by the win date. A typed day replaces the ledger's count. The ledger opened on 2 Nov 2026; a day before it is not known.",
  ),
  col(
    "googleReviews",
    "Reviews",
    "customer_success",
    "count",
    "up",
    sum("googleReviews"),
    "Google reviews logged in the wins ledger, by the win date. A typed day replaces the ledger's count. The ledger opened on 2 Nov 2026; a day before it is not known.",
  ),

  // Business totals.
  col(
    "totalNewCash",
    "Total new cash",
    "business_totals",
    "usd",
    "up",
    sum("newCash"),
    "The same number as Cash collected under demo calls, as on his sheet: money paid on a signed deal, on the day it arrived, instalments on earlier deals included. Its target is Cash collected's, and a day typed here is typed there.",
    { targetKey: "newCash" },
  ),
  col(
    "totalCash",
    "Total revenue (with AR)",
    "business_totals",
    "usd",
    "up",
    ratio(["cashIn"], ["one"]),
    "Total new cash plus back-end cash, less refunds logged by hand: every payment in on the rails (Money's daily cash in) less the refunds logged by hand, as Whop cash is already net of its refunds. Back-end cash is every payment in less Total new cash over the same days, so retainers, upsells and a payment matched to no client are in it; Upsell cash and MRR collected are inside it and are not added again. Works for a day, a run of days or the month. With any part not read, revenue is missing, never smaller. Type a new target here and the plan works back up the funnel.",
  ),
  col(
    "totalContracted",
    "Total contracted",
    "business_totals",
    "usd",
    "up",
    ratio(["contracted", "upsellContracted"], ["one"]),
    "Contracted on new deals (the closer form) plus upsells signed or paid at their quoted price (the wins ledger), by the day each was signed. A day the ledger did not read is not known, so a run over it is missing, never smaller; 0 typed in Upsells for a day makes that day's upsells contracted 0 too.",
  ),
  col(
    "software",
    "Overhead expenses",
    "business_totals",
    "usd",
    "down",
    { kind: "last", part: "software" },
    "What software runs at for the month, not what the bank was charged: the Costs page's active lines in dollars, a yearly plan as a twelfth. A past month reads the lines as kept when it closed; the current month reads today's. Lines in another currency and overhead that is not software are not in it. A number typed on a day replaces it.",
    { driver: "overhead" },
  ),
  col(
    "labour",
    "Labour expenses",
    "business_totals",
    "usd",
    "down",
    { kind: "last", part: "labour" },
    "Typed. Payroll months are not filled in yet, so the plan prices it from the roster plus commission on this plan.",
    { driver: "labour" },
  ),
  col(
    "marketingExpenses",
    "Marketing expenses",
    "business_totals",
    "usd",
    "down",
    ratio(["spend", "spendRetargeting", "otherMarketing"], ["one"]),
    "Mahara's ad spend from Meta, plus other marketing if typed. A card that pays Meta is not read from the bank.",
  ),
  col(
    "profit",
    "Total profit",
    "business_totals",
    "usd",
    "up",
    ratio(["newCash"], ["one"]),
    "His sheet's rule: Total revenue less Overhead, Labour and Marketing expenses, as this row shows them. Overhead and labour are whole-month numbers, so the month so far carries all of them, and On pace for adds them once to the paced revenue and marketing. Processing fees are not in it. With revenue or any cost missing, profit is missing, never bigger.",
  ),
  col(
    "margin",
    "Margin %",
    "business_totals",
    "rate",
    "up",
    ratio(["newCash"], ["one"]),
    "Total profit over total revenue. Missing when either is.",
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
    ratio(["clientCplSpend"], ["clientCplLeads"]),
    "Client ad spend over the clients' CRM ad leads (a contact with an ad id or a Facebook-ad attribution), paired by client and day so both sides count the same clients. A day no client pairs is left out of both. Meta's form leads stay on CEO Delivery for comparison.",
    { driver: "clientCpl", boardLabel: "Client CPL" },
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
    "Confirmed bookings over new client leads in the shared call centre report. Provisional bookings are out. The report's rule: the Client Performance board's booking rate drops cancelled bookings, so it reads lower.",
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
    { boardLabel: "Call centre show rate" },
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
    ratio(["callCloses"], ["callShows"]),
    "Deals marked won over shown appointments, both from the shared call centre report. Clients mark won deals in the portal and most do not, so 0 means 0 recorded, not none closed.",
    { boardLabel: "Call centre close rate" },
  ),

  // Creative: one count he types (2026-11-02, "how many videos today").
  col(
    "videosCompleted",
    "Videos completed",
    "creative",
    "count",
    "up",
    sum("videos"),
    "Videos finished that day, typed: nothing measures finished edits yet. Days typed under the old Videos per day carry over. The target is the month's total.",
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
    section: sectionOf(m.section),
    unit: m.unit,
    direction: m.direction,
    rollup: { kind: m.rollup, part: m.key },
    editable: true,
    source: m.note || "Added by you. Typed.",
    custom: true,
  };
}

/** All columns for a tab: his sheet, with anything added at the end of its section. */
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
 * The flag a day carries for a part its store did not read that day
 * (2026-11-02): the wins ledger before it opened, the billing log before 23
 * Sep, refunds and money in outside the money refresh's window, a growth day
 * from before the release that added the field. A store that was read and
 * holds nothing for a day is 0; one that was not read is not known, so any
 * run of days over it is missing, never a smaller total. A typed day replaces
 * it, as it replaces a read number.
 */
export function unknownFlag(part: string): string {
  return `${part}?`;
}

/** Whether a day does not know this part: its store did not read it and nothing was typed. */
export function unknownOn(row: DayParts, part: string): boolean {
  return row[unknownFlag(part)] === 1 && !ok(row[part]);
}

/** A run's total of a part: missing when any day of it is not known, the days that recorded it otherwise. */
function addKnown(rows: DayParts[], part: string): number | null {
  if (rows.some(r => unknownOn(r, part))) return null;
  return addUp(rows, part);
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
  // No upsell signed that day (the ledger's 0, or a 0 typed in Upsells) is no
  // upsell contracted either: the two count the same wins on the same day,
  // so a day before the ledger opened can be completed from Upsells alone
  // (2026-11-02). A count above 0 with no price read stays not known.
  if (!ok(p.upsellContracted) && p.upsells === 0) out.upsellContracted = 0;
  return out;
}

/**
 * The parts a column reads, so a missing number can say which part it waits
 * on (2026-11-02). Revenue reads money in and the hand-logged refunds; profit
 * and margin read revenue's parts and the three costs.
 */
export function partsOf(c: SheetColumn): string[] {
  if (!c.custom) {
    const revenue = ["cashIn", "refundsManual", "newCash"];
    const costs = ["software", "labour", "spend", "spendRetargeting"];
    if (c.key === "totalCash") return revenue;
    if (c.key === "profit" || c.key === "margin") return [...revenue, ...costs];
    if (c.key === "marketingExpenses") return ["spend", "spendRetargeting"];
  }
  const r = c.rollup;
  return r.kind === "ratio"
    ? [...r.over, ...r.under].filter(p => p !== "one")
    : [r.part];
}

/**
 * One column over a run of days, or null when nothing recorded it. `facts`
 * are month-level numbers that do not divide by day (B2B's window, the book):
 * they win for the whole month and are not used on a shorter range. A caller
 * passes `facts` only for a whole month (the month so far, last month).
 */
export function rollUp(
  column: SheetColumn,
  rows: DayParts[],
  workingDays: number,
  facts?: DayParts,
): number | null {
  const total = (part: string): number | null => {
    const fact = facts?.[part];
    return ok(fact) ? fact : addKnown(rows, part);
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
      // A number typed on a day is his figure for the month and wins over
      // the month's own (2026-11-02): overhead's source line always said so,
      // and the month's fact used to hide it.
      for (let i = rows.length - 1; i >= 0; i--) {
        const v = rows[i][r.part];
        if (ok(v)) return v;
      }
      const fact = facts?.[r.part];
      return ok(fact) ? fact : null;
    }
    case "perWorkingDay": {
      const t = total(r.part);
      return t !== null && workingDays > 0 ? t / workingDays : null;
    }
    case "ratio": {
      if (column.custom) break;
      if (column.key === "totalCash")
        return revenueOf(rows, workingDays, facts).value;
      if (column.key === "totalContracted") {
        // Both parts are needed: a missing one leaves the total missing.
        const a = total("contracted");
        const b = total("upsellContracted");
        return ok(a) && ok(b) ? a + b : null;
      }
      if (column.key === "marketingExpenses")
        return plusParts(
          total("spend"),
          total("spendRetargeting"),
          total("otherMarketing"),
        );
      if (column.key === "profit") return profitOf(rows, workingDays, facts);
      if (column.key === "margin") {
        const profit = profitOf(rows, workingDays, facts);
        const revenue = revenueOf(rows, workingDays, facts).value;
        return ok(profit) && ok(revenue) && revenue > 0
          ? profit / revenue
          : null;
      }
      break;
    }
  }
  if (r.kind !== "ratio") return null;
  const over = plusParts(...r.over.map(total));
  const under = plusParts(...r.under.map(total));
  return over !== null && under !== null && under > 0
    ? (over / under) * (r.scale ?? 1)
    : null;
}

function plusParts(...xs: (number | null)[]): number | null {
  return xs.some(ok)
    ? xs.reduce<number>((n, x) => n + (ok(x) ? x : 0), 0)
    : null;
}

/**
 * Total revenue (with AR), 2026-11-02 (truth/SYNTHESIS.md fix 1): Total new
 * cash plus back-end cash, less the refunds logged by hand. Back-end cash
 * over any run of days is every payment in on the rails (`cashIn`, Money's
 * daily cash in, the CEO's excluded test payment already out) less the deal
 * ledger's new cash over the same days, so new cash plus back-end cash is the
 * money in. Upsell cash and MRR collected are inside back-end cash and are
 * never added again: his sheet's AU rule (new cash + upsell cash + MRR
 * collected) counted October's three new clients' first payments twice.
 * Whop cash is already net of its refunds, so only the hand-logged ones come
 * off. A Cash collected typed over the ledger moves revenue by what it
 * changed, as a part typed anywhere else would.
 */
export type Revenue = {
  value: number | null;
  /** Each part over the same days: new cash, back-end cash, hand-logged refunds. */
  parts: {
    newCash: number | null;
    backEndCash: number | null;
    refundsManual: number | null;
  };
  /** Parts not read for some of these days, by name: revenue is missing. */
  missing: string[];
  /** Money in the CEO left out, said beside the number (filled by the sheet, which knows the days). */
  leftOut: string[];
  /** Every payment in on the rails over the same days, the check revenue is built on. */
  cashIn: number | null;
  /** Sentences beside the number: new cash above the money in, never clamped. */
  notes: string[];
};

export const REVENUE_PART_NAMES = {
  cashIn: "every payment in (Money's daily cash in)",
  refundsManual: "refunds logged by hand",
} as const;

/** Revenue over a run of days, day, rolling run or month alike. `facts` may carry the month's hand-logged refunds. */
export function revenueOf(
  rows: DayParts[],
  _workingDays: number,
  facts?: DayParts,
): Revenue {
  const missing: string[] = [];
  const notes: string[] = [];
  const cashIn = addKnown(rows, "cashIn");
  const factRefunds = facts?.refundsManual;
  const refundsManual = ok(factRefunds)
    ? factRefunds
    : addKnown(rows, "refundsManual");
  if (cashIn === null) missing.push(REVENUE_PART_NAMES.cashIn);
  if (refundsManual === null) missing.push(REVENUE_PART_NAMES.refundsManual);
  const newCash = addUp(rows, "newCash");
  const measured = addUp(rows, "newCashMeasured") ?? 0;
  const backEndCash = cashIn === null ? null : round2(cashIn - measured);
  if (backEndCash !== null && backEndCash < -0.005)
    notes.push(
      `Total new cash is ${money(-backEndCash)} more than every payment in over these days (the deal ledger and the money refresh read at different times), so back-end cash reads ${money(backEndCash)}; it is not set to 0.`,
    );
  const value =
    missing.length || cashIn === null || refundsManual === null
      ? null
      : round2(cashIn + ((newCash ?? 0) - measured) - refundsManual);
  return {
    value,
    parts: { newCash, backEndCash, refundsManual },
    missing,
    leftOut: [],
    cashIn,
    notes,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** His Total profit: revenue less the three expense columns, each as its own column reads it. */
function profitOf(
  rows: DayParts[],
  workingDays: number,
  facts?: DayParts,
): number | null {
  const revenue = revenueOf(rows, workingDays, facts).value;
  const cost = (key: string) =>
    rollUp(COLUMN_BY_KEY[key], rows, workingDays, facts);
  const overhead = cost("software");
  const labour = cost("labour");
  const marketing = cost("marketingExpenses");
  // Payroll or overhead with no number is a missing profit, not a bigger one.
  if (!ok(revenue) || !ok(overhead) || !ok(labour) || !ok(marketing))
    return null;
  return revenue - (overhead + labour + marketing);
}

/**
 * A cell typed over what was measured wins for that day (2026-11-02: every
 * part, extensions included; a typed day used to add to the grants, which
 * counted Liwan twice in October).
 */
export function dayRow(
  measured: DayParts | undefined,
  typed: Record<string, number> | undefined,
): DayParts {
  return withComputed({ ...(measured ?? {}), ...(typed ?? {}) });
}

/** Totals made of other columns that add up over the month, so they pace like a count. */
const ADDS_UP = new Set([
  "totalCash",
  "totalContracted",
  "marketingExpenses",
  "profit",
]);

/** Whether a metric only means something whole: a rate, a cost, a per-day figure. */
export function isLevel(c: SheetColumn): boolean {
  const r = c.rollup;
  if (r.kind === "avg" || r.kind === "last" || r.kind === "perWorkingDay")
    return true;
  if (r.kind !== "ratio") return false;
  return !ADDS_UP.has(c.key);
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

/**
 * On pace for, worked out from the parts where a column mixes counts and
 * whole-month numbers (2026-11-02), so the row adds up across: profit is
 * revenue's pace less overhead, labour and marketing's paces (the first two
 * counted once, not stretched), and margin divides the two. Revenue's parts
 * all add up over the month, so it paces like a count, as on his sheet. Every
 * other column is `onPaceFor` of its actual. `facts` are the month's, as for
 * `rollUp`.
 */
export function paceFor(
  c: SheetColumn,
  rows: DayParts[],
  workedSoFar: number,
  workingDays: number,
  facts?: DayParts,
): number | null {
  const of = (key: string) =>
    paceFor(COLUMN_BY_KEY[key], rows, workedSoFar, workingDays, facts);
  if (!c.custom && c.key === "profit") {
    if (rollUp(c, rows, workedSoFar, facts) === null) return null;
    const parts = ["totalCash", "software", "labour", "marketingExpenses"].map(
      of,
    );
    if (!parts.every(ok)) return null;
    const [revenue, overhead, labour, marketing] = parts as number[];
    return revenue - (overhead + labour + marketing);
  }
  if (!c.custom && c.key === "margin") {
    const profit = of("profit");
    const revenue = of("totalCash");
    return ok(profit) && ok(revenue) && revenue > 0 ? profit / revenue : null;
  }
  return onPaceFor(
    c,
    rollUp(c, rows, workedSoFar, facts),
    workedSoFar,
    workingDays,
  );
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
 * The goal is revenue by his sheet's rule, so the new cash it needs is the
 * goal less MRR collected and upsell cash (the plan's back-end cash), plus
 * the refunds it must cover (`refundAmount`, an empty box plans none).
 *
 * The instalments owed on signed deals (2026-11-02) are collected at the same
 * rate and counted in Cash collected, but no ad bought them: they come off
 * the goal with MRR collected, and the funnel is asked only for the new
 * deals' cash. So the same cards read on the whole book, or split into the
 * back end and the deals, ask for the same spend. An empty box is not
 * planned and takes nothing off.
 */
export function solveSpend(i: PlanInputs): number | null {
  const need =
    ok(i.goalCash) && ok(i.mrrDue) && ok(i.mrrCollectionRate)
      ? i.goalCash -
        i.mrrDue * i.mrrCollectionRate -
        (ok(i.onDealDue) ? i.onDealDue * i.mrrCollectionRate : 0) -
        (i.upsellCash ?? 0) +
        (i.refundAmount ?? 0)
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
  // FE ROAS and CPA divide by Meta ad spend only, lead gen and Hammer Them, as
  // the actuals do (2026-11-02, truth/SYNTHESIS.md fix 15): other marketing is
  // a cost of the month, not of the ads.
  const adSpend = ok(spend) || ok(hammer) ? (spend ?? 0) + (hammer ?? 0) : null;
  const totalContracted = ok(p.contracted)
    ? p.contracted + (i.upsellCash ?? 0)
    : null;
  const costs =
    marketing !== null || ok(i.labour) || ok(i.overhead)
      ? (marketing ?? 0) + (i.labour ?? 0) + (i.overhead ?? 0)
      : null;
  // His sheet's revenue on the plan's own numbers (2026-11-02). Upsells and
  // refunds are lines that add up, so an empty one plans nothing; new cash and
  // MRR collected are the funnel and the book, and either missing leaves
  // revenue missing, never smaller. New cash is Cash collected: the month's
  // deals' cash and the instalments owed on signed deals (project's newCash).
  const revenue =
    ok(p.newCash) && ok(p.backEndCash)
      ? p.newCash + (i.upsellCash ?? 0) + p.backEndCash - (i.refundAmount ?? 0)
      : null;
  const profit = ok(revenue) && costs !== null ? revenue - costs : null;
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
    // The plan books each intro once and it falls due once, so the month's
    // intros due are its intros booked; the show rate is planned over them.
    introsDue: p.introsBooked,
    introsShown: p.introsShown,
    introShowRate: i.introShowRate,
    costPerIntroShown: p.costPerIntroShown,
    demosBooked: p.demosBooked,
    costPerDemoBooked: p.costPerDemoBooked,
    introToDemo: i.introToDemo,
    directDemos: i.directDemos,
    demosDue: p.demosBooked,
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
    roasFrontEnd: ok(p.newCash) && adSpend ? p.newCash / adSpend : null,
    roasContracted:
      ok(p.contracted) && marketing ? p.contracted / marketing : null,
    cac: ok(p.closes) && p.closes > 0 && adSpend ? adSpend / p.closes : null,
    mrrProjected: i.mrrDue,
    mrrCollected: p.backEndCash,
    mrrCollectionRate: i.mrrCollectionRate,
    upsellCash: i.upsellCash,
    refundAmount: i.refundAmount ?? null,
    totalCash: revenue,
    totalContracted,
    marketingExpenses: marketing,
    labour: i.labour,
    software: i.overhead,
    profit,
    margin: ok(profit) && ok(revenue) && revenue > 0 ? profit / revenue : null,
    clientCpl: i.clientCpl,
    clientCpb: p.clientCpb,
    callLeadToBooking: i.callLeadToBooking,
  };
  return { drivers, p, byColumn };
}

/** The first guess at the gates, from the one place they are declared. */
export const GATES = { cpl: CPL_GATE, cpb: CPB_GATE };

/**
 * Whether a column has a plan row of its own: a mirror's is the column it
 * mirrors, a retired metric's stays as it was, and one he added is typed.
 */
export function writesTarget(c: SheetColumn): boolean {
  return !c.targetKey && !c.custom && !RETIRED_SHEET_KEYS.has(c.key);
}

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
    if (!writesTarget(c)) continue;
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

// ---- The month's lifecycle (WAVE12-CONTRACT 2.8, 4.11.5) -------------------------------------------
// cockpit_ceo_goal_sheet_context returns `lifecycle` {extensions, latePayments, departures, missing} and
// `manualLogged` since 20261101q. Each list is null with a sentence in `missing` while its record is not
// live, never an empty list that reads as none.

export type LifecycleExtension = {
  grantId: number;
  taskId: string;
  client: string;
  grantedOn: string;
  weeks: number;
  from: string | null;
  until: string;
  state: "live" | "ended" | "replaced";
  reason: string | null;
  source: string;
};
export type LifecycleLate = {
  taskId: string;
  client: string;
  dueOn: string;
  amountUsd: number | null;
  endedOn: string | null;
  closedHow: string;
  paidOn: string | null;
  daysLate: number | null;
  source: string;
};
export type LifecycleDeparture = {
  departureId: number;
  taskId: string | null;
  client: string;
  leftOn: string;
  reason: string;
  churnType: "mid_programme" | "completed" | null;
  whyDetail: string | null;
  howToStop: string | null;
  surveyState: string | null;
  confirmed: boolean;
  confirmedOn: string | null;
  source: string;
};
export type GoalLifecycle = {
  extensions: LifecycleExtension[] | null;
  latePayments: LifecycleLate[] | null;
  departures: LifecycleDeparture[] | null;
  missing: string[];
};
export type ManualLogged = {
  count: number;
  usd: number;
  oldestDay: string | null;
};

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const listOf = <T>(v: unknown): T[] | null =>
  Array.isArray(v) ? (v.filter(isObj) as T[]) : null;

/** The sheet context's lifecycle, or null when the server is older than 20261101q. */
export function lifecycleOf(ctx: object): GoalLifecycle | null {
  const raw = (ctx as { lifecycle?: unknown }).lifecycle;
  if (!isObj(raw)) return null;
  return {
    extensions: listOf<LifecycleExtension>(raw.extensions),
    latePayments: listOf<LifecycleLate>(raw.latePayments),
    departures: listOf<LifecycleDeparture>(raw.departures),
    missing: Array.isArray(raw.missing)
      ? raw.missing.filter((m): m is string => typeof m === "string")
      : [],
  };
}

/** Hand-logged money waiting on its bank check, or null when the money refresh has not written it. */
export function manualLoggedOf(ctx: object): ManualLogged | null {
  const raw = (ctx as { manualLogged?: unknown }).manualLogged;
  if (!isObj(raw)) return null;
  const count = Number(raw.count);
  const usd = Number(raw.usd);
  if (!Number.isFinite(count) || !Number.isFinite(usd)) return null;
  return {
    count,
    usd,
    oldestDay: typeof raw.oldestDay === "string" ? raw.oldestDay : null,
  };
}

/**
 * The measured parts the lifecycle gives each day: extensions given, by the day they were given. The
 * goal sheet's measured map takes these beside the growth and cash days.
 */
export function lifecycleDayParts(
  life: GoalLifecycle | null,
): Record<string, DayParts> {
  const out: Record<string, DayParts> = {};
  for (const e of life?.extensions ?? []) {
    const day = out[e.grantedOn] ?? {};
    day.extensionsGiven = (Number(day.extensionsGiven) || 0) + 1;
    out[e.grantedOn] = day;
  }
  return out;
}

/**
 * A lock-in line's name: the sheet's own for a metric the sheet has
 * (2026-11-02), so October's "Total new cash" line, written with the key
 * totalCash before the sheet's revenue rule, reads "Total revenue (with AR)",
 * the number it shows. The name a metric carries with no section header
 * beside it, as on the board, since the lock-in's sections are not the
 * sheet's. The key is never remapped: the line keeps what it was saved under.
 */
export function lineLabel(r: {
  label: string;
  metric_key: string | null;
}): string {
  const c = r.metric_key ? COLUMN_BY_KEY[r.metric_key] : undefined;
  return c ? boardLabelOf(c) : r.label;
}

/** One measured lock-in line: what the cockpit holds for a client in a section, with where it came from. */
export type MeasuredLine = {
  taskId: string | null;
  client: string;
  value: string;
  source: string;
  /** Answers the cockpit already holds, by the lock-in's answer key ("why", "prevent", "form", ...). */
  answers: Record<string, string>;
};

const DAY_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const shortDay = (day: string | null) =>
  day && /^\d{4}-\d{2}-\d{2}$/.test(day)
    ? `${Number(day.slice(8, 10))} ${DAY_NAMES[Number(day.slice(5, 7)) - 1]}`
    : "a day not known";
const usdOrMissing = (n: number | null) =>
  n === null || !Number.isFinite(n) ? "amount missing" : money(n);
const SURVEY_WORDS: Record<string, string> = {
  not_sent: "Not sent yet.",
  sent: "Sent, not answered yet.",
  filled: "Filled in.",
  declined: "The client declined it.",
};
const CLOSED_WORDS: Record<string, string> = {
  open: "still late",
  extended: "an extension was given",
  stopped: "the client stopped",
  date_moved: "the date moved on the card",
};

/**
 * The cockpit's measured lines for one lock-in section (churned, extensions, late_payments). Null when
 * the section's record is not live yet; [] when it is live and holds nothing for the month.
 */
export function measuredLines(
  section: string,
  life: GoalLifecycle | null,
): MeasuredLine[] | null {
  if (!life) return null;
  if (section === "extensions") {
    if (!life.extensions) return null;
    return life.extensions.map(
      (e): MeasuredLine => ({
        taskId: e.taskId,
        client: e.client,
        value: `${e.weeks} ${e.weeks === 1 ? "week" : "weeks"}, ${shortDay(e.from ?? e.grantedOn)} to ${shortDay(e.until)}`,
        source: e.source,
        answers: e.reason ? { why: e.reason } : ({} as Record<string, string>),
      }),
    );
  }
  if (section === "late_payments") {
    if (!life.latePayments) return null;
    return life.latePayments.map(l => ({
      taskId: l.taskId,
      client: l.client,
      value: `${usdOrMissing(l.amountUsd)} due ${shortDay(l.dueOn)}, ${l.daysLate === null ? "days late not known" : `${l.daysLate} ${l.daysLate === 1 ? "day" : "days"} late`}${l.closedHow && l.closedHow !== "open" ? ` (${CLOSED_WORDS[l.closedHow] ?? l.closedHow})` : ""}`,
      source: l.source,
      answers: {},
    }));
  }
  if (section === "churned") {
    if (!life.departures) return null;
    return life.departures.map(d => {
      const answers: Record<string, string> = {};
      if (d.whyDetail) answers.why = d.whyDetail;
      if (d.howToStop) answers.prevent = d.howToStop;
      if (d.surveyState && SURVEY_WORDS[d.surveyState])
        answers.form = SURVEY_WORDS[d.surveyState];
      return {
        taskId: d.taskId,
        client: d.client,
        value: `Left ${shortDay(d.leftOn)}, ${d.reason}${d.churnType === "completed" ? ", a finished term" : ""}${d.confirmed ? "" : ", not confirmed"}`,
        source: d.source,
        answers,
      };
    });
  }
  return null;
}

/**
 * Measured lines matched to the section's lock-in rows by card: `byRow` keys a row id to its line, and
 * `extra` holds the lines no row names (a client the lock-in was written without).
 */
export function matchMeasured<
  R extends { id: number; client_task_id: string | null },
>(
  rows: R[],
  lines: MeasuredLine[] | null,
): { byRow: Map<number, MeasuredLine>; extra: MeasuredLine[] } {
  const byRow = new Map<number, MeasuredLine>();
  const extra: MeasuredLine[] = [];
  for (const line of lines ?? []) {
    const row = line.taskId
      ? rows.find(r => r.client_task_id === line.taskId && !byRow.has(r.id))
      : undefined;
    if (row) byRow.set(row.id, line);
    else extra.push(line);
  }
  return { byRow, extra };
}
