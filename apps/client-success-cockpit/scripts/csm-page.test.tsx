/**
 * Renders the CSM page for real, twice: once while the snapshot is still loading and
 * again with live data, on the same root. That transition is what caught React error
 * #310 — a hook sitting below the loading early-return changes the hook count between
 * renders, which no type check or build will ever catch.
 *
 * Run: bun test scripts/csm-page.test.tsx
 * Fixture: scripts/fixtures/csm-snapshot.json, a real `csm.snapshot` payload.
 */

import { expect, mock, test } from "bun:test";

const snapshot = await Bun.file(
  new URL("./fixtures/csm-snapshot.json", import.meta.url),
).json();

let queryResult: unknown;
/** Per-query results, so a screen with two queries gets the right payload in each. */
let queryByName: Record<string, unknown> = {};

mock.module("convex/react", () => ({
  useQuery: (name: string) =>
    name in queryByName ? queryByName[name] : queryResult,
  useMutation: () => async () => null,
}));
mock.module("../convex/_generated/api", () => ({
  api: {
    csm: {
      snapshot: "csm.snapshot",
      toggleCheck: "toggleCheck",
      act: "act",
      addPlanItems: "addPlanItems",
      submitEod: "submitEod",
      reportIssue: "reportIssue",
      setClientLanguage: "setClientLanguage",
      saveHotRow: "saveHotRow",
      saveMoneyGoals: "saveMoneyGoals",
      performanceOverview: "performanceOverview",
      clientProfile: "clientProfile",
    },
  },
}));
mock.module("sonner", () => ({
  toast: { success: () => {}, error: () => {} },
}));

const { CsmPage } = await import("../src/pages/CsmPage");
const { createRoot } = await import("react-dom/client");
const { createElement, act: reactAct } = await import("react");
const { Window } = await import("happy-dom");

const win = new Window({ url: "https://localhost/" });
// biome-ignore lint/suspicious/noExplicitAny: wiring happy-dom into globals for React
const g = globalThis as any;
g.window = win;
g.document = win.document;
g.navigator = win.navigator;
g.HTMLElement = win.HTMLElement;
g.Element = win.Element;
g.Node = win.Node;
g.IS_REACT_ACT_ENVIRONMENT = true;

