/**
 * The Client Performance board's reads and writes (Aziz, 2026-10-16: one
 * shared board for every team member, one row per client, a time frame to
 * change, targets easy to edit, a lever per client from the board).
 *
 * Every number is the database's (supabase/migrations/20261016133300_board_api.sql):
 *   cockpit_board_read(from, to)            every client row, the targets, the stamps
 *   cockpit_board_client(location, from, to)  one client: its row, the campaign >
 *                                             ad set > ad tree, the appointments
 *                                             with no outcome, its levers, and its
 *                                             budgets (20261017100100_board_budgets.sql)
 *   cockpit_board_targets_save(...)          the CEO and admins
 *   cockpit-board-api {operation: "lever"}   a lever filed as a ClickUp task
 * Each cell arrives as {v, status, note, num, den, ...}: this file only reads
 * it. The screen never turns a missing value into 0, never judges a value
 * again, and adds up across clients only what the cells already carry.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { z } from "zod";
import { supabase } from "./supabase";

// ---------------------------------------------------------------------------
// The shapes, read leniently: a key the screen does not know is kept, a key
// it needs and does not find is a plain error, never a guess.

const num = z.number().nullable().optional();
const text = z.string().nullable().optional();

/** Budget used: yesterday on each ad account's own clock (several days when the clocks differ). */
const YesterdaySchema = z
  .object({
    day: z.string(),
    spend: num,
    budget: num,
    days: z.array(z.string()).nullable().optional(),
    partial: z.boolean().nullable().optional(),
  })
  .passthrough();

/**
 * Budget/day: an ad account that needs action. issue: billing (a payment:
 * Meta status 3, 8, 9), account (it cannot run: disabled, closing, closed,
 * under risk review), limit_reached, limit_near, balance_out, balance_low (a
 * prepaid balance); words in Meta's capitals.
 */
const AccountIssueSchema = z
  .object({
    accountId: z.string(),
    name: text,
    issue: z.string(),
    words: z.string(),
  })
  .passthrough();

export const CELL_STATUSES = [
  "good",
  "watch",
  "off",
  "too_few",
  "not_measured",
  "not_filled_in",
] as const;
export type CellStatus = (typeof CELL_STATUSES)[number];

export const CellSchema = z
  .object({
    v: num,
    status: text,
    note: text,
    num,
    den: num,
    sample: num,
    target: text,
    atLeast: z.union([z.boolean(), z.number()]).nullable().optional(),
    partial: z.boolean().nullable().optional(),
    pairedDays: num,
    basis: text,
    notVideo: z.boolean().nullable().optional(),
    clientCalls: z.boolean().nullable().optional(),
    oldestDays: num,
    oldestAt: text,
    share: num,
    sharePartial: z.boolean().nullable().optional(),
    shareNote: text,
    withValue: num,
    /** Closes: meetings marked pending or lost (20261016220000). */
    pending: num,
    lost: num,
    /** CRM leads: Instagram or Messenger chats with no ad among them. */
    dms: num,
    /** Leads contacted: callable leads with a saved outcome but no Maqsam call, and the share counting them. */
    outcomeOnly: num,
    touchedShare: num,
    due: num,
    marked: num,
    noShows: num,
    /**
     * Budget/day (2026-10-17): campaigns switched on now with a daily budget
     * (blocked ones too), those on a lifetime budget left out, when the
     * budgets were read, those of them not delivering and their budgets, those
     * waiting for their start (not counted), and the ad accounts that need
     * action.
     */
    campaigns: num,
    lifetime: num,
    asOf: text,
    notDelivering: num,
    heldBudget: num,
    starting: num,
    accountIssues: z.array(AccountIssueSchema).nullable().optional(),
    /**
     * Budget used: the days with a budget, yesterday, the campaigns switched
     * on with a daily budget that spent nothing yesterday, and above 110% (a
     * note, never a status).
     */
    budgetDays: num,
    yesterday: YesterdaySchema.nullable().optional(),
    notSpending: num,
    over: z.boolean().nullable().optional(),
    /** A campaign's spend yesterday: the first day of its run of days with a budget and nothing spent. */
    zeroSince: text,
  })
  .passthrough();
