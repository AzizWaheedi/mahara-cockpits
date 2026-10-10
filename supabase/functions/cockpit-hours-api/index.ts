// cockpit-hours-api: the CEO's Connections, Sync now and Approve actions for
// hours and pay. Deployed with the JWT check ON. The caller's user id comes
// from the verified JWT and must be the verified CEO (cockpit_hours_actor);
// everyone else gets 403. Deploy with the shared files listed in RUNBOOK.md
// (cockpit-hours-sync/*.ts, cockpit-ceo-api/tools.ts and the three model files).
import { createClient } from "npm:@supabase/supabase-js@2";
import { restReceipts, restRpc } from "../cockpit-hours-sync/db.ts";
import { makeHoursApi } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const runtime = globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } };

Deno.serve(makeHoursApi({
  verifyUser: async jwt => {
    const client = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
    const { data, error } = await client.auth.getUser(jwt);
    return error || !data.user ? null : data.user.id;
  },
  rpc: restRpc(url, serviceKey),
  insertReceipt: restReceipts(url, serviceKey),
  fetch,
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  now: () => new Date(),
  waitUntil: work => {
    const background = runtime.EdgeRuntime?.waitUntil;
    if (background) background(work);
  },
}));
