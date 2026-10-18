import { nameKey, usdWords } from "./manualMatch.ts";

/**
 * Every payment in gets a side of the business, a person and a deal or a
 * client (Aziz, 2026-10-18; contract docs/money/MONEY-ATTRIBUTION.md
 * section 1, which replaces the 2026-09-21 rule that gave the rest of a new
 * deal's cash to the CSM):
 *
 * 1. A deal's money is the closer's. A payment tied to a signed deal counts
 *    from 7 days before the form until the deal's running tied cash reaches
 *    its contract, at most 120 days after signing. It is front end: the
 *    deposit up to the cash the closer typed, then the remainder, credited
 *    to the deal's closer. Beyond the contract or the 120 days it is back
 *    end, the card's CSM's. Renewals follow the same cap.
 * 2. A card match inside a deal's term is that deal's money.
 * 3. The CEO's tie is read first: a payment tie, then a payer tie, then
 *    Whop's own deal link, the payer's email, the name, the card.
 * 4. A payer tie keys on the email or the exact payer key, never a short
 *    name. Anything else is not attributed, and the Transactions tab lists it.
 *
 * The native copy is hermes/ceo-refresh/native/adapters/money.js; both change
 * together, and scripts/money-attribution-parity.test.ts runs them on the same
 * fixtures. Pure: the money adapter loads the rows and this file decides.
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
  /** A card typed on a manual entry. */
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
  /** The closer as written on the form, full name. */
  closer: string | null;
  csm: string | null;
  /** The deposit typed on the form. */
  deposit: number;
  paymentStructure: string | null;
  /** The contract value typed on the form; null when not typed (then the 120 days alone bound the deal). */
  contracted: number | null;
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

/**
 * Text as the native worker cleans it (money.js cleanText): emails and long
 * numbers masked, dashes to commas, spaces collapsed, cut to `max`. Every
 * name the attribution reads (card names, payers, deal businesses, closers)
 * goes through it in both copies, so "Refresh now" writes the same text the
 * 15-minute run does.
 */
export function cleanText(value: unknown, max = 240): string {
  return String(value ?? "")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/\+?\d[\d\s-]{6,}\d/g, m =>
      /^\d{4}-\d{1,2}-\d{1,2}$/.test(m) || m.replace(/\D/g, "").length < 8
        ? m
        : "[number]",
    )
    .replace(/[—–]/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * The client cards attribution matches against, as the native worker builds
 * them (money.js cardReferences): the cards finance/context.ts read (billing
 * first, then aliases), each with its portal login emails and the payers
 * mapped to it by hand. A login or payer row for a card not in the list is
 * left out.
 */
export function cardRefs(
  cards: { taskId: string; names: string[]; csm: string | null }[],
  loginRows: Record<string, unknown>[],
  payerRows: Record<string, unknown>[],
): CardRef[] {
  const byTask = new Map<string, CardRef>(
    cards.map(c => [
      c.taskId,
      { taskId: c.taskId, names: [...c.names], csm: c.csm, emails: [], payerKeys: [] },
    ]),
  );
  const byEmail = new Map<string, string>();
  for (const r of loginRows) {
    const email = lower(r.email);
    const id = String(r.clickup_id ?? r.clickupId ?? "");
    if (email && id) byEmail.set(email, id);
  }
  for (const [email, id] of byEmail) {
    const card = byTask.get(id);
    if (card && !card.emails.includes(email)) card.emails.push(email);
  }
  for (const r of payerRows) {
    const card = byTask.get(String(r.clickup_task_id ?? r.clickupTaskId ?? ""));
    if (!card) continue;
    for (const value of [r.payer_key ?? r.payerKey, r.payer]) {
      const text = cleanText(value, 120);
      if (text && !card.payerKeys.includes(text)) card.payerKeys.push(text);
    }
  }
  return [...byTask.values()].filter(c => c.names.length > 0);
}

/** A live row of cockpit_payment_ties as the finance snapshot gives it. */
export type TieRow = Record<string, unknown>;

/** A CEO tie in one shape: one scope and one target. */
export type Tie = {
  id: number;
  scope: "payment" | "payer";
  paymentId: string | null;
  payerEmail: string | null;
  payerKey: string | null;
  dealResponseId: string | null;
  clickupTaskId: string | null;
  notClient: boolean;
  note: string;
  setBy: string | null;
  setAt: string | null;
};

/** What a tied row carries: which tie, and the CEO's words. */
export type TieRef = Pick<Tie, "id" | "scope" | "note" | "setBy" | "setAt">;

export type Side = "front_end" | "back_end" | "unattributed" | "not_client";
export type Kind = "deposit" | "remainder" | "client" | "none";
export type MatchedBy =
  | "ceo"
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
  /** The part of a front-end payment up to the typed deposit; the rest of it is the remainder. 0 off the front end. */
  depositUsd: number;
  person: string | null;
  personRole: "closer" | "csm" | null;
  dealResponseId: string | null;
  dealBusiness: string | null;
  clientTaskId: string | null;
  clientName: string | null;
  matchedBy: MatchedBy;
  tie: TieRef | null;
};