export type Cell = z.output<typeof CellSchema>;
export type Yesterday = z.output<typeof YesterdaySchema>;
export type AccountIssue = z.output<typeof AccountIssueSchema>;

const Line = z
  .object({ good: num, watch: num, by: text, at: text, note: text })
  .passthrough();

export const TargetSchema = z
  .object({
    key: z.string(),
    label: z.string(),
    unit: z.string(),
    direction: z.enum(["higher", "lower"]),
    good: z.number().nullable(),
    watch: num,
    source: z.string(),
    official: z.object({ good: num, watch: num }).passthrough(),
    board: Line.nullable().optional(),
    client: Line.nullable().optional(),
    strict: z.boolean().nullable().optional(),
    neverOff: z.boolean().nullable().optional(),
    minSample: num,
    sample: text,
    owner: text,
    basis: text,
  })
  .passthrough();
export type Target = z.output<typeof TargetSchema>;
export type Targets = Record<string, Target>;

const SourceSchema = z
  .object({ ok: z.boolean().nullable().optional(), state: text, as_of: text })
  .passthrough();

export const ClientRowSchema = z
  .object({
    locationId: z.string(),
    clickupId: text,
    clientName: z.string(),
    status: text,
    serviceMode: text,
    clientCalls: z.boolean().nullable().optional(),
    tiktok: z.boolean().nullable().optional(),
    adAccounts: z.array(z.string()).nullable().optional(),
    adCover: z
      .object({ state: text, note: text, partial: z.boolean().optional() })
      .passthrough()
      .nullable()
      .optional(),
    callers: z
      .array(z.object({ email: z.string(), name: z.string() }).passthrough())
      .nullable()
      .optional(),
    noOutcome: num,
    noOutcomeOldestDays: num,
    values: z.record(z.string(), CellSchema),
    overrides: z.record(z.string(), z.unknown()).nullable().optional(),
    levers: z
      .object({ open: num, reconcile: num, lastAt: text })
      .passthrough()
      .nullable()
      .optional(),
    computedAt: text,
    adsFetchedAt: text,
    sources: z.record(z.string(), SourceSchema).nullable().optional(),
    notes: z.array(z.string()).nullable().optional(),
  })
  .passthrough();
export type ClientRow = z.output<typeof ClientRowSchema>;

const JobSchema = z
  .object({ state: text, startedAt: text, finishedAt: text, lastOkAt: text })
  .passthrough()
  .nullable()
  .optional();

export const BoardSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    today: z.string(),
    days: z.number(),
    adWindow: z.object({ from: z.string(), to: z.string(), note: text }),
    generatedAt: text,
    targets: z.record(z.string(), TargetSchema),
    canEditTargets: z.boolean(),
    clients: z.array(ClientRowSchema),
    notLinked: z
      .array(
        z
          .object({ accountId: z.string(), name: text, currency: text })
          .passthrough(),
      )
      .nullable()
      .optional(),
    /**
     * Spend in the time frame on ad accounts no client row carries: a
     * cancelled client's account still delivering, one tied to no client, one
     * kept out on purpose. Whole-board seats only; null for the rest.
     */
    offBoard: z
      .object({
        spend: z.number(),
        unpriced: z.boolean().nullable().optional(),
        accounts: z.array(
          z
            .object({
              accountId: z.string(),
              name: text,
              spend: num,
              client: text,
              /** A client not Active: its card's status (Paused, Stopped, Launching, Ghosting). */
              clientStatus: text,
              reason: text,
            })
            .passthrough(),
        ),
      })
      .passthrough()
      .nullable()
      .optional(),
    freshness: z
      .object({
        facts: z
          .object({
            lastRunAt: text,
            lastOkAt: text,
            ok: z.boolean().nullable().optional(),
            note: text,
          })
          .passthrough()
          .nullable()
          .optional(),
        meta: z
          .object({
            lastFetchedAt: text,
            firstDay: text,
            lastDay: text,
            hourly: JobSchema,
            nightly: JobSchema,
            note: text,
          })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    notes: z.array(z.string()).nullable().optional(),
  })
  .passthrough();
