/**
 * The Delivery tab's client rules (Aziz, 2026-09-21): which calendar is which
 * booking group, when a past appointment counts as shown or as having no
 * outcome, the client status rule and the cost of a shown booking.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as native from "../../../hermes/ceo-refresh/native/constants.js";
import * as clientGates from "../../client-success-cockpit/src/lib/clientGates";
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
import { rateTone } from "../src/pages/ceo/DeliveryTab";

/** The media buyer app's folder. */
const APP = join(import.meta.dir, "..");

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
  // Aziz, 2026-10-12: "the show rate metric is 60%, so anything around that is
  // fine, not 70%". One client line everywhere, and under it is watch.
  test("one client show rate line, the same in every copy", () => {
    expect(native.SHOW_RATE_GOOD).toBe(kpi.SHOW_RATE_GOOD);
    expect(clientGates.SHOW_RATE_GOOD).toBe(kpi.SHOW_RATE_GOOD);
    for (const file of [
      "src/lib/kpi.ts",
      "convex/constants.ts",
      "../../hermes/ceo-refresh/native/constants.js",
    ])
      expect(readFileSync(join(APP, file), "utf8")).not.toContain(
        "SHOW_RATE_GATE",
      );
    expect("SHOW_RATE_GATE" in kpi).toBe(false);
    expect("SHOW_RATE_GATE" in native).toBe(false);
  });
  test("a client show rate under the line is amber, never red", () => {
    expect(rateTone(60, SHOW_RATE_GOOD, 0)).toBe("good");
    expect(rateTone(59.9, SHOW_RATE_GOOD, 0)).toBe("warning");
    for (const p of [41, 20, 0])
      expect(rateTone(p, SHOW_RATE_GOOD, 0)).toBe("warning");
    // The other rates keep their floor at seven tenths of the gate.
    expect(rateTone(17, 25)).toBe("serious");
    expect(rateTone(18, 25)).toBe("warning");
    const delivery = readFileSync(
      join(APP, "src/pages/ceo/DeliveryTab.tsx"),
      "utf8",
    );
    expect(delivery).toMatch(/gate=\{SHOW_RATE_GOOD\}\s+bad=\{0\}/);
  });
  test("no client show rate text says 70% or 75%", () => {
    const roots = [
      "../client-success-cockpit/src",
      "../client-success-cockpit/scripts",
      "../../supabase/functions/cockpit-csm-api",
      "../../hermes/cockpit-client-success",
      "../../hermes/cockpit-ask-ai/references/mahara-context/client-launch-campaign",
      "../../hermes/cockpit-ask-ai/references/mahara-context/b2b-marketing-ops/SKILL.md",
      "../../context/meta-ads-skill-pack/mahara-context/b2b-marketing-ops/SKILL.md",
      "../../CEO_COCKPIT_PLAN.md",
      "../../viktor-side-scripts/csm",
      "convex/ceo/scorecardSeed.ts",
      "convex/reportDocs.ts",
    ];
    // "show rate 75%", "a show rate over 70%", "booking→show 75%" and the
    // plan's "| Showed | OUT-07 | 75% |" row are all the client line.
    const bad = new RegExp(
      [
        String.raw`showRate:\s*7[05]\b`,
        String.raw`show rate[^\n]{0,40}\b7[05] ?%`,
        String.raw`booking\s*(?:→|->|to)\s*show\b[^\n]{0,20}\b7[05] ?%`,
        String.raw`\|\s*Showed\s*\|[^|\n]*\|\s*7[05] ?%`,
      ].join("|"),
      "i",
    );
    // Mahara's own intro and demo show rates are the sales team's lines, not
    // the client line, and keep their own numbers.
    const own = /\b(intro|demo)/i;
    const hits: string[] = [];
    const scan = (path: string) => {
      if (statSync(path).isDirectory()) {
        for (const name of readdirSync(path))
          if (name !== "node_modules" && name !== "dist")
            scan(join(path, name));
      } else if (/\.(ts|tsx|js|md|json|py)$/.test(path))
        readFileSync(path, "utf8")
          .split("\n")
          .forEach((line, i) => {
            if (bad.test(line) && !own.test(line))
              hits.push(`${path}:${i + 1}`);
          });
    };
    for (const root of roots) scan(join(APP, root));
    expect(hits).toEqual([]);
    // The guard itself catches each way the old line was written.
    for (const line of [
      "show rate 75%",
      "a show rate over 70%",
      "booking→show 75% · show→close 20%",
      "| Showed | OUT-07 | 75% |",
      "showRate: 75,",
    ])
      expect(bad.test(line)).toBe(true);
    expect(
      bad.test("booking→show 60% (under it is watch, never the constraint)"),
    ).toBe(false);
  });
});
