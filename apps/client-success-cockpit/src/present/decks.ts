import type { SlideCtx, SlideDef } from "./deckContext";
import type { DeckData, Overrides } from "./deckData";
import { visible } from "./engine";
import { onboardingSlides } from "./onboardingDeck";
import type { DeckKind } from "./sources";
import type { DeckModel } from "./useDeckModel";

/**
 * The two decks' slide lists. The launch deck is built separately; until
 * it is, its list is empty and the page says so.
 */
export const DECKS: Record<DeckKind, () => SlideDef[]> = {
  onboarding: onboardingSlides,
  launch: () => [],
};

/** The call's length the notes window's timer counts against (DESIGN 12.2). */
export const TARGET_MINUTES: Record<DeckKind, number> = {
  onboarding: 10,
  launch: 25,
};

/** The slides the client sees: prep's hides and shows, and DESIGN 14's defaults. */
export function shownSlides(
  all: SlideDef[],
  d: DeckData,
  prep: Overrides,
): SlideDef[] {
  const ids = new Set(
    visible(
      all.map(s => ({
        id: s.id,
        defaultHidden: s.defaultHidden?.(d) ?? false,
      })),
      prep,
    ).map(s => s.id),
  );
  return all.filter(s => ids.has(s.id));
}

/** Reduced motion, asked by the system or by ?still=1 (the screenshot runs). */
export function prefersStill(): boolean {
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(window.location.search).get("still") === "1")
    return true;
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
}

/** What every slide is given, from the model (DESIGN 16.4). */
export function baseCtx(
  m: DeckModel,
  d: DeckData,
  deck: DeckKind,
  still: boolean,
  presenting: boolean,
): Omit<SlideCtx, "tour" | "setTour"> {
  return {
    d,
    lang: m.lang,
    deck,
    prep: m.prep[deck],
    prepOf: k => m.prep[k],
    save: (patch, now) => m.setPrep(deck, patch, now),
    saveTo: (k, patch, now) => m.setPrep(k, patch, now),
    live: m.live,
    setLive: m.setLive,
    still,
    presenting,
  };
}
