/**
 * Everything the pitch deck says, in English and Gulf Arabic, in one place
 * so the words can be changed without touching the slides.
 *
 * The rules this copy keeps (Aziz and the brand guidelines):
 * - Numbers first, plain words, no em dashes, clients are "partners", never
 *   "contractors" in English and never مقاول for the buyer in Arabic.
 * - Arabic lines are Aziz's Kuwaiti voice (mahara-context
 *   skills/aziz-kuwaiti-voice): شنو، جذي، الحين، ييك، جدام; دولار for money
 *   and Arabic-Indic numerals.
 * - Proof is only what a partner said on camera or what our own records
 *   show, each with its source: the eight stories are the Wistia masters in
 *   the sales asset library, their claims as the library's send-ready pages
 *   state them; the case study is on YouTube; the Google rating was read on
 *   27 September 2026; the campaign averages are the CEO cockpit's delivery
 *   numbers for 1 to 27 September 2026.
 * - Results are never promised: legally we can't, because every business
 *   is different (Aziz, 2026-10-02). The guarantee is the 7-day satisfaction
 *   guarantee, worded as the contract has it (section 3 of "90 Day Agreement
 *   (7 Day Satisfaction Guarantee)"), and it is not pitched. It sits hidden on the investment slide
 *   and comes out when a prospect asks for certainty (Aziz, 2026-09-27:
 *   "It's an objection handle. It's a tool you use.").
 */

import { hold } from "./figure";

export type Lang = "en" | "ar";
export interface L {
  en: string;
  ar: string;
}

/** A line in the language on screen, its numbers held to what they count. */
export const t = (l: L, lang: Lang) => hold(l[lang]);

export const COUNTRIES: L[] = [
  { en: "Kuwait", ar: "الكويت" },
  { en: "Saudi Arabia", ar: "السعودية" },
  { en: "UAE", ar: "الإمارات" },
  { en: "Qatar", ar: "قطر" },
  { en: "Bahrain", ar: "البحرين" },
  { en: "Oman", ar: "عُمان" },
];

// ------------------------------------------------------------ the system

export type PillarKey = "ads" | "filter" | "sales" | "closing" | "data";

export interface Pillar {
  key: PillarKey;
  short: L;
  name: L;
  line: L;
}

export const PILLARS: Pillar[] = [
  {
    key: "ads",
    short: { en: "Ads", ar: "الإعلانات" },
    name: { en: "Targeted premium ads", ar: "إعلانات للمشاريع عالية القيمة" },
    line: {
      en: "Ads that reach owners with real projects and real budgets.",
      ar: "إعلانات توصل لأصحاب مشاريع حقيقية.. وعندهم ميزانية حقيقية.",
    },
  },
  {
    key: "filter",
    short: { en: "Filter", ar: "الفلترة" },
    name: { en: "Lead filtration", ar: "فلترة الليدز" },
    line: {
      en: "Pages and forms that screen out the time-wasters before anyone calls.",
      ar: "لاندنق بيج وفورم يفلترون اللي يضيعون وقتك قبل لا أحد يتصل.",
    },
  },
  {
    key: "sales",
    short: { en: "Sales team", ar: "فريق المبيعات" },
    name: { en: "The project sales team", ar: "فريق مبيعات المشاريع" },
    line: {
      en: "We call every lead within five minutes and book the serious ones on your calendar.",
      ar: "نكلم كل ليد خلال ٥ دقايق ونحجز الجادين بجدولك.",
    },
  },
  {
    key: "closing",
    short: { en: "Closing", ar: "إقفال الصفقات" },
    name: { en: "Project closing mastery", ar: "إتقان توقيع المشاريع" },
    line: {
      en: "Training and reviews of your real calls, so you sign more of the people you meet.",
      ar: "تدريب ومراجعة لمكالماتك الحقيقية.. عشان توقّع مع عدد أكبر من اللي تقابلهم.",
    },
  },
  {
    key: "data",
    short: { en: "Data", ar: "الأرقام" },
    name: { en: "Data and scaling", ar: "الأرقام والتوسع" },
    line: {
      en: "Every lead, call and signed project in your own portal, and a plan to scale what works.",
      ar: "كل ليد، كل مكالمة، وكل مشروع موقّع.. ببوابتك انت، وخطة نكبّر فيها اللي يشتغل.",
    },
  },
];

