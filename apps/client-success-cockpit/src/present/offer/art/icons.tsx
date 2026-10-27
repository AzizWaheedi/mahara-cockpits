import type { CSSProperties } from "react";

/**
 * The offer icons (docs/upsell-studio/ART.md, "Icons"): drawn by code as
 * drafting linework, the way a revision cloud is drawn on a drawing. One
 * line weight (1.5 on a 24 grid, so 3 px at 48 px, the cloud's own weight),
 * square ends, sharp corners, no fills, no circle behind any of them. The
 * conventions are a drawing's: a title-blocked sheet, a dimension line with
 * slash ticks, crop marks, a schedule, the revision delta, and the cloud.
 *
 * The same marks build the offer site's sprite (sites/offer/art/website/
 * icons.svg, written by tools/offer-art/sprite.ts and checked against this
 * file), so the deck, the proposal page and the film draw the same icon.
 */

export const OFFER_ICON_NAMES = [
  "pages",
  "portfolio",
  "whatsapp",
  "form",
  "tracking",
  "care",
  "logo",
  "photos",
  "services",
  "search",
  "cloud",
] as const;
export type OfferIconName = (typeof OFFER_ICON_NAMES)[number];
export type OfferIconTone = "ink" | "teal" | "leak";

export const ICON_GRID = 24;
export const ICON_STROKE = 1.5;

/** Ink for theirs, Teal for ours, Amber (leak) only for what we need. */
export const TONE_COLOR: Record<OfferIconTone, string> = {
  ink: "var(--dk-ink, #f2f6fa)",
  teal: "var(--dk-teal, #00cfc8)",
  leak: "var(--dk-leak, #f5b84b)",
};

/** Icons that point a way, mirrored in Arabic: the bubble's tail, the send arrow, the cloud's delta. */
export const MIRROR_IN_RTL: ReadonlySet<OfferIconName> = new Set([
  "whatsapp",
  "form",
  "cloud",
]);
export const FLIP = "matrix(-1 0 0 1 24 0)";

export type Mark = { d: string } | { cx: number; cy: number; r: number };

const n2 = (n: number) => String(Math.round(n * 100) / 100);
const rad = (deg: number) => (deg * Math.PI) / 180;

/** An arrowhead with its tip at (x, y), pointing along `deg`. */
function arrowHead(x: number, y: number, deg: number, len = 2.6): string {
  const back = deg + 180;
  const a = [
    x + len * Math.cos(rad(back - 38)),
    y + len * Math.sin(rad(back - 38)),
  ];
  const b = [
    x + len * Math.cos(rad(back + 38)),
    y + len * Math.sin(rad(back + 38)),
  ];
  return `M${n2(a[0])} ${n2(a[1])}L${n2(x)} ${n2(y)}L${n2(b[0])} ${n2(b[1])}`;
}

/** A clockwise arc (0 degrees is right, 90 is down) ending in an arrowhead. */
function cycle(
  cx: number,
  cy: number,
  r: number,
  from: number,
  to: number,
): Mark[] {
  const sx = cx + r * Math.cos(rad(from));
  const sy = cy + r * Math.sin(rad(from));
  const ex = cx + r * Math.cos(rad(to));
  const ey = cy + r * Math.sin(rad(to));
  const large = to - from > 180 ? 1 : 0;
  return [
    { d: `M${n2(sx)} ${n2(sy)}A${r} ${r} 0 ${large} 1 ${n2(ex)} ${n2(ey)}` },
    { d: arrowHead(ex, ey, to + 90) },
  ];
}

/**
 * A revision cloud round a rectangle: walked clockwise, each step an arc
 * that bulges outward, so the cusps point in, as on a drawing.
 */
export function cloudPath(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  step = 2.9,
): string {
  const pts: [number, number][] = [];
  const side = (ax: number, ay: number, bx: number, by: number) => {
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / step));
    for (let i = 0; i < n; i++) {
      pts.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n]);
    }
  };
  side(x0, y0, x1, y0);
  side(x1, y0, x1, y1);
  side(x1, y1, x0, y1);
  side(x0, y1, x0, y0);
  let d = `M${n2(pts[0][0])} ${n2(pts[0][1])}`;
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[(i + 1) % pts.length];
    const r = Math.hypot(x - pts[i][0], y - pts[i][1]) * 0.56;
    d += `A${n2(r)} ${n2(r)} 0 0 1 ${n2(x)} ${n2(y)}`;
  }
  return `${d}Z`;
}

