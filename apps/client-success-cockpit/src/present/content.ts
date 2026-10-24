/**
 * Everything the two client decks say, in English and in the client-facing
 * Gulf Arabic, in one place (docs/csm-decks/CONTENT.md and CONTENT-AR.md are
 * the source; this file copies their words, it does not write new ones).
 *
 * The rules this copy keeps, pinned by scripts/deck-copy.test.ts:
 * - We call new enquiries within 5 minutes, said with the working hours and
 *   the night rule; never "instantly", "same day" for our calls or fixes, or
 *   the 21x and 100x figures. No results promise; no leads, no cost per lead
 *   and no budgets in money; no "every" or "always" for a process step;
 *   check-ins are weekly or every two weeks (the plan and how long they've
 *   been with us decide), never one alone; a no-show is ours to rebook, and
 *   someone thinking it over is followed up by both of us (done for you) or
 *   by their own team (done with you).
 * - Roles, not names: the presenting CSM's first name is on the two covers
 *   only. The Arabic CSM title is gendered, and no seat carries a gender, so
 *   the cover uses the role نجاح العملاء, as the WhatsApp group row does.
 * - Sentence case, no exclamation marks, no em dashes, plain quotes.
 * - Arabic: white Gulf on slides, the client in the plural, Arabic-Indic
 *   digits, never a lone ٠, never مقاول, never ليد, never زيارة.
 *
 * `{slot}` marks a value filled from the client's data (deckData.ts).
 */

import { hold } from "./figure";

export type Lang = "en" | "ar";
export interface L {
  en: string;
  ar: string;
}

