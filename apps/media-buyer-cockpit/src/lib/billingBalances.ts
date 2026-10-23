/**
 * Pending payments: who signed and has not finished paying, how much, and
 * by which day. Shared by the CEO cockpit's Billing tab and the client
 * success cockpit's Money > Billing.
 *
 * Aziz, 2026-10-23: "people who have pending payments in onboarding ... when
 * they sign up, they pay the deposit, and then on the onboarding call, they
 * pay the rest ... Anybody who hasn't finished the rest of the payment could
 * also go into the payment section as well. Unless they cancelled or paused."
 *
 * This file is the same in both apps (scripts/check-shared.sh holds it to
 * that), is pure (no network, no clock unless one is passed in) and imports
 * only ./billingCore, the sheet's own rules. It turns the rows of
 * cockpit_billing_balances_read() (supabase/migrations/20261023x) into the
 * parts of each client's plan and the section's figures. Plan and section 5's
 * expected list: hw-notes/billing-pending/PLAN.md (v2, 23 Oct 2026).
 *
 * The rule, in five lines:
 *   1. On the list: every signed client whose card is on the books (Active
 *      or in onboarding) and whose rails show less than 99% of the contract.
 *   2. Paid means a rail shows the money: Whop, Tap, Ecom, or a transfer,
 *      cheque or cash logged by hand that reached the ledger. A person's
 *      word, the closer's typed amount, the card's LTV and Maher's logs are
 *      never money.
 *   3. The amount is worked out per part of the plan (deposit, onboarding
 *      payment, second half, month 2 of 3 ...). Rail money fills the parts
 *      in order; Not seen is what is due and still empty.
 *   4. When another source says it was paid and no rail shows it, the amount
 *      moves out of Not seen into Another source says paid.
 *   5. Deposit at signing; onboarding payment on the onboarding call (the
 *      earliest record of it); later parts monthly from launch. An audited
 *      extension moves a part; an unexplained card date moves only a later
 *      part, by up to 21 days.
 *
 * Missing is never zero: a number the rows cannot give is null and the row
 * says why in words (a row with no contract value, a plan nobody can read or
 * no terms on record has amountsKnown false and null amounts; so does every
 * row while the money ledger has never run).
 */

import {
  type Account,
  addDays,
  daysBetween,
  isInternal,
  ladderOf,
} from "./billingCore";

// --- the read (cockpit_billing_balances_read) -------------------------------

export type ReadCard = {
  taskId: string;
  name: string;
  url: string | null;
  group: string | null;
  status: string | null;
  previousStatus: string | null;
  quiet?: boolean;
  plan: string | null;
  method?: string | null;
  nextUsd: number | null;
  nextDate: string | null;
  extensionWeeks: number | null;
  ltvFieldUsd: number | null;
  launchOn: string | null;
  signupOn: string | null;
  cardCallOn: string | null;
  noteAtOnboardingUsd: number | null;
  noteContractUsd: number | null;
  inOnboarding: boolean;
  firstPastOnboardingBookedOn: string | null;
  csm?: string | null;
};

export type ReadDeal = {
  responseId: string;
  signedAt: string;
  signedOn?: string | null;
  business: string | null;
  closer?: string | null;
  paymentStructure: string | null;
  agreementType?: string | null;
  contractUsd: number | null;
  depositUsd: number | null;
  atOnboardingUsd: number | null;
  secondPaymentUsd: number | null;
  newMrrUsd: number | null;
  taskId?: string | null;
  matchedBy?: "ledger" | "name" | "alias" | "link" | null;
  linkedByName?: string | null;
  conflict?: boolean;
  otherForms?: { responseId: string; signedAt: string }[];
  /** CEO only. */
  contactName?: string | null;
  /** CEO only: the other in-scope cards the deal's name also matches. */
  conflictWith?: { taskId: string; name: string }[];
};

export type ReadRail = {
  dealResponseId: string;
  paymentId: string;
  day: string;
  usd: number;
  rail: string;
  kind?: string | null;
  /** True for the deal ledger; false for the card's own payment since signing. */
  fromLedger: boolean;
  byHand: boolean;
};

export type ReadCall = {
  taskId: string;
  startsAt: string;
  status: string | null;
  source: string | null;
  matchMethod: string | null;
  confidence: number | null;
  /** A GHL booking still ahead (booked or confirmed, starts after now). */
  booked: boolean;
};

export type ReadKickoff = {
  taskId: string;
  submittedAt: string;
  kind: string;
  typedPayment: number | null;
};

export type ReadHistory = {
  taskId: string;
  day: string;
  ltvUsd: number | null;
  nextDate: string | null;
  nextUsd: number | null;
  stage: string | null;
};

export type ReadEvent = {
  id?: number;
  taskId: string;
  kind: string;
  from: string | null;
  to: string | null;
  reason: string | null;
  weeks: number | null;
  movedDate?: boolean | null;
  source?: string | null;
  byName: string | null;
  at: string;
};

export type ReadInbox = {
  id: number;
  taskId: string;
  paidOn: string | null;
  amount: number;
  currency: string;
  usd: number;
  method: string | null;
  source: string | null;
  status: string;
  statusNote: string | null;
  loggedByName: string | null;
  loggedAt: string;
};

export type ReadInvoice = {
  id?: string;
  taskId: string;
  invoiceNo: string | null;
  kind: string;
  amountUsd: number | null;
  issueDate: string | null;
  dueDate: string | null;
  status: string;
  payNote: string | null;
};

export type ReadEcom = {
  taskId: string;
  invoiceNumber: string | null;
  status?: string | null;
  amountKwd: number | null;
  usd: number | null;
  createdAt: string;
};

export type ConfirmPart = "deposit" | "onboarding" | "later" | "all";

export type ReadConfirmation = {
  id: number;
  taskId: string;
  dealResponseId: string | null;
  part: ConfirmPart;
  partNo: number;
  amount: number;
  currency: "USD" | "KWD";
  usd: number;
  rail: "whop" | "tap" | "ecom";
  paidOn: string;
  evidenceUrl: string | null;
  note: string | null;
  railsUsdAtConfirm: number | null;
  railsAsOf?: string | null;
  source: "ceo" | "csm";
  confirmedByName: string | null;
  confirmedByCeo: boolean;
  byYou?: boolean;
  confirmedAt: string;
  withdrawnByName: string | null;
  withdrawnAt: string | null;
  withdrawnReason: string | null;
};

export type ReadUntied = {
  id: string;
  day: string;
  rail: string;
  usd: number;
  currency: string | null;
  amount: number | null;
  /** CEO only. */
  payerName?: string | null;
};

export type ReadUnlinked = ReadDeal & {
  suggestedTaskId: string | null;
  suggestedName: string | null;
  suggestedSignupOn: string | null;
  rails: ReadRail[];
};

export type ReadSalesCard = {
  taskId: string;
  name: string;
  url: string | null;
  status: string | null;
  ltvFieldUsd: number | null;
  deal: ReadDeal | null;
  rails: ReadRail[];
};

/** What cockpit_billing_balances_read() returns (PLAN 3.1, as built in 20261023x). */
export type BalancesRead = {
  today: string;
  ceo: boolean;
  moneyAsOf: string | null;
  cardsAsOf: string | null;
  dealsAsOf: string | null;
  callsAsOf: string | null;
  untiedAsOf?: string | null;
  cards: ReadCard[];
  deals: ReadDeal[];
  rails: ReadRail[];
  calls: ReadCall[];
  kickoffs: ReadKickoff[];
  cardHistory: ReadHistory[];
  events: ReadEvent[];
  inbox: ReadInbox[];
  invoices: ReadInvoice[];
  ecomOpen: ReadEcom[];
  confirmations: ReadConfirmation[];
  untied: ReadUntied[];
  unlinked: ReadUnlinked[];
  backWithSales: ReadSalesCard[];
};

// --- what the screen gets -----------------------------------------------------

export type Tone = "neutral" | "good" | "warning" | "serious" | "critical";
export type PartKind = "deposit" | "onboarding" | "later";
export type PlanKind = "pif" | "split" | "monthly" | "m2m" | "unreadable";
export type ChipKey = "notSeen" | "onboarding" | "later" | "another" | "toCome";

/** One part of a client's plan, in dollars. rails + person + notSeen + another + notDue = usd. */
export type Part = {
  /** "deposit", "onboarding" or "later-<k>". */
  key: string;
  kind: PartKind;
  /** 0 for deposit and onboarding; k >= 1 for the k-th later part. */
  no: number;
  label: string;
  usd: number;
  /** Filled by rail money. */
  rails: number;
  /** Held by a person's confirmation no rail payment has proven yet. */
  person: number;
  /** Due, empty, and no other source says it was paid. */
  notSeen: number;
  /** Due, empty, and another source says it was paid. */
  another: number;
  /** Empty and not due yet. */
  notDue: number;
  /** The part of notSeen the closer typed on the form (deposit only). Never money. */
  typed: number;
  /** The day it is due; null when no day can be worked out yet. */
  due: string | null;
  /** Why that day, in words ("Call 19 Oct (GHL confirmed, Fathom held)"). */
  dueLine: string;
  isDue: boolean;
  /** Days since it was due (negative before the day); null with no day. */
  daysLate: number | null;
  tone: Tone;
  /** The part due next (the ribbon's tick). */
  next: boolean;
  /** Second sources for this part: inbox logs, "marked paid", invoices. */
  signals: string[];
};

export type RibbonState = "rails" | "person" | "notSeen" | "another" | "notDue";

/** One segment of the contract ribbon; share is of the contract. */
export type RibbonSegment = {
  partKey: string;
  state: RibbonState;
  usd: number;
  share: number;
  /** A not-seen segment the closer typed on the form. */
  typed: boolean;
};

export type ConfirmationView = ReadConfirmation & {
  /** The part it holds, or null when the part is not on the plan any more. */
  partKey: string | null;
  state: "proven" | "waiting" | "stale" | "withdrawn";
  /** The rail payment that proves it. */
  provenBy: { paymentId: string; day: string; usd: number } | null;
  /** Days since it was made. */
  ageDays: number;
  /** The words for the row ("Confirmed by you · waiting for Tap"). */
  line: string;
};

/** An untied payment that could be this part (the CEO's Possible money). Never money. */
export type Hint = {
  paymentId: string;
  day: string;
  rail: string;
  usd: number;
  currency: string | null;
  amount: number | null;
  payerName: string | null;
  taskId: string | null;
  dealResponseId: string;
  clientName: string;
  partKey: string;
  partLabel: string;
  /** payer: the payer looks like the contact or business; log: same day as a person's log; amount: amount and timing only. */
  rank: "payer" | "log" | "amount";
  why: string;
};

/** One untied payment and every part it could be, best first (the CEO's Possible money). */
export type PossiblePayment = {
  paymentId: string;
  day: string;
  rail: string;
  usd: number;
  currency: string | null;
  amount: number | null;
  payerName: string | null;
  /** The best rank among its candidates. */
  rank: Hint["rank"];
  candidates: Hint[];
};

/** A person's confirmation older than 7 days that no rail payment proves: the CEO looks for it. */
export type StaleConfirmation = {
  taskId: string;
  clientName: string;
  confirmation: ConfirmationView;
  line: string;
};

/** What the panel's Confirm paid offers: one entry per part with room left. */
export type Confirmable = {
  part: ConfirmPart;
  partNo: number;
  label: string;
  /**
   * The part's empty room (what neither the rails nor a person's unproven
   * confirmation holds), the amount the form starts with. Null when it
   * cannot be worked out (part "all" with no contract value or no terms on
   * record): the form starts empty, never at $0.
   */
  emptyUsd: number | null;
};

