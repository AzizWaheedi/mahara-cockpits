import {
  afterAll,
  afterEach,
  describe,
  expect,
  mock,
  setDefaultTimeout,
  setSystemTime,
  test,
} from "bun:test";
import { Window } from "happy-dom";

/**
 * Today's "After your calls" and the nudges it shares with the Message
 * panel and Loose ends (src/components/AfterCalls.tsx, src/lib/
 * formsRegistry.ts; docs/forms/STAGE2-CONTRACT.md 8.6): hidden when there
 * is nothing and every read worked, five rows and "See all", the call
 * store's failure line, onboarding and Blueprint calls left out. Until the
 * cut-over each row opens the Typeform; after it opens, the row says so for
 * 30 minutes instead of offering it again; a form Typeform already holds
 * reads as sent and opens nothing; when Typeform cannot be read the browser
 * marker holds the row, then the button comes back; a storage that throws
 * shows the button. Supabase and Typeform are a stand-in here.
 *
 * Stage 2b (docs/forms/STAGE2B-CONTRACT.md 4.10, 4.15, 5.2): once the 1-1
 * notes are native, Typeform is asked nothing and every row opens the
 * window; the seat's impromptu calls with no client join the list, each
 * placed on its client from a sheet or set aside as not a 1-1 call.
 *
 * Run: bun test scripts/after-calls.test.tsx
 */

setDefaultTimeout(30_000);

const win = new Window({
  url: "https://localhost/client-success/dashboard",
  width: 1440,
  height: 900,
});
const DOM = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLAnchorElement",
  "HTMLInputElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "KeyboardEvent",
  "MouseEvent",
  "PointerEvent",
  "FocusEvent",
  "DocumentFragment",
  "Text",
  "NodeFilter",
  "MutationObserver",
  "getComputedStyle",
  "sessionStorage",
  "localStorage",
  "StorageEvent",
  "InputEvent",
  "ResizeObserver",
  "DOMRect",
  "requestAnimationFrame",
  "cancelAnimationFrame",
];
const before = new Map(
  DOM.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
);
for (const k of DOM)
  Object.defineProperty(globalThis, k, {
    configurable: true,
    writable: true,
    value:
      k === "window"
        ? win
        : typeof (win as any)[k] === "function" && /^[a-z]/.test(k)
          ? (win as any)[k].bind(win)
          : (win as any)[k],
  });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** What checkin.typeformSent answers, per card. */
let sentAnswer: Record<string, { sent: boolean | null; at: string | null }> =
  {};
const asked: { taskId: string; since: string }[][] = [];
let entryFails = false;
/** Where the registry says 1-1 notes go. */
let provider: "typeform" | "native" = "typeform";
/** The queue of calls and forms with no client (cockpit_csm_unmatched_list). */
let queue: any[] = [];
let queueFails = false;
let refuseMatch: string | null = null;
let refuseSettle: string | null = null;
/** The settle never answers: a row caught while its call runs. */
let holdSettle = false;
const rpcs: { name: string; args: any }[] = [];

const client = {
  auth: {
    getUser: async () => ({ data: { user: { id: "seat-1" } }, error: null }),
    getSession: async () => ({
      data: { session: { user: { id: "seat-1" } } },
      error: null,
    }),
    onAuthStateChange: () => ({
      data: { subscription: { unsubscribe: () => {} } },
    }),
  },
  rpc: async (name: string, args?: any) => {
    rpcs.push({ name, args });
    if (name === "cockpit_csm_unmatched_list")
      return queueFails
        ? { data: null, error: { message: "Failed to fetch" } }
        : { data: queue, error: null };
    if (name === "cockpit_csm_manual_match")
      return refuseMatch
        ? { data: null, error: { message: refuseMatch } }
        : { data: { ok: true, clientName: "City Wood" }, error: null };
    if (name === "cockpit_csm_candidate_settle" && holdSettle)
      return new Promise(() => {});
    if (name === "cockpit_csm_candidate_settle")
      return refuseSettle
        ? { data: null, error: { message: refuseSettle } }
        : {
            data: { ok: true, callId: 9001, reason: args?.p_reason },
            error: null,
          };
    if (name !== "cockpit_form_entry") throw Error(`Unexpected RPC ${name}`);
    if (entryFails)
      return { data: null, error: { message: "Failed to fetch", code: "" } };
    return {
      data: {
        key: "checkin",
        title: "1-1 call notes",
        provider,
        typeformId: "fRokTITH",
        version: 1,
        native: true,
        mode: provider === "native" ? "live" : "shadow",
        now: "2026-10-25T08:30:00Z",
      },
      error: null,
    };
  },
  functions: {
    invoke: async (_fn: string, { body }: { body: any }) => {
      if (body.op !== "checkin.typeformSent")
        throw Error(`Unexpected op ${body.op}`);
      asked.push(body.items);
      return {
        data: {
          items: body.items.map((i: { taskId: string }) => ({
            taskId: i.taskId,
            ...(sentAnswer[i.taskId] ?? { sent: false, at: null }),
          })),
          now: "2026-10-25T08:30:00Z",
        },
        error: null,
      };
    },
  },
};

