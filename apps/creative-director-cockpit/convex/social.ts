import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";
import { authenticatedAction } from "./functions";
import { hasAccess } from "./roles";

/**
 * Social media management for clients.
 *
 * The workflow locked on 2026-09-18: three pillars, a monthly batch, a
 * written plan approved before anything is generated, an internal review by
 * somebody who did not generate it, then the client approves in GoHighLevel
 * and GHL publishes natively. `docs/research/social-media.md` has the whole
 * of it and why each step is where it is.
 *
 * Two rules this file exists to enforce.
 *
 * **Nothing is generated before a person has read the plan.** A post exists
 * as a topic, a slide count and a caption direction long before it is a
 * picture. Catching a wrong direction at that point costs nothing; catching
 * it after generation costs real Higgsfield credits and somebody's evening.
 *
 * **The cockpit does not generate anything itself.** Images come off
 * Mahara's existing Higgsfield subscription through its MCP, and an MCP
 * tool cannot be called from a Convex action. So this writes a job and an
 * agent that can speak MCP drains it -- the same outbox pattern as
 * everything else that leaves a cockpit.
 *
 * A client is a ClickUp card. `client_task_id` is the id on the Clients
 * board, so the brand DNA, the do's and don'ts and the offer are already on
 * file and are not copied here.
 */
declare const process: { env: Record<string, string | undefined> };

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** The three pillars, from the live analysis of five accounts in the vertical. */
export const PILLARS = ["portfolio", "craft", "education"] as const;

/** What a batch can be, in the order it goes through them. */
const BATCH_FLOW = [
  "planning",
  "planned",
  "approved",
  "generating",
  "review",
  "with_client",
  "scheduled",
  "done",
] as const;

const TEXT_MAX = 2000;

// biome-ignore lint/suspicious/noExplicitAny: Supabase rows are untyped here
type Row = Record<string, any>;

function ready(): void {
  if (!SUPABASE_URL || !SUPABASE_KEY)
    throw new Error(
      "Social media is not connected yet: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set on this deployment.",
    );
}

