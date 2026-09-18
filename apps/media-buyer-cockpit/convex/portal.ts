import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { importPKCS8, SignJWT } from "jose";
import { internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type QueryCtx,
  query,
} from "./_generated/server";
import { bridge } from "./comms";
import { authenticatedMutation, authenticatedQuery } from "./functions";
import { flush, jobRows, sourceRows } from "./health";
import { readJobCounts } from "./migrations";
import { accessFor, assertAdmin, COCKPITS, staticRoles } from "./roles";

/**
 * The portal: one sign-in for every employee, one directory of who opens
 * what, and the door into the other two cockpits.
 *
 * Aziz, 2026-09-12: "combine all of the cockpits into a portal for all the
 * employees … an admin view … depending on which role each team member is
 * assigned … they open up the website and just log in, it automatically
 * brings them to their cockpit."
 *
 * How the door works: this deployment is the identity provider. When a
 * signed-in person goes to a cockpit that lives on another deployment, the
 * portal mints a two-minute token signed with this deployment's own auth key
 * (the same RS256 key Convex Auth uses; the public half is published at
 * /.well-known/jwks.json). The other cockpit verifies the signature against
 * that JWKS and opens its own year-long session. No shared secret to manage.
 */

declare const process: { env: Record<string, string | undefined> };
// biome-ignore lint/suspicious/noExplicitAny: rows
type Any = any;

const AUDIENCE = "mahara-portal";
const TOKEN_TTL_S = 120;
const ROLES = ["admin", ...COCKPITS];

const norm = (e: string) => e.trim().toLowerCase();

// --- Directory ---------------------------------------------------------------------

export const members = authenticatedQuery({
  args: {},
  returns: v.array(v.any()),
  handler: async ctx => {
    await assertAdmin(ctx);
    const rows = (await ctx.db.query("members").collect()).filter(
      r => r.roles.length > 0,
    );
    return rows.sort((a, b) => a.email.localeCompare(b.email));
  },
});

export const upsertMember = authenticatedMutation({
  args: {
    email: v.string(),
    name: v.optional(v.string()),
    roles: v.array(v.string()),
    clients: v.array(v.string()),
    note: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const admin = await assertAdmin(ctx);
    const email = norm(args.email);
    if (!email.includes("@")) throw new Error("That is not an email.");
    const roles = args.roles.filter(r => ROLES.includes(r));
    if (roles.length === 0)
      throw new Error("Give them at least one cockpit or admin.");
    // Do not let the last admin lock everyone out.
    if (email === admin.email && !roles.includes("admin"))
      throw new Error("You cannot remove your own admin role.");
    const existing = await ctx.db
      .query("members")
      .withIndex("by_email", q => q.eq("email", email))
      .unique();
    const patch = {
      name: args.name?.trim() || undefined,
      roles,
      clients: [...new Set(args.clients.map(c => c.trim()).filter(Boolean))],
      note: args.note?.trim() || undefined,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, patch);
    else
      await ctx.db.insert("members", {
        email,
        ...patch,
        addedBy: admin.email,
        addedAt: Date.now(),
      });
    // The other cockpits learn the new seats now, not at the next sign-in.
    await ctx.scheduler.runAfter(0, internal.portal.pushMember, { email });
    return null;
  },
});

export const memberByEmail = internalQuery({
  args: { email: v.string() },
  returns: v.any(),
  handler: async (ctx, { email }) =>
    await ctx.db
      .query("members")
      .withIndex("by_email", q => q.eq("email", norm(email)))
      .unique(),
});

export const allMembers = internalQuery({
  args: {},
  returns: v.array(v.any()),
  handler: async ctx =>
    (await ctx.db.query("members").collect()).map(m => ({
      email: m.email,
      name: m.name,
      roles: m.roles,
      clients: m.clients,
    })),
});

