/**
 * The Brand Blueprint deck's derived values (docs/brand-blueprint/SPEC.md
 * 5.2 and 5.3), pure: the call's dates, money as the client reads it, the
 * colours in their Brand DNA doc, and what the wall's frames hold. The
 * slides only place what this file works out.
 */

import type { Answers, Currency } from "./blueprintForm";
import { digits, type Lang } from "./content";

// ------------------------------------------------------------- money

/** The client's currency from their country (SPEC 5.3: changeable in notes). */
export function currencyFor(country: string | null | undefined): Currency {
  switch (String(country ?? "").toUpperCase()) {
    case "KW":
      return "KWD";
    case "SA":
      return "SAR";
    case "AE":
      return "AED";
    case "QA":
      return "QAR";
    case "BH":
      return "BHD";
    case "OM":
      return "OMR";
    default:
      return "USD";
  }
}

/** Each currency's word in Arabic: the client's own (دينار، ريال، درهم). */
const CURRENCY_AR: Record<Currency, string> = {
  KWD: "دينار",
  SAR: "ريال",
  AED: "درهم",
  QAR: "ريال",
  BHD: "دينار",
  OMR: "ريال",
  USD: "دولار",
};

const grouped = (n: number) =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * An amount as the slide says it. English: "75,000 SAR". Arabic: Arabic-
 * Indic digits, no thousands mark up to ٩٩٩٩, and from ١٠ آلاف in words
 * ("٧٥ ألف ريال", "١٫٢ مليون ريال"); never ٬.
 */
export function moneyText(
  amount: number,
  currency: Currency,
  lang: Lang,
): string {
  if (lang === "en") return `${grouped(amount)} ${currency}`;
  const word = CURRENCY_AR[currency];
  if (amount < 10_000) return `${digits(Math.round(amount), "ar")} ${word}`;
  if (amount >= 1_000_000) {
    const m = Math.round(amount / 100_000) / 10;
    // One million is مليون alone, never ١ مليون.
    if (m === 1) return `مليون ${word}`;
    const n = String(m).replace(".", "٫");
    return `${digits(n, "ar")} مليون ${word}`;
  }
  const thousands = Math.floor(amount / 1000);
  const rest = Math.round(amount - thousands * 1000);
  const unit = thousands <= 10 ? "آلاف" : "ألف";
  const head = `${digits(thousands, "ar")} ${unit}`;
  return rest ? `${head} و${digits(rest, "ar")} ${word}` : `${head} ${word}`;
}

/** A money answer ({amount, currency}) in words, or null. */
export function moneyOf(v: unknown, lang: Lang): string | null {
  const m = v as { amount?: unknown; currency?: unknown } | null;
  if (!m || typeof m.amount !== "number") return null;
  return moneyText(m.amount, (m.currency as Currency) ?? "USD", lang);
}

/**
 * An amount as the tape prints it beside its mark, with no currency (the
 * cards under the tape carry it): "180,000" · "١٨٠ ألف", "١٫٢ مليون".
 */
export function shortAmount(amount: number, lang: Lang): string {
  if (lang === "en") return grouped(amount);
  if (amount < 10_000) return digits(Math.round(amount), "ar");
  if (amount >= 1_000_000) {
    const m = Math.round(amount / 100_000) / 10;
    if (m === 1) return "مليون";
    return `${digits(String(m).replace(".", "٫"), "ar")} مليون`;
  }
  const thousands = Math.round(amount / 1000);
  return `${digits(thousands, "ar")} ${thousands <= 10 ? "آلاف" : "ألف"}`;
}

/**
 * The range typed in "how you price, and where most projects land"
 * (2.5, their words): the first two amounts in it, low then high ("between
 * 180,000 and 260,000", "180k to 260k", "١٨٠ ألف إلى ٢٦٠ ألف"). One amount
 * is a point, none is null. Small numbers (a percentage, a count of rooms)
 * are not amounts.
 */
