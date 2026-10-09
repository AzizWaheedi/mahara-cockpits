// cockpit-hours-sync: the hourly and nightly reads of Hubstaff and Timetastic.
// Deployed with the JWT check OFF: pg_cron reaches it with the shared cron
// secret (vault cockpit_sync_secret = function secret CRON_SECRET), and the
// door refuses everyone else before reading the body. Keys come from
// cockpit_hours_keys, never from the environment.
import { restReceipts, restRpc } from "./db.ts";
import { makeSyncDoor } from "./door.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const runtime = globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } };

Deno.serve(makeSyncDoor({
  cronSecret: () => Deno.env.get("CRON_SECRET") ?? "",
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