export type Attributed = PaymentIn & Attribution;

/** A payment this many days before the form can still be that deal's (the form is filled after the call). */
export const BEFORE_FORM_DAYS = 7;
/** A deal's money is the closer's for this many days after signing, up to its contract. */
export const DEAL_TERM_DAYS = 120;

const lower = (s: unknown): string | null => {
  const t = String(s ?? "")
    .trim()
    .toLowerCase();
  return t || null;
};

const oneLine = (s: unknown, max: number): string =>
  String(s ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/** Days from a to b, negative when b is earlier. */
function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000,
  );
}

/** Names long enough that one containing the other is the same business ("ALKHALIL CO." and "Alkhalil"); a payer key must be this long. */
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
  depositUsd: 0,
  person: null,
  personRole: null,
  dealResponseId: null,
  dealBusiness: null,
  clientTaskId: null,
  clientName: null,
  matchedBy: "none",
  tie: null,
};

/** The deal whose form day sits closest to the payment, the form on or before the payment preferred. */
function nearest(deals: DealRef[], day: string): DealRef | null {
  let best: DealRef | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const d of deals) {
    // gap = payment - deal: a form after the payment is fine within a week; further is a worse fit.
    const gap = daysBetween(d.day, day);
    const score = gap >= 0 ? gap : Math.abs(gap) * 10;
    if (score < bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

const pick = (row: TieRow, ...names: string[]): unknown => {
  for (const n of names) if (row?.[n] !== undefined) return row[n];
  return undefined;
};

/**
 * The CEO's ties as the finance snapshot gives them (cockpit_payment_ties,
 * live rows): one scope (a payment, a payer's email, a payer's exact key)
 * and one target (a deal, a card, or not client money). A row without a
 * scope or a target is left out, never guessed. Newest id wins a scope.
 */
export function normalizeTies(rows: TieRow[] | null | undefined): Tie[] {
  const ties: Tie[] = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (pick(row, "cleared_at", "clearedAt")) continue;
    const text = (v: unknown): string | null =>
      v === null || v === undefined || String(v).trim() === ""
        ? null
        : String(v).trim();
    const paymentId = text(pick(row, "payment_id", "paymentId"));
    const payerEmail = lower(pick(row, "payer_email", "payerEmail"));
    const payerKey =
      nameKey(String(pick(row, "payer_key", "payerKey") ?? "")) || null;
    const dealResponseId = text(
      pick(row, "deal_response_id", "dealResponseId"),
    );
    const clickupTaskId = text(pick(row, "clickup_task_id", "clickupTaskId"));
    const notClient = pick(row, "not_client", "notClient") === true;
    const scope = paymentId
      ? "payment"
      : payerEmail || payerKey
        ? "payer"
        : null;
    if (!scope || !(dealResponseId || clickupTaskId || notClient)) continue;
    const setAt = pick(row, "set_at", "setAt");
    const id = Number(pick(row, "id"));
    ties.push({
      id: Number.isFinite(id) ? id : 0,
      scope,
      paymentId,
      payerEmail: paymentId ? null : payerEmail,
      payerKey: paymentId || payerEmail ? null : payerKey,
      dealResponseId,
      clickupTaskId: dealResponseId ? null : clickupTaskId,
      notClient: !dealResponseId && !clickupTaskId && notClient,
      note: oneLine(pick(row, "note"), 500),
      setBy: oneLine(pick(row, "set_by", "setBy"), 120) || null,
      setAt: setAt === null || setAt === undefined ? null : String(setAt),
    });
  }
  return ties.sort((a, b) => a.id - b.id);
}

/**
 * The tie a payment's scope selects (rule 3): its own payment tie, then its
 * payer's email, then its payer's full key. Newest id wins a scope.
 */
function tieLookup(ties: Tie[]): (p: PaymentIn) => Tie | null {
  const byPayment = new Map<string, Tie>();
  const byEmail = new Map<string, Tie>();
  const byKey = new Map<string, Tie>();
  for (const t of ties) {
    if (t.paymentId) byPayment.set(t.paymentId, t);
    else if (t.payerEmail) byEmail.set(t.payerEmail, t);
    else if (t.payerKey && t.payerKey.length >= CONTAINS_MIN)
      byKey.set(t.payerKey, t);
  }
  return p => {
    const email = lower(p.payerEmail);
    const name = nameKey(p.payerName ?? "");
    return (
      byPayment.get(p.id) ??
      (email ? byEmail.get(email) : undefined) ??
      (name.length >= CONTAINS_MIN ? byKey.get(name) : undefined) ??
      null
    );
  };
}

/**
 * A payer tie to a deal covers that payer's money from BEFORE_FORM_DAYS
 * before the deal's form (rule 1): a payment made earlier belongs to an
 * earlier engagement and is left to the automatic match. A tie on the one
 * payment is the CEO's word for that payment and always reaches it.
 */
function tieReaches(tie: Tie, deal: DealRef, p: PaymentIn): boolean {
  return (
    tie.scope === "payment" || daysBetween(deal.day, p.day) >= -BEFORE_FORM_DAYS
  );
}

/**
 * Decide every payment. Payments are taken oldest first so the deposit is
 * the first money against a deal and the remainder is what follows it.
 */
export function attribute(
  payments: PaymentIn[],
  deals: DealRef[],
  cards: CardRef[],
  tieRows: TieRow[] = [],
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
    (lower(d.email)
      ? (cardByEmail.get(lower(d.email) as string) ?? null)
      : null);
  const dealsByCard = new Map<string, DealRef[]>();
  for (const d of deals) {
    const c = cardForDeal(d);
    if (c) dealsByCard.set(c.taskId, [...(dealsByCard.get(c.taskId) ?? []), d]);
  }
  const tieOf = tieLookup(normalizeTies(tieRows));

  const paidAgainst = new Map<string, number>();
  // The contract is open while the tied cash so far is under it; no contract typed, the 120 days alone bound it.
  const contractOpen = (d: DealRef): boolean =>
    !(d.contracted !== null && d.contracted > 0) ||
    (paidAgainst.get(d.responseId) ?? 0) + 0.01 < d.contracted;
  const dealRow = (
    p: PaymentIn,
    deal: DealRef,
    matchedBy: MatchedBy,
    tie: TieRef | null,
  ): Attributed => {
    const days = daysBetween(deal.day, p.day);
    const open = contractOpen(deal);
    const before = paidAgainst.get(deal.responseId) ?? 0;
    paidAgainst.set(deal.responseId, before + p.usd);
    const card = cardForDeal(deal);
    const frontEnd = open && days <= DEAL_TERM_DAYS;
    // Deposit money is still owed while what came before this payment is
    // under the typed deposit; with no deposit typed, the first payment is it.
    const depositOwed =
      deal.deposit > 0 ? before + 0.01 < deal.deposit : before === 0;
    // Only the part up to the typed deposit is deposit: one paid-in-full payment is the deposit and the remainder (rule 1).
    const depositUsd =
      !frontEnd || !depositOwed
        ? 0
        : deal.deposit > 0
          ? Math.min(p.usd, Math.round((deal.deposit - before) * 100) / 100)
          : p.usd;
    return {
      ...p,
      side: frontEnd ? "front_end" : "back_end",
      kind: !frontEnd ? "client" : depositOwed ? "deposit" : "remainder",
      depositUsd,
      // The deal's money is the closer's, full name as written; past the contract or the term, the card's CSM's.
      person: frontEnd
        ? (deal.closer ?? null)
        : (card?.csm ?? deal.csm ?? null),
      personRole: frontEnd ? "closer" : "csm",
      dealResponseId: deal.responseId,
      dealBusiness: deal.business,
      clientTaskId: card?.taskId ?? null,
      clientName: card?.names[0] ?? deal.business,
      matchedBy,
      tie,
    };
  };
  const cardRow = (
    p: PaymentIn,
    card: CardRef,
    matchedBy: MatchedBy,
    tie: TieRef | null,
  ): Attributed => {
    // A card with a deal still in its term: the payment is that deal's money (rule 2).
    const inTerm = (dealsByCard.get(card.taskId) ?? []).filter(d => {
      const days = daysBetween(d.day, p.day);
      return (
        days >= -BEFORE_FORM_DAYS && days <= DEAL_TERM_DAYS && contractOpen(d)
      );
    });
    const deal = nearest(inTerm, p.day);
    if (deal) return dealRow(p, deal, matchedBy, tie);
    return {
      ...p,
      side: "back_end",
      kind: "client",
      depositUsd: 0,
      person: card.csm ?? null,
      personRole: "csm",
      dealResponseId: null,
      dealBusiness: null,
      clientTaskId: card.taskId,
      clientName: card.names[0] ?? null,
      matchedBy,
      tie,
    };
  };

  const out: Attributed[] = [];
  const sorted = [...payments].sort((a, b) =>
    a.day === b.day ? a.id.localeCompare(b.id) : a.day < b.day ? -1 : 1,
  );

  for (const p of sorted) {
    const email = lower(p.payerEmail);
    const name = nameKey(p.payerName ?? "");

    // 0. The CEO's tie: this payment, then every payment from this payer.
    const tie = tieOf(p);
    if (tie) {
      const ref: TieRef = {
        id: tie.id,
        scope: tie.scope,
        note: tie.note,
        setBy: tie.setBy,
        setAt: tie.setAt,
      };
      const tiedDeal = tie.dealResponseId
        ? dealById.get(tie.dealResponseId)
        : undefined;
      const tiedCard = tie.clickupTaskId
        ? cardById.get(tie.clickupTaskId)
        : undefined;
      if (tiedDeal && tieReaches(tie, tiedDeal, p)) {
        out.push(dealRow(p, tiedDeal, "ceo", ref));
        continue;
      }
      if (tiedCard) {
        out.push(cardRow(p, tiedCard, "ceo", ref));
        continue;
      }
      if (tie.notClient) {
        out.push({
          ...p,
          ...NONE,
          side: "not_client",
          matchedBy: "ceo",
          tie: ref,
        });
        continue;
      }
      // A tie to a deal or card this run does not hold, or a payer tie's payment from before its deal, falls back to the automatic match; tieSummary lists it.
    }

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
      out.push(dealRow(p, deal, matchedBy, null));
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
      out.push(cardRow(p, card, matchedBy, null));
      continue;
    }

    out.push({ ...p, ...NONE });
  }
  return out;
}

