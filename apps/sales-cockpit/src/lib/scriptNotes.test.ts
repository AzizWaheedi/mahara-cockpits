import { describe, expect, test } from "bun:test";
import { ApiError } from "./apiErrors";
import {
  type CallDraft,
  DRAFT_TTL_MS,
  draftKey,
  NotesSaver,
  newCallId,
  readCallDraft,
  type SaveState,
  saveWords,
  writeCallDraft,
} from "./scriptNotes";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function memStore() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

/** A clock and timers the test moves by hand. */
function clock() {
  let now = 1_000_000;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (t: unknown) => void timers.delete(t as number),
    async advance(ms: number) {
      const until = now + ms;
      for (;;) {
        const next = [...timers.entries()]
          .filter(([, t]) => t.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
        await settle();
      }
      now = until;
      await settle();
    },
    pending: () => timers.size,
  };
}

async function settle() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** A server that answers when told to. */
function server() {
  const sent: Record<string, unknown>[] = [];
  const open: { res: () => void; rej: (e: unknown) => void }[] = [];
  return {
    sent,
    open,
    send: (p: Record<string, unknown>) =>
      new Promise<unknown>((res, rej) => {
        sent.push(p);
        open.push({ res: () => res({}), rej });
      }),
    async answer(ok = true, err: unknown = new Error("no")) {
      const o = open.shift();
      if (!o) throw new Error("nothing in flight");
      if (ok) o.res();
      else o.rej(err);
      await settle();
    },
  };
}

function rig(touched = false) {
  const c = clock();
  const s = server();
  const states: SaveState[] = [];
  let version = 0;
  const saved: boolean[] = [];
  let deleted = 0;
  const saver = new NotesSaver(
    {
      build: final => ({ v: version, final }),
      send: s.send,
      onState: st => states.push(st),
      onSaved: f => saved.push(f),
      onDeleted: () => {
        deleted += 1;
      },
      now: c.now,
      setTimer: c.setTimer,
      clearTimer: c.clearTimer,
    },
    touched,
  );
  return {
    c,
    s,
    states,
    saved,
    saver,
    type() {
      version += 1;
      saver.change();
    },
    deleted: () => deleted,
  };
}

describe("the device draft", () => {
  test("a new call has its own uuid", () => {
    expect(newCallId()).toMatch(UUID);
    expect(newCallId()).not.toBe(newCallId());
  });

  test("read back as written, with its call", () => {
    const s = memStore();
    const d: CallDraft = {
      callId: "3f0c9a52-6a1b-4c1e-9d55-0d6a2f1b7c11",
      at: 5_000,
      values: { pain: "Not enough leads" },
      checked: { "2.0": true },
      notes: { "3": "villas only" },
      touched: true,
    };
    writeCallDraft("lead-1", "intro", d, s);
    expect(s.m.has(draftKey("lead-1", "intro"))).toBe(true);
    expect(readCallDraft("lead-1", "intro", 6_000, s)).toEqual({
      ...d,
      fresh: false,
    });
  });

  test("older than 6 hours starts a new, empty call", () => {
    const s = memStore();
    writeCallDraft(
      "lead-1",
      "intro",
      {
        callId: "3f0c9a52-6a1b-4c1e-9d55-0d6a2f1b7c11",
        at: 0,
        values: { a: "1" },
        checked: {},
        notes: {},
        touched: true,
      },
      s,
    );
    const d = readCallDraft("lead-1", "intro", DRAFT_TTL_MS + 1, s);
    expect(d.fresh).toBe(true);
    expect(d.values).toEqual({});
    expect(d.callId).not.toBe("3f0c9a52-6a1b-4c1e-9d55-0d6a2f1b7c11");
  });

  test("a draft from before call ids keeps what was typed under a new call", () => {
    const s = memStore();
    s.setItem(
      draftKey("lead-1", "demo"),
      JSON.stringify({ values: { margin: "20%" }, checked: { "4.1": true } }),
    );
    const d = readCallDraft("lead-1", "demo", 10, s);
    expect(d.callId).toMatch(UUID);
    expect(d.values).toEqual({ margin: "20%" });
    expect(d.checked).toEqual({ "4.1": true });
    expect(d.touched).toBe(true);
  });

  test("a reload opens the part the rep was on, with the call's clock going on", () => {
    const s = memStore();
    writeCallDraft(
      "lead-1",
      "intro",
      {
        callId: "3f0c9a52-6a1b-4c1e-9d55-0d6a2f1b7c11",
        at: 9_000,
        values: {},
        checked: {},
        notes: {},
        // Moving through the parts with nothing typed is kept, unsent.
        touched: false,
        stage: 4,
        reached: 5,
        startedAt: 1_000,
      },
      s,
    );
    const d = readCallDraft("lead-1", "intro", 10_000, s);
    expect(d.fresh).toBe(false);
    expect(d.touched).toBe(false);
    expect(d.stage).toBe(4);
    expect(d.reached).toBe(5);
    expect(d.startedAt).toBe(1_000);
  });

  test("a part or a start that cannot be right is left out", () => {
    const s = memStore();
    s.setItem(
      draftKey("lead-1", "demo"),
      JSON.stringify({
        callId: "3f0c9a52-6a1b-4c1e-9d55-0d6a2f1b7c11",
        at: 9_000,
        stage: "3",
        reached: -1,
        startedAt: 20_000,
      }),
    );
    const d = readCallDraft("lead-1", "demo", 10_000, s);
    expect(d.stage).toBeUndefined();
    expect(d.reached).toBeUndefined();
    // A start after now is not a start.
    expect(d.startedAt).toBeUndefined();
  });

  test("garbage, or no storage at all, is a new call", () => {
    const s = memStore();
    s.setItem(draftKey("lead-1", "intro"), "{not json");
    expect(readCallDraft("lead-1", "intro", 1, s).fresh).toBe(true);
    expect(readCallDraft("lead-1", "intro", 1, null).fresh).toBe(true);
    s.setItem(
      draftKey("lead-1", "intro"),
      JSON.stringify({ callId: "nope", values: { x: 3 }, notes: { "2": 4 } }),
    );
    const d = readCallDraft("lead-1", "intro", 1, s);
    expect(d.callId).toMatch(UUID);
    expect(d.values).toEqual({});
    expect(d.notes).toEqual({});
  });
});

