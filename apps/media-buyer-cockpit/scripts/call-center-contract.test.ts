import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  type CallCenterMetrics,
  type CallCenterReport,
  callCenterRange,
  parseCallCenterReport,
} from "../convex/ceo/callCenterContract";
import { projectCallCenterReports } from "../convex/ceo/callCenterProjection";
import { extractCalls } from "../convex/ceo/metricRegistry";

const metrics = (
  patch: Partial<CallCenterMetrics> = {},
): CallCenterMetrics => ({
  dials: 0,
  providerDials: 0,
  connections: 0,
  talkSeconds: 0,
  leads: 0,
  leadsDialed: 0,
  leadsContacted: 0,
  noVerifiedDial: 0,
  confirmedBookings: 0,
  provisionalBookings: 0,
  unclassifiedBookings: 0,
  shows: 0,
  noShow: 0,
  closed: 0,
  values: [],
  showRate: null,
  closeRate: null,
  connectionRate: null,
  avgSpeedSeconds: null,
  medianSpeedSeconds: null,
  speedSamples: 0,
  withinTwoMinutes: 0,
  withinTwoMinutesRate: null,
  avgCallGapSeconds: null,
  callGapSamples: 0,
  ...patch,
});
const report = (
  from = "2026-09-18",
  patch: Partial<CallCenterReport> = {},
): CallCenterReport => ({
  version: 1,
  generatedAt: "2026-09-24T10:00:00Z",
  timezone: "Asia/Kuwait",
  from,
  to: "2026-09-24",
  overall: metrics(),
  callers: [],
  clients: [],
  daily: [],
  coverage: { source: "synthetic" },
  warnings: [],
  ...patch,
});

describe("canonical report boundary", () => {
  test("preserves null rates and real zeros without recalculating", () => {
    const data = report();
    expect(parseCallCenterReport(data, data.from, data.to)).toBe(data);
    expect(data.overall.showRate).toBeNull();
    expect(data.overall.dials).toBe(0);
  });
  test("rejects invalid or unbounded date ranges before source reads", () => {
    expect(callCenterRange("2026-07-01", "2026-10-01")).toEqual({
      from: "2026-07-01",
      to: "2026-10-01",
    });
    for (const [a, b] of [
      ["2026-07-01", "2026-10-02"],
      ["2026-02-30", "2026-03-01"],
      ["2026-09-25", "2026-09-24"],
      ["x", "2026-09-24"],
    ])
      expect(() => callCenterRange(a, b)).toThrow();
  });
  test("fails closed for missing metrics, version changes and wrong report windows", () => {
    const data = report();
    const missing = JSON.parse(JSON.stringify(data));
    delete missing.overall.leadsContacted;
    for (const raw of [
      missing,
      { ...data, version: 2 },
      { ...data, from: "2026-09-17" },
      { ...data, overall: { ...data.overall, dials: "0" } },
    ])
      expect(() => parseCallCenterReport(raw, data.from, data.to)).toThrow();
  });
  test("rejects nonfinite rates and days outside the requested cohort", () => {
    const data = report();
    expect(() =>
      parseCallCenterReport(
        { ...data, overall: metrics({ showRate: NaN }) },
        data.from,
        data.to,
      ),
    ).toThrow();
    expect(() =>
      parseCallCenterReport(
        { ...data, daily: [{ day: "2026-09-17", ...metrics() }] },
        data.from,
        data.to,
      ),
    ).toThrow();
  });
});

test("unattributed identities, unknown currency and reconciliation stay explicit", () => {
  const data = report("2026-09-18", {
    callers: [{ ...metrics(), email: null, name: "Unattributed" }],
    overall: metrics({ values: [{ currency: null, value: 3.125 }] }),
    reconciliation: {
      total: 2,
      byReason: [{ reason: "missing_phone", count: 2 }],
      items: [],
      backfill: { pending: 2, completed: 0, lastSuccess: null, error: null },
    },
  });
  const result = parseCallCenterReport(data, data.from, data.to);
  expect(result.callers[0].email).toBeNull();
  expect(result.overall.values[0]).toEqual({ currency: null, value: 3.125 });
  expect(result.reconciliation).toBe(data.reconciliation);
});