export type PendingRow = {
  taskId: string;
  name: string;
  url: string | null;
  status: string | null;
  group: string | null;
  inOnboarding: boolean;
  /** list: on the list and in the figures; quiet: GHOSTED (folded, never in a figure). */
  band: "list" | "quiet";
  /**
   * An Active card with no signed deal we could match whose card still asks
   * for a payment that is not late (signed before the deal copy starts on
   * 1 Apr 2026, or under another name). Listed under Still to come from the
   * card alone and kept out of every figure; its amounts are unknown.
   */
  cardOnly: boolean;
  deal: ReadDeal | null;
  signedOn: string | null;
  plan: PlanKind | null;
  planLabel: string;
  /** "Paid in full · Onboarding payment". */
  headline: string;
  contractUsd: number | null;
  /** Rail money on the deal; null while the money ledger has never run. */
  railsUsd: number | null;
  /** Contract minus rails; null with no contract, on month to month, or while the money ledger has never run. */
  leftUsd: number | null;
  finished: boolean;
  /**
   * False when the parts cannot be worked out (no contract value, a plan
   * nobody can read, no terms on record) or the money ledger has never run:
   * the amounts below are null and the screen reads n/a, never $0.
   */
  amountsKnown: boolean;
  parts: Part[];
  ribbon: RibbonSegment[];
  notSeenUsd: number | null;
  onboardingNotSeenUsd: number | null;
  laterNotSeenUsd: number | null;
  /**
   * The deposit and onboarding payment not due yet: what the onboarding call
   * still has to bring in (a call more than 2 days ahead, or not booked).
   * Never in Not seen.
   */
  upcomingOnboardingUsd: number | null;
  anotherUsd: number | null;
  /** Held by a person's unproven confirmations (known whenever the row is). */
  personUsd: number;
  typedUsd: number | null;
  tone: Tone;
  daysLate: number | null;
  /** The most pressing part's due line. */
  dueLine: string;
  /** How late that part is, or how soon it is due, in words ("4 days late", "due today", "in 7 days"); null with no day. */
  when: string | null;
  chips: ChipKey[];
  /** The card's LTV says more than the rails, but not enough to cover the row. */
  disagree: string | null;
  /** Missing data and warnings, in words. */
  notes: string[];
  /** "Where the numbers come from", one line per source. */
  sources: string[];
  confirmations: ConfirmationView[];
  confirmable: Confirmable[];
  /** CEO only: untied payments that fit a part. */
  hints: Hint[];
  rails: ReadRail[];
  /** Pending and refused billing-inbox logs for the card. */
  inbox: ReadInbox[];
  /** The next part with room left. */
  nextPart: {
    key: string;
    label: string;
    usd: number;
    due: string | null;
  } | null;
  /** When the card's Next Payment Amount or Date is blank or differs from the next part ("Put the next part on the card"). */
  cardNext: {
    usd: number;
    date: string | null;
    amountDiffers: boolean;
    dateDiffers: boolean;
  } | null;
};

export type SalesRow = {
  taskId: string;
  name: string;
  url: string | null;
  signedOn: string;
  business: string | null;
  dealResponseId: string;
  planLabel: string;
  contractUsd: number | null;
  /** Null while the money ledger has never run. */
  railsUsd: number | null;
  /** Null with no contract value, or while the money ledger has never run. */
  leftUsd: number | null;
  /** The CEO may confirm on these cards (20261023y); his confirmations show here. */
  confirmations: ConfirmationView[];
  personUsd: number;
  /**
   * The parts with room left once the rails fill them in order and the
   * unproven confirmations hold theirs (no dates: the card is with sales);
   * "What they paid in all" when the plan's parts cannot be worked out.
   */
  confirmable: Confirmable[];
};

export type UnlinkedRow = {
  deal: ReadDeal;
  signedOn: string;
  planLabel: string;
  contractUsd: number | null;
  /** Null while the money ledger has never run. */
  railsUsd: number | null;
  leftUsd: number | null;
  suggested: { taskId: string; name: string; signupOn: string | null } | null;
  line: string;
  /** The row this deal would make on the suggested card once linked. */
  preview: PendingRow | null;
  hints: Hint[];
};

/**
 * One figure: the dollars and the clients they come from. usd is null while
 * the money ledger has never run. unknown counts the listed clients whose
 * amount for this figure cannot be worked out (no contract value, a plan
 * nobody can read, no terms on record, or no money ledger): they are never
 * counted as $0, and the screen says how many.
 */
export type Figure = { usd: number | null; count: number; unknown: number };

export type PendingView = {
  today: string;
  ceo: boolean;
  asOf: {
    money: string | null;
    cards: string | null;
    deals: string | null;
    calls: string | null;
    untied: string | null;
  };
  /** The money ledger never ran: every figure and every row's amounts read n/a (the rows' amounts are null). */
  moneyMissing: boolean;
  /**
   * Each feed against its own schedule: money older than one hour (the
   * refresh runs every 15 minutes); the client cards older than billing-sync's
   * last run that was due (every half hour 06:07 to 21:37 Kuwait, then
   * 00:17); the closer forms older than 15 minutes (the sales mirror copies
   * them every 3); the onboarding calls older than 45 minutes (read every 15).
   */
  stale: { money: boolean; cards: boolean; deals: boolean; calls: boolean };
  /** "Money last read at 15:38. A payment made after that shows at the next refresh." */
  staleLine: string | null;
  /** The same for the client cards, the closer forms and the onboarding calls, one sentence each. */
  staleLines: string[];
  figures: {
    onboarding: Figure;
    later: Figure;
    notSeen: Figure;
    /** Deposits and onboarding payments not due yet (Expected on upcoming onboarding calls); never in Not seen. */
    upcoming: Figure;
    another: Figure;
    person: Figure;
    typed: Figure;
  };
  chips: { key: ChipKey; label: string; count: number }[];
  rows: PendingRow[];
  /** leftUsd adds the rows that have one; the line names the rows that have none. Null while the money ledger has never run. */
  quiet: { rows: PendingRow[]; leftUsd: number | null; line: string | null };
  /** CEO only (null for anyone else). leftUsd as for quiet. */
  backWithSales: {
    rows: SalesRow[];
    leftUsd: number | null;
    line: string;
  } | null;
  /** CEO only (empty for anyone else). */
  unlinked: UnlinkedRow[];
  /** Active cards late on their card's next payment with no signed deal we could match, each with what the card asks. */
  footnote: { names: string[]; line: string } | null;
  /** Listed cards whose deal the rails show finished: at 99% of the contract, or on month to month once the deposit and first month are on the rails. */
  finished: {
    taskId: string;
    name: string;
    railsUsd: number;
    contractUsd: number;
  }[];
  /** "Finished on the rails: Makers, Shades." (null when nobody finished). */
  finishedLine: string | null;
  /** CEO only: untied payments that fit a part of a listed row or a deal with no card, best first. Never money. */
  possibleMoney: PossiblePayment[];
  staleConfirmations: StaleConfirmation[];
  /** The line for the empty "Not seen" chip ("Nothing due is unseen. Next: Ardon, $2,000 on 27 Oct."). */
  nothingDueLine: string;
};

// --- small helpers ----------------------------------------------------------

const RAIL_NAME: Record<string, string> = {
  whop: "Whop",
  tap: "Tap",
  ecom: "Ecom",
  manual: "transfer",
  transfer: "transfer",
  bank: "bank",
};
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TONE_RANK: Record<Tone, number> = {
  neutral: 0,
  good: 1,
  warning: 2,
  serious: 3,
  critical: 4,
};
/** The onboarding form asked the two amounts from this day (PLAN 2.1). */
const FORM_ASKS_FROM = "2026-08-29";
/** Terms older than this read "Check they still hold". */
const OLD_TERMS_DAYS = 120;

/** money.js nameKey: NFKD, marks stripped, lower case, letters and digits only. */
export function nameKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

const cents = (usd: number | null | undefined): number =>
  usd === null || usd === undefined || !Number.isFinite(Number(usd))
    ? 0
    : Math.round(Number(usd) * 100);
const dollars = (c: number): number => Math.round(c) / 100;
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** "$5,750" or "$3,502.82". */
export function usdText(usd: number | null | undefined): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return "n/a";
  const whole = Math.abs(usd - Math.round(usd)) < 0.005;
  return `$${(whole ? Math.round(usd) : usd).toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

/** "19 Oct", with the year when it is not this year. */
export function dayText(
  day: string | null | undefined,
  today?: string,
): string {
  if (!day || !DAY_RE.test(day)) return "no date";
  const [y, m, d] = day.split("-").map(Number);
  const year = today && today.slice(0, 4) !== day.slice(0, 4) ? ` ${y}` : "";
  return `${d} ${MONTHS[m - 1]}${year}`;
}

/** The Kuwait day of a timestamp ("2026-10-19T12:00:00+03:00" -> "2026-10-19"). */
export function kuwaitDayOf(ts: string | null | undefined): string | null {
  if (!ts) return null;
  if (DAY_RE.test(ts)) return ts;
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return null;
  return new Date(t + 3 * 3600_000).toISOString().slice(0, 10);
}

/** The same day k months on, clamped to the month's last day (31 Aug + 1 = 30 Sep). */
export function addMonths(day: string, k: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + k, 1));
  const last = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

const firstName = (name: string | null | undefined): string =>
  String(name ?? "")
    .trim()
    .split(/\s+/)[0] || "someone";

const worse = (a: Tone, b: Tone): Tone => (TONE_RANK[b] > TONE_RANK[a] ? b : a);

/** Days late in words: "4 days late", "due today", "in 7 days". */
export function whenWords(daysLate: number): string {
  const n = Math.abs(daysLate);
  const days = `${n} day${n === 1 ? "" : "s"}`;
  if (daysLate > 0) return `${days} late`;
  if (daysLate === 0) return "due today";
  return `in ${days}`;
}

const railName = (rail: string | null | undefined): string =>
  RAIL_NAME[String(rail ?? "").toLowerCase()] ?? String(rail ?? "a rail");

/** pg_trgm's trigrams: each word padded with two spaces before and one after. */
function trigrams(value: string): Set<string> {
  const out = new Set<string>();
  const words = String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u);
  for (const w of words) {
    if (!w) continue;
    const p = `  ${w} `;
    for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  }
  return out;
}

/** pg_trgm similarity(): shared trigrams over all trigrams. */
export function similarity(a: string, b: string): number {
  const x = trigrams(a);
  const y = trigrams(b);
  if (x.size === 0 || y.size === 0) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  return shared / (x.size + y.size - shared);
}

const hasLatin = (s: string | null | undefined) => /[A-Za-z]/.test(s ?? "");

// --- the plan -----------------------------------------------------------------

export function planOf(text: string | null | undefined): PlanKind {
  const s = String(text ?? "");
  if (/month.?to.?month/i.test(s)) return "m2m";
  if (/full/i.test(s)) return "pif";
  if (/split/i.test(s)) return "split";
  if (/monthly/i.test(s)) return "monthly";
  return "unreadable";
}

const PLAN_LABEL: Record<PlanKind, string> = {
  pif: "Paid in full",
  split: "Split",
  monthly: "Monthly",
  m2m: "Month to month",
  unreadable: "Plan not readable",
};

type PartSpec = { kind: PartKind; no: number; label: string; c: number };

/**
 * The parts of a deal's plan in cents, in order, adding up to the contract
 * (PLAN 1.2 "Plan"). The typed deposit cuts the parts and never fills one; a
 * part of $0 is dropped; the last later part absorbs rounding and whatever
 * 36 months leave. A monthly amount under a 36th of the contract is a typo
 * on the form: the contract over three is used and the row says so.
 */
export function partsOf(deal: ReadDeal): {
  plan: PlanKind;
  specs: PartSpec[];
  notes: string[];
} {
  const plan = planOf(deal.paymentStructure);
  const notes: string[] = [];
  const C = cents(deal.contractUsd);
  if (C <= 0 || plan === "unreadable") return { plan, specs: [], notes };
  const D = Math.min(Math.max(cents(deal.depositUsd), 0), C);
  const O = numOrNull(deal.atOnboardingUsd);
  const S = numOrNull(deal.secondPaymentUsd);
  const M = numOrNull(deal.newMrrUsd);
  const specs: PartSpec[] = [];
  const push = (kind: PartKind, no: number, label: string, c: number) => {
    if (c > 0) specs.push({ kind, no, label, c });
  };
  if (plan === "pif") {
    push("deposit", 0, "Deposit", D);
    push("onboarding", 0, "Onboarding payment", C - D);
    if (O !== null && Math.abs(cents(O) - (C - D)) > 100)
      notes.push(
        `The closer form says ${usdText(O)} at onboarding; the contract leaves ${usdText(dollars(C - D))}.`,
      );
    return { plan, specs, notes };
  }
  // Monthly and month to month: one month is F; month 1 = deposit + onboarding.
  // A typed month under C/36 would leave part of the contract in no part.
  const fits = (v: number | null): v is number =>
    v !== null && v > 0 && cents(v) * 36 >= C;
  const F = fits(M)
    ? cents(M)
    : fits(S)
      ? cents(S)
      : plan === "m2m"
        ? C
        : Math.round(C / 300) * 100;
  const typo = [M, S].find(v => v !== null && v > 0 && !fits(v));
  if (plan !== "split" && typo !== undefined)
    notes.push(
      `The closer form's monthly amount ${usdText(typo)} looks wrong for a ${usdText(dollars(C))} contract; ${usdText(dollars(F))} a month is used.`,
    );
  if (plan === "split") {
    const onb = Math.min(
      O !== null ? cents(O) : Math.max(0, Math.round(C / 2) - D),
      C - D,
    );
    push("deposit", 0, "Deposit", D);
    push("onboarding", 0, "Onboarding payment", onb);
    const second = C - D - onb;
    push("later", 1, "Second half", second);
    if (S !== null && S > 0 && Math.abs(cents(S) - second) > 100)
      notes.push(
        `The closer form says ${usdText(S)} for the second payment; the contract leaves ${usdText(dollars(second))}.`,
      );
    return { plan, specs, notes };
  }
  const onb = Math.min(
    O !== null ? cents(O) : Math.max(0, F - D),
    Math.max(0, C - D),
  );
  push("deposit", 0, "Deposit", D);
  push("onboarding", 0, "Onboarding payment", onb);
  if (plan === "m2m") return { plan, specs, notes };
  const size = fits(S) ? cents(S) : F;
  let left = C - D - onb;
  const later: number[] = [];
  while (left > 0 && later.length < 36 && size > 0) {
    let c = Math.min(size, left);
    if (left - c <= size / 100) c = left;
    later.push(c);
    left -= c;
  }
  // Whatever is left still belongs to the contract: the parts always add up to it.
  if (left > 0) {
    if (later.length > 0) later[later.length - 1] += left;
    else later.push(left);
  }
  for (const [i, c] of later.entries())
    push("later", i + 1, `Month ${i + 2} of ${later.length + 1}`, c);
  return { plan, specs, notes };
}

