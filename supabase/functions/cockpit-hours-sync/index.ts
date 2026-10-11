// cockpit-hours-sync: the hourly and nightly reads of Hubstaff and Timetastic,
// and the morning hours note to the CEO ({"op":"nudge"}, nudge.ts).
// Deployed with the JWT check OFF: pg_cron reaches it with the shared cron
// secret (vault cockpit_sync_secret = function secret CRON_SECRET), and the
// door refuses everyone else before reading the body. Hubstaff and
// Timetastic keys come from cockpit_hours_keys, never from the environment;
// the note's Slack token is the function secret SLACK_BOT_TOKEN, read by name.
import { restReceipts, restRpc } from "./db.ts";
import { makeSyncDoor } from "./door.ts";
import { runNudge } from "./nudge.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const runtime = globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } };
const rpc = restRpc(url, serviceKey);
const insertReceipt = restReceipts(url, serviceKey);

Deno.serve(makeSyncDoor({
  cronSecret: () => Deno.env.get("CRON_SECRET") ?? "",
  rpc,
  insertReceipt,
  fetch,
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  now: () => new Date(),
  waitUntil: work => {
    const background = runtime.EdgeRuntime?.waitUntil;
    if (background) background(work);
  },
  // The morning hours note (A372): one Slack message to the CEO, only when he
  // switched it on in the Hours tab. Nobody else is ever messaged.
  nudge: opts => runNudge({
    rpc,
    insertReceipt,
    fetch,
    now: () => new Date(),
    slackToken: () => Deno.env.get("SLACK_BOT_TOKEN") ?? "",
    ceoEmail: "aziz@maharamedia.com",
    hoursUrl: "https://cockpit.maharamedia.com/ceo?tab=team",
  }, opts),
}));
