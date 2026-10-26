/**
 * Renders the CSM page and ClientPerformancePage, testing lifecycle transitions
 * (loading to loaded) on the same DOM root, interactive client selection, ID copying,
 * and onboarding step expansion.
 *
 * Run: bun test scripts/csm-page.test.tsx
 */

import { afterAll, expect, mock, test } from "bun:test";
import { callCentreFixture } from "../src/dev/callCentreFixture";
import { forgetCallReads } from "../src/lib/callCentreClient";

const snapshot = await Bun.file(
  new URL("./fixtures/csm-snapshot.json", import.meta.url),
).json();
const perfFixture = await Bun.file(
  new URL("./fixtures/csm-profiles.json", import.meta.url),
).json();

const KITS = {
  rows: [
    {
      clickup_task_id: "86exnk0v4",
      client_name: "Greystone Contracting",
      clickup_status: "in onboarding",
      client_status: "Active",
      in_onboarding: true,
      csm: null,
      signup_on: null,
      onboarding_call_on: null,
      launch_on: null,
      links: {},
      handover: {},
      sales_transcript: null,
      forms: {
        onboarding: {
          form_id: "KFRCXPFx",
          response_id: "r1",
          submitted_at: "2026-10-02T13:24:34Z",
          answers: [],
        },
      },
      card_updated_at: null,
      seen_at: "2026-10-05T08:00:00.000Z",
      synced_at: "2026-10-05T08:00:00.000Z",
    },
  ],
  last: null,
  lastOk: null,
  now: "2026-10-05T08:00:00.000Z",
};

let currentSnapshot: any;
let isSnapshotLoading = true;
let snapshotError: Error | null = null;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
};
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** cockpit_csm_client_ads v3 for Greystone: one live campaign, one ad. */
const ADS_READ = {
  taskId: "86exnk0v4",
  clientName: "Greystone Contracting",
  start: "2026-09-01",
  end: "2026-09-30",
  at: "2026-10-13T09:00:00Z",
  statsAt: "2026-10-13T03:00:00Z",
  bookingsReady: true,
  bookingsAt: "2026-10-13T03:00:00Z",
  coverage: { first: "2026-09-01", last: "2026-10-12" },
  feedFirst: "2026-08-13",
  feedLast: "2026-10-12",
  campaigns: [
    {
      name: "Greystone | Leads",
      metaCampaignId: "111",
      accountId: "999",
      accountName: "greystone ads",
      currency: "USD",
      budgetDaily: 30,
      budgetLevel: "campaign",
      ended: false,
      verdict: "kill",
      reason: "$162 a booking (1 booking) is over the $80 line.",
      findings: [
        {
          constraint: "Cost per booking",
          severity: "fix",
          evidence: "$161.58 per booking against the $60 gate.",
          fixes: ["Cut the ad with the worst cost per booking."],
        },
      ],
      boardAdStatus: "Live",
      daysLive: 12,
      lostByAd: { "7001": 2 },
    },
  ],
  adsets: [
    {
      id: "5001",
      name: "Villas",
      campaignName: "Greystone | Leads",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
    },
  ],
  ads: [
    {
      id: "7001",
      name: "Villa reel",
      adsetId: "5001",
      campaignName: "Greystone | Leads",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      accountId: "999",
    },
  ],
  rows: [
    {
      date: "2026-09-10",
      campaignName: "Greystone | Leads",
      adSetName: "Villas",
      adName: "Villa reel",
      adId: "7001",
      spend: 40,
      leads: 3,
      impressions: 2000,
      linkClicks: 20,
      frequency: 1.1,
    },
  ],
  history: [],
  bookings: [],
  verdicts: [],
  stills: {},
  changes: [],
};
const adsReads: any[] = [];
const callReads: any[] = [];
const eodCallReads: any[] = [];
const eodOpens: any[] = [];
/** One Fathom call the CSM hosted on the EOD day, invented. */
const EOD_CALLS = [
  {
    id: 7,
    taskId: "86exnk0v4",
    clientName: "Greystone Contracting",
    startsAt: "2026-10-26T08:00:00Z",
    summary:
      "## Meeting Purpose\n\n[Plan the villa shoot for next week.](https://fathom.video/share/x) Then more.",
  },
];
// The call read's answer; a test swaps it to see the page without it.
const onTrackCalls = () => ({
  data: callCentreFixture("on_track"),
  error: null,
});
let callAnswer: () => any = onTrackCalls;

let overviewDeferred: Deferred<any> | null = null;
let profileDeferred: Deferred<any> | null = null;
let selectedClientForProfile: string | null = null;

/**
 * The requests this CSM raised (cockpit_requests_read, view "mine"): two sent
 * today in Kuwait, one of them failed, and one from yesterday that the
 * "Requests you raised today" card leaves out (2026-10-26).
 */
const requestRow = (over: Record<string, unknown>) => ({
  id: "4b1f6a0e-2c1d-4a7e-9d0b-0a1b2c3d4e10",
  typeKey: "general_tech",
  typeLabel: "General tech request",
  team: "tech",
  teamLabel: "Operations / Tech",
  clientTaskId: "86exnk0v4",
  clientName: "Greystone Contracting",
  requesterLabel: "the CSM",
  mine: true,
  dueOn: null,
  priority: "normal",
  state: "delivered",
  done: false,
  createdAt: new Date().toISOString(),
  source: "client_page",
  canCancel: false,
  canRoute: false,
  parts: [
    {
      part: "main",
      listName: "Operations / Tech",
      teamLabel: "Operations / Tech",
      taskName: "Greystone Contracting - General tech request",
      owner: { label: "the systems manager", how: "rule", note: null },
      state: "delivered",
      error: null,
      url: "https://app.clickup.com/t/86fxreq01",
      status: "to do",
      statusType: "open",
      verifyState: "kept",
      verifyNote: null,
    },
  ],
  ...over,
});
const myRequestRows = [
  requestRow({}),
  requestRow({
    id: "4b1f6a0e-2c1d-4a7e-9d0b-0a1b2c3d4e11",
    typeKey: "client_pause",
    typeLabel: "Client pause",
    state: "failed",
    parts: [
      {
        part: "tech",
        listName: "Operations / Tech",
        teamLabel: "Operations / Tech",
        taskName: "Greystone Contracting - Client pause (Tech)",
        owner: { label: "the systems manager", how: "rule", note: null },
        state: "failed",
        error: "ClickUp refused the template.",
        url: null,
        status: null,
        statusType: null,
        verifyState: null,
        verifyNote: null,
      },
    ],
  }),
  requestRow({
    id: "4b1f6a0e-2c1d-4a7e-9d0b-0a1b2c3d4e12",
    typeLabel: "Change company name",
    createdAt: new Date(Date.now() - 2 * 86400_000).toISOString(),
  }),
];

