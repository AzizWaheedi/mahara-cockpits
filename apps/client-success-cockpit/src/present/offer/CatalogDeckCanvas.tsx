import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { emptyLive } from "../channel";
import { CHROME, digits, type Lang, VIDEO } from "../content";
import { DeckShell } from "../DeckShell";
import { deckData } from "../deckData";
import { offerSlides, prefersStill } from "../decks";
import { type Pos, stepFrom } from "../engine";
import { OFFER_CHROME } from "./content/shared";
import { deckOfOffer } from "./kinds";
import { openingOf } from "./price";
import { type CatalogRow, copyOf, type OfferSources } from "./sources";
import { type OfferModel, priceProblem } from "./useOffer";
/** Explicitly client-free: this model has no IO, prep saver, telemetry or record identity. */
export function catalogPreviewModel(row: CatalogRow): OfferModel {
  const sources: OfferSources = {
    mode: "proactive",
    gate: {
      ok: false,
      taskId: "catalog-preview",
      checkedAt: row.updatedAt,
      reasons: [],
      passed: [],
      win: { kind: null, on: null, text: null },
      renewal: { date: null, from: null },
      lastOffer: null,
    },
    catalog: row,
    prep: null,
    files: [],
    site: {
      verdict: "not_checked",
      urls: [],
      checks: [],
      disagree: false,
      instagramOnly: false,
      note: null,
    },
    project: { onboarding: null, sheet: null },
    goals: { goal90: null, goal12_24: null, challenges: null, why: null },
    country: null,
    currency: "USD",
    fx: { usdPer: 1, from: "USD list price" },
    pitches: [],
    heldFullRecently: false,
    doorLive: false,
    at: row.updatedAt,
  };
  return {
    sources,
    row,
    prep: {},
    refused: false,
    opening: openingOf(row, {}),
    priceProblem: priceProblem(row, {}),
    captures: [],
    goal: null,
    dialect: "kw",
    pitch: null,
    busy: false,
    error: null,
    savePitch: async () => null,
  };
}
/** Generic story only: no client diagnosis, recorded pitch, invented quote or blank slide. */
export function catalogQuickSlides(
  row: CatalogRow,
  model: OfferModel,
  showListPrice = false,
) {
  if (!copyOf(row, "en") || !copyOf(row, "ar")) return [];
  const order = ["matters", "get", "examples", "runs", "investment", "next"];
  return offerSlides(deckOfOffer(row.offerKey), model)
    .filter(
      s =>
        order.includes(s.id) &&
        (s.id !== "investment" ||
          (showListPrice &&
            row.offerKey !== "closer" &&
            !!model.opening &&
            !model.priceProblem)),
    )
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    .map(s =>
      row.offerKey === "website" && s.id === "investment"
        ? { ...s, stops: () => 1 }
        : s,
    );
}
export default function CatalogDeckCanvas({
  row,
  onClose,
  showListPrice = false,
  expanded = false,
  onExpandedChange,
}: {
  row: CatalogRow;
  onClose: () => void;
  showListPrice?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [lang, setLang] = useState<Lang>("en"),
    [pos, setPos] = useState<Pos>({ index: 0, tour: 0 });
  const [screenError, setScreenError] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const deck = deckOfOffer(row.offerKey);
  const model = useMemo(() => catalogPreviewModel(row), [row]);
  const d = useMemo(
    () => ({
      ...deckData({
        taskId: "catalog-preview",
        deck,
        lang,
        sources: null,
        kit: null,
        prep: { onboarding: {}, launch: {} },
        ads: [],
        now: new Date(row.updatedAt),
      }),
      name: "Mahara Media",
      nameEn: "Mahara Media",
    }),
    [deck, lang, row.updatedAt],
  );
  const slides = useMemo(
    () => catalogQuickSlides(row, model, showListPrice),
    [row, model, showListPrice],
  );
  const base = {
    d,
    lang,
    deck,
    prep: {},
    prepOf: () => ({}),
    save: () => {},
    saveTo: () => {},
    live: emptyLive(),
    setLive: () => {},
    still: prefersStill(),
    presenting: true,
    offer: model,
  };
  const stops = slides.map(s =>
    Math.max(1, s.stops?.({ ...base, tour: 0, setTour: () => {} }) ?? 1),
  );
  const previous = stepFrom(pos, -1, stops),
    next = stepFrom(pos, 1, stops);
  // The list-price switch changes the story; it never changes the client or the catalogue.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset navigation when the optional price chapter changes.
  useEffect(() => {
    setPos({ index: 0, tour: 0 });
  }, [showListPrice]);
  const full = async () => {
    try {
      setScreenError(null);
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        onExpandedChange?.(false);
      } else if (expanded) {
        onExpandedChange?.(false);
      } else {
        // The browser-sized view is also the fallback when native full screen is blocked.
        onExpandedChange?.(true);
        if (container.current?.requestFullscreen)
          await container.current.requestFullscreen();
        else if (!onExpandedChange)
          setScreenError("Full screen is unavailable in this browser.");
      }
    } catch {
      if (!onExpandedChange)
        setScreenError(
          "Full screen is unavailable. The deck remains open here.",
        );
    }
  };
  useEffect(() => {
    const changed = () =>
      onExpandedChange?.(document.fullscreenElement === container.current);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, [onExpandedChange]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        target?.closest(
          "input,select,textarea,[contenteditable=true],iframe,[role=combobox],[role=listbox],[role=option]",
        )
      )
        return;
      const space = e.key === " " && !target?.closest("button,a");
      if (e.key === "ArrowRight" || e.key === "PageDown" || space) {
        e.preventDefault();
        if (next) setPos(next);
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        if (previous) setPos(previous);
      } else if (e.key === "Home") {
        e.preventDefault();
        setPos({ index: 0, tour: 0 });
      } else if (e.key === "End") {
        e.preventDefault();
        setPos({
          index: Math.max(0, slides.length - 1),
          tour: Math.max(0, (stops.at(-1) ?? 1) - 1),
        });
      } else if (e.key.toLowerCase() === "l") {
        e.preventDefault();
        setLang(v => (v === "en" ? "ar" : "en"));
      } else if (e.key.toLowerCase() === "f") {
        e.preventDefault();
        void full();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  if (!slides.length)
    return (
      <div className="dkq-unavailable" role="alert">
        <h2>This deck is not available yet.</h2>
        <p>
          The approved catalogue copy could not be read. Close this view and try
          again.
        </p>
        <Button variant="outline" onClick={onClose}>
          {VIDEO.close[lang]}
        </Button>
      </div>
    );
  const slide = slides[pos.index] ?? slides[0];
  return (
    <div
      className="dks-preview-layout"
      ref={container}
      data-quick-pitch={row.offerKey}
    >
      <div className="dkq-example-banner" dir={lang === "ar" ? "rtl" : "ltr"}>
        {OFFER_CHROME.example[lang].split(/[,،]/)[0]}
      </div>
      <div className="dks-preview-stage">
        <DeckShell
          slides={slides}
          base={base}
          setLang={setLang}
          hub={null}
          embedded
          endsInPlace
          onBack={onClose}
          pos={pos}
          setPos={setPos}
        />
      </div>
      <nav
        className="dks-preview-controls dkq-controls"
        aria-label="Quick pitch controls"
        dir={lang === "ar" ? "rtl" : "ltr"}
      >
        <Button
          variant="outline"
          disabled={!previous}
          onClick={() => {
            if (previous) setPos(previous);
          }}
        >
          {CHROME.prev[lang]}
        </Button>
        <div className="dkq-chapters">
          <span className="sr-only">{CHROME.all[lang]}</span>
          <AnimatedSelect
            aria-label={CHROME.all[lang]}
            portalContainer={container.current}
            value={slide.id}
            onChange={e =>
              setPos({
                index: slides.findIndex(s => s.id === e.target.value),
                tour: 0,
              })
            }
          >
            {slides.map(s => (
              <option value={s.id} key={s.id}>
                {s.title[lang]}
              </option>
            ))}
          </AnimatedSelect>
          <span aria-live="polite">
            {digits(pos.index + 1, lang)} / {digits(slides.length, lang)} ·{" "}
            {digits(pos.tour + 1, lang)} / {digits(stops[pos.index] ?? 1, lang)}
          </span>
        </div>
        <Button
          onClick={() => {
            if (next) setPos(next);
            else onClose();
          }}
        >
          {next ? CHROME.next[lang] : VIDEO.close[lang]}
        </Button>
        <div className="dkq-control-tools">
          <Button
            variant="ghost"
            onClick={() => setLang(lang === "en" ? "ar" : "en")}
          >
            {lang === "en" ? "العربية" : "English"}
          </Button>
          <Button
            variant="ghost"
            aria-label={CHROME.full[lang]}
            title={CHROME.full[lang]}
            onClick={() => void full()}
          >
            {expanded ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
          </Button>
        </div>
      </nav>
      {screenError ? (
        <p className="dkq-screen-error" role="status">
          {screenError}
        </p>
      ) : null}
    </div>
  );
}
