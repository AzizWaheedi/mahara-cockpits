import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation } from "../_generated/server";
import { authenticatedAction } from "../functions";
import {
  type CostLine,
  type Payee,
  type Projection,
  totalOf,
} from "./costsModel";
import { USD_PER } from "./data/tap";
import { shape } from "./people";
import { rest } from "./sbWrite";
import { addDays, kuwaitDay } from "./time";

/**
 * The Costs page: what a month costs, as a sheet Aziz edits.
 *
 * Aziz, 2026-10-02: "a spreadsheet in the money section for all software
 * expenses, so I can see them at a high level, or at least an estimate of
 * what it's going to be every month... especially for software that is per
 * seat... As well as the payroll... depending on who's active... the
 * commissions for the projections... labor, overhead and marketing."
 *
 * Software, other overhead and marketing lines live in `cockpit_cost_lines`.
 * Payroll is the roster (`cockpit_people`) with each person's commission
 * priced on a plan's projections. Last month's real spend comes from the
 * uploaded statements (`cockpit_bank_lines`), so the estimate sits beside
 * what was actually paid. The arithmetic is `costsModel.ts`.
 */

const LINES = "cockpit_cost_lines";
const KINDS = ["software", "overhead", "marketing"] as const;
const BILLING = ["monthly", "yearly", "usage"] as const;
const STATUS = ["active", "paused", "cancelled"] as const;

// biome-ignore lint/suspicious/noExplicitAny: Supabase rows
type Row = Record<string, any>;

function toLine(r: Row): CostLine {
  return {
    id: Number(r.id),
    kind: r.kind,
    name: String(r.name),
    category: r.category ? String(r.category) : null,
    billing: r.billing,
    seats: r.seats === null ? null : Number(r.seats),
    unitPrice: Number(r.unit_price ?? 0),
    currency: String(r.currency ?? "USD").toUpperCase(),
    paidWith: r.paid_with ? String(r.paid_with) : null,
    match: r.match ? String(r.match) : null,
    status: r.status,
    note: r.note ? String(r.note) : null,
    sort: Number(r.sort ?? 0),
  };
}

export type Sheet = {
  ready: boolean;
  lines: CostLine[];
  /** The last charge a statement shows for each line with a `match`, by id. */
  lastCharge: Record<number, { day: string; usd: number } | null>;
  /** Everyone working: active, not paused, and a person. */
  people: (Payee & { role: string | null })[];
  plans: {
    id: number;
    title: string;
    periodFrom: string;
    periodTo: string;
    status: string;
  }[];
  plan: {
    id: number;
    title: string;
    periodFrom: string;
    periodTo: string;
    status: string;
  } | null;
  projection: Projection;
  /** What the plan itself says about marketing and the costs it typed. */
  planned: {
    spend: number | null;
    spendRetargeting: number | null;
    labour: number | null;
    overhead: number | null;
  };
  /** Last calendar month's expenses on the statements, by category, in USD. */
  statements: {
    month: string;
    through: string | null;
    byCategory: Record<string, number>;
  } | null;
  usdPer: Record<string, number>;
};

const num = (v: unknown): number | null =>
  v === null || v === undefined || !Number.isFinite(Number(v))
    ? null
    : Number(v);

/** The plan whose numbers price the commissions: next month's if there is one, else this month's. */
function pickPlan(plans: Sheet["plans"], wanted?: number) {
  if (wanted) return plans.find(p => p.id === wanted) ?? null;
  const today = kuwaitDay();
  const next = plans
    .filter(p => p.periodFrom > today)
    .sort((a, b) => a.periodFrom.localeCompare(b.periodFrom))[0];
  const now = plans.find(p => p.periodFrom <= today && p.periodTo >= today);
  return next ?? now ?? plans[0] ?? null;
}

