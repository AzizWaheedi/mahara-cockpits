import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { QueryCtx } from "./_generated/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { CPL_GATE } from "./constants";
import { authenticatedMutation, authenticatedQuery } from "./functions";
import { scopeFilter } from "./gate";
import { flush } from "./health";
import { allowedClients, assertRole } from "./roles";
import { mirrorCockpitDailyCheck } from "./tools";

function kuwaitToday(): string {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * The working day an end-of-day belongs to: one filed before 04:00 Kuwait is
 * the previous day's (Nada filed Sunday's at 00:46 on Monday, 2026-09-14).
 */
function eodWorkingDay(): string {
  return new Date(Date.now() + 3 * 3600 * 1000 - 4 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
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
  // Client access set in the portal: an empty list means every client.
  const scope = smoke ? null : await allowedClients(ctx);
  const day = kuwaitToday();
  const campaigns = (
    await ctx.db.query("campaigns").withIndex("by_rank").collect()
  ).filter(
    c =>
      !scope ||
      scope.has(String(c.clientName ?? c.accountName ?? "").toLowerCase()),
  );
  // The same access trims everything keyed by campaign, otherwise a member
  // limited to one client still gets every other client's ads, previews and
  // change log in the payload.
  const names = new Set(campaigns.map(c => c.campaignName));
  const mine = (row: { campaignName: string }) =>
    !scope || names.has(row.campaignName);
  const ads = (await ctx.db.query("ads").collect()).filter(mine);
  const metaTree = (await ctx.db.query("metaTree").collect()).filter(mine);
  const adChanges = (await ctx.db.query("adChanges").collect()).filter(mine);
  const checks = await ctx.db
    .query("checks")
    .withIndex("by_role_day", q => q.eq("role", "media_buyer").eq("day", day))
    .collect();
  const decisions = (
    await ctx.db
      .query("decisions")
      .withIndex("by_day", q => q.eq("day", day))
      .collect()
  ).filter(
    d => !scope || names.has(d.subject) || scope.has(d.subject.toLowerCase()),
  );
  const plan = await ctx.db
    .query("planItems")
    .withIndex("by_role_day", q => q.eq("role", "media_buyer").eq("day", day))
    .collect();
  const inbox = await ctx.db.query("inbox").collect();
  const clientLinks = await ctx.db.query("clientLinks").collect();
  // What the latest client card comments said (commentWatch), newest first.
  const clientUpdates = (
    await ctx.db
      .query("clientComments")
      .withIndex("by_status", q =>
        q.eq("status", "done").gte("at", Date.now() - 45 * 86_400_000),
      )
      .collect()
  )
    .filter(r => !scope || scope.has(r.clientName.toLowerCase()))
    .sort((a, b) => b.at - a.at)
    // The media buyer sees only what changes the campaigns: no summary, no
    // contract, payment or revenue lines. [Aziz, 2026-09-14]
    .map(r => ({
      taskId: r.taskId,
      clientName: r.clientName,
      at: r.at,
      kind: r.kind,
      forAds: (Array.isArray(r.digest?.forAds) ? r.digest.forAds : [])
        .map(String)
        .filter(
          (x: string) =>
            !/contract|payment|paid|deposit|invoice|revenue|signed|\bfees?\b/i.test(
              x,
            ),
        ),
    }))
    .filter(u => u.forAds.length);
  const boardCards = (await ctx.db.query("boardCards").collect()).filter(
    c => !scope || scope.has(String(c.tag ?? "").toLowerCase()),
  );
  const offBoardCampaigns = (
    await ctx.db.query("offBoardCampaigns").collect()
  ).filter(
    c =>
      !scope || scope.has(String(c.clientName ?? c.accountName).toLowerCase()),
  );
  const manualChanges = (await ctx.db.query("manualChanges").collect()).filter(
    mine,
  );
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
    offBoardCampaigns,
    clientLinks,
    clientUpdates,
    boardCards,
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
      overGate: clientCampaigns.filter(
        c => c.cpl !== undefined && c.cpl > CPL_GATE,
      ).length,
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
    if (row.role !== "media_buyer") {
      throw new Error(
        `Only media_buyer checks can be toggled in this cockpit (got role: "${row.role}").`,
      );
    }
    const revision = Math.max(Date.now(), (row.shadowRevision ?? 0) + 1);
    const user = await ctx.db.get(ctx.userId);
    const actor = user?.email ?? "media_buyer";
    await ctx.db.patch(id, {
      done: !row.done,
      doneAt: Date.now(),
      shadowRevision: revision,
      shadowActor: actor,
    });
    await ctx.db.insert("usage", {
      role: "media_buyer",
      event: row.done ? "check_untick" : "check_tick",
      detail: row.key,
      at: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.cockpit.shadowDailyCheck, { id });
    return null;
  },
});