/** One person's seats to the other cockpits (they keep a copy in portalMembers). */
export const pushMember = internalAction({
  args: { email: v.string() },
  returns: v.any(),
  handler: async (ctx, { email }): Promise<Any> => {
    const m: Any = await ctx.runQuery(internal.portal.memberByEmail, { email });
    if (!m) return null;
    const out: Record<string, string> = {};
    for (const app of ["csm", "creative"] as const) {
      try {
        await bridge(app, "upsertMember", {
          email: m.email,
          name: m.name,
          roles: m.roles,
          clients: m.clients,
        });
        out[app] = "ok";
      } catch (e) {
        out[app] = `FAILED ${String(e).slice(0, 120)}`;
      }
    }
    // The editor cockpit has no Convex of its own; its seat list is a
    // Supabase table this deployment writes.
    out.editor = JSON.stringify(
      await ctx.runAction(internal.editorPortal.pushOne, { email: m.email }),
    );
    await flush(ctx);
    return out;
  },
});

/** The whole directory to the other cockpits; runs with the comms feed. */
export const pushMembers = internalAction({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<Any> => {
    const members: Any[] = await ctx.runQuery(internal.portal.allMembers, {});
    const out: Record<string, unknown> = {};
    for (const app of ["csm", "creative"] as const) {
      try {
        out[app] = await bridge(app, "storeMembers", { members });
      } catch (e) {
        out[app] = `FAILED ${String(e).slice(0, 120)}`;
      }
    }
    try {
      out.editor = await ctx.runAction(internal.editorPortal.syncPeople, {});
    } catch (e) {
      out.editor = `FAILED ${String(e).slice(0, 120)}`;
    }
    return out;
  },
});

export const removeMember = authenticatedMutation({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, { email }) => {
    const admin = await assertAdmin(ctx);
    const key = norm(email);
    if (key === admin.email) throw new Error("You cannot remove yourself.");
    const row = await ctx.db
      .query("members")
      .withIndex("by_email", q => q.eq("email", key))
      .unique();
    // Kept with no seats rather than deleted: a row with no roles beats the
    // static fallback, so a removed person stays out.
    const gone = {
      roles: [] as string[],
      clients: [] as string[],
      note: `removed by ${admin.email}`,
      updatedAt: Date.now(),
    };
    if (row) await ctx.db.patch(row._id, gone);
    else
      await ctx.db.insert("members", {
        email: key,
        ...gone,
        addedBy: admin.email,
        addedAt: Date.now(),
      });
    // And the other cockpits drop their copy and end their sessions.
    await ctx.scheduler.runAfter(0, internal.portal.revoke, { email: key });
    return null;
  },
});

/** Tell the other cockpits a person is out. */
export const revoke = internalAction({
  args: { email: v.string() },
  returns: v.any(),
  handler: async (ctx, { email }) => {
    const out: Record<string, string> = {};
    for (const app of ["csm", "creative"] as const) {
      try {
        await bridge(app, "revokeMember", { email });
        out[app] = "revoked";
      } catch (e) {
        out[app] = `FAILED ${String(e).slice(0, 120)}`;
      }
    }
    // With no roles left, this switches their seat off in editor_people, so
    // every row policy in the editor cockpit stops answering for them.
    out.editor = JSON.stringify(
      await ctx.runAction(internal.editorPortal.pushOne, { email }),
    );
    return out;
  },
});

/** Sign-up gate: only people an admin added may create an account. */
export const isMember = internalQuery({
  args: { email: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { email }) => {
    const a = await accessFor(ctx, email);
    return a.roles.length > 0;
  },
});

/** Bring the people from the static map into the table, once. */
export const seed = internalMutation({
  args: {},
  returns: v.number(),
  handler: async ctx => {
    let n = 0;
    for (const email of [
      "aziz@maharamedia.com",
      "awaheedi2008@gmail.com",
      "nada@maharamedia.com",
      "abdulelah@maharamedia.com",
      "abdu@maharamedia.com",
    ]) {
      const existing = await ctx.db
        .query("members")
        .withIndex("by_email", q => q.eq("email", email))
        .unique();
      if (existing) continue;
      await ctx.db.insert("members", {
        email,
        roles: staticRoles(email),
        clients: [],
        addedBy: "seed",
        addedAt: Date.now(),
      });
      n++;
    }
    return n;
  },
});

