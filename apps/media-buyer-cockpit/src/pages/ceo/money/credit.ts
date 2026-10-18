import { isNum, money, plural, shortDate } from "@/components/ceo/format";
import type {
  AttributionTotals,
  TieRef,
  Transaction,
} from "@/types/ceo/payloads";

/**
 * Who every payment in is credited to, and why, in words (Aziz, 2026-10-18;
 * docs/money/MONEY-ATTRIBUTION.md rules 1 to 5), and what a tie would credit
 * before it is saved. The rule itself runs on the server, in two copies kept
 * equal by scripts/money-attribution-parity.test.ts:
 * hermes/ceo-refresh/native/adapters/money.js and
 * supabase/functions/cockpit-ceo-api/finance/attribution.ts. This file only
 * reads what they published and says it; the preview repeats the rule's
 * arithmetic so the CEO sees the effect first, and the refresh decides.
 * Pure, for scripts/money-screens.test.tsx.
 */

/** The deal's money is the closer's from this many days before the form (the rule's BEFORE_FORM_DAYS). */
export const BEFORE_FORM_DAYS = 7;
/** ... and at most this many days after signing (the rule's DEAL_TERM_DAYS). */
export const DEAL_TERM_DAYS = 120;

/**
 * A Transactions line as the money refresh publishes it: since 2026-10-18
 * with the deal it is credited against, the CEO's tie, "not client money"
 * and the remainder of a deal, all typed in src/types/ceo/payloads.ts
 * (optional there, so a payload stored before reads).
 */
export type MoneyLine = Transaction;

/** How a payment was tied, in words (rule 5). */
export const MATCH_LABEL: Record<string, string> = {
  ceo: "your tie",
  deal_id: "Whop's link to the deal",
  deal_email: "payer email on the closer form",
  deal_name: "business name on the closer form",
  card_email: "portal login on the client card",
  card_payer: "payer mapped by hand",
  card_name: "card name",
  card_typed: "card chosen when logged",
  none: "nothing matched",
};

/** A statement line that is not a client payment (a payout, a settlement): listed, never client money. */
export function isStatementLine(t: Pick<MoneyLine, "id">): boolean {
  return t.id.startsWith("bankline:");
}

/** A payment id the tie RPC takes (cockpit_payment_ties.payment_id's check). */
const TIEABLE = /^(whop|tap|transfer|bank|manual):[A-Za-z0-9_.-]+$/;

/** True for a payment in the CEO can tie: money in with an id the ledger keeps. */
export function canAttribute(t: Pick<MoneyLine, "id" | "direction">): boolean {
  return t.direction === "in" && t.id.length <= 200 && TIEABLE.test(t.id);
}

/** The person as written and their role: "Ahmed Abushaiba (closer)". */
export function creditedTo(t: Pick<MoneyLine, "person" | "personRole">) {
  if (!t.person) return null;
  return `${t.person} (${t.personRole === "closer" ? "closer" : "CSM"})`;
}

/**
 * The credit line every money-in row carries: "Credited to <person>
 * (closer|CSM) · <why>", "Not client money · your tie", or "Not credited ·
 * nothing matched". Null for money out and statement lines that are not
 * client money (a payout, a settlement), which credit nobody by design.
 */
export function creditLine(t: MoneyLine): string | null {
  if (t.direction !== "in" || !canAttribute(t)) return null;
  const why = MATCH_LABEL[t.matchedBy] ?? t.matchedBy;
  if (t.side === "not_client") return `Not client money · ${why}`;
  if (t.side === "unattributed") return `Not credited · ${why}`;
  const who = creditedTo(t);
  if (who) return `Credited to ${who} · ${why}`;
  return t.side === "front_end"
    ? `Credited to nobody: the closer form names no closer · ${why}`
    : `Credited to nobody: the client card names no CSM · ${why}`;
}

/** What the credit rests on: the deal's business or the client card. */
export function restsOn(t: MoneyLine): string | null {
  return t.dealBusiness ?? t.clientName ?? null;
}

