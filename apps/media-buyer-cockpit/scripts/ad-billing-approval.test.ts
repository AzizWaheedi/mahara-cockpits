import { beforeAll, afterAll, beforeEach, test, expect } from "bun:test";
import { cockpitTestDb, migration, member, actor, owner } from "./lib/cockpitTestDb";
import { clientMessage } from "../../../hermes/ad-billing-guard/core";
import { Transport, billingBlocks, type Delivery } from "../../../hermes/ad-billing-guard/transport";
let db: Awaited<ReturnType<typeof cockpitTestDb>>;
const lease = "00000000-0000-4000-8000-000000000001";
const uid = "00000000-0000-4000-8000-000000000002";
const bid = "00000000-0000-4000-8000-000000000003";
const buyer = "00000000-0000-4000-8000-000000000004";
const claim = "00000000-0000-4000-8000-000000000005";
async function scalar(sql: string, args: any[] = []) { return Object.values((await db.query(sql,args)).rows[0])[0] as any; }
async function observe(signal="unsettled", suffix="1234", error: string | null=null) {
 await owner(db);
 await db.query("select cockpit_ad_billing_observe($1,$2,1,$3,$4,$5,$6,$7)", [lease,bid,signal,suffix,error,clientMessage(signal as any,suffix),"Verified synthetic observation only"]);
}
async function review() { await owner(db); return (await db.query<any>("select * from cockpit_ad_billing_reviews order by created_at desc,id desc limit 1")).rows[0]; }
async function decide(decision="approve", body: string | null=null, reason: string | null=null) { const r=await review(); await actor(db,uid); return scalar("select cockpit_ad_billing_decide($1,$2,$3,$4,$5)",[r.id,r.version,decision,body,reason]); }
async function acceptedSlack() {
 await db.exec("update cockpit_ad_billing_deliveries set state='accepted',provider_id=extract(epoch from now())::text where channel='slack'");
}
beforeAll(async()=>{
 db=await cockpitTestDb({supabaseDefaultPrivileges:true});
 for(const name of ["20261011174920_ad_billing_guard.sql","20261011192500_ad_billing_roster_safe_update.sql","20261012110708_ad_billing_approval.sql","20261012114355_ad_billing_shared_reviewers.sql","20261012115521_ad_billing_quiet_slack_cards.sql","20261012120601_ad_billing_close_slack_review.sql"]) await db.exec(migration(name));
 await member(db,uid,"csm@example.test",["csm"]); await member(db,buyer,"buyer@example.test",["media_buyer"]);
});
afterAll(async()=>await db?.close());
beforeEach(async()=>{
 await owner(db); await db.exec("truncate cockpit_ad_billing_bindings,cockpit_ad_billing_events,cockpit_ad_billing_reviews,cockpit_ad_billing_deliveries,cockpit_ad_billing_daily_reviews cascade");
 await db.query("update cockpit_ad_billing_config set apply=true,lease=$1,lease_until=now()+interval '10 minutes',last_finished_at=now(),last_error=null",[lease]);
 await db.query("insert into cockpit_ad_billing_bindings(id,client_task_id,client_name,account_id,ads_task_ids,whatsapp_group,sheet_account_ref,identity_evidence,identity_verified_at,enabled,manual_cutover_verified,manual_cutover_evidence) values($1,'client1','Synthetic Client','123456',array['ads1'],'12345@g.us','123456','Synthetic proof only',now(),true,true,'Manual cutover verified')",[bid]);
 await db.query("update cockpit_members set active=true,clients='{}',roles=array['csm'] where auth_user_id=$1",[uid]);
 await db.query("update cockpit_members set active=true,clients='{}',roles=array['media_buyer'] where auth_user_id=$1",[buyer]);
});
test("observation creates two review cards and ClickUp comments but NO WhatsApp",async()=>{
 await observe(); expect(await scalar("select count(*) from cockpit_ad_billing_reviews")).toBe(1);
 expect(await scalar("select count(*) from cockpit_ad_billing_deliveries where channel='whatsapp'")).toBe(0);
 expect(await scalar("select count(*) from cockpit_ad_billing_deliveries where channel='slack'")).toBe(2);
 expect(await scalar("select count(*) from cockpit_ad_billing_deliveries where channel='clickup'")).toBe(2);
 await observe(); expect(await scalar("select count(*) from cockpit_ad_billing_deliveries")).toBe(4);
});
test("approve edited message queues exactly the approved body; repeat click cannot send twice",async()=>{
 await observe(); const r=await review(); await decide("approve","رسالة مراجعة وتحديث وسيلة الدفع من الاختبار"); await owner(db);
 expect(await scalar("select body from cockpit_ad_billing_deliveries where channel='whatsapp'")).toBe("رسالة مراجعة وتحديث وسيلة الدفع من الاختبار");
 await actor(db,uid); await expect(scalar("select cockpit_ad_billing_decide($1,$2,'approve',null,null)",[r.id,r.version])).rejects.toThrow("review changed");
 await owner(db); expect(await scalar("select count(*) from cockpit_ad_billing_deliveries where channel='whatsapp'")).toBe(1);
});
test("denial requires reason and no new pending draft is generated for 72 hours",async()=>{
 await observe(); await expect(decide("deny",null," ")).rejects.toThrow("written denial reason");
 await decide("deny",null,"Client already handling this with the bank"); await observe();
 expect((await review()).state).toBe("denied"); expect(await scalar("select count(*) from cockpit_ad_billing_reviews")).toBe(1);
 expect(await scalar("select count(*) from cockpit_ad_billing_deliveries where channel='whatsapp'")).toBe(0);
});
test("anonymous, inactive and wrong-client CSM cannot approve",async()=>{
 await observe();const r=await review();
 for(const who of [null]) {await actor(db,who);await expect(scalar("select cockpit_ad_billing_decide($1,1,'approve',null,null)",[r.id])).rejects.toThrow();}
 await owner(db);await db.query("update cockpit_members set active=false where auth_user_id=$1",[uid]);await expect(decide()).rejects.toThrow("billing reviewer access");
 await owner(db);await db.query("update cockpit_members set active=true,clients=array['Other Client'] where auth_user_id=$1",[uid]);await expect(decide()).rejects.toThrow("billing reviewer access");
});
test("raw review tables and service helpers are inaccessible to browser roles",async()=>{
 await actor(db,uid);await expect(db.query("select * from cockpit_ad_billing_reviews")).rejects.toThrow();
 await expect(db.query("select cockpit_ad_billing_refresh_cards($1)",[bid])).rejects.toThrow();
 await actor(db,null);await expect(db.query("select cockpit_ad_billing_review_panel()")).rejects.toThrow();
});
test("source failures and stale checks block decisions; no inferred bank decline",async()=>{
 await observe();await observe("unsettled","1234","Source unavailable");await expect(decide()).rejects.toThrow("fresh matching source");
 expect(clientMessage("unsettled","1234")).toContain("⚠️");expect(clientMessage("unsettled","1234")).toContain("١٢٣٤");
 expect(clientMessage("unsettled","1234")).not.toContain("ثلاث");
});
test("material changes expire approval and require a new decision",async()=>{
 await observe("payment_grace");await decide();await observe("unsettled");
 expect((await review()).state).toBe("pending");
 expect(await scalar("select state from cockpit_ad_billing_deliveries where channel='whatsapp'")).toBe("skipped");
});
test("different card suffix expires approval even without status change",async()=>{
 await observe();await decide();await observe("unsettled","9876");expect((await review()).state).toBe("pending");
 expect(await scalar("select state from cockpit_ad_billing_deliveries where channel='whatsapp'")).toBe("skipped");
});
test("old worker or unapproved service intent cannot begin WhatsApp delivery",async()=>{
 await observe();const r=await review();
 const id=await scalar("insert into cockpit_ad_billing_deliveries(event_id,binding_id,revision,channel,destination,body,state,claim,claimed_at) values($1,$2,1,'whatsapp','12345@g.us','Unapproved legacy message','claimed',$3,now()) returning id",[r.event_id,bid,claim]);
 expect(await scalar("select cockpit_ad_billing_begin_send($1,$2)",[id,claim])).toBe(false);
});
test("approval revoked by access removal before send",async()=>{
 await observe();await decide();await owner(db);
 await db.query("update cockpit_ad_billing_deliveries set state='claimed',claim=$1,claimed_at=now() where channel='whatsapp'",[claim]);
 const id=await scalar("select id from cockpit_ad_billing_deliveries where channel='whatsapp'");
 expect(await scalar("select cockpit_ad_billing_approved_delivery($1)",[id])).toBe(true);
 await db.query("update cockpit_members set active=false where auth_user_id=$1",[uid]);
 expect(await scalar("select cockpit_ad_billing_begin_send($1,$2)",[id,claim])).toBe(false);
});
test("72-hour WhatsApp cooldown is enforced at decision and begin-send",async()=>{
 await observe();await decide();await owner(db);
 await db.exec("update cockpit_ad_billing_deliveries set state='accepted',provider_id='test-only-receipt' where channel='whatsapp'");
 await observe("unsettled","9876");await expect(decide()).rejects.toThrow("cooldown");
 await owner(db); await db.exec("update cockpit_ad_billing_deliveries set updated_at=now()-interval '73 hours' where channel='whatsapp'");
 await decide(); await owner(db);
 const id=await scalar("select id from cockpit_ad_billing_deliveries where channel='whatsapp' and state='queued'");
 await db.exec("update cockpit_ad_billing_deliveries set updated_at=now() where channel='whatsapp' and state='accepted'");
 await db.query("update cockpit_ad_billing_deliveries set state='claimed',claim=$2,claimed_at=now() where id=$1",[id,claim]);
 expect(await scalar("select cockpit_ad_billing_begin_send($1,$2)",[id,claim])).toBe(false);
});
test("unknown WhatsApp receipt blocks later approvals beyond 72 hours",async()=>{
 await observe();await decide();await owner(db);await db.exec("update cockpit_ad_billing_deliveries set state='unknown',updated_at=now()-interval '80 hours' where channel='whatsapp'");
 await observe("unsettled","9876");await expect(decide()).rejects.toThrow("unresolved delivery");
});
test("status changes edit existing cards within 72 hours, not new posts",async()=>{
 await observe("payment_grace");await acceptedSlack();await observe("unsettled");
 expect(await scalar("select count(*) from cockpit_ad_billing_deliveries where channel='slack' and state='queued' and slack_update_ts is not null")).toBe(2);
 expect(await scalar("select count(*) from cockpit_ad_billing_deliveries where channel='slack' and state='queued' and slack_update_ts is null")).toBe(0);
});
test("send gate refuses a second fresh Slack post even if incorrectly queued",async()=>{
 await observe(); await acceptedSlack();const r=await review();
 const id=await scalar("insert into cockpit_ad_billing_deliveries(event_id,binding_id,revision,channel,destination,body,state,claim,claimed_at) values($1,$2,1,'slack','C09RZ0GS0V9','Bad duplicate','claimed',$3,now()) returning id",[r.event_id,bid,claim]);
 expect(await scalar("select cockpit_ad_billing_begin_send($1,$2)",[id,claim])).toBe(false);
});
test("72-hour renewal keeps the same Slack card; historical decision retained",async()=>{
 await observe();await acceptedSlack();await decide("deny",null,"Check again in three days");await owner(db);
 await db.exec("update cockpit_ad_billing_reviews set created_at=now()-interval '73 hours'; update cockpit_ad_billing_deliveries set provider_id=extract(epoch from now()-interval '73 hours')::text where channel='slack' and state='accepted'");
 await observe();expect((await review()).state).toBe("pending");
 expect(await scalar("select count(*) from cockpit_ad_billing_deliveries where channel='slack' and state='queued' and slack_update_ts is null")).toBe(0);
 expect(await scalar("select count(*) from cockpit_ad_billing_deliveries where channel='slack' and state='queued' and slack_update_ts is not null")).toBe(2);
});
test("daily review records attention without sending or clearing pending clients",async()=>{
 await observe();await actor(db,uid);await scalar("select cockpit_ad_billing_daily_done()");
 const p=await scalar("select cockpit_ad_billing_review_panel()");expect(p.dailyReviewedAt).toBeTruthy();expect(p.clients[0].review.state).toBe("pending");
 await owner(db);expect(await scalar("select count(*) from cockpit_ad_billing_deliveries where channel='whatsapp'")).toBe(0);
});
test("opening/readback of review is read-only; links never include action tokens",async()=>{
 await observe();await actor(db,uid);await scalar("select cockpit_ad_billing_review_panel()");await scalar("select cockpit_ad_billing_review_panel()");
 await owner(db);expect((await review()).state).toBe("pending");
 const d={id:claim,binding_id:bid,review_id:uid,review_state:"pending",revision:1,channel:"slack",destination:"C09RZ0GS0V9",body:"Review",claim,state:"queued"} as Delivery;
 const blocks=billingBlocks(d,"Safe preview");
 for(const e of (blocks[1] as any).elements) {expect(e.url).toContain("/client-success/ad-billing?binding=");expect(e.url).not.toContain("action=");}
});
test("Slack updates use chat.update and keep safe URL review buttons",async()=>{
 let body:any;let url="";
 const t=new Transport({SLACK_BOT_TOKEN:"test"},(async(u,i)=>{url=String(u);body=JSON.parse(i!.body as string);return Response.json({ok:true,ts:"1791800000.001"});}) as typeof fetch);
 await t.send({id:claim,binding_id:bid,review_id:uid,review_state:"pending",revision:1,channel:"slack",destination:"C09RZ0GS0V9",body:"Review",claim,state:"sending",slack_update_ts:"1791800000.001"});
 expect(url).toEndWith("chat.update");expect(body.ts).toBe("1791800000.001");expect(body.client_msg_id).toBeUndefined();expect(body.blocks[1].elements).toHaveLength(3);
});
test("two competing decisions commit exactly one intent",async()=>{
 await observe();const r=await review();await actor(db,uid);
 const results=await Promise.allSettled([scalar("select cockpit_ad_billing_decide($1,1,'approve',null,null)",[r.id]),scalar("select cockpit_ad_billing_decide($1,1,'deny',null,'Already handled')",[r.id])]);
 expect(results.filter(x=>x.status==="fulfilled")).toHaveLength(1);
 await owner(db);expect(await scalar("select count(*) from cockpit_ad_billing_deliveries where channel='whatsapp'")).toBeLessThanOrEqual(1);
});
test("verified recovery expires unsent approval and sends no recovery WhatsApp",async()=>{
 await observe();await decide();await observe("healthy");
 await db.exec("update cockpit_ad_billing_bindings set healthy_since=now()-interval '5 minutes'");await observe("healthy");
 expect((await review()).state).toBe("expired");expect(await scalar("select count(*) from cockpit_ad_billing_deliveries where channel='whatsapp' and state<>'skipped'")).toBe(0);
});
test("receipt loss on Slack blocks automatic replacement posts",async()=>{
 await observe();await db.exec("update cockpit_ad_billing_deliveries set state='unknown' where channel='slack'");
 await observe("unsettled","9876");expect(await scalar("select count(*) from cockpit_ad_billing_deliveries where channel='slack'")).toBe(2);
});
test("approved intent passes begin-send and persists provider receipt",async()=>{
 await observe();await decide();await owner(db);
 const id=await scalar("select id from cockpit_ad_billing_deliveries where channel='whatsapp'");
 await db.query("update cockpit_ad_billing_deliveries set state='claimed',claim=$2,claimed_at=now() where id=$1",[id,claim]);
 expect(await scalar("select cockpit_ad_billing_begin_send($1,$2)",[id,claim])).toBe(true);
 expect(await scalar("select cockpit_ad_billing_result($1,$2,'accepted','synthetic-provider-id',null)",[id,claim])).toBe(true);
 expect(await scalar("select provider_id from cockpit_ad_billing_deliveries where id=$1",[id])).toBe("synthetic-provider-id");
});

