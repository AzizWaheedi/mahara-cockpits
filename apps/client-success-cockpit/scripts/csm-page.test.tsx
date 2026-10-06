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
const perfFixture = await Bun.file(
  new URL("./fixtures/csm-profiles.json", import.meta.url),
).json();

let queryResult: unknown;
/** Per-query results, so a screen with two queries gets the right payload in each. */
let queryByName: Record<string, unknown> = {};

/**
 * Actions answer by name too. The onboarding links answer with one row, for an
 * onboarding client in the fixture, so its row shows the forms' line.
 */
const KITS = {
  rows: [
    {
      clickup_task_id: "86exnk0v4",
      client_name: "Greystone Contracting",
      in_onboarding: true,
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
    },
  ],
  last: null,
  lastOk: null,
  now: "2026-10-05T08:00:00.000Z",
};
const actionResults: Record<string, unknown> = {
  "onboarding.kits": KITS,
  "onboarding.refresh": KITS,
  "review.clients": [],
  "review.sent": [],
};

/** Every mutation the screens send, by name, so a test can read what went out. */
const sent: [string, Record<string, unknown>][] = [];
mock.module("convex/react", () => ({
  useQuery: (name: string) =>
    name in queryByName ? queryByName[name] : queryResult,
  useMutation: (name: string) => async (args: Record<string, unknown>) => {
    sent.push([name, args]);
    return null;
  },
  useAction: (name: string) => async () => actionResults[name] ?? null,
}));
/**
 * Function references by name. The csm ones keep the names the tests look up;
 * any other module answers "<module>.<function>", so a new action on these
 * screens does not break the render before it is added here.
 */
const NAMED: Record<string, Record<string, string>> = {
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
};
const byModule = (mod: string) =>
  NAMED[mod] ??
  new Proxy({} as Record<string, string>, {
    get: (_t, fn) => `${mod}.${String(fn)}`,
  });
mock.module("../convex/_generated/api", () => ({
  api: new Proxy({} as Record<string, Record<string, string>>, {
    get: (_t, mod) => byModule(String(mod)),
  }),
}));
mock.module("sonner", () => ({
  toast: { success: () => {}, error: () => {} },
}));

const { CsmPage } = await import("../src/pages/CsmPage");
const { createRoot } = await import("react-dom/client");
const { createElement, act: reactAct } = await import("react");
// The page links to /clients; a Link outside a Router throws, so every render sits in one.
const { MemoryRouter } = await import("react-router");
const { Window } = await import("happy-dom");

const win = new Window({ url: "https://localhost/" });
// biome-ignore lint/suspicious/noExplicitAny: wiring happy-dom into globals for React
const g = globalThis as any;
g.window = win;
g.document = win.document;
g.navigator = win.navigator;
g.HTMLElement = win.HTMLElement;
g.HTMLFormElement = win.HTMLFormElement;
g.MutationObserver = win.MutationObserver;
g.Element = win.Element;
g.Node = win.Node;
// Every element class and the events React and the components check with instanceof.
for (const key of Object.getOwnPropertyNames(win)) {
  if (
    /^(HTML\w*Element|SVG\w*Element|\w*Event|DocumentFragment|Text)$/.test(key)
  )
    g[key] ??= (win as unknown as Record<string, unknown>)[key];
}
g.getComputedStyle ??= win.getComputedStyle.bind(win);
g.IS_REACT_ACT_ENVIRONMENT = true;

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
      queryResult = undefined; // still loading
      queryByName = section === "client" ? { clientProfile: undefined } : {};
      await reactAct(async () => {
        root.render(createElement(MemoryRouter, null, pageFor(section)));
      });
      queryResult = snapshot; // data arrives — the render that used to crash
      queryByName =
        section === "client" ? { clientProfile: perfFixture.profile } : {};
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
      queryByName = {};
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
  queryResult = snapshot;
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
  queryResult = snapshot;
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

/**
 * The client performance screen, both states: the overview grid and one client opened.
 * Rendered from the real stored payload shape so a missing sheet, a client with no ads
 * and a client with a full Meta tree all get exercised.
 */
const { ClientPerformancePage } = await import(
  "../src/pages/ClientPerformancePage"
);

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
    expect(host.innerHTML).toContain(
      perfFixture.overview.clients[0].clientName,
    );

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
    expect(html).toContain("Print report");
    expect(html).toContain("Book a call");
    expect(html).toContain("Client ID · ClickUp client board");
    expect(html).toContain(perfFixture.profile.taskId);
    let copiedId = "";
    const originalWrite = win.navigator.clipboard.writeText;
    win.navigator.clipboard.writeText = async value => {
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
      expect(copyButton!.textContent).toContain("Copied");
    } finally {
      win.navigator.clipboard.writeText = originalWrite;
    }
    expect(html).toContain("What is holding this client back");
    expect(html).toContain("Fix this first");
    expect(html).toContain("Write the Google Doc");
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
  const show = [leak.top, ...leak.rest].find(c => c?.id === "show_rate");
  expect(show?.say?.en).toContain("appointments");
  expect(show?.say?.ar?.length ?? 0).toBeGreaterThan(40);
  expect(show?.evidence).toContain("attended");
  expect(GATES.showRate).toBe(75);

  // No sheet: the only sane first move is to get the sheet linked.
  const blind = diagnose({
    clientName: "No Sheet",
    stage: "Active",
    links: {},
    performance: {},
  });
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
  // biome-ignore lint/suspicious/noExplicitAny: happy-dom element into React DOM
  const root = createRoot(host as any);
  queryResult = snapshot;
  queryByName = { clientProfile: perfFixture.profile };
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
    expect(kickoff?.getAttribute("href")).toBe(
      "https://maharamedia.typeform.com/to/tG7dnxBn#onboarding_client_id=86exnk0v4",
    );
    await reactAct(async () => root2.unmount());
  } finally {
    queryByName = {};
  }
});

/**
 * One client page (2026-10-06): the name, the next step, one "Book a call",
 * the actions, and four tabs, from one address that survives a refresh.
 */
test("a client's page has one booking button, the actions and four tabs", async () => {
  queryByName = { clientProfile: perfFixture.profile };
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
    // Overview: one "Before the call" block, the diagnosis inside it.
    expect(text).toContain("What is holding this client back");
    expect(text).toContain("What the media buyer changed since your last call");
    expect(text).not.toContain("Prep for this call");
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
    queryByName = {};
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
  queryResult = snapshot;
  queryByName = { clientProfile: perfFixture.profile };
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
    queryByName = {};
    await reactAct(async () => root.unmount());
  }
});
