/**
 * The voice note the setter records on their own phone after a call nobody
 * answered (Aziz, 2026-11-05: "a personalized voice note from the setter's
 * phone and maybe give a guide with context on what they filled in on
 * their form"). Pure and deterministic, no AI: a 20 to 30 second script in
 * the lead's language built from sales-api's facts (dialer.ts voiceFacts),
 * one breath per line, and the few lines of "what they told us" beside it.
 *
 * Rules the script keeps:
 * - An answer that is missing, or one this file cannot read with certainty
 *   (free text in another language, a company word in the name field), is
 *   left out. Nothing is guessed.
 * - No promise of results (the legal rule: never a results guarantee). The
 *   note says who is calling, why, and how to call back.
 * - Arabic is spoken Kuwaiti under mahara-context/skills/aziz-kuwaiti-voice:
 *   no em dash (".." for a pause), no guillemets, Arabic-Indic digits,
 *   تمام not طيب, أنطر not أنتظر, ليلحين not لا يزال, ابجر for early, جم for
 *   "a few". The opening matches the approved WhatsApp snippets ("هلا
 *   {name}، معاك {rep} من مهارة ميديا").
 */

import type { VoiceNote } from "./dialer";
import { callWords } from "./whatsapp";

export type VoiceLang = "ar" | "en";

/** Which of the form's facts a part of a line came from (underlined on screen). */
export type FactKey =
  | "first_name"
  | "company"
  | "country"
  | "challenge"
  | "call";

export interface ScriptPart {
  text: string;
  fact?: FactKey;
}

export type ScriptLine = ScriptPart[];

export interface VoiceScript {
  lang: VoiceLang;
  /** One breath per line, in the order they are said. */
  lines: ScriptLine[];
  /** The script as plain text, a line per breath, for Copy script. */
  text: string;
  words: number;
  /** About how long it takes to say, in whole seconds. */
  seconds: number;
  /** The form's facts the script used. */
  used: FactKey[];
}

/** The note should run 20 to 30 seconds (Aziz's brief). */
export const VOICE_MIN_S = 20;
export const VOICE_MAX_S = 30;

// ---------------------------------------------------------------------------
// The facts, read carefully
// ---------------------------------------------------------------------------

/** Words that sit in a name field but are not a name to greet someone by. */
const NOT_A_NAME =
  /^(شركة|شركه|مؤسسة|مؤسسه|مكتب|مجموعة|مجموعه|مصنع|company|co|est|group|the|mr|mrs|ms|dr|eng|م|د|أ|ا)\.?$/i;

/** The first name to greet with, or null when the field holds no usable name. */
export function greetName(first: string | null | undefined): string | null {
  const s = String(first ?? "").trim();
  if (s.length < 2 || /\d/.test(s) || NOT_A_NAME.test(s)) return null;
  // A name typed in capitals reads as a shout in a script.
  if (/^[A-Z]{2,}$/.test(s)) return s[0] + s.slice(1).toLowerCase();
  return s;
}

const COUNTRY_AR: Record<string, string> = {
  kuwait: "الكويت",
  "saudi arabia": "السعودية",
  "united arab emirates": "الإمارات",
  uae: "الإمارات",
  "the uae": "الإمارات",
  qatar: "قطر",
  bahrain: "البحرين",
  oman: "عُمان",
  egypt: "مصر",
  jordan: "الأردن",
  iraq: "العراق",
  lebanon: "لبنان",
};

const COUNTRY_CODE: Record<string, string> = {
  KW: "Kuwait",
  SA: "Saudi Arabia",
  AE: "United Arab Emirates",
  QA: "Qatar",
  BH: "Bahrain",
  OM: "Oman",
};

/**
 * The lead's country as the script says it: "the UAE" in English, the
 * Arabic name in Arabic, or null when there is no country or (in Arabic)
 * no name this file knows for it.
 */
export function countryWords(
  country: string | null | undefined,
  lang: VoiceLang,
): string | null {
  let c = String(country ?? "").trim();
  if (!c) return null;
  if (/^[a-z]{2}$/i.test(c)) c = COUNTRY_CODE[c.toUpperCase()] ?? "";
  if (!c) return null;
  if (lang === "ar") {
    if (/[؀-ۿ]/.test(c)) return c;
    return COUNTRY_AR[c.toLowerCase()] ?? null;
  }
  if (/[؀-ۿ]/.test(c)) return null;
  return /^united arab emirates$/i.test(c) ? "the UAE" : c;
}

/** The form's challenge answers this file can say in either language. */
export type Challenge = "enough" | "serious" | "steady" | "unsure" | "closing";

