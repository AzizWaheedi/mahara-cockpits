import { useCallback, useMemo, useState } from "react";
import type { FunnelWindow, GrowthDay } from "../../../convex/ceo/payloads";
import {
  type CustomRange,
  type RangeKey,
  rangeEnd,
  rangeStart,
} from "./chartKit";

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
      kickoff: null,
      total: deposit,
      deals: closes,
      dealsConfirmed: 0,
      confirmed: 0,
      confirmedShare: null,
    },
    cac: closes > 0 ? r2(spend / closes) : null,
    roas: spend > 0 ? r2(contracted / spend) : null,
    roasCash: spend > 0 ? r2(deposit / spend) : null,
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

/** True when the daily rows carry the per-stage counts a timeframe window needs. */
export function dailyHasStages(days: GrowthDay[]): boolean {
  return days.length > 0 && typeof days[days.length - 1].introsDue === "number";
}
