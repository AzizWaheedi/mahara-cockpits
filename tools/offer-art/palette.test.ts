import { describe, expect, test } from "bun:test";
import {
  chromaOf,
  hex,
  hueDelta,
  hueOf,
  INK_Y,
  linearToOklab,
  luminance,
  oklab,
  oklabToLinear,
  PAL,
  PALETTE,
  toLinear,
  toSrgb,
} from "./palette";

describe("palette maths", () => {
  test("hex reads #rrggbb and refuses anything else", () => {
    expect(hex("#ff0000")).toEqual([1, 0, 0]);
    expect(hex("#091333")[2]).toBeCloseTo(0x33 / 255, 9);
    expect(() => hex("#fff")).toThrow();
    expect(() => hex("091333")).toThrow();
  });

  test("sRGB and linear light round-trip", () => {
    for (const c of [0, 0.02, 0.04045, 0.2, 0.5, 0.9, 1]) {
      expect(toSrgb(toLinear(c))).toBeCloseTo(c, 6);
    }
  });

  test("OKLab: white is L 1, black is L 0, and it round-trips", () => {
    expect(oklab([1, 1, 1]).L).toBeCloseTo(1, 4);
    expect(oklab([0, 0, 0]).L).toBeCloseTo(0, 9);
    for (const v of Object.values(PALETTE)) {
      const rgb = hex(v).map(toLinear);
      const back = oklabToLinear(linearToOklab(rgb[0], rgb[1], rgb[2]));
      back.forEach((c, i) => {
        expect(c).toBeCloseTo(rgb[i], 6);
      });
    }
  });

  test("the palette sits where the grade expects it", () => {
    // The ramp runs dark to light: Deep, Deep Space, Panel, Ink.
    expect(PAL.deep.L).toBeLessThan(PAL.space.L);
    expect(PAL.space.L).toBeLessThan(PAL.panel.L);
    expect(PAL.panel.L).toBeLessThan(PAL.ink.L);
    // Deep Space is a blue (OKLab hue near 265), Amber a warm, Teal a cyan.
    expect(Math.abs(hueDelta(hueOf(PAL.space), 265))).toBeLessThan(15);
    expect(Math.abs(hueDelta(hueOf(PAL.amber), 75))).toBeLessThan(15);
    expect(Math.abs(hueDelta(hueOf(PAL.teal), 190))).toBeLessThan(15);
    expect(chromaOf(PAL.ink)).toBeLessThan(0.01);
  });

  test("Ink is the brightest colour of the palette by luminance except Amber and Teal are below it", () => {
    expect(INK_Y).toBeCloseTo(luminance(hex(PALETTE.ink)), 12);
    for (const k of ["deep", "space", "panel", "teal", "amber"] as const) {
      expect(luminance(hex(PALETTE[k]))).toBeLessThan(INK_Y);
    }
  });

  test("hueDelta takes the short way round", () => {
    expect(hueDelta(10, 350)).toBeCloseTo(20, 9);
    expect(hueDelta(350, 10)).toBeCloseTo(-20, 9);
    expect(hueDelta(180, 0)).toBeCloseTo(-180, 9);
  });
});
