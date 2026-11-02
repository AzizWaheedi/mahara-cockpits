/**
 * The CEO Goals sheet screen (src/pages/ceo/goalsSheet.tsx and the phone view
 * in goalsSheetPhone.tsx) rendered in happy-dom with real key events, the
 * database's reads and saves answered here from an invented month
 * (2026-11-02). What it checks: Aziz's "when I click it, sometimes the way I
 * input numbers, it's glitchy". Typing 1, 5, 0 then Enter saves 150 once;
 * Escape saves nothing; Tab saves once and moves right; Delete clears a
 * typed cell and leaves a measured one; the new number shows before the save
 * comes back; a failed save puts the old number back with Try again; focus
 * stays on the grid; the read after a save does not ask for the call centre
 * report again. Also the Total new cash mirror's target, and the phone view's
 * day, counts and one-tap typing on the same save path.
 *
 * Chrome fires blur on an input as it is removed, which is how Escape used to
 * save and Enter used to save twice: removeChild below does the same here.
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

// The whole grid under happy-dom: the longest test here takes about 6s on a
// shared laptop, past bun's 5s default (seen 2026-11-02).
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
  throw new Error("The Goals sheet's screen test makes no network calls.");
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

// Chrome's blur on removal: the focused input loses focus as React removes it.
const NodeProto = (win as any).Node.prototype;
const realRemoveChild = NodeProto.removeChild;
NodeProto.removeChild = function (this: any, child: any) {
  const active = win.document.activeElement as any;
  if (
    active &&
    active.tagName === "INPUT" &&
    (child === active || child.contains?.(active))
  ) {
    active.dispatchEvent(new win.FocusEvent("focusout", { bubbles: true }));
    active.dispatchEvent(new win.FocusEvent("blur"));
  }
  return realRemoveChild.call(this, child);
};

// The cards fade in with framer-motion; happy-dom cancels those animations
// on unmount and reports it, so they are skipped as in ltv-card.test.tsx.
const { MotionGlobalConfig } = await import("framer-motion");
const skipBefore = MotionGlobalConfig.skipAnimations;
MotionGlobalConfig.skipAnimations = true;

const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");
const { GoalsSheet } = await import("../src/pages/ceo/goalsSheet");
const { NextMonth } = await import("../src/pages/ceo/goalsNext");

// --- An invented month: three days measured, one count typed. ---
type Cell = { day: string; key: string; kind: string; value: number };
let stored: Cell[] = [];
/** Targets saved from the sheet, read back by the next context read. */
let storedTargets: { metricKey: string; target: number | null }[] = [];
/** "manual": each save waits in `pending` until the test says how it ends. */
let saveMode: "ok" | "hold" | "fail" | "manual" = "ok";
let held: (() => void) | null = null;
const pending: { ok: () => void; fail: () => void }[] = [];
const saves: any[][] = [];
const targetSaves: any[][] = [];
/** Months whose context read fails, as a timed-out read would. */
const failingMonths = new Set<string>();
/** Lock-in lines the next context read carries (2026-11-02). */
let lockinRows: Record<string, unknown>[] = [];
/** The Money tab's book the next context read carries (round 3, 2026-11-02). */
let bookNow: Record<string, unknown> | null = null;

function context(month: string) {
  const day = (n: number) => `${month}-${String(n).padStart(2, "0")}`;
  const measured = (n: number, leads: number, paid: number) => ({
    date: day(n),
    spend: 100,
    spendRetargeting: 10,
    leads,
    bookedLeads: 2,
    introsBooked: 2,
    introsShown: 1,
    introsDue: 2,
    demosBooked: 1,
    demosShown: 1,
    demosDue: 1,
    closes: 0,
    contracted: 0,
    frontEndPaid: paid,
  });
  const target = (key: string, group: string, value: number, id: number) => ({
    id,
    metric_key: key,
    group_key: group,
    label: key,
    target: value,
    note: null,
  });
  return {
    today: day(4),
    month,
    plan: { id: 7 },
    plans: [
      {
        id: 7,
        periodFrom: day(1),
        periodTo: day(28),
        title: "The plan",
        status: "live",
      },
    ],
    targets: [
      target("offersMade", "front_end", 40, 1),
      target("leads", "front_end", 200, 2),
      target("newCash", "front_end", 30000, 3),
      target("closes", "front_end", 8, 4),
      ...storedTargets.map((t, i) =>
        target(t.metricKey, "back_end", t.target as number, 100 + i),
      ),
    ],
    metrics: [],
    cells: stored.map(c => ({ ...c, note: null, by: "ceo", at: "x" })),
    growthDaily: [measured(1, 5, 1000), measured(2, 6, 0), measured(3, 7, 500)],
    windows: [],
    cashDaily: [],
    book: bookNow && { ...bookNow, month },
    refundsMonthly: [],
    bankThrough: null,
    deliveryDaily: [],
    mediaDaily: [],
    clientDaily: [],
    churned: [],
    churnMonths: [],
    softwareMonthly: null,
    lockin: lockinRows,
    locked: null,
  };
}

/** How a save ends: at once, held for the test, failed, or as the test says. */
function settleSave(cells: unknown[], apply: () => void): Promise<Answer> {
  const done = () => {
    apply();
    return { data: { saved: cells.length }, error: null };
  };
  if (saveMode === "fail")
    return Promise.resolve({
      data: null,
      error: { message: "The database is busy" },
    });
  if (saveMode === "hold")
    return new Promise<Answer>(resolve => {
      held = () => resolve(done());
    });
  if (saveMode === "manual")
    return new Promise<Answer>(resolve => {
      pending.push({
        ok: () => resolve(done()),
        fail: () =>
          resolve({ data: null, error: { message: "The connection dropped" } }),
      });
    });
  return Promise.resolve(done());
}