/** Every client name the cockpits know, for the client-access picker. */
export const clientNames = authenticatedQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async ctx => {
    await assertAdmin(ctx);
    const names = new Set<string>();
    for (const c of await ctx.db.query("clients").collect()) names.add(c.name);
    for (const c of await ctx.db.query("campaigns").collect())
      if (c.clientName) names.add(c.clientName);
    return [...names].sort((a, b) => a.localeCompare(b));
  },
});

// --- Health for the admin view ----------------------------------------------------------

export const recordHealth = internalMutation({
  args: { app: v.string(), ok: v.boolean(), checks: v.array(v.any()) },
  returns: v.null(),
  handler: async (ctx, { app, ok, checks }) => {
    const row = await ctx.db
      .query("cockpitHealth")
      .withIndex("by_app", q => q.eq("app", app))
      .unique();
    const doc = { app, ok, checks, at: Date.now() };
    if (row) await ctx.db.patch(row._id, doc);
    else await ctx.db.insert("cockpitHealth", doc);
    return null;
  },
});

// Separate subscriptions keep a routine heartbeat from re-reading job history,
// campaign data and the audit log. Keep the old entry point during the rollout.
const healthResult = v.array(
  v.object({
    app: v.string(),
    ok: v.boolean(),
    at: v.number(),
    failing: v.array(v.string()),
  }),
);
const sourceResult = v.array(
  v.object({
    source: v.string(),
    label: v.string(),
    owner: v.string(),
    fix: v.string(),
    ok: v.optional(v.boolean()),
    streak: v.number(),
    lastOkAt: v.optional(v.number()),
    lastFailAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    at: v.optional(v.number()),
  }),
);
const jobsResult = v.array(
  v.object({
    job: v.string(),
    ok: v.boolean(),
    at: v.number(),
    ms: v.number(),
    error: v.optional(v.string()),
    streak: v.number(),
    everyMin: v.number(),
  }),
);
const activityResult = v.object({
  lastSync: v.union(
    v.null(),
    v.object({
      at: v.number(),
      ok: v.boolean(),
      problems: v.array(v.string()),
    }),
  ),
  alerts: v.array(v.object({ text: v.string(), at: v.number() })),
});
const actionsResult = v.array(
  v.object({ at: v.number(), note: v.string(), ok: v.boolean() }),
);
const hermesResult = v.object({
  queued: v.number(),
  claimed: v.number(),
  recentDone: v.array(v.number()),
  lastDone: v.union(v.number(), v.null()),
});
const countsResult = v.object({
  campaigns: v.number(),
  liveCampaigns: v.number(),
  clients: v.number(),
  members: v.number(),
  admins: v.number(),
});

