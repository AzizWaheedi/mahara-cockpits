import { describe, expect, test } from "bun:test";
import {
  type Asset,
  assetMessage,
  assetStage,
  objectionsFrom,
  shortlist,
} from "./assets";

const asset = (over: Partial<Asset>): Asset => ({
  id: over.slug ?? "x",
  slug: "x",
  title: "An asset",
  asset_type: "testimonial",
  send_when: null,
  stages: [],
  objections: [],
  industries: [],
  proof_types: [],
  language: "ar",
  what_it_proves: null,
  paste_message_ar: "شوف هذا",
  paste_message_en: "Have a look",
  does_not_cover: null,
  url: "https://example.com/a",
  duration_seconds: 60,
  published_at: "2026-08-01",
  is_canonical: true,
  sendable: true,
  send_count: 0,
  ...over,
});

describe("proof for a lead", () => {
  const library = [
    asset({
      slug: "explainer",
      objections: ["how_it_works"],
      proof_types: ["mechanism"],
      stages: ["pre_intro"],
    }),
    asset({
      slug: "result",
      objections: ["doubt_results", "trust_unknown"],
      proof_types: ["result"],
      stages: ["pre_demo"],
    }),
    asset({
      slug: "client",
      objections: ["doubt_results"],
      proof_types: ["social_proof"],
      stages: ["pre_demo"],
    }),
    asset({
      slug: "old",
      objections: ["doubt_results"],
      proof_types: ["result"],
      sendable: false,
    }),
    asset({
      slug: "copy",
      objections: ["doubt_results"],
      proof_types: ["result"],
      is_canonical: false,
    }),
    asset({
      slug: "english",
      objections: ["doubt_results"],
      proof_types: ["result"],
      language: "en",
    }),
  ];

  test("what answers their objection first, a real result before a client's word", () => {
    const out = shortlist(library, {
      objections: ["doubt_results"],
      stage: null,
      language: "ar",
    });
    expect(out.map(p => p.asset.slug)).toEqual(["result", "client"]);
    expect(out[0].why).toBe("A real result, not an explanation");
  });

  test("never what may not be sent, a copy, or the wrong language", () => {
    const slugs = shortlist(
      library,
      { objections: ["doubt_results"], stage: null, language: "ar" },
      10,
    ).map(p => p.asset.slug);
    expect(slugs).not.toContain("old");
    expect(slugs).not.toContain("copy");
    expect(slugs).not.toContain("english");
  });

  test("with no objection known, what fits their stage", () => {
    expect(
      shortlist(library, {
        objections: [],
        stage: "pre_intro",
        language: "ar",
      }).map(p => p.asset.slug),
    ).toEqual(["explainer"]);
  });

  test("the notes' objections in the library's words, nothing guessed", () => {
    expect(
      objectionsFrom([
        "It's too expensive for us right now",
        "Need to ask my partner",
      ]),
    ).toEqual(["price_too_high", "decision_maker"]);
    expect(objectionsFrom(["جربنا وكالة قبل وما نفعت"])).toEqual([
      "burned_before",
    ]);
    expect(objectionsFrom(["They liked the call"])).toEqual([]);
  });

  test("the stage from the pipeline stage's meaning", () => {
    expect(assetStage("intro_booked")).toBe("pre_intro");
    expect(assetStage("demo_booked")).toBe("pre_demo");
    expect(assetStage("nurture_long")).toBe("revival");
    expect(assetStage("other")).toBeNull();
  });

  test("the library's message carries the link once", () => {
    expect(assetMessage(asset({}), "ar")).toBe(
      "شوف هذا\nhttps://example.com/a",
    );
    expect(
      assetMessage(
        asset({ paste_message_en: "See https://example.com/a" }),
        "en",
      ),
    ).toBe("See https://example.com/a");
  });
});