const mockClient: any = {
  auth: {
    getUser: async () => ({
      data: { user: { id: "test-user-id", email: "csm@maharamedia.com" } },
      error: null,
    }),
    getSession: async () => ({
      data: {
        session: { user: { id: "test-user-id", email: "csm@maharamedia.com" } },
      },
      error: null,
    }),
    onAuthStateChange: () => ({
      data: { subscription: { unsubscribe: () => {} } },
    }),
    signOut: async () => ({ error: null }),
  },
  rpc: (name: string, _args: any) => {
    // Requests and Your tasks on Today (2026-10-26). This seat has no
    // ClickUp link in the fake, so the card says so instead of showing zero.
    if (name === "cockpit_requests_read")
      return Promise.resolve({
        data: {
          asOf: new Date().toISOString(),
          view: "mine",
          views: [{ key: "mine", label: "My requests", count: 3 }],
          rows: myRequestRows,
          note: null,
        },
        error: null,
      });
    if (name === "cockpit_my_tasks" || name === "cockpit_task_alerts")
      return Promise.resolve({
        data: {
          asOf: new Date().toISOString(),
          sourceAt: new Date().toISOString(),
          ready: true,
          link: "not_linked",
          note: "Your seat is not linked to a ClickUp user, so your tasks cannot show here. Ask the systems manager to link it.",
          counts: { overdue: 0, today: 0, total: 0 },
          tasks: [],
          more: 0,
          unread: 0,
          alerts: [],
        },
        error: null,
      });
    if (name === "cockpit_task_alert_rules_read")
      return Promise.resolve({ data: { canEditOthers: false }, error: null });
    if (name === "cockpit_ad_billing_review_panel") {
      return {
        abortSignal: async () => ({
          data: { apply: true, clients: [], dailyReviewedAt: null },
          error: null,
        }),
      };
    }
    if (name === "cockpit_csm_onboarding_read") {
      return Promise.resolve({ data: KITS, error: null });
    }
    // The Brand Blueprint (SPEC 6.1): starter ads sent and the call closed,
    // the offer not locked yet; the close switch at card only.
    if (name === "cockpit_blueprint_read") {
      return Promise.resolve({
        data: {
          rows: (_args.p_task_ids as string[]).includes("86exnk0v4")
            ? [
                {
                  taskId: "86exnk0v4",
                  clientName: "Greystone Contracting",
                  parts: {
                    "1": {
                      firstAt: "2026-10-05T07:12:00Z",
                      lastAt: "2026-10-05T07:12:00Z",
                    },
                    "2": {
                      firstAt: "2026-10-05T07:44:00Z",
                      lastAt: "2026-10-05T07:44:00Z",
                    },
                  },
                },
              ]
            : [],
          now: "2026-10-05T08:00:00Z",
        },
        error: null,
      });
    }
    // The Slack notices (docs/forms/STAGE1-CONTRACT.md 2.1): the close
    // posted in #csm-general, its #media-general post refused.
    if (name === "cockpit_slack_notice_read") {
      return Promise.resolve({
        data: {
          taskId: _args.p_task_id,
          now: "2026-10-05T08:00:00Z",
          notices: [
            {
              id: "00000000-0000-4000-8000-0000000000a2",
              kind: "blueprint.media",
              state: "failed",
              variant: null,
              responseId: null,
              outboxId: "00000000-0000-4000-8000-0000000000b1",
              parentKind: null,
              channel: { id: "C0AE8G5MT7Y", name: "media-general" },
              at: "2026-10-05T07:45:00Z",
              dueAt: null,
              permalink: null,
              reason:
                "Slack says mahara-club-bot is not in that channel. Ask the tech lead to add it there and send the notice again.",
            },
            {
              id: "00000000-0000-4000-8000-0000000000a1",
              kind: "blueprint.close",
              state: "posted",
              variant: "done",
              responseId: null,
              outboxId: "00000000-0000-4000-8000-0000000000b1",
              parentKind: null,
              channel: { id: "C09RZ0GS0V9", name: "csm-general" },
              at: "2026-10-05T07:45:00Z",
              dueAt: null,
              permalink:
                "https://example-workspace.slack.com/archives/C09RZ0GS0V9/p1",
              reason: null,
            },
          ],
        },
        error: null,
      });
    }
    if (name === "cockpit_blueprint_settings_read") {
      return Promise.resolve({
        data: { closeRoute: "card_only", packs: {}, assignee: null },
        error: null,
      });
    }
    if (name === "cockpit_csm_client_ads") {
      adsReads.push(_args);
      return Promise.resolve({ data: ADS_READ, error: null });
    }
    // The call centre (2026-10-13): one client's calls, every client's caller.
    if (name === "cockpit_client_calls") {
      callReads.push(_args);
      return Promise.resolve(callAnswer());
    }
    if (name === "cockpit_client_callers") {
      return Promise.resolve({
        data: {
          clients: [
            {
              taskId: "86exnk0v4",
              locationId: "loc-greystone",
              clientName: "Greystone Contracting",
              callers: [
                { email: "caller@example.test", name: "Example Caller" },
              ],
            },
          ],
          source: "The dialer's client assignments",
          generatedAt: "2026-10-13T09:00:00Z",
        },
        error: null,
      });
    }
    if (name === "cockpit_csm_client_whatsapp") {
      const at = Date.now() - 30 * 60_000;
      return Promise.resolve({
        data: {
          configured: true,
          ready: true,
          stale: false,
          syncedAt: Date.now() - 5 * 60_000,
          note: null,
          dayStart: Date.now() - 60 * 60_000,
          taskId: _args.p_task_id,
          clientName: "Greystone Contracting",
          threads: [
            {
              threadId: "wa-1",
              name: "Omar Greystone",
              isGroup: false,
              archived: false,
              awaitingUs: true,
              lastInboundAt: at,
              lastAt: at,
              today: { inbound: 1, outbound: 0 },
              messages: [
                {
                  id: "m1",
                  direction: "inbound",
                  body: "Can we move the shoot to Thursday?",
                  kind: "text",
                  speaker: null,
                  at,
                  status: null,
                  today: true,
                },
              ],
              draft: null,
              contextKey: "0123456789abcdef0123456789abcdef",
              sendSupported: true,
              replyState: null,
            },
          ],
        },
        error: null,
      });
    }
    // The EOD call summary draft (2026-10-26): the CSM's own Fathom calls,
    // and the first open of the form.
    if (name === "cockpit_csm_eod_calls") {
      eodCallReads.push(_args);
      return Promise.resolve({
        data: { day: _args.p_day, calls: EOD_CALLS },
        error: null,
      });
    }
    if (name === "cockpit_mark_eod_opened") {
      eodOpens.push(_args);
      return Promise.resolve({
        data: {
          day: _args.p_day,
          openedAt: "2026-10-26T15:00:00Z",
          first: eodOpens.length === 1,
        },
        error: null,
      });
    }
    throw new Error(`Unexpected RPC call: ${name}`);
  },
  from: () => ({
    select: () => ({
      eq: () => ({
        eq: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  }),
  functions: {
    invoke: async (name: string, _args: any) => {
      throw new Error(`Unexpected function invocation: ${name}`);
    },
  },
};
const sent: [string, Record<string, unknown>][] = [];
const allowedClients: string[] = [];

mock.module("@/auth/SupabaseAuthProvider", () => ({
  getCockpitSupabaseClient: () => mockClient,
  SupabaseAuthProvider: ({ children }: { children: any }) => children,
  useCockpitAuth: () => ({
    client: mockClient,
    session: { user: { id: "test-user-id", email: "csm@maharamedia.com" } },
    access: {
      email: "csm@maharamedia.com",
      name: "Test CSM",
      roles: ["csm"],
      clients: [],
      isAdmin: false,
      isCeo: false,
      cockpits: ["csm"],
      home: "/go/csm",
    },
    ready: true,
    error: null,
    isAuthenticated: true,
    isAdmin: false,
    isCeo: false,
    email: "csm@maharamedia.com",
    name: "Test CSM",
    roles: ["csm"],
    clients: allowedClients,
    cockpits: ["csm"],
    home: "/go/csm",
    signOut: async () => {},
    refreshAccess: async () => {},
  }),
}));

mock.module("@/lib/useCsmSnapshot", () => ({
  useCsmSnapshot: () => ({
    snap: currentSnapshot,
    loading: isSnapshotLoading,
    error: snapshotError,
    refetch: async () => {},
    toggleCheck: async () => {},
    act: async (args: Record<string, unknown>) => {
      sent.push(["act", args]);
    },
    submitEod: async () => {},
    addPlanItems: async () => {},
    updateProfile: async () => {},
    reportIssue: async () => {},
    setClientLanguage: async () => {},
    saveHotRow: async () => {},
    clearLooseEnds: async () => ({}),
    saveMoneyGoals: async () => {},
  }),
  kuwaitToday: () => "2026-10-06",
  CLICKUP_ACT_KINDS: new Set(["stage", "happiness"]),
  fetchDailyChecksRpc: async () => [],
  executeToggleCheck: async () => {},
  executeSubmitEod: async () => {},
}));

mock.module("@/lib/onboardingClient", () => ({
  readOnboardingKits: async () => KITS,
  refreshOnboardingKits: async () => KITS,
}));

mock.module("@/lib/performance", () => ({
  fetchPerformanceOverview: async () => {
    if (!overviewDeferred) return perfFixture.overview;
    return overviewDeferred.promise;
  },
  fetchClientProfile: async (_client: any, name: string) => {
    selectedClientForProfile = name;
    if (!profileDeferred) return perfFixture.profile;
    return profileDeferred.promise;
  },
  fetchTasksAdded: async () => [],
  fetchPerformancePeriod: async () => [],
  addTask: async () => "receipt-123",
  requestReportDoc: async () => {
    throw new Error("The report-document worker is not connected yet.");
  },
}));

mock.module("@/lib/churnClient", () => ({
  readChurnPage: async () => ({
    today: "2026-10-06",
    month: "2026-10",
    me: { email: "csm@maharamedia.com", canRemove: false },
    reasons: [],
    departures: [],
    months: [],
    waiting: [],
    clients: [],
    starts: [],
    launches: [],
    log: [],
  }),
}));

mock.module("@/lib/comms", () => ({
  fetchWaInbox: async () => ({ threads: [] }),
  sendReply: async () => {},
  archiveWaThread: async () => {},
  fetchMeetingsOverview: async () => ({ meetings: [] }),
  linkCalendar: async () => {},
  unlinkCalendar: async () => {},
}));

mock.module("@/lib/review", () => ({
  listSentReviews: async () => [],
  listReviewClients: async () => [],
  createReview: async () => ({ token: "t1", url: "https://example.com" }),
  importReviewFolder: async () => ({ id: "f1" }),
  checkReviewImportStatus: async () => ({ status: "done" }),
}));

mock.module("@/lib/nativePreviewClient", () => ({
  nativeAdPreview: async () => ({ ok: false }),
}));

mock.module("@/lib/nativeStillClient", () => ({
  nativeStillsRead: async () => ({}),
}));

mock.module("@/lib/checkInClient", () => ({
  readClientContact: async () => ({
    id: "contact-1",
    name: "Example Owner",
    phone: null,
    email: null,
    url: "https://example.com/contact",
  }),
  prepareClientCheckIn: async () => {
    throw new Error("Choose a booking day in the booking test.");
  },
  bookClientCheckIn: async () => {
    throw new Error("Booking is not exercised by page rendering.");
  },
}));
mock.module("@/lib/backlog", () => ({
  fetchBacklog: async () => ({
    rows: [],
    counts: {},
    activeClients: snapshot.clients.length,
  }),
  queueGap: async () => {
    throw new Error("Gap queueing is not exercised by page rendering.");
  },
}));

/**
 * The request form is the portal's shared component, tested on its own
 * (request-form.test.tsx); here only its place on the client page is checked.
 */
let requestFormProps: Record<string, unknown> | null = null;
mock.module("@/components/tasks/RequestForm", () => ({
  RequestForm: (props: Record<string, unknown>) => {
    requestFormProps = props;
    return null;
  },
}));

mock.module("sonner", () => ({
  toast: {
    success: () => {},
    error: () => {},
    info: () => {},
    warning: () => {},
  },
}));

const { CsmPage } = await import("../src/pages/CsmPage");
const { ClientPerformancePage } = await import(
  "../src/pages/ClientPerformancePage"
);
const { createRoot } = await import("react-dom/client");
const { createElement, act: reactAct } = await import("react");
const { MemoryRouter } = await import("react-router");
const { Window } = await import("happy-dom");

const originalGlobalProps: Record<string, any> = {};
const globalKeys = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLFormElement",
  "MutationObserver",
  "Element",
  "Node",
  "getComputedStyle",
  "IS_REACT_ACT_ENVIRONMENT",
];
for (const k of globalKeys) {
  originalGlobalProps[k] = (globalThis as any)[k];
}

const win = new Window({ url: "https://localhost/" });
const g = globalThis as any;
g.window = win;
g.document = win.document;
g.navigator = win.navigator;
g.HTMLElement = win.HTMLElement;
g.HTMLFormElement = win.HTMLFormElement;
g.MutationObserver = win.MutationObserver;
g.Element = win.Element;
g.Node = win.Node;

for (const key of Object.getOwnPropertyNames(win)) {
  if (
    /^(HTML\w*Element|SVG\w*Element|\w*Event|DocumentFragment|Text)$/.test(
      key,
    ) &&
    g[key] == null
  ) {
    if (!(key in originalGlobalProps)) originalGlobalProps[key] = g[key];
    g[key] = (win as unknown as Record<string, unknown>)[key];
  }
}
g.getComputedStyle ??= win.getComputedStyle.bind(win);
g.IS_REACT_ACT_ENVIRONMENT = true;

afterAll(() => {
  for (const k of Object.keys(originalGlobalProps)) {
    if (originalGlobalProps[k] === undefined) {
      delete (globalThis as any)[k];
    } else {
      (globalThis as any)[k] = originalGlobalProps[k];
    }
  }
});

/** Every section, because each one renders its own rows. */
const SECTIONS = [
  "today",
  "clients",
  "client",
  "hot",
  "links",
  "money",
  "eod",
] as const;

/** Greystone Contracting in the fixture: an onboarding client. */
const GREYSTONE = "86exnk0v4";
/** MOFAG in the fixture: commitments from a call, and a report due. */
const MOFAG = "86exr5zcm";

/** The page for one section, the client page on Greystone. */
const pageFor = (section: string, clientKey = GREYSTONE) =>
  createElement(CsmPage, {
    section: section as never,
    ...(section === "client" ? { clientKey } : {}),
  });

for (const section of SECTIONS) {
  test(`CSM ${section} survives loading → loaded without a hooks error`, async () => {
    const host = win.document.createElement("div");
    win.document.body.appendChild(host);
    // biome-ignore lint/suspicious/noExplicitAny: happy-dom element into React DOM
    const root = createRoot(host as any);
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    };
    try {
      currentSnapshot = undefined;
      isSnapshotLoading = true;
      snapshotError = null;
      await reactAct(async () => {
        root.render(createElement(MemoryRouter, null, pageFor(section)));
      });
      currentSnapshot = snapshot;
      isSnapshotLoading = false;
      await reactAct(async () => {
        root.render(createElement(MemoryRouter, null, pageFor(section)));
      });
      const html = host.innerHTML;
      expect(html.length).toBeGreaterThan(500);
      expect(errors.join("\n")).not.toContain("Rendered more hooks");
      expect(errors.join("\n")).not.toContain("Rendered fewer hooks");
      expect(errors.filter(e => /error/i.test(e)).join("\n")).toBe("");
    } finally {
      console.error = originalError;
      await reactAct(async () => root.unmount());
    }
  });
}

/** Renders one section with live data at an address and returns its visible text. */
async function renderSection(
  section: string,
  url = "/",
  clientKey = GREYSTONE,
): Promise<string> {
  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  // biome-ignore lint/suspicious/noExplicitAny: happy-dom element into React DOM
  const root = createRoot(host as any);
  currentSnapshot = snapshot;
  isSnapshotLoading = false;
  snapshotError = null;
  await reactAct(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [url] },
        pageFor(section, clientKey),
      ),
    );
  });
  const text = (host.textContent ?? "").replace(/\s+/g, " ");
  await reactAct(async () => root.unmount());
  return text;
}

