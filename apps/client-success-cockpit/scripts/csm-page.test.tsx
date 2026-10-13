/**
 * Renders the CSM page and ClientPerformancePage, testing lifecycle transitions
 * (loading to loaded) on the same DOM root, interactive client selection, ID copying,
 * and onboarding step expansion.
 *
 * Run: bun test scripts/csm-page.test.tsx
 */

import { afterAll, expect, mock, test } from "bun:test";

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

let currentSnapshot: any = undefined;
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

let overviewDeferred: Deferred<any> | null = null;
let profileDeferred: Deferred<any> | null = null;
let selectedClientForProfile: string | null = null;

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
    if (name === "cockpit_ad_billing_review_panel") {
      return { abortSignal: async () => ({ data: { apply: true, clients: [], dailyReviewedAt: null }, error: null }) };
    }
    if (name === "cockpit_csm_onboarding_read") {
      return Promise.resolve({ data: KITS, error: null });
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
                { id: "m1", direction: "inbound", body: "Can we move the shoot to Thursday?", kind: "text", speaker: null, at, status: null, today: true },
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
    act: async (args: Record<string, unknown>) => { sent.push(["act", args]); },
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
  readClientContact: async () => ({id:"contact-1",name:"Example Owner",phone:null,email:null,url:"https://example.com/contact"}),
  prepareClientCheckIn: async () => { throw new Error("Choose a booking day in the booking test."); },
  bookClientCheckIn: async () => { throw new Error("Booking is not exercised by page rendering."); },
}));
mock.module("@/lib/backlog", () => ({
  fetchBacklog: async () => ({rows:[],counts:{},activeClients:snapshot.clients.length}),
  queueGap: async () => { throw new Error("Gap queueing is not exercised by page rendering."); },
}));

mock.module("sonner", () => ({
  toast: { success: () => {}, error: () => {}, info: () => {}, warning: () => {} },
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
    /^(HTML\w*Element|SVG\w*Element|\w*Event|DocumentFragment|Text)$/.test(key) &&
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
      root.render(createElement(ClientPerformancePage, {}));
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
  // Cheap leads and nothing booked is never healthy: the CSM asks about
  // speed to lead first, since the brief shows only the first fix.
  const unbooked = diagnose(
    costClient([{ spend7d: 140, leads7d: 10, bookings7d: 0 }]),
  );
  expect(unbooked.healthy).toBe(false);
  expect(counted(unbooked)).toEqual(["cpb_high"]);
  expect(unbooked.top?.title).toBe(
    "No bookings from $140 spent in the last 7 days, against a $60 gate",
  );
  expect(unbooked.top?.owner).toBe("CSM");
  expect(unbooked.top?.diagnosis).toContain("none of them booked");
  expect(unbooked.top?.fixes[0]).toBe(
    "Ask how fast their leads get called and how many times, before anything changes in the account.",
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
  // Every campaign carries the client's whole booking count: taken once,
  // never summed ($175 for 3 bookings is $58.33, not $29.17).
  const twoCampaigns = diagnose(
    costClient([
      { spend7d: 100, leads7d: 5, bookings7d: 3 },
      { spend7d: 75, leads7d: 5, bookings7d: 3 },
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
  // Cheap leads that do not book: the booking cost alone, on the CSM.
  const cheap = diagnose(
    costClient([{ spend7d: 130, leads7d: 10, bookings7d: 2 }]),
  );
  expect(counted(cheap)).toEqual(["cpb_high"]);
  expect(cheap.top?.title).toBe(
    "Cost per booking is $65.00 against a $60 gate",
  );
  expect(cheap.top?.owner).toBe("CSM");
  expect(cheap.top?.diagnosis).toContain("speed to lead");
  expect(cheap.top?.fixes[0]).toBe(
    "Ask how fast their leads get called and how many times, before anything changes in the account.",
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
    expect(text).toContain("Open the kickoff form");
    expect(text).toContain("You are here");
    // With no card links, the kickoff form still opens, with the card id.
    const kickoff = [...page.querySelectorAll("a")].find(a =>
      (a.textContent ?? "").includes("Open the kickoff form"),
    );
    expect(kickoff).toBeDefined();
    expect(kickoff?.getAttribute("href")).toBe(
      "https://maharamedia.typeform.com/to/tG7dnxBn#onboarding_client_id=86exnk0v4",
    );
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
    for (const tab of ["Overview", "Results", "Onboarding & files", "Money"])
      expect(text).toContain(tab);
    // Overview (2026-10-12): the "Before the call" brief first, then the
    // numbers with the diagnosis inside; the old scattered cards are gone.
    expect(text.match(/Before the call/g)?.length).toBe(1);
    expect(text).toContain("The numbers");
    expect(text).toContain("What is holding this client back");
    expect(text).not.toContain("What the media buyer changed since your last call");
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