const toasts: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((m: string) => toasts.push(m), {
    success: (m: string) => toasts.push(m),
    error: (m: string) => toasts.push(m),
    info: (m: string) => toasts.push(m),
    warning: (m: string) => toasts.push(m),
  }),
  Toaster: () => null,
}));
// The module's whole surface: files after this one import it too.
mock.module("@/auth/SupabaseAuthProvider", () => ({
  getCockpitSupabaseClient: () => client,
  SupabaseAuthProvider: ({ children }: { children: unknown }) => children,
  useCockpitAuth: () => ({
    client,
    session: { user: { id: "seat-1" } },
    email: "CSM@example.test",
  }),
}));

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { MemoryRouter } = await import("react-router");
const { AfterCalls, NotesNudge, afterCallRows } = await import(
  "../src/components/AfterCalls"
);
const { forgetFormsRegistry, markTypeformOpened } = await import(
  "../src/lib/formsRegistry"
);

const NOW = Date.parse("2026-10-25T08:30:00Z");

const roots: ReturnType<typeof createRoot>[] = [];
const settle = async (n = 6) => {
  for (let i = 0; i < n; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 15));
    });
};
const page = () =>
  (win.document.body.textContent ?? "").replace(/\s+/g, " ").trim();
const buttons = () =>
  Array.from(win.document.body.querySelectorAll("button")) as any[];
const named = (name: string) =>
  buttons().filter(b => (b.textContent ?? "").trim() === name);

/** Window.open, recorded: the blank tab the click opens, sent to the form. */
const tabs: { url: string; sentTo: string[]; closed: boolean }[] = [];
function stubOpen() {
  (win as any).open = (url: string) => {
    const tab = {
      url,
      sentTo: [] as string[],
      closed: false,
    };
    tabs.push(tab);
    return {
      opener: {},
      location: { replace: (u: string) => tab.sentTo.push(u), href: url },
      close: () => {
        tab.closed = true;
      },
      focus: () => {},
    };
  };
}

async function mount(node: any) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>));
  await settle();
  return host;
}

const row = (taskId: string, name: string, n: number, kind = "checkin") => ({
  taskId,
  name,
  noteMissing: true,
  lastCall: `2026-10-${String(25 - n).padStart(2, "0")}`,
  lastCallKind: kind,
});

afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  win.document.body.innerHTML = "";
  win.localStorage.clear();
  forgetFormsRegistry();
  sentAnswer = {};
  asked.length = 0;
  tabs.length = 0;
  toasts.length = 0;
  entryFails = false;
  provider = "typeform";
  queue = [];
  queueFails = false;
  refuseMatch = null;
  refuseSettle = null;
  holdSettle = false;
  rpcs.length = 0;
  setSystemTime();
});
afterAll(async () => {
  await win.happyDOM.close();
  for (const [k, d] of before) {
    if (d) Object.defineProperty(globalThis, k, d);
    else delete (globalThis as any)[k];
  }
});