export type Board = z.output<typeof BoardSchema>;

const MetricsSchema = z.record(z.string(), CellSchema);
export type Metrics = z.output<typeof MetricsSchema>;

const AdSchema = z
  .object({ id: z.string(), name: text, metrics: MetricsSchema })
  .passthrough();
const AdSetSchema = z
  .object({
    id: z.string().nullable(),
    name: text,
    destination: text,
    metrics: MetricsSchema,
    ads: z.array(AdSchema),
  })
  .passthrough();
const CampaignSchema = z
  .object({
    id: z.string().nullable(),
    name: text,
    objective: text,
    accountId: text,
    metrics: MetricsSchema,
    adsets: z.array(AdSetSchema),
  })
  .passthrough();
export type TreeCampaign = z.output<typeof CampaignSchema>;

/** One campaign switched on now, or waiting for its start, or spent on an account never read, on the client's page. */
const BudgetCampaignSchema = z
  .object({
    id: z.string(),
    name: text,
    accountId: text,
    budgetLevel: text,
    budgetType: text,
    adsets: num,
    delivering: z.boolean().nullable().optional(),
    whyNot: text,
    /** Waiting for its start: when (not counted until then). */
    startsAt: text,
    lifetime: z
      .object({ budget: num, remaining: num, currency: text, endsOn: text })
      .passthrough()
      .nullable()
      .optional(),
    /** Why it needs a look, in words: off or watch; a start to come has no status. */
    flag: z
      .object({ status: z.string().nullable().optional(), words: text })
      .passthrough()
      .nullable()
      .optional(),
    metrics: MetricsSchema,
  })
  .passthrough();
export type BudgetCampaign = z.output<typeof BudgetCampaignSchema>;

