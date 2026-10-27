import type { DeckData } from "../deckData";
import type { VideoLang } from "../sources";
import type { ControlItem } from "../VideoPlayer";
import type { VideoSlot } from "../videos";
export const OFFER_VIDEO_SLOTS: readonly VideoSlot[] = [
  {
    deck: "offer_website",
    key: "demo",
    slide: "video",
    show: "both",
    covers: "The website, in one minute.",
  },
];
export function offerVideoItems(
  d: DeckData,
  lang: VideoLang = d.lang,
): ControlItem[] {
  const slot = OFFER_VIDEO_SLOTS[0];
  const rows = d.videos.videos?.rows ?? [];
  const row =
    rows.find(
      r => r.deck === d.deck && r.slotKey === "demo" && r.lang === lang,
    ) ??
    rows.find(
      r => r.deck === d.deck && r.slotKey === "demo" && r.lang === "any",
    );
  return row ? [{ slot, row }] : [];
}
