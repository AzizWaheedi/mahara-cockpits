// The EOD Slack message reads cleanly (20261015a) and the outbox is retried,
// written back and told to the person truthfully (20261015b). In-memory PGlite
// only: no live database, Slack or Google call is made. The answers below have
// the shape of the media buyer's 2026-10-11 and 2026-10-13 reports (a pasted
// list with a leading blank line, a pasted list missing its first bullet, a
// summary with separator lines, blank health scores), with made-up names.
import {expect,test} from "bun:test";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {PGlite} from "@electric-sql/pglite";
import {actor,cockpitTestDb,member,migration,owner} from "./lib/cockpitTestDb";
import {eodDeliveryNote,type EodOutbox,readPersonalEod} from "../src/lib/personalEod";
import {missingHealth} from "../src/lib/eodForm";

const NADA="00000000-0000-4000-8000-000000000021";
const NATIVE="20261009g_eod_outbox_native.sql",MESSAGE="20261015a_eod_slack_message.sql",TRUTH="20261015b_eod_delivery_truth.sql";
const TASKS={dashboard:"Yes",onBudget:"Yes",flagged:"Yes",videoRequests:"Yes",creativesUploaded:"Yes",launchedPaused:"Yes"};
const OCT_13={...TASKS,focus:"",energy:"",biology:"",
 accountSummary:"\n*Marble & More* launched a new campaign. \nCity Wood relaunched with the new card. \n---------\nAcme needs the payment code. \n------\nCastello waits on the card.",
 outOfKpi:"City Wood — no booking on $135, CPL $19.33 → Queue a refresh.\n• Safad — cost per booking $117, CPL $9.79 → Judge the ads on both numbers.",
 one_percent_better:"----"};
const OCT_11={...TASKS,focus:"3",energy:"9",biology:"3",accountSummary:"",
 outOfKpi:"\n• Alpha — cost per booking $87 → Judge the ads on bookings.\n• Beta Contracting — CPL $69.93 → Queue a refresh.\n",
 one_percent_better:""};

async function db(names:string[]):Promise<PGlite>{
 const db=await cockpitTestDb();
 await db.exec(migration("20260923o_cockpit_domain_tables.sql").match(/CREATE TABLE IF NOT EXISTS public\.cockpit_eod_reports \([\s\S]*?\n\);/)![0]);
 const old=migration("20260923p_cockpit_actions_and_rpcs.sql");
 await db.exec(old.match(/CREATE UNIQUE INDEX IF NOT EXISTS uq_cockpit_eod_role_day[\s\S]*?;/)![0]);
 for(const name of ["cockpit_save_eod","cockpit_get_dashboard_summary"])
  await db.exec(old.match(new RegExp("CREATE OR REPLACE FUNCTION public\\."+name+"\\([\\s\\S]*?\\$\\$;"))![0]);
 await db.exec(migration("20260927e_cockpit_personal_eod.sql"));
 await db.exec(migration("20260922b_team_meetings.sql").match(/create table if not exists public\.team_people \([\s\S]*?\n\);/)![0]);
 await db.exec(migration("20260922a_eod_outbox.sql"));
 await db.exec(migration("20260927b_eod_delivery_claims.sql"));
 for(const name of names) await db.exec(migration(name));
 await member(db,NADA,"nada@tests.invalid",["media_buyer"]);
 await db.query("update cockpit_members set name='Nada Example' where auth_user_id=$1",[NADA]);
 await db.query("insert into team_people(id,name,email,slack_id) values($1,'Nada Example','nada@tests.invalid','UNADA')",[NADA]);
 return db;
}

