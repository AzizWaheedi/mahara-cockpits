import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FIXTURES } from "../src/practice/fixtures/fixtures";
import { deckData } from "../src/present/deckData";
import { launchSlides } from "../src/present/launchDeck";
import { videosRead } from "../src/present/load";
import {
  applyPatch,
  PREP_KEYS,
  PrepSaver,
  refusedKey,
} from "../src/present/prep";
import {
  type DeckClient,
  problem,
  readDeckSources,
  savePrep,
  uploadRefusal,
  VideosNotLive,
} from "../src/present/sources";

/**
 * Prep saves (DESIGN 16.4): typed fields wait 600 ms and go as one save,
 * ticks go at once, one save is in flight at a time, and only the keys the
 * server keeps are sent (the list is read from the migration itself).
 */

/**
 * The newest migration that defines the prep checker (the visual pass's
 * 20261020160100 replaced the decks' own, DRIVE-IMPORT.md 9).
 */
const MIGRATION = resolve(
  import.meta.dir,
  "../../../supabase/migrations/20261020160100_csm_deck_prep_dos_ar.sql",
);

/** The prep keys the server's checker accepts, read from its SQL. */
function serverKeys(): Set<string> {
  const sql = readFileSync(MIGRATION, "utf8");
  const start = sql.indexOf("Checks and normalises one prep key");
  const end = sql.indexOf("Prep does not keep", start);
  const body = sql.slice(start, end);
  const keys = new Set<string>();
  const quoted = (s: string) =>
    [...s.matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1]);
  for (const m of body.matchAll(
    /(?:p_key|v_base)\s*(?:=\s*('[a-z0-9_]+')|IN\s*\(([^)]*)\))/g,
  ))
    for (const k of quoted(m[1] ?? m[2] ?? "")) keys.add(k);
  const twins = /left\(p_key, -3\) IN \(([^)]*)\)/.exec(body);
  for (const k of quoted(twins?.[1] ?? "")) keys.add(`${k}_ar`);
  return keys;
}

describe("the keys prep may send", () => {
  test("are exactly the keys the migration keeps", () => {
    const server = serverKeys();
    expect(server.size).toBeGreaterThan(30);
    expect([...PREP_KEYS].sort()).toEqual([...server].sort());
  });

  test("anything else is refused before it is sent, in a plain sentence", () => {
    expect(refusedKey("goals")).toBeNull();
    expect(refusedKey("leads")).toBe('Prep does not keep "leads".');
  });

  test("the old video toggles stay: they are the client's own messages, not deck videos", () => {
    // welcome_video and booking_video say whether the client's thank-you
    // screen and booking confirmation carry a video about the client (L5
    // stop 3, L2 stop 4). The deck's own videos are shared slots, kept in
    // cockpit_csm_deck_videos, never in a client's prep.
    expect(refusedKey("welcome_video")).toBeNull();
    expect(refusedKey("booking_video")).toBeNull();
    for (const k of ["videos", "video_links", "deck_videos"])
      expect(refusedKey(k)).not.toBeNull();
  });

  test("a saved test-proof (the retired optional stop) is kept and ignored: slide 3 has five stops", () => {
    const f = FIXTURES.full("launch");
    const d = deckData({
      taskId: "x",
      deck: "launch",
      lang: "en",
      sources: f.sources,
      kit: f.kit,
      prep: {
        ...f.prep,
        launch: { ...f.prep.launch, shown_slides: ["form", "test-proof"] },
      },
      ads: f.ads,
      now: new Date("2026-10-19T09:00:00Z"),
    });
    const four = launchSlides().find(s => s.id === "creative-freedom");
    expect(
      four?.stops?.({
        d,
        lang: "en",
        deck: "launch",
        tour: 0,
        setTour: () => {},
        prep: {},
        prepOf: () => ({}),
        save: () => {},
        saveTo: () => {},
        live: { ticks: {}, candidate: null },
        setLive: () => {},
        still: true,
        presenting: true,
      }),
    ).toBe(5);
    expect(applyPatch({}, { shown_slides: ["test-proof"] })).toEqual({
      shown_slides: ["test-proof"],
    });
  });
});