export function bandOf(text: unknown): [number, number] | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const latin = text
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".");
  const scale = (unit: string) =>
    unit === "k" || unit === "thousand" || /ألف|الف|آلاف/.test(unit)
      ? 1000
      : unit === "m" || unit === "million" || unit === "مليون"
        ? 1_000_000
        : 1;
  const tokens: { base: number; unit: string; at: number; end: number }[] = [];
  const re =
    /(\d{1,3}(?:[,٬]\d{3})+|\d+(?:\.\d+)?)\s*(k\b|m\b|million|thousand|ألف|الف|آلاف|مليون)?/gi;
  for (const m of latin.matchAll(re)) {
    const unit = (m[2] ?? "").toLowerCase();
    // A year ("since 2019") is not an amount.
    if (!unit && /^(19|20)\d\d$/.test(m[1])) continue;
    tokens.push({
      base: Number(m[1].replace(/[,٬]/g, "")),
      unit,
      at: m.index ?? 0,
      end: (m.index ?? 0) + m[0].length,
    });
  }
  // A range said as one ("between 180,000 and 260,000", "180k to 260k",
  // "بين ١٥ و٢٥ ألف": the first takes the second's unit) wins over amounts
  // said apart ("from 25,000 for the design ... between 180,000 and
  // 260,000"); else the first two amounts.
  for (let i = 0; i + 1 < tokens.length; i++) {
    const between = latin.slice(tokens[i].end, tokens[i + 1].at);
    if (
      !/^\s*(?:[A-Z]{3}\s*)?(?:to|and|-|–|—|إلى|الى|لين|حتى|و)\s*$/i.test(
        between,
      )
    )
      continue;
    const b = tokens[i + 1].base * scale(tokens[i + 1].unit);
    const a = tokens[i].base * scale(tokens[i].unit || tokens[i + 1].unit);
    if (a >= 1000 && b >= 1000)
      return [Math.round(Math.min(a, b)), Math.round(Math.max(a, b))];
  }
  const found: number[] = [];
  for (const t of tokens) {
    const n = Math.round(t.base * scale(t.unit));
    if (n >= 1000 && !found.includes(n)) found.push(n);
    if (found.length === 2) break;
  }
  if (!found.length) return null;
  return [Math.min(...found), Math.max(...found)];
}

/** A round number at or above n, for the tape's far end (1, 2, 2.5 or 5 times a power of ten). */
function niceCeil(n: number): number {
  const p = 10 ** Math.floor(Math.log10(n));
  for (const s of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10])
    if (s * p >= n) return s * p;
  return 10 * p;
}

/**
 * Where each mark sits on slide 7's tape (SPEC 5.3), as a share of its
 * length from 0: the tape runs from nothing to a round number past the
 * highest value, so the drawing says what the numbers say (an anchor
 * inside the typical range is drawn inside it). Nothing known: no marks.
 */
export function tapeMarks(v: {
  minimum: number | null;
  anchor: number | null;
  band: [number, number] | null;
}): {
  end: number;
  minimum: number | null;
  anchor: number | null;
  band: [number, number] | null;
} | null {
  const values = [v.minimum, v.anchor, ...(v.band ?? [])].filter(
    (x): x is number => typeof x === "number" && x > 0,
  );
  if (!values.length) return null;
  const top = Math.max(...values);
  // One amount alone (the minimum, typed first) sits a quarter of the way.
  const end = niceCeil(values.length === 1 ? top * 4 : top * 1.12);
  const at = (x: number | null) => (x == null ? null : x / end);
  return {
    end,
    minimum: at(v.minimum),
    anchor: at(v.anchor),
    band: v.band ? [v.band[0] / end, v.band[1] / end] : null,
  };
}

/** What was typed in an amount box: Arabic-Indic digits read, separators dropped. */
export function parseAmount(typed: string): number | null {
  const latin = typed
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[,٬\s]/g, "")
    .replace(/٫/g, ".");
  const k = /^(\d+(?:\.\d+)?)\s*(k|ألف|الف)$/i.exec(latin);
  if (k) return Math.round(Number(k[1]) * 1000);
  const n = Number(latin.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : null;
}

// ------------------------------------------------------------- dates

const HOUR = 3_600_000;

/** The working days after a moment, Saturday to Thursday (Kuwait's week). */
function workingDaysAfter(from: Date, n: number): Date {
  let t = from.getTime();
  let left = n;
  while (left > 0) {
    t += 24 * HOUR;
    if (new Date(t + 3 * HOUR).getUTCDay() !== 5) left -= 1;
  }
  return new Date(t);
}

/** The call's dates, as ISO moments (the date helpers read strings). */
export interface CallDates {
  /** The Blueprint call's start (the booking), else now. */
  call: string;
  /** The shot list's due date: the record's, else the call plus 72 hours. */
  shots: string;
  shotsFromRecord: boolean;
  /** The offer locks with them within 1 to 2 days: the second working day. */
  offer: string;
  /** The launch call, when it is booked. */
  launch: string | null;
}

export function callDates(
  answers: Answers,
  calls: {
    next: Partial<Record<string, string>>;
    last: Partial<Record<string, string>>;
  },
  now: Date,
): CallDates {
  const booked = calls.next.blueprint ?? calls.last.blueprint ?? null;
  const at = booked ? new Date(booked) : null;
  const sameDay =
    at && Math.abs(at.getTime() - now.getTime()) < 18 * HOUR ? at : null;
  const call = sameDay ?? now;
  const due =
    answers.shot_list === true && typeof answers.shot_list_due === "string"
      ? new Date(answers.shot_list_due)
      : null;
  return {
    call: call.toISOString(),
    shots: (due ?? new Date(call.getTime() + 72 * HOUR)).toISOString(),
    shotsFromRecord: Boolean(due),
    offer: workingDaysAfter(call, 2).toISOString(),
    launch: calls.next.launch ?? null,
  };
}

