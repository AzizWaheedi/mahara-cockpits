import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BP_KEYS,
  checkValue,
  FIELDS,
  missing,
  PART_KEYS,
  partAnswers,
  QUESTIONS,
  required,
} from "../src/present/blueprintForm";

/**
 * The Brand Blueprint's registry (docs/brand-blueprint/SPEC.md 1.7): 33
 * visible questions in 3 parts, 21 required with their conditions, and the
 * browser's mirror of the server's checks, read against the migration
 * itself (supabase/migrations/20261024a_brand_blueprints.sql), so a key or a
 * choice added on one side and not the other fails here.
 */

const SQL = readFileSync(
  join(
    import.meta.dir,
    "../../../supabase/migrations/20261024a_brand_blueprints.sql",
  ),
  "utf8",
);
/** The body of one SQL function. */
const fn = (name: string) => {
  const at = SQL.indexOf(`FUNCTION public.${name}(`);
  if (at < 0) throw Error(`no ${name}`);
  return SQL.slice(at, SQL.indexOf("END $$;", at));
};

describe("the questions", () => {
  test("33 visible questions in three parts: 9, 21 and 3", () => {
    expect(QUESTIONS.length).toBe(33);
    expect(QUESTIONS.filter(q => q.part === 1).length).toBe(9);
    expect(QUESTIONS.filter(q => q.part === 2).length).toBe(21);
    expect(QUESTIONS.filter(q => q.part === 3).length).toBe(3);
    expect(new Set(QUESTIONS.map(q => q.n)).size).toBe(33);
  });

  test("21 required: 6 always and 2 with starter ads in part 1, 11 in part 2, 2 in part 3", () => {
    const req = (p: number) =>
      QUESTIONS.filter(q => q.part === p && q.req !== "no");
    expect(
      req(1)
        .filter(q => q.req === "yes")
        .map(q => q.n),
    ).toEqual(["1.1", "1.2", "1.3", "1.6", "1.7", "1.8"]);
    expect(
      req(1)
        .filter(q => q.req === "when")
        .map(q => q.n),
    ).toEqual(["1.4", "1.5"]);
    expect(req(2).map(q => q.n)).toEqual([
      "2.1",
      "2.3",
      "2.5",
      "2.6",
      "2.7",
      "2.10",
      "2.12",
      "2.13",
      "2.14",
      "2.15",
      "2.19",
    ]);
    expect(req(3).map(q => q.n)).toEqual(["3.1", "3.3"]);
    expect([1, 2, 3].flatMap(req).length).toBe(21);
    // 1.4 and 1.5 ask only when they start with starter ads.
    const q14 = QUESTIONS.find(q => q.n === "1.4");
    expect(q14 && required(q14, { starter: "yes" })).toBe(true);
    expect(q14 && required(q14, { starter: "no" })).toBe(false);
  });

  test("the budget, the margin and the CSM's lines are never typed on a slide", () => {
    const privateKeys = [
      "daily_budget",
      "margin",
      "csm_signals",
      "anything_else",
      "capacity",
      "pack_url",
      "destination",
      "identity",
    ];
    for (const k of privateKeys) {
      const q = QUESTIONS.find(x => x.key === k);
      expect({ k, client: q?.client }).toEqual({ k, client: false });
      expect(q?.where.some(w => "slide" in w)).toBe(false);
    }
  });
});

describe("the keys are the server's", () => {
  test("the registry's keys equal the migration's allow-list", () => {
    const body = fn("cockpit_blueprint_value");
    const caseBlock = body.slice(
      body.indexOf("t := CASE"),
      body.indexOf("END;"),
    );
    // Only what each WHEN names: the keys, never the types after THEN.
    const keys = [
      ...caseBlock.matchAll(/WHEN p_key (?:IN \(([^)]*)\)|= ('[a-z_]+'))/g),
    ]
      .flatMap(m => (m[1] ?? m[2]).match(/'([a-z_]+)'/g) ?? [])
      .map(k => k.slice(1, -1));
    expect([...new Set(keys)].sort()).toEqual([...BP_KEYS].sort());
  });

  test("each key's type and choices are the server's", () => {
    const body = fn("cockpit_blueprint_value");
    const typeOf = (k: string) => {
      for (const t of [
        "choice",
        "text",
        "long",
        "url",
        "usd",
        "lines",
        "money",
        "names",
        "rules",
        "ticks",
        "offer",
        "date",
      ]) {
        const re = new RegExp(
          `WHEN p_key (?:IN \\([^)]*'${k}'[^)]*\\)|= '${k}') THEN '${t}'`,
        );
        if (re.test(body)) return t;
      }
      return null;
    };
    for (const k of BP_KEYS)
      expect({ k, t: typeOf(k) }).toEqual({ k, t: FIELDS[k].type });
    for (const k of BP_KEYS) {
      const def = FIELDS[k] as { choices?: readonly string[] };
      if (!def.choices) continue;
      const m = new RegExp(`WHEN '${k}' THEN ARRAY\\[([^\\]]+)\\]`).exec(body);
      const sql = (m?.[1] ?? "").match(/'([^']+)'/g)?.map(x => x.slice(1, -1));
      expect({ k, choices: sql }).toEqual({ k, choices: [...def.choices] });
    }
  });

  test("each part's keys are the server's, in its order", () => {
    const body = fn("cockpit_blueprint_part_answers");
    for (const p of [1, 2, 3] as const) {
      const m = new RegExp(`WHEN ${p} THEN ARRAY\\[([^\\]]+)\\]`).exec(body);
      const sql = (m?.[1] ?? "").match(/'([^']+)'/g)?.map(x => x.slice(1, -1));
      expect(sql).toEqual([...PART_KEYS[p]]);
    }
  });
});

