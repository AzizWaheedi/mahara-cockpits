import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import {
  type Account,
  amountProblem,
  METHODS as convexMethods,
  PLANS as convexPlans,
  ladderOf,
} from "../convex/billingCore";
import { bankCanBe } from "../convex/ceo/manualMatch";
import * as sheet from "../src/lib/billingCore";

// The rules both cockpits and Maher bill by (convex/billingCore.ts).

describe("amounts", () => {
  test("every cent amount up to $10,000 is a payment", () => {
    // An exact comparison refused 18,865 of these, $2.01 among them.
    let refused = 0;
    for (let c = 1; c <= 1_000_000; c++)
      if (amountProblem(c / 100, "USD") !== null) refused++;
    expect(refused).toBe(0);
  });

  test("every fils amount up to 10,000 KWD is a payment", () => {
    let refused = 0;
    for (let f = 1; f <= 10_000_000; f++)
      if (amountProblem(f / 1000, "KWD") !== null) refused++;
    expect(refused).toBe(0);
  });

  test("what is not a payment", () => {
    expect(amountProblem(0, "USD")).not.toBeNull();
    expect(amountProblem(-5, "USD")).not.toBeNull();
    expect(amountProblem(Number.NaN, "USD")).not.toBeNull();
    expect(amountProblem(12.345, "USD")).toContain("two decimals");
    expect(amountProblem(12.3456, "KWD")).toContain("three decimals");
    expect(amountProblem(250_000, "USD")).not.toBeNull();
  });
});

const card = (over: Partial<Account>): Account => ({
  taskId: "t",
  name: "Client",
  url: null,
  status: "Active",
  group: "active",
  method: null,
  plan: "Monthly",
  country: null,
  nextUsd: 1000,
  nextDate: null,
  mrrUsd: null,
  ltvFieldUsd: null,
  pausedOn: null,
  extensionWeeks: null,
  churnDate: null,
  csm: null,
  syncedAt: null,
  source: "sync",
  ...over,
});

describe("the ladder, as the SOP and Maher's scan have it", () => {
  const today = "2026-09-23";
  const at = (nextDate: string) => ladderOf(card({ nextDate }), today);

  test("before the day", () => {
    expect(at("2026-10-05").rung).toBe("later");
    expect(at("2026-09-30").rung).toBe("confirm"); // 7 out
    expect(at("2026-09-27").rung).toBe("confirm"); // 4 out
    expect(at("2026-09-26").label).toBe("Send the invoice"); // 3 out
    expect(at("2026-09-24").label).toBe("Check the invoice went out");
  });

  test("the day and after", () => {
    expect(at("2026-09-23").rung).toBe("today");
    expect(at("2026-09-22").rung).toBe("day1");
    expect(at("2026-09-21").rung).toBe("call");
    expect(at("2026-09-20").rung).toBe("pause");
    expect(at("2026-09-09").rung).toBe("pause"); // day 14
    expect(at("2026-08-29").rung).toBe("churn"); // 25 days, never paused
  });

  test("paused is counted from Paused On, never from the payment date", () => {
    const paused = (pausedOn: string | null) =>
      ladderOf(
        card({
          status: "Paused",
          group: "paused",
          pausedOn,
          nextDate: "2026-09-01",
        }),
        today,
      );
    expect(paused(null).label).toContain("no pause date");
    expect(paused("2026-09-21").rung).toBe("paused");
    expect(paused("2026-09-08").rung).toBe("churn"); // 15 days
  });

  test("cards that are not paying clients have no step", () => {
    expect(ladderOf(card({ group: "gone" }), today).rung).toBe("none");
    expect(ladderOf(card({ group: "sales" }), today).rung).toBe("none");
  });
});

describe("a hand-logged payment and the bank line that is the same money", () => {
  test("a transfer matches within three days either way", () => {
    expect(bankCanBe("bank_transfer", "2026-09-23", "2026-09-26")).toBe(true);
    expect(bankCanBe("bank_transfer", "2026-09-23", "2026-09-20")).toBe(true);
    expect(bankCanBe("bank_transfer", "2026-09-23", "2026-09-27")).toBe(false);
  });

  test("a cheque matches its deposit up to two weeks later", () => {
    // Liwan's cheque: logged the day it was handed over, cleared later.
    expect(bankCanBe("cheque", "2026-09-23", "2026-09-30")).toBe(true);
    expect(bankCanBe("cheque", "2026-09-23", "2026-10-07")).toBe(true);
    expect(bankCanBe("cheque", "2026-09-23", "2026-10-08")).toBe(false);
    // Never a deposit from long before the cheque was received.
    expect(bankCanBe("cheque", "2026-09-23", "2026-09-19")).toBe(false);
  });
});

