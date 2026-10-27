import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  Eye,
  EyeOff,
  Presentation,
  Upload,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { focusOf } from "./AdsStage";
import { makeAddFiles } from "./adsActions";
import { BlueprintNotes } from "./BlueprintNotes";
import { BlueprintPrep } from "./BlueprintPrep";
import { CallGuideBand, PracticeNote } from "./CallGuide";
import { DECK_NAME, t } from "./content";
import { Field, Segmented, SlideControls, Toggle } from "./controls";
import { DeckShell } from "./DeckShell";
import { type SlideCtx, type SlideDef, titleFor } from "./deckContext";
import type { CallKind } from "./deckData";
import { type Pos, stepFrom } from "./engine";
import { LaunchControls } from "./launchControls";
import { saveLine } from "./NotesWindow";
import { isOfferDeck } from "./offer/kinds";
import { OfferNotes } from "./offer/OfferNotes";
import { OfferPrep } from "./offer/OfferPrep";
import type { DeckKind } from "./sources";
import { TrayFiles } from "./TrayFiles";
import { useCallFacts } from "./useCallFacts";
import type { DeckIO, DeckModel } from "./useDeckModel";
import { useDriveImports } from "./useDriveImports";
import { PrepVideos } from "./VideoPrep";

/**
 * Before the call, never shared (DESIGN 12.3): the deck live in a box, a
 * strip of its slides with what each one is missing, the slide's own
 * settings, and Present, which opens the shared deck in its own window.
 * Hosted in the creative director cockpit (EMBED.md 4.2), the page above
 * holds the client's name and the title, and Present fills that tab.
 */

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export interface PrepLinks {
  client: string;
  other: string;
  present: () => void;
}

