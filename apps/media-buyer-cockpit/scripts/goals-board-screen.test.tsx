/**
 * The CEO Goals tab's board (src/pages/ceo/GoalsTab.tsx) over the Goals sheet
 * (2026-11-02, truth/SYNTHESIS.md fix 3), rendered in happy-dom with the
 * database's reads and saves answered here from an invented month. The CEO:
 * "make this one the main source of truth so everything else ties into it."
 * What it checks: a board row writes the sheet's own figure (35.9%, where the
 * board used to round to 36%); a missing row's n/a says the sheet's reason
 * and what to do; a day typed on the sheet reaches the board with no second
 * call report read; a failed background re-read keeps the board and says so.
 * Nothing reaches the network: every fetch is refused.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";

// The whole tab, board and sheet, under happy-dom on a shared laptop.
setDefaultTimeout(30000);

const g = globalThis as any;
const ENV = {
  VITE_SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co",
  VITE_SUPABASE_ANON_KEY: "test-placeholder-key",
};
const envs = [process.env, (import.meta as any).env].filter(Boolean);
const envBefore = envs.map(e =>
  Object.fromEntries(Object.keys(ENV).map(k => [k, e[k]])),
);
for (const e of envs) Object.assign(e, ENV);

const realFetch = globalThis.fetch;
const strayFetches: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  strayFetches.push(String(input));
  throw new Error("The Goals board's screen test makes no network calls.");
}) as typeof fetch;

// --- The database, answered here. ---
const { supabase } = await import("../src/lib/supabase");
const db = supabase as any;
const realRpc = db.rpc;
type Answer = { data: unknown; error: { message: string } | null };
const rpcCalls: { name: string; args: any }[] = [];
let rpcAnswer: (name: string, args: any) => Promise<Answer>;
db.rpc = (name: string, args: any) => {
  rpcCalls.push({ name, args });
  return rpcAnswer(name, args);
};

// --- A DOM. ---
const { Window } = await import("happy-dom");
const win = new Window({ url: "https://cockpit.test/ceo" });
const DOM: string[] = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
  "Element",
  "Node",
  "Event",
  "InputEvent",
  "MouseEvent",
  "KeyboardEvent",
  "PointerEvent",
  "FocusEvent",
  "MutationObserver",
  "ResizeObserver",
  "DocumentFragment",
  "Text",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "IS_REACT_ACT_ENVIRONMENT",
  ...Object.getOwnPropertyNames(win).filter(k =>
    /^(HTML|SVG)\w*Element$|^(CustomEvent|DOMRect|NodeFilter|Range)$/.test(k),
  ),
];
const globalsBefore = new Map(
  DOM.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
);
for (const k of DOM)
  Object.defineProperty(globalThis, k, {
    configurable: true,
    writable: true,
    value:
      k === "window"
        ? win
        : k === "IS_REACT_ACT_ENVIRONMENT"
          ? true
          : typeof (win as any)[k] === "function" && /^[a-z]/.test(k)
            ? (win as any)[k].bind(win)
            : (win as any)[k],
  });
const realError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act"))
    return;
  realError(...args);
};

// The cards fade in with framer-motion; happy-dom cancels those animations
// on unmount and reports it, so they are skipped as in ltv-card.test.tsx.
const { MotionGlobalConfig } = await import("framer-motion");
const skipBefore = MotionGlobalConfig.skipAnimations;
MotionGlobalConfig.skipAnimations = true;

const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");
const { GoalsTab } = await import("../src/pages/ceo/GoalsTab");

// --- An invented month: three days measured, the plan on it. ---
// The sheet opens on the month the Kuwait clock is in, worked out as it does.
const month = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 7);
const day = (n: number) => `${month}-${String(n).padStart(2, "0")}`;
const lastDay = (() => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
})();

type Cell = { day: string; key: string; kind: string; value: number };
let stored: Cell[] = [];
let failGoals = false;
/** Rows a test adds to the plan, and metrics it adds on the sheet. */
let moreTargets: Record<string, unknown>[] = [];
let addedMetrics: Record<string, unknown>[] = [];

