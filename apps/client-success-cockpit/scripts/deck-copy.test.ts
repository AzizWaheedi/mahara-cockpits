import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import * as content from "../src/present/content";

/**
 * The copy rules in docs/csm-decks/CONTENT.md, pinned: every English and
 * Arabic string the decks carry (the canvas, the notes, the chrome) is read
 * from content.ts and checked. The launch deck's strings join the same file
 * and the same checks. A line that breaks a rule on purpose (a note telling
 * the CSM what not to say) is named in ALLOWED with the rule it may break.
 */

type Leaf = { path: string; lang: "en" | "ar"; text: string; spoken: boolean };

/** Every string in content.ts, with its language and whether it is said aloud. */
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
      for (const [i, x] of v.entries()) walk(x, `${path}[${i}]`, lang, spoken);
      return;
    }
    if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        const l =
          k === "en" || k === "say" || k === "dwy"
            ? "en"
            : k === "ar" || k === "sayAr"
              ? "ar"
              : lang;
        walk(
          x,
          `${path}.${k}`,
          l,
          spoken || k === "say" || k === "sayAr" || k === "dwy",
        );
      }
  };
  for (const [name, value] of Object.entries(content))
    if (typeof value !== "function") walk(value, name, null, false);
  return out;
}

const ALL = leaves();
const EN = ALL.filter(l => l.lang === "en");
const AR = ALL.filter(l => l.lang === "ar");

/** Lines allowed to name what a rule bans, because they tell the CSM not to. */
const ALLOWED: Record<string, string[]> = {
  guarantee: ["Don't link this list to the contract or to any guarantee."],
  // "The same day" is allowed for the client's own job, never for ours
  // (CONTENT copy rule 1); "Calling for" names the call card, not a chip on
  // a new enquiry.
  speed: [
    "Mark every meeting, the same day",
    "Did they come? Did you quote? Did you win? A few taps, the same day.",
    "Move each meeting to the right stage in the CRM the same day: didn't show, showed, quote sent, closed.",
    "Your team moves it to the right stage in the CRM, the same day.",
    "Calling for {name}",
    "سجلوا نتيجة كل موعد، بنفس اليوم",
    "حضر؟ عطيتوه عرض سعر؟ وقّع معكم؟ كم ضغطة، بنفس اليوم.",
    "انقلوا كل موعد للمرحلة الصح في الـCRM بنفس اليوم: ما حضر، حضر، انرسل عرض السعر، وقّع.",
    "فريقكم ينقله للمرحلة الصح في الـCRM، بنفس اليوم.",
  ],
  // "Always …" heads the client's own DO items on their red-lines panel.
  always: ["دايماً …"],
};

function offenders(list: Leaf[], re: RegExp, rule?: string) {
  return list
    .filter(l => re.test(l.text) && !(rule && ALLOWED[rule]?.includes(l.text)))
    .map(l => `${l.path}: ${l.text}`);
}

describe("content.ts is read whole", () => {
  test("both languages, the notes included", () => {
    expect(EN.length).toBeGreaterThan(80);
    expect(AR.length).toBeGreaterThan(80);
    expect(ALL.some(l => l.spoken && l.lang === "ar")).toBe(true);
  });
});

describe("rule 1: no speed promise", () => {
  test("English", () => {
    expect(
      offenders(
        EN,
        /\b5 minutes\b|five minutes|within (?:a few |five |5 )?minutes|\binstantly\b|\bsame[- ]day\b|\bjust now\b|\bCalling\b|21\s?[x×]|100\s?[x×]/i,
        "speed",
      ),
    ).toEqual([]);
  });
  test("Arabic", () => {
    expect(
      offenders(
        AR,
        /خمس دقايق|خمس دقائق|٥ دقايق|٥ دقائق|فوراً|فورا|بنفس اليوم/,
        "speed",
      ),
    ).toEqual([]);
  });
});

describe("rule 2: no results promise, no guarantee", () => {
  test("English", () => {
    expect(
      offenders(EN, /\bROI\b|fill your calendar|\b\d+\s?[x×]\b|multipl/i),
    ).toEqual([]);
    expect(offenders(EN, /guarant|refund|money[- ]back/i, "guarantee")).toEqual(
      [],
    );
  });
  test("Arabic", () => {
    expect(offenders(AR, /ضمان|نضمن|مضمون|استرجاع|استرداد/)).toEqual([]);
  });
});

describe("rule 3: no leads, no cost per lead, no budgets in money", () => {
  test("English, notes included", () => {
    expect(offenders(EN, /\bleads?\b|cost per lead|\bCPL\b|\bbudget/i)).toEqual(
      [],
    );
    expect(
      offenders(
        EN,
        /[$€£]\s?\d|\b(?:KWD|SAR|AED|QAR|BHD|USD|riyals?|dinars?|dirhams?)\b/i,
      ),
    ).toEqual([]);
  });
  test("Arabic", () => {
    expect(
      offenders(
        AR,
        /ليد|عملاء محتملين|تكلفة العميل|ميزانية|ريال|دينار|درهم|دولار/,
      ),
    ).toEqual([]);
  });
});

