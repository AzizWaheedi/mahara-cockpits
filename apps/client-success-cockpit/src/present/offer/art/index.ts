import type { L } from "../content/types";
import type { OfferKey } from "../kinds";
import courtyard from "./website/bg-courtyard.webp";
import interior from "./website/bg-interior.webp";
import stone from "./website/bg-stone.webp";
import hero from "./website/hero.webp";

export type { OfferIconName, OfferIconTone } from "./icons";
export { OfferIcon } from "./icons";

export interface OfferArt {
  hero: string | null;
  heroAlt: L;
  backgrounds: { id: string; url: string }[];
  motion: string | null;
}
/** Fictional architecture, always shown with the content's Example label. */
export const ART: Record<OfferKey, OfferArt | null> = {
  website: {
    hero,
    heroAlt: {
      en: "Example: a contemporary Gulf villa beside a pool at dusk.",
      ar: "مثال: فيلا خليجية معاصرة بجانب مسبح وقت الغروب.",
    },
    backgrounds: [
      { id: "stone", url: stone },
      { id: "courtyard", url: courtyard },
      { id: "interior", url: interior },
    ],
    motion: null,
  },
  second_campaign: null,
  seo_geo: null,
  smm: null,
  cameraman: null,
  ugc: null,
  closer: null,
};
