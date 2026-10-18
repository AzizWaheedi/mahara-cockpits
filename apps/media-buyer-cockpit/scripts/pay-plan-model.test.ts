/**
 * Pay plans, the browser's half of the rule (src/types/ceo/payPlan.ts) against
 * the server's (supabase/migrations/20261018a_ceo_pay_plans.sql), PAY-PLANS.md
 * sections 3 and 9: one shared table of plans goes through checkPlan and
 * cockpit_pay_plan_check, and the shared band vectors through pickBand and
 * cockpit_pay_band_pick, in PGlite with only the functions they need loaded
 * from the migration. Then the plan in words, the metric switch, which plan a
 * person follows, and the seeds, checked against the contract's own JSON.
 * Every plan, person and figure here is made up.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PAY_RPCS, payRpc } from "../src/dev/payFixture";
import {
  tiedSentence,
  tiePayload,
  tiePayment,
  untiePayment,
} from "../src/lib/ceoMoneyClient";
import {
  approvePayMonth,
  confirmPay,
  payNoneRest,
  readPayCosts,
  readPayMonth,
  readPayPlans,
  savePayEntry,
  savePayPlan,
  withdrawPayMonth,
} from "../src/lib/ceoPayClient";
import { basisOf, peopleRoster } from "../src/lib/ceoPeopleModel";
import {
  COMMISSION_BASES,
  commissionLines,
  unknownBasis,
} from "../src/types/ceo/commission";
import {
  type Band,
  bandRanges,
  checkPlan,
  commissionMatches,
  MEASURED_BASES,
  type PayPlanRow,
  type Plan,
  partSentence,
  partSummary,
  pickBand,
  planFor,
  planSentence,
  ROLE_PLANS_2026_10,
  roundDecimal,
  suggestBands,
} from "../src/types/ceo/payPlan";
import { migration as cockpitMigration } from "./lib/cockpitTestDb";
import {
  actor,
  CEO,
  call as callAs,
  hoursTestDb,
  MEMBER,
  owner,
} from "./lib/hoursTestDb";

const root = new URL("../../../", import.meta.url);
const migration = readFileSync(
  new URL("supabase/migrations/20261018a_ceo_pay_plans.sql", root),
  "utf8",
);
/** One CREATE OR REPLACE FUNCTION block of the migration, as written. */
function fn(name: string): string {
  const hit = migration.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    ),
  );
  if (!hit) throw new Error(`The migration has no ${name}`);
  return hit[0];
}

let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  for (const name of [
    "cockpit_pay_num",
    "cockpit_pay_plan_check",
    "cockpit_pay_band_pick",
  ])
    await db.exec(fn(name));
});
afterAll(async () => {
  await db.close();
});

async function sqlCheck(
  plan: unknown,
  isRole: boolean,
): Promise<string | null> {
  const r = await db.query<{ r: string | null }>(
    "SELECT public.cockpit_pay_plan_check($1::jsonb, $2::boolean) AS r",
    [JSON.stringify(plan), isRole],
  );
  return r.rows[0].r;
}
async function sqlPick(
  bands: readonly Band[],
  value: string,
): Promise<{ index: number; amount: number | null } | null> {
  const r = await db.query<{
    r: { index: number; amount: number | null } | null;
  }>("SELECT public.cockpit_pay_band_pick($1::jsonb, $2::numeric) AS r", [
    JSON.stringify(bands),
    value,
  ]);
  return r.rows[0].r;
}
async function sqlRound(value: string): Promise<string> {
  const r = await db.query<{ r: string }>(
    "SELECT round($1::numeric, 2)::text AS r",
    [value],
  );
  return r.rows[0].r;
}

// ---------------------------------------------------------------------------
// The shared table

const SEEDS = ROLE_PLANS_2026_10 as Record<string, Plan>;
const MB = SEEDS["Media buyer"];
const STRAT = SEEDS["Creative strategist"];
const CSM = SEEDS["Client success manager"];
const mbBand = MB.parts[0] as Extract<Plan["parts"][number], { kind: "band" }>;
const band = (over: Record<string, unknown> = {}) => ({
  key: "bonus",
  kind: "band",
  label: "Made-up bonus",
  metric: "cpl",
  bands: [
    { upTo: 10, inclusive: false, amount: 200 },
    { upTo: null, amount: 0 },
  ],
  ...over,
});
const share = (over: Record<string, unknown> = {}) => ({
  key: "cut",
  kind: "share",
  label: "Made-up share",
  of: "upsell_cash",
  steps: [{ fromMonth: 1, rate: 0.1 }],
  ...over,
});
const event = (over: Record<string, unknown> = {}) => ({
  key: "count",
  kind: "per_event",
  label: "Made-up count",
  event: "referral",
  amount: 100,
  ...over,
});
const floor = (over: Record<string, unknown> = {}) => ({
  key: "floor",
  kind: "floor",
  label: "Made-up floor",
  amount: 1000,
  days: 30,
  ...over,
});
const plan = (...parts: unknown[]) => ({ version: 1, parts });
const role = (commission: unknown, ...parts: unknown[]) => ({
  version: 1,
  parts,
  commission,
});

