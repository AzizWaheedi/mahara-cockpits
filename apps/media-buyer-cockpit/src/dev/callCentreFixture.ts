/**
 * Made-up answers from public.cockpit_client_calls, one per verdict, for the
 * Calls part's harness (callCentreHarness.ts) and its render tests
 * (scripts/call-centre-section.test.tsx). Every name, number and note is
 * invented; the shape follows migration 20261013180000, with waiting's
 * called and outcomeOnly from 20261016230000. Never imported by the
 * production app.
 */

type Raw = Record<string, any>;

export type CallScenario =
  | "call_centre"
  | "lead_quality"
  | "on_track"
  | "not_enough"
  | "client_calls"
  | "no_data"
  | "empty";

export const CALL_SCENARIOS: CallScenario[] = [
  "call_centre",
  "lead_quality",
  "on_track",
  "not_enough",
  "client_calls",
  "no_data",
  "empty",
];

// id, name, campaign, leads, called, dials, reached, talked30, talked120,
// booked, confirmed, median first call (clock seconds)
type AdLine = [
  string,
  string,
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number | null,
];

const CAMPAIGNS: Record<string, string> = {
  c1: "Villa fit-out | Leads",
  c2: "Kitchens | Retarget",
  c3: "Majlis | Arabic hooks",
};

const ADS: AdLine[] = [
  [
    "a1",
    "Villa reel | Majlis before and after",
    "c1",
    28,
    24,
    86,
    19,
    15,
    9,
    6,
    5,
    3900,
  ],
  [
    "a2",
    "Villa reel | Kitchen walk-through",
    "c1",
    22,
    18,
    61,
    15,
    12,
    8,
    5,
    4,
    5200,
  ],
  ["a3", "Carousel | Five finishes", "c1", 14, 11, 30, 3, 2, 1, 0, 0, 9100],
  ["a4", "Static | Free site visit", "c1", 6, 5, 14, 4, 3, 2, 1, 1, 2400],
  ["a5", "Reel | Chef's kitchen", "c2", 18, 16, 52, 13, 11, 8, 6, 5, 3000],
  ["a6", "Reel | Small kitchen fixes", "c2", 12, 0, 0, 0, 0, 0, 0, 0, null],
  ["a7", "Static | Kitchen offer", "c2", 5, 4, 11, 3, 2, 1, 1, 1, 4100],
  ["a8", "ريل | مجلس عصري", "c3", 9, 8, 25, 6, 5, 3, 2, 2, 6000],
  ["a9", "Reel | Majlis lighting", "c3", 4, 4, 9, 3, 2, 1, 1, 1, 3500],
  ["a10", "Static | Majlis sofa", "c3", 3, 3, 8, 2, 1, 1, 0, 0, 7200],
  ["a11", "Carousel | Ceilings", "c3", 3, 1, 2, 1, 1, 0, 0, 0, 8800],
];
/** Leads with no ad or campaign id: in the totals, in no row. */
const NO_AD = {
  leads: 4,
  called: 2,
  dials: 5,
  reached: 1,
  talked30: 1,
  talked120: 0,
  booked: 0,
  confirmed: 0,
};

const KEYS = [
  "leads",
  "called",
  "dials",
  "reached",
  "talked30",
  "talked120",
  "booked",
  "confirmed",
] as const;

function adRow(a: AdLine): Raw {
  return {
    id: a[0],
    name: a[1],
    campaignId: a[2],
    campaignName: CAMPAIGNS[a[2]],
    leads: a[3],
    called: a[4],
    dials: a[5],
    reached: a[6],
    talked30: a[7],
    talked120: a[8],
    booked: a[9],
    confirmed: a[10],
    medianFirstCallSeconds: a[11],
  };
}

function sum(rows: Raw[], extra?: Raw): Raw {
  const out: Raw = {};
  for (const k of KEYS)
    out[k] = rows.reduce((s, r) => s + r[k], 0) + (extra?.[k] ?? 0);
  return out;
}

