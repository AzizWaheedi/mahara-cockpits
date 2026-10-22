import { describe, expect, it } from "bun:test";
import { GOLDEN } from "./convexGolden";
import { bookedInWindow, cents, dropdownLabel, type KpiInputs, kpiWindow, NO_WINDOW, NO_WINDOW_KEY, planKpi, sevenDay, showsNumbers } from "./kpi";
import { FIELD, kpiBand, type Row } from "./rules";
import { boardAge } from "./run";

const NOW = Date.parse("2026-10-09T09:00:00Z");
const options = (prefix: string) =>
  ["Above KPI", "At KPI", "Below KPI", "911", "Pending"].map((name, i) => ({ id: `${prefix}${i}`, name, orderindex: i }));
const FIELDS = [
  { id: FIELD.cplStatus, type_config: { options: options("cpl-") } },
  { id: FIELD.cpbStatus, type_config: { options: options("cpb-") } },
];
const PENDING = 4;
const task = (id: string, values: Record<string, unknown> = {}, name = `Card ${id}`) => ({
  id,
  name,
  custom_fields: Object.entries(values).map(([fid, value]) => ({
    id: fid,
    value,
    type_config: fid === FIELD.cplStatus ? { options: options("cpl-") } : fid === FIELD.cpbStatus ? { options: options("cpb-") } : {},
  })),
});
const daily = (campaignName: string, rows: [string, number, number][]) => rows.map(([day, spend, leads]) => ({ campaignName, day, spend, leads }));
const booked = (campaignName: string, rows: [string, number][]) => rows.map(([day, n]) => ({ campaignName, day, booked: n }));
// The media sync's 7 days on 9 Oct: 2 to 8 Oct, the last day the sheet has spend for.
const inputs = (over: Partial<KpiInputs> = {}): KpiInputs => ({
  campaigns: [],
  daily: [],
  bookings: [],
  bookingsByCampaign: [],
  weekFrom: "2026-10-02",
  weekThrough: "2026-10-08",
  weekSource: "media sync",
  dailyReady: true,
  bookingsReady: true,
  latestPublishAt: new Date(NOW - 20 * 60_000).toISOString(),
  latestSyncedAt: null,
  ...over,
});
// The Convex window fixture: one row outside 30 days, one before the 7-day start, one today, one dated tomorrow.
const WINDOW_ROWS: [string, number, number][] = [
  ["2026-09-01", 100, 10], ["2026-10-01", 7, 1], ["2026-10-02", 20, 2], ["2026-10-03", 30, 1], ["2026-10-09", 12.5, 1], ["2026-10-10", 5, 0],
];
const byField = (writes: { fieldId: string }[]) => Object.fromEntries(writes.map(w => [w.fieldId, w])) as Record<string, any>;

describe("the 7-day sums", () => {
  it("without an end, sum the same window as convex/sync.ts at every Kuwait-day boundary", () => {
    for (const w of GOLDEN.cplWindow) {
      const s = sevenDay(daily("A", WINDOW_ROWS), ["A"], w.since7);
      expect(s.spend).toBe(w.spend);
      expect(s.leads).toBe(w.leads);
      expect(s.leads > 0 ? s.spend / s.leads : null).toBe(w.cpl);
    }
  });
  it("with the media sync's end, leave out today and later (R1)", () => {
    expect(sevenDay(daily("A", WINDOW_ROWS), ["A"], "2026-10-02", "2026-10-08")).toEqual({ spend: 50, leads: 3, rows: 2 });
  });
  it("count bookings by campaign inside the window only", () => {
    const ledger = [...booked("A", [["2026-10-01", 9], ["2026-10-02", 1], ["2026-10-08", 2], ["2026-10-09", 4]]), ...booked("B", [["2026-10-05", 3]])];
    expect(bookedInWindow(ledger, ["A"], "2026-10-02", "2026-10-08")).toBe(3);
    expect(bookedInWindow(ledger, ["A", "B"], "2026-10-02", "2026-10-08")).toBe(6);
  });
  it("reads dropdown values given as option id or orderindex", () => {
    const f = { value: 2, type_config: { options: options("x-") } };
    expect(dropdownLabel(f)).toBe("Below KPI");
    expect(dropdownLabel({ ...f, value: "x-0" })).toBe("Above KPI");
    expect(dropdownLabel({ ...f, value: null })).toBeUndefined();
  });
  it("takes the window from the media sync, and none when it has not published one", () => {
    expect(kpiWindow(inputs())).toEqual({ from: "2026-10-02", through: "2026-10-08", source: "media sync" });
    expect(kpiWindow(inputs({ weekFrom: null, weekThrough: "2026-10-08", weekSource: "media data" }))).toEqual({ refused: NO_WINDOW });
    // An inputs function before 20261022z sends no weekFrom key at all: the refusal names the migration.
    expect(kpiWindow(inputs({ weekFrom: undefined, weekThrough: undefined }))).toEqual({ refused: NO_WINDOW_KEY });
    expect(NO_WINDOW_KEY).toBe("cockpit_clickup_writeback_inputs has no 7-day window (migration 20261022z is not applied), so nothing was planned.");
    // Through JSON, as the RPC returns it: 20261022z always sends the key, null until the sync publishes.
    const { weekFrom: _f, weekThrough: _t, weekSource: _s, ...old } = inputs();
    expect(kpiWindow(JSON.parse(JSON.stringify(old)))).toEqual({ refused: NO_WINDOW_KEY });
    expect(kpiWindow(JSON.parse(JSON.stringify(inputs({ weekFrom: null, weekThrough: "2026-10-08" }))))).toEqual({ refused: NO_WINDOW });
    expect((kpiWindow(inputs({ weekFrom: "2026-10-09", weekThrough: "2026-10-08" })) as any).refused).toContain("not a valid pair of days");
    expect((kpiWindow(inputs({ weekFrom: "2 Oct", weekThrough: "2026-10-08" })) as any).refused).toContain("not a valid pair of days");
  });
});

