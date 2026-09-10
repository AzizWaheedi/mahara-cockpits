import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { authenticatedMutation, authenticatedQuery } from "./functions";
import { assertRole } from "./roles";

function kuwaitToday(): string {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export const snapshot = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => buildSnapshot(ctx, false),
});

// biome-ignore lint/suspicious/noExplicitAny: payload shape is the screen's
export async function buildSnapshot(
  ctx: QueryCtx,
  smoke: boolean,
): Promise<any> {
  if (!smoke) await assertRole(ctx, "media_buyer");
  const day = kuwaitToday();
  const campaigns = await ctx.db
    .query("campaigns")
    .withIndex("by_rank")
    .collect();
  const ads = await ctx.db.query("ads").collect();
  const metaTree = await ctx.db.query("metaTree").collect();
  const adChanges = await ctx.db.query("adChanges").collect();
  const checks = await ctx.db
    .query("checks")
    .withIndex("by_role_day", q => q.eq("role", "media_buyer").eq("day", day))
    .collect();
  const decisions = await ctx.db
    .query("decisions")
    .withIndex("by_day", q => q.eq("day", day))
    .collect();
  const plan = await ctx.db
    .query("planItems")
    .withIndex("by_role_day", q => q.eq("role", "media_buyer").eq("day", day))
    .collect();
  const inbox = await ctx.db.query("inbox").collect();
  const manualChanges = await ctx.db.query("manualChanges").collect();
  const members = await ctx.db.query("clickupMembers").collect();
  const prefs = await ctx.db.query("clientPrefs").collect();
  const eod = await ctx.db
    .query("eodReports")
    .withIndex("by_role_day", q => q.eq("role", "media_buyer").eq("day", day))
    .first();
  const lastRun = await ctx.db
    .query("syncRuns")
    .withIndex("by_at")
    .order("desc")
    .first();

  const spend7d = campaigns.reduce((s, c) => s + c.spend7d, 0);
  const leads7d = campaigns.reduce((s, c) => s + c.leads7d, 0);
  const clientCampaigns = campaigns.filter(c => !c.internal);
  const clientSpend = clientCampaigns.reduce((s, c) => s + c.spend7d, 0);
  const clientLeads = clientCampaigns.reduce((s, c) => s + c.leads7d, 0);

  return {
    day,
    campaigns,
    ads,
    metaTree,
    adChanges,
    manualChanges,
    members,
    inbox,
    prefs,
    eod,
    checks: checks.sort((a, b) => (a.order ?? 99) - (b.order ?? 99)),
    feedback: await ctx.db
      .query("feedback")
      .withIndex("by_role", q => q.eq("role", "media_buyer"))
      .order("desc")
      .take(20),
    decisions,
    plan,
    lastSyncAt: lastRun?.at ?? null,
    syncProblems: lastRun?.problems ?? [],
    syncHealth: lastRun?.health ?? null,
    totals: {
      spend7d,
      leads7d,
      clientSpend,
      clientLeads,
      blendedCpl: clientLeads > 0 ? clientSpend / clientLeads : null,
      overGate: clientCampaigns.filter(c => c.cpl !== undefined && c.cpl > 15)
        .length,
      underFloor: clientCampaigns.filter(c => c.dayRate < 30 && c.spend7d > 0)
        .length,
      offBoard: clientCampaigns.filter(c => !c.onBoard).length,
    },
  };
}

export const toggleCheck = authenticatedMutation({
  args: { id: v.id("checks") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await assertRole(ctx, "media_buyer");
    const row = await ctx.db.get(id);
    if (!row) return null;
    await ctx.db.patch(id, { done: !row.done, doneAt: Date.now() });
    await ctx.db.insert("usage", {
      role: "media_buyer",
      event: row.done ? "check_untick" : "check_tick",
      detail: row.key,
      at: Date.now(),
    });
    return null;
  },
});

/** She owns the language each client is written to in. Saved, not re-guessed. */
export const setClientLanguage = authenticatedMutation({
  args: { clientName: v.string(), language: v.string() },
  returns: v.null(),
  handler: async (ctx, { clientName, language }) => {
    const row = await ctx.db
      .query("clientPrefs")
      .withIndex("by_client", q => q.eq("clientName", clientName))
      .first();
    if (row) await ctx.db.patch(row._id, { language, updatedAt: Date.now() });
    else
      await ctx.db.insert("clientPrefs", {
        clientName,
        language,
        updatedAt: Date.now(),
      });
    return null;
  },
});

