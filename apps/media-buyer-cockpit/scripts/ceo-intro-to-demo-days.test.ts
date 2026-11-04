/**
 * Intro to demo on any range (2026-11-02, Goals sheet round 3). Since release
 * goal1102 the growth worker publishes introsAdvanced per day, so a range the
 * CEO tabs rebuild from days (the default 30 days, two dates, 90 days ...)
 * reads sum(introsAdvanced) / sum(introsShown), as B2B's b2b_window_metrics
 * and the Goals sheet work it out. A day without the field is not read, so
 * the range reads n/a, never 0; a preset keeps the server window's own
 * figure. Every figure here is made up.
 */
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DERIVED_NOTE,
  useGrowthWindow,
} from "../src/components/ceo/growthWindow";
import { INTRO_TO_DEMO } from "../src/components/ceo/metrics";
import {
  type Timeframe,
  windowFromDaily,
} from "../src/components/ceo/timeframe";
import type {
  FunnelWindow,
  GrowthDay,
  GrowthPayload,
} from "../src/types/ceo/payloads";

const day = (date: string, over: Partial<GrowthDay> = {}): GrowthDay =>
  ({
    date,
    spend: 50,
    spendRetargeting: 5,
    leads: 2,
    booked: 1,
    closes: 0,
    introsDue: 3,
    introsShown: 2,
    introsAdvanced: 1,
    ...over,
  }) as GrowthDay;

/** 3 Oct to 1 Nov: 30 days, shown 1, 2, 3 and advanced 1, 0, 1 in turn. */
function thirtyDays(): GrowthDay[] {
  const out: GrowthDay[] = [];
  for (let i = 0; i < 30; i++) {
    const date = new Date(Date.parse("2026-10-03") + i * 86_400_000)
      .toISOString()
      .slice(0, 10);
    out.push(
      day(date, {
        introsShown: (i % 3) + 1,
        introsAdvanced: i % 3 === 1 ? 0 : 1,
      }),
    );
  }
  return out;
}

/** growth.js pct: B2B's intro_to_demo is a percent to one decimal; the window keeps it as a fraction. */
const serverPct = (percent: number) => Math.round(percent * 10) / 1000;

