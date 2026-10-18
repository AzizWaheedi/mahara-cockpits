import { useCallback, useMemo, useState } from "react";
import type { FunnelWindow, GrowthDay } from "@/types/ceo/payloads";
import {
  type CustomRange,
  type RangeKey,
  rangeEnd,
  rangeStart,
} from "./chartKit";
import { dateTime, isNum, money, shortDate } from "./format";

/**
 * One timeframe for a whole tab (Aziz, 2026-09-21: "any number with a time
 * dimension gets the same timeframe control as the charts"). The choice is
 * kept in the URL (?range=30d, or ?range=custom&from=...&to=...) so a link
 * carries it, and every tile on the tab is rebuilt from the daily series for
 * exactly those days.
 */

const RANGE_KEYS: RangeKey[] = [
  "7d",
  "30d",
  "mtd",
  "lastMonth",
  "90d",
  "6m",
  "12m",
  "all",
  "custom",
];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function readParams(): { range: RangeKey; custom: CustomRange } {
  if (typeof window === "undefined")
    return { range: "30d", custom: { from: "", to: "" } };
  const p = new URLSearchParams(window.location.search);
  const r = p.get("range") as RangeKey | null;
  const range = r && RANGE_KEYS.includes(r) ? r : "30d";
  const from = p.get("from") ?? "";
  const to = p.get("to") ?? "";
  return {
    range,
    custom: { from: DAY.test(from) ? from : "", to: DAY.test(to) ? to : "" },
  };
}

function writeParams(range: RangeKey, custom: CustomRange) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("range", range);
  if (range === "custom") {
    if (custom.from) url.searchParams.set("from", custom.from);
    else url.searchParams.delete("from");
    if (custom.to) url.searchParams.set("to", custom.to);
    else url.searchParams.delete("to");
  } else {
    url.searchParams.delete("from");
    url.searchParams.delete("to");
  }
  window.history.replaceState(window.history.state, "", url);
}

export type Timeframe = {
  range: RangeKey;
  setRange: (r: RangeKey) => void;
  custom: CustomRange;
  setCustom: (c: CustomRange) => void;
  /** The inclusive days the timeframe covers, given the newest complete day; null while a custom date is missing. */
  bounds: (
    last: string,
    first?: string | null,
  ) => { from: string; to: string } | null;
};