function answer() {
  rpcAnswer = async (name, args) => {
    if (name === "cockpit_ceo_goal_sheet_context")
      return failingMonths.has(args.p_month)
        ? { data: null, error: { message: "The sheet read timed out" } }
        : { data: context(args.p_month), error: null };
    if (name === "cockpit_ceo_goal_save_targets") {
      const rows = args.p_targets as any[];
      targetSaves.push(rows);
      return settleSave(rows, () => {
        for (const r of rows) {
          storedTargets = storedTargets.filter(
            t => t.metricKey !== r.metricKey,
          );
          if (r.target !== null)
            storedTargets.push({ metricKey: r.metricKey, target: r.target });
        }
      });
    }
    if (name === "cockpit_ceo_call_center_report")
      return { data: null, error: { message: "The report timed out" } };
    if (name === "cockpit_ceo_goal_save_plan")
      return { data: { id: 99 }, error: null };
    if (name === "cockpit_ceo_goal_sheet_add_metric")
      return { data: { key: "cmade_up" }, error: null };
    if (name === "cockpit_ceo_goal_sheet_save_cells") {
      const cells = args.p_cells as any[];
      saves.push(cells);
      return settleSave(cells, () => {
        for (const c of cells) {
          stored = stored.filter(
            x => !(x.day === c.day && x.key === c.key && x.kind === c.kind),
          );
          if (c.value !== null) stored.push({ ...c });
        }
      });
    }
    return { data: null, error: { message: `No answer for ${name}` } };
  };
}

const host = win.document.createElement("div");
win.document.body.append(host);
const root = createRoot(host as any);
let mounts = 0;
// The sheet opens on the month the Kuwait clock is in, worked out as it does.
const month = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 7);

