/**
 * Stand-in data for the media buyer's screens in the layout harness only
 * (src/dev/harness.tsx; never in the production bundle). Shaped like the
 * real payloads (cockpit:snapshot and the queries beside it), with a spread
 * of cases so every chip, flag and empty state has something to show.
 */
const H = 3_600_000;
const D = 24 * H;

function day(offset = 0): string {
  return new Date(Date.now() + 3 * H - offset * D).toISOString().slice(0, 10);
}

type Row = Record<string, unknown>;

function campaign(over: Row): Row {
  const name = String(over.campaignName);
  return {
    _id: `c-${name}`,
    internal: false,
    spend7d: 420,
    leads7d: 31,
    cpl: 13.55,
    bookings7d: 9,
    bookingRate: 29,
    costPerBooking: 46.7,
    dayRate: 60,
    spendToday: 58.2,
    dataThrough: day(1),
    budgetDaily: 60,
    budgetLevel: "campaign",
    verdict: "scale",
    reason: "7 days: $420 for 31 leads at $13.55, 9 bookings at $47.",
    findings: [],
    onBoard: true,
    taskId: `t-${name}`,
    taskUrl: "https://app.clickup.com/t/abc",
    boardAdStatus: "Live",
    metaAccountId: "1234567890",
    metaCampaignId: `m-${name}`,
    clientTag: over.clientName,
    currency: "USD",
    daysLive: 18,
    lastChangeAt: Date.now() - 5 * D,
    daysSinceTouch: 2,
    advertisingCities: ["KW - Hawalli", "KW - Salmiya"],
    serviceType: "Interior design",
    ...over,
  };
}

const campaigns: Row[] = [
  campaign({
    campaignName: "Liwan | Villa fit-out | Leads",
    clientName: "Liwan Limited",
    verdict: "hold",
    cpl: 18.2,
    costPerBooking: 92,
    leads7d: 22,
    bookings7d: 4,
    spend7d: 401,
    reason: "7 days: $401 for 22 leads at $18.20, over the $15 gate.",
    findings: [
      {
        constraint: "Landing page",
        severity: "constraint",
        evidence:
          "Link CTR is healthy at 1.4% but only 6% of clicks leave their details.",
        fixes: [
          "Move the form above the fold",
          "Cut the form to three questions",
        ],
      },
      {
        constraint: "Creative",
        severity: "optimization",
        evidence: "Frequency 2.9 on the best ad.",
        fixes: ["Queue one new hook for next week"],
      },
    ],
  }),
  campaign({
    campaignName: "Liwan | Kitchens | Retarget",
    clientName: "Liwan Limited",
    verdict: "scale",
    daysLive: 2,
  }),
  campaign({
    campaignName: "Ocean Home | Summer offer",
    clientName: "Ocean Home",
    verdict: "kill",
    cpl: 34.1,
    leads7d: 6,
    bookings7d: 0,
    costPerBooking: undefined,
    spend7d: 205,
    dayRate: 28,
    accountIssue:
      "The ad account has an unsettled balance; Meta refuses every edit until the card is paid.",
    findings: [
      {
        constraint: "Offer",
        severity: "constraint",
        evidence: "CPL doubled after the offer changed.",
        fixes: ["Go back to the free consultation offer"],
      },
    ],
  }),
  campaign({
    campaignName: "City Wood | Doors | ABO",
    clientName: "City Wood",
    verdict: "fatiguing",
    boardAdStatus: "Paused",
    budgetLevel: "adset",
    currency: "KWD",
    staleTaskName: "City Wood | Doors | old",
  }),
  campaign({
    campaignName: "ARCWANI | Showroom",
    clientName: "ARCWANI",
    serviceMode: "DWY",
    verdict: "scale",
    bookings7d: undefined,
    costPerBooking: undefined,
  }),
  campaign({
    campaignName: "شركة العلا | حملة الربيع",
    clientName: "شركة العلا",
    verdict: "no delivery",
    spend7d: 0,
    leads7d: 0,
    cpl: undefined,
    spendToday: 0,
    dayRate: 0,
  }),
  campaign({
    campaignName: "Castello | Old launch",
    clientName: "Castello Industries",
    verdict: "off board",
    boardAdStatus: "Dead Campaign",
    spendToday: 0,
    dataThrough: day(9),
  }),
  campaign({
    campaignName: "Mahara | B2B webinar",
    clientName: "Mahara Media",
    internal: true,
    verdict: "scale",
  }),
];