// ------------------------------------------------------ the problem picker

export type ProblemKey =
  | "referrals"
  | "burned"
  | "social"
  | "quality"
  | "volume";

export interface Problem {
  key: ProblemKey;
  says: L;
  sub: L;
  /** The pillars that answer it most directly. */
  pillars: PillarKey[];
  /** Said at the top of those pillars' slides. */
  bridge: L;
}

export const PROBLEMS: Problem[] = [
  {
    key: "referrals",
    says: {
      en: "We rely on referrals and word of mouth.",
      ar: "شغلنا كله على التوصيات والمعارف.",
    },
    sub: {
      en: "Good months are random. Slow months are scary.",
      ar: "الشهر الزين صدفة.. والشهر الهادي يخرعك.",
    },
    pillars: ["ads"],
    bridge: {
      en: "You said you depend on referrals. This is how you take control of your pipeline.",
      ar: "قلت إن شغلك على التوصيات.. وهذا اللي يخلي المشاريع الياية بإيدك انت.",
    },
  },
  {
    key: "burned",
    says: {
      en: "We tried an agency or ads, and it didn't work.",
      ar: "جربنا وكالة أو إعلانات.. وما نفعت.",
    },
    sub: {
      en: "You paid, saw nothing, and now you doubt any of it works.",
      ar: "دفعت وما شفت شي.. وصرت تشك إن أي تسويق يشتغل.",
    },
    pillars: ["ads", "filter"],
    bridge: {
      en: "You've been burned before. Here is what is different this time.",
      ar: "جربت قبل وما نفع.. وهذا اللي مختلف هالمرة.",
    },
  },
  {
    key: "social",
    says: {
      en: "We post on social media, but no real inquiries come.",
      ar: "ننزل محتوى بالسوشال ميديا.. بس ماكو استفسارات حقيقية.",
    },
    sub: {
      en: "Likes don't sign contracts.",
      ar: "اللايكات ما توقّع عقود.",
    },
    pillars: ["ads"],
    bridge: {
      en: "You already put in the effort. This turns it into inquiries we can count.",
      ar: "انت أصلاً تتعب على المحتوى.. هذا اللي يحوله لاستفسارات تنحسب.",
    },
  },
  {
    key: "quality",
    says: {
      en: "We get inquiries, but they're not serious.",
      ar: "يينا استفسارات.. بس أصحابها مو جادين.",
    },
    sub: {
      en: "Wrong budget, wrong project, not ready. And they eat your week.",
      ar: "ميزانية غلط، مشروع غلط، مو جاهزين.. وياكلون أسبوعك.",
    },
    pillars: ["filter", "sales"],
    bridge: {
      en: "Your inquiries aren't serious. This filters them before they reach you.",
      ar: "اللي يستفسرون عندك مو جادين.. وهذا يفلترهم قبل لا يوصلون لك.",
    },
  },
  {
    key: "volume",
    says: {
      en: "We close well. We need more of the right projects.",
      ar: "نقفل زين.. بس نبي مشاريع مناسبة أكثر.",
    },
    sub: {
      en: "The pipeline is the bottleneck, not your selling.",
      ar: "المشكلة بالكمية.. مو ببيعك.",
    },
    pillars: ["ads", "sales"],
    bridge: {
      en: "You close well. This fills your calendar with qualified meetings.",
      ar: "انت تقفل زين.. هذا يترس جدولك بمواعيد مؤهلة.",
    },
  },
];