/** A submitted native report, queued as the save path queues it. Returns the report and outbox ids. */
async function filed(db:PGlite,day:string,answers:object,computed:object,energy:number|null=null){
 await owner(db);
 const id=(await db.query<any>(`insert into cockpit_eod_reports(owner_user_id,owner_email,role,day,energy,answers,computed,submitted_at,source_system)
  values($1,'nada@tests.invalid','media_buyer',$2,$3,$4,$5,$6,'supabase') returning id`,
  [NADA,day,energy,JSON.stringify(answers),JSON.stringify(computed),day+"T20:58:48Z"])).rows[0].id;
 await db.exec("set role service_role");
 const outbox=(await db.query<any>("select cockpit_enqueue_personal_eod($1) as id",[id])).rows[0].id;
 await owner(db);
 return {id:Number(id),outbox:Number(outbox)};
}

const row=async(db:PGlite,id:number)=>{await owner(db);return (await db.query<any>("select * from eod_outbox where id=$1",[id])).rows[0];};
const sql=async(db:PGlite,q:string,args:unknown[]=[])=>{await owner(db);return (await db.query<any>(q,args)).rows[0];};

/** What the VPS worker (hermes/eod-out/out.py as it runs on 2026-10-15) writes: a plain PATCH as the service role. */
async function vps(db:PGlite,id:number,patch:Record<string,unknown>){
 await owner(db);
 // The worker holds the service key: no signed-in person behind it.
 await db.query("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','',false)");
 await db.exec("set role service_role");
 const keys=Object.keys(patch);
 await db.query(`update eod_outbox set ${keys.map((k,i)=>`${k}=$${i+2}`).join(",")} where id=$1`,[id,...keys.map(k=>patch[k])]);
 await owner(db);
}

function client(db:PGlite):SupabaseClient{
 return {async rpc(name:string,args:Record<string,unknown>){
  try{
   const r=await db.query<any>(`select ${name}(p_role=>$1,p_day=>$2) as result`,[args.p_role,args.p_day]);
   return {data:r.rows[0].result,error:null};
  }catch(error){return {data:null,error};}
 }} as unknown as SupabaseClient;
}

test("the 10-13 shape: closed bold, answers on their lines, one bullet per item, Not answered, kit money",async()=>{
 const d=await db([NATIVE,MESSAGE,TRUTH]);try{
  const {outbox}=await filed(d,"2026-10-13",OCT_13,{spend:445,leads:39,cpl:"11",accounts:15,overGate:"Yes (7-day CPL)"});
  const r=await row(d,outbox);
  expect(r.body).toBe([
   "*MEDIA BUYER EOD*","*Date - 13-10-2026*","","*Name - Nada Example*","Submitted by: <@UNADA>","",
   "*HEALTH*","Focus - Not answered","Energy - Not answered","Food, Sleep, Water - Not answered","",
   "*TASKS*",
   "Did you check and update the Master Fulfillment Dashboard for all active clients today? - Yes",
   "Are all client ad accounts within their daily budget targets? - Yes",
   "Did you flag any off-KPI client accounts to the CSM today? - Yes",
   "Did you submit any video requests or creative briefs that were due today? - Yes",
   "Did you upload any approved creatives to the client's Google Drive Creatives folder? - Yes","",
   "*Today's Numbers*","Total Ad Spend Today - $445","Leads Generated - 39","Average CPL - $11","Active Accounts Managed - 15",
   "Any Clients Above KPI? - Yes (7-day CPL)","Any new creatives launched or paused today? - Yes","",
   "*DAILY WRAP UP*",
   "*Account Summary*","*Marble &amp; More* launched a new campaign.","City Wood relaunched with the new card.","---------",
   "Acme needs the payment code.","------","Castello waits on the card.",
   "*Actions to get back into KPI*",
   "• City Wood — no booking on $135, CPL $19.33 → Queue a refresh.",
   "• Safad — cost per booking $117, CPL $9.79 → Judge the ads on both numbers.","",
   "*ADDITIONAL NOTES*","1% improvement - ----"].join("\n"));
  // Every bold opened on a line is closed on it.
  for(const line of r.body.split("\n")) expect((line.replace(/\*Marble &amp; More\*/,"").match(/\*/g)??[]).length%2).toBe(0);
 }finally{await d.close();}
});

