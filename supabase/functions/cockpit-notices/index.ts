// cockpit-notices: the cockpit's Slack notices for the kickoff and the Brand
// Blueprint (docs/forms/STAGE1-CONTRACT.md section 4; README.md here).
// Deployed with the JWT check OFF: pg_cron (mahara-slack-notices, every
// minute, only when there is work) reaches it with the shared secret (vault
// cockpit_notices_cron_secret = function secret NOTICES_CRON_SECRET), and the
// door refuses everyone else before reading the body. It posts as
// mahara-club-bot with the function secret SLACK_BOT_TOKEN and reads card
// comments with CLICKUP_API_TOKEN, both read by name and never written
// anywhere. Every call is receipted in cockpit_csm_provider_health.
import { restRpc } from "../cockpit-hours-sync/db.ts";
import { makeNoticesDoor } from "./door.ts";
import { restHealth } from "./send.ts";

const env = (name: string) => Deno.env.get(name) ?? "";
const url = env("SUPABASE_URL");
const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY");
const runtime = globalThis as typeof globalThis & { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } };

Deno.serve(makeNoticesDoor({
  cronSecret: () => env("NOTICES_CRON_SECRET"),
  rpc: restRpc(url, serviceKey),
  insertHealth: restHealth(url, serviceKey),
  fetch,
  now: () => new Date(),
  sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  slackToken: () => env("SLACK_BOT_TOKEN"),
  clickupToken: () => env("CLICKUP_API_TOKEN"),
  botUser: () => env("NOTICES_BOT_USER").trim() || "U0C0MJZNS2Y",
  alertTo: () => env("ALERT_SLACK_TO").trim() || "U09305KE2KS",
  secrets: () => ({
    SLACK_BOT_TOKEN: !!env("SLACK_BOT_TOKEN").trim(),
    CLICKUP_API_TOKEN: !!env("CLICKUP_API_TOKEN").trim(),
    NOTICES_CRON_SECRET: !!env("NOTICES_CRON_SECRET").trim(),
  }),
  waitUntil: work => {
    const background = runtime.EdgeRuntime?.waitUntil;
    if (background) background(work);
  },
}));
