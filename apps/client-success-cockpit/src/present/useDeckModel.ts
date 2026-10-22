import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OnboardingRow } from "@/lib/onboardingCore";
import {
  DeckHub,
  type DeckMessage,
  emptyLive,
  type LiveState,
  newerLive,
  readStoredLive,
  storeLive,
} from "./channel";
import type { Lang } from "./content";
import {
  type CallKind,
  type DeckData,
  deckData,
  type Overrides,
} from "./deckData";
import { langParam } from "./engine";
import { applyPatch, PrepSaver, prepAfterLoad } from "./prep";
import {
  type clearDeckVideo,
  type DeckKind,
  type DeckSources,
  type DeckVideos,
  type DriveImport,
  type DriveImports,
  type FileFacts,
  keepLinks,
  type LaunchAd,
  preloadMedia,
  type SavedPrep,
  SIGN_FRESH_MS,
  SIGNED_LINK,
  type saveDeckVideo,
} from "./sources";
import { localAds } from "./uploads";

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
  /** This deck's video slots (VIDEOS.md 7): null or absent is "not read". */
  videos?: DeckVideos | null;
  /** Why the videos were not read, for the notes and prep. */
  videosProblem?: string | null;
}

export interface DeckIO {
  load: () => Promise<Loaded>;
  savePrep: (deck: DeckKind, patch: Overrides) => Promise<SavedPrep>;
  presenterName?: string | null;
  publicUrl?: (bucket: string, path: string) => string;
  now?: () => Date;
  /** Save a creative to the client's ads tray (launchAds reserve, PUT, ready). */
  uploadAd?: (args: {
    file: File;
    kind: "starter" | "custom" | "logo" | "page";
    facts: FileFacts;
    onProgress: (share: number) => void;
  }) => Promise<LaunchAd>;
  /** Change an upload's words, placement, kind or hidden flag. */
  updateAd?: (id: string, patch: Record<string, unknown>) => Promise<LaunchAd>;
  /** Delete a file from the client's tray for good (prep's tray, launchAds.remove). */
  removeAd?: (id: string) => Promise<LaunchAd>;
  /** Read a file's size, length and first frame. */
  fileFacts?: (file: File) => Promise<FileFacts>;
  /** Save a video to one of this deck's slots (shared by every client's deck). */
  saveVideo?: (
    v: Parameters<typeof saveDeckVideo>[1],
  ) => ReturnType<typeof saveDeckVideo>;
  /** Clear a slot's video for one language. */
  clearVideo?: (
    v: Parameters<typeof clearDeckVideo>[1],
  ) => ReturnType<typeof clearDeckVideo>;
  /** Bring in this client's files from one Drive link (DRIVE-IMPORT.md 8). */
  requestDriveImport?: (
    link: string,
  ) => Promise<DriveImport & { existing: boolean }>;
  /** This client's Drive imports, newest first. */
  readDriveImports?: () => Promise<DriveImports>;
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
  // A reloaded tab keeps the call's state (sessionStorage); a new window
  // takes it from the others when it joins (below).
  const [live, setLiveState] = useState<LiveState>(
    () => readStoredLive(hubName) ?? emptyLive(),
  );
  const liveRef = useRef(live);
  liveRef.current = live;
  useEffect(() => storeLive(hubName, live), [hubName, live]);
  const [booked, setBooked] = useState<Partial<Record<CallKind, string>>>({});
  const bookedRef = useRef(booked);
  bookedRef.current = booked;
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
  const firstLoad = useRef(true);
  const loadedRef = useRef<Loaded | null>(null);
  /** When the tray's read links were signed (DESIGN 10.6). */
  const signedAt = useRef(0);
  const reload = useCallback(
    async (opts?: { resign?: boolean }) => {
      try {
        const read = await ioRef.current.load();
        // Fresh links stay as they are drawn; stale or broken ones are replaced.
        const prev = loadedRef.current;
        const fresh =
          !opts?.resign &&
          prev !== null &&
          Date.now() - signedAt.current < SIGN_FRESH_MS;
        const out = fresh
          ? { ...read, ads: keepLinks(prev.ads, read.ads) }
          : read;
        if (!fresh) signedAt.current = Date.now();
        loadedRef.current = out;
        setLoaded(out);
        preloadMedia(
          out.ads,
          (out.sources?.meta?.ads ?? []).map(a => a.still?.url),
        );
        // Files saved on the call now come back in the tray: free their local copies.
        localAds.release(out.ads.map(a => a.id));
        // Prep comes from the server on the first read only (prepAfterLoad).
        const nextPrep = prepAfterLoad(
          prepRef.current,
          out.prep,
          firstLoad.current,
        );
        firstLoad.current = false;
        prepRef.current = nextPrep;
        setPrepState(nextPrep);
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
    },
    [deck],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  // Read links last an hour: signed again before they lapse, and at once
  // when a picture or video fails to load (at most every 20 seconds).
  useEffect(() => {
    const timer = window.setInterval(() => {
      const ads = loadedRef.current?.ads ?? [];
      if (ads.some(a => a.url) && Date.now() - signedAt.current > SIGN_FRESH_MS)
        void reload({ resign: true });
    }, 60_000);
    let last = 0;
    const onError = (e: Event) => {
      const el = e.target as HTMLImageElement | HTMLVideoElement | null;
      if (!el || (el.tagName !== "IMG" && el.tagName !== "VIDEO")) return;
      if (!SIGNED_LINK.test(el.currentSrc || el.src || "")) return;
      if (Date.now() - last < 20_000) return;
      last = Date.now();
      void reload({ resign: true });
    };
    document.addEventListener("error", onError, true);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("error", onError, true);
    };
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
  // A save that failed offline goes again when the connection comes back.
  useEffect(() => {
    const again = () => {
      void savers.onboarding.flush();
      void savers.launch.flush();
    };
    window.addEventListener("online", again);
    return () => window.removeEventListener("online", again);
  }, [savers]);

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
        // Stamped, and never earlier than what it replaces.
        const next = { ...fn(l), at: Math.max(Date.now(), (l.at ?? 0) + 1) };
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
        } else if (m.type === "live" || m.type === "sync") {
          setLiveState(cur => newerLive(cur, m.live));
          if (m.type === "sync") setBooked(b => ({ ...m.booked, ...b }));
        } else if (m.type === "join") {
          // A window opened or reloaded mid-call: hand it the call's state.
          const l = liveRef.current;
          const b = bookedRef.current;
          if (l.at || Object.keys(b).length)
            hub.post({ type: "sync", live: l, booked: b });
        } else if (m.type === "booked")
          setBooked(b => ({ ...b, [m.kind]: m.startTime }));
        else if (m.type === "lang") {
          langChosen.current = true;
          setLangState(m.lang);
        } else if (m.type === "ads" || m.type === "videos") void reload();
        else if (m.type === "file" || m.type === "upload") localAds.apply(m);
      }),
    [hub, reload],
  );
  // Ask the open windows for the call's state once this window listens.
  useEffect(() => {
    hub.post({ type: "join" });
  }, [hub]);

  /** Tell every window, this one included. */
  const emit = useCallback(
    (m: DeckMessage) => {
      if (m.type === "file" || m.type === "upload") localAds.apply(m);
      hub.post(m);
    },
    [hub],
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
      videos: loaded.videos ?? null,
      videosProblem: loaded.videosProblem ?? null,
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
    emit,
    save,
    reload,
    flush: () =>
      Promise.all([savers.onboarding.flush(), savers.launch.flush()]),
  };
}

export type DeckModel = ReturnType<typeof useDeckModel>;
