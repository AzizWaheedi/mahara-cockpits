import type { L, Lang } from "./content";

/**
 * The example call on the launch deck's slide 6 (docs/csm-decks/
 * EXAMPLE-CALL.md, CONTENT.md Appendix A, DESIGN.md section 11). A written
 * booking call, never a recording: the customer, Abu Fahad, is fictional,
 * and the caller is never named. Built from the dialer's booking script,
 * sections 01 to 06, with this client's details in the slots.
 *
 * Two dialects (Kuwaiti, the script's own, and Saudi), three pain variants
 * (delays, design, cost) that change four lines, and the budget band by
 * country and scale. The words are copied from EXAMPLE-CALL.md; this file
 * does not write new ones. Its copy rules are pinned by
 * scripts/deck-call.test.ts: no "instantly" or "same day", no results
 * promise, no guarantee, no leads, never مقاول, no em dash, no exclamation
 * mark. Unlike the slides,
 * the call speaks a dialect and names the fictional customer's budget band
 * on purpose.
 */

export type Dialect = "kw" | "sa";
export type Pain = "delays" | "design" | "cost";
export type Speaker = "agent" | "lead";

export interface Turn {
  /** The call clock when the turn starts (m:ss, Latin digits, DESIGN 13.4). */
  at: string;
  who: Speaker;
  /** The stage, 1 to 6. */
  stage: number;
  kw: string;
  sa: string;
  en: string;
  /** The four lines the pain variants change (the default is delays). */
  pain?: Partial<
    Record<Exclude<Pain, "delays">, { kw: string; sa: string; en: string }>
  >;
  /** Left out when the client has no Instagram handle. */
  needs?: "instagram";
}

