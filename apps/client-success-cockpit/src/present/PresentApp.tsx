import { fill } from "./content";
import { WEBSITE_DECK } from "./offer/content/website";
import { isOfferDeck } from "./offer/kinds";
import { OfferRefused } from "./offer/OfferRefused";
import { copyOf } from "./offer/sources";
import { useOffer } from "./offer/useOffer";
import { offerSlides } from "./decks";
import "./present.css";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { makeAddFiles } from "./adsActions";
import { channelName } from "./channel";
import { DeckShell } from "./DeckShell";
import type { CallKind, DeckData } from "./deckData";
import { NOTES_FEATURES } from "./deckHost";
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
import { useHost } from "./useHost";

/**
 * One client's deck in one of its three views: the shared deck, the CSM's
 * notes window, or the prep view. The route (PresentPage) and the harness
 * (src/dev/presentHarness.tsx) both render this, with real reads or
 * fixtures handed in through `io`.
 *
 * In host mode (the Brand Blueprint inside the creative director cockpit,
 * docs/brand-blueprint/EMBED.md 4.5) the deck opens no window of its own:
 * Present and Back tell the page that holds the frame, and the notes
 * window opens at its /creative address.
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
  practice = false,
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
  /**
   * The practice client (docs/call-guide/DESIGN.md): made up, and nothing
   * is saved, sent or booked. Its Blueprint always runs as a rehearsal.
   */
  practice?: boolean;
}) {
  // The Brand Blueprint's answers and parts, on its own deck only. A
  // rehearsal is asked by the address and allowed by the seat (admins and
  // the CEO): answers stay in memory and each press shows its plan. Its
  // windows talk on their own channel, so a rehearsal never reaches (or
  // saves through) a real window of the same client. The practice client's
  // card ID is never a client's, so its windows keep the plain names.
  const [rehearseAsked] = useState(
    () =>
      (practice && deck === "blueprint") ||
      new URLSearchParams(window.location.search).get("rehearse") === "1",
  );
  const own = rehearseAsked && !practice ? "rehearse" : "";
  const model = useDeckModel({
    taskId,
    deck,
    io,
    hubName: `${channelName(taskId, deck)}${own ? `:${own}` : ""}`,
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
  const host = useHost(taskId, deck);
  const offer = useOffer({
    enabled: isOfferDeck(deck),
    loaded: model.loaded,
    prep: model.prep[deck],
    d: model.data,
    io: io.offer,
    flush: model.flush,
    lang: model.lang,
    writePrep: model.setPrep,
  });
  const all = useMemo(
    () => (isOfferDeck(deck) ? offerSlides(deck, offer) : DECKS[deck]()),
    [deck, offer],
  );
  const [offerPos, setOfferPos] = useState<Pos>({ index: 0, tour: 0 });
  const [offerJump, setOfferJump] = useState(false);
  const d = model.data;
  const shown = useMemo(
    () => (d ? shownSlides(all, d, model.prep[deck]) : []),
    [all, d, model.prep, deck],
  );

  useEffect(() => {
    if (isOfferDeck(deck) && d)
      document.title = offer?.row
        ? `${d.name}: ${copyOf(offer.row, model.lang)?.deckTitle ?? ""}`
        : fill(WEBSITE_DECK.tab[model.lang], { name: d.name });
  }, [deck, d, model.lang, offer?.row]);
  const offerKey = useCallback(
    (key: string) => {
      if (!isOfferDeck(deck) || key.toLowerCase() !== "h") return false;
      const index = shown.findIndex(s => s.id === "runs");
      if (index < 0) {
        const current = Array.isArray(model.prep[deck].shown_slides)
          ? (model.prep[deck].shown_slides as string[])
          : [];
        model.setPrep(deck, { shown_slides: [...current, "runs"] }, true);
        setOfferJump(true);
      } else setOfferPos({ index, tour: 0 });
      return true;
    },
    [deck, model, shown],
  );
  useEffect(() => {
    if (!offerJump) return;
    const index = shown.findIndex(s => s.id === "runs");
    if (index >= 0) {
      setOfferPos({ index, tour: 0 });
      setOfferJump(false);
    }
  }, [offerJump, shown]);
  // Read the entry address before DeckShell can publish its initial position.
  const [offerStart] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return {
      id: p.get("slide") ?? window.location.hash.slice(1),
      tour: Math.max(0, Number(p.get("stop")) || 0),
    };
  });
  const positionedOffer = useRef(false);
  useEffect(() => {
    if (!isOfferDeck(deck) || !d || positionedOffer.current) return;
    positionedOffer.current = true;
    const index = shown.findIndex(s => s.id === offerStart.id);
    if (index >= 0) setOfferPos({ index, tour: offerStart.tour });
  }, [deck, d, shown, offerStart]);
  const notesName = `mahara-notes-${taskId}-${deck}${own ? `-${own}` : ""}`;
  const openNotes = useCallback(
    () =>
      host
        ? openWindow(host.notes.url, host.notes.name, NOTES_FEATURES)
        : openWindow(urls.notes, notesName, NOTES_FEATURES),
    [host, urls.notes, notesName],
  );
  const back = useCallback(() => {
    // In the cockpit's page the tab stays the shared screen: the deck
    // closes in place and the page offers prep again, one press later.
    if (host) {
      if (document.fullscreenElement)
        void document.exitFullscreen().catch(() => undefined);
      setClosed(true);
      host.post({ type: "end" });
      return;
    }
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
  }, [host]);

  // The shared deck's document speaks the deck's language, so the page that
  // holds the frame labels its two buttons on the closed screen in it.
  useEffect(() => {
    if (host && view === "present") document.documentElement.lang = model.lang;
  }, [host, view, model.lang]);

  // The page that holds the frame learns when the data is drawn (its name
  // for the header) or why it never will be.
  const told = useRef<"ready" | "failed" | null>(null);
  useEffect(() => {
    if (!host || told.current === "ready") return;
    if (d) {
      told.current = "ready";
      host.post({ type: "ready", view, name: d.nameEn });
    } else if (model.error && told.current !== "failed") {
      told.current = "failed";
      host.post({ type: "failed", message: model.error });
    }
  }, [host, d, model.error, view]);

  // The onboarding deck counts as presented once the call reaches the team
  // slide, which says the group's hours (the launch deck then leaves its
  // hours card out). The server keeps the first stamp.
  const stamped = useRef(false);
  const onPos = useCallback(
    (_p: Pos, slideId: string) => {
      if (
        isOfferDeck(deck) &&
        view === "present" &&
        slideId === "next" &&
        !stamped.current
      ) {
        stamped.current = true;
        model.setPrep(deck, { presented_at: true }, true);
        return;
      }
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
  if (offer?.refused)
    return (
      <OfferRefused
        offer={offer}
        model={model}
        clientUrl={urls.client}
        presenting={view === "present"}
      />
    );
  if (offer?.row && !copyOf(offer.row, model.lang))
    return (
      <Screen>
        The offer wording is not ready yet. Read the catalogue again before
        presenting.
      </Screen>
    );
  if (
    view === "present" &&
    offer?.row?.offerKey === "closer" &&
    !(
      typeof offer.prep.recruiter_name === "string" &&
      offer.prep.recruiter_name.trim().length >= 3
    )
  )
    return (
      <Screen>
        <p>
          This presentation needs a named recruiter. Confirm who will own the
          search before presenting.
        </p>
        <a href={urls.prep}>Open private prep</a>
      </Screen>
    );
  if (!all.length)
    return (
      <Screen>This deck is not built yet. The onboarding deck is ready.</Screen>
    );

  const base = {
    ...baseCtx(model, d, deck, still, view === "present"),
    ads: { add: addFiles },
    ...(deck === "blueprint" ? { bp } : {}),
    ...(isOfferDeck(deck) ? { offer } : {}),
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
        hosted={Boolean(host)}
        practice={practice || rehearseAsked || Boolean(bp?.rehearsal)}
        made={practice}
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
        hosted={Boolean(host)}
        practice={practice || rehearseAsked || Boolean(bp?.rehearsal)}
        made={practice}
        openNotes={openNotes}
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
            if (host) {
              // Every typed answer is sent before the deck reads the
              // record; a slow save never holds the call up past 1.5 s.
              const saved = Promise.all([model.flush(), bp?.flush()]).catch(
                () => undefined,
              );
              void Promise.race([
                saved,
                new Promise(r => window.setTimeout(r, 1500)),
              ]).then(() => host.post({ type: "present" }));
              return;
            }
            void model.flush();
            openWindow(
              urls.deck,
              `mahara-deck-${taskId}-${deck}${own ? `-${own}` : ""}`,
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
      endsInPlace={Boolean(host)}
      onNotes={openNotes}
      onPos={onPos}
      closed={closed}
      report={report}
      layer={layer}
      onKey={isOfferDeck(deck) ? offerKey : undefined}
      pos={isOfferDeck(deck) ? offerPos : undefined}
      setPos={isOfferDeck(deck) ? setOfferPos : undefined}
    />
  );
}
