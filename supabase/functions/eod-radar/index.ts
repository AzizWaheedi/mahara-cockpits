// eod-radar: EOD Radar, every 30 minutes (pg_cron mahara-eod-radar, migration
// 20261015210000). Reads the five Slack EOD channels as mahara-club-bot,
// credits each person's EOD for their working day (on time, late, missed,
// leave, off, or not read when Slack would not let it read), writes the rows
// for the CEO's Management tab and, after 23:00 Kuwait, posts one closeout
// message in #team-management. Nobody is messaged directly; reminders and
// strikes are not built.
//
// Deployed with the JWT check OFF: pg_cron reaches it with the shared cron
// secret (vault cockpit_sync_secret = function secret CRON_SECRET), and the
// door refuses everyone else before reading the body. The Slack token is the
// function secret SLACK_BOT_TOKEN, read by name.
import { restRpc } from "../cockpit-hours-sync/db.ts";
import { makeDoor } from "./door.ts";
import type { ReceiptRow } from "./run.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const runtime = globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } };

/** Receipts into cockpit_eod_radar_receipts with the service key; a receipt that cannot be saved stops the call. */
async function insertReceipt(row: ReceiptRow): Promise<void> {
  const res = await fetch(`${url}/rest/v1/cockpit_eod_radar_receipts`, {
    method: "POST",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error("The radar's Slack receipt could not be saved; no call was made without one.");
}

Deno.serve(
  makeDoor({
    cronSecret: () => Deno.env.get("CRON_SECRET") ?? "",
    rpc: restRpc(url, serviceKey),
    insertReceipt,
    fetch,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    now: () => new Date(),
    token: () => Deno.env.get("SLACK_BOT_TOKEN") ?? "",
    runId: () => crypto.randomUUID(),
    waitUntil: work => {
      const background = runtime.EdgeRuntime?.waitUntil;
      if (background) background(work);
    },
  }),
);