test("the 10-11 shape: a pasted list with a leading blank line has no stray line and a bullet on every item",async()=>{
 const d=await db([NATIVE,MESSAGE,TRUTH]);try{
  const {outbox}=await filed(d,"2026-10-11",OCT_11,{spend:429,leads:27,cpl:"16",accounts:15,overGate:"Yes"},9);
  const body:string=(await row(d,outbox)).body;
  expect(body).toContain("*HEALTH*\nFocus - 3\nEnergy - 9\nFood, Sleep, Water - 3\n\n*TASKS*");
  expect(body).toContain("Any Clients Above KPI? - Yes\n");
  expect(body).toContain("*DAILY WRAP UP*\nAccount Summary - Not answered\n*Actions to get back into KPI*\n"
   +"• Alpha — cost per booking $87 → Judge the ads on bookings.\n• Beta Contracting — CPL $69.93 → Queue a refresh.\n\n*ADDITIONAL NOTES*");
  expect(body).toContain("1% improvement - Not answered");
  expect(body).not.toMatch(/ - \n|\n\n\n/);
 }finally{await d.close();}
});

test("the sheet row is value for value what 20261009g wrote; only the Slack text changes",async()=>{
 const d=await db([NATIVE]);try{
  const {id}=await filed(d,"2026-10-13",OCT_13,{spend:445,leads:39,cpl:"11",accounts:15,overGate:"Yes (7-day CPL)"});
  const payload=async()=>(await sql(d,"select cockpit_eod_outbox_payload(r,'Nada','U0AJQ8P1ACF') as p from cockpit_eod_reports r where id=$1",[id])).p;
  const before=await payload();
  await d.exec(migration(MESSAGE));
  const after=await payload();
  expect(after.row_values).toEqual(before.row_values);
  expect(after.row_values).toHaveLength(21);
  expect([after.channel,after.tab]).toEqual([before.channel,before.tab]);
  expect(before.body).toContain("*Date - 13-10-2026\n");
  expect(after.body).toContain("*Date - 13-10-2026*\n");
 }finally{await d.close();}
});

test("money and counts read as the CEO kit's; text and blanks are never turned into numbers",async()=>{
 const d=await db([NATIVE,MESSAGE]);try{
  const money:Record<string,string>={"445":"$445","1234":"$1,234","84.5":"$84.50","19.333":"$19.33","99.999":"$100","0":"$0",
   "-5":"−$5","$1,200":"$1,200","no leads":"no leads","":"n/a"};
  for(const [v,want] of Object.entries(money)) expect((await sql(d,"select cockpit_eod_money($1) as v",[v])).v).toBe(want);
  const count:Record<string,string>={"39":"39","1284":"1,284","2.6":"3","-3":"−3","":"n/a","a few":"a few"};
  for(const [v,want] of Object.entries(count)) expect((await sql(d,"select cockpit_eod_count($1) as v",[v])).v).toBe(want);
  const tidy=async(v:string,list=false)=>(await sql(d,"select cockpit_eod_tidy($1,$2) as v",[v,list])).v;
  expect(await tidy("  \n\n  ")).toBe("");
  expect(await tidy("• one item\n")).toBe("one item");
  expect(await tidy("- 5% better")).toBe("5% better");
  expect(await tidy("-5% on CPL")).toBe("-5% on CPL");
  expect(await tidy("a\nb",true)).toBe("• a\n• b");
  expect(await tidy("1. a\n2) b\n* c\n- d\n—— \n")).toBe("• a\n• b\n• c\n• d");
  expect(await tidy("para one\n\n\n\npara two")).toBe("para one\n\npara two");
  expect(await tidy("CPL < $15 & falling > yesterday")).toBe("CPL &lt; $15 &amp; falling &gt; yesterday");
  expect((await sql(d,"select cockpit_eod_answer('Q','',false) as v")).v).toBe("Q - Not answered");
  expect((await sql(d,"select cockpit_eod_answer('Q','x\ny') as v")).v).toBe("*Q*\nx\ny");
 }finally{await d.close();}
});