// ---------------------------------------------------------------- proof

export interface Story {
  id: string;
  wistia: string;
  /** Width over height of the video. */
  ratio: number;
  seconds: number;
  who: L;
  company: L;
  trade: L;
  result: L;
  why: L;
}

/**
 * The eight testimonial masters on Wistia (the July deck brief's order),
 * with the result each partner states as the asset library's send-ready
 * page words it, and why it lands with a prospect (the library's own
 * "what it proves").
 */
export const STORIES: Story[] = [
  {
    id: "story-bayt22",
    wistia: "qecv9jfnwp",
    ratio: 16 / 9,
    seconds: 110,
    who: { en: "Nawaf", ar: "نواف" },
    company: { en: "BAYT 22", ar: "BAYT 22" },
    trade: { en: "Design and build", ar: "تصميم وتنفيذ" },
    result: {
      en: "Revenue up 3 to 4 times. He paused the ads to keep up.",
      ar: "الدخل زاد ٣ لـ٤ أضعاف.. ووقّف الإعلانات عشان يلحق على الشغل.",
    },
    why: {
      en: "The biggest result in our library, said on camera by the partner himself.",
      ar: "أكبر نتيجة عندنا.. وقالها بلسانه جدام الكاميرا.",
    },
  },
  {
    id: "story-phoenix",
    wistia: "4gt6ep2jxr",
    ratio: 16 / 9,
    seconds: 140,
    who: { en: "Ali Al-Shammari", ar: "علي الشمري" },
    company: { en: "Phoenix United, Kuwait", ar: "فينكس المتحدة، الكويت" },
    trade: { en: "Contracting", ar: "مقاولات" },
    result: {
      en: "From referrals only to 4 to 5 big projects signed in two months.",
      ar: "من توصيات بس.. لـ٤ أو ٥ مشاريع كبيرة موقّعة بشهرين.",
    },
    why: {
      en: "He ran purely on referrals, in a market he calls flat. He asked us to pause the ads because his team could not keep up.",
      ar: "كان شغله كله توصيات، بسوق يقول عنه واقف.. وطلب نوقف الإعلانات لأن فريقه ما لحق.",
    },
  },
  {
    id: "story-safad",
    wistia: "ia1s7iyb4s",
    ratio: 16 / 9,
    seconds: 99,
    who: { en: "Abdullah", ar: "عبدالله" },
    company: { en: "SAFAD Design & Build", ar: "سافاد للتصميم والتنفيذ" },
    trade: { en: "Design and build", ar: "تصميم وتنفيذ" },
    result: {
      en: "Revenue tripled in three months.",
      ar: "الدخل صار ٣ أضعاف خلال ٣ شهور.",
    },
    why: {
      en: "A design-and-build office owner, named and on camera.",
      ar: "صاحب مكتب تصميم وتنفيذ.. باسمه وجدام الكاميرا.",
    },
  },
  {
    id: "story-joesera",
    wistia: "6dlcwraqde",
    ratio: 16 / 9,
    seconds: 83,
    who: { en: "Joseph", ar: "جوزيف" },
    company: { en: "Joe & Sera Design Studio", ar: "Joe & Sera Design Studio" },
    trade: { en: "Interior design", ar: "تصميم داخلي" },
    result: {
      en: "A schedule full of high-value projects inside a month.",
      ar: "خلال شهر.. جدوله صار متروس بمشاريع عالية القيمة.",
    },
    why: {
      en: "He says it himself: he did not expect it to work.",
      ar: "يقولها بنفسه: ما كان متوقع إنها بتشتغل.",
    },
  },
  {
    id: "story-grandiocity",
    wistia: "tkduyx1smp",
    ratio: 960 / 732,
    seconds: 72,
    who: { en: "Ahmed", ar: "أحمد" },
    company: { en: "GrandioCity", ar: "قرانديو سيتي" },
    trade: { en: "Construction and interiors", ar: "مقاولات وتصميم" },
    result: {
      en: "A calendar of high-value projects in 48 days.",
      ar: "كلندر متروس بمشاريع عالية القيمة خلال ٤٨ يوم.",
    },
    why: {
      en: "He talks about the quality of the appointments, not the count.",
      ar: "يتكلم عن نوعية المواعيد.. مو عددها.",
    },
  },
  {
    id: "story-laststep",
    wistia: "gcht7a3snc",
    ratio: 16 / 9,
    seconds: 90,
    who: { en: "Haneen Hamidan", ar: "حنين حميدان" },
    company: { en: "The Last Step, UAE", ar: "The Last Step، الإمارات" },
    trade: { en: "Design and fit-out", ar: "تصميم وتشطيب" },
    result: {
      en: "A full schedule in 30 days, in a slow market.",
      ar: "جدول كامل خلال ٣٠ يوم.. والسوق كان هادي.",
    },
    why: {
      en: 'The answer to "let\'s start when the market picks up".',
      ar: "الرد على: خلنا نبدي لمن السوق يتحرك.",
    },
  },
  {
    id: "story-lifedepth",
    wistia: "kvtchezxg3",
    ratio: 16 / 9,
    seconds: 147,
    who: { en: "Ahmed", ar: "أحمد" },
    company: { en: "Life Depth Contracting", ar: "عمق الحياة للمقاولات" },
    trade: { en: "Contracting", ar: "مقاولات" },
    result: {
      en: "15+ new clients in two weeks.",
      ar: "أكثر من ١٥ عميل يديد خلال أسبوعين.",
    },
    why: {
      en: "Eight months of a quiet phone before. He bought a second phone just for the new clients.",
      ar: "قبلها ٨ شهور التلفون ساكت.. وشرى تلفون ثاني بس للعملاء اليدد.",
    },
  },
  {
    id: "story-amheco",
    wistia: "avt9fu3h06",
    ratio: 16 / 9,
    seconds: 112,
    who: { en: "Abdullah AlHusseini", ar: "عبدالله الحسيني" },
    company: { en: "AMHECO", ar: "AMHECO" },
    trade: { en: "Engineering consultancy", ar: "استشارات هندسية" },
    result: {
      en: "The clients he actually wanted, inside one month.",
      ar: "العملاء اللي فعلاً يبيهم.. خلال شهر واحد.",
    },
    why: {
      en: "Fit, not volume: projects with the clients he wanted.",
      ar: "النوعية مو الكمية.. مشاريع مع العملاء اللي يبيهم.",
    },
  },
];