export type TieSummary = {
  /** Live ties in the snapshot. */
  live: number;
  /** Ties that credited at least one payment this run. */
  applied: number;
  /** Payments a tie credited. */
  payments: number;
  notApplied: {
    id: number;
    scope: Tie["scope"];
    why:
      | "deal_not_in_run"
      | "card_not_in_run"
      | "payer_key_too_short"
      | "before_deal"
      | "no_payment_in_run";
  }[];
  /** Payments a payer tie left to the automatic rules: made more than BEFORE_FORM_DAYS before its deal's form. */
  beforeDeal: {
    id: number;
    scope: Tie["scope"];
    payments: number;
    usd: number;
  }[];
};

/**
 * What became of the CEO's ties this run: how many credited a payment, and
 * each one that did not, with why (its deal or card is not in this run, a
 * payer key too short to be more than a first name, or no payment of this
 * run is in its scope).
 */
export function tieSummary(
  tieRows: TieRow[],
  rows: Attributed[],
  deals: DealRef[],
  cards: CardRef[],
): TieSummary {
  const ties = normalizeTies(tieRows);
  const used = new Map<number, number>();
  for (const r of rows)
    if (r.tie) used.set(r.tie.id, (used.get(r.tie.id) ?? 0) + 1);
  const dealById = new Map(deals.map(d => [d.responseId, d]));
  const cardIds = new Set(cards.map(c => c.taskId));
  // Payments a payer tie left to the automatic rules: made more than BEFORE_FORM_DAYS before its deal's form.
  const tieOf = tieLookup(ties);
  const early = new Map<number, TieSummary["beforeDeal"][number]>();
  for (const r of rows) {
    if (r.tie) continue;
    const t = tieOf(r);
    const deal = t?.dealResponseId ? dealById.get(t.dealResponseId) : undefined;
    if (!t || !deal || tieReaches(t, deal, r)) continue;
    const item = early.get(t.id) ?? {
      id: t.id,
      scope: t.scope,
      payments: 0,
      usd: 0,
    };
    item.payments += 1;
    item.usd += r.usd;
    early.set(t.id, item);
  }
  const notApplied: TieSummary["notApplied"] = [];
  for (const t of ties) {
    if (used.has(t.id)) continue;
    const why =
      t.dealResponseId && !dealById.has(t.dealResponseId)
        ? "deal_not_in_run"
        : t.clickupTaskId && !cardIds.has(t.clickupTaskId)
          ? "card_not_in_run"
          : t.payerKey && t.payerKey.length < CONTAINS_MIN
            ? "payer_key_too_short"
            : early.has(t.id)
              ? "before_deal"
              : "no_payment_in_run";
    notApplied.push({ id: t.id, scope: t.scope, why });
  }
  const beforeDeal = [...early.values()]
    .sort((a, b) => a.id - b.id)
    .map(i => ({ ...i, usd: Math.round(i.usd * 100) / 100 }));
  return {
    live: ties.length,
    applied: used.size,
    payments: [...used.values()].reduce((t, n) => t + n, 0),
    notApplied,
    beforeDeal,
  };
}

