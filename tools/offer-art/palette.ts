/**
 * The deck's palette (CONTRACT 5.8) and the colour maths the grade and the
 * checks share: sRGB, linear light, OKLab and relative luminance.
 */

export type RGB = readonly [number, number, number];
export interface Lab {
  L: number;
  a: number;
  b: number;
}

export const PALETTE = {
  space: "#091333",
  deep: "#060d24",
  panel: "#0e1a42",
  teal: "#00cfc8",
  ink: "#f2f6fa",
  amber: "#f5b84b",
} as const;
export type PaletteName = keyof typeof PALETTE;

/** "#rrggbb" to sRGB in 0..1. */
export function hex(h: string): RGB {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
  if (!m) throw new Error(`Not a #rrggbb colour: ${h}`);
  return [
    Number.parseInt(m[1], 16) / 255,
    Number.parseInt(m[2], 16) / 255,
    Number.parseInt(m[3], 16) / 255,
  ];
}

export const toLinear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
export const toSrgb = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055;

/** Relative luminance (Rec. 709 primaries, linear light) of an sRGB colour. */
export function luminance(rgb: RGB): number {
  return (
    0.2126 * toLinear(rgb[0]) +
    0.7152 * toLinear(rgb[1]) +
    0.0722 * toLinear(rgb[2])
  );
}

/** Linear-light RGB to OKLab (Ottosson 2020). */
export function linearToOklab(r: number, g: number, b: number): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** OKLab to linear-light RGB, unclamped (may fall outside 0..1). */
export function oklabToLinear(lab: Lab): RGB {
  const l = (lab.L + 0.3963377774 * lab.a + 0.2158037573 * lab.b) ** 3;
  const m = (lab.L - 0.1055613458 * lab.a - 0.0638541728 * lab.b) ** 3;
  const s = (lab.L - 0.0894841775 * lab.a - 1.291485548 * lab.b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export const oklab = (rgb: RGB): Lab =>
  linearToOklab(toLinear(rgb[0]), toLinear(rgb[1]), toLinear(rgb[2]));

/** Hue angle in degrees, 0..360. */
export const hueOf = (lab: Pick<Lab, "a" | "b">) =>
  ((Math.atan2(lab.b, lab.a) * 180) / Math.PI + 360) % 360;
export const chromaOf = (lab: Pick<Lab, "a" | "b">) => Math.hypot(lab.a, lab.b);

/** Smallest signed difference between two hues, -180..180. */
export const hueDelta = (h: number, from: number) =>
  ((((h - from) % 360) + 540) % 360) - 180;

export const PAL: Record<PaletteName, Lab> = Object.fromEntries(
  Object.entries(PALETTE).map(([k, v]) => [k, oklab(hex(v))]),
) as Record<PaletteName, Lab>;

export const INK_Y = luminance(hex(PALETTE.ink));