export const CASE_STUDY = {
  youtube: "34U-biIvOog",
  seconds: 736,
  result: {
    en: "$2M in signed projects in 60 days.",
    ar: "٢ مليون دولار مشاريع موقّعة خلال ٦٠ يوم.",
  },
  before: {
    en: "A contracting firm already spending about $3,000 a month on ads and closing nothing. The fix was everything after the ad.",
    ar: "شركة مقاولات كانت تصرف تقريباً ٣ آلاف دولار بالشهر على الإعلانات وما تقفل شي.. والحل كان بكل اللي بعد الإعلان.",
  },
};

export const GOOGLE = {
  rating: 4.7,
  reviews: 15,
  checked: "27 September 2026",
  url: "https://share.google/xP0WptqrUWtKGAubo",
};

/** The approved figure for how many firms Mahara has worked with (Aziz, 2026-09-02). */
export const FIRMS = { en: "70+", ar: "٧٠+" };

// --------------------------------------------------------------- links

export const LINKS = {
  portal: "https://portal.maharamedia.com",
  portalInstall: "https://portal.maharamedia.com/install",
  content: "https://content.maharamedia.com/",
  filter: "https://funnelfilteration.maharamedia.com/",
  callcenter: "https://callcenter.maharamedia.com/",
  exampleAds: "https://funnel.maharamedia.com/example-ads",
  explainer: "https://funnel.maharamedia.com/explainer-doc",
  proof: "https://maharamedia.com/ar/proof-page",
  compare: "https://maharamedia.com/ar/compare",
  calculator: "https://calculator.maharamedia.com/",
  landing: "https://diwan-landing-two.vercel.app/",
  academy: "https://www.skool.com/premium-projects-academy-3669/classroom",
  site: "https://maharamedia.com",
};

