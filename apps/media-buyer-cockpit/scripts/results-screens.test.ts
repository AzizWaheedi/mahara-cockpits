/**
 * The results and speed screens, below the glass (Muhammed, 2026-10-21): the sums the screens work out from
 * the database's reads (src/lib/resultsModel.ts), the shapes they accept (src/lib/resultsReads.ts), the words
 * a failed read becomes, and the files the media buyer and client success cockpits share, which must stay
 * equal. The screens themselves are held in results-screens.test.tsx (here) and in the client success
 * cockpit's own results-screens.test.tsx. Every client, lead and number is made up (src/dev/resultsFixture.ts).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  callListFixture,
  gapClientFixture,
  gapFixture,
  morningFixture,
  speedFixture,
} from "../src/dev/resultsFixture";
import {
  BANDS,
  calledText,
  dayText,
  GAP_DAYS,
  gapAside,
  gapWindow,
  kuwaitToday,
  MIN_LEADS,
  MORNING_GROUPS,
  morningGroups,
  percent,
  plural,
  queuedText,
  rateText,
  shiftDay,
  speedBands,
  speedCountries,
  speedHours,
  speedWindow,
  stampText,
  waitingText,
} from "../src/lib/resultsModel";
import {
  CallListSchema,
  GapClientSchema,
  GapReportSchema,
  MorningSchema,
  parseRead,
  ReadShapeError,
  readProblem,
  type SpeedCell,
  SpeedSchema,
} from "../src/lib/resultsReads";

const APP = join(import.meta.dir, "..");
const OTHER = join(APP, "../client-success-cockpit");
const SCENARIOS = ["default", "empty", "few", "unread", "allcalled"] as const;

describe("days on Kuwait's calendar", () => {
  test("Kuwait's day turns at 21:00 UTC", () => {
    expect(kuwaitToday(Date.UTC(2026, 9, 21, 20, 59))).toBe("2026-10-21");
    expect(kuwaitToday(Date.UTC(2026, 9, 21, 21, 0))).toBe("2026-10-22");
  });

  test("shiftDay crosses a month and a year", () => {
    expect(shiftDay("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });

  test("the gap report asks for the last 14 days, today included", () => {
    expect(GAP_DAYS).toBe(14);
    expect(gapWindow("2026-10-21")).toEqual({ from: "2026-10-08", to: "2026-10-21" });
  });

  test("the speed chart asks for 30, 60 or 90 days up to today", () => {
    expect(speedWindow("30", "2026-10-21")).toEqual({ from: "2026-09-22", to: "2026-10-21" });
    expect(speedWindow("60", "2026-10-21")).toEqual({ from: "2026-08-23", to: "2026-10-21" });
    expect(speedWindow("90", "2026-10-21")).toEqual({ from: "2026-07-24", to: "2026-10-21" });
  });

  test("days and moments read as Kuwait time, and nothing is invented for a bad value", () => {
    expect(dayText("2026-10-21")).toBe("Wed 21 Oct");
    expect(stampText("2026-10-21T10:05:00Z")).toBe("Wed 21 Oct, 13:05");
    expect(dayText("not a day")).toBe("not a day");
    expect(stampText("not a moment")).toBe("not a moment");
  });

  test("counts and shares: a share never comes from nothing", () => {
    expect(plural(1, "meeting")).toBe("1 meeting");
    expect(plural(0, "meeting")).toBe("0 meetings");
    expect(plural(1234, "lead")).toBe("1,234 leads");
    expect(percent(0.4333)).toBe("43%");
    expect(percent(0)).toBe("0%");
    expect(percent(null)).toBeNull();
    expect(percent(undefined)).toBeNull();
    expect(percent(Number.NaN)).toBeNull();
    expect(rateText(18)).toBe("18.0");
    expect(rateText(18.46)).toBe("18.5");
  });
});

describe("the gap report's words", () => {
  test("a client's row names what the two columns leave out", () => {
    expect(gapAside({ sheetMissing: 1, sheetUnclear: 2 })).toBe(
      "1 not in the sheet, 2 unclear in the sheet",
    );
    expect(gapAside({ sheetMissing: 0, sheetUnclear: 3 })).toBe("3 unclear in the sheet");
    expect(gapAside({ sheetMissing: 0, sheetUnclear: 0 })).toBeNull();
  });
});

describe("the speed chart's sums", () => {
  const cells: SpeedCell[] = [
    [9, "KW", "up_to_30m", 40, 10, 10],
    [9, "SA", "up_to_30m", 10, 1, 1],
    [10, "KW", "over_24h", 100, 12, 12],
    [10, "KW", "no_call", 29, 5, 5],
  ];

  test("bands run in speed order, an empty band is left out, every lead counts once", () => {
    const { bands, total } = speedBands(cells);
    expect(bands.map(b => b.key)).toEqual(["up_to_30m", "over_24h", "no_call"]);
    expect(bands.map(b => [b.leads, b.bookings])).toEqual([
      [50, 11],
      [100, 12],
      [29, 5],
    ]);
    expect(bands.reduce((a, b) => a + b.leads, 0)).toBe(total.leads);
    expect(total).toMatchObject({ key: "all", leads: 179, bookings: 28, per100: 15.6 });
  });

  test("a rate is bookings per 100 leads with one decimal", () => {
    const { bands } = speedBands(cells);
    expect(bands[0].per100).toBe(22);
    expect(bands[1].per100).toBe(12);
  });

  test("a band under the minimum shows no rate at all, not a small one", () => {
    expect(MIN_LEADS).toBe(30);
    const { bands } = speedBands(cells);
    expect(bands[2]).toMatchObject({ leads: 29, per100: null, tooFew: true });
    const exactly = speedBands([[9, "KW", "up_to_30m", 30, 3, 3]]).bands[0];
    expect(exactly).toMatchObject({ per100: 10, tooFew: false });
  });

  test("the hour and the country filters narrow the same cells, and they combine", () => {
    expect(speedBands(cells, { hour: 9, country: null }).total.leads).toBe(50);
    expect(speedBands(cells, { hour: null, country: "KW" }).total.leads).toBe(169);
    const one = speedBands(cells, { hour: 9, country: "SA" });
    expect(one.total).toMatchObject({ leads: 10, bookings: 1, per100: null });
    expect(one.bands).toHaveLength(1);
  });

  test("a pick with no leads has no bands and no rate, never a rate of 0", () => {
    const none = speedBands(cells, { hour: 23, country: null });
    expect(none.bands).toEqual([]);
    expect(none.total).toMatchObject({ leads: 0, bookings: 0, per100: null });
    expect(speedBands([]).total.per100).toBeNull();
  });

  test("the pickers list only what has leads, with the lead counts under the other filter", () => {
    expect(speedHours(cells)).toEqual([
      { hour: 9, leads: 50 },
      { hour: 10, leads: 129 },
    ]);
    expect(speedHours(cells, "SA")).toEqual([{ hour: 9, leads: 10 }]);
    expect(speedCountries(cells)).toEqual([
      { country: "KW", leads: 169 },
      { country: "SA", leads: 10 },
    ]);
    expect(speedCountries(cells, 9)).toEqual([
      { country: "KW", leads: 40 },
      { country: "SA", leads: 10 },
    ]);
  });

  test("on the fixture, every hour and country adds up to the same leads whichever way it is cut", () => {
    const { cells: all } = speedFixture("2026-08-23", "2026-10-21", "clock");
    const whole = speedBands(all).total;
    const cut = (f: (c: SpeedCell) => boolean) => all.filter(f).reduce((a, c) => a + c[3], 0);
    expect(whole.leads).toBe(cut(() => true));
    expect(speedHours(all).reduce((a, h) => a + h.leads, 0)).toBe(whole.leads);
    expect(speedCountries(all).reduce((a, c) => a + c.leads, 0)).toBe(whole.leads);
    for (const h of speedHours(all))
      expect(speedBands(all, { hour: h.hour, country: null }).total.leads).toBe(h.leads);
    for (const c of speedCountries(all))
      expect(speedBands(all, { hour: null, country: c.country }).total.leads).toBe(c.leads);
    expect(BANDS.map(b => b.key)).toContain("clock_unknown");
  });
});

describe("the morning list's groups", () => {
  const morning = morningFixture();

  test("three groups in the order the caller works them", () => {
    expect(MORNING_GROUPS.map(g => g.key)).toEqual(["never_called", "outcome_only", "phone_only"]);
    expect(MORNING_GROUPS.map(g => g.title)).toEqual([
      "Never called",
      "Result saved, no call",
      "Probably called",
    ]);
    const g = morningGroups(morning.leads);
    expect(Object.keys(g)).toEqual(["never_called", "outcome_only", "phone_only"]);
    expect(g.never_called).toHaveLength(morning.totals.neverCalled);
    expect(g.outcome_only).toHaveLength(morning.totals.outcomeOnly);
    expect(g.phone_only).toHaveLength(morning.totals.phoneOnly);
  });

  test("every lead sits in one group, longest waiting first", () => {
    const g = morningGroups(morning.leads);
    const all = [...g.never_called, ...g.outcome_only, ...g.phone_only];
    expect(all).toHaveLength(morning.leads.length);
    expect(new Set(all.map(l => `${l.locationId}:${l.contactId}`)).size).toBe(all.length);
    for (const list of Object.values(g))
      for (let i = 1; i < list.length; i++)
        expect(list[i - 1].hoursWaiting ?? 0).toBeGreaterThanOrEqual(list[i].hoursWaiting ?? 0);
  });

  test("paid ads only and a client narrow the list to what the database counted for them", () => {
    const paid = morningGroups(morning.leads, { paidOnly: true, location: null });
    expect(Object.values(paid).flat()).toHaveLength(morning.totals.uncalledPaid);
    const client = morning.clients.find(c => c.noCallLinked > 0);
    if (!client) throw new Error("The fixture has a client with leads.");
    const mine = morningGroups(morning.leads, { paidOnly: false, location: client.locationId });
    expect(Object.values(mine).flat()).toHaveLength(client.noCallLinked);
  });

  test("how long a lead has waited: hours, then days, nothing when the database gave no time", () => {
    expect(waitingText(0.4)).toBe("under 1 h");
    expect(waitingText(5.4)).toBe("5 h");
    expect(waitingText(47.6)).toBe("48 h");
    expect(waitingText(48)).toBe("2 days");
    expect(waitingText(100)).toBe("4 days");
    expect(waitingText(null)).toBeNull();
    expect(waitingText(undefined)).toBeNull();
    expect(waitingText(Number.NaN)).toBeNull();
  });
});

describe("the CSM call list's words", () => {
  test("clients past the five are one line, with how many meetings each is missing", () => {
    expect(queuedText(callListFixture().rows)).toBe("Falcon Dental (2), Pearl Fitness (1)");
    expect(queuedText(callListFixture("empty").rows)).toBeNull();
  });

  test("a called client says who and when, and falls back to the email, then to a teammate", () => {
    const row = callListFixture().rows[1];
    expect(calledText(row)).toMatch(/^Sara Najjar, \w{3} \d{1,2} \w{3,4}, 13:05$/);
    expect(calledText({ ...row, calledByName: null })).toMatch(/^sara, /);
    expect(calledText({ ...row, calledByName: null, calledBy: null })).toMatch(/^A teammate, /);
    expect(calledText(callListFixture().rows[0])).toBeNull();
  });
});

describe("the shapes a read must have", () => {
  test("every answer the fixtures give is one the page reads", () => {
    for (const s of SCENARIOS) {
      parseRead(GapReportSchema, gapFixture("2026-10-08", "2026-10-21", s), "gap");
      parseRead(CallListSchema, callListFixture(s), "calls");
      parseRead(MorningSchema, morningFixture(null, s), "morning");
      parseRead(SpeedSchema, speedFixture("2026-08-23", "2026-10-21", "clock", s), "speed");
      parseRead(SpeedSchema, speedFixture("2026-08-23", "2026-10-21", "working", s), "speed");
    }
    const one = gapClientFixture("locFixResults01", "2026-10-08", "2026-10-21");
    expect(one).not.toBeNull();
    parseRead(GapClientSchema, one, "client");
    expect(gapClientFixture("nobody", "2026-10-08", "2026-10-21")).toBeNull();
  });

  test("the gap fixture is sorted most missing first and its totals add up", () => {
    const g = gapFixture("2026-10-08", "2026-10-21");
    for (let i = 1; i < g.rows.length; i++)
      expect(g.rows[i - 1].noResult).toBeGreaterThanOrEqual(g.rows[i].noResult);
    expect(g.totals.noResult).toBe(g.rows.reduce((a, r) => a + r.noResult, 0));
    expect(g.totals.meetings).toBe(g.rows.reduce((a, r) => a + r.meetings, 0));
  });

  test("a wrong shape is refused with a sentence, never shown as zeros", () => {
    const good = gapFixture("2026-10-08", "2026-10-21");
    let error: unknown;
    try {
      parseRead(GapReportSchema, { ...good, rows: "none" }, "meetings with no result");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ReadShapeError);
    expect((error as Error).message).toBe(
      "The meetings with no result came back in a shape this page cannot read (rows). Tell the CEO.",
    );
    expect(() => parseRead(CallListSchema, null, "call list")).toThrow(
      "The call list came back in a shape this page cannot read (top). Tell the CEO.",
    );
    const speed = speedFixture("2026-08-23", "2026-10-21");
    expect(() =>
      parseRead(SpeedSchema, { ...speed, cells: [[9, "KW", "up_to_30m", "40", 1, 1]] }, "speed"),
    ).toThrow(ReadShapeError);
  });
});

describe("a failed read, in one plain sentence", () => {
  test("the database's own refusals are shown as written", () => {
    expect(
      readProblem({ code: "42501", message: "The call list is for the client success seat." }),
    ).toBe("The call list is for the client success seat.");
    expect(
      readProblem({ code: "22023", message: "That client is not on this week's call list." }),
    ).toBe("That client is not on this week's call list.");
  });

  test("a timeout, a missing read, a dead sign-in and a lost connection say what to do", () => {
    expect(readProblem({ code: "57014", message: "canceling statement due to statement timeout" })).toBe(
      "This took too long to answer. Try again, or pick a shorter time frame.",
    );
    expect(readProblem({ code: "PGRST202", message: "Could not find the function" })).toBe(
      "This read is not on the database yet. Tell the CEO.",
    );
    expect(readProblem({ message: "JWT expired" })).toBe("Your sign-in has expired. Reload the page.");
    expect(readProblem(new TypeError("Failed to fetch"))).toBe(
      "This could not be reached. Check the connection and try again.",
    );
  });

  test("anything else is the same plain line, and a shape error keeps its own", () => {
    const failed = "This did not load. Try again; if it keeps failing, tell the CEO.";
    expect(readProblem(null)).toBe(failed);
    expect(readProblem({ code: "XX000", message: "internal error at relation 17" })).toBe(failed);
    expect(readProblem(new ReadShapeError("The speed numbers came back in a shape this page cannot read (cells). Tell the CEO."))).toBe(
      "The speed numbers came back in a shape this page cannot read (cells). Tell the CEO.",
    );
  });
});

describe("the files the two cockpits share", () => {
  const read = (root: string, file: string) =>
    readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n");
  const SHARED = [
    "src/lib/resultsReads.ts",
    "src/lib/resultsModel.ts",
    "src/components/results/ResultsKit.tsx",
    "src/components/results/GapReport.tsx",
    "src/dev/resultsFixture.ts",
  ];

  for (const file of SHARED)
    test(`${file} is the same in the media buyer and client success cockpits`, () => {
      expect(read(OTHER, file)).toBe(read(APP, file));
    });

  test("each cockpit has the screens only its seat uses, and no copy of the other's", () => {
    expect(existsSync(join(APP, "src/components/results/SpeedChart.tsx"))).toBe(true);
    expect(existsSync(join(APP, "src/components/results/MorningList.tsx"))).toBe(true);
    expect(existsSync(join(OTHER, "src/components/results/CallList.tsx"))).toBe(true);
    expect(existsSync(join(APP, "src/components/results/CallList.tsx"))).toBe(false);
    expect(existsSync(join(OTHER, "src/components/results/SpeedChart.tsx"))).toBe(false);
  });
});

describe("the words on the screens", () => {
  const FILES = [
    [APP, "src/lib/resultsModel.ts"],
    [APP, "src/components/results/ResultsKit.tsx"],
    [APP, "src/components/results/GapReport.tsx"],
    [APP, "src/components/results/SpeedChart.tsx"],
    [APP, "src/components/results/MorningList.tsx"],
    [APP, "src/pages/performance/ResultsViews.tsx"],
    [OTHER, "src/components/results/CallList.tsx"],
  ] as const;

  for (const [root, file] of FILES)
    test(`${file} has no em dash and no emoji`, () => {
      const text = readFileSync(join(root, file), "utf8");
      expect(text).not.toContain("—");
      expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
    });
});
