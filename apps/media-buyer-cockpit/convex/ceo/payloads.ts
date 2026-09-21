/**
 * The exact shape of every CEO section payload. Adapters on the backend fill
 * these; the /ceo screens read them. Change a shape here first.
 *
 * Conventions for every payload:
 * - Money is USD dollars. Days are Kuwait days (UTC+3), "YYYY-MM-DD".
 * - A number the source cannot give is null, never 0. A real zero is 0.
 * - Rates are fractions 0..1 (0.25 means 25%), never percents.
 * - `notes` carries trust caveats the screen shows next to the numbers.
 * - No lead names, phone numbers, emails or message bodies. Client business
 *   names, team first names and Maqsam agent names are fine.
 */

export type Note = { level: "info" | "warn"; text: string };
export type Point = { date: string; value: number };

// --- Money (B2B Supabase: whop_payments, closed_deals, monthly_targets; Tap API) ---

/**
 * One way money reaches Mahara. `connected` false means the rail is not wired
 * up yet: every number on it is null and the screen shows n/a, never 0.
 */
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

/**
 * How a hand-logged payment arrived. The same union as
 * ceoManualPayments.rail in convex/schema.ts (writeGuard.ts `vManualRail`),
 * so an adapter passing a stored row through is checked against it.
 */
export type ManualRail = "bank_transfer" | "cheque" | "cash" | "tap" | "other";

/** One hand-logged payment as the Money tab shows it (ceoManualPayments). */
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

/**
 * A hand entry that may be money another source already counts.
 *
 * The rule (2026-09-16): a live manual entry and a payment on Whop or Tap
 * dated at most 3 days apart, whose USD amounts differ by at most 5% of the
 * larger, for a similar client name. Tap charges carry no client name in the
 * cockpit's read, so a Tap match is on day and amount alone and `why` says
 * so. For a manual entry with a deal value, the same test runs against
 * closer form deals (business name, submitted day, contracted value).
 * Similar name means the two names match after lower casing and keeping
 * letters and digits only, or one contains the other, or both resolve to the
 * same ClickUp card.
 */
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

export type AttributionSide = "front_end" | "back_end" | "unattributed";
export type AttributionKind = "deposit" | "kickoff" | "client" | "none";

/** One line on the Transactions tab: a payment in, or money out. */
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

// --- Expenses and P&L (B2B Supabase: public.expenses, a bank statement import) ---

/**
 * One vendor line inside a P&L group. `vendor` is the bank card descriptor as
 * it was imported, so one tool can appear under more than one name.
 */
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

/**
 * One P&L line. `amount` is what can honestly be shown, `headline` is the raw
 * category total before anything was moved out of it, and `excluded` lists
 * what moved. `quality` says how far to trust `amount`: measured is the real
 * number, floor is a known undercount, missing means nothing defensible exists
 * and `amount` is null. `why` is the sentence the screen must show beside it.
 */
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

// --- Growth: Mahara's own acquisition funnel (B2B dashboard functions) ---

