import { useCallback, useMemo, useState } from "react";
import type { FunnelWindow, GrowthDay } from "@/types/ceo/payloads";
import {
  type CustomRange,
  type RangeKey,
  rangeEnd,
  rangeStart,
} from "./chartKit";
import { isNum, money, pct } from "./format";

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
  const deposit = r2(sum(d => d.deposit));
  // Kickoff cash is read only for days the worker read the form (from
  // 4 Oct 2026); a window with no such day says "not read", never $0.
  const kickoffDays = rows.filter(d => isNum(d.kickoff));
  const kickoff = kickoffDays.length ? r2(sum(d => d.kickoff ?? 0)) : null;
  const kickoffConfirmed =
    kickoff === null ? undefined : r2(sum(d => d.kickoffConfirmed ?? 0));
  const frontEnd = r2(deposit + (kickoff ?? 0));
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
    frontEndCash: {
      deposit,
      kickoff,
      total: frontEnd,
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
    },
    cac: closes > 0 ? r2(spend / closes) : null,
    roas: spend > 0 ? r2(contracted / spend) : null,
    roasCash: spend > 0 ? r2(frontEnd / spend) : null,
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

/** The hint on every front-end cash tile. */
export const FRONT_END_CASH_HINT =
  "The deposit the closer typed at signing, for deals signed in this window, plus the kickoff cash the CSM collects on the onboarding call: the Payment Amount on the kickoff form, dated by the day the form was sent, read from 4 Oct 2026 and taken as USD because the form has no currency. Confirmed means a payment on a rail (Tap, Whop, a bank line or a transfer) attributed to the same deal or card backs it; an unconfirmed kickoff still counts.";

/** The first day the CSM's kickoff form carries "Payment Amount" (Typeform tG7dnxBn). */
export const KICKOFF_READ_FROM = "2026-10-04";

/**
 * The line under a front-end cash figure (Aziz, 2026-09-21: "deposit +
 * kickoff cash, confirmed against the rails"): "deposit $X + kickoff $Y,
 * Z% confirmed on a rail". The share is said only when both parts' backing
 * is known (a window rebuilt from days does not keep which deposit a rail
 * backs); a window that starts before the form carried the amount says so.
 */
export function frontEndCashSub(
  fe: FunnelWindow["frontEndCash"],
  from?: string | null,
): string {
  const kickoffRead = isNum(fe.kickoff);
  const head = kickoffRead
    ? `deposit ${money(fe.deposit)} + kickoff ${money(fe.kickoff)}`
    : `deposit ${money(fe.deposit)}`;
  const depositKnown = fe.deposit === 0 || isNum(fe.confirmedShare);
  const kickoffKnown =
    !kickoffRead || fe.kickoff === 0 || isNum(fe.kickoffConfirmed);
  const backed = fe.confirmed + (kickoffRead ? (fe.kickoffConfirmed ?? 0) : 0);
  let confirmed: string | null = null;
  if (fe.total > 0 && depositKnown && kickoffKnown)
    confirmed = `${pct(backed / fe.total)} confirmed on a rail`;
  else if (
    kickoffRead &&
    (fe.kickoff ?? 0) > 0 &&
    isNum(fe.kickoffConfirmedShare)
  )
    confirmed = `${pct(fe.kickoffConfirmedShare)} of the kickoff confirmed on a rail`;
  else if (fe.deposit > 0 && isNum(fe.confirmedShare))
    confirmed = `${pct(fe.confirmedShare)} of the deposit confirmed on a rail`;
  const before =
    !kickoffRead || (from ? from < KICKOFF_READ_FROM : false)
      ? "kickoff read from 4 Oct"
      : null;
  return [confirmed ? `${head}, ${confirmed}` : head, before]
    .filter(Boolean)
    .join(" · ");
}

/** True when the daily rows carry the per-stage counts a timeframe window needs. */
export function dailyHasStages(days: GrowthDay[]): boolean {
  return days.length > 0 && typeof days[days.length - 1].introsDue === "number";
}