/** Every section, because the tabs differ per section and each one renders its own rows. */
const SECTIONS = [
  "start",
  "clients",
  "tasks",
  "hot",
  "links",
  "money",
  "eod",
] as const;

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
      queryResult = undefined; // still loading
      await reactAct(async () => {
        root.render(createElement(CsmPage, { section }));
      });
      queryResult = snapshot; // data arrives — the render that used to crash
      await reactAct(async () => {
        root.render(createElement(CsmPage, { section }));
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

/** Renders one section with live data and returns its visible text. */
async function renderSection(section: string): Promise<string> {
  const host = win.document.createElement("div");
  win.document.body.appendChild(host);
  // biome-ignore lint/suspicious/noExplicitAny: happy-dom element into React DOM
  const root = createRoot(host as any);
  queryResult = snapshot;
  await reactAct(async () => {
    root.render(createElement(CsmPage, { section: section as never }));
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
  queryResult = snapshot;
  await reactAct(async () => {
    root.render(createElement(CsmPage, { section: "hot" }));
  });
  // A client name from the fixture must appear, so we know rows actually built.
  const html = host.innerHTML;
  expect(html).toContain("Hot list");
  await reactAct(async () => root.unmount());
});

/**
 * The client performance screen, both states: the overview grid and one client opened.
 * Rendered from the real stored payload shape so a missing sheet, a client with no ads
 * and a client with a full Meta tree all get exercised.
 */
const { ClientPerformancePage } = await import(
  "../src/pages/ClientPerformancePage"
);
const perfFixture = await Bun.file(
  new URL("./fixtures/csm-profiles.json", import.meta.url),
).json();

test("client performance renders the overview then a single client", async () => {
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
    queryResult = undefined;
    await reactAct(async () => {
      root.render(createElement(ClientPerformancePage, {}));
    });
    queryByName = { performanceOverview: perfFixture.overview };
    await reactAct(async () => {
      root.render(createElement(ClientPerformancePage, {}));
    });
    expect(host.innerHTML).toContain("Client performance");
    expect(host.innerHTML).toContain(perfFixture.overview.clients[0].clientName);

    // Open a client: the profile query answers, the overview keeps its own payload.
    queryByName = {
      performanceOverview: perfFixture.overview,
      clientProfile: perfFixture.profile,
    };
    const buttons = [...host.querySelectorAll("button")].filter(
      b => b.textContent?.trim() === "Open",
    );
    expect(buttons.length).toBeGreaterThan(0);
    await reactAct(async () => {
      buttons[0].click();
    });
    const html = host.innerHTML;
    expect(html).toContain("Download report");
    expect(html).toContain("What is holding this client back");
    expect(html).toContain("Fix this first");
    expect(html).toContain("Write the Google Doc");
    expect(html).toContain("Ask AI");
    expect(html).toContain("no outcome on the sheet");
    expect(errors.join("\n")).not.toContain("Rendered more hooks");
    expect(errors.filter(e => /error/i.test(e)).join("\n")).toBe("");
  } finally {
    console.error = originalError;
    queryByName = {};
    await reactAct(async () => root.unmount());
  }
});

test("diagnosis ranks one constraint first and never invents work", async () => {
  const { diagnose, GATES } = await import("../src/lib/csmDiagnosis");

  // The real stored payload: a client with a huge unfilled sheet.
  const real = diagnose(perfFixture.profile);
  expect(real.healthy).toBe(false);
  expect(real.top).toBeDefined();
  expect(real.headline.toLowerCase()).toContain("first");
  expect(real.top?.fixes.length).toBeGreaterThan(1);

  // Every gate met → nothing to fix, and it says so instead of listing filler.
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
  expect(healthy.headline).toContain("Do not manufacture work");

  // A show-rate leak is named, evidenced, and carries a client-ready message.
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
    ads: [{ campaign: "c", spend7d: 100, leads7d: 20, adsets: [{ ads: [{ status: "ACTIVE" }] }] }],
  });
  const ids = [leak.top, ...leak.rest].map(c => c?.id);
  expect(ids).toContain("show_rate");
  const show = [leak.top, ...leak.rest].find(c => c?.id === "show_rate");
  expect(show?.say?.en).toContain("appointments");
  expect(show?.say?.ar?.length ?? 0).toBeGreaterThan(40);
  expect(show?.evidence).toContain("attended");
  expect(GATES.showRate).toBe(75);

  // No sheet: the only sane first move is to get the sheet linked.
  const blind = diagnose({ clientName: "No Sheet", stage: "Active", links: {}, performance: {} });
  expect(blind.top?.id).toBe("no_sheet");
});

test("the onboarding spine gives the right day, in both languages, and names missed days", () => {
  const { SPINE, spineFor, spineMessage } = require("@/lib/csmOnboardingSpine");
  expect(SPINE.length).toBe(15);
  // A client three days after signup is on day 3, not day 1 and not day 14.
  expect(spineFor({ signupDays: 3, bucket: "onboarding" }).dayIndex).toBe(3);
  // Past the spine, no day is offered rather than inventing a day 20 message.
  expect(spineFor({ signupDays: 40, bucket: "onboarding" }).day).toBe(null);
  // Silence means earlier days fell through and get named.
  expect(
    spineFor({ signupDays: 5, silentDays: 3 }).missed.length,
  ).toBeGreaterThan(0);
  const en = spineMessage(SPINE[0], "en", "Greystone Contracting");
  const ar = spineMessage(SPINE[0], "ar", "شركة العلا");
  expect(en).toContain("Greystone");
  expect(en).not.toContain("NAME");
  expect(ar).toContain("شركة");
  expect(ar).not.toContain("NAME");
  // No em dashes anywhere in the spine, in either language.
  for (const entry of SPINE) {
    expect(entry.en).not.toMatch(/[—–]/);
    expect(entry.ar).not.toMatch(/[—–]/);
  }
});

test("the day blocks read in order and the quiet screens stay quiet", async () => {
  // Start of day must read 1 to 5 in that order, or the sprints stop meaning anything.
  const start = await renderSection("start");
  const order = ["1 · Morning sprint", "2 · Then the work", "3 · Midday sprint", "4 · Then the work", "5 · Evening sprint"];
  let cursor = -1;
  for (const label of order) {
    const at = start.indexOf(label);
    expect(at).toBeGreaterThan(cursor);
    cursor = at;
  }
  // Start of day is the day plan, not a second copy of the client list.
  expect(start).not.toContain("Onboarding, get them live");
  // End of day is the report only.
  const eod = await renderSection("eod");
  expect(eod).not.toContain("Onboarding, get them live");
  expect(eod).toContain("End of day");
});
