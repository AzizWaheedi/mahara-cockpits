import {expect,test} from "bun:test";
import type {SupabaseClient} from "@supabase/supabase-js";
import {actor,cockpitTestDb,member,migration,owner} from "./lib/cockpitTestDb";
import {readPersonalEod,savePersonalEod} from "../src/lib/personalEod";
const A="00000000-0000-4000-8000-000000000001",B="00000000-0000-4000-8000-000000000002";
const C="00000000-0000-4000-8000-000000000003",F="00000000-0000-4000-8000-000000000004";
async function fixture(){
 const db=await cockpitTestDb();
 const ddl=migration("20260923o_cockpit_domain_tables.sql").match(/CREATE TABLE IF NOT EXISTS public\.cockpit_eod_reports \([\s\S]*?\n\);/);
 await db.exec(ddl![0]);
 const old=migration("20260923p_cockpit_actions_and_rpcs.sql");
 await db.exec(old.match(/CREATE UNIQUE INDEX IF NOT EXISTS uq_cockpit_eod_role_day[\s\S]*?;/)![0]);
 for(const name of ["cockpit_save_eod","cockpit_get_dashboard_summary"]){
  const fn=old.match(new RegExp("CREATE OR REPLACE FUNCTION public\\."+name+"\\([\\s\\S]*?\\$\\$;"));
  expect(fn).not.toBeNull();await db.exec(fn![0]);
 }
 await db.exec(`insert into cockpit_eod_reports(role,day,submitted_at,answers,source_deployment,source_id)
 select 'media_buyer',((now() at time zone 'Asia/Kuwait')-interval '4 hours')::date-n,now(),
 '{"human":"Old shared report"}'::jsonb,'legacy','legacy-'||n from generate_series(0,3) n;`);
 const before=(await db.query<any>("select to_jsonb(r) as row from cockpit_eod_reports r order by id")).rows;
 await db.exec(migration("20260927e_cockpit_personal_eod.sql"));
 await db.exec(migration("20260927e_cockpit_personal_eod.sql"));
 const after=(await db.query<any>("select to_jsonb(r)-array['owner_user_id','owner_email','body','stress'] as row from cockpit_eod_reports r order by id")).rows;
 expect(after).toEqual(before);
 await member(db,A,"a@tests.invalid",["media_buyer"]);
 await member(db,B,"b@tests.invalid",["media_buyer"]);
 await member(db,C,"c@tests.invalid",["csm"]);
 await member(db,F,"aziz@maharamedia.com",[]);
 const keys:Record<string,string[]>={cockpit_personal_eod:["p_role","p_day"],cockpit_save_personal_eod:["p_role","p_patch","p_expected_owner","p_day"]};
 const client={async rpc(name:string,args:Record<string,unknown>){
  expect(Object.keys(args).sort()).toEqual([...keys[name]].sort());
  try{
   const result=await db.query<any>("select "+name+"("+keys[name].map((k,i)=>k+"=>$"+(i+1)).join(",")+") as result",
    keys[name].map(k=>args[k]!==null && typeof args[k]==="object"?JSON.stringify(args[k]):args[k]));
   return {data:result.rows[0].result,error:null};
  }catch(error){return {data:null,error};}
 }} as unknown as SupabaseClient;
 await actor(db,A);
 return {db,client};
}
test("two same-role people own independent reports; shared history remains untouched",async()=>{
 const {db,client}=await fixture();try{
  const a=await readPersonalEod(client,"media_buyer");expect(a.report).toBeNull();
  await savePersonalEod(client,"media_buyer",a,{answers:{summary:"Person A"}});
  await actor(db,B);const b=await readPersonalEod(client,"media_buyer");expect(b.report).toBeNull();
  const saved=await savePersonalEod(client,"media_buyer",b,{answers:{summary:"Person B"},submit:true});
  expect(saved.report.submittedAt).toBeGreaterThan(0);expect(saved.delivery).toBe("not_configured");
  await expect(savePersonalEod(client,"media_buyer",a,{answers:{summary:"Overwrite A"}})).rejects.toThrow(/session changed/);
  await expect(savePersonalEod(client,"media_buyer",b,{owner_user_id:A})).rejects.toThrow(/Unsupported/);
  await actor(db,A);expect((await readPersonalEod(client,"media_buyer")).report.answers.summary).toBe("Person A");
  await expect(db.exec("select cockpit_legacy_eod_history(null)")).rejects.toThrow(/founder/);
  await actor(db,F);const legacy=(await db.query<any>("select cockpit_legacy_eod_history(null) as rows")).rows[0].rows;
  expect(legacy).toHaveLength(4);expect(legacy.every((r:any)=>r.owner_user_id===null)).toBe(true);
  await owner(db);expect((await db.query<any>("select count(*)::int as n from cockpit_eod_reports where role='media_buyer' and day=$1",[a.day])).rows[0].n).toBe(3);
 }finally{await db.close();}
});
test("partial drafts preserve human answers/body and zero; submission retries are immutable and audited once",async()=>{
 const {db,client}=await fixture();try{
  const ctx=await readPersonalEod(client,"media_buyer");
  const draft=await savePersonalEod(client,"media_buyer",ctx,{energy:0,stress:"0",answers:{human:"Kept",zero:0},computed:{leads:0},body:"Original"});
  expect(draft.report.submittedAt).toBeNull();expect(draft.report.energy).toBe(0);expect(draft.report.stress).toBe(0);
  await savePersonalEod(client,"media_buyer",ctx,{answers:{extra:"Added"}});
  const submitted=await savePersonalEod(client,"media_buyer",ctx,{submit:true});
  expect(submitted.report.answers).toEqual({human:"Kept",zero:0,extra:"Added"});expect(submitted.report.body).toBe("Original");
  await owner(db);const count=(await db.query<any>("select count(*)::int as n from cockpit_audit_log")).rows[0].n;
  await actor(db,A);
  expect((await savePersonalEod(client,"media_buyer",ctx,{submit:true})).report.submittedAt).toBe(submitted.report.submittedAt);
  await expect(savePersonalEod(client,"media_buyer",ctx,{answers:{human:"Changed"}})).rejects.toThrow(/cannot be overwritten/);
  await owner(db);expect((await db.query<any>("select count(*)::int as n from cockpit_audit_log")).rows[0].n).toBe(count);
  await db.exec("set role service_role");
  await expect(db.query("update cockpit_eod_reports set body='Changed' where id=$1",[submitted.report.id])).rejects.toThrow(/immutable/);
  await expect(db.exec("delete from cockpit_eod_reports")).rejects.toThrow(/permission denied/);
 }finally{await db.close();}
});
test("wrong role, unconfirmed and revoked users cannot read or save; old RPCs cannot bypass ownership",async()=>{
 const {db,client}=await fixture();try{
  const ctx=await readPersonalEod(client,"media_buyer");
  await actor(db,C);await expect(readPersonalEod(client,"media_buyer")).rejects.toThrow(/verified access/);
  const own=await readPersonalEod(client,"csm");
  expect((await savePersonalEod(client,"csm",own,{energy:"7",stress:"4",submit:true})).report.stress).toBe(4);
  await actor(db,A);await expect(db.exec("select cockpit_get_dashboard_summary('media_buyer',current_date)")).rejects.toThrow(/permission denied/);
  await expect(db.exec("select cockpit_save_eod('media_buyer',current_date)")).rejects.toThrow(/permission denied/);
  await owner(db);await db.query("update cockpit_members set active=false where auth_user_id=$1",[A]);await actor(db,A);
  await expect(readPersonalEod(client,"media_buyer")).rejects.toThrow(/verified access/);
  await expect(savePersonalEod(client,"media_buyer",ctx,{body:"Denied"})).rejects.toThrow(/verified access/);
  await owner(db);await db.query("update auth.users set email_confirmed_at=null where id=$1",[B]);await actor(db,B);
  await expect(readPersonalEod(client,"media_buyer")).rejects.toThrow(/verified access/);
 }finally{await db.close();}
});
test("RLS independently filters private reports even if a read grant is later added",async()=>{
 const {db,client}=await fixture();try{
  const a=await readPersonalEod(client,"media_buyer");await savePersonalEod(client,"media_buyer",a,{body:"Private A"});
  await actor(db,B);const b=await readPersonalEod(client,"media_buyer");await savePersonalEod(client,"media_buyer",b,{body:"Private B"});
  await owner(db);await db.exec("grant select on cockpit_eod_reports to authenticated");await actor(db,A);
  const visible=(await db.query<any>("select owner_user_id,body from cockpit_eod_reports")).rows;
  expect(visible).toEqual([{owner_user_id:A,body:"Private A"}]);
 }finally{await db.close();}
});
test("Kuwait working-day cutoff is server-owned and future days fail",async()=>{
 const {db,client}=await fixture();try{
  await owner(db);
  const days=(await db.query<any>(`select cockpit_eod_working_day('2026-09-27 00:59:59+00')::text as before,
   cockpit_eod_working_day('2026-09-27 01:00:00+00')::text as after`)).rows[0];
  expect(days).toEqual({before:"2026-09-26",after:"2026-09-27"});
  await actor(db,A);const ctx=await readPersonalEod(client,"media_buyer");
  await expect(readPersonalEod(client,"media_buyer","2999-01-01")).rejects.toThrow(/future/);
  await expect(savePersonalEod(client,"media_buyer",{...ctx,day:"2999-01-01"},{submit:true})).rejects.toThrow(/future/);
  await expect(savePersonalEod(client,"media_buyer",ctx,{energy:"NaN"})).rejects.toThrow();
  await expect(savePersonalEod(client,"media_buyer",ctx,{submit:"yes"})).rejects.toThrow(/true or false/);
 }finally{await db.close();}
});
test("audit failure rolls back a report; malformed client receipts cannot claim success",async()=>{
 const {db,client}=await fixture();try{
  const ctx=await readPersonalEod(client,"media_buyer");
  await owner(db);await db.exec(`create function reject_eod_audit() returns trigger language plpgsql as $$begin raise exception 'Audit unavailable';end$$;
  create trigger reject_eod_audit before insert on cockpit_audit_log for each row execute function reject_eod_audit();`);
  await actor(db,A);await expect(savePersonalEod(client,"media_buyer",ctx,{body:"Rollback"})).rejects.toThrow(/Audit unavailable/);
  expect((await readPersonalEod(client,"media_buyer")).report).toBeNull();
  const fake={rpc:async()=>({data:{ok:true},error:null})} as unknown as SupabaseClient;
  await expect(savePersonalEod(fake,"media_buyer",ctx,{body:"No receipt"})).rejects.toThrow(/did not confirm/);
 }finally{await db.close();}
});
