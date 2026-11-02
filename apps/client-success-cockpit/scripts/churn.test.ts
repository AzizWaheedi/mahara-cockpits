import { describe, expect, test } from "bun:test";
import { buildChurnPage } from "../src/lib/churnClient";
import {
  answerProblem,
  bandOf,
  cardLine,
  confirmLine,
  confirmPrefill,
  countsAs,
  daysIn,
  departureProblem,
  kuwaitIsoDay,
  type MonthInput,
  mergePrefill,
  rollUp,
  surveyInviteLine,
  surveyInviteOf,
  typeNote,
  verdictLine,
} from "../src/lib/churnCore";

// The day a client left, a launch date `days` before it.
function left(leftOn: string, days: number | null) {
  if (days === null) return { leftOn, launchedOn: null };
  const at = new Date(Date.parse(`${leftOn}T00:00:00Z`) - days * 86_400_000);
  return { leftOn, launchedOn: at.toISOString().slice(0, 10) };
}

describe("one departure", () => {
  test("before day 90 is churn, day 90 or later finished the term", () => {
    expect(countsAs(left("2026-10-05", 47))).toBe("churn");
    expect(countsAs(left("2026-10-05", 89))).toBe("churn");
    expect(countsAs(left("2026-10-05", 90))).toBe("completed");
    expect(countsAs(left("2026-10-05", 119))).toBe("completed");
    expect(countsAs(left("2026-10-05", null))).toBe("unknown");
    expect(daysIn(left("2026-10-05", 47))).toBe(47);
  });

  test("says what it counts as, in plain words", () => {
    expect(verdictLine(left("2026-10-05", 47))).toBe(
      "Day 47 of 90: counts as churn in October 2026",
    );
    expect(verdictLine(left("2026-10-05", 112))).toBe(
      "Day 112: finished the term, not churn",
    );
    expect(verdictLine(left("2026-10-05", null))).toBe(
      "Needs a launch date before it counts either way",
    );
  });

  test("refuses what cannot be saved, with a sentence", () => {
    const ok = {
      client: "North Gulf",
      leftOn: "2026-10-05",
      launchedOn: "2026-08-01",
      reason: "Cancelled",
      mrrLostUsd: 1333,
    };
    expect(departureProblem(ok)).toBeNull();
    expect(departureProblem({ ...ok, client: " " })).toBe("Name the client.");
    expect(departureProblem({ ...ok, launchedOn: "2026-11-01" })).toBe(
      "The launch date is after the day they left.",
    );
    expect(departureProblem({ ...ok, reason: "Bored" })).toBe(
      "Pick why they left.",
    );
    expect(departureProblem({ ...ok, mrrLostUsd: -5 })).toBe(
      "MRR lost is a dollar amount, 0 or more.",
    );
  });
});

