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
import type { DeckKind, LaunchAd } from "@/present/sources";
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
    return {
      load: async () => ({ ...loaded, ads: [...ads], prep: { ...store } }),
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