/** Saves the media buyer's EOD into the shared eodReports table. */
export const saveEod = authenticatedMutation({
  args: {
    body: v.string(),
    energy: v.optional(v.string()),
    // biome-ignore lint/suspicious/noExplicitAny: form answers
    answers: v.any(),
    // biome-ignore lint/suspicious/noExplicitAny: computed numbers
    computed: v.any(),
    submit: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { body, energy, answers, computed, submit }) => {
    const day = kuwaitToday();
    const row = await ctx.db
      .query("eodReports")
      .withIndex("by_role_day", q => q.eq("role", "media_buyer").eq("day", day))
      .first();
    const doc = {
      role: "media_buyer",
      day,
      energy,
      computed,
      answers: { ...answers, body },
      at: Date.now(),
    };
    const id = row
      ? (await ctx.db.patch(row._id, doc), row._id)
      : await ctx.db.insert("eodReports", doc);
    // Straight into the sheet and #media-eods, the same as the form would.
    if (submit) {
      await ctx.scheduler.runAfter(0, internal.writeback.submitEod, { id });
    }
    return null;
  },
});

/** Clearing a decision that should never have been logged (a test, a misclick). */
export const removeDecision = authenticatedMutation({
  args: { id: v.id("decisions") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.delete(id);
    return null;
  },
});

export const decide = authenticatedMutation({
  args: {
    subject: v.string(),
    action: v.string(),
    kind: v.string(),
    evidence: v.string(),
    reason: v.optional(v.string()),
    snooze: v.optional(v.string()),
    reroutedTo: v.optional(v.string()),
    metricAtDecision: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertRole(ctx, "media_buyer");
    const id = await ctx.db.insert("decisions", {
      ...args,
      day: kuwaitToday(),
      role: "media_buyer",
      at: Date.now(),
    });
    // Log it to the campaign's ClickUp task so the CSM has the full change history.
    await ctx.scheduler.runAfter(0, internal.writeback.logDecision, { id });
    await ctx.db.insert("usage", {
      role: "media_buyer",
      event: `decision_${args.kind}`,
      detail: args.subject,
      at: Date.now(),
    });
    return null;
  },
});

/**
 * "What did you change?" — the half of the change log Meta cannot see. Goes into the
 * cockpit and onto the client's ClickUp task, so the CSM has the full picture before a
 * check-in call, and so the learning-period rule knows this account was just touched.
 */
