// Fictional client and prices; approved catalog copy and explicitly supplied actor examples.

import { deckOfOffer, type OfferKey } from "../../present/offer/kinds";
import type { CatalogRow } from "../../present/offer/sources";
import catalog from "./allCatalog.json";
import { type OfferFixture, offerLoaded, offerModel } from "./fixtures";
export const ALL_CATALOG = catalog as Record<OfferKey, CatalogRow>;
export function allOfferLoaded(key: OfferKey, fixture: OfferFixture = "full") {
  const out = offerLoaded(fixture);
  if (key === "website") return out;
  const deck = deckOfOffer(key);
  const src = out.offer!;
  const row = structuredClone(ALL_CATALOG[key]);
  if (fixture === "noprice")
    row.parts.forEach(p => {
      p.amount = null;
    });
  const prep = { ...out.prep.offer_website! };
  delete prep.opening_price;
  delete prep.opening_reason;
  if (key === "closer" && fixture !== "sparse")
    prep.recruiter_name = "Fictional recruiter";
  src.catalog = src.mode === "refused" ? null : row;
  src.prep = { ...src.prep!, overrides: prep };
  if (fixture !== "sparse")
    src.goals.goal90 = { answer: row.copy.en!.line, answeredOn: "2026-10-10" };
  src.waitsOn =
    key === "closer" && !prep.recruiter_name
      ? "Needs a named recruiter."
      : null;
  out.prep = { ...out.prep, [deck]: prep };
  out.videos = { ...out.videos!, rows: [], slots: [`${deck}:demo`] };
  return out;
}
export function allOfferModel(key: OfferKey, fixture: OfferFixture = "full") {
  const out = allOfferLoaded(key, fixture);
  const deck = deckOfOffer(key);
  return offerModel({
    ...out,
    prep: { ...out.prep, offer_website: out.prep[deck] },
  });
}
