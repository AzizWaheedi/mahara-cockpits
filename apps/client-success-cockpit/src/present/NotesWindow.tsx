import {
  ArrowLeft,
  ArrowRight,
  Copy,
  MessageCircleQuestion,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { focusOf } from "./AdsStage";
import { makeAddFiles } from "./adsActions";
import type { DeckMessage } from "./channel";
import { DECK_NAME, t } from "./content";
import { groupLinks, Segmented, SlideControls } from "./controls";
import { fillNotes, type SlideCtx, type SlideDef } from "./deckContext";
import type { CallKind } from "./deckData";
import { TARGET_MINUTES } from "./decks";
import { LaunchControls } from "./launchControls";
import type { DeckKind } from "./sources";
import type { DeckIO, DeckModel, SaveState } from "./useDeckModel";

/**
 * The CSM's own window (DESIGN 12.2): opened with N, never shared. It
 * follows the deck over the hub and moves it (Next and Back here move the
 * deck), and holds what must never touch the canvas: the talk track, the
 * temp checks, the facts only the CSM sees, the slide's controls, the
 * booking buttons and the links to paste in the group.
 */

type DeckState = Extract<DeckMessage, { type: "state" }>;

export function saveLine(s: SaveState): {
  text: string;
  tone: "muted" | "good" | "bad";
} {
  if (s.kind === "saving") return { text: "Saving…", tone: "muted" };
  if (s.kind === "saved")
    return {
      text: s.changed ? "Saved" : "Saved, nothing changed",
      tone: "good",
    };
  if (s.kind === "error") return { text: s.message, tone: "bad" };
  return { text: "Changes save as you make them.", tone: "muted" };
}

function clockOf(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2 border-t pt-3">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export function NotesWindow({
  model,
  deck,
  slides,
  base,
  book,
  io,
}: {
  model: DeckModel;
  deck: DeckKind;
  slides: SlideDef[];
  base: Omit<SlideCtx, "tour" | "setTour">;
  book?: (kind: CallKind, label: string) => ReactNode;
  io?: DeckIO;
}) {
  const { hub, data: d } = model;
  const [at, setAt] = useState<DeckState | null>(null);
  const [now, setNow] = useState(Date.now());
  const [copied, setCopied] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const addFiles = useMemo(
    () =>
      io
        ? makeAddFiles(
            model,
            io,
            () => (at?.slideId === "ads" ? focusOf(at.tour) : null),
            r => {
              if (r.phase === "refused" && r.message)
                setMessages(m => [r.message as string, ...m].slice(0, 3));
            },
          )
        : undefined,
    [model, io, at],
  );

  useEffect(() => {
    const off = hub.on(m => {
      if (m.type === "state") setAt(m);
    });
    hub.post({ type: "hello", from: "notes" });
    return off;
  }, [hub]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  // The arrows here move the deck, unless a field has the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "SELECT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === "PageDown")
        hub.post({ type: "nav", to: "next" });
      else if (e.key === "ArrowLeft" || e.key === "PageUp")
        hub.post({ type: "nav", to: "prev" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hub]);

  const index = at ? Math.min(at.index, slides.length - 1) : 0;
  const slide = slides[index];
  const tour = at?.tour ?? 0;
  const ctx: SlideCtx = { ...base, tour, setTour: () => {} };
  const stops = at?.stops ?? Math.max(1, slide?.stops?.(ctx) ?? 1);
  const links = useMemo(() => (d ? groupLinks(d) : null), [d]);
  if (!d || !slide)
    return (
      <div className="p-6 text-sm text-muted-foreground">Reading the deck…</div>
    );

  const elapsed = at ? now - at.startedAt : 0;
  const target = TARGET_MINUTES[deck] * 60_000;
  const slots = {
    service: d.serviceFocus ?? "the launch service",
    csm: d.csmFirst ?? "",
  };
  const notes = slide.notes;
  const stopName = slide.stopName?.(tour, ctx);
  const nextSlide = slides[index + 1];
  const sl = saveLine(model.save);
  const presentedAt = d.presentedAt;

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            Notes · {DECK_NAME[deck].en} · <bdi>{d.nameEn}</bdi>
          </span>
          <span
            className={cn(
              "tabular-nums",
              elapsed > target && "font-semibold txt-warn",
            )}
            title="Elapsed against the deck's target"
          >
            {at ? clockOf(elapsed) : "0:00"} / {TARGET_MINUTES[deck]}:00
          </span>
        </div>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-mono text-sm tabular-nums text-muted-foreground">
            {String(index + 1).padStart(2, "0")} / {slides.length}
          </span>
          <h1 className="min-w-0 truncate text-base font-semibold">
            {t(slide.title, "en").replace("{name}", d.nameEn)}
          </h1>
        </div>
        <div className="text-xs text-muted-foreground">
          {stops > 1
            ? `Stop ${tour + 1} of ${stops}${stopName ? `: ${stopName.en}` : ""}`
            : "One stop"}
          {at ? "" : " · open the deck window to follow it here"}
        </div>
      </header>

      <main className="flex-1 space-y-4 px-4 py-4 text-sm leading-6">
        <section className="space-y-2">
          <h3 className="text-xs font-medium text-muted-foreground">Say</h3>
          <ul className="list-disc space-y-1.5 pl-4">
            {fillNotes(notes.say, slots).map(l => (
              <li key={l}>{l}</li>
            ))}
            {d.mode.dwy && notes.dwy
              ? fillNotes(notes.dwy, slots).map(l => (
                  <li key={l} className="txt-warn">
                    Done with you: {l}
                  </li>
                ))
              : null}
          </ul>
          {model.lang === "ar" && notes.sayAr.length ? (
            <h3 className="pt-1 text-xs font-medium text-muted-foreground">
              Said in Arabic
            </h3>
          ) : null}
          {model.lang === "ar" && notes.sayAr.length ? (
            <ul
              dir="rtl"
              className="list-disc space-y-1.5 pr-4 text-[15px] leading-7"
            >
              {fillNotes(notes.sayAr, slots).map(l => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : null}
          {notes.temp ? (
            <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2">
              <MessageCircleQuestion
                aria-hidden
                className="mt-0.5 size-4 shrink-0 txt-warn"
              />
              <div>
                <div className="text-xs font-medium txt-warn">Temp check</div>
                <div>{fillNotes([notes.temp.en], slots)[0]}</div>
                {model.lang === "ar" ? (
                  <div dir="rtl">{fillNotes([notes.temp.ar], slots)[0]}</div>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        <Section title="Only you see this">
          <ul className="space-y-1 text-muted-foreground">
            {model.error ? (
              <li className="txt-bad">
                The deck could not be read again just now: {model.error} The
                slides keep what they had.
              </li>
            ) : null}
            {[...model.loaded!.problems, ...d.notes].map(n => (
              <li key={n}>{n}</li>
            ))}
            {slide.missing?.(d).map(n => (
              <li key={n} className="txt-warn">
                {n}
              </li>
            ))}
          </ul>
        </Section>

        {slide.id === "team" ||
        slide.id === "welcome" ||
        slide.id === "cover" ||
        slide.id === "journey" ? (
          <Section title="This client's service model">
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
            <div className="text-xs text-muted-foreground">
              {d.mode.from === "prep"
                ? "Set here."
                : d.mode.known
                  ? `From the ${d.mode.from === "card" ? "ClickUp card" : "HighLevel account"}.`
                  : "Not set on the card. The deck uses done for you."}
            </div>
          </Section>
        ) : null}

        {deck === "launch" ? (
          <LaunchControls
            slideId={slide.id}
            d={d}
            model={model}
            tour={tour}
            book={book}
            addFiles={addFiles}
            updateAd={io?.updateAd}
            sendKey={key => hub.post({ type: "key", key })}
            messages={messages}
            now={now}
            still={base.still}
          />
        ) : (
          <SlideControls
            slideId={slide.id}
            d={d}
            deck={deck}
            prep={model.prep}
            setPrep={model.setPrep}
            book={book}
          />
        )}

        {slide.id === "this-week" && links ? (
          <Section title="Links for the group">
            <pre className="whitespace-pre-wrap rounded-lg border bg-muted/30 p-2 text-xs">
              {links.text}
            </pre>
            {links.missing.map(m => (
              <div key={m} className="text-xs txt-warn">
                {m}
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard?.writeText(links.text).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                });
              }}
            >
              <Copy aria-hidden />
              {copied
                ? "Copied. Paste it in the group."
                : "Copy links for the group"}
            </Button>
          </Section>
        ) : null}

        {deck === "onboarding" && presentedAt ? (
          <div className="text-xs text-muted-foreground">
            Marked as presented, so the launch deck leaves out the hours card.
          </div>
        ) : null}
      </main>

      <footer className="sticky bottom-0 border-t bg-background/95 px-4 py-3 backdrop-blur">
        <div
          className={cn(
            "mb-2 flex items-center justify-between gap-2 text-xs",
            sl.tone === "bad"
              ? "txt-bad"
              : sl.tone === "good"
                ? "txt-good"
                : "text-muted-foreground",
          )}
          role="status"
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
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => hub.post({ type: "nav", to: "prev" })}
          >
            <ArrowLeft aria-hidden />
            Back
          </Button>
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {tour + 1 < stops
              ? "Next: the next stop"
              : nextSlide
                ? `Next: ${t(nextSlide.title, "en").replace("{name}", d.nameEn)}`
                : "Last slide"}
          </span>
          <Button onClick={() => hub.post({ type: "nav", to: "next" })}>
            Next
            <ArrowRight aria-hidden />
          </Button>
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          Share the deck window only, maximised rather than full screen.
        </div>
      </footer>
    </div>
  );
}
