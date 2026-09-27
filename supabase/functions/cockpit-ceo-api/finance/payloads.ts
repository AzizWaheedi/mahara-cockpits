export type Transaction = {
  id: string;
  /** Kuwait day. */
  day: string;
  rail: "whop" | "tap" | "transfer" | "manual" | "bank";
  direction: "in" | "out";
  usd: number;
  currency: string;
  amount: number;
  payerEmail: string | null;
  payerName: string | null;
  side: AttributionSide | "out";
  kind: AttributionKind | "refund" | "expense";
  /** A first name: the closer for a deposit, the CSM for the rest. */
  person: string | null;
  personRole: "closer" | "csm" | null;
  dealBusiness: string | null;
  clientName: string | null;
  clientTaskId: string | null;
  /** How the payment was tied: deal_id, deal_email, deal_name, card_email, card_payer, card_name, card_typed or none. */
  matchedBy: string;
  /** Whop's billing reason, a manual rail, an expense category, or a refund note. */
  detail: string | null;
  /** For a statement line: the kind the cockpit gave it (client_payment, whop_payout, excluded, ...). */
  bankKind?: string;
  /** The statement line's own id, so it can be reclassified from the Transactions tab. */
  bankLineId?: number;
};

export type AttributionKind = "deposit" | "kickoff" | "client" | "none";

export type AttributionSide = "front_end" | "back_end" | "unattributed";

export type PossibleDuplicate = {
  /** The manual entry's row id. */
  manualId: string;
  manualDay: string;
  /** The manual side in USD: `amountUsd`, or `dealContractedUsd` when `against` is "closer_form". */
  manualUsd: number;
  manualClient: string;
  /** What it may duplicate. */
  against: "whop" | "tap" | "closer_form";
  otherDay: string;
  otherUsd: number;
  /**
   * The other side's client business name as the cockpit knows it (a
   * matched ClickUp card name, or the closer form's business name), or null
   * when that source gives none. Never a payer's personal name or email.
   */
  otherClient: string | null;
  /**
   * Whole days between the two: 0 to 3 for Whop and Tap. For "closer_form"
   * it can be more, because a hand-logged deal whose client matches a closer
   * form deal in the same Kuwait month is flagged whatever the gap.
   */
  daysApart: number;
  /**
   * |manual - other| / max(manual, other): 0 to 0.05 for Whop and Tap. For
   * "closer_form" it can be more, for the same reason. A flagged deal value
   * is left out of the hand-logged contracted figures.
   */
  amountGap: number;
  /** One plain sentence: why this pair was flagged and what to do. */
  why: string;
};

export type ManualPaymentRow = {
  /** The Convex row id, what the remove and restore mutations take. */
  id: string;
  /** "payment" or "refund" (money given back). Absent on rows stored before 2026-09-21 means payment. */
  kind?: "payment" | "refund";
  /** Kuwait day the money was received. */
  day: string;
  /** The amount as typed, in `currency`. */
  amount: number;
  currency: "USD" | "KWD";
  /** USD at the rate stored on the row at write time. */
  amountUsd: number;
  /** The client name as typed. Emails and phone numbers are masked. */
  client: string;
  /** The ClickUp card it was matched to, or null. */
  clickupTaskId: string | null;
  rail: ManualRail;
  /** Deal value as typed, in `currency`, or null when this is not a new deal. */
  dealContracted: number | null;
  /** Deal value in USD, or null. Adds to contracted, never to cash. */
  dealContractedUsd: number | null;
  /** Free text, one line, emails and phone numbers masked. */
  note: string | null;
  /** Who logged it, as a name ("Aziz"), never an email. */
  addedBy: string;
  addedAt: number;
  /** Set when the entry was removed; the row then counts in no total. */
  deletedAt: number | null;
  deletedBy: string | null;
  /** True when a live entry appears in `possibleDuplicates`. */
  possibleDuplicate: boolean;
  /**
   * Set when this entry is on the "tap" rail (so it was logged while Tap was
   * not connected; the add mutation refuses Tap entries once it is) and the
   * Tap rail now shows a matching charge, at most 3 days apart and within 5%.
   * The entry is then left out of every manual total, so the money counts
   * once, on the Tap rail. Null otherwise. Absent on older payloads.
   * (Added 2026-09-16 by the manual payments feature.)
   */
  coveredByTap?: { chargeDay: string; chargeUsd: number } | null;
};

