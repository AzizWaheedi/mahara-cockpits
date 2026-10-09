/**
 * How hours and pay read on the Hours and pay card. Everything else comes
 * from the CEO kit's format.ts; these exist because a month of work is
 * "182 h" (format.ts turns 48 h and more into days) and pay is exact to the
 * currency's minor unit ("$853.20", "KWD 281.275"), where the kit rounds
 * dollars over $100.
 */
import { count, isNum, NA } from "@/components/ceo/format";
import type { DayView, Seconds, Ym, Ymd } from "@/types/ceo/hoursContract";

const MINUS = "−";

/** 182 h, 3 h 38 min, 45 min, 0 h. Whole minutes, never days. */
export function hm(s: Seconds | null | undefined): string {
  if (!isNum(s)) return NA;
  const total = Math.round(Math.abs(s) / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  const body =
    h && m
      ? `${count(h)} h ${m} min`
      : h
        ? `${count(h)} h`
        : m
          ? `${m} min`
          : "0 h";
  return s < 0 && total > 0 ? `${MINUS}${body}` : body;
}

/** +1 h 30 min, −45 min: a change in time. */
export function signedHm(s: Seconds | null | undefined): string {
  if (!isNum(s)) return NA;
  const text = hm(Math.abs(s));
  if (Math.round(Math.abs(s) / 60) === 0) return text;
  return s < 0 ? `${MINUS}${text}` : `+${text}`;
}

/** Hours to one decimal for a row: "170.5 h", "182 h". */
export function hoursDec(s: Seconds | null | undefined): string {
  if (!isNum(s)) return NA;
  const tenths = Math.round(Math.abs(s) / 360);
  const whole = Math.floor(tenths / 10);
  const frac = tenths % 10;
  return `${s < 0 && tenths ? MINUS : ""}${count(whole)}${frac ? `.${frac}` : ""} h`;
}

/** Whole hours for tiles: "1,092 h". */
export function hours(s: Seconds | null | undefined): string {
  if (!isNum(s)) return NA;
  return `${count(s / 3600)} h`;
}

/** Decimal places a currency pays in: three for the Gulf dinars, two otherwise. */
export function minorDigits(currency: string): number {
  return ["KWD", "BHD", "OMR", "JOD"].includes(currency.toUpperCase()) ? 3 : 2;
}

/** Exact pay in its own currency: "$853.20", "KWD 281.275", "−$40.00". */
export function pay(
  amount: number | null | undefined,
  currency: string,
): string {
  if (!isNum(amount)) return NA;
  const digits = minorDigits(currency);
  const text = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Math.abs(amount));
  const zero = Number(text.replace(/,/g, "")) === 0;
  const sign = amount < 0 && !zero ? MINUS : "";
  const cur = currency.toUpperCase();
  return cur === "USD" ? `${sign}$${text}` : `${sign}${cur} ${text}`;
}

/** "+$7.50", "−KWD 12.000". */
export function signedPay(
  amount: number | null | undefined,
  currency: string,
): string {
  if (!isNum(amount)) return NA;
  const text = pay(amount, currency);
  return amount > 0 && /[1-9]/.test(text) ? `+${text}` : text;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Day of the week of a Kuwait calendar day, 0 = Sunday … 6 = Saturday. */
export function weekday(day: Ymd): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The company week starts on Saturday. */
export const isSaturday = (day: Ymd) => weekday(day) === 6;

/** "14" from "2026-10-14". */
export const dayOfMonth = (day: Ymd) => Number(day.slice(8, 10));

/** "Tue 6 Oct". */
export function dayLabel(day: Ymd): string {
  const months = [
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
  return `${WEEKDAY[weekday(day)]} ${dayOfMonth(day)} ${months[Number(day.slice(5, 7)) - 1]}`;
}

/** "October", "October 2026". */
export function monthLabel(ym: Ym, year = false): string {
  const months = [
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
  const name = months[Number(ym.slice(5, 7)) - 1] ?? ym;
  return year ? `${name} ${ym.slice(0, 4)}` : name;
}

/** The first day of a "YYYY-MM" month. */
export const firstOf = (ym: Ym): Ymd => `${ym}-01`;

/**
 * How far one day's fill rises, as fractions of its expected time: counted
 * work in teal, paid leave hatched teal, unpaid hatched grey. Day-off work has
 * no expected time, so it is drawn against the longest expected day.
 */
export function dayShares(
  d: DayView,
  longestDay: Seconds,
): { work: number; paid: number; unpaid: number; extra: boolean } {
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const base = d.expected > 0 ? d.expected : longestDay || 1;
  const counted = d.counted ?? 0;
  const work = Math.max(0, counted - d.paidLeave);
  return {
    work: clamp(work / base),
    paid: clamp(d.paidLeave / base),
    unpaid: clamp(d.unpaid / base),
    extra: d.expected > 0 && counted > d.expected,
  };
}

/** "7", "7.5", "7:30" or "7 h 30" as seconds; null when it is not a time. */
export function parseHours(text: string): number | null {
  const t = text.trim().toLowerCase();
  let m = /^(\d{1,2})(?::(\d{2}))?$/.exec(t);
  if (m) {
    const h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    return min < 60 && h <= 24 ? h * 3600 + min * 60 : null;
  }
  m = /^(\d{1,2}(?:\.\d+)?)\s*h?$/.exec(t);
  if (m) {
    const h = Number(m[1]);
    return h <= 24 ? Math.round(h * 3600) : null;
  }
  m = /^(\d{1,2})\s*h\s*(\d{1,2})\s*(?:m|min)?$/.exec(t);
  if (m) {
    const min = Number(m[2]);
    return min < 60 ? Number(m[1]) * 3600 + min * 60 : null;
  }
  return null;
}