export async function buildSheet(planId?: number): Promise<Sheet> {
  const raw = await rest(`${LINES}?select=*&order=kind,sort,id`);
  const lines = (raw ?? []).map(toLine);

  const roster = (await rest("cockpit_people?select=*&order=name.asc")) ?? [];
  const people = roster
    .map(shape)
    .filter(p => p.working)
    .map(p => ({
      id: p.id,
      name: p.name,
      role: p.role,
      monthlyUsd: p.monthlyUsd,
      currency: p.currency,
      basis: p.commission.basis,
      rate: p.commission.rate,
    }));

  const plans = (
    (await rest(
      "cockpit_goal_plans?select=id,title,period_from,period_to,status&order=period_from.desc&limit=24",
    )) ?? []
  ).map(r => ({
    id: Number(r.id),
    title: String(r.title ?? ""),
    periodFrom: String(r.period_from),
    periodTo: String(r.period_to),
    status: String(r.status),
  }));
  const plan = pickPlan(plans, planId);
  const t: Record<string, number | null> = {};
  if (plan) {
    const rows =
      (await rest(
        `cockpit_goal_targets?plan_id=eq.${plan.id}&select=metric_key,target`,
      )) ?? [];
    for (const r of rows) t[String(r.metric_key)] = num(r.target);
  }
  const projection: Projection = {
    newCash: t.newCash ?? null,
    contracted: t.contracted ?? null,
    introsShown: t.introsShown ?? null,
    demosShown: t.demosShown ?? null,
    closes: t.closes ?? null,
    mrrDue:
      t.mrrProjected ??
      (t.backEndCash !== undefined &&
      t.backEndCash !== null &&
      t.mrrCollectionRate
        ? t.backEndCash / t.mrrCollectionRate
        : null),
  };

  // Last calendar month on the statements, and how far into it they reach.
  const today = kuwaitDay();
  const first = `${today.slice(0, 7)}-01`;
  const lastFrom = `${addDays(first, -1).slice(0, 7)}-01`;
  const lastTo = addDays(first, -1);
  let statements: Sheet["statements"] = null;
  const bank = await rest(
    `cockpit_bank_lines?kind=eq.expense&day=gte.${addDays(today, -120)}&select=day,usd,category,reference&order=day.desc&limit=5000`,
  );
  if (bank) {
    const month = bank.filter(b => b.day >= lastFrom && b.day <= lastTo);
    const byCategory: Record<string, number> = {};
    for (const b of month)
      byCategory[String(b.category ?? "other")] =
        Math.round(
          ((byCategory[String(b.category ?? "other")] ?? 0) +
            Math.abs(Number(b.usd ?? 0))) *
            100,
        ) / 100;
    statements = {
      month: lastFrom.slice(0, 7),
      through: month[0]?.day ? String(month[0].day) : null,
      byCategory,
    };
  }
  const lastCharge: Sheet["lastCharge"] = {};
  for (const l of lines) {
    if (!l.match) continue;
    const word = l.match.toLowerCase();
    const hit = (bank ?? []).find(b =>
      String(b.reference ?? "")
        .toLowerCase()
        .includes(word),
    );
    lastCharge[l.id] = hit
      ? { day: String(hit.day), usd: Math.abs(Number(hit.usd ?? 0)) }
      : null;
  }

  return {
    ready: raw !== null,
    lines,
    lastCharge,
    people,
    plans,
    plan,
    projection,
    planned: {
      spend: t.spend ?? null,
      spendRetargeting: t.spendRetargeting ?? null,
      labour: t.labour ?? null,
      overhead: t.overhead ?? null,
    },
    statements,
    usdPer: USD_PER,
  };
}

/**
 * What next month's plan needs from the sheet: the monthly totals and who is
 * paid what, so the plan prices payroll on its own projections.
 */
export type CostsSummary = {
  softwareUsd: number;
  overheadUsd: number;
  marketingUsd: number;
  /** Lines in a currency with no rate: the totals leave them out. */
  unpriced: string[];
  people: Payee[];
  usdPer: Record<string, number>;
};

export async function costsSummary(): Promise<CostsSummary | null> {
  const raw = await rest(`${LINES}?select=*`);
  const roster = await rest("cockpit_people?select=*");
  if (raw === null || roster === null) return null;
  const lines = raw.map(toLine);
  const people = roster
    .map(shape)
    .filter(p => p.working)
    .map(p => ({
      id: p.id,
      name: p.name,
      monthlyUsd: p.monthlyUsd,
      currency: p.currency,
      basis: p.commission.basis,
      rate: p.commission.rate,
    }));
  const software = totalOf(lines, "software", USD_PER);
  const overhead = totalOf(lines, "overhead", USD_PER);
  const marketing = totalOf(lines, "marketing", USD_PER);
  return {
    softwareUsd: software.usd,
    overheadUsd: overhead.usd,
    marketingUsd: marketing.usd,
    unpriced: [
      ...software.unpriced,
      ...overhead.unpriced,
      ...marketing.unpriced,
    ],
    people,
    usdPer: USD_PER,
  };
}

export const sheet = authenticatedAction({
  args: { planId: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, a): Promise<Sheet> => {
    await ctx.runQuery(internal.ceo.people.gate, { userId: ctx.userId });
    return buildSheet(a.planId);
  },
});

