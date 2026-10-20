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
  // "The same day" is allowed for the client's own job, never for our
  // calls or our fixes (CONTENT copy rule 1).
  speed: [
    "Mark every meeting, the same day",
    "Did they come? Did you quote? Did you win? A few taps, the same day.",
    "A few taps, the same day.",
    "Move each meeting to the right stage in the CRM the same day: didn't show, showed, quote sent, closed.",
    "Your team moves it to the right stage in the CRM, the same day.",
    "سجلوا نتيجة كل موعد، بنفس اليوم",
    "حضر؟ عطيتوه عرض سعر؟ وقّع معكم؟ كم ضغطة، بنفس اليوم.",
    "كم ضغطة، بنفس اليوم.",
    "انقلوا كل موعد للمرحلة الصح في الـCRM بنفس اليوم: ما حضر، حضر، انرسل عرض السعر، وقّع.",
    "فريقكم ينقله للمرحلة الصح في الـCRM، بنفس اليوم.",
  ],
  // "Always …" heads the client's own DO items on their red-lines panel.
  always: ["دايماً …"],
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
    "اتصلوا خلال ٥ دقايق، وسجلوا كل محاولة، وخلوا كل مرحلة صحيحة",
    "وبعدها كل أسبوع أو كل أسبوعين",
    "بعد أول مكالمة متابعة، تكون المكالمات كل أسبوع أو كل أسبوعين، على حسب باقتكم، وكم صار لكم معنا.",
    "(If they want more questions) كل سؤال زيادة يطيّر معه ناس زينين بعد. نضيف سؤال لما الاستفسارات توضح إننا نحتاجه.",
    "(What lands with them) كل اللي عرفه فريق الاتصال يوصلكم، فتدخلون الموعد وأنتم عارفين المشروع.",
    "والبوابة تقدر تذكركم بعد كل موعد عشان تسجلون نتيجته.",
    "مكالمات المتابعة: لابتوب ومكان هادي، مو وأنتم بالسيارة. واللي بعدها نحجزها بآخر كل مكالمة.",
    "نبدي بخدمة وحدة، عشان كل إعلان وكل سؤال وكل مكالمة تكلم نوع واحد من العملاء.",
    "نمر معكم على كل شي بينزل.",
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

/** Journey stop 3, as the CEO answered (2026-10-20): "keep it 5 mins for all". */
const STOP3 = {
  en: "We call new enquiries within 5 minutes during working hours, 10 to 6, Saturday to Thursday. Anything that comes in at night is called from 10 the next working morning.",
  uae: "We call new enquiries within 5 minutes during working hours, 10 to 6 Saudi time (11 to 7 in the UAE), Saturday to Thursday. Anything that comes in at night is called from 10 the next working morning.",
  dwy: "A new-enquiry alert reaches your callers' phones and your WhatsApp group. Call within 5 minutes. Up to 4 tries over 3 working days.",
};