export type FunnelWindow = {
  from: string;
  to: string;
  spend: number;
  /**
   * Leads by the setters' ROAS tags in GoHighLevel: `roas-qualified` plus
   * `roas-unqualified`, dated by creation (Aziz, 2026-09-21). Not the
   * dashboard's `is_lead` count, which is kept in `raw.leads`.
   */
  leads: number;
  /** Lead-gen spend over `leads`; the dashboard's own is `raw.cost_per_lead`. */
  cpl: number | null;
  /** The four ROAS classes; only the first two are leads. */
  leadClasses: {
    qualified: number;
    unqualified: number;
    /** `roas-unprepared`: shown, never counted. */
    notReady: number;
    /** No ROAS tag yet: shown, never counted. */
    untagged: number;
  };
  /**
   * Where the leads came from (Aziz, 2026-09-21). `ads` carry an ad id;
   * `organic` carry none and a source, tag or attribution medium that says
   * inbound WhatsApp, Instagram DM, YouTube, referral or organic;
   * `assumedAds` carry neither and are counted as ads, labelled assumed.
   */
  sources: { ads: number; organic: number; assumedAds: number };
  /**
   * From a lead's creation to the first Maqsam call with it by a sales rep
   * on the roster (never a call-centre agent), over the leads that were
   * called. `neverCalled` is shown beside the median, never inside it.
   */
  speedToLead: {
    leads: number;
    called: number;
    neverCalled: number;
    medianMin: number | null;
    within5Share: number | null;
    /**
     * The same on the working clock (Aziz, 2026-09-21): the clock starts at
     * the later of the lead's creation and the next working window, and
     * only working minutes count (cockpit_settings working hours, default
     * 10:00 to 18:00 Kuwait, Saturday to Thursday). Absent on older payloads
     * and on windows rebuilt from days.
     */
    workingMedianMin?: number | null;
    workingWithin5Share?: number | null;
  };
  /**
   * Leads created in the window with at least one intro or demo booked
   * against their contact, ever, over leads. Per lead, never per booking.
   */
  leadToBooked: { bookedLeads: number; rate: number | null };
  introsBooked: number;
  /** The dashboard's `intros_shown`: showed, or confirmed or invalid once the time has passed. */
  introsShown: number;
  /** The dashboard's `intros_due`: intro calls whose time has passed, cancelled and no-show included. */
  introsDue: number;
  demosBooked: number;
  demosShown: number;
  demosDue: number;
  /** The dashboard's `demo_show_rate`: demos shown over demos due, 0..1 to three places. */
  demoShowRate: number | null;
  /** The dashboard's `intro_show_rate`, the same rule for intro calls. */
  introShowRate: number | null;
  /** The dashboard's `intro_to_demo`: intros that went on to book a demo, over intros shown. */
  introToDemo: number | null;
  /** Past demos in the window still marked confirmed. They count as shown under the dashboard's rule. */
  demosStillConfirmed: number;
  /**
   * Cancellations, from the dashboard's raw counts: calls with status
   * cancelled over calls scheduled in the window (by call day), for intros,
   * demos and both together. Fractions 0..1.
   */
  cancel: {
    intro: number | null;
    demo: number | null;
    total: number | null;
    introsCancelled: number;
    introsScheduled: number;
    demosCancelled: number;
    demosScheduled: number;
  };
  /** The dashboard's `cost_per_demo`: lead-gen spend over demos shown. */
  costPerDemo: number | null;
  /** The dashboard's `cost_per_demo_booked`: lead-gen spend over demos booked. */
  costPerDemoBooked: number | null;
  closes: number;
  /** Signed over every demo shown (the dashboard's `close_rate_all`). */
  closeRate: number | null;
  /** Signed over demos qualified, shown minus invalid (the dashboard's `close_rate`). */
  qualifiedCloseRate: number | null;
  contracted: number;
  /** The deposit the closer typed on the form (the dashboard's `cash_collected`). */
  cash: number;
  /**
   * Front-end cash: the deposit at signing plus the kickoff cash collected
   * on the onboarding call. `kickoff` is null until the kickoff form is
   * read, so `total` is the deposit alone. `confirmed` is the deposit money
   * a Whop payment or a bank transfer on record backs; Tap is not checked.
   */
  frontEndCash: {
    deposit: number;
    kickoff: number | null;
    total: number;
    deals: number;
    dealsConfirmed: number;
    confirmed: number;
    confirmedShare: number | null;
  };
  cac: number | null;
  /** The dashboard's `roas`: contracted over lead-gen spend. Same as `roasContracted`. */
  roas: number | null;
  /** Front-end ROAS, the main one: front-end cash over lead-gen spend. */
  roasCash: number | null;
  /** Contracted ROAS: contracted over lead-gen spend. */
  roasContracted: number | null;
  /** Every numeric key the B2B window function returned, as is. */
  raw: Record<string, number | null>;
};

export type GrowthDay = {
  date: string;
  /** Lead-gen spend. */
  spend: number;
  spendRetargeting?: number;
  /** ROAS-tagged leads created that day. */
  leads: number;
  qualified?: number;
  unqualified?: number;
  notReady?: number;
  untagged?: number;
  /** Of that day's leads, how many ever booked an intro or demo. */
  bookedLeads?: number;
  srcAds?: number;
  srcOrganic?: number;
  srcAssumed?: number;
  /** Of that day's leads: called by a sales rep, their minutes to the first call added up, and how many within 5 minutes. */
  spCalled?: number;
  spMinutes?: number;
  spWithin5?: number;
  /** Intro plus demo calls booked that day. */
  booked: number;
  introsBooked?: number;
  demosBooked?: number;
  /** Calls held that day, by the dashboard's rules. */
  introsScheduled?: number;
  demosScheduled?: number;
  introsDue?: number;
  demosDue?: number;
  introsShown?: number;
  demosShown?: number;
  demosQualified?: number;
  introsCancelled?: number;
  demosCancelled?: number;
  closes: number;
  contracted?: number;
  /** Deposits typed on the closer form that day. */
  deposit?: number;
};

