import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalQuery } from "./_generated/server";
import { authenticatedAction } from "./functions";
import {
  accounts as ghlAccounts,
  createPost as ghlCreatePost,
  deletePost as ghlDeletePost,
  posts as ghlPosts,
  reschedulePost as ghlReschedule,
  users as ghlUsers,
  locationToken,
  ourStatus,
  postIdOf,
  USER_ID,
} from "./ghlSocial";
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

/**
 * What a new client starts with, from the live analysis of five accounts
 * in the vertical -- a starting point, not a fixed list. A client can
 * rename these or keep its own; a jeweller's pillars are not a glazing
 * contractor's, and forcing the same three on both is how the plans
 * started reading the same.
 */
export const DEFAULT_PILLARS = ["portfolio", "craft", "education"] as const;

/** Tidy a client's own pillar names: trimmed, unique, and few enough to plan against. */
export function cleanPillars(raw: string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const p of raw) {
    const name = String(p).trim().toLowerCase().slice(0, 24);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    kept.push(name);
  }
  return kept.slice(0, 6);
}

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

/**
 * When each post in a month goes out.
 *
 * Spread across the working days of the month rather than scheduled
 * together, because eight posts at the same minute is not a content
 * calendar. Mid-morning Kuwait, which is 07:00 UTC.
 */
export function spread(month: string, n: number): string[] {
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  const days = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const out: string[] = [];
  // Start a day in, so a batch approved on the 1st is never scheduled for
  // a moment that has already passed.
  const first = 2;
  const usable = Math.max(1, days - first);
  for (let i = 0; i < n; i++) {
    const day = Math.min(
      days,
      first + Math.round((i * usable) / Math.max(1, n)),
    );
    out.push(new Date(Date.UTC(year, mon - 1, day, 7, 0, 0)).toISOString());
  }
  return out;
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
      const kept = cleanPillars(args.pillars);
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
    // The client's own pillars, not a fixed three.
    const c = await clientOrWhy(args.clientTaskId);
    const pillars = cleanPillars(
      (Array.isArray(c.pillars) ? c.pillars : []) as string[],
    );
    const mix: Row = {};
    let total = 0;
    for (const p of pillars.length ? pillars : [...DEFAULT_PILLARS]) {
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

// ---------------------------------------------------------------------------
// GoHighLevel: the posting engine underneath.
//
// Staff never open GHL. It holds the Meta and LinkedIn connections, shows
// the client the approval link, and publishes natively. Everything below
// is the cockpit talking to it in the background.

/**
 * A usable token for one client's sub-account, minting and storing one if
 * the stored one is missing or spent.
 *
 * A Private Integration Token made in the sub-account's own settings never
 * expires; one minted from the agency token does, so it is written back
 * with its expiry. Either way the caller does not know which it got.
 */
async function tokenFor(locationId: string): Promise<string> {
  const stored = rows(
    await rest(`social_ghl_auth?select=*&id=eq.${enc(locationId)}&limit=1`),
  )[0];
  const agencyRow = rows(
    await rest("social_ghl_auth?select=*&id=eq.agency&limit=1"),
  )[0];
  const got = await locationToken(
    locationId,
    stored ? { token: stored.token, expiresAt: stored.expires_at } : null,
    agencyRow
      ? { token: agencyRow.token, companyId: agencyRow.scopes ?? null }
      : null,
  );
  if (got.minted) {
    await rest("social_ghl_auth?on_conflict=id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: [
        {
          id: locationId,
          token: got.token,
          expires_at: got.expiresAt,
          error: null,
          checked_at: now(),
          updated_at: now(),
        },
      ],
    });
  }
  return got.token;
}

/**
 * Who a post is authored by in a sub-account.
 *
 * The environment variable wins if somebody set one, otherwise the
 * sub-account's own first user -- which is the honest author, since the
 * post is theirs. Cached on the auth row so this is one call per client
 * ever, not one per post.
 */
