import { v } from "convex/values";
import { internalQuery, type MutationCtx } from "../_generated/server";
import { USD_PER } from "./data/tap";

/**
 * The billing and lifecycle fields on the Clients - Mahara cards, lifted off
 * the tasks the CSM sync already fetches and kept in `ceoClientBilling`.
 *
 * Why this exists. Until 2026-09-18 nothing in the codebase read any of these
 * fields, so what a client pays, how they pay it, when they paused and when
 * they left were recorded in ClickUp and read by nobody. ClickUp keeps no
 * field history, so the day somebody retypes the MRR field the old number is
 * gone. Storing a row here on every sync is what gives those fields a past.
 *
 * What this is not. None of these numbers is a measurement. Every one of them
 * is something a person typed on a card, and most of them are typed on very
 * few cards. The adapter that reads this table says so on every figure it
 * shows, and the coverage counts below exist so that it can.
 */

/** Client card field ids on list 901816559981 (Clients - Mahara). */
export const CFB = {
  mrr: "48eb6023-8944-4404-9e30-b01fc8a38256",
  ltv: "11d70e58-20e7-4ff0-85c6-51de42f044d2",
  nextPaymentAmount: "f071ee8f-b7ce-49e8-899b-6bef649d86ba",
  nextPaymentDate: "669ae046-bf82-4b59-80d5-bf25d6b57ef3",
  paymentPlan: "17d17129-43c4-441b-a55c-6eca83b9f776",
  paymentMethod: "665e5754-b9c6-4776-9386-111ad221dead",
  contractStatus: "ac976d4a-409b-441c-8c13-4b0e73a0c12f",
  nextContractRenewal: "eaa2caf3-899d-4072-beb3-72ef3c0427f1",
  signupDate: "03968cf6-dac1-43b6-8f02-cef999af2bbb",
  launchDate: "2e744484-f581-4c37-962a-023c4de23729",
  pausedOn: "930c49eb-9374-410c-801f-9aa81fff4944",
  churnDate: "42429a6e-5cba-4a3b-964d-2b493315421b",
  churnReason: "796f25e7-7e63-4d08-9ec4-41c58a5b57ca",
  churnType: "a121f39a-f8a4-41f5-905e-a735ee729071",
  closer: "63af118b-bb16-48ba-9ddb-d0185b32fb23",
  leadSource: "e993c247-2b0e-4543-bcd8-7e1ed02f65fa",
  status: "9368ca9e-3549-4320-84ff-9abd0a2901cb",
} as const;

/**
 * Payment plans that are not monthly money. A client on one of these has a
 * figure in the MRR field that is a share of a one-off contract, so adding it
 * to a real monthly subscriber's MRR mixes two different kinds of money. The
 * adapter reports the two apart rather than picking one, because nobody has
 * decided how a paid-in-full contract converts to MRR.
 */
const ONE_OFF_PLAN = /paid\s*in\s*full|split\s*pay|one\s*[- ]?off|upfront/i;

/** The row this module stores for one client card. */
export type BillingRow = {
  taskId: string;
  name: string;
  taskUrl?: string;
  stage?: string;
  mrrUsd?: number;
  ltvUsd?: number;
  nextPaymentAmountUsd?: number;
  currency?: string;
  nextPaymentDate?: string;
  signupDate?: string;
  launchDate?: string;
  pausedOn?: string;
  churnDate?: string;
  nextContractRenewal?: string;
  paymentPlan?: string;
  paymentMethod?: string;
  contractStatus?: string;
  churnReason?: string;
  churnType?: string;
  closer?: string;
  leadSource?: string;
  syncedAt: number;
};

/** True when this plan's money is a one-off contract rather than a subscription. */
export const isOneOffPlan = (plan: string | undefined): boolean =>
  ONE_OFF_PLAN.test(String(plan ?? ""));

/** A raw ClickUp task, as the API returns it. */
// biome-ignore lint/suspicious/noExplicitAny: ClickUp payload
type Task = any;

/** One custom field on a task, by field id. */
const fieldOf = (task: Task, id: string): Task =>
  (task?.custom_fields ?? []).find((c: Task) => c.id === id);

