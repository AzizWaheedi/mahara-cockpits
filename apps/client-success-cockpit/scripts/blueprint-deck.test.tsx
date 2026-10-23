import {
  afterEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import { readFileSync } from "node:fs";
import { Window } from "happy-dom";

/**
 * The Brand Blueprint call deck (docs/brand-blueprint/SPEC.md 5): 14
 * slides in the run sheet's order, 45 minutes, both languages; nothing
 * private on the canvas (the daily figure, the margin, the CSM's lines, the
 * pack's link, where the ad sends people, whose Page it runs from); live
 * paper never turned, nothing else past 1 degree but the fan and the
 * stamp; the Part 1 stamp only from this call's press, never a timer; a
 * CSM seat reads and never presses. Synthetic fixtures only; nothing is
 * sent anywhere.
 *
 * Run: bun test scripts/blueprint-deck.test.tsx
 */

const win = new Window({
  url: "https://localhost/client-success/clients/fixture-bp-full/present/blueprint#first-ads",
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

mock.module("@/auth/SupabaseAuthProvider", () => ({
  useCockpitAuth: () => ({ client: null, name: "Sara", email: "" }),
}));

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { blueprintSlides } = await import("../src/present/blueprintDeck");
const { BP_MINUTES, BP_TITLES } = await import(
  "../src/present/blueprintContent"
);
const { DECKS, TARGET_MINUTES } = await import("../src/present/decks");
const { emptyLive, DeckHub, channelName } = await import(
  "../src/present/channel"
);
const { deckData } = await import("../src/present/deckData");
const { blueprintPrefill } = await import("../src/present/blueprintPrefill");
const { bandOf, brandPalette, brandType, tapeMarks, moneyText, shortAmount } =
  await import("../src/present/blueprintData");
const { KickoffSlide } = await import("../src/present/KickoffSlide");
const { missing } = await import("../src/present/blueprintForm");
const { BlueprintNotes } = await import("../src/present/BlueprintNotes");
const { PresentApp } = await import("../src/present/PresentApp");
const { blueprintLoaded, fakeBlueprintIO, BP_NOW } = await import(
  "../src/dev/deck/blueprintFixtures"
);

type Loaded = import("../src/present/useDeckModel").Loaded;
type BpModel = import("../src/present/useBlueprint").BpModel;
type DeckData = import("../src/present/deckData").DeckData;
type Lang = "en" | "ar";

const NOW = new Date(BP_NOW);
const TASK = "fixture-bp-full";
const IDS = [
  "cover",
  "so-far",
  "today",
  "one-service",
  "first-ads",
  "best-at",
  "pricing",
  "competitors",
  "offer",
  "how-ads-work",
  "brand",
  "content",
  "read-back",
  "next",
];

/** What the client never sees, typed into the record so a leak would show. */
const PRIVATE = {
  capacity: "tight",
  capacity_note: "PRIVATE capacity line",
  pack_url: "https://drive.google.com/drive/folders/1PrivatePackFolder0000",
  daily_budget: { usd: 4321, said: "PRIVATE 4321 a day" },
  destination: "landing_page",
  identity: "our_page",
  margin: "PRIVATE 37 percent",
  csm_signals: "PRIVATE upsell signal",
  anything_else: "PRIVATE anything else",
  events: "PRIVATE home show",
  dna_missing: "PRIVATE the tone section",
};

function data(loaded: Loaded, lang: Lang = "en"): DeckData {
  return deckData({
    taskId: TASK,
    deck: "blueprint",
    lang,
    sources: loaded.sources,
    kit: loaded.kit,
    prep: loaded.prep,
    ads: loaded.ads,
    publicUrl: (_b, p) => p,
    now: NOW,
  });
}

/** A Blueprint model with these answers, as a slide reads it. */
function model(
  loaded: Loaded,
  d: DeckData,
  answers: Record<string, unknown>,
  over: Partial<BpModel> = {},
): BpModel {
  const prefill = blueprintPrefill({
    forms: loaded.kit?.forms ?? null,
    onboardingPrep: loaded.prep.onboarding,
    dosDonts: d.dosDonts,
    card: loaded.blueprint?.card ?? null,
    packs: loaded.blueprint?.settings.packs ?? {},
    lang: d.lang,
  });
  return {
    answers,
    prefill,
    can: { write: true, rehearse: false },
    rehearsal: false,
    readOnly: false,
    parts: {},
    runs: {},
    stamp: null,
    conflicts: [],
    save: { kind: "idle" },
    bundle: loaded.blueprint ?? null,
    docs: {
      brandDna: loaded.sources?.editor?.brandDna ?? null,
      brandDnaUrl: null,
      offerUrl: null,
      driveUrl: "https://drive.google.com/drive/folders/1FixtureDriveFull",
      research: null,
      packStandIn: ["stand-in.webp"],
    },
    launchTaskId: null,
    set: () => {},
    accept: () => {},
    acceptMany: () => {},
    keepMine: () => {},
    dismiss: () => {},
    press: async () => {},
    missing: p => missing(p, answers),
    changed: () => false,
    mark: () => null,
    flush: async () => {},
    now: () => NOW,
    ...over,
  };
}

function render(d: DeckData, bp: BpModel, id: string, tour: number) {
  const s = blueprintSlides().find(x => x.id === id);
  if (!s) throw Error(`no slide ${id}`);
  return renderToStaticMarkup(
    <div className="dk-canvas" dir={d.lang === "ar" ? "rtl" : "ltr"}>
      {s.render({
        d,
        lang: d.lang,
        deck: "blueprint",
        prep: {},
        prepOf: () => ({}),
        save: () => {},
        saveTo: () => {},
        live: emptyLive(),
        setLive: () => {},
        still: true,
        presenting: true,
        tour,
        setTour: () => {},
        bp,
      })}
    </div>,
  );
}

/** Every slide and stop of the deck, rendered. */
function everyStop(d: DeckData, bp: BpModel) {
  const out: { id: string; tour: number; html: string }[] = [];
  for (const s of blueprintSlides()) {
    const n = s.stops?.({} as never) ?? 1;
    for (let tour = 0; tour < n; tour++)
      out.push({ id: s.id, tour, html: render(d, bp, s.id, tour) });
  }
  return out;
}

/** The record in the middle of the call, private answers included. */
function midCall(lang: Lang = "en") {
  const loaded = blueprintLoaded("full", "closed", { rehearse: false });
  const d = data(loaded, lang);
  const answers = { ...(loaded.blueprint?.row?.answers ?? {}), ...PRIVATE };
  return { loaded, d, answers };
}

describe("the deck", () => {
  test("14 slides in the run sheet's order, 45 minutes, its own entry in the engine", () => {
    expect(blueprintSlides().map(s => s.id)).toEqual(IDS);
    expect(DECKS.blueprint().map(s => s.id)).toEqual(IDS);
    expect(TARGET_MINUTES.blueprint).toBe(45);
    expect(
      IDS.reduce(
        (n, id) => n + BP_MINUTES[id as keyof typeof BP_MINUTES][1],
        0,
      ),
    ).toBe(45);
    for (const s of blueprintSlides()) {
      expect(s.title.en.length).toBeGreaterThan(3);
      expect(s.title.ar).toMatch(/[\u0600-\u06FF]/);
      expect(s.notes.say.length).toBeGreaterThan(1);
    }
    expect(BP_TITLES["first-ads"].en).toBe(
      "Your first ads, while we make yours",
    );
  });

  for (const lang of ["en", "ar"] as const)
    test(`nothing private reaches the canvas (${lang})`, () => {
      const { loaded, d, answers } = midCall(lang);
      const bp = model(loaded, d, answers);
      for (const { id, tour, html } of everyStop(d, bp)) {
        const text = html.replace(/<[^>]+>/g, " ");
        const where = `${id}:${tour}`;
        expect({
          where,
          leak:
            /PRIVATE|4321|1PrivatePackFolder|Landing page|Our Page|budget|\$\s?\d|USD/i.exec(
              text,
            )?.[0] ?? null,
        }).toEqual({
          where,
          leak: null,
        });
        // The pack's link is never written on the canvas, not even in an attribute.
        expect(html).not.toContain("1PrivatePackFolder0000");
      }
    });

  test("the slides say the client's own words, and their money only as their projects", () => {
    const { loaded, d, answers } = midCall("en");
    const html = everyStop(d, model(loaded, d, answers))
      .map(x => x.html)
      .join(" ");
    expect(html).toContain("The Whole Villa Plan");
    expect(html).toContain("60,000 SAR");
    expect(html).toContain("We draw every room in 3D");
  });
});

describe("the tamed wall", () => {
  const host = win.document.createElement("div");
  const turn = (el: Element) => {
    const style = el.getAttribute("style") ?? "";
    const r = /--r:\s*(-?[\d.]+)deg/.exec(style)?.[1];
    const tr = /--tr:\s*(-?[\d.]+)deg/.exec(style)?.[1];
    return Math.max(Math.abs(Number(r ?? 0)), Math.abs(Number(tr ?? 0)));
  };

  test("paper typed on live is never turned, nor anything around it", () => {
    const { loaded, d, answers } = midCall("en");
    for (const { id, tour, html } of everyStop(d, model(loaded, d, answers))) {
      host.innerHTML = html;
      const live = [...host.querySelectorAll("[data-live]")];
      if (
        [
          "best-at",
          "pricing",
          "so-far",
          "first-ads",
          "read-back",
          "brand",
          "competitors",
        ].includes(id) &&
        tour > 0
      )
        expect(live.length).toBeGreaterThan(0);
      for (const el of live)
        for (let p: Element | null = el; p && p !== host; p = p.parentElement)
          expect({ where: `${id}:${tour}`, turn: turn(p) }).toEqual({
            where: `${id}:${tour}`,
            turn: 0,
          });
      // Every typing field sits inside live paper.
      for (const t of host.querySelectorAll("textarea, input.dkb-amount"))
        expect(t.closest("[data-live]")).not.toBeNull();
    }
  });

  test("nothing else is turned past 1 degree but the fan's strips (and the stamp's own -3)", () => {
    const { loaded, d, answers } = midCall("en");
    for (const { id, tour, html } of everyStop(d, model(loaded, d, answers))) {
      host.innerHTML = html;
      for (const el of host.querySelectorAll("[style]")) {
        if (el.closest(".dkb-fan")) continue;
        expect({ where: `${id}:${tour}`, turn: turn(el) <= 1 }).toEqual({
          where: `${id}:${tour}`,
          turn: true,
        });
      }
    }
  });

  test("the cover's frames are empty and the read-back's are full", () => {
    const { loaded, d, answers } = midCall("en");
    const bp = model(loaded, d, answers);
    host.innerHTML = render(d, bp, "cover", 0);
    expect(host.querySelectorAll(".dkb-frame").length).toBe(3);
    expect(host.querySelectorAll(".dkb-frame[data-filled]").length).toBe(0);
    host.innerHTML = render(d, bp, "read-back", 0);
    expect(host.querySelectorAll(".dkb-frame[data-filled]").length).toBe(3);
  });

  test("a CSM seat reads every slide and types nothing", () => {
    const { loaded, d, answers } = midCall("en");
    const bp = model(loaded, d, answers, {
      readOnly: true,
      can: { write: false, rehearse: false },
    });
    for (const { html } of everyStop(d, bp)) {
      host.innerHTML = html;
      expect(host.querySelectorAll("textarea, input").length).toBe(0);
      for (const b of host.querySelectorAll(
        ".dkb-pen button, button.dkb-tab, button.dkb-strip",
      ))
        expect(b.hasAttribute("disabled")).toBe(true);
    }
    const notes = renderToStaticMarkup(
      <BlueprintNotes
        bp={bp}
        d={d}
        slideId="first-ads"
        reload={async () => {}}
      />,
    );
    expect(notes).toContain("Only the creative director sends the parts.");
    expect(notes).not.toContain("Send to media");
    const writer = renderToStaticMarkup(
      <BlueprintNotes
        bp={model(loaded, d, answers)}
        d={d}
        slideId="first-ads"
        reload={async () => {}}
      />,
    );
    expect(writer).toContain("What media gets");
    expect(writer).toMatch(/Send to media|Send the changes|Run it again/);
  });
});

describe("the Part 1 stamp", () => {
  const roots: { unmount: () => void }[] = [];
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    win.document.body.innerHTML = "";
    setSystemTime();
  });
  const flush = () =>
    act(async () => {
      for (let i = 0; i < 8; i++) await new Promise(r => setTimeout(r, 0));
    });

  async function present(state: "part1" | "sent") {
    win.location.hash = "#first-ads";
    win.localStorage.setItem("csm_deck_lang", "en");
    const loaded = blueprintLoaded("full", state, { rehearse: false });
    const host = win.document.createElement("div");
    win.document.body.append(host);
    const root = createRoot(host as unknown as Element);
    roots.push(root);
    await act(async () => {
      root.render(
        <PresentApp
          taskId={TASK}
          deck="blueprint"
          view="present"
          io={{
            load: async () => loaded,
            savePrep: async (deck, overrides) => ({
              deck: deck === "launch" ? "launch" : "onboarding",
              overrides,
              revision: 1,
            }),
            now: () => NOW,
            blueprint: fakeBlueprintIO(loaded, () => NOW),
          }}
          urls={{ deck: "", notes: "", prep: "", client: "", other: "" }}
        />,
      );
    });
    await flush();
    // The sheet is the slide's second stop.
    await act(async () => {
      win.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    await flush();
    return host;
  }

  test("never from a timer: an hour on the slide, and no stamp until the press says so", async () => {
    const host = await present("part1");
    expect(host.querySelector(".dk-slide")?.getAttribute("data-slide")).toBe(
      "first-ads",
    );
    expect(host.querySelector(".dkb-sheet")).not.toBeNull();
    expect(host.querySelector(".dkb-stamp")).toBeNull();
    const firstPart = () =>
      host
        .querySelector(".dkb-parts li:first-child")
        ?.hasAttribute("data-done");
    expect(firstPart()).toBe(false);
    setSystemTime(new Date(NOW.getTime() + 3_600_000));
    await flush();
    expect(host.querySelector(".dkb-stamp")).toBeNull();
    expect(firstPart()).toBe(false);
    // The notes window's press, over the hub: the stamp lands, fresh.
    const notes = new DeckHub(channelName(TASK, "blueprint"));
    await act(async () => {
      notes.post({
        type: "bp-part",
        part: 1,
        phase: "queued",
        at: "2026-10-22T07:12:00Z",
        firstAt: "2026-10-22T07:12:00Z",
        sent: {},
      });
    });
    await flush();
    const stamp = host.querySelector(".dkb-stamp");
    expect(stamp).not.toBeNull();
    expect(stamp?.hasAttribute("data-fresh")).toBe(true);
    expect(stamp?.textContent).toContain("10:12");
    // The parts list ticks part 1 in the same render as the stamp, never before it.
    expect(firstPart()).toBe(true);
    notes.close();
  });

  test("a press of another part, or a rehearsal of part 2, lands nothing", async () => {
    const host = await present("part1");
    const notes = new DeckHub(channelName(TASK, "blueprint"));
    await act(async () => {
      notes.post({
        type: "bp-part",
        part: 2,
        phase: "queued",
        at: "2026-10-22T07:40:00Z",
      });
      notes.post({
        type: "bp-part",
        part: 1,
        phase: "running",
        at: "2026-10-22T07:40:00Z",
      });
    });
    await flush();
    expect(host.querySelector(".dkb-stamp")).toBeNull();
    notes.close();
  });

  test("the presenter's chrome starts out of sight, and only a real pointer move brings it back", async () => {
    const host = await present("part1");
    const root = host.querySelector(".dk-root");
    expect(root?.hasAttribute("data-idle")).toBe(true);
    const move = (x: number, y: number) =>
      act(async () => {
        win.dispatchEvent(
          new win.MouseEvent("mousemove", {
            screenX: x,
            screenY: y,
            bubbles: true,
          }),
        );
      });
    // The mousemove a browser sends from a still pointer as the slide
    // changes under it: no movement, so the chrome stays away.
    await move(400, 300);
    await move(400, 300);
    expect(root?.hasAttribute("data-idle")).toBe(true);
    await move(440, 330);
    expect(root?.hasAttribute("data-idle")).toBe(false);
  });

  test("opened after the press, the stamp is already set, without its motion", async () => {
    const host = await present("sent");
    const stamp = host.querySelector(".dkb-stamp");
    expect(stamp).not.toBeNull();
    expect(stamp?.hasAttribute("data-fresh")).toBe(false);
  });
});

describe("a run the Edge Function refuses", () => {
  const SAID =
    "Provider read-back did not confirm the requested change; reconcile this request";
  // supabase-js on a 4xx: no data, the response in error.context.
  const refusing = {
    functions: {
      invoke: async () => ({
        data: null,
        error: {
          name: "FunctionsHttpError",
          message: "Edge Function returned a non-2xx status code",
          context: new Response(JSON.stringify({ error: SAID }), {
            status: 400,
          }),
        },
      }),
    },
  };

  test("its own sentence reaches the call, and a reconcile row reads as needing a look", async () => {
    const { runBlueprintPart, rehearseBlueprintPart } = await import(
      "../src/present/blueprintSources"
    );
    await expect(
      runBlueprintPart(
        refusing as never,
        "20000000-0000-4000-8000-000000000001",
      ),
    ).rejects.toThrow(SAID);
    await expect(
      rehearseBlueprintPart(refusing as never, TASK, 1, {}),
    ).rejects.toThrow(SAID);

    const { useBlueprint } = await import("../src/present/useBlueprint");
    const loaded = blueprintLoaded("full", "part1", { rehearse: false });
    const d = data(loaded);
    const io = {
      ...fakeBlueprintIO(loaded, () => NOW),
      run: (id: string) => runBlueprintPart(refusing as never, id),
    };
    const hub = new DeckHub(channelName("fixture-bp-refused", "blueprint"));
    let bp: BpModel | null = null;
    function Probe() {
      bp = useBlueprint({
        enabled: true,
        taskId: "fixture-bp-refused",
        loaded,
        d,
        io,
        hub,
        rehearseAsked: false,
        now: () => NOW,
      });
      return null;
    }
    const host = win.document.createElement("div");
    win.document.body.append(host);
    const root = createRoot(host as unknown as Element);
    await act(async () => root.render(<Probe />));
    // What the call adds to a part 1 confirmed in prep.
    await act(async () => {
      const m = bp as unknown as BpModel;
      m.set("capacity", "yes", { now: true });
      m.set("pack_approval", "on_call", { now: true });
      m.set("daily_budget", { usd: 40 }, { now: true });
    });
    await act(async () => {
      await (bp as unknown as BpModel).press(1);
    });
    const run = (bp as unknown as BpModel).runs["1"];
    expect(run?.error).toBe(SAID);
    expect(run?.phase).toBe("reconcile");
    expect(run?.error).toBe(SAID);
    await act(async () => root.unmount());
    hub.close();
  }, 15000);
});

describe("a press over answers that did not save", () => {
  test("sends nothing, and says so, while the last save has not landed", async () => {
    const { useBlueprint } = await import("../src/present/useBlueprint");
    const loaded = blueprintLoaded("full", "part1", { rehearse: false });
    const d = data(loaded);
    const pressed: number[] = [];
    const base = fakeBlueprintIO(loaded, () => NOW);
    const io = {
      ...base,
      save: async () => {
        throw Error("Failed to fetch");
      },
      partDone: async (part: 1 | 2 | 3, id: string) => {
        pressed.push(part);
        return base.partDone(part, id);
      },
    };
    const hub = new DeckHub(channelName("fixture-bp-offline", "blueprint"));
    let bp: BpModel | null = null;
    function Probe() {
      bp = useBlueprint({
        enabled: true,
        taskId: "fixture-bp-offline",
        loaded,
        d,
        io,
        hub,
        rehearseAsked: false,
        now: () => NOW,
      });
      return null;
    }
    const host = win.document.createElement("div");
    win.document.body.append(host);
    const root = createRoot(host as unknown as Element);
    await act(async () => root.render(<Probe />));
    await act(async () => {
      const m = bp as unknown as BpModel;
      m.set("capacity", "yes", { now: true });
      m.set("pack_approval", "on_call", { now: true });
      m.set("daily_budget", { usd: 40 }, { now: true });
    });
    await act(async () => {
      await (bp as unknown as BpModel).press(1);
    });
    const run = (bp as unknown as BpModel).runs["1"];
    expect(run?.phase).toBe("failed");
    expect(run?.error).toBe(
      "Your last answers are not saved yet, so nothing was sent. Check the connection, then press again.",
    );
    expect(pressed).toEqual([]);
    expect((bp as unknown as BpModel).stamp).toBeNull();
    await act(async () => root.unmount());
    hub.close();
  }, 15000);
});

// ------------------------------------------------------------ score round 1

describe("score round 1 (2026-10-23)", () => {
  const host = win.document.createElement("div");
  const text = (html: string) =>
    html
      .replace(/<[^>]+>/g, " ")
      .replace(/&#x27;/g, "'")
      .replace(/\s+/g, " ");

  for (const lang of ["en", "ar"] as const)
    test(`slide 14 says part 1 is sent only once it was sent (${lang})`, () => {
      const unsent = blueprintLoaded("full", "part1", { rehearse: false });
      const d1 = data(unsent, lang);
      const bp1 = model(unsent, d1, unsent.blueprint?.row?.answers ?? {});
      const before = text(render(d1, bp1, "next", 0));
      const sent = blueprintLoaded("full", "sent", { rehearse: false });
      const d2 = data(sent, lang);
      const bp2 = model(sent, d2, sent.blueprint?.row?.answers ?? {}, {
        parts: sent.blueprint?.row?.parts ?? {},
      });
      const after = text(render(d2, bp2, "next", 0));
      if (lang === "en") {
        expect(before).toContain("Part 1: we send it before we hang up.");
        expect(before).not.toContain("Part 1 sent");
        expect(after).toContain(
          "Part 1 sent. Your starter ads are with our media team.",
        );
        expect(after).not.toContain("we send it before we hang up");
      } else {
        expect(before).toContain("الجزء الأول: نرسله قبل لا نسكر.");
        expect(before).not.toContain("انرسل الجزء الأول");
        expect(after).toContain("انرسل الجزء الأول");
      }
      // This call's press counts too, before the record is read again.
      const pressed = text(
        render(
          d1,
          model(unsent, d1, unsent.blueprint?.row?.answers ?? {}, {
            stamp: { at: "2026-10-22T07:12:00Z", fresh: true },
          }),
          "next",
          0,
        ),
      );
      expect(pressed).not.toContain(
        lang === "en" ? "we send it before" : "نرسله قبل لا نسكر",
      );
    });

  test("never lines are marked with a cross, never struck through", () => {
    const { loaded, d, answers } = midCall("en");
    host.innerHTML = render(d, model(loaded, d, answers), "brand", 0);
    const never = host.querySelector('.dkb-lines[data-kind="never"]');
    expect(never).not.toBeNull();
    expect(never?.querySelectorAll("li").length).toBeGreaterThan(0);
    expect(host.querySelectorAll(".dkb-lines s, .dkb-lines del").length).toBe(
      0,
    );
    // One stop: the look and its three lists together.
    expect(
      blueprintSlides()
        .find(s => s.id === "brand")
        ?.stops?.({} as never),
    ).toBe(1);
  });

  test("the never list keeps the onboarding call as its source until it is changed here", () => {
    const { loaded, d, answers } = midCall("en");
    const red = ["No discount talk"];
    const marks = (rules: unknown) => {
      host.innerHTML = render(
        d,
        model(
          loaded,
          d,
          { ...answers, red_lines: red, rules },
          {
            mark: k => (k === "red_lines" ? "deck" : "call"),
          },
        ),
        "brand",
        0,
      );
      return host.querySelectorAll(".dkb-rule-card")[1]?.textContent ?? "";
    };
    expect(marks({ never: red })).toContain("From your onboarding call");
    expect(marks(null)).toContain("From your onboarding call");
    expect(marks({ never: ["No discount talk", "No prices"] })).toContain(
      "Said on this call",
    );
  });

  test("slide 5's first stop pins example ads for the lit service as three prints, never phones or a Drive frame", () => {
    const { loaded, d, answers } = midCall("en");
    for (const [service, scene] of [
      ["interior", "living"],
      ["fitout", "fitout2"],
      ["construction", "construction"],
    ] as const) {
      const html = render(
        d,
        model(loaded, d, { ...answers, service, starter: "yes" }),
        "first-ads",
        0,
      );
      host.innerHTML = html;
      // Prints pinned to the wall, never hand-drawn phones (score round 2
      // of the design pass: re-drawn app chrome, Hallmark gate 47).
      expect(host.querySelectorAll(".dkb-adprint").length).toBe(3);
      expect(host.querySelector(".dkc-phone")).toBeNull();
      expect(
        [...host.querySelectorAll(".dkb-ad-tag")].map(t => t.textContent),
      ).toEqual(["Example ad", "Example ad", "Example ad"]);
      expect(html).toContain(`${scene}-feed`);
      expect(html).not.toContain("embeddedfolderview");
      expect(host.querySelector("iframe")).toBeNull();
      // Three short lines say what the pack is.
      expect(host.querySelectorAll(".dkb-pack-words li").length).toBe(3);
    }
    const ar = data(loaded, "ar");
    host.innerHTML = render(ar, model(loaded, ar, answers), "first-ads", 0);
    expect(host.textContent).toContain("إعلان للتوضيح");
  });

  test("slide 2 shows the service as one chip; the fan is slide 4's, which parks the others on its second stop", () => {
    const { loaded, d, answers } = midCall("en");
    const bp = model(loaded, d, answers);
    host.innerHTML = render(d, bp, "so-far", 0);
    expect(host.querySelector(".dkb-fan")).toBeNull();
    expect(host.querySelectorAll(".dkb-svc .dkb-chip-lit").length).toBe(1);
    host.innerHTML = render(d, bp, "one-service", 0);
    expect(host.querySelectorAll(".dkb-strip[data-gone]").length).toBe(0);
    host.innerHTML = render(d, bp, "one-service", 1);
    expect(host.querySelectorAll(".dkb-strip[data-gone]").length).toBe(4);
    expect(
      [...host.querySelectorAll(".dkb-parked li[data-main]")].map(
        l => l.textContent,
      ),
    ).toEqual([
      "Design and build",
      "Architectural design",
      "Fit-out and renovation",
      "Construction",
    ]);
  });

  test("the price tape is drawn to the numbers: the anchor sits inside the range it belongs to", () => {
    const { loaded, d, answers } = midCall("en");
    const a = {
      ...answers,
      minimum: { amount: 60_000, currency: "SAR" },
      anchor: { amount: 220_000, currency: "SAR" },
      pricing: "Most projects land between 180,000 and 260,000.",
    };
    host.innerHTML = render(d, model(loaded, d, a), "pricing", 0);
    const at = (sel: string, v = "--m") =>
      Number(
        new RegExp(`${v}:\\s*(-?[\\d.]+)px`).exec(
          host.querySelector(sel)?.getAttribute("style") ?? "",
        )?.[1],
      );
    const band = host.querySelector(".dkb-tape-band");
    const lo = at(".dkb-tape-band", "--a");
    const hi = at(".dkb-tape-band", "--b");
    const anchor = at('.dkb-tape-mark[data-kind="anchor"]');
    const min = at('.dkb-tape-mark[data-kind="minimum"]');
    expect(band?.textContent).toContain("180,000");
    expect(band?.textContent).toContain("260,000");
    expect(min).toBeLessThan(lo);
    expect(anchor).toBeGreaterThan(lo);
    expect(anchor).toBeLessThan(hi);
    // The tag is the mark's flag: the amount is on it, and its string is
    // tied to its own mark (score round 1 of the design pass).
    expect(
      (
        host.querySelector(
          '.dkb-pricetag[data-kind="anchor"] .dkb-amount',
        ) as HTMLInputElement | null
      )?.value,
    ).toContain("220,000");
    const tiedTo = (k: string) =>
      Number(
        host
          .querySelector(`.dkb-strings g[data-kind="${k}"] circle`)
          ?.getAttribute("cx"),
      );
    expect(tiedTo("anchor")).toBeCloseTo(anchor, 0);
    expect(tiedTo("minimum")).toBeCloseTo(min, 0);
    expect(host.querySelectorAll('.dkb-flag[data-kind="anchor"]').length).toBe(
      0,
    );
    // An empty amount shows an example, marked e.g., in the client's currency.
    host.innerHTML = render(
      d,
      model(loaded, d, a, { readOnly: true }),
      "pricing",
      0,
    );
    const empty = render(
      d,
      model(loaded, d, { ...a, minimum: undefined }, { readOnly: true }),
      "pricing",
      0,
    );
    expect(empty).toMatch(/e\.g\. 60,000.SAR/);
  });

  test("one million is مليون alone in Arabic, never ١ مليون", () => {
    expect(moneyText(1_000_000, "SAR", "ar")).toBe("مليون ريال");
    expect(moneyText(1_040_000, "SAR", "ar")).toBe("مليون ريال");
    expect(moneyText(1_200_000, "SAR", "ar")).toBe("١٫٢ مليون ريال");
    expect(moneyText(2_000_000, "SAR", "ar")).toBe("٢ مليون ريال");
    expect(moneyText(1_000_000, "SAR", "en")).toBe("1,000,000 SAR");
    expect(shortAmount(1_000_000, "ar")).toBe("مليون");
    expect(shortAmount(1_500_000, "ar")).toBe("١٫٥ مليون");
  });

  test("the band and the tape's scale come from their words", () => {
    expect(bandOf("between 180,000 and 260,000")).toEqual([180_000, 260_000]);
    expect(bandOf("180k to 260k, since 2019")).toEqual([180_000, 260_000]);
    expect(bandOf("من ١٨٠ ألف إلى ٢٦٠ ألف")).toEqual([180_000, 260_000]);
    expect(bandOf("30 percent at signing")).toBeNull();
    const m = tapeMarks({
      minimum: 60_000,
      anchor: 220_000,
      band: [180_000, 260_000],
    });
    expect(m?.end).toBeGreaterThanOrEqual(260_000);
    expect(m?.minimum).toBeCloseTo(60_000 / (m?.end ?? 1));
    expect(tapeMarks({ minimum: null, anchor: null, band: null })).toBeNull();
  });

  test("the wall map follows the call; the read-back's frames grow out of it", () => {
    const { loaded, d, answers } = midCall("en");
    const bp = model(loaded, d, answers);
    for (const s of blueprintSlides()) {
      host.innerHTML = render(d, bp, s.id, 0);
      expect({
        id: s.id,
        map: Boolean(host.querySelector(".dkb-map")),
      }).toEqual({ id: s.id, map: s.id !== "cover" && s.id !== "read-back" });
    }
    host.innerHTML = render(d, bp, "read-back", 0);
    expect(host.querySelectorAll(".dkb-frame[data-assemble]").length).toBe(3);
    // Empty on the cover: three open frames of tape, the wall through them
    // (score round 2 of the design pass: paper mats read as upload fields).
    host.innerHTML = render(d, bp, "cover", 0);
    expect(host.querySelectorAll(".dkb-frame > .dkb-outline").length).toBe(3);
    expect(host.querySelectorAll(".dkb-mount, .dkb-mount-well").length).toBe(0);
    expect(host.textContent).toContain("With Sara, our creative director");
    host.innerHTML = render(
      d,
      model(loaded, d, answers, { readOnly: true }),
      "cover",
      0,
    );
    expect(host.textContent).toContain("With our creative director");
  });

  test("the run sheet brackets part 3 on its own row, after the call", () => {
    const { loaded, d, answers } = midCall("en");
    host.innerHTML = render(d, model(loaded, d, answers), "today", 0);
    const rows = host.querySelectorAll(".dkb-runsheet-rows li");
    expect(rows.length).toBe(9);
    expect(rows[8]?.hasAttribute("data-after")).toBe(true);
    const span = (n: number) => {
      const st =
        host
          .querySelector(`.dkb-bracket[data-part="${n}"]`)
          ?.getAttribute("style") ?? "";
      return [
        Number(/--from:\s*(\d+)/.exec(st)?.[1]),
        Number(/--to:\s*(\d+)/.exec(st)?.[1]),
      ];
    };
    const [a1, b1] = span(1);
    const [a2, b2] = span(2);
    const [a3, b3] = span(3);
    expect(b1).toBeLessThanOrEqual(a2);
    expect(b2).toBeLessThanOrEqual(a3);
    expect([a1, b3]).toEqual([0, 9]);
  });

  test("each of the client's lines takes its own direction (an English line in the Arabic deck reads left to right)", () => {
    const { loaded } = midCall("ar");
    const d = data(loaded, "ar");
    const bp = model(loaded, d, {
      ...(loaded.blueprint?.row?.answers ?? {}),
      red_lines: ["No discount or limited-offer talk"],
    });
    for (const [id, tour] of [
      ["so-far", 0],
      ["first-ads", 1],
    ] as const) {
      host.innerHTML = render(d, bp, id, tour);
      const items = [
        ...host.querySelectorAll(".dkb-lines li, .dkb-redlist li"),
      ].filter(li => !li.classList.contains("dkb-more"));
      expect(items.length).toBeGreaterThan(0);
      for (const li of items) {
        expect(li.getAttribute("dir")).toBe("auto");
        // dir="auto" skips a bdi's words, so the line is never wrapped in one.
        expect(li.querySelector("bdi")).toBeNull();
      }
      // A hyphen never breaks the line ("limited-offer" stays whole).
      expect(host.innerHTML).toContain("limited\u2011offer");
    }
  });

  test("the camera's first choice is said without a gendered word", () => {
    const { loaded, d, answers } = midCall("en");
    host.innerHTML = render(d, model(loaded, d, answers), "content", 1);
    expect(host.textContent).toContain("Yes, with a camera crew or a studio");
    expect(host.textContent).not.toMatch(/cameraman/);
    // One layout on both stops: the shots do not move when the camera row arrives.
    const boxes = (tour: number) => {
      host.innerHTML = render(d, model(loaded, d, answers), "content", tour);
      return [...host.querySelectorAll(".dkb-polaroid")].map(p =>
        p.getAttribute("style"),
      );
    };
    expect(boxes(0)).toEqual(boxes(1));
  });
});

describe("score round 2 (2026-10-23)", () => {
  const host = win.document.createElement("div");

  test("the part 1 sheet has no tabs, keeps its helper's room after the press, and ticks part 1 as the stamp lands", () => {
    const loaded = blueprintLoaded("full", "part1", { rehearse: false });
    const d = data(loaded, "en");
    const answers = loaded.blueprint?.row?.answers ?? {};
    host.innerHTML = render(d, model(loaded, d, answers), "first-ads", 1);
    expect(host.querySelectorAll(".dkb-tab").length).toBe(0);
    expect(host.querySelectorAll(".dkb-sheet-back").length).toBe(2);
    expect(host.querySelector(".dkb-helper")?.hasAttribute("data-gone")).toBe(
      false,
    );
    // No fixed height on the sheet: its words set it (820 at least, in CSS).
    expect(host.querySelector(".dkb-sheet")?.getAttribute("style")).not.toMatch(
      /--h/,
    );
    host.innerHTML = render(
      d,
      model(loaded, d, answers, {
        stamp: { at: "2026-10-22T07:12:00Z", fresh: true },
      }),
      "first-ads",
      1,
    );
    const helper = host.querySelector(".dkb-helper");
    expect(helper).not.toBeNull();
    expect(helper?.hasAttribute("data-gone")).toBe(true);
    const first = host.querySelector(".dkb-parts li");
    expect(first?.hasAttribute("data-done")).toBe(true);
    expect(first?.hasAttribute("data-fresh")).toBe(true);
    expect(first?.querySelector(".dkb-part-n")?.getAttribute("data-was")).toBe(
      "1",
    );
  });

  test("slide 12 has no button on the canvas; the camera question waits on its sticky until its stop", () => {
    const { loaded, d, answers } = midCall("en");
    host.innerHTML = render(d, model(loaded, d, answers), "content", 0);
    // The Drive folder opens from the notes window (score round 1 of the
    // design pass: a white pill on the client's screen).
    expect(
      host.querySelector(".dkb-button, button:not(.dkb-pen-opt)"),
    ).toBeNull();
    // A paper card, never amber (amber is the client's to-do alone).
    expect(
      host.querySelector(".dkb-camera")?.closest(".dkb-sticky"),
    ).toBeNull();
    const card = host.querySelector(".dkb-camera")?.closest(".dkb-card");
    expect(card?.hasAttribute("data-dim")).toBe(true);
    expect(host.querySelector(".dkb-camera")?.hasAttribute("data-chips")).toBe(
      true,
    );
    const picks = [...host.querySelectorAll(".dkb-camera .dkb-pen-opt")];
    expect(picks.length).toBe(4);
    for (const p of picks) expect(p.hasAttribute("disabled")).toBe(true);
    host.innerHTML = render(d, model(loaded, d, answers), "content", 1);
    expect(
      host
        .querySelector(".dkb-camera")
        ?.closest(".dkb-card")
        ?.hasAttribute("data-active"),
    ).toBe(true);
    for (const p of host.querySelectorAll(".dkb-camera .dkb-pen-opt"))
      expect(p.hasAttribute("disabled")).toBe(false);
    // Their answer is circled in pen, never a filled ring.
    expect(
      host.querySelector(".dkb-camera .dkb-pen-opt[data-picked] .dkb-ring"),
    ).not.toBeNull();
  });

  test("the offer tag names the offer sheet once, and its height is its words'", () => {
    const loaded = blueprintLoaded("full", "part1", { rehearse: false });
    const d = data(loaded, "en");
    host.innerHTML = render(
      d,
      model(loaded, d, loaded.blueprint?.row?.answers ?? {}),
      "offer",
      0,
    );
    const tag = host.querySelector(".dkb-tag");
    expect(tag?.textContent?.match(/offer sheet/g)?.length).toBe(1);
    expect(tag?.getAttribute("style")).not.toMatch(/--h/);
    // Each line a punched hole, never a radio ring (score round 1 of the
    // design pass); no card for the sheet, which is shared from its own
    // window.
    expect(tag?.querySelectorAll(".dkb-punch").length).toBe(5);
    expect(host.querySelector(".dkb-tag-ring, .dkb-sheet-card")).toBeNull();
    // Stop 2: the lead says the sheet is opened now, and the tag lifts.
    host.innerHTML = render(
      d,
      model(loaded, d, loaded.blueprint?.row?.answers ?? {}),
      "offer",
      1,
    );
    expect(host.querySelector(".dkb-offer-lede")?.textContent).toContain(
      "Now we open your offer sheet together.",
    );
    expect(host.querySelector(".dkb-tag")?.hasAttribute("data-active")).toBe(
      true,
    );
  });

  test("the empty price tape carries the tags' example amounts, each flag saying e.g.", () => {
    // No range on their onboarding form (sparse): the tape's marks are the
    // tags' examples, each flag "e.g." (score round 3: one Example tag at
    // the tape's end labelled none of them).
    const sparse = blueprintLoaded("sparse", "open", { rehearse: false });
    const ds = data(sparse, "en");
    host.innerHTML = render(ds, model(sparse, ds, {}), "pricing", 0);
    const wrap = host.querySelector(".dkb-tape-wrap");
    expect(wrap?.hasAttribute("data-ghost")).toBe(true);
    // Each amount not typed yet hangs at its example value, a dashed mark,
    // its tag saying "e.g." and its string tied to that mark (score round 1
    // of the design pass: the tag is the mark's flag).
    expect(wrap?.querySelectorAll(".dkb-tape-mark[data-ghost]").length).toBe(2);
    expect(host.querySelectorAll(".dkb-strings g").length).toBe(2);
    // Pencilled on the tag, never an input's grey placeholder (score round
    // 2 of the design pass).
    const egs = [...host.querySelectorAll(".dkb-pricetag .dkb-prompt")].map(
      p => p.textContent ?? "",
    );
    expect(egs.length).toBe(2);
    for (const f of egs) expect(f).toStartWith("e.g. ");
    expect(host.querySelector(".dkb-pricetag input[placeholder]")).toBeNull();
    // Their onboarding form names a range (full): the tape draws it, marked
    // as the form's on the card under it; the examples hang only where they
    // fit that range.
    const loaded = blueprintLoaded("full", "open", { rehearse: false });
    const d = data(loaded, "en");
    host.innerHTML = render(d, model(loaded, d, {}), "pricing", 0);
    expect(host.querySelector(".dkb-tape-band")?.textContent).toContain(
      "180,000",
    );
    expect(host.querySelector(".dkb-most")?.textContent).toContain(
      "From your onboarding form",
    );
    // Typed, the ghost is gone.
    const { answers } = midCall("en");
    host.innerHTML = render(d, model(loaded, d, answers), "pricing", 0);
    expect(
      host.querySelector(".dkb-tape-wrap")?.hasAttribute("data-ghost"),
    ).toBe(false);
    expect(host.querySelectorAll(".dkb-tape-mark[data-ghost]").length).toBe(0);
  });

  test("slide 4's park lifts the lit strip; slides 6, 8, 9 and 10 show their later cards from the first stop, waiting", () => {
    const { loaded, d, answers } = midCall("en");
    const bp = model(loaded, d, answers);
    host.innerHTML = render(d, bp, "one-service", 0);
    expect(
      host.querySelector(".dkb-fan-wrap")?.hasAttribute("data-parked"),
    ).toBe(false);
    host.innerHTML = render(d, bp, "one-service", 1);
    expect(
      host.querySelector(".dkb-fan-wrap")?.hasAttribute("data-parked"),
    ).toBe(true);
    // Each stop lifts the paper it asks about and steps the rest back
    // (score round 1 of the design pass: a label turning dark was a change
    // nobody on the call saw).
    const active = () =>
      [...host.querySelectorAll("[data-active]")].map(e =>
        e.className.split(" ").find(c => /^dkb-(frame|side|why|tag)$/.test(c)),
      );
    host.innerHTML = render(d, bp, "best-at", 0);
    expect(host.querySelectorAll(".dkb-stack .dkb-side").length).toBe(3);
    expect(active()).toEqual(["dkb-frame"]);
    expect(host.querySelectorAll(".dkb-stack .dkb-side[data-dim]").length).toBe(
      3,
    );
    host.innerHTML = render(d, bp, "best-at", 1);
    expect(active()).toEqual(["dkb-side", "dkb-side"]);
    expect(host.querySelector(".dkb-frame")?.hasAttribute("data-dim")).toBe(
      true,
    );
    host.innerHTML = render(d, bp, "best-at", 2);
    expect(active()).toEqual(["dkb-side"]);
    host.innerHTML = render(d, bp, "competitors", 0);
    expect(host.querySelector(".dkb-why")?.hasAttribute("data-dim")).toBe(true);
    host.innerHTML = render(d, bp, "competitors", 1);
    expect(host.querySelector(".dkb-why")?.hasAttribute("data-active")).toBe(
      true,
    );
    for (const c of host.querySelectorAll(".dkb-clip"))
      expect(c.hasAttribute("data-dim")).toBe(true);
    host.innerHTML = render(d, bp, "how-ads-work", 0);
    // The first weeks' tape waits rolled; the approval's tabs step back.
    expect(host.querySelector(".dkb-learn")?.hasAttribute("data-rolled")).toBe(
      true,
    );
    expect(host.querySelector(".dkb-tabs")?.hasAttribute("data-dim")).toBe(
      true,
    );
    expect(host.querySelectorAll(".dkb-approve[disabled]").length).toBe(3);
    host.innerHTML = render(d, bp, "how-ads-work", 1);
    expect(host.querySelector(".dkb-learn")?.hasAttribute("data-rolled")).toBe(
      false,
    );
    host.innerHTML = render(d, bp, "how-ads-work", 2);
    expect(host.querySelector("[data-dim]")).toBeNull();
    expect(host.querySelectorAll(".dkb-approve[disabled]").length).toBe(0);
    // Their pick is pulled up out of the clip and circled in pen.
    const picked = host.querySelector(".dkb-approve[data-picked]");
    expect(picked?.querySelector(".dkb-ring")).not.toBeNull();
    expect(host.querySelector(".dkb-radio, .dkb-pick")).toBeNull();
  });

  test("an empty entry is a ruled row, never a box; a full list keeps it quiet", () => {
    const { loaded, d, answers } = midCall("en");
    host.innerHTML = render(
      d,
      model(loaded, d, {
        ...answers,
        rules: { always: ["A", "B", "C"], never: ["D"] },
      }),
      "brand",
      0,
    );
    // Out of sight at rest, every one (score round 1 of the design pass:
    // "Add a line" read as a web input on the client's screen).
    const adds = [...host.querySelectorAll(".dkb-rule-card .dkb-add")];
    expect(adds.length).toBe(3);
    for (const a of adds) expect(a.hasAttribute("data-quiet")).toBe(true);
    // After the call, no slot for more anywhere on the wall.
    const closed = model(loaded, d, answers, {
      parts: { "2": { status: "done" } },
    });
    for (const id of ["so-far", "competitors", "brand"]) {
      host.innerHTML = render(d, closed, id, 0);
      expect({
        id,
        slots: host.querySelectorAll(".dkb-add, .dkb-clip-add").length,
      }).toEqual({ id, slots: 0 });
    }
    // Slide 2: the red lines' card is as tall as its lines and the
    // pencilled entry, no spare rules (score round 3).
    host.innerHTML = render(d, model(loaded, d, answers), "so-far", 0);
    expect(host.querySelectorAll(".dkb-never .dkb-lines-rest").length).toBe(0);
    expect(host.querySelector(".dkb-never")?.getAttribute("style")).not.toMatch(
      /--h/,
    );
    // The wall map is named once, on slide 2 only.
    expect(host.querySelector(".dkb-map-name")?.textContent).toBe("Your wall");
    host.innerHTML = render(d, model(loaded, d, answers), "today", 0);
    expect(host.querySelector(".dkb-map-name")).toBeNull();
  });

  test("the example ads carry an example caption when the record has none, never the app's empty skeleton", () => {
    const { loaded, d, answers } = midCall("en");
    const bare = { ...d, exampleWords: { ...d.exampleWords, primary: null } };
    host.innerHTML = render(
      bare as DeckData,
      model(loaded, d, { ...answers, service: "interior" }),
      "first-ads",
      0,
    );
    expect(host.querySelector(".dkc-next-post")).toBeNull();
    expect(host.textContent).toContain(
      "Interior design, from the first call to the handover.",
    );
  });
});

describe("the design pass: the wall waiting for paper (score round 3, 2026-10-23)", () => {
  const host = win.document.createElement("div");
  const text = () => (host.textContent ?? "").replace(/\s+/g, " ");

  test("the cover's frames wait as open frames of tape; a verified logo is pinned in its own; the photo print says whose it is", () => {
    const { loaded, d, answers } = midCall("en");
    host.innerHTML = render(d, model(loaded, d, answers), "cover", 0);
    for (const f of host.querySelectorAll(".dkb-frame")) {
      expect(f.querySelectorAll(":scope > .dkb-outline > i").length).toBe(4);
      expect(f.querySelectorAll(":scope > .dkb-tape").length).toBe(0);
    }
    // Their logo fills "Your look", so its hint is not printed over it
    // (score round 2 of the design pass).
    const look = host.querySelector('.dkb-frame[data-kind="look"]');
    expect(look?.hasAttribute("data-holds")).toBe(true);
    expect(look?.querySelector(".dkb-cover-logo img")).not.toBeNull();
    expect(look?.querySelector(".dkb-hint")).toBeNull();
    expect(
      host.querySelector('.dkb-frame[data-kind="words"] .dkb-hint'),
    ).not.toBeNull();
    // No upload of theirs in the fixture: their service's example render.
    expect(
      host.querySelector(".dkb-cover-photo img")?.getAttribute("src"),
    ).toContain("living-feed");
    expect(host.querySelector(".dkb-cover-photo")?.textContent).toContain(
      "Example photo",
    );
  });

  test("slide 4 with nothing lit is one stop, and its tag lists what else they offer, never parked", () => {
    const sparse = blueprintLoaded("sparse", "open", { rehearse: false });
    const d = data(sparse, "en");
    const bp = model(sparse, d, {});
    const s = blueprintSlides().find(x => x.id === "one-service");
    expect(s?.stops?.({ bp } as never)).toBe(1);
    expect(
      s?.stops?.({ bp: model(sparse, d, { service: "fitout" }) } as never),
    ).toBe(2);
    host.innerHTML = render(d, bp, "one-service", 0);
    expect(host.querySelector(".dkb-parked .dkb-card-label")?.textContent).toBe(
      "Also on your list",
    );
  });

  test("slide 5's red lines are ruled lines, and a fresh press turns part 1's line with the stamp", () => {
    const loaded = blueprintLoaded("full", "part1", { rehearse: false });
    const d = data(loaded, "en");
    const answers = loaded.blueprint?.row?.answers ?? {};
    host.innerHTML = render(
      d,
      model(loaded, d, answers, {
        stamp: { at: "2026-10-22T07:12:00Z", fresh: true },
      }),
      "first-ads",
      1,
    );
    expect(
      host.querySelector(".dkb-redlist textarea, .dkb-redlist input"),
    ).toBeNull();
    const swap = host.querySelector(".dkb-parts li .dkb-swap");
    expect(swap?.querySelector("[data-was]")?.textContent).toBe(
      "Being filled in now",
    );
    expect(swap?.querySelector("[data-now]")?.textContent).toBe(
      "Sent to our media team",
    );
  });

  test("slide 6: blank paper with a pencil note until the first word, the struck example on its own note", () => {
    const loaded = blueprintLoaded("full", "part1", { rehearse: false });
    const d = data(loaded, "en");
    host.innerHTML = render(d, model(loaded, d, {}), "best-at", 0);
    expect(host.querySelector(".dkb-bestat .dkb-method")).not.toBeNull();
    // Nothing answered yet: a pencil note, never a grey example on rules
    // (score round 2 of the design pass).
    expect(host.querySelector(".dkb-method .dkb-prompt")?.textContent).toBe(
      "We write this together",
    );
    expect(host.querySelector(".dkb-ghost")).toBeNull();
    expect(
      host.querySelector(".dkb-method .dkb-ruled")?.hasAttribute("data-empty"),
    ).toBe(true);
    // What everyone says, struck, on its own small note, off the live paper.
    const note = host.querySelector(".dkb-eg-note");
    expect(note?.querySelector("s")?.textContent).toBe(
      "Quality work, delivered on time.",
    );
    expect(note?.textContent).toContain("Example");
    expect(note?.closest("[data-live]")).toBeNull();
    expect(host.querySelectorAll(".dkb-side .dkb-prompt").length).toBe(3);
    host.innerHTML = render(
      d,
      model(loaded, d, { method: "We draw every room first." }),
      "best-at",
      0,
    );
    expect(host.querySelector(".dkb-method .dkb-prompt")).toBeNull();
  });

  test("slide 7 hangs the amounts on swing tags and reads their onboarding form's words into the card, marked", () => {
    const loaded = blueprintLoaded("full", "part1", { rehearse: false });
    const d = data(loaded, "en");
    host.innerHTML = render(d, model(loaded, d, {}), "pricing", 1);
    expect(
      host.querySelectorAll(".dkb-pricetag[data-live] input.dkb-amount").length,
    ).toBe(2);
    const most = host.querySelector(".dkb-most textarea");
    expect(most?.hasAttribute("data-draft")).toBe(true);
    expect((most as HTMLTextAreaElement | null)?.value).toContain(
      "between 180,000 and 260,000",
    );
    expect(host.querySelector(".dkb-terms")?.textContent).toContain(
      "From your onboarding form",
    );
  });

  test("slide 8 pins each name as a clipping with what they are known for; until the first, labelled example clippings", () => {
    const loaded = blueprintLoaded("full", "part1", { rehearse: false });
    const d = data(loaded, "en");
    host.innerHTML = render(d, model(loaded, d, {}), "competitors", 0);
    // Five across: the blank clipping and four examples, each tagged.
    const ghosts = [...host.querySelectorAll(".dkb-clip-ghost")];
    expect(ghosts.length).toBe(4);
    expect(host.querySelectorAll(".dkb-clips > .dkb-clip").length).toBe(5);
    for (const g of ghosts) expect(g.textContent).toContain("Example");
    expect(host.querySelector(".dkb-chip-ghost")).toBeNull();
    // Typing only on paper: the name on a blank clipping.
    for (const i of host.querySelectorAll("input"))
      expect(i.closest(".dkb-clip")).not.toBeNull();
    host.innerHTML = render(
      d,
      model(loaded, d, {
        competitors: [
          { name: "Atelier Rival", lose: true, note: "Quick quotes" },
          { name: "Other Firm", lose: false },
        ],
      }),
      "competitors",
      0,
    );
    // Two names and the blank one: two examples keep the row at five.
    expect(host.querySelectorAll(".dkb-clip-ghost").length).toBe(2);
    const clips = [
      ...host.querySelectorAll(
        ".dkb-clip:not(.dkb-clip-add):not(.dkb-clip-ghost)",
      ),
    ];
    expect(clips.length).toBe(2);
    expect(clips[0].textContent).toContain("We lose to them");
    expect(
      (clips[0].querySelector("textarea") as HTMLTextAreaElement)?.value,
    ).toBe("Quick quotes");
  });

  test("slide 11 keeps the cover's promise: materials, type and named colours, and says the red lines once", () => {
    const { loaded, d, answers } = midCall("en");
    host.innerHTML = render(
      d,
      model(loaded, d, { ...answers, rules: undefined }),
      "brand",
      0,
    );
    const swatches = [...host.querySelectorAll(".dkb-swatch-name")].map(
      x => x.textContent,
    );
    expect(swatches).toEqual(["Travertine", "Bouclé", "Oak", "Brass"]);
    expect(host.querySelector(".dkb-materials")?.textContent).toContain(
      "Example materials",
    );
    // Their doc names a serif for the wordmark: the specimen follows it
    // (score round 2 of the design pass: an example grotesque contradicted
    // it); with no type line, the deck's own pairing, an example.
    expect(host.querySelector(".dkb-specimen")?.textContent).toContain(
      "Set as your doc describes",
    );
    expect(
      host.querySelector(".dkb-specimen")?.hasAttribute("data-serif"),
    ).toBe(true);
    const chips = [...host.querySelectorAll(".dkb-palette li")].map(x =>
      x.textContent?.replace(/\s+/g, " "),
    );
    expect(chips[0]).toBe("SandD9C8AD");
    expect(host.querySelector(".dkb-dna-note")?.textContent).toContain(
      "a serif for the wordmark",
    );
    // In Arabic too, the slot filled: never a raw "{type}".
    const ar = midCall("ar");
    host.innerHTML = render(
      ar.d,
      model(ar.loaded, ar.d, { ...ar.answers, rules: undefined }),
      "brand",
      0,
    );
    const note = host.querySelector(".dkb-dna-note")?.textContent ?? "";
    expect(note).toContain("a serif for the wordmark");
    expect(note).not.toContain("{");
    host.innerHTML = render(
      d,
      model(loaded, d, { ...answers, rules: undefined }),
      "brand",
      0,
    );
    const never = host.querySelector('.dkb-lines[data-kind="never"]');
    expect(
      never?.querySelector(".dkb-fold-line")?.textContent?.replace(/\s+/g, " "),
    ).toBe("Your 3 red lines, from the start of this call");
    expect(never?.querySelectorAll("li[data-folded]").length).toBe(3);
  });

  test("slide 12's polaroids are plain example stills, never an avatar or a drawn overlay", () => {
    const { loaded, d, answers } = midCall("en");
    host.innerHTML = render(d, model(loaded, d, answers), "content", 0);
    expect(host.querySelector(".dkb-sitter, .dkb-rig")).toBeNull();
    expect(host.querySelectorAll(".dkb-polaroid img").length).toBe(5);
  });

  for (const lang of ["en", "ar"] as const)
    test(`slides 13 and 14 say the same about starter ads while it is unset, and a blank offer says where it is finished (${lang})`, () => {
      const sparse = blueprintLoaded("sparse", "open", { rehearse: false });
      const d = data(sparse, lang);
      const bp = model(sparse, d, {});
      host.innerHTML = render(d, bp, "read-back", 0);
      const back = text();
      host.innerHTML = render(d, bp, "next", 0);
      const next = text();
      if (lang === "en") {
        expect(back).toContain("Starter ads: live once your account is ready.");
        expect(back).not.toContain("Your own ads: at your launch call.");
        expect(next).toContain("Starter ads go live");
        expect(back).toContain("We finish this in your offer sheet.");
      } else {
        expect(back).toContain("إعلانات البداية: تنطلق");
        expect(next).toContain("إعلانات البداية تنطلق");
        expect(back).toContain("نكمله معكم بملف العرض.");
      }
    });

  test("the Brand DNA doc's colours keep their names; its type line is read as written; a range said as one wins", () => {
    expect(
      brandPalette("Colours\n- Sand D9C8AD\n- Oak: #8A6A4A\n- 1F2532"),
    ).toEqual([
      { hex: "#D9C8AD", name: "Sand" },
      { hex: "#8A6A4A", name: "Oak" },
      { hex: "#1F2532", name: null },
    ]);
    expect(brandType("Voice: calm\nType: Geist for text.")).toBe(
      "Geist for text",
    );
    expect(brandType("No type here")).toBeNull();
    expect(
      bandOf(
        "From 25,000 SAR for the design. Most land between 180,000 and 260,000 SAR.",
      ),
    ).toEqual([180_000, 260_000]);
    expect(bandOf("بين ١٥ و٢٥ ألف دينار")).toEqual([15_000, 25_000]);
  });

  test("the onboarding deck's kickoff stop lists what sending it does as three steps", () => {
    const loaded = blueprintLoaded("full", "open", { rehearse: false });
    const d = { ...data(loaded, "en"), deck: "onboarding" } as DeckData;
    host.innerHTML = renderToStaticMarkup(
      <div className="dk-canvas" dir="ltr">
        <KickoffSlide
          ctx={
            {
              d: { ...d, kickoff: { ...d.kickoff, from: null } },
              lang: "en",
            } as never
          }
        />
      </div>,
    );
    const steps = [...host.querySelectorAll(".dkc-kick-steps li")].map(l =>
      l.textContent?.trim(),
    );
    expect(steps.length).toBe(3);
    expect(host.querySelector(".dkc-kick-steps-head")?.textContent).toBe(
      "Once it's sent",
    );
  });
});

describe("the design pass, score round 1 fixes (2026-10-23)", () => {
  const host = win.document.createElement("div");
  const text = () => (host.textContent ?? "").replace(/\s+/g, " ");

  test("once part 1 went, the cover shows the wall as far as it got", () => {
    const { loaded, d, answers } = midCall("en");
    host.innerHTML = render(
      d,
      model(loaded, d, answers, {
        parts: { "1": { status: "done", firstAt: "2026-10-22T07:12:00Z" } },
      }),
      "cover",
      0,
    );
    const filled = [...host.querySelectorAll(".dkb-frame[data-filled]")].map(
      f => f.getAttribute("data-kind"),
    );
    expect(filled).toEqual(["words", "offer"]);
    expect(text()).toContain(
      "We draw every room in 3D before you buy a single thing.",
    );
    expect(text()).toContain("The Whole Villa Plan");
    // Before the press the frames wait, as the call's promise.
    host.innerHTML = render(d, model(loaded, d, answers), "cover", 0);
    expect(host.querySelectorAll(".dkb-frame[data-filled]").length).toBe(0);
  });

  test("no web button and no form control on any slide: answers are pen marks on paper", () => {
    const { loaded, d, answers } = midCall("en");
    for (const { id, tour, html } of everyStop(d, model(loaded, d, answers))) {
      host.innerHTML = html;
      expect({
        where: `${id}:${tour}`,
        controls: host.querySelectorAll(
          ".dkb-button, .dkb-seg, .dkb-radio, .dkb-pick, .dkb-tag-ring, .dkb-rig",
        ).length,
      }).toEqual({ where: `${id}:${tour}`, controls: 0 });
    }
    host.innerHTML = render(d, model(loaded, d, answers), "first-ads", 1);
    const starter = [
      ...host.querySelectorAll(".dkb-field .dkb-pen"),
    ][0]?.querySelectorAll(".dkb-pen-opt");
    expect(starter?.length).toBe(2);
    const yes = starter?.[0];
    expect(yes?.getAttribute("aria-pressed")).toBe("true");
    expect(yes?.querySelector(".dkb-ring path")).not.toBeNull();
    expect(starter?.[1]?.querySelector(".dkb-ring")).toBeNull();
    // The parts beside the sheet are the run sheet's rail, a pen tick once sent.
    host.innerHTML = render(
      d,
      model(loaded, d, answers, {
        stamp: { at: "2026-10-22T07:12:00Z", fresh: false },
      }),
      "first-ads",
      1,
    );
    expect(
      host.querySelector(".dkb-parts li:first-child .dkb-pen-tick"),
    ).not.toBeNull();
    expect(
      host.querySelector(".dkb-parts li:first-child")?.textContent,
    ).toContain("Part 1");
  });

  test("a competitor's long name is never cut: it steps down and keeps every word", () => {
    const { loaded, d, answers } = midCall("en");
    host.innerHTML = render(
      d,
      model(loaded, d, answers, { parts: { "2": { status: "done" } } }),
      "competitors",
      0,
    );
    const long = [...host.querySelectorAll(".dkb-clip-name")].find(n =>
      n.textContent?.includes("furniture"),
    );
    expect(long?.textContent).toBe(
      "The furniture showrooms’ free design".replace("’", "'"),
    );
    expect(long?.getAttribute("data-long")).toBe("");
    // After the call: their four, no examples, no empty "known for".
    expect(host.querySelectorAll(".dkb-clip-ghost").length).toBe(0);
    expect(host.querySelectorAll(".dkb-clip-kicker").length).toBe(0);
  });

  test("slide 2 with nothing on file pins one sticky in place of blank cards", () => {
    const sparse = blueprintLoaded("sparse", "open", { rehearse: false });
    const d = data(sparse, "en");
    host.innerHTML = render(d, model(sparse, d, {}), "so-far", 0);
    expect(host.querySelector(".dkb-clients, .dkb-never")).toBeNull();
    expect(host.querySelector(".dkb-sticky-big")?.textContent).toBe(
      "The clients you want more of, and what never goes in an ad: we write them together now.",
    );
    // A line typed (in the notes window) pins its card, live.
    host.innerHTML = render(
      d,
      model(sparse, d, { red_lines: ["No prices"] }),
      "so-far",
      0,
    );
    expect(host.querySelector(".dkb-never")).not.toBeNull();
    expect(host.querySelector(".dkb-sticky-big")).toBeNull();
  });

  test("the read-back shows an unbuilt offer as what exists and one large note, never empty rows", () => {
    const loaded = blueprintLoaded("full", "part1", { rehearse: false });
    const d = data(loaded, "en");
    host.innerHTML = render(
      d,
      model(loaded, d, loaded.blueprint?.row?.answers ?? {}),
      "read-back",
      0,
    );
    const feature = host.querySelector(".dkb-feature");
    expect(feature?.hasAttribute("data-blank")).toBe(true);
    expect(feature?.querySelectorAll(".dkb-table > div").length).toBe(1);
    expect(feature?.querySelector("textarea")).toBeNull();
    expect(feature?.querySelector(".dkb-sticky-big")?.textContent).toBe(
      "We finish this in your offer sheet.",
    );
  });

  test("the Arabic Brand DNA note keeps their English words on a line of their own", () => {
    const ar = midCall("ar");
    host.innerHTML = render(
      ar.d,
      model(ar.loaded, ar.d, { ...ar.answers, rules: undefined }),
      "brand",
      0,
    );
    const head = host.querySelector(".dkb-dna-type-head");
    const own = host.querySelector(".dkb-dna-type-own");
    expect(head?.textContent).toBe("بملف هويتكم");
    expect(own?.getAttribute("dir")).toBe("auto");
    expect(own?.textContent).toContain("a serif for the wordmark");
    expect(head?.textContent).not.toMatch(/[A-Za-z]/);
  });

  test("the launch call's frame waits from the first stop; its stop pins the card and lifts the launch card, never rings it", () => {
    const { loaded, d, answers } = midCall("en");
    host.innerHTML = render(d, model(loaded, d, answers), "next", 0);
    // An open frame with its name, never a sunk card (score round 2 of the
    // design pass: big bold words on it read as a disabled control).
    expect(host.querySelector(".dkb-call-card")).toBeNull();
    expect(host.querySelector(".dkb-call-wait .dkb-outline")).not.toBeNull();
    expect(host.querySelector(".dkb-call-wait")?.textContent).toBe(
      "Your launch call",
    );
    host.innerHTML = render(d, model(loaded, d, answers), "next", 1);
    expect(host.querySelector(".dkb-when[data-lifted]")).not.toBeNull();
    expect(host.querySelector(".dkb-when[data-lit]")).toBeNull();
    const unbooked = { ...d, next: { ...d.next, launch: null } } as DeckData;
    host.innerHTML = render(
      unbooked,
      model(loaded, unbooked, answers),
      "next",
      1,
    );
    expect(host.querySelector(".dkb-booked")?.textContent).toBe(
      "We book it together now",
    );
  });
});

describe("the design pass, score round 2 fixes (2026-10-23)", () => {
  const host = win.document.createElement("div");
  const text = () => (host.textContent ?? "").replace(/\s+/g, " ");
  const css = readFileSync(
    new URL("../src/present/present.css", import.meta.url),
    "utf8",
  );
  const sparse = () => {
    const loaded = blueprintLoaded("sparse", "open", { rehearse: false });
    const d = data(loaded, "en");
    return { loaded, d, bp: model(loaded, d, {}) };
  };

  test("a stop sinks the rest into the wall, never washes them, and amber never sinks", () => {
    const block = css.slice(css.indexOf("24 · The Brand Blueprint call"));
    expect(block).toMatch(
      /\[data-dim\] \{\s*opacity: 0\.7;\s*scale: 0\.98;\s*\}/,
    );
    expect(block).toMatch(/\.dkb-sticky\[data-dim\] \{\s*opacity: 1;/);
    expect(block).not.toMatch(/\[data-dim\] \{\s*opacity: 0\.55/);
    // No amber piece is ever stepped back on the slides.
    const { loaded, d, answers } = midCall("en");
    for (const { id, tour, html } of everyStop(d, model(loaded, d, answers))) {
      host.innerHTML = html;
      expect({
        where: `${id}:${tour}`,
        amber: host.querySelectorAll(
          ".dkb-sticky[data-dim], [data-dim] .dkb-sticky",
        ).length,
      }).toEqual({ where: `${id}:${tour}`, amber: 0 });
    }
  });

  test("nothing answered yet is a pencil note on blank paper, never a rule, a grey option or an empty box", () => {
    const { d, bp } = sparse();
    host.innerHTML = render(d, bp, "first-ads", 1);
    expect(
      host.querySelector(".dkb-field .dkb-pen")?.hasAttribute("data-chips"),
    ).toBe(true);
    const prompts = [...host.querySelectorAll(".dkb-sheet .dkb-prompt")].map(
      p => p.textContent,
    );
    expect(prompts).toEqual(["We pick it now", "We write this now"]);
    expect(host.querySelector(".dkb-redlist li")).toBeNull();
    host.innerHTML = render(d, bp, "pricing", 1);
    // t() keeps "30 /" together with a no-break space.
    const terms = host
      .querySelector(".dkb-terms .dkb-prompt")
      ?.textContent?.replace(/\u00a0/g, " ");
    expect(terms).toContain("30 / 40 / 30?");
    expect(terms).toContain("Example");
    expect(text()).not.toContain("______");
    host.innerHTML = render(d, bp, "brand", 0);
    // The three empty lists folded into one card of dashed chips.
    expect(host.querySelectorAll(".dkb-rule-card").length).toBe(1);
    expect(
      host.querySelector(".dkb-rule-card")?.hasAttribute("data-fold"),
    ).toBe(true);
    expect(
      [...host.querySelectorAll(".dkb-chip-wait")].map(c => c.textContent),
    ).toEqual([
      "We add these together",
      "We add these together",
      "We add these together",
    ]);
    host.innerHTML = render(d, bp, "competitors", 0);
    // The next name is typed over the first example, struck through.
    const add = host.querySelector(".dkb-clip-add");
    expect(add?.querySelector("s.dkb-clip-name")?.textContent).toBe(
      "The studio you lose to most",
    );
    expect(add?.querySelector(".dkb-pencil-row")).toBeNull();
    expect(host.querySelector(".dkb-why .dkb-prompt")).not.toBeNull();
  });

  test("losses are a kraft tag, never amber: amber is the client's to-do alone", () => {
    const rule = /\.dkb-lose \{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(rule).toContain("var(--dkb-kraft)");
    expect(rule).not.toContain("amber");
    // One kraft for every tag: the price tags are the offer tag's material.
    expect(css).not.toMatch(/--dkb-manila/);
  });

  test("the price tape prints a scale; the read-back's empty parts are open frames; slide 14's line runs margin to margin", () => {
    const { loaded, d, answers } = midCall("en");
    host.innerHTML = render(d, model(loaded, d, answers), "pricing", 0);
    expect(
      host.querySelectorAll(".dkb-tape-num").length,
    ).toBeGreaterThanOrEqual(2);
    const { d: ds, bp } = sparse();
    host.innerHTML = render(ds, bp, "read-back", 0);
    const offer = host.querySelector('.dkb-frame[data-kind="offer"]');
    expect(offer?.hasAttribute("data-holds")).toBe(true);
    expect(offer?.querySelector(".dkb-feature")).toBeNull();
    expect(offer?.textContent).toContain("We finish this in your offer sheet.");
    host.innerHTML = render(ds, bp, "next", 0);
    expect(host.querySelector(".dkb-line")?.getAttribute("style")).toMatch(
      /--x:\s*120px/,
    );
    const last = [...host.querySelectorAll(".dkb-when")].at(-1);
    expect(last?.querySelector(".dkb-when-d")?.textContent).toBe("Launch call");
    expect(last?.querySelector(".dkb-when-l")?.textContent).toBe(
      "Your own ads, your form and our questions.",
    );
    expect(text()).not.toContain("To book");
  });

  test("slide 10's roll comes on only for the unroll; slide 9 ticks a line in place of its hole", () => {
    const { loaded, d, answers } = midCall("en");
    host.innerHTML = render(d, model(loaded, d, answers), "how-ads-work", 0);
    expect(host.querySelector(".dkb-learn-roll")).toBeNull();
    expect(host.querySelector(".dkb-same")?.getAttribute("style")).toMatch(
      /--x:\s*0px/,
    );
    host.innerHTML = render(d, model(loaded, d, answers), "offer", 0);
    const set = host.querySelectorAll(".dkb-tag-lines li[data-set]").length;
    expect(set).toBeGreaterThan(0);
    expect(
      host.querySelectorAll(".dkb-punch[data-set] .dkb-pen-tick").length,
    ).toBe(set);
  });

  test("the kickoff on record says its steps in the past", () => {
    const loaded = blueprintLoaded("full", "open", { rehearse: false });
    const d = { ...data(loaded, "en"), deck: "onboarding" } as DeckData;
    host.innerHTML = renderToStaticMarkup(
      <div className="dk-canvas" dir="ltr">
        <KickoffSlide
          ctx={
            {
              d: { ...d, kickoff: { ...d.kickoff, from: "record" } },
              lang: "en",
            } as never
          }
        />
      </div>,
    );
    expect(host.querySelector(".dkc-kick-steps-head")?.textContent).toBe(
      "Now it's in",
    );
  });
});