/** The client's budgets (cockpit_board_budget_list). */
const BudgetsSchema = z
  .object({
    asOf: text,
    note: text,
    account: z.array(
      z
        .object({
          accountId: z.string(),
          name: text,
          currency: text,
          /** Meta's status in words; null when active. */
          status: text,
          /** A prepaid account: its "limit" is the funds added, what is left the balance. */
          prepaid: z.boolean().nullable().optional(),
          asOf: text,
          spendingLimit: z
            .object({
              cap: num,
              spent: num,
              left: num,
              daysLeft: num,
              prepaid: z.boolean().nullable().optional(),
            })
            .passthrough()
            .nullable()
            .optional(),
          /** What the page says about the account, in a sentence or two; null when nothing needs saying. */
          words: text,
        })
        .passthrough(),
    ),
    campaigns: z.array(BudgetCampaignSchema),
    paused: z
      .object({ campaigns: num, spend: num })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();
export type Budgets = z.output<typeof BudgetsSchema>;
export type TreeAdSet = z.output<typeof AdSetSchema>;
export type TreeAd = z.output<typeof AdSchema>;

export const NoOutcomeSchema = z
  .object({
    appointmentId: z.string(),
    meetingAt: text,
    meetingDay: text,
    meetingTime: text,
    calendar: text,
    calendarName: text,
    firstName: text,
    adId: text,
    adName: text,
    bookedBy: z
      .object({ name: z.string(), how: text })
      .passthrough()
      .nullable()
      .optional(),
    daysSince: num,
    contactUrl: text,
  })
  .passthrough();
export type NoOutcomeAppointment = z.output<typeof NoOutcomeSchema>;

export const LeverSchema = z
  .object({
    id: z.string(),
    metric: z.string(),
    lever: z.string(),
    department: z.string(),
    note: text,
    evidence: text,
    status: z.string(),
    clickupTaskId: text,
    clickupUrl: text,
    error: text,
    createdBy: text,
    createdByName: text,
    createdAt: text,
    finishedAt: text,
  })
  .passthrough();
export type Lever = z.output<typeof LeverSchema>;

export const ClientPageSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    today: z.string(),
    adWindow: z
      .object({ from: z.string(), to: z.string(), note: text })
      .passthrough(),
    adCover: z
      .object({ state: text, note: text })
      .passthrough()
      .nullable()
      .optional(),
    generatedAt: text,
    client: ClientRowSchema.nullable(),
    clientName: z.string(),
    locationId: z.string(),
    clickupId: text,
    status: text,
    targets: z.record(z.string(), TargetSchema),
    campaigns: z.array(CampaignSchema),
    notInStore: z
      .array(
        z
          .object({
            adId: z.string(),
            crmLeads: num,
            confirmedBookings: num,
            shows: CellSchema.nullable().optional(),
          })
          .passthrough(),
      )
      .nullable()
      .optional(),
    noAd: z
      .object({
        crmLeads: num,
        confirmedBookings: num,
        shows: CellSchema.nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
    noOutcomeAppointments: z.array(NoOutcomeSchema),
    noOutcomeCheck: z
      .object({ board: num, live: num, note: text })
      .passthrough()
      .nullable()
      .optional(),
    levers: z.array(LeverSchema),
    /** Its Meta budgets (2026-10-17); absent before the database has them. */
    budgets: BudgetsSchema.nullable().optional(),
    canEditTargets: z.boolean(),
  })
  .passthrough();
export type ClientPage = z.output<typeof ClientPageSchema>;

/** Parses a read; a shape the screen cannot use is said in one sentence. */
function parse<T>(schema: z.ZodType<T>, data: unknown, what: string): T {
  const parsed = schema.safeParse(data);
  if (parsed.success) return parsed.data;
  const first = parsed.error.issues[0];
  throw new BoardShapeError(
    `The ${what} came back in a shape this page cannot read (${first?.path.join(".") || "top"}). Tell the CEO.`,
  );
}

export class BoardShapeError extends Error {}

export function parseBoard(data: unknown): Board {
  return parse(BoardSchema, data, "board");
}
export function parseClientPage(data: unknown): ClientPage {
  return parse(ClientPageSchema, data, "client's page");
}

// ---------------------------------------------------------------------------
// The time frame, on Kuwait's calendar. The five windows are the Meta reach
// windows (cockpit_meta_reach_windows), so frequency over them is Meta's own.

export const FRAMES = [
  { key: "last_7", label: "Last 7" },
  { key: "last_14", label: "Last 14" },
  { key: "last_30", label: "Last 30" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "custom", label: "Custom" },
] as const;
export type FrameKey = (typeof FRAMES)[number]["key"];
export const DEFAULT_FRAME: FrameKey = "last_30";
export const MAX_FRAME_DAYS = 366;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Today in Kuwait, "YYYY-MM-DD" (UTC+3 all year). */
export function kuwaitToday(now: number = Date.now()): string {
  return new Date(now + 3 * 3600e3).toISOString().slice(0, 10);
}

export function shiftDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400e3)
    .toISOString()
    .slice(0, 10);
}

/** Days from a to b, both counted. */
export function spanDays(from: string, to: string): number {
  return (
    Math.round(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86400e3,
    ) + 1
  );
}

export type Frame = {
  key: FrameKey;
  from: string;
  to: string;
  /** Why a custom pick could not be used, in plain words; null when it could. */
  problem: string | null;
};

