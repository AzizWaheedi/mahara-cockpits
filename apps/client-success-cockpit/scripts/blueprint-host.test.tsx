import { afterEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

/**
 * Host mode (docs/brand-blueprint/EMBED.md 4.5, 7): the Brand Blueprint
 * deck inside the creative director cockpit's page, in a frame on the same
 * origin. On only for the Blueprint, only in a same-origin frame, only when
 * the address asks; then Present and Back tell the page, the notes window
 * opens at its /creative address, and the frame never shows this app's
 * sign-in or sidebar. Without it, every deck opens today's windows.
 * Synthetic fixtures only; nothing is sent anywhere.
 *
 * Run: bun test scripts/blueprint-host.test.tsx
 */

const ORIGIN = "https://localhost";
const win = new Window({
  url: `${ORIGIN}/client-success/clients/fixture-bp-full/present/blueprint`,
  width: 1920,
  height: 1080,
  settings: {
    disableIframePageLoading: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
  },
});
for (const k of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLIFrameElement",
  "HTMLDetailsElement",
  "HTMLTextAreaElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "KeyboardEvent",
  "MouseEvent",
  "FocusEvent",
  "MessageEvent",
  "DocumentFragment",
  "Text",
  "NodeFilter",
  "MutationObserver",
  "getComputedStyle",
  "sessionStorage",
  "localStorage",
])
  (globalThis as Record<string, unknown>)[k] =
    k === "window" ? win : (win as unknown as Record<string, unknown>)[k];
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
// The prep's live preview measures its box.
(globalThis as Record<string, unknown>).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

class Channel {
  static open = new Map<string, Set<Channel>>();
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(readonly name: string) {
    const set = Channel.open.get(name) ?? new Set<Channel>();
    set.add(this);
    Channel.open.set(name, set);
  }
  postMessage(data: unknown) {
    const copy = JSON.parse(JSON.stringify(data));
    for (const c of Channel.open.get(this.name) ?? [])
      if (c !== this) c.onmessage?.({ data: copy });
  }
  close() {
    Channel.open.get(this.name)?.delete(this);
  }
}
(globalThis as Record<string, unknown>).BroadcastChannel = Channel;

/** The seat, as each test sets it. */
let auth: Record<string, unknown> = {
  client: null,
  name: "Omar",
  email: "",
  ready: true,
  session: { user: { id: "u1" } },
  isAuthenticated: true,
};
// Every export the app's modules name, so a module that finishes loading
// after this file (a lazy chunk) still links when other suites run in the
// same process (auth-password-ui.test.tsx imports getCockpitSupabaseClient).
mock.module("@/auth/SupabaseAuthProvider", () => ({
  useCockpitAuth: () => auth,
  getCockpitSupabaseClient: () => auth.client,
  SupabaseAuthProvider: ({ children }: { children: unknown }) => children,
}));

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { MemoryRouter, Route, Routes } = await import("react-router");
const host = await import("../src/present/deckHost");
const { hostFor, hostFrame } = await import("../src/present/useHost");
const { PresentApp } = await import("../src/present/PresentApp");
const { ProtectedRoute } = await import("../src/components/ProtectedRoute");
const { default: ErrorBoundary } = await import(
  "../src/components/ErrorBoundary"
);
const { useDeckReport } = await import("../src/present/DeckBoundary");
const { blueprintLoaded, fakeBlueprintIO, BP_NOW } = await import(
  "../src/practice/fixtures/blueprintFixtures"
);
const { FIXTURES } = await import("../src/practice/fixtures/fixtures");

type Loaded = import("../src/present/useDeckModel").Loaded;
type DeckKind = import("../src/present/sources").DeckKind;

const NOW = new Date(BP_NOW);
const TASK = "fixture-bp-full";

// ------------------------------------------------------------ the frame

/** What the creative director's page heard. */
const posted: { m: unknown; origin: string }[] = [];
const parent = {
  location: { origin: ORIGIN },
  postMessage: (m: unknown, origin: string) => posted.push({ m, origin }),
};
const other = {
  get location(): never {
    throw new Error("Blocked a frame with origin from accessing another");
  },
  postMessage: () => {},
};

