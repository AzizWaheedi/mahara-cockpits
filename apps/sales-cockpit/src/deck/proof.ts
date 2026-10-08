import adsAccount from "./assets/proof/ads-account.webp";
import adsBrief from "./assets/proof/ads-brief.webp";
import adsDetailed from "./assets/proof/ads-detailed.webp";
import adsDna from "./assets/proof/ads-dna.webp";
import adsIncome from "./assets/proof/ads-income.webp";
import adsMap from "./assets/proof/ads-map.webp";
import adsTwentyOff from "./assets/proof/ads-twenty-off.webp";
import adsTwentyOn from "./assets/proof/ads-twenty-on.webp";
import ccAttended from "./assets/proof/cc-attended.webp";
import ccCourse from "./assets/proof/cc-course.webp";
import ccCrm from "./assets/proof/cc-crm.webp";
import ccDialer from "./assets/proof/cc-dialer.webp";
import ccKb from "./assets/proof/cc-kb.webp";
import ccNoshow from "./assets/proof/cc-noshow.webp";
import ccScript1 from "./assets/proof/cc-script-1.webp";
import ccScript2 from "./assets/proof/cc-script-2.webp";
import ccScript3 from "./assets/proof/cc-script-3.webp";
import ccTraining from "./assets/proof/cc-training.webp";
import flagAe from "./assets/proof/flag-ae.svg";
import flagBh from "./assets/proof/flag-bh.svg";
import flagKw from "./assets/proof/flag-kw.svg";
import flagQa from "./assets/proof/flag-qa.svg";
import flagSa from "./assets/proof/flag-sa.svg";
import jrBooked from "./assets/proof/jr-booked.webp";
import jrConfirm from "./assets/proof/jr-confirm.webp";
import jrForm1 from "./assets/proof/jr-form-1.webp";
import jrForm2 from "./assets/proof/jr-form-2.webp";
import jrForm3 from "./assets/proof/jr-form-3.webp";
import jrLanding from "./assets/proof/jr-landing.webp";
import jrLandingPhone from "./assets/proof/jr-landing-phone.webp";
import jrSlack from "./assets/proof/jr-slack.webp";
import jrThanksPhone from "./assets/proof/jr-thanks-phone.webp";
import logoAive from "./assets/proof/logo-aive.webp";
import logoAmheco from "./assets/proof/logo-amheco.webp";
import logoArcwani from "./assets/proof/logo-arcwani.webp";
import logoBayt22 from "./assets/proof/logo-bayt22.webp";
import logoCatech from "./assets/proof/logo-catech.webp";
import logoElite from "./assets/proof/logo-elite.webp";
import logoInverse from "./assets/proof/logo-inverse.webp";
import logoJoesera from "./assets/proof/logo-joesera.webp";
import logoKesan from "./assets/proof/logo-kesan.webp";
import logoLifedepth from "./assets/proof/logo-lifedepth.webp";
import logoMassdesign from "./assets/proof/logo-massdesign.webp";
import logoMofage from "./assets/proof/logo-mofage.webp";
import logoOlivar from "./assets/proof/logo-olivar.webp";
import logoPg from "./assets/proof/logo-pg.webp";
import logoPhoenix from "./assets/proof/logo-phoenix.webp";
import logoPidco from "./assets/proof/logo-pidco.webp";
import logoRm from "./assets/proof/logo-rm.webp";
import logoSafad from "./assets/proof/logo-safad.webp";
import logoTheline from "./assets/proof/logo-theline.webp";
import pcmAcademy from "./assets/proof/pcm-academy.webp";
import pcmCall from "./assets/proof/pcm-call.webp";
import pcmLesson from "./assets/proof/pcm-lesson.webp";
import pcmSheet from "./assets/proof/pcm-sheet.webp";
import profileInstagram from "./assets/proof/profile-instagram.webp";
import profileYoutube from "./assets/proof/profile-youtube.webp";
import rvA1 from "./assets/proof/rv-a1.webp";
import rvA2 from "./assets/proof/rv-a2.webp";
import rvA3 from "./assets/proof/rv-a3.webp";
import rvA4 from "./assets/proof/rv-a4.webp";
import rvB1 from "./assets/proof/rv-b1.webp";
import rvB2 from "./assets/proof/rv-b2.webp";
import rvB3 from "./assets/proof/rv-b3.webp";
import rvB4 from "./assets/proof/rv-b4.webp";
import rvC1 from "./assets/proof/rv-c1.webp";
import rvC2 from "./assets/proof/rv-c2.webp";
import rvC3 from "./assets/proof/rv-c3.webp";
import rvC4 from "./assets/proof/rv-c4.webp";
import { type L, LINKS, type Story } from "./content";

/**
 * The proof the deck shows, and the step-by-step tours of the system (Aziz,
 * 2026-10-07: "I like screenshots that are real because I like to show, not
 * tell").
 *
 * Every picture here is real and has a source:
 * - logos, countries and case studies: maharamedia.com/proof-page and its
 *   ten case-study pages;
 * - Google reviews: screenshots from Aziz's original Pitch deck and from the
 *   proof page's live Google widget (Google showed 4.7 from 15 reviews);
 * - the journey, the call center and the ads: the pictures published on
 *   funnelfilteration, callcenter and content.maharamedia.com, and the
 *   original deck's screenshots. A lead's name, email, phone and contact
 *   link are blurred wherever one appeared.
 * Numbers follow mahara-context's approved list: 70+ firms, $1.32M+ of ad
 * spend in this industry; the retired revenue total is not used.
 */

export interface Flag {
  src: string;
  name: L;
}

const FLAG = {
  kw: { src: flagKw, name: { en: "Kuwait", ar: "الكويت" } },
  sa: { src: flagSa, name: { en: "Saudi Arabia", ar: "السعودية" } },
  ae: { src: flagAe, name: { en: "UAE", ar: "الإمارات" } },
  bh: { src: flagBh, name: { en: "Bahrain", ar: "البحرين" } },
  qa: { src: flagQa, name: { en: "Qatar", ar: "قطر" } },
} satisfies Record<string, Flag>;

export interface Metric {
  value: L;
  label: L;
}

