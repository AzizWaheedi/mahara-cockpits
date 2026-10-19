/**
 * Everything the two client decks say, in English and in the client-facing
 * Gulf Arabic, in one place (docs/csm-decks/CONTENT.md and CONTENT-AR.md are
 * the source; this file copies their words, it does not write new ones).
 *
 * The rules this copy keeps, pinned by scripts/deck-copy.test.ts:
 * - No speed promise and no results promise; no leads, no cost per lead and
 *   no budgets in money; no "every" or "always" for a process step; check-ins
 *   are every two weeks; a no-show is ours and someone deciding is theirs.
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

/** A line in the language on screen, its numbers held to what they count. */
export const t = (l: L, lang: Lang) => hold(isolate(l[lang], lang));

/** `{name}` slots filled; a slot with no value is left out with its space. */
export function fill(text: string, slots: Record<string, string>): string {
  return text.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_, k: string) => slots[k] ?? "");
}

/** A line with its slots filled, in the language on screen. */
export const tf = (l: L, lang: Lang, slots: Record<string, string>) =>
  hold(isolate(fill(l[lang], slots), lang));

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
  return lang === "ar" ? "١٢٣٤٥٦٧٨٩"[i] ?? digits(i + 1, lang) : String(i + 1);
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
    starter: { en: "Starter, from our templates", ar: "إعلان بداية، من قوالبنا" },
    yourForm: { en: "Your form", ar: "نموذج إعلانكم" },
    exampleForm: { en: "Example form", ar: "نموذج للتوضيح" },
    example: { en: "Example", ar: "مثال" },
    exampleWording: { en: "Example wording", ar: "صياغة للتوضيح" },
    illustration: { en: "Illustration", ar: "توضيح" },
    demo: { en: "Demo workspace", ar: "حساب تجريبي" },
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
  adsEmpty: { en: "We're finishing your first ads", ar: "نشتغل على أول إعلاناتكم الحين" },
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
} as const;

export type Cta =
  | "LEARN_MORE"
  | "GET_QUOTE"
  | "BOOK_NOW"
  | "CONTACT_US"
  | "SIGN_UP"
  | "SEND_WHATSAPP_MESSAGE"
  | "APPLY_NOW";

/** The call to action as Meta writes it (CONTENT L3, CONTENT-AR table). */
export const CTA: Record<Cta, L> = {
  LEARN_MORE: { en: "Learn more", ar: "معرفة المزيد" },
  GET_QUOTE: { en: "Get quote", ar: "الحصول على عرض أسعار" },
  BOOK_NOW: { en: "Book now", ar: "احجز الآن" },
  CONTACT_US: { en: "Contact us", ar: "اتصل بنا" },
  SIGN_UP: { en: "Sign up", ar: "تسجيل" },
  SEND_WHATSAPP_MESSAGE: { en: "Send WhatsApp message", ar: "إرسال رسالة واتساب" },
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
  notes: { en: "Notes", ar: "الملاحظات" },
  all: { en: "All slides", ar: "كل الشرائح" },
  full: { en: "Full screen", ar: "ملء الشاشة" },
  prev: { en: "Previous", ar: "السابق" },
  next: { en: "Next", ar: "التالي" },
  slide: { en: "Slide", ar: "شريحة" },
  of: { en: "of", ar: "من" },
  keys: {
    en: "→ ← move · F full screen · L language · O all slides · N notes · Esc closes this list",
    ar: "→ ← تنقل · F ملء الشاشة · L اللغة · O كل الشرائح · N الملاحظات · Esc يقفل القائمة",
  },
} as const;

// ------------------------------------------------------- onboarding deck