const target = (key: string, unit: string, value: number, id: number) => ({
  id,
  metric_key: key,
  group_key: "front_end",
  label: key,
  unit,
  direction: "up",
  target: value,
  stretch: null,
  baseline: null,
  note: null,
  sort: id,
  actual_manual: null,
});
const TARGETS = [
  target("leads", "count", 200, 1),
  target("introShowRate", "rate", 0.6, 2),
  target("offersMade", "count", 40, 3),
  { ...target("upsells", "count", 2, 4), group_key: "back_end" },
];
const PLAN = {
  id: 9,
  period_kind: "month",
  period_from: day(1),
  period_to: lastDay,
  title: "Invented plan",
  status: "live",
  working_days: 26,
  mission: null,
  headline: null,
};

function goalsContext() {
  return {
    plan: PLAN,
    plans: [PLAN],
    targets: [...TARGETS, ...moreTargets],
    payloads: {},
    scorecardsDone: null,
    fingerprint: "a".repeat(32),
    today: day(4),
  };
}

/** The sheet's context, from a server older than 20261102m (no wins ledger). */
function sheetContext(m: string) {
  const grow = (n: number, shown: number, due: number) => ({
    date: day(n),
    spend: 100,
    spendRetargeting: 10,
    leads: 5,
    bookedLeads: 2,
    introsBooked: 2,
    introsShown: shown,
    introsDue: due,
    demosBooked: 1,
    demosShown: 1,
    demosDue: 1,
    closes: 0,
    contracted: 0,
    frontEndPaid: 0,
  });
  return {
    today: day(4),
    month: m,
    plan: { id: 9 },
    plans: [
      {
        id: 9,
        periodFrom: day(1),
        periodTo: lastDay,
        title: "Invented plan",
        status: "live",
      },
    ],
    targets: [...TARGETS, ...moreTargets],
    metrics: addedMetrics,
    cells: stored.map(c => ({ ...c, note: null, by: "ceo", at: "x" })),
    // 23 shown of 64 due: 35.9375%.
    growthDaily: [grow(1, 23, 64), grow(2, 0, 0), grow(3, 0, 0)],
    windows: [],
    cashDaily: [],
    book: null,
    refundsMonthly: [],
    bankThrough: null,
    deliveryDaily: [],
    mediaDaily: [],
    clientDaily: [],
    churned: [],
    churnMonths: [],
    softwareMonthly: null,
    lockin: [],
    locked: null,
  };
}

const ZERO = {
  dials: 0,
  providerDials: 0,
  connections: 0,
  talkSeconds: 0,
  leads: 0,
  leadsDialed: 0,
  leadsContacted: 0,
  noVerifiedDial: 0,
  confirmedBookings: 0,
  provisionalBookings: 0,
  unclassifiedBookings: 0,
  shows: 0,
  noShow: 0,
  closed: 0,
  values: [],
  showRate: null,
  closeRate: null,
  connectionRate: null,
  avgSpeedSeconds: null,
  medianSpeedSeconds: null,
  speedSamples: 0,
  withinTwoMinutes: 0,
  withinTwoMinutesRate: null,
  avgCallGapSeconds: null,
  callGapSamples: 0,
};

function report(from: string, to: string) {
  return {
    version: 1,
    generatedAt: `${day(4)}T03:00:00Z`,
    timezone: "Asia/Kuwait",
    from,
    to,
    overall: { ...ZERO, leads: 10, confirmedBookings: 2 },
    callers: [],
    clients: [
      {
        ...ZERO,
        id: "a",
        name: "Made-up Clinic",
        leads: 10,
        confirmedBookings: 2,
      },
    ],
    daily: [{ ...ZERO, day: day(1), leads: 10, confirmedBookings: 2 }].filter(
      d => d.day >= from && d.day <= to,
    ),
    coverage: {},
    warnings: [],
  };
}

