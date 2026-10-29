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
import {
  afterAll,
  afterEach,
  describe,
  expect,
  setDefaultTimeout,
  setSystemTime,
  test,
} from "bun:test";

// These screens run on real timers (the form's 250 ms debounce, the 3 s and
// 5 s re-reads), in one process with the database suites as ship.sh runs
// them, on a laptop several sessions share. A test that waits longer than
// bun's 5 s default under that load is slow, not wrong: it may take 20 s.
setDefaultTimeout(20_000);

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
// The page reads today from the clock and the store from NOW: the same
// day for both, whatever the hour the tests run (after 21:00 UTC it is
// already tomorrow in Kuwait).
setSystemTime(new Date(NOW));
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
const { REQUEST_SENTENCES } = await import("../src/lib/requestsCore");
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
const rowsWith = (words: string) => rows().filter(r => text(r).includes(words));

/**
 * One task of a stored request refused for good at create while the others
 * landed: the request reads "partial", as cockpit_request_refresh says.
 */
function partial(r: Fake["requests"][number], part: string, error: string) {
  let n = 50;
  for (const p of r.parts) {
    if (p.part === part) {
      p.state = "failed";
      p.error = error;
      p.url = null;
      p.status = null;
      p.statusType = null;
    } else {
      p.state = "delivered";
      p.error = null;
      p.url = `https://app.clickup.com/t/86harp${String(n++).padStart(3, "0")}`;
      p.status = p.status ?? "to do";
      p.statusType = p.statusType ?? "open";
    }
  }
  r.state = "partial";
  r.done = false;
}

afterEach(async () => {
  await act(async () => root.render(null));
  await flush(2);
  fake = createRequestsFake({ seat: "ceo", now: () => NOW });
  before = () => null;
});

