import { describe, expect, test } from "bun:test";
import {
  ASSISTANTS,
  hermesSuggestions,
  nextPollDelay,
  parseHermesText,
  sameThread,
} from "../src/lib/hermesText";

const span = (text: string, bold = false) => ({ text, bold });
test("empty or whitespace text has no blocks", () => {
  expect(parseHermesText("")).toEqual([]);
  expect(parseHermesText(" \n\n\t ")).toEqual([]);
});
test("one paragraph keeps consecutive lines together", () => {
  expect(parseHermesText("first line\nsecond line")).toEqual([
    { kind: "paragraph", spans: [span("first line\nsecond line")] },
  ]);
});
test("mixed bullet markers form one list", () => {
  expect(parseHermesText("- one\n* two\n• three")).toEqual([
    { kind: "bullets", items: [[span("one")], [span("two")], [span("three")]] },
  ]);
});
test("numbered markers 1. and 2) form one list", () => {
  expect(parseHermesText("1. one\n2) two")).toEqual([
    { kind: "numbered", items: [[span("one")], [span("two")]] },
  ]);
});
test("a hash heading is its own block", () => {
  expect(parseHermesText("## Title")).toEqual([
    { kind: "heading", spans: [span("Title")] },
  ]);
});
test("a blank line splits paragraphs", () => {
  expect(parseHermesText("one\n\ntwo")).toEqual([
    { kind: "paragraph", spans: [span("one")] },
    { kind: "paragraph", spans: [span("two")] },
  ]);
});
test("bold pairs become bold spans", () => {
  expect(parseHermesText("**bold** and plain")).toEqual([
    { kind: "paragraph", spans: [span("bold", true), span(" and plain")] },
  ]);
});
test("an unmatched bold marker stays literal", () => {
  expect(parseHermesText("**open")).toEqual([
    { kind: "paragraph", spans: [span("**open")] },
  ]);
});
test("Arabic text passes through unchanged", () => {
  const arabic = "مرحبا بكم في محرة";
  expect(parseHermesText(arabic)).toEqual([
    { kind: "paragraph", spans: [span(arabic)] },
  ]);
});
test("media buyer suggestions name the client when there is one", () => {
  expect(hermesSuggestions("media-buyer", "Client A")).toEqual([
    "How is Client A doing this week?",
    "Which Client A ad has the best cost per lead?",
    "Write 3 captions for Client A's best ad",
  ]);
  expect(hermesSuggestions("media-buyer")).toEqual([
    "Which campaigns need attention today?",
    "Where did cost per lead rise this week?",
    "How are the ads doing today so far?",
  ]);
});
test("client success suggestions name the client when there is one", () => {
  expect(hermesSuggestions("client-success", "Client A")).toEqual([
    "Summarise Client A's latest updates",
    "What should I tell Client A this week?",
    "Any open tasks for Client A?",
  ]);
  expect(hermesSuggestions("client-success", null)).toEqual([
    "Which clients need a check-in?",
    "Summarise this week's client comments",
    "Which clients have lead sync problems?",
  ]);
});
test("creative suggestions name the client when there is one", () => {
  expect(hermesSuggestions("creative", "Client A")).toEqual([
    "Which Client A ads are winning?",
    "Give me 3 new angles for Client A",
    "What does Client A want changed?",
  ]);
  expect(hermesSuggestions("creative")).toEqual([
    "Which clients need new creatives?",
    "What creative requests are open?",
    "Give me 3 hook ideas for a design firm",
  ]);
});
test("a blank client string counts as no client", () => {
  expect(hermesSuggestions("media-buyer", "   ")).toEqual(
    hermesSuggestions("media-buyer"),
  );
  expect(hermesSuggestions("client-success", " ")).toEqual(
    hermesSuggestions("client-success"),
  );
  expect(hermesSuggestions("creative", "\t")).toEqual(
    hermesSuggestions("creative"),
  );
});
const APPS = ["media-buyer", "client-success", "creative"] as const;
test("each cockpit has its own assistant name", () => {
  expect(ASSISTANTS["media-buyer"].name).toBe("Signal");
  expect(ASSISTANTS["client-success"].name).toBe("Anchor");
  expect(ASSISTANTS.creative.name).toBe("Lens");
});
test("each assistant intro names the assistant itself", () => {
  for (const app of APPS) {
    expect(ASSISTANTS[app].intro).toContain(ASSISTANTS[app].name);
  }
});
test("no assistant role or intro has an em dash or an emoji", () => {
  for (const app of APPS) {
    const { role, intro } = ASSISTANTS[app];
    for (const text of [role, intro]) {
      expect(text.includes("\u2014")).toBe(false);
      expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
    }
  }
});
test("divider lines (---, ***, ___) split blocks and never show as text", () => {
  expect(parseHermesText("one\n---\ntwo\n***\n- a")).toEqual([
    { kind: "paragraph", spans: [span("one")] },
    { kind: "paragraph", spans: [span("two")] },
    { kind: "bullets", items: [[span("a")]] },
  ]);
  expect(parseHermesText("--")).toEqual([
    { kind: "paragraph", spans: [span("--")] },
  ]);
});
describe("nextPollDelay", () => {
  test("an error waits 5 seconds even while busy", () => {
    expect(nextPollDelay({ busy: true, error: true, open: true })).toBe(5000);
  });
  test("a pending answer polls every 1.5 seconds", () => {
    expect(nextPollDelay({ busy: true, error: false, open: false })).toBe(1500);
  });
  test("an open idle panel polls every 15 seconds", () => {
    expect(nextPollDelay({ busy: false, error: false, open: true })).toBe(15000);
  });
  test("a closed idle panel stops polling", () => {
    expect(nextPollDelay({ busy: false, error: false, open: false })).toBeNull();
  });
});
describe("sameThread", () => {
  test("equal arrays are the same thread", () => {
    expect(sameThread([{ id: "a" }], [{ id: "a" }])).toBe(true);
  });
  test("a changed status is a different thread", () => {
    expect(
      sameThread(
        [{ id: "a", status: "sent" }],
        [{ id: "a", status: "answered" }],
      ),
    ).toBe(false);
  });
  test("a different length is a different thread", () => {
    expect(sameThread([{ id: "a" }], [])).toBe(false);
  });
  test("two empty arrays are the same thread", () => {
    expect(sameThread([], [])).toBe(true);
  });
});
