import { B2B, TRIAGE, num, sql } from "../sb.js";
import { addDays, daysInMonth, KUWAIT_OFFSET_MS, kuwaitDay, monthStart } from "../time.js";
import { bankCanBe, amountGap, coverWithTap, cashDuplicates, dealDuplicates, MATCH_DAYS, MATCH_GAP, nameBook, usdWords } from "../manualMatch.js";
import { groupOf, isOneOffPlan, summariseBilling } from "../billing.js";
import { linkCtrTargetNote, targetItems } from "../../../../supabase/functions/cockpit-ceo-api/finance/targets.ts";
import { MEDIA_FEED_SQL, MEDIA_STALE_MS, mediaClientDaysSql, mediaFeedFresh } from "../data/triage.js";

const STALE_MS = 60 * 60_000;
const TAP_STALE_MS = 3 * 60 * 60_000;
const ECOM_STALE_MS = 60 * 60_000;
const BANK_STALE_DAYS = 7;
const MANUAL_CAP = 5000;
const ROUND2 = value => Math.round(value * 100) / 100;

function failSource(name, reason) {
  throw new Error(`${name} is not confirmed: ${reason}`);
}

function field(row, ...names) {
  for (const name of names) if (row?.[name] !== undefined) return row[name];
  return undefined;
}

function epoch(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Date.parse(String(value));
  return Number.isFinite(number) ? number : null;
}

function dateText(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value ?? "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : text.slice(0, 10);
}

function monthShift(month, delta) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + delta, 1)).toISOString().slice(0, 7);
}


function dayStart(day) {
  return new Date(`${day}T00:00:00Z`).getTime() - KUWAIT_OFFSET_MS;
}