describe("a month", () => {
  test("mahara-context's check: days 50, 24 and 119 at 17 clients read 2 churned, 1 completed, 11.8%, Watch", () => {
    const inputs: MonthInput[] = [
      {
        month: "2026-10",
        activeAtStart: 17,
        newClients: 0,
        lostBeforeRegister: null,
        note: null,
      },
    ];
    const deps = [
      left("2026-10-03", 50),
      left("2026-10-12", 24),
      left("2026-10-20", 119),
    ];
    const [oct] = rollUp(inputs, deps, "2026-10");
    expect(oct.churned).toBe(2);
    expect(oct.completed).toBe(1);
    expect(oct.churnPct).toBe(11.8);
    expect(oct.activeAtEnd).toBe(14);
    expect(oct.band?.label).toBe("Watch");
  });

  test("a blank start carries from the month before, once that month's end is known", () => {
    const inputs: MonthInput[] = [
      {
        month: "2026-09",
        activeAtStart: 22,
        newClients: null,
        lostBeforeRegister: 1,
        note: "old sheet",
      },
    ];
    let rows = rollUp(inputs, [], "2026-10");
    expect(rows.map(r => r.month)).toEqual(["2026-09", "2026-10"]);
    // September's new clients were never typed: October cannot carry a start.
    expect(rows[1].activeAtStart).toBeNull();

    inputs[0].newClients = 2;
    rows = rollUp(inputs, [left("2026-10-08", 30)], "2026-10");
    expect(rows[0].churned).toBe(1); // the old sheet's count
    expect(rows[0].activeAtEnd).toBe(23);
    expect(rows[1].activeAtStart).toBe(23);
    expect(rows[1].startCarried).toBe(true);
    expect(rows[1].churnPct).toBe(4.3);
  });

  test("the rolling three months sums churned over starts, skipping a month with no start", () => {
    const inputs: MonthInput[] = [
      {
        month: "2026-08",
        activeAtStart: null,
        newClients: 10,
        lostBeforeRegister: 2,
        note: null,
      },
      {
        month: "2026-09",
        activeAtStart: 22,
        newClients: 2,
        lostBeforeRegister: 1,
        note: null,
      },
      {
        month: "2026-10",
        activeAtStart: 23,
        newClients: 1,
        lostBeforeRegister: null,
        note: null,
      },
    ];
    const rows = rollUp(inputs, [left("2026-10-08", 30)], "2026-10");
    const oct = rows[rows.length - 1];
    expect(oct.rolling3Pct).toBe(4.4); // (1 + 1) / (22 + 23)
    expect(oct.band?.label).toBe("Good");
    // The page says the rate covers two of the three months, and that
    // October is still running.
    expect(oct.rolling3Months).toBe(2);
    expect(oct.running).toBe(true);
    expect(rows[rows.length - 2].running).toBe(false);
  });

  test("a register that holds fewer lost clients than the old sheet says so", () => {
    const rows = rollUp(
      [
        {
          month: "2026-09",
          activeAtStart: 22,
          newClients: 2,
          lostBeforeRegister: 3,
          note: null,
        },
      ],
      [left("2026-09-20", 40)],
      "2026-09",
    );
    expect(rows[0].churned).toBe(1);
    expect(rows[0].registerShort).toBe(2);
  });

  test("once the register covers a month, the old sheet's count for it steps aside", () => {
    const rows = rollUp(
      [
        {
          month: "2026-09",
          activeAtStart: 22,
          newClients: 2,
          lostBeforeRegister: 1,
          note: null,
        },
      ],
      [left("2026-09-20", 40)],
      "2026-09",
    );
    expect(rows[0].churned).toBe(1);
    expect(rows[0].lostBeforeRegister).toBeNull();
  });

  test("a departure with no launch date counts neither way until it has one", () => {
    const rows = rollUp(
      [
        {
          month: "2026-10",
          activeAtStart: 20,
          newClients: 0,
          lostBeforeRegister: null,
          note: null,
        },
      ],
      [left("2026-10-08", null)],
      "2026-10",
    );
    expect(rows[0].churned).toBe(0);
    expect(rows[0].completed).toBe(0);
    expect(rows[0].unknown).toBe(1);
  });

  test("months with nothing in them are marked, so the page can leave them out", () => {
    const rows = rollUp(
      [
        {
          month: "2026-01",
          activeAtStart: 15,
          newClients: 5,
          lostBeforeRegister: 3,
          note: null,
        },
      ],
      [],
      "2026-04",
    );
    expect(rows.map(r => [r.month, r.hasData])).toEqual([
      ["2026-01", true],
      ["2026-02", false],
      ["2026-03", false],
      ["2026-04", true],
    ]);
  });
});

describe("the bands match the CSM's retention bonus", () => {
  test.each([
    [0, "Excellent"],
    [4, "Excellent"],
    [5.9, "Good"],
    [8, "Good"],
    [10, "On target"],
    [11.8, "Watch"],
    [15, "Bad"],
    [15.1, "Critical"],
  ])("%p%% is %s", (pct, label) => {
    expect(bandOf(pct).label).toBe(label);
  });
});

// --- The confirm (docs/forms/WAVE12-CONTRACT.md 4.5, 5.5) -------------------------------------

