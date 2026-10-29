/**
 * The 14 checks on a client recap (docs/forms/STAGE2-CONTRACT.md 6.5, the rules of
 * drafts-and-messages 3.8). A refusal stores the draft as failed with its sentence;
 * a warning keeps it ready with a note. The same checks run again on the text a
 * reviewer approves in 2b, so they read only the text and what is passed in.
 */

/** Make [23]'s check-in block, verbatim: the cockpit appends it after a blank line. */
export const BOOKING_BLOCK = [
  "إذا ما حجزت مكالمة المتابعة لين الحين، تقدر تحجزها من هنا:",
  "https://api.leadconnectorhq.com/widget/booking/SHjlq0UjeR11maltYNyh",
  "عادة نخلي أسبوع تقريبًا بين مكالمات المتابعة، عشان يكون فيه تقدم واضح نستعرضه معك.",
].join("\n");
const BOOKING_LINK = "https://api.leadconnectorhq.com/widget/booking/SHjlq0UjeR11maltYNyh";
export const RECAP_MAX = 1200;

export type RecapCheck = { rule: string; ok: boolean; note: string | null };
export type RecapVerdict = { checks: RecapCheck[]; refusal: string | null; warnings: string[] };

/** 1. The wa_send_rules regex (20261012f_wa_send_rules.sql:77), ported: leads, CPL, cost per lead, ليد/ليدز/ليدات, عملاء محتملين. */
export const LEADS =
  /(^|[^ء-ي٠-٩A-Za-z0-9_])([وف]?(ال|لل|[بكل]|[بك]ال))?ليد(ز|ات)?(كم|كن|هم|هن|ها|ه|نا|ك)?($|[^ء-ي٠-٩A-Za-z0-9_])|(ال)?عملاء\s+(ال)?محتمل(ين|ون)|\bleads?\b|\bcpls?\b|\bcost\s+per\s+lead\b/i;
const DIGITS = "[0-9٠-٩۰-۹]+(?:[.,٫٬][0-9٠-٩۰-۹]+)*";
const SCALE = "(?:\\s*(?:k|m|ألف|آلاف|الف|مليون|ملايين|thousand|million))?";
const MONEY_WORD = "(?:\\$|usd|kwd|sar|cpb|costs?|\\S*دولار\\S*|\\S*دينار\\S*|\\S*ريال\\S*|\\S*تكلف\\S*|\\S*تكاليف\\S*)";
/** 2. A digit beside a currency or cost word, either side. */
export const MONEY = new RegExp(`${DIGITS}${SCALE}\\s*[:\\-]?\\s*${MONEY_WORD}|${MONEY_WORD}\\s*[:\\-]?\\s*${DIGITS}`, "i");
/** 3. A promised result (refused) and ضمان, which can be a warranty (a warning). */
export const GUARANTEE = /نضمن|مضمون|\bguarantee(?:d|s)?\b/i;
export const WARRANTY = /ضمان/;
/** 4. Internal names, in Latin script and as the team writes them in Arabic. Make is the tool's capitalised name. */
const INTERNAL_MAKE = /\bMake\b/;
const INTERNAL_REST = /\bclick\s?up\b|\btype\s?form\b|\bfathom\b|\bforms?\b|\btranscripts?\b|\bdefcon\b|\bgrade[sd]?\b|فورم|فاثوم|تايب\s?فورم|كليك\s?اب|ترانسكربت|ديفكون/i;
/** 5 to 8. */
const MARKDOWN = /\*\*|#/;
const DASHES = /[—«»‹›]/;
const FOREIGN = /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Cyrillic}]/u;
const CONTRACTOR = /مقاول/;
/** 12. The guard's reference line (hermes/ad-billing-guard transport.ts) must never ride along. */
const REFERENCE = /^\s*(?:مرجع المتابعة|Reference|Ref)\s*:/im;

/** The text the client would get: the message, a blank line, the booking block. */
export function recapText(message: string): string {
  return `${message.trim()}\n\n${BOOKING_BLOCK}`;
}

/**
 * A reviewer's full text split back into the message and Make's booking block (2b,
 * recap.approve): the message is the text less its final blank line and block. A
 * text that does not end with the block comes back whole with no block, so
 * checkRecap's booking rule refuses it; a doubled block leaves one in the message,
 * which the same rule refuses (the link appears twice).
 */
export function splitRecap(body: string): [message: string, block: string | null] {
  const text = String(body ?? "");
  const tail = `\n\n${BOOKING_BLOCK}`;
  return text.endsWith(tail) ? [text.slice(0, -tail.length), BOOKING_BLOCK] : [text, null];
}

/**
 * The verdict on one recap. `text` is the full text with the booking block (by
 * default the message's own recapText), `stored` what the draft row holds, and
 * `teamToday` whether the group already had a team message today (2b; null in
 * a preview, where nothing reads the group).
 */
export function checkRecap(
  message: string,
  opts: { skip?: boolean; text?: string; stored?: string | null; teamToday?: boolean | null } = {},
): RecapVerdict {
  const m = String(message ?? "");
  const text = opts.text ?? recapText(m);
  const checks: RecapCheck[] = [];
  let refusal: string | null = null;
  const warnings: string[] = [];
  const refuse = (rule: string, bad: boolean, sentence: string) => {
    checks.push({ rule, ok: !bad, note: bad ? sentence : null });
    if (bad && !refusal) refusal = sentence;
  };
  const warn = (rule: string, bad: boolean, sentence: string) => {
    checks.push({ rule, ok: !bad, note: bad ? sentence : null });
    if (bad) warnings.push(sentence);
  };
  refuse("leads", LEADS.test(m), "The recap mentioned leads or cost per lead, which client messages never do. Draft again.");
  refuse("money", MONEY.test(m), "The recap quoted a money figure. Client messages carry no amounts. Draft again.");
  refuse("guarantee", GUARANTEE.test(m), "The recap promised a result. Client messages never guarantee one. Draft again.");
  warn("warranty", !GUARANTEE.test(m) && WARRANTY.test(m), "The recap says ضمان. Check that it means a warranty, not a promised result.");
  refuse("internal", INTERNAL_MAKE.test(m) || INTERNAL_REST.test(m), "The recap named an internal tool or word. Draft again.");
  refuse("markdown", MARKDOWN.test(m), "The recap used ** or #, which WhatsApp shows as symbols. Draft again.");
  refuse("dashes", DASHES.test(m), "The recap used an em dash or guillemets. Draft again.");
  refuse("script", FOREIGN.test(m), "The recap has letters from another script. Draft again.");
  refuse("contractor", CONTRACTOR.test(m), "The recap calls the client مقاول. Draft again.");
  warn("length", [...m.trim()].length > RECAP_MAX, "The recap is longer than 1,200 characters before the booking block.");
  refuse("empty", !opts.skip && !m.trim(), "The recap came back empty. Draft again.");
  refuse("booking", text.split(BOOKING_LINK).length - 1 !== 1 || !text.endsWith(BOOKING_BLOCK), "The booking link must appear exactly once, at the end. Draft again.");
  refuse("reference", REFERENCE.test(text), "The recap carries a reference line. Draft again.");
  warn("one_a_day", opts.teamToday === true, "The group already had a team message today.");
  refuse("stored", opts.stored !== undefined && opts.stored !== null && opts.stored !== text, "The preview differs from the stored text. Draft again.");
  return { checks, refusal, warnings };
}
