import { nameKey } from "./manualMatch";

/**
 * Every payment in gets a side of the business, a person and a deal or a
 * client (Aziz, 2026-09-21):
 *
 * - The closer's deposit on the New Client Form is front end, the closer's.
 * - The rest of the cash, collected on the onboarding call, is front end,
 *   the CSM's (the CSM named on the deal). The kickoff form that records it
 *   is not read yet, so this is judged from the rails: a payment tied to a
 *   deal inside its front-end window, beyond the deposit, is that cash.
 * - A payment matched to an existing client, by the payer's email or the
 *   business name, is back end, that client's CSM's.
 * - Anything else is not attributed, and the Transactions tab lists it.
 *
 * Pure: the money adapter loads the rows and this file decides. Nothing here
 * reads a database, so the rules can be tested on their own.
 */

export type Rail = "whop" | "tap" | "transfer" | "manual";

/** One payment in, as the rails give it. */
export type PaymentIn = {
  id: string;
  rail: Rail;
  /** Kuwait day the money arrived. */
  day: string;
  usd: number;
  currency: string;
  amount: number;
  payerEmail: string | null;
  payerName: string | null;
  /** Whop's own tie to a closer-form deal, by response id. */
  dealResponseId: string | null;
  /** A card the payer was mapped to by hand, or typed on a manual entry. */
  clickupTaskId: string | null;
  /** Whop's billing reason: one_time, subscription_create, subscription_cycle. */
  billingReason: string | null;
};

/** A closer-form deal. */
export type DealRef = {
  responseId: string;
  /** Kuwait day the form was submitted. */
  day: string;
  email: string | null;
  business: string;
  /** The client's own name on the form, first and last, for payers who pay under their own name. */
  contactName: string | null;
  closer: string | null;
  csm: string | null;
  /** The deposit typed on the form. */
  deposit: number;
  paymentStructure: string | null;
};

/** A ClickUp client card with every name and login it is known by. */
export type CardRef = {
  taskId: string;
  names: string[];
  csm: string | null;
  /** Portal login emails on the card, lower case. */
  emails: string[];
  /** Payer keys mapped to the card by hand (cockpit_payer_clients). */
  payerKeys: string[];
};

export type Side = "front_end" | "back_end" | "unattributed";
export type Kind = "deposit" | "kickoff" | "client" | "none";
export type MatchedBy =
  | "deal_id"
  | "deal_email"
  | "deal_name"
  | "card_email"
  | "card_payer"
  | "card_name"
  | "card_typed"
  | "none";

export type Attribution = {
  side: Side;
  kind: Kind;
  person: string | null;
  personRole: "closer" | "csm" | null;
  dealResponseId: string | null;
  dealBusiness: string | null;
  clientTaskId: string | null;
  clientName: string | null;
  matchedBy: MatchedBy;
};

export type Attributed = PaymentIn & Attribution;

/**
 * How long after signing a payment tied to the deal still counts as front
 * end: the deposit and the rest of the cash on the onboarding call. A deal
 * paid monthly renews sooner, so its window is shorter.
 */
export const FRONT_END_DAYS = 45;
export const FRONT_END_DAYS_MONTHLY = 20;
/** A payment this many days before the form can still be its deposit (the form is filled after the call). */
export const BEFORE_FORM_DAYS = 7;

const MONTHLY = /monthly|month to month|months after|\/month/i;

const first = (s: string | null | undefined): string | null => {
  const t = String(s ?? "").trim();
  return t ? t.split(/\s+/)[0] : null;
};

const lower = (s: string | null | undefined): string | null => {
  const t = String(s ?? "")
    .trim()
    .toLowerCase();
  return t || null;
};

/** Days from a to b, negative when b is earlier. */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

/** Names long enough that one containing the other is the same business ("ALKHALIL CO." and "Alkhalil"). */
const CONTAINS_MIN = 6;

/**
 * A key that equals one of the known keys, or, when both are long enough,
 * contains one or is contained by one. Exact wins; among containments the
 * longest shared key wins.
 */
function lookup<T>(index: Map<string, T>, key: string): T | null {
  if (!key) return null;
  const exact = index.get(key);
  if (exact !== undefined) return exact;
  if (key.length < CONTAINS_MIN) return null;
  let best: T | null = null;
  let bestLen = 0;
  for (const [k, v] of index) {
    if (k.length < CONTAINS_MIN) continue;
    if ((key.includes(k) || k.includes(key)) && k.length > bestLen) {
      best = v;
      bestLen = k.length;
    }
  }
  return best;
}