async function flush(times = 6) {
  for (let i = 0; i < times; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
}

async function show() {
  mounts += 1;
  await act(async () => {
    root.render(createElement(GoalsSheet, { key: mounts }));
  });
  await flush();
  expect(rpcCalls[0]?.args?.p_month).toBe(month);
}

const day = (n: number) => `${month}-${String(n).padStart(2, "0")}`;
const shiftMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
};
const monthLong = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleString("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const grid = () => host.querySelector('[role="grid"]') as any;
const cell = (col: string, d: number) =>
  host.querySelector(`td[data-col="${col}"][data-day="${day(d)}"]`) as any;
const rowCell = (col: string, row: string) =>
  host.querySelector(`td[data-col="${col}"][data-row="${row}"]`) as any;
const text = (el: any) => (el?.textContent ?? "").trim();
const picked = () => {
  const td = host.querySelector("td[data-selected]") as any;
  return td ? `${td.dataset.col}@${td.dataset.day ?? td.dataset.row}` : null;
};
const active = () => win.document.activeElement as any;
const editor = () => host.querySelector("td input") as any;
const reportReads = () =>
  rpcCalls.filter(c => c.name === "cockpit_ceo_call_center_report").length;

async function click(el: any) {
  if (!el) throw new Error("Nothing to click");
  await act(async () => {
    el.click();
  });
  await flush(2);
}

async function dblclick(el: any) {
  await act(async () => {
    el.dispatchEvent(new win.MouseEvent("dblclick", { bubbles: true }));
  });
  await flush(2);
}

/**
 * One key, as a browser sends it: keydown on whatever has focus, and a
 * printable key the page did not stop goes into the focused box at its
 * caret, replacing what is selected.
 */
async function press(key: string, opts: { shiftKey?: boolean } = {}) {
  await act(async () => {
    const target = active() ?? win.document.body;
    const e = new win.KeyboardEvent("keydown", {
      key,
      bubbles: true,
      cancelable: true,
      shiftKey: Boolean(opts.shiftKey),
    });
    target.dispatchEvent(e);
    const box = active();
    if (key.length === 1 && !e.defaultPrevented && box?.tagName === "INPUT") {
      const from = box.selectionStart ?? box.value.length;
      const to = box.selectionEnd ?? from;
      const next = box.value.slice(0, from) + key + box.value.slice(to);
      const setter = Object.getOwnPropertyDescriptor(
        win.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(box, next);
      box.setSelectionRange(from + 1, from + 1);
      box.dispatchEvent(new win.Event("input", { bubbles: true }));
    }
  });
  await flush(2);
}

async function keys(...ks: string[]) {
  for (const k of ks) await press(k);
}

beforeEach(() => {
  rpcCalls.length = 0;
  saves.length = 0;
  targetSaves.length = 0;
  pending.length = 0;
  failingMonths.clear();
  lockinRows = [];
  saveMode = "ok";
  held = null;
  win.localStorage.clear();
  answer();
});

afterEach(async () => {
  await act(async () => root.render(null));
  await flush(2);
  stored = [];
  storedTargets = [];
  bookNow = null;
});

afterAll(async () => {
  await act(async () => root.unmount());
  NodeProto.removeChild = realRemoveChild;
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

// ---------------------------------------------------------------------------
// Here bun's toBeNull passes on a happy-dom element (seen 2026-11-02), so
// "nothing there" is checked as `=== null` and toBe(true).

describe("typing on the grid", () => {
  test("1, 5, 0 then Enter saves 150 once, moves down and keeps the grid", async () => {
    await show();
    await click(cell("offersMade", 2));
    expect(picked()).toBe(`offersMade@${day(2)}`);
    expect(active()).toBe(grid());
    await keys("1", "5", "0");
    // The caret followed the typing: each digit added, none replaced.
    expect(editor()?.value).toBe("150");
    await press("Enter");
    expect(saves).toEqual([
      [{ day: day(2), key: "offersMade", kind: "actual", value: 150 }],
    ]);
    expect(text(cell("offersMade", 2))).toBe("150");
    expect(picked()).toBe(`offersMade@${day(3)}`);
    expect(active()).toBe(grid());
    // Still on the grid: the next number types straight into the next day.
    await keys("3", "Enter");
    expect(saves.length).toBe(2);
    expect(saves[1][0]).toMatchObject({ day: day(3), value: 3 });
  });

  test("Escape drops the number and saves nothing", async () => {
    await show();
    await click(cell("offersMade", 2));
    await keys("9", "9");
    expect(editor()?.value).toBe("99");
    await press("Escape");
    expect(editor() === null).toBe(true);
    expect(saves).toEqual([]);
    expect(text(cell("offersMade", 2))).toBe("");
    expect(picked()).toBe(`offersMade@${day(2)}`);
    expect(active()).toBe(grid());
  });

  test("Tab saves once and moves right past the worked-out columns; Shift+Tab comes back", async () => {
    await show();
    await click(cell("offersMade", 2));
    await keys("4", "Tab");
    expect(saves).toEqual([
      [{ day: day(2), key: "offersMade", kind: "actual", value: 4 }],
    ]);
    // Offer % is worked out, so Tab lands on Closed deals.
    expect(picked()).toBe(`closes@${day(2)}`);
    expect(active()).toBe(grid());
    await press("2");
    await press("Tab", { shiftKey: true });
    expect(saves.length).toBe(2);
    expect(saves[1][0]).toMatchObject({ key: "closes", value: 2 });
    expect(picked()).toBe(`offersMade@${day(2)}`);
  });

  test("Enter, F2 and a double click open the number with all of it selected", async () => {
    stored = [{ day: day(1), key: "offersMade", kind: "actual", value: 2 }];
    await show();
    await click(cell("offersMade", 1));
    await press("Enter");
    expect(editor()?.value).toBe("2");
    expect([editor()?.selectionStart, editor()?.selectionEnd]).toEqual([0, 1]);
    // Typing replaces the selection, it does not add to it.
    await keys("5", "Enter");
    expect(saves[0][0]).toMatchObject({ day: day(1), value: 5 });
    await click(cell("offersMade", 1));
    await press("F2");
    expect(editor()?.value).toBe("5");
    await press("Escape");
    await dblclick(cell("offersMade", 1));
    expect([editor()?.selectionStart, editor()?.selectionEnd]).toEqual([0, 1]);
    await press("Escape");
    expect(saves.length).toBe(1);
  });

  test("Delete clears a typed cell and leaves a measured one", async () => {
    stored = [{ day: day(1), key: "offersMade", kind: "actual", value: 2 }];
    await show();
    expect(text(rowCell("offersMade", "MTD"))).toBe("2");
    await click(cell("offersMade", 1));
    await press("Delete");
    expect(saves).toEqual([
      [{ day: day(1), key: "offersMade", kind: "actual", value: null }],
    ]);
    expect(text(cell("offersMade", 1))).toBe("");
    // Nothing typed is missing, never zero.
    expect(text(rowCell("offersMade", "MTD"))).toBe("n/a");
    await click(cell("leads", 1));
    expect(text(cell("leads", 1))).toBe("5");
    await press("Delete");
    expect(saves.length).toBe(1);
    expect(text(cell("leads", 1))).toBe("5");
    expect(active()).toBe(grid());
  });

  test("the number shows before the save comes back, and the read after it skips the call centre report", async () => {
    await show();
    expect(reportReads()).toBe(1);
    saveMode = "hold";
    await click(cell("offersMade", 2));
    await keys("7", "Enter");
    expect(saves.length).toBe(1);
    expect(held !== null).toBe(true);
    expect(text(cell("offersMade", 2))).toBe("7");
    expect(text(rowCell("offersMade", "MTD"))).toBe("7");
    const reads = rpcCalls.filter(
      c => c.name === "cockpit_ceo_goal_sheet_context",
    ).length;
    await act(async () => held?.());
    await flush();
    expect(
      rpcCalls.filter(c => c.name === "cockpit_ceo_goal_sheet_context").length,
    ).toBe(reads + 1);
    expect(reportReads()).toBe(1);
    expect(text(cell("offersMade", 2))).toBe("7");
    expect(
      host.querySelector('[aria-label="Reading the sheet"]') === null,
    ).toBe(true);
  });

  test("a failed save puts the old number back, says why and tries again", async () => {
    stored = [{ day: day(1), key: "offersMade", kind: "actual", value: 2 }];
    await show();
    saveMode = "fail";
    await click(cell("offersMade", 1));
    await keys("8", "Enter");
    expect(saves.length).toBe(1);
    expect(text(cell("offersMade", 1))).toBe("2");
    const alert = host.querySelector('[role="alert"]') as any;
    expect(text(alert)).toContain("was not saved: The database is busy");
    expect(text(alert)).toContain("The old value is back");
    saveMode = "ok";
    const again = Array.from(
      alert.querySelectorAll("button") as ArrayLike<any>,
    ).find(b => text(b) === "Try again");
    await click(again);
    expect(saves.length).toBe(2);
    expect(saves[1][0]).toMatchObject({ day: day(1), value: 8 });
    expect(text(cell("offersMade", 1))).toBe("8");
    expect(host.querySelector('[role="alert"]') === null).toBe(true);
  });
});

describe("clicks and late answers", () => {
  test("a click or double click inside the open cell keeps it open and saves nothing", async () => {
    stored = [{ day: day(1), key: "offersMade", kind: "actual", value: 2 }];
    await show();
    await click(cell("offersMade", 1));
    await press("F2");
    expect(editor()?.value).toBe("2");
    // A click in the box places the caret; it used to save and close it.
    await click(editor());
    expect(editor()?.value).toBe("2");
    expect(active()).toBe(editor());
    await press("7");
    expect(editor()?.value).toBe("7");
    await click(editor());
    await click(cell("offersMade", 1));
    // A double click picks a word; it used to open the cell afresh and drop
    // what was typed.
    await dblclick(editor());
    await dblclick(cell("offersMade", 1));
    expect(editor()?.value).toBe("7");
    expect(active()).toBe(editor());
    // A press on the cell's edge keeps the focus in the box; one in the box
    // is the box's own.
    const edge = new win.MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    cell("offersMade", 1).dispatchEvent(edge);
    expect(edge.defaultPrevented).toBe(true);
    const inBox = new win.MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    editor().dispatchEvent(inBox);
    expect(inBox.defaultPrevented).toBe(false);
    expect(saves).toEqual([]);
    await press("Enter");
    expect(saves).toEqual([
      [{ day: day(1), key: "offersMade", kind: "actual", value: 7 }],
    ]);
    expect(active()).toBe(grid());
  });

  test("a failed save a newer one overtook leaves the newer number and says nothing", async () => {
    await show();
    saveMode = "manual";
    await click(cell("offersMade", 2));
    await keys("8", "Enter");
    await click(cell("offersMade", 2));
    await keys("9", "Enter");
    expect(saves.map(x => x[0].value)).toEqual([8, 9]);
    await act(async () => pending[1].ok());
    await act(async () => pending[0].fail());
    await flush();
    expect(text(cell("offersMade", 2))).toBe("9");
    expect(host.querySelector('[role="alert"]') === null).toBe(true);
    expect(saves.length).toBe(2);
    expect(stored).toEqual([
      { day: day(2), key: "offersMade", kind: "actual", value: 9 },
    ]);
  });

  test("a failed paste puts back and tries again only the cells not typed since", async () => {
    await show();
    saveMode = "manual";
    await click(cell("offersMade", 1));
    await act(async () => {
      const e = new win.Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(e, "clipboardData", {
        value: { getData: () => "4\n5\n" },
      });
      grid().dispatchEvent(e);
    });
    await flush(2);
    expect(saves[0].map((c: any) => [c.day, c.value])).toEqual([
      [day(1), 4],
      [day(2), 5],
    ]);
    expect(text(cell("offersMade", 2))).toBe("5");
    await click(cell("offersMade", 2));
    await keys("6", "Enter");
    await act(async () => pending[1].ok());
    await act(async () => pending[0].fail());
    await flush();
    expect(text(cell("offersMade", 1))).toBe("");
    expect(text(cell("offersMade", 2))).toBe("6");
    const alert = host.querySelector('[role="alert"]') as any;
    expect(text(alert)).toContain(
      "1 of 2 pasted cells was not saved: The connection dropped. The old value is back.",
    );
    saveMode = "ok";
    const again = Array.from(
      alert.querySelectorAll("button") as ArrayLike<any>,
    ).find(b => text(b) === "Try again");
    await click(again);
    expect(saves[2]).toEqual([
      { day: day(1), key: "offersMade", kind: "actual", value: 4 },
    ]);
    expect(text(cell("offersMade", 1))).toBe("4");
    expect(text(cell("offersMade", 2))).toBe("6");
  });

  test("the same for a target typed twice; another target's failure still says so", async () => {
    await show();
    saveMode = "manual";
    await click(rowCell("referrals", "target"));
    await keys("5", "Enter");
    await keys("6", "Enter");
    expect(targetSaves.map(x => x[0].target)).toEqual([5, 6]);
    await act(async () => pending[1].ok());
    await act(async () => pending[0].fail());
    await flush();
    expect(text(rowCell("referrals", "target"))).toBe("6");
    expect(host.querySelector('[role="alert"]') === null).toBe(true);

    // Two different targets: the one that failed goes back and says why,
    // the other keeps its number.
    await click(rowCell("testimonials", "target"));
    await keys("3", "Enter");
    await click(rowCell("googleReviews", "target"));
    await keys("4", "Enter");
    await act(async () => pending[3].ok());
    await act(async () => pending[2].fail());
    await flush();
    expect(text(rowCell("testimonials", "target"))).toBe("");
    expect(text(rowCell("googleReviews", "target"))).toBe("4");
    const alert = host.querySelector('[role="alert"]') as any;
    expect(text(alert)).toContain(
      "The target for Testimonials was not saved: The connection dropped",
    );
    expect(text(alert)).toContain("The old target is back");
  });

  test("a month that fails to open leaves every month in the picker", async () => {
    await show();
    const next = `${shiftMonth(month)}`;
    failingMonths.add(next);
    const trigger = host.querySelector('[aria-label="Which month"]') as any;
    await click(trigger);
    const item = (m: string) =>
      Array.from(
        win.document.querySelectorAll('[role="option"]') as ArrayLike<any>,
      ).find(o => text(o) === monthLong(m));
    await click(item(next));
    expect(text(host)).toContain("The sheet read timed out");
    await click(host.querySelector('[aria-label="Which month"]'));
    const listed = Array.from(
      win.document.querySelectorAll('[role="option"]') as ArrayLike<any>,
    ).map(o => text(o));
    expect(listed).toEqual([monthLong(month), monthLong(next)]);
    await click(item(month));
    expect(text(cell("leads", 1))).toBe("5");
  });
});

describe("the columns", () => {
  test("Total new cash shows Cash collected's target and does not take one", async () => {
    await show();
    expect(text(rowCell("totalNewCash", "target"))).toBe("$30,000");
    expect(text(rowCell("newCash", "target"))).toBe("$30,000");
    await click(rowCell("totalNewCash", "target"));
    await press("5");
    expect(editor() === null).toBe(true);
    expect(text(host)).toContain("Cash collected's target, the same number.");
  });
});

describe("on a phone", () => {
  test("the last complete day, the counts and one tap to type, saved the grid's way", async () => {
    win.happyDOM.setViewport({ width: 375, height: 812 });
    try {
      await show();
      expect(grid() === null).toBe(true);
      const chosen = host.querySelector(
        '[aria-label="Which day"] button[aria-pressed="true"]',
      ) as any;
      expect(chosen?.dataset.day).toBe(day(3));
      const counts = Array.from(
        host.querySelectorAll("button[aria-pressed]") as ArrayLike<any>,
      ).map(b => text(b));
      expect(counts.some(t => /^\d+behind$/.test(t))).toBe(true);
      const section = Array.from(
        host.querySelectorAll(
          "section button[aria-expanded]",
        ) as ArrayLike<any>,
      ).find(b => text(b).startsWith("Demo calls"));
      await click(section);
      const offers = host.querySelector(
        'li[data-col="offersMade"] button[aria-label^="Type Offers made"]',
      ) as any;
      expect(offers?.getAttribute("aria-label")).toContain("empty");
      await click(offers);
      const box = host.querySelector('li[data-col="offersMade"] input') as any;
      expect(box?.getAttribute("inputmode")).toBe("decimal");
      expect(active()).toBe(box);
      await keys("3", "Enter");
      expect(saves).toEqual([
        [{ day: day(3), key: "offersMade", kind: "actual", value: 3 }],
      ]);
      expect(text(host.querySelector('li[data-col="offersMade"]'))).toContain(
        "3 this month",
      );
      const table = Array.from(
        host.querySelectorAll("button") as ArrayLike<any>,
      ).find(b => text(b) === "Open as table");
      await click(table);
      expect(grid() !== null).toBe(true);
      expect(win.localStorage.getItem("ceo.goals.sheetAsTable")).toBe("1");
    } finally {
      win.happyDOM.setViewport({ width: 1024, height: 768 });
    }
  });
});

// --- Round 2 (2026-11-02): every number from its system of record. ---

const buttonNamed = (name: string) =>
  Array.from(host.querySelectorAll("button") as ArrayLike<any>).find(
    b => text(b) === name,
  );
const barText = () =>
  text(host.querySelector(".min-h-16") as any) || text(host);

describe("round 2 on the screen", () => {
  test("the notes sit once at the top; an older server says empty numbers carry their reason", async () => {
    await show();
    const notes = host.querySelector("details") as any;
    expect(text(notes.querySelector("summary"))).toMatch(
      /^About these numbers \(\d+\)$/,
    );
    expect(text(notes)).toContain(
      "Some numbers wait on the sheet's server update of 2 Nov 2026",
    );
    expect(notes.open).toBe(true);
  });

  test("a missing month number says what it waits on", async () => {
    await show();
    await click(rowCell("totalCash", "MTD"));
    // This month's context has no money book, so money in is not read either.
    expect(barText()).toContain("Missing: Money in was not read");
    expect(barText()).toContain("Refunds logged by hand, by day, wait on");
  });

  test("clients churned is not typed: the register is the record", async () => {
    await show();
    await click(cell("clientsChurned", 2));
    await press("5");
    expect(editor() === null).toBe(true);
    expect(saves).toEqual([]);
    expect(text(cell("clientsChurned", 2))).toBe("0");
    expect(barText()).toContain("the register is the record");
  });

  test("Add a metric saves its section under a name the stored table allows", async () => {
    await show();
    await click(buttonNamed("Add a metric"));
    const form = host.querySelector("form") as any;
    const name = form.querySelector("input") as any;
    const setter = Object.getOwnPropertyDescriptor(
      win.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(name, "Case studies filmed");
      name.dispatchEvent(new win.Event("input", { bubbles: true }));
    });
    const section = form.querySelector("select") as any;
    const options = Array.from(section.options as ArrayLike<any>).map(
      (o: any) => o.value,
    );
    expect(options).toContain("customer_success");
    await act(async () => {
      section.value = "customer_success";
      section.dispatchEvent(new win.Event("change", { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(
        new win.Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await flush();
    const sent = rpcCalls.find(
      c => c.name === "cockpit_ceo_goal_sheet_add_metric",
    );
    expect(sent?.args.p_metric).toMatchObject({
      label: "Case studies filmed",
      section: "client_success",
    });
  });

  test("the lock-in names October's Total new cash line as the sheet does", async () => {
    lockinRows = [
      {
        id: 70,
        month,
        section: "finances",
        sort: 4,
        label: "Total new cash",
        value: "$100",
        status: "measured",
        source: "Every rail",
        leaves_out: null,
        metric_key: "totalCash",
        client_task_id: null,
        answers: {},
        updated_by: "ceo",
        updated_at: "x",
      },
    ];
    await show();
    await click(buttonNamed("Lock in"));
    expect(text(host)).toContain("Total revenue (with AR)");
    expect(text(host)).not.toContain("Total new cash");
  });

  test("on a phone: Escape hands focus back to the row's number; the controls are 44px; Ask Hermes stays clear", async () => {
    win.happyDOM.setViewport({ width: 375, height: 812 });
    try {
      await show();
      const section = Array.from(
        host.querySelectorAll(
          "section button[aria-expanded]",
        ) as ArrayLike<any>,
      ).find(b => text(b).startsWith("Demo calls"));
      await click(section);
      const number = () =>
        host.querySelector(
          'li[data-col="offersMade"] button[data-number]',
        ) as any;
      await click(number());
      await keys("7", "Escape");
      expect(saves).toEqual([]);
      expect(active()).toBe(number());
      await click(number());
      await keys("2", "Enter");
      expect(saves.length).toBe(1);
      expect(active()).toBe(number());
      // The month picker, the Sheet / Lock in switch and Open as table.
      const picker = host.querySelector('[aria-label="Which month"]') as any;
      expect(picker.className).toContain("max-sm:h-11!");
      for (const name of ["Sheet", "Lock in"]) {
        const b = buttonNamed(name);
        expect(b.className).toContain("max-sm:min-h-11");
        expect(b.className).toContain("no-touch");
      }
      // The shared Button sets 40px on a touch screen; this one says 44px there too.
      expect(buttonNamed("Open as table").className).toContain(
        "pointer-coarse:min-h-11",
      );
      // Each row's number keeps clear of Ask Hermes's column, and the list
      // ends far enough above it to scroll clear.
      const row = host.querySelector('li[data-col="offersMade"] > div') as any;
      expect(row.className).toContain("pr-12");
      expect(host.querySelector('[class*="pb-[calc(5rem"]') !== null).toBe(
        true,
      );
      // The notes are one tap away on a phone, closed.
      expect((host.querySelector("details") as any).open).toBe(false);
    } finally {
      win.happyDOM.setViewport({ width: 1024, height: 768 });
    }
  });
});

describe("Plan the next month", () => {
  test("refunds are a box beside Upsell cash, not a typed row, and the box reaches the plan", async () => {
    const row = (id: number, key: string, label: string, target: number) => ({
      id,
      groupKey: "back_end",
      metricKey: key,
      label,
      unit: "usd",
      direction: key === "refundAmount" ? "down" : "up",
      target,
      stretch: null,
      baseline: null,
      note: null,
      sort: id,
      source: "typed",
      sourceText: "",
      actual: null,
      pacedTarget: null,
      level: false,
      onPace: null,
      progress: null,
    });
    const board = {
      plan: {
        id: 7,
        periodKind: "month",
        periodFrom: "2026-11-01",
        periodTo: "2026-11-30",
        title: "November 2026 plan",
        mission: null,
        headline: null,
        status: "live",
        workingDays: 25,
      },
      plans: [],
      pace: {
        workingDays: 25,
        workedSoFar: 1,
        daysLeft: 24,
        share: 0.04,
        through: "2026-11-01",
      },
      groups: [
        {
          key: "back_end",
          label: "Back end",
          blurb: "",
          targets: [
            row(1, "upsellCash", "Upsell cash", 2000),
            row(2, "refundAmount", "Refunds amount", 300),
          ],
        },
      ],
      behind: [],
      catalogue: [
        {
          key: "upsellCash",
          label: "Upsell cash",
          group: "back_end",
          unit: "usd",
          direction: "up",
          source: "",
        },
      ],
      measured: {},
      callClients: null,
      costs: null,
    };
    mounts += 1;
    await act(async () => {
      root.render(
        createElement(NextMonth, {
          key: mounts,
          board: board as never,
          onClose: () => {},
          onSaved: () => {},
        }),
      );
    });
    await flush();
    const box = host.querySelector('input[aria-label^="Refunds for"]') as any;
    expect(box?.value).toBe("300");
    // Not in the typed table any more.
    expect(
      host.querySelector(
        'input[aria-label="Refunds amount target for next month"]',
      ) === null,
    ).toBe(true);
    const setter = Object.getOwnPropertyDescriptor(
      win.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(box, "450");
      box.dispatchEvent(new win.Event("input", { bubbles: true }));
    });
    const save = Array.from(
      host.querySelectorAll("button") as ArrayLike<any>,
    ).find(b => /^Save \d+ targets as a draft$/.test(text(b)));
    await click(save);
    await flush();
    const refunds = targetSaves
      .flat()
      .find(t => t.metricKey === "refundAmount");
    expect(refunds).toMatchObject({ target: 450, groupKey: "back_end" });
  });
});

describe("the instalments owed on signed deals (round 3, 2026-11-02)", () => {
  const setter = () =>
    Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")
      ?.set;
  const lineBox = () =>
    host.querySelector('input[placeholder="Not planned"]') as any;
  const button = (label: string) =>
    Array.from(host.querySelectorAll("button") as ArrayLike<any>).find(
      b => text(b) === label,
    );
  /** An invented funnel: $1,000 at $20 a lead makes 1.26 deals at $5,000, 60% collected. */
  const FUNNEL = [
    { metricKey: "spend", target: 1000 },
    { metricKey: "cpl", target: 20 },
    { metricKey: "leadToBooked", target: 0.5 },
    { metricKey: "introShowRate", target: 0.6 },
    { metricKey: "introToDemo", target: 0.6 },
    { metricKey: "demoShowRate", target: 0.7 },
    { metricKey: "closeRate", target: 0.2 },
    { metricKey: "aov", target: 5000 },
    { metricKey: "cashShare", target: 0.6 },
    { metricKey: "mrrCollectionRate", target: 0.8 },
  ];

  test("a line over the sheet: typed, it saves the plan's row and Cash collected follows", async () => {
    storedTargets = [...FUNNEL, { metricKey: "mrrProjected", target: 2000 }];
    bookNow = {
      projectedMrr: 7000,
      collected: 0,
      collectedBackEnd: 0,
      projectedExisting: 2000,
      projectedOnDeals: 5000,
      history: [],
    };
    await show();
    const box = lineBox();
    expect(box).not.toBeNull();
    expect(box.value).toBe("");
    expect(text(host)).toContain(
      "Not planned. Cards still on their closer-form deal",
    );
    expect(text(host)).toContain(
      "The book holds $5,000 on signed deals this month.",
    );
    // Not inside the grid: the grid's keys never reach it.
    expect(grid().contains(box)).toBe(false);
    await act(async () => {
      box.focus();
      setter()?.call(box, "4500");
      box.dispatchEvent(new win.Event("input", { bubbles: true }));
    });
    await press("Enter");
    await flush();
    const sent = targetSaves.flat();
    expect(sent.find(t => t.metricKey === "onDealDue")).toMatchObject({
      target: 4500,
      groupKey: "back_end",
      label: "Instalments owed on signed deals",
    });
    // Cash collected: 60% of $6,300 contracted, plus 80% of the $4,500.
    expect(sent.find(t => t.metricKey === "newCash")?.target).toBe(7380);
    // MRR collected stays the back end's 80% of 2,000, so it is not sent;
    // the spend is typed, so the funnel is not either.
    expect(sent.some(t => t.metricKey === "mrrCollected")).toBe(false);
    expect(sent.some(t => t.metricKey === "spend")).toBe(false);
    expect(sent.some(t => t.metricKey === "leads")).toBe(false);
    expect(targetSaves.length).toBe(1);
    expect(lineBox().value).toBe("4500");
    expect(text(host)).toContain(
      "of it, $3,600, is in Cash collected's target",
    );
  });

  test("planned in both, it says they count twice and takes them out of Projected MRR in one tap", async () => {
    storedTargets = [
      { metricKey: "mrrProjected", target: 7000 },
      { metricKey: "mrrCollectionRate", target: 0.8 },
      { metricKey: "onDealDue", target: 5000 },
    ];
    bookNow = {
      projectedMrr: 7000,
      collected: 0,
      collectedBackEnd: 0,
      projectedExisting: 2000,
      projectedOnDeals: 5000,
      history: [],
    };
    await show();
    expect(lineBox().value).toBe("5000");
    expect(text(host)).toContain(
      "Projected MRR's target, $7,000, holds them as well (the book's back end is $2,000), so they count twice.",
    );
    // The book's number is in the box, so no button offers it again.
    expect(text(host)).not.toContain("Use the book's");
    await click(button("Take them out of Projected MRR"));
    await flush();
    const sent = targetSaves.flat();
    expect(sent.find(t => t.metricKey === "mrrProjected")?.target).toBe(2000);
    expect(sent.find(t => t.metricKey === "onDealDue")?.target).toBe(5000);
    expect(targetSaves.length).toBe(1);
    expect(text(host)).not.toContain("count twice");
  });

  test("Projected MRR's target on the whole book: the book's number moves out of it and the spend stays", async () => {
    // Plan 6's shape, invented: a goal, the funnel worked back from it, and
    // Projected MRR set on the whole book (2,000 back end and 5,000 on deals).
    storedTargets = [
      ...FUNNEL,
      { metricKey: "totalCash", target: 20000 },
      { metricKey: "mrrProjected", target: 7000 },
    ];
    bookNow = {
      projectedMrr: 7000,
      collected: 0,
      collectedBackEnd: 0,
      projectedExisting: 2000,
      projectedOnDeals: 5000,
      history: [],
    };
    await show();
    // Said before anything is saved.
    expect(text(host)).toContain(
      "Projected MRR's target, $7,000, holds them already (the book's back end is $2,000): saving the book's $5,000 here takes it out of that target, to $2,000, so they count once and the spend stays.",
    );
    await click(button("Use the book's $5,000"));
    await flush();
    expect(targetSaves.length).toBe(1);
    const sent = targetSaves.flat();
    const row = (k: string) => sent.find(t => t.metricKey === k);
    expect(row("onDealDue")?.target).toBe(5000);
    expect(String(row("onDealDue")?.note)).toContain("book: $5,000.");
    expect(row("mrrProjected")?.target).toBe(2000);
    expect(String(row("mrrProjected")?.note)).toContain(
      "$5,000 of cards still on their closer-form deal moved out of this target",
    );
    expect(row("mrrCollected")?.target).toBe(1600);
    // The funnel is asked for what it was asked for before: no row of it is sent.
    for (const k of [
      "spend",
      "spendRetargeting",
      "leads",
      "introsBooked",
      "closes",
      "contracted",
    ])
      expect(row(k)).toBeUndefined();
    // The goal stands.
    expect(row("totalCash")?.target ?? 20000).toBe(20000);
    expect(text(host)).not.toContain("holds them");
  });

  test("the book's number is one tap", async () => {
    storedTargets = [{ metricKey: "mrrCollectionRate", target: 0.8 }];
    bookNow = {
      projectedMrr: 7000,
      collected: 0,
      collectedBackEnd: 0,
      projectedExisting: 2000,
      projectedOnDeals: 5000,
      history: [],
    };
    await show();
    await click(button("Use the book's $5,000"));
    await flush();
    expect(
      targetSaves.flat().find(t => t.metricKey === "onDealDue")?.target,
    ).toBe(5000);
  });

  test("Plan next month starts MRR due and the instalments from the book, and saves both", async () => {
    const row = (id: number, key: string, label: string, target: number) => ({
      id,
      groupKey: "back_end",
      metricKey: key,
      label,
      unit: "usd",
      direction: "up",
      target,
      stretch: null,
      baseline: null,
      note: null,
      sort: id,
      source: "measured",
      sourceText: "",
      actual: null,
      pacedTarget: null,
      level: false,
      onPace: null,
      progress: null,
    });
    const board = {
      plan: {
        id: 7,
        periodKind: "month",
        periodFrom: "2026-11-01",
        periodTo: "2026-11-30",
        title: "November 2026 plan",
        mission: null,
        headline: null,
        status: "live",
        workingDays: 25,
      },
      plans: [],
      pace: {
        workingDays: 25,
        workedSoFar: 1,
        daysLeft: 24,
        share: 0.04,
        through: "2026-11-01",
      },
      groups: [
        {
          key: "back_end",
          label: "Back end",
          blurb: "",
          // Set on the whole book before round 2.
          targets: [
            row(1, "mrrProjected", "Projected MRR to collect", 11000),
            row(2, "mrrCollectionRate", "Collections %", 0.85),
          ],
        },
      ],
      behind: [],
      catalogue: [
        {
          key: "mrrProjected",
          label: "MRR due",
          group: "back_end",
          unit: "usd",
          direction: "up",
          source: "",
        },
      ],
      measured: { mrrProjected: 3000, onDealDue: 8000 },
      callClients: null,
      costs: null,
    };
    mounts += 1;
    await act(async () => {
      root.render(
        createElement(NextMonth, {
          key: mounts,
          board: board as never,
          onClose: () => {},
          onSaved: () => {},
        }),
      );
    });
    await flush();
    const mrr = host.querySelector('input[aria-label^="MRR due for"]') as any;
    const owed = host.querySelector(
      'input[aria-label^="Instalments owed on signed deals for"]',
    ) as any;
    expect(mrr?.value).toBe("3000");
    expect(owed?.value).toBe("8000");
    // Last month's whole-book plan stays one tap away, named for what it is.
    expect(text(host)).toContain("Nov plan $11,000 (whole book)");
    expect(text(host)).not.toContain("count twice");
    expect(text(host)).toContain(
      "of $8,000, collected as Cash collected, not as MRR.",
    );
    expect(text(host)).toContain("Instalments collected$6,800");
    const save = Array.from(
      host.querySelectorAll("button") as ArrayLike<any>,
    ).find(b => /^Save \d+ targets as a draft$/.test(text(b)));
    await click(save);
    await flush();
    const sent = targetSaves.flat();
    expect(sent.find(t => t.metricKey === "mrrProjected")?.target).toBe(3000);
    const line = sent.find(t => t.metricKey === "onDealDue");
    expect(line).toMatchObject({
      target: 8000,
      groupKey: "back_end",
      label: "Instalments owed on signed deals",
      unit: "usd",
      baseline: 8000,
    });
    expect(String(line?.note)).toContain("From Nov's book: $8,000.");

    // Tapped, the whole book in MRR due and the instalments beside it are
    // the same cards twice: it says so.
    const whole = Array.from(
      host.querySelectorAll("button") as ArrayLike<any>,
    ).find(b => text(b) === "Nov plan $11,000 (whole book)");
    await click(whole);
    expect(text(host)).toContain(
      "MRR due, $11,000, looks set on the whole book (Nov's back end is $3,000), so these instalments would count twice: set MRR due to the back end.",
    );
  });

  test("re-saving a draft with the boxes empty clears its instalments and refunds, never leaves the old numbers", async () => {
    const board = {
      plan: {
        id: 7,
        periodKind: "month",
        periodFrom: "2026-11-01",
        periodTo: "2026-11-30",
        title: "November 2026 plan",
        mission: null,
        headline: null,
        status: "live",
        workingDays: 25,
      },
      // A draft already written for December.
      plans: [
        {
          id: 9,
          periodKind: "month",
          periodFrom: "2026-12-01",
          periodTo: "2026-12-31",
          title: "December 2026 plan",
          mission: null,
          headline: null,
          status: "draft",
          workingDays: 26,
        },
      ],
      pace: null,
      groups: [],
      behind: [],
      catalogue: [],
      measured: { mrrProjected: 3000, onDealDue: 8000 },
      callClients: null,
      costs: null,
    };
    mounts += 1;
    await act(async () => {
      root.render(
        createElement(NextMonth, {
          key: mounts,
          board: board as never,
          onClose: () => {},
          onSaved: () => {},
        }),
      );
    });
    await flush();
    const owed = host.querySelector(
      'input[aria-label^="Instalments owed on signed deals for"]',
    ) as any;
    expect(owed?.value).toBe("8000");
    await act(async () => {
      setter()?.call(owed, "");
      owed.dispatchEvent(new win.Event("input", { bubbles: true }));
    });
    const save = Array.from(
      host.querySelectorAll("button") as ArrayLike<any>,
    ).find(b => /^Update the .* draft \(\d+ targets\)$/.test(text(b)));
    expect(save).toBeDefined();
    await click(save);
    await flush();
    const sent = targetSaves.flat();
    // Sent with no number, so the draft's own row is cleared: not planned.
    const line = sent.find(t => t.metricKey === "onDealDue");
    expect(line).toBeDefined();
    expect(line.target).toBe(null);
    expect("target" in line).toBe(true);
    const refunds = sent.find(t => t.metricKey === "refundAmount");
    expect(refunds?.target).toBe(null);
  });

  test("Plan next month with no book and no line: not planned, and no row is written", async () => {
    const board = {
      plan: {
        id: 7,
        periodKind: "month",
        periodFrom: "2026-11-01",
        periodTo: "2026-11-30",
        title: "November 2026 plan",
        mission: null,
        headline: null,
        status: "live",
        workingDays: 25,
      },
      plans: [],
      pace: null,
      groups: [],
      behind: [],
      catalogue: [],
      measured: {},
      callClients: null,
      costs: null,
    };
    mounts += 1;
    await act(async () => {
      root.render(
        createElement(NextMonth, {
          key: mounts,
          board: board as never,
          onClose: () => {},
          onSaved: () => {},
        }),
      );
    });
    await flush();
    const owed = host.querySelector(
      'input[aria-label^="Instalments owed on signed deals for"]',
    ) as any;
    expect(owed?.value).toBe("");
    expect(text(host)).toContain("Not planned");
    expect(text(host)).toContain("Leave it empty and none are planned.");
  });
});
