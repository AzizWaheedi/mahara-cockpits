import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ALL_CATALOG } from "../src/dev/offer/allFixtures";
import { emptyLive } from "../src/present/channel";
import { deckData } from "../src/present/deckData";
import {
  catalogPreviewModel,
  catalogQuickSlides,
} from "../src/present/offer/CatalogDeckCanvas";
import { deckOfOffer, OFFER_KEYS } from "../src/present/offer/kinds";
import { OfferCover } from "../src/present/offer/OfferCover";
import { copyOf } from "../src/present/offer/sources";

for (const key of OFFER_KEYS) {
  test(`${key}: immediate complete story has no client diagnosis or automatic quote`, async () => {
    const row = structuredClone(ALL_CATALOG[key]);
    const model = catalogPreviewModel(row);
    const slides = catalogQuickSlides(row, model);
    expect(slides.map(s => s.id)).toEqual(
      key === "website"
        ? ["matters", "get", "examples", "runs", "next"]
        : ["matters", "get", "runs", "next"],
    );
    expect(model.io).toBeUndefined();
    expect(model.prep).toEqual({});
    expect(model.goal).toBeNull();
    expect(model.captures).toEqual([]);
    expect(await model.savePitch({ presented_at: "2026-10-27" })).toBeNull();
    expect(model.pitch).toBeNull();
    for (const lang of ["en", "ar"] as const) {
      const d = deckData({
        taskId: "catalog-preview",
        deck: deckOfOffer(key),
        lang,
        sources: null,
        kit: null,
        prep: { onboarding: {}, launch: {} },
        ads: [],
        now: new Date(row.updatedAt),
      });
      const c = {
        d,
        lang,
        deck: deckOfOffer(key),
        prep: {},
        prepOf: () => ({}),
        save: () => {
          throw Error("No write in preview");
        },
        saveTo: () => {
          throw Error("No write in preview");
        },
        live: emptyLive(),
        setLive: () => {},
        still: true,
        presenting: true,
        offer: model,
        tour: 0,
        setTour: () => {},
      };
      for (const s of slides) {
        for (let tour = 0; tour < (s.stops?.(c) ?? 1); tour++) {
          const html = renderToStaticMarkup(s.render({ ...c, tour }));
          expect(html).not.toContain("<iframe");
          expect(html).not.toMatch(/You told us|you told us/);
          expect(html).not.toContain("dko-bill");
          expect(html.replace(/<[^>]*>/g, " ").trim().length).toBeGreaterThan(
            10,
          );
          expect(html).not.toMatch(
            /recruiter_name|opening_reason|presented_at/,
          );
        }
      }
    }
  });
  test(`${key}: list-price opt-in uses only real complete catalog values`, () => {
    const row = structuredClone(ALL_CATALOG[key]);
    const m = catalogPreviewModel(row);
    const canShow = key !== "closer" && !!m.opening && !m.priceProblem;
    expect(
      catalogQuickSlides(row, m, true).some(s => s.id === "investment"),
    ).toBe(canShow);
    row.parts.forEach(p => {
      p.amount = null;
    });
    expect(
      catalogQuickSlides(row, catalogPreviewModel(row), true).some(
        s => s.id === "investment",
      ),
    ).toBe(false);
    expect(catalogPreviewModel(row).opening).toBeNull();
  });
  test(`${key}: missing approved copy is not replaced with another offer`, () => {
    const row = { ...ALL_CATALOG[key], copy: {} };
    expect(catalogQuickSlides(row, catalogPreviewModel(row))).toEqual([]);
  });
}
test("the seven shelf objects have distinct service identities without invented results", () => {
  const html = OFFER_KEYS.map(key =>
    renderToStaticMarkup(
      <OfferCover offer={key} copy={copyOf(ALL_CATALOG[key], "en")} />,
    ),
  );
  expect(new Set(html).size).toBe(7);
  html.forEach(s => {
    expect(s).toContain('aria-hidden="true"');
    expect(s).not.toMatch(/revenue|guarantee|testimonial/);
  });
});