describe("the card", () => {
  test("hidden when there is nothing and every read worked", async () => {
    const host = await mount(
      <AfterCalls snap={{ clients: [], callStoreError: null }} />,
    );
    expect(host.innerHTML).toBe("");
  });

  test("a call store it could not read is said, never counted as zero", async () => {
    await mount(
      <AfterCalls snap={{ clients: [], callStoreError: "Failed to fetch" }} />,
    );
    expect(page()).toContain("After your calls");
    expect(page()).toContain(
      "The call store could not be read, so missing notes may be undercounted.",
    );
  });

  test("five rows, newest call first, then See all; onboarding and Blueprint calls are left out", async () => {
    setSystemTime(new Date(NOW));
    const clients = [
      row("86exfix05", "Saffron Living", 4),
      row("86exfix01", "Cedar & Stone Interiors", 0),
      row("86exfix07", "Palm Court Decor", 6),
      row("86exfix02", "Harbor Glassworks", 1),
      row("86exfix08", "Old Harbour Joinery", 2, "onboarding"),
      row("86exfix09", "Granite Row", 3, "blueprint"),
      row("86exfix03", "Juniper Kitchens", 2),
      row("86exfix04", "Atlas Fit-Out Co", 3, "launch"),
      row("86exfix06", "Northwind Floors", 5, "other"),
      { ...row("86exfix10", "Quiet Client", 0), noteMissing: false },
    ];
    expect(afterCallRows(clients).map(c => c.name)).toEqual([
      "Cedar & Stone Interiors",
      "Harbor Glassworks",
      "Juniper Kitchens",
      "Atlas Fit-Out Co",
      "Saffron Living",
      "Northwind Floors",
      "Palm Court Decor",
    ]);
    await mount(<AfterCalls snap={{ clients, callStoreError: null }} />);
    expect(page()).toContain(
      "Cedar & Stone Interiors · check-in call on Sun 25 Oct · no 1-1 notes",
    );
    expect(page()).toContain(
      "Atlas Fit-Out Co · launch call on Thu 22 Oct · no 1-1 notes",
    );
    expect(page()).not.toContain("Old Harbour Joinery");
    expect(page()).not.toContain("Granite Row");
    expect(named("Write 1-1 notes").length).toBe(5);
    expect(page()).not.toContain("Northwind Floors");
    // Five buttons of the same words: each is named for its client.
    expect(
      named("Write 1-1 notes").map(b => b.getAttribute("aria-label")),
    ).toEqual([
      "Write 1-1 notes for Cedar & Stone Interiors",
      "Write 1-1 notes for Harbor Glassworks",
      "Write 1-1 notes for Juniper Kitchens",
      "Write 1-1 notes for Atlas Fit-Out Co",
      "Write 1-1 notes for Saffron Living",
    ]);
    const seeAll = named("See all 7")[0];
    await act(async () => seeAll?.focus());
    await act(async () => seeAll?.click());
    await settle();
    expect(named("Write 1-1 notes").length).toBe(7);
    expect(page()).toContain(
      "Northwind Floors · call on Tue 20 Oct · no 1-1 notes",
    );
    // See all took itself away: focus is on the first row it showed.
    expect((win.document.activeElement?.textContent ?? "").trim()).toBe(
      "Northwind Floors",
    );
  });

  test("Write 1-1 notes carries the external-link mark while it opens the Typeform, and none once native", async () => {
    setSystemTime(new Date(NOW));
    const clients = [row("86exfix01", "Cedar & Stone Interiors", 0)];
    await mount(
      <>
        <AfterCalls snap={{ clients, callStoreError: null }} />
        <NotesNudge taskId="86exfix02" lastCall="2026-10-24">
          Write 1-1 notes
        </NotesNudge>
      </>,
    );
    expect(named("Write 1-1 notes").length).toBe(2);
    for (const b of named("Write 1-1 notes"))
      expect(b.querySelectorAll("svg").length).toBe(1);
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    forgetFormsRegistry();
    provider = "native";
    await mount(
      <>
        <AfterCalls snap={{ clients, callStoreError: null }} />
        <NotesNudge taskId="86exfix02" lastCall="2026-10-24">
          Write 1-1 notes
        </NotesNudge>
      </>,
    );
    expect(named("Write 1-1 notes").length).toBe(2);
    for (const b of named("Write 1-1 notes"))
      expect(b.querySelectorAll("svg").length).toBe(0);
  });
});

