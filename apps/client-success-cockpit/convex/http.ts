// PHI console redaction (active only on PHI deployments).
import "./phiLogging";
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { BRIDGE_TOKEN, runBridge } from "./ingest";

const http = httpRouter();
// Registers Convex Auth's routes, including the OAuth endpoints used by
// "Sign in with Viktor": /api/auth/signin/viktor and /api/auth/callback/viktor.
auth.addHttpRoutes(http);

/**
 * The sync door for Viktor's bridge.
 *
 * Production Convex cannot be written any other way from outside: the CLI only holds a
 * dev key, and the platform's query tool runs queries only. This one POST route, guarded
 * by a bearer token the bridge alone knows, is how the deployed app receives its data.
 */
http.route({
  path: "/bridge",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (request.headers.get("authorization") !== `Bearer ${BRIDGE_TOKEN}`) {
      return new Response("no", { status: 401 });
    }
    const { fn, args } = (await request.json()) as {
      fn: string;
      args?: Record<string, unknown>;
    };
    try {
      const data = await runBridge(ctx, fn, args ?? {});
      return Response.json({ ok: true, data });
    } catch (error) {
      return Response.json(
        { ok: false, error: String(error) },
        { status: 400 },
      );
    }
  }),
});

export default http;