/** What the proof page adds to each partner's story. */
export interface StoryProof {
  logo?: string;
  flags: Flag[];
  place: L;
  /** The case study's slug on maharamedia.com/{en|ar}/proof-page/. */
  slug: string;
  head: L;
  metrics: Metric[];
}

export const caseUrl = (slug: string, lang: "en" | "ar") =>
  `https://maharamedia.com/${lang}/proof-page/${slug}`;

export const STORY_PROOF: Record<string, StoryProof> = {
  "story-bayt22": {
    logo: logoBayt22,
    flags: [FLAG.kw, FLAG.ae],
    place: { en: "Kuwait and the UAE", ar: "الكويت والإمارات" },
    slug: "bayt-22",
    head: {
      en: "Revenue up 3 to 4 times, then they asked us to slow down.",
      ar: "دخلهم زاد ٣ لـ٤ أضعاف.. وطلبوا منا نهدّي.",
    },
    metrics: [
      {
        value: { en: "3 to 4x", ar: "٣ لـ٤ أضعاف" },
        label: { en: "revenue", ar: "بالدخل" },
      },
      {
        value: { en: "2", ar: "٢" },
        label: { en: "markets served", ar: "سوق يخدمونه" },
      },
    ],
  },
  "story-phoenix": {
    logo: logoPhoenix,
    flags: [FLAG.kw],
    place: { en: "Kuwait", ar: "الكويت" },
    slug: "phoenix-united",
    head: {
      en: "$2M in new projects, closed from our pipeline.",
      ar: "٢ مليون دولار مشاريع يديدة.. انقفلت من الليدز اللي يبناها.",
    },
    metrics: [
      {
        value: { en: "$2M", ar: "٢ مليون دولار" },
        label: { en: "in closed projects", ar: "مشاريع انقفلت" },
      },
    ],
  },
  "story-safad": {
    logo: logoSafad,
    flags: [FLAG.sa],
    place: { en: "Jeddah, Saudi Arabia", ar: "جدة، السعودية" },
    slug: "safad",
    head: {
      en: "A 5,000 m² developer project, at about $400 a client.",
      ar: "مشروع مطوّر عقاري ٥٬٠٠٠ م².. بتكلفة تقريباً ٤٠٠ دولار للعميل.",
    },
    metrics: [
      {
        value: { en: "5,000 m²", ar: "٥٬٠٠٠ م²" },
        label: { en: "developer project", ar: "مشروع مطوّر عقاري" },
      },
      {
        value: { en: "~$400", ar: "٤٠٠ دولار" },
        label: { en: "cost per client", ar: "تكلفة العميل تقريباً" },
      },
    ],
  },
  "story-joesera": {
    logo: logoJoesera,
    flags: [FLAG.sa],
    place: { en: "Riyadh, Saudi Arabia", ar: "الرياض، السعودية" },
    slug: "joe-and-sera",
    head: {
      en: "From marketing skeptic to a $12.4M-a-year design business.",
      ar: "ما كان مقتنع بالتسويق.. والحين شركته ماشية على ١٢٫٤ مليون دولار بالسنة.",
    },
    metrics: [
      {
        value: { en: "$12.4M", ar: "١٢٫٤ مليون دولار" },
        label: { en: "a year", ar: "بالسنة" },
      },
      {
        value: { en: "20", ar: "٢٠" },
        label: { en: "new hires since starting", ar: "موظف يديد من بدينا" },
      },
    ],
  },
  "story-grandiocity": {
    flags: [FLAG.bh],
    place: { en: "Bahrain", ar: "البحرين" },
    slug: "grandiocity",
    head: {
      en: "Quarterly revenue doubled, from $400K to $800K.",
      ar: "دخلهم كل ربع سنة تضاعف.. من ٤٠٠ ألف لـ٨٠٠ ألف دولار.",
    },
    metrics: [
      {
        value: { en: "2x", ar: "الضعف" },
        label: { en: "quarterly revenue", ar: "الدخل كل ربع سنة" },
      },
      {
        value: { en: "$800K", ar: "٨٠٠ ألف دولار" },
        label: { en: "a quarter, and growing", ar: "كل ربع سنة.. ويزيد" },
      },
    ],
  },
  "story-laststep": {
    flags: [FLAG.ae],
    place: { en: "Dubai and Abu Dhabi, UAE", ar: "دبي وأبوظبي، الإمارات" },
    slug: "the-last-step",
    head: {
      en: "From a solo designer to leading a full team.",
      ar: "كانت مصممة بروحها.. والحين تقود فريق كامل.",
    },
    metrics: [
      {
        value: { en: "1 → team", ar: "من ١ لفريق" },
        label: { en: "solo to a full team", ar: "من بروحها لفريق كامل" },
      },
    ],
  },
  "story-lifedepth": {
    logo: logoLifedepth,
    flags: [FLAG.sa],
    place: { en: "Riyadh, Saudi Arabia", ar: "الرياض، السعودية" },
    slug: "life-depth",
    head: {
      en: "A brand-new firm closed 3 projects in its first two weeks.",
      ar: "شركة توها بادية.. وقفلت ٣ مشاريع بأول أسبوعين.",
    },
    metrics: [
      {
        value: { en: "3", ar: "٣" },
        label: { en: "projects in 2 weeks", ar: "مشاريع بأسبوعين" },
      },
      {
        value: { en: "0", ar: "ولا عميل" },
        label: { en: "clients at the start", ar: "بالبداية" },
      },
    ],
  },
  "story-amheco": {
    logo: logoAmheco,
    flags: [FLAG.sa],
    place: { en: "Al-Qassim, Saudi Arabia", ar: "القصيم، السعودية" },
    slug: "amheco",
    head: {
      en: "A steady $300K a month in design and supervision work.",
      ar: "٣٠٠ ألف دولار بالشهر.. ثابتة، من التصميم والإشراف.",
    },
    metrics: [
      {
        value: { en: "$300K", ar: "٣٠٠ ألف دولار" },
        label: { en: "a month, steady", ar: "بالشهر، ثابتة" },
      },
    ],
  },
  "story-massdesign": {
    logo: logoMassdesign,
    flags: [FLAG.sa],
    place: { en: "Riyadh, Saudi Arabia", ar: "الرياض، السعودية" },
    slug: "mass-design",
    head: {
      en: "A three-year goal, reached in one year.",
      ar: "هدف ٣ سنين.. وصلوا له بسنة وحدة.",
    },
    metrics: [
      {
        value: { en: "2x", ar: "الضعف" },
        label: { en: "growth", ar: "بالنمو" },
      },
      {
        value: { en: "1 year", ar: "سنة وحدة" },
        label: { en: "for a 3-year goal", ar: "بدال ٣ سنين" },
      },
    ],
  },
  "story-kesan": {
    logo: logoKesan,
    flags: [FLAG.sa, FLAG.qa],
    place: { en: "Riyadh and Doha", ar: "الرياض والدوحة" },
    slug: "kesan",
    head: {
      en: "More than ten agencies failed him. With us, not one video was redone.",
      ar: "أكثر من ١٠ وكالات خذلوه.. ومعانا ولا فيديو انعاد.",
    },
    metrics: [
      {
        value: { en: "10+", ar: "+١٠" },
        label: { en: "agencies before us", ar: "وكالات جرّبها قبلنا" },
      },
      {
        value: { en: "0", ar: "ولا فيديو" },
        label: { en: "videos redone", ar: "انعاد" },
      },
    ],
  },
};

