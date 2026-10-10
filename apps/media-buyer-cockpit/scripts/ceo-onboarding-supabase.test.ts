import {expect,test} from "bun:test";
import {actor,cockpitTestDb,member,migration,owner} from "./lib/cockpitTestDb";
import {parseSubmission} from "../../../supabase/functions/team-onboarding-intake/parse";

const F="00000000-0000-4000-8000-000000000001", OTHER="00000000-0000-4000-8000-000000000003";

async function fixture(){
 const db=await cockpitTestDb();
 const core=migration("20260919_cockpit_core.sql");
 const payroll=core.match(/create table if not exists public\.cockpit_payroll_months \([\s\S]*?\n\);/i);
 const touch=core.match(/create or replace function public\.cockpit_touch_updated_at\(\)[\s\S]*?end \$\$;/i);
 await db.exec(payroll![0]);await db.exec(touch![0]);
 for(const file of ["20260919b_people.sql","20260920a_people_commission.sql","20260921b_people_schedule.sql","20260922c_people_paused.sql","20260922d_people_bot_engagement.sql","20260927c_cockpit_people_access.sql"])
  await db.exec(migration(file));
 const people=migration("20260922e_goals_and_people.sql").match(/create table if not exists public\.cockpit_person_profiles \([\s\S]*?\n\);/i);
 expect(people).not.toBeNull();
 await db.exec(people![0]);
 await db.exec("alter table public.cockpit_person_profiles enable row level security; revoke all on public.cockpit_person_profiles from anon, authenticated;");
 await db.exec(migration("20261009o_cockpit_team_onboarding.sql"));
 await member(db,F,"aziz@maharamedia.com",[]);
 await member(db,OTHER,"other@tests.invalid",["admin","ceo","media_buyer"]);
 await owner(db);
 const ids=(await db.query<{id:number;name:string}>(
  "insert into cockpit_people(name,email,role,added_by) values ('Nada Test','nada@maharamedia.com','Media buyer','t'),('Kept Goals','kept@maharamedia.com','Video editor','t'),('No Email',null,'Video editor','t') returning id,name")).rows;
 const id=(n:string)=>Number(ids.find(r=>r.name===n)!.id);
 return {db,id};
}

function submission(token:string,email:string,name:string,goals:Record<string,string>={money12m:"1,500 KWD a month",career3y:"Head of media buying"}){
 const answers=[
  {type:"text",text:name,field:{id:"f1",type:"short_text",ref:"full_name"}},
  {type:"email",email,field:{id:"f2",type:"email",ref:"work_email"}},
  ...Object.entries({goal_money_12m:goals.money12m,goal_career_3y:goals.career3y}).filter(([,v])=>v)
   .map(([ref,text],i)=>({type:"text",text,field:{id:`g${i}`,type:"short_text",ref}})),
 ];
 return parseSubmission({event_type:"form_response",form_response:{form_id:"Cef2QGBh",token,submitted_at:"2026-10-10T07:30:00Z",
  variables:[{key:"score",type:"number",number:12}],
  definition:{id:"Cef2QGBh",fields:[{id:"f1",ref:"full_name",type:"short_text",title:"Name"},{id:"f2",ref:"work_email",type:"email",title:"Email"},
   {id:"g0",ref:"goal_money_12m",type:"short_text",title:"Money"},{id:"g1",ref:"goal_career_3y",type:"long_text",title:"Career"}]},
  answers}});
}

async function record(db:any,s:unknown){
 await owner(db);await db.exec("SET ROLE service_role");
 const r=(await db.query("select cockpit_team_onboarding_record($1::jsonb) as r",[JSON.stringify(s)])).rows[0].r;
 await owner(db);return r;
}
async function ceo(db:any,action:string,args:Record<string,unknown>){
 await actor(db,F);
 const r=(await db.query("select cockpit_ceo_onboarding($1,$2::jsonb) as r",[action,JSON.stringify(args)])).rows[0].r;
 await owner(db);return r;
}
const profile=async(db:any,personId:number)=>
 (await db.query("select personal_goals,professional_goals,updated_by from cockpit_person_profiles where person_id=$1",[personId])).rows[0];

test("a submission finds its person by email and fills only the empty goal boxes, once",async()=>{
 const {db,id}=await fixture();try{
  const nada=id("Nada Test"),kept=id("Kept Goals");
  await db.query("insert into cockpit_person_profiles(person_id,personal_goals,updated_by) values($1,'Written by Aziz','aziz')",[kept]);
  const a=await record(db,submission("t1","Nada@MaharaMedia.com","Nada Test"));
  expect(a.person_id).toBe(nada);expect(a.matched_by).toBe("email");expect(a.duplicate).toBe(false);expect(a.goals.changed).toBe(true);
  const p=await profile(db,nada);
  expect(p.personal_goals).toContain("Earning in 12 months: 1,500 KWD a month");
  expect(p.professional_goals).toContain("In 3 years: Head of media buying");
  expect(p.updated_by).toBe("onboarding form");
  // A redelivery of the same submission is one row and never rewrites the file.
  await db.query("update cockpit_person_profiles set personal_goals='Aziz rewrote this' where person_id=$1",[nada]);
  const again=await record(db,submission("t1","nada@maharamedia.com","Nada Test"));
  expect(again.duplicate).toBe(true);expect(again.goals.changed).toBe(false);
  expect((await profile(db,nada)).personal_goals).toBe("Aziz rewrote this");
  expect(Number((await db.query("select count(*) n from cockpit_team_onboarding")).rows[0].n)).toBe(1);
  // What Aziz wrote is never overwritten; the empty box still fills.
  await record(db,submission("t2","kept@maharamedia.com","Kept Goals"));
  const k=await profile(db,kept);
  expect(k.personal_goals).toBe("Written by Aziz");expect(k.professional_goals).toContain("Head of media buying");
  const audit=(await db.query("select action from cockpit_audit_log order by created_at")).rows.map((r:any)=>r.action);
  expect(audit).toContain("onboarding.received");expect(audit).toContain("onboarding.redelivered");expect(audit).toContain("onboarding.goals");
 }finally{await db.close();}
});