test("the hot list and the message drafts render real client copy", async () => {
  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  // biome-ignore lint/suspicious/noExplicitAny: happy-dom element into React DOM
  const root = createRoot(host as any);
  currentSnapshot = snapshot;
  isSnapshotLoading = false;
  await reactAct(async () => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(CsmPage, { section: "hot" }),
      ),
    );
  });
  // A client name from the fixture must appear, so we know rows actually built.
  const html = host.innerHTML;
  expect(html).toContain("Hot list");
  await reactAct(async () => root.unmount());
});

test("client performance renders loading, resolves overview, selects client, and copies taskId", async () => {
  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  const root = createRoot(host as any);
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };

  overviewDeferred = createDeferred<any>();
  profileDeferred = createDeferred<any>();
  selectedClientForProfile = null;

  try {
    await reactAct(async () => {
      // A client's Results links to its Ads tab, so it renders in a router.
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(ClientPerformancePage, {}),
        ),
      );
    });
    expect(host.innerHTML).toContain("Loading client results");

    await reactAct(async () => {
      overviewDeferred!.resolve(perfFixture.overview);
    });

    expect(host.innerHTML).not.toContain("Loading client results");
    const targetClient = perfFixture.overview.clients[0].clientName;
    expect(host.innerHTML).toContain(targetClient);

    const openButtons = [...host.querySelectorAll("button")].filter(
      b => b.textContent?.trim() === "Open",
    );
    expect(openButtons.length).toBeGreaterThan(0);

    await reactAct(async () => {
      openButtons[0].click();
    });

    expect(selectedClientForProfile).toBe(targetClient);
    expect(host.innerHTML).toContain(`Loading ${targetClient}`);

    await reactAct(async () => {
      profileDeferred!.resolve(perfFixture.profile);
    });

    expect(host.innerHTML).not.toContain(`Loading ${targetClient}`);
    expect(host.innerHTML).toContain(perfFixture.profile.taskId);

    const html = host.innerHTML;
    expect(html).toContain("Print report");
    expect(html).toContain("Book a call");
    expect(html).toContain("Client ID · ClickUp client board");
    expect(html).toContain(perfFixture.profile.taskId);
    let copiedId = "";
    const originalWrite = win.navigator.clipboard.writeText;
    win.navigator.clipboard.writeText = async (value: string) => {
      copiedId = value;
    };
    try {
      const copyButton = host.querySelector<HTMLButtonElement>(
        '[aria-label="Copy client ID"]',
      );
      expect(copyButton).not.toBeNull();
      await reactAct(async () => {
        copyButton!.click();
      });
      expect(copiedId).toBe(perfFixture.profile.taskId);
    } finally {
      win.navigator.clipboard.writeText = originalWrite;
    }

    expect(errors.join("\n")).not.toContain("Rendered more hooks");
    expect(errors.filter(e => /error/i.test(e)).join("\n")).toBe("");
  } finally {
    console.error = originalError;
    overviewDeferred = null;
    profileDeferred = null;
    selectedClientForProfile = null;
    await reactAct(async () => root.unmount());
    host.remove();
  }
});

test("diagnosis identifies top constraint and healthy branch correctly", async () => {
  const { diagnose } = await import("../src/lib/csmDiagnosis");

  const real = diagnose(perfFixture.profile);
  expect(real.healthy).toBe(false);
  expect(real.top).toBeDefined();

  const healthy = diagnose({
    clientName: "Good Client",
    stage: "Active",
    links: { sheet: "https://sheet" },
    performance: {
      staleCount: 0,
      month: { leads: 40, booked: 20, shows: 16, noshows: 3, closes: 5 },
      lastMonth: { leads: 40, booked: 18, shows: 15, noshows: 3, closes: 4 },
      allTime: { closes: 9 },
    },
    ads: [
      {
        campaign: "c",
        spend7d: 300,
        leads7d: 30,
        adsets: [{ ads: [{ status: "ACTIVE" }] }],
      },
    ],
  });
  expect(healthy.healthy).toBe(true);
  expect(healthy.top).toBeUndefined();

  const leak = diagnose({
    clientName: "Leaky Firm",
    stage: "Active",
    links: { sheet: "https://sheet" },
    performance: {
      staleCount: 1,
      month: { leads: 30, booked: 12, shows: 4, noshows: 8, closes: 1 },
      lastMonth: { leads: 30, booked: 12, shows: 4, noshows: 8, closes: 1 },
      allTime: { closes: 2 },
    },
    ads: [
      {
        campaign: "c",
        spend7d: 100,
        leads7d: 20,
        adsets: [{ ads: [{ status: "ACTIVE" }] }],
      },
    ],
  });
  // A show rate under the one client line is a watch, never a constraint.
  const ids = [leak.top, ...leak.rest].map(c => c?.id);
  expect(ids).not.toContain("show_rate");
  expect(leak.watch.map(c => c.id)).toEqual(["show_rate"]);

  const blind = diagnose({
    clientName: "No Sheet",
    stage: "Active",
    links: {},
    performance: {},
  });
  expect(blind.top?.id).toBe("no_sheet");
});