/** The three example ads on Wistia (vertical). */
export const EXAMPLE_ADS: { wistia: string; label: L; seconds: number }[] = [
  {
    wistia: "pjtnaibp09",
    label: { en: "On site, construction", ar: "بالموقع، مقاولات" },
    seconds: 79,
  },
  {
    wistia: "yekbq0lbaf",
    label: { en: "Walk-through, interior design", ar: "جولة، تصميم داخلي" },
    seconds: 39,
  },
  {
    wistia: "wotepibqu6",
    label: {
      en: "Owner on camera, design and build",
      ar: "صاحب الشركة يتكلم، تصميم وتنفيذ",
    },
    seconds: 59,
  },
];

// --------------------------------------------------------------- numbers

/**
 * What every client campaign averaged from 1 to 27 September 2026 (the CEO
 * cockpit's delivery numbers: $9,459 spent, 674 leads, 126 booked
 * appointments). The calculator uses these, and says so.
 */
export const CAMPAIGNS = {
  perLead: 14,
  perBooking: 75,
  window: {
    en: "every client campaign, 1 to 27 September 2026",
    ar: "كل حملات عملائنا، من ١ لـ٢٧ سبتمبر ٢٠٢٦",
  },
};

export const PROGRAM = {
  usd: 6000,
  days: 90,
  deposit: 500,
  adsPerDay: [30, 50] as const,
  name: { en: "Premium Projects Program", ar: "برنامج المشاريع المميزة" },
  guaranteeLabel: {
    en: "7-day satisfaction guarantee",
    ar: "ضمان الرضا ٧ أيام",
  },
  guarantee: {
    en: "If you're unhappy with the process for any reason within 7 days of paying in full, tell us and we refund your program fee in full, once your onboarding is done.",
    ar: "إذا خلال ٧ أيام من يوم تدفع المبلغ كامل ما كنت راضي عن طريقة الشغل لأي سبب.. تقولنا ونرجع لك رسوم البرنامج كاملة، بعد ما تخلص الأونبوردنق.",
  },
};

// ------------------------------------------------------------------ FAQ

export interface Faq {
  q: L;
  a: L;
}