// --- dates ----------------------------------------------------------------------

type DueInfo = {
  due: string | null;
  line: string;
  /** Counts from two days before (a booked call still ahead). */
  booked: boolean;
  /** Due although no day is on record (past onboarding, no record of the call). */
  dueWithoutDay: boolean;
};

const PAST_CALL = new Set(["held", "showed", "confirmed"]);
const PAST_ONBOARDING_BOOKED =
  /^\s*(brand blueprint booked|launch booked|ready for launch|active)/i;

function callWords(c: ReadCall): string {
  const src = c.source === "fathom" ? "Fathom" : "GHL";
  const named =
    c.confidence !== null && c.confidence < 0.8 ? ", matched by name" : "";
  return `${src} ${c.status ?? "on record"}${named}`;
}

/** "19 Oct 12:00": the day, and the time of the GHL booking when one is on record (a Fathom start is when the recording began). */
function callDay(day: string, calls: ReadCall[], today: string): string {
  const ghl = calls
    .filter(c => c.source !== "fathom" && kuwaitDayOf(c.startsAt) === day)
    .map(c => c.startsAt)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const time = ghl && !DAY_RE.test(ghl) ? kuwaitTime(ghl) : null;
  return `${dayText(day, today)}${time ? ` ${time}` : ""}`;
}

/** The onboarding day: the earliest record of the call (PLAN 1.2 "Due dates"). */
function onboardingDue(
  card: ReadCard,
  signedOn: string,
  calls: ReadCall[],
  kickoffs: ReadKickoff[],
  today: string,
): DueInfo {
  const floor = addDays(signedOn, -7);
  const options: { day: string; rank: number; line: string }[] = [];
  const past = calls.filter(
    c => !c.booked && PAST_CALL.has(String(c.status ?? "").toLowerCase()),
  );
  const callDays = new Map<string, ReadCall[]>();
  for (const c of past) {
    const d = kuwaitDayOf(c.startsAt);
    if (!d || d < floor || d > today) continue;
    callDays.set(d, [...(callDays.get(d) ?? []), c]);
  }
  for (const [d, list] of callDays)
    options.push({
      day: d,
      rank: 0,
      line: `Call ${callDay(d, list, today)} (${list.map(callWords).join(", ")})`,
    });
  for (const k of kickoffs) {
    const d = kuwaitDayOf(k.submittedAt);
    if (!d || d < floor) continue;
    options.push({
      day: d,
      rank: 1,
      line: `Onboarding call not on record · kickoff form ${dayText(d, today)}${k.kind === "kickoff_old" ? " (old form)" : ""}`,
    });
  }
  const past0 = card.firstPastOnboardingBookedOn;
  if (past0 && past0 >= floor)
    options.push({
      day: past0,
      rank: 2,
      line: `Onboarding call not on record · card moved past Onboarding Booked ${dayText(past0, today)}`,
    });
  options.sort((a, b) => a.day.localeCompare(b.day) || a.rank - b.rank);
  if (options.length > 0)
    return {
      due: options[0].day,
      line: options[0].line,
      booked: false,
      dueWithoutDay: false,
    };
  const ahead = calls
    .filter(c => c.booked)
    .map(c => kuwaitDayOf(c.startsAt))
    .filter((d): d is string => Boolean(d))
    .sort();
  if (ahead.length > 0)
    return {
      due: ahead[0],
      line: `Call ${callDay(ahead[0], calls, today)} (booked)`,
      booked: true,
      dueWithoutDay: false,
    };
  // The card's own Onboarding Call Date, when the GHL onboarding calendar has
  // no booking: it warns from two days before like a booked call, labelled
  // as the card's date (a success manager may have typed a plan, not a
  // booking).
  const cardCall = card.cardCallOn;
  if (cardCall && DAY_RE.test(cardCall) && cardCall >= floor)
    return {
      due: cardCall,
      line: `Call ${dayText(cardCall, today)} (card date, not on the GHL onboarding calendar)`,
      booked: true,
      dueWithoutDay: false,
    };
  if (card.launchOn && card.launchOn >= floor)
    return {
      due: card.launchOn,
      line: `Onboarding call not on record · launched ${dayText(card.launchOn, today)}`,
      booked: false,
      dueWithoutDay: false,
    };
  const past1 =
    card.group === "active" ||
    PAST_ONBOARDING_BOOKED.test(String(card.status ?? ""));
  return past1
    ? {
        due: null,
        line: "Past onboarding, and no onboarding call, kickoff form or launch day on record",
        booked: false,
        dueWithoutDay: true,
      }
    : {
        due: null,
        line: NOT_BOOKED,
        booked: false,
        dueWithoutDay: false,
      };
}

/** An onboarding payment whose call nobody booked: what to do so the row warns in time. */
export const NOT_BOOKED =
  "Onboarding call not booked yet. Book it on the GHL onboarding calendar so this warns 2 days before.";

// --- one client -------------------------------------------------------------------

type Ctx = {
  read: BalancesRead;
  today: string;
  now: number;
  byTask: <T extends { taskId: string }>(list: T[], taskId: string) => T[];
};

type Work = {
  spec: PartSpec;
  key: string;
  railsC: number;
  personC: number;
  emptyC: number;
  due: string | null;
  dueLine: string;
  booked: boolean;
  dueWithoutDay: boolean;
  /** The plan's own day, before any move. */
  planDue: string | null;
  moved: boolean;
  markedPaid: string | null;
  /** A live invoice asks for it: warning until holdUntil; lateness then counts from agreedDue when it gave one. */
  ask: { holdUntil: string; agreedDue: string | null; line: string } | null;
  signals: string[];
  isDue: boolean;
  notSeenC: number;
  anotherC: number;
  notDueC: number;
};

const keyOf = (kind: PartKind, no: number) =>
  kind === "later" ? `later-${no}` : kind;

/** The part a confirmation holds, or null for "all" or a part the plan no longer has. */
function confirmationKey(c: ReadConfirmation, keys: string[]): string | null {
  const want =
    c.part === "later" ? `later-${c.partNo}` : c.part === "all" ? null : c.part;
  if (want && keys.includes(want)) return want;
  return null;
}

const holding = (v: ConfirmationView) =>
  v.state === "waiting" || v.state === "stale";

/**
 * Filling the parts (PLAN 1.2), in cents: unproven confirmations hold room
 * on their part (capped at it; one with no part, "all", holds room in part
 * order), rail money fills each part's unheld room in order, then what the
 * rails have left fills held room. A part whose empty room is within 1% of
 * it counts as filled (FX). Shared by the listed rows and Back with sales,
 * so both offer the same room to confirm.
 */
function fillParts(
  parts: { key: string; c: number }[],
  R: number,
  views: ConfirmationView[],
): { railsC: number; personC: number; emptyC: number }[] {
  const reserved = new Map<string, number>();
  let loose = 0;
  for (const v of views) {
    if (!holding(v)) continue;
    if (v.partKey)
      reserved.set(v.partKey, (reserved.get(v.partKey) ?? 0) + cents(v.usd));
    else loose += cents(v.usd);
  }
  const hold = parts.map(p => Math.min(p.c, reserved.get(p.key) ?? 0));
  parts.forEach((p, i) => {
    const take = Math.min(loose, p.c - hold[i]);
    hold[i] += take;
    loose -= take;
  });
  let r = R;
  const railsC = parts.map((p, i) => {
    const take = Math.min(r, p.c - hold[i]);
    r -= take;
    return take;
  });
  return parts.map((p, i) => {
    const take = Math.min(r, hold[i]);
    r -= take;
    const rails = railsC[i] + take;
    const personC = hold[i] - take;
    let emptyC = p.c - rails - personC;
    if (emptyC > 0 && emptyC <= p.c / 100) emptyC = 0;
    return { railsC: rails, personC, emptyC };
  });
}

/**
 * Proof (PLAN 1.2): a payment in the deal's rails on the rail the
 * confirmation named, within 2% of its dollars, dated from 3 days before to
 * 14 days after its paid-on day, not already proving an older confirmation.
 * Oldest confirmation first; the closest day wins, then the earlier day, then
 * the payment id (the same order as the write's cap in 20261023y).
 */
export function proofs(
  confirmations: ReadConfirmation[],
  rails: ReadRail[],
): Map<number, ReadRail> {
  const used = new Set<string>();
  const out = new Map<number, ReadRail>();
  const live = confirmations
    .filter(c => !c.withdrawnAt)
    .sort(
      (a, b) =>
        Date.parse(a.confirmedAt) - Date.parse(b.confirmedAt) || a.id - b.id,
    );
  for (const c of live) {
    const usd = Number(c.usd);
    const fits = rails
      .filter(
        r =>
          String(r.rail).toLowerCase() === c.rail &&
          Math.abs(Number(r.usd) - usd) <= 0.02 * usd + 1e-9 &&
          r.day >= addDays(c.paidOn, -3) &&
          r.day <= addDays(c.paidOn, 14) &&
          !used.has(r.paymentId),
      )
      .sort(
        (a, b) =>
          Math.abs(daysBetween(c.paidOn, a.day)) -
            Math.abs(daysBetween(c.paidOn, b.day)) ||
          a.day.localeCompare(b.day) ||
          a.paymentId.localeCompare(b.paymentId),
      );
    if (fits.length > 0) {
      used.add(fits[0].paymentId);
      out.set(c.id, fits[0]);
    }
  }
  return out;
}