function answer() {
  rpcAnswer = async (name, args) => {
    if (name === "cockpit_ceo_goals_context")
      return failGoals
        ? { data: null, error: { message: "The goals read timed out" } }
        : { data: goalsContext(), error: null };
    if (name === "cockpit_ceo_goal_sheet_context")
      return { data: sheetContext(args.p_month), error: null };
    if (name === "cockpit_ceo_call_center_report")
      return { data: report(args.p_from, args.p_to), error: null };
    if (name === "cockpit_ceo_goal_sheet_save_cells") {
      const cells = args.p_cells as Cell[];
      for (const c of cells) {
        stored = stored.filter(
          x => !(x.day === c.day && x.key === c.key && x.kind === c.kind),
        );
        if (c.value !== null) stored.push({ ...c });
      }
      return { data: { saved: cells.length }, error: null };
    }
    return { data: null, error: { message: `No answer for ${name}` } };
  };
}

const host = win.document.createElement("div");
win.document.body.append(host);
const root = createRoot(host as any);

async function flush(times = 8) {
  for (let i = 0; i < times; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
}

/** Past the board's coalescing wait, then the reads it starts. */
async function settle() {
  await act(async () => {
    await new Promise(r => setTimeout(r, 450));
  });
  await flush();
}

const text = () => (host.textContent ?? "").replace(/\s+/g, " ");
const reportReads = () =>
  rpcCalls.filter(c => c.name === "cockpit_ceo_call_center_report").length;
const goalsReads = () =>
  rpcCalls.filter(c => c.name === "cockpit_ceo_goals_context").length;
const cell = (col: string, d: number) =>
  host.querySelector(`td[data-col="${col}"][data-day="${day(d)}"]`) as any;
const active = () => win.document.activeElement as any;

async function click(el: any) {
  if (!el) throw new Error("Nothing to click");
  await act(async () => {
    el.click();
  });
  await flush(2);
}

/** One key, as a browser sends it, typed into the focused box when printable. */
async function press(key: string) {
  await act(async () => {
    const target = active() ?? win.document.body;
    const e = new win.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(e);
    const box = active();
    if (key.length === 1 && !e.defaultPrevented && box?.tagName === "INPUT") {
      const from = box.selectionStart ?? box.value.length;
      const to = box.selectionEnd ?? from;
      const next = box.value.slice(0, from) + key + box.value.slice(to);
      Object.getOwnPropertyDescriptor(
        win.HTMLInputElement.prototype,
        "value",
      )?.set?.call(box, next);
      box.setSelectionRange(from + 1, from + 1);
      box.dispatchEvent(new win.Event("input", { bubbles: true }));
    }
  });
  await flush(2);
}

let mounts = 0;
async function show() {
  mounts += 1;
  await act(async () => {
    root.render(
      createElement(GoalsTab, {
        key: mounts,
        sections: {} as never,
        now: Date.now(),
        day: day(4),
        goTab: () => undefined,
      }),
    );
  });
  await flush();
}

beforeEach(() => {
  rpcCalls.length = 0;
  stored = [];
  failGoals = false;
  moreTargets = [];
  addedMetrics = [];
  win.localStorage.clear();
  answer();
});

afterEach(async () => {
  await act(async () => root.render(null));
  await flush(2);
});

afterAll(async () => {
  await act(async () => root.unmount());
  MotionGlobalConfig.skipAnimations = skipBefore;
  globalThis.fetch = realFetch;
  console.error = realError;
  db.rpc = realRpc;
  for (const [k, d] of globalsBefore)
    if (d) Object.defineProperty(globalThis, k, d);
    else delete g[k];
  envs.forEach((e, i) => {
    for (const [k, v] of Object.entries(envBefore[i]))
      if (v === undefined) delete e[k];
      else e[k] = v;
  });
  await win.happyDOM.close();
  expect(strayFetches).toEqual([]);
});

describe("the board reads the sheet", () => {
  test("a row writes the sheet's own figure, and a missing one the sheet's reason", async () => {
    await show();
    // 23 of 64 is 35.9% on the sheet; the board used to round it to 36%.
    expect(text()).toContain("Intro show rate35.9% of 60%");
    expect(text()).not.toContain("Intro show rate36%");
    const reasons = [
      ...host.querySelectorAll('button[aria-label^="n/a:"]'),
    ].map(b => (b as any).getAttribute("aria-label"));
    // Upsells on a server older than the wins ledger: typed days only.
    expect(reasons).toContain(
      "n/a: Missing on the sheet: nothing recorded it on these days yet. Type the days on the sheet above.",
    );
    expect(reasons.some(r => r.includes("Nothing recorded for this yet"))).toBe(
      false,
    );
  });

  test("a metric added on the sheet and an older key are named and written as the sheet has them", async () => {
    addedMetrics = [
      {
        key: "creply_rate",
        label: "Reply rate",
        section: "custom",
        unit: "rate",
        direction: "up",
        rollup: "avg",
        note: null,
      },
    ];
    stored = [
      { day: day(1), key: "creply_rate", kind: "actual", value: 0.3594 },
    ];
    moreTargets = [
      {
        ...target("creply_rate", "rate", 0.4, 5),
        group_key: "team",
        label: "Reply rate",
      },
      // The October plan's older key for the call centre's lead to booking.
      {
        ...target("clientLeadToBooking", "rate", 0.3, 6),
        group_key: "delivery",
        label: "Client lead to booking",
      },
    ];
    await show();
    // 35.94% as the sheet writes it, not the 36% the board used to write.
    expect(text()).toContain("Reply rate35.9% of 40%");
    expect(text()).not.toContain("Reply rate36%");
    // The call report's 2 of 10, named as the sheet names it.
    expect(text()).toContain("Lead to booking20% of 30%");
    expect(text()).not.toContain("Client lead to booking");
    const reasons = [
      ...host.querySelectorAll('button[aria-label^="n/a:"]'),
    ].map(b => (b as any).getAttribute("aria-label"));
    expect(reasons.some(r => r.includes("Nothing recorded for this yet"))).toBe(
      false,
    );
  });

  test("a day typed on the sheet reaches the board, with no second call report", async () => {
    await show();
    const reports = reportReads();
    const goals = goalsReads();
    expect(reports).toBeGreaterThan(0);
    await click(cell("offersMade", 1));
    await press("3");
    await press("Enter");
    await settle();
    expect(stored).toEqual([
      { day: day(1), key: "offersMade", kind: "actual", value: 3 },
    ]);
    expect(text()).toContain("Offers made3 of 40");
    // One quiet re-read of the board, and no call report read again.
    expect(goalsReads()).toBe(goals + 1);
    expect(reportReads()).toBe(reports);
  });

  test("a background re-read that fails keeps the board and says so", async () => {
    await show();
    failGoals = true;
    await click(cell("offersMade", 2));
    await press("4");
    await press("Enter");
    await settle();
    expect(text()).toContain("Intro show rate35.9% of 60%");
    expect(text()).toContain(
      "Not refreshed after the last change: The goals read timed out. These are the numbers from the read before; reload the page to try again.",
    );
    expect(text()).not.toContain("The plan could not be read");
  });
});

describe("Edit this plan (2026-11-02)", () => {
  test("the instalments owed on signed deals are changed on the sheet, not alone here", async () => {
    moreTargets = [
      {
        ...target("onDealDue", "usd", 8000, 7),
        group_key: "back_end",
        label: "Instalments owed on signed deals",
      },
    ];
    await show();
    const edit = [...host.querySelectorAll("button")].find(
      b => (b as any).textContent?.trim() === "Edit this plan",
    );
    await click(edit);
    const box = (name: string) =>
      host.querySelector(`input[aria-label="${name}"]`) as any;
    const own = box("Instalments owed on signed deals target");
    expect(own).toBeTruthy();
    expect(own.disabled).toBe(true);
    expect(box("Instalments owed on signed deals stretch").disabled).toBe(true);
    const off = host.querySelector(
      'button[aria-label="Take Instalments owed on signed deals off the plan"]',
    ) as any;
    expect(off.disabled).toBe(true);
    expect(text()).toContain(
      "Change it on the monthly sheet's instalments line, so Cash collected and the spend follow.",
    );
    // Any other row stays editable in place.
    expect(box("leads target").disabled).toBe(false);
  });
});