/** The two partners on the proof page that the deck did not have yet. */
export const MORE_STORIES: Story[] = [
  {
    id: "story-massdesign",
    wistia: "entuml38ni",
    ratio: 16 / 9,
    seconds: 75,
    who: { en: "Qusai", ar: "قصي" },
    company: { en: "Mass Design", ar: "Mass Design" },
    trade: { en: "Engineering consultancy", ar: "استشارات هندسية" },
    result: {
      en: "Happy with the appointments and the clients. It saves us effort and time.",
      ar: "مرتاحين من المواعيد ومن نوعية العملاء.. ويوفر علينا جهد ووقت.",
    },
    why: {
      en: "The quality of the clients, in the owner's own words.",
      ar: "نوعية العملاء.. بكلام صاحب الشركة نفسه.",
    },
  },
  {
    id: "story-kesan",
    wistia: "elepqr6ktp",
    ratio: 640 / 466,
    seconds: 83,
    who: { en: "Eng. Ahmed", ar: "م. أحمد" },
    company: {
      en: "Kesan Consultant Engineering",
      ar: "كيسان للاستشارات الهندسية",
    },
    trade: { en: "Engineering consultancy", ar: "استشارات هندسية" },
    result: {
      en: "A truly professional level. We haven't changed a single video.",
      ar: "شغل احترافي.. وما عدّلنا ولا فيديو.",
    },
    why: {
      en: "He had tried more than ten agencies before us.",
      ar: "جرّب أكثر من ١٠ وكالات قبلنا.",
    },
  },
];

// --------------------------------------------------------------- reviews

export interface Review {
  src: string;
  who: string;
  r: number;
  w: number;
  /** A line from the review, set large beside a card too small to read. */
  quote?: string;
}

/**
 * Twelve real Google reviews, four to a page: Google's dark cards first,
 * then the proof page's white ones, so each page reads as one set. Two
 * reviewers left stars and no words; they close the last page.
 */
export const REVIEW_PAGES: Review[][] = [
  [
    {
      src: rvA1,
      who: "Nawaf Al-Bash",
      r: 1.174,
      w: 1290,
      quote:
        "The campaign brought in a huge number of leads … I actually had to ask them to pause it because my team couldn't keep up.",
    },
    { src: rvA2, who: "Eng-Bader Al Abdly", r: 2.494, w: 990 },
    { src: rvA3, who: "Abdullah Alhussaini", r: 3.402, w: 1058 },
    { src: rvA4, who: "Haneen Homidan", r: 2.197, w: 960 },
  ],
  [
    { src: rvC1, who: "fay almatouq", r: 2.153, w: 956 },
    { src: rvC2, who: "Athbi Alzufairi", r: 2.153, w: 956 },
    { src: rvC3, who: "Abdullah Alfayyadh", r: 2.716, w: 956 },
    { src: rvB4, who: "Qusai Hijazi", r: 2.402, w: 956 },
  ],
  [
    { src: rvB2, who: "Ahmed Ah", r: 3.767, w: 1130 },
    { src: rvC4, who: "SS", r: 2.402, w: 956 },
    { src: rvB1, who: "Ali Alshammeri", r: 3.126, w: 1019 },
    { src: rvB3, who: "Abdullah Al-aidarous", r: 2.859, w: 972 },
  ],
];

// ---------------------------------------------------------- the logo wall

/**
 * Every partner's logo, as maharamedia.com/proof-page shows it on its dark
 * ground: trimmed to the mark and kept at the page's full size (2026-10-08).
 * Sources, all under https://maharamedia.com/brand/:
 *   logos-display/01_BAYT-22.png, 02_SAFAD.png, 03_The-Line.png,
 *   04_Inverse-Group.png, 05_PG.png, 06_Al-Husseini-Engineering.png (AMHECO),
 *   07_Elite-Excellence.png, 08_PIDCO-Group.png, 09_Joe-Sera.png;
 *   logos-funnel/AIVE.png, ARCWANI-Architects.png, CAtech.png, MOFAGE.png,
 *   Olivar-Design.png, RM-Architectural-Contracting.png;
 *   logos-clients/kesan.png, life-depth.png, mass-design.png,
 *   phoenix-united.png.
 * The four from logos-clients are the page's own small cut-outs (under 220
 * px); a sharper file has to come from the partner.
 */
