import { ConvexError, v } from "convex/values";
import type {
  Fact,
  GoldRow,
  Likelihood,
  PlanPatch,
  ProjectionsEdit,
  ProjectionsPage,
  ProjectionWeek,
  StripRow,
  WindowRow,
} from "../src/lib/projectionsView";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { sb } from "./billingCore";
import {
  authenticatedAction,
  authenticatedMutation,
  authenticatedQuery,
} from "./functions";
import { currentProfile } from "./profileRows";
import {
  actualOf,
  addDays,
  assertNeutralTitle,
  BANNED_TITLE,
  celebrationLine,
  daysToRenewal,
  FIRST_WIN_NEEDED,
  filtersOf,
  GOLD_TARGET,
  hardestOf,
  hasFirstWin,
  hotUsedThisMonth,
  inWindow,
  isDay,
  isMissed,
  isSunday,
  kuwaitDay,
  LIKELIHOODS,
  METRIC_LABEL,
  METRIC_UNIT,
  METRICS,
  type Metric,
  type Paid,
  type PlanStatus,
  RENEWAL_FIELD,
  resellGate,
  reviewTitle,
  rowState,
  STATUS_LABEL,
  STATUSES,
  shortDay,
  verdictOf,
  weekStartOf,
  whereTheyAre,
  winsInWeek,
  wonAction,
} from "./projectionsCore";
import { hasAccess, seatOf } from "./roles";

/**
 * The Projections screen, and the Sunday "Renewals & Re-sell Projections"
 * meeting that reads it through the bridge.
 *
 * The CEO, 2026-09-27: the CSM's week in five numbers (re-sells, renewals,
 * cash, reviews, referrals), each with a blood number and a stretch number
 * and an actual that fills itself in; and a renewal window, 60 days deep,
 * where no client reaches the end of their contract without a proactive
 * call booked or a reason written down.
 *
 * Where each actual comes from:
 * - re-sells, reviews and referrals: wins logged in the cockpit (a hot-list
 *   row marked Closed, a renewal plan marked re-sold), from `decisions`;
 * - renewals: renewal plans marked renewed, once contract end dates exist;
 * - cash: back-end client payments in the billing ledger (Supabase), read
 *   every half hour into `billingFeed`.
 * When a source cannot answer, the actual is typed in by hand and says so.
 * It is never shown as zero for want of a source.
 *
 * Every change leaves a `usage` row saying who did what; the ones that are
 * about a client (a plan started, a call booked, an outcome, a gold mark)
 * also leave a `decisions` row, the same log the rest of the cockpit uses.
 */

declare const process: { env: Record<string, string | undefined> };

type Any = any;

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const GHL_TOKEN = process.env.GHL_MAHARA_PIT ?? "";
const GHL_LOCATION = process.env.GHL_MAHARA_LOCATION ?? "";
/** The channel this cockpit already posts to (the end of day, eodOut.ts). */
const TEAM_CHANNEL = "#eods-csms";
/**
 * GoHighLevel sits behind a Cloudflare rule that answers a default agent
 * 403 (wa.ts): the browser User-Agent is load-bearing.
 */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const norm = (s: unknown) =>
  String(s ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const clean = (s: unknown, max = 600) =>
  String(s ?? "")
    .replace(/\s+\n/g, "\n")
    .trim()
    .slice(0, max);

/**
 * A refusal the screen can read. Production Convex hides an Error's text
 * ("Server Error") but not a ConvexError's data (billing.ts).
 */
function plain(e: unknown): ConvexError<{ message: string }> {
  if (e instanceof ConvexError) return e as ConvexError<{ message: string }>;
  const raw = e instanceof Error ? e.message : String(e);
  const message =
    raw
      .replace(/^[\s\S]*?Uncaught Error: /, "")
      .split("\n")[0]
      .trim()
      .slice(0, 300) || "That did not work. Try again in a minute.";
  return new ConvexError({ message });
}

async function plainly<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw plain(e);
  }
}

/** The words of a refusal, whichever way it was thrown. */
export function messageOf(e: unknown): string {
  const data = (e as { data?: { message?: string } })?.data;
  if (data?.message) return data.message;
  return plain(e).data.message;
}

// --- who is asking --------------------------------------------------------------------

export type Viewer = {
  email: string;
  isCeo: boolean;
  isAdmin: boolean;
  /** Clients this person may see; null is every client. */
  scope: Set<string> | null;
};

/** A viewer passed between functions: the bridge's, or one read from a session. */
const vViewer = v.object({
  email: v.string(),
  isCeo: v.boolean(),
  isAdmin: v.optional(v.boolean()),
  scope: v.optional(v.union(v.array(v.string()), v.null())),
});
type ViewerArg = {
  email: string;
  isCeo: boolean;
  isAdmin?: boolean;
  scope?: string[] | null;
};

function viewerFrom(a: ViewerArg): Viewer {
  const email = norm(a.email);
  if (!email.includes("@")) throw new Error("Who is asking has no address.");
  return {
    email,
    isCeo: Boolean(a.isCeo),
    isAdmin: Boolean(a.isAdmin),
    scope: a.scope ? new Set(a.scope.map(norm)) : null,
  };
}

async function sessionViewer(ctx: any): Promise<Viewer> {
  const seat = await seatOf(ctx);
  if (!(await hasAccess(ctx, seat.email)))
    throw new Error(
      "This cockpit is not yours. Ask an admin to add you in the portal.",
    );
  return seat;
}

const inScopeOf = (viewer: Viewer) => (name: string) =>
  !viewer.scope || viewer.scope.has(norm(name));

// --- the audit trail ---------------------------------------------------------------

async function audit(
  ctx: MutationCtx,
  viewer: Viewer,
  today: string,
  event: string,
  detail: string,
  decision?: {
    subject: string;
    action: string;
    kind: string;
    reason?: string;
    taskId?: string;
  },
): Promise<void> {
  const at = Date.now();
  await ctx.db.insert("usage", {
    email: viewer.email,
    role: "csm",
    event,
    detail: detail.slice(0, 500),
    at,
  });
  if (decision)
    await ctx.db.insert("decisions", {
      day: today,
      role: "csm",
      subject: decision.subject,
      action: decision.action.slice(0, 200),
      kind: decision.kind,
      reason: decision.reason?.slice(0, 400),
      evidence: "Projections",
      clickupTaskId: decision.taskId,
      byEmail: viewer.email,
      at,
    });
}

// --- sources -------------------------------------------------------------------------

type Feed = Doc<"billingFeed"> | null;

async function feedOf(ctx: QueryCtx): Promise<Feed> {
  return await ctx.db
    .query("billingFeed")
    .withIndex("by_key", q => q.eq("key", "ledger"))
    .first();
}

const hoursAgo = (ms: number, now: number) => {
  const h = Math.round((now - ms) / 3600_000);
  return h < 1
    ? "under an hour ago"
    : h === 1
      ? "an hour ago"
      : `${h} hours ago`;
};

type Source =
  | { ok: true; value: number; note: string }
  | { ok: false; note: string };

type Sources = {
  now: number;
  today: string;
  feed: Feed;
  tracked: boolean;
  inScope: (name: string) => boolean;
};

/** Cash for a week, from the ledger, or why it cannot be said. */
function cashSource(s: Sources, weekStart: string): Source {
  const weekEnd = addDays(weekStart, 6);
  const f = s.feed;
  if (!f?.okAt)
    return {
      ok: false,
      note: f?.error
        ? `The billing ledger could not be read: ${f.error}`
        : "The billing ledger has not been read yet.",
    };
  if (s.now - f.okAt > 3 * 3600_000)
    return {
      ok: false,
      note: `The billing ledger was last read ${hoursAgo(f.okAt, s.now)}${f.error ? `: ${f.error}` : ""}.`,
    };
  const ledgerAt = f.ledgerSyncedAt ?? 0;
  // A past week needs a ledger refreshed after it ended; this week, one
  // refreshed in the last two days.
  const weekClosedAt = Date.parse(`${weekEnd}T21:00:00Z`);
  const fresh =
    weekEnd < s.today
      ? ledgerAt > weekClosedAt
      : s.now - ledgerAt < 48 * 3600_000;
  if (!fresh)
    return {
      ok: false,
      note: ledgerAt
        ? `The billing ledger has not been refreshed since ${shortDay(kuwaitDay(ledgerAt))}.`
        : "The billing ledger has never been refreshed.",
    };
  const value = f.payments
    .filter(
      p =>
        p.side === "back_end" &&
        p.day >= weekStart &&
        p.day <= weekEnd &&
        s.inScope(p.clientName),
    )
    .reduce((t, p) => t + p.usd, 0);
  return {
    ok: true,
    value: Math.round(value * 100) / 100,
    note: "Back-end client payments in the billing ledger, by payment day.",
  };
}