export type GrowthPayload = {
  windows: {
    yesterday: FunnelWindow;
    last7: FunnelWindow;
    prevLast7: FunnelWindow;
    mtd: FunnelWindow;
    lastMonthToDate: FunnelWindow;
    lastMonth: FunnelWindow;
  };
  /**
   * Last 365 days, oldest first. Every stage by its own day, so any timeframe
   * is a sum of days and any rate a quotient of sums (2026-09-21): spend by
   * Meta day, leads by creation day, bookings by booking day, calls held by
   * call day, closes by form day. The fields after `closes` are absent on
   * payloads stored before this shipped.
   */
  daily: GrowthDay[];
  /** Month to date. */
  reps: {
    name: string;
    role: string | null;
    booked: number;
    shown: number;
    closes: number;
    closeRate: number | null;
    contracted: number;
    cash: number;
  }[];
  /** Last 7 days, top 6 by spend. */
  topAds: { name: string; spend: number; leads: number; cpl: number | null }[];
  /**
   * Our own ads, judged on what they produced rather than what they cost
   * (b2b_marketing_ads, first read in full 2026-09-19).
   *
   * The B2B dashboard's per-ad row, kept whole: every field the media buyer
   * needs to say which creative is working. Ranked by outcome — closes first,
   * then demos, then leads — because the biggest spender is not the winner.
   *
   * `inMeta` false means Meta has no snapshot for the ad at all, usually
   * because it was deleted or archived. It appears anyway when leads or demos
   * are attributed to it, and its spend is unknown rather than zero.
   *
   * `thumbnail` is a Facebook CDN url with an expiring token, so it can stop
   * resolving without anything being wrong. The card falls back to the name.
   */
  winningAds?: {
    windowDays: number;
    rows: {
      adId: string;
      name: string;
      thumbnail: string | null;
      status: string | null;
      inMeta: boolean;
      spend: number;
      impressions: number;
      clicks: number;
      ctr: number | null;
      leads: number;
      cpl: number | null;
      qualified: number;
      qualifiedPct: number | null;
      demos: number;
      costPerDemo: number | null;
      sales: number;
      revenue: number;
      cash: number;
      cpa: number | null;
      revRoas: number | null;
    }[];
  };
  /** Month to date. */
  leadSources: { source: string; leads: number }[];
  /**
   * Records the sales system is waiting on somebody to fix
   * (b2b_action_queue, first read 2026-09-19).
   *
   * Counts only. The function returns the contact's name, email and phone on
   * every row and none of that comes into the payload: the CEO screens carry
   * client business names and team first names, never a lead's identity.
   *
   * The largest bucket is calls with no outcome, which is the same rot behind
   * the show rate: a past call still marked booked counts as neither shown nor
   * missed, so every rate computed over it is soft.
   */
  actionQueue?: {
    total: number;
    buckets: { key: string; label: string; hint: string; count: number }[];
  };
  /**
   * Deals that have not moved (b2b_stalled_deals). Counts and value by age
   * bucket and by owner, never the contact behind them.
   */
  stalled?: {
    staleDays: number;
    total: number;
    stale: number;
    buckets: { age: string; deals: number }[];
    byOwner: { owner: string; deals: number; value: number }[];
  };
  /** Pace against the month (b2b_pacing_pipeline). */
  pacing?: {
    openDemosLeft: number | null;
    closeRate: number | null;
    avgDealValue: number | null;
  };
  notes: Note[];
};

// --- Call centre (Creative Triage dialer reporting store; B2B maqsam tables for history) ---

export type CallWindow = {
  dials: number;
  connected: number;
  connectRate: number | null;
  talkMinutes: number;
  avgTalkSec: number | null;
  /** Connected calls lasting 90 seconds or more. */
  conversations90s: number;
};

export type CallsPayload = {
  today: CallWindow;
  yesterday: CallWindow;
  last7: CallWindow;
  prevLast7: CallWindow;
  /** Last 30 days, oldest first. */
  daily: {
    date: string;
    dials: number;
    connected: number;
    conversations90s: number;
  }[];
  byAgent: {
    agent: string;
    today: CallWindow;
    last7: CallWindow;
    lastCallAt: number | null;
  }[];
  /** Kuwait hours 0..23 today. */
  byHourToday: { hour: number; dials: number; connected: number }[];
  /** Last 7 days, only for calls that carry a lead phone. */
  perClient7d: {
    client: string;
    clickupTaskId: string | null;
    dials: number;
    connected: number;
    leadsCalled: number;
    callsPerLead: number | null;
  }[];
  speedToLead: {
    medianMinutes7d: number | null;
    within5minShare7d: number | null;
    sample: number;
    /** First day with lead-linked calls. */
    since: string | null;
    /**
     * The same median and share on the working clock (Aziz, 2026-09-21):
     * the clock starts at the later of the lead's creation and the next
     * working window, and only working minutes count. Absent on older
     * payloads.
     */
    workingMedianMinutes7d?: number | null;
    workingWithin5minShare7d?: number | null;
  };
  /**
   * The working hours the clock uses, from cockpit_settings in Creative
   * Triage (key working_hours), or the default when none is stored:
   * 10:00 to 18:00 Asia/Kuwait, Saturday to Thursday. Absent on older payloads.
   */
  workingHours?: WorkingHours;
  lastCallAt: number | null;
  notes: Note[];
};

/**
 * Working hours as stored in cockpit_settings (key working_hours). `days`
 * are ISO weekday numbers 1 (Monday) to 7 (Sunday); times are "HH:MM" in
 * `timezone`.
 */
export type WorkingHours = {
  start: string;
  end: string;
  days: number[];
  timezone: string;
  /** "settings" when a stored row was read, "default" otherwise. */
  source: "settings" | "default";
  updatedAt?: number | null;
};

// --- Client delivery (Convex media buyer tables) ---

export type DeliveryWindow = {
  spend: number;
  leads: number;
  cpl: number | null;
  /** Total bookings: provisional + online + main calendars, by the day the meeting is for, future ones excluded. */
  bookings: number;
  /** Spend over total bookings. */
  cpb: number | null;
  /**
   * The three booking counts (Aziz, 2026-09-21): provisional = the
   * provisional calendar only (it has produced no rows in Creative Triage
   * yet); confirmed = the online and main calendars. `bookings` above is
   * their sum. Absent on payloads stored before this shipped.
   */
  provisional?: number;
  confirmed?: number;
  /** Spend over confirmed bookings, the main cost per booking. */
  cpbConfirmed?: number | null;
};