/** The call, Kuwaiti and Saudi side by side, with its English subtitles. */
export const TURNS: Turn[] = [
  {
    at: "0:00",
    who: "agent",
    stage: 1,
    kw: "السلام عليكم، معاي أبو فهد؟",
    sa: "السلام عليكم، معي أبو فهد؟",
    en: "Assalamu alaikum. Am I speaking with Abu Fahad?",
  },
  {
    at: "0:04",
    who: "lead",
    stage: 1,
    kw: "وعليكم السلام، إي نعم، أنا أبو فهد.",
    sa: "وعليكم السلام، إيه نعم، أبو فهد معك.",
    en: "Yes, speaking.",
  },
  {
    at: "0:08",
    who: "agent",
    stage: 1,
    kw: "ياهلا والله. معاك قسم المواعيد في [اسم الشركة]، شلونك اليوم؟",
    sa: "هلا والله. معك قسم المواعيد في [اسم الشركة]، كيف حالك اليوم؟",
    en: "Hello, this is the appointments team at {Company}. How are you today?",
  },
  {
    at: "0:13",
    who: "lead",
    stage: 1,
    kw: "الحمد لله، بخير.",
    sa: "الحمد لله، بخير.",
    en: "Good, thank God.",
  },
  {
    at: "0:17",
    who: "agent",
    stage: 1,
    kw: "شفت استفسارك اللي عبّيته بخصوص [اسم الخدمة].",
    sa: "شفت استفسارك اللي عبّيته بخصوص [اسم الخدمة].",
    en: "I saw the enquiry you sent us about {service}.",
  },
  {
    at: "0:24",
    who: "agent",
    stage: 1,
    kw: "وكنت حابة أعطيك فكرة سريعة.. مناسب معاك الحين؟",
    sa: "وحبيت أعطيك فكرة سريعة، يناسبك الوقت الحين؟",
    en: "I wanted to give you a quick idea. Is now a good time?",
  },
  {
    at: "0:30",
    who: "lead",
    stage: 1,
    kw: "إي، تفضلي.",
    sa: "إيه، تفضلي.",
    en: "Yes, go ahead.",
  },
  {
    at: "0:34",
    who: "agent",
    stage: 2,
    kw: "ممتاز. عشان أقدر أساعدك بأفضل طريقة، ودي أفهم شنو ببالك.",
    sa: "ممتاز. عشان أقدر أخدمك بأفضل طريقة، ودّي أفهم وش في بالك.",
    en: "So I can help you properly, I'd like to understand what you have in mind.",
  },
  {
    at: "0:41",
    who: "agent",
    stage: 2,
    kw: "شنو أهم شي تتطلع تحققه في [المشروع]؟",
    sa: "وش أهم شي تبي توصل له في [المشروع]؟",
    en: "What matters most to you in {project}?",
  },
  {
    at: "0:49",
    who: "lead",
    stage: 2,
    kw: "إن الشغل هالمرة يطلع صح.. وإنه يكون على ذوقنا.",
    sa: "إن الشغل هالمرة يطلع صح، وإنه يكون على ذوقنا.",
    en: "That it's done right this time, and that it's to our taste.",
  },
  {
    at: "1:00",
    who: "agent",
    stage: 2,
    kw: "وشنو الشي اللي بيخليك تقول إن المشروع نجح؟",
    sa: "ووش الشي اللي يخليك تقول إن المشروع نجح؟",
    en: "And what would make you say the project was a success?",
  },
  {
    at: "1:09",
    who: "lead",
    stage: 2,
    kw: "إنه يخلص بوقته، وما تطلع لنا مفاجآت بالتكلفة.",
    sa: "إنه يخلص في وقته، وما تطلع لنا مفاجآت في التكلفة.",
    en: "Finished on time, with no surprises on the cost.",
  },
  {
    at: "1:21",
    who: "agent",
    stage: 3,
    kw: "كلامك منطقي. ومن متى وانت تخطط لهالمشروع؟",
    sa: "كلامك منطقي. ومن متى وأنت تخطط للمشروع؟",
    en: "That makes sense. How long have you been planning it?",
  },
  {
    at: "1:27",
    who: "lead",
    stage: 3,
    kw: "تقريباً ست شهور.. ونبي نبدي قريب.",
    sa: "تقريباً ست شهور، وودّنا نبدي قريب.",
    en: "About six months. We'd like to start soon.",
  },
  {
    at: "1:37",
    who: "agent",
    stage: 3,
    kw: "واشتغلت مع شركة تصميم أو تنفيذ قبل، ولا هذي أول مرة؟",
    sa: "وقد تعاملت مع شركة تصميم أو تنفيذ قبل، ولا هذي أول مرة؟",
    en: "Have you worked with a design or build company before, or is this the first time?",
  },
  {
    at: "1:46",
    who: "lead",
    stage: 3,
    kw: "مرة وحدة، قبل سنتين. وتأخروا علينا أربع شهور.",
    sa: "مرة وحدة، قبل سنتين، وتأخروا علينا أربعة شهور.",
    en: "Once, two years ago. They finished four months late.",
    pain: {
      design: {
        kw: "مرة وحدة، قبل سنتين. واللي نفذوه ما كان نفس المخططات.",
        sa: "مرة وحدة، قبل سنتين، واللي نفذوه ما كان نفس المخططات.",
        en: "Once, two years ago. What they built didn't look like the drawings.",
      },
      cost: {
        kw: "مرة وحدة، قبل سنتين. والفاتورة بالأخير طلعت أكثر بوايد من عرض السعر.",
        sa: "مرة وحدة، قبل سنتين، والفاتورة في الأخير طلعت أكثر بكثير من عرض السعر.",
        en: "Once, two years ago. The final bill came in far above the quote.",
      },
    },
  },
  {
    at: "1:57",
    who: "agent",
    stage: 3,
    kw: "ووين كانت المشكلة بالضبط؟ بالتصميم، ولا بالتنفيذ، ولا بعد التسليم؟",
    sa: "ووين كانت المشكلة بالضبط؟ في التصميم، ولا التنفيذ، ولا بعد التسليم؟",
    en: "Where did it go wrong: the design, the work itself, or after handover?",
  },
  {
    at: "2:05",
    who: "lead",
    stage: 3,
    kw: "بالتنفيذ. ما كنا نعرف شنو قاعد يصير بالموقع.",
    sa: "في التنفيذ. ما كنا ندري وش اللي يصير في الموقع.",
    en: "During the work. We never knew what was happening on site.",
    pain: {
      design: {
        kw: "بالتصميم. وافقنا على شي، وطلع لنا شي ثاني.",
        sa: "في التصميم. وافقنا على شي، وطلع لنا شي ثاني.",
        en: "In the design. We approved one thing and got another.",
      },
      cost: {
        kw: "بالتنفيذ. كل أسبوع تطلع لنا تكلفة زيادة.",
        sa: "في التنفيذ. كل أسبوع تطلع لنا تكلفة زيادة.",
        en: "During the work. Every week there was a new extra cost.",
      },
    },
  },
  {
    at: "2:17",
    who: "agent",
    stage: 3,
    kw: "يعني هالمرة تبي تكون عارف وين وصل الشغل، خطوة بخطوة.",
    sa: "يعني هالمرة تبي تكون عارف وين وصل الشغل، خطوة بخطوة.",
    en: "So this time you want to know where things stand, step by step.",
    pain: {
      design: {
        kw: "يعني هالمرة تبي اللي توافق عليه بالمخطط، هو نفسه اللي يتنفذ.",
        sa: "يعني هالمرة تبي اللي توافق عليه في المخطط، هو نفسه اللي يتنفذ.",
        en: "So this time you want what you approve on paper to be what gets built.",
      },
      cost: {
        kw: "يعني هالمرة تبي سعر واضح من البداية، وبدون مفاجآت.",
        sa: "يعني هالمرة تبي سعر واضح من البداية، وبدون مفاجآت.",
        en: "So this time you want a clear price before you start, and no surprises.",
      },
    },
  },
  {
    at: "2:24",
    who: "lead",
    stage: 3,
    kw: "بالضبط.",
    sa: "بالضبط.",
    en: "Exactly.",
  },
  {
    at: "2:30",
    who: "agent",
    stage: 3,
    kw: "وبخصوص الميزانية، عندك فكرة تقريبية عن المبلغ؟",
    sa: "وبالنسبة للميزانية، عندك فكرة تقريبية عن المبلغ؟",
    en: "And on budget, do you have a rough figure in mind?",
  },
  {
    at: "2:37",
    who: "lead",
    stage: 3,
    kw: "بصراحة.. ودي أعرف جم بيكلف أول.",
    sa: "بصراحة، ودّي أعرف كم بيكلف أول.",
    en: "Honestly, I'd like to know what it costs first.",
  },
  {
    at: "2:44",
    who: "agent",
    stage: 3,
    kw: "سؤالك في محله. السعر يعتمد على التفاصيل والمواد والمساحة.",
    sa: "سؤال في محله. السعر يعتمد على التفاصيل والمواد والمساحة.",
    en: "Fair question. The price depends on the details, the materials and the space.",
  },
  {
    at: "2:51",
    who: "agent",
    stage: 3,
    kw: "وعشان جذي تجلس مع [اسم المهندس]، وتاخذ عرض سعر دقيق، مو تخمين بالتلفون.",
    sa: "وعشان كذا تجلس مع [اسم المهندس]، وتاخذ عرض سعر دقيق بدل ما يكون تخمين على الجوال.",
    en: "That's why you sit with {engineer}: you get an accurate quote, not a guess over the phone.",
  },
  {
    at: "2:59",
    who: "agent",
    stage: 3,
    kw: "بس تقريباً، الميزانية [الميزانية]؟",
    sa: "بس تقريباً، الميزانية [الميزانية]؟",
    en: "Roughly, are you thinking {band}?",
  },
  {
    at: "3:08",
    who: "lead",
    stage: 3,
    kw: "[جواب الميزانية]",
    sa: "[جواب الميزانية]",
    en: "{band.answer}",
  },
  {
    at: "3:16",
    who: "agent",
    stage: 4,
    kw: "وصلت الصورة كاملة. تبي [المشروع] يطلع صح، وبوقته، وتكون عارف وين وصل الشغل أول بأول.",
    sa: "وصلت الصورة كاملة. تبي [المشروع] يطلع صح وفي وقته، وتكون عارف وين وصل الشغل أول بأول.",
    en: "I have the full picture. You want {project} done right, on time, and to know where things stand.",
    pain: {
      design: {
        kw: "وصلت الصورة كاملة. تبي [المشروع] يطلع صح، ونفس اللي وافقت عليه.",
        sa: "وصلت الصورة كاملة. تبي [المشروع] يطلع صح، ونفس اللي وافقت عليه.",
        en: "I have the full picture. You want {project} done right, and built the way you approved it.",
      },
      cost: {
        kw: "وصلت الصورة كاملة. تبي [المشروع] يطلع صح، بسعر واضح وبدون مفاجآت.",
        sa: "وصلت الصورة كاملة. تبي [المشروع] يطلع صح، بسعر واضح وبدون مفاجآت.",
        en: "I have the full picture. You want {project} done right, with a clear price and no surprises.",
      },
    },
  },
  {
    at: "3:25",
    who: "agent",
    stage: 4,
    kw: "وإحنا في [اسم الشركة]، [اللي يميزكم].",
    sa: "وإحنا في [اسم الشركة]، [اللي يميزكم].",
    en: "At {Company}, {selling point}.",
  },
  {
    at: "3:35",
    who: "lead",
    stage: 4,
    kw: "هذا بالضبط اللي أبيه.",
    sa: "هذا بالضبط اللي أبيه.",
    en: "That's exactly what I need.",
  },
  {
    at: "3:41",
    who: "agent",
    stage: 5,
    kw: "ودي أعرفك على [اسم المهندس]، عشان تمرون على [المشروع] بالتفصيل. شرايك نحجز لك [نوع الاستشارة]؟",
    sa: "ودّي أعرّفك على [اسم المهندس]، عشان تمرون على [المشروع] بالتفصيل. وش رأيك نحجز لك [نوع الاستشارة]؟",
    en: "I'd like you to meet {engineer}, to go through {project} in detail. Shall we book you {free}?",
  },
  {
    at: "3:54",
    who: "lead",
    stage: 5,
    kw: "إي، خلنا نحجز.",
    sa: "إيه، خلنا نحجز.",
    en: "Yes, let's do it.",
  },
  {
    at: "3:57",
    who: "agent",
    stage: 5,
    kw: "ممتاز. عندنا مجال يوم [اليوم]، الصبح أو العصر.. أي وقت أنسب لك؟",
    sa: "أبشر. عندنا مجال يوم [اليوم]، الصبح أو العصر، أي وقت يناسبك أكثر؟",
    en: "We have {day}, morning or afternoon. Which suits you?",
  },
  {
    at: "4:04",
    who: "lead",
    stage: 5,
    kw: "العصر أحسن.",
    sa: "العصر أفضل.",
    en: "Afternoon.",
  },
  {
    at: "4:07",
    who: "agent",
    stage: 5,
    kw: "خلاص، تم: يوم [اليوم] الساعة [الوقت]، [المكان]. وبس للتأكيد، متأكد إنك تقدر تحضر؟ ماكو شي ممكن يمنعك؟",
    sa: "تم: يوم [اليوم] الساعة [الوقت]، [المكان]. وبس للتأكيد، متأكد إنك تقدر تحضر؟ ما فيه شي ممكن يمنعك؟",
    en: "Done: {day} at {time}, {place}. Just to be sure, can you definitely make it? Nothing that might stop you?",
  },
  {
    at: "4:23",
    who: "lead",
    stage: 5,
    kw: "لا، إن شاء الله بكون موجود.",
    sa: "لا، إن شاء الله بكون موجود.",
    en: "No, I'll be there.",
  },
  {
    at: "4:29",
    who: "agent",
    stage: 6,
    kw: "تمام، موعدك تأكد يوم [اليوم] الساعة [الوقت]، وبتوصلك رسالة على الواتساب فيها كل التفاصيل.",
    sa: "تمام، موعدك تأكد يوم [اليوم] الساعة [الوقت]، وبتوصلك رسالة على الواتساب فيها كل التفاصيل.",
    en: "Your appointment is confirmed for {day} at {time}. You'll get a WhatsApp with all the details.",
  },
  {
    at: "4:35",
    who: "agent",
    stage: 6,
    kw: "وقبل الموعد، تقدر تاخذ فكرة عن مشاريعنا على حسابنا بإنستقرام: [حساب إنستقرام].",
    sa: "وقبل الموعد، تقدر تشوف شي من مشاريعنا على حسابنا في إنستقرام: [حساب إنستقرام].",
    en: "Before then, have a look at our projects on Instagram: {instagram}.",
    needs: "instagram",
  },
  {
    at: "4:40",
    who: "lead",
    stage: 6,
    kw: "أكيد، بشوفه. مشكورة.",
    sa: "أكيد، بشوفه. يعطيك العافية.",
    en: "I will. Thank you.",
  },
  {
    at: "4:46",
    who: "agent",
    stage: 6,
    kw: "مشكور أبو فهد، وننتظرك إن شاء الله.",
    sa: "الله يعافيك يا أبو فهد، وحياك الله، ننتظرك.",
    en: "Thank you, Abu Fahad. We look forward to seeing you.",
  },
];

