import { beforeAll, afterAll, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { actor, cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";
import { csmMoneyPatch, csmPreferences, dismissCsmLooseEnds, isMoneyLoose, readCsmState, saveCsmHotRow, saveCsmLanguage, saveCsmMoneyGoals, visibleLooseEnds } from "../../client-success-cockpit/src/lib/csmStateClient";

let db: PGlite;
let month: string;
const a="00000000-0000-4000-8000-000000000001";
const b="00000000-0000-4000-8000-000000000002";
const founder="00000000-0000-4000-8000-000000000003";
const other="00000000-0000-4000-8000-000000000004";
const loose=["Arrange next meeting","Invoice overdue","Check payment","Write recap","Card expired"];
const operations: Record<string,{sql:string;keys:string[]}> = {
  cockpit_csm_state:{sql:"SELECT public.cockpit_csm_state($1) AS result",keys:["p_month"]},
  cockpit_csm_set_language:{sql:"SELECT public.cockpit_csm_set_language($1,$2) AS result",keys:["p_client_name","p_language"]},
  cockpit_csm_save_hot_row:{sql:"SELECT public.cockpit_csm_save_hot_row($1::jsonb) AS result",keys:["p_patch"]},
  cockpit_csm_clear_loose:{sql:"SELECT public.cockpit_csm_clear_loose($1) AS result",keys:["p_client_name"]},
  cockpit_csm_save_money_goals:{sql:"SELECT public.cockpit_csm_save_money_goals($1::jsonb) AS result",keys:["p_patch"]},
};
const client={async rpc(name:string,args:Record<string,unknown>){
  const op=operations[name]; if(!op) throw new Error(`Unexpected RPC ${name}`);
  expect(Object.keys(args).sort()).toEqual([...op.keys].sort());
  try {
    const result=await db.query<{result:unknown}>(op.sql,op.keys.map(k=>typeof args[k]==="object" && args[k]!==null ? JSON.stringify(args[k]) : args[k]));
    return {data:result.rows[0].result,error:null};
  } catch(error){return {data:null,error};}
}} as unknown as SupabaseClient;

beforeAll(async()=>{
  db=await cockpitTestDb();
  const profile=migration("20260923o_cockpit_domain_tables.sql").match(/CREATE TABLE IF NOT EXISTS public\.cockpit_client_profiles \([\s\S]*?\n\);/);
  expect(profile).not.toBeNull(); await db.exec(profile![0]);
  for(const name of ["Client A","Client B"]){
    await db.query("INSERT INTO public.cockpit_client_profiles(client_name,notes,kpi,overview) VALUES($1,$2::jsonb,$3::jsonb,$4::jsonb)",[
      name,JSON.stringify([`Human note for ${name}`]),JSON.stringify({kept:10}),JSON.stringify({language:"en",loose,hot:["An automatic suggestion"],keep:"Human overview"}),
    ]);
  }
  await member(db,a,"csm-a@tests.invalid",["csm"]);
  await member(db,b,"csm-b@tests.invalid",["csm"]);
  await member(db,founder,"aziz@maharamedia.com",[]);
  await member(db,other,"sales@tests.invalid",["sales"]);
  await db.query("UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2",[["client a"],a]);
  await db.query("UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2",[["Client B"],b]);
  await db.exec(migration("20260926m_cockpit_csm_state.sql"));
},15000);
afterAll(async()=>{await db.close();});

test("client scope applies to state and direct profile reads; language persists separately",async()=>{
  await actor(db,a);
  const initial=await readCsmState(client); month=initial.month;
  expect(initial.profiles.map(p=>p.client_name)).toEqual(["Client A"]);
  expect(csmPreferences(initial)).toEqual([{clientName:"Client A",language:"en"}]);
  expect(initial.hotRows).toEqual([]); // Automated suggestions are not manual rows.
  await saveCsmLanguage(client,{clientName:"Client A",language:"ar"});
  const refreshed=await readCsmState(client);
  expect(csmPreferences(refreshed)).toEqual([{clientName:"Client A",language:"ar"}]);
  expect(refreshed.profiles[0].overview.language).toBe("en");
  expect((await db.query<{client_name:string}>("SELECT client_name FROM public.cockpit_client_profiles")).rows.map(r=>r.client_name)).toEqual(["Client A"]);
  await expect(saveCsmLanguage(client,{clientName:"Client B",language:"ar"})).rejects.toThrow("access denied");
});

test("blank drafts are private and cannot be stolen or reassigned outside scope",async()=>{
  await actor(db,a);
  await saveCsmHotRow(client,{key:"manual:fixture",clientName:"",type:"",manual:true});
  expect((await readCsmState(client)).hotRows).toHaveLength(1);
  await actor(db,b);
  expect((await readCsmState(client)).hotRows).toHaveLength(0);
  await expect(saveCsmHotRow(client,{key:"manual:fixture",clientName:"Client B"})).rejects.toThrow("access denied");
  await actor(db,a);
  await expect(saveCsmHotRow(client,{key:"manual:fixture",clientName:"Client B"})).rejects.toThrow("access denied");
  await saveCsmHotRow(client,{key:"manual:fixture",clientName:"Client A",notes:"Keep the exact human note",amount:"0",type:"Referral"});
  await saveCsmHotRow(client,{key:"manual:fixture",status:"Closed"});
  expect((await readCsmState(client)).hotRows[0]).toMatchObject({notes:"Keep the exact human note",amount:"0",status:"Closed"});
  await saveCsmHotRow(client,{key:"manual:fixture",hidden:true});
  expect((await readCsmState(client)).hotRows[0].hidden).toBe(true);
  await actor(db,b);
  expect((await readCsmState(client)).hotRows).toEqual([]);
  await expect(saveCsmHotRow(client,{key:"manual:fixture",clientName:"Client B",hidden:false})).rejects.toThrow("access denied");
});

test("loose-end clearing is scoped, preserves money and never edits original notes",async()=>{
  await actor(db,a);
  expect(await dismissCsmLooseEnds(client)).toEqual({cleared:2,kept:3});
  expect(await dismissCsmLooseEnds(client)).toEqual({cleared:0,kept:3});
  const state=await readCsmState(client);
  expect(state.profiles[0].overview.loose).toEqual(loose);
  expect(visibleLooseEnds(state,"Client A",loose)).toEqual(loose.filter(isMoneyLoose));
  await expect(dismissCsmLooseEnds(client,{clientName:"Client B"})).rejects.toThrow("access denied");
  await actor(db,b);
  const untouched=await readCsmState(client);
  expect(untouched.dismissed).toEqual([]);
  expect(visibleLooseEnds(untouched,"Client B",loose)).toEqual(loose);
});

test("personal monthly plans preserve zero and merge only changed counts",async()=>{
  await actor(db,a);
  await saveCsmMoneyGoals(client,{month,target:0,clients:0,counts:{referrals:0,reviews:2}});
  const patch=csmMoneyPatch(month,null,null,{referrals:3});
  expect(patch).toEqual({month,counts:{referrals:3}});
  await saveCsmMoneyGoals(client,patch);
  expect((await readCsmState(client)).money).toMatchObject({target:0,clients:0,counts:{referrals:3,reviews:2}});
  await actor(db,b);
  expect((await readCsmState(client)).money).toBeNull();
  await saveCsmMoneyGoals(client,{month,target:500,counts:{reviews:1}});
  expect((await readCsmState(client)).money?.target).toBe(500);
  await actor(db,a);
  expect((await readCsmState(client)).money?.target).toBe(0);
  await saveCsmMoneyGoals(client,csmMoneyPatch(month,"","",{}));
  expect((await readCsmState(client)).money).toMatchObject({target:null,clients:null,counts:{referrals:3,reviews:2}});
  expect(csmMoneyPatch(month,"0","0",{})).toEqual({month,target:0,clients:0,counts:{}});
});

test("profile patches preserve omitted human fields and enforce client scope",async()=>{
  await actor(db,a);
  await db.query("SELECT public.cockpit_update_client_profile($1,p_stage=>$2)",["Client A","Onboarding"]);
  await db.query("SELECT public.cockpit_update_client_profile($1,p_kpi=>$2::jsonb,p_overview=>$3::jsonb)",["Client A",JSON.stringify({added:0}),JSON.stringify({newField:"new"})]);
  const profile=(await readCsmState(client)).profiles[0];
  expect(profile.notes).toEqual(["Human note for Client A"]);
  expect(profile.kpi).toEqual({kept:10,added:0});
  expect(profile.overview).toMatchObject({keep:"Human overview",newField:"new",loose});
  await db.query("SELECT public.cockpit_update_client_profile('Client A',p_kpi=>$1::jsonb)",[JSON.stringify({nested:{keep:7,change:1}})]);
  await db.query("SELECT public.cockpit_update_client_profile('Client A',p_kpi=>$1::jsonb)",[JSON.stringify({nested:{change:0}})]);
  expect((await readCsmState(client)).profiles[0].kpi.nested).toEqual({keep:7,change:0});
  await expect(db.query("SELECT public.cockpit_update_client_profile('Client B',p_stage=>'Lost')")).rejects.toMatchObject({code:"42501"});
  await expect(db.query("UPDATE public.cockpit_client_profiles SET notes='[]'")).rejects.toMatchObject({code:"42501"});
});

test("unconfirmed, revoked, unrelated and anonymous identities are denied",async()=>{
  const queries=["SELECT public.cockpit_csm_state()","SELECT public.cockpit_csm_set_language('Client A','ar')",
    "SELECT public.cockpit_csm_save_hot_row('{}')","SELECT public.cockpit_csm_clear_loose()","SELECT public.cockpit_csm_save_money_goals('{}')"];
  for(const id of [other,null]){
    await actor(db,id);
    for(const sql of queries) await expect(db.query(sql)).rejects.toMatchObject({code:"42501"});
  }
  await owner(db); await db.query("UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1",[a]);
  await actor(db,a); await expect(readCsmState(client)).rejects.toThrow("access required");
  await owner(db); await db.query("UPDATE auth.users SET email_confirmed_at=now() WHERE id=$1",[a]);
  await db.query("UPDATE public.cockpit_members SET active=false WHERE auth_user_id=$1",[a]);
  await actor(db,a); for(const sql of queries) await expect(db.query(sql)).rejects.toMatchObject({code:"42501"});
  await owner(db); await db.query("UPDATE public.cockpit_members SET active=true WHERE auth_user_id=$1",[a]);
});

test("all state writes are audited; rerun preserves data and audit history",async()=>{
  await owner(db);
  const types=(await db.query<{entity_type:string}>("SELECT DISTINCT entity_type FROM public.cockpit_audit_log")).rows.map(r=>r.entity_type);
  for(const table of ["cockpit_csm_client_preferences","cockpit_csm_hot_rows","cockpit_csm_loose_dismissals","cockpit_csm_money_goals","cockpit_client_profiles"]) expect(types).toContain(table);
  const before=(await db.query<{n:number}>("SELECT count(*)::int AS n FROM public.cockpit_audit_log")).rows[0].n;
  await db.exec(migration("20260926m_cockpit_csm_state.sql"));
  expect((await db.query<{n:number}>("SELECT count(*)::int AS n FROM public.cockpit_audit_log")).rows[0].n).toBe(before);
  await expect(db.query("DELETE FROM public.cockpit_audit_log")).rejects.toThrow("immutable");
  await actor(db,a); expect((await readCsmState(client)).hotRows[0].hidden).toBe(true);
});

test("malformed receipts and invalid numeric edits cannot claim success",async()=>{
  const invalid={rpc:async()=>({data:{ok:true},error:null})} as unknown as SupabaseClient;
  await expect(readCsmState(invalid)).rejects.toThrow("state");
  await expect(saveCsmLanguage(invalid,{clientName:"Client A",language:"ar"})).rejects.toThrow("confirmed");
  await expect(dismissCsmLooseEnds(invalid)).rejects.toThrow("confirmed");
  expect(()=>csmMoneyPatch(month,"bad","",{})).toThrow();
  await expect(saveCsmMoneyGoals(client,{month,target:Number.NaN})).rejects.toThrow("finite");
});
