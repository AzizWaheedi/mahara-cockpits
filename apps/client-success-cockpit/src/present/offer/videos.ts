import { BUILT_OFFER_DECKS, OFFER_NAMES, offerOfDeck } from "./kinds";
import type { DeckData } from "../deckData";
import type { VideoLang } from "../sources";
import type { ControlItem } from "../VideoPlayer";
import type { VideoSlot } from "../videos";
export const OFFER_VIDEO_SLOTS: readonly VideoSlot[] = BUILT_OFFER_DECKS.map(
  deck => ({
    deck,
    key: "demo",
    slide: "video",
    show: "both",
    covers: OFFER_NAMES[offerOfDeck(deck)],
  }),
);
export function offerVideoItems(
  d: DeckData,
  lang: VideoLang = d.lang,
): ControlItem[] {
  const slot = OFFER_VIDEO_SLOTS.find(v => v.deck === d.deck);
  if (!slot) return [];
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
