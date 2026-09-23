import { v } from "convex/values";
import { internal } from "./_generated/api";

// biome-ignore lint/suspicious/noExplicitAny: joined rows
type Any = any;

import type { Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { PAUSE_IS_CHURN_DAYS, stateOf } from "./csmSync";
import { authenticatedMutation, authenticatedQuery } from "./functions";
import { allowedClients, assertRole, userEmail } from "./roles";

function kuwaitToday(): string {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

const norm = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase();

/** A client-list restriction from the portal applies to writes as well as the list. */
// biome-ignore lint/suspicious/noExplicitAny: convex ctx
async function assertInScope(ctx: any, clientName: string): Promise<void> {
  const scope = await allowedClients(ctx);
  if (scope && !scope.has(norm(clientName)))
    throw new Error("That client is not on your list.");
}

/** A real calendar day, YYYY-MM-DD; anything else must never reach ClickUp's Next POC. */
export function isIsoDay(v: unknown): boolean {
  const s = String(v ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * The roster client a free-text EOD line refers to, if we can tell. Exact name first,
 * then a name that contains the line or vice versa; two candidates means we do not know.
 */
function matchClient<T extends { name: string }>(
  line: string,
  clients: T[],
): T | undefined {
  const l = norm(line);
  if (!l) return undefined;
  const exact = clients.find(c => norm(c.name) === l);
  if (exact) return exact;
  const loose = clients.filter(c => {
    const n = norm(c.name);
    return n.includes(l) || l.includes(n);
  });
  return loose.length === 1 ? loose[0] : undefined;
}

/**
 * Churn measured from our own daily roster, not from a spreadsheet cell.
 *
 * Denominator: paying clients on the first day of the month we have a roster for.
 * Numerator: those same clients who have since crossed into stopped / cancelled /
 * paused-beyond-14-days, or vanished from the board. Every loss is named and dated, so
 * the number can be argued with facts instead of trusted blindly. `partial` is true when
 * the month's first roster day is not the 1st — early months are honest about that.
 */
// biome-ignore lint/suspicious/noExplicitAny: convex query ctx
async function churnThisMonth(ctx: any, month: string) {
  const days = await ctx.db
    .query("rosterDays")
    .withIndex("by_month", (q: any) => q.eq("month", month))
    .collect();
  if (days.length === 0) return null;
  days.sort((a: any, b: any) => (a.day < b.day ? -1 : 1));
  const first = days[0];
  const latest = days[days.length - 1];
  const baseline = first.clients.filter((c: any) => c.paying);
  const nowByKey = new Map<string, { paying: boolean; status: string }>(
    latest.clients.map((c: any) => [c.key as string, c]),
  );
  const events = await ctx.db
    .query("churnEvents")
    .withIndex("by_month", (q: any) => q.eq("month", month))
    .collect();

  const lost: { key: string; name: string; reason: string; day?: string }[] =
    [];
  const stillPaused: { name: string; days: number | null }[] = [];
  let roster: any[] | undefined;
  for (const b of baseline) {
    const now = nowByKey.get(b.key);
    const event = events
      .filter((e: any) => e.key === b.key && e.kind === "lost")
      .sort((x: any, y: any) => (x.day < y.day ? 1 : -1))[0];
    if (!now) {
      lost.push({
        key: b.key,
        name: b.name,
        reason: "removed from the board",
        day: event?.day,
      });
      continue;
    }
    if (!now.paying) {
      // A pause is not churn on day one. It becomes churn at 14 days, per the company rule.
      // The roster key is the client name; this table has no `key` field and
      // no `by_key` index (the query used to crash the whole start-of-day
      // screen the first time a paused client appeared, 2026-09-10).
      const rows = roster ?? (await ctx.db.query("clients").collect());
      roster = rows;
      const client = rows.find(
        (c: any) => c.name === b.name || c.taskId === b.key,
      );
      const paused = stateOf(now.status) === "paused";
      const pausedDays = (client?.pausedDays ?? client?.pauseDays) as
        | number
        | undefined;
      if (paused && (pausedDays ?? 0) < PAUSE_IS_CHURN_DAYS) {
        stillPaused.push({
          name: b.name,
          days: pausedDays ?? null,
        });
        continue;
      }
      lost.push({
        key: b.key,
        name: b.name,
        reason: paused
          ? `paused ${pausedDays}d — past the 14-day line`
          : now.status,
        day: event?.day,
      });
    }
  }

  // A client the CSM confirmed offboarded counts even if ClickUp still says otherwise.
  // Matched by the ClickUp id when the EOD line resolved to a card, else by name,
  // case-insensitively, so the same client is never counted twice.
  for (const e of events.filter((x: any) => x.kind === "offboarded")) {
    if (lost.some(l => l.key === e.key || norm(l.name) === norm(e.name)))
      continue;
    lost.push({
      key: e.key,
      name: e.name,
      reason: "offboarded (your EOD)",
      day: e.day,
    });
  }
  // One event per client per kind for the month: a line typed on two days is one pause.
  const uniqueKeys = (kinds: string[]) =>
    new Set(
      events.filter((e: any) => kinds.includes(e.kind)).map((e: any) => e.key),
    ).size;

  const pct = baseline.length
    ? Math.round((lost.length / baseline.length) * 1000) / 10
    : null;
  return {
    month,
    pct,
    baselineDay: first.day,
    baseline: baseline.length,
    lost: lost.length,
    lostClients: lost,
    latestDay: latest.day,
    daysTracked: days.length,
    partial: !first.day.endsWith("-01"),
    extensions: uniqueKeys(["extension"]),
    pausedThisMonth: uniqueKeys(["paused", "paused_by_csm"]),
    stillPaused,
  };
}

/**
 * Cheap, public-to-the-app read used by the layout wide sync strip. Kept separate from
 * `snapshot` so every screen can show sync truth without pulling the whole day's payload.
 */
export const syncStatus = authenticatedQuery({
  args: {},
  handler: async ctx => {
    const rows = await ctx.db
      .query("syncRuns")
      .withIndex("by_at")
      .order("desc")
      .take(40);
    const health = rows.find(r => r.kind === "health");
    const feed = rows.find(r => r.role === "csm" && r.kind !== "health");
    return {
      at: health?.at ?? feed?.at ?? null,
      ok: health?.ok ?? true,
      profiles: health?.profiles ?? 0,
      clients: health?.campaigns ?? feed?.campaigns ?? 0,
      errors: health?.errors ?? [],
    };
  },
});

export const snapshot = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => buildSnapshot(ctx, false),
});

/**
 * The start-of-day payload. `smoke` runs it without a signed-in user so the
 * media buyer backend can check every 15 minutes that this screen still
 * renders; a failure reaches Aziz on Slack instead of the CSM's browser.
 */
// biome-ignore lint/suspicious/noExplicitAny: payload shape is the screen's
export async function buildSnapshot(
  ctx: QueryCtx,
  smoke: boolean,
): Promise<any> {
  const day = kuwaitToday();
  // Client access set in the portal: an empty list means every client.
  const scope = smoke ? null : await allowedClients(ctx);
  const clients = await ctx.db.query("clients").withIndex("by_rank").collect();
  const tasks = await ctx.db.query("csTasks").collect();
  const checks = await ctx.db
    .query("checks")
    .withIndex("by_role_day", q => q.eq("role", "csm").eq("day", day))
    .collect();
  const decisions = (
    await ctx.db
      .query("decisions")
      .withIndex("by_day", q => q.eq("day", day))
      .collect()
  ).filter(d => d.role === "csm");
  const plan = await ctx.db
    .query("planItems")
    .withIndex("by_role_day", q => q.eq("role", "csm").eq("day", day))
    .collect();
  const eod = await ctx.db
    .query("eodReports")
    .withIndex("by_role_day", q => q.eq("role", "csm").eq("day", day))
    .first();
  const recentRuns = await ctx.db
    .query("syncRuns")
    .withIndex("by_at")
    .order("desc")
    .take(40);
  const lastRun = recentRuns.find(r => r.role === "csm");
  // The bridge's report card: drives the amber "data may be stale" strip.
  const healthRow = recentRuns.find(r => r.kind === "health");
  const syncHealth = healthRow
    ? {
        at: healthRow.at,
        ok: healthRow.ok,
        profiles: healthRow.profiles ?? 0,
        errors: healthRow.errors ?? [],
      }
    : null;

  const month = day.slice(0, 7);
  const monthDecisions = await ctx.db
    .query("decisions")
    .order("desc")
    .take(400);
  // One upsell / referral / review conversation per client per month, enforced here
  // rather than left to the CSM to remember.
  const hotUsed = new Set(
    monthDecisions
      .filter(
        d => d.role === "csm" && d.day.startsWith(month) && d.kind !== "left",
      )
      .filter(d => /upsell|referral|review/i.test(d.action))
      .map(d => d.subject),
  );

  // Loose ends written off stay written off, except money ones, which cannot be.
  const dismissed = new Set(
    (await ctx.db.query("looseDismissed").collect()).map(d => d.key),
  );
  const prefs = await ctx.db.query("clientPrefs").collect();
  // The client-list restriction covers every per-client row, not only the cards.
  const inScope = (name: unknown) => !scope || scope.has(norm(name));
  const hotRows = (await ctx.db.query("hotList").collect()).filter(r =>
    inScope(r.clientName),
  );
  const kpis = await ctx.db.query("kpi").collect();
  const churn = await churnThisMonth(ctx, month);
  const myEmail = await (smoke ? Promise.resolve("smoke") : userEmail(ctx));
  const money = await ctx.db
    .query("moneyGoals")
    .withIndex("by_month_email", q =>
      q.eq("month", month).eq("byEmail", myEmail),
    )
    .first();

  // Booked client calls from GHL. Past ones stay for two weeks so the CSM can see the
  // call that just happened and whether the notes went in.
  const appointments = (await ctx.db.query("appointments").collect())
    .filter(a => !scope || (a.clientName && inScope(a.clientName)))
    .sort((a, b) => a.startTime.localeCompare(b.startTime));

  return {
    day,
    month,
    appointments,
    todaysCalls: appointments.filter(
      a => a.day === day && a.status !== "cancelled",
    ),
    prefs,
    hotRows,
    kpis,
    churn,
    money,
    clients: clients
      .filter(c => inScope(c.name))
      .map(c => ({
        ...c,
        hotBlocked: hotUsed.has(c.name),
        loose: c.loose.filter(
          (t: string) => !dismissed.has(`${c.name}|${t}`) || isMoneyLoose(t),
        ),
      })),
    tasks,
    checks: checks.sort((a, b) => a.key.localeCompare(b.key)),
    decisions,
    plan,
    eod,
    lastSyncAt: lastRun?.at ?? null,
    syncHealth,
    totals: {
      clients: clients.length,
      dueToday: clients.filter(c => c.rank < 40 && c.level !== "green").length,
      newSignups: clients.filter(c => c.newSignup).length,
      pauses: clients.filter(c => c.pauseRequired).length,
      onboarding: clients.filter(c => c.bucket === "onboarding").length,
      managed: clients.filter(c => c.bucket === "management").length,
      pastDue: clients.filter(c => (c.paymentDue ?? -99) >= 1).length,
      hot: clients.filter(c => c.hot.length > 0 && !hotUsed.has(c.name)).length,
      loose: clients.reduce(
        (s, c) =>
          s +
          c.loose.filter(
            (t: string) => !dismissed.has(`${c.name}|${t}`) || isMoneyLoose(t),
          ).length,
        0,
      ),
      healthy: clients.filter(c => c.level === "green").length,
    },
  };
}

/** Anything about money is never dismissible. */
export function isMoneyLoose(text: string): boolean {
  return /invoice|payment|past due|billing|pause|refund|card/i.test(text ?? "");
}

/**
 * Clear the loose ends that piled up before there was a system.
 *
 * Money is excluded by design: an unpaid invoice or an unfiled pause survives the reset,
 * because those are the ones that cost real money when they are forgotten. Everything
 * cleared is recorded with who cleared it and when, so this is a decision, not a delete.
 */
export const clearLooseEnds = authenticatedMutation({
  args: { clientName: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await assertRole(ctx, "csm");
    const email = (await userEmail(ctx)) ?? "csm";
    const scope = await allowedClients(ctx);
    const clients = await ctx.db.query("clients").collect();
    let cleared = 0;
    let kept = 0;
    for (const c of clients) {
      if (args.clientName && c.name !== args.clientName) continue;
      if (scope && !scope.has(norm(c.name))) continue;
      for (const text of c.loose) {
        if (isMoneyLoose(text)) {
          kept += 1;
          continue;
        }
        const key = `${c.name}|${text}`;
        const existing = await ctx.db
          .query("looseDismissed")
          .withIndex("by_key", q => q.eq("key", key))
          .first();
        if (existing) continue;
        await ctx.db.insert("looseDismissed", {
          key,
          clientName: c.name,
          text,
          at: Date.now(),
          by: email,
        });
        cleared += 1;
      }
    }
    return { cleared, kept };
  },
});

export const toggleCheck = authenticatedMutation({
  args: { id: v.id("checks") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await assertRole(ctx, "csm");
    const row = await ctx.db.get(id);
    if (!row) return null;
    await ctx.db.patch(id, { done: !row.done, doneAt: Date.now() });
    return null;
  },
});

/**
 * Everything the CSM does to a client goes through here: a touchpoint, a call
 * summary, a stage change, a happiness rating, a booked next contact, an upsell
 * conversation, a ticket for another team. Taking the action IS the logging —
 * the writeback puts it on the client's ClickUp task.
 */
export const act = authenticatedMutation({
  args: {
    clientId: v.id("clients"),
    /** The ClickUp id: survives the sync replacing every client row. */
    taskId: v.optional(v.string()),
    action: v.string(),
    kind: v.string(), // touchpoint | call | report | stage | happiness | booked | upsell | ticket | left
    note: v.optional(v.string()),
    reason: v.optional(v.string()),
    snooze: v.optional(v.string()),
    value: v.optional(v.string()), // new stage, happiness label, or booked date
    department: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertRole(ctx, "csm");
    // The sync deletes and re-inserts every row, so a click that lands during
    // a refresh carries a dead id; the ClickUp id still finds the client.
    const client =
      (await ctx.db.get(args.clientId)) ??
      (args.taskId
        ? await ctx.db
            .query("clients")
            .withIndex("by_taskId", q => q.eq("taskId", String(args.taskId)))
            .first()
        : null);
    if (!client)
      throw new Error("That client row was just refreshed, open it again.");
    await assertInScope(ctx, client.name);
    if (args.kind === "booked" && args.value && !isIsoDay(args.value))
      throw new Error("Pick a date (YYYY-MM-DD) for the next call.");
    const id = await ctx.db.insert("decisions", {
      day: kuwaitToday(),
      role: "csm",
      subject: client.name,
      action: args.action,
      kind:
        args.kind === "left"
          ? "left"
          : args.department
            ? "rerouted"
            : "approved",
      reason: args.note ?? args.reason,
      snooze: args.snooze,
      reroutedTo: args.department,
      evidence: client.todo,
      clickupTaskId: client.taskId,
      at: Date.now(),
    });
    await ctx.db.insert("outbox", {
      kind: args.kind,
      clientTaskId: client.taskId,
      clientName: client.name,
      action: args.action,
      evidence: client.todo,
      note: args.note ?? args.reason,
      snooze: args.snooze,
      value: args.value,
      department: args.department,
      decisionId: id,
      createdAt: Date.now(),
    });
    await ctx.db.insert("usage", {
      role: "csm",
      event: `csm_${args.kind}`,
      detail: client.name,
      at: Date.now(),
    });
    // Optimistic local update so the row moves off the screen immediately.
    const today = kuwaitToday();
    if (args.kind === "touchpoint" || args.kind === "call") {
      await ctx.db.patch(client._id, {
        lastPoc: today,
        silentDays: 0,
        ...(args.kind === "call" ? { lastCall: today, callDays: 0 } : {}),
        todo: args.kind === "call" ? "Call logged today" : "Messaged today",
        level: "green",
        rank: 50,
      });
    } else if (args.kind === "report") {
      await ctx.db.patch(client._id, {
        lastReport: today,
        reportDays: 0,
        reportDue: false,
      });
    } else if (args.kind === "booked" && args.value) {
      await ctx.db.patch(client._id, {
        nextPoc: args.value,
        todo: `Booked ${args.value}`,
        level: "blue",
        rank: 40,
      });
    } else if (args.kind === "stage" && args.value) {
      await ctx.db.patch(client._id, { stage: args.value });
    } else if (args.kind === "service" && args.value) {
      // Optimistic local echo. ClickUp's Service field is the source of truth and the
      // bridge writes it there on the next pass.
      await ctx.db.patch(client._id, {
        service: args.value,
        dwy: /dwy/i.test(args.value),
      });
    } else if (args.kind === "happiness" && args.value) {
      await ctx.db.patch(client._id, { happiness: args.value });
    } else if (args.kind === "left") {
      await ctx.db.patch(client._id, {
        level: "blue",
        rank: 45,
        todo: `Left: ${args.reason ?? "no reason"}`,
      });
    }
    return null;
  },
});

/**
 * Anyone in a cockpit can say "this is wrong" from the screen itself. It lands as a
 * Viktor task on Client Success so the fix is owned, not lost in a DM.
 */
/**
 * Replaces the Account Manager EOD Typeform rather than adding a second habit: the
 * countable answers are already known from the day's activity, so only the human
 * judgement fields are typed.
 */
export const submitEod = authenticatedMutation({
  args: {
    energy: v.optional(v.string()),
    stress: v.optional(v.string()),
    answers: v.any(),
    computed: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const user = await ctx.db.get(ctx.userId);
    const day = kuwaitToday();
    const existing = await ctx.db
      .query("eodReports")
      .withIndex("by_role_day", q => q.eq("role", "csm").eq("day", day))
      .first();
    const row = {
      role: "csm",
      day,
      email: user?.email ?? undefined,
      energy: args.energy,
      stress: args.stress,
      answers: args.answers,
      computed: args.computed,
      at: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("eodReports", row);

    // And out to Slack and the EOD sheet. Saving it here was never
    // enough: the tracking sheet is built from what EOD Radar sees in
    // the channels, so an EOD that stays in Convex is one nobody filed.
    await ctx.scheduler.runAfter(0, internal.eodOut.send, {
      day,
      answers: args.answers,
      computed: args.computed,
      email: row.email,
    });

    // The three churn-ledger answers become dated events, so the churn number is built
    // from what he confirmed rather than only from a status field somebody may forget.
    // Each line is matched to a roster card so the event carries the ClickUp id and
    // the card's name; one event per client per kind per month, whatever day it was typed.
    const ledger: [string, string][] = [
      ["offboarded", "offboarded"],
      ["extended", "extension"],
      ["paused", "paused_by_csm"],
    ];
    const roster = await ctx.db.query("clients").collect();
    const already = await ctx.db
      .query("churnEvents")
      .withIndex("by_month", q => q.eq("month", day.slice(0, 7)))
      .collect();
    for (const [field, kind] of ledger) {
      const raw = String(args.answers?.[field] ?? "");
      for (const line of raw
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean)) {
        const match = matchClient(line, roster);
        const key = match ? match.taskId : `eod:${line}`;
        const name = match ? match.name : line;
        if (
          already.some(
            e =>
              e.kind === kind && (e.key === key || norm(e.name) === norm(name)),
          )
        )
          continue;
        const ev = {
          day,
          month: day.slice(0, 7),
          key,
          name,
          from: "reported by the CSM at end of day",
          to: kind,
          kind,
          at: Date.now(),
        };
        await ctx.db.insert("churnEvents", ev);
        already.push({ ...ev, _id: "" as Id<"churnEvents">, _creationTime: 0 });
      }
    }
    return null;
  },
});

export const reportIssue = authenticatedMutation({
  args: { page: v.string(), text: v.string() },
  returns: v.null(),
  handler: async (ctx, { page, text }) => {
    const user = await ctx.db.get(ctx.userId);
    const id = await ctx.db.insert("feedback", {
      role: "csm",
      page,
      text,
      email: user?.email ?? undefined,
      day: kuwaitToday(),
      at: Date.now(),
    });
    await ctx.db.insert("outbox", {
      kind: "issue",
      clientTaskId: "",
      clientName: "",
      action: text,
      evidence: `Reported from the ${page} screen by ${user?.email ?? "unknown"}.`,
      feedbackId: id,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const addPlanItems = authenticatedMutation({
  args: {
    items: v.array(
      v.object({
        text: v.string(),
        clientName: v.optional(v.string()),
        dueDate: v.optional(v.string()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { items }) => {
    await assertRole(ctx, "csm");
    const day = kuwaitToday();
    for (const it of items) {
      const planId = await ctx.db.insert("planItems", {
        ...it,
        role: "csm",
        day,
        listName: "Client Success",
        confirmed: false,
        createdAt: Date.now(),
      });
      await ctx.db.insert("outbox", {
        kind: "plan_task",
        clientTaskId: "",
        clientName: it.clientName ?? "",
        action: it.text,
        evidence: "Planned in the end-of-day.",
        planItemId: planId,
        createdAt: Date.now(),
      });
    }
    return null;
  },
});

/** Which language she writes to this client in. Her choice outlives every sync. */
export const setClientLanguage = authenticatedMutation({
  args: { clientName: v.string(), language: v.string() },
  returns: v.null(),
  handler: async (ctx, { clientName, language }) => {
    await assertRole(ctx, "csm");
    await assertInScope(ctx, clientName);
    const row = await ctx.db
      .query("clientPrefs")
      .withIndex("by_client", q => q.eq("clientName", clientName))
      .first();
    if (row) await ctx.db.patch(row._id, { language });
    else await ctx.db.insert("clientPrefs", { clientName, language });
    return null;
  },
});

/**
 * One hot-list row — the same columns as the old CSM Hot List sheet, so the sheet
 * stops being a second source of truth.
 */
export const saveHotRow = authenticatedMutation({
  args: {
    key: v.string(),
    clientName: v.string(),
    type: v.string(),
    leadType: v.optional(v.string()),
    status: v.optional(v.string()),
    lastObjection: v.optional(v.string()),
    contactUrl: v.optional(v.string()),
    amount: v.optional(v.string()),
    lastFu: v.optional(v.string()),
    nextFu: v.optional(v.string()),
    notes: v.optional(v.string()),
    manual: v.optional(v.boolean()),
    hidden: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertRole(ctx, "csm");
    await assertInScope(ctx, args.clientName);
    const existing = await ctx.db
      .query("hotList")
      .withIndex("by_key", q => q.eq("key", args.key))
      .first();
    if (existing) await ctx.db.patch(existing._id, { ...args, at: Date.now() });
    else await ctx.db.insert("hotList", { ...args, at: Date.now() });
    return null;
  },
});

/**
 * The CSM's own income plan. Payout rates live in the frontend (they come from the
 * Pay Structure doc); this only stores his target and what he has actually closed.
 */
export const saveMoneyGoals = authenticatedMutation({
  args: {
    month: v.string(),
    target: v.optional(v.number()),
    clients: v.optional(v.number()),
    counts: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertRole(ctx, "csm");
    const byEmail = await userEmail(ctx);
    const existing = await ctx.db
      .query("moneyGoals")
      .withIndex("by_month_email", q =>
        q.eq("month", args.month).eq("byEmail", byEmail),
      )
      .first();
    if (existing) await ctx.db.patch(existing._id, { ...args, at: Date.now() });
    else
      await ctx.db.insert("moneyGoals", { ...args, byEmail, at: Date.now() });
    return null;
  },
});

/**
 * The client performance screen. Two queries on purpose: a light list for the overview
 * grid, and the full profile only for the client actually opened — the Meta preview
 * tree per client is far too heavy to ship for all 46 at once.
 */
export const performanceOverview = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => buildPerformanceOverview(ctx, false),
});

/** The overview grid; `smoke` runs it without a user for the 15-minute check. */
export async function buildPerformanceOverview(
  ctx: QueryCtx,
  smoke: boolean,
): Promise<Any> {
  {
    if (!smoke) await assertRole(ctx, "csm");
    // Client access set in the portal: an empty list means every client.
    const scope = smoke ? null : await allowedClients(ctx);
    const rows = (await ctx.db.query("clientProfiles").collect()).filter(
      r => !scope || scope.has(r.clientName.toLowerCase()),
    );
    // The media buyer sync already sorts every card into management,
    // onboarding or inactive from its ClickUp stage; that is the one place
    // the rule lives. The stage regex below is only the fallback for a
    // profile with no client row.
    const byName = new Map<string, { bucket?: string; stage?: string }>();
    for (const c of await ctx.db.query("clients").collect())
      byName.set(String(c.name ?? "").toLowerCase(), {
        bucket: (c as Any).bucket,
        stage: (c as Any).stage,
      });
    // Active, onboarding, paused or churned: the same rule for the table and
    // the charts, so a tab filters both. [Aziz, 2026-09-14]
    const groupOf = (r: Any): string => {
      const cl = byName.get(String(r.clientName).toLowerCase());
      const stage = String(r.stage ?? cl?.stage ?? "");
      return cl?.bucket === "onboarding"
        ? "onboarding"
        : cl?.bucket === "management"
          ? "active"
          : cl?.bucket === "inactive"
            ? /pause|freeze|hold/i.test(stage)
              ? "paused"
              : "churned"
            : /contact|booked|ready for launch|ghosted|delay|blueprint/i.test(
                  stage,
                )
              ? "onboarding"
              : /pause|freeze|hold/i.test(stage)
                ? "paused"
                : /stop|cancel|churn|offboard|lost/i.test(stage)
                  ? "churned"
                  : "active";
    };
    // Trends across the book: leads and spend per day from the ads, booked
    // and show rate per week from the sheets, last 90 days.
    const since = new Date(Date.now() - 90 * 86400_000)
      .toISOString()
      .slice(0, 10);
    const byDate = new Map<string, { leads: number; spend: number }>();
    const byWeek = new Map<
      string,
      { booked: number; shows: number; noshows: number }
    >();
    const weekOf = (d: string) => {
      const t = new Date(`${d.slice(0, 10)}T00:00:00Z`);
      t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
      return t.toISOString().slice(0, 10);
    };
    const byDateG = new Map<string, typeof byDate>();
    const byWeekG = new Map<string, typeof byWeek>();
    for (const r of rows) {
      const g = groupOf(r);
      const dates = byDateG.get(g) ?? new Map();
      byDateG.set(g, dates);
      const weeks = byWeekG.get(g) ?? new Map();
      byWeekG.set(g, weeks);
      for (const d of ((r.adLeads as Any)?.daily ?? []) as Any[]) {
        if (d.date < since) continue;
        for (const m of [byDate, dates]) {
          const row = m.get(d.date) ?? { leads: 0, spend: 0 };
          row.leads += Number(d.leads ?? 0);
          row.spend += Number(d.spend ?? 0);
          m.set(d.date, row);
        }
      }
      for (const a of ((r.performance as Any)?.appointments ?? []) as Any[]) {
        const day = a.added ? String(a.added).slice(0, 10) : "";
        if (!day || day < since) continue;
        for (const m of [byWeek, weeks]) {
          const w = m.get(weekOf(day)) ?? {
            booked: 0,
            shows: 0,
            noshows: 0,
          };
          if (a.booked) w.booked++;
          if (a.show === "y") w.shows++;
          if (a.show === "n") w.noshows++;
          m.set(weekOf(day), w);
        }
      }
    }
    const toTrend = (m: typeof byDate) =>
      [...m.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([date, r]) => ({
          date,
          leads: r.leads,
          spend: Math.round(r.spend * 100) / 100,
          cpl: r.leads ? Math.round((r.spend / r.leads) * 100) / 100 : null,
        }));
    const trend = toTrend(byDate);
    const toWeekly = (m: typeof byWeek) =>
      [...m.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([week, w]) => ({
          week,
          booked: w.booked,
          showRate:
            w.shows + w.noshows
              ? Math.round((100 * w.shows) / (w.shows + w.noshows))
              : null,
        }));
    const weeklyOutcomes = toWeekly(byWeek);
    const groups = ["active", "onboarding", "paused"];
    return {
      trend,
      weeklyOutcomes,
      trendByGroup: Object.fromEntries(
        groups.map(g => [g, toTrend(byDateG.get(g) ?? new Map())]),
      ),
      weeklyByGroup: Object.fromEntries(
        groups.map(g => [g, toWeekly(byWeekG.get(g) ?? new Map())]),
      ),
      syncedAt: Math.max(0, ...rows.map(r => r.syncedAt)),
      clients: rows
        .map(r => {
          const cl = byName.get(String(r.clientName).toLowerCase());
          const group = groupOf(r);
          const perf = r.performance as
            | {
                month?: Record<string, number>;
                lastMonth?: Record<string, number>;
                staleCount?: number;
                error?: string;
                source?: string;
              }
            | undefined;
          return {
            clientName: r.clientName,
            stage: r.stage ?? cl?.stage,
            group,
            happiness: r.happiness,
            liveDays: r.liveDays,
            service: r.service,
            hasSheet: Boolean((r.links as Record<string, string>)?.sheet),
            month: perf?.month ?? null,
            lastMonth: perf?.lastMonth ?? null,
            staleCount: perf?.staleCount ?? 0,
            sheetError: perf?.error,
            live: r.live ?? null,
            adsAccess: r.adsAccess ?? null,
            // Whose weekly report reminder is still sitting unapproved in #csm-general.
            reportNudge: r.reportNudge ?? null,
            links: r.links ?? {},
          };
        })
        .sort((a, b) => (b.staleCount ?? 0) - (a.staleCount ?? 0)),
    };
  }
}

export const clientProfile = authenticatedQuery({
  args: { clientName: v.string() },
  returns: v.any(),
  handler: async (ctx, args) => buildClientProfile(ctx, args, false),
});

/** One client's full profile; `smoke` runs it without a user for the 15-minute check. */
export async function buildClientProfile(
  ctx: QueryCtx,
  args: { clientName: string },
  smoke: boolean,
): Promise<Any> {
  {
    if (!smoke) await assertRole(ctx, "csm");
    const scope = smoke ? null : await allowedClients(ctx);
    if (scope && !scope.has(args.clientName.toLowerCase())) return null;
    const p = await ctx.db
      .query("clientProfiles")
      .withIndex("by_client", q => q.eq("clientName", args.clientName))
      .first();
    if (!p) return null;
    // The board row carries the relationship clocks (last contact, last call, last
    // report) that the sheet knows nothing about. Diagnosis needs both halves.
    const row = (await ctx.db.query("clients").collect()).find(
      c => c.name === args.clientName,
    );
    const reports = await ctx.db
      .query("reportDocs")
      .withIndex("by_client", q => q.eq("clientName", args.clientName))
      .collect();
    reports.sort((a, b) => b.requestedAt - a.requestedAt);
    const prefs = await ctx.db
      .query("clientPrefs")
      .withIndex("by_client", q => q.eq("clientName", args.clientName))
      .first();
    return {
      ...p,
      stage: p.stage ?? row?.stage,
      happiness: p.happiness ?? row?.happiness,
      liveDays: p.liveDays ?? row?.liveDays,
      pocDays: row?.silentDays,
      callDays: row?.callDays,
      reportDays: row?.reportDays,
      reportTracked: row?.reportTracked,
      csmAssigned: row?.csmAssigned,
      language: prefs?.language ?? "en",
      reports: reports.slice(0, 5),
    };
  }
}

/**
 * Report an issue to write this client's report as an editable Google Doc.
 *
 * The app has no Google access of its own, so this queues the request; Viktor's job (every
 * 15 minutes on working hours) writes the doc, shares it with the team and writes the link
 * back. Re-requesting the same client and month replaces the pending request rather than
 * queueing a second one.
 */
export const requestReportDoc = authenticatedMutation({
  args: {
    clientName: v.string(),
    month: v.optional(v.string()),
    language: v.optional(v.string()),
    note: v.optional(v.string()),
    extras: v.optional(v.array(v.string())),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await assertRole(ctx, "csm");
    await assertInScope(ctx, args.clientName);
    const month = args.month ?? kuwaitToday().slice(0, 7);
    const existing = await ctx.db
      .query("reportDocs")
      .withIndex("by_client", q => q.eq("clientName", args.clientName))
      .collect();
    const pending = existing.find(r => r.month === month && !r.builtAt);
    if (pending) {
      await ctx.db.patch(pending._id, {
        note: args.note,
        language: args.language,
        extras: args.extras,
        requestedAt: Date.now(),
        error: undefined,
      });
      return { status: "queued", id: pending._id };
    }
    const id = await ctx.db.insert("reportDocs", {
      clientName: args.clientName,
      month,
      language: args.language,
      note: args.note,
      extras: args.extras,
      requestedBy: (await userEmail(ctx)) ?? "csm",
      requestedAt: Date.now(),
    });
    return { status: "queued", id };
  },
});

/** Questions for the assistant. Answered by Viktor on the next sync, with the SOP in hand. */
export const askViktor = authenticatedMutation({
  args: { question: v.string(), clientName: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await assertRole(ctx, "csm");
    if (args.clientName) await assertInScope(ctx, args.clientName);
    const question = args.question.trim();
    if (!question) return { status: "empty" };
    const id = await ctx.db.insert("asks", {
      question,
      clientName: args.clientName,
      askedBy: (await userEmail(ctx)) ?? "csm",
      askedAt: Date.now(),
    });
    return { status: "queued", id };
  },
});

export const myAsks = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await assertRole(ctx, "csm");
    // Everyone's questions for an unrestricted seat; only their own for a scoped one.
    const scope = await allowedClients(ctx);
    const me = scope ? await userEmail(ctx) : null;
    const rows = await ctx.db
      .query("asks")
      .withIndex("by_askedAt")
      .order("desc")
      .take(scope ? 100 : 20);
    return me ? rows.filter(r => r.askedBy === me).slice(0, 20) : rows;
  },
});

/**
 * A task for this client, for me or for another team. Lands on the chosen
 * ClickUp list within five minutes, tagged with the client so every board
 * attributes it. Aziz, 2026-09-12.
 */
export const addTask = authenticatedMutation({
  args: {
    taskId: v.string(),
    clientName: v.string(),
    title: v.string(),
    note: v.optional(v.string()),
    /** creative | tech | call_center | media_buyer, or empty for my own list. */
    department: v.optional(v.string()),
    due: v.optional(v.number()),
  },
  returns: v.id("outbox"),
  handler: async (ctx, args) => {
    await assertRole(ctx, "csm");
    await assertInScope(ctx, args.clientName);
    const by = await userEmail(ctx);
    return await ctx.db.insert("outbox", {
      kind: "task",
      clientTaskId: args.taskId,
      clientName: args.clientName,
      action: args.title.trim().slice(0, 140),
      evidence: [
        `Added by ${by} from the Client Success Cockpit.`,
        args.note ? `\n${args.note.trim()}` : "",
        `\nClient task: https://app.clickup.com/t/${args.taskId}`,
      ]
        .join("")
        .trim(),
      department: args.department || undefined,
      due: args.due,
      createdAt: Date.now(),
    });
  },
});

/** Tasks added from this client's page, newest first, with where they landed. */
export const tasksAdded = authenticatedQuery({
  args: { taskId: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, { taskId }) => {
    await assertRole(ctx, "csm");
    return (await ctx.db.query("outbox").collect())
      .filter(o => o.clientTaskId === taskId && o.kind === "task")
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 8)
      .map(o => ({
        id: o._id,
        title: o.action,
        department: o.department ?? null,
        due: o.due ?? null,
        sent: Boolean(o.sentAt && !o.error),
        error: o.error ?? null,
        url: o.resultUrl ?? null,
        at: o.createdAt,
      }));
  },
});