/** This window at an address, framed by our page, another's, or nobody. */
function at(url: string, framed: "same" | "other" | "none" = "same") {
  (
    win as unknown as { happyDOM: { setURL: (u: string) => void } }
  ).happyDOM.setURL(url.startsWith("http") ? url : `${ORIGIN}${url}`);
  Object.defineProperty(win, "parent", {
    value: framed === "same" ? parent : framed === "other" ? other : win,
    configurable: true,
  });
}

/** Every window the page asked for: its name, features and the address it got. */
const opened: { name: string; features?: string; url: string | null }[] = [];
(win as unknown as { open: unknown }).open = (
  _u: string,
  name: string,
  features?: string,
) => {
  const entry: (typeof opened)[number] = { name, features, url: null };
  opened.push(entry);
  return {
    location: {
      href: "about:blank",
      replace: (u: string) => {
        entry.url = u;
      },
    },
    focus: () => {},
  };
};

const types = () =>
  posted.map(p => (p.m as { type?: string }).type).filter(Boolean);

const roots: { unmount: () => void }[] = [];
const flush = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0));
  });

afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  win.document.body.innerHTML = "";
  posted.length = 0;
  opened.length = 0;
});

const URLS = (deck: string) => ({
  deck: `/client-success/clients/${TASK}/present/${deck}`,
  notes: `/client-success/clients/${TASK}/present/${deck}/notes`,
  prep: `/client-success/clients/${TASK}/present/${deck}?view=prep`,
  client: `/client-success/clients/${TASK}?tab=onboarding`,
  other: `/client-success/clients/${TASK}/present/launch?view=prep`,
});

async function mount(
  deck: DeckKind,
  view: "present" | "prep" | "notes",
  opts: {
    loaded?: Loaded;
    load?: () => Promise<Loaded>;
    /** Wraps the Blueprint's fake writes. */
    blueprint?: (
      io: ReturnType<typeof fakeBlueprintIO>,
    ) => ReturnType<typeof fakeBlueprintIO>;
  } = {},
) {
  win.localStorage.setItem("csm_deck_lang", "en");
  const loaded =
    opts.loaded ??
    (deck === "blueprint"
      ? blueprintLoaded("full", "part1", {
          rehearse: win.location.search.includes("rehearse=1"),
        })
      : FIXTURES.full(deck));
  const el = win.document.createElement("div");
  win.document.body.append(el);
  const root = createRoot(el as unknown as Element);
  roots.push(root);
  await act(async () => {
    root.render(
      <PresentApp
        taskId={TASK}
        deck={deck}
        view={view}
        io={{
          load: opts.load ?? (async () => loaded),
          savePrep: async (k, overrides) => ({
            deck: k === "launch" ? "launch" : "onboarding",
            overrides,
            revision: 1,
            changed: true,
          }),
          now: () => NOW,
          ...(deck === "blueprint"
            ? {
                blueprint: (opts.blueprint ?? (x => x))(
                  fakeBlueprintIO(loaded, () => NOW),
                ),
              }
            : {}),
        }}
        urls={URLS(deck)}
      />,
    );
  });
  await flush();
  return el;
}

const button = (el: Element, text: string) =>
  [...el.querySelectorAll("button")].find(
    b => b.textContent?.trim() === text,
  ) as HTMLButtonElement | undefined;
const press = async (key: string) => {
  await act(async () => {
    win.dispatchEvent(new win.KeyboardEvent("keydown", { key, bubbles: true }));
  });
  await flush();
};

const BP = `/client-success/clients/${TASK}/present/blueprint`;

// ------------------------------------------------------------- 1. the switch

