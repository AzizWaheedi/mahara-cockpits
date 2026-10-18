import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { unknownBasis } from "../types/ceo/commission";
import type { CostsSummary, Sheet } from "../types/ceo/costs";
import {
  type ClosedMonthPay,
  type CostLine,
  closedMonthPay,
  type Payee,
  totalOf,
} from "../types/ceo/costsModel";
import {
  MEASURED_BASES,
  type PayCostRow,
  type PayPlansList,
  planFor,
} from "../types/ceo/payPlan";
import { addDays, daysInMonth } from "../types/ceo/time";
import { type CostsApproval, readHoursCosts } from "./ceoHoursClient";
import { readPayCosts, readPayPlans } from "./ceoPayClient";
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
      // The second commission line (A074), priced beside the first.
      basis2: p.commission2.basis,
      rate2: p.commission2.rate,
      // A basis this build does not know is kept as stored: shown, never saved back.
      ...(unknownBasis(p.commission)
        ? { unknown: unknownBasis(p.commission) as string }
        : {}),
      ...(unknownBasis(p.commission2)
        ? { unknown2: unknownBasis(p.commission2) as string }
        : {}),
    }));
}
/**
 * Team & payroll's pay plans, for Costs (PAY-PLANS.md 8.7): the approved
 * months of the last 3 months and the stored plans. Each is null when it
 * could not be read, and the page says so rather than counting it as $0.
 */
export type CostsPay = {
  costs: PayCostRow[] | null;
  plans: PayPlansList | null;
};

/** The month after `day`'s, as YYYY-MM-01. */
const nextMonth = (day: string) =>
  `${addDays(`${day.slice(0, 7)}-28`, 7).slice(0, 7)}-01`;

/**
 * Next month's pay-plan parts as an estimate: the person's latest approved
 * month's parts, when they follow a plan with parts in `month`. A plan with
 * parts and no approved month gives {month: null, usd: null}: nothing is
 * added and the person is named. Nothing is attached when the plans or the
 * approved months could not be read, or the person has no plan parts.
 */
function withPlanParts<P extends Pick<Payee, "id"> & { role: string | null }>(
  people: P[],
  pay: CostsPay | null | undefined,
  month: string,
): (P & Pick<Payee, "planParts">)[] {
  if (!pay?.plans || !pay.costs) return people;
  const latest = new Map<number, PayCostRow>();
  for (const r of pay.costs) {
    const was = latest.get(r.personId);
    if (!was || r.month > was.month) latest.set(r.personId, r);
  }
  const rows = pay.plans.plans;
  return people.map(p => {
    if (!planFor(rows, p, month).plan?.parts.length) return p;
    const a = latest.get(p.id);
    return {
      ...p,
      planParts: a
        ? { month: a.month, usd: a.partsUsd }
        : { month: null, usd: null },
    };
  });
}

export function costsSummary(
  context: CostContext,
  /** Team & payroll's plans, for each person's latest approved parts; optional. */
  pay?: CostsPay | null,
): CostsSummary {
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
    people: withPlanParts(
      workingPeople(context),
      pay,
      nextMonth(context.today),
    ),
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
  /**
   * Team & payroll's approved commission and parts, added beside base pay
   * (PAY-PLANS.md 8.7). Omitted: base pay only, as before; null: unreadable.
   */
  pay?: CostsPay | null,
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
  // Who Team & payroll expects for the month: a plan with parts, or a line
  // it measures. The browser knows today's roles and lines; the server
  // reads the ones in force that month, so this only names, never counts.
  const plans = pay?.plans ?? null;
  const onPlan = (p: (typeof roster)[number]) =>
    plans === null
      ? undefined
      : Boolean(planFor(plans.plans, p, from).plan?.parts.length) ||
        MEASURED_BASES.has(p.commission.basis) ||
        MEASURED_BASES.has(p.commission2.basis);
  const names = new Map(roster.map(p => [p.id, p.name]));
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
        onPlan: onPlan(p),
      };
    }),
    month,
    pay === undefined
      ? undefined
      : pay?.costs
        ? pay.costs.map(r => ({ ...r, name: names.get(r.personId) }))
        : null,
  );
}

export function buildCostsSheet(
  context: CostContext,
  planId?: number,
  /** Approved months from Hours and pay; null when they could not be read. */
  approvals: CostsApproval[] | null = null,
  /** Team & payroll's pay plans (PAY-PLANS.md 8.7); omitted: base pay and commission lines only. */
  pay?: CostsPay | null,
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
  // The plan's first month, or next month: the month the estimate is for.
  const estimateMonth = plan ? plan.periodFrom : nextMonth(context.today);
  return {
    ready: true,
    lines,
    people: withPlanParts(workingPeople(context), pay, estimateMonth).map(p => {
      const a = approvedLast.get(p.id);
      return {
        ...p,
        approved: a
          ? { month: closed, amountUsd: a.amountUsd, shadow: a.shadow }
          : null,
      };
    }),
    lastMonthPay: approvals
      ? lastMonthPay(context, approvals, closed, pay)
      : null,
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
/** Pay plans never hold the Costs page (or Goals, which reads its payroll) back either: each part unreadable is null. */
export async function payOrNull(
  client: SupabaseClient | null,
): Promise<CostsPay> {
  const [costs, plans] = await Promise.all([
    readPayCosts(client).catch(() => null),
    readPayPlans(client).catch(() => null),
  ]);
  return { costs, plans };
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
  const [context, approvals, pay] = await Promise.all([
    getCostsContext(client),
    approvalsOrNull(client),
    payOrNull(client),
  ]);
  return buildCostsSheet(context, args.planId, approvals, pay);
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