function confirmationView(
  c: ReadConfirmation,
  partKey: string | null,
  proof: ReadRail | undefined,
  ctx: Ctx,
): ConfirmationView {
  const ageDays = Math.max(
    0,
    Math.floor((ctx.now - Date.parse(c.confirmedAt)) / 86_400_000),
  );
  const who = c.byYou ? "you" : firstName(c.confirmedByName);
  const rail = railName(c.rail);
  let state: ConfirmationView["state"];
  let line: string;
  if (c.withdrawnAt) {
    state = "withdrawn";
    line =
      `Withdrawn by ${firstName(c.withdrawnByName)}: ${c.withdrawnReason ?? ""}`.trim();
  } else if (proof) {
    state = "proven";
    line = `${rail} shows it (${dayText(proof.day, ctx.today)})`;
  } else if (!c.confirmedByCeo && ageDays > 7) {
    state = "stale";
    line = `Confirmed by ${who} ${ageDays} days ago · waiting for the CEO to find it`;
  } else {
    state = "waiting";
    line = `Confirmed by ${who} · waiting for ${rail}`;
  }
  return {
    ...c,
    partKey,
    state,
    provenBy: proof
      ? { paymentId: proof.paymentId, day: proof.day, usd: Number(proof.usd) }
      : null,
    ageDays,
    line,
  };
}

function historyOf(ctx: Ctx, taskId: string): ReadHistory[] {
  return ctx
    .byTask(ctx.read.cardHistory, taskId)
    .slice()
    .sort((a, b) => a.day.localeCompare(b.day));
}

/** The card's next date as the history last showed it before a day. */
function nextDateBefore(hist: ReadHistory[], day: string): string | null {
  let out: string | null = null;
  for (const h of hist) if (h.day < day) out = h.nextDate ?? out;
  return out;
}

/** How much the card's LTV rose on a day (or the day after, when the sync caught it then). */
function ltvRise(
  hist: ReadHistory[],
  day: string,
): { from: number; to: number } | null {
  let prev: number | null = null;
  let best: { from: number; to: number } | null = null;
  for (const h of hist) {
    const ltv = numOrNull(h.ltvUsd);
    if (
      prev !== null &&
      ltv !== null &&
      ltv > prev &&
      (h.day === day || h.day === addDays(day, 1)) &&
      (!best || ltv - prev > best.to - best.from)
    )
      best = { from: prev, to: ltv };
    if (ltv !== null) prev = ltv;
  }
  return best;
}

