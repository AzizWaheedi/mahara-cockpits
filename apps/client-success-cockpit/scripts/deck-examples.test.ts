import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { FIXTURES, type FixtureKey } from "../src/dev/deck/fixtures";
import { deckData } from "../src/present/deckData";
import {
  exampleCreative,
  fieldTiles,
  pickExample,
  roundTiles,
  THEMES,
  themeOfText,
} from "../src/present/examples";

/**
 * The example ads (docs/csm-decks/DESIGN.md 22.4): which picture a client's
 * service gets, the field's tile order, the words inside an example phone
 * (only the client's own), and the 48 files with their sizes and budgets.
 */

const DIR = resolve(import.meta.dir, "../src/present/assets/examples");

describe("which example: the service map (DESIGN 22.4.2)", () => {
  test("the pinned cases", () => {
    const cases: [string, string][] = [
      ["Kitchens", "kitchen"],
      ["Full villa fit-out", "living"],
      ["Office fit-out", "office"],
      ["تشطيب فلل", "living"],
      ["Fit-Out & Renovation", "office"],
      ["Interior design", "living"],
      ["مطابخ", "kitchen"],
      ["ترميم الواجهات", "facade"],
      ["مقاولات عامة", "construction"],
      // The fixer's round: a pool in Gulf Arabic is حمام سباحة, never a
      // bathroom; a home's interior is the living room, not the villa's
      // outside.
      ["حمام سباحة", "pool"],
      ["حمامات السباحة", "pool"],
      ["Villa interior design", "living"],
      ["Luxury villa interiors", "living"],
      ["تصميم داخلي للفلل", "living"],
      ["Bathrooms", "bathroom"],
      ["Swimming pools", "pool"],
      ["Majlis design", "majlis"],
    ];
    for (const [text, theme] of cases)
      expect({ text, theme: themeOfText(text) }).toEqual({ text, theme });
    expect(themeOfText("")).toBeNull();
    expect(pickExample(null, [null, "", "Something else"]).theme).toBe(
      "living",
    );
  });

  test("prep's switch wins, then the texts in order", () => {
    expect(pickExample("majlis", ["Kitchens"])).toEqual({
      theme: "majlis",
      from: "prep",
      text: null,
    });
    expect(pickExample("garage", ["Kitchens"]).theme).toBe("kitchen");
    expect(pickExample(null, [null, "Bathrooms", "Kitchens"])).toEqual({
      theme: "bathroom",
      from: "text",
      text: "Bathrooms",
    });
  });

  test("every fixture's services land on a theme", () => {
    for (const key of Object.keys(FIXTURES) as FixtureKey[]) {
      const f = FIXTURES[key]();
      const d = deckData({
        taskId: `fixture-${key}`,
        deck: "launch",
        lang: "en",
        sources: f.sources,
        kit: f.kit,
        prep: f.prep,
        ads: f.ads,
        publicUrl: (_b, p) => p,
        now: new Date("2026-10-19T09:00:00Z"),
      });
      expect(THEMES).toContain(d.example.theme);
    }
  });
});

describe("the field's tiles (DESIGN 22.4.4)", () => {
  test("their own theme first, no picture twice in the field or the round", () => {
    for (const theme of THEMES) {
      const field = fieldTiles(theme);
      const round = roundTiles(theme);
      expect(field.length).toBe(18);
      expect(round.length).toBe(6);
      expect(field[0]).toContain(`/tile/${theme}-a.webp`);
      expect(new Set([...field, ...round]).size).toBe(24);
    }
  });
});

describe("the words inside an example phone are the client's own", () => {
  test("their selling point, else the service, else none; Learn more", () => {
    const c = exampleCreative(
      "kitchen",
      "feed",
      { primary: null, headline: "Kitchens" },
      "en",
    );
    expect(c).toMatchObject({
      from: "example",
      primaryText: null,
      headline: "Kitchens",
      cta: "LEARN_MORE",
      ratio: 4 / 5,
    });
    expect(c.name).toBe(
      "Example ad: a finished kitchen with an oak and quartz island",
    );
    expect(
      exampleCreative("pool", "story", { primary: null, headline: null }, "ar")
        .ratio,
    ).toBe(9 / 16);
  });

  test("the Arabic deck's caption takes an Arabic service from the forms when prep has none", () => {
    const f = FIXTURES.dwy();
    const d = deckData({
      taskId: "fixture-dwy",
      deck: "launch",
      lang: "ar",
      sources: f.sources,
      kit: f.kit,
      prep: {
        ...f.prep,
        onboarding: { ...f.prep.onboarding, service_focus_ar: null },
        launch: { ...f.prep.launch, selling_point_ar: null },
      },
      ads: f.ads,
      publicUrl: (_b, p) => p,
      now: new Date("2026-10-19T09:00:00Z"),
    });
    // Never a Latin service inside the Arabic caption.
    if (d.exampleWords.primary) expect(d.exampleWords.primary).toMatch(/[؀-ۿ]/);
  });
});

describe("the 48 files (DESIGN 22.4.1)", () => {
  const big = readdirSync(DIR).filter(f => f.endsWith(".webp"));
  const tiles = readdirSync(resolve(DIR, "tile")).filter(f =>
    f.endsWith(".webp"),
  );
  /** A WebP's width and height from its VP8, VP8L or VP8X header. */
  function size(path: string): [number, number] {
    const b = readFileSync(path);
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X")
      return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
    if (kind === "VP8L") {
      const bits = b.readUInt32LE(21);
      return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
    }
    return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  }

  test("the names: a feed and a story for each theme, an -a and a -b tile", () => {
    expect(big.sort()).toEqual(
      THEMES.flatMap(t => [`${t}-feed.webp`, `${t}-story.webp`]).sort(),
    );
    expect(tiles.sort()).toEqual(
      THEMES.flatMap(t => [`${t}-a.webp`, `${t}-b.webp`]).sort(),
    );
  });

  test("their pixel sizes and budgets: 340 KB at most, tiles 24 KB", () => {
    for (const f of big) {
      const p = resolve(DIR, f);
      expect({ f, size: size(p) }).toEqual({
        f,
        size: f.endsWith("-feed.webp") ? [1080, 1350] : [1080, 1920],
      });
      expect({ f, kb: statSync(p).size <= 340 * 1024 }).toEqual({
        f,
        kb: true,
      });
    }
    for (const f of tiles) {
      const p = resolve(DIR, "tile", f);
      expect({ f, size: size(p) }).toEqual({ f, size: [216, 270] });
      expect({ f, kb: statSync(p).size <= 24 * 1024 }).toEqual({
        f,
        kb: true,
      });
    }
  });
});