/** cockpit_csm_churn_read as 20261101o returns it, with invented clients. */
function read(over: Record<string, unknown> = {}) {
  const dep = (id: number, extra: Record<string, unknown>) => ({
    id,
    client: `Client ${id}`,
    clickup_task_id: `task${id}`,
    left_on: "2026-10-18",
    launched_on: "2026-08-30",
    reason: "Cancelled",
    mrr_lost_usd: 2000,
    csm: "The CSM",
    note: null,
    source: "cockpit",
    created_by: "csm@tests.invalid",
    created_at: "2026-10-18T09:00:00Z",
    updated_by: null,
    updated_at: "2026-10-18T09:00:00Z",
    ...extra,
  });
  return {
    today: "2026-11-01",
    month: "2026-11",
    me: { email: "csm@tests.invalid", isCeo: false, isAdmin: false },
    deps: [
      dep(20, {
        notice_on: "2026-10-15",
        survey_state: "filled",
        survey_response_id: "r-1",
        why_detail: "Moved the budget to a showroom fit-out.",
        how_to_stop: "Agree the second campaign before day 45.",
        churn_type: "mid_programme",
        confirmed_at: "2026-10-31T22:30:00Z",
        confirmed_role: "the CSM",
        billing_event_id: 7,
        card_state: "held",
        card_error: null,
        churn_type_default: "mid_programme",
      }),
      dep(21, {
        survey_state: "not_sent",
        churn_type: null,
        confirmed_at: null,
        confirmed_role: null,
        card_state: null,
        churn_type_default: "mid_programme",
      }),
    ],
    monthRows: [],
    cards: [
      {
        clickup_task_id: "taskGone",
        client_name: "Gone Co",
        stage: "Stopped",
        stage_group: "gone",
        churn_date: "2026-10-28",
        csm: null,
        mrr_usd: 900,
      },
    ],
    log: [],
    roster: { cards: [], left: [], starts: [] },
    notices: [
      {
        responseId: "r-2",
        taskId: "task22",
        clientName: "حول العمران",
        noticeOn: "2026-10-30",
        submittedAt: "2026-10-30T07:00:00Z",
        matched: true,
        departureId: null,
        ratings: [{ title: "How happy were you with the results?", value: 3 }],
        typeDefault: "mid_programme",
      },
    ],
    unmatched: [
      {
        responseId: "r-3",
        taskId: null,
        clientName: null,
        submittedAt: "2026-10-29T07:00:00Z",
        matched: false,
      },
    ],
    stoppedNotInRegister: [
      {
        taskId: "taskGone",
        clientName: "Gone Co",
        churnDate: "2026-10-28",
        stoppedSince: null,
        mrrUsd: 900,
        csm: null,
        typeDefault: "mid_programme",
      },
      {
        taskId: "taskOld",
        clientName: "Old Co",
        churnDate: null,
        stoppedSince: null,
        mrrUsd: null,
        csm: null,
        typeDefault: "mid_programme",
      },
    ],
    ...over,
  };
}

describe("the tracker's read", () => {
  test("departures carry the confirm, and the bands come through", () => {
    const page = buildChurnPage(read());
    const confirmed = page.departures.find(d => d.id === 20);
    expect(confirmed?.confirm).toMatchObject({
      noticeOn: "2026-10-15",
      surveyState: "filled",
      churnType: "mid_programme",
      confirmedRole: "the CSM",
      cardState: "held",
    });
    expect(
      page.departures.find(d => d.id === 21)?.confirm?.confirmedAt,
    ).toBeNull();
    expect(page.notices).toEqual([
      {
        responseId: "r-2",
        taskId: "task22",
        clientName: "حول العمران",
        noticeOn: "2026-10-30",
        submittedAt: "2026-10-30T07:00:00Z",
        departureId: null,
        ratings: [{ title: "How happy were you with the results?", value: 3 }],
        typeDefault: "mid_programme",
      },
    ]);
    // A survey with no name says so; the cockpit never guesses one.
    expect(page.unmatched[0].clientName).toBe("A client the form did not name");
    expect(page.me.isCeo).toBe(false);
  });

  test("a Stopped card already waiting to be logged is listed once", () => {
    const page = buildChurnPage(read());
    expect(page.waiting.map(w => w.key)).toContain("taskGone");
    expect(page.stopped.map(s => s.taskId)).toEqual(["taskOld"]);
  });

  test("a read from before 20261101o still builds the page, with no bands", () => {
    const old = read();
    for (const k of ["notices", "unmatched", "stoppedNotInRegister"])
      delete (old as Record<string, unknown>)[k];
    old.deps = old.deps.map(d => {
      const {
        id,
        client,
        clickup_task_id,
        left_on,
        launched_on,
        reason,
        mrr_lost_usd,
        csm,
        note,
        source,
        created_by,
        created_at,
        updated_by,
        updated_at,
      } = d as Record<string, unknown>;
      return {
        id,
        client,
        clickup_task_id,
        left_on,
        launched_on,
        reason,
        mrr_lost_usd,
        csm,
        note,
        source,
        created_by,
        created_at,
        updated_by,
        updated_at,
      } as typeof d;
    });
    const page = buildChurnPage(old);
    expect(page.notices).toEqual([]);
    expect(page.stopped).toEqual([]);
    expect(page.departures[0].confirm?.confirmedAt).toBeNull();
  });
});