async function rest(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<Row[] | Row | null> {
  ready();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Accept: "application/json",
      ...(init.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

function rows(x: Row[] | Row | null): Row[] {
  return Array.isArray(x) ? x : [];
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

function now(): string {
  return new Date().toISOString();
}

function clip(x: unknown, max = TEXT_MAX): string | null {
  const s = String(x ?? "").trim();
  return s ? s.slice(0, max) : null;
}

/** A short unique suffix, the shape the rest of the codebase writes. */
function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** This month in Kuwait, which is the month a batch belongs to. */
function thisMonth(): string {
  const d = new Date(Date.now() + 3 * 3600_000);
  return d.toISOString().slice(0, 7);
}

// ---------------------------------------------------------------------------
// The gate. An action has no ctx.db, so the seat check runs in a query --
// the same one the ideation board uses, because it is the same cockpit and
// the same people.

export const gate = internalQuery({
  args: { userId: v.id("users") },
  returns: v.object({ ok: v.boolean(), email: v.string(), name: v.string() }),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    const email = String(user?.email ?? "")
      .trim()
      .toLowerCase();
    let name = String(user?.name ?? "");
    if (!name && email) {
      const member = await ctx.db
        .query("portalMembers")
        .withIndex("by_email", q => q.eq("email", email))
        .unique();
      name = member?.name ?? email.split("@")[0];
    }
    return { ok: await hasAccess(ctx, email), email, name };
  },
});

// biome-ignore lint/suspicious/noExplicitAny: action ctx
async function who(ctx: any): Promise<{ email: string; name: string }> {
  const g = (await ctx.runQuery(internal.social.gate, {
    userId: ctx.userId as Id<"users">,
  })) as { ok: boolean; email: string; name: string };
  if (!g.ok)
    throw new Error(
      "This cockpit is not yours. Ask Aziz to add you in the portal.",
    );
  return { email: g.email, name: g.name };
}

/** The client names, from the ClickUp mirror, so the roster reads as names. */
export const clientNames = internalQuery({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    const all = await ctx.db.query("clients").collect();
    return all.map(c => ({
      taskId: c.taskId,
      name: c.name,
      status: c.clientStatus ?? null,
      instagram: null,
    }));
  },
});

// ---------------------------------------------------------------------------
// Reading

/**
 * Every client, whether or not they are on the package.
 *
 * Grouped by batch day and pillar mix rather than alphabetically, because
 * that is the actual time-leverage mechanic: one reviewer does every
 * client's Craft work in one sitting instead of working each client end to
 * end. Clients not on the package come back too, so turning one on is one
 * press from the same screen.
 */
export const roster = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await who(ctx);
    const month = thisMonth();
    const names: Row[] = await ctx.runQuery(internal.social.clientNames, {});
    const social: Row[] = rows(
      await rest("social_clients?select=*&order=batch_day.asc"),
    );
    const batches: Row[] = rows(
      await rest(`social_batches?select=*&month=eq.${enc(month)}`),
    );
    const byId = new Map(social.map(s => [String(s.client_task_id), s]));
    const batchBy = new Map(batches.map(b => [String(b.client_task_id), b]));
    const out = names.map(c => {
      const s = byId.get(String(c.taskId));
      return {
        taskId: c.taskId,
        name: c.name,
        clientStatus: c.status,
        active: Boolean(s?.active),
        pillars: s?.pillars ?? [],
        postsPerMonth: s?.posts_per_month ?? null,
        batchDay: s?.batch_day ?? null,
        dialect: s?.dialect ?? null,
        ghlLocationId: s?.ghl_location_id ?? null,
        // Onboarding is done when all four are set; the screen shows what
        // is missing rather than a single misleading tick.
        onboarding: {
          socials: Boolean(s?.socials_connected_at),
          tested: Boolean(s?.test_post_at),
          slots: Boolean(s?.slots_blocked_at),
          bank: Boolean(s?.bank_ready_at),
        },
        batch: batchBy.get(String(c.taskId))
          ? {
              id: batchBy.get(String(c.taskId))?.id,
              status: batchBy.get(String(c.taskId))?.status,
              mix: batchBy.get(String(c.taskId))?.mix ?? {},
            }
          : null,
      };
    });
    return { month, clients: out };
  },
});

/**
 * Everything waiting on a person, across every client, in one place.
 *
 * Two different waits, deliberately kept apart: a plan nobody has approved
 * is ours to act on, and a batch sitting with the client is theirs. Mixing
 * them makes the second look like a backlog when it is not.
 */
export const pending = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await who(ctx);
    const names: Row[] = await ctx.runQuery(internal.social.clientNames, {});
    const batches: Row[] = rows(
      await rest(
        "social_batches?select=*&status=in.(planned,review,with_client)&order=updated_at.asc&limit=200",
      ),
    );
    const nameOf = new Map(names.map(c => [String(c.taskId), String(c.name)]));
    const label = (b: Row) => ({
      id: b.id,
      client: nameOf.get(String(b.client_task_id)) ?? String(b.client_task_id),
      clientTaskId: b.client_task_id,
      month: b.month,
      status: b.status,
      since: b.updated_at,
    });
    return {
      awaitingPlanApproval: batches
        .filter(b => b.status === "planned")
        .map(label),
      awaitingInternalReview: batches
        .filter(b => b.status === "review")
        .map(label),
      withClient: batches.filter(b => b.status === "with_client").map(label),
    };
  },
});

/** One client's month: the batch and every post in it. */
export const batch = authenticatedAction({
  args: { clientTaskId: v.string(), month: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await who(ctx);
    const month = args.month || thisMonth();
    const id = `${args.clientTaskId}:${month}`;
    const found: Row[] = rows(
      await rest(`social_batches?select=*&id=eq.${enc(id)}&limit=1`),
    );
    const posts: Row[] = rows(
      await rest(`social_posts?select=*&batch_id=eq.${enc(id)}&order=n.asc`),
    );
    return { month, batch: found[0] ?? null, posts };
  },
});

/** The Content Bank: what this client's audience actually asks, and every
 *  correction anybody has made. */
