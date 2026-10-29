import { describe, expect, test } from "bun:test";
import { checkValue, sameValue } from "../src/forms/checkinForm";
import {
  type Change,
  FieldSaver,
  type FieldSaverOptions,
  type SaveResult,
} from "../src/forms/fieldSaver";

/**
 * The per-field autosave of the native forms (src/forms/fieldSaver.ts;
 * docs/forms/STAGE2-CONTRACT.md 8.2): the Brand Blueprint saver's cases
 * (scripts/blueprint-saver.test.ts) with the 1-1 notes' own check, on a
 * fake clock and a fake server: the 600 ms pause, one save in flight, 40
 * keys a save, `seen` per key, a conflict and "Use mine", another window's
 * confirmed save, a save that failed offline sent again, and a refusal that
 * is reported once and never sent again.
 *
 * Run: bun test scripts/field-saver.test.ts
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

/** The server's rules (cockpit_form_save, the cockpit_blueprint_save contract), in memory. */
function server(start: Record<string, unknown> = {}) {
  const answers: Record<string, unknown> = { ...start };
  const meta: Record<string, { session: string }> = {};
  let revision = 1;
  const calls: { changes: Record<string, Change>; base: number | null }[] = [];
  return {
    answers,
    calls,
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
        if (
          meta[k]?.session !== "mine" &&
          !sameValue(stored, c.seen) &&
          !sameValue(stored, c.value)
        ) {
          conflicts.push({
            key: k,
            theirs: stored,
            by: "Dana",
            at: "2026-10-25T08:05:00Z",
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

const saverFor = (
  over: Partial<FieldSaverOptions> & Pick<FieldSaverOptions, "save">,
) =>
  new FieldSaver({
    onSaved: () => {},
    onError: () => {},
    check: (k, v) => checkValue(k, v),
    same: sameValue,
    ...over,
  });

describe("the pause and the queue", () => {
  test("typed fields wait 600 ms after the last key; choices go at once", async () => {
    const c = clock();
    const s = server();
    const saver = saverFor({
      save: s.save,
      schedule: c.schedule,
      cancel: c.cancel,
    });
    saver.set("client_notes", "Calm");
    c.advance(400);
    saver.set("client_notes", "Calm about the leads");
    c.advance(400);
    expect(s.calls.length).toBe(0);
    c.advance(200);
    await saver.flush();
    expect(s.calls.length).toBe(1);
    expect(s.calls[0].changes.client_notes.value).toBe("Calm about the leads");
    saver.set("defcon", "Happy", { now: true, from: "pick" });
    await saver.flush();
    expect(s.calls.length).toBe(2);
    expect(s.calls[1].changes.defcon).toEqual({
      value: "Happy",
      seen: null,
      from: "pick",
    });
  });

  test("one save in flight; what arrives meanwhile goes in the next", async () => {
    let release: () => void = () => {};
    const sent: string[][] = [];
    const saver = saverFor({
      save: async changes => {
        sent.push(Object.keys(changes));
        if (sent.length === 1) await new Promise<void>(r => (release = r));
        return { row: null, applied: Object.keys(changes), conflicts: [] };
      },
    });
    saver.set("defcon", "Happy", { now: true });
    await Promise.resolve();
    saver.set("priority", "High", { now: true });
    saver.set("client_notes", "Calm", { now: true });
    release();
    await saver.flush();
    await saver.flush();
    expect(sent[0]).toEqual(["defcon"]);
    expect(sent.slice(1).flat().sort()).toEqual(["client_notes", "priority"]);
  });

  test("at most 40 keys a save; the rest go in the next", async () => {
    const sizes: number[] = [];
    const saver = new FieldSaver({
      save: async changes => {
        sizes.push(Object.keys(changes).length);
        return { row: null, applied: Object.keys(changes), conflicts: [] };
      },
      onSaved: () => {},
      onError: () => {},
      check: (_k, v) => ({ value: v }),
      same: sameValue,
    });
    for (let i = 0; i < 45; i++) saver.set(`k${i}`, i);
    await saver.flush();
    expect(sizes).toEqual([40, 5]);
  });

  test("an answer the form refuses is refused before anything is sent", () => {
    const s = server();
    const saver = saverFor({ save: s.save });
    expect(saver.set("price_list", "x")).toBe(
      "That is not a question of this form.",
    );
    expect(saver.set("defcon", "Calm")).toBe(
      '"Calm" is not one of the answers.',
    );
    expect(saver.set("client_notes", "x".repeat(4001))).toBe(
      "Keep it under 4,000 characters.",
    );
    expect(saver.waiting).toEqual([]);
  });

  test("what is sent is the value the server would store", async () => {
    const s = server();
    const saver = saverFor({ save: s.save });
    saver.set(
      "we_owe",
      [{ text: "  Send the offer " }, { text: "send the offer" }],
      { now: true, from: "fathom.action_items" },
    );
    await saver.flush();
    expect(s.calls[0].changes.we_owe).toEqual({
      value: [
        {
          text: "Send the offer",
          owner: null,
          at: null,
          href: null,
          from: "csm",
          unsure: false,
        },
      ],
      seen: null,
      from: "fathom.action_items",
    });
  });
});

describe("seen, conflicts and Use mine", () => {
  test("each change carries the value this browser last had confirmed, never the revision", async () => {
    const s = server({ client_notes: "Old words" });
    const saver = saverFor({ save: s.save });
    saver.load({ client_notes: "Old words" }, 1);
    saver.set("client_notes", "New words", { now: true });
    await saver.flush();
    expect(s.calls[0].changes.client_notes).toEqual({
      value: "New words",
      seen: "Old words",
    });
    expect(s.calls[0].base).toBeNull();
    saver.set("client_notes", "Newer words", { now: true });
    await saver.flush();
    expect(s.calls[1].changes.client_notes.seen).toBe("New words");
    expect(saver.revision).toBe(3);
    expect(saver.isSeen("client_notes", "Newer words")).toBe(true);
  });

  test("someone else's change is a conflict, shown with what was typed; Use mine saves over it", async () => {
    const s = server({ priority: "Low" });
    const conflicts: unknown[] = [];
    const saver = saverFor({
      save: s.save,
      onConflict: c => conflicts.push(c),
    });
    saver.load({ priority: "Low" }, 1);
    s.other("priority", "911");
    saver.set("priority", "High", { now: true, from: "pick" });
    await saver.flush();
    expect(conflicts).toEqual([
      {
        key: "priority",
        theirs: "911",
        mine: "High",
        by: "Dana",
        at: "2026-10-25T08:05:00Z",
      },
    ]);
    expect(s.answers.priority).toBe("911");
    expect(saver.keepMine("priority", "High", "911", "pick")).toBeNull();
    await saver.flush();
    expect(s.answers.priority).toBe("High");
    expect(s.calls.at(-1)?.changes.priority.from).toBe("pick");
  });

  test("saving an unrelated key first never lets a stale edit overwrite another person's answer", async () => {
    const s = server({ client_notes: "Old reason" });
    const conflicts: { key: string }[] = [];
    const saver = saverFor({
      save: s.save,
      onConflict: c => conflicts.push(c),
    });
    saver.load({ client_notes: "Old reason" }, 1);
    s.other("client_notes", "Their reason");
    saver.set("defcon", "Happy", { now: true });
    await saver.flush();
    saver.set("client_notes", "My edit of the old reason", { now: true });
    await saver.flush();
    expect(conflicts.map(c => c.key)).toEqual(["client_notes"]);
    expect(s.answers.client_notes).toBe("Their reason");
    expect(s.answers.defcon).toBe("Happy");
  });

  test("another window's confirmed save is seen here too", () => {
    const s = server({ client_notes: "A" });
    const saver = saverFor({ save: s.save });
    saver.load({ client_notes: "A" }, 1);
    saver.confirm({ client_notes: "B" }, 3);
    expect(saver.seen("client_notes")).toBe("B");
    expect(saver.revision).toBe(3);
  });
});

describe("offline and refused", () => {
  test("a save that fails offline is kept and sent again", async () => {
    let online = false;
    const errors: [string, string[], boolean][] = [];
    const saved: string[] = [];
    const saver = saverFor({
      save: async changes => {
        if (!online) throw Error("Failed to fetch");
        saved.push(...Object.keys(changes));
        return { row: null, applied: Object.keys(changes), conflicts: [] };
      },
      onError: (m, keys, kept) => errors.push([m, keys, kept]),
    });
    saver.set("client_notes", "Calm");
    await saver.flush();
    expect(errors).toEqual([["Failed to fetch", ["client_notes"], true]]);
    expect(saver.waiting).toEqual(["client_notes"]);
    online = true;
    await saver.flush();
    expect(saved).toEqual(["client_notes"]);
    expect(saver.waiting).toEqual([]);
  });

  test("a refusal is reported once and never sent again", async () => {
    const errors: [string, string[], boolean][] = [];
    let calls = 0;
    class Refused extends Error {
      code = "22023";
    }
    const saver = saverFor({
      save: async () => {
        calls += 1;
        throw new Refused("That booked call has not happened yet.");
      },
      onError: (m, keys, kept) => errors.push([m, keys, kept]),
      keep: e => !(e instanceof Refused),
    });
    saver.set(
      "call",
      { kind: "booking", callId: 50001, why: "booking" },
      { now: true },
    );
    await saver.flush();
    expect(errors).toEqual([
      ["That booked call has not happened yet.", ["call"], false],
    ]);
    expect(saver.waiting).toEqual([]);
    await saver.flush();
    expect(calls).toBe(1);
  });
});