describe("the videos read at load", () => {
  test("read: kept as read, nothing said", () => {
    const v = { rows: [], refused: [], slots: ["launch:testing"] };
    expect(videosRead({ status: "fulfilled", value: v })).toEqual({
      videos: v,
      problem: null,
      line: null,
    });
  });
  test("not live yet: its own sentence, and null (never empty)", () => {
    expect(
      videosRead({ status: "rejected", reason: new VideosNotLive() }),
    ).toEqual({
      videos: null,
      problem: "The deck's videos are not live yet, so no video shows.",
      line: "The deck's videos are not live yet, so no video shows.",
    });
  });
  test("another failure: said plainly in the deck's problems, null for the slots", () => {
    const r = videosRead({
      status: "rejected",
      reason: Error("Failed to fetch"),
    });
    expect(r.videos).toBeNull();
    expect(r.line).toBe(
      "The deck's videos could not be read: No connection. Check the internet, then try again.",
    );
  });
});

describe("merging a patch as the server does", () => {
  const now = () => "2026-10-19T09:00:00.000Z";

  test("top-level keys are replaced whole; null and blank text remove", () => {
    const before = { goals: { goal90: "a", why: "b" }, page_name: "Noor" };
    const after = applyPatch(
      before,
      { goals: { goal90: "c" }, page_name: "  " },
      now,
    );
    expect(after).toEqual({ goals: { goal90: "c" } });
    expect(applyPatch(after, { goals: null }, now)).toEqual({});
  });

  test("lists are deduplicated and lose their blanks", () => {
    expect(
      applyPatch(
        {},
        { red_lines: ["Never show prices", "", "Never show prices"] },
        now,
      ),
    ).toEqual({
      red_lines: ["Never show prices"],
    });
    expect(applyPatch({ services: ["a"] }, { services: [""] }, now)).toEqual(
      {},
    );
  });

  test("a stamp keeps its first time, and false or null clears it", () => {
    const one = applyPatch({}, { onboarding_presented_at: true }, now);
    expect(one).toEqual({
      onboarding_presented_at: "2026-10-19T09:00:00.000Z",
    });
    expect(
      applyPatch(one, { onboarding_presented_at: true }, () => "later"),
    ).toEqual(one);
    expect(applyPatch(one, { onboarding_presented_at: false }, now)).toEqual(
      {},
    );
  });
});

describe("the saver", () => {
  function harness(fail = false) {
    const sent: Record<string, unknown>[] = [];
    const errors: string[] = [];
    const timers: (() => void)[] = [];
    const saver = new PrepSaver({
      save: async patch => {
        sent.push(patch);
        if (fail)
          throw Error(
            "Saving needs your cockpit sign-in. The preview still works.",
          );
        return {
          deck: "onboarding",
          overrides: patch,
          revision: sent.length,
          changed: true,
        };
      },
      onSaved: () => {},
      onError: m => errors.push(m),
      schedule: fn => {
        timers.push(fn);
        return timers.length;
      },
      cancel: h => {
        timers[(h as number) - 1] = () => {};
      },
    });
    return { saver, sent, errors, timers };
  }

  test("typing waits for the pause, and goes as one save", async () => {
    const h = harness();
    h.saver.set({ goals: { goal90: "Two" } });
    h.saver.set({ goals: { goal90: "Two kitchens" } });
    expect(h.sent).toEqual([]);
    for (const t of h.timers) t();
    await h.saver.flush();
    expect(h.sent).toEqual([{ goals: { goal90: "Two kitchens" } }]);
  });

  test("a tick goes at once, with what was typed before it", async () => {
    const h = harness();
    h.saver.set({ red_lines: ["Never show prices"] });
    h.saver.set({ access: { meta_access: "done" } }, true);
    await h.saver.flush();
    expect(h.sent).toEqual([
      { red_lines: ["Never show prices"], access: { meta_access: "done" } },
    ]);
  });

  test("a key the server does not keep is refused and nothing is queued", async () => {
    const h = harness();
    expect(h.saver.set({ cost_per_lead: 12 }, true)).toBe(
      'Prep does not keep "cost_per_lead".',
    );
    await h.saver.flush();
    expect(h.sent).toEqual([]);
  });

  test("a failed save is kept for the next one and said plainly", async () => {
    const h = harness(true);
    h.saver.set({ service_focus: "Kitchens" }, true);
    await new Promise(r => setTimeout(r, 0));
    expect(h.errors).toEqual([
      "Saving needs your cockpit sign-in. The preview still works.",
    ]);
    expect(h.saver.waiting).toEqual({ service_focus: "Kitchens" });
    // The next save sends it again.
    await h.saver.flush();
    expect(h.sent).toEqual([
      { service_focus: "Kitchens" },
      { service_focus: "Kitchens" },
    ]);
  });
});

