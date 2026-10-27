import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  OFFER_FIXTURES,
  offerLoaded,
  offerModel,
} from "../src/dev/offer/fixtures";
import { emptyLive } from "../src/present/channel";
import type { SlideCtx } from "../src/present/deckContext";
import { deckData } from "../src/present/deckData";
import { WEBSITE_STOPS } from "../src/present/offer/content/website";
import { safeOfferWords } from "../src/present/offer/useOffer";
import { websiteSlides } from "../src/present/offer/websiteDeck";

function context(
  fixture: (typeof OFFER_FIXTURES)[number],
  lang: "en" | "ar",
): SlideCtx {
  const f = offerLoaded(fixture);
  const d = deckData({
    taskId: "fixture",
    deck: "offer_website",
    lang,
    sources: f.sources,
    kit: f.kit,
    prep: f.prep,
    ads: f.ads,
    videos: f.videos,
    now: new Date("2026-10-26"),
  });
  return {
    d,
    lang,
    deck: "offer_website",
    tour: 0,
    setTour: () => {},
    prep: f.prep.offer_website!,
    prepOf: () => ({}),
    save: () => {},
    saveTo: () => {},
    live: emptyLive(),
    setLive: () => {},
    still: true,
    presenting: true,
    offer: offerModel(f),
  };
}
describe("website canvas", () => {
  test("the main slides and stops retain the decided order", () => {
    expect(
      websiteSlides()
        .slice(0, 5)
        .map(s => s.id),
    ).toEqual(["saw", "matters", "get", "investment", "next"]);
    expect(WEBSITE_STOPS.get).toEqual([
      "drawn",
      "pages",
      "portfolio",
      "whatsapp",
      "form",
      "tracking",
      "care",
      "need",
    ]);
  });
  test("missing capture and price hide those slides", () => {
    const ctx = context("sparse", "en"),
      slides = websiteSlides(ctx.offer);
    expect(slides.find(s => s.id === "saw")!.defaultHidden!(ctx.d)).toBe(true);
    expect(slides.find(s => s.id === "investment")!.defaultHidden!(ctx.d)).toBe(
      false,
    );
    const empty = context("noprice", "en");
    expect(
      websiteSlides(empty.offer).find(s => s.id === "investment")!
        .defaultHidden!(empty.d),
    ).toBe(true);
  });
  for (const f of OFFER_FIXTURES)
    for (const lang of ["en", "ar"] as const)
      test(`${f}, ${lang}: every stop stays client-safe`, () => {
        const ctx = context(f, lang);
        for (const slide of websiteSlides(ctx.offer))
          for (let tour = 0; tour < (slide.stops?.(ctx) ?? 1); tour++) {
            const text = renderToStaticMarkup(
              slide.render({ ...ctx, tour }),
            ).replace(/<[^>]+>/g, " ");
            expect(text).not.toMatch(
              /\b(?:upsell|renewal|leads?|cpl|spend|budget|discount|guarantee)\b/i,
            );
            expect(text).not.toMatch(/booking|turn.?up|call cent(?:re|er)/i);
          }
      });
  test("final price cannot enter canvas, even after a lower price was logged", () => {
    const ctx = context("full", "en");
    ctx.offer!.pitch = {
      heldFull: true,
      finalPrice: { build: 1234, care: 167 },
    } as never;
    for (const lang of ["en", "ar"] as const)
      for (const slide of websiteSlides(ctx.offer))
        for (let tour = 0; tour < (slide.stops?.(ctx) ?? 1); tour++) {
          const html = renderToStaticMarkup(
            slide.render({ ...ctx, lang, tour }),
          );
          expect(html).not.toMatch(/1,234|1234|١٢٣٤|167|١٦٧/);
        }
  });
  test("unsafe raw goals are held off the shared canvas", () => {
    for (const v of [
      "30 leads this month",
      "CPL at $10",
      "A guaranteed result",
      "ميزانية جديدة",
    ])
      expect(safeOfferWords(v)).toBe(false);
    expect(safeOfferWords("Show our completed work clearly")).toBe(true);
  });
});

test("the project figure retains confirmed onboarding provenance and never parses a raw range", () => {
  const ctx = context("full", "en");
  const investment = websiteSlides(ctx.offer).find(s => s.id === "investment")!;
  const confirmed = renderToStaticMarkup(
    investment.render({ ...ctx, tour: 1 }),
  );
  expect(confirmed).toContain("18,000 KWD");
  expect(confirmed).toContain("Your answer, 2026-09-03");
  delete ctx.offer!.prep.project_value;
  ctx.offer!.sources.project.onboarding = {
    answer: "Between 15000 and 20000, depending on the work",
    answeredOn: "2026-09-03",
  };
  const unconfirmed = renderToStaticMarkup(
    investment.render({ ...ctx, tour: 1 }),
  );
  expect(unconfirmed).toContain("Your figure");
  expect(unconfirmed).not.toContain("17,500");
  expect(unconfirmed).not.toContain("Your answer, 2026-09-03");
});

test("Arabic record dates use Arabic-Indic digits", () => {
  const ctx = context("full", "ar");
  for (const id of ["saw", "matters", "investment"]) {
    const slide = websiteSlides(ctx.offer).find(s => s.id === id)!;
    const html = renderToStaticMarkup(
      slide.render({ ...ctx, tour: id === "investment" ? 1 : 0 }),
    );
    expect(html).toContain("٢٠٢٦-");
    expect(html).not.toContain("2026-");
  }
});

test("the full fixture keeps captures, images and project provenance consistent", () => {
  const f = offerLoaded("full");
  expect(f.offer!.site.verdict).toBe("broken");
  expect(decodeURIComponent(f.offer!.files[0].url!)).toContain("parked");
  expect(f.offer!.files[1].searchedAs).toBe("Kuwait City");
  expect(f.prep.offer_website!.example_stills).toHaveLength(3);
  expect(offerModel(f).stills).toHaveLength(3);
  expect(f.offer!.project.onboarding).toEqual({
    answer: "Our typical project is 18,000 KWD.",
    answeredOn: "2026-09-03",
  });
  const ctx = context("full", "en");
  const html = renderToStaticMarkup(
    websiteSlides(ctx.offer)
      .find(s => s.id === "investment")!
      .render({ ...ctx, tour: 1 }),
  );
  expect(html).toContain("2,000 USD + 200 USD × 12");
});
