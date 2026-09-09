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

export default http;
