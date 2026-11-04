/**
 * The grade: every picture of the set mapped onto the deck's own palette
 * (ART.md, "The grade"), by one 3D LUT that ffmpeg applies.
 *
 * A split tone on the palette. Lightness runs from Deep at the black point
 * to just under Ink at the white point, so nothing is ever brighter than
 * Ink. The shadows take the palette's navy (Deep, Deep Space, Panel); lit
 * tones keep their own colour, muted, but only three colours survive, each
 * turned onto its palette hue: warm light onto Amber, lit water onto Teal,
 * sky and blue shade onto Deep Space. Every other colour (a green leaf, a
 * red sign) goes grey. No bloom, no vignette, no gradient laid over: the
 * LUT moves colours, it adds nothing. (A first pass that washed every tone
 * navy read as a blue filter, 26 Oct; this replaced it.)
 *
 *   bun grade.ts            writes grade.cube and a graded master per pick
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  chromaOf,
  hueDelta,
  hueOf,
  INK_Y,
  type Lab,
  linearToOklab,
  oklabToLinear,
  PAL,
  type RGB,
  toLinear,
  toSrgb,
} from "./palette";
import { CUBE, DIRS, SLOTS } from "./paths";
import { probe, run } from "./run";
import { loadPrompts, type Pick } from "./set";

export const GRADE = {
  /** Input lightness (OKLab L) that lands on Deep. */
  inBlack: 0.06,
  /** Input lightness that lands on the ceiling. */
  inWhite: 0.97,
  /** Above 1 keeps the middle tones low: these are night pictures. */
  gamma: 1.1,
  /** Share of a smoothstep S-curve mixed in: a soft toe and shoulder. */
  sMix: 0.3,
  /** The brightest a pixel gets: a hair under Ink (webp ringing stays under). */
  ceilingL: PAL.ink.L - 0.012,
  /** The ramp's navy is whole below this output lightness... */
  shadowFrom: 0.22,
  /** ...and gone above this one, so lit stone keeps its own colour. */
  shadowTo: 0.5,
  /** Above this, every colour fades to Ink's own near-white. */
  highFrom: 0.86,
  /**
   * The only colours a picture keeps, each turned onto its palette hue:
   * warm light onto Amber, lit water onto Teal, sky and blue shadow onto
   * Deep Space. `keep` is the share of the picture's own chroma kept, `max`
   * the most allowed, as a share of the palette colour's own chroma, and
   * `lit` the output lightness over which the colour fades in (warm timber
   * keeps its warmth from quite dark; water only once it is lit). `from`
   * and `width` say which of the picture's hues the band takes: the warm
   * band reaches down to red-brown timber, and turns it all onto Amber.
   */
  bands: {
    amber: { hue: hueOf(PAL.amber), from: 55, width: 52, keep: 0.7, max: 0.4, lit: [0.1, 0.26] },
    teal: { hue: hueOf(PAL.teal), from: hueOf(PAL.teal), width: 35, keep: 0.75, max: 0.7, lit: [0.2, 0.4] },
    navy: { hue: hueOf(PAL.space), from: hueOf(PAL.space), width: 55, keep: 0.9, max: 1.2, lit: null },
  },
  /** LUT points per side: 65 keeps the dark end (where hue turns fast) true. */
  cubeSize: 65,
} as const;

/** The palette ramp, darkest first. */
const RAMP: readonly Lab[] = [PAL.deep, PAL.space, PAL.panel, PAL.ink];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
/** 1 at the centre hue, 0 from `width` degrees away, cos² between. */
const bell = (h: number, centre: number, width: number) => {
  const d = Math.abs(hueDelta(h, centre));
  return d >= width ? 0 : Math.cos(((d / width) * Math.PI) / 2) ** 2;
};

/** The output lightness for an input lightness (monotonic). */
export function toneCurve(L: number): number {
  const x = clamp01((L - GRADE.inBlack) / (GRADE.inWhite - GRADE.inBlack));
  const t0 = x ** GRADE.gamma;
  const s = t0 * t0 * (3 - 2 * t0);
  const t = t0 + (s - t0) * GRADE.sMix;
  return RAMP[0].L + (GRADE.ceilingL - RAMP[0].L) * t;
}

/** The ramp's own colour (a, b) at an output lightness. */
export function rampAB(L: number): { a: number; b: number } {
  if (L <= RAMP[0].L) return { a: RAMP[0].a, b: RAMP[0].b };
  for (let i = 0; i < RAMP.length - 1; i++) {
    const lo = RAMP[i];
    const hi = RAMP[i + 1];
    if (L <= hi.L) {
      let t = (L - lo.L) / (hi.L - lo.L);
      return { a: lo.a + (hi.a - lo.a) * t, b: lo.b + (hi.b - lo.b) * t };
    }
  }
  const top = RAMP[RAMP.length - 1];
  return { a: top.a, b: top.b };
}

/** The largest share of (a, b) that stays inside sRGB at lightness L. */
function inGamut(L: number, a: number, b: number): RGB {
  const fits = (k: number) =>
    oklabToLinear({ L, a: a * k, b: b * k }).every(
      c => c >= -1e-6 && c <= 1 + 1e-6,
    );
  if (fits(1)) return oklabToLinear({ L, a, b });
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  return oklabToLinear({ L, a: a * lo, b: b * lo });
}

