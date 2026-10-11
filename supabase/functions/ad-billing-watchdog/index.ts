import { makeHandler } from "./handler.ts";
const url = Deno.env.get("SUPABASE_URL") ?? "";
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
Deno.serve(makeHandler({
  secret: Deno.env.get("CRON_SECRET") ?? "",
  slackToken: Deno.env.get("SLACK_BOT_TOKEN") ?? "",
  fetch,
  rpc: async (name, args = {}) => {
    if (url !== "https://bldgtotkfmhoxmlzowdx.supabase.co" || !key || !["cockpit_ad_billing_watchdog_claim", "cockpit_ad_billing_watchdog_result"].includes(name))
      throw new Error("Watchdog configuration is invalid");
    const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(args), redirect: "error", signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error("Watchdog database request failed");
    return await r.json();
  },
}));