async function authorFor(locationId: string, token: string): Promise<string> {
  if (USER_ID) return USER_ID;
  const row = rows(
    await rest(
      `social_ghl_auth?select=user_id&id=eq.${enc(locationId)}&limit=1`,
    ),
  )[0];
  if (row?.user_id) return String(row.user_id);
  const found = await ghlUsers(locationId, token);
  const id = String(found[0]?.id ?? found[0]?._id ?? "");
  if (!id)
    throw new Error(
      `GoHighLevel lists no user on that sub-account, so there is nobody to ` +
        "author the post as. Set GHL_SOCIAL_USER_ID, or add a user in GHL.",
    );
  await rest("social_ghl_auth?on_conflict=id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: [{ id: locationId, user_id: id, updated_at: now() }],
  });
  return id;
}

/** The client's row, or a sentence saying what is not set up. */
async function clientOrWhy(clientTaskId: string): Promise<Row> {
  const c = rows(
    await rest(
      `social_clients?select=*&client_task_id=eq.${enc(clientTaskId)}&limit=1`,
    ),
  )[0];
  if (!c) throw new Error("That client is not on social media management.");
  if (!c.ghl_location_id)
    throw new Error(
      "That client has no GoHighLevel sub-account set. Add the location id first.",
    );
  return c;
}

/**
 * Which socials GHL actually holds for a client, read fresh and stored.
 *
 * Run it at onboarding, right after connecting, and again whenever a post
 * fails: GHL keeps an account row after the OAuth behind it has lapsed, so
 * the only honest check is asking.
 */
export const checkConnection = authenticatedAction({
  args: { clientTaskId: v.string() },
  returns: v.any(),
  handler: async (ctx, { clientTaskId }) => {
    await who(ctx);
    const c = await clientOrWhy(clientTaskId);
    const location = String(c.ghl_location_id);
    const token = await tokenFor(location);
    const found = await ghlAccounts(location, token);
    const stamp = now();
    if (found.length) {
      await rest("social_accounts?on_conflict=id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: found.map(a => ({
          id: String(a.id ?? a._id ?? ""),
          client_task_id: clientTaskId,
          location_id: location,
          platform: String(a.platform ?? a.type ?? "").toLowerCase() || null,
          name: a.name ?? a.pageName ?? null,
          avatar: a.avatar ?? a.picture ?? null,
          ok: true,
          seen_at: stamp,
        })),
      });
    }
    return {
      connected: found.length,
      platforms: [
        ...new Set(
          found
            .map(a => String(a.platform ?? a.type ?? "").toLowerCase())
            .filter(Boolean),
        ),
      ],
    };
  },
});

/**
 * Pull a client's month out of GHL into our own store.
 *
 * On a timer and on demand, never on a page load: the cockpit shows what
 * it last saw and says when, so a slow GHL leaves the calendar stale
 * rather than blank.
 */
export const syncCalendar = authenticatedAction({
  args: { clientTaskId: v.string(), month: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await who(ctx);
    const c = await clientOrWhy(args.clientTaskId);
    const location = String(c.ghl_location_id);
    const month = args.month || thisMonth();
    const from = `${month}-01T00:00:00Z`;
    const to = new Date(
      Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1),
    ).toISOString();
    const token = await tokenFor(location);
    const theirs = await ghlPosts(location, token, { from, to });

    // Only posts the cockpit pushed are matched back. Anything somebody
    // made in GHL directly is left alone rather than adopted, because we
    // have no plan, no pillar and no batch to file it under.
    const mine = rows(
      await rest(
        `social_posts?select=id,ghl_post_id,status&client_task_id=eq.${enc(args.clientTaskId)}` +
          "&ghl_post_id=not.is.null&limit=200",
      ),
    );
    const byGhl = new Map(mine.map(p => [String(p.ghl_post_id), p]));
    const stamp = now();
    const updates: Row[] = [];
    for (const t of theirs) {
      const id = String(t.id ?? t._id ?? "");
      const ours = byGhl.get(id);
      if (!ours) continue;
      const status = ourStatus(String(t.status ?? ""));
      updates.push({
        id: ours.id,
        status,
        ghl_status: t.status ?? null,
        ghl_synced_at: stamp,
        scheduled_at: t.scheduleDate ?? null,
        published_at: status === "published" ? (t.publishedAt ?? stamp) : null,
        updated_at: stamp,
      });
    }
    if (updates.length)
      await rest("social_posts?on_conflict=id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: updates,
      });
    return { inGhl: theirs.length, ours: updates.length, at: stamp };
  },
});

