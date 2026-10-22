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
        const said =
          notes &&
          (k === "say" ||
            k === "sayAr" ||
            k === "push" ||
            k === "pushAr" ||
            k === "dwy");
        const l =
          k === "en" || (notes && (k === "say" || k === "push"))
            ? "en"
            : k === "ar" || (notes && (k === "sayAr" || k === "pushAr"))
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
    "Mark every meeting the same day, with the value when you win",
    "Move each meeting to the right stage the same day",
    "Did they come? Did you quote? Did you win? A few taps, the same day.",
    "A few taps, the same day.",
    "Move each meeting to the right stage in the CRM the same day: didn't show, showed, quote sent, closed.",
    "Your team moves it to the right stage in the CRM, the same day.",
    "سجلوا نتيجة كل موعد بنفس اليوم، ومعها قيمة المشروع إذا وقّع",
    "انقلوا كل موعد للمرحلة الصح بنفس اليوم",
    "حضر؟ عطيتوه عرض سعر؟ وقّع معكم؟ كم ضغطة، بنفس اليوم.",
    "كم ضغطة، بنفس اليوم.",
    "انقلوا كل موعد للمرحلة الصح في الـCRM بنفس اليوم: ما حضر، حضر، انرسل عرض السعر، وقّع.",
    "فريقكم ينقله للمرحلة الصح في الـCRM، بنفس اليوم.",
  ],
  // "Always" heads the client's own DO items on their red-lines panel.
  always: ["دايماً"],
  // Arabic كل, read one by one: never for a step of ours. These say "all
  // the slides", "everything", "not every enquiry", the client's own jobs
  // and approvals, the check-in rhythm, what Meta does, and the notes' own
  // asides. A new كل line fails until it is read and added here.
  everyAr: [
    "كل الشرائح",
    "→ ← تنقل، F ملء الشاشة، L اللغة، O كل الشرائح، N الملاحظات، Esc يقفل القائمة",
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
    "سجلوا نتيجة كل موعد بنفس اليوم، ومعها قيمة المشروع إذا وقّع",
    "انقلوا كل موعد للمرحلة الصح بنفس اليوم",
    "اتصلوا على الاستفسارات الجديدة خلال ٥ دقايق، وسجلوا كل محاولة",
    "ضيفوا كل موعد لنظامكم",
    "بعد كل موعد",
    "كل اللي يقابل عملاءكم أو يرسل عروض الأسعار يشوفه، ويبدي بأول قسم فيه، أساسيات البيع.",
    "تقريباً ٤٥ دقيقة، ومعها وقت لأسئلتكم. بنمر على اللي بينزل، وعلى اللي يصير لما أحد يستفسر، وعلى مين يسوي كل خطوة، وعلى اللي نحتاجه منكم. وقفوني بأي وقت.",
    "كل ما خليتوا أوقات فاضية أكثر من ساعات دوامكم، لقى العميل وقت يناسبه أسرع.",
    "وبعدها كل أسبوع أو كل أسبوعين",
    "بعد أول مكالمة متابعة، تكون المكالمات كل أسبوع أو كل أسبوعين، على حسب باقتكم، وكم صار لكم معنا.",
    "(If they want more questions) كل سؤال زيادة يطيّر معه ناس زينين بعد. نضيف سؤال لما الاستفسارات توضح إننا نحتاجه.",
    "(What lands with them) كل اللي عرفه فريق الاتصال يوصلكم، فتدخلون الموعد وأنتم عارفين المشروع.",
    "والبوابة تقدر تذكركم بعد كل موعد عشان تسجلون نتيجته.",
    "مكالمات المتابعة: لابتوب ومكان هادي، مو وأنتم بالسيارة. واللي بعدها نحجزها بآخر كل مكالمة.",
    "نمر معكم على كل شي بينزل.",
    "كل مكالمة نحجزها بآخر المكالمة اللي قبلها.",
    "كل واحد بالقروب يكلمكم عن شي واحد. وأنا نقطة تواصلكم معنا، لأي شي ثاني.",
    "ومع كل خطوة تخلص، يوصلكم الجزء اللي بعدها من هالطريق بقروب الواتساب.",
    "كل ما رفعتوا محتوى أكثر قبل مكالمة بناء الهوية، طلعت أول إعلاناتكم أحسن.",
    // Creative flexibility (2026-10-20): each version of an ad, "whenever
    // you can" and "the more" for the client's own content, and a video's
    // title, "how everything works".
    "كل وحدة فيها شي مختلف: البداية اللي تشد، أو الزاوية، أو طريقة العرض، أو مين يطلع بالفيديو.",
    "أرسلوا صور وفيديوهات جديدة لمشاريعكم كل ما قدرتوا. كل ما زاد المحتوى، زادت الإعلانات اللي نختبرها.",
    "(Stop 5, the content) كل ما أرسلتوا محتوى أكثر، قدرنا نسوي نسخ أكثر.",
    "كيف يمشي كل شي، من البداية للنهاية",
    // The fixer's round (2026-10-20): everyone on their account (the
    // group's one line), whenever they can (the recap's content line), and
    // everything the caller learned (what lands with them).
    "كل اللي يشتغلون على حسابكم معكم في هالقروب.",
    "كيف نختبر إعلاناتكم: خطوطكم الحمراء ثابتة، وأفكاركم ترسلونها بالقروب قبل الإعلانات الجاية، وتراجعون المعلومات والأسعار والوعود قبل لا ينزل الإعلان، والتعديلات الصغيرة على الشكل تروح للإعلانات الجاية عشان إطلاقكم ما يتأخر. وأي صور أو فيديوهات جديدة، أرسلوها كل ما قدرتوا.",
    "كل اللي عرفه فريق الاتصال يوصلكم.",
  ],
  // A number beside مواعيد that is the client's own job (the open slots
  // they keep), never a count of appointments we promise.
  countAr: ["خلوا ١٠ مواعيد فاضية على الأقل، بأوقات مختلفة"],
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
        "countAr",
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
      /mark every meeting|every two weeks|every stage true|every fact, price and claim|every try|not every enquiry books|^Always$|every extra question/i;
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
      /^(?:Meta|Mahara|OS|WhatsApp|Instagram|Facebook|Brand|Blueprint|Google|Calendar|CRM|Academy|Drive|Page|LeadConnector|Saudi|UAE|Saturday|Thursday|Friday|Stories|Reels|EN|F|L|O|N|Esc|I|Sponsored|Zoom|SMS|Premium|Projects|Project|Closing|Mastery|Arabic|English)$/;
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
    // A spoken line's English cue for the CSM, "(Stop 3, the offer)", is
    // English: its stop number is not Arabic copy.
    const cue = /^\([A-Za-z0-9 ,:'-]+\)\s*/;
    expect(
      offenders(
        AR.map(l => ({ ...l, text: l.text.replace(cue, "") })),
        /[0-9]/,
      ),
    ).toEqual([]);
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
    // طيب as a word (تشطيب, finishing, holds the same letters).
    expect(
      offenders(AR, /(?:^|[^\u0621-\u064a])طيب(?=$|[^\u0621-\u064a])/),
    ).toEqual([]);
  });
});