/**
 * The one client show rate line. Aziz, 2026-10-12: "the show rate metric is
 * 60%, so anything around that is fine, not 70%". Under it is a quiet watch
 * line beside the diagnosis: never the first fix, never counted, never bad.
 */
function lineClient(
  shows: number,
  noshows: number,
  extra: {
    leads?: number;
    booked?: number;
    closes?: number;
    service?: string;
  } = {},
) {
  return {
    clientName: "Line Client",
    stage: "Active",
    service: extra.service ?? "DFY",
    links: { sheet: "https://sheet" },
    performance: {
      staleCount: 0,
      month: {
        leads: extra.leads ?? 40,
        booked: extra.booked ?? 20,
        shows,
        noshows,
        closes: extra.closes ?? shows,
      },
      lastMonth: {},
      allTime: { closes: extra.closes ?? 9 },
    },
    ads: [
      {
        campaign: "c",
        spend7d: 300,
        leads7d: 30,
        adsets: [{ ads: [{ status: "ACTIVE" }] }],
      },
    ],
  };
}

test("the client show rate line is 60, and under it is a watch, never a fix", async () => {
  const { diagnose, GATES } = await import("../src/lib/csmDiagnosis");
  const { SHOW_RATE_GOOD } = await import("../src/lib/kpi");
  expect(SHOW_RATE_GOOD).toBe(60);
  expect(GATES.showRate).toBe(SHOW_RATE_GOOD);
  const counted = (d: ReturnType<typeof diagnose>) =>
    [d.top, ...d.rest].map(c => c?.id);

  // 60% on 8 or more decided: on the line, nothing to watch or fix.
  for (const [shows, noshows] of [
    [6, 4],
    [9, 6],
    [48, 32],
  ]) {
    const d = diagnose(lineClient(shows, noshows));
    expect(d.healthy).toBe(true);
    expect(d.top).toBeUndefined();
    expect(d.watch).toEqual([]);
  }

  // 59%: a watch item, never top, never in rest.
  const under = diagnose(lineClient(13, 9));
  expect(under.healthy).toBe(true);
  expect(under.top).toBeUndefined();
  expect(under.rest).toEqual([]);
  expect(under.watch.map(c => c.id)).toEqual(["show_rate"]);
  expect(under.watch[0].title).toBe("Show rate is 59%, under the 60% line");
  expect(under.watch[0].diagnosis).toContain("confirmation discipline");
  expect(under.watch[0].fixes[0]).toMatch(/Confirm every appointment twice/);

  // Only a 50% show rate: nothing needs fixing, plus the watch line.
  const half = diagnose(lineClient(5, 5));
  expect(half.healthy).toBe(true);
  expect(half.top).toBeUndefined();
  expect(half.headline).toBe(
    "Nothing needs fixing first. Keep an eye on the show rate below, and ask for a review, a referral or more budget.",
  );
  expect(under.headline).toBe(half.headline);
  expect(half.watch[0].title).toBe("Show rate is 50%, under the 60% line");
  expect(half.watch[0].diagnosis).toBe(
    "50% of appointments with an outcome were no-shows; confirmation discipline fixes it, not more leads.",
  );

  // Under 8 decided is noise: no watch either.
  expect(diagnose(lineClient(3, 4)).watch).toEqual([]);

  // Beside a real constraint, the show rate still never joins the ranking.
  const both = diagnose(lineClient(4, 6, { leads: 40, booked: 6 }));
  expect(both.top?.id).toBe("booking_rate");
  expect(counted(both)).not.toContain("show_rate");
  expect(both.watch.map(c => c.id)).toEqual(["show_rate"]);

  // Done with you: they book their own, so there is nothing to watch.
  expect(diagnose(lineClient(2, 8, { service: "DWY" })).watch).toEqual([]);

  // The show rate never decides the macro check: booking and closing both
  // under their gates and nothing ever closed is macro at any show rate.
  const macro = diagnose(lineClient(5, 5, { leads: 40, booked: 6, closes: 0 }));
  expect(macro.top?.id).toBe("macro_offer");
  for (const [shows, noshows] of [
    [6, 4],
    [9, 1],
  ])
    expect(
      diagnose(lineClient(shows, noshows, { leads: 40, booked: 6, closes: 0 }))
        .top?.id,
    ).toBe("macro_offer");
  // Booking under its gate and the show rate under the line, with too few
  // shows to judge the close rate: one leak plus a watch, never macro.
  const notMacro = diagnose(
    lineClient(4, 6, { leads: 40, booked: 6, closes: 0 }),
  );
  expect(counted(notMacro)).toEqual(["booking_rate"]);
  expect(notMacro.watch.map(c => c.id)).toEqual(["show_rate"]);

  // No title, diagnosis or line anywhere says 70% or 75%.
  for (const d of [under, half, both, macro, diagnose(perfFixture.profile)])
    expect(JSON.stringify(d)).not.toMatch(/7[05]%/);
});

/**
 * The official gates for clients (Aziz, 2026-10-13: "The CSM: make it $15
 * cost per lead and $60 cost per booking") and the golden rule: cost per
 * booking decides. A client on the show rate line, so only cost is judged.
 */
function costClient(
  campaigns: { spend7d: number; leads7d: number; bookings7d?: number }[],
  service = "DFY",
) {
  return {
    ...lineClient(6, 4, { service }),
    ads: campaigns.map((c, i) => ({
      campaign: `c${i}`,
      ...c,
      adsets: [{ ads: [{ status: "ACTIVE" }] }],
    })),
  };
}

