import { type Cta, EXAMPLE, type Lang, t, tf } from "./content";
import type { Creative } from "./creative";
import {
  DEFAULT_SERVICE,
  isMain,
  MAIN,
  type MainKey,
  type ServiceKey,
} from "./services";

/**
 * The example ads (docs/csm-decks/DESIGN.md 22.4 and 22.14): eighteen
 * scenes from Mahara's own Higgsfield run, no client's work, no people, no
 * text, each labelled "Example ad" wherever it shows. Chosen by the
 * client's main service (the kickoff form's five), its lead picture first
 * and the others as alternates; the CSM can switch it in prep
 * (`example_theme`, by service, then by scene). The pictures are URLs only:
 * the bundle carries a table of addresses, the bytes load after the first
 * paint.
 */

export const THEMES = [
  "kitchen",
  "living",
  "majlis",
  "villa",
  "construction",
  "bathroom",
  "pool",
  "landscape",
  "bedroom",
  "office",
  "facade",
  "stairs",
  // 2026-10-21: the five main services' own scenes (SERVICE-MAP).
  "construction2",
  "construction3",
  "fitout2",
  "fitout3",
  "designbuild",
  "architecture2",
] as const;
export type Theme = (typeof THEMES)[number];

/**
 * The scenes of each main service, its lead picture first (CEO, 2026-10-21,
 * SERVICE-MAP; DESIGN 22.14): the lead shows first, the others are the
 * alternates a second phone and the tile fields take. A scene may serve two
 * services (a villa is designed and built, or drawn by an architect).
 */
export const SCENES: Record<MainKey, readonly Theme[]> = {
  "design-build": ["designbuild", "villa", "pool", "stairs"],
  interior: ["living", "majlis", "bedroom", "bathroom", "kitchen"],
  architecture: ["architecture2", "villa", "facade", "landscape"],
  fitout: ["fitout2", "fitout3", "office", "facade", "kitchen"],
  construction: ["construction", "construction2", "construction3"],
};

/**
 * Prep's switch (`example_theme`, the server's allow-list: DRIVE-IMPORT.md
 * 9): one of the five service keys (that service's pictures, its lead
 * first) or one of the eighteen scenes (that picture first). A scene
 * belongs to the client's service when it is one of its scenes, else to the
 * first service that has it. "construction" is both, and means the same
 * pictures either way.
 */
export function parseChoice(
  v: unknown,
): { service: MainKey | null; scene: Theme } | null {
  if (isMain(v)) return { service: v, scene: SCENES[v][0] };
  if (isTheme(v)) return { service: null, scene: v };
  return null;
}

/**
 * The value prep saves (by service, then by scene): the service's key for
 * its lead picture, else the scene itself.
 */
export const choiceOf = (service: MainKey, scene: Theme): string =>
  scene === SCENES[service][0] ? service : scene;

export interface ServiceExample {
  /** Whose pictures: the client's service, else the default (interior). */
  service: MainKey;
  /** The lead picture. */
  theme: Theme;
  /** The lead first, then the service's other scenes. */
  scenes: Theme[];
  /** The CSM's switch, the client's service, or the default. */
  from: "prep" | "service" | "default";
  /** The words the service was read from (prep's line names them). */
  text: string | null;
}

/**
 * The example for a client (DESIGN 22.14): prep's switch, else their main
 * service's scenes, else interior design's. "Other" (their words fit none)
 * takes the default, as SERVICE-MAP says.
 */
export function examplePick(
  choice: unknown,
  service: ServiceKey | null,
  text: string | null = null,
): ServiceExample {
  const own = service && service !== "other" ? service : null;
  const c = parseChoice(choice);
  if (c) {
    const svc =
      c.service ??
      (own && SCENES[own].includes(c.scene)
        ? own
        : (MAIN.find(k => SCENES[k].includes(c.scene)) ?? DEFAULT_SERVICE));
    return {
      service: svc,
      theme: c.scene,
      scenes: [c.scene, ...SCENES[svc].filter(x => x !== c.scene)],
      from: "prep",
      text: null,
    };
  }
  const svc = own ?? DEFAULT_SERVICE;
  return {
    service: svc,
    theme: SCENES[svc][0],
    scenes: [...SCENES[svc]],
    from: own ? "service" : "default",
    text: own ? text : null,
  };
}

/** The client's scene at a place: 0 the lead, 1 the first alternate, wrapping. */
export const sceneAt = (pick: { scenes: readonly Theme[] }, i: number) =>
  pick.scenes[i % pick.scenes.length];

/**
 * The scenes nearest each service, after its own (DESIGN 22.15): what a
 * client of that service would take for their own kind of work, so the
 * field's first rows and the next round never read as Mahara planning
 * another service's ads for them (an interior client's field showed cranes).
 * Never a sub-trade: a kitchen or a bathroom is no one's nearest service.
 */
