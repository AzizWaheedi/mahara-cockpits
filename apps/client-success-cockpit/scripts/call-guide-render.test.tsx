import { afterEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

/**
 * The call guide on the presenter's own screens (docs/call-guide/DESIGN.md):
 * prep's band and the notes window's line, ticked by the call's channel and
 * the record; the beacon on the real control for the step that is now; no
 * guide in the CSM's read-only Blueprint; a real call counted once towards
 * help off, a rehearsal never. Fixtures only; nothing is sent anywhere.
 *
 * Run: bun test scripts/call-guide-render.test.tsx
 */

const win = new Window({
  url: "https://localhost/client-success/clients/fixture-full/present/onboarding?view=prep",
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
  static heard: { name: string; data: unknown }[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(readonly name: string) {
    const set = Channel.open.get(name) ?? new Set<Channel>();
    set.add(this);
    Channel.open.set(name, set);
  }
  postMessage(data: unknown) {
    const copy = JSON.parse(JSON.stringify(data));
    Channel.heard.push({ name: this.name, data: copy });
    for (const c of Channel.open.get(this.name) ?? [])
      if (c !== this) c.onmessage?.({ data: copy });
  }
  close() {
    Channel.open.get(this.name)?.delete(this);
  }
}
(globalThis as Record<string, unknown>).BroadcastChannel = Channel;

mock.module("@/auth/SupabaseAuthProvider", () => ({
  useCockpitAuth: () => ({ client: null, name: "Sara", email: "" }),
}));

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { FIXTURES } = await import("../src/dev/deck/fixtures");
const { blueprintLoaded, fakeBlueprintIO } = await import(
  "../src/dev/deck/blueprintFixtures"
);
const { DeckHub, channelName } = await import("../src/present/channel");
const { PresentApp } = await import("../src/present/PresentApp");
const { HELP_KEY } = await import("../src/present/callSteps");

type Loaded = import("../src/present/useDeckModel").Loaded;
type DeckIO = import("../src/present/useDeckModel").DeckIO;
type DeckKind = import("../src/present/sources").DeckKind;

const NOW = new Date("2026-10-19T09:00:00Z");

function ioFor(loaded: Loaded, deck: DeckKind): DeckIO {
  return {
    load: async () => loaded,
    savePrep: async k => ({
      deck: k === "launch" ? "launch" : "onboarding",
      overrides: {},
      revision: 1,
      changed: true,
    }),
    presenterName: "Sara",
    publicUrl: (_b, p) => p,
    now: () => NOW,
    ...(deck === "blueprint"
      ? { blueprint: fakeBlueprintIO(loaded, () => NOW) }
      : {}),
  };
}

/** The full client before its kickoff: none on record, no Blueprint booked. */
function beforeKickoff(taskId: string): Loaded {
  const f = FIXTURES.full("onboarding");
  const forms = { ...(f.kit?.forms ?? {}) };
  delete forms.kickoff;
  return {
    ...f,
    kit: f.kit ? { ...f.kit, clickup_task_id: taskId, forms } : null,
    sources: f.sources ? { ...f.sources, calls: { last: {}, next: {} } } : null,
  };
}

const settle = async () => {
  for (let i = 0; i < 6; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
};

let mounted: { unmount: () => void; hub: InstanceType<typeof DeckHub> }[] = [];

async function open(o: {
  taskId: string;
  deck: DeckKind;
  view: "prep" | "notes";
  loaded: Loaded;
  search?: string;
}) {
  win.history.replaceState(
    {},
    "",
    `/client-success/clients/${o.taskId}/present/${o.deck}${o.search ?? (o.view === "prep" ? "?view=prep" : "")}`,
  );
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  const opened: string[] = [];
  await act(async () =>
    root.render(
      <PresentApp
        taskId={o.taskId}
        deck={o.deck}
        view={o.view}
        io={ioFor(o.loaded, o.deck)}
        urls={{
          deck: "/deck",
          notes: "/notes",
          prep: "/prep",
          client: "/client",
          other: "/other",
        }}
        book={(_d, kind, label, onBooked) => (
          <button
            type="button"
            data-book={kind}
            onClick={() => onBooked("2026-10-22T13:00:00Z")}
          >
            {label}
          </button>
        )}
      />,
    ),
  );
  await settle();
  // The deck and the notes window, as the other windows on the channel.
  const hub = new DeckHub(
    `${channelName(o.taskId, o.deck)}${o.search?.includes("rehearse=1") ? ":rehearse" : ""}`,
  );
  mounted.push({ unmount: () => root.unmount(), hub });
  (win as unknown as { open: unknown }).open = (url: string, name: string) => {
    opened.push(`${name} ${url}`);
    return null;
  };
  return { host, hub, opened };
}

const band = () =>
  win.document.querySelector('[aria-label="How this call runs"]');
const lit = () =>
  band()?.querySelector('[data-state="now"]')?.getAttribute("data-step") ??
  null;
const beacon = () => win.document.documentElement.dataset.guideNow ?? null;
const say = async (
  hub: InstanceType<typeof DeckHub>,
  m: Parameters<InstanceType<typeof DeckHub>["post"]>[0],
) => {
  await act(async () => hub.post(m));
  await settle();
};
const state = (slideId: string, index: number, count = 8) =>
  ({
    type: "state",
    index,
    tour: 0,
    slideId,
    count,
    stops: 1,
    lang: "en",
    startedAt: Date.now(),
  }) as const;

afterEach(async () => {
  for (const m of mounted) {
    await act(async () => m.unmount());
    m.hub.close();
  }
  mounted = [];
  win.document.body.innerHTML = "";
  delete win.document.documentElement.dataset.guideNow;
  win.localStorage.clear();
  Channel.heard = [];
});

describe("prep's band on the onboarding call", () => {
  test("asks which windows are open, and lights the first step", async () => {
    await open({
      taskId: "fixture-guide-a",
      deck: "onboarding",
      view: "prep",
      loaded: beforeKickoff("fixture-guide-a"),
    });
    expect(band()).not.toBeNull();
    expect(band()?.textContent).toContain("Step 1 of 7");
    expect(lit()).toBe("check");
    expect(
      Channel.heard.some(
        h => (h.data as { type: string }).type === "roll-call",
      ),
    ).toBe(true);
    // The first step has no control of its own: nothing rings yet.
    expect(beacon()).toBeNull();
    // Prep's Present carries the beacon's hook.
    expect(
      win.document.querySelector('[data-guide="present"]')?.textContent,
    ).toContain("Present");
  });

  test("the notes window's hello, then the deck's state, move it on and move the beacon", async () => {
    const { hub } = await open({
      taskId: "fixture-guide-b",
      deck: "onboarding",
      view: "prep",
      loaded: beforeKickoff("fixture-guide-b"),
    });
    await say(hub, { type: "hello", from: "notes" });
    expect(lit()).toBe("present");
    expect(beacon()).toBe("present");
    await say(hub, state("welcome", 0));
    expect(lit()).toBe("walk");
    expect(beacon()).toBeNull();
    await say(hub, state("kickoff", 7));
    expect(lit()).toBe("kickoff");
    await say(hub, { type: "kickoff-sent", at: NOW.toISOString() });
    expect(lit()).toBe("book");
    // The booking lives in the notes window, not here: nothing to light in prep.
    expect(beacon()).toBe("book-blueprint");
    await say(hub, {
      type: "booked",
      kind: "blueprint",
      startTime: "2026-10-22T13:00:00Z",
    });
    expect(lit()).toBe("close");
    await say(hub, { type: "closed" });
    expect(lit()).toBeNull();
    expect(band()?.textContent).toContain("All 7 steps done");
  });

  test("a deck up without notes lights Open the notes window, which opens it by its one name", async () => {
    const { hub, opened } = await open({
      taskId: "fixture-guide-c",
      deck: "onboarding",
      view: "prep",
      loaded: beforeKickoff("fixture-guide-c"),
    });
    // First it rides on step 1, which ticks when a window opens: there,
    // unlit, it is the way on.
    const first = () =>
      band()?.querySelector('[data-step="check"] [data-guide="notes"]');
    expect(first()?.textContent).toContain("Open the notes window");
    expect(beacon()).toBeNull();
    await say(hub, state("welcome", 0));
    expect(first()).toBeNull();
    expect(lit()).toBe("notes");
    expect(beacon()).toBe("notes");
    const button = band()?.querySelector(
      '[data-guide="notes"]',
    ) as unknown as HTMLButtonElement | null;
    expect(button?.textContent).toContain("Open the notes window");
    await act(async () => button?.click());
    expect(opened).toEqual(["mahara-notes-fixture-guide-c-onboarding "]);
  });

  test("Hide help folds it to one line, keeps the choice, and puts the beacon out", async () => {
    const { hub } = await open({
      taskId: "fixture-guide-d",
      deck: "onboarding",
      view: "prep",
      loaded: beforeKickoff("fixture-guide-d"),
    });
    await say(hub, { type: "hello", from: "notes" });
    expect(beacon()).toBe("present");
    const hide = [...(band()?.querySelectorAll("button") ?? [])].find(
      b => b.textContent === "Hide help",
    ) as unknown as HTMLButtonElement;
    await act(async () => hide.click());
    expect(band()?.querySelector("ol")).toBeNull();
    expect(band()?.textContent).toContain(
      "Present, then share only the deck window",
    );
    expect(beacon()).toBeNull();
    expect(JSON.parse(win.localStorage.getItem(HELP_KEY) ?? "{}").help).toBe(
      "off",
    );
  });
});

describe("counting real calls towards help off", () => {
  test("a call finished while the deck was up counts once", async () => {
    const { hub } = await open({
      taskId: "fixture-guide-e",
      deck: "onboarding",
      view: "prep",
      loaded: beforeKickoff("fixture-guide-e"),
    });
    await say(hub, state("kickoff", 7));
    await say(hub, { type: "kickoff-sent", at: NOW.toISOString() });
    await say(hub, {
      type: "booked",
      kind: "blueprint",
      startTime: "2026-10-22T13:00:00Z",
    });
    const kept = JSON.parse(win.localStorage.getItem(HELP_KEY) ?? "{}");
    expect(kept.calls?.onboarding).toEqual(["fixture-guide-e"]);
  });

  test("a client whose call was done before this window opened does not count", async () => {
    await open({
      taskId: "fixture-guide-f",
      deck: "onboarding",
      view: "prep",
      loaded: FIXTURES.full("onboarding"),
    });
    expect(win.localStorage.getItem(HELP_KEY)).toBeNull();
  });

  test("a rehearsal never counts", async () => {
    const { hub } = await open({
      taskId: "fixture-guide-g",
      deck: "onboarding",
      view: "prep",
      loaded: beforeKickoff("fixture-guide-g"),
      search: "?view=prep&rehearse=1",
    });
    await say(hub, state("kickoff", 7));
    await say(hub, { type: "kickoff-sent", at: NOW.toISOString() });
    await say(hub, {
      type: "booked",
      kind: "blueprint",
      startTime: "2026-10-22T13:00:00Z",
    });
    expect(lit()).toBe("close");
    expect(win.localStorage.getItem(HELP_KEY)).toBeNull();
  });
});

describe("the notes window's line", () => {
  test("says where the call is, under the slide's title, and answers the roll call", async () => {
    const { hub } = await open({
      taskId: "fixture-guide-h",
      deck: "onboarding",
      view: "notes",
      loaded: beforeKickoff("fixture-guide-h"),
    });
    const line = () => win.document.querySelector("[data-guide-line]");
    expect(line()?.textContent).toContain("Step 3 of 7");
    expect(line()?.textContent).toContain(
      "Present, then share only the deck window",
    );
    Channel.heard = [];
    await say(hub, { type: "roll-call" });
    expect(
      Channel.heard.some(
        h =>
          (h.data as { type: string; from?: string }).type === "hello" &&
          (h.data as { from?: string }).from === "notes",
      ),
    ).toBe(true);
    await say(hub, state("goals", 1));
    expect(line()?.textContent).toContain("Walk them through the slides");
  });

  test("lights the Blueprint booking once the kickoff is in", async () => {
    const { hub } = await open({
      taskId: "fixture-guide-i",
      deck: "onboarding",
      view: "notes",
      loaded: beforeKickoff("fixture-guide-i"),
    });
    await say(hub, state("kickoff", 7));
    await say(hub, { type: "kickoff-sent", at: NOW.toISOString() });
    expect(beacon()).toBe("book-blueprint");
  });
});

describe("the Brand Blueprint", () => {
  test("the creative director's prep runs the Blueprint's seven steps", async () => {
    const loaded = blueprintLoaded("full", "open", { rehearse: false });
    await open({
      taskId: "fixture-bp-full",
      deck: "blueprint",
      view: "prep",
      loaded,
    });
    expect(band()?.textContent).toContain("Read the prep and draft the offer");
    expect(band()?.textContent).toContain("Step 1 of 7");
    // Its presses carry the beacon's hook.
    expect(win.document.querySelector('[data-guide="part1"]')).not.toBeNull();
  });

  test("the CSM's read-only view shows no guide", async () => {
    const loaded = blueprintLoaded("full", "open", { rehearse: false });
    const csm: Loaded = {
      ...loaded,
      blueprint: loaded.blueprint
        ? { ...loaded.blueprint, can: { write: false, rehearse: false } }
        : loaded.blueprint,
    };
    await open({
      taskId: "fixture-bp-full",
      deck: "blueprint",
      view: "prep",
      loaded: csm,
    });
    expect(win.document.body.textContent).toContain("Prepare the");
    expect(band()).toBeNull();
    expect(beacon()).toBeNull();
  });
});
