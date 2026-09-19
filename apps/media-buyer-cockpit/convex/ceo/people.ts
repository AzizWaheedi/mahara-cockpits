import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalQuery } from "../_generated/server";
import { authenticatedAction } from "../functions";
import { googleDirectoryToken } from "../tools";
import { USD_PER } from "./data/tap";
import { isCeoEmail } from "./gate";

declare const process: { env: Record<string, string | undefined> };

/**
 * The people Mahara pays.
 *
 * Nothing in the stack knows who works here. ClickUp time tracking has never
 * recorded an entry, and the bank import's "salaries" category is a bank label
 * whose rows are mostly $6 to $39 card top-ups naming nobody. So this is a
 * roster a person keeps, and it is the single gap that blocks gross margin,
 * real CAC and cost per client.
 *
 * Freelancers and agencies sit beside staff, because to a margin they are the
 * same money. Somebody who leaves is marked inactive rather than deleted: the
 * months they were paid for still happened, and deleting the row would quietly
 * rewrite last quarter's cost.
 *
 * A Google Workspace import is not assumed. The cockpit's service account
 * holds sheets, drive, docs and calendar scopes only, so it cannot list
 * Workspace users; `admin.directory.user.readonly` needs domain-wide
 * delegation configured in the Workspace admin console. The table carries
 * `email` and `source` ready for that, and every row today says `manual`.
 */

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TABLE = "cockpit_people";

// biome-ignore lint/suspicious/noExplicitAny: Supabase rows are untyped here
type Row = Record<string, any>;

