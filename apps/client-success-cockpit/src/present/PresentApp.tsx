import "./present.css";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { channelName } from "./channel";
import { DeckShell } from "./DeckShell";
import type { CallKind, DeckData } from "./deckData";
import { baseCtx, DECKS, prefersStill, shownSlides } from "./decks";
import type { Pos } from "./engine";
import { NotesWindow } from "./NotesWindow";
import { PrepView } from "./PrepView";
import type { DeckKind } from "./sources";
import { type DeckIO, useDeckModel } from "./useDeckModel";

/**
 * One client's deck in one of its three views: the shared deck, the CSM's
 * notes window, or the prep view. The route (PresentPage) and the harness
 * (src/dev/presentHarness.tsx) both render this, with real reads or
 * fixtures handed in through `io`.
 */

export type View = "present" | "notes" | "prep";

export interface PresentUrls {
  deck: string;
  notes: string;
  prep: string;
  client: string;
  other: string;
}

/** Opens (or brings back) a named window of its own. */
function openWindow(url: string, name: string, features?: string) {
  const w = window.open(url, name, features);
  w?.focus();
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="dk-root">
      <div className="dk-closed">{children}</div>
    </div>
  );
}

export function PresentApp({
  taskId,
  deck,
  view,
  io,
  urls,
  book,
  uploadLogo,
}: {
  taskId: string;
  deck: DeckKind;
  view: View;
  io: DeckIO;
  urls: PresentUrls;
  /** A booking button for a kind of call (BookCallButton in the cockpit). */
  book?: (
    d: DeckData,
    kind: CallKind,
    label: string,
    onBooked: (startTime: string) => void,
  ) => ReactNode;
  uploadLogo?: (file: File) => Promise<void>;
}) {
  const model = useDeckModel({
    taskId,
    deck,
    io,
    hubName: channelName(taskId, deck),
  });
  const [still] = useState(prefersStill);
  const [closed, setClosed] = useState(false);
  const all = useMemo(() => DECKS[deck](), [deck]);
  const d = model.data;
  const shown = useMemo(
    () => (d ? shownSlides(all, d, model.prep[deck]) : []),
    [all, d, model.prep, deck],
  );

  const notesName = `mahara-notes-${taskId}-${deck}`;
  const openNotes = useCallback(
    () => openWindow(urls.notes, notesName, "popup,width=520,height=820"),
    [urls.notes, notesName],
  );
  const back = useCallback(() => {
    try {
      window.opener?.focus();
    } catch {
      // the cockpit window is gone
    }
    window.close();
    // A window opened by hand cannot close itself: never navigate the shared
    // tab to the client page (results, ads, money), show the closed screen.
    window.setTimeout(() => {
      if (!window.closed) setClosed(true);
    }, 250);
  }, []);

  // The onboarding deck counts as presented once the call reaches the team
  // slide, which says the group's hours (the launch deck then leaves its
  // hours card out). The server keeps the first stamp.
  const stamped = useRef(false);
  const onPos = useCallback(
    (_p: Pos, slideId: string) => {
      if (deck !== "onboarding" || view !== "present" || stamped.current)
        return;
      if (slideId !== "team" || model.prep.onboarding.onboarding_presented_at)
        return;
      stamped.current = true;
      model.setPrep("onboarding", { onboarding_presented_at: true }, true);
    },
    [deck, view, model],
  );

  const bookFor = useMemo(
    () =>
      book && d
        ? (kind: CallKind, label: string) =>
            book(d, kind, label, startTime => model.book(kind, startTime))
        : undefined,
    [book, d, model],
  );

  if (model.error && !d) return <Screen>{model.error}</Screen>;
  if (!d) return <Screen>Reading the deck…</Screen>;
  if (!all.length)
    return (
      <Screen>This deck is not built yet. The onboarding deck is ready.</Screen>
    );

  const base = baseCtx(model, d, deck, still, view === "present");

  if (view === "notes")
    return (
      <NotesWindow
        model={model}
        deck={deck}
        slides={shown}
        base={base}
        book={bookFor}
      />
    );
  if (view === "prep")
    return (
      <PrepView
        model={model}
        deck={deck}
        all={all}
        shown={shown}
        base={base}
        book={bookFor}
        uploadLogo={
          uploadLogo
            ? async file => {
                await uploadLogo(file);
                // This window and every open window of this deck read the tray again.
                await model.reload();
                model.hub.post({ type: "ads" });
              }
            : undefined
        }
        links={{
          client: urls.client,
          other: urls.other,
          present: () => {
            void model.flush();
            openWindow(urls.deck, `mahara-deck-${taskId}-${deck}`);
          },
        }}
      />
    );
  return (
    <DeckShell
      slides={shown}
      base={base}
      setLang={model.setLang}
      hub={model.hub}
      onBack={back}
      onNotes={openNotes}
      onPos={onPos}
      closed={closed}
    />
  );
}
