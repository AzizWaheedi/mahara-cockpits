/**
 * The Delivery tab's client rules (Aziz, 2026-09-21): which calendar is which
 * booking group, when a past appointment counts as shown or as having no
 * outcome, the client status rule and the cost of a shown booking.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import * as nativeDelivery from "../../../hermes/ceo-refresh/native/adapters/delivery.js";
import * as native from "../../../hermes/ceo-refresh/native/constants.js";
import * as csKpi from "../../client-success-cockpit/src/lib/kpi";
import {
  clientStatus,
  costPerShownAt60,
  deliveryRates,
  tooEarly,
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
  test("bad on cost per booking over the bad line, or a bad cost per lead with no booking inside the gate; a low show rate alone is watch", () => {
    expect(clientStatus({ ...base, cpbConfirmed: CPB_BAD + 0.01 })).toBe("bad");
    // The golden rule (R5, 2026-10-22): a cost per lead over $22.50 under a
    // cost per booking within the gate is a watch, never off track.
    expect(clientStatus({ ...base, cpl: CPL_GATE * 1.5 + 0.01 })).toBe("watch");
    expect(clientStatus({ ...base, leads: 0, cpl: null })).toBe("watch");
    // Over the gate, a bad cost per lead makes it bad.
    expect(
      clientStatus({ ...base, cpbConfirmed: 70, cpl: CPL_GATE * 1.5 + 0.01 }),
    ).toBe("bad");
    // Aziz (2026-09-21): 60% is the one show rate line for clients, there is no 40.
    expect(clientStatus({ ...base, showRate: 0.2 })).toBe("watch");
  });
  test("watch in between, and when the show rate is unknown", () => {
    expect(clientStatus({ ...base, cpl: 18 })).toBe("watch");
    expect(clientStatus({ ...base, cpbConfirmed: 70 })).toBe("watch");
    expect(clientStatus({ ...base, showRate: 0.5 })).toBe("watch");
    expect(clientStatus({ ...base, showRate: null })).toBe("watch");
    expect(clientStatus({ ...base, cpbConfirmed: CPB_BAD })).toBe("watch");
  });
  test("no confirmed booking yet: the spend counts as the cost per booking", () => {
    // $300 with no booking is over $80: bad (was a watch before the rule).
    expect(clientStatus({ ...base, cpbConfirmed: null })).toBe("bad");
    expect(
      clientStatus({ ...base, cpbConfirmed: null, confirmed: 0, spend: 70 }),
    ).toBe("watch");
    expect(
      clientStatus({
        ...base,
        cpbConfirmed: null,
        confirmed: 0,
        spend: 70,
        cpl: 25,
      }),
    ).toBe("bad");
    // Up to $60: too early to judge, a watch, bad only on a bad cost per lead or no leads.
    const early = { ...base, cpbConfirmed: null, confirmed: 0, spend: 45 };
    expect(clientStatus(early)).toBe("watch");
    expect(tooEarly(early)).toBe(true);
    expect(clientStatus({ ...early, leads: 0, cpl: null })).toBe("bad");
    expect(tooEarly({ ...early, leads: 0, cpl: null })).toBe(false);
    // Measured spend is what counts: $300 spent, $50 of it on stored days.
    expect(
      clientStatus({
        ...base,
        cpbConfirmed: null,
        confirmed: 0,
        spendMeasured: 50,
      }),
    ).toBe("watch");
    expect(tooEarly({ ...base, cpbConfirmed: 30, confirmed: 1 })).toBe(false);
  });
  test("bookings not measured: cost per lead alone", () => {
    const off = { ...base, cpbConfirmed: null, confirmed: null };
    expect(clientStatus(off)).toBe("watch");
    expect(clientStatus({ ...off, cpl: 25 })).toBe("bad");
    expect(tooEarly(off)).toBe(false);
  });
  test("the 14 to 20 Oct 2026 clients read as the audit expects (R5)", () => {
    const at = (
      spend: number,
      leads: number,
      confirmed: number | null,
      showRate: number | null = null,
    ) => ({
      spend,
      leads,
      cpl: leads > 0 ? Math.round((spend / leads) * 100) / 100 : null,
      confirmed,
      cpbConfirmed:
        confirmed && confirmed > 0
          ? Math.round((spend / confirmed) * 100) / 100
          : null,
      showRate,
      weBook: true,
    });
    expect(clientStatus(at(174.53, 5, 4))).toBe("watch"); // Atlantis, CPL $34.91
    expect(clientStatus(at(233.36, 17, 0))).toBe("bad"); // Alkhalil, no booking
    expect(clientStatus(at(354, 32, 3))).toBe("bad"); // City Wood $118.00
    expect(clientStatus(at(268.48, 20, 1))).toBe("bad"); // Castello
    expect(clientStatus(at(91.62, 6, 1))).toBe("bad"); // Khalida
    expect(clientStatus(at(242.48, 39, 4, 0.7))).toBe("watch"); // Arcturus $60.62
  });
  test("the native refresh and the TS twin judge every case the same", () => {
    const spends = [0, 30, 59, 61, 79, 81, 300];
    const cpls = [null, 10, 15, 18, 22.5, 23];
    const cpbs = [null, 40, 60, 61, 80, 81];
    const shows = [null, 0.5, 0.6];
    const confirmeds = [undefined, null, 0, 2];
    // Spend on the days the board stores bookings: absent (all of it), a
    // part under each line, or none of it.
    const measured = [undefined, 0, 45, 70, 90];
    let n = 0;
    for (const spend of spends)
      for (const cpl of cpls)
        for (const cpbConfirmed of cpbs)
          for (const showRate of shows)
            for (const confirmed of confirmeds)
              for (const spendMeasured of measured)
                for (const weBook of [true, false]) {
                  const x = {
                    spend,
                    leads:
                      cpl === null ? 0 : Math.max(1, Math.round(spend / cpl)),
                    cpl,
                    cpbConfirmed,
                    showRate,
                    weBook,
                    confirmed,
                    spendMeasured,
                  };
                  expect(nativeDelivery.clientStatus(x)).toBe(clientStatus(x));
                  expect(nativeDelivery.tooEarly(x)).toBe(tooEarly(x));
                  n += 1;
                }
    expect(n).toBeGreaterThan(25000);
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
    expect(native.CPB_GATE).toBe(kpi.CPB_GATE);
    expect(native.CPL_GATE).toBe(kpi.CPL_GATE);
    expect(native.CPB_BAD).toBe(kpi.CPB_BAD);
    expect(native.BOOKING_RATE_GATE).toBe(kpi.BOOKING_RATE_GATE);
    expect(native.CLOSE_RATE_GATE).toBe(kpi.CLOSE_RATE_GATE);
  });
  // Aziz, 2026-10-13: "The CSM: make it $15 cost per lead and $60 cost per
  // booking." The client success cockpit holds the same file.
  test("the client success cockpit judges on the same gates", () => {
    // Values only: the two copies' functions are different objects.
    const values = (m: Record<string, unknown>) =>
      JSON.stringify(
        Object.entries(m).filter(([, v]) => typeof v !== "function"),
      );
    expect(values(csKpi)).toBe(values(kpi));
    expect(
      readFileSync(
        join(APP, "../client-success-cockpit/src/lib/kpi.ts"),
        "utf8",
      ),
    ).toBe(readFileSync(join(APP, "src/lib/kpi.ts"), "utf8"));
  });
  test("are Aziz's numbers", () => {
    expect(SHOW_RATE_GOOD).toBe(60);
    expect(CPB_BAD).toBe(80);
    expect(CPL_GATE * 1.5).toBe(22.5);
    expect(kpi.CPL_GATE).toBe(15);
    expect(kpi.CPB_GATE).toBe(60);
  });
  // Aziz, 2026-10-12: "the show rate metric is 60%, so anything around that is
  // fine, not 70%". One client line everywhere, and under it is watch.
  test("one client show rate line, the same in every copy", () => {
    expect(native.SHOW_RATE_GOOD).toBe(kpi.SHOW_RATE_GOOD);
    expect(csKpi.SHOW_RATE_GOOD).toBe(kpi.SHOW_RATE_GOOD);
    for (const file of [
      "src/lib/kpi.ts",
      "../client-success-cockpit/src/lib/kpi.ts",
      "convex/constants.ts",
      "../../hermes/ceo-refresh/native/constants.js",
    ])
      expect(readFileSync(join(APP, file), "utf8")).not.toContain(
        "SHOW_RATE_GATE",
      );
    expect("SHOW_RATE_GATE" in kpi).toBe(false);
    expect("SHOW_RATE_GATE" in native).toBe(false);
  });
  // Aziz, 2026-10-13: "The October KPI is what we shoot for, but I don't want
  // to make that the main constraint." The aim sits above the line, never in
  // its place.
  test("the show rate aim is 70, above the line and never the line", () => {
    expect(kpi.SHOW_RATE_AIM).toBe(70);
    expect(native.SHOW_RATE_AIM).toBe(kpi.SHOW_RATE_AIM);
    expect(csKpi.SHOW_RATE_AIM).toBe(kpi.SHOW_RATE_AIM);
    expect(kpi.SHOW_RATE_AIM).toBeGreaterThan(kpi.SHOW_RATE_GOOD);
    expect(kpi.SHOW_RATE_GOOD).toBe(60);
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
    // The aim may be said (Aziz, 2026-10-13): "we aim for 70%" is not a line
    // or a target. It is taken out before the line is read, so the rest of
    // the line is still judged.
    const aim = /\b(?:we )?aims? for 70 ?%/gi;
    const judged = (line: string) => bad.test(line.replace(aim, ""));
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
            if (judged(line) && !own.test(line)) hits.push(`${path}:${i + 1}`);
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
      "the client show rate target 70%",
      "show rate line 70%",
      "Show rate: 70% target",
      "| Show rate on confirmed | 70% |",
      "show rate: we aim for 75%",
      "show rate: we aim for 70%, target 75%",
      "show rate: we aim for 70%; the line is 70%",
    ])
      expect(judged(line)).toBe(true);
    for (const line of [
      "booking→show 60% (under it is watch, never the constraint)",
      "show rate (we aim for 70%; 60% is the line, under it is a watch, not a fix)",
      "| Show rate on confirmed | 60%; we aim for 70%, 60% is the line, under it is a watch, never the main constraint |",
      "booking→show 60% (aim for 70%; 60% is the line, under it is a watch, never the main constraint)",
    ])
      expect(judged(line)).toBe(false);
  });
});
