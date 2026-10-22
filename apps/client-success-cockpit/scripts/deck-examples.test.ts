import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { FIXTURES, type FixtureKey } from "../src/dev/deck/fixtures";
import { deckData } from "../src/present/deckData";
import {
  choiceOf,
  exampleCreative,
  examplePick,
  INDOOR,
  KEPT,
  NEAR,
  parseChoice,
  pickableScenes,
  SCENES,
  STRIP_LIT,
  sceneAt,
  scenesNamed,
  serviceField,
  serviceRound,
  stripTiles,
  THEMES,
} from "../src/present/examples";
import {
  isSubTrade,
  KICKOFF_CHOICE,
  MAIN,
  queueServices,
  resolveService,
  serviceNames,
  serviceOfText,
  serviceRows,
} from "../src/present/services";

/**
 * The example ads (docs/csm-decks/DESIGN.md 22.4 and 22.14): the five main
 * services and the client's words mapped to them, which pictures each
 * service shows (lead first), the fields' tile order, the words inside an
 * example phone (only the client's own), and the 72 files with their sizes
 * and budgets.
 */

const DIR = resolve(import.meta.dir, "../src/present/assets/examples");

describe("the five main services (CEO, 2026-10-21)", () => {
  test("the kickoff form's choices, in its order", () => {
    expect([...MAIN]).toEqual([
      "design-build",
      "interior",
      "architecture",
      "fitout",
      "construction",
    ]);
    expect(MAIN.map(k => KICKOFF_CHOICE[k])).toEqual([
      "Design and build",
      "Interior design",
      "Architectural design",
      "Fit out and renovation",
      "Construction only",
    ]);
    // The kickoff's own answer and the decks' names, in both languages.
    for (const k of MAIN) expect(serviceOfText(KICKOFF_CHOICE[k])).toBe(k);
    for (const [text, key] of [
      ["تصميم وتنفيذ", "design-build"],
      ["تصميم داخلي", "interior"],
      ["تصميم معماري", "architecture"],
      ["تشطيب وترميم", "fitout"],
      ["بناء وإنشاءات", "construction"],
      ["Fit-out and renovation", "fitout"],
      ["Construction", "construction"],
    ] as const)
      expect({ text, key: serviceOfText(text) }).toEqual({ text, key });
    expect(serviceOfText("Other")).toBeNull();
  });

  test("a client's own words land on a main service, never a sub-trade", () => {
    const cases: [string, string | null][] = [
      ["Kitchens", "interior"],
      ["Bathrooms", "interior"],
      ["مطابخ", "interior"],
      ["Majlis design", "interior"],
      ["Villa interiors", "interior"],
      ["Villa interior design", "interior"],
      ["تصميم داخلي للفلل", "interior"],
      ["Full villa fit-out", "fitout"],
      ["Office fit-out", "fitout"],
      ["Kitchen renovation", "fitout"],
      ["تشطيب فلل", "fitout"],
      ["ترميم الواجهات", "fitout"],
      ["Design & Build", "design-build"],
      ["Swimming pools", "design-build"],
      ["حمام سباحة", "design-build"],
      ["Landscape design", "architecture"],
      ["Villa design and drawings", "architecture"],
      ["Engineering consultancy", "architecture"],
      ["مقاولات عامة", "construction"],
      // Shell and finishing is a building, not a fit-out.
      ["عظم وتشطيب", "construction"],
      ["بناء فلل سكنية", "construction"],
      ["Design studio", "interior"],
      // مكتب starts a firm's name; it is not a service.
      ["مكتب نور", null],
      ["Equipment rental", null],
      ["", null],
    ];
    for (const [text, key] of cases)
      expect({ text, key: serviceOfText(text) }).toEqual({ text, key });
  });

  test("the pick: a choice as it is, a form's words only when they fit, else Other in their words", () => {
    expect(
      resolveService([
        { from: "prep", text: null, explicit: true },
        { from: "kickoff", text: "Fit out and renovation", explicit: true },
        { from: "form", text: "Kitchens", explicit: false },
      ]),
    ).toMatchObject({ key: "fitout", from: "kickoff" });
    expect(
      resolveService([
        { from: "form", text: "Equipment rental", explicit: false },
        { from: "form", text: "Kitchens", explicit: false },
      ]),
    ).toMatchObject({ key: "interior", from: "form", text: "Kitchens" });
    const other = resolveService([
      { from: "form", text: "Equipment rental", explicit: false },
    ]);
    expect(other).toMatchObject({
      key: "other",
      words: { en: "Equipment rental" },
    });
    expect(serviceNames(other).mid.en).toBe("equipment rental");
    expect(serviceNames(resolveService([])).name.en).toBeNull();
  });

  test("slide 4's rows: the five, their own words under each, Other only when needed", () => {
    const none = resolveService([]);
    const rows = serviceRows(
      ["Kitchens", "Interior design", "Full villa fit-out", "Majlis design"],
      none,
    );
    expect(rows.map(r => [r.key, r.own])).toEqual([
      ["design-build", []],
      ["interior", ["Kitchens", "Majlis design"]],
      ["architecture", []],
      ["fitout", ["Full villa fit-out"]],
      ["construction", []],
    ]);
    const withOther = serviceRows(["بناء فلل سكنية", "تأجير معدات"], none);
    expect(withOther.at(-1)).toEqual({ key: "other", own: ["تأجير معدات"] });
  });
});

