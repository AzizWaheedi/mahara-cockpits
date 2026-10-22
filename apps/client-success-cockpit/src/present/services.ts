/**
 * The five main services (CEO, 2026-10-21): the kickoff form's choices for
 * "Which service are we advertising?" (tG7dnxBn), so the service the client
 * picks on slide 4 is the CSM's answer there too. A sub-trade (kitchens,
 * bathrooms) is never the service: a client's own words are mapped to one
 * of the five and kept only as their quiet line under it. Words that fit
 * none are "Other", in the client's own words (docs/csm-decks/DESIGN.md
 * 22.14, CONTENT.md "The five main services").
 */

import { SERVICES } from "./content";

/** In the kickoff form's order. */
export const MAIN = [
  "design-build",
  "interior",
  "architecture",
  "fitout",
  "construction",
] as const;
export type MainKey = (typeof MAIN)[number];
export type ServiceKey = MainKey | "other";

export const isMain = (v: unknown): v is MainKey =>
  typeof v === "string" && (MAIN as readonly string[]).includes(v);

/** The kickoff form's own choice for each, word for word. */
export const KICKOFF_CHOICE: Record<MainKey, string> = {
  "design-build": "Design and build",
  interior: "Interior design",
  architecture: "Architectural design",
  fitout: "Fit out and renovation",
  construction: "Construction only",
};

/** No match anywhere: the example ads fall back to interior design (SERVICE-MAP). */
export const DEFAULT_SERVICE: MainKey = "interior";

// ------------------------------------------------------------- matching

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

interface Words {
  en: readonly string[];
  ar: readonly string[];
}

/**
 * A client's words to a main service, tried in this order; the first that
 * matches wins. A design-and-build or a pool is the whole project; a
 * building's shell is construction ("عظم وتشطيب"); a fit-out or a
 * renovation before an interior, so "Kitchen renovation" is a renovation;
 * an interior before an architect, so "Villa interior design" is an
 * interior; an architect before a builder, so "Building design" is a
 * design. A bare "design" is an interior, last of all. مكتب alone is left
 * out on purpose: it is how a firm's name starts (مكتب ... للتصميم), not a
 * service; مكتب هندسي (an engineering office) is architectural design. In
 * Gulf use عمارة is an apartment building (construction) unless it is
 * designed (تصميم عمارة); معماري is the architect's adjective.
 */