function tree(): Row[] {
  const out: Row[] = [];
  for (const c of campaigns) {
    const name = String(c.campaignName);
    if (name.startsWith("Castello") || name.startsWith("شركة")) continue;
    const setId = `as-${name}`;
    const active = !name.startsWith("Ocean");
    out.push({
      _id: setId,
      kind: "adset",
      campaignName: name,
      name: "Broad | 25-55 | KW",
      metaId: setId,
      effectiveStatus: active ? "ACTIVE" : "CAMPAIGN_PAUSED",
      dailyBudget: 30,
    });
    for (const n of [1, 2]) {
      out.push({
        _id: `ad-${name}-${n}`,
        kind: "ad",
        campaignName: name,
        adsetId: setId,
        name: `Hook ${n} | before and after`,
        metaId: `ad-${name}-${n}`,
        effectiveStatus: active && n === 1 ? "ACTIVE" : "PAUSED",
      });
    }
  }
  return out;
}

const checks: Row[] = [
  {
    _id: "k1",
    phase: "sod",
    order: 1,
    key: "whatsapp_am",
    label: "Answer every client group on WhatsApp",
    detail: "Three groups have unread messages since last night.",
    done: true,
  },
  {
    _id: "k2",
    phase: "sod",
    order: 2,
    key: "clickup",
    label: "Clear your ClickUp mentions",
    href: "/tasks",
    done: false,
  },
  {
    _id: "k3",
    phase: "sod",
    order: 3,
    key: "touch",
    label: "Send the touchpoints owed today",
    href: "/touchpoints",
    done: false,
  },
  {
    _id: "k4",
    phase: "sod",
    order: 4,
    key: "spend",
    label: "Check every account delivered yesterday",
    detail: "Anything at $0 is a card or a rejected ad.",
    done: false,
  },
  {
    _id: "m1",
    phase: "mid",
    order: 5,
    key: "mid1",
    label: "Pacing against the daily budgets",
    done: false,
  },
  {
    _id: "m2",
    phase: "mid",
    order: 6,
    key: "mid2",
    label: "New leads called within the hour",
    detail: "Ask the call centre",
    done: true,
  },
];

