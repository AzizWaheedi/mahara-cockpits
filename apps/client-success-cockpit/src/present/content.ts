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
  return text.replace(
    /\{([a-zA-Z0-9_.]+)\}/g,
    (_, k: string) => slots[k] ?? "",
  );
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
    yourForm: { en: "Your form", ar: "نموذجكم" },
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

/** The call to action as Meta writes it (CONTENT L3, CONTENT-AR table). */
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
    dateline: { en: "Onboarding call · {date}", ar: "مكالمة التعريف · {date}" },
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
  goals: {
    title: {
      en: "Your goals, as you wrote them",
      ar: "أهدافكم مثل ما كتبتوها",
    },
    /** The title when nothing was written and the CSM types it live. */
    titleAsk: { en: "Your goals, in your words", ar: "أهدافكم، بكلامكم" },
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
    title: {
      en: "Your team, in your WhatsApp group",
      ar: "فريقكم، في قروب الواتساب",
    },
    line: {
      en: "The people who run your ads and funnel, our call centre and your success manager are all in this one group.",
      ar: "اللي يشتغلون على إعلاناتكم ومسار العميل، وفريق الاتصال، ونجاح العملاء، كلهم معكم في قروب واحد.",
    },
    /** Done with you: their own team calls, so no call centre of ours is in the group. */
    lineDwy: {
      en: "The people who run your ads and funnel and your success manager are all in this one group.",
      ar: "اللي يشتغلون على إعلاناتكم ومسار العميل، ونجاح العملاء، كلهم معكم في قروب واحد.",
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
    add: { en: "Add a service", ar: "أضيفوا خدمة" },
    addInput: { en: "A service, in your words", ar: "الخدمة، بكلامكم" },
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
    title: {
      en: "What we need from you this week",
      ar: "اللي نحتاجه منكم هالأسبوع",
    },
    line: {
      en: "Most of it we'll do together, right now.",
      ar: "وأغلبه بنسويه مع بعض، الحين.",
    },
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
          en: "Courses for you and your team: your offer, closing your projects, your team and operations. Join, and start with the onboarding course.",
          ar: "كورسات لكم ولفريقكم: العرض، وتوقيع المشاريع، والفريق والتشغيل. انضموا، وابدوا بكورس Onboarding.",
        },
        ticks: [
          { key: "academy", label: { en: "The Academy", ar: "الأكاديمية" } },
        ],
      },
      phones: {
        name: { en: "Your callers' phones", ar: "جوالات فريق الاتصال عندكم" },
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
    approval: {
      en: "Your first ads go live only once you've approved them.",
      ar: "أول إعلاناتكم ما تنزل إلا بعد موافقتكم.",
    },
    testName: {
      en: "The first weeks are a test",
      ar: "أول الأسابيع نختبر فيها الإعلانات",
    },
    testLine: {
      en: "Your red lines stay fixed. Tell us now what we must never say or show. Everything else, we test.",
      ar: "خطوطكم الحمراء ثابتة. قولوا لنا الحين اللي ما نقوله ولا نوريه أبد، والباقي نختبره.",
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
      "If a goal is a number, don't endorse it and don't argue with it. \"We'll set targets together once the first meetings come in.\"",
      "Don't put a number on what's realistic (projects a month). It depends on the offer, the area and how they follow up.",
      "Remember the top challenge. It comes back when you choose the service on slide 4.",
    ],
    sayAr: [
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
      'Red lines: type them in their words ("never show prices"), just under the test\'s line. They come back on the launch call.',
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

/** The two decks' names, for the chrome and the presenter's windows. */
export const DECK_NAME: Record<"onboarding" | "launch", L> = {
  onboarding: { en: "Onboarding", ar: "التعريف" },
  launch: { en: "Launch", ar: "الإطلاق" },
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
    dateline: { en: "Launch call · {date}", ar: "مكالمة الإطلاق · {date}" },
    goLive: { en: "Go-live", ar: "الإطلاق" },
    line: {
      en: "Everything your customers will see, before they see it.",
      ar: "كل شي بيشوفه عملاؤكم، تشوفونه قبلهم.",
    },
    lineLive: {
      en: "Everything your customers see, and what happens next.",
      ar: "كل شي يشوفه عملاؤكم، واللي يصير بعدها.",
    },
    road: { en: "Launch call · Today", ar: "مكالمة الإطلاق · اليوم" },
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
          en: "We call during working hours, 10 to 6, Saturday to Thursday. New enquiries go to the top of the list. Anything that comes in at night is called from 10 the next working morning.",
          ar: "نتصل خلال أوقات الدوام: من ١٠ صباحاً إلى ٦ مساءً، من السبت إلى الخميس. الاستفسارات الجديدة تطلع أول القائمة. واللي يوصل بالليل، نتصل عليه من الساعة ١٠ صباح أول يوم دوام.",
        },
        lineUae: {
          en: "We call during working hours, 10 to 6 Saudi time (11 to 7 in the UAE), Saturday to Thursday. New enquiries go to the top of the list. Anything that comes in at night is called from 10 the next working morning.",
          ar: "نتصل خلال أوقات الدوام: من ١٠ صباحاً إلى ٦ مساءً بتوقيت السعودية (من ١١ إلى ٧ بتوقيت الإمارات)، من السبت إلى الخميس. الاستفسارات الجديدة تطلع أول القائمة. واللي يوصل بالليل، نتصل عليه من الساعة ١٠ صباح أول يوم دوام.",
        },
        dwy: {
          en: "A new-enquiry alert reaches your callers' phones and your WhatsApp group. Call as soon as it arrives. Up to 4 tries over 3 working days.",
          ar: "تنبيه الاستفسار الجديد يوصل لجوالات فريق الاتصال عندكم وللقروب. اتصلوا أول ما يوصل، لين ٤ محاولات خلال ٣ أيام دوام.",
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
          en: "Once it's confirmed, it lands in your calendar and in Mahara OS, and you get a WhatsApp alert.",
          ar: "لما يتأكد الموعد، ينزل بتقويمكم وفي Mahara OS، ويوصلكم تنبيه على الواتساب.",
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
      deciding: { en: "Came, and thinking it over?", ar: "حضر وقاعد يفكر؟" },
      decidingLine: {
        en: "Yours. Follow up, then mark it.",
        ar: "عليكم. تابعوه، وبعدها سجلوا النتيجة.",
      },
      decidingDwy: {
        en: "Follow up, then move it to the right stage.",
        ar: "تابعوه، وبعدها انقلوه للمرحلة الصح.",
      },
    },
    queue: {
      fresh: { en: "New enquiry · {service}", ar: "استفسار جديد · {service}" },
      top: { en: "Top of the list", ar: "أول القائمة" },
      topDwy: { en: "Your team: call now", ar: "فريقكم: اتصلوا الحين" },
      second: {
        en: "Try 2 of 4 · {service} · 5 pm",
        ar: "المحاولة ٢ من ٤ · {service} · ٥ مساءً",
      },
      callback: {
        en: "Callback · {service} · 10 am",
        ar: "معاودة اتصال · {service} · ١٠ صباحاً",
      },
      lost: {
        en: "Not reached after 4 tries · reason noted",
        ar: "ما ردّ بعد ٤ محاولات · السبب مكتوب",
      },
      night: {
        en: "Came in at night? Called from 10 the next working morning.",
        ar: "وصل بالليل؟ نتصل عليه من الساعة ١٠ صباح أول يوم دوام.",
      },
    },
    calendar: {
      block: { en: "Appointment · {place}", ar: "موعد · {place}" },
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
      /** {word} is the label as the phone shows it, in the phone's language. */
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
  test: {
    owner: { en: "Creative freedom", ar: "المساحة الإبداعية" },
    title: {
      en: "Your red lines are fixed. The rest, we test.",
      ar: "خطوطكم الحمراء ثابتة، والباقي نختبره.",
    },
    page: {
      name: { en: "Your page stays yours", ar: "صفحتكم تبقى لكم" },
      copy: {
        en: "Paid ads show in the feed, marked Sponsored. They don't appear on your page. They're made for people who don't know you yet. The polished work belongs in your page's own posts.",
        ar: "الإعلانات الممولة تطلع بالفيد، ومكتوب عليها مُموَّل، وما تطلع على صفحتكم. معمولة لناس ما يعرفونكم للحين. والشغل الفخم والمرتب مكانه حسابكم نفسه.",
      },
    },
    fixed: {
      name: { en: "Fixed: your red lines", ar: "الثابت: خطوطكم الحمراء" },
      always: { en: "Always …", ar: "دايماً …" },
      never: { en: "Never …", ar: "أبد ما …" },
      told: { en: "You told us:", ar: "قلتوا لنا:" },
      copy: {
        en: "We never cross these. You approve every fact, price and claim. Anything wrong or off-brand, we fix.",
        ar: "وهذي ما نتعداها أبد. وأنتم توافقون على كل معلومة، وكل سعر، وكل وعد نقوله عنكم. وأي شي غلط أو ما يشبه هويتكم، نصلحه.",
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
      name: {
        en: "Open: everything else we test",
        ar: "المفتوح: كل شي ثاني نختبره",
      },
      chips: [
        { en: "Angles", ar: "الزوايا" },
        { en: "Hooks", ar: "البداية اللي تشد" },
        { en: "Formats", ar: "طرق العرض" },
        { en: "Thumbnails", ar: "صورة الغلاف" },
        { en: "Who's on camera", ar: "مين يطلع بالفيديو" },
      ],
      pick: {
        en: "Your pick runs too, beside the ones you'd skip. The numbers tell us which work.",
        ar: "اختياركم ينزل بعد، جنب اللي يمكن ما تختارونها. والأرقام هي اللي توضح لنا أي واحد يشتغل.",
      },
      pickNone: {
        en: "The ones you'd pick run too, beside the ones you'd skip. The numbers tell us which work.",
        ar: "اللي تختارونها تنزل بعد، جنب اللي يمكن ما تختارونها. والأرقام هي اللي توضح لنا أي واحد يشتغل.",
      },
      approve: {
        en: "You approve your ads in the group. Once you have, we test versions of them side by side.",
        ar: "توافقون على إعلاناتكم بالقروب، وبعد موافقتكم نختبر أكثر من نسخة منها مع بعض.",
      },
    },
    footer: {
      en: "Prefer something different later? Ask in the group, and we'll launch it too.",
      ar: "تبون شي ثاني بعدين؟ اطلبوه بالقروب، وننزله بعد.",
    },
    proof: {
      name: { en: "How a test runs", ar: "بهالشكل يمشي الاختبار" },
      caption: {
        en: "One campaign, 20 versions side by side. Some stay on, some go off.",
        ar: "حملة وحدة، فيها ٢٠ نسخة مع بعض. بعضها يكمل، وبعضها يوقف.",
      },
    },
    stamp: {
      en: "Agreed to test this way · {date}",
      ar: "اتفقنا نختبر بهالطريقة · {date}",
    },
  },
  form: {
    owner: { en: "Your customer sees this", ar: "هذا اللي يشوفه عميلكم" },
    title: { en: "Your form", ar: "نموذج إعلانكم" },
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
      en: "Thank you. Our team will call you during working hours.",
      ar: "شكراً لك. فريقنا بيتواصل معك خلال أوقات الدوام.",
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
      en: "Our team calls them during working hours.",
      ar: "وفريقنا يتصل عليه خلال أوقات الدوام.",
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
    clockEnd: { en: "Call ended", ar: "انتهت المكالمة" },
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
      rows: [
        {
          when: { en: "Booked", ar: "عند الحجز" },
          what: { en: "a WhatsApp confirmation", ar: "تأكيد على الواتساب" },
        },
        {
          when: { en: "The day before", ar: "قبلها بيوم" },
          what: { en: "a reminder", ar: "تذكير" },
        },
        { what: { en: "A confirmation call", ar: "مكالمة تأكيد" } },
        {
          when: { en: "2 hours before", ar: "قبلها بساعتين" },
          what: { en: "an SMS", ar: "رسالة نصية" },
        },
        { what: { en: "The meeting", ar: "الموعد" } },
      ] as { when?: L; what: L; plain?: boolean }[],
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
          what: {
            en: "Reminders before the meeting",
            ar: "تذكيرات قبل الموعد",
          },
        },
        {
          when: { en: "Provisional bookings", ar: "الحجوزات المبدئية" },
          what: {
            en: "your team calls 48 and 24 hours before",
            ar: "فريقكم يتصل قبلها بيومين، وقبلها بيوم",
          },
          plain: true,
        },
        { what: { en: "The meeting", ar: "الموعد" } },
      ] as { when?: L; what: L; plain?: boolean }[],
    },
    lands: {
      heading: { en: "New appointment", ar: "موعد جديد" },
      who: { en: "Customer", ar: "العميل" },
      when: { en: "When", ar: "الموعد" },
      where: { en: "Where", ar: "المكان" },
      service: { en: "Service", ar: "الخدمة" },
      notes: { en: "Our caller's notes", ar: "ملاحظات فريق الاتصال" },
      notesDwy: { en: "Your caller's notes", ar: "ملاحظات فريق الاتصال عندكم" },
      caption: {
        en: "Our caller's notes come with it.",
        ar: "وملاحظات فريق الاتصال توصل معه.",
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
    jobTag: { en: "Your number-one job", ar: "أهم شغلة عليكم" },
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
  part: {
    title: { en: "Your part", ar: "دوركم" },
    line: {
      en: "Your five jobs, in one place.",
      ar: "خمس شغلات عليكم، بمكان واحد.",
    },
    why: { en: "Why it matters", ar: "ليش مهم" },
    rows: [
      {
        key: "ads",
        job: {
          en: "Leave the ads running through the first weeks",
          ar: "خلوا الإعلانات شغالة أول الأسابيع",
        },
        why: {
          en: "Ads need time before we can tell which ones work.",
          ar: "الإعلانات تحتاج وقت، قبل لا نعرف أي واحد فيها يشتغل.",
        },
      },
      {
        key: "mark",
        job: {
          en: "Mark every meeting, the same day",
          ar: "سجلوا نتيجة كل موعد، بنفس اليوم",
        },
        why: {
          en: "Your outcomes show which ads bring real projects.",
          ar: "نتائجكم توضح أي إعلانات تجيب مشاريع حقيقية.",
        },
        jobDwy: {
          en: "Call fast, note every try, keep every stage true",
          ar: "اتصلوا بسرعة، وسجلوا كل محاولة، وخلوا كل مرحلة صحيحة",
        },
        whyDwy: {
          en: "Interest fades, and a missing note means nobody knows what happened.",
          ar: "الحماس يبرد، والملاحظة الناقصة تخلي ماحد يعرف اللي صار.",
        },
      },
      {
        key: "drive",
        job: {
          en: "Keep your Drive folder fed",
          ar: "خلوا مجلد الدرايف مليان",
        },
        why: {
          en: "Fresh projects keep your ads from tiring.",
          ar: "المشاريع الجديدة تخلي إعلاناتكم ما تبهت.",
        },
      },
      {
        key: "offer",
        job: {
          en: "Keep the offer steady while we test",
          ar: "ثبّتوا العرض وإحنا نختبر",
        },
        why: {
          en: "Want to change it? Ask in the group first. A new offer mid‑test starts the test again. If you ask first, we can plan it in.",
          ar: "تبون تغيرونه؟ قولوا لنا بالقروب أول. العرض الجديد بنص الاختبار يرجّعه من البداية. وإذا قلتوا لنا أول، نرتب له.",
        },
      },
      {
        key: "calendar",
        job: {
          en: "Block busy times and holidays in your calendar",
          ar: "سكروا أوقات انشغالكم وإجازاتكم بالتقويم",
        },
        why: {
          en: "Our callers book into the times you leave free.",
          ar: "فريق الاتصال يحجز بالأوقات اللي تخلونها فاضية.",
        },
        whyDwy: {
          en: "Your team books into the times you leave free.",
          ar: "فريقكم يحجز بالأوقات اللي تخلونها فاضية.",
        },
      },
    ] as { key: string; job: L; why: L; jobDwy?: L; whyDwy?: L }[],
    drive: { en: "Drive", ar: "الدرايف" },
    busy: { en: "Busy", ar: "مشغول" },
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
    /** Under the dashed open end of the first window. */
    open: { en: "Can run longer", ar: "ممكن تطوّل" },
    checkins: { en: "Check-ins", ar: "مكالمات المتابعة" },
    first: {
      en: "Your first check-in · a week or two in",
      ar: "أول مكالمة متابعة · بعد أسبوع أو أسبوعين",
    },
    later: { en: "Then every two weeks", ar: "وبعدها كل أسبوعين" },
    laterLine: {
      en: "20 to 30 minutes on Zoom: what's working, and what we're changing.",
      ar: "من ٢٠ إلى ٣٠ دقيقة على زوم: اللي شغال، واللي بنغيره.",
    },
    looksBack: {
      en: "At 30, 60 and 90 days, that check-in looks back over the month.",
      ar: "عند ٣٠ و٦٠ و٩٠ يوم، مكالمة المتابعة تراجع الشهر كامل.",
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
  green: {
    title: { en: "Before we go live", ar: "قبل لا ننطلق" },
    charges: {
      en: "Meta's first charges on your card are small. That's normal. Tell your bank so it doesn't block them.",
      ar: "أول مبالغ تخصمها ميتا من بطاقتكم تكون صغيرة، وهذا طبيعي. بلّغوا البنك عشان ما يوقفها.",
    },
    comments: {
      en: "Comments on your ads are yours to answer. Not sure what to say? Ask in the group.",
      ar: "التعليقات على إعلاناتكم، الرد عليها عليكم. ما تدرون كيف تردون؟ اسألونا بالقروب.",
    },
    hours: {
      en: "We reply 10 to 6, Saturday to Thursday.",
      ar: "نرد من ١٠ صباحاً إلى ٦ مساءً، من السبت إلى الخميس.",
    },
    hoursUae: {
      en: "We reply 10 to 6 Saudi time (11 to 7 in the UAE), Saturday to Thursday.",
      ar: "نرد من ١٠ صباحاً إلى ٦ مساءً بتوقيت السعودية (من ١١ إلى ٧ بتوقيت الإمارات)، من السبت إلى الخميس.",
    },
    question: { en: "Happy for us to go live?", ar: "على بركة الله، ننطلق؟" },
    next: {
      en: "Your first check-in · {date}",
      ar: "أول مكالمة متابعة · {date}",
    },
    rail: { en: "Go-live · {date}", ar: "الإطلاق · {date}" },
  },
} as const;

/** The launch deck's slide titles, in order (the overview and the notes). */
export const L_TITLES = {
  cover: LAUNCH.cover.title,
  journey: JOURNEY.title,
  ads: LAUNCH.ads.title,
  "creative-freedom": LAUNCH.test.title,
  form: LAUNCH.form.title,
  call: LAUNCH.call.title,
  portal: LAUNCH.portal.title,
  "your-part": LAUNCH.part.title,
  "first-90-days": LAUNCH.days.title,
  "green-light": LAUNCH.green.title,
} as const;

export const L_NOTES: Record<keyof typeof L_TITLES, SlideNotes> = {
  cover: {
    say: [
      'Frame it: "About 25 minutes. What goes live, what happens when someone enquires, and what we need from you. Stop me anytime."',
      "Ask for their full attention for those minutes.",
      "If starter ads are already running, say so plainly and use the call to show the whole picture.",
      "Skip the introduction if you ran their onboarding call.",
      "Share the deck window only. Present maximised, not full screen, so you can add a file from the notes window.",
    ],
    sayAr: [
      "تقريباً ٢٥ دقيقة. بنمر على اللي بينزل، وعلى اللي يصير لما أحد يستفسر، وعلى اللي نحتاجه منكم. وقفوني بأي وقت.",
      "إذا تقدرون، خلونا معكم هالدقايق كاملة.",
      "(Starter ads already running) إعلانات البداية شغالة من قبل، واليوم بوريكم الصورة كاملة.",
      "(Only if you did not run their onboarding call) أنا {csm}، من فريق نجاح العملاء، وباقي الفريق بتعرفونهم بأدوارهم.",
    ],
  },
  journey: {
    say: [
      "Walk the stops with the arrow keys. Let each one land before you speak. The mini rail on the next slides makes the callback; don't announce it.",
      "At stop 3, say the hours plainly and don't promise faster. If they ask why not at night: the team works 10 to 6, Saturday to Thursday, and night enquiries are among the first calls of the next working morning.",
      "At stop 6, point at the dotted line: the no-show comes back to us.",
    ],
    sayAr: [
      "(The calling stop, if they ask about night) فريقنا يشتغل من ١٠ الصبح إلى ٦ المسا، من السبت إلى الخميس، واللي يوصل بالليل يكون من أول الاتصالات بأول يوم دوام.",
      "(The fork) شوفوا هالخط: اللي ما يحضر، يرجع لنا.",
    ],
    temp: {
      en: "Any step here you'd want done differently?",
      ar: "فيه خطوة هنا تبونها تمشي بطريقة ثانية؟",
    },
    dwy: [
      "Stops 3 and 4 sit in their lane: their team calls and books. The no-show line stays in their lane too.",
    ],
  },
  ads: {
    say: [
      'Let them choose: "Which one would stop you scrolling?" Mark it (M, or the star here).',
      "Swap one live, so they see how each creative looks in the feed.",
      "A wrong fact (a price, a service, an area): write it down; we fix it.",
      "A preference: that's the next slide.",
      "This preview isn't approval. Approval happens in the group.",
    ],
    sayAr: [
      "أي واحد فيها بيوقفكم وأنتم تقلّبون جوالكم؟",
      "خلوني أحط هذا مكانه الحين، وشوفوا كيف يطلع بالفيد.",
      "(A wrong fact) خلوني أكتبها، ونصلحها.",
      "(A preference) هذي نتكلم عنها بالشريحة الجاية.",
      "هذي معاينة بس، مو موافقة.",
    ],
  },
  "creative-freedom": {
    say: [
      "Concede first: their page, then their red lines, then the ask.",
      'The close, in your own words: "You came to us for performance. We\'d rather protect that than protect a look."',
      "Ask: \"Anything else we must never say or show?\" Add it to their card's Do's & Don'ts after the call.",
      "They ask for changes in the group, and we answer with the reason.",
      "At the temp check, record the agreement only when they say yes.",
      "A content plan for their page is a separate conversation. Don't promise it here.",
      'If they want to hold an ad back until it\'s perfect: "An ad waiting for the perfect version earns nothing while it waits."',
    ],
    sayAr: [
      "أنتم جيتونا عشان الأداء، وإحنا نفضّل نحمي الأداء على إننا نحمي شكل معين.",
      "فيه شي ثاني ما تبونا نقوله أو نوريه أبد؟",
      "أي تغيير تبونه، اطلبوه بالقروب، ونرد عليكم بالسبب.",
      "(If they want to wait for a perfect ad) الإعلان اللي ينتظر النسخة المثالية، ما يجيب شي وهو ينتظر.",
    ],
    temp: {
      en: "Can we agree to test this way?",
      ar: "متفقين نختبر بهالطريقة؟",
    },
  },
  form: {
    say: [
      'Read the filter questions out: "This is the first filter. The call is the second."',
      "Check the facts with them: service names, areas, wording.",
      "If they want more questions: every extra question also loses some good people. We add one when the enquiries show we need it.",
    ],
    sayAr: [
      "هذا أول فلتر، والمكالمة هي الفلتر الثاني.",
      "أسماء الخدمات والمناطق والكلام هنا، كلها صحيحة؟",
      "(If they want more questions) كل سؤال زيادة يطيّر معه ناس زينين بعد. نضيف سؤال لما الاستفسارات توضح إننا نحتاجه.",
    ],
  },
  call: {
    say: [
      '"This is the script we use, with your details in it. Our caller speaks as your appointments team."',
      'Point at the teal words. Ask for anything marked "To give us".',
      "If they'd rather the caller share a starting price, ask them to add it to the guide. The script doesn't quote prices it doesn't have.",
      "At stop 7, the reminders: say them once, as what we do before the meeting.",
      'At stop 8: "Everything the caller learned comes to you, so you walk in knowing the project."',
      "\"You'll hear your own real calls in Mahara OS. I'll show you next.\" Never play a recording of another client's call.",
    ],
    sayAr: [
      "هذا السكربت اللي نستخدمه، ومعلوماتكم داخله. فريق الاتصال يتكلم باسمكم، كقسم المواعيد عندكم.",
      "الكلمات الملونة من ملفاتكم. واللي عليه نحتاجه منكم، تقدرون تعطونا إياه الحين.",
      "إذا تبون فريق الاتصال يذكر سعر يبدي منه، ضيفوه بالدليل. السكربت ما يذكر سعر ما عندنا.",
      "(After the call) وهذا اللي نسويه قبل الموعد.",
      "(What lands with them) كل اللي عرفه فريق الاتصال يوصلكم، فتدخلون الموعد وأنتم عارفين المشروع.",
      "مكالماتكم الحقيقية بتسمعونها في Mahara OS، وبوريكم إياها الحين.",
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
  portal: {
    say: [
      "If they haven't signed in yet, do it now.",
      "Slow down on stop 4. It's the job clients most often drop: only 30% of recent appointments have attendance marked.",
      "Why it matters: the outcomes show which ads bring real projects, so we put more behind those.",
      "The portal can remind them after each appointment to mark it.",
      "If they already use the report sheet, the two stay in step.",
    ],
    sayAr: [
      "إذا ما سجلتوا دخول للحين، خلنا نسويها الحين.",
      "(Marking outcomes) هذي أكثر شغلة تنتسى، فخلونا نوقف عندها شوي.",
      "النتائج توضح لنا أي إعلانات تجيب مشاريع حقيقية، فنحط عليها أكثر.",
      "والبوابة تقدر تذكركم بعد كل موعد عشان تسجلون نتيجته.",
      "وإذا تستخدمون شيت التقارير، الاثنين يتحدثون مع بعض.",
    ],
  },
  "your-part": {
    say: [
      'Sixty seconds: "Your five jobs in one place. I\'ll send this card to the group."',
      "After the call, send this card in the group as the recap.",
      "A slot outside their hours, a holiday and a service detail are the questions our callers ask most.",
      "They don't need to answer on Fridays or in the evening.",
    ],
    dwy: [
      "Their own callers ask those questions and book into the free times; the group answers them.",
    ],
    sayAr: [
      "هذي خمس شغلات عليكم، بمكان واحد. وبأرسل لكم هالكرت بالقروب.",
      "تبون تغيرون العرض أو الخدمة؟ قولوا لنا بالقروب أول، ونرتبها بطريقة ما ترجّع التجربة من الصفر.",
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
      "Some first weeks are busy and some are quiet. Either way, we're finding what their market responds to.",
      "Updates come in the group as things happen.",
      "Check-ins: a laptop, somewhere quiet, not in the car. The next one is booked at the end of each.",
    ],
    sayAr: [
      "فيه بدايات تكون زحمة، وفيه بدايات هادية. وبالحالتين، إحنا نكتشف اللي يتفاعل معه سوقكم.",
      "والتحديثات توصلكم بالقروب أول بأول.",
      "مكالمات المتابعة: لابتوب ومكان هادي، مو وأنتم بالسيارة. واللي بعدها نحجزها بآخر كل مكالمة.",
    ],
    temp: { en: "Does this rhythm work for you?", ar: "هالإيقاع يناسبكم؟" },
    dwy: [
      "The first booking is their team's.",
      "(Arabic) أول حجز بيكون من فريقكم.",
    ],
  },
  "green-light": {
    say: [
      "Questions first, then ask for the green light in those words.",
      "Book the first check-in before you hang up, a week or two after go-live.",
      "If they hesitate, find the one thing and solve it now, or agree a date to solve it.",
      'Say the awkward thing: "If anything worries you at any point, tell me. The partners who do best tell us the good and the bad."',
      'After the call, send the "Your part" card in the group as the one short recap, not the long launch message.',
    ],
    sayAr: [
      "قبل لا نكمل، عندكم أي سؤال؟",
      "على بركة الله، ننطلق؟",
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
} as const;
