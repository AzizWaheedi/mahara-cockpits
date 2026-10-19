import { digits, type Lang } from "./content";

/**
 * Dates on the decks (DESIGN 13.3): the Gregorian calendar is forced in
 * Arabic (ar-SA would print Hijri dates on a Saudi client's deck), digits
 * are Arabic-Indic, and month names are the Gulf's (أكتوبر، نوفمبر). A
 * calendar day ("2026-10-14") is a day, never shifted by a time zone; a
 * moment (a booked call) is shown on the client's clock.
 */

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A Date for a calendar day or a moment; null when it cannot be read. */
export function toDate(value: unknown): Date | null {
  if (value == null || value === "") return null;
  if (typeof value === "string" && DAY_ONLY.test(value))
    return new Date(`${value}T12:00:00Z`);
  const d =
    typeof value === "number"
      ? new Date(value)
      : new Date(String(value).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

const isDay = (value: unknown) =>
  typeof value === "string" && DAY_ONLY.test(value);

function parts(
  value: unknown,
  lang: Lang,
  timeZone: string,
  opts: Intl.DateTimeFormatOptions,
) {
  const d = toDate(value);
  if (!d) return null;
  const f = new Intl.DateTimeFormat(lang === "ar" ? "ar" : "en-GB", {
    ...opts,
    calendar: "gregory",
    numberingSystem: lang === "ar" ? "arab" : "latn",
    timeZone: isDay(value) ? "UTC" : timeZone,
  });
  const out: Record<string, string> = {};
  for (const p of f.formatToParts(d)) out[p.type] = p.value;
  return out;
}

/** "14 October" · "١٤ أكتوبر". */
export function dayMonth(value: unknown, lang: Lang, timeZone: string): string {
  const p = parts(value, lang, timeZone, { day: "numeric", month: "long" });
  return p ? `${p.day} ${p.month}` : "";
}

/** "Tuesday 21 October" · "الثلاثاء ٢١ أكتوبر". */
export function weekdayDate(
  value: unknown,
  lang: Lang,
  timeZone: string,
): string {
  const p = parts(value, lang, timeZone, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return p ? `${p.weekday} ${p.day} ${p.month}` : "";
}

/** "4 pm", "10:30 am" · "٤ مساءً", "١٠:٣٠ صباحاً". */
export function clock(value: unknown, lang: Lang, timeZone: string): string {
  const d = toDate(value);
  if (!d || isDay(value)) return "";
  const p = parts(value, "en", timeZone, {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  });
  if (!p) return "";
  const h24 = Number(p.hour) % 24;
  const min = p.minute ?? "00";
  const h12 = h24 % 12 || 12;
  const time = min === "00" ? `${h12}` : `${h12}:${min}`;
  if (lang === "ar") return `${digits(time, "ar")} ${h24 < 12 ? "صباحاً" : "مساءً"}`;
  return `${time} ${h24 < 12 ? "am" : "pm"}`;
}

/** "Tuesday 21 October, 4 pm" · "الثلاثاء ٢١ أكتوبر، ٤ مساءً". */
export function when(value: unknown, lang: Lang, timeZone: string): string {
  const day = weekdayDate(value, lang, timeZone);
  const at = clock(value, lang, timeZone);
  if (!day) return "";
  return at ? `${day}${lang === "ar" ? "، " : ", "}${at}` : day;
}

/** Today's calendar day on the call centre's clock (Kuwait and Riyadh). */
export function gulfToday(now: Date): string {
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().slice(0, 10);
}

/** A calendar day from a day, a moment or a millisecond count. */
export function dayOf(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (isDay(value)) return value as string;
  const d = toDate(value);
  return d ? gulfToday(d) : null;
}