/** A moment's clock as "10:12", in Latin digits in both languages (the stamp's). */
export function hhmm(at: string, timeZone: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).formatToParts(d);
  const h = p.find(x => x.type === "hour")?.value ?? "";
  const m = p.find(x => x.type === "minute")?.value ?? "";
  return `${h === "24" ? "00" : h}:${m}`;
}

// ------------------------------------------------------------- the client's words

/** Up to four colours from the Brand DNA doc's text (#hex under its colours). */
export function brandColours(text: string | null | undefined): string[] {
  return brandPalette(text).map(c => c.hex);
}

/**
 * The Brand DNA doc's colours with the names the doc gives them ("- Sand
 * D9C8AD", "Sand: #D9C8AD"): up to four, in the doc's order. A colour with
 * no word before it on its line has no name (the chip shows its code only).
 */
export function brandPalette(
  text: string | null | undefined,
): { hex: string; name: string | null }[] {
  if (!text) return [];
  const at = text.search(/colou?rs?|palette|الألوان|ألوان/i);
  const scope = at >= 0 ? text.slice(at) : text;
  const out: { hex: string; name: string | null }[] = [];
  for (const line of scope.split(/\n/)) {
    for (const m of line.matchAll(/#?\b([0-9A-Fa-f]{6})\b/g)) {
      const hex = `#${m[1].toUpperCase()}`;
      if (out.some(c => c.hex === hex)) continue;
      const before = line
        .slice(0, m.index)
        .replace(/^[\s\-*•·]+/, "")
        .replace(/[\s:=#\-–(]+$/, "")
        .trim();
      const name =
        before &&
        before.length <= 20 &&
        !/\d/.test(before) &&
        !/colou?rs?|palette|الألوان|ألوان/i.test(before)
          ? before
          : null;
      out.push({ hex, name });
      if (out.length === 4) return out;
    }
  }
  return out;
}

/**
 * What the Brand DNA doc says about type, as written ("Type: a serif for
 * the wordmark, Geist for text"): the rest of its type line, or null.
 */
export function brandType(text: string | null | undefined): string | null {
  if (!text) return null;
  const m =
    /^\s*[-*•]?\s*(?:type|typefaces?|fonts?|typography|الخطوط|الخط)\s*[:：]\s*(.+)$/im.exec(
      text,
    );
  const v = m?.[1]?.trim().replace(/[.。]$/, "");
  return v && v.length <= 80 ? v : null;
}

/** Ink that reads on a colour chip: the paper on a dark one, the print on a light one. */
export function chipInk(hex: string): "light" | "dark" {
  const n = Number.parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.4 ? "dark" : "light";
}

/** The first sentence or line of an answer, for the read-back's one line. */
export function firstLine(text: unknown, max = 120): string | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const line = text
    .trim()
    .split(/\n|(?<=[.!?؟])\s/)[0]
    .trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:،\s]+$/, "")}…`;
}

/**
 * The first clause of their words, for a one-line table cell the client is
 * asked to approve: the first sentence, cut at its first clause boundary
 * (a comma, or " and ") when it is longer than `max`, never mid-clause and
 * never with an ellipsis. With no boundary, the whole first sentence (the
 * cell wraps).
 */
export function firstClause(text: unknown, max = 64): string | null {
  if (typeof text !== "string" || !text.trim()) return null;
  const line = text
    .trim()
    .split(/\n|(?<=[.!?؟])\s/)[0]
    .trim()
    .replace(/[.!?؟]$/, "");
  if (line.length <= max) return line;
  const at = [...line.matchAll(/,\s|،\s?|\s(?:and|but)\s|\sو(?=\S)/g)]
    .map(m => m.index ?? -1)
    .find(i => i >= 12);
  return at !== undefined ? line.slice(0, at).replace(/[,;:،\s]+$/, "") : line;
}

/** How the sheet's fold counts what it keeps off the screen (0: no fold). */
export function foldKey(n: number): "one" | "two" | "many" | null {
  return n <= 0 ? null : n === 1 ? "one" : n === 2 ? "two" : "many";
}

const str = (v: unknown) =>
  typeof v === "string" && v.trim() ? v.trim() : null;
export const lines = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && !!x.trim())
    : [];

/** The private part 1 answers kept off the slide (the fold's count). */
export function privateCount(a: Answers): number {
  return [
    "capacity",
    "pack_url",
    "daily_budget",
    "destination",
    "identity",
  ].filter(k => a[k] !== undefined && a[k] !== null).length;
}

/** The three frames on the wall: what each holds now. */
export function wallFilled(a: Answers): {
  words: boolean;
  look: boolean;
  offer: boolean;
} {
  const offer = (a.offer ?? {}) as Record<string, unknown>;
  const rules = (a.rules ?? {}) as Record<string, unknown>;
  return {
    words: Boolean(str(a.method)),
    look: Boolean(
      lines(rules.always).length ||
        lines(rules.never).length ||
        lines(rules.neverShow).length,
    ),
    offer: Boolean(str(offer.name) || str(offer.what) || str(offer.firstStep)),
  };
}
