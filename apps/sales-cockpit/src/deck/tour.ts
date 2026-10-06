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
  line: L;
  src: Record<Lang, string>;
}

export const PORTAL_TOUR: TourStop[] = [
  {
    key: "overview",
    name: { en: "Overview", ar: "الصفحة الرئيسية" },
    line: {
      en: "Where you are in the program, your next appointment, and what needs your answer.",
      ar: "وين وصلت بالبرنامج، موعدك الجاي، واللي ينتظر ردك.",
    },
    src: { en: overviewEn, ar: overviewAr },
  },
  {
    key: "leads",
    name: { en: "Every lead, traced to its ad", ar: "كل ليد.. وأي إعلان جابه" },
    line: {
      en: "The ad, the campaign, the calls and the WhatsApp messages behind each lead.",
      ar: "الإعلان، الحملة، المكالمات، ورسايل الواتساب.. ورا كل ليد.",
    },
    src: { en: leadsEn, ar: leadsAr },
  },
  {
    key: "calls",
    name: { en: "Every call, recorded", ar: "كل مكالمة مسجّلة" },
    line: {
      en: "Listen to any call our team made for you, with a short summary.",
      ar: "تسمع أي مكالمة سواها فريقنا لك، ومعاها ملخص قصير.",
    },
    src: { en: callsEn, ar: callsAr },
  },
  {
    key: "outcome",
    name: { en: "After each meeting", ar: "بعد كل موعد" },
    line: {
      en: "Attended or not, quoted, won, and the project value, in a few taps.",
      ar: "حضر ولا لا، عرض سعر، انقفل ولا لا، وقيمة المشروع.. بكم ضغطة.",
    },
    src: { en: outcomeEn, ar: outcomeAr },
  },
  {
    key: "results",
    name: { en: "Your results", ar: "نتايجك بالأرقام" },
    line: {
      en: "Cost per lead, cost per booking, show rate and projects won, against the period before.",
      ar: "تكلفة الليد، تكلفة الموعد، نسبة الحضور، والمشاريع اللي انقفلت.. مقارنة بالفترة اللي قبلها.",
    },
    src: { en: resultsEn, ar: resultsAr },
  },
  {
    key: "ads",
    name: { en: "Every ad we run for you", ar: "كل إعلان نشغله لك" },
    line: {
      en: "Live and past ads with their creative and copy, and how each one performed.",
      ar: "الإعلانات الشغالة والقديمة، بتصاميمها ونصوصها، وأداء كل واحد.",
    },
    src: { en: adsEn, ar: adsAr },
  },
];