export const record = internalMutation({
  args: {
    action: v.string(),
    rowId: v.string(),
    what: v.string(),
    before: v.optional(v.any()),
    after: v.optional(v.any()),
    by: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    await ctx.db.insert("ceoAudit", {
      action: a.action,
      table: LINES,
      rowId: a.rowId,
      what: a.what.slice(0, 400),
      before: a.before,
      after: a.after,
      by: a.by,
      at: Date.now(),
    });
    return null;
  },
});

/** Add a line, or change one. Every save is audited with the row before and after. */
export const save = authenticatedAction({
  args: {
    id: v.optional(v.number()),
    kind: v.union(...KINDS.map(k => v.literal(k))),
    name: v.string(),
    category: v.optional(v.union(v.string(), v.null())),
    billing: v.union(...BILLING.map(b => v.literal(b))),
    seats: v.optional(v.union(v.number(), v.null())),
    unitPrice: v.number(),
    currency: v.optional(v.string()),
    paidWith: v.optional(v.union(v.string(), v.null())),
    match: v.optional(v.union(v.string(), v.null())),
    status: v.optional(v.union(...STATUS.map(s => v.literal(s)))),
    note: v.optional(v.union(v.string(), v.null())),
    sort: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ ok: true; line: CostLine }> => {
    const email: string = await ctx.runQuery(internal.ceo.people.gate, {
      userId: ctx.userId,
    });
    const name = a.name.trim().slice(0, 120);
    if (!name) throw new Error("A line needs a name.");
    if (!Number.isFinite(a.unitPrice) || a.unitPrice < 0)
      throw new Error("A price is a number, zero or more.");
    if (
      a.seats !== undefined &&
      a.seats !== null &&
      (!Number.isFinite(a.seats) || a.seats < 0)
    )
      throw new Error("Seats are a number, zero or more.");
    const currency = (a.currency ?? "USD").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency))
      throw new Error("A currency is three letters, like USD or KWD.");
    const body: Row = {
      kind: a.kind,
      name,
      category: a.category?.trim().slice(0, 60) || null,
      billing: a.billing,
      seats: a.seats ?? null,
      unit_price: a.unitPrice,
      currency,
      paid_with: a.paidWith?.trim().slice(0, 80) || null,
      match: a.match?.trim().slice(0, 60) || null,
      status: a.status ?? "active",
      note: a.note?.trim().slice(0, 500) || null,
      ...(a.sort === undefined ? {} : { sort: a.sort }),
      updated_at: new Date().toISOString(),
      updated_by: email,
    };
    let before: Row | null = null;
    if (a.id !== undefined) {
      const found = await rest(`${LINES}?id=eq.${a.id}&select=*`);
      if (!found?.length)
        throw new Error("That line is not on the sheet any more.");
      before = found[0];
    }
    const done =
      a.id === undefined
        ? await rest(LINES, {
            method: "POST",
            prefer: "return=representation",
            body: [body],
          })
        : await rest(`${LINES}?id=eq.${a.id}`, {
            method: "PATCH",
            prefer: "return=representation",
            body,
          });
    if (!done?.length) throw new Error("The sheet did not take that line.");
    const line = toLine(done[0]);
    await ctx.runMutation(internal.ceo.costs.record, {
      action: before ? "costs.edit" : "costs.add",
      rowId: String(line.id),
      what: before
        ? `Changed ${line.kind} line ${line.name}.`
        : `Added ${line.kind} line ${line.name}.`,
      ...(before ? { before } : {}),
      after: done[0],
      by: email,
    });
    return { ok: true, line };
  },
});

/** Take a line off the sheet. For a mistake; a tool that stopped is marked cancelled instead. */
export const remove = authenticatedAction({
  args: { id: v.number() },
  returns: v.any(),
  handler: async (ctx, { id }): Promise<{ ok: true }> => {
    const email: string = await ctx.runQuery(internal.ceo.people.gate, {
      userId: ctx.userId,
    });
    const found = await rest(`${LINES}?id=eq.${id}&select=*`);
    if (!found?.length) return { ok: true };
    await rest(`${LINES}?id=eq.${id}`, { method: "DELETE" });
    await ctx.runMutation(internal.ceo.costs.record, {
      action: "costs.remove",
      rowId: String(id),
      what: `Took ${found[0].name} off the sheet.`,
      before: found[0],
      by: email,
    });
    return { ok: true };
  },
});
