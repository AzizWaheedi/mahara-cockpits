import { B2B, TRIAGE, num, sql } from "../sb.js";
import { addDays, daysInMonth, KUWAIT_OFFSET_MS, kuwaitDay, monthStart } from "../time.js";
import { bankCanBe, amountGap, coverWithTap, cashDuplicates, dealDuplicates, MATCH_DAYS, MATCH_GAP, nameBook } from "../manualMatch.js";
import { groupOf, isOneOffPlan, summariseBilling } from "../billing.js";

const STALE_MS = 60 * 60_000;
const TAP_STALE_MS = 3 * 60 * 60_000;
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

function cleanText(value, max = 240) {
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

function cardReferences(snapshot, loginRows) {
  const byTask = new Map();
  const add = (taskId, name, aliases, csm) => {
    if (!taskId) return;
    const id = String(taskId);
    const card = byTask.get(id) ?? { taskId: id, names: [], csm: csm ? String(csm).split(/\s+/)[0] : null, emails: [], payerKeys: [] };
    for (const value of [name, ...(Array.isArray(aliases) ? aliases : [])]) {
      const text = cleanText(value, 120);
      if (text && !card.names.includes(text)) card.names.push(text);
    }
    if (csm && !card.csm) card.csm = String(csm).split(/\s+/)[0];
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

function attributePayments(payments, deals, cards) {
  const dealById = new Map();
  const dealsByEmail = new Map();
  const dealsByName = new Map();
  for (const deal of deals) {
    if (deal.responseId) dealById.set(deal.responseId, deal);
    const email = String(deal.email ?? "").trim().toLowerCase();
    if (email) dealsByEmail.set(email, [...(dealsByEmail.get(email) ?? []), deal]);
    for (const name of [deal.business, deal.contactName]) {
      const key = nameKey(name);
      if (key.length >= 4) dealsByName.set(key, [...(dealsByName.get(key) ?? []), deal]);
    }
  }
  const cardById = new Map(cards.map(card => [card.taskId, card]));
  const cardByEmail = new Map();
  const cardByPayer = new Map();
  const cardByName = new Map();
  for (const card of cards) {
    for (const email of card.emails) cardByEmail.set(email.toLowerCase(), card);
    for (const payer of card.payerKeys) cardByPayer.set(nameKey(payer), card);
    for (const name of card.names) {
      const key = nameKey(name);
      if (key.length >= 4) cardByName.set(key, card);
    }
  }
  const lookup = (index, key) => {
    if (!key) return null;
    if (index.has(key)) return index.get(key);
    if (key.length < 6) return null;
    let best = null;
    let bestLength = 0;
    for (const [candidate, value] of index) {
      if (candidate.length >= 6 && (key.includes(candidate) || candidate.includes(key)) && candidate.length > bestLength) {
        best = value;
        bestLength = candidate.length;
      }
    }
    return best;
  };
  const nearest = (candidates, day) => candidates.reduce((best, deal) => {
    const gap = Math.round((Date.parse(deal.day) - Date.parse(day)) / 86_400_000);
    const score = gap >= 0 ? gap : Math.abs(gap) * 10;
    return !best || score < best.score ? { deal, score } : best;
  }, null)?.deal ?? null;
  const paidAgainst = new Map();
  const output = [];
  const sorted = [...payments].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
  for (const payment of sorted) {
    const email = String(payment.payerEmail ?? "").trim().toLowerCase();
    const payer = nameKey(payment.payerName);
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
    if (deal && (Date.parse(payment.day) - Date.parse(deal.day)) / 86_400_000 < -7) {
      deal = null;
      matchedBy = "none";
    }
    if (deal) {
      const age = Math.round((Date.parse(payment.day) - Date.parse(deal.day)) / 86_400_000);
      const windowDays = /monthly|month to month|months after|\/month/i.test(String(deal.paymentStructure ?? "")) ? 20 : 45;
      const paid = paidAgainst.get(deal.responseId) ?? 0;
      paidAgainst.set(deal.responseId, paid + payment.usd);
      const card = lookup(cardByName, nameKey(deal.business)) ?? cardByEmail.get(String(deal.email ?? "").toLowerCase()) ?? null;
      const renewal = payment.billingReason === "subscription_cycle";
      const depositOwed = deal.deposit > 0 ? paid + 0.01 < deal.deposit : paid === 0;
      const side = !renewal && age <= windowDays ? "front_end" : "back_end";
      const kind = side === "back_end" ? "client" : depositOwed ? "deposit" : "kickoff";
      output.push({ ...payment, side, kind, person: kind === "deposit" ? deal.closer : deal.csm ?? card?.csm ?? null, personRole: kind === "deposit" ? "closer" : "csm", dealResponseId: deal.responseId, dealBusiness: deal.business, clientTaskId: card?.taskId ?? null, clientName: card?.names[0] ?? deal.business, matchedBy });
      continue;
    }
    let card = email ? cardByEmail.get(email) ?? null : null;
    if (card) matchedBy = "card_email";
    else if (payer && cardByPayer.has(payer)) { card = cardByPayer.get(payer); matchedBy = "card_payer"; }
    else if (payer.length >= 4 && lookup(cardByName, payer)) { card = lookup(cardByName, payer); matchedBy = "card_name"; }
    else if (payment.clickupTaskId && cardById.has(payment.clickupTaskId)) { card = cardById.get(payment.clickupTaskId); matchedBy = "card_typed"; }
    output.push(card
      ? { ...payment, side: "back_end", kind: "client", person: card.csm, personRole: "csm", dealResponseId: null, dealBusiness: null, clientTaskId: card.taskId, clientName: card.names[0] ?? null, matchedBy }
      : { ...payment, side: "unattributed", kind: "none", person: null, personRole: null, dealResponseId: null, dealBusiness: null, clientTaskId: null, clientName: null, matchedBy: "none" });
  }
  return output;
}

function attributionTotals(rows) {
  const totals = { in: 0, count: rows.length, frontEnd: 0, deposit: 0, kickoff: 0, backEnd: 0, unattributed: 0, unattributedCount: 0 };
  for (const row of rows) {
    totals.in += row.usd;
    if (row.side === "front_end") {
      totals.frontEnd += row.usd;
      if (row.kind === "deposit") totals.deposit += row.usd;
      else totals.kickoff += row.usd;
    } else if (row.side === "back_end") totals.backEnd += row.usd;
    else { totals.unattributed += row.usd; totals.unattributedCount += 1; }
  }
  for (const key of ["in", "frontEnd", "deposit", "kickoff", "backEnd", "unattributed"]) totals[key] = ROUND2(totals[key]);
  return totals;
}

function attributionByPerson(rows) {
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
      const bankFresh = statementAge >= 0 && statementAge <= BANK_STALE_DAYS;
      sources.push({ name: "Bank statements and classification", freshestAt: Math.max(...bankFacts.statements.map(row => epoch(field(row, "imported_at", "importedAt")) ?? 0)) || undefined, ok: bankFresh, note: bankFresh ? undefined : `Newest statement ends ${bankFacts.latestStatementDay}; upload a current CBK statement before finance totals advance` });
      if (!bankFresh) failSource("Bank statements", `newest statement ends ${bankFacts.latestStatementDay}, ${statementAge} days ago`);

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

      const [recentDeals, targetRows, whopRows, transferRows, attributionDeals, loginRows, expenseRows] = await Promise.all([
        sql(B2B, `/* ceo-refresh:money.recent_deals */ SELECT to_char((submitted_at AT TIME ZONE 'Asia/Kuwait')::date,'YYYY-MM-DD') AS day,left(nullif(btrim(business_name),''),80) AS business,nullif(split_part(btrim(coalesce(closer,'')),' ',1),'') AS closer,contracted_revenue AS contracted,cash_collected AS cash,left(nullif(btrim(payment_structure),''),60) AS plan FROM public.closed_deals d WHERE submitted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.record_voids rv WHERE rv.entity='closed_deal' AND rv.record_id=d.response_id) ORDER BY submitted_at DESC LIMIT 10`),
        sql(B2B, `/* ceo-refresh:money.targets */ SELECT to_char(period_month,'YYYY-MM') AS month,metric,projection,floor(extract(epoch FROM updated_at)*1000)::bigint AS updated_ms FROM public.monthly_targets WHERE projection IS NOT NULL AND period_month=(SELECT max(period_month) FROM public.monthly_targets WHERE period_month<=date '${monthStart(today)}') ORDER BY metric`),
        sql(B2B, `/* ceo-refresh:money.attribution.whop */ SELECT payment_id,to_char(paid_on,'YYYY-MM-DD') AS day,net_amount,final_amount,refunded_amount,to_char((refunded_at AT TIME ZONE 'Asia/Kuwait')::date,'YYYY-MM-DD') AS refund_day,nullif(lower(btrim(user_email)),'') AS email,nullif(btrim(billing_name),'') AS billing,nullif(btrim(user_username),'') AS username,deal_response_id,billing_reason FROM public.whop_payments WHERE status='paid' AND currency='usd' AND paid_on>=date '${dates.from12}' ORDER BY paid_on`),
        sql(B2B, `/* ceo-refresh:money.attribution.transfers */ SELECT id,to_char(received_at,'YYYY-MM-DD') AS day,amount_usd,method,nullif(btrim(client_name),'') AS client,reference,deal_response_id FROM public.transfers WHERE received_at>=date '${dates.from12}' ORDER BY received_at`),
        sql(B2B, `/* ceo-refresh:money.attribution.deals */ SELECT response_id,to_char((submitted_at AT TIME ZONE 'Asia/Kuwait')::date,'YYYY-MM-DD') AS day,nullif(lower(btrim(email)),'') AS email,nullif(btrim(business_name),'') AS business,nullif(btrim(concat_ws(' ',client_first_name,client_last_name)),'') AS contact,closer,csm,cash_collected,payment_structure,contracted_revenue AS contracted FROM public.closed_deals d WHERE submitted_at>=date '${addDays(dates.from12, -90)}' AND NOT EXISTS(SELECT 1 FROM public.record_voids rv WHERE rv.entity='closed_deal' AND rv.record_id=d.response_id) ORDER BY submitted_at`),
        sql(B2B, `/* ceo-refresh:money.attribution.logins */ WITH docs AS (SELECT key,body FROM public.mahara_portal_documents WHERE key IN ('directory.json','client-access.json')),dir AS (SELECT e->>'id' AS client_id,e->>'clickupId' AS clickup_id FROM docs,jsonb_array_elements(CASE WHEN jsonb_typeof(body)='array' THEN body ELSE '[]'::jsonb END) e WHERE key='directory.json' AND coalesce(e->>'id','')<>'' AND coalesce(e->>'clickupId','')<>''),logins AS (SELECT lower(btrim(pr->>'email')) AS email,dir.clickup_id FROM docs CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(body->'profiles')='object' THEN body->'profiles' ELSE '{}'::jsonb END) p CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p.value->'principals')='array' THEN p.value->'principals' ELSE '[]'::jsonb END) pr JOIN dir ON dir.client_id=p.key WHERE key='client-access.json' AND jsonb_typeof(pr)='object' AND coalesce(btrim(pr->>'email'),'')<>'') SELECT email,min(clickup_id) AS clickup_id FROM logins GROUP BY email HAVING count(DISTINCT clickup_id)=1`),
        sql(B2B, `/* ceo-refresh:money.attribution.expenses */ SELECT id,to_char(incurred_at,'YYYY-MM-DD') AS day,amount_usd,category,vendor FROM public.expenses WHERE incurred_at>=date '${dates.from12}' ORDER BY incurred_at DESC LIMIT 10000`),
      ]);
      if (expenseRows.length >= 10_000) failSource("Expense transactions", "read limit was reached");
      const dealRefs = attributionDeals.filter(row => row.response_id && row.business).map(normalizeDeal);
      const recentDealRows = recentDeals.map(normalizeDeal);
      const dealsThisMonth = monthly.find(row => row.month === dates.month);
      const dealsLastMonth = monthly.find(row => row.month === dates.lastMonth);
      const [tapStateRows, tapRows] = await Promise.all([
        sql(TRIAGE, `/* ceo-refresh:money.tap_state */ SELECT ok,note,rows_seen,floor(extract(epoch FROM last_run_at)*1000)::bigint AS run_ms,floor(extract(epoch FROM last_ok_at)*1000)::bigint AS ok_ms FROM public.cockpit_sync_state WHERE key='tap-charges-sync'`),
        sql(TRIAGE, `/* ceo-refresh:money.tap_charges */ SELECT id,to_char(day,'YYYY-MM-DD') AS day,floor(extract(epoch FROM at)*1000)::bigint AS at_ms,currency,amount,usd,email,name FROM public.cockpit_tap_charges WHERE live AND status='CAPTURED' AND day BETWEEN date '${dates.from180}' AND date '${today}' ORDER BY at`),
      ]);
      const tapState = tapStateRows[0];
      const tapFreshAt = epoch(tapState?.ok_ms);
      if (!tapState || tapState.ok !== true || tapFreshAt === null || now - tapFreshAt > TAP_STALE_MS || now < tapFreshAt - 60_000) {
        failSource("Tap payment sync", tapState?.note ? cleanText(tapState.note, 120) : "no recent successful tap-charges-sync run");
      }
      const tapCharges = tapRows.map(row => ({
        id: String(row.id), day: dateText(row.day), at: num(row.at_ms), currency: String(row.currency ?? "USD"),
        amount: num(row.amount), usd: row.usd === null || row.usd === undefined ? null : ROUND2(num(row.usd)),
        email: row.email ? String(row.email).toLowerCase() : null, name: row.name ? cleanText(row.name, 100) : null,
      }));
      sources.push({ name: "Tap charges", freshestAt: tapFreshAt, ok: true });

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

      const paymentRows = [];
      for (const row of whopRows) if (num(row.net_amount) > 0) paymentRows.push({
        id: `whop:${row.payment_id}`, rail: "whop", day: dateText(row.day), usd: ROUND2(num(row.net_amount)), currency: "USD",
        amount: ROUND2(num(row.final_amount)), payerEmail: row.email ? String(row.email) : null,
        payerName: row.billing ? cleanText(row.billing, 120) : row.username ? cleanText(row.username, 120) : null,
        dealResponseId: row.deal_response_id ? String(row.deal_response_id) : null, clickupTaskId: null, billingReason: row.billing_reason ? String(row.billing_reason) : null,
      });
      for (const charge of tapCharges) if (charge.usd !== null && !tapCovered.has(charge.id)) paymentRows.push({
        id: `tap:${charge.id}`, rail: "tap", day: charge.day, usd: charge.usd, currency: charge.currency, amount: charge.amount,
        payerEmail: charge.email, payerName: charge.name, dealResponseId: null, clickupTaskId: null, billingReason: null,
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
      for (const row of countedManual) paymentRows.push({
        id: `manual:${row.id}`, rail: "manual", day: row.day, usd: row.amountUsd, currency: row.currency, amount: row.amount,
        payerEmail: null, payerName: row.client || null, dealResponseId: null, clickupTaskId: row.clickupTaskId, billingReason: null,
      });

      const deals = attributionDeals.map(normalizeDeal).filter(row => row.responseId && row.business);
      const attributed = attributePayments(paymentRows, deals, cards);
      const transactionRows = [];
      for (const row of attributed) transactionRows.push({
        id: row.id, day: row.day, rail: row.rail, direction: "in", usd: row.usd, currency: row.currency, amount: row.amount,
        payerEmail: row.payerEmail, payerName: row.payerName, side: row.side, kind: row.kind, person: row.person,
        personRole: row.personRole, dealBusiness: row.dealBusiness, clientName: row.clientName, clientTaskId: row.clientTaskId,
        matchedBy: row.matchedBy, detail: row.billingReason,
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
        from: dates.from12, to: today, kickoffRead: false, tapRead: true,
        totals: { ...allTotals, out: ROUND2(outRows.reduce((sum, row) => sum + row.usd, 0)), outCount: outRows.length },
        mtd: monthTotals, lastMonth: lastMonthTotals, byPerson: attributionByPerson(attributionInput),
        transactions: transactionRows.slice(0, 1500),
      };
      const clientPayments = attributed.filter(row => row.clientTaskId).map(row => ({
        payment_id: row.id, clickup_task_id: row.clientTaskId, client_name: row.clientName ?? row.dealBusiness ?? null,
        day: row.day, usd: row.usd, rail: row.rail, side: row.side, kind: row.kind, person: row.person,
      }));

      const [clientAdRows] = await sql(TRIAGE, `/* ceo-refresh:money.client_ads */ SELECT coalesce(sum(a.spend),0) AS spend,count(DISTINCT a.client_id) AS clients,floor(extract(epoch FROM max(a.last_synced_at))*1000)::bigint AS synced_ms FROM public.ads_daily_snapshots a WHERE a.date>=date '${dates.from12}'`);
      if (!clientAdRows) failSource("Creative Triage client ad snapshots", "query returned no row");
      const clientAdsAt = epoch(clientAdRows.synced_ms);
      addSource(sources, "Creative Triage client ad snapshots", clientAdsAt, now);
      const clientAdSpend = { amount: ROUND2(num(clientAdRows.spend)), clients: num(clientAdRows.clients) };

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
      const bankDaily = [];
      for (let day = dates.from180; day <= today; day = addDays(day, 1)) bankDaily.push({ date: day, value: ROUND2(bankDayTotals.get(day) ?? 0) });
      const bankBetween = (from, to) => ROUND2(bankDaily.filter(row => row.date >= from && row.date <= to).reduce((sum, row) => sum + row.value, 0));
      const bankNewestPayment = bankLines.filter(line => line.kind === "client_payment").map(line => line.day).sort().at(-1) ?? null;
      const bankRail = {
        label: "Bank", connected: statementRows.length > 0,
        today: bankBetween(today, today), yesterday: bankBetween(addDays(today, -1), addDays(today, -1)),
        mtd: bankBetween(monthStart(today), today), lastMonthToDate: bankBetween(dates.lastMonthStart, dates.lastMonthToDateEnd),
        lastMonth: bankBetween(dates.lastMonthStart, dates.lastMonthEnd),
        projectedMonth: ROUND2(bankBetween(monthStart(today), today) / dates.dayOfMonth * dates.dim),
        refundsMtd: null, daily: bankDaily, lastPaymentAt: bankNewestPayment ? dayStart(bankNewestPayment) : null,
      };
      const connected = [whopRail, tapRail, manualRail, bankRail].filter(rail => rail.connected);
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
        items: targetRows.map(row => ({ metric: String(row.metric), target: num(row.projection), actual: row.metric === "revenue" ? dealsPayload.contractedMtd : row.metric === "signed" ? dealsPayload.mtd : null })),
      };
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
      const bookPayload = {
        month: dates.month, projectedMrr, projectedCards: recurring.length, collected,
        collectionRate: projectedMrr > 0 ? Math.round(collected / projectedMrr * 1000) / 1000 : null,
        averageRetainer: recurring.length ? ROUND2(projectedMrr / recurring.length) : null,
        history: [],
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
      const payload = {
        month: dates.month, dayOfMonth: dates.dayOfMonth, daysInMonth: dates.dim, cash: whopCash,
        rails: { whop: whopRail, tap: tapRail, manual: manualRail, bank: bankRail, total: totalRail },
        manualEntries, possibleDuplicates: duplicates, monthly: monthlyWithManual,
        refunds: { mtd: ROUND2(num(summary.refunds_mtd) + manualRefundsMtd), last90: ROUND2(num(summary.refunds_90) + manualRefunds90), manualMtd: manualRefundsMtd, manualLast90: manualRefunds90 },
        deals: dealsPayload,
        failedCharges: { count30d: num(summary.failed_count_30), amount30d: ROUND2(num(summary.failed_amount_30)) },
        expenses: { month: bankLatestMonth, total: ROUND2(bankMonthLines.reduce((sum, line) => sum + Math.abs(line.usd), 0)), byCategory: [...new Set(bankMonthLines.map(line => line.category ?? "uncategorised"))].map(category => ({ category, amount: ROUND2(bankMonthLines.filter(line => (line.category ?? "uncategorised") === category).reduce((sum, line) => sum + Math.abs(line.usd), 0)) })) },
        targets, mrr, attribution, bank: bankBlock, book: bookPayload,
        collection: { deals: deals.length, contracted: ROUND2(deals.reduce((sum, row) => sum + num(row.contracted), 0)), linkedCash: ROUND2(attributed.filter(row => row.dealResponseId).reduce((sum, row) => sum + row.usd, 0)), dealsWithCash: new Set(attributed.filter(row => row.dealResponseId).map(row => row.dealResponseId)).size, unlinkedCash: ROUND2(attributed.filter(row => !row.dealResponseId).reduce((sum, row) => sum + row.usd, 0)), unlinkedRows: attributed.filter(row => !row.dealResponseId).length, beforeFormCash: 0, formStarted: summary.first_deal_day ? String(summary.first_deal_day).slice(0, 7) : null, byMonth: monthly.map(row => ({ month: row.month, deals: row.deals, contracted: row.contracted, linked: ROUND2(attributed.filter(item => item.dealResponseId && item.day.slice(0, 7) === row.month).reduce((sum, item) => sum + item.usd, 0)) })), unmatched: [] },
        notes: [
          { level: "info", text: "Cash totals use source-confirmed Whop, Tap, manual, and uploaded bank statement rows. Bank payout and settlement lines are not counted as client cash." },
          { level: "info", text: "Manual payments, human payer mappings, bank classifications, exclusions, and client billing snapshots came from the canonical Creative Triage finance revision." },
          { level: "warn", text: `The newest bank statement ends ${bankFacts.latestStatementDay}; its classification revision is checked again before publication.` },
          ...(tapCovered.size ? [{ level: "info", text: `${tapCovered.size} Tap charges are covered by bank settlement lines and were counted once.` }] : []),
          ...(manualCoveredByBank ? [{ level: "info", text: `${manualCoveredByBank} manual payments match bank client-payment lines and were counted once.` }] : []),
        ],
      };
      const liveManualStamp = epoch(field(snapshot, "newestManualChange", "newest_manual_change"));
      sources.push({ name: "Manual payment history and finance revision", freshestAt: liveManualStamp ?? undefined, ok: true, note: `revision ${sourceRevision}` });
      sources.push({ name: "Bank classification and exclusions", freshestAt: Math.max(0, ...statementRows.map(row => epoch(field(row, "imported_at", "importedAt")) ?? 0)) || undefined, ok: true, note: `${bankLines.length} canonical bank lines, ${bankFacts.exclusions.length} human exclusion rules` });
      sources.push({ name: "Payer mappings and client billing snapshots", freshestAt: Math.max(0, ...billingRows.map(row => row.syncedAt)) || undefined, ok: true, note: `${rowsFor(snapshot, "payers").length} human payer mappings` });
      sources.push({ name: "Whop and Tap transaction attribution", freshestAt: Math.max(epoch(summary.whop_synced_ms) ?? 0, tapFreshAt) || undefined, ok: true, note: `${clientPayments.length} client payment snapshots computed` });
      return { payload, sources, daily, clientPayments, financeRevision: sourceRevision };
    },
  };
}

