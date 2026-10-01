/**
 * A paste's HTML, cleaned before the doc's editor reads it (RichDoc.tsx):
 * Google Docs' wrapper goes, and so does any style that would look wrong on
 * the cockpit's page. Black or white text would vanish on one of the two
 * themes, a font or a normal size would fight the doc's own type; bold,
 * italic, underline, a real colour, a size that means something and the
 * alignment stay. A highlight stays see-through so the words read on both.
 */

export function rgbOf(c: string): [number, number, number] | null {
  const s = c.trim().toLowerCase();
  if (s === "black" || s === "windowtext") return [0, 0, 0];
  if (s === "white") return [255, 255, 255];
  const hex = s.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    let h = hex[1];
    if (h.length <= 4) h = [...h.slice(0, 3)].map(x => x + x).join("");
    return [
      Number.parseInt(h.slice(0, 2), 16),
      Number.parseInt(h.slice(2, 4), 16),
      Number.parseInt(h.slice(4, 6), 16),
    ];
  }
  const rgb = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

/** Two spellings of one colour ("#00CFC8", "rgb(0, 207, 200)") match. */
export function sameColour(a: string | null, b: string): boolean {
  const x = a ? rgbOf(a) : null;
  const y = rgbOf(b);
  return Boolean(x && y && x.every((v, i) => Math.abs(v - y[i]) < 2));
}

function luminance(c: string): number | null {
  const rgb = rgbOf(c);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(v => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const NORMAL_SIZES = new Set([
  "10pt",
  "11pt",
  "12pt",
  "14.6667px",
  "16px",
  "1em",
  "100%",
  "medium",
]);

/**
 * One style declaration from a paste: kept when it carries meaning (bold,
 * italic, underline, a real colour, a size that is not the source's normal,
 * alignment); fonts, spacing, and black or white text, which would vanish
 * on one of the two pages, are left behind. A highlight is kept see-through.
 */
function keptDeclaration(decl: string): string | null {
  const i = decl.indexOf(":");
  if (i < 0) return null;
  const prop = decl.slice(0, i).trim().toLowerCase();
  const value = decl.slice(i + 1).trim();
  const v = value.toLowerCase().replace(/\s*!important$/, "");
  switch (prop) {
    case "font-weight":
    case "font-style":
    case "text-decoration":
    case "text-decoration-line":
    case "text-align":
      return `${prop}: ${v}`;
    case "font-size":
      return NORMAL_SIZES.has(v.replace(/\s+/g, "")) ? null : `${prop}: ${v}`;
    case "color": {
      const l = luminance(v);
      return l !== null && l > 0.18 && l < 0.9 ? `${prop}: ${v}` : null;
    }
    case "background-color": {
      const rgb = rgbOf(v);
      if (!rgb || /^rgba\(.*,\s*0(\.0+)?\s*\)$/.test(v)) return null;
      if (rgb.every(x => x > 238) || rgb.every(x => x < 24)) return null;
      return `${prop}: rgba(${rgb.join(", ")}, 0.35)`;
    }
    default:
      return null;
  }
}

/** A paste's HTML, cleaned before the editor reads it. */
export function cleanPasted(html: string): string {
  return html
    .replace(/<meta\b[^>]*>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<b\b[^>]*\bid="docs-internal-guid-[^"]*"[^>]*>/gi, "")
    .replace(/\sstyle="([^"]*)"/gi, (_m, css: string) => {
      const kept = css
        .replace(/&quot;/g, '"')
        .split(";")
        .map(d => keptDeclaration(d))
        .filter((d): d is string => Boolean(d));
      return kept.length ? ` style="${kept.join("; ")}"` : "";
    });
}
