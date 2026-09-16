/**
 * Rules for the numbers more than one tab shows.
 *
 * A metric on a rollup tab and the same metric on its department tab have to
 * be the same number under the same name, so the rule lives here once instead
 * of being written out again on every tab that needs it.
 */

import type {
  CashRail,
  ChurnPayload,
  ClientRow,
  ClientsPayload,
  FunnelWindow,
  MoneyPayload,
  Note,
} from "../../../convex/ceo/payloads";
import { isNum, money, month as monthLabel, pct, plural } from "./format";

// --- Cash collected ------------------------------------------------------

/**
 * The headline cash number, the same on Today, Frontend and Money.
 *
 * It is the total over the rails that are actually connected: Whop, Tap once
 * its key is live, and the payments Aziz logs by hand once one exists. While
 * the money adapter has not filled `rails` (an older stored payload), it
 * falls back to the Whop figures the rest of the cockpit reads, and `note`
 * says so. The label always names the connected rails, so a total is never
 * read as more than it covers.
 */
export type CashHeadline = {
  /** Cash over the connected rails, or the Whop-only fallback. */
  rail: CashRail;
  /** The Whop rail on its own, which is also what `money.cash` carries. */
  whop: CashRail;
  /** The Tap rail, or null while the rails are not computed. */
  tap: CashRail | null;
  /** The hand-logged rail, or null while the adapter has not filled it. */
  manual: CashRail | null;
  /** True once the money adapter fills `money.rails`. */
  railed: boolean;
  /** The connected rails in words: "Whop only", "Whop and Tap", "Whop, Tap and hand-logged". */
  scope: string;
  /** "Cash collected this month, Whop only": the hero label on every tab that shows it. */
  label: string;
  /** The caveat the card must carry whenever the number is narrower than all the money coming in. */
  note: Note | null;
};

/** `money.cash` dressed as a rail, for the days before the adapter filled `rails`. */
function whopOnly(p: MoneyPayload): CashRail {
  return {
    label: "Whop",
    connected: true,
    today: p.cash.today,
    yesterday: p.cash.yesterday,
    mtd: p.cash.mtd,
    lastMonthToDate: p.cash.lastMonthToDate,
    lastMonth: p.cash.lastMonth,
    projectedMonth: p.cash.projectedMonth,
    refundsMtd: p.refunds.mtd,
    daily: p.cash.daily,
    lastPaymentAt: null,
  };
}

/**
 * The only caveat this helper owns. Once the adapter fills `rails` it writes
 * its own notes about scope and about Tap, which say more (they name the
 * command that connects Tap), so this one steps aside rather than repeating
 * them. It is here for a payload stored before the rails shipped.
 */
const RAILS_MISSING: Note = {
  level: "warn",
  text: "Cash rails are not computed yet, so every cash figure here is Whop only. Tap, bank transfers and cheques are not in it.",
};

