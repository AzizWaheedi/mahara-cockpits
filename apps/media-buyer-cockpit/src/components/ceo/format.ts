/**
 * Every number and date on the CEO cockpit goes through here, so the screens
 * read as one system. Null or a non-finite number always becomes "n/a", never 0.
 * Money is USD, rates are fractions 0..1, days are Kuwait "YYYY-MM-DD".
 */

export const NA = "n/a";
export const NA_HINT = "The source does not give this number yet";

/** A real, finite number. */
export function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

// U+2212 is the typographic minus: same width as the plus sign, so signed columns align.
const MINUS = "−";

const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function trimZero(s: string): string {
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

const UNITS = [
  { at: 1e9, suffix: "B" },
  { at: 1e6, suffix: "M" },
  { at: 1e3, suffix: "K" },
] as const;

/** 12.4K, 124K, 1.2M; small values keep one decimal at most. */
function compactAbs(abs: number): string {
  for (let i = 0; i < UNITS.length; i++) {
    const u = UNITS[i];
    if (abs < u.at) continue;
    const scaled = abs / u.at;
    const text = scaled >= 100 ? String(Math.round(scaled)) : scaled.toFixed(1);
    // 999,960 rounds to "1000K"; step up to the next unit instead.
    if (Number(text) >= 1000 && i > 0) {
      const up = UNITS[i - 1];
      return `${trimZero((abs / up.at).toFixed(1))}${up.suffix}`;
    }
    return `${trimZero(text)}${u.suffix}`;
  }
  return abs >= 100 ? String(Math.round(abs)) : trimZero(abs.toFixed(1));
}

function sign(v: number): string {
  return v < 0 ? MINUS : "";
}

// --- Money ---

/** $12,450 in tiles and tables; cents only under $100 when there are any ($84.50). */
export function money(v: number | null | undefined): string {
  if (!isNum(v)) return NA;
  const abs = Math.abs(v);
  if (abs < 100 && Math.round(abs * 100) % 100 !== 0)
    return `${sign(v)}$${cents.format(abs)}`;
  const rounded = Math.round(abs);
  return `${rounded === 0 ? "" : sign(v)}$${int.format(rounded)}`;
}

/** $12.4K, $1.2M for charts and dense spots. */
export function moneyCompact(v: number | null | undefined): string {
  if (!isNum(v)) return NA;
  return `${sign(v)}$${compactAbs(Math.abs(v))}`;
}

// --- Counts ---

/** 1,284 (rounded to a whole number). */
export function count(v: number | null | undefined): string {
  if (!isNum(v)) return NA;
  const rounded = Math.round(v);
  return `${rounded < 0 ? MINUS : ""}${int.format(Math.abs(rounded))}`;
}

/** 12.9K for charts. */
export function countCompact(v: number | null | undefined): string {
  if (!isNum(v)) return NA;
  return `${sign(v)}${compactAbs(Math.abs(v))}`;
}

/** A plain number with up to `digits` decimals, for ratios like calls per lead (2.4). */
export function decimal(v: number | null | undefined, digits = 1): string {
  if (!isNum(v)) return NA;
  const text = trimZero(Math.abs(v).toFixed(digits));
  const [whole, frac] = text.split(".");
  const grouped = int.format(Number(whole));
  return `${sign(v)}${frac ? `${grouped}.${frac}` : grouped}`;
}

// --- Rates ---

/** A fraction as a percent: 0.245 is "25%", 0.045 is "4.5%" (one decimal under 10%). */
export function pct(fraction: number | null | undefined): string {
  if (!isNum(fraction)) return NA;
  const p = fraction * 100;
  const abs = Math.abs(p);
  const text =
    abs > 0 && abs < 10 ? trimZero(abs.toFixed(1)) : String(Math.round(abs));
  return `${text === "0" ? "" : sign(p)}${text}%`;
}

/** Percent without decimals, for axis ticks. */
export function pctCompact(fraction: number | null | undefined): string {
  if (!isNum(fraction)) return NA;
  return `${Math.round(fraction * 100)}%`;
}

// --- Durations ---

/** 4 min, 1 h 20 min, 3 days; under a minute falls through to seconds. */
export function minutes(v: number | null | undefined): string {
  if (!isNum(v)) return NA;
  if (Math.abs(v) < 1) return seconds(v * 60);
  const m = Math.round(Math.abs(v));
  const s = sign(v);
  if (m < 60) return `${s}${m} min`;
  const h = Math.floor(m / 60);
  if (h >= 48) return `${s}${Math.round(m / 1440)} days`;
  const rest = m % 60;
  return rest ? `${s}${h} h ${rest} min` : `${s}${h} h`;
}

/** 45 s, 2 min 5 s; an hour or more falls through to minutes. */
export function seconds(v: number | null | undefined): string {
  if (!isNum(v)) return NA;
  const total = Math.round(Math.abs(v));
  const s = sign(v);
  if (total < 60) return `${total === 0 ? "" : s}${total} s`;
  if (total >= 3600) return minutes(v / 60);
  const m = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${s}${m} min ${rest} s` : `${s}${m} min`;
}

// --- Kuwait dates and times (UTC+3 all year, no daylight saving) ---

const KUWAIT_OFFSET_MS = 3 * 3600_000;
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const MONTHS_SHORT = [
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
const MONTHS_LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

type DateInput = number | string | null | undefined;

// Built by hand instead of Intl: en-GB now prints "Sept", and we want "Sep" everywhere.
function parts(v: DateInput) {
  let d: Date | null = null;
  if (isNum(v)) d = new Date(v + KUWAIT_OFFSET_MS);
  else if (typeof v === "string") {
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(v);
    if (m) d = new Date(Date.UTC(+m[1], +m[2] - 1, m[3] ? +m[3] : 1));
  }
  if (!d || Number.isNaN(d.getTime())) return null;
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Kuwait day of an epoch ms, "YYYY-MM-DD". */
export function kuwaitDay(ms: number = Date.now()): string {
  const p = parts(ms);
  return p ? `${p.year}-${pad(p.month + 1)}-${pad(p.day)}` : "";
}

/** "Tue 15 Sep" from epoch ms (Kuwait) or a "YYYY-MM-DD" day. */
export function date(v: DateInput): string {
  const p = parts(v);
  return p ? `${DAYS_SHORT[p.weekday]} ${p.day} ${MONTHS_SHORT[p.month]}` : NA;
}

/** "15 Sep", for chart ticks. */
export function shortDate(v: DateInput): string {
  const p = parts(v);
  return p ? `${p.day} ${MONTHS_SHORT[p.month]}` : NA;
}

/** "Tuesday 15 September", for the page header. */
export function longDate(v: DateInput): string {
  const p = parts(v);
  return p ? `${DAYS_LONG[p.weekday]} ${p.day} ${MONTHS_LONG[p.month]}` : NA;
}

/** "10:40" in Kuwait. */
export function time(ms: number | null | undefined): string {
  const p = parts(ms);
  return p ? `${pad(p.hour)}:${pad(p.minute)}` : NA;
}

/** "10:40" when the moment is today in Kuwait, else "Mon 14 Sep, 10:40". */
export function dateTime(
  ms: number | null | undefined,
  now: number = Date.now(),
): string {
  if (!isNum(ms)) return NA;
  return kuwaitDay(ms) === kuwaitDay(now)
    ? time(ms)
    : `${date(ms)}, ${time(ms)}`;
}

/** Month label from "YYYY-MM": "Sep", or "September" / "Sep 2026" with options. */
export function month(
  v: string | null | undefined,
  opts: { long?: boolean; year?: boolean } = {},
): string {
  const p = parts(v);
  if (!p) return NA;
  const name = opts.long ? MONTHS_LONG[p.month] : MONTHS_SHORT[p.month];
  return opts.year ? `${name} ${p.year}` : name;
}

/** Kuwait hour 0..23 as "09:00". */
export function hour(h: number | null | undefined): string {
  return isNum(h) ? `${pad(Math.max(0, Math.min(23, Math.floor(h))))}:00` : NA;
}

/** "just now", "12 min ago", "3 h ago", "yesterday", "5 days ago", then the date. */
export function relative(
  ms: number | null | undefined,
  now: number = Date.now(),
): string {
  if (!isNum(ms)) return NA;
  const diff = now - ms;
  const future = diff < 0;
  const abs = Math.abs(diff);
  const say = (s: string) => (future ? `in ${s}` : `${s} ago`);
  if (abs < 45_000) return "just now";
  const min = Math.round(abs / 60_000);
  if (min < 60) return say(`${Math.max(1, min)} min`);
  const h = Math.round(abs / 3600_000);
  if (h < 24) return say(`${h} h`);
  const days = Math.round(abs / 86400_000);
  if (days === 1) return future ? "tomorrow" : "yesterday";
  if (days < 30) return say(`${days} days`);
  return date(ms);
}

// --- Deltas ---

export type Direction = "up" | "down" | "flat";

/** Relative change as a fraction; null when either side is unknown or the base is 0. */
export function change(
  current: number | null | undefined,
  previous: number | null | undefined,
): number | null {
  if (!isNum(current) || !isNum(previous) || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/** Difference, null-safe (for amounts and percentage points). */
export function diff(
  current: number | null | undefined,
  previous: number | null | undefined,
): number | null {
  if (!isNum(current) || !isNum(previous)) return null;
  return current - previous;
}

/** Direction of a change, with a dead zone so tiny wobbles read as flat. */
export function direction(
  v: number | null | undefined,
  epsilon = 0.0005,
): Direction {
  if (!isNum(v) || Math.abs(v) <= epsilon) return "flat";
  return v > 0 ? "up" : "down";
}

// A plus only when the rounded text still shows a nonzero digit ("+0%" reads wrong).
function withPlus(v: number, text: string): string {
  return v > 0 && /[1-9]/.test(text) ? `+${text}` : text;
}

/** "+12%", "−3.4%" from a fraction. */
export function signedPct(fraction: number | null | undefined): string {
  if (!isNum(fraction)) return NA;
  return withPlus(fraction, pct(fraction));
}

/** "+$1,200", "−$84.50". */
export function signedMoney(v: number | null | undefined): string {
  if (!isNum(v)) return NA;
  return withPlus(v, money(v));
}

/** "+12", "−3". */
export function signedCount(v: number | null | undefined): string {
  if (!isNum(v)) return NA;
  return withPlus(v, count(v));
}

/** Difference of two rates in percentage points: "+2.5 pts". */
export function signedPoints(fractionDiff: number | null | undefined): string {
  if (!isNum(fractionDiff)) return NA;
  const text = pct(fractionDiff).replace("%", "");
  return `${withPlus(fractionDiff, text)} pts`;
}

// --- Units for charts and tables ---

export type Unit = "money" | "count" | "pct" | "decimal" | "minutes";

/** The full and compact formatter for a unit. */
export function formatters(unit: Unit): {
  full: (v: number | null | undefined) => string;
  compact: (v: number | null | undefined) => string;
} {
  switch (unit) {
    case "money":
      return { full: money, compact: moneyCompact };
    case "pct":
      return { full: pct, compact: pctCompact };
    case "decimal":
      return { full: v => decimal(v), compact: countCompact };
    case "minutes":
      return {
        full: minutes,
        compact: v => (isNum(v) ? `${Math.round(v)}m` : NA),
      };
    default:
      return { full: count, compact: countCompact };
  }
}

// --- Words ---

/** "1 client", "3 clients". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${count(n)} ${n === 1 ? one : many}`;
}

/** "at risk" as "At risk": the first letter only, the rest kept as typed. */
export function capitalize(s: string): string {
  return s ? `${s.charAt(0).toUpperCase()}${s.slice(1)}` : s;
}

/** A raw key such as "ad_spend" or "no-data" as sentence-case words: "Ad spend". */
export function humanize(raw: string): string {
  const s = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return s ? capitalize(s) : raw;
}