describe("host mode is on only for the Blueprint, framed by our own page", () => {
  test("off without ?host=creative", () => {
    at(BP, "same");
    expect(hostFor("blueprint", TASK)).toBeNull();
  });
  test("off when nobody frames the window", () => {
    at(`${BP}?host=creative`, "none");
    expect(hostFor("blueprint", TASK)).toBeNull();
  });
  test("off when another origin frames it", () => {
    at(`${BP}?host=creative`, "other");
    expect(hostFor("blueprint", TASK)).toBeNull();
  });
  test("off for the onboarding and launch decks, even when asked", () => {
    at(`/client-success/clients/${TASK}/present/onboarding?host=creative`);
    expect(hostFor("onboarding", TASK)).toBeNull();
    at(`/client-success/clients/${TASK}/present/launch?host=creative`);
    expect(hostFor("launch", TASK)).toBeNull();
  });
  test("on for the Blueprint in a same-origin frame", () => {
    at(`${BP}?view=prep&host=creative`);
    const h = hostFor("blueprint", TASK);
    expect(h?.notes).toEqual({
      url: `/creative/blueprint/${TASK}/notes`,
      name: `mahara-notes-${TASK}-blueprint`,
    });
    h?.post({ type: "present" });
    expect(posted.at(-1)).toEqual({
      m: { type: "present", source: "mahara-deck-host", v: 1 },
      origin: ORIGIN,
    });
  });
  test("the route's own frame: the Blueprint's paths only", () => {
    at(`${BP}/notes?host=creative`);
    expect(hostFrame()).not.toBeNull();
    at(`/client-success/clients/${TASK}?tab=onboarding&host=creative`);
    expect(hostFrame()).toBeNull();
    at(`/client-success/clients/${TASK}/present/onboarding?host=creative`);
    expect(hostFrame()).toBeNull();
  });
});

// --------------------------------------------------------- 2. the addresses

describe("the protocol file", () => {
  test("creativePath takes a /creative path on this origin, nothing else", () => {
    expect(
      host.creativePath(`/creative/blueprint/86exmpl01/notes?rehearse=1`),
    ).toBe("/creative/blueprint/86exmpl01/notes?rehearse=1");
    for (const bad of [
      "//evil.example/creative/x",
      "/creative//x",
      "/client-success/clients/x",
      "https://evil.example/creative/x",
      "/creative/\\x",
      "/creative/a b",
      "/creative/../client-success/x",
      // The browser reads %2e as a dot: each of these leaves /creative/.
      "/creative/%2e%2e/client-success/x",
      "/creative/.%2e/x",
      "/creative/%2E%2E/",
      "/creative/blueprint/%2e%2e/%2e%2e/api/watchdog",
      `/creative/${"a".repeat(391)}`,
      "",
      null,
    ])
      expect(host.creativePath(bad)).toBeNull();
    expect(`/creative/${"a".repeat(390)}`.length).toBe(400);
    expect(host.creativePath(`/creative/${"a".repeat(390)}`)).not.toBeNull();
  });
  test("an envelope from anyone else, or a malformed one, is dropped", () => {
    const ok = host.frameMessage({ type: "ready", view: "prep", name: "Noor" });
    expect(host.readFrameMessage(ok)).toEqual({
      type: "ready",
      view: "prep",
      name: "Noor",
    });
    expect(host.readFrameMessage({ ...ok, source: "x" })).toBeNull();
    expect(host.readFrameMessage({ ...ok, v: 2 })).toBeNull();
    expect(host.readFrameMessage({ ...ok, view: "elsewhere" })).toBeNull();
    expect(host.readFrameMessage({ type: "present" })).toBeNull();
    expect(
      host.readFrameMessage(
        host.frameMessage({ type: "failed", message: " " }),
      ),
    ).toBeNull();
    const frame = {};
    expect(
      host.acceptFrame(
        { origin: ORIGIN, source: frame, data: ok },
        ORIGIN,
        frame,
      ),
    ).not.toBeNull();
    expect(
      host.acceptFrame(
        { origin: "https://evil.example", source: frame, data: ok },
        ORIGIN,
        frame,
      ),
    ).toBeNull();
    expect(
      host.acceptFrame({ origin: ORIGIN, source: {}, data: ok }, ORIGIN, frame),
    ).toBeNull();
  });
  test("the frame's addresses and the call's", () => {
    expect(
      host.blueprintFrame("86exmpl01", {
        view: "prep",
        rehearse: true,
        notes: "/creative/blueprint/86exmpl01/notes?rehearse=1",
        at: "part2",
      }),
    ).toBe(
      "/client-success/clients/86exmpl01/present/blueprint?view=prep&rehearse=1&host=creative&notes=%2Fcreative%2Fblueprint%2F86exmpl01%2Fnotes%3Frehearse%3D1#part2",
    );
    expect(host.blueprintFrame("86exmpl01", { view: "notes" })).toBe(
      "/client-success/clients/86exmpl01/present/blueprint/notes?host=creative",
    );
    expect(host.blueprintFrame("bad id", { view: "prep" })).toBeNull();
    expect(host.blueprintCall("86exmpl01", true)).toEqual({
      call: "/creative/blueprint/86exmpl01?rehearse=1",
      notes: "/creative/blueprint/86exmpl01/notes?rehearse=1",
    });
    expect(host.blueprintPathOf(`${BP}/notes`)).toEqual({
      taskId: TASK,
      view: "notes",
    });
    expect(host.blueprintPathOf(`/client-success/clients/${TASK}`)).toBeNull();
  });
});