export const LOGO_WALL: { src: string; name: string }[] = [
  { src: logoBayt22, name: "BAYT 22" },
  { src: logoSafad, name: "SAFAD" },
  { src: logoJoesera, name: "Joe & Sera" },
  { src: logoAmheco, name: "AMHECO" },
  { src: logoPhoenix, name: "Phoenix United" },
  { src: logoPg, name: "PG" },
  { src: logoMassdesign, name: "Mass Design" },
  { src: logoKesan, name: "Kesan" },
  { src: logoLifedepth, name: "Life Depth" },
  { src: logoInverse, name: "Inverse Group" },
  { src: logoTheline, name: "The Line" },
  { src: logoElite, name: "Elite Excellence" },
  { src: logoPidco, name: "PIDCO Group" },
  { src: logoArcwani, name: "ARCWANI Architects" },
  { src: logoOlivar, name: "Olivar Design" },
  { src: logoCatech, name: "CAtech" },
  { src: logoAive, name: "AIVE" },
  { src: logoRm, name: "RM Architectural Contracting" },
  { src: logoMofage, name: "MOFAGE" },
];

/** The #1 page's numbers: the approved figures only. */
export const NUMBER_ONE: Metric[] = [
  {
    value: { en: "70+", ar: "+٧٠" },
    label: { en: "firms across the Gulf", ar: "شركة بالخليج" },
  },
  {
    value: { en: "5", ar: "٥" },
    label: {
      en: "countries: Kuwait, Saudi, UAE, Bahrain, Qatar",
      ar: "دول: الكويت، السعودية، الإمارات، البحرين، قطر",
    },
  },
  {
    value: { en: "$1.32M+", ar: "+١٫٣٢ مليون دولار" },
    label: {
      en: "of ad spend managed in this industry alone",
      ar: "صرف إعلاني أدرناه بهالمجال بالذات",
    },
  },
  {
    value: { en: "4.7", ar: "٤٫٧" },
    label: { en: "on Google, from 15 reviews", ar: "على قوقل، من ١٥ تقييم" },
  },
];

// ----------------------------------------------------------- the content

/** Mahara's YouTube channel: the playbook, given to the whole industry. */
export const CHANNEL = "https://www.youtube.com/@MaharaMedia";

export const YOUTUBE_VIDEOS: { id: string; title: L }[] = [
  {
    id: "XJmRNf8VnBc",
    title: {
      en: "The only system you need to reach $5M in design and build",
      ar: "النظام الوحيد اللي تحتاجه توصل ٥ ملايين دولار بالمقاولات والتصميم",
    },
  },
  {
    // In place of the AI video (Aziz, 2026-10-08). The Arabic is the
    // video's own title on the channel.
    id: "ko_JcVdHl5k",
    title: {
      en: "$52M in design and build projects: the best way to win clients",
      ar: "٥٢ مليون دولار مشاريع مقاولات وتصميم… هذي احسن طريقة تجيب عملاء",
    },
  },
  {
    id: "lIqvPoPK1CU",
    title: {
      en: "The mistake that bankrupts most design and build firms",
      ar: "الغلطة اللي تفلّس أغلب الشركات بالمقاولات والتصميم",
    },
  },
  {
    id: "3QcJC-JHz9k",
    title: {
      en: "How to build a firm that runs without you",
      ar: "كيف تبني شركة مقاولات أو تصميم تشتغل من دونك",
    },
  },
];

/** Mahara on Instagram (linked from the YouTube channel's description). */
export const INSTAGRAM = "https://www.instagram.com/mahara_media/";

/** Where a profile's counters sit on its screenshot, as fractions of its size. */
export interface Spot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One of our own channels, as its profile page showed it. */
export interface Profile {
  key: "youtube" | "instagram";
  href: string;
  handle: string;
  /** The profile page, with its grid of videos. */
  shot: Pic;
  /**
   * The counters' text on the screenshot (measured from the image), ringed
   * so the large figures point back to them.
   */
  spot: Spot;
  figures: { n: number; label: L }[];
  /** A fact beside the figures (Instagram's verified tick). */
  note?: L;
  open: L;
}

/**
 * Our numbers, as the two profile pages showed them on 2026-10-08 (signed
 * out, captured for the deck). They are a day's count, not a live feed:
 * when they move, take new screenshots and change both together.
 */
export const PROFILES_AS_OF: L = {
  en: "From the profile pages, 8 October 2026.",
  ar: "من صفحات الحسابات، ٨ أكتوبر ٢٠٢٦.",
};

export const PROFILES: Profile[] = [
  {
    key: "youtube",
    href: CHANNEL,
    handle: "@MaharaMedia",
    shot: {
      src: profileYoutube,
      alt: "Mahara Media on YouTube: 158 subscribers, 20 videos",
      r: 1800 / 1736,
      w: 1800,
    },
    spot: { x: 0.2906, y: 0.2339, w: 0.1522, h: 0.0092 },
    figures: [
      { n: 158, label: { en: "subscribers", ar: "مشترك" } },
      { n: 20, label: { en: "videos", ar: "فيديو" } },
    ],
    open: { en: "Open the channel", ar: "افتح القناة" },
  },
  {
    key: "instagram",
    href: INSTAGRAM,
    handle: "@mahara_media",
    shot: {
      src: profileInstagram,
      alt: "Mahara Media on Instagram: 2,855 followers, verified",
      r: 1500 / 2043,
      w: 1500,
    },
    spot: { x: 0.342, y: 0.072, w: 0.114, h: 0.0108 },
    figures: [{ n: 2855, label: { en: "followers", ar: "متابع" } }],
    note: { en: "Verified account", ar: "حساب موثّق" },
    open: { en: "Open the profile", ar: "افتح الحساب" },
  },
];

/**
 * Three reels from @mahara_media: the funnel's numbers, the filters and
 * the close. The Arabic labels are the reels' own opening lines.
 */
export const REELS: { code: string; label: L }[] = [
  {
    code: "Dc-6uzCN9xK",
    label: {
      en: "Five numbers tell the whole story",
      ar: "خمسة أرقام تقولك القصة كاملة",
    },
  },
  {
    code: "Dcd4K4gNeHF",
    label: {
      en: "Three filters before anyone reaches you",
      ar: "ثلاث فلاتر قبل ما يوصلك أي أحد",
    },
  },
  {
    code: "Db54jJitH1L",
    label: {
      en: "“Let me think about it” is rarely a decision",
      ar: "خلني أفكر.. نادراً يكون قرار",
    },
  },
];

// ------------------------------------------------------------- the tours

