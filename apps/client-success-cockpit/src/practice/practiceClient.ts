import { BUILT_OFFER_DECKS, type OfferDeckKind } from "../present/offer/kinds";
import type { Overrides } from "@/present/deckData";
import { PRACTICE_NAME, PRACTICE_TASK } from "@/present/deckHost";
import type { KickoffPort } from "@/present/KickoffSlide";
import type { PresentUrls } from "@/present/PresentApp";
import { applyPatch } from "@/present/prep";
import type { DeckKind, LaunchAd } from "@/present/sources";
import type { DeckIO, Loaded } from "@/present/useDeckModel";
import {
  BP_NOW,
  blueprintLoaded,
  fakeBlueprintIO,
} from "./fixtures/blueprintFixtures";
import { fakeDrive, HARNESS_NOW } from "./fixtures/driveFixtures";
import { FIXTURES } from "./fixtures/fixtures";
import { fakeKickoff } from "./fixtures/kickoffFixtures";
import { practiceForm } from "./practiceForm";

/**
 * The practice client (docs/call-guide/DESIGN.md): the deck harness's
 * made-up firm, run through the real call screens with the call guide.
 * Every read is the fixture; every save, upload, press and booking stays in
 * this browser. Nothing reaches Supabase, ClickUp, Typeform, Make or
 * HighLevel: no write here calls the network.
 */

// The card ID the practice windows use is never a ClickUp ID, so no channel
// or window meets a real client's. Both apps read it from deckHost.ts.
export { PRACTICE_NAME, PRACTICE_TASK };

const base = () =>
  (import.meta.env?.BASE_URL ?? "/client-success/").replace(/\/$/, "");

export function practiceUrls(deck: DeckKind): PresentUrls {
  const other: DeckKind =
    deck === "blueprint"
      ? "blueprint"
      : deck === "onboarding"
        ? "launch"
        : "onboarding";
  return {
    deck: `${base()}/practice/present/${deck}`,
    notes: `${base()}/practice/present/${deck}/notes`,
    prep: `${base()}/practice/present/${deck}?view=prep`,
    client: `${base()}/practice`,
    other: `${base()}/practice/present/${other}?view=prep`,
  };
}

/** The window each practice view opens in, as the real decks name theirs. */
export const practiceWindow = (deck: DeckKind, prep: boolean) =>
  `mahara-${prep ? "prep" : "deck"}-${PRACTICE_TASK}-${deck}`;

/** The fixture as a call finds it: before the kickoff, nothing booked. */
export function practiceLoaded(
  deck: DeckKind,
  presenter: string | null,
): Loaded {
  if (deck === "blueprint") {
    // As a good prep leaves it: on the call, capacity and the starter
    // pack's approval are left, then Send to media.
    const loaded = blueprintLoaded("full", "part1", { rehearse: true });
    return {
      ...loaded,
      kit: loaded.kit
        ? { ...loaded.kit, clickup_task_id: PRACTICE_TASK }
        : null,
      blueprint: loaded.blueprint
        ? { ...loaded.blueprint, can: { write: false, rehearse: true } }
        : loaded.blueprint,
    };
  }
  const loaded = FIXTURES.full(deck);
  const forms = { ...(loaded.kit?.forms ?? {}) };
  delete forms.kickoff;
  const next = { ...(loaded.sources?.calls?.next ?? {}) };
  delete next.blueprint;
  delete next.launch;
  return {
    ...loaded,
    kit: loaded.kit
      ? { ...loaded.kit, clickup_task_id: PRACTICE_TASK, forms }
      : null,
    sources: loaded.sources
      ? {
          ...loaded.sources,
          presenter: {
            ...loaded.sources.presenter,
            firstName: presenter?.split(/\s+/)[0] ?? "Sara",
          },
          calls: { last: loaded.sources.calls?.last ?? {}, next },
        }
      : null,
  };
}

// ------------------------------------------------- prep, shared by the windows

const PREP_KEY = "mahara-practice:v1:prep";

