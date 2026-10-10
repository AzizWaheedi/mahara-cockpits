import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { CostsSummary, Sheet } from "../types/ceo/costs";
import {
  type ClosedMonthPay,
  type CostLine,
  closedMonthPay,
  totalOf,
} from "../types/ceo/costsModel";
import { addDays, daysInMonth } from "../types/ceo/time";
import { type CostsApproval, readHoursCosts } from "./ceoHoursClient";
import { peopleRoster } from "./ceoPeopleModel";

// The cockpit's fixed planning rates, not settlement or live FX quotes.
const USD_PER: Record<string, number> = {
  USD: 1,
  KWD: 3.26,
  AED: 0.2723,
  SAR: 0.2666,
  QAR: 0.2747,
};
const lineSchema = z.object({
  id: z.number().int().positive(),
  kind: z.enum(["software", "overhead", "marketing"]),
  name: z.string(),
  category: z.string().nullable(),
  billing: z.enum(["monthly", "yearly", "usage"]),
  seats: z.number().finite().nonnegative().nullable(),
  unit_price: z.number().finite().nonnegative(),
  currency: z.string(),
  paid_with: z.string().nullable(),
  match: z.string().nullable(),
  status: z.enum(["active", "paused", "cancelled"]),
  note: z.string().nullable(),
  sort: z.number().int(),
});
const contextSchema = z.object({
  lines: z.array(lineSchema),
  people: z.array(
    z
      .object({
        id: z.number().int().positive(),
        name: z.string(),
        active: z.boolean(),
        monthly_cost: z.number().finite().nonnegative().nullable(),
        currency: z.string(),
      })
      .passthrough(),
  ),
  plans: z.array(
    z.object({
      id: z.number().int().positive(),
      title: z.string(),
      period_from: z.string(),
      period_to: z.string(),
      status: z.string(),
    }),
  ),
  targets: z.array(
    z.object({
      plan_id: z.number().int().positive(),
      metric_key: z.string(),
      target: z.number().finite().nullable(),
    }),
  ),
  bank: z
    .array(
      z.object({
        day: z.string(),
        usd: z.number().finite().nullable(),
        category: z.string().nullable(),
        reference: z.string().nullable(),
      }),
    )
    .nullable(),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type CostContext = z.infer<typeof contextSchema>;
const num = (v: unknown): number | null =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);
function positiveId(id: unknown) {
  if (!Number.isSafeInteger(id) || Number(id) <= 0)
    throw new Error("Invalid cost ID");
}
export function costLine(raw: unknown): CostLine {
  const r = lineSchema.parse(raw);
  return {
    id: Number(r.id),
    kind: r.kind,
    name: String(r.name),
    category: r.category ?? null,
    billing: r.billing,
    seats: num(r.seats),
    unitPrice: Number(r.unit_price),
    currency: String(r.currency).toUpperCase(),
    paidWith: r.paid_with ?? null,
    match: r.match ?? null,
    status: r.status,
    note: r.note ?? null,
    sort: Number(r.sort),
  };
}
async function rpc(
  client: SupabaseClient | null,
  name: string,
  args: Record<string, unknown>,
) {
  if (!client) throw new Error("Sign in before reading or changing costs");
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message || "Costs operation failed");
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Unrecognized costs response");
  return data as Record<string, unknown>;
}
function workingPeople(context: CostContext): Sheet["people"] {
  return peopleRoster(context.people)
    .people.filter(p => p.working)
    .map(p => ({
      id: p.id,
      name: p.name,
      role: p.role,
      monthlyUsd: p.monthlyUsd,
      currency: p.currency,
      basis: p.commission.basis,
      rate: p.commission.rate,
    }));
}
export function costsSummary(context: CostContext): CostsSummary {
  const lines = context.lines.map(costLine);
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
    people: workingPeople(context),
    usdPer: USD_PER,
  };
}
export async function getCostsContext(
  client: SupabaseClient | null,
): Promise<CostContext> {
  return contextSchema.parse(
    await rpc(client, "cockpit_ceo_costs_context", {}),
  );
}
/**
 * Last calendar month's base pay: each person's approved figure from Hours
 * and pay where one exists, the roster's pay for the rest. "The rest" is who
 * was on the roster that month: not someone who started after it, and still
 * someone who left during or after it. People approved for that month count
 * whatever they are now; nobody is counted twice.
 */
export function lastMonthPay(
  context: CostContext,
  approvals: CostsApproval[],
  month: string,
): ClosedMonthPay {
  const roster = peopleRoster(context.people).people;
  const byId = new Map(
    approvals.filter(a => a.month === month).map(a => [a.personId, a]),
  );
  const from = `${month}-01`;
  const to = `${month}-${String(daysInMonth(from)).padStart(2, "0")}`;
  const onRosterThen = (p: (typeof roster)[number]) =>
    p.engagement !== "bot" &&
    (!p.startedOn || p.startedOn <= to) &&
    (p.active
      ? !(p.pausedOn && p.pausedOn <= from)
      : p.endedOn !== null && p.endedOn >= from);
  const paid = roster.filter(p => onRosterThen(p) || byId.has(p.id));
  return closedMonthPay(
    paid.map(p => {
      const a = byId.get(p.id);
      return {
        id: p.id,
        name: p.name,
        monthlyUsd: onRosterThen(p) ? p.monthlyUsd : null,
        approved: a
          ? { month, amountUsd: a.amountUsd, shadow: a.shadow }
          : null,
      };
    }),
    month,
  );
}

