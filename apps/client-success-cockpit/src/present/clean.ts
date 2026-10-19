/**
 * Copy rule 10 (docs/csm-decks/CONTENT.md): free-text answers from the
 * forms are cleaned before a client sees them. Phone numbers, emails and
 * links are removed; prices are removed from service chips; a line that
 * mentions lead counts, appointment counts, a guarantee or a refund is held
 * back until the CSM edits it in prep. What the CSM types in prep is shown
 * as typed: it is the edit.
 */

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const URL = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;
/** Seven or more digits, with the spaces, dashes and + a phone number carries. */
const PHONE = /(?:\+|00)?[0-9٠-٩](?:[\s\-().]*[0-9٠-٩]){6,}/g;

/** Words that count leads or appointments, in English and Arabic. */
const COUNT_NOUN =
  "(?:leads?|enquir(?:y|ies)|inquir(?:y|ies)|prospects?|appointments?|bookings?|meetings?|consultations?|calls?|ليد|ليدز|عملاء محتملين|عميل محتمل|استفسارات?|مواعيد|موعد|حجوزات|حجز|اجتماعات|مكالمات)";
const NUM = "(?:[0-9٠-٩]+(?:\\s*(?:-|to|إلى|الى|لـ|~)\\s*[0-9٠-٩]+)?\\+?)";
const COUNTS = new RegExp(
  `${NUM}\\s*(?:[a-z\\u0600-\\u06FF]+\\s+){0,2}${COUNT_NOUN}`,
  "iu",
);
const GUARANTEE =
  /guarant|refund|money.?back|ضمان|نضمن|مضمون|استرجاع|استرداد|ترجيع الفلوس/i;

export type Held = "count" | "guarantee";

/** Why a free-text answer stays off the canvas until the CSM edits it. */
export function heldReason(text: string): Held | null {
  if (GUARANTEE.test(text)) return "guarantee";
  if (COUNTS.test(text)) return "count";
  return null;
}

export const HELD_WORDS: Record<Held, string> = {
  count: "it counts leads or appointments",
  guarantee: "it mentions a guarantee or a refund",
};

/** A form answer with phones, emails and links taken out, on one line. */
export function cleanAnswer(text: unknown): string {
  return String(text ?? "")
    .replace(EMAIL, "")
    .replace(URL, "")
    .replace(PHONE, "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/!+/g, ".")
    .replace(/\s+([,.،;:])/g, "$1")
    .replace(/([,،])\s*(?=[,،.])/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.،;:-]+|[\s,،;:-]+$/g, "")
    .trim();
}

/** Cut at a word boundary to about `max` characters. */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max + 1);
  const sentence = head.lastIndexOf(". ");
  if (sentence > max * 0.6) return head.slice(0, sentence + 1);
  const space = head.lastIndexOf(" ");
  return `${head.slice(0, space > max * 0.6 ? space : max).replace(/[,،;:.]+$/, "")}…`;
}

/** Answers that mean "nothing to say". */
export const EMPTY =
  /^(?:n\/?a|na|none|nothing|no|-+|\.+|لا|لا يوجد|ما في|مافي|ما فيه|لا شيء)$/i;

/**
 * Up to three challenges from one free-text answer: its own lines or
 * numbered items, else its sentences.
 */
export function challengeLines(text: string): string[] {
  const raw = String(text ?? "");
  let parts = raw
    .split(/\r?\n|(?:^|\s)(?:\d+[.)-]|[-•▪*])\s+/)
    // A numbered or bulleted line keeps no mark of its own (each part may
    // start with one after a line break).
    .map(p => p.replace(/^\s*(?:\d+[.)-]|[-•▪*])\s+/, ""))
    .map(cleanAnswer)
    .filter(p => p && !EMPTY.test(p));
  if (parts.length <= 1)
    parts = cleanAnswer(raw)
      .split(/(?<=[.؟?])\s+/)
      .map(s => s.trim())
      .filter(Boolean);
  return parts.slice(0, 3).map(p => cut(p, 120));
}

const PRICE =
  /(?:[$€£]|\b(?:usd|kwd|kd|sar|sr|aed|qar|bhd|omr)\b|دينار|ريال|درهم|دولار|د\.ك|ر\.س|د\.إ)\s*[0-9٠-٩][0-9٠-٩.,٬\s]*[kKمألف]*|[0-9٠-٩][0-9٠-٩.,٬]*\s*(?:k|K|ألف|الف|مليون|م²|m2|sqm|sq\.?\s?m)?\s*(?:[$€£]|\b(?:usd|kwd|kd|sar|sr|aed|qar|bhd|omr)\b|دينار|ريال|درهم|دولار|د\.ك|ر\.س|د\.إ)?/gi;

/** A service name: prices, counts and filler words taken out. */
function serviceName(part: string): string {
  return cleanAnswer(part)
    .replace(PRICE, " ")
    .replace(/\((?:[^)]*)\)/g, " ")
    .replace(
      /\b(?:from|starting at|starts at|around|approx\.?|per|up to)\b.*$/i,
      "",
    )
    .replace(/(?:من|يبدأ من|تبدأ من|حوالي|تقريبا)\s*$/u, "")
    .replace(/^(?:services?|خدمات|الخدمات)\s*[:：]\s*/i, "")
    .replace(/\s*[-:–]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The client's services as chips, from the onboarding form's free text:
 * split on lines and list marks, prices removed, sentences dropped. Clients
 * often write a paragraph; then nothing is guessed and the CSM types the
 * chips in prep or on the slide.
 */
export function serviceChips(text: unknown, max = 6): string[] {
  const raw = String(text ?? "").trim();
  if (!raw || EMPTY.test(raw)) return [];
  const parts = raw
    // What sits in brackets is a note ("consultation 1,500 SAR"), not a service.
    .replace(/\([^)]*\)/g, " ")
    // A comma between digits is a thousands mark, not a list.
    .split(/\r?\n|,(?!\d{3}\b)|[،;؛•▪]|\s[-–]\s|\s\/\s|\d+[.)]\s/)
    // A sentence is not a service name, even once its prices are taken out.
    .filter(part => {
      const p = cleanAnswer(part);
      return p.split(/\s+/).length <= 8 && !/[.؟?]$/.test(p);
    })
    .map(serviceName)
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const words = p.split(/\s+/).length;
    // A sentence is not a service name.
    if (p.length > 44 || words > 6 || /[.؟?:]$/.test(p)) continue;
    if (EMPTY.test(p) || /^(?:and|و|or|أو)$/i.test(p)) continue;
    if (/highest|profit|price|margin|سعر|ربح|أعلى/i.test(p)) continue;
    if (!out.some(o => o.toLowerCase() === p.toLowerCase())) out.push(p);
    if (out.length >= max) break;
  }
  return out;
}