/**
 * Phase 6: the internally-approved batch goes to the client.
 *
 * The only moment GHL becomes visible to anyone outside Mahara, and it is
 * client-facing by design. Posts go in as `in_review`, so GHL sends the
 * approval link and publishes natively once the client says yes.
 *
 * Posts are spread across the month rather than scheduled together: eight
 * posts at the same minute is not a content calendar.
 */
export const sendToClient = authenticatedAction({
  args: { batchId: v.string(), approverUserId: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    await who(ctx);
    const b = rows(
      await rest(`social_batches?select=*&id=eq.${enc(args.batchId)}&limit=1`),
    )[0];
    if (!b) throw new Error("That month is not set up yet.");
    if (b.status !== "review")
      throw new Error(
        b.status === "with_client"
          ? "That batch is already with the client."
          : "Only a batch that has passed internal review goes to the client.",
      );
    const c = await clientOrWhy(String(b.client_task_id));
    const location = String(c.ghl_location_id);
    const token = await tokenFor(location);

    const connected = rows(
      await rest(
        `social_accounts?select=id&client_task_id=eq.${enc(String(b.client_task_id))}&ok=is.true`,
      ),
    ).map(a => String(a.id));
    if (!connected.length)
      throw new Error(
        "No connected social account for that client. Run the connection check.",
      );

    const ready = rows(
      await rest(
        `social_posts?select=*&batch_id=eq.${enc(args.batchId)}` +
          "&status=eq.internal_ok&order=n.asc",
      ),
    );
    if (!ready.length)
      throw new Error("Nothing in that batch has passed internal review yet.");

    const author = await authorFor(location, token);
    // Days somebody chose are kept. `spread` only fills the ones nobody
    // has placed, so opening the calendar does not undo a decision.
    const auto = spread(String(b.month), ready.length);
    const slots = ready.map((p, i) =>
      p.scheduled_at ? new Date(String(p.scheduled_at)).toISOString() : auto[i],
    );
    let sent = 0;
    const problems: string[] = [];
    for (const [i, post] of ready.entries()) {
      try {
        const made = await ghlCreatePost(location, token, {
          accountIds: connected,
          summary: String(post.caption ?? ""),
          media: (Array.isArray(post.images) ? post.images : []).map(
            (u: string) => ({
              url: u,
            }),
          ),
          userId: author,
          scheduleDate: slots[i],
          approverUserId: args.approverUserId,
        });
        const ghlId = postIdOf(made);
        await rest(`social_posts?id=eq.${enc(String(post.id))}`, {
          method: "PATCH",
          prefer: "return=minimal",
          body: {
            status: "with_client",
            ghl_post_id: ghlId || null,
            ghl_status: "in_review",
            scheduled_at: slots[i],
            ghl_synced_at: now(),
            error: null,
            updated_at: now(),
          },
        });
        sent += 1;
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        problems.push(`${post.topic ?? post.id}: ${why.slice(0, 140)}`);
        await rest(`social_posts?id=eq.${enc(String(post.id))}`, {
          method: "PATCH",
          prefer: "return=minimal",
          body: { error: why.slice(0, 500), updated_at: now() },
        });
      }
    }

    // The batch only moves if all of it went. A half-sent month that says
    // "with client" is the kind of thing nobody notices until the client
    // asks where the rest is.
    if (sent && !problems.length)
      await rest(`social_batches?id=eq.${enc(args.batchId)}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: {
          status: "with_client",
          sent_at: now(),
          error: null,
          updated_at: now(),
        },
      });
    else if (problems.length)
      await rest(`social_batches?id=eq.${enc(args.batchId)}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: { error: problems.join(" · ").slice(0, 500), updated_at: now() },
      });

    return { sent, of: ready.length, problems };
  },
});

// ---------------------------------------------------------------------------
// Handing work to Salma.
//
// The cockpit does not write plans or captions and cannot generate images:
// Higgsfield is MCP-only and a Convex action cannot speak MCP. So it queues
// and Salma, on the VPS, drains. Every button below writes a row and
// returns; nothing here waits on a model.

