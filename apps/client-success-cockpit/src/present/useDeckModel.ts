import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OnboardingRow } from "@/lib/onboardingCore";
import { DeckHub, emptyLive, type LiveState } from "./channel";
import type { Lang } from "./content";
import {
  type CallKind,
  type DeckData,
  deckData,
  type Overrides,
} from "./deckData";
import { langParam } from "./engine";
import { applyPatch, PrepSaver } from "./prep";
import type { DeckKind, DeckSources, LaunchAd, SavedPrep } from "./sources";

/**
 * One client's deck in one window: what was read, the prep as typed, the
 * call's own state, the language, and the hub that keeps the deck, the
 * notes window and the prep view in step (DESIGN 12.2, 16.4). The reads and
 * the save are handed in, so the harness runs the same model on fixtures.
 */

export interface Loaded {
  sources: DeckSources | null;
  kit: OnboardingRow | null;
  ads: LaunchAd[];
  prep: { onboarding: Overrides; launch: Overrides };
  /** What could not be read, in plain sentences (the notes and prep show them). */
  problems: string[];
}

export interface DeckIO {
  load: () => Promise<Loaded>;
  savePrep: (deck: DeckKind, patch: Overrides) => Promise<SavedPrep>;
  presenterName?: string | null;
  publicUrl?: (bucket: string, path: string) => string;
  now?: () => Date;
}

export type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: number; changed: boolean }
  | { kind: "error"; message: string };

const LANG_KEY = "csm_deck_lang";

function storedLang(): Lang | null {
  try {
    const v = localStorage.getItem(LANG_KEY);
    return v === "en" || v === "ar" ? v : null;
  } catch {
    return null;
  }
}

/** The client's language as the cockpit or HighLevel knows it. */
const clientLang = (s: DeckSources | null): Lang | null => {
  const v = String(s?.ghl?.language ?? "").toLowerCase();
  if (v.startsWith("ar")) return "ar";
  if (v.startsWith("en")) return "en";
  return null;
};

export function useDeckModel({
  taskId,
  deck,
  io,
  hubName,
}: {
  taskId: string;
  deck: DeckKind;
  io: DeckIO;
  /** Null: no hub (the prep preview runs alone). */
  hubName: string | null;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prep, setPrepState] = useState<Loaded["prep"]>({
    onboarding: {},
    launch: {},
  });
  const prepRef = useRef(prep);
  prepRef.current = prep;
  const [live, setLiveState] = useState<LiveState>(emptyLive);
  const [booked, setBooked] = useState<Partial<Record<CallKind, string>>>({});
  const asked = langParam(window.location.search);
  const [lang, setLangState] = useState<Lang>(
    () => asked ?? storedLang() ?? "en",
  );
  const langChosen = useRef(Boolean(asked ?? storedLang()));
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  // The channel is opened by an effect, not a memo: StrictMode mounts twice
  // and the first cleanup would otherwise close the one channel for good.
  const [hub, setHub] = useState<DeckHub>(() => new DeckHub(null));
  useEffect(() => {
    const h = new DeckHub(hubName);
    setHub(h);
    return () => h.close();
  }, [hubName]);

  const ioRef = useRef(io);
  ioRef.current = io;
  const reload = useCallback(async () => {
    try {
      const out = await ioRef.current.load();
      setLoaded(out);
      setPrepState(out.prep);
      setError(null);
      // The client's own language, unless the address or the CSM chose one.
      if (!langChosen.current) {
        const own =
          (out.prep[deck].language as Lang | undefined) ??
          clientLang(out.sources);
        if (own === "en" || own === "ar") setLangState(own);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [deck]);
  useEffect(() => {
    void reload();
  }, [reload]);

  // One saver per deck: typed fields wait 600 ms, ticks go at once.
  const savers = useMemo(() => {
    const make = (k: DeckKind) =>
      new PrepSaver({
        save: patch => {
          setSave({ kind: "saving" });
          return ioRef.current.savePrep(k, patch);
        },
        onSaved: row =>
          setSave({
            kind: "saved",
            at: Date.now(),
            changed: row.changed !== false,
          }),
        onError: message => setSave({ kind: "error", message }),
      });
    return { onboarding: make("onboarding"), launch: make("launch") };
  }, []);
  useEffect(
    () => () => {
      void savers.onboarding.flush();
      void savers.launch.flush();
    },
    [savers],
  );

  const setPrep = useCallback(
    (k: DeckKind, patch: Overrides, now = false) => {
      const refused = savers[k].set(patch, now);
      if (refused) {
        setSave({ kind: "error", message: refused });
        return;
      }
      const next = applyPatch(prepRef.current[k], patch);
      const all = { ...prepRef.current, [k]: next };
      prepRef.current = all;
      setPrepState(all);
      hub.post({ type: "prep", deck: k, overrides: next, revision: 0 });
    },
    [hub, savers],
  );

  const setLive = useCallback(
    (fn: (l: LiveState) => LiveState) => {
      setLiveState(l => {
        const next = fn(l);
        hub.post({ type: "live", live: next });
        return next;
      });
    },
    [hub],
  );

  const setLang = useCallback(
    (l: Lang) => {
      langChosen.current = true;
      setLangState(l);
      try {
        localStorage.setItem(LANG_KEY, l);
      } catch {
        // it still switches, it just forgets
      }
      hub.post({ type: "lang", lang: l });
    },
    [hub],
  );

  const book = useCallback(
    (kind: CallKind, startTime: string) => {
      setBooked(b => ({ ...b, [kind]: startTime }));
      hub.post({ type: "booked", kind, startTime });
    },
    [hub],
  );

  // What the other windows say.
  useEffect(
    () =>
      hub.on(m => {
        if (m.type === "prep") {
          const all = { ...prepRef.current, [m.deck]: m.overrides };
          prepRef.current = all;
          setPrepState(all);
        } else if (m.type === "live") setLiveState(m.live);
        else if (m.type === "booked")
          setBooked(b => ({ ...b, [m.kind]: m.startTime }));
        else if (m.type === "lang") {
          langChosen.current = true;
          setLangState(m.lang);
        } else if (m.type === "ads") void reload();
      }),
    [hub, reload],
  );

  const data: DeckData | null = useMemo(() => {
    if (!loaded) return null;
    return deckData({
      taskId,
      deck,
      lang,
      sources: loaded.sources,
      kit: loaded.kit,
      prep,
      ads: loaded.ads,
      presenterName: io.presenterName,
      booked,
      publicUrl: io.publicUrl,
      now: io.now?.() ?? new Date(),
    });
  }, [loaded, taskId, deck, lang, prep, booked, io]);

  return {
    loaded,
    error,
    data,
    prep,
    setPrep,
    live,
    setLive,
    booked,
    book,
    lang,
    setLang,
    hub,
    save,
    reload,
    flush: () =>
      Promise.all([savers.onboarding.flush(), savers.launch.flush()]),
  };
}

export type DeckModel = ReturnType<typeof useDeckModel>;
