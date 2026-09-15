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

// --- Money (B2B Supabase: whop_payments, closed_deals, monthly_targets, expenses) ---

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
  /** Last 12 months including the current one, oldest first. */
  monthly: {
    month: string;
    cash: number;
    refunds: number;
    contracted: number;
    deals: number;
  }[];
  refunds: { mtd: number; last90: number };
  deals: {
    mtd: number;
    lastMonth: number;
    contractedMtd: number;
    contractedLastMonth: number;
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
  demoShowRate: number | null;
  /** Show rate on calls with a marked outcome only (stricter than the dashboard). */
  demoShowRateMarked: number | null;
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
  notes: Note[];
};

// --- Team: EODs, activity and a live feed ---

export type TeamPerson = {
  key: string;
  name: string;
  role: string;
  eodYesterday: "on time" | "late" | "missed" | "not due";
  eod14: { due: number; filed: number; late: number; missed: number };
  lastActiveAt: number | null;
  actionsToday: number;
  energy: number | null;
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
  people: TeamPerson[];
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
