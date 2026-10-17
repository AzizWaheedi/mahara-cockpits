// meta-ad-days: every Meta ad, every ad-account day, for the Client
// Performance board (CEO, 2026-10-16). pg_cron (migration
// 20261016121700_meta_ad_days.sql) posts {"job":"hourly"} at minute 7,
// {"job":"nightly"} at 00:20 UTC and {"job":"continue"} every 2 minutes
// while tasks wait. It reads Mahara's business edges for the ad accounts that
// spent, then each account's ad-level insights a day at a time, and writes
// public.cockpit_meta_ad_days and public.cockpit_meta_reach through service
// RPCs. Since 2026-10-17 it also reads every campaign's budget hourly
// (act_<id>/campaigns, into public.cockpit_meta_budgets and
// cockpit_meta_budget_days) and rebuilds the days before from Meta's activity
// log nightly (act_<id>/activities). Reads Meta only, GET only, Graph v25.0.
//
// Deployed with the JWT check OFF: pg_cron reaches it with the shared cron
// secret (vault cockpit_sync_secret = function secret CRON_SECRET), and the
// door refuses everyone else before reading the body. Secrets by name:
// META_SYSTEM_TOKEN, CRON_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Nothing here logs a key.
import { restReceipts, restRpc } from "./db.ts";
import { makeDoor } from "./door.ts";

const env = (name: string) => Deno.env.get(name) ?? "";
const url = env("SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const runtime = globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } };

Deno.serve(
  makeDoor({
    cronSecret: () => env("CRON_SECRET"),
    rpc: restRpc(url, serviceKey),
    insertReceipt: restReceipts(url, serviceKey),
    fetch,
    token: () => env("META_SYSTEM_TOKEN"),
    now: () => Date.now(),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    secrets: () =>
      Object.fromEntries(["META_SYSTEM_TOKEN", "CRON_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].map(k => [k, Boolean(env(k))])),
    waitUntil: work => {
      const background = runtime.EdgeRuntime?.waitUntil;
      if (background) background(work);
    },
  }),
);