/** A client's funnel rates over a window, the three booking metrics and the Mahara OS outcomes. */
export type DeliveryRates = {
  leads: number;
  /** Total bookings due (provisional + confirmed). */
  bookings: number;
  provisional: number;
  confirmed: number;
  showed: number;
  noshow: number;
  /** Deals marked won by the client in Mahara OS outcomes. */
  closes: number;
  /** Past appointments with no outcome recorded in Mahara OS. */
  noOutcome: number;
  /** Lead to any booking: bookings / platform leads. */
  bookRate: number | null;
  /** Lead to confirmed booking, the main one. */
  bookRateConfirmed: number | null;
  bookRateProvisional: number | null;
  /** showed / (showed + noshow) on meetings whose day has passed. */
  showRate: number | null;
  /** Mahara OS won / shown. */
  closeRate: number | null;
};

/** One appointment whose time has passed with no outcome in Mahara OS. No contact identity, by design. */
export type NoOutcomeAppointment = {
  /** Kuwait day and time, "YYYY-MM-DD HH:MM". */
  at: string;
  calendar: string;
  /** How the CRM has it: confirmed, showed, noshow, new, ... */
  status: string | null;
};

export type DeliveryPayload = {
  yesterday: DeliveryWindow;
  last7: DeliveryWindow;
  prevLast7: DeliveryWindow;
  mtd: DeliveryWindow;
  /** Last 30 days, oldest first. */
  daily: { date: string; spend: number; leads: number; bookings: number }[];
  gates: { cpl: number; cpb: number };
  campaigns: {
    running: number;
    boardOffButRunning: number;
    spendingNotOnBoard: number;
    /** Count of running campaigns per verdict (scale, hold, kill, ...). */
    verdicts: Record<string, number>;
  };
  /** One row per client with spend in the last 7 days. */
  clients: {
    client: string;
    clickupTaskId: string | null;
    spend7d: number;
    leads7d: number;
    cpl7d: number | null;
    bookings7d: number;
    cpb7d: number | null;
    /** Campaigns running now: with spend in the last three days. */
    campaigns: number;
    /**
     * Aziz's rule (2026-09-21): good = cost per lead at most $15, cost per
     * confirmed booking at most $60 and show rate at least 60%; bad = cost
     * per booking over $80, or cost per lead over $22.50, or show rate under
     * 40%; watch otherwise. no-data when nothing was spent.
     */
    status: "good" | "watch" | "bad" | "no-data";
    /** Provisional and confirmed bookings in the last 7 days; `bookings7d` is their sum. Absent on older payloads. */
    provisional7d?: number;
    confirmed7d?: number;
    /** Spend over confirmed bookings, the main cost per booking. */
    cpbConfirmed7d?: number | null;
    /**
     * What a booking that shows would cost at a 60% show rate: cost per
     * confirmed booking over 0.6. Null without confirmed bookings.
     */
    costPerShownAt60?: number | null;
    /**
     * The funnel rates over the last 30 days: the three booking rates, the
     * show rate and the Mahara OS close rate (won outcomes over shown).
     * Fractions; null when the denominator is zero. Null as a whole when
     * Creative Triage could not be read.
     */
    rates30: DeliveryRates | null;
    /** Past appointments with no outcome in Mahara OS, newest first, at most 20. Absent on older payloads. */
    noOutcome?: NoOutcomeAppointment[];
  }[];
  /**
   * Company-wide, last 30 days: how much of the past appointment book has an
   * outcome in Mahara OS, so the close rate can be read with its coverage.
   * Absent on older payloads.
   */
  outcomes?: {
    pastAppointments: number;
    withOutcome: number;
    won: number;
    /** Mahara OS outcome rows only start on 2026-09-18. */
    since: string | null;
  };
  /** Whether the provisional calendar has produced any appointment row in Creative Triage yet. */
  provisionalSynced?: boolean;
  launches: {
    inFlight: number;
    stuck: { client: string; days: number; blocker: string | null }[];
  };
  accountIssues: { client: string; issue: string }[];
  notes: Note[];
};

// --- Clients: roster, health and risk (Convex clients + Creative Triage Pulse + portal) ---

export type ClientRow = {
  name: string;
  clickupTaskId: string;
  stage: string | null;
  /** active | onboarding | paused | churned */
  bucket: string | null;
  csm: string | null;
  service: string | null;
  happiness: string | null;
  silentDays: number | null;
  lastContactAt: number | null;
  paymentDue: string | null;
  leads7d: number | null;
  cpl7d: number | null;
  bookings7d: number | null;
  pulse: { score: number | null; status: string | null } | null;
  portalLastSeenAt: number | null;
  risk: { score: number; level: "high" | "medium" | "low"; reasons: string[] };
  /** Latest digested ClickUp comment summary for this client, if any. */
  latestUpdate: string | null;
  /**
   * The card's Launch Date, or null when the card has none (the client has
   * not launched, and can never be logo churn or reach a term end).
   * Absent on payloads stored before the churn rule shipped.
   */
  launchDate?: string | null;
  /** launchDate + 90 days, or null. Absent on older payloads. */
  termEnd?: string | null;
  /**
   * Where the client stands under the term rule: "in-term" (term end not yet
   * reached), "renewed" (a payment dated after term end exists),
   * "no-renewal" (term ended, no such payment, counted as churned) or
   * "not-launched". Absent on older payloads.
   */
  termState?: "in-term" | "renewed" | "no-renewal" | "not-launched";
  /** The card's LTV field in USD, or null when blank. Absent on older payloads. */
  ltvUsd?: number | null;
  /** The card's MRR field in USD, or null when blank. */
  mrrUsd?: number | null;
  /** The card's Payment Plan, or null. */
  paymentPlan?: string | null;
  /** Kuwait day the ClickUp card was created, or null. */
  createdDay?: string | null;
  /** Days from the card's creation to its Launch Date; null without a launch date. First launch only. */
  daysToLaunch?: number | null;
  /** Extension weeks granted to this client in the window (Client Extension Form). */
  extensionWeeks?: number;
  /** The latest extension's end day, when one is still running. */
  extendedUntil?: string | null;
};

