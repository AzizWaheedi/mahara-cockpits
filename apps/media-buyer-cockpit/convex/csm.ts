import { v } from "convex/values";
import { internal } from "./_generated/api";
import { authenticatedMutation, authenticatedQuery } from "./functions";
import { assertRole } from "./roles";

function kuwaitToday(): string {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export const snapshot = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await assertRole(ctx, "csm");
    const day = kuwaitToday();
    const clients = await ctx.db
      .query("clients")
      .withIndex("by_rank")
      .collect();
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
    const promises = await ctx.db.query("promises").collect();
    const eod = await ctx.db
      .query("eodReports")
      .withIndex("by_role_day", q => q.eq("role", "csm").eq("day", day))
      .first();
    const lastRun = (
      await ctx.db.query("syncRuns").withIndex("by_at").order("desc").take(20)
    ).find(r => r.role === "csm");

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

    return {
      day,
      clients: clients.map(c => ({ ...c, hotBlocked: hotUsed.has(c.name) })),
      tasks,
      checks: checks.sort((a, b) => a.key.localeCompare(b.key)),
      decisions,
      plan,
      promises: promises.filter(p => !p.clearedAt),
      eod,
      lastSyncAt: lastRun?.at ?? null,
      totals: {
        clients: clients.length,
        dueToday: clients.filter(c => c.rank < 40 && c.level !== "green")
          .length,
        newSignups: clients.filter(c => c.newSignup).length,
        pauses: clients.filter(c => c.pauseRequired).length,
        onboarding: clients.filter(c => c.bucket === "onboarding").length,
        managed: clients.filter(c => c.bucket === "management").length,
        pastDue: clients.filter(c => (c.paymentDue ?? -99) >= 1).length,
        hot: clients.filter(c => c.hot.length > 0 && !hotUsed.has(c.name))
          .length,
        loose: clients.reduce((s, c) => s + c.loose.length, 0),
        healthy: clients.filter(c => c.level === "green").length,
      },
    };
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
    action: v.string(),
    kind: v.string(), // touchpoint | call | stage | happiness | booked | upsell | ticket | left
    note: v.optional(v.string()),
    reason: v.optional(v.string()),
    snooze: v.optional(v.string()),
    value: v.optional(v.string()), // new stage, happiness label, or booked date
    department: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertRole(ctx, "csm");
    const client = await ctx.db.get(args.clientId);
    if (!client) return null;
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
    await ctx.scheduler.runAfter(0, internal.csmWriteback.apply, {
      decisionId: id,
      clientTaskId: client.taskId,
      clientName: client.name,
      kind: args.kind,
      value: args.value,
      department: args.department,
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
    } else if (args.kind === "booked" && args.value) {
      await ctx.db.patch(client._id, {
        nextPoc: args.value,
        todo: `Booked ${args.value}`,
        level: "blue",
        rank: 40,
      });
    } else if (args.kind === "stage" && args.value) {
      await ctx.db.patch(client._id, { stage: args.value });
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
    await assertRole(ctx, "csm");
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
    return null;
  },
});

export const reportIssue = authenticatedMutation({
  args: { page: v.string(), text: v.string() },
  returns: v.null(),
  handler: async (ctx, { page, text }) => {
    await assertRole(ctx, "csm");
    const user = await ctx.db.get(ctx.userId);
    const id = await ctx.db.insert("feedback", {
      role: "csm",
      page,
      text,
      email: user?.email ?? undefined,
      day: kuwaitToday(),
      at: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.csmWriteback.fileIssue, { id });
    return null;
  },
});

export const clearPromise = authenticatedMutation({
  args: { id: v.id("promises") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await assertRole(ctx, "csm");
    await ctx.db.patch(id, { clearedAt: Date.now() });
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
      const id = await ctx.db.insert("planItems", {
        ...it,
        role: "csm",
        day,
        listName: "Client Success",
        confirmed: false,
        createdAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.csmWriteback.createPlanTask, {
        id,
      });
    }
    return null;
  },
});