/**
 * The part of a money-in line that is the deal's deposit (rule 1): the
 * published split, or on a payload stored before it, the whole line when its
 * kind is the deposit.
 */
export function depositPart(
  t: Pick<MoneyLine, "side" | "kind" | "usd" | "depositUsd">,
): number {
  if (t.side !== "front_end") return 0;
  if (isNum(t.depositUsd)) return t.depositUsd;
  return t.kind === "deposit" ? t.usd : 0;
}

/** The side and the kind in words: "Front end · deposit", or "Front end · $500 deposit, $5,108.80 rest of the deal" for a payment that is both. */
export function sideWords(t: MoneyLine): string {
  if (t.direction === "out")
    return t.kind === "refund" ? "Out · refund" : "Out";
  switch (t.side) {
    case "front_end": {
      const deposit = depositPart(t);
      if (deposit > 0 && deposit + 0.005 < t.usd)
        return `Front end · ${money(deposit)} deposit, ${money(r2(t.usd - deposit))} rest of the deal`;
      return `Front end · ${deposit > 0 ? "deposit" : "rest of the deal"}`;
    }
    case "back_end":
      return "Back end · client payment";
    case "not_client":
      return "Not client money";
    default:
      return "Not attributed";
  }
}

// --- People and payers ---

/** The payer key both copies of the rule match on (money.js nameKey). */
export function nameKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

const lowerEmail = (v: unknown) => {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  return s.includes("@") ? s : null;
};

/** A payer name the tie can key on: six letters or more and two words (never a first name alone). */
export function fullPayerName(name: string | null | undefined): boolean {
  const s = String(name ?? "").trim();
  return nameKey(s).length >= 6 && /\S\s+\S/.test(s);
}

/** Who "every payment from this payer" means: the email first, else the full name. */
export type PayerScope =
  | { payerEmail: string; label: string }
  | { payerKey: string; label: string }
  | { refused: string };

export function payerScope(
  email: string | null | undefined,
  name: string | null | undefined,
): PayerScope {
  const e = lowerEmail(email);
  if (e) return { payerEmail: e, label: e };
  const n = String(name ?? "").trim();
  if (fullPayerName(n)) return { payerKey: n, label: n };
  return {
    refused: n
      ? `"${n}" is a single name, so it could be anyone. Tie by email or the full payer name.`
      : "This payment has no payer email or name. Tie this payment alone.",
  };
}

/** The money-in lines a payer scope covers, as the rule matches them. */
export function linesForPayer(
  lines: MoneyLine[],
  scope: PayerScope,
): MoneyLine[] {
  if ("refused" in scope) return [];
  return lines.filter(t => {
    if (!canAttribute(t)) return false;
    if ("payerEmail" in scope)
      return lowerEmail(t.payerEmail) === scope.payerEmail;
    const key = nameKey(t.payerName);
    return key.length >= 6 && key === nameKey(scope.payerKey);
  });
}

/** The live payer-scope tie on any of these lines, if one is published. */
export function payerTieOf(lines: MoneyLine[]): {
  tie: TieRef;
  line: MoneyLine;
} | null {
  for (const line of lines)
    if (line.tie && line.tie.scope === "payer") return { tie: line.tie, line };
  return null;
}

// --- Signed deals ---

/** A signed deal as cockpit_sales_deals holds it (the closer form, B2B closed_deals). */
export type SignedDeal = {
  responseId: string;
  business: string | null;
  contact: string | null;
  email: string | null;
  closer: string | null;
  /** Kuwait day the form was submitted. */
  signedDay: string | null;
  contracted: number | null;
  /** The deposit the closer typed. */
  deposit: number | null;
  plan: string | null;
  voided: boolean;
};

/** A deal in the Attribute sheet's list, with the money already tied to it. */
export type DealOption = SignedDeal & {
  /** Money in the published list tied to this deal, front and back end. */
  collected: number;
  payments: number;
  /** True when the deal is known only from the payments tied to it (the closer form could not be read). */
  fromPaymentsOnly: boolean;
};