test("media buyer may approve and CSM cannot decide again",async()=>{
 await observe();const r=await review();await actor(db,buyer);
 const p=await scalar("select cockpit_ad_billing_review_panel()");expect(p.clients).toHaveLength(1);
 await scalar("select cockpit_ad_billing_daily_done()");
 await scalar("select cockpit_ad_billing_decide($1,1,'approve',null,null)",[r.id]);
 await actor(db,uid);await expect(scalar("select cockpit_ad_billing_decide($1,1,'deny',null,'Already handled')",[r.id])).rejects.toThrow("review changed");
 await owner(db);expect(await scalar("select count(*) from cockpit_ad_billing_deliveries where channel='whatsapp'")).toBe(1);
 const id=await scalar("select id from cockpit_ad_billing_deliveries where channel='whatsapp'");
 expect(await scalar("select cockpit_ad_billing_approved_delivery($1)",[id])).toBe(true);
 await db.query("update cockpit_members set active=false where auth_user_id=$1",[buyer]);
 expect(await scalar("select cockpit_ad_billing_approved_delivery($1)",[id])).toBe(false);
});
test("CSM denial blocks a later media-buyer approval",async()=>{
 await observe();const r=await review();await decide("deny",null,"Client already handling the issue");await actor(db,buyer);
 await expect(scalar("select cockpit_ad_billing_decide($1,1,'approve',null,null)",[r.id])).rejects.toThrow("review changed");
 await owner(db);expect(await scalar("select count(*) from cockpit_ad_billing_deliveries where channel='whatsapp'")).toBe(0);
});
test("media buyer client scope and current role remain required",async()=>{
 await observe();const r=await review();
 await db.query("update cockpit_members set clients=array['Other Client'] where auth_user_id=$1",[buyer]);await actor(db,buyer);
 expect((await scalar("select cockpit_ad_billing_review_panel()")).clients).toHaveLength(0);
 await expect(scalar("select cockpit_ad_billing_decide($1,1,'approve',null,null)",[r.id])).rejects.toThrow("billing reviewer access");
 await owner(db);await db.query("update cockpit_members set clients='{}',roles=array['creative_director'] where auth_user_id=$1",[buyer]);await actor(db,buyer);
 await expect(scalar("select cockpit_ad_billing_review_panel()")).rejects.toThrow();
 await expect(scalar("select cockpit_ad_billing_decide($1,1,'approve',null,null)",[r.id])).rejects.toThrow("billing reviewer access");
});