describe("the call queue's rows (L2 stop 3): the launch service's own words only", () => {
  test("a sub-trade is never a row's service, in either language", () => {
    for (const w of [
      "Kitchens and wardrobes",
      "Kitchen renovation",
      "Bathrooms",
      "المطابخ والخزائن",
      "حمامات",
      "دواليب",
    ])
      expect({ w, sub: isSubTrade(w) }).toEqual({ w, sub: true });
    for (const w of ["Villa interiors", "Majlis design", "تصميم المجالس", null])
      expect({ w, sub: isSubTrade(w) }).toEqual({ w, sub: false });
  });

  test("the service first, then the client's words for that service, in the deck's script", () => {
    const words = [
      "Villa interiors",
      "Kitchens and wardrobes",
      "Majlis design",
      "Full villa fit-out",
      "Interior design",
      "تصميم المجالس",
    ];
    expect(queueServices("Interior design", "interior", words, "en")).toEqual([
      "Interior design",
      "Villa interiors",
      "Majlis design",
    ]);
    // A fit-out campaign: its own words, a kitchen's renovation left out.
    expect(
      queueServices(
        "Fit-out and renovation",
        "fitout",
        ["Villa fit-out", "Shop and office fit-out", "Kitchen renovation"],
        "en",
      ),
    ).toEqual([
      "Fit-out and renovation",
      "Villa fit-out",
      "Shop and office fit-out",
    ]);
    expect(
      queueServices(
        "تصميم داخلي",
        "interior",
        [
          "تصميم داخلي للفلل",
          "المطابخ والخزائن",
          "تصميم المجالس",
          "تشطيب فيلا كاملة",
        ],
        "ar",
      ),
    ).toEqual(["تصميم داخلي", "تصميم داخلي للفلل", "تصميم المجالس"]);
    // "Other": the words that fit none of the five; nothing known: all but a sub-trade.
    expect(
      queueServices(
        "Equipment rental",
        "other",
        ["Crane hire", "Villa interiors"],
        "en",
      ),
    ).toEqual(["Equipment rental", "Crane hire"]);
    expect(
      queueServices(null, null, ["Kitchens", "Villa interiors"], "en"),
    ).toEqual(["Villa interiors"]);
  });
});

