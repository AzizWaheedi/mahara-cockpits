/**
 * WhatsApp beyond the 24-hour window, and the ready-made messages (Aziz,
 * 2026-09-26: "a lot of WhatsApp messages that they can send, not just
 * email, because the reply rates are very low").
 *
 * A free WhatsApp message goes only within 24 hours of the lead's own last
 * message. Outside that, only a Meta-approved template, which HighLevel
 * sends through a workflow: the cockpit writes the line into the contact and
 * enrols them (sales-api wa.template.send). The ready-made messages are the
 * team's own words for the usual moments, filled in with the lead's name and
 * the call's day and time.
 */

export type Moment =
  | "first_touch"
  | "missed_call"
  | "no_show"
  | "cancelled"
  | "confirm"
  | "booked"
  | "after_intro"
  | "after_demo"
  | "no_reply"
  | "nurture"
  | "proof"
  | "reactivate"
  | "other";

export const MOMENTS: [Moment, string][] = [
  ["first_touch", "First message"],
  ["missed_call", "After a missed call"],
  ["confirm", "Confirm the call"],
  ["booked", "Just booked"],
  ["no_show", "Missed the call"],
  ["cancelled", "Cancelled"],
  ["after_intro", "After the intro"],
  ["after_demo", "After the demo"],
  ["no_reply", "Went quiet"],
  ["proof", "Share proof"],
  ["nurture", "Check in"],
  ["reactivate", "Old lead"],
  ["other", "Other"],
];

export interface Snippet {
  id: string;
  moment: Moment;
  language: "ar" | "en";
  body: string;
  sort: number;
}

export interface TemplateRoute {
  key: string;
  name: string;
  language: "ar" | "en";
  purpose: string;
  preview: string;
  variables: ("first_name" | "rep_name" | "line")[];
  workflow_id: string | null;
  active: boolean;
  segments: string[];
  sort: number;
  updated_by: string;
  updated_at: string;
}

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export const arabicDigits = (s: string) =>
  s.replace(/[0-9]/g, d => AR_DIGITS[Number(d)]);

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

/**
 * The lead's clock: the UAE and Oman keep UTC+4; Kuwait, Saudi Arabia, Qatar
 * and Bahrain UTC+3 (and so does anyone whose country is unknown).
 */
export function leadOffsetHours(country: string | null | undefined): number {
  // The lead copy holds ISO codes (AE, OM); names are matched too.
  return /^\s*(ae|om)\s*$|emirates|\buae\b|u\.a\.e|dubai|abu dhabi|sharjah|ajman|\boman\b|muscat|الإمارات|الامارات|دبي|أبوظبي|ابوظبي|الشارقة|مسقط/i.test(
    String(country ?? ""),
  )
    ? 4
    : 3;
}

/** The wall clock at an offset from UTC, for an instant (the Gulf keeps no daylight saving). */
function kuwait(ms: number, offsetHours = 3) {
  const d = new Date(ms + offsetHours * 3_600_000);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth(),
    date: d.getUTCDate(),
    dow: d.getUTCDay(),
    h: d.getUTCHours(),
    min: d.getUTCMinutes(),
  };
}

/**
 * A booked call's day and time the way a rep would write them to the lead:
 * "باجر" and "٣ العصر", or "tomorrow" and "3 pm", on the lead's own clock.
 */
export function callWords(
  startIso: string,
  lang: "ar" | "en",
  now = Date.now(),
  offsetHours = 3,
): { day: string; time: string } {
  const at = kuwait(Date.parse(startIso), offsetHours);
  const today = kuwait(now, offsetHours);
  const dayNo = (k: ReturnType<typeof kuwait>) =>
    Date.UTC(k.y, k.m, k.date) / 86_400_000;
  const diff = dayNo(at) - dayNo(today);
  const h12 = at.h % 12 || 12;
  const clockText = at.min
    ? `${h12}:${String(at.min).padStart(2, "0")}`
    : `${h12}`;
  if (lang === "ar") {
    const day =
      diff === 0 ? "اليوم" : diff === 1 ? "باجر" : `يوم ${AR_DAYS[at.dow]}`;
    const part =
      at.h < 12
        ? "الصبح"
        : at.h < 15
          ? "الظهر"
          : at.h < 18
            ? "العصر"
            : at.h < 20
              ? "المغرب"
              : "بالليل";
    return { day, time: `${arabicDigits(clockText)} ${part}` };
  }
  const day = diff === 0 ? "today" : diff === 1 ? "tomorrow" : EN_DAYS[at.dow];
  return { day, time: `${clockText} ${at.h < 12 ? "am" : "pm"}` };
}

export type SnippetValues = Partial<
  Record<"name" | "rep" | "day" | "time", string | null>
>;

/** A ready-made message with what is known put in; the rest stays marked for the rep. */
export function fillSnippet(body: string, v: SnippetValues): string {
  return body.replace(
    /\{(name|rep|day|time)\}/g,
    (all, k: keyof SnippetValues) => v[k] || all,
  );
}

/**
 * A ready-made message as the one line a template carries: the template
 * already greets the lead and says who it is from, so those go, and the
 * line breaks go (Meta refuses them inside a template).
 */
export function snippetLine(body: string): string {
  let s = body.trim();
  s = s.replace(/^(هلا|أهلاً|اهلا|مرحبا)\s*\{name\}\s*[،,]\s*/u, "");
  s = s.replace(/^(معاك\s*)?\{rep\}\s*من مهارة ميديا\s*[.،]?\s*/u, "");
  s = s.replace(/^(Hi|Hello)\s*\{name\}\s*,\s*/i, "");
  s = s.replace(
    /^(it'?s\s*)?\{rep\}\s*(here\s*)?from Mahara Media\s*[.,]?\s*/i,
    "",
  );
  s = s
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** The approved text with its values in, as the lead will read it. */
export function renderTemplate(
  t: Pick<TemplateRoute, "preview" | "variables">,
  v: Partial<Record<"first_name" | "rep_name" | "line", string>>,
): string {
  return t.preview.replace(/\{\{(\d+)\}\}/g, (all, n) => {
    const name = t.variables[Number(n) - 1];
    return (name && v[name]) || all;
  });
}

/**
 * The language to write to a lead in: the language of their own messages;
 * with none, Arabic (the Gulf writes Arabic; the rep can switch).
 */
export function leadLanguage(
  theirMessages: (string | null | undefined)[],
): "ar" | "en" {
  const texts = theirMessages.filter((t): t is string => Boolean(t?.trim()));
  if (texts.length && !texts.some(t => /[\u0600-\u06ff]/.test(t))) return "en";
  return "ar";
}

/** The first word of a name, to greet someone by. */
export const firstWord = (name: string | null | undefined) =>
  String(name ?? "")
    .trim()
    .split(/\s+/)[0] ?? "";
