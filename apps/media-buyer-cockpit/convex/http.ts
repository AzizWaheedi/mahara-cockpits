// PHI console redaction (active only on PHI deployments).
import "./phiLogging";
import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";

declare const process: { env: Record<string, string | undefined> };

const http = httpRouter();
// Registers Convex Auth's routes, including the OAuth endpoints used by
// "Sign in with Viktor": /api/auth/signin/viktor and /api/auth/callback/viktor.
auth.addHttpRoutes(http);

/**
 * The "Ask AI" door for the outside worker (Hermes). See askAi.ts.
 *
 * Guarded by a bearer token (ASKAI_TOKEN on the deployment). The token grants
 * exactly two things: read the open questions, and hand back answers.
 */
function authorized(request: Request): boolean {
  const expected = process.env.ASKAI_TOKEN;
  return (
    Boolean(expected) &&
    request.headers.get("authorization") === `Bearer ${expected}`
  );
}

http.route({
  path: "/askai/pending",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return new Response("no", { status: 401 });
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 10);
    const jobs = await ctx.runMutation(internal.askAi.pending, { limit });
    await ctx.runMutation(internal.askAi.heartbeat, {});
    return Response.json({ ok: true, jobs });
  }),
});

http.route({
  path: "/askai/result",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return new Response("no", { status: 401 });
    const body = (await request.json()) as {
      id: string;
      result?: unknown;
      error?: string;
    };
    if (!body?.id)
      return Response.json(
        { ok: false, error: "id required" },
        { status: 400 },
      );
    try {
      const out = await ctx.runMutation(internal.askAi.complete, {
        id: body.id as never,
        result: body.result,
        error: body.error,
      });
      return Response.json(out);
    } catch (e) {
      return Response.json(
        { ok: false, error: String(e).slice(0, 300) },
        { status: 400 },
      );
    }
  }),
});

http.route({
  path: "/askai/health",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return new Response("no", { status: 401 });
    return Response.json({
      ok: true,
      ...(await ctx.runQuery(internal.askAi.health, {})),
    });
  }),
});

/**
 * Hermes acts on the ad accounts through here. Any Graph call, the cockpit's
 * own token, everything logged (agentActions.ts). Body:
 * { method: "GET"|"POST"|"DELETE", path: "act_123/campaigns", params: {...},
 *   jobId?: "<the chat job this belongs to>", note?: "<what this is for>",
 *   campaignName?: "<to log into that campaign's thread>" }
 */
http.route({
  path: "/askai/meta",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return new Response("no", { status: 401 });
    const body = (await request.json()) as {
      method?: string;
      path?: string;
      params?: Record<string, unknown>;
      jobId?: string;
      note?: string;
      campaignName?: string;
    };
    if (!body?.path || !body?.method)
      return Response.json(
        { ok: false, error: "method and path required" },
        { status: 400 },
      );
    const out = await ctx.runAction(internal.agentActions.meta, {
      method: body.method,
      path: body.path,
      params: body.params,
      jobId: body.jobId,
      note: body.note,
      campaignName: body.campaignName,
    });
    return Response.json(out, { status: out.ok ? 200 : 400 });
  }),
});

/** The ad accounts Hermes may act on, with status. */
http.route({
  path: "/askai/accounts",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!authorized(request)) return new Response("no", { status: 401 });
    return Response.json({
      ok: true,
      accounts: await ctx.runAction(internal.agentActions.accounts, {}),
    });
  }),
});

export default http;