// The sheet's own rules (src/lib/billingCore.ts, the same in both cockpits):
// the one ladder of 20261101p, editable, and the MRR check's words.
describe("the overdue steps: a pause review on day 4, a cancel review on day 15", () => {
  const today = "2026-11-01";
  const at = (nextDate: string, steps?: sheet.LadderSteps) =>
    sheet.ladderOf({ ...card({ nextDate }) } as sheet.Account, today, steps);

  test("the defaults are the CEO's 09-19 rule", () => {
    expect(sheet.DEFAULT_STEPS).toEqual({
      pauseReviewDay: 4,
      cancelReviewDay: 15,
    });
    expect(at("2026-10-31").rung).toBe("day1");
    expect(at("2026-10-29").rung).toBe("call"); // 3 late: still a call
    expect(at("2026-10-28").rung).toBe("pause"); // day 4
    expect(at("2026-10-28").label).toBe("Pause review, call first");
    expect(at("2026-10-18").rung).toBe("pause"); // day 14
    expect(at("2026-10-17").rung).toBe("churn"); // day 15
    expect(at("2026-10-17").label).toBe("Cancel review, call first");
  });

  test("the CEO's own days move every row", () => {
    const steps = { pauseReviewDay: 3, cancelReviewDay: 10 };
    expect(at("2026-10-29", steps).rung).toBe("pause");
    expect(at("2026-10-22", steps).rung).toBe("churn");
    expect(sheet.ladderSentence(steps)).toBe(
      "The ladder: a pause review on day 3 and a cancel review on day 10. Neither changes the card by itself.",
    );
  });

  test("paused fourteen days is the restart-or-churn review, counted from Paused On", () => {
    const paused = (pausedOn: string) =>
      sheet.ladderOf(
        card({
          status: "Paused",
          group: "paused",
          pausedOn,
          nextDate: "2026-09-01",
        }) as sheet.Account,
        today,
      );
    expect(paused("2026-10-19").rung).toBe("day14"); // 13 days
    expect(paused("2026-10-18").rung).toBe("churn"); // 14 days
    expect(paused("2026-10-18").label).toBe(
      "Paused 14 days: restart or confirm churn",
    );
    expect(paused("2026-10-21").rung).toBe("day14"); // 11 days
  });

  test("what the server sends is trusted only when it is a real ladder", () => {
    expect(sheet.stepsFrom({ pauseReviewDay: 5, cancelReviewDay: 20 })).toEqual(
      { pauseReviewDay: 5, cancelReviewDay: 20 },
    );
    expect(sheet.stepsFrom(null)).toEqual(sheet.DEFAULT_STEPS);
    expect(
      sheet.stepsFrom({ pauseReviewDay: 10, cancelReviewDay: 10 }),
    ).toEqual(sheet.DEFAULT_STEPS);
    expect(
      sheet.stepsFrom({ pauseReviewDay: "4", cancelReviewDay: 99 }),
    ).toEqual(sheet.DEFAULT_STEPS);
  });

  test("buildSheet reads every row with the steps it is given and keeps them", () => {
    const s = sheet.buildSheet(
      [
        card({
          taskId: "a",
          name: "A",
          nextDate: "2026-10-29",
        }) as sheet.Account,
      ],
      [],
      [],
      today,
      { pauseReviewDay: 3, cancelReviewDay: 10 },
    );
    expect(s.steps).toEqual({ pauseReviewDay: 3, cancelReviewDay: 10 });
    expect(s.rows[0].ladder.rung).toBe("pause");
  });
});

