/**
 * The CSM call list and the gap report on the client success side, drawn in happy-dom from invented answers
 * (src/dev/resultsFixture.ts) with the database's `rpc` answered here, so nothing reaches the network
 * (Muhammed, 2026-10-21). They hold what a CSM sees: at most five clients, the clients past five as one
 * "Queued for next week" line, a Called button that logs the call once and then shows who and when, and the
 * gap report beside it. The sums are held in the media buyer cockpit's results-screens.test.ts, which also
 * keeps the shared files equal.
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
const win = new Window({ url: "https://cockpit.test/csm" });
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
const { MemoryRouter } = await import("react-router");
const { supabase } = await import("../src/lib/supabase");
const { CallList } = await import("../src/components/results/CallList");
const { GapReport } = await import("../src/components/results/GapReport");
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
let failLog: Answer["error"] = null;
let alreadyLogged = false;
/** Who has been logged as called since the test began: the database's call log, kept here. */
const logged = new Map<string, string>();

db.rpc = async (name: string, args: Record<string, any> = {}): Promise<Answer> => {
  calls.push({ name, args });
  switch (name) {
    case "cockpit_csm_calls_read": {
      const list = fixtures.callListFixture(scenario);
      for (const r of list.rows) {
        const at = logged.get(r.locationId);
        if (at) {
          r.calledAt = at;
          r.calledBy = "csm@example.test";
          r.calledByName = "Test CSM";
        }
      }
      return { data: list, error: null };
    }
    case "cockpit_csm_call_logged": {
      if (failLog) return { data: null, error: failLog };
      const row = fixtures.callListFixture(scenario).rows.find(r => r.locationId === args.p_location);
      if (row?.status !== "call")
        return {
          data: null,
          error: { code: "22023", message: "That client is not on this week's call list." },
        };
      const at = new Date().toISOString();
      logged.set(row.locationId, at);
      return {
        data: {
          ok: true,
          alreadyLogged,
          locationId: row.locationId,
          clientName: row.clientName,
          week: "2026-W43",
          calledAt: at,
          calledBy: "csm@example.test",
        },
        error: null,
      };
    }
    case "cockpit_gap_read":
      return { data: fixtures.gapFixture(args.p_from, args.p_to, scenario), error: null };
    case "cockpit_gap_client_read": {
      const data = fixtures.gapClientFixture(args.p_location, args.p_from, args.p_to);
      return data
        ? { data, error: null }
        : { data: null, error: { code: "42501", message: "That client is not on your board." } };
    }
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
    root.render(createElement(MemoryRouter, null, element));
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
const calledButtons = () => buttons().filter(b => b.textContent.trim() === "Called");
const named = (name: string) => calls.filter(c => c.name === name);
const lines = () => Array.from(host.querySelectorAll("#csm-call-list ul > li") as ArrayLike<any>) as any[];

beforeEach(() => {
  calls = [];
  scenario = "default";
  failLog = null;
  alreadyLogged = false;
  logged.clear();
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

describe("the CSM call list", () => {
  test("lists at most five clients, the most missing first, each with how many meetings are blank", async () => {
    await show(createElement(CallList));
    expect(named("cockpit_csm_calls_read")).toHaveLength(1);
    const rows = lines().filter(l => l.querySelector("a"));
    expect(rows).toHaveLength(5);
    const expected = fixtures.callListFixture().rows.slice(0, 5);
    rows.forEach((row, i) => {
      expect(row.querySelector("a").textContent).toContain(expected[i].clientName);
      expect(row.textContent).toContain(
        `${model.plural(expected[i].missing, "meeting")} still blank after 2 Thursday reminders`,
      );
    });
    expect(text()).toContain("Week 43");
    expect(text()).toContain("up to 5 a week");
  });

  test("the clients past five are one line, queued for next week", async () => {
    await show(createElement(CallList));
    expect(text()).toContain("Queued for next week: Falcon Dental (2), Pearl Fitness (1)");
    expect(text()).not.toContain("Falcon Dental still blank");
  });

  test("a client links to its own results tab and opens to the meetings behind the count", async () => {
    await show(createElement(CallList));
    const first = lines().find(l => l.querySelector("a"));
    expect(first.querySelector("a").getAttribute("href")).toBe("/clients/Liwan%20Limited?tab=results");
    const items = first.querySelectorAll("details li");
    expect(items).toHaveLength(6);
    expect(items[0].textContent).toMatch(/, \w{3} \d{1,2} \w{3,4}: the (Show|Closed) cell is blank$/);
  });

  test("Called logs the call once for that client, then shows who and when instead of the button", async () => {
    await show(createElement(CallList));
    expect(text()).toContain("1 of 5 called");
    expect(calledButtons()).toHaveLength(4);
    const liwan = buttons().find(b => b.getAttribute("aria-label") === "Log that you called Liwan Limited");
    await click(liwan);

    const logs = named("cockpit_csm_call_logged");
    expect(logs).toHaveLength(1);
    expect(logs[0].args).toEqual({ p_location: "locFixCall01" });
    expect(named("cockpit_csm_calls_read")).toHaveLength(2);
    expect(calledButtons()).toHaveLength(3);
    expect(text()).toContain("2 of 5 called");
    const first = lines().find(l => l.querySelector("a"));
    expect(first.textContent).toMatch(/Called by Test CSM, \w{3} \d{1,2} \w{3,4}, \d\d:\d\d/);
    expect(first.querySelector("button")).toBeNull();
  });

  test("a call already logged this week is the same row, and the list still refreshes", async () => {
    alreadyLogged = true;
    await show(createElement(CallList));
    await click(calledButtons()[0]);
    expect(named("cockpit_csm_call_logged")).toHaveLength(1);
    expect(named("cockpit_csm_calls_read")).toHaveLength(2);
  });

  test("a refused log changes nothing on the list and the button works again", async () => {
    failLog = { code: "22023", message: "That client is not on this week's call list." };
    await show(createElement(CallList));
    await click(calledButtons()[0]);
    expect(named("cockpit_csm_call_logged")).toHaveLength(1);
    expect(named("cockpit_csm_calls_read")).toHaveLength(1);
    expect(calledButtons()).toHaveLength(4);
    expect(calledButtons().every(b => !b.disabled)).toBe(true);
  });

  test("when every client on the list has been called it says 5 of 5, and the queue stays", async () => {
    scenario = "allcalled";
    await show(createElement(CallList));
    expect(calledButtons()).toHaveLength(0);
    expect(text()).toContain("5 of 5 called");
    expect(text()).toContain("Queued for next week");
  });

  test("no client to call says what that means", async () => {
    scenario = "empty";
    await show(createElement(CallList));
    expect(text()).toContain("No client to call this week");
    expect(text()).not.toContain("Queued for next week");
  });

  test("says where the count comes from and what it leaves out", async () => {
    await show(createElement(CallList));
    expect(text()).toContain("Counted by Thursday messages that were due, not by messages sent");
    expect(text()).toContain("A client with a call logged this week stays on the list");
  });

  test("a seat that may not read the list gets the database's own sentence, and can try again", async () => {
    const real = db.rpc;
    db.rpc = async (name: string) =>
      name === "cockpit_csm_calls_read"
        ? { data: null, error: { code: "42501", message: "The call list is for the client success seat." } }
        : real(name);
    try {
      await show(createElement(CallList));
      expect(text()).toContain("The call list is for the client success seat.");
      expect(buttons().some(b => b.textContent.trim() === "Try again")).toBe(true);
      expect(calledButtons()).toHaveLength(0);
    } finally {
      db.rpc = real;
    }
  });
});

describe("the gap report on the client success side", () => {
  const WINDOW = () => model.gapWindow(model.kuwaitToday());

  test("lists the clients most missing first and opens one to its meetings", async () => {
    await show(createElement(GapReport));
    expect(named("cockpit_gap_read")[0].args).toEqual({ p_from: WINDOW().from, p_to: WINDOW().to });
    const expected = fixtures.gapFixture(WINDOW().from, WINDOW().to);
    const rows = Array.from(host.querySelectorAll("li > button[aria-controls]") as ArrayLike<any>);
    expect(rows).toHaveLength(10);
    expect(rows[0].textContent).toContain(expected.rows[0].clientName);
    await click(rows[0]);
    const panel = host.querySelector(`#${rows[0].getAttribute("aria-controls")}`) as any;
    expect(panel.querySelectorAll("a")).toHaveLength(expected.rows[0].noResult);
    expect(named("cockpit_gap_client_read")[0].args.p_location).toBe(expected.rows[0].locationId);
  });

  test("Blank in sheet and Still confirmed are two columns beside the count with no result", async () => {
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
  });
});