export const bank = authenticatedAction({
  args: { clientTaskId: v.string() },
  returns: v.any(),
  handler: async (ctx, { clientTaskId }) => {
    await who(ctx);
    return rows(
      await rest(
        `social_bank?select=*&client_task_id=eq.${enc(clientTaskId)}` +
          "&order=active.desc,at.desc&limit=500",
      ),
    );
  },
});

// ---------------------------------------------------------------------------
// Writing

/** Turn the package on or off for a client. The flag the client screen shows. */
export const setActive = authenticatedAction({
  args: { clientTaskId: v.string(), active: v.boolean() },
  returns: v.any(),
  handler: async (ctx, { clientTaskId, active }) => {
    await who(ctx);
    await rest("social_clients?on_conflict=client_task_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: [
        {
          client_task_id: clientTaskId,
          active,
          started_at: active ? now() : null,
          updated_at: now(),
        },
      ],
    });
    return { active };
  },
});

/** How a client's month is shaped. */
export const configure = authenticatedAction({
  args: {
    clientTaskId: v.string(),
    pillars: v.optional(v.array(v.string())),
    dialect: v.optional(v.string()),
    postsPerMonth: v.optional(v.number()),
    batchDay: v.optional(v.number()),
    ghlLocationId: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await who(ctx);
    const body: Row = { client_task_id: args.clientTaskId, updated_at: now() };
    if (args.pillars) {
      const kept = args.pillars.filter(p =>
        (PILLARS as readonly string[]).includes(p),
      );
      if (!kept.length)
        throw new Error("A client needs at least one pillar to post anything.");
      body.pillars = kept;
    }
    if (args.dialect !== undefined) body.dialect = clip(args.dialect, 60);
    if (args.postsPerMonth !== undefined)
      body.posts_per_month = Math.max(
        1,
        Math.min(60, Math.floor(args.postsPerMonth)),
      );
    if (args.batchDay !== undefined)
      body.batch_day = Math.max(1, Math.min(28, Math.floor(args.batchDay)));
    if (args.ghlLocationId !== undefined)
      body.ghl_location_id = clip(args.ghlLocationId, 64);
    if (args.note !== undefined) body.note = clip(args.note);
    await rest("social_clients?on_conflict=client_task_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: [body],
    });
    return { ok: true };
  },
});

/** Mark a step of onboarding done, or undone. */
export const onboardingStep = authenticatedAction({
  args: {
    clientTaskId: v.string(),
    step: v.string(),
    done: v.boolean(),
  },
  returns: v.any(),
  handler: async (ctx, { clientTaskId, step, done }) => {
    await who(ctx);
    const column = {
      socials: "socials_connected_at",
      tested: "test_post_at",
      slots: "slots_blocked_at",
      bank: "bank_ready_at",
    }[step];
    if (!column)
      throw new Error("Onboarding steps are: socials, tested, slots, bank.");
    await rest("social_clients?on_conflict=client_task_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: [
        {
          client_task_id: clientTaskId,
          [column]: done ? now() : null,
          updated_at: now(),
        },
      ],
    });
    return { ok: true };
  },
});

/** Add something the audience actually asked, or a correction somebody made. */
export const bankAdd = authenticatedAction({
  args: {
    clientTaskId: v.string(),
    text: v.string(),
    kind: v.optional(v.string()),
    pillar: v.optional(v.string()),
    source: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { email } = await who(ctx);
    const text = clip(args.text);
    if (!text) throw new Error("Type the question, objection or correction.");
    const kind = ["question", "objection", "correction"].includes(
      args.kind ?? "",
    )
      ? args.kind
      : "question";
    const id = rid("bank");
    await rest("social_bank", {
      method: "POST",
      prefer: "return=minimal",
      body: [
        {
          id,
          client_task_id: args.clientTaskId,
          kind,
          text,
          pillar: args.pillar ?? null,
          source: args.source ?? "cockpit",
          added_by: email,
          at: now(),
        },
      ],
    });
    return { id };
  },
});

/**
 * Retire an item rather than delete it.
 *
 * A correction that stops applying is still a record of what somebody
 * asked for once, and the bank is meant to be the memory of this client.
 */
