export interface WatchdogDeps {
  secret: string;
  slackToken: string;
  rpc: (name: string, args?: Record<string, unknown>) => Promise<any>;
  fetch: typeof fetch;
}
const channel = "C0BC6MPL6LU"; // #mahara-systems-health. Monitor health only, never client billing cards.
const lines: Record<string, string> = {
  stale: "Ad billing monitoring has no completed check within 30 minutes. Check the VPS worker before relying on automatic client alerts.",
  source_error: "Ad billing monitoring cannot verify one or more source records. Review Ad billing watch in the media buyer cockpit.",
  delivery_error: "An ad billing notification is delayed, failed, or has an unknown result. Check its receipt before retrying.",
  healthy: "Ad billing monitoring is current again. This confirms monitor health, not campaign delivery or payment completion.",
};
export function makeHandler(d: WatchdogDeps) {
  return async (req: Request) => {
    const reply = (status: number, body: unknown) => Response.json(body, { status });
    if (req.method !== "POST") return reply(405, { error: "Use POST" });
    if (!d.secret || req.headers.get("x-cron-secret") !== d.secret)
      return reply(401, { error: "Unauthorized" });
    let body: any;
    try { body = await req.json(); } catch { return reply(400, { error: "Invalid JSON" }); }
    if (!body || Array.isArray(body) || typeof body !== "object" || Object.keys(body).some(k => k !== "probe"))
      return reply(400, { error: "Unsupported request" });
    if (!d.slackToken) return reply(503, { error: "Watchdog Slack configuration is missing" });
    if (body.probe === true) {
      try {
        const r = await d.fetch(`https://slack.com/api/conversations.info?channel=${channel}`, {
          headers: { Authorization: `Bearer ${d.slackToken}` }, signal: AbortSignal.timeout(15000), redirect: "error",
        });
        const j = await r.json();
        return reply(j.ok && j.channel?.is_private ? 200 : 503, { ok: j.ok === true && j.channel?.is_private === true, sent: false });
      } catch { return reply(503, { error: "Watchdog channel could not be verified" }); }
    }
    let event: any;
    try { event = await d.rpc("cockpit_ad_billing_watchdog_claim"); }
    catch { return reply(503, { error: "Watchdog database read failed" }); }
    if (!event) return reply(200, { ok: true, sent: false });
    if (!lines[event.kind] || !/^[0-9a-f-]{36}$/.test(event.id)) return reply(503, { error: "Invalid monitor event" });
    let state = "unknown", receipt: string | null = null;
    try {
      const response = await d.fetch("https://slack.com/api/chat.postMessage", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${d.slackToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ channel, client_msg_id: event.id, text: `${lines[event.kind]}\nhttps://cockpit.maharamedia.com\nMonitor reference: BW-${event.id}`, unfurl_links: false }),
      });
      if (response.ok) {
        const j = await response.json();
        if (j.ok === true && typeof j.ts === "string") { state = "accepted"; receipt = j.ts; }
        else if (j.ok === false) state = "failed";
      } else if (response.status >= 400 && response.status < 500 && response.status !== 408) state = "failed";
    } catch { /* Keep unknown. There is no automatic POST retry. */ }
    try {
      if (!await d.rpc("cockpit_ad_billing_watchdog_result", { p_id: event.id, p_state: state, p_provider_id: receipt }))
        return reply(503, { error: "Watchdog receipt was not recorded" });
    } catch { return reply(503, { error: "Watchdog receipt was not recorded" }); }
    return reply(state === "accepted" ? 200 : 503, { ok: state === "accepted", state });
  };
}