describe("rule 1: within 5 minutes, with the hours and the night rule", () => {
  test("stop 3 says the 5 minutes, the working hours and the night rule", () => {
    const S = content.LAUNCH.journey.stops[2];
    expect(S.line.en).toBe(STOP3.en);
    expect(S.lineUae?.en).toBe(STOP3.uae);
    expect(S.lineUae?.en).toContain(content.HOURS.uae.en);
    for (const l of [S.line, S.lineUae as content.L]) {
      expect(l.ar).toStartWith(
        "نتصل على الاستفسارات الجديدة خلال ٥ دقايق في أوقات الدوام: ",
      );
      expect(l.ar).toContain("من السبت إلى الخميس.");
      expect(l.ar).toEndWith(
        "واللي يوصل بالليل، نتصل عليه من الساعة ١٠ صباح أول يوم دوام.",
      );
    }
    expect(S.line.ar).toContain("من ١٠ صباحاً إلى ٦ مساءً، من السبت");
    expect(S.lineUae?.ar).toContain(content.HOURS.uae.ar);
    // Done with you: their own team calls within 5 minutes; the tries stay.
    expect(S.dwy?.en).toBe(STOP3.dwy);
    expect(S.dwy?.ar).toContain("اتصلوا خلال ٥ دقايق.");
    expect(content.LAUNCH.journey.tries.en).toBe(
      "Up to 4 tries over 3 working days",
    );
    expect(S.dwy?.en).toContain(content.LAUNCH.journey.tries.en);
    expect(S.dwy?.ar).toContain(content.LAUNCH.journey.tries.ar);
  });
  test("the form's line and the thank-you screen say it the same way", () => {
    const F = content.LAUNCH.form;
    expect(F.waNextUs.en).toBe(
      "Our team calls them within 5 minutes during working hours.",
    );
    expect(F.thanksDefault.en).toBe(
      "Thank you. Our team will call you within 5 minutes during working hours.",
    );
    expect(F.waNextUs.ar).toContain("خلال ٥ دقايق في أوقات الدوام");
    expect(F.thanksDefault.ar).toBe(
      "شكراً لك. فريقنا بيتصل عليك خلال ٥ دقايق في أوقات الدوام.",
    );
    // The presenter gives the night rule on the form slide too.
    expect(
      content.L_NOTES.form.say.some(
        l =>
          l.includes("within 5 minutes during working hours") &&
          l.includes("called from 10 the next working morning"),
      ),
    ).toBe(true);
  });
  test("the presenter says it plainly at stop 3, with the hours and the night rule", () => {
    const n = content.L_NOTES.journey;
    expect(
      n.say.some(
        l =>
          l.startsWith("At stop 3") &&
          l.includes(
            "within 5 minutes during working hours, 10 to 6, Saturday to Thursday",
          ) &&
          l.includes("called from 10 the next working morning"),
      ),
    ).toBe(true);
    expect(
      n.sayAr.some(
        l =>
          l.includes("خلال ٥ دقايق في أوقات الدوام") &&
          l.includes("بالليل") &&
          l.includes("أول يوم دوام"),
      ),
    ).toBe(true);
    // A UAE client hears their own hours in Arabic too, as the slide shows.
    expect(
      n.sayAr.some(
        l => l.includes("بتوقيت السعودية") && l.includes("بتوقيت الإمارات"),
      ),
    ).toBe(true);
  });
  test("English: only ever within 5 minutes, and ours with the working hours", () => {
    const five = EN.filter(l => /\b(?:5|five) minutes\b/i.test(l.text));
    expect(five.length).toBeGreaterThanOrEqual(7);
    expect(
      offenders(
        EN,
        /(?<!within )\b5 minutes\b|five minutes|within (?!5 minutes)(?:a few |\d+ )?minutes/i,
      ),
    ).toEqual([]);
    // Ours always comes with the working hours; done with you (a dwy line)
    // it is their own team's call.
    expect(
      five
        .filter(l => !/dwy/i.test(l.path) && !/working hours/.test(l.text))
        .map(l => `${l.path}: ${l.text}`),
    ).toEqual([]);
  });
  test("English: still never instantly, same day for ours, or 21x and 100x", () => {
    expect(
      offenders(
        EN,
        /\binstantly\b|\bsame[- ]day\b|\bjust now\b|21\s?[x×]|100\s?[x×]/i,
        "speed",
      ),
    ).toEqual([]);
    expect(
      offenders(
        EN,
        /right away|immediately|\bin (?:a few |\d+ )?minutes|within (?:the|an|one|\d+) hours?|\bas soon as\b|\bstraight away\b/i,
      ),
    ).toEqual([]);
    // The old rule's leftovers are gone.
    expect(
      offenders(
        ALL,
        /promise faster|never a speed|don't promise (?:a )?speed/i,
      ),
    ).toEqual([]);
  });
  test("Arabic: ٥ دقايق only, ours with the working hours, never فوراً", () => {
    const five = AR.filter(l => /[٠-٩0-9]+ دقا(?:ي|ئ)ق/.test(l.text));
    expect(five.length).toBeGreaterThanOrEqual(7);
    expect(
      offenders(
        AR,
        /خمس دقايق|خمس دقائق|(?<![٠-٩0-9])(?!٥ دقايق)[٠-٩0-9]+ دقا(?:ي|ئ)ق|(?<!خلال )٥ دقايق|خلال دقا(?:ئ|ي)ق/,
      ),
    ).toEqual([]);
    expect(
      five
        .filter(l => !/dwy/i.test(l.path) && !/أوقات الدوام/.test(l.text))
        .map(l => `${l.path}: ${l.text}`),
    ).toEqual([]);
    expect(
      offenders(
        AR,
        /فوراً|فورا|نفس اليوم|على طول|سيده|بأسرع وقت|(?:٢١|١٠٠|21|100)\s?(?:[x×]|ضعف|مرة)/,
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

describe("rules 4 and 5: no every or always for our steps, the rhythm never one alone", () => {
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
    expect(offenders(EN, /seven days a week|7 days a week/i)).toEqual([]);
    expect(
      offenders(
        AR,
        /أسبوعي(?!ن)|كل أسبوع(?!ين| أو كل أسبوعين)|سبعة أيام|٧ أيام بالأسبوع|دايم|دائم/,
        "always",
      ),
    ).toEqual([]);
    // Arabic كل, line by line (ALLOWED.everyAr says why each is fine).
    expect(offenders(AR, /(?:^|[\s(،.])كل(?=\s)/, "everyAr")).toEqual([]);
  });
  test("rule 5: check-ins weekly or every two weeks, and why", () => {
    const D = content.LAUNCH.days;
    expect(D.later.en).toBe("Then weekly or every two weeks");
    expect(D.later.ar).toBe("وبعدها كل أسبوع أو كل أسبوعين");
    expect(D.laterWhy.en).toBe(
      "Depending on your plan and how long you've been with us.",
    );
    expect(D.laterWhy.ar).toBe("على حسب باقتكم، وكم صار لكم معنا.");
    // The first check-in stays a week or two after go-live.
    expect(D.first.en).toBe("Your first check-in · a week or two in");
    // The presenter says both, and why.
    const n = content.L_NOTES["first-90-days"];
    expect(
      n.say.some(l =>
        l.includes(
          "weekly or every two weeks, depending on your plan and how long you've been with us",
        ),
      ),
    ).toBe(true);
    expect(
      n.sayAr.some(l =>
        l.includes("كل أسبوع أو كل أسبوعين، على حسب باقتكم، وكم صار لكم معنا"),
      ),
    ).toBe(true);
  });
  test("rule 5: never one of the two alone", () => {
    expect(
      offenders(
        EN,
        /\bweekly\b(?! or every two weeks)|(?<!weekly or )\bevery two weeks\b|\bbi-?weekly\b|fortnight/i,
      ),
    ).toEqual([]);
    expect(
      offenders(
        AR,
        /كل أسبوع(?!ين| أو كل أسبوعين)|(?<!كل أسبوع أو )كل أسبوعين|أسبوعي(?!ن)/,
      ),
    ).toEqual([]);
    expect(
      offenders(
        ALL,
        /once a week|all week|every week|مرة ب?الأسبوع|طول الأسبوع/i,
      ),
    ).toEqual([]);
  });
});

describe("rule 6: a no-show is ours; someone thinking it over, both of us", () => {
  test("the journey's fork, in both languages", () => {
    const fork = content.LAUNCH.journey.fork;
    expect(fork.noShowLine.en).toBe("Ours. We call to rebook.");
    expect(fork.noShowLine.ar).toMatch(/^علينا\./);
    // Done for you: we call to follow up, so does the client (they know the
    // customer best), and the client still marks it.
    expect(fork.decidingLine.en).toBe(
      "Both of us. We call to follow up, and so do you: you know them best. Then mark it.",
    );
    expect(fork.decidingLine.ar).toMatch(/^علينا وعليكم\./);
    expect(fork.decidingLine.ar).toContain("نتصل عليه ونتابع معه");
    expect(fork.decidingLine.ar).toContain("وأنتم بعد تتابعونه");
    expect(fork.decidingLine.ar).toMatch(/وبعدها سجلوا النتيجة\.$/);
    // Done with you, unchanged: their own team follows up.
    expect(fork.decidingDwy.en).toBe(
      "Follow up, then move it to the right stage.",
    );
    expect(fork.decidingDwy.ar).toBe("تابعوه، وبعدها انقلوه للمرحلة الصح.");
    expect(fork.noShowDwy.en).toBe(
      "The follow-up messages start by themselves.",
    );
    // Never the client's alone (done for you), never ours alone.
    expect(
      offenders(
        ALL,
        /Didn't (?:come|show)\? Yours|thinking it over\? (?:Ours|Yours)\b|^Yours\. Follow up|^عليكم\. تابعوه/i,
      ),
    ).toEqual([]);
  });
  test("the presenter explains the shared follow-up at stop 6", () => {
    const n = content.L_NOTES.journey;
    expect(
      n.say.some(
        l =>
          l.includes("thinking it over") &&
          l.includes("our caller calls them") &&
          l.includes("the client follows up too") &&
          l.includes("still marks the outcome"),
      ),
    ).toBe(true);
    expect(
      n.sayAr.some(
        l => l.includes("نتابعه إحنا وأنتم") && l.includes("سجلوا النتيجة"),
      ),
    ).toBe(true);
  });
  test("one name for a no-show: the CRM's stage, asked on the fork", () => {
    expect(content.LAUNCH.journey.fork.noShow.en).toBe("Didn't show?");
    expect(content.LAUNCH.portal.crm[0].en).toBe("Didn't show");
    expect(content.LAUNCH.journey.fork.noShow.ar).toBe(
      `${content.LAUNCH.portal.crm[0].ar}؟`,
    );
    expect(offenders(EN, /\bdidn't come\b|\bno-?shows? came\b/i)).toEqual([]);
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