describe("the saver", () => {
  test("nothing is sent before something is typed", async () => {
    const r = rig();
    expect(await r.saver.flush()).toBe(true);
    await r.c.advance(60_000);
    expect(r.s.sent).toHaveLength(0);
    expect(r.saver.state.kind).toBe("idle");
  });

  test("it saves 2.5 seconds after typing stops, once", async () => {
    const r = rig();
    r.type();
    await r.c.advance(1_000);
    r.type();
    await r.c.advance(2_000);
    expect(r.s.sent).toHaveLength(0);
    await r.c.advance(600);
    expect(r.s.sent).toEqual([{ v: 2, final: false }]);
    expect(r.saver.state.kind).toBe("saving");
    await r.s.answer();
    expect(r.saver.state).toEqual({ kind: "saved", at: r.c.now() });
    expect(r.saved).toEqual([false]);
  });

  test("one save at a time: changes during a save queue exactly one more", async () => {
    const r = rig();
    r.type();
    await r.c.advance(2_500);
    expect(r.s.sent).toHaveLength(1);
    r.type();
    void r.saver.flush();
    r.type();
    void r.saver.flush();
    await r.c.advance(2_500);
    expect(r.s.sent).toHaveLength(1);
    await r.s.answer();
    expect(r.s.sent).toHaveLength(2);
    expect(r.s.sent[1]).toEqual({ v: 3, final: false });
    await r.s.answer();
    expect(r.s.sent).toHaveLength(2);
    expect(r.saver.state.kind).toBe("saved");
  });

  test("a final press waits for the save in flight, then sends as final", async () => {
    const r = rig();
    r.type();
    await r.c.advance(2_500);
    const done = r.saver.flush(true);
    await r.s.answer();
    expect(r.s.sent[1]).toEqual({ v: 1, final: true });
    await r.s.answer();
    expect(await done).toBe(true);
    expect(r.saved).toEqual([false, true]);
  });

  test("a failure keeps it on the device and tries again in 30 seconds", async () => {
    const r = rig();
    r.type();
    await r.c.advance(2_500);
    await r.s.answer(
      false,
      new ApiError("The cockpit could not reach its server.", "network"),
    );
    expect(r.saver.state).toMatchObject({
      kind: "failed",
      retryAt: r.c.now() + 30_000,
    });
    expect(saveWords(r.saver.state, () => "14:02")).toBe(
      "Not saved, kept on this device. Trying again in 30 seconds.",
    );
    await r.c.advance(29_000);
    expect(r.s.sent).toHaveLength(1);
    await r.c.advance(1_000);
    expect(r.s.sent).toHaveLength(2);
    await r.s.answer();
    expect(r.saver.state.kind).toBe("saved");
  });

  test("an unclear answer is simply sent again (the save is the same save)", async () => {
    const r = rig();
    r.type();
    await r.c.advance(2_500);
    await r.s.answer(
      false,
      new ApiError("The cockpit did not answer within 45 seconds.", "timeout"),
    );
    await r.c.advance(30_000);
    expect(r.s.sent).toEqual([
      { v: 1, final: false },
      { v: 1, final: false },
    ]);
  });

  test("a refusal it would get again waits for the next change", async () => {
    const r = rig();
    r.type();
    await r.c.advance(2_500);
    await r.s.answer(
      false,
      new ApiError(
        "These notes are too long to save. Shorten the longest part's notes.",
        "refused",
        400,
      ),
    );
    expect(r.saver.state).toMatchObject({ kind: "failed", retryAt: null });
    expect(saveWords(r.saver.state, () => "")).toBe(
      "Not saved, kept on this device. These notes are too long to save. Shorten the longest part's notes.",
    );
    await r.c.advance(120_000);
    expect(r.s.sent).toHaveLength(1);
    r.type();
    await r.c.advance(2_500);
    expect(r.s.sent).toHaveLength(2);
  });

  test("a deleted call starts a new one and saves again, once", async () => {
    const r = rig();
    r.type();
    await r.c.advance(2_500);
    await r.s.answer(
      false,
      new ApiError("These call notes were deleted.", "refused", 409, "deleted"),
    );
    expect(r.deleted()).toBe(1);
    expect(r.s.sent).toHaveLength(2);
    await r.s.answer(
      false,
      new ApiError("These call notes were deleted.", "refused", 409, "deleted"),
    );
    expect(r.deleted()).toBe(1);
    expect(r.saver.state.kind).toBe("failed");
  });

  test("a draft typed before a refresh saves on the next flush", async () => {
    const r = rig(true);
    expect(r.saver.state.kind).toBe("pending");
    const done = r.saver.flush();
    await settle();
    expect(r.s.sent).toHaveLength(1);
    await r.s.answer();
    expect(await done).toBe(true);
  });

  test("disposed: no more saves, and a waiting final press is told it did not land", async () => {
    const r = rig();
    r.type();
    await r.c.advance(2_500);
    const waiting = r.saver.flush(true);
    r.saver.dispose();
    expect(await waiting).toBe(false);
    r.type();
    await r.c.advance(10_000);
    expect(r.s.sent).toHaveLength(1);
  });
});
