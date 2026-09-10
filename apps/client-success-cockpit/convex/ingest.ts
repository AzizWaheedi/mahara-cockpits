import { internal } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";

/**
 * The machine door for Viktor's sync bridge, reached over HTTP (`POST /bridge`).
 *
 * Why it exists: the production Convex deployment is unreachable from the sandbox any
 * other way — the CLI only carries a dev-scoped deploy key (so `convex run --prod`
 * silently writes to dev), and the platform's database tool runs queries only. Without
 * this route production had no way to receive data at all, which is why the deployed app
 * sat empty while preview looked perfect.
 *
 * Guarded by a bearer token the bridge alone knows. Convex functions run server-side and
 * are never shipped to the browser, so the token does not leak to app users, and it
 * grants sync rights only: write what the bridge just read, or hand back the queued
 * actions the CSM already took in the app.
 */
declare const process: { env: Record<string, string | undefined> };

// Set BRIDGE_TOKEN on the deployment. The exported value was in the Viktor
// handoff zip, so it is no longer a secret; a deployment without its own token
// refuses every bridge call rather than accepting the old one.
export const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN ?? "";

// biome-ignore lint/suspicious/noExplicitAny: payloads are validated by the mutations
type Args = Record<string, any>;

export async function runBridge(
  ctx: ActionCtx,
  fn: string,
  args: Args,
): Promise<unknown> {
  switch (fn) {
    case "store":
      return await ctx.runMutation(internal.csmSync.store, {
        clients: args.clients,
        tasks: args.tasks,
        checks: args.checks,
      });
    case "storeAppointments":
      return await ctx.runMutation(internal.csmSync.storeAppointments, {
        rows: args.rows,
      });
    case "storeKpi":
      return await ctx.runMutation(internal.csmSync.storeKpi, {
        rows: args.rows,
      });
    case "storeProfiles":
      return await ctx.runMutation(internal.csmSync.storeProfiles, {
        profiles: args.profiles,
        reset: args.reset,
        syncId: args.syncId,
      });
    case "commitProfiles":
      return await ctx.runMutation(internal.csmSync.commitProfiles, {
        syncId: args.syncId,
      });
    case "pending":
      return await ctx.runQuery(internal.outbox.pending, {});
    case "markSent":
      return await ctx.runMutation(internal.outbox.markSent, {
        id: args.id,
        resultUrl: args.resultUrl,
        error: args.error,
      });
    case "pendingReports":
      return await ctx.runQuery(internal.csmQueue.pendingReports, {});
    case "reportDone":
      return await ctx.runMutation(internal.csmQueue.reportDone, {
        id: args.id,
        docUrl: args.docUrl,
        error: args.error,
      });
    case "pendingEods":
      return await ctx.runQuery(internal.csmQueue.pendingEods, {});
    case "eodExported":
      return await ctx.runMutation(internal.csmQueue.eodExported, {
        id: args.id,
        error: args.error,
      });
    case "pendingAsks":
      return await ctx.runQuery(internal.csmQueue.pendingAsks, {});
    case "answerAsk":
      return await ctx.runMutation(internal.csmQueue.answerAsk, {
        id: args.id,
        answer: args.answer,
        error: args.error,
      });
    case "clearLoose":
      return await ctx.runMutation(internal.csmQueue.clearLoose, {});
    case "recentAsks":
      return await ctx.runQuery(internal.csmQueue.recentAsks, {});
    case "profileFor":
      return await ctx.runQuery(internal.csmQueue.profileFor, {
        clientName: args.clientName,
      });
    case "counts": {
      // Verification only: proves the deployed app really holds what the bridge sent.
      const clients = await ctx.runQuery(internal.csmSync.countRows, {});
      return clients;
    }
    case "health":
      return await ctx.runQuery(internal.csmSync.health, {});
    case "recordHealth":
      return await ctx.runMutation(internal.csmSync.recordHealth, {
        ok: args.ok,
        clients: args.clients,
        profiles: args.profiles,
        errors: args.errors,
      });
    case "lastSync":
      return await ctx.runQuery(internal.outbox.lastSync, {});
    case "storeCalendar":
      return await ctx.runMutation(internal.comms.storeCalendar, {
        rows: args.rows ?? [],
      });
    case "smoke":
      return await ctx.runQuery(internal.smoke.run, {});
    case "storeWhatsapp":
      return await ctx.runMutation(internal.comms.storeWhatsapp, {
        threads: args.threads ?? [],
        append: Boolean(args.append),
        clear: Boolean(args.clear),
      });
    default:
      throw new Error(`unknown bridge function: ${fn}`);
  }
}
