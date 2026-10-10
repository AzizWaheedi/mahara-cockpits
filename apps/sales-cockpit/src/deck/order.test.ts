import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as proof from "./proof";
import { deckSlides } from "./slides";

/**
 * The deck's order after the CEO's 2026-10-10 notes: the prospect's numbers
 * at the end, right before the price, and our channels inside the proof,
 * as pages with no counts and nothing ringed.
 */

const slides = deckSlides();
const ids = slides.map(s => s.id);
const at = (id: string) => ids.indexOf(id);

/** A WebP's pixel size, read from its header (VP8, VP8L or VP8X). */
function webpSize(b: Uint8Array): { w: number; h: number } {
  const tag = (o: number, n: number) =>
    String.fromCharCode(...b.subarray(o, o + n));
  if (tag(0, 4) !== "RIFF" || tag(8, 4) !== "WEBP")
    throw new Error("not a WebP");
  const chunk = tag(12, 4);
  if (chunk === "VP8X")
    return {
      w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)),
      h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)),
    };
  if (chunk === "VP8 ")
    return {
      w: (b[26] | (b[27] << 8)) & 0x3fff,
      h: (b[28] | (b[29] << 8)) & 0x3fff,
    };
  if (chunk === "VP8L") {
    const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { w: 1 + (bits & 0x3fff), h: 1 + ((bits >>> 14) & 0x3fff) };
  }
  throw new Error(`unknown WebP chunk ${chunk}`);
}

describe("the deck's order", () => {
  test("still 36 slides", () => {
    expect(slides).toHaveLength(36);
  });

  test("our channels come right after the content slide, both in the proof", () => {
    expect(at("channels")).toBe(at("content") + 1);
    const proofSection = slides[at("content")].section;
    expect(proofSection.en).toBe("Partners' results");
    expect(slides[at("channels")].section).toEqual(proofSection);
    expect(slides[at("channels")].railAll).toBeUndefined();
  });

  test("the proof is one section, from the results to our channels", () => {
    const inProof = slides
      .map((s, i) => (s.section.en === "Partners' results" ? i : -1))
      .filter(i => i >= 0);
    expect(inProof[0]).toBe(at("results"));
    expect(inProof[inProof.length - 1]).toBe(at("channels"));
    expect(inProof[inProof.length - 1] - inProof[0] + 1).toBe(inProof.length);
  });

  test("their numbers come right before the investment, in the program", () => {
    expect(at("numbers")).toBe(at("investment") - 1);
    expect(at("numbers")).toBeGreaterThan(at("budget"));
    const numbers = slides[at("numbers")];
    expect(numbers.section).toEqual(slides[at("investment")].section);
    expect(numbers.section.en).toBe("The program");
    expect(numbers.railAll).toBe(true);
    expect(numbers.title).toEqual({ en: "Your numbers", ar: "أرقامك" });
  });

  test("every section's slides sit together, so the overview groups them in order", () => {
    const seen: string[] = [];
    for (const s of slides) {
      if (seen[seen.length - 1] === s.section.en) continue;
      expect(seen).not.toContain(s.section.en);
      seen.push(s.section.en);
    }
    expect(seen).toEqual([
      "Opening",
      "Partners' results",
      "Your situation",
      "The system",
      "The program",
    ]);
    expect(
      slides.filter(s => s.section.en === "Your situation").map(s => s.id),
    ).toEqual(["problem"]);
  });

  test("the cover opens and the close ends", () => {
    expect(ids[0]).toBe("cover");
    expect(ids[ids.length - 1]).toBe("close");
  });
});

describe("our channels", () => {
  test("no counts and nothing ringed: the profiles carry pages only", () => {
    expect(proof.PROFILES.map(p => p.key)).toEqual(["youtube", "instagram"]);
    for (const p of proof.PROFILES) {
      expect(p).not.toHaveProperty("figures");
      expect(p).not.toHaveProperty("spot");
      expect(p).not.toHaveProperty("note");
      // The alt text names what the page shows, not a number.
      expect(p.shot.alt).not.toMatch(/\d/);
      expect(p.bg).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect("PROFILES_AS_OF" in proof).toBe(false);
  });

  test("each picture's shape and width are its real pixel size", () => {
    for (const p of proof.PROFILES) {
      const size = webpSize(new Uint8Array(readFileSync(p.shot.src)));
      expect(p.shot.w).toBe(size.w);
      expect(p.shot.r).toBeCloseTo(size.w / size.h, 6);
    }
  });

  test("the deck sizes are kept: YouTube 1800 wide, Instagram 1500", () => {
    const w = Object.fromEntries(proof.PROFILES.map(p => [p.key, p.shot.w]));
    expect(w).toEqual({ youtube: 1800, instagram: 1500 });
  });

  test("the slide draws no figure, count-up or ring", () => {
    const src = readFileSync(new URL("./slides.tsx", import.meta.url), "utf8");
    const from = src.indexOf(
      "// --------------------------------------------------------- our channels",
    );
    const to = src.indexOf(
      "// ---------------------------------------------------------- the order",
    );
    expect(from).toBeGreaterThan(0);
    const part = src.slice(from, to);
    expect(part).toContain("function channelsSlide");
    for (const gone of [
      "<Fig",
      "sayCount",
      "count=",
      "dk-profile-ring",
      "figures",
    ])
      expect(part).not.toContain(gone);
    const css = readFileSync(new URL("./deck.css", import.meta.url), "utf8");
    for (const gone of [
      "dk-profile-ring",
      "dk-ring-in",
      "dk-ring-breathe",
      "dk-channel-fig",
    ])
      expect(css).not.toContain(gone);
  });
});
