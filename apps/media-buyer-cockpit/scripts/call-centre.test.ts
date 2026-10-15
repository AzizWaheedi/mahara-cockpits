/**
 * The call centre contract, verdict and wording (src/lib/callCentre.ts), the
 * same file in the client success and media buyer cockpits. Every number here
 * is invented. The database side is apps/media-buyer-cockpit/scripts/
 * call-centre-sql.test.ts.
 */
import { describe, expect, test } from "bun:test";
import {
  assignedCallers,
  CALL_RULES,
  callCentreVerdict,
  formatCallLength,
  formatDuration,
  formatPerLead,
  formatRate,
  LOST_LABELS,
  lostLabel,
  NOT_MEASURED,
  parseCallCentre,
  rate,
  rowFlag,
  summarize,
  targetingShare,
} from "../src/lib/callCentre";
import {
  BOOKING_RATE_GATE,
  CONVERSATION_GATE,
  FIRST_CALL_MINUTES,
  FOLLOW_UP_ATTEMPTS,
  REACHED_GATE,
} from "../src/lib/kpi";

type Raw = Record<string, any>;

/** A client the call centre serves well: called fast and often, 30% booked. */
function healthy(): Raw {
  const row = (over: Raw = {}) => ({
    id: null,
    name: null,
    campaignId: null,
    campaignName: null,
    leads: 100,
    called: 95,
    dials: 320,
    reached: 70,
    talked30: 60,
    talked120: 45,
    booked: 32,
    confirmed: 30,
    medianFirstCallSeconds: 300,
    ...over,
  });
  const speedPart = {
    leads: 50,
    called: 48,
    withinFiveMinutes: 30,
    withinThirtyMinutes: 45,
    medianClockSeconds: 200,
  };
  return {
    version: 1,
    generatedAt: "2026-10-13T12:00:00Z",
    timezone: "Asia/Kuwait",
    from: "2026-09-14",
    to: "2026-10-13",
    client: {
      locationId: "loc1",
      name: "Client One",
      clickupId: "cu1",
      status: "Active",
      serviceMode: "DFY",
      country: "KW",
      dialerActive: true,
    },
    official: {
      leads: 100,
      leadsDialed: 95,
      leadsContacted: 70,
      noVerifiedDial: 5,
      providerDials: 300,
      connections: 150,
      dials: 280,
      talkSeconds: 20000,
      connectionRate: 0.5,
      medianSpeedSeconds: 240,
      avgSpeedSeconds: 400,
      speedSamples: 95,
      withinTwoMinutes: 30,
      confirmedBookings: 30,
      provisionalBookings: 5,
      unclassifiedBookings: 0,
      shows: 20,
      noShow: 5,
      showRate: 0.8,
      closed: 3,
      // The report sends more than the page reads; extra keys are dropped.
      values: [],
    },
    officialCoverage: {
      leadSyncAt: "2026-10-13T11:00:00Z",
      callSyncAt: "2026-10-13T11:59:00Z",
      appointmentSyncAt: null,
      sheetSyncAt: null,
    },
    callers: {
      assigned: [{ email: "agent@x.test", name: "Agent" }],
      otherAccess: [],
      dialled: [{ email: "agent@x.test", name: "Agent", dials: 300 }],
    },
    cohort: {
      leads: 100,
      called: 95,
      dials: 320,
      reached: 70,
      talked30: 60,
      talked120: 45,
      booked: 32,
      confirmed: 30,
    },
    window: {
      dials: 300,
      reached: 150,
      talked30: 120,
      talked120: 90,
      talkSeconds: 20000,
    },
    notCalled: {
      total: 5,
      noPhone: 2,
      unreadablePhone: 1,
      dialledUnderAnotherLead: 1,
      neverDialled: 1,
      neverDialledOutsideDialerCountries: 0,
      neverDialledWithSavedOutcome: 0,
    },
    speed: {
      hoursSource: "schedule",
      leads: 100,
      medianClockSeconds: 300,
      withinFiveMinutes: 60,
      inHours: speedPart,
      outOfHours: { ...speedPart, medianClockSeconds: 40000 },
    },
    followUp: { leads: 20, calls: 200, threePlus: 20 },
    messages: { handled: 4, outcomesWithoutCall: 7 },
    byAd: [row({ id: "ad1", name: "Ad one", campaignId: "c1" })],
    byCampaign: [row({ id: "c1", name: "Campaign one" })],
    clientAverage: row(),
    waiting: {
      callable: 90,
      touched: 88,
      untouched: {
        count: 2,
        oldestAt: "2026-10-13T08:00:00Z",
        oldestWorkSeconds: 5000,
      },
      stages: [
        {
          stage: "Day 1 AM - Follow Up",
          position: 1,
          count: 3,
          medianDays: 1.5,
          oldestDays: 4,
          overSevenDays: 0,
        },
      ],
      callbacks: {
        count: 1,
        overThreeDays: 0,
        oldestTouchAt: null,
        scheduled: 1,
        overdue: 0,
      },
      missedInbound: {
        count: 0,
        callers: 0,
        withinFifteenMinutes: 0,
        withinTwoHours: 0,
        withinDay: 0,
        never: 0,
        oldestNeverAt: null,
      },
    },
    lost: {
      total: 0,
      reasons: [],
      otherNotes: { total: 0, sorted: 0 },
      unreachable: { leads: 0, calls: 0, noCall: 0, fourPlus: 0, connected: 0 },
      latest: [],
    },
    coverage: {
      unlinkedCalls: 3,
      leadsWithoutPhone: 2,
      leadsWithUnreadablePhone: 1,
      leadsWithoutAdId: 0,
      metaLeadsWithoutAdId: 0,
      leadsOnlyInGhl: 0,
      newestCallAt: "2026-10-13T11:58:00Z",
      newestClientCallAt: "2026-10-13T11:00:00Z",
      newestAttemptAt: "2026-10-13T11:58:30Z",
      newestClientAttemptAt: "2026-10-13T11:01:00Z",
      leadSyncAt: "2026-10-13T11:00:00Z",
    },
    notes: ["Reached includes voicemail."],
  };
}

