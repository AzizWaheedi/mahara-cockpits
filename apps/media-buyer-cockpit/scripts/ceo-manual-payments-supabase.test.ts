import {expect,test} from "bun:test";
import type {SupabaseClient} from "@supabase/supabase-js";
import {actor,cockpitTestDb,member,migration,owner} from "./lib/cockpitTestDb";
import {manualPaymentInfo,manualPaymentClients,manualPaymentList,addManualPayment,changeManualPayment,manualPaymentHistory,ManualPaymentError} from "../src/lib/ceoManualPaymentsClient";
const F="00000000-0000-4000-8000-000000000001",F2="00000000-0000-4000-8000-000000000002",OTHER="00000000-0000-4000-8000-000000000003";
async function fixture(ready=true){
 const db=await cockpitTestDb();
 const section=migration("20260921d_cockpit_metrics.sql").match(/create table if not exists public\.cockpit_sections \([\s\S]*?\n\);/i);
 const billing=migration("20260923a_client_billing.sql").match(/create table if not exists public\.cockpit_billing_accounts \([\s\S]*?\n\);/i);
 expect(section).not.toBeNull();expect(billing).not.toBeNull();await db.exec(section![0]);await db.exec(billing![0]);
 await db.exec(migration("20260927d_cockpit_manual_payments_access.sql"));
 await db.exec(migration("20260927d_cockpit_manual_payments_access.sql"));
 await member(db,F,"aziz@maharamedia.com",[]);await member(db,F2,"awaheedi2008@gmail.com",[]);
 await member(db,OTHER,"other@tests.invalid",["admin","ceo"]);
 await db.exec(`insert into cockpit_sections(key,label,computed_at,payload) values('money','Money',now(),'{"rails":{"tap":{"connected":true}}}');
 insert into cockpit_billing_accounts(clickup_task_id,client_name,stage_group) values('task_a','Client A','active');`);
 if(ready)await db.exec("update cockpit_manual_payment_state set history_ready=true");
 const keys:Record<string,string[]>={cockpit_ceo_manual_payment_info:[],cockpit_ceo_manual_payment_clients:[],
 cockpit_ceo_manual_payment_list:["p_month"],cockpit_ceo_manual_payment_add:["p_input","p_request_id"],
 cockpit_ceo_manual_payment_status:["p_id","p_removed","p_reason","p_allow_repeat"],cockpit_ceo_manual_payment_history:["p_id"]};
 const client={async rpc(name:string,args:Record<string,unknown>={}){
  expect(Object.keys(args).sort()).toEqual([...keys[name]].sort());
  try{const result=await db.query<any>("select "+name+"("+keys[name].map((k,i)=>k+"=>$"+(i+1)).join(",")+") as result",
   keys[name].map(k=>args[k]!==null && typeof args[k]==="object"?JSON.stringify(args[k]):args[k]));
   return {data:result.rows[0].result,error:null};
  }catch(e){const err=e as any;return {data:null,error:{message:err.message,details:err.detail,code:err.code}};}
 }} as unknown as SupabaseClient;
 await actor(db,F);const day=(await manualPaymentInfo(client)).today;
 return {db,client,day};
}
const input=(day:string)=>({day,amount:100,currency:"USD",rail:"bank_transfer",clientName:"Client A",clickupTaskId:"task_a"});
test("history import is a real readiness gate, not an empty zero-payment log",async()=>{
 const {db,client,day}=await fixture(false);try{
  expect((await manualPaymentInfo(client)).historyReady).toBe(false);
  await expect(manualPaymentList(client)).rejects.toThrow(/Import and reconcile/);
  await expect(addManualPayment(client,input(day))).rejects.toThrow(/Import and reconcile/);
 }finally{await db.close();}
});
test("add/read uses original FX, contact masking, stable retries and explicit total reconciliation",async()=>{
 const {db,client,day}=await fixture();try{
  const requestId=crypto.randomUUID();const payment={...input(day),requestId,amount:4.125,currency:"KWD",note:"person@test.invalid +965 5555 1111"};
  const id=await addManualPayment(client,payment);
  expect(await addManualPayment(client,payment)).toBe(id);
  await expect(addManualPayment(client,{...payment,amount:5})).rejects.toThrow(/reused/);
  const rows=await manualPaymentList(client,{month:day.slice(0,7)});expect(rows).toHaveLength(1);
  expect(rows[0].amount).toBe(4.125);expect(rows[0].amountUsd).toBe(13.45);expect(rows[0].usdPerUnit).toBe(3.26);
  expect(rows[0].note).toContain("[email]");expect(rows[0].note).toContain("[number]");expect(rows[0].addedBy).toBe("Aziz");
  const raw=JSON.stringify((await db.query("select cockpit_ceo_manual_payment_list(null)")).rows);
  expect(raw).not.toContain("person@test.invalid");expect(raw).not.toContain("5555 1111");expect(raw).not.toContain("request_data");
  expect((await manualPaymentInfo(client)).totalsNeedRefresh).toBe(true);
  expect(await manualPaymentClients(client)).toEqual([{name:"Client A",clickupTaskId:"task_a",bucket:"active"}]);
  await owner(db);
  expect((await db.query<any>("select count(*)::int as n from cockpit_audit_log where entity_type='cockpit_manual_payments'")).rows[0].n).toBe(1);
  await expect(db.exec("update cockpit_manual_payments set usd_per_unit=99")).rejects.toThrow(/immutable/);
 }finally{await db.close();}
});
test("duplicate name/card payments require confirmation; delete/restore preserves originals and history",async()=>{
 const {db,client,day}=await fixture();try{
  const id=await addManualPayment(client,{...input(day),clientName:"Ácme",clickupTaskId:undefined});
  try{await addManualPayment(client,{...input(day),clientName:" acme ",clickupTaskId:undefined});throw Error("Expected duplicate refusal");}
  catch(e){expect(e).toBeInstanceOf(ManualPaymentError);expect((e as ManualPaymentError).data.code).toBe("repeat");}
  await changeManualPayment(client,{id,reason:"Correction requested"},true);
  await changeManualPayment(client,{id},true); // lost-response retry, not a second removal
  await actor(db,F2);await changeManualPayment(client,{id},false);
  let rows=await manualPaymentList(client);expect(rows[0].deletedAt).toBeNull();expect(rows[0].amountUsd).toBe(100);
  const history=await manualPaymentHistory(client,{id});expect(history).toHaveLength(3);
  expect(history.some(r=>r.action==="manualPayment.remove" && r.what.includes("Correction requested"))).toBe(true);
  await changeManualPayment(client,{id},true);
  await addManualPayment(client,{...input(day),clientName:"acme",clickupTaskId:undefined});
  try{await changeManualPayment(client,{id},false);throw Error("Expected restore refusal");}
  catch(e){expect((e as ManualPaymentError).data.code).toBe("repeat");}
  await changeManualPayment(client,{id,allowRepeat:true},false);
  rows=await manualPaymentList(client);expect(rows.filter(r=>r.deletedAt===null)).toHaveLength(2);
 }finally{await db.close();}
});
test("Tap unknown is not disconnected; precision, dates, references and forged fields fail atomically",async()=>{
 const {db,client,day}=await fixture();try{
  await expect(addManualPayment(client,{...input(day),rail:"tap"})).rejects.toThrow(/Tap is connected/);
  await owner(db);await db.exec("update cockpit_sections set computed_at=now()-interval '2 hours'");await actor(db,F);
  expect((await manualPaymentInfo(client)).tapLive).toBeNull();
  await expect(addManualPayment(client,{...input(day),rail:"tap"})).rejects.toThrow(/unavailable/);
  for(const patch of [{amount:0},{amount:-1},{amount:1000001},{amount:1.001},{amount:1.0001,currency:"KWD"},
   {day:"2026-02-30"},{day:"2999-01-01"},{clickupTaskId:"unknown"},{amountUsd:10},{addedBy:"other"},{kind:"refund",dealContracted:10}]){
    await expect(addManualPayment(client,{...input(day),...patch})).rejects.toThrow();
  }
  expect(await manualPaymentList(client)).toHaveLength(0);
  await owner(db);await db.exec(`update cockpit_sections set computed_at=now(),payload='{"rails":{"tap":{"connected":false}}}'`);await actor(db,F);
  const id=await addManualPayment(client,{...input(day),rail:"tap",amount:0.001,currency:"KWD"});
  expect((await manualPaymentList(client))[0].amountUsd).toBe(0);
  await changeManualPayment(client,{id},true);await owner(db);
  await db.exec(`update cockpit_sections set payload='{"rails":{"tap":{"connected":true}}}'`);await actor(db,F);
  await expect(changeManualPayment(client,{id},false)).rejects.toThrow(/Tap/);
 }finally{await db.close();}
});
test("both founders work; ordinary admins, spoofed and revoked identities cannot read or write",async()=>{
 const {db,client,day}=await fixture();try{
  await actor(db,F2);const id=await addManualPayment(client,input(day));expect(id).toBeTruthy();
  await actor(db,OTHER);await expect(manualPaymentInfo(client)).rejects.toThrow(/founder/);
  await expect(changeManualPayment(client,{id},true)).rejects.toThrow(/founder/);
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({email:"aziz@maharamedia.com",role:"authenticated"})]);
  await expect(addManualPayment(client,input(day))).rejects.toThrow(/founder/);
  await owner(db);await db.query("update auth.users set email_confirmed_at=null where id=$1",[F]);
  await actor(db,F);await expect(manualPaymentList(client)).rejects.toThrow(/founder/);
  await owner(db);await db.query("update cockpit_members set active=false where auth_user_id=$1",[F2]);
  await actor(db,F2);await expect(manualPaymentHistory(client,{id})).rejects.toThrow(/founder/);
  await expect(db.exec("select * from cockpit_manual_payments")).rejects.toThrow(/permission denied/);
 }finally{await db.close();}
});
test("audit failure rolls back payment and revision; imported identifiers/rates survive status changes",async()=>{
 const {db,client,day}=await fixture();try{
  await owner(db);
  await db.query(`insert into cockpit_manual_payments(id,day,amount,currency,amount_usd,usd_per_unit,client_name,client_key,rail,added_by,
  source_system,source_deployment,source_id) values('legacy-convex-id',$1,10,'KWD',32.40,3.24,'Legacy','legacy','cash','original@tests.invalid','convex','legacy-deployment','source-id')`,[day]);
  await actor(db,F);await changeManualPayment(client,{id:"legacy-convex-id"},true);await changeManualPayment(client,{id:"legacy-convex-id"},false);
  const legacy=(await manualPaymentList(client))[0];expect(legacy.id).toBe("legacy-convex-id");expect(legacy.usdPerUnit).toBe(3.24);expect(legacy.amountUsd).toBe(32.4);
  await owner(db);const revision=(await db.query<any>("select revision from cockpit_manual_payment_state")).rows[0].revision;
  await db.exec(`create function reject_payment_audit() returns trigger language plpgsql as $$begin raise exception 'Audit unavailable';end$$;
   create trigger reject_payment_audit before insert on cockpit_audit_log for each row execute function reject_payment_audit();`);
  await actor(db,F);await expect(addManualPayment(client,input(day))).rejects.toThrow(/Audit unavailable/);
  expect(await manualPaymentList(client)).toHaveLength(1);await owner(db);
  expect((await db.query<any>("select revision from cockpit_manual_payment_state")).rows[0].revision).toBe(revision);
 }finally{await db.close();}
});
test("success-shaped objects are rejected by payment adapters",async()=>{
 const client={rpc:async()=>({data:{ok:true},error:null})} as unknown as SupabaseClient;
 await expect(addManualPayment(client,input("2026-09-27"))).rejects.toThrow(/not confirmed/);
 await expect(changeManualPayment(client,{id:"missing-id"},true)).rejects.toThrow(/not confirmed/);
 await expect(manualPaymentList(client)).rejects.toThrow(/not confirmed/);
 await expect(manualPaymentInfo(client)).rejects.toThrow(/unavailable/);
});