/** The payment that counts as a renewal under the 2026-09-16 rule. */
export type RenewalEvidence = {
  rail: "whop" | "tap" | "manual";
  /** Kuwait day of the payment, always after the term end. */
  day: string;
  amountUsd: number;
  /**
   * How the payment was tied to this client, in plain words, e.g. "Whop
   * payer email on the card", "ClickUp client picked on the hand entry".
   * A payment that cannot be tied to a client is never evidence.
   */
  matchedBy: string;
};

/** A client named in a churn list. */
export type ChurnClient = {
  name: string;
  clickupTaskId: string;
  /** The card's stage today. */
  stage: string | null;
  /** The bucket the card is in today (the ClientRow rule), e.g. "active" for a term ended client whose card still says Active. */
  cardBucket: string | null;
  launchDate: string | null;
  /**
   * Kuwait day the loss is dated: the term end for a term ended with no
   * renewal payment, otherwise the first day the cockpit's own daily history
   * saw the client in the churned bucket. Clients whose loss cannot be dated
   * are not in the month lists; the adapter counts them in a note.
   */
  day: string;
  /** "term-ended-no-renewal" or "stopped". A client is listed once, under the earlier of the two that apply. */
  reason: "term-ended-no-renewal" | "stopped";
};

/** A launched client seen through the 90 day term rule. */
export type TermClient = {
  name: string;
  clickupTaskId: string;
  stage: string | null;
  cardBucket: string | null;
  launchDate: string;
  /** launchDate + 90 days. */
  termEnd: string;
  /** termEnd minus today in days: positive before the end, 0 on the day, negative after. */
  daysToTermEnd: number;
  /** The first payment on any rail dated after termEnd, or null. */
  renewal: RenewalEvidence | null;
};

/**
 * Churn and the 90 day term, under the decisions of 2026-09-16:
 *
 * - Decision 1, logo churn on launched clients only. A client with a Launch
 *   Date that stops is churn. A client with no Launch Date that stops is
 *   "lost before launch", a sales and onboarding number, never churn.
 * - Decision 4, churn unless renewed, with the renewal rule. A launched
 *   client is past term end when today is after launchDate + 90 days. Past
 *   term end it counts as churned, dated on the term end, UNLESS a payment on
 *   any rail (Whop, Tap or hand-logged) is dated after the term end; that
 *   payment is the renewal. This applies even when the card still says
 *   Active, which `cardBucket` shows.
 *
 * Every list is named. The known weaknesses are carried in `notes` and must
 * stay on screen next to these numbers: a client who renews but pays late
 * looks churned until the payment lands; a client paying instalments on the
 * original contract can look renewed when it is not; a payment made before
 * the term end never counts as a renewal; a Tap charge counts only when it
 * can be tied to the client (the cockpit's Tap read carries no client, so in
 * practice only a hand entry naming the client does).
 */
export type ChurnPayload = {
  /** The Kuwait month the month lists cover, YYYY-MM. */
  month: string;
  /** Launched clients lost this month (logo churn), including term ended with no renewal payment dated this month. */
  churnedThisMonth: ChurnClient[];
  /** Clients with no Launch Date lost this month. Never part of churn or the churn rate. */
  lostBeforeLaunchThisMonth: ChurnClient[];
  /** Launched clients whose term ends from today to today + 15 days, soonest first. */
  renewalDueSoon: TermClient[];
  /** Past term end with a renewal payment, newest term end first. */
  termEndedRenewed: TermClient[];
  /** Past term end with no payment after it, counted as churned, newest term end first. */
  termEndedNoRenewal: TermClient[];
  /**
   * Launched clients not yet lost at the start of the month, the churn
   * rate's denominator, or null when a loss date it needs is unknown.
   */
  launchedAtMonthStart: number | null;
  /** churnedThisMonth.length / launchedAtMonthStart, 0..1, or null. */
  rate: number | null;
  /** Why `rate` is null, one sentence, or null. */
  rateWhy: string | null;
  /**
   * False while the cockpit's own daily history does not cover the whole
   * month, so a stop earlier in the month may be missing. The screen says
   * "partial" whenever this is false.
   */
  complete: boolean;
  /** The weaknesses above and any read that failed, for the churn card. */
  notes: Note[];
};

