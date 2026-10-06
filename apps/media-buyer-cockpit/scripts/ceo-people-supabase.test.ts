import {expect,test} from "bun:test";
import type {SupabaseClient} from "@supabase/supabase-js";
import {actor,cockpitTestDb,member,migration,owner} from "./lib/cockpitTestDb";
import {readPeople,readPeopleRoles,savePerson,setPersonActive} from "../src/lib/ceoPeopleClient";
import {defaultSchedule} from "../src/types/ceo/schedule";
const F="00000000-0000-4000-8000-000000000001", F2="00000000-0000-4000-8000-000000000002", OTHER="00000000-0000-4000-8000-000000000003";
async function fixture(){
 const db=await cockpitTestDb();
 const core=migration("20260919_cockpit_core.sql");
 const payroll=core.match(/create table if not exists public\.cockpit_payroll_months \([\s\S]*?\n\);/i);
 const touch=core.match(/create or replace function public\.cockpit_touch_updated_at\(\)[\s\S]*?end \$\$;/i);
 expect(payroll).not.toBeNull();expect(touch).not.toBeNull();
 await db.exec(payroll![0]);await db.exec(touch![0]);
 for(const file of ["20260919b_people.sql","20260920a_people_commission.sql","20260921b_people_schedule.sql","20260922c_people_paused.sql","20260922d_people_bot_engagement.sql","20260927c_cockpit_people_access.sql"]){
   await db.exec(migration(file));
 }
 await db.exec(migration("20260927c_cockpit_people_access.sql"));
 await member(db,F,"aziz@maharamedia.com",[]);
 await member(db,F2,"awaheedi2008@gmail.com",[]);
 await member(db,OTHER,"other@tests.invalid",["admin","ceo","media_buyer"]);
 const client={async rpc(name:string,args?:{p_patch?:unknown}){
  try{
   let result;
   if(name==="cockpit_ceo_people_list")result=await db.query<any>("select cockpit_ceo_people_list() as result");
   else if(name==="cockpit_ceo_people_save")result=await db.query<any>("select cockpit_ceo_people_save($1::jsonb) as result",[JSON.stringify(args?.p_patch)]);
   else throw Error("Unexpected RPC "+name);
   return {data:result.rows[0].result,error:null};
  }catch(error){return {data:null,error};}
 }} as unknown as SupabaseClient;
 await actor(db,F);
 return {db,client};
}
test("both verified founders save/read real roster with zero, missing costs, pauses and bot totals",async()=>{
 const {db,client}=await fixture();try{
  await savePerson(client,{name:"Paid",monthlyCost:100,currency:"KWD",isSales:true,role:"Custom role"});
  await savePerson(client,{name:"Zero",monthlyCost:0});
  await savePerson(client,{name:"Unknown",monthlyCost:null});
  await savePerson(client,{name:"Paused",monthlyCost:50,pausedOn:"2026-09-20",pausedWhy:"Human note"});
  await actor(db,F2);await savePerson(client,{name:"Mailbox",engagement:"bot",monthlyCost:500,isSales:true,pausedOn:"2026-09-20"});
  const roster=await readPeople(client);
  expect(roster.ready).toBe(true);expect(roster.activeCount).toBe(3);expect(roster.activeMonthlyUsd).toBe(326);
  expect(roster.salesMonthlyUsd).toBe(326);expect(roster.pausedCount).toBe(1);expect(roster.pausedMonthlyUsd).toBe(50);
  expect(roster.botCount).toBe(1);expect(roster.missingCost).toEqual(["Unknown"]);
  expect(roster.people.find(p=>p.name==="Zero")?.monthlyUsd).toBe(0);
  expect(roster.people.find(p=>p.name==="Mailbox")?.monthlyCost).toBeNull();
  expect(await readPeopleRoles(client)).toContain("Custom role");
  expect(await readPeopleRoles(client)).toContain("Systems manager");
 }finally{await db.close();}
});
test("partial edits preserve human data, schedules and original provenance; explicit null clears",async()=>{
 const {db,client}=await fixture();try{
  const hours=defaultSchedule();const {id}=await savePerson(client,{name:"Original",note:"Human note",monthlyCost:100,
   email:"person@tests.invalid",commissionBasis:"closed_cash",commissionRate:0.1,schedule:hours});
  await owner(db);await db.query("update cockpit_people set source='workspace',added_by='original-import',commission_pct=0.12 where id=$1",[id]);
  await actor(db,F);await savePerson(client,{id,role:"Lead"});
  let p=(await readPeople(client)).people[0];
  expect(p.note).toBe("Human note");expect(p.monthlyCost).toBe(100);expect(p.email).toBe("person@tests.invalid");
  expect(p.commission.rate).toBe(0.1);expect(p.schedule).toEqual(hours);expect(p.source).toBe("workspace");
  expect(p.commissionPct).toBe(0.12); // An unrelated edit must not normalize away a human value.
  await savePerson(client,{id,note:null,monthlyCost:0,commissionRate:0,schedule:null});
  p=(await readPeople(client)).people[0];expect(p.note).toBeNull();expect(p.monthlyCost).toBe(0);
  expect(p.commission.rate).toBe(0);expect(p.commissionPct).toBe(0);expect(p.schedule).toBeNull();
  await owner(db);expect((await db.query<any>("select added_by from cockpit_people")).rows[0].added_by).toBe("original-import");
 }finally{await db.close();}
});
test("deactivation and reactivation preserve payroll history and never modify login seats",async()=>{
 const {db,client}=await fixture();try{
  const {id}=await savePerson(client,{name:"History",startedOn:"2026-01-01",monthlyCost:300});
  await owner(db);
  await db.query("insert into cockpit_payroll_months(person,month,cost,entered_by,person_id,note) values('History','2026-09-01',275,'human',$1,'Historical value')",[id]);
  const seats=(await db.query<any>("select to_jsonb(m) as row from cockpit_members m order by email")).rows;
  await actor(db,F);await setPersonActive(client,{id,active:false,endedOn:"2026-09-27"});
  let p=(await readPeople(client)).people[0];expect(p.active).toBe(false);expect(p.endedOn).toBe("2026-09-27");
  await setPersonActive(client,{id,active:true});p=(await readPeople(client)).people[0];expect(p.active).toBe(true);expect(p.endedOn).toBeNull();
  await owner(db);
  expect((await db.query<any>("select cost,note from cockpit_payroll_months")).rows[0]).toEqual({cost:"275.00",note:"Historical value"});
  expect((await db.query<any>("select to_jsonb(m) as row from cockpit_members m order by email")).rows).toEqual(seats);
  await db.exec("set role service_role");await expect(db.exec("delete from cockpit_people")).rejects.toThrow(/permission denied/);
 }finally{await db.close();}
});
test("ordinary admin, spoofed claims, unconfirmed and revoked founders are denied on server",async()=>{
 const {db,client}=await fixture();try{
  await actor(db,OTHER);
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({email:"aziz@maharamedia.com",role:"authenticated"})]);
  await expect(readPeople(client)).rejects.toThrow(/founder/);
  await expect(savePerson(client,{name:"Denied"})).rejects.toThrow(/founder/);
  await actor(db,F);await expect(db.exec("select * from cockpit_people")).rejects.toThrow(/permission denied/);
  await owner(db);await db.query("update auth.users set email_confirmed_at=null where id=$1",[F]);
  await actor(db,F);await expect(savePerson(client,{name:"Unconfirmed"})).rejects.toThrow(/founder/);
  await owner(db);await db.query("update cockpit_members set active=false where auth_user_id=$1",[F2]);
  await actor(db,F2);await expect(readPeople(client)).rejects.toThrow(/founder/);
  await actor(db,null);await expect(readPeople(client)).rejects.toThrow(/permission denied/);
 }finally{await db.close();}
});
test("bad values, unknown IDs, duplicate names and forged attribution roll back without false receipts",async()=>{
 const {db,client}=await fixture();try{
  const {id}=await savePerson(client,{name:"Unique",monthlyCost:100});
  await expect(savePerson(client,{name:" unique "})).rejects.toThrow(/unique|duplicate/i);
  await expect(savePerson(client,{id:99999,note:"missing"})).rejects.toThrow(/Nobody/);
  await expect(savePerson(client,{id,added_by:"spoof"})).rejects.toThrow(/Unsupported/);
  await expect(savePerson(client,{id,commissionBasis:"closed_cash",commissionRate:2})).rejects.toThrow(/commission/);
  await expect(savePerson(client,{id,startedOn:"2026-02-30"})).rejects.toThrow();
  await expect(savePerson(client,{id,monthlyCost:-1})).rejects.toThrow();
  await expect(savePerson(client,{id,monthlyCost:Infinity})).rejects.toThrow(/finite/);
  const bad=defaultSchedule();bad.week.mon.end="09:00";
  await expect(db.query("select cockpit_ceo_people_save($1::jsonb)",[JSON.stringify({id,schedule:bad})])).rejects.toThrow(/end after/);
  expect((await readPeople(client)).people[0].monthlyCost).toBe(100);
  await owner(db);
  const audit=(await db.query<any>("select * from cockpit_audit_log where entity_type='cockpit_people'")).rows;
  expect(audit).toHaveLength(1);expect(audit[0].actor_email).toBe("aziz@maharamedia.com");
  await expect(db.exec("update cockpit_audit_log set action='changed'")).rejects.toThrow();
 }finally{await db.close();}
});
test("audit failure rolls back pay update; malformed receipts never succeed",async()=>{
 const {db,client}=await fixture();try{
  const {id}=await savePerson(client,{name:"Pay",monthlyCost:100});
  await owner(db);await db.exec(`create function reject_audit() returns trigger language plpgsql as $$begin raise exception 'Audit unavailable';end$$;
   create trigger reject_audit before insert on cockpit_audit_log for each row execute function reject_audit();`);
  await actor(db,F);await expect(savePerson(client,{id,monthlyCost:900})).rejects.toThrow(/Audit unavailable/);
  expect((await readPeople(client)).people[0].monthlyCost).toBe(100);
  const fake={rpc:async()=>({data:{ok:true},error:null})} as unknown as SupabaseClient;
  await expect(savePerson(fake,{name:"No receipt"})).rejects.toThrow(/not confirmed/);
  await expect(readPeople(fake)).rejects.toThrow(/not confirmed/);
 }finally{await db.close();}
});
