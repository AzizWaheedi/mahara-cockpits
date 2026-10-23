/**
 * The Brand Blueprint wall's evocative layer (docs/brand-blueprint/SPEC.md
 * 5.4, the Studio Wall the CEO chose): material swatches, a type
 * specimen's pairing and named colours. Swatches are cut from the client's
 * own project photos when the record has them (their uploads); else from
 * Mahara's example scenes of their service, each named by the material it
 * shows and labelled Example on the slide. Pure: the slides place it.
 */

import type { L } from "./content";
import type { DeckData } from "./deckData";
import { feedUrl, type Theme } from "./examples";
import type { MainKey } from "./services";

/** One square cut of an example render (1080 by 1350): its centre and side, in pixels. */
interface Cut {
  scene: Theme;
  x: number;
  y: number;
  size: number;
  name: L;
}

const W = 1080;
const H = 1350;

const M = {
  travertine: { en: "Travertine", ar: "ترافرتين" },
  boucle: { en: "Bouclé", ar: "قماش بوكليه" },
  oak: { en: "Oak", ar: "خشب بلوط" },
  brass: { en: "Brass", ar: "نحاس" },
  timber: { en: "Timber fins", ar: "شرائح خشب" },
  walnut: { en: "Walnut", ar: "خشب جوز" },
  pavers: { en: "Stone pavers", ar: "بلاط حجري" },
  marble: { en: "Marble", ar: "رخام" },
  soffit: { en: "Timber ceiling", ar: "سقف خشب" },
  limestone: { en: "Limestone", ar: "حجر جيري" },
  granite: { en: "Granite", ar: "جرانيت" },
  slats: { en: "Oak slats", ar: "شرائح بلوط" },
  carpet: { en: "Carpet tile", ar: "موكيت" },
  concrete: { en: "Concrete", ar: "خرسانة" },
  block: { en: "Blockwork", ar: "طابوق" },
  rebar: { en: "Rebar", ar: "حديد تسليح" },
  sand: { en: "Sand", ar: "رمل" },
} as const satisfies Record<string, L>;

/** Four materials per service, each cut where its example render shows it plainly. */
const CUTS: Record<MainKey, Cut[]> = {
  interior: [
    { scene: "living", x: 556, y: 950, size: 110, name: M.travertine },
    { scene: "living", x: 896, y: 1010, size: 150, name: M.boucle },
    { scene: "kitchen", x: 665, y: 300, size: 140, name: M.oak },
    { scene: "majlis", x: 636, y: 1205, size: 130, name: M.brass },
  ],
  "design-build": [
    { scene: "designbuild", x: 712, y: 700, size: 120, name: M.marble },
    { scene: "designbuild", x: 700, y: 282, size: 110, name: M.soffit },
    { scene: "villa", x: 330, y: 322, size: 140, name: M.limestone },
    { scene: "villa", x: 850, y: 1160, size: 200, name: M.pavers },
  ],
  architecture: [
    { scene: "architecture2", x: 962, y: 900, size: 190, name: M.travertine },
    { scene: "architecture2", x: 720, y: 300, size: 200, name: M.timber },
    { scene: "architecture2", x: 585, y: 830, size: 90, name: M.walnut },
    { scene: "villa", x: 850, y: 1160, size: 200, name: M.pavers },
  ],
  fitout: [
    { scene: "fitout2", x: 420, y: 1200, size: 220, name: M.marble },
    { scene: "fitout2", x: 550, y: 830, size: 130, name: M.granite },
    { scene: "office", x: 700, y: 150, size: 200, name: M.slats },
    { scene: "office", x: 800, y: 1150, size: 160, name: M.carpet },
  ],
  construction: [
    { scene: "construction3", x: 452, y: 372, size: 120, name: M.concrete },
    { scene: "construction", x: 690, y: 1150, size: 180, name: M.block },
    { scene: "construction", x: 430, y: 1190, size: 150, name: M.rebar },
    { scene: "construction3", x: 600, y: 1180, size: 220, name: M.sand },
  ],
};

/** A swatch as the board draws it: a picture, how it is cut, and its name. */
export interface Swatch {
  url: string;
  /** background-size and background-position for the cut. */
  size: string;
  at: string;
  name: L | null;
}

const cut = (c: Cut): Swatch => {
  const left = Math.min(Math.max(c.x - c.size / 2, 0), W - c.size);
  const top = Math.min(Math.max(c.y - c.size / 2, 0), H - c.size);
  return {
    url: feedUrl(c.scene),
    size: `${((W / c.size) * 100).toFixed(1)}% auto`,
    at: `${((left / (W - c.size)) * 100).toFixed(1)}% ${((top / (H - c.size)) * 100).toFixed(1)}%`,
    name: c.name,
  };
};

/** Four corners of a photo of theirs, each a close cut (no names: we do not guess materials). */
const OWN_AT = ["22% 26%", "78% 30%", "26% 74%", "74% 78%"] as const;

/** Their own project photos on record: their uploads (never a starter ad), stills only. */
export function ownPhotos(d: DeckData): string[] {
  return (d.launch?.creatives ?? [])
    .filter(c => c.from === "upload" && !c.starter && !c.video && c.url)
    .map(c => c.poster ?? c.url ?? "")
    .filter(Boolean)
    .slice(0, 4);
}

/**
 * The material board's four swatches: cut from their own photos (one cut
 * from each, or four from one), else the example materials of their service.
 */
export function swatchesFor(
  d: DeckData,
  service: MainKey,
): { own: boolean; swatches: Swatch[] } {
  const own = ownPhotos(d);
  if (own.length)
    return {
      own: true,
      swatches: OWN_AT.map((at, n) => ({
        url: own[n % own.length],
        size: own.length > 1 ? "240% auto" : "300% auto",
        at,
        name: null,
      })),
    };
  return { own: false, swatches: CUTS[service].map(cut) };
}

/** The print on the cover: their own photo, else their service's lead example render. */
export function coverPhoto(
  d: DeckData,
  scenes: readonly Theme[],
): { url: string; own: boolean } {
  const own = ownPhotos(d)[0];
  return own
    ? { url: own, own: true }
    : { url: feedUrl(scenes[0]), own: false };
}

/**
 * The example palette shown while their Brand DNA doc has no colours: four
 * named chips (labelled Example on the slide), warm and neutral, so the
 * board shows what it will hold.
 */
export const EXAMPLE_PALETTE: { hex: string; name: L }[] = [
  { hex: "#D9C8AD", name: { en: "Sand", ar: "رملي" } },
  { hex: "#8A6A4A", name: { en: "Oak", ar: "بلوطي" } },
  { hex: "#B8914F", name: { en: "Brass", ar: "نحاسي" } },
  { hex: "#1F2532", name: { en: "Night", ar: "ليلي" } },
];