/**
 * Which of the form's challenge answers this is (the Arabic form's choices,
 * and their English counterparts), or null for anything else: free text is
 * never put into a script, since it may not read as spoken words.
 */
export function challengeOf(text: string | null | undefined): Challenge | null {
  const s = String(text ?? "").trim();
  if (!s) return null;
  if (/غير\s*متأكد|مو\s*متأكد|تشخص|not\s+sure|diagnos/i.test(s))
    return "unsure";
  if (/غير\s*جاد|مو\s*جد|مو\s*جاد|not\s+serious|time[- ]?wasters?/i.test(s))
    return "serious";
  if (
    /شهور\s*قوية|شهور\s*ميتة|ثبات|consisten|feast|famine|up\s+and\s+down/i.test(
      s,
    )
  )
    return "steady";
  if (/إغلاق|اغلاق|نسك|تسكير|نتعثّ?ر|clos(e|ing)/i.test(s)) return "closing";
  if (
    /عملاء\s*كفاية|ما\s*يوصلنا|not\s+(getting\s+)?enough|more\s+(clients|leads)/i.test(
      s,
    )
  )
    return "enough";
  return null;
}

const CHALLENGE_WORDS: Record<Challenge, Record<VoiceLang, string>> = {
  enough: {
    en: "you're not getting enough clients",
    ar: "ما يوصلكم عملاء كفاية",
  },
  serious: {
    en: "most of the enquiries you get aren't serious",
    ar: "أغلب العملاء اللي يوصلونكم مو جديين",
  },
  steady: {
    en: "some months are busy and others go quiet",
    ar: "عندكم شهور قوية وشهور ميتة",
  },
  unsure: {
    en: "you're not sure yet where things get stuck",
    ar: "مو متأكدين وين المشكلة بالضبط",
  },
  closing: {
    en: "enquiries come in but they're hard to close",
    ar: "يوصلكم عملاء بس التسكير صعب",
  },
};

/**
 * "That" before the challenge in Arabic (ذكرتوا إن ...): with the plural
 * subject spelled out where the phrase has none of its own (إنكم مو متأكدين).
 */
const AR_THAT: Record<Challenge, string> = {
  enough: "إن ",
  serious: "إن ",
  steady: "إن ",
  unsure: "إنكم ",
  closing: "إن ",
};

/** The booked call's day and time as the lead hears them, on their own clock. */
function callTime(
  call: VoiceNote["call"],
  lang: VoiceLang,
  now: number,
  clock: string | number | null | undefined,
): { day: string; time: string; yours: boolean } | null {
  if (!call?.start_at || !Number.isFinite(Date.parse(call.start_at)))
    return null;
  const theirs = callWords(call.start_at, lang, now, clock ?? 3);
  const kuwait = callWords(call.start_at, lang, now, 3);
  // "your time" only when their clock reads differently from Kuwait's.
  const yours = theirs.time !== kuwait.time || theirs.day !== kuwait.day;
  return { ...theirs, yours };
}

// ---------------------------------------------------------------------------
// The script
// ---------------------------------------------------------------------------

const t = (text: string, fact?: FactKey): ScriptPart =>
  fact ? { text, fact } : { text };

/** Words per second when spoken calmly: English, and Arabic's longer words. */
const PACE: Record<VoiceLang, number> = { en: 2.5, ar: 2.1 };

function wordCount(s: string): number {
  return s.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
}

export function voiceScript(
  facts: VoiceNote,
  lang: VoiceLang,
  o: {
    now: number;
    /** The lead's clock (leadClock.ts leadClock), for the call's time. */
    clock?: string | number | null;
    /** The rep's first name when sales-api sent none. */
    rep?: string | null;
  },
): VoiceScript {
  const name = greetName(facts.first_name);
  const rep =
    greetName(
      lang === "ar"
        ? (facts.rep?.first_name_ar ?? facts.rep?.first_name)
        : facts.rep?.first_name,
    ) ?? greetName(String(o.rep ?? "").split(/\s+/)[0]);
  const company = String(facts.company ?? "").trim() || null;
  const country = countryWords(facts.country, lang);
  const challenge = challengeOf(facts.challenge);
  const call = callTime(facts.call, lang, o.now, o.clock);
  const lines: ScriptLine[] =
    lang === "ar"
      ? arabic(facts.step, { name, rep, company, country, challenge, call })
      : english(facts.step, { name, rep, company, country, challenge, call });
  const text = lines.map(l => l.map(p => p.text).join("")).join("\n");
  const words = wordCount(text);
  const used = [
    ...new Set(lines.flatMap(l => l.flatMap(p => (p.fact ? [p.fact] : [])))),
  ];
  return {
    lang,
    lines,
    text,
    words,
    seconds: Math.round(words / PACE[lang] + lines.length * 0.4),
    used,
  };
}

