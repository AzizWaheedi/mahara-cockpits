// cockpit-hours-watch: Hubstaff watch, every 5 minutes during anyone's shift
// (docs/hours-watch/SPEC.md). Who is on shift and not tracking, idle or not
// working; one Slack post per incident in #team-management, one thread reply
// when it clears, everything on the CEO cockpit's Management tab.
// Deployed with the JWT check OFF: pg_cron reaches it with the shared cron
// secret (vault cockpit_sync_secret = function secret CRON_SECRET), and the
// door refuses everyone else before reading the body. The Hubstaff key comes
// from cockpit_hours_keys and the AI key from cockpit_hours_watch_keys, never
// from the environment; the Slack token is the function secret
// SLACK_BOT_TOKEN, read by name.
import { restRpc } from "../cockpit-hours-sync/db.ts";
import { makeWatchDoor } from "./door.ts";
import { restWatchReceipts } from "./ledger.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const runtime = globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } };

Deno.serve(makeWatchDoor({
  cronSecret: () => Deno.env.get("CRON_SECRET") ?? "",
  rpc: restRpc(url, serviceKey),
  insertReceipt: restWatchReceipts(url, serviceKey),
  fetch,
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  now: () => new Date(),
  slackToken: () => Deno.env.get("SLACK_BOT_TOKEN") ?? "",
  storage: { url, serviceKey },
  secrets: () => ({
    SLACK_BOT_TOKEN: !!Deno.env.get("SLACK_BOT_TOKEN")?.trim(),
    CRON_SECRET: !!Deno.env.get("CRON_SECRET")?.trim(),
  }),
  waitUntil: work => {
    const background = runtime.EdgeRuntime?.waitUntil;
    if (background) background(work);
  },
}));
