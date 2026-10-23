import { describe, expect, test } from "bun:test";
import {
  bookingLedger,
  clientBookingWindow,
  daysOf,
  deliveryDaily,
  deliveryWindow,
  measuredSpend,
  storedBookings,
} from "./deliveryClients.js";

/**
 * R2 and R10 (2026-10-22): CEO Delivery pairs spend with the Client
 * Performance board's stored bookings the way the board does. Only spend on
 * a day the board stores a count for every location the client ties to is
 * divided; the rest is named with the reason and never read as zero bookings.
 */
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;

/** Two live clients, a cancelled one the board stores nothing for, and an account tied to no client. */
function fixture() {
  const clients = [
    { clientId: "acc-a", name: "Alpha", clickupTaskId: "task-a", status: "Active", locationIds: ["loc-a"] },
    { clientId: "acc-b", name: "Beta", clickupTaskId: "task-b", status: "Active", locationIds: ["loc-b"] },
    { clientId: "acc-p", name: "Pidco", clickupTaskId: "11", status: "Cancelled", locationIds: ["loc-p"] },
    { clientId: "acc-t", name: "Art Vision", clickupTaskId: null, status: null, locationIds: [] },
  ];
  const days = [
    { clientId: "acc-a", date: day(14), spend: 100, leads: 5 },
    { clientId: "acc-a", date: day(15), spend: 50, leads: 2 },
    { clientId: "acc-b", date: day(14), spend: 60, leads: 4 },
    // Beta's 16 Oct has no stored row: not measured, named.
    { clientId: "acc-b", date: day(16), spend: 40, leads: 1 },
    { clientId: "acc-p", date: day(15), spend: 30.5, leads: 1 },
    { clientId: "acc-t", date: day(14), spend: 9.25, leads: 2 },
  ];
  const bookingDays = [
    { locationId: "loc-a", date: day(14), confirmed: 2, provisional: 1 },
    { locationId: "loc-a", date: day(15), confirmed: 1, provisional: null },
    // A booking made on a day with no spend still counts: bookings often come later.
    { locationId: "loc-a", date: day(16), confirmed: 1, provisional: 0 },
    { locationId: "loc-b", date: day(14), confirmed: 0, provisional: 0 },
    { locationId: "loc-b", date: day(15), confirmed: 1, provisional: 0 },
    // A NULL count is not measured, never zero.
    { locationId: "loc-b", date: day(16), confirmed: null, provisional: null },
    // A location no client here ties to: in no figure.
    { locationId: "loc-x", date: day(14), confirmed: 5, provisional: 0 },
  ];
  return { clients, days, bookingDays };
}

describe("the board's stored days", () => {
  test("daysOf lists every day, inclusive", () => {
    expect(daysOf(day(14), day(16))).toEqual([day(14), day(15), day(16)]);
    expect(daysOf(day(16), day(14))).toEqual([]);
  });

  test("stored bookings sum the stored days and read null when none is stored", () => {
    const t = fixture();
    const ledger = bookingLedger(t);
    expect([...ledger.tied].sort()).toEqual(["loc-a", "loc-b", "loc-p"]);
    expect(storedBookings(ledger, ["loc-a"], day(14), day(16))).toEqual({ confirmed: 4, provisional: 1, stored: 3, provisionalUnread: 1 });
    // A location listed twice counts once.
    expect(storedBookings(ledger, ["loc-a", "loc-a"], day(14), day(14)).confirmed).toBe(2);
    expect(storedBookings(ledger, ["loc-p"], day(14), day(16))).toEqual({ confirmed: null, provisional: null, stored: 0, provisionalUnread: 0 });
    expect(storedBookings(ledger, ["loc-b"], day(16), day(16)).confirmed).toBeNull();
  });
});