interface Bits {
  name: string | null;
  rep: string | null;
  company: string | null;
  country: string | null;
  challenge: Challenge | null;
  call: { day: string; time: string; yours: boolean } | null;
}

function english(step: VoiceNote["step"], b: Bits): ScriptLine[] {
  const hi: ScriptLine = [
    t("Hi"),
    ...(b.name ? [t(" "), t(b.name, "first_name")] : []),
    t(b.rep ? `, it's ${b.rep} from Mahara Media.` : ", this is Mahara Media."),
  ];
  // "tomorrow at 3 pm", "Monday at 3 pm your time"; `at` says "on Monday"
  // where the sentence needs it ("our call on Monday"), `bare` after "for".
  const bare = b.call
    ? `${b.call.day} at ${b.call.time}${b.call.yours ? " your time" : ""}`
    : null;
  const at =
    b.call && bare
      ? `${/^(today|tomorrow)$/.test(b.call.day) ? "" : "on "}${bare}`
      : null;
  const challenge = b.challenge ? CHALLENGE_WORDS[b.challenge].en : null;
  if (step === "confirm")
    return [
      hi,
      at
        ? [t("Just a quick one about our call "), t(at, "call"), t(".")]
        : [t("Just a quick one about our call.")],
      [t("I tried calling to check the time still works for you.")],
      [
        t(
          "Could you reply with a quick yes? If it doesn't suit you anymore, tell me and I'll find another time.",
        ),
      ],
      [t("Speak soon.")],
    ];
  if (step === "booked")
    return [
      hi,
      bare
        ? [t("Thanks for booking a call with us for "), t(bare, "call"), t(".")]
        : [t("Thanks for booking a call with us.")],
      [t("I tried calling now in case you're free to talk earlier.")],
      ...(challenge
        ? [
            [
              t("You mentioned "),
              t(challenge, "challenge"),
              t(", so I've got a few questions ready for you."),
            ],
          ]
        : []),
      // Call-backs go to the line that rang them (Maqsam), never the rep's
      // own phone the note is sent from: a call there is not seen (review).
      at
        ? [
            t(
              "If now suits you, call us back on the number that just called you. If not, speak to you ",
            ),
            t(at, "call"),
            t("."),
          ]
        : [
            t(
              "If now suits you, call us back on the number that just called you.",
            ),
          ],
    ];
  return [
    hi,
    b.company
      ? [
          t("I saw your form come in for "),
          t(b.company, "company"),
          t(" and tried to call you."),
        ]
      : b.country
        ? [
            t("I saw your form come in from "),
            t(b.country, "country"),
            t(" and tried to call you."),
          ]
        : [t("I saw your form come in and tried to call you.")],
    ...(challenge
      ? [
          [
            t("You mentioned "),
            t(challenge, "challenge"),
            t(", and I'd like to hear a bit more about that."),
          ],
        ]
      : []),
    [
      t(
        "Call us back on the number that just called you when you get a minute, or reply here with a time that suits you.",
      ),
    ],
    [t("Speak soon.")],
  ];
}

/**
 * The Arabic script speaks to the lead in the plural throughout (عليكم،
 * عندكم، ردكم): polite and the same for a man or a woman, since the form
 * gives no gender (2026-11-06 review). Call-backs go to the number that
 * rang them, the tracked line, not the rep's own phone.
 */
