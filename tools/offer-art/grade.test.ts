import { describe, expect, test } from "bun:test";
import { cube, GRADE, gradeColor, gradeFilter, rampAB, toneCurve } from "./grade";
import {
  chromaOf,
  hex,
  hueDelta,
  hueOf,
  INK_Y,
  luminance,
  oklab,
  PAL,
  PALETTE,
  type RGB,
} from "./palette";

const grid = (n: number) => {
  const out: RGB[] = [];
  for (let r = 0; r < n; r++)
    for (let g = 0; g < n; g++)
      for (let b = 0; b < n; b++)
        out.push([r / (n - 1), g / (n - 1), b / (n - 1)]);
  return out;
};
const graded = (h: string) => oklab(gradeColor(hex(h)));

describe("the grade", () => {
  test("black lands on Deep", () => {
    const o = oklab(gradeColor([0, 0, 0]));
    expect(Math.abs(o.L - PAL.deep.L)).toBeLessThan(0.002);
    expect(Math.abs(o.a - PAL.deep.a)).toBeLessThan(0.003);
    expect(Math.abs(o.b - PAL.deep.b)).toBeLessThan(0.003);
  });

  test("white lands just under Ink, never above it", () => {
    const y = luminance(gradeColor([1, 1, 1]));
    expect(y).toBeLessThanOrEqual(INK_Y);
    expect(y).toBeGreaterThan(INK_Y * 0.9);
  });

  test("no colour at all comes out brighter than Ink, and every channel stays in 0..1", () => {
    for (const c of grid(17)) {
      const o = gradeColor(c);
      expect(luminance(o)).toBeLessThanOrEqual(INK_Y + 1e-9);
      for (const v of o) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  test("tones keep their order: a grey ramp never gets darker as it gets lighter", () => {
    let last = -1;
    for (let i = 0; i <= 64; i++) {
      const L = oklab(gradeColor([i / 64, i / 64, i / 64])).L;
      expect(L).toBeGreaterThanOrEqual(last - 1e-9);
      last = L;
    }
    let lastT = -1;
    for (let i = 0; i <= 100; i++) {
      const t = toneCurve(i / 100);
      expect(t).toBeGreaterThanOrEqual(lastT);
      lastT = t;
    }
    expect(toneCurve(1)).toBeCloseTo(GRADE.ceilingL, 9);
  });

  test("dark greys turn the deck's navy, not neutral and not purple", () => {
    for (const g of ["#202020", "#303030", "#404040"]) {
      const o = graded(g);
      expect(chromaOf(o)).toBeGreaterThan(0.015);
      expect(Math.abs(hueDelta(hueOf(o), hueOf(PAL.space)))).toBeLessThan(20);
    }
  });

  test("light greys stay near neutral: lit stone is not washed blue", () => {
    for (const g of ["#b0b0b0", "#d0d0d0"]) {
      expect(chromaOf(graded(g))).toBeLessThan(0.015);
    }
  });

  test("a dusk sky stays a deep navy", () => {
    for (const s of ["#23365e", "#3a5a8c"]) {
      const o = graded(s);
      expect(Math.abs(hueDelta(hueOf(o), hueOf(PAL.space)))).toBeLessThan(20);
      expect(chromaOf(o)).toBeGreaterThan(0.03);
      expect(chromaOf(o)).toBeLessThanOrEqual(chromaOf(PAL.space) * 1.25);
    }
  });

  test("a warm lamp keeps a muted amber, never more than Amber's own chroma", () => {
    for (const w of ["#d9822b", "#e6a24a", "#c8964f"]) {
      const o = graded(w);
      expect(Math.abs(hueDelta(hueOf(o), hueOf(PAL.amber)))).toBeLessThan(25);
      expect(chromaOf(o)).toBeLessThanOrEqual(chromaOf(PAL.amber) * 0.6);
    }
  });

  test("lit water keeps a share of Teal", () => {
    for (const w of ["#1fbfc9", "#2ad0d6", "#18a9b5"]) {
      const o = graded(w);
      expect(Math.abs(hueDelta(hueOf(o), hueOf(PAL.teal)))).toBeLessThan(25);
      expect(chromaOf(o)).toBeLessThanOrEqual(chromaOf(PAL.teal) * 0.8);
    }
  });

  test("off-palette colours lose their colour: magenta and green go grey, red goes a muted warm", () => {
    for (const c of ["#b03ab0", "#3aa83a"]) {
      expect(chromaOf(graded(c))).toBeLessThan(0.03);
    }
    const red = graded("#c0392b");
    expect(Math.abs(hueDelta(hueOf(red), hueOf(PAL.amber)))).toBeLessThan(10);
    expect(chromaOf(red)).toBeLessThan(0.04);
  });

  test("the darkest tones stay navy, even under a warm or cyan cast", () => {
    for (const c of ["#0d0804", "#06100f", "#0b0b0b"]) {
      const o = graded(c);
      expect(Math.abs(hueDelta(hueOf(o), hueOf(PAL.space)))).toBeLessThan(25);
    }
  });

  test("dark timber keeps a hint of its own warmth instead of turning navy", () => {
    for (const c of ["#210d01", "#2b1202", "#3a2208"]) {
      const o = graded(c);
      const warm = Math.abs(hueDelta(hueOf(o), hueOf(PAL.amber))) < 40;
      expect(warm || chromaOf(o) < 0.02).toBe(true);
    }
  });

  test("the ramp passes through the palette's own colours", () => {
    for (const k of ["deep", "space", "panel"] as const) {
      const ab = rampAB(PAL[k].L);
      expect(ab.a).toBeCloseTo(PAL[k].a, 6);
      expect(ab.b).toBeCloseTo(PAL[k].b, 6);
    }
    expect(PALETTE.space).toBe("#091333");
  });
});

describe("the .cube file", () => {
  test("has the header, size³ rows, and red changing fastest", () => {
    const text = cube(5);
    const lines = text.trim().split("\n");
    expect(lines[1]).toBe("LUT_3D_SIZE 5");
    expect(lines[2]).toBe("DOMAIN_MIN 0.0 0.0 0.0");
    expect(lines[3]).toBe("DOMAIN_MAX 1.0 1.0 1.0");
    const rows = lines.slice(4);
    expect(rows).toHaveLength(125);
    const at = (r: number, g: number, b: number) =>
      rows[b * 25 + g * 5 + r].split(" ").map(Number);
    const red = gradeColor([1, 0, 0]);
    at(4, 0, 0).forEach((v, i) => {
      expect(v).toBeCloseTo(red[i], 5);
    });
    const blue = gradeColor([0, 0, 1]);
    at(0, 0, 4).forEach((v, i) => {
      expect(v).toBeCloseTo(blue[i], 5);
    });
  });
});

describe("the ffmpeg filter", () => {
  test("cuts, mirrors when asked, then applies the LUT in 16-bit", () => {
    const vf = gradeFilter(
      {
        from: "hero-a",
        crop: [0.04, 0, 0.94, 0.94],
        flip: true,
        focus: "70% 50%",
        quiet: "left",
        grain: 3,
        why: "test pick",
      },
      { width: 2048, height: 1152 },
      "/m/grade.cube",
    );
    expect(vf).toBe(
      "crop=1924:1082:82:0,hflip,format=rgb48le,lut3d=file='/m/grade.cube':interp=tetrahedral,format=rgb24",
    );
  });

  test("a crop never runs off the picture", () => {
    const vf = gradeFilter(
      {
        from: "x-a",
        crop: [0.5, 0.5, 0.5, 0.5],
        focus: "50% 50%",
        quiet: "left",
        grain: 0,
        why: "edge case",
      },
      { width: 1001, height: 501 },
      "/c",
    );
    const [w, h, x, y] = /crop=(\d+):(\d+):(\d+):(\d+)/
      .exec(vf)!
      .slice(1)
      .map(Number);
    expect(x + w).toBeLessThanOrEqual(1001);
    expect(y + h).toBeLessThanOrEqual(501);
  });
});
