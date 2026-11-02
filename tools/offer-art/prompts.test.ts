import { describe, expect, test } from "bun:test";
import { SLOTS } from "./paths";
import {
  fullPrompt,
  loadPrompts,
  type PromptFile,
  promptFileProblems,
} from "./set";

const set = loadPrompts();
const ids = Object.keys(set.variants);

/** Words that would put a person (or a body part) in a picture. */
const PERSON =
  /\b(people|person|persons|man|men|woman|women|child|children|kid|kids|boy|girl|worker|workers|labourer|labourers|family|families|crowd|guest|guests|owner|owners|architect|architects|engineer|engineers|builder|builders|client|clients|customer|customers|figure|figures|silhouette|silhouettes|face|faces|portrait|hand|hands|body|bodies|human|humans)\b/gi;
/** Asks that make the AI-glossy look the set refuses. */
const GLOSS =
  /\b(glow|glowing|neon|bokeh|lens flare|bloom|god rays|light rays|cinematic|hyper-?realistic|8k|render|rendering|octane|unreal engine|luxury|stunning|breathtaking)\b/gi;
/** Brands and products that must never be drawn. */
const BRANDS = /\b(whatsapp|instagram|google|apple|iphone|samsung|mahara)\b/i;

/** Every hit of a pattern that is not inside a "no …" list. */
function unnegated(text: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.:;])\s+/)) {
    const negated = /^\s*(no\b|not\b|nothing\b|empty\b|linework only|never\b)/i.test(
      sentence,
    );
    for (const m of sentence.matchAll(re)) {
      const before = sentence.slice(0, m.index).toLowerCase();
      const local = /\b(no|not|never|without)\s+(\w+\s+){0,2}$/.test(before);
      if (!negated && !local) out.push(m[0]);
    }
  }
  return out;
}

describe("prompts.website.json", () => {
  test("is a valid prompt file", () => {
    expect(promptFileProblems(set)).toEqual([]);
  });

  test("draws with GPT Image 2.5 Sunburst at 16:9, high quality, 2k", () => {
    expect(set.model).toBe("marketing-studio/image/sunburst");
    expect(set.body).toEqual({
      resolution: "2k",
      quality: "high",
      aspect_ratio: "16:9",
    });
  });

  test("never asks for more than 12 pictures", () => {
    expect(set.cap).toBeLessThanOrEqual(12);
    expect(ids.length).toBeLessThanOrEqual(set.cap);
  });

  test("has a hero and three backgrounds, each with a choice", () => {
    for (const slot of SLOTS) {
      expect(ids.filter(id => set.variants[id].slot === slot).length).toBeGreaterThanOrEqual(2);
    }
  });

  test("every prompt says no people, no writing and no screens", () => {
    for (const id of ids) {
      const p = fullPrompt(set, id);
      expect(p).toMatch(/no people/);
      expect(p).toMatch(/no text/);
      expect(p).toMatch(/no screens/);
      expect(p).toMatch(/no logos/);
    }
  });

  test("no prompt names a person, a body or a brand", () => {
    for (const id of ids) {
      const p = fullPrompt(set, id);
      expect({ id, hits: unnegated(p, PERSON) }).toEqual({ id, hits: [] });
      expect({ id, brand: BRANDS.test(p) }).toEqual({ id, brand: false });
    }
  });

  test("no prompt asks for glow, gloss or a render", () => {
    for (const id of ids) {
      expect({ id, hits: unnegated(fullPrompt(set, id), GLOSS) }).toEqual({
        id,
        hits: [],
      });
    }
  });

  test("no em dash anywhere", () => {
    expect(JSON.stringify(set)).not.toContain("—");
  });

  test("the person check itself catches a person and lets a negation through", () => {
    expect(unnegated("A man stands at the gate.", PERSON)).toEqual(["man"]);
    expect(unnegated("Empty: no people, no hands.", PERSON)).toEqual([]);
    expect(unnegated("A house with no people in it.", PERSON)).toEqual([]);
  });

  test("a broken pick is named", () => {
    const bad: PromptFile = {
      ...set,
      picks: {
        hero: {
          from: "stone-a",
          crop: [0.6, 0, 0.6, 1],
          focus: "middle",
          quiet: "left",
          grain: 20,
          why: "",
        },
      },
    };
    const problems = promptFileProblems(bad).join(" | ");
    expect(problems).toContain("comes from a stone variant");
    expect(problems).toContain("crop outside the picture");
    expect(problems).toContain("focus");
    expect(problems).toContain("grain");
    expect(problems).toContain("does not say why");
  });
});