export const FAQS: Record<PillarKey, Faq[]> = {
  ads: [
    {
      q: {
        en: "How much do we need to spend on ads?",
        ar: "جم لازم نصرف على الإعلانات؟",
      },
      a: {
        en: "Most partners start at $30 to $50 a day. It goes straight to Instagram, Snapchat, TikTok or Google. We never touch it.",
        ar: "أغلب شركائنا يبدون من ٣٠ لـ٥٠ دولار باليوم. تروح مباشرة لإنستقرام أو سناب أو تيك توك أو قوقل.. واحنا ما نلمسها.",
      },
    },
    {
      q: {
        en: "What kind of ads do you make?",
        ar: "شنو نوع الإعلانات اللي تسوونها؟",
      },
      a: {
        en: "Short videos made for your company: we write the script, guide the shoot and edit it, using your real projects.",
        ar: "فيديوهات قصيرة مخصصة لشركتك: نكتب السكربت، نوجهك بالتصوير، ونسوي المونتاج.. من مشاريعك الحقيقية.",
      },
    },
    {
      q: { en: "How long until we see results?", ar: "متى نشوف نتايج؟" },
      a: {
        en: "Leads within 7 to 10 days of launch. The first qualified appointments usually land in weeks 2 to 3.",
        ar: "الليدز خلال ٧ لـ١٠ أيام من الإطلاق.. وأول مواعيد مؤهلة عادةً بالأسبوع الثاني أو الثالث.",
      },
    },
    {
      q: { en: "Which platforms?", ar: "أي منصات؟" },
      a: {
        en: "Instagram, Snapchat, TikTok and Google. We pick the mix by your service and your market.",
        ar: "إنستقرام، سناب، تيك توك، وقوقل. نختار الخلطة حسب خدمتك وسوقك.",
      },
    },
  ],
  filter: [
    {
      q: {
        en: "What happens when someone clicks our ad?",
        ar: "شنو يصير لمن أحد يضغط على الإعلان؟",
      },
      a: {
        en: "They land on a page built around your work, fill in a short qualification form, and our team calls them within five minutes.",
        ar: "يدخل لاندنق بيج مبنية على شغلك، يعبي فورم قصير، وفريقنا يكلمه خلال ٥ دقايق.",
      },
    },
    {
      q: { en: "Do leads book themselves?", ar: "الليدز يحجزون بروحهم؟" },
      a: {
        en: "No. Our team calls them, qualifies them and tells them about your company first. Only the serious ones reach your calendar.",
        ar: "لا. فريقنا يكلمهم، يفلترهم، ويعرفهم على شركتك أول.. واللي جادين بس يوصلون لجدولك.",
      },
    },
    {
      q: {
        en: "What if the leads are not serious?",
        ar: "وإذا الليدز مو جادين؟",
      },
      a: {
        en: "That is what the three layers are for: the targeting, the form and the call. By the time you meet someone, they are vetted.",
        ar: "هذا شغل الثلاث طبقات: الاستهداف، الفورم، والمكالمة. لمن تقابل أحد.. يكون أصلاً متفلتر.",
      },
    },
  ],
  sales: [
    {
      q: { en: "Who calls our leads?", ar: "منو يكلم الليدز مالنا؟" },
      a: {
        en: "Our Arabic-speaking calling team, trained on construction and design projects.",
        ar: "فريق الاتصال مالنا، يتكلم عربي ومدرب على مشاريع المقاولات والتصميم.",
      },
    },
    {
      q: { en: "How do they know our company?", ar: "شلون يعرفون شركتنا؟" },
      a: {
        en: "We brief them on your services, your projects and your price range. They represent you on every call.",
        ar: "نعطيهم ملف عن خدماتك ومشاريعك ورينج أسعارك.. ويمثلونك بكل مكالمة.",
      },
    },
    {
      q: { en: "Can we listen to the calls?", ar: "نقدر نسمع المكالمات؟" },
      a: {
        en: "Yes. Every call is recorded, and you can hear it in your portal.",
        ar: "إي. كل مكالمة مسجلة، وتقدر تسمعها ببوابتك.",
      },
    },
  ],
  closing: [
    {
      q: { en: "I already know how to sell.", ar: "أنا أصلاً أعرف أبيع." },
      a: {
        en: "Good. This sharpens it: prospects arrive qualified and informed, and we review your real calls to find what loses deals.",
        ar: "زين. هذا يخليك أقوى: العميل ييك متفلتر وفاهم، واحنا نراجع مكالماتك الحقيقية ونطلع وين تضيع الصفقات.",
      },
    },
    {
      q: { en: "Who teaches it?", ar: "منو يدرّب؟" },
      a: {
        en: "Our team, through the Premium Projects Academy and a weekly consulting call on your actual deals.",
        ar: "فريقنا.. من خلال أكاديمية المشاريع المميزة، ومكالمة استشارة أسبوعية على صفقاتك الحقيقية.",
      },
    },
  ],
  data: [
    {
      q: { en: "What do we see?", ar: "شنو نشوف؟" },
      a: {
        en: "Leads, appointments, calls, costs and results, live, in your own portal on your laptop or phone.",
        ar: "الليدز، المواعيد، المكالمات، التكاليف، والنتايج.. مباشرة، ببوابتك على اللابتوب أو التلفون.",
      },
    },
    {
      q: { en: "What if we stop?", ar: "وإذا وقفنا؟" },
      a: {
        en: "You keep what we built: the landing pages, the CRM and the data.",
        ar: "اللي بنيناه يبقى لك: اللاندنق بيجز، الـCRM، والداتا.",
      },
    },
  ],
};