const NONE: Attribution = {
  side: "unattributed",
  kind: "none",
  person: null,
  personRole: null,
  dealResponseId: null,
  dealBusiness: null,
  clientTaskId: null,
  clientName: null,
  matchedBy: "none",
};

/** The deal whose form day sits closest to the payment, the form on or before the payment preferred. */
function nearest(deals: DealRef[], day: string): DealRef | null {
  let best: DealRef | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const d of deals) {
    const gap = daysBetween(d.day, day);
    // A form after the payment is fine within a week; further is a worse fit.
    const score = gap >= 0 ? gap : Math.abs(gap) * 10;
    if (score < bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Decide every payment. Payments are taken oldest first so the deposit is
 * the first money against a deal and the rest is what follows it.
 */
export function attribute(
  payments: PaymentIn[],
  deals: DealRef[],
  cards: CardRef[],
): Attributed[] {
  const dealById = new Map<string, DealRef>();
  const dealsByEmail = new Map<string, DealRef[]>();
  const dealsByName = new Map<string, DealRef[]>();
  for (const d of deals) {
    dealById.set(d.responseId, d);
    const e = lower(d.email);
    if (e) dealsByEmail.set(e, [...(dealsByEmail.get(e) ?? []), d]);
    const k = nameKey(d.business);
    if (k.length >= 4) dealsByName.set(k, [...(dealsByName.get(k) ?? []), d]);
    const c = nameKey(d.contactName ?? "");
    if (c.length >= CONTAINS_MIN)
      dealsByName.set(c, [...(dealsByName.get(c) ?? []), d]);
  }
  const cardById = new Map<string, CardRef>();
  const cardByEmail = new Map<string, CardRef>();
  const cardByPayer = new Map<string, CardRef>();
  const cardByName = new Map<string, CardRef>();
  for (const c of cards) {
    cardById.set(c.taskId, c);
    for (const e of c.emails) {
      const k = lower(e);
      if (k) cardByEmail.set(k, c);
    }
    for (const p of c.payerKeys) {
      const k = nameKey(p);
      if (k) cardByPayer.set(k, c);
    }
    for (const n of c.names) {
      const k = nameKey(n);
      if (k.length >= 4) cardByName.set(k, c);
    }
  }
  const cardForDeal = (d: DealRef): CardRef | null =>
    lookup(cardByName, nameKey(d.business)) ??
    (lower(d.email) ? (cardByEmail.get(lower(d.email) as string) ?? null) : null);

  const paidAgainst = new Map<string, number>();
  const out: Attributed[] = [];
  const sorted = [...payments].sort((a, b) =>
    a.day === b.day ? a.id.localeCompare(b.id) : a.day < b.day ? -1 : 1,
  );

  for (const p of sorted) {
    const email = lower(p.payerEmail);
    const name = nameKey(p.payerName ?? "");

    // 1. A deal: by Whop's own tie, then the payer's email, then the business name.
    let deal: DealRef | null = null;
    let matchedBy: MatchedBy = "none";
    if (p.dealResponseId && dealById.has(p.dealResponseId)) {
      deal = dealById.get(p.dealResponseId) ?? null;
      matchedBy = "deal_id";
    } else if (email && dealsByEmail.has(email)) {
      deal = nearest(dealsByEmail.get(email) ?? [], p.day);
      matchedBy = "deal_email";
    } else if (name.length >= 4 && lookup(dealsByName, name)) {
      deal = nearest(lookup(dealsByName, name) ?? [], p.day);
      matchedBy = "deal_name";
    }
    // A payment well before the form belongs to an earlier engagement.
    if (deal && daysBetween(deal.day, p.day) < -BEFORE_FORM_DAYS) {
      deal = null;
      matchedBy = "none";
    }

    if (deal) {
      const days = daysBetween(deal.day, p.day);
      const window = MONTHLY.test(deal.paymentStructure ?? "")
        ? FRONT_END_DAYS_MONTHLY
        : FRONT_END_DAYS;
      const before = paidAgainst.get(deal.responseId) ?? 0;
      paidAgainst.set(deal.responseId, before + p.usd);
      const card = cardForDeal(deal);
      const renewal = p.billingReason === "subscription_cycle";
      // Deposit money is still owed while what came before this payment is
      // under the typed deposit; with no deposit typed, the first payment is it.
      const depositOwed =
        deal.deposit > 0 ? before + 0.01 < deal.deposit : before === 0;
      if (!renewal && days <= window && depositOwed) {
        // The first money against the deal, up to the deposit: the closer's.
        out.push({
          ...p,
          side: "front_end",
          kind: "deposit",
          person: first(deal.closer),
          personRole: "closer",
          dealResponseId: deal.responseId,
          dealBusiness: deal.business,
          clientTaskId: card?.taskId ?? null,
          clientName: card?.names[0] ?? deal.business,
          matchedBy,
        });
      } else if (!renewal && days <= window) {
        // What follows the deposit inside the window: the rest of the cash, the CSM's.
        out.push({
          ...p,
          side: "front_end",
          kind: "kickoff",
          person: first(deal.csm) ?? first(card?.csm),
          personRole: "csm",
          dealResponseId: deal.responseId,
          dealBusiness: deal.business,
          clientTaskId: card?.taskId ?? null,
          clientName: card?.names[0] ?? deal.business,
          matchedBy,
        });
      } else {
        out.push({
          ...p,
          side: "back_end",
          kind: "client",
          person: first(card?.csm) ?? first(deal.csm),
          personRole: "csm",
          dealResponseId: deal.responseId,
          dealBusiness: deal.business,
          clientTaskId: card?.taskId ?? null,
          clientName: card?.names[0] ?? deal.business,
          matchedBy,
        });
      }
      continue;
    }

    // 2. A client card: by a portal login, a hand mapping, the business name, or the card typed on a manual entry.
    let card: CardRef | null = null;
    if (email && cardByEmail.has(email)) {
      card = cardByEmail.get(email) ?? null;
      matchedBy = "card_email";
    } else if (name && cardByPayer.has(name)) {
      card = cardByPayer.get(name) ?? null;
      matchedBy = "card_payer";
    } else if (name.length >= 4 && lookup(cardByName, name)) {
      card = lookup(cardByName, name);
      matchedBy = "card_name";
    } else if (p.clickupTaskId && cardById.has(p.clickupTaskId)) {
      card = cardById.get(p.clickupTaskId) ?? null;
      matchedBy = "card_typed";
    }
    if (card) {
      out.push({
        ...p,
        side: "back_end",
        kind: "client",
        person: first(card.csm),
        personRole: "csm",
        dealResponseId: null,
        dealBusiness: null,
        clientTaskId: card.taskId,
        clientName: card.names[0] ?? null,
        matchedBy,
      });
      continue;
    }

    out.push({ ...p, ...NONE });
  }
  return out;
}

/** Totals over a set of attributed payments. */
export function totals(rows: Attributed[]) {
  const t = {
    in: 0,
    count: rows.length,
    frontEnd: 0,
    deposit: 0,
    kickoff: 0,
    backEnd: 0,
    unattributed: 0,
    unattributedCount: 0,
  };
  const r2 = (x: number) => Math.round(x * 100) / 100;
  for (const r of rows) {
    t.in += r.usd;
    if (r.side === "front_end") {
      t.frontEnd += r.usd;
      if (r.kind === "deposit") t.deposit += r.usd;
      else t.kickoff += r.usd;
    } else if (r.side === "back_end") t.backEnd += r.usd;
    else {
      t.unattributed += r.usd;
      t.unattributedCount += 1;
    }
  }
  return {
    in: r2(t.in),
    count: t.count,
    frontEnd: r2(t.frontEnd),
    deposit: r2(t.deposit),
    kickoff: r2(t.kickoff),
    backEnd: r2(t.backEnd),
    unattributed: r2(t.unattributed),
    unattributedCount: t.unattributedCount,
  };
}

/** Money per person, closers and CSMs, biggest first. */
export function byPerson(rows: Attributed[]) {
  const m = new Map<
    string,
    { name: string; role: "closer" | "csm"; frontEnd: number; backEnd: number; payments: number }
  >();
  for (const r of rows) {
    if (!r.person || !r.personRole) continue;
    const key = `${r.personRole}:${r.person.toLowerCase()}`;
    const row = m.get(key) ?? {
      name: r.person,
      role: r.personRole,
      frontEnd: 0,
      backEnd: 0,
      payments: 0,
    };
    if (r.side === "front_end") row.frontEnd += r.usd;
    else if (r.side === "back_end") row.backEnd += r.usd;
    row.payments += 1;
    m.set(key, row);
  }
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return [...m.values()]
    .map(x => ({ ...x, frontEnd: r2(x.frontEnd), backEnd: r2(x.backEnd) }))
    .sort((a, b) => b.frontEnd + b.backEnd - (a.frontEnd + a.backEnd));
}
