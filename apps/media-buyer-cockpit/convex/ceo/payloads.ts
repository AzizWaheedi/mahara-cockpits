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
     * Whop plus Tap plus manual, over the connected rails only. Possible
     * duplicates (below) are still inside it until Aziz deletes the entry.
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
  refunds: { mtd: number; last90: number };
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
  notes: Note[];
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
  leads: number;
  cpl: number | null;
  introsBooked: number;
  demosBooked: number;
  demosShown: number;
  /** The dashboard's `demo_show_rate`: demos shown over demos due, 0..1 to three places. */
  demoShowRate: number | null;
  /** The dashboard's `intro_show_rate`, the same rule for intro calls. */
  introShowRate: number | null;
  /** The dashboard's `intro_to_demo`: intros that went on to book a demo, over intros shown. */
  introToDemo: number | null;
  /** Past demos in the window still marked confirmed. They count as shown under the dashboard's rule. */
  demosStillConfirmed: number;
  /** The dashboard's `cost_per_demo`: lead-gen spend over demos shown. */
  costPerDemo: number | null;
  /** The dashboard's `cost_per_demo_booked`: lead-gen spend over demos booked. */
  costPerDemoBooked: number | null;
  closes: number;
  closeRate: number | null;
  contracted: number;
  cash: number;
  cac: number | null;
  roas: number | null;
  /** Every numeric key the B2B window function returned, as is. */
  raw: Record<string, number | null>;
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
  /** Last 60 days, oldest first. */
  daily: {
    date: string;
    spend: number;
    leads: number;
    booked: number;
    closes: number;
  }[];
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
  /** Month to date. */
  leadSources: { source: string; leads: number }[];
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
  };
  lastCallAt: number | null;
  notes: Note[];
};

// --- Client delivery (Convex media buyer tables) ---

export type DeliveryWindow = {
  spend: number;
  leads: number;
  cpl: number | null;
  bookings: number;
  cpb: number | null;
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
    campaigns: number;
    status: "good" | "watch" | "bad" | "no-data";
  }[];
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
