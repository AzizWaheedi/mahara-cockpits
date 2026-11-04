/**
 * The wins ledger in the CEO refresh (docs/forms/WAVE56-CONTRACT.md 4.8, 6.4):
 * the money adapter reads cockpit_wins_v, the metrics count wins by win day,
 * upsells by the day of their offered and accepted events, upsell cash by
 * payment day, and a failed read is missing, never zero. Every client and id
 * here is made up.
 */
import { describe, expect, test } from "bun:test";
import { readWins, WINS_SQL } from "./native/adapters/money.js";
import {
  DEFINITIONS,
  extract,
  type WinRow,
  winGoalActuals,
  winsValues,
} from "./native/metrics";

const TODAY = "2026-11-20";
const win = (w: Partial<WinRow> & { id: string; kind: string }): WinRow => ({
  stage: "logged",
  wonOn: "2026-11-05",
  offeredOn: null,
  acceptedOn: null,
  ties: [],
  ...w,
});

const ROWS: WinRow[] = [
  win({ id: "w1", kind: "review", wonOn: "2026-11-03" }),
  win({ id: "w2", kind: "review", wonOn: "2026-10-28" }),
  win({ id: "w3", kind: "video_testimonial", wonOn: "2026-11-10" }),
  win({ id: "w4", kind: "referral", wonOn: "2026-11-11" }),
  win({ id: "w5", kind: "renewal", wonOn: "2026-11-12" }),
  win({ id: "w6", kind: "reactivation", wonOn: "2026-11-12" }),
  win({ id: "w7", kind: "podcast", wonOn: "2026-11-01" }),
  // Offered in October, accepted and paid in November: offered counts in October, accepted in November.
  win({
    id: "u1",
    kind: "upsell_website",
    stage: "paid",
    wonOn: "2026-10-25",
    offeredOn: "2026-10-25",
    acceptedOn: "2026-11-02",
    ties: [
      { paidOn: "2026-11-04", usd: 2000, checked: true },
      { paidOn: "2026-11-15", usd: 300, checked: false },
    ],
  }),
  // Offered and accepted in November, then paid: still offered and accepted.
  win({
    id: "u2",
    kind: "upsell_smm",
    stage: "paid",
    wonOn: "2026-11-06",
    offeredOn: "2026-11-06",
    acceptedOn: "2026-11-08",
    ties: [{ paidOn: "2026-11-09", usd: 1000, checked: true }],
  }),
  win({
    id: "u3",
    kind: "upsell_seo_geo",
    stage: "quote_given",
    wonOn: "2026-11-14",
    offeredOn: "2026-11-14",
  }),
];

const money = (wins: unknown) => ({ wins }) as never;
const values = (wins: unknown, metric: string, window: string) =>
  winsValues(money(wins)).find(v => v.metric === metric && v.window === window)
    ?.value;

