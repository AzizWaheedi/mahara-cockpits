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
 * "Write 1-1 notes", the client header's split button, and the entry rule
 * behind every way into the notes (src/components/FormsButton.tsx,
 * src/lib/formsRegistry.ts; docs/forms/STAGE2-CONTRACT.md 8.4 and 8.6).
 * In 2a every seat's main action opens the Typeform with the card ID, the
 * record, and the menu adds "Try the 1-1 notes in the cockpit"; once the
 * registry is native, the main action opens the window; a failed read keeps
 * the Typeform, offers no shadow item and says why. The orange dot and the
 * menu's missing line give way to "opened" for 30 minutes after the
 * Typeform opens, and to "sent" when Typeform holds the form; a click then
 * opens no second form. Supabase and Typeform are a stand-in here.
 *
 * Run: bun test scripts/forms-button.test.tsx
 */

setDefaultTimeout(30_000);

const win = new Window({
  url: "https://localhost/client-success/clients/86exfix01",
  width: 1440,
  height: 900,
});
const DOM = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLButtonElement",
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
  "ResizeObserver",
  "DOMRect",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
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

let entry: "typeform" | "native" | "fails" = "typeform";
let sentAnswer: Record<string, { sent: boolean | null; at: string | null }> =
  {};
/** Every checkin.typeformSent asked (2b: none once native). */
const typeformAsks: unknown[] = [];

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
    if (entry === "fails")
      return {
        data: null,
        error: { message: "Could not find the function", code: "PGRST202" },
      };
    return {
      data: {
        key: "checkin",
        title: "1-1 call notes",
        provider: entry,
        typeformId: "fRokTITH",
        version: 1,
        native: true,
        mode: entry === "native" ? "live" : "shadow",
        now: "2026-10-25T08:30:00Z",
      },
      error: null,
    };
  },
  functions: {
    invoke: async (_fn: string, { body }: { body: any }) => {
      typeformAsks.push(body);
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
const { FormsButton } = await import("../src/components/FormsButton");
const { ENTRY_FAILED, forgetFormsRegistry, markTypeformOpened } = await import(
  "../src/lib/formsRegistry"
);

const NOW = Date.parse("2026-10-25T08:30:00Z");
const TASK = "86exfix01";
const TYPEFORM = `https://maharamedia.typeform.com/to/fRokTITH#task_id=${TASK}`;

const roots: ReturnType<typeof createRoot>[] = [];
const settle = async (n = 6) => {
  for (let i = 0; i < n; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 15));
    });
};
const page = () =>
  (win.document.body.textContent ?? "").replace(/\s+/g, " ").trim();
const main = () =>
  Array.from(win.document.body.querySelectorAll("button")).find(b =>
    (b.textContent ?? "").includes("Write 1-1 notes"),
  ) as any;
const items = () =>
  (
    Array.from(win.document.body.querySelectorAll('[role="menuitem"]')) as any[]
  ).map(i => (i.textContent ?? "").trim());
const item = (name: string) =>
  (
    Array.from(win.document.body.querySelectorAll('[role="menuitem"]')) as any[]
  ).find(i => (i.textContent ?? "").trim() === name);

/** Every window.open: a blank tab for the Typeform, or the named form window. */
const opens: {
  url: string;
  name: string | undefined;
  sentTo: string[];
  closed: boolean;
}[] = [];
function stubOpen() {
  (win as any).open = (url: string, name?: string) => {
    const o = { url, name, sentTo: [] as string[], closed: false };
    opens.push(o);
    return {
      opener: {},
      location: {
        href: "about:blank",
        replace: (u: string) => o.sentTo.push(u),
      },
      close: () => {
        o.closed = true;
      },
      focus: () => {},
    };
  };
}

async function mount(props: Partial<Parameters<typeof FormsButton>[0]> = {}) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  await act(async () =>
    root.render(
      <FormsButton
        taskId={TASK}
        noteMissing
        lastCall="2026-10-25"
        kickoff={false}
        {...props}
      />,
    ),
  );
  await settle();
}

async function openMenu() {
  const trigger = win.document.body.querySelector(
    'button[aria-label="More ways to fill this client\'s forms"]',
  ) as any;
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
  if (!items().length) {
    await act(async () => {
      trigger.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await settle();
  }
}

afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  win.document.body.innerHTML = "";
  win.localStorage.clear();
  forgetFormsRegistry();
  entry = "typeform";
  sentAnswer = {};
  opens.length = 0;
  toasts.length = 0;
  setSystemTime();
});
afterAll(async () => {
  await win.happyDOM.close();
  for (const [k, d] of before) {
    if (d) Object.defineProperty(globalThis, k, d);
    else delete (globalThis as any)[k];
  }
});

