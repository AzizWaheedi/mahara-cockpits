/**
 * Invented answers from public.cockpit_client_calls, one per verdict, for the
 * calls harness (src/dev/callsHarness.tsx) and the render tests
 * (scripts/call-centre-section.test.tsx). Every name, number and note here is
 * made up; the shape is the migration's (20261013180000), with waiting's
 * called and outcomeOnly from 20261016230000.
 */

export type CallsKind =
  | "call_centre"
  | "lead_quality"
  | "on_track"
  | "not_enough"
  | "client_calls"
  | "no_data"
  | "report_failed";

/** A raw answer, read through the zod contract like the database's. */
type Raw = Record<string, any>;

const row = (over: Raw): Raw => ({
  id: null,
  name: null,
  campaignId: null,
  campaignName: null,
  leads: 0,
  called: 0,
  dials: 0,
  reached: 0,
  talked30: 0,
  talked120: 0,
  booked: 0,
  confirmed: 0,
  medianFirstCallSeconds: null,
  ...over,
});

const CAMPAIGNS: Raw[] = [
  row({
    id: "c-villas",
    name: "Villas | Leads | Kuwait",
    leads: 52,
    called: 46,
    dials: 190,
    reached: 36,
    talked30: 30,
    talked120: 22,
    booked: 12,
    confirmed: 11,
    medianFirstCallSeconds: 9_200,
  }),
  row({
    id: "c-pools",
    name: "Pools | Instant form",
    leads: 31,
    called: 25,
    dials: 101,
    reached: 9,
    talked30: 6,
    talked120: 4,
    booked: 2,
    confirmed: 2,
    medianFirstCallSeconds: 15_400,
  }),
  row({
    id: "c-majlis",
    name: "Majlis renovation | Advantage+",
    leads: 22,
    called: 15,
    dials: 76,
    reached: 14,
    talked30: 12,
    talked120: 10,
    booked: 8,
    confirmed: 7,
    medianFirstCallSeconds: 4_100,
  }),
  row({
    id: "c-retarget",
    name: "Retargeting | Video viewers",
    leads: 9,
    called: 6,
    dials: 30,
    reached: 6,
    talked30: 5,
    talked120: 3,
    booked: 2,
    confirmed: 2,
    medianFirstCallSeconds: 7_000,
  }),
  row({
    id: "c-old",
    name: "Spring offer | Lead form",
    leads: 6,
    called: 4,
    dials: 15,
    reached: 3,
    talked30: 2,
    talked120: 1,
    booked: 0,
    confirmed: 0,
    medianFirstCallSeconds: 30_000,
  }),
];

const AD_NAMES = [
  ["Villa walkthrough reel", "c-villas", "Villas | Leads | Kuwait"],
  ["Before and after carousel", "c-villas", "Villas | Leads | Kuwait"],
  ["Founder on site, Arabic", "c-villas", "Villas | Leads | Kuwait"],
  ["Pool at night, static", "c-pools", "Pools | Instant form"],
  ["Pool build timelapse", "c-pools", "Pools | Instant form"],
  ["Majlis 3D render", "c-majlis", "Majlis renovation | Advantage+"],
  ["Majlis client story", "c-majlis", "Majlis renovation | Advantage+"],
  ["Retargeting testimonial", "c-retarget", "Retargeting | Video viewers"],
  ["Spring offer price card", "c-old", "Spring offer | Lead form"],
  ["Kitchen detail reel", "c-villas", "Villas | Leads | Kuwait"],
] as const;

const ADS: Raw[] = AD_NAMES.map(([name, campaignId, campaignName], i) => {
  const leads = [24, 18, 10, 19, 12, 14, 8, 9, 6, 0][i] || 3;
  const called = Math.max(0, leads - [2, 2, 2, 4, 2, 4, 3, 3, 2, 1][i]);
  const reached = Math.round(
    called * [0.8, 0.75, 0.7, 0.2, 0.6, 1, 0.8, 1, 0.75, 0.5][i],
  );
  const booked = Math.round(
    called * [0.3, 0.2, 0.25, 0.05, 0.1, 0.45, 0.4, 0.33, 0, 0][i],
  );
  return row({
    id: `ad-${i + 1}`,
    name: i === 9 ? null : name,
    campaignId,
    campaignName,
    leads,
    called,
    dials: called * 4,
    reached,
    talked30: Math.round(reached * 0.8),
    talked120: Math.round(reached * 0.6),
    booked,
    confirmed: booked,
    medianFirstCallSeconds: 3_600 + i * 1_900,
  });
});