/** Build one client's row from its card and its newest deal. */
function rowFor(
  card: ReadCard,
  deal: ReadDeal | null,
  railsAll: ReadRail[],
  ctx: Ctx,
): PendingRow {
  const { today } = ctx;
  const ceo = ctx.read.ceo;
  const notes: string[] = [];
  const sources: string[] = [];
  const rails = deal
    ? railsAll
        .filter(r => r.dealResponseId === deal.responseId)
        .slice()
        .sort((a, b) => a.day.localeCompare(b.day))
    : [];
  const R = rails.reduce((t, r) => t + cents(r.usd), 0);
  const inboxAll = ctx.byTask(ctx.read.inbox, card.taskId);
  const inbox = inboxAll.filter(
    i => i.status === "pending" || i.status === "rejected",
  );
  const confirmationsAll = ctx
    .byTask(ctx.read.confirmations, card.taskId)
    .filter(c =>
      deal
        ? c.dealResponseId === deal.responseId || c.dealResponseId === null
        : c.dealResponseId === null,
    );
  const hist = historyOf(ctx, card.taskId);
  const base: PendingRow = {
    taskId: card.taskId,
    name: card.name,
    url: card.url,
    status: card.status,
    group: card.group,
    inOnboarding: card.inOnboarding,
    band:
      card.quiet || /^\s*ghosted\s*$/i.test(card.status ?? "")
        ? "quiet"
        : "list",
    cardOnly: false,
    deal,
    signedOn: deal ? (deal.signedOn ?? kuwaitDayOf(deal.signedAt)) : null,
    plan: null,
    planLabel: "",
    headline: "",
    contractUsd: deal ? numOrNull(deal.contractUsd) : null,
    // With no deal the read carries no rails for the card: unknown, never $0.
    railsUsd: deal ? dollars(R) : null,
    leftUsd: null,
    finished: false,
    // Known only once the plan's parts are worked out (the main path below).
    amountsKnown: false,
    parts: [],
    ribbon: [],
    notSeenUsd: null,
    onboardingNotSeenUsd: null,
    laterNotSeenUsd: null,
    upcomingOnboardingUsd: null,
    anotherUsd: null,
    personUsd: 0,
    typedUsd: null,
    tone: "neutral",
    daysLate: null,
    dueLine: "",
    when: null,
    chips: [],
    disagree: null,
    notes,
    sources,
    confirmations: [],
    confirmable: [],
    hints: [],
    rails,
    inbox,
    nextPart: null,
    cardNext: null,
  };

  // Sources that hold whatever the plan says.
  const cardBits = [
    card.plan ? `${card.plan}` : "no plan",
    card.ltvFieldUsd !== null ? `LTV ${usdText(card.ltvFieldUsd)}` : "no LTV",
    card.nextUsd !== null || card.nextDate
      ? `next ${card.nextUsd !== null ? usdText(card.nextUsd) : "no amount"} on ${dayText(card.nextDate, today)}`
      : "no next payment",
  ];
  const changes: string[] = [];
  for (let i = 1; i < hist.length; i++) {
    const a = hist[i - 1];
    const b = hist[i];
    const bits: string[] = [];
    if (numOrNull(a.ltvUsd) !== numOrNull(b.ltvUsd))
      bits.push(
        `LTV ${usdText(numOrNull(a.ltvUsd))} → ${usdText(numOrNull(b.ltvUsd))}`,
      );
    if ((a.nextDate ?? null) !== (b.nextDate ?? null))
      bits.push(
        `next ${dayText(a.nextDate, today)} → ${dayText(b.nextDate, today)}`,
      );
    if (bits.length)
      changes.push(`${dayText(b.day, today)}: ${bits.join(", ")}`);
  }
  sources.push(
    `Card: ${cardBits.join(", ")}${changes.length ? ` (${changes.join("; ")})` : ""}`,
  );
  if (card.cardCallOn)
    sources.push(
      `Card: onboarding call date ${dayText(card.cardCallOn, today)}`,
    );
  if (card.noteAtOnboardingUsd !== null || card.noteContractUsd !== null)
    sources.push(
      `Billing note: ${[
        card.noteContractUsd !== null
          ? `contract ${usdText(card.noteContractUsd)}`
          : null,
        card.noteAtOnboardingUsd !== null
          ? `${usdText(card.noteAtOnboardingUsd)} at onboarding`
          : null,
      ]
        .filter(Boolean)
        .join(", ")}`,
    );
  for (const i of inboxAll)
    sources.push(
      `Billing inbox: ${i.loggedByName ?? "someone"} logged ${usdText(i.usd)} ${railName(i.method)} ${dayText(i.paidOn, today)}; ${
        i.status === "ingested"
          ? "in the ledger"
          : i.status === "rejected"
            ? `refused: ${i.statusNote ?? "no reason given"}`
            : "waiting for the ledger"
      }`,
    );
  for (const v of ctx.byTask(ctx.read.invoices, card.taskId))
    sources.push(
      `Invoice ${v.invoiceNo ?? "(no number yet)"} (${dayText(v.issueDate, today)}, ${v.status})${v.amountUsd !== null ? ` ${usdText(v.amountUsd)}` : ""}${v.dueDate ? `, asks by ${dayText(v.dueDate, today)}` : ""}${v.payNote ? `: "${v.payNote}"` : ""}`,
    );
  for (const e of ctx.byTask(ctx.read.ecomOpen, card.taskId))
    sources.push(
      `Ecom invoice ${e.invoiceNumber ?? ""} asks ${e.amountKwd !== null ? `${e.amountKwd} KWD` : ""}${e.usd !== null ? ` (${usdText(e.usd)})` : ""}, unpaid since ${dayText(kuwaitDayOf(e.createdAt), today)}`.replace(
        /\s+/g,
        " ",
      ),
    );
  for (const e of ctx.byTask(ctx.read.events, card.taskId))
    if (e.kind === "invoice" && e.reason)
      sources.push(
        `${e.byName ?? "Someone"}, ${dayText(kuwaitDayOf(e.at), today)}: ${e.reason}`,
      );
  for (const k of ctx.byTask(ctx.read.kickoffs, card.taskId))
    if (k.typedPayment !== null)
      sources.push(
        `Kickoff form ${dayText(kuwaitDayOf(k.submittedAt), today)} typed ${usdText(k.typedPayment)} (typed, not money)`,
      );

  // A row whose parts cannot be worked out (no terms, no contract value, a
  // plan nobody can read) still shows every confirmation, so it can be
  // withdrawn and, unproven after 7 days, reaches the CEO; and it takes one
  // for what they paid in all (20261023y accepts part "all" on any of them).
  // roomC is what the rails have not shown, or null when nobody can say.
  const wholeRow = (roomC: number | null) => {
    const proof = proofs(confirmationsAll, rails);
    base.confirmations = confirmationsAll.map(c =>
      confirmationView(c, null, proof.get(c.id), ctx),
    );
    const heldC = base.confirmations
      .filter(holding)
      .reduce((t, c) => t + cents(c.usd), 0);
    base.personUsd = dollars(heldC);
    const emptyC = roomC === null ? null : Math.max(0, roomC - heldC);
    base.confirmable =
      emptyC === 0
        ? []
        : [
            {
              part: "all",
              partNo: 0,
              label: "What they paid in all",
              emptyUsd: emptyC === null ? null : dollars(emptyC),
            },
          ];
  };

  // No signed deal: in onboarding it is "Terms not on record".
  if (!deal && card.group !== "active") {
    base.planLabel = "Terms not on record";
    base.headline = "Terms not on record";
    base.dueLine = "No closer form we could match";
    notes.push(
      "Terms not on record: no closer form we could match. Confirm what they paid.",
    );
    base.chips = ["onboarding"];
    wholeRow(null);
    return base;
  }
  // An Active card with no deal whose card asks for a payment not yet late
  // (buildPending picks them): the card is the only record, so the row says
  // what the card asks and stays out of every figure. The write takes no
  // confirmation without a deal on a card past onboarding, so a payment is
  // logged from the sheet's row instead.
  if (!deal) {
    const next = numOrNull(card.nextUsd);
    const day =
      card.nextDate && DAY_RE.test(card.nextDate) ? card.nextDate : null;
    base.cardOnly = true;
    base.planLabel = "Terms not on record";
    base.headline = "Terms not on record";
    base.dueLine = `The card asks ${next !== null ? usdText(next) : "a payment with no amount"}${day ? ` on ${dayText(day, today)}` : ", no date on the card"}`;
    base.when = day ? whenWords(daysBetween(day, today)) : null;
    base.nextPart =
      next !== null && next > 0
        ? { key: "card", label: "The card's next payment", usd: next, due: day }
        : null;
    notes.push(
      "Terms not on record: no closer form we could match (the deal copy starts on 1 Apr 2026). The card's next payment is the only record, so this client is kept out of the figures.",
    );
    base.chips = ["toCome"];
    return base;
  }

  const signedOn = base.signedOn as string;
  const { plan, specs, notes: planNotes } = partsOf(deal);
  notes.push(...planNotes);
  base.plan = plan;
  base.planLabel = PLAN_LABEL[plan];
  const C = cents(deal.contractUsd);
  base.leftUsd = C > 0 && plan !== "m2m" ? dollars(Math.max(0, C - R)) : null;

  // The closer form and the rails, as sources.
  const form: string[] = [
    deal.paymentStructure ?? "no plan",
    C > 0 ? usdText(dollars(C)) : "no contract value",
    `${usdText(numOrNull(deal.depositUsd) ?? 0)} typed at signing${deal.depositUsd === null ? " (blank on the form)" : ""}`,
  ];
  if (deal.atOnboardingUsd !== null)
    form.push(`${usdText(deal.atOnboardingUsd)} at onboarding`);
  if (deal.secondPaymentUsd !== null)
    form.push(
      deal.secondPaymentUsd > 0
        ? `${usdText(deal.secondPaymentUsd)} second payment`
        : "no second payment",
    );
  if (deal.newMrrUsd !== null) form.push(`${usdText(deal.newMrrUsd)} a month`);
  sources.unshift(
    `Rails: ${
      rails.length === 0
        ? "none tied"
        : rails
            .map(
              r =>
                `${railName(r.rail)} ${usdText(Number(r.usd))} (${dayText(r.day, today)}${r.byHand ? ", logged by hand" : ""}${r.fromLedger ? "" : ", tied to the card"})`,
            )
            .join(", ")
    }`,
  );
  sources.unshift(
    `Closer form, ${dayText(signedOn, today)}: ${form.join("; ")}`,
  );
  for (const o of deal.otherForms ?? [])
    sources.push(
      `Older closer form of ${dayText(kuwaitDayOf(o.signedAt), today)} (not used)`,
    );

  // Missing data, in words.
  if (daysBetween(signedOn, today) > OLD_TERMS_DAYS)
    notes.push(
      `Terms from the closer form of ${dayText(signedOn, today)}. Check they still hold.`,
    );
  if (deal.matchedBy === "name")
    notes.push("Closer form matched to this card by name.");
  if (deal.matchedBy === "alias")
    notes.push("Closer form matched to this card by one of its other names.");
  if (deal.matchedBy === "link")
    notes.push(
      `Closer form linked to this card by ${firstName(deal.linkedByName)}.`,
    );
  if (deal.conflict)
    notes.push(
      ceo && deal.conflictWith && deal.conflictWith.length > 0
        ? `This closer form's name also matches ${deal.conflictWith.map(x => x.name).join(", ")}. Check it is this client's.`
        : "This closer form's name also matches another client card. Check it is this client's.",
    );
  if (rails.length === 0)
    notes.push(
      "No rail has ever shown a payment from this client. A transfer shows only once someone logs it.",
    );
  if (
    card.plan &&
    planOf(card.plan) !== plan &&
    planOf(card.plan) !== "unreadable"
  )
    notes.push(`The card says ${card.plan}.`);

  if (C <= 0) {
    base.headline = "Contract value not on the closer form";
    base.dueLine = `Signed ${dayText(signedOn, today)}`;
    notes.unshift(
      "Contract value not on the closer form. Ask the closer, then confirm what was paid.",
    );
    base.chips = card.inOnboarding ? ["onboarding"] : ["notSeen"];
    wholeRow(null);
    return base;
  }
  if (plan === "unreadable") {
    base.headline = "Plan not readable";
    base.dueLine = `Signed ${dayText(signedOn, today)}`;
    notes.unshift(
      `Plan not readable: '${deal.paymentStructure ?? ""}'. ${usdText(base.leftUsd)} left on the contract.`,
    );
    base.finished = R >= 0.99 * C;
    base.chips = card.inOnboarding ? ["onboarding"] : ["notSeen"];
    wholeRow(Math.max(0, C - R));
    return base;
  }
  // Month to month is finished once its parts are on the rails (step 2).
  base.finished = plan !== "m2m" && R >= 0.99 * C;

  // 1. The parts and their plan days.
  const onb = onboardingDue(
    card,
    signedOn,
    ctx.byTask(ctx.read.calls, card.taskId),
    ctx.byTask(ctx.read.kickoffs, card.taskId),
    today,
  );
  if (deal.atOnboardingUsd === null && specs.some(s => s.kind === "onboarding"))
    notes.push(
      signedOn < FORM_ASKS_FROM
        ? `Onboarding payment ${usdText(dollars(specs.find(s => s.kind === "onboarding")?.c ?? 0))} from the plan (the form did not ask before 29 Aug).`
        : `Onboarding payment ${usdText(dollars(specs.find(s => s.kind === "onboarding")?.c ?? 0))} from the plan (the closer form's answer is not on record).`,
    );
  const works: Work[] = specs.map(spec => {
    let due: string | null = null;
    let line = "";
    let booked = false;
    let dueWithoutDay = false;
    if (spec.kind === "deposit") {
      due = signedOn;
      line = `Signed ${dayText(signedOn, today)}`;
    } else if (spec.kind === "onboarding") {
      due = onb.due;
      line = onb.line;
      booked = onb.booked;
      dueWithoutDay = onb.dueWithoutDay;
    } else if (card.launchOn) {
      due = addMonths(card.launchOn, spec.no);
      line = `${dayText(due, today)} (launch ${dayText(card.launchOn, today)} + ${spec.no} month${spec.no === 1 ? "" : "s"})`;
    } else if (card.group === "active" && onb.due) {
      due = addDays(onb.due, 30 * spec.no);
      line = `${dayText(due, today)} (onboarding ${dayText(onb.due, today)} + ${30 * spec.no} days; no launch day on the card)`;
    } else {
      line = `Due ${spec.no === 1 ? "a month" : `${spec.no} months`} after launch (no launch day yet)`;
    }
    return {
      spec,
      key: keyOf(spec.kind, spec.no),
      railsC: 0,
      personC: 0,
      emptyC: 0,
      due,
      dueLine: line,
      booked,
      dueWithoutDay,
      planDue: due,
      moved: false,
      markedPaid: null,
      ask: null,
      signals: [],
      isDue: false,
      notSeenC: 0,
      anotherC: 0,
      notDueC: 0,
    };
  });

  // 2. Fill: rail money fills each part's unreserved room in order, then the
  // room held by confirmations nobody has proven yet.
  const proof = proofs(confirmationsAll, rails);
  const keys = works.map(w => w.key);
  const views = confirmationsAll.map(c =>
    confirmationView(c, confirmationKey(c, keys), proof.get(c.id), ctx),
  );
  base.confirmations = views;
  fillParts(
    works.map(w => ({ key: w.key, c: w.spec.c })),
    R,
    views,
  ).forEach((f, i) => {
    works[i].railsC = f.railsC;
    works[i].personC = f.personC;
    works[i].emptyC = f.emptyC;
  });
  if (plan === "m2m")
    base.finished = works.every(w => w.emptyC <= 0 && w.personC <= 0);

  // 3. Moves: an audited extension or date event moves the part due within
  // 7 days of the day it moved from, at any gap, unless the card's LTV rose
  // that day by 90% of what that part still has empty (then it was marked
  // paid, not moved: a part half on the rails needs only its other half).
  const explained = new Set<string>();
  const events = ctx
    .byTask(ctx.read.events, card.taskId)
    .filter(e => e.kind === "extension" || e.kind === "date")
    .slice()
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  for (const e of events) {
    const to = e.to && DAY_RE.test(e.to) ? e.to : null;
    if (!to) continue;
    explained.add(to);
    const eventDay = kuwaitDayOf(e.at);
    if (!eventDay) continue;
    const from =
      e.from && DAY_RE.test(e.from) && e.from !== e.to
        ? e.from
        : nextDateBefore(hist, eventDay);
    if (!from) continue;
    const target = works
      .filter(
        w => w.emptyC > 0 && w.due && Math.abs(daysBetween(from, w.due)) <= 7,
      )
      .sort(
        (a, b) =>
          Math.abs(daysBetween(from, a.due as string)) -
          Math.abs(daysBetween(from, b.due as string)),
      )[0];
    if (!target) continue;
    const rise = ltvRise(hist, eventDay);
    if (rise && rise.to - rise.from >= 0.9 * dollars(target.emptyC)) {
      target.markedPaid = `The card was marked paid on ${dayText(eventDay, today)} (LTV ${usdText(rise.from)} → ${usdText(rise.to)}, next ${dayText(from, today)} → ${dayText(to, today)}, by ${firstName(e.byName)})`;
      continue;
    }
    // A card date put on a part's own day is the card catching up with the
    // plan, not a move: Pending payments' "Set on the card" writes the next
    // part's day through this same date event, and a later part due near the
    // card's old date must not be pulled onto it (Ardon: 27 Nov to 27 Oct is
    // month 2's day, so month 3 stays on 27 Nov). Any part counts, paid ones
    // too, so the event never pulls month 3 forward once month 2 is on a
    // rail. Checked after "marked paid", which is the same kind of event.
    if (e.kind === "date" && works.some(w => w.due === to)) continue;
    const weeks =
      e.kind === "extension" && e.weeks ? ` (${e.weeks}-week extension)` : "";
    target.due = to;
    target.moved = true;
    target.booked = false;
    target.dueLine = `Moved from ${dayText(from, today)} to ${dayText(to, today)} by ${firstName(e.byName)}${weeks}${e.reason ? `: ${e.reason}` : ""}`;
  }

  // A live invoice that asks for the money, issued after the part was due.
  // One with a due date (a checkout or autocharge) asks for one part: the
  // first due part its amount fits (within 3% of the part or of its empty
  // room); its due date is that part's agreed day. One that fits no part is
  // a source line only, so a small invoice never re-dates a large late part.
  // A pay note with no due date is quoted, never parsed: it holds every part
  // due by its issue day at warning for 14 days from issue.
  const live = ctx
    .byTask(ctx.read.invoices, card.taskId)
    .filter(
      v =>
        ["queued", "rendering", "issued"].includes(v.status) &&
        Boolean(v.issueDate),
    )
    .slice()
    .sort((a, b) => String(a.issueDate).localeCompare(String(b.issueDate)));
  const agreed = new Set<Work>();
  for (const v of live) {
    if (!v.dueDate || v.kind === "paid") continue;
    const issued = v.issueDate as string;
    const ask = cents(v.amountUsd);
    const near = (c: number) => c > 0 && Math.abs(ask - c) <= 0.03 * c;
    const w = works.find(
      x =>
        !agreed.has(x) &&
        x.emptyC > 0 &&
        x.due !== null &&
        x.due <= issued &&
        ask > 0 &&
        (near(x.emptyC) || near(x.spec.c)),
    );
    if (!w) continue;
    agreed.add(w);
    w.ask = {
      holdUntil: v.dueDate,
      agreedDue: v.dueDate,
      line: `Invoice ${v.invoiceNo ?? ""} asks by ${dayText(v.dueDate, today)}`,
    };
    w.signals.push(w.ask.line.replace(/\s+/g, " "));
  }
  for (const v of live) {
    if (!v.payNote || (v.dueDate && v.kind !== "paid")) continue;
    const issued = v.issueDate as string;
    for (const w of works) {
      if (agreed.has(w) || w.emptyC <= 0 || !w.due || w.due > issued) continue;
      w.ask = {
        holdUntil: addDays(issued, 14),
        agreedDue: null,
        line: `Invoice ${v.invoiceNo ?? ""} (${dayText(issued, today)}) says: "${v.payNote}"`,
      };
      w.signals.push(w.ask.line.replace(/\s+/g, " "));
    }
  }

  // An unexplained card date moves a later part only, and only 0-21 days on.
  if (
    card.nextDate &&
    DAY_RE.test(card.nextDate) &&
    !explained.has(card.nextDate)
  ) {
    const target = works.find(
      w =>
        w.spec.kind === "later" &&
        w.emptyC > 0 &&
        !w.moved &&
        w.planDue !== null &&
        daysBetween(w.planDue, card.nextDate as string) >= 1 &&
        daysBetween(w.planDue, card.nextDate as string) <= 21,
    );
    if (target) {
      let changed = "";
      for (let i = 1; i < hist.length; i++)
        if (
          hist[i].nextDate === card.nextDate &&
          hist[i - 1].nextDate !== card.nextDate
        ) {
          changed = ` from ${dayText(hist[i - 1].nextDate, today)} on ${dayText(hist[i].day, today)}`;
          break;
        }
      target.due = card.nextDate;
      target.moved = true;
      target.dueLine = `${dayText(card.nextDate, today)} (card moved it${changed || ` from ${dayText(target.planDue, today)}`}, no reason on record)`;
    }
  }
  for (const w of works)
    if (w.spec.kind === "later" && !w.moved && w.due && card.nextDate === w.due)
      w.dueLine += "; the card agrees";

  // 4. Due or not.
  for (const w of works) {
    if (w.emptyC <= 0) continue;
    if (w.due)
      w.isDue = w.booked ? today >= addDays(w.due, -2) : today >= w.due;
    else w.isDue = w.dueWithoutDay;
    if (w.isDue) w.notSeenC = w.emptyC;
    else w.notDueC = w.emptyC;
  }

  // 5. Second sources move due dollars from Not seen to Another source.
  // S1: a pending or refused billing-inbox log that fits the part.
  const s1Used = new Set<number>();
  works.forEach((w, i) => {
    if (w.notSeenC <= 0) return;
    const start =
      i === 0 || w.spec.kind !== "later"
        ? addDays(signedOn, -7)
        : (works[i - 1].due ?? addDays(signedOn, -7));
    const fit = inbox.find(
      x =>
        !s1Used.has(x.id) &&
        x.paidOn !== null &&
        x.paidOn >= start &&
        (Math.abs(cents(x.usd) - w.spec.c) <= 0.03 * w.spec.c ||
          Math.abs(cents(x.usd) - w.notSeenC) <= 0.03 * w.notSeenC),
    );
    if (!fit) return;
    s1Used.add(fit.id);
    w.signals.push(
      `${fit.loggedByName ?? "Someone"} logged ${usdText(fit.usd)} ${railName(fit.method)} on ${dayText(fit.paidOn, today)}${fit.status === "rejected" ? `, refused: ${fit.statusNote ?? "no reason given"}` : ", waiting for the ledger"}`,
    );
    w.anotherC += w.notSeenC;
    w.notSeenC = 0;
  });
  // S2: the card was marked paid on the part's day.
  for (const w of works) {
    if (!w.markedPaid) continue;
    w.signals.push(w.markedPaid);
    w.anotherC += w.notSeenC;
    w.notSeenC = 0;
  }
  // S3: the card's LTV covers what is left unseen on the row (all or nothing).
  const remaining = works.reduce((t, w) => t + w.notSeenC, 0);
  const s12 = works.reduce((t, w) => t + w.anotherC, 0);
  const ltv = numOrNull(card.ltvFieldUsd);
  if (ltv !== null && remaining > 0) {
    const room = cents(ltv) - R - s12;
    if (room >= remaining - remaining / 100) {
      for (const w of works) {
        if (w.notSeenC <= 0) continue;
        w.signals.push(
          `The card's LTV is ${usdText(ltv)}, which covers it; the rails show ${usdText(dollars(R))}`,
        );
        w.anotherC += w.notSeenC;
        w.notSeenC = 0;
      }
    } else if (room >= 100) {
      base.disagree = `Sources disagree: card LTV ${usdText(ltv)}, rails ${usdText(dollars(R))}`;
    }
  }

  // 6. Tone, per part and for the row.
  const parts: Part[] = works.map(w => {
    // An invoice's due date is the agreed day: lateness counts from it.
    const lateFrom = w.ask?.agreedDue ?? w.due;
    const daysLate = lateFrom ? daysBetween(lateFrom, today) : null;
    let tone: Tone = "neutral";
    if (w.notSeenC > 0) {
      if (w.spec.kind === "later")
        tone =
          daysLate === null
            ? "serious"
            : daysLate >= 4
              ? "critical"
              : daysLate >= 1
                ? "serious"
                : "warning";
      else
        tone =
          daysLate === null
            ? "serious"
            : daysLate >= 1
              ? "critical"
              : daysLate === 0
                ? "serious"
                : "warning";
      if (w.ask && today <= w.ask.holdUntil) tone = "warning";
    } else if (w.anotherC > 0) tone = "warning";
    const typed =
      w.spec.kind === "deposit"
        ? Math.min(cents(deal.depositUsd), w.notSeenC)
        : 0;
    return {
      key: w.key,
      kind: w.spec.kind,
      no: w.spec.no,
      label: w.spec.label,
      usd: dollars(w.spec.c),
      rails: dollars(w.railsC),
      person: dollars(w.personC),
      notSeen: dollars(w.notSeenC),
      another: dollars(w.anotherC),
      notDue: dollars(w.notDueC),
      typed: dollars(typed),
      due: w.due,
      dueLine: w.dueLine,
      isDue: w.isDue,
      daysLate,
      tone,
      next: false,
      signals: w.signals,
    };
  });
  const nextIdx = works.findIndex(w => w.emptyC > 0);
  if (nextIdx >= 0) {
    parts[nextIdx].next = true;
    const w = works[nextIdx];
    base.nextPart = {
      key: w.key,
      label: w.spec.label,
      usd: dollars(w.emptyC),
      due: w.due,
    };
    // "Put the next part on the card": only when nothing due is still open
    // (so the card's date never jumps past a late part) and the next part
    // has a day. The sheet's edit path writes it, with its own log rows.
    const open = works.some(x => x.notSeenC > 0 || x.anotherC > 0);
    if (!open && !w.isDue && w.due) {
      const amountDiffers =
        card.nextUsd === null || Math.abs(cents(card.nextUsd) - w.emptyC) > 100;
      const dateDiffers = (card.nextDate ?? null) !== w.due;
      if (amountDiffers || dateDiffers)
        base.cardNext = {
          usd: dollars(w.emptyC),
          date: w.due,
          amountDiffers,
          dateDiffers,
        };
    }
  }
  if (card.nextDate && card.nextUsd !== null && card.nextUsd > 0) {
    const due = works.find(w => w.emptyC > 0 && w.spec.kind === "later");
    if (due && Math.abs(cents(card.nextUsd) - due.emptyC) > 100)
      notes.push(
        `The card asks ${usdText(card.nextUsd)} on ${dayText(card.nextDate, today)}; the rails leave ${usdText(dollars(due.emptyC))} on ${due.spec.label.toLowerCase()}.`,
      );
  }

  base.parts = parts;
  base.ribbon = parts.flatMap(p => {
    const segs: RibbonSegment[] = [];
    const add = (state: RibbonState, usd: number, typed = false) => {
      if (usd > 0)
        segs.push({
          partKey: p.key,
          state,
          usd,
          share: C > 0 ? usd / dollars(C) : 0,
          typed,
        });
    };
    add("rails", p.rails);
    add("person", p.person);
    add("notSeen", p.typed, true);
    add("notSeen", dollars(cents(p.notSeen) - cents(p.typed)));
    add("another", p.another);
    add("notDue", p.notDue);
    return segs;
  });
  const sum = (f: (p: Part) => number, only?: (p: Part) => boolean) =>
    dollars(
      parts
        .filter(p => (only ? only(p) : true))
        .reduce((t, p) => t + cents(f(p)), 0),
    );
  base.amountsKnown = true;
  base.notSeenUsd = sum(p => p.notSeen);
  base.onboardingNotSeenUsd = sum(
    p => p.notSeen,
    p => p.kind !== "later",
  );
  base.laterNotSeenUsd = sum(
    p => p.notSeen,
    p => p.kind === "later",
  );
  base.upcomingOnboardingUsd = sum(
    p => p.notDue,
    p => p.kind !== "later",
  );
  base.anotherUsd = sum(p => p.another);
  base.personUsd = sum(p => p.person);
  base.typedUsd = sum(p => p.typed);
  base.tone = parts.reduce<Tone>((t, p) => worse(t, p.tone), "neutral");
  const unseen = parts.filter(p => p.notSeen > 0);
  const seenBy = parts.filter(p => p.another > 0);
  // Parts a person confirmed that no rail has shown yet.
  const held = parts.filter(p => p.person > 0);
  // The part the row leads with: the first one not seen, except that a
  // deposit and an onboarding payment both unseen lead with the onboarding
  // call (the typed deposit is said on the row); then another source; then a
  // part a person confirmed ("Confirmed by Sara · waiting for Tap"); then
  // the next part.
  const pick = (list: Part[]) =>
    list[0]?.kind === "deposit" && list[1]?.kind === "onboarding"
      ? list[1]
      : list[0];
  const lead =
    pick(unseen) ?? pick(seenBy) ?? held[0] ?? parts.find(p => p.next) ?? null;
  base.daysLate =
    (unseen.length || seenBy.length) && lead ? lead.daysLate : null;
  const heldLine =
    !unseen.length && !seenBy.length && lead && held.includes(lead)
      ? (
          views.find(v => holding(v) && v.partKey === lead.key) ??
          views.find(v => holding(v) && v.partKey === null)
        )?.line
      : undefined;
  base.dueLine = heldLine ?? (lead ? lead.dueLine : "");
  base.when =
    heldLine === undefined && lead && lead.daysLate !== null
      ? whenWords(lead.daysLate)
      : null;
  const labels = (list: Part[]) => {
    const names = list.map((p, i) =>
      i === 0 ? p.label : p.label.charAt(0).toLowerCase() + p.label.slice(1),
    );
    return names.length <= 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  };
  // A listed row never reads "Finished": it is on the list because the
  // rails have not shown the whole contract.
  const what = unseen.length
    ? labels(unseen)
    : seenBy.length
      ? labels(seenBy)
      : held.length
        ? labels(held)
        : (lead?.label ?? "");
  base.headline = what ? `${base.planLabel} · ${what}` : base.planLabel;
  // Onboarding: a deposit or onboarding payment not on a rail, due or still
  // to come on the call, so a success manager sees it before the call.
  const chips: ChipKey[] = [];
  if (base.notSeenUsd > 0) chips.push("notSeen");
  if (base.onboardingNotSeenUsd > 0 || base.upcomingOnboardingUsd > 0)
    chips.push("onboarding");
  if (base.laterNotSeenUsd > 0) chips.push("later");
  if (base.anotherUsd > 0) chips.push("another");
  if (base.notSeenUsd <= 0 && base.anotherUsd <= 0 && !base.finished)
    chips.push("toCome");
  base.chips = chips;
  base.confirmable = works
    .filter(w => w.emptyC > 0)
    .map(w => ({
      part: w.spec.kind as ConfirmPart,
      partNo: w.spec.kind === "later" ? w.spec.no : 0,
      label: w.spec.label,
      emptyUsd: dollars(w.emptyC),
    }));

  // CEO only: untied payments that fit a part.
  if (ceo)
    base.hints = hintsFor(card.name, card.taskId, deal, works, inboxAll, ctx);
  return base;
}

