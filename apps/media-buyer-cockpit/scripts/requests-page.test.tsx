/**
 * /requests (docs/requests/CONTRACT.md 6.4) in happy-dom, over the cockpit's
 * own client with the CEO signed in and the requests functions answered by
 * the made-up store in src/dev/requestsHarness.ts: the pills are the views
 * the seat has, each list is one line a request with the most pressing
 * first, a request opens in the shared panel in place with its tasks,
 * owners, links, the 2-minute check and the history, a cancel asks why, an
 * old ClickUp form ticket becomes a routed request, and every empty or
 * failed state says what to do next. Every person, client and id is made
 * up.
 */
import { afterAll, afterEach, describe, expect, test } from "bun:test";

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
  throw new Error("The requests page test makes no network calls.");
}) as typeof fetch;

// --- The cockpit's client: the CEO signed in, the requests store behind rpc.
const { getCockpitSupabaseClient } = await import(
  "../src/auth/SupabaseAuthProvider"
);
const db = getCockpitSupabaseClient() as any;
const real = {
  rpc: db.rpc,
  getSession: db.auth.getSession,
  getUser: db.auth.getUser,
  onAuthStateChange: db.auth.onAuthStateChange,
};
const USER = {
  id: "auth-ceo-test",
  email: "ceo@example.test",
  email_confirmed_at: "2026-10-26T00:00:00Z",
  app_metadata: {},
  user_metadata: {},
};
db.auth.getSession = async () => ({
  data: { session: { access_token: "test-token", user: USER } },
  error: null,
});
db.auth.getUser = async () => ({ data: { user: USER }, error: null });
db.auth.onAuthStateChange = () => ({
  data: { subscription: { unsubscribe: () => {} } },
});

const { createRequestsFake } = await import("../src/dev/requestsHarness");
type Fake = ReturnType<typeof createRequestsFake>;
type Answer = {
  data: unknown;
  error: { message: string; code?: string } | null;
};
const NOW = Date.parse("2026-10-26T08:00:00Z"); // Monday 11:00 in Kuwait
let fake: Fake = createRequestsFake({ seat: "ceo", now: () => NOW });
/** Answers a call before the store does, once per name; null passes it on. */
let before: (name: string, args: any) => Answer | null = () => null;
db.rpc = async (name: string, args: any = {}) => {
  if (name === "cockpit_adopt_member") return { data: true, error: null };
  if (name === "cockpit_get_my_access")
    return {
      data: {
        email: USER.email,
        name: "The CEO",
        is_admin: true,
        is_ceo: true,
        home: "/ceo",
        cockpits: ["csm", "creative", "editor", "sales"],
        roles: [],
        clients: [],
      },
      error: null,
    };
  const first = before(name, args);
  if (first) return first;
  if (fake.handles(name)) return fake.call(name, args);
  return { data: null, error: { message: `No answer for ${name}` } };
};

// --- A DOM. ------------------------------------------------------------------
const { Window } = await import("happy-dom");
const win = new Window({ url: "https://cockpit.test/requests" });
const DOM: string[] = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "HTMLElement",
  "HTMLAnchorElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLSelectElement",
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

const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = await import("react");
const { MemoryRouter } = await import("react-router");
const { SupabaseAuthProvider } = await import(
  "../src/auth/SupabaseAuthProvider"
);
const { RequestsPage } = await import("../src/pages/requests/RequestsPage");
const { useLocation } = await import("react-router");

const container = win.document.createElement("div");
win.document.body.appendChild(container);
const root = createRoot(container as any);

async function flush(times = 6) {
  for (let i = 0; i < times; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
}
/** The form debounces its client search and preview by 250 ms. */
async function settle() {
  await flush(4);
  await act(async () => {
    await new Promise(r => setTimeout(r, 300));
  });
  await flush(6);
}
const text = (el: any) => String(el?.textContent ?? "");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const page = () => text(container);
const dialog = () => win.document.querySelector('[role="dialog"]') as any;
const buttonIn = (scope: any, label: string) =>
  [...(scope ?? container).querySelectorAll("button")].find(
    (b: any) =>
      text(b).trim() === label ||
      (!text(b).trim() && b.getAttribute("aria-label") === label),
  ) as any;
const chips = () =>
  [...container.querySelectorAll("[data-chip]")].map((c: any) =>
    squash(text(c)),
  );
async function click(el: any) {
  expect(el).toBeTruthy();
  await act(async () => {
    el.click();
  });
  await flush(3);
}
async function type(el: any, value: string) {
  expect(el).toBeTruthy();
  const proto =
    el.tagName === "TEXTAREA"
      ? win.HTMLTextAreaElement.prototype
      : win.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new win.Event("input", { bubbles: true }));
  });
  await flush(2);
}
let where = "";
function Where() {
  const l = useLocation();
  where = `${l.pathname}${l.search}`;
  return null;
}
const qs = () => new URLSearchParams(where.split("?")[1] ?? "");