function sourceFor(
  s: Sources,
  metric: Metric,
  weekStart: string,
  wins: Record<Metric, number> | null,
): Source {
  if (metric === "cash") return cashSource(s, weekStart);
  if (metric === "renewal" && !s.tracked)
    return {
      ok: false,
      note: `No contract end dates yet: the ClickUp field "${RENEWAL_FIELD.name}" (${RENEWAL_FIELD.type}) is missing on ${RENEWAL_FIELD.list}.`,
    };
  const note: Record<Metric, string> = {
    resell:
      "Wins logged in the cockpit: hot-list re-sell rows marked Closed and renewal plans marked re-sold.",
    renewal: "Renewal plans marked renewed.",
    cash: "",
    review: "Hot-list review rows marked Closed.",
    referral: "Hot-list referral rows marked Closed.",
  };
  return { ok: true, value: wins?.[metric] ?? 0, note: note[metric] };
}

/** What a client has paid so far: the ledger first, the card's LTV field second. */
function paidOf(feed: Feed, c: { taskId: string; name: string }): Paid {
  if (!feed?.okAt) return null;
  const mine = feed.payments.filter(
    p => p.taskId === c.taskId || norm(p.clientName) === norm(c.name),
  );
  if (mine.length)
    return {
      usd: Math.round(mine.reduce((t, p) => t + p.usd, 0) * 100) / 100,
      payments: mine.length,
      since: mine.map(p => p.day).sort()[0] ?? null,
      source: "ledger",
    };
  const acct = feed.accounts.find(
    a => a.taskId === c.taskId || norm(a.clientName) === norm(c.name),
  );
  return typeof acct?.ltvUsd === "number" && acct.ltvUsd > 0
    ? { usd: acct.ltvUsd, payments: 0, since: null, source: "ltv" }
    : null;
}

function paidLine(p: NonNullable<Paid>): string {
  return p.source === "ledger"
    ? `billing ledger, ${p.payments} payment${p.payments === 1 ? "" : "s"}${p.since ? ` since ${shortDay(p.since)}` : ""}`
    : "the LTV field on the ClickUp card";
}

/** The onboarding call on the client calendar, or the day the card was made. */
async function onboardedOf(
  ctx: QueryCtx,
  c: Doc<"clients">,
  today: string,
): Promise<{ day: string; source: string } | null> {
  const calls = await ctx.db
    .query("appointments")
    .withIndex("by_client", q => q.eq("clientName", c.name))
    .collect();
  const first = calls
    .filter(a => a.kind === "onboarding" && a.status !== "cancelled")
    .map(a => a.day)
    .sort()[0];
  if (first)
    return { day: first, source: "the onboarding call in GoHighLevel" };
  if (typeof c.signupDays === "number")
    return {
      day: addDays(today, -c.signupDays),
      source: "the day the ClickUp card was made",
    };
  return null;
}

async function liveFacts(
  ctx: QueryCtx,
  c: Doc<"clients">,
  feed: Feed,
): Promise<Fact[]> {
  const profile = await currentProfile(ctx, c.name);
  return whereTheyAre(
    c,
    (profile?.performance as Any) ?? null,
    paidOf(feed, c),
  );
}

// --- the page ----------------------------------------------------------------------

type BuildOpts = {
  today?: string;
  now?: number;
  forEmail?: string;
  /** Only these clients (the self-test's sentinel). */
  onlyTaskIds?: string[];
};

function planOf(p: Doc<"renewalPlans"> | null | undefined) {
  return {
    status: p?.status ?? "planned",
    callBookedFor: p?.callBookedFor ?? null,
    notThisCycleReason: p?.notThisCycleReason ?? null,
  };
}