describe("rules 4 and 5: no every or always for our steps, no weekly", () => {
  test("every and always only for the client's own job and the check-in rhythm", () => {
    // Allowed: the client's own jobs, the check-in rhythm, the honest "not
    // every enquiry books", the head of their own DO items, and a note on
    // why each extra form question costs.
    const fine =
      /mark every meeting|every two weeks|every stage true|every fact, price and claim|every try|not every enquiry books|^Always …$|every extra question/i;
    expect(
      EN.filter(
        l => /\bevery\b|\balways\b/i.test(l.text) && !fine.test(l.text),
      ).map(l => `${l.path}: ${l.text}`),
    ).toEqual([]);
    expect(
      offenders(EN, /\bweekly\b|seven days a week|7 days a week/i),
    ).toEqual([]);
    expect(
      offenders(
        AR,
        /أسبوعي(?!ن)|كل أسبوع(?!ين)|سبعة أيام|٧ أيام بالأسبوع|دايماً|دائماً/,
        "always",
      ),
    ).toEqual([]);
  });
});

describe("rule 7: words", () => {
  test("English", () => {
    expect(
      offenders(
        EN,
        /\bsite visits?\b|\bcontractors?\b|\bagency\b|\bB2B\b|\bpatients?\b|\bdeposits?\b|\bSlack\b|\bpods?\b/i,
      ),
    ).toEqual([]);
    // Facebook only inside "Facebook Page" and "Facebook feed".
    expect(offenders(EN, /Facebook(?! (?:Page|feed))/)).toEqual([]);
  });
  test("Arabic: never مقاول, ليد or زيارة, and the test is never a trial period", () => {
    expect(offenders(AR, /مقاول|زيارة|فترة التجربة|وكالة|سلاك|عربون/)).toEqual(
      [],
    );
    expect(
      offenders(AR, /فيسبوك/).filter(
        l => !/صفحة|صفحتكم|فيد فيسبوك|^.*: فيسبوك$/.test(l),
      ),
    ).toEqual([]);
  });
});

describe("rule 9: form", () => {
  test("no exclamation marks, no em or en dashes, plain quotes, no guillemets", () => {
    expect(offenders(ALL, /[!！]|[—–]|[“”‘’]|[«»]/)).toEqual([]);
  });
  test("titles in sentence case", () => {
    const PROPER =
      /^(?:Meta|Mahara|OS|WhatsApp|Instagram|Facebook|Brand|Blueprint|Google|Calendar|CRM|Academy|Drive|Page|LeadConnector|Saudi|UAE|Saturday|Thursday|Stories|Reels|EN|F|L|O|N|Esc|I)$/;
    const titles = ALL.filter(
      l =>
        l.lang === "en" &&
        /\.(?:title|name|first|bandHead|starterTitle|adsName|testName)\.en$/.test(
          l.path,
        ),
    );
    expect(titles.length).toBeGreaterThan(10);
    // Each sentence starts with a capital; nothing else does but names.
    const bad = titles.filter(l =>
      l.text
        .replace(/\{[^}]+\}/g, "")
        .split(/(?<=[.?:])\s+/)
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
});

describe("Arabic numbers and register (CONTENT-AR decisions 2, 3 and 6)", () => {
  test("Arabic-Indic digits only, never ٬, never a lone ٠", () => {
    expect(offenders(AR, /[0-9]/)).toEqual([]);
    expect(offenders(AR, /٬/)).toEqual([]);
    expect(offenders(AR, /(?<![٠-٩])٠(?![٠-٩])/)).toEqual([]);
  });
  test("no dialect-only words on the slides (spoken lines may use them)", () => {
    const slides = AR.filter(l => !l.spoken);
    expect(
      offenders(
        slides,
        /(?:^|[\s،.])(?:شنو|شلون|ماكو|وايد|عيل|هني|جذي|باجر|وش|أبشر|إيش)(?=$|[\s،.؟])/,
      ),
    ).toEqual([]);
    expect(offenders(AR, /طيب/)).toEqual([]);
  });
});

describe("rule 11: no other client's material", () => {
  const root = resolve(import.meta.dir, "..", "src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap(f => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : [p];
    });
  const scanned = [
    ...files(join(root, "present")),
    ...files(join(root, "dev", "deck")),
  ];
  const BANNED = [
    "jr-form-1",
    "jr-form-2",
    "jr-form-3",
    "jr-thanks-phone",
    "jr-landing",
    "jr-confirm",
    "jr-booked",
    "jr-slack",
    "ads-account",
    "ads-twenty-on",
    "ads-twenty-off",
    "interior-majlis",
    "portal-results",
    "portal-ads",
    "portal-leads",
    "ti2alygqn0",
    "callcenter.maharamedia.com",
  ];

  test("the deck's files name none of the banned pictures", () => {
    expect(scanned.length).toBeGreaterThan(10);
    const hits: string[] = [];
    for (const f of scanned) {
      const name = f.slice(root.length + 1);
      for (const b of BANNED)
        if (name.includes(b)) hits.push(`${name} is ${b}`);
      if (/\bcc-[a-z0-9-]+\.(?:webp|png|jpe?g)/.test(name))
        hits.push(`${name} is a cc- picture`);
      if (
        /\.(?:png|jpe?g|webp|svg|mp4|tsx?|css)$/.test(f) &&
        !/\.(?:png|jpe?g|webp|mp4)$/.test(f)
      ) {
        const text = readFileSync(f, "utf8");
        for (const b of BANNED)
          if (text.includes(b)) hits.push(`${name} names ${b}`);
        if (/\bcc-[a-z0-9-]+\.(?:webp|png|jpe?g)|proof\/cc-/.test(text))
          hits.push(`${name} names a cc- picture`);
        if (
          /sales-cockpit\/src\/deck\/assets\/proof|from "\.\.\/\.\.\/\.\.\/sales-cockpit/.test(
            text,
          )
        )
          hits.push(`${name} reaches into the sales deck's proof`);
      }
    }
    expect(hits).toEqual([]);
  });
});