export type ClientsPayload = {
  counts: {
    active: number;
    onboarding: number;
    paused: number;
    churned: number;
    total: number;
  };
  /** Highest risk first, at most 8, active and onboarding clients only. */
  atRisk: ClientRow[];
  rows: ClientRow[];
  /**
   * Churn and term end under the 2026-09-16 decisions. Optional only because
   * payloads stored before the clients adapter filled it have none.
   */
  churn?: ChurnPayload;
  /**
   * Extensions granted through the Client Extension Form (Typeform
   * gqBcyK6g), read straight from Typeform (Aziz, 2026-09-21). The clock
   * starts at submission. Absent on older payloads.
   */
  extensions?: {
    /** The window the per-client weeks cover, Kuwait days. */
    from: string;
    to: string;
    /** Weeks granted in the window, all clients. */
    totalWeeks: number;
    /** Responses in the window. */
    grants: number;
    perClient: {
      client: string;
      clickupTaskId: string | null;
      weeks: number;
      /** The latest grant's end day. */
      until: string;
      /** True when that grant is still running today. */
      live: boolean;
    }[];
    /** True when the form was read this run. */
    read: boolean;
    /** Whether the current extension was written to the ClickUp card, and why not when not. */
    clickupField: { written: number; note: string };
    /** The month before, for the tile's sub-line. */
    lastMonth?: {
      from: string;
      to: string;
      totalWeeks: number;
      grants: number;
    };
  };
  /**
   * Time to first launch: from the ClickUp card's creation to its Launch
   * Date, over launched clients. First launch only. Absent on older payloads.
   */
  launch?: {
    averageDays: number | null;
    medianDays: number | null;
    clients: number;
    /** Launched clients, slowest first. */
    rows: {
      client: string;
      clickupTaskId: string;
      days: number;
      launchDate: string;
    }[];
    /** Live clients with no launch date, so no time to launch yet. */
    notLaunched: number;
  };
  /** Mean MRR over active cards on a recurring plan, and how many cards that is. Absent on older payloads. */
  retainer?: { averageUsd: number | null; cards: number };
  notes: Note[];
};

// --- Team: EODs, activity and a live feed ---

/** Set by hand on the Management tab (ceoTeamStatus). The same union as the table. */
export type TeamStatus = "active" | "paused" | "left";

export type TeamPerson = {
  /**
   * "<role>:<first>": the raw role key plus the lower case letters of the
   * first name, e.g. "media_buyer:nada". The key ceoTeamStatus rows use and
   * the one the teamStatus mutations take.
   */
  key: string;
  name: string;
  role: string;
  /** "not due" on a day the person was paused or had left. */
  eodYesterday: "on time" | "late" | "missed" | "not due";
  /** Only working days before `statusSince` count as due for a paused or left person. */
  eod14: { due: number; filed: number; late: number; missed: number };
  lastActiveAt: number | null;
  actionsToday: number;
  energy: number | null;
  /**
   * The status Aziz set by hand, "active" when no row exists. The fields
   * below are optional only because payloads stored before the team adapter
   * read ceoTeamStatus have none: read a missing status as "active".
   */
  status?: TeamStatus;
  /** Kuwait day the status took effect, or null when never set. */
  statusSince?: string | null;
  /** Aziz's note on the status, one line, or null. */
  statusNote?: string | null;
  /** When the status was last set, epoch ms, or null when never set. */
  statusSetAt?: number | null;
};

export type FeedItem = {
  at: number;
  actor: string | null;
  role: string | null;
  kind: string;
  subject: string;
  text: string;
};

export type TeamPayload = {
  /**
   * People active today: no status row, status "active", or a pause or leave
   * dated ahead (they owe EODs until it starts, and carry that status and
   * date). Everything that judges EOD discipline (the Today card, missed EOD
   * counts) reads this list, so a paused or departed person is never counted
   * as missing an EOD. The screens also lay teamStatus.list over it, so a
   * change shows before the section is recomputed.
   */
  people: TeamPerson[];
  /**
   * Paused and left people, shown apart on the Management tab, paused first,
   * then by `statusSince` newest first. A status row is listed even when the
   * person has not filed in 30 days (named from the key). A left person drops
   * off this list 30 days after `statusSince` unless they filed an EOD after
   * leaving (a warn note names them); the row stays in the table.
   * Nobody here owes an EOD from `statusSince` on. Optional only because
   * payloads stored before the team adapter read ceoTeamStatus have none.
   */
  inactive?: TeamPerson[];
  /** Newest first, at most 60. */
  feed: FeedItem[];
  notes: Note[];
};

// --- Mahara OS client portal ---

export type PortalPayload = {
  clientsInDirectory: number;
  withAccess: number;
  liveSessions: number;
  /** Clients seen in the last 7 days, newest first. */
  seen7d: { client: string; lastSeenAt: number }[];
  outcomesSubmitted: number;
  appointmentRows: number;
  crm: { connected: number; total: number };
  health: { status: string | null; issues: number };
  backupVerifiedAt: number | null;
  notes: Note[];
};

// --- Machine and data trust ---