/** A real picture, with its width over its height so a layout can fit it. */
export interface Pic {
  src: string;
  alt: string;
  r: number;
  /** Its width in pixels: a layout never draws it larger, so it stays sharp. */
  w: number;
  /**
   * The document the picture is a page of. Set, the picture opens it, and
   * hovering shows "Open the document"; null, it is a picture only.
   */
  doc?: string | null;
}

/**
 * The documents behind the ads brief and the call scripts (Aziz, 2026-10-08:
 * "for the brand dna have a link to the doc if we hover over it and same
 * thing for the scripts"). The CEO will send the links: paste each one
 * between the quotes in place of null, e.g.
 *   export const BRAND_DNA_DOC: string | null = "https://docs.google.com/...";
 * Until then the pictures show as they are, with no link and no chip.
 * Share each document as "anyone with the link can view" first, since the
 * prospect opens it on the call.
 */
export const BRAND_DNA_DOC: string | null = null;
/** The ads' script document (the brief beside the Brand DNA). */
export const AD_SCRIPT_DOC: string | null = null;
/** The call centre's script for a partner (the three script pages). */
export const SCRIPTS_DOC: string | null = null;

/** What one step of a tour shows. */
export type Media =
  /** Screenshots laid out to fill the stage; a fan for a stack of documents. */
  | { kind: "shots"; items: Pic[]; fan?: boolean }
  /** Phone screens, side by side. */
  | { kind: "phones"; items: Pic[] }
  /**
   * The same page in a browser and on a phone. With `live`, a click opens
   * the real page in a pop-up, the pictures standing in until it loads.
   */
  | { kind: "devices"; desktop: Pic; phone: Pic; live?: string }
  | { kind: "reels"; ids: { id: string; label: L }[]; marks?: boolean }
  /** A video, with a phone beside it (a page, or a WhatsApp message). */
  | {
      kind: "video";
      id: string;
      title: string;
      beside?: Pic & { chat?: boolean };
    }
  | { kind: "stages"; items: L[] }
  | {
      kind: "call";
      id: string;
      said: L;
      replied: L;
    }
  | { kind: "picker" }
  | { kind: "youtube"; items: { id: string; title: L }[] }
  | { kind: "instagram"; items: { code: string; label: L }[] };

export interface Stop {
  key: string;
  name: L;
  /** The name on the journey's path, where five names share one line. */
  short?: L;
  what: L;
  why: L;
  media: Media;
  /** A link under the media, to see more. */
  more?: { href: string; label: L };
}

export const ADS_TOUR: Stop[] = [
  {
    key: "targeting",
    name: {
      en: "Targeting engineered by AI",
      ar: "استهداف يبنيه الذكاء الاصطناعي",
    },
    what: {
      en: "Only owners with the right area, income and interests for a real project.",
      ar: "بس أصحاب المشاريع: المنطقة الصح، الدخل الصح، والاهتمامات الصح.",
    },
    why: {
      en: "Your budget never pays for someone who can't buy.",
      ar: "ميزانيتك ما تروح على واحد ما يقدر يشتري.",
    },
    media: {
      kind: "shots",
      items: [
        {
          src: adsMap,
          alt: "Location targeting around Riyadh",
          r: 1.856,
          w: 1145,
        },
        {
          src: adsDetailed,
          alt: "Detailed targeting: property, architecture, interior design",
          r: 1.416,
          w: 1154,
        },
        {
          src: adsIncome,
          alt: "Targeting by estimated yearly income",
          r: 3.318,
          w: 909,
        },
      ],
    },
  },
  {
    key: "platforms",
    name: {
      en: "Real ads for every platform",
      ar: "إعلانات حقيقية لكل منصة",
    },
    what: {
      en: "Your projects and your face, cut for Instagram, TikTok, Snapchat and Google.",
      ar: "مشاريعك ووجهك انت.. بإعلانات مفصّلة لإنستقرام، تيك توك، سناب، وقوقل.",
    },
    why: {
      en: "Owners stop for real work. Never for stock footage.",
      ar: "صاحب المشروع يوقف عند شغل حقيقي.. مو لقطات ستوك.",
    },
    media: {
      kind: "reels",
      marks: true,
      ids: [
        {
          id: "u7kr5lq20n",
          label: { en: "Owner on camera", ar: "صاحب الشركة يتكلم" },
        },
        {
          id: "8e7meenn3r",
          label: { en: "Design render film", ar: "فيلم رندر للتصميم" },
        },
        { id: "6mm35rnj21", label: { en: "Project story", ar: "قصة مشروع" } },
      ],
    },
  },
  {
    key: "market",
    name: {
      en: "The platforms for your market",
      ar: "المنصات اللي تناسب سوقك",
    },
    what: {
      en: "We pick the platforms by your country and your service.",
      ar: "نختار المنصات حسب ديرتك وخدمتك.",
    },
    why: {
      en: "Your buyers are on different apps in Riyadh and in Kuwait.",
      ar: "عميلك بالرياض غير عميلك بالكويت.. وكل واحد على تطبيق.",
    },
    media: { kind: "picker" },
  },
  {
    key: "portfolio",
    name: {
      en: "A format for every service",
      ar: "صيغة لكل خدمة",
    },
    what: {
      en: "Cinematic brand films, kitchens and bathrooms, renovations, commercial projects.",
      ar: "أفلام سينمائية للماركة، مطابخ وحمامات، ترميم، ومشاريع تجارية.",
    },
    why: {
      en: "Each service gets the ad its buyer responds to.",
      ar: "كل خدمة لها الإعلان اللي يحرك عميلها.",
    },
    media: {
      kind: "reels",
      ids: [
        {
          id: "0qqlniv6az",
          label: { en: "Cinematic brand film", ar: "فيلم سينمائي" },
        },
        {
          id: "7xdxqspki8",
          label: { en: "Kitchen and bath", ar: "مطابخ وحمامات" },
        },
        { id: "00cmv2nryq", label: { en: "Renovation", ar: "ترميم" } },
        {
          id: "yqpf70kol6",
          label: { en: "Commercial project", ar: "مشروع تجاري" },
        },
      ],
    },
    more: {
      href: "https://content.maharamedia.com/",
      label: {
        en: "Every ad format, with real examples",
        ar: "كل صيغ الإعلانات.. بأمثلة حقيقية",
      },
    },
  },
  {
    key: "brief",
    name: { en: "Every ad starts from a brief", ar: "كل إعلان يبدي من بريف" },
    what: {
      en: "A Brand DNA file of 10+ pages, then a full script document, before the first ad.",
      ar: "ملف Brand DNA أكثر من ١٠ صفحات، وبعده مستند سكربتات كامل.. قبل أول إعلان.",
    },
    why: {
      en: "Your ads sound like you, not like every other firm.",
      ar: "إعلاناتك تطلع بصوتك انت.. مو مثل باجي الشركات.",
    },
    media: {
      kind: "shots",
      items: [
        {
          src: adsDna,
          alt: "Master Brand DNA template",
          r: 0.773,
          w: 1224,
          doc: BRAND_DNA_DOC,
        },
        {
          src: adsBrief,
          alt: "A partner's script brief: hooks and triggers",
          r: 0.772,
          w: 1081,
          doc: AD_SCRIPT_DOC,
        },
      ],
    },
  },
  {
    key: "account",
    name: { en: "From inside our ad account", ar: "من داخل حساب الإعلانات" },
    what: {
      en: "Over $1.32M managed in this industry. Twenty ads in one campaign, and the winners stay on.",
      ar: "أكثر من ١٫٣٢ مليون دولار صرف إعلاني أدرناه بهالمجال.. و٢٠ إعلان بحملة وحدة، واللي ينجح منها يكمل.",
    },
    why: {
      en: "We test until the cost of a qualified lead comes down.",
      ar: "نجرب لين تنزل تكلفة الليد المؤهل.",
    },
    media: {
      kind: "shots",
      items: [
        {
          src: adsAccount,
          alt: "Meta Ads Manager: a partner campaign",
          r: 3.881,
          w: 1463,
        },
        {
          src: adsTwentyOn,
          alt: "The eleven ads still running in the campaign",
          r: 1.097,
          w: 1026,
        },
        {
          src: adsTwentyOff,
          alt: "The nine switched off, of twenty ads",
          r: 1.232,
          w: 1026,
        },
      ],
    },
  },
];