const LOST: Raw[] = [
  {
    name: "Faisal",
    ad: "Villa walkthrough reel",
    key: "not_a_fit",
    reason: "Other",
    note: "عنده أرض بس ما عنده ميزانية للمشروع الحين",
    calls: 3,
    longest: 245,
  },
  {
    name: "Mariam",
    ad: "Pool at night, static",
    key: "unreachable",
    reason: "Unreachable",
    note: null,
    calls: 2,
    // Dialled twice, never answered: no completed call, so no longest.
    longest: null,
    noRecording: true,
  },
  {
    name: "Abdullah",
    ad: "Majlis 3D render",
    key: "distance",
    reason: "Distance Issue",
    note: "Lives in Wafra, too far for the team to visit.",
    calls: 2,
    longest: 132,
  },
  {
    name: "Noura",
    ad: "Before and after carousel",
    key: "applied_by_mistake",
    reason: "Other",
    note: "قالت عبت الفورم بالغلط",
    calls: 1,
    longest: 38,
  },
  {
    name: "Yousef",
    ad: "Pool build timelapse",
    key: "not_interested",
    reason: "Other",
    note: "Not interested anymore, asked us not to call again.",
    calls: 4,
    longest: 61,
  },
  {
    name: "Hessa",
    ad: "Villa walkthrough reel",
    key: "financial",
    reason: "Financial Issue",
    note: "Budget is lower than our starting price.",
    calls: 2,
    longest: 410,
  },
  {
    name: null,
    ad: null,
    key: "unclassified",
    reason: "Other",
    note: "Will think about it",
    calls: 0,
    longest: null,
  },
  {
    name: "Khaled",
    ad: "Founder on site, Arabic",
    key: "went_elsewhere",
    reason: "Other",
    note: "Agreed with another company last week.",
    calls: 3,
    longest: 188,
  },
];

function latestLost(): Raw[] {
  return LOST.map((l, i) => {
    const day = `2026-10-${String(12 - i).padStart(2, "0")}`;
    return {
      at: `${day}T11:${String(10 + i).padStart(2, "0")}:00Z`,
      day,
      firstName: l.name,
      adId: l.ad ? `ad-${i + 1}` : null,
      adName: l.ad,
      reason: l.reason,
      key: l.key,
      note: l.note,
      agent: "Noor Saleh",
      calls: l.calls,
      longestSeconds: l.longest,
      longestCallId: l.calls && !l.noRecording ? String(90_000 + i) : null,
    };
  });
}