export const NEAR: Record<MainKey, readonly Theme[]> = {
  interior: ["office", "stairs", "fitout3", "fitout2"],
  fitout: ["living", "majlis", "stairs", "bedroom"],
  construction: ["designbuild", "villa", "architecture2", "facade"],
  "design-build": ["architecture2", "construction3", "facade", "living"],
  architecture: ["designbuild", "pool", "stairs", "landscape"],
};

/**
 * The fill-ins after a service's own scenes and its near ones: the finished
 * rooms and the whole home first, then the other services' leads, then the
 * building sites, and the sub-trades (a kitchen, a bathroom) last of all,
 * so they never stand where a service's winners are shown (CEO,
 * 2026-10-21: "These are not kitchens").
 */
const FILL: readonly Theme[] = [
  "villa",
  "majlis",
  "office",
  "facade",
  "pool",
  "stairs",
  "landscape",
  "bedroom",
  "fitout3",
  "living",
  "designbuild",
  "architecture2",
  "fitout2",
  "construction3",
  "construction2",
  "construction",
  "kitchen",
  "bathroom",
];

/** A sub-trade's scene: one of an interior's rooms, never "the service". */
const SUB_TRADE = new Set<Theme>(["kitchen", "bathroom"]);

/**
 * The pictures prep's switch offers for a service (fixer round 2): its own
 * scenes without the sub-trades, so a kitchen or a bathroom is never made
 * the client's example ad; they stay as detail tiles only.
 */
export const pickableScenes = (service: MainKey): Theme[] =>
  SCENES[service].filter(x => !SUB_TRADE.has(x));

/**
 * Every scene once: the client's scenes (prep's pick first), then the ones
 * nearest their service, then the fill-ins; a kitchen or a bathroom comes
 * last of all, even when it is one of the service's own (an interior
 * client's lead is never followed by kitchens). `sceneAt` keeps the
 * service's own order: this order is for the tiles alone.
 */
export function sceneOrder(pick: {
  scenes: readonly Theme[];
  service?: MainKey;
}): Theme[] {
  const near = pick.service ? NEAR[pick.service] : [];
  const lead = pick.scenes[0];
  const out: Theme[] = [];
  for (const x of [...pick.scenes, ...near, ...FILL, ...THEMES])
    if (!out.includes(x) && (x === lead || !SUB_TRADE.has(x))) out.push(x);
  for (const x of FILL) if (!out.includes(x)) out.push(x);
  return out;
}

export const isTheme = (v: unknown): v is Theme =>
  typeof v === "string" && (THEMES as readonly string[]).includes(v);

// Vite turns each `new URL(`…${x}…`, import.meta.url)` into a table of the
// folder's files' URLs (no bytes in the bundle); under bun it is a file URL.
export const feedUrl = (theme: Theme) =>
  new URL(`./assets/examples/${theme}-feed.webp`, import.meta.url).href;
export const storyUrl = (theme: Theme) =>
  new URL(`./assets/examples/${theme}-story.webp`, import.meta.url).href;
export const tileUrl = (theme: Theme, cut: Cut) =>
  new URL(`./assets/examples/tile/${theme}-${cut}.webp`, import.meta.url).href;

/**
 * A tile's cut: a and b from the feed render (wide, then a detail), c and
 * d from the story render, a different shot of the same room (wide, then a
 * detail). Only the indoor scenes have c and d (final score round 1): an
 * interior or fit-out client's field and next round need twenty-four
 * different tiles of rooms, and the feed cuts alone gave fourteen.
 */
export type Cut = "a" | "b" | "c" | "d";

/** The finished rooms, the scenes with the story's two cuts as well. */
export const INDOOR: ReadonlySet<Theme> = new Set<Theme>([
  "living",
  "majlis",
  "bedroom",
  "office",
  "stairs",
  "fitout2",
  "fitout3",
]);

// ------------------------------------------------- the starter templates

/**
 * The example scenes a starter template was cut from, read from its file
 * name (DESIGN 22.18): a template made from one of the eighteen renders
 * keeps the scene's name as a word ("majlis-feed.webp",
 * "starter-living-reel.webp"). O7's strip and L3's field leave those scenes
 * out, so one picture is never "Example ads" on one stop and "Starter,
 * from our templates" on the next (score round 2 of the five services: the
 * full client's starters were crops of the example majlis and bedroom).
 */
export function scenesNamed(
  names: readonly (string | null | undefined)[],
): Theme[] {
  const out: Theme[] = [];
  for (const name of names) {
    for (const word of (name ?? "").toLowerCase().split(/[^a-z0-9]+/))
      if (isTheme(word) && !out.includes(word)) out.push(word);
  }
  return out;
}

