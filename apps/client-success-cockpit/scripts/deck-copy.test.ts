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

const ARABIC = /[\u0600-\u06FF]/;

/**
 * Every string in content.ts, with its language and whether it is said
 * aloud. Only the notes (O_NOTES, L_NOTES) are spoken: their say, sayAr and
 * done-with-you lines. A notes `dwy` list mixes English and "(Arabic) …"
 * lines, so its strings are read by script. A `dwy` pair on a slide (a
 * journey row, a stop's line) is canvas text in both languages.
 */
function leaves(): Leaf[] {
  const out: Leaf[] = [];
  const walk = (
    v: unknown,
    path: string,
    lang: "en" | "ar" | "script" | null,
    spoken: boolean,
    notes: boolean,
  ) => {
    if (typeof v === "string") {
      const l = lang === "script" ? (ARABIC.test(v) ? "ar" : "en") : lang;
      if (l) out.push({ path, lang: l, text: v, spoken });
      return;
    }
    if (Array.isArray(v)) {
      for (const [i, x] of v.entries())
        walk(x, `${path}[${i}]`, lang, spoken, notes);
      return;
    }
    if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        const said = notes && (k === "say" || k === "sayAr" || k === "dwy");
        const l =
          k === "en" || (notes && k === "say")
            ? "en"
            : k === "ar" || (notes && k === "sayAr")
              ? "ar"
              : notes && k === "dwy"
                ? "script"
                : lang;
        walk(x, `${path}.${k}`, l, spoken || said, notes);
      }
  };
  for (const [name, value] of Object.entries(content))
    if (typeof value !== "function")
      walk(value, name, null, false, name === "O_NOTES" || name === "L_NOTES");
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
  // "Call as soon as it arrives" is the client's own team's job (done with you).
  soon: [
    "A new-enquiry alert reaches your callers' phones and your WhatsApp group. Call as soon as it arrives. Up to 4 tries over 3 working days.",
  ],
  // Arabic كل, read one by one: never for a step of ours. These say "all
  // the slides", "everything", "not every enquiry", the client's own jobs
  // and approvals, the check-in rhythm, what Meta does, and the notes' own
  // asides. A new كل line fails until it is read and added here.
  everyAr: [
    "كل الشرائح",
    "→ ← تنقل · F ملء الشاشة · L اللغة · O كل الشرائح · N الملاحظات · Esc يقفل القائمة",
    "كل شي بيشوفه عملاؤكم، تشوفونه قبلهم.",
    "كل شي يشوفه عملاؤكم، واللي يصير بعدها.",
    "مو كل استفسار ينحجز له موعد. فيه ناس ما نقدر نوصل لهم، وفيه ناس ما يناسبونكم. وفريق الاتصال يكتب السبب، ونمر عليه معكم بمكالمات المتابعة.",
    "معاينات. ميتا تضبط كل إعلان على الشاشة اللي يطلع فيها.",
    "معاينات لإعلانات البداية، من قوالبنا. ميتا تضبط كل إعلان على الشاشة اللي يطلع فيها.",
    "وهذي ما نتعداها أبد. وأنتم توافقون على كل معلومة، وكل سعر، وكل وعد نقوله عنكم. وأي شي غلط أو ما يشبه هويتكم، نصلحه.",
    "المفتوح: كل شي ثاني نختبره",
    "أهم شغلة عليكم: سجلوا نتيجة كل موعد",
    "أهم شغلة عليكم: كل مرحلة تكون صحيحة",
    "انقلوا كل موعد للمرحلة الصح في الـCRM بنفس اليوم: ما حضر، حضر، انرسل عرض السعر، وقّع.",
    "سجلوا نتيجة كل موعد، بنفس اليوم",
    "اتصلوا بسرعة، وسجلوا كل محاولة، وخلوا كل مرحلة صحيحة",
    "وبعدها كل أسبوعين",
    "(If they want more questions) كل سؤال زيادة يطيّر معه ناس زينين بعد. نضيف سؤال لما الاستفسارات توضح إننا نحتاجه.",
    "(What lands with them) كل اللي عرفه فريق الاتصال يوصلكم، فتدخلون الموعد وأنتم عارفين المشروع.",
    "والبوابة تقدر تذكركم بعد كل موعد عشان تسجلون نتيجته.",
    "مكالمات المتابعة: لابتوب ومكان هادي، مو وأنتم بالسيارة. واللي بعدها نحجزها بآخر كل مكالمة.",
    "نبدي بخدمة وحدة، عشان كل إعلان وكل سؤال وكل مكالمة تكلم نوع واحد من العملاء.",
    "من ٢٠ إلى ٣٠ دقيقة. نمر معكم على كل شي بينزل.",
    "كل مكالمة نحجزها بآخر المكالمة اللي قبلها.",
    "كل واحد بالقروب يكلمكم عن شي واحد. وأنا نقطة تواصلكم معنا، لأي شي ثاني.",
    "ومع كل خطوة تخلص، يوصلكم الجزء اللي بعدها من هالطريق بقروب الواتساب.",
    "كل ما رفعتوا محتوى أكثر قبل مكالمة بناء الهوية، طلعت أول إعلاناتكم أحسن.",
  ],
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
    expect(
      offenders(
        EN,
        /right away|immediately|\bin (?:a few |\d+ )?minutes|within (?:the|an|one|\d+) hours?|\bas soon as\b|\bstraight away\b/i,
        "soon",
      ),
    ).toEqual([]);
  });
  test("Arabic", () => {
    expect(
      offenders(
        AR,
        /خمس دقايق|خمس دقائق|[٥0-9]+ دقايق|[٥0-9]+ دقائق|خلال دقا(?:ئ|ي)ق|فوراً|فورا|نفس اليوم|على طول|سيده|بأسرع وقت/,
        "speed",
      ),
    ).toEqual([]);
  });
});