describe("spend paired with stored bookings", () => {
  test("only spend on stored days is divided; the rest is named with why", () => {
    const t = fixture();
    const ledger = bookingLedger(t);
    const s = measuredSpend(t, ledger, day(14), day(16));
    expect(s.spend).toBe(289.75);
    expect(s.leads).toBe(15);
    expect(s.spendMeasured).toBe(210);
    expect(s.notMeasured).toEqual([
      { client: "Beta", spend: 40, why: "Bookings are not stored for 1 of the 2 days it spent." },
      { client: "Pidco", spend: 30.5, why: "The card is cancelled: the board stores no booking days for it in these days." },
      { client: "Art Vision", spend: 9.25, why: "This ad account is tied to no client card or board row, so its bookings are not read." },
    ]);
  });

  test("a company window divides measured spend by every stored booking on the tied locations", () => {
    const t = fixture();
    const w = deliveryWindow(t, bookingLedger(t), day(14), day(16));
    expect(w).toMatchObject({
      spend: 289.75,
      leads: 15,
      confirmed: 5,
      provisional: 1,
      bookings: 6,
      spendMeasured: 210,
      cpbConfirmed: 42,
      cpb: 35,
      cpl: 19.32,
    });
    expect(w.notMeasured.map(x => x.client)).toEqual(["Beta", "Pidco", "Art Vision"]);
    expect(w.doneWithYou).toEqual([]);
  });

  test("a window with no stored day is not measured: null counts and no cost, never zero bookings", () => {
    const t = fixture();
    const w = deliveryWindow(t, bookingLedger(t), day(20), day(21));
    expect(w).toMatchObject({ spend: 0, confirmed: null, provisional: null, bookings: null, cpbConfirmed: null, cpb: null, spendMeasured: 0 });
    // Spend on days the board has not stored yet (its refresh stalled): the
    // spend is there, the bookings are not measured, the cost is not divided.
    const stalled = { ...t, days: [...t.days, { clientId: "acc-a", date: day(20), spend: 70, leads: 3 }] };
    const s = deliveryWindow(stalled, bookingLedger(stalled), day(20), day(20));
    expect(s).toMatchObject({ spend: 70, confirmed: null, bookings: null, cpbConfirmed: null, spendMeasured: 0 });
    expect(s.notMeasured).toEqual([{ client: "Alpha", spend: 70, why: "The board stores no booking days for this client in these days." }]);
  });

  test("a stored day of zero bookings is a measured zero, not missing", () => {
    const t = fixture();
    const w = deliveryWindow(t, bookingLedger(t), day(14), day(14));
    // Alpha stores 2 on 14 Oct, Beta 0: the window holds 2 confirmed.
    expect(w.confirmed).toBe(2);
    const b = clientBookingWindow(t, bookingLedger(t), { accountIds: ["acc-b"], locationIds: ["loc-b"] }, day(14), day(14));
    expect(b).toMatchObject({ confirmed: 0, bookings: 0, cpbConfirmed: null, spendMeasured: 60 });
  });

  test("spend is added unrounded and rounded once, so a week never drifts a cent from the board", () => {
    const t = fixture();
    const thirds = {
      ...t,
      days: [
        { clientId: "acc-a", date: day(14), spend: 0.334, leads: 0 },
        { clientId: "acc-a", date: day(15), spend: 0.334, leads: 0 },
        { clientId: "acc-a", date: day(16), spend: 0.334, leads: 0 },
      ],
    };
    const w = deliveryWindow(thirds, bookingLedger(thirds), day(14), day(16));
    // Rounded per day first it would read $0.99.
    expect(w.spend).toBe(1);
    expect(w.spendMeasured).toBe(1);
  });
});

describe("the daily series", () => {
  test("each day carries the board's counts and the spend they pair with; a day with none stored is null", () => {
    const t = fixture();
    const rows = deliveryDaily(t, bookingLedger(t), day(14), day(17));
    expect(rows).toEqual([
      { date: day(14), spend: 169.25, leads: 11, bookings: 3, confirmed: 2, provisional: 1, spendMeasured: 160, spendDoneWithYou: 0 },
      { date: day(15), spend: 80.5, leads: 3, bookings: 2, confirmed: 2, provisional: 0, spendMeasured: 50, spendDoneWithYou: 0 },
      { date: day(16), spend: 40, leads: 1, bookings: 1, confirmed: 1, provisional: 0, spendMeasured: 0, spendDoneWithYou: 0 },
      { date: day(17), spend: 0, leads: 0, bookings: 0, confirmed: null, provisional: null, spendMeasured: null, spendDoneWithYou: 0 },
    ]);
    // The series adds up to the window: one rule, any run of days.
    const w = deliveryWindow(t, bookingLedger(t), day(14), day(16));
    const sum = (k: "confirmed" | "spendMeasured") => rows.reduce((n, r) => n + (r[k] ?? 0), 0);
    expect(sum("confirmed")).toBe(w.confirmed);
    expect(sum("spendMeasured")).toBe(w.spendMeasured);
  });
});

