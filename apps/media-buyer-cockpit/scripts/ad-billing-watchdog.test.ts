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

test("a safe stop that a newer event replaced is not a delivery problem; other failures still are", async () => {
  const db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  try {
    for (const f of ["20261011174920_ad_billing_guard.sql", "20261011195000_ad_billing_watchdog.sql",
      "20261013104500_ad_billing_watchdog_quieter.sql", "20261014142708_ad_billing_watchdog_replaced_safe_stop.sql"])
      await db.exec(migration(f));
    const call = async () => (await db.query<any>("select cockpit_ad_billing_watchdog_claim() as event")).rows[0].event;
    const binding = (await db.query<any>(`insert into cockpit_ad_billing_bindings(client_task_id,client_name,account_id,ads_task_ids,
      whatsapp_group,sheet_account_ref,identity_evidence,identity_verified_at,enabled)
      values('abc123','Synthetic client','1234567','{t1}','123-456@g.us','ref','synthetic evidence',now(),true) returning id`)).rows[0].id;
    const event = async (seq: number, signal: string, at: string) => (await db.query<any>(
      "insert into cockpit_ad_billing_events(binding_id,sequence,episode,signal,created_at) values($1,$2,1,$3,$4) returning id",
      [binding, seq, signal, at])).rows[0].id;
    const unsettled = await event(1, "unsettled", "2026-10-14T09:05:00Z");
    const stop = (await db.query<any>(`insert into cockpit_ad_billing_deliveries(event_id,binding_id,revision,channel,destination,body,state,
      error,created_at) values($1,$2,1,'slack','C1','card','failed','Source state changed. Poll again before delivery.',
      '2026-10-14T09:05:18Z') returning id`, [unsettled, binding])).rows[0].id;
    await db.exec("update cockpit_ad_billing_config set apply=true,last_finished_at=now() where singleton");
    expect((await call()).kind).toBe("delivery_error"); // nothing replaced the stop yet
    await event(2, "healthy", "2026-10-14T09:10:00Z");
    expect((await call()).kind).toBe("healthy"); // the next poll handled the change
    await db.query("update cockpit_ad_billing_deliveries set attempts=1 where id=$1", [stop]);
    expect((await call()).kind).toBe("delivery_error"); // a provider refused a real send
    await db.query("update cockpit_ad_billing_deliveries set attempts=0,state='unknown' where id=$1", [stop]);
    expect(await call()).toBeNull(); // still delivery_error: an unknown result always needs a person
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
