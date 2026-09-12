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
        append: Boolean(args.append),
      });
    case "calendarLinks":
      return await ctx.runQuery(internal.comms.calendarLinks, {});
    case "calendarLinkStatus":
      return await ctx.runMutation(internal.comms.calendarLinkStatus, {
        statuses: args.statuses ?? [],
      });
    case "chatPending":
      return await ctx.runQuery(internal.hermes.pending, {});
    case "chatSent":
      return await ctx.runMutation(internal.hermes.markSent, {
        id: args.id,
        jobId: String(args.jobId),
      });
    case "chatReading":
      return await ctx.runMutation(internal.hermes.markReading, {
        id: args.id,
      });
    case "chatAnswer":
      return await ctx.runMutation(internal.hermes.answer, {
        id: args.id,
        text: args.text,
        error: args.error,
      });
    case "storeReplyDraft":
      return await ctx.runMutation(internal.comms.storeReplyDraft, {
        chatId: String(args.chatId),
        draft: String(args.draft),
        draftAt: Number(args.draftAt ?? Date.now()),
      });
    case "markSending":
      return await ctx.runMutation(internal.outbox.markSending, {
        id: args.id,
      });
    case "sendFailed":
      return await ctx.runMutation(internal.comms.sendFailed, {
        chatId: String(args.chatId),
        error: String(args.error ?? "send failed"),
      });
    case "revokeMember":
      return await ctx.runAction(internal.portalAuth.revoke, {
        email: String(args.email),
      });
    case "upsertMember":
      // A seat or client-list change in the portal's admin view.
      return await ctx.runMutation(internal.portalAuth.remember, {
        email: String(args.email),
        name: args.name ? String(args.name) : undefined,
        roles: Array.isArray(args.roles) ? args.roles.map(String) : [],
        clients: Array.isArray(args.clients) ? args.clients.map(String) : [],
      });
    case "storeMembers":
      // The portal's whole member list. Rows come straight from the media buyer's
      // members table (note, addedBy, addedAt, ...), so keep only what we store.
      return await ctx.runMutation(internal.portalAuth.storeMembers, {
        members: (Array.isArray(args.members) ? args.members : [])
          .filter(m => m && typeof m.email === "string")
          .map(m => ({
            email: String(m.email),
            name: m.name ? String(m.name) : undefined,
            roles: Array.isArray(m.roles) ? m.roles.map(String) : [],
            clients: Array.isArray(m.clients) ? m.clients.map(String) : [],
          })),
      });
    case "markReplied":
      return await ctx.runMutation(internal.comms.markReplied, {
        chatId: String(args.chatId),
        text: String(args.text ?? ""),
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
