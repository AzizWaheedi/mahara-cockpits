import { describe, expect, test } from "bun:test";
import {
  BlueprintSaver,
  type Change,
  type SaveResult,
  sessionId,
} from "../src/present/blueprintSaver";

/**
 * Autosave per field, with conflict detection (docs/brand-blueprint/
 * SPEC.md 2.4), on a fake clock and a fake server: the 600 ms pause, one
 * save in flight, `seen` per key, a conflict shown and "Use mine", another
 * window's confirmed save, and a save that failed offline sent again.
 */

function clock() {
  let t = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let id = 0;
  return {
    schedule: (fn: () => void, ms: number) => {
      id += 1;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    cancel: (h: unknown) => {
      timers = timers.filter(x => x.id !== h);
    },
    advance: (ms: number) => {
      t += ms;
      const due = timers.filter(x => x.at <= t);
      timers = timers.filter(x => x.at > t);
      for (const x of due) x.fn();
    },
  };
}

/** The server's rules (cockpit_blueprint_save), in memory. */
function server(start: Record<string, unknown> = {}) {
  const answers: Record<string, unknown> = { ...start };
  const meta: Record<string, { session: string }> = {};
  let revision = 1;
  const calls: { changes: Record<string, Change>; base: number | null }[] = [];
  return {
    answers,
    calls,
    meta,
    /** Another browser saves a key. */
    other: (k: string, v: unknown) => {
      answers[k] = v;
      meta[k] = { session: "other-session" };
      revision += 1;
    },
    save: async (
      changes: Record<string, Change>,
      base: number | null,
    ): Promise<SaveResult> => {
      calls.push({ changes, base });
      const applied: string[] = [];
      const conflicts: SaveResult["conflicts"] = [];
      for (const [k, c] of Object.entries(changes)) {
        const stored = answers[k] ?? null;
        const same = (a: unknown, b: unknown) =>
          JSON.stringify(a) === JSON.stringify(b);
        if (
          base !== revision &&
          meta[k]?.session !== "mine" &&
          !same(stored, c.seen) &&
          !same(stored, c.value)
        ) {
          conflicts.push({
            key: k,
            theirs: stored,
            by: "Dana",
            at: "2026-10-22T07:20:00Z",
          });
          continue;
        }
        applied.push(k);
        answers[k] = c.value;
        meta[k] = { session: "mine" };
      }
      if (applied.length) revision += 1;
      return { row: { answers: { ...answers }, revision }, applied, conflicts };
    },
  };
}

describe("the pause and the queue", () => {
  test("typed fields wait 600 ms after the last key; ticks go at once", async () => {
    const c = clock();
    const s = server();
    const saver = new BlueprintSaver({
      save: s.save,
      onSaved: () => {},
      onError: () => {},
      schedule: c.schedule,
      cancel: c.cancel,
    });
    saver.set("method", "We");
    c.advance(400);
    saver.set("method", "We draw");
    c.advance(400);
    expect(s.calls.length).toBe(0);
    c.advance(200);
    await saver.flush();
    expect(s.calls.length).toBe(1);
    expect(s.calls[0].changes.method.value).toBe("We draw");
    saver.set("shot_list", true, { now: true });
    await saver.flush();
    expect(s.calls.length).toBe(2);
  });

  test("one save in flight; what arrives meanwhile goes in the next", async () => {
    let release: () => void = () => {};
    const sent: string[][] = [];
    const saver = new BlueprintSaver({
      save: async changes => {
        sent.push(Object.keys(changes));
        if (sent.length === 1) await new Promise<void>(r => (release = r));
        return { row: null, applied: Object.keys(changes), conflicts: [] };
      },
      onSaved: () => {},
      onError: () => {},
    });
    const first = (async () => {
      saver.set("service", "interior", { now: true });
    })();
    await first;
    saver.set("capacity", "yes", { now: true });
    saver.set("starter", "yes", { now: true });
    release();
    await saver.flush();
    await saver.flush();
    expect(sent[0]).toEqual(["service"]);
    expect(sent.slice(1).flat().sort()).toEqual(["capacity", "starter"]);
  });

  test("a key the registry does not know is refused before anything is sent", () => {
    const saver = new BlueprintSaver({
      save: async () => ({ row: null, applied: [], conflicts: [] }),
      onSaved: () => {},
      onError: () => {},
    });
    expect(saver.set("price_list", "x")).toBe(
      "The Brand Blueprint has no answer called price_list.",
    );
    expect(saver.waiting).toEqual([]);
  });
});

describe("seen, conflicts and Use mine", () => {
  test("each change carries the value this browser last had confirmed", async () => {
    const s = server({ method: "Old words" });
    const saver = new BlueprintSaver({
      save: s.save,
      onSaved: () => {},
      onError: () => {},
    });
    saver.load({ method: "Old words" }, 1);
    saver.set("method", "New words", { now: true });
    await saver.flush();
    expect(s.calls[0].changes.method).toEqual({
      value: "New words",
      seen: "Old words",
    });
    // Never the revision: the server checks each key against `seen`.
    expect(s.calls[0].base).toBeNull();
    saver.set("method", "Newer words", { now: true });
    await saver.flush();
    expect(s.calls[1].changes.method.seen).toBe("New words");
  });

  test("someone else's change is a conflict, shown with what was typed; Use mine saves over it", async () => {
    const s = server({ pricing: "A" });
    const conflicts: unknown[] = [];
    const saver = new BlueprintSaver({
      save: s.save,
      onSaved: () => {},
      onConflict: c => conflicts.push(c),
      onError: () => {},
    });
    saver.load({ pricing: "A" }, 1);
    s.other("pricing", "B, from the other browser");
    saver.set("pricing", "C, typed here", { now: true });
    await saver.flush();
    expect(conflicts).toEqual([
      {
        key: "pricing",
        theirs: "B, from the other browser",
        mine: "C, typed here",
        by: "Dana",
        at: "2026-10-22T07:20:00Z",
      },
    ]);
    expect(s.answers.pricing).toBe("B, from the other browser");
    expect(
      saver.keepMine("pricing", "C, typed here", "B, from the other browser"),
    ).toBeNull();
    await saver.flush();
    expect(s.answers.pricing).toBe("C, typed here");
  });

  test("saving an unrelated key first never lets a stale edit overwrite another person's answer", async () => {
    const s = server({ why_us: "Old reason", events: null });
    const conflicts: { key: string }[] = [];
    const saver = new BlueprintSaver({
      save: s.save,
      onSaved: () => {},
      onConflict: c => conflicts.push(c),
      onError: () => {},
    });
    saver.load({ why_us: "Old reason" }, 1);
    // Y changes why_us in another browser.
    s.other("why_us", "Y's reason");
    // X saves an unrelated key, then edits the why_us it still shows.
    saver.set("events", "A home show", { now: true });
    await saver.flush();
    saver.set("why_us", "X's edit of the old reason", { now: true });
    await saver.flush();
    expect(conflicts.map(c => c.key)).toEqual(["why_us"]);
    expect(s.answers.why_us).toBe("Y's reason");
    // The unrelated key applied, and Use mine still wins.
    expect(s.answers.events).toBe("A home show");
    saver.keepMine("why_us", "X's edit of the old reason", "Y's reason");
    await saver.flush();
    expect(s.answers.why_us).toBe("X's edit of the old reason");
  });

  test("another window's confirmed save is seen here too (one session, no conflict)", async () => {
    const s = server({ why_us: "A" });
    const saver = new BlueprintSaver({
      save: s.save,
      onSaved: () => {},
      onError: () => {},
    });
    saver.load({ why_us: "A" }, 1);
    saver.confirm({ why_us: "B" }, 3);
    expect(saver.seen("why_us")).toBe("B");
    expect(saver.revision).toBe(3);
  });
});

describe("offline", () => {
  test("a save that fails is kept and sent again", async () => {
    let online = false;
    const errors: string[] = [];
    const saved: string[] = [];
    const saver = new BlueprintSaver({
      save: async changes => {
        if (!online) throw Error("Failed to fetch");
        saved.push(...Object.keys(changes));
        return { row: null, applied: Object.keys(changes), conflicts: [] };
      },
      onSaved: () => {},
      onError: m => errors.push(m),
    });
    saver.set("events", "A home show");
    await saver.flush();
    expect(errors).toEqual(["Failed to fetch"]);
    expect(saver.waiting).toEqual(["events"]);
    online = true;
    await saver.flush();
    expect(saved).toEqual(["events"]);
    expect(saver.waiting).toEqual([]);
  });
});

describe("the session", () => {
  test("one per browser profile, kept in storage; a fresh one when storage throws", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    const a = sessionId(storage);
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(sessionId(storage)).toBe(a);
    const broken = {
      getItem: () => {
        throw Error("blocked");
      },
      setItem: () => {},
    };
    expect(sessionId(broken)).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});