describe("the five main services (CEO, 2026-10-21)", () => {
  test("the kickoff form's five, in its order, with their Arabic; never a sub-trade", () => {
    const S = content.SERVICES;
    expect(
      (
        [
          "design-build",
          "interior",
          "architecture",
          "fitout",
          "construction",
        ] as const
      ).map(k => [S[k].name.en, S[k].name.ar, S[k].mid.en, S[k].mid.ar]),
    ).toEqual([
      [
        "Design and build",
        "تصميم وتنفيذ",
        "design and build",
        "التصميم والتنفيذ",
      ],
      ["Interior design", "تصميم داخلي", "interior design", "التصميم الداخلي"],
      [
        "Architectural design",
        "تصميم معماري",
        "architectural design",
        "التصميم المعماري",
      ],
      [
        "Fit-out and renovation",
        "تشطيب وترميم",
        "fit-out and renovation",
        "التشطيب والترميم",
      ],
      ["Construction", "بناء وإنشاءات", "construction", "البناء والإنشاءات"],
    ]);
    expect([S.other.name.en, S.other.name.ar]).toEqual(["Other", "خدمة أخرى"]);
    // Construction is never مقاولات: the decks never call the client مقاول.
    expect(offenders(AR, /مقاول/)).toEqual([]);
    for (const k of Object.keys(S) as (keyof typeof S)[])
      expect(S[k].name.en).not.toMatch(/kitchen|bathroom|majlis|pool/i);
  });

  test("an Arabic line never separates with a middle dot (it reads as ٠ beside a digit)", () => {
    expect(offenders(AR, /·/)).toEqual([]);
    expect(content.sep("ar")).toBe("، ");
    expect(content.sep("en")).toBe(" · ");
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
    // The sales deck's Academy screenshots (copy rule 11, 2026-10-20): an
    // actor's likeness on a course cover, another client's brand.
    "pcm-academy",
    "pcm-lesson",
    "interior-majlis",
    "portal-results",
    "portal-ads",
    "portal-leads",
    "ti2alygqn0",
    "callcenter.maharamedia.com",
  ];

  // The Academy's screens only as the masked copies (copy rule 11): the
  // unmasked names fail, "-masked" is the one form allowed.
  const MASKED = /pcm-(?:academy|lesson)-masked/g;
  test("the deck's files name none of the banned pictures", () => {
    expect(scanned.length).toBeGreaterThan(10);
    const hits: string[] = [];
    for (const f of scanned) {
      const name = f.slice(root.length + 1).replace(MASKED, "masked-shot");
      for (const b of BANNED)
        if (name.includes(b)) hits.push(`${name} is ${b}`);
      if (/\bcc-[a-z0-9-]+\.(?:webp|png|jpe?g)/.test(name))
        hits.push(`${name} is a cc- picture`);
      if (
        /\.(?:png|jpe?g|webp|svg|mp4|tsx?|css)$/.test(f) &&
        !/\.(?:png|jpe?g|webp|mp4)$/.test(f)
      ) {
        const text = readFileSync(f, "utf8").replace(MASKED, "masked-shot");
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

  /** A WebP's width and height, from its header (VP8, VP8L or VP8X). */
  const webpSize = (path: string) => {
    const b = readFileSync(path);
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8X")
      return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (kind === "VP8L") {
      const bits = b.readUInt32LE(21);
      return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
    }
    return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  };

  test("the Academy's screens are the masked copies, at their pinned sizes, at most 300 KB", () => {
    const shot = (n: string) => join(root, "present", "assets", n);
    expect(webpSize(shot("pcm-academy-masked.webp"))).toEqual([1456, 1029]);
    // The lesson cropped below the top bar (the member's avatar and counts),
    // and above "05: Closing Deposits" (copy rule 7: never "deposit").
    expect(webpSize(shot("pcm-lesson-masked.webp"))).toEqual([1444, 990]);
    for (const n of ["pcm-academy-masked.webp", "pcm-lesson-masked.webp"])
      expect(statSync(shot(n)).size).toBeLessThanOrEqual(300 * 1024);
  });
});

/**
 * Creative flexibility and the video slots (the CEO, 2026-10-20): the
 * expectation as CONTENT L3 and O7 write it, the handle's three goal lines,
 * the recap's testing line, and the slots' words.
 */
describe("creative flexibility and the video slots, as written", () => {
  const T = content.LAUNCH.test;
  test("slide 3's five stops, as CONTENT L3 writes them", () => {
    expect(T.job.copy.en).toBe(
      "Your page shows your brand. Your ads are there to bring in business: enquiries from people who don't know you yet.",
    );
    expect(T.volume.copy.en).toBe(
      "We make many versions and switch most of them off. That's how we find the few that work.",
    );
    expect(T.input.copy.en).toBe(
      "Ideas, a new offer, a new price, something to change? Send it in the group before we make the next round.",
    );
    expect(T.input.offer.en).toBe(
      "Keep your offer steady while a test runs. A new offer starts the test again.",
    );
    expect(T.check.words.map(w => w.en).join(" · ")).toBe(
      "Facts · Prices · Claims",
    );
    expect(T.check.style.en).toBe(
      "Small style changes go into the next round, so your launch doesn't wait.",
    );
    expect(T.content.copy.en).toBe(
      "Send new photos and videos of your projects whenever you can. More content means more ads to test.",
    );
    expect(T.fixed.copy.en).toBe("We never cross these.");
    expect(T.round.ar).toBe("الإعلانات الجاية");
    // A دفعة is a payment: never the next round.
    expect(
      offenders(
        AR.filter(l => l.path.startsWith("LAUNCH.test")),
        /دفعة/,
      ),
    ).toEqual([]);
  });
  test("no count on slide 3: no win rate, no 20 versions, no one in ten", () => {
    const four = ALL.filter(
      l =>
        l.path.startsWith("LAUNCH.test") &&
        !l.path.includes(".ask.held") &&
        !l.path.includes(".reply.held"),
    );
    expect(offenders(four, /[0-9٠-٩]|%|one in|win rate/i)).toEqual([]);
    // The retired optional stop and its 20 versions are gone.
    expect(
      offenders(
        ALL,
        /How a test runs|20 versions|٢٠ نسخة|Your page stays yours|Open: everything else we test/,
      ),
    ).toEqual([]);
  });
  test("O7 plants it before any ad exists: the small check and the next round", () => {
    expect(content.O.next.approval.en).toBe(
      "They go live only once you've approved the facts, prices and claims in them.",
    );
    // The ads' job first (business, not the brand page), then the volume,
    // then the red lines' ask: three lines, not one block (score round 2).
    expect(
      [
        content.O.next.testLine.en,
        content.O.next.testVolume.en,
        content.O.next.testAsk.en,
      ].join(" "),
    ).toBe(
      "Your ads are there to bring in business, not to look like your page. We test many ads, fast. Small style changes go into the next round, so your launch keeps moving. Your red lines stay fixed: tell us now what we must never say or show.",
    );
    expect(content.O.next.testLine.ar).toBe(
      "إعلاناتكم هدفها تجيب لكم شغل، مو إنها تشبه صفحتكم.",
    );
    expect(
      content.O_NOTES.next.say.some(l =>
        l.startsWith("The testing, in one breath"),
      ),
    ).toBe(true);
  });
  test("the handle: three goal lines, warm, and never 'we won't do it'", () => {
    expect(T.ask.shown.en).toBe(
      'You told us your goal is "{goal}". What matters more: this one change, or getting the ads live so we can get there?',
    );
    // Quoted, never spliced: a goal written as "We want…" still reads.
    expect(T.reply.shown.en).toContain('You told us your goal is "{goal}", so');
    expect(T.ask.shown.ar).toStartWith("قلتوا لنا إن هدفكم: {goal}. ");
    expect(T.reply.shown.ar).toContain("قلتوا لنا إن هدفكم: {goal}. ");
    expect(T.ask.held.en).not.toContain("{goal}");
    expect(T.ask.none.en).toBe(
      "What matters more to you: this one change, or getting the ads live?",
    );
    for (const v of ["shown", "held", "none"] as const) {
      expect(T.reply[v].en).toStartWith("Thanks, noted.");
      expect(T.reply[v].en).toContain("it goes into the next round");
      expect(T.reply[v].ar).toStartWith("شكراً، وصلتنا.");
    }
    // The handle lives under "If they push back", apart from the stops.
    const say = content.L_NOTES["creative-freedom"].push ?? [];
    expect(say.some(l => l.includes("{goalAsk}"))).toBe(true);
    expect(content.L_NOTES["creative-freedom"].pushAr).toContain(
      "(Then ask) {goalAsk}",
    );
    expect(
      content.L_NOTES["creative-freedom"].say.some(l =>
        l.includes("{goalAsk}"),
      ),
    ).toBe(false);
    expect(
      say.some(l =>
        l.includes(
          "The last thing we want is to hold your launch for a small change.",
        ),
      ),
    ).toBe(true);
    // Said only as what never to say.
    expect(
      offenders(ALL, /we won'?t do it|ما راح نسويه/).filter(
        l => !l.includes('Never "we won\'t do it"'),
      ),
    ).toEqual([]);
    expect(say.some(l => l.includes("after working with X clients"))).toBe(
      true,
    );
  });
  test("the recap's testing line puts slide 3's agreement in writing", () => {
    // The rule the pushback is about (small style changes go into the next
    // round) and the content ask are in it, the line the CSM points to.
    expect(content.GROUP_LINKS.testing.en).toBe(
      "How we test your ads: your red lines stay fixed, your ideas go in the group before the next round, you check the facts, prices and claims before an ad goes live, and small style changes go into the next round so your launch doesn't wait. New photos and videos help: send them whenever you can.",
    );
    // The money and the first weeks, in writing, until their videos exist.
    expect(content.GROUP_LINKS.payments.en).toBe(
      "Keep your ad card funded. Your payments to us are on the dates in your agreement.",
    );
    expect(content.GROUP_LINKS.firstWeeks.en).toBe(
      "The first weeks are usually slower while the ads find your audience. Leave them running.",
    );
    expect(content.GROUP_LINKS.watch.en).toBe(
      "Missed something on the call? Watch:",
    );
    expect(content.GROUP_LINKS.watch.ar).toBe("فاتكم شي بالمكالمة؟ شوفوا:");
  });
  test("the slots' titles fit one line, and the canvas never shows an empty slot's words", () => {
    for (const [k, t] of Object.entries(content.VIDEO.titles)) {
      expect(`${k}: ${t.en}`.length - k.length - 2).toBeLessThanOrEqual(32);
      expect(t.ar.length).toBeGreaterThan(3);
    }
    // "Not recorded yet" is cockpit UI, never a canvas string.
    expect(
      offenders(ALL, /not recorded|coming soon|(?<![\u0600-\u06FF])قريباً/i),
    ).toEqual([]);
    // The Arabic length is said in words: no m:ss template.
    for (const v of Object.values(content.VIDEO.minutes))
      expect(v.ar).not.toMatch(/:/);
  });
});

/**
 * The Gamma pass (CEO, 2026-10-20) and its spec review: the expectation
 * setting from Mahara's own Gamma decks, pinned where the words live.
 */
describe("the Gamma pass: the expectations, as written", () => {
  const L = content.LAUNCH;

  test("we reply within 2 working hours, on O3 and on the good-to-know row", () => {
    const O3 = content.O.team;
    // O3's second stop: the promise as its heading, then the hours.
    expect(O3.reply.en).toBe("We reply within 2 working hours.");
    expect(O3.reply.ar).toBe("نرد خلال ساعتين دوام.");
    expect(O3.hours.en).toStartWith("10 to 6, Saturday to Thursday.");
    expect(O3.hoursUae.en).toContain("10 to 6 Saudi time (11 to 7 in the UAE)");
    expect(O3.hours.ar).toStartWith("من ١٠ صباحاً إلى ٦ مساءً، ");
    const replies = L.know.rows.find(r => r.key === "replies");
    expect(replies?.line.en).toBe(
      "In the group within 2 working hours, 10 to 6, Saturday to Thursday.",
    );
    expect(replies?.lineUae?.en).toContain(content.HOURS.uae.en);
    expect(replies?.line.ar).toContain("خلال ساعتين دوام");
    // The reply time is said one way only.
    expect(
      offenders(
        EN,
        /\bwithin (?:24|two|a couple of) (?:working |business )?hours\b|\b2 business hours\b/i,
      ),
    ).toEqual([]);
  });

  test("at least 10 open slots, at different times, and a day off blocked by the hour", () => {
    const slots = L.part.rows.find(r => r.key === "slots");
    expect(slots?.head).toBe("before");
    expect(slots?.job.en).toBe(
      "Keep at least 10 open slots, at different times",
    );
    expect(slots?.job.ar).toBe("خلوا ١٠ مواعيد فاضية على الأقل، بأوقات مختلفة");
    // The slide's one sentence, then the day off said in the notes and
    // the recap (score round 1).
    expect(slots?.why.en).toBe("Our callers book into them.");
    expect(slots?.more?.en).toBe(
      "On a day off, block each hour, not one all-day event.",
    );
    expect(slots?.whyDwy?.en).toStartWith("Your team books into them.");
    expect(L.part.days.map(d => d.en)).toEqual([
      "Sat",
      "Sun",
      "Mon",
      "Tue",
      "Wed",
      "Thu",
    ]);
  });

  test("the pie's two parts: one piece of ours named three ways, theirs the meeting and the close", () => {
    const P = L.partner;
    expect(P.line1.en).toBe("We bring them to your door.");
    expect(P.line2.en).toBe("You win the project.");
    expect(P.ours.map(x => x.en)).toEqual([
      "Ads and enquiries",
      "Calls and bookings",
      "Reminders and rebooking",
    ]);
    expect(P.theirs.map(x => x.en)).toEqual(["The meeting", "The close"]);
    expect(P.owner.us.en).toBe("Our team");
    expect(P.owner.you.en).toBe("You");
    // Done with you, the pie splits by owner in halves: their team calls,
    // books, meets and closes; the messages that go out by themselves are ours.
    expect(P.oursDwy.map(x => x.en)).toEqual([
      "Ads and enquiries",
      "Confirmations and reminders",
    ]);
    expect(P.theirsDwy.map(x => x.en)).toEqual([
      "Calls and bookings",
      "The meeting and the close",
    ]);
    expect(P.owner.youDwy.en).toBe("Your team");
    // The roads carry no length labels and no speed claim; stop 4 is one line.
    expect(P.close.en).toBe(
      "We can't close for you. We can help you get better at it.",
    );
    expect(JSON.stringify(P)).not.toMatch(
      /longer road"|shorter road|easier|faster|5 others/i,
    );
    // No percentage or fraction is ever written for the split.
    expect(
      offenders(
        ALL,
        /three quarters|\b75 ?%|\b25 ?%|ثلاث أرباع|ربع الشغل|٧٥٪|٢٥٪/i,
      ).filter(l => !l.startsWith("L_NOTES.partnership.say")),
    ).toEqual([]);
  });

  test("the training: the Academy's six courses in order, Project Closing Mastery lit, what it teaches", () => {
    const T = L.training;
    expect(T.courses.map(c => c.en)).toEqual([
      "Introduction",
      "Onboarding",
      "Google optimization",
      "Offer creation",
      "Project Closing Mastery",
      "Team and operations",
    ]);
    expect(T.courses[T.lit].en).toBe("Project Closing Mastery");
    expect(T.teaches.en).toBe("What it teaches");
    expect(T.parts.map(p => p.en)).toEqual([
      "The consultation",
      "The proposal",
      "The objections",
      "The close",
    ]);
    // Where to start is the course's real first section, never "the
    // consultation" (not a section of the course).
    expect(T.statements[0].line.en).toContain(
      "starting with the sales crash course",
    );
    expect(JSON.stringify(T)).not.toMatch(
      /starting with the consultation|وابدوا بالاستشارة/,
    );
    // Rule 5: the rhythm's one home is the 90 days, so the training states no cadence.
    expect(JSON.stringify(T)).not.toMatch(
      /weekly|every two weeks|fortnight|كل أسبوع|أسبوعين/i,
    );
    // The recap ends on the course, with the Academy link.
    expect(content.GROUP_LINKS.academyFirst.en).toBe(
      "Before your first meetings: Project Closing Mastery in the Academy: {url}",
    );
    // O6 starts them where the Academy says to start.
    expect(content.O.week.rows.academy.line.en).toEndWith(
      "Join, and start with the introduction.",
    );
    expect(content.O.week.rows.academy.line.ar).toEndWith(
      "انضموا، وابدوا بكورس البداية.",
    );
  });

  test("marking every meeting: the three taps' lines, and moved kept apart from cancelled", () => {
    const P = L.portal;
    expect(P.askLines.map(x => x.en)).toEqual([
      "Running late isn't a no-show.",
      "Sent it later? Update it then.",
      "Add the value, or a line on why.",
    ]);
    // One line (the fixer's round): the reminders or the rebook, never both.
    expect(P.moved.en).toBe(
      "Cancelled or moved with you directly? Tell us in the group: we change the reminders or call to rebook.",
    );
    expect(P.moved.ar).toContain(
      "ونعدّل التذكيرات أو نتصل عليه ونحجز له من جديد.",
    );
    // A moved meeting is never rebooked a third time.
    expect(
      offenders(ALL, /update the reminders and rebook|ونحدّث التذكيرات ونحجز/),
    ).toEqual([]);
  });

  test("the six jobs: at most six, each head with its own, no calling job after the meeting", () => {
    for (const dwy of [false, true]) {
      const jobs = content.partJobs(dwy);
      expect(jobs.length).toBe(6);
      const by = (h: string) => jobs.filter(j => j.head === h).map(j => j.key);
      expect(by("before")).toEqual(["slots", "system"]);
      expect(by("after")).toEqual(["mark", "follow"]);
      expect(by("weeks")).toEqual(["ads", "drive"]);
      const after = jobs.filter(j => j.head === "after");
      // Calling a new enquiry happens before any meeting.
      expect(
        after.filter(j => /\bcall\b|within 5 minutes/i.test(j.job.en)),
      ).toEqual([]);
      expect(after.filter(j => /اتصلوا|دقايق/.test(j.job.ar))).toEqual([]);
    }
    const dwy = content.partJobs(true);
    expect(dwy.find(j => j.key === "system")?.job.en).toBe(
      "Call new enquiries within 5 minutes, and note every try",
    );
    expect(dwy.find(j => j.key === "mark")?.job.en).toBe(
      "Move each meeting to the right stage the same day",
    );
    // Done with you their own team makes the calls: no "our caller".
    expect(
      dwy.filter(j =>
        /\bour callers?\b|فريق الاتصال(?!\s*عندكم)/i.test(
          `${j.why.en} ${j.why.ar} ${j.more?.en ?? ""} ${j.more?.ar ?? ""}`,
        ),
      ),
    ).toEqual([]);
    expect(L.part.heads.weeks.en).toBe("Week to week");
    expect(L.part.title.en).toBe("Your six jobs, in one place");
    // Keep the offer steady is said on L3 now, not a job.
    expect(JSON.stringify(L.part)).not.toMatch(/offer steady/i);
    expect(
      content.L_NOTES["creative-freedom"].say.length +
        content.L_NOTES["creative-freedom"].sayAr.length,
    ).toBeGreaterThan(0);
  });

  test("the first weeks: usually slower, never always", () => {
    expect(L.days.slow.en).toBe(
      "Usually slower, while the ads find your audience.",
    );
    expect(L.days.slow.ar).toStartWith("عادةً");
    expect(
      offenders(ALL, /always (?:the )?slow|دايماً أهدأ|always quiet/i),
    ).toEqual([]);
  });

  test("before the meeting, one voice: done for you only", () => {
    expect(L.call.after.oneVoice.en).toBe(
      "Before the meeting, the messages come from us, so your customer hears one voice.",
    );
  });

  test("payments: the dates in your agreement, never monthly from today", () => {
    const pay = L.know.rows.find(r => r.key === "pay");
    expect(pay?.line.en).toStartWith("On the dates in your agreement.");
    expect(pay?.lineDwy?.en).not.toMatch(/our calls/);
    // Only the note telling the presenter never to say it may name it.
    expect(
      offenders(
        ALL,
        /monthly from today|every month from today|renews every month/i,
      ).filter(l => !l.includes('Never "monthly from today"')),
    ).toEqual([]);
    const card = L.know.rows.find(r => r.key === "card");
    expect(card?.line.en).toContain(
      "Running low? Tell us first, and we'll pause the ads safely.",
    );
  });

  test("the Gamma lines left out on purpose stay out", () => {
    expect(
      offenders(
        EN,
        /\b(?:8|eight) (?:tries|times|follow-?ups)\b|\b80 ?%|third contact(?! ")|\b10 minutes\b|Sunday to Thursday|\bAI\b|tons of|monthly projections|monthly (?:results |reporting )?call/i,
      ).filter(l => !l.startsWith("L_NOTES.partnership.say")),
    ).toEqual([]);
    expect(
      offenders(AR, /الأحد إلى الخميس|[٨8] محاولات|٨٠٪|١٠ دقايق|ذكاء اصطناعي/),
    ).toEqual([]);
  });
});