describe("after the Typeform opens", () => {
  test("the row says the form is opened for 30 minutes, then offers it again", async () => {
    setSystemTime(new Date(NOW));
    stubOpen();
    await mount(
      <AfterCalls
        snap={{
          clients: [row("86exfix01", "Cedar & Stone Interiors", 0)],
          callStoreError: null,
        }}
      />,
    );
    await act(async () => named("Write 1-1 notes")[0]?.click());
    await settle();
    // A blank tab on the click, sent to the form once Typeform said no.
    expect(tabs[0]?.url).toBe("about:blank");
    expect(tabs[0]?.sentTo).toEqual([
      "https://maharamedia.typeform.com/to/fRokTITH#task_id=86exfix01",
    ]);
    expect(page()).toContain(
      "1-1 form opened at 11:30. It leaves this list when the notes arrive, up to 15 minutes.",
    );
    expect(named("Write 1-1 notes").length).toBe(0);
    setSystemTime(new Date(NOW + 31 * 60_000));
    await act(async () => {
      win.dispatchEvent(new win.StorageEvent("storage", { key: null }));
    });
    await settle();
    expect(named("Write 1-1 notes").length).toBe(1);
  });

  test("a storage that throws shows the button", async () => {
    setSystemTime(new Date(NOW));
    const broken = {
      getItem: () => {
        throw Error("blocked");
      },
      setItem: () => {
        throw Error("blocked");
      },
      removeItem: () => {},
      clear: () => {},
    };
    const store = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: broken,
    });
    try {
      markTypeformOpened("86exfix01", "2026-10-25");
      await mount(
        <AfterCalls
          snap={{
            clients: [row("86exfix01", "Cedar & Stone Interiors", 0)],
            callStoreError: null,
          }}
        />,
      );
      expect(named("Write 1-1 notes").length).toBe(1);
    } finally {
      if (store) Object.defineProperty(globalThis, "localStorage", store);
    }
  });
});

describe("Typeform is asked first", () => {
  test("a form Typeform holds reads as sent on every nudge, and opens nothing", async () => {
    setSystemTime(new Date(NOW));
    stubOpen();
    sentAnswer = {
      "86exfix01": { sent: true, at: "2026-10-25T07:55:00Z" },
    };
    await mount(
      <>
        <AfterCalls
          snap={{
            clients: [
              row("86exfix01", "Cedar & Stone Interiors", 0),
              row("86exfix02", "Harbor Glassworks", 1),
            ],
            callStoreError: null,
          }}
        />
        <NotesNudge taskId="86exfix01" lastCall="2026-10-25">
          1-1 notes missing for the last call
        </NotesNudge>
      </>,
    );
    const line =
      "1-1 form sent at 10:55. It reaches the cockpit at the next sync.";
    expect(page().split(line).length - 1).toBe(2);
    expect(page()).not.toContain("1-1 notes missing for the last call");
    // One question for both clients, since the start of each last call.
    expect(asked.length).toBe(1);
    expect(asked[0]).toEqual([
      { taskId: "86exfix01", since: "2026-10-24T21:00:00.000Z" },
      { taskId: "86exfix02", since: "2026-10-23T21:00:00.000Z" },
    ]);
    // The other client is still offered the form.
    expect(named("Write 1-1 notes").length).toBe(1);
    expect(tabs.length).toBe(0);
  });

  test("when Typeform cannot be read, the marker holds the row, then the button", async () => {
    setSystemTime(new Date(NOW));
    sentAnswer = { "86exfix01": { sent: null, at: null } };
    markTypeformOpened("86exfix01", "2026-10-25", NOW - 5 * 60_000);
    await mount(
      <AfterCalls
        snap={{
          clients: [row("86exfix01", "Cedar & Stone Interiors", 0)],
          callStoreError: null,
        }}
      />,
    );
    expect(page()).toContain("1-1 form opened at 11:25.");
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    win.localStorage.clear();
    forgetFormsRegistry();
    await mount(
      <AfterCalls
        snap={{
          clients: [row("86exfix01", "Cedar & Stone Interiors", 0)],
          callStoreError: null,
        }}
      />,
    );
    expect(named("Write 1-1 notes").length).toBe(1);
  });

  test("a click asks again before the Typeform opens", async () => {
    setSystemTime(new Date(NOW));
    stubOpen();
    await mount(
      <AfterCalls
        snap={{
          clients: [row("86exfix01", "Cedar & Stone Interiors", 0)],
          callStoreError: null,
        }}
      />,
    );
    expect(asked.length).toBe(1);
    // Sent from a phone since the page asked.
    sentAnswer = { "86exfix01": { sent: true, at: "2026-10-25T08:20:00Z" } };
    await act(async () => named("Write 1-1 notes")[0]?.click());
    await settle();
    expect(asked.length).toBe(2);
    expect(tabs[0]?.closed).toBe(true);
    expect(tabs[0]?.sentTo).toEqual([]);
    expect(toasts).toContain(
      "1-1 form sent at 11:20. It reaches the cockpit at the next sync.",
    );
  });
});

