import {
  afterEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
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
        "button.dkb-pick, .dkb-seg button, button.dkb-box",
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

  test("slide 5's first stop shows example ads for the lit service in three phones, never a Drive frame", () => {
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
      expect(host.querySelectorAll(".dkc-phone").length).toBe(3);
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
    expect(host.textContent).toContain("220,000");
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
    // Empty on the cover: three mounts, each a dashed well, no outline.
    host.innerHTML = render(d, bp, "cover", 0);
    expect(host.querySelectorAll(".dkb-mount .dkb-mount-well").length).toBe(3);
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

  test("slide 12's folder button sits under the sticky, never on it", () => {
    const { loaded, d, answers } = midCall("en");
    host.innerHTML = render(d, model(loaded, d, answers), "content", 0);
    const col = host.querySelector(".dkb-due-col");
    expect(col?.querySelector(".dkb-sticky")).not.toBeNull();
    expect(col?.querySelector("button.dkb-button")).not.toBeNull();
    expect(
      col
        ?.querySelector(".dkb-sticky")
        ?.compareDocumentPosition(
          col.querySelector("button.dkb-button") as Node,
        ),
    ).toBe(4);
    // The camera row is on the wall from stop 1, waiting and not tappable.
    const picks = [...host.querySelectorAll(".dkb-camera")];
    expect(picks.length).toBe(4);
    for (const p of picks) {
      expect(p.hasAttribute("data-wait")).toBe(true);
      expect(p.hasAttribute("disabled")).toBe(true);
    }
    host.innerHTML = render(d, model(loaded, d, answers), "content", 1);
    for (const p of host.querySelectorAll(".dkb-camera"))
      expect(p.hasAttribute("data-wait")).toBe(false);
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
    // Stop 2's card has no label over the doc's name, and no fixed height.
    host.innerHTML = render(
      d,
      model(loaded, d, loaded.blueprint?.row?.answers ?? {}),
      "offer",
      1,
    );
    const card = host.querySelector(".dkb-sheet-card");
    expect(card?.querySelector(".dkb-card-label")).toBeNull();
    expect(card?.getAttribute("style")).not.toMatch(/--h/);
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
    expect(wrap?.querySelectorAll(".dkb-tape-mark").length).toBe(2);
    const flags = [...(wrap?.querySelectorAll(".dkb-flag b") ?? [])].map(
      b => b.textContent,
    );
    expect(flags.length).toBe(2);
    for (const f of flags) expect(f).toStartWith("e.g. ");
    // Their onboarding form names a range (full): the tape draws it, marked
    // as the form's on the card under it, and no example marks.
    const loaded = blueprintLoaded("full", "open", { rehearse: false });
    const d = data(loaded, "en");
    host.innerHTML = render(d, model(loaded, d, {}), "pricing", 0);
    expect(
      host.querySelector(".dkb-tape-wrap")?.hasAttribute("data-ghost"),
    ).toBe(false);
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
    host.innerHTML = render(d, bp, "best-at", 0);
    expect(host.querySelectorAll(".dkb-stack .dkb-side").length).toBe(3);
    expect(host.querySelectorAll(".dkb-stack .dkb-wait").length).toBe(2);
    host.innerHTML = render(d, bp, "best-at", 2);
    expect(host.querySelectorAll(".dkb-stack .dkb-wait").length).toBe(0);
    host.innerHTML = render(d, bp, "competitors", 0);
    expect(host.querySelector(".dkb-why")).not.toBeNull();
    expect(host.querySelector(".dkb-why-in")?.hasAttribute("data-lit")).toBe(
      false,
    );
    host.innerHTML = render(d, bp, "offer", 0);
    expect(host.querySelector(".dkb-sheet-card.dkb-wait")).not.toBeNull();
    host.innerHTML = render(d, bp, "how-ads-work", 0);
    expect(host.querySelector(".dkb-learn.dkb-wait")).not.toBeNull();
    expect(host.querySelectorAll(".dkb-approve[data-wait]").length).toBe(3);
    host.innerHTML = render(d, bp, "how-ads-work", 2);
    expect(host.querySelector(".dkb-wait")).toBeNull();
    expect(host.querySelectorAll(".dkb-approve[data-wait]").length).toBe(0);
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
    const adds = [...host.querySelectorAll(".dkb-rule-card .dkb-add")];
    expect(adds.length).toBe(3);
    expect(adds[0].hasAttribute("data-quiet")).toBe(true);
    expect(adds[1].hasAttribute("data-quiet")).toBe(false);
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

  test("the cover's frames wait as blank mats with crop marks and one piece of tape each; the photo print says whose it is", () => {
    const { loaded, d, answers } = midCall("en");
    host.innerHTML = render(d, model(loaded, d, answers), "cover", 0);
    for (const f of host.querySelectorAll(".dkb-frame"))
      expect(f.querySelectorAll(":scope > .dkb-tape").length).toBe(1);
    expect(host.querySelectorAll(".dkb-mount-well").length).toBe(3);
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

  test("slide 6 pencils an example method until the first word, beside the notes, in one row", () => {
    const loaded = blueprintLoaded("full", "part1", { rehearse: false });
    const d = data(loaded, "en");
    host.innerHTML = render(d, model(loaded, d, {}), "best-at", 0);
    expect(host.querySelector(".dkb-bestat .dkb-method")).not.toBeNull();
    expect(host.querySelector(".dkb-ghost")?.textContent).toContain("Example");
    expect(
      host.querySelector(".dkb-method .dkb-ruled")?.hasAttribute("data-empty"),
    ).toBe(true);
    host.innerHTML = render(
      d,
      model(loaded, d, { method: "We draw every room first." }),
      "best-at",
      0,
    );
    expect(host.querySelector(".dkb-ghost")).toBeNull();
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
    const ghosts = [...host.querySelectorAll(".dkb-clip-ghost")];
    expect(ghosts.length).toBe(3);
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
    expect(host.querySelectorAll(".dkb-clip-ghost").length).toBe(0);
    const clips = [...host.querySelectorAll(".dkb-clip:not(.dkb-clip-add)")];
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
    expect(host.querySelector(".dkb-specimen")?.textContent).toContain(
      "Example pairing",
    );
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

  test("slide 12's talking-to-camera shot is a phone on a tripod, never an avatar", () => {
    const { loaded, d, answers } = midCall("en");
    host.innerHTML = render(d, model(loaded, d, answers), "content", 0);
    expect(host.querySelector(".dkb-sitter")).toBeNull();
    expect(
      host.querySelector('.dkb-polaroid[data-shot="0"] .dkb-rig'),
    ).not.toBeNull();
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