describe("the calls", () => {
  function fakeClient(answer: { data?: unknown; error?: unknown }) {
    const calls: { fn: string; args: unknown }[] = [];
    const client = {
      rpc: async (fn: string, args: unknown) => {
        calls.push({ fn, args });
        return answer;
      },
    } as unknown as DeckClient;
    return { client, calls };
  }

  test("a save goes to cockpit_csm_deck_prep_save with the task, the deck and the patch", async () => {
    const f = fakeClient({
      data: {
        deck: "onboarding",
        overrides: { service_focus: "Kitchens" },
        revision: 3,
        changed: true,
      },
    });
    const row = await savePrep(f.client, "86c0abc", "onboarding", {
      service_focus: "Kitchens",
    });
    expect(f.calls).toEqual([
      {
        fn: "cockpit_csm_deck_prep_save",
        args: {
          p_task_id: "86c0abc",
          p_deck: "onboarding",
          p_patch: { service_focus: "Kitchens" },
        },
      },
    ]);
    expect(row.revision).toBe(3);
  });

  test("a refusal comes back as the server's sentence", async () => {
    const f = fakeClient({ error: { message: 'Prep does not keep "x"' } });
    await expect(savePrep(f.client, "t", "launch", { x: 1 })).rejects.toThrow(
      'Prep does not keep "x"',
    );
  });

  test("the sources read fills its defaults and says so plainly when the backend is not live", async () => {
    const ok = fakeClient({ data: { taskId: "t", clientName: "Noor Studio" } });
    const s = await readDeckSources(ok.client, "t");
    expect(ok.calls[0]).toEqual({
      fn: "cockpit_csm_deck_sources",
      args: { p_task_id: "t" },
    });
    expect(s.launchAds).toEqual([]);
    expect(s.calls).toEqual({ next: {}, last: {} });
    const missing = fakeClient({
      error: {
        message: "Could not find the function public.cockpit_csm_deck_sources",
      },
    });
    await expect(readDeckSources(missing.client, "t")).rejects.toThrow(
      "The deck's backend is not live yet, so its sources and prep cannot be read.",
    );
    expect(problem({ message: "JWT expired" }, "x")).toBe(
      "Saving needs your cockpit sign-in. The preview still works.",
    );
  });

  test("a file the tray cannot keep is said in the notes window's words", () => {
    const file = (name: string, type: string, size: number) =>
      ({ name, type, size }) as unknown as File;
    expect(uploadRefusal(file("brief.pdf", "application/pdf", 10))).toBe(
      "brief.pdf is a PDF. Add a picture (JPG, PNG, WebP) or a video (MP4, MOV, WebM).",
    );
    expect(uploadRefusal(file("reel.mp4", "video/mp4", 200_000_000))).toBe(
      "Shown, not saved: reel.mp4 is over 150 MB. Export a smaller copy to keep it.",
    );
    expect(uploadRefusal(file("logo.png", "image/png", 2000))).toBeNull();
  });
});
