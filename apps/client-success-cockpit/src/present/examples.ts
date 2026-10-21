import { type Cta, EXAMPLE, type Lang, t, tf } from "./content";
import type { Creative } from "./creative";

/**
 * The example ads (docs/csm-decks/DESIGN.md 22.4): twelve scenes from
 * Mahara's own Higgsfield run, no client's work, no people, no text, each
 * labelled "Example ad" wherever it shows. One theme per client, matched to
 * their service in English or Arabic; the CSM can switch it in prep
 * (`example_theme`). The pictures are URLs only: the bundle carries a table
 * of addresses, the bytes load after the first paint.
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
] as const;
export type Theme = (typeof THEMES)[number];

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

// ------------------------------------------------------- the service map

/**
 * Lower case; Arabic without its diacritics and tatweel, أ إ آ read as ا,
 * ة as ه, ى as ي (DESIGN 22.4.2).
 */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

/** The families, tried in this order; the first that matches wins (DESIGN 22.4.2). */
export const EXAMPLE_KEYWORDS: readonly [
  Theme,
  { en: readonly string[]; ar: readonly string[] },
][] = [
  ["kitchen", { en: ["kitchen", "cabinet"], ar: ["مطبخ", "مطابخ"] }],
  // The pool before the bathroom: "حمام سباحة" (the usual Gulf word for a
  // pool) would otherwise match حمام and land on a bathroom.
  [
    "pool",
    {
      en: ["pool", "swimming"],
      ar: ["مسبح", "مسابح", "حوض سباحه", "سباحه"],
    },
  ],
  [
    "bathroom",
    {
      en: ["bathroom", "bath", "washroom", "toilet", "wet area"],
      ar: ["حمام", "حمامات", "دوره مياه", "دورات مياه"],
    },
  ],
  [
    "landscape",
    {
      en: [
        "landscape",
        "landscaping",
        "garden",
        "outdoor",
        "hardscape",
        "softscape",
        "pergola",
      ],
      ar: ["حديقه", "حدائق", "لاندسكيب", "تنسيق حدائق"],
    },
  ],
  [
    "majlis",
    {
      en: ["majlis", "diwan", "diwaniya", "diwaniyah"],
      ar: ["مجلس", "مجالس", "ديوانيه"],
    },
  ],
  [
    "bedroom",
    {
      en: ["bedroom", "master suite", "wardrobe"],
      ar: ["غرفه نوم", "غرف نوم", "غرف النوم"],
    },
  ],
  [
    "stairs",
    {
      en: [
        "stair",
        "staircase",
        "entrance",
        "lobby",
        "foyer",
        "marble",
        "flooring",
      ],
      ar: ["درج", "سلالم", "مدخل", "مداخل", "رخام", "ارضيات"],
    },
  ],
  [
    "villa",
    {
      en: ["villa", "residential", "palace"],
      ar: ["فيلا", "فلل", "قصر", "قصور", "سكني"],
    },
  ],
  [
    "office",
    {
      en: [
        "office",
        "commercial",
        "retail",
        "shop",
        "showroom",
        "restaurant",
        "cafe",
        "clinic",
        "fit-out",
        "fitout",
        "fit out",
      ],
      ar: [
        "مكتب",
        "مكاتب",
        "تجاري",
        "محل",
        "محلات",
        "مطعم",
        "مطاعم",
        "كافيه",
        "عياده",
        "تشطيب",
        "تشطيبات",
      ],
    },
  ],
  [
    "facade",
    {
      en: [
        "facade",
        "façade",
        "exterior",
        "cladding",
        "renovation",
        "refurbishment",
        "restoration",
        "architecture",
        "architectural",
      ],
      ar: ["واجهه", "واجهات", "ترميم", "تجديد", "معماري"],
    },
  ],
  [
    "construction",
    {
      en: [
        "construction",
        "contracting",
        "build",
        "building",
        "structure",
        "structural",
        "engineering",
        "concrete",
      ],
      ar: [
        "مقاولات",
        "بناء",
        "انشاء",
        "انشاءات",
        "عظم",
        "هندسي",
        "هندسيه",
        "خرسان",
      ],
    },
  ],
  [
    "living",
    {
      en: [
        "interior",
        "design",
        "decor",
        "furniture",
        "furnishing",
        "living",
        "lighting",
      ],
      ar: ["تصميم داخلي", "ديكور", "اثاث", "تصميم", "صاله", "معيشه"],
    },
  ],
];