describe("one client's window", () => {
  test("a client the board stores: confirmed, provisional and the cost over measured spend", () => {
    const t = fixture();
    const ledger = bookingLedger(t);
    const a = clientBookingWindow(t, ledger, { accountIds: ["acc-a"], locationIds: ["loc-a"] }, day(14), day(16));
    expect(a).toEqual({ confirmed: 4, provisional: 1, bookings: 5, spendMeasured: 150, cpbConfirmed: 37.5, cpb: 30, why: null });
  });

  test("some days not stored: the cost covers the others and the row says what it leaves out", () => {
    const t = fixture();
    const b = clientBookingWindow(t, bookingLedger(t), { accountIds: ["acc-b"], locationIds: ["loc-b"] }, day(14), day(16));
    expect(b.confirmed).toBe(1);
    expect(b.spendMeasured).toBe(60);
    expect(b.cpbConfirmed).toBe(60);
    expect(b.why).toBe("Bookings are not stored for 1 of the 2 days it spent. Cost per booking covers the other days; $40.00 is left out.");
  });

  test("nothing stored: confirmed null (not measured), never zero", () => {
    const t = fixture();
    const ledger = bookingLedger(t);
    const p = clientBookingWindow(t, ledger, { accountIds: ["acc-p"], locationIds: ["loc-p"] }, day(14), day(16));
    expect(p).toMatchObject({ confirmed: null, provisional: null, bookings: null, cpbConfirmed: null, cpb: null, spendMeasured: 0 });
    expect(p.why).toContain("cancelled");
    const none = clientBookingWindow(t, ledger, { accountIds: ["acc-t"], locationIds: [] }, day(14), day(16));
    expect(none.confirmed).toBeNull();
    expect(none.why).toContain("tied to no client card");
  });
});

/**
 * The CEO's decisions of 23 Oct 2026. Decision 2, "No keep the CPL but ignore
 * CPB": a Done With You client's spend and leads stay in spend, leads and cost
 * per lead, and its spend and stored bookings leave every company cost per
 * booking, named. Decision 5, "triple edge is a old churned client": a
 * churned client's account (cockpit_churned_ad_accounts, status "Churned",
 * no board location) is named as a churned client's, never as tied to no
 * client, and its spend stays in the totals.
 */