const read = (edit: (r: Raw) => void = () => {}) => {
  const raw = healthy();
  edit(raw);
  return parseCallCentre(raw);
};

describe("the gates", () => {
  test("are the constraints checklist's lines", () => {
    expect(REACHED_GATE).toBe(35);
    expect(CONVERSATION_GATE).toBe(25);
    expect(FIRST_CALL_MINUTES).toBe(5);
    expect(FOLLOW_UP_ATTEMPTS).toBe(4 + 3 + 2);
    expect(BOOKING_RATE_GATE).toBe(25);
    expect(CALL_RULES.minLeads).toBe(20);
  });
});

describe("parseCallCentre", () => {
  test("reads the answer and drops what it does not know", () => {
    const data = read();
    expect(data.official?.providerDials).toBe(300);
    expect("values" in (data.official ?? {})).toBe(false);
  });

  test("a missing count fails the read instead of becoming zero", () => {
    const raw = healthy();
    delete raw.cohort.dials;
    expect(() => parseCallCentre(raw)).toThrow(
      "The call centre numbers came back in a shape this page cannot read.",
    );
    const noOfficialCount = healthy();
    delete noOfficialCount.official.providerDials;
    expect(() => parseCallCentre(noOfficialCount)).toThrow();
    expect(() => parseCallCentre({ ...healthy(), version: 2 })).toThrow();
    expect(() => parseCallCentre(null)).toThrow();
  });

  test("a value with nothing under it stays null and reads Not measured", () => {
    const data = read(r => {
      r.official.medianSpeedSeconds = null;
      delete r.official.connectionRate;
      r.speed.medianClockSeconds = null;
      r.waiting.untouched.oldestAt = null;
    });
    expect(data.official?.medianSpeedSeconds).toBeNull();
    expect(data.official?.connectionRate).toBeNull();
    const s = summarize(data);
    expect(s.firstCallWorkSeconds).toBeNull();
    expect(s.reachedPerDial).toBeNull();
    expect(formatDuration(s.firstCallWorkSeconds)).toBe(NOT_MEASURED);
    expect(formatRate(s.reachedPerDial)).toBe(NOT_MEASURED);
  });

  test("a client the report does not know has no official numbers, never zeros", () => {
    const data = read(r => {
      r.official = null;
    });
    const s = summarize(data);
    expect(s.leads).toBeNull();
    expect(s.dials).toBeNull();
    expect(s.bookedRate).toBeNull();
    expect(s.talked120PerDial).toBeNull();
  });
});