/** Where the clock stops: "Call ends" at 4:51 (paced on the 291 s median, never printed). */
export const CALL_END = "4:51";

// ---------------------------------------------------------------- slots

/** The slots, as the dialer's Arabic tokens and CONTENT's English ones. */
export type SlotKey =
  | "company"
  | "service"
  | "project"
  | "engineer"
  | "free"
  | "place"
  | "selling"
  | "instagram"
  | "day"
  | "time"
  | "band"
  | "bandAnswer";

export const AR_TOKENS: Record<string, SlotKey> = {
  "اسم الشركة": "company",
  "اسم الخدمة": "service",
  المشروع: "project",
  "اسم المهندس": "engineer",
  "نوع الاستشارة": "free",
  المكان: "place",
  "اللي يميزكم": "selling",
  "حساب إنستقرام": "instagram",
  اليوم: "day",
  الوقت: "time",
  الميزانية: "band",
  "جواب الميزانية": "bandAnswer",
};

export const EN_TOKENS: Record<string, SlotKey> = {
  Company: "company",
  service: "service",
  project: "project",
  engineer: "engineer",
  free: "free",
  place: "place",
  "selling point": "selling",
  instagram: "instagram",
  day: "day",
  time: "time",
  band: "band",
  "band.answer": "bandAnswer",
};