/** Ask for the month to be planned. Phase 2, the cheap checkpoint. */
export const writePlan = authenticatedAction({
  args: { clientTaskId: v.string(), month: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { email } = await who(ctx);
    const month = args.month || thisMonth();
    const batchId = `${args.clientTaskId}:${month}`;
    const found = rows(
      await rest(`social_batches?select=*&id=eq.${enc(batchId)}&limit=1`),
    )[0];
    if (!found) throw new Error("Set the pillar mix for the month first.");
    if (!["planning", "planned"].includes(String(found.status)))
      throw new Error(
        `This month is already ${found.status}. Re-planning would not match what has been made.`,
      );

    // One outstanding plan job per month. Pressing twice is a person being
    // impatient, not a request for two plans.
    const already = rows(
      await rest(
        `social_jobs?select=id&batch_id=eq.${enc(batchId)}&kind=eq.plan` +
          "&status=in.(queued,running)&limit=1",
      ),
    );
    if (already.length) return { queued: false, why: "already on the queue" };

    const id = rid("job");
    await rest("social_jobs", {
      method: "POST",
      prefer: "return=minimal",
      body: [
        {
          id,
          kind: "plan",
          client_task_id: args.clientTaskId,
          batch_id: batchId,
          status: "queued",
          requested_by: email,
          created_at: now(),
          updated_at: now(),
        },
      ],
    });
    return { queued: true, job: id };
  },
});

/**
 * Generate the approved plan: a caption and images for every post.
 *
 * One job per post rather than one for the batch, so a single bad post
 * fails on its own instead of taking eleven good ones with it.
 */
export const generateBatch = authenticatedAction({
  args: { batchId: v.string() },
  returns: v.any(),
  handler: async (ctx, { batchId }) => {
    const { email } = await who(ctx);
    const b = rows(
      await rest(`social_batches?select=*&id=eq.${enc(batchId)}&limit=1`),
    )[0];
    if (!b) throw new Error("That month is not set up yet.");
    if (b.status !== "approved")
      throw new Error(
        b.status === "planned"
          ? "Read the plan and approve it first. That is the checkpoint the cost of this rests on."
          : `This month is ${b.status}, not waiting to be generated.`,
      );

    const posts = rows(
      await rest(
        `social_posts?select=id&batch_id=eq.${enc(batchId)}&status=eq.approved&order=n.asc`,
      ),
    );
    if (!posts.length) throw new Error("Nothing in that plan is approved.");

    const jobs = posts.flatMap(p => [
      {
        id: rid("job"),
        kind: "caption",
        client_task_id: b.client_task_id,
        batch_id: batchId,
        post_id: p.id,
        status: "queued",
        requested_by: email,
        created_at: now(),
        updated_at: now(),
      },
      {
        id: rid("job"),
        kind: "generate",
        client_task_id: b.client_task_id,
        batch_id: batchId,
        post_id: p.id,
        status: "queued",
        requested_by: email,
        created_at: now(),
        updated_at: now(),
      },
    ]);
    await rest("social_jobs", {
      method: "POST",
      prefer: "return=minimal",
      body: jobs,
    });
    await rest(`social_batches?id=eq.${enc(batchId)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: { status: "generating", updated_at: now() },
    });
    await rest(`social_posts?batch_id=eq.${enc(batchId)}&status=eq.approved`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: { status: "generating", updated_at: now() },
    });
    return { queued: jobs.length, posts: posts.length };
  },
});

/**
 * Phase 5: somebody who did not generate it has read the batch.
 *
 * The rule is in the workflow and worth keeping in the code: the reviewer
 * is not the person who ran generation. There is nobody to enforce that
 * against in a two-person team, so this records who signed it off and
 * leaves the honesty to them.
 */
export const passReview = authenticatedAction({
  args: { batchId: v.string() },
  returns: v.any(),
  handler: async (ctx, { batchId }) => {
    const { email, name } = await who(ctx);
    const b = rows(
      await rest(`social_batches?select=*&id=eq.${enc(batchId)}&limit=1`),
    )[0];
    if (!b) throw new Error("That month is not set up yet.");
    if (!["generating", "review"].includes(String(b.status)))
      throw new Error(`This month is ${b.status}, not waiting on review.`);

    const all = rows(
      await rest(
        `social_posts?select=id,n,topic,caption,images&batch_id=eq.${enc(batchId)}`,
      ),
    );
    const noCaption = all.filter(p => !p.caption);
    const noImage = all.filter(
      p => !Array.isArray(p.images) || p.images.length === 0,
    );
    if (noCaption.length)
      throw new Error(
        `${noCaption.length} post(s) have no caption yet, starting with #${noCaption[0].n}. ` +
          "Salma has not finished, or something failed.",
      );
    // A post with no picture is not a post, and it would reach the client
    // looking like a mistake somebody else made.
    if (noImage.length)
      throw new Error(
        `${noImage.length} post(s) have no image yet, starting with #${noImage[0].n}. ` +
          "Make them from the prompts and attach them first.",
      );

    await rest(`social_posts?batch_id=eq.${enc(batchId)}&status=eq.generated`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: { status: "internal_ok", updated_at: now() },
    });
    await rest(`social_batches?id=eq.${enc(batchId)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        status: "review",
        reviewed_at: now(),
        reviewed_by: name || email,
        updated_at: now(),
      },
    });
    return { status: "review" };
  },
});

/**
 * A rejection, with its reason, kept as a correction.
 *
 * The reason is the point. It goes into the Content Bank so the next batch
 * is written knowing it, rather than being fixed once in a message nobody
 * can find again.
 */
export const rejectPost = authenticatedAction({
  args: { postId: v.string(), reason: v.string() },
  returns: v.any(),
  handler: async (ctx, { postId, reason }) => {
    const { email } = await who(ctx);
    const why = clip(reason, 1000);
    if (!why)
      throw new Error(
        "A rejection needs a written reason, or the next batch repeats it.",
      );
    const p = rows(
      await rest(`social_posts?select=*&id=eq.${enc(postId)}&limit=1`),
    )[0];
    if (!p) throw new Error("That post is gone.");
    await rest(`social_posts?id=eq.${enc(postId)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        status: "client_rejected",
        rejected_reason: why,
        updated_at: now(),
      },
    });
    await rest("social_bank", {
      method: "POST",
      prefer: "return=minimal",
      body: [
        {
          id: rid("bank"),
          client_task_id: p.client_task_id,
          kind: "correction",
          text: why,
          pillar: p.pillar ?? null,
          source: "correction",
          added_by: email,
          at: now(),
        },
      ],
    });
    return { corrected: true };
  },
});