/** What a pick means in days. A custom pick that cannot be read falls back to the last 30 days and says why. */
export function frameOf(
  key: string | null | undefined,
  today: string = kuwaitToday(),
  custom?: { from?: string | null; to?: string | null },
): Frame {
  const month = today.slice(0, 7);
  switch (key) {
    case "last_7":
      return { key, from: shiftDay(today, -6), to: today, problem: null };
    case "last_14":
      return { key, from: shiftDay(today, -13), to: today, problem: null };
    case "this_month":
      return { key, from: `${month}-01`, to: today, problem: null };
    case "last_month": {
      const end = shiftDay(`${month}-01`, -1);
      return { key, from: `${end.slice(0, 7)}-01`, to: end, problem: null };
    }
    case "custom": {
      const a = custom?.from ?? "";
      const b = custom?.to ?? "";
      const fallback = (problem: string): Frame => ({
        ...frameOf("last_30", today),
        key: "custom",
        problem,
      });
      if (!DAY.test(a) || !DAY.test(b))
        return fallback("Choose a first and a last day.");
      if (a > b)
        return fallback("The first day must be on or before the last day.");
      if (b > today) return fallback("Choose days up to today.");
      if (spanDays(a, b) > MAX_FRAME_DAYS)
        return fallback(`Choose at most ${MAX_FRAME_DAYS} days.`);
      return { key: "custom", from: a, to: b, problem: null };
    }
    default:
      return {
        key: "last_30",
        from: shiftDay(today, -29),
        to: today,
        problem: null,
      };
  }
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** "14 Sep" for a "YYYY-MM-DD" day; "14 Sep 2025" outside the current year. */
export function dayLabel(
  day: string | null | undefined,
  today = kuwaitToday(),
): string {
  if (!day || !DAY.test(day)) return day ?? "";
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${String(y) !== today.slice(0, 4) ? ` ${y}` : ""}`;
}

/** "16 Sep to 15 Oct", or "15 Oct" for one day. */
export function rangeLabel(
  from: string,
  to: string,
  today = kuwaitToday(),
): string {
  return from === to
    ? dayLabel(from, today)
    : `${dayLabel(from, today)} to ${dayLabel(to, today)}`;
}

// ---------------------------------------------------------------------------
// Errors in plain words.

const FAILED =
  "The board did not load. Try again; if it keeps failing, tell the CEO.";

export function boardProblem(error: unknown): string {
  if (error instanceof BoardShapeError) return error.message;
  const e = (error ?? {}) as { message?: unknown; code?: unknown };
  const message = typeof e.message === "string" ? e.message.trim() : "";
  const code = typeof e.code === "string" ? e.code : "";
  if (code === "57014")
    return "The board took too long to answer. Try again; a shorter time frame reads faster.";
  if (code === "PGRST202" || code === "42883")
    return "The board's read is not on the database yet. Tell the CEO.";
  if (/jwt|token/i.test(message) && /expired|invalid/i.test(message))
    return "Your sign-in has expired. Reload the page.";
  if (/failed to fetch|network|load failed/i.test(message))
    return "The board could not be reached. Check the connection and try again.";
  // The database's own refusals are written as sentences for this page.
  if ((code === "42501" || code === "22023") && message) return message;
  if (/^[A-Z][^\n]{8,300}[.!]$/.test(message)) return message;
  return FAILED;
}

// ---------------------------------------------------------------------------
// The reads, cached for the session per time frame, so opening a client and
// coming back does not read the board again. A reload keeps the numbers on
// screen until the new ones arrive.

export type ReadState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: T; refreshing: boolean; readAt: number }
  | { status: "error"; message: string; data?: T };

const IDLE = { status: "idle" } as const;
const cache = new Map<string, ReadState<unknown>>();
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** For tests and the harness: forget every read. */
export function resetBoardCache(): void {
  cache.clear();
  emit();
}

function load<T>(id: string, run: () => Promise<T>, again: boolean): void {
  const current = cache.get(id) as ReadState<T> | undefined;
  if (current?.status === "loading") return;
  if (current?.status === "ready" && current.refreshing) return;
  if (current && !again && current.status !== "error") return;
  const keep =
    current?.status === "ready"
      ? current.data
      : current?.status === "error"
        ? current.data
        : undefined;
  const pending: ReadState<T> =
    keep !== undefined
      ? { status: "ready", data: keep, refreshing: true, readAt: Date.now() }
      : { status: "loading" };
  cache.set(id, pending);
  emit();
  void (async () => {
    let next: ReadState<T>;
    try {
      next = {
        status: "ready",
        data: await run(),
        refreshing: false,
        readAt: Date.now(),
      };
    } catch (e) {
      next = { status: "error", message: boardProblem(e), data: keep };
    }
    // Forgotten or started again meanwhile (a target saved): this answer is out of date.
    if (cache.get(id) !== pending) return;
    cache.set(id, next as ReadState<unknown>);
    emit();
  })();
}

async function rpc(
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

const boardId = (from: string, to: string) => `board|${from}|${to}`;
const clientId = (loc: string, from: string, to: string) =>
  `client|${loc}|${from}|${to}`;

export function loadBoard(from: string, to: string, again = false): void {
  load(
    boardId(from, to),
    async () =>
      parseBoard(await rpc("cockpit_board_read", { p_from: from, p_to: to })),
    again,
  );
}

export function loadClientPage(
  loc: string,
  from: string,
  to: string,
  again = false,
): void {
  load(
    clientId(loc, from, to),
    async () =>
      parseClientPage(
        await rpc("cockpit_board_client", {
          p_location: loc,
          p_from: from,
          p_to: to,
        }),
      ),
    again,
  );
}

/** Every read of this time frame again: after a lever changed. */
export function reloadBoard(
  from: string,
  to: string,
  loc?: string | null,
): void {
  loadBoard(from, to, true);
  if (loc) loadClientPage(loc, from, to, true);
}

/**
 * After a target changed: every read of the session is out of date, every
 * time frame's board and every client's page, since each carries the lines
 * and the dots. The board in view (and the client open, if any) keep their
 * numbers on screen while they are read again; every other read starts
 * afresh when it is next shown.
 */
export function reloadEveryRead(
  from: string,
  to: string,
  loc?: string | null,
): void {
  const keep = (id: string) => {
    const s = cache.get(id);
    const data =
      s?.status === "ready" || s?.status === "error" ? s.data : undefined;
    return data !== undefined
      ? ({
          status: "ready",
          data,
          refreshing: false,
          readAt: Date.now(),
        } as ReadState<unknown>)
      : null;
  };
  const board = boardId(from, to);
  const page = loc ? clientId(loc, from, to) : null;
  const shown = [board, page]
    .filter((id): id is string => Boolean(id))
    .map(id => [id, keep(id)] as const);
  cache.clear();
  for (const [id, state] of shown) if (state) cache.set(id, state);
  emit();
  loadBoard(from, to, true);
  if (loc) loadClientPage(loc, from, to, true);
}

type Read<T> = ReadState<T> & { reload: () => void };

/** One cached read: starts it when the id first shows, `reload` reads it again. */
function useRead<T>(
  id: string | null,
  start: (again: boolean) => void,
): Read<T> {
  const state = useSyncExternalStore(
    subscribe,
    () => (id ? ((cache.get(id) as ReadState<T> | undefined) ?? IDLE) : IDLE),
    () => IDLE,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: the id names the read; start follows it
  useEffect(() => {
    if (id) start(false);
  }, [id]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the id names the read; start follows it
  const reload = useCallback(() => {
    if (id) start(true);
  }, [id]);
  return { ...state, reload } as Read<T>;
}

export function useBoard(from: string, to: string): Read<Board> {
  return useRead<Board>(boardId(from, to), again => loadBoard(from, to, again));
}

export function useClientPage(
  loc: string | null,
  from: string,
  to: string,
): Read<ClientPage> {
  return useRead<ClientPage>(loc ? clientId(loc, from, to) : null, again => {
    if (loc) loadClientPage(loc, from, to, again);
  });
}

// ---------------------------------------------------------------------------
// Targets: the CEO and admins. Both lines empty goes back to the official one.

export async function saveTarget(input: {
  scope: string;
  metric: string;
  good: number | null;
  watch: number | null;
  note?: string | null;
}): Promise<Target | null> {
  const { data, error } = await supabase.rpc("cockpit_board_targets_save", {
    p_scope: input.scope,
    p_metric: input.metric,
    p_good: input.good,
    p_watch: input.watch,
    p_note: input.note?.trim() ? input.note.trim() : null,
  });
  if (error) throw new Error(boardProblem(error));
  const target = (data as { target?: unknown } | null)?.target;
  const parsed = TargetSchema.safeParse(target);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Levers: a dry run shows the ClickUp task; applying files it, once.

export const DEPARTMENTS = [
  { key: "media_buyer", label: "Media buyer" },
  { key: "creative", label: "Creative" },
  { key: "call_center", label: "Call centre" },
  { key: "client_success", label: "Client success" },
  { key: "tech", label: "Tech" },
] as const;
export type Department = (typeof DEPARTMENTS)[number]["key"];

export function departmentLabel(key: string | null | undefined): string {
  return DEPARTMENTS.find(d => d.key === key)?.label ?? "Another team";
}

export type LeverArgs = {
  locationId: string;
  metric: string;
  lever: string;
  department: Department;
  note?: string;
  from?: string;
  to?: string;
};

const PreviewSchema = z
  .object({
    dryRun: z.literal(true),
    plan: z
      .object({
        department: z.string(),
        name: z.string(),
        description: z.string(),
        dueDate: z.union([z.number(), z.string()]).nullable().optional(),
        clientTask: text,
      })
      .passthrough(),
  })
  .passthrough();
export type LeverPreview = z.output<typeof PreviewSchema>;

const FiledSchema = z
  .object({
    ok: z.literal(true),
    ticketId: text,
    ticketUrl: text,
    replayed: z.boolean().optional(),
    lever: LeverSchema.nullable().optional(),
  })
  .passthrough();
export type LeverFiled = z.output<typeof FiledSchema>;

async function invokeBoard(body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke("cockpit-board-api", {
    body,
  });
  if (error) {
    let detail: unknown = null;
    const response = (error as { context?: unknown }).context;
    if (response instanceof Response) {
      try {
        detail = await response.json();
      } catch {
        // The transport's own message is said below.
      }
    }
    const said = (detail as { error?: unknown } | null)?.error;
    if (typeof said === "string" && said.trim()) throw new Error(said.trim());
    const message = error.message ?? "";
    if (/failed to fetch|network|load failed|failed to send/i.test(message))
      throw new Error(
        "The board's function could not be reached. Check the connection and try again.",
      );
    if (/not found|404/i.test(message))
      throw new Error(
        "The board's function is not deployed yet. Tell the CEO.",
      );
    throw new Error(
      "The lever could not be filed. Try again; if it keeps failing, tell the CEO.",
    );
  }
  return data;
}

/** What the ClickUp task will say; writes nothing. */
export async function previewLever(args: LeverArgs): Promise<LeverPreview> {
  const data = await invokeBoard({ operation: "lever", args: cleanArgs(args) });
  const parsed = PreviewSchema.safeParse(data);
  if (!parsed.success)
    throw new Error(
      "The preview came back in a shape this page cannot read. Tell the CEO.",
    );
  return parsed.data;
}

/**
 * Files the task. The request id is the caller's for this one lever: a retry
 * after a dropped connection sends the same id, and the server replays a
 * task it already filed instead of filing it twice.
 */
export async function fileLever(
  args: LeverArgs,
  requestId: string,
): Promise<LeverFiled> {
  const data = await invokeBoard({
    operation: "lever",
    args: cleanArgs(args),
    apply: true,
    requestId,
  });
  const parsed = FiledSchema.safeParse(data);
  if (!parsed.success)
    throw new Error(
      "ClickUp's answer could not be read. Check the client's levers before filing it again.",
    );
  return parsed.data;
}

function cleanArgs(args: LeverArgs): LeverArgs {
  const note = args.note?.trim();
  return {
    locationId: args.locationId,
    metric: args.metric,
    lever: args.lever.trim(),
    department: args.department,
    ...(note ? { note } : {}),
    ...(args.from ? { from: args.from } : {}),
    ...(args.to ? { to: args.to } : {}),
  };
}

export function newRequestId(): string {
  return crypto.randomUUID();
}