// ----------------------------------------------------------- 3. in host mode

describe("in the creative director cockpit's page", () => {
  test("prep: the data drawn says ready; Present sends what was typed, then tells the page, and opens no window", async () => {
    at(`${BP}?view=prep&host=creative`);
    const order: string[] = [];
    const el = await mount("blueprint", "prep", {
      blueprint: io => ({
        ...io,
        save: async (...a: Parameters<typeof io.save>) => {
          order.push(`save ${Object.keys(a[0]).join(",")}`);
          return io.save(...a);
        },
      }),
    });
    expect(posted[0]?.m).toMatchObject({
      type: "ready",
      view: "prep",
      name: "Noor Studio Interiors",
    });
    // The page above holds the name, the title and what Present does.
    expect(el.textContent).not.toContain("Prepare the Brand Blueprint deck");
    expect(el.textContent).toContain("Back, Next and the strip move it.");
    expect(el.textContent).not.toContain("Present fills");
    expect(el.textContent).not.toContain("in its own window");
    // Its toolbar is the first row under the page's seam: no rule of its
    // own, held at the top as the prep scrolls, its right edge where the
    // page says (past the frame's scrollbar, at the page's own edge).
    const bar = el.querySelector("header") as HTMLElement;
    expect(bar.className).not.toMatch(/(^|\s)border-b(\s|$)/);
    expect(bar.className).toContain("sticky top-0");
    expect(bar.className).toContain("pr-[var(--host-end,16px)]");
    // A line typed a moment before Present, still inside the saver's pause.
    const field = el.querySelector("#part2 textarea") as HTMLTextAreaElement;
    expect(field).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        win.HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(field, "Families finishing a villa shell");
      field.dispatchEvent(new win.Event("input", { bubbles: true }));
    });
    expect(order).toEqual([]);
    const sent = parent.postMessage;
    parent.postMessage = (m: unknown, o: string) => {
      order.push(`post ${(m as { type: string }).type}`);
      sent(m, o);
    };
    try {
      const present = button(el, "Present");
      expect(present).toBeDefined();
      await act(async () => present?.click());
      // The save lands, then the page is told (never more than 1.5 s on).
      for (let i = 0; i < 40 && !order.includes("post present"); i++)
        await act(async () => {
          await new Promise(r => setTimeout(r, 50));
        });
      await flush();
    } finally {
      parent.postMessage = sent;
    }
    expect(order).toHaveLength(2);
    expect(order[0]).toStartWith("save ");
    expect(order[1]).toBe("post present");
    expect(types()).toEqual(["ready", "present"]);
    expect(opened).toEqual([]);
  });

  test("the deck: N opens the notes at /creative, Back says end and closes in place", async () => {
    at(`${BP}?host=creative`);
    const el = await mount("blueprint", "present");
    expect(posted[0]?.m).toMatchObject({ type: "ready", view: "present" });
    await press("n");
    expect(opened).toEqual([
      {
        name: `mahara-notes-${TASK}-blueprint`,
        features: "popup,width=520,height=820",
        url: `/creative/blueprint/${TASK}/notes`,
      },
    ]);
    // The shared deck's document speaks its language (the page's two
    // buttons on the closed screen read it).
    expect(win.document.documentElement.lang).toBe("en");
    const back = el.querySelector(".dk-chrome button") as HTMLButtonElement;
    // It ends the deck in place, so it says so, never "Back to {client}".
    expect(back.textContent?.trim()).toBe("End the deck");
    await act(async () => back.click());
    await flush();
    expect(types()).toEqual(["ready", "end"]);
    expect(el.textContent).toContain("Deck closed");
  });

  test("the notes address the page names wins (the harness's)", async () => {
    at(
      `${BP}?rehearse=1&host=creative&notes=${encodeURIComponent("/creative/blueprint-harness.html?view=notes")}`,
    );
    await mount("blueprint", "present");
    await press("n");
    expect(opened).toEqual([
      {
        name: `mahara-notes-${TASK}-blueprint-rehearse`,
        features: "popup,width=520,height=820",
        url: "/creative/blueprint-harness.html?view=notes",
      },
    ]);
  });

  test("a rehearsal stays one: its own window name and ?rehearse=1", async () => {
    at(`${BP}?rehearse=1&host=creative`);
    await mount("blueprint", "present");
    await press("n");
    expect(opened).toEqual([
      {
        name: `mahara-notes-${TASK}-blueprint-rehearse`,
        features: "popup,width=520,height=820",
        url: `/creative/blueprint/${TASK}/notes?rehearse=1`,
      },
    ]);
  });

  test("a read that failed tells the page the deck's own sentence", async () => {
    at(`${BP}?view=prep&host=creative`);
    const el = await mount("blueprint", "prep", {
      load: async () => {
        throw new Error("The Blueprint is for clients in onboarding.");
      },
    });
    expect(el.textContent).toContain(
      "The Blueprint is for clients in onboarding.",
    );
    expect(posted.map(p => p.m)).toEqual([
      {
        type: "failed",
        message: "The Blueprint is for clients in onboarding.",
        source: "mahara-deck-host",
        v: 1,
      },
    ]);
  });

  test("the notes view: the two window-shaped lines read for one tab", async () => {
    at(`${BP}/notes?host=creative`);
    const el = await mount("blueprint", "notes");
    expect(posted[0]?.m).toMatchObject({ type: "ready", view: "notes" });
    expect(el.textContent).toContain(
      "Share only the Blueprint's tab on the call. The deck fills it; this window stays private.",
    );
    expect(el.textContent).toContain("press Present to follow it here");
    expect(el.textContent).not.toContain("maximised rather than full screen");
  });
});