describe("the confirm's words", () => {
  const day = (iso: string) => `day ${iso}`;
  test("confirmed on the Kuwait day, by a role; logged otherwise", () => {
    expect(kuwaitIsoDay("2026-10-31T22:30:00Z")).toBe("2026-11-01");
    expect(
      confirmLine(
        { confirmedAt: "2026-10-31T22:30:00Z", confirmedRole: "the CSM" },
        day,
      ),
    ).toEqual({
      confirmed: true,
      line: "Confirmed day 2026-11-01 · the CSM",
    });
    expect(
      confirmLine({ confirmedAt: null, confirmedRole: null }, day),
    ).toEqual({
      confirmed: false,
      line: "Logged, not confirmed",
    });
  });

  test("the card's state in FormSheet's trail words", () => {
    expect(cardLine("held")?.line).toBe(
      "Held: card writes for churn are off. When the CEO turns them on, this edit is reviewed and sent or closed.",
    );
    expect(cardLine("held")?.short).toBe("Held: card writes for churn are off");
    expect(cardLine("queued")).toEqual({
      tone: "warn",
      line: "Queued for the ClickUp card",
      short: "Queued for the ClickUp card",
    });
    expect(cardLine("delivered")).toEqual({
      tone: "good",
      line: "Card shows it",
      short: "Card shows it",
    });
    expect(cardLine("failed", "Field not found")?.line).toBe(
      "ClickUp refused it: Field not found. It stays in the cockpit; tell the systems manager.",
    );
    expect(cardLine("skipped")?.line).toBe(
      "ClickUp already showed this, so nothing was written.",
    );
    expect(cardLine(null)).toBeNull();
  });

  test("a confirmed type the day-90 rule reads otherwise is said, never silently counted", () => {
    // Joe and Sera: 184 days in, confirmed as churn on the card.
    expect(
      typeNote({
        leftOn: "2026-10-29",
        launchedOn: "2026-04-28",
        churnType: "mid_programme",
      }),
    ).toBe(
      "Confirmed as churn on the card; the day-90 rule counts it as a finished term here, and pay reads that.",
    );
    expect(countsAs({ leftOn: "2026-10-29", launchedOn: "2026-04-28" })).toBe(
      "completed",
    );
    expect(
      typeNote({
        leftOn: "2026-10-18",
        launchedOn: "2026-08-30",
        churnType: "mid_programme",
      }),
    ).toBeNull();
    expect(
      typeNote({
        leftOn: "2026-10-18",
        launchedOn: null,
        churnType: "completed",
      }),
    ).toBeNull();
  });

  test("Not leaving needs what the client said, as the server checks it", () => {
    expect(answerProblem("  ok ")).toBe(
      "Say what the client said, so the answer reads back.",
    );
    expect(answerProblem("They signed again")).toBeNull();
  });
});

