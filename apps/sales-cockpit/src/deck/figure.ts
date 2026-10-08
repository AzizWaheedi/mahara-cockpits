/**
 * A figure as the deck writes it ("70+", "$1.32M+", "+١٫٣٢ مليون دولار",
 * "٣ لـ٤ أضعاف"), taken apart into what each piece is, so every figure on
 * every slide is set by one rule (fig.tsx) and its number can count up.
 *
 * The number rules (CEO, 2026-10-08: "make the numbers look better"):
 * - Arabic numbers are Arabic-Indic digits and never carry the Arabic
 *   thousands mark ٬ (IBM Plex draws it like a Latin comma, so ٢٬٨٥٥ read
 *   as 2,855 or as 2.855). Up to 9,999 there is no mark at all (٢٨٥٥); from
 *   10,000 up a narrow no-break space groups the digits (٦٢ ٣٤٦), and money
 *   that size keeps its words (٧٥ ألف دولار) through lib/funnel.ts.
 * - The decimal mark is Plex's own ٫, which then cannot be read as anything
 *   else inside a figure.
 * - A count starts at the smallest number with the final's digit count
 *   (١٠٠٠ for ٢٨٥٥, ١٫٠٠ for ١٫٣٢), so every frame has the same digits in
 *   the same places and no frame shows a lone zero (in Arabic, a lone dot).
 */

export type PartKind = "num" | "sign" | "link" | "unit" | "word";

export interface Part {
  kind: PartKind;
  /** The part as drawn: an "x" after a number is drawn as "×". */
  text: string;
  /** The source has a space between this part and the one before it. */
  space: boolean;
}

export const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const DIGIT = /[0-9٠-٩]/;

/** A narrow no-break space: groups the digits of a long Arabic number. */
export const GROUP = String.fromCharCode(0x202f);
const NBSP = String.fromCharCode(0xa0);

/**
 * A number: digits with . , ٫ or a narrow no-break space between digits,
 * and in English a $ right in front. A digit right after a letter is not a
 * number: it is the square of م٢ (the tatweel of لـ٤ is not a letter).
 */
const NUMBER = new RegExp(
  `\\$?(?<![A-Za-z\\u0621-\\u063F\\u0641-\\u064A])[0-9٠-٩]+(?:[.,٫${GROUP}][0-9٠-٩]+)*`,
  "g",
);

/** The word that joins the two ends of a range: "3 to 4x", "٣ لـ٤ أضعاف". */
const LINK = /^(to|لـ)$/;

export const isDigit = (c: string) => DIGIT.test(c);

/** The figure's parts, in reading order. A value with no digit is one word. */
export function parse(text: string): Part[] {
  const s = text.trim();
  const found = [...s.matchAll(NUMBER)];
  if (!found.length) return s ? [{ kind: "word", text: s, space: false }] : [];
  const out: Part[] = [];
  let gap = false;
  const put = (kind: PartKind, t: string) => {
    out.push({ kind, text: t, space: gap && out.length > 0 });
    gap = false;
  };
  /** The text between numbers (or before the first, or after the last). */
  const between = (seg: string, after: boolean, before: boolean) => {
    let rest = seg;
    // A sign touching the number before it: "70+", "21×", "4x".
    const lead = after ? /^(\+|~|[x×](?![A-Za-z]))/.exec(rest) : null;
    if (lead) {
      put("sign", lead[1] === "x" ? "×" : lead[1]);
      rest = rest.slice(lead[0].length);
    }
    // A sign touching the number after it: "+٧٠", "~$400".
    const next = before ? /[+~]$/.exec(rest) : null;
    if (next) rest = rest.slice(0, -1);
    // A plus closing the figure after its unit: "$1.32M+".
    const close = !before ? /(?<=\S)\+$/.exec(rest) : null;
    if (close) rest = rest.slice(0, -1);
    const core = rest.trim();
    if (/^\s/.test(rest) || (!core && /\s/.test(rest))) gap = true;
    if (core) {
      put(after && before && LINK.test(core) ? "link" : "unit", core);
      if (/\s$/.test(rest)) gap = true;
    }
    if (next) put("sign", next[0]);
    if (close) put("sign", "+");
  };
  let at = 0;
  found.forEach((m, i) => {
    const from = m.index ?? 0;
    between(s.slice(at, from), i > 0, true);
    put("num", m[0]);
    at = from + m[0].length;
  });
  between(s.slice(at), true, false);
  return out;
}