describe("board KPI plan", () => {
  // 2 to 8 Oct: $50.00 for 3 leads. The 9 and 10 Oct rows are after the media sync's last day.
  const one = { campaignName: "A", clientName: "Client A", taskId: "t1", internal: false, spend7d: 50, leads7d: 3, cpl: 50 / 3 };

  it("writes CPL, its band and Last Updated when both sources agree", () => {
    const plan = planKpi(inputs({ campaigns: [one], daily: daily("A", WINDOW_ROWS) }), [task("t1", { [FIELD.cpl7d]: "12.00", [FIELD.cplStatus]: 0 })], FIELDS, NOW);
    expect(plan.refused).toBeUndefined();
    expect(plan.window).toEqual({ from: "2026-10-02", through: "2026-10-08", source: "media sync" });
    const card = plan.cards[0];
    expect(card.skipped).toBeUndefined();
    const f = byField(card.writes);
    expect(f[FIELD.cpl7d]).toMatchObject({ old: 12, new: 16.67, value: 16.67, changed: true });
    expect(f[FIELD.cplStatus]).toMatchObject({ old: "Above KPI", new: kpiBand(50 / 3, 15), value: "cpl-2", changed: true });
    expect(f[FIELD.lastUpdated]).toMatchObject({ value: NOW, changed: true });
    expect(card.stamped).toBe(true);
    // Last Updated is written last, after the numbers it vouches for.
    expect(card.writes.at(-1)?.fieldId).toBe(FIELD.lastUpdated);
  });

  it("marks unchanged values so a live run does not rewrite them", () => {
    const plan = planKpi(inputs({ campaigns: [one], daily: daily("A", WINDOW_ROWS) }), [task("t1", { [FIELD.cpl7d]: 16.67, [FIELD.cplStatus]: "cpl-2" })], FIELDS, NOW);
    const f = byField(plan.cards[0].writes);
    expect(f[FIELD.cpl7d].changed).toBe(false);
    expect(f[FIELD.cplStatus].changed).toBe(false);
    expect(plan.cards[0].stamped).toBe(true);
  });

  it("a row that still counts today's spend disagrees with the bounded ledger, and the card is skipped", () => {
    const plan = planKpi(inputs({ campaigns: [{ ...one, spend7d: 67.5, leads7d: 5 }], daily: daily("A", WINDOW_ROWS) }), [task("t1")], FIELDS, NOW);
    expect(plan.cards[0].writes).toEqual([]);
    expect(plan.cards[0].skipped).toContain("$67.50 for 5 leads");
    expect(plan.cards[0].skipped).toContain("$50.00 for 3 leads from 2 Oct to 8 Oct");
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

  it("refuses to plan when the ledger, the freshness or the window is missing: missing is never zero", () => {
    expect(planKpi(inputs({ dailyReady: false, campaigns: [one] }), [task("t1")], FIELDS, NOW).refused).toContain("not imported");
    expect(planKpi(inputs({ latestPublishAt: new Date(NOW - 4 * 3600_000).toISOString(), campaigns: [one] }), [task("t1")], FIELDS, NOW).refused).toContain("minutes ago");
    expect(planKpi(inputs({ latestPublishAt: null, campaigns: [one] }), [task("t1")], FIELDS, NOW).refused).toContain("no record");
    const noWindow = planKpi(inputs({ weekFrom: null, weekSource: "media data", campaigns: [one], daily: daily("A", WINDOW_ROWS) }), [task("t1")], FIELDS, NOW);
    expect(noWindow.refused).toBe("The media sync has not published its 7-day window yet, so nothing was planned.");
    expect(noWindow.cards).toEqual([]);
  });

  it("combines campaigns that share one card", () => {
    const b = { campaignName: "B", clientName: "Client A", taskId: "t1", internal: false, spend7d: 30, leads7d: 1, cpl: 30 };
    const plan = planKpi(inputs({ campaigns: [one, b], daily: [...daily("A", WINDOW_ROWS), ...daily("B", [["2026-10-05", 30, 1]])] }), [task("t1")], FIELDS, NOW);
    const cpl = plan.cards[0].writes.find(w => w.fieldId === FIELD.cpl7d);
    expect(cpl?.value).toBe(Number((80 / 4).toFixed(2)));
    expect(plan.cards[0].notes.join(" ")).toContain("2 campaigns share this card");
  });

  it("writes bookings and the cost-per-booking band only when the booking ledger agrees, today's bookings out", () => {
    const withBookings = { ...one, bookings7d: 2 };
    const ledger = booked("A", [["2026-10-03", 1], ["2026-10-08", 1], ["2026-10-01", 4], ["2026-10-09", 3]]);
    const agree = planKpi(inputs({ campaigns: [withBookings], daily: daily("A", WINDOW_ROWS), bookingsByCampaign: ledger }), [task("t1")], FIELDS, NOW);
    const f = byField(agree.cards[0].writes);
    expect(f[FIELD.bookings7d]).toMatchObject({ value: 2 });
    expect(f[FIELD.cpbStatus]).toMatchObject({ new: kpiBand(50 / 2, 60), value: "cpb-0" });
    expect(agree.cards[0].stamped).toBe(true);

    // A row published before R1 still counts today's 3 bookings: refused, and Last Updated held.
    const disagree = planKpi(inputs({ campaigns: [{ ...one, bookings7d: 5 }], daily: daily("A", WINDOW_ROWS), bookingsByCampaign: ledger }), [task("t1")], FIELDS, NOW);
    expect(disagree.cards[0].writes.some(w => [FIELD.bookings7d, FIELD.cpbStatus, FIELD.lastUpdated].includes(w.fieldId as any))).toBe(false);
    expect(disagree.cards[0].notes.join(" ")).toContain("the campaign rows say 5, the booking ledger says 2 from 2 Oct to 8 Oct");
    expect(disagree.cards[0].held).toBe("Last Updated was left as it was: Bookings (7d), Cost Per Booking could not be refreshed.");
  });

  it("with no leads leaves the CPL columns, and stamps Last Updated only when they claim nothing", () => {
    const quiet = { ...one, spend7d: 20, leads7d: 0, cpl: null };
    const rows = daily("A", [["2026-10-05", 20, 0]]);
    const clean = planKpi(inputs({ campaigns: [quiet], daily: rows }), [task("t1", { [FIELD.cplStatus]: PENDING })], FIELDS, NOW);
    expect(clean.cards[0].writes.map(w => w.fieldId)).toEqual([FIELD.lastUpdated]);
    expect(clean.cards[0].notes.join(" ")).toContain("No leads from 2 Oct to 8 Oct");
    const stale = planKpi(inputs({ campaigns: [quiet], daily: rows }), [task("t1", { [FIELD.cpl7d]: 9.5, [FIELD.cplStatus]: 0 })], FIELDS, NOW);
    expect(stale.cards[0].writes).toEqual([]);
    expect(stale.cards[0].held).toBe("Last Updated was left as it was: CPL (7d), Cost Per Lead could not be refreshed.");
  });

  it("skips a card that is no longer on the board list", () => {
    const plan = planKpi(inputs({ campaigns: [one], daily: daily("A", WINDOW_ROWS) }), [], FIELDS, NOW);
    expect(plan.cards[0].skipped).toContain("not found");
  });

  it("finds the oldest Last Updated among the cards that show numbers, and counts the others apart", () => {
    const names = ["A", "B", "C", "D", "E"];
    const camps = names.map((n, i) => ({ ...one, campaignName: n, taskId: `t${i + 1}` }));
    const plan = planKpi(
      inputs({ campaigns: camps, daily: names.flatMap(n => daily(n, WINDOW_ROWS)) }),
      [
        // Pushed numbers, 7 Oct.
        task("t1", { [FIELD.cpl7d]: "9.50", [FIELD.lastUpdated]: String(Date.parse("2026-10-07T03:00:00Z")) }),
        // Made on 4 Oct with Pending bands and no numbers (Merge Studio on 22 Oct): its date vouches for nothing.
        task("t2", { [FIELD.cplStatus]: PENDING, [FIELD.cpbStatus]: PENDING, [FIELD.lastUpdated]: Date.parse("2026-10-04T03:00:00Z") }),
        // Nothing at all.
        task("t3"),
        // A band and a 0 count are numbers too.
        task("t4", { [FIELD.bookings7d]: 0, [FIELD.lastUpdated]: Date.parse("2026-10-10T03:00:00Z") }),
        // Numbers but no date.
        task("t5", { [FIELD.cpbStatus]: 2 }),
      ],
      FIELDS,
      NOW,
    );
    expect(new Date(plan.oldestLastUpdated!).toISOString()).toBe("2026-10-07T03:00:00.000Z");
    expect([plan.noNumbers, plan.undated]).toEqual([2, 1]);
    expect(showsNumbers(task("x", { [FIELD.cplStatus]: PENDING }))).toBe(false);
    expect(showsNumbers(task("x", { [FIELD.cplStatus]: 1 }))).toBe(true);
    expect(showsNumbers(task("x", { [FIELD.bookings7d]: "0" }))).toBe(true);
  });
});

describe("R12 booking rules", () => {
  const camp = (name: string, taskId: string, spend: number, leads: number, bookings7d?: number, extra: Record<string, unknown> = {}) => ({
    campaignName: name, clientName: "Client", taskId, internal: false, spend7d: spend, leads7d: leads, cpl: leads ? spend / leads : null, ...(bookings7d === undefined ? {} : { bookings7d }), ...extra,
  });
  const plan1 = (c: Row, ledger: KpiInputs["bookingsByCampaign"], values: Record<string, unknown> = {}, over: Partial<KpiInputs> = {}) =>
    planKpi(inputs({ campaigns: [c], daily: daily(c.campaignName, [["2026-10-04", c.spend7d, c.leads7d]]), bookingsByCampaign: ledger, ...over }), [task(c.taskId, values)], FIELDS, NOW).cards[0];

  it("compares each card with its own campaigns' bookings, so two cards of one client are both written (Castello)", () => {
    const a = camp("CASTELLO-6\\10", "c6", 225.36, 14, 1);
    const b = camp("CASTELLO-19\\10", "c19", 74.33, 8, 3);
    const plan = planKpi(
      inputs({
        campaigns: [a, b],
        daily: [...daily(a.campaignName, [["2026-10-04", 225.36, 14]]), ...daily(b.campaignName, [["2026-10-06", 74.33, 8]])],
        // The client's total is 4; the old client-level check refused both cards.
        bookings: [{ client: "client", day: "2026-10-05", booked: 4 }],
        bookingsByCampaign: [...booked(a.campaignName, [["2026-10-05", 1]]), ...booked(b.campaignName, [["2026-10-07", 3]])],
      }),
      [task("c6"), task("c19")],
      FIELDS,
      NOW,
    );
    const [six, nineteen] = [plan.cards.find(c => c.taskId === "c6")!, plan.cards.find(c => c.taskId === "c19")!];
    expect(byField(six.writes)[FIELD.bookings7d].value).toBe(1);
    expect(byField(six.writes)[FIELD.cpbStatus].new).toBe("911");
    expect(byField(nineteen.writes)[FIELD.bookings7d].value).toBe(3);
    expect(byField(nineteen.writes)[FIELD.cpbStatus].new).toBe(kpiBand(74.33 / 3, 60));
  });

  it("sums the bookings of campaigns that share a card, never the largest of them", () => {
    const a = camp("A", "t1", 60, 4, 2);
    const b = camp("B", "t1", 30, 2, 1);
    const plan = planKpi(
      inputs({
        campaigns: [a, b],
        daily: [...daily("A", [["2026-10-04", 60, 4]]), ...daily("B", [["2026-10-05", 30, 2]])],
        bookingsByCampaign: [...booked("A", [["2026-10-04", 2]]), ...booked("B", [["2026-10-05", 1]])],
      }),
      [task("t1")],
      FIELDS,
      NOW,
    );
    const f = byField(plan.cards[0].writes);
    expect(f[FIELD.bookings7d].value).toBe(3);
    expect(f[FIELD.cpbStatus].new).toBe(kpiBand(90 / 3, 60));
    expect(plan.cards[0].notes.join(" ")).toContain("its bookings are their sum");
  });

  it("no booking after more than the $60 gate writes 0 and bands the spend itself (Alkhalil, 911)", () => {
    const card = plan1(camp("ALKHALIL", "t1", 233.36, 17, 0), []);
    const f = byField(card.writes);
    expect(f[FIELD.bookings7d]).toMatchObject({ value: 0, new: 0 });
    expect(f[FIELD.cpbStatus]).toMatchObject({ new: "911", value: "cpb-3" });
    expect(card.notes.join(" ")).toContain("No booking on $233.36 from 2 Oct to 8 Oct, so the spend itself is the cost per booking: 911.");
    expect(card.stamped).toBe(true);
    // Between the gate and one and a half times it, the band is Below KPI.
    expect(byField(plan1(camp("X", "t1", 75, 5, 0), []).writes)[FIELD.cpbStatus].new).toBe("Below KPI");
  });

  it("no booking yet on up to $60 writes 0, leaves Cost Per Booking and says it is too early to judge", () => {
    const c = camp("CASTELLO-19\\10", "t1", 43.12, 6, 0);
    const pending = plan1(c, [], { [FIELD.cpbStatus]: PENDING });
    expect(pending.writes.map(w => w.fieldId)).toEqual([FIELD.cpl7d, FIELD.cplStatus, FIELD.bookings7d, FIELD.lastUpdated]);
    expect(pending.notes.join(" ")).toContain("No booking yet on $43.12 from 2 Oct to 8 Oct: too early to judge");
    expect(pending.stamped).toBe(true);
    expect(plan1(c, []).stamped).toBe(true);
    // A band left from an earlier push is not right for a campaign with no booking yet.
    const stale = plan1(c, [], { [FIELD.cpbStatus]: 0 });
    expect(stale.writes.some(w => w.fieldId === FIELD.cpbStatus || w.fieldId === FIELD.lastUpdated)).toBe(false);
    expect(stale.notes.join(" ")).toContain('Cost Per Booking still shows "Above KPI" from an earlier push.');
    expect(stale.held).toContain("Cost Per Booking could not be refreshed");
  });

  it("bookings unknown: no booking column is written and the note says why", () => {
    const unknown = plan1(camp("A", "t1", 192.33, 16), []);
    expect(unknown.writes.some(w => w.fieldId === FIELD.bookings7d || w.fieldId === FIELD.cpbStatus)).toBe(false);
    expect(unknown.notes.join(" ")).toContain("gives no 7-day booking count for this campaign");
    expect(unknown.stamped).toBe(true);
    const dwy = plan1(camp("A", "t1", 192.33, 16, undefined, { serviceMode: "DWY" }), [], { [FIELD.cpbStatus]: PENDING });
    expect(dwy.notes.join(" ")).toContain("Done with you: the client books its own meetings");
    expect(dwy.stamped).toBe(true);
    // An old count still on the card holds Last Updated back.
    const stale = plan1(camp("A", "t1", 192.33, 16), [], { [FIELD.bookings7d]: 8 });
    expect(stale.held).toBe("Last Updated was left as it was: Bookings (7d) could not be refreshed.");
    // One campaign of two without a count makes the card's bookings unknown, never a partial sum.
    const plan = planKpi(
      inputs({
        campaigns: [camp("A", "t1", 60, 4, 2), camp("B", "t1", 30, 2)],
        daily: [...daily("A", [["2026-10-04", 60, 4]]), ...daily("B", [["2026-10-05", 30, 2]])],
        bookingsByCampaign: booked("A", [["2026-10-04", 2]]),
      }),
      [task("t1")],
      FIELDS,
      NOW,
    );
    expect(plan.cards[0].writes.some(w => w.fieldId === FIELD.bookings7d)).toBe(false);
    expect(plan.cards[0].notes.join(" ")).toContain("no 7-day booking count for B");
  });

  it("an unverified booking ledger, or none by campaign, writes no booking column and holds Last Updated", () => {
    const c = camp("A", "t1", 60, 4, 2);
    const notReady = plan1(c, booked("A", [["2026-10-04", 2]]), {}, { bookingsReady: false });
    expect(notReady.writes.some(w => [FIELD.bookings7d, FIELD.cpbStatus, FIELD.lastUpdated].includes(w.fieldId as any))).toBe(false);
    expect(notReady.notes.join(" ")).toContain("booking ledger is not imported and verified");
    const old = plan1(c, undefined);
    expect(old.notes.join(" ")).toContain("no booking ledger by campaign");
    expect(old.held).toContain("Bookings (7d), Cost Per Booking");
  });

  it("judges the cost per booking to the cent, as the cockpit does: $60.004 is $60.00, within the gate", () => {
    // Riyal-style spend: 39.432806 + 20.5715 = $60.004306.
    const c = { ...camp("RIYAL", "t1", 60.004306, 4, 0), spend7d: 39.432806 + 20.5715 };
    const two = daily("RIYAL", [["2026-10-04", 39.432806, 2], ["2026-10-05", 20.5715, 2]]);
    const plan = (bookings7d: number, values: Record<string, unknown> = {}) =>
      planKpi(inputs({ campaigns: [{ ...c, bookings7d }], daily: two, bookingsByCampaign: bookings7d ? booked("RIYAL", [["2026-10-05", bookings7d]]) : [] }), [task("t1", values)], FIELDS, NOW).cards[0];
    const none = plan(0, { [FIELD.cpbStatus]: PENDING });
    expect(none.skipped).toBeUndefined();
    expect(byField(none.writes)[FIELD.bookings7d]).toMatchObject({ value: 0 });
    expect(byField(none.writes)[FIELD.cpbStatus]).toBeUndefined();
    expect(none.notes.join(" ")).toContain("No booking yet on $60.00 from 2 Oct to 8 Oct: too early to judge");
    expect(none.notes.join(" ")).not.toContain("the spend itself is the cost per booking");
    expect(none.stamped).toBe(true);
    // One booking on $60.00 is At KPI, not Below KPI.
    expect(byField(plan(1).writes)[FIELD.cpbStatus].new).toBe("At KPI");
    // One cent over is over: $60.01 with no booking is judged.
    const over = planKpi(inputs({ campaigns: [camp("O", "t1", 60.01, 4, 0)], daily: daily("O", [["2026-10-04", 60.01, 4]]), bookingsByCampaign: [] }), [task("t1")], FIELDS, NOW).cards[0];
    expect(byField(over.writes)[FIELD.cpbStatus].new).toBe("Below KPI");
    expect(cents(60.004306)).toBe(60);
  });

  it("bands the cost per lead on the CPL (7d) value written beside it", () => {
    // $75.02 for 5 leads is $15.004: the card shows 15 and Cost Per Lead must read At KPI, not Below KPI.
    const card = plan1(camp("A", "t1", 75.02, 5, 0), []);
    expect(byField(card.writes)[FIELD.cpl7d].value).toBe(15);
    expect(byField(card.writes)[FIELD.cplStatus].new).toBe("At KPI");
  });

  it("bookings on under $1 of spend are counted but not judged: the media sync calls that no delivery", () => {
    const c = camp("TRICKLE", "t1", 0.75, 1, 1);
    const card = plan1(c, booked("TRICKLE", [["2026-10-04", 1]]), { [FIELD.cpbStatus]: PENDING });
    expect(byField(card.writes)[FIELD.bookings7d]).toMatchObject({ value: 1 });
    expect(byField(card.writes)[FIELD.cpbStatus]).toBeUndefined();
    expect(card.notes.join(" ")).toContain("1 booking from 2 Oct to 8 Oct on only $0.75 of spend: the media sync calls that no delivery");
    expect(card.stamped).toBe(true);
    // A band left from an earlier push is not right for these days: Last Updated is held.
    const stale = plan1(c, booked("TRICKLE", [["2026-10-04", 1]]), { [FIELD.cpbStatus]: 0 });
    expect(stale.writes.some(w => w.fieldId === FIELD.cpbStatus || w.fieldId === FIELD.lastUpdated)).toBe(false);
    expect(stale.held).toBe("Last Updated was left as it was: Cost Per Booking could not be refreshed.");
    // At $1 of spend the bookings are judged again.
    expect(byField(plan1(camp("ONE", "t1", 1, 1, 1), booked("ONE", [["2026-10-04", 1]])).writes)[FIELD.cpbStatus].new).toBe("Above KPI");
  });

  it("a board column without the option is not set and holds Last Updated", () => {
    const card = planKpi(
      inputs({ campaigns: [camp("A", "t1", 60, 4, 2)], daily: daily("A", [["2026-10-04", 60, 4]]), bookingsByCampaign: booked("A", [["2026-10-04", 2]]) }),
      [task("t1")],
      [FIELDS[0]],
      NOW,
    ).cards[0];
    expect(card.notes.join(" ")).toContain('The Cost Per Booking column has no "Above KPI" option');
    expect(card.held).toContain("Cost Per Booking");
  });
});

// The contract's expected plan (CPB-BUILD2-CONTRACT.md section 3, R12): 14 to 20 Oct.
// Spend and leads per campaign: cockpit_media_daily_stats, read live on 22 Oct (equal to the
// 21 Oct audit). Bookings by campaign and booking day: the media sync's events under the build 1
// rule (R1 window, R4 call-backs out, R13 qualification calendar out, D0b reschedule kept while
// its original is gone), with the 21 Oct bookings the live rows still counted, which must stay
// out. Board values: the 21 Oct 20:05 dry run's "old" column.
// What this block proves: the bands, the window bound and the rules on the contract's totals. It
// does not replay the live ledgers: each campaign's week is one made-up 17 Oct row and its booking
// ledger is built from the same counts as bookings7d, so the two-source check here cannot fail.
// The real two-source proof is the next block, the live 22 Oct publish against both ledgers.
describe("the 14 to 20 Oct plan (contract section 3, R12)", () => {
  const WEEK = { weekFrom: "2026-10-14", weekThrough: "2026-10-20" };
  const AT = Date.parse("2026-10-21T17:05:00Z");
  const OCT7 = Date.parse("2026-10-07T03:00:00Z");
  // [task, card name, campaign, spend, leads, bookings 14-20 (undefined = not measured), bookings on 21 Oct, board values]
  const CARDS: [string, string, string, number, number, number | undefined, number, Record<string, unknown>][] = [
    ["z8xmdvdz8v", "ALKHALIL- MAHRA-15\\9", "ALKHALIL- MAHRA-15\\9", 233.36, 17, 0, 0, { [FIELD.lastUpdated]: OCT7, [FIELD.cplStatus]: 0 }],
    ["86eyudahw", "Arcturus-Mahara-3\\9", "Arcturus-Mahara-3\\9", 242.48, 39, 4, 0, { [FIELD.lastUpdated]: OCT7, [FIELD.bookings7d]: 8, [FIELD.cpbStatus]: 0 }],
    ["z8xmdveh57", "Ardon_mahar-22\\9", "Ardon_mahar-22\\9", 201.9, 11, 5, 0, { [FIELD.lastUpdated]: OCT7 }],
    ["z8xmdvjgzn", "Atlantis-mahara-19\\10", "Atlantis-mahara-19\\10", 51.71, 3, 0, 0, { [FIELD.lastUpdated]: Date.parse("2026-10-19T03:00:00Z"), [FIELD.cplStatus]: PENDING }],
    ["z8xmdvgf5g", "Atlantis-mahara-7\\10", "Atlantis-mahara-7\\10", 122.82, 2, 3, 1, { [FIELD.lastUpdated]: OCT7, [FIELD.cplStatus]: PENDING }],
    ["z8xmdvjgzm", "CASTELLO-MAHARA-19\\10", "CASTELLO-MAHARA-19\\10", 43.12, 6, 0, 2, { [FIELD.lastUpdated]: Date.parse("2026-10-19T03:00:00Z"), [FIELD.cplStatus]: PENDING }],
    ["z8xmdvg5fy", "CASTELLO-MAHARA-6\\10 ", "CASTELLO-MAHARA-6\\10", 225.36, 14, 1, 0, { [FIELD.lastUpdated]: OCT7, [FIELD.cpbStatus]: PENDING }],
    ["86eywa446", "city wood-mahara-12\\9", "city wood-mahara-12\\9", 354, 32, 3, 4, { [FIELD.lastUpdated]: OCT7, [FIELD.cpbStatus]: PENDING, [FIELD.cplStatus]: PENDING }],
    ["z8xmdvjt3v", "madana-mahara-20\\10", "madana-mahara-20\\10", 11.09, 0, 0, 0, { [FIELD.lastUpdated]: Date.parse("2026-10-20T03:00:00Z") }],
    ["z8xmdvhntx", "Marble|MAHARA|13\\10", "Marble|MAHARA|13\\10", 204.23, 20, 4, 1, { [FIELD.lastUpdated]: Date.parse("2026-10-13T03:00:00Z"), [FIELD.cpbStatus]: PENDING }],
    ["z8xmdvfphd", "Merge Studio | Instant Form | Leads | Oct2026 | MHM™", "Merge Studio | Instant Form | Leads | Oct2026 | MHM™", 134.69, 14, 8, 2, { [FIELD.lastUpdated]: Date.parse("2026-10-04T03:00:00Z"), [FIELD.cpbStatus]: PENDING }],
    ["z8xmdvjt0g", "monshaat-mahara-20\\10", "monshaat-mahara-20\\10", 11.35, 0, 0, 0, { [FIELD.lastUpdated]: Date.parse("2026-10-20T03:00:00Z") }],
    ["86eywnz2x", "ocean home-mahara-9\\9", "ocean home-mahara-9\\9", 235.87, 27, 9, 0, { [FIELD.lastUpdated]: OCT7 }],
    ["86eywcnhy", "Ola-mahara-13/9", "Ola|mahara|13\\9", 153.13, 14, 4, 0, { [FIELD.lastUpdated]: OCT7, [FIELD.bookings7d]: 14, [FIELD.cpbStatus]: 0 }],
    ["86eyn6c1f", "Safad | MAHARA | 16-8", "Safad | MAHARA | 16-8", 15.71, 3, 2, 0, { [FIELD.lastUpdated]: OCT7, [FIELD.cpbStatus]: PENDING }],
    ["z8xmdvj7bj", "Shades|mahara|17\\10", "Shades|mahara|17\\10", 203.63, 24, 4, 2, { [FIELD.lastUpdated]: Date.parse("2026-10-17T03:00:00Z"), [FIELD.cpbStatus]: PENDING }],
    ["z8xmdvhtwm", "منشاءت الخالده – 14\\10", "\u200e\u200eمنشاءت الخالده-mahara\u200e – 14\\10\u200e", 80.27, 6, 1, 0, { [FIELD.lastUpdated]: Date.parse("2026-10-14T03:00:00Z"), [FIELD.cpbStatus]: PENDING }],
    ["z8xmdvfpj2", "نهوض نجد للمقاولات | Leads | Sep2026 | MHM™", "نهوض نجد للمقاولات | Leads | Sep2026 | MHM™", 192.33, 16, undefined, 0, { [FIELD.lastUpdated]: OCT7 }],
  ];
  const plan = planKpi(
    inputs({
      ...WEEK,
      latestPublishAt: new Date(AT - 20 * 60_000).toISOString(),
      campaigns: CARDS.map(([taskId, , name, spend, leads, b]) => ({
        campaignName: name, clientName: name, taskId, internal: false, spend7d: spend, leads7d: leads, cpl: leads ? spend / leads : null,
        // The inputs carry no service mode today, so the done-with-you row is just a row with no count.
        ...(b === undefined ? {} : { bookings7d: b }),
      })),
      // One daily row per campaign inside the window, plus a 21 Oct row that must stay out.
      daily: CARDS.flatMap(([, , name, spend, leads]) => [{ campaignName: name, day: "2026-10-17", spend, leads }, { campaignName: name, day: "2026-10-21", spend: 30, leads: 2 }]),
      bookingsByCampaign: [
        ...CARDS.flatMap(([, , name, , , b, today]) => [
          ...(b ? [{ campaignName: name, day: "2026-10-18", booked: b }] : []),
          ...(today ? [{ campaignName: name, day: "2026-10-21", booked: today }] : []),
        ]),
        // Atlantis 13\9 stopped: its 20 Oct booking has no card here.
        { campaignName: "Atlantis-mahara-13\\9", day: "2026-10-20", booked: 1 },
      ],
    }),
    CARDS.map(([taskId, name, , , , , , values]) => task(taskId, values, name)),
    FIELDS,
    AT,
  );
  const card = (taskId: string) => plan.cards.find(c => c.taskId === taskId)!;
  const cell = (taskId: string, fieldId: string) => card(taskId).writes.find(w => w.fieldId === fieldId)?.new;

  it("plans every card, skips none, and runs 14 to 20 Oct", () => {
    expect(plan.refused).toBeUndefined();
    expect(plan.window).toEqual({ from: "2026-10-14", through: "2026-10-20", source: "media sync" });
    expect(plan.cards.filter(c => c.skipped)).toEqual([]);
  });

  it("writes the bookings and bands the audit expects, at $45 / $60 / $90", () => {
    const expected: [string, number, string][] = [
      ["86eywa446", 3, "911"], // City Wood $354.00 / 3 = $118.00
      ["z8xmdvg5fy", 1, "911"], // Castello 6\10 $225.36 / 1
      ["z8xmdvhntx", 4, "At KPI"], // Marble $204.23 / 4 = $51.06
      ["z8xmdvfphd", 8, "Above KPI"], // mergestudio $134.69 / 8 = $16.84
      ["86eywnz2x", 9, "Above KPI"], // Ocean $235.87 / 9 = $26.21
      ["z8xmdvj7bj", 4, "At KPI"], // Shades 17\10 $203.63 / 4 = $50.91
      ["z8xmdvgf5g", 3, "Above KPI"], // Atlantis 7\10 $122.82 / 3 = $40.94
      ["86eyudahw", 4, "Below KPI"], // Arcturus $242.48 / 4 = $60.62
      ["z8xmdveh57", 5, "Above KPI"], // Ardon $201.90 / 5 = $40.38
      ["86eyn6c1f", 2, "Above KPI"], // SAFAD $15.71 / 2 = $7.86
      ["z8xmdvhtwm", 1, "Below KPI"], // Khalida 14\10 $80.27 / 1
      ["86eywcnhy", 4, "Above KPI"], // شركة العلا $153.13 / 4 = $38.28
      ["z8xmdvdz8v", 0, "911"], // Alkhalil, no booking on $233.36
    ];
    for (const [taskId, bookings, band] of expected) {
      expect([taskId, cell(taskId, FIELD.bookings7d), cell(taskId, FIELD.cpbStatus)]).toEqual([taskId, bookings, band]);
      expect(card(taskId).stamped).toBe(true);
    }
  });

  it("leaves Cost Per Booking on Castello 19\\10 ($43.12, too early) and on the cards with no spend to judge", () => {
    expect(cell("z8xmdvjgzm", FIELD.bookings7d)).toBe(0);
    expect(cell("z8xmdvjgzm", FIELD.cpbStatus)).toBeUndefined();
    expect(card("z8xmdvjgzm").notes.join(" ")).toContain("No booking yet on $43.12 from 14 Oct to 20 Oct: too early to judge");
    for (const taskId of ["z8xmdvjgzn", "z8xmdvjt3v", "z8xmdvjt0g"]) expect(cell(taskId, FIELD.cpbStatus)).toBeUndefined();
  });

  it("writes no booking column for the done-with-you client, and says why", () => {
    expect(cell("z8xmdvfpj2", FIELD.bookings7d)).toBeUndefined();
    expect(cell("z8xmdvfpj2", FIELD.cpbStatus)).toBeUndefined();
    expect(card("z8xmdvfpj2").notes.join(" ")).toContain("no 7-day booking count for this campaign (a done-with-you client, no GoHighLevel connection, or a failed read)");
    expect(card("z8xmdvfpj2").stamped).toBe(true);
  });

  it("names 7 Oct as the oldest Last Updated on a card with numbers, as the contract expects", () => {
    // Merge Studio's card reads 4 Oct 03:00 UTC, the date it was made; it shows no numbers (Pending
    // only), so that date vouches for nothing and is left out (ClickUp, read 22 Oct).
    expect(new Date(plan.oldestLastUpdated!).toISOString()).toBe("2026-10-07T03:00:00.000Z");
  });
});

// The live data on 22 Oct 2026, 23:49 Kuwait (read only): the campaign rows the live worker
// (033b93a7, R1 window) published for 15 to 21 Oct, the two ledgers as
// cockpit_clickup_writeback_inputs(true) and cockpit_media_booking_events returned them, and every
// card's columns as ClickUp held them. The week is what cockpit_media_week() will return once the
// worker publishes ads7d (its since7 and until7). Every card must agree with both ledgers.
describe("the live 22 Oct publish, 15 to 21 Oct", () => {
  // [task, campaign, spend7d, leads7d, bookings7d (null = not given), cpl] as published by the live worker (033b93a7).
  const ROWS: [string, string, number, number, number | null, number | null][] = [
    ["86eyn6c1f", "Safad | MAHARA | 16-8", 5.78, 3, 2, 1.9266666666666667],
    ["86eyudahw", "Arcturus-Mahara-3\\9", 208.43, 36, 3, 5.789722222222222],
    ["86eywa446", "city wood-mahara-12\\9", 332.17000000000013, 33, 7, 10.06575757575758],
    ["86eywcnhy", "Ola|mahara|13\\9", 166.84, 16, 3, 10.4275],
    ["86eywnz2x", "ocean home-mahara-9\\9", 252.82, 24, 9, 10.534166666666666],
    ["z8xmdvdz8v", "ALKHALIL- MAHRA-15\\9", 254.64, 18, 0, 14.146666666666667],
    ["z8xmdveh57", "Ardon_mahar-22\\9", 162.468706, 7, 2, 23.209815142857142],
    ["z8xmdvfphd", "Merge Studio | Instant Form | Leads | Oct2026 | MHM\u2122", 169.81, 17, 9, 9.988823529411764],
    ["z8xmdvfpj2", "\u0646\u0647\u0648\u0636 \u0646\u062c\u062f \u0644\u0644\u0645\u0642\u0627\u0648\u0644\u0627\u062a | Leads | Sep2026 | MHM\u2122", 198.96, 14, null, 14.211428571428572],
    ["z8xmdvg5fy", "CASTELLO-MAHARA-6\\10", 206.52999999999997, 10, 1, 20.653],
    ["z8xmdvgf5g", "Atlantis-mahara-7\\10", 122.82, 2, 4, 61.41],
    ["z8xmdvhntx", "Marble|MAHARA|13\\10", 184.56, 17, 5, 10.856470588235295],
    ["z8xmdvhtwm", "\u200e\u200e\u0645\u0646\u0634\u0627\u0621\u062a \u0627\u0644\u062e\u0627\u0644\u062f\u0647-mahara\u200e \u2013 14\\10\u200e", 64.61999999999999, 5, 1, 12.923999999999998],
    ["z8xmdvj7bj", "Shades|mahara|17\\10", 230.25175599999997, 27, 6, 8.527842814814814],
    ["z8xmdvjgzm", "CASTELLO-MAHARA-19\\10", 74.33, 8, 2, 9.29125],
    ["z8xmdvjgzn", "Atlantis-mahara-19\\10", 86.25, 6, 0, 14.375],
    ["z8xmdvjt0g", "monshaat-mahara-20\\10", 45.980000000000004, 0, 0, null],
    ["z8xmdvjt3v", "madana-mahara-20\\10", 46.31, 1, 0, 46.31],
  ];
  // cockpit_media_daily_stats by campaign and day, 14 to 21 Oct (14 Oct is before the window).
  const DAILY: [string, string, number, number][] = [
    ["ALKHALIL- MAHRA-15\\9", "2026-10-14", 22.33, 2],
    ["ALKHALIL- MAHRA-15\\9", "2026-10-15", 39.81, 0],
    ["ALKHALIL- MAHRA-15\\9", "2026-10-16", 51.71, 3],
    ["ALKHALIL- MAHRA-15\\9", "2026-10-17", 28.14, 0],
    ["ALKHALIL- MAHRA-15\\9", "2026-10-18", 29.4, 3],
    ["ALKHALIL- MAHRA-15\\9", "2026-10-19", 20.32, 2],
    ["ALKHALIL- MAHRA-15\\9", "2026-10-20", 41.65, 7],
    ["ALKHALIL- MAHRA-15\\9", "2026-10-21", 43.61, 3],
    ["Arcturus-Mahara-3\\9", "2026-10-14", 34.05, 3],
    ["Arcturus-Mahara-3\\9", "2026-10-15", 36.29, 4],
    ["Arcturus-Mahara-3\\9", "2026-10-16", 56.05, 12],
    ["Arcturus-Mahara-3\\9", "2026-10-17", 21.3, 5],
    ["Arcturus-Mahara-3\\9", "2026-10-18", 23.2, 7],
    ["Arcturus-Mahara-3\\9", "2026-10-19", 40.65, 6],
    ["Arcturus-Mahara-3\\9", "2026-10-20", 30.94, 2],
    ["Ardon_mahar-22\\9", "2026-10-14", 39.432806, 4],
    ["Ardon_mahar-22\\9", "2026-10-15", 48.886442, 4],
    ["Ardon_mahar-22\\9", "2026-10-16", 56.641836000000005, 2],
    ["Ardon_mahar-22\\9", "2026-10-17", 35.209862, 1],
    ["Ardon_mahar-22\\9", "2026-10-18", 21.730566, 0],
    ["Atlantis-mahara-19\\10", "2026-10-19", 15.38, 2],
    ["Atlantis-mahara-19\\10", "2026-10-20", 36.33, 1],
    ["Atlantis-mahara-19\\10", "2026-10-21", 34.54, 3],
    ["Atlantis-mahara-7\\10", "2026-10-15", 46.17, 0],
    ["Atlantis-mahara-7\\10", "2026-10-16", 51.72, 2],
    ["Atlantis-mahara-7\\10", "2026-10-17", 24.93, 0],
    ["CASTELLO-MAHARA-19\\10", "2026-10-19", 2.99, 0],
    ["CASTELLO-MAHARA-19\\10", "2026-10-20", 40.13, 6],
    ["CASTELLO-MAHARA-19\\10", "2026-10-21", 31.21, 2],
    ["CASTELLO-MAHARA-6\\10", "2026-10-14", 18.83, 4],
    ["CASTELLO-MAHARA-6\\10", "2026-10-15", 36.14, 1],
    ["CASTELLO-MAHARA-6\\10", "2026-10-16", 51.68, 5],
    ["CASTELLO-MAHARA-6\\10", "2026-10-17", 38.97, 2],
    ["CASTELLO-MAHARA-6\\10", "2026-10-18", 43.49, 2],
    ["CASTELLO-MAHARA-6\\10", "2026-10-19", 36.25, 0],
    ["Marble|MAHARA|13\\10", "2026-10-14", 26.57, 3],
    ["Marble|MAHARA|13\\10", "2026-10-15", 33.84, 6],
    ["Marble|MAHARA|13\\10", "2026-10-16", 31.81, 3],
    ["Marble|MAHARA|13\\10", "2026-10-17", 27.21, 1],
    ["Marble|MAHARA|13\\10", "2026-10-18", 31.28, 4],
    ["Marble|MAHARA|13\\10", "2026-10-19", 32.89, 2],
    ["Marble|MAHARA|13\\10", "2026-10-20", 20.63, 1],
    ["Marble|MAHARA|13\\10", "2026-10-21", 6.9, 0],
    ["Merge Studio | Instant Form | Leads | Oct2026 | MHM\u2122", "2026-10-14", 23.95, 4],
    ["Merge Studio | Instant Form | Leads | Oct2026 | MHM\u2122", "2026-10-15", 22.4, 2],
    ["Merge Studio | Instant Form | Leads | Oct2026 | MHM\u2122", "2026-10-16", 34.76, 6],
    ["Merge Studio | Instant Form | Leads | Oct2026 | MHM\u2122", "2026-10-17", 21.34, 2],
    ["Merge Studio | Instant Form | Leads | Oct2026 | MHM\u2122", "2026-10-18", 0.14, 0],
    ["Merge Studio | Instant Form | Leads | Oct2026 | MHM\u2122", "2026-10-20", 32.1, 0],
    ["Merge Studio | Instant Form | Leads | Oct2026 | MHM\u2122", "2026-10-21", 59.07, 7],
    ["Ola|mahara|13\\9", "2026-10-14", 35.61, 3],
    ["Ola|mahara|13\\9", "2026-10-15", 16.93, 4],
    ["Ola|mahara|13\\9", "2026-10-16", 0, 0],
    ["Ola|mahara|13\\9", "2026-10-19", 35.95, 1],
    ["Ola|mahara|13\\9", "2026-10-20", 64.64, 6],
    ["Ola|mahara|13\\9", "2026-10-21", 49.32, 5],
    ["Safad | MAHARA | 16-8", "2026-10-14", 9.93, 0],
    ["Safad | MAHARA | 16-8", "2026-10-15", 5.29, 3],
    ["Safad | MAHARA | 16-8", "2026-10-20", 0.49, 0],
    ["Shades|mahara|17\\10", "2026-10-14", 9.938848, 1],
    ["Shades|mahara|17\\10", "2026-10-15", 36.942762, 2],
    ["Shades|mahara|17\\10", "2026-10-16", 23.370155999999998, 1],
    ["Shades|mahara|17\\10", "2026-10-17", 29.371322000000003, 4],
    ["Shades|mahara|17\\10", "2026-10-18", 47.93201400000001, 6],
    ["Shades|mahara|17\\10", "2026-10-19", 26.404064, 1],
    ["Shades|mahara|17\\10", "2026-10-20", 29.67258, 9],
    ["Shades|mahara|17\\10", "2026-10-21", 36.558858, 4],
    ["city wood-mahara-12\\9", "2026-10-14", 58.05, 2],
    ["city wood-mahara-12\\9", "2026-10-15", 56.48, 2],
    ["city wood-mahara-12\\9", "2026-10-16", 59.8, 5],
    ["city wood-mahara-12\\9", "2026-10-17", 58.96, 5],
    ["city wood-mahara-12\\9", "2026-10-18", 41.26, 2],
    ["city wood-mahara-12\\9", "2026-10-19", 44.67, 6],
    ["city wood-mahara-12\\9", "2026-10-20", 34.78, 10],
    ["city wood-mahara-12\\9", "2026-10-21", 36.22, 3],
    ["madana-mahara-20\\10", "2026-10-20", 11.09, 0],
    ["madana-mahara-20\\10", "2026-10-21", 35.22, 1],
    ["monshaat-mahara-20\\10", "2026-10-20", 11.35, 0],
    ["monshaat-mahara-20\\10", "2026-10-21", 34.63, 0],
    ["ocean home-mahara-9\\9", "2026-10-14", 25, 5],
    ["ocean home-mahara-9\\9", "2026-10-17", 69.26, 5],
    ["ocean home-mahara-9\\9", "2026-10-18", 63.68, 8],
    ["ocean home-mahara-9\\9", "2026-10-19", 41.2, 7],
    ["ocean home-mahara-9\\9", "2026-10-20", 36.73, 2],
    ["ocean home-mahara-9\\9", "2026-10-21", 41.95, 2],
    ["\u0646\u0647\u0648\u0636 \u0646\u062c\u062f \u0644\u0644\u0645\u0642\u0627\u0648\u0644\u0627\u062a | Leads | Sep2026 | MHM\u2122", "2026-10-14", 24.97, 3],
    ["\u0646\u0647\u0648\u0636 \u0646\u062c\u062f \u0644\u0644\u0645\u0642\u0627\u0648\u0644\u0627\u062a | Leads | Sep2026 | MHM\u2122", "2026-10-15", 21.99, 0],
    ["\u0646\u0647\u0648\u0636 \u0646\u062c\u062f \u0644\u0644\u0645\u0642\u0627\u0648\u0644\u0627\u062a | Leads | Sep2026 | MHM\u2122", "2026-10-16", 26.68, 3],
    ["\u0646\u0647\u0648\u0636 \u0646\u062c\u062f \u0644\u0644\u0645\u0642\u0627\u0648\u0644\u0627\u062a | Leads | Sep2026 | MHM\u2122", "2026-10-17", 25.13, 1],
    ["\u0646\u0647\u0648\u0636 \u0646\u062c\u062f \u0644\u0644\u0645\u0642\u0627\u0648\u0644\u0627\u062a | Leads | Sep2026 | MHM\u2122", "2026-10-18", 34.68, 3],
    ["\u0646\u0647\u0648\u0636 \u0646\u062c\u062f \u0644\u0644\u0645\u0642\u0627\u0648\u0644\u0627\u062a | Leads | Sep2026 | MHM\u2122", "2026-10-19", 26.07, 4],
    ["\u0646\u0647\u0648\u0636 \u0646\u062c\u062f \u0644\u0644\u0645\u0642\u0627\u0648\u0644\u0627\u062a | Leads | Sep2026 | MHM\u2122", "2026-10-20", 32.81, 2],
    ["\u0646\u0647\u0648\u0636 \u0646\u062c\u062f \u0644\u0644\u0645\u0642\u0627\u0648\u0644\u0627\u062a | Leads | Sep2026 | MHM\u2122", "2026-10-21", 31.6, 1],
    ["\u200e\u200e\u0645\u0646\u0634\u0627\u0621\u062a \u0627\u0644\u062e\u0627\u0644\u062f\u0647-mahara\u200e \u2013 14\\10\u200e", "2026-10-14", 15.65, 1],
    ["\u200e\u200e\u0645\u0646\u0634\u0627\u0621\u062a \u0627\u0644\u062e\u0627\u0644\u062f\u0647-mahara\u200e \u2013 14\\10\u200e", "2026-10-15", 32.63, 3],
    ["\u200e\u200e\u0645\u0646\u0634\u0627\u0621\u062a \u0627\u0644\u062e\u0627\u0644\u062f\u0647-mahara\u200e \u2013 14\\10\u200e", "2026-10-16", 0.91, 0],
    ["\u200e\u200e\u0645\u0646\u0634\u0627\u0621\u062a \u0627\u0644\u062e\u0627\u0644\u062f\u0647-mahara\u200e \u2013 14\\10\u200e", "2026-10-17", 19.43, 1],
    ["\u200e\u200e\u0645\u0646\u0634\u0627\u0621\u062a \u0627\u0644\u062e\u0627\u0644\u062f\u0647-mahara\u200e \u2013 14\\10\u200e", "2026-10-18", 11.65, 1],
  ];
  // cockpit_media_booking_events by campaign and booking day, 12 to 22 Oct (22 Oct is today, after the window).
  const BOOKED: [string, string, number][] = [
    ["Arcturus-Mahara-3\\9", "2026-10-12", 1],
    ["Arcturus-Mahara-3\\9", "2026-10-14", 1],
    ["Arcturus-Mahara-3\\9", "2026-10-15", 1],
    ["Arcturus-Mahara-3\\9", "2026-10-17", 1],
    ["Arcturus-Mahara-3\\9", "2026-10-19", 1],
    ["Ardon_mahar-22\\9", "2026-10-13", 1],
    ["Ardon_mahar-22\\9", "2026-10-14", 3],
    ["Ardon_mahar-22\\9", "2026-10-15", 2],
    ["Ardon_mahar-22\\9", "2026-10-22", 1],
    ["Atlantis-mahara-13\\9", "2026-10-12", 1],
    ["Atlantis-mahara-13\\9", "2026-10-20", 1],
    ["Atlantis-mahara-7\\10", "2026-10-18", 1],
    ["Atlantis-mahara-7\\10", "2026-10-20", 2],
    ["Atlantis-mahara-7\\10", "2026-10-21", 1],
    ["CASTELLO-MAHARA-19\\10", "2026-10-21", 2],
    ["CASTELLO-MAHARA-19\\10", "2026-10-22", 1],
    ["CASTELLO-MAHARA-6\\10", "2026-10-19", 1],
    ["Marble|MAHARA|13\\10", "2026-10-17", 2],
    ["Marble|MAHARA|13\\10", "2026-10-20", 2],
    ["Marble|MAHARA|13\\10", "2026-10-21", 1],
    ["Merge Studio | Instant Form | Leads | Oct2026 | MHM\u2122", "2026-10-12", 2],
    ["Merge Studio | Instant Form | Leads | Oct2026 | MHM\u2122", "2026-10-13", 1],
    ["Merge Studio | Instant Form | Leads | Oct2026 | MHM\u2122", "2026-10-14", 1],
    ["Merge Studio | Instant Form | Leads | Oct2026 | MHM\u2122", "2026-10-15", 2],
    ["Merge Studio | Instant Form | Leads | Oct2026 | MHM\u2122", "2026-10-17", 1],
    ["Merge Studio | Instant Form | Leads | Oct2026 | MHM\u2122", "2026-10-19", 1],
    ["Merge Studio | Instant Form | Leads | Oct2026 | MHM\u2122", "2026-10-20", 3],
    ["Merge Studio | Instant Form | Leads | Oct2026 | MHM\u2122", "2026-10-21", 2],
    ["Ola|mahara|13\\9", "2026-10-13", 4],
    ["Ola|mahara|13\\9", "2026-10-14", 1],
    ["Ola|mahara|13\\9", "2026-10-18", 1],
    ["Ola|mahara|13\\9", "2026-10-20", 2],
    ["Ola|mahara|13\\9", "2026-10-22", 2],
    ["Safad | MAHARA | 16-8", "2026-10-15", 1],
    ["Safad | MAHARA | 16-8", "2026-10-20", 1],
    ["Shades|mahara|17\\10", "2026-10-18", 1],
    ["Shades|mahara|17\\10", "2026-10-19", 1],
    ["Shades|mahara|17\\10", "2026-10-20", 2],
    ["Shades|mahara|17\\10", "2026-10-21", 2],
    ["Shades|mahara|17\\10", "2026-10-22", 1],
    ["city wood-mahara-12\\9", "2026-10-20", 3],
    ["city wood-mahara-12\\9", "2026-10-21", 4],
    ["city wood-mahara-12\\9", "2026-10-22", 2],
    ["ocean home-mahara-9\\9", "2026-10-12", 1],
    ["ocean home-mahara-9\\9", "2026-10-13", 3],
    ["ocean home-mahara-9\\9", "2026-10-15", 2],
    ["ocean home-mahara-9\\9", "2026-10-18", 1],
    ["ocean home-mahara-9\\9", "2026-10-19", 4],
    ["ocean home-mahara-9\\9", "2026-10-20", 2],
    ["ocean home-mahara-9\\9", "2026-10-22", 2],
    ["\u200e\u200e\u0645\u0646\u0634\u0627\u0621\u062a \u0627\u0644\u062e\u0627\u0644\u062f\u0647-mahara\u200e \u2013 14\\10\u200e", "2026-10-20", 1],
    ["\u200e\u200e\u0645\u0646\u0634\u0627\u0621\u062a \u0627\u0644\u062e\u0627\u0644\u062f\u0647-mahara\u200e \u2013 14\\10\u200e", "2026-10-22", 1],
  ];
  // The cards as ClickUp held them on 22 Oct: [CPL (7d), Cost Per Lead, Cost Per Booking, Bookings (7d), Last Updated].
  const BOARD: Record<string, [string | null, string | null, string | null, string | null, number]> = {
    "86eyn6c1f": ["14.63", "Above KPI", "Pending", null, 1791342000000],
    "86eyudahw": ["16.75", "At KPI", "Above KPI", "8", 1791342000000],
    "86eywa446": ["18.79", "Pending", "Pending", null, 1791342000000],
    "86eywcnhy": ["9.52", "Above KPI", "Above KPI", "14", 1791342000000],
    "86eywnz2x": ["7.7", null, null, null, 1791342000000],
    "z8xmdvdz8v": ["16.72", "Above KPI", "Pending", null, 1791342000000],
    "z8xmdveh57": ["10.31", null, null, null, 1791342000000],
    "z8xmdvfphd": [null, "Pending", "Pending", null, 1791082800000],
    "z8xmdvfpj2": ["10.39", "Pending", "Pending", null, 1791342000000],
    "z8xmdvg5fy": ["6.73", "Pending", "Pending", null, 1791342000000],
    "z8xmdvgf5g": [null, "Pending", "Pending", null, 1791342000000],
    "z8xmdvhntx": [null, "Pending", "Pending", null, 1791860400000],
    "z8xmdvhtwm": [null, "Pending", "Pending", null, 1791946800000],
    "z8xmdvj7bj": [null, "Pending", "Pending", null, 1792206000000],
    "z8xmdvjgzm": [null, "Pending", "Pending", null, 1792378800000],
    "z8xmdvjgzn": [null, "Pending", "Pending", null, 1792378800000],
    "z8xmdvjt0g": [null, "Pending", "Pending", null, 1792465200000],
    "z8xmdvjt3v": [null, "Pending", "Pending", null, 1792465200000],
  };
  const LABEL = { "Above KPI": 0, "At KPI": 1, "Below KPI": 2, "911": 3, Pending: 4 } as Record<string, number>;
  const field = (id: string, value: unknown) => ({ id, value, type_config: id === FIELD.cplStatus ? { options: options("cpl-") } : id === FIELD.cpbStatus ? { options: options("cpb-") } : {} });
  const tasks = Object.entries(BOARD).map(([id, [cpl7d, cpl, cpb, b7, lu]]) => ({
    id,
    name: ROWS.find(r => r[0] === id)![1],
    custom_fields: [
      ...(cpl7d === null ? [] : [field(FIELD.cpl7d, cpl7d)]),
      ...(cpl === null ? [] : [field(FIELD.cplStatus, LABEL[cpl])]),
      ...(cpb === null ? [] : [field(FIELD.cpbStatus, LABEL[cpb])]),
      ...(b7 === null ? [] : [field(FIELD.bookings7d, b7)]),
      field(FIELD.lastUpdated, String(lu)),
    ],
  }));
  const AT = Date.parse("2026-10-22T20:49:28Z");
  const plan = planKpi(
    inputs({
      weekFrom: "2026-10-15",
      weekThrough: "2026-10-21",
      latestPublishAt: "2026-10-22T23:38:36.976838+03:00",
      campaigns: ROWS.map(([taskId, campaignName, spend7d, leads7d, bookings7d, cpl]) => ({
        campaignName, clientName: campaignName, taskId, internal: false, spend7d, leads7d, cpl, ...(bookings7d === null ? {} : { bookings7d }),
      })),
      daily: DAILY.map(([campaignName, day, spend, leads]) => ({ campaignName, day, spend, leads })),
      bookingsByCampaign: BOOKED.map(([campaignName, day, n]) => ({ campaignName, day, booked: n })),
    }),
    tasks,
    FIELDS,
    AT,
  );
  const card = (taskId: string) => plan.cards.find(c => c.taskId === taskId)!;
  const cell = (taskId: string, fieldId: string) => card(taskId).writes.find(w => w.fieldId === fieldId)?.new;

  it("every card agrees with both ledgers, so none is skipped or held", () => {
    expect(plan.refused).toBeUndefined();
    expect(plan.cards).toHaveLength(18);
    expect(plan.cards.filter(c => c.skipped || c.held).map(c => c.taskName)).toEqual([]);
    expect(plan.cards.every(c => c.stamped)).toBe(true);
  });

  it("counts 15 to 21 Oct, never the bookings made today (22 Oct)", () => {
    const expected: [string, number, string | undefined][] = [
      ["86eywa446", 7, "At KPI"], // City Wood $332.17 / 7 = $47.45 (9 with today's 2)
      ["86eywcnhy", 3, "At KPI"], // Ola $166.84 / 3 = $55.61 (5 with today's 2)
      ["86eywnz2x", 9, "Above KPI"], // Ocean $252.82 / 9 = $28.09
      ["86eyudahw", 3, "Below KPI"], // Arcturus $208.43 / 3 = $69.48
      ["86eyn6c1f", 2, "Above KPI"], // SAFAD $5.78 / 2
      ["z8xmdvdz8v", 0, "911"], // Alkhalil, no booking on $254.64
      ["z8xmdveh57", 2, "Below KPI"], // Ardon $162.47 / 2 = $81.23
      ["z8xmdvfphd", 9, "Above KPI"], // Merge $169.81 / 9 = $18.87
      ["z8xmdvg5fy", 1, "911"], // Castello 6\10 $206.53 / 1
      ["z8xmdvjgzm", 2, "Above KPI"], // Castello 19\10 $74.33 / 2 = $37.17
      ["z8xmdvgf5g", 4, "Above KPI"], // Atlantis 7\10 $122.82 / 4 = $30.71
      ["z8xmdvjgzn", 0, "Below KPI"], // Atlantis 19\10, no booking on $86.25
      ["z8xmdvhntx", 5, "Above KPI"], // Marble $184.56 / 5 = $36.91
      ["z8xmdvhtwm", 1, "Below KPI"], // Khalida 14\10 $64.62 / 1
      ["z8xmdvj7bj", 6, "Above KPI"], // Shades $230.25 / 6 = $38.38
      ["z8xmdvjt0g", 0, undefined], // monshaat 20\10, $45.98: too early
      ["z8xmdvjt3v", 0, undefined], // madana 20\10, $46.31: too early
    ];
    for (const [taskId, bookings, band] of expected)
      expect([taskId, cell(taskId, FIELD.bookings7d), cell(taskId, FIELD.cpbStatus)]).toEqual([taskId, bookings, band]);
    expect(cell("z8xmdvfpj2", FIELD.bookings7d)).toBeUndefined();
  });

  it("writes the CPL the board would show, and names the oldest Last Updated", () => {
    expect(cell("z8xmdveh57", FIELD.cpl7d)).toBe(23.21);
    expect(cell("z8xmdveh57", FIELD.cplStatus)).toBe("911");
    expect(cell("86eywa446", FIELD.cpl7d)).toBe(10.07);
    expect(cell("z8xmdvjt0g", FIELD.cpl7d)).toBeUndefined();
    // The 9 cards with numbers all read 7 Oct; the other 9 carry only the date they were made
    // (4, 7, 13, 14, 17, 19 and 20 Oct) and show no numbers, so 7 Oct is the board's age.
    expect(new Date(plan.oldestLastUpdated!).toISOString()).toBe("2026-10-07T03:00:00.000Z");
    expect([plan.noNumbers, plan.undated]).toEqual([9, 0]);
    // The health line's board sentence on the live board (section 4's R12 check expects 7 Oct).
    expect(boardAge(plan)).toBe("The board still shows numbers last updated 7 Oct 2026. 9 cards show no numbers yet.");
  });
});