/**
 * One slot's value in the line's own language. `given` is false when the
 * value is a fallback: the line still reads (`text`), and when `ask` is set
 * a dashed "To give us" chip shows beside it (CONTENT Appendix A).
 */
export interface SlotValue {
  text: string | null;
  given: boolean;
  ask: L | null;
}

export type Slots = Record<SlotKey, { ar: SlotValue; en: SlotValue }>;

export const TO_GIVE: L = { en: "To give us", ar: "نحتاجه منكم" };
export const ASK = {
  service: {
    en: "the service we're advertising",
    ar: "الخدمة اللي نعلن عنها",
  },
  engineer: {
    en: "who holds the consultation?",
    ar: "مين يسوي الاستشارة؟",
  },
  free: { en: "is the first consultation free?", ar: "أول استشارة مجانية؟" },
  place: {
    en: "where you hold consultations",
    ar: "وين تسوون الاستشارات؟",
  },
  selling: {
    en: "what makes you different, in one line",
    ar: "اللي يميزكم، بسطر واحد",
  },
} as const;

/** A line cut into its words and its slots, for drawing (teal or a chip). */
export type Piece = { text: string } | { slot: SlotKey };

export function pieces(line: string, lang: Lang): Piece[] {
  const re = lang === "ar" ? /\[([^\]]+)\]/g : /\{([^}]+)\}/g;
  const map = lang === "ar" ? AR_TOKENS : EN_TOKENS;
  const out: Piece[] = [];
  let last = 0;
  for (const m of line.matchAll(re)) {
    const key = map[m[1]];
    if (!key) continue;
    if (m.index > last) out.push({ text: line.slice(last, m.index) });
    out.push({ slot: key });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out;
}