describe("CEO projection uses the shared calculations", () => {
  const month = report("2026-08-26", {
    overall: metrics({ dials: 70, providerDials: 35, connections: 14 }),
    daily: [
      {
        day: "2026-09-15",
        ...metrics({
          dials: 8,
          providerDials: 5,
          connections: 2,
          talkSeconds: 200,
        }),
      },
      {
        day: "2026-09-23",
        ...metrics({
          dials: 4,
          providerDials: 2,
          connections: 1,
          talkSeconds: 100,
        }),
      },
      {
        day: "2026-09-24",
        ...metrics({
          dials: 9,
          providerDials: 4,
          connections: 2,
          talkSeconds: 300,
        }),
      },
    ],
  });
  const week = report("2026-09-18", {
    overall: metrics({
      dials: 20,
      providerDials: 10,
      connections: 4,
      leads: 30,
      leadsDialed: 11,
      speedSamples: 7,
      medianSpeedSeconds: 87,
      withinTwoMinutesRate: 0.1,
      confirmedBookings: 6,
      provisionalBookings: 3,
      shows: 4,
      noShow: 1,
      showRate: 0.8,
    }),
    callers: [
      {
        email: "caller-one@example.invalid",
        name: "Same name",
        ...metrics({ dials: 7, leads: 3 }),
      },
      {
        email: "caller-two@example.invalid",
        name: "Same name",
        ...metrics({ dials: 9, leads: 5 }),
      },
      { email: null, name: "Unassigned", ...metrics({ leads: 22 }) },
    ],
    clients: [
      {
        id: "fixture-location",
        name: "Fictional client",
        ...metrics({
          confirmedBookings: 6,
          provisionalBookings: 3,
          values: [
            { currency: "KWD", value: 800 },
            { currency: "SAR", value: 900 },
          ],
        }),
      },
    ],
  });
  test("keeps disposition dials separate from provider connection rate", () => {
    const p = projectCallCenterReports(month, week);
    expect(p.today.dials).toBe(9);
    expect(p.today.providerDials).toBe(4);
    expect(p.today.connectRate).toBe(0.5);
    expect(p.today.conversations90s).toBeNull();
    expect(p.prevLast7.dials).toBe(8);
  });
  test("uses exact range medians and cohort counts rather than combining daily summaries", () => {
    const p = projectCallCenterReports(month, week);
    expect(p.report7d).toBe(week);
    expect(p.speedToLead.workingMedianMinutes7d).toBe(87 / 60);
    expect(p.speedToLead.withinTwoMinutesRate7d).toBe(0.1);
    expect(p.speedToLead.within5minShare7d).toBeNull();
    expect(p.report7d?.overall.leads).toBe(30);
    expect(p.report7d?.overall.leadsDialed).toBe(11);
  });
  test("preserves calendar splits, rates and currencies verbatim", () => {
    const p = projectCallCenterReports(month, week);
    expect(p.report7d?.overall.confirmedBookings).toBe(6);
    expect(p.report7d?.overall.provisionalBookings).toBe(3);
    expect(p.report7d?.overall.showRate).toBe(0.8);
    expect(p.report7d?.clients[0].values).toEqual(week.clients[0].values);
  });
  test("uses stable caller identity and location scopes in downstream metrics", () => {
    const rows = extractCalls(projectCallCenterReports(month, week));
    expect(
      rows.find(
        r =>
          r.metric === "calls.dials" &&
          r.scope === "person:caller-one@example.invalid" &&
          r.window === "last7",
      )?.value,
    ).toBe(7);
    expect(
      rows.find(
        r =>
          r.metric === "calls.dials" &&
          r.scope === "person:caller-two@example.invalid" &&
          r.window === "last7",
      )?.value,
    ).toBe(9);
    expect(
      rows.find(
        r =>
          r.metric === "calls.leads" &&
          r.scope === "person:unassigned" &&
          r.window === "last7",
      )?.value,
    ).toBe(22);
    expect(
      rows.find(
        r =>
          r.metric === "calls.provisional_bookings" &&
          r.scope === "location:fixture-location" &&
          r.window === "last7",
      ),
    ).toMatchObject({
      value: 3,
      windowFrom: "2026-09-18",
      windowTo: "2026-09-24",
    });
  });
  test("refuses mismatched period comparisons", () => {
    expect(() =>
      projectCallCenterReports(month, { ...week, from: "2026-09-19" }),
    ).toThrow();
  });
  test("does not relabel legacy provider dials as saved dispositions", () => {
    const legacy = {
      ...projectCallCenterReports(month, week),
      report: undefined,
      report7d: undefined,
    };
    expect(extractCalls(legacy)).toEqual([]);
  });
});

test("custom range action keeps the CEO check before the privileged source read", () => {
  const source = readFileSync(
    new URL("../convex/ceo/queries.ts", import.meta.url),
    "utf8",
  );
  const action = source.slice(source.indexOf("export const callCenterReport"));
  expect(action).toContain("authenticatedAction");
  expect(action.indexOf("internal.ceo.people.gate")).toBeLessThan(
    action.indexOf("return readCallCenterReport"),
  );
});
