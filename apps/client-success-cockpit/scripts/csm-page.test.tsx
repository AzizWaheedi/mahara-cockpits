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
  rpc: async (name: string, _args: any) => {
    if (name === "cockpit_csm_onboarding_read") {
      return { data: KITS, error: null };
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
    clients: [],
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
    act: async () => {},
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
    expect(host.innerHTML).toContain("Loading client performance");

    await reactAct(async () => {
      overviewDeferred!.resolve(perfFixture.overview);
    });

    expect(host.innerHTML).not.toContain("Loading client performance");
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
  const ids = [leak.top, ...leak.rest].map(c => c?.id);
  expect(ids).toContain("show_rate");

  const blind = diagnose({
    clientName: "No Sheet",
    stage: "Active",
    links: {},
    performance: {},
  });
  expect(blind.top?.id).toBe("no_sheet");
});

test("the onboarding spine maps days and handles out-of-range boundaries", () => {
  const { spineFor } = require("@/lib/csmOnboardingSpine");
  expect(spineFor({ signupDays: 3, bucket: "onboarding" }).dayIndex).toBe(3);
  expect(spineFor({ signupDays: 40, bucket: "onboarding" }).day).toBe(null);
});

test("an onboarding client loads, expands and opens its client-bound kickoff link", async () => {
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
          null,
          createElement(CsmPage, { section: "clients" }),
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

    const buttons = () =>
      [...host.querySelectorAll("button")] as unknown as HTMLButtonElement[];
    const tab = buttons().find(b =>
      (b.textContent ?? "").includes("Client onboarding"),
    );
    expect(tab).toBeDefined();
    await reactAct(async () => tab?.click());
    await settle();

    const row = buttons().find(
      b =>
        b.getAttribute("aria-expanded") !== null &&
        (b.textContent ?? "").includes("Greystone Contracting"),
    );
    expect(row).toBeDefined();
    expect(row?.getAttribute("aria-expanded")).toBe("false");

    await reactAct(async () => row?.click());
    await settle();
    expect(row?.getAttribute("aria-expanded")).toBe("true");

    const links = [...host.querySelectorAll("a")];
    const kickoff = links.find(a =>
      a.getAttribute("href")?.includes("onboarding_client_id=86exnk0v4"),
    );
    expect(kickoff).toBeDefined();
    expect(kickoff?.getAttribute("href")).toBe(
      "https://maharamedia.typeform.com/to/tG7dnxBn#onboarding_client_id=86exnk0v4",
    );
  } finally {
    await reactAct(async () => root.unmount());
    host.remove();
  }
});