export type MachinePayload = {
  syncAgeMin: number | null;
  jobs: {
    job: string;
    ok: boolean;
    at: number;
    everyMin: number;
    streak: number;
    error?: string;
  }[];
  failingJobs: number;
  staleJobs: number;
  sources: {
    source: string;
    ok: boolean;
    lastOkAt?: number;
    lastError?: string;
  }[];
  failingSources: number;
  hermes: { queued: number; failed: number; lastDoneAt?: number };
  /** Outside feeds: B2B sync_state rows and Creative Triage scheduled jobs. */
  feeds: {
    name: string;
    project: "b2b" | "triage";
    lastSuccessAt: number | null;
    lagMin: number | null;
    ok: boolean;
    error?: string;
  }[];
  notes: Note[];
};

// --- Sales assets (B2B Supabase: assets, asset_sends, b2b_asset_* functions) ---

/**
 * The sales asset library. Two readings that pull apart, kept apart:
 * coverage is what a rep has to reach for, performance is whether anybody
 * reached for it. On 2026-09-19 the library held 203 assets and four sends.
 */
export type AssetsPayload = {
  total: number;
  /** Assets whose status is live, the ones a rep would actually send. */
  live: number;
  arabic: number;
  /** Assets whose link last checked as broken: sending one sends a dead page. */
  broken: number;
  byType: { type: string; count: number }[];
  /** Objection and stage pairs with no asset at all. */
  gaps: { objection: string; stage: string }[];
  /** How many objection-by-stage combinations exist in total. */
  combinations: number;
  /** Sends ever recorded. Small numbers here make every rate below unreadable. */
  sends: number;
  performance: {
    slug: string;
    title: string;
    assetType: string;
    sends: number;
    contacts: number;
    closesAfter: number;
    revenue: number;
    lastSentAt: number | null;
  }[];
  /**
   * The Live Training webinar pipeline. Present so the capability is visible;
   * `everUsed` false means no event has ever run and no rate is computed,
   * because zero events and a failed webinar would print identical zeros.
   */
  liveTraining?: {
    events: number;
    registrants: number;
    attendance: number;
    outcomes: number;
    everUsed: boolean;
  };
  notes: Note[];
};

// --- Our own ads (B2B Supabase: meta_ad_snapshots + leads, calls, closed_deals by ad id) ---

/** One window of the funnel for an ad, an ad set, a campaign or the account. */
export type B2bAdWindow = {
  spend: number;
  impressions: number;
  /** Every click Meta counts, and the link clicks alone. */
  clicks: number;
  linkClicks: number;
  /** What Meta says the ad produced. */
  /** What Meta counts for the ad; `leads` is what the CRM holds with a ROAS tag. */
  metaLeads: number;
  /** What actually arrived in the CRM attributed to the ad. */
  leads: number;
  /** Leads whose stage reached Demo Booked, Confirmed, Closed or Hot Lead; and the ones marked disqualified. */
  /** `roas-qualified` leads. */
  qualifiedLeads: number;
  /** `roas-unprepared` contacts, shown but not in `leads`. */
  notReadyLeads: number;
  introsBooked: number;
  /** Intros whose time has passed, the denominator of a show rate. */
  introsDue: number;
  introsShown: number;
  /** Shown and a fit (showed, or confirmed and past), the B2B cockpit's "qualified". */
  introsQualified: number;
  introsCancelled: number;
  /** Intros shown that went on to a demo booked for the same contact. */
  introsAdvanced: number;
  demosBooked: number;
  demosDue: number;
  demosShown: number;
  demosQualified: number;
  demosCancelled: number;
  closes: number;
  contracted: number;
  cash: number;
  /** Highest of the children on a parent, never a sum. */
  frequency: number | null;
  // Derived; null when the denominator is zero. Rates are fractions.
  cpm: number | null;
  ctr: number | null;
  ctrLink: number | null;
  cpc: number | null;
  /** spend / CRM leads. */
  cpl: number | null;
  qualifiedPct: number | null;
  costPerQualified: number | null;
  /** intros booked / leads. */
  bookRate: number | null;
  costPerIntroBooked: number | null;
  /** intros shown / intros due. */
  introShowRate: number | null;
  costPerIntroShown: number | null;
  /** intros advanced / intros shown. */
  introToDemo: number | null;
  /** demos shown / demos due. */
  demoShowRate: number | null;
  costPerDemoBooked: number | null;
  /** spend / demos shown. Shown, never judged: no gate has been set. */
  costPerDemo: number | null;
  /** closes / demos shown, and closes / demos qualified. */
  closeRate: number | null;
  closeRateQualified: number | null;
  /** spend / closes. */
  cac: number | null;
  /** contracted / spend, and cash / spend. */
  roas: number | null;
  cashRoas: number | null;
  /** demos booked / leads. */
  leadToDemo: number | null;
};

/** Who worked the ad's leads in the last thirty days: the setter with the most intro calls and the closer with the most signed deals. */
export type B2bPeople = {
  setter: { name: string; shown: number; due: number } | null;
  closer: { name: string; closes: number } | null;
};

export type B2bVerdict = {
  verdict:
    | "off"
    | "no delivery"
    | "kill"
    | "hold"
    | "scale"
    | "fatiguing"
    | "leads do not book"
    | "intros do not convert"
    | "demos do not close";
  reason: string;
  /** Whose problem it is. Null when the ad is off and there is nothing to judge. */
  owner: "ads" | "setter" | "closer" | null;
};

