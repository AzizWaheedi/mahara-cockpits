import { useEffect, useMemo, useRef, useState } from "react";
import { type CallFacts, noFacts } from "./callSteps";
import type { DeckHub } from "./channel";
import type { SlideDef } from "./deckContext";
import type { DeckData } from "./deckData";
import type { BpModel } from "./useBlueprint";

/**
 * What the call guide ticks from (callSteps.ts): what the windows say on the
 * call's channel while this window is open (the deck's position, a notes
 * window's hello, the deck closing), and what the record already holds (the
 * kickoff, the bookings, the Blueprint's parts). Reads only.
 */
export function useCallFacts({
  hub,
  d,
  slides,
  bp,
  isNotes,
}: {
  hub: DeckHub;
  d: DeckData | null;
  /** The slides this window shows, in order. */
  slides: SlideDef[];
  bp?: BpModel | null;
  /** This window is the notes window. */
  isNotes: boolean;
}): CallFacts {
  const [heard, setHeard] = useState({
    notes: false,
    deck: false,
    closed: false,
    furthest: -1,
    end: false,
  });
  const slidesRef = useRef(slides);
  slidesRef.current = slides;

  useEffect(() => {
    const off = hub.on(m => {
      if (m.type === "hello" && m.from === "notes")
        setHeard(h => (h.notes ? h : { ...h, notes: true }));
      else if (m.type === "state") {
        const at = slidesRef.current.findIndex(s => s.id === m.slideId);
        setHeard(h => ({
          ...h,
          deck: true,
          closed: false,
          furthest: Math.max(h.furthest, at),
          end: h.end || m.index >= m.count - 1,
        }));
      } else if (m.type === "closed")
        setHeard(h => (h.deck ? { ...h, closed: true } : h));
    });
    // The windows already open say so (DeckShell and NotesWindow answer).
    hub.post({ type: "roll-call" });
    return off;
  }, [hub]);

  const p = bp?.parts;
  const r = bp?.runs;
  const part = (k: "1" | "2" | "3") =>
    Boolean(p?.[k]) || r?.[k]?.phase === "rehearsed";
  const p1 = part("1");
  const p2 = part("2");
  const p3 = part("3");

  return useMemo(() => {
    if (!d) return noFacts();
    const reached = new Set(slides.slice(0, heard.furthest + 1).map(s => s.id));
    return {
      notesOpen: isNotes || heard.notes,
      deckOpen: heard.deck,
      deckClosed: heard.closed,
      reached,
      reachedEnd: heard.end,
      kickoffSent: Boolean(d.kickoff.sentAt),
      blueprintBooked: d.blueprintBooked || Boolean(d.next.blueprint),
      parts: { 1: p1, 2: p2, 3: p3 },
    };
  }, [d, slides, heard, isNotes, p1, p2, p3]);
}