/**
 * The pick without the scenes a starter was cut from: its own scenes that
 * are left (a sub-trade only as its lead), then its near ones up to three,
 * so the lit tiles stay their service's work (or the nearest to it) and
 * never a kitchen or a bathroom. Unchanged when nothing is avoided.
 */
function without(
  pick: ServiceExample,
  avoid: readonly Theme[],
): ServiceExample {
  if (!avoid.length) return pick;
  const lead = pick.scenes[0];
  const own = pick.scenes.filter(
    x => !avoid.includes(x) && (x === lead || !SUB_TRADE.has(x)),
  );
  const near = (NEAR[pick.service] ?? []).filter(
    x => !avoid.includes(x) && !own.includes(x),
  );
  // Three at least: the field keeps three tiles lit, each a scene of its own.
  const scenes = [...own, ...near].slice(0, Math.max(3, own.length));
  return scenes.length ? { ...pick, scenes } : pick;
}

// ----------------------------------------------------------- the field

/**
 * The field's three tiles that stay lit, "the few that work" (row 1
 * column 1, row 1 column 5, row 3 column 3: never a line, so it reads as
 * chance). Cards.tsx lights them; the field puts the client's own scenes
 * on them (DESIGN 22.15), so a winner is never another service's picture.
 */
export const KEPT = [0, 4, 14] as const;

/** A building site: another service's work in a room service's field. */
const SITES: ReadonlySet<Theme> = new Set([
  "construction",
  "construction2",
  "construction3",
]);
/**
 * Outside a room: a villa's front, its pool and garden, a building's
 * massing. In a room service's field they come only after every indoor
 * tile (final score round 1: eleven of an interior client's eighteen).
 */
const EXTERIOR: ReadonlySet<Theme> = new Set([
  "villa",
  "facade",
  "pool",
  "landscape",
  "architecture2",
  "designbuild",
]);
/** The services whose work is a room: a crane never stands in their field. */
const ROOMS: ReadonlySet<MainKey> = new Set(["interior", "fitout"]);

/**
 * L3's field and its next round, planned together (DESIGN 22.14, 22.15),
 * so no tile shows twice across the two. The kept tiles take the client's
 * own scenes, the lead and the alternate as details (cut b: L2's ad and
 * L4's phones show them large, either side) and the third as its wide cut.
 * The round is more of what won: their own scenes in the cut the field's
 * kept tiles did not show, then the near ones' details. The field's other
 * fifteen are what is left of their own scenes and the near ones, in both
 * cuts, then the fill-ins (wide cuts, then details). An interior or
 * fit-out client's field never shows a building site (score round 1: three
 * cranes in an interior client's first look), and a kitchen or a bathroom
 * only as the client's own detail, after everything else (CEO, 2026-10-21:
 * "These are not kitchens").
 */
function tilePlan(
  example: ServiceExample,
  count: number,
  avoid: readonly Theme[] = [],
): { field: string[]; round: string[] } {
  const pick = without(example, avoid);
  const own = pick.scenes;
  const rooms = ROOMS.has(pick.service);
  // A room service's field and round are rooms: no building site, and an
  // exterior only once every indoor tile is shown.
  const outside = (x: Theme) => rooms && EXTERIOR.has(x);
  const fits = (x: Theme) =>
    !SUB_TRADE.has(x) &&
    !(rooms && SITES.has(x)) &&
    !outside(x) &&
    !avoid.includes(x);
  const key = (x: Theme, c: Cut) => `${x}-${c}`;
  const used = new Set<string>();
  const field: (string | null)[] = Array.from({ length: count }, () => null);
  KEPT.forEach((at, k) => {
    if (at >= count) return;
    const scene = own[k % own.length];
    const cut: Cut = k < 2 ? "b" : "a";
    used.add(key(scene, cut));
    field[at] = tileUrl(scene, cut);
  });
  const keptDetail = new Set(
    KEPT.slice(0, 2).map((_, k) => own[k % own.length]),
  );
  const round = sceneOrder(pick)
    .filter(x => !avoid.includes(x) && !outside(x))
    .slice(0, 6)
    .map(x => {
      const cut: Cut = own.includes(x) && keptDetail.has(x) ? "a" : "b";
      used.add(key(x, cut));
      return tileUrl(x, cut);
    });
  const near = NEAR[pick.service] ?? [];
  const both = (list: readonly Theme[]): [Theme, Cut][] => [
    ...list.map(x => [x, "a"] as [Theme, Cut]),
    ...list.map(x => [x, "b"] as [Theme, Cut]),
  ];
  // A room service's rooms in the story's two cuts, after the feed's, each
  // cut across every room before the next, so one room's three pictures
  // never stand side by side.
  const story = (list: readonly Theme[]): [Theme, Cut][] =>
    rooms
      ? (["c", "d"] as const).flatMap(c =>
          list.filter(x => INDOOR.has(x)).map(x => [x, c] as [Theme, Cut]),
        )
      : [];
  const rooms1 = [...own, ...near, ...sceneOrder(pick)].filter(fits);
  const order: [Theme, Cut][] = [
    ...both(own.filter(fits)),
    ...both(near.filter(fits)),
    ...both(sceneOrder(pick).filter(fits)),
    ...story(rooms1.filter((x, i) => rooms1.indexOf(x) === i)),
    // Outside, for a room service, only after every room.
    ...both(sceneOrder(pick).filter(x => outside(x) && !avoid.includes(x))),
    // A sub-trade only as the client's own detail, last of all.
    ...own.filter(x => SUB_TRADE.has(x)).map(x => [x, "b"] as [Theme, Cut]),
  ];
  const rest: string[] = [];
  for (const [x, c] of order) {
    if (used.has(key(x, c))) continue;
    used.add(key(x, c));
    rest.push(tileUrl(x, c));
  }
  let j = 0;
  return {
    field: field.map(f => f ?? rest[j++ % rest.length]),
    round,
  };
}