describe("done with you and churned (23 Oct 2026)", () => {
  function more() {
    const t = fixture();
    return {
      clients: [
        ...t.clients,
        { clientId: "acc-n", name: "نهوض نجد", clickupTaskId: "task-n", status: "Active", serviceMode: "DWY", locationIds: ["loc-n"] },
        { clientId: "acc-c", name: "Triple Edge Building Construction", clickupTaskId: null, status: "Churned", locationIds: [] },
      ],
      days: [
        ...t.days,
        { clientId: "acc-n", date: day(14), spend: 120.5, leads: 9 },
        { clientId: "acc-n", date: day(15), spend: 71.83, leads: 7 },
        { clientId: "acc-c", date: day(15), spend: 6.97, leads: 1 },
      ],
      bookingDays: [
        ...t.bookingDays,
        // The board stores 2 confirmed for the Done With You client: facts
        // on its own row, never in a company cost per booking.
        { locationId: "loc-n", date: day(14), confirmed: 2, provisional: 1, serviceMode: "DWY" },
        { locationId: "loc-n", date: day(15), confirmed: 0, provisional: 0, serviceMode: "dwy" },
      ],
    };
  }

  test("the ledger knows the Done With You locations and accounts", () => {
    const ledger = bookingLedger(more());
    expect([...ledger.dwyLocs]).toEqual(["loc-n"]);
    expect([...ledger.dwyAccounts]).toEqual(["acc-n"]);
    // Its stored bookings stay facts on its own locations.
    expect(storedBookings(ledger, ["loc-n"], day(14), day(16)).confirmed).toBe(2);
  });

  test("a Done With You account's spend and 2 stored bookings leave the cost per booking; spend, leads and cost per lead keep them", () => {
    const t = more();
    const w = deliveryWindow(t, bookingLedger(t), day(14), day(16));
    expect(w).toMatchObject({
      // 289.75 + 192.33 (done with you) + 6.97 (churned)
      spend: 489.05,
      leads: 32,
      cpl: 15.28,
      // Unchanged from the window without them: 210 over 5 confirmed.
      confirmed: 5,
      provisional: 1,
      bookings: 6,
      spendMeasured: 210,
      cpbConfirmed: 42,
      cpb: 35,
    });
    expect(w.doneWithYou).toEqual([{ client: "نهوض نجد", spend: 192.33 }]);
    // Done with you is named as such, never as not measured.
    expect(w.notMeasured.map(x => x.client)).not.toContain("نهوض نجد");
  });

  test("the churned account is named with its own sentence, its spend not divided and not dropped", () => {
    const t = more();
    const s = measuredSpend(t, bookingLedger(t), day(14), day(16));
    expect(s.spendMeasured).toBe(210);
    expect(s.notMeasured).toEqual([
      { client: "Beta", spend: 40, why: "Bookings are not stored for 1 of the 2 days it spent." },
      { client: "Pidco", spend: 30.5, why: "The card is cancelled: the board stores no booking days for it in these days." },
      { client: "Art Vision", spend: 9.25, why: "This ad account is tied to no client card or board row, so its bookings are not read." },
      { client: "Triple Edge Building Construction", spend: 6.97, why: "This is a churned client's ad account, so its bookings are not read." },
    ]);
    // The untied account keeps its own sentence.
    expect(s.notMeasured.filter(x => x.why.includes("tied to no client")).map(x => x.client)).toEqual(["Art Vision"]);
  });

  test("the daily series leaves Done With You out of the counts and the measured spend, and carries its spend apart", () => {
    const t = more();
    const rows = deliveryDaily(t, bookingLedger(t), day(14), day(15));
    expect(rows).toEqual([
      { date: day(14), spend: 289.75, leads: 20, bookings: 3, confirmed: 2, provisional: 1, spendMeasured: 160, spendDoneWithYou: 120.5 },
      { date: day(15), spend: 159.3, leads: 11, bookings: 2, confirmed: 2, provisional: 0, spendMeasured: 50, spendDoneWithYou: 71.83 },
    ]);
    // The series still adds up to the window, one rule for any run of days.
    const w = deliveryWindow(t, bookingLedger(t), day(14), day(15));
    expect(rows.reduce((n, r) => n + (r.confirmed ?? 0), 0)).toBe(w.confirmed);
    expect(rows.reduce((n, r) => n + (r.spendMeasured ?? 0), 0)).toBe(w.spendMeasured);
    expect(Math.round(rows.reduce((n, r) => n + r.spendDoneWithYou, 0) * 100) / 100).toBe(w.doneWithYou[0].spend);
  });

  test("the client's own window divides nothing and names no gap", () => {
    const t = more();
    const n = clientBookingWindow(t, bookingLedger(t), { accountIds: ["acc-n"], locationIds: ["loc-n"] }, day(14), day(16));
    expect(n).toMatchObject({ spendMeasured: 0, cpbConfirmed: null, why: null });
  });

  test("a mixed card is left out per account: each day keeps the mode of the account that spent it", () => {
    // Alpha's card also runs a Done With You account, folded into Alpha's row
    // by triage.js: its day carries that account's mode.
    const t = fixture();
    t.days = [
      ...t.days.map(d => ({ ...d, serviceMode: d.clientId === "acc-a" ? "DFY" : null })),
      { clientId: "acc-a", date: day(14), spend: 25, leads: 2, serviceMode: "DWY" },
    ];
    const w = deliveryWindow(t, bookingLedger(t), day(14), day(16));
    expect(w).toMatchObject({ spend: 314.75, leads: 17, spendMeasured: 210, confirmed: 5 });
    expect(w.doneWithYou).toEqual([{ client: "Alpha", spend: 25 }]);
    // The other way round: a Done With You card whose other account we book for.
    const u = fixture();
    u.clients[0] = { ...u.clients[0], serviceMode: "DWY" };
    u.days = u.days.map(d => ({
      ...d,
      serviceMode: d.clientId !== "acc-a" ? null : d.date === day(15) ? "DFY" : "DWY",
    }));
    const v = deliveryWindow(u, bookingLedger(u), day(14), day(16));
    // Alpha's $100 on the 14th (DWY account) is left out; its $50 on the 15th is measured.
    expect(v.doneWithYou).toEqual([{ client: "Alpha", spend: 100 }]);
    expect(v.spendMeasured).toBe(110);
    const rows = deliveryDaily(u, bookingLedger(u), day(14), day(15));
    expect(rows.map(r => r.spendDoneWithYou)).toEqual([100, 0]);
    expect(rows.map(r => r.spendMeasured)).toEqual([60, 50]);
  });

  test("a blank or other mode is not done with you", () => {
    const t = more();
    t.clients[4] = { ...t.clients[4], serviceMode: "" };
    t.bookingDays = t.bookingDays.map(r => (r.locationId === "loc-n" ? { ...r, serviceMode: "DFY" } : r));
    const w = deliveryWindow(t, bookingLedger(t), day(14), day(16));
    expect(w.doneWithYou).toEqual([]);
    expect(w.confirmed).toBe(7);
    expect(w.spendMeasured).toBe(402.33);
  });
});