describe("summarize", () => {
  test("per dial is the official rate; per lead called sits beside it", () => {
    const s = summarize(read());
    expect(s.dials).toBe(300);
    expect(s.reachedPerDial).toBe(50);
    expect(s.talked120PerDial).toBe(30);
    expect(s.talked30PerDial).toBe(40);
    expect(s.reachedPerLeadCalled).toBeCloseTo(73.68, 1);
    expect(s.talked120PerLeadCalled).toBeCloseTo(47.37, 1);
    expect(s.dialsPerLead).toBe(3.2);
    expect(s.calledRate).toBe(95);
    expect(s.bookedRate).toBe(30);
    expect(s.showRate).toBe(80);
    expect(s.touchedRate).toBeCloseTo(97.78, 1);
    expect(s.followUpCalls).toBe(10);
    expect(s.withinFiveRate).toBe(60);
    expect(s.outcomesWithoutCall).toBe(7);
  });
  test("rate is null with nothing under it", () => {
    expect(rate(3, 0)).toBeNull();
    expect(rate(null, 4)).toBeNull();
    expect(rate(1, 4)).toBe(25);
  });
});

/** The same client booking 10% of its leads, so a call centre miss is the verdict. */
const booking10 = (edit: (r: Raw) => void = () => {}) =>
  read(r => {
    r.official.confirmedBookings = 10;
    edit(r);
  });

