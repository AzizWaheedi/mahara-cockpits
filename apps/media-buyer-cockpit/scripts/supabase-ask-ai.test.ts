import {expect,test} from "bun:test";
import type {SupabaseClient} from "@supabase/supabase-js";
import {actor,cockpitTestDb,member,migration,owner} from "./lib/cockpitTestDb";
import {submitAskAiJob,getAskAiJob,getAskAiThread,clearAskAiThread,jobsToChatMessages} from "../src/lib/askAiClient";
const A="00000000-0000-4000-8000-000000000001", B="00000000-0000-4000-8000-000000000002";
const C="00000000-0000-4000-8000-000000000003", F="00000000-0000-4000-8000-000000000004";
async function fixture(){
 const db=await cockpitTestDb();
 const profile=migration("20260923o_cockpit_domain_tables.sql").match(/CREATE TABLE IF NOT EXISTS public\.cockpit_client_profiles \([\s\S]*?\n\);/);
 await db.exec(profile![0]);
 await db.exec(migration("20260926m_cockpit_csm_state.sql"));
 const before=(await db.query<any>("select pg_get_functiondef('cockpit_client_allowed(text)'::regprocedure) as body")).rows[0].body;
 await db.exec(migration("20260927a_cockpit_ask_ai_jobs.sql"));
 await db.exec(migration("20260927a_cockpit_ask_ai_jobs.sql"));
 expect((await db.query<any>("select pg_get_functiondef('cockpit_client_allowed(text)'::regprocedure) as body")).rows[0].body).toBe(before);
 await member(db,A,"a@tests.invalid",["media_buyer"]);
 await member(db,B,"b@tests.invalid",["media_buyer"]);
 await member(db,C,"c@tests.invalid",["csm"]);
 await member(db,F,"aziz@maharamedia.com",[]);
 await db.query("update cockpit_members set clients=$1 where auth_user_id=$2",[["Client A"],A]);
 await db.exec("insert into cockpit_client_profiles(client_name,overview) values('Client A','{\"kept\":\"Visible\"}'),('Client B','{\"kept\":\"Secret\"}')");
 const params:Record<string,string[]> = {
  cockpit_submit_ask_ai_job:["p_app","p_role","p_prompt","p_client_name","p_kind","p_context","p_idempotency_key"],
  cockpit_get_ask_ai_job:["p_job_id"],cockpit_get_ask_ai_thread:["p_app","p_limit"],cockpit_clear_ask_ai_thread:["p_app"],
 };
 const client={async rpc(name:string,args:Record<string,unknown>){
   const keys=params[name]; expect(keys).toBeDefined(); expect(Object.keys(args).sort()).toEqual([...keys].sort());
   try {const result=await db.query<any>("select "+name+"("+keys.map((k,i)=>k+"=>$"+(i+1)).join(",")+") as result",
    keys.map(k=>args[k]!==null && typeof args[k]==="object"?JSON.stringify(args[k]):args[k]));
    return {data:result.rows[0].result,error:null};
   }catch(error){return {data:null,error};}
 }} as unknown as SupabaseClient;
 await actor(db,A);
 return {db,client};
}
async function worker(db:any){await owner(db);await db.exec("set role service_role");}
const input={app:"media-buyer" as const,role:"media_buyer" as const,prompt:"What is happening?",clientName:"Client A",idempotencyKey:"request-1"};
test("actual client adapters persist, claim, finish, reload and clear with preserved audit/history",async()=>{
 const {db,client}=await fixture();try{
  const saved=await submitAskAiJob(client,input);expect(saved.error).toBeNull();expect(saved.jobId).toBeTruthy();
  const again=await submitAskAiJob(client,input);expect(again.jobId).toBe(saved.jobId);
  const conflict=await submitAskAiJob(client,{...input,prompt:"Different"});expect(conflict.error?.message).toContain("Idempotency conflict");
  const queued=await getAskAiThread(client,"media-buyer");expect(queued.error).toBeNull();expect(queued.thread[0].status).toBe("queued");
  await worker(db);
  const claim=(await db.query<any>("select * from cockpit_claim_ask_ai_jobs('w',5,300)")).rows[0];
  expect(claim.id).toBe(saved.jobId);expect(claim.context.profiles.map((p:any)=>p.client_name)).toEqual(["Client A"]);
  expect(JSON.stringify(claim.context)).not.toContain("Secret");
  expect((await db.query("select * from cockpit_claim_ask_ai_jobs('other',5,300)")).rows).toHaveLength(0);
  expect((await db.query<any>("select cockpit_complete_ask_ai_job($1,$2,'{\"reply\":\"Verified answer\"}','w') as ok",[claim.id,claim.lease_token])).rows[0].ok).toBe(true);
  await actor(db,A);
  const refreshed=await getAskAiThread(client,"media-buyer");expect(refreshed.thread[0].status).toBe("completed");
  expect(jobsToChatMessages(refreshed.thread).at(-1)?.text).toBe("Verified answer");
  const cleared=await clearAskAiThread(client,"media-buyer");expect(cleared.success).toBe(true);
  expect((await getAskAiThread(client,"media-buyer")).thread).toHaveLength(0);
  await owner(db);
  expect((await db.query<any>("select hidden from cockpit_ask_ai_jobs")).rows[0].hidden).toBe(true);
  expect((await db.query("select * from cockpit_audit_log where entity_type='cockpit_ask_ai_jobs'")).rows.length).toBeGreaterThan(3);
 }finally{await db.close();}
});
test("wrong roles, other owners, unconfirmed identities and raw browser access fail closed",async()=>{
 const {db,client}=await fixture();try{
  const saved=await submitAskAiJob(client,input);
  await actor(db,B);expect((await getAskAiJob(client,saved.jobId!)).error?.message).toContain("Access denied");
  await actor(db,C);expect((await submitAskAiJob(client,input)).error?.message).toContain("Access denied");
  await actor(db,A);expect((await submitAskAiJob(client,{...input,clientName:"Client B"})).error?.message).toContain("Access denied");
  await expect(db.exec("select * from cockpit_ask_ai_jobs")).rejects.toThrow(/permission denied/);
  await expect(db.exec("select * from cockpit_claim_ask_ai_jobs('unauthorized',1,300)")).rejects.toThrow(/permission denied/);
  await owner(db);await db.query("update auth.users set email_confirmed_at=null where id=$1",[A]);
  await actor(db,A);expect((await getAskAiJob(client,saved.jobId!)).error?.message).toContain("Access denied");
  expect((await getAskAiThread(client,"media-buyer")).error?.message).toContain("Access denied");
  await actor(db,null);expect((await submitAskAiJob(client,input)).error).not.toBeNull();
 }finally{await db.close();}
});
test("membership and client scope changes invalidate reads and in-flight context",async()=>{
 const {db,client}=await fixture();try{
  const saved=await submitAskAiJob(client,input);
  await worker(db);const claim=(await db.query<any>("select * from cockpit_claim_ask_ai_jobs('w')")).rows[0];
  await owner(db);await db.query("update cockpit_members set clients=$1 where auth_user_id=$2",[["Client B"],A]);
  await actor(db,A);expect((await getAskAiJob(client,saved.jobId!)).error).not.toBeNull();
  expect((await getAskAiThread(client,"media-buyer")).thread).toHaveLength(0);
  await worker(db);
  expect((await db.query<any>("select cockpit_complete_ask_ai_job($1,$2,'{\"reply\":\"Old access\"}','w') as ok",[claim.id,claim.lease_token])).rows[0].ok).toBe(false);
  expect((await db.query("select * from cockpit_claim_ask_ai_jobs('other')")).rows).toHaveLength(0);
  await owner(db);expect((await db.query<any>("select status from cockpit_ask_ai_jobs")).rows[0].status).toBe("failed");
 }finally{await db.close();}
});
test("expired leases reject old results, retain attempts and rebuild claims",async()=>{
 const {db,client}=await fixture();try{
  await submitAskAiJob(client,input);await worker(db);
  const old=(await db.query<any>("select * from cockpit_claim_ask_ai_jobs('old')")).rows[0];
  await db.exec("update cockpit_ask_ai_jobs set lease_expires_at=now()-interval '1 minute'");
  expect((await db.query<any>("select cockpit_complete_ask_ai_job($1,$2,'{\"reply\":\"Late\"}','old') as ok",[old.id,old.lease_token])).rows[0].ok).toBe(false);
  const fresh=(await db.query<any>("select * from cockpit_claim_ask_ai_jobs('new')")).rows[0];
  expect(fresh.attempts).toBe(2);expect(fresh.lease_token).not.toBe(old.lease_token);
  expect((await db.query<any>("select cockpit_complete_ask_ai_job($1,$2,'{\"reply\":\"Wrong worker\"}','old') as ok",[fresh.id,fresh.lease_token])).rows[0].ok).toBe(false);
  await expect(db.query("select cockpit_complete_ask_ai_job($1,$2,'{}','new')",[fresh.id,fresh.lease_token])).rejects.toThrow(/Nonempty/);
  expect((await db.query<any>("select cockpit_fail_ask_ai_job($1,$2,'Temporary error','new') as ok",[fresh.id,fresh.lease_token])).rows[0].ok).toBe(true);
  const last=(await db.query<any>("select * from cockpit_claim_ask_ai_jobs('last')")).rows[0];expect(last.attempts).toBe(3);
  await db.query("select cockpit_fail_ask_ai_job($1,$2,'Still unavailable','last')",[last.id,last.lease_token]);
  expect((await db.query<any>("select status,error from cockpit_ask_ai_jobs")).rows[0].status).toBe("failed");
  expect((await db.query("select * from cockpit_claim_ask_ai_jobs('never')")).rows).toHaveLength(0);
 }finally{await db.close();}
});
test("clearing cancels pending work; named app configuration and server context remain scoped",async()=>{
 const {db,client}=await fixture();try{
  await submitAskAiJob(client,{...input,prompt:"Read profile",context:{profiles:[{client_name:"Forged"}]}});
  await worker(db);const claim=(await db.query<any>("select * from cockpit_claim_ask_ai_jobs('w')")).rows[0];
  expect(JSON.stringify(claim.context)).not.toContain("Forged");
  await actor(db,A);await clearAskAiThread(client,"media-buyer");
  await worker(db);expect((await db.query<any>("select cockpit_complete_ask_ai_job($1,$2,'{\"reply\":\"Late\"}','w') as ok",[claim.id,claim.lease_token])).rows[0].ok).toBe(false);
  await actor(db,F);expect((await submitAskAiJob(client,{...input,role:"ceo",clientName:"Client B"})).error).toBeNull();
  await actor(db,A);expect((await submitAskAiJob(client,{...input,app:"creative",role:"creative"})).error).not.toBeNull();
 }finally{await db.close();}
});
test("adapters reject success-shaped objects and malformed history instead of inventing success",async()=>{
 const fake={rpc:async()=>({data:{ok:true},error:null})} as unknown as SupabaseClient;
 expect((await submitAskAiJob(fake,input)).error).not.toBeNull();
 expect((await getAskAiJob(fake,A)).error).not.toBeNull();
 expect((await getAskAiThread(fake,"media-buyer")).error).not.toBeNull();
 expect((await clearAskAiThread(fake,"media-buyer")).success).toBe(false);
});
