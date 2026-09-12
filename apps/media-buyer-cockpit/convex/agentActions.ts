import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import { allAdAccounts, graph, graphPost } from "./tools";

// biome-ignore lint/suspicious/noExplicitAny: Graph payloads
type Any = any;
declare const process: { env: Record<string, string | undefined> };

/**
 * Hermes's hands on the ad accounts.
 *
 * Aziz, 2026-09-12: "a live chat where it can just talk to the agent, and it
 * can do literally anything with all the ad accounts". This is the door: one
 * guarded endpoint (/askai/meta, see http.ts) that runs any Meta Graph call
 * through the cockpit's own system-user token, so Hermes needs no Meta
 * credentials of his own and every action lands in one log. Actions tied to
 * a chat job are shown back in the thread they came from.
 */

const TRIM = 4000;

function trim(x: unknown): unknown {
  const s = JSON.stringify(x ?? null);
  return s.length > TRIM ? `${s.slice(0, TRIM)}…` : x;
}

export const record = internalMutation({
  args: {
    method: v.string(),
    path: v.string(),
    params: v.optional(v.any()),
    ok: v.boolean(),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    jobId: v.optional(v.string()),
    note: v.optional(v.string()),
    campaignName: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("agentActions", { ...args, at: Date.now() });
    if (args.campaignName) {
      await ctx.runMutation(internal.chat.logInternal, {
        campaignName: args.campaignName,
        text: `Hermes: ${args.note ?? `${args.method} ${args.path}`}${args.ok ? "" : ` — failed: ${args.error ?? ""}`}`,
        ok: args.ok,
      });
    }
    return null;
  },
});

/** What Hermes did while answering one chat message. */
export const forJob = internalQuery({
  args: { jobId: v.string() },
  returns: v.array(v.any()),
  handler: async (ctx, { jobId }) =>
    (await ctx.db.query("agentActions").collect())
      .filter(a => a.jobId === jobId)
      .sort((a, b) => a.at - b.at)
      .map(a => ({
        at: a.at,
        method: a.method,
        path: a.path,
        ok: a.ok,
        note: a.note,
        error: a.error,
      })),
});

/** Any Graph call, with the system-user token, logged. */
export const meta = internalAction({
  args: {
    method: v.string(),
    path: v.string(),
    params: v.optional(v.any()),
    jobId: v.optional(v.string()),
    note: v.optional(v.string()),
    campaignName: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const method = args.method.toUpperCase();
    const path = args.path.replace(/^\/+/, "").replace(/^v\d+\.\d+\//, "");
    const params: Record<string, string | number> = {};
    for (const [k, val] of Object.entries(
      (args.params ?? {}) as Record<string, unknown>,
    )) {
      params[k] =
        typeof val === "string" || typeof val === "number"
          ? val
          : JSON.stringify(val);
    }
    let ok = false;
    let result: unknown;
    let error: string | undefined;
    try {
      if (method === "GET")
        result = await graph(path, params as Record<string, string>);
      else if (method === "POST") result = await graphPost(path, params);
      else if (method === "DELETE") {
        const token = process.env.META_SYSTEM_TOKEN;
        const res = await fetch(
          `https://graph.facebook.com/v21.0/${path}?access_token=${token}`,
          { method: "DELETE" },
        );
        const json: Any = await res.json();
        if (json?.error)
          throw new Error(`Meta ${json.error.code}: ${json.error.message}`);
        result = json;
      } else
        throw new Error(
          `method ${method} not allowed; use GET, POST or DELETE`,
        );
      ok = true;
    } catch (e) {
      error = String(e).slice(0, 400);
    }
    await ctx.runMutation(internal.agentActions.record, {
      method,
      path,
      params: trim(args.params),
      ok,
      result: trim(result),
      error,
      jobId: args.jobId,
      note: args.note,
      campaignName: args.campaignName,
    });
    return { ok, result, error };
  },
});

/** Every ad account the token can reach, with status, for Hermes to pick from. */
export const accounts = internalAction({
  args: {},
  returns: v.any(),
  handler: async () =>
    (await allAdAccounts()).map(a => ({
      id: a.account_id,
      name: a.name,
      status: a.account_status,
      currency: a.currency,
    })),
});