describe("callCentreVerdict", () => {
  test("a client booking at the gate is on track; a call centre miss is a watch beside it", () => {
    const v = callCentreVerdict(
      read(r => (r.official.medianSpeedSeconds = 3 * 3600 + 12 * 60)),
    );
    expect(v.kind).toBe("on_track");
    expect(v.why).toBe(
      "30% of leads booked a confirmed appointment (the line is 25%).",
    );
    expect(v.watch).toEqual([
      "The first call takes 3 h 12 min of working time at the median (the line is 30 min).",
    ]);
    expect(callCentreVerdict(read()).watch).toEqual([]);
  });

  test("on track: 25% or more of leads booked a confirmed appointment", () => {
    const v = callCentreVerdict(read());
    expect(v).toMatchObject({
      kind: "on_track",
      label: "On track",
      tone: "good",
    });
    expect(v.why).toBe(
      "30% of leads booked a confirmed appointment (the line is 25%).",
    );
  });

  test("a done-with-you client gets no verdict: the client calls", () => {
    const v = callCentreVerdict(read(r => (r.client.serviceMode = "DWY")));
    expect(v.kind).toBe("client_calls");
    expect(v.label).toBe("Leads only: the client calls them");
  });

  test("no report row: no call data yet", () => {
    const v = callCentreVerdict(read(r => (r.official = null)));
    expect(v.kind).toBe("no_data");
    expect(v.tone).toBe("muted");
  });

  test("under 20 leads: not enough leads yet", () => {
    const v = callCentreVerdict(read(r => (r.official.leads = 12)));
    expect(v.kind).toBe("not_enough");
    expect(v.why).toBe(
      "Only 12 leads in these dates. The verdict needs 20 or more.",
    );
  });

  test("call centre: leads older than a working hour left untouched", () => {
    const v = callCentreVerdict(
      booking10(r => {
        r.waiting.callable = 40;
        r.waiting.touched = 30;
        r.waiting.untouched.count = 10;
      }),
    );
    expect(v.kind).toBe("call_centre");
    expect(v.tone).toBe("bad");
    expect(v.why).toBe(
      "Only 75% of leads older than a working hour were called or messaged (the line is 90%); 10 leads still wait.",
    );
  });

  test("call centre: the first call is slow in working time", () => {
    const v = callCentreVerdict(
      booking10(r => (r.official.medianSpeedSeconds = 3 * 3600 + 12 * 60)),
    );
    expect(v.kind).toBe("call_centre");
    expect(v.why).toBe(
      "The first call takes 3 h 12 min of working time at the median (the line is 30 min).",
    );
  });

  test("call centre: unanswered leads are not called again enough", () => {
    const v = callCentreVerdict(
      booking10(r => {
        r.followUp = { leads: 10, calls: 14, threePlus: 1 };
      }),
    );
    expect(v.kind).toBe("call_centre");
    expect(v.why).toBe(
      "Leads who did not answer got 1.4 calls in their first 3 days (the line is 3; the checklist asks for 9).",
    );
    // Too few such leads to judge: no reason from follow-up.
    const few = callCentreVerdict(
      read(r => {
        r.followUp = { leads: 4, calls: 4, threePlus: 0 };
      }),
    );
    expect(few.kind).toBe("on_track");
  });

  test("call centre: answered, but few conversations over two minutes", () => {
    const v = callCentreVerdict(
      booking10(r => {
        r.official.connectionRate = 0.6;
        r.window.talked120 = 30;
      }),
    );
    expect(v.kind).toBe("call_centre");
    expect(v.why).toBe(
      "60% of dials are answered, but only 10% become a conversation over 2 minutes (the line is 25%).",
    );
  });

  test("call centre: few dials answered with a slow first call", () => {
    const v = callCentreVerdict(
      booking10(r => {
        r.official.connectionRate = 0.2;
        r.official.medianSpeedSeconds = 600;
      }),
    );
    expect(v.kind).toBe("call_centre");
    expect(v.why).toBe(
      "Only 20% of dials are answered (the line is 35%), and the first call takes 10 min at the median (the checklist asks for 5 min).",
    );
  });

  test("call centre: few dials answered with shallow follow-up", () => {
    const v = callCentreVerdict(
      booking10(r => {
        r.official.connectionRate = 0.2;
        r.followUp = { leads: 10, calls: 40, threePlus: 10 };
      }),
    );
    expect(v.why).toBe(
      "Only 20% of dials are answered (the line is 35%), and unanswered leads get 4.0 calls in 3 days (the checklist asks for 9).",
    );
  });

  test("call centre: few dials answered though calls are fast and repeated points at the number", () => {
    const v = callCentreVerdict(
      booking10(r => {
        r.official.connectionRate = 0.2;
        r.official.medianSpeedSeconds = 120;
        r.followUp = { leads: 10, calls: 95, threePlus: 10 };
      }),
    );
    expect(v.kind).toBe("call_centre");
    expect(v.why).toContain("check the caller number for a spam flag");
  });

  test("call centre: no verified call at all", () => {
    const v = callCentreVerdict(
      booking10(r => {
        r.official.providerDials = 0;
        r.official.connectionRate = null;
      }),
    );
    expect(v.kind).toBe("call_centre");
    expect(v.why).toBe(
      "No verified call was made for this client in these dates, with 100 leads in.",
    );
  });

  test("every reason that holds is kept, most pressing first", () => {
    const v = callCentreVerdict(
      booking10(r => {
        r.waiting.touched = 60;
        r.official.medianSpeedSeconds = 7200;
        r.followUp = { leads: 10, calls: 10, threePlus: 0 };
      }),
    );
    expect(v.reasons).toHaveLength(3);
    expect(v.reasons[0]).toStartWith(
      "Only 67% of leads older than a working hour",
    );
    expect(v.reasons[1]).toStartWith("The first call takes 2 h");
    expect(v.reasons[2]).toStartWith("Leads who did not answer got 1.0 calls");
  });

  test("lead quality: calls fast and deep, bookings low; the lost mix can point at targeting", () => {
    const quality = (lost: { key: string; count: number }[]) =>
      callCentreVerdict(
        read(r => {
          r.official.confirmedBookings = 10;
          r.lost.reasons = lost;
          r.lost.total = lost.reduce((s, x) => s + x.count, 0);
        }),
      );
    const plain = quality([]);
    expect(plain).toMatchObject({
      kind: "lead_quality",
      label: "Lead quality",
      tone: "watch",
    });
    expect(plain.why).toBe(
      "Calls are fast and repeated, 50% of dials are answered and 30% talk over 2 minutes, but only 10% of leads booked (the line is 25%): look at who the ads bring.",
    );
    expect(plain.reasons).toHaveLength(1);
    const targeting = quality([
      { key: "distance", count: 4 },
      { key: "not_a_fit", count: 3 },
      { key: "not_interested", count: 3 },
      { key: "unreachable", count: 20 },
    ]);
    expect(targeting.reasons[1]).toBe(
      "70% of leads lost for a stated reason were too far, short of money or not a fit (over 30% points at targeting).",
    );
    // Under 30%, or too few stated reasons: no targeting line.
    expect(
      quality([
        { key: "distance", count: 1 },
        { key: "not_interested", count: 9 },
      ]).reasons,
    ).toHaveLength(1);
    expect(
      quality([
        { key: "distance", count: 3 },
        { key: "unreachable", count: 30 },
      ]).reasons,
    ).toHaveLength(1);
  });

  test("the sentences are plain: no em dash, no emoji", () => {
    const all = [
      read(),
      read(r => (r.client.serviceMode = "DWY")),
      read(r => (r.official = null)),
      read(r => (r.official.leads = 3)),
      read(r => (r.official.connectionRate = 0.1)),
      read(r => (r.official.confirmedBookings = 1)),
    ].flatMap(d => callCentreVerdict(d).reasons);
    for (const line of all) {
      expect(line).not.toMatch(/[—]/);
      expect(line).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});

describe("targetingShare", () => {
  test("distance, money and not a fit over leads lost for a stated reason", () => {
    const data = read(r => {
      r.lost.reasons = [
        { key: "financial", count: 2 },
        { key: "not_a_fit", count: 1 },
        { key: "not_ready", count: 3 },
        { key: "unclassified", count: 9 },
      ];
    });
    expect(targetingShare(data)).toBe(50);
  });
});

describe("rowFlag", () => {
  const client = read().clientAverage;
  const row = (over: Record<string, number>) => ({
    ...read().byAd[0],
    leads: 20,
    called: 20,
    reached: 14,
    booked: 6,
    ...over,
  });

  test("fewer than 10 leads is too few to judge", () => {
    expect(rowFlag(row({ leads: 9, called: 9 }), client).kind).toBe("too_few");
  });
  test("no lead called yet", () => {
    expect(rowFlag(row({ called: 0 }), client).kind).toBe("not_called");
  });
  test("judged per lead called, against the client's own average", () => {
    // The client: 70 of 95 called leads reached, 32 booked.
    const answersLess = rowFlag(row({ reached: 5 }), client);
    expect(answersLess.kind).toBe("below");
    expect(answersLess.why).toBe(
      "Its leads answer less: 25% reached per lead called, against 74% for the client.",
    );
    expect(rowFlag(row({ booked: 2 }), client).kind).toBe("below");
    expect(rowFlag(row({ booked: 12 }), client).kind).toBe("above");
    expect(rowFlag(row({}), client).kind).toBe("even");
  });
  test("how many of its leads were called is shown beside, not judged", () => {
    const f = rowFlag(row({ called: 10, reached: 7, booked: 3 }), client);
    expect(f.kind).toBe("even");
    expect(f.calledRate).toBe(50);
    expect(f.clientCalledRate).toBe(95);
  });
});

describe("assignedCallers", () => {
  test("the dialer's callers for the client, or a plain line when there is none", () => {
    expect(assignedCallers(read())).toBe("Agent");
    const two = read(r => {
      r.callers.assigned = [
        { email: "l@x.test", name: "Lama Harb" },
        { email: "d@x.test", name: "Daniya Ziad" },
      ];
    });
    expect(assignedCallers(two)).toBe("Lama Harb and Daniya Ziad");
    const none = read(r => {
      r.callers.assigned = [];
      r.callers.otherAccess = [
        { email: "a@x.test", name: "Admin", why: "Dialer admin, not a caller" },
      ];
    });
    expect(assignedCallers(none)).toBe("No caller assigned in the dialer");
  });
});

describe("wording", () => {
  test("durations", () => {
    expect(formatDuration(0)).toBe("under a minute");
    expect(formatDuration(59)).toBe("under a minute");
    expect(formatDuration(60 * 12)).toBe("12 min");
    expect(formatDuration(3600 * 3 + 60 * 12)).toBe("3 h 12 min");
    expect(formatDuration(3600 * 2)).toBe("2 h");
    expect(formatDuration(86400 * 2 + 3600 * 4)).toBe("2 d 4 h");
    expect(formatDuration(86400)).toBe("1 d");
    expect(formatDuration(null)).toBe("Not measured");
    expect(formatDuration(Number.NaN)).toBe("Not measured");
  });
  test("call lengths", () => {
    expect(formatCallLength(45)).toBe("45 s");
    expect(formatCallLength(245)).toBe("4 min 5 s");
    expect(formatCallLength(720)).toBe("12 min");
    expect(formatCallLength(undefined)).toBe("Not measured");
  });
  test("rates and calls per lead", () => {
    expect(formatRate(64.4)).toBe("64%");
    expect(formatRate(0.4)).toBe("0.4%");
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(null)).toBe("Not measured");
    expect(formatPerLead(1.44)).toBe("1.4");
    expect(formatPerLead(null)).toBe("Not measured");
  });
  test("every lost key the database gives has a label", () => {
    for (const key of [
      "not_a_fit",
      "not_interested",
      "not_ready",
      "applied_by_mistake",
      "bad_number",
      "went_elsewhere",
      "distance",
      "financial",
      "unrealistic",
      "setup_issue",
      "never_came_back",
      "unreachable",
      "unclassified",
    ])
      expect(LOST_LABELS[key]).toBeTruthy();
    expect(lostLabel("something new")).toBe("Other, not sorted");
  });
});
