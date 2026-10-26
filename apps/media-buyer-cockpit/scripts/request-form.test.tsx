/**
 * The shared request form (docs/requests/CONTRACT.md 6.2, 6.4) in happy-dom,
 * over the cockpit's own client with its sign-in and the requests functions
 * answered by the made-up store in src/dev/requestsHarness.ts: only the
 * chosen type's questions show, due and priority come prefilled, the checks
 * say the server's sentences before anything is sent, the route line says
 * where each task lands, the writer's note stands in for Send, one press
 * sends once and a retry keeps the request id, and a lifecycle duplicate is
 * shown. Every person, client and id is made up.
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
  throw new Error("The request form test makes no network calls.");
}) as typeof fetch;

// --- The cockpit's client: a CSM signed in, the requests store behind rpc. --
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
  id: "auth-csm-test",
  email: "csm@example.test",
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
let fake: Fake = createRequestsFake({ seat: "csm", now: () => NOW });
/** Answers a call before the store does, once per name; null passes it on. */
let before: (name: string, args: any) => Answer | null = () => null;
db.rpc = async (name: string, args: any = {}) => {
  if (name === "cockpit_adopt_member") return { data: true, error: null };
  if (name === "cockpit_get_my_access")
    return {
      data: {
        email: USER.email,
        name: "The CSM",
        is_admin: false,
        is_ceo: false,
        home: "/go/csm",
        cockpits: ["csm"],
        roles: ["csm"],
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
const { RequestForm } = await import("../src/components/tasks/RequestForm");

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
const page = () => text(container);
const buttons = () => [...container.querySelectorAll("button")] as any[];
const button = (label: string) =>
  buttons().find(b => text(b).trim() === label) as any;
const buttonStarting = (label: string) =>
  buttons().find(b => text(b).trim().startsWith(label)) as any;
const labels = () =>
  [...container.querySelectorAll("label, p.rq-label")].map(l => text(l).trim());
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
      : el.tagName === "SELECT"
        ? win.HTMLSelectElement.prototype
        : win.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(
      new win.Event(el.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
  await flush(2);
}
const field = (key: string) =>
  container.querySelector(`[data-field="${key}"]`) as any;
const submits = () =>
  fake.calls.filter(c => c.name === "cockpit_request_submit");

async function render(props: Record<string, unknown> = {}) {
  await act(async () => {
    root.render(
      h(
        SupabaseAuthProvider,
        null,
        h(
          MemoryRouter,
          { initialEntries: ["/requests"] },
          h(RequestForm, { source: "requests_page", ...props } as any),
        ),
      ),
    );
  });
  await settle();
}
async function pick(label: string) {
  await click(buttonStarting(label));
  await settle();
}
async function pickClient(name: string) {
  await click(buttonStarting(name));
  await settle();
}

afterEach(async () => {
  await act(async () => root.render(null));
  await flush(2);
  fake = createRequestsFake({ seat: "csm", now: () => NOW });
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

describe("the request form", () => {
  test("lists the types by team, then shows only the chosen type's questions", async () => {
    await render();
    expect(page()).toContain("What do you need?");
    const groups = [...container.querySelectorAll(".rq-group-label")].map(el =>
      text(el),
    );
    expect(groups).toEqual([
      "Client Success",
      "Operations / Tech",
      "Marketing / ADs",
      "Media/Creative",
      "Call Center",
    ]);
    // Searching narrows the list.
    await type(container.querySelector('input[type="search"]'), "script");
    expect(
      [...container.querySelectorAll(".rq-type-name")].map(el => text(el)),
    ).toEqual(["New script"]);
    await type(container.querySelector('input[type="search"]'), "");
    await pick("Low schedule rate");
    const asked = labels();
    expect(asked).toContain("Client");
    expect(asked).toContain("Where is the problem?");
    expect(asked).toContain("Notes (optional)");
    // Nothing from another type.
    expect(asked.some(l => l.startsWith("Script"))).toBe(false);
    expect(page()).not.toContain("Lead form name");
  });

  test("prefills the due day and priority from the type", async () => {
    await render();
    await pick("WhatsApp connection issue");
    const due = container.querySelector('input[type="date"]') as any;
    expect(due.value).toBe("2026-10-27"); // one working day
    expect(page()).toContain("Tue 27 Oct, Kuwait time.");
    const priority = container.querySelector('[data-field="priority"]') as any;
    expect(priority.value).toBe("high");
  });

  test("says the server's sentences before anything is sent", async () => {
    await render();
    await pick("Low schedule rate");
    await click(button("Send request"));
    expect(page()).toContain("Client: pick a client.");
    expect(page()).toContain("Where is the problem?: pick one.");
    expect(submits()).toEqual([]);
    // Fixing a field clears its sentence.
    await pickClient("Dune Build Co");
    expect(page()).not.toContain("Client: pick a client.");
    expect(page()).toContain("Where is the problem?: pick one.");
  });

  test("the route line says where each task lands, before Send", async () => {
    await render();
    await pick("Low schedule rate");
    expect(page()).toContain(
      "Pick Where is the problem? to see where it goes.",
    );
    await pickClient("Dune Build Co");
    const issue = field("schedule_rate_issue");
    const both = [...issue.querySelectorAll("option")].find(
      (o: any) => text(o) === "Both",
    ) as any;
    await type(issue, both.value);
    await settle();
    const lines = [...container.querySelectorAll(".rq-route-line")].map(el =>
      text(el).replace(/\s+/g, " ").trim(),
    );
    expect(lines).toEqual([
      'Goes to Call Center as "Dune Build Co - Low schedule rate (Call Center)". Owner: the CSM. Uses the ClickUp template Low Schedule Rate📉 (Call Center). Due Thu 29 Oct.The CSM named on the client card.',
      'Goes to Marketing / ADs as "Dune Build Co - Low schedule rate (Ads)". Owner: the systems manager. Uses the ClickUp template Low Schedule Rate📉 (Ads). Due Thu 29 Oct.No media buyer of record is set, so the systems manager gets it. Set one in Requests settings.',
    ]);
    const ads = [...issue.querySelectorAll("option")].find(
      (o: any) => text(o) === "Ads issue",
    ) as any;
    await type(issue, ads.value);
    await settle();
    expect(container.querySelectorAll(".rq-route-line").length).toBe(1);
    expect(page()).toContain("Goes to Marketing / ADs");
  });

  test("one press sends once; a retry after a lost answer keeps the request id", async () => {
    await render();
    await pick("General tech request");
    await type(field("details"), "The lead form on the landing page stopped.");
    const pressed: string[] = [];
    before = (name, args) => {
      if (name !== "cockpit_request_submit") return null;
      pressed.push(args.p_request_id);
      return pressed.length === 1
        ? { data: null, error: { message: "Failed to fetch" } }
        : null;
    };
    // Two quick presses: the first is in flight, the second does nothing.
    const send = button("Send request");
    await act(async () => {
      send.click();
      send.click();
    });
    await flush(6);
    expect(page()).toContain("Failed to fetch");
    // The answers are still there.
    expect(field("details").value).toBe(
      "The lead form on the landing page stopped.",
    );
    expect(submits().length).toBe(0);
    await click(button("Send request"));
    await flush(4);
    expect(submits().length).toBe(1);
    expect(page()).toContain(
      "Sent to Operations / Tech. Owner: the systems manager.",
    );
    expect(page()).toContain("See it in My requests");
    // The failed press and the sent one carried the same id.
    expect(pressed.length).toBe(2);
    expect(pressed[1]).toBe(pressed[0]);
    expect(fake.requests.some(r => r.id === pressed[0])).toBe(true);
    const sent = submits()[0].args;
    expect(sent.p_answers).toEqual({
      details: "The lead form on the landing page stopped.",
    });
    expect(sent.p_due_on).toBe("2026-10-28");
    expect(sent.p_priority).toBe("normal");
    expect(sent.p_source).toBe("requests_page");
    // Asking for something else starts a new request.
    await click(button("Ask for something else"));
    expect(page()).toContain("What do you need?");
  });

  test("the same request sent twice comes back as the first", async () => {
    await render();
    await pick("General tech request");
    await type(field("details"), "Please check the CRM sync.");
    await click(button("Send request"));
    await flush(4);
    const id = submits()[0].args.p_request_id;
    // The database answers a repeat of the same id and answers with the
    // first send, so the store holds one request for it.
    const again = fake.call("cockpit_request_submit", submits()[0].args);
    expect((again.data as any).reused).toBe(true);
    expect(fake.requests.filter(r => r.id === id).length).toBe(1);
  });

  test("an open pause for the same client is shown, not sent again", async () => {
    await render();
    await pick("Client pause");
    await pickClient("Harbour Interiors");
    await click(button("Send request"));
    await flush(4);
    expect(page()).toContain(
      "An open client pause request for Harbour Interiors already exists. Open it instead.",
    );
    const open = [...container.querySelectorAll("a")].find(
      (a: any) => text(a) === "Open it",
    ) as any;
    expect(open?.getAttribute("href")).toMatch(/^\/requests\?id=/);
  });

  test("while the writer is not open to this seat, its note stands in for Send", async () => {
    fake = createRequestsFake({ seat: "csm", mode: "dry_run", now: () => NOW });
    await render();
    const note =
      "Requests are not switched on yet. Use the ClickUp request form until then.";
    // Said before anyone types.
    expect(page()).toContain(note);
    const link = [...container.querySelectorAll("a")].find((a: any) =>
      text(a).includes("Open the ClickUp request form"),
    ) as any;
    expect(link?.getAttribute("href")).toContain(
      "forms.clickup.com/90182518398/f/2kzmr1ky-1178",
    );
    await pick("General tech request");
    expect(button("Send request")).toBeUndefined();
    expect(page()).toContain(note);
    expect(page().split(note).length).toBe(2); // said once
  });

  test("a client page fixes the client and offers only the types that take one", async () => {
    await render({
      source: "client_page",
      presetClient: { taskId: "86harb002", name: "Dune Build Co" },
      compact: true,
    });
    const offered = [...container.querySelectorAll(".rq-type-name")].map(el =>
      text(el),
    );
    expect(offered).not.toContain("New employee onboarding");
    expect(offered).toContain("Card missing for ads");
    await pick("Card missing for ads");
    expect(page()).toContain("Dune Build Co");
    expect(container.querySelector('[data-field="client"]')).toBeNull();
    expect(page()).toContain('as "Dune Build Co - Card missing for ads"');
    expect(page()).toContain("Adds 5 draft SOP steps.");
    await click(button("Send request"));
    await flush(4);
    expect(submits()[0].args.p_client_task_id).toBe("86harb002");
    expect(submits()[0].args.p_source).toBe("client_page");
  });

  test("a server refusal lands under the field it names", async () => {
    await render();
    await pick("General tech request");
    await type(field("details"), "Something");
    before = name =>
      name === "cockpit_request_submit"
        ? {
            data: null,
            error: {
              message: "What is needed?: keep it under 4000 characters.",
            },
          }
        : null;
    await click(button("Send request"));
    await flush(4);
    const note = win.document.getElementById(
      field("details").getAttribute("aria-describedby"),
    ) as any;
    expect(text(note)).toBe("What is needed?: keep it under 4000 characters.");
    expect(field("details").getAttribute("aria-invalid")).toBe("true");
  });
});