export const O = {
  welcome: {
    title: { en: "Welcome, {name}", ar: "حياكم الله، {name}" },
    hello: { en: "Welcome,", ar: "حياكم الله،" },
    dateline: { en: "Onboarding call · {date}", ar: "مكالمة التعريف · {date}" },
    agendaLead: { en: "Before we hang up, we'll:", ar: "قبل لا نسكر المكالمة:" },
    agenda: [
      { en: "Choose your launch service", ar: "نختار خدمة الإطلاق" },
      { en: "Set up your access", ar: "نجهّز الصلاحيات" },
      { en: "Book your Brand Blueprint call", ar: "نحجز مكالمة بناء الهوية والعرض" },
    ],
  },
  goals: {
    title: { en: "Your goals, as you wrote them", ar: "أهدافكم مثل ما كتبتوها" },
    source: { en: "From your onboarding form", ar: "من نموذج التعريف بالنشاط" },
    goal90: { en: "In 90 days", ar: "خلال ٩٠ يوم" },
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
    input: {
      en: "Your 90-day goal, in your words",
      ar: "هدفكم خلال ٩٠ يوم، بكلامكم",
    },
  },
  team: {
    title: { en: "Your team, in your WhatsApp group", ar: "فريقكم، في قروب الواتساب" },
    line: {
      en: "The people who run your ads and funnel, our call centre and your success manager are all in this one group.",
      ar: "اللي يشتغلون على إعلاناتكم ومسار العميل، وفريق الاتصال، ونجاح العملاء، كلهم معكم في قروب واحد.",
    },
    header: { en: "Your WhatsApp group", ar: "قروب الواتساب" },
    rows: [
      {
        key: "csm",
        name: { en: "Your client success manager", ar: "نجاح العملاء" },
        line: { en: "Your one point of contact, for anything.", ar: "نقطة تواصلكم معنا، لأي شي." },
      },
      {
        key: "cd",
        name: { en: "The creative director", ar: "المدير الإبداعي" },
        line: { en: "Your brand, your scripts and your ads.", ar: "هويتكم، وسكربتاتكم، وإعلاناتكم." },
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
    foot: {
      en: "We reply 10 to 6, Saturday to Thursday. If something worries you, we call you.",
      ar: "نرد من ١٠ صباحاً إلى ٦ مساءً، من السبت إلى الخميس. وإذا فيه شي شاغل بالكم، نتصل عليكم.",
    },
    footUae: {
      en: "We reply 10 to 6 Saudi time (11 to 7 in the UAE), Saturday to Thursday. If something worries you, we call you.",
      ar: "نرد من ١٠ صباحاً إلى ٦ مساءً بتوقيت السعودية (من ١١ إلى ٧ بتوقيت الإمارات)، من السبت إلى الخميس. وإذا فيه شي شاغل بالكم، نتصل عليكم.",
    },
  },
  one: {
    title: { en: "One service per campaign", ar: "خدمة وحدة لكل حملة" },
    line: {
      en: "We launch with one service, so the ads, the form questions and the calls are all written for one kind of customer.",
      ar: "نبدي بخدمة وحدة، عشان كل إعلان وكل سؤال وكل مكالمة تكلم نوع واحد من العملاء.",
    },
    numberOne: { en: "Your #1", ar: "الأولى عندكم" },
    tests: [
      { key: "sell", label: { en: "Easiest to sell", ar: "الأسهل بالبيع" } },
      { key: "profit", label: { en: "Most profit", ar: "الأكثر ربح" } },
      { key: "deliver", label: { en: "Least painful to deliver", ar: "الأريح بالتنفيذ" } },
    ],
    first: { en: "Your first campaign", ar: "أول حملة" },
    result: { en: "We'll launch with {service}", ar: "بنطلق أول حملة على {service}" },
    small: { en: "Once it works, we can add the next one.", ar: "ولما تمشي زين، نضيف الخدمة اللي بعدها." },
    launch: { en: "Launch with this", ar: "نطلق فيها" },
    add: { en: "Add a service", ar: "نضيف خدمة" },
    addInput: { en: "A service, in your words", ar: "الخدمة، بكلامكم" },
  },
  road: {
    title: { en: "The road to your first appointments", ar: "الطريق لأول مواعيدكم" },
    stops: [
      { en: "Contract signed", ar: "توقيع العقد" },
      { en: "Onboarding form", ar: "نموذج التعريف بالنشاط" },
      { en: "Onboarding call", ar: "مكالمة التعريف" },
      { en: "Brand and offer", ar: "بناء الهوية والعرض" },
      { en: "Launch call", ar: "مكالمة الإطلاق" },
      { en: "First appointments", ar: "أول المواعيد" },
    ],
    today: { en: "Today", ar: "اليوم" },
    launchLine: {
      en: "20 to 30 minutes. We walk you through everything that's going live.",
      ar: "من ٢٠ إلى ٣٠ دقيقة. نمر معكم على كل شي بينزل.",
    },
    afterGoLive: { en: "After go-live", ar: "بعد الإطلاق" },
    footer: {
      en: "Each call is booked at the end of the one before.",
      ar: "كل مكالمة نحجزها بآخر المكالمة اللي قبلها.",
    },
  },
  week: {
    title: { en: "What we need from you this week", ar: "اللي نحتاجه منكم هالأسبوع" },
    line: { en: "Most of it we'll do together, right now.", ar: "وأغلبه بنسويه مع بعض، الحين." },
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
          ar: "قبل مكالمة بناء الهوية: صور وفيديوهات بمجلد الدرايف. مشاريع خلصت، وشغل قيد التنفيذ، وفريقكم بالموقع. لا تفلترون، إحنا نفلتر.",
        },
        ticks: [{ key: "content", label: { en: "Content", ar: "المحتوى" } }],
      },
      past: {
        name: { en: "Past enquiries", ar: "الاستفسارات القديمة" },
        line: {
          en: "Have a list of old enquiries? Send it, and we'll agree whether to call them.",
          ar: "عندكم قائمة باستفسارات قديمة؟ أرسلوها، ونتفق إذا نتصل عليهم.",
        },
        ticks: [{ key: "past", label: { en: "Past enquiries", ar: "الاستفسارات القديمة" } }],
      },
      academy: {
        name: { en: "The Academy", ar: "الأكاديمية" },
        line: {
          en: "Courses for you and your team: your offer, closing your projects, your team and operations. Join, and start with the onboarding course.",
          ar: "كورسات لكم ولفريقكم: العرض، وتوقيع المشاريع، والفريق والتشغيل. انضموا، وابدوا بكورس Onboarding.",
        },
        ticks: [{ key: "academy", label: { en: "The Academy", ar: "الأكاديمية" } }],
      },
      phones: {
        name: { en: "Your callers' phones", ar: "جوالات فريق الاتصال عندكم" },
        line: {
          en: "Install the LeadConnector app, sign in and turn on alerts.",
          ar: "نزّلوا تطبيق LeadConnector، وسجلوا دخول، وفعّلوا التنبيهات.",
        },
        ticks: [{ key: "phones", label: { en: "Callers' phones", ar: "جوالات فريق الاتصال" } }],
      },
    },
  },
  next: {
    title: { en: "What to expect, and what's next", ar: "اللي تتوقعونه، والخطوة الجاية" },
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
      en: "If you approve them, starter ads can go live first, from our ready templates for {service}. Your own ads, made from your content, follow.",
      ar: "إذا وافقتوا، نقدر ننزل أول شي إعلانات البداية، من قوالبنا الجاهزة لخدمة {service}. وبعدها إعلاناتكم الخاصة، اللي نسويها من محتواكم.",
    },
    pendingNoPack: {
      en: "If you approve them, starter ads can go live first, from our ready templates. Your own ads, made from your content, follow.",
      ar: "إذا وافقتوا، نقدر ننزل أول شي إعلانات البداية، من قوالبنا الجاهزة. وبعدها إعلاناتكم الخاصة، اللي نسويها من محتواكم.",
    },
    declined: {
      en: "Your own ads, made from your content, go live first.",
      ar: "أول شي تنزل إعلاناتكم الخاصة، اللي نسويها من محتواكم.",
    },
    approval: {
      en: "Your first ads go live only once you've approved them.",
      ar: "أول إعلاناتكم ما تنزل إلا بعد موافقتكم.",
    },
    testName: { en: "The first weeks are a test", ar: "أول الأسابيع نختبر فيها الإعلانات" },
    testLine: {
      en: "Your red lines stay fixed. Tell us now what we must never say or show. Everything else, we test.",
      ar: "خطوطكم الحمراء ثابتة. قولوا لنا الحين اللي ما نقوله ولا نوريه أبد، والباقي نختبره.",
    },
    input: { en: "Your red lines, in your words", ar: "خطوطكم الحمراء، بكلامكم" },
    bandHead: { en: "Next: your Brand Blueprint call", ar: "الخطوة الجاية: مكالمة بناء الهوية والعرض" },
    bandRest: {
      en: "45 minutes with our creative director: your brand, your offer, your first ad scripts.",
      ar: "٤٥ دقيقة مع المدير الإبداعي: هويتكم، وعرضكم، وسكربتات أول إعلاناتكم.",
    },
    starterTitle: { en: "Your starter ads", ar: "إعلانات البداية" },
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
      "Keep the kickoff form open in your own tab. Share only the deck window. Present maximised, not full screen.",
    ],
    sayAr: [
      "شكراً على وقتكم. أنا {csm}، وباقي الفريق بتتعرفون عليهم بأدوارهم بعد شوي.",
      "المكالمة تقريباً ٤٥ دقيقة. نمر على كم شريحة، وبعدها نجهّز أغلب الأشياء مع بعض، على المكالمة نفسها.",
      "مين معنا اليوم؟ ومين اللي يقرر بخصوص الإعلانات، ومين اللي يقابل العملاء؟",
      "للعلم، المكالمة مسجلة عشان الفريق يرجع لها.",
    ],
  },
  goals: {
    say: [
      "Read their goals back. Don't re-ask anything they already answered.",
      'If a goal is a number, don\'t endorse it and don\'t argue with it. "We\'ll set targets together once the first meetings come in."',
      "Don't put a number on what's realistic (projects a month). It depends on the offer, the area and how they follow up.",
      "Remember the top challenge. It comes back when you choose the service on slide 4.",
    ],
    sayAr: ["(If a goal is a number) بنحط الأهداف مع بعض أول ما توصل أول المواعيد."],
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
    ],
    sayAr: [
      "كل واحد بالقروب يكلمكم عن شي واحد. وأنا نقطة تواصلكم معنا، لأي شي ثاني.",
      "الجمعة إجازة، والرسايل اللي توصل بعد الساعة ٦ نرد عليها بأول يوم دوام بعدها.",
    ],
  },
  "one-service": {
    say: [
      "Ask the three questions out loud for their top two or three services.",
      "Steer toward the service that passes all three. If none does, take the easiest to sell.",
      "Why one: the ads, the form questions and the call script are all written for one buyer.",
      "The choice carries through: it's the service in the launch deck and in the example call.",
    ],
    sayAr: [
      "أي خدمة فيها الأسهل بالبيع؟ وأي وحدة تجيب لكم أكثر ربح؟ وأي وحدة الأريح لكم بالتنفيذ؟",
      "الإعلانات وأسئلة النموذج وسكربت المكالمة، كلها تنكتب لنوع واحد من العملاء.",
      "وهالخدمة نفسها بتكون بمكالمة الإطلاق، وبمثال المكالمة اللي بنوريكم إياه.",
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
      "Do rows 1 and 2 now, on this call, and tick each one as it finishes. Most clients leave the onboarding call with these still open, and that is what delays a launch.",
      "Content: say it once, here. The more they upload before the Blueprint, the better the first ads.",
      "Past enquiries: no promise. Agree on the Blueprint call or in the group whether we call them.",
      "Anything left open: agree who does it and by when, and write it in the kickoff form.",
      "Don't link this list to the contract or to any guarantee.",
    ],
    sayAr: [
      "خلنا نخلص صلاحيات ميتا وMahara OS الحين، مع بعض.",
      "كل ما رفعتوا محتوى أكثر قبل مكالمة بناء الهوية، طلعت أول إعلاناتكم أحسن.",
      "الاستفسارات القديمة نتفق عليها بمكالمة بناء الهوية أو بالقروب، إذا نتصل عليهم ولا لا.",
      "(For anything left open) هذي مين بيخلصها، ومتى؟",
    ],
  },
  next: {
    say: [
      "Most clients want to see the starter ads first (3 of 4 recent kickoffs). If they do, go to stop 2.",
      "Approval names the ads, the offer and the Page they run under. No answer is not approval.",
      'Red lines: type them in their words ("never show prices"). They come back on the launch call.',
      "Book the Blueprint before you hang up.",
    ],
    sayAr: [
      "تبون تشوفون إعلانات البداية الحين؟",
      "فيه شي ما تبونا نقوله أو نوريه أبد؟ قولوه بكلامكم، وأنا أكتبه.",
      "خلنا نحجز مكالمة بناء الهوية والعرض الحين.",
    ],
    temp: {
      en: "Anything you're unsure about before we book the Blueprint?",
      ar: "فيه شي مو واضح لكم قبل لا نحجز مكالمة بناء الهوية؟",
    },
  },
};

/** Static links the CSM copies into the client's group (CONTENT data map). */
export const LINKS = {
  leadsie: "https://app.leadsie.com/connect/maharamedia/manage",
  academy: "https://www.skool.com/premium-projects-academy-3669",
  portal: "https://portal.maharamedia.com",
  portalInstall: "https://portal.maharamedia.com/install",
} as const;