/** One row of cockpit_deal_payments: a front-end payment, for payroll and Sales front-end cash. */
export type DealPaymentRow = {
  payment_id: string;
  deal_response_id: string;
  day: string;
  usd: number;
  rail: Rail;
  kind: Kind;
  /** The part of the payment up to the deal's typed deposit. */
  deposit_usd: number;
  matched_by: MatchedBy;
  tie_id: number | null;
  payer: string | null;
};

/** The deal ledger (cockpit_deal_payments): every front-end payment, one row per payment. */
export function dealLedgerRows(rows: Attributed[]): DealPaymentRow[] {
  return rows
    .filter(r => r.side === "front_end" && r.dealResponseId)
    .map(r => ({
      payment_id: r.id,
      deal_response_id: r.dealResponseId as string,
      day: r.day,
      usd: r.usd,
      rail: r.rail,
      kind: r.kind,
      deposit_usd: r.depositUsd,
      matched_by: r.matchedBy,
      tie_id: r.tie?.id ?? null,
      payer: r.payerName ?? null,
    }));
}

/** The attribution rule in words, said beside the figures (the native copy says the same). */
export function attributionRuleText(
  unattributedCount: number,
  unattributedUsd: number,
): string {
  return `Every payment in over the last 12 months is given a side. A payment tied to a signed deal (by your tie, Whop's own link, the payer's email, the business name, or a client card whose deal is still in its term) is front end and the closer's, from ${BEFORE_FORM_DAYS} days before the form until the deal's tied cash reaches its contract, at most ${DEAL_TERM_DAYS} days after signing: the deposit up to what the closer typed, then the remainder. Beyond the contract or the ${DEAL_TERM_DAYS} days it is back end, the card's CSM's, and so is a payment matched only to a client (by a portal login, the hand-kept payer mapping, the card's names or the card typed on a hand-logged entry). Your ties are read before any automatic match. ${unattributedCount === 1 ? "1 payment" : `${unattributedCount} payments`} (${usdWords(unattributedUsd)}) match no deal and no client; the Transactions tab lists every payment in and out.`;
}