afterAll(async () => {
  await act(async () => root.unmount());
  setSystemTime();
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
    // Each task's chip names its status; the words beside it do not repeat
    // it (DESIGN.md, say a thing once).
    expect(all).toContain("Owner: the systems manager.");
    expect(all).not.toContain("In ClickUp: in progress");
    // The database's stored note, as an editor (the CEO) reads it.
    expect(all).toContain(
      "No media buyer of record is named on this request type, so the systems manager gets it. Set one in Requests settings.",
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
    // Focus moves to the reason box, inside the dialog (D15).
    expect(win.document.activeElement?.tagName).toBe("TEXTAREA");
    expect(dialog().contains(win.document.activeElement)).toBe(true);
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
    // On its way: not "in" the list before ClickUp has it (F4).
    expect(page()).toContain("Sending to Client Success.");
    expect(page()).not.toContain("Sent to");
  });

  test("a seat that is not linked sees why Assigned to me cannot show, never that nothing is assigned", async () => {
    fake = createRequestsFake({ seat: "sales", now: () => NOW });
    await render("/requests?view=assigned");
    // Not linked: Assigned to me has no count, and there is no team queue.
    expect(chips()).toEqual(["Ask a team", "My requests4", "Assigned to me"]);
    expect(page()).toContain(
      "Your seat is not linked to a ClickUp user, so requests assigned to you cannot show. Ask the systems manager to link it.",
    );
    // Missing is never zero (R11): the note is the view's state, with no
    // "nothing is assigned" under it.
    expect(page()).not.toContain("Nothing is assigned to you");
    expect(page()).not.toContain("Requests whose ClickUp task has your name");
  });

  test("a seat with no team that opens the team queue is told why, never an empty queue", async () => {
    fake = createRequestsFake({ seat: "sales", now: () => NOW });
    await render("/requests?view=team");
    expect(page()).toContain(
      "Your seat has no team queue. Use My requests to see what you asked for.",
    );
    expect(page()).not.toContain("Nothing is waiting in this queue");
  });

  test("on a phone a row shows the whole type and status: the type and due word first, the chip under them", async () => {
    // happy-dom lays nothing out, so this reads the row's grid: one line
    // from sm, two below it, with the type wrapping rather than cut there.
    await render("/requests?view=assigned");
    const row = rowWith("Create a landing page");
    const cls = (cell: string) =>
      String(row.querySelector(`[data-cell="${cell}"]`)?.className ?? "").split(
        /\s+/,
      );
    expect(String(row.className)).toContain("grid-cols-[minmax(0,1fr)_auto]");
    expect(String(row.className)).toContain(
      "sm:grid-cols-[8.25rem_minmax(0,1.2fr)_minmax(0,1fr)_6.5rem]",
    );
    expect(cls("type")).toEqual(
      expect.arrayContaining([
        "col-start-1",
        "row-start-1",
        "sm:col-start-2",
        "sm:truncate",
      ]),
    );
    expect(cls("type")).not.toContain("truncate");
    expect(cls("state")).toEqual(
      expect.arrayContaining(["col-start-1", "row-start-2", "sm:row-start-1"]),
    );
    expect(cls("due")).toEqual(
      expect.arrayContaining(["col-start-2", "row-start-1", "sm:col-start-4"]),
    );
    // The chip keeps the whole ClickUp status, with room for it, and on a
    // phone the client follows it (its own column from sm).
    const state = row.querySelector('[data-cell="state"]');
    expect(squash(text(state))).toContain("Review required");
    const phoneClient = state.querySelector("bdi");
    expect(text(phoneClient)).toBe("Palm Fit Out");
    expect(String(phoneClient.className).split(/\s+/)).toContain("sm:hidden");
  });

  test("the panel says each state once: a status by its chip, a reason once, an old ticket's next step once", async () => {
    // One task in ClickUp: the chip names its status; no "In ClickUp: …".
    await render("/requests?view=assigned");
    await click(rowWith("Create a landing page"));
    await flush(4);
    let all = squash(text(dialog()));
    expect(all).toContain("Review required");
    expect(all.toLowerCase().split("review required").length).toBe(2);
    expect(all).not.toContain("In ClickUp: review required");
    await click(buttonIn(dialog(), "Close"));
    // Two tasks: "In ClickUp" above, each task's own chip, each status once.
    await click(container.querySelector('[data-chip="mine"]'));
    await flush(4);
    await click(rowWith("Client pause"));
    await flush(4);
    all = squash(text(dialog())).toLowerCase();
    expect(all.split("in progress").length).toBe(2);
    expect(all.split("to do").length).toBe(2);
  });

  test("a held request's when-it-goes is said once, a request on its way says Sending once", async () => {
    await render("/requests?view=mine");
    await click(rowWith("New script"));
    await flush(4);
    let all = squash(text(dialog()));
    expect(all.split("It goes to ClickUp when requests open").length).toBe(2);
    await click(buttonIn(dialog(), "Close"));
    await click(rowWith("General tech request"));
    await flush(4);
    all = squash(text(dialog()));
    expect(all).toContain("Sending");
    expect(all).not.toContain("Sending to ClickUp");
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
    // Plain words and what to do, never the database's own text (D5).
    expect(page()).toContain(
      "The database took too long to answer. Try again in a minute.",
    );
    expect(page()).not.toContain("canceling statement");
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

  test("status chips take their colours from the page's ceo-root, in the panel too (D1)", async () => {
    await render("/requests?view=mine");
    // StatusChip: a rounded-full bordered chip whose icon is coloured by
    // var(--ceo-*), which only a .ceo-root ancestor defines.
    const coloured = () =>
      [
        ...win.document.querySelectorAll("span.rounded-full.border > svg"),
      ] as any[];
    expect(coloured().length).toBeGreaterThan(0);
    for (const icon of coloured())
      expect(icon.closest(".ceo-root")).toBeTruthy();
    await click(rowWith("Client pause"));
    await flush(4);
    const inPanel = coloured().filter(i => dialog().contains(i));
    expect(inPanel.length).toBeGreaterThan(0);
    for (const icon of inPanel) expect(icon.closest(".ceo-root")).toBeTruthy();
  });

  test("the pill row keeps its own space above the card (D4)", async () => {
    await render("/requests?view=mine");
    const pills = container.querySelector(
      '[role="group"][aria-label="Requests"]',
    ) as any;
    // The row sits in its own wrapper: the page's space-y-6 margin lands
    // on the wrapper, which the row's -my-1 cannot cancel.
    expect(pills).toBeTruthy();
    expect(pills.parentElement?.className ?? "").not.toContain("space-y-6");
    expect(pills.parentElement?.parentElement?.className).toContain(
      "space-y-6",
    );
  });

  test("a request that did not reach ClickUp says why once and offers the next step (D2)", async () => {
    await render("/requests?view=all");
    await click(rowWith("Card missing for ads"));
    await flush(4);
    const d = dialog();
    const all = squash(text(d));
    const reason = "ClickUp refused the task: the list is full";
    expect(all.split(reason).length).toBe(2); // said once
    expect(all.split("Not sent").length).toBe(2); // one chip
    expect(all).toContain(
      "Nothing reached ClickUp. File it again with the same answers, or use the ClickUp request form.",
    );
    expect(all).toContain("If it fails again, tell the systems manager.");
    const form = [...d.querySelectorAll("a")].find((a: any) =>
      text(a).includes("Open the ClickUp request form"),
    ) as any;
    expect(form?.getAttribute("href")).toContain("forms.clickup.com");
    // File it again: the form, prefilled with its type and client.
    await click(buttonIn(d, "File it again"));
    await settle();
    expect(dialog()).toBeNull();
    expect(page()).toContain(
      "Filing again a request that did not reach ClickUp. Check the answers, then send. Sending it cancels the first one.",
    );
    expect(page()).not.toContain("Routing a ticket from the old ClickUp form.");
    expect(page()).toContain("Card missing for ads");
    expect(page()).toContain("Dune Build Co");
    await click(buttonIn(container, "Send request"));
    await flush(6);
    const sent = fake.calls.find(c => c.name === "cockpit_request_submit");
    expect(sent?.args.p_type_key).toBe("card_missing");
    expect(sent?.args.p_client_task_id).toBe("86harb002");
    expect(sent?.args.p_replaces_task_id).toBeNull();
  });

  test("a request filed again replaces the first one, so the queue holds it once", async () => {
    await render("/requests?view=team");
    const before = rowsWith("Card missing for ads");
    expect(before).toHaveLength(1);
    const firstId = fake.requests.find(r => r.typeKey === "card_missing")?.id;
    await click(before[0]);
    await flush(4);
    await click(buttonIn(dialog(), "File it again"));
    await settle();
    await click(buttonIn(container, "Send request"));
    await flush(8);
    // Once the new request is in, the first one is cancelled with a reason
    // its history shows; the original is not left as a dead late row.
    const cancel = fake.calls.find(c => c.name === "cockpit_request_cancel");
    expect(cancel?.args).toEqual({
      p_request_id: firstId,
      p_reason: "Filed again as a new request.",
    });
    const first = fake.requests.find(r => r.id === firstId);
    expect(first?.state).toBe("cancelled");
    expect(first?.history.at(-1)?.what).toBe(
      "Cancelled: Filed again as a new request.",
    );
    await click(container.querySelector('[data-chip="team"]'));
    await flush(6);
    const after = rowsWith("Card missing for ads");
    expect(after).toHaveLength(1);
    expect(squash(text(after[0]))).not.toContain("Not sent");
  });

  test("a seat that may not cancel the first one is told it stays, and nothing is cancelled", async () => {
    // The CSM files again a request the CEO raised: cancel is the CEO's,
    // an editor's or the systems manager's (cockpit_request_cancellable).
    fake = createRequestsFake({ seat: "csm", now: () => NOW });
    const card = fake.requests.find(r => r.typeKey === "card_missing");
    if (!card) throw new Error("No card_missing request in the harness");
    card.requesterId = "m-ceo";
    card.requesterLabel = "the CEO";
    await render("/requests?view=team");
    await click(rowWith("Card missing for ads"));
    await flush(4);
    await click(buttonIn(dialog(), "File it again"));
    await settle();
    expect(page()).toContain(
      "The first one stays in the queue until the person who asked for it or the systems manager cancels it.",
    );
    await click(buttonIn(container, "Send request"));
    await flush(8);
    expect(fake.calls.some(c => c.name === "cockpit_request_submit")).toBe(
      true,
    );
    expect(fake.calls.some(c => c.name === "cockpit_request_cancel")).toBe(
      false,
    );
  });

  /** A general CSM request that routed the harness's old form ticket and did not reach ClickUp. */
  function failedRouting(id: string, error: string) {
    const filed = fake.call("cockpit_request_submit", {
      p_request_id: id,
      p_type_key: "general_csm",
      p_client_task_id: "86harb005",
      p_answers: { details: "Call the client about the invoice." },
      p_due_on: null,
      p_priority: null,
      p_source: "requests_page",
      p_replaces_task_id: "z8xharn01",
    });
    expect(filed.error).toBeNull();
    const r = fake.requests.find(x => x.id === id);
    const old = fake.requests.find(x => x.importedTaskId === "z8xharn01");
    if (!r || !old) throw new Error("The routing request was not filed");
    expect(old.state).toBe("routed");
    r.parts[0].state = error.startsWith("The old ticket")
      ? "skipped"
      : "failed";
    r.parts[0].error = error;
    r.state = "failed";
    return { r, old };
  }

  test("a routing request filed again routes its old ticket again; once routed meanwhile, it goes on its own (retest round 2)", async () => {
    // The database put the old ticket back in its queue when the first one failed.
    const first = failedRouting(
      "0000c0c0-0000-4000-8000-000000000001",
      "ClickUp refused the task: the list is full",
    );
    first.old.state = "imported";
    first.old.routedTo = null;
    await render(`/requests?view=mine&id=${first.r.id}`);
    await flush(4);
    await click(buttonIn(dialog(), "File it again"));
    await settle();
    expect(squash(page())).toContain(
      "It routes the same old ClickUp form ticket, unless someone routed it meanwhile.",
    );
    await click(buttonIn(container, "Send request"));
    await flush(8);
    const sent = fake.calls
      .filter(c => c.name === "cockpit_request_submit")
      .at(-1);
    expect(sent?.args.p_replaces_task_id).toBe("z8xharn01");
    expect(first.old).toMatchObject({
      state: "routed",
      routedTo: sent?.args.p_request_id,
    });

    // The CSM files again one the CEO raised, and its old ticket is still routed: the form sends it on its own.
    await act(async () => root.render(null));
    await flush(2);
    fake = createRequestsFake({ seat: "csm", now: () => NOW });
    const second = failedRouting(
      "0000c0c0-0000-4000-8000-000000000002",
      "ClickUp refused the task: the list is full",
    );
    second.r.requesterId = "m-ceo";
    second.r.requesterLabel = "the CEO";
    await render(`/requests?view=team&id=${second.r.id}`);
    await flush(4);
    await click(buttonIn(dialog(), "File it again"));
    await settle();
    await click(buttonIn(container, "Send request"));
    await flush(8);
    const tries = fake.calls
      .filter(c => c.name === "cockpit_request_submit")
      .slice(-2);
    expect(tries.map(c => c.args.p_replaces_task_id)).toEqual([
      "z8xharn01",
      null,
    ]);
    expect(tries[0].args.p_request_id).toBe(tries[1].args.p_request_id);
    // Tickets-look-1028: the sent view is the one voice for the event (focus
    // moves to its heading, no toast), so the sentence is said there.
    expect(text(container.querySelector(".rq-sent"))).toContain(
      "Request sent. Its old ClickUp form ticket was already routed, so this one goes on its own.",
    );
    expect(second.old).toMatchObject({
      state: "routed",
      routedTo: second.r.id,
    });
  });

  test("routing an old ticket a teammate routed first is refused, never sent twice (retest round 2)", async () => {
    const old = fake.requests.find(x => x.importedTaskId === "z8xharn01");
    if (!old) throw new Error("No old ticket in the harness");
    await render(`/requests?view=team&id=${old.id}`);
    await flush(4);
    await click(buttonIn(dialog(), "Make it a request"));
    await settle();
    old.state = "routed";
    await click(buttonIn(container, "Send request"));
    await flush(8);
    expect(
      fake.calls
        .filter(c => c.name === "cockpit_request_submit")
        .map(c => c.args.p_replaces_task_id),
    ).toEqual(["z8xharn01"]);
    expect(page()).toContain("That old ticket was already routed.");
  });

  test("a routing request that made nothing because the old ticket was handled in ClickUp points to the ticket, never File it again (retest round 2)", async () => {
    const { r } = failedRouting(
      "0000c0c0-0000-4000-8000-000000000003",
      "The old ticket was already moved or closed in ClickUp, so no new task was made. Check it there.",
    );
    await render(`/requests?view=mine&id=${r.id}`);
    await flush(4);
    const d = dialog();
    expect(squash(text(d))).toContain(
      "The old ClickUp form ticket was moved or closed in ClickUp while this request waited, so no task was made. Check the old ticket, and ask again only if the work is still needed.",
    );
    expect(buttonIn(d, "File it again")).toBeUndefined();
    const link = [...d.querySelectorAll("a")].find((a: any) =>
      text(a).includes("Open the old ticket in ClickUp"),
    ) as any;
    expect(link?.getAttribute("href")).toBe(
      "https://app.clickup.com/t/z8xharn01",
    );
  });

  test("part of a request in ClickUp: the missing task is named, and it is never filed again whole", async () => {
    // A Both low schedule rate: the Call Center task landed, the Ads task
    // was refused for good. Filing the request again would make a second
    // Call Center task, so the panel offers the missing task only.
    const filed = fake.call("cockpit_request_submit", {
      p_request_id: "0000b0b0-0000-4000-8000-000000000001",
      p_type_key: "low_schedule_rate",
      p_client_task_id: "86harb002",
      p_answers: {
        schedule_rate_issue: "0014e47b-560a-4109-830c-77d6d60d985c",
      },
      p_due_on: null,
      p_priority: null,
      p_source: "requests_page",
    });
    expect(filed.error).toBeNull();
    const r = fake.requests.find(x => x.typeKey === "low_schedule_rate");
    if (!r) throw new Error("The Both request was not filed");
    expect(r.parts.map(p => p.part)).toEqual(["call_center", "ads"]);
    partial(r, "ads", "ClickUp refused the task: the template is gone");
    await render("/requests?view=mine");
    await click(rowWith("Low schedule rate"));
    await flush(4);
    const d = dialog();
    const all = squash(text(d));
    expect(all).toContain(
      "The Marketing / ADs task did not reach ClickUp; the one that did stays there. Raise the missing task with the ClickUp request form, or ask the systems manager to make it.",
    );
    expect(buttonIn(d, "File it again")).toBeUndefined();
    expect(all).not.toContain("File the rest again");
    const form = [...d.querySelectorAll("a")].find((a: any) =>
      text(a).includes("Open the ClickUp request form"),
    ) as any;
    expect(form?.getAttribute("href")).toContain("forms.clickup.com");
    // The reason is said once, on the task that did not go.
    expect(
      all.split("ClickUp refused the task: the template is gone").length,
    ).toBe(2);
  });

  test("a partial pause never loops back to itself, and keeps its next step once its task is done", async () => {
    // The lifecycle duplicate rule counts a partial pause as open, so
    // "File it again" would only ever answer "Open it instead" for itself.
    const pause = fake.requests.find(r => r.typeKey === "client_pause");
    if (!pause) throw new Error("No pause in the harness");
    partial(pause, "media", "ClickUp refused the task: the list is full");
    await render("/requests?view=mine");
    await click(rowWith("Client pause"));
    await flush(4);
    expect(buttonIn(dialog(), "File it again")).toBeUndefined();
    expect(squash(text(dialog()))).toContain(
      "The Marketing / ADs task did not reach ClickUp; the one that did stays there.",
    );
    await click(buttonIn(dialog(), "Close"));
    // The Tech task is done in ClickUp: the request reads done, but the
    // Media task still never went, so the panel still says so.
    pause.parts[0].statusType = "done";
    pause.parts[0].status = "complete";
    pause.done = true;
    await click(rowWith("Client pause"));
    await flush(4);
    expect(squash(text(dialog()))).toContain(
      "The Marketing / ADs task did not reach ClickUp",
    );
    expect(fake.calls.some(c => c.name === "cockpit_request_submit")).toBe(
      false,
    );
  });

  test("an old form ticket a seat cannot route says to route it in ClickUp", async () => {
    // Before requests open, only an editor, an admin or the CEO may make an
    // old ticket a request (the send gate behind canRoute).
    fake = createRequestsFake({ seat: "csm", mode: "dry_run", now: () => NOW });
    await render("/requests?view=team");
    const old = rowWith("General CSM ticket");
    expect(old?.getAttribute("title")).toBe(
      "Came in through the old ClickUp form. Route it in ClickUp.",
    );
    await click(old);
    await flush(4);
    const d = dialog();
    const all = squash(text(d));
    expect(all).toContain(
      "Came in through the old ClickUp form. Route it in ClickUp.",
    );
    expect(all).not.toContain("Make it a request to route it");
    expect(buttonIn(d, "Make it a request")).toBeUndefined();
    const link = [...d.querySelectorAll("a")].find(
      (a: any) => text(a) === "Open in ClickUp",
    ) as any;
    expect(link?.getAttribute("href")).toBe(
      "https://app.clickup.com/t/z8xharn01",
    );
  });

  test("an old form ticket moved or closed in ClickUp leaves the team queue, says so, and offers no route (review round 3)", async () => {
    const old = fake.requests.find(r => r.importedTaskId === "z8xharn01");
    if (!old) throw new Error("no old ticket");
    old.importHandled = true;
    await render("/requests?view=team");
    expect(rowWith("General CSM ticket")).toBeUndefined();
    await click(container.querySelector('[data-chip="all"]'));
    await flush(4);
    const row = rowWith("General CSM ticket");
    expect(row?.getAttribute("title")).toBe(REQUEST_SENTENCES.importHandled);
    await click(row);
    await flush(4);
    const d = dialog();
    const all = squash(text(d));
    expect(all).toContain(
      "Came in through the old ClickUp form. It was moved or closed in ClickUp, so it needs no routing here.",
    );
    expect(all).not.toContain("Route it in ClickUp");
    expect(buttonIn(d, "Make it a request")).toBeUndefined();
  });

  test("a request whose task was deleted in ClickUp says so above File it again, never that nothing reached ClickUp (review round 3)", async () => {
    const card = fake.requests.find(r => r.typeKey === "card_missing");
    if (!card) throw new Error("no card request");
    card.parts[0].state = "failed";
    card.parts[0].url = "https://app.clickup.com/t/86harx001";
    card.parts[0].error =
      "The task is no longer in ClickUp, so the cockpit stopped. Raise the request again if it is still needed.";
    card.state = "failed";
    await render(`/requests?view=all&id=${card.id}`);
    await flush(4);
    const d = dialog();
    const all = squash(text(d));
    expect(all).toContain(
      "The task was deleted in ClickUp. File it again with the same answers, or use the ClickUp request form.",
    );
    expect(all).not.toContain("Nothing reached ClickUp");
    expect(buttonIn(d, "File it again")).toBeTruthy();
  });

  test("a part whose create may have reached ClickUp cannot be cancelled, and a held one says it is checked first (review round 3)", async () => {
    fake = createRequestsFake({ seat: "ceo", mode: "dry_run", now: () => NOW });
    const script = fake.requests.find(r => r.typeKey === "new_script");
    if (!script) throw new Error("no held request");
    // The create went out and its answer was lost; the writer handed it back while requests are not open.
    script.parts[0].createSent = true;
    fake.advance();
    expect(script.parts[0].state).toBe("unknown");
    await render(`/requests?view=mine&id=${script.id}`);
    await flush(4);
    const d = dialog();
    expect(buttonIn(d, "Cancel request")).toBeUndefined();
    const all = squash(text(d));
    expect(all).toContain(
      "ClickUp did not answer. The cockpit checks whether it arrived once requests open",
    );
    expect(all).not.toContain("CLICKUP_WRITEBACK_APPLY_REQUESTS");
    expect(all).not.toContain("Waiting in the queue");
  });

  test("a held request reads in the database's words when it sends them, said once (review round 3)", async () => {
    fake = createRequestsFake({ seat: "ceo", mode: "dry_run", now: () => NOW });
    const filed = fake.call("cockpit_request_submit", {
      p_request_id: "0000d0d0-0000-4000-8000-000000000001",
      p_type_key: "general_tech",
      p_client_task_id: "86harb002",
      p_answers: { details: "Check the lead form." },
      p_due_on: null,
      p_priority: null,
      p_source: "requests_page",
    });
    expect(filed.error).toBeNull();
    await render("/requests?view=mine&id=0000d0d0-0000-4000-8000-000000000001");
    await flush(4);
    const all = squash(text(dialog()));
    expect(
      all.split("Saved, not sent yet. It goes to ClickUp once requests open")
        .length,
    ).toBe(2);
    expect(all).not.toContain("It goes to ClickUp when requests open");
  });

  test("a row whose task the cockpit could not finish shows it in the list, not only in its panel", async () => {
    await render("/requests?view=assigned");
    const lp = rowWith("Create a landing page");
    const note =
      "The SOP steps did not save as a checklist in ClickUp. Add them on the task there.";
    // The chip keeps the ClickUp status, in the warning tone.
    expect(squash(text(lp))).toContain("Review required");
    expect(lp.querySelector("svg.lucide-triangle-alert")).toBeTruthy();
    expect(lp.getAttribute("title")).toBe(
      `In ClickUp: review required. ${note}`,
    );
    expect(squash(text(lp))).toContain(`Not finished: ${note}`);
  });

  test("a link to the last view lands with its pill in sight once the views arrive", async () => {
    // happy-dom lays nothing out: each pill is 110px wide in a 358px row,
    // as on a 390px phone, so the row scrolls when it overflows.
    const proto = win.HTMLElement.prototype as any;
    const saved = {
      sw: Object.getOwnPropertyDescriptor(proto, "scrollWidth"),
      cw: Object.getOwnPropertyDescriptor(proto, "clientWidth"),
      rect: Object.getOwnPropertyDescriptor(proto, "getBoundingClientRect"),
    };
    const chipsIn = (el: any) => [...el.querySelectorAll("[data-chip]")];
    Object.defineProperty(proto, "scrollWidth", {
      configurable: true,
      get() {
        return this.getAttribute?.("role") === "group"
          ? chipsIn(this).length * 110
          : 0;
      },
    });
    Object.defineProperty(proto, "clientWidth", {
      configurable: true,
      get() {
        return this.getAttribute?.("role") === "group" ? 358 : 0;
      },
    });
    proto.getBoundingClientRect = function (this: any) {
      if (this.getAttribute?.("role") === "group")
        return {
          left: 0,
          right: 358,
          top: 0,
          bottom: 32,
          width: 358,
          height: 32,
        };
      const row = this.closest?.('[role="group"]');
      if (row && this.dataset?.chip) {
        const i = chipsIn(row).indexOf(this);
        const left = i * 110 - (row.scrollLeft ?? 0);
        return {
          left,
          right: left + 100,
          top: 0,
          bottom: 32,
          width: 100,
          height: 32,
        };
      }
      return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
    };
    try {
      await render("/requests?view=all");
      const row = container.querySelector(
        '[role="group"][aria-label="Requests"]',
      ) as any;
      expect(chipsIn(row).length).toBe(5);
      expect(row.scrollLeft).toBeGreaterThan(0);
      const active = row.querySelector('[data-chip="all"]');
      const box = active.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(358);
    } finally {
      if (saved.sw) Object.defineProperty(proto, "scrollWidth", saved.sw);
      else delete proto.scrollWidth;
      if (saved.cw) Object.defineProperty(proto, "clientWidth", saved.cw);
      else delete proto.clientWidth;
      if (saved.rect)
        Object.defineProperty(proto, "getBoundingClientRect", saved.rect);
      else delete proto.getBoundingClientRect;
    }
  });

  test("a held request reads as saved, never as sending (F4)", async () => {
    await render("/requests?view=mine");
    const held = rowWith("New script");
    expect(squash(text(held))).toContain("Saved");
    await click(held);
    await flush(4);
    const all = squash(text(dialog()));
    expect(all).toContain("Saved. It goes to ClickUp when requests open");
    expect(all).not.toContain("Sending to ClickUp");
    expect(all).not.toContain("Waiting in the queue");
    expect(all).not.toContain("CLICKUP_WRITEBACK_APPLY_REQUESTS");
  });

  test("a task in ClickUp with a refused step shows a quiet note, not a failure", async () => {
    await render("/requests?view=assigned");
    await click(rowWith("Create a landing page"));
    await flush(4);
    const d = dialog();
    const all = squash(text(d));
    expect(all).toContain(
      "The SOP steps did not save as a checklist in ClickUp. Add them on the task there.",
    );
    expect(all).not.toContain("Not sent");
    expect(
      d.querySelector('[role="img"][aria-label="Not finished"]'),
    ).toBeTruthy();
  });

  test("an old ticket whose check found it handled says so once, in the next step", async () => {
    const { r } = failedRouting(
      "0000c0c0-0000-4000-8000-000000000004",
      "The old ticket was already moved or closed in ClickUp, so no new task was made. Check it there.",
    );
    await render(`/requests?view=mine&id=${r.id}`);
    await flush(4);
    const all = squash(text(dialog()));
    expect(all.split("Not sent").length).toBe(2); // the chip
    expect(all).toContain("so no task was made"); // the next step
    expect(all).not.toContain("so no new task was made"); // not the task again
  });

  test("File it again keeps the priority and due day the person picked, not the type's defaults", async () => {
    // Card missing defaults to High, due in one working day (Tue 27 Oct).
    const card = fake.requests.find(r => r.typeKey === "card_missing");
    if (!card) throw new Error("No card_missing request in the harness");
    card.priority = "urgent";
    card.dueOn = "2026-10-29";
    await render(`/requests?view=all&id=${card.id}`);
    await flush(4);
    await click(buttonIn(dialog(), "File it again"));
    await settle();
    expect(
      (container.querySelector('[data-field="priority"]') as any).value,
    ).toBe("urgent");
    expect((container.querySelector('input[type="date"]') as any).value).toBe(
      "2026-10-29",
    );
    await click(buttonIn(container, "Send request"));
    await flush(6);
    const sent = fake.calls.find(c => c.name === "cockpit_request_submit");
    expect(sent?.args.p_priority).toBe("urgent");
    expect(sent?.args.p_due_on).toBe("2026-10-29");
  });

  test("File it again on a request whose due day has passed starts on the type's due day", async () => {
    // The harness's card request was due two days ago: the server would
    // refuse that day, so the form starts on the default and keeps the priority.
    await render("/requests?view=all");
    await click(rowWith("Card missing for ads"));
    await flush(4);
    await click(buttonIn(dialog(), "File it again"));
    await settle();
    expect((container.querySelector('input[type="date"]') as any).value).toBe(
      "2026-10-27",
    );
    expect(
      (container.querySelector('[data-field="priority"]') as any).value,
    ).toBe("high");
  });

  test("Make it a request on a type that is turned off says so, and keeps the old ticket's words for the type picked", async () => {
    const csm = fake.types.find(t => t.key === "general_csm");
    if (!csm) throw new Error("No general_csm type in the harness");
    csm.enabled = false;
    await render("/requests?view=team");
    await click(rowWith("General CSM ticket"));
    await flush(4);
    await click(buttonIn(dialog(), "Make it a request"));
    await settle();
    expect(page()).toContain(
      "The request type it came with is turned off. Pick another type. What was asked is kept.",
    );
    await click(
      [...container.querySelectorAll(".rq-type")].find((b: any) =>
        text(b).startsWith("General tech request"),
      ),
    );
    await settle();
    expect(page()).not.toContain("is turned off");
    const words =
      "Client asked for a call about their invoice and the new campaign start date.";
    expect(
      (container.querySelector('[data-field="details"]') as any).value,
    ).toBe(words);
    await click(buttonIn(container, "Send request"));
    await flush(6);
    const sent = fake.calls.find(c => c.name === "cockpit_request_submit");
    expect(sent?.args.p_type_key).toBe("general_tech");
    expect(sent?.args.p_replaces_task_id).toBe("z8xharn01");
    expect(sent?.args.p_answers.details).toBe(words);
  });

  test("Make it a request, then Change: the old ticket's words go with the new type, or show when it has no question for them", async () => {
    await render("/requests?view=team");
    await click(rowWith("General CSM ticket"));
    await flush(4);
    await click(buttonIn(dialog(), "Make it a request"));
    await settle();
    const words =
      "Client asked for a call about their invoice and the new campaign start date.";
    await click(buttonIn(container, "Change"));
    await click(
      [...container.querySelectorAll(".rq-type")].find((b: any) =>
        text(b).startsWith("General tech request"),
      ),
    );
    await settle();
    expect(
      (container.querySelector('[data-field="details"]') as any).value,
    ).toBe(words);
    // Card missing has no details question: the words show, said not sent.
    await click(buttonIn(container, "Change"));
    await click(
      [...container.querySelectorAll(".rq-type")].find((b: any) =>
        text(b).startsWith("Card missing for ads"),
      ),
    );
    await settle();
    expect(container.querySelector(".rq-quote")?.textContent).toBe(words);
    expect(squash(page())).toContain("What was asked");
    expect(squash(page())).toContain(
      "This type has no question for these words, so the cockpit adds them to the new task's description, with a link to the old ticket.",
    );
  });
});