describe("the entry rule", () => {
  test("2a: the main action opens the Typeform with the card ID; the menu offers the cockpit as a shadow run", async () => {
    setSystemTime(new Date(NOW));
    stubOpen();
    await mount({ kickoff: true });
    // It leaves the cockpit for Typeform: one trailing external-link mark
    // after its own icon (docs/DESIGN.md), seen without hovering.
    expect(main().querySelectorAll("svg").length).toBe(2);
    expect(main().lastElementChild?.tagName.toLowerCase()).toBe("svg");
    await act(async () => main().click());
    await settle();
    expect(opens[0]?.url).toBe("about:blank");
    expect(opens[0]?.sentTo).toEqual([TYPEFORM]);
    await openMenu();
    // The missing line is now the opened line, and no longer a way in.
    expect(items()).toEqual([
      "Fill the kickoff",
      "Try the 1-1 notes in the cockpit",
    ]);
    expect(page()).toContain(
      "1-1 form opened at 11:30. It leaves this list when the notes arrive, up to 15 minutes.",
    );
    await act(async () => item("Try the 1-1 notes in the cockpit").click());
    await settle();
    const window = opens.find(o => o.name === `mahara-form-${TASK}-checkin`);
    expect(window?.sentTo).toEqual([
      `/client-success/clients/${TASK}/forms/checkin`,
    ]);
  });

  test("the missing call is the menu's first line, with the orange dot on the button", async () => {
    await mount();
    expect(
      win.document.body.querySelector(
        '[aria-label="1-1 notes missing for the last call"]',
      ),
    ).toBeTruthy();
    await openMenu();
    expect(items()[0]).toBe("Missing for the 25 Oct call");
    expect(items()).not.toContain("Fill the kickoff");
  });

  test("native: the main action opens the window, and there is no shadow item", async () => {
    entry = "native";
    stubOpen();
    await mount({ noteMissing: false, kickoff: true });
    // The cockpit's own window: no external-link mark.
    expect(main().querySelectorAll("svg").length).toBe(1);
    await act(async () => main().click());
    await settle();
    expect(opens.map(o => o.name)).toEqual([`mahara-form-${TASK}-checkin`]);
    expect(opens[0]?.sentTo).toEqual([
      `/client-success/clients/${TASK}/forms/checkin`,
    ]);
    await openMenu();
    expect(items()).toEqual(["Fill the kickoff"]);
  });

  test("2b, native (4.15 item 2): Typeform is asked nothing, a stored marker is ignored, the missing call still shows", async () => {
    entry = "native";
    setSystemTime(new Date(NOW));
    stubOpen();
    typeformAsks.length = 0;
    markTypeformOpened(TASK, "2026-10-25", NOW - 5 * 60_000);
    await mount();
    expect(typeformAsks).toEqual([]);
    // The marker means nothing once native: the dot and the missing line stay.
    expect(
      win.document.body.querySelector(
        '[aria-label="1-1 notes missing for the last call"]',
      ),
    ).toBeTruthy();
    await openMenu();
    expect(page()).not.toContain("1-1 form opened at");
    expect(items()[0]).toBe("Missing for the 25 Oct call");
    await act(async () => {
      win.document.body.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await settle();
    await act(async () => main().click());
    await settle();
    expect(opens[0]?.sentTo).toEqual([
      `/client-success/clients/${TASK}/forms/checkin`,
    ]);
    expect(typeformAsks).toEqual([]);
  });

  test("a failed read keeps the Typeform, offers no shadow item, and says why", async () => {
    entry = "fails";
    stubOpen();
    await mount({ noteMissing: false });
    expect(main().getAttribute("title")).toBe(ENTRY_FAILED);
    expect(
      win.document.body.querySelector(
        'button[aria-label="More ways to fill this client\'s forms"]',
      ),
    ).toBeNull();
    await act(async () => main().click());
    await settle();
    expect(opens[0]?.sentTo).toEqual([TYPEFORM]);
  });
});

describe("after the Typeform opens, and when Typeform holds the form", () => {
  test("the dot and the missing line give way for 30 minutes, then come back", async () => {
    setSystemTime(new Date(NOW));
    stubOpen();
    await mount();
    await act(async () => main().click());
    await settle();
    expect(
      win.document.body.querySelector(
        '[aria-label="1-1 notes missing for the last call"]',
      ),
    ).toBeNull();
    setSystemTime(new Date(NOW + 31 * 60_000));
    await act(async () => {
      win.dispatchEvent(new win.StorageEvent("storage", { key: null }));
    });
    await settle();
    expect(
      win.document.body.querySelector(
        '[aria-label="1-1 notes missing for the last call"]',
      ),
    ).toBeTruthy();
  });

  test("a form Typeform holds: the menu says sent, and a click opens no second form", async () => {
    setSystemTime(new Date(NOW));
    stubOpen();
    sentAnswer = { [TASK]: { sent: true, at: "2026-10-25T08:02:00Z" } };
    await mount();
    await openMenu();
    expect(page()).toContain(
      "1-1 form sent at 11:02. It reaches the cockpit at the next sync.",
    );
    expect(items()).not.toContain("Missing for the 25 Oct call");
    await act(async () => {
      win.document.body.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await settle();
    await act(async () => main().click());
    await settle();
    expect(opens.length).toBe(0);
    expect(toasts).toContain(
      "1-1 form sent at 11:02. It reaches the cockpit at the next sync.",
    );
  });

  test("Typeform unreadable: the marker, then the button", async () => {
    setSystemTime(new Date(NOW));
    sentAnswer = { [TASK]: { sent: null, at: null } };
    stubOpen();
    await mount();
    await act(async () => main().click());
    await settle();
    expect(opens[0]?.sentTo).toEqual([TYPEFORM]);
    await openMenu();
    expect(page()).toContain("1-1 form opened at 11:30.");
  });
});
