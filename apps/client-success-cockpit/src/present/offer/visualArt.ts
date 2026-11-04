import construction from "../assets/examples/construction-feed.webp";
import office from "../assets/examples/office-feed.webp";
import pool from "../assets/examples/pool-story.webp";
import villa from "../assets/examples/villa-story.webp";
import { ART } from "./art";
import type { OfferKey } from "./kinds";

// Existing Mahara-owned Higgsfield illustrations, never client portfolio proof.
const scenes = {
  second_campaign: [construction, office, villa, pool],
  smm: [villa, office, pool, construction],
  cameraman: [office, villa, construction, pool],
};
export function visualPhoto(offer: OfferKey, index: number): string {
  if (offer === "second_campaign" || offer === "smm" || offer === "cameraman") {
    const photos = scenes[offer];
    return photos[index % photos.length];
  }
  const art = ART.website!;
  return index === 0
    ? art.hero!
    : art.backgrounds[(index - 1) % art.backgrounds.length].url;
}
