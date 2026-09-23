/** Extensions, time to first launch and the average retainer: the pure rules. */
import { describe, expect, test } from "bun:test";
import {
  averageRetainer,
  createdDayOf,
  daysToLaunchOf,
  type ExtensionGrant,
  fold,
  matchCard,
  parseExtensionResponses,
  planWrites,
  summariseExtensions,
  summariseLaunch,
} from "../convex/ceo/extensions";

const CLIENT_REF = "5145ff0c-009b-4f51-b3a9-4651efc908be";
const DURATION_REF = "278c2f80-88bd-428e-b330-8c6b3175d63f";

const response = (
  id: string,
  submitted: string,
  client: string,
  label: string,
) => ({
  response_id: id,
  submitted_at: submitted,
  answers: [
    {
      field: { ref: CLIENT_REF, type: "short_text" },
      type: "text",
      text: client,
    },
    {
      field: { ref: DURATION_REF, type: "multiple_choice" },
      type: "choice",
      choice: { label },
    },
  ],
});

const grant = (
  id: string,
  day: string,
  client: string,
  weeks: number,
  until: string,
): ExtensionGrant => ({
  id,
  submittedAt: Date.parse(`${day}T09:00:00+03:00`),
  day,
  client,
  weeks,
  until,
});

const TODAY = "2026-09-21";

describe("fold", () => {
  test("keeps letters and digits in any script, lower case", () => {
    expect(fold(" Décor-Plus 2 ")).toBe("décorplus2");
    expect(fold("عيادة النهضة")).toBe("عيادةالنهضة");
    expect(fold(null)).toBe("");
  });
});

describe("parseExtensionResponses", () => {
  test("reads the client, the weeks and the Kuwait days; the clock starts at submission", () => {
    const grants = parseExtensionResponses([
      // 22:30 UTC is 01:30 the next day in Kuwait.
      response("b", "2026-09-14T22:30:00Z", "Nahda Clinics", "2 WEEKS"),
      response("a", "2026-09-02T10:00:00Z", " Decor Plus ", "1 week"),
    ]);
    expect(grants.map(g => g.id)).toEqual(["a", "b"]);
    expect(grants[1]).toMatchObject({
      client: "Nahda Clinics",
      weeks: 2,
      day: "2026-09-15",
      until: "2026-09-29",
    });
    expect(grants[0]).toMatchObject({
      client: "Decor Plus",
      weeks: 1,
      day: "2026-09-02",
      until: "2026-09-09",
    });
  });
  test("reads the duration from a dropdown delivered as a text answer", () => {
    const grants = parseExtensionResponses([
      {
        response_id: "d",
        submitted_at: "2026-09-14T08:00:00Z",
        answers: [
          {
            field: { ref: CLIENT_REF, type: "dropdown" },
            type: "text",
            text: "Zed Co",
          },
          {
            field: { ref: DURATION_REF, type: "dropdown" },
            type: "text",
            text: "1 WEEK",
          },
        ],
      },
    ]);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({
      client: "Zed Co",
      weeks: 1,
      day: "2026-09-14",
      until: "2026-09-21",
    });
  });
  test("skips a response with no client, an unknown duration or no time", () => {
    expect(
      parseExtensionResponses([
        response("x", "2026-09-02T10:00:00Z", "   ", "1 WEEK"),
        response("y", "2026-09-02T10:00:00Z", "Someone", "3 WEEKS"),
        response("z", "not a date", "Someone", "1 WEEK"),
        { answers: null },
        null,
      ]),
    ).toEqual([]);
  });
});

describe("matchCard", () => {
  const cards = [
    { taskId: "t1", name: "Nahda Clinics" },
    { taskId: "t2", name: "Nahda" },
    { taskId: "t3", name: "Decor Plus - Riyadh" },
  ];
  test("folds names and matches either way round", () => {
    expect(matchCard("decor plus", cards)?.taskId).toBe("t3");
    expect(matchCard("Decor Plus Riyadh (extension)", cards)?.taskId).toBe(
      "t3",
    );
    expect(matchCard("Someone Else", cards)).toBeNull();
  });
  test("an exact fold wins, then the longest card name", () => {
    expect(matchCard("nahda", cards)?.taskId).toBe("t2");
    expect(matchCard("Nahda Clinics!", cards)?.taskId).toBe("t1");
    expect(matchCard("Nahda Clinics Jeddah", cards)?.taskId).toBe("t1");
    expect(
      matchCard("Al Salam Clinic", [
        { taskId: "a", name: "Al" },
        { taskId: "b", name: "Al Salam Clinic" },
      ])?.taskId,
    ).toBe("b");
  });
  test("typed text under four characters matches nothing", () => {
    expect(matchCard("Al", cards)).toBeNull();
    expect(matchCard("", cards)).toBeNull();
  });
});