describe("the wins metrics", () => {
  const block = { read: true, today: TODAY, rows: ROWS };

  test("wins count by win day in the window; a voided win never counts", () => {
    expect(values(block, "clients.wins.reviews", "mtd")).toBe(1);
    expect(values(block, "clients.wins.reviews", "lastMonth")).toBe(1);
    expect(values(block, "clients.wins.testimonials", "mtd")).toBe(1);
    expect(values(block, "clients.wins.podcasts", "mtd")).toBe(1);
    expect(values(block, "clients.wins.referrals", "mtd")).toBe(1);
    expect(values(block, "clients.wins.renewals", "mtd")).toBe(1);
    expect(values(block, "clients.wins.reactivations", "mtd")).toBe(1);
    const voided = {
      ...block,
      rows: [
        ...ROWS,
        win({ id: "v1", kind: "review", stage: "void", wonOn: "2026-11-04" }),
      ],
    };
    expect(values(voided, "clients.wins.reviews", "mtd")).toBe(1);
  });

  test("upsells count by event day, so a paid upsell is still offered and accepted; cash is checked money by payment day", () => {
    expect(values(block, "money.upsells.offered", "mtd")).toBe(2); // u2, u3
    expect(values(block, "money.upsells.offered", "lastMonth")).toBe(1); // u1
    expect(values(block, "money.upsells.accepted", "mtd")).toBe(2); // u1, u2
    expect(values(block, "money.upsells.cash", "mtd")).toBe(3000); // the unchecked $300 waits
    expect(values(block, "money.upsells.rate", "mtd")).toBe(1);
    expect(values(block, "money.upsells.rate", "lastMonth")).toBe(0);
    const v = winsValues(money(block)).find(
      x => x.metric === "money.upsells.cash" && x.window === "mtd",
    );
    expect([v?.windowFrom, v?.windowTo, v?.scope]).toEqual([
      "2026-11-01",
      TODAY,
      "company",
    ]);
  });

  test("the upsell rate is not known, never 0, when nothing was offered", () => {
    const quiet = { read: true, today: "2026-12-05", rows: ROWS };
    expect(values(quiet, "money.upsells.offered", "mtd")).toBe(0);
    expect(values(quiet, "money.upsells.rate", "mtd")).toBeNull();
    expect(
      winGoalActuals([], "2026-11-01", "2026-11-30").upsellRate,
    ).toBeNull();
  });

  test("a wins block that was not read writes nothing: missing is never zero", () => {
    expect(
      winsValues(
        money({
          read: false,
          error: "permission denied for view cockpit_wins_v",
        }),
      ),
    ).toEqual([]);
    expect(winsValues(money(undefined))).toEqual([]);
    expect(
      extract("money", { rails: null }).filter(
        v =>
          v.metric.startsWith("clients.wins") ||
          v.metric.startsWith("money.upsells"),
      ),
    ).toEqual([]);
  });

  test("the goal actuals over a window", () => {
    expect(winGoalActuals(ROWS, "2026-11-01", "2026-11-30")).toEqual({
      googleReviews: 1,
      referrals: 1,
      testimonials: 1,
      upsellsOffered: 2,
      upsellsAccepted: 2,
      upsells: 4,
      upsellCash: 3000,
      upsellRate: 1,
    });
  });

  test("both registries define each wins metric once, with its source and what it leaves out, and extract the same", async () => {
    const convex = await import(
      "../../apps/media-buyer-cockpit/convex/ceo/metricRegistry"
    );
    const names = [
      "clients.wins.reviews",
      "clients.wins.testimonials",
      "clients.wins.podcasts",
      "clients.wins.referrals",
      "clients.wins.renewals",
      "clients.wins.reactivations",
      "money.upsells.offered",
      "money.upsells.accepted",
      "money.upsells.cash",
      "money.upsells.rate",
    ];
    for (const metric of names)
      for (const defs of [DEFINITIONS, convex.DEFINITIONS]) {
        const hits = defs.filter(
          (d: { metric: string }) => d.metric === metric,
        );
        expect(hits).toHaveLength(1);
        expect(hits[0].source).toContain("cockpit_wins_v");
        expect((hits[0].leavesOut ?? "").length).toBeGreaterThan(10);
      }
    const pick = (vs: { metric: string }[]) =>
      vs.filter(v => names.includes(v.metric));
    expect(pick(convex.extract("money", money(block)))).toEqual(
      pick(extract("money", money(block))),
    );
    expect(pick(extract("money", money(block)))).toHaveLength(names.length * 2);
  });
});

describe("readWins", () => {
  test("reads the view and the missed upsells through the read path, canary left out", async () => {
    const seen: string[] = [];
    const read = async (_project: string, query: string) => {
      seen.push(query);
      if (query === WINS_SQL.wins)
        return [
          {
            id: "w1",
            task_id: "taskA1",
            client_name: "Client A Example",
            kind: "upsell_smm",
            stage: "paid",
            won_on: "2026-11-02",
            offered_on: "2026-11-02",
            accepted_on: "2026-11-03",
            quoted_usd: "900.00",
            recurring: true,
            monthly_usd: "900",
            ties: [
              {
                paymentId: "whop:pay_x",
                rail: "whop",
                usd: 900,
                paidOn: "2026-11-04",
                checked: true,
              },
            ],
          },
        ];
      if (query === WINS_SQL.missed)
        return [
          {
            why_kind: "voided",
            client_name: "Client B Example",
            what: "upsell_website",
            why: "Chose a cheaper agency",
            day: "2026-11-10",
          },
        ];
      throw new Error("unexpected query");
    };
    const out = await readWins(read, TODAY);
    expect(seen).toEqual([WINS_SQL.wins, WINS_SQL.missed]);
    expect(WINS_SQL.wins).toContain("source <> 'canary'");
    expect(out).toEqual({
      read: true,
      today: TODAY,
      rows: [
        {
          id: "w1",
          taskId: "taskA1",
          client: "Client A Example",
          kind: "upsell_smm",
          stage: "paid",
          wonOn: "2026-11-02",
          offeredOn: "2026-11-02",
          acceptedOn: "2026-11-03",
          quotedUsd: 900,
          recurring: true,
          monthlyUsd: 900,
          ties: [{ paidOn: "2026-11-04", usd: 900, checked: true }],
        },
      ],
      missed: [
        {
          kind: "voided",
          client: "Client B Example",
          what: "upsell_website",
          why: "Chose a cheaper agency",
          day: "2026-11-10",
        },
      ],
    });
    // The payer never travels with a tie.
    expect(JSON.stringify(out)).not.toContain("whop:pay_x");
  });

  test("a failed read is said, not zero", async () => {
    const out = await readWins(async () => {
      throw new Error('relation "public.cockpit_wins_v" does not exist');
    }, TODAY);
    expect(out).toEqual({
      read: false,
      error: 'relation "public.cockpit_wins_v" does not exist',
    });
  });
});