const TIE_WHY: Record<TieSummary["notApplied"][number]["why"], string> = {
  deal_not_in_run:
    "its deal is not in this run (voided, or signed before the deals read)",
  card_not_in_run: "its client card is not in this run",
  payer_key_too_short:
    "its payer key is too short to be more than a first name",
  before_deal: `every payment in its scope was made more than ${BEFORE_FORM_DAYS} days before its deal's form`,
  no_payment_in_run: "no payment of the last 12 months is in its scope",
};

/** The ties that credited nothing, and the payments a payer tie left alone, this run, in words (the native copy says the same). */
export function tieNoteText(summary: TieSummary): string {
  const parts: string[] = [];
  const items = summary.notApplied.map(
    i => `tie ${i.id} (${TIE_WHY[i.why] ?? i.why})`,
  );
  if (items.length)
    parts.push(
      `${items.length === 1 ? "1 of your ties" : `${items.length} of your ties`} credited no payment this run: ${items.join("; ")}. The payments they meant are attributed by the automatic rules until the tie is changed or removed.`,
    );
  const early = (summary.beforeDeal ?? []).map(
    i =>
      `tie ${i.id} leaves ${i.payments === 1 ? "1 payment" : `${i.payments} payments`} (${usdWords(i.usd)})`,
  );
  if (early.length)
    parts.push(
      `A payer tie covers that payer's money from ${BEFORE_FORM_DAYS} days before its deal's form; anything paid earlier belongs to an earlier engagement and stays with the automatic rules: ${early.join("; ")}. Tie such a payment on its own if it is that deal's money.`,
    );
  return parts.join(" ");
}