test("a Slack refusal that means 'not posted, fixable' is tried again hourly, one try each, for 48 hours",async()=>{
 const d=await db([NATIVE,MESSAGE,TRUTH]);try{
  const {id,outbox}=await filed(d,"2026-10-11",OCT_11,{spend:429});
  // The live worker's fifth refusal, as on 2026-10-12 01:50.
  await vps(d,outbox,{attempts:5,status:"failed",error:"RuntimeError: slack: channel_not_found",sheet_at:new Date().toISOString()});
  const retry=async(hours:number)=>(await sql(d,"select cockpit_retry_eod_outbox(now()+make_interval(hours=>$1)) as n",[hours])).n;
  expect(await retry(0)).toBe(0);
  expect(await retry(1)).toBe(1);
  let r=await row(d,outbox);
  expect(r).toMatchObject({status:"queued",attempts:4,retries:1,error:"RuntimeError: slack: channel_not_found",claimed_by:null});
  // cockpit_audit_log ids are uuids: find the row by what it says, not by order.
  const audit=await sql(d,`select count(*)::int as n from cockpit_audit_log where entity_type='eod_outbox' and entity_id=$1
   and actor_email='eod-retry' and after->>'status'='queued' and before->>'status'='failed'`,[String(outbox)]);
  expect(audit.n).toBe(1);
  // The live worker's one try: attempts+1 = 5, failed again.
  await vps(d,outbox,{attempts:5,status:"failed",error:"RuntimeError: slack: channel_not_found"});
  const ctx=await readAs(d,"2026-10-11");
  expect(ctx.outbox).toMatchObject({status:"failed",retrying:true,retries:1});
  expect(eodDeliveryNote(ctx.report)?.text).toMatch(/^Not posted yet: the Slack bot cannot see the EOD channel\. Tell the CEO so it can be fixed; it is tried again every hour until /);
  // The repo's claiming worker gets exactly one try too.
  expect(await retry(2)).toBe(1);
  await owner(d);await d.exec("set role service_role");
  const claim=(await d.query<any>("select * from cockpit_claim_eod_outbox('worker',300,5)")).rows;
  expect(claim.map((c:any)=>[c.id,c.attempts])).toEqual([[outbox,5]]);
  await d.query("select cockpit_start_eod_send($1,'worker',$2::uuid,'slack')",[outbox,claim[0].claim_token]);
  await d.query("select cockpit_record_eod_receipt($1,'worker',$2::uuid,p_slack_error=>'KnownNotSent: slack: not_in_channel',p_status=>'queued')",[outbox,claim[0].claim_token]);
  expect(await row(d,outbox)).toMatchObject({status:"failed",slack_started_at:null});
  // The bot is fixed; the next hourly retry posts it, and the report learns its timestamp.
  expect(await retry(3)).toBe(1);
  await vps(d,outbox,{slack_ts:"1791970613.646759",sent_at:new Date().toISOString(),error:null,status:"sent"});
  expect((await sql(d,"select slack_ts from cockpit_eod_reports where id=$1",[id])).slack_ts).toBe("1791970613.646759");
  const labels=(await (async()=>{await owner(d);return (await d.query<any>(
   "select action,actor_email,after->>'slack_ts' as ts from cockpit_audit_log where entity_type='cockpit_eod_reports' and entity_id=$1 and action<>'eod.submitted'",[String(id)])).rows;})());
  expect(labels).toEqual([{action:"eod.delivered",actor_email:"service-role",ts:"1791970613.646759"}]);
  expect(eodDeliveryNote((await readAs(d,"2026-10-11")).report)?.text).toMatch(/^Posted to Slack at \d\d:\d\d\.$/);
  expect(await retry(4)).toBe(0);
 }finally{await d.close();}
});