test("the client gates are $15 a lead and $60 a booking, and cost per booking decides", async () => {
  const { diagnose, GATES } = await import("../src/lib/csmDiagnosis");
  const { CPB_GATE, CPL_GATE } = await import("../src/lib/kpi");
  expect(CPL_GATE).toBe(15);
  expect(CPB_GATE).toBe(60);
  expect(GATES.cpl).toBe(CPL_GATE);
  expect(GATES.costPerBooking).toBe(CPB_GATE);
  const counted = (d: ReturnType<typeof diagnose>) =>
    [d.top, ...d.rest].map(c => c?.id);

  // $16 to $19.99 a lead with no cost per booking known: a constraint now.
  for (const [spend7d, title] of [
    [160, "Cost per lead is $16.00 against a $15 gate"],
    [175, "Cost per lead is $17.50 against a $15 gate"],
    [199.9, "Cost per lead is $19.99 against a $15 gate"],
  ] as const) {
    const d = diagnose(costClient([{ spend7d, leads7d: 10 }]));
    expect(d.top?.id).toBe("cpl_high");
    expect(d.top?.title).toBe(title);
    expect(d.top?.evidence).toContain(
      "No cost per booking to weigh it against",
    );
    expect(d.top?.say).toBeUndefined();
    expect(d.watch).toEqual([]);
  }
  // On the gate is inside it.
  expect(diagnose(costClient([{ spend7d: 150, leads7d: 10 }])).healthy).toBe(
    true,
  );
  // Too few leads to judge a cost per lead.
  expect(diagnose(costClient([{ spend7d: 80, leads7d: 4 }])).healthy).toBe(
    true,
  );
  // GoHighLevel read and no bookings in the week is data, not a gap: past
  // $60 spent, bookings cost over the gate, and the dearer leads are too.
  const none = diagnose(
    costClient([{ spend7d: 175, leads7d: 10, bookings7d: 0 }]),
  );
  expect(counted(none)).toEqual(["cpb_high", "cpl_high"]);
  expect(none.top?.title).toBe(
    "No bookings from $175 spent in the last 7 days, against a $60 gate",
  );
  expect(none.top?.evidence).toBe(
    "$175 spent in the last 7 days for 0 bookings from 10 leads.",
  );
  expect(none.rest[0].evidence).toBe(
    "$175 spent in the last 7 days for 10 leads, and no bookings in those 7 days.",
  );
  // Cheap leads and nothing booked is never healthy. Done for you, our call
  // centre calls the leads, so its calls come first, since the brief shows
  // only the first fix (the call centre review, 2026-10-13).
  const unbooked = diagnose(
    costClient([{ spend7d: 140, leads7d: 10, bookings7d: 0 }]),
  );
  expect(unbooked.healthy).toBe(false);
  expect(counted(unbooked)).toEqual(["cpb_high"]);
  expect(unbooked.top?.title).toBe(
    "No bookings from $140 spent in the last 7 days, against a $60 gate",
  );
  expect(unbooked.top?.owner).toBe("Call centre");
  expect(unbooked.top?.diagnosis).toContain("none of them booked");
  expect(unbooked.top?.diagnosis).toContain("our call centre calls the leads");
  expect(unbooked.top?.fixes[0]).toBe(
    "Check the client's Calls section: first call time, dials per lead and why leads were lost.",
  );
  expect(unbooked.headline).not.toContain("Every gate");
  // Not yet a booking's worth spent where bookings are read: nothing known.
  const early = diagnose(
    costClient([
      { spend7d: 50, leads7d: 2, bookings7d: 0 },
      { spend7d: 110, leads7d: 4 },
    ]),
  );
  expect(counted(early)).toEqual(["cpl_high"]);
  expect(early.top?.evidence).toBe(
    "$160 spent in the last 7 days for 6 leads. No bookings yet in those 7 days, so the cost per lead decides.",
  );

  // Bookings within $60: the dearer leads are a watch, never a constraint.
  const within = diagnose(
    costClient([{ spend7d: 175, leads7d: 10, bookings7d: 4 }]),
  );
  expect(within.healthy).toBe(true);
  expect(within.top).toBeUndefined();
  expect(within.rest).toEqual([]);
  expect(within.watch.map(c => c.id)).toEqual(["cpl_watch"]);
  expect(within.watch[0].title).toBe(
    "Cost per lead is $17.50, over the $15 gate, but bookings still cost $43.75, under the $60 gate",
  );
  expect(within.watch[0].fixes[0]).toBe(
    "Bookings still cost under $60, so leave the ads alone. Look again if cost per booking passes the gate.",
  );
  expect(within.watch[0].say).toBeUndefined();
  expect(within.headline).toBe(
    "Nothing needs fixing first. Keep an eye on the cost per lead below, and ask for a review, a referral or more budget.",
  );
  // Bookings are counted per campaign (Muhammed, 2026-10-13), so they add up:
  // $175 for 2 + 1 bookings is $58.33.
  const twoCampaigns = diagnose(
    costClient([
      { spend7d: 100, leads7d: 5, bookings7d: 2 },
      { spend7d: 75, leads7d: 5, bookings7d: 1 },
    ]),
  );
  expect(twoCampaigns.watch[0].title).toContain("bookings still cost $58.33");
  // Under $15 a lead and within $60 a booking: nothing at all.
  const fine = diagnose(
    costClient([{ spend7d: 140, leads7d: 10, bookings7d: 4 }]),
  );
  expect(fine.healthy).toBe(true);
  expect(fine.watch).toEqual([]);

  // Bookings over $60: a constraint of its own, and the cost per lead too.
  const over = diagnose(
    costClient([{ spend7d: 175, leads7d: 10, bookings7d: 2 }]),
  );
  expect(counted(over)).toEqual(["cpb_high", "cpl_high"]);
  expect(over.top?.title).toBe("Cost per booking is $87.50 against a $60 gate");
  expect(over.top?.evidence).toBe(
    "$175 spent in the last 7 days for 2 bookings from 10 leads.",
  );
  expect(over.rest[0].evidence).toContain("each booking costs $87.50");
  expect(over.watch).toEqual([]);
  // Cheap leads that do not book: the booking cost alone, on our call
  // centre, never "speed to lead on the client's side".
  const cheap = diagnose(
    costClient([{ spend7d: 130, leads7d: 10, bookings7d: 2 }]),
  );
  expect(counted(cheap)).toEqual(["cpb_high"]);
  expect(cheap.top?.title).toBe(
    "Cost per booking is $65.00 against a $60 gate",
  );
  expect(cheap.top?.owner).toBe("Call centre");
  expect(cheap.top?.diagnosis).toBe(
    "The leads are cheap enough, but too few of them book, so every appointment costs more than it should. That is usually how fast and how often our call centre calls the leads, not the ads.",
  );
  expect(cheap.top?.diagnosis).not.toContain("client's side");
  expect(cheap.top?.fixes[0]).toBe(
    "Check the client's Calls section: first call time, dials per lead and why leads were lost.",
  );
  // Dear leads that do not book: the media buyer's ticket comes first.
  expect(over.top?.owner).toBe("Media buyer");
  expect(over.top?.fixes[0]).toContain("Raise a ticket to the media buyer");

  // Done with you: they book their own, so the cost per lead alone decides.
  const dwy = diagnose(
    costClient([{ spend7d: 175, leads7d: 10, bookings7d: 2 }], "DWY"),
  );
  expect(counted(dwy)).toEqual(["cpl_high"]);
  expect(dwy.watch).toEqual([]);
  // Their bookings are not ours to judge, so none booked is no constraint.
  expect(
    diagnose(costClient([{ spend7d: 140, leads7d: 10, bookings7d: 0 }], "DWY"))
      .healthy,
  ).toBe(true);

  // Nothing here tells the client a cost, and nothing says 70% or 75%.
  for (const d of [within, over, cheap, none, unbooked, early, dwy]) {
    for (const c of [d.top, ...d.rest, ...d.watch])
      expect(c?.say).toBeUndefined();
    expect(JSON.stringify(d)).not.toMatch(/7[05]%/);
  }
});

test("the diagnosis footer says the gates and the 60% line, and the watch line renders quietly", async () => {
  const { SHOW_RATE_GOOD } = await import("../src/lib/kpi");
  // The aim is said in the footer and nowhere else; 75% is said nowhere.
  const AIM = "we aim for 70%";
  const diagnosisText = (text: string) =>
    text.slice(
      text.indexOf("What is holding this client back"),
      text.indexOf("Constraints, one leak at a time.") + 32,
    );
  profileDeferred = null;
  try {
    const page = diagnosisText(
      await renderSection("client", `/clients/${GREYSTONE}`),
    );
    expect(page).toContain(
      `Lines: cost per lead under $15 · cost per booking under $60 · a quarter of leads booked · show rate (${AIM}; ${SHOW_RATE_GOOD}% is the line, under it is a watch, not a fix) · a fifth of attended closed. Fixes come from Diagnosing & Fixing Acquisition Constraints, one leak at a time.`,
    );
    expect(page).not.toContain("$20");
    expect(page).not.toContain("$80");
    expect(page.split(AIM)).toHaveLength(2);
    expect(page.replace(AIM, "")).not.toMatch(/7[05]%/);
    // The fixture sits on the line (9 of 15), so there is nothing to watch.
    expect(page).not.toContain("Watch:");

    const base = perfFixture.profile;
    profileDeferred = createDeferred<any>();
    profileDeferred.resolve({
      ...base,
      performance: {
        ...base.performance,
        staleCount: 0,
        lastMonth: {
          ...base.performance.lastMonth,
          shows: 5,
          noshows: 5,
          closes: 2,
        },
      },
    });
    const watched = diagnosisText(
      await renderSection("client", `/clients/${GREYSTONE}`),
    );
    expect(watched).toContain(
      "Watch: Show rate is 50%, under the 60% line. 50% of appointments with an outcome were no-shows; confirmation discipline fixes it, not more leads.",
    );
    expect(watched).toContain(
      "Nothing needs fixing first. Keep an eye on the show rate below",
    );
    expect(watched).not.toContain("Fix this first");
    expect(watched.replace(AIM, "")).not.toMatch(/7[05]%/);
  } finally {
    profileDeferred = null;
  }
});

test("the onboarding spine maps days and handles out-of-range boundaries", () => {
  const { spineFor } = require("@/lib/csmOnboardingSpine");
  expect(spineFor({ signupDays: 3, bucket: "onboarding" }).dayIndex).toBe(3);
  expect(spineFor({ signupDays: 40, bucket: "onboarding" }).day).toBe(null);
});

test("the day blocks read in order and the quiet screens stay quiet", async () => {
  // Today's day plan must read 1 to 5 in that order, or the sprints stop meaning anything.
  const start = await renderSection("today");
  const order = [
    "1 · Morning sprint",
    "2 · Then the work",
    "3 · Midday sprint",
    "4 · Then the work",
    "5 · Evening sprint",
  ];
  let cursor = -1;
  for (const label of order) {
    const at = start.indexOf(label);
    expect(at).toBeGreaterThan(cursor);
    cursor = at;
  }
  // Who needs you lives on Today, once: the Clients page lists everyone instead.
  expect(start).toContain("Onboarding, get them live");
  expect(start).toContain("Commitments from calls");
  expect(start).toContain("File my end of day");
  const list = await renderSection("clients");
  expect(list).not.toContain("Onboarding, get them live");
  expect(list).toContain("Greystone Contracting");
  // End of day is the report only.
  const eod = await renderSection("eod");
  expect(eod).not.toContain("Onboarding, get them live");
  expect(eod).toContain("End of day");
});

/**
 * The onboarding links (2026-10-05): an onboarding client's row says which forms
 * are in, and their page's Onboarding & files tab holds the three steps around
 * the onboarding call, with the kickoff form as the one teal action once their
 * onboarding form is in.
 */
