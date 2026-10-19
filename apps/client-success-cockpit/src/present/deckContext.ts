import type { ReactNode } from "react";
import type { LiveState } from "./channel";
import { type L, type Lang, type SlideNotes, tf } from "./content";
import type { DeckData, Overrides } from "./deckData";
import type { DeckKind } from "./sources";

/**
 * What a slide is given (DESIGN 16.4). The engine mounts one slide at a
 * time, keyed by slide and language, so anything typed, ticked or placed
 * lives here, at shell level, and survives a slide change or an L.
 */
export interface SlideCtx {
  d: DeckData;
  lang: Lang;
  deck: DeckKind;
  /** The stop the slide is on, from 0. */
  tour: number;
  setTour: (n: number) => void;
  /** This deck's prep, as typed (ahead of the server's answer). */
  prep: Overrides;
  /** The other deck's prep (the launch deck reads the onboarding red lines). */
  prepOf: (deck: DeckKind) => Overrides;
  /** Save to this deck's prep: after a pause, or at once for a tick. */
  save: (patch: Overrides, now?: boolean) => void;
  /** Save to the other deck's prep (a service chosen on the onboarding deck). */
  saveTo: (deck: DeckKind, patch: Overrides, now?: boolean) => void;
  /** The call's own state that is never saved (the matrix ticks). */
  live: LiveState;
  setLive: (next: (l: LiveState) => LiveState) => void;
  /** Reduced motion: every state set at once. */
  still: boolean;
  /** True on the shared deck; false in the prep view's preview. */
  presenting: boolean;
  /**
   * Add files to the ads tray (a file dropped on a phone): shown at once,
   * saved behind it, the words said in the notes window (DESIGN 10.3).
   */
  ads?: {
    add: (
      files: File[],
      phone?: "feed" | "reels" | "facebook" | null,
    ) => Promise<void>;
  };
}

export interface SlideDef {
  id: string;
  title: L;
  /** How many stops the slide has for this client (1 when left out). */
  stops?: (ctx: SlideCtx) => number;
  /** A stop's name, for the notes window and the live region. */
  stopName?: (i: number, ctx: SlideCtx) => L | null;
  /** Hidden unless prep shows it: the slide's core data is missing (DESIGN 14). */
  defaultHidden?: (d: DeckData) => boolean;
  /** Why it is hidden by default, in prep's words. */
  hiddenWhy?: string;
  deep?: boolean;
  /** The covers carry no slide count. */
  cover?: boolean;
  notes: SlideNotes;
  render: (ctx: SlideCtx) => ReactNode;
  /** Prep's readiness for this slide: what is missing, in plain words. */
  missing?: (d: DeckData) => string[];
  /**
   * The journey's mini rail at the foot (launch slides 3 to 7, DESIGN 6.7):
   * the step this stop opens, from 0, or null for none. The shell draws it,
   * so it stays still while the slide changes around it.
   */
  rail?: (ctx: SlideCtx) => number | null;
  /**
   * A press the slide takes before the deck moves (the example call: → in
   * the middle of a stage finishes the stage). True when it was taken.
   */
  intercept?: (dir: 1 | -1, ctx: SlideCtx) => boolean;
  /** The slide's own keys (P, S, D on the call; M, 1 to 3 on the ads; A). */
  onKey?: (key: string, ctx: SlideCtx) => boolean;
}

/** The notes for one slide with its slots filled, for the notes window. */
export function fillNotes(lines: string[], slots: Record<string, string>) {
  return lines.map(l =>
    l.replace(/\{(\w+)\}/g, (_, k: string) => slots[k] ?? `{${k}}`),
  );
}

/**
 * A slide's title as the overview, the slide's label and the live region
 * say it: {name} filled before the Arabic isolates its Latin runs (filled
 * after, the slot's own letters are isolated and the slot never matches).
 */
export const slideTitle = (title: L, lang: Lang, name: string) =>
  tf(title, lang, { name });