/** A dropdown's label, by option id or by order index. Blank reads as unset. */
function label(task: Task, id: string): string | undefined {
  const f = fieldOf(task, id);
  if (!f || f.value === undefined || f.value === null || f.value === "")
    return undefined;
  const opts: Task[] = f.type_config?.options ?? [];
  const hit =
    opts.find(o => o.id === f.value) ??
    opts.find(o => String(o.orderindex) === String(f.value));
  return hit?.name ?? undefined;
}

/** A plain text or short-text field, trimmed. Blank reads as unset. */
function text(task: Task, id: string): string | undefined {
  const raw = fieldOf(task, id)?.value;
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  return t === "" ? undefined : t;
}

/** A ClickUp date field (epoch ms) as a Kuwait day, YYYY-MM-DD. */
function day(task: Task, id: string): string | undefined {
  const n = Number(fieldOf(task, id)?.value);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return new Date(n + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * A money field in USD, plus the currency the field declared.
 *
 * ClickUp currency fields carry their own currency in `type_config`, so the
 * rate is never guessed: an unknown currency returns no number at all rather
 * than a figure converted at 1. The table is the fixed one the rest of the
 * cockpit uses, so a dollar means the same thing on every screen.
 */
function money(
  task: Task,
  id: string,
): { usd?: number; currency?: string; unknownCurrency?: string } {
  const f = fieldOf(task, id);
  if (!f) return {};
  const n = Number(f.value);
  if (!Number.isFinite(n) || n === 0) return {};
  const currency = String(f.type_config?.currency_type ?? "USD").toUpperCase();
  const rate = USD_PER[currency];
  if (rate === undefined) return { currency, unknownCurrency: currency };
  return { usd: Math.round(n * rate * 100) / 100, currency };
}

/**
 * Turn the raw Clients - Mahara tasks into billing rows.
 *
 * Every card is kept. The CSM roster drops Stopped and Cancelled cards and
 * cards with no stage, which is right for a CSM's day and wrong here: a churn
 * date only exists on a card that has already left.
 *
 * Returns the rows plus anything that could not be read, so the adapter can
 * say what it did not manage to convert instead of quietly showing less money.
 */
export function billingRows(
  tasks: Task[],
  now: number,
): { rows: BillingRow[]; unknownCurrencies: string[] } {
  const rows: BillingRow[] = [];
  const unknown = new Set<string>();
  for (const t of tasks ?? []) {
    const taskId = String(t?.id ?? "");
    if (!taskId) continue;
    const mrr = money(t, CFB.mrr);
    const ltv = money(t, CFB.ltv);
    const next = money(t, CFB.nextPaymentAmount);
    for (const c of [mrr, ltv, next])
      if (c.unknownCurrency) unknown.add(c.unknownCurrency);
    rows.push({
      taskId,
      name: String(t?.name ?? "").trim() || `ClickUp card ${taskId}`,
      taskUrl: typeof t?.url === "string" ? t.url : undefined,
      stage: label(t, CFB.status),
      mrrUsd: mrr.usd,
      ltvUsd: ltv.usd,
      nextPaymentAmountUsd: next.usd,
      currency: mrr.currency ?? ltv.currency ?? next.currency,
      nextPaymentDate: day(t, CFB.nextPaymentDate),
      signupDate: day(t, CFB.signupDate),
      launchDate: day(t, CFB.launchDate),
      pausedOn: day(t, CFB.pausedOn),
      churnDate: day(t, CFB.churnDate),
      nextContractRenewal: day(t, CFB.nextContractRenewal),
      paymentPlan: label(t, CFB.paymentPlan),
      paymentMethod: label(t, CFB.paymentMethod),
      contractStatus: label(t, CFB.contractStatus),
      churnReason: label(t, CFB.churnReason) ?? text(t, CFB.churnReason),
      churnType: label(t, CFB.churnType),
      closer: label(t, CFB.closer) ?? text(t, CFB.closer),
      leadSource: label(t, CFB.leadSource) ?? text(t, CFB.leadSource),
      syncedAt: now,
    });
  }
  return { rows, unknownCurrencies: [...unknown].sort() };
}

/** Stages where the client has gone. */
const GONE = new Set(["Stopped", "CANCELLED ONBOARDING"]);

/**
 * A card parked on the sales list, not a client. Eleven of these are clients
 * the payment sheet already marks cancelled, still sitting in the sales stage
 * (CEO_SOURCES_OF_TRUTH.md, 2026-09-16). The CSM roster drops the whole stage
 * for the same reason. They are counted in their own group here rather than
 * dropped, so the card count still adds up to the board.
 */
const SALES_STAGE = "SALES TEAM TO CONTACT";

/**
 * Cards that are Mahara's own, not a client: the playing account and the
 * lifecycle test card. They are kept in the table, because the test card is
 * the only card in ClickUp with a churn date and dropping it would hide that,
 * but they never count as a client missing a figure.
 */
const INTERNAL_CARD = /playing account|\[internal test\]/i;

export const isInternalCard = (name: string): boolean =>
  INTERNAL_CARD.test(name);

/**
 * Which group a card's money belongs to. Deliberately five groups, not one
 * "paying clients" total: the rule for who counts as a client is Aziz's to
 * settle (CEO_SOURCES_OF_TRUTH.md, decision 2, still open on 2026-09-18) and
 * a screen that adds them up would be answering it for him. Reported apart,
 * every candidate rule can be worked out from the same five numbers.
 */
export type BillingGroup = "active" | "paused" | "pipeline" | "sales" | "gone";

/** The groups that are a client on the books today, in screen order. */
export const LIVE_GROUPS = ["active", "paused", "pipeline"] as const;

export const groupOf = (stage: string | undefined): BillingGroup =>
  stage === "Active"
    ? "active"
    : stage === "Paused"
      ? "paused"
      : GONE.has(String(stage ?? ""))
        ? "gone"
        : String(stage ?? "") === SALES_STAGE
          ? "sales"
          : "pipeline";

/** One group's MRR field total, and how much of it is not monthly money. */
export type MrrGroup = {
  cards: number;
  /** Cards in this group with a figure in the MRR field. */
  filled: number;
  /** Every MRR figure in this group added up. Mixes subscriptions with one-off plans. */
  bookUsd: number;
  /** The part on a plan that is a real monthly subscription. */
  recurringUsd: number;
  /** The part on a Paid In Full or Split Pay plan: a share of a one-off contract, not monthly money. */
  oneOffUsd: number;
  /** The part on a card whose Payment Plan is blank, so it cannot be sorted into either. */
  unclassifiedUsd: number;
};

export type BillingSummary = {
  cards: number;
  mrr: Record<BillingGroup, MrrGroup>;
  /**
   * Live cards (active, paused or pipeline) with no MRR figure at all. Sales
   * list cards and Mahara's own internal cards are left out: neither is a
   * client whose money is missing.
   */
  mrrBlank: { taskId: string; name: string; stage?: string }[];
  /** Mahara's own cards, counted so the group totals still reconcile to the board. */
  internalCards: number;
  ltv: { filled: number; totalUsd: number };
  paymentMethod: { filled: number; mix: { method: string; cards: number }[] };
  lifecycle: {
    gone: number;
    goneWithChurnDate: number;
    goneWithChurnReason: number;
    paused: number;
    pausedWithDate: number;
    /** Live cards carrying a Next Contract Renewal date. */
    withRenewalDate: number;
  };
  syncedAt: number | null;
};

const zero = (): MrrGroup => ({
  cards: 0,
  filled: 0,
  bookUsd: 0,
  recurringUsd: 0,
  oneOffUsd: 0,
  unclassifiedUsd: 0,
});

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * Add the billing rows up, by group, without deciding anything.
 *
 * Nothing here converts a one-off contract into monthly money: how a Paid In
 * Full or Split Pay contract becomes MRR is undecided, so the shares are
 * reported separately and the screen says which is which.
 */
export function summariseBilling(rows: BillingRow[]): BillingSummary {
  const mrr: Record<BillingGroup, MrrGroup> = {
    active: zero(),
    paused: zero(),
    pipeline: zero(),
    sales: zero(),
    gone: zero(),
  };
  const mrrBlank: BillingSummary["mrrBlank"] = [];
  const methods = new Map<string, number>();
  let ltvFilled = 0;
  let ltvTotal = 0;
  let methodFilled = 0;
  let gone = 0;
  let goneWithChurnDate = 0;
  let goneWithChurnReason = 0;
  let paused = 0;
  let pausedWithDate = 0;
  let withRenewalDate = 0;
  let internalCards = 0;
  let syncedAt: number | null = null;

  for (const r of rows) {
    const g = groupOf(r.stage);
    if (isInternalCard(r.name)) internalCards += 1;
    const bucket = mrr[g];
    bucket.cards += 1;
    if (typeof r.mrrUsd === "number") {
      bucket.filled += 1;
      bucket.bookUsd += r.mrrUsd;
      if (r.paymentPlan === undefined) bucket.unclassifiedUsd += r.mrrUsd;
      else if (isOneOffPlan(r.paymentPlan)) bucket.oneOffUsd += r.mrrUsd;
      else bucket.recurringUsd += r.mrrUsd;
    } else if (
      (LIVE_GROUPS as readonly string[]).includes(g) &&
      !isInternalCard(r.name)
    ) {
      mrrBlank.push({ taskId: r.taskId, name: r.name, stage: r.stage });
    }
    if (typeof r.ltvUsd === "number") {
      ltvFilled += 1;
      ltvTotal += r.ltvUsd;
    }
    if (r.paymentMethod) {
      methodFilled += 1;
      methods.set(r.paymentMethod, (methods.get(r.paymentMethod) ?? 0) + 1);
    }
    if (g === "gone") {
      gone += 1;
      if (r.churnDate) goneWithChurnDate += 1;
      if (r.churnReason) goneWithChurnReason += 1;
    }
    if (g === "paused") {
      paused += 1;
      if (r.pausedOn) pausedWithDate += 1;
    }
    if (g !== "gone" && r.nextContractRenewal) withRenewalDate += 1;
    if (syncedAt === null || r.syncedAt > syncedAt) syncedAt = r.syncedAt;
  }

  for (const b of Object.values(mrr)) {
    b.bookUsd = round2(b.bookUsd);
    b.recurringUsd = round2(b.recurringUsd);
    b.oneOffUsd = round2(b.oneOffUsd);
    b.unclassifiedUsd = round2(b.unclassifiedUsd);
  }

  return {
    cards: rows.length,
    mrr,
    mrrBlank: mrrBlank.sort((a, b) => a.name.localeCompare(b.name)),
    internalCards,
    ltv: { filled: ltvFilled, totalUsd: round2(ltvTotal) },
    paymentMethod: {
      filled: methodFilled,
      mix: [...methods.entries()]
        .map(([method, cards]) => ({ method, cards }))
        .sort((a, b) => b.cards - a.cards || a.method.localeCompare(b.method)),
    },
    lifecycle: {
      gone,
      goneWithChurnDate,
      goneWithChurnReason,
      paused,
      pausedWithDate,
      withRenewalDate,
    },
    syncedAt,
  };
}

/**
 * Replace the billing table with this sync's rows.
 *
 * A card that has gone from the list is dropped here, exactly as it is from
 * the `clients` table. Its history is not lost with it: the daily points the
 * money adapter writes are keyed by task id and stay behind.
 *
 * An empty `rows` is ignored rather than obeyed. The only way the sync
 * produces no cards at all is a failed ClickUp fetch, and emptying the table
 * on that would turn an outage into "every client pays nothing".
 */
export async function writeBilling(
  ctx: MutationCtx,
  rows: BillingRow[],
): Promise<{ stored: number; kept: boolean }> {
  const existing = await ctx.db.query("ceoClientBilling").collect();
  if (rows.length === 0)
    return { stored: existing.length, kept: existing.length > 0 };
  for (const row of existing) await ctx.db.delete(row._id);
  for (const r of rows) await ctx.db.insert("ceoClientBilling", r);
  return { stored: rows.length, kept: false };
}

/** Every billing row, for the CEO money adapter. */
export const allBilling = internalQuery({
  args: {},
  returns: v.array(v.any()),
  handler: async ctx => await ctx.db.query("ceoClientBilling").collect(),
});