// ------------------------------------------------------ 4. without a host

describe("without a host, every deck opens today's windows", () => {
  for (const deck of ["blueprint", "onboarding", "launch"] as const)
    test(`${deck}: Present opens the deck window, N the notes window`, async () => {
      // Asked, and framed, but not a frame of ours (or not the Blueprint).
      at(
        `/client-success/clients/${TASK}/present/${deck}?view=prep${deck === "blueprint" ? "" : "&host=creative"}`,
        deck === "blueprint" ? "none" : "same",
      );
      const prep = await mount(deck, "prep");
      expect(prep.textContent).toContain(
        "the shared deck opens in its own window with Present.",
      );
      expect(prep.querySelector("header")?.className).toMatch(
        /(^|\s)border-b(\s|$)/,
      );
      await act(async () => button(prep, "Present")?.click());
      await flush();
      expect(opened.at(-1)).toEqual({
        name: `mahara-deck-${TASK}-${deck}`,
        features: undefined,
        url: URLS(deck).deck,
      });
      at(
        `/client-success/clients/${TASK}/present/${deck}${deck === "blueprint" ? "" : "?host=creative"}`,
        deck === "blueprint" ? "none" : "same",
      );
      const shared = await mount(deck, "present");
      expect(
        shared.querySelector(".dk-chrome button")?.textContent?.trim(),
      ).toStartWith("Back to ");
      await press("n");
      expect(opened.at(-1)).toEqual({
        name: `mahara-notes-${TASK}-${deck}`,
        features: "popup,width=520,height=820",
        url: URLS(deck).notes,
      });
      expect(posted).toEqual([]);
    });
});