describe("the confirm's prefill", () => {
  test("each value says where it came from; nothing nobody holds is guessed", () => {
    expect(
      confirmPrefill({
        leftOn: "2026-10-18",
        reason: "Cancelled",
        mrrLostUsd: 2000,
        typeDefault: "mid_programme",
        survey: { noticeOn: "2026-10-15", dayWords: "15 Oct" },
      }),
    ).toEqual([
      { key: "leftOn", value: "2026-10-18", source: "the churn register" },
      {
        key: "noticeOn",
        value: "2026-10-15",
        source: "the termination survey, 15 Oct",
      },
      {
        key: "surveyState",
        value: "filled",
        source: "the termination survey, 15 Oct",
      },
      { key: "reason", value: "Cancelled", source: "the churn register" },
      { key: "churnType", value: "mid_programme", source: "the day-90 rule" },
      { key: "mrrLostUsd", value: 2000, source: "the churn register" },
    ]);
    expect(
      confirmPrefill({
        leftOn: null,
        mrrLostUsd: null,
        mrrFrom: "card",
        typeDefault: null,
      }),
    ).toEqual([]);
    expect(
      confirmPrefill({ leftOn: "2026-10-28", leftOnFrom: "card" })[0].source,
    ).toBe("the ClickUp card");
  });

  test("the server's prefill wins key by key; the tracker fills the rest", () => {
    const merged = mergePrefill(
      [
        { key: "churnType", value: "completed", source: "the day-90 rule" },
        { key: "mrrLostUsd", value: null, source: "Nobody holds this yet" },
      ],
      [
        {
          key: "churnType",
          value: "mid_programme",
          source: "the churn register",
        },
        { key: "leftOn", value: "2026-10-18", source: "the churn register" },
        { key: "mrrLostUsd", value: 2000, source: "the churn register" },
      ],
    );
    expect(merged).toEqual([
      { key: "churnType", value: "completed", source: "the day-90 rule" },
      { key: "leftOn", value: "2026-10-18", source: "the churn register" },
      { key: "mrrLostUsd", value: 2000, source: "the churn register" },
    ]);
  });
});

// Waves 3-4 (docs/forms/WAVE34-CONTRACT.md 4.4.5, 5.11): the native exit
// survey's invite on each departure, and its line on the row.
describe("the exit survey on a departure (5.11)", () => {
  const day = (d: string | null) => (d ? `${Number(d.slice(8, 10))} Nov` : "");
  test("Sent by portal or by link, Answered, or Not sent", () => {
    expect(surveyInviteLine(null, day)).toBe("Not sent");
    expect(
      surveyInviteLine(
        {
          inviteId: "i",
          state: "open",
          channels: ["portal", "whatsapp"],
          issuedAt: "2026-11-03T07:00:00Z",
          answeredAt: null,
        },
        day,
      ),
    ).toBe("Exit survey sent 3 Nov · portal");
    expect(
      surveyInviteLine(
        {
          inviteId: "i",
          state: "open",
          channels: ["whatsapp"],
          issuedAt: "2026-11-03T07:00:00Z",
          answeredAt: null,
        },
        day,
      ),
    ).toBe("Exit survey sent 3 Nov · link");
    expect(
      surveyInviteLine(
        {
          inviteId: "i",
          state: "answered",
          channels: ["whatsapp"],
          issuedAt: "2026-11-03T07:00:00Z",
          answeredAt: "2026-11-05T07:00:00Z",
        },
        day,
      ),
    ).toBe("Exit survey answered 5 Nov");
  });

  test("the read carries surveyInvite past the schema; a malformed one is left out", () => {
    const input = read();
    (input.deps as Record<string, unknown>[])[0] = {
      ...input.deps[0],
      surveyInvite: {
        inviteId: "inv-1",
        state: "open",
        channels: ["portal"],
        issuedAt: "2026-11-02T07:00:00Z",
        answeredAt: null,
      },
    };
    (input.deps as Record<string, unknown>[])[1] = {
      ...input.deps[1],
      surveyInvite: { state: "open" },
    };
    const page = buildChurnPage(input);
    const id0 = Number(input.deps[0].id);
    const id1 = Number(input.deps[1].id);
    expect(page.departures.find(d => d.id === id0)?.surveyInvite).toEqual({
      inviteId: "inv-1",
      state: "open",
      channels: ["portal"],
      issuedAt: "2026-11-02T07:00:00Z",
      answeredAt: null,
    });
    expect(
      page.departures.find(d => d.id === id1)?.surveyInvite,
    ).toBeUndefined();
    expect(surveyInviteOf({ inviteId: "x", state: "weird" })?.state).toBe(
      "open",
    );
  });
});