/** The client our call centre serves slowly: the first call is late. */
function base(): Raw {
  return {
    version: 1,
    generatedAt: "2026-10-13T13:31:00Z",
    timezone: "Asia/Kuwait",
    from: "2026-09-14",
    to: "2026-10-13",
    client: {
      locationId: "loc-fictional",
      name: "Fictional Villas",
      clickupId: "task-fictional",
      status: "Active",
      serviceMode: "DFY",
      country: "KW",
      dialerActive: true,
    },
    official: {
      leads: 120,
      leadsDialed: 96,
      leadsContacted: 70,
      noVerifiedDial: 24,
      providerDials: 412,
      connections: 220,
      dials: 380,
      talkSeconds: 61_000,
      connectionRate: 0.534,
      medianSpeedSeconds: 11_530,
      avgSpeedSeconds: 19_000,
      speedSamples: 96,
      withinTwoMinutes: 3,
      confirmedBookings: 22,
      provisionalBookings: 4,
      unclassifiedBookings: 0,
      shows: 12,
      noShow: 5,
      showRate: 0.71,
      closed: 3,
    },
    officialCoverage: {
      leadSyncAt: "2026-10-13T12:35:00Z",
      callSyncAt: "2026-10-13T13:25:00Z",
      appointmentSyncAt: "2026-10-13T13:00:00Z",
      sheetSyncAt: null,
    },
    callers: {
      assigned: [{ email: "noor@example.test", name: "Noor Saleh" }],
      otherAccess: [
        {
          email: "lead@example.test",
          name: "Dana Ali",
          why: "admin seat that sees the queue",
        },
      ],
      dialled: [
        { email: "noor@example.test", name: "Noor Saleh", dials: 371 },
        { email: "dana@example.test", name: "Dana Ali", dials: 41 },
      ],
    },
    cohort: {
      leads: 120,
      called: 96,
      dials: 412,
      reached: 70,
      talked30: 58,
      talked120: 40,
      booked: 24,
      confirmed: 22,
    },
    window: {
      dials: 412,
      reached: 220,
      talked30: 120,
      talked120: 70,
      talkSeconds: 61_000,
    },
    notCalled: {
      total: 24,
      noPhone: 9,
      unreadablePhone: 3,
      dialledUnderAnotherLead: 5,
      neverDialled: 7,
      neverDialledOutsideDialerCountries: 2,
      neverDialledWithSavedOutcome: 1,
    },
    speed: {
      hoursSource: "schedule",
      leads: 120,
      medianClockSeconds: 31_000,
      withinFiveMinutes: 4,
      inHours: {
        leads: 48,
        called: 44,
        withinFiveMinutes: 4,
        withinThirtyMinutes: 13,
        medianClockSeconds: 11_400,
      },
      outOfHours: {
        leads: 72,
        called: 52,
        withinFiveMinutes: 0,
        withinThirtyMinutes: 1,
        medianClockSeconds: 58_000,
      },
    },
    followUp: { leads: 20, calls: 28, threePlus: 2 },
    messages: { handled: 6, outcomesWithoutCall: 9 },
    byAd: ADS,
    byCampaign: CAMPAIGNS,
    clientAverage: row({
      leads: 120,
      called: 96,
      dials: 412,
      reached: 68,
      talked30: 55,
      talked120: 40,
      booked: 24,
      confirmed: 22,
      medianFirstCallSeconds: 8_800,
    }),
    waiting: {
      callable: 100,
      touched: 88,
      called: 70,
      outcomeOnly: 18,
      untouched: {
        count: 12,
        oldestAt: "2026-10-09T08:12:00Z",
        oldestWorkSeconds: 93_600,
      },
      stages: [
        {
          stage: "Day 1 AM - Follow Up",
          position: 1,
          count: 14,
          medianDays: 3.2,
          oldestDays: 13,
          overSevenDays: 4,
        },
        {
          stage: "Day 1 PM - Follow Up",
          position: 2,
          count: 6,
          medianDays: 5,
          oldestDays: 9,
          overSevenDays: 1,
        },
        {
          stage: "Day 2 - Follow Up",
          position: 3,
          count: 3,
          medianDays: 0.4,
          oldestDays: 2,
          overSevenDays: 0,
        },
      ],
      callbacks: {
        count: 5,
        overThreeDays: 3,
        oldestTouchAt: "2026-10-02T10:00:00Z",
        scheduled: 1,
        overdue: 1,
      },
      missedInbound: {
        count: 6,
        callers: 5,
        withinFifteenMinutes: 1,
        withinTwoHours: 2,
        withinDay: 3,
        never: 3,
        oldestNeverAt: "2026-10-07T19:40:00Z",
      },
    },
    lost: {
      total: 31,
      reasons: [
        { key: "not_a_fit", count: 9 },
        { key: "unreachable", count: 7 },
        { key: "not_interested", count: 5 },
        { key: "distance", count: 3 },
        { key: "applied_by_mistake", count: 3 },
        { key: "financial", count: 2 },
        { key: "went_elsewhere", count: 1 },
        { key: "unclassified", count: 1 },
      ],
      otherNotes: { total: 19, sorted: 18 },
      unreachable: { leads: 7, calls: 9, noCall: 2, fourPlus: 0, connected: 1 },
      latest: latestLost(),
    },
    coverage: {
      unlinkedCalls: 14,
      leadsWithoutPhone: 9,
      leadsWithUnreadablePhone: 3,
      leadsWithoutAdId: 4,
      metaLeadsWithoutAdId: 3,
      leadsOnlyInGhl: 2,
      newestCallAt: "2026-10-13T13:24:00Z",
      newestClientCallAt: "2026-10-13T12:58:00Z",
      newestAttemptAt: "2026-10-13T13:26:00Z",
      newestClientAttemptAt: "2026-10-13T13:01:00Z",
      leadSyncAt: "2026-10-13T12:35:00Z",
    },
    notes: [
      "Leads, dials, reached, first call in working time and bookings are the dialer's own report, the same as the CEO Calls tab. The rest is worked out here with the dialer's link rule.",
      "Dials are verified Maqsam calls. Outcomes the agent saved without a Maqsam call are shown apart and never counted as dials.",
      "Reached includes voicemail. Talked 30 s and talked 2 min show real conversations.",
      "In hours means the assigned callers' working hours on Team & Payroll.",
    ],
  };
}

