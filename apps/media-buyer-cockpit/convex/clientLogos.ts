import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalQuery } from "./_generated/server";
import { authenticatedAction } from "./functions";
import { flush } from "./health";
import { allowedClients, assertRole } from "./roles";
import { creativeRequestRest } from "./tools";

// Actions have no database; resolve the role and client scope server-side.
export const scope = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.null(), v.array(v.string())),
  handler: async (ctx, { userId }) => {
    const caller = { ...ctx, userId };
    await assertRole(caller, "media_buyer");
    const clients = await allowedClients(caller);
    return clients === null
      ? null
      : [...clients].map(client => client.trim().toLowerCase());
  },
});

const PUBLIC_BUCKET =
  "https://bldgtotkfmhoxmlzowdx.supabase.co/storage/v1/object/public/cockpit-client-logos/";
// Relative raster-object paths only: no URL, traversal, escapes, query or fragment.
const STORAGE_PATH =
  /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(?:png|jpe?g|webp)$/i;

export const list = authenticatedAction({
  args: {},
  returns: v.record(v.string(), v.string()),
  handler: async (ctx): Promise<Record<string, string>> => {
    try {
      const clients: string[] | null = await ctx.runQuery(
        internal.clientLogos.scope,
        {
          userId: ctx.userId,
        },
      );
      const allowed = clients === null ? null : new Set(clients);
      const rows = await creativeRequestRest<
        { client_key: string; storage_path: string }[]
      >("cockpit_client_logos?select=client_key,storage_path");
      const logos: Record<string, string> = {};
      for (const row of rows) {
        const client = row.client_key.trim().toLowerCase();
        if (allowed !== null && !allowed.has(client)) continue;
        if (!STORAGE_PATH.test(row.storage_path)) continue;
        // Match sync.ts clientTag normalization, only after exact scope matching.
        const key = client.replace(/[^\p{L}\p{N}]/gu, "");
        if (!key) continue;
        logos[key] =
          PUBLIC_BUCKET +
          row.storage_path.split("/").map(encodeURIComponent).join("/");
      }
      return logos;
    } finally {
      await flush(ctx);
    }
  },
});