// ------------------------------------------------------ what you get

export const INCLUDED: L[] = [
  {
    en: "Targeted ads on Instagram, Snapchat, TikTok and Google",
    ar: "إعلانات مستهدفة على إنستقرام وسناب وتيك توك وقوقل",
  },
  {
    en: "Ad videos scripted and produced for your company",
    ar: "فيديوهات إعلانية نكتبها وننتجها لشركتك",
  },
  {
    en: "Landing pages and qualification forms",
    ar: "لاندنق بيجز وفورم فلترة",
  },
  {
    en: "A dedicated Arabic-speaking calling team",
    ar: "فريق اتصال مخصص يتكلم عربي",
  },
  {
    en: "Every lead called within five minutes, and followed up",
    ar: "كل ليد نكلمه خلال ٥ دقايق.. ونتابعه",
  },
  {
    en: "Qualified appointments booked on your calendar",
    ar: "مواعيد مؤهلة محجوزة بجدولك",
  },
  {
    en: "No-shows and undecided prospects followed up",
    ar: "متابعة اللي ما حضروا واللي ما قرروا",
  },
  {
    en: "Sales training and a weekly consulting call",
    ar: "تدريب مبيعات ومكالمة استشارة أسبوعية",
  },
  {
    en: "Mahara OS, your portal, on laptop and phone",
    ar: "Mahara OS.. بوابتك، على اللابتوب والتلفون",
  },
  {
    en: "A monthly review and a plan to scale",
    ar: "مراجعة شهرية وخطة للتوسع",
  },
];

export const TIMELINE: { when: L; what: L }[] = [
  {
    when: { en: "Days 1 to 7", ar: "أول ٧ أيام" },
    what: {
      en: "Onboarding, the kickoff call, your ads and pages built.",
      ar: "التسجيل، مكالمة البداية، ونبني إعلاناتك وصفحاتك.",
    },
  },
  {
    when: { en: "Month 1", ar: "الشهر الأول" },
    what: {
      en: "Launch. Leads in 7 to 10 days, first qualified appointments in weeks 2 to 3.",
      ar: "الإطلاق. ليدز خلال ٧ لـ١٠ أيام، وأول مواعيد مؤهلة بالأسبوع الثاني أو الثالث.",
    },
  },
  {
    when: { en: "Month 2", ar: "الشهر الثاني" },
    what: {
      en: "The platforms learn who your client is. Cost per lead usually comes down, and show-up goes up.",
      ar: "المنصات تتعلم منو عميلك. وعادةً تكلفة الليد تنزل، والحضور يرتفع.",
    },
  },
  {
    when: { en: "Month 3", ar: "الشهر الثالث" },
    what: {
      en: "Scale what works, with the numbers to prove it.",
      ar: "نكبّر اللي يشتغل.. بالأرقام اللي تثبته.",
    },
  },
];

/** The milestones every partner's portal tracks (Mahara OS "Your journey"). */
export const MILESTONES: L[] = [
  { en: "Launch", ar: "الإطلاق" },
  { en: "First booking", ar: "أول موعد" },
  { en: "First attended appointment", ar: "أول عميل حضر" },
  { en: "First won project", ar: "أول مشروع موقّع" },
];

