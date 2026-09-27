import { describe, expect, test } from "bun:test";
import {
  appendWithVersion,
  applyGuestChanges,
  blocksFor,
  buildRrule,
  endRrule,
  guestUpdates,
  overdue,
  patchWithRetry,
  pickIndex,
  pipelineStrip,
  planSeriesChange,
  renamedSummary,
  renderOption,
  sendUpdatesFor,
  seriesLine,
  slipsAdded,
  spinRefusal,
  totalMinutes,
  untilStamp,
  weekStart,
  withOurBlock,
  zonedToUtc,
} from "../convex/teamCore";

// The team meetings' rules (convex/teamCore.ts). The calendar sync's own
// rules are tested in hermes/team-sync/test_sync.py.

describe("wheel amounts", () => {
  test("the number changes, the sentence does not", () => {
    const bonus = {
      label: "{amount} bonus",
      amount: 100,
      currency: "USD",
      amount_suffix: null,
    };
    expect(renderOption(bonus)).toBe("$100 bonus");
    expect(
      renderOption({
        ...bonus,
        amount: 2.5,
        label: "{amount} commission increase for 24h",
      }),
    ).toBe("$2.50 commission increase for 24h");
    expect(
      renderOption({
        label: "{amount} commission bump",
        amount: 10,
        currency: null,
        amount_suffix: "%",
      }),
    ).toBe("10% commission bump");
    expect(renderOption({ ...bonus, currency: "KWD", amount: 5 })).toBe(
      "KWD 5 bonus",
    );
    expect(renderOption({ ...bonus, label: "Spin again", amount: null })).toBe(
      "Spin again",
    );
    // An amount not set yet says so rather than showing $0.
    expect(renderOption({ ...bonus, amount: null })).toBe("? bonus");
  });
});

describe("spinning", () => {
  const prize = {
    kind: "prize",
    locked_until_goal: true,
    active: true,
    name: "CSR prize",
  };

  test("a locked prize wheel refuses until the week's goal is hit", () => {
    expect(spinRefusal(prize, { goal_hit: null }, 6)).toContain("earned");
    expect(spinRefusal(prize, { goal_hit: false }, 6)).toContain("earned");
    expect(spinRefusal(prize, null, 6)).toContain("earned");
    expect(spinRefusal(prize, { goal_hit: true }, 6)).toBeNull();
    expect(
      spinRefusal(
        { ...prize, kind: "scenario", locked_until_goal: false },
        null,
        3,
      ),
    ).toBeNull();
    expect(
      spinRefusal(
        { ...prize, kind: "person", locked_until_goal: false },
        null,
        0,
      ),
    ).toContain("Nobody");
    expect(
      spinRefusal({ ...prize, active: false }, { goal_hit: true }, 6),
    ).toContain("switched off");
  });

  test("the pick is fair and in range", () => {
    // The server draws from crypto, as here.
    const random32 = () => crypto.getRandomValues(new Uint32Array(1))[0];
    const seen = new Array(6).fill(0);
    for (let i = 0; i < 60_000; i++) seen[pickIndex(6, random32)]++;
    for (const n of seen) expect(Math.abs(n - 10_000)).toBeLessThan(600);
    expect(pickIndex(1, random32)).toBe(0);
    // A draw from the uneven top of the 32-bit range is drawn again.
    const draws = [2 ** 32 - 1, 7];
    expect(pickIndex(6, () => draws.shift() as number)).toBe(7 % 6);
  });

  test("the spin is written into the notes with the version it read", async () => {
    // Somebody saves the notes between our read and our write: the write
    // is refused, we read again and add the line to their version.
    let stored = { notes: "Wins: two bookings", version: 3 };
    let raced = false;
    const read = async () => ({ ...stored });
    const write = async (notes: string, version: number) => {
      if (!raced) {
        raced = true;
        stored = {
          notes: `${stored.notes}\nAgent A led the round`,
          version: stored.version + 1,
        };
      }
      if (version !== stored.version) return false;
      stored = { notes, version: version + 1 };
      return true;
    };
    const out = await appendWithVersion(
      read,
      write,
      "Spun CSR role play: Price Shopper",
    );
    expect(stored.notes).toBe(
      "Wins: two bookings\nAgent A led the round\nSpun CSR role play: Price Shopper",
    );
    expect(stored.version).toBe(5);
    expect(out.version).toBe(5);
  });

  test("notes that never stop changing give a plain refusal", async () => {
    await expect(
      appendWithVersion(
        async () => ({ notes: "", version: 1 }),
        async () => false,
        "Spun X: Y",
      ),
    ).rejects.toThrow("Spin again");
  });
});