/** L3's field: the client's own scenes kept lit, the rest near their service. */
export function serviceField(
  pick: ServiceExample,
  count = 18,
  avoid: readonly Theme[] = [],
): string[] {
  return tilePlan(pick, count, avoid).field;
}

/**
 * The next round's six (DESIGN 22.15): the client's own scenes in the cut
 * the field's kept tiles did not show, then the near ones' details; never a
 * tile the field shows.
 */
export function serviceRound(
  pick: ServiceExample,
  count = 6,
  avoid: readonly Theme[] = [],
): string[] {
  return tilePlan(pick, 18, avoid).round.slice(0, count);
}

/**
 * O7's two lit tiles (DESIGN 22.2.7): the first and the fifth of the row
 * of six, apart, so they read as picks, not as a lit pair.
 */
export const STRIP_LIT = new Set([0, 4]);

/**
 * O7's strip (DESIGN 22.15): six wide tiles, the two lit ones (tiles 0 and
 * 4, `STRIP_LIT`) their lead and its first alternate, so what wins is
 * always their own service's picture; the others their remaining scenes,
 * then the near ones and the fill-ins.
 */
export function stripTiles(
  example: ServiceExample,
  count = 6,
  avoid: readonly Theme[] = [],
): string[] {
  const pick = without(example, avoid);
  const own = pick.scenes;
  const lit = new Map([...STRIP_LIT].map((at, k) => [at, own[k % own.length]]));
  const rest = sceneOrder(pick).filter(
    x => ![...lit.values()].includes(x) && !avoid.includes(x),
  );
  let j = 0;
  return Array.from({ length: count }, (_, i) => {
    const scene = lit.get(i) ?? rest[j++ % rest.length];
    return tileUrl(scene, "a");
  });
}

// ----------------------------------------------------- the example creative

/** "Example ad: a finished kitchen…", in the deck's language. */
export const exampleAlt = (theme: Theme, lang: Lang) =>
  tf(EXAMPLE.alt, lang, { scene: t(EXAMPLE.scenes[theme], lang) });

/**
 * The example as a creative the phones draw (DESIGN 22.4.3): the theme's
 * picture under the client's Page name, with only the client's own words
 * (their selling point, else the service as they wrote it, else none),
 * "Learn more", and the service as the Facebook headline.
 */
export function exampleCreative(
  theme: Theme,
  shape: "feed" | "story",
  words: { primary: string | null; headline: string | null },
  lang: Lang,
): Creative {
  const url = shape === "feed" ? feedUrl(theme) : storyUrl(theme);
  return {
    id: `example-${theme}-${shape}`,
    from: "example",
    name: exampleAlt(theme, lang),
    url,
    poster: url,
    video: false,
    ratio: shape === "feed" ? 4 / 5 : 9 / 16,
    primaryText: words.primary,
    headline: words.headline,
    cta: "LEARN_MORE" as Cta,
    language: null,
    placement: shape === "feed" ? "feed" : "reels",
    starter: false,
    seconds: null,
  };
}

// ------------------------------------------------------------ loading

const warmed = new Set<string>();

/**
 * Fetch and decode pictures after the first paint, when the browser is
 * idle (Safari lacks requestIdleCallback in some versions: a timer then).
 * A picture already warmed is not asked for again. Never throws.
 */
export function warmExamples(urls: string[]): void {
  if (typeof window === "undefined" || typeof Image === "undefined") return;
  const todo = urls.filter(u => !warmed.has(u));
  if (!todo.length) return;
  for (const u of todo) warmed.add(u);
  const load = () => {
    for (const u of todo) {
      const img = new Image();
      img.decoding = "async";
      img.src = u;
      void img.decode?.().catch(() => {});
    }
  };
  const w = window as Window & {
    requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
  };
  const idle =
    w.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200));
  idle(load, { timeout: 2000 });
}