function hintsFor(
  clientName: string,
  taskId: string | null,
  deal: ReadDeal,
  works: Work[],
  inbox: ReadInbox[],
  ctx: Ctx,
): Hint[] {
  const signedOn = deal.signedOn ?? (kuwaitDayOf(deal.signedAt) as string);
  const out: Hint[] = [];
  const logDays = new Set(inbox.map(i => i.paidOn).filter(Boolean) as string[]);
  const seen = new Set<string>();
  // Only a part with room: a payment the size of a part the rails already
  // filled (another client's deposit, most likely) is never offered, so the
  // CEO cannot tie it here by mistake and credit the wrong closer.
  for (const w of works) {
    if (w.emptyC <= 0) continue;
    const from = addDays(signedOn, -7);
    const to = w.spec.kind === "deposit" ? addDays(signedOn, 7) : ctx.today;
    for (const u of ctx.read.untied) {
      const usd = cents(u.usd);
      if (Math.abs(usd - w.spec.c) > 0.03 * w.spec.c) continue;
      if (u.day < from || u.day > to || seen.has(u.id)) continue;
      seen.add(u.id);
      const payer = u.payerName ?? null;
      const like =
        payer !== null &&
        hasLatin(payer) &&
        ((hasLatin(deal.contactName) &&
          similarity(payer, deal.contactName ?? "") >= 0.5) ||
          (hasLatin(deal.business) &&
            similarity(payer, deal.business ?? "") >= 0.5));
      const rank: Hint["rank"] = like
        ? "payer"
        : logDays.has(u.day)
          ? "log"
          : "amount";
      out.push({
        paymentId: u.id,
        day: u.day,
        rail: u.rail,
        usd: Number(u.usd),
        currency: u.currency,
        amount: u.amount,
        payerName: payer,
        taskId,
        dealResponseId: deal.responseId,
        clientName,
        partKey: w.key,
        partLabel: w.spec.label,
        rank,
        why:
          rank === "payer"
            ? "Payer like the contact or business"
            : rank === "log"
              ? "Same day as a person's log"
              : "Amount and timing only",
      });
    }
  }
  return out.sort(
    (a, b) =>
      RANK[a.rank] - RANK[b.rank] ||
      a.day.localeCompare(b.day) ||
      a.paymentId.localeCompare(b.paymentId),
  );
}