export async function buildProjections(
  ctx: QueryCtx,
  viewer: Viewer,
  o: BuildOpts = {},
): Promise<ProjectionsPage> {
  const now = o.now ?? Date.now();
  const today = o.today ?? kuwaitDay(now);
  const weekStart = weekStartOf(today);
  const weeks = [
    weekStart,
    ...Array.from({ length: 8 }, (_, i) => addDays(weekStart, -7 * (i + 1))),
  ];
  const oldest = weeks[weeks.length - 1];
  const inScope = inScopeOf(viewer);

  let clients = (await ctx.db.query("clients").collect()).filter(c =>
    inScope(c.name),
  );
  if (o.onlyTaskIds)
    clients = clients.filter(c => o.onlyTaskIds?.includes(c.taskId));
  const names = new Set(clients.map(c => c.name));

  // Whose projections: the one asked for, else the viewer's own, else the
  // person who set some most recently (the CSM, when the CEO opens it).
  const rows: Doc<"projections">[] = [];
  for (const w of weeks)
    rows.push(
      ...(await ctx.db
        .query("projections")
        .withIndex("by_week", q => q.eq("weekStart", w))
        .collect()),
    );
  const latest = new Map<string, number>();
  for (const r of rows)
    latest.set(r.byEmail, Math.max(latest.get(r.byEmail) ?? 0, r.at));
  const owners = [...latest.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([e]) => e);
  const owner = o.forEmail
    ? norm(o.forEmail)
    : latest.has(viewer.email)
      ? viewer.email
      : (owners[0] ?? viewer.email);
  const mine = new Map(
    rows
      .filter(r => r.byEmail === owner)
      .map(r => [`${r.weekStart}|${r.metric}`, r]),
  );

  // Wins, from the decision log: the whole client success team's, since
  // the CEO may mark an outcome in the meeting as well as the CSM.
  const monthStart = `${today.slice(0, 7)}-01`;
  const from = monthStart < oldest ? monthStart : oldest;
  const decisions = (
    await ctx.db
      .query("decisions")
      .withIndex("by_day", q =>
        q.gte("day", from).lte("day", addDays(weekStart, 6)),
      )
      .collect()
  ).filter(d => d.role === "csm");
  const countable = decisions.filter(d =>
    o.onlyTaskIds ? names.has(d.subject) : inScope(d.subject),
  );
  const hotUsed = hotUsedThisMonth(decisions, today.slice(0, 7));

  const feed = await feedOf(ctx);
  const sources: Sources = {
    now,
    today,
    feed,
    tracked: clients.some(c => c.renewalTracked === true),
    inScope: o.onlyTaskIds ? name => names.has(name) : inScope,
  };

  const weekOf = (ws: string): ProjectionWeek => {
    const weekEnd = addDays(ws, 6);
    const over = weekEnd < today;
    const wins = winsInWeek(countable, ws);
    return {
      weekStart: ws,
      weekEnd,
      over,
      rows: METRICS.map((m): StripRow => {
        const p = mine.get(`${ws}|${m}`);
        const src = sourceFor(sources, m, ws, wins);
        const a = actualOf(src, p?.actual);
        return {
          metric: m,
          label: METRIC_LABEL[m],
          unit: METRIC_UNIT[m],
          blood: p?.blood ?? null,
          stretch: p?.stretch ?? null,
          actual: a.value,
          actualFrom: a.from,
          note: a.note,
          manualAllowed: !src.ok,
          missReason: p?.missReason ?? null,
          verdict: verdictOf(
            { blood: p?.blood, stretch: p?.stretch },
            a.value,
            over,
          ),
        };
      }),
    };
  };

  // The renewal window.
  const windowRows: WindowRow[] = [];
  for (const c of clients) {
    if (!c.renewalDate || !isDay(c.renewalDate)) continue;
    const renewalDate = c.renewalDate;
    const plan = await ctx.db
      .query("renewalPlans")
      .withIndex("by_task_date", q =>
        q.eq("taskId", c.taskId).eq("renewalDate", renewalDate),
      )
      .first();
    const pl = planOf(plan);
    if (!inWindow(renewalDate, today, pl.status)) continue;
    const gate = resellGate(c, hotUsed, today);
    const paid = paidOf(feed, c);
    const saved = plan?.whereTheyAre?.length ? plan.whereTheyAre : null;
    windowRows.push({
      taskId: c.taskId,
      clientName: c.name,
      renewalDate,
      days: daysToRenewal(renewalDate, today),
      state: rowState(renewalDate, pl, today),
      filters: filtersOf(renewalDate, pl, today),
      planId: plan?._id ?? null,
      status: pl.status as PlanStatus,
      likelihood: (plan?.likelihood as Likelihood | undefined) ?? null,
      callBookedFor: pl.callBookedFor,
      notThisCycleReason: pl.notThisCycleReason,
      angle: plan?.angle ?? null,
      objection: plan?.objection ?? null,
      objectionAnswer: plan?.objectionAnswer ?? null,
      offer: plan?.offer
        ? {
            price: plan.offer.price ?? null,
            deliverables: plan.offer.deliverables ?? null,
            durationMonths: plan.offer.durationMonths ?? null,
          }
        : null,
      offerGate: gate.ok
        ? { ok: true, why: null }
        : { ok: false, why: gate.why },
      outcomeNote: plan?.outcomeNote ?? null,
      callRecordingUrl: plan?.callRecordingUrl ?? null,
      goldStandard: Boolean(plan?.goldStandard),
      onboardedOn: await onboardedOf(ctx, c, today),
      paid: paid ? { usd: paid.usd, source: paidLine(paid) } : null,
      facts: saved ?? (await liveFacts(ctx, c, feed)),
      factsSaved: Boolean(saved),
      updatedAt: plan?.updatedAt ?? null,
    });
  }
  const order: Record<string, number> = {
    missed: 0,
    red: 1,
    outcome_due: 2,
    planned: 3,
    booked: 4,
    done: 5,
  };
  windowRows.sort(
    (a, b) =>
      (order[a.state] ?? 9) - (order[b.state] ?? 9) ||
      a.renewalDate.localeCompare(b.renewalDate),
  );

  // Clients being served with no end date on their card.
  const missing = clients
    .filter(c => c.bucket === "management" && !isDay(c.renewalDate))
    .map(c => ({ taskId: c.taskId, clientName: c.name }))
    .sort((a, b) => a.clientName.localeCompare(b.clientName));

  const gold: GoldRow[] = (
    await ctx.db
      .query("renewalPlans")
      .withIndex("by_gold", q => q.eq("goldStandard", true))
      .collect()
  )
    .filter(p =>
      o.onlyTaskIds ? o.onlyTaskIds.includes(p.taskId) : inScope(p.clientName),
    )
    .filter(p => p.callRecordingUrl)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(p => ({
      planId: p._id,
      clientName: p.clientName,
      renewalDate: p.renewalDate,
      status: p.status as PlanStatus,
      outcomeNote: p.outcomeNote ?? null,
      callRecordingUrl: String(p.callRecordingUrl),
    }));

  return {
    today,
    weekStart,
    owner,
    owners,
    thisWeek: weekOf(weekStart),
    lastWeek: weekOf(weeks[1]),
    history: weeks.slice(1).map(weekOf),
    window: {
      tracked: sources.tracked,
      rows: windowRows,
      missing,
      field: { ...RENEWAL_FIELD },
    },
    hardest: hardestOf(windowRows, today),
    gold: { count: gold.length, target: GOLD_TARGET, rows: gold },
    billing: {
      okAt: feed?.okAt ?? null,
      ledgerSyncedAt: feed?.ledgerSyncedAt ?? null,
      error: feed?.error ?? null,
    },
    canGold: viewer.isCeo,
    canEditOthers: viewer.isCeo || viewer.isAdmin,
  };
}

/** Clients whose renewal date passed this month with the plan still "planned". */
export async function missedRenewals(
  ctx: QueryCtx,
  month: string,
  today: string,
): Promise<{ key: string; name: string; renewalDate: string }[]> {
  const out: { key: string; name: string; renewalDate: string }[] = [];
  for (const c of await ctx.db.query("clients").collect()) {
    const day = c.renewalDate;
    if (!day || !isDay(day) || !day.startsWith(month) || day >= today) continue;
    const plan = await ctx.db
      .query("renewalPlans")
      .withIndex("by_task_date", q =>
        q.eq("taskId", c.taskId).eq("renewalDate", day),
      )
      .first();
    if (isMissed(day, planOf(plan), today))
      out.push({ key: c.taskId, name: c.name, renewalDate: day });
  }
  return out;
}

// --- changes ------------------------------------------------------------------------

type EditOpts = {
  today?: string;
  /** The self-test: no Slack line, no ClickUp write. */
  quiet?: boolean;
};

function ownerFor(viewer: Viewer, forEmail?: string): string {
  const owner = norm(forEmail ?? viewer.email);
  if (!owner.includes("@")) throw new Error("Whose projections is this?");
  if (owner !== viewer.email && !viewer.isCeo && !viewer.isAdmin)
    throw new Error("You can change your own projections only.");
  return owner;
}

function checkWeek(weekStart: string, today: string): void {
  if (!isSunday(weekStart))
    throw new Error("A projection week starts on a Sunday.");
  const current = weekStartOf(today);
  if (weekStart > addDays(current, 7) || weekStart < addDays(current, -56))
    throw new Error(
      "Projections can be set from eight weeks back to next week.",
    );
}

function checkNumber(label: string, n: unknown, metric: Metric): number {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0)
    throw new Error(`${label} is a number, zero or more.`);
  if (x > (metric === "cash" ? 10_000_000 : 1000))
    throw new Error(`${label} is too large.`);
  return metric === "cash" ? Math.round(x) : Math.round(x * 10) / 10;
}

async function projectionRow(
  ctx: MutationCtx,
  weekStart: string,
  owner: string,
  metric: Metric,
): Promise<Doc<"projections"> | null> {
  return await ctx.db
    .query("projections")
    .withIndex("by_week_email_metric", q =>
      q.eq("weekStart", weekStart).eq("byEmail", owner).eq("metric", metric),
    )
    .first();
}

async function sourcesFor(
  ctx: QueryCtx,
  viewer: Viewer,
  today: string,
): Promise<Sources> {
  const inScope = inScopeOf(viewer);
  const clients = (await ctx.db.query("clients").collect()).filter(c =>
    inScope(c.name),
  );
  return {
    now: Date.now(),
    today,
    feed: await feedOf(ctx),
    tracked: clients.some(c => c.renewalTracked === true),
    inScope,
  };
}

async function clientByTask(
  ctx: QueryCtx,
  taskId: string,
): Promise<Doc<"clients"> | null> {
  return await ctx.db
    .query("clients")
    .withIndex("by_taskId", q => q.eq("taskId", taskId))
    .first();
}

/** The plan for this client's current renewal date, started (and prefilled) if need be. */
async function ensurePlan(
  ctx: MutationCtx,
  viewer: Viewer,
  taskId: string,
  today: string,
): Promise<{ plan: Doc<"renewalPlans">; client: Doc<"clients"> }> {
  const client = await clientByTask(ctx, taskId);
  if (!client) throw new Error("That client is not on the board any more.");
  if (!inScopeOf(viewer)(client.name))
    throw new Error("That client is not on your list.");
  const renewalDate = client.renewalDate;
  if (!renewalDate || !isDay(renewalDate))
    throw new Error(
      `${client.name} has no "${RENEWAL_FIELD.name}" on the ClickUp card yet.`,
    );
  const found = await ctx.db
    .query("renewalPlans")
    .withIndex("by_task_date", q =>
      q.eq("taskId", taskId).eq("renewalDate", renewalDate),
    )
    .first();
  if (found) return { plan: found, client };
  const feed = await feedOf(ctx);
  const paid = paidOf(feed, client);
  const onboarded = await onboardedOf(ctx, client, today);
  const id = await ctx.db.insert("renewalPlans", {
    taskId,
    clientName: client.name,
    renewalDate,
    onboardedOn: onboarded?.day,
    paidAmount: paid?.usd,
    paidSource: paid ? paidLine(paid) : undefined,
    whereTheyAre: await liveFacts(ctx, client, feed),
    status: "planned",
    updatedBy: viewer.email,
    updatedAt: Date.now(),
  });
  await audit(
    ctx,
    viewer,
    today,
    "renewal_plan_started",
    `${client.name}, renewal ${renewalDate}`,
    {
      subject: client.name,
      action: `Started the renewal plan for ${renewalDate}`,
      kind: "approved",
      taskId,
    },
  );
  const plan = await ctx.db.get(id);
  if (!plan) throw new Error("The plan could not be saved. Try again.");
  return { plan, client };
}