test("Slack card stays short and leaves the full Arabic draft on the review page",async()=>{
 await observe();const card=await scalar("select body from cockpit_ad_billing_deliveries where channel='slack' limit 1");
 expect(card.split("\n")).toHaveLength(3);expect(card.length).toBeLessThan(300);
 expect(card).toContain("Needs approval");expect(card).not.toContain(clientMessage("unsettled","1234"));
});

test("a genuinely new incident may notify again only after the 72-hour budget",async()=>{
 await observe();await acceptedSlack();await db.exec("update cockpit_ad_billing_deliveries set provider_id=extract(epoch from now()-interval '73 hours')::text where channel='slack'");
 await observe("healthy");await db.exec("update cockpit_ad_billing_bindings set healthy_since=now()-interval '5 minutes'");await observe("healthy");
 await db.exec("update cockpit_ad_billing_deliveries set state='accepted',provider_id=slack_update_ts where channel='slack' and state='queued' and slack_update_ts is not null");
 await observe("unsettled");
 expect(await scalar("select count(*) from cockpit_ad_billing_deliveries where channel='slack' and state='queued' and slack_update_ts is null")).toBe(2);
});


test("closed and unknown reviews have no Slack decision buttons",()=>{
 const d={id:claim,binding_id:bid,review_id:uid,revision:1,channel:"slack",destination:"C09RZ0GS0V9",body:"Approved",claim,state:"sending"} as Delivery;
 for(const state of ["approved","denied","expired",null,undefined] as const) {
  const blocks=billingBlocks({...d,review_state:state},d.body);
  expect(blocks.some(b=>b.type==="actions")).toBe(false);
  expect(JSON.stringify(blocks)).not.toContain("mode=");
  expect(JSON.stringify(blocks)).toContain("Open secure review");
 }
 expect(billingBlocks({...d,review_state:"pending"},d.body).filter(b=>b.type==="actions")).toHaveLength(1);
});