export const SERVICE_KEYWORDS: readonly [MainKey, Words][] = [
  [
    "design-build",
    {
      en: [
        "design and build",
        "design & build",
        "design-build",
        "design build",
        "design and construct",
        "turnkey",
        "turn-key",
        "pool",
        "swimming",
      ],
      ar: [
        "تصميم وتنفيذ",
        "تصميم و تنفيذ",
        "تصميم والتنفيذ",
        "تصميم وبناء",
        "تصميم والبناء",
        "تسليم مفتاح",
        "مسبح",
        "مسابح",
        "حوض سباحه",
        "سباحه",
      ],
    },
  ],
  // A building's shell is construction, even with its finishing beside it
  // ("عظم وتشطيب", shell and finishing), so it is read before a fit-out.
  ["construction", { en: ["shell and core", "shell & core"], ar: ["عظم"] }],
  // An engineering office (مكتب هندسي) is the licensed design and
  // supervision office in Kuwait and Saudi, as "Engineering consultancy" is
  // architectural design; read before a fit-out, whose مكاتب (offices)
  // would otherwise take "مكاتب هندسية".
  ["architecture", { en: [], ar: ["مكتب هندسي", "مكاتب هندسيه"] }],
  [
    "fitout",
    {
      en: [
        "fit-out",
        "fitout",
        "fit out",
        "renovation",
        "renovate",
        "refurbish",
        "restoration",
        "remodel",
        "finishing",
        "office",
        "commercial",
        "retail",
        "shop",
        "showroom",
        "restaurant",
        "cafe",
        "clinic",
        "flooring",
        "marble",
        "gypsum",
      ],
      ar: [
        "تشطيب",
        "تشطيبات",
        "ترميم",
        "تجديد",
        "مكاتب",
        "تجاري",
        "محلات",
        "مطعم",
        "مطاعم",
        "كافيه",
        "عياده",
        "عيادات",
        "مقهي",
        "مقاهي",
        "فت اوت",
        "فيت اوت",
        "ارضيات",
        "رخام",
        "جبس",
      ],
    },
  ],
  [
    "interior",
    {
      en: [
        "interior",
        "decor",
        "furniture",
        "furnishing",
        "kitchen",
        "cabinet",
        "joinery",
        "carpentry",
        "wardrobe",
        "closet",
        "bathroom",
        "bath",
        "washroom",
        "bedroom",
        "majlis",
        "diwan",
        "living room",
        "lighting",
        "curtain",
        "upholstery",
      ],
      ar: [
        "تصميم داخلي",
        "تصميم الداخلي",
        "تصاميم داخليه",
        "تصاميم الداخليه",
        "انتيريور",
        "انتريور",
        "ديكور",
        "اثاث",
        "مطبخ",
        "مطابخ",
        "خزائن",
        "خزاين",
        "دواليب",
        "حمام",
        "حمامات",
        "دوره مياه",
        "دورات مياه",
        "غرفه نوم",
        "غرف نوم",
        "مجلس",
        "مجالس",
        "ديوانيه",
        "صاله",
        "اناره",
        "ستائر",
        "نجاره",
      ],
    },
  ],
  [
    "architecture",
    {
      en: [
        "architect",
        "facade",
        "façade",
        "exterior",
        "elevation",
        "landscape",
        "landscaping",
        "garden",
        "hardscape",
        "softscape",
        "pergola",
        "outdoor",
        "master plan",
        "masterplan",
        "villa design",
        "house design",
        "home design",
        "building design",
        "drawings",
        "permit",
        "consultant",
        "consultancy",
      ],
      ar: [
        "معماري",
        "معماريه",
        "واجهه",
        "واجهات",
        "حديقه",
        "حدائق",
        "لاندسكيب",
        "تنسيق حدائق",
        "مخططات",
        "تراخيص",
        "استشارات",
        "استشاري",
        "تصميم فلل",
        "تصميم الفلل",
        "تصميم مباني",
        "تصميم المباني",
        "تصميم فيلا",
        "تصميم الفيلا",
        "تصميم بيوت",
        "تصميم البيوت",
        "تصميم بيت",
        "تصميم منازل",
        "تصميم المنازل",
        "تصميم عماره",
        "تصميم عمارات",
      ],
    },
  ],
  [
    "construction",
    {
      en: [
        "construction",
        "construct",
        "contracting",
        "contractor",
        "build",
        "building",
        "builder",
        "structure",
        "structural",
        "civil",
        "concrete",
        "engineering",
      ],
      ar: [
        "مقاولات",
        "مقاول",
        "بناء",
        "انشاء",
        "انشاءات",
        "تشييد",
        "تنفيذ",
        "عماره",
        "عمارات",
        "هيكل",
        "خرسان",
        "هندسي",
        "هندسيه",
      ],
    },
  ],
  // Last: a bare design is an interior ("Design studio", تصميم).
  ["interior", { en: ["design", "studio"], ar: ["تصميم", "تصاميم", "ديزاين"] }],
];