/** The lead's way from the ad to a booked meeting (the filtration step). */
export const JOURNEY: Stop[] = [
  {
    key: "landing",
    name: { en: "The landing page", ar: "اللاندنق بيج" },
    short: { en: "Landing page", ar: "اللاندنق بيج" },
    what: {
      en: "The ad opens a page built to sell, never a WhatsApp chat.",
      ar: "الإعلان يفتح صفحة مبنية عشان تبيع خدمتك.. مو محادثة واتساب.",
    },
    why: {
      en: "It educates them before anyone spends a minute on them.",
      ar: "الصفحة تشرح له كل شي.. قبل لا أحد يعطيه دقيقة من وقته.",
    },
    media: {
      kind: "devices",
      desktop: {
        src: jrLanding,
        alt: "A partner's landing page",
        r: 1.171,
        w: 1455,
      },
      phone: {
        src: jrLandingPhone,
        alt: "The same page on a phone",
        r: 0.462,
        w: 828,
      },
      // Aziz, 2026-10-08: "if we hover or click it it should make it popup".
      live: LINKS.landing,
    },
  },
  {
    key: "questions",
    name: { en: "The questions that filter", ar: "الأسئلة اللي تفلتر" },
    short: { en: "The questions", ar: "الأسئلة" },
    what: {
      en: "Three to five questions: the project, the timing, the budget.",
      ar: "٣ لـ٥ أسئلة: المشروع، التوقيت، والميزانية.",
    },
    why: {
      en: "Anyone who isn't serious leaves here, before costing you a minute.",
      ar: "اللي مو جاد يطلع هني.. قبل لا ياخذ دقيقة من وقتك.",
    },
    media: {
      kind: "phones",
      items: [
        { src: jrForm1, alt: "The rules and the service", r: 0.462, w: 923 },
        { src: jrForm2, alt: "The type of project", r: 0.462, w: 923 },
        { src: jrForm3, alt: "The budget, in plain numbers", r: 0.462, w: 923 },
      ],
    },
  },
  {
    key: "welcome",
    name: { en: "The welcome video", ar: "فيديو الترحيب" },
    short: { en: "Welcome video", ar: "فيديو الترحيب" },
    what: {
      en: "The thank-you page plays a short video: who you are and what happens next.",
      ar: "صفحة الشكر فيها فيديو قصير: منو انتوا، وشنو يصير بعدين.",
    },
    why: {
      en: "They know you before our team even calls.",
      ar: "يعرفك قبل لا يتصل عليه فريقنا.",
    },
    media: {
      kind: "video",
      id: "fqjjvj2lel",
      title: "The welcome video on the thank-you page",
      beside: {
        src: jrThanksPhone,
        alt: "The thank-you page on a phone",
        r: 0.462,
        w: 828,
      },
    },
  },
  {
    key: "call",
    name: { en: "A call within 5 minutes", ar: "اتصال خلال ٥ دقايق" },
    short: { en: "The 5-minute call", ar: "اتصال خلال ٥ دقايق" },
    what: {
      en: "The alert reaches our team the second they sign up.",
      ar: "التنبيه يوصل لفريقنا بنفس الثانية اللي يسجل فيها.",
    },
    why: {
      en: "Called within 5 minutes, a lead is 100 times more likely to answer than after 30 (MIT).",
      ar: "الليد اللي تكلمه خلال ٥ دقايق.. احتمال يرد عليك ١٠٠ مرة أكثر من لو كلمته بعد نص ساعة (دراسة MIT).",
    },
    media: {
      kind: "shots",
      items: [
        {
          src: jrSlack,
          alt: "The alert: new lead, call within 5 minutes",
          r: 2.883,
          w: 1600,
        },
        {
          src: ccDialer,
          alt: "The dialer: every call logged and recorded",
          r: 4.313,
          w: 1600,
        },
      ],
    },
  },
  {
    key: "booked",
    name: { en: "Booked: a WhatsApp and a video", ar: "انحجز: واتساب وفيديو" },
    short: { en: "Booked", ar: "انحجز" },
    what: {
      en: "A WhatsApp confirmation, then a second video that introduces your firm and builds trust before the meeting.",
      ar: "تأكيد على الواتساب، وبعده فيديو ثاني يعرّف العميل على شركتك ويقنعه فيك قبل الموعد.",
    },
    why: {
      en: "They arrive warm, and more likely to show up.",
      ar: "يوصلك متحمس.. وفرصة إنه يحضر أعلى.",
    },
    media: {
      kind: "video",
      id: "h9s81l9d8z",
      title: "The video sent after a booking",
      beside: {
        src: jrConfirm,
        alt: "The WhatsApp confirmation",
        r: 1.618,
        w: 1230,
        chat: true,
      },
    },
  },
];