describe("missing(), as cockpit_blueprint_missing", () => {
  const full1 = {
    service: "interior",
    capacity: "yes",
    starter: "yes",
    pack_url: "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp",
    pack_approval: "on_call",
    daily_budget: { usd: 40 },
    destination: "lead_form",
    identity: "their_page",
  };
  const cases: [string, 1 | 2 | 3, Record<string, unknown>, string[]][] = [
    [
      "nothing yet",
      1,
      {},
      [
        "service",
        "capacity",
        "starter",
        "daily_budget",
        "destination",
        "identity",
      ],
    ],
    [
      "starter yes asks for the pack and its approval",
      1,
      { ...full1, pack_url: undefined, pack_approval: undefined },
      ["pack_url", "pack_approval"],
    ],
    [
      "starter no asks for neither",
      1,
      {
        ...full1,
        starter: "no",
        pack_url: undefined,
        pack_approval: undefined,
      },
      [],
    ],
    [
      "tight capacity asks for its line",
      1,
      { ...full1, capacity: "tight" },
      ["capacity_note"],
    ],
    [
      "wanting changes asks for them",
      1,
      { ...full1, pack_approval: "wants_changes" },
      ["pack_changes"],
    ],
    [
      "a blank answer is missing",
      1,
      { ...full1, capacity_note: "  ", capacity: "no" },
      ["capacity_note"],
    ],
    ["part 1 whole", 1, full1, []],
    [
      "part 2 empty",
      2,
      {},
      [
        "best_client",
        "method",
        "pricing",
        "minimum",
        "anchor",
        "competitors",
        "approval",
        "dna_status",
        "rules",
        "camera",
        "readback_yes",
      ],
    ],
    [
      "gaps in the Brand DNA ask what is missing",
      2,
      { dna_status: "small_gaps" },
      [
        "best_client",
        "method",
        "pricing",
        "minimum",
        "anchor",
        "competitors",
        "approval",
        "dna_missing",
        "rules",
        "camera",
        "readback_yes",
      ],
    ],
    [
      "part 3 needs all three of the offer's lines",
      3,
      { offer: { name: "A", what: "B" } },
      ["offer"],
    ],
    [
      "part 3 whole",
      3,
      { offer: { name: "A", what: "B", firstStep: "C" } },
      [],
    ],
  ];
  for (const [name, part, a, out] of cases)
    test(name, () => {
      const clean = Object.fromEntries(
        Object.entries(a).filter(([, v]) => v !== undefined),
      );
      expect(missing(part, clean)).toEqual(out);
    });

  test("a part's answers leave out what its conditions switch off", () => {
    expect(
      partAnswers(1, { ...full1, starter: "no", capacity_note: "x" }),
    ).toEqual({
      service: "interior",
      capacity: "yes",
      starter: "no",
      daily_budget: { usd: 40 },
      destination: "lead_form",
      identity: "their_page",
    });
    expect(
      partAnswers(2, {
        shot_list_due: "2026-10-25",
        dna_status: "complete",
        dna_missing: "x",
      }),
    ).toEqual({
      dna_status: "complete",
    });
  });
});

describe("checkValue(), the server's value checks", () => {
  test("refuses what the server refuses, in plain sentences", () => {
    expect(checkValue("nope", "x")).toEqual({
      error: "The Brand Blueprint has no answer called nope.",
    });
    expect(checkValue("service", "kitchens")).toHaveProperty("error");
    expect(
      checkValue("pack_url", "https://drive.google.com/file/d/abc"),
    ).toEqual({
      error: "Paste the starter pack's Google Drive folder link.",
    });
    expect(checkValue("minimum", { amount: 5000, currency: "EUR" })).toEqual({
      error: "Choose the currency.",
    });
    expect(checkValue("daily_budget", { usd: 0 })).toHaveProperty("error");
    expect(checkValue("capacity_note", "x".repeat(301))).toHaveProperty(
      "error",
    );
    expect(
      checkValue(
        "red_lines",
        Array.from({ length: 13 }, (_, i) => `line ${i}`),
      ),
    ).toHaveProperty("error");
    expect(checkValue("scripts_date", "2026-02-30")).toEqual({
      error: "Choose a real date.",
    });
  });
  test("normalises as the server does: trimmed, blanks removed, duplicates dropped", () => {
    expect(checkValue("method", "  We draw it  ")).toEqual({
      value: "We draw it",
    });
    expect(checkValue("method", "   ")).toEqual({ value: null });
    expect(checkValue("capacity_note", "two\nlines")).toEqual({
      value: "two lines",
    });
    expect(checkValue("red_lines", ["No prices", "no prices", " "])).toEqual({
      value: ["No prices"],
    });
    expect(checkValue("shot_list", false)).toEqual({ value: null });
    expect(
      checkValue("competitors", [
        { name: " Atelier ", lose: true },
        { name: "atelier" },
      ]),
    ).toEqual({
      value: [{ name: "Atelier", lose: true }],
    });
    expect(
      checkValue("offer", {
        name: " The plan ",
        what: "",
        firstStep: "A visit",
      }),
    ).toEqual({
      value: { name: "The plan", firstStep: "A visit" },
    });
  });
});