export function PrepView({
  model,
  deck,
  all,
  shown,
  base,
  book,
  links,
  uploadLogo,
  io,
  hosted = false,
  practice = false,
  made = false,
  openNotes,
}: {
  model: DeckModel;
  deck: DeckKind;
  all: SlideDef[];
  shown: SlideDef[];
  base: Omit<SlideCtx, "tour" | "setTour">;
  book?: (kind: CallKind, label: string) => ReactNode;
  links: PrepLinks;
  /** Save a logo to the client's tray (left out where nothing can be saved). */
  uploadLogo?: (file: File) => Promise<void>;
  io?: DeckIO;
  /** Inside the creative director cockpit's page (EMBED.md 4.2). */
  hosted?: boolean;
  /** A rehearsal or a practice run: the call guide never counts it. */
  practice?: boolean;
  /** The practice client: made up, says so above the guide. */
  made?: boolean;
  /** Opens the notes window, for the call guide's step (not when hosted). */
  openNotes?: () => void;
}) {
  const d = model.data;
  const facts = useCallFacts({
    hub: model.hub,
    d,
    slides: shown,
    bp: base.bp,
    isNotes: false,
  });
  const [pos, setPos] = useState<Pos>({ index: 0, tour: 0 });
  const [messages, setMessages] = useState<string[]>([]);
  const posRef = useRef(pos);
  posRef.current = pos;
  const shownRef = useRef(shown);
  shownRef.current = shown;
  const addFiles = useMemo(
    () =>
      io
        ? makeAddFiles(
            model,
            io,
            () =>
              shownRef.current[posRef.current.index]?.id === "ads"
                ? focusOf(posRef.current.tour)
                : null,
            r => {
              if (r.phase === "refused" && r.message)
                setMessages(m => [r.message as string, ...m].slice(0, 3));
            },
          )
        : undefined,
    [model, io],
  );
  const [picked, setPicked] = useState(all[0]?.id ?? "");
  const [logoNote, setLogoNote] = useState<string | null>(null);
  const drive = useDriveImports({
    taskId: deck === "launch" ? (d?.taskId ?? null) : null,
    io,
    hub: model.hub,
    onLanded: () => {
      void model.reload().then(() => model.hub.post({ type: "ads" }));
    },
  });
  // The Blueprint's parts by address (#part1 to #part3): opened and brought
  // up once the form is drawn, and again when the address changes.
  const drawn = Boolean(d);
  useEffect(() => {
    if (deck !== "blueprint" || !drawn) return;
    const go = () => {
      const id = window.location.hash.slice(1);
      if (!/^part[123]$/.test(id)) return;
      const el = document.getElementById(id);
      if (!el) return;
      if (el.tagName === "DETAILS") (el as HTMLDetailsElement).open = true;
      el.scrollIntoView?.({ block: "start" });
    };
    const first = window.setTimeout(go, 0);
    window.addEventListener("hashchange", go);
    return () => {
      window.clearTimeout(first);
      window.removeEventListener("hashchange", go);
    };
  }, [deck, drawn]);
  if (!d) return null;
  const prep = model.prep[deck];
  const hidden = new Set(strings(prep.hidden_slides));
  const shownIds = new Set(shown.map(s => s.id));
  const slide = all.find(s => s.id === picked) ?? all[0];
  const state = (s: SlideDef) =>
    !shownIds.has(s.id)
      ? "hidden"
      : (s.missing?.(d).length ?? 0) > 0
        ? "missing"
        : "ready";
  const ready = shown.filter(s => state(s) === "ready").length;
  const pick = (s: SlideDef) => {
    setPicked(s.id);
    const at = shown.findIndex(x => x.id === s.id);
    if (at >= 0) setPos({ index: at, tour: 0 });
  };
  const setShown = (s: SlideDef, show: boolean) => {
    const hide = strings(prep.hidden_slides).filter(x => x !== s.id);
    const showList = strings(prep.shown_slides).filter(x => x !== s.id);
    const byDefault = s.defaultHidden?.(d) ?? false;
    model.setPrep(
      deck,
      {
        hidden_slides: show ? hide : [...hide, s.id],
        shown_slides: show && byDefault ? [...showList, s.id] : showList,
      },
      true,
    );
  };
  // The Blueprint saves its answers through its own saver (useBlueprint.ts).
  const sl = saveLine(
    deck === "blueprint" ? (base.bp?.save ?? model.save) : model.save,
  );
  const missing = slide?.missing?.(d) ?? [];
  const todo = slide?.todo?.(d) ?? [];
  const stops = shown.map(x =>
    Math.max(1, x.stops?.({ ...base, tour: 0, setTour: () => {} }) ?? 1),
  );
  const move = (dir: 1 | -1) => {
    const next = stepFrom(pos, dir, stops);
    if (!next) return;
    setPos(next);
    const id = shown[next.index]?.id;
    if (id) setPicked(id);
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Hosted, the page's seam above is the only rule: the toolbar is the
          first row of the lower half and stays under the seam as the prep
          scrolls (Present never scrolls away). Its right edge, and the
          body's, meet the page's own past the frame's scrollbar: the page
          sets --host-end, since this frame's breakpoints are its own
          (EMBED.md 11.1). */}
      <header
        className={cn(
          "flex flex-wrap items-center gap-3 px-4 py-3",
          hosted
            ? "sticky top-0 z-10 bg-background pr-[var(--host-end,16px)]"
            : "border-b",
        )}
      >
        {hosted ? null : (
          <>
            <a
              href={links.client}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft aria-hidden className="size-4" />
              <bdi>{d.nameEn}</bdi>
            </a>
            <span className="text-sm font-semibold">
              Prepare the{" "}
              {deck === "blueprint"
                ? DECK_NAME[deck].en
                : DECK_NAME[deck].en.toLowerCase()}{" "}
              deck
            </span>
          </>
        )}
        {deck === "blueprint" || isOfferDeck(deck) ? null : (
          <a
            href={links.other}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {deck === "onboarding" ? "The launch deck" : "The onboarding deck"}
          </a>
        )}
        <span className="text-sm text-muted-foreground">
          {ready} of {shown.length} slides ready
        </span>
        <div className="ms-auto flex items-center gap-3">
          <Segmented
            label="Language"
            value={model.lang}
            options={[
              { value: "en", label: "English" },
              { value: "ar", label: "العربية" },
            ]}
            onChange={v => {
              model.setLang(v);
              model.setPrep(deck, { language: v }, true);
            }}
          />
          <Button onClick={links.present} data-guide="present">
            <Presentation aria-hidden />
            Present
          </Button>
        </div>
      </header>

      {/* The CSM's read-only view of the Blueprint runs no call of its own. */}
      {!isOfferDeck(deck) &&
      (deck !== "blueprint" || (base.bp && !base.bp.readOnly)) ? (
        <div className={cn(hosted && "pr-[var(--host-end,16px)]")}>
          {/* Hosted, the creative director's page says it once, above. */}
          {made && !hosted ? (
            <PracticeNote className="mx-4 mt-3 w-fit" />
          ) : null}
          <CallGuideBand
            deck={deck}
            taskId={d.taskId}
            facts={facts}
            hosted={hosted}
            practice={practice}
            openNotes={hosted ? undefined : openNotes}
          />
        </div>
      ) : null}

      <div
        className={cn(
          "grid flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_380px]",
          hosted && "pr-[var(--host-end,16px)]",
        )}
      >
        <div className="min-w-0 space-y-3">
          <div className="relative aspect-video w-full overflow-hidden rounded-xl border">
            <DeckShell
              slides={shown}
              base={{ ...base, presenting: false }}
              setLang={model.setLang}
              embedded
              pos={pos}
              setPos={setPos}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => move(-1)}
              disabled={!stepFrom(pos, -1, stops)}
            >
              <ChevronLeft aria-hidden />
              Back
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => move(1)}
              disabled={!stepFrom(pos, 1, stops)}
            >
              Next
              <ArrowRight aria-hidden />
            </Button>
            <span className="text-xs text-muted-foreground">
              Slide {pos.index + 1} of {shown.length}
              {(stops[pos.index] ?? 1) > 1
                ? `, stop ${pos.tour + 1} of ${stops[pos.index]}`
                : ""}
            </span>
          </div>
          <ol className="flex flex-wrap gap-1.5">
            {all.map((s, i) => {
              const st = state(s);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => pick(s)}
                    aria-current={s.id === slide?.id}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs",
                      s.id === slide?.id
                        ? "border-primary"
                        : "hover:border-primary/50",
                      st === "hidden" && "text-muted-foreground line-through",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-2 rounded-full",
                        st === "ready"
                          ? "bg-primary"
                          : st === "missing"
                            ? "bg-warning"
                            : "bg-muted-foreground/50",
                      )}
                    />
                    {i + 1}{" "}
                    {t(titleFor(s, d), "en").replace("{name}", d.nameEn)}
                    <span className="sr-only">
                      {st === "ready"
                        ? ", ready"
                        : st === "missing"
                          ? ", something missing"
                          : ", hidden"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="text-xs text-muted-foreground">
            The preview is live: tick, type and pick on it as you will on the
            call. Back, Next and the strip move it
            {/* Hosted, the page's header already says what Present does. */}
            {hosted
              ? "."
              : "; the shared deck opens in its own window with Present."}
          </div>
          {deck === "blueprint" ? (
            <BlueprintPrep bp={base.bp} d={d} made={made} />
          ) : isOfferDeck(deck) ? (
            <OfferPrep offer={base.offer} model={model} />
          ) : null}
        </div>

        <aside className="space-y-4 rounded-xl border p-4">
          {slide ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-semibold">
                  Slide {all.indexOf(slide) + 1} ·{" "}
                  {t(titleFor(slide, d), "en").replace("{name}", d.nameEn)}
                </h2>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShown(slide, !shownIds.has(slide.id))}
                >
                  {shownIds.has(slide.id) ? (
                    <EyeOff aria-hidden />
                  ) : (
                    <Eye aria-hidden />
                  )}
                  {shownIds.has(slide.id)
                    ? "Hide this slide"
                    : "Show this slide"}
                </Button>
              </div>
              {!shownIds.has(slide.id) &&
              !hidden.has(slide.id) &&
              slide.hiddenWhy ? (
                <div className="text-xs txt-warn">{slide.hiddenWhy}</div>
              ) : null}
              {missing.length ? (
                <ul className="space-y-1 text-xs txt-warn">
                  {missing.map(m => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              ) : (
                <div className="text-xs txt-good">Ready.</div>
              )}
              {todo.length ? (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {todo.map(m => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              ) : null}
              {(slide.id === "welcome" || slide.id === "cover") &&
              uploadLogo ? (
                <Field
                  label="Their logo"
                  hint={
                    logoNote ??
                    (d.logo
                      ? d.logo.from === "verified"
                        ? "The verified logo from the logo library."
                        : "Uploaded here."
                      : "None yet: the deck shows their first letter.")
                  }
                >
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-sm hover:border-primary">
                    <Upload aria-hidden className="size-4" />
                    {d.logo ? "Upload another logo" : "Upload their logo"}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="sr-only"
                      onChange={e => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        setLogoNote(`Saving ${file.name}…`);
                        uploadLogo(file)
                          .then(() => setLogoNote(`Saved ${file.name}.`))
                          .catch(err =>
                            setLogoNote(
                              err instanceof Error ? err.message : String(err),
                            ),
                          );
                      }}
                    />
                  </label>
                </Field>
              ) : null}
              {deck === "blueprint" ? (
                <BlueprintNotes
                  bp={base.bp}
                  d={d}
                  slideId={slide.id}
                  reload={model.reload}
                />
              ) : isOfferDeck(deck) ? (
                <OfferNotes offer={base.offer} model={model} />
              ) : deck === "launch" ? (
                <LaunchControls
                  slideId={slide.id}
                  d={d}
                  model={model}
                  tour={pos.tour}
                  book={book}
                  full
                  addFiles={addFiles}
                  updateAd={io?.updateAd}
                  messages={messages}
                  drive={drive}
                  tray={
                    <TrayFiles
                      ads={model.loaded?.ads ?? []}
                      now={io?.now?.() ?? new Date()}
                      remove={io?.removeAd}
                      onRemoved={() => {
                        void model
                          .reload()
                          .then(() => model.hub.post({ type: "ads" }));
                      }}
                    />
                  }
                />
              ) : (
                <SlideControls
                  slideId={slide.id}
                  d={d}
                  deck={deck}
                  prep={model.prep}
                  setPrep={model.setPrep}
                  book={book}
                  full
                />
              )}
            </>
          ) : null}

          <section className="space-y-3 border-t pt-3">
            <h3 className="text-xs font-medium text-muted-foreground">
              The whole deck
            </h3>
            {deck === "blueprint" || isOfferDeck(deck) ? null : (
              <Field
                label="Service model"
                hint={
                  d.mode.from === "prep"
                    ? "Set here."
                    : d.mode.known
                      ? `From the ${d.mode.from === "card" ? "ClickUp card" : "HighLevel account"}.`
                      : "Service model not set on the card. The deck uses done for you. Change it if their team calls."
                }
              >
                <Segmented
                  label="Service model"
                  value={d.mode.dwy ? "DWY" : "DFY"}
                  options={[
                    { value: "DFY", label: "Done for you" },
                    { value: "DWY", label: "Done with you" },
                  ]}
                  onChange={v =>
                    model.setPrep("onboarding", { service_model: v }, true)
                  }
                />
              </Field>
            )}
            {!isOfferDeck(deck) && deck !== "blueprint" && d.mode.dwy ? (
              <Toggle
                checked={model.prep.onboarding.dwy_os_approved === true}
                onChange={v =>
                  model.setPrep(
                    "onboarding",
                    { dwy_os_approved: v || null },
                    true,
                  )
                }
              >
                Mahara OS is approved for this client
                <span className="block text-xs text-muted-foreground">
                  Until it is, the deck shows their CRM instead.
                </span>
              </Toggle>
            ) : null}
            {[
              ...(model.loaded?.problems ?? []),
              ...(isOfferDeck(deck) ? [] : d.notes),
            ].length ? (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {[
                  ...(model.loaded?.problems ?? []),
                  ...(isOfferDeck(deck) ? [] : d.notes),
                ].map(n => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}
            <div
              role="status"
              className={cn(
                "flex items-center justify-between gap-2 text-xs",
                sl.tone === "bad"
                  ? "txt-bad"
                  : sl.tone === "good"
                    ? "txt-good"
                    : "text-muted-foreground",
              )}
            >
              <span className="min-w-0">{sl.text}</span>
              {sl.tone === "bad" ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => void model.flush()}
                >
                  Save again
                </Button>
              ) : null}
            </div>
          </section>
          {deck === "blueprint" || isOfferDeck(deck) ? null : (
            <PrepVideos model={model} deck={deck} all={all} io={io} />
          )}
        </aside>
      </div>
    </div>
  );
}