/** Step 3: the project sales team, as the original deck told it. */
export const CALLS_TOUR: Stop[] = [
  {
    key: "who",
    name: {
      en: "Sales people, not call center staff",
      ar: "ناس مبيعات.. مو موظفين كول سنتر",
    },
    what: {
      en: "Three years of sales at least, and we interview 50+ people to hire one. Four trainings a week.",
      ar: "أقل شي ٣ سنين خبرة مبيعات.. ونقابل فوق ٥٠ شخص عشان نختار واحد. و٤ تدريبات بالأسبوع.",
    },
    why: {
      en: "Your leads talk to people who know how to sell a project.",
      ar: "عملاءك يكلمون ناس يعرفون يبيعون مشروع.",
    },
    media: {
      kind: "shots",
      items: [
        {
          src: ccCourse,
          alt: "The sales course every caller passes first",
          r: 0.881,
          w: 1530,
        },
        {
          src: ccTraining,
          alt: "The weekly call center training",
          r: 2.842,
          w: 1600,
        },
      ],
    },
  },
  {
    key: "script",
    name: {
      en: "They know your firm like you do",
      ar: "يعرفون شركتك مثل ما تعرفها",
    },
    what: {
      en: "A script written for your firm, and a knowledge base of your services and offers.",
      ar: "سكربت مكتوب لشركتك، وملف معلومات فيه كل خدماتك وعروضك.",
    },
    why: {
      en: "Every call sounds like your own team.",
      ar: "كل مكالمة كأنها من فريقك انت.",
    },
    media: {
      kind: "shots",
      fan: true,
      items: [
        { src: ccKb, alt: "A partner's knowledge base", r: 0.398, w: 826 },
        {
          src: ccScript1,
          alt: "Script: the discovery questions",
          r: 0.773,
          w: 1224,
          doc: SCRIPTS_DOC,
        },
        {
          src: ccScript2,
          alt: "Script: booking and locking the date",
          r: 0.773,
          w: 1224,
          doc: SCRIPTS_DOC,
        },
        {
          src: ccScript3,
          alt: "Script: every objection, with its answer",
          r: 0.773,
          w: 1224,
          doc: SCRIPTS_DOC,
        },
      ],
    },
  },
  {
    key: "stages",
    name: { en: "The call itself is engineered", ar: "المكالمة نفسها مدروسة" },
    what: {
      en: "Six stages, from the first hello to a decision that holds.",
      ar: "ست مراحل.. من أول سلام لين قرار ثابت.",
    },
    why: {
      en: "They arrive sold on you, not just booked.",
      ar: "يوصلك مقتنع فيك.. مو بس حاجز موعد.",
    },
    media: {
      kind: "stages",
      items: [
        { en: "The opening", ar: "المقدمة" },
        { en: "Their goal", ar: "تحديد الهدف" },
        { en: "The details", ar: "التعمق بالتفاصيل" },
        { en: "The pre-pitch", ar: "البري-بيتش" },
        { en: "The booking", ar: "الحجز" },
        { en: "Locking the decision", ar: "تثبيت القرار" },
      ],
    },
  },
  {
    key: "listen",
    name: { en: "Hear a real call", ar: "اسمع مكالمة حقيقية" },
    what: {
      en: "He was worried about delivery. Our team turned it into his first reason to buy.",
      ar: "كان شايل هم التسليم.. والفريق قلبها لأول سبب يخليه يشتري.",
    },
    why: {
      en: "Hundreds of calls like this every week.",
      ar: "مئات المكالمات مثلها كل أسبوع.",
    },
    media: {
      kind: "call",
      id: "ti2alygqn0",
      said: {
        en: "“If we agree, I'll definitely come and visit you.”",
        ar: "لو اتفقنا، أكيد لي زيارة لكم.",
      },
      replied: {
        en: "“For years we've been known for our delivery dates. Most of the time we deliver early.”",
        ar: "إحنا من سنين معروفين بتاريخ التسليم. أغلب الأحيان نسلم قبل الوقت أصلاً.",
      },
    },
    more: {
      href: "https://callcenter.maharamedia.com/",
      label: {
        en: "Six real calls, as they happened",
        ar: "ست مكالمات حقيقية.. مثل ما صارت",
      },
    },
  },
  {
    key: "nothing",
    name: { en: "Not one lead slips", ar: "ولا ليد يضيع" },
    what: {
      en: "Four follow-ups per lead. Didn't show up? We call the same day. Came but didn't sign? We follow up.",
      ar: "٤ متابعات لكل ليد.. ما حضر؟ نتصل بنفس اليوم. حضر وما وقّع؟ نتابع معاه.",
    },
    why: {
      en: "Every lead has a next step, and the reason is written in its file.",
      ar: "كل ليد له خطوة ياية.. والسبب مكتوب بملفه.",
    },
    media: {
      kind: "shots",
      items: [
        { src: ccNoshow, alt: "The no-show alert", r: 4.396, w: 1600 },
        { src: ccAttended, alt: "The attended alert", r: 4.494, w: 1600 },
        {
          src: ccCrm,
          alt: "The lead's file, with the team's note",
          r: 2.54,
          w: 1600,
        },
      ],
    },
  },
  {
    key: "calendar",
    name: { en: "Every booking, with its details", ar: "كل حجز.. بتفاصيله" },
    what: {
      en: "Every booking reaches you with the budget, the timeline and the project.",
      ar: "كل حجز يوصلك ومعاه الميزانية، المدة، وتفاصيل المشروع.",
    },
    why: {
      en: "You walk into each meeting knowing what they want.",
      ar: "تدخل كل موعد وانت تدري شنو يبي.",
    },
    media: {
      kind: "shots",
      items: [
        {
          src: jrBooked,
          alt: "A booking, with budget and timeline",
          r: 0.669,
          w: 1143,
        },
      ],
    },
  },
];

