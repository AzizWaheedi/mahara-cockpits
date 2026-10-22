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
    { clientId: "acc-t", name: "Triple Edge", clickupTaskId: null, status: null, locationIds: [] },
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
      { client: "Triple Edge", spend: 9.25, why: "This ad account is tied to no client card or board row, so its bookings are not read." },
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
    expect(w.notMeasured.map(x => x.client)).toEqual(["Beta", "Pidco", "Triple Edge"]);
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
      { date: day(14), spend: 169.25, leads: 11, bookings: 3, confirmed: 2, provisional: 1, spendMeasured: 160 },
      { date: day(15), spend: 80.5, leads: 3, bookings: 2, confirmed: 2, provisional: 0, spendMeasured: 50 },
      { date: day(16), spend: 40, leads: 1, bookings: 1, confirmed: 1, provisional: 0, spendMeasured: 0 },
      { date: day(17), spend: 0, leads: 0, bookings: 0, confirmed: null, provisional: null, spendMeasured: null },
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