const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * The deals the sheet lists: every signed, not voided deal from the closer
 * form, newest first, with what is tied to it so far; plus any deal the
 * published payments name that the form read did not return (so a failed
 * read still lists the deals that have money).
 */
export function dealOptions(
  deals: SignedDeal[] | null | undefined,
  lines: MoneyLine[],
): DealOption[] {
  const tied = new Map<string, { usd: number; payments: number }>();
  const named = new Map<string, MoneyLine>();
  for (const t of lines) {
    if (t.direction !== "in" || !t.dealResponseId) continue;
    const c = tied.get(t.dealResponseId) ?? { usd: 0, payments: 0 };
    c.usd += t.usd;
    c.payments += 1;
    tied.set(t.dealResponseId, c);
    if (!named.has(t.dealResponseId) || t.personRole === "closer")
      named.set(t.dealResponseId, t);
  }
  const out: DealOption[] = [];
  const seen = new Set<string>();
  for (const d of deals ?? []) {
    if (!d.responseId || seen.has(d.responseId)) continue;
    seen.add(d.responseId);
    if (d.voided) continue;
    const c = tied.get(d.responseId);
    out.push({
      ...d,
      collected: r2(c?.usd ?? 0),
      payments: c?.payments ?? 0,
      fromPaymentsOnly: false,
    });
  }
  for (const [id, t] of named) {
    if (seen.has(id)) continue;
    const c = tied.get(id);
    out.push({
      responseId: id,
      business: t.dealBusiness,
      contact: null,
      email: null,
      closer: t.personRole === "closer" ? t.person : null,
      signedDay: null,
      contracted: null,
      deposit: null,
      plan: null,
      voided: false,
      collected: r2(c?.usd ?? 0),
      payments: c?.payments ?? 0,
      fromPaymentsOnly: true,
    });
  }
  return out.sort(
    (a, b) =>
      String(b.signedDay ?? "").localeCompare(String(a.signedDay ?? "")) ||
      String(a.business ?? "").localeCompare(String(b.business ?? "")),
  );
}

/** Whole days from one "YYYY-MM-DD" to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

const words = (v: string | null | undefined) =>
  String(v ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w.length >= 4);

/**
 * Why a deal may be the one, for the sheet's "Suggested" marks: the payer's
 * email on the form, a word of the payer's name in the contact's name, the
 * payer's name and the business name one inside the other, or the amount
 * equal to the deposit typed within a week of signing. Shown as
 * suggestions; nothing is tied by them.
 */
export function suggestion(
  deal: DealOption,
  payer: {
    email?: string | null;
    name?: string | null;
    usd?: number | null;
    day?: string | null;
  },
): string | null {
  const email = lowerEmail(payer.email);
  if (email && lowerEmail(deal.email) === email)
    return "the payer's email is on the form";
  const pw = new Set(words(payer.name));
  if (pw.size && words(deal.contact).some(w => pw.has(w)))
    return "the payer's name is the contact's on the form";
  const pk = nameKey(payer.name);
  const bk = nameKey(deal.business);
  if (pk.length >= 6 && bk.length >= 6 && (pk.includes(bk) || bk.includes(pk)))
    return "the payer's name is the business on the form";
  if (
    isNum(payer.usd) &&
    isNum(deal.deposit) &&
    deal.deposit > 0 &&
    payer.day &&
    deal.signedDay &&
    Math.abs(payer.usd - deal.deposit) <= Math.max(1, deal.deposit * 0.01) &&
    Math.abs(daysBetween(deal.signedDay, payer.day)) <= BEFORE_FORM_DAYS
  )
    return "the amount is the deposit typed on the form";
  return null;
}

