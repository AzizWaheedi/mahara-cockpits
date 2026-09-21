/**
 * The Delivery tab's client rules (Aziz, 2026-09-21): which calendar is which
 * booking group, when a past appointment counts as shown or as having no
 * outcome, the client status rule and the cost of a shown booking.
 */
import { describe, expect, test } from "bun:test";
import {
  clientStatus,
  costPerShownAt60,
  deliveryRates,
} from "../convex/ceo/adapters/delivery";
import {
  attendanceOf,
  calendarKind,
  hasNoOutcome,
  isBookingKind,
  isWon,
} from "../convex/ceo/data/triage";
import {
  CPB_BAD,
  CPB_GATE,
  CPL_GATE,
  SHOW_RATE_GOOD,
} from "../convex/constants";
import * as kpi from "../src/lib/kpi";

describe("calendarKind", () => {
  test("splits the booking calendars into main, online and provisional", () => {
    expect(calendarKind("Main Appointment Calendar")).toBe("main");
    expect(calendarKind("A. Appointment Calendar (In Office)")).toBe("main");
    expect(calendarKind("A. Appointment Calendar (In Home)")).toBe("main");
    expect(calendarKind("A. Appointment Calendar (Online)")).toBe("online");
    expect(calendarKind("Not Confirmed Appointments")).toBe("provisional");
  });
  test("holds the rest apart", () => {
    expect(calendarKind("A. Reschedule Calendar")).toBe("reschedule");
    expect(calendarKind("Callback Calendar [AGENTS ONLY]")).toBe("callback");
    expect(calendarKind("🔔 Callback Request (طلب معاودة الاتصال)")).toBe(
      "callback",
    );
    expect(calendarKind("Follow Up Call")).toBe("other");
    expect(calendarKind("Consultation")).toBe("other");
    expect(calendarKind("Mahara Appointment AI TEST ONLY")).toBe("other");
    expect(calendarKind("📞مكالمة تعريفية لحصول المشاريع")).toBe("other");
    expect(calendarKind(null)).toBe("other");
    expect(calendarKind("")).toBe("other");
  });
  test("only the three groups are bookings", () => {
    expect(isBookingKind("main")).toBe(true);
    expect(isBookingKind("online")).toBe(true);
    expect(isBookingKind("provisional")).toBe(true);
    expect(isBookingKind("reschedule")).toBe(false);
    expect(isBookingKind("callback")).toBe(false);
    expect(isBookingKind("other")).toBe(false);
  });
});

describe("attendanceOf", () => {
  const none = { attended: null, outcome: null };
  test("the CRM status wins when it says showed or noshow", () => {
    expect(attendanceOf({ status: "showed", ...none })).toBe("showed");
    expect(attendanceOf({ status: "noshow", ...none })).toBe("noshow");
    expect(
      attendanceOf({
        status: "noshow",
        attended: true,
        outcome: { attendance: "showed", deal: null },
      }),
    ).toBe("noshow");
  });
  test("then the attendance sheet, then Mahara OS", () => {
    expect(
      attendanceOf({ status: "confirmed", attended: true, outcome: null }),
    ).toBe("showed");
    expect(
      attendanceOf({ status: "confirmed", attended: false, outcome: null }),
    ).toBe("noshow");
    expect(
      attendanceOf({
        status: "confirmed",
        attended: null,
        outcome: { attendance: "showed", deal: "pending" },
      }),
    ).toBe("showed");
    expect(
      attendanceOf({
        status: "confirmed",
        attended: null,
        outcome: { attendance: "no_show", deal: "lost" },
      }),
    ).toBe("noshow");
  });
  test("a past appointment nobody marked is unknown, as are cancelled and invalid", () => {
    expect(attendanceOf({ status: "confirmed", ...none })).toBe("unknown");
    expect(attendanceOf({ status: "new", ...none })).toBe("unknown");
    expect(
      attendanceOf({
        status: "confirmed",
        attended: null,
        outcome: { attendance: "unknown", deal: "pending" },
      }),
    ).toBe("unknown");
    expect(
      attendanceOf({ status: "cancelled", attended: true, outcome: null }),
    ).toBe("unknown");
    expect(
      attendanceOf({ status: "invalid", attended: true, outcome: null }),
    ).toBe("unknown");
  });
});

describe("hasNoOutcome and isWon", () => {
  test("no outcome means no Mahara OS row and no sheet mark", () => {
    expect(hasNoOutcome({ attended: null, outcome: null })).toBe(true);
    expect(hasNoOutcome({ attended: true, outcome: null })).toBe(false);
    expect(hasNoOutcome({ attended: false, outcome: null })).toBe(false);
    expect(
      hasNoOutcome({
        attended: null,
        outcome: { attendance: "unknown", deal: "unknown" },
      }),
    ).toBe(false);
  });
  test("won is the Mahara OS deal alone", () => {
    expect(isWon({ outcome: { attendance: "showed", deal: "won" } })).toBe(
      true,
    );
    expect(isWon({ outcome: { attendance: "showed", deal: "pending" } })).toBe(
      false,
    );
    expect(isWon({ outcome: null })).toBe(false);
  });
});

