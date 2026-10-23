import { describe, expect, test } from "bun:test";
import {
  BP,
  BP_MINUTES,
  BP_NOTES,
  BP_STOPS,
  BP_TITLES,
} from "../src/present/blueprintContent";

/**
 * The client decks' copy rules (docs/csm-decks/CONTENT.md, pinned for the
 * CSM decks by deck-copy.test.ts) on the Brand Blueprint call's words
 * (src/present/blueprintContent.ts): every English and Arabic string, the
 * canvas and the notes. A line that may break a rule is named in ALLOWED
 * with the reason.
 */

type Leaf = { path: string; lang: "en" | "ar"; text: string; spoken: boolean };

function leaves(): Leaf[] {
  const out: Leaf[] = [];
  const walk = (
    v: unknown,
    path: string,
    lang: "en" | "ar" | null,
    spoken: boolean,
  ) => {
    if (typeof v === "string") {
      if (lang) out.push({ path, lang, text: v, spoken });
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        walk(x, `${path}[${i}]`, lang, spoken);
      });
      return;
    }
    if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        const l =
          k === "en" || k === "say"
            ? "en"
            : k === "ar" || k === "sayAr"
              ? "ar"
              : lang;
        walk(x, `${path}.${k}`, l, spoken);
      }
  };
  walk(BP, "BP", null, false);
  walk(BP_TITLES, "BP_TITLES", null, false);
  walk(BP_STOPS, "BP_STOPS", null, false);
  walk(BP_NOTES, "BP_NOTES", null, true);
  return out;
}

const ALL = leaves();
const EN = ALL.filter(l => l.lang === "en");
const AR = ALL.filter(l => l.lang === "ar");
const SLIDE_AR = AR.filter(l => !l.spoken);

/** Lines allowed to name what a rule bans, and why. */
const ALLOWED: Record<string, string[]> = {
  // The client's own approval: they see each video before it runs.
  every: ["Every video", "كل فيديو"],
  // "Everything", read back on the run sheet; never a step of ours.
  everyAr: ["اللي نحتاجه، ونراجع كل شي", "خلوني أقرا لكم كل شي مرة وحدة."],
};

const offenders = (list: Leaf[], re: RegExp, rule?: string) =>
  list
    .filter(l => re.test(l.text) && !(rule && ALLOWED[rule]?.includes(l.text)))
    .map(l => `${l.path}: ${l.text}`);

describe("the Blueprint's words are read whole", () => {
  test("both languages, the notes included", () => {
    expect(EN.length).toBeGreaterThan(120);
    expect(AR.length).toBeGreaterThan(120);
    expect(ALL.some(l => l.spoken && l.lang === "ar")).toBe(true);
    // Every slide has its title in both languages, its notes and its minutes.
    for (const id of Object.keys(BP_TITLES) as (keyof typeof BP_TITLES)[]) {
      expect(BP_TITLES[id].ar.length).toBeGreaterThan(2);
      expect(BP_NOTES[id].say.length).toBeGreaterThan(1);
      expect(BP_NOTES[id].sayAr.length).toBeGreaterThan(1);
      expect(BP_MINUTES[id]).toBeDefined();
    }
  });
});

describe("no promise of results, no leads, no ad money", () => {
  test("English, notes included", () => {
    expect(
      offenders(
        EN,
        /\bleads?\b|cost per lead|\bCPL\b|\bbudget|\bROI\b|guarant|refund|money[- ]back/i,
      ),
    ).toEqual([]);
    expect(
      offenders(
        EN,
        /[$€£]\s?\d|\b(?:KWD|SAR|AED|QAR|BHD|OMR|USD|riyals?|dinars?|dirhams?)\b/i,
      ),
    ).toEqual([]);
    expect(
      offenders(
        EN,
        /\b(?:\d+|two|three|five|ten)\s+(?:more\s+)?(?:projects?|appointments?|bookings?|enquiries|clients?|customers?)\b/i,
      ),
    ).toEqual([]);
  });
  test("Arabic", () => {
    expect(
      offenders(
        AR,
        /ليد|عملاء محتملين|تكلفة العميل|ميزانية|ريال|دينار|درهم|دولار|ضمان|نضمن|مضمون/,
      ),
    ).toEqual([]);
  });
});