describe("which pictures: by main service (SERVICE-MAP, DESIGN 22.14)", () => {
  test("each service's scenes, its lead first", () => {
    expect(SCENES).toEqual({
      "design-build": ["designbuild", "villa", "pool", "stairs"],
      interior: ["living", "majlis", "bedroom", "bathroom", "kitchen"],
      architecture: ["architecture2", "villa", "facade", "landscape"],
      fitout: ["fitout2", "fitout3", "office", "facade", "kitchen"],
      construction: ["construction", "construction2", "construction3"],
    });
    // Every scene serves at least one service.
    for (const x of THEMES)
      expect({ x, used: MAIN.some(k => SCENES[k].includes(x)) }).toEqual({
        x,
        used: true,
      });
  });

  test("prep's switch: a service's key or a scene (the server's allow-list)", () => {
    expect(parseChoice("fitout")).toEqual({
      service: "fitout",
      scene: "fitout2",
    });
    expect(parseChoice("kitchen")).toEqual({ service: null, scene: "kitchen" });
    // "construction" is both a key and its lead scene: the same pictures.
    expect(parseChoice("construction")).toEqual({
      service: "construction",
      scene: "construction",
    });
    expect(parseChoice("fitout:office")).toBeNull();
    expect(parseChoice("garage")).toBeNull();
    expect(choiceOf("architecture", "architecture2")).toBe("architecture");
    expect(choiceOf("architecture", "villa")).toBe("villa");
    expect(examplePick("architecture", "interior")).toMatchObject({
      service: "architecture",
      theme: "architecture2",
      scenes: ["architecture2", "villa", "facade", "landscape"],
      from: "prep",
    });
    // A bare scene belongs to the client's service when it is one of its
    // own, else to the first service that has it.
    expect(examplePick("kitchen", "fitout")).toMatchObject({
      service: "fitout",
      scenes: ["kitchen", "fitout2", "fitout3", "office", "facade"],
    });
    expect(examplePick("kitchen", "construction").service).toBe("interior");
    expect(examplePick("villa", "architecture").service).toBe("architecture");
    expect(examplePick(null, "construction")).toMatchObject({
      theme: "construction",
      from: "service",
    });
    // Other and nothing known: interior design's pictures.
    expect(examplePick(null, "other")).toMatchObject({
      service: "interior",
      theme: "living",
      from: "default",
    });
    expect(examplePick(null, null).theme).toBe("living");
  });

  test("prep's picture select never offers a kitchen or a bathroom as the example (fixer round 2)", () => {
    for (const k of MAIN) {
      const offered = pickableScenes(k);
      expect(offered.join(" ")).not.toMatch(/kitchen|bathroom/);
      // Everything else of the service's own, lead first.
      expect(offered).toEqual(
        SCENES[k].filter(x => x !== "kitchen" && x !== "bathroom"),
      );
      expect(offered[0]).toBe(SCENES[k][0]);
    }
    expect(pickableScenes("interior")).toEqual(["living", "majlis", "bedroom"]);
    expect(pickableScenes("fitout")).toEqual([
      "fitout2",
      "fitout3",
      "office",
      "facade",
    ]);
  });

  test("every value prep can save is one the server keeps", () => {
    const sql = readFileSync(
      resolve(
        import.meta.dir,
        "../../../supabase/migrations/20261020160100_csm_deck_prep_dos_ar.sql",
      ),
      "utf8",
    );
    const branch = sql.slice(sql.indexOf("WHEN p_key = 'example_theme'"));
    const allowed = new Set(
      [
        ...branch
          .slice(0, branch.indexOf("p_key);"))
          .matchAll(/'([a-z0-9-]+)'/g),
      ].map(m => m[1]),
    );
    for (const k of MAIN) {
      expect(allowed.has(k)).toBe(true);
      for (const x of SCENES[k]) expect(allowed.has(choiceOf(k, x))).toBe(true);
    }
    for (const x of THEMES)
      expect({ x, kept: allowed.has(x) }).toEqual({ x, kept: true });
  });

  test("slide 4's quiet lines keep one script: the Arabic list in the Arabic deck, the words as written without one (score round 1)", () => {
    const f = FIXTURES.full("onboarding");
    const make = (prep: typeof f.prep, lang: "en" | "ar") =>
      deckData({
        taskId: "fixture-full",
        deck: "onboarding",
        lang,
        sources: f.sources,
        kit: f.kit,
        prep,
        ads: f.ads,
        publicUrl: (_b, p) => p,
        now: new Date("2026-10-19T09:00:00Z"),
      });
    const own = (d: ReturnType<typeof make>, k: string) =>
      d.serviceRows.find(r => r.key === k)?.own ?? [];
    const ar = make(f.prep, "ar");
    expect(own(ar, "interior")[0]).toBe("تصميم داخلي للفلل");
    expect(own(ar, "fitout")).toEqual(["تشطيب فيلا كاملة"]);
    for (const r of ar.serviceRows)
      for (const w of r.own)
        expect({ w, latin: /[A-Za-z]/.test(w) }).toEqual({ w, latin: false });
    // The English deck keeps their words as written.
    expect(own(make(f.prep, "en"), "interior")[0]).toBe("Villa interiors");
    // No Arabic list: the Arabic deck falls back to the words as written.
    const bare = make(
      { ...f.prep, onboarding: { ...f.prep.onboarding, services_ar: null } },
      "ar",
    );
    expect(own(bare, "interior")[0]).toBe("Villa interiors");
  });

  test("every fixture shows a different service's pictures, none a sub-trade", () => {
    const seen = new Map<FixtureKey, string>();
    for (const key of Object.keys(FIXTURES) as FixtureKey[]) {
      const f = FIXTURES[key](key === "starter" ? "launch" : "onboarding");
      const d = deckData({
        taskId: `fixture-${key}`,
        deck: key === "starter" ? "launch" : "onboarding",
        lang: "en",
        sources: f.sources,
        kit: f.kit,
        prep: f.prep,
        ads: f.ads,
        publicUrl: (_b, p) => p,
        now: new Date("2026-10-19T09:00:00Z"),
      });
      expect(THEMES).toContain(d.example.theme);
      seen.set(key, d.example.service);
      // Neither the service, their #1 nor a starter template's words or
      // picture name a sub-trade (the CEO, 2026-10-21: "These are not
      // kitchens"; score round 4: the interior client's starters were two
      // kitchens, one captioned "…the last cabinet").
      const SUB_TRADE =
        /kitchen|bathroom|cabinet|wardrobe|مطبخ|مطابخ|حمام|خزائن|دواليب/i;
      expect(d.serviceFocus ?? "").not.toMatch(SUB_TRADE);
      expect(d.numberOne ?? "").not.toMatch(SUB_TRADE);
      for (const a of f.ads.filter(x => x.kind === "starter")) {
        expect({ key, text: a.primaryText }).not.toMatchObject({
          text: expect.stringMatching(SUB_TRADE),
        });
        // Each starter picture is a crop of its own service's scenes,
        // named for the service (starter-interior-*, starter-fitout-*).
        // Under bun on Windows an imported asset is a backslash path.
        const file = String(a.url).split(/[\\/]/).pop() ?? "";
        expect({ key, file }).toMatchObject({
          file: expect.stringMatching(
            key === "starter"
              ? /^starter-fitout-(feed|reel)\.webp$/
              : /^starter-interior-(feed|reel)\.webp$/,
          ),
        });
      }
    }
    expect(Object.fromEntries(seen)).toEqual({
      full: "interior",
      sparse: "design-build",
      dwy: "construction",
      starter: "fitout",
    });
  });
});

