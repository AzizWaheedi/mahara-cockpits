import { describe, expect, test } from "bun:test";
import { funnel, readGiven } from "./funnel";
import {
  type Capture,
  firstSentence,
  groupBlocks,
  inlineCaptures,
  LEDGER_LABELS,
  LEDGER_SLOTS,
  lineParts,
  numbersSummary,
  personalise,
  personaliseMarked,
  type Stage,
  scriptNoteBody,
  sentenceCase,
} from "./script";

const tokens = {
  "PROJECT VALUE": "85,000 KWD",
  "GAP YEAR": "793,000 KWD",
  "GAP MONTH": "66,000 KWD",
  "BOOKING RATE": "18%",
  "YEARS IN BUSINESS": "12 years",
};

describe("filling the script's numbers", () => {
  test("named and numbers placeholders, the old dollar ones too", () => {
    expect(
      personalise("[NAME], at your average of $[V] that's $[gap] a year.", {
        name: "Faisal",
        tokens,
      }),
    ).toBe("Faisal, at your average of 85,000 KWD that's 793,000 KWD a year.");
    expect(
      personalise("another $[monthly figure] going to whoever picks up", {
        tokens,
      }),
    ).toBe("another 66,000 KWD going to whoever picks up");
    expect(
      personalise("So in the last [X years in business] you've never", {
        tokens,
      }),
    ).toBe("So in the last 12 years you've never");
    expect(personalise("من [X سنين في الشغل]", { tokens })).toBe("من 12 years");
  });

  test("what the rep works out on the call stays as written", () => {
    expect(
      personalise("[Company A] signed $[X] in [calculate]", { tokens }),
    ).toBe("[Company A] signed $[X] in [calculate]");
    expect(
      personalise("You're at [BOOKING RATE], ours [OUR BOOKING RATE]", {
        tokens,
      }),
    ).toBe("You're at 18%, ours [OUR BOOKING RATE]");
  });

  test("marked: what the notes filled, and the numbers still to ask for", () => {
    const marked = personaliseMarked(
      "You're at [BOOKING RATE], ours [OUR BOOKING RATE]. [X] too.",
      {
        tokens,
      },
    );
    expect(lineParts(marked)).toEqual([
      { kind: "text", text: "You're at " },
      { kind: "filled", text: "18%" },
      { kind: "text", text: ", ours " },
      { kind: "blank", token: "OUR BOOKING RATE" },
      { kind: "text", text: ". " },
      { kind: "blank", token: "X" },
      { kind: "text", text: " too." },
    ]);
  });

  test("the bullet view never breaks a mark", () => {
    const marked = personaliseMarked(
      "Each one costs you about [PROJECT VALUE]. Then more.",
      {
        tokens,
      },
    );
    const parts = lineParts(firstSentence(marked));
    expect(parts).toEqual([
      { kind: "text", text: "Each one costs you about " },
      { kind: "filled", text: "85,000 KWD" },
      { kind: "text", text: "." },
    ]);
    // Cut mid-value, the value still closes.
    expect(lineParts(`${marked.slice(0, 28)}`)).toEqual([
      { kind: "text", text: "Each one costs you about " },
      { kind: "filled", text: "85" },
    ]);
  });
});