const western = (s: string) =>
  s.replace(/[٠-٩]/g, d => String(AR_DIGITS.indexOf(d)));

export interface Tally {
  /** Where the count starts, written like the final ("١٫٠٠" for "١٫٣٢"). */
  start: string;
  /** The number at `share` of the way from the start (0 to 1). */
  at: (share: number) => string;
  /** False when there is nothing to count (a 1, a 0, a 100). */
  moves: boolean;
}

/**
 * How one number counts up. Every frame keeps the final's digit count and
 * marks: k whole digits start at 10^(k-1) (١٠٠ for ١٥٨, 1,000 for 2,855),
 * a single whole digit at 1 with the same places (1.00 for 1.32), and a
 * number ending in zeros counts in steps of them (70: 10, 20 ... 70).
 */
export function tally(num: string): Tally {
  const arabic = /[٠-٩]/.test(num);
  const decimal = arabic ? "٫" : ".";
  const mark = num.lastIndexOf(decimal);
  const whole = western(mark < 0 ? num : num.slice(0, mark)).replace(/\D/g, "");
  const frac = mark < 0 ? "" : western(num.slice(mark + 1)).replace(/\D/g, "");
  const places = frac.length;
  const value = Number(frac ? `${whole}.${frac}` : whole);
  const k = whole.replace(/^0+(?=\d)/, "").length;
  const start = k >= 2 ? 10 ** (k - 1) : Math.min(value, 1);
  const zeros = places ? 0 : (/0+$/.exec(whole)?.[0].length ?? 0);
  const step = zeros && zeros < whole.length ? 10 ** zeros : 0;
  const count = [...num].filter(isDigit).length;
  /** A value written into the final's own places, digits and marks. */
  const write = (v: number) => {
    const ds = [...v.toFixed(places).replace(".", "")];
    while (ds.length < count) ds.unshift("0");
    let i = ds.length - count;
    return [...num]
      .map(c => {
        if (!isDigit(c)) return c;
        const d = ds[i++];
        return arabic ? AR_DIGITS[Number(d)] : d;
      })
      .join("");
  };
  const moves = Number.isFinite(value) && value > start;
  return {
    start: moves ? write(start) : num,
    moves,
    at: share => {
      if (!moves || share >= 1) return num;
      let v = start + (value - start) * Math.max(0, share);
      v = step
        ? Math.round(v / step) * step
        : Math.round(v * 10 ** places) / 10 ** places;
      return write(Math.min(value, Math.max(start, v)));
    },
  };
}

/**
 * The whole figure at `share` of its count: its numbers counted, its signs,
 * links and units as written from the first frame.
 */
export function figureAt(text: string, share: number): string {
  if (share >= 1) return text;
  let out = "";
  let at = 0;
  for (const m of text.matchAll(NUMBER)) {
    const from = m.index ?? 0;
    out += text.slice(at, from) + tally(m[0]).at(share);
    at = from + m[0].length;
  }
  return out + text.slice(at);
}

/**
 * Keeps a number on the same line as what it counts: the space after a
 * digit, ٪ or %, and after ألف، آلاف، مليون، ملايين following a number,
 * becomes a no-break space ("١٢٫٤ مليون دولار", "٣٠ يوم", "٥ دقايق").
 */
export function hold(s: string): string {
  return s
    .replace(/([0-9٠-٩%٪]) (?=\S)/g, `$1${NBSP}`)
    .replace(
      new RegExp(`([0-9٠-٩]${NBSP}(?:ألف|آلاف|مليون|ملايين)) (?=\\S)`, "g"),
      `$1${NBSP}`,
    );
}