const RANK = { payer: 0, log: 1, amount: 2 } as const;

/** Group the hints by payment: each untied payment once, with every part it could be. */
function possibleMoneyOf(hints: Hint[]): PossiblePayment[] {
  const by = new Map<string, Hint[]>();
  for (const h of hints)
    by.set(h.paymentId, [...(by.get(h.paymentId) ?? []), h]);
  return [...by.values()]
    .map(list => {
      const candidates = list
        .slice()
        .sort(
          (a, b) =>
            RANK[a.rank] - RANK[b.rank] ||
            a.clientName.localeCompare(b.clientName),
        );
      const h = candidates[0];
      return {
        paymentId: h.paymentId,
        day: h.day,
        rail: h.rail,
        usd: h.usd,
        currency: h.currency,
        amount: h.amount,
        payerName: h.payerName,
        rank: h.rank,
        candidates,
      };
    })
    .sort(
      (a, b) =>
        RANK[a.rank] - RANK[b.rank] ||
        b.day.localeCompare(a.day) ||
        a.paymentId.localeCompare(b.paymentId),
    );
}

// --- the whole section -------------------------------------------------------------

const CHIP_LABEL: Record<ChipKey, string> = {
  notSeen: "Not seen",
  onboarding: "Onboarding",
  later: "Later parts",
  another: "Another source",
  toCome: "Still to come",
};

function kuwaitTime(ts: string): string {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return "an unknown time";
  return new Date(t + 3 * 3600_000).toISOString().slice(11, 16);
}

/**
 * The last billing-sync run due by `at` (epoch ms): pg_cron runs it at 7 and
 * 37 past every hour from 06:07 to 21:37 Kuwait, and at 00:17
 * (20261009a_billing_native_sync.sql, '7,37 3-18 * * *' and '17 21 * * *' UTC).
 */
export function lastCardsRun(at: number): number {
  const k = new Date(at + 3 * 3600_000);
  const midnight =
    Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) -
    3 * 3600_000;
  let last = Number.NEGATIVE_INFINITY;
  for (const day of [midnight - 86_400_000, midnight]) {
    const ticks = [17];
    for (let h = 6; h <= 21; h++) ticks.push(h * 60 + 7, h * 60 + 37);
    for (const m of ticks) {
      const t = day + m * 60_000;
      if (t <= at && t > last) last = t;
    }
  }
  return last;
}

/** The money ledger never ran: no rail amount on the row is known, so none reads $0. */
function unknownAmounts(r: PendingRow): void {
  r.amountsKnown = false;
  r.railsUsd = null;
  r.leftUsd = null;
  r.notSeenUsd = null;
  r.onboardingNotSeenUsd = null;
  r.laterNotSeenUsd = null;
  r.upcomingOnboardingUsd = null;
  r.anotherUsd = null;
  r.typedUsd = null;
  r.confirmable = r.confirmable.map(c => ({ ...c, emptyUsd: null }));
  // The words that lean on the rails go too. With no money read, "no rail has
  // ever shown a payment" and "the rails leave $1,667" are $0 claims, and the
  // parts a headline names, the tone, the next part and what the card should
  // say all come from which parts the rails left empty.
  r.notes = r.notes
    .filter(n => !/^No rail has ever shown|the rails leave/.test(n))
    .map(n =>
      n.startsWith("Plan not readable:")
        ? n.replace(
            / \S+ left on the contract\.$/,
            " What is left reads n/a until the money ledger runs.",
          )
        : n,
    );
  r.sources = r.sources.map(s =>
    s.startsWith("Rails:")
      ? "Rails: not read, the money ledger has not run"
      : s,
  );
  if (r.parts.length) r.headline = r.planLabel;
  r.tone = "neutral";
  r.daysLate = null;
  r.when = null;
  r.disagree = null;
  r.nextPart = null;
  r.cardNext = null;
}

/**
 * What a folded group has left: the rows that have an amount, added up, and
 * the rows that have none named, never counted as $0 ("$10,800 left, not
 * counting 1 with no contract value").
 */
function leftOf(
  list: {
    leftUsd: number | null;
    contractUsd: number | null;
    planLabel: string;
  }[],
  moneyMissing: boolean,
): { usd: number | null; words: string } {
  if (moneyMissing)
    return { usd: null, words: "left n/a until the money ledger runs" };
  const usd = dollars(list.reduce((t, r) => t + cents(r.leftUsd), 0));
  const none = list.filter(r => r.leftUsd === null);
  const noValue = none.filter(
    r => r.contractUsd === null || r.contractUsd <= 0,
  ).length;
  const m2m = none.filter(
    r =>
      r.contractUsd !== null &&
      r.contractUsd > 0 &&
      r.planLabel === PLAN_LABEL.m2m,
  ).length;
  const other = none.length - noValue - m2m;
  const bits = [
    noValue ? `${noValue} with no contract value` : "",
    m2m ? `${m2m} month to month` : "",
    other ? `${other} with nothing left on record` : "",
  ].filter(Boolean);
  return {
    usd,
    words: `${usdText(usd)} left${bits.length ? `, not counting ${bits.join(" and ")}` : ""}`,
  };
}

function rowOrder(a: PendingRow, b: PendingRow): number {
  // An amount nobody can work out (null) sorts as nothing to chase here; the
  // row still carries its chip and says why in words.
  const group = (r: PendingRow) =>
    (r.notSeenUsd ?? 0) > 0
      ? 0
      : (r.anotherUsd ?? 0) > 0
        ? 1
        : r.personUsd > 0
          ? 2
          : 3;
  return (
    group(a) - group(b) ||
    (b.notSeenUsd ?? 0) - (a.notSeenUsd ?? 0) ||
    (b.anotherUsd ?? 0) - (a.anotherUsd ?? 0) ||
    String(a.nextPart?.due ?? "9999").localeCompare(
      String(b.nextPart?.due ?? "9999"),
    ) ||
    a.name.localeCompare(b.name)
  );
}

/**
 * Turn the read into the section. `now` (ms) only judges freshness, booked
 * calls and how old a confirmation is; the day is the server's Kuwait day.
 */
