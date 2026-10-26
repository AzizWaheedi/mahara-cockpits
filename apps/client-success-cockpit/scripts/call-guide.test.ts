import { describe, expect, test } from "bun:test";
import {
  type CallFacts,
  callFinished,
  countCall,
  guideFor,
  guideView,
  HELP_CALLS,
  HELP_KEY,
  helpOn,
  noFacts,
  readHelp,
  setHelp,
} from "../src/present/callSteps";

/**
 * The call guide's steps (docs/call-guide/DESIGN.md): each call's steps in
 * order, ticked only by what happened, the first not done is "now", the
 * beacon's target is that step's own control, and help is on for a
 * person's first three real calls of each kind, never counting a rehearsal
 * or practice (the component's rule, pinned in call-guide-render).
 *
 * Run: bun test scripts/call-guide.test.ts
 */

const facts = (f: Partial<CallFacts> = {}): CallFacts => ({
  ...noFacts(),
  ...f,
});

const now = (deck: "onboarding" | "launch" | "blueprint", f: CallFacts) =>
  guideView(guideFor(deck, { hosted: deck === "blueprint" }), f).now?.id ??
  null;

class Mem {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

describe("the onboarding call", () => {
  test("seven steps in three groups, in the call's order", () => {
    const s = guideFor("onboarding", { hosted: false });
    expect(s.map(x => x.id)).toEqual([
      "check",
      "notes",
      "present",
      "walk",
      "kickoff",
      "book",
      "close",
    ]);
    expect(s.map(x => x.group)).toEqual([
      "before",
      "before",
      "before",
      "call",
      "call",
      "call",
      "after",
    ]);
  });

  test("each fact moves the lit step on, and only its own", () => {
    expect(now("onboarding", facts())).toBe("check");
    expect(now("onboarding", facts({ notesOpen: true }))).toBe("present");
    expect(now("onboarding", facts({ deckOpen: true }))).toBe("notes");
    expect(now("onboarding", facts({ notesOpen: true, deckOpen: true }))).toBe(
      "walk",
    );
    expect(
      now(
        "onboarding",
        facts({
          notesOpen: true,
          deckOpen: true,
          reached: new Set(["kickoff"]),
        }),
      ),
    ).toBe("kickoff");
    expect(
      now(
        "onboarding",
        facts({ notesOpen: true, deckOpen: true, kickoffSent: true }),
      ),
    ).toBe("book");
    expect(
      now(
        "onboarding",
        facts({
          notesOpen: true,
          deckOpen: true,
          kickoffSent: true,
          blueprintBooked: true,
        }),
      ),
    ).toBe("close");
  });

  test("a kickoff already on record covers the steps before it", () => {
    const v = guideView(
      guideFor("onboarding", { hosted: false }),
      facts({ kickoffSent: true }),
    );
    expect(v.now?.id).toBe("book");
    expect(v.done).toBe(5);
  });

  test("every step done: no step is now", () => {
    const v = guideView(
      guideFor("onboarding", { hosted: false }),
      facts({
        notesOpen: true,
        deckOpen: true,
        deckClosed: true,
        kickoffSent: true,
        blueprintBooked: true,
      }),
    );
    expect(v.now).toBeNull();
    expect(v.done).toBe(v.total);
  });

  test("the beacon's target is the step's own control", () => {
    const v = guideView(
      guideFor("onboarding", { hosted: false }),
      facts({ notesOpen: true }),
    );
    expect(v.now?.target).toBe("present");
    const b = guideView(
      guideFor("onboarding", { hosted: false }),
      facts({ notesOpen: true, deckOpen: true, kickoffSent: true }),
    );
    expect(b.now?.target).toBe("book-blueprint");
  });

  test("the call is finished by the Blueprint booking, the last step on the call", () => {
    const s = guideFor("onboarding", { hosted: false });
    expect(callFinished(s, facts({ kickoffSent: true }))).toBe(false);
    expect(
      callFinished(s, facts({ kickoffSent: true, blueprintBooked: true })),
    ).toBe(true);
  });
});

describe("the launch call", () => {
  test("five steps; the walk is done at the last slide", () => {
    const s = guideFor("launch", { hosted: false });
    expect(s.map(x => x.id)).toEqual([
      "check",
      "notes",
      "present",
      "walk",
      "close",
    ]);
    expect(now("launch", facts({ notesOpen: true, deckOpen: true }))).toBe(
      "walk",
    );
    expect(
      now(
        "launch",
        facts({ notesOpen: true, deckOpen: true, reachedEnd: true }),
      ),
    ).toBe("close");
    expect(callFinished(s, facts({ reachedEnd: true }))).toBe(true);
  });

  test("its first step asks for the Drive link", () => {
    expect(guideFor("launch", { hosted: false })[0]?.how).toContain(
      "Drive link",
    );
  });
});

describe("the Brand Blueprint call", () => {
  test("seven steps; the three parts tick their own steps", () => {
    const s = guideFor("blueprint", { hosted: true });
    expect(s.map(x => x.id)).toEqual([
      "prep",
      "notes",
      "present",
      "part1",
      "offer",
      "close",
      "lock",
    ]);
    const open = { notesOpen: true, deckOpen: true };
    expect(now("blueprint", facts(open))).toBe("part1");
    expect(
      now(
        "blueprint",
        facts({ ...open, parts: { 1: true, 2: false, 3: false } }),
      ),
    ).toBe("offer");
    expect(
      now(
        "blueprint",
        facts({
          ...open,
          reached: new Set(["read-back"]),
          parts: { 1: true, 2: false, 3: false },
        }),
      ),
    ).toBe("close");
    expect(
      now(
        "blueprint",
        facts({ ...open, parts: { 1: true, 2: true, 3: false } }),
      ),
    ).toBe("lock");
  });

  test("hosted, it points at the page's notes button and says share this tab", () => {
    const hosted = guideFor("blueprint", { hosted: true });
    expect(hosted[1]?.how).toContain("Open the notes window at the top");
    expect(hosted[2]?.title).toBe("Present, then share this tab");
    const own = guideFor("blueprint", { hosted: false });
    expect(own[2]?.title).toBe("Present, then share only the deck window");
  });

  test("Close the call finishes the call; Lock the offer comes after it", () => {
    const s = guideFor("blueprint", { hosted: true });
    expect(
      callFinished(s, facts({ parts: { 1: true, 2: false, 3: false } })),
    ).toBe(false);
    expect(
      callFinished(s, facts({ parts: { 1: true, 2: true, 3: false } })),
    ).toBe(true);
    expect(s.find(x => x.id === "lock")?.group).toBe("after");
  });
});

describe("help on or off", () => {
  test("on for the first three real calls of each kind, once per card", () => {
    const mem = new Mem();
    expect(helpOn("onboarding", readHelp(mem))).toBe(true);
    countCall("onboarding", "a", mem);
    countCall("onboarding", "a", mem);
    countCall("onboarding", "b", mem);
    expect(helpOn("onboarding", readHelp(mem))).toBe(true);
    countCall("onboarding", "c", mem);
    expect(readHelp(mem).calls.onboarding).toHaveLength(HELP_CALLS);
    expect(helpOn("onboarding", readHelp(mem))).toBe(false);
    // Another kind of call keeps its own count.
    expect(helpOn("blueprint", readHelp(mem))).toBe(true);
  });

  test("the person's own choice wins over the count, both ways", () => {
    const mem = new Mem();
    setHelp(false, mem);
    expect(helpOn("launch", readHelp(mem))).toBe(false);
    for (const t of ["a", "b", "c"]) countCall("launch", t, mem);
    setHelp(true, mem);
    expect(helpOn("launch", readHelp(mem))).toBe(true);
  });

  test("broken or missing storage reads as help on, and never throws", () => {
    const broken = {
      getItem: () => {
        throw Error("blocked");
      },
      setItem: () => {
        throw Error("blocked");
      },
    };
    expect(helpOn("onboarding", readHelp(broken))).toBe(true);
    expect(() => countCall("onboarding", "a", broken)).not.toThrow();
    expect(() => setHelp(false, broken)).not.toThrow();
    const junk = new Mem();
    junk.setItem(HELP_KEY, "{not json");
    expect(helpOn("onboarding", readHelp(junk))).toBe(true);
    expect(helpOn("onboarding", readHelp(null))).toBe(true);
  });
});