export function portalFixtures(): Record<string, unknown> {
  const now = Date.now();
  return {
    "cockpit:snapshot": {
      day: day(0),
      campaigns,
      ads: [
        {
          campaignName: "Liwan | Villa fit-out | Leads",
          adName: "Hook 1 | before and after",
          verdict: "scale",
        },
      ],
      metaTree: tree(),
      adChanges: [],
      manualChanges: [],
      offBoardCampaigns: [
        {
          campaignName: "Unknown | Lookalike test",
          accountName: "Mahara Clients 3",
          spend7d: 88,
          leads7d: 5,
        },
      ],
      clientLinks: [
        {
          name: "Liwan Limited",
          aliases: ["liwan"],
          driveLink: "https://drive.google.com",
          brandDnaDoc: "https://docs.google.com",
          url: "https://app.clickup.com/t/x",
          dosDonts: "Do: show finished villas\nDon't: mention prices",
        },
      ],
      clientUpdates: [],
      boardCards: [
        {
          taskId: "b1",
          name: "Castello | Old launch",
          tag: "Castello Industries",
          adStatus: "Dead Campaign",
          updatedAt: now - 20 * D,
          url: "https://app.clickup.com/t/b1",
          advertisingCities: ["KW - Hawalli"],
        },
      ],
      members: [
        { userId: 1, username: "Aziz" },
        { userId: 2, username: "Saleh" },
      ],
      inbox: [
        {
          _id: "i1",
          title: "Liwan: new villa creatives",
          url: "https://app.clickup.com/t/i1",
          kind: "assigned",
          reason: "assigned to you",
          listName: "Ads Management",
          overdue: true,
          taskId: "i1",
        },
        {
          _id: "i2",
          title: "Ocean Home: card declined again",
          url: "https://app.clickup.com/t/i2",
          kind: "mention",
          author: "Saleh",
          body: "Can you pause the summer campaign until they pay?",
          listName: "Marketing / ADs",
          taskId: "i2",
        },
      ],
      prefs: [],
      eod: null,
      checks,
      feedback: [
        {
          _id: "f1",
          text: "Liwan's spend looks too low today, can you check?",
          page: "Start of day",
          at: now - 3 * H,
          delivered: true,
          reply: "Yes, Meta held the budget for review. Fixed.",
        },
      ],
      decisions: [
        {
          _id: "d1",
          subject: "Liwan | Kitchens | Retarget",
          action: "Scale the winner",
          kind: "approved",
          loggedAt: now - H,
          clickupTaskUrl: "https://app.clickup.com/t/x",
        },
        {
          _id: "d2",
          subject: "ARCWANI | Showroom",
          action: "Lead quality — client needs a conversation",
          kind: "rerouted",
          reroutedTo: "client_success",
          reason: "Leads say they only wanted prices",
        },
      ],
      plan: [
        {
          _id: "p1",
          text: "Liwan: decide on the new hook once it has 3 days of data",
          listName: "Marketing / ADs",
          clickupTaskUrl: "https://app.clickup.com/t/p1",
        },
      ],
      lastSyncAt: now - 40 * 60_000,
      syncProblems: [],
      syncHealth: null,
      totals: {
        clientSpend: 12480,
        clientLeads: 811,
        blendedCpl: 15.39,
        overGate: 3,
        underFloor: 2,
        offBoard: 1,
      },
    },
    "chat:activity": {
      recent: [],
      queued: 0,
      waitingOnViktor: 0,
      lastSyncAt: now - 40 * 60_000,
      lastSyncOk: true,
      problems: [],
    },
    "assist:queueDepth": { queued: 0, working: 0 },
    "personalCalendars:mine": {
      link: { calendarId: "aziz@maharamedia.com", status: "ok", events: 3 },
      saEmail: "calendar-reader@mahara.iam.gserviceaccount.com",
      today: [
        {
          eventId: "e1",
          title: "Liwan monthly review",
          start: new Date(now + 2 * H).toISOString(),
          kind: "client",
          clientName: "Liwan Limited",
          meetLink: "https://meet.google.com/x",
          attendees: ["Aziz", "Saleh", "Fatima"],
        },
        {
          eventId: "e2",
          title: "Ads stand-up",
          start: new Date(now + 4 * H).toISOString(),
          kind: "team",
          attendees: ["Aziz", "Saleh"],
        },
      ],
    },
    "stats:portfolioTrend": Array.from({ length: 30 }, (_, i) => {
      const leads = 20 + Math.round(10 * Math.sin(i / 3)) + (i % 4);
      const spend = 380 + Math.round(60 * Math.cos(i / 4));
      return { date: day(29 - i), leads, spend, cpl: spend / leads };
    }),
    "tracking:issues": [
      {
        client: "City Wood",
        count: 3,
        ads: [{ issue: "No UTM string" }, { issue: "No lead form" }],
      },
    ],
    "cockpit:onboardings": [
      {
        taskId: "o1",
        client: "Nour Clinic",
        done: 7,
        total: 19,
        accountId: "998877",
        accountIdSource: "meta",
        taskUrl: "https://app.clickup.com/t/o1",
        groups: [
          {
            name: "Access",
            items: [
              { name: "Ad account shared", done: true },
              { name: "Pixel on the site", done: false },
            ],
          },
          {
            name: "Build",
            items: [
              { name: "Lead form", done: false, viktorCanDo: true },
              { name: "First campaign", done: false, viktorCanDo: true },
            ],
          },
        ],
      },
    ],
    "cockpit:launchWatch": [],
    "stats:coverage": { first: day(400), last: day(1), rows: null },
    "stats:range": {
      hasData: true,
      days: 7,
      bookingsTotal: 4,
      bookingsAttributed: 3,
      total: {
        spend: 401.2,
        leads: 22,
        cpl: 18.24,
        bookings: 4,
        costPerBooking: 100.3,
      },
      adSets: [
        {
          key: "Broad | 25-55 | KW",
          spend: 401.2,
          leads: 22,
          cpl: 18.24,
          bookings: 4,
          costPerBooking: 100.3,
          linkCtr: 1.4,
          cpm: 9.1,
          optInRate: 6.2,
          frequency: 2.9,
          bookingsAttributed: true,
        },
      ],
      ads: [
        {
          key: "Hook 1 | before and after",
          adIds: ["ad-Liwan | Villa fit-out | Leads-1"],
          spend: 310,
          leads: 19,
          cpl: 16.3,
          bookings: 3,
          costPerBooking: 103,
          linkCtr: 1.6,
          cpm: 9.4,
          optInRate: 6.9,
          frequency: 3.1,
          bookingsAttributed: true,
        },
      ],
    },
    "stats:campaignTrend": [],
    "winnerSaves:savedIn": {},
    "market:dimensions": {
      plays: 412,
      clients: 23,
      cities: ["Kuwait City", "Hawalli", "Riyadh", "Dubai"],
      serviceLines: ["Interior design", "Construction", "Real estate"],
    },
    "market:playbook": [
      {
        serviceLine: "Interior design",
        city: "Kuwait City",
        playType: "broad",
        interests: [],
        spend: 2310,
        leads: 240,
        cpl: 9.6,
        verdict: "Proven",
        clients: 3,
      },
      {
        serviceLine: "Interior design",
        city: "Riyadh",
        playType: "interests",
        interests: ["Home decor", "Luxury goods", "Architecture"],
        spend: 1400,
        leads: 64,
        cpl: 21.9,
        verdict: "Worked once",
        clients: 1,
      },
    ],
    "market:creativePatterns": [],
    "portal:members": [
      {
        _id: "u1",
        email: "aziz@maharamedia.com",
        name: "Aziz Waheedi",
        roles: ["admin", "media_buyer", "sales"],
        salesRole: "manager",
        clients: [],
        lastSeenAt: now - 5 * 60_000,
        lastCockpit: "media_buyer",
      },
      {
        _id: "u2",
        email: "saleh@maharamedia.com",
        name: "Saleh",
        roles: ["editor", "creative"],
        clients: ["Liwan Limited", "City Wood"],
        lastSeenAt: now - 3 * H,
        note: "Covers Kuwait accounts",
      },
      {
        _id: "u3",
        email: "fatima@maharamedia.com",
        name: "Fatima",
        roles: ["csm"],
        clients: [],
        lastSeenAt: now - 2 * D,
      },
    ],
    "portal:adminHealth": [
      { app: "media-buyer", ok: true, at: now - 10 * 60_000, failing: [] },
      {
        app: "client-success",
        ok: false,
        at: now - 12 * 60_000,
        failing: ["billing sheet"],
      },
    ],
    "portal:adminSources": [
      {
        source: "meta",
        label: "Meta Marketing API",
        owner: "Aziz",
        fix: "Reconnect the system user token.",
        ok: true,
        streak: 0,
        at: now - 4 * 60_000,
      },
      {
        source: "clickup",
        label: "ClickUp",
        owner: "Aziz",
        fix: "Rotate the API token in Settings.",
        ok: false,
        streak: 4,
        lastError: "401 Unauthorized: token revoked",
        at: now - 30 * 60_000,
      },
    ],
    "portal:adminJobs": [
      {
        job: "sync",
        ok: true,
        at: now - 20 * 60_000,
        ms: 4200,
        streak: 0,
        everyMin: 30,
      },
      {
        job: "billing",
        ok: false,
        at: now - 2 * H,
        ms: 900,
        streak: 3,
        everyMin: 60,
        error: "ClickUp field missing",
      },
    ],
    "portal:adminActivity": {
      lastSync: { at: now - 40 * 60_000, ok: true, problems: [] },
      alerts: [{ text: "ClickUp token failed 3 times.", at: now - H }],
    },
    "portal:adminActions": [
      { at: now - 2 * H, note: "Paused ad Hook 2 on Ocean Home", ok: true },
    ],
    "portal:adminHermes": {
      queued: 1,
      claimed: 0,
      recentDone: [now - H, now - 3 * H],
      lastDone: now - H,
    },
    "portal:adminCounts": {
      campaigns: 41,
      liveCampaigns: 27,
      clients: 23,
      members: 9,
      admins: 2,
    },
    "portal:clientNames": ["Liwan Limited", "City Wood", "Ocean Home"],
  };
}