describe("rule 2: no results promise, no guarantee", () => {
  test("English", () => {
    expect(
      offenders(
        EN,
        /\bROI\b|fill your calendar|\b\d+\s?[x×]\b|multipl|\bdoubl|\btripl/i,
      ),
    ).toEqual([]);
    // No count of projects, appointments, bookings or enquiries.
    expect(
      offenders(
        EN,
        /\b(?:\d+|two|three|four|five|ten|twenty|thirty|fifty|a hundred)\s+(?:more\s+)?(?:projects?|appointments?|bookings?|meetings?|enquiries|clients?|customers?)\b(?! (?:on|in) (?:this|the) call)/i,
      ),
    ).toEqual([]);
    expect(offenders(EN, /guarant|refund|money[- ]back/i, "guarantee")).toEqual(
      [],
    );
  });
  test("Arabic", () => {
    expect(
      offenders(AR, /ضمان|نضمن|مضمون|استرجاع|استرداد|ضعف|نضاعف|يضاعف/),
    ).toEqual([]);
    expect(
      offenders(
        AR,
        /[٠-٩0-9]+\s+(?:مشاريع|مشروع|مواعيد|موعد|حجوزات|حجز|استفسارات|استفسار|عملاء|عميل)/,
      ),
    ).toEqual([]);
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
        /أسبوعي(?!ن)|كل أسبوع(?!ين)|سبعة أيام|٧ أيام بالأسبوع|دايم|دائم/,
        "always",
      ),
    ).toEqual([]);
    // Arabic كل, line by line (ALLOWED.everyAr says why each is fine).
    expect(offenders(AR, /(?:^|[\s(،.])كل(?=\s)/, "everyAr")).toEqual([]);
  });
  test("rule 5: check-ins every two weeks, never weekly", () => {
    expect(
      offenders(
        ALL,
        /once a week|all week|every week|مرة ب?الأسبوع|طول الأسبوع/i,
      ),
    ).toEqual([]);
  });
});

describe("rule 6: a no-show is ours, someone deciding is theirs", () => {
  test("the journey's fork, in both languages", () => {
    const fork = content.LAUNCH.journey.fork;
    expect(fork.noShowLine.en).toMatch(/^Ours\b/);
    expect(fork.noShowLine.ar).toMatch(/^علينا/);
    expect(fork.decidingLine.en).toMatch(/^Yours\b/);
    expect(fork.decidingLine.ar).toMatch(/^عليكم/);
    // Never the other way round, anywhere.
    expect(
      offenders(EN, /Didn't come\? Yours|thinking it over\? Ours/i),
    ).toEqual([]);
  });
});

describe("rule 8: roles, not names", () => {
  // The team's first names (the cockpit's seats, read 2026-10-19, and the
  // roles named in CLAUDE.md's memory). None may appear in the copy.
  const STAFF =
    /\b(?:Ahmed|Ali|Daniya|Lama|Moaz|Muhammed|Mohammed|Mohamed|Rasem|Tahrir|Tahreer|Sabry|Sabri|Maher|Nada|Salma|Aziz|Abdulaziz)\b|صبري|ماهر|ندى|سلمى|عزيز|محمد|أحمد|لمى|معاذ|راسم|تحرير|دانية/;
  test("no team member's name in any line", () => {
    expect(offenders(ALL, STAFF)).toEqual([]);
  });
  test("the WhatsApp group names roles", () => {
    const rows = [...content.O.team.rows];
    for (const r of rows) {
      expect(r.name.en).toMatch(/^(?:Your|The) [a-z]/);
      expect(STAFF.test(r.name.ar)).toBe(false);
    }
  });
  test("the presenting CSM's name slot is only in the two self-introductions", () => {
    expect(
      ALL.filter(l => l.text.includes("{csm}"))
        .map(l => l.path)
        .sort(),
    ).toEqual(["L_NOTES.cover.sayAr[3]", "O_NOTES.welcome.sayAr[0]"]);
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
    expect(offenders(AR, /مقاول|زيار|فترة التجربة|وكالة|سلاك|عربون/)).toEqual(
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
      /^(?:Meta|Mahara|OS|WhatsApp|Instagram|Facebook|Brand|Blueprint|Google|Calendar|CRM|Academy|Drive|Page|LeadConnector|Saudi|UAE|Saturday|Thursday|Friday|Stories|Reels|EN|F|L|O|N|Esc|I|Sponsored|Zoom|SMS)$/;
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
    // Every other English line on the canvas too: no Title Case mid-sentence
    // ("I'd" is the pronoun, not a capital).
    const lines = ALL.filter(l => l.lang === "en" && !l.spoken);
    const shouty = lines.filter(l =>
      l.text
        .replace(/\{[^}]+\}/g, "")
        .split(/(?<=[.?:])\s+|\s+·\s+/)
        .some(sentence =>
          sentence
            .split(/\s+/)
            .slice(1)
            .some(
              w =>
                /^[A-Z]/.test(w) &&
                !PROPER.test(w.replace(/'.*$/, "").replace(/[^A-Za-z]/g, "")),
            ),
        ),
    );
    expect(shouty.map(l => `${l.path}: ${l.text}`)).toEqual([]);
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