/** The line as plain text, slots filled (fallbacks and chips as words). */
export function plain(line: string, lang: Lang, slots: Slots): string {
  return pieces(line, lang)
    .map(p => {
      if ("text" in p) return p.text;
      const v = slots[p.slot][lang];
      return v.text ?? `${TO_GIVE[lang]}: ${v.ask?.[lang] ?? ""}`;
    })
    .join("");
}

/** The turns this client's call plays: the pain variant in, a missing handle's turn out. */
export function turnsFor(
  pain: Pain,
  hasInstagram: boolean,
): (Turn & { line: { kw: string; sa: string; en: string } })[] {
  return TURNS.filter(t => t.needs !== "instagram" || hasInstagram).map(t => {
    const v = pain !== "delays" ? t.pain?.[pain] : undefined;
    return { ...t, line: v ?? { kw: t.kw, sa: t.sa, en: t.en } };
  });
}

/** Seconds into the call, from "m:ss". */
export function secondsOf(at: string): number {
  const [m, s] = at.split(":").map(Number);
  return (m || 0) * 60 + (s || 0);
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * How long a turn stays alone on screen before the next one (DESIGN 11.2):
 * 300 ms per English word in the English deck, 330 ms per Arabic word in
 * the Arabic deck with subtitles off, held between 1.2 and 6 seconds.
 */
export function gapAfter(
  turn: { line: { kw: string; en: string } },
  lang: Lang,
  subtitles: boolean,
): number {
  const ms =
    lang === "ar" && !subtitles
      ? words(turn.line.kw) * 330
      : words(turn.line.en) * 300;
  return Math.max(1200, Math.min(6000, ms));
}

/** The pause before a turn: nobody types on a phone call (DESIGN 11.2). */
export const pauseBefore = (who: Speaker) => (who === "agent" ? 500 : 700);

// ------------------------------------------------- the client's details

/** The service family, for `{project}` and the budget scale (CONTENT data map). */
export const FAMILIES: {
  key: string;
  re: RegExp;
  project: L;
  scale: "works" | "build";
}[] = [
  {
    key: "interior",
    re: /interior|decor|ديكور|تصميم داخلي|التصميم الداخلي/i,
    project: {
      en: "the interior of your new villa",
      ar: "التصميم الداخلي لفيلتك الجديدة",
    },
    scale: "works",
  },
  {
    key: "construction",
    re: /construct|build(?!er)|villa build|بناء|إنشاء|انشاء|عظم/i,
    project: { en: "building your villa", ar: "بناء فيلتك" },
    scale: "build",
  },
  {
    key: "fitout",
    re: /fit.?out|renovat|refurb|ترميم|تجديد|تشطيب/i,
    project: {
      en: "renovating your ground floor",
      ar: "تجديد الدور الأرضي عندك",
    },
    scale: "works",
  },
  {
    key: "architecture",
    re: /architect|معمار/i,
    project: {
      en: "the design of your new villa",
      ar: "تصميم فيلتك الجديدة",
    },
    scale: "works",
  },
  {
    key: "engineering",
    re: /engineer|consult|permit|drawings|هندس|مخططات|تراخيص|استشار/i,
    project: {
      en: "the drawings and permits for your villa",
      ar: "تجهيز مخططات فيلتك وتراخيصها",
    },
    scale: "works",
  },
  {
    key: "landscaping",
    re: /landscap|garden|outdoor|حدائق|حديقة|لاندسكيب|تنسيق/i,
    project: {
      en: "your garden and outdoor area",
      ar: "تنسيق حديقتك والجلسة الخارجية",
    },
    scale: "works",
  },
  {
    key: "kitchens",
    re: /kitchen|مطبخ|مطابخ/i,
    project: { en: "your new kitchen", ar: "مطبخك الجديد" },
    scale: "works",
  },
];
export const ANY_PROJECT: L = { en: "your project", ar: "مشروعك" };

/** The family a service belongs to; kitchens and interiors before the rest. */
export function familyOf(service: string | null | undefined) {
  const s = String(service ?? "");
  if (!s) return null;
  const order = [
    "kitchens",
    "landscaping",
    "interior",
    "architecture",
    "fitout",
    "construction",
    "engineering",
  ];
  for (const k of order) {
    const f = FAMILIES.find(x => x.key === k);
    if (f?.re.test(s)) return f;
  }
  return null;
}

export interface Band {
  band: L;
  answer: L;
  note: L;
}

/**
 * The fictional customer's budget band, in the client's own currency
 * (EXAMPLE-CALL.md, by country and scale). Arabic in the call's dialect;
 * the note in digits for the appointment card.
 */
export function bandFor(
  country: string | null,
  scale: "works" | "build",
  dialect: Dialect,
): Band {
  const c = (country ?? "").toUpperCase();
  const cur =
    c === "SA" || c === "QA"
      ? { en: "riyals", ar: "ريال" }
      : c === "KW" || c === "BH"
        ? { en: "dinars", ar: "دينار" }
        : c === "AE" || c === "OM"
          ? { en: "dirhams", ar: "درهم" }
          : null;
  // Kuwait and Bahrain count in dinars: the works scale is in single thousands.
  const small = (c === "KW" || c === "BH") && scale === "works";
  const big = scale === "build" && !(c === "KW" || c === "BH");
  if (small)
    return {
      band: {
        en: "under 5 thousand dinars, between 5 and 10, or more",
        ar: "أقل من خمسة آلاف دينار، ولا بين خمسة وعشرة، ولا أكثر",
      },
      answer: { en: "Between 5 and 10.", ar: "بين خمسة وعشرة." },
      note: { en: "5 to 10 thousand dinars", ar: "من ٥ إلى ١٠ آلاف دينار" },
    };
  if (big && cur)
    return {
      band: {
        en: `under half a million ${cur.en}, between half a million and a million, or more`,
        ar: `أقل من نص مليون ${cur.ar}، ولا بين نص مليون ومليون، ولا أكثر`,
      },
      answer: {
        en: "Between half a million and a million.",
        ar: "بين نص مليون ومليون.",
      },
      note: {
        en: `half a million to a million ${cur.en}`,
        ar: `من نص مليون إلى مليون ${cur.ar}`,
      },
    };
  const unit = cur
    ? { en: ` ${cur.en}`, ar: ` ${cur.ar}` }
    : { en: "", ar: "" };
  void dialect;
  return {
    band: {
      en: `under 50 thousand${unit.en}, between 50 and 100, or more`,
      ar: `أقل من خمسين ألف${unit.ar}، ولا بين خمسين ومية، ولا أكثر`,
    },
    answer: { en: "Between 50 and 100.", ar: "بين خمسين ومية." },
    note: {
      en: `50 to 100 thousand${unit.en}`,
      ar: `من ٥٠ إلى ١٠٠ ألف${unit.ar}`,
    },
  };
}

/** Where the consultation is, as the call says it and as the card shows it. */
export type Place = "office" | "home" | "online";

export function placesOf(answer: string | null | undefined): Place[] {
  const s = String(answer ?? "");
  const out: Place[] = [];
  if (/office|showroom|studio|مكتب|معرض|المكتب|الشركة/i.test(s))
    out.push("office");
  if (/home|house|site|client'?s|منزل|بيت|البيت|موقع العميل/i.test(s))
    out.push("home");
  if (/online|zoom|video|virtual|أونلاين|اونلاين|زوم|عن بعد/i.test(s))
    out.push("online");
  return out;
}

export const PLACE_SAID: Record<Place, { en: string; kw: string; sa: string }> =
  {
    office: { en: "at our office", kw: "بمكتبنا", sa: "في مكتبنا" },
    home: { en: "at your home", kw: "عندك بالبيت", sa: "عندك في البيت" },
    online: { en: "online", kw: "أونلاين", sa: "أونلاين" },
  };

/** The confirmation's location line (EXAMPLE-CALL, stop 7). */
export const PLACE_WRITTEN: Record<Place, L> = {
  office: { en: "Our office on the map", ar: "موقع مكتبنا على الخريطة" },
  home: { en: "At your home", ar: "في بيتك" },
  online: { en: "Online", ar: "أونلاين" },
};

/** The WhatsApp confirmation (stop 7), in the live template's structure. */
export const CONFIRMATION = {
  opening: {
    en: "Your appointment with {Company} is confirmed.",
    ar: "تم تأكيد موعدك مع [اسم الشركة].",
  },
  date: { en: "Date: {date}", ar: "التاريخ: {date}" },
  time: { en: "Time: {time}", ar: "الوقت: {time}" },
  place: { en: "Location: {place}", ar: "الموقع: {place}" },
  closing: { en: "See you then.", ar: "نشوفك على خير." },
} as const;

/** What lands with the client (stop 8): the caller's notes, tagged Example. */
export const LANDS_NOTES = {
  planning: {
    en: "Planning it for six months, wants to start soon.",
    ar: "له ٦ شهور يخطط للمشروع، ويبي يبدي قريب.",
  },
  budget: { en: "Budget: {note}.", ar: "الميزانية: {note}." },
  pain: {
    delays: {
      en: "Their last company finished four months late.",
      ar: "الشركة اللي قبل تأخرت عليه ٤ شهور.",
    },
    design: {
      en: "Last time, what was built didn't match the drawings.",
      ar: "المرة اللي فاتت، التنفيذ ما طلع نفس المخططات.",
    },
    cost: {
      en: "Last time, the final bill came in far above the quote.",
      ar: "المرة اللي فاتت، الفاتورة طلعت أكثر بكثير من عرض السعر.",
    },
  } as Record<Pain, L>,
  customer: { en: "Abu Fahad", ar: "أبو فهد" },
} as const;

/** The pain stories, for prep (shown beside the selling point so the two match). */
export const PAIN_STORY: Record<Pain, string> = {
  delays: "Finished four months late, no news from the site",
  design: "What was built didn't match the drawings",
  cost: "The final bill came in far above the quote",
};

const AR_DAYS = [
  "الأحد",
  "الاثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];
const EN_DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const arDigits = (s: string) => s.replace(/[0-9]/g, d => AR_DIGITS[Number(d)]);

/**
 * The afternoon hour a client closes by, from the business hours answer:
 * "9am to 2pm", "8:00 - 15:00", "١٠ الصبح إلى ٥ العصر". Null when it cannot
 * be read (the call then keeps 4 pm).
 */
export function closingHour(hours: string | null | undefined): number | null {
  const s = String(hours ?? "")
    .replace(/[٠-٩]/g, d => String(AR_DIGITS.indexOf(d)))
    .toLowerCase();
  if (!s.trim()) return null;
  const times = [
    ...s.matchAll(
      /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|ص|م|صباحا|صباحاً|مساء|مساءً|العصر|الظهر|المغرب|الليل)?/g,
    ),
  ]
    .map(m => {
      let h = Number(m[1]);
      const tag = m[3] ?? "";
      if (/pm|p\.m\.|^م$|مساء|العصر|المغرب|الليل/.test(tag) && h < 12) h += 12;
      if (/الظهر/.test(tag) && h < 11) h += 12;
      return h;
    })
    .filter(h => h >= 0 && h <= 24);
  if (times.length < 2) return null;
  const close = times[times.length - 1];
  return close >= 12 && close <= 24 ? close : null;
}

/**
 * The booked slot (CONTENT Appendix A): the first working day two days
 * ahead (Sunday to Thursday), at 4 pm, moved to the client's last afternoon
 * hour when they close earlier.
 */
export function bookedSlot(todayIso: string, hours?: string | null) {
  const d = new Date(`${todayIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 2);
  while (d.getUTCDay() === 5 || d.getUTCDay() === 6)
    d.setUTCDate(d.getUTCDate() + 1);
  const close = closingHour(hours);
  const hour = close != null && close <= 16 ? Math.max(13, close - 1) : 16;
  const h12 = hour % 12 || 12;
  const dayIndex = d.getUTCDay();
  const arPart = hour < 15 ? "الظهر" : "العصر";
  const month = d.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  return {
    iso: d.toISOString().slice(0, 10),
    hour,
    day: { en: EN_DAYS[dayIndex], ar: AR_DAYS[dayIndex] } as L,
    /** As the caller says it: "4 pm" · "٤ العصر". */
    spoken: { en: `${h12} pm`, ar: `${arDigits(String(h12))} ${arPart}` } as L,
    /** As a slide writes it: "4 pm" · "٤ مساءً". */
    written: { en: `${h12} pm`, ar: `${arDigits(String(h12))} مساءً` } as L,
    /** As the WhatsApp template prints it, Latin digits in both decks. */
    templateDate: `${month} ${d.getUTCDate()}, ${d.getUTCFullYear()}`,
    templateTime: `${h12}:00 PM`,
  };
}

/** The dialect: prep, then the country, then the service areas; else Kuwaiti. */
export function dialectFor(
  prep: unknown,
  country: string | null,
  areas: string | null | undefined,
): { dialect: Dialect; from: "prep" | "country" | "areas" | "default" } {
  if (prep === "kw" || prep === "sa") return { dialect: prep, from: "prep" };
  if (country)
    return {
      dialect: country.toUpperCase() === "SA" ? "sa" : "kw",
      from: "country",
    };
  if (
    /riyadh|jeddah|dammam|khobar|mecca|makkah|medina|saudi|ksa|الرياض|جدة|الدمام|الخبر|مكة|المدينة|السعودية/i.test(
      String(areas ?? ""),
    )
  )
    return { dialect: "sa", from: "areas" };
  return { dialect: "kw", from: "default" };
}

/** An Instagram handle from a URL or a typed answer; null when there is none. */
export function handleOf(answer: string | null | undefined): string | null {
  const s = String(answer ?? "").trim();
  if (!s) return null;
  const m =
    s.match(/instagram\.com\/([A-Za-z0-9._]{2,30})/i) ??
    s.match(/^@?([A-Za-z0-9._]{2,30})$/);
  if (!m) return null;
  const h = m[1].replace(/\.$/, "");
  if (/^(p|reel|reels|stories|explore)$/i.test(h)) return null;
  return `@${h}`;
}