/**
 * Onboarding step 3: a private draft, straight after connecting.
 *
 * Aziz's workflow asks for exactly this, and for a good reason -- it
 * "catches broken auth now instead of three weeks later when the first
 * real batch is due". GoHighLevel keeps an account row after the OAuth
 * behind it lapses, so the accounts list saying "Instagram" is not proof
 * that Instagram will accept a post. Writing one is.
 *
 * A draft notifies nobody, reaches no client and publishes nothing. It is
 * created, read back and deleted, so the client's planner is exactly as it
 * was. Nothing about this is visible outside Mahara.
 */
export const testPost = authenticatedAction({
  args: { clientTaskId: v.string() },
  returns: v.any(),
  handler: async (ctx, { clientTaskId }) => {
    await who(ctx);
    const c = await clientOrWhy(clientTaskId);
    const location = String(c.ghl_location_id);
    const token = await tokenFor(location);

    const connected = await ghlAccounts(location, token);
    if (!connected.length)
      throw new Error(
        "GoHighLevel holds no social account for this client, so there is " +
          "nothing to test. Connect one in Social Planner first.",
      );
    const ids = connected.map(a => String(a.id ?? a._id ?? "")).filter(Boolean);
    const author = await authorFor(location, token);

    // Three days out: far enough that a draft accidentally left behind
    // could not fire before somebody noticed.
    const when = new Date(Date.now() + 3 * 86400_000).toISOString();
    const made = await ghlCreatePost(location, token, {
      accountIds: ids,
      summary:
        "Connection test from the Mahara cockpit. A draft, not scheduled, " +
        "removed straight away.",
      userId: author,
      scheduleDate: when,
      status: "draft",
    });
    const postId = postIdOf(made);

    let removed = false;
    let leftBehind: string | null = null;
    if (postId) {
      try {
        await ghlDeletePost(location, token, postId);
        removed = true;
      } catch (e) {
        leftBehind = postId;
        console.error(
          `social: could not delete the test draft ${postId}: ${e}`,
        );
      }
    } else {
      // No id means we cannot clean up, and saying "fine" would leave a
      // stray draft in a client's planner with nobody looking for it.
      leftBehind = "unknown";
    }

    await rest("social_clients?on_conflict=client_task_id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: [
        {
          client_task_id: clientTaskId,
          test_post_at: now(),
          updated_at: now(),
        },
      ],
    });

    return {
      ok: true,
      platforms: [
        ...new Set(
          connected
            .map(a => String(a.platform ?? "").toLowerCase())
            .filter(Boolean),
        ),
      ],
      removed,
      leftBehind,
    };
  },
});