// ------------------------------------------------- 5. the sign-in, framed

describe("ProtectedRoute", () => {
  async function route(path: string) {
    const el = win.document.createElement("div");
    win.document.body.append(el);
    const root = createRoot(el as unknown as Element);
    roots.push(root);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<ProtectedRoute />}>
              <Route
                path="/clients/:key/present/blueprint"
                element={<p>the deck</p>}
              />
            </Route>
            <Route path="/login" element={<p>the sign-in page</p>} />
          </Routes>
        </MemoryRouter>,
      );
    });
    await flush();
    return el;
  }
  const PATH = `/clients/${TASK}/present/blueprint`;

  test("in a host frame: one line while the session is checked, never the skeleton", async () => {
    at(`${BP}?view=prep&host=creative`);
    auth = { ready: false, session: null, isAuthenticated: false };
    const el = await route(`${PATH}?view=prep&host=creative`);
    expect(el.textContent).toBe("Opening…");
    expect(el.querySelector("[data-sidebar]")).toBeNull();
  });

  test("in a host frame, signed out: says so and tells the page, no sign-in page", async () => {
    at(`${BP}?view=prep&host=creative`);
    auth = { ready: true, session: null, isAuthenticated: false };
    const el = await route(`${PATH}?view=prep&host=creative`);
    expect(el.textContent).toBe("Sign in to the cockpit again.");
    expect(types()).toEqual(["signed-out"]);
  });

  test("outside a frame: the skeleton, then the sign-in page, as today", async () => {
    at(`${BP}?view=prep&host=creative`, "none");
    auth = { ready: false, session: null, isAuthenticated: false };
    const waiting = await route(`${PATH}?view=prep`);
    expect(waiting.querySelector("[data-sidebar]")).not.toBeNull();
    auth = { ready: true, session: null, isAuthenticated: false };
    const out = await route(`${PATH}?view=prep`);
    expect(out.textContent).toBe("the sign-in page");
    expect(posted).toEqual([]);
  });

  test("signed in, framed or not: the deck", async () => {
    at(`${BP}?view=prep&host=creative`);
    auth = {
      ready: true,
      session: { user: { id: "u1" } },
      isAuthenticated: true,
    };
    const el = await route(`${PATH}?view=prep&host=creative`);
    expect(el.textContent).toBe("the deck");
    expect(posted).toEqual([]);
  });
});

// ------------------------------------------------- 5b. a crash, framed or not

describe("a crash in the frame", () => {
  test("a deck crash report files under the creative director cockpit from its frame, client success elsewhere", async () => {
    const calls: Record<string, unknown>[] = [];
    auth = {
      ready: true,
      session: { user: { id: "u1" } },
      isAuthenticated: true,
      client: {
        rpc: async (fn: string, args: Record<string, unknown>) => {
          calls.push({ fn, ...args });
          return { error: null };
        },
      },
    };
    let report: ReturnType<typeof useDeckReport> | null = null;
    function Probe() {
      report = useDeckReport();
      return null;
    }
    const el = win.document.createElement("div");
    win.document.body.append(el);
    const root = createRoot(el as unknown as Element);
    roots.push(root);
    await act(async () => root.render(<Probe />));
    at(`${BP}?host=creative`);
    await report?.({ title: "Deck slide crashed", detail: "x" });
    at(BP, "none");
    await report?.({ title: "Deck slide crashed", detail: "y" });
    // The server takes an app only with its own role (client-success with
    // csm, creative with creative); the seat's own role is checked after.
    expect(calls.map(c => [c.fn, c.p_app, c.p_role])).toEqual([
      ["cockpit_submit_issue_report", "creative", "creative"],
      ["cockpit_submit_issue_report", "client-success", "csm"],
    ]);
  });

  test("the app's own crash screen never draws in the frame: one line, and the page is told", async () => {
    function Boom(): never {
      throw new Error("a stale chunk");
    }
    const quiet = console.error;
    console.error = () => {};
    try {
      for (const framed of ["same", "none"] as const) {
        at(`${BP}?view=prep&host=creative`, framed);
        posted.length = 0;
        const el = win.document.createElement("div");
        win.document.body.append(el);
        const root = createRoot(el as unknown as Element);
        roots.push(root);
        await act(async () =>
          root.render(
            <ErrorBoundary>
              <Boom />
            </ErrorBoundary>,
          ),
        );
        await flush();
        if (framed === "same") {
          expect(el.textContent).toBe("The Blueprint could not be drawn.");
          expect(el.querySelector("pre")).toBeNull();
          expect(posted.map(p => p.m)).toEqual([
            {
              type: "failed",
              message:
                "The Blueprint could not be drawn. Reload it to go on. Nothing you saved is lost.",
              source: "mahara-deck-host",
              v: 1,
            },
          ]);
        } else {
          expect(el.textContent).toContain("An unexpected error occurred.");
          expect(posted).toEqual([]);
        }
      }
    } finally {
      console.error = quiet;
    }
  });
});