describe("the creative pipeline", () => {
  const row = {
    status: "scripting",
    script_due: "2026-09-20",
    footage_due: "2026-09-24",
    edit_due: "2026-09-29",
    launch_on: "2026-10-01",
  };

  test("moving a due date that already passed is a slip, once per save", () => {
    const today = "2026-09-27";
    expect(slipsAdded(row, { ...row, script_due: "2026-09-30" }, today)).toBe(
      1,
    );
    expect(
      slipsAdded(
        row,
        { ...row, script_due: "2026-09-30", footage_due: "2026-10-02" },
        today,
      ),
    ).toBe(1);
    // A date still ahead can move freely.
    expect(slipsAdded(row, { ...row, launch_on: "2026-10-05" }, today)).toBe(0);
    // A passed date for a step already done is history, not a slip.
    expect(
      slipsAdded(
        { ...row, status: "editing" },
        { ...row, status: "editing", script_due: "2026-09-30" },
        today,
      ),
    ).toBe(0);
    // Nothing moved.
    expect(slipsAdded(row, { ...row }, today)).toBe(0);
  });

  test("overdue and not planned", () => {
    expect(overdue(row, "2026-09-27")).toBe(true);
    expect(overdue({ ...row, status: "editing" }, "2026-09-27")).toBe(false);
    expect(overdue(row, "2026-09-19")).toBe(false);
  });

  test("the whole-team strip counts last week, this week and the slipped", () => {
    // Saturday is the first day of the pipeline's week.
    expect(weekStart("2026-09-26")).toBe("2026-09-26");
    expect(weekStart("2026-09-29")).toBe("2026-09-26");
    const base = {
      status: "planned",
      script_due: null,
      footage_due: null,
      edit_due: null,
      slip_count: 0,
    };
    const rows = [
      {
        ...base,
        status: "launched",
        launch_on: "2026-09-21",
        launched_on: "2026-09-22",
      },
      { ...base, launch_on: "2026-09-23", launched_on: null },
      { ...base, launch_on: "2026-09-30", launched_on: null },
      { ...base, launch_on: null, launched_on: null, slip_count: 2 },
    ];
    expect(pipelineStrip(rows, "2026-09-29")).toEqual({
      launchedLastWeek: 1,
      plannedLastWeek: 2,
      launchingThisWeek: 1,
      slippedTwice: 1,
    });
  });
});

describe("the run of show", () => {
  const blocks = [
    {
      id: 1,
      weekday: null,
      position: 1,
      minutes: 2,
      title: "Win",
      detail: null,
    },
    {
      id: 2,
      weekday: null,
      position: 2,
      minutes: 5,
      title: "Fires",
      detail: null,
    },
    {
      id: 5,
      weekday: 0,
      position: 5,
      minutes: 7,
      title: "Projections",
      detail: null,
    },
    {
      id: 6,
      weekday: 1,
      position: 5,
      minutes: 7,
      title: "Game Tape",
      detail: null,
    },
    {
      id: 3,
      weekday: null,
      position: 3,
      minutes: 3,
      title: "Board check",
      detail: null,
    },
  ];

  test("a sitting shows the every-day blocks and its own day's, in order", () => {
    expect(blocksFor(blocks, 0).map(b => b.title)).toEqual([
      "Win",
      "Fires",
      "Board check",
      "Projections",
    ]);
    expect(blocksFor(blocks, 1).map(b => b.title)).toEqual([
      "Win",
      "Fires",
      "Board check",
      "Game Tape",
    ]);
    expect(blocksFor(blocks, 3).map(b => b.title)).toEqual([
      "Win",
      "Fires",
      "Board check",
    ]);
    expect(totalMinutes(blocksFor(blocks, 0))).toBe(17);
  });
});