const FIT_OUT = {
  en: ["fit-out", "fitout", "fit out"],
  ar: ["تشطيب", "تشطيبات"],
};
/** An interior word: with a home word, it is a home's interior (living). */
const INTERIOR = {
  en: ["interior", "interiors", "decor"],
  ar: ["تصميم داخلي", "ديكور"],
};
const HOME = {
  en: ["villa", "home", "house", "residential", "apartment"],
  ar: ["فيلا", "فلل", "بيت", "منزل", "شقه", "شقق", "سكني"],
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
/** An English word at a word's start ("kitchens", "fit-outs" match). */
const enWord = (k: string) =>
  new RegExp(`(?:^|[^a-z0-9\\u00c0-\\u024f])${escapeRe(k)}`);
/** An Arabic word at a word's start, after its usual prefixes (و، ب، ال، لل). */
const arWord = (k: string) =>
  new RegExp(
    `(?:^|[^\\u0621-\\u064a])(?:وال|بال|فال|كال|لل|ال|و|ب|ف|ك|ل)?${escapeRe(k)}`,
  );

const cache = new Map<string, RegExp>();
function has(
  text: string,
  words: { en: readonly string[]; ar: readonly string[] },
) {
  for (const k of words.en) {
    const key = `en:${k}`;
    const re = cache.get(key) ?? enWord(k);
    cache.set(key, re);
    if (re.test(text)) return true;
  }
  for (const k of words.ar) {
    const key = `ar:${k}`;
    const re = cache.get(key) ?? arWord(k);
    cache.set(key, re);
    if (re.test(text)) return true;
  }
  return false;
}

/**
 * One text's theme, or null: a fit-out of a home is an interior (living);
 * otherwise the families in order.
 */
export function themeOfText(text: string | null | undefined): Theme | null {
  if (!text?.trim()) return null;
  const s = normalise(text);
  // A fit-out or an interior of a home is an interior: the villa theme is
  // the house from outside.
  if ((has(s, FIT_OUT) || has(s, INTERIOR)) && has(s, HOME)) return "living";
  for (const [theme, words] of EXAMPLE_KEYWORDS)
    if (has(s, words)) return theme;
  return null;
}

export interface ExamplePick {
  theme: Theme;
  /** Where it came from: the CSM's switch, a text that matched, or the default. */
  from: "prep" | "text" | "default";
  /** The text that matched (prep's line names it). */
  text: string | null;
}

/**
 * The client's theme from the first source that matches (DESIGN 22.4.2):
 * prep's switch, then the given texts in order (the service focus and its
 * Arabic, the kickoff's service, the form's #1, the form's services, the
 * client's name). No match anywhere: living.
 */
export function pickExample(
  chosen: unknown,
  texts: (string | null | undefined)[],
): ExamplePick {
  if (isTheme(chosen)) return { theme: chosen, from: "prep", text: null };
  for (const text of texts) {
    const theme = themeOfText(text);
    if (theme) return { theme, from: "text", text: text?.trim() ?? null };
  }
  return { theme: "living", from: "default", text: null };
}

// ----------------------------------------------------------- the field

/** L3's field: tile i shows the theme s + i, a wide shot for the first twelve, a detail after. */
export function fieldTiles(theme: Theme, count = 18): string[] {
  const s = THEMES.indexOf(theme);
  return Array.from({ length: count }, (_, i) =>
    tileUrl(THEMES[(s + i) % 12], i < 12 ? "a" : "b"),
  );
}

/** The next round's six: details of the themes after the field's first six. */
export function roundTiles(theme: Theme, count = 6): string[] {
  const s = THEMES.indexOf(theme);
  return Array.from({ length: count }, (_, j) =>
    tileUrl(THEMES[(s + 6 + j) % 12], "b"),
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