export const ICON_MARKS: Record<OfferIconName, readonly Mark[]> = {
  // Two sheets, Arabic behind English; the front one ruled like a page.
  pages: [
    { d: "M8 6V3h12v15h-3" },
    { d: "M4 6h13v15H4z" },
    { d: "M7 10.5h7M7 13.5h7M7 16.5h4" },
  ],
  // A project shown large, with its photos underneath.
  portfolio: [
    { d: "M3 3.5h18v11H3z" },
    { d: "M5.5 12h13M8 12V7.5h5V12M13 12V9.5h3.5V12" },
    { d: "M3 17.5h5V21H3zM9.5 17.5h5V21h-5zM16 17.5h5V21h-5z" },
  ],
  // A message, one tap away (a plain bubble, never WhatsApp's own mark).
  whatsapp: [
    { d: "M3.5 4.5h17V16H10l-4.5 3.5V16h-2z" },
    { d: "M7 8.5h10M7 12h6" },
  ],
  // An enquiry form that sends.
  form: [
    { d: "M5 3h14v18H5z" },
    { d: "M8 6.5h8v3H8zM8 11.5h8v3H8z" },
    { d: "M8 18h6.5M13 16.5l1.5 1.5-1.5 1.5" },
  ],
  // A dimension line: what gets measured.
  tracking: [
    { d: "M4.5 5v14M19.5 5v14M4.5 12h15" },
    { d: "M3.25 13.25l2.5-2.5M18.25 13.25l2.5-2.5" },
    { d: "M9.5 8.75h5" },
  ],
  // Each month, round again, with the revision delta at its centre.
  care: [...cycle(12, 12, 7.75, -60, 240), { d: "M12 9l3 5.25H9z" }],
  // A mark in a frame: an arch, the Gulf's own doorway.
  logo: [
    { d: "M4 4h16v16H4z" },
    { d: "M9 16.5V12a3 3 0 0 1 6 0v4.5" },
    { d: "M7.5 16.5h9" },
  ],
  // Crop marks round a built thing under the sky.
  photos: [
    { d: "M3 7.5V3h4.5M16.5 3H21v4.5M21 16.5V21h-4.5M7.5 21H3v-4.5" },
    { d: "M6.5 16h11M8.5 16v-4.5h4V16" },
    { cx: 15.5, cy: 9, r: 1.5 },
  ],
  // A schedule: the list of services, ruled.
  services: [{ d: "M3 4.5h18v15H3z" }, { d: "M3 9.5h18M3 14.5h18M8.5 4.5v15" }],
  // A lens over a typed name.
  search: [
    { cx: 10.5, cy: 10.5, r: 6.25 },
    { d: "M15 15l5.5 5.5" },
    { d: "M7.75 10.5h5.5" },
  ],
  // The revision cloud and its delta.
  cloud: [{ d: cloudPath(3, 3.5, 17.5, 15) }, { d: "M19 16.25l3 5.25h-6z" }],
};

export interface OfferIconProps {
  name: OfferIconName;
  size?: number;
  tone?: OfferIconTone;
  /** Arabic pages pass "rtl": the icons that point a way mirror. */
  dir?: "ltr" | "rtl";
  /** A spoken name; without one the icon is hidden from screen readers. */
  label?: string;
  className?: string;
}

export function OfferIcon({
  name,
  size = 24,
  tone = "ink",
  dir = "ltr",
  label,
  className,
}: OfferIconProps) {
  const flip = dir === "rtl" && MIRROR_IN_RTL.has(name);
  const style: CSSProperties = { color: TONE_COLOR[tone], flexShrink: 0 };
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={ICON_STROKE}
      strokeLinecap="square"
      strokeLinejoin="miter"
      className={className}
      style={style}
      data-offer-icon={name}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {label ? <title>{label}</title> : null}
      <g transform={flip ? FLIP : undefined}>
        {ICON_MARKS[name].map((m, i) =>
          "d" in m ? (
            <path key={i} d={m.d} />
          ) : (
            <circle key={i} cx={m.cx} cy={m.cy} r={m.r} />
          ),
        )}
      </g>
    </svg>
  );
}

const SYMBOL_STYLE =
  'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"';

/** One icon as a sprite symbol (`<name>`, or `<name>-rtl` mirrored). */
export function iconSymbol(name: OfferIconName, flip = false): string {
  const body = ICON_MARKS[name]
    .map(m =>
      "d" in m
        ? `<path d="${m.d}"/>`
        : `<circle cx="${m.cx}" cy="${m.cy}" r="${m.r}"/>`,
    )
    .join("");
  const g = `<g ${SYMBOL_STYLE}${flip ? ` transform="${FLIP}"` : ""}>${body}</g>`;
  return `<symbol id="${name}${flip ? "-rtl" : ""}" viewBox="0 0 24 24">${g}</symbol>`;
}

/** The offer site's sprite: every icon, plus a mirrored copy of those that point. */
export function iconSprite(): string {
  const symbols: string[] = [];
  for (const name of OFFER_ICON_NAMES) {
    symbols.push(iconSymbol(name));
    if (MIRROR_IN_RTL.has(name)) symbols.push(iconSymbol(name, true));
  }
  return [
    '<svg xmlns="http://www.w3.org/2000/svg">',
    "<!-- Generated from apps/client-success-cockpit/src/present/offer/art/icons.tsx by tools/offer-art/sprite.ts. Do not edit by hand. -->",
    ...symbols,
    "</svg>",
    "",
  ].join("\n");
}