test("closed Slack updates replace old actions in both channels without posting again",async()=>{
 const requests:any[]=[];
 const t=new Transport({SLACK_BOT_TOKEN:"test"},(async(u,i)=>{requests.push({url:String(u),body:JSON.parse(i!.body as string)});return Response.json({ok:true,ts:"1791800000.001"});}) as typeof fetch);
 for(const destination of ["C09RZ0GS0V9","C0AF4SDLWNL"]) {
  await t.send({id:claim,binding_id:bid,review_id:uid,review_state:"approved",revision:1,channel:"slack",destination,body:"Approved · queued",claim,state:"sending",slack_update_ts:"1791800000.001"});
 }
 for(const req of requests) {
  expect(req.url).toEndWith("chat.update");expect(req.body.blocks.some((b:any)=>b.type==="actions")).toBe(false);
  expect(req.body.text).toContain("Reference: BG-");expect(JSON.stringify(req.body.blocks)).not.toContain("Reference: BG-");
 }
 await t.send({id:claim,binding_id:bid,revision:1,channel:"slack",destination:"C09RZ0GS0V9",body:"Internal follow-up only",claim,state:"sending",slack_update_ts:"1791800000.001"});
 expect(requests[2].body.blocks).toEqual([]);
});

for(const who of [uid,buyer]) test(`first reviewer ${who} closes both cards and the claim carries current state`,async()=>{
 await observe();await acceptedSlack();const r=await review();await actor(db,who);
 await scalar("select cockpit_ad_billing_decide($1,1,'approve',null,null)",[r.id]);
 await actor(db,who===uid?buyer:uid);await expect(scalar("select cockpit_ad_billing_decide($1,1,'approve',null,null)",[r.id])).rejects.toThrow("review changed");
 await owner(db);
 expect(await scalar("select count(*) from cockpit_ad_billing_deliveries where channel='whatsapp'")).toBe(1);
 expect(await scalar("select count(*) from cockpit_ad_billing_deliveries where channel='slack' and state='queued' and slack_update_ts is not null")).toBe(2);
 // Consume only fictional local claims; no provider requests occur in this test.
 const claimed:any[]=[];
 for(let i=0;i<5;i++) {const d=await scalar("select cockpit_ad_billing_claim($1)",[claim]);if(d)claimed.push(d);}
 const cards=claimed.filter(d=>d.channel==="slack");expect(cards).toHaveLength(2);
 expect(new Set(cards.map(d=>d.destination)).size).toBe(2);
 for(const d of cards) {expect(d.review_state).toBe("approved");expect(billingBlocks(d,d.body).some(b=>b.type==="actions")).toBe(false);}
});

test("denial closes both channel cards without a send intent",async()=>{
 await observe();await acceptedSlack();await decide("deny",null,"Client has already been notified");await owner(db);
 expect(await scalar("select count(*) from cockpit_ad_billing_deliveries where channel='whatsapp'")).toBe(0);
 const cards:any[]=[];for(let i=0;i<4;i++){const d=await scalar("select cockpit_ad_billing_claim($1)",[claim]);if(d?.channel==="slack")cards.push(d);}
 expect(cards).toHaveLength(2);for(const d of cards){expect(d.review_state).toBe("denied");expect(billingBlocks(d,d.body).some(b=>b.type==="actions")).toBe(false);}
});