function base(from: string, to: string): Raw {
  const byAd = ADS.map(adRow);
  const byCampaign = Object.keys(CAMPAIGNS)
    .map(id => ({
      id,
      name: CAMPAIGNS[id],
      campaignId: null,
      campaignName: null,
      ...sum(byAd.filter(r => r.campaignId === id)),
      medianFirstCallSeconds: id === "c2" ? 3300 : id === "c1" ? 4800 : 6100,
    }))
    .sort((a, b) => b.leads - a.leads);
  const cohort = sum(byAd, NO_AD);
  const clientAverage = {
    id: null,
    name: null,
    campaignId: null,
    campaignName: null,
    ...cohort,
    medianFirstCallSeconds: 4700,
  };
  const dials = 412;
  return {
    version: 1,
    generatedAt: `${to}T09:12:00Z`,
    timezone: "Asia/Kuwait",
    from,
    to,
    client: {
      locationId: "harness-loc-liwan",
      name: "Harbor Interiors",
      clickupId: "harness-cu-1",
      status: "Active",
      serviceMode: "DFY",
      country: "KW",
      dialerActive: true,
    },
    official: {
      leads: cohort.leads,
      leadsDialed: cohort.called,
      leadsContacted: cohort.reached,
      noVerifiedDial: cohort.leads - cohort.called,
      providerDials: dials,
      connections: 170,
      dials: 380,
      talkSeconds: 61200,
      connectionRate: 170 / dials,
      medianSpeedSeconds: 7800,
      avgSpeedSeconds: 14400,
      speedSamples: cohort.called,
      withinTwoMinutes: 9,
      confirmedBookings: cohort.confirmed,
      provisionalBookings: cohort.booked - cohort.confirmed,
      unclassifiedBookings: 0,
      shows: 12,
      noShow: 5,
      showRate: 12 / 17,
      closed: 3,
    },
    officialCoverage: {
      leadSyncAt: `${to}T08:58:00Z`,
      callSyncAt: `${to}T09:10:00Z`,
      appointmentSyncAt: `${to}T09:05:00Z`,
      sheetSyncAt: null,
    },
    callers: {
      assigned: [{ email: "rana.saleh@example.test", name: "Rana Saleh" }],
      otherAccess: [
        {
          email: "ops@example.test",
          name: "Ops desk",
          why: "Dialer admin, not a caller",
        },
      ],
      dialled: [
        { email: "rana.saleh@example.test", name: "Rana Saleh", dials: 301 },
        { email: "dana.yousef@example.test", name: "Dana Yousef", dials: 111 },
      ],
    },
    cohort: { ...cohort },
    window: {
      dials,
      reached: 170,
      talked30: 130,
      talked120: 90,
      talkSeconds: 61200,
    },
    notCalled: {
      total: cohort.leads - cohort.called,
      noPhone: 3,
      unreadablePhone: 2,
      dialledUnderAnotherLead: 4,
      neverDialled: cohort.leads - cohort.called - 9,
      neverDialledOutsideDialerCountries: 2,
      neverDialledWithSavedOutcome: 5,
    },
    speed: {
      hoursSource: "schedule",
      leads: cohort.leads,
      medianClockSeconds: 5400,
      withinFiveMinutes: 33,
      inHours: {
        leads: 80,
        called: 66,
        withinFiveMinutes: 31,
        withinThirtyMinutes: 48,
        medianClockSeconds: 1500,
      },
      outOfHours: {
        leads: 48,
        called: 30,
        withinFiveMinutes: 2,
        withinThirtyMinutes: 6,
        medianClockSeconds: 41000,
      },
    },
    followUp: { leads: 30, calls: 42, threePlus: 6 },
    messages: { handled: 7, outcomesWithoutCall: 11 },
    byAd,
    byCampaign,
    clientAverage,
    waiting: {
      callable: 110,
      touched: 92,
      called: 74,
      outcomeOnly: 18,
      untouched: {
        count: 6,
        oldestAt: `${addDays(to, -2)}T07:20:00Z`,
        oldestWorkSeconds: 50400,
      },
      stages: [
        {
          stage: "New lead",
          position: 0,
          count: 6,
          medianDays: 0.4,
          oldestDays: 2.1,
          overSevenDays: 0,
        },
        {
          stage: "Day 1 - follow up",
          position: 1,
          count: 9,
          medianDays: 1.2,
          oldestDays: 3.5,
          overSevenDays: 0,
        },
        {
          stage: "Day 2 - follow up",
          position: 2,
          count: 7,
          medianDays: 2.4,
          oldestDays: 6,
          overSevenDays: 0,
        },
        {
          stage: "Callback booked",
          position: 4,
          count: 3,
          medianDays: 5.5,
          oldestDays: 12.2,
          overSevenDays: 1,
        },
        {
          stage: "Nurture",
          position: 6,
          count: 14,
          medianDays: 9.3,
          oldestDays: 31,
          overSevenDays: 9,
        },
      ],
      callbacks: {
        count: 4,
        overThreeDays: 2,
        oldestTouchAt: `${addDays(to, -6)}T11:00:00Z`,
        scheduled: 3,
        overdue: 2,
      },
      missedInbound: {
        count: 5,
        callers: 4,
        withinFifteenMinutes: 1,
        withinTwoHours: 2,
        withinDay: 3,
        never: 2,
        oldestNeverAt: `${addDays(to, -4)}T16:40:00Z`,
      },
    },
    lost: {
      total: 34,
      reasons: [
        { key: "not_a_fit", count: 9 },
        { key: "unreachable", count: 7 },
        { key: "distance", count: 6 },
        { key: "financial", count: 5 },
        { key: "not_interested", count: 4 },
        { key: "unclassified", count: 3 },
      ],
      otherNotes: { total: 14, sorted: 11 },
      unreachable: {
        leads: 7,
        calls: 23,
        noCall: 1,
        fourPlus: 3,
        connected: 0,
      },
      latest: lostLeads(to),
    },
    coverage: {
      unlinkedCalls: 3,
      leadsWithoutPhone: 3,
      leadsWithUnreadablePhone: 2,
      leadsWithoutAdId: NO_AD.leads,
      metaLeadsWithoutAdId: 1,
      leadsOnlyInGhl: 2,
      newestCallAt: `${to}T09:11:00Z`,
      newestClientCallAt: `${to}T08:47:00Z`,
      newestAttemptAt: `${to}T09:11:30Z`,
      newestClientAttemptAt: `${to}T08:49:00Z`,
      leadSyncAt: `${to}T08:58:00Z`,
    },
    notes: [
      "Leads, dials, reached, first call in working time and bookings are the dialer's own report, the same as the CEO Calls tab. The rest is worked out here with the dialer's link rule.",
      "Dials are verified Maqsam calls. Outcomes the agent saved without a Maqsam call are shown apart and never counted as dials.",
      "Per lead figures follow the leads that arrived in these dates, with every verified call made to them so far, also after the end date.",
      "Reached includes voicemail. Talked 30 s and talked 2 min show real conversations.",
      "In hours means the assigned callers' working hours on Team & Payroll.",
      "Lost reasons come from the dialer. Notes under Other are sorted by keyword; the rest stay unsorted. Leads marked lost in GoHighLevel outside the dialer are not here.",
    ],
  };
}