async function render(path = "/requests") {
  await act(async () => {
    root.render(
      h(
        SupabaseAuthProvider,
        null,
        h(MemoryRouter, { initialEntries: [path] }, h(Where), h(RequestsPage)),
      ),
    );
  });
  await settle();
}
const rows = () =>
  [
    ...container.querySelectorAll('ul[aria-label="Requests"] > li > button'),
  ] as any[];
const rowWith = (words: string) => rows().find(r => text(r).includes(words));

afterEach(async () => {
  await act(async () => root.render(null));
  await flush(2);
  fake = createRequestsFake({ seat: "ceo", now: () => NOW });
  before = () => null;
});

afterAll(async () => {
  await act(async () => root.unmount());
  globalThis.fetch = realFetch;
  console.error = realError;
  db.rpc = real.rpc;
  db.auth.getSession = real.getSession;
  db.auth.getUser = real.getUser;
  db.auth.onAuthStateChange = real.onAuthStateChange;
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

describe("/requests", () => {
  test("opens on Ask a team, with the views the seat has as pills", async () => {
    await render();
    expect(container.querySelector("h1")?.textContent).toBe("Requests");
    expect(page()).toContain(
      "Ask another team for something. It becomes a ClickUp task with its SOP steps and an owner.",
    );
    expect(chips()).toEqual([
      "Ask a team",
      "My requests4",
      "Assigned to me1",
      "Team queue6",
      "All requests7",
    ]);
    expect(page()).toContain("What do you need?");
    const settings = [...container.querySelectorAll("a")].find(
      (a: any) => text(a) === "Settings",
    ) as any;
    expect(settings?.getAttribute("href")).toBe("/requests/settings");
  });

  test("My requests: one line a request, the most pressing first", async () => {
    await render("/requests?view=mine");
    const lines = rows().map(r => squash(text(r)));
    expect(lines.length).toBe(4);
    // Open first, by due day (today's pause before tomorrow's tech request),
    // the done one last.
    expect(lines[0]).toContain("Client pause");
    expect(lines[0]).toContain("Harbour Interiors");
    expect(lines[0]).toContain("Today");
    expect(lines[1]).toContain("General tech request");
    expect(lines[1]).toContain("No client");
    expect(lines[1]).toContain("Tomorrow");
    expect(lines[3]).toContain("WhatsApp connection issue");
    expect(lines[3]).toContain("Done");
    // The two-task pause shows one chip for both.
    expect(rows()[0].querySelectorAll(".rounded-full.border").length).toBe(1);
    // A press opens the request in place.
    await click(rows()[0]);
    await flush(4);
    expect(qs().get("id")).toBeTruthy();
    expect(qs().get("view")).toBe("mine");
    expect(dialog()).toBeTruthy();
  });

  test("the panel: what was asked, each task with its owner, link and check, the history", async () => {
    await render("/requests?view=mine");
    await click(rowWith("Client pause"));
    await flush(4);
    const d = dialog();
    const all = squash(text(d));
    expect(all).toContain("Client pause");
    expect(all).toContain("Harbour Interiors · from the CEO");
    expect(all).toContain("The 2 ClickUp tasks");
    expect(all).toContain("Operations / Tech");
    expect(all).toContain("Marketing / ADs");
    expect(all).toContain("Harbour Interiors - Client pause (Tech)");
    expect(all).toContain(
      "In ClickUp: in progress. Owner: the systems manager.",
    );
    expect(all).toContain(
      "No media buyer of record is set, so the systems manager gets it. Set one in Requests settings.",
    );
    expect(all).toContain(
      "A ClickUp rule removed the owner; the cockpit put them back.",
    );
    expect(all).toContain("Sent from the cockpit by the CEO");
    const links = [...d.querySelectorAll("a")].filter(
      (a: any) => text(a) === "Open in ClickUp",
    ) as any[];
    expect(links.map(a => a.getAttribute("href"))).toEqual([
      "https://app.clickup.com/t/86harn001",
      "https://app.clickup.com/t/86harn002",
    ]);
    // Part of it is in ClickUp, so it cannot be cancelled here.
    expect(buttonIn(d, "Cancel request")).toBeUndefined();
    await click(buttonIn(d, "Close"));
    expect(dialog()).toBeNull();
    expect(qs().get("id")).toBeNull();
  });

  test("cancelling asks why, then the request reads Cancelled", async () => {
    await render("/requests?view=mine");
    await click(rowWith("General tech request"));
    await flush(4);
    await click(buttonIn(dialog(), "Cancel request"));
    // The reason box, then its own Cancel request.
    const confirm = () =>
      [...dialog().querySelectorAll("section button")].find(
        (b: any) => text(b).trim() === "Cancel request",
      ) as any;
    await click(confirm());
    expect(text(dialog())).toContain(
      "Say why it is cancelled, in a few words.",
    );
    expect(fake.calls.some(c => c.name === "cockpit_request_cancel")).toBe(
      false,
    );
    await type(dialog().querySelector("textarea"), "Fixed it myself");
    await click(confirm());
    await flush(4);
    const call = fake.calls.find(c => c.name === "cockpit_request_cancel");
    expect(call?.args.p_reason).toBe("Fixed it myself");
    expect(squash(text(dialog()))).toContain(
      "Cancelled: Fixed it myself by the CEO",
    );
    expect(buttonIn(dialog(), "Cancel request")).toBeUndefined();
    // The list behind reads it again.
    await click(buttonIn(dialog(), "Close"));
    expect(squash(text(rowWith("General tech request")))).toContain(
      "Cancelled",
    );
  });

  test("an old form ticket in the team queue becomes a request, routed", async () => {
    await render("/requests?view=team");
    const old = rowWith("General CSM ticket");
    expect(squash(text(old))).toContain("Old form");
    await click(old);
    await flush(4);
    expect(squash(text(dialog()))).toContain(
      "Came in through the old ClickUp form. Make it a request to route it.",
    );
    await click(buttonIn(dialog(), "Make it a request"));
    await settle();
    expect(dialog()).toBeNull();
    expect(qs().get("view")).toBeNull();
    expect(page()).toContain("Routing a ticket from the old ClickUp form.");
    expect(page()).toContain("Nour Design Studio");
    const details = container.querySelector('[data-field="details"]') as any;
    expect(details.value).toBe(
      "Client asked for a call about their invoice and the new campaign start date.",
    );
    await click(buttonIn(container, "Send request"));
    await flush(4);
    const sent = fake.calls.find(c => c.name === "cockpit_request_submit");
    expect(sent?.args.p_type_key).toBe("general_csm");
    expect(sent?.args.p_client_task_id).toBe("86harb005");
    expect(sent?.args.p_replaces_task_id).toBe("z8xharn01");
    expect(
      fake.requests.find(r => r.importedTaskId === "z8xharn01")?.state,
    ).toBe("routed");
    expect(page()).toContain("Sent to Client Success. Owner: the CSM.");
  });

  test("a seat that is not linked sees why Assigned to me is empty", async () => {
    fake = createRequestsFake({ seat: "sales", now: () => NOW });
    await render("/requests?view=assigned");
    // Not linked: Assigned to me has no count, and there is no team queue.
    expect(chips()).toEqual(["Ask a team", "My requests4", "Assigned to me"]);
    expect(page()).toContain(
      "Your seat is not linked to a ClickUp user, so requests assigned to you cannot show. Ask the systems manager to link it.",
    );
    expect(page()).toContain("Nothing is assigned to you");
  });

  test("a failed read says so and offers to try again", async () => {
    before = name =>
      name === "cockpit_requests_read"
        ? {
            data: null,
            error: { message: "canceling statement due to statement timeout" },
          }
        : null;
    await render("/requests?view=all");
    expect(page()).toContain("canceling statement due to statement timeout");
    before = () => null;
    await click(buttonIn(container, "Try again"));
    await flush(4);
    expect(rows().length).toBe(7);
  });

  test("before the functions are on the database, the page says what to use", async () => {
    before = name =>
      fake.handles(name)
        ? {
            data: null,
            error: { message: "Could not find the function", code: "PGRST202" },
          }
        : null;
    await render("/requests?view=mine");
    expect(page()).toContain(
      "Requests are not on the database yet. Use the ClickUp request form until they are.",
    );
  });
});