const URL_RE = /^https?:\/\/\S+$/i;

/** A day, or an ISO time with its offset. */
function whenOrRefuse(s: string): string {
  const t = s.trim();
  if (isDay(t)) return t;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t) && !Number.isNaN(Date.parse(t)))
    return t;
  throw new Error("Pick the call's date.");
}

async function savePlan(
  ctx: MutationCtx,
  viewer: Viewer,
  taskId: string,
  patch: PlanPatch,
  today: string,
): Promise<void> {
  const { plan, client } = await ensurePlan(ctx, viewer, taskId, today);
  const next: Partial<Doc<"renewalPlans">> = {};
  const changed: string[] = [];
  if (patch.likelihood !== undefined) {
    if (
      patch.likelihood &&
      !(LIKELIHOODS as readonly string[]).includes(patch.likelihood)
    )
      throw new Error("Pick how likely the renewal is.");
    next.likelihood = patch.likelihood || undefined;
    changed.push("likelihood");
  }
  for (const k of [
    "angle",
    "objection",
    "objectionAnswer",
    "outcomeNote",
  ] as const) {
    if (patch[k] === undefined) continue;
    next[k] = clean(patch[k]) || undefined;
    changed.push(
      k === "objectionAnswer"
        ? "objection answer"
        : k === "outcomeNote"
          ? "outcome note"
          : k,
    );
  }
  if (patch.notThisCycleReason !== undefined) {
    next.notThisCycleReason = clean(patch.notThisCycleReason, 300) || undefined;
    changed.push("not-this-cycle reason");
  }
  if (patch.offer !== undefined) {
    if (patch.offer) {
      const month = today.slice(0, 7);
      const monthDecisions = await ctx.db
        .query("decisions")
        .withIndex("by_day", q =>
          q.gte("day", `${month}-01`).lte("day", `${month}-31`),
        )
        .collect();
      const gate = resellGate(
        client,
        hotUsedThisMonth(monthDecisions, today.slice(0, 7)),
        today,
      );
      // An offer already on the plan can still be corrected; a new one waits.
      if (!gate.ok && !plan.offer) throw new Error(gate.why);
      const price =
        patch.offer.price === null || patch.offer.price === undefined
          ? undefined
          : checkNumber("The price", patch.offer.price, "cash");
      const months =
        patch.offer.durationMonths === null ||
        patch.offer.durationMonths === undefined
          ? undefined
          : Math.round(Number(patch.offer.durationMonths));
      if (months !== undefined && !(months >= 1 && months <= 36))
        throw new Error("The offer runs 1 to 36 months.");
      next.offer = {
        price,
        deliverables: clean(patch.offer.deliverables, 400) || undefined,
        durationMonths: months,
      };
    } else next.offer = undefined;
    changed.push("offer");
  }
  if (patch.callBookedFor !== undefined) {
    const when = patch.callBookedFor.trim()
      ? whenOrRefuse(patch.callBookedFor)
      : undefined;
    next.callBookedFor = when;
    if (when && plan.status === "planned") next.status = "call_booked";
    if (!when && plan.status === "call_booked") next.status = "planned";
    changed.push(when ? "call date" : "call date taken off");
  }
  if (patch.callRecordingUrl !== undefined) {
    const url = patch.callRecordingUrl.trim();
    if (url && !URL_RE.test(url))
      throw new Error("Paste the recording's link, starting with https://.");
    next.callRecordingUrl = url || undefined;
    if (!url && plan.goldStandard) next.goldStandard = false;
    changed.push("recording");
  }
  if (patch.refreshFacts) {
    next.whereTheyAre = await liveFacts(ctx, client, await feedOf(ctx));
    changed.push("where they are, read again");
  }
  if (!changed.length) return;
  await ctx.db.patch(plan._id, {
    ...next,
    updatedBy: viewer.email,
    updatedAt: Date.now(),
  });
  const booked =
    next.callBookedFor && plan.callBookedFor !== next.callBookedFor;
  await audit(
    ctx,
    viewer,
    today,
    "renewal_plan_saved",
    `${client.name}: ${changed.join(", ")}`,
    booked
      ? {
          subject: client.name,
          action: `Proactive results call set for ${String(next.callBookedFor).slice(0, 10)}`,
          kind: "approved",
          taskId,
        }
      : undefined,
  );
}

async function setStatus(
  ctx: MutationCtx,
  viewer: Viewer,
  a: { taskId: string; status: string; reason?: string; note?: string },
  o: EditOpts & { today: string },
): Promise<void> {
  if (!(STATUSES as readonly string[]).includes(a.status))
    throw new Error("Pick the renewal's status.");
  const status = a.status as PlanStatus;
  const { plan, client } = await ensurePlan(ctx, viewer, a.taskId, o.today);
  const reason = clean(a.reason, 300);
  const note = clean(a.note, 600);
  if (status === "not_this_cycle" && !reason && !plan.notThisCycleReason)
    throw new Error("Say why it is not this cycle.");
  if (status === "resold" && !hasFirstWin(client))
    throw new Error(FIRST_WIN_NEEDED);
  if (status === "call_booked" && !plan.callBookedFor)
    throw new Error("Put the call's date in first, or use Book call.");
  const prev = plan.status as PlanStatus;
  if (prev === status && !reason && !note) return;
  await ctx.db.patch(plan._id, {
    status,
    ...(reason ? { notThisCycleReason: reason } : {}),
    ...(note ? { outcomeNote: note } : {}),
    updatedBy: viewer.email,
    updatedAt: Date.now(),
  });
  const wonOf = (s: string): Metric | null =>
    s === "renewed" ? "renewal" : s === "resold" ? "resell" : null;
  const was = wonOf(prev);
  const now = wonOf(status);
  const detail =
    now === "renewal"
      ? plan.offer?.durationMonths
        ? `${plan.offer.durationMonths} months`
        : undefined
      : now === "resell"
        ? clean(plan.offer?.deliverables, 80) || undefined
        : undefined;
  if (was && was !== now)
    await audit(
      ctx,
      viewer,
      o.today,
      "renewal_won_undone",
      `${client.name}: ${STATUS_LABEL[prev]} to ${STATUS_LABEL[status]}`,
      {
        subject: client.name,
        action:
          was === "renewal" ? "Won undone: renewal" : "Won undone: re-sell",
        kind: "unwon",
        taskId: client.taskId,
      },
    );
  if (now && now !== was)
    await audit(
      ctx,
      viewer,
      o.today,
      "renewal_won",
      `${client.name}: ${STATUS_LABEL[status]}`,
      {
        subject: client.name,
        action: wonAction(now, detail),
        kind: "won",
        reason: note || undefined,
        taskId: client.taskId,
      },
    );
  else if (!now)
    await audit(
      ctx,
      viewer,
      o.today,
      "renewal_status",
      `${client.name}: ${STATUS_LABEL[prev]} to ${STATUS_LABEL[status]}`,
      {
        subject: client.name,
        action: `Renewal status: ${STATUS_LABEL[status]}`,
        kind: "approved",
        reason: reason || note || undefined,
        taskId: client.taskId,
      },
    );
  // One line to the team, once per plan, for a won renewal or re-sell.
  if (now && !plan.celebratedAt && !o.quiet) {
    await ctx.scheduler.runAfter(0, internal.projections.celebrate, {
      metric: now,
      clientName: client.name,
      key: `plan:${plan._id}`,
      detail,
    });
    await ctx.db.patch(plan._id, { celebratedAt: Date.now() });
  }
}

