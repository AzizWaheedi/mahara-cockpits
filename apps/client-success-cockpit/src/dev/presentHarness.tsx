/**
 * The client decks from fixtures, to see and screenshot every slide without
 * signing in. `bunx vite`, then open
 * /client-success/present-harness.html?fixture=full&deck=onboarding&lang=en
 * (fixture: full | sparse | dwy | starter; view: present | notes | prep;
 * still=1 for no motion). Saves and uploads stay in memory (an upload
 * pretends to take a second and a half); nothing is sent anywhere.
 *
 * scripts/deck-shots.mjs drives it to capture every slide and stop.
 */

import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import type { Overrides } from "@/present/deckData";
import { PresentApp, type View } from "@/present/PresentApp";
import { applyPatch } from "@/present/prep";
import {
  type DeckKind,
  type DeckVideos,
  type LaunchAd,
  type VideoRow,
  VideoSaveError,
} from "@/present/sources";
import type { DeckIO } from "@/present/useDeckModel";
import { FIXTURES, type FixtureKey } from "./deck/fixtures";
import { PartsSheet } from "./deck/PartsSheet";
import "@/index.css";

const params = new URLSearchParams(window.location.search);
const fixture = (params.get("fixture") ?? "full") as FixtureKey;
const deck = (
  params.get("deck") === "launch" ? "launch" : "onboarding"
) as DeckKind;
const view = (params.get("view") ?? "present") as View;

/**
 * The harness's stand-in for the server's link check (VIDEOS.md 3), so prep's
 * Videos section can be tried without signing in. Dev only, and simpler
 * than the server's: the real parse is in the migration.
 */