describe("no raw bracket is read out loud (D3.3)", () => {
  test("a placeholder with no value is a dashed blank with its words", () => {
    expect(
      lineParts(
        personaliseMarked("Given that you've got [STRENGTHS] dialed in", {}),
      ),
    ).toEqual([
      { kind: "text", text: "Given that you've got " },
      { kind: "blank", token: "Strengths" },
      { kind: "text", text: " dialed in" },
    ]);
    expect(
      lineParts(
        personaliseMarked(
          "The missing piece is [match to their specific pain]",
          {},
        ),
      ),
    ).toEqual([
      { kind: "text", text: "The missing piece is " },
      { kind: "blank", token: "Match to their specific pain" },
    ]);
    // [CLOSER NAME] before the demo is booked, and the long one past 60 characters.
    const long = personaliseMarked(
      "[CLOSER NAME] had a [similar company type — interior design firm / contractor / finishing company]",
      {},
    );
    expect(lineParts(long).filter(p => p.kind === "blank")).toEqual([
      { kind: "blank", token: "Closer name" },
      {
        kind: "blank",
        token:
          "Similar company type — interior design firm / contractor / finishing company",
      },
    ]);
  });

  test("the doc's own counts and alternatives stay as written", () => {
    const parts = lineParts(
      personaliseMarked("Use [2-3] of these [or our system] and [٢-٣]", {}),
    );
    expect(parts).toEqual([
      { kind: "text", text: "Use [2-3] of these [or our system] and [٢-٣]" },
    ]);
  });

  test("unmarked (what gets saved or sent) is left exactly as it was", () => {
    expect(
      personalise("[STRENGTHS] and __ or __ at [TIME + TIMEZONE]", {}),
    ).toBe("[STRENGTHS] and __ or __ at [TIME + TIMEZONE]");
  });

  test("sentence case", () => {
    expect(sentenceCase("TIME + TIMEZONE")).toBe("Time + timezone");
    expect(sentenceCase(" X ")).toBe("X");
    expect(sentenceCase("partner/father/board member")).toBe(
      "Partner/father/board member",
    );
    expect(sentenceCase("X الميزة اللي تميّزنا")).toBe("X الميزة اللي تميّزنا");
  });
});

describe("the booking's times in the lines", () => {
  test("__ or __ takes the first two free times, in either language", () => {
    const slots = ["Sun 6:00 pm", "Mon 10:00 am"];
    expect(personalise("what time works for you — __ or __?", { slots })).toBe(
      "what time works for you — Sun 6:00 pm or Mon 10:00 am?",
    );
    expect(
      personalise("متى يناسبك — __ ولا __؟", {
        slots: ["الأحد الساعة ٦ المسا", "الاثنين الساعة ١٠ الصبح"],
      }),
    ).toBe("متى يناسبك — الأحد الساعة ٦ المسا ولا الاثنين الساعة ١٠ الصبح؟");
  });
  test("before the times are read, a blank that says so", () => {
    expect(
      lineParts(personaliseMarked("for you — __ or __?", { slots: null })),
    ).toEqual([
      { kind: "text", text: "for you — " },
      { kind: "blank", token: "TWO TIMES" },
      { kind: "text", text: "?" },
    ]);
  });
  test("[TIME + TIMEZONE] and [DATE] once booked", () => {
    expect(
      personalise("Perfect. [TIME + TIMEZONE]. … between now and [DATE]", {
        booked: "Sun 12 Oct at 6:00 pm Kuwait time",
        date: "Sun 12 Oct 18:00",
      }),
    ).toBe(
      "Perfect. Sun 12 Oct at 6:00 pm Kuwait time. … between now and Sun 12 Oct 18:00",
    );
  });
});

const stage = (blocks: Stage["blocks"]): Stage => ({
  no: 4,
  title: "What They've Tried",
  goal: null,
  minutes: 2,
  blocks,
  checklist: [],
});
const cap = (key: string, after?: number, st = 4): Capture => ({
  stage: st,
  key,
  label: key,
  type: "text",
  ...(after === undefined ? {} : { after }),
});

describe("fields under the line that asks for them", () => {
  test("groups keep where they start, so an anchor finds its line inside a branch", () => {
    const blocks = [
      { type: "say" as const, text: "a" },
      { type: "say" as const, text: "b", branch: "If YES" },
      { type: "say" as const, text: "c", branch: "If ads" },
      { type: "note" as const, text: "d", branch: "If ads" },
      { type: "say" as const, text: "e" },
    ];
    expect(
      groupBlocks(blocks).map(g => [g.branch, g.start, g.blocks.length]),
    ).toEqual([
      [null, 0, 1],
      ["If YES", 1, 1],
      ["If ads", 2, 2],
      [null, 4, 1],
    ]);
  });

  test("anchored, unanchored, out of range, on a step, another stage, skipped", () => {
    const s = stage([
      { type: "say", text: "a" },
      { type: "step", text: "Sales" },
      { type: "say", text: "c" },
    ]);
    const out = inlineCaptures(
      s,
      [
        cap("one", 0),
        cap("two", 2),
        cap("two_b", 2),
        cap("loose"),
        cap("far", 9),
        cap("heading", 1),
        cap("other", 0, 5),
        cap("for_the_closer"),
      ],
      ["for_the_closer"],
    );
    expect(
      Object.fromEntries(
        Object.entries(out.at).map(([k, v]) => [k, v.map(c => c.key)]),
      ),
    ).toEqual({
      "0": ["one"],
      "2": ["two", "two_b"],
    });
    expect(out.rest.map(c => c.key)).toEqual(["loose", "far", "heading"]);
  });
});