async function setGold(
  ctx: MutationCtx,
  viewer: Viewer,
  planId: string,
  on: boolean,
  today: string,
): Promise<void> {
  if (!viewer.isCeo)
    throw new Error("Only the CEO marks a call as gold standard.");
  const id = ctx.db.normalizeId("renewalPlans", planId);
  const plan = id ? await ctx.db.get(id) : null;
  if (!plan) throw new Error("That renewal plan is not there any more.");
  if (on && !plan.callRecordingUrl)
    throw new Error("Add the call's recording first.");
  if (Boolean(plan.goldStandard) === on) return;
  await ctx.db.patch(plan._id, {
    goldStandard: on,
    goldBy: on ? viewer.email : undefined,
    updatedBy: viewer.email,
    updatedAt: Date.now(),
  });
  await audit(
    ctx,
    viewer,
    today,
    on ? "gold_marked" : "gold_unmarked",
    plan.clientName,
    {
      subject: plan.clientName,
      action: on
        ? "Marked the call gold standard"
        : "Took the call out of the gold-standard library",
      kind: "approved",
      taskId: plan.taskId,
    },
  );
}

/** Every change on the screen and from the meeting page comes through here. */
export async function applyEdit(
  ctx: MutationCtx,
  viewer: Viewer,
  e: ProjectionsEdit,
  opts: EditOpts = {},
): Promise<void> {
  const today = opts.today ?? kuwaitDay();
  if (e.kind === "projection") {
    if (!(METRICS as readonly string[]).includes(e.metric))
      throw new Error("Pick a metric.");
    checkWeek(e.weekStart, today);
    const owner = ownerFor(viewer, e.forEmail);
    const blood = checkNumber("Blood", e.blood, e.metric);
    const stretch = checkNumber("Stretch", e.stretch, e.metric);
    if (stretch < blood)
      throw new Error("Stretch is at least the blood number.");
    const row = await projectionRow(ctx, e.weekStart, owner, e.metric);
    if (row) await ctx.db.patch(row._id, { blood, stretch, at: Date.now() });
    else
      await ctx.db.insert("projections", {
        weekStart: e.weekStart,
        byEmail: owner,
        metric: e.metric,
        blood,
        stretch,
        at: Date.now(),
      });
    await audit(
      ctx,
      viewer,
      today,
      "projection_set",
      `${e.metric}, week of ${e.weekStart}, for ${owner}: blood ${row?.blood ?? "-"} to ${blood}, stretch ${row?.stretch ?? "-"} to ${stretch}`,
    );
    return;
  }
  if (e.kind === "actual" || e.kind === "missReason") {
    if (!(METRICS as readonly string[]).includes(e.metric))
      throw new Error("Pick a metric.");
    checkWeek(e.weekStart, today);
    const owner = ownerFor(viewer, e.forEmail);
    const row = await projectionRow(ctx, e.weekStart, owner, e.metric);
    if (!row) throw new Error("Set the blood and stretch numbers first.");
    if (e.kind === "actual") {
      const src = sourceFor(
        await sourcesFor(ctx, viewer, today),
        e.metric,
        e.weekStart,
        null,
      );
      if (src.ok)
        throw new Error(
          `${METRIC_LABEL[e.metric]} fill in by themselves. ${src.note}`,
        );
      const actual =
        e.actual === null
          ? undefined
          : checkNumber("The actual", e.actual, e.metric);
      await ctx.db.patch(row._id, { actual, at: Date.now() });
      await audit(
        ctx,
        viewer,
        today,
        "projection_actual",
        `${e.metric}, week of ${e.weekStart}, for ${owner}: ${row.actual ?? "-"} to ${actual ?? "-"} (by hand)`,
      );
    } else {
      const reason = clean(e.reason, 300) || undefined;
      await ctx.db.patch(row._id, { missReason: reason, at: Date.now() });
      await audit(
        ctx,
        viewer,
        today,
        "projection_miss_reason",
        `${e.metric}, week of ${e.weekStart}, for ${owner}: ${reason ?? "cleared"}`,
      );
    }
    return;
  }
  if (e.kind === "plan") return savePlan(ctx, viewer, e.taskId, e.patch, today);
  if (e.kind === "status") return setStatus(ctx, viewer, e, { ...opts, today });
  if (e.kind === "gold") return setGold(ctx, viewer, e.planId, e.on, today);
}

// --- validators ----------------------------------------------------------------------

const vMetric = v.union(
  v.literal("resell"),
  v.literal("renewal"),
  v.literal("cash"),
  v.literal("review"),
  v.literal("referral"),
);
const vStatus = v.union(
  v.literal("planned"),
  v.literal("call_booked"),
  v.literal("renewed"),
  v.literal("resold"),
  v.literal("not_this_cycle"),
  v.literal("lost"),
);
const vPatch = v.object({
  likelihood: v.optional(
    v.union(
      v.literal("high"),
      v.literal("medium"),
      v.literal("low"),
      v.literal(""),
    ),
  ),
  angle: v.optional(v.string()),
  objection: v.optional(v.string()),
  objectionAnswer: v.optional(v.string()),
  offer: v.optional(
    v.union(
      v.null(),
      v.object({
        price: v.optional(v.union(v.number(), v.null())),
        deliverables: v.optional(v.string()),
        durationMonths: v.optional(v.union(v.number(), v.null())),
      }),
    ),
  ),
  callBookedFor: v.optional(v.string()),
  notThisCycleReason: v.optional(v.string()),
  outcomeNote: v.optional(v.string()),
  callRecordingUrl: v.optional(v.string()),
  refreshFacts: v.optional(v.boolean()),
});
export const vEdit = v.union(
  v.object({
    kind: v.literal("projection"),
    weekStart: v.string(),
    metric: vMetric,
    blood: v.number(),
    stretch: v.number(),
    forEmail: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("actual"),
    weekStart: v.string(),
    metric: vMetric,
    actual: v.union(v.number(), v.null()),
    forEmail: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("missReason"),
    weekStart: v.string(),
    metric: vMetric,
    reason: v.string(),
    forEmail: v.optional(v.string()),
  }),
  v.object({ kind: v.literal("plan"), taskId: v.string(), patch: vPatch }),
  v.object({
    kind: v.literal("status"),
    taskId: v.string(),
    status: vStatus,
    reason: v.optional(v.string()),
    note: v.optional(v.string()),
  }),
  v.object({ kind: v.literal("gold"), planId: v.string(), on: v.boolean() }),
);

// --- the screen's functions ------------------------------------------------------------

export const page = authenticatedQuery({
  args: { forEmail: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, a): Promise<ProjectionsPage> =>
    plainly(async () =>
      buildProjections(ctx, await sessionViewer(ctx), { forEmail: a.forEmail }),
    ),
});

export const edit = authenticatedMutation({
  args: { edit: vEdit },
  returns: v.null(),
  handler: async (ctx, a) =>
    plainly(async () => {
      await applyEdit(ctx, await sessionViewer(ctx), a.edit);
      return null;
    }),
});

export const viewerFor = internalQuery({
  args: { userId: v.id("users") },
  returns: vViewer,
  handler: async (ctx, { userId }) => {
    const v0 = await sessionViewer({ ...ctx, userId });
    return {
      email: v0.email,
      isCeo: v0.isCeo,
      isAdmin: v0.isAdmin,
      scope: v0.scope ? [...v0.scope] : null,
    };
  },
});

// --- booking the proactive call ----------------------------------------------------------