function harnessParse(
  raw: string,
): Pick<VideoRow, "provider" | "url" | "embedUrl"> {
  const v = raw.trim();
  if (/^http:\/\//i.test(v))
    throw new VideoSaveError("Use the https link.", "22023", "link");
  let m =
    /^https:\/\/(?:www\.)?loom\.com\/(?:share|embed)\/(?:[A-Za-z0-9-]+-)?([0-9a-f]{32})\/?(?:[?#].*)?$/.exec(
      v,
    );
  if (m)
    return {
      provider: "loom",
      url: `https://www.loom.com/share/${m[1]}`,
      embedUrl: `https://www.loom.com/embed/${m[1]}?hideEmbedTopBar=true`,
    };
  m =
    /^https:\/\/fast\.wistia\.net\/embed\/iframe\/([a-z0-9]{10})\/?(?:[?#].*)?$/.exec(
      v,
    );
  if (m)
    return {
      provider: "wistia",
      url: `https://fast.wistia.net/embed/iframe/${m[1]}`,
      embedUrl: `https://fast.wistia.net/embed/iframe/${m[1]}?seo=false`,
    };
  m =
    /^https:\/\/(?:www\.youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[&?#].*)?$/.exec(
      v,
    );
  if (m)
    return {
      provider: "youtube",
      url: `https://www.youtube.com/watch?v=${m[1]}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0&playsinline=1&enablejsapi=1`,
    };
  throw new VideoSaveError(
    "Paste a link from Loom, YouTube, Wistia, Vimeo or Google Drive.",
    "22023",
    "link",
  );
}

/** The harness's address with one setting changed. */
function at(change: Record<string, string | null>) {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(change)) {
    if (v == null) p.delete(k);
    else p.set(k, v);
  }
  return `${window.location.pathname}?${p.toString()}`;
}

function Harness() {
  const io = useMemo<DeckIO>(() => {
    const store: Record<DeckKind, Overrides> = { onboarding: {}, launch: {} };
    const loaded = FIXTURES[fixture]?.(deck) ?? FIXTURES.full(deck);
    store.onboarding = loaded.prep.onboarding;
    store.launch = loaded.prep.launch;
    let ads: LaunchAd[] = [...loaded.ads];
    let revision = 1;
    let videos: DeckVideos | null = loaded.videos ?? null;
    // ?video=youtube: slide 3's recording as a YouTube one (a made-up id),
    // so deck-shots.mjs can stub the player's "can't play here" state.
    if (params.get("video") === "youtube" && videos)
      videos = {
        ...videos,
        rows: videos.rows.map(r =>
          r.slotKey === "testing"
            ? {
                ...r,
                provider: "youtube",
                url: "https://www.youtube.com/watch?v=AAAAAAAAAAA",
                embedUrl:
                  "https://www.youtube-nocookie.com/embed/AAAAAAAAAAA?rel=0&playsinline=1&enablejsapi=1",
              }
            : r,
        ),
      };
    const at = (slotKey: string, lang: string) =>
      videos?.rows.find(r => r.slotKey === slotKey && r.lang === lang) ?? null;
    const conflict = (seen: number, row: VideoRow | null, verb: string) => {
      if ((row?.revision ?? 0) !== seen)
        throw new VideoSaveError(
          `Someone else changed this video just now. Check it, then ${verb}.`,
          "40001",
          null,
        );
    };
    return {
      load: async () => ({
        ...loaded,
        ads: [...ads],
        prep: { ...store },
        videos: videos ? { ...videos, rows: [...videos.rows] } : null,
      }),
      saveVideo: async v => {
        if (!videos)
          throw Error("The deck's videos are not live yet, so no video shows.");
        const before = at(v.slotKey, v.lang);
        conflict(v.revision, before, "save again");
        const title = v.title?.trim() || null;
        if (title && title.length > 40)
          throw new VideoSaveError(
            "Keep the title under 40 characters.",
            "22023",
            "title",
          );
        const row: VideoRow = {
          deck,
          slotKey: v.slotKey,
          lang: v.lang,
          ...harnessParse(v.url),
          title,
          durationSeconds: v.durationSeconds ?? null,
          revision: (before?.revision ?? 0) + 1,
          updatedBy: "harness",
          updatedAt: new Date().toISOString(),
        };
        videos = {
          ...videos,
          rows: [...videos.rows.filter(r => r !== before), row],
        };
        return { ...row, changed: true };
      },
      clearVideo: async v => {
        if (!videos)
          throw Error("The deck's videos are not live yet, so no video shows.");
        const before = at(v.slotKey, v.lang);
        if (!before) return { cleared: false, revision: null };
        conflict(v.revision, before, "clear it again");
        videos = { ...videos, rows: videos.rows.filter(r => r !== before) };
        return { cleared: true, revision: before.revision + 1 };
      },
      uploadAd: async ({ file, kind, facts, onProgress }) => {
        for (let i = 1; i <= 10; i++) {
          await new Promise(r => setTimeout(r, 150));
          onProgress(i / 10);
        }
        const saved: LaunchAd = {
          id: crypto.randomUUID(),
          taskId: `fixture-${fixture}`,
          kind,
          status: "ready",
          path: `fixture/${file.name}`,
          mime: file.type,
          bytes: file.size,
          width: facts.width ?? null,
          height: facts.height ?? null,
          seconds: facts.seconds ?? null,
          fileName: file.name,
          hidden: false,
          url: URL.createObjectURL(file),
          posterUrl: facts.poster ? URL.createObjectURL(facts.poster) : null,
        };
        ads = [...ads, saved];
        return saved;
      },
      updateAd: async (id, patch) => {
        ads = ads.map(a =>
          a.id === id ? ({ ...a, ...patch } as LaunchAd) : a,
        );
        const out = ads.find(a => a.id === id);
        if (!out) throw Error("Not in this harness's tray.");
        return out;
      },
      savePrep: async (k, patch) => {
        store[k] = applyPatch(store[k], patch);
        revision += 1;
        return { deck: k, overrides: store[k], revision, changed: true };
      },
      presenterName: fixture === "sparse" ? null : "Sara Al-Harbi",
      publicUrl: (_bucket, path) => path,
      now: () => new Date("2026-10-19T09:00:00Z"),
    };
  }, []);
  return (
    <PresentApp
      taskId={`fixture-${fixture}`}
      deck={deck}
      view={view}
      io={io}
      urls={{
        deck: at({ view: null }),
        notes: at({ view: "notes" }),
        prep: at({ view: "prep" }),
        client: at({ view: null }),
        other: at({
          deck: deck === "onboarding" ? "launch" : "onboarding",
          view: "prep",
        }),
      }}
      book={(_d, kind, label, onBooked) => (
        <button
          type="button"
          className="rounded-lg border px-3 py-1.5 text-sm hover:border-primary"
          onClick={() =>
            onBooked(
              kind === "blueprint"
                ? "2026-10-22T13:00:00Z"
                : "2026-10-29T13:00:00Z",
            )
          }
        >
          {label} (harness)
        </button>
      )}
      uploadLogo={async () => {
        throw Error("The harness saves nothing.");
      }}
    />
  );
}

const parts = params.get("view") === "parts";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    {parts ? (
      <PartsSheet
        lang={params.get("lang") === "ar" ? "ar" : "en"}
        sheet={Number(params.get("sheet") ?? 0)}
      />
    ) : (
      <Harness />
    )}
  </StrictMode>,
);