export function buildCostsSheet(
  context: CostContext,
  planId?: number,
  /** Approved months from Hours and pay; null when they could not be read. */
  approvals: CostsApproval[] | null = null,
): Sheet {
  const lines = context.lines.map(costLine);
  const plans: Sheet["plans"] = context.plans.map(r => ({
    id: Number(r.id),
    title: String(r.title),
    periodFrom: String(r.period_from),
    periodTo: String(r.period_to),
    status: String(r.status),
  }));
  const next = plans
    .filter(p => p.periodFrom > context.today)
    .sort((a, b) => a.periodFrom.localeCompare(b.periodFrom))[0];
  const plan =
    planId !== undefined
      ? (plans.find(p => p.id === planId) ?? null)
      : (next ??
        plans.find(
          p => p.periodFrom <= context.today && p.periodTo >= context.today,
        ) ??
        plans[0] ??
        null);
  if (planId !== undefined && !plan) throw new Error("Plan no longer exists");
  const t: Record<string, number | null> = {};
  for (const row of context.targets)
    if (Number(row.plan_id) === plan?.id)
      t[String(row.metric_key)] = num(row.target);
  const lastTo = addDays(`${context.today.slice(0, 7)}-01`, -1);
  const lastFrom = `${lastTo.slice(0, 7)}-01`;
  const closed = lastFrom.slice(0, 7);
  const bank = context.bank;
  let statements: Sheet["statements"] = null;
  if (bank !== null) {
    const month = bank.filter(b => b.day >= lastFrom && b.day <= lastTo);
    const byCategory: Record<string, number> = {};
    for (const b of month) {
      const usd = num(b.usd);
      if (usd === null)
        throw new Error("A statement expense has no USD amount");
      const key = String(b.category ?? "other");
      byCategory[key] =
        Math.round(((byCategory[key] ?? 0) + Math.abs(usd)) * 100) / 100;
    }
    statements = month.length
      ? {
          month: lastFrom.slice(0, 7),
          through: month[0]?.day ?? null,
          byCategory,
        }
      : null;
  }
  const lastCharge: Sheet["lastCharge"] = {};
  for (const line of lines) {
    if (!line.match) continue;
    const word = line.match.toLowerCase();
    const hit = bank?.find(b =>
      String(b.reference ?? "")
        .toLowerCase()
        .includes(word),
    );
    const usd = hit ? num(hit.usd) : null;
    lastCharge[line.id] =
      hit && usd !== null ? { day: String(hit.day), usd: Math.abs(usd) } : null;
  }
  const approvedLast = new Map(
    (approvals ?? []).filter(a => a.month === closed).map(a => [a.personId, a]),
  );
  return {
    ready: true,
    lines,
    people: workingPeople(context).map(p => {
      const a = approvedLast.get(p.id);
      return {
        ...p,
        approved: a
          ? { month: closed, amountUsd: a.amountUsd, shadow: a.shadow }
          : null,
      };
    }),
    lastMonthPay: approvals ? lastMonthPay(context, approvals, closed) : null,
    plans,
    plan,
    lastCharge,
    projection: {
      newCash: t.newCash ?? null,
      contracted: t.contracted ?? null,
      introsShown: t.introsShown ?? null,
      demosShown: t.demosShown ?? null,
      closes: t.closes ?? null,
      mrrDue:
        t.mrrProjected ??
        (t.backEndCash != null && t.mrrCollectionRate
          ? t.backEndCash / t.mrrCollectionRate
          : null),
    },
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
/** Approved pay never holds the Costs page back: unreadable is null, and the page says so. */
async function approvalsOrNull(
  client: SupabaseClient | null,
): Promise<CostsApproval[] | null> {
  try {
    return await readHoursCosts(client);
  } catch {
    return null;
  }
}

export async function readCostsSheet(
  client: SupabaseClient | null,
  args: { planId?: number } = {},
) {
  if (args.planId !== undefined) positiveId(args.planId);
  const [context, approvals] = await Promise.all([
    getCostsContext(client),
    approvalsOrNull(client),
  ]);
  return buildCostsSheet(context, args.planId, approvals);
}
export async function saveCostLine(
  client: SupabaseClient | null,
  patch: Record<string, unknown>,
) {
  if (patch.id !== undefined) positiveId(patch.id);
  for (const value of Object.values(patch))
    if (typeof value === "number" && !Number.isFinite(value))
      throw new Error("Cost numbers must be finite");
  const result = await rpc(client, "cockpit_ceo_cost_save", { p_patch: patch });
  if (result.ok !== true || !result.line)
    throw new Error("Cost save was not confirmed");
  return { ok: true as const, line: costLine(result.line) };
}
export async function removeCostLine(
  client: SupabaseClient | null,
  args: { id: number },
) {
  positiveId(args.id);
  const result = await rpc(client, "cockpit_ceo_cost_remove", {
    p_id: args.id,
  });
  if (result.ok !== true) throw new Error("Cost removal was not confirmed");
  return { ok: true as const };
}
