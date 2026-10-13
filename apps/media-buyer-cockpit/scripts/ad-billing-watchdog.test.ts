import { test, expect } from "bun:test";
import { cockpitTestDb, migration } from "./lib/cockpitTestDb";
import { makeHandler } from "../../../supabase/functions/ad-billing-watchdog/handler";

test("external watchdog is service-only and deduplicates stale, unknown and recovered incidents", async () => {
  const db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  try {
    await db.exec(migration("20261011174920_ad_billing_guard.sql"));
    await db.exec(migration("20261011195000_ad_billing_watchdog.sql"));
    const call = async () => (await db.query<any>("select cockpit_ad_billing_watchdog_claim() as event")).rows[0].event;
    expect(await call()).toBeNull();
    await db.exec("update cockpit_ad_billing_config set apply=true,last_finished_at=now()-interval '20 minutes' where singleton");
    const event = await call(); expect(event.kind).toBe("stale"); expect(await call()).toBeNull();
    await db.query("select cockpit_ad_billing_watchdog_result($1,'unknown')", [event.id]);
    expect(await call()).toBeNull();
    await db.exec("update cockpit_ad_billing_config set last_finished_at=now() where singleton");
    const recovered = await call(); expect(recovered.kind).toBe("healthy");
    await expect(db.query("select cockpit_ad_billing_watchdog_result($1,'accepted')", [recovered.id])).rejects.toThrow("receipt");
    expect(await call()).toBeNull();
    await db.exec("update cockpit_ad_billing_config set apply=false,last_finished_at=null where singleton");
    expect(await call()).toBeNull();
    await db.exec("set role authenticated");
    await expect(db.query("select * from cockpit_ad_billing_watchdog")).rejects.toThrow("permission");
    await expect(db.query("select cockpit_ad_billing_watchdog_claim()")).rejects.toThrow("permission");
  } finally { await db.close(); }
});

function harness(mode = "ok") {
  let posts = 0; const results: any[] = [];
  const handler = makeHandler({ secret: "synthetic", slackToken: "synthetic", rpc: async (name, args) => {
    if (name.endsWith("claim")) return { id: "f8b5c9bd-9a0c-44b5-8748-6e6e808877d8", kind: "stale" };
    results.push(args); return true;
  }, fetch: (async (url: any, init: any) => {
    if (String(url).includes("conversations.info")) return Response.json({ok:true,channel:{is_private:true}});
    posts++; expect(JSON.parse(init.body).channel).toBe("C0BC6MPL6LU");
    if (mode === "timeout") throw new Error("Timeout");
    if (mode === "empty") return new Response(null, { status: 204 });
    if (mode === "refused") return Response.json({ok:false});
    return Response.json({ok:true,ts:"123.456"});
  }) as typeof fetch });
  const request = (body = {}, secret = "synthetic") => handler(new Request("https://example.test", {method:"POST",headers:{"x-cron-secret":secret},body:JSON.stringify(body)}));
  return {request,posts:()=>posts,results};
}
test("authentication and request validation run before any side effects", async () => {
  const h=harness();expect((await h.request({},"wrong")).status).toBe(401);
  expect((await h.request({destination:"unapproved"})).status).toBe(400);expect(h.posts()).toBe(0);
});
test("protected channel probe sends no message", async () => {
  const h=harness();expect((await h.request({probe:true})).status).toBe(200);expect(h.posts()).toBe(0);
});
test("external alert records the Slack receipt", async () => {
  const h=harness();expect((await h.request()).status).toBe(200);expect(h.posts()).toBe(1);
  expect(h.results[0].p_provider_id).toBe("123.456");
});
test.each(["timeout","empty"])("%s preserves unknown without another POST", async mode => {
  const h=harness(mode);expect((await h.request()).status).toBe(503);expect(h.posts()).toBe(1);expect(h.results[0].p_state).toBe("unknown");
});
test("explicit Slack refusal is recorded as failed", async () => {
  const h=harness("refused");expect((await h.request()).status).toBe(503);expect(h.results[0].p_state).toBe("failed");
});