describe("summariseExtensions", () => {
  const cards = [
    { taskId: "t1", name: "Nahda Clinics" },
    { taskId: "t3", name: "Decor Plus" },
    { taskId: "t4", name: "Zed Co" },
  ];
  const grants = [
    grant("g6", "2026-07-30", "Nahda Clinics", 1, "2026-08-06"),
    grant("g1", "2026-08-20", "Nahda Clinics", 4, "2026-09-17"),
    grant("g4", "2026-08-28", "Zed Co", 4, "2026-09-25"),
    grant("g2", "2026-09-03", "Decor Plus", 1, "2026-09-10"),
    grant("g5", "2026-09-10", "Unknown Name", 1, "2026-09-17"),
    grant("g3", "2026-09-15", "decor plus", 2, "2026-09-29"),
    grant("g8", "2026-09-14", "INTERNAL TEST Lifecycle 2026-09-14", 1, TODAY),
  ];
  const s = summariseExtensions(grants, cards, TODAY);
  test("a test submission is counted apart and never a client's extension", () => {
    expect(s.internalTest).toBe(1);
    expect(s.perClient.some(p => /internal test/i.test(p.client))).toBe(false);
  });
  test("month to date, with last month beside it", () => {
    expect(s.from).toBe("2026-09-01");
    expect(s.to).toBe(TODAY);
    expect(s.totalWeeks).toBe(4);
    expect(s.grants).toBe(3);
    expect(s.lastMonth).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
      totalWeeks: 8,
      grants: 2,
    });
    expect(s.unmatched).toBe(1);
    expect(s.newestAt).toBe(grants[5].submittedAt);
  });
  test("per client: weeks in the window, the latest end day, live today; sorted by weeks", () => {
    expect(s.perClient).toEqual([
      {
        client: "Decor Plus",
        clickupTaskId: "t3",
        weeks: 3,
        until: "2026-09-29",
        live: true,
      },
      {
        client: "Unknown Name",
        clickupTaskId: null,
        weeks: 1,
        until: "2026-09-17",
        live: false,
      },
      // Granted last month, still running: listed so the live count and the list agree.
      {
        client: "Zed Co",
        clickupTaskId: "t4",
        weeks: 0,
        until: "2026-09-25",
        live: true,
      },
    ]);
  });
  test("a client whose cover ended before the window is not listed", () => {
    expect(s.perClient.some(p => p.client === "Nahda Clinics")).toBe(false);
  });
  test("cover that ends today is still live", () => {
    const t = summariseExtensions(
      [grant("g", "2026-09-14", "Zed Co", 1, TODAY)],
      cards,
      TODAY,
    );
    expect(t.perClient[0]).toMatchObject({ live: true, until: TODAY });
  });
});

describe("createdDayOf and daysToLaunchOf", () => {
  test("the creation day is the anchor day minus the sync's days since creation", () => {
    expect(createdDayOf(10, "2026-09-21")).toBe("2026-09-11");
    expect(createdDayOf(0, "2026-09-21")).toBe("2026-09-21");
    expect(createdDayOf("7", "2026-09-21")).toBe("2026-09-14");
    expect(createdDayOf(null, "2026-09-21")).toBeNull();
    expect(createdDayOf(undefined, "2026-09-21")).toBeNull();
    expect(createdDayOf(-1, "2026-09-21")).toBeNull();
    expect(createdDayOf(3, "not a day")).toBeNull();
  });
  test("days to launch needs a creation day and a Launch Date that has arrived", () => {
    expect(daysToLaunchOf("2026-09-01", "2026-09-15", TODAY)).toBe(14);
    expect(daysToLaunchOf("2026-09-01", "2026-10-01", TODAY)).toBeNull();
    expect(daysToLaunchOf(null, "2026-09-15", TODAY)).toBeNull();
    expect(daysToLaunchOf("2026-09-01", "15/09/2026", TODAY)).toBeNull();
    expect(daysToLaunchOf("2026-09-10", "2026-09-05", TODAY)).toBe(-5);
  });
});

