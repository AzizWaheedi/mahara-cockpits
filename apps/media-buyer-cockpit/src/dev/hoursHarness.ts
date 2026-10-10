/**
 * The layout harness's stand-in for Creative Triage on Team & payroll and
 * Costs: the cockpit's own Supabase client is kept, and only its `rpc` and
 * `functions.invoke` answer from made-up fixtures, so the real clients
 * (ceoHoursClient, ceoPeopleClient, ceoCostsClient) run as they do in
 * production. Nothing reaches the network: an RPC this file does not know
 * answers with an error. Never imported by the production app.
 *
 * `?hours=full|none|never|keys|blocked|firewall|stale` picks the scenario (default
 * full). Every name and figure is invented.
 *
 * `?hours=e2e` serves real backend output instead: what the CEO's RPCs
 * returned in PGlite after the real sync read the fake providers
 * (`bun scripts/hours-harness-data.ts` writes tmp/hours-e2e/data.json),
 * and the month is worked out by the real rule (hoursModelHarness.ts).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  type HoursScenario,
  hoursFixtureCosts,
  hoursFixtureMonth,
  hoursFixtureStatus,
} from "./hoursFixture";

/** The hand-made scenarios, plus "e2e": real backend output from tmp/hours-e2e/data.json. */
export type HarnessScenario = HoursScenario | "e2e";

const SCENARIOS: HarnessScenario[] = [
  "e2e",
  "full",
  "none",
  "never",
  "keys",
  "blocked",
  "firewall",
  "stale",
];

export function hoursScenario(): HarnessScenario {
  const raw =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("hours");
  return SCENARIOS.includes(raw as HarnessScenario)
    ? (raw as HarnessScenario)
    : "full";
}

type E2e = {
  inputs: Record<string, unknown>;
  status: unknown;
  costs: unknown;
  people: unknown;
};
let e2e: Promise<E2e> | null = null;
/** The real backend output, read once (`bun scripts/hours-harness-data.ts` writes it). */
function e2eData(): Promise<E2e> {
  e2e ??= fetch("/tmp/hours-e2e/data.json").then(r => {
    if (!r.ok)
      throw new Error(
        "No end-to-end data yet: run bun scripts/hours-harness-data.ts in apps/media-buyer-cockpit.",
      );
    return r.json() as Promise<E2e>;
  });
  return e2e;
}

const WEEK = {
  sat: { on: true, start: "10:00", end: "18:00" },
  sun: { on: true, start: "10:00", end: "18:00" },
  mon: { on: true, start: "10:00", end: "18:00" },
  tue: { on: true, start: "10:00", end: "18:00" },
  wed: { on: true, start: "10:00", end: "18:00" },
  thu: { on: true, start: "10:00", end: "18:00" },
  fri: { on: false, start: "10:00", end: "18:00" },
};

