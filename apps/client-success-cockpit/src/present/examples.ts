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

/** Every scene, the client's service first, then the rest in their order. */
export function sceneOrder(pick: { scenes: readonly Theme[] }): Theme[] {
  return [...pick.scenes, ...THEMES.filter(x => !pick.scenes.includes(x))];
}

export const isTheme = (v: unknown): v is Theme =>
  typeof v === "string" && (THEMES as readonly string[]).includes(v);

// Vite turns each `new URL(`…${x}…`, import.meta.url)` into a table of the
// folder's files' URLs (no bytes in the bundle); under bun it is a file URL.
export const feedUrl = (theme: Theme) =>
  new URL(`./assets/examples/${theme}-feed.webp`, import.meta.url).href;
export const storyUrl = (theme: Theme) =>
  new URL(`./assets/examples/${theme}-story.webp`, import.meta.url).href;
export const tileUrl = (theme: Theme, cut: "a" | "b") =>
  new URL(`./assets/examples/tile/${theme}-${cut}.webp`, import.meta.url).href;

// ----------------------------------------------------------- the field

/**
 * L3's field (DESIGN 22.14): every scene once, the client's service first.
 * The two scenes the slides either side show large (L2's ad, L4's phones)
 * take their detail tile, so no picture shows twice in a row.
 */
export function serviceField(pick: ServiceExample, count = 18): string[] {
  const order = sceneOrder(pick);
  const hero = new Set([sceneAt(pick, 0), sceneAt(pick, 1)]);
  return Array.from({ length: count }, (_, i) => {
    const scene = order[i % order.length];
    return tileUrl(scene, hero.has(scene) ? "b" : "a");
  });
}

/** The next round's six: details of the scenes after the field's first six. */
export function serviceRound(pick: ServiceExample, count = 6): string[] {
  const order = sceneOrder(pick);
  return Array.from({ length: count }, (_, j) =>
    tileUrl(order[(6 + j) % order.length], "b"),
  );
}

/** O7's strip: the first six scenes, wide, the client's lead on tile 0. */
export function stripTiles(pick: ServiceExample, count = 6): string[] {
  const order = sceneOrder(pick);
  return Array.from({ length: count }, (_, i) =>
    tileUrl(order[i % order.length], "a"),
  );
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