describe("summariseLaunch", () => {
  const row = (
    client: string,
    bucket: string | null,
    createdDay: string | null,
    launchDate: string | null,
    internal = false,
  ) => ({
    client,
    clickupTaskId: client.toLowerCase(),
    bucket,
    internal,
    createdDay,
    launchDate,
  });
  const s = summariseLaunch(
    [
      row("A", "active", "2026-09-01", "2026-09-15"),
      row("B", "active", "2026-08-01", "2026-09-10"),
      row("C", "onboarding", "2026-09-05", null),
      row("D", "active", "2026-09-01", "2026-10-01"),
      row("E", "churned", "2026-08-20", "2026-09-05"),
      row("F", "active", "2026-09-10", "2026-09-05"),
      row("G", "paused", "2026-08-01", null),
      row("Playing Account", "active", "2026-01-01", "2026-02-01", true),
      row("I", "active", null, "2026-09-01"),
    ],
    TODAY,
  );
  test("average and median over launched clients, slowest first", () => {
    expect(s.rows.map(r => [r.client, r.days])).toEqual([
      ["B", 40],
      ["E", 16],
      ["A", 14],
    ]);
    expect(s.clients).toBe(3);
    expect(s.averageDays).toBe(23.3);
    expect(s.medianDays).toBe(16);
  });
  test("not launched counts live clients only, a future Launch Date included", () => {
    expect(s.notLaunched).toBe(2);
  });
  test("cards created after their launch and cards with no creation day are named, not counted", () => {
    expect(s.createdAfterLaunch).toEqual(["F"]);
    expect(s.noCreatedDay).toBe(1);
  });
  test("an even count takes the middle two", () => {
    const t = summariseLaunch(
      [
        row("A", "active", "2026-09-01", "2026-09-11"),
        row("B", "active", "2026-09-01", "2026-09-21"),
      ],
      TODAY,
    );
    expect(t.medianDays).toBe(15);
    expect(t.averageDays).toBe(15);
  });
  test("nothing launched is null, not zero", () => {
    const t = summariseLaunch(
      [row("C", "onboarding", "2026-09-05", null)],
      TODAY,
    );
    expect(t.averageDays).toBeNull();
    expect(t.medianDays).toBeNull();
    expect(t.notLaunched).toBe(1);
  });
});

describe("averageRetainer", () => {
  test("mean MRR over active cards on a recurring plan, nothing else", () => {
    expect(
      averageRetainer([
        { name: "A", stage: "Active", mrrUsd: 1000, paymentPlan: "Monthly" },
        {
          name: "B",
          stage: "Active",
          mrrUsd: 2000,
          paymentPlan: "Paid In Full",
        },
        { name: "C", stage: "Active", mrrUsd: 3000, paymentPlan: undefined },
        {
          name: "D",
          stage: "Active",
          mrrUsd: undefined,
          paymentPlan: "Monthly",
        },
        { name: "E", stage: "Paused", mrrUsd: 500, paymentPlan: "Monthly" },
        {
          name: "Playing Account",
          stage: "Active",
          mrrUsd: 3000,
          paymentPlan: "Monthly",
        },
        {
          name: "F",
          stage: "Active",
          mrrUsd: 1500,
          paymentPlan: "Monthly (12 months)",
        },
      ]),
    ).toEqual({ averageUsd: 1250, cards: 2 });
  });
  test("no qualifying card is null, not zero", () => {
    expect(averageRetainer([])).toEqual({ averageUsd: null, cards: 0 });
  });
});

describe("planWrites", () => {
  const cards = [
    { taskId: "t1", name: "Nahda Clinics", stage: "Active" },
    { taskId: "t3", name: "Decor Plus", stage: "Active" },
    { taskId: "t4", name: "Zed Co", stage: "Paused" },
    { taskId: "t5", name: "Gone Co", stage: "Stopped" },
  ];
  const { writes, skipped } = planWrites(
    [
      grant("g1", "2026-08-20", "Nahda Clinics", 4, "2026-09-17"),
      grant("g4", "2026-08-28", "Zed Co", 4, "2026-09-25"),
      grant("g2", "2026-09-03", "Decor Plus", 1, "2026-09-10"),
      grant("g3", "2026-09-15", "Decor Plus", 2, "2026-09-29"),
      grant("g5", "2026-09-10", "Unknown Name", 1, "2026-09-17"),
      grant("g7", "2026-09-18", "Gone Co", 1, "2026-09-25"),
      grant("g8", "2026-09-14", "INTERNAL TEST Lifecycle 2026-09-14", 1, TODAY),
    ],
    [
      ...cards,
      {
        taskId: "t9",
        name: "[INTERNAL TEST] Lifecycle 2026-09-14",
        stage: "Active",
      },
    ],
    TODAY,
  );
  test("the live grant's weeks, 0 once it has ended, only on cards the form has named", () => {
    expect(writes).toEqual([
      {
        taskId: "t3",
        client: "Decor Plus",
        weeks: 2,
        until: "2026-09-29",
        grantedDay: "2026-09-15",
      },
      {
        taskId: "t1",
        client: "Nahda Clinics",
        weeks: 0,
        until: "2026-09-17",
        grantedDay: "2026-08-20",
      },
      {
        taskId: "t4",
        client: "Zed Co",
        weeks: 4,
        until: "2026-09-25",
        grantedDay: "2026-08-28",
      },
    ]);
  });
  test("a card that has gone is skipped, and an unmatched response touches nothing", () => {
    expect(skipped).toBe(1);
    expect(writes.some(w => w.client === "Gone Co")).toBe(false);
  });
});