describe("Google Calendar series", () => {
  test("an RRULE for new days keeps the rest of the rule", () => {
    expect(buildRrule({ weekdays: [4, 0] })).toBe(
      "RRULE:FREQ=WEEKLY;BYDAY=SU,TH",
    );
    expect(
      buildRrule({
        weekdays: [2],
        base: "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO",
      }),
    ).toBe("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU");
    expect(
      buildRrule({
        weekdays: [2],
        base: "RRULE:FREQ=WEEKLY;UNTIL=20261231T205959Z;BYDAY=MO",
      }),
    ).toBe("RRULE:FREQ=WEEKLY;UNTIL=20261231T205959Z;BYDAY=TU");
    expect(
      buildRrule({
        weekdays: [2],
        base: "RRULE:FREQ=WEEKLY;BYDAY=MO",
        until: "2026-10-30",
      }),
    ).toBe("RRULE:FREQ=WEEKLY;UNTIL=20261030T205959Z;BYDAY=TU");
  });

  test("the last day ends at midnight in Kuwait", () => {
    expect(untilStamp("2026-10-30", "Asia/Kuwait")).toBe("20261030T205959Z");
    expect(
      endRrule(
        "RRULE:FREQ=WEEKLY;COUNT=10;BYDAY=SA",
        "2026-10-02",
        "Asia/Kuwait",
      ),
    ).toBe("RRULE:FREQ=WEEKLY;BYDAY=SA;UNTIL=20261002T205959Z");
    expect(zonedToUtc("2026-10-04", "13:30", "Asia/Kuwait").toISOString()).toBe(
      "2026-10-04T10:30:00.000Z",
    );
  });

  test("from the next sitting: the series itself changes", () => {
    const plan = planSeriesChange(
      {
        startDay: "2026-10-04",
        rrule: "RRULE:FREQ=WEEKLY;BYDAY=SU,TH",
        tz: "Asia/Kuwait",
      },
      { weekdays: [1, 3], startTime: "14:30", minutes: 45, from: "2026-10-04" },
      "2026-10-04",
    );
    expect(plan).toEqual({
      mode: "patch",
      start: "2026-10-05T14:30:00",
      end: "2026-10-05T15:15:00",
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=MO,WE"],
    });
  });

  test("from a later date: this and following, the old series ends the day before", () => {
    const plan = planSeriesChange(
      {
        startDay: "2026-10-04",
        rrule: "RRULE:FREQ=WEEKLY;BYDAY=SU,TH",
        tz: "Asia/Kuwait",
      },
      { weekdays: [0, 4], startTime: "15:00", minutes: 30, from: "2026-10-15" },
      "2026-10-04",
    );
    expect(plan).toEqual({
      mode: "split",
      oldRecurrence: ["RRULE:FREQ=WEEKLY;BYDAY=SU,TH;UNTIL=20261014T205959Z"],
      newStartDay: "2026-10-15",
      start: "2026-10-15T15:00:00",
      end: "2026-10-15T15:30:00",
      recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=SU,TH"],
    });
  });

  test("a one-off moves on its own day; a monthly rule keeps its rule", () => {
    const once = planSeriesChange(
      { startDay: "2000-01-03", rrule: null, tz: "Asia/Kuwait" },
      { weekdays: [], startTime: "11:00", minutes: 45, from: "2000-01-03" },
      null,
    );
    expect(once).toEqual({
      mode: "patch",
      start: "2000-01-03T11:00:00",
      end: "2000-01-03T11:45:00",
      recurrence: null,
    });
    const monthly = planSeriesChange(
      {
        startDay: "2026-10-03",
        rrule: "RRULE:FREQ=MONTHLY;BYDAY=1SA",
        tz: "Asia/Kuwait",
      },
      { weekdays: [6], startTime: "10:00", minutes: 60, from: "2026-11-07" },
      "2026-10-03",
    );
    expect(monthly).toMatchObject({
      mode: "patch",
      recurrence: ["RRULE:FREQ=MONTHLY;BYDAY=1SA"],
    });
  });

  test("the series in one line", () => {
    expect(
      seriesLine({
        weekdays: [0, 4],
        startTime: "13:30:00",
        minutes: 30,
        tz: "Asia/Kuwait",
      }),
    ).toBe("Sun and Thu, 13:30 to 14:00, Kuwait time");
    expect(
      seriesLine({
        weekdays: [0, 1, 2, 3, 4],
        startTime: "13:00",
        minutes: 20,
      }),
    ).toBe("Sun to Thu, 13:00 to 13:20, Kuwait time");
    expect(
      seriesLine({
        weekdays: null,
        startTime: "10:00",
        minutes: 30,
        onDay: "2000-01-03",
      }),
    ).toBe("Once, Mon 3 Jan, 10:00 to 10:30, Kuwait time");
  });
});