/** Totals over a set of attributed payments. */
export function totals(rows: Attributed[]) {
  const t = {
    in: 0,
    count: rows.length,
    frontEnd: 0,
    deposit: 0,
    remainder: 0,
    backEnd: 0,
    unattributed: 0,
    unattributedCount: 0,
    notClient: 0,
    notClientCount: 0,
  };
  const r2 = (x: number) => Math.round(x * 100) / 100;
  for (const r of rows) {
    t.in += r.usd;
    if (r.side === "front_end") {
      // The deposit is the part of each payment up to the typed deposit; the rest of it is the remainder.
      t.frontEnd += r.usd;
      t.deposit += r.depositUsd;
      t.remainder += r.usd - r.depositUsd;
    } else if (r.side === "back_end") t.backEnd += r.usd;
    else if (r.side === "not_client") {
      t.notClient += r.usd;
      t.notClientCount += 1;
    } else {
      t.unattributed += r.usd;
      t.unattributedCount += 1;
    }
  }
  return {
    in: r2(t.in),
    count: t.count,
    frontEnd: r2(t.frontEnd),
    deposit: r2(t.deposit),
    remainder: r2(t.remainder),
    // The remainder under its old name, kept for screens that still read it.
    kickoff: r2(t.remainder),
    backEnd: r2(t.backEnd),
    unattributed: r2(t.unattributed),
    unattributedCount: t.unattributedCount,
    notClient: r2(t.notClient),
    notClientCount: t.notClientCount,
  };
}

/** Money per person, closers and CSMs, biggest first. */
export function byPerson(rows: Attributed[]) {
  const m = new Map<
    string,
    {
      name: string;
      role: "closer" | "csm";
      frontEnd: number;
      backEnd: number;
      payments: number;
    }
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
