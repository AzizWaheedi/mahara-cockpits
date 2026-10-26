import { afterEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

/**
 * The practice client (docs/call-guide/DESIGN.md): the real call screens on
 * a made-up client, with the call guide. Every save stays in this browser,
 * no network call is made, its windows and channels never meet a real
 * client's, its Blueprint runs as a rehearsal, and a practice run never
 * counts towards help off.
 *
 * Run: bun test scripts/practice-client.test.tsx
 */

const win = new Window({
  url: "https://localhost/client-success/practice",
  width: 1440,
  height: 900,
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
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "KeyboardEvent",
  "MouseEvent",
  "FocusEvent",
  "MessageEvent",
  "StorageEvent",
  "DocumentFragment",
  "Text",
  "NodeFilter",
  "MutationObserver",
  "getComputedStyle",
  "sessionStorage",
  "localStorage",
  "Image",
])
  (globalThis as Record<string, unknown>)[k] =
    k === "window" ? win : (win as unknown as Record<string, unknown>)[k];
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as Record<string, unknown>).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

/** The windows' channel, in memory: every other open channel of the name hears a post. */
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

// Any network call is a failure: the practice client has none.
const fetched: string[] = [];
(globalThis as Record<string, unknown>).fetch = async (u: unknown) => {
  fetched.push(String(u));
  throw Error("The practice client made a network call.");
};

mock.module("@/auth/SupabaseAuthProvider", () => ({
  useCockpitAuth: () => ({ client: null, name: "Huda Ali", email: "" }),
}));

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { MemoryRouter, Route, Routes } = await import("react-router");
const { DeckHub, channelName } = await import("../src/present/channel");
const { HELP_KEY } = await import("../src/present/callSteps");
const { PRACTICE_CALL, practiceFrame, practicePathOf } = await import(
  "../src/present/deckHost"
);
const {
  clearPractice,
  PRACTICE_TASK,
  practiceIO,
  practiceKickoff,
  practiceLoaded,
  practiceUrls,
  practiceWindow,
} = await import("../src/practice/practiceClient");
const { practiceForm } = await import("../src/practice/practiceForm");
const PracticeDeckPage = (await import("../src/practice/PracticeDeckPage"))
  .default;
const PracticePage = (await import("../src/practice/PracticePage")).default;

const settle = async () => {
  for (let i = 0; i < 6; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
};

let unmounts: (() => void)[] = [];

async function mount(node: React.ReactNode) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(node));
  await settle();
  unmounts.push(() => root.unmount());
  return host;
}