// -------------------------------------------------------- 6. a part by address

describe("prep at a part", () => {
  test("opens and brings up #part2 once drawn, and #part3 when the address changes", async () => {
    auth = {
      client: null,
      name: "Omar",
      email: "",
      ready: true,
      session: { user: { id: "u1" } },
      isAuthenticated: true,
    };
    const seen: string[] = [];
    const proto = win.HTMLElement.prototype as unknown as {
      scrollIntoView: (o?: unknown) => void;
    };
    const was = proto.scrollIntoView;
    proto.scrollIntoView = function (this: HTMLElement) {
      seen.push(this.id);
    };
    try {
      at(`${BP}?view=prep&host=creative#part2`);
      const el = await mount("blueprint", "prep");
      expect(seen).toContain("part2");
      expect(
        (el.querySelector("#part2") as HTMLDetailsElement | null)?.open,
      ).toBe(true);
      at(`${BP}?view=prep&host=creative#part3`);
      await act(async () => {
        win.dispatchEvent(new win.Event("hashchange"));
      });
      await flush();
      expect(seen.at(-1)).toBe("part3");
    } finally {
      proto.scrollIntoView = was;
    }
  });
});

// ------------------------------------------------ 7. the headers stay frameable

describe("the portal's headers let a /creative page frame /client-success", () => {
  const read = (app: string) =>
    JSON.parse(
      readFileSync(
        new URL(`../../${app}/vercel.json`, import.meta.url),
        "utf8",
      ),
    ) as { headers?: { headers: { key: string; value: string }[] }[] };
  const all = (app: string) =>
    (read(app).headers ?? []).flatMap(h => h.headers);
  const policy = (app: string) =>
    all(app)
      .filter(h => h.key.toLowerCase() === "content-security-policy")
      .map(h => h.value)
      .join("; ");

  test("the media buyer's header (the one browsers get on the portal)", () => {
    const p = policy("media-buyer-cockpit");
    expect(p).toMatch(/frame-ancestors 'self'(;|$)/);
    const src = /(?:^|;)\s*frame-src([^;]*)/.exec(p);
    if (src) expect(src[1]).toContain("'self'");
    expect(p).not.toMatch(/default-src/);
  });

  test("the creative director's own header never forbids framing ours", () => {
    const src = /(?:^|;)\s*frame-src([^;]*)/.exec(
      policy("creative-director-cockpit"),
    );
    if (src) expect(src[1]).toContain("'self'");
  });

  test("each app's own header refuses other sites' frames (their direct hosts)", () => {
    for (const app of ["client-success-cockpit", "creative-director-cockpit"])
      expect(policy(app)).toMatch(/frame-ancestors 'self'(;|$)/);
  });

  test("no X-Frame-Options on the portal, client success or creative director", () => {
    for (const app of [
      "media-buyer-cockpit",
      "client-success-cockpit",
      "creative-director-cockpit",
    ])
      expect(
        all(app).filter(h => h.key.toLowerCase() === "x-frame-options"),
      ).toEqual([]);
  });
});
