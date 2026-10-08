/**
 * A figure as the deck writes it ("70+", "$1.32M+", "+١٫٣٢ مليون دولار"),
 * taken apart so it can count up: the words around the number stay, and
 * the number is written back in the same digits, decimal mark and places.
 */
export interface Figure {
  /** The figure with its number at `share` of the way from zero (0 to 1). */
  at: (share: number) => string;
}

const ARABIC = "٠١٢٣٤٥٦٧٨٩";
const NUMBER = /([0-9٠-٩]+)(?:([.٫])([0-9٠-٩]+))?/;

const western = (s: string) =>
  s.replace(/[٠-٩]/g, d => String(ARABIC.indexOf(d)));

/** The figure's parts, or null when it holds no number to count. */
export function figure(text: string): Figure | null {
  const m = NUMBER.exec(text);
  if (!m) return null;
  const [whole, int, mark = "", frac = ""] = m;
  const arabic = /[٠-٩]/.test(whole);
  const value = Number(western(frac ? `${int}.${frac}` : int));
  const before = text.slice(0, m.index);
  const after = text.slice(m.index + whole.length);
  return {
    at: share => {
      if (share >= 1) return text;
      let n = (value * Math.max(0, share)).toFixed(frac.length);
      if (mark) n = n.replace(".", mark);
      if (arabic) n = n.replace(/[0-9]/g, d => ARABIC[Number(d)]);
      return `${before}${n}${after}`;
    },
  };
}
