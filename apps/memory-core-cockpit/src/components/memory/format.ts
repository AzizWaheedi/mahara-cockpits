/**
 * Every date, count and label on the Memory Core screen goes through here, so
 * the four views read as one system. A missing value is never printed as 0:
 * "never synced" and "no items" are different sentences on purpose.
 */

export const NA = "n/a";
export const NA_HINT = "The source does not give this yet";

const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** A real, finite number. */
export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** 1,284. */
export function count(v: number | null | undefined): string {
  if (!isNum(v)) return NA;
  return int.format(Math.round(v));
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "12 min ago", "3 h ago", "6 days ago", "2 Sep". */
export function relative(at: number | null | undefined, now: number): string {
  if (!isNum(at)) return NA;
  const delta = Math.max(0, now - at);
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.round(delta / MINUTE)} min ago`;
  if (delta < DAY) return `${Math.round(delta / HOUR)} h ago`;
  if (delta < 7 * DAY) {
    const days = Math.round(delta / DAY);
    return `${days} day${days === 1 ? "" : "s"} ago`;
  }
  return day(at);
}

const dayFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "2 Sep 2026", in the reader's own timezone. */
export function day(at: number | null | undefined): string {
  if (!isNum(at) || at === 0) return NA;
  return dayFormat.format(new Date(at));
}

/** "2 Sep, 14:05" — for the audit log, where the hour matters. */
export function dateTime(at: number | null | undefined, now: number): string {
  if (!isNum(at)) return NA;
  const d = new Date(at);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes(),
  ).padStart(2, "0")}`;
  const today = new Date(now);
  const sameDay =
    d.getDate() === today.getDate() &&
    d.getMonth() === today.getMonth() &&
    d.getFullYear() === today.getFullYear();
  return sameDay ? `today ${time}` : `${day(at)}, ${time}`;
}

/** The name of a source, wherever a source has to be named. */
export function sourceLabel(source: string): string {
  if (source === "gmail") return "Gmail";
  if (source === "drive") return "Google Drive";
  if (source === "notion") return "Notion";
  if (source === "note") return "Memory";
  return source;
}

/** The one-line explanation of what a source is. */
export function sourceBlurb(source: string): string {
  if (source === "gmail") return "Every message, sender and subject included";
  if (source === "drive") return "File names and what Google has indexed";
  if (source === "notion")
    return "Page titles, and the text of any page you open";
  if (source === "note") return "Facts you saved yourself";
  return "";
}

/** A stable colour for a source's mark. Never the only signal: the label is beside it. */
export function sourceColor(source: string): string {
  if (source === "note") return "var(--mahara-teal)";
  if (source === "gmail") return "var(--royal-blue)";
  if (source === "notion") return "var(--deep-space)";
  return "var(--mc-deemphasis)";
}

/** Cut a long line for a row without cutting mid-word where it is easy to avoid. */
export function clamp(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