describe("the MRR check's words (cockpit_mrr_read)", () => {
  const raw = {
    asOf: "2026-11-01T05:00:00Z",
    tolerancePct: 10,
    railNote: null,
    rows: [
      {
        taskId: "a",
        clientName: "Ardon",
        plan: "Monthly",
        mrrUsd: 2000,
        suggestedUsd: 2000,
        suggestionWhy: "x",
        railMonthlyUsd: 1500,
        railNote: "Whop",
        flag: "differs_rail",
      },
      {
        taskId: "b",
        clientName: "Beta",
        plan: "Monthly",
        mrrUsd: null,
        suggestedUsd: 1300,
        suggestionWhy: "x",
        railMonthlyUsd: null,
        railNote: null,
        flag: "missing",
      },
      {
        taskId: "c",
        clientName: "Cedar",
        plan: "Paid in full (90 days)",
        mrrUsd: 2000,
        suggestedUsd: null,
        suggestionWhy: "x",
        railMonthlyUsd: null,
        railNote: null,
        flag: "not_recurring",
      },
      {
        taskId: "d",
        clientName: "Dune",
        plan: "Monthly",
        mrrUsd: 1333,
        suggestedUsd: 1000,
        suggestionWhy: "x",
        railMonthlyUsd: null,
        railNote: null,
        flag: "differs_suggestion",
      },
      {
        taskId: "e",
        clientName: "Elm",
        plan: "Monthly",
        mrrUsd: 700,
        suggestedUsd: 700,
        suggestionWhy: "x",
        railMonthlyUsd: null,
        railNote: null,
        flag: "ok",
      },
    ],
    totals: {
      onBooks: 4033,
      onBooksCards: 3,
      suggested: 5000,
      noSuggestion: 1,
      missing: 1,
      differ: 2,
    },
    downgrades: [
      {
        taskId: "d",
        clientName: "Dune",
        fromUsd: 1800,
        toUsd: 1333,
        effective: "2026-11-01",
        reason: "One campaign",
        seatRole: "the CSM",
      },
    ],
  };

  test("each flag reads as 5.3 words it; a true MRR carries no chip", () => {
    const v = sheet.mrrViewFrom(raw);
    if (!v) throw new Error("expected a view");
    const chip = (id: string) =>
      sheet.mrrChip(v.rows.find(r => r.taskId === id));
    expect(chip("a")).toBe("Card $2,000, money in $1,500");
    expect(chip("b")).toBe("MRR missing");
    expect(chip("c")).toBe("Not a monthly plan");
    expect(chip("d")).toBe("Card $1,333, suggested $1,000");
    expect(chip("e")).toBeNull();
    expect(v.rows.filter(sheet.mrrDiffers).map(r => r.taskId)).toEqual([
      "a",
      "d",
    ]);
    expect(v.downgrades[0]).toMatchObject({
      clientName: "Dune",
      fromUsd: 1800,
      toUsd: 1333,
      seatRole: "the CSM",
    });
  });

  test("missing is never zero", () => {
    const v = sheet.mrrViewFrom({
      rows: [{ taskId: "x", flag: "missing", mrrUsd: null }],
      totals: {},
    });
    expect(v?.totals.onBooks).toBeNull();
    expect(v?.totals.suggested).toBeNull();
    expect(v?.rows[0].mrrUsd).toBeNull();
    expect(sheet.mrrViewFrom(null)).toBeNull();
    expect(sheet.mrrViewFrom("nope")).toBeNull();
  });
});

