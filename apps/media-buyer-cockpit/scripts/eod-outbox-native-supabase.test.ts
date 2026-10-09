// Native EOD submits queue exactly one eod_outbox row (20261009g). In-memory
// PGlite only: no live database, Slack or Google call is made.
import {expect,test} from "bun:test";
import type {SupabaseClient} from "@supabase/supabase-js";
import type {PGlite} from "@electric-sql/pglite";
import {actor,cockpitTestDb,member,migration,owner} from "./lib/cockpitTestDb";
import {readPersonalEod,savePersonalEod} from "../src/lib/personalEod";

const NADA="00000000-0000-4000-8000-000000000011",MAYA="00000000-0000-4000-8000-000000000012";
const SALEH="00000000-0000-4000-8000-000000000013",SABRI="00000000-0000-4000-8000-000000000014";
const LINA="00000000-0000-4000-8000-000000000015",TWIN="00000000-0000-4000-8000-000000000016";
const MIGRATION="20261009g_eod_outbox_native.sql";

const MEDIA_ANSWERS={focus:"8",energy:"7",biology:"Slept 7h",dashboard:"Yes",onBudget:"Yes",flagged:"No",
 videoRequests:"Yes",creativesUploaded:"No",launchedPaused:"Yes",accountSummary:"All four accounts on target",
 outOfKpi:"",one_percent_better:"Earlier creative briefs",name:"Somebody Else",slackId:"USPOOFED"};
const MEDIA_COMPUTED={spend:120,leads:0,cpl:"0",accounts:4,overGate:"No"};

async function base():Promise<PGlite>{
 const db=await cockpitTestDb();
 await db.exec(migration("20260923o_cockpit_domain_tables.sql").match(/CREATE TABLE IF NOT EXISTS public\.cockpit_eod_reports \([\s\S]*?\n\);/)![0]);
 const old=migration("20260923p_cockpit_actions_and_rpcs.sql");
 await db.exec(old.match(/CREATE UNIQUE INDEX IF NOT EXISTS uq_cockpit_eod_role_day[\s\S]*?;/)![0]);
 for(const name of ["cockpit_save_eod","cockpit_get_dashboard_summary"])
  await db.exec(old.match(new RegExp("CREATE OR REPLACE FUNCTION public\\."+name+"\\([\\s\\S]*?\\$\\$;"))![0]);
 await db.exec(migration("20260927e_cockpit_personal_eod.sql"));
 await db.exec(migration("20260922b_team_meetings.sql").match(/create table if not exists public\.team_people \([\s\S]*?\n\);/)![0]);
 await db.exec(migration("20260922a_eod_outbox.sql"));
 return db;
}

async function person(db:PGlite,id:string,email:string,roles:string[],name:string,slack?:string){
 await member(db,id,email,roles);
 await db.query("update cockpit_members set name=$1 where auth_user_id=$2",[name,id]);
 if(slack) await db.query("insert into team_people(id,name,email,slack_id) values($1,$2,$3,$4)",[id,name,email,slack]);
}

async function fixture(){
 const db=await base();
 await db.exec(migration("20260927b_eod_delivery_claims.sql"));
 await db.exec(migration(MIGRATION));
 await db.exec(migration(MIGRATION));
 await person(db,NADA,"nada@tests.invalid",["media_buyer"],"Nada Example","UNADA");
 await person(db,MAYA,"maya@tests.invalid",["media_buyer"],"Maya Example");
 await person(db,SALEH,"saleh@tests.invalid",["csm"],"Saleh Example","USALEH");
 await person(db,SABRI,"sabri@tests.invalid",["creative"],"Sabri Example");
 await person(db,LINA,"lina@tests.invalid",["creative"],"Lina");
 await person(db,TWIN,"twin@tests.invalid",["media_buyer"],"Nada Example","UTWIN");
 const keys:Record<string,string[]>={cockpit_personal_eod:["p_role","p_day"],cockpit_save_personal_eod:["p_role","p_patch","p_expected_owner","p_day"]};
 const client={async rpc(name:string,args:Record<string,unknown>){
  try{
   const result=await db.query<any>("select "+name+"("+keys[name].map((k,i)=>k+"=>$"+(i+1)).join(",")+") as result",
    keys[name].map(k=>args[k]!==null && typeof args[k]==="object"?JSON.stringify(args[k]):args[k]));
   return {data:result.rows[0].result,error:null};
  }catch(error){return {data:null,error};}
 }} as unknown as SupabaseClient;
 return {db,client};
}