export function buildPending(
  read: BalancesRead,
  now: number = Date.now(),
): PendingView {
  const today = read.today;
  const lists = new WeakMap<object, Map<string, unknown[]>>();
  const byTask = <T extends { taskId: string }>(
    list: T[],
    taskId: string,
  ): T[] => {
    let m = lists.get(list);
    if (!m) {
      m = new Map();
      for (const x of list) {
        const arr = m.get(x.taskId) ?? [];
        arr.push(x);
        m.set(x.taskId, arr);
      }
      lists.set(list, m);
    }
    return (m.get(taskId) as T[] | undefined) ?? [];
  };
  const ctx: Ctx = { read, today, now, byTask };
  const moneyMissing = !read.moneyAsOf;
  const dealByTask = new Map<string, ReadDeal>();
  for (const d of read.deals) if (d.taskId) dealByTask.set(d.taskId, d);

  const rows: PendingRow[] = [];
  const quietRows: PendingRow[] = [];
  const finished: PendingView["finished"] = [];
  const noDeal: ReadCard[] = [];
  for (const card of read.cards) {
    // The server lists only cards on the books; GHOSTED straight from Paused counts as paused.
    if (
      /^\s*ghosted\s*$/i.test(card.status ?? "") &&
      /^\s*paused/i.test(card.previousStatus ?? "")
    )
      continue;
    if (isInternal(card.name)) continue;
    const deal = dealByTask.get(card.taskId) ?? null;
    // With no deal, only a card in onboarding is listed ("Terms not on
    // record", where the write takes a confirmation of what they paid in
    // all); any other is a footnote when its card says it is late.
    if (!deal && card.group !== "pipeline") {
      noDeal.push(card);
      continue;
    }
    if (!deal && (card.quiet || /^\s*ghosted\s*$/i.test(card.status ?? "")))
      continue;
    const row = rowFor(card, deal, read.rails, ctx);
    if (row.finished) {
      // A finished row always has a contract and its rails (rowFor sets
      // both before the money-ledger pass below can null them).
      finished.push({
        taskId: row.taskId,
        name: row.name,
        railsUsd: row.railsUsd as number,
        contractUsd: row.contractUsd as number,
      });
      continue;
    }
    if (moneyMissing) unknownAmounts(row);
    if (row.band === "quiet") quietRows.push(row);
    else rows.push(row);
  }
  quietRows.sort((a, b) => a.name.localeCompare(b.name));

  // CEO: the deals with no card, each with the row it would make once linked.
  const cardById = new Map(read.cards.map(c => [c.taskId, c]));
  const unlinked: UnlinkedRow[] = [];
  if (read.ceo)
    for (const d of read.unlinked ?? []) {
      const parts = partsOf(d);
      const C = cents(d.contractUsd);
      const R = (d.rails ?? []).reduce((t, r) => t + cents(r.usd), 0);
      if (C > 0 && R >= 0.99 * C) continue;
      const signedOn = d.signedOn ?? (kuwaitDayOf(d.signedAt) as string);
      const sCard = d.suggestedTaskId
        ? (cardById.get(d.suggestedTaskId) ?? null)
        : null;
      const preview = sCard
        ? rowFor(
            sCard,
            { ...d, taskId: sCard.taskId, matchedBy: null },
            (d.rails ?? []).map(r => ({ ...r, dealResponseId: d.responseId })),
            ctx,
          )
        : null;
      if (preview && moneyMissing) unknownAmounts(preview);
      // A deal with no card has no confirmations (they are made on a card).
      const fill = fillParts(
        parts.specs.map(spec => ({
          key: keyOf(spec.kind, spec.no),
          c: spec.c,
        })),
        R,
        [],
      );
      const hintWorks: Work[] = parts.specs.map(
        (spec, i) =>
          ({
            spec,
            key: keyOf(spec.kind, spec.no),
            ...fill[i],
          }) as Work,
      );
      unlinked.push({
        deal: d,
        signedOn,
        planLabel: PLAN_LABEL[parts.plan],
        contractUsd: numOrNull(d.contractUsd),
        railsUsd: moneyMissing ? null : dollars(R),
        leftUsd: !moneyMissing && C > 0 ? dollars(Math.max(0, C - R)) : null,
        suggested: d.suggestedTaskId
          ? {
              taskId: d.suggestedTaskId,
              name: d.suggestedName ?? sCard?.name ?? "a client card",
              signupOn: d.suggestedSignupOn,
            }
          : null,
        line: `Signed ${dayText(signedOn, today)}, ${C > 0 ? usdText(dollars(C)) : "no contract value"} ${PLAN_LABEL[parts.plan]}, no client card found.${
          d.suggestedTaskId
            ? ` Probably ${d.suggestedName ?? "a client card"}${d.suggestedSignupOn ? ` (signed up ${dayText(d.suggestedSignupOn, today)})` : ""}.`
            : ""
        }`,
        preview,
        hints: hintsFor(
          d.business ?? "Signed deal",
          null,
          d,
          hintWorks,
          [],
          ctx,
        ),
      });
    }

  // Active cards with no deal (the CEO's suggested cards are in the no-card
  // group): late on the card's own next payment, a footnote with what the
  // card asks; a next payment still to come, a card-only row under Still to
  // come, out of every figure.
  const suggested = new Set(
    unlinked.map(u => u.suggested?.taskId).filter(Boolean) as string[],
  );
  const ladderDays = (c: ReadCard): number | null => {
    const a: Account = {
      taskId: c.taskId,
      name: c.name,
      url: c.url,
      status: c.status,
      group: "active",
      method: c.method ?? null,
      plan: c.plan,
      country: null,
      nextUsd: c.nextUsd,
      nextDate: c.nextDate,
      mrrUsd: null,
      ltvFieldUsd: c.ltvFieldUsd,
      pausedOn: null,
      extensionWeeks: c.extensionWeeks,
      churnDate: null,
      csm: c.csm ?? null,
      syncedAt: null,
      source: "sync",
    };
    return ladderOf(a, today).days;
  };
  const activeNoDeal = noDeal.filter(
    c =>
      c.group === "active" &&
      !suggested.has(c.taskId) &&
      !c.quiet &&
      !/^\s*ghosted\s*$/i.test(c.status ?? ""),
  );
  const lateNoDeal = activeNoDeal.filter(c => {
    const d = ladderDays(c);
    return d !== null && d < 0;
  });
  for (const c of activeNoDeal) {
    if (lateNoDeal.includes(c)) continue;
    const asks =
      (numOrNull(c.nextUsd) ?? 0) > 0 ||
      Boolean(c.nextDate && DAY_RE.test(c.nextDate));
    if (asks) rows.push(rowFor(c, null, read.rails, ctx));
  }
  rows.sort(rowOrder);
  const asked = (c: ReadCard) => {
    const usd = numOrNull(c.nextUsd);
    const day = c.nextDate && DAY_RE.test(c.nextDate) ? c.nextDate : null;
    return usd !== null && day
      ? ` (the card asks ${usdText(usd)}, due ${dayText(day, today)})`
      : day
        ? ` (due ${dayText(day, today)} on the card)`
        : "";
  };
  const footnote = lateNoDeal.length
    ? {
        names: lateNoDeal.map(c => c.name),
        line: `${lateNoDeal.length} more client${lateNoDeal.length === 1 ? " is" : "s are"} late on ${lateNoDeal.length === 1 ? "its" : "their"} card's next payment with no signed deal we could match: ${lateNoDeal.map(c => `${c.name}${asked(c)}`).join(", ")}. ${lateNoDeal.length === 1 ? "It is" : "They are"} in the sheet's Late view.`,
      }
    : null;

  // CEO: Back with sales (SALES TEAM TO CONTACT with a signed, unfinished deal).
  let backWithSales: PendingView["backWithSales"] = null;
  if (read.ceo) {
    const list: SalesRow[] = [];
    for (const s of read.backWithSales ?? []) {
      if (!s.deal) continue;
      const C = cents(s.deal.contractUsd);
      const R = (s.rails ?? []).reduce((t, r) => t + cents(r.usd), 0);
      if (C > 0 && R >= 0.99 * C) continue;
      const deal = s.deal;
      const mine = byTask(read.confirmations, s.taskId).filter(
        c => c.dealResponseId === deal.responseId || c.dealResponseId === null,
      );
      const proven = proofs(mine, s.rails ?? []);
      // The same fill as a listed row: an unproven confirmation holds its
      // part, so the panel never offers that room a second time.
      const specs = partsOf(deal).specs;
      const keys = specs.map(spec => keyOf(spec.kind, spec.no));
      const views = mine.map(c =>
        confirmationView(c, confirmationKey(c, keys), proven.get(c.id), ctx),
      );
      const heldC = views.filter(holding).reduce((t, c) => t + cents(c.usd), 0);
      const confirmable: Confirmable[] = [];
      const fill = fillParts(
        specs.map((spec, i) => ({ key: keys[i], c: spec.c })),
        R,
        views,
      );
      specs.forEach((spec, i) => {
        if (fill[i].emptyC > 0)
          confirmable.push({
            part: spec.kind,
            partNo: spec.kind === "later" ? spec.no : 0,
            label: spec.label,
            emptyUsd: dollars(fill[i].emptyC),
          });
      });
      // No parts to offer (no contract value, a plan nobody can read): what they paid in all.
      if (specs.length === 0) {
        const roomC = C > 0 ? Math.max(0, C - R - heldC) : null;
        if (roomC !== 0)
          confirmable.push({
            part: "all",
            partNo: 0,
            label: "What they paid in all",
            emptyUsd: roomC === null ? null : dollars(roomC),
          });
      }
      list.push({
        taskId: s.taskId,
        name: s.name,
        url: s.url,
        signedOn: deal.signedOn ?? (kuwaitDayOf(deal.signedAt) as string),
        business: deal.business,
        dealResponseId: deal.responseId,
        planLabel: PLAN_LABEL[planOf(deal.paymentStructure)],
        contractUsd: numOrNull(deal.contractUsd),
        railsUsd: moneyMissing ? null : dollars(R),
        leftUsd: !moneyMissing && C > 0 ? dollars(Math.max(0, C - R)) : null,
        confirmations: views,
        personUsd: dollars(
          specs.length > 0 ? fill.reduce((t, f) => t + f.personC, 0) : heldC,
        ),
        confirmable: moneyMissing
          ? confirmable.map(c => ({ ...c, emptyUsd: null }))
          : confirmable,
      });
    }
    list.sort(
      (a, b) =>
        a.signedOn.localeCompare(b.signedOn) || a.name.localeCompare(b.name),
    );
    const left = leftOf(list, moneyMissing);
    backWithSales = {
      rows: list,
      leftUsd: left.usd,
      line: `Back with sales: ${list.length} client${list.length === 1 ? "" : "s"}, ${left.words} (kept out of the figures)`,
    };
  }

  // Stale confirmations go to the CEO's Possible money.
  const staleConfirmations: StaleConfirmation[] = [];
  for (const r of [...rows, ...quietRows])
    for (const c of r.confirmations)
      if (c.state === "stale")
        staleConfirmations.push({
          taskId: r.taskId,
          clientName: r.name,
          confirmation: c,
          line: `${c.confirmedByName ? firstName(c.confirmedByName) : "Someone"} confirmed ${usdText(c.usd)} ${railName(c.rail)} paid ${dayText(c.paidOn, today)}, ${c.ageDays} days ago; no ${railName(c.rail)} payment proves it yet`,
        });

  // Card-only rows are never in a figure, not even as an unknown amount.
  const counted = rows.filter(r => !r.cardOnly);
  const fig = (pick: (r: PendingRow) => number | null): Figure => {
    const hit = counted.filter(r => (pick(r) ?? 0) > 0);
    return {
      usd: moneyMissing
        ? null
        : dollars(hit.reduce((t, r) => t + cents(pick(r)), 0)),
      count: hit.length,
      unknown: counted.filter(r => pick(r) === null).length,
    };
  };
  const old = (ts: string | null | undefined) =>
    !ts || now - Date.parse(ts) > 3600_000;
  const olderThan = (ts: string | null | undefined, ms: number) =>
    !ts || !Number.isFinite(Date.parse(ts)) || Date.parse(ts) < ms;
  const stale = {
    money: old(read.moneyAsOf),
    // billing-sync's last run due 15 minutes ago or more (a run takes up to
    // two and a half minutes), less a minute for the clocks.
    cards: olderThan(read.cardsAsOf, lastCardsRun(now - 15 * 60_000) - 60_000),
    deals: olderThan(read.dealsAsOf, now - 15 * 60_000),
    calls: olderThan(read.callsAsOf, now - 45 * 60_000),
  };
  const at = (ts: string | null | undefined) => {
    if (!ts || !Number.isFinite(Date.parse(ts))) return null;
    const day = kuwaitDayOf(ts);
    return `${kuwaitTime(ts)}${day && day !== today ? ` on ${dayText(day, today)}` : ""}`;
  };
  const tell = read.ceo
    ? "Check that it is running."
    : "Tell the CEO if it stays this way.";
  const staleLines: string[] = [];
  if (stale.cards)
    staleLines.push(
      at(read.cardsAsOf)
        ? `Client cards last read at ${at(read.cardsAsOf)}. A stage, plan or date changed in ClickUp after that shows at billing-sync's next read. ${tell}`
        : `Client cards have not been read from ClickUp yet, so a new, paused or moved client may be wrong here. ${tell}`,
    );
  if (stale.deals)
    staleLines.push(
      at(read.dealsAsOf)
        ? `Closer forms last copied at ${at(read.dealsAsOf)}. A deal signed or changed after that shows once the sales mirror runs again. ${tell}`
        : `Closer forms have not been copied yet, so no new client's terms are here. ${tell}`,
    );
  if (stale.calls)
    staleLines.push(
      at(read.callsAsOf)
        ? `Onboarding calls last read at ${at(read.callsAsOf)}. A call booked after that shows at the next read. ${tell}`
        : `Onboarding calls have not been read yet, so no booked call moves a due day. ${tell}`,
    );
  const quietLeft = leftOf(quietRows, moneyMissing);
  const chipCount = (k: ChipKey) =>
    rows.filter(r => r.chips.includes(k)).length;
  const upcoming = rows
    .filter(r => r.nextPart?.due && (r.nextPart.due as string) >= today)
    .sort((a, b) =>
      String(a.nextPart?.due).localeCompare(String(b.nextPart?.due)),
    )[0];
  return {
    today,
    ceo: read.ceo,
    asOf: {
      money: read.moneyAsOf,
      cards: read.cardsAsOf,
      deals: read.dealsAsOf,
      calls: read.callsAsOf,
      untied: read.untiedAsOf ?? null,
    },
    moneyMissing,
    stale,
    staleLine: moneyMissing
      ? `The money ledger has not run yet, so no rail money is counted. The figures read n/a until it does. ${read.ceo ? "Check that the money refresh is running." : "Ask the CEO to check the money refresh."}`
      : old(read.moneyAsOf)
        ? `Money last read at ${at(read.moneyAsOf) ?? kuwaitTime(read.moneyAsOf as string)}. A payment made after that shows at the next refresh.`
        : null,
    staleLines,
    figures: {
      onboarding: fig(r => r.onboardingNotSeenUsd),
      later: fig(r => r.laterNotSeenUsd),
      notSeen: fig(r => r.notSeenUsd),
      upcoming: fig(r => r.upcomingOnboardingUsd),
      another: fig(r => r.anotherUsd),
      person: fig(r => r.personUsd),
      typed: fig(r => r.typedUsd),
    },
    chips: (
      ["notSeen", "onboarding", "later", "another", "toCome"] as ChipKey[]
    ).map(k => ({
      key: k,
      label: CHIP_LABEL[k],
      count: chipCount(k),
    })),
    rows,
    quiet: {
      rows: quietRows,
      leftUsd: quietLeft.usd,
      line: quietRows.length
        ? `Gone quiet: ${quietRows.length} client${quietRows.length === 1 ? "" : "s"}, ${quietLeft.words} (kept out of the figures)`
        : null,
    },
    backWithSales,
    unlinked,
    footnote,
    finished,
    finishedLine: finished.length
      ? `Finished on the rails: ${finished
          .map(f => f.name)
          .sort((a, b) => a.localeCompare(b))
          .join(", ")}.`
      : null,
    possibleMoney: read.ceo
      ? possibleMoneyOf([
          ...rows.flatMap(r => r.hints),
          ...unlinked.flatMap(u => u.hints),
        ])
      : [],
    staleConfirmations: read.ceo ? staleConfirmations : [],
    nothingDueLine: upcoming?.nextPart
      ? `Nothing due is unseen. Next: ${upcoming.name}, ${usdText(upcoming.nextPart.usd)} on ${dayText(upcoming.nextPart.due, today)}.`
      : "Nothing due is unseen.",
  };
}