/** The list the sheet shows for a search: suggestions first, then the rest newest first. */
export function searchDeals(
  options: DealOption[],
  query: string,
  payer: Parameters<typeof suggestion>[1],
  limit = 40,
): { deal: DealOption; why: string | null }[] {
  const q = query.trim().toLowerCase();
  const hits = options
    .filter(
      d =>
        !q ||
        [d.business, d.contact, d.closer, d.email, d.signedDay, d.plan]
          .filter(Boolean)
          .some(v => String(v).toLowerCase().includes(q)),
    )
    .map(deal => ({ deal, why: suggestion(deal, payer) }));
  const first = hits.filter(h => h.why);
  const rest = hits.filter(h => !h.why);
  return [...first, ...rest].slice(0, limit);
}

// --- What a tie would credit ---

export type TieTarget =
  | { kind: "deal"; deal: DealOption }
  | { kind: "card"; name: string }
  | { kind: "notClient" };

/** One payment in the tie's scope, as the preview needs it. */
type Paid = Pick<MoneyLine, "id" | "day" | "usd" | "dealResponseId">;

/**
 * What the tie will credit, in sentences, before it is saved. For a deal it
 * runs the rule's arithmetic on the payments in scope, oldest first, on top
 * of the money already tied to the deal: front end and the closer's while
 * the deal's tied cash is under its contract and the payment arrives at most
 * DEAL_TERM_DAYS after signing (the deposit up to the typed amount, then the
 * rest of the deal), back end and the card's CSM's beyond either. A payer
 * tie leaves a payment made more than BEFORE_FORM_DAYS before the form to the
 * automatic rules (an earlier engagement's); a tie on the one payment takes
 * it. The refresh decides; this says what to expect.
 */
export function tiePreview(
  target: TieTarget,
  payments: Paid[],
  scope: "payment" | "payer",
): string[] {
  const many = scope === "payer";
  const total = r2(payments.reduce((n, p) => n + p.usd, 0));
  const head = many
    ? `Covers ${plural(payments.length, "payment")} from this payer in the list (${money(total)}), and every one to come.`
    : null;
  if (target.kind === "notClient")
    return [
      head,
      "Kept out of client money: no side, nobody credited, and not in front-end cash.",
    ].filter((s): s is string => Boolean(s));
  if (target.kind === "card")
    return [
      head,
      `Back end, credited to ${target.name}'s CSM, unless the card has a deal signed within ${DEAL_TERM_DAYS} days whose contract is not yet paid: then it is that deal's money, front end, credited to its closer.`,
    ].filter((s): s is string => Boolean(s));

  const d = target.deal;
  // Money already on this deal, less the payments this tie moves (they are counted again below).
  let tied =
    d.collected -
    payments
      .filter(p => p.dealResponseId === d.responseId)
      .reduce((n, p) => n + p.usd, 0);
  tied = Math.max(0, r2(tied));
  const contract =
    isNum(d.contracted) && d.contracted > 0 ? d.contracted : null;
  const deposit = isNum(d.deposit) ? d.deposit : 0;
  let front = 0;
  let asDeposit = 0;
  let late = 0;
  let paidUp = 0;
  let early = 0;
  let earlyCount = 0;
  for (const p of [...payments].sort(
    (a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id),
  )) {
    const age = d.signedDay ? daysBetween(d.signedDay, p.day) : 0;
    if (many && age < -BEFORE_FORM_DAYS) {
      early += p.usd;
      earlyCount += 1;
      continue;
    }
    const open = contract === null || tied + 0.01 < contract;
    if (open && age <= DEAL_TERM_DAYS) {
      front += p.usd;
      // Only the part up to the typed deposit is deposit; with none typed, the first payment is it.
      if (deposit > 0 ? tied + 0.01 < deposit : tied === 0)
        asDeposit += deposit > 0 ? Math.min(p.usd, deposit - tied) : p.usd;
    } else if (!open) paidUp += p.usd;
    else late += p.usd;
    tied += p.usd;
  }
  front = r2(front);
  asDeposit = r2(asDeposit);
  const closer = d.closer ? `${d.closer} (closer)` : null;
  const out: string[] = [];
  if (head) out.push(head);
  if (early > 0)
    out.push(
      `${money(r2(early))} (${plural(earlyCount, "payment")}) paid more than ${BEFORE_FORM_DAYS} days before the deal's form${d.signedDay ? ` on ${shortDate(d.signedDay)}` : ""} stays with the automatic rules: it belongs to an earlier engagement. Tie such a payment on its own if it is this deal's.`,
    );
  if (front > 0) {
    const split =
      asDeposit > 0 && asDeposit < front
        ? ` (${money(asDeposit)} as the deposit, ${money(r2(front - asDeposit))} as the rest of the deal)`
        : asDeposit > 0
          ? " as the deposit"
          : " as the rest of the deal";
    out.push(
      closer
        ? `${money(front)} front end${split}, credited to ${closer}. It counts as cash closed on the closer's pay.`
        : `${money(front)} front end${split}, credited to nobody: the closer form names no closer.`,
    );
  }
  if (paidUp > 0)
    out.push(
      `${money(r2(paidUp))} back end, credited to the card's CSM: the deal's contract${contract ? ` (${money(contract)})` : ""} is already paid.`,
    );
  if (late > 0)
    out.push(
      `${money(r2(late))} back end, credited to the card's CSM: it arrives more than ${DEAL_TERM_DAYS} days after the deal was signed${d.signedDay ? ` on ${shortDate(d.signedDay)}` : ""}.`,
    );
  if (contract !== null)
    out.push(
      `The deal would then have ${money(r2(tied))} of its ${money(contract)} contract tied to it.`,
    );
  return out;
}