export const bookingContext = internalQuery({
  args: { viewer: vViewer, taskId: v.string() },
  returns: v.any(),
  handler: async (ctx, a) => {
    const viewer = viewerFrom(a.viewer);
    const c = await clientByTask(ctx, a.taskId);
    if (!c) throw new Error("That client is not on the board any more.");
    if (!inScopeOf(viewer)(c.name))
      throw new Error("That client is not on your list.");
    if (!isDay(c.renewalDate))
      throw new Error(
        `${c.name} has no "${RENEWAL_FIELD.name}" on the ClickUp card yet.`,
      );
    // The contact behind the client's own WhatsApp thread, else the one on
    // their last call booked in GoHighLevel.
    const threads = (await ctx.db.query("waThreads").collect()).filter(
      t => t.contactId && t.clientName && norm(t.clientName) === norm(c.name),
    );
    threads.sort((x, y) => (y.lastAt ?? 0) - (x.lastAt ?? 0));
    const appts = (
      await ctx.db
        .query("appointments")
        .withIndex("by_client", q => q.eq("clientName", c.name))
        .collect()
    ).sort((x, y) => y.startTime.localeCompare(x.startTime));
    return {
      clientName: c.name,
      contactId: threads[0]?.contactId ?? null,
      apptIds: appts.slice(0, 5).map(x => x.apptId),
    };
  },
});