async function outbox(db:PGlite){
 await owner(db);
 return (await db.query<any>("select * from eod_outbox order by id")).rows;
}

const asDate=(day:string)=>day.split("-").reverse().join("-");

test("a draft queues nothing; a submit queues one row in the media buyer's form shape",async()=>{
 const {db,client}=await fixture();try{
  await actor(db,NADA);
  const ctx=await readPersonalEod(client,"media_buyer");
  await savePersonalEod(client,"media_buyer",ctx,{answers:{focus:"8"},body:"Draft"});
  expect(await outbox(db)).toHaveLength(0);
  await actor(db,NADA);
  const saved:any=await savePersonalEod(client,"media_buyer",ctx,{energy:"7",answers:MEDIA_ANSWERS,computed:MEDIA_COMPUTED,submit:true});
  expect(saved.delivery).toBe("not_configured");
  expect(saved.outbox).toMatchObject({status:"queued",attempts:0,slack_posted:false,sheet_filed:false});
  const rows=await outbox(db);
  expect(rows).toHaveLength(1);
  const row=rows[0];
  expect(row).toMatchObject({role:"media_buyer",day:ctx.day,person:"Nada Example",slack_id:"UNADA",
   channel:"C0AQ2LD0PL1",tab:"Media Buyer",status:"queued",attempts:0,report_id:Number(saved.report.id)});
  const lines=row.body.split("\n");
  expect(lines.slice(0,5)).toEqual(["*MEDIA BUYER EOD*",`*Date - ${asDate(ctx.day)}`,"","*Name - Nada Example*","Submitted by: <@UNADA>"]);
  expect(row.body).toContain("Food, Sleep, Water - \nSlept 7h");
  expect(row.body).toContain("Leads Generated - 0");
  expect(row.body).toContain("Actions to get back into KPI - --");
  expect(row.body).not.toContain("USPOOFED");
  expect(row.body).not.toContain("Somebody Else");
  expect(row.row_values).toHaveLength(21);
  expect(row.row_values.slice(1,6)).toEqual(["Nada Example",`cockpit-${ctx.day}-${saved.report.id}`,asDate(ctx.day),"7","8"]);
  expect(row.row_values[13]).toBe("0");
  expect(row.row_values[20]).toBe("Earlier creative briefs");
  const audit=(await db.query<any>("select count(*)::int as n from cockpit_audit_log where entity_type='eod_outbox'")).rows[0].n;
  expect(audit).toBe(1);
 }finally{await db.close();}
});

test("a repeated submit never queues or posts twice, before or after the worker delivered it",async()=>{
 const {db,client}=await fixture();try{
  await actor(db,NADA);
  const ctx=await readPersonalEod(client,"media_buyer");
  const first:any=await savePersonalEod(client,"media_buyer",ctx,{answers:MEDIA_ANSWERS,computed:MEDIA_COMPUTED,submit:true});
  await savePersonalEod(client,"media_buyer",ctx,{submit:true});
  await savePersonalEod(client,"media_buyer",ctx,{answers:MEDIA_ANSWERS,submit:true});
  const [row]=await outbox(db);expect(await outbox(db)).toHaveLength(1);
  await db.exec("set role service_role");
  expect((await db.query<any>("select cockpit_enqueue_personal_eod($1) as id",[first.report.id])).rows[0].id).toBe(row.id);
  const claim=(await db.query<any>("select * from cockpit_claim_eod_outbox('worker',300,5)")).rows;
  expect(claim.map((r:any)=>r.id)).toEqual([row.id]);
  const token=claim[0].claim_token;
  await db.query("select cockpit_start_eod_send($1,'worker',$2::uuid,'sheet')",[row.id,token]);
  await db.query("select cockpit_record_eod_receipt($1,'worker',$2::uuid,p_sheet_at=>now())",[row.id,token]);
  await db.query("select cockpit_start_eod_send($1,'worker',$2::uuid,'slack')",[row.id,token]);
  await db.query("select cockpit_record_eod_receipt($1,'worker',$2::uuid,p_slack_ts=>'1700000000.1',p_status=>'sent')",[row.id,token]);
  await actor(db,NADA);
  const again:any=await savePersonalEod(client,"media_buyer",ctx,{submit:true});
  expect(again.outbox).toMatchObject({status:"sent",slack_posted:true,sheet_filed:true});
  await expect(savePersonalEod(client,"media_buyer",ctx,{answers:{accountSummary:"Changed"},submit:true})).rejects.toThrow(/cannot be overwritten/);
  const rows=await outbox(db);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({status:"sent",slack_ts:"1700000000.1",body:row.body});
  await db.exec("set role service_role");
  expect((await db.query<any>("select count(*)::int as n from cockpit_claim_eod_outbox('worker',300,5)")).rows[0].n).toBe(0);
 }finally{await db.close();}
});

