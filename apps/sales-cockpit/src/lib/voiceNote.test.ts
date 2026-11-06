import { describe, expect, test } from "bun:test";
import type { VoiceNote } from "./dialer";
import {
  challengeOf,
  countryWords,
  greetName,
  lengthWords,
  notKnownLine,
  toldUs,
  VOICE_MAX_S,
  VOICE_MIN_S,
  voiceScript,
} from "./voiceNote";

// Thursday 5 Nov 2026, 15:00 Kuwait.
const NOW = Date.parse("2026-11-05T12:00:00Z");
// Friday 6 Nov 2026, 15:00 Kuwait (16:00 in the UAE).
const TOMORROW_3PM = "2026-11-06T12:00:00Z";

const facts = (over: Partial<VoiceNote> = {}): VoiceNote => ({
  due: true,
  step: "new",
  first_name: "Faisal",
  company: null,
  country: "Saudi Arabia",
  services: null,
  revenue: "$500k - $1M",
  goal: "$3M+",
  challenge: "ما يوصلنا عملاء كفاية",
  projects_12m: null,
  ready_to_invest: "$12K أكثر من",
  decision_maker: "نعم، أنا صاحب القرار الوحيد",
  call: null,
  language: "ar",
  rep: { first_name: "Sara", first_name_ar: "سارة" },
  missing: [
    "company",
    "what they do",
    "projects signed in the last 12 months (the form does not ask)",
  ],
  ...over,
});

const booked = (over: Partial<VoiceNote> = {}) =>
  facts({
    step: "booked",
    call: {
      type: "intro",
      start_at: TOMORROW_3PM,
      kuwait: "Fri 6 Nov, 15:00",
      theirs: null,
    },
    ...over,
  });

const ARABIC = /[؀-ۿ]/;
const LATIN_DIGIT = /[0-9]/;

describe("the voice-note script, in English", () => {
  test("a new lead: greeting, the form, their challenge, how to call back", () => {
    const s = voiceScript(facts(), "en", { now: NOW });
    expect(s.text.split("\n")).toEqual([
      "Hi Faisal, it's Sara from Mahara Media.",
      "I saw your form come in from Saudi Arabia and tried to call you.",
      "You mentioned you're not getting enough clients, and I'd like to hear a bit more about that.",
      "Call us back on the number that just called you when you get a minute, or reply here with a time that suits you.",
      "Speak soon.",
    ]);
    expect(s.used.sort()).toEqual(["challenge", "country", "first_name"]);
    expect(ARABIC.test(s.text)).toBe(false);
  });

  test("a just-booked lead hears their booked time on their own clock", () => {
    const s = voiceScript(booked(), "en", { now: NOW, clock: "Asia/Riyadh" });
    expect(s.text).toContain(
      "Thanks for booking a call with us for tomorrow at 3 pm.",
    );
    expect(s.text).toContain("speak to you tomorrow at 3 pm.");
    expect(s.text).not.toContain("your time");
    const uae = voiceScript(booked(), "en", { now: NOW, clock: "Asia/Dubai" });
    expect(uae.text).toContain("for tomorrow at 4 pm your time.");
  });

  test("a weekday booking reads 'on Monday' where the sentence needs it", () => {
    const monday = "2026-11-09T12:00:00Z";
    const s = voiceScript(
      booked({
        call: {
          type: "intro",
          start_at: monday,
          kuwait: "Mon 9 Nov, 15:00",
          theirs: null,
        },
      }),
      "en",
      { now: NOW },
    );
    expect(s.text).toContain("for Monday at 3 pm.");
    expect(s.text).toContain("speak to you on Monday at 3 pm.");
    const c = voiceScript(
      booked({
        step: "confirm",
        call: {
          type: "intro",
          start_at: monday,
          kuwait: "Mon 9 Nov, 15:00",
          theirs: null,
        },
      }),
      "en",
      { now: NOW },
    );
    expect(c.text).toContain("about our call on Monday at 3 pm.");
  });

  test("a confirmation asks for a yes and offers another time, nothing more", () => {
    const s = voiceScript(booked({ step: "confirm" }), "en", { now: NOW });
    expect(s.text.split("\n")).toEqual([
      "Hi Faisal, it's Sara from Mahara Media.",
      "Just a quick one about our call tomorrow at 3 pm.",
      "I tried calling to check the time still works for you.",
      "Could you reply with a quick yes? If it doesn't suit you anymore, tell me and I'll find another time.",
      "Speak soon.",
    ]);
  });
});