/** Text cleaned for the cockpit: emails and long numbers masked, dashes to commas, spaces collapsed. The Edge copy is finance/attribution.ts cleanText. */
export function cleanText(value, max = 240) {
  return String(value ?? "")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/\+?\d[\d\s-]{6,}\d/g, match => /^\d{4}-\d{1,2}-\d{1,2}$/.test(match) || match.replace(/\D/g, "").length < 8 ? match : "[number]")
    .replace(/[—–]/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function addSource(sources, name, stamp, now, maxAge = STALE_MS) {
  const at = epoch(stamp);
  const ok = at !== null && now - at >= -60_000 && now - at <= maxAge;
  const note = ok ? undefined : at === null ? "No successful source timestamp is recorded" : "Source timestamp is stale or in the future";
  sources.push({ name, freshestAt: at ?? undefined, ok, note });
  if (!ok) failSource(name, note);
}


function monthWindow(day) {
  const month = day.slice(0, 7);
  const dayOfMonth = Number(day.slice(8, 10));
  const dim = daysInMonth(day);
  const lastMonth = monthShift(month, -1);
  const lastMonthEndDay = Math.min(dayOfMonth, daysInMonth(`${lastMonth}-01`));
  return {
    month,
    dayOfMonth,
    dim,
    lastMonth,
    lastMonthStart: `${lastMonth}-01`,
    lastMonthToDateEnd: `${lastMonth}-${String(lastMonthEndDay).padStart(2, "0")}`,
    lastMonthEnd: addDays(monthStart(day), -1),
    from180: addDays(day, -179),
    from90: addDays(day, -89),
    from12: `${monthShift(month, -11)}-01`,
  };
}

function normalizeManual(row) {
  const addedAt = epoch(field(row, "addedAt", "added_at"));
  const deletedAt = epoch(field(row, "deletedAt", "deleted_at"));
  return {
    id: String(field(row, "id") ?? ""),
    day: dateText(field(row, "day")),
    amount: num(field(row, "amount")),
    currency: String(field(row, "currency") ?? "USD"),
    amountUsd: num(field(row, "amountUsd", "amount_usd")),
    client: cleanText(field(row, "client", "client_name"), 120),
    clickupTaskId: field(row, "clickupTaskId", "clickup_task_id") ? String(field(row, "clickupTaskId", "clickup_task_id")) : null,
    rail: String(field(row, "rail") ?? "other"),
    kind: String(field(row, "kind") ?? "payment"),
    dealContracted: field(row, "dealContracted", "deal_contracted") == null ? null : num(field(row, "dealContracted", "deal_contracted")),
    dealContractedUsd: field(row, "dealContractedUsd", "deal_contracted_usd") == null ? null : num(field(row, "dealContractedUsd", "deal_contracted_usd")),
    note: field(row, "note") == null ? null : cleanText(field(row, "note"), 300),
    addedBy: cleanText(field(row, "addedBy", "added_by") ?? "unknown", 60),
    addedAt: addedAt ?? 0,
    deletedAt,
    deletedBy: field(row, "deletedBy", "deleted_by") == null ? null : cleanText(field(row, "deletedBy", "deleted_by"), 60),
  };
}

function normalizeBankLine(row) {
  return {
    id: num(field(row, "id")),
    day: dateText(field(row, "day")),
    usd: num(field(row, "usd")),
    amount: num(field(row, "amount")),
    currency: String(field(row, "currency") ?? "KWD"),
    reference: cleanText(field(row, "reference") ?? "", 160),
    account: cleanText(field(row, "account") ?? "", 80),
    accountKind: String(field(row, "account_kind", "accountKind") ?? "account"),
    kind: String(field(row, "kind") ?? "unknown"),
    baseKind: String(field(row, "base_kind", "baseKind") ?? field(row, "kind") ?? "unknown"),
    category: field(row, "category") == null ? null : String(field(row, "category")),
    matchedRef: field(row, "matched_ref", "matchedRef") == null ? null : String(field(row, "matched_ref", "matchedRef")),
    matchedUsd: field(row, "matched_usd", "matchedUsd") == null ? null : num(field(row, "matched_usd", "matchedUsd")),
    note: field(row, "note") == null ? null : cleanText(field(row, "note"), 240),
    manualKind: field(row, "manual_kind", "manualKind") === true,
  };
}

function rowsFor(snapshot, name) {
  const value = snapshot?.[name];
  if (!Array.isArray(value)) throw new Error(`Canonical finance snapshot is missing ${name}`);
  return value;
}

/**
 * The client cards attribution matches against: every billing card first (a
 * new client is on billing before it has an alias row), then the alias names,
 * with portal logins and the hand-kept payer mapping. The Edge copy builds the
 * same list (finance/context.ts, then attribution.ts cardRefs); the parity
 * test runs both.
 */
export function cardReferences(snapshot, loginRows) {
  const byTask = new Map();
  const add = (taskId, name, aliases, csm) => {
    if (!taskId) return;
    const id = String(taskId);
    const card = byTask.get(id) ?? { taskId: id, names: [], csm: null, emails: [], payerKeys: [] };
    for (const value of [name, ...(Array.isArray(aliases) ? aliases : [])]) {
      const text = cleanText(value, 120);
      if (text && !card.names.includes(text)) card.names.push(text);
    }
    if (csm && !card.csm) card.csm = String(csm).trim().split(/\s+/)[0] || null;
    byTask.set(id, card);
  };
  for (const row of rowsFor(snapshot, "billing")) {
    add(field(row, "clickup_task_id", "clickupTaskId"), field(row, "client_name", "name"), [], field(row, "csm"));
  }
  for (const row of rowsFor(snapshot, "aliases")) {
    add(field(row, "task_id", "taskId"), field(row, "name"), field(row, "aliases"), field(row, "csm"));
  }
  const byEmail = new Map();
  for (const row of loginRows) {
    const email = String(row.email ?? "").trim().toLowerCase();
    const id = String(row.clickup_id ?? row.clickupId ?? "");
    if (!email || !id) continue;
    byEmail.set(email, id);
  }
  for (const [email, id] of byEmail) {
    const card = byTask.get(id);
    if (card && !card.emails.includes(email)) card.emails.push(email);
  }
  for (const row of rowsFor(snapshot, "payers")) {
    const id = String(field(row, "clickup_task_id", "clickupTaskId") ?? "");
    const card = byTask.get(id);
    if (!card) continue;
    for (const value of [field(row, "payer_key", "payerKey"), field(row, "payer")]) {
      const text = cleanText(value, 120);
      if (text && !card.payerKeys.includes(text)) card.payerKeys.push(text);
    }
  }
  return [...byTask.values()].filter(card => card.names.length > 0);
}

function dayGap(first, second) {
  return Math.round(Math.abs(Date.parse(`${first}T00:00:00Z`) - Date.parse(`${second}T00:00:00Z`)) / 86_400_000);
}

function nameKey(value) {
  return String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

/*
 * Who every payment in is credited to (Aziz, 2026-10-18; contract
 * docs/money/MONEY-ATTRIBUTION.md section 1). The Edge copy is
 * supabase/functions/cockpit-ceo-api/finance/attribution.ts; both change
 * together and scripts/money-attribution-parity.test.ts runs them on the
 * same fixtures.
 *
 * 1. A deal's money is the closer's: a payment tied to a signed deal counts
 *    from 7 days before the form until the deal's running tied cash reaches
 *    its contract, at most 120 days after signing. It is front end, the
 *    deposit up to the typed cash collected and the remainder after, credited
 *    to the deal's closer. Beyond the contract or the 120 days it is back
 *    end, the card's CSM's. Renewals follow the same cap.
 * 2. A card match inside a deal's term is that deal's money.
 * 3. The CEO's tie is read first: a payment tie, then a payer tie, then
 *    Whop's own deal link, the email, the name, the card.
 * 4. A payer tie keys on the email or the exact payer key, never a short name.
 */
/** A payment this many days before the form can still be that deal's (the form is filled after the call). */
export const BEFORE_FORM_DAYS = 7;
/** A deal's money is the closer's for this many days after signing, up to its contract. */
export const DEAL_TERM_DAYS = 120;
/** Names this long or longer may match by one containing the other; a payer key must be this long. */
const CONTAINS_MIN = 6;

/** Whole days from one Kuwait day to another, negative when `to` is earlier. */
function daysFrom(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function lowerEmail(value) {
  const text = String(value ?? "").trim().toLowerCase();
  return text || null;
}

function oneLine(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * The CEO's ties as the finance snapshot gives them (cockpit_payment_ties,
 * live rows): one scope (a payment, a payer's email, a payer's exact key)
 * and one target (a deal, a card, or not client money). A row without a
 * scope or a target is left out, never guessed. Newest id wins a scope.
 */
export function normalizeTies(rows) {
  const ties = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (field(row, "cleared_at", "clearedAt")) continue;
    const text = value => (value === null || value === undefined || String(value).trim() === "" ? null : String(value).trim());
    const paymentId = text(field(row, "payment_id", "paymentId"));
    const payerEmail = lowerEmail(field(row, "payer_email", "payerEmail"));
    const payerKey = nameKey(field(row, "payer_key", "payerKey")) || null;
    const dealResponseId = text(field(row, "deal_response_id", "dealResponseId"));
    const clickupTaskId = text(field(row, "clickup_task_id", "clickupTaskId"));
    const notClient = field(row, "not_client", "notClient") === true;
    const scope = paymentId ? "payment" : payerEmail || payerKey ? "payer" : null;
    if (!scope || !(dealResponseId || clickupTaskId || notClient)) continue;
    const setAt = field(row, "set_at", "setAt");
    ties.push({
      id: num(field(row, "id")), scope, paymentId, payerEmail: paymentId ? null : payerEmail, payerKey: paymentId || payerEmail ? null : payerKey,
      dealResponseId, clickupTaskId: dealResponseId ? null : clickupTaskId, notClient: !dealResponseId && !clickupTaskId && notClient,
      note: oneLine(field(row, "note"), 500), setBy: oneLine(field(row, "set_by", "setBy"), 120) || null, setAt: setAt === null || setAt === undefined ? null : String(setAt),
    });
  }
  return ties.sort((a, b) => a.id - b.id);
}

/**
 * The tie a payment's scope selects (rule 3): its own payment tie, then its
 * payer's email, then its payer's full key. Newest id wins a scope.
 */
function tieLookup(ties) {
  const byPayment = new Map();
  const byEmail = new Map();
  const byKey = new Map();
  for (const tie of ties) {
    if (tie.paymentId) byPayment.set(tie.paymentId, tie);
    else if (tie.payerEmail) byEmail.set(tie.payerEmail, tie);
    else if (tie.payerKey && tie.payerKey.length >= CONTAINS_MIN) byKey.set(tie.payerKey, tie);
  }
  return payment => {
    const email = lowerEmail(payment.payerEmail);
    const payer = nameKey(payment.payerName);
    return byPayment.get(payment.id) ?? (email ? byEmail.get(email) : undefined) ?? (payer.length >= CONTAINS_MIN ? byKey.get(payer) : undefined) ?? null;
  };
}

/**
 * A payer tie to a deal covers that payer's money from BEFORE_FORM_DAYS
 * before the deal's form (rule 1): a payment made earlier belongs to an
 * earlier engagement and is left to the automatic match. A tie on the one
 * payment is the CEO's word for that payment and always reaches it.
 */
function tieReaches(tie, deal, payment) {
  return tie.scope === "payment" || daysFrom(deal.day, payment.day) >= -BEFORE_FORM_DAYS;
}

export function attributePayments(payments, deals, cards, tieRows = []) {
  const dealById = new Map();
  const dealsByEmail = new Map();
  const dealsByName = new Map();
  for (const deal of deals) {
    if (deal.responseId) dealById.set(deal.responseId, deal);
    const email = lowerEmail(deal.email);
    if (email) dealsByEmail.set(email, [...(dealsByEmail.get(email) ?? []), deal]);
    const business = nameKey(deal.business);
    if (business.length >= 4) dealsByName.set(business, [...(dealsByName.get(business) ?? []), deal]);
    // A contact's own name only when long enough to be more than a first name (the Edge rule).
    const contact = nameKey(deal.contactName);
    if (contact.length >= CONTAINS_MIN) dealsByName.set(contact, [...(dealsByName.get(contact) ?? []), deal]);
  }
  const cardById = new Map(cards.map(card => [card.taskId, card]));
  const cardByEmail = new Map();
  const cardByPayer = new Map();
  const cardByName = new Map();
  for (const card of cards) {
    for (const email of card.emails) if (lowerEmail(email)) cardByEmail.set(lowerEmail(email), card);
    for (const payer of card.payerKeys) if (nameKey(payer)) cardByPayer.set(nameKey(payer), card);
    for (const name of card.names) {
      const key = nameKey(name);
      if (key.length >= 4) cardByName.set(key, card);
    }
  }
  const lookup = (index, key) => {
    if (!key) return null;
    if (index.has(key)) return index.get(key);
    if (key.length < CONTAINS_MIN) return null;
    let best = null;
    let bestLength = 0;
    for (const [candidate, value] of index) {
      if (candidate.length >= CONTAINS_MIN && (key.includes(candidate) || candidate.includes(key)) && candidate.length > bestLength) {
        best = value;
        bestLength = candidate.length;
      }
    }
    return best;
  };
  // The deal whose form sits closest to the payment, a form on or before it
  // preferred: gap = payment - deal, as the Edge copy (changed 2026-10-18).
  const nearest = (candidates, day) => candidates.reduce((best, deal) => {
    const gap = daysFrom(deal.day, day);
    const score = gap >= 0 ? gap : Math.abs(gap) * 10;
    return !best || score < best.score ? { deal, score } : best;
  }, null)?.deal ?? null;
  const cardForDeal = deal => lookup(cardByName, nameKey(deal.business)) ?? (lowerEmail(deal.email) ? cardByEmail.get(lowerEmail(deal.email)) ?? null : null);
  const dealsByCard = new Map();
  for (const deal of deals) {
    const card = cardForDeal(deal);
    if (card) dealsByCard.set(card.taskId, [...(dealsByCard.get(card.taskId) ?? []), deal]);
  }
  const tieOf = tieLookup(normalizeTies(tieRows));
  const paidAgainst = new Map();
  const contractOpen = deal => !(deal.contracted > 0) || (paidAgainst.get(deal.responseId) ?? 0) + 0.01 < deal.contracted;
  const dealRow = (payment, deal, matchedBy, tie) => {
    const age = daysFrom(deal.day, payment.day);
    const open = contractOpen(deal);
    const paid = paidAgainst.get(deal.responseId) ?? 0;
    paidAgainst.set(deal.responseId, paid + payment.usd);
    const card = cardForDeal(deal);
    const frontEnd = open && age <= DEAL_TERM_DAYS;
    // Deposit money is owed while what came before is under the typed deposit; with none typed, the first payment is it.
    const depositOwed = deal.deposit > 0 ? paid + 0.01 < deal.deposit : paid === 0;
    // Only the part up to the typed deposit is deposit: one paid-in-full payment is the deposit and the remainder (rule 1).
    const depositUsd = !frontEnd || !depositOwed ? 0 : deal.deposit > 0 ? Math.min(payment.usd, ROUND2(deal.deposit - paid)) : payment.usd;
    return {
      ...payment, side: frontEnd ? "front_end" : "back_end", kind: !frontEnd ? "client" : depositOwed ? "deposit" : "remainder", depositUsd,
      person: frontEnd ? deal.closer ?? null : card?.csm ?? deal.csm ?? null, personRole: frontEnd ? "closer" : "csm",
      dealResponseId: deal.responseId, dealBusiness: deal.business, clientTaskId: card?.taskId ?? null, clientName: card?.names[0] ?? deal.business, matchedBy, tie,
    };
  };
  const cardRow = (payment, card, matchedBy, tie) => {
    const inTerm = (dealsByCard.get(card.taskId) ?? []).filter(deal => {
      const age = daysFrom(deal.day, payment.day);
      return age >= -BEFORE_FORM_DAYS && age <= DEAL_TERM_DAYS && contractOpen(deal);
    });
    const deal = nearest(inTerm, payment.day);
    if (deal) return dealRow(payment, deal, matchedBy, tie);
    return { ...payment, side: "back_end", kind: "client", depositUsd: 0, person: card.csm ?? null, personRole: "csm", dealResponseId: null, dealBusiness: null, clientTaskId: card.taskId, clientName: card.names[0] ?? null, matchedBy, tie };
  };
  const output = [];
  const sorted = [...payments].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
  for (const payment of sorted) {
    const email = lowerEmail(payment.payerEmail);
    const payer = nameKey(payment.payerName);
    const tie = tieOf(payment);
    if (tie) {
      const ref = { id: tie.id, scope: tie.scope, note: tie.note, setBy: tie.setBy, setAt: tie.setAt };
      const tiedDeal = tie.dealResponseId ? dealById.get(tie.dealResponseId) : undefined;
      if (tiedDeal && tieReaches(tie, tiedDeal, payment)) { output.push(dealRow(payment, tiedDeal, "ceo", ref)); continue; }
      if (tie.clickupTaskId && cardById.has(tie.clickupTaskId)) { output.push(cardRow(payment, cardById.get(tie.clickupTaskId), "ceo", ref)); continue; }
      if (tie.notClient) {
        output.push({ ...payment, side: "not_client", kind: "none", depositUsd: 0, person: null, personRole: null, dealResponseId: null, dealBusiness: null, clientTaskId: null, clientName: null, matchedBy: "ceo", tie: ref });
        continue;
      }
      // A tie to a deal or card this run does not hold, or a payer tie's payment from before its deal, falls back to the automatic match; tieSummary lists it.
    }
    let deal = null;
    let matchedBy = "none";
    if (payment.dealResponseId && dealById.has(payment.dealResponseId)) {
      deal = dealById.get(payment.dealResponseId);
      matchedBy = "deal_id";
    } else if (email && dealsByEmail.has(email)) {
      deal = nearest(dealsByEmail.get(email), payment.day);
      matchedBy = "deal_email";
    } else if (payer.length >= 4 && lookup(dealsByName, payer)) {
      deal = nearest(lookup(dealsByName, payer), payment.day);
      matchedBy = "deal_name";
    }
    // A payment well before the form belongs to an earlier engagement.
    if (deal && daysFrom(deal.day, payment.day) < -BEFORE_FORM_DAYS) {
      deal = null;
      matchedBy = "none";
    }
    if (deal) {
      output.push(dealRow(payment, deal, matchedBy, null));
      continue;
    }
    let card = email ? cardByEmail.get(email) ?? null : null;
    if (card) matchedBy = "card_email";
    else if (payer && cardByPayer.has(payer)) { card = cardByPayer.get(payer); matchedBy = "card_payer"; }
    else if (payer.length >= 4 && lookup(cardByName, payer)) { card = lookup(cardByName, payer); matchedBy = "card_name"; }
    else if (payment.clickupTaskId && cardById.has(payment.clickupTaskId)) { card = cardById.get(payment.clickupTaskId); matchedBy = "card_typed"; }
    output.push(card
      ? cardRow(payment, card, matchedBy, null)
      : { ...payment, side: "unattributed", kind: "none", depositUsd: 0, person: null, personRole: null, dealResponseId: null, dealBusiness: null, clientTaskId: null, clientName: null, matchedBy: "none", tie: null });
  }
  return output;
}

/**
 * What became of the CEO's ties this run: how many credited a payment, and
 * each one that did not, with why (its deal or card is not in this run, a
 * payer key too short to be more than a first name, or no payment of this
 * run is in its scope).
 */
export function tieSummary(tieRows, rows, deals, cards) {
  const ties = normalizeTies(tieRows);
  const used = new Map();
  for (const row of rows) if (row.tie) used.set(row.tie.id, (used.get(row.tie.id) ?? 0) + 1);
  const dealById = new Map(deals.map(deal => [deal.responseId, deal]));
  const cardIds = new Set(cards.map(card => card.taskId));
  // Payments a payer tie left to the automatic rules: made more than BEFORE_FORM_DAYS before its deal's form.
  const tieOf = tieLookup(ties);
  const early = new Map();
  for (const row of rows) {
    if (row.tie) continue;
    const tie = tieOf(row);
    const deal = tie?.dealResponseId ? dealById.get(tie.dealResponseId) : undefined;
    if (!deal || tieReaches(tie, deal, row)) continue;
    const item = early.get(tie.id) ?? { id: tie.id, scope: tie.scope, payments: 0, usd: 0 };
    item.payments += 1;
    item.usd += row.usd;
    early.set(tie.id, item);
  }
  const notApplied = [];
  for (const tie of ties) {
    if (used.has(tie.id)) continue;
    const why = tie.dealResponseId && !dealById.has(tie.dealResponseId) ? "deal_not_in_run"
      : tie.clickupTaskId && !cardIds.has(tie.clickupTaskId) ? "card_not_in_run"
        : tie.payerKey && tie.payerKey.length < CONTAINS_MIN ? "payer_key_too_short"
          : early.has(tie.id) ? "before_deal"
            : "no_payment_in_run";
    notApplied.push({ id: tie.id, scope: tie.scope, why });
  }
  const beforeDeal = [...early.values()].sort((a, b) => a.id - b.id).map(item => ({ ...item, usd: ROUND2(item.usd) }));
  return { live: ties.length, applied: used.size, payments: [...used.values()].reduce((sum, n) => sum + n, 0), notApplied, beforeDeal };
}

/** The deal ledger (cockpit_deal_payments): every front-end payment, one row per payment, for payroll and Sales front-end cash. */
export function dealLedgerRows(rows) {
  return rows.filter(row => row.side === "front_end" && row.dealResponseId).map(row => ({
    payment_id: row.id, deal_response_id: row.dealResponseId, day: row.day, usd: row.usd, rail: row.rail, kind: row.kind,
    deposit_usd: row.depositUsd ?? 0, matched_by: row.matchedBy, tie_id: row.tie?.id ?? null, payer: row.payerName ?? null,
  }));
}

/** The attribution rule in words, said beside the figures (the Edge copy says the same). */
export function attributionRuleText(unattributedCount, unattributedUsd) {
  return `Every payment in over the last 12 months is given a side. A payment tied to a signed deal (by your tie, Whop's own link, the payer's email, the business name, or a client card whose deal is still in its term) is front end and the closer's, from ${BEFORE_FORM_DAYS} days before the form until the deal's tied cash reaches its contract, at most ${DEAL_TERM_DAYS} days after signing: the deposit up to what the closer typed, then the remainder. Beyond the contract or the ${DEAL_TERM_DAYS} days it is back end, the card's CSM's, and so is a payment matched only to a client (by a portal login, the hand-kept payer mapping, the card's names or the card typed on a hand-logged entry). Your ties are read before any automatic match. ${unattributedCount === 1 ? "1 payment" : `${unattributedCount} payments`} (${usdWords(unattributedUsd)}) match no deal and no client; the Transactions tab lists every payment in and out.`;
}

const TIE_WHY = {
  deal_not_in_run: "its deal is not in this run (voided, or signed before the deals read)",
  card_not_in_run: "its client card is not in this run",
  payer_key_too_short: "its payer key is too short to be more than a first name",
  before_deal: `every payment in its scope was made more than ${BEFORE_FORM_DAYS} days before its deal's form`,
  no_payment_in_run: "no payment of the last 12 months is in its scope",
};

/** The ties that credited nothing, and the payments a payer tie left alone, this run, in words (the Edge copy says the same). */
export function tieNoteText(summary) {
  const parts = [];
  const items = summary.notApplied.map(item => `tie ${item.id} (${TIE_WHY[item.why] ?? item.why})`);
  if (items.length) parts.push(`${items.length === 1 ? "1 of your ties" : `${items.length} of your ties`} credited no payment this run: ${items.join("; ")}. The payments they meant are attributed by the automatic rules until the tie is changed or removed.`);
  const early = (summary.beforeDeal ?? []).map(item => `tie ${item.id} leaves ${item.payments === 1 ? "1 payment" : `${item.payments} payments`} (${usdWords(item.usd)})`);
  if (early.length) parts.push(`A payer tie covers that payer's money from ${BEFORE_FORM_DAYS} days before its deal's form; anything paid earlier belongs to an earlier engagement and stays with the automatic rules: ${early.join("; ")}. Tie such a payment on its own if it is that deal's money.`);
  return parts.join(" ");
}

export function attributionTotals(rows) {
  const totals = { in: 0, count: rows.length, frontEnd: 0, deposit: 0, remainder: 0, kickoff: 0, backEnd: 0, unattributed: 0, unattributedCount: 0, notClient: 0, notClientCount: 0 };
  for (const row of rows) {
    totals.in += row.usd;
    if (row.side === "front_end") {
      // The deposit is the part of each payment up to the typed deposit; the rest of it is the remainder.
      const deposit = row.depositUsd ?? 0;
      totals.frontEnd += row.usd;
      totals.deposit += deposit;
      totals.remainder += row.usd - deposit;
    } else if (row.side === "back_end") totals.backEnd += row.usd;
    else if (row.side === "not_client") { totals.notClient += row.usd; totals.notClientCount += 1; }
    else { totals.unattributed += row.usd; totals.unattributedCount += 1; }
  }
  // `kickoff` is the remainder under its old name, kept for screens that still read it.
  totals.kickoff = totals.remainder;
  for (const key of ["in", "frontEnd", "deposit", "remainder", "kickoff", "backEnd", "unattributed", "notClient"]) totals[key] = ROUND2(totals[key]);
  return totals;
}

export function attributionByPerson(rows) {
  const people = new Map();
  for (const row of rows) {
    if (!row.person || !row.personRole) continue;
    const key = `${row.personRole}:${row.person.toLowerCase()}`;
    const item = people.get(key) ?? { name: row.person, role: row.personRole, frontEnd: 0, backEnd: 0, payments: 0 };
    if (row.side === "front_end") item.frontEnd += row.usd;
    if (row.side === "back_end") item.backEnd += row.usd;
    item.payments += 1;
    people.set(key, item);
  }
  return [...people.values()].map(row => ({ ...row, frontEnd: ROUND2(row.frontEnd), backEnd: ROUND2(row.backEnd) })).sort((a, b) => b.frontEnd + b.backEnd - a.frontEnd - a.backEnd);
}

function matchRuns(lines, payments, lookback, tolerance) {
  const result = new Map();
  const used = new Set();
  const ordered = [...payments].sort((a, b) => a.day.localeCompare(b.day));
  for (const line of [...lines].sort((a, b) => a.day.localeCompare(b.day))) {
    const pool = ordered.filter(item => !used.has(item.id) && dayGap(item.day, line.day) <= lookback && item.day <= line.day);
    let match = null;
    for (let start = 0; start < pool.length && !match; start++) {
      let total = 0;
      const run = [];
      for (let index = start; index < pool.length; index++) {
        total += pool[index].usd;
        run.push(pool[index]);
        if (line.usd !== 0 && Math.abs(total - line.usd) / Math.abs(line.usd) <= tolerance) { match = run; break; }
        if (line.usd > 0 && total > line.usd * (1 + tolerance)) break;
      }
    }
    if (!match) continue;
    for (const payment of match) used.add(payment.id);
    result.set(String(line.id), { from: match[0].day, to: match.at(-1).day, count: match.length });
  }
  return result;
}

function normalizeDeal(row) {
  return {
    responseId: String(field(row, "response_id", "responseId") ?? ""),
    day: dateText(field(row, "day")),
    email: field(row, "email") ? String(field(row, "email")).toLowerCase() : null,
    business: cleanText(field(row, "business", "business_name"), 80),
    contactName: cleanText(field(row, "contact", "contact_name"), 120) || null,
    closer: cleanText(field(row, "closer"), 80) || null,
    csm: cleanText(field(row, "csm"), 80) || null,
    deposit: num(field(row, "cash_collected", "cashCollected")),
    paymentStructure: field(row, "payment_structure", "paymentStructure") == null ? null : String(field(row, "payment_structure", "paymentStructure")),
    contracted: field(row, "contracted", "contracted_revenue") == null ? null : num(field(row, "contracted", "contracted_revenue")),
    cash: field(row, "cash_collected", "cashCollected") == null ? null : num(field(row, "cash_collected", "cashCollected")),
    plan: cleanText(field(row, "plan", "payment_structure", "paymentStructure"), 80) || null,
  };
}

function bankExpenses(snapshot, month) {
  const lines = rowsFor(snapshot, "bankLines").map(normalizeBankLine);
  const exclusions = rowsFor(snapshot, "exclusions");
  const statements = rowsFor(snapshot, "statements");
  const statementDays = statements.map(row => dateText(field(row, "to_day", "toDay"))).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day));
  const latestStatementDay = statementDays.sort().at(-1) ?? null;
  const monthLines = lines.filter(line => line.day.slice(0, 7) === month);
  const excluded = line => {
    for (const rule of exclusions) {
      if (field(rule, "removed_at", "removedAt")) continue;
      const kind = String(field(rule, "kind") ?? "");
      const pattern = String(field(rule, "pattern") ?? "").trim().toLowerCase();
      if (!pattern) continue;
      if (kind === "card" && line.account.trim().toLowerCase() === pattern) return rule;
      if (kind === "vendor" && line.reference.toLowerCase().includes(pattern)) return rule;
    }
    return null;
  };
  const kept = [];
  const excludedLines = [];
  for (const line of monthLines) {
    if (!line.usd || line.usd >= 0) continue;
    if (line.kind !== "expense" && line.kind !== "fee" && line.kind !== "excluded") continue;
    const rule = excluded(line);
    if (rule || line.kind === "excluded") excludedLines.push({ line, rule });
    else kept.push(line);
  }
  return { lines, statements, monthLines, kept, excludedLines, latestStatementDay, exclusions };
}