export const bankRetire = authenticatedAction({
  args: { id: v.string(), active: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { id, active }) => {
    await who(ctx);
    await rest(`social_bank?id=eq.${enc(id)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: { active: active ?? false },
    });
    return null;
  },
});

/**
 * Phase 1: how many of each pillar this month.
 *
 * Decided on what material actually exists -- a client with no new project
 * photos this cycle shifts the ratio to Craft and Education rather than
 * posting something stale.
 */
export const setMix = authenticatedAction({
  args: {
    clientTaskId: v.string(),
    month: v.optional(v.string()),
    mix: v.any(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    await who(ctx);
    const month = args.month || thisMonth();
    const id = `${args.clientTaskId}:${month}`;
    const mix: Row = {};
    let total = 0;
    for (const p of PILLARS) {
      const n = Math.max(0, Math.floor(Number(args.mix?.[p] ?? 0)));
      mix[p] = n;
      total += n;
    }
    if (!total) throw new Error("A month with no posts in it is not a batch.");
    const existing = rows(
      await rest(`social_batches?select=status&id=eq.${enc(id)}&limit=1`),
    );
    if (
      existing[0] &&
      existing[0].status !== "planning" &&
      existing[0].status !== "planned"
    )
      throw new Error(
        `This month is already ${existing[0].status}. Changing the mix now would not match what has been made.`,
      );
    await rest("social_batches?on_conflict=id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: [
        {
          id,
          client_task_id: args.clientTaskId,
          month,
          mix,
          status: "planning",
          updated_at: now(),
        },
      ],
    });
    return { id, mix, total };
  },
});

/**
 * Phase 3: the plan is right, generate from it.
 *
 * The one gate the whole cost model rests on, so it checks rather than
 * trusts: a batch with no plan in it cannot be approved, and neither can
 * one that has already moved on.
 */
export const approvePlan = authenticatedAction({
  args: { batchId: v.string() },
  returns: v.any(),
  handler: async (ctx, { batchId }) => {
    const { email, name } = await who(ctx);
    const found = rows(
      await rest(`social_batches?select=*&id=eq.${enc(batchId)}&limit=1`),
    );
    const b = found[0];
    if (!b) throw new Error("That month is not set up yet.");
    if (b.status !== "planned")
      throw new Error(
        b.status === "planning"
          ? "There is no plan to approve yet."
          : `This month is already ${b.status}.`,
      );
    const posts = rows(
      await rest(`social_posts?select=id&batch_id=eq.${enc(batchId)}&limit=1`),
    );
    if (!posts.length)
      throw new Error(
        "That plan has no posts in it, so there is nothing to approve.",
      );
    await rest(`social_batches?id=eq.${enc(batchId)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        status: "approved",
        approved_at: now(),
        approved_by: name || email,
        updated_at: now(),
      },
    });
    await rest(`social_posts?batch_id=eq.${enc(batchId)}&status=eq.planned`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: { status: "approved", updated_at: now() },
    });
    return { status: "approved" };
  },
});

/** Change one planned post before the batch is approved. */
export const editPlan = authenticatedAction({
  args: {
    postId: v.string(),
    topic: v.optional(v.string()),
    slides: v.optional(v.number()),
    captionDirection: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await who(ctx);
    const found = rows(
      await rest(
        `social_posts?select=status&id=eq.${enc(args.postId)}&limit=1`,
      ),
    );
    if (!found[0]) throw new Error("That post is gone.");
    if (found[0].status !== "planned")
      throw new Error(
        "That post has already been generated. Correct it in the Content Bank so the next batch is right.",
      );
    const body: Row = { updated_at: now() };
    if (args.topic !== undefined) body.topic = clip(args.topic, 300);
    if (args.slides !== undefined)
      body.slides = Math.max(1, Math.min(10, Math.floor(args.slides)));
    if (args.captionDirection !== undefined)
      body.caption_direction = clip(args.captionDirection);
    await rest(`social_posts?id=eq.${enc(args.postId)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body,
    });
    return null;
  },
});

export { BATCH_FLOW };