describe("the voice-note script, in Gulf Arabic", () => {
  test("a new lead, in the approved opening and the voice rules", () => {
    const s = voiceScript(facts(), "ar", { now: NOW });
    expect(s.text.split("\n")).toEqual([
      "هلا Faisal، معاكم سارة من مهارة ميديا.",
      "شفت الفورم اللي عبيتوه من السعودية وحاولت أتصل عليكم.",
      "ذكرتوا إن ما يوصلكم عملاء كفاية، وأبي أسمع منكم أكثر عن هالشي.",
      "اتصلوا علينا على الرقم اللي اتصل عليكم إذا عندكم وقت، أو ردوا علي هني بوقت يناسبكم.",
      "أنطر ردكم.",
    ]);
  });

  test("a booking says the day and time in Arabic words and digits", () => {
    const s = voiceScript(booked(), "ar", { now: NOW, clock: "Asia/Kuwait" });
    expect(s.text).toContain(
      "شكراً إنكم حجزتوا مكالمة معانا باجر الساعة ٣ العصر.",
    );
    expect(s.text).toContain("أكلمكم باجر الساعة ٣ العصر.");
    const uae = voiceScript(booked(), "ar", { now: NOW, clock: "Asia/Dubai" });
    expect(uae.text).toContain("باجر الساعة ٤ العصر بتوقيتكم");
  });

  test("a confirmation", () => {
    const s = voiceScript(booked({ step: "confirm" }), "ar", { now: NOW });
    expect(s.text.split("\n")).toEqual([
      "هلا Faisal، معاكم سارة من مهارة ميديا.",
      "بس حبيت أتأكد من مكالمتنا باجر الساعة ٣ العصر.",
      "حاولت أتصل عليكم أشوف إذا الوقت ليلحين يناسبكم.",
      "ردوا علي بس بتمام إذا يناسبكم، وإذا لا.. قولوا لي ونغيره.",
      "أنطر ردكم.",
    ]);
  });

  test("every Arabic script speaks in the plural, the same for a man or a woman (2026-11-06 review)", () => {
    const singular =
      /عليك[^م]|عليك$|عندك[^م]|ذكرت |\bلك\b|منك[^م]|ردك[^م]|أكلمك[^م]|معاك |حجزت |عبيته|يناسبك[^م]|يناسبك\.|اتصل علي على/;
    for (const step of ["new", "booked", "confirm"] as const) {
      const s = voiceScript(
        facts({ step, first_name: "هدى", call: booked().call }),
        "ar",
        { now: NOW },
      );
      expect(s.text).not.toMatch(singular);
      expect(s.text).toMatch(/عليكم|يناسبكم/);
    }
  });

  test("the unsure challenge has its subject: ذكرتوا إنكم مو متأكدين", () => {
    const s = voiceScript(facts({ challenge: "مو متأكد وين المشكلة" }), "ar", {
      now: NOW,
    });
    expect(s.text).toContain(
      "ذكرتوا إنكم مو متأكدين وين المشكلة بالضبط، وأبي أسمع منكم أكثر عن هالشي.",
    );
  });

  test("call-backs go to the number that rang them, never 'this number' (the rep's own phone)", () => {
    for (const lang of ["en", "ar"] as const)
      for (const step of ["new", "booked"] as const) {
        const s = voiceScript(facts({ step, call: booked().call }), lang, {
          now: NOW,
        });
        expect(s.text).not.toMatch(
          /this number|هالرقم|call me back|اتصل علي على/i,
        );
        expect(s.text).toMatch(
          /the number that just called you|الرقم اللي اتصل عليكم/,
        );
      }
  });

  test("every Arabic script keeps the voice rules: no em dash, no guillemets, no Latin digits, no طيب", () => {
    for (const step of ["new", "booked", "confirm"] as const)
      for (const challenge of [
        "ما يوصلنا عملاء كفاية",
        "يوصلنا عملاء بس أغلبهم غير جادّين أو بمشاريع غير مربحة.",
        "شهور قوية وشهور ميتة، ما في ثبات",
        "غير متأكد، ابيكم تشخصون",
        "يوصلنا عملاء بس نتعثّر في إغلاق الصفقات",
      ]) {
        const s = voiceScript(booked({ step, challenge }), "ar", { now: NOW });
        expect(s.text).not.toMatch(/[—–«»"]/);
        expect(s.text).not.toContain("طيب");
        expect(s.text).not.toContain("أنتظر");
        expect(LATIN_DIGIT.test(s.text.replace("Faisal", ""))).toBe(false);
      }
  });
});

describe("missing answers say nothing rather than inventing", () => {
  test("no name, no country, no challenge, no rep: still a whole note, with none of them", () => {
    const bare = facts({
      first_name: null,
      country: null,
      challenge: null,
      rep: { first_name: null, first_name_ar: null },
    });
    const en = voiceScript(bare, "en", { now: NOW });
    expect(en.text.split("\n")).toEqual([
      "Hi, this is Mahara Media.",
      "I saw your form come in and tried to call you.",
      "Call us back on the number that just called you when you get a minute, or reply here with a time that suits you.",
      "Speak soon.",
    ]);
    expect(en.used).toEqual([]);
    const ar = voiceScript(bare, "ar", { now: NOW });
    expect(ar.text.split("\n")).toEqual([
      "هلا، معاكم فريق مهارة ميديا.",
      "شفت الفورم اللي عبيتوه وحاولت أتصل عليكم.",
      "اتصلوا علينا على الرقم اللي اتصل عليكم إذا عندكم وقت، أو ردوا علي هني بوقت يناسبكم.",
      "أنطر ردكم.",
    ]);
  });

  test("the rep's own name stands in when sales-api sent none", () => {
    const s = voiceScript(
      facts({ rep: { first_name: null, first_name_ar: null } }),
      "en",
      { now: NOW, rep: "Ahmad Saleh" },
    );
    expect(s.text.split("\n")[0]).toBe(
      "Hi Faisal, it's Ahmad from Mahara Media.",
    );
  });

  test("a booking with no call time thanks them without a time", () => {
    const s = voiceScript(facts({ step: "booked", call: null }), "en", {
      now: NOW,
    });
    expect(s.text).toContain("Thanks for booking a call with us.");
    expect(s.text).toContain(
      "If now suits you, call us back on the number that just called you.",
    );
    expect(s.text).not.toMatch(/\d/);
    expect(s.used).not.toContain("call");
  });

  test("a challenge in words it cannot be sure of is left out, never pasted in", () => {
    const s = voiceScript(
      facts({ challenge: "عندنا مشكلة بالموظفين والتسويق" }),
      "en",
      { now: NOW },
    );
    expect(s.text).not.toContain("You mentioned");
    expect(s.used).not.toContain("challenge");
    expect(ARABIC.test(s.text)).toBe(false);
  });

  test("a company word in the name field is not a name to greet", () => {
    expect(greetName("شركة")).toBeNull();
    expect(greetName("Eng.")).toBeNull();
    expect(greetName("A")).toBeNull();
    expect(greetName("FAISAL")).toBe("Faisal");
    expect(greetName("عبدالله")).toBe("عبدالله");
    const s = voiceScript(facts({ first_name: "شركة" }), "ar", { now: NOW });
    expect(s.text.split("\n")[0]).toBe("هلا، معاكم سارة من مهارة ميديا.");
  });

  test("a country the Arabic script has no name for is left out in Arabic only", () => {
    expect(countryWords("Pakistan", "ar")).toBeNull();
    expect(countryWords("Pakistan", "en")).toBe("Pakistan");
    expect(countryWords("United Arab Emirates", "en")).toBe("the UAE");
    expect(countryWords("United Arab Emirates", "ar")).toBe("الإمارات");
    expect(countryWords("KW", "ar")).toBe("الكويت");
    expect(countryWords(null, "en")).toBeNull();
    const s = voiceScript(facts({ country: "Pakistan" }), "ar", { now: NOW });
    expect(s.text).toContain("شفت الفورم اللي عبيتوه وحاولت أتصل عليكم.");
  });

  test("the company is used when the form has it", () => {
    const s = voiceScript(facts({ company: "Harbi Interiors" }), "en", {
      now: NOW,
    });
    expect(s.text).toContain(
      "I saw your form come in for Harbi Interiors and tried to call you.",
    );
    expect(s.used).toContain("company");
  });
});

describe("the form's challenge answers", () => {
  test("each Arabic choice, and the English ones, read as one of five", () => {
    expect(challengeOf("ما يوصلنا عملاء كفاية")).toBe("enough");
    expect(
      challengeOf("يوصلنا عملاء بس أغلبهم غير جادّين أو بمشاريع غير مربحة."),
    ).toBe("serious");
    expect(challengeOf("العملاء اللي يوصلون مو جديين")).toBe("serious");
    expect(challengeOf("شهور قوية وشهور ميتة، ما في ثبات")).toBe("steady");
    expect(challengeOf("غير متأكد، ابيكم تشخصون")).toBe("unsure");
    expect(challengeOf("يوصلنا عملاء بس نتعثّر في إغلاق الصفقات")).toBe(
      "closing",
    );
    expect(challengeOf("ما نقدر نسكّر المشاريع")).toBe("closing");
    expect(challengeOf("Not getting enough clients")).toBe("enough");
    expect(challengeOf("")).toBeNull();
    expect(challengeOf(null)).toBeNull();
  });
});

describe("length, and what they told us", () => {
  test("every script runs 20 to 30 seconds with the facts in", () => {
    for (const lang of ["en", "ar"] as const)
      for (const step of ["new", "booked", "confirm"] as const) {
        const s = voiceScript(booked({ step }), lang, { now: NOW });
        expect(s.seconds).toBeGreaterThanOrEqual(VOICE_MIN_S - 6);
        expect(s.seconds).toBeLessThanOrEqual(VOICE_MAX_S);
      }
  });

  test("the ruler's words ask for a line out past 30 seconds", () => {
    expect(lengthWords(24)).toBe("About 24 s");
    expect(lengthWords(34)).toBe(
      "About 34 s. Leave a line out to keep it under 30.",
    );
  });

  test("up to five lines, the booked call first, a missing answer has no line", () => {
    const lines = toldUs(booked());
    expect(lines.map(l => l.key)).toEqual([
      "call",
      "country",
      "challenge",
      "revenue",
      "goal",
    ]);
    expect(lines[0]).toEqual({
      key: "call",
      label: "Intro booked",
      value: "Fri 6 Nov, 15:00 Kuwait",
    });
    const sparse = toldUs(
      facts({ revenue: null, goal: "  ", challenge: null, country: null }),
    );
    expect(sparse).toEqual([]);
    const theirs = toldUs(
      booked({
        call: {
          type: "demo",
          start_at: TOMORROW_3PM,
          kuwait: "Fri 6 Nov, 15:00",
          theirs: "16:00 their time",
        },
      }),
    );
    expect(theirs[0].label).toBe("Demo booked");
    expect(theirs[0].value).toBe("Fri 6 Nov, 15:00 Kuwait (16:00 their time)");
  });

  test("what the form did not say is named, not drawn as empty", () => {
    expect(notKnownLine(facts())).toBe(
      "Not known: company, what they do, projects signed in the last 12 months (the form does not ask).",
    );
    expect(notKnownLine(facts({ missing: [] }))).toBeNull();
    expect(notKnownLine(facts({ missing: ["language"] }))).toBeNull();
  });
});
