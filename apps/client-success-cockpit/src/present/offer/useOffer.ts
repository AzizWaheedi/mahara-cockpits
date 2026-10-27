import { useCallback, useMemo, useRef, useState } from "react";
import { dialectFor } from "../callScript";
import { heldReason } from "../clean";
import type { Lang } from "../content";
import type { DeckData, Overrides } from "../deckData";
import type { LaunchAd } from "../sources";
import type { DeckModel, Loaded } from "../useDeckModel";
import { deckOfOffer, type OfferDeckKind } from "./kinds";
import { belowList, openingOf, type Price } from "./price";
import {
  type CatalogRow,
  copyOf,
  type OfferSources,
  type Pitch,
  type UpsellFile,
} from "./sources";
export interface OfferIO {
  readSources?: () => Promise<OfferSources>;
  savePitch: (
    requestId: string,
    patch: Record<string, unknown>,
    revision: number | null,
  ) => Promise<Pitch>;
  pitchVideo: (
    id: string,
  ) => Promise<{ url: string | null; counted: boolean; note?: string | null }>;
  siteCheck: (url?: string) => Promise<unknown>;
  markWin: (text: string, on: string) => Promise<unknown>;
  upload: (
    file: File,
    on: string,
    searchedAs: string,
    requestId: string,
  ) => Promise<UpsellFile>;
  updateFile: (id: string, patch: Record<string, unknown>) => Promise<unknown>;
  removeFile: (id: string) => Promise<unknown>;
  findLogos: () => Promise<{
    candidates: Array<{
      source: string;
      url: string;
      adId?: string;
      width?: number;
      height?: number;
    }>;
    note?: string | null;
  }>;
  pickLogo: (url: string, requestId: string) => Promise<LaunchAd>;
}
export type CaptureMark = { x: number; y: number; w: number; h: number };
export interface OfferModel {
  stills?: LaunchAd[];
  sources: OfferSources;
  row: CatalogRow | null;
  prep: Overrides;
  refused: boolean;
  opening: Price | null;
  priceProblem: string | null;
  captures: Array<UpsellFile & { mark?: CaptureMark }>;
  goal: { answer: string; on: string | null; key: string } | null;
  dialect: "kw" | "sa";
  pitch: Pitch | null;
  busy: boolean;
  error: string | null;
  savePitch: (patch: Record<string, unknown>) => Promise<Pitch | null>;
  io?: OfferIO;
}
export function selectedCaptures(
  s: OfferSources,
  prep: Overrides,
): OfferModel["captures"] {
  const selected = Array.isArray(prep.captures) ? prep.captures : [];
  return selected.flatMap(raw => {
    if (!raw || typeof raw !== "object") return [];
    const v = raw as { id?: string; mark?: CaptureMark };
    const file = s.files.find(f => f.id === v.id);
    return file?.url ? [{ ...file, mark: v.mark }] : [];
  });
}
function canonical(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export const sameOfferPrepValue = (a: unknown, b: unknown) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export function safeOfferWords(value: string): boolean {
  return (
    !heldReason(value) &&
    !/\b(?:upsell|renewal|leads?|cpl|spend|budget|guarantee)\b|ليدز?|تجديد|ميزانية|ضمان/i.test(
      value,
    )
  );
}
export function offerGoal(s: OfferSources, p: Overrides): OfferModel["goal"] {
  const key = typeof p.goal_pick === "string" ? p.goal_pick : "goal90";
  if (key === "typed")
    return typeof p.goal_typed === "string" &&
      p.goal_typed.trim() &&
      safeOfferWords(p.goal_typed)
      ? {
          answer: p.goal_typed,
          on: typeof p.goal_typed_on === "string" ? p.goal_typed_on : null,
          key,
        }
      : null;
  const value = s.goals[key as keyof typeof s.goals];
  return value && safeOfferWords(value.answer)
    ? { answer: value.answer, on: value.answeredOn, key }
    : null;
}
export function priceProblem(
  row: CatalogRow | null,
  p: Overrides,
): string | null {
  if (!row) return null;
  const price = openingOf(row, p);
  if (!price)
    return "No price yet. Type the opening price, or the CEO sets the list on Money > Offers.";
  if (
    row.locked &&
    row.parts.some(
      part => part.amount === null || price[part.key] !== part.amount,
    )
  )
    return "This price is locked. The CEO sets it on Money > Offers.";
  if (
    belowList(price, row) &&
    !(typeof p.opening_reason === "string" && p.opening_reason.trim())
  )
    return "Add one line explaining the price below list.";
  return null;
}
/** A pitch snapshots server prep. Confirm the presented language before that snapshot. */
export async function confirmOfferPrep(
  prep: Overrides,
  lang: Lang,
  writePrep: DeckModel["setPrep"],
  flush: () => Promise<unknown>,
  readSources?: OfferIO["readSources"],
  deck: OfferDeckKind = "offer_website",
): Promise<void> {
  if (prep.language !== lang) writePrep(deck, { language: lang }, true);
  await flush();
  if (!readSources) return;
  const fresh = await readSources();
  const expected: Overrides = { ...prep, language: lang };
  for (const key of [
    "opening_price",
    "opening_reason",
    "payment_link",
    "language",
    "client_asked",
    "recruiter_name",
  ]) {
    if (!sameOfferPrepValue(expected[key], fresh.prep?.overrides[key])) {
      throw Error(
        "The latest prep has not saved. Retry its save before recording the pitch.",
      );
    }
  }
}

export function useOffer({
  enabled,
  loaded,
  prep,
  d,
  io,
  flush,
  lang,
  writePrep,
}: {
  enabled: boolean;
  loaded: Loaded | null;
  prep: Overrides;
  d: DeckData | null;
  io?: OfferIO;
  flush: DeckModel["flush"];
  lang: Lang;
  writePrep: DeckModel["setPrep"];
}): OfferModel | null {
  const [pitch, setPitch] = useState<Pitch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<string | null>(null);
  const flight = useRef(false);
  const src = enabled ? loaded?.offer : null;
  const save = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!io || !src || flight.current) return null;
      flight.current = true;
      setBusy(true);
      setError(null);
      try {
        await confirmOfferPrep(
          prep,
          lang,
          writePrep,
          flush,
          io.readSources,
          deckOfOffer(src.catalog?.offerKey ?? "website"),
        );
        const old = pitch ?? src.pitches.find(p => !p.answer) ?? null;
        request.current ??= old?.requestId ?? crypto.randomUUID();
        const saved = await io.savePitch(
          request.current,
          patch,
          old?.revision ?? null,
        );
        setPitch(saved);
        return saved;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return null;
      } finally {
        flight.current = false;
        setBusy(false);
      }
    },
    [io, src, pitch, flush, prep, lang, writePrep],
  );
  return useMemo(
    () =>
      src
        ? {
            stills: loaded?.ads.filter(
              a =>
                Array.isArray(prep.example_stills) &&
                prep.example_stills.includes(a.id) &&
                a.mime.startsWith("image/"),
            ),
            sources: src,
            row: src.catalog,
            prep,
            refused: src.mode === "refused",
            opening: src.catalog ? openingOf(src.catalog, prep) : null,
            priceProblem: priceProblem(src.catalog, prep),
            captures: selectedCaptures(src, prep),
            goal: offerGoal(src, prep),
            dialect: dialectFor(prep.dialect, src.country, d?.country).dialect,
            pitch: pitch ?? src.pitches.find(p => !p.answer) ?? null,
            busy,
            error,
            savePitch: save,
            io,
          }
        : null,
    [src, prep, d, pitch, busy, error, save, io, loaded],
  );
}
export const offerCopy = (m: OfferModel, lang: "en" | "ar") =>
  m.row ? copyOf(m.row, lang) : null;