test("each person gets their own row; a shared display name is told apart by email",async()=>{
 const {db,client}=await fixture();try{
  for(const id of [NADA,TWIN,MAYA]){
   await actor(db,id);
   const ctx=await readPersonalEod(client,"media_buyer");
   await savePersonalEod(client,"media_buyer",ctx,{answers:{accountSummary:id},submit:true});
  }
  const rows=await outbox(db);
  expect(rows.map((r:any)=>[r.person,r.slack_id])).toEqual([
   ["Nada Example","UNADA"],["Nada Example <twin@tests.invalid>","UTWIN"],["Maya Example",null]]);
  expect(rows[2].body).toContain("Submitted by: Maya Example");
  expect(new Set(rows.map((r:any)=>r.report_id)).size).toBe(3);
 }finally{await db.close();}
});

test("the CSM and creative director forms keep their channels, tabs and native answers",async()=>{
 const {db,client}=await fixture();try{
  await actor(db,SALEH);
  let ctx=await readPersonalEod(client,"csm");
  await savePersonalEod(client,"csm",ctx,{energy:"6",stress:"3",submit:true,
   answers:{callSummary:"Called Acme about renewal",expectations:"Finished",touchpoints:"Yes",upsells:"No",rollup:"Quiet day",onePercent:"Shorter calls"},
   computed:{handled:3,calls:2,signups:0,hot:1,tickets:0,left:0}});
  await actor(db,SABRI);
  ctx=await readPersonalEod(client,"creative");
  await savePersonalEod(client,"creative",ctx,{energy:"9",submit:true,
   answers:{scripts:"2 for Acme",feedbackLogged:"Yes",priorities:"Hooks for Beta",summary:"Good day",blockers:""},
   computed:{checksDone:4,checksTotal:5,scriptsOpen:3,scriptsStale:1}});
  await actor(db,LINA);
  ctx=await readPersonalEod(client,"creative");
  await savePersonalEod(client,"creative",ctx,{submit:true,answers:{summary:"First day"}});
  const [csm,creative,lina]=await outbox(db);
  expect(csm).toMatchObject({role:"csm",channel:"#eods-csms",tab:"Account Manager",slack_id:"USALEH"});
  expect(csm.body.split("\n").slice(0,5)).toEqual(["*CSM EOD*",`*Date - ${asDate(ctx.day)}`,"","*Name - Saleh Example*","Submitted by: <@USALEH>"]);
  for(const text of ["Energy - 6","Stress - 3","Clients handled today - 3","Signups or onboarding steps - 0","*CALLS*\nCalled Acme about renewal","*1% BETTER*\nShorter calls","*DAY SUMMARY*\nQuiet day","*PAUSED*\n--"])
   expect(csm.body).toContain(text);
  expect(csm.row_values).toHaveLength(10);
  expect(csm.row_values.slice(4)).toEqual(["6","","","","","Quiet day"]);
  expect(creative).toMatchObject({role:"creative",channel:"C0AQ2LD0PL1",tab:"Creative Director",slack_id:"U0B2SHGS1JA"});
  for(const text of ["*CREATIVE DIRECTOR EOD*","Submitted by: <@U0B2SHGS1JA>","Scripts completed today - 2 for Acme","Checks done - 4 of 5","Scripts open - 3 (1 stale)","*BLOCKERS*\n--","*TOMORROW*\nHooks for Beta"])
   expect(creative.body).toContain(text);
  expect(creative.row_values.slice(4)).toEqual(["9","","","","Hooks for Beta","Good day"]);
  expect(lina).toMatchObject({person:"Lina",slack_id:null});
  expect(lina.body).toContain("Submitted by: Lina");
 }finally{await db.close();}
});