/** The roster rows `cockpit_ceo_people_list` returns, invented. */
function people() {
  const row = (
    id: number,
    name: string,
    role: string,
    monthly_cost: number | null,
    currency = "USD",
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    name,
    email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.test`,
    role,
    engagement: "staff",
    active: true,
    paused_on: null,
    paused_why: null,
    monthly_cost,
    currency,
    commission_basis: "none",
    commission_rate: null,
    commission_pct: null,
    commission_note: null,
    is_sales: false,
    started_on: "2025-03-01",
    ended_on: null,
    note: null,
    schedule: { timezone: "Asia/Kuwait", week: WEEK, exceptions: [] },
    source: "manual",
    ...extra,
  });
  return [
    row(1, "The CEO", "CEO", null),
    row(101, "Hala Mansour", "Call centre agent", 910),
    row(102, "Omar Fayed", "Call centre agent", 910),
    row(103, "Sara Kanaan", "Media buyer", 1200),
    row(104, "Yousef Darwish", "Closer", 1500, "USD", {
      commission_basis: "closed_cash",
      commission_rate: 0.1,
      commission_pct: 0.1,
      is_sales: true,
    }),
    row(105, "Mona Haddad", "Client success manager", 300, "KWD"),
    row(106, "Tala Odeh", "Call centre agent", 910),
    row(107, "Fadi Nassar", "Systems manager", 1800),
    row(108, "Jad Salem", "Creative strategist", 1100, "USD", {
      paused_on: "2026-10-01",
      paused_why: "Between projects",
    }),
    row(110, "Dina Samir", "", null),
    row(2, "Shared inbox", "Bot", null, "USD", { engagement: "bot" }),
    row(109, "Rana Saeed", "Call centre agent", 910, "USD", {
      active: false,
      ended_on: "2026-08-31",
    }),
  ];
}

/** `cockpit_ceo_costs_context`, invented: a few lines, one plan, no bank. */
function costsContext() {
  return {
    lines: [
      {
        id: 1,
        kind: "software",
        name: "Workspace suite",
        category: "Office",
        billing: "monthly",
        seats: 12,
        unit_price: 14,
        currency: "USD",
        paid_with: null,
        match: null,
        status: "active",
        note: null,
        sort: 0,
      },
      {
        id: 2,
        kind: "software",
        name: "Time tracker",
        category: "Team",
        billing: "monthly",
        seats: 4,
        unit_price: 10,
        currency: "USD",
        paid_with: null,
        match: null,
        status: "active",
        note: null,
        sort: 1,
      },
      {
        id: 3,
        kind: "overhead",
        name: "Office",
        category: null,
        billing: "monthly",
        seats: null,
        unit_price: 400,
        currency: "USD",
        paid_with: null,
        match: null,
        status: "active",
        note: null,
        sort: 0,
      },
    ],
    people: people(),
    plans: [
      {
        id: 1,
        title: "November 2026 plan",
        period_from: "2026-11-01",
        period_to: "2026-11-30",
        status: "draft",
      },
    ],
    targets: [
      { plan_id: 1, metric_key: "newCash", target: 40000 },
      { plan_id: 1, metric_key: "spend", target: 6000 },
    ],
    bank: null,
    today: "2026-10-08",
  };
}

type Answer = { data: unknown; error: { message: string } | null };
const ok = (data: unknown): Answer => ({ data, error: null });

/** Patch the client's rpc and functions.invoke; returns the scenario in use. */
export function installHoursHarness(client: SupabaseClient): HarnessScenario {
  const scenario = hoursScenario();
  const c = client as unknown as {
    rpc: (name: string, args?: Record<string, unknown>) => Promise<Answer>;
    functions: {
      invoke: (name: string, opts?: { body?: unknown }) => Promise<Answer>;
    };
  };
  c.rpc = async (name, args = {}) => {
    if (
      scenario === "e2e" &&
      /^cockpit_ceo_(hours_(inputs|status|costs)|people_list)$/.test(name)
    ) {
      try {
        const data = await e2eData();
        if (name === "cockpit_ceo_people_list") return ok(data.people);
        if (name === "cockpit_ceo_hours_status") return ok(data.status);
        if (name === "cockpit_ceo_hours_costs") return ok(data.costs);
        const month = String(args.p_month ?? "").slice(0, 7);
        const inputs = data.inputs[month];
        return inputs
          ? ok(inputs)
          : {
              data: null,
              error: { message: `The end-to-end data has no ${month}.` },
            };
      } catch (e) {
        return { data: null, error: { message: String(e) } };
      }
    }
    switch (name) {
      case "cockpit_get_ceo_sections":
        return ok({ sections: {}, day: "2026-10-09" });
      case "cockpit_ceo_people_list":
        return ok(people());
      case "cockpit_ceo_costs_context":
        return ok(costsContext());
      case "cockpit_ceo_hours_costs":
        return ok(hoursFixtureCosts());
      case "cockpit_ceo_hours_status":
        return ok(hoursFixtureStatus(scenario as HoursScenario));
      case "cockpit_ceo_hours_inputs": {
        const month = String(args.p_month ?? "").slice(0, 7);
        return ok(hoursFixtureMonth(scenario as HoursScenario, month).inputs);
      }
      default:
        if (/^cockpit_ceo_(hours|people)_/.test(name))
          return ok({ ok: true, id: 1 });
        return {
          data: null,
          error: { message: `The harness has no fixture for ${name}.` },
        };
    }
  };
  c.functions.invoke = async (name, opts = {}) => {
    const body = (opts.body ?? {}) as Record<string, unknown>;
    if (name !== "cockpit-hours-api")
      return { data: null, error: { message: `The harness has no ${name}.` } };
    if (body.op === "saveKey")
      return ok({
        ok: true,
        state: "connected",
        text: "Connected. Hubstaff shows 5 people. The first read is running.",
        last4: String(body.key ?? "").slice(-4),
      });
    if (body.op === "syncNow") return ok({ ok: true, runId: 413 });
    if (body.op === "approveMany")
      return ok({
        results: (
          (body.items ?? []) as { personId: number; amount: number }[]
        ).map(i => ({
          personId: i.personId,
          ok: true,
          approvedAt: "2026-10-08T08:20:00Z",
          amount: i.amount,
          currency: "USD",
          existing: false,
        })),
      });
    return { data: null, error: { message: "Unknown operation." } };
  };
  return scenario;
}