async function rest(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<Row[] | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
      ...(init.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (res.status === 404 || text.includes("42P01")) return null;
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 220)}`);
  return text ? JSON.parse(text) : [];
}

export type Person = {
  id: number;
  name: string;
  email: string | null;
  role: string | null;
  engagement: "staff" | "freelancer" | "agency" | "intern";
  active: boolean;
  monthlyCost: number | null;
  currency: string;
  /** monthlyCost in USD at the fixed table, or null when no cost is set. */
  monthlyUsd: number | null;
  commissionPct: number | null;
  commissionNote: string | null;
  isSales: boolean;
  startedOn: string | null;
  endedOn: string | null;
  note: string | null;
  source: string;
};

export type Roster = {
  people: Person[];
  /** False until the migration has been run. */
  ready: boolean;
  /** Monthly cost of everyone still active, in USD. */
  activeMonthlyUsd: number;
  activeCount: number;
  /** Of that, the part belonging to people whose job is selling. */
  salesMonthlyUsd: number;
  /** Active people nobody has costed yet: the total is a floor until they are. */
  missingCost: string[];
};

const round2 = (x: number) => Math.round(x * 100) / 100;

function shape(r: Row): Person {
  const cost = r.monthly_cost === null ? null : Number(r.monthly_cost);
  const currency = String(r.currency ?? "USD").toUpperCase();
  const rate = USD_PER[currency];
  return {
    id: Number(r.id),
    name: String(r.name),
    email: r.email ? String(r.email) : null,
    role: r.role ? String(r.role) : null,
    engagement: String(r.engagement ?? "staff") as Person["engagement"],
    active: Boolean(r.active),
    monthlyCost: cost,
    currency,
    monthlyUsd:
      cost === null || rate === undefined ? null : round2(cost * rate),
    commissionPct:
      r.commission_pct === null || r.commission_pct === undefined
        ? null
        : Number(r.commission_pct),
    commissionNote: r.commission_note ? String(r.commission_note) : null,
    isSales: Boolean(r.is_sales),
    startedOn: r.started_on ? String(r.started_on) : null,
    endedOn: r.ended_on ? String(r.ended_on) : null,
    note: r.note ? String(r.note) : null,
    source: String(r.source ?? "manual"),
  };
}

/** The CEO check, for actions, which have no database of their own. */
export const gate = internalQuery({
  args: { userId: v.id("users") },
  returns: v.string(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    const email = String(user?.email ?? "").toLowerCase();
    if (!isCeoEmail(email)) throw new Error("The CEO cockpit is Aziz's only.");
    return email;
  },
});

/** Everyone, active first, then by name. */
export const list = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<Roster> => {
    await ctx.runQuery(internal.ceo.people.gate, { userId: ctx.userId });
    const rows = await rest(`${TABLE}?select=*&order=active.desc,name.asc`);
    if (rows === null)
      return {
        people: [],
        ready: false,
        activeMonthlyUsd: 0,
        activeCount: 0,
        salesMonthlyUsd: 0,
        missingCost: [],
      };
    const people = rows.map(shape);
    const live = people.filter(p => p.active);
    return {
      people,
      ready: true,
      activeCount: live.length,
      activeMonthlyUsd: round2(
        live.reduce((n, p) => n + (p.monthlyUsd ?? 0), 0),
      ),
      salesMonthlyUsd: round2(
        live
          .filter(p => p.isSales)
          .reduce((n, p) => n + (p.monthlyUsd ?? 0), 0),
      ),
      missingCost: live.filter(p => p.monthlyUsd === null).map(p => p.name),
    };
  },
});

/**
 * Add somebody, or change what is recorded about them.
 *
 * Passing an id edits that row. Leaving it out adds a person. Nothing is ever
 * deleted here: see `setActive`.
 */
export const save = authenticatedAction({
  args: {
    id: v.optional(v.number()),
    name: v.string(),
    email: v.optional(v.string()),
    role: v.optional(v.string()),
    engagement: v.union(
      v.literal("staff"),
      v.literal("freelancer"),
      v.literal("agency"),
      v.literal("intern"),
    ),
    monthlyCost: v.optional(v.number()),
    currency: v.optional(v.string()),
    commissionPct: v.optional(v.number()),
    commissionNote: v.optional(v.string()),
    isSales: v.optional(v.boolean()),
    startedOn: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ ok: true; id: number }> => {
    const email: string = await ctx.runQuery(internal.ceo.people.gate, {
      userId: ctx.userId,
    });
    const name = a.name.trim();
    if (!name) throw new Error("A person needs a name.");
    if (a.monthlyCost !== undefined && a.monthlyCost < 0)
      throw new Error("A monthly cost cannot be below zero.");
    if (
      a.commissionPct !== undefined &&
      (a.commissionPct < 0 || a.commissionPct > 1)
    )
      throw new Error("Commission is a share between 0 and 1, so 0.1 is 10%.");
    if (a.startedOn && !/^\d{4}-\d{2}-\d{2}$/.test(a.startedOn))
      throw new Error("A start date looks like 2026-09-19.");

    const body = {
      name,
      email: a.email?.trim() || null,
      role: a.role?.trim() || null,
      engagement: a.engagement,
      monthly_cost: a.monthlyCost ?? null,
      currency: (a.currency ?? "USD").toUpperCase(),
      commission_pct: a.commissionPct ?? null,
      commission_note: a.commissionNote?.trim().slice(0, 500) || null,
      is_sales: a.isSales ?? false,
      started_on: a.startedOn || null,
      note: a.note?.trim().slice(0, 500) || null,
      source: "manual",
      added_by: email,
    };

    const done =
      a.id === undefined
        ? await rest(TABLE, {
            method: "POST",
            prefer: "return=representation",
            body: [body],
          })
        : await rest(`${TABLE}?id=eq.${a.id}`, {
            method: "PATCH",
            prefer: "return=representation",
            body,
          });
    if (done === null)
      throw new Error(
        "The people table does not exist yet. Run supabase/migrations/20260919b_people.sql first.",
      );
    return { ok: true, id: Number(done[0]?.id ?? a.id ?? 0) };
  },
});

/**
 * Remove a row entirely. Only for a mistake.
 *
 * Somebody who actually worked here is marked inactive, never deleted, because
 * the months they were paid for still happened. This exists for the other
 * case: a name typed wrong, or a person added twice. It refuses once any
 * payroll month references the row, which is the line between a typo and a
 * record of money.
 */
export const remove = authenticatedAction({
  args: { id: v.number() },
  returns: v.any(),
  handler: async (ctx, { id }): Promise<{ ok: true }> => {
    await ctx.runQuery(internal.ceo.people.gate, { userId: ctx.userId });
    const history = await rest(
      `cockpit_payroll_months?person_id=eq.${id}&select=id&limit=1`,
    );
    if (history === null)
      throw new Error(
        "The people table does not exist yet. Run supabase/migrations/20260919b_people.sql first.",
      );
    if (history.length)
      throw new Error(
        "This person already has payroll months recorded against them, so deleting the row would rewrite a past cost. Mark them as gone instead.",
      );
    const gone = await rest(`${TABLE}?id=eq.${id}`, { method: "DELETE" });
    if (gone === null) throw new Error("Could not reach the people table.");
    return { ok: true };
  },
});

/**
 * Mark somebody as gone, or bring them back.
 *
 * Never a delete. The months they were paid for still happened, and removing
 * the row would rewrite a past cost that was real at the time.
 */
export const setActive = authenticatedAction({
  args: {
    id: v.number(),
    active: v.boolean(),
    /** The day they left, when marking somebody gone. */
    endedOn: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, { id, active, endedOn }): Promise<{ ok: true }> => {
    await ctx.runQuery(internal.ceo.people.gate, { userId: ctx.userId });
    if (endedOn && !/^\d{4}-\d{2}-\d{2}$/.test(endedOn))
      throw new Error("A leaving date looks like 2026-09-19.");
    const done = await rest(`${TABLE}?id=eq.${id}`, {
      method: "PATCH",
      prefer: "return=representation",
      body: active
        ? { active: true, ended_on: null }
        : { active: false, ended_on: endedOn || null },
    });
    if (done === null)
      throw new Error(
        "The people table does not exist yet. Run supabase/migrations/20260919b_people.sql first.",
      );
    return { ok: true };
  },
});

/**
 * The Workspace directory, when domain-wide delegation allows it.
 *
 * Returns everyone the directory lists with their name, address and whether
 * the account is suspended, so the roster can be seeded and so somebody who
 * has left Workspace but is still on payroll stands out.
 */
export const workspace = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async (
    ctx,
  ): Promise<{
    ok: boolean;
    problem?: string;
    users: {
      name: string;
      email: string;
      suspended: boolean;
      title: string | null;
    }[];
  }> => {
    await ctx.runQuery(internal.ceo.people.gate, { userId: ctx.userId });
    try {
      const token = await googleDirectoryToken();
      const out: {
        name: string;
        email: string;
        suspended: boolean;
        title: string | null;
      }[] = [];
      let pageToken: string | undefined;
      for (let page = 0; page < 10; page++) {
        const url = new URL(
          "https://admin.googleapis.com/admin/directory/v1/users",
        );
        url.searchParams.set("customer", "my_customer");
        url.searchParams.set("maxResults", "200");
        url.searchParams.set("orderBy", "email");
        if (pageToken) url.searchParams.set("pageToken", pageToken);
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` },
        });
        const text = await res.text();
        if (!res.ok)
          return {
            ok: false,
            problem: `Workspace refused the directory read (${res.status}): ${text.slice(0, 200)}`,
            users: [],
          };
        const json = JSON.parse(text) as Row;
        for (const u of (json.users ?? []) as Row[])
          out.push({
            name: String(u.name?.fullName ?? u.primaryEmail ?? ""),
            email: String(u.primaryEmail ?? ""),
            suspended: Boolean(u.suspended),
            title: u.organizations?.[0]?.title
              ? String(u.organizations[0].title)
              : null,
          });
        pageToken = json.nextPageToken ? String(json.nextPageToken) : undefined;
        if (!pageToken) break;
      }
      return { ok: true, users: out };
    } catch (e) {
      return {
        ok: false,
        problem: String(e instanceof Error ? e.message : e).slice(0, 220),
        users: [],
      };
    }
  },
});