export type ManualRail = "bank_transfer" | "cheque" | "cash" | "tap" | "other";

export type CashRail = {
  /** Plain name for the screen, e.g. "Whop", "Tap", "All rails". */
  label: string;
  connected: boolean;
  today: number | null;
  yesterday: number | null;
  mtd: number | null;
  lastMonthToDate: number | null;
  lastMonth: number | null;
  /** mtd / dayOfMonth * daysInMonth. */
  projectedMonth: number | null;
  /** Refunds booked this month on this rail, by the day the refund happened. */
  refundsMtd: number | null;
  /** Net cash per Kuwait day, last 90 days, oldest first, zero days included. Empty when not connected. */
  daily: Point[];
  /** Newest payment seen on this rail, epoch ms. */
  lastPaymentAt: number | null;
};

export type Point = { date: string; value: number };

export type Note = { level: "info" | "warn"; text: string };

export type ExpenseGroup = {
  amount: number | null;
  headline: number | null;
  /** Lines taken out of the headline, biggest first. */
  excluded: { label: string; amount: number }[];
  /** Vendors inside `amount`, biggest first. */
  vendors: ExpenseLine[];
  quality: "measured" | "floor" | "missing";
  why: string | null;
};

export type ExpenseLine = {
  vendor: string;
  amount: number;
  /** How many rows in the month carry this vendor. */
  rows: number;
  /** The category the import gave it: software, salaries, ad_spend, other, uncategorised. */
  category: string;
  /**
   * Set when the line is not what its category says, so the screen can show it
   * taken out of the group: "bank", "course", "transfer", "personal".
   */
  reclass: string | null;
};

export type ExpensesPayload = {
  /** The month these numbers cover, YYYY-MM, or null when no rows are loaded. */
  month: string | null;
  /** Every month that has expense rows, oldest first. One entry means no trend can be drawn. */
  monthsLoaded: string[];
  /** When the expense rows were imported, epoch ms. */
  importedAt: number | null;
  /** Fixed USD per KWD the import used. Other parts of the stack use their own rate, so never mix the two. */
  fxUsdPerKwd: number | null;
  /** Every row in the month, card unload lines included. */
  total: number | null;
  /** `total` minus the card unload lines: what was actually spent. */
  spend: number | null;
  /** Money moved to a card, which is not a cost. */
  unloads: number | null;
  software: ExpenseGroup;
  overhead: ExpenseGroup;
  labour: ExpenseGroup;
  /** Mahara's own lead-gen ad spend. The same money as growth spend, so never add the two. */
  ownAdSpend: ExpenseGroup;
  /** Every category in the month exactly as imported, biggest first, nothing moved. */
  byCategory: { category: string; amount: number; rows: number }[];
  /** Client media for the same month, carried so the screen can name it and keep it out of the P&L. */
  clientAdSpend: { amount: number | null; clients: number | null };
  /** Cash in for the same month, so a profit line can be drawn when both sides are real. */
  revenue: number | null;
  /** Revenue minus spend. null unless every line inside `spend` is measured; `why` says what is missing. */
  profit: { amount: number | null; margin: number | null; why: string | null };
  /** People who filed an EOD in the month, so labour can be judged against head count. */
  peopleFilingEods: number | null;
  notes: Note[];
};