test("an unmatched form waits until Aziz links it, and Copy into Who they are appends once",async()=>{
 const {db,id}=await fixture();try{
  const noEmail=id("No Email"),nada=id("Nada Test");
  const s=await record(db,submission("t3","stranger@gmail.com","Someone Else"));
  expect(s.person_id).toBeNull();expect(s.matched_by).toBeNull();
  let page=await ceo(db,"person",{personId:noEmail});
  expect(page.forms).toEqual([]);expect(page.unmatched.map((u:any)=>u.fullName)).toEqual(["Someone Else"]);
  expect(page.state.lastOkAt).not.toBeNull();
  await ceo(db,"link",{id:s.id,personId:noEmail});
  page=await ceo(db,"person",{personId:noEmail});
  expect(page.forms.map((f:any)=>f.matched_by)).toEqual(["manual"]);expect(page.forms[0].raw).toBeUndefined();expect(page.unmatched).toEqual([]);
  expect((await profile(db,noEmail)).professional_goals).toContain("Head of media buying");
  // A redelivery keeps the hand-made link.
  const again=await record(db,submission("t3","stranger@gmail.com","Someone Else"));
  expect(again.person_id).toBe(noEmail);expect(again.matched_by).toBe("manual");
  // Copy appends below what Aziz wrote, and a second click changes nothing.
  await db.query("update cockpit_person_profiles set personal_goals='Aziz notes' where person_id=$1",[noEmail]);
  const c1=await ceo(db,"copyGoals",{id:s.id});expect(c1.goals.changed).toBe(true);
  const after=(await profile(db,noEmail)).personal_goals;
  expect(after.startsWith("Aziz notes\n\nFrom the onboarding form")).toBe(true);
  const c2=await ceo(db,"copyGoals",{id:s.id});expect(c2.goals.changed).toBe(false);
  expect((await profile(db,noEmail)).personal_goals).toBe(after);
  // A form found by email but never linked is linked by the copy.
  await owner(db);await db.query("update cockpit_people set email=null where id=$1",[nada]);
  const n=await record(db,submission("t4","nada@maharamedia.com","Nada Typo"));
  expect(n.person_id).toBeNull();
  await owner(db);await db.query("update cockpit_people set email='nada@maharamedia.com' where id=$1",[nada]);
  page=await ceo(db,"person",{personId:nada});expect(page.forms.map((f:any)=>f.id)).toEqual([n.id]);
  await ceo(db,"copyGoals",{id:n.id,personId:nada});
  expect((await db.query("select person_id from cockpit_team_onboarding where id=$1",[n.id])).rows[0].person_id).toBe(nada);
 }finally{await db.close();}
});

test("only the CEO reads forms, browsers never touch the tables, only the intake records",async()=>{
 const {db,id}=await fixture();try{
  await record(db,submission("t5","nada@maharamedia.com","Nada Test"));
  await actor(db,OTHER);
  await expect(db.query("select cockpit_ceo_onboarding('person',$1::jsonb)",[JSON.stringify({personId:id("Nada Test")})])).rejects.toThrow("Founder access required");
  await expect(db.query("select * from cockpit_team_onboarding")).rejects.toThrow();
  await expect(db.query("select cockpit_team_onboarding_record('{}'::jsonb)")).rejects.toThrow();
  await actor(db,F);
  await expect(db.query("select * from cockpit_team_onboarding")).rejects.toThrow();
  await expect(db.query("select cockpit_team_onboarding_record('{}'::jsonb)")).rejects.toThrow();
  await actor(db,null);
  await expect(db.query("select cockpit_ceo_onboarding('person','{}'::jsonb)")).rejects.toThrow();
  await owner(db);await db.exec("SET ROLE service_role");
  await expect(db.query("select cockpit_team_onboarding_record('{}'::jsonb)")).rejects.toThrow("Invalid onboarding submission");
  await expect(db.query("select cockpit_ceo_onboarding('person','{}'::jsonb)")).rejects.toThrow();
  await db.query("select cockpit_team_onboarding_failed('test failure')");
  await owner(db);
  const st=(await db.query("select failed_count,last_error from cockpit_team_onboarding_state")).rows[0];
  expect(st.failed_count).toBe(1);expect(st.last_error).toBe("test failure");
 }finally{await db.close();}
});