/** Front-end money in the published list by closer, for days the server keeps no split for (a custom range). */
export function byCloserFromLines(
  lines: MoneyLine[],
  from: string,
  to: string,
): { name: string; usd: number; payments: number }[] {
  const by = new Map<string, { name: string; usd: number; payments: number }>();
  for (const t of lines) {
    if (t.direction !== "in" || t.side !== "front_end") continue;
    if (t.day < from || t.day > to) continue;
    const name = t.person ?? "Closer not on the form";
    const k = name.toLowerCase();
    const c = by.get(k) ?? { name, usd: 0, payments: 0 };
    c.usd += t.usd;
    c.payments += 1;
    by.set(k, c);
  }
  return [...by.values()]
    .map(c => ({ ...c, usd: r2(c.usd) }))
    .sort((a, b) => b.usd - a.usd || a.name.localeCompare(b.name));
}

/** "Ahmed Abushaiba $12,000 · Closer Two $2,358.80", the biggest three and how many more. */
export function byCloserText(
  list: { name: string; usd: number }[] | null | undefined,
): string | null {
  if (!list) return null;
  if (!list.length) return "nobody yet";
  const shown = list.slice(0, 3).map(c => `${c.name} ${money(c.usd)}`);
  const more = list.length - shown.length;
  return `${shown.join(" · ")}${more > 0 ? ` · ${more} more` : ""}`;
}

/** The untie sentence, in the same shape as the tie's (ceoMoneyClient.tiedSentence). */
export const UNTIED_SENTENCE =
  "Tie removed. The payment goes back to the automatic rules after the next money refresh (about 15 minutes).";

// --- Ties saved before the refresh shows them ---

/**
 * A tie the CEO saved (or removed) in this session, before the next money
 * refresh publishes it: the row and the sheet say it at once, so nobody ties
 * the same payment twice. Dropped once the section has published since.
 */
export type PendingTie = {
  /** The tie's id: the new tie, or the one removed. */
  id: number;
  removed?: boolean;
  scope: "payment" | "payer";
  paymentId?: string;
  payerEmail?: string;
  payerKey?: string;
  /** What it was tied to, in words: "Haddad Interiors", "the card Client B Ltd". */
  target: string | null;
  /** Tied as money that is not a client's. */
  notClient?: boolean;
  note: string;
  /** When it was saved, epoch ms. */
  at: number;
};