describe("windowFromDaily: intro to demo from days", () => {
  test("a 30-day range is the sum of intros advanced over the sum of intros shown", () => {
    const days = thirtyDays();
    const w = windowFromDaily(days, "2026-10-03", "2026-11-01");
    // 20 advanced of 60 shown.
    expect(w.introsShown).toBe(60);
    expect(w.raw.intros_advanced).toBe(20);
    expect(w.introToDemo).toBe(0.333);
    // B2B's 33.3 for the same days, as the worker stores it on a preset.
    expect(w.introToDemo).toBe(serverPct(33.3));
  });

  test("the shown figure uses the same formatter as a preset window", () => {
    const w = windowFromDaily(thirtyDays(), "2026-10-03", "2026-11-01");
    expect(INTRO_TO_DEMO.format(w.introToDemo)).toBe("33.3%");
    expect(INTRO_TO_DEMO.format(w.introToDemo)).toBe(
      INTRO_TO_DEMO.format(serverPct(33.3)),
    );
  });

  test("a range of a few days divides its own sums", () => {
    const w = windowFromDaily(
      [
        day("2026-10-10", { introsShown: 3, introsAdvanced: 2 }),
        day("2026-10-11", { introsShown: 4, introsAdvanced: 3 }),
        day("2026-10-12", { introsShown: 9, introsAdvanced: 9 }),
      ],
      "2026-10-10",
      "2026-10-11",
    );
    // 5 of 7; the 12th is outside the range.
    expect(w.introToDemo).toBe(0.714);
    expect(INTRO_TO_DEMO.format(w.introToDemo)).toBe("71.4%");
  });

  test("one day lacking the field reads n/a, never the other days alone", () => {
    const days = thirtyDays();
    days[12] = day(days[12].date, { introsAdvanced: undefined });
    const w = windowFromDaily(days, "2026-10-03", "2026-11-01");
    expect(w.introToDemo).toBeNull();
    expect(w.raw.intros_advanced).toBeNull();
    expect(INTRO_TO_DEMO.format(w.introToDemo)).toBe("n/a");
    // A null day is not read either.
    days[12] = day(days[12].date, { introsAdvanced: null });
    expect(
      windowFromDaily(days, "2026-10-03", "2026-11-01").introToDemo,
    ).toBeNull();
    // The range that leaves that day out reads again.
    expect(
      windowFromDaily(days, "2026-10-16", "2026-11-01").introToDemo,
    ).not.toBeNull();
  });

  test("a payload stored before the release is missing, never 0", () => {
    const old = thirtyDays().map(d => {
      const { introsAdvanced: _, ...rest } = d;
      return rest as GrowthDay;
    });
    const w = windowFromDaily(old, "2026-10-03", "2026-11-01");
    expect(w.introToDemo).toBeNull();
    expect(w.introsShown).toBe(60);
  });

  test("none advanced is 0%, and no intro shown is n/a", () => {
    const none = windowFromDaily(
      [day("2026-10-10", { introsShown: 4, introsAdvanced: 0 })],
      "2026-10-10",
      "2026-10-10",
    );
    expect(none.introToDemo).toBe(0);
    const noneShown = windowFromDaily(
      [day("2026-10-10", { introsShown: 0, introsAdvanced: 0 })],
      "2026-10-10",
      "2026-10-10",
    );
    expect(noneShown.introToDemo).toBeNull();
    // No day in the range at all.
    expect(
      windowFromDaily(thirtyDays(), "2026-12-01", "2026-12-31").introToDemo,
    ).toBeNull();
  });

  test("the rebuilt window says paid on window deals is not kept per day", () => {
    const w = windowFromDaily(thirtyDays(), "2026-10-03", "2026-11-01");
    expect(w.frontEndCash.paidOnWindowDeals).toBeNull();
  });
});

describe("useGrowthWindow: the default range shows intro to demo", () => {
  const MTD = {
    from: "2026-11-01",
    to: "2026-11-02",
    introToDemo: 0.75,
  } as unknown as FunnelWindow;
  const payload = {
    windows: { mtd: MTD },
    daily: thirtyDays(),
  } as unknown as GrowthPayload;
  const tf = (
    range: Timeframe["range"],
    from: string,
    to: string,
  ): Timeframe => ({
    range,
    setRange: () => {},
    custom: { from: "", to: "" },
    setCustom: () => {},
    bounds: () => ({ from, to }),
  });
  function read(t: Timeframe) {
    let out: ReturnType<typeof useGrowthWindow> | null = null;
    function Probe() {
      out = useGrowthWindow(payload, t, "2026-11-02");
      return null;
    }
    renderToStaticMarkup(createElement(Probe));
    if (!out) throw new Error("useGrowthWindow did not run");
    return out as ReturnType<typeof useGrowthWindow>;
  }

  test("30 days is rebuilt from days and carries intro to demo", () => {
    const gw = read(tf("30d", "2026-10-03", "2026-11-01"));
    expect(gw.derived).toBe(true);
    expect(gw.current?.introToDemo).toBe(0.333);
  });

  test("a preset keeps the server window's own figure", () => {
    const gw = read(tf("mtd", "2026-11-01", "2026-11-01"));
    expect(gw.derived).toBe(false);
    expect(gw.current).toBe(MTD);
    expect(gw.current?.introToDemo).toBe(0.75);
  });

  test("the note under a rebuilt range no longer says intro to demo is missing", () => {
    expect(DERIVED_NOTE).not.toMatch(/not available/);
    expect(DERIVED_NOTE).toContain("intro to demo included");
  });
});