export type B2bAdNode = {
  id: string;
  name: string;
  /** Meta's effective_status, e.g. ACTIVE, PAUSED, ADSET_PAUSED, CAMPAIGN_PAUSED, WITH_ISSUES. */
  status: string;
  running: boolean;
  /** Facebook CDN url with an expiring token. */
  thumbnail: string | null;
  w7: B2bAdWindow;
  w30: B2bAdWindow;
  verdict: B2bVerdict;
  people: B2bPeople;
};

export type B2bAdsPayload = {
  accountId: string;
  windows: { from7: string; from30: string; to: string };
  /** Lead-gen campaigns only, the way the B2B dashboard reads the account; retargeting and hiring sit beside it. */
  account: { w7: B2bAdWindow; w30: B2bAdWindow };
  retargetingSpend: { w7: number; w30: number };
  /**
   * How much of the CRM carries an ad id in the window: every lead and
   * signed deal against the ones this screen can attribute. The rest are
   * organic, WhatsApp or typed in by hand and are not on this screen.
   */
  coverage: {
    w7: {
      leads: number;
      adLeads: number;
      closes: number;
      adCloses: number;
      contracted: number;
      adContracted: number;
    };
    w30: {
      leads: number;
      adLeads: number;
      closes: number;
      adCloses: number;
      contracted: number;
      adContracted: number;
    };
  };
  running: number;
  total: number;
  /** Running ads by verdict. */
  verdicts: Record<string, number>;
  campaigns: {
    id: string;
    name: string;
    /** lead_gen, retargeting, excluded, unknown: from b2b_campaign_type. */
    type: string;
    status: string;
    running: boolean;
    w7: B2bAdWindow;
    w30: B2bAdWindow;
    people: B2bPeople;
    /**
     * The weakest stage of this campaign's funnel against the account, when
     * it is at least a fifth worse and there is enough volume to judge. Null
     * when nothing stands out.
     */
    constraint: {
      stage: string;
      owner: "ads" | "landing" | "setter" | "closer";
      mine: number;
      account: number;
    } | null;
    adsets: {
      id: string;
      name: string;
      running: boolean;
      w7: B2bAdWindow;
      w30: B2bAdWindow;
      people: B2bPeople;
      ads: B2bAdNode[];
    }[];
  }[];
  /** The newest day Meta has a snapshot for. */
  lastSnapshotDay: string | null;
  /** Meta's own word on the account: null when Meta could not be read. */
  accountStatus: {
    code: number;
    label: string;
    disableReason: string | null;
    /** Outstanding balance in account currency, when Meta reports one. */
    balance: number | null;
    currency: string | null;
  } | null;
  notes: Note[];
};

// --- Organic (Graph API for the Facebook Page and Instagram; YouTube Data API; B2B asset library for cadence) ---

export type OrganicPayload = {
  facebook: {
    pageId: string;
    name: string;
    url: string | null;
    followers: number;
    /** 28-day page views. Null when Meta returns nothing for the page; impressions metrics no longer exist on this API version. */
    views28: number | null;
    engagements28: number | null;
    newFollowers28: number | null;
  } | null;
  instagram: {
    id: string;
    username: string;
    followers: number;
    mediaCount: number;
    reach28: number | null;
    engaged28: number | null;
    /** Posts in the last 28 days, from the live media list. */
    published28: number;
    /** The median views of the posts read; what "normal" means for a multiple. */
    normalViews: number | null;
    posts: {
      id: string;
      type: string;
      at: string;
      likes: number;
      comments: number;
      url: string;
      thumbnail: string | null;
      caption: string | null;
      /** Per-post insights; null when Meta did not return them. */
      views: number | null;
      reach: number | null;
      saved: number | null;
      shares: number | null;
      interactions: number | null;
      /** views / normalViews. */
      multiple: number | null;
    }[];
  } | null;
  youtube: {
    /** False until the YouTube Data API is enabled on the Cloud project. */
    enabled: boolean;
    enableUrl: string;
    channelId: string | null;
    subscribers: number | null;
    views: number | null;
    videos: number | null;
    /** Uploads in the last 28 days, from the live upload list (a floor once it hits the page size). */
    published28: number | null;
    /** Median views per day since publish across the recent uploads. */
    normalViewsPerDay: number | null;
    recent: {
      id: string;
      title: string;
      at: string;
      views: number;
      likes: number;
      comments: number;
      thumbnail: string | null;
      viewsPerDay: number | null;
      /** viewsPerDay / normalViewsPerDay. */
      multiple: number | null;
    }[];
  };
  /** What is performing best right now: up to six Instagram posts then up to six YouTube videos, each platform's biggest multiple of its own normal first. */
  best: {
    platform: "instagram" | "youtube";
    id: string;
    url: string;
    thumbnail: string | null;
    title: string;
    at: string;
    /** The number the ranking is on, and what it is. */
    value: number;
    metric: string;
    multiple: number;
  }[];
  /** How often each platform is being published to, from the asset library. */
  cadence: {
    platform: string;
    last28: number;
    last90: number;
    newest: string | null;
  }[];
  notes: Note[];
};