// ------------------------------------------------------------ Stage 2b

/** The queue as the RPC lists it: this seat's two candidates, and what never shows. */
const QUEUE = [
  {
    id: 801,
    kind: "call",
    title: "Impromptu Google Meet Meeting",
    at: "2026-10-25T07:34:00Z",
    reason: "No booking, invitee or name matched",
    hint: "4 min before City Wood's booked call",
    host: "csm@example.test",
    candidate: true,
  },
  {
    id: 802,
    kind: "call",
    title: "Impromptu Zoom Meeting",
    at: "2026-10-23T12:05:00Z",
    reason: "No booking, invitee or name matched",
    host: "csm@example.test",
    candidate: true,
  },
  // Another recorder's candidate, a call that is no candidate, a form.
  {
    id: 803,
    kind: "call",
    title: "Impromptu Google Meet Meeting",
    at: "2026-10-24T09:00:00Z",
    reason: "No booking, invitee or name matched",
    host: "other@example.test",
    candidate: true,
  },
  {
    id: 804,
    kind: "call",
    title: "Booked check-in",
    at: "2026-10-24T10:00:00Z",
    reason: "No client matched the booking",
    host: "csm@example.test",
    candidate: false,
  },
  {
    id: 805,
    kind: "form",
    title: "1-1 call notes form",
    at: "2026-10-24T11:00:00Z",
    reason: "The Client ID matched no card",
    host: "csm@example.test",
    candidate: true,
  },
];
const CLIENTS = [
  row("86exfix01", "Cedar & Stone Interiors", 0),
  row("86exfix02", "Harbor Glassworks", 2),
  { taskId: "86excw01", name: "City Wood", noteMissing: false },
  { taskId: "86exar01", name: "شركة الأمل للديكور", noteMissing: false },
];
const menuItem = (name: string) =>
  (
    Array.from(win.document.body.querySelectorAll('[role="menuitem"]')) as any[]
  ).find(i => (i.textContent ?? "").trim() === name);
const byLabel = (label: string) =>
  buttons().find(b => b.getAttribute("aria-label") === label);
async function openMenu(label: string) {
  const trigger = byLabel(label);
  expect(trigger).toBeTruthy();
  await act(async () => {
    trigger.dispatchEvent(
      new win.PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerType: "mouse",
      }),
    );
  });
  await settle();
}
async function search(value: string) {
  const input = win.document.body.querySelector('input[type="search"]') as any;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(
      win.HTMLInputElement.prototype,
      "value",
    )?.set;
    set?.call(input, value);
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
  });
  await settle(2);
}
const rowTexts = () =>
  (
    Array.from(win.document.body.querySelectorAll("[data-rows] > div")) as any[]
  ).map(d => (d.textContent ?? "").replace(/\s+/g, " ").trim());

describe("once the 1-1 notes are native (4.15 item 2)", () => {
  test("Typeform is asked nothing, a stored marker is ignored, and every row opens the window", async () => {
    setSystemTime(new Date(NOW));
    provider = "native";
    // The window is asked for by name (openNamed): a blank one, then sent.
    const windows: { name: string; sentTo: string[] }[] = [];
    (win as any).open = (_u: string, name: string) => {
      const w = { name, sentTo: [] as string[] };
      windows.push(w);
      return {
        location: {
          href: "about:blank",
          replace: (u: string) => w.sentTo.push(u),
        },
        focus: () => {},
      };
    };
    markTypeformOpened("86exfix01", "2026-10-25", NOW - 5 * 60_000);
    await mount(
      <>
        <AfterCalls
          snap={{
            clients: [
              row("86exfix01", "Cedar & Stone Interiors", 0),
              row("86exfix02", "Harbor Glassworks", 1),
            ],
            callStoreError: null,
          }}
        />
        <NotesNudge taskId="86exfix01" lastCall="2026-10-25">
          Write the notes
        </NotesNudge>
      </>,
    );
    expect(asked.length).toBe(0);
    expect(page()).not.toContain("1-1 form opened at");
    expect(named("Write 1-1 notes").length).toBe(2);
    expect(named("Write the notes").length).toBe(1);
    await act(async () => named("Write 1-1 notes")[0]?.click());
    await settle();
    expect(windows).toEqual([
      {
        name: "mahara-form-86exfix01-checkin",
        sentTo: ["/client-success/clients/86exfix01/forms/checkin"],
      },
    ]);
    expect(asked.length).toBe(0);
  });
});

