import { describe, expect, test } from "bun:test";
import {
  keyCommand,
  langParam,
  slideAtHash,
  stepFrom,
  visible,
  withPlayer,
} from "../src/present/engine";
import { onboardingSlides } from "../src/present/onboardingDeck";
import { playerStep } from "../src/present/videos";

/**
 * The deck engine's rules (DESIGN 5.2, 15.1): a press walks a slide's stops
 * before the slides, coming back lands on the last stop, and Esc never
 * leaves the deck (a clicker's start/stop button sends Esc, and leaving
 * would put the cockpit's client page on the client's screen).
 */

describe("stops, then slides", () => {
  const stops = [1, 3, 1, 2];

  test("→ walks a slide's stops before leaving it", () => {
    expect(stepFrom({ index: 1, tour: 0 }, 1, stops)).toEqual({
      index: 1,
      tour: 1,
    });
    expect(stepFrom({ index: 1, tour: 1 }, 1, stops)).toEqual({
      index: 1,
      tour: 2,
    });
    expect(stepFrom({ index: 1, tour: 2 }, 1, stops)).toEqual({
      index: 2,
      tour: 0,
    });
  });

  test("← from the next slide lands on the last stop", () => {
    expect(stepFrom({ index: 2, tour: 0 }, -1, stops)).toEqual({
      index: 1,
      tour: 2,
    });
    expect(stepFrom({ index: 1, tour: 0 }, -1, stops)).toEqual({
      index: 0,
      tour: 0,
    });
  });

  test("nothing moves at either end", () => {
    expect(stepFrom({ index: 0, tour: 0 }, -1, stops)).toBeNull();
    expect(stepFrom({ index: 3, tour: 1 }, 1, stops)).toBeNull();
  });

  test("a slide with no stops counts as one", () => {
    expect(stepFrom({ index: 0, tour: 0 }, 1, [0, 1])).toEqual({
      index: 1,
      tour: 0,
    });
  });
});

describe("keys", () => {
  const k = (
    key: string,
    extra: Partial<Parameters<typeof keyCommand>[0]> = {},
  ) => keyCommand({ key, ...extra });

  test("arrows, Space, a clicker's PageUp/PageDown, Home and End", () => {
    expect(k("ArrowRight")).toBe("next");
    expect(k("PageDown")).toBe("next");
    expect(k(" ")).toBe("next");
    expect(k("ArrowLeft")).toBe("prev");
    expect(k("PageUp")).toBe("prev");
    expect(k("Home")).toBe("first");
    expect(k("End")).toBe("last");
  });

  test("F, L, O and N, either case", () => {
    expect(k("f")).toBe("fullscreen");
    expect(k("F")).toBe("fullscreen");
    expect(k("l")).toBe("lang");
    expect(k("O")).toBe("overview");
    expect(k("n")).toBe("notes");
  });

  test("Esc closes the overview or a panel, and otherwise does nothing", () => {
    expect(k("Escape")).toBe("none");
    expect(k("Escape", { overview: false, panel: false })).toBe("none");
    expect(k("Escape", { overview: true })).toBe("close");
    expect(k("Escape", { panel: true })).toBe("close");
    // In or out of full screen there is no key that leaves the deck.
    const all = [
      "Escape",
      "Esc",
      "Backspace",
      "q",
      "Q",
      "b",
      "ArrowUp",
      "ArrowDown",
    ];
    for (const key of all)
      expect(["none", "close"]).toContain(k(key, { overview: true }));
  });

  test("typing in a field is never caught", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
      expect(k("ArrowRight", { tag })).toBe("none");
      expect(k("f", { tag })).toBe("none");
      expect(k(" ", { tag })).toBe("none");
    }
    expect(k("l", { editable: true })).toBe("none");
  });

  test("Space on a focused button presses the button, not the deck", () => {
    expect(k(" ", { tag: "BUTTON" })).toBe("none");
    expect(k("ArrowRight", { tag: "BUTTON" })).toBe("next");
  });

  test("modifier keys are left to the browser", () => {
    expect(k("f", { meta: true })).toBe("none");
    expect(k("l", { ctrl: true })).toBe("none");
    expect(k("ArrowRight", { alt: true })).toBe("none");
  });
});