function lostLeads(to: string): Raw[] {
  // first name, ad, reason, key, note, calls, longest seconds, call id, days ago
  const rows: [
    string | null,
    string,
    string,
    string,
    string | null,
    number,
    number | null,
    string | null,
    number,
  ][] = [
    [
      "Noura",
      "a1",
      "Other",
      "not_a_fit",
      "Has no project yet, only bought the land.",
      3,
      200,
      "88120031",
      0,
    ],
    ["Khalid", "a3", "Unreachable", "unreachable", null, 5, null, null, 0],
    [
      "Mariam",
      "a2",
      "Distance Issue",
      "distance",
      "Lives in Jahra, too far for a site visit.",
      2,
      146,
      "88119822",
      1,
    ],
    [
      "Yousef",
      "a5",
      "Financial Issue",
      "financial",
      "السعر عالي عليه، بيفكر ويرجع لنا",
      2,
      312,
      "88119107",
      1,
    ],
    [
      null,
      "a8",
      "Other",
      "not_interested",
      "Closed the line, not interested.",
      1,
      41,
      "88118455",
      2,
    ],
    [
      "Huda",
      "a1",
      "Other",
      "not_a_fit",
      "Looking for a contractor for a plot, not interiors.",
      3,
      95,
      "88117730",
      3,
    ],
    ["Faisal", "a6", "Unreachable", "unreachable", null, 4, null, null, 4],
    [
      "Reem",
      "a9",
      "Other",
      "unclassified",
      "Asked to be called after Eid.",
      2,
      63,
      "88116004",
      5,
    ],
  ];
  return rows.map(
    (
      [firstName, ad, reason, key, note, callsMade, longest, callId, ago],
      i,
    ) => {
      const day = addDays(to, -ago);
      const a = ADS.find(x => x[0] === ad);
      return {
        at: `${day}T${String(15 - i).padStart(2, "0")}:20:00Z`,
        day,
        firstName,
        adId: ad,
        adName: a?.[1] ?? null,
        reason,
        key,
        note,
        agent: i % 3 === 2 ? "Dana Yousef" : "Rana Saleh",
        calls: callsMade,
        longestSeconds: longest,
        longestCallId: callId,
      };
    },
  );
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400e3)
    .toISOString()
    .slice(0, 10);
}

