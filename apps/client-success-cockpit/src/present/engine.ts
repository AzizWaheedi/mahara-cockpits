/**
 * The deck engine's rules, without a screen: how a press walks a slide's
 * stops and then the slides, what each key does, which slides are shown.
 * DeckShell.tsx wires these to the window; scripts/deck-engine.test.ts pins
 * them. Taken from the sales deck's DeckPage (keys, stops, hash) with the
 * client success rule on Esc (DESIGN 15.1): Esc closes an open panel, then
 * the overview, and nothing more. It never leaves the deck, in or out of
 * full screen, because a clicker's start/stop button sends Esc and leaving
 * would put the cockpit's client page on the client's screen.
 */

export interface Pos {
  index: number;
  tour: number;
}

/**
 * One press forward or back: a slide's own stops first, then the next
 * slide; coming back lands on the previous slide's last stop. Null at either
 * end of the deck (nothing moves).
 */
export function stepFrom(pos: Pos, dir: 1 | -1, stops: number[]): Pos | null {
  const here = Math.max(1, stops[pos.index] ?? 1);
  const tour = pos.tour + dir;
  if (tour >= 0 && tour < here) return { index: pos.index, tour };
  const index = pos.index + dir;
  if (index < 0 || index >= stops.length) return null;
  return { index, tour: dir < 0 ? Math.max(1, stops[index] ?? 1) - 1 : 0 };
}

export type Command =
  | "next"
  | "prev"
  | "first"
  | "last"
  | "fullscreen"
  | "lang"
  | "overview"
  | "notes"
  | "video"
  | "close"
  | "none";

export interface KeyState {
  key: string;
  /** The focused element's tag (BUTTON, INPUT ...), upper case. */
  tag?: string | null;
  editable?: boolean;
  meta?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  /** What is open over the slide: a panel (the video player) first, then the overview. */
  panel?: boolean;
  overview?: boolean;
}

const TYPING = new Set(["INPUT", "SELECT", "TEXTAREA"]);

/** What a key does on the shared deck. Typing and modified keys do nothing. */
export function keyCommand(s: KeyState): Command {
  const tag = (s.tag ?? "").toUpperCase();
  if (TYPING.has(tag) || s.editable) return "none";
  if (s.meta || s.ctrl || s.alt) return "none";
  const k = s.key;
  if (k === "ArrowRight" || k === "PageDown") return "next";
  // Space on a focused button presses the button, not the deck.
  if (k === " " || k === "Spacebar") return tag === "BUTTON" ? "none" : "next";
  if (k === "ArrowLeft" || k === "PageUp") return "prev";
  if (k === "Home") return "first";
  if (k === "End") return "last";
  if (k === "f" || k === "F") return "fullscreen";
  if (k === "l" || k === "L") return "lang";
  if (k === "o" || k === "O") return "overview";
  if (k === "n" || k === "N") return "notes";
  // V plays the slide's first recorded video, or closes the player.
  if (k === "v" || k === "V") return "video";
  if (k === "Escape" || k === "Esc")
    return s.panel || s.overview ? "close" : "none";
  return "none";
}

/**
 * A command while the video player is open (DESIGN 21.6): a move key closes
 * the player and does nothing else (one press, one change); Esc and V close
 * it; the rest are left to the deck.
 */
export function withPlayer(cmd: Command): Command {
  if (cmd === "next" || cmd === "prev" || cmd === "first" || cmd === "last")
    return "close";
  return cmd;
}

/**
 * In an RTL deck the arrows keep their meaning on the keyboard (→ is next,
 * as on a clicker); only the drawn arrows in the chrome mirror.
 */
export const NEXT_GLYPH = { ltr: "→", rtl: "←" } as const;

export interface Hideable {
  id: string;
  defaultHidden?: boolean;
}

/**
 * The slides a client sees: those prep hid are left out, and a slide that
 * is hidden by default (its core data is missing) shows only when prep
 * asked for it (DESIGN 14).
 */
export function visible<T extends Hideable>(
  slides: T[],
  prep: { hidden_slides?: unknown; shown_slides?: unknown },
): T[] {
  const ids = (v: unknown) =>
    new Set(
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === "string")
        : [],
    );
  const hidden = ids(prep.hidden_slides);
  const shown = ids(prep.shown_slides);
  return slides.filter(s =>
    hidden.has(s.id) ? false : s.defaultHidden ? shown.has(s.id) : true,
  );
}

/** The slide a `#id` address points at, or -1. */
export function slideAtHash(slides: { id: string }[], hash: string): number {
  let id = hash.replace(/^#/, "");
  try {
    id = decodeURIComponent(id);
  } catch {
    // a malformed address lands on the cover
  }
  return slides.findIndex(s => s.id === id);
}

/** ?lang=en|ar from an address, or null. */
export function langParam(search: string): "en" | "ar" | null {
  const v = new URLSearchParams(search).get("lang");
  return v === "en" || v === "ar" ? v : null;
}
