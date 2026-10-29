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
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
/** A choice of a question drawn as pills or radios, by its name. */
const choiceLabel = (key: string, name: string) =>
  [...container.querySelectorAll(`[data-question="${key}"] .rq-choice`)].find(
    (l: any) => text(l.querySelector(".rq-choice-name, .rq-day-date")) === name,
  ) as any;
const checkedChoice = (key: string) =>
  container.querySelector(
    `[data-question="${key}"] .rq-choice[data-on]`,
  ) as any;
async function choose(key: string, name: string) {
  const label = choiceLabel(key, name);
  expect(label).toBeTruthy();
  await click(label.querySelector('input[type="radio"]'));
}
/** The route's lanes, one per task, as text. */
const lanes = () =>
  [...container.querySelectorAll(".rq-route-line")].map(el => squash(text(el)));
const stop = (kind: string) =>
  squash(text(container.querySelector(`.rq-stop[data-kind="${kind}"]`)));
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
    // Tickets-look-1028: the usual day and the next working day are their
    // own choices; that day is the usual one here, so the day after is
    // offered. The date input is one press away, under "Pick a day".
    expect(
      [
        ...container.querySelectorAll('[data-question="deadline"] .rq-choice'),
      ].map(l => squash(text(l))),
    ).toEqual(["Tue 27 Octusual", "Wed 28 Octlater", "Pick a day"]);
    expect(squash(text(checkedChoice("deadline")))).toBe("Tue 27 Octusual");
    expect(page()).toContain(
      "1 working day is the usual for this type. Working days are Sunday to Thursday, Kuwait time.",
    );
    expect(due.closest(".rq-date").hidden).toBe(true);
    await choose("deadline", "Pick a day");
    expect(due.closest(".rq-date").hidden).toBe(false);
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
    // One summary above Send names each answer; each is a button to it.
    const summary = container.querySelector(".rq-summary") as any;
    expect(text(summary)).toContain("Fix these two answers first:");
    // A11Y-02: said once a press, through a polite line already on the page;
    // the visible summary is not live, so a fix shrinks it quietly.
    expect(summary.getAttribute("role")).toBeNull();
    const said = () =>
      text(container.querySelector('.rq-send > p.rq-sr[role="status"]'));
    expect(said()).toContain(
      "Fix these two answers first: Client: pick a client.",
    );
    const fix = [...summary.querySelectorAll("button")].find(
      (b: any) => text(b) === "Where is the problem?: pick one.",
    );
    await click(fix);
    await flush(2);
    expect(win.document.activeElement?.getAttribute("data-field")).toBe(
      "schedule_rate_issue",
    );
    // Fixing a field clears its sentence.
    await pickClient("Dune Build Co");
    expect(page()).not.toContain("Client: pick a client.");
    expect(page()).toContain("Where is the problem?: pick one.");
    // Nothing is said again until the next press, which says what is left.
    expect(said()).toBe("");
    await click(button("Send request"));
    expect(said()).toContain(
      "Fix this answer first: Where is the problem?: pick one.",
    );
    expect(said()).not.toContain("Client: pick a client.");
  });

  test("the route says where each task lands, before Send", async () => {
    await render();
    await pick("Low schedule rate");
    // Tickets-look-1028: before the deciding answer each team it may reach
    // is drawn with its condition (parts[].when, 20261028a), never from the
    // server's "Pick ... to see where it goes." sentence, and with the owner
    // that answer's own preview names: never one who does not exist.
    expect(stop("send")).toContain("You send it.");
    expect(text(container.querySelector(".rq-route-sum"))).toBe(
      "One or two tasks, by your answer",
    );
    expect(page()).not.toContain("to see where it goes");
    const [cc, ads] = lanes();
    expect(cc).toContain("May go to");
    expect(cc).toContain("If the problem is Call Center Issue or Both");
    expect(cc).toContain("the CSM");
    expect(ads).toContain("If the problem is Ads issue or Both");
    expect(ads).toContain("the systems manager");
    expect(ads).toContain("No media buyer is named for this request type yet.");
    expect(ads).not.toContain("media buyer of record");
    // The question says it decides, and each choice names the team it reaches.
    expect(page()).toContain("Decides where it goes");
    expect(squash(text(choiceLabel("schedule_rate_issue", "Ads issue")))).toBe(
      "Ads issueMarketing / ADs",
    );
    expect(squash(text(choiceLabel("schedule_rate_issue", "Both")))).toBe(
      "BothBoth teams",
    );
    // The plate's words are true for every answer.
    expect(squash(text(container.querySelector(".rq-plate-kicker")))).toContain(
      "Call Center, Marketing / ADs or both, by your answer",
    );
    await pickClient("Dune Build Co");
    const beforeSum = text(container.querySelector(".rq-route-sum"));
    expect(beforeSum).toBe("One or two tasks, by your answer");
    await choose("schedule_rate_issue", "Both");
    // BT-4: until the answer's own preview lands, the route keeps the one it
    // was drawn from, never the server's "Pick ... to see where it goes."
    expect(text(container.querySelector(".rq-route-sum"))).toBe(beforeSum);
    expect(page()).not.toContain("to see where it goes");
    await settle();
    // After it: the question and its answer at the fork, then a lane a task.
    expect(stop("decision")).toContain("Where is the problem? Both");
    const after = lanes();
    expect(after.length).toBe(2);
    // BT-8: the owner of each lane that runs.
    expect(after[0]).toContain("Ownerthe CSM");
    expect(after[1]).toContain("Ownerthe systems manager");
    expect(after[0]).toContain("Goes to Call Center");
    expect(after[0]).toContain(
      "Dune Build Co - Low schedule rate (Call Center)",
    );
    expect(after[0]).toContain("The CSM named on the client card.");
    // A ClickUp template's name keeps no emoji on the form.
    expect(after[0]).toContain(
      "the ClickUp template Low Schedule Rate (Call Center)",
    );
    expect(after[1]).toContain("Goes to Marketing / ADs");
    expect(after[1]).toContain("Dune Build Co - Low schedule rate (Ads)");
    expect(after[1]).toContain(
      "No media buyer is named for this request type yet.",
    );
    // Exactly two tasks: side by side, under the fork.
    expect(
      container.querySelector(".rq-stop-fork")?.getAttribute("data-n"),
    ).toBe("2");
    expect(text(container.querySelector(".rq-route-sum"))).toBe(
      "Two tasks, for Call Center and Marketing / ADs",
    );
    // The due day is said once, on its own stop.
    expect(stop("due")).toContain("Thu 29 Oct, normal priority");
    await choose("schedule_rate_issue", "Ads issue");
    // BT-4: a switch keeps the route it was drawn from until its own preview
    // lands, never the new answer over the old pair of lanes.
    expect(stop("decision")).toContain("Where is the problem? Both");
    expect(lanes().length).toBe(2);
    await settle();
    expect(stop("decision")).toContain("Where is the problem? Ads issue");
    expect(lanes().length).toBe(1);
    expect(page()).toContain("Goes to Marketing / ADs");
    expect(container.querySelector(".rq-stop-fork")).toBeNull();
  });

  test("three tasks that may run on one list are one lane, each answer with its own template", async () => {
    await render();
    await pick("Create an ad account");
    expect(text(container.querySelector(".rq-route-sum"))).toBe(
      "One task for Marketing / ADs, by your answer",
    );
    // D7: one list, one owner, one question: the lane is drawn once, the
    // answers joined, and what each answer's task works from under it.
    const may = lanes();
    expect(may.length).toBe(1);
    expect(may[0]).toContain("May go to");
    expect(may[0]).toContain(
      "If the platform is Facebook/Meta, Tiktok or Snapchat",
    );
    expect(may[0]).toContain(
      "Facebook/Meta: the ClickUp template Create Meta Ad Account",
    );
    expect(may[0]).toContain(
      "Tiktok: the ClickUp template Create TikTok Ad Account",
    );
    expect(may[0]).toContain(
      "Snapchat: the ClickUp template Create Snapchat Ad Account",
    );
    expect(container.querySelector(".rq-stop-fork")).toBeNull();
    // The platform decides which task, not which team.
    expect(page()).toContain("Decides which task it makes");
    await pickClient("Dune Build Co");
    await choose("ads_platform", "Tiktok");
    await settle();
    expect(lanes().length).toBe(1);
    expect(lanes()[0]).toContain(
      "the ClickUp template Create TikTok Ad Account",
    );
    expect(stop("decision")).toContain("Ad platform Tiktok");
  });

  test("a database from before 20261028a: no routing marks, the server's note, the step count only", async () => {
    fake = createRequestsFake({ seat: "csm", now: () => NOW, routes: false });
    await render();
    await pick("Low schedule rate");
    expect(page()).toContain(
      "Pick Where is the problem? to see where it goes.",
    );
    expect(page()).not.toContain("May go to");
    expect(page()).not.toContain("Decides where it goes");
    // The teams are joined as before; nothing claims which answer reaches which.
    expect(squash(text(container.querySelector(".rq-plate-kicker")))).toContain(
      "Call Center and Marketing / ADs",
    );
    await click(button("Change"));
    await pick("General tech request");
    expect(page()).toContain("Five SOP steps, added as a checklist");
    expect(page()).toContain("A draft until the systems manager checks them.");
    expect(page()).not.toContain("Show the other");
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
    // A11Y-05: focus on the heading, which carries the server's note as its
    // description; no status inserted with its words already in it.
    const heading = win.document.activeElement as any;
    expect(heading?.tagName).toBe("H3");
    expect(container.querySelector(".rq-dup")?.getAttribute("role")).toBeNull();
    const note = win.document.getElementById(
      heading.getAttribute("aria-describedby"),
    );
    expect(text(note)).toBe(
      "An open client pause request for Harbour Interiors already exists. Open it instead.",
    );
    // A11Y-19: the client's name is isolated inside the sentence.
    expect(text(note?.querySelector("bdi"))).toBe("Harbour Interiors");
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
    // BT-12: the page's own client, said so only on a client page.
    expect(page()).toContain("This page's client.");
    // Tickets-look-1028: the lane names the task and shows the SOP steps it
    // adds, the first two and the rest one press away, said to be a draft.
    const lane = lanes()[0];
    expect(lane).toContain("Dune Build Co - Card missing for ads");
    expect(lane).toContain("Five SOP steps, added as a checklist");
    expect(lane).toContain(
      "Confirm the ad account is stopped by a missing or failed payment method.",
    );
    expect(lane).toContain("Show the other 3");
    expect(lane).toContain("A draft until the systems manager checks them.");
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
    // Tickets-look-1028: what was sent, when (Kuwait time), what comes next.
    expect(text(container.querySelector(".rq-sent-title"))).toBe(
      "Sent: General tech request",
    );
    expect(text(container.querySelector(".rq-sent-sub"))).toBe(
      "Nothing else to do now. It is on its way to ClickUp, usually within a minute or two.",
    );
    expect(stop("send")).toContain("Sent at 11:00, Kuwait time.");
    expect(page()).toContain("The CRM sync stopped.");
    // No ClickUp link before ClickUp has the task.
    expect(
      [...container.querySelectorAll("a")].some(
        (a: any) => text(a) === "Open in ClickUp",
      ),
    ).toBe(false);
    // Focus is on the heading: the one voice for the event.
    expect(win.document.activeElement?.classList.contains("rq-sent-head")).toBe(
      true,
    );
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
    // The owner is said once, in the sentence; the link is the task's own.
    expect(page().split("the systems manager").length).toBe(2);
    const open = [...container.querySelectorAll("a")].find(
      (a: any) => text(a) === "Open in ClickUp",
    ) as any;
    expect(open?.getAttribute("href")).toMatch(
      /^https:\/\/app\.clickup\.com\/t\//,
    );
    expect(text(container.querySelector(".rq-sent-sub"))).toBe(
      "Nothing else to do now. It is in ClickUp.",
    );
    // Nothing moves any more: the page says it stopped checking, and when.
    expect(text(container.querySelector(".rq-stamp"))).toBe(
      "Stopped checking at 11:00, Kuwait time. My requests shows where it stands.",
    );
    expect(page()).toContain("To change it now, use the task in ClickUp.");
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
    // A11Y-09: the refusal came in while the page read the request, so the
    // one polite line says it whole, with its next step, and it describes
    // the focused heading too.
    const sub = container.querySelector(".rq-sent-sub") as any;
    expect(sub?.getAttribute("aria-live")).toBe("polite");
    expect(sub?.getAttribute("aria-atomic")).toBe("true");
    expect(squash(text(sub))).toBe(
      "It did not reach ClickUp. Open the request to file it again, or use the ClickUp request form.",
    );
    expect(
      String(
        container
          .querySelector(".rq-sent-head")
          ?.getAttribute("aria-describedby"),
      ).split(" "),
    ).toContain(sub.id);
    const formLink = [...(panel?.querySelectorAll("a") ?? [])].find((a: any) =>
      text(a).includes("Open the ClickUp request form"),
    ) as any;
    expect(formLink?.getAttribute("href")).toContain("forms.clickup.com");
    expect(text(formLink)).toContain("(opens in a new tab)");
    // The request itself, where "File it again" is, in place of My requests.
    const open = [...container.querySelectorAll("a")].find(
      (a: any) => text(a) === "Open the request",
    ) as any;
    expect(open?.getAttribute("href")).toBe(
      `/requests?id=${encodeURIComponent(stored.id)}`,
    );
    expect(page()).not.toContain("See it in My requests");
    // CL-05: nothing reached ClickUp and nothing moves, so the tracker no
    // longer speaks of a request in motion, nor offers to cancel it.
    expect(stop("bell")).toContain("Nothing more happens with it by itself.");
    expect(stop("bell")).toContain("The bell keeps the failure.");
    expect(text(panel)).not.toContain("You hear in the bell when it is done");
    expect(text(panel)).not.toContain("You can cancel it from the request");
    expect(text(panel)).not.toContain("Nothing is sent to the client.");
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
    // CL-05: "Sent together" only while no task failed.
    expect(text(panel?.querySelector(".rq-fork-note"))).toBe("Two tasks");
    expect(text(panel)).not.toContain("Sent together");
    // The delivered task keeps the bell and its ClickUp words.
    expect(stop("bell")).toContain("You hear in the bell");
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
    // Tickets-look-1028: the button says what it does, and the route stops
    // at the held stop, with the writer's own sentence.
    expect(button("Send request")).toBeUndefined();
    expect(button("Save request")).toBeTruthy();
    expect(stop("held")).toContain("Saved, not sentWaits in the cockpit.");
    expect(stop("held")).toContain(note);
    // CL-13: a held request keeps its due day, said under the Due stop,
    // which names the day: the day is said once (T3-design-clarity-04).
    expect(stop("due")).toMatch(
      /^Due\w{3} \d{1,2} \w{3}, normal priorityThe due day stays, even if it reaches ClickUp later\.$/,
    );
    expect(stop("held")).not.toContain("due day");
    // My requests shows it as Saved, not a ClickUp status, until it reaches
    // ClickUp (T3-design-clarity-08).
    expect(stop("bell")).toContain(
      "My requests shows it as Saved until it reaches ClickUp, then its ClickUp status.",
    );
    expect(stop("bell")).not.toContain("shows its ClickUp status until then");
    await click(button("Save request"));
    await flush(4);
    expect(submits().length).toBe(1);
    // D6: one Saved stop with the writer's sentence under it, never a
    // second held stop saying "saved" again.
    const sentStops = () =>
      [...sentPanel().querySelectorAll(".rq-stop")].map((s: any) =>
        s.getAttribute("data-kind"),
      );
    expect(sentStops()).not.toContain("held");
    const saved = squash(
      text(sentPanel().querySelector('.rq-stop[data-kind="send"]')),
    );
    // T3-design-clarity-08: after Save the stop says what happened to this
    // request, not the rule said before it ("What you send is saved ...");
    // the sub-line says when it goes.
    expect(saved).toMatch(
      /^SavedSaved at \d{2}:\d{2}, Kuwait time\.The cockpit checked it and keeps it here\.$/,
    );
    expect(saved).not.toContain(note);
    // T3-design-clarity-04: the kept due day under the Due stop, the day
    // and priority said once (never again in "What you asked").
    expect(
      squash(text(sentPanel().querySelector('.rq-stop[data-kind="due"]'))),
    ).toMatch(
      /^Due\w{3} \d{1,2} \w{3}, normal priorityThe due day stays, even if it reaches ClickUp later\.$/,
    );
    const asked = squash(text(sentPanel().querySelector(".rq-answers")));
    expect(asked).toContain("What you asked");
    expect(asked).not.toContain("Priority");
    expect(asked).not.toMatch(/Due\w{3} \d/);
    expect(
      squash(text(sentPanel().querySelector('.rq-stop[data-kind="bell"]'))),
    ).toContain(
      "My requests shows it as Saved until it reaches ClickUp, then its ClickUp status.",
    );
    expect(page()).toContain(
      "Saved. Goes to Operations / Tech when requests open.",
    );
    expect(text(container.querySelector(".rq-sent-title"))).toBe(
      "Saved: General tech request",
    );
    expect(page()).toContain(
      "It goes to ClickUp by itself once requests open.",
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
    await click(button("Save request"));
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
    // Tickets-look-1028: a choice of three is pills, the chosen one marked.
    expect(
      text(
        checkedChoice("schedule_rate_issue")?.querySelector(".rq-choice-name"),
      ),
    ).toBe("Both");
    expect(field("schedule_rate_issue").checked).toBe(true);
    expect(field("additional_notes").value).toBe(
      "Raised again after ClickUp refused it.",
    );
    // BT-12: on the Requests page the client comes from the request, not
    // the page.
    expect(page()).toContain("Fixed for this request.");
    expect(page()).not.toContain("This page's client.");
  });

  test("search forgives: a sentence, a typo said, matched words bold, the general requests last", async () => {
    await render();
    const search = container.querySelector('input[type="search"]') as any;
    const names = () =>
      [...container.querySelectorAll(".rq-type-name")].map(el => text(el));
    await type(search, "stop a client's ads for now");
    expect(names()[0]).toBe("Client pause");
    // Matched words are bold in the name and the line.
    expect(
      [...container.querySelectorAll(".rq-row .rq-hit")].map(el => text(el)),
    ).toContain("Stop");
    // Hidden while searching; every result list ends in the general requests.
    expect(page()).not.toContain("Your recent requests");
    expect(squash(text(container.querySelector(".rq-notit")))).toContain(
      "Not it? Pick the general request closest to it, or ask the systems manager.",
    );
    // One wrong letter, only when nothing matches as typed, and said.
    await type(search, "watsapp");
    expect(page()).toContain(
      'No match for "watsapp". 2 requests match "whatsapp".',
    );
    expect(names()).toEqual([
      "WhatsApp connection issue",
      "WhatsApp reactivation campaign",
    ]);
    await type(search, "refund");
    expect(page()).toContain('No request matches "refund".');
    expect(names()).toEqual([]);
    expect(squash(text(container.querySelector(".rq-notit")))).toContain(
      "General tech request",
    );
    // Return picks the first match.
    await type(search, "pause");
    await act(async () => {
      search.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await settle();
    expect(text(container.querySelector(".rq-plate-name"))).toBe(
      "Client pause",
    );
  });

  test("a team lists the requests that also reach it, with their home team; every request is one click from the map", async () => {
    await render();
    const seeAll = buttons().find(
      b =>
        b.getAttribute("aria-label") === "See all 3 Marketing / ADs requests",
    );
    await click(seeAll);
    expect(
      [...container.querySelectorAll(".rq-group-label")].map(el => text(el)),
    ).toEqual(["Marketing / ADs"]);
    const rows = () =>
      [...container.querySelectorAll(".rq-row")].map(el => squash(text(el)));
    expect(rows().map(r => r.split("Due in")[0])).toEqual([
      expect.stringContaining("Create an ad account"),
      expect.stringContaining("Client pause"),
      expect.stringContaining("Low schedule rate"),
    ]);
    expect(rows()[1]).toContain("Filed under Operations / Tech");
    // D16: the reach words already name its home team, so it is said once.
    expect(rows()[2]).not.toContain("Filed under");
    expect(rows()[2]).toContain(
      "Call Center, Marketing / ADs or both, by your answer",
    );
    // T3-design-clarity-02: the hero's count is true for every answer: Low
    // schedule rate gives Marketing / ADs a task only for some answers.
    expect(
      squash(text(container.querySelector(".rq-hero .rq-dept-line"))),
    ).toBe(
      "Ad accounts and campaigns, and the ads side of a pause, relaunch or exit. 1 request, and 2 from other teams that can give it a task, 1 of them only for some answers.",
    );
    // T3-a11y-behaviour-03: the open team is the current item of the Teams
    // navigation, never a toggle button.
    const pills = () =>
      [...container.querySelectorAll('nav[aria-label="Teams"] button')].map(
        (b: any) => [
          squash(text(b)),
          b.getAttribute("aria-current"),
          b.getAttribute("aria-pressed"),
        ],
      );
    expect(pills()).toEqual([
      ["All teams", null, null],
      ["Every request12", null, null],
      ["Client Success3", null, null],
      ["Operations / Tech5", null, null],
      ["Marketing / ADs3", "true", null],
      ["Media/Creative3", null, null],
      ["Call Center1", null, null],
    ]);
    // CL-09: a request people look for here, filed under another team.
    const related = container.querySelector(".rq-list > .rq-related");
    expect(squash(text(related))).toBe(
      "Ads stopped because a payment card failed? Card missing for ads, under Client Success.",
    );
    await click(related?.querySelector("button"));
    await settle();
    expect(text(container.querySelector(".rq-plate-name"))).toBe(
      "Card missing for ads",
    );
    await click(button("Change"));
    // The flat list, A to Z, each row naming its team.
    await click(buttonStarting("Every request"));
    const all = [...container.querySelectorAll(".rq-row .rq-type-name")].map(
      el => text(el),
    );
    expect(all).toEqual([...all].sort((a, b) => a.localeCompare(b, "en")));
    expect(all.length).toBe(12);
    expect(
      pills()
        .filter(p => p[1] === "true")
        .map(p => p[0]),
    ).toEqual(["Every request12"]);
    // The way back to the map is always there.
    await click(button("All teams"));
    expect(
      [...container.querySelectorAll(".rq-group-label")].map(el => text(el)),
    ).toEqual([
      "Client Success",
      "Operations / Tech",
      "Marketing / ADs",
      "Media/Creative",
      "Call Center",
    ]);
  });

  test("an optional choice can be cleared, and nothing is sent for it", async () => {
    await render();
    await pick("Create a landing page");
    await pickClient("Dune Build Co");
    await choose("page_goal", "Book a call");
    expect(text(checkedChoice("page_goal"))).toContain("Book a call");
    await click(button("Clear"));
    expect(checkedChoice("page_goal")).toBeNull();
    expect(button("Clear")).toBeUndefined();
    await click(button("Send request"));
    await flush(4);
    expect(submits()[0].args.p_answers.page_goal).toBeUndefined();
  });

  test("the recent row: the seat's own last requests, never a type on no offer, gone when the read fails", async () => {
    await render();
    const recent = () =>
      [...container.querySelectorAll(".rq-recent .rq-type-name")].map(el =>
        text(el),
      );
    expect(recent()).toEqual([
      "General tech request",
      "New script",
      "Client pause",
    ]);
    const reads = fake.calls.filter(c => c.name === "cockpit_requests_read");
    expect(reads.length).toBe(1);
    expect(reads[0].args).toEqual({ p_view: "mine", p_limit: 20 });
    await act(async () => root.render(null));
    await flush(2);
    before = name =>
      name === "cockpit_requests_read"
        ? { data: null, error: { message: "Failed to fetch" } }
        : null;
    await render();
    expect(recent()).toEqual([]);
    expect(page()).toContain("Who does what");
  });

  test("while requests are not open to the seat, the route says where it goes, with no timing and no client asked (BT-1, CL-03)", async () => {
    fake = createRequestsFake({ seat: "csm", mode: "dry_run", now: () => NOW });
    await render();
    await pick("General tech request");
    expect(button("Send request")).toBeUndefined();
    // CL-04: true in every writer state, never "once requests open".
    expect(text(container.querySelector(".rq-next .rq-kicker"))).toBe(
      "Where it goes",
    );
    expect(page()).toContain(
      "This request is made on the ClickUp request form for now, so the cockpit asks you nothing here. The same questions open here once the cockpit can send requests for you.",
    );
    // The timing words appear only while requests are open to the seat.
    expect(page()).not.toContain("minute or two");
    expect(page()).not.toContain("When requests open");
    expect(lanes()[0]).toContain("Goes to Operations / Tech");
    // Two tasks: side by side under "Two tasks", each named after the client
    // it is for, never "Pick the client" with no client field on the page.
    await click(button("Change"));
    await pick("Client pause");
    expect(container.querySelector('[data-field="client"]')).toBeNull();
    expect(page()).not.toContain("minute or two");
    expect(page()).not.toContain("Pick the client");
    expect(lanes().length).toBe(2);
    for (const lane of lanes())
      expect(lane).toContain("Named after the client it is for.");
    expect(text(container.querySelector(".rq-fork-note"))).toBe("Two tasks");
    // A deciding question the seat cannot answer here is named, not "yours".
    await click(button("Change"));
    await pick("Low schedule rate");
    expect(text(container.querySelector(".rq-route-sum"))).toBe(
      'One or two tasks, depending on the answer to "Where is the problem?"',
    );
    expect(text(container.querySelector(".rq-fork-note"))).toBe(
      "Depends on the answer",
    );
    expect(page()).not.toContain("minute or two");
    // T2-clarity-04: the plate says the same, never "your answer".
    expect(squash(text(container.querySelector(".rq-plate-kicker")))).toBe(
      'Call Center, Marketing / ADs or both, depending on the answer to "Where is the problem?"',
    );
    expect(page()).not.toContain("by your answer");
    // ... and so does its row, a moment before.
    await click(button("Change"));
    await type(container.querySelector('input[type="search"]'), "schedule");
    expect(
      squash(text(container.querySelector(".rq-results .rq-row"))),
    ).toContain('or both, depending on the answer to "Where is the problem?"');
    expect(page()).not.toContain("by your answer");
    // T2-clarity-03: a database from before 20261028a never asks this seat
    // to pick a question that is not on the page.
    await act(async () => root.render(null));
    fake = createRequestsFake({
      seat: "csm",
      mode: "dry_run",
      now: () => NOW,
      routes: false,
    });
    await render();
    await pick("Low schedule rate");
    expect(stop("note")).toContain(
      "Where it goes depends on the answer to one of its questions.",
    );
    expect(page()).not.toContain("to see where it goes");
    expect(page()).not.toContain("Pick ");
  });

  test("a writer gone quiet: held words follow its hedge, refused seats are never told requests are off (CL-04)", async () => {
    // An editor while the writer has not reported: saved, and it goes once
    // the writer runs with requests open, never "once requests open".
    fake = createRequestsFake({ seat: "ceo", mode: "unknown", now: () => NOW });
    await render();
    await pick("General tech request");
    await type(field("details"), "Check the CRM sync.");
    expect(lanes()[0]).toContain("Waits for the writer");
    expect(page()).not.toContain("When requests open");
    expect(page()).toContain(
      "Saved here until the writer runs with requests open.",
    );
    expect(page()).not.toContain("until requests open");
    await click(button("Save request"));
    await flush(4);
    expect(text(container.querySelector(".rq-sent-sub"))).toBe(
      "It goes to ClickUp by itself once the requests writer runs with requests open.",
    );
    expect(page()).not.toContain("Nothing else to do now.");
    // The task's own line says the same, never "when requests open".
    expect(
      [...container.querySelectorAll(".rq-sent-line")].map(el =>
        squash(text(el)),
      ),
    ).toEqual([
      "Saved. Goes to Operations / Tech once the writer runs with requests open.",
    ]);
    expect(page()).not.toMatch(/when requests open/i);
    // Anyone else, with the writer's last report apply: the server's own
    // refusal, and the cockpit's words never say requests are switched off.
    await act(async () => root.render(null));
    fake = createRequestsFake({
      seat: "csm",
      mode: "unknown",
      lastMode: "apply",
      now: () => NOW,
    });
    await render();
    expect(page()).toContain(
      "Requests cannot be sent just now: the requests writer has not reported in the last 15 minutes.",
    );
    await pick("Low schedule rate");
    expect(text(container.querySelector(".rq-next .rq-kicker"))).toBe(
      "Where it goes",
    );
    expect(page()).not.toContain("switched on");
    expect(page()).not.toContain("once requests open");
  });

  test("answers given before requests stop being open to the seat stay on screen to copy (BT-7)", async () => {
    await render();
    await pick("Low schedule rate");
    await pickClient("Dune Build Co");
    await type(
      field("additional_notes"),
      "Bookings fell this month, and the leads look weaker",
    );
    // The writer stops taking requests from this seat; the next preview
    // (read on a choice) says so.
    fake.mode = "dry_run";
    const both = choiceLabel("schedule_rate_issue", "Both")?.querySelector(
      'input[type="radio"]',
    );
    both.focus();
    expect(win.document.activeElement).toBe(both);
    await choose("schedule_rate_issue", "Both");
    await settle();
    expect(button("Send request")).toBeUndefined();
    // T3-a11y-behaviour-02: the pressed choice went with the questions, so
    // focus moves to the note that replaced them, never the page body; the
    // note is named by its sentence and described by the line under it.
    const offNote = container.querySelector(".rq-qs .rq-off") as any;
    expect(win.document.activeElement).toBe(offNote);
    expect(offNote.getAttribute("role")).toBe("group");
    expect(
      text(
        win.document.getElementById(offNote.getAttribute("aria-labelledby")),
      ),
    ).toBe(
      "Requests are not switched on yet. Use the ClickUp request form until then.",
    );
    expect(
      text(
        win.document.getElementById(offNote.getAttribute("aria-describedby")),
      ),
    ).toBe(
      "This request is made on the ClickUp request form for now. Your answers stay here, to copy into it.",
    );
    const kept = squash(text(container.querySelector(".rq-answers")));
    expect(kept).toContain("Your answers so far");
    expect(kept).toContain("ClientDune Build Co");
    expect(kept).toContain(
      "Bookings fell this month, and the leads look weaker",
    );
    expect(page()).toContain(
      "This request is made on the ClickUp request form for now. Your answers stay here, to copy into it.",
    );
    expect(page()).not.toContain("the cockpit asks you nothing here");
  });

  test("a client picked for one request never goes with a request that asks for none (BT-2)", async () => {
    await render();
    await pick("Low schedule rate");
    await pickClient("Dune Build Co");
    await click(button("Change"));
    await pick("New employee onboarding");
    expect(field("client")).toBeNull();
    expect(page()).not.toContain("Dune Build Co");
    const previews = fake.calls.filter(
      c => c.name === "cockpit_request_preview",
    );
    expect(previews.at(-1)?.args.p_type_key).toBe("employee_onboarding");
    expect(previews.at(-1)?.args.p_client_task_id ?? null).toBeNull();
    await type(field("employee_name"), "Test Starter");
    await click(button("Send request"));
    await flush(4);
    expect(submits()[0].args.p_type_key).toBe("employee_onboarding");
    expect(submits()[0].args.p_client_task_id).toBeNull();
    expect(text(container.querySelector(".rq-sent-title"))).toBe(
      "Sent: New employee onboarding",
    );
    // Back to a client request: the client is asked for again.
    await click(button("Ask for something else"));
    await pick("Low schedule rate");
    expect(field("client")).toBeTruthy();
    // T2-behaviour-2: by Change too, so choose() clears the client a request
    // that asks for none was given, not only "Ask for something else".
    await pickClient("Dune Build Co");
    await click(button("Change"));
    await pick("New employee onboarding");
    await click(button("Change"));
    await pick("Card missing for ads");
    expect(field("client")).toBeTruthy();
    // No picked client: the search, and no name in the picked row.
    expect(container.querySelector(".rq-client .rq-client-name")).toBeNull();
    const last = fake.calls
      .filter(c => c.name === "cockpit_request_preview")
      .at(-1);
    expect(last?.args.p_type_key).toBe("card_missing");
    expect(last?.args.p_client_task_id ?? null).toBeNull();
  });

  test("a pressed control that goes takes focus to what replaces it, never the page body (A11Y-01)", async () => {
    const active = () => win.document.activeElement as any;
    await render();
    // "Show the other 3" of a search: focus on the first request it showed.
    const search = container.querySelector('input[type="search"]') as any;
    await type(search, "client");
    await click(buttonStarting("Show the other"));
    await flush(2);
    expect(active()?.classList.contains("rq-row")).toBe(true);
    expect(
      [...container.querySelectorAll(".rq-results .rq-row")].indexOf(active()),
    ).toBe(6);
    // Return with two that match as well: focus on the list, nothing opened.
    await type(search, "watsapp");
    await act(async () => {
      search.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await flush(2);
    expect(container.querySelector(".rq-plate")).toBeNull();
    expect(text(active()?.querySelector(".rq-type-name"))).toBe(
      "WhatsApp connection issue",
    );
    await type(search, "");
    await pick("Create a landing page");
    // A client picked: focus on its Change, named for the field and
    // described by the client and its status (T2-a11y-02).
    await pickClient("Dune Build Co");
    expect(text(active())).toBe("Change");
    expect(active()?.getAttribute("aria-label")).toBe("Change client");
    const described = String(active().getAttribute("aria-describedby"))
      .split(" ")
      .map(id => text(win.document.getElementById(id)));
    expect(described[0]).toBe("Dune Build Co");
    expect(described.length).toBe(
      container.querySelector(".rq-client .rq-client-status") ? 2 : 1,
    );
    // Its Change: back to the client search.
    await click(active());
    await settle();
    expect(active()?.getAttribute("data-field")).toBe("client");
    await pickClient("Dune Build Co");
    // Clear: focus on the question's first choice.
    await choose("page_goal", "Book a call");
    await click(button("Clear"));
    await flush(2);
    expect(active()?.getAttribute("data-field")).toBe("page_goal");
    expect(active()?.checked).toBe(false);
    // Already open: focus on the duplicate's heading; then "Ask for
    // something else" takes it to the search.
    await click(button("Change"));
    await pick("Client pause");
    // The client stays with a request that asks for one; change it here.
    const changes = buttons().filter(b => text(b).trim() === "Change");
    expect(changes.length).toBe(2);
    await click(
      buttons().find(b => b.getAttribute("aria-label") === "Change client"),
    );
    await settle();
    await pickClient("Harbour Interiors");
    await click(button("Send request"));
    await flush(4);
    expect(text(active())).toBe(
      "Already open: Client pause for Harbour Interiors",
    );
    await click(button("Ask for something else"));
    await flush(2);
    expect(active()).toBe(container.querySelector('input[type="search"]'));
  });

  test('a step list\'s "Show the other 3" focuses the first step it showed (A11Y-01)', async () => {
    await render({
      source: "client_page",
      presetClient: { taskId: "86harb002", name: "Dune Build Co" },
      compact: true,
    });
    await pick("Card missing for ads");
    await click(button("Show the other 3"));
    await flush(2);
    const active = win.document.activeElement as any;
    expect(active?.tagName).toBe("LI");
    expect([...active.parentElement.children].indexOf(active)).toBe(2);
    expect(button("Show the other 3")).toBeUndefined();
    // Sent, then "Ask for something else": focus on the search.
    await click(button("Send request"));
    await flush(4);
    await click(button("Ask for something else"));
    await flush(2);
    expect(win.document.activeElement).toBe(
      container.querySelector('input[type="search"]'),
    );
  });

  test('"Try again" after the request types fail takes focus to the search, never the page body (T2-a11y-01)', async () => {
    let failures = 2;
    before = name =>
      name === "cockpit_request_types_read" && failures-- > 0
        ? {
            data: null,
            error: {
              message: "canceling statement due to statement timeout",
              code: "57014",
            },
          }
        : null;
    await render();
    const retry = () => button("Try again");
    expect(retry()).toBeTruthy();
    // Fails again: focus on the next "Try again".
    await click(retry());
    await settle();
    expect(win.document.activeElement).toBe(retry());
    // Read: focus on the search.
    await click(retry());
    await settle();
    expect(page()).toContain("What do you need?");
    expect(win.document.activeElement).toBe(
      container.querySelector('input[type="search"]'),
    );
  });

  test("a task in ClickUp that is not finished takes the warning mark, never the success check (T2-clarity-05)", async () => {
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
    fake.advance();
    stored.parts[0].error =
      "ClickUp refused the owner, due day or priority. Set them on the task in ClickUp.";
    await act(async () => {
      await new Promise(r => setTimeout(r, 5300));
    });
    await flush(4);
    const panel = sentPanel();
    // The heading's words and tone stay; its mark is the warning.
    expect(panel?.getAttribute("data-tone")).toBe("done");
    expect(panel?.hasAttribute("data-unfinished")).toBe(true);
    expect(
      panel?.querySelector(".rq-sent-head svg.lucide-circle-alert"),
    ).toBeTruthy();
    const marks = [...panel.querySelectorAll(".rq-sent-line")] as any[];
    expect(marks.length).toBe(2);
    // The task with the note: the warning, no check; the other: the check.
    expect(marks[0].hasAttribute("data-unfinished")).toBe(true);
    expect(marks[0].querySelector("svg.lucide-circle-check")).toBeNull();
    expect(marks[0].querySelector("svg.lucide-circle-alert")).toBeTruthy();
    expect(marks[1].querySelector("svg.lucide-circle-check")).toBeTruthy();
    expect(text(container.querySelector(".rq-sent-sub"))).toBe(
      "Both tasks are in ClickUp. One is not finished: the note under it says what to check there.",
    );
  }, 15000);

  test("the chosen due day carries the tick, as every chosen pill does (A11Y-03)", async () => {
    await render();
    await pick("WhatsApp connection issue");
    const ticks = () =>
      [
        ...container.querySelectorAll('[data-question="deadline"] .rq-choice'),
      ].map(l => Boolean(l.querySelector("svg.lucide-check")));
    expect(ticks()).toEqual([true, true, false]);
    expect(
      checkedChoice("deadline")?.querySelector("svg.lucide-check"),
    ).toBeTruthy();
    // The unchosen day's tick is drawn but hidden by the CSS, as on the
    // pills; "Pick a day" shows its calendar until it is chosen.
    await choose("deadline", "Pick a day");
    expect(
      checkedChoice("deadline")?.querySelector("svg.lucide-check"),
    ).toBeTruthy();
    expect(
      checkedChoice("deadline")?.querySelector("svg.lucide-calendar-days"),
    ).toBeNull();
  });

  test("Send keeps focus while it sends, and after a refusal that names no field (A11Y-06)", async () => {
    await render();
    await pick("General tech request");
    await type(field("details"), "The CRM sync stopped.");
    let answer: (a: Answer) => void = () => {};
    const pressed: string[] = [];
    before = (name, args) => {
      if (name !== "cockpit_request_submit") return null;
      pressed.push(args.p_request_id);
      return new Promise<Answer>(r => {
        answer = r;
      }) as any;
    };
    const send = button("Send request");
    send.focus();
    await click(send);
    // In flight: never disabled, so focus stays on it; said to be busy; a
    // second press sends nothing.
    expect(text(send)).toBe("Sending");
    expect(send.disabled).toBe(false);
    expect(send.getAttribute("aria-disabled")).toBe("true");
    expect(send.getAttribute("aria-busy")).toBe("true");
    expect(win.document.activeElement).toBe(send);
    await click(send);
    expect(pressed.length).toBe(1);
    // Refused with a sentence that names no field: the alert says why, and
    // focus is still on Send for the next press.
    await act(async () => {
      answer({ data: null, error: { message: "Failed to fetch" } });
    });
    await flush(4);
    expect(text(container.querySelector('.rq-send [role="alert"]'))).toBe(
      "The cockpit could not reach the database. Check your connection, then try again.",
    );
    expect(button("Send request")).toBe(send);
    expect(send.hasAttribute("aria-disabled")).toBe(false);
    expect(win.document.activeElement).toBe(send);
  });

  test("errors: said after focus moves, each radio carries its sentence, the question marked, the client's note under its search (A11Y-02, A11Y-07, A11Y-13)", async () => {
    await render();
    await pick("Low schedule rate");
    const status = container.querySelector(
      '.rq-send > p.rq-sr[role="status"]',
    ) as any;
    // What the polite line holds each time it changes, and where focus is
    // at that moment.
    const heard: { said: string; focus: string | null }[] = [];
    const watch = new win.MutationObserver(() => {
      if (text(status))
        heard.push({
          said: text(status),
          focus: win.document.activeElement?.getAttribute("data-field") ?? null,
        });
    });
    watch.observe(status, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    await click(button("Send request"));
    await flush(2);
    watch.disconnect();
    // Filled only once focus is on the first answer to fix, so a focus
    // change never cuts the summary off.
    expect(heard.length).toBeGreaterThan(0);
    expect(heard.every(h => h.focus === "client")).toBe(true);
    expect(heard.at(-1)?.said).toBe(
      "Fix these two answers first: Client: pick a client. Where is the problem?: pick one.",
    );
    // Each radio of the question in error carries its sentence, so the one
    // focused says why (A11Y-07); the question is marked as in error, which
    // the CSS draws as a red edge (A11Y-13).
    const group = container.querySelector(
      '[data-question="schedule_rate_issue"] [role="radiogroup"]',
    ) as any;
    expect(group?.getAttribute("aria-invalid")).toBe("true");
    const radios = [...group.querySelectorAll('input[type="radio"]')] as any[];
    expect(radios.length).toBe(3);
    for (const r of radios) {
      expect(r.getAttribute("aria-invalid")).toBe("true");
      const said = String(r.getAttribute("aria-describedby"))
        .split(" ")
        .map(id => text(win.document.getElementById(id)));
      expect(said).toContain("Where is the problem?: pick one.");
    }
    // The client's sentence sits right under its search, before the list.
    const note = win.document.getElementById(
      String(field("client").getAttribute("aria-describedby")).split(" ")[0],
    ) as any;
    expect(text(note)).toBe("Client: pick a client.");
    expect(note?.previousElementSibling?.classList.contains("rq-search")).toBe(
      true,
    );
    expect(note?.nextElementSibling?.classList.contains("rq-clients")).toBe(
      true,
    );
  });

  test("one polite line per event: a search's count once typing pauses, the route once settled, the client count once typed (A11Y-08)", async () => {
    await render();
    const search = container.querySelector('input[type="search"]') as any;
    const shown = () => text(container.querySelector(".rq-ask .rq-count"));
    const said = () =>
      text(container.querySelector('.rq-ask p.rq-sr[role="status"]'));
    await type(search, "pause");
    // Shown at once; said once typing pauses, never once a key.
    expect(shown()).not.toBe("");
    expect(said()).toBe("");
    await act(async () => {
      await new Promise(r => setTimeout(r, 600));
    });
    expect(said()).toBe(shown());
    await type(search, "");
    // A pick: while the route is read, its wait shows unsaid and the polite
    // line stays empty; then it says the settled summary.
    await click(buttonStarting("Client pause"));
    const route = () =>
      text(container.querySelector('.rq-next-head [role="status"]'));
    expect(route()).toBe("");
    expect(
      container.querySelector(".rq-route-wait")?.getAttribute("aria-hidden"),
    ).toBe("true");
    await settle();
    expect(container.querySelector(".rq-route-wait")).toBeNull();
    expect(route()).not.toBe("");
    // The client list's count shows, unsaid, until the person types.
    const clientShown = () =>
      text(container.querySelector(".rq-clients .rq-count"));
    const clientSaid = () =>
      text(container.querySelector('.rq-clients p.rq-sr[role="status"]'));
    expect(clientShown()).not.toBe("");
    expect(clientSaid()).toBe("");
    // T3-a11y-behaviour-01: while the read for what is typed waits, the
    // polite line holds no count, never the last read's for an older search
    // ("8 clients match." for "harb"); the count shown keeps the words of
    // the read it counts.
    const before = clientShown();
    await type(field("client"), "harb");
    expect(clientSaid()).toBe("");
    expect(clientShown()).toBe(before);
    expect(clientShown()).not.toContain("match");
    await settle();
    expect(clientSaid()).toBe(clientShown());
    expect(clientSaid()).toBe("1 client matches.");
    await type(field("client"), "harbz");
    expect(clientSaid()).toBe("");
    await settle();
    expect(clientSaid()).toBe("No client matches. Try another spelling.");
  });

  test("names and order: one region on the map, rows named by their name, Clear and the due day named for their question, new tabs said, the sent view in screen order (A11Y-11, A11Y-17, A11Y-18)", async () => {
    await render();
    // The map is the one region; each tile is a group named by its team.
    expect(
      [...container.querySelectorAll("section")].map(s => s.className),
    ).toEqual(["rq-map-wrap"]);
    const tiles = [...container.querySelectorAll(".rq-dept")] as any[];
    expect(tiles.length).toBeGreaterThan(1);
    for (const t of tiles) {
      expect(t.getAttribute("role")).toBe("group");
      expect(
        text(win.document.getElementById(t.getAttribute("aria-labelledby"))),
      ).not.toBe("");
    }
    // A row is named by the request's name, its line and facts described.
    await type(container.querySelector('input[type="search"]'), "pause");
    const row = container.querySelector(".rq-results button.rq-row") as any;
    expect(
      text(win.document.getElementById(row.getAttribute("aria-labelledby"))),
    ).toBe("Client pause");
    expect(
      text(win.document.getElementById(row.getAttribute("aria-describedby"))),
    ).toContain("Operations / Tech");
    await type(container.querySelector('input[type="search"]'), "");
    // The date input is named by the due question and "Pick a day"; the
    // SOP link says it opens a new tab.
    await pick("WhatsApp connection issue");
    const dueLabel = text(
      container.querySelector('[data-question="deadline"] p.rq-label'),
    );
    expect(
      String(
        container
          .querySelector('input[type="date"]')
          ?.getAttribute("aria-labelledby"),
      )
        .split(" ")
        .map(id => text(win.document.getElementById(id))),
    ).toEqual([dueLabel, "Pick a day"]);
    const sop = container.querySelector("a.rq-sop") as any;
    expect(sop?.getAttribute("target")).toBe("_blank");
    expect(text(sop)).toContain("(opens in a new tab)");
    // Clear names its question.
    await click(button("Change"));
    await pick("Create a landing page");
    await pickClient("Dune Build Co");
    await choose("page_goal", "Book a call");
    const goal = text(
      container.querySelector('[data-question="page_goal"] p.rq-label'),
    ).replace(" (optional)", "");
    expect(button("Clear")?.getAttribute("aria-label")).toBe(`Clear ${goal}`);
    // The sent view: the heading, then where it is now, then what was
    // asked, so Tab follows the screen on a phone.
    await click(button("Change"));
    await pick("General tech request");
    await type(field("details"), "The CRM sync stopped.");
    await click(button("Send request"));
    await flush(4);
    expect(
      [...(sentPanel()?.children ?? [])].map((c: any) => c.className),
    ).toEqual(["rq-sent-top", "rq-next rq-tracker", "rq-sent-rest"]);
    // The focused block is a group named by its heading.
    const head = container.querySelector(".rq-sent-head") as any;
    expect(head?.getAttribute("role")).toBe("group");
    expect(
      win.document.getElementById(head.getAttribute("aria-labelledby")),
    ).toBe(container.querySelector(".rq-sent-title"));
  });

  test("a required choice whose options ClickUp lost still takes focus from the summary (A11Y-21)", async () => {
    before = name => {
      if (name !== "cockpit_request_types_read") return null;
      const read = fake.call(name, {});
      const lost = (read.data as any).types
        .find((t: any) => t.key === "low_schedule_rate")
        .fields.find((f: any) => f.key === "schedule_rate_issue");
      lost.options = [];
      return read;
    };
    await render();
    await pick("Low schedule rate");
    await pickClient("Dune Build Co");
    const select = field("schedule_rate_issue");
    expect(select?.tagName).toBe("SELECT");
    expect(select.disabled).toBe(false);
    expect(select.getAttribute("aria-disabled")).toBe("true");
    expect(
      text(
        win.document.getElementById(select.getAttribute("aria-describedby")),
      ),
    ).toBe(
      "This choice could not be read from ClickUp. Ask the systems manager.",
    );
    // T3-design-clarity-05: before any press the form says it cannot be
    // sent here and offers the ClickUp request form as the one teal action;
    // Send is outlined and described by that sentence.
    const blocked =
      'This request cannot be sent here until ClickUp\'s choices for "Where is the problem?" are back. Use the ClickUp request form for now, or ask the systems manager.';
    const way = container.querySelector(".rq-send .rq-blocked") as any;
    expect(squash(text(way?.querySelector("p")))).toBe(blocked);
    const form = way?.querySelector("a") as any;
    expect(form?.getAttribute("href")).toContain(
      "forms.clickup.com/90182518398/f/2kzmr1ky-1178",
    );
    expect(form?.className).toContain("rq-btn-primary");
    expect(container.querySelectorAll(".rq-btn-primary").length).toBe(1);
    const sendButton = button("Send request");
    expect(sendButton.className).toContain("rq-btn-outline");
    expect(
      text(
        win.document.getElementById(
          sendButton.getAttribute("aria-describedby"),
        ),
      ),
    ).toBe(blocked);
    await click(sendButton);
    await flush(2);
    expect(win.document.activeElement).toBe(field("schedule_rate_issue"));
    expect(submits()).toEqual([]);
    // The summary never asks to fix what cannot be fixed here.
    expect(text(container.querySelector(".rq-summary p"))).toBe(
      "This request cannot be sent here yet:",
    );
    // Its summary entry takes focus back to it.
    (win.document.activeElement as any)?.blur?.();
    const entry = [...container.querySelectorAll(".rq-summary button")].find(
      (b: any) =>
        text(b) ===
        "Where is the problem?: this choice could not be read from ClickUp. Ask the systems manager.",
    );
    await click(entry);
    await flush(2);
    expect(win.document.activeElement).toBe(field("schedule_rate_issue"));
  });

  test("a question ClickUp lost: the route says why, never asks to pick it (BT-6, S4)", async () => {
    // As 20261028a sends it: the question has no choice left, and every task
    // it decides runs on none (when.options []).
    before = name => {
      if (name !== "cockpit_request_types_read") return null;
      const read = fake.call(name, {});
      const low = (read.data as any).types.find(
        (t: any) => t.key === "low_schedule_rate",
      );
      low.fields.find((f: any) => f.key === "schedule_rate_issue").options = [];
      for (const p of low.parts)
        if (p.when) p.when = { ...p.when, options: [] };
      return read;
    };
    await render();
    await pick("Low schedule rate");
    await pickClient("Dune Build Co");
    expect(field("schedule_rate_issue")?.getAttribute("aria-disabled")).toBe(
      "true",
    );
    expect(lanes()).toEqual([]);
    expect(stop("note")).toContain(
      "Where it goes rests on a choice that could not be read from ClickUp. Ask the systems manager.",
    );
    expect(page()).not.toContain("to see where it goes");
    expect(page()).not.toContain("Decides where it goes");
    // T3-design-clarity-05: a request that cannot be sent here is told no
    // Now, Due, After that or cancel line, as the route ahead of requests
    // opening: only where it would go.
    expect(text(container.querySelector(".rq-next .rq-kicker"))).toBe(
      "Where it goes",
    );
    for (const kind of ["send", "held", "due", "bell"])
      expect({ kind, shown: stop(kind) }).toEqual({ kind, shown: "" });
    expect(page()).not.toContain("You can cancel it from the request");
    expect(page()).not.toContain("You send it.");
  });
});