function arabic(step: VoiceNote["step"], b: Bits): ScriptLine[] {
  const hi: ScriptLine = [
    t("هلا"),
    ...(b.name ? [t(" "), t(b.name, "first_name")] : []),
    t(b.rep ? `، معاكم ${b.rep} من مهارة ميديا.` : "، معاكم فريق مهارة ميديا."),
  ];
  // "باجر الساعة ٣ العصر", "يوم الاثنين الساعة ٣ العصر بتوقيتكم".
  const at = b.call
    ? `${b.call.day} الساعة ${b.call.time}${b.call.yours ? " بتوقيتكم" : ""}`
    : null;
  const challenge = b.challenge ? CHALLENGE_WORDS[b.challenge].ar : null;
  const that = b.challenge ? AR_THAT[b.challenge] : "إن ";
  if (step === "confirm")
    return [
      hi,
      at
        ? [t("بس حبيت أتأكد من مكالمتنا "), t(at, "call"), t(".")]
        : [t("بس حبيت أتأكد من مكالمتنا.")],
      [t("حاولت أتصل عليكم أشوف إذا الوقت ليلحين يناسبكم.")],
      [t("ردوا علي بس بتمام إذا يناسبكم، وإذا لا.. قولوا لي ونغيره.")],
      [t("أنطر ردكم.")],
    ];
  if (step === "booked")
    return [
      hi,
      at
        ? [t("شكراً إنكم حجزتوا مكالمة معانا "), t(at, "call"), t(".")]
        : [t("شكراً إنكم حجزتوا مكالمة معانا.")],
      [t("حاولت أتصل عليكم الحين.. إذا عندكم وقت نقدر نتكلم ابجر.")],
      ...(challenge
        ? [
            [
              t(`ذكرتوا ${that}`),
              t(challenge, "challenge"),
              t("، وعندي جم سؤال لكم."),
            ],
          ]
        : []),
      at
        ? [
            t(
              "إذا الحين يناسبكم اتصلوا علينا على الرقم اللي اتصل عليكم، وإذا لا.. أكلمكم ",
            ),
            t(at, "call"),
            t("."),
          ]
        : [t("إذا الحين يناسبكم اتصلوا علينا على الرقم اللي اتصل عليكم.")],
    ];
  return [
    hi,
    b.company
      ? [
          t("شفت الفورم اللي عبيتوه عن "),
          t(b.company, "company"),
          t(" وحاولت أتصل عليكم."),
        ]
      : b.country
        ? [
            t("شفت الفورم اللي عبيتوه من "),
            t(b.country, "country"),
            t(" وحاولت أتصل عليكم."),
          ]
        : [t("شفت الفورم اللي عبيتوه وحاولت أتصل عليكم.")],
    ...(challenge
      ? [
          [
            t(`ذكرتوا ${that}`),
            t(challenge, "challenge"),
            t("، وأبي أسمع منكم أكثر عن هالشي."),
          ],
        ]
      : []),
    [
      t(
        "اتصلوا علينا على الرقم اللي اتصل عليكم إذا عندكم وقت، أو ردوا علي هني بوقت يناسبكم.",
      ),
    ],
    [t("أنطر ردكم.")],
  ];
}

// ---------------------------------------------------------------------------
// What they told us: the few lines beside the script
// ---------------------------------------------------------------------------

export interface ToldLine {
  key:
    | "call"
    | "company"
    | "country"
    | "services"
    | "challenge"
    | "revenue"
    | "goal";
  label: string;
  value: string;
}

/**
 * Up to five lines from their form, in the order a note uses them: the
 * booked call, company, where they are, what they do, their challenge,
 * revenue and goal. A missing answer has no line.
 */
export function toldUs(facts: VoiceNote, max = 5): ToldLine[] {
  const s = (v: unknown) => {
    const x = String(v ?? "").trim();
    return x ? x : null;
  };
  const call = facts.call;
  const out: (ToldLine | null)[] = [
    call?.kuwait
      ? {
          key: "call",
          label: call.type === "demo" ? "Demo booked" : "Intro booked",
          value: `${call.kuwait} Kuwait${call.theirs ? ` (${call.theirs})` : ""}`,
        }
      : null,
    s(facts.company)
      ? { key: "company", label: "Company", value: String(s(facts.company)) }
      : null,
    s(facts.country)
      ? { key: "country", label: "Based in", value: String(s(facts.country)) }
      : null,
    s(facts.services)
      ? {
          key: "services",
          label: "What they do",
          value: String(s(facts.services)),
        }
      : null,
    s(facts.challenge)
      ? {
          key: "challenge",
          label: "Their challenge",
          value: String(s(facts.challenge)),
        }
      : null,
    s(facts.revenue)
      ? { key: "revenue", label: "Revenue", value: String(s(facts.revenue)) }
      : null,
    s(facts.goal)
      ? { key: "goal", label: "Revenue goal", value: String(s(facts.goal)) }
      : null,
  ];
  return out.filter((l): l is ToldLine => l !== null).slice(0, max);
}

/** The line under the facts: what the form did not tell us, or null. */
export function notKnownLine(facts: VoiceNote): string | null {
  const gaps = (facts.missing ?? []).filter(
    m => m && m !== "language" && m !== "their name",
  );
  return gaps.length ? `Not known: ${gaps.join(", ")}.` : null;
}

/** The ruler's words: how long the note runs against 20 to 30 seconds. */
export function lengthWords(seconds: number): string {
  if (seconds > VOICE_MAX_S)
    return `About ${seconds} s. Leave a line out to keep it under ${VOICE_MAX_S}.`;
  return `About ${seconds} s`;
}