export const NEXT_STEPS: L[] = [
  {
    en: "The $500 deposit locks your spot and your market.",
    ar: "العربون ٥٠٠ دولار يحجز مكانك وسوقك.",
  },
  {
    en: "The onboarding form arrives on WhatsApp.",
    ar: "استمارة التسجيل توصلك على الواتساب.",
  },
  { en: "We book the kickoff call today.", ar: "نحجز مكالمة البداية اليوم." },
  {
    en: "Your campaign goes live within 7 days.",
    ar: "حملتك تنطلق خلال ٧ أيام.",
  },
];

export const TRADES: L[] = [
  { en: "Interior design", ar: "تصميم داخلي" },
  { en: "General contracting", ar: "مقاولات عامة" },
  { en: "Design and build", ar: "تصميم وتنفيذ" },
  { en: "Fit-out and finishing", ar: "تشطيبات وفت آوت" },
  { en: "Architecture", ar: "هندسة معمارية" },
  { en: "Engineering consultancy", ar: "استشارات هندسية" },
  { en: "MEP", ar: "أعمال كهروميكانيكية" },
  { en: "Landscaping", ar: "لاندسكيب" },
  { en: "Aluminium and glass", ar: "ألمنيوم وزجاج" },
];

// -------------------------------------------------- platform recommender

export type Platform = "instagram" | "snapchat" | "tiktok" | "google";

export const PLATFORM_NAMES: Record<Platform, L> = {
  instagram: { en: "Instagram", ar: "إنستقرام" },
  snapchat: { en: "Snapchat", ar: "سناب شات" },
  tiktok: { en: "TikTok", ar: "تيك توك" },
  google: { en: "Google", ar: "قوقل" },
};

export const SERVICES: { key: string; label: L; base: Platform[] }[] = [
  {
    key: "interior",
    label: { en: "Interior design", ar: "تصميم داخلي" },
    base: ["instagram", "tiktok", "snapchat"],
  },
  {
    key: "construction",
    label: { en: "Construction", ar: "مقاولات" },
    base: ["google", "instagram", "snapchat"],
  },
  {
    key: "fitout",
    label: { en: "Fit-out and renovation", ar: "تشطيب وترميم" },
    base: ["instagram", "tiktok", "google"],
  },
  {
    key: "engineering",
    label: { en: "Engineering consultancy", ar: "استشارات هندسية" },
    base: ["google", "instagram"],
  },
  {
    key: "architecture",
    label: { en: "Architecture", ar: "هندسة معمارية" },
    base: ["instagram", "google"],
  },
  {
    key: "landscaping",
    label: { en: "Landscaping", ar: "لاندسكيب" },
    base: ["instagram", "snapchat", "google"],
  },
];

/** A market's lean, from the July deck brief: Snapchat in Kuwait and Bahrain, TikTok in Saudi, Instagram in the UAE. */
export const MARKET_LEAN: Record<string, Platform | null> = {
  KW: "snapchat",
  BH: "snapchat",
  SA: "tiktok",
  AE: "instagram",
  QA: null,
  OM: null,
};

export const MARKETS: { code: string; label: L }[] = [
  { code: "KW", label: COUNTRIES[0] },
  { code: "SA", label: COUNTRIES[1] },
  { code: "AE", label: COUNTRIES[2] },
  { code: "QA", label: COUNTRIES[3] },
  { code: "BH", label: COUNTRIES[4] },
  { code: "OM", label: COUNTRIES[5] },
];

/** The platforms to run for a trade in a market, the first the main one. */
export function recommend(service: string, market: string): Platform[] {
  const s = SERVICES.find(x => x.key === service) ?? SERVICES[0];
  const order = [...s.base];
  const lean = MARKET_LEAN[market] ?? null;
  if (lean) {
    const i = order.indexOf(lean);
    if (i === -1) order.splice(1, 0, lean);
    else if (i > 1) {
      order.splice(i, 1);
      order.splice(1, 0, lean);
    }
  }
  return order.slice(0, 3);
}