export const getCheckForShadow = internalQuery({
  args: { id: v.id("checks") },
  returns: v.any(),
  handler: async (ctx, { id }) => {
    const row = await ctx.db.get(id);
    if (!row) return null;
    if (row.role !== "media_buyer") {
      throw new Error(
        `Non-media-buyer check rejected in shadow query: role="${row.role}".`,
      );
    }
    return row;
  },
});

export const shadowDailyCheck = internalAction({
  args: { id: v.id("checks") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    try {
      const check = await ctx.runQuery(internal.cockpit.getCheckForShadow, {
        id,
      });
      if (!check) return null;
      if (check.role !== "media_buyer") {
        throw new Error(
          `Non-media-buyer check rejected in shadow action: role="${check.role}".`,
        );
      }
      await mirrorCockpitDailyCheck(check);
    } catch (error) {
      console.error(`Shadow daily check failed for ${id}:`, error);
    }
    await flush(ctx);
    return null;
  },
});

/** She owns the language each client is written to in. Saved, not re-guessed. */
export const setClientLanguage = authenticatedMutation({
  args: { clientName: v.string(), language: v.string() },
  returns: v.null(),
  handler: async (ctx, { clientName, language }) => {
    await assertRole(ctx, "media_buyer");
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
    await assertRole(ctx, "media_buyer");
    const day = eodWorkingDay();
    const row = await ctx.db
      .query("eodReports")
      .withIndex("by_role_day", q => q.eq("role", "media_buyer").eq("day", day))
      .first();
    // Once it has gone out, the stored answers must match what Slack and the
    // sheet hold; a second submit would rewrite them without re-posting.
    if (row?.submittedAt) {
      throw new Error("Today's EOD has already been submitted.");
    }
    const doc = {
      role: "media_buyer",
      day,
      energy,
      computed,
      answers: { ...answers, body },
      at: Date.now(),
      attempts: 0,
    };
    const id = row
      ? (await ctx.db.patch(row._id, { ...doc, error: undefined }), row._id)
      : await ctx.db.insert("eodReports", doc);
    // Straight into the sheet and #media-eods, the same as the form would.
    if (submit) {
      await ctx.scheduler.runAfter(0, internal.writeback.submitEod, { id });
    }
    return null;
  },
});

/**
 * Post today's saved EOD again, without touching the answers. For the
 * "saved, still posting" state after a Slack failure or a reload.
 */
export const resubmitEod = authenticatedMutation({
  args: {},
  returns: v.null(),
  handler: async ctx => {
    await assertRole(ctx, "media_buyer");
    const day = kuwaitToday();
    const row = await ctx.db
      .query("eodReports")
      .withIndex("by_role_day", q => q.eq("role", "media_buyer").eq("day", day))
      .first();
    if (!row || row.submittedAt) return null;
    await ctx.db.patch(row._id, { attempts: 0, error: undefined });
    await ctx.scheduler.runAfter(0, internal.writeback.submitEod, {
      id: row._id,
    });
    return null;
  },
});

/** Clearing a decision that should never have been logged (a test, a misclick). */
export const removeDecision = authenticatedMutation({
  args: { id: v.id("decisions") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await assertRole(ctx, "media_buyer");
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
    const user = await ctx.db.get(ctx.userId);
    const now = new Date();
    const id = await ctx.db.insert("feedback", {
      role: "media_buyer",
      page,
      text: message,
      email: user?.email ?? undefined,
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
          // Meta's own picture link (it expires), our saved still (it does
          // not), and the ids the live preview is fetched with.
          thumbnailUrl: a.thumbnailUrl,
          metaAdId: a.metaAdId,
          accountId: c?.metaAccountId,
          stillKey: a.stillKey,
          stillUrl: a.stillUrl,
          stillTinyUrl: a.stillTinyUrl,
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
    await assertRole(ctx, "media_buyer");
    const visible = await scopeFilter(ctx);
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
    const rows = (await ctx.db.query("onboardings").collect()).filter(r =>
      visible({ clientName: r.client }),
    );
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
    await assertRole(ctx, "media_buyer");
    const visible = await scopeFilter(ctx);
    const rows = (await ctx.db.query("launchWatch").collect()).filter(r =>
      visible({ clientName: r.client }),
    );
    return rows.sort(
      (a, b) =>
        b.issues.length - a.issues.length || a.client.localeCompare(b.client),
    );
  },
});

/** One-off: move a saved end-of-day to the working day it belongs to. */
export const setEodDay = internalMutation({
  args: { id: v.id("eodReports"), day: v.string() },
  returns: v.null(),
  handler: async (ctx, { id, day }) => {
    await ctx.db.patch(id, { day });
    return null;
  },
});