describe("the video player (DESIGN 21.3, 21.6)", () => {
  test("V plays the slide's video or closes it; typing is never caught", () => {
    expect(keyCommand({ key: "v" })).toBe("video");
    expect(keyCommand({ key: "V" })).toBe("video");
    expect(keyCommand({ key: "v", tag: "TEXTAREA" })).toBe("none");
    expect(keyCommand({ key: "v", meta: true })).toBe("none");
  });
  test("the player is a panel: Esc closes it, never the deck", () => {
    expect(keyCommand({ key: "Escape", panel: true })).toBe("close");
    expect(keyCommand({ key: "Escape", panel: true, overview: true })).toBe(
      "close",
    );
  });
  test("with the player open, a move key closes it and does nothing else", () => {
    for (const cmd of ["next", "prev", "first", "last"] as const)
      expect(withPlayer(cmd)).toBe("close");
    for (const cmd of [
      "video",
      "close",
      "notes",
      "fullscreen",
      "lang",
    ] as const)
      expect(withPlayer(cmd)).toBe(cmd);
  });
  test("a stubbed Wistia frame that loads and sends nothing stays up", () => {
    let p = playerStep("loading", { type: "load" });
    for (const ev of [{ type: "timeout" }, { type: "offline" }] as const)
      p = playerStep(p, ev);
    expect(p).toBe("ready");
    expect(playerStep("loading", { type: "timeout" })).toBe("failed");
  });
});

describe("which slides show, and the address", () => {
  const slides = [{ id: "a" }, { id: "b", defaultHidden: true }, { id: "c" }];

  test("prep hides a slide, and shows one hidden by default", () => {
    expect(visible(slides, {}).map(s => s.id)).toEqual(["a", "c"]);
    expect(visible(slides, { hidden_slides: ["a"] }).map(s => s.id)).toEqual([
      "c",
    ]);
    expect(visible(slides, { shown_slides: ["b"] }).map(s => s.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(
      visible(slides, { hidden_slides: ["b"], shown_slides: ["b"] }).map(
        s => s.id,
      ),
    ).toEqual(["a", "c"]);
  });

  test("#slide-id deep links, and a bad one lands on the cover", () => {
    expect(slideAtHash(slides, "#c")).toBe(2);
    expect(slideAtHash(slides, "#nope")).toBe(-1);
    expect(slideAtHash(slides, "#%E0%A4%A")).toBe(-1);
  });

  test("?lang picks the language only when it is one of the two", () => {
    expect(langParam("?lang=ar")).toBe("ar");
    expect(langParam("?x=1&lang=en")).toBe("en");
    expect(langParam("?lang=fr")).toBeNull();
    expect(langParam("")).toBeNull();
  });
});

describe("the onboarding deck", () => {
  test("eight slides, in CONTENT.md's order: the kickoff form last (2026-10-22)", () => {
    expect(onboardingSlides().map(s => s.id)).toEqual([
      "welcome",
      "goals",
      "team",
      "one-service",
      "road",
      "this-week",
      "next",
      "kickoff",
    ]);
  });

  test("ids are what the server takes as slide ids", () => {
    for (const s of onboardingSlides())
      expect(s.id).toMatch(/^[a-z0-9-]{1,40}$/);
  });

  test("only the cover carries no count, and every slide has notes", () => {
    const slides = onboardingSlides();
    expect(slides.filter(s => s.cover).map(s => s.id)).toEqual(["welcome"]);
    for (const s of slides) expect(s.notes.say.length).toBeGreaterThan(0);
  });
});