describe("the call's notes as the lead keeps them", () => {
  const captures: Capture[] = [
    { stage: 2, key: "pain", label: "The pain", type: "choice" },
    {
      stage: 3,
      key: "project_value",
      label: "Typical project value",
      type: "money",
    },
    { stage: 6, key: "for_the_closer", label: "For the closer", type: "text" },
  ];
  const stages = [
    { no: 2, title: "Find the Pain" },
    { no: 3, title: "Understand Current State" },
    { no: 6, title: "Transition to Demo" },
  ];

  test("first line, the closer's line, answers, numbers, then notes by part", () => {
    const body = scriptNoteBody({
      key: "intro",
      captures,
      values: {
        pain: "Not enough leads",
        project_value: "85k",
        for_the_closer: "Partner decides money",
      },
      numbers: "Their numbers: ad spend 1,200 KWD a month.",
      notes: { "3": "Villas only", "2": "  ", "6": "ignored for the intro" },
      stages: stages.filter(s => s.no !== 6),
    });
    expect(body).toBe(
      [
        "Intro call notes",
        "For the closer: Partner decides money",
        "",
        "Answers",
        "The pain: Not enough leads",
        "Typical project value: 85k",
        "",
        "Their numbers: ad spend 1,200 KWD a month.",
        "",
        "Notes by part",
        "3. Understand Current State: Villas only",
      ].join("\n"),
    );
    expect(
      body.replace(/^Intro call notes\n/, "").startsWith("For the closer"),
    ).toBe(true);
  });

  test("a money answer typed without its currency says it", () => {
    const body = scriptNoteBody({
      key: "intro",
      captures: [
        ...captures,
        { stage: 3, key: "revenue_12m", label: "Revenue", type: "money" },
        { stage: 3, key: "ad_spend_month", label: "Ad spend", type: "money" },
        { stage: 3, key: "margin", label: "Margin", type: "text" },
      ],
      values: {
        project_value: "85k",
        revenue_12m: "1.2m KWD",
        ad_spend_month: "around 900 dinars",
        margin: "30",
      },
      numbers: "",
      notes: {},
      stages,
      currency: "KWD",
    });
    expect(body).toContain("Typical project value: 85k KWD");
    expect(body).toContain("Revenue: 1.2m KWD\n");
    expect(body).toContain("Ad spend: around 900 dinars");
    expect(body).toContain("Margin: 30");
    expect(body).not.toContain("Margin: 30 KWD");
  });

  test("the demo's, with nothing but a note", () => {
    expect(
      scriptNoteBody({
        key: "demo",
        captures: [],
        values: {},
        numbers: "",
        notes: { "4": "Two partners" },
        stages: [{ no: 4, title: "Paint Current State" }],
      }),
    ).toBe("Demo notes\n\nNotes by part\n4. Paint Current State: Two partners");
  });

  test("the numbers line names the funnel the way the old one did", () => {
    const f = funnel(
      readGiven({
        ad_spend_month: "1200",
        ad_leads_month: "40",
        project_value: "85k",
      }),
      "KWD",
    );
    expect(numbersSummary(f, "intro")).toContain(
      "Their numbers: ad spend 1,200 KWD a month",
    );
  });
});

describe("the number strip", () => {
  test("the intro's six and the demo's eight, every one labelled", () => {
    expect(LEDGER_SLOTS.intro).toHaveLength(6);
    expect(LEDGER_SLOTS.demo.slice(-4)).toEqual([
      "leads_month",
      "booked_month",
      "showed_month",
      "closed_month",
    ]);
    for (const k of [...LEDGER_SLOTS.intro, ...LEDGER_SLOTS.demo])
      expect(LEDGER_LABELS[k]).toBeTruthy();
  });
});