describe("impromptu calls on Today (4.10, 5.2)", () => {
  test("provider typeform: the queue is never read", async () => {
    queue = QUEUE;
    await mount(
      <AfterCalls snap={{ clients: CLIENTS, callStoreError: null }} />,
    );
    expect(rpcs.some(r => r.name === "cockpit_csm_unmatched_list")).toBe(false);
    expect(page()).not.toContain("Impromptu call");
  });

  test("native: the seat's own candidates only, in one list newest first, counted with the rest", async () => {
    setSystemTime(new Date(NOW));
    provider = "native";
    queue = QUEUE;
    await mount(
      <AfterCalls snap={{ clients: CLIENTS, callStoreError: null }} />,
    );
    expect(
      rpcs.filter(r => r.name === "cockpit_csm_unmatched_list").length,
    ).toBe(1);
    expect(rowTexts()).toEqual([
      "Impromptu call on Sun 25 Oct, no client yet10:34 · 4 min before City Wood's booked callPlace itNot a 1-1 call",
      "Cedar & Stone Interiors · check-in call on Sun 25 Oct · no 1-1 notesWrite 1-1 notes",
      "Impromptu call on Fri 23 Oct, no client yet15:05Place itNot a 1-1 call",
      "Harbor Glassworks · check-in call on Fri 23 Oct · no 1-1 notesWrite 1-1 notes",
    ]);
    // The count covers both kinds.
    expect(
      (win.document.body.querySelector("h2")?.textContent ?? "").replace(
        /\s+/g,
        "",
      ),
    ).toBe("Afteryourcalls4");
    // The clock in mono; the orange lamp; no teal on the row.
    const first = win.document.body.querySelector(
      "[data-impromptu='801']",
    ) as any;
    expect(first.querySelector(".font-mono")?.textContent).toBe("10:34");
    expect(first.querySelector(".bg-warning")).toBeTruthy();
    expect(first.innerHTML).not.toMatch(/bg-primary\b|text-primary-ink/);
    // Each button is named with its day and time.
    expect(
      byLabel("Place the impromptu call on Sun 25 Oct, 10:34"),
    ).toBeTruthy();
    expect(
      byLabel("Not a 1-1 call: the impromptu call on Sun 25 Oct, 10:34"),
    ).toBeTruthy();
    expect(
      byLabel("Place the impromptu call on Fri 23 Oct, 15:05"),
    ).toBeTruthy();
    expect(page()).not.toContain("Booked check-in");
    expect(page()).not.toContain("1-1 call notes form");
    expect(rowTexts().length).toBe(4);
  });

  test("Place it: the sheet, focus in Find a client, Arabic search, a pick saved, the row gone, focus moved", async () => {
    setSystemTime(new Date(NOW));
    provider = "native";
    queue = QUEUE;
    let placed = 0;
    await mount(
      <AfterCalls
        snap={{ clients: CLIENTS, callStoreError: null }}
        onPlaced={() => {
          placed += 1;
        }}
      />,
    );
    await act(async () =>
      byLabel("Place the impromptu call on Sun 25 Oct, 10:34")?.click(),
    );
    await settle();
    expect(page()).toContain("Whose call was this?");
    expect(page()).toContain(
      "Pick the client. The call goes on their page, then you can write the 1-1 notes.",
    );
    expect(page()).toContain(
      "Fathom's hint: 4 min before City Wood's booked call",
    );
    const input = win.document.body.querySelector(
      'input[type="search"]',
    ) as any;
    expect(win.document.activeElement).toBe(input);
    expect(
      win.document.body.querySelector(`label[for="${input.id}"]`)?.textContent,
    ).toBe("Find a client");
    // The hint is never chosen for her: every client is listed, none pressed.
    const listed = () =>
      (
        Array.from(
          win.document.body.querySelectorAll('ul[aria-label="Clients"] button'),
        ) as any[]
      ).map(b => (b.textContent ?? "").trim());
    expect(listed()).toEqual([
      "Cedar & Stone Interiors",
      "City Wood",
      "Harbor Glassworks",
      "شركة الأمل للديكور",
    ]);
    // Arabic folded: taa marbuta and the hamza on the alef.
    await search("شركه الامل");
    expect(listed()).toEqual(["شركة الأمل للديكور"]);
    expect(
      win.document.body
        .querySelector('ul[aria-label="Clients"] bdi')
        ?.getAttribute("dir"),
    ).toBe("auto");
    await search("zzz");
    expect(page()).toContain('No client matches "zzz".');
    await search("city");
    const pick = (
      Array.from(
        win.document.body.querySelectorAll('ul[aria-label="Clients"] button'),
      ) as any[]
    )[0];
    await act(async () => pick.click());
    await settle();
    expect(rpcs.find(r => r.name === "cockpit_csm_manual_match")?.args).toEqual(
      {
        p_unmatched_id: 801,
        p_task_id: "86excw01",
      },
    );
    expect(toasts).toContain("Saved on City Wood.");
    expect(placed).toBe(1);
    expect(page()).not.toContain("Whose call was this?");
    expect(
      win.document.body.querySelector("[data-impromptu='801']"),
    ).toBeNull();
    // Focus moves to the row that took its place.
    expect((win.document.activeElement?.textContent ?? "").trim()).toBe(
      "Cedar & Stone Interiors",
    );
  });

  test("a refused pick keeps the sheet and the row, with the server's sentence", async () => {
    setSystemTime(new Date(NOW));
    provider = "native";
    queue = QUEUE;
    refuseMatch = "That client is not on your access list";
    let placed = 0;
    await mount(
      <AfterCalls
        snap={{ clients: CLIENTS, callStoreError: null }}
        onPlaced={() => {
          placed += 1;
        }}
      />,
    );
    await act(async () =>
      byLabel("Place the impromptu call on Sun 25 Oct, 10:34")?.click(),
    );
    await settle();
    await search("city");
    await act(async () =>
      (
        win.document.body.querySelector(
          'ul[aria-label="Clients"] button',
        ) as any
      ).click(),
    );
    await settle();
    expect(
      win.document.body.querySelector('[role="dialog"] [role="alert"]')
        ?.textContent,
    ).toBe("That client is not on your access list");
    expect(placed).toBe(0);
    expect(toasts).toEqual([]);
    expect(
      win.document.body.querySelector("[data-impromptu='801']"),
    ).toBeTruthy();
  });

  test("Escape and the X return focus to Place it", async () => {
    setSystemTime(new Date(NOW));
    provider = "native";
    queue = QUEUE;
    const label = "Place the impromptu call on Fri 23 Oct, 15:05";
    await mount(
      <AfterCalls snap={{ clients: CLIENTS, callStoreError: null }} />,
    );
    const open = async () => {
      const trigger = byLabel(label);
      await act(async () => trigger.focus());
      await act(async () => trigger.click());
      await settle();
      expect(page()).toContain("Whose call was this?");
      const input = win.document.body.querySelector(
        'input[type="search"]',
      ) as any;
      expect(win.document.activeElement).toBe(input);
      return input;
    };
    const closed = () => {
      expect(page()).not.toContain("Whose call was this?");
      // The row stays, and focus is back on its own Place it, never the page.
      expect(
        win.document.body.querySelector("[data-impromptu='802']"),
      ).toBeTruthy();
      expect(win.document.activeElement).toBe(byLabel(label));
    };
    // Escape, from the search field.
    const input = await open();
    await act(async () => {
      input.dispatchEvent(
        new win.KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await settle();
    closed();
    // The sheet's X.
    await open();
    const x = buttons().find(
      b =>
        b.closest('[role="dialog"]') &&
        (b.textContent ?? "").trim() === "Close",
    );
    expect(x).toBeTruthy();
    await act(async () => x.click());
    await settle();
    closed();
    expect(rpcs.some(r => r.name === "cockpit_csm_manual_match")).toBe(false);
  });

  test("Not a 1-1 call: each reason sets it aside; a refusal keeps the row", async () => {
    setSystemTime(new Date(NOW));
    provider = "native";
    const reasons: [string, string][] = [
      ["Part of another call", "part_of_call"],
      ["An onboarding call", "onboarding"],
      ["A Blueprint call", "blueprint"],
      ["Not a client", "not_client"],
    ];
    for (const [label, reason] of reasons) {
      queue = QUEUE;
      rpcs.length = 0;
      toasts.length = 0;
      await mount(<AfterCalls snap={{ clients: [], callStoreError: null }} />);
      await openMenu("Not a 1-1 call: the impromptu call on Sun 25 Oct, 10:34");
      await act(async () => menuItem(label)?.click());
      await settle();
      expect(
        rpcs.find(r => r.name === "cockpit_csm_candidate_settle")?.args,
      ).toEqual({
        p_unmatched_id: 801,
        p_reason: reason,
        p_same_as: null,
      });
      expect(toasts).toContain("Set aside: not a 1-1 call.");
      expect(
        win.document.body.querySelector("[data-impromptu='801']"),
      ).toBeNull();
      for (const r of roots.splice(0)) await act(async () => r.unmount());
      win.document.body.innerHTML = "";
    }
    queue = QUEUE;
    refuseSettle = "Only the CSM who recorded it can set it aside.";
    await mount(<AfterCalls snap={{ clients: [], callStoreError: null }} />);
    await openMenu("Not a 1-1 call: the impromptu call on Sun 25 Oct, 10:34");
    await act(async () => menuItem("Not a client")?.click());
    await settle();
    const kept = win.document.body.querySelector(
      "[data-impromptu='801']",
    ) as any;
    expect(kept).toBeTruthy();
    expect(kept.querySelector('[role="alert"]')?.textContent).toBe(
      "Only the CSM who recorded it can set it aside.",
    );
  });

  test("while its call runs, the menu's keys are held but Tab still moves on", async () => {
    setSystemTime(new Date(NOW));
    provider = "native";
    queue = QUEUE;
    holdSettle = true;
    await mount(<AfterCalls snap={{ clients: [], callStoreError: null }} />);
    const label = "Not a 1-1 call: the impromptu call on Sun 25 Oct, 10:34";
    await openMenu(label);
    await act(async () => menuItem("Not a client")?.click());
    await settle();
    const trigger = byLabel(label);
    expect(trigger.getAttribute("aria-disabled")).toBe("true");
    await act(async () => trigger.focus());
    const press = (key: string, shiftKey = false) => {
      const e = new win.KeyboardEvent("keydown", {
        key,
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      trigger.dispatchEvent(e);
      return e.defaultPrevented;
    };
    let held: Record<string, boolean> = {};
    await act(async () => {
      held = {
        Tab: press("Tab"),
        "Shift+Tab": press("Tab", true),
        Escape: press("Escape"),
        Enter: press("Enter"),
        Space: press(" "),
        ArrowDown: press("ArrowDown"),
        ArrowUp: press("ArrowUp"),
      };
    });
    await settle();
    // Tab's default is focus moving on: never held, so focus is not trapped.
    expect(held).toEqual({
      Tab: false,
      "Shift+Tab": false,
      Escape: false,
      Enter: true,
      Space: true,
      ArrowDown: true,
      ArrowUp: true,
    });
    // The keys that open the menu did not open it.
    expect(win.document.body.querySelector('[role="menu"]')).toBeNull();
    expect(
      rpcs.filter(r => r.name === "cockpit_csm_candidate_settle").length,
    ).toBe(1);
  });

  test("a queue it could not read keeps the card with its sentence", async () => {
    provider = "native";
    queueFails = true;
    await mount(<AfterCalls snap={{ clients: [], callStoreError: null }} />);
    expect(page()).toContain("After your calls");
    expect(page()).toContain(
      "The calls with no client could not be read, so an impromptu call may be missing here.",
    );
  });

  test("the last row gone: the card says nothing is left, and focus goes to its heading", async () => {
    setSystemTime(new Date(NOW));
    provider = "native";
    queue = [QUEUE[0]];
    await mount(<AfterCalls snap={{ clients: [], callStoreError: null }} />);
    await openMenu("Not a 1-1 call: the impromptu call on Sun 25 Oct, 10:34");
    await act(async () => menuItem("Not a client")?.click());
    await settle();
    expect((win.document.activeElement?.textContent ?? "").trim()).toBe(
      "After your calls",
    );
    expect(page()).toContain("Nothing left from your calls.");
  });
});
