/**
 * The gap report and the view switch, drawn in happy-dom from invented answers (src/dev/resultsFixture.ts)
 * with the database's `rpc` answered here, so nothing reaches the network (Muhammed, 2026-10-21). They hold
 * what a person sees: the rows most missing first, a client that opens to its meetings, and a failed read
 * that says what to do and tries again. The sums behind them are held in results-screens.test.ts. The speed
 * chart and the morning list moved to the dialer on 22 October 2026.
 *
 * Nothing here may outlive this file: bun runs every test file in one process, so no module mocks, and
 * every global and the client's `rpc` are put back.
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";

const g = globalThis as any;
const ENV = {
  VITE_SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co",
  VITE_SUPABASE_ANON_KEY: "test-placeholder-key",
};
const envs = [process.env, (import.meta as any).env].filter(Boolean);
const envBefore = envs.map(e => Object.fromEntries(Object.keys(ENV).map(k => [k, e[k]])));
for (const e of envs) Object.assign(e, ENV);

const { Window } = await import("happy-dom");
const win = new Window({ url: "https://cockpit.test/performance" });
const DOM: string[] = [
  "window",
  "document",
  "navigator",
  "sessionStorage",
  "localStorage",
  "Element",
  "Node",
  "Event",
  "MouseEvent",
  "PointerEvent",
  "KeyboardEvent",
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

// Nothing leaves this file: any fetch the stub below does not answer fails.
const realFetch = globalThis.fetch;
const strayFetches: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  strayFetches.push(String(input));
  throw new Error("The results screens' test makes no network calls.");
}) as typeof fetch;

const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");
const { supabase } = await import("../src/lib/supabase");
const { GapReport } = await import("../src/components/results/GapReport");
const { ResultsView, ViewSwitch, viewOf, VIEWS } = await import(
  "../src/pages/performance/ResultsViews"
);
const fixtures = await import("../src/dev/resultsFixture");
const model = await import("../src/lib/resultsModel");

type Answer = {
  data: unknown;
  error: { message: string; code?: string } | null;
};
type Scenario = import("../src/dev/resultsFixture").ResultsScenario;

const db = supabase as any;
const realRpc = db.rpc;
let calls: { name: string; args: Record<string, any> }[] = [];
let scenario: Scenario = "default";
let failNext: Answer["error"] = null;

db.rpc = async (name: string, args: Record<string, any> = {}): Promise<Answer> => {
  calls.push({ name, args });
  if (failNext) {
    const error = failNext;
    failNext = null;
    return { data: null, error };
  }
  switch (name) {
    case "cockpit_gap_read":
      return { data: fixtures.gapFixture(args.p_from, args.p_to, scenario), error: null };
    case "cockpit_gap_client_read": {
      const data = fixtures.gapClientFixture(args.p_location, args.p_from, args.p_to);
      return data
        ? { data, error: null }
        : { data: null, error: { code: "42501", message: "That client is not on your board." } };
    }
    case "cockpit_speed_read":
      return {
        data: fixtures.speedFixture(args.p_from, args.p_to, args.p_clock, scenario),
        error: null,
      };
    case "cockpit_morning_uncalled_read":
      return { data: fixtures.morningFixture(args.p_location, scenario), error: null };
    default:
      return { data: null, error: { message: `The test has no answer for ${name}.` } };
  }
};

const host = win.document.createElement("div");
win.document.body.append(host);
const root = createRoot(host as any);

async function flush(times = 6) {
  for (let i = 0; i < times; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
}
async function show(element: any) {
  await act(async () => {
    root.render(element);
  });
  await flush();
}
const text = () => (host.textContent ?? "").replace(/\s+/g, " ");
const click = async (el: any) => {
  await act(async () => {
    el.dispatchEvent(new win.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flush();
};
const buttons = () => Array.from(host.querySelectorAll("button") as ArrayLike<any>) as any[];
const byText = (label: string | RegExp) =>
  buttons().find(b =>
    typeof label === "string"
      ? (b.textContent ?? "").trim() === label
      : label.test((b.textContent ?? "").trim()),
  );
const named = (name: string) => calls.filter(c => c.name === name);

beforeEach(() => {
  calls = [];
  scenario = "default";
  failNext = null;
});
afterEach(async () => {
  await act(async () => {
    root.render(null);
  });
});
afterAll(async () => {
  await act(async () => {
    root.unmount();
  });
  db.rpc = realRpc;
  globalThis.fetch = realFetch;
  envs.forEach((e, i) => {
    for (const [k, v] of Object.entries(envBefore[i])) {
      if (v === undefined) delete e[k];
      else e[k] = v;
    }
  });
  for (const [k, d] of globalsBefore) {
    if (d) Object.defineProperty(globalThis, k, d);
    else delete g[k];
  }
  expect(strayFetches).toEqual([]);
});

const WINDOW = () => model.gapWindow(model.kuwaitToday());

describe("the gap report", () => {
  test("asks for the last 14 days and lists the clients, most missing first", async () => {
    await show(createElement(GapReport));
    const read = named("cockpit_gap_read");
    expect(read).toHaveLength(1);
    expect(read[0].args).toEqual({ p_from: WINDOW().from, p_to: WINDOW().to });

    const expected = fixtures.gapFixture(WINDOW().from, WINDOW().to);
    const rows = Array.from(host.querySelectorAll("li > button[aria-controls]") as ArrayLike<any>);
    expect(rows).toHaveLength(10);
    expect(rows[0].textContent).toContain(expected.rows[0].clientName);
    expect(rows[1].textContent).toContain(expected.rows[1].clientName);
    const t = text();
    expect(t).toContain("Meetings with no result");
    expect(t).toContain(
      `${expected.totals.noResult} of ${expected.totals.meetings} meetings`,
    );
    expect(t).toContain(`${Math.round((expected.totals.noResult / expected.totals.meetings) * 100)}%`);
  });

  test("keeps Blank in sheet and Still confirmed apart, beside the count with no result", async () => {
    await show(createElement(GapReport));
    const head = Array.from(host.querySelectorAll("div.hidden.sm\\:grid span") as ArrayLike<any>).map(
      s => s.textContent,
    );
    expect(head).toEqual([
      "Client",
      "Meetings",
      "No result",
      "Blank in sheet",
      "Still confirmed",
      "Share with no result",
    ]);
    const first = fixtures.gapFixture(WINDOW().from, WINDOW().to).rows[0];
    const row = host.querySelector("li > button[aria-controls]") as any;
    const cells = Array.from(row.querySelectorAll("span.tabular-nums") as ArrayLike<any>).map(
      c => (c.textContent ?? "").replace(/^[A-Za-z ]+(?=\d)/, ""),
    );
    expect(cells.slice(0, 4)).toEqual([
      String(first.meetings),
      String(first.noResult),
      String(first.sheetBlank),
      String(first.crmConfirmed),
    ]);
  });

  test("shows the first ten and the rest on request", async () => {
    await show(createElement(GapReport));
    const rowsNow = () => host.querySelectorAll("li > button[aria-controls]").length;
    expect(rowsNow()).toBe(10);
    await click(byText("Show the other 4"));
    expect(rowsNow()).toBe(14);
    await click(byText("Show fewer"));
    expect(rowsNow()).toBe(10);
  });

  test("a client opens to its own meetings, each with its sheet state and a link to the CRM", async () => {
    await show(createElement(GapReport));
    const top = fixtures.gapFixture(WINDOW().from, WINDOW().to).rows[0];
    const row = host.querySelector("li > button[aria-controls]") as any;
    expect(row.getAttribute("aria-expanded")).toBe("false");
    await click(row);

    const one = named("cockpit_gap_client_read");
    expect(one).toHaveLength(1);
    expect(one[0].args).toEqual({
      p_location: top.locationId,
      p_from: WINDOW().from,
      p_to: WINDOW().to,
    });
    expect(row.getAttribute("aria-expanded")).toBe("true");
    const panel = host.querySelector(`#${row.getAttribute("aria-controls")}`) as any;
    expect(panel).not.toBeNull();
    const links = Array.from(panel.querySelectorAll("a") as ArrayLike<any>);
    expect(links).toHaveLength(top.noResult);
    for (const a of links) {
      expect(a.textContent).toContain("Open in CRM");
      expect(a.getAttribute("href")).toStartWith("https://app.gohighlevel.com/");
    }
    expect(panel.textContent).toContain("Blank in sheet");

    await click(row);
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(`#${row.getAttribute("aria-controls")}`)).toBeNull();
  });

  test("a client with no past meetings is told so, and nothing is shown as zero", async () => {
    scenario = "empty";
    await show(createElement(GapReport));
    expect(text()).toContain("No past meetings in these 14 days");
    expect(host.querySelectorAll("li > button[aria-controls]")).toHaveLength(0);
    expect(text()).not.toContain("0%");
  });

  test("a sheet the dialer could not read is named, and the count is flagged as maybe too high", async () => {
    scenario = "unread";
    await show(createElement(GapReport));
    expect(text()).toContain("The dialer could not read the sheet of Atlas Renovation on its last pass");
  });

  test("a failed read says what to do and reads again on Try again", async () => {
    failNext = { code: "57014", message: "canceling statement due to statement timeout" };
    await show(createElement(GapReport));
    expect(text()).toContain("This took too long to answer. Try again, or pick a shorter time frame.");
    expect(host.querySelectorAll("li > button[aria-controls]")).toHaveLength(0);
    await click(byText("Try again"));
    expect(named("cockpit_gap_read")).toHaveLength(2);
    expect(host.querySelectorAll("li > button[aria-controls]").length).toBeGreaterThan(0);
    expect(text()).not.toContain("took too long");
  });

  test("a shape the page cannot read is refused in words, not drawn as zeros", async () => {
    const real = db.rpc;
    db.rpc = async (name: string) =>
      name === "cockpit_gap_read"
        ? { data: { rows: "none" }, error: null }
        : { data: null, error: { message: "unexpected" } };
    try {
      await show(createElement(GapReport));
      expect(text()).toContain("came back in a shape this page cannot read");
      expect(text()).toContain("Tell the CEO.");
    } finally {
      db.rpc = real;
    }
  });
});

describe("the views beside the board", () => {
  test("any other address is the board, and the views have the labels the team knows", () => {
    expect(viewOf(null)).toBe("board");
    expect(viewOf("nonsense")).toBe("board");
    expect(viewOf("gap")).toBe("gap");
    // The call speed chart and the morning list moved to the dialer on 22 October 2026: old links open the board.
    expect(viewOf("speed")).toBe("board");
    expect(viewOf("morning")).toBe("board");
    expect(VIEWS.map(v => v.label)).toEqual(["Board", "No result"]);
  });

  test("the switch marks the open view and reports a pick", async () => {
    const picked: string[] = [];
    await show(createElement(ViewSwitch, { view: "board", onChange: (v: string) => picked.push(v) }));
    const pressed = buttons().filter(b => b.getAttribute("aria-pressed") === "true");
    expect(pressed.map(b => b.textContent.trim())).toEqual(["Board"]);
    await click(byText("No result"));
    expect(picked).toEqual(["gap"]);
  });

  test("the no-result view has its own title and reads only its own numbers", async () => {
    await show(
      createElement(ResultsView, {
        view: "gap",
        switcher: createElement(ViewSwitch, { view: "gap", onChange: () => {} }),
      }),
    );
    expect(host.querySelector("h1")?.textContent).toBe("Meetings with no result");
    expect(named("cockpit_gap_read")).toHaveLength(1);
    expect(named("cockpit_speed_read")).toHaveLength(0);
    expect(named("cockpit_morning_uncalled_read")).toHaveLength(0);
  });
});