type Row = {
  name: string;
  plan: unknown;
  isRole?: boolean;
  says: string | null;
};
const TABLE: Row[] = [
  // The seeds, as role plans; a person plan cannot carry commission lines.
  ...Object.entries(SEEDS).map(([r, p]) => ({
    name: `seed: ${r}`,
    plan: p,
    isRole: true,
    says: null,
  })),
  ...Object.entries(SEEDS).map(([r, p]) => ({
    name: `seed as a person's plan: ${r}`,
    plan: p,
    isRole: false,
    says: p.commission
      ? "Only a role plan carries commission lines; set a person's lines on the roster."
      : null,
  })),
  { name: "an empty plan", plan: plan(), says: null },
  // The plan
  {
    name: "not an object",
    plan: [1],
    says: "A pay plan is an object with a version and a list of parts.",
  },
  {
    name: "null",
    plan: null,
    says: "A pay plan is an object with a version and a list of parts.",
  },
  {
    name: "unknown plan key",
    plan: { version: 1, parts: [], extra: 1 },
    says: 'Unknown field "extra" in the plan.',
  },
  {
    name: "two unknown keys: the shorter first",
    plan: { version: 1, parts: [], zz: 1, a: 1 },
    says: 'Unknown field "a" in the plan.',
  },
  {
    name: "two unknown keys of one length: byte order",
    plan: { version: 1, parts: [], bb: 1, aa: 1 },
    says: 'Unknown field "aa" in the plan.',
  },
  {
    name: "version 2",
    plan: { version: 2, parts: [] },
    says: "The plan's version must be 1.",
  },
  {
    name: "version as text",
    plan: { version: "1", parts: [] },
    says: "The plan's version must be 1.",
  },
  {
    name: "no version",
    plan: { parts: [] },
    says: "The plan's version must be 1.",
  },
  {
    name: "no parts",
    plan: { version: 1 },
    says: "The plan needs a list of parts (it may be empty).",
  },
  {
    name: "parts not a list",
    plan: { version: 1, parts: {} },
    says: "The plan needs a list of parts (it may be empty).",
  },
  {
    name: "21 parts",
    plan: plan(
      ...Array.from({ length: 21 }, (_, i) => event({ key: `p${i}` })),
    ),
    says: "A plan has at most 20 parts.",
  },
  // Every part
  {
    name: "a part that is not an object",
    plan: plan(1),
    says: "Part 1 is not an object.",
  },
  {
    name: "a key with a capital",
    plan: plan(event({ key: "Count" })),
    says: "Part 1 needs a key: a lowercase letter, then letters, digits or _ (up to 40).",
  },
  {
    name: "a key of 41",
    plan: plan(event({ key: `a${"b".repeat(40)}` })),
    says: "Part 1 needs a key: a lowercase letter, then letters, digits or _ (up to 40).",
  },
  {
    name: "no key",
    plan: plan(event({ key: undefined })),
    says: "Part 1 needs a key: a lowercase letter, then letters, digits or _ (up to 40).",
  },
  {
    name: "a key ending in a newline",
    plan: plan(event({ key: "count\n" })),
    says: "Part 1 needs a key: a lowercase letter, then letters, digits or _ (up to 40).",
  },
  {
    name: "the adjustment key",
    plan: plan(event({ key: "adjustment" })),
    says: 'The key "adjustment" is kept for adjustments.',
  },
  {
    name: "two parts, one key",
    plan: plan(event(), share({ key: "count" })),
    says: 'Two parts share the key "count".',
  },
  {
    name: "an unknown kind",
    plan: plan(event({ kind: "tier" })),
    says: 'Part "count" has an unknown kind.',
  },
  {
    name: "an unknown part field",
    plan: plan(band({ bandz: [] })),
    says: 'Unknown field "bandz" in part "bonus".',
  },
  {
    name: "a field of another kind",
    plan: plan(event({ steps: [] })),
    says: 'Unknown field "steps" in part "count".',
  },
  {
    name: "no label",
    plan: plan(event({ label: undefined })),
    says: 'Part "count" needs a label of 1 to 80 characters.',
  },
  {
    name: "a label of spaces",
    plan: plan(event({ label: "   " })),
    says: 'Part "count" needs a label of 1 to 80 characters.',
  },
  {
    name: "a label of 81",
    plan: plan(event({ label: "x".repeat(81) })),
    says: 'Part "count" needs a label of 1 to 80 characters.',
  },
  {
    name: "80 characters outside ASCII",
    plan: plan(event({ label: "😀".repeat(80) })),
    says: null,
  },
  {
    name: "81 characters outside ASCII",
    plan: plan(event({ label: "é".repeat(81) })),
    says: 'Part "count" needs a label of 1 to 80 characters.',
  },
  {
    name: "a tab is not trimmed",
    plan: plan(event({ label: "\t" })),
    says: null,
  },
  // Band
  {
    name: "an unknown metric",
    plan: plan(band({ metric: "cpm" })),
    says: 'Part "bonus" pays on an unknown metric.',
  },
  {
    name: "covers on churn",
    plan: plan(band({ metric: "csm_churn", covers: "all_clients" })),
    says: 'Part "bonus": only cost per lead or cost per booking covers clients.',
  },
  {
    name: "covers something else",
    plan: plan(band({ covers: "some_clients" })),
    says: 'Part "bonus" covers all_clients or owned_creative.',
  },
  {
    name: "covers null",
    plan: plan(band({ covers: null })),
    says: 'Part "bonus" covers all_clients or owned_creative.',
  },
  {
    name: "a guard on churn",
    plan: plan(band({ metric: "logo_churn_prior", guard: {} })),
    says: 'Part "bonus": only cost per lead or cost per booking has a guard.',
  },
  {
    name: "a guard that is a list",
    plan: plan(band({ guard: [] })),
    says: 'The guard of part "bonus" is an object.',
  },
  {
    name: "an unknown guard field",
    plan: plan(band({ guard: { minLeads: 5 } })),
    says: 'Unknown field "minLeads" in the guard of part "bonus".',
  },
  {
    name: "minClients 0",
    plan: plan(band({ guard: { minClients: 0 } })),
    says: 'The guard of part "bonus" needs minClients from 1 to 100.',
  },
  {
    name: "minClients 2.5",
    plan: plan(band({ guard: { minClients: 2.5 } })),
    says: 'The guard of part "bonus" needs minClients from 1 to 100.',
  },
  {
    name: "minClients null",
    plan: plan(band({ guard: { minClients: null } })),
    says: 'The guard of part "bonus" needs minClients from 1 to 100.',
  },
  {
    name: "minSpendUsd below 0",
    plan: plan(band({ guard: { minSpendUsd: -1 } })),
    says: 'The guard of part "bonus" needs minSpendUsd from 0 to 100,000.',
  },
  {
    name: "excludeDays 91",
    plan: plan(band({ guard: { excludeDays: 91 } })),
    says: 'The guard of part "bonus" needs excludeDays from 0 to 90.',
  },
  {
    name: "a full guard",
    plan: plan(
      band({
        covers: "owned_creative",
        guard: { minClients: 5, minSpendUsd: 499.5, excludeDays: 0 },
      }),
    ),
    says: null,
  },
  {
    name: "one band",
    plan: plan(band({ bands: [{ upTo: null, amount: 0 }] })),
    says: 'Part "bonus" needs 2 to 10 bands.',
  },
  {
    name: "11 bands",
    plan: plan(
      band({
        bands: [
          ...Array.from({ length: 10 }, (_, i) => ({
            upTo: i + 1,
            inclusive: false,
            amount: 1,
          })),
          { upTo: null, amount: 0 },
        ],
      }),
    ),
    says: 'Part "bonus" needs 2 to 10 bands.',
  },
  {
    name: "a band that is not an object",
    plan: plan(band({ bands: [5, { upTo: null, amount: 0 }] })),
    says: 'Band 1 of part "bonus" is not an object.',
  },
  {
    name: "an unknown band field",
    plan: plan(
      band({
        bands: [
          { upTo: 5, inclusive: true, amount: 1, from: 0 },
          { upTo: null, amount: 0 },
        ],
      }),
    ),
    says: 'Unknown field "from" in band 1 of part "bonus".',
  },
  {
    name: "a band with no amount",
    plan: plan(
      band({
        bands: [
          { upTo: 5, inclusive: true },
          { upTo: null, amount: 0 },
        ],
      }),
    ),
    says: 'Band 1 of part "bonus" needs an amount between -100,000 and 100,000.',
  },
  {
    name: "a band over 100,000",
    plan: plan(
      band({
        bands: [
          { upTo: 5, inclusive: true, amount: 1 },
          { upTo: null, amount: -100001 },
        ],
      }),
    ),
    says: 'Band 2 of part "bonus" needs an amount between -100,000 and 100,000.',
  },
  {
    name: "an open band before the last",
    plan: plan(
      band({
        bands: [
          { upTo: null, inclusive: true, amount: 1 },
          { upTo: null, amount: 0 },
        ],
      }),
    ),
    says: 'Band 1 of part "bonus" needs a number upTo; only the last band runs on.',
  },
  {
    name: "a missing inclusive",
    plan: plan(
      band({
        bands: [
          { upTo: 5, amount: 1 },
          { upTo: null, amount: 0 },
        ],
      }),
    ),
    says: 'Band 1 of part "bonus" needs inclusive: true or false.',
  },
  {
    name: "inclusive as text",
    plan: plan(
      band({
        bands: [
          { upTo: 5, inclusive: "true", amount: 1 },
          { upTo: null, amount: 0 },
        ],
      }),
    ),
    says: 'Band 1 of part "bonus" needs inclusive: true or false.',
  },
  {
    name: "a churn edge over 100",
    plan: plan(
      band({
        metric: "csm_churn",
        bands: [
          { upTo: 101, inclusive: true, amount: 1 },
          { upTo: null, amount: 0 },
        ],
      }),
    ),
    says: 'Band edges of part "bonus" are percents from 0 to 100.',
  },
  {
    name: "a churn edge at 0",
    plan: plan(
      band({
        metric: "csm_churn",
        bands: [
          { upTo: 0, inclusive: true, amount: 1 },
          { upTo: null, amount: 0 },
        ],
      }),
    ),
    says: null,
  },
  {
    name: "a money edge at 0",
    plan: plan(
      band({
        bands: [
          { upTo: 0, inclusive: true, amount: 1 },
          { upTo: null, amount: 0 },
        ],
      }),
    ),
    says: 'Band edges of part "bonus" are amounts above 0.',
  },
  {
    name: "edges that do not rise",
    plan: plan(
      band({
        bands: [
          { upTo: 10, inclusive: false, amount: 2 },
          { upTo: 10, inclusive: true, amount: 1 },
          { upTo: null, amount: 0 },
        ],
      }),
    ),
    says: 'The bands of part "bonus" must rise.',
  },
  {
    name: "a last band with no upTo",
    plan: plan(
      band({
        bands: [{ upTo: 10, inclusive: false, amount: 2 }, { amount: 0 }],
      }),
    ),
    says: 'The last band of part "bonus" runs on: upTo null.',
  },
  {
    name: "a last band with an edge",
    plan: plan(
      band({
        bands: [
          { upTo: 10, inclusive: false, amount: 2 },
          { upTo: 20, inclusive: true, amount: 0 },
        ],
      }),
    ),
    says: 'The last band of part "bonus" runs on: upTo null.',
  },
  {
    name: "a last band with inclusive as text",
    plan: plan(
      band({
        bands: [
          { upTo: 10, inclusive: false, amount: 2 },
          { upTo: null, inclusive: "no", amount: 0 },
        ],
      }),
    ),
    says: 'Band 2 of part "bonus" needs inclusive: true or false.',
  },
  {
    name: "a negative band",
    plan: plan(
      band({
        bands: [
          { upTo: 10, inclusive: false, amount: 2 },
          { upTo: null, amount: -250 },
        ],
      }),
    ),
    says: null,
  },
  {
    name: "two bonuses on every client's CPL",
    plan: plan(band(), band({ key: "bonus2", covers: "all_clients" })),
    says: "Two parts pay on the same measure (cpl:all_clients).",
  },
  {
    name: "every client's and owned creative's CPL",
    plan: plan(band(), band({ key: "bonus2", covers: "owned_creative" })),
    says: null,
  },
  {
    name: "two churn bonuses",
    plan: plan(
      band({ metric: "csm_churn" }),
      band({ key: "bonus2", metric: "csm_churn" }),
    ),
    says: "Two parts pay on the same measure (csm_churn).",
  },
  // Per event
  {
    name: "an unknown event",
    plan: plan(event({ event: "lunch" })),
    says: 'Part "count" has an unknown event.',
  },
  {
    name: "a negative amount per event",
    plan: plan(event({ amount: -1 })),
    says: 'Part "count" needs an amount from 0 to 100,000.',
  },
  {
    name: "an amount as text",
    plan: plan(event({ amount: "100" })),
    says: 'Part "count" needs an amount from 0 to 100,000.',
  },
  {
    name: "a custom event with no name",
    plan: plan(event({ event: "custom" })),
    says: 'Part "count" needs an event label of 1 to 80 characters.',
  },
  {
    name: "a custom event",
    plan: plan(event({ event: "custom", eventLabel: "Made-up thing" })),
    says: null,
  },
  {
    name: "a name on a known event",
    plan: plan(event({ eventLabel: "Referral" })),
    says: 'Part "count": only a custom event has a label.',
  },
  {
    name: "two paid-in-full bonuses",
    plan: plan(
      event({ event: "pif_deal_closed" }),
      event({ key: "count2", event: "pif_deal_closed" }),
    ),
    says: "The paid-in-full bonus can be in a plan once.",
  },
  // Share
  {
    name: "a share of an unknown amount",
    plan: plan(share({ of: "profit" })),
    says: 'Part "cut" is a share of an unknown amount.',
  },
  {
    name: "no steps",
    plan: plan(share({ steps: [] })),
    says: 'Part "cut" needs 1 to 6 steps.',
  },
  {
    name: "7 steps",
    plan: plan(
      share({
        steps: Array.from({ length: 7 }, (_, i) => ({
          fromMonth: i + 1,
          rate: 0.1,
        })),
      }),
    ),
    says: 'Part "cut" needs 1 to 6 steps.',
  },
  {
    name: "a step that is not an object",
    plan: plan(share({ steps: [0.1] })),
    says: 'Step 1 of part "cut" is not an object.',
  },
  {
    name: "an unknown step field",
    plan: plan(share({ steps: [{ fromMonth: 1, rate: 0.1, toMonth: 6 }] })),
    says: 'Unknown field "toMonth" in step 1 of part "cut".',
  },
  {
    name: "a step from month 0",
    plan: plan(share({ steps: [{ fromMonth: 0, rate: 0.1 }] })),
    says: 'Step 1 of part "cut" needs fromMonth, a month number from 1.',
  },
  {
    name: "a step from month 1.5",
    plan: plan(share({ steps: [{ fromMonth: 1.5, rate: 0.1 }] })),
    says: 'Step 1 of part "cut" needs fromMonth, a month number from 1.',
  },
  {
    name: "a first step from month 2",
    plan: plan(share({ steps: [{ fromMonth: 2, rate: 0.1 }] })),
    says: 'The first step of part "cut" starts in month 1.',
  },
  {
    name: "steps that do not rise",
    plan: plan(
      share({
        steps: [
          { fromMonth: 1, rate: 0.2 },
          { fromMonth: 1, rate: 0.1 },
        ],
      }),
    ),
    says: 'The steps of part "cut" must start in later months.',
  },
  {
    name: "a rate over 1",
    plan: plan(share({ steps: [{ fromMonth: 1, rate: 10 }] })),
    says: 'Step 1 of part "cut" needs a rate from 0 to 1.',
  },
  {
    name: "ends that are a list",
    plan: plan(share({ ends: [] })),
    says: 'The ends of part "cut" are an object.',
  },
  {
    name: "an unknown ends field",
    plan: plan(share({ ends: { onCancel: true, onPause: true } })),
    says: 'Unknown field "onPause" in the ends of part "cut".',
  },
  {
    name: "ends with no onCancel",
    plan: plan(share({ ends: { lapseDays: 30 } })),
    says: 'The ends of part "cut" need onCancel: true or false.',
  },
  {
    name: "lapseDays 0",
    plan: plan(share({ ends: { onCancel: false, lapseDays: 0 } })),
    says: 'Part "cut" needs lapseDays from 1 to 365.',
  },
  {
    name: "prorateOnCancel as text",
    plan: plan(share({ prorateOnCancel: "yes" })),
    says: 'Part "cut" needs prorateOnCancel: true or false.',
  },
  // Per client over a line, and the floor
  {
    name: "an unknown measure",
    plan: plan({
      key: "over",
      kind: "per_above",
      label: "Over",
      measure: "clients",
      over: 20,
      amount: 50,
    }),
    says: 'Part "over" counts an unknown measure.',
  },
  {
    name: "over 1,001",
    plan: plan({
      key: "over",
      kind: "per_above",
      label: "Over",
      measure: "qualifying_clients",
      over: 1001,
      amount: 50,
    }),
    says: 'Part "over" needs over from 0 to 1,000.',
  },
  {
    name: "over 2.5",
    plan: plan({
      key: "over",
      kind: "per_above",
      label: "Over",
      measure: "qualifying_clients",
      over: 2.5,
      amount: 50,
    }),
    says: 'Part "over" needs over from 0 to 1,000.',
  },
  {
    name: "a negative amount over the line",
    plan: plan({
      key: "over",
      kind: "per_above",
      label: "Over",
      measure: "qualifying_clients",
      over: 20,
      amount: -5,
    }),
    says: 'Part "over" needs an amount from 0 to 100,000.',
  },
  {
    name: "a floor of 0",
    plan: plan(floor({ amount: 0 })),
    says: 'Part "floor" needs an amount above 0 and up to 100,000.',
  },
  {
    name: "a floor of 0 days",
    plan: plan(floor({ days: 0 })),
    says: 'Part "floor" needs days from 1 to 366.',
  },
  {
    name: "a floor of 367 days",
    plan: plan(floor({ days: 367 })),
    says: 'Part "floor" needs days from 1 to 366.',
  },
  {
    name: "two floors",
    plan: plan(floor(), floor({ key: "floor2" })),
    says: "A plan has at most one floor.",
  },
  // Commission lines
  {
    name: "commission not a list",
    plan: role({}),
    isRole: true,
    says: "A role plan has at most 2 commission lines.",
  },
  {
    name: "commission null",
    plan: role(null),
    isRole: true,
    says: "A role plan has at most 2 commission lines.",
  },
  {
    name: "three lines",
    plan: role([
      { basis: "per_signed", rate: 1 },
      { basis: "per_demo_shown", rate: 1 },
      { basis: "per_intro_shown", rate: 1 },
    ]),
    isRole: true,
    says: "A role plan has at most 2 commission lines.",
  },
  {
    name: "a line that is not an object",
    plan: role(["per_signed"]),
    isRole: true,
    says: "Commission line 1 is not an object.",
  },
  {
    name: "an unknown line field",
    plan: role([{ basis: "per_signed", rate: 1, note: "x" }]),
    isRole: true,
    says: 'Unknown field "note" in commission line 1.',
  },
  {
    name: "a line of none",
    plan: role([{ basis: "none", rate: 0 }]),
    isRole: true,
    says: "Commission line 1 has an unknown basis.",
  },
  {
    name: "a line of other",
    plan: role([{ basis: "other", rate: 0 }]),
    isRole: true,
    says: "Commission line 1 has an unknown basis.",
  },
  {
    name: "a line of an unknown basis",
    plan: role([{ basis: "per_lunch", rate: 1 }]),
    isRole: true,
    says: "Commission line 1 has an unknown basis.",
  },
  {
    name: "a share over 1",
    plan: role([{ basis: "closed_cash", rate: 10 }]),
    isRole: true,
    says: "Commission line 1 needs a rate from 0 to 1.",
  },
  {
    name: "a negative amount per unit",
    plan: role([{ basis: "per_client_appt_shown", rate: -1 }]),
    isRole: true,
    says: "Commission line 1 needs a rate from 0 to 100,000.",
  },
  {
    name: "a line with no rate",
    plan: role([{ basis: "per_signed" }]),
    isRole: true,
    says: "Commission line 1 needs a rate from 0 to 100,000.",
  },
  {
    name: "one basis twice",
    plan: role([
      { basis: "per_signed", rate: 1 },
      { basis: "per_signed", rate: 2 },
    ]),
    isRole: true,
    says: "The two commission lines need different bases.",
  },
  {
    name: "the first fault wins: parts before lines",
    plan: role([{ basis: "per_lunch", rate: 1 }], event({ amount: -1 })),
    isRole: true,
    says: 'Part "count" needs an amount from 0 to 100,000.',
  },
  // Every basis but none and other may be a role plan's line.
  ...COMMISSION_BASES.filter(b => b !== "none" && b !== "other").map(b => ({
    name: `a role line of ${b}`,
    plan: role([{ basis: b, rate: 0.1 }]),
    isRole: true,
    says: null,
  })),
];

