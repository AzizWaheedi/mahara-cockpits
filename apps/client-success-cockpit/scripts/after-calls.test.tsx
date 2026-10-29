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
  rpc: async (name: string) => {
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
        mode: "shadow",
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
  useCockpitAuth: () => ({ client, session: { user: { id: "seat-1" } } }),
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