/** The tab's timeframe, read from and written to the URL. */
export function useTimeframe(initial: RangeKey = "30d"): Timeframe {
  const [state, setState] = useState(() => {
    const p = readParams();
    return {
      range:
        p.range === "30d" && !window.location.search.includes("range=")
          ? initial
          : p.range,
      custom: p.custom,
    };
  });
  const setRange = useCallback((range: RangeKey) => {
    setState(s => {
      writeParams(range, s.custom);
      return { ...s, range };
    });
  }, []);
  const setCustom = useCallback((custom: CustomRange) => {
    setState(s => {
      writeParams(s.range, custom);
      return { ...s, custom };
    });
  }, []);
  const bounds = useCallback(
    (last: string, first?: string | null) => {
      if (state.range === "custom") {
        if (!DAY.test(state.custom.from) || !DAY.test(state.custom.to))
          return null;
        return state.custom.from <= state.custom.to
          ? { from: state.custom.from, to: state.custom.to }
          : null;
      }
      const from = rangeStart(state.range, last) ?? first ?? last;
      const to = rangeEnd(state.range, last) ?? last;
      return { from, to };
    },
    [state.range, state.custom],
  );
  return useMemo(
    () => ({
      range: state.range,
      setRange,
      custom: state.custom,
      setCustom,
      bounds,
    }),
    [state, setRange, setCustom, bounds],
  );
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const share = (a: number, b: number, places = 3) =>
  b > 0 ? Math.round((a / b) * 10 ** places) / 10 ** places : null;

/**
 * A growth window for any run of days, from the daily series: every count is
 * a sum of days, every rate a quotient of sums, with the same rules as the
 * server's fixed windows. Speed to lead is the mean minutes over the leads
 * called (the median cannot be added up from days). `raw` carries the
 * dashboard-style keys the screens read.
 */
export function windowFromDaily(
  days: GrowthDay[],
  from: string,
  to: string,
): FunnelWindow {
  const rows = days.filter(d => d.date >= from && d.date <= to);
  const sum = (pick: (d: GrowthDay) => number | undefined) =>
    rows.reduce((t, d) => t + (pick(d) ?? 0), 0);
  const spend = r2(sum(d => d.spend));
  const spendRt = r2(sum(d => d.spendRetargeting));
  const leads = sum(d => d.leads);
  const qualified = sum(d => d.qualified);
  const unqualified = sum(d => d.unqualified);
  const bookedLeads = sum(d => d.bookedLeads);
  const called = sum(d => d.spCalled);
  const spMinutes = sum(d => d.spMinutes);
  const within5 = sum(d => d.spWithin5);
  const introsBooked = sum(d => d.introsBooked);
  const demosBooked = sum(d => d.demosBooked);
  const introsDue = sum(d => d.introsDue);
  const demosDue = sum(d => d.demosDue);
  const introsShown = sum(d => d.introsShown);
  const demosShown = sum(d => d.demosShown);
  const demosQualified = sum(d => d.demosQualified);
  const introsScheduled = sum(d => d.introsScheduled);
  const demosScheduled = sum(d => d.demosScheduled);
  const introsCancelled = sum(d => d.introsCancelled);
  const demosCancelled = sum(d => d.demosCancelled);
  const closes = sum(d => d.closes);
  const contracted = r2(sum(d => d.contracted));
  // Typed on the forms: shown beside front-end cash, never added to it.
  const deposit = r2(sum(d => d.deposit));
  // Kickoff cash is read only for days the worker read the form (from
  // 4 Oct 2026); a window with no such day says "not read", never $0.
  const kickoffDays = rows.filter(d => isNum(d.kickoff));
  const kickoff = kickoffDays.length ? r2(sum(d => d.kickoff ?? 0)) : null;
  const kickoffConfirmed =
    kickoff === null ? undefined : r2(sum(d => d.kickoffConfirmed ?? 0));
  // Front-end cash is the money paid on signed deals by the day it arrived
  // (MONEY-ATTRIBUTION.md rule 6). A day the deal ledger does not cover is
  // null, so a window with no such day is not read, never $0; one that starts
  // before the ledger says from which day it counts.
  const paidDays = rows.filter(d => isNum(d.frontEndPaid));
  const paid = paidDays.length ? r2(sum(d => d.frontEndPaid ?? 0)) : null;
  const fe: FunnelWindow["frontEndCash"] = {
    deposit,
    kickoff,
    total: paid,
    deals: closes,
    // Which deposit a rail backs needs the server's deal join; not kept per day.
    dealsConfirmed: 0,
    confirmed: 0,
    confirmedShare: null,
    kickoffConfirmed,
    kickoffConfirmedShare:
      kickoff === null || kickoffConfirmed === undefined
        ? null
        : share(kickoffConfirmed, kickoff),
    paid,
    // The split by kind, by rail and by closer is not kept per day.
    paidDeposit: null,
    paidRemainder: null,
    byRail: null,
    byCloser: null,
    typed: { deposit, kickoff },
    typedNotSeen: null,
    attributedAt: null,
    paidFrom:
      paid !== null && paidDays.length < rows.length ? paidDays[0].date : null,
  };
  return {
    from,
    to,
    spend,
    leads,
    cpl: leads > 0 ? r2(spend / leads) : null,
    leadClasses: {
      qualified,
      unqualified,
      notReady: sum(d => d.notReady),
      untagged: sum(d => d.untagged),
    },
    sources: {
      ads: sum(d => d.srcAds),
      organic: sum(d => d.srcOrganic),
      assumedAds: sum(d => d.srcAssumed),
    },
    speedToLead: {
      leads,
      called,
      neverCalled: Math.max(0, leads - called),
      medianMin: called > 0 ? Math.round((spMinutes / called) * 10) / 10 : null,
      within5Share: share(within5, called),
    },
    leadToBooked: { bookedLeads, rate: share(bookedLeads, leads) },
    introsBooked,
    introsShown,
    introsDue,
    demosBooked,
    demosShown,
    demosDue,
    demoShowRate: share(demosShown, demosDue),
    introShowRate: share(introsShown, introsDue),
    // Intro to demo needs the contact join the server does; not derivable from days.
    introToDemo: null,
    demosStillConfirmed: 0,
    cancel: {
      intro: share(introsCancelled, introsScheduled),
      demo: share(demosCancelled, demosScheduled),
      total: share(
        introsCancelled + demosCancelled,
        introsScheduled + demosScheduled,
      ),
      introsCancelled,
      introsScheduled,
      demosCancelled,
      demosScheduled,
    },
    costPerDemo: demosShown > 0 ? r2(spend / demosShown) : null,
    costPerDemoBooked: demosBooked > 0 ? r2(spend / demosBooked) : null,
    closes,
    closeRate: share(closes, demosShown),
    qualifiedCloseRate: share(closes, demosQualified),
    contracted,
    cash: deposit,
    frontEndCash: fe,
    cac: closes > 0 ? r2(spend / closes) : null,
    roas: spend > 0 ? r2(contracted / spend) : null,
    roasCash: paid !== null && spend > 0 ? r2(paid / spend) : null,
    roasContracted: spend > 0 ? r2(contracted / spend) : null,
    raw: {
      spend,
      spend_retargeting: spendRt,
      intros_shown: introsShown,
      intros_due: introsDue,
      demos_due: demosDue,
      demos_shown: demosShown,
      demos_qualified: demosQualified,
      intros_scheduled: introsScheduled,
      demos_scheduled: demosScheduled,
      intros_cancelled: introsCancelled,
      demos_cancelled: demosCancelled,
    },
  };
}

/**
 * A window's front-end cash as the growth section publishes it since
 * 2026-10-18 (docs/money/MONEY-ATTRIBUTION.md rule 6, growth.js withPaid):
 * `paid` is the money, null when the deal ledger was not read (never zero);
 * `typed` is what the forms say, shown beside it and never added. A payload
 * stored before has none of the paid keys, so its money is not read.
 */
export function frontEndOf(
  w: Pick<FunnelWindow, "frontEndCash">,
): FunnelWindow["frontEndCash"] {
  return w.frontEndCash;
}

/** Paid front-end cash, or null when it was not read (a payload from before 2026-10-18 included). */
export function paidFrontEnd(
  w: Pick<FunnelWindow, "frontEndCash"> | null | undefined,
): number | null {
  if (!w) return null;
  const fe = frontEndOf(w);
  return isNum(fe.paid) ? fe.paid : null;
}

/** When the money behind a growth payload was attributed: any window carries it. */
export function attributedAtOf(
  windows:
    | Record<string, Pick<FunnelWindow, "frontEndCash">>
    | null
    | undefined,
): number | null {
  for (const w of Object.values(windows ?? {})) {
    const at = w ? frontEndOf(w).attributedAt : null;
    if (isNum(at)) return at;
  }
  return null;
}

/** Over this, the tile says front-end cash may be behind (the money refresh has not published since). */
export const ATTRIBUTED_STALE_MS = 2 * 60 * 60_000;

/** "attributed 09:40", or "attributed Sat 17 Oct, 06:10, over 2 hours ago: may be behind". */
export function attributedLine(
  at: number | null | undefined,
  now: number,
): { text: string; stale: boolean } | null {
  if (!isNum(at)) return null;
  const stale = now - at > ATTRIBUTED_STALE_MS;
  return {
    text: stale
      ? `attributed ${dateTime(at, now)}, over 2 hours ago: may be behind`
      : `attributed ${dateTime(at, now)}`,
    stale,
  };
}

/** The hint on every front-end cash tile. */
export const FRONT_END_CASH_HINT =
  "Money paid on signed deals: every payment the Money tab credits to a deal's closer, from 7 days before the closer form until the deal's tied cash reaches its contract, at most 120 days after signing, on Whop, Tap, a bank transfer or logged by hand, counted on the day it arrived. Webinar deals are left out. The deposit the closer typed on the form and the Payment Amount on the kickoff form are shown beside it as typed, not money, and never added.";

/** Why a tile reads n/a: the money has not been attributed into the deal ledger this run. */
export const FRONT_END_CASH_NA =
  "Not read yet: front-end cash is the money paid on signed deals, and it shows once the money refresh has published the deal ledger.";

/** The first day the CSM's kickoff form carries "Payment Amount" (Typeform tG7dnxBn). */
export const KICKOFF_READ_FROM = "2026-10-04";

/**
 * The line beside a front-end cash figure (Aziz, 2026-10-18): what the forms
 * say, as typed, not money: "typed, not money: deposit $6,000 · kickoff
 * $1,500". The kickoff part says when the form was not read for the window.
 */
export function frontEndCashSub(
  fe: FunnelWindow["frontEndCash"],
  from?: string | null,
): string {
  const typed = fe.typed ?? {
    deposit: fe.deposit,
    kickoff: fe.kickoff,
  };
  const kickoff = isNum(typed.kickoff)
    ? `kickoff ${money(typed.kickoff)}`
    : `kickoff read from ${shortDate(KICKOFF_READ_FROM)}`;
  const late =
    isNum(typed.kickoff) && from && from < KICKOFF_READ_FROM
      ? ` (read from ${shortDate(KICKOFF_READ_FROM)})`
      : "";
  return `typed, not money: deposit ${money(typed.deposit)} · ${kickoff}${late}`;
}

/** What the paid figure is made of: "deposits $4,000 · rest $10,358.80", or null when not split. */
export function paidSplit(fe: FunnelWindow["frontEndCash"]): string | null {
  if (!isNum(fe.paidDeposit) || !isNum(fe.paidRemainder)) return null;
  return `deposits ${money(fe.paidDeposit)} · rest of the deals ${money(fe.paidRemainder)}`;
}

/** Typed amounts no payment matches, listed and never added: "$3,000 on 2 deals". */
export function typedNotSeenText(fe: FunnelWindow["frontEndCash"]): {
  value: string;
  hint: string;
} | null {
  const t = fe.typedNotSeen;
  if (!t) return null;
  if (!t.count)
    return {
      value: "none",
      hint: "Every typed deposit and kickoff amount in this window has money matched to it.",
    };
  const items = t.items
    .slice(0, 5)
    .map(
      i =>
        `${i.business ?? "a deal"}, ${i.kind === "kickoff" ? "kickoff" : "deposit"} typed ${money(i.typed)} on ${shortDate(i.day)}, ${money(i.seen)} seen`,
    );
  return {
    value: `${money(t.usd)} on ${t.count === 1 ? "1 form" : `${t.count} forms`}`,
    hint: `Typed on the forms with no payment seen for it yet: ${items.join("; ")}${t.count > items.length ? `; and ${t.count - items.length} more` : ""}. Listed, never added to front-end cash.`,
  };
}

/** True when the daily rows carry the per-stage counts a timeframe window needs. */
export function dailyHasStages(days: GrowthDay[]): boolean {
  return days.length > 0 && typeof days[days.length - 1].introsDue === "number";
}