async function healthRows(ctx: QueryCtx) {
  return (await ctx.db.query("cockpitHealth").take(20)).map(h => ({
    app: h.app,
    ok: h.ok,
    at: h.at,
    failing: h.checks.filter((c: Any) => !c.ok).map((c: Any) => String(c.name)),
  }));
}
async function activityRows(ctx: QueryCtx) {
  const lastSync = (
    await ctx.db.query("syncRuns").withIndex("by_at").order("desc").take(10)
  ).find(r => r.role !== "csm");
  return {
    lastSync: lastSync
      ? { at: lastSync.at, ok: lastSync.ok, problems: lastSync.problems ?? [] }
      : null,
    alerts: (await ctx.db.query("alerts").order("desc").take(8)).map(a => ({
      text: a.text,
      at: a.at,
    })),
  };
}
async function actionRows(ctx: QueryCtx) {
  // Use the event timestamp, including actions inserted by a later backfill.
  return (
    await ctx.db.query("agentActions").withIndex("by_at").order("desc").take(8)
  ).map(a => ({ at: a.at, note: a.note ?? `${a.method} ${a.path}`, ok: a.ok }));
}
async function hermesRows(ctx: QueryCtx, since: number) {
  const queued = await ctx.db
    .query("aiJobs")
    .withIndex("by_status", q => q.eq("status", "queued"))
    .collect();
  const claimed = await ctx.db
    .query("aiJobs")
    .withIndex("by_status", q => q.eq("status", "claimed"))
    .collect();
  // Preserve exact figures while the additive migration is being rolled out.
  if (!(await readJobCounts(ctx))) {
    const jobs = await ctx.db.query("aiJobs").collect();
    return {
      queued: queued.length,
      claimed: claimed.length,
      recentDone: jobs.filter(j => (j.doneAt ?? 0) > since).map(j => j.doneAt!),
      lastDone: jobs.reduce((at, j) => Math.max(at, j.doneAt ?? 0), 0) || null,
    };
  }
  const recent = await ctx.db
    .query("aiJobsDone")
    .withIndex("by_doneAt", q => q.gt("doneAt", since))
    .collect();
  const last = await ctx.db
    .query("aiJobsDone")
    .withIndex("by_doneAt")
    .order("desc")
    .first();
  return {
    queued: queued.length,
    claimed: claimed.length,
    recentDone: recent.map(j => j.doneAt!),
    lastDone: last?.doneAt || null,
  };
}
async function countRows(ctx: QueryCtx) {
  // These current tables are intentionally independent of heartbeat changes.
  // Do not read portalStats until every writer keeps it transactionally current.
  const campaigns = await ctx.db.query("campaigns").collect();
  const clients = await ctx.db.query("clients").collect();
  const members = await ctx.db.query("members").collect();
  return {
    campaigns: campaigns.length,
    liveCampaigns: campaigns.filter(
      c => !c.internal && /live/i.test(String(c.boardAdStatus ?? "")),
    ).length,
    clients: clients.length,
    members: members.length,
    admins: members.filter(m => m.roles.includes("admin")).length,
  };
}

export const adminHealth = authenticatedQuery({
  args: {},
  returns: healthResult,
  handler: async ctx => {
    await assertAdmin(ctx);
    return healthRows(ctx);
  },
});
export const adminSources = authenticatedQuery({
  args: {},
  returns: sourceResult,
  handler: async ctx => {
    await assertAdmin(ctx);
    return sourceRows(ctx);
  },
});
export const adminJobs = authenticatedQuery({
  args: {},
  returns: jobsResult,
  handler: async ctx => {
    await assertAdmin(ctx);
    return jobRows(ctx);
  },
});
export const adminActivity = authenticatedQuery({
  args: {},
  returns: activityResult,
  handler: async ctx => {
    await assertAdmin(ctx);
    return activityRows(ctx);
  },
});
export const adminActions = authenticatedQuery({
  args: {},
  returns: actionsResult,
  handler: async ctx => {
    await assertAdmin(ctx);
    return actionRows(ctx);
  },
});
export const adminHermes = authenticatedQuery({
  args: { since: v.number() },
  returns: hermesResult,
  handler: async (ctx, { since }) => {
    await assertAdmin(ctx);
    // The UI requests a rolling day plus a small overlap, never unlimited history.
    return hermesRows(ctx, Math.max(since, Date.now() - 26 * 3600_000));
  },
});
export const adminCounts = authenticatedQuery({
  args: {},
  returns: countsResult,
  handler: async ctx => {
    await assertAdmin(ctx);
    return countRows(ctx);
  },
});

export const overview = authenticatedQuery({
  args: {},
  returns: v.any(),
  handler: async (ctx): Promise<Any> => {
    await assertAdmin(ctx);
    const since = Date.now() - 86400_000;
    const hermes = await hermesRows(ctx, since);
    const heartbeat = await ctx.db
      .query("sourceHealth")
      .withIndex("by_source", q => q.eq("source", "hermes"))
      .unique();
    return {
      health: await healthRows(ctx),
      sources: await sourceRows(ctx),
      scheduled: await jobRows(ctx),
      ...(await activityRows(ctx)),
      counts: await countRows(ctx),
      hermesWaiting: {
        queued: hermes.queued,
        claimed: hermes.claimed,
        lastPollAt: heartbeat?.lastOkAt,
      },
      hermes: {
        queued: hermes.queued,
        doneToday: hermes.recentDone.length,
        lastDone: hermes.lastDone,
        actions: (await actionRows(ctx)).filter(a => a.at > since),
      },
    };
  },
});