/** One invented answer that lands on `kind`. */
export function callCentreFixture(kind: CallsKind = "call_centre"): Raw {
  const r = base();
  if (kind === "on_track") {
    r.official.confirmedBookings = 34;
    r.cohort.confirmed = 34;
    // Like City Wood on 16 Oct: 95% touched, but only 57% with a Maqsam call;
    // the rest have a saved outcome and no call.
    r.waiting.touched = 95;
    r.waiting.called = 57;
    r.waiting.outcomeOnly = 38;
    r.waiting.untouched.count = 5;
  }
  if (kind === "lead_quality") {
    r.official.medianSpeedSeconds = 540;
    r.official.confirmedBookings = 14;
    r.official.leadsContacted = 82;
    r.window.talked120 = 120;
    r.cohort.talked120 = 61;
    r.waiting.touched = 99;
    r.waiting.called = 96;
    r.waiting.outcomeOnly = 3;
    r.waiting.untouched = { count: 0, oldestAt: null, oldestWorkSeconds: null };
    r.waiting.callbacks = {
      count: 2,
      overThreeDays: 0,
      oldestTouchAt: "2026-10-12T10:00:00Z",
      scheduled: 2,
      overdue: 0,
    };
    r.waiting.missedInbound = {
      count: 1,
      callers: 1,
      withinFifteenMinutes: 1,
      withinTwoHours: 1,
      withinDay: 1,
      never: 0,
      oldestNeverAt: null,
    };
    r.followUp = { leads: 20, calls: 84, threePlus: 18 };
    r.lost.reasons = [
      { key: "not_a_fit", count: 12 },
      { key: "distance", count: 6 },
      { key: "financial", count: 4 },
      { key: "not_interested", count: 3 },
      { key: "unreachable", count: 2 },
    ];
    r.lost.total = 27;
  }
  if (kind === "not_enough") {
    const o = r.official;
    Object.assign(o, {
      leads: 12,
      leadsDialed: 11,
      leadsContacted: 8,
      noVerifiedDial: 1,
      providerDials: 39,
      connections: 20,
      connectionRate: 0.51,
      confirmedBookings: 2,
      provisionalBookings: 0,
      shows: 1,
    });
    Object.assign(r.cohort, {
      leads: 12,
      called: 11,
      dials: 39,
      reached: 8,
      talked30: 6,
      talked120: 4,
      booked: 2,
      confirmed: 2,
    });
    r.notCalled = {
      total: 1,
      noPhone: 1,
      unreadablePhone: 0,
      dialledUnderAnotherLead: 0,
      neverDialled: 0,
      neverDialledOutsideDialerCountries: 0,
      neverDialledWithSavedOutcome: 0,
    };
    // Every count follows the 12 leads, so no rate runs past 100%.
    r.window = {
      dials: 39,
      reached: 20,
      talked30: 9,
      talked120: 4,
      talkSeconds: 3_900,
    };
    r.byCampaign = [
      {
        ...CAMPAIGNS[0],
        leads: 7,
        called: 7,
        dials: 24,
        reached: 5,
        talked30: 4,
        talked120: 3,
        booked: 1,
        confirmed: 1,
      },
      {
        ...CAMPAIGNS[1],
        leads: 5,
        called: 4,
        dials: 15,
        reached: 3,
        talked30: 2,
        talked120: 1,
        booked: 1,
        confirmed: 1,
      },
    ];
    r.clientAverage = row({
      leads: 12,
      called: 11,
      dials: 39,
      reached: 8,
      talked30: 6,
      talked120: 4,
      booked: 2,
      confirmed: 2,
      medianFirstCallSeconds: 11_000,
    });
    r.byAd = [];
    r.speed = {
      ...r.speed,
      leads: 12,
      medianClockSeconds: 12_600,
      withinFiveMinutes: 1,
      inHours: {
        leads: 5,
        called: 5,
        withinFiveMinutes: 1,
        withinThirtyMinutes: 2,
        medianClockSeconds: 3_000,
      },
      outOfHours: {
        leads: 7,
        called: 6,
        withinFiveMinutes: 0,
        withinThirtyMinutes: 0,
        medianClockSeconds: 40_000,
      },
    };
    r.followUp = { leads: 3, calls: 7, threePlus: 2 };
    r.messages = { handled: 1, outcomesWithoutCall: 2 };
    r.waiting = {
      ...r.waiting,
      callable: 10,
      touched: 9,
      called: 8,
      outcomeOnly: 1,
      untouched: {
        count: 1,
        oldestAt: "2026-10-12T21:30:00Z",
        oldestWorkSeconds: 7_200,
      },
      stages: [
        {
          stage: "Day 1 AM - Follow Up",
          position: 1,
          count: 3,
          medianDays: 1.2,
          oldestDays: 4,
          overSevenDays: 0,
        },
      ],
      callbacks: {
        count: 1,
        overThreeDays: 0,
        oldestTouchAt: "2026-10-12T10:00:00Z",
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
    };
    r.coverage = {
      ...r.coverage,
      unlinkedCalls: 1,
      leadsWithoutPhone: 1,
      leadsWithUnreadablePhone: 0,
      leadsWithoutAdId: 12,
      metaLeadsWithoutAdId: 0,
      leadsOnlyInGhl: 0,
    };
    r.lost = {
      ...r.lost,
      total: 0,
      reasons: [],
      otherNotes: { total: 0, sorted: 0 },
      unreachable: { leads: 0, calls: 0, noCall: 0, fourPlus: 0, connected: 0 },
      latest: [],
    };
  }
  if (kind === "client_calls") {
    r.client.serviceMode = "DWY";
    r.callers.assigned = [];
    r.callers.dialled = [
      { email: "noor@example.test", name: "Noor Saleh", dials: 12 },
    ];
  }
  if (kind === "no_data") {
    r.official = null;
    r.client.dialerActive = false;
    r.callers.assigned = [];
    r.callers.dialled = [];
    r.notes = [
      ...r.notes,
      "The dialer's report has no row for this client, so the official headline is missing.",
      "This client is switched off in the dialer, so no new leads reach the callers.",
    ];
    r.waiting.untouched = { count: 0, oldestAt: null, oldestWorkSeconds: null };
    r.waiting.callbacks.count = 0;
    r.waiting.callbacks.overThreeDays = 0;
    r.waiting.callbacks.overdue = 0;
    r.waiting.missedInbound.count = 0;
    r.waiting.missedInbound.never = 0;
    r.waiting.stages = [];
  }
  if (kind === "report_failed") {
    // The dialer's report failed inside the read: no headline, the leads,
    // waiting and lost reasons still there (migration 20261013180000).
    r.official = null;
    r.officialCoverage = null;
    r.notes = [
      ...r.notes,
      "The dialer's report did not answer, so the official headline is missing. Try again in a minute.",
    ];
  }
  return r;
}

/** Every client's callers, as cockpit_client_callers answers. */
export function callersFixture(): Raw {
  return {
    clients: [
      {
        taskId: "task-fictional",
        locationId: "loc-fictional",
        clientName: "Fictional Villas",
        callers: [{ email: "noor@example.test", name: "Noor Saleh" }],
      },
      {
        taskId: "task-two",
        locationId: "loc-two-a",
        clientName: "Second Pools",
        callers: [{ email: "noor@example.test", name: "Noor Saleh" }],
      },
      {
        taskId: "task-two",
        locationId: "loc-two-b",
        clientName: "Second Pools, branch",
        callers: [
          { email: "noor@example.test", name: "Noor Saleh" },
          { email: "dana@example.test", name: "Dana Ali" },
        ],
      },
      {
        taskId: null,
        locationId: "loc-orphan",
        clientName: "No card",
        callers: [],
      },
    ],
    source: "The dialer's client assignments",
    generatedAt: "2026-10-13T13:31:00Z",
  };
}