/** Prep typed in one practice window reaches the next one opened (this browser only). */
function readPrep(): Partial<Record<DeckKind, Overrides>> {
  try {
    const raw = localStorage.getItem(PREP_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function writePrep(v: Partial<Record<DeckKind, Overrides>>) {
  try {
    localStorage.setItem(PREP_KEY, JSON.stringify(v));
  } catch {
    // storage blocked: this window keeps its own copy
  }
}

/** Start over: the practice client's prep as the fixture has it. */
export function clearPractice() {
  try {
    localStorage.removeItem(PREP_KEY);
    for (const k of Object.keys(sessionStorage))
      if (k.includes(PRACTICE_TASK)) sessionStorage.removeItem(k);
  } catch {
    // nothing kept, nothing to clear
  }
}

// ------------------------------------------------------------------- the io

export function practiceIO(deck: DeckKind, presenter: string | null): DeckIO {
  const loaded = practiceLoaded(deck, presenter);
  const opened = Date.now();
  // The fixture's own day, moving on as the practice runs.
  const clock = () =>
    (deck === "blueprint" ? BP_NOW : HARNESS_NOW) + (Date.now() - opened);
  const kept = readPrep();
  const store: Record<DeckKind, Overrides> = {
    onboarding: kept.onboarding ?? loaded.prep.onboarding,
    launch: kept.launch ?? loaded.prep.launch,
    blueprint: {},
    ...(Object.fromEntries(BUILT_OFFER_DECKS.map(k => [k, {}])) as Record<
      OfferDeckKind,
      Overrides
    >),
  };
  let ads: LaunchAd[] = [...loaded.ads];
  let revision = 1;
  const drive = fakeDrive({
    scenario: null,
    taskId: PRACTICE_TASK,
    addAd: ad => {
      ads = [...ads, ad];
    },
    now: clock,
  });
  return {
    load: async () => ({
      ...loaded,
      ads: [...ads],
      prep: { ...store, ...readPrep() } as Loaded["prep"],
    }),
    savePrep: async (k, patch) => {
      store[k] = applyPatch(store[k], patch);
      writePrep({ ...readPrep(), [k]: store[k] });
      revision += 1;
      return {
        deck: k === "launch" ? "launch" : "onboarding",
        overrides: store[k],
        revision,
        changed: true,
      };
    },
    // A file added on the call shows from this browser's copy; it is never uploaded.
    uploadAd: async ({ file, kind, facts, onProgress }) => {
      onProgress(1);
      const saved: LaunchAd = {
        id: crypto.randomUUID(),
        taskId: PRACTICE_TASK,
        kind,
        status: "ready",
        path: `practice/${file.name}`,
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
      ads = ads.map(a => (a.id === id ? ({ ...a, ...patch } as LaunchAd) : a));
      const out = ads.find(a => a.id === id);
      if (!out) throw Error("That file is not in the practice tray.");
      return out;
    },
    removeAd: async id => {
      const out = ads.find(a => a.id === id);
      if (!out) throw Error("That file is not in the practice tray.");
      ads = ads.filter(a => a.id !== id);
      return { ...out, status: "removed" };
    },
    ...drive,
    ...(deck === "blueprint"
      ? { blueprint: fakeBlueprintIO(loaded, () => new Date(clock())) }
      : {}),
    presenterName: presenter,
    publicUrl: (_bucket, path) => path,
    now: () => new Date(clock()),
  };
}

/** The kickoff on the onboarding deck's last slide: the practice form, noted in memory. */
export function practiceKickoff(
  deck: DeckKind,
  presenter: { name: string; email: string },
): KickoffPort {
  const loaded = practiceLoaded(deck, presenter.name);
  const opened = Date.now();
  const port = fakeKickoff({
    loaded,
    taskId: PRACTICE_TASK,
    // "done": the first check after the submit reads the card as Make
    // would leave it, so the trail runs to its end as on a real call.
    scenario: "done",
    rehearse: false,
    now: () => new Date(HARNESS_NOW + (Date.now() - opened)).toISOString(),
  });
  const first = presenter.name.trim().split(/\s+/)[0] ?? null;
  return {
    ...port,
    me: { email: presenter.email, firstName: first },
    embed: practiceForm,
  };
}