// --- The door into the other cockpits ---------------------------------------------------

export const accessByUser = internalQuery({
  args: { userId: v.id("users") },
  returns: v.any(),
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    const a = await accessFor(ctx, user?.email);
    return { ...a, name: user?.name ?? a.name };
  },
});

export const touch = internalMutation({
  args: { email: v.string(), cockpit: v.string() },
  returns: v.null(),
  handler: async (ctx, { email, cockpit }) => {
    const row = await ctx.db
      .query("members")
      .withIndex("by_email", q => q.eq("email", norm(email)))
      .unique();
    if (row)
      await ctx.db.patch(row._id, {
        lastSeenAt: Date.now(),
        lastCockpit: cockpit,
      });
    return null;
  },
});

/** The env holds the PEM with its newlines flattened to spaces; rebuild it. */
export function pkcs8Pem(raw: string | undefined): string {
  // Headers sit between dashes and base64 never contains one, so this is
  // safe however the newlines were mangled on the way into the env.
  const body = (raw ?? "").replace(/-----[^-]*-----/g, "").replace(/\s+/g, "");
  if (!body) throw new Error("JWT_PRIVATE_KEY is not set.");
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----`;
}

async function sign(claims: Record<string, unknown>): Promise<string> {
  const key = await importPKCS8(pkcs8Pem(process.env.JWT_PRIVATE_KEY), "RS256");
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256" })
    .setIssuer(process.env.CONVEX_SITE_URL ?? "")
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_TTL_S}s`)
    .sign(key);
}

/** A two-minute pass into one cockpit for the signed-in person. */
export const mintToken = action({
  args: { cockpit: v.string() },
  returns: v.object({ token: v.string(), path: v.string() }),
  handler: async (
    ctx,
    { cockpit },
  ): Promise<{ token: string; path: string }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");
    const a: Any = await ctx.runQuery(internal.portal.accessByUser, { userId });
    if (!a.cockpits.includes(cockpit))
      throw new Error("That cockpit is not on your access. Ask Aziz.");
    const token = await sign({
      sub: a.email,
      email: a.email,
      name: a.name ?? undefined,
      roles: a.roles,
      clients: a.clients,
      // So a child can draw the switcher without asking the portal again.
      cockpits: a.cockpits,
      cockpit,
    });
    await ctx.runMutation(internal.portal.touch, { email: a.email, cockpit });
    const path =
      cockpit === "csm"
        ? "/client-success"
        : cockpit === "editor"
          ? "/editor"
          : "/creative";
    return { token, path };
  },
});

/** CLI: a pass for someone, to test the door or to hand out a one-off link. */
export const mintFor = internalAction({
  args: { email: v.string(), cockpit: v.string() },
  returns: v.string(),
  handler: async (ctx, { email, cockpit }): Promise<string> => {
    const a: Any = await ctx.runQuery(internal.portal.accessByEmail, { email });
    if (!a.cockpits.includes(cockpit))
      throw new Error("no access to that cockpit");
    return await sign({
      sub: a.email,
      email: a.email,
      name: a.name ?? undefined,
      roles: a.roles,
      clients: a.clients,
      cockpit,
    });
  },
});

export const accessByEmail = internalQuery({
  args: { email: v.string() },
  returns: v.any(),
  handler: async (ctx, { email }) => await accessFor(ctx, email),
});

/** Public: is the portal reachable and which cockpits exist. */
export const info = query({
  args: {},
  returns: v.any(),
  handler: async () => ({ cockpits: COCKPITS, audience: AUDIENCE }),
});
