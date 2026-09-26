import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import {
  batchBrief,
  batchKey,
  batchTitle,
  cycleDates,
  nextCreativeCycle,
} from "./creativeCadenceLogic";
import { authenticatedMutation, authenticatedQuery } from "./functions";
import { allowedClients, assertRole, inScope, userEmail } from "./roles";

const active = (status?: string) =>
  (status ?? "").trim().toLowerCase() === "active";
const norm = (text?: string) => (text ?? "").trim().toLowerCase();

type Client = { taskId: string; name: string; clientStatus?: string };
type Campaign = { clientName?: string; clientTag?: string };

function hasExactCampaign(client: Client, campaigns: Campaign[]): boolean {
  return campaigns.some(
    campaign =>
      norm(campaign.clientName) === norm(client.name) ||
      norm(campaign.clientTag) === norm(client.name),
  );
}

async function enqueueBatch(
  ctx: MutationCtx,
  client: Client,
  cycle: string,
  by: string,
): Promise<boolean> {
  const key = batchKey(client.taskId, cycle);
  const title = batchTitle(client.name, cycle);
  const queued = await ctx.db
    .query("creativeOutbox")
    .withIndex("by_cadence_key", q => q.eq("cadenceKey", key))
    .first();
  if (queued) return false;
  // Also respect a task that was already created on the board and synced.
  const onBoard = (await ctx.db.query("creativeTasks").collect()).some(
    task => task.name === title,
  );
  if (onBoard) return false;
  await ctx.db.insert("creativeOutbox", {
    kind: "planCreativeBatch",
    cadenceKey: key,
    payload: {
      client: client.name,
      clientTaskId: client.taskId,
      due: cycle,
      title,
      brief: batchBrief(client.name, cycle, key),
      key,
    },
    state: "pending",
    by,
    createdAt: Date.now(),
  });
  return true;
}

/** The next cycle and real ClickUp/outbox state, scoped to the signed-in director. */
export const preview = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await assertRole(ctx, "creative");
    const scope = await allowedClients(ctx);
    const cycle = nextCreativeCycle(Date.now());
    const clients = (await ctx.db.query("clients").collect()).filter(
      client => active(client.clientStatus) && inScope(scope, client.name),
    );
    const campaigns = await ctx.db.query("campaigns").collect();
    const prefs = await ctx.db.query("creativeCadencePrefs").collect();
    const outbox = await ctx.db.query("creativeOutbox").collect();
    const tasks = await ctx.db.query("creativeTasks").collect();
    return {
      cycle,
      ...cycleDates(cycle),
      clients: clients
        .map(client => {
          const key = batchKey(client.taskId, cycle);
          const queued = outbox.find(row => row.cadenceKey === key);
          const board = tasks.find(
            row => row.name === batchTitle(client.name, cycle),
          );
          return {
            taskId: client.taskId,
            name: client.name,
            hasCampaign: hasExactCampaign(client, campaigns),
            autoPlan:
              prefs.find(row => row.clientTaskId === client.taskId)?.autoPlan ??
              false,
            state: board ? "on board" : (queued?.state ?? "not planned"),
            taskUrl: board?.url ?? null,
            error: queued?.state === "failed" ? (queued.result ?? null) : null,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  },
});

/** One selected client, or fill missing batches for all exactly mapped ad clients. */
export const planNextBatch = authenticatedMutation({
  args: { clientTaskId: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { clientTaskId }) => {
    await assertRole(ctx, "creative");
    const scope = await allowedClients(ctx);
    const roster = (await ctx.db.query("clients").collect()).filter(
      client => active(client.clientStatus) && inScope(scope, client.name),
    );
    const campaigns = await ctx.db.query("campaigns").collect();
    const selected = clientTaskId
      ? roster.filter(client => client.taskId === clientTaskId)
      : roster.filter(client => hasExactCampaign(client, campaigns));
    if (clientTaskId && selected.length !== 1) {
      throw new Error("Select an active client on your roster.");
    }
    const cycle = nextCreativeCycle(Date.now());
    const by = await userEmail(ctx);
    let queued = 0;
    for (const client of selected) {
      if (await enqueueBatch(ctx, client, cycle, by)) queued++;
    }
    return { cycle, queued, skipped: selected.length - queued };
  },
});

/** Auto-planning is a deliberate per-client choice, off by default. */
export const setAutoPlan = authenticatedMutation({
  args: { clientTaskId: v.string(), enabled: v.boolean() },
  returns: v.boolean(),
  handler: async (ctx, { clientTaskId, enabled }) => {
    await assertRole(ctx, "creative");
    const scope = await allowedClients(ctx);
    const client = await ctx.db
      .query("clients")
      .withIndex("by_task", q => q.eq("taskId", clientTaskId))
      .unique();
    if (!client || !inScope(scope, client.name))
      throw new Error("Client unavailable.");
    if (enabled) {
      const campaigns = await ctx.db.query("campaigns").collect();
      if (
        !active(client.clientStatus) ||
        !hasExactCampaign(client, campaigns)
      ) {
        throw new Error(
          "Auto-plan requires an active client with an exact ad mapping.",
        );
      }
    }
    const previous = await ctx.db
      .query("creativeCadencePrefs")
      .withIndex("by_client", q => q.eq("clientTaskId", clientTaskId))
      .unique();
    const record = {
      clientTaskId,
      autoPlan: enabled,
      updatedAt: Date.now(),
      updatedBy: await userEmail(ctx),
    };
    if (previous) await ctx.db.patch(previous._id, record);
    else await ctx.db.insert("creativeCadencePrefs", record);
    return enabled;
  },
});

/** Thursday morning Kuwait: prepare the next fortnight only for opted-in accounts. */
export const autoPlanDue = internalMutation({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const cycle = nextCreativeCycle(Date.now());
    const prefs = (await ctx.db.query("creativeCadencePrefs").collect()).filter(
      pref => pref.autoPlan,
    );
    const campaigns = await ctx.db.query("campaigns").collect();
    let queued = 0;
    for (const pref of prefs) {
      const client = await ctx.db
        .query("clients")
        .withIndex("by_task", q => q.eq("taskId", pref.clientTaskId))
        .unique();
      if (
        !client ||
        !active(client.clientStatus) ||
        !hasExactCampaign(client, campaigns)
      )
        continue;
      if (await enqueueBatch(ctx, client, cycle, "auto-plan")) queued++;
    }
    return { cycle, queued };
  },
});