/** The kickoff's own choices and the decks' names, read whole. */
const EXACT: [string, MainKey][] = [
  ...MAIN.map(k => [normalise(KICKOFF_CHOICE[k]), k] as [string, MainKey]),
  ["design and build", "design-build"],
  ["fit-out and renovation", "fitout"],
  ["construction", "construction"],
  ["تصميم وتنفيذ", "design-build"],
  ["تصميم داخلي", "interior"],
  ["تصميم معماري", "architecture"],
  ["تشطيب وترميم", "fitout"],
  ["بناء وانشاءات", "construction"],
  ["التصميم والتنفيذ", "design-build"],
  ["التصميم الداخلي", "interior"],
  ["التصميم المعماري", "architecture"],
  ["التشطيب والترميم", "fitout"],
  ["البناء والانشاءات", "construction"],
];

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
function has(text: string, words: Words) {
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

/** One text's main service, or null when it fits none ("Other"). */
export function serviceOfText(text: string | null | undefined): MainKey | null {
  if (!text?.trim()) return null;
  const s = normalise(text);
  for (const [exact, key] of EXACT) if (s === exact) return key;
  for (const [key, words] of SERVICE_KEYWORDS) if (has(s, words)) return key;
  return null;
}

/**
 * A sub-trade's words (a kitchen, a bathroom, wardrobes): a room inside an
 * interior or a fit-out, never the service an enquiry is about (CEO,
 * 2026-10-21: "These are not kitchens").
 */
const SUB_TRADE: Words = {
  en: [
    "kitchen",
    "bathroom",
    "bath",
    "washroom",
    "wardrobe",
    "closet",
    "cabinet",
  ],
  ar: [
    "مطبخ",
    "مطابخ",
    "حمام",
    "حمامات",
    "دوره مياه",
    "دورات مياه",
    "خزائن",
    "خزاين",
    "دواليب",
  ],
};

/** Whether a client's words name a sub-trade ("Kitchens and wardrobes", المطابخ). */
export const isSubTrade = (text: string | null | undefined) =>
  Boolean(text?.trim()) && has(normalise(text ?? ""), SUB_TRADE);

const ARABIC_RE = /[؀-ۿ]/;

/**
 * The call queue's rows (L2 stop 3, DESIGN 22.14): the launch service's
 * name first, then the client's own words for that same service, in the
 * deck's script only (a name in the other script inside a row breaks its
 * reading order). Never a sub-trade and never another service's words, so
 * an interior design campaign's queue never reads "Kitchens and wardrobes"
 * or "Full villa fit-out". "Other" keeps the words that fit none of the
 * five; with no service known, every word but a sub-trade.
 */
export function queueServices(
  name: string | null | undefined,
  key: ServiceKey | null,
  words: readonly string[],
  lang: "en" | "ar",
): string[] {
  const fits = (w: string) => {
    if (isSubTrade(w)) return false;
    if (!key) return true;
    const k = serviceOfText(w);
    return key === "other" ? k === null : k === key;
  };
  const out: string[] = name ? [name] : [];
  for (const raw of words) {
    const w = raw.trim();
    if (!w || isOtherWord(w) || out.some(x => sameWords(x, w))) continue;
    if (fits(w)) out.push(w);
  }
  return out.filter(s => ARABIC_RE.test(s) === (lang === "ar"));
}

/** The kickoff's "Other" with nothing typed beside it. */
export const isOtherWord = (text: string | null | undefined) =>
  // normalise() has turned ى into ي and أ into ا, so the Arabic is written
  // as it reads after it (اخري), never as typed (أخرى).
  /^(other|others|غير ذلك|غيرها|اخري|خدمه اخري)$/i.test(normalise(text ?? ""));

/** Two names for the same thing, ignoring case, spaces and Arabic spelling. */
export const sameWords = (
  a: string | null | undefined,
  b: string | null | undefined,
) => Boolean(a && b && normalise(a) === normalise(b));

// ------------------------------------------------------- the client's pick

/** Where a client's service was read from, in the order a deck asks. */
export interface ServiceSource {
  from: ServicePick["from"];
  /** The text as saved (prep's service_focus, the kickoff's answer, a form's line). */
  text: string | null | undefined;
  /** Its Arabic twin, when prep has one. */
  ar?: string | null;
  /**
   * A choice someone made (prep, the kickoff): taken as it is, "Other"
   * included. A form's free text counts only when it fits a main service.
   */
  explicit: boolean;
}

export interface ServicePick {
  /** null: nothing on file names a service yet. */
  key: ServiceKey | null;
  /** For "Other": the client's own words, as typed. */
  words: { en: string | null; ar: string | null };
  from: "chosen" | "prep" | "kickoff" | "form" | "none";
  /** The text it was read from (prep's line names it). */
  text: string | null;
}

const ARABIC = /[؀-ۿ]/;
const clean = (v: string | null | undefined) => {
  const s = v?.trim();
  return s && !isOtherWord(s) ? s : null;
};
/** Their words split by script: the Arabic deck never names a Latin one. */
const wordsOf = (text: string | null, ar: string | null | undefined) => {
  const a = clean(ar) ?? (text && ARABIC.test(text) ? text : null);
  return { en: text, ar: a };
};

export const NO_SERVICE: ServicePick = {
  key: null,
  words: { en: null, ar: null },
  from: "none",
  text: null,
};

/**
 * The client's service from the first source that names one (DESIGN 22.14):
 * a choice is taken as it is; a form's line only when it fits one of the
 * five, so "Kitchens" lands on interior design and words that fit none
 * wait until nothing fits, then read "Other" in the client's own words.
 */
export function resolveService(sources: ServiceSource[]): ServicePick {
  let other: ServicePick | null = null;
  for (const s of sources) {
    const text = s.text?.trim() || null;
    const ar = s.ar?.trim() || null;
    if (!text && !ar) continue;
    const key = serviceOfText(text) ?? serviceOfText(ar);
    if (key) return { key, words: { en: null, ar: null }, from: s.from, text };
    const pick: ServicePick = {
      key: "other",
      words: wordsOf(clean(text), ar),
      from: s.from,
      text: text ?? ar,
    };
    if (s.explicit) return pick;
    other ??= pick;
  }
  return other ?? NO_SERVICE;
}

/** A line's first letter lowered when it is the only capital ("Swimming pools"). */
const midCase = (s: string) =>
  /^[A-Z][^A-Z]*$/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;

/**
 * How a deck names the pick: `name` as a label, `mid` inside a sentence.
 * "Other" is the client's own words; with none, nothing is named.
 */
export function serviceNames(p: ServicePick): {
  name: { en: string | null; ar: string | null };
  mid: { en: string | null; ar: string | null };
} {
  if (p.key && p.key !== "other")
    return {
      name: { ...SERVICES[p.key].name },
      mid: { ...SERVICES[p.key].mid },
    };
  const en = p.words.en ?? p.words.ar;
  const ar = p.words.ar ?? p.words.en;
  return {
    name: { en, ar },
    mid: { en: en ? midCase(en) : null, ar },
  };
}

/** One of slide 4's rows: a main service, or "Other", with the client's own words under it. */
export interface ServiceRow {
  key: ServiceKey;
  /** The client's own words this row holds, as they wrote them (never our label again). */
  own: string[];
}

/**
 * Slide 4's choice (DESIGN 22.14): the five main services in the kickoff's
 * order, each with the client's own words that map to it, and "Other" only
 * when some of their words fit none, or the pick itself is "Other".
 */
export function serviceRows(
  services: string[],
  pick: ServicePick,
): ServiceRow[] {
  const own = new Map<ServiceKey, string[]>();
  const add = (k: ServiceKey, s: string) => {
    const list = own.get(k) ?? [];
    if (!list.some(x => sameWords(x, s))) list.push(s);
    own.set(k, list);
  };
  for (const raw of services) {
    const s = raw.trim();
    if (!s || isOtherWord(s)) continue;
    const k = serviceOfText(s);
    if (!k) {
      add("other", s);
      continue;
    }
    const label =
      sameWords(s, SERVICES[k].name.en) ||
      sameWords(s, SERVICES[k].name.ar) ||
      sameWords(s, KICKOFF_CHOICE[k]);
    if (!label) add(k, s);
  }
  if (pick.key === "other") {
    const w = pick.words.en ?? pick.words.ar;
    if (w) add("other", w);
  }
  const rows: ServiceRow[] = MAIN.map(k => ({ key: k, own: own.get(k) ?? [] }));
  if (own.has("other") || pick.key === "other")
    rows.push({ key: "other", own: own.get("other") ?? [] });
  return rows;
}