/** Ties saved since the section last published: the ones the rows do not show yet. */
export function freshPending(
  pending: PendingTie[],
  lastRefreshAt: number | null | undefined,
): PendingTie[] {
  return pending.filter(p => p.at > (lastRefreshAt ?? 0));
}

/** Does a saved tie cover this payment: its own id, or its payer. */
function covers(
  p: PendingTie,
  t: Pick<MoneyLine, "id" | "payerEmail" | "payerName">,
) {
  if (p.scope === "payment") return p.paymentId === t.id;
  if (p.payerEmail) return lowerEmail(t.payerEmail) === p.payerEmail;
  const key = nameKey(t.payerName);
  return Boolean(p.payerKey) && key.length >= 6 && key === nameKey(p.payerKey);
}

/** The latest tie saved this session that covers a payment, if any (a payment's own tie before its payer's). */
export function pendingFor(
  t: Pick<MoneyLine, "id" | "payerEmail" | "payerName">,
  pending: PendingTie[],
): PendingTie | null {
  const hits = pending.filter(p => covers(p, t)).sort((a, b) => b.at - a.at);
  return hits.find(p => p.scope === "payment") ?? hits[0] ?? null;
}

/** The latest payer tie saved this session for a payer of the Money tab's list (an email or a full name). */
export function pendingForPayer(
  payer: string,
  pending: PendingTie[],
): PendingTie | null {
  const scope = payer.includes("@")
    ? payerScope(payer, null)
    : payerScope(null, payer);
  if ("refused" in scope) return null;
  const hits = pending
    .filter(
      p =>
        p.scope === "payer" &&
        ("payerEmail" in scope
          ? p.payerEmail === scope.payerEmail
          : Boolean(p.payerKey) &&
            nameKey(p.payerKey) === nameKey(scope.payerKey)),
    )
    .sort((a, b) => b.at - a.at);
  return hits[0] ?? null;
}

/** "Tied by you to Haddad Interiors · shows after the next refresh". */
export function pendingWords(p: PendingTie): string {
  if (p.removed) return "Tie removed by you · shows after the next refresh";
  if (p.notClient)
    return "Tied by you as not client money · shows after the next refresh";
  return `Tied by you to ${p.target ?? "your choice"} · shows after the next refresh`;
}

/** The totals the money refresh publishes, with the 2026-10-18 keys always there (they are added up here). */
export type MoneyTotals = Required<AttributionTotals> & {
  out: number;
  outCount: number;
};

/**
 * The headline numbers, added up from whichever payments are in view, as the
 * money refresh adds up its own: client money in, by side. Statement lines
 * that are not client money (payouts, settlements, own transfers) are left
 * out of money in, as the refresh leaves them out.
 */
export function moneyTotals(rows: MoneyLine[]): MoneyTotals {
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const ins = rows.filter(t => t.direction === "in" && !isStatementLine(t));
  const sum = (f: (t: MoneyLine) => boolean) =>
    r2(ins.filter(f).reduce((n, t) => n + t.usd, 0));
  const outs = rows.filter(t => t.direction === "out");
  const front = (t: MoneyLine) => t.side === "front_end";
  // The deposit is the part of each payment up to the typed deposit; the rest of it is the remainder.
  const deposit = r2(ins.reduce((n, t) => n + depositPart(t), 0));
  const frontEnd = sum(front);
  const remainder = r2(frontEnd - deposit);
  return {
    in: sum(() => true),
    count: ins.length,
    frontEnd,
    deposit,
    kickoff: remainder,
    remainder,
    backEnd: sum(t => t.side === "back_end"),
    unattributed: sum(t => t.side === "unattributed"),
    unattributedCount: ins.filter(t => t.side === "unattributed").length,
    notClient: sum(t => t.side === "not_client"),
    notClientCount: ins.filter(t => t.side === "not_client").length,
    out: r2(outs.reduce((n, t) => n + t.usd, 0)),
    outCount: outs.length,
  };
}