describe("deliveryRates", () => {
  test("three booking rates, the show rate and the close rate", () => {
    const r = deliveryRates({
      leads: 40,
      bookings: 10,
      provisional: 2,
      confirmed: 8,
      showed: 4,
      noshow: 2,
      closes: 1,
      noOutcome: 3,
    });
    expect(r.bookRate).toBe(0.25);
    expect(r.bookRateConfirmed).toBe(0.2);
    expect(r.bookRateProvisional).toBe(0.05);
    expect(r.showRate).toBe(0.667);
    expect(r.closeRate).toBe(0.25);
    expect(r.noOutcome).toBe(3);
  });
  test("a zero denominator gives null, never zero", () => {
    const r = deliveryRates({
      leads: 0,
      bookings: 0,
      provisional: 0,
      confirmed: 0,
      showed: 0,
      noshow: 0,
      closes: 0,
      noOutcome: 0,
    });
    expect(r.bookRate).toBeNull();
    expect(r.bookRateConfirmed).toBeNull();
    expect(r.bookRateProvisional).toBeNull();
    expect(r.showRate).toBeNull();
    expect(r.closeRate).toBeNull();
  });
});

describe("clientStatus", () => {
  const base = {
    spend: 300,
    leads: 30,
    cpl: 10,
    cpbConfirmed: 50,
    showRate: 0.7,
    weBook: true,
  };
  test("good needs all three gates", () => {
    expect(clientStatus(base)).toBe("good");
    expect(clientStatus({ ...base, cpl: CPL_GATE })).toBe("good");
    expect(clientStatus({ ...base, cpbConfirmed: CPB_GATE })).toBe("good");
    expect(clientStatus({ ...base, showRate: SHOW_RATE_GOOD / 100 })).toBe(
      "good",
    );
  });
  test("bad on cost per booking, cost per lead, or spend with no leads; a low show rate alone is watch", () => {
    expect(clientStatus({ ...base, cpbConfirmed: CPB_BAD + 0.01 })).toBe("bad");
    expect(clientStatus({ ...base, cpl: CPL_GATE * 1.5 + 0.01 })).toBe("bad");
    // Aziz (2026-09-21): 60% is the one show rate line for clients, there is no 40.
    expect(clientStatus({ ...base, showRate: 0.2 })).toBe("watch");
    expect(clientStatus({ ...base, leads: 0, cpl: null })).toBe("bad");
  });
  test("watch in between, and when the show rate is unknown", () => {
    expect(clientStatus({ ...base, cpl: 18 })).toBe("watch");
    expect(clientStatus({ ...base, cpbConfirmed: 70 })).toBe("watch");
    expect(clientStatus({ ...base, showRate: 0.5 })).toBe("watch");
    expect(clientStatus({ ...base, showRate: null })).toBe("watch");
    expect(clientStatus({ ...base, cpbConfirmed: null })).toBe("watch");
    expect(clientStatus({ ...base, cpbConfirmed: CPB_BAD })).toBe("watch");
  });
  test("no spend is no data", () => {
    expect(clientStatus({ ...base, spend: 0 })).toBe("no-data");
  });
  test("a Done With You client is judged on cost per lead alone", () => {
    const dwy = { ...base, weBook: false, cpbConfirmed: null, showRate: null };
    expect(clientStatus(dwy)).toBe("good");
    expect(clientStatus({ ...dwy, cpl: 20 })).toBe("watch");
    expect(clientStatus({ ...dwy, cpl: 25 })).toBe("bad");
  });
});

describe("costPerShownAt60", () => {
  test("cost per confirmed booking over the good show rate", () => {
    expect(costPerShownAt60(60)).toBe(100);
    expect(costPerShownAt60(45)).toBe(75);
    expect(costPerShownAt60(null)).toBeNull();
  });
});

describe("the gates", () => {
  test("are the same on both sides", () => {
    expect(kpi.SHOW_RATE_GOOD).toBe(SHOW_RATE_GOOD);
    expect(kpi.CPB_BAD).toBe(CPB_BAD);
    expect(kpi.CPB_GATE).toBe(CPB_GATE);
    expect(kpi.CPL_GATE).toBe(CPL_GATE);
  });
  test("are Aziz's numbers", () => {
    expect(SHOW_RATE_GOOD).toBe(60);
    expect(CPB_BAD).toBe(80);
    expect(CPL_GATE * 1.5).toBe(22.5);
  });
});
