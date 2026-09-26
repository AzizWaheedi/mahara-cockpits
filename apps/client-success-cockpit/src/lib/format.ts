/**
 * Display helpers. They change how a value reads on screen, never the value
 * itself: the ISO date, the ClickUp stage and the backend's sentence are
 * still what gets saved, compared and sent.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const ISO_DAY = /(\d{4})-(\d{2})-(\d{2})/;

/** "2026-09-20" (or a full ISO timestamp) as "20 Sep". Anything else comes back as it was. */
export function shortDay(value?: string | null): string {
  if (!value) return "";
  const m = ISO_DAY.exec(String(value));
  if (!m) return String(value);
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month}` : String(value);
}

/**
 * A sentence the backend wrote, made fit for the screen: ISO days read as
 * "20 Sep", an em dash becomes a comma and "2 invoice(s)" reads "2 invoices".
 */
export function plainText(value?: string | null): string {
  return String(value ?? "")
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, day => shortDay(day))
    .replace(/\s*[—]\s*/g, ", ")
    .replace(
      /\b(\d+)((?:\s+[A-Za-z-]+){1,3})\(s\)/g,
      (_, n: string, words: string) =>
        `${n}${words}${Number(n) === 1 ? "" : "s"}`,
    );
}

/** The first letter up, for a backend label that starts mid-sentence. */
export function sentence(value?: string | null): string {
  const text = String(value ?? "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Pictographs and the variation selectors that ride along with them. */
const EMOJI = /\p{Extended_Pictographic}|\u{FE0F}|\u{200D}/gu;

/**
 * A ClickUp label as it should read in the app: no emoji, sentence case.
 * "Ready For Launch🚀" reads "Ready for launch", "LAUNCH BOOKED" reads
 * "Launch booked". Words that were already mixed case keep their capitals
 * after the first word only when they look like a name (DFY, GHL, UGC).
 */
export function displayLabel(raw?: string | null): string {
  const clean = String(raw ?? "")
    .replace(EMOJI, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  const words = clean.split(" ");
  const allCaps = clean === clean.toUpperCase();
  return words
    .map((w, i) => {
      const acronym = !allCaps && w.length <= 4 && /^[A-Z0-9+]+$/.test(w);
      const lower = acronym ? w : w.toLowerCase();
      return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

/** "1 day" / "3 days". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
