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
// The form reads today from the clock (its date checks, a carried due day)
// and the store from NOW: the same Kuwait day for both, whatever the date
// the tests run on, as requests-page.test.tsx does.
setSystemTime(new Date(NOW));
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
const sentPanel = () => container.querySelector(".rq-sent") as any;
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
    // The CSM is not an editor, so the owner note is the reader's (D12,
    // review round 2): no "Set one in Requests settings" line.
    expect(lines).toEqual([
      'Goes to Call Center as "Dune Build Co - Low schedule rate (Call Center)". Owner: the CSM. Uses the ClickUp template Low Schedule Rate📉 (Call Center). Due Thu 29 Oct.The CSM named on the client card.',
      'Goes to Marketing / ADs as "Dune Build Co - Low schedule rate (Ads)". Owner: the systems manager. Uses the ClickUp template Low Schedule Rate📉 (Ads). Due Thu 29 Oct.No media buyer is named for this request type yet.',
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
    // The browser's own words stay out of the form (D5): a plain sentence
    // with what to do.
    expect(page()).toContain(
      "The cockpit could not reach the database. Check your connection, then try again.",
    );
    expect(page()).not.toContain("Failed to fetch");
    // The answers are still there.
    expect(field("details").value).toBe(
      "The lead form on the landing page stopped.",
    );
    expect(submits().length).toBe(0);
    await click(button("Send request"));
    await flush(4);
    expect(submits().length).toBe(1);
    // On its way, not yet in the list: never "Sent to" before ClickUp has
    // it, and said once (D13).
    expect(page()).toContain("Sending to Operations / Tech.");
    expect(page()).not.toContain("Sent to");
    expect(page()).not.toContain("Sending to ClickUp");
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
              code: "22023",
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

  test("after a send the panel follows the task: sending, then in the list", async () => {
    await render();
    await pick("General tech request");
    await type(field("details"), "The CRM sync stopped.");
    await click(button("Send request"));
    await flush(4);
    expect(page()).toContain("Sending to Operations / Tech.");
    // The writer's run puts it in ClickUp; the panel reads it again within
    // five seconds and only then says it is in the list, with its owner.
    // On its way: a quiet mark, not the success check.
    expect(sentPanel()?.getAttribute("data-tone")).toBe("moving");
    expect(sentPanel()?.querySelector("svg.lucide-circle-dashed")).toBeTruthy();
    expect(sentPanel()?.querySelector("svg.lucide-circle-check")).toBeNull();
    fake.advance();
    await act(async () => {
      await new Promise(r => setTimeout(r, 5300));
    });
    await flush(4);
    expect(page()).toContain(
      "In Operations / Tech. Owner: the systems manager.",
    );
    expect(page()).not.toContain("Sending to Operations / Tech.");
    // In ClickUp: now the success check.
    expect(sentPanel()?.getAttribute("data-tone")).toBe("done");
    expect(sentPanel()?.querySelector("svg.lucide-circle-check")).toBeTruthy();
  }, 15000);

  test("a task refused on its way says so with the failure mark and the next step", async () => {
    await render();
    await pick("General tech request");
    await type(field("details"), "The CRM sync stopped.");
    await click(button("Send request"));
    await flush(4);
    // The writer's run: ClickUp refuses the task for good.
    const stored = fake.requests.find(
      r => r.id === submits()[0].args.p_request_id,
    );
    if (!stored) throw new Error("The request was not stored");
    stored.parts[0].state = "failed";
    stored.parts[0].error =
      "ClickUp refused the task: the template is not in ClickUp.";
    stored.state = "failed";
    await act(async () => {
      await new Promise(r => setTimeout(r, 5300));
    });
    await flush(4);
    const panel = sentPanel();
    expect(text(panel)).toContain(
      "Not sent to Operations / Tech: ClickUp refused the task: the template is not in ClickUp.",
    );
    // Never a success check beside a task that did not go.
    expect(panel?.getAttribute("data-tone")).toBe("failed");
    expect(panel?.querySelector("svg.lucide-circle-check")).toBeNull();
    expect(panel?.querySelector("svg.lucide-circle-alert")).toBeTruthy();
    expect(text(panel)).toContain(
      "Open the request to file it again, or use the ClickUp request form.",
    );
    const formLink = [...(panel?.querySelectorAll("a") ?? [])].find(
      (a: any) => text(a).includes("Open the ClickUp request form"),
    ) as any;
    expect(formLink?.getAttribute("href")).toContain("forms.clickup.com");
    // The request itself, where "File it again" is, in place of My requests.
    const open = [...container.querySelectorAll("a")].find(
      (a: any) => text(a) === "Open the request",
    ) as any;
    expect(open?.getAttribute("href")).toBe(
      `/requests?id=${encodeURIComponent(stored.id)}`,
    );
    expect(page()).not.toContain("See it in My requests");
  }, 15000);

  test("a request half in ClickUp names the missing task in the sent panel", async () => {
    await render({
      presetType: "low_schedule_rate",
      presetClient: { taskId: "86harb002", name: "Dune Build Co" },
      presetAnswers: { schedule_rate_issue: "Both" },
    });
    await click(button("Send request"));
    await flush(4);
    const stored = fake.requests.find(
      r => r.id === submits()[0].args.p_request_id,
    );
    if (!stored) throw new Error("The request was not stored");
    expect(stored.parts.map(p => p.part)).toEqual(["call_center", "ads"]);
    stored.parts[0].state = "delivered";
    stored.parts[0].url = "https://app.clickup.com/t/86harn077";
    stored.parts[0].status = "to do";
    stored.parts[0].statusType = "open";
    stored.parts[1].state = "failed";
    stored.parts[1].error = "ClickUp refused the task: the template is gone.";
    stored.state = "partial";
    await act(async () => {
      await new Promise(r => setTimeout(r, 5300));
    });
    await flush(4);
    const panel = sentPanel();
    expect(panel?.getAttribute("data-tone")).toBe("failed");
    expect(text(panel)).toContain("In Call Center. Owner:");
    expect(text(panel)).toContain(
      "The Marketing / ADs task did not reach ClickUp; the one that did stays there. Raise the missing task with the ClickUp request form, or ask the systems manager to make it.",
    );
  }, 15000);

  test("an editor may file while requests are not open: told it is saved, never sent", async () => {
    fake = createRequestsFake({ seat: "ceo", mode: "dry_run", now: () => NOW });
    await render();
    await pick("General tech request");
    await type(field("details"), "Check the CRM sync.");
    // The database's note for a held request, above Send (F3/F5). It is
    // shown before anything is sent, so it never begins "Saved." (review round 2).
    const note =
      "Requests are not open yet. What you send is saved and goes to ClickUp once they are.";
    expect(page()).toContain(note);
    expect(button("Send request")).toBeTruthy();
    await click(button("Send request"));
    await flush(4);
    expect(submits().length).toBe(1);
    expect(page()).toContain(
      "Saved. Goes to Operations / Tech when requests open.",
    );
    expect(page()).not.toContain("Sent to");
    expect(page()).not.toContain("Sending to");
    expect(page()).not.toContain("Owner:");
    // Saved, not sent: the waiting mark in the warning colour, no check.
    expect(sentPanel()?.getAttribute("data-tone")).toBe("held");
    expect(sentPanel()?.querySelector("svg.lucide-clock")).toBeTruthy();
    expect(sentPanel()?.querySelector("svg.lucide-circle-check")).toBeNull();
    // The writer hands it back to the queue with its note; still held.
    fake.advance();
    const stored = fake.requests.find(
      r => r.id === submits()[0].args.p_request_id,
    );
    expect(stored?.parts[0].state).toBe("queued");
    expect(stored?.parts[0].error).toMatch(/^Waiting in the queue/);
  });

  test("off the test card while requests are tested, an editor's request is held too", async () => {
    fake = createRequestsFake({
      seat: "ceo",
      mode: "apply_limited",
      now: () => NOW,
    });
    await render({
      source: "client_page",
      presetClient: { taskId: "86harb002", name: "Dune Build Co" },
      compact: true,
    });
    await pick("Card missing for ads");
    expect(page()).toContain(
      "Requests are being tested on the internal test card only, where they go to ClickUp at once. Anything else you send is saved and goes to ClickUp once they open to everyone.",
    );
    await click(button("Send request"));
    await flush(4);
    expect(page()).toContain("when requests open.");
    expect(page()).not.toContain("Sending to");
  });

  test("a request's own priority and due day start the form, and go with a changed type", async () => {
    await render({
      presetType: "general_tech",
      presetDetails: "The CRM sync stopped again.",
      presetPriority: "urgent",
      presetDueOn: "2026-10-29",
    });
    expect(field("priority").value).toBe("urgent");
    expect((container.querySelector('input[type="date"]') as any).value).toBe(
      "2026-10-29",
    );
    expect(field("details").value).toBe("The CRM sync stopped again.");
    // Change to a type with no details question: the priority and due day
    // stay, and the words show, said plainly that they are not sent.
    await click(button("Change"));
    await pick("Card missing for ads");
    expect(field("priority").value).toBe("urgent");
    expect((container.querySelector('input[type="date"]') as any).value).toBe(
      "2026-10-29",
    );
    expect(container.querySelector(".rq-quote")?.textContent).toBe(
      "The CRM sync stopped again.",
    );
    expect(page()).toContain(
      "This type has no question for these words, so they are not sent with it.",
    );
    // Not a routed old ticket: nothing about one.
    expect(page()).not.toContain("old ticket");
  });

  test("a carried due day already past starts on the type's due day; Ask for something else carries nothing", async () => {
    await render({
      presetType: "general_tech",
      presetDetails: "Check the CRM sync.",
      presetPriority: "low",
      presetDueOn: "2026-10-20",
    });
    expect((container.querySelector('input[type="date"]') as any).value).toBe(
      "2026-10-28",
    );
    expect(field("priority").value).toBe("low");
    await click(button("Send request"));
    await flush(4);
    expect(submits()[0].args.p_due_on).toBe("2026-10-28");
    expect(submits()[0].args.p_priority).toBe("low");
    await click(button("Ask for something else"));
    await pick("General tech request");
    expect(field("priority").value).toBe("normal");
    expect(field("details").value).toBe("");
  });

  test("a preset type that is turned off is said once, and its words go with the type picked", async () => {
    const csm = fake.types.find(t => t.key === "general_csm");
    if (!csm) throw new Error("No general_csm type in the harness");
    csm.enabled = false;
    await render({
      presetType: "general_csm",
      presetDetails: "Call the client about the invoice.",
    });
    const note =
      "The request type it came with is turned off. Pick another type. What was asked is kept.";
    expect(page()).toContain(note);
    expect(page().split(note).length).toBe(2);
    await pick("General tech request");
    expect(page()).not.toContain("is turned off");
    expect(field("details").value).toBe("Call the client about the invoice.");
  });

  test("a request filed again starts from its own answers (D2)", async () => {
    // The panel hands over the answers as words: a choice by its name.
    await render({
      presetType: "low_schedule_rate",
      presetClient: { taskId: "86harb002", name: "Dune Build Co" },
      presetAnswers: {
        schedule_rate_issue: "Both",
        additional_notes: "Raised again after ClickUp refused it.",
      },
    });
    const issue = field("schedule_rate_issue");
    const chosen = [...issue.querySelectorAll("option")].find(
      (o: any) => o.value === issue.value,
    ) as any;
    expect(text(chosen)).toBe("Both");
    expect(field("additional_notes").value).toBe(
      "Raised again after ClickUp refused it.",
    );
  });
});
