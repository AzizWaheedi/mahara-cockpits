import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { emptyLive } from "../channel";
import { CHROME, digits, type Lang } from "../content";
import { DeckShell } from "../DeckShell";
import { deckData } from "../deckData";
import { offerSlides } from "../decks";
import { type Pos, stepFrom } from "../engine";
import { deckOfOffer } from "./kinds";
import { openingOf } from "./price";
import type { CatalogRow, OfferSources } from "./sources";
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
export default function CatalogDeckCanvas({
  row,
  onClose,
}: {
  row: CatalogRow;
  onClose: () => void;
}) {
  const [lang, setLang] = useState<Lang>("en");
  const [pos, setPos] = useState<Pos>({ index: 0, tour: 0 });
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
    () =>
      offerSlides(deck, model)
        .filter(s =>
          s.id !== "saw" && s.id !== "video" && s.id !== "runs"
            ? s.defaultHidden?.(d) !== true
            : s.id === "runs",
        )
        .map(s =>
          row.offerKey === "website" && s.id === "investment"
            ? { ...s, stops: () => 1 }
            : s,
        ),
    [deck, model, d, row.offerKey],
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
    still: false,
    presenting: true,
    offer: model,
  };
  const stops = slides.map(s =>
    Math.max(1, s.stops?.({ ...base, tour: 0, setTour: () => {} }) ?? 1),
  );
  const previous = stepFrom(pos, -1, stops),
    next = stepFrom(pos, 1, stops);
  return (
    <div className="dks-preview-layout">
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
      <nav className="dks-preview-controls" aria-label="Deck preview controls">
        <Button
          variant="outline"
          disabled={!previous}
          onClick={() => {
            if (previous) setPos(previous);
          }}
        >
          {CHROME.prev[lang]}
        </Button>
        <span aria-live="polite">
          {digits(pos.index + 1, lang)} / {digits(slides.length, lang)}
        </span>
        <Button
          variant="outline"
          disabled={!next}
          onClick={() => {
            if (next) setPos(next);
          }}
        >
          {CHROME.next[lang]}
        </Button>
        <Button
          variant="ghost"
          onClick={() => setLang(lang === "en" ? "ar" : "en")}
        >
          {lang === "en" ? "العربية" : "English"}
        </Button>
      </nav>
    </div>
  );
}