test("a Convex-era row is taken over only while untouched; one that already went out is never sent again",async()=>{
 const {db,client}=await fixture();try{
  await actor(db,SALEH);
  const ctx=await readPersonalEod(client,"csm");
  await owner(db);
  await db.query(`insert into eod_outbox(role,day,person,slack_id,channel,tab,body,row_values,status,attempts,error)
   values('csm',$1,'Saleh Example','U09SHBK2C9F','#eods-csms','Account Manager','Convex body','[]','queued',2,'slack: not_in_channel')`,[ctx.day]);
  await db.query(`insert into eod_outbox(role,day,person,channel,body,status,slack_ts,sent_at)
   values('creative',$1,'Sabri Example','C0AQ2LD0PL1','Already posted','sent','1.1',now())`,[ctx.day]);
  const before=await outbox(db);
  await actor(db,SALEH);
  const csm:any=await savePersonalEod(client,"csm",ctx,{submit:true,answers:{rollup:"Native"}});
  await actor(db,SABRI);
  const creativeCtx=await readPersonalEod(client,"creative");
  const creative:any=await savePersonalEod(client,"creative",creativeCtx,{submit:true,answers:{summary:"Native"}});
  expect(creative.outbox).toBeNull();
  const rows=await outbox(db);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({id:before[0].id,report_id:Number(csm.report.id),attempts:0,error:null,slack_id:"USALEH"});
  expect(rows[0].body).toContain("*DAY SUMMARY*\nNative");
  expect(rows[1]).toEqual(before[1]);
 }finally{await db.close();}
});

test("the migration refuses to apply without the delivery claims out.py needs",async()=>{
 const db=await base();try{
  await expect(db.exec(migration(MIGRATION))).rejects.toThrow(/20260927b_eod_delivery_claims/);
  await db.exec("rollback");
  expect((await db.query<any>("select to_regprocedure('public.cockpit_enqueue_personal_eod(bigint)') as fn")).rows[0].fn).toBeNull();
 }finally{await db.close();}
});

test("only the service role may queue directly; browsers cannot read or write the outbox",async()=>{
 const {db,client}=await fixture();try{
  await actor(db,NADA);
  const ctx=await readPersonalEod(client,"media_buyer");
  const saved:any=await savePersonalEod(client,"media_buyer",ctx,{answers:{focus:"1"}});
  await expect(db.query("select cockpit_enqueue_personal_eod($1)",[saved.report.id])).rejects.toThrow(/permission denied/);
  await expect(db.exec("select * from eod_outbox")).rejects.toThrow(/permission denied/);
  await expect(db.exec("select cockpit_eod_pick('{}'::jsonb,'a')")).rejects.toThrow(/permission denied/);
  await actor(db,null);
  await expect(db.exec("select * from eod_outbox")).rejects.toThrow(/permission denied/);
  await owner(db);await db.exec("set role service_role");
  await expect(db.query("select cockpit_enqueue_personal_eod($1)",[saved.report.id])).rejects.toThrow(/Only a submitted personal EOD/);
  await owner(db);
  const legacy=(await db.query<any>(`insert into cockpit_eod_reports(role,day,submitted_at,answers,source_deployment,source_id)
   values('media_buyer',current_date-3,now(),'{}','legacy','legacy-1') returning id`)).rows[0].id;
  await db.exec("set role service_role");
  await expect(db.query("select cockpit_enqueue_personal_eod($1)",[legacy])).rejects.toThrow(/Only a submitted personal EOD/);
  expect(await outbox(db)).toHaveLength(0);
 }finally{await db.close();}
});

test("a failed outbox audit rolls the submit back with it",async()=>{
 const {db,client}=await fixture();try{
  await actor(db,NADA);
  const ctx=await readPersonalEod(client,"media_buyer");
  await savePersonalEod(client,"media_buyer",ctx,{answers:{focus:"1"}});
  await owner(db);
  await db.exec(`create function reject_outbox_audit() returns trigger language plpgsql as $$
   begin if new.entity_type='eod_outbox' then raise exception 'Audit unavailable'; end if; return new; end$$;
   create trigger reject_outbox_audit before insert on cockpit_audit_log for each row execute function reject_outbox_audit();`);
  await actor(db,NADA);
  await expect(savePersonalEod(client,"media_buyer",ctx,{submit:true})).rejects.toThrow(/Audit unavailable/);
  expect((await readPersonalEod(client,"media_buyer")).report.submitted_at).toBeNull();
  expect(await outbox(db)).toHaveLength(0);
 }finally{await db.close();}
});
