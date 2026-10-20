import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  Eye,
  EyeOff,
  Presentation,
  Upload,
} from "lucide-react";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { focusOf } from "./AdsStage";
import { makeAddFiles } from "./adsActions";
import { DECK_NAME, t } from "./content";
import { Field, Segmented, SlideControls, Toggle } from "./controls";
import { DeckShell } from "./DeckShell";
import type { SlideCtx, SlideDef } from "./deckContext";
import type { CallKind } from "./deckData";
import { type Pos, stepFrom } from "./engine";
import { LaunchControls } from "./launchControls";
import { saveLine } from "./NotesWindow";
import type { DeckKind } from "./sources";
import type { DeckIO, DeckModel } from "./useDeckModel";
import { PrepVideos } from "./VideoPrep";

/**
 * Before the call, never shared (DESIGN 12.3): the deck live in a box, a
 * strip of its slides with what each one is missing, the slide's own
 * settings, and Present, which opens the shared deck in its own window.
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
}) {
  const d = model.data;
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
  const sl = saveLine(model.save);
  const missing = slide?.missing?.(d) ?? [];
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
      <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <a
          href={links.client}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden className="size-4" />
          <bdi>{d.nameEn}</bdi>
        </a>
        <span className="text-sm font-semibold">
          Prepare the {DECK_NAME[deck].en.toLowerCase()} deck
        </span>
        <a
          href={links.other}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {deck === "onboarding" ? "The launch deck" : "The onboarding deck"}
        </a>
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
          <Button onClick={links.present}>
            <Presentation aria-hidden />
            Present
          </Button>
        </div>
      </header>

      <div className="grid flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_380px]">
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
                    {i + 1} {t(s.title, "en").replace("{name}", d.nameEn)}
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
            call. Back, Next and the strip move it; the shared deck opens in its
            own window with Present.
          </div>
        </div>

        <aside className="space-y-4 rounded-xl border p-4">
          {slide ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-semibold">
                  Slide {all.indexOf(slide) + 1} ·{" "}
                  {t(slide.title, "en").replace("{name}", d.nameEn)}
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
                      : "None yet: the deck shows their initials.")
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
              {deck === "launch" ? (
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
            {d.mode.dwy ? (
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
            {[...(model.loaded?.problems ?? []), ...d.notes].length ? (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {[...(model.loaded?.problems ?? []), ...d.notes].map(n => (
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
          <PrepVideos model={model} deck={deck} all={all} io={io} />
        </aside>
      </div>
    </div>
  );
}