describe("form", () => {
  test("no exclamation marks, no em or en dashes, plain quotes, no guillemets", () => {
    expect(offenders(ALL, /[!！]|[—–]|[“”‘’]|[«»]/)).toEqual([]);
  });
  test("titles and canvas lines in sentence case", () => {
    const PROPER =
      /^(?:Brand|Blueprint|Drive|DNA|Part|Day|I|Example|Starter|Mahara|Stories|Reels)$/;
    const bad = EN.filter(l => !l.spoken).filter(l =>
      l.text
        .replace(/\{[^}]+\}/g, "")
        .split(/(?<=[.?:])\s+|\s+·\s+/)
        .some(sentence =>
          sentence
            .split(/\s+/)
            .slice(1)
            .some(
              w =>
                /^[A-Z]/.test(w) && !PROPER.test(w.replace(/[^A-Za-z]/g, "")),
            ),
        ),
    );
    expect(bad.map(l => `${l.path}: ${l.text}`)).toEqual([]);
  });
  test("every and always only for the client's own job", () => {
    expect(offenders(EN, /\bevery\b|\balways\b/i, "every")).toEqual([]);
    expect(
      offenders(SLIDE_AR, /(?:^|[\s(،.])كل(?=\s)|دايم|دائم/, "every").filter(
        l => !ALLOWED.everyAr.some(a => l.endsWith(a)),
      ),
    ).toEqual([]);
  });
  test("roles, never the team's names", () => {
    expect(
      offenders(
        ALL,
        /\b(?:Ahmed|Ali|Daniya|Lama|Moaz|Muhammed|Mohammed|Rasem|Tahrir|Sabry|Maher|Nada|Salma|Aziz|Abdulaziz)\b|صبري|ماهر|ندى|سلمى|عزيز|محمد|أحمد/,
      ),
    ).toEqual([]);
  });
  test("our own words never call the client a contractor, nor a deposit or a site visit", () => {
    expect(
      offenders(
        EN,
        /\bcontractors?\b|\bagency\b|\bdeposits?\b|\bsite visits?\b/i,
      ),
    ).toEqual([]);
    expect(offenders(AR, /مقاول|زيار|عربون|وكالة/)).toEqual([]);
  });
});

describe("Arabic on the slides (CONTENT-AR decisions 2, 3 and 6)", () => {
  test("Arabic-Indic digits only, never ٬, never a lone ٠, never a middle dot", () => {
    expect(offenders(AR, /[0-9]/)).toEqual([]);
    expect(offenders(AR, /٬/)).toEqual([]);
    expect(offenders(AR, /(?<![٠-٩])٠(?![٠-٩])/)).toEqual([]);
    expect(offenders(AR, /·/)).toEqual([]);
  });
  test("no quote marks around Arabic words, no digit glued to بـ or لـ, no tatweel before ال (decisions 4 and 6)", () => {
    expect(offenders(AR, /["'][^"']*[\u0600-\u06FF][^"']*["']/)).toEqual([]);
    expect(offenders(AR, /(?:^|[\s،])[بل]ـ?[٠-٩]/)).toEqual([]);
    expect(offenders(AR, /[بل]ـ(?:\{|ال)/)).toEqual([]);
  });
  test("no dialect-only words on the slides (the spoken lines may use them)", () => {
    expect(
      offenders(
        SLIDE_AR,
        /(?:^|[\s،.])(?:شنو|شلون|ماكو|وايد|عيل|هني|جذي|باجر|وش|أبشر|إيش|طيب)(?=$|[\s،.؟])/,
      ),
    ).toEqual([]);
  });
  test("the shared words: Brand Blueprint call, starter ads, creative director, media team", () => {
    expect(BP.cover.dateline.ar).toStartWith("مكالمة بناء الهوية والعرض");
    expect(BP.cover.byline.ar).toBe("مع المدير الإبداعي");
    // With a name, the team, never a gendered role beside it (score round 2).
    expect(BP.cover.bylineNamed.ar).toBe("مع {name}، من فريقنا الإبداعي");
    expect(BP.parts[1].ar).toBe("إعلانات البداية");
    expect(BP.firstAds.stamp.line.ar).toContain("لفريق الإعلانات");
  });
});

describe("what is not the client's own is labelled", () => {
  test("the struck line, the callers' wording and the starter pack carry their tags", () => {
    expect(BP.tag.example).toEqual({ en: "Example", ar: "مثال" });
    expect(BP.tag.exampleWording).toEqual({
      en: "Example wording",
      ar: "صياغة للتوضيح",
    });
    // The pack is a folder of ads, so its tag is plural in Arabic too.
    expect(BP.tag.starter).toEqual({
      en: "Starter ads, from our templates",
      ar: "إعلانات البداية، من قوالبنا",
    });
  });
});

describe("the call, by the minute", () => {
  test("14 slides add up to 45 minutes; the run sheet's starts are the slides'", () => {
    const m = Object.values(BP_MINUTES);
    expect(m.length).toBe(14);
    expect(m.reduce((n, [, len]) => n + len, 0)).toBe(45);
    // Each slide starts where the one before it ends.
    let at = 0;
    for (const [start, len] of m) {
      expect(start).toBe(at);
      at += len;
    }
    const starts = new Set(m.map(([s]) => s));
    for (const row of BP.today.rows) expect(starts.has(row.at)).toBe(true);
    // Part 1 is sent by minute 10: slide 5 ends there.
    expect(BP_MINUTES["first-ads"][0] + BP_MINUTES["first-ads"][1]).toBe(10);
  });
});