/** One sRGB colour (0..1) through the grade. */
export function gradeColor(rgb: RGB): RGB {
  const lin = rgb.map(c => toLinear(clamp01(c))) as unknown as RGB;
  const src = linearToOklab(lin[0], lin[1], lin[2]);
  const L = toneCurve(src.L);
  const C = chromaOf(src);
  const h = hueOf(src);
  // A colour with almost no chroma has no meaningful hue: it keeps none.
  const sure = smoothstep(0.008, 0.03, C);
  const shadow = 1 - smoothstep(GRADE.shadowFrom, GRADE.shadowTo, L);

  let a = 0;
  let b = 0;
  let navyW = 0;
  let warmW = 0;
  let bandW = 0;
  for (const [name, band] of Object.entries(GRADE.bands)) {
    const lit = band.lit ? smoothstep(band.lit[0], band.lit[1], L) : 1;
    const w = bell(h, band.from, band.width) * sure * lit;
    bandW += bell(h, band.from, band.width);
    if (w === 0) continue;
    const own = name === "amber" ? PAL.amber : name === "teal" ? PAL.teal : PAL.space;
    const c = Math.min(C * band.keep, chromaOf(own) * band.max) * w;
    const r = (band.hue * Math.PI) / 180;
    a += Math.cos(r) * c;
    b += Math.sin(r) * c;
    if (name === "navy") navyW = w;
    if (name === "amber") warmW = w;
  }
  // Shadows take the ramp's navy, unless the picture's own blue (or a warm
  // material, timber or lit stone) is there. Any other coloured thing (a
  // shrub) takes a fifth of the navy and goes a dark grey, not blue.
  const ramp = rampAB(L);
  const other = sure * Math.max(0, 1 - bandW);
  const own = 1 - Math.min(1, Math.max(navyW, warmW * 1.5, other * 0.8));
  a += ramp.a * shadow * own;
  b += ramp.b * shadow * own;
  // The top end settles on Ink's own colour.
  const high = smoothstep(GRADE.highFrom, GRADE.ceilingL, L);
  a = a * (1 - high) + PAL.ink.a * high;
  b = b * (1 - high) + PAL.ink.b * high;

  let out = inGamut(L, a, b).map(c => clamp01(c)) as unknown as RGB;
  const Y = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
  if (Y > INK_Y) out = out.map(c => (c * INK_Y) / Y) as unknown as RGB;
  return out.map(c => clamp01(toSrgb(c))) as unknown as RGB;
}

/** The grade as an Adobe .cube 3D LUT (red changes fastest). */
export function cube(size: number = GRADE.cubeSize): string {
  const lines = [
    'TITLE "Mahara offer art: deep space grade"',
    `LUT_3D_SIZE ${size}`,
    "DOMAIN_MIN 0.0 0.0 0.0",
    "DOMAIN_MAX 1.0 1.0 1.0",
  ];
  const n = size - 1;
  for (let b = 0; b <= n; b++) {
    for (let g = 0; g <= n; g++) {
      for (let r = 0; r <= n; r++) {
        const o = gradeColor([r / n, g / n, b / n]);
        lines.push(o.map(v => v.toFixed(6)).join(" "));
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

/** The ffmpeg filter that cuts and grades one pick. */
export function gradeFilter(
  pick: Pick,
  dims: { width: number; height: number },
  cubePath = CUBE,
): string {
  const [x, y, w, h] = pick.crop;
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  const cw = even(dims.width * w);
  const ch = even(dims.height * h);
  const cx = Math.min(Math.round(dims.width * x), dims.width - cw);
  const cy = Math.min(Math.round(dims.height * y), dims.height - ch);
  const parts = [`crop=${cw}:${ch}:${cx}:${cy}`];
  if (pick.flip) parts.push("hflip");
  parts.push(
    "format=rgb48le",
    `lut3d=file='${cubePath}':interp=tetrahedral`,
    "format=rgb24",
  );
  return parts.join(",");
}

/** The drawn file of a variant, whatever its extension. */
export function rawFile(variant: string, dir = DIRS.raw): string | null {
  if (!existsSync(dir)) return null;
  const hit = readdirSync(dir).find(f => f.startsWith(`${variant}.`));
  return hit ? join(dir, hit) : null;
}

async function main() {
  const set = loadPrompts();
  for (const d of Object.values(DIRS)) mkdirSync(d, { recursive: true });
  writeFileSync(CUBE, cube());
  console.log(`grade: wrote ${CUBE}`);
  for (const slot of SLOTS) {
    const pick = set.picks[slot];
    if (!pick) {
      console.log(
        `grade: no pick yet for ${slot}. Look at review/raw-sheet.jpg, then name one under picks in prompts.website.json.`,
      );
      continue;
    }
    const raw = rawFile(pick.from);
    if (!raw) {
      console.log(
        `grade: ${pick.from} has not been drawn yet. Run bun higgsfield.ts --only ${pick.from}.`,
      );
      continue;
    }
    const out = join(DIRS.master, `${slot}.png`);
    const vf = gradeFilter(pick, await probe(raw));
    await run(
      ["ffmpeg", "-y", "-v", "error", "-i", raw, "-vf", vf, "-frames:v", "1", out],
      `Grading ${slot}`,
    );
    const d = await probe(out);
    console.log(`grade: ${slot} <- ${pick.from}, ${d.width}x${d.height}`);
  }
}

if (import.meta.main) await main();