export type MoneyPayload = {
  /** Current Kuwait month, YYYY-MM. */
  month: string;
  dayOfMonth: number;
  daysInMonth: number;
  cash: {
    today: number;
    yesterday: number;
    mtd: number;
    /** Last month up to the same day of month, for a fair pace comparison. */
    lastMonthToDate: number;
    lastMonth: number;
    /** mtd / dayOfMonth * daysInMonth. */
    projectedMonth: number;
    /** Whop net cash per Kuwait day, last 90 days, oldest first, zero days included. */
    daily: Point[];
  };
  /**
   * The same cash split by rail, so Whop and Tap can be shown side by side and
   * summed. `cash` above stays Whop only, which is what the rest of the
   * cockpit already reads. `rails.total` adds up the connected rails only, and
   * a rail that is not connected is named in the notes, so a total is never
   * read as the whole business.
   *
   * The money adapter always fills this now. It stays optional because a
   * payload stored before the adapter shipped has no `rails` and the store
   * keeps the last good payload across a deploy, so a screen can still meet
   * one. Read it through `cashHeadline` in `src/components/ceo/metrics.ts`,
   * which falls back to `cash` and says the number is Whop only.
   */
  rails?: {
    whop: CashRail;
    /** Tap Payments. connected is false until TAP_SECRET_KEY is set on the deployment. */
    tap: CashRail;
    /**
     * Payments Aziz logs by hand on the Money tab (ceoManualPayments, added
     * 2026-09-16): bank transfers, cheques, cash, Tap links and other. Same
     * shape as the other rails, from live entries only (no `deletedAt`),
     * counted on the entry's `day` at its stored `amountUsd`.
     *
     * - `connected` is true once at least one live entry exists, ever. Before
     *   that every number is null and the screen shows n/a, because an empty
     *   log proves nothing about money that arrived off Whop.
     * - `refundsMtd` is always null: refunds are not logged by hand.
     * - `lastPaymentAt` is Kuwait midnight of the newest entry's `day` (a hand
     *   entry has a day, not a time).
     * - Only what was typed in: a transfer nobody logged is missing, not zero.
     *   The adapter says so in `notes`.
     *
     * Optional only because payloads stored before the money adapter filled
     * it have none. Read it as `m.rails?.manual`.
     */
    manual?: CashRail;
    /**
     * Client payments on the uploaded bank statements (2026-09-21). Connected
     * once a statement is held. Whop payouts, Tap settlements and Mahara's
     * own transfers are never in it. Absent on older payloads.
     */
    bank?: CashRail;
    /**
     * Whop plus Tap plus manual plus bank, over the connected rails only.
     * Possible duplicates (below) are still inside it until Aziz deletes the
     * entry. A Tap charge a settlement line covers, and a hand-logged
     * transfer a statement line covers, count once, on the bank rail.
     */
    total: CashRail;
  };
  /**
   * This month's hand-logged payments for the Money tab, newest `day` first,
   * then newest `addedAt`. Deleted entries of the month are included with
   * `deletedAt` set, so a removal stays visible; no total counts them.
   * Optional for payloads stored before the adapter filled it.
   */
  manualEntries?: ManualPaymentRow[];
  /**
   * Hand entries that may be the same money as a payment another rail
   * already counts, or a deal value the closer form already counts. Never
   * removed automatically: the entry stays in the totals until Aziz deletes
   * it, and a warn note names the count and the dollars at stake. Covers
   * live entries dated in the last 90 days. Optional for older payloads.
   */
  possibleDuplicates?: PossibleDuplicate[];
  /** Last 12 months including the current one, oldest first. */
  monthly: {
    month: string;
    /** Whop only, as before. */
    cash: number;
    refunds: number;
    /** Closer form only, as before. */
    contracted: number;
    deals: number;
    /** Live hand-logged cash dated in the month (USD). Absent on older payloads. */
    manualCash?: number;
    /**
     * Live hand-logged deal values dated in the month (USD), less any the
     * closer form already has (listed in possibleDuplicates). Absent on older
     * payloads, and absent when the deal check could not run.
     */
    manualContracted?: number;
  }[];
  /**
   * Whop refunds by refund day, plus refunds logged by hand (a manual entry
   * with kind refund, 2026-09-21). `manualMtd` / `manualLast90` are the
   * hand-logged part, already inside `mtd` / `last90`; absent on older payloads.
   */
  refunds: {
    mtd: number;
    last90: number;
    manualMtd?: number;
    manualLast90?: number;
  };
  deals: {
    /** Closer form deals only. */
    mtd: number;
    lastMonth: number;
    /** Closer form contracted value only. The monthly targets compare against this. */
    contractedMtd: number;
    contractedLastMonth: number;
    /**
     * Hand-logged deals this month: live manual entries with a deal value
     * (decision of 2026-09-16, the deal field adds to contracted). Kept apart
     * from `mtd` and `contractedMtd` so those keep their meaning; the
     * contracted headline is `contractedMtd + manualContractedMtd`, and a
     * manual deal the closer form also has is listed in possibleDuplicates.
     * All three are absent on payloads stored before the adapter filled them.
     */
    manualMtd?: number;
    manualContractedMtd?: number;
    manualContractedLastMonth?: number;
    /** Mean contracted value of deals signed in the last 90 days that have one. */
    avgContract90d: number | null;
    /** Newest 10 deals. */
    recent: {
      date: string;
      business: string | null;
      closer: string | null;
      contracted: number | null;
      cash: number | null;
      plan: string | null;
    }[];
  };
  /** Whop checkouts that did not become cash (status open) in the last 30 days. */
  failedCharges: { count30d: number; amount30d: number };
  /** Latest month that has expense rows loaded, or null. */
  expenses: {
    month: string | null;
    total: number | null;
    byCategory: { category: string; amount: number }[];
  };
  /** Targets for the current month from monthly_targets, if any. */
  targets: {
    month: string | null;
    items: { metric: string; target: number; actual: number | null }[];
  };
  /**
   * The MRR field on the ClickUp client cards, added up by stage
   * (convex/ceo/billing.ts, first read 2026-09-18).
   *
   * Read every figure here as "what somebody typed on a card", never as
   * measured recurring revenue. Three things have to stay visible beside it:
   *
   * - It is not all monthly money. A client on Paid In Full or Split Pay has a
   *   share of a one-off contract in the same field, so `recurringUsd` and
   *   `oneOffUsd` are kept apart and `bookUsd` (their sum) mixes the two.
   * - Who counts as a client is undecided, so the groups are never added up
   *   here. Active, paused and pipeline are reported separately.
   * - Blank is not zero. `blank` names the live cards carrying no figure.
   *
   * Optional: a payload stored before this shipped has none, and the store
   * keeps the last good payload across a deploy.
   */
  mrr?: {
    /**
     * Per stage group: active, paused, pipeline (signed, not yet live), sales
     * (parked on the sales list, not a client) and gone.
     */
    groups: {
      group: "active" | "paused" | "pipeline" | "sales" | "gone";
      cards: number;
      filled: number;
      bookUsd: number;
      recurringUsd: number;
      oneOffUsd: number;
      /** On cards whose Payment Plan is blank, so it is in neither of the two above. */
      unclassifiedUsd: number;
    }[];
    /**
     * Live cards with no MRR figure. Sales-list cards and Mahara's own
     * internal cards are left out: neither is a client whose money is missing.
     */
    blank: { taskId: string; name: string; stage: string | null }[];
    /** Mahara's own cards (playing account, lifecycle test) inside `cards`. */
    internalCards: number;
    /** The LTV field: a number typed by hand on a card, not a total of cash received. */
    ltv: { filled: number; totalUsd: number };
    /** Payment Method coverage. Empty `mix` means the field is filled on no card. */
    paymentMethod: { filled: number; mix: { method: string; cards: number }[] };
    /** How much of the lifecycle record exists at all: churn dates, pause dates, renewal dates. */
    lifecycle: {
      gone: number;
      goneWithChurnDate: number;
      goneWithChurnReason: number;
      paused: number;
      pausedWithDate: number;
      withRenewalDate: number;
    };
    cards: number;
    /** When the CSM sync last rewrote these rows, epoch ms. */
    syncedAt: number | null;
  };
  /**
   * Signed deals against the cash that can actually be tied to them
   * (b2b_deal_cash(), first read 2026-09-19).
   *
   * Read `linkedCash` as "cash we can prove belongs to a deal", never as
   * "cash collected". The link is `whop_payments.deal_response_id`, and the
   * only rule that fills it is an email match between the payer and the
   * closing form: on 2026-09-19 it had linked 42 of 124 paid rows. The other
   * 82 rows are real money that reaches no deal.
   *
   * So a deal with no linked cash has not been shown to be unpaid. It has been
   * shown to have no payment matched to it, which is a different and much
   * weaker statement, and every figure here is labelled that way.
   */
  collection?: {
    deals: number;
    contracted: number;
    /** Whop cash tied to a deal by response id. */
    linkedCash: number;
    /** Deals with at least one payment linked. */
    dealsWithCash: number;
    /** Paid Whop cash tied to no deal at all. */
    unlinkedCash: number;
    unlinkedRows: number;
    /** Of the unlinked money, how much predates the closing form and can never be tied. */
    beforeFormCash: number;
    /** The month the closing form's first deal was submitted, YYYY-MM. */
    formStarted: string | null;
    /** Per month: what was contracted and what cash is linked to those deals. */
    byMonth: {
      month: string;
      deals: number;
      contracted: number;
      linked: number;
    }[];
    /** Signed deals carrying a contract value with no payment linked, biggest first. */
    unmatched: {
      client: string;
      month: string;
      contracted: number;
      plan: string | null;
    }[];
  };
  /**
   * Every payment in over the last twelve months given a side of the
   * business, a person and a deal or a client (convex/ceo/attribution.ts,
   * 2026-09-21), with the money out the database holds beside it. Optional
   * for payloads stored before it shipped.
   */
  attribution?: MoneyAttribution;
  /**
   * Projected MRR and the collection rate (Aziz, 2026-09-21): MRR due this
   * month over active cards on a recurring plan, against the cash attributed
   * to those clients this month. Kept per month in ceoDaily
   * (money.book.projected / money.book.collected, scope company, on the
   * month's first day) so the history grows from now on. Absent on older
   * payloads.
   */
  /**
   * The bank statements uploaded on the Money tab (CBK Online CSV, parsed by
   * convex/ceo/bank.ts, stored in cockpit_bank_lines). Client payments on
   * them are the Bank rail; Whop payouts, Tap settlements and Mahara's own
   * transfers are dropped so nothing counts twice; debits are the expenses
   * with the personal exclusions taken out. Absent on older payloads.
   */
  bank?: {
    /** Newest statement's last day, and how many days ago that was. */
    lastStatementTo: string | null;
    daysSince: number | null;
    /** True past 7 days, or with no statement at all. */
    stale: boolean;
    statements: {
      id: string;
      account: string;
      accountKind: string;
      fromDay: string | null;
      toDay: string | null;
      lines: number;
      importedAt: number | null;
    }[];
    accounts: string[];
    /** Lines over the last 12 months by kind, count and USD (signed). */
    kinds: { kind: string; label: string; count: number; usd: number }[];
    /** Whop payouts on the statements: how many were matched to a run of Whop payments. */
    payouts: {
      count: number;
      matched: number;
      usd: number;
      matchedUsd: number;
    };
    /** Tap settlements on the statements, and how many Tap charges they were matched to. */
    tapSettlements: { count: number; usd: number; chargesCovered: number };
    /** Hand-logged bank transfers, cheques and cash that a statement line now accounts for. */
    manualCovered: number;
    /** Expenses from the statements by month, newest first, personal exclusions apart. */
    expenses: {
      month: string;
      total: number;
      byCategory: { category: string; usd: number; lines: number }[];
      excluded: { usd: number; lines: number };
      fees: number;
    }[];
    exclusions: {
      id: number;
      kind: "card" | "vendor";
      pattern: string;
      note: string | null;
    }[];
    /** Lines with no kind the rules could give. */
    unknown: number;
  };
  book?: {
    month: string;
    /** Sum of the MRR field over active cards on a recurring plan. */
    projectedMrr: number;
    projectedCards: number;
    /** Cash attributed to those clients this month, every rail. */
    collected: number;
    collectionRate: number | null;
    /** Mean MRR over the same cards. */
    averageRetainer: number | null;
    /** Earlier months as far as the history goes, oldest first. */
    history: {
      month: string;
      projected: number;
      collected: number;
      rate: number | null;
    }[];
  };
  notes: Note[];
};

export type MoneyAttribution = {
  from: string;
  to: string;
  /** False until the CSM's kickoff form is loaded; kickoff cash is then judged from the rails. */
  kickoffRead: boolean;
  /** False when Tap could not be read this run, so Tap money is not in it. */
  tapRead: boolean;
  totals: AttributionTotals & { out: number; outCount: number };
  mtd: AttributionTotals;
  lastMonth: AttributionTotals;
  byPerson: {
    name: string;
    role: "closer" | "csm";
    frontEnd: number;
    backEnd: number;
    payments: number;
  }[];
  /** Newest first, capped. */
  transactions: Transaction[];
};

export type AttributionTotals = {
  in: number;
  count: number;
  frontEnd: number;
  deposit: number;
  kickoff: number;
  backEnd: number;
  unattributed: number;
  unattributedCount: number;
};