/**
 * Put a post on a day.
 *
 * The cockpit owns the calendar. If the post has already gone to
 * GoHighLevel the change is pushed there too -- otherwise the two
 * disagree about when a client's post goes out, and the client is the one
 * who finds out.
 */
export const schedulePost = authenticatedAction({
  args: { postId: v.string(), when: v.string() },
  returns: v.any(),
  handler: async (ctx, { postId, when }) => {
    await who(ctx);
    const at = new Date(when);
    if (Number.isNaN(at.getTime())) throw new Error("That is not a date.");
    if (at.getTime() < Date.now() - 60_000)
      throw new Error("That day has already been. Pick a day still to come.");

    const p = rows(
      await rest(`social_posts?select=*&id=eq.${enc(postId)}&limit=1`),
    )[0];
    if (!p) throw new Error("That post is gone.");

    let pushed = false;
    if (p.ghl_post_id) {
      const c = await clientOrWhy(String(p.client_task_id));
      const location = String(c.ghl_location_id);
      const token = await tokenFor(location);
      await ghlReschedule(
        location,
        token,
        String(p.ghl_post_id),
        at.toISOString(),
      );
      pushed = true;
    }
    await rest(`social_posts?id=eq.${enc(postId)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: { scheduled_at: at.toISOString(), updated_at: now() },
    });
    return { at: at.toISOString(), pushedToGhl: pushed };
  },
});

/**
 * The pictures, once somebody has made them.
 *
 * The prompts are written by Salma; the images themselves come from
 * Higgsfield, by hand today and by API later. Either way they arrive here
 * as URLs.
 *
 * They must be **publicly fetchable**. GoHighLevel pulls media by URL at
 * publish time, which can be days after we push the post, so a
 * short-lived signed link would pass every test and 404 on the morning it
 * matters. The `social-images` bucket is public for exactly this reason.
 */
export const attachImages = authenticatedAction({
  args: { postId: v.string(), urls: v.array(v.string()) },
  returns: v.any(),
  handler: async (ctx, { postId, urls }) => {
    const { email } = await who(ctx);
    const clean = urls.map(u => u.trim()).filter(Boolean);
    if (!clean.length) throw new Error("No image URLs given.");
    const bad = clean.find(u => !/^https:\/\//i.test(u));
    if (bad)
      throw new Error(
        `"${bad.slice(0, 60)}" is not an https URL. GoHighLevel fetches these ` +
          "itself, so a local path or a data URL cannot work.",
      );
    const p = rows(
      await rest(`social_posts?select=*&id=eq.${enc(postId)}&limit=1`),
    )[0];
    if (!p) throw new Error("That post is gone.");
    await rest(`social_posts?id=eq.${enc(postId)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body: {
        images: clean,
        images_by: email,
        status: p.caption ? "generated" : p.status,
        error: null,
        updated_at: now(),
      },
    });
    return { images: clean.length, status: p.caption ? "generated" : p.status };
  },
});

/**
 * Put a post on the month by hand.
 *
 * The plan writes most of them, but a month is never only what a model
 * proposed: a project finishes, a client asks for something, somebody
 * has an idea on the day. Without this the only way to add one was to
 * re-plan the month and lose everything already written.
 */