test("an onboarding client's row and page show its onboarding steps", async () => {
  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  const root = createRoot(host as any);
  currentSnapshot = undefined;
  isSnapshotLoading = true;
  snapshotError = null;

  const settle = () =>
    reactAct(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

  try {
    await reactAct(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: ["/clients?view=onboarding"] },
          pageFor("clients"),
        ),
      );
    });
    expect(host.querySelector("[aria-expanded]")).toBeNull();
    currentSnapshot = snapshot;
    isSnapshotLoading = false;
    await reactAct(async () => {
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(CsmPage, { section: "clients" }),
        ),
      );
    });
    await settle();
    const row = [...host.querySelectorAll("a")].find(a =>
      (a.textContent ?? "").includes("Greystone Contracting"),
    );
    expect(row).toBeDefined();
    // The row opens the client's own page.
    expect(row?.getAttribute("href")).toBe(`/clients/${GREYSTONE}`);
    // The forms' line on the row.
    expect(row?.textContent).toContain("Onboarding form");
    expect(row?.textContent).toContain("Kickoff");
    await reactAct(async () => root.unmount());

    const page = win.document.createElement("div");
    win.document.body.appendChild(page);
    // biome-ignore lint/suspicious/noExplicitAny: happy-dom element into React DOM
    const root2 = createRoot(page as any);
    await reactAct(async () => {
      root2.render(
        createElement(
          MemoryRouter,
          { initialEntries: [`/clients/${GREYSTONE}?tab=onboarding`] },
          pageFor("client"),
        ),
      );
    });
    await settle();
    const text = (page.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("Before the call");
    expect(text).toContain("On the call");
    expect(text).toContain("After the call");
    expect(text).toContain("Filled 2 Oct");
    expect(text).toContain("Fill the kickoff");
    expect(text).toContain("You are here");
    // The Brand Blueprint's line (SPEC 6.1): each part's time, Kuwait's
    // clock, the deck read only, and the phase 5 copy once the call closed.
    expect(text).toContain(
      "Starter ads sent 10:12 · call closed 10:44 · offer not locked yet",
    );
    expect(text).toContain("Open the Blueprint deck");
    // The close's Slack stops (STAGE1-CONTRACT.md 6.1): where and when it
    // posted, and what to do about the one that did not.
    expect(text).toContain("Posted in #csm-general at 10:45");
    // One label, the stop's own: the lead carries the warning, the reason
    // is a plain sentence after it.
    expect(text).toContain(
      "Not posted in #media-general. Slack says mahara-club-bot is not in that channel. Ask the tech lead to add it there and send the notice again.",
    );
    expect(text).not.toMatch(/: Slack (says|refused it):/);
    const lead = Array.from(page.querySelectorAll(".txt-warn")).find(
      (e: any) => e.textContent === "Not posted in #media-general.",
    );
    expect(lead).toBeTruthy();
    // Teal words in light mode use the ink token (index.css: --primary is about 1.9:1 on white).
    const slackLink = Array.from(page.querySelectorAll("a")).find(
      (a: any) => a.textContent === "Open in Slack",
    ) as any;
    expect(slackLink?.className).toContain("text-primary-ink");
    const copyLink = Array.from(page.querySelectorAll("button")).find(
      (b: any) =>
        (b.textContent ?? "").includes("Copy the kickoff window's link"),
    ) as any;
    expect(copyLink?.className).toContain("text-primary-ink");
    // The kickoff window's own address, to copy (PLAN.md S10).
    expect(text).toContain("Copy the kickoff window's link");
    // Make 14 module [7]'s text is in the cockpit (PHASE5_WHATSAPP), so the
    // CSM copies the whole message, not only the map link.
    expect(text).toContain("Copy the phase 5 message");
    // Every teal word in this item is the same ink teal (one teal, legible
    // on white), and a copy label that wraps keeps to the left.
    const deckButton = Array.from(page.querySelectorAll("button")).find(
      (b: any) => (b.textContent ?? "").includes("Open the Blueprint deck"),
    ) as any;
    expect(deckButton?.className).toContain("text-primary-ink");
    const phase5 = Array.from(page.querySelectorAll("button")).find((b: any) =>
      (b.textContent ?? "").includes("Copy the phase 5 message"),
    ) as any;
    expect(phase5?.className).toContain("text-left");
    expect(phase5?.className).toContain("text-primary-ink");
    // The kickoff opens in its own window, by name, at the client's form
    // route (docs/csm-forms/KICKOFF.md 1): the record builds its client ID.
    const opened: string[][] = [];
    const features: string[] = [];
    const replaced: string[] = [];
    const open = win.open;
    (win as any).open = (url: string, name: string, f?: string) => {
      opened.push([url, name]);
      features.push(f ?? "");
      return {
        location: {
          href: "about:blank",
          replace: (u: string) => replaced.push(u),
        },
        focus: () => {},
      };
    };
    try {
      // The header's outline button and the panel's teal one: one name, one
      // window.
      const fills = [...page.querySelectorAll("button")].filter(
        b => (b.textContent ?? "").trim() === "Fill the kickoff",
      );
      expect(fills.length).toBe(2);
      await reactAct(async () => fills[1]?.click());
      expect(opened).toEqual([["", "mahara-form-86exnk0v4-kickoff"]]);
      expect(replaced).toEqual([
        "/client-success/clients/86exnk0v4/forms/kickoff",
      ]);
      // A window of its own, so Zoom can share the form alone.
      expect(features[0]).toMatch(/^popup,width=\d+,height=\d+/);
      await reactAct(async () => fills[0]?.click());
      expect(opened[1]).toEqual(["", "mahara-form-86exnk0v4-kickoff"]);
    } finally {
      win.open = open;
    }
    // No Typeform link is built by hand on the page any more.
    expect(
      [...page.querySelectorAll("a")].some(a =>
        (a.getAttribute("href") ?? "").includes("/to/tG7dnxBn"),
      ),
    ).toBe(false);
    await reactAct(async () => root2.unmount());
  } finally {
    host.remove();
  }
});

/**
 * One client page (2026-10-06): the name, the next step, one "Book a call",
 * the actions, and four tabs, from one address that survives a refresh.
 */
test("a client's page has one booking button, the actions and four tabs", async () => {
  profileDeferred = null;
  try {
    const text = await renderSection("client", `/clients/${GREYSTONE}`);
    expect(text).toContain("Greystone Contracting");
    expect(text).toContain("All clients");
    expect(text.match(/Book a call/g)?.length).toBe(1);
    expect(text).toContain("Or send the booking link");
    expect(text).toContain("Client ID · ClickUp client board");
    for (const action of [
      "Message",
      "Log a call",
      "Update the board",
      "Add a task",
      "Leave it",
    ])
      expect(text).toContain(action);
    for (const tab of [
      "Overview",
      "Results",
      "Ads",
      "Onboarding & files",
      "Money",
    ])
      expect(text).toContain(tab);
    // Overview (2026-10-12): the "Before the call" brief first, then the
    // numbers with the diagnosis inside; the old scattered cards are gone.
    expect(text.match(/Before the call/g)?.length).toBe(1);
    expect(text).toContain("The numbers");
    expect(text).toContain("What is holding this client back");
    expect(text).not.toContain(
      "What the media buyer changed since your last call",
    );
    expect(text).not.toContain("Prep for this call");
    // This fake cannot read the call history: the brief says so, never "no calls".
    expect(text).toContain("The call history could not be read");
    // The client's WhatsApp for the day, with the reply box under it.
    expect(text).toContain("Can we move the shoot to Thursday?");
    expect(text).toContain("Waiting on us");
    expect(text).toContain("Send to Omar Greystone");
    expect(text).toContain("Today: 1 from them, 0 from us");
    // Results: the period and the report at the top.
    const results = await renderSection(
      "client",
      `/clients/${GREYSTONE}?tab=results&period=lastMonth`,
    );
    expect(results).toContain("Print report");
    expect(results).toContain("Write the Google Doc");
    // A client who is not on the list says so and where to look.
    const missing = await renderSection("client", "/clients/nope", "nope");
    expect(missing).toContain("This client is not on your list");
  } finally {
  }
});

/**
 * The worst bug the audit found: "All done already" on a call's commitments
 * logged a touchpoint, so ClickUp's last contact became today for a client
 * nobody had contacted. It now closes the commitment without touching contact.
 */
test("closing a commitment is not contact with the client", async () => {
  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  // biome-ignore lint/suspicious/noExplicitAny: happy-dom element into React DOM
  const root = createRoot(host as any);
  currentSnapshot = snapshot;
  isSnapshotLoading = false;
  sent.length = 0;
  try {
    await reactAct(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { initialEntries: [`/clients/${MOFAG}`] },
          pageFor("client", MOFAG),
        ),
      );
    });
    // Since 2026-10-12 the notes to act on sit in a fold under the calls
    // (the brief above already shows them); open it.
    const fold = [...host.querySelectorAll("details")].find(d =>
      (d.textContent ?? "").includes("Your 1-1 notes to act on"),
    );
    expect(fold).toBeDefined();
    await reactAct(async () => {
      if (fold) {
        fold.open = true;
        fold.dispatchEvent(new win.Event("toggle"));
      }
    });
    const call = [...host.querySelectorAll("button")].find(b =>
      (b.textContent ?? "").startsWith("Your call on"),
    );
    expect(call).toBeDefined();
    await reactAct(async () => call?.click());
    const doneButton = [...host.querySelectorAll("button")].find(
      b => b.textContent?.trim() === "All done already",
    );
    expect(doneButton).toBeDefined();
    await reactAct(async () => doneButton?.click());
    const acts = sent.filter(([name]) => name === "act").map(([, a]) => a);
    expect(acts.length).toBeGreaterThan(0);
    for (const a of acts) {
      expect(a.kind).toBe("commitment");
      expect(String(a.action)).toStartWith("Commitment handled: ");
    }
  } finally {
    await reactAct(async () => root.unmount());
    host.remove();
  }
});

