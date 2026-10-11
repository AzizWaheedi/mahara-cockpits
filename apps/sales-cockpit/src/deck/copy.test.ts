import { describe, expect, test } from "bun:test";
import { inLang, LINKS, PROBLEMS } from "./content";
import { CLOSING_TOUR } from "./proof";

/**
 * The 2026-10-11 audit of the deck's copy: no figure off the approved list,
 * no line that promises a result (the guarantee rule), and the landing
 * pop-up asked for in the deck's language.
 */

describe("the deck's copy", () => {
  test("the academy names no close rate", () => {
    const academy = CLOSING_TOUR.find(s => s.key === "academy");
    expect(academy?.why).toEqual({
      en: "The frameworks and scripts our best partners use to close their proposals.",
      ar: "نفس الطرق والسكربتات اللي أنجح عملائنا يقفلون فيها عروضهم.",
    });
    for (const line of [academy?.why.en, academy?.why.ar])
      expect(line).not.toMatch(/[%٪]/);
  });

  test("the volume bridge says what it is built for, not a result", () => {
    const volume = PROBLEMS.find(p => p.key === "volume");
    expect(volume?.bridge).toEqual({
      en: "You close well. This is built to fill your calendar with qualified meetings.",
      ar: "انت تقفل زين.. هذا مبني عشان يترس جدولك بمواعيد مؤهلة.",
    });
  });

  test("the landing pop-up asks for the deck's language", () => {
    expect(inLang(LINKS.landing, "ar")).toBe(
      "https://diwan-landing-two.vercel.app/?lang=ar",
    );
    expect(inLang(LINKS.landing, "en")).toBe(
      "https://diwan-landing-two.vercel.app/?lang=en",
    );
    expect(inLang("https://example.com/p?lang=en&x=1", "ar")).toBe(
      "https://example.com/p?lang=ar&x=1",
    );
  });
});
