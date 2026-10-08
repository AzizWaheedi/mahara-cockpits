import adsAr from "./assets/portal-ads-ar.webp";
import adsEn from "./assets/portal-ads-en.webp";
import callsAr from "./assets/portal-calls-ar.webp";
import callsEn from "./assets/portal-calls-en.webp";
import leadsAr from "./assets/portal-leads-ar.webp";
import leadsEn from "./assets/portal-leads-en.webp";
import outcomeAr from "./assets/portal-outcome-ar.webp";
import outcomeEn from "./assets/portal-outcome-en.webp";
import overviewAr from "./assets/portal-overview-ar.webp";
import overviewEn from "./assets/portal-overview-en.webp";
import resultsAr from "./assets/portal-results-ar.webp";
import resultsEn from "./assets/portal-results-en.webp";
import type { L, Lang } from "./content";

/**
 * The portal tour: six screens of Mahara OS, the client portal, one at a
 * time. Captured from the released portal (v1.5.6) run locally with a
 * fictional workspace ("Demo Studio", every name ends in "Demo"), never a
 * real client's; the slide says so. Each screen is cropped to the page
 * beside the menu so its words stay readable on a shared screen.
 */
export interface TourStop {
  key: string;
  name: L;
  /** What the screen does. */
  line: L;
  /** Why the partner is better off for it (Aziz, 2026-10-07). */
  why: L;
  src: Record<Lang, string>;
}

export const PORTAL_TOUR: TourStop[] = [
  {
    key: "overview",
    name: { en: "Your command centre", ar: "غرفة التحكم" },
    line: {
      en: "Where you are in the program, your next appointment, and what needs your answer.",
      ar: "وين وصلت بالبرنامج، موعدك الجاي، واللي ينطر ردك.",
    },
    why: {
      en: "You always know where things stand, without having to ask.",
      ar: "دايماً تدري وين وصلنا.. بدون ما تسأل.",
    },
    src: { en: overviewEn, ar: overviewAr },
  },
  {
    key: "leads",
    name: {
      en: "Every lead, and the ad that brought it",
      ar: "كل ليد.. والإعلان اللي جابه",
    },
    line: {
      en: "The ad, the campaign, the calls and the WhatsApp messages behind each lead.",
      ar: "الإعلان، الحملة، المكالمات، ورسايل الواتساب.. ورا كل ليد.",
    },
    why: {
      en: "You see which ads bring real projects, and we put more money behind them.",
      ar: "تشوف أي إعلان ييب مشاريع حقيقية.. ونحط عليه فلوس أكثر.",
    },
    src: { en: leadsEn, ar: leadsAr },
  },
  {
    key: "calls",
    name: { en: "Every call, recorded", ar: "كل مكالمة.. مسجلة" },
    line: {
      en: "Listen to any call our team made for you, with a short summary.",
      ar: "تسمع أي مكالمة سواها فريقنا لك، ومعاها ملخص قصير.",
    },
    why: {
      en: "Hear exactly how your leads are handled. Nothing is hidden.",
      ar: "تسمع بنفسك شلون نكلم عملاءك.. ماكو شي مخفي.",
    },
    src: { en: callsEn, ar: callsAr },
  },
  {
    key: "outcome",
    name: {
      en: "Each meeting's outcome, in two taps",
      ar: "نتيجة كل موعد.. بضغطتين",
    },
    line: {
      en: "Attended or not, quoted, won, and the project value, in a few taps.",
      ar: "حضر ولا لا، عرض سعر، انقفل ولا لا، وقيمة المشروع.. بكم ضغطة.",
    },
    why: {
      en: "The system learns which leads become projects, and finds you more of them.",
      ar: "النظام يتعلم أي ليد يصير مشروع.. وييب لك أكثر منهم.",
    },
    src: { en: outcomeEn, ar: outcomeAr },
  },
  {
    key: "results",
    name: { en: "Your results, in money", ar: "نتايجك.. بالفلوس" },
    line: {
      en: "Cost per lead, cost per booking, show rate and projects won, against the period before.",
      ar: "تكلفة الليد، تكلفة الموعد، نسبة الحضور، والمشاريع اللي انقفلت.. مقارنة بالفترة اللي قبلها.",
    },
    why: {
      en: "You judge us on projects won, not on likes.",
      ar: "تحكم علينا بالمشاريع اللي انقفلت.. مو باللايكات.",
    },
    src: { en: resultsEn, ar: resultsAr },
  },
  {
    key: "ads",
    name: { en: "Every ad, and what it brought in", ar: "كل إعلان.. وشنو جاب" },
    line: {
      en: "Live and past ads with their creative and copy, and how each one performed.",
      ar: "الإعلانات الشغالة والقديمة، بتصاميمها ونصوصها، وأداء كل واحد.",
    },
    why: {
      en: "You see the creative behind every result.",
      ar: "تشوف الإعلان اللي ورا كل نتيجة.",
    },
    src: { en: adsEn, ar: adsAr },
  },
];