/** "Whop", "Whop and Tap", "Whop, Tap and hand-logged". */
function listWords(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function cashHeadline(p: MoneyPayload): CashHeadline {
  const fallback = whopOnly(p);
  const railed = Boolean(p.rails);
  const whop = p.rails?.whop ?? fallback;
  const tap = p.rails?.tap ?? null;
  const manual = p.rails?.manual ?? null;
  const rail = p.rails?.total ?? fallback;
  const parts = ["Whop"];
  if (railed && tap?.connected) parts.push("Tap");
  if (railed && manual?.connected) parts.push("hand-logged");
  const scope = parts.length > 1 ? listWords(parts) : "Whop only";
  return {
    rail,
    whop,
    tap,
    manual,
    railed,
    scope,
    label: `Cash collected this month, ${scope}`,
    note: railed ? null : RAILS_MISSING,
  };
}

// --- Contracted this month ----------------------------------------------

/**
 * Contracted value this month, the same number under the same name on Today,
 * Frontend, Sales and Money. Decision of 2026-09-16: a deal value logged by
 * hand with a payment adds to contracted, and the two never double count. So
 * the figure is closer form contracted value plus the hand-logged deal values
 * the money adapter did not flag as already on the closer form.
 *
 * `money.deals.mtd` and `money.deals.contractedMtd` stay closer form only,
 * because the monthly targets compare against them; read them directly only
 * where the label says "closer form".
 */
export type ContractedHeadline = {
  label: string;
  /** Closer form plus hand-logged deal values, this Kuwait month. */
  value: number;
  /** The same for the whole of last month. */
  lastMonth: number;
  /** Closer form contracted value this month. */
  closerForm: number;
  /** Hand-logged deal values this month, or null when this payload does not carry them (stored before they shipped, or the deal check failed). */
  byHand: number | null;
  /** Hand-logged deals this month; 0 when none or not read. */
  handDeals: number;
  /** Deals behind `value`: closer form deals plus hand-logged deals. */
  deals: number;
  /** "Closer form $6,000, logged by hand $1,500", or null when nothing was logged by hand. */
  split: string | null;
  /** The definition behind the info icon. */
  hint: string;
};

export function contractedHeadline(p: MoneyPayload): ContractedHeadline {
  const d = p.deals;
  const byHand = isNum(d.manualContractedMtd) ? d.manualContractedMtd : null;
  const byHandLast = isNum(d.manualContractedLastMonth)
    ? d.manualContractedLastMonth
    : 0;
  const handDeals = byHand !== null && isNum(d.manualMtd) ? d.manualMtd : 0;
  return {
    label: "Contracted this month",
    value: d.contractedMtd + (byHand ?? 0),
    lastMonth: d.contractedLastMonth + (byHand === null ? 0 : byHandLast),
    closerForm: d.contractedMtd,
    byHand,
    handDeals,
    deals: d.mtd + handDeals,
    split: byHand
      ? `Closer form ${money(d.contractedMtd)}, logged by hand ${money(byHand)}`
      : null,
    hint:
      byHand === null
        ? "Contracted value on the closer form. Deal values logged by hand on the Money tab were not read on the last refresh, so they are not in it."
        : "Contracted value on the closer form plus deal values logged by hand with a payment on the Money tab. A hand-logged deal the closer form already has is left out, so no deal counts twice.",
  };
}

// --- Client risk ---------------------------------------------------------

/** A client still being served: churned and paused clients are not at risk, they are already gone or stopped. */
export function isLiveClient(r: ClientRow): boolean {
  return r.bucket === "active" || r.bucket === "onboarding";
}

/**
 * Clients on 5 or more risk points that are still being served. The tab badge,
 * the line under the page title, the Backend rollup and the Client success tab
 * all count them this way, so the four can never disagree.
 */
export function highRiskCount(p: ClientsPayload): number {
  return p.rows.filter(r => r.risk.level === "high" && isLiveClient(r)).length;
}

/** Clients on 3 or 4 risk points that are still being served. */
export function mediumRiskCount(p: ClientsPayload): number {
  return p.rows.filter(r => r.risk.level === "medium" && isLiveClient(r))
    .length;
}

// --- Churn this month ----------------------------------------------------

/**
 * The churn and renewal rule Aziz decided on 2026-09-16 (decisions 1 and 4),
 * in the words every card that shows a churn figure uses.
 */
export const CHURN_RULE =
  "Churn counts launched clients only, meaning the client card has a Launch Date. A launched client is churned on the day its card moves to a stopped stage, or on its term end (Launch Date plus 90 days) when no payment on Whop, Tap or logged by hand is dated after that day; that later payment is the renewal. When both apply, the earlier day counts. A client lost before launch is listed apart and is never churn. Being paused is not churn on its own, but the term keeps running during a pause, so a paused client can be churned on its term end.";

const LOST_SUB = "this month, never counted as churn";

const CHURN_NA =
  "Churn has no reading right now: the clients section was stored before the churn rule shipped, or Whop payments could not be read on the last refresh, so no client could be judged renewed or not.";

/**
 * The churn headline, the same on Backend and Client success: launched
 * clients churned this Kuwait month, the rate over launched clients on the
 * books when the month began, and whether the month is only partly covered.
 */
export type ChurnHeadline = {
  /** `clients.churn`, or null on a payload without it. */
  churn: ChurnPayload | null;
  /** Launched clients churned this month, or null when there is no reading. */
  value: number | null;
  /** Clients lost before launch this month (never churn), or null. */
  lostBeforeLaunch: number | null;
  /** Churned over launched at the start of the month, 0..1, or null. */
  rate: number | null;
  /** "September 2026", or null. */
  month: string | null;
  /**
   * True while the cockpit's own history does not cover the whole month. The
   * month counts are then a floor: a stop the history could not date is not
   * in them, so every tile that shows one says "at least".
   */
  partial: boolean;
  label: string;
  /** The rate, or why there is none, plus "at least, partial month" when it applies. */
  sub: string;
  /** The sub line for the lost before launch tile, "at least" when partial. */
  lostSub: string;
  /** The rule, and why the rate is n/a when it is. */
  hint: string;
  /** Why `value` is n/a, when it is. */
  naHint: string;
};

export function churnHeadline(
  p: ClientsPayload | null | undefined,
): ChurnHeadline {
  const churn = p?.churn ?? null;
  const label = "Churned this month";
  if (!churn)
    return {
      churn: null,
      value: null,
      lostBeforeLaunch: null,
      rate: null,
      month: null,
      partial: true,
      label,
      sub: "launched clients only",
      lostSub: LOST_SUB,
      hint: CHURN_RULE,
      naHint: CHURN_NA,
    };
  const rate =
    isNum(churn.rate) && isNum(churn.launchedAtMonthStart) ? churn.rate : null;
  const rateText =
    rate === null
      ? "rate n/a"
      : `${pct(rate)} of ${plural(churn.launchedAtMonthStart ?? 0, "launched client")} on the books on the 1st`;
  return {
    churn,
    value: churn.churnedThisMonth.length,
    lostBeforeLaunch: churn.lostBeforeLaunchThisMonth.length,
    rate,
    month: monthLabel(churn.month, { long: true, year: true }),
    partial: !churn.complete,
    label,
    sub: churn.complete ? rateText : `at least, partial month, ${rateText}`,
    lostSub: churn.complete ? LOST_SUB : `at least, partial month, ${LOST_SUB}`,
    hint:
      rate === null && churn.rateWhy
        ? `${CHURN_RULE} No rate: ${churn.rateWhy}`
        : CHURN_RULE,
    naHint: CHURN_NA,
  };
}

// --- Cost to win a customer ----------------------------------------------

/**
 * Decision 5 of 2026-09-16: cost to win a customer counts ad spend only, and
 * that stays the rule. Every tile or meter that shows it carries these words,
 * so the 1 to 4 ratio is never read as the full cost of winning a client.
 */
export const CAC_AD_SPEND_ONLY =
  "Ad spend only. The cost of the people who sell is not included.";

/**
 * Cost to win a customer, one rule for every tab: lead-gen plus retargeting
 * Meta spend in the window, divided by the deals signed in it. Retargeting is
 * in because it is money spent winning the same customers, and it is what the
 * sources plan uses ($1,077.04 for September 1 to 16). The B2B dashboard's own
 * `cac` (`FunnelWindow.cac`) leaves retargeting out, so it is not shown as this
 * metric. Retargeting comes from `raw.spend_retargeting`; a window without it
 * is n/a rather than quietly falling back to lead-gen spend alone.
 */
export const COST_TO_WIN = {
  label: "Cost to win a customer",
  /** The visible sub line. */
  sub: CAC_AD_SPEND_ONLY,
  /** The definition behind the info icon. */
  hint: `${CAC_AD_SPEND_ONLY} Spend is lead-gen plus retargeting Meta ad spend in the window, divided by the deals signed in it. The B2B dashboard's own figure leaves retargeting out, so it reads lower.`,
  of(w: FunnelWindow): { value: number | null; naHint?: string } {
    const retargeting = w.raw.spend_retargeting;
    if (typeof retargeting !== "number" || !Number.isFinite(retargeting))
      return {
        value: null,
        naHint:
          "The B2B window function gave no retargeting spend for this window, so lead-gen plus retargeting spend cannot be added up.",
      };
    if (w.closes <= 0)
      return {
        value: null,
        naHint:
          "No deals were signed in this window, so there is no cost to win.",
      };
    return { value: (w.spend + retargeting) / w.closes };
  },
} as const;

// --- Demo show rate ------------------------------------------------------

/** Points apart at which the dashboard and marked show rates are said to disagree. */
const SHOW_RATES_SPLIT = 0.15;

/**
 * The two demo show rates, one set of words for every tab that shows them.
 *
 * The B2B dashboard's rate is demos shown over demos due, where a past call
 * still marked confirmed and a call marked invalid both count as shown, and a
 * cancelled call stays in the demos due. The marked rate uses only calls
 * marked showed, invalid or no-show. A marked rate of 0 can only come from
 * marked calls that were all no-shows (nothing marked is null, not 0), and
 * the dashboard rate can only sit well above the marked one when past calls
 * nobody marked are being counted as shows, so both lines are facts, not
 * guesses. Checked against the B2B calls table on 2026-09-16: September 1 to
 * 16 had 16 demos due, 4 marked no-show, none marked showed or invalid, 10
 * past calls still marked confirmed and 2 cancelled.
 */
export const SHOW_RATE = {
  dashboardLabel: "Show rate, dashboard rule",
  dashboardHint:
    "The B2B dashboard's rule: demos shown over demos due. A past call still marked confirmed counts as a show, a call marked invalid counts as a show, and a cancelled call stays in the demos due.",
  markedLabel: "Show rate, marked outcomes only",
  markedHint:
    "The stricter rule: only calls with a recorded outcome, which is showed, invalid or no-show. Invalid counts as shown, because the call did happen. A call nobody marked is left out instead of counted as a show, and a cancelled call is left out too.",
  /** The sub line under the dashboard rate, when the marked outcomes say it is too generous. */
  dashboardSub(w: FunnelWindow): string | undefined {
    const strict = w.demoShowRateMarked;
    const dash = w.demoShowRate;
    if (strict === null || dash === null) return undefined;
    if (dash - strict >= SHOW_RATES_SPLIT || (strict === 0 && dash > 0))
      return "Likely too high: past demos nobody marked count as shows here.";
    return undefined;
  },
  /** The sub line under the marked rate, when it sits far under the dashboard's. */
  markedSub(w: FunnelWindow): string | undefined {
    const strict = w.demoShowRateMarked;
    const dash = w.demoShowRate;
    if (strict === null) return undefined;
    if (strict === 0)
      return dash !== null && dash > 0
        ? "Real, not a fault: every demo with an outcome marked in this window was a no-show. The dashboard rate is higher because it counts past demos nobody marked as shows."
        : "Real, not a fault: every demo with an outcome marked in this window was a no-show.";
    if (dash !== null && dash - strict >= SHOW_RATES_SPLIT)
      return "Well under the dashboard rate, which counts past demos nobody marked as shows.";
    return undefined;
  },
} as const;

/**
 * The close rate as the B2B dashboard computes it (`close_rate`): deals signed
 * over the demos it counts as shown, minus the calls marked invalid, in the
 * same window. Signed and shown are dated by different events, so it can pass
 * 100%.
 */
export const CLOSE_RATE = {
  hint: "Deals signed over the demos counted as shown in the same window, leaving out calls marked invalid, as the B2B dashboard computes it. A deal can be signed after the window its demo sat in, so this can pass 100%.",
  naHint:
    "No demo in this window counts as shown once calls marked invalid are left out.",
} as const;