async function ghl(method: string, path: string, body?: unknown): Promise<Any> {
  if (!GHL_TOKEN || !GHL_LOCATION)
    throw new Error(
      "GoHighLevel is not set up for this cockpit (GHL_MAHARA_PIT, GHL_MAHARA_LOCATION).",
    );
  let res: Response;
  try {
    res = await fetch(`https://services.leadconnectorhq.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${GHL_TOKEN}`,
        Version: "2021-04-15",
        Accept: "application/json",
        "User-Agent": UA,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    console.error(`ghl ${method} ${path}: ${String(e).slice(0, 160)}`);
    throw new Error("GoHighLevel did not answer. Try again in a minute.");
  }
  const text = await res.text();
  if (!res.ok) {
    console.error(`ghl ${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
    throw new Error(
      `GoHighLevel refused it (${res.status}): ${text.slice(0, 160)}`,
    );
  }
  return text ? JSON.parse(text) : {};
}

/** The client check-in calendar in the client-facing sub-account. */
async function checkInCalendar(): Promise<{ id: string; userId?: string }> {
  const d = await ghl(
    "GET",
    `/calendars/?locationId=${encodeURIComponent(GHL_LOCATION)}`,
  );
  const cals: Any[] = d?.calendars ?? [];
  const hit = cals.find(
    c => c.isActive !== false && /check[\s-]*in/i.test(String(c.name ?? "")),
  );
  if (!hit)
    throw new Error(
      "There is no check-in calendar in GoHighLevel to book the call on.",
    );
  const member =
    ((hit.teamMembers ?? []) as Any[]).find(m => m.isPrimary) ??
    (hit.teamMembers ?? [])[0];
  return { id: String(hit.id), userId: member?.userId };
}

async function book(
  ctx: ActionCtx,
  viewer: ViewerArg,
  a: { taskId: string; day: string; time: string; minutes?: number },
): Promise<{ when: string; title: string }> {
  if (!isDay(a.day) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time))
    throw new Error("Pick the call's day and time.");
  const minutes = Math.round(a.minutes ?? 30);
  if (!(minutes >= 15 && minutes <= 90))
    throw new Error("A call runs 15 to 90 minutes.");
  const startIso = `${a.day}T${a.time}:00+03:00`;
  const start = Date.parse(startIso);
  if (start < Date.now() + 10 * 60_000)
    throw new Error("Pick a time that has not passed.");
  if (start > Date.now() + 120 * 86_400_000)
    throw new Error("Book the call inside the next four months.");
  const b: { clientName: string; contactId: string | null; apptIds: string[] } =
    await ctx.runQuery(internal.projections.bookingContext, {
      viewer,
      taskId: a.taskId,
    });
  const title = reviewTitle(b.clientName);
  assertNeutralTitle(title);
  let contactId = b.contactId;
  for (const id of b.apptIds) {
    if (contactId) break;
    const got = await ghl(
      "GET",
      `/calendars/events/appointments/${encodeURIComponent(id)}`,
    ).catch(() => null);
    contactId = got?.appointment?.contactId ?? got?.event?.contactId ?? null;
  }
  if (!contactId)
    throw new Error(
      `No GoHighLevel contact is linked to ${b.clientName}. Book the call in GoHighLevel, then put its date here.`,
    );
  const cal = await checkInCalendar();
  const endIso = new Date(start + minutes * 60_000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "+00:00");
  const made = await ghl("POST", "/calendars/events/appointments", {
    calendarId: cal.id,
    locationId: GHL_LOCATION,
    contactId,
    startTime: startIso,
    endTime: endIso,
    title,
    appointmentStatus: "confirmed",
    ignoreFreeSlotValidation: true,
    toNotify: true,
    ...(cal.userId ? { assignedUserId: cal.userId } : {}),
  });
  const appointmentId = String(made?.id ?? made?.appointment?.id ?? "");
  await ctx.runMutation(internal.projections.recordBooking, {
    viewer,
    taskId: a.taskId,
    when: startIso,
    appointmentId: appointmentId || undefined,
  });
  return { when: startIso, title };
}

export const recordBooking = internalMutation({
  args: {
    viewer: vViewer,
    taskId: v.string(),
    when: v.string(),
    appointmentId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    const viewer = viewerFrom(a.viewer);
    const today = kuwaitDay();
    const { plan, client } = await ensurePlan(ctx, viewer, a.taskId, today);
    const day = a.when.slice(0, 10);
    await ctx.db.patch(plan._id, {
      callBookedFor: a.when,
      ghlAppointmentId: a.appointmentId,
      ...(plan.status === "planned" ? { status: "call_booked" } : {}),
      updatedBy: viewer.email,
      updatedAt: Date.now(),
    });
    // The next point of contact on the ClickUp card, through the same
    // outbox every other booking uses.
    await ctx.db.insert("outbox", {
      kind: "booked",
      clientTaskId: client.taskId,
      clientName: client.name,
      action: "Proactive results call booked",
      evidence: "Booked from Projections in the client success cockpit.",
      value: day,
      createdAt: Date.now(),
    });
    await ctx.db.patch(client._id, { nextPoc: day });
    await audit(
      ctx,
      viewer,
      today,
      "renewal_call_booked",
      `${client.name}: ${a.when}${a.appointmentId ? ` (GoHighLevel ${a.appointmentId})` : ""}`,
      {
        subject: client.name,
        action: `Booked the proactive results call for ${day}`,
        kind: "approved",
        taskId: client.taskId,
      },
    );
    return null;
  },
});

export const bookCall = authenticatedAction({
  args: {
    taskId: v.string(),
    day: v.string(),
    time: v.string(),
    minutes: v.optional(v.number()),
  },
  returns: v.any(),
  handler: (ctx, a): Promise<{ when: string; title: string }> =>
    plainly(async () => {
      const viewer: ViewerArg = await ctx.runQuery(
        internal.projections.viewerFor,
        { userId: ctx.userId },
      );
      return await book(ctx, viewer, a);
    }),
});

// --- the team's win line ---------------------------------------------------------------

export const celebrate = internalAction({
  args: {
    metric: v.string(),
    clientName: v.string(),
    key: v.string(),
    detail: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (_ctx, a) => {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      console.error(
        "win line not sent: Supabase is not set up on this deployment",
      );
      return null;
    }
    const metric = (METRICS as readonly string[]).includes(a.metric)
      ? (a.metric as Metric)
      : "resell";
    try {
      // Queued for the VPS worker that already posts this cockpit's end of
      // day (hermes/eod-out): Slack only, no sheet row. One per win.
      await sb(
        SUPABASE_URL,
        SUPABASE_KEY,
        "eod_outbox?on_conflict=role,day,person",
        {
          method: "POST",
          body: [
            {
              role: "csm-win",
              day: kuwaitDay(),
              person: a.key.slice(0, 120),
              slack_id: null,
              channel: TEAM_CHANNEL,
              tab: null,
              body: celebrationLine(metric, a.clientName, a.detail),
              row_values: null,
              status: "queued",
              attempts: 0,
              error: null,
            },
          ],
          prefer: "resolution=ignore-duplicates,return=minimal",
        },
      );
      console.log(`win line queued: ${a.key}`);
    } catch (e) {
      console.error(`win line failed: ${a.key}: ${String(e).slice(0, 200)}`);
    }
    return null;
  },
});

// --- the billing ledger ------------------------------------------------------------------

export const storeBilling = internalMutation({
  args: {
    payments: v.optional(v.array(v.any())),
    accounts: v.optional(v.array(v.any())),
    ledgerSyncedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("billingFeed")
      .withIndex("by_key", q => q.eq("key", "ledger"))
      .first();
    const now = Date.now();
    if (a.error !== undefined) {
      // A failed read keeps the last good ledger and says how stale it is.
      if (row)
        await ctx.db.patch(row._id, {
          fetchedAt: now,
          error: a.error.slice(0, 300),
          failures: (row.failures ?? 0) + 1,
        });
      else
        await ctx.db.insert("billingFeed", {
          key: "ledger",
          payments: [],
          accounts: [],
          fetchedAt: now,
          error: a.error.slice(0, 300),
          failures: 1,
        });
      return null;
    }
    const payments = (a.payments ?? [])
      .filter(p => p?.payment_id && p.day && Number.isFinite(Number(p.usd)))
      .map(p => ({
        id: String(p.payment_id),
        taskId: p.clickup_task_id ? String(p.clickup_task_id) : undefined,
        clientName: String(p.client_name ?? ""),
        day: String(p.day).slice(0, 10),
        usd: Math.round(Number(p.usd) * 100) / 100,
        side: p.side ? String(p.side) : undefined,
        kind: p.kind ? String(p.kind) : undefined,
      }));
    const accounts = (a.accounts ?? [])
      .filter(x => x?.clickup_task_id)
      .map(x => ({
        taskId: String(x.clickup_task_id),
        clientName: String(x.client_name ?? ""),
        ltvUsd:
          x.ltv_field_usd === null || x.ltv_field_usd === undefined
            ? undefined
            : Number(x.ltv_field_usd),
        plan: x.payment_plan ? String(x.payment_plan) : undefined,
      }));
    const doc = {
      key: "ledger",
      payments,
      accounts,
      ledgerSyncedAt: a.ledgerSyncedAt,
      fetchedAt: now,
      okAt: now,
      error: undefined,
      failures: 0,
    };
    if (row) await ctx.db.patch(row._id, doc);
    else await ctx.db.insert("billingFeed", doc);
    return null;
  },
});

async function readLedger(ctx: ActionCtx): Promise<{
  ok: boolean;
  payments?: number;
  error?: string;
}> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    const error =
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set on the client success deployment.";
    await ctx.runMutation(internal.projections.storeBilling, { error });
    console.error(`billing feed failed: ${error}`);
    return { ok: false, error };
  }
  try {
    const since = addDays(kuwaitDay(), -400);
    const payments = await sb(
      SUPABASE_URL,
      SUPABASE_KEY,
      `cockpit_client_payments?select=payment_id,clickup_task_id,client_name,day,usd,side,kind&day=gte.${since}&order=day.asc&limit=5000`,
    );
    const accounts = await sb(
      SUPABASE_URL,
      SUPABASE_KEY,
      "cockpit_billing_accounts?select=clickup_task_id,client_name,ltv_field_usd,payment_plan,synced_at&limit=2000",
    );
    const synced = accounts
      .map(x => Date.parse(String(x.synced_at ?? "")))
      .filter(Number.isFinite);
    await ctx.runMutation(internal.projections.storeBilling, {
      payments,
      accounts,
      ledgerSyncedAt: synced.length ? Math.max(...synced) : undefined,
    });
    console.log(
      `billing feed ok: ${payments.length} payments, ${accounts.length} accounts`,
    );
    return { ok: true, payments: payments.length };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    await ctx.runMutation(internal.projections.storeBilling, { error });
    console.error(`billing feed failed: ${error}`);
    return { ok: false, error };
  }
}

/** Every half hour (crons.ts). */
export const refreshBilling = internalAction({
  args: {},
  returns: v.any(),
  handler: async ctx => readLedger(ctx),
});

export const refreshBillingNow = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: (ctx): Promise<{ ok: boolean; payments?: number; error?: string }> =>
    plainly(async () => {
      await ctx.runQuery(internal.projections.viewerFor, {
        userId: ctx.userId,
      });
      return await readLedger(ctx);
    }),
});

// --- the bridge: the media buyer's meeting page ----------------------------------------

export const pageFor = internalQuery({
  args: { viewer: vViewer, forEmail: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, a): Promise<ProjectionsPage> =>
    buildProjections(ctx, viewerFrom(a.viewer), { forEmail: a.forEmail }),
});

export const editFor = internalMutation({
  args: { viewer: vViewer, edit: vEdit },
  returns: v.null(),
  handler: async (ctx, a) => {
    await applyEdit(ctx, viewerFrom(a.viewer), a.edit);
    return null;
  },
});

export const bookFor = internalAction({
  args: {
    viewer: vViewer,
    taskId: v.string(),
    day: v.string(),
    time: v.string(),
    minutes: v.optional(v.number()),
  },
  returns: v.any(),
  handler: async (ctx, a): Promise<{ when: string; title: string }> =>
    book(ctx, a.viewer, a),
});

// --- the production self-test ------------------------------------------------------------

/**
 * The rules against the real tables, on sentinel rows only: the week of
 * 2000-01-02, one sentinel client and a sentinel address, all deleted
 * before it returns. It runs in one transaction, so no screen ever sees
 * them, and it posts nothing to Slack and writes nothing to ClickUp.
 */
export const selfTest = internalMutation({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const SENT = {
      email: "selftest@projections.invalid",
      taskId: "zz-projections-self-test",
      name: "ZZ projections self-test",
    };
    const WEEK = "2000-01-02";
    const TODAY = "2000-01-04";
    const checks: { name: string; ok: boolean; detail?: string }[] = [];
    const check = (name: string, ok: boolean, detail?: string) =>
      checks.push({ name, ok, ...(detail ? { detail } : {}) });
    const csm: Viewer = {
      email: SENT.email,
      isCeo: false,
      isAdmin: false,
      scope: null,
    };
    const ceo: Viewer = { ...csm, isCeo: true };
    const o = { today: TODAY, quiet: true };
    const read = (today = TODAY) =>
      buildProjections(ctx, csm, {
        today,
        forEmail: SENT.email,
        onlyTaskIds: [SENT.taskId],
      });
    const refusal = async (fn: () => Promise<unknown>): Promise<string> => {
      try {
        await fn();
        return "";
      } catch (e) {
        return messageOf(e);
      }
    };
    let clientId: Id<"clients"> | null = null;
    try {
      clientId = await ctx.db.insert("clients", {
        taskId: SENT.taskId,
        name: SENT.name,
        stage: "Active",
        stageRank: 9,
        liveDays: 5,
        todo: "self-test",
        level: "green",
        rank: 99,
        hot: [],
        loose: [],
        changes: [],
        newSignup: false,
        onboarding: false,
        bucket: "management",
        renewalDate: "2000-01-20",
        renewalTracked: true,
        firstWin: false,
        syncedAt: Date.now(),
      });

      await applyEdit(
        ctx,
        csm,
        {
          kind: "projection",
          weekStart: WEEK,
          metric: "renewal",
          blood: 1,
          stretch: 2,
        },
        o,
      );
      await applyEdit(
        ctx,
        csm,
        {
          kind: "projection",
          weekStart: WEEK,
          metric: "renewal",
          blood: 1,
          stretch: 3,
        },
        o,
      );
      const rows = await ctx.db
        .query("projections")
        .withIndex("by_week_email_metric", q =>
          q
            .eq("weekStart", WEEK)
            .eq("byEmail", SENT.email)
            .eq("metric", "renewal"),
        )
        .collect();
      check(
        "one row per week, person and metric",
        rows.length === 1 && rows[0]?.stretch === 3,
        `${rows.length} row(s)`,
      );

      let p = await read();
      const row = p.window.rows.find(r => r.taskId === SENT.taskId);
      check(
        "in the window 16 days before the date",
        Boolean(row),
        row ? `${row.days} days` : "absent",
      );
      check("red with no call and no reason", row?.state === "red", row?.state);
      check(
        "in the window at 60 days, not at 61",
        Boolean((await read("1999-11-21")).window.rows.length) &&
          !(await read("1999-11-20")).window.rows.length,
      );

      const noWin = await refusal(() =>
        applyEdit(
          ctx,
          csm,
          {
            kind: "plan",
            taskId: SENT.taskId,
            patch: { offer: { price: 1000 } },
          },
          o,
        ),
      );
      check("no offer before a first win", noWin === FIRST_WIN_NEEDED, noWin);
      check(
        "the row says so",
        p.window.rows[0]?.offerGate.why === FIRST_WIN_NEEDED,
      );

      await applyEdit(
        ctx,
        csm,
        {
          kind: "plan",
          taskId: SENT.taskId,
          patch: { callBookedFor: "2000-01-10" },
        },
        o,
      );
      p = await read();
      check(
        "a booked call clears the red",
        p.window.rows[0]?.state === "booked",
        p.window.rows[0]?.state,
      );

      const before = p.thisWeek.rows.find(r => r.metric === "renewal");
      await applyEdit(
        ctx,
        csm,
        {
          kind: "status",
          taskId: SENT.taskId,
          status: "renewed",
          note: "self-test",
        },
        o,
      );
      p = await read();
      const after = p.thisWeek.rows.find(r => r.metric === "renewal");
      check(
        "a renewal moves the week's actual up by one",
        before?.actual === 0 &&
          after?.actual === 1 &&
          after.actualFrom === "source" &&
          after.verdict === "hit",
        `${before?.actual} to ${after?.actual}, ${after?.verdict}`,
      );

      await ctx.db.patch(clientId, { renewalTracked: false });
      p = await read();
      const missing = p.thisWeek.rows.find(r => r.metric === "renewal");
      check(
        "no source: the actual is empty, never zero",
        missing?.actual === null && missing.actualFrom === "missing",
        String(missing?.actual),
      );
      await applyEdit(
        ctx,
        csm,
        { kind: "actual", weekStart: WEEK, metric: "renewal", actual: 2 },
        o,
      );
      p = await read();
      const typed = p.thisWeek.rows.find(r => r.metric === "renewal");
      check(
        "a hand-typed actual is used and marked",
        typed?.actual === 2 && typed.actualFrom === "manual",
      );
      await ctx.db.patch(clientId, { renewalTracked: true });
      const typedOver = await refusal(() =>
        applyEdit(
          ctx,
          csm,
          { kind: "actual", weekStart: WEEK, metric: "renewal", actual: 5 },
          o,
        ),
      );
      check(
        "no hand-typed actual while the source answers",
        typedOver.includes("fill in by themselves"),
        typedOver,
      );

      const plan = await ctx.db
        .query("renewalPlans")
        .withIndex("by_task_date", q =>
          q.eq("taskId", SENT.taskId).eq("renewalDate", "2000-01-20"),
        )
        .first();
      const planId = String(plan?._id ?? "");
      const notCeo = await refusal(() =>
        applyEdit(ctx, csm, { kind: "gold", planId, on: true }, o),
      );
      check(
        "gold standard is the CEO's alone",
        notCeo.startsWith("Only the CEO"),
        notCeo,
      );
      const noRecording = await refusal(() =>
        applyEdit(ctx, ceo, { kind: "gold", planId, on: true }, o),
      );
      check(
        "gold standard needs a recording",
        noRecording.includes("recording"),
        noRecording,
      );
      await applyEdit(
        ctx,
        csm,
        {
          kind: "plan",
          taskId: SENT.taskId,
          patch: { callRecordingUrl: "https://example.invalid/self-test" },
        },
        o,
      );
      await applyEdit(ctx, ceo, { kind: "gold", planId, on: true }, o);
      p = await read();
      check(
        "a gold call joins the library",
        p.gold.count === 1 && p.gold.rows[0]?.clientName === SENT.name,
        `${p.gold.count} / ${p.gold.target}`,
      );

      await applyEdit(
        ctx,
        csm,
        { kind: "status", taskId: SENT.taskId, status: "planned" },
        o,
      );
      await applyEdit(
        ctx,
        csm,
        { kind: "plan", taskId: SENT.taskId, patch: { callBookedFor: "" } },
        o,
      );
      const late = await read("2000-01-21");
      check(
        "missed once the date passes while planned",
        late.window.rows[0]?.state === "missed",
        late.window.rows[0]?.state,
      );
      const churn = await missedRenewals(ctx, "2000-01", "2000-01-21");
      check(
        "a missed renewal feeds churn",
        churn.some(m => m.key === SENT.taskId),
      );

      await ctx.db.patch(clientId, { firstWin: true });
      await applyEdit(
        ctx,
        csm,
        {
          kind: "plan",
          taskId: SENT.taskId,
          patch: {
            offer: {
              price: 1500,
              deliverables: "self-test",
              durationMonths: 3,
            },
          },
        },
        o,
      );
      await applyEdit(
        ctx,
        csm,
        { kind: "status", taskId: SENT.taskId, status: "resold" },
        o,
      );
      await ctx.db.patch(plan?._id as Id<"renewalPlans">, { offer: undefined });
      const capped = await refusal(() =>
        applyEdit(
          ctx,
          csm,
          {
            kind: "plan",
            taskId: SENT.taskId,
            patch: { offer: { price: 900 } },
          },
          o,
        ),
      );
      check(
        "one re-sell conversation a month",
        capped.startsWith("One re-sell conversation a month"),
        capped,
      );

      check(
        "a booked call's title never names an upgrade, upsell or renewal",
        !BANNED_TITLE.test(reviewTitle(`${SENT.name} Renewal Upsell Upgrade`)),
      );
      const wrongWeek = await refusal(() =>
        applyEdit(
          ctx,
          csm,
          {
            kind: "projection",
            weekStart: "2000-01-03",
            metric: "cash",
            blood: 1,
            stretch: 2,
          },
          o,
        ),
      );
      check(
        "a week starts on a Sunday",
        wrongWeek.includes("Sunday"),
        wrongWeek,
      );
    } catch (e) {
      check("self-test ran to the end", false, messageOf(e));
    } finally {
      let left = 0;
      for (const r of await ctx.db
        .query("projections")
        .withIndex("by_week", q => q.eq("weekStart", WEEK))
        .collect())
        if (r.byEmail === SENT.email) await ctx.db.delete(r._id);
      for (const r of await ctx.db
        .query("renewalPlans")
        .withIndex("by_task_date", q => q.eq("taskId", SENT.taskId))
        .collect())
        await ctx.db.delete(r._id);
      for (const r of await ctx.db
        .query("decisions")
        .withIndex("by_subject", q => q.eq("subject", SENT.name))
        .collect())
        await ctx.db.delete(r._id);
      for (const r of await ctx.db
        .query("usage")
        .withIndex("by_at")
        .order("desc")
        .take(300))
        if (r.email === SENT.email) await ctx.db.delete(r._id);
      for (const r of await ctx.db
        .query("outbox")
        .withIndex("by_sentAt", q => q.eq("sentAt", undefined))
        .collect())
        if (r.clientTaskId === SENT.taskId) await ctx.db.delete(r._id);
      if (clientId && (await ctx.db.get(clientId)))
        await ctx.db.delete(clientId);
      left += (
        await ctx.db
          .query("renewalPlans")
          .withIndex("by_task_date", q => q.eq("taskId", SENT.taskId))
          .collect()
      ).length;
      left += (
        await ctx.db
          .query("projections")
          .withIndex("by_week", q => q.eq("weekStart", WEEK))
          .collect()
      ).filter(r => r.byEmail === SENT.email).length;
      left += (
        await ctx.db
          .query("decisions")
          .withIndex("by_subject", q => q.eq("subject", SENT.name))
          .collect()
      ).length;
      left += (
        await ctx.db
          .query("clients")
          .withIndex("by_taskId", q => q.eq("taskId", SENT.taskId))
          .collect()
      ).length;
      check("every sentinel row deleted", left === 0, `${left} left`);
    }
    return { ok: checks.every(c => c.ok), checks };
  },
});
