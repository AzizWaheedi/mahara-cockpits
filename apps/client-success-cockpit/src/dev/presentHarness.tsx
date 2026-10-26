/**
 * The client decks from fixtures, to see and screenshot every slide without
 * signing in. `bunx vite`, then open
 * /client-success/present-harness.html?fixture=full&deck=onboarding&lang=en
 * (fixture: full | sparse | dwy | starter; view: present | notes | prep |
 * parts | drive; still=1 for no motion; drive=<scenario> for the Drive box,
 * src/dev/deck/driveFixtures.ts; kickoff=<scenario> for the onboarding
 * deck's last slide, src/dev/deck/kickoffFixtures.ts, with Typeform's
 * stand-in, and rehearse=1 for its sandbox; deck=blueprint for the Brand
 * Blueprint call, with fixture=full|sparse|nokickoff|two|declined|nopack|arabic and
 * bp=open|part1|sent|closed|locked, src/dev/deck/blueprintFixtures.ts, and
 * rehearse=1 for its plan-only presses; host=creative, inside a frame on
 * the same origin, for the creative director cockpit's host mode, with
 * notes=<a /creative/ path> for the notes window it opens, EMBED.md 6;
 * practice=1 for the practice client, docs/call-guide/DESIGN.md, with
 * view=page for its page).
 * Saves and uploads stay in
 * memory (an upload pretends to take a second and a half); nothing is sent
 * anywhere and no form loads or submits.
 *
 * scripts/deck-shots.mjs drives it to capture every slide and stop.
 */

import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { SERVICES } from "@/present/content";
import type { Overrides } from "@/present/deckData";
import { PresentApp, type View } from "@/present/PresentApp";
import { applyPatch } from "@/present/prep";
import { isMain } from "@/present/services";
import {
  type DeckKind,
  type DeckVideos,
  type LaunchAd,
  type VideoRow,
  VideoSaveError,
} from "@/present/sources";
import type { DeckIO } from "@/present/useDeckModel";
import {
  BP_NOW,
  type BpFixture,
  type BpState,
  blueprintLoaded,
  fakeBlueprintIO,
} from "./deck/blueprintFixtures";
import { DriveSheet } from "./deck/DriveSheet";
import { fakeDrive, HARNESS_NOW } from "./deck/driveFixtures";
import { FIXTURES, type FixtureKey } from "./deck/fixtures";
import { fakeKickoff, kickoffScenario } from "./deck/kickoffFixtures";
import { PartsSheet } from "./deck/PartsSheet";
import "@/index.css";
import { Toaster } from "sonner";
import { practiceBook } from "@/practice/PracticeDeckPage";
import PracticePage from "@/practice/PracticePage";
import { practiceIO, practiceKickoff } from "@/practice/practiceClient";
import { PRACTICE_TASK } from "@/present/deckHost";

const params = new URLSearchParams(window.location.search);
const fixture = (params.get("fixture") ?? "full") as FixtureKey;
const deckParam = params.get("deck");
const deck: DeckKind =
  deckParam === "launch"
    ? "launch"
    : deckParam === "blueprint"
      ? "blueprint"
      : "onboarding";
const view = (params.get("view") ?? "present") as View;
// theme=light, as the creative director harness's light shot asks.
if (params.get("theme") === "light")
  document.documentElement.classList.remove("dark");

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

/**
 * The fixture, as the kickoff's scenario needs it: before the kickoff (any
 * scenario but "record"), the client has no kickoff on record and no
 * Blueprint booked yet, as on a real onboarding call.
 */
function fixtureFor() {
  if (deck === "blueprint")
    return {
      scenario: "record" as const,
      loaded: blueprintLoaded(
        (params.get("fixture") ?? "full") as BpFixture,
        (params.get("bp") ?? "part1") as BpState,
        { rehearse: params.get("rehearse") === "1" },
      ),
    };
  const loaded = FIXTURES[fixture]?.(deck) ?? FIXTURES.full(deck);
  const scenario = kickoffScenario(params.get("kickoff"), loaded);
  if (deck !== "onboarding" || scenario === "record")
    return { loaded, scenario };
  const forms = { ...(loaded.kit?.forms ?? {}) };
  delete forms.kickoff;
  const next = { ...(loaded.sources?.calls?.next ?? {}) };
  delete next.blueprint;
  return {
    scenario,
    loaded: {
      ...loaded,
      kit: loaded.kit ? { ...loaded.kit, forms } : null,
      sources: loaded.sources
        ? {
            ...loaded.sources,
            calls: { last: loaded.sources.calls?.last ?? {}, next },
          }
        : null,
    },
  };
}
const fixed = fixtureFor();
const startedAt = Date.now();
const kickoff =
  deck === "onboarding"
    ? fakeKickoff({
        loaded: fixed.loaded,
        taskId: `fixture-${fixture}`,
        scenario: fixed.scenario,
        rehearse: params.get("rehearse") === "1",
        now: () =>
          new Date(HARNESS_NOW + (Date.now() - startedAt)).toISOString(),
      })
    : undefined;