describe("the tiles and the places (DESIGN 22.14)", () => {
  test("the field and the round: no tile twice, the service first, the two large ones as details", () => {
    for (const k of MAIN) {
      const pick = examplePick(null, k);
      const field = serviceField(pick);
      const round = serviceRound(pick);
      expect(field.length).toBe(18);
      expect(round.length).toBe(6);
      expect(new Set([...field, ...round]).size).toBe(24);
      // The kept tiles are their own: the lead and the alternate as
      // details (L2's and L4's large pictures), the third wide.
      expect(field[0]).toContain(`/tile/${sceneAt(pick, 0)}-b.webp`);
      expect(field[4]).toContain(`/tile/${sceneAt(pick, 1)}-b.webp`);
      expect(field[14]).toContain(`/tile/${sceneAt(pick, 2)}-a.webp`);
      expect(stripTiles(pick)[0]).toContain(`/tile/${sceneAt(pick, 0)}-a.webp`);
      expect(stripTiles(pick)[4]).toContain(`/tile/${sceneAt(pick, 1)}-a.webp`);
    }
  });

  const sceneOf = (url: string) =>
    /\/tile\/([a-z0-9]+)-[abcd]\.webp$/.exec(url)?.[1] ?? "";

  test("what wins is always their service's own picture, never a kitchen or a bathroom (DESIGN 22.15)", () => {
    for (const k of MAIN) {
      const pick = examplePick(null, k);
      const strip = stripTiles(pick);
      const own = (scene: string) =>
        (SCENES[k] as readonly string[]).includes(scene);
      for (const i of STRIP_LIT) {
        const scene = sceneOf(strip[i]);
        expect({ k, i, scene, own: own(scene) }).toEqual({
          k,
          i,
          scene,
          own: true,
        });
        expect(scene).not.toMatch(/kitchen|bathroom/);
      }
      const field = serviceField(pick);
      for (const i of KEPT) {
        const scene = sceneOf(field[i]);
        expect({ k, i, scene, own: own(scene) }).toEqual({
          k,
          i,
          scene,
          own: true,
        });
      }
    }
  });

  test("an interior or fit-out client's field and round: no building site anywhere, no kitchen or bathroom, the first row their own work and the near ones (score round 1)", () => {
    for (const k of ["interior", "fitout"] as const) {
      const pick = examplePick(null, k);
      const field = serviceField(pick);
      const shown = [...field, ...serviceRound(pick)];
      for (const url of shown)
        expect({ k, scene: sceneOf(url) }).not.toMatchObject({
          scene: expect.stringMatching(/^construction|kitchen|bathroom/),
        });
      const near = [...SCENES[k], ...NEAR[k]] as string[];
      for (const url of field.slice(0, 6))
        expect({
          k,
          scene: sceneOf(url),
          near: near.includes(sceneOf(url)),
        }).toEqual({ k, scene: sceneOf(url), near: true });
    }
    // The interior client's field, as the CEO sees it on the harness.
    const interior = serviceField(examplePick(null, "interior")).map(sceneOf);
    expect(interior.slice(0, 6)).toEqual([
      "living",
      "office",
      "stairs",
      "fitout3",
      "majlis",
      "fitout2",
    ]);
    // Rooms only (final score round 1: eleven of the interior client's
    // eighteen were villa fronts, pools and gardens, and fit-out's next
    // round had a villa's front door): with the story's two cuts of the
    // seven indoor scenes, twenty-four different rooms, no exterior.
    for (const k of ["interior", "fitout"] as const) {
      const pick = examplePick(null, k);
      const shown = [...serviceField(pick), ...serviceRound(pick)];
      expect(new Set(shown).size).toBe(24);
      for (const url of shown)
        expect({
          k,
          scene: sceneOf(url),
          indoor: INDOOR.has(sceneOf(url) as never),
        }).toEqual({
          k,
          scene: sceneOf(url),
          indoor: true,
        });
    }
    // A sub-trade the CSM picked as the lead is theirs: kept, as a detail.
    const kitchen = examplePick("kitchen", "interior");
    expect(serviceField(kitchen)[0]).toContain("/tile/kitchen-b.webp");
    // Every service's near scenes are real scenes, never its own again.
    for (const k of MAIN) for (const x of NEAR[k]) expect(THEMES).toContain(x);
  });

  test("a starter template cut from an example scene: the strip and the field leave the scene out (DESIGN 22.18)", () => {
    expect(
      scenesNamed(["majlis-feed.webp", "Starter_Living-reel.webp", null]),
    ).toEqual(["majlis", "living"]);
    expect(scenesNamed(["starter-feed.webp", "interior-majlis2.webp"])).toEqual(
      [],
    );
    for (const k of MAIN) {
      const pick = examplePick(null, k);
      const avoid = [sceneAt(pick, 0)];
      const strip = stripTiles(pick, 6, avoid);
      const field = serviceField(pick, 18, avoid);
      const round = serviceRound(pick, 6, avoid);
      for (const url of [...strip, ...field, ...round])
        expect({ k, scene: sceneOf(url) }).not.toEqual({ k, scene: avoid[0] });
      expect(new Set([...field, ...round]).size).toBe(24);
      // What stays lit is still their service's work (or its nearest),
      // never a sub-trade.
      for (const i of STRIP_LIT) {
        const scene = sceneOf(strip[i]);
        expect([...SCENES[k], ...NEAR[k]] as string[]).toContain(scene);
        expect(scene).not.toMatch(/kitchen|bathroom/);
      }
    }
    // Nothing avoided: the same tiles as before.
    const interior = examplePick(null, "interior");
    expect(stripTiles(interior, 6, [])).toEqual(stripTiles(interior));
    // Every fixture's starters are named for none of the eighteen scenes.
    for (const key of Object.keys(FIXTURES) as FixtureKey[]) {
      const loaded = FIXTURES[key]("launch");
      const starters = loaded.ads.filter(a => a.kind === "starter");
      expect({
        key,
        scenes: scenesNamed(starters.map(a => a.fileName)),
      }).toEqual({ key, scenes: [] });
    }
  });

  test("the cover and journey stop 1 are different scenes; L4's second phone the alternate; L5 the third", () => {
    for (const k of MAIN) {
      const pick = examplePick(null, k);
      expect(sceneAt(pick, 0)).not.toBe(sceneAt(pick, 1));
      // L5's cover comes right after L4, whose phones carry the lead and
      // the alternate: it takes a third scene of the same service.
      expect(SCENES[k].length).toBeGreaterThanOrEqual(3);
      expect([sceneAt(pick, 0), sceneAt(pick, 1)]).not.toContain(
        sceneAt(pick, 2),
      );
    }
  });
});

describe("the words inside an example phone are the client's own", () => {
  test("their selling point, else the service, else none; Learn more", () => {
    const c = exampleCreative(
      "kitchen",
      "feed",
      { primary: null, headline: "Interior design" },
      "en",
    );
    expect(c).toMatchObject({
      from: "example",
      primaryText: null,
      headline: "Interior design",
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

describe("the 86 files (DESIGN 22.4.1, 22.14 and 22.19)", () => {
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

  test("the names: a feed and a story for each theme, an -a and a -b tile, and a -c and a -d for the indoor scenes", () => {
    expect(big.sort()).toEqual(
      THEMES.flatMap(t => [`${t}-feed.webp`, `${t}-story.webp`]).sort(),
    );
    expect(tiles.sort()).toEqual(
      THEMES.flatMap(t => [
        `${t}-a.webp`,
        `${t}-b.webp`,
        ...(INDOOR.has(t) ? [`${t}-c.webp`, `${t}-d.webp`] : []),
      ]).sort(),
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
