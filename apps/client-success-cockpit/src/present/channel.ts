import type { Lang } from "./content";
import type { CallKind, Overrides } from "./deckData";
import type { DeckKind } from "./sources";

/**
 * The shared deck and the CSM's notes window keep in step over one
 * BroadcastChannel per client and deck (DESIGN 12.2). The deck owns where
 * the call is (slide and stop); the notes window asks it to move. Prep
 * saves and the live, unsaved state (the service matrix's ticks) are posted
 * so both windows show the same thing at once. Same browser, same origin:
 * nothing here leaves the CSM's machine.
 */

/** The shell's own state that is not saved: it lives as long as the call. */
export interface LiveState {
  /** Slide 4's matrix: service name to the tests it passes. */
  ticks: Record<string, Record<string, boolean>>;
  /** The service the CSM pointed at on slide 4 before confirming it. */
  candidate: string | null;
  /** The launch deck's phones: which creative each one shows (DESIGN 10.2). */
  phones?: Partial<Record<"feed" | "reels" | "facebook", string>>;
  /** The tray thumbnail last pressed (1, 2, 3 place it; M marks it). */
  selected?: string | null;
  /** The tray's tab. */
  tray?: "uploaded" | "meta";
  /** The call's English subtitles; null follows the deck's language. */
  subtitles?: boolean | null;
  /** The swap before the last one, for the notes window's Undo (10 s). */
  undo?: {
    phones: Partial<Record<"feed" | "reels" | "facebook", string>>;
    at: number;
  } | null;
}

export const emptyLive = (): LiveState => ({ ticks: {}, candidate: null });

export type DeckMessage =
  | { type: "hello"; from: "notes" | "deck" | "prep" }
  | {
      type: "state";
      index: number;
      tour: number;
      slideId: string;
      count: number;
      stops: number;
      lang: Lang;
      startedAt: number;
    }
  | { type: "nav"; to: "next" | "prev" | "first" | "last" }
  | { type: "goto"; index: number; tour?: number }
  | { type: "lang"; lang: Lang }
  | { type: "prep"; deck: DeckKind; overrides: Overrides; revision: number }
  | { type: "live"; live: LiveState }
  | { type: "booked"; kind: CallKind; startTime: string }
  | { type: "ads" }
  /** A file added from the notes window, shown at once from the local copy. */
  | { type: "file"; file: LocalFile }
  /** How a file's save is going (DESIGN 10.3, 10.4). */
  | {
      type: "upload";
      id: string;
      phase: UploadPhase;
      progress?: number;
      savedId?: string | null;
      message?: string | null;
    }
  /** The notes window's own keys pressed there (P, S, D, M, A on the launch deck). */
  | { type: "key"; key: string };

export type UploadPhase = "shown" | "saving" | "saved" | "failed";

/**
 * A file the CSM added during the call, posted between windows as a Blob
 * (structured clone): each window makes its own object URL for it.
 */
export interface LocalFile {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  blob: Blob;
  poster?: Blob | null;
  width?: number | null;
  height?: number | null;
  seconds?: number | null;
  kind: "starter" | "custom";
  /** The phone it goes on, when the notes window chose one. */
  phone?: "feed" | "reels" | "facebook" | null;
  phase: UploadPhase;
  progress?: number;
  message?: string | null;
  savedId?: string | null;
}

export const channelName = (taskId: string, deck: DeckKind) =>
  `mahara-deck:${taskId}:${deck}`;

export interface DeckChannel {
  post: (m: DeckMessage) => void;
  close: () => void;
}

/** Null when the browser has no BroadcastChannel: the deck works alone. */
export function openChannel(
  name: string,
  onMessage: (m: DeckMessage) => void,
): DeckChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  const ch = new BroadcastChannel(name);
  ch.onmessage = e => {
    const m = e.data as DeckMessage | null;
    if (m && typeof m === "object" && typeof m.type === "string") onMessage(m);
  };
  return {
    post: m => {
      try {
        ch.postMessage(m);
      } catch {
        // a closed channel: the other window is gone
      }
    },
    close: () => ch.close(),
  };
}

/**
 * One channel per window, shared by everything in it that listens: the
 * shell (where the call is) and the model (prep, live state, bookings).
 */
export class DeckHub {
  private readonly listeners = new Set<(m: DeckMessage) => void>();
  private readonly ch: DeckChannel | null;

  constructor(name: string | null) {
    this.ch = name
      ? openChannel(name, m => {
          for (const l of this.listeners) l(m);
        })
      : null;
  }

  /** False when the browser has no BroadcastChannel: the deck works alone. */
  get connected(): boolean {
    return this.ch !== null;
  }

  post(m: DeckMessage): void {
    this.ch?.post(m);
  }

  on(fn: (m: DeckMessage) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  close(): void {
    this.listeners.clear();
    this.ch?.close();
  }
}