function Harness() {
  const io = useMemo<DeckIO>(() => {
    const store: Record<DeckKind, Overrides> = {
      onboarding: {},
      launch: {},
      blueprint: {},
    };
    const loaded = fixed.loaded;
    store.onboarding = loaded.prep.onboarding;
    store.launch = loaded.prep.launch;
    // ?service=<key>: the client's service as one of the five (DESIGN
    // 22.14), so each service's example pictures can be seen in the harness.
    const svc = params.get("service");
    if (isMain(svc))
      store.onboarding = {
        ...store.onboarding,
        service_focus: SERVICES[svc].name.en,
        service_focus_ar: SERVICES[svc].name.ar,
      };
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
    // ?drive=<scenario>: the Drive box's imports (driveFixtures.ts); a link
    // pasted in prep or the notes window runs a pretend worker whose files
    // join this tray.
    // The pretend worker's clock: the harness's NOW plus the time since the
    // page opened, so a link pasted here reads "today", never the machine's
    // real date against the harness's 19 October.
    const opened = Date.now();
    const drive = fakeDrive({
      scenario: params.get("drive"),
      taskId: `fixture-${fixture}`,
      addAd: ad => {
        ads = [...ads, ad];
      },
      now: () => HARNESS_NOW + (Date.now() - opened),
    });
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
          deck: deck === "launch" ? "launch" : "onboarding",
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
      removeAd: async id => {
        await new Promise(r => setTimeout(r, 300));
        const out = ads.find(a => a.id === id);
        if (!out) throw Error("Not in this harness's tray.");
        ads = ads.filter(a => a.id !== id);
        return { ...out, status: "removed" };
      },
      savePrep: async (k, patch) => {
        store[k] = applyPatch(store[k], patch);
        revision += 1;
        return {
          deck: k === "launch" ? "launch" : "onboarding",
          overrides: store[k],
          revision,
          changed: true,
        };
      },
      ...drive,
      ...(deck === "blueprint"
        ? {
            blueprint: fakeBlueprintIO(
              loaded,
              () => new Date(BP_NOW + (Date.now() - opened)),
            ),
          }
        : {}),
      presenterName: fixture === "sparse" ? null : "Sara Al-Harbi",
      publicUrl: (_bucket, path) => path,
      now: () =>
        deck === "blueprint"
          ? new Date(BP_NOW + (Date.now() - opened))
          : new Date(HARNESS_NOW),
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
          deck:
            deck === "blueprint"
              ? "blueprint"
              : deck === "onboarding"
                ? "launch"
                : "onboarding",
          view: "prep",
        }),
      }}
      book={(_d, kind, label, onBooked, opts) => (
        <span className="inline-flex flex-col gap-1">
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
          {opts?.autoOpen ? (
            <button
              type="button"
              className="text-left text-xs text-muted-foreground underline"
              onClick={opts.onAutoOpenConsumed}
            >
              The booking dialog opens here (harness stand-in). Close it.
            </button>
          ) : null}
        </span>
      )}
      uploadLogo={async () => {
        throw Error("The harness saves nothing.");
      }}
      kickoff={kickoff}
    />
  );
}

/**
 * practice=1: the practice client's windows (docs/call-guide/DESIGN.md), as
 * its routes draw them, with view=page for the CSM's practice page.
 */
function PracticeHarness() {
  const io = useMemo(() => practiceIO(deck, "Sara Al-Harbi"), []);
  const kickoff = useMemo(
    () =>
      deck === "onboarding"
        ? practiceKickoff(deck, {
            name: "Sara Al-Harbi",
            email: "sara@example.com",
          })
        : undefined,
    [],
  );
  if (params.get("view") === "page")
    return (
      <div className="min-h-screen bg-background p-4 text-foreground sm:p-6 lg:p-8">
        <PracticePage />
        <Toaster />
      </div>
    );
  return (
    <>
      <PresentApp
        taskId={PRACTICE_TASK}
        deck={deck}
        view={view}
        io={io}
        practice
        urls={{
          deck: at({ view: null }),
          notes: at({ view: "notes" }),
          prep: at({ view: "prep" }),
          client: at({ view: "page" }),
          other: at({
            deck: deck === "onboarding" ? "launch" : "onboarding",
            view: "prep",
          }),
        }}
        book={deck === "blueprint" ? undefined : practiceBook}
        kickoff={kickoff}
      />
      <Toaster />
    </>
  );
}

const parts = params.get("view") === "parts";
const driveSheet = params.get("view") === "drive";
const sheetLang = params.get("lang") === "ar" ? "ar" : "en";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    {parts ? (
      <PartsSheet lang={sheetLang} sheet={Number(params.get("sheet") ?? 0)} />
    ) : driveSheet ? (
      <DriveSheet lang={sheetLang} />
    ) : params.get("practice") === "1" ? (
      <PracticeHarness />
    ) : (
      <Harness />
    )}
  </StrictMode>,
);