describe("the plan check: the browser and the server say the same", () => {
  for (const row of TABLE)
    test(row.name, async () => {
      const isRole = row.isRole ?? false;
      expect(checkPlan(row.plan, { isRole })).toBe(row.says);
      // What the server reads is the JSON the browser sends.
      expect(await sqlCheck(row.plan, isRole)).toBe(row.says);
    });
});

// ---------------------------------------------------------------------------
// The band pick

const VECTORS = [
  "12.45",
  "15.00",
  "15.40",
  "4.55",
  "15.01",
  "0",
  "9.995",
  "12.995",
  "14.995",
  "4.995",
];
const BANDS: Record<string, Band[]> = {
  "media buyer, cost per lead": mbBand.bands,
  "strategist, churn": (STRAT.parts[0] as { bands: Band[] }).bands,
  "strategist, cost per lead": (STRAT.parts[1] as { bands: Band[] }).bands,
  "client success, retention": (CSM.parts[2] as { bands: Band[] }).bands,
};

describe("the band pick: the browser and the server pick the same band", () => {
  for (const [name, bands] of Object.entries(BANDS))
    test(name, async () => {
      for (const v of VECTORS) {
        const server = await sqlPick(bands, v);
        // An unsaved draft: a decimal string, rounded as the server rounds.
        expect({ v, pick: pickBand(bands, v) }).toEqual({ v, pick: server });
        // The server's own value: already rounded, never rounded again.
        const rounded = Number(await sqlRound(v));
        expect({ v, pick: pickBand(bands, rounded) }).toEqual({
          v,
          pick: server,
        });
      }
    });

  test("the contract's readings (decision 4)", () => {
    const mb = mbBand.bands;
    expect(pickBand(mb, 12.45)).toEqual({ index: 2, amount: 200 });
    expect(pickBand(mb, 15)).toEqual({ index: 3, amount: 100 });
    // The top paid band ends at the number given: $15.40 pays nothing.
    expect(pickBand(mb, 15.4)).toEqual({ index: 4, amount: 0 });
    expect(pickBand(BANDS["strategist, churn"], "12.5")).toEqual({
      index: 4,
      amount: 0,
    });
    // 1 of 22 is 4.55%: the CSM's $1,500.
    expect(pickBand(BANDS["client success, retention"], 4.55)).toEqual({
      index: 1,
      amount: 1500,
    });
    expect(pickBand(BANDS["client success, retention"], 0)).toEqual({
      index: 0,
      amount: 2000,
    });
    expect(pickBand(BANDS["client success, retention"], "15.01")).toEqual({
      index: 6,
      amount: -250,
    });
  });

  test("a draft rounds half away from zero; a server value is never rounded again", () => {
    // 9.995 is 10.00 to the server: the $200 band, not $300.
    expect(pickBand(mbBand.bands, "9.995")).toEqual({ index: 2, amount: 200 });
    expect(pickBand(mbBand.bands, 9.995)).toEqual({ index: 1, amount: 300 });
    expect(roundDecimal("9.995")).toBe("10.00");
    expect(roundDecimal("-4.995")).toBe("-5.00");
    expect(roundDecimal("12.45")).toBe("12.45");
    expect(roundDecimal("0")).toBe("0.00");
    expect(roundDecimal(".5")).toBe("0.50");
    expect(roundDecimal("-0.001")).toBe("0.00");
    expect(roundDecimal(" 7 ")).toBe("7.00");
    expect(roundDecimal("12.345", 1)).toBe("12.3");
    expect(roundDecimal("abc")).toBeNull();
    expect(roundDecimal("")).toBeNull();
    expect(roundDecimal("1e3")).toBeNull();
  });

  test("no value, no band", async () => {
    expect(pickBand(mbBand.bands, null)).toBeNull();
    expect(pickBand(mbBand.bands, "n/a")).toBeNull();
    expect(pickBand(mbBand.bands, Number.NaN)).toBeNull();
    expect(pickBand([], 5)).toBeNull();
    const r = await db.query<{ r: unknown }>(
      "SELECT public.cockpit_pay_band_pick($1::jsonb, NULL) AS r",
      [JSON.stringify(mbBand.bands)],
    );
    expect(r.rows[0].r).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// In words

describe("the plan in words", () => {
  test("a summary line for a row or a card", () => {
    expect(planSentence(MB)).toBe("bonus by cost per lead, up to $400");
    expect(planSentence(SEEDS["Call centre agent"])).toBe(
      "$5 per client appointment that shows up + $20 per deal our client closes (confirmed)",
    );
    expect(planSentence(SEEDS.Closer)).toBe(
      "10% of cash collected on deals they close + 5% of cash collected on deals they set + paid-in-full bonus, $250 each",
    );
    expect(planSentence(SEEDS["Systems manager"])).toBe(
      "fully built-out systems, $200 each + huge built-out systems, $400 each",
    );
    expect(planSentence(STRAT)).toBe(
      "bonus by last month's churn, up to $1,200 + bonus by cost per lead, up to $300 + social media management commission, 0% then 10% then 5%",
    );
    expect(planSentence(CSM)).toContain(
      "retention bonus by churn, up to $2,000 (or −$250)",
    );
    expect(planSentence(CSM)).toContain(
      "ramp guarantee, at least $1,200 a month for 60 days",
    );
    expect(planSentence(null)).toBe("base only");
    expect(planSentence({ version: 1, parts: [] })).toBe("base only");
  });

  test("each band in words, as the ruler reads it to a screen reader", () => {
    expect(partSentence(mbBand)).toBe(
      "Bonus by cost per lead: under $8 pays $400, $8 to under $10 pays $300, $10 to under $13 pays $200, $13 up to $15 pays $100, over $15 pays nothing.",
    );
    expect(partSentence(CSM.parts[2])).toBe(
      "Retention bonus by churn (churn of their clients): 0% pays $2,000, over 0% to under 5% pays $1,500, 5% to under 9% pays $1,000, 9% to under 11% pays $500, 11% to under 13% pays $250, 13% up to 15% pays nothing, over 15% pays −$250.",
    );
    expect(partSentence(STRAT.parts[1])).toBe(
      "Bonus by cost per lead: under $10 pays $300, $10 to under $13 pays $200, $13 to under $15 pays $100, $15 or more pays nothing. Counts only clients whose running creative they own. Needs 5 clients or more, each spending $500 or more in the month. The first 14 days after each creative start are left out.",
    );
    expect(
      bandRanges("cpb", [
        { upTo: 52.5, inclusive: true, amount: 1 },
        { upTo: null, amount: 0 },
      ]),
    ).toEqual(["up to $52.50", "over $52.50"]);
  });

  test("the other kinds in words", () => {
    const part = (plan: Plan, key: string) => {
      const p = plan.parts.find(x => x.key === key);
      if (!p) throw new Error(`no part ${key}`);
      return p;
    };
    expect(partSentence(part(STRAT, "smm"))).toBe(
      "Social media management commission: 0% in month 1, 10% from month 2, 5% from month 7 of social media management revenue by month of the engagement, typed by you each month. Ends when the client cancels. Pro-rated to a mid-month cancel.",
    );
    expect(partSentence(part(CSM, "recurring"))).toBe(
      "Recurring services: 20% in month 1, 5% from month 2 of recurring revenue by month of the engagement, typed by you each month. Ends when the client cancels or nothing is paid for 30 days.",
    );
    expect(partSentence(part(CSM, "upsells"))).toBe(
      "Backend upsells: 10% of upsell cash, typed by you each month.",
    );
    expect(partSentence(part(CSM, "ramp"))).toBe(
      "Ramp guarantee: at least $1,200 a month, base included, for the first 60 days from the contract start.",
    );
    expect(partSentence(part(CSM, "over_20"))).toBe(
      "Per qualifying client over 20: $50 for each qualifying client over 20.",
    );
    expect(partSentence(part(CSM, "renewals"))).toBe(
      "Renewals: $300 for each renewal, typed by you each month.",
    );
    expect(partSentence(part(SEEDS.Closer, "pif"))).toBe(
      "Paid-in-full bonus: $250 for each deal they closed that is paid in full, counted by the cockpit.",
    );
    expect(
      partSummary({
        key: "x",
        kind: "per_event",
        label: "Automation audits",
        event: "custom",
        eventLabel: "Automation audit",
        amount: 100,
      }),
    ).toBe("automation audits, $100 each");
  });
});

// ---------------------------------------------------------------------------
// The metric switch

describe("switching a bonus to cost per booking suggests the bands × 4", () => {
  test("cost per lead to cost per booking and back", () => {
    const cpb = suggestBands(mbBand.bands, "cpl", "cpb");
    expect(cpb).toEqual([
      { upTo: 32, inclusive: false, amount: 400 },
      { upTo: 40, inclusive: false, amount: 300 },
      { upTo: 52, inclusive: false, amount: 200 },
      { upTo: 60, inclusive: true, amount: 100 },
      { upTo: null, amount: 0 },
    ]);
    expect(suggestBands(cpb ?? [], "cpb", "cpl")).toEqual(mbBand.bands);
    // The suggestion is a plan the server takes.
    const switched = {
      version: 1,
      parts: [
        {
          ...mbBand,
          metric: "cpb",
          label: "Bonus by cost per booking",
          bands: cpb,
        },
      ],
    };
    expect(checkPlan(switched, { isRole: true })).toBeNull();
  });
  test("a copy on the same metric; nothing between money and churn", () => {
    const same = suggestBands(mbBand.bands, "cpl", "cpl");
    expect(same).toEqual(mbBand.bands);
    expect(same).not.toBe(mbBand.bands);
    expect(suggestBands(mbBand.bands, "cpl", "csm_churn")).toBeNull();
    expect(suggestBands(mbBand.bands, "logo_churn_prior", "cpb")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Which plan a person follows

describe("which plan a person follows", () => {
  const row = (
    o: Partial<PayPlanRow> & Pick<PayPlanRow, "id" | "fromMonth">,
  ): PayPlanRow => ({
    role: null,
    personId: null,
    plan: null,
    note: null,
    setBy: "ceo@example.test",
    setAt: "2026-10-01T00:00:00Z",
    ...o,
  });
  const rows = [
    row({ id: 1, role: "Media buyer", fromMonth: "2026-10-01", plan: MB }),
    row({
      id: 2,
      role: "media BUYER",
      fromMonth: "2026-12-01",
      plan: { version: 1, parts: [] },
    }),
    row({
      id: 3,
      role: "Systems manager",
      fromMonth: "2026-10-01",
      plan: SEEDS["Systems manager"],
    }),
    row({
      id: 4,
      personId: 7,
      fromMonth: "2026-10-01",
      plan: { version: 1, parts: [floor()] } as Plan,
    }),
    row({ id: 5, personId: 7, fromMonth: "2026-12-01", plan: null }),
  ];
  test("a role plan from its month, matched without case or spaces", () => {
    const buyer = { id: 3, role: " media buyer " };
    expect(planFor(rows, buyer, "2026-09").source).toBe("none");
    expect(planFor(rows, buyer, "2026-10")).toMatchObject({
      source: "role",
      planId: 1,
      follows: false,
    });
    expect(planFor(rows, buyer, "2026-11-01").planId).toBe(1);
    expect(planFor(rows, buyer, "2026-12")).toMatchObject({
      source: "role",
      planId: 2,
    });
  });
  test("an own plan, then back on the role plan", () => {
    const sys = { id: 7, role: "Systems manager" };
    expect(planFor(rows, sys, "2026-10")).toMatchObject({
      source: "own",
      planId: 4,
      follows: false,
    });
    expect(planFor(rows, sys, "2026-12")).toMatchObject({
      source: "role",
      planId: 3,
      follows: true,
    });
    expect(planFor(rows, { id: 7, role: null }, "2026-12")).toMatchObject({
      source: "none",
      follows: true,
    });
  });
  test("the role's commission against a person's lines", () => {
    const agent = SEEDS["Call centre agent"].commission;
    expect(
      commissionMatches(agent, [
        { basis: "per_client_deal_closed", rate: 20 },
        { basis: "per_client_appt_shown", rate: 5 },
      ]),
    ).toBe(true);
    expect(
      commissionMatches(agent, [
        { basis: "per_client_appt_shown", rate: 5 },
        { basis: "other", rate: null },
      ]),
    ).toBe(false);
    expect(
      commissionMatches(agent, [{ basis: "per_client_appt_shown", rate: 5 }]),
    ).toBe(false);
    expect(
      commissionMatches(undefined, [{ basis: "closed_cash", rate: 0.1 }]),
    ).toBe(true);
  });
  test("the lines a pay month works out itself", () => {
    expect([...MEASURED_BASES].sort()).toEqual([
      "closed_cash",
      "per_client_appt_shown",
      "per_client_deal_closed",
      "set_cash",
    ]);
  });
});

// ---------------------------------------------------------------------------
// The seeds

describe("the seeds are the contract's", () => {
  test("ROLE_PLANS_2026_10 is PAY-PLANS.md section 2, plan for plan", () => {
    const doc = readFileSync(new URL("docs/pay/PAY-PLANS.md", root), "utf8");
    const block = doc.match(
      /## 2\. Plans seeded[\s\S]*?```jsonc\n([\s\S]*?)```/,
    )?.[1];
    if (!block) throw new Error("No seed block in PAY-PLANS.md");
    const plans: Record<string, unknown> = {};
    for (const chunk of block.split(/^\/\/ /m).filter(c => c.trim())) {
      const nl = chunk.indexOf("\n");
      plans[chunk.slice(0, nl).trim()] = JSON.parse(chunk.slice(nl + 1));
    }
    expect(Object.keys(plans).sort()).toEqual(Object.keys(SEEDS).sort());
    for (const [r, p] of Object.entries(plans))
      expect({ r, p: SEEDS[r] }).toEqual({ r, p });
  });
  test("every seed passes both checks as a role plan", async () => {
    for (const p of Object.values(SEEDS)) {
      expect(checkPlan(p, { isRole: true })).toBeNull();
      expect(await sqlCheck(p, true)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// A basis the code does not know yet

describe("an unknown basis stays unknown", () => {
  test("never read as no commission", () => {
    expect(basisOf("per_client_appt_booked")).toEqual({
      basis: "other",
      unknown: "per_client_appt_booked",
    });
    expect(basisOf("per_client_appt_shown")).toEqual({
      basis: "per_client_appt_shown",
    });
    expect(basisOf(null)).toEqual({ basis: "none" });
    expect(basisOf("")).toEqual({ basis: "none" });
  });
  test("the roster keeps the raw value and says so", () => {
    const [p] = peopleRoster([
      {
        id: 1,
        name: "Agent One",
        active: true,
        monthly_cost: 650,
        currency: "USD",
        commission_basis: "per_client_appt_booked",
        commission_rate: "5",
        commission2_basis: "per_client_deal_closed",
        commission2_rate: "20",
      },
    ]).people;
    expect(p.commission).toEqual({
      basis: "other",
      rate: 5,
      unknown: "per_client_appt_booked",
    });
    expect(unknownBasis(p.commission)).toBe("per_client_appt_booked");
    expect(unknownBasis(p.commission2)).toBeNull();
    expect(commissionLines([p.commission, p.commission2], "USD", null)).toBe(
      "Unknown rule: per_client_appt_booked, plus USD 20 per deal our client closes (confirmed)",
    );
  });
});

// ---------------------------------------------------------------------------
// The browser's calls (ceoPayClient, ceoMoneyClient) and the harness fixtures

/** A client whose rpc runs the real functions in PGlite as the CEO, and records the names it was called with. */
function pgClient(pg: PGlite, as: string) {
  const names: string[] = [];
  const types: Record<string, string> = { p: "jsonb", p_month: "date" };
  const client = {
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      names.push(name);
      await actor(pg, as);
      const keys = Object.keys(args);
      const sql = `SELECT public.${name}(${keys.map((k, i) => `${k} => $${i + 1}::${types[k]}`).join(", ")}) AS r`;
      try {
        const r = await pg.query<{ r: unknown }>(
          sql,
          keys.map(k =>
            types[k] === "jsonb" ? JSON.stringify(args[k]) : args[k],
          ),
        );
        return { data: r.rows[0]?.r ?? null, error: null };
      } catch (e) {
        return { data: null, error: { message: (e as Error).message } };
      }
    },
  } as unknown as SupabaseClient;
  return { client, names };
}

describe("the browser reads and writes through the real functions", () => {
  const CEO_EMAIL = "ceo@example.test";
  let pg: PGlite;
  let ceo: ReturnType<typeof pgClient>;
  const ids: Record<string, number> = {};
  beforeAll(async () => {
    pg = await hoursTestDb();
    await owner(pg);
    const gate = cockpitMigration("20260923m_cockpit_ceo_gate.sql").replace(
      /IN \(\s*'[^']+',\s*'[^']+'\s*\)/,
      `IN ('${CEO_EMAIL}')`,
    );
    if (!gate.includes(CEO_EMAIL)) throw new Error("gate fixture not patched");
    await pg.exec(gate);
    await pg.query("UPDATE auth.users SET email=$1 WHERE id=$2", [
      CEO_EMAIL,
      CEO,
    ]);
    await pg.query(
      "UPDATE public.cockpit_members SET email=$1 WHERE auth_user_id=$2",
      [CEO_EMAIL, CEO],
    );
    await pg.exec(`CREATE OR REPLACE FUNCTION public.cockpit_hours_kw_today() RETURNS date LANGUAGE sql STABLE SET search_path='' AS
      $$ SELECT '2026-10-18'::date $$;`);
    await pg.exec(cockpitMigration("20261011d_ceo_commission_two_lines.sql"));
    await pg.exec(cockpitMigration("20261018a_ceo_pay_plans.sql"));
    // The facts of 20261018b, stubbed with made-up figures.
    await pg.exec(`
      CREATE FUNCTION public.cockpit_pay_facts_calls(p_from date, p_to date) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS
        $$ SELECT jsonb_build_object('agents', jsonb_build_array(jsonb_build_object('personId',
          (SELECT id FROM public.cockpit_people WHERE name='Agent One'), 'name','Agent One', 'shows', 9, 'unmarked', 0, 'closes', '[]'::jsonb)),
          'unattributed', '{"due":0,"shows":0,"items":[]}'::jsonb, 'scorecard', NULL) $$;
      CREATE FUNCTION public.cockpit_pay_facts_ads(p_from date, p_to date, p_exclude_days integer) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS
        $$ SELECT '{"clients":[{"clickupId":"cu-a","name":"Client A","spendUsd":900,"leadSpendUsd":800,"leads":64,"bookings":10,"notMeasured":{"cpl":null,"cpb":null}}],
          "pooled":{"clients":1,"leadSpendUsd":800,"nonLeadSpendUsd":100,"leads":64,"cpl":12.5,"spendUsd":900,"bookings":10,"cpb":90,"cpbClients":1,"outOfCpl":[],"outOfCpb":[]}}'::jsonb $$;
      CREATE FUNCTION public.cockpit_pay_facts_clients(p_month date) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS
        $$ SELECT '{"logo":{"startSet":[],"lost":[],"candidates":[],"notInStart":[],"proposal":null},"byCsm":[],"ownedCreative":[]}'::jsonb $$;
      CREATE FUNCTION public.cockpit_pay_facts_sales(p_from date, p_to date) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS
        $$ SELECT '{"deals":[],"people":[],"unkeyed":[]}'::jsonb $$;
      REVOKE ALL ON FUNCTION public.cockpit_pay_facts_calls(date,date), public.cockpit_pay_facts_ads(date,date,integer),
        public.cockpit_pay_facts_clients(date), public.cockpit_pay_facts_sales(date,date) FROM PUBLIC, anon, authenticated, service_role;`);
    await actor(pg, CEO);
    for (const [name, extra] of [
      [
        "Agent One",
        {
          role: "Call centre agent",
          monthlyCost: 650,
          email: "agent1@example.test",
          commissionBasis: "per_client_appt_shown",
          commissionRate: 5,
          commission2Basis: "per_client_deal_closed",
          commission2Rate: 20,
        },
      ],
      ["Buyer One", { role: "Media buyer", monthlyCost: 700 }],
      ["Systems One", { role: "Systems manager", monthlyCost: 1000 }],
    ] as const) {
      const r = await callAs(pg, "cockpit_ceo_people_save", {
        name,
        startedOn: "2026-01-01",
        currency: "USD",
        ...extra,
      });
      ids[name] = Number(r.id);
    }
    ceo = pgClient(pg, CEO);
  }, 120000);
  afterAll(async () => {
    await pg.close();
  });

  test("a plan is checked before the round trip, then saved; the list reads back", async () => {
    await expect(
      savePayPlan(ceo.client, {
        role: "Media buyer",
        fromMonth: "2026-10",
        plan: { version: 1, parts: [band({ bandz: [] })] },
      }),
    ).rejects.toThrow('Unknown field "bandz" in part "bonus".');
    expect(ceo.names).toEqual([]);
    for (const r of ["Media buyer", "Call centre agent"])
      expect(
        await savePayPlan(ceo.client, {
          role: r,
          fromMonth: "2026-10",
          plan: SEEDS[r],
        }),
      ).toMatchObject({ ok: true });
    // A screen may send the other scope as null: it is left out.
    const nulls = { role: null, personId: null } as unknown as Record<
      string,
      never
    >;
    expect(
      await savePayPlan(ceo.client, {
        ...nulls,
        role: "Systems manager",
        fromMonth: "2026-11",
        plan: SEEDS["Systems manager"],
      }),
    ).toMatchObject({ ok: true });
    await expect(
      savePayPlan(ceo.client, { ...nulls, fromMonth: "2026-11", plan: null }),
    ).rejects.toThrow("Choose a role or one person.");
    const own = await savePayPlan(ceo.client, {
      personId: ids["Systems One"],
      fromMonth: "2026-10-01",
      plan: SEEDS["Systems manager"],
      note: "Made-up own plan",
    });
    expect(own.id).toBeGreaterThan(0);
    // A person's plan never carries commission lines: refused here with the server's sentence.
    await expect(
      savePayPlan(ceo.client, {
        personId: ids["Buyer One"],
        fromMonth: "2026-10",
        plan: SEEDS["Call centre agent"],
      }),
    ).rejects.toThrow(
      "Only a role plan carries commission lines; set a person's lines on the roster.",
    );
    const list = await readPayPlans(ceo.client);
    expect(list.plans.map(p => [p.role, p.personId, p.fromMonth])).toEqual([
      [null, ids["Systems One"], "2026-10-01"],
      ["Call centre agent", null, "2026-10-01"],
      ["Media buyer", null, "2026-10-01"],
      ["Systems manager", null, "2026-11-01"],
    ]);
    expect(list.plans[2].plan).toEqual(MB);
    expect(
      planFor(
        list.plans,
        { id: ids["Systems One"], role: "Systems manager" },
        "2026-10",
      ).source,
    ).toBe("own");
    expect(list.people.map(p => p.name)).toContain("Agent One");
  });

  test("a typed count, a confirmation and the month read back in the client's shape", async () => {
    expect(
      await savePayEntry(ceo.client, {
        personId: ids["Systems One"],
        month: "2026-10",
        partKey: "systems",
        quantity: 2,
        note: "Made-up",
      }),
    ).toMatchObject({ ok: true });
    await expect(
      savePayEntry(ceo.client, {
        personId: ids["Systems One"],
        month: "2026-10",
        partKey: "systems",
        quantity: 1,
        clearedOn: "7 Oct",
      }),
    ).rejects.toThrow("Type dates as YYYY-MM-DD.");
    expect(
      await payNoneRest(ceo.client, {
        personId: ids["Systems One"],
        month: "2026-10",
      }),
    ).toEqual({ ok: true, parts: 1 });
    expect(
      await confirmPay(ceo.client, {
        month: "2026-10",
        key: `ramp_start:${ids["Systems One"]}`,
        value: { day: "2026-10-02" },
      }),
    ).toMatchObject({ ok: true, removed: false });
    const m = await readPayMonth(ceo.client, { month: "2026-10" });
    expect(m).toMatchObject({
      month: "2026-10-01",
      closed: false,
      settleDay: "2026-11-03",
    });
    const sys = m.people.find(p => p.name === "Systems One");
    expect(sys?.parts.map(p => [p.key, p.amountUsd, p.state])).toEqual([
      ["systems", 400, "known"],
      ["systems_large", 0, "known"],
    ]);
    expect(sys?.totalUsd).toBe(1400);
    const buyer = m.people.find(p => p.name === "Buyer One");
    expect(buyer?.parts[0]).toMatchObject({
      amountUsd: 200,
      band: { index: 2 },
      input: { value: 12.5 },
    });
    // The band the browser would draw is the band the server paid.
    expect(pickBand(mbBand.bands, buyer?.parts[0].input?.value)).toEqual({
      index: 2,
      amount: 200,
    });
    const agent = m.people.find(p => p.name === "Agent One");
    expect(agent?.commission.map(l => [l.basis, l.amountUsd, l.state])).toEqual(
      [
        ["per_client_appt_shown", 45, "measured"],
        ["per_client_deal_closed", 0, "measured"],
      ],
    );
    expect(agent?.roleCommission).toEqual({ matches: true });
    await expect(
      readPayMonth(ceo.client, { month: "October" }),
    ).rejects.toThrow("Choose a month, as YYYY-MM.");
  });

  test("approving before the settle day is refused with the server's sentence; costs read", async () => {
    const m = await readPayMonth(ceo.client, { month: "2026-10" });
    const sys = m.people.find(p => p.name === "Systems One");
    if (!sys || sys.totalUsd === null) throw new Error("no total");
    const out = await approvePayMonth(ceo.client, {
      month: "2026-10",
      people: [
        {
          personId: sys.personId,
          totalUsd: sys.totalUsd,
          resultHash: sys.resultHash,
        },
      ],
    });
    expect(out).toEqual({
      ok: true,
      approved: 0,
      existing: 0,
      refused: [
        {
          personId: sys.personId,
          sentence: "Approve October from 3 November.",
        },
      ],
    });
    await expect(
      withdrawPayMonth(ceo.client, {
        personId: sys.personId,
        month: "2026-10",
        reason: "Made-up",
      }),
    ).rejects.toThrow("October isn't approved for Systems One.");
    expect(await readPayCosts(ceo.client)).toEqual([]);
  });

  test("anyone but the CEO is refused, and the sentence has no Postgres prefix", async () => {
    const member = pgClient(pg, MEMBER);
    await expect(readPayPlans(member.client)).rejects.toThrow(
      "Verified founder access required",
    );
    await expect(readPayMonth(null, { month: "2026-10" })).rejects.toThrow(
      "Sign in before reading or changing pay.",
    );
  });

  test("every pay RPC is named literally in the client", () => {
    const text = readFileSync(
      new URL("../src/lib/ceoPayClient.ts", import.meta.url),
      "utf8",
    );
    const called = [...text.matchAll(/\.rpc\(\s*"(cockpit_[a-z_]+)"/g)]
      .map(m => m[1])
      .sort();
    expect(called).toEqual(CEO_PAY_RPCS);
    const money = readFileSync(
      new URL("../src/lib/ceoMoneyClient.ts", import.meta.url),
      "utf8",
    );
    expect(
      [...money.matchAll(/\.rpc\(\s*"(cockpit_[a-z_]+)"/g)]
        .map(m => m[1])
        .sort(),
    ).toEqual(CEO_MONEY_RPCS);
  });
});

/** The CEO RPCs the migrations grant to the browser, by name. */
function granted(file: string, prefix: string): string[] {
  const text = readFileSync(
    new URL(`supabase/migrations/${file}`, root),
    "utf8",
  );
  return [
    ...new Set(
      [...text.matchAll(/'(cockpit_ceo_[a-z_]+)\(/g)]
        .map(m => m[1])
        .filter(n => n.startsWith(prefix)),
    ),
  ].sort();
}
const CEO_PAY_RPCS = granted("20261018a_ceo_pay_plans.sql", "cockpit_ceo_pay_");
const CEO_MONEY_RPCS = [
  ...new Set(
    [
      ...readFileSync(
        new URL(
          "supabase/migrations/20261018c_money_ties_deal_payments.sql",
          root,
        ),
        "utf8",
      ).matchAll(/FUNCTION public\.(cockpit_ceo_payment_[a-z_]+)\(/g),
    ].map(m => m[1]),
  ),
].sort();

describe("money ties from the browser", () => {
  const mock = () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: { ok: true, id: 41 }, error: null };
      },
    } as unknown as SupabaseClient;
    return { client, calls };
  };

  test("a tie goes as the server takes it, trimmed, with nothing it does not know", async () => {
    const m = mock();
    expect(
      await tiePayment(m.client, {
        payerEmail: "  Payer.One@Example.TEST ",
        dealResponseId: " resp-made-up-1 ",
        note: " The CEO: payer one is Client A's deal ",
      }),
    ).toEqual({ ok: true, id: 41 });
    expect(m.calls).toEqual([
      {
        name: "cockpit_ceo_payment_tie",
        args: {
          p: {
            payerEmail: "payer.one@example.test",
            dealResponseId: "resp-made-up-1",
            note: "The CEO: payer one is Client A's deal",
          },
        },
      },
    ]);
    await untiePayment(m.client, {
      id: 41,
      reason: "Made-up: tied by mistake",
    });
    expect(m.calls[1]).toEqual({
      name: "cockpit_ceo_payment_untie",
      args: { p: { id: 41, reason: "Made-up: tied by mistake" } },
    });
  });

  test("the server's first refusals, said before the round trip", async () => {
    const m = mock();
    const refuse = (tie: Record<string, unknown>) =>
      tiePayment(m.client, { note: "Made-up note", ...tie } as never);
    await expect(refuse({ dealResponseId: "resp-1" })).rejects.toThrow(
      "Tie one payment, one payer email or one payer name",
    );
    await expect(
      refuse({
        paymentId: "whop:pay_1",
        payerEmail: "a@example.test",
        notClient: true,
      }),
    ).rejects.toThrow("Tie one payment, one payer email or one payer name");
    await expect(refuse({ paymentId: "whop:pay_1" })).rejects.toThrow(
      "Choose one: a signed deal, a client card or not client money",
    );
    await expect(
      refuse({
        paymentId: "whop:pay_1",
        dealResponseId: "resp-1",
        clickupTaskId: "cu-1",
      }),
    ).rejects.toThrow(
      "Choose one: a signed deal, a client card or not client money",
    );
    await expect(
      refuse({ paymentId: "whop:pay_1", notClient: true, note: "no" }),
    ).rejects.toThrow("Say why in a note of 3 to 500 characters");
    await expect(
      refuse({ paymentId: "stripe:pay_1", notClient: true }),
    ).rejects.toThrow("That is not a payment id from the Transactions tab");
    await expect(
      refuse({ payerEmail: "not-an-email", notClient: true }),
    ).rejects.toThrow("That is not an email address");
    // Never a first name alone.
    await expect(
      refuse({ payerKey: "Payer", notClient: true }),
    ).rejects.toThrow("Tie by email or the full payer name.");
    await expect(
      refuse({ payerKey: "Al Bo", notClient: true }),
    ).rejects.toThrow("Tie by email or the full payer name.");
    await expect(
      refuse({ paymentId: "whop:pay_1", notClient: true, amount: 5 }),
    ).rejects.toThrow("Unsupported field: amount");
    await expect(
      untiePayment(m.client, { id: 0, reason: "Made-up" }),
    ).rejects.toThrow("Choose a tie to remove");
    expect(m.calls).toEqual([]);
    expect(
      tiePayload({
        payerKey: "Payer One Made-up",
        clickupTaskId: "cu-1",
        note: "Made-up note",
      }),
    ).toEqual({
      payerKey: "Payer One Made-up",
      clickupTaskId: "cu-1",
      note: "Made-up note",
    });
  });

  test("the server's sentence comes back without Postgres' prefix; the sheet never asks for a refresh", async () => {
    const client = {
      rpc: async () => ({
        data: null,
        error: {
          message:
            "ERROR: That payment is not in the ledger yet; refresh Money first.",
        },
      }),
    } as unknown as SupabaseClient;
    await expect(
      tiePayment(client, {
        paymentId: "tap:chg_1",
        notClient: true,
        note: "Made-up note",
      }),
    ).rejects.toThrow(
      /^That payment is not in the ledger yet; refresh Money first\.$/,
    );
    expect(tiedSentence("2026-10-18T06:40:00Z")).toBe(
      "Tied. It shows after the next money refresh (about 15 minutes). Last refresh 09:40.",
    );
    expect(tiedSentence(null)).toBe(
      "Tied. It shows after the next money refresh (about 15 minutes).",
    );
    const source = readFileSync(
      new URL("../src/lib/ceoMoneyClient.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/refreshNow|cockpit_ceo_refresh/);
  });
});

describe("the harness answers every pay and money RPC with made-up data the client accepts", () => {
  const harness = {
    rpc: async (name: string, args: Record<string, unknown> = {}) =>
      payRpc(name, args),
  } as unknown as SupabaseClient;

  test("every RPC the browser may call has a fixture", () => {
    expect([...PAY_RPCS].sort()).toEqual(
      [...CEO_PAY_RPCS, ...CEO_MONEY_RPCS].sort(),
    );
  });

  test("the plans, both months and the costs pass the client's checks", async () => {
    const list = await readPayPlans(harness);
    for (const r of list.plans)
      if (r.plan)
        expect({
          id: r.id,
          says: checkPlan(r.plan, { isRole: r.role !== null }),
        }).toEqual({ id: r.id, says: null });
    const kinds = new Set(
      list.plans.flatMap(r => r.plan?.parts.map(p => p.kind) ?? []),
    );
    expect([...kinds].sort()).toEqual([
      "band",
      "floor",
      "per_above",
      "per_event",
      "share",
    ]);
    expect(list.plans.some(r => r.personId !== null && r.plan)).toBe(true);
    expect(list.plans.some(r => r.personId !== null && r.plan === null)).toBe(
      true,
    );
    const costs = await readPayCosts(harness);
    expect(costs.map(c => c.month)).toEqual(["2026-09", "2026-09", "2026-09"]);
    for (const month of ["2026-09", "2026-10", "2026-11"]) {
      const m = await readPayMonth(harness, { month });
      for (const p of m.people) {
        // Each person's figures add up the way the server adds them.
        const plan = list.plans.find(r => r.id === p.plan.planId)?.plan ?? null;
        // What a waiting line or part has settled is known: the floor is never above it.
        const lines = p.commission
          .filter(l => l.state === "measured" || l.state === "waiting")
          .reduce((n, l) => n + (l.amountUsd ?? 0), 0);
        const parts = p.parts
          .filter(
            x =>
              x.state === "known" ||
              x.state === "not_met" ||
              x.state === "waiting",
          )
          .reduce((n, x) => n + (x.amountUsd ?? 0), 0);
        const worst = p.parts
          .filter(x => x.state === "missing" && x.kind === "band")
          .reduce((n, x) => {
            const b = plan?.parts.find(q => q.key === x.key);
            return (
              n +
              Math.min(
                0,
                ...(b?.kind === "band" ? b.bands.map(z => z.amount) : [0]),
              )
            );
          }, 0);
        const known = (p.base.usd ?? 0) + lines + parts;
        const label = `${month} ${p.name}`;
        expect({ label, known: p.knownUsd }).toEqual({ label, known });
        expect({ label, lowest: p.lowestUsd }).toEqual({
          label,
          lowest: known + worst,
        });
        expect(p.lowestUsd).toBeLessThanOrEqual(p.knownUsd);
        expect({ label, commission: p.commissionUsd }).toEqual({
          label,
          commission: p.commission.some(
            l => l.state === "measured" || l.state === "waiting",
          )
            ? lines
            : null,
        });
        expect({ label, parts: p.partsUsd }).toEqual({ label, parts });
        const open = p.missing.length > 0 || p.base.usd === null;
        expect({ label, total: p.totalUsd }).toEqual({
          label,
          total: open ? null : known,
        });
        if (p.status === "ready") expect(m.closed && !open).toBe(true);
        // A band part's index is the band the browser picks for its value.
        for (const x of p.parts)
          if (x.kind === "band" && x.band) {
            const b = plan?.parts.find(q => q.key === x.key);
            expect(
              b?.kind === "band"
                ? pickBand(b.bands, x.input?.value)?.index
                : null,
            ).toBe(x.band.index);
          }
      }
    }
  });

  test("the writes answer as the server does", async () => {
    expect(
      await savePayPlan(harness, {
        role: "Video editor",
        fromMonth: "2026-11",
        plan: { version: 1, parts: [] },
      }),
    ).toMatchObject({ ok: true });
    expect(
      (await readPayPlans(harness)).plans.some(r => r.role === "Video editor"),
    ).toBe(true);
    const sep = await readPayMonth(harness, { month: "2026-09" });
    const ready = sep.people.filter(p => p.status === "ready");
    expect(ready.map(p => p.name)).toEqual(["Omar Fayed"]);
    const approved = sep.people.find(
      p => p.status === "approved" && p.sinceApproval,
    );
    expect(approved?.sinceApproval?.deltaUsd).toBe(20);
    const out = await approvePayMonth(harness, {
      month: "2026-09",
      people: [...ready, approved].map(p => ({
        personId: p?.personId ?? 0,
        totalUsd: p?.totalUsd ?? 0,
        resultHash: p?.resultHash ?? "",
      })),
    });
    expect(out).toMatchObject({ approved: 1, existing: 1, refused: [] });
    expect(
      await tiePayment(harness, {
        paymentId: "whop:pay_fx021",
        dealResponseId: "resp-fx-d02",
        note: "Made-up tie",
      }),
    ).toMatchObject({ ok: true });
  });
});
