/**
 * The words every offer deck shares: the revision letters, the labels of
 * record under a capture, the bill of quantities and the return card
 * (CONTRACT.md 5.7, docs/upsell-studio/CONTENT.md).
 *
 * Canvas rules (scripts/offer-copy.test.ts): white Gulf Arabic with the
 * client in the plural, no dialect-only words, Arabic-Indic digits, no em
 * dash, no money outside the bill. The revision letters stay Latin in
 * Arabic, as Gulf drawings write them. The Arabic is written under
 * mahara-context's aziz-kuwaiti-voice and waits for the CEO's one-batch
 * approval (docs/upsell-studio/ARABIC-FOR-APPROVAL.md).
 */
import type { L, OfferChromeKey } from "./types";

export const OFFER_CHROME: Record<OfferChromeKey, L> = {
  revA: { en: "Rev A", ar: "Rev A" },
  revB: { en: "Rev B", ar: "Rev B" },
  captured: { en: "Captured {date}", ar: "لقطة بتاريخ {date}" },
  searchedAs: { en: "searched as {city}", ar: "البحث من {city}" },
  // The Arabic drops the name: a slot after لـ reads badly, and "for you"
  // already says whose it is.
  example: { en: "Example, drawn for {name}", ar: "مثال، رسمناه لكم" },
  yourFigure: { en: "Your figure", ar: "رقمكم" },
  fromAnswer: { en: "Your answer, {date}", ar: "من جوابكم، {date}" },
  fromSheet: { en: "From your sheet", ar: "من جدول المتابعة" },
  item: { en: "Item", ar: "البند" },
  description: { en: "Description", ar: "الوصف" },
  terms: { en: "Terms", ar: "الدفع" },
  // The bill's money column: the one place a currency word may show.
  dollars: { en: "Dollars", ar: "دولار" },
  paidInFull: { en: "Paid in full.", ar: "دفعة وحدة كاملة." },
  typicalProject: { en: "Your typical project", ar: "مشروعكم المعتاد" },
  thisFirstYear: { en: "This, first year", ar: "هذا، أول سنة" },
  howMany: {
    en: "How many projects would pay for this?",
    ar: "كم مشروع يغطي هذا؟",
  },
  weNeed: { en: "What we need from you", ar: "اللي نحتاجه منكم" },
  commitTitle: { en: "What we commit to", ar: "اللي نلتزم فيه" },
  fromMainProgramme: {
    en: "From our main programme",
    ar: "من برنامجنا الأساسي",
  },
  oneTime: { en: "One time", ar: "دفعة وحدة" },
  monthly: { en: "Monthly", ar: "شهرياً" },
  perDay: { en: "Per day", ar: "باليوم" },
  per90: { en: "For 90 days", ar: "لمدة ٩٠ يوم" },
};