export const addPost = authenticatedAction({
  args: {
    clientTaskId: v.string(),
    month: v.optional(v.string()),
    pillar: v.string(),
    topic: v.string(),
    slides: v.optional(v.number()),
    when: v.optional(v.string()),
    /** Queue the pictures straight away, so one gesture is enough. */
    generate: v.optional(v.boolean()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { email } = await who(ctx);
    const topic = args.topic.trim();
    if (!topic) throw new Error("Give the post a topic, even a rough one.");

    const month = args.month || thisMonth();
    const batchId = `${args.clientTaskId}:${month}`;
    // A month nobody has planned is the normal case for a post somebody
    // just thought of, so make it rather than refuse. It opens in
    // `planning`; the post itself skips plan approval, because a person
    // typing the topic *is* the decision the approval gate exists to catch.
    await rest("social_batches?on_conflict=id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: [
        {
          id: batchId,
          client_task_id: args.clientTaskId,
          month,
          status: "planning",
          updated_at: now(),
        },
      ],
    });

    const existing = rows(
      await rest(
        `social_posts?select=n&batch_id=eq.${enc(batchId)}&order=n.desc&limit=1`,
      ),
    );
    const n = Number(existing[0]?.n ?? 0) + 1;

    let at: string | null = null;
    if (args.when) {
      const d = new Date(args.when);
      if (Number.isNaN(d.getTime())) throw new Error("That is not a date.");
      at = d.toISOString();
    }

    await rest("social_posts", {
      method: "POST",
      prefer: "return=minimal",
      body: [
        {
          id: `${batchId}:${n}`,
          batch_id: batchId,
          client_task_id: args.clientTaskId,
          n,
          pillar:
            String(args.pillar).trim().toLowerCase().slice(0, 24) ||
            "portfolio",
          topic: clip(topic, 300),
          slides: Math.max(1, Math.min(10, Math.floor(args.slides ?? 1))),
          status: "approved",
          scheduled_at: at,
          updated_at: now(),
        },
      ],
    });
    const id = `${batchId}:${n}`;
    if (args.generate) {
      await rest("social_jobs?on_conflict=id", {
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: [
          {
            id: `gen:${id}`,
            kind: "generate",
            client_task_id: args.clientTaskId,
            batch_id: batchId,
            post_id: id,
            status: "queued",
            attempts: 0,
            error: null,
            result: null,
            requested_by: email,
            updated_at: now(),
          },
        ],
      });
    }
    return { id, n, generating: Boolean(args.generate) };
  },
});

/**
 * Make the pictures for one post, or make them again.
 *
 * Generation used to be all-or-nothing for a month. One weak image
 * should not mean re-running the other eleven, and a post added by hand
 * needs a way to get pictures at all.
 */
export const generatePost = authenticatedAction({
  args: { postId: v.string() },
  returns: v.any(),
  handler: async (ctx, { postId }) => {
    const { email } = await who(ctx);
    const p = rows(
      await rest(`social_posts?select=*&id=eq.${enc(postId)}&limit=1`),
    )[0];
    if (!p) throw new Error("That post is gone.");
    await rest("social_jobs?on_conflict=id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: [
        {
          id: `gen:${postId}`,
          kind: "generate",
          client_task_id: p.client_task_id,
          batch_id: p.batch_id,
          post_id: postId,
          status: "queued",
          attempts: 0,
          error: null,
          result: null,
          requested_by: email,
          updated_at: now(),
        },
      ],
    });
    return { queued: true };
  },
});

/** Take a post off the month. */
export const removePost = authenticatedAction({
  args: { postId: v.string() },
  returns: v.any(),
  handler: async (ctx, { postId }) => {
    await who(ctx);
    const p = rows(
      await rest(
        `social_posts?select=ghl_post_id,status&id=eq.${enc(postId)}&limit=1`,
      ),
    )[0];
    if (!p) throw new Error("That post is gone.");
    if (p.ghl_post_id)
      throw new Error(
        "This one is already with the client in GoHighLevel. Remove it there first, " +
          "so the two do not disagree about what was sent.",
      );
    await rest(`social_posts?id=eq.${enc(postId)}`, {
      method: "DELETE",
      prefer: "return=minimal",
    });
    return { removed: true };
  },
});

/**
 * Fill the month: a finished draft on every empty day it needs.
 *
 * This replaces the mix, the written plan and the plan approval -- the
 * part Aziz said he did not understand, which is a fair verdict on four
 * steps that each asked a question before anything appeared. Now the
 * calendar is the plan. It counts how many posts the client's package
 * wants this month, finds the empty days still to come, spreads the
 * missing posts across them, rotates the client's own pillars so the
 * month is not six of the same, and hands Salma one job.
 */