/** Step 4: Project Closing Mastery, shown the way the portal is. */
export const CLOSING_TOUR: Stop[] = [
  {
    key: "academy",
    name: { en: "Premium Projects Academy", ar: "أكاديمية المشاريع المميزة" },
    what: {
      en: "Six courses: the start, Google optimisation, the offer, Project Closing Mastery, and your team.",
      ar: "٦ كورسات: البداية، تحسين قوقل، صناعة العرض، إتقان توقيع المشاريع، والفريق والتشغيل.",
    },
    why: {
      en: "The frameworks and scripts our best partners use to close 40 to 50% of their proposals.",
      ar: "نفس الطرق والسكربتات اللي أنجح عملائنا يقفلون فيها ٤٠ لـ٥٠٪ من عروضهم.",
    },
    media: {
      kind: "shots",
      items: [
        {
          src: pcmAcademy,
          alt: "The academy's six courses",
          r: 1.415,
          w: 1456,
        },
      ],
    },
  },
  {
    key: "mastery",
    name: { en: "Project Closing Mastery", ar: "إتقان توقيع المشاريع" },
    what: {
      en: "Step by step: the consultation, the proposal, the objections and the close.",
      ar: "خطوة خطوة: الاستشارة، العرض، الاعتراضات، والإقفال.",
    },
    why: {
      en: "So you sign more of the people you meet.",
      ar: "عشان توقّع مع عدد أكبر من اللي تقابلهم.",
    },
    media: {
      kind: "shots",
      items: [
        {
          src: pcmLesson,
          alt: "A lesson inside the course",
          r: 0.799,
          w: 1444,
        },
      ],
    },
  },
  {
    key: "checkins",
    name: { en: "Weekly 1:1 check-in calls", ar: "مكالمات أسبوعية ١:١" },
    what: {
      en: "Every week with your success manager: the numbers, the calls, the next move.",
      ar: "كل أسبوع مع مدير حسابك: الأرقام، المكالمات، والخطوة الياية.",
    },
    why: {
      en: "You never work it out alone.",
      ar: "ما تحلها بروحك أبد.",
    },
    media: {
      kind: "shots",
      items: [
        { src: pcmCall, alt: "A weekly check-in call", r: 1.857, w: 1439 },
      ],
    },
    more: {
      href: "https://fathom.video/share/giCrmrxkJqc7hpPALMHsHSrevBVvn9wm",
      label: { en: "Watch a real check-in", ar: "شوف مكالمة حقيقية" },
    },
  },
  {
    key: "tracker",
    name: {
      en: "Your real calls, reviewed",
      ar: "مكالماتك الحقيقية.. نراجعها",
    },
    what: {
      en: "After every meeting we write down what happened and why, find where deals slip, and give you the exact words.",
      ar: "بعد كل موعد نكتب شنو صار وليش.. نطلع وين تطيح الصفقات، ونعطيك الكلام بالضبط.",
    },
    why: {
      en: "We work on your close rate from your own numbers.",
      ar: "نشتغل على نسبة إقفالك.. من أرقامك انت.",
    },
    media: {
      kind: "shots",
      items: [
        {
          src: pcmSheet,
          alt: "The follow-up sheet, with the reason for every meeting",
          r: 3.653,
          w: 1600,
        },
      ],
    },
  },
];

/** How we teach the whole industry: the long playbook and the daily lesson. */
export const CONTENT_TOUR: Stop[] = [
  {
    key: "youtube",
    name: {
      en: "The full systems, free on YouTube",
      ar: "الأنظمة كاملة.. ببلاش على يوتيوب",
    },
    what: {
      en: "Long videos that give away the systems we run for our partners.",
      ar: "فيديوهات طويلة نعطي فيها نفس الأنظمة اللي نشغلها لشركائنا.",
    },
    why: {
      en: "Firms across the Gulf learn from us before they ever book a call.",
      ar: "الشركات بالخليج تتعلم منا قبل لا تحجز أي مكالمة.",
    },
    media: { kind: "youtube", items: YOUTUBE_VIDEOS },
    more: {
      href: CHANNEL,
      label: { en: "Mahara on YouTube", ar: "قناة مهارة على يوتيوب" },
    },
  },
  {
    key: "instagram",
    name: {
      en: "A lesson every few days on Instagram",
      ar: "درس كل كم يوم على إنستقرام",
    },
    what: {
      en: "Short reels on the numbers, the filters and the close.",
      ar: "ريلز قصيرة عن الأرقام، الفلترة، والإقفال.",
    },
    why: {
      en: "The people you sell to already know the method.",
      ar: "الناس اللي تبيع لهم يعرفون الطريقة من قبل.",
    },
    media: { kind: "instagram", items: REELS },
    more: {
      href: INSTAGRAM,
      label: {
        en: "@mahara_media on Instagram",
        ar: "\u2066@mahara_media\u2069 على إنستقرام",
      },
    },
  },
];

/** Every proof picture, for the deck to load ahead of its slide. */
export const PROOF_PHOTOS: string[] = [
  ...new Set([
    ...[ADS_TOUR, JOURNEY, CALLS_TOUR, CLOSING_TOUR].flatMap(tour =>
      tour.flatMap(stop => {
        const m = stop.media;
        if (m.kind === "shots" || m.kind === "phones")
          return m.items.map(p => p.src);
        if (m.kind === "devices") return [m.desktop.src, m.phone.src];
        if (m.kind === "video" && m.beside) return [m.beside.src];
        return [];
      }),
    ),
    ...REVIEW_PAGES.flat().map(r => r.src),
    ...PROFILES.map(p => p.shot.src),
    ...LOGO_WALL.map(l => l.src),
    ...Object.values(STORY_PROOF).flatMap(p => (p.logo ? [p.logo] : [])),
  ]),
];