describe("the billing log's read (review W34: survey and nps_sent never crowd out money acts)", () => {
  // A fake client: each from() records its filters and answers from the rows given.
  function fakeClient(events: { id: number; kind: string; at: string }[]) {
    const reads: {
      table: string;
      not?: string;
      in?: string[];
      limit?: number;
    }[] = [];
    const client = {
      from(table: string) {
        const q: {
          table: string;
          not?: string;
          in?: string[];
          limit?: number;
        } = { table };
        reads.push(q);
        const b = {
          select: () => b,
          eq: () => b,
          order: () => b,
          not: (_c: string, _op: string, v: string) => {
            q.not = v;
            return b;
          },
          in: (_c: string, v: string[]) => {
            q.in = v;
            return b;
          },
          limit: (n: number) => {
            q.limit = n;
            return b;
          },
          // biome-ignore lint/suspicious/noThenProperty: a thenable like supabase-js's builder
          then(ok: (r: { data: unknown[]; error: null }) => unknown) {
            let rows: unknown[] = [];
            if (table === "cockpit_billing_events") {
              const voice = ["survey", "nps_sent"];
              rows = events
                .filter(e =>
                  q.in
                    ? q.in.includes(e.kind)
                    : q.not
                      ? !voice.includes(e.kind)
                      : true,
                )
                .sort((a, b2) => b2.at.localeCompare(a.at))
                .slice(0, q.limit ?? 1000);
            }
            return Promise.resolve({ data: rows, error: null }).then(ok);
          },
        };
        return b;
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    };
    return { client, reads };
  }

  test("60 money acts still reach the log on a day of 40 NPS sends, and the NPS rows come too", async () => {
    const { fetchBillingSheet } = await import("../src/lib/billing");
    const events: { id: number; kind: string; at: string }[] = [];
    for (let i = 0; i < 60; i++)
      events.push({
        id: i + 1,
        kind: "payment",
        at: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}T0${i % 10}:00:00+00:00`,
      });
    for (let i = 0; i < 40; i++)
      events.push({
        id: 100 + i,
        kind: i % 2 ? "nps_sent" : "survey",
        at: `2026-11-02T0${i % 10}:${String(i).padStart(2, "0")}:00+00:00`,
      });
    const { client, reads } = fakeClient(events);
    const s = await fetchBillingSheet(
      client as unknown as Parameters<typeof fetchBillingSheet>[0],
    );
    expect(s.events.filter(e => e.kind === "payment")).toHaveLength(60);
    expect(s.events.filter(e => e.kind !== "payment").length).toBe(20);
    // Newest first across both reads.
    const ats = s.events.map(e => String(e.at));
    expect([...ats].sort().reverse()).toEqual(ats);
    const ev = reads.filter(r => r.table === "cockpit_billing_events");
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ not: "(survey,nps_sent)", limit: 60 });
    expect(ev[1]).toMatchObject({ in: ["survey", "nps_sent"], limit: 20 });
  });
});

describe("How they pay offers only what the server takes (20261103a)", () => {
  const MIGRATIONS = new URL("../../../supabase/migrations/", import.meta.url);

  /** The body of a function's newest CREATE across the migrations, and its file. */
  function newestBody(fn: string): { file: string; body: string } {
    const files = readdirSync(MIGRATIONS)
      .filter(f => /^\d.*\.sql$/.test(f))
      .sort()
      .reverse();
    const create = new RegExp(
      `CREATE (?:OR REPLACE )?FUNCTION public\\.${fn}\\(`,
      "gi",
    );
    for (const file of files) {
      const sql = readFileSync(new URL(file, MIGRATIONS), "utf8").replace(
        /\r\n/g,
        "\n",
      );
      const at = [...sql.matchAll(create)].pop()?.index;
      if (at === undefined) continue;
      const tag = sql.slice(at).match(/AS\s+(\$[A-Za-z_]*\$)/);
      if (!tag || tag.index === undefined) continue;
      const start = at + tag.index + tag[0].length;
      return { file, body: sql.slice(start, sql.indexOf(tag[1], start)) };
    }
    throw new Error(`No migration defines ${fn}`);
  }

  /** The quoted names of the first NOT IN (...) after `marker`. */
  function allowList(body: string, marker: string): string[] {
    const at = body.indexOf(marker);
    if (at < 0) throw new Error(`No ${marker} in the body`);
    let i = body.indexOf("NOT IN (", at);
    if (i < 0) throw new Error(`No NOT IN after ${marker}`);
    i += "NOT IN (".length;
    const names: string[] = [];
    for (;;) {
      while (/[\s,]/.test(body[i])) i++;
      if (body[i] === ")") return names;
      if (body[i] !== "'")
        throw new Error(`Not a list of names after ${marker}`);
      let name = "";
      for (i++; ; i++) {
        if (body[i] === "'" && body[i + 1] === "'") {
          name += "'";
          i++;
        } else if (body[i] === "'") break;
        else name += body[i];
      }
      names.push(name);
      i++;
    }
  }

  const sorted = (xs: readonly string[]) => [...xs].sort();
  const write = newestBody("cockpit_billing_write");
  const canary = newestBody("cockpit_billing_canary");

  test("the sheet's methods and plans are cockpit_billing_write's, so no pick is refused on Save", () => {
    const methods = allowList(write.body, "WHEN 'method' THEN");
    const plans = allowList(write.body, "WHEN 'plan' THEN");
    expect(methods).toHaveLength(5);
    expect(plans).toHaveLength(5);
    expect([write.file, sorted(sheet.METHODS)]).toEqual([
      write.file,
      sorted(methods),
    ]);
    expect([write.file, sorted(sheet.PLANS)]).toEqual([
      write.file,
      sorted(plans),
    ]);
    // Maher's copy of the rules says the same.
    expect(sorted(convexMethods)).toEqual(sorted(methods));
    expect(sorted(convexPlans)).toEqual(sorted(plans));
    // "Ecom link" is not an option on the card's Payment Method field.
    expect(sheet.METHODS as readonly string[]).not.toContain("Ecom link");
  });

  test("the test card's canary takes the same names as the real save", () => {
    // A floor, not a name: a later canary migration passes when its lists
    // still match the real save.
    expect(canary.file >= "20261103a").toBe(true);
    expect(sorted(allowList(canary.body, "p_kind = 'method'"))).toEqual(
      sorted(allowList(write.body, "WHEN 'method' THEN")),
    );
    expect(sorted(allowList(canary.body, "p_kind = 'plan'"))).toEqual(
      sorted(allowList(write.body, "WHEN 'plan' THEN")),
    );
  });
});