/** A practice deck view at its own address, as the router draws it. */
async function openPractice(path: string, deck?: "blueprint") {
  win.history.replaceState({}, "", `/client-success${path}`);
  const notes = path.split("?")[0].endsWith("/notes");
  return mount(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/practice/present/:deck"
          element={<PracticeDeckPage deck={deck} />}
        />
        <Route
          path="/practice/present/:deck/notes"
          element={<PracticeDeckPage deck={deck} notes={notes} />}
        />
        <Route path="/practice" element={<p>The practice page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const body = () => win.document.body.textContent ?? "";
const band = () =>
  win.document.querySelector('[aria-label="How this call runs"]');
const lit = () =>
  band()?.querySelector('[data-state="now"]')?.getAttribute("data-step") ??
  null;

afterEach(async () => {
  for (const u of unmounts) await act(async () => u());
  unmounts = [];
  win.document.body.innerHTML = "";
  delete win.document.documentElement.dataset.guideNow;
  win.localStorage.clear();
  win.sessionStorage.clear();
  Channel.open.clear();
  fetched.length = 0;
});

describe("its addresses", () => {
  test("its windows and channel carry the practice card ID, never a client's", () => {
    expect(PRACTICE_TASK).toBe("practice-client");
    expect(practiceUrls("onboarding")).toEqual({
      deck: "/client-success/practice/present/onboarding",
      notes: "/client-success/practice/present/onboarding/notes",
      prep: "/client-success/practice/present/onboarding?view=prep",
      client: "/client-success/practice",
      other: "/client-success/practice/present/launch?view=prep",
    });
    expect(practiceWindow("launch", true)).toBe(
      "mahara-prep-practice-client-launch",
    );
    expect(channelName(PRACTICE_TASK, "onboarding")).toContain(
      "practice-client",
    );
  });

  test("the creative director's frames point at the practice Blueprint only", () => {
    expect(practiceFrame("prep", "part2")).toBe(
      "/client-success/practice/present/blueprint?view=prep&host=creative&notes=%2Fcreative%2Fblueprint%2Fpractice%2Fnotes#part2",
    );
    expect(practiceFrame("notes")).toBe(
      "/client-success/practice/present/blueprint/notes?host=creative",
    );
    expect(PRACTICE_CALL.notes).toBe("/creative/blueprint/practice/notes");
    expect(practicePathOf("/client-success/practice/present/blueprint")).toBe(
      "deck",
    );
    expect(
      practicePathOf("/client-success/practice/present/blueprint/notes"),
    ).toBe("notes");
    expect(
      practicePathOf(
        "/client-success/clients/practice-client/present/blueprint",
      ),
    ).toBeNull();
  });
});

describe("the made-up client", () => {
  test("starts before the kickoff, with nothing booked, presented by the person practising", () => {
    const l = practiceLoaded("onboarding", "Huda Ali");
    expect(l.kit?.clickup_task_id).toBe(PRACTICE_TASK);
    expect(l.kit?.forms?.kickoff).toBeUndefined();
    expect(l.sources?.calls?.next?.blueprint).toBeUndefined();
    expect(l.sources?.calls?.next?.launch).toBeUndefined();
    expect(l.sources?.presenter?.firstName).toBe("Huda");
    expect(l.sources?.clientName).toBe("Noor Studio Interiors");
  });

  test("its Blueprint allows a rehearsal and no write", () => {
    const l = practiceLoaded("blueprint", null);
    expect(l.blueprint?.can).toEqual({ write: false, rehearse: true });
    expect(l.kit?.clickup_task_id).toBe(PRACTICE_TASK);
  });

  test("prep typed in one window reaches the next, and Start over clears it", async () => {
    const io = practiceIO("onboarding", "Huda Ali");
    await io.savePrep("onboarding", { language: "ar" } as never);
    const again = await practiceIO("onboarding", "Huda Ali").load();
    expect((again.prep.onboarding as { language?: string }).language).toBe(
      "ar",
    );
    clearPractice();
    const fresh = await practiceIO("onboarding", "Huda Ali").load();
    expect(
      (fresh.prep.onboarding as { language?: string }).language,
    ).not.toBe("ar");
    expect(fetched).toEqual([]);
  });
});

describe("the practice kickoff form", () => {
  test("three screens, Submit sends nothing anywhere, then the ending's booking", async () => {
    const container = win.document.createElement("div");
    win.document.body.append(container);
    const said: string[] = [];
    const create = await practiceForm();
    const w = create("tG7dnxBn", {
      container: container as unknown as HTMLElement,
      hidden: { legal_name: "Noor Studio Interiors W.L.L." },
      onStarted: () => said.push("started"),
      onSubmit: e => said.push(`submit ${e.responseId.slice(0, 8)}`),
      onEndingButtonClick: () => said.push("ending"),
    } as never);
    const press = (label: string) =>
      (
        [...container.querySelectorAll("button")].find(
          b => b.textContent === label,
        ) as unknown as HTMLButtonElement
      ).click();
    expect(container.textContent).toContain("question 1 of 3");
    expect(container.textContent).toContain("Noor Studio Interiors W.L.L.");
    press("Yes, they are");
    press("Interior design");
    press("OK");
    expect(container.textContent).toContain("question 3 of 3");
    press("Submit");
    expect(container.textContent).toContain("Kickoff notes received.");
    press("Book the Brand Blueprint call");
    expect(said).toEqual(["started", "submit practice", "ending"]);
    w.unmount();
    expect(container.textContent).toBe("");
    expect(fetched).toEqual([]);
  });

  test("the port is the person practising, and no rehearsal sandbox", () => {
    const port = practiceKickoff("onboarding", {
      name: "Huda Ali",
      email: "huda@example.com",
    });
    expect(port.me).toEqual({ email: "huda@example.com", firstName: "Huda" });
    expect(port.rehearse).toBe(false);
    expect(port.embed).toBe(practiceForm);
  });
});

describe("the practice decks", () => {
  test("prep says it is made up, runs the guide, and never counts the call", async () => {
    await openPractice("/practice/present/onboarding?view=prep");
    expect(win.document.querySelector("[data-practice-note]")).not.toBeNull();
    expect(body()).toContain(
      "Practice client: made up. Nothing is saved, sent or booked.",
    );
    expect(band()?.textContent).toContain("Step 1 of 7");
    // The deck and the notes window, as the other windows on the practice channel.
    const hub = new DeckHub(channelName(PRACTICE_TASK, "onboarding"));
    const say = async (m: Parameters<typeof hub.post>[0]) => {
      await act(async () => hub.post(m));
      await settle();
    };
    await say({ type: "hello", from: "notes" });
    expect(lit()).toBe("present");
    for (const m of [
      {
        type: "state",
        index: 7,
        tour: 0,
        slideId: "kickoff",
        count: 8,
        stops: 1,
        lang: "en",
        startedAt: Date.now(),
      },
      { type: "kickoff-sent", at: new Date().toISOString() },
      { type: "booked", kind: "blueprint", startTime: "2026-10-22T13:00:00Z" },
      { type: "closed" },
    ] as const)
      await say(m as never);
    expect(band()?.textContent).toContain("All 7 steps done");
    expect(win.localStorage.getItem(HELP_KEY)).toBeNull();
    hub.close();
    expect(fetched).toEqual([]);
  });

  test("the notes window says it is made up too", async () => {
    await openPractice("/practice/present/launch/notes");
    expect(win.document.querySelector("[data-practice-note]")).not.toBeNull();
    expect(win.document.querySelector("[data-guide-line]")).not.toBeNull();
    expect(fetched).toEqual([]);
  });

  test("its Blueprint runs as a rehearsal on the practice channel, with one practice line", async () => {
    await openPractice("/practice/present/blueprint?view=prep", "blueprint");
    expect(band()?.textContent).toContain("Step 1 of 7");
    expect(
      win.document.querySelectorAll("[data-practice-note]").length,
    ).toBe(1);
    expect(body()).not.toContain("Rehearsal: nothing is saved or sent.");
    // The practice card ID keeps the plain channel: no ":rehearse" suffix.
    expect(Channel.open.has(channelName(PRACTICE_TASK, "blueprint"))).toBe(
      true,
    );
    expect(
      Channel.open.has(`${channelName(PRACTICE_TASK, "blueprint")}:rehearse`),
    ).toBe(false);
    expect(fetched).toEqual([]);
  });

  test("an unknown deck goes back to the practice page", async () => {
    await openPractice("/practice/present/money?view=prep");
    expect(body()).toContain("The practice page");
  });
});

describe("the practice page", () => {
  test("opens each call's prep in its own named window, and starts over", async () => {
    const opened: string[] = [];
    (win as unknown as { open: unknown }).open = (_u: string, name: string) => {
      const w = {
        location: {
          href: "about:blank",
          replace: (to: string) => opened.push(`${name} ${to}`),
        },
        focus: () => undefined,
      };
      return w;
    };
    win.localStorage.setItem("mahara-practice:v1:prep", "{}");
    await mount(<PracticePage />);
    expect(body()).toContain("Practice client");
    expect(body()).toContain("Onboarding call");
    expect(body()).toContain("Launch call");
    const press = (label: string, n = 0) =>
      act(async () =>
        (
          [...win.document.querySelectorAll("button")].filter(b =>
            b.textContent?.includes(label),
          )[n] as unknown as HTMLButtonElement
        ).click(),
      );
    await press("Start in prep");
    await press("Present", 1);
    expect(opened).toEqual([
      "mahara-prep-practice-client-onboarding /client-success/practice/present/onboarding?view=prep",
      "mahara-deck-practice-client-launch /client-success/practice/present/launch",
    ]);
    await press("Start over");
    expect(win.localStorage.getItem("mahara-practice:v1:prep")).toBeNull();
  });
});
