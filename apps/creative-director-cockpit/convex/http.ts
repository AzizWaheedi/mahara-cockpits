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

/** The feed door. The media buyer's backend pushes rows here after every sync. */
http.route({
  path: "/bridge",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    if (
      !BRIDGE_TOKEN ||
      request.headers.get("authorization") !== `Bearer ${BRIDGE_TOKEN}`
    ) {
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