describe("guests", () => {
  const org = "ceo@maharamedia.com";
  const guests = [
    { email: org, organizer: true, responseStatus: "accepted" },
    { email: "csm@maharamedia.com", responseStatus: "accepted" },
    {
      email: "buyer@maharamedia.com",
      optional: true,
      responseStatus: "needsAction",
    },
  ];

  test("add, remove and the optional flag, everyone else untouched", () => {
    const out = applyGuestChanges(
      guests,
      [
        { email: "agent@maharamedia.com", action: "add", optional: false },
        { email: "CSM@maharamedia.com", action: "remove" },
        { email: "buyer@maharamedia.com", action: "part", optional: false },
      ],
      org,
    );
    expect(out.map(a => [a.email, Boolean(a.optional)])).toEqual([
      [org, false],
      ["buyer@maharamedia.com", false],
      ["agent@maharamedia.com", false],
    ]);
    // Answers already given stay.
    expect(out[0].responseStatus).toBe("accepted");
  });

  test("the organiser is never dropped, and nobody appears twice", () => {
    const out = applyGuestChanges(
      guests,
      [
        { email: org, action: "remove" },
        { email: "Ceo@maharamedia.com", action: "part", optional: true },
        { email: "csm@maharamedia.com", action: "add", optional: true },
      ],
      org,
    );
    expect(out.filter(a => a.email.toLowerCase() === org)).toHaveLength(1);
    expect(out[0].optional).toBeFalsy();
    expect(out.filter(a => a.email === "csm@maharamedia.com")).toHaveLength(1);
  });

  test("a part change is quiet; adding or taking someone off is sent", () => {
    expect(
      guestUpdates([{ email: "a@x", action: "part", optional: true }]),
    ).toBe("none");
    expect(
      guestUpdates([{ email: "a@x", action: "add", optional: false }]),
    ).toBe("all");
    expect(sendUpdatesFor("2000-01-03", "2026-09-27")).toBe("none");
    expect(sendUpdatesFor("2026-10-04", "2026-09-27")).toBe("all");
  });
});

describe("writing to Google", () => {
  test("a 412 reads the event again, reapplies the one change and retries once", async () => {
    const versions = [
      { etag: '"1"', attendees: [{ email: "a@x" }] },
      { etag: '"2"', attendees: [{ email: "a@x" }, { email: "b@x" }] },
    ];
    let reads = 0;
    const sent: { etag: string | undefined; body: Record<string, unknown> }[] =
      [];
    const res = await patchWithRetry(
      async () => versions[Math.min(reads++, 1)],
      fresh => ({ attendees: [...fresh.attendees, { email: "c@x" }] }),
      async (body, etag) => {
        sent.push({ etag, body });
        return { status: sent.length === 1 ? 412 : 200, body: {} };
      },
    );
    expect(res.status).toBe(200);
    expect(res.retried).toBe(true);
    expect(sent.map(s => s.etag)).toEqual(['"1"', '"2"']);
    // The retry carries the guest added in between.
    expect(sent[1].body.attendees).toEqual([
      { email: "a@x" },
      { email: "b@x" },
      { email: "c@x" },
    ]);
  });

  test("a second 412 is returned, not retried forever", async () => {
    let n = 0;
    const res = await patchWithRetry(
      async () => ({ etag: `"${++n}"` }),
      () => ({ summary: "x" }),
      async () => ({ status: 412, body: {} }),
    );
    expect(res.status).toBe(412);
  });

  test("only our part of the description is ever rewritten", () => {
    const first = withOurBlock(
      "Agenda doc: https://docs/x",
      "Plan next week's videos.",
      "https://cockpit/team/creative-call",
    );
    expect(first).toContain("Agenda doc: https://docs/x");
    const again = withOurBlock(
      first,
      "New purpose.",
      "https://cockpit/team/creative-call",
    );
    expect(again).toContain("New purpose.");
    expect(again).not.toContain("Plan next week's videos.");
    expect(again).toContain("Agenda doc: https://docs/x");
  });

  test("a series a day keeps its day in the title when the meeting is renamed", () => {
    expect(
      renamedSummary(
        "🤝 CSM Daily: Projections",
        "CSM Daily",
        "CSM Check-in",
        false,
      ),
    ).toBe("🤝 CSM Check-in: Projections");
    expect(renamedSummary("Weekly sync", "Whole Team", "All Hands", true)).toBe(
      "All Hands",
    );
    expect(
      renamedSummary("Weekly sync", "Whole Team", "All Hands", false),
    ).toBe("Weekly sync");
  });
});