const LRI = "⁦";
const PDI = "⁩";
/** A Latin run (Mahara OS, LeadConnector, a client's English name). */
const LATIN = /[A-Za-z][A-Za-z0-9&'.\-/ ]*[A-Za-z0-9]|[A-Za-z]/g;

/**
 * An Arabic line with each Latin run isolated (DESIGN 13.2), so "Mahara OS"
 * or a client's English name never pulls the punctuation beside it out of
 * place. English lines are returned as they are.
 */
export function isolate(text: string, lang: Lang): string {
  if (lang !== "ar") return text;
  return text.replace(LATIN, m => `${LRI}${m}${PDI}`);
}

const NB = "\u00a0";
/**
 * Working hours stay whole on one line: "10 to 6" and "١٠ صباحاً إلى ٦
 * مساءً" never break inside (hold() keeps only a number with the word
 * after it, so "to" or إلى could still end a line). So does the product's
 * name, "Mahara OS".
 */
const hours = (s: string) =>
  s
    .replace(/([0-9])[ \u00a0]to (?=[0-9])/g, `$1${NB}to${NB}`)
    .replace(/(صباحاً|[٠-٩])[ \u00a0]إلى (?=[٠-٩])/g, `$1${NB}إلى${NB}`)
    .replace(/Mahara OS/g, `Mahara${NB}OS`);

/** A line in the language on screen, its numbers held to what they count. */
export const t = (l: L, lang: Lang) => hours(hold(isolate(l[lang], lang)));

/** `{name}` slots filled; a slot with no value is left out with its space. */
export function fill(text: string, slots: Record<string, string>): string {
  return text.replace(
    /\{([a-zA-Z0-9_.]+)\}/g,
    (_, k: string) => slots[k] ?? "",
  );
}

/** A line with its slots filled, in the language on screen. */
export const tf = (l: L, lang: Lang, slots: Record<string, string>) =>
  hours(hold(isolate(fill(l[lang], slots), lang)));

/**
 * The separator inside a line: a middle dot in English; the Arabic comma
 * in Arabic, since a dot beside Arabic-Indic digits reads as ٠ (score
 * round 3). Every Arabic line in this file uses it, and the code that joins
 * two parts on the canvas asks for it here.
 */
export const sep = (lang: Lang) => (lang === "ar" ? "، " : " · ");

const AR = "٠١٢٣٤٥٦٧٨٩";
/** Digits as the deck writes them: Arabic-Indic in Arabic, never ٬. */
export function digits(value: number | string, lang: Lang): string {
  const s = String(value);
  return lang === "ar" ? s.replace(/[0-9]/g, d => AR[Number(d)]) : s;
}

/**
 * A step's numeral: from "١٢٣٤٥٦٧٨٩" in Arabic, so a list never opens on a
 * lone ٠ (it reads as a dot at size).
 */
export function stepNumeral(i: number, lang: Lang): string {
  return lang === "ar"
    ? ("١٢٣٤٥٦٧٨٩"[i] ?? digits(i + 1, lang))
    : String(i + 1);
}

// ---------------------------------------------------------------- shared

/** Words more than one slide (and the launch deck) use. */
export const SHARED = {
  csmRole: { en: "Your client success manager", ar: "نجاح العملاء" },
  csmTeam: { en: "Your client success manager", ar: "فريق نجاح العملاء" },
  status: {
    done: { en: "Done", ar: "تم" },
    todo: { en: "To do", ar: "باقي" },
    unchecked: { en: "Not checked yet", ar: "ما تأكدنا للحين" },
  },
  tag: {
    preview: { en: "Preview", ar: "معاينة" },
    starter: {
      en: "Starter, from our templates",
      ar: "إعلان بداية، من قوالبنا",
    },
    /** A starter when the Brand Blueprint chose its pack (SPEC 6.2). */
    starterPack: {
      en: "From our {service} pack",
      ar: "من ملف {service} عندنا",
    },
    yourForm: { en: "Your form", ar: "نموذجكم" },
    exampleForm: { en: "Example form", ar: "نموذج للتوضيح" },
    example: { en: "Example", ar: "مثال" },
    exampleWording: { en: "Example wording", ar: "صياغة للتوضيح" },
    /** A WhatsApp chat under a starter template's picture (score round 2 of the five services). */
    exampleWordingStarter: {
      en: "Example wording, starter ad",
      ar: "صياغة للتوضيح، إعلان بداية",
    },
    illustration: { en: "Illustration", ar: "توضيح" },
    demo: { en: "Demo workspace", ar: "حساب تجريبي" },
    academy: { en: "Academy screenshot", ar: "لقطة من الأكاديمية" },
  },
  /** The journey's three lanes, in their order (DESIGN 6). */
  lane: {
    customer: { en: "Your customer", ar: "عميلكم" },
    us: { en: "Our team", ar: "فريقنا" },
    you: { en: "You", ar: "أنتم" },
  },
  owner: {
    customer: { en: "Your customer", ar: "عميلكم" },
    us: { en: "Our team does this", ar: "فريقنا يسويها" },
    you: { en: "You do this", ar: "أنتم تسوونها" },
  },
  toGive: { en: "To give us", ar: "نحتاجه منكم" },
  adGoesHere: { en: "Your ad goes here", ar: "إعلانكم هنا" },
  adsEmpty: {
    en: "We're finishing your first ads",
    ar: "نشتغل على أول إعلاناتكم الحين",
  },
  frame: {
    feed: { en: "Instagram feed", ar: "فيد إنستقرام" },
    reels: { en: "Instagram Stories and Reels", ar: "ستوري وريلز إنستقرام" },
    facebook: { en: "Facebook feed", ar: "فيد فيسبوك" },
  },
  driveMissing: {
    en: "Your folder link is pinned in your WhatsApp group.",
    ar: "رابط المجلد مثبت فوق في قروب الواتساب.",
  },
  driveLink: { en: "Your Drive folder", ar: "مجلد الدرايف" },
} as const;

/**
 * The five main services (CEO, 2026-10-21; CONTENT "The five main
 * services", CONTENT-AR decision 15): the kickoff form's choices, never a
 * sub-trade such as kitchens. `name` is the choice as a label (slide 4's
 * rows, the queue card, the form's first answer); `mid` is the same service
 * said inside a sentence ("templates for interior design", لخدمة التصميم
 * الداخلي). Construction is بناء وإنشاءات, never مقاولات: the decks never call
 * the client مقاول (DESIGN 13.5).
 */
export const SERVICES = {
  "design-build": {
    name: { en: "Design and build", ar: "تصميم وتنفيذ" },
    mid: { en: "design and build", ar: "التصميم والتنفيذ" },
  },
  interior: {
    name: { en: "Interior design", ar: "تصميم داخلي" },
    mid: { en: "interior design", ar: "التصميم الداخلي" },
  },
  architecture: {
    name: { en: "Architectural design", ar: "تصميم معماري" },
    mid: { en: "architectural design", ar: "التصميم المعماري" },
  },
  fitout: {
    name: { en: "Fit-out and renovation", ar: "تشطيب وترميم" },
    mid: { en: "fit-out and renovation", ar: "التشطيب والترميم" },
  },
  construction: {
    name: { en: "Construction", ar: "بناء وإنشاءات" },
    mid: { en: "construction", ar: "البناء والإنشاءات" },
  },
  /** Slide 4's sixth row, only when the client's words fit none of the five. */
  other: {
    name: { en: "Other", ar: "خدمة أخرى" },
    mid: { en: "your service", ar: "خدمتكم" },
  },
} as const;

/**
 * The example ads (CONTENT "The visual pass", CONTENT-AR decision 14):
 * Mahara's own pictures, no client's work, labelled wherever they show.
 * إعلان للتوضيح (score round 4: إعلان مثال read as a word-for-word
 * "Example ad"; the decks already say نموذج للتوضيح and صياغة للتوضيح for
 * the same idea), never قالب (a template goes live) and never تجريبي.
 */
export const EXAMPLE = {
  /** Above one phone: L2 stop 1, O4, an example phone beside a real creative on L4. */
  tag: { en: "Example ad", ar: "إعلان للتوضيح" },
  /** L4's title tag when every phone shows it, L3's field, O7's strip. */
  tags: { en: "Example ads", ar: "إعلانات للتوضيح" },
  /** The tray's example thumbnail and L5's form cover. */
  short: { en: "Example", ar: "مثال" },
  /** L3's field when their real pick is on it: theirs is never called an example. */
  tagsPick: {
    en: "Example ads, and your pick",
    ar: "إعلانات للتوضيح، واختياركم",
  },
  /** A picture's alt text: "Example ad: {scene}". */
  alt: { en: "Example ad: {scene}", ar: "إعلان للتوضيح: {scene}" },
  scenes: {
    kitchen: {
      en: "a finished kitchen with an oak and quartz island",
      ar: "مطبخ جديد بجزيرة كوارتز وخشب بلوط",
    },
    living: { en: "a new villa living room", ar: "صالة جديدة في فيلا" },
    majlis: {
      en: "a contemporary majlis with carved wood and brass lanterns",
      ar: "مجلس عصري بخشب محفور وفوانيس نحاس",
    },
    villa: {
      en: "a new two-storey villa at golden hour",
      ar: "فيلا جديدة من دورين وقت الغروب",
    },
    construction: {
      en: "a villa's concrete frame on a tidy site",
      ar: "هيكل خرساني لفيلا في موقع مرتب",
    },
    bathroom: {
      en: "a marble bathroom with a stone bathtub",
      ar: "حمام رخام فيه بانيو حجر",
    },
    pool: { en: "a villa pool at dusk", ar: "مسبح فيلا وقت المغرب" },
    landscape: {
      en: "a landscaped villa garden with a pergola",
      ar: "حديقة فيلا منسقة فيها برجولة",
    },
    bedroom: { en: "a calm master bedroom", ar: "غرفة نوم رئيسية هادية" },
    office: {
      en: "a fitted-out office with a glass meeting room",
      ar: "مكتب مجهّز فيه غرفة اجتماعات زجاج",
    },
    facade: {
      en: "a renovated villa facade in stone",
      ar: "واجهة فيلا مجددة بالحجر",
    },
    stairs: {
      en: "an entrance hall with a floating marble staircase",
      ar: "مدخل فيه درج رخام معلّق",
    },
    construction2: {
      en: "a residential tower's concrete frame under a crane at dusk",
      ar: "هيكل خرساني لبرج سكني وفوقه رافعة وقت المغرب",
    },
    construction3: {
      en: "a two-storey villa's concrete frame with scaffolding",
      ar: "هيكل خرساني لفيلا من دورين وحوله سقالات",
    },
    fitout2: {
      en: "a fitted-out boutique with stone counters and lit shelves",
      ar: "محل مجهّز بكاونترات حجر ورفوف فيها إضاءة",
    },
    fitout3: {
      en: "a fitted-out restaurant with timber booths and brass lights",
      ar: "مطعم مجهّز بجلسات خشب وإضاءة نحاس",
    },
    designbuild: {
      en: "a new villa's glass living room over its pool at dusk",
      ar: "صالة زجاج في فيلا جديدة تطل على المسبح وقت المغرب",
    },
    architecture2: {
      en: "a modern villa with a timber-screened upper floor",
      ar: "فيلا حديثة دورها العلوي عليه سواتر خشب",
    },
  },
  /** Prep's names for the eighteen (cockpit UI, English). */
  names: {
    kitchen: "Kitchen",
    living: "Living room",
    majlis: "Majlis",
    villa: "Villa",
    construction: "Construction",
    bathroom: "Bathroom",
    pool: "Pool",
    landscape: "Garden",
    bedroom: "Bedroom",
    office: "Office",
    facade: "Facade",
    stairs: "Entrance and stairs",
    construction2: "Tower frame",
    construction3: "Villa frame and scaffolding",
    fitout2: "Boutique",
    fitout3: "Restaurant",
    designbuild: "Villa and pool at dusk",
    architecture2: "Modern villa",
  },
} as const;

/**
 * Inside a phone: Meta's own words for its chrome, in the phone's app
 * language (CONTENT-AR "Meta's own Arabic labels", to check against a live
 * Arabic preview before shipping, DESIGN 17.2).
 */
export const APP = {
  sponsored: { en: "Sponsored", ar: "مُموَّل" },
  more: { en: "more", ar: "المزيد" },
  seeMore: { en: "See more", ar: "عرض المزيد" },
  like: { en: "Like", ar: "أعجبني" },
  comment: { en: "Comment", ar: "تعليق" },
  share: { en: "Share", ar: "مشاركة" },
  /** Facebook's own composer row, at the top of the feed. */
  composer: { en: "What's on your mind?", ar: "بمَ تفكر؟" },
} as const;

export type Cta =
  | "LEARN_MORE"
  | "GET_QUOTE"
  | "BOOK_NOW"
  | "CONTACT_US"
  | "SIGN_UP"
  | "SEND_WHATSAPP_MESSAGE"
  | "APPLY_NOW";

/** The call to action as Meta writes it (CONTENT L4, CONTENT-AR table). */
export const CTA: Record<Cta, L> = {
  LEARN_MORE: { en: "Learn more", ar: "معرفة المزيد" },
  GET_QUOTE: { en: "Get quote", ar: "الحصول على عرض أسعار" },
  BOOK_NOW: { en: "Book now", ar: "احجز الآن" },
  CONTACT_US: { en: "Contact us", ar: "اتصل بنا" },
  SIGN_UP: { en: "Sign up", ar: "تسجيل" },
  SEND_WHATSAPP_MESSAGE: {
    en: "Send WhatsApp message",
    ar: "إرسال رسالة واتساب",
  },
  APPLY_NOW: { en: "Apply now", ar: "تقدّم الآن" },
};

/** Calling and reply hours: the line stays as written, the UAE adds its zone. */
export const HOURS = {
  uae: {
    en: "10 to 6 Saudi time (11 to 7 in the UAE)",
    ar: "من ١٠ صباحاً إلى ٦ مساءً بتوقيت السعودية (من ١١ إلى ٧ بتوقيت الإمارات)",
  },
} as const;

/** The chrome around the canvas and the presenter's own windows. */
export const CHROME = {
  back: { en: "Back to", ar: "رجوع إلى" },
  /** Back in the creative director's page: the deck closes in place. */
  end: { en: "End the deck", ar: "سكّر العرض" },
  notes: { en: "Notes", ar: "الملاحظات" },
  all: { en: "All slides", ar: "كل الشرائح" },
  full: { en: "Full screen", ar: "ملء الشاشة" },
  prev: { en: "Previous", ar: "السابق" },
  next: { en: "Next", ar: "التالي" },
  slide: { en: "Slide", ar: "شريحة" },
  of: { en: "of", ar: "من" },
  keys: {
    en: "→ ← move · F full screen · L language · O all slides · N notes · Esc closes this list",
    ar: "→ ← تنقل، F ملء الشاشة، L اللغة، O كل الشرائح، N الملاحظات، Esc يقفل القائمة",
  },
  /** A slide that could not be drawn (its own error boundary), on the canvas. */
  broken: {
    en: "This slide could not be drawn.",
    ar: "ما قدرنا نعرض هالشريحة.",
  },
} as const;

// ------------------------------------------------------- onboarding deck

export const O = {
  welcome: {
    title: { en: "Welcome, {name}", ar: "حياكم الله، {name}" },
    hello: { en: "Welcome,", ar: "حياكم الله،" },
    dateline: { en: "Onboarding call · {date}", ar: "مكالمة التعريف، {date}" },
    agendaLead: {
      en: "Before we hang up, we'll:",
      ar: "قبل لا نسكر المكالمة:",
    },
    agenda: [
      { en: "Choose your launch service", ar: "نختار خدمة الإطلاق" },
      { en: "Set up your access", ar: "نجهّز الصلاحيات" },
      {
        en: "Book your Brand Blueprint call",
        ar: "نحجز مكالمة بناء الهوية والعرض",
      },
    ],
  },
  /**
   * The call's checklist (DESIGN 22.2.0): O1's agenda, ticked from data at
   * the foot of O4 and O6, and closed on O7's last stop. Never "2 of 3".
   */
  today: {
    label: { en: "Today", ar: "اليوم" },
    short: [
      { en: "Launch service", ar: "خدمة الإطلاق" },
      { en: "Your access", ar: "الصلاحيات" },
      // One Arabic name for the call across both decks (score round 1).
      { en: "Blueprint call", ar: "مكالمة بناء الهوية والعرض" },
    ],
    /**
     * The third item when the kickoff's Submit ticked it and no Blueprint
     * call is booked or held yet: it says what was done, never that the
     * call is booked (score round 1 of the Blueprint deck).
     */
    kickoffSent: { en: "Kickoff sent", ar: "انرسل نموذج بداية الشغل" },
  },
  goals: {
    title: {
      en: "Your goals, as you wrote them",
      ar: "أهدافكم مثل ما كتبتوها",
    },
    source: { en: "From your onboarding form", ar: "من نموذج التعريف بالنشاط" },
    goal90: { en: "In 90 days", ar: "خلال ٩٠ يوم" },
    /** The start of the goal's 90 days, drawn under it (22.14). */
    today: { en: "Today", ar: "اليوم" },
    goal12_24: { en: "In 12 to 24 months", ar: "خلال سنة إلى سنتين" },
    challenges: { en: "What's in the way", ar: "اللي واقف بطريقكم" },
    why: { en: "Why you joined", ar: "ليش بديتوا معنا" },
    foot: {
      en: "We'll track them with you. They're targets, not a promise of results.",
      ar: "نتابعها معكم، وهي أهداف نشتغل عليها، مو وعد بنتائج.",
    },
    empty: {
      en: "What would make the next 90 days a win for you?",
      ar: "متى تقولون إن الثلاث شهور الجاية نجحت؟",
    },
    /**
     * The empty field's placeholder (score round 2 of the five services):
     * the question over it and the track under it already say 90 days.
     */
    input: { en: "In your words", ar: "بكلامكم" },
    /** The field's name for a screen reader. */
    inputLabel: {
      en: "Your 90-day goal, in your words",
      ar: "هدفكم خلال ٩٠ يوم، بكلامكم",
    },
  },
  team: {
    title: {
      en: "Your team, in your WhatsApp group",
      ar: "فريقكم، في قروب الواتساب",
    },
    /**
     * Said, not shown, since the fixer's round of 2026-10-21: the title and
     * the group under it already say "WhatsApp group", and the CSM says
     * this line as the group fills (the notes). The same in both service
     * models, since it names no call centre.
     */
    line: {
      en: "Everyone who works on your account is in this one group.",
      ar: "كل اللي يشتغلون على حسابكم معكم في هالقروب.",
    },
    header: { en: "Your WhatsApp group", ar: "قروب الواتساب" },
    rows: [
      {
        key: "csm",
        name: { en: "Your client success manager", ar: "نجاح العملاء" },
        line: {
          en: "Your one point of contact, for anything.",
          ar: "نقطة تواصلكم معنا، لأي شي.",
        },
      },
      {
        key: "cd",
        name: { en: "The creative director", ar: "المدير الإبداعي" },
        line: {
          en: "Your brand, your scripts and your ads.",
          ar: "هويتكم، وسكربتاتكم، وإعلاناتكم.",
        },
      },
      {
        key: "mb",
        name: { en: "The media buyer", ar: "مسؤول الإعلانات" },
        line: { en: "Your campaigns.", ar: "حملاتكم." },
      },
      {
        key: "sys",
        name: { en: "The systems team", ar: "فريق الأنظمة" },
        line: { en: "Mahara OS and your calendar.", ar: "Mahara OS وتقويمكم." },
      },
      {
        key: "caller",
        name: { en: "Your caller", ar: "فريق الاتصال" },
        line: {
          en: "Questions from the calls: your hours, a holiday, a service detail.",
          ar: "أسئلة من المكالمات: أوقات دوامكم، أو إجازة، أو تفصيلة عن خدمة.",
        },
      },
    ],
    alertsDwy: {
      key: "alerts",
      name: { en: "New-enquiry alerts", ar: "تنبيهات الاستفسارات الجديدة" },
      line: {
        en: "New enquiries arrive here too, for your callers.",
        ar: "الاستفسارات الجديدة توصل هنا بعد، لفريق الاتصال عندكم.",
      },
    },
    /**
     * The group's reply time, within 2 working hours (LEAD decision 7, the
     * Gamma launch deck): O3's second stop, its heading, then the hours
     * (the visual pass split the old foot line in two).
     */
    reply: {
      en: "We reply within 2 working hours.",
      ar: "نرد خلال ساعتين دوام.",
    },
    hours: {
      en: "10 to 6, Saturday to Thursday. If something worries you, we call you.",
      ar: "من ١٠ صباحاً إلى ٦ مساءً، من السبت إلى الخميس. وإذا فيه شي شاغل بالكم، نتصل عليكم.",
    },
    hoursUae: {
      en: "10 to 6 Saudi time (11 to 7 in the UAE), Saturday to Thursday. If something worries you, we call you.",
      ar: "من ١٠ صباحاً إلى ٦ مساءً بتوقيت السعودية (من ١١ إلى ٧ بتوقيت الإمارات)، من السبت إلى الخميس. وإذا فيه شي شاغل بالكم، نتصل عليكم.",
    },
  },
  one: {
    title: { en: "One service per campaign", ar: "خدمة وحدة لكل حملة" },
    line: {
      en: "We launch with one service, so the ads, the form questions and the calls are all written for one kind of customer.",
      ar: "نبدي بخدمة وحدة، عشان الإعلانات والأسئلة والمكالمات كلها تكلم نوع واحد من العملاء.",
    },
    numberOne: { en: "Your #1", ar: "الأولى عندكم" },
    tests: [
      { key: "sell", label: { en: "Easiest to sell", ar: "الأسهل بالبيع" } },
      { key: "profit", label: { en: "Most profit", ar: "الأكثر ربح" } },
      {
        key: "deliver",
        label: { en: "Least painful to deliver", ar: "الأريح بالتنفيذ" },
      },
    ],
    first: { en: "Your first campaign", ar: "أول حملة" },
    result: {
      en: "We'll launch with {service}",
      ar: "بنطلق أول حملة على {service}",
    },
    small: {
      en: "Once it works, we can add the next one.",
      ar: "ولما تمشي زين، نضيف الخدمة اللي بعدها.",
    },
    launch: { en: "Launch with this", ar: "نطلق فيها" },
    /** The product column before any service exists. */
    pending: { en: "We'll pick it together", ar: "نختارها مع بعض" },
    /** The column's control once "Launch with this" is pressed. */
    chosen: { en: "Chosen", ar: "اخترناها" },
  },
  road: {
    title: {
      en: "The road to your first appointments",
      ar: "الطريق لأول مواعيدكم",
    },
    stops: [
      { en: "Contract signed", ar: "توقيع العقد" },
      { en: "Onboarding form", ar: "نموذج التعريف بالنشاط" },
      { en: "Onboarding call", ar: "مكالمة التعريف" },
      { en: "Brand Blueprint call", ar: "بناء الهوية والعرض" },
      { en: "Launch call", ar: "مكالمة الإطلاق" },
      { en: "First appointments", ar: "أول المواعيد" },
    ],
    today: { en: "Today", ar: "اليوم" },
    /**
     * The launch call's caption on the road until it is booked: about 45
     * minutes since the launch deck grew to thirteen slides (CJ).
     */
    launchTime: { en: "About 45 minutes", ar: "تقريباً ٤٥ دقيقة" },
    launchLine: {
      en: "We walk you through everything that's going live.",
      ar: "نمر معكم على كل شي بينزل.",
    },
    afterGoLive: { en: "After go-live", ar: "بعد الإطلاق" },
    footer: {
      en: "Each call is booked at the end of the one before.",
      ar: "كل مكالمة نحجزها بآخر المكالمة اللي قبلها.",
    },
  },
  week: {
    title: {
      en: "What we need from you this week",
      ar: "اللي نحتاجه منكم هالأسبوع",
    },
    /** Said, not shown, since the visual pass: "Now, on this call" says it. */
    line: {
      en: "Most of it we'll do together, right now.",
      ar: "وأغلبه بنسويه مع بعض، الحين.",
    },
    now: { en: "Now, on this call", ar: "الحين، على المكالمة" },
    later: { en: "This week, from you", ar: "هالأسبوع، منكم" },
    /** Only on a card whose video is recorded; {len} is m:ss, or words in Arabic. */
    guide: { en: "Video guide · {len}", ar: "فيديو شرح، {len}" },
    rows: {
      meta: {
        name: { en: "Meta access", ar: "صلاحيات ميتا" },
        line: {
          en: "Your Page and ad account, shared through one link. And a card on the ad account: your ad spend goes to Meta directly.",
          ar: "صفحتكم على فيسبوك وحسابكم الإعلاني، تشاركونها معنا برابط واحد. وبطاقة على الحساب الإعلاني: مصروف الإعلانات يروح لميتا مباشرة.",
        },
        ticks: [
          { key: "meta_access", label: { en: "Access", ar: "الصلاحيات" } },
          { key: "meta_card", label: { en: "Card", ar: "البطاقة" } },
        ],
      },
      os: {
        name: { en: "Mahara OS", ar: "Mahara OS" },
        line: {
          en: "Sign in, then connect WhatsApp and Google Calendar, so bookings land in your real calendar.",
          ar: "سجلوا دخول، وبعدها اربطوا الواتساب وتقويم قوقل، عشان المواعيد تنزل بتقويمكم الحقيقي.",
        },
        ticks: [
          { key: "os_signin", label: { en: "Signed in", ar: "تسجيل الدخول" } },
          { key: "os_whatsapp", label: { en: "WhatsApp", ar: "واتساب" } },
          { key: "os_calendar", label: { en: "Calendar", ar: "التقويم" } },
        ],
      },
      crm: {
        name: { en: "Your CRM", ar: "الـCRM عندكم" },
        line: {
          en: "Sign in, and connect your calendar, so bookings land in your real calendar.",
          ar: "سجلوا دخول، واربطوا تقويمكم، عشان المواعيد تنزل بتقويمكم الحقيقي.",
        },
        ticks: [
          { key: "os_signin", label: { en: "Signed in", ar: "تسجيل الدخول" } },
          { key: "os_calendar", label: { en: "Calendar", ar: "التقويم" } },
        ],
      },
      content: {
        name: { en: "Your content", ar: "محتواكم" },
        line: {
          en: "Before your Blueprint call: photos and videos in your Drive folder. Finished projects, work in progress, your team on site. Don't filter. We will.",
          ar: "قبل مكالمة بناء الهوية: صور وفيديوهات بمجلد الدرايف. مشاريع خلصت، وشغل قيد التنفيذ، وفريقكم بالموقع. لا\u00a0تفلترون، إحنا نفلتر.",
        },
        ticks: [{ key: "content", label: { en: "Content", ar: "المحتوى" } }],
      },
      past: {
        name: { en: "Past enquiries", ar: "الاستفسارات القديمة" },
        line: {
          en: "Have a list of old enquiries? Send it, and we'll agree whether to call them.",
          ar: "عندكم قائمة باستفسارات قديمة؟ أرسلوها، ونتفق إذا ينتصل عليهم.",
        },
        ticks: [
          {
            key: "past",
            label: { en: "Past enquiries", ar: "الاستفسارات القديمة" },
          },
        ],
      },
      academy: {
        name: { en: "The Academy", ar: "الأكاديمية" },
        line: {
          en: "Courses for you and your team: your offer, closing your projects, your team and operations. Join, and start with the introduction.",
          ar: "كورسات لكم ولفريقكم: العرض، وتوقيع المشاريع، والفريق والتشغيل. انضموا، وابدوا بكورس البداية.",
        },
        ticks: [
          { key: "academy", label: { en: "The Academy", ar: "الأكاديمية" } },
        ],
      },
      phones: {
        name: { en: "Callers' phones", ar: "جوالات فريق الاتصال" },
        line: {
          en: "Install the LeadConnector app, sign in and turn on alerts.",
          ar: "نزّلوا تطبيق LeadConnector، وسجلوا دخول، وفعّلوا التنبيهات.",
        },
        ticks: [
          {
            key: "phones",
            label: { en: "Callers' phones", ar: "جوالات فريق الاتصال" },
          },
        ],
      },
    },
  },
  next: {
    title: {
      en: "What to expect, and what's next",
      ar: "اللي تتوقعونه، والخطوة الجاية",
    },
    /** Stop 1's own title (the visual pass). */
    titleExpect: { en: "What to expect", ar: "اللي تتوقعونه" },
    adsName: { en: "Your first ads", ar: "أول إعلاناتكم" },
    approved: {
      en: "Starter ads go live first, from our ready templates for {service}. Your own ads, made from your content, follow.",
      ar: "أول شي تنزل إعلانات البداية، من قوالبنا الجاهزة لخدمة {service}. وبعدها إعلاناتكم الخاصة، اللي نسويها من محتواكم.",
    },
    approvedNoPack: {
      en: "Starter ads go live first, from our ready templates. Your own ads, made from your content, follow.",
      ar: "أول شي تنزل إعلانات البداية، من قوالبنا الجاهزة. وبعدها إعلاناتكم الخاصة، اللي نسويها من محتواكم.",
    },
    pending: {
      en: "Starter ads can go live first, from our ready templates for {service}. Your own ads, made from your content, follow.",
      ar: "نقدر ننزل أول شي إعلانات البداية، من قوالبنا الجاهزة لخدمة {service}. وبعدها إعلاناتكم الخاصة، اللي نسويها من محتواكم.",
    },
    pendingNoPack: {
      en: "Starter ads can go live first, from our ready templates. Your own ads, made from your content, follow.",
      ar: "نقدر ننزل أول شي إعلانات البداية، من قوالبنا الجاهزة. وبعدها إعلاناتكم الخاصة، اللي نسويها من محتواكم.",
    },
    declined: {
      en: "Your own ads, made from your content, go live first.",
      ar: "أول شي تنزل إعلاناتكم الخاصة، اللي نسويها من محتواكم.",
    },
    /** The check, set small before any ad exists (the spec review, 2026-10-20). */
    approval: {
      en: "They go live only once you've approved the facts, prices and claims in them.",
      ar: "ما تنزل أي وحدة منها إلا بعد ما توافقون على المعلومات والأسعار والوعود اللي فيها.",
    },
    testName: {
      en: "The first weeks are a test",
      ar: "أول الأسابيع نختبر فيها الإعلانات",
    },
    /**
     * Creative flexibility, planted where the red lines are asked (CEO,
     * 2026-10-20), in three lines (score round 2: one four-sentence block
     * read dense): the ads' job, at the body's ink; the volume and the
     * moving launch, in ink-2; then the red lines' ask, over their list.
     */
    testLine: {
      en: "Your ads are there to bring in business, not to look like your page.",
      ar: "إعلاناتكم هدفها تجيب لكم شغل، مو إنها تشبه صفحتكم.",
    },
    testVolume: {
      en: "We test many ads, fast. Small style changes go into the next round, so your launch keeps moving.",
      ar: "نختبر إعلانات كثيرة، وبسرعة. والتعديلات الصغيرة على الشكل تروح للإعلانات الجاية، عشان إطلاقكم يمشي.",
    },
    testAsk: {
      en: "Your red lines stay fixed: tell us now what we must never say or show.",
      ar: "وخطوطكم الحمراء ثابتة: قولوا لنا الحين اللي ما نقوله ولا نوريه أبد.",
    },
    input: {
      en: "Your red lines, in your words",
      ar: "خطوطكم الحمراء، بكلامكم",
    },
    bandHead: {
      en: "Next: your Brand Blueprint call",
      ar: "الخطوة الجاية: مكالمة بناء الهوية والعرض",
    },
    bandRest: {
      en: "45 minutes with our creative director: your brand, your offer, your first ad scripts.",
      ar: "٤٥ دقيقة مع المدير الإبداعي: هويتكم، وعرضكم، وسكربتات أول إعلاناتكم.",
    },
    /**
     * The last stop's calendar card (the fixer's round): the booked call as
     * their calendar shows it, built from the booking alone; before it is
     * booked, an open ring and when it gets booked.
     */
    cardName: {
      en: "Brand Blueprint call",
      ar: "مكالمة بناء الهوية والعرض",
    },
    cardWith: {
      en: "45 minutes · Our creative director",
      ar: "٤٥ دقيقة مع المدير الإبداعي",
    },
    cardOpen: {
      en: "We book it before we hang up",
      ar: "نحجزها قبل لا نسكر المكالمة",
    },
    /**
     * The kickoff is sent, so the Blueprint is booked on our side, and its
     * time is not on the calendar yet: the block is ticked, as the
     * checklist is, and says what is left (the kickoff slide, 2026-10-22).
     */
    cardPick: {
      en: "We pick the time now",
      ar: "نختار الوقت الحين",
    },
    starterTitle: { en: "Your starter ads", ar: "إعلانات البداية" },
    /** Stop 2, under its tag: what the client is looking at (not stop 1's approval line again). */
    starterLine: {
      en: "Our ready templates for {service}, under your Page name and logo.",
      ar: "قوالبنا الجاهزة لخدمة {service}، باسم صفحتكم وشعاركم.",
    },
    starterLineNoPack: {
      en: "Our ready templates, under your Page name and logo.",
      ar: "قوالبنا الجاهزة، باسم صفحتكم وشعاركم.",
    },
  },
  /**
   * O8, the kickoff form (CEO, 2026-10-22: "embed the kick off form at the
   * end of the onboarding presentation"). The form itself is Typeform's
   * own; these are the words around it. Nothing about money, the card or
   * the sale is on the canvas: those facts are in the notes window.
   */
  kickoff: {
    title: { en: "Your kickoff form", ar: "نموذج بداية الشغل" },
    head: {
      en: "Before we hang up: your kickoff form",
      ar: "قبل لا نسكر المكالمة: نموذج بداية الشغل",
    },
    /** With their onboarding answers on record: the read-backs are in. */
    prefilled: {
      en: "Your details are already in, from your onboarding form. We check them together, then send it.",
      ar: "تفاصيلكم موجودة فيه من نموذج التعريف بالنشاط. نراجعها مع بعض، وبعدها نرسله.",
    },
    /** Without them: the form opens with their name only. */
    together: {
      en: "We fill it in together, now.",
      ar: "نعبيه مع بعض الحين.",
    },
    sent: {
      en: "Once it's sent, our team starts on your setup and your Brand Blueprint call, and the next step reaches your WhatsApp group.",
      ar: "وأول ما ينرسل، يبدي فريقنا بتجهيز حسابكم ومكالمة بناء الهوية والعرض، وتوصلكم الخطوة الجاية بقروب الواتساب.",
    },
    /**
     * The same, as the column's three numbered steps (score round 3 of the
     * Blueprint deck: one sentence left the column's lower half empty).
     */
    stepsHead: { en: "Once it's sent", ar: "أول ما ينرسل" },
    /** On record already: the same steps, under way (score round 2 of the design pass). */
    stepsHeadDone: { en: "Now it's in", ar: "وصلنا، والحين" },
    steps: [
      {
        en: "Our team starts on your setup.",
        ar: "يبدي فريقنا بتجهيز حسابكم.",
      },
      {
        en: "We get your Brand Blueprint call ready.",
        ar: "نجهز لمكالمة بناء الهوية والعرض.",
      },
      {
        en: "The next step reaches your WhatsApp group.",
        ar: "وتوصلكم الخطوة الجاية بقروب الواتساب.",
      },
    ],
    /**
     * Sent on this call: the column's line (score round 1 of the Blueprint
     * deck: "sent" was said three times; the frame's head keeps the time,
     * its card says what comes next).
     */
    done: {
      en: "Done. Your answers are with our team.",
      ar: "تمام، أجوبتكم وصلت لفريقنا.",
    },
    /** The frame's card once sent: the next action, not "sent" again. */
    next: {
      en: "Next: we pick the time for your Brand Blueprint call",
      ar: "الخطوة الجاية: نختار وقت مكالمة بناء الهوية والعرض",
    },
    doneThen: {
      en: "Our team starts on your setup and your Brand Blueprint call, and the next step reaches your WhatsApp group.",
      ar: "فريقنا يبدي بتجهيز حسابكم ومكالمة بناء الهوية والعرض، وتوصلكم الخطوة الجاية بقروب الواتساب.",
    },
    /** On record already: never a fresh form. */
    have: {
      en: "We already have it, so there's nothing to fill in now.",
      ar: "النموذج وصلنا من قبل، فما فيه شي نعبيه الحين.",
    },
    change: {
      en: "Want to change an answer? Tell us in your WhatsApp group.",
      ar: "تبون تغيرون أي جواب؟ قولوا لنا بقروب الواتساب.",
    },
    /** The frame's label, beside the client's name. */
    frame: { en: "Kickoff form", ar: "نموذج بداية الشغل" },
    /**
     * The form is Typeform's own, in English: the Arabic deck says so in
     * the frame's head (score round 3), so its English questions are no
     * surprise.
     */
    formLang: { en: "In English", ar: "النموذج بالإنجليزي" },
    sentAt: { en: "Sent at {time}", ar: "انرسل الساعة {time}" },
    rehearsal: {
      en: "Rehearsal: nothing is sent",
      ar: "بروفة: ما ينرسل شي",
    },
    opening: {
      en: "Opening your kickoff form",
      ar: "نفتح نموذج بداية الشغل",
    },
    /** The form could not open on the canvas: the CSM opens it from the notes window. */
    away: {
      en: "We'll open your kickoff form from our side.",
      ar: "بنفتح نموذج بداية الشغل من عندنا.",
    },
    /** The slide outside the call (prep's preview): where the form opens. */
    here: {
      en: "Your kickoff form opens here.",
      ar: "نموذج بداية الشغل ينفتح هنا.",
    },
    /**
     * Over the form while the CSM fills its internal answers (the ad money,
     * the payment, the recording link): the client sees this card, never
     * those questions.
     */
    cover: {
      en: "A few answers for our team, filled in on our side.",
      ar: "كم جواب لفريقنا، نعبيها من عندنا.",
    },
    recordHead: { en: "Kickoff on record", ar: "نموذج بداية الشغل عندنا" },
    filledOn: { en: "Filled on {date}", ar: "تعبّى يوم {date}" },
    rows: {
      service: {
        en: "The service we advertise",
        ar: "الخدمة اللي نعلن عنها",
      },
      page: { en: "Your Page name", ar: "اسم صفحتكم" },
      starter: { en: "Starter ads", ar: "إعلانات البداية" },
    },
    starter: {
      approved: { en: "Approved", ar: "وافقتوا عليها" },
      pending: { en: "You see them first", ar: "تشوفونها أول" },
      declined: { en: "Your own ads first", ar: "إعلاناتكم الخاصة أول" },
    },
  },
} as const;

/** The onboarding deck's slide titles, in order (the overview and the notes). */
export const O_TITLES = {
  welcome: O.welcome.title,
  goals: O.goals.title,
  team: O.team.title,
  "one-service": O.one.title,
  road: O.road.title,
  "this-week": O.week.title,
  next: O.next.title,
  kickoff: O.kickoff.title,
} as const;

// ----------------------------------------------------- presenter notes

/**
 * What the CSM says, slide by slide (CONTENT.md "Notes"), and the lines to
 * say aloud when the call is in Arabic (CONTENT-AR.md "Spoken lines"). They
 * live in the notes window only, never on the canvas.
 */
export interface SlideNotes {
  say: string[];
  sayAr: string[];
  /**
   * The pushback handle (creative flexibility): said only if the client
   * pushes back, so the notes window keeps it under one "If they push
   * back" disclosure instead of in the stop-by-stop track.
   */
  push?: string[];
  pushAr?: string[];
  temp?: L;
  dwy?: string[];
}

export const O_NOTES: Record<keyof typeof O_TITLES, SlideNotes> = {
  welcome: {
    say: [
      "Thank them for their time. Introduce yourself by name. Everyone else on the team is introduced by role on slide 3.",
      'Frame the call: "About 45 minutes. A few slides first, then we set most things up together, live."',
      "Check who is on the call. If the owner isn't there, ask who decides on the ads and who meets the customers.",
      "Say the call is recorded for the team.",
      "The kickoff form is the deck's last slide: you fill it in with them before you hang up.",
      "Point at the three: by the end of this call, these are done.",
    ],
    sayAr: [
      "شكراً على وقتكم. أنا {csm}، وباقي الفريق بتتعرفون عليهم بأدوارهم بعد شوي.",
      "المكالمة تقريباً ٤٥ دقيقة. نمر على كم شريحة، وبعدها نجهّز أغلب الأشياء مع بعض، على المكالمة نفسها.",
      "مين معنا اليوم؟ ومين اللي يقرر بخصوص الإعلانات، ومين اللي يقابل العملاء؟",
      "للعلم، المكالمة مسجلة عشان الفريق يرجع لها.",
      "هذي الثلاث بنخلصها قبل لا نسكر المكالمة.",
    ],
  },
  goals: {
    say: [
      "Read their goals back. Don't re-ask anything they already answered.",
      "If a goal is a number, don't endorse it and don't argue with it. \"We'll set targets together once the first meetings come in.\"",
      "Don't put a number on what's realistic (projects a month). It depends on the offer, the area and how they follow up.",
      "Remember the top challenge. It comes back when you choose the service on slide 4.",
      "Stop 1: read their goal back, then pause. Stop 2: the rest of their answers.",
    ],
    sayAr: [
      "(Stop 1) خلوني أقرا لكم هدفكم مثل ما كتبتوه.",
      "(If a goal is a number) بنحط الأهداف مع بعض أول ما توصل أول المواعيد.",
    ],
    temp: {
      en: "Did we get that right? Anything to change?",
      ar: "فهمناكم صح؟ تبون تغيرون شي؟",
    },
  },
  team: {
    say: [
      "One sentence per role. Each person messages them about one thing; anything else goes to you.",
      "Roles, not names. Your own name is on the cover.",
      "Friday is off. Messages after 6 are answered the next working day.",
      '"2 working hours" counts only the hours we work: a message at 5:30 may be answered the next morning.',
      "Check the group now: whoever handles their schedule and whoever meets the customers should both be in it. Add anyone missing before you move on.",
      'The group fills as the slide opens: "Everyone who works on your account is in this one group." Then go down the five roles. Stop 2 is the promise: say the reply time.',
    ],
    sayAr: [
      "كل واحد بالقروب يكلمكم عن شي واحد. وأنا نقطة تواصلكم معنا، لأي شي ثاني.",
      "الجمعة إجازة، والرسايل اللي توصل بعد الساعة ٦ نرد عليها بأول يوم دوام بعدها.",
      "والساعتين تنحسب من ساعات دوامنا بس: الرسالة اللي توصل الساعة خمس ونص، ممكن نرد عليها الصبح.",
      "خلنا نتأكد إن اللي يرتب مواعيدكم، واللي يقابل العملاء، موجودين بالقروب الحين.",
      "(Stop 1, once the group has filled) هذا قروبكم، والفريق كله فيه. خلوني أعرفكم عليهم واحد واحد.",
      "(Stop 2) ونرد خلال ساعتين دوام.",
    ],
  },
  "one-service": {
    say: [
      "The rows are the five main services we run campaigns for, the same choices as the kickoff form's 'Which service are we advertising?', so what they pick here is your answer there.",
      "The band starts on the service their answers point to. Their own words (kitchens, majlis, a villa fit-out) sit quietly under the service they belong to: a kitchen is part of a service, never the service.",
      "Ask the three questions out loud for the two or three services they really offer. Steer toward the one that passes all three. If none does, take the easiest to sell.",
      "Other shows only when some of their words fit none of the five. Pick it only if that is truly what they sell, in their words.",
      "Why one: the ads, the form questions and the call script are all written for one buyer.",
      "The choice carries through: it's the service in the launch deck and in the example call.",
      "The phone shows an example ad for this service, under their name and logo, and it says Example ad above it. Say so: 'This is how an ad for {service} looks under your name. Your own ads come from your content.'",
      "If you set a service in prep, the column shows it as a suggestion, its name on a dashed line, and the checklist keeps it open. Let them choose.",
      "When they choose, press Launch with this. The phone changes to the service they chose, and the checklist ticks it.",
    ],
    sayAr: [
      "هذي الخدمات الخمس الأساسية اللي نسوي لها حملات. أي وحدة فيها الأسهل بالبيع؟ وأي وحدة تجيب لكم أكثر ربح؟ وأي وحدة الأريح لكم بالتنفيذ؟",
      "الإعلانات وأسئلة النموذج وسكربت المكالمة، كلها تنكتب لنوع واحد من العملاء.",
      "وهالخدمة نفسها بتكون بمكالمة الإطلاق، وبمثال المكالمة اللي بنوريكم إياه.",
      "هذا مثال لإعلان عن {service} باسمكم. إعلاناتكم الخاصة نسويها من محتواكم.",
    ],
    temp: {
      en: "Happy to start with {service}?",
      ar: "مرتاحين نبدي بخدمة {service}؟",
    },
  },
  road: {
    say: [
      "Stop 4 is the Brand Blueprint call. Name it here; slide 7 says what it is.",
      "Don't give a launch date unless it's booked. It depends on access, content and approvals.",
      "As each step finishes, we send the next one to their WhatsApp group.",
    ],
    sayAr: [
      "(If they ask for a launch date) تاريخ الإطلاق نثبته لما تكتمل الصلاحيات والمحتوى والموافقات.",
      "ومع كل خطوة تخلص، يوصلكم الجزء اللي بعدها من هالطريق بقروب الواتساب.",
    ],
    dwy: [
      "Steps 2 to 5 arrive in the group; the first appointments step is yours to run.",
      "(Arabic) من الخطوة الثانية إلى الخامسة توصلكم بالقروب، وخطوة أول المواعيد يمشيها فريقكم.",
    ],
  },
  "this-week": {
    say: [
      "Say it as you open the slide: most of this we'll do together, right now.",
      "When the access cards are done, the checklist at the foot ticks 'Your access'. Say it: that's the step that most often holds a launch up.",
      "Do rows 1 and 2 now, on this call, and tick each one as it finishes. Most clients leave the onboarding call with these still open, and that is what delays a launch.",
      "Content: say it once, here. The more they upload before the Blueprint, the better the first ads.",
      "Past enquiries: no promise. Agree on the Blueprint call or in the group whether we call them.",
      "Anything left open: agree who does it and by when, and write it in the kickoff form.",
      "Don't link this list to the contract or to any guarantee.",
    ],
    sayAr: [
      "(As the slide opens) وأغلب هذا بنسويه مع بعض، على المكالمة نفسها.",
      "خلنا نخلص صلاحيات ميتا ومنصة Mahara OS الحين.",
      "لما نخلص بطاقات الصلاحيات، تنحط علامة صح على الصلاحيات تحت. وهذي أكثر خطوة تأخر الإطلاق عادةً.",
      "كل ما رفعتوا محتوى أكثر قبل مكالمة بناء الهوية، طلعت أول إعلاناتكم أحسن.",
      "الاستفسارات القديمة نتفق عليها بمكالمة بناء الهوية أو بالقروب، إذا نتصل عليهم ولا لا.",
      "(For anything left open) هذي مين بيخلصها، ومتى؟",
    ],
  },
  next: {
    say: [
      "Most clients want to see the starter ads first (3 of 4 recent kickoffs). If they do, go to stop 2.",
      "Approval of starter ads names the ads, the offer and the Page they run under; what the client checks in an ad is the facts, prices and claims. No answer is not approval.",
      'Red lines: type them in their words ("never show prices"), just under the test\'s line. They come back on the launch call.',
      'The testing, in one breath: "We make a lot of ads and switch most of them off, so we can find the ones that work. Your red lines are the part that never changes." Plant it and move on: the launch call sets the rest, and the red lines you type now are what you\'ll go back to if they push back there.',
      "Before we make anything: their ideas, the offer and the facts (prices, services, areas) go into the Blueprint call, or in the group before it. That is the easy way to shape the ads before they exist.",
      "Book the Blueprint before you hang up.",
      "Stop 1: the small pictures are example ads, not theirs: most get switched off, a few keep running. That's the test.",
      "The last stop: read the checklist back. If one is still open, agree who finishes it and by when, and write it in the kickoff form on the next slide.",
    ],
    sayAr: [
      "تبون تشوفون إعلانات البداية الحين؟",
      "فيه شي ما تبونا نقوله أو نوريه أبد؟ قولوه بكلامكم، وأنا أكتبه.",
      "(The testing, in one breath) نسوي إعلانات كثيرة ونوقف أغلبها، عشان نلقى اللي يشتغل. وخطوطكم الحمراء هي الشي الوحيد اللي ما يتغير.",
      "(Before we make anything) قبل لا نسوي أي إعلان: أفكاركم، وعرضكم، والمعلومات مثل الأسعار والخدمات والمناطق، قولوها بمكالمة بناء الهوية والعرض، أو أرسلوها بالقروب قبلها.",
      "خلنا نحجز مكالمة بناء الهوية والعرض الحين.",
      "(Stop 1, the strip) هالصور الصغيرة أمثلة لإعلانات، مو إعلاناتكم: أغلبها نوقفه، وكم واحد يكمل. وهذا هو الاختبار.",
      "(The last stop) خلونا نمر على اللي خلصناه اليوم. وإذا باقي شي، نتفق مين يخلصه ومتى.",
    ],
    temp: {
      en: "Anything you're unsure about before we book the Blueprint?",
      ar: "فيه شي مو واضح لكم قبل لا نحجز مكالمة بناء الهوية؟",
    },
  },
  kickoff: {
    say: [
      "Share the deck window as it is: the form is theirs to see. The card's facts, the payment and the sale's notes stay in this window, under Kickoff.",
      "Their onboarding answers are read back in the form's first groups. Ask them to check each one as you go.",
      "The service: the one they chose on slide 4. The rest of the form's order is below, each with where it came from.",
      "At the end, copy the call recording link and the payment amount from below into the last two questions, then press Submit with them.",
      "Once it's sent, the checklist ticks the Blueprint call. Press Book the Brand Blueprint call (the form's last screen, or below) and pick the time with them.",
      "If the slide says Kickoff on record, don't send another. Read what was filled below, and fix a wrong answer in Typeform's results.",
    ],
    sayAr: [
      "هذا نموذج بداية الشغل. تفاصيلكم موجودة فيه من نموذج التعريف بالنشاط، فبس نراجعها مع بعض.",
      "تأكدوا من الأجوبة، وإذا شي تغير قولوا لي وأعدله الحين.",
      "(Once it's sent) تمام، انرسل. خلنا نختار وقت مكالمة بناء الهوية والعرض الحين.",
      "(Kickoff on record) نموذج بداية الشغل وصلنا من قبل. وإذا تبون تغيرون أي جواب، قولوا لنا بالقروب.",
    ],
    temp: {
      en: "Anything in the form you'd like to change before we send it?",
      ar: "فيه شي بالنموذج تبون تغيرونه قبل لا نرسله؟",
    },
  },
};

/**
 * The lines the CSM pastes into the client's WhatsApp group, in the deck's
 * language (CONTENT O6 and L7, CONTENT-AR). Filled without Arabic isolates:
 * a link must stay one clickable run in WhatsApp.
 */
export const GROUP_LINKS = {
  meta: {
    en: "Meta access (one link): {url}",
    ar: "صلاحيات ميتا (رابط واحد): {url}",
  },
  drive: { en: "Your Drive folder: {url}", ar: "مجلد الدرايف: {url}" },
  academy: { en: "The Academy: {url}", ar: "الأكاديمية: {url}" },
  portal: { en: "Mahara OS: {url}", ar: "Mahara OS: {url}" },
  install: {
    en: "Install Mahara OS on your phone: {url}",
    ar: "نزّلوا Mahara OS على جوالكم مثل أي تطبيق: {url}",
  },
  installShort: {
    en: "Install it on your phone: {url}",
    ar: "نزّلوه على جوالكم مثل أي تطبيق: {url}",
  },
  /** The six jobs recap's last line: the course before the first meetings. */
  academyFirst: {
    en: "Before your first meetings: Project Closing Mastery in the Academy: {url}",
    ar: "قبل أول مواعيدكم: كورس إتقان توقيع المشاريع في الأكاديمية: {url}",
  },
  /**
   * The launch recap's testing line (the spec review, 2026-10-20): slide 3's
   * agreement in writing, for the CSM to point to when the ads reach the group.
   */
  testing: {
    en: "How we test your ads: your red lines stay fixed, your ideas go in the group before the next round, you check the facts, prices and claims before an ad goes live, and small style changes go into the next round so your launch doesn't wait. New photos and videos help: send them whenever you can.",
    ar: "كيف نختبر إعلاناتكم: خطوطكم الحمراء ثابتة، وأفكاركم ترسلونها بالقروب قبل الإعلانات الجاية، وتراجعون المعلومات والأسعار والوعود قبل لا ينزل الإعلان، والتعديلات الصغيرة على الشكل تروح للإعلانات الجاية عشان إطلاقكم ما يتأخر. وأي صور أو فيديوهات جديدة، أرسلوها كل ما قدرتوا.",
  },
  /**
   * Two lines the recap always carries (the fixer's round, 2026-10-20):
   * slide 12's money and slide 11's first weeks, in writing, for a client
   * who missed them on the call while their videos are not recorded yet.
   */
  payments: {
    en: "Keep your ad card funded. Your payments to us are on the dates in your agreement.",
    ar: "خلوا بطاقة الإعلانات فيها رصيد. ودفعاتكم لنا بالتواريخ المكتوبة في عقدكم.",
  },
  firstWeeks: {
    en: "The first weeks are usually slower while the ads find your audience. Leave them running.",
    ar: "أول الأسابيع عادةً تكون أهدأ، لين تتعرف الإعلانات على جمهوركم. خلوها شغالة.",
  },
  /**
   * Who does what, in writing (score round 2), while the launch deck's
   * start-to-finish, call-team and winning videos are not all recorded: a
   * client who missed the journey, the call or the pie still has it. Left
   * out once all three are recorded and shown for this client.
   */
  whoDoesWhat: {
    en: "Who does what: we bring the enquiries, call them within 5 minutes during working hours, book and remind them, and rebook anyone who doesn't show. You hold the meeting and win the project.",
    ar: "مين يسوي إيش: نجيب لكم الاستفسارات، ونتصل عليهم خلال ٥ دقايق في أوقات الدوام، ونحجز لهم ونذكّرهم قبل الموعد، واللي ما يحضر نتصل عليه ونحجز له من جديد. وأنتم تقابلونهم، وتوقيع المشروع عليكم.",
  },
  whoDoesWhatDwy: {
    en: "Who does what: we bring the enquiries. Your team calls them within 5 minutes and books them on the right calendar, and the confirmation goes out by itself. You hold the meeting and win the project.",
    ar: "مين يسوي إيش: نجيب لكم الاستفسارات، وفريقكم يتصل عليهم خلال ٥ دقايق ويحجز لهم على التقويم الصح، والتأكيد يطلع للعميل تلقائياً. وأنتم تقابلونهم، وتوقيع المشروع عليكم.",
  },
  /**
   * O7's creative-flexibility plant in writing, in the onboarding links,
   * while the onboarding testing video is not recorded (score round 2):
   * O7 is the slide most often rushed.
   */
  testingShort: {
    en: "Your ads are there to bring in business. We test many ads, fast, and small style changes go into the next round. Send your red lines in the group.",
    ar: "إعلاناتكم هدفها تجيب لكم شغل. نختبر إعلانات كثيرة وبسرعة، والتعديلات الصغيرة على الشكل تروح للإعلانات الجاية. وأرسلوا خطوطكم الحمراء بالقروب.",
  },
  /** The recap's last block: every recorded video shown for this client. */
  watch: {
    en: "Missed something on the call? Watch:",
    ar: "فاتكم شي بالمكالمة؟ شوفوا:",
  },
} as const;

/**
 * The deck's video slots (CONTENT "Video slots", CONTENT-AR "Video slots",
 * DESIGN 21.2 and 21.3): the slots' titles, the quiet control on the
 * canvas, the player's lines. The registry itself is in videos.ts.
 */
export const VIDEO = {
  /** Each slot's title, by `deck:slot` (the registry's keys). */
  titles: {
    "onboarding:welcome": {
      en: "Welcome to Mahara",
      ar: "حياكم الله في مهارة",
    },
    "onboarding:meta-access": { en: "Meta access", ar: "صلاحيات ميتا" },
    "onboarding:whatsapp-calendar": {
      en: "WhatsApp and calendar",
      ar: "الواتساب والتقويم",
    },
    "onboarding:testing": {
      en: "Why we test so many ads",
      ar: "ليش نختبر إعلانات كثيرة",
    },
    "launch:start-to-finish": {
      en: "How it works, start to finish",
      ar: "كيف يمشي كل شي، من البداية للنهاية",
    },
    "launch:testing": {
      en: "Why we test so many ads",
      ar: "ليش نختبر إعلانات كثيرة",
    },
    "launch:call-team": {
      en: "How our call team works",
      ar: "كيف يشتغل فريق الاتصال",
    },
    "launch:winning": {
      en: "Your part in winning the project",
      ar: "دوركم في توقيع المشروع",
    },
    "launch:portal-guide": {
      en: "The Mahara OS guide",
      ar: "دليل Mahara OS",
    },
    "launch:calendar-hours": {
      en: "Blocking hours in your calendar",
      ar: "كيف تسكرون الساعات بالتقويم",
    },
    "launch:first-90-days": {
      en: "Your first 90 days",
      ar: "أول ٩٠ يوم",
    },
    "launch:payments": { en: "How payments work", ar: "كيف تمشي الدفعات" },
  } as Record<string, L>,
  /** The control's lead, said once before one or two videos. */
  watch: { en: "Watch:", ar: "شوفوا:" },
  /** The control's accessible name. */
  label: {
    en: "Watch the video: {title}, {length}",
    ar: "شوفوا الفيديو: {title}، {length}",
  },
  labelBare: { en: "Watch the video: {title}", ar: "شوفوا الفيديو: {title}" },
  /** A length in Arabic is said in words, never m:ss (CONTENT-AR decision 13). */
  minutes: {
    under: { ar: "أقل من دقيقة" },
    one: { ar: "دقيقة" },
    two: { ar: "دقيقتين" },
    few: { ar: "{n} دقايق" },
    many: { ar: "{n} دقيقة" },
  },
  close: { en: "Close", ar: "إغلاق" },
  loading: { en: "Loading the video", ar: "نحمّل الفيديو" },
  failed: {
    en: "The video didn't load. We'll send you the link in the group.",
    ar: "ما اشتغل الفيديو. بنرسل لكم الرابط بالقروب.",
  },
  blocked: {
    en: "This video can't play here. We'll send you the link in the group.",
    ar: "هالفيديو ما يشتغل هنا. بنرسل لكم الرابط بالقروب.",
  },
} as const;

/** Static links the CSM copies into the client's group (CONTENT data map). */
export const LINKS = {
  leadsie: "https://app.leadsie.com/connect/maharamedia/manage",
  academy: "https://www.skool.com/premium-projects-academy-3669",
  portal: "https://portal.maharamedia.com",
  portalInstall: "https://portal.maharamedia.com/install",
  /** The clean sample call script (the sales deck's SCRIPTS_DOC), for done with you. */
  scriptsDoc:
    "https://docs.google.com/document/d/1QUIEoIIcM8285aJWLWQlkanSigAsp9B29QFPck1bnIo/view",
} as const;

// ------------------------------------------------------- the journey

/** Who does a step: the journey's three lanes (DESIGN 6). */
export type LaneKey = "customer" | "us" | "you";
export const LANES: LaneKey[] = ["customer", "us", "you"];

/**
 * The journey's seven steps, by row name (CONTENT L2, CONTENT-AR L2). Done
 * with you moves steps 3 and 4 into the client's lane and renames them.
 */
export const JOURNEY = {
  title: { en: "Your customer's journey", ar: "رحلة عميلكم" },
  line: {
    en: "From your ad to your meeting, step by step.",
    ar: "من إعلانكم لين موعدكم، خطوة بخطوة.",
  },
  rows: [
    { key: "ad", name: { en: "Sees your ad", ar: "يشوف إعلانكم" } },
    {
      key: "form",
      name: { en: "Answers your questions", ar: "يجاوب على أسئلتكم" },
    },
    {
      key: "call",
      name: { en: "We call", ar: "نتصل عليه" },
      dwy: { en: "Your team calls", ar: "فريقكم يتصل" },
    },
    {
      key: "booked",
      name: { en: "Booked, confirmed, reminded", ar: "ينحجز ويتأكد ونذكّره" },
      dwy: { en: "Your team books", ar: "فريقكم يحجز" },
    },
    { key: "lands", name: { en: "Lands with you", ar: "يوصلكم" } },
    { key: "meet", name: { en: "You meet", ar: "تقابلونه" } },
    { key: "mark", name: { en: "You mark it", ar: "تسجلون النتيجة" } },
  ] as { key: string; name: L; dwy?: L }[],
} as const;

/** Each step's lane: done for you, or done with you (DESIGN 6.3, 6.8). */
export function journeyOwners(dwy: boolean): LaneKey[] {
  return dwy
    ? ["customer", "customer", "you", "you", "you", "you", "you"]
    : ["customer", "customer", "us", "us", "you", "you", "you"];
}

/** A step's row name in the deck's service model. */
export const journeyName = (i: number, dwy: boolean): L => {
  const row = JOURNEY.rows[i];
  return (dwy && row.dwy) || row.name;
};

/** The decks' names, for the chrome and the presenter's windows. */
export const DECK_NAME: Record<"onboarding" | "launch" | "blueprint", L> = {
  onboarding: { en: "Onboarding", ar: "التعريف" },
  launch: { en: "Launch", ar: "الإطلاق" },
  blueprint: { en: "Brand Blueprint", ar: "بناء الهوية والعرض" },
};

export const CLOSED = { en: "Deck closed", ar: "انتهى العرض" } as const;

// ----------------------------------------------------------- launch deck

/**
 * The launch deck's words (CONTENT.md L1 to L10, CONTENT-AR.md "Launch
 * deck", DESIGN.md's canvas labels from CONTENT-AR's appendix). The example
 * call's own turns are in callScript.ts: they speak a dialect on purpose and
 * carry the fictional customer's budget band, so their copy rules differ.
 */
export const LAUNCH = {
  cover: {
    title: { en: "{name} goes live", ar: "انطلاقة {name}" },
    titleLive: { en: "{name} is live", ar: "انطلقنا مع {name}" },
    dateline: { en: "Launch call · {date}", ar: "مكالمة الإطلاق، {date}" },
    goLive: { en: "Go-live", ar: "الإطلاق" },
    line: {
      en: "Everything your customers will see, before they see it.",
      ar: "كل شي بيشوفه عملاؤكم، تشوفونه قبلهم.",
    },
    lineLive: {
      en: "Everything your customers see, and what happens next.",
      ar: "كل شي يشوفه عملاؤكم، واللي يصير بعدها.",
    },
    road: { en: "Launch call · Today", ar: "مكالمة الإطلاق، اليوم" },
    /**
     * The rail's label once go-live has passed (the fixer's round): the rail
     * is lit to its end, and the label says both facts, so "is live" and
     * the rail agree.
     */
    roadLive: {
      en: "Live since {date} · Launch call today",
      ar: "منطلقين من {date}، ومكالمة الإطلاق اليوم",
    },
  },
  journey: {
    stops: [
      {
        line: {
          en: "They see your ad in their feed.",
          ar: "يشوف إعلانكم وهو يقلّب جواله.",
        },
      },
      {
        line: {
          en: "A few short questions about their project, then your thank-you screen.",
          ar: "يجاوب على كم سؤال قصير عن مشروعه، وبعدها تطلع له صفحة الشكر.",
        },
        /** When the ad opens a WhatsApp chat instead of a form. */
        whatsapp: {
          en: "They message you on WhatsApp. The chat opens with their first message ready to send.",
          ar: "يراسلكم على الواتساب. المحادثة تفتح ورسالته الأولى جاهزة يرسلها.",
        },
      },
      {
        line: {
          en: "We call new enquiries within 5 minutes during working hours, 10 to 6, Saturday to Thursday. Anything that comes in at night is called from 10 the next working morning.",
          ar: "نتصل على الاستفسارات الجديدة خلال ٥ دقايق في أوقات الدوام: من ١٠ صباحاً إلى ٦ مساءً، من السبت إلى الخميس. واللي يوصل بالليل، نتصل عليه من الساعة ١٠ صباح أول يوم دوام.",
        },
        lineUae: {
          en: "We call new enquiries within 5 minutes during working hours, 10 to 6 Saudi time (11 to 7 in the UAE), Saturday to Thursday. Anything that comes in at night is called from 10 the next working morning.",
          ar: "نتصل على الاستفسارات الجديدة خلال ٥ دقايق في أوقات الدوام: من ١٠ صباحاً إلى ٦ مساءً بتوقيت السعودية (من ١١ إلى ٧ بتوقيت الإمارات)، من السبت إلى الخميس. واللي يوصل بالليل، نتصل عليه من الساعة ١٠ صباح أول يوم دوام.",
        },
        dwy: {
          en: "A new-enquiry alert reaches your callers' phones and your WhatsApp group. Call within 5 minutes. Up to 4 tries over 3 working days.",
          ar: "تنبيه الاستفسار الجديد يوصل لجوالات فريق الاتصال عندكم وللقروب. اتصلوا خلال ٥ دقايق. لين ٤ محاولات خلال ٣ أيام دوام.",
        },
      },
      {
        line: {
          en: "The serious ones are booked in, confirmed on WhatsApp and reminded before the meeting.",
          ar: "الجادين نحجز لهم، ويوصلهم تأكيد على الواتساب، ونذكّرهم قبل الموعد.",
        },
        video: {
          en: "The serious ones are booked in, confirmed on WhatsApp with a short video about you, and reminded before the meeting.",
          ar: "الجادين نحجز لهم، ويوصلهم تأكيد على الواتساب ومعاه فيديو قصير يعرّف عنكم، ونذكّرهم قبل الموعد.",
        },
        dwy: {
          en: "Book on the right calendar. The confirmation goes out by itself.",
          ar: "احجزوا على التقويم الصح، والتأكيد يطلع للعميل تلقائياً.",
        },
      },
      {
        line: {
          en: "Once it's confirmed, it lands in your calendar and in Mahara OS. WhatsApp alerts tell you about new bookings, cancellations and changes.",
          ar: "لما يتأكد الموعد، ينزل بتقويمكم وفي Mahara OS. وتوصلكم تنبيهات على الواتساب بالمواعيد الجديدة، وبأي إلغاء أو تغيير.",
        },
        dwy: {
          en: "It lands in your calendar and your CRM, with your caller's notes.",
          ar: "الموعد ينزل بتقويمكم وفي الـCRM، ومعاه ملاحظات فريق الاتصال عندكم.",
        },
      },
      {
        line: {
          en: "You hold the meeting: {places}.",
          ar: "تقابلونه: {places}.",
        },
      },
      {
        line: {
          en: "You mark how it went, in a few taps.",
          ar: "تسجلون كيف راح الموعد، بكم ضغطة.",
        },
        dwy: {
          en: "Your team moves it to the right stage in the CRM, the same day.",
          ar: "فريقكم ينقله للمرحلة الصح في الـCRM، بنفس اليوم.",
        },
      },
    ] as { line: L; lineUae?: L; video?: L; dwy?: L; whatsapp?: L }[],
    tries: {
      en: "Up to 4 tries over 3 working days",
      ar: "لين ٤ محاولات خلال ٣ أيام دوام",
    },
    notAll: {
      en: "Not every enquiry books. Some can't be reached, some aren't a fit. Our caller notes why, and we go through it with you at check-ins.",
      ar: "مو كل استفسار ينحجز له موعد. فيه ناس ما نقدر نوصل لهم، وفيه ناس ما يناسبونكم. وفريق الاتصال يكتب السبب، ونمر عليه معكم بمكالمات المتابعة.",
    },
    noCalendar: {
      en: "Connect Google Calendar in Mahara OS so bookings land there.",
      ar: "اربطوا تقويم قوقل في Mahara OS عشان المواعيد تنزل فيه.",
    },
    places: {
      office: { en: "at your office", ar: "في مكتبكم" },
      home: { en: "at their home", ar: "في بيت العميل" },
      online: { en: "online", ar: "أونلاين" },
    },
    or: { en: "or", ar: "أو" },
    fork: {
      /** The same words as the CRM's stage ("Didn't show"), asked. */
      noShow: { en: "Didn't show?", ar: "ما حضر؟" },
      noShowLine: {
        en: "Ours. We call to rebook.",
        ar: "علينا. نتصل عليه ونحجز له من جديد.",
      },
      noShowDwy: {
        en: "The follow-up messages start by themselves.",
        ar: "رسايل المتابعة تبدي تلقائياً.",
      },
      deciding: { en: "Came, still thinking it over?", ar: "حضر وقاعد يفكر؟" },
      /**
       * Done for you, both of us follow them up: our caller calls, and the
       * client too, who knows the customer best; the client marks it. The
       * first sentence is ours and theirs together, drawn in teal.
       */
      decidingLine: {
        en: "Both of us. We call to follow up, and so do you: you know them best. Then mark it.",
        ar: "علينا وعليكم. نتصل عليه ونتابع معه، وأنتم بعد تتابعونه، لأنكم تعرفونه أكثر. وبعدها سجلوا النتيجة.",
      },
      decidingDwy: {
        en: "Follow up, then move it to the right stage.",
        ar: "تابعوه، وبعدها انقلوه للمرحلة الصح.",
      },
    },
    queue: {
      fresh: { en: "New enquiry · {service}", ar: "استفسار جديد، {service}" },
      /** Done with you, the new row's one chip says who calls (the stop's words say how fast). */
      topDwy: { en: "Your team", ar: "فريقكم" },
      second: {
        en: "Try 2 of 4 · {service} · 5 pm",
        ar: "المحاولة ٢ من ٤، {service}، ٥ مساءً",
      },
      callback: {
        en: "Callback · {service} · 10 am",
        ar: "معاودة اتصال، {service}، ١٠ صباحاً",
      },
      lost: {
        en: "Not reached after 4 tries · reason noted",
        ar: "ما ردّ بعد ٤ محاولات، السبب مكتوب",
      },
      night: {
        en: "Came in at night? Called from 10 the next working morning.",
        ar: "وصل بالليل؟ نتصل عليه من الساعة ١٠ صباح أول يوم دوام.",
      },
    },
    calendar: {
      block: { en: "Appointment · {place}", ar: "موعد، {place}" },
      /** An afternoon hour on the journey's calendar card. */
      hour: { en: "{h} pm", ar: "{h} مساءً" },
      hours: [
        { en: "2 pm", ar: "٢ مساءً" },
        { en: "3 pm", ar: "٣ مساءً" },
        { en: "4 pm", ar: "٤ مساءً" },
        { en: "5 pm", ar: "٥ مساءً" },
      ],
    },
  },
  ads: {
    owner: { en: "Your customer sees this", ar: "هذا اللي يشوفه عميلكم" },
    title: { en: "Your ads", ar: "إعلاناتكم" },
    line: {
      en: "We can show any of your creatives in the phones, right now.",
      ar: "نقدر نوريكم أي تصميم من تصاميمكم على الجوالات، الحين.",
    },
    /** No creative in the tray yet: what the phones show, never a promise of "right now". */
    lineEmpty: {
      en: "How your ads will look on your customers' phones.",
      ar: "بهالشكل بتطلع إعلاناتكم على جوالات عملائكم.",
    },
    /**
     * Every phone shows the example (no creative of theirs yet): where the
     * ads will show, never "how they will look", which would call the
     * example their look (the spec review).
     */
    lineExample: {
      en: "Where your ads will show on your customers' phones.",
      ar: "هذي الأماكن اللي بتطلع فيها إعلاناتكم على جوالات عملائكم.",
    },
    tray: { en: "Your creatives", ar: "تصاميم إعلاناتكم" },
    uploaded: { en: "Uploaded", ar: "المرفوعة" },
    meta: { en: "From your Meta ads", ar: "من إعلاناتكم في ميتا" },
    empty: {
      en: "We're finishing your first ads",
      ar: "نشتغل على أول إعلاناتكم الحين",
    },
    metaEmpty: {
      en: "Nothing built in Meta yet.",
      ar: "ما انبنى شي في ميتا للحين.",
    },
    /** The short form of "Starter, from our templates" on a tray thumbnail. */
    starterChip: { en: "Template", ar: "قالب" },
    planned: {
      en: "Planned next: {platforms}",
      ar: "الخطوة الجاية: {platforms}",
    },
    foot: {
      en: "Previews. Meta fits each ad to the screen it shows on.",
      ar: "معاينات. ميتا تضبط كل إعلان على الشاشة اللي يطلع فيها.",
    },
    /** Under the phones when they show the example (the title's tag says what they are). */
    footExample: {
      en: "Meta fits each ad to the screen it shows on.",
      ar: "ميتا تضبط الإعلان على مقاس الشاشة اللي يطلع فيها.",
    },
    /** The same foot when the phones show starter ads: the tag, said once. */
    footStarter: {
      en: "Previews of starter ads, from our templates. Meta fits each ad to the screen it shows on.",
      ar: "معاينات لإعلانات البداية، من قوالبنا. ميتا تضبط كل إعلان على الشاشة اللي يطلع فيها.",
    },
    /** The phone a tray thumbnail is on (DESIGN 10.1). */
    onPhone: {
      feed: { en: "Feed", ar: "فيد" },
      reels: { en: "Reels", ar: "ريلز" },
      facebook: { en: "Facebook feed", ar: "فيد فيسبوك" },
    },
    leaders: {
      who: { en: "Your page and logo", ar: "صفحتكم وشعاركم" },
      /** {word} is the phone's "Sponsored", named in the deck's language. */
      sponsored: { en: "Marked {word}", ar: "مكتوب عليه {word}" },
      media: { en: "Your picture or video", ar: "صورتكم أو الفيديو" },
      words: { en: "Your words", ar: "كلامكم" },
      cta: { en: "The button: {cta}", ar: "الزر: {cta}" },
      crop: {
        en: "Meta crops this to 4:5 in the feed",
        ar: "ميتا تقص هذا على مقاس ٤:٥ في الفيد",
      },
    },
  },
  /**
   * L3, creative flexibility (CONTENT L3, DESIGN 21.1): five stops beside
   * one drawing, the field of ad tiles. The CEO, 2026-10-20: "Creative
   * flexibility is a big expectation", set before the ads go live.
   */
  test: {
    title: {
      en: "Your red lines are fixed. The rest, we test.",
      ar: "خطوطكم الحمراء ثابتة، والباقي نختبره.",
    },
    /** Stop 1: the ads' job. */
    job: {
      name: { en: "Your ads have one job", ar: "إعلاناتكم لها مهمة وحدة" },
      copy: {
        en: "Your page shows your brand. Your ads are there to bring in business: enquiries from people who don't know you yet.",
        ar: "صفحتكم تعرض هويتكم. وإعلاناتكم موجودة عشان تجيب لكم شغل: استفسارات من ناس ما يعرفونكم للحين.",
      },
      small: {
        en: "They show in people's feeds, marked Sponsored, not as posts on your page.",
        ar: "تطلع بالفيد ومكتوب عليها مُموَّل، وما تنزل كمنشور على صفحتكم.",
      },
    },
    /** Stop 2: the volume, and most of them switched off. */
    volume: {
      name: { en: "We test a lot, fast", ar: "نختبر كثير، وبسرعة" },
      copy: {
        en: "We make many versions and switch most of them off. That's how we find the few that work.",
        ar: "نسوي نسخ كثيرة، ونوقف أغلبها. وبهالطريقة نلقى النسخ القليلة اللي تشتغل.",
      },
      small: {
        en: "Each one tries something different: the hook, the angle, the format or who's on camera.",
        ar: "كل وحدة فيها شي مختلف: البداية اللي تشد، أو الزاوية، أو طريقة العرض، أو مين يطلع بالفيديو.",
      },
    },
    /** Stop 3: their input comes first, and the red lines it starts from. */
    input: {
      name: { en: "Your input comes first", ar: "نسمع منكم أول" },
      copy: {
        en: "Ideas, a new offer, a new price, something to change? Send it in the group before we make the next round.",
        ar: "عندكم فكرة، أو عرض جديد، أو سعر جديد، أو شي تبون تغيرونه؟ أرسلوه بالقروب قبل لا نسوي الإعلانات الجاية.",
      },
      offer: {
        en: "Keep your offer steady while a test runs. A new offer starts the test again.",
        ar: "خلوا عرضكم ثابت وقت الاختبار. العرض الجديد يرجّع الاختبار من البداية.",
      },
    },
    /** The field's next round (stops 3 to 5). */
    round: { en: "Next round", ar: "الإعلانات الجاية" },
    /** Stop 4: the check after the ads are made, as small as it can be. */
    check: {
      name: {
        en: "Then a quick check, not a redesign",
        ar: "بعدها مراجعة سريعة، مو تصميم من جديد",
      },
      /** One line, its middots in ink-3 (DESIGN 21.1): not steps. */
      words: [
        { en: "Facts", ar: "المعلومات" },
        { en: "Prices", ar: "الأسعار" },
        { en: "Claims", ar: "الوعود" },
      ],
      /** One small line under the three words (the two lines merged). */
      line: {
        en: "You check these in the group before an ad goes live.",
        ar: "تراجعونها بالقروب قبل لا ينزل الإعلان.",
      },
      style: {
        en: "Small style changes go into the next round, so your launch doesn't wait.",
        ar: "والتعديلات الصغيرة على الشكل تروح للإعلانات الجاية، عشان إطلاقكم ما يتأخر.",
      },
      /** The leader in the field, over the client's own tile. */
      change: { en: "Your style change", ar: "تعديلكم على الشكل" },
    },
    /** Stop 5: keep the content coming, with the why. */
    content: {
      name: {
        en: "Keep the content coming",
        ar: "خلوا المحتوى يوصلنا أول بأول",
      },
      copy: {
        en: "Send new photos and videos of your projects whenever you can. More content means more ads to test.",
        ar: "أرسلوا صور وفيديوهات جديدة لمشاريعكم كل ما قدرتوا. كل ما زاد المحتوى، زادت الإعلانات اللي نختبرها.",
      },
    },
    fixed: {
      name: { en: "Fixed: your red lines", ar: "الثابت: خطوطكم الحمراء" },
      /** The panel's two heads, the spec's pair (score round 2). */
      never: { en: "Never", ar: "أبداً" },
      always: { en: "Always", ar: "دايماً" },
      /** After a line they typed on O7, small, in ink-3. */
      told: { en: "you told us", ar: "قلتوا لنا" },
      /**
       * Card lines in the other script with no translation, quoted as
       * written (renamed in the visual pass: the source line now says
       * "From your card").
       */
      card: { en: "On your card, in Arabic", ar: "بملفكم، بالإنجليزي" },
      /** One source line under the red lines, whichever is true. */
      source: {
        both: {
          en: "From your card, and what you told us on the onboarding call.",
          ar: "من ملفكم، ومن اللي قلتوه لنا بمكالمة التعريف.",
        },
        card: { en: "From your card.", ar: "من ملفكم." },
        told: {
          en: "What you told us on the onboarding call.",
          ar: "اللي قلتوه لنا بمكالمة التعريف.",
        },
      },
      copy: {
        en: "We never cross these.",
        ar: "وهذي ما نتعداها أبد.",
      },
      fallback: {
        en: "No red lines written yet. Tell us now and we'll add them to your card.",
        ar: "ما عندنا خطوط حمراء مكتوبة للحين. قولوها لنا الحين، ونضيفها لملفكم.",
      },
      input: {
        en: "Your red lines, in your words",
        ar: "خطوطكم الحمراء، بكلامكم",
      },
    },
    open: {
      pick: {
        en: "Your pick runs too, beside the ones you'd skip. The numbers tell us which work.",
        ar: "اختياركم ينزل بعد، جنب اللي يمكن ما تختارونها. والأرقام هي اللي توضح لنا أي واحد يشتغل.",
      },
      pickNone: {
        en: "The ones you'd pick run too, beside the ones you'd skip. The numbers tell us which work.",
        ar: "اللي تختارونها تنزل بعد، جنب اللي يمكن ما تختارونها. والأرقام هي اللي توضح لنا أي واحد يشتغل.",
      },
    },
    stamp: {
      en: "Agreed to test this way · {date}",
      ar: "اتفقنا نختبر بهالطريقة، {date}",
    },
    /**
     * The pushback question (notes only), picked by the client's 90-day
     * goal: shown, on file but held back, or none (CONTENT L3).
     */
    ask: {
      shown: {
        en: 'You told us your goal is "{goal}". What matters more: this one change, or getting the ads live so we can get there?',
        ar: "قلتوا لنا إن هدفكم: {goal}. أيهم أهم لكم: هالتعديل، ولا إن الإعلانات تنزل عشان نوصل له؟",
      },
      held: {
        en: "You told us what you want from your first 90 days. What matters more: this one change, or getting the ads live so we can work towards it?",
        ar: "قلتوا لنا هدفكم لأول ٩٠ يوم. أيهم أهم لكم: هالتعديل، ولا إن الإعلانات تنزل عشان نشتغل عليه؟",
      },
      none: {
        en: "What matters more to you: this one change, or getting the ads live?",
        ar: "أيهم أهم لكم: هالتعديل، ولا إن الإعلانات تنزل؟",
      },
    },
    /**
     * "Copy reply": one line for pushback in the group, after the call,
     * picked like the question. Pasted into WhatsApp, so {goal} is filled
     * without isolates.
     */
    reply: {
      shown: {
        en: "Thanks, noted. You told us your goal is \"{goal}\", so we'd rather not hold your ads for a small style change: it goes into the next round. If a fact, price or claim is wrong, tell us and we'll fix it before the ad goes live.",
        ar: "شكراً، وصلتنا. قلتوا لنا إن هدفكم: {goal}. وما نبي إعلاناتكم تتأخر عشان تعديل صغير على الشكل، فبنحطه بالإعلانات الجاية. وأي معلومة أو سعر أو وعد غلط، قولوا لنا ونصلحه قبل لا ينزل الإعلان.",
      },
      held: {
        en: "Thanks, noted. You told us what you want from your first 90 days, so we'd rather not hold your ads for a small style change: it goes into the next round. If a fact, price or claim is wrong, tell us and we'll fix it before the ad goes live.",
        ar: "شكراً، وصلتنا. قلتوا لنا هدفكم لأول ٩٠ يوم، وما نبي إعلاناتكم تتأخر عشان تعديل صغير على الشكل، فبنحطه بالإعلانات الجاية. وأي معلومة أو سعر أو وعد غلط، قولوا لنا ونصلحه قبل لا ينزل الإعلان.",
      },
      none: {
        en: "Thanks, noted. We'd rather not hold your ads for a small style change: it goes into the next round. If a fact, price or claim is wrong, tell us and we'll fix it before the ad goes live.",
        ar: "شكراً، وصلتنا. ما نبي إعلاناتكم تتأخر عشان تعديل صغير على الشكل، فبنحطه بالإعلانات الجاية. وأي معلومة أو سعر أو وعد غلط، قولوا لنا ونصلحه قبل لا ينزل الإعلان.",
      },
    },
  },
  form: {
    owner: { en: "Your customer sees this", ar: "هذا اللي يشوفه عميلكم" },
    title: { en: "Your form", ar: "نموذج إعلانكم" },
    /** The ad opens WhatsApp, so there is no form (fixer round 2). */
    titleWhatsApp: { en: "Your WhatsApp chat", ar: "محادثة الواتساب" },
    line: {
      en: "What they answer before we call. Questions marked 'Filters' screen out people who aren't a fit.",
      ar: "اللي يجاوب عليه العميل قبل لا نتصل. والأسئلة اللي عليها فلتر تطلّع اللي ما يناسبونكم.",
    },
    lineDwy: {
      en: "What they answer before your team calls. Questions marked 'Filters' screen out people who aren't a fit.",
      ar: "اللي يجاوب عليه العميل قبل لا يتصل فريقكم. والأسئلة اللي عليها فلتر تطلّع اللي ما يناسبونكم.",
    },
    gate: { en: "Filters", ar: "فلتر" },
    page: { en: "Your page", ar: "صفحتكم" },
    stops: [
      { en: "Opening", ar: "البداية" },
      { en: "The questions", ar: "الأسئلة" },
      { en: "The thank-you screen", ar: "صفحة الشكر" },
    ],
    thanksLine: {
      en: "Then your thank-you screen, and a welcome message.",
      ar: "وبعدها صفحة الشكر، ورسالة ترحيب.",
    },
    thanksVideo: {
      en: "Then your thank-you screen, and a welcome message with a short video about you.",
      ar: "وبعدها صفحة الشكر، ورسالة ترحيب فيها فيديو قصير يعرّف عنكم.",
    },
    thanksDefault: {
      en: "Thank you. Our team will call you within 5 minutes during working hours.",
      ar: "شكراً لك. فريقنا بيتصل عليك خلال ٥ دقايق في أوقات الدوام.",
    },
    fallback: {
      en: "We're finishing yours.",
      ar: "نشتغل على نموذجكم.",
    },
    whatsapp: {
      en: "Your ad opens a WhatsApp chat.",
      ar: "إعلانكم يفتح محادثة واتساب.",
    },
    /**
     * The message a WhatsApp ad fills in for the customer, in the customer's
     * words, tagged "Example wording" until the ad's own template is read.
     */
    waMessage: {
      en: "Hi, I saw your ad. I'd like to know more about {service}.",
      ar: "السلام عليكم، شفت إعلانكم وأبي أعرف أكثر عن {service}.",
    },
    waMessageAny: {
      en: "Hi, I saw your ad and I'd like to know more.",
      ar: "السلام عليكم، شفت إعلانكم وأبي أعرف أكثر.",
    },
    waNextHead: { en: "What happens next", ar: "اللي يصير بعدها" },
    waNext: [
      {
        en: "Their first message is ready in the chat. They tap send.",
        ar: "رسالته الأولى جاهزة بالمحادثة، ويضغط إرسال.",
      },
      {
        en: "It arrives on your WhatsApp.",
        ar: "توصل على الواتساب عندكم.",
      },
    ],
    waNextUs: {
      en: "Our team calls them within 5 minutes during working hours.",
      ar: "وفريقنا يتصل عليه خلال ٥ دقايق في أوقات الدوام.",
    },
    waNextDwy: {
      en: "Your team calls them.",
      ar: "وفريقكم يتصل عليه.",
    },
    list: { en: "The questions", ar: "الأسئلة" },
    choice: { en: "Choice", ar: "اختيار" },
    thanksStep: {
      en: "Then: your thank-you screen",
      ar: "وبعدها: صفحة الشكر",
    },
    example: {
      greeting: {
        en: "Thanks for your interest. A few quick questions about your project.",
        ar: "شكراً على اهتمامك. كم سؤال سريع عن مشروعك.",
      },
      q1: { en: "Which service do you need?", ar: "أي خدمة تحتاج؟" },
      q1other: { en: "Something else", ar: "غيرها" },
      q2: { en: "When would you like to start?", ar: "متى تبي تبدي؟" },
      q2options: [
        { en: "Within a month", ar: "خلال شهر" },
        { en: "In 1 to 3 months", ar: "بعد شهر إلى ٣ شهور" },
        { en: "Not sure yet", ar: "للحين ما قررت" },
      ],
      q3: {
        en: "Is the project a home or a business?",
        ar: "المشروع بيت ولا محل تجاري؟",
      },
      q3options: [
        { en: "Home", ar: "بيت" },
        { en: "Business", ar: "تجاري" },
      ],
    },
  },
  call: {
    owner: { en: "Our team does this", ar: "هذا اللي يسويه فريقنا" },
    title: {
      en: "How we'll speak to your customers",
      ar: "كيف نكلم عملاءكم",
    },
    titleDwy: { en: "How your team should call", ar: "كيف يتصل فريقكم" },
    tag: {
      en: "Example written from our script",
      ar: "مثال مكتوب من سكربتنا",
    },
    tagDwy: { en: "Our script, for your team", ar: "سكربتنا، لفريقكم" },
    /** Under the call: what its tag cannot say (the tag already says where it came from). */
    label: {
      en: "The customer in it is made up.",
      ar: "العميل في هالمكالمة مو حقيقي.",
    },
    labelDwy: {
      en: "The customer in it is made up. The full script is in the playbook we give you.",
      ar: "العميل في هالمكالمة مو حقيقي، والسكربت كامل بالدليل اللي نعطيكم إياه.",
    },
    stages: [
      { en: "The opening", ar: "المقدمة" },
      { en: "Their goal", ar: "تحديد الهدف" },
      { en: "The details", ar: "التفاصيل" },
      { en: "What sets you apart", ar: "اللي يميزكم" },
      { en: "The booking", ar: "الحجز" },
      { en: "Locking it in", ar: "تثبيت الموعد" },
    ],
    card: { en: "Calling for {name}", ar: "نتصل باسم {name}" },
    cardDwy: { en: "Calling for {name}", ar: "اتصال باسم {name}" },
    clockOn: { en: "On the call", ar: "على المكالمة" },
    clockEnd: { en: "Call length", ar: "مدة المكالمة" },
    agent: { en: "Our caller", ar: "فريقنا" },
    agentDwy: { en: "Your caller", ar: "فريق الاتصال" },
    lead: { en: "Customer", ar: "العميل" },
    legend: {
      en: "Words in teal came from your files.",
      ar: "الكلمات الملونة من ملفاتكم.",
    },
    guide: {
      en: "Your caller's facts come from your call guide in Mahara OS. Check it, and fill in anything marked 'To give us'.",
      ar: "معلومات فريق الاتصال تجي من دليل مكالماتكم في Mahara OS. راجعوه، وكمّلوا أي شي عليه نحتاجه منكم.",
    },
    guideUnchecked: {
      en: "Send us anything marked 'To give us' in the group, and we'll add it to your call guide.",
      ar: "أرسلوا لنا بالقروب أي شي عليه نحتاجه منكم، ونضيفه لدليل مكالماتكم.",
    },
    stop7: {
      en: "After the call",
      ar: "بعد المكالمة",
    },
    stop8: { en: "What lands with you", ar: "اللي يوصلكم" },
    after: {
      heading: {
        en: "What we do before the meeting",
        ar: "اللي نسويه قبل الموعد",
      },
      /**
       * Done for you, under the heading: the launch call SOP's third
       * expectation, that the client doesn't message the customer before
       * the meeting (CONTENT L6, the spec review of 2026-10-20).
       */
      oneVoice: {
        en: "Before the meeting, the messages come from us, so your customer hears one voice.",
        ar: "قبل الموعد، الرسايل تطلع منا، عشان عميلكم يسمع صوت واحد.",
      },
      rows: [
        {
          when: { en: "Booked", ar: "عند الحجز" },
          what: { en: "a WhatsApp confirmation", ar: "تأكيد على الواتساب" },
        },
        {
          when: { en: "The day before", ar: "قبلها بيوم" },
          what: { en: "a reminder", ar: "تذكير" },
        },
        {
          when: { en: "Before the meeting", ar: "قبل الموعد" },
          what: { en: "a call to confirm", ar: "مكالمة تأكيد" },
        },
        {
          when: { en: "2 hours before", ar: "قبلها بساعتين" },
          what: { en: "an SMS", ar: "رسالة نصية" },
        },
        { what: { en: "The meeting", ar: "الموعد" }, end: true },
      ] as { when?: L; what: L; plain?: boolean; end?: boolean }[],
      lineDwy: {
        en: "Book on the right calendar, and the confirmation goes out by itself.",
        ar: "احجزوا على التقويم الصح، والتأكيد يطلع للعميل تلقائياً.",
      },
      headingDwy: { en: "Before the meeting", ar: "قبل الموعد" },
      rowsDwy: [
        {
          when: { en: "Booked", ar: "عند الحجز" },
          what: { en: "a confirmation", ar: "تأكيد" },
        },
        {
          when: { en: "Before the meeting", ar: "قبل الموعد" },
          what: { en: "reminders", ar: "تذكيرات" },
        },
        {
          when: { en: "Provisional bookings", ar: "الحجوزات المبدئية" },
          what: {
            en: "your team calls 48 and 24 hours before",
            ar: "فريقكم يتصل قبلها بيومين، وقبلها بيوم",
          },
          plain: true,
        },
        { what: { en: "The meeting", ar: "الموعد" }, end: true },
      ] as { when?: L; what: L; plain?: boolean; end?: boolean }[],
    },
    lands: {
      heading: { en: "New appointment", ar: "موعد جديد" },
      who: { en: "Customer", ar: "العميل" },
      when: { en: "When", ar: "الموعد" },
      where: { en: "Where", ar: "المكان" },
      service: { en: "Service", ar: "الخدمة" },
      notes: { en: "Our caller's notes", ar: "ملاحظات فريق الاتصال" },
      notesDwy: { en: "Your caller's notes", ar: "ملاحظات فريق الاتصال عندكم" },
      /** The stop's lead, above the cards (the caption under them repeated the notes' label). */
      caption: {
        en: "Everything our caller learned lands with you.",
        ar: "كل اللي عرفه فريق الاتصال يوصلكم.",
      },
      captionDwy: {
        en: "It lands in your CRM.",
        ar: "الموعد ينزل في الـCRM عندكم.",
      },
      places: {
        office: { en: "At your office", ar: "في مكتبكم" },
        home: { en: "At the customer's home", ar: "في بيت العميل" },
        online: { en: "Online", ar: "أونلاين" },
      },
    },
  },
  /**
   * L7, the piece of the pie (CONTENT L7, DESIGN 20.3 and 20.4): our one
   * piece, named three ways, and theirs pulled out; then the two roads.
   * Done with you, the pie splits by owner in halves.
   */
  partner: {
    title: {
      en: "We bring them to your door. You win the project.",
      ar: "نوصّلهم لين بابكم. وتوقيع المشروع عليكم.",
    },
    line1: { en: "We bring them to your door.", ar: "نوصّلهم لين بابكم." },
    line2: { en: "You win the project.", ar: "وتوقيع المشروع عليكم." },
    line1Dwy: {
      en: "We bring you the enquiries.",
      ar: "نوصّل لكم الاستفسارات.",
    },
    line2Dwy: {
      en: "Your team books them and wins the project.",
      ar: "والحجز وتوقيع المشروع على فريقكم.",
    },
    owner: {
      us: { en: "Our team", ar: "فريقنا" },
      you: { en: "You", ar: "أنتم" },
      youDwy: { en: "Your team", ar: "فريقكم" },
    },
    /** Our one piece, named three ways (the Gamma's "we do": leads, bookings, shows). */
    ours: [
      { en: "Ads and enquiries", ar: "الإعلانات والاستفسارات" },
      { en: "Calls and bookings", ar: "الاتصال والحجز" },
      { en: "Reminders and rebooking", ar: "التذكير وإعادة الحجز" },
    ],
    /**
     * Theirs: the Gamma's "you do: closes", a two-name stack like ours (the
     * visual pass); the notes keep "the meeting and the close" as one phrase.
     */
    theirs: [
      { en: "The meeting", ar: "الموعد" },
      { en: "The close", ar: "توقيع المشروع" },
    ],
    oursDwy: [
      { en: "Ads and enquiries", ar: "الإعلانات والاستفسارات" },
      { en: "Confirmations and reminders", ar: "التأكيد والتذكير" },
    ],
    theirsDwy: [
      { en: "Calls and bookings", ar: "الاتصال والحجز" },
      { en: "The meeting and the close", ar: "الموعد وتوقيع المشروع" },
    ],
    road: {
      ad: { en: "An enquiry from your ad", ar: "استفسار من إعلانكم" },
      /** On the ad road's bends, not under its name: why the road is longer. */
      bends: [
        { en: "Meeting you for the first time", ar: "أول مرة يتعرف عليكم" },
        { en: "Comparing you with others", ar: "يقارنكم بغيركم" },
      ],
      referral: { en: "A referral", ar: "عميل جاكم بتوصية" },
      referralLine: { en: "Already trusts you.", ar: "يثق فيكم من قبل." },
      meeting: { en: "Your meeting", ar: "موعدكم معه" },
      signed: { en: "Signed project", ar: "مشروع موقّع" },
      caption: {
        en: "The enquiries we bring take the longer road.",
        ar: "والاستفسارات اللي نجيبها لكم تمشي الطريق الأطول.",
      },
    },
    /** Stop 4, the one line at the foot: it hands over to the training. */
    close: {
      en: "We can't close for you. We can help you get better at it.",
      ar: "ما نقدر نوقّع المشروع عنكم، بس نقدر نساعدكم تصيرون أشطر فيه.",
    },
  },
  /**
   * L8, the sales training (CONTENT L8, DESIGN 20.5): the Academy's six
   * courses in its own order, Project Closing Mastery lit and opened into
   * what it teaches (the sales deck's summary, not its section names).
   */
  training: {
    title: { en: "Your sales training", ar: "تدريبكم على المبيعات" },
    /** Why the course matters, said on the slide (the two roads are one slide back). */
    lead: {
      en: "Enquiries from ads are meeting you for the first time. This course shows you how to win them.",
      ar: "اللي يجونكم من الإعلانات أول مرة يقابلونكم، وهالكورس يعلمكم كيف تكسبونهم.",
    },
    /** Over the course list: where the course is. */
    academy: {
      en: "Premium Projects Academy",
      ar: "أكاديمية المشاريع المميزة",
    },
    courses: [
      { en: "Introduction", ar: "البداية" },
      { en: "Onboarding", ar: "التعريف" },
      { en: "Google optimization", ar: "تحسين قوقل" },
      { en: "Offer creation", ar: "صناعة العرض" },
      { en: "Project Closing Mastery", ar: "إتقان توقيع المشاريع" },
      { en: "Team and operations", ar: "الفريق والتشغيل" },
    ],
    /** The lit course, from 0 (Project Closing Mastery is the Academy's fifth). */
    lit: 4,
    teaches: { en: "What it teaches", ar: "اللي بتتعلمونه" },
    parts: [
      { en: "The consultation", ar: "الاستشارة" },
      { en: "The proposal", ar: "عرض السعر" },
      { en: "The objections", ar: "الاعتراضات" },
      { en: "The close", ar: "التوقيع" },
    ],
    statements: [
      {
        name: { en: "Before your first meetings", ar: "قبل أول مواعيدكم" },
        line: {
          en: "Everyone who meets your customers or sends the quotes watches it, starting with the sales crash course.",
          ar: "كل اللي يقابل عملاءكم أو يرسل عروض الأسعار يشوفه، ويبدي بأول قسم فيه، أساسيات البيع.",
        },
      },
      {
        name: { en: "Your real deals", ar: "صفقاتكم الحقيقية" },
        line: {
          en: "At your check-ins, we go through your meetings with you: what closed, and what to change.",
          ar: "بمكالمات المتابعة، نمر معكم على مواعيدكم: اللي توقّع، واللي يحتاج يتغير.",
        },
      },
    ],
    foot: {
      en: "The link is in your WhatsApp group.",
      ar: "الرابط في قروب الواتساب.",
    },
    /** The Academy's own screens, masked (copy rule 11): their alt text. */
    shots: {
      classroom: {
        en: "The Academy's six courses",
        ar: "الكورسات الستة في الأكاديمية",
      },
      lesson: {
        en: "A lesson inside Project Closing Mastery",
        ar: "درس من كورس إتقان توقيع المشاريع",
      },
    },
  },
  portal: {
    owner: { en: "You do this", ar: "هذا اللي تسوونه" },
    title: { en: "Mahara OS, your portal", ar: "Mahara OS، بوابتكم" },
    titleDwy: { en: "Your CRM", ar: "الـCRM عندكم" },
    stops: [
      {
        key: "overview",
        name: { en: "Where things stand", ar: "وين وصلنا" },
        copy: {
          en: "Your next appointments, and anything waiting on you.",
          ar: "مواعيدكم الجاية، وأي شي ينتظر ردكم.",
        },
      },
      {
        key: "calls",
        name: { en: "Your calls, recorded", ar: "مكالماتكم مسجلة" },
        copy: {
          en: "Listen back to the calls we make for you, in Mahara OS.",
          ar: "اسمعوا المكالمات اللي نسويها لكم في Mahara OS.",
        },
      },
      {
        key: "phone",
        name: { en: "On your phone", ar: "على جوالكم" },
        copy: { en: "Install it like an app.", ar: "نزّلوه مثل أي تطبيق." },
      },
      {
        key: "outcome",
        name: {
          en: "Your number-one job: mark every meeting",
          ar: "أهم شغلة عليكم: سجلوا نتيجة كل موعد",
        },
        copy: {
          en: "Did they come? Did you quote? Did you win? A few taps, the same day.",
          ar: "حضر؟ عطيتوه عرض سعر؟ وقّع معكم؟ كم ضغطة، بنفس اليوم.",
        },
        nameDwy: {
          en: "Your number-one job: keep every stage true",
          ar: "أهم شغلة عليكم: كل مرحلة تكون صحيحة",
        },
        copyDwy: {
          en: "Move each meeting to the right stage in the CRM the same day: didn't show, showed, quote sent, closed.",
          ar: "انقلوا كل موعد للمرحلة الصح في الـCRM بنفس اليوم: ما حضر، حضر، انرسل عرض السعر، وقّع.",
        },
      },
    ] as { key: string; name: L; copy: L; nameDwy?: L; copyDwy?: L }[],
    /**
     * The number-one job's stop, drawn: the outcome stop's sentence as its
     * three questions on one line, in order, then how it's done.
     */
    asks: [
      { en: "Did they come?", ar: "حضر؟" },
      { en: "Did you quote?", ar: "عطيتوه عرض سعر؟" },
      { en: "Did you win?", ar: "وقّع معكم؟" },
    ],
    /** One line under each tap (the Gamma's "let us know", CONTENT L9 stop 4). */
    askLines: [
      { en: "Running late isn't a no-show.", ar: "اللي متأخر شوي مو غايب." },
      {
        en: "Sent it later? Update it then.",
        ar: "أرسلتوا عرض السعر بعدين؟ حدّثوا الجواب وقتها.",
      },
      {
        en: "Add the value, or a line on why.",
        ar: "أضيفوا قيمة المشروع، أو سطر عن السبب.",
      },
    ],
    /** Done for you: moved, we change the reminders; cancelled, we rebook. Never both. */
    moved: {
      en: "Cancelled or moved with you directly? Tell us in the group: we change the reminders or call to rebook.",
      ar: "لغى أو غيّر موعده معكم مباشرة؟ قولوا لنا بالقروب، ونعدّل التذكيرات أو نتصل عليه ونحجز له من جديد.",
    },
    /** Done with you, under the CRM's stages. */
    lateDwy: {
      en: "Not there? Check they're not just running late before you move it.",
      ar: "ما وصل؟ تأكدوا إنه مو بس متأخر قبل لا تنقلونه.",
    },
    taps: { en: "A few taps, the same day.", ar: "كم ضغطة، بنفس اليوم." },
    /**
     * The phone stop's install address, set large in the gap beside the
     * phone (the fixer's round): the address the group gets, under what to
     * do with it.
     */
    installLabel: {
      en: "Open this on your phone",
      ar: "افتحوا هالرابط من جوالكم",
    },
    footer: {
      en: "What isn't marked can't be improved.",
      ar: "اللي ما ينسجل، ما نقدر نحسّنه.",
    },
    crm: [
      { en: "Didn't show", ar: "ما حضر" },
      { en: "Showed", ar: "حضر" },
      { en: "Quote sent", ar: "انرسل عرض السعر" },
      { en: "Closed", ar: "وقّع" },
    ],
  },
  /**
   * L10, the six jobs (CONTENT L10, DESIGN 20.7): grouped by when they
   * happen, two under each head. Done with you, the booking job becomes
   * their own calling job (before the meetings) and the marking job the
   * stage move, so no calling job sits under "After each meeting".
   */
  part: {
    title: {
      en: "Your six jobs, in one place",
      ar: "ست شغلات عليكم، بمكان واحد",
    },
    heads: {
      before: { en: "Before your meetings", ar: "قبل مواعيدكم" },
      after: { en: "After each meeting", ar: "بعد كل موعد" },
      weeks: { en: "Week to week", ar: "أسبوع بأسبوع" },
    },
    rows: [
      {
        key: "slots",
        head: "before",
        job: {
          en: "Keep at least 10 open slots, at different times",
          ar: "خلوا ١٠ مواعيد فاضية على الأقل، بأوقات مختلفة",
        },
        why: {
          en: "Our callers book into them.",
          ar: "فريق الاتصال يحجز فيها.",
        },
        whyDwy: {
          en: "Your team books into them.",
          ar: "فريقكم يحجز فيها.",
        },
        // The week drawn under it shows the day off; the recap and the
        // notes say it (score round 1: one sentence per job on the slide).
        more: {
          en: "On a day off, block each hour, not one all-day event.",
          ar: "ويوم إجازتكم، سكروا الساعات ساعة ساعة، مو حدث على اليوم كامل.",
        },
      },
      {
        key: "system",
        head: "before",
        job: {
          en: "Add each booking to your own system",
          ar: "ضيفوا كل موعد لنظامكم",
        },
        why: {
          en: "If your team plans in other software, the booking goes there too, so nobody books over it.",
          ar: "إذا فريقكم يخطط على برنامج ثاني، الموعد ينضاف فيه بعد، عشان ماحد يحجز فوقه.",
        },
        // Done with you their team already books: the job before the
        // meetings is the call itself.
        jobDwy: {
          en: "Call new enquiries within 5 minutes, and note every try",
          ar: "اتصلوا على الاستفسارات الجديدة خلال ٥ دقايق، وسجلوا كل محاولة",
        },
        whyDwy: {
          en: "Interest fades, and a missing note means nobody knows what happened.",
          ar: "الحماس يبرد، والملاحظة الناقصة تخلي ماحد يعرف اللي صار.",
        },
      },
      {
        key: "mark",
        head: "after",
        job: {
          en: "Mark every meeting the same day, with the value when you win",
          ar: "سجلوا نتيجة كل موعد بنفس اليوم، ومعها قيمة المشروع إذا وقّع",
        },
        why: {
          en: "Your outcomes show which ads bring real projects.",
          ar: "نتائجكم توضح أي إعلانات تجيب مشاريع حقيقية.",
        },
        jobDwy: {
          en: "Move each meeting to the right stage the same day",
          ar: "انقلوا كل موعد للمرحلة الصح بنفس اليوم",
        },
        whyDwy: {
          en: "Your stages show which ads bring real projects.",
          ar: "مراحلكم توضح أي إعلانات تجيب مشاريع حقيقية.",
        },
      },
      {
        key: "follow",
        head: "after",
        job: {
          en: "Follow up the ones thinking it over, and book the second meeting",
          ar: "تابعوا اللي قاعدين يفكرون، واحجزوا الموعد الثاني",
        },
        why: {
          en: "You send the quote and set the second meeting.",
          ar: "أنتم ترسلون عرض السعر وتحددون الموعد الثاني.",
        },
        // Done for you only: our caller's check-in. On the slide too (score
        // round 2 of the five services): without it the job read as the
        // client's alone, while the CEO's answer is that a customer who came
        // is followed up by both of us.
        more: {
          en: "Our caller checks in too.",
          ar: "وفريق الاتصال يتابع معهم بعد.",
        },
        moreDwy: null,
        moreShown: true,
      },
      {
        key: "ads",
        head: "weeks",
        job: {
          en: "Leave the ads running through the first weeks",
          ar: "خلوا الإعلانات شغالة أول الأسابيع",
        },
        why: {
          en: "Pausing early ends the test before it tells us anything.",
          ar: "لو وقفتوها بدري، ينتهي الاختبار قبل لا يعطينا جواب.",
        },
      },
      {
        key: "drive",
        head: "weeks",
        job: {
          en: "Keep your Drive folder fed",
          ar: "خلوا مجلد الدرايف مليان",
        },
        why: {
          en: "Fresh projects keep your ads from tiring.",
          ar: "المشاريع الجديدة تخلي إعلاناتكم ما تبهت.",
        },
      },
    ] as {
      key: string;
      head: "before" | "after" | "weeks";
      job: L;
      /** The one sentence the slide shows under the job. */
      why: L;
      jobDwy?: L;
      whyDwy?: L;
      /** Said in the notes and sent in the recap; on the slide only with `moreShown`. */
      more?: L;
      /** Done with you: its own `more`, or null for none. */
      moreDwy?: L | null;
      /** The slide shows `more` after the why (the follow-up: both of us). */
      moreShown?: boolean;
    }[],
    /** The calendar week under the open slots: Saturday to Thursday. */
    days: [
      { en: "Sat", ar: "سبت" },
      { en: "Sun", ar: "أحد" },
      { en: "Mon", ar: "اثنين" },
      { en: "Tue", ar: "ثلاثاء" },
      { en: "Wed", ar: "أربعاء" },
      { en: "Thu", ar: "خميس" },
    ],
    /** The calendar's key, under the week: the dark cells, named once. */
    blocked: { en: "Blocked", ar: "مسكّر" },
    dayOff: { en: "Day off", ar: "إجازة" },
  },
  days: {
    title: { en: "Your first 90 days", ar: "أول ٩٠ يوم" },
    goal: {
      en: "Your 90-day goal, in your words:",
      ar: "هدفكم خلال ٩٠ يوم، بكلامكم:",
    },
    goalFoot: {
      en: "A target, not a promise of results.",
      ar: "هدف، مو وعد بنتائج.",
    },
    finding: { en: "Finding what works", ar: "نكتشف اللي يشتغل" },
    weeks12: { en: "Weeks 1 and 2", ar: "أول أسبوعين" },
    /** Under the first bar's label: "usually", never "always" (FCL PLAN, the Gamma's slower start). */
    slow: {
      en: "Usually slower, while the ads find your audience.",
      ar: "عادةً تكون أهدأ، لين تتعرف الإعلانات على جمهوركم.",
    },
    /** Under the dashed open end of the first window. */
    open: { en: "Can run longer", ar: "ممكن تطوّل" },
    checkins: { en: "Check-ins", ar: "مكالمات المتابعة" },
    first: {
      en: "Your first check-in · a week or two in",
      ar: "أول مكالمة متابعة، بعد أسبوع أو أسبوعين",
    },
    later: {
      en: "Then weekly or every two weeks",
      ar: "وبعدها كل أسبوع أو كل أسبوعين",
    },
    /** Why the rhythm is one of the two: the client's plan and their time with us. */
    laterWhy: {
      en: "Depending on your plan and how long you've been with us.",
      ar: "على حسب باقتكم، وكم صار لكم معنا.",
    },
    laterLine: {
      en: "20 to 30 minutes on Zoom: what's working, and what we're changing.",
      ar: "من ٢٠ إلى ٣٠ دقيقة على زوم: اللي شغال، واللي بنغيره.",
    },
    looksBack: {
      en: "Around 30, 60 and 90 days, that check-in looks back over the month.",
      ar: "تقريباً عند ٣٠ و٦٠ و٩٠ يوم، مكالمة المتابعة تراجع الشهر كامل.",
    },
    goLive: { en: "Go-live", ar: "الإطلاق" },
    /** The chart's end, on the axis: the title's 90 days. */
    day90: { en: "Day 90", ar: "يوم ٩٠" },
    week: { en: "Week {n}", ar: "الأسبوع {n}" },
    msLabel: {
      en: "In this order, not on a date:",
      ar: "بهالترتيب، مو بتاريخ:",
    },
    milestones: [
      { en: "First booking", ar: "أول موعد" },
      { en: "First attended appointment", ar: "أول عميل حضر" },
      { en: "First won project", ar: "أول مشروع موقّع" },
    ],
    footer: {
      en: "Dates depend on your market, your offer and your follow-up. We track them with you.",
      ar: "التواريخ تعتمد على سوقكم وعرضكم ومتابعتكم، ونتابعها معكم.",
    },
  },
  /**
   * L12, good to know (CONTENT L12, DESIGN 20.9): the money, then the
   * messages, each row a head over its line. The replies row shows only
   * when this client never saw the onboarding deck (O3 says it).
   */
  know: {
    title: { en: "Good to know", ar: "أشياء تهمكم" },
    groups: {
      money: { en: "Money", ar: "الفلوس" },
      messages: { en: "Messages", ar: "الرسايل" },
    },
    rows: [
      {
        key: "charges",
        group: "money",
        name: { en: "Meta's first charges", ar: "أول مبالغ تخصمها ميتا" },
        line: {
          en: "Small at first, and that's normal. Tell your bank so it doesn't block them.",
          ar: "تكون صغيرة بالبداية، وهذا طبيعي. بلّغوا البنك عشان ما يوقفها.",
        },
        /** The row's do-this, set in ink inside its line (score round 2). */
        act: { en: "Tell your bank", ar: "بلّغوا البنك" },
      },
      {
        key: "card",
        group: "money",
        name: {
          en: "Keep your ad card funded",
          ar: "خلوا بطاقة الإعلانات فيها رصيد",
        },
        line: {
          en: "A failed payment stops your ads. Repeated ones can get the account restricted and reset what the ads have learned. Running low? Tell us first, and we'll pause the ads safely.",
          ar: "إذا فشل الدفع، تتوقف إعلاناتكم. وإذا تكرر، ممكن ميتا تقيّد الحساب، ويروح اللي تعلمته الإعلانات. الرصيد قرب يخلص؟ قولوا لنا قبلها، ونوقف الإعلانات بطريقة آمنة.",
        },
        act: { en: "Tell us first", ar: "قولوا لنا قبلها" },
      },
      {
        key: "pay",
        group: "money",
        name: { en: "Your payments to us", ar: "دفعاتكم لنا" },
        act: {
          en: "On the dates in your agreement.",
          ar: "بالتواريخ المكتوبة في عقدكم.",
        },
        line: {
          en: "On the dates in your agreement. If one fails, the ads, our calls and Mahara OS pause until it's sorted.",
          ar: "بالتواريخ المكتوبة في عقدكم. وإذا فشلت دفعة، تتوقف الإعلانات ومكالماتنا ومنصة Mahara OS لين تنحل.",
        },
        lineDwy: {
          en: "On the dates in your agreement. If one fails, the ads and the systems we run for you pause until it's sorted.",
          ar: "بالتواريخ المكتوبة في عقدكم. وإذا فشلت دفعة، تتوقف الإعلانات والأنظمة اللي نشغلها لكم لين تنحل.",
        },
      },
      {
        key: "comments",
        group: "messages",
        name: { en: "Comments on your ads", ar: "التعليقات على إعلاناتكم" },
        line: {
          en: "Yours to answer. Not sure what to say? Ask in the group.",
          ar: "الرد عليها عليكم. ما تدرون كيف تردون؟ اسألونا بالقروب.",
        },
      },
      {
        key: "replies",
        group: "messages",
        name: { en: "Our replies", ar: "ردودنا" },
        line: {
          en: "In the group within 2 working hours, 10 to 6, Saturday to Thursday.",
          ar: "بالقروب خلال ساعتين دوام، من ١٠ صباحاً إلى ٦ مساءً، من السبت إلى الخميس.",
        },
        lineUae: {
          en: "In the group within 2 working hours, 10 to 6 Saudi time (11 to 7 in the UAE), Saturday to Thursday.",
          ar: "بالقروب خلال ساعتين دوام، من ١٠ صباحاً إلى ٦ مساءً بتوقيت السعودية (من ١١ إلى ٧ بتوقيت الإمارات)، من السبت إلى الخميس.",
        },
      },
    ] as {
      key: string;
      group: "money" | "messages";
      name: L;
      line: L;
      lineDwy?: L;
      lineUae?: L;
      /** The row's do-this, set in ink inside its line. */
      act?: L;
    }[],
  },
  green: {
    question: { en: "Happy for us to go live?", ar: "على بركة الله، ننطلق؟" },
    /**
     * Already live (the cover's "is live": the go-live date has passed and
     * starter ads are running): the ask is to carry on, never to go live.
     */
    questionLive: {
      en: "Happy for us to carry on?",
      ar: "على بركة الله، نكمل؟",
    },
    next: {
      en: "Your first check-in · {date}",
      ar: "أول مكالمة متابعة، {date}",
    },
    rail: { en: "Go-live · {date}", ar: "الإطلاق، {date}" },
  },
} as const;

/** The launch deck's slide titles, in order (the overview and the notes). */
export const L_TITLES = {
  cover: LAUNCH.cover.title,
  journey: JOURNEY.title,
  "creative-freedom": LAUNCH.test.title,
  ads: LAUNCH.ads.title,
  form: LAUNCH.form.title,
  call: LAUNCH.call.title,
  partnership: LAUNCH.partner.title,
  training: LAUNCH.training.title,
  portal: LAUNCH.portal.title,
  "your-part": LAUNCH.part.title,
  "first-90-days": LAUNCH.days.title,
  "good-to-know": LAUNCH.know.title,
  "green-light": LAUNCH.green.question,
} as const;

/** L10's six jobs in the deck's service model, in order, with their heads. */
export function partJobs(dwy: boolean) {
  return LAUNCH.part.rows.map(r => ({
    key: r.key,
    head: r.head,
    job: (dwy && r.jobDwy) || r.job,
    why: (dwy && r.whyDwy) || r.why,
    more: (dwy && r.moreDwy !== undefined ? r.moreDwy : r.more) ?? null,
    moreShown: Boolean(r.moreShown),
  }));
}

export const L_NOTES: Record<keyof typeof L_TITLES, SlideNotes> = {
  cover: {
    say: [
      'Frame it: "About 45 minutes, with time for your questions. What goes live, what happens when someone enquires, who does what, and what we need from you. Stop me anytime."',
      "Ask for their full attention for those minutes.",
      "If starter ads are already running, say so plainly and use the call to show the whole picture.",
      "Skip the introduction if you ran their onboarding call.",
    ],
    sayAr: [
      "تقريباً ٤٥ دقيقة، ومعها وقت لأسئلتكم. بنمر على اللي بينزل، وعلى اللي يصير لما أحد يستفسر، وعلى مين يسوي كل خطوة، وعلى اللي نحتاجه منكم. وقفوني بأي وقت.",
      "إذا تقدرون، خلونا معكم هالدقايق كاملة.",
      "(Starter ads already running) إعلانات البداية شغالة من قبل، واليوم بوريكم الصورة كاملة.",
      "(Only if you did not run their onboarding call) أنا {csm}، من فريق نجاح العملاء، وباقي الفريق بتعرفونهم بأدوارهم.",
    ],
  },
  journey: {
    say: [
      "Walk the stops with the arrow keys. Let each one land before you speak. The mini rail on the next slides makes the callback; don't announce it.",
      "At stop 3, say it plainly: we call new enquiries within 5 minutes during working hours, 10 to 6, Saturday to Thursday (11 to 7 for a UAE client), and anything that comes in at night is called from 10 the next working morning. Then up to 4 tries over 3 working days.",
      "At stop 6, point at the dotted line: a no-show comes back to us, and we call to rebook.",
      "Someone who came and is thinking it over is followed up by both sides: our caller calls them, and the client follows up too, because they met the customer and know them best. The client still marks the outcome.",
      "(When the phone at stop 1 shows an example) This is an example ad, marked on the slide. Your own replaces it when it's ready. Never call an example theirs, and never call it a template.",
    ],
    sayAr: [
      "(The calling stop) نتصل على الاستفسارات الجديدة خلال ٥ دقايق في أوقات الدوام، من ١٠ الصبح إلى ٦ المسا، من السبت إلى الخميس. واللي يوصل بالليل، نتصل عليه من الساعة ١٠ الصبح بأول يوم دوام. ونحاول معه لين ٤ مرات، خلال ٣ أيام دوام.",
      "(A UAE client, the hours) من ١٠ الصبح إلى ٦ المسا بتوقيت السعودية، يعني من ١١ الصبح إلى ٧ المسا بتوقيت الإمارات.",
      "(The fork) شوفوا هالخط: اللي ما يحضر، يرجع لنا، ونتصل عليه ونحجز له من جديد.",
      "(Stop 1, when the phone shows an example) هذا إعلان للتوضيح، ومكتوب عليه كذا. ولما تجهز إعلاناتكم، تطلع مكانه.",
      "(Came and thinking it over) واللي حضر وقاعد يفكر، نتابعه إحنا وأنتم: فريق الاتصال عندنا يتصل عليه ويتابع معه، وأنتم بعد تتابعونه، لأنكم قابلتوه وتعرفونه أكثر. وبعدها سجلوا النتيجة.",
    ],
    temp: {
      en: "Any step here you'd want done differently?",
      ar: "فيه خطوة هنا تبونها تمشي بطريقة ثانية؟",
    },
    dwy: [
      "Stops 3 and 4 sit in their lane: their team calls within 5 minutes of the alert, and books. The no-show line stays in their lane too, and so does the follow-up of someone thinking it over.",
    ],
  },
  ads: {
    say: [
      'Point back before you show them: "As we just agreed: a wrong fact, price or claim we fix before it goes live, and the rest goes into the next round. Tell me as we go."',
      'Let them choose: "Which one would stop you scrolling?" Mark it (M, or the star here). Their pick runs beside the others, as the slide before said.',
      "Swap one live, so they see how each creative looks in the feed.",
      "A wrong fact (a price, a service, an area): write it down; we fix it before it goes live.",
      "A preference: write it down for the next round, as you just agreed.",
      "This preview isn't approval. Approval happens in the group.",
      "(When the phones show an example) These are example ads, marked on the slide. Your own replace them when they're ready. Never call an example theirs, and never call it a template.",
    ],
    sayAr: [
      "(Before you show them) مثل ما اتفقنا قبل شوي: أي معلومة أو سعر أو وعد غلط نصلحه قبل لا ينزل الإعلان، والباقي يروح للإعلانات الجاية. قولوها لي وإحنا نمر عليها.",
      "أي واحد فيها بيوقفكم وأنتم تقلّبون جوالكم؟",
      "خلوني أحط هذا مكانه الحين، وشوفوا كيف يطلع بالفيد.",
      "(A wrong fact) خلوني أكتبها، ونصلحها قبل لا ينزل الإعلان.",
      "(A preference) بكتبها للإعلانات الجاية، مثل ما اتفقنا.",
      "هذي معاينة بس، مو موافقة.",
      "(When the phones show an example) هذي إعلانات للتوضيح، ومكتوب عليها كذا. ولما تجهز إعلاناتكم، تطلع مكانها.",
    ],
  },
  "creative-freedom": {
    say: [
      "Stop 1: \"Your brand matters, and your page is where it shows. It stays as polished as you like. The ads have a different goal: revenue for your business, not looking like your page. They're for people who don't know you yet.\" The polished work belongs in their page's own posts. A content plan for their page is a separate conversation; don't promise it here.",
      "Stop 2: say it before they see it happen. Most ads get switched off; that's how testing works, not a sign that something went wrong. No numbers: no win rate, no \"one in ten\", no count of ads a month. If their pick is already marked, its picture is on one of the lit tiles, with the star; if not, they choose one on the next slide. If they ask what changes from one version to the next: the hook, the angle, the format, the thumbnail, who's on camera.",
      "Stop 1: the tiles are example ads, not theirs: the picture is about how many we test.",
      "Stop 3: start with the input line: ideas, a new offer, a new price or a change go in the group before the next round. Then read their red lines out, and ask: \"Anything else we must never say or show?\" Add it to their card's Do's & Don'ts after the call.",
      'Stop 3, the offer: "Want to change the offer? Ask in the group first. A new offer mid-test starts the test again; if you ask first, we can plan it in."',
      'Stop 3, if they point at the pictures: "These are examples, to show how testing works. Your ads use your projects."',
      "Stop 4, set it before they see the ads, in your own words: \"On the next slide you'll see your ads, and you'll want to change small things. We'll keep those for the next round, so your launch doesn't wait.\"",
      "Stop 4: a wrong fact, price or claim is different: we fix it before the ad goes live. So is anything that breaks their red lines or gets their name, logo or colours wrong. Any matter of taste, small or large, goes into the next round.",
      'Stop 4, why it stays small: "An ad held back for a small change is an ad we\'re not testing, and testing more is how we find the ones that work." The same holds for the rounds after launch.',
      "Stop 5: content is said once here, with the why; slide 10 has it as a job. The more they send, the more versions we can make.",
      "At the temp check, record the agreement only when they say yes (A, or the button here).",
    ],
    push: [
      'If they push back, now or when the ads reach the group, first go back to what you both agreed: their red lines from the onboarding call, and the quick check agreed on this call (the "How we test your ads" line in the group recap). "Let me pull up what we agreed."',
      'Then, warmly: "The last thing we want is to hold your launch for a small change." Then ask: "{goalAsk}"',
      'After their answer: "Great, let\'s get them live. Your change goes into the next round." Then write the change in the group, so they see it kept.',
      'If the change still matters more to them and it is a matter of taste: "Then we\'ll make your version too and run it beside the others in the next round. The numbers tell us which works." Never hold the launch for it.',
      "Never \"we won't do it\": the change isn't refused, it waits for the next round. A wrong fact, price or claim is not pushback: fix it before the ad goes live.",
      'Pushback in the group after the call: "Copy reply" here copies one line for the group, picked by their 90-day goal.',
      'Don\'t back it with numbers: no count of clients, no results, no "after working with X clients".',
      'If they want to hold an ad back until it\'s perfect: "An ad waiting for the perfect version earns nothing while it waits."',
      'The close, in your own words: "You came to us for performance. We\'d rather protect that than protect a look."',
    ],
    sayAr: [
      "(Stop 1, the ads' job) هويتكم مهمة، وصفحتكم هي المكان اللي تبان فيه، وتبقى مرتبة مثل ما تبون. أما الإعلانات فهدفها غير: تجيب دخل لشركتكم، مو إنها تشبه صفحتكم. وهي لناس ما يعرفونكم للحين.",
      "(Stop 2, most get switched off) أغلب الإعلانات اللي نختبرها نوقفها، وهذا طبيعي، مو معناها إن فيه شي غلط. هذي الطريقة اللي نلقى فيها اللي يشتغل.",
      "(Stop 1, the tiles) هالمربعات أمثلة لإعلانات، مو إعلاناتكم. الفكرة إنكم تشوفون كم إعلان نختبر.",
      "(Stop 3, input first) أي فكرة أو عرض جديد أو سعر جديد أو تغيير، أرسلوه بالقروب قبل لا نسوي الإعلانات الجاية، عشان يكون فيها من البداية، وإحنا نرد عليكم بالسبب.",
      "(Stop 3, then the red lines) وبعدها خلوني أقرا لكم خطوطكم الحمراء.. فيه شي ثاني ما تبونا نقوله أو نوريه أبد؟",
      "(Stop 3, the offer) تبون تغيرون العرض؟ قولوا لنا بالقروب أول. العرض الجديد بنص الاختبار يرجّعه من البداية، وإذا قلتوا لنا أول، نرتب له.",
      "(Stop 3, if they point at the pictures) هذي أمثلة توضح كيف نختبر، وإعلاناتكم تكون من مشاريعكم.",
      "(Stop 4, before they see the ads) بالشريحة الجاية بتشوفون إعلاناتكم، وأكيد بتبون تغيرون أشياء صغيرة. هذي نخليها للإعلانات الجاية، عشان إطلاقكم ما يتأخر.",
      "(Stop 4, a wrong fact) أي معلومة أو سعر أو وعد غلط، نصلحه قبل لا ينزل الإعلان. ونصلح بعد أي شي يتعدى خطوطكم الحمراء، أو يغلط في اسمكم أو شعاركم أو ألوانكم. وأي شي يرجع للذوق، صغير ولا كبير، يروح للإعلانات الجاية.",
      "(Stop 4, why it stays small) ليش نخليها مراجعة سريعة؟ الإعلان اللي ينتظر تعديل صغير، إعلان ما نختبره. ونلقى اللي يشتغل لما نختبر أكثر.",
      "(Stop 5, the content) كل ما أرسلتوا محتوى أكثر، قدرنا نسوي نسخ أكثر.",
    ],
    pushAr: [
      "(If they push back: both agreements) خلونا نرجع للي اتفقنا عليه: خطوطكم الحمراء من مكالمة التعريف، والمراجعة السريعة من مكالمة الإطلاق. خلوني أطلّعه لكم.",
      "(Then, warmly) آخر شي نبيه إن إطلاقكم يتأخر عشان تعديل صغير.",
      "(Then ask) {goalAsk}",
      "(After their answer) تمام، خلونا ننزلها. وتعديلكم بنحطه بالإعلانات الجاية.",
      "(The change still matters more, and it is taste) إذا كذا، نسوي نسختكم بعد، وننزلها جنب الباقي بالإعلانات الجاية. والأرقام هي اللي توضح لنا أي وحدة تشتغل.",
      "(If they want to wait for a perfect ad) الإعلان اللي ينتظر النسخة المثالية، ما يجيب شي وهو ينتظر.",
      "أنتم جيتونا عشان الأداء، وإحنا نفضّل نحمي الأداء على إننا نحمي شكل معين.",
    ],
    temp: {
      en: "Can we agree to test this way?",
      ar: "متفقين نختبر بهالطريقة؟",
    },
    dwy: [
      '"Your team runs the calls, but the ads work the same way: your red lines, the quick check and the next round are the same."',
      "(Arabic) فريقكم هو اللي يتصل، بس الإعلانات تمشي بنفس الطريقة: خطوطكم الحمراء، والمراجعة السريعة، والإعلانات الجاية.",
    ],
  },
  form: {
    say: [
      'Read the filter questions out: "This is the first filter. The call is the second."',
      "Check the facts with them: service names, areas, wording.",
      "If they want more questions: every extra question also loses some good people. We add one when the enquiries show we need it.",
      'The thank-you screen and the WhatsApp steps promise the call within 5 minutes during working hours, the same promise as the journey. A customer who writes at night sees "during working hours" and is called from 10 the next working morning.',
    ],
    sayAr: [
      "هذا أول فلتر، والمكالمة هي الفلتر الثاني.",
      "أسماء الخدمات والمناطق والكلام هنا، كلها صحيحة؟",
      "(If they want more questions) كل سؤال زيادة يطيّر معه ناس زينين بعد. نضيف سؤال لما الاستفسارات توضح إننا نحتاجه.",
      "(If they ask about night) واللي يوصل بالليل، نتصل عليه من الساعة ١٠ الصبح بأول يوم دوام.",
    ],
  },
  call: {
    say: [
      '"This is the script we use, with your details in it. Our caller speaks as your appointments team."',
      'Point at the teal words. Ask for anything marked "To give us".',
      "If they'd rather the caller share a starting price, ask them to add it to the guide. The script doesn't quote prices it doesn't have.",
      "At stop 7, the reminders: say them once, as what we do before the meeting. Then the line under the heading: ask them not to message the customer from their own WhatsApp before the meeting. Two voices confuse the customer.",
      'At stop 8: "Everything the caller learned comes to you, so you walk in knowing the project."',
      "\"You'll hear your own real calls in Mahara OS.\" Never play a recording of another client's call.",
    ],
    sayAr: [
      "هذا السكربت اللي نستخدمه، ومعلوماتكم داخله. فريق الاتصال يتكلم باسمكم، كقسم المواعيد عندكم.",
      "الكلمات الملونة من ملفاتكم. واللي عليه نحتاجه منكم، تقدرون تعطونا إياه الحين.",
      "إذا تبون فريق الاتصال يذكر سعر يبدي منه، ضيفوه بالدليل. السكربت ما يذكر سعر ما عندنا.",
      "(After the call) وهذا اللي نسويه قبل الموعد.",
      "(The one-voice line) قبل الموعد، ياليت ما تراسلون العميل من واتسابكم. صوتين يلخبطون العميل، فخلوا الرسايل علينا.",
      "(What lands with them) كل اللي عرفه فريق الاتصال يوصلكم، فتدخلون الموعد وأنتم عارفين المشروع.",
      "مكالماتكم الحقيقية بتسمعونها في Mahara OS.",
    ],
    temp: {
      en: "Is that how you'd want your customers spoken to? Anything we should never say?",
      ar: "هذي الطريقة اللي تبون نكلم فيها عملاءكم؟ وفيه شي ما نقوله أبد؟",
    },
    dwy: [
      '"This is how we\'d like your team to call: the same six stages, the same script, with your details in it."',
      "(Arabic) هذي الطريقة اللي نبي فريقكم يتصل فيها: نفس المراحل الست، ونفس السكربت، ومعلوماتكم داخله.",
    ],
  },
  partnership: {
    say: [
      'Stop 1: "This piece is ours: the ads and the enquiries, the calls and the bookings, the reminders, and rebooking anyone who doesn\'t show."',
      "Stop 2: \"This piece is yours, and it's the one that pays: the meeting and the close.\" Let it land. This is the CEO's piece of the pie.",
      'Stop 3: "Someone who comes through a referral already trusts you. Someone from an ad is meeting you for the first time and comparing you with others. Expect more questions, more follow-up and a longer road to a signature."',
      'Don\'t put a number on it: no close rate, no "most sales come after the third contact", no count of the firms they compare, and never "three quarters of the work".',
      "Stop 4: \"Marketing without sales won't grow your business. We bring them to the door, and we can't sign them for you.\" The next slide is how we help.",
      "When a client later says the enquiries are poor, come back to this slide: a customer from an ad is a different sale from a referral.",
    ],
    sayAr: [
      "(Our piece) هالقطعة علينا: الإعلانات والاستفسارات، والاتصال والحجز، والتذكير، وإعادة الحجز لأي أحد ما حضر.",
      "(Their piece) وهالقطعة عليكم، وهي اللي يجي منها الدخل: الموعد وتوقيع المشروع.",
      "(The two roads) اللي يجيكم بتوصية يثق فيكم من قبل. واللي يجيكم من إعلان، أول مرة يتعرف عليكم، ويقارنكم بغيركم. فتوقعوا أسئلة أكثر، ومتابعة أكثر، وطريق أطول لين التوقيع.",
      "(The last line) التسويق بدون بيع ما يكبّر شغلكم. إحنا نوصّلهم لين بابكم، بس التوقيع ما نقدر نسويه عنكم. وهنا نقدر نساعدكم.",
    ],
    temp: {
      en: "Anything here you thought was ours?",
      ar: "فيه شي هنا كنتوا تحسبونه علينا؟",
    },
    dwy: [
      '"Your team holds half the work: the calls and bookings, and the meeting and the close. The ads, the enquiries and the messages that go out by themselves are ours."',
      "(Arabic) فريقكم عليه نص الشغل: الاتصال والحجز، والموعد وتوقيع المشروع. والإعلانات والاستفسارات، والرسايل اللي تطلع تلقائياً، علينا.",
    ],
  },
  training: {
    say: [
      'Stop 1, the classroom: "This is the Academy as you\'ll see it. The course for your meetings is the fifth one, Project Closing Mastery."',
      'Stop 2, the lesson: "Inside, it opens on the sales crash course. Start there."',
      "Why it matters, in your words: a referral already trusts them; a customer from an ad needs a proper consultation and a quote they can compare.",
      "Stop 3: ask who meets the customers and who sends the quotes. Those people take the course.",
      "Copy the Academy link into the group now, from the notes window.",
      "Inside Project Closing Mastery, as the Academy names its sections: a sales crash course (start there), objections, follow-ups and bonus lessons (the no-show protocol is one of them). The four words on the slide are what the course walks them through, not its section names.",
      'Its follow-ups section: "It\'s for the ones thinking it over, which you now share with us."',
      "The Academy is self-paced. We don't run training sessions for their staff; their deals come to the check-ins, and you can offer a call on a stuck deal.",
      "No promise about results: don't say the course makes them close more.",
      'If they say they already sell well: "Good. This is for customers from ads, who don\'t know you yet. Most firms are used to referrals."',
    ],
    sayAr: [
      "(The classroom) هذي الأكاديمية مثل ما بتشوفونها. والكورس اللي يخص مواعيدكم هو الخامس: إتقان توقيع المشاريع.",
      "(The lesson) وأول قسم فيه، أساسيات البيع. ابدوا منه.",
      "اللي يجيكم بتوصية يثق فيكم من قبل. بس عميل الإعلان يبي استشارة مرتبة، وعرض سعر واضح يقدر يقارنه.",
      "مين عندكم يقابل العملاء؟ ومين يرسل عروض الأسعار؟ هم اللي يشوفون الكورس.",
      "بحط رابط الأكاديمية بالقروب الحين.",
      "(Its follow-ups section) قسم المتابعة يخص اللي قاعدين يفكرون، واللي صرنا نتابعهم إحنا وأنتم.",
      "(If they say they already sell well) ممتاز. هذا لعملاء الإعلانات، اللي ما يعرفونكم للحين. وأغلب الشركات متعودة على التوصيات.",
    ],
    temp: {
      en: "Who on your team will watch it first?",
      ar: "مين من فريقكم بيشوفه أول؟",
    },
    dwy: [
      "Their callers' script and playbook are on slide 6; this slide is for whoever meets the customers.",
    ],
  },
  portal: {
    say: [
      "If they haven't signed in yet, do it now.",
      "Ask who meets the customers and will mark the meetings. If it isn't the person signed in, add them now: Settings, then Your team & access.",
      "Slow down on stop 4. It's the job clients most often drop: only 30% of recent appointments have attendance marked.",
      "A no-show: a customer running late isn't a no-show yet, so check first. Once they're marked, we call to rebook.",
      'The value is required when they mark a win. "A line on why" is the outcome form\'s own box: one honest sentence ("wants to compare three quotes") helps more than "thinking".',
      "A customer who cancels or moves the meeting with them directly: we only know if they tell us, and the reminders would go out for the old time. Moved, we change the reminders to the new time; cancelled, our caller calls to rebook. Never both: a moved meeting is already booked.",
      "The portal can remind them after each appointment to mark it.",
      "If they already use the report sheet, the two stay in step.",
    ],
    sayAr: [
      "إذا ما سجلتوا دخول للحين، خلنا نسويها الحين.",
      "مين اللي يقابل العملاء ويسجل نتائج المواعيد؟ إذا مو هو اللي مسجل دخول، خلنا نضيفه الحين: من الإعدادات، وبعدها Your team & access.",
      "(Marking outcomes) هذي أكثر شغلة تنتسى، فخلونا نوقف عندها شوي.",
      "(A no-show) اللي متأخر شوي مو غايب، فتأكدوا أول. ولما تسجلونه ما حضر، نتصل عليه ونحجز له من جديد.",
      "(Did you win) وإذا ما وقّع، سطر واحد صريح عن السبب يفيدنا أكثر من كلمة يفكر.",
      "(Cancelled or moved) لو أحد لغى أو غيّر موعده معكم مباشرة، ما نعرف إلا إذا قلتوا لنا، والتذكيرات بتروح له على الوقت القديم. إذا غيّره، نعدّل التذكيرات على الوقت الجديد. وإذا لغاه، نتصل عليه ونحجز له من جديد.",
      "والبوابة تقدر تذكركم بعد كل موعد عشان تسجلون نتيجته.",
      "وإذا تستخدمون شيت التقارير، الاثنين يتحدثون مع بعض.",
    ],
  },
  "your-part": {
    say: [
      '"Three of these are new today: the open slots, a day off blocked by the hour (point at the calendar week) and your own system. Slow down there. The rest you\'ve already heard."',
      'After the call, send this card in the group as the recap: "Copy for the group" posts the six jobs under their three heads, then the testing line ("How we test your ads": it puts slide 3\'s agreement in writing), the money and first-weeks lines, then the course line, then the videos recorded for this deck. The same button is on slide 13, and here once the deck closes.',
      "Open slots: the more of their opening hours we can book into, the sooner a customer finds a time. Ten is the floor.",
      "A day off: block the working hours as busy, not an all-day event. Calendars can miss an all-day block, and we'd book into it. We once booked over a client's own appointments because a day was blocked the wrong way, and the client left.",
      "After a meeting, the follow-up is theirs and ours: they send the quote and set the second meeting, and done for you, our caller checks in too (before it, the messages are ours: slide 6).",
      "A slot outside their hours, a holiday and a service detail are the questions our callers ask most.",
      "They don't need to answer on Fridays or in the evening.",
    ],
    dwy: [
      "Their own callers ask those questions and book into the free times; the group answers them.",
    ],
    sayAr: [
      "ثلاث من هذي جديدة عليكم اليوم: المواعيد الفاضية، ويوم الإجازة اللي تسكرونه بالساعات، ونظامكم. والباقي سمعتوه قبل.",
      "وبأرسل لكم هالكرت بالقروب، ومعاه رابط كورس إتقان توقيع المشاريع.",
      "كل ما خليتوا أوقات فاضية أكثر من ساعات دوامكم، لقى العميل وقت يناسبه أسرع.",
      "يوم الإجازة، سكروا ساعات الدوام وحطوها مشغول، مو حدث على اليوم كامل، لأن التقويم أحياناً ما ينتبه لليوم المسكّر كامل، فنحجز فيه بالغلط.",
      "(Done for you) وبعد الموعد، المتابعة علينا وعليكم: أنتم ترسلون عرض السعر وتحددون الموعد الثاني، وفريق الاتصال عندنا يتابع مع العميل بعد.",
      "أكثر أسئلة يسألها فريق الاتصال: موعد برا أوقات دوامكم، أو إجازة، أو تفصيلة عن خدمة.",
      "وما يحتاج تردون يوم الجمعة أو بالليل.",
    ],
    temp: {
      en: "Which of these will be hardest for your team?",
      ar: "أي وحدة من هذي بتكون أصعب على فريقكم؟",
    },
  },
  "first-90-days": {
    say: [
      "No numbers promised. Never give a date for a milestone.",
      "Weeks 1 and 2 are usually slower while the ads find their audience. Some start busy. Either way, we're finding what their market responds to.",
      "Updates come in the group as things happen.",
      'The rhythm, both and why: "After the first one, weekly or every two weeks, depending on your plan and how long you\'ve been with us." Never promise one of the two alone.',
      "Their deals come to these check-ins too (slide 8).",
      "Check-ins: a laptop, somewhere quiet, not in the car. The next one is booked at the end of each.",
    ],
    sayAr: [
      "أول أسبوعين عادةً أهدأ، لين تتعرف الإعلانات على جمهوركم. وفيه بدايات تكون زحمة. وبالحالتين، إحنا نكتشف اللي يتفاعل معه سوقكم.",
      "والتحديثات توصلكم بالقروب أول بأول.",
      "بعد أول مكالمة متابعة، تكون المكالمات كل أسبوع أو كل أسبوعين، على حسب باقتكم، وكم صار لكم معنا.",
      "وصفقاتكم بعد نمر عليها بمكالمات المتابعة.",
      "مكالمات المتابعة: لابتوب ومكان هادي، مو وأنتم بالسيارة. واللي بعدها نحجزها بآخر كل مكالمة.",
    ],
    temp: { en: "Does this rhythm work for you?", ar: "هالإيقاع يناسبكم؟" },
    dwy: [
      "The first booking is their team's.",
      "(Arabic) أول حجز بيكون من فريقكم.",
    ],
  },
  "good-to-know": {
    say: [
      "Say the money rows once, plainly. No amounts on screen or aloud.",
      "The ad account's card: the whole month's ad spend should be on it. Running low: they tell us in the group, and the media buyer pauses the campaign before a payment fails.",
      'Payments to us: "the dates in your agreement". Never "monthly from today": plans differ.',
      'If the replies row shows, add that Friday is off and that "2 working hours" counts only the hours we work.',
    ],
    sayAr: [
      "هذي أشياء بسيطة عن الفلوس والرسايل، بس مهم تعرفونها قبل لا ننطلق.",
      "بطاقة الإعلانات: خلوا فيها مصروف الإعلانات للشهر كامل. وإذا قرب يخلص، قولوا لنا بالقروب، ونوقف الحملة قبل لا يفشل الدفع.",
      "دفعاتكم لنا بالتواريخ اللي في عقدكم.",
      "(If the replies row shows) الجمعة إجازة، والساعتين تنحسب من ساعات دوامنا بس.",
    ],
    temp: {
      en: "Anything on money or messages you'd like to check before we go live?",
      ar: "فيه شي عن الفلوس أو الرسايل تبون تتأكدون منه قبل لا ننطلق؟",
    },
  },
  "green-light": {
    say: [
      "Questions first, then ask for the green light in those words.",
      'Already live (the cover says so): ask "Happy for us to carry on?" in those words; never ask to go live.',
      "Book the first check-in before you hang up, a week or two after go-live.",
      "If they hesitate, find the one thing and solve it now, or agree a date to solve it.",
      'Say the awkward thing: "If anything worries you at any point, tell me. The partners who do best tell us the good and the bad."',
      'After the call, send the recap in the group. "Copy for the group" is here too (the six jobs, how we test your ads, the money and the first weeks, the course, the videos), so it goes out even if you didn\'t reach slide 10. It is the one short recap, not the long launch message.',
    ],
    sayAr: [
      "قبل لا نكمل، عندكم أي سؤال؟",
      "على بركة الله، ننطلق؟",
      "(Already live) على بركة الله، نكمل؟",
      "خلنا نحجز أول مكالمة متابعة، بعد الإطلاق بأسبوع أو أسبوعين.",
      "(If they hesitate) فيه شي واحد لو انحل، ترتاحون أكثر؟ خلنا نحله الحين، أو نتفق متى ينحل.",
      "إذا أي شي شغل بالكم بأي وقت، قولوا لي. أنجح شركائنا هم اللي يقولون لنا الزين والشين.",
    ],
  },
};

/**
 * Inside the Meta instant form, in the phone's app language (DESIGN 7.5):
 * the form's own chrome, never the deck's words.
 */
export const FORM_APP = {
  fullName: { en: "Full name", ar: "الاسم الكامل" },
  phone: { en: "Phone number", ar: "رقم الهاتف" },
  email: { en: "Email", ar: "البريد الإلكتروني" },
  city: { en: "City", ar: "المدينة" },
  byMeta: { en: "Filled in by Meta", ar: "تعبّيه ميتا تلقائياً" },
  next: { en: "Next", ar: "التالي" },
  /** WhatsApp's own chrome: the day over the first message, the empty field. */
  today: { en: "Today", ar: "اليوم" },
  message: { en: "Message", ar: "رسالة" },
} as const;
