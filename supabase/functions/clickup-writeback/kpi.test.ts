import { describe, expect, it } from "bun:test";
import { GOLDEN } from "./convexGolden";
import { dropdownLabel, type KpiInputs, planKpi, sevenDay } from "./kpi";
import { FIELD, kpiBand } from "./rules";

const NOW = Date.parse("2026-10-09T09:00:00Z");
const options = (prefix: string) =>
  ["Above KPI", "At KPI", "Below KPI", "911"].map((name, i) => ({ id: `${prefix}${i}`, name, orderindex: i }));
const FIELDS = [
  { id: FIELD.cplStatus, type_config: { options: options("cpl-") } },
  { id: FIELD.cpbStatus, type_config: { options: options("cpb-") } },
];
const task = (id: string, values: Record<string, unknown> = {}) => ({
  id,
  name: `Card ${id}`,
  custom_fields: Object.entries(values).map(([fid, value]) => ({
    id: fid,
    value,
    type_config: fid === FIELD.cplStatus ? { options: options("cpl-") } : fid === FIELD.cpbStatus ? { options: options("cpb-") } : {},
  })),
});
const daily = (campaignName: string, rows: [string, number, number][]) => rows.map(([day, spend, leads]) => ({ campaignName, day, spend, leads }));
const inputs = (over: Partial<KpiInputs> = {}): KpiInputs => ({
  campaigns: [],
  daily: [],
  bookings: [],
  dailyReady: true,
  bookingsReady: true,
  latestPublishAt: new Date(NOW - 20 * 60_000).toISOString(),
  latestSyncedAt: null,
  ...over,
});
// The Convex window fixture: one row outside 30 days, one before the 7-day start, one dated tomorrow.
const WINDOW_ROWS: [string, number, number][] = [
  ["2026-09-01", 100, 10], ["2026-10-01", 7, 1], ["2026-10-02", 20, 2], ["2026-10-03", 30, 1], ["2026-10-09", 12.5, 1], ["2026-10-10", 5, 0],
];

describe("the 7-day CPL formula matches convex/sync.ts", () => {
  it("sums the same window at every Kuwait-day boundary", () => {
    for (const w of GOLDEN.cplWindow) {
      const s = sevenDay(daily("A", WINDOW_ROWS), ["A"], w.since7);
      expect(s.spend).toBe(w.spend);
      expect(s.leads).toBe(w.leads);
      expect(s.leads > 0 ? s.spend / s.leads : null).toBe(w.cpl);
    }
  });
  it("reads dropdown values given as option id or orderindex", () => {
    const f = { value: 2, type_config: { options: options("x-") } };
    expect(dropdownLabel(f)).toBe("Below KPI");
    expect(dropdownLabel({ ...f, value: "x-0" })).toBe("Above KPI");
    expect(dropdownLabel({ ...f, value: null })).toBeUndefined();
  });
});