export function createMoneyAdapter(snapshot) {
  return {
    key: "money",
    label: "Money",
    compute: async () => {
      const now = Date.now();
      const today = kuwaitDay(now);
      const dates = monthWindow(today);
      const notes = [];
      const sources = [];
      if (!snapshot || snapshot.history_ready !== true || snapshot.aliases_ready !== true || snapshot.manual_ready !== true) {
        failSource("Canonical finance history", "manual payment history and client alias baselines are not reconciled");
      }
      const sourceRevision = num(snapshot.revision);
      if (!Number.isInteger(sourceRevision) || sourceRevision < 0) failSource("Canonical finance revision", "revision is missing");
      const manual = rowsFor(snapshot, "manual").map(normalizeManual);
      if (manual.length > MANUAL_CAP) failSource("Manual payments", `read limit ${MANUAL_CAP} was reached`);
      const activeManual = manual.filter(row => row.deletedAt === null && row.day >= dates.from12 && row.day <= today);
      const removedThisMonth = manual.filter(row => row.deletedAt !== null && row.day.slice(0, 7) === dates.month);
      const bankInput = {
        bankLines: rowsFor(snapshot, "bank_lines"),
        statements: rowsFor(snapshot, "statements"),
        exclusions: rowsFor(snapshot, "exclusions"),
        payers: rowsFor(snapshot, "payers"),
        aliases: rowsFor(snapshot, "aliases"),
        billing: rowsFor(snapshot, "billing"),
      };
      const bankFacts = bankExpenses({ ...snapshot, ...bankInput }, dates.month);
      if (!bankFacts.statements.length || !bankFacts.latestStatementDay) failSource("Bank statements", "no canonical statement has been imported");
      const statementAge = Math.round((Date.parse(today) - Date.parse(bankFacts.latestStatementDay)) / 86_400_000);
      // A statement dated after today is a parse error, never a fresh statement.
      if (statementAge < 0) failSource("Bank statements", `newest statement ends ${bankFacts.latestStatementDay}, after today`);
      // Aziz (A109): "Show 'days since the last statement' on the tab and warn
      // past 7 days." A stale statement warns and still publishes: the cash
      // rails do not wait on the bank, and the bank figures say how old they are.
      const bankFresh = statementAge <= BANK_STALE_DAYS;
      const statementNote = `Newest statement ends ${bankFacts.latestStatementDay}, ${statementAge} ${statementAge === 1 ? "day" : "days"} ago${bankFresh ? "" : `, past ${BANK_STALE_DAYS} days. Upload a current CBK statement on the Money tab`}`;
      sources.push({ name: "Bank statements and classification", freshestAt: Math.max(...bankFacts.statements.map(row => epoch(field(row, "imported_at", "importedAt")) ?? 0)) || undefined, ok: true, note: statementNote });

      const whopDayRows = await sql(B2B, `/* ceo-refresh:money.cash */
        SELECT to_char(paid_on,'YYYY-MM-DD') AS day,sum(net_amount) AS cash
        FROM public.whop_payments
        WHERE status='paid' AND currency='usd' AND paid_on BETWEEN date '${dates.from180}' AND date '${today}'
        GROUP BY paid_on ORDER BY paid_on`);
      const [summary] = await sql(B2B, `/* ceo-refresh:money.summary */
        SELECT
          (SELECT floor(extract(epoch FROM max(synced_at))*1000)::bigint FROM public.whop_payments) AS whop_synced_ms,
          (SELECT floor(extract(epoch FROM max(paid_at))*1000)::bigint FROM public.whop_payments WHERE status='paid') AS whop_last_paid_ms,
          (SELECT floor(extract(epoch FROM max(synced_at))*1000)::bigint FROM public.closed_deals WHERE NOT EXISTS (SELECT 1 FROM public.record_voids rv WHERE rv.entity='closed_deal' AND rv.record_id=closed_deals.response_id)) AS deals_synced_ms,
          (SELECT count(*) FROM public.whop_payments w WHERE w.currency='usd' AND w.status='open' AND (w.created_at AT TIME ZONE 'Asia/Kuwait')::date BETWEEN date '${addDays(today, -29)}' AND date '${today}' AND NOT EXISTS (SELECT 1 FROM public.whop_payments p WHERE p.status='paid' AND p.membership_id=w.membership_id AND p.paid_at>=w.created_at)) AS failed_count_30,
          (SELECT coalesce(sum(w.final_amount),0) FROM public.whop_payments w WHERE w.currency='usd' AND w.status='open' AND (w.created_at AT TIME ZONE 'Asia/Kuwait')::date BETWEEN date '${addDays(today, -29)}' AND date '${today}' AND NOT EXISTS (SELECT 1 FROM public.whop_payments p WHERE p.status='paid' AND p.membership_id=w.membership_id AND p.paid_at>=w.created_at)) AS failed_amount_30,
          (SELECT coalesce(sum(refunded_amount),0) FROM public.whop_payments WHERE status='paid' AND currency='usd' AND refunded_amount>0 AND (refunded_at AT TIME ZONE 'Asia/Kuwait')::date BETWEEN date '${monthStart(today)}' AND date '${today}') AS refunds_mtd,
          (SELECT coalesce(sum(refunded_amount),0) FROM public.whop_payments WHERE status='paid' AND currency='usd' AND refunded_amount>0 AND (refunded_at AT TIME ZONE 'Asia/Kuwait')::date BETWEEN date '${dates.from90}' AND date '${today}') AS refunds_90,
          (SELECT round(avg(contracted_revenue),2) FROM public.closed_deals d WHERE d.contracted_revenue IS NOT NULL AND (d.submitted_at AT TIME ZONE 'Asia/Kuwait')::date BETWEEN date '${dates.from90}' AND date '${today}' AND NOT EXISTS (SELECT 1 FROM public.record_voids rv WHERE rv.entity='closed_deal' AND rv.record_id=d.response_id)) AS avg_contract_90,
          (SELECT to_char(min((submitted_at AT TIME ZONE 'Asia/Kuwait')::date),'YYYY-MM-DD') FROM public.closed_deals d WHERE NOT EXISTS (SELECT 1 FROM public.record_voids rv WHERE rv.entity='closed_deal' AND rv.record_id=d.response_id)) AS first_deal_day`);
      if (!summary) failSource("Whop and closer form inputs", "summary query returned no row");
      addSource(sources, "Whop payments", summary.whop_synced_ms, now);
      addSource(sources, "Closer form deals", summary.deals_synced_ms, now);

      const monthRows = await sql(B2B, `/* ceo-refresh:money.monthly */
        WITH months AS (SELECT generate_series(date '${dates.from12.slice(0, 7)}-01',date '${monthStart(today)}',interval '1 month')::date AS month),
        cash AS (SELECT date_trunc('month',paid_on)::date AS month,sum(net_amount) AS cash FROM public.whop_payments WHERE status='paid' AND currency='usd' AND paid_on>=date '${dates.from12}' GROUP BY 1),
        refunds AS (SELECT date_trunc('month',(refunded_at AT TIME ZONE 'Asia/Kuwait')::date)::date AS month,sum(refunded_amount) AS refunds FROM public.whop_payments WHERE status='paid' AND currency='usd' AND refunded_amount>0 AND (refunded_at AT TIME ZONE 'Asia/Kuwait')::date>=date '${dates.from12}' GROUP BY 1),
        deals AS (SELECT date_trunc('month',(submitted_at AT TIME ZONE 'Asia/Kuwait')::date)::date AS month,count(*) AS deals,sum(contracted_revenue) AS contracted FROM public.closed_deals d WHERE (submitted_at AT TIME ZONE 'Asia/Kuwait')::date>=date '${dates.from12}' AND NOT EXISTS(SELECT 1 FROM public.record_voids rv WHERE rv.entity='closed_deal' AND rv.record_id=d.response_id) GROUP BY 1)
        SELECT to_char(m.month,'YYYY-MM') AS month,coalesce(c.cash,0) AS cash,coalesce(r.refunds,0) AS refunds,coalesce(d.deals,0) AS deals,coalesce(d.contracted,0) AS contracted
        FROM months m LEFT JOIN cash c USING(month) LEFT JOIN refunds r USING(month) LEFT JOIN deals d USING(month) ORDER BY m.month`);
      const monthly = monthRows.map(row => ({ month: String(row.month), cash: ROUND2(num(row.cash)), refunds: ROUND2(num(row.refunds)), deals: num(row.deals), contracted: ROUND2(num(row.contracted)) }));
      const byMonth = new Map(monthly.map(row => [row.month, row]));
      const cashByDay = new Map(whopDayRows.map(row => [dateText(row.day), num(row.cash)]));
      const cashDaily = [];
      for (let day = dates.from180; day <= today; day = addDays(day, 1)) cashDaily.push({ date: day, value: ROUND2(cashByDay.get(day) ?? 0) });
      const cashBetween = (from, to) => ROUND2(cashDaily.filter(row => row.date >= from && row.date <= to).reduce((sum, row) => sum + row.value, 0));
      const whopCash = {
        today: cashBetween(today, today), yesterday: cashBetween(addDays(today, -1), addDays(today, -1)),
        mtd: cashBetween(monthStart(today), today), lastMonthToDate: cashBetween(dates.lastMonthStart, dates.lastMonthToDateEnd),
        lastMonth: cashBetween(dates.lastMonthStart, dates.lastMonthEnd),
        projectedMonth: ROUND2(cashBetween(monthStart(today), today) / dates.dayOfMonth * dates.dim), daily: cashDaily,
      };

      // A deal signed up to DEAL_TERM_DAYS before the 12 months can still be in its term inside them, so the
      // money paid on it before them is read too: it counts toward the deal's contract and is never published.
      const seedFrom = addDays(dates.from12, -DEAL_TERM_DAYS);
      const [recentDeals, targetRows, whopRead, transferRows, attributionDeals, loginRows, expenseRows] = await Promise.all([
        sql(B2B, `/* ceo-refresh:money.recent_deals */ SELECT to_char((submitted_at AT TIME ZONE 'Asia/Kuwait')::date,'YYYY-MM-DD') AS day,left(nullif(btrim(business_name),''),80) AS business,nullif(split_part(btrim(coalesce(closer,'')),' ',1),'') AS closer,contracted_revenue AS contracted,cash_collected AS cash,left(nullif(btrim(payment_structure),''),60) AS plan FROM public.closed_deals d WHERE submitted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.record_voids rv WHERE rv.entity='closed_deal' AND rv.record_id=d.response_id) ORDER BY submitted_at DESC LIMIT 10`),
        sql(B2B, `/* ceo-refresh:money.targets */ SELECT to_char(period_month,'YYYY-MM') AS month,metric,projection,floor(extract(epoch FROM updated_at)*1000)::bigint AS updated_ms FROM public.monthly_targets WHERE projection IS NOT NULL AND period_month=(SELECT max(period_month) FROM public.monthly_targets WHERE period_month<=date '${monthStart(today)}') ORDER BY metric`),
        sql(B2B, `/* ceo-refresh:money.attribution.whop */ SELECT payment_id,to_char(paid_on,'YYYY-MM-DD') AS day,net_amount,final_amount,refunded_amount,to_char((refunded_at AT TIME ZONE 'Asia/Kuwait')::date,'YYYY-MM-DD') AS refund_day,nullif(lower(btrim(user_email)),'') AS email,nullif(btrim(billing_name),'') AS billing,nullif(btrim(user_username),'') AS username,deal_response_id,billing_reason FROM public.whop_payments WHERE status='paid' AND currency='usd' AND paid_on>=date '${seedFrom}' ORDER BY paid_on`),
        sql(B2B, `/* ceo-refresh:money.attribution.transfers */ SELECT id,to_char(received_at,'YYYY-MM-DD') AS day,amount_usd,method,nullif(btrim(client_name),'') AS client,reference,deal_response_id FROM public.transfers WHERE received_at>=date '${seedFrom}' ORDER BY received_at`),
        sql(B2B, `/* ceo-refresh:money.attribution.deals */ SELECT response_id,to_char((submitted_at AT TIME ZONE 'Asia/Kuwait')::date,'YYYY-MM-DD') AS day,nullif(lower(btrim(email)),'') AS email,nullif(btrim(business_name),'') AS business,nullif(btrim(concat_ws(' ',client_first_name,client_last_name)),'') AS contact,closer,csm,cash_collected,payment_structure,contracted_revenue AS contracted FROM public.closed_deals d WHERE submitted_at>=date '${addDays(dates.from12, -DEAL_TERM_DAYS)}' AND NOT EXISTS(SELECT 1 FROM public.record_voids rv WHERE rv.entity='closed_deal' AND rv.record_id=d.response_id) ORDER BY submitted_at`),
        sql(B2B, `/* ceo-refresh:money.attribution.logins */ WITH docs AS (SELECT key,body FROM public.mahara_portal_documents WHERE key IN ('directory.json','client-access.json')),dir AS (SELECT e->>'id' AS client_id,e->>'clickupId' AS clickup_id FROM docs,jsonb_array_elements(CASE WHEN jsonb_typeof(body)='array' THEN body ELSE '[]'::jsonb END) e WHERE key='directory.json' AND coalesce(e->>'id','')<>'' AND coalesce(e->>'clickupId','')<>''),logins AS (SELECT lower(btrim(pr->>'email')) AS email,dir.clickup_id FROM docs CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(body->'profiles')='object' THEN body->'profiles' ELSE '{}'::jsonb END) p CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.value->'principals')='array' THEN p.value->'principals' ELSE '[]'::jsonb END) pr JOIN dir ON dir.client_id=p.key WHERE docs.key='client-access.json' AND jsonb_typeof(pr)='object' AND coalesce(btrim(pr->>'email'),'')<>'') SELECT email,min(clickup_id) AS clickup_id FROM logins GROUP BY email HAVING count(DISTINCT clickup_id)=1`),
        sql(B2B, `/* ceo-refresh:money.attribution.expenses */ SELECT id,to_char(incurred_at,'YYYY-MM-DD') AS day,amount_usd,category,vendor FROM public.expenses WHERE incurred_at>=date '${dates.from12}' ORDER BY incurred_at DESC LIMIT 10000`),
      ]);
      if (expenseRows.length >= 10_000) failSource("Expense transactions", "read limit was reached");
      // Whop payments of the 12 months: payouts, refunds and duplicates read these; the earlier ones only seed contracts.
      const whopRows = whopRead.filter(row => dateText(row.day) >= dates.from12);
      const dealRefs = attributionDeals.filter(row => row.response_id && row.business).map(normalizeDeal);
      const recentDealRows = recentDeals.map(normalizeDeal);
      const dealsThisMonth = monthly.find(row => row.month === dates.month);
      const dealsLastMonth = monthly.find(row => row.month === dates.lastMonth);
      const [tapStateRows, tapRows] = await Promise.all([
        sql(TRIAGE, `/* ceo-refresh:money.tap_state */ SELECT ok,note,rows_seen,floor(extract(epoch FROM last_run_at)*1000)::bigint AS run_ms,floor(extract(epoch FROM last_ok_at)*1000)::bigint AS ok_ms FROM public.cockpit_sync_state WHERE key='tap-charges-sync'`),
        sql(TRIAGE, `/* ceo-refresh:money.tap_charges */ SELECT id,to_char(day,'YYYY-MM-DD') AS day,floor(extract(epoch FROM at)*1000)::bigint AS at_ms,currency,amount,usd,email,name FROM public.cockpit_tap_charges WHERE live AND status='CAPTURED' AND day BETWEEN date '${seedFrom}' AND date '${today}' ORDER BY at`),
      ]);
      const tapState = tapStateRows[0];
      const tapFreshAt = epoch(tapState?.ok_ms);
      if (!tapState || tapState.ok !== true || tapFreshAt === null || now - tapFreshAt > TAP_STALE_MS || now < tapFreshAt - 60_000) {
        failSource("Tap payment sync", tapState?.note ? cleanText(tapState.note, 120) : "no recent successful tap-charges-sync run");
      }
      const tapRead = tapRows.map(row => ({
        id: String(row.id), day: dateText(row.day), at: num(row.at_ms), currency: String(row.currency ?? "USD"),
        amount: num(row.amount), usd: row.usd === null || row.usd === undefined ? null : ROUND2(num(row.usd)),
        email: row.email ? String(row.email).toLowerCase() : null, name: row.name ? cleanText(row.name, 100) : null,
      }));
      // The Tap rail, settlements and hand-logged matching read the last 180 days; the older charges are
      // attribution's alone, so the 12 months keep every Tap payment and contracts are seeded.
      const tapCharges = tapRead.filter(row => row.day >= dates.from180);
      const tapOlder = tapRead.filter(row => row.day < dates.from180 && row.usd !== null);
      sources.push({ name: "Tap charges", freshestAt: tapFreshAt, ok: true });

      const [ecomStateRows, ecomRows] = await Promise.all([
        sql(TRIAGE, `/* ceo-refresh:money.ecom_state */ SELECT ok,note,floor(extract(epoch FROM last_ok_at)*1000)::bigint AS ok_ms FROM public.cockpit_sync_state WHERE key='ecom-payments-sync'`),
        sql(TRIAGE, `/* ceo-refresh:money.ecom_invoices */ SELECT id,to_char(day,'YYYY-MM-DD') AS day,floor(extract(epoch FROM paid_at)*1000)::bigint AS at_ms,amount_kwd,usd,customer_name,customer_email FROM public.cockpit_ecom_invoices WHERE status='PAID' AND day BETWEEN date '${seedFrom}' AND date '${today}' ORDER BY paid_at`),
      ]);
      const ecomState = ecomStateRows[0];
      const ecomFreshAt = epoch(ecomState?.ok_ms);
      if (!ecomState || ecomState.ok !== true || ecomFreshAt === null || now - ecomFreshAt > ECOM_STALE_MS || now < ecomFreshAt - 60_000)
        failSource("Ecom payment sync", ecomState?.note ? cleanText(ecomState.note, 120) : "no recent successful ecom-payments-sync run");
      const ecomRead = ecomRows.map(row => ({
        id: String(row.id), day: dateText(row.day), at: num(row.at_ms), amount: num(row.amount_kwd),
        usd: row.usd === null || row.usd === undefined ? null : ROUND2(num(row.usd)),
        email: row.customer_email ? String(row.customer_email).toLowerCase() : null,
        name: row.customer_name ? cleanText(row.customer_name, 100) : null,
      }));
      if (ecomRead.some(row => row.usd === null)) failSource("Ecom payments", "a paid invoice has no USD conversion");
      const ecomInvoices = ecomRead.filter(row => row.day >= dates.from180);
      sources.push({ name: "Ecom payments", freshestAt: ecomFreshAt, ok: true, note: `${ecomRead.length} paid invoices` });

      const statementRows = bankFacts.statements;
      const statement = statementRows.slice().sort((a, b) => dateText(field(b, "to_day", "toDay")).localeCompare(dateText(field(a, "to_day", "toDay"))))[0];
      const bankLines = bankFacts.lines;
      const whopForPayout = whopRows.map(row => ({ id: String(row.payment_id), day: dateText(row.day), usd: ROUND2(num(row.net_amount)) }));
      const payoutLines = bankLines.filter(line => line.kind === "whop_payout").map(line => ({ id: String(line.id), day: line.day, usd: Math.abs(line.usd) }));
      const payoutMatches = matchRuns(payoutLines, whopForPayout, 14, 0.03);
      const settlements = bankLines.filter(line => line.kind === "tap_settlement").map(line => ({ id: String(line.id), day: line.day, usd: Math.abs(line.usd) }));
      const settlementMatches = matchRuns(settlements, tapCharges.filter(row => row.usd !== null).map(row => ({ id: row.id, day: row.day, usd: row.usd })), 10, 0.05);
      const tapCovered = new Set();
      for (const match of settlementMatches.values()) {
        const candidates = tapCharges.filter(row => row.usd !== null && row.day >= match.from && row.day <= match.to).sort((a, b) => a.day.localeCompare(b.day));
        for (const charge of candidates.slice(0, match.count)) tapCovered.add(charge.id);
      }
      const ecomSettlements = bankLines.filter(line => line.kind === "ecom_settlement").map(line => ({ id: String(line.id), day: line.day, usd: Math.abs(line.usd) }));
      const ecomMatches = matchRuns(ecomSettlements, ecomInvoices.map(row => ({ id: row.id, day: row.day, usd: row.usd })), 10, 0.05);
      const ecomCovered = new Set();
      for (const match of ecomMatches.values()) {
        const candidates = ecomInvoices.filter(row => row.day >= match.from && row.day <= match.to && !ecomCovered.has(row.id)).sort((a, b) => a.day.localeCompare(b.day));
        for (const invoice of candidates.slice(0, match.count)) ecomCovered.add(invoice.id);
      }
      const ecomByDay = new Map();
      for (const invoice of ecomInvoices) if (!ecomCovered.has(invoice.id)) ecomByDay.set(invoice.day, (ecomByDay.get(invoice.day) ?? 0) + invoice.usd);
      const ecomDaily = [];
      for (let day = dates.from180; day <= today; day = addDays(day, 1)) ecomDaily.push({ date: day, value: ROUND2(ecomByDay.get(day) ?? 0) });
      const tapByDay = new Map();
      for (const charge of tapCharges) if (charge.usd !== null && !tapCovered.has(charge.id)) tapByDay.set(charge.day, (tapByDay.get(charge.day) ?? 0) + charge.usd);
      const tapDaily = [];
      for (let day = dates.from180; day <= today; day = addDays(day, 1)) tapDaily.push({ date: day, value: ROUND2(tapByDay.get(day) ?? 0) });
      const railBetween = (rail, from, to) => ROUND2((rail.daily ?? []).filter(row => row.date >= from && row.date <= to).reduce((sum, row) => sum + row.value, 0));
      const tapRail = {
        label: "Tap", connected: true, today: railBetween({ daily: tapDaily }, today, today), yesterday: railBetween({ daily: tapDaily }, addDays(today, -1), addDays(today, -1)),
        mtd: railBetween({ daily: tapDaily }, monthStart(today), today), lastMonthToDate: railBetween({ daily: tapDaily }, dates.lastMonthStart, dates.lastMonthToDateEnd),
        lastMonth: railBetween({ daily: tapDaily }, dates.lastMonthStart, dates.lastMonthEnd),
        projectedMonth: ROUND2(railBetween({ daily: tapDaily }, monthStart(today), today) / dates.dayOfMonth * dates.dim),
        refundsMtd: null, daily: tapDaily, lastPaymentAt: Math.max(0, ...tapCharges.filter(row => row.usd !== null).map(row => row.at)) || null,
      };

      const ecomRail = {
        label: "Ecom", connected: true, today: railBetween({ daily: ecomDaily }, today, today), yesterday: railBetween({ daily: ecomDaily }, addDays(today, -1), addDays(today, -1)),
        mtd: railBetween({ daily: ecomDaily }, monthStart(today), today), lastMonthToDate: railBetween({ daily: ecomDaily }, dates.lastMonthStart, dates.lastMonthToDateEnd),
        lastMonth: railBetween({ daily: ecomDaily }, dates.lastMonthStart, dates.lastMonthEnd),
        projectedMonth: ROUND2(railBetween({ daily: ecomDaily }, monthStart(today), today) / dates.dayOfMonth * dates.dim),
        refundsMtd: null, daily: ecomDaily, lastPaymentAt: Math.max(0, ...ecomInvoices.map(row => row.at)) || null,
      };

      const paymentRows = [];
      for (const row of whopRead) if (num(row.net_amount) > 0) paymentRows.push({
        id: `whop:${row.payment_id}`, rail: "whop", day: dateText(row.day), usd: ROUND2(num(row.net_amount)), currency: "USD",
        amount: ROUND2(num(row.final_amount)), payerEmail: row.email ? String(row.email) : null,
        payerName: row.billing ? cleanText(row.billing, 120) : row.username ? cleanText(row.username, 120) : null,
        dealResponseId: row.deal_response_id ? String(row.deal_response_id) : null, clickupTaskId: null, billingReason: row.billing_reason ? String(row.billing_reason) : null,
      });
      // Every Tap charge is a payment in, a settlement line or not: the settlement credits nobody (it is not client money
      // on the statement), so the charge carries the payer, as a Whop payment does beside its payout (as the Edge copy).
      for (const charge of [...tapOlder, ...tapCharges]) if (charge.usd !== null) paymentRows.push({
        id: `tap:${charge.id}`, rail: "tap", day: charge.day, usd: charge.usd, currency: charge.currency, amount: charge.amount,
        payerEmail: charge.email, payerName: charge.name, dealResponseId: null, clickupTaskId: null, billingReason: null,
      });
      for (const invoice of ecomRead) paymentRows.push({
        id: `ecom:${invoice.id}`, rail: "ecom", day: invoice.day, usd: invoice.usd, currency: "KWD", amount: invoice.amount,
        payerEmail: invoice.email, payerName: invoice.name, dealResponseId: null, clickupTaskId: null, billingReason: null,
      });
      for (const row of transferRows) paymentRows.push({
        id: `transfer:${row.id}`, rail: "transfer", day: dateText(row.day), usd: ROUND2(num(row.amount_usd)), currency: "USD", amount: ROUND2(num(row.amount_usd)),
        payerEmail: null, payerName: row.client ? cleanText(row.client, 120) : null, dealResponseId: row.deal_response_id ? String(row.deal_response_id) : null, clickupTaskId: null, billingReason: row.method ? String(row.method) : null,
      });
      for (const line of bankLines) if (line.kind === "client_payment" && line.usd > 0) paymentRows.push({
        id: `bank:${line.id}`, rail: "transfer", day: line.day, usd: ROUND2(line.usd), currency: line.currency, amount: Math.abs(line.amount),
        payerEmail: null, payerName: line.reference || null, dealResponseId: null, clickupTaskId: null, billingReason: null,
      });

      const cards = cardReferences(snapshot, loginRows);
      const book = nameBook(cards.map(card => ({ taskId: card.taskId, names: card.names })));
      const livePayments = activeManual.filter(row => row.kind !== "refund");
      const manualRefunds = activeManual.filter(row => row.kind === "refund");
      const tapCoveredManual = coverWithTap(livePayments, tapCharges, addDays(dates.from180, -MATCH_DAYS));
      const usedBank = new Set();
      let manualCoveredByBank = 0;
      for (const entry of livePayments) {
        if (tapCoveredManual.has(entry.id) || entry.rail === "tap") continue;
        const candidates = bankLines.filter(line => line.kind === "client_payment" && line.usd > 0 && !usedBank.has(line.id) && bankCanBe(entry.rail, entry.day, line.day) && amountGap(entry.amountUsd, line.usd) <= MATCH_GAP)
          .sort((a, b) => dayGap(entry.day, a.day) - dayGap(entry.day, b.day) || amountGap(entry.amountUsd, a.usd) - amountGap(entry.amountUsd, b.usd));
        if (candidates[0]) { usedBank.add(candidates[0].id); tapCoveredManual.set(entry.id, { chargeDay: candidates[0].day, chargeUsd: candidates[0].usd }); manualCoveredByBank += 1; }
      }
      const countedManual = livePayments.filter(row => !tapCoveredManual.has(row.id));
      // A Tap payment logged by hand before the 180 days counts once in attribution, as the older Tap charge it matches.
      const olderTapCovered = coverWithTap(countedManual, tapOlder, dates.from12);
      for (const row of countedManual) if (!olderTapCovered.has(row.id)) paymentRows.push({
        id: `manual:${row.id}`, rail: "manual", day: row.day, usd: row.amountUsd, currency: row.currency, amount: row.amount,
        payerEmail: null, payerName: row.client || null, dealResponseId: null, clickupTaskId: row.clickupTaskId, billingReason: null,
      });

      const deals = attributionDeals.map(normalizeDeal).filter(row => row.responseId && row.business);
      // The CEO's ties come through the same fenced snapshot as the payer mapping (contract section 3).
      const tieRows = rowsFor(snapshot, "ties");
      // Every payment read decides each deal's contract; only the 12 months are published (the ledger rewrite covers them).
      const attributed = attributePayments(paymentRows, deals, cards, tieRows).filter(row => row.day >= dates.from12);
      const ties = tieSummary(tieRows, attributed, deals, cards);
      const dealPayments = dealLedgerRows(attributed);
      const transactionRows = [];
      for (const row of attributed) transactionRows.push({
        id: row.id, day: row.day, rail: row.rail, direction: "in", usd: row.usd, currency: row.currency, amount: row.amount,
        payerEmail: row.payerEmail, payerName: row.payerName, side: row.side, kind: row.kind, depositUsd: row.depositUsd, person: row.person,
        personRole: row.personRole, dealResponseId: row.dealResponseId, dealBusiness: row.dealBusiness, clientName: row.clientName, clientTaskId: row.clientTaskId,
        matchedBy: row.matchedBy, tie: row.tie, detail: row.billingReason,
      });
      for (const row of whopRows) if (num(row.refunded_amount) > 0 && row.refund_day) transactionRows.push({
        id: `whop-refund:${row.payment_id}`, day: dateText(row.refund_day), rail: "whop", direction: "out", usd: ROUND2(num(row.refunded_amount)),
        currency: "USD", amount: ROUND2(num(row.refunded_amount)), payerEmail: row.email ? String(row.email) : null,
        payerName: row.billing ? cleanText(row.billing, 120) : null, side: "out", kind: "refund", person: null, personRole: null,
        dealBusiness: null, clientName: null, clientTaskId: null, matchedBy: "none", detail: "Whop refund, already netted off the charge it refunds",
      });
      for (const line of bankLines) if (line.kind !== "client_payment") transactionRows.push({
        id: `bankline:${line.id}`, day: line.day, rail: "bank", direction: line.usd < 0 ? "out" : "in", usd: Math.abs(line.usd),
        currency: line.currency, amount: Math.abs(line.amount), payerEmail: null, payerName: line.reference || null,
        side: ["expense", "fee", "excluded"].includes(line.kind) || line.usd < 0 ? "out" : "unattributed",
        kind: ["expense", "fee", "excluded"].includes(line.kind) ? "expense" : "none", person: null, personRole: null,
        dealBusiness: null, clientName: null, clientTaskId: null,
        matchedBy: line.kind === "whop_payout" ? (payoutMatches.get(String(line.id)) ? `Whop payments ${payoutMatches.get(String(line.id)).from} to ${payoutMatches.get(String(line.id)).to}` : "none") : "none",
        detail: `${line.kind}${line.category ? ` · ${line.category}` : ""}${line.note ? ` · ${line.note}` : ""}`, bankKind: line.kind, bankLineId: line.id,
      });
      for (const row of manualRefunds) transactionRows.push({
        id: `manual-refund:${row.id}`, day: row.day, rail: "manual", direction: "out", usd: row.amountUsd, currency: row.currency, amount: row.amount,
        payerEmail: null, payerName: row.client || null, side: "out", kind: "refund", person: null, personRole: null,
        dealBusiness: null, clientName: row.client || null, clientTaskId: row.clickupTaskId, matchedBy: "none", detail: `Refund logged by hand (${row.rail})`,
      });
      const recentExpenseTransactions = expenseRows.map(row => ({
        id: `external-expense:${row.id}`, day: dateText(row.day), rail: "bank", direction: "out", usd: Math.abs(num(row.amount_usd)), currency: "USD", amount: Math.abs(num(row.amount_usd)),
        payerEmail: null, payerName: row.vendor ? cleanText(row.vendor, 100) : null, side: "out", kind: "expense", person: null, personRole: null,
        dealBusiness: null, clientName: null, clientTaskId: null, matchedBy: "none", detail: row.category ? String(row.category) : null,
      }));
      transactionRows.push(...recentExpenseTransactions);
      transactionRows.sort((a, b) => b.day.localeCompare(a.day) || a.id.localeCompare(b.id));
      const attributionInput = attributed;
      const allTotals = attributionTotals(attributionInput);
      const outRows = transactionRows.filter(row => row.direction === "out");
      const monthTotals = attributionTotals(attributionInput.filter(row => row.day.slice(0, 7) === dates.month));
      const lastMonthTotals = attributionTotals(attributionInput.filter(row => row.day.slice(0, 7) === dates.lastMonth));
      const attribution = {
        // The CSM's kickoff form is read (A087): the Marketing section shows its
        // Payment Amount beside front-end cash as typed, not money (2026-10-18).
        from: dates.from12, to: today, kickoffRead: true, tapRead: true,
        totals: { ...allTotals, out: ROUND2(outRows.reduce((sum, row) => sum + row.usd, 0)), outCount: outRows.length },
        mtd: monthTotals, lastMonth: lastMonthTotals, byPerson: attributionByPerson(attributionInput),
        ties,
        // What this run writes to cockpit_deal_payments, so a reader of the ledger can check it against this section.
        dealLedger: { rows: dealPayments.length, usd: ROUND2(dealPayments.reduce((sum, row) => sum + row.usd, 0)), from: dates.from12 },
        transactions: transactionRows.slice(0, 1500),
      };
      const clientPayments = attributed.filter(row => row.clientTaskId).map(row => ({
        payment_id: row.id, clickup_task_id: row.clientTaskId, client_name: row.clientName ?? row.dealBusiness ?? null,
        day: row.day, usd: row.usd, rail: row.rail, side: row.side, kind: row.kind, person: row.person, deal_response_id: row.dealResponseId ?? null,
      }));

      // Client ad spend over the twelve months (R2): the live media table
      // (USD, tied to the client through its campaign's ad account), the
      // snapshot table for the ad-days the live one lacks (kept current by the
      // Meta dashboard feed since 18 Oct), ads on the compromise list left
      // out of both (R3 and R17, 2026-10-22). The feed must be
      // ready, whole and written within the media sync's 3-hour stale line.
      const [mediaFeedRows, clientAdRows] = await Promise.all([
        sql(TRIAGE, `/* ceo-refresh:money.media_feed */ ${MEDIA_FEED_SQL}`),
        // Mahara's own accounts sit in the clients table too; they are the
        // company's own lead generation, not client spend (as Expenses does).
        sql(TRIAGE, `/* ceo-refresh:money.client_ads */ with days as (${mediaClientDaysSql(dates.from12, today)})
          select d.*, regexp_replace(lower(coalesce(c.name, '')), '[^[:alnum:]]', '', 'g') in ('maharamedia', 'maharamassdesign') as own
          from days d join public.clients c on c.id::text = d.client_id`),
      ]);
      let mediaFeed;
      try { mediaFeed = mediaFeedFresh(mediaFeedRows[0], now, MEDIA_STALE_MS); }
      catch (error) { failSource("Client ad spend (media daily statistics)", error instanceof Error ? error.message : String(error)); }
      const usdOf = row => (row.spend_usd === null || row.spend_usd === undefined ? 0 : num(row.spend_usd));
      const clientRows = clientAdRows.filter(row => row.own !== true);
      const clientAdSpend = {
        amount: ROUND2(clientRows.reduce((sum, row) => sum + usdOf(row), 0)),
        clients: new Set(clientRows.map(row => String(row.client_id))).size,
        ownUsd: ROUND2(clientAdRows.filter(row => row.own === true).reduce((sum, row) => sum + usdOf(row), 0)),
        unknownCurrencyDays: clientAdRows.filter(row => row.spend_usd === null || row.spend_usd === undefined).length,
      };
      sources.push({ name: "Client ad spend (media daily statistics)", freshestAt: mediaFeed.at, ok: true, note: `${clientAdSpend.clients} client ad accounts, $${clientAdSpend.amount.toFixed(2)} since ${dates.from12} (Mahara's own accounts, $${clientAdSpend.ownUsd.toFixed(2)}, left out); the live table starts ${mediaFeed.firstDay}; ads it does not hold come from the snapshot table, which the Meta dashboard feed has kept current since 18 Oct, matched by Meta ad id; ads on the compromise list are left out${clientAdSpend.unknownCurrencyDays ? `; ${clientAdSpend.unknownCurrencyDays} client days in a currency with no rate left out` : ""}` });

      const whopRail = { label: "Whop", connected: true, ...whopCash, refundsMtd: ROUND2(num(summary.refunds_mtd)), lastPaymentAt: epoch(summary.whop_last_paid_ms) };
      const manualDayTotals = new Map();
      for (const row of countedManual) if (row.day >= dates.from180) manualDayTotals.set(row.day, (manualDayTotals.get(row.day) ?? 0) + row.amountUsd);
      const manualDaily = [];
      for (let day = dates.from180; day <= today; day = addDays(day, 1)) manualDaily.push({ date: day, value: ROUND2(manualDayTotals.get(day) ?? 0) });
      const manualBetween = (from, to) => ROUND2(countedManual.filter(row => row.day >= from && row.day <= to).reduce((sum, row) => sum + row.amountUsd, 0));
      const manualConnected = activeManual.length > 0;
      const manualRail = {
        label: "Manual", connected: manualConnected,
        today: manualConnected ? manualBetween(today, today) : null,
        yesterday: manualConnected ? manualBetween(addDays(today, -1), addDays(today, -1)) : null,
        mtd: manualConnected ? manualBetween(monthStart(today), today) : null,
        lastMonthToDate: manualConnected ? manualBetween(dates.lastMonthStart, dates.lastMonthToDateEnd) : null,
        lastMonth: manualConnected ? manualBetween(dates.lastMonthStart, dates.lastMonthEnd) : null,
        projectedMonth: manualConnected ? ROUND2(manualBetween(monthStart(today), today) / dates.dayOfMonth * dates.dim) : null,
        refundsMtd: null, daily: manualConnected ? manualDaily : [],
        lastPaymentAt: manualConnected ? Math.max(0, ...countedManual.map(row => dayStart(row.day))) || null : null,
      };
      const bankDayTotals = new Map();
      for (const line of bankLines) if (line.kind === "client_payment" && line.day >= dates.from180) bankDayTotals.set(line.day, (bankDayTotals.get(line.day) ?? 0) + line.usd);
      // The bank rail knows nothing after the newest statement ends. A day
      // after it is missing, not $0 (since R1 a stale statement publishes):
      // the series stops there, a window that starts after it is null, and a
      // window that runs past it holds the statement's days only.
      const bankTo = bankFacts.latestStatementDay;
      const bankDaily = [];
      for (let day = dates.from180; day <= today && day <= bankTo; day = addDays(day, 1)) bankDaily.push({ date: day, value: ROUND2(bankDayTotals.get(day) ?? 0) });
      const bankBetween = (from, to) => from > bankTo ? null : ROUND2(bankDaily.filter(row => row.date >= from && row.date <= to).reduce((sum, row) => sum + row.value, 0));
      const bankNewestPayment = bankLines.filter(line => line.kind === "client_payment").map(line => line.day).sort().at(-1) ?? null;
      const bankMtd = bankBetween(monthStart(today), today);
      // Projected over the days the statement covers this month, not over every day so far.
      const bankDaysThisMonth = bankTo < monthStart(today) ? 0 : Math.min(dates.dayOfMonth, Number(bankTo.slice(8, 10)));
      const bankRail = {
        label: "Bank", connected: statementRows.length > 0, coveredTo: bankTo,
        today: bankBetween(today, today), yesterday: bankBetween(addDays(today, -1), addDays(today, -1)),
        mtd: bankMtd, lastMonthToDate: bankBetween(dates.lastMonthStart, dates.lastMonthToDateEnd),
        lastMonth: bankBetween(dates.lastMonthStart, dates.lastMonthEnd),
        projectedMonth: bankMtd === null || bankDaysThisMonth === 0 ? null : ROUND2(bankMtd / bankDaysThisMonth * dates.dim),
        refundsMtd: null, daily: bankDaily, lastPaymentAt: bankNewestPayment ? dayStart(bankNewestPayment) : null,
      };
      const connected = [whopRail, tapRail, ecomRail, manualRail, bankRail].filter(rail => rail.connected);
      const sumRails = key => connected.length ? ROUND2(connected.reduce((total, rail) => total + (rail[key] ?? 0), 0)) : null;
      const totalDaily = [];
      for (let day = dates.from180; day <= today; day = addDays(day, 1)) {
        const sum = connected.reduce((total, rail) => total + (rail.daily.find(point => point.date === day)?.value ?? 0), 0);
        totalDaily.push({ date: day, value: ROUND2(sum) });
      }
      const totalRail = {
        label: "All connected rails", connected: connected.length > 0,
        today: sumRails("today"), yesterday: sumRails("yesterday"), mtd: sumRails("mtd"),
        lastMonthToDate: sumRails("lastMonthToDate"), lastMonth: sumRails("lastMonth"), projectedMonth: sumRails("projectedMonth"),
        refundsMtd: sumRails("refundsMtd"), daily: totalDaily,
        lastPaymentAt: Math.max(0, ...connected.map(rail => rail.lastPaymentAt ?? 0)) || null,
      };
      const bankKinds = new Map();
      for (const line of bankLines) {
        const current = bankKinds.get(line.kind) ?? { count: 0, usd: 0 };
        current.count += 1;
        current.usd += line.usd;
        bankKinds.set(line.kind, current);
      }
      const statementPayload = statementRows.map(row => ({
        id: String(field(row, "id")), account: String(field(row, "account") ?? ""), accountKind: String(field(row, "account_kind", "accountKind") ?? "account"),
        fromDay: field(row, "from_day", "fromDay") ? dateText(field(row, "from_day", "fromDay")) : null,
        toDay: field(row, "to_day", "toDay") ? dateText(field(row, "to_day", "toDay")) : null,
        lines: num(field(row, "lines")), importedAt: epoch(field(row, "imported_at", "importedAt")),
      }));
      const expensesByMonth = new Map();
      for (const line of bankLines.filter(item => item.usd < 0 && ["expense", "fee", "excluded"].includes(item.kind))) {
        const key = line.day.slice(0, 7);
        const group = expensesByMonth.get(key) ?? { month: key, total: 0, byCategory: new Map(), excluded: { usd: 0, lines: 0 }, fees: 0 };
        const isExcluded = line.kind === "excluded" || bankFacts.excludedLines.some(item => item.line.id === line.id);
        if (isExcluded) { group.excluded.usd += Math.abs(line.usd); group.excluded.lines += 1; }
        else {
          group.total += Math.abs(line.usd);
          const category = line.category ?? "uncategorised";
          const current = group.byCategory.get(category) ?? { usd: 0, lines: 0 };
          current.usd += Math.abs(line.usd); current.lines += 1; group.byCategory.set(category, current);
        }
        if (line.kind === "fee") group.fees += Math.abs(line.usd);
        expensesByMonth.set(key, group);
      }
      const bankBlock = {
        lastStatementTo: bankFacts.latestStatementDay,
        daysSince: statementAge,
        stale: !bankFresh,
        statements: statementPayload,
        accounts: [...new Set(bankLines.map(line => line.account))],
        kinds: [...bankKinds].map(([kind, totals]) => ({ kind, label: kind, count: totals.count, usd: ROUND2(totals.usd) })),
        payouts: { count: payoutLines.length, matched: payoutMatches.size, usd: ROUND2(payoutLines.reduce((sum, row) => sum + row.usd, 0)), matchedUsd: ROUND2([...payoutMatches.values()].reduce((sum, row) => sum + row.usd, 0)) },
        tapSettlements: { count: settlements.length, usd: ROUND2(settlements.reduce((sum, row) => sum + row.usd, 0)), chargesCovered: tapCovered.size },
        manualCovered: manualCoveredByBank,
        expenses: [...expensesByMonth.values()].sort((a, b) => b.month.localeCompare(a.month)).map(row => ({
          month: row.month, total: ROUND2(row.total), byCategory: [...row.byCategory].map(([category, value]) => ({ category, usd: ROUND2(value.usd), lines: value.lines })),
          excluded: { usd: ROUND2(row.excluded.usd), lines: row.excluded.lines }, fees: ROUND2(row.fees),
        })),
        exclusions: bankFacts.exclusions.filter(row => !field(row, "removed_at", "removedAt")).map(row => ({ id: num(field(row, "id")), kind: String(field(row, "kind")), pattern: String(field(row, "pattern")), note: field(row, "note") ? cleanText(field(row, "note"), 200) : null })),
        unknown: bankLines.filter(line => line.kind === "unknown").length,
      };
      sources.push({ name: "Manual payment history, aliases, and payer mappings", freshestAt: epoch(field(snapshot, "updated_at", "updatedAt")) ?? undefined, ok: true, note: `Finance source revision ${sourceRevision}` });
      sources.push({ name: "Monthly targets", freshestAt: Math.max(0, ...targetRows.map(row => epoch(row.updated_ms) ?? 0)) || undefined, ok: true, note: targetRows.length ? undefined : "No monthly targets are currently loaded" });

      const duplicates = [
        ...cashDuplicates(livePayments.filter(row => row.day >= dates.from90 && !tapCoveredManual.has(row.id)),
          whopRows.map(row => ({ day: dateText(row.day), usd: ROUND2(num(row.net_amount)), business: null, matchNames: [row.billing, row.username].filter(Boolean).map(String) })),
          tapCharges, book),
        ...dealDuplicates(activeManual.filter(row => row.dealContractedUsd !== null), deals.map(row => ({ day: row.day, usd: ROUND2(num(row.contracted)), business: row.business })), book),
      ];
      const manualEntries = [...activeManual.filter(row => row.day.slice(0, 7) === dates.month), ...removedThisMonth]
        .sort((a, b) => b.day.localeCompare(a.day) || b.addedAt - a.addedAt)
        .map(row => ({ ...row, possibleDuplicate: row.deletedAt === null && duplicates.some(item => item.manualId === row.id), coveredByTap: tapCoveredManual.get(row.id) ?? null }));
      const dealsPayload = {
        mtd: dealsThisMonth?.deals ?? null,
        lastMonth: dealsLastMonth?.deals ?? null,
        contractedMtd: dealsThisMonth?.contracted ?? null,
        contractedLastMonth: dealsLastMonth?.contracted ?? null,
        manualMtd: activeManual.filter(row => row.kind !== "refund" && row.day.slice(0, 7) === dates.month && row.dealContractedUsd !== null).length,
        manualContractedMtd: ROUND2(activeManual.filter(row => row.day.slice(0, 7) === dates.month && row.dealContractedUsd !== null && !duplicates.some(item => item.manualId === row.id && item.against === "closer_form")).reduce((sum, row) => sum + num(row.dealContractedUsd), 0)),
        manualContractedLastMonth: ROUND2(activeManual.filter(row => row.day.slice(0, 7) === dates.lastMonth && row.dealContractedUsd !== null && !duplicates.some(item => item.manualId === row.id && item.against === "closer_form")).reduce((sum, row) => sum + num(row.dealContractedUsd), 0)),
        avgContract90d: summary.avg_contract_90 == null ? null : ROUND2(num(summary.avg_contract_90)),
        recent: recentDealRows.map(row => ({ date: row.day, business: row.business || null, closer: row.closer || null, contracted: row.contracted, cash: row.cash, plan: row.plan })),
      };
      const targets = {
        month: targetRows[0]?.month === dates.month ? dates.month : null,
        // The Edge Function's rules (finance/targets.ts): percent targets as fractions, CTR as link CTR. Only revenue and signed have actuals here.
        items: targetItems(targetRows.map(row => ({ metric: String(row.metric), projection: num(row.projection) })),
          Object.fromEntries([["revenue", dealsPayload.contractedMtd], ["signed", dealsPayload.mtd]].filter(([, value]) => typeof value === "number"))),
      };
      const ctrTargetNote = linkCtrTargetNote(targetRows.map(row => ({ month: String(row.month), metric: String(row.metric), projection: num(row.projection), updatedMs: epoch(row.updated_ms) })),
        month => new Date(`${month}-01T00:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }));
      const billingRows = bankInput.billing.map(row => ({
        taskId: String(field(row, "clickup_task_id", "clickupTaskId") ?? ""), name: String(field(row, "client_name", "name") ?? ""),
        stage: field(row, "stage") ?? null, mrrUsd: field(row, "mrr_usd", "mrrUsd") == null ? undefined : num(field(row, "mrr_usd", "mrrUsd")),
        ltvUsd: field(row, "ltv_usd", "ltvUsd") == null ? undefined : num(field(row, "ltv_usd", "ltvUsd")),
        nextPaymentAmountUsd: field(row, "next_payment_usd", "nextPaymentAmountUsd") == null ? undefined : num(field(row, "next_payment_usd", "nextPaymentAmountUsd")),
        paymentPlan: field(row, "payment_plan", "paymentPlan") ?? undefined, paymentMethod: field(row, "payment_method", "paymentMethod") ?? undefined,
        churnDate: field(row, "churn_date", "churnDate") ?? null, churnReason: field(row, "churn_reason", "churnReason") ?? null,
        pausedOn: field(row, "paused_on", "pausedOn") ?? null, nextContractRenewal: field(row, "next_renewal_date", "nextContractRenewal") ?? null,
        syncedAt: epoch(field(row, "captured_at", "capturedAt")) ?? now,
      }));
      if (!billingRows.length) failSource("Client billing snapshots", "no canonical billing snapshot is available");
      const billing = summariseBilling(billingRows);
      const recurring = billingRows.filter(row => groupOf(row.stage) === "active" && typeof row.mrrUsd === "number" && row.paymentPlan && !isOneOffPlan(row.paymentPlan));
      const projectedMrr = ROUND2(recurring.reduce((sum, row) => sum + num(row.mrrUsd), 0));
      const recurringIds = new Set(recurring.map(row => row.taskId));
      const collected = ROUND2(attributed.filter(row => row.clientTaskId && recurringIds.has(row.clientTaskId) && row.day.slice(0, 7) === dates.month).reduce((sum, row) => sum + row.usd, 0));
      const mrr = {
        groups: Object.entries(billing.mrr).map(([group, values]) => ({ group, ...values })),
        blank: billing.mrrBlank,
        internalCards: billing.internalCards,
        ltv: billing.ltv,
        paymentMethod: billing.paymentMethod,
        lifecycle: billing.lifecycle,
        cards: billing.cards,
        syncedAt: billing.syncedAt,
      };
      // Earlier months from the kept series (A124), the Edge rule
      // (cockpit-ceo-api finance/adapters/money.ts): every projected point
      // before this month, with what was collected that month beside it.
      const series = Array.isArray(snapshot.series) ? snapshot.series : null;
      const seriesPoints = (series ?? []).filter(row => String(field(row, "scope") ?? "") === "company")
        .map(row => ({ metric: String(field(row, "metric") ?? ""), month: dateText(field(row, "day", "date")).slice(0, 7), value: num(field(row, "value")) }))
        .filter(row => /^\d{4}-\d{2}$/.test(row.month));
      const collectedByMonth = new Map(seriesPoints.filter(row => row.metric === "money.book.collected").map(row => [row.month, row.value]));
      const bookHistory = [...new Map(seriesPoints.filter(row => row.metric === "money.book.projected" && row.month !== dates.month).map(row => [row.month, row])).values()]
        .sort((a, b) => a.month.localeCompare(b.month))
        .map(row => {
          const got = collectedByMonth.get(row.month) ?? 0;
          return { month: row.month, projected: ROUND2(row.value), collected: ROUND2(got), rate: row.value > 0 ? Math.round(got / row.value * 1000) / 1000 : null };
        });
      const bookPayload = {
        month: dates.month, projectedMrr, projectedCards: recurring.length, collected,
        collectionRate: projectedMrr > 0 ? Math.round(collected / projectedMrr * 1000) / 1000 : null,
        averageRetainer: recurring.length ? ROUND2(projectedMrr / recurring.length) : null,
        history: bookHistory,
      };
      const manualRefundsMtd = ROUND2(manualRefunds.filter(row => row.day >= monthStart(today) && row.day <= today).reduce((sum, row) => sum + row.amountUsd, 0));
      const manualRefunds90 = ROUND2(manualRefunds.filter(row => row.day >= dates.from90 && row.day <= today).reduce((sum, row) => sum + row.amountUsd, 0));
      const bankLatestMonth = bankFacts.latestStatementDay.slice(0, 7);
      const bankMonthLines = bankLines.filter(line => line.day.slice(0, 7) === bankLatestMonth && line.usd < 0 && ["expense", "fee", "excluded"].includes(line.kind));
      const monthlyWithManual = monthly.map(row => ({ ...row, manualCash: ROUND2(countedManual.filter(item => item.day.slice(0, 7) === row.month).reduce((sum, item) => sum + item.amountUsd, 0)), manualContracted: ROUND2(activeManual.filter(item => item.day.slice(0, 7) === row.month && item.dealContractedUsd !== null).reduce((sum, item) => sum + num(item.dealContractedUsd), 0)) }));
      const daily = [
        { date: today, metric: "money.failedCharges.count30d", scope: "company", value: num(summary.failed_count_30) },
        { date: today, metric: "money.failedCharges.amount30d", scope: "company", value: ROUND2(num(summary.failed_amount_30)) },
        { date: today, metric: "money.attribution.frontEndMtd", scope: "company", value: attribution.mtd.frontEnd },
        { date: today, metric: "money.attribution.backEndMtd", scope: "company", value: attribution.mtd.backEnd },
        { date: today, metric: "money.attribution.unattributedMtd", scope: "company", value: attribution.mtd.unattributed },
        { date: `${dates.month}-01`, metric: "money.book.projected", scope: "company", value: projectedMrr },
        { date: `${dates.month}-01`, metric: "money.book.collected", scope: "company", value: collected },
      ];
      // Each card's LTV field, per card and per day (R4), as the Edge copy
      // does: the earliest point per card is the LTV baseline the cockpit's
      // LTV write adds payments to (what a person typed before the cockpit
      // ever wrote the field), so a new card gets its baseline the day it
      // first appears.
      for (const row of billingRows) {
        if (row.taskId && typeof row.ltvUsd === "number" && Number.isFinite(row.ltvUsd)) {
          daily.push({ date: today, metric: "money.ltv.card", scope: `client:${row.taskId}`, value: ROUND2(row.ltvUsd) });
        }
      }
      const payload = {
        month: dates.month, dayOfMonth: dates.dayOfMonth, daysInMonth: dates.dim, cash: whopCash,
        rails: { whop: whopRail, tap: tapRail, ecom: ecomRail, manual: manualRail, bank: bankRail, total: totalRail },
        manualEntries, possibleDuplicates: duplicates, monthly: monthlyWithManual,
        refunds: { mtd: ROUND2(num(summary.refunds_mtd) + manualRefundsMtd), last90: ROUND2(num(summary.refunds_90) + manualRefunds90), manualMtd: manualRefundsMtd, manualLast90: manualRefunds90 },
        deals: dealsPayload,
        failedCharges: { count30d: num(summary.failed_count_30), amount30d: ROUND2(num(summary.failed_amount_30)) },
        expenses: { month: bankLatestMonth, total: ROUND2(bankMonthLines.reduce((sum, line) => sum + Math.abs(line.usd), 0)), byCategory: [...new Set(bankMonthLines.map(line => line.category ?? "uncategorised"))].map(category => ({ category, amount: ROUND2(bankMonthLines.filter(line => (line.category ?? "uncategorised") === category).reduce((sum, line) => sum + Math.abs(line.usd), 0)) })) },
        targets, mrr, attribution, bank: bankBlock, book: bookPayload,
        collection: { deals: deals.length, contracted: ROUND2(deals.reduce((sum, row) => sum + num(row.contracted), 0)), linkedCash: ROUND2(attributed.filter(row => row.dealResponseId).reduce((sum, row) => sum + row.usd, 0)), dealsWithCash: new Set(attributed.filter(row => row.dealResponseId).map(row => row.dealResponseId)).size, unlinkedCash: ROUND2(attributed.filter(row => !row.dealResponseId).reduce((sum, row) => sum + row.usd, 0)), unlinkedRows: attributed.filter(row => !row.dealResponseId).length, beforeFormCash: 0, formStarted: summary.first_deal_day ? String(summary.first_deal_day).slice(0, 7) : null, byMonth: monthly.map(row => ({ month: row.month, deals: row.deals, contracted: row.contracted, linked: ROUND2(attributed.filter(item => item.dealResponseId && item.day.slice(0, 7) === row.month).reduce((sum, item) => sum + item.usd, 0)) })), unmatched: [] },
        notes: [
          { level: "info", text: "Cash totals use source-confirmed Whop, Tap, manual, and uploaded bank statement rows. Bank payout and settlement lines are not counted as client cash." },
          { level: "info", text: attributionRuleText(allTotals.unattributedCount, allTotals.unattributed) },
          ...(ties.notApplied.length || ties.beforeDeal.length ? [{ level: "warn", text: tieNoteText(ties) }] : []),
          { level: "info", text: "Manual payments, human payer mappings, bank classifications, exclusions, and client billing snapshots came from the canonical Creative Triage finance revision." },
          ...(bankFresh ? [] : [{ level: "warn", text: `The newest bank statement ends ${bankFacts.latestStatementDay}, ${statementAge} days ago (past ${BANK_STALE_DAYS} days). Upload this week's CBK statement on this tab; until then the bank rail and the expense lines stop at that day: the bank's later days read n/a, not $0, and the all-rails total has no bank money after it.` }]),
          { level: "warn", text: `The newest bank statement ends ${bankFacts.latestStatementDay}; its classification revision is checked again before publication.` },
          ...(series ? [] : [{ level: "info", text: "Earlier months of the client book are not in this finance read, so the history is empty, not zero." }]),
          ...(tapCovered.size ? [{ level: "info", text: `${tapCovered.size} Tap charges are covered by bank settlement lines and were counted once.` }] : []),
          ...(manualCoveredByBank ? [{ level: "info", text: `${manualCoveredByBank} manual payments match bank client-payment lines and were counted once.` }] : []),
          ...(ctrTargetNote ? [ctrTargetNote] : []),
        ],
      };
      const liveManualStamp = epoch(field(snapshot, "newestManualChange", "newest_manual_change"));
      sources.push({ name: "Manual payment history and finance revision", freshestAt: liveManualStamp ?? undefined, ok: true, note: `revision ${sourceRevision}` });
      sources.push({ name: "Bank classification and exclusions", freshestAt: Math.max(0, ...statementRows.map(row => epoch(field(row, "imported_at", "importedAt")) ?? 0)) || undefined, ok: true, note: `${bankLines.length} canonical bank lines, ${bankFacts.exclusions.length} human exclusion rules` });
      sources.push({ name: "Payer mappings and client billing snapshots", freshestAt: Math.max(0, ...billingRows.map(row => row.syncedAt)) || undefined, ok: true, note: `${rowsFor(snapshot, "payers").length} human payer mappings` });
      sources.push({ name: "Whop, Tap and Ecom transaction attribution", freshestAt: Math.max(epoch(summary.whop_synced_ms) ?? 0, tapFreshAt, ecomFreshAt) || undefined, ok: true, note: `${clientPayments.length} client payment snapshots and ${dealPayments.length} deal payments computed; ${ties.applied} of ${ties.live} ties applied` });
      return { payload, sources, daily, clientPayments, dealPayments, financeRevision: sourceRevision };
    },
  };
}