export const logManualChange = authenticatedMutation({
  args: {
    campaignName: v.string(),
    adName: v.optional(v.string()),
    what: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertRole(ctx, "media_buyer");
    const id = await ctx.db.insert("manualChanges", {
      ...args,
      by: "Media buyer",
      at: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.writeback.logManualChange, { id });
    await ctx.db.insert("usage", {
      role: "media_buyer",
      event: "manual_change",
      detail: args.campaignName,
      at: Date.now(),
    });
    return null;
  },
});

/**
 * The chat box in the corner. Anything she types — a question, or "this number
 * looks wrong" — lands in Viktor's Slack, tagged with the screen she was on.
 */
export const sendFeedback = authenticatedMutation({
  args: { message: v.string(), page: v.string() },
  returns: v.null(),
  handler: async (ctx, { message, page }) => {
    await assertRole(ctx, "media_buyer");
    const now = new Date();
    const id = await ctx.db.insert("feedback", {
      role: "media_buyer",
      page,
      text: message,
      day: new Date(now.getTime() + 3 * 3600000).toISOString().slice(0, 10),
      at: now.getTime(),
      delivered: false,
    });
    await ctx.scheduler.runAfter(0, internal.writeback.forwardFeedback, { id });
    await ctx.db.insert("usage", {
      role: "media_buyer",
      event: "feedback",
      detail: page,
      at: Date.now(),
    });
    return null;
  },
});

/**
 * A task is missing something only another person can supply. Rather than chasing it in
 * WhatsApp, she asks on the ClickUp task itself and the person is assigned the comment.
 */
export const askForDetail = authenticatedMutation({
  args: {
    taskId: v.string(),
    question: v.string(),
    assignee: v.optional(v.number()),
    assigneeName: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await assertRole(ctx, "media_buyer");
    await ctx.scheduler.runAfter(0, internal.writeback.askOnTask, {
      ...args,
      askedBy: "The media buyer",
    });
    await ctx.db.insert("usage", {
      role: "media_buyer",
      event: "asked_for_detail",
      detail: args.taskId,
      at: Date.now(),
    });
    return null;
  },
});

export const undoDecision = authenticatedMutation({
  args: { id: v.id("decisions") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await assertRole(ctx, "media_buyer");
    await ctx.db.delete(id);
    return null;
  },
});

export const addPlanItems = authenticatedMutation({
  args: {
    items: v.array(
      v.object({
        text: v.string(),
        listName: v.optional(v.string()),
        dueDate: v.optional(v.string()),
        clientName: v.optional(v.string()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { items }) => {
    await assertRole(ctx, "media_buyer");
    const day = kuwaitToday();
    for (const it of items) {
      await ctx.db.insert("planItems", {
        ...it,
        role: "media_buyer",
        day,
        confirmed: false,
        createdAt: Date.now(),
      });
    }
    await ctx.db.insert("usage", {
      role: "media_buyer",
      event: "plan_submitted",
      detail: String(items.length),
      at: Date.now(),
    });
    return null;
  },
});

export const clearPlan = authenticatedMutation({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    await assertRole(ctx, "media_buyer");
    const day = kuwaitToday();
    const rows = await ctx.db
      .query("planItems")
      .withIndex("by_role_day", q => q.eq("role", "media_buyer").eq("day", day))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return null;
  },
});

/**
 * "Build me a campaign." She gives the creative and a line about what she wants;
 * Viktor copies the settings off this client's best ad set and writes the copy.
 * Nothing reaches Meta until she has read it and pressed Launch.
 */
export const requestBuild = authenticatedMutation({
  args: {
    clientTag: v.string(),
    clientName: v.string(),
    accountId: v.string(),
    kind: v.union(v.literal("campaign"), v.literal("refresh")),
    brief: v.string(),
    serviceOther: v.optional(v.string()),
    contextDocs: v.optional(v.string()),
    creativeLinks: v.array(v.string()),
    dailyBudget: v.number(),
    language: v.string(),
  },
  returns: v.id("campaignDrafts"),
  handler: async (ctx, args) => {
    await assertRole(ctx, "media_buyer");
    const id = await ctx.db.insert("campaignDrafts", {
      ...args,
      variants: [],
      status: "building",
      by: "Media buyer",
      at: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.builder.buildDraft, { id });
    await ctx.db.insert("usage", {
      role: "media_buyer",
      event: "request_build",
      detail: args.clientName,
      at: Date.now(),
    });
    return id;
  },
});

/** Her edits to the copy, saved as she types. */
export const saveVariants = authenticatedMutation({
  args: {
    id: v.id("campaignDrafts"),
    variants: v.array(
      v.object({
        headline: v.string(),
        primaryText: v.string(),
        description: v.optional(v.string()),
        approved: v.optional(v.boolean()),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, { id, variants }) => {
    await assertRole(ctx, "media_buyer");
    await ctx.db.patch(id, { variants });
    return null;
  },
});

/** Push it to Meta — paused. */
export const launchBuild = authenticatedMutation({
  args: { id: v.id("campaignDrafts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await assertRole(ctx, "media_buyer");
    await ctx.db.patch(id, { status: "launching", error: undefined });
    await ctx.scheduler.runAfter(0, internal.builder.launchDraft, { id });
    await ctx.db.insert("usage", {
      role: "media_buyer",
      event: "launch_build",
      detail: id,
      at: Date.now(),
    });
    return null;
  },
});

export const discardBuild = authenticatedMutation({
  args: { id: v.id("campaignDrafts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await assertRole(ctx, "media_buyer");
    await ctx.db.delete(id);
    return null;
  },
});

/** A launch is a change: it starts the 3-day learning clock like any other. */
export const recordBuild = internalMutation({
  args: { clientTag: v.string(), clientName: v.string(), what: v.string() },
  returns: v.null(),
  handler: async (ctx, { clientName, what }) => {
    const id = await ctx.db.insert("manualChanges", {
      campaignName: clientName,
      what,
      by: "Built from the cockpit",
      at: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.writeback.logManualChange, { id });
    return null;
  },
});

/** Every build for this client, newest first. */
export const buildsFor = authenticatedQuery({
  args: { clientTag: v.string() },
  returns: v.any(),
  handler: async (ctx, { clientTag }) => {
    await assertRole(ctx, "media_buyer");
    const rows = await ctx.db
      .query("campaignDrafts")
      .withIndex("by_client", q => q.eq("clientTag", clientTag))
      .collect();
    return rows.sort((a, b) => b.at - a.at);
  },
});

/**
 * What is working across every account.
 *
 * She should not have to remember that a hook that worked for a fit-out client in
 * Riyadh might work for one in Kuwait. This ranks every ad we have data on, across
 * all clients, and shows the winners next to the client she is working on — same
 * service line first, because a real estate hook does not transfer to a fit-out.
 */
export const winners = authenticatedQuery({
  args: { serviceType: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { serviceType }) => {
    await assertRole(ctx, "media_buyer");
    const ads = await ctx.db.query("ads").collect();
    const campaigns = await ctx.db.query("campaigns").collect();
    const byCampaign = new Map(campaigns.map(c => [c.campaignName, c]));

    const rows = ads
      .filter(a => a.leads > 0 && a.spend >= 45)
      .map(a => {
        const c = byCampaign.get(a.campaignName);
        return {
          _id: a._id,
          adName: a.adName,
          campaignName: a.campaignName,
          clientName: c?.clientName ?? c?.accountName ?? "",
          serviceType: c?.serviceType,
          thumbnailUrl: a.thumbnailUrl,
          previewSrc: a.previewSrc,
          metaAdId: a.metaAdId,
          spend: a.spend,
          leads: a.leads,
          cpl: a.cpl,
          linkCtr: a.linkCtr,
          cpm: a.cpm,
          optInRate: a.optInRate,
          /** Cost per booking is the client's real number, so it ranks first. */
          costPerBooking: c?.costPerBooking,
          bookingRate: c?.bookingRate,
        };
      })
      .filter(r => (r.cpl ?? 999) <= 15)
      .sort((a, b) => {
        const aKey = a.costPerBooking ?? 9999;
        const bKey = b.costPerBooking ?? 9999;
        if (aKey !== bKey) return aKey - bKey;
        return (a.cpl ?? 999) - (b.cpl ?? 999);
      });

    const sameLine = serviceType
      ? rows.filter(r => r.serviceType === serviceType)
      : [];
    const rest = rows.filter(r => !sameLine.includes(r));
    return { sameLine: sameLine.slice(0, 8), rest: rest.slice(0, 12) };
  },
});

/**
 * Open new-client launches, with the parts Viktor can do already marked.
 *
 * Aziz's ask: she should not have to read a ClickUp task, translate it into ad
 * account work, and tick boxes twice. The launch shows up here as one job.
 */
export const onboardings = authenticatedQuery({
  args: {},
  returns: v.array(
    v.object({
      taskId: v.string(),
      taskUrl: v.optional(v.string()),
      client: v.string(),
      status: v.string(),
      accountId: v.optional(v.string()),
      accountName: v.optional(v.string()),
      accountIdSource: v.optional(v.string()),
      done: v.number(),
      total: v.number(),
      groups: v.array(
        v.object({
          name: v.string(),
          items: v.array(
            v.object({
              name: v.string(),
              done: v.boolean(),
              viktorCanDo: v.boolean(),
            }),
          ),
        }),
      ),
    }),
  ),
  handler: async ctx => {
    // Steps that are ad-account work Viktor can genuinely execute. Anything
    // involving access, billing or a human decision stays hers.
    const CAN_DO = [
      "create leads campaign",
      "create ad set",
      "build ads",
      "create lead form",
      "select the correct lead form",
      "add url parameters",
      "duplicate ads",
    ];
    const rows = await ctx.db.query("onboardings").collect();
    return rows.map(r => {
      let done = 0;
      let total = 0;
      const groups = r.groups.map(g => ({
        name: g.name,
        items: g.items.map(i => {
          total++;
          if (i.done) done++;
          const low = i.name.toLowerCase();
          return {
            name: i.name,
            done: i.done,
            viktorCanDo: CAN_DO.some(c => low.includes(c)),
          };
        }),
      }));
      return {
        taskId: r.taskId,
        taskUrl: r.taskUrl,
        client: r.client,
        status: r.status,
        accountId: r.accountId,
        accountName: r.accountName,
        accountIdSource: r.accountIdSource,
        done,
        total,
        groups,
      };
    });
  },
});

/**
 * The launch watch: every Launching client in the sheet against reality.
 * Read by the launches screen so a stalled onboarding is visible without
 * anyone cross-checking three systems by hand. [aziz, 2026-09-07]
 */
export const launchWatch = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const rows = await ctx.db.query("launchWatch").collect();
    return rows.sort(
      (a, b) =>
        b.issues.length - a.issues.length || a.client.localeCompare(b.client),
    );
  },
});