test("never retried: an uncertain send, a reconciliation, the 48 hours, the cap, other errors, a posted row",async()=>{
 const d=await db([NATIVE,MESSAGE,TRUTH]);try{
  await owner(d);
  const mk=async(person:string,cols:Record<string,unknown>)=>{
   const keys=Object.keys(cols);
   return Number((await d.query<any>(`insert into eod_outbox(role,day,person,channel,body,${keys.join(",")})
    values('sales_closer','2026-10-14',$1,'C0AF5PJEAUX','x',${keys.map((_,i)=>`$${i+2}`).join(",")}) returning id`,[person,...keys.map(k=>cols[k])])).rows[0].id);
  };
  const failed={status:"failed",attempts:5,error:"KnownNotSent: slack: channel_not_found"};
  const yes=await mk("ok",failed);
  const rate=await mk("rate",{...failed,error:"KnownNotSent: Slack rejected request: HTTP 429"});
  const timeout=await mk("timeout",{...failed,error:"URLError: <urlopen error timed out>"});
  const recon=await mk("recon",{...failed,reconciliation_needed:true});
  const started=await mk("started",{...failed,slack_started_at:new Date().toISOString()});
  const old=await mk("old",{...failed,created_at:new Date(Date.now()-49*3600e3).toISOString()});
  const capped=await mk("capped",{...failed,retries:48});
  const sheet=await mk("sheet",{status:"failed",attempts:5,error:null,sheet_error:"HTTP Error 403"});
  const n=(await sql(d,"select cockpit_retry_eod_outbox(now()+interval '1 hour') as n")).n;
  expect(n).toBe(2);
  const st=async(id:number)=>(await row(d,id)).status;
  expect([await st(yes),await st(rate)]).toEqual(["queued","queued"]);
  for(const id of [timeout,recon,started,old,capped,sheet]) expect(await st(id)).toBe("failed");
 }finally{await d.close();}
});

test("a person's requeue: only a failed row that was certainly not posted, full tries, audited, service role only",async()=>{
 const d=await db([NATIVE,MESSAGE,TRUTH]);try{
  const {outbox}=await filed(d,"2026-10-11",OCT_11,{});
  await vps(d,outbox,{attempts:5,status:"failed",error:"RuntimeError: slack: invalid_auth",created_at:new Date(Date.now()-72*3600e3).toISOString()});
  await actor(d,NADA);
  await expect(d.query("select cockpit_requeue_eod_outbox($1)",[outbox])).rejects.toThrow(/permission denied/);
  await expect(d.query("select cockpit_retry_eod_outbox()")).rejects.toThrow(/permission denied/);
  await expect(d.query("select cockpit_eod_tidy('x')")).rejects.toThrow(/permission denied/);
  await owner(d);await d.exec("set role service_role");
  await expect(d.query("select cockpit_eod_money('1')")).rejects.toThrow(/permission denied/);
  const r=(await d.query<any>("select * from cockpit_requeue_eod_outbox($1)",[outbox])).rows[0];
  expect(r).toMatchObject({status:"queued",attempts:0,error:null});
  expect((await sql(d,`select count(*)::int as n from cockpit_audit_log where entity_type='eod_outbox' and entity_id=$1
   and actor_email='eod-requeue' and after->>'status'='queued'`,[String(outbox)])).n).toBe(1);
  await vps(d,outbox,{slack_ts:"1.2",sent_at:new Date().toISOString(),sheet_at:new Date().toISOString(),status:"sent"});
  await owner(d);await d.exec("set role service_role");
  await expect(d.query("select cockpit_requeue_eod_outbox($1)",[outbox])).rejects.toThrow(/already in Slack|it is sent/);
  await owner(d);
  const started=Number((await d.query<any>(`insert into eod_outbox(role,day,person,channel,body,status,attempts,slack_started_at)
   values('sales_closer','2026-10-14','x','C1','x','failed',5,now()) returning id`)).rows[0].id);
  await d.exec("set role service_role");
  await expect(d.query("select cockpit_requeue_eod_outbox($1)",[started])).rejects.toThrow(/reconcile it first/);
 }finally{await d.close();}
});