describe("board KPI plan", () => {
  const one = { campaignName: "A", clientName: "Client A", taskId: "t1", internal: false, spend7d: 67.5, leads7d: 4, cpl: 16.875 };

  it("writes CPL, its band and Last Updated when both sources agree", () => {
    const plan = planKpi(inputs({ campaigns: [one], daily: daily("A", WINDOW_ROWS) }), [task("t1", { [FIELD.cpl7d]: "12.00", [FIELD.cplStatus]: 0 })], FIELDS, NOW);
    expect(plan.refused).toBeUndefined();
    const card = plan.cards[0];
    expect(card.skipped).toBeUndefined();
    const byField = Object.fromEntries(card.writes.map(w => [w.fieldId, w]));
    expect(byField[FIELD.cpl7d]).toMatchObject({ old: 12, new: 16.88, value: 16.88, changed: true });
    expect(byField[FIELD.cplStatus]).toMatchObject({ old: "Above KPI", new: kpiBand(16.875, 15), value: "cpl-2", changed: true });
    expect(byField[FIELD.lastUpdated]).toMatchObject({ value: NOW, changed: true });
    // Last Updated is written last, after the numbers it vouches for.
    expect(card.writes.at(-1)?.fieldId).toBe(FIELD.lastUpdated);
  });

  it("marks unchanged values so a live run does not rewrite them", () => {
    const plan = planKpi(inputs({ campaigns: [one], daily: daily("A", WINDOW_ROWS) }), [task("t1", { [FIELD.cpl7d]: 16.88, [FIELD.cplStatus]: "cpl-2" })], FIELDS, NOW);
    const byField = Object.fromEntries(plan.cards[0].writes.map(w => [w.fieldId, w]));
    expect(byField[FIELD.cpl7d].changed).toBe(false);
    expect(byField[FIELD.cplStatus].changed).toBe(false);
  });

  it("skips a card whose campaign row and daily ledger disagree, and writes nothing to it", () => {
    const plan = planKpi(inputs({ campaigns: [{ ...one, spend7d: 90 }], daily: daily("A", WINDOW_ROWS) }), [task("t1")], FIELDS, NOW);
    expect(plan.cards[0].writes).toEqual([]);
    expect(plan.cards[0].skipped).toContain("$90.00");
    expect(plan.cards[0].skipped).toContain("$67.50");
  });

  it("leaves Mahara's own account and cardless campaigns off the board, like boardCampaigns", () => {
    const plan = planKpi(
      inputs({ campaigns: [one, { ...one, campaignName: "Own", taskId: "t2", internal: true }, { ...one, campaignName: "NoCard", taskId: null }], daily: daily("A", WINDOW_ROWS) }),
      [task("t1"), task("t2")],
      FIELDS,
      NOW,
    );
    expect(plan.cards.map(c => c.taskId)).toEqual(["t1"]);
  });

  it("refuses to write when the ledger is missing or the numbers are stale: missing is never zero", () => {
    expect(planKpi(inputs({ dailyReady: false, campaigns: [one] }), [task("t1")], FIELDS, NOW).refused).toContain("not imported");
    expect(planKpi(inputs({ latestPublishAt: new Date(NOW - 4 * 3600_000).toISOString(), campaigns: [one] }), [task("t1")], FIELDS, NOW).refused).toContain("minutes ago");
    expect(planKpi(inputs({ latestPublishAt: null, campaigns: [one] }), [task("t1")], FIELDS, NOW).refused).toContain("no record");
  });

  it("combines campaigns that share one card", () => {
    const b = { campaignName: "B", clientName: "Client A", taskId: "t1", internal: false, spend7d: 30, leads7d: 1, cpl: 30 };
    const plan = planKpi(inputs({ campaigns: [one, b], daily: [...daily("A", WINDOW_ROWS), ...daily("B", [["2026-10-05", 30, 1]])] }), [task("t1")], FIELDS, NOW);
    const cpl = plan.cards[0].writes.find(w => w.fieldId === FIELD.cpl7d);
    expect(cpl?.value).toBe(Number((97.5 / 5).toFixed(2)));
    expect(plan.cards[0].notes.join(" ")).toContain("2 campaigns share this card");
  });

  it("writes bookings and the cost-per-booking band only when the booking ledger agrees", () => {
    const withBookings = { ...one, bookings7d: 2 };
    const agree = planKpi(
      inputs({ campaigns: [withBookings], daily: daily("A", WINDOW_ROWS), bookings: [{ client: "client a", day: "2026-10-03", booked: 1 }, { client: "client a", day: "2026-10-08", booked: 1 }, { client: "client a", day: "2026-09-30", booked: 4 }] }),
      [task("t1")],
      FIELDS,
      NOW,
    );
    const byField = Object.fromEntries(agree.cards[0].writes.map(w => [w.fieldId, w]));
    expect(byField[FIELD.bookings7d]).toMatchObject({ value: 2 });
    expect(byField[FIELD.cpbStatus]).toMatchObject({ new: kpiBand(67.5 / 2, 60), value: "cpb-0" });

    const disagree = planKpi(inputs({ campaigns: [withBookings], daily: daily("A", WINDOW_ROWS), bookings: [{ client: "client a", day: "2026-10-03", booked: 1 }] }), [task("t1")], FIELDS, NOW);
    expect(disagree.cards[0].writes.some(w => w.fieldId === FIELD.bookings7d || w.fieldId === FIELD.cpbStatus)).toBe(false);
    expect(disagree.cards[0].notes.join(" ")).toContain("booking ledger says 1");
  });

  it("with no leads writes only Last Updated, as pushMetrics did", () => {
    const plan = planKpi(inputs({ campaigns: [{ ...one, spend7d: 20, leads7d: 0, cpl: null }], daily: daily("A", [["2026-10-05", 20, 0]]) }), [task("t1")], FIELDS, NOW);
    expect(plan.cards[0].writes.map(w => w.fieldId)).toEqual([FIELD.lastUpdated]);
  });

  it("skips a card that is no longer on the board list", () => {
    const plan = planKpi(inputs({ campaigns: [one], daily: daily("A", WINDOW_ROWS) }), [], FIELDS, NOW);
    expect(plan.cards[0].skipped).toContain("not found");
  });
});