export const fillMonth = authenticatedAction({
  args: { clientTaskId: v.string(), month: v.string() },
  returns: v.any(),
  handler: async (ctx, { clientTaskId, month }) => {
    const { email } = await who(ctx);
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("That is not a month.");

    const c = rows(
      await rest(
        `social_clients?select=*&client_task_id=eq.${enc(clientTaskId)}&limit=1`,
      ),
    )[0];
    if (!c) throw new Error("That client is not set up for social media yet.");
    const perMonth = Math.max(1, Number(c.posts_per_month ?? 12));
    const pillars = cleanPillars(
      (Array.isArray(c.pillars) ? c.pillars : []) as string[],
    );
    const rotation = pillars.length ? pillars : [...DEFAULT_PILLARS];

    const batchId = `${clientTaskId}:${month}`;
    const existing = rows(
      await rest(
        `social_posts?select=pillar,scheduled_at&batch_id=eq.${enc(batchId)}`,
      ),
    );
    const need = perMonth - existing.length;
    if (need <= 0)
      throw new Error(
        `This month already has ${existing.length} posts, which is what the package asks for. ` +
          "Click a day to add one more.",
      );

    // The days still to come that have nothing on them.
    const [y, m] = month.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const today = new Date().toISOString().slice(0, 10);
    const taken = new Set(
      existing
        .map(p => String(p.scheduled_at ?? "").slice(0, 10))
        .filter(Boolean),
    );
    const open: string[] = [];
    for (let d = 1; d <= last; d++) {
      const day = `${month}-${String(d).padStart(2, "0")}`;
      if (day > today && !taken.has(day)) open.push(day);
    }
    if (!open.length)
      throw new Error("There are no empty days left in this month to fill.");

    // Evenly spread, so the feed does not bunch at the start of the month.
    const k = Math.min(need, open.length);
    const days = Array.from(
      { length: k },
      (_, i) =>
        open[
          Math.min(open.length - 1, Math.floor(((i + 0.5) * open.length) / k))
        ],
    );

    // Carry on the rotation from wherever the month's existing posts left it.
    const lastPillar = String(existing.at(-1)?.pillar ?? "");
    let start = Math.max(0, rotation.indexOf(lastPillar) + 1);
    const slots = days.map(day => ({
      day,
      pillar: rotation[start++ % rotation.length],
    }));

    await rest("social_batches?on_conflict=id", {
      method: "POST",
      prefer: "resolution=ignore-duplicates,return=minimal",
      body: [
        {
          id: batchId,
          client_task_id: clientTaskId,
          month,
          status: "generating",
          updated_at: now(),
        },
      ],
    });
    await rest("social_jobs?on_conflict=id", {
      method: "POST",
      prefer: "resolution=merge-duplicates,return=minimal",
      body: [
        {
          id: `fill:${batchId}:${Date.now()}`,
          kind: "fill",
          client_task_id: clientTaskId,
          batch_id: batchId,
          params: { slots },
          status: "queued",
          attempts: 0,
          requested_by: email,
          updated_at: now(),
        },
      ],
    });
    return { filling: slots.length, days };
  },
});

/**
 * Change a post's words at any stage before it goes out.
 *
 * The old edit refused anything already generated, which is exactly when
 * somebody reads the caption and wants to fix one word.
 */
export const updatePost = authenticatedAction({
  args: {
    postId: v.string(),
    caption: v.optional(v.string()),
    topic: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await who(ctx);
    const p = rows(
      await rest(
        `social_posts?select=ghl_post_id,status&id=eq.${enc(args.postId)}&limit=1`,
      ),
    )[0];
    if (!p) throw new Error("That post is gone.");
    if (String(p.status) === "published")
      throw new Error(
        "That post has already gone out, so there is nothing to change.",
      );
    const body: Row = { updated_at: now() };
    if (args.caption !== undefined) body.caption = clip(args.caption, 2200);
    if (args.topic !== undefined) body.topic = clip(args.topic, 300);
    await rest(`social_posts?id=eq.${enc(args.postId)}`, {
      method: "PATCH",
      prefer: "return=minimal",
      body,
    });
    return null;
  },
});
