import "./present.css";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { makeAddFiles } from "./adsActions";
import { channelName } from "./channel";
import { DeckShell } from "./DeckShell";
import type { CallKind, DeckData } from "./deckData";
import { baseCtx, DECKS, prefersStill, shownSlides } from "./decks";
import type { Pos } from "./engine";
import { KickoffLayer, type KickoffPort } from "./KickoffSlide";
import { type BookOpts, KICKOFF_SLIDE, type KickoffShown } from "./kickoffStop";
import { NotesWindow } from "./NotesWindow";
import { PrepView } from "./PrepView";
import { openNamed } from "./PresentButton";
import type { DeckKind } from "./sources";
import { useBlueprint } from "./useBlueprint";
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

/** Opens a named window of its own, or brings it forward without reloading it. */
function openWindow(url: string, name: string, features?: string) {
  openNamed(url, name, features);
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
  report,
  kickoff,
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
    opts?: BookOpts,
  ) => ReactNode;
  uploadLogo?: (file: File) => Promise<void>;
  /** Sends a slide's crash to the issue queue. */
  report?: (r: { title: string; detail: string }) => Promise<unknown>;
  /**
   * The kickoff form on the onboarding deck's last slide (O8): the reads
   * and writes the kickoff window uses, for this client. Without it the
   * slide draws its frame still (prep's preview).
   */
  kickoff?: KickoffPort;
}) {
  // The Brand Blueprint's answers and parts, on its own deck only. A
  // rehearsal is asked by the address and allowed by the seat (admins and
  // the CEO): answers stay in memory and each press shows its plan. Its
  // windows talk on their own channel, so a rehearsal never reaches (or
  // saves through) a real window of the same client.
  const [rehearseAsked] = useState(
    () => new URLSearchParams(window.location.search).get("rehearse") === "1",
  );
  const model = useDeckModel({
    taskId,
    deck,
    io,
    hubName: `${channelName(taskId, deck)}${rehearseAsked ? ":rehearse" : ""}`,
  });
  const [still] = useState(prefersStill);
  const bp = useBlueprint({
    enabled: deck === "blueprint",
    taskId,
    loaded: model.loaded,
    d: model.data,
    io: io.blueprint,
    hub: model.hub,
    rehearseAsked,
    now: io.now,
  });
  const [closed, setClosed] = useState(false);
  const all = useMemo(() => DECKS[deck](), [deck]);
  const d = model.data;
  const shown = useMemo(
    () => (d ? shownSlides(all, d, model.prep[deck]) : []),
    [all, d, model.prep, deck],
  );

  const notesName = `mahara-notes-${taskId}-${deck}${rehearseAsked ? "-rehearse" : ""}`;
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
        ? (kind: CallKind, label: string, opts?: BookOpts) =>
            book(d, kind, label, startTime => model.book(kind, startTime), opts)
        : undefined,
    [book, d, model],
  );

  // The kickoff's live layer, on the shared deck only (O8).
  const [kickoffShown, setKickoffShown] = useState<KickoffShown | null>(null);
  const onShown = useCallback(
    (n: KickoffShown) =>
      setKickoffShown(s =>
        s && s.live === n.live && s.held === n.held ? s : n,
      ),
    [],
  );
  const live = kickoff && deck === "onboarding" && view === "present";
  const kickoffWent = model.kickoffWent;
  const layer = useMemo(
    () =>
      live && kickoff
        ? ({
            slideId,
            ctx,
          }: {
            slideId: string;
            ctx: { d: DeckData; lang: typeof model.lang };
          }) => (
            <KickoffLayer
              on={slideId === KICKOFF_SLIDE}
              ctx={ctx}
              port={kickoff}
              hub={model.hub}
              onSent={kickoffWent}
              onShown={onShown}
            />
          )
        : undefined,
    [live, kickoff, model.hub, kickoffWent, onShown],
  );

  const addFiles = useMemo(
    () => makeAddFiles(model, io, () => null),
    [model, io],
  );

  if (model.error && !d) return <Screen>{model.error}</Screen>;
  if (!d) return <Screen>Reading the deck…</Screen>;
  if (!all.length)
    return (
      <Screen>This deck is not built yet. The onboarding deck is ready.</Screen>
    );

  const base = {
    ...baseCtx(model, d, deck, still, view === "present"),
    ads: { add: addFiles },
    ...(deck === "blueprint" ? { bp } : {}),
    // On the shared deck the live layer draws the kickoff's frame; until
    // its guard has read the client, the record says what is filled.
    ...(live
      ? {
          kickoff: kickoffShown ?? {
            live: true,
            held: d.kickoff.from === "record",
          },
        }
      : {}),
  };

  if (view === "notes")
    return (
      <NotesWindow
        model={model}
        deck={deck}
        slides={shown}
        base={base}
        book={bookFor}
        io={io}
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
        io={io}
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
            openWindow(
              urls.deck,
              `mahara-deck-${taskId}-${deck}${rehearseAsked ? "-rehearse" : ""}`,
            );
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
      report={report}
      layer={layer}
    />
  );
}