/** One made-up answer per verdict kind, for the given dates. */
export function callCentreScenario(
  kind: CallScenario,
  from = "2026-09-14",
  to = "2026-10-13",
): Raw {
  const r = base(from, to);
  if (kind === "call_centre") return r;
  if (kind === "lead_quality") {
    // Fast, repeated calls that are answered and talked through; few book.
    r.official.medianSpeedSeconds = 540;
    // Nobody waits, so every callable lead is touched, as on a real read.
    r.waiting.touched = 110;
    r.waiting.called = 106;
    r.waiting.outcomeOnly = 4;
    r.waiting.untouched = { count: 0, oldestAt: null, oldestWorkSeconds: null };
    r.waiting.callbacks.overdue = 0;
    r.waiting.missedInbound.never = 0;
    r.followUp = { leads: 30, calls: 126, threePlus: 24 };
    r.window.talked120 = 140;
    r.window.reached = 214;
    r.official.connections = 214;
    r.official.connectionRate = 214 / 412;
    return r;
  }
  if (kind === "on_track") {
    // Books over the line while two call centre checks still miss.
    r.official.confirmedBookings = 36;
    r.official.medianSpeedSeconds = 2700;
    r.window.talked120 = 140;
    r.followUp = { leads: 30, calls: 126, threePlus: 24 };
    // Like City Wood on 16 Oct: 95% touched, but only 57% with a Maqsam call;
    // the rest have a saved outcome and no call.
    r.waiting.touched = 104;
    r.waiting.called = 63;
    r.waiting.outcomeOnly = 41;
    return r;
  }
  if (kind === "not_enough") {
    r.official.leads = 12;
    r.official.leadsDialed = 9;
    r.official.leadsContacted = 6;
    r.official.confirmedBookings = 2;
    r.official.provisionalBookings = 1;
    r.official.shows = 1;
    r.notes.push(
      "Leads or leads called here (128, 96) differ from the dialer's report (12, 9). The report is the one shown.",
    );
    return r;
  }
  if (kind === "client_calls") {
    r.client.serviceMode = "DWY";
    r.callers.assigned = [];
    r.callers.dialled = [
      { email: "rana.saleh@example.test", name: "Rana Saleh", dials: 6 },
    ];
    return r;
  }
  if (kind === "no_data") {
    r.official = null;
    r.officialCoverage = null;
    r.notes.push(
      "The dialer's report has no row for this client, so the official headline is missing.",
    );
    return r;
  }
  // empty: no lead came in.
  const zero = Object.fromEntries(KEYS.map(k => [k, 0]));
  r.official = {
    ...r.official,
    leads: 0,
    leadsDialed: 0,
    leadsContacted: 0,
    noVerifiedDial: 0,
    providerDials: 0,
    connections: 0,
    dials: 0,
    connectionRate: null,
    medianSpeedSeconds: null,
    speedSamples: 0,
    confirmedBookings: 0,
    provisionalBookings: 0,
    shows: 0,
    noShow: 0,
    showRate: null,
    closed: 0,
  };
  r.cohort = { ...zero };
  r.window = {
    dials: 0,
    reached: 0,
    talked30: 0,
    talked120: 0,
    talkSeconds: 0,
  };
  r.byAd = [];
  r.byCampaign = [];
  r.clientAverage = null;
  r.lost = {
    total: 0,
    reasons: [],
    otherNotes: { total: 0, sorted: 0 },
    unreachable: { leads: 0, calls: 0, noCall: 0, fourPlus: 0, connected: 0 },
    latest: [],
  };
  return r;
}

/** Every visible client's callers, as cockpit_client_callers answers. */
export function callersScenario(): Raw {
  return {
    clients: [
      {
        taskId: "t1",
        locationId: "harness-loc-liwan",
        clientName: "Liwan Limited",
        callers: [{ email: "rana.saleh@example.test", name: "Rana Saleh" }],
      },
      {
        taskId: "t2",
        locationId: "harness-loc-ocean",
        clientName: "Ocean Home",
        callers: [
          { email: "dana.yousef@example.test", name: "Dana Yousef" },
          { email: "rana.saleh@example.test", name: "Rana Saleh" },
        ],
      },
      {
        taskId: "t3",
        locationId: "harness-loc-wood",
        clientName: "City Wood",
        callers: [],
      },
    ],
    source: "The dialer's client assignments",
    generatedAt: "2026-10-13T09:00:00Z",
  };
}
