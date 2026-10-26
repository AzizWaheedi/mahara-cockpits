import { useMemo } from "react";
import {
  blueprintCall,
  blueprintPathOf,
  creativePath,
  type FrameMessage,
  frameMessage,
  hostAsked,
  notesWindowName,
  PRACTICE_TASK,
  practicePathOf,
  sameOriginParent,
} from "./deckHost";

/**
 * Host mode (docs/brand-blueprint/EMBED.md 4.5): the Brand Blueprint deck
 * drawn inside the creative director cockpit's page, in a frame on the same
 * origin. On only when the address asks (?host=creative), the deck is the
 * Blueprint, and the parent page is ours; anything else is today's
 * behaviour, so the CSM's decks and a host-mode address pasted into a tab
 * are untouched.
 */

export interface Host {
  /** Tells the creative director's page. */
  post: (m: FrameMessage) => void;
  /** The notes popup at its /creative address, under the call's one name. */
  notes: { url: string; name: string };
}

export function hostFor(
  deck: string,
  taskId: string,
  w: Window | undefined = typeof window === "undefined" ? undefined : window,
): Host | null {
  if (!w || deck !== "blueprint" || !hostAsked(w.location.search)) return null;
  const parent = sameOriginParent(w);
  if (!parent) return null;
  const q = new URLSearchParams(w.location.search);
  const rehearse = q.get("rehearse") === "1";
  const url =
    creativePath(q.get("notes")) ?? blueprintCall(taskId, rehearse)?.notes;
  if (!url) return null;
  const origin = w.location.origin;
  return {
    post: m => {
      try {
        parent.postMessage(frameMessage(m), origin);
      } catch {
        // the page that held this frame is gone
      }
    },
    notes: { url, name: notesWindowName(taskId, rehearse) },
  };
}

/** The route's own frame (ProtectedRoute, the deck's boundary): the Blueprint's paths only. */
export function hostFrame(
  w: Window | undefined = typeof window === "undefined" ? undefined : window,
): Host | null {
  if (!w) return null;
  const at = blueprintPathOf(w.location.pathname);
  if (at) return hostFor("blueprint", at.taskId, w);
  return practicePathOf(w.location.pathname)
    ? hostFor("blueprint", PRACTICE_TASK, w)
    : null;
}

export function useHost(taskId: string, deck: string): Host | null {
  return useMemo(() => hostFor(deck, taskId), [deck, taskId]);
}