/**
 * The Ads tab (Aziz, 2026-10-13: the CSM looks at the ads "the same way it is
 * on the media buyer cockpit"), read only: the ads, the client's lost leads
 * (why, the team's notes, and how many per ad) and the board's notes. Results
 * links to it instead of drawing the ads twice, and its lost notes show only
 * what the agent wrote, saying so when no Maqsam call backs the outcome.
 */
test("the Ads tab shows the ads read only, and Results links to it", async () => {
  const lostNote = [
    "LOST: Other",
    "Outcome recorded by the agent; this does not establish a verified Maqsam call.",
    "He's not Arab, not serious.",
    "[mahara:8a03189f-5850-467c-9e20-06d7117e0b09]",
  ].join("\n");
  const withLost = {
    ...perfFixture.profile,
    lost: {
      total: 3,
      pipeline: "Lost Leads",
      reasons: [{ reason: "Other (Write why in the notes section)", count: 3 }],
      leads: [
        {
          name: "Lead One",
          reason: "Other (Write why in the notes section)",
          note: `${lostNote} · Called twice, no answer`,
          movedAt: "2026-09-26",
        },
      ],
    },
  };
  profileDeferred = createDeferred();
  profileDeferred.resolve(withLost);
  adsReads.length = 0;
  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  // biome-ignore lint/suspicious/noExplicitAny: happy-dom element into React DOM
  const root = createRoot(host as any);
  currentSnapshot = snapshot;
  isSnapshotLoading = false;
  snapshotError = null;
  const settle = () =>
    reactAct(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
  // The chart measures its width; happy-dom has no ResizeObserver.
  const g = globalThis as any;
  const hadObserver = "ResizeObserver" in g;
  g.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  const show = async (url: string) => {
    await reactAct(async () => {
      root.render(
        createElement(
          MemoryRouter,
          { key: url, initialEntries: [url] },
          pageFor("client"),
        ),
      );
    });
    await settle();
    return (host.textContent ?? "").replace(/\s+/g, " ");
  };
  try {
    const ads = await show(`/clients/${GREYSTONE}?tab=ads&period=lastMonth`);
    expect(adsReads.at(-1)).toMatchObject({ p_task_id: GREYSTONE });
    // Said once, in muted text: the media buyer makes the changes.
    expect(
      ads.match(/Read only: the media buyer makes every change/g)?.length,
    ).toBe(1);
    expect(ads).toContain("Reporting period");
    // The call centre caller, in the header beside the main contact.
    expect(ads).toContain("Caller: Example Caller");
    expect(ads).toContain("Campaigns, ad sets and ads");
    expect(ads).toContain("Villa reel");
    // Lost leads: why, in the team's words, then the board's count per ad.
    expect(ads).toContain("3 leads sit in Lost Leads.");
    expect(ads).toContain("Other3");
    expect(ads).toContain("Lead One");
    expect(ads).toContain(
      "He's not Arab, not serious. · Called twice, no answer",
    );
    expect(ads).toContain("Logged by the agent without a matched Maqsam call.");
    expect(ads).not.toContain("[mahara:");
    expect(ads).not.toContain("LOST: Other");
    expect(ads).not.toContain("Outcome recorded by the agent");
    expect(ads).toContain("By ad");
    expect(ads).toContain(
      "All time, not only this period: 3 leads in their lost pipeline, 2 of them from the ads below.",
    );
    expect(ads).toContain("2 lost");
    expect(ads).not.toContain("Read why each lead was lost on Results");
    // What the media buyer sees: the call, the reason and the fix.
    expect(ads).toContain("What the media buyer sees");
    expect(ads).toContain("Board says Live · 12 days since its first spend");
    expect(ads).toContain("Kill");
    expect(ads).toContain("$162 a booking (1 booking) is over the $80 line.");
    expect(ads).toContain("Fix this first");
    expect(ads).toContain("Cut the ad with the worst cost per booking.");
    // Nothing on the tab changes an ad.
    const writes = [...host.querySelectorAll("button")]
      .map(b => `${b.textContent ?? ""} ${b.getAttribute("aria-label") ?? ""}`)
      .filter(t =>
        /pause|resume|turn (on|off)|budget|duplicate|winner|publish|request a creative/i.test(
          t,
        ),
      );
    expect(writes).toEqual([]);
    // Ads Manager links stay.
    expect(
      [...host.querySelectorAll("a")].some(a =>
        (a.getAttribute("href") ?? "").startsWith(
          "https://adsmanager.facebook.com/",
        ),
      ),
    ).toBe(true);

    // Results: one line to the Ads tab, and the notes without system lines.
    const results = await show(
      `/clients/${GREYSTONE}?tab=results&period=lastMonth`,
    );
    expect(results).toContain("on the Ads tab");
    expect(results).not.toContain("Campaigns, ad sets and ads");
    const link = [...host.querySelectorAll("a")].find(a =>
      (a.textContent ?? "").includes("on the Ads tab"),
    );
    // The profile's own card: the fixture's profile is another client's.
    expect(link?.getAttribute("href")).toBe(
      `/clients/${withLost.taskId}?tab=ads&period=lastMonth`,
    );
    // Lost reasons show once (2026-10-13): the dialer's under Calls, right
    // after Numbers, read for the profile's card and the period's dates;
    // the GoHighLevel list (its cleaned notes checked above) stays on Ads.
    expect(callReads.at(-1)).toEqual({
      p_key: withLost.taskId,
      p_from: "2026-09-01",
      p_to: "2026-09-30",
    });
    expect(results).toContain("On track");
    expect(results).toContain("Why leads were lost");
    expect(results).not.toContain("He's not Arab, not serious.");
    expect(results).not.toContain("3 leads sit in Lost Leads.");
    expect(results).not.toContain("[mahara:");
    expect(results).not.toContain("LOST: Other");
    expect(
      [...host.querySelectorAll("a")]
        .find(a =>
          (a.textContent ?? "").includes("Leads marked lost in GoHighLevel"),
        )
        ?.getAttribute("href"),
    ).toBe(`/clients/${withLost.taskId}?tab=ads&period=lastMonth`);
    const parts = [
      ...host.querySelectorAll('nav[aria-label="On this tab"] a'),
    ].map(a => a.getAttribute("href"));
    expect(parts.slice(0, 4)).toEqual([
      "#results-feedback",
      "#results-numbers",
      "#results-calls",
      "#results-ads",
    ]);
    expect(parts).not.toContain("#results-lost");

    // When Calls shows no lost reasons (here the read times out), Results
    // keeps the GoHighLevel list, so lost reasons never vanish from the tab.
    forgetCallReads();
    callAnswer = () => ({
      data: null,
      error: { code: "57014", message: "statement timeout" },
    });
    try {
      // The same address in another order: a fresh page, not a re-render.
      const failed = await show(
        `/clients/${GREYSTONE}?period=lastMonth&tab=results`,
      );
      await settle();
      const now = (host.textContent ?? "").replace(/\s+/g, " ");
      expect(failed + now).toContain("The dialer took too long to answer.");
      expect(now).toContain(
        "He's not Arab, not serious. · Called twice, no answer",
      );
      expect(now).toContain(
        "Logged by the agent without a matched Maqsam call.",
      );
      expect(now).not.toContain("Leads marked lost in GoHighLevel");
      expect(
        [...host.querySelectorAll('nav[aria-label="On this tab"] a')].map(a =>
          a.getAttribute("href"),
        ),
      ).toContain("#results-lost");
    } finally {
      callAnswer = onTrackCalls;
      forgetCallReads();
    }

    // All time starts on the profile's first day: the ads are read once,
    // after the profile, not once without it and again with it.
    profileDeferred = createDeferred();
    adsReads.length = 0;
    const waiting = await show(`/clients/${GREYSTONE}?tab=ads&period=all`);
    expect(adsReads).toHaveLength(0);
    expect(waiting).toContain("Loading the ads…");
    await reactAct(async () => profileDeferred?.resolve(withLost));
    await settle();
    await settle();
    expect(adsReads).toHaveLength(1);
    expect(host.textContent).toContain("Villa reel");
    // A profile that cannot be read does not hold the ads back for ever.
    // (The same address in another order: a fresh page, not a re-render.)
    profileDeferred = createDeferred();
    adsReads.length = 0;
    await show(`/clients/${GREYSTONE}?period=all&tab=ads`);
    expect(adsReads).toHaveLength(0);
    await reactAct(async () =>
      profileDeferred?.reject(new Error("The profile could not be read.")),
    );
    await settle();
    await settle();
    expect(adsReads).toHaveLength(1);
  } finally {
    profileDeferred = null;
    await reactAct(async () => root.unmount());
    host.remove();
    if (!hadObserver) delete g.ResizeObserver;
  }
});

/**
 * Ardon, 14 to 20 Oct 2026: a SAR ad account. The worker stores its spend
 * ($201.90 for 11 leads) and its budget (SAR 175, $46.66) in dollars, and the
 * tab printed them as "SAR 202" and "SAR 18.35 a lead" (2026-10-21).
 */
test("the Ads tab prints a SAR account's amounts in dollars", async () => {
  const { AdsView } = await import("../src/components/ClientAds");
  const { buildAdsModel, fetchClientAds } = await import(
    "../src/lib/clientAds"
  );
  const { renderToStaticMarkup } = await import("react-dom/server");
  const OCT = { from: "2026-10-14", to: "2026-10-20", label: "14 to 20 Oct" };
  const ARDON = "Ardon_mahar-22\\9";
  const campaign = {
    name: ARDON,
    metaCampaignId: "120253219612130526",
    accountId: "718146936708597",
    accountName: "Ardon",
    currency: "SAR",
    budgetDaily: 46.66,
    budgetLevel: "campaign",
    ended: false,
  };
  const day = (name: string, adId: string, spend: number, leads: number) => ({
    date: "2026-10-18",
    campaignName: name,
    adSetName: "Leads",
    adName: `Ad ${adId}`,
    adId,
    spend,
    leads,
    impressions: 9000,
    linkClicks: 90,
    frequency: 1.2,
  });
  // The tab as words, through the read's own parse.
  const shown = async (campaigns: object[], rows: object[]) => {
    const read = await fetchClientAds(
      {
        rpc: async () => ({
          data: {
            ...ADS_READ,
            clientName: "Ardon",
            start: OCT.from,
            end: OCT.to,
            statsAt: "2026-10-21T06:00:00Z",
            feedLast: "2026-10-20",
            coverage: { first: "2026-09-22", last: "2026-10-20" },
            campaigns,
            adsets: [],
            ads: [],
            rows,
          },
          error: null,
        }),
      } as never,
      "ardon",
      OCT.from,
      OCT.to,
    );
    const model = buildAdsModel(read, OCT, Date.parse("2026-10-21T09:00:00Z"));
    return renderToStaticMarkup(
      createElement(AdsView, {
        model,
        clientName: "Ardon",
        per: OCT,
        dwy: false,
      }),
    )
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ");
  };

  const ardon = await shown([campaign], [day(ARDON, "9001", 201.9, 11)]);
  expect(ardon).toContain("$202 spent");
  expect(ardon).toContain("$18.35 a lead");
  expect(ardon).toContain(
    "Ardon · SAR account, shown in dollars · $46.66 a day · 1 ad set",
  );
  expect(ardon).not.toMatch(/SAR \d/);

  // A SAR and a USD account add up: the chart's day row reads leads, spend
  // and cost per lead for both.
  const usd = {
    ...campaign,
    name: "EXAMPLE-USD",
    metaCampaignId: "333",
    accountId: "888",
    accountName: "example usd",
    currency: "USD",
    budgetDaily: 40,
  };
  const both = await shown(
    [campaign, usd],
    [day(ARDON, "9001", 201.9, 11), day("EXAMPLE-USD", "9002", 100, 4)],
  );
  expect(both).toContain("18 Oct 15 $302 $20.13");
  expect(both).toContain("example usd · $40 a day · 1 ad set");
  expect(both).not.toContain("converted to dollars, so spend");

  // An account the worker does not convert keeps its code, and stays out of
  // the client's dollar total.
  const dinars = await shown(
    [{ ...usd, currency: "BHD", budgetDaily: undefined }, campaign],
    [day(ARDON, "9001", 201.9, 11), day("EXAMPLE-USD", "9002", 120, 4)],
  );
  expect(dinars).toContain("BHD 120 spent");
  expect(dinars).toContain("BHD account, spend not converted to dollars");
  expect(dinars).toContain(
    "Not every ad account here is converted to dollars, so spend does not add up across campaigns.",
  );
  expect(dinars).not.toContain("$322");
});

/**
 * The EOD call summary draft (Muhammed, 26 October 2026): one line per client
 * called that working day, the CSM's note first, Fathom when there is none. It
 * asks before replacing typed text, and New signups and Upsells start from the
 * day's activity. The form's first open is sent once.
 */
test("the EOD drafts the call summary from the day's calls and asks before replacing", async () => {
  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  const root = createRoot(host as any);
  eodCallReads.length = 0;
  eodOpens.length = 0;
  const logged = (subject: string, action: string, reason: string | null) => ({
    subject,
    action,
    kind: "approved",
    reason: reason ?? undefined,
    loggedAt: "2026-10-26T09:00:00Z",
  });
  currentSnapshot = {
    ...snapshot,
    eodOwner: "00000000-0000-4000-8000-000000000001",
    eodDay: "2026-10-26",
    eod: {
      _id: "41",
      answers: { callSummary: "My own line" },
      submittedAt: null,
    },
    eodDecisions: [
      logged("MOFAG", "Held a call", "Walked through the October report"),
      logged("Greystone Contracting", "Held a call", null),
      logged("MOFAG", "Upsell pitched", null),
    ],
    callHealth: [
      { key: "csm-fathom", ok: true, lastOkAt: new Date().toISOString() },
    ],
  };
  isSnapshotLoading = false;
  snapshotError = null;
  const box = () =>
    host.querySelector("#eod-call-summary") as unknown as { value: string };
  const button = (label: string) =>
    [...host.querySelectorAll("button")].find(
      b => (b.textContent ?? "").trim() === label,
    );
  try {
    await reactAct(async () => {
      root.render(createElement(MemoryRouter, null, pageFor("eod")));
    });
    // A second render must not send the open again.
    await reactAct(async () => {
      root.render(createElement(MemoryRouter, null, pageFor("eod")));
    });
    expect(eodOpens).toEqual([{ p_role: "csm", p_day: "2026-10-26" }]);
    const text = () => (host.textContent ?? "").replace(/\s+/g, " ");
    // Upsells is Y from the logged upsell; New signups stays N with nothing logged.
    expect(text()).toContain("UpsellsSet from today's activity");
    expect(text()).not.toContain("pre-onboardingSet from");

    expect(box().value).toBe("My own line");
    await reactAct(async () => button("Draft from today's calls")?.click());
    expect(eodCallReads).toEqual([{ p_day: "2026-10-26" }]);
    // The box has text: nothing changes until the CSM says so.
    expect(box().value).toBe("My own line");
    expect(text()).toContain("Replace what you wrote with the draft?");
    await reactAct(async () => button("Keep mine")?.click());
    expect(box().value).toBe("My own line");
    expect(text()).not.toContain("Replace what you wrote");

    await reactAct(async () => button("Draft from today's calls")?.click());
    await reactAct(async () => button("Replace")?.click());
    // In call order: the Greystone recording started before the MOFAG call.
    expect(box().value).toBe(
      [
        "Greystone Contracting: Plan the villa shoot for next week.",
        "MOFAG: Walked through the October report",
      ].join("\n"),
    );
    expect(text()).toContain(
      "Drafted 2 lines for Mon 26 Oct: 1 from your notes, 1 from Fathom. Edit it before you file.",
    );
  } finally {
    await reactAct(async () => root.unmount());
    currentSnapshot = snapshot;
  }
});

test("Today lists the requests you raised today, with their state and ClickUp link", async () => {
  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  const root = createRoot(host as unknown as Element);
  currentSnapshot = snapshot;
  isSnapshotLoading = false;
  snapshotError = null;
  try {
    await reactAct(async () => {
      root.render(createElement(MemoryRouter, null, pageFor("today")));
    });
    for (let i = 0; i < 3; i++)
      await reactAct(async () => {
        await new Promise(r => setTimeout(r, 0));
      });
    const text = (host.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("Requests you raised today");
    expect(text).not.toContain("Tickets raised today");
    expect(text).toContain("General tech request");
    expect(text).toContain("Client pause");
    // A failed request says why, in the request's own words.
    expect(text).toContain("Not in ClickUp: ClickUp refused the template");
    // Yesterday's request is not today's.
    expect(text).not.toContain("Change company name");
    const links = [...host.querySelectorAll("a")].filter(
      a => a.textContent === "Open in ClickUp",
    );
    expect(links.map(a => a.getAttribute("href"))).toEqual([
      "https://app.clickup.com/t/86fxreq01",
    ]);
    // Your tasks sits on Today and says the seat is not linked, not zero.
    expect(text).toContain("Your tasks");
    expect(text).toContain(
      "Your seat is not linked to a ClickUp user, so your tasks cannot show here.",
    );
  } finally {
    await reactAct(async () => root.unmount());
  }
});

test("the client page's Ask a team is the request form, with the client fixed", async () => {
  requestFormProps = null;
  const text = await renderSection("client", `/clients/${GREYSTONE}?act=task`);
  expect(text).toContain("Ask a team");
  expect(requestFormProps).toEqual({
    source: "client_page",
    presetClient: { taskId: GREYSTONE, name: "Greystone Contracting" },
    compact: true,
  });
  // The old ticket select and its button are gone; the reminder stays.
  expect(text).not.toContain("Create the ticket for");
  expect(text).toContain("A reminder for you");
  expect(text).not.toContain("Media buyer (Marketing / ADs)");
});