test("reports posted before the trigger get their Slack timestamp when 20261015b applies",async()=>{
 const d=await db([NATIVE,MESSAGE]);try{
  const {id,outbox}=await filed(d,"2026-10-13",OCT_13,{});
  await vps(d,outbox,{slack_ts:"1791970614.176209",sent_at:new Date().toISOString(),sheet_at:new Date().toISOString(),status:"sent"});
  expect((await sql(d,"select slack_ts from cockpit_eod_reports where id=$1",[id])).slack_ts).toBeNull();
  await d.exec(migration(TRUTH));
  expect((await sql(d,"select slack_ts from cockpit_eod_reports where id=$1",[id])).slack_ts).toBe("1791970614.176209");
  expect((await sql(d,"select count(*)::int as n from cockpit_audit_log where entity_type='cockpit_eod_reports' and entity_id=$1 and action='eod.delivered'",[String(id)])).n).toBe(1);
  await d.exec(migration(TRUTH));
 }finally{await d.close();}
});

async function readAs(d:PGlite,day:string){
 await actor(d,NADA);
 const ctx=await readPersonalEod(client(d),"media_buyer",day);
 await owner(d);
 return ctx;
}

const base:EodOutbox={status:"queued",attempts:0,slackPosted:false,sheetFiled:false,sentAt:null,error:null,sheetError:null,
 needsReconciliation:false,retries:0,retrying:false,retryUntil:null};
test("the person is told where the EOD is, in plain words, and a draft says nothing",()=>{
 const at=Date.parse("2026-10-13T20:58:48Z");
 const note=(o:Partial<EodOutbox>|null)=>eodDeliveryNote({submittedAt:at,delivery:o?{...base,...o}:null});
 expect(eodDeliveryNote({submittedAt:null,delivery:base})).toBeNull();
 expect(note(null)).toEqual({tone:"bad",text:"Submitted, but it is not in the Slack queue. Tell the CEO so it can be sent."});
 expect(note({})?.text).toBe("Waiting to post to Slack. It goes within 5 minutes.");
 expect(note({error:"RuntimeError: slack: ratelimited",attempts:2})?.text).toBe("Not posted yet: Slack asked us to slow down. Trying again within 5 minutes.");
 expect(note({status:"failed",error:"KnownNotSent: slack: invalid_auth"})?.text).toBe("Not posted to Slack: the Slack bot is signed out. Tell the CEO; it can be sent again once that is fixed.");
 expect(note({status:"failed",needsReconciliation:true,error:"Slack ambiguous"})?.tone).toBe("bad");
 expect(note({status:"sent",slackPosted:true,sheetFiled:true,sentAt:at})).toMatchObject({tone:"good",text:expect.stringMatching(/^Posted to Slack at \d\d:\d\d\.$/)});
 expect(note({status:"queued",slackPosted:true,sentAt:at})?.text).toMatch(/The EOD sheet row is still to go\.$/);
 expect(note({status:"failed",slackPosted:true,sentAt:at,sheetError:"403"})?.text).toMatch(/did not take its row; tell the CEO\.$/);
});

test("the form refuses a submit until all three health scores are 1 to 10, and names the missing ones",()=>{
 expect(missingHealth({focus:"",energy:"",biology:""})).toBe("Focus, Energy and Food, sleep, water scores");
 expect(missingHealth({focus:"8",energy:"",biology:"7"})).toBe("Energy score");
 expect(missingHealth({focus:"0",energy:"11",biology:"7"})).toBe("Focus and Energy scores");
 expect(missingHealth({focus:"10",energy:" 9 ",biology:"1"})).toBe("");
});
