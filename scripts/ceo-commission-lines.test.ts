// A074: two commission lines per person (supabase/migrations/20261011d_ceo_commission_two_lines.sql).
// The CEO's setter rule, 2026-09-27: "$500 base $10 per showed qualfiwedd appointment $50 per closed deal".
import {afterAll,beforeAll,expect,test} from 'bun:test';
import type {PGlite} from '@electric-sql/pglite';
import {actor,cockpitTestDb,member,migration,owner} from '../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';

const CEO='00000000-0000-4000-8000-0000000000a1',OTHER='00000000-0000-4000-8000-0000000000a2';
let db:PGlite;

async function save(patch:Record<string,unknown>){return (await db.query<{r:any}>('select cockpit_ceo_people_save($1::jsonb) r',[JSON.stringify(patch)])).rows[0].r;}
async function setPay(patch:Record<string,unknown>){return (await db.query<{r:any}>('select cockpit_ceo_people_set_pay($1::jsonb) r',[JSON.stringify(patch)])).rows[0].r;}
async function list(){return (await db.query<{r:any[]}>('select cockpit_ceo_people_list() r')).rows[0].r;}
// 20261018a: the two client bases join both CHECK constraints (PAY-PLANS.md decision 2). Only that block, so this suite needs no hours tables.
function clientBases(){
 const hit=migration('20261018a_ceo_pay_plans.sql').match(/ALTER TABLE public\.cockpit_people DROP CONSTRAINT IF EXISTS cockpit_people_commission_basis_check;[\s\S]*?cockpit_people_commission2_basis_check CHECK[\s\S]*?\]::text\[\]\)\);/);
 if(!hit)throw Error('Missing the client bases block');return hit[0];
}

beforeAll(async()=>{
 db=await cockpitTestDb();
 const core=migration('20260919_cockpit_core.sql');
 for(const pattern of [/create table if not exists public\.cockpit_payroll_months \([\s\S]*?\n\);/i,/create or replace function public\.cockpit_touch_updated_at\(\)[\s\S]*?end \$\$;/i]){
  const hit=core.match(pattern);if(!hit)throw Error('Missing canonical fixture');await db.exec(hit[0]);
 }
 for(const file of ['20260919b_people.sql','20260920a_people_commission.sql','20260921b_people_schedule.sql','20260922c_people_paused.sql',
  '20260922d_people_bot_engagement.sql','20260927c_cockpit_people_access.sql','20260922e_goals_and_people.sql','20260921d_cockpit_metrics.sql',
  '20260926l_cockpit_ceo_goals_access.sql','20260921c_bank_statements.sql','20261002a_cost_lines.sql','20261004b_cockpit_ceo_costs_goals.sql'])await db.exec(migration(file));
 await member(db,CEO,'aziz@maharamedia.com',[]);await member(db,OTHER,'admin@tests.invalid',['admin','ceo']);
 // A person saved before the migration keeps one line and gets an empty second one.
 await actor(db,CEO);await save({name:'Setter before',monthlyCost:600,commissionBasis:'closed_cash',commissionRate:0.05});
 await owner(db);await db.exec(migration('20261011d_ceo_commission_two_lines.sql'));
},30000);
afterAll(async()=>{await db.close();});

test('an existing person keeps line 1 and gets an empty line 2',async()=>{
 await actor(db,CEO);const p=(await list()).find((r:any)=>r.name==='Setter before');
 expect(p).toMatchObject({commission_basis:'closed_cash',commission2_basis:'none',commission2_rate:null});
 expect(Number(p.commission_rate)).toBe(0.05);
});

test("the setter's rule saves as base plus two lines, and the audit row carries both lines",async()=>{
 await actor(db,CEO);const before=(await list()).find((r:any)=>r.name==='Setter before');
 await save({id:before.id,monthlyCost:500,commissionBasis:'per_qualified_intro_shown',commissionRate:10,commission2Basis:'per_closed_deal',commission2Rate:50});
 const p=(await list()).find((r:any)=>r.id===before.id);
 expect(p).toMatchObject({commission_basis:'per_qualified_intro_shown',commission2_basis:'per_closed_deal',commission_pct:null});
 expect([Number(p.monthly_cost),Number(p.commission_rate),Number(p.commission2_rate)]).toEqual([500,10,50]);
 await owner(db);
 const audit=(await db.query<{after:any;before:any;actor_email:string}>("select after,before,actor_email from cockpit_audit_log where entity_type='cockpit_people' and entity_id=$1 and action='people.edit' order by created_at desc limit 1",[String(before.id)])).rows[0];
 expect(audit.actor_email).toBe('aziz@maharamedia.com');
 expect(audit.after).toMatchObject({commission2_basis:'per_closed_deal',commission_basis:'per_qualified_intro_shown'});
 expect(audit.before).toMatchObject({commission_basis:'closed_cash',commission2_basis:'none'});
});

test('set_pay keeps the line-2 rate when only the basis changes; the roster editor clears it',async()=>{
 await actor(db,CEO);const {id}=await save({name:'Two lines',commission2Basis:'per_demo_shown',commission2Rate:20});
 await setPay({id,commission2Basis:'per_signed'});
 let p=(await list()).find((r:any)=>r.id===id);expect(p.commission2_basis).toBe('per_signed');expect(Number(p.commission2_rate)).toBe(20);
 await save({id,commission2Basis:'per_intro_shown'});
 p=(await list()).find((r:any)=>r.id===id);expect(p.commission2_rate).toBeNull();
 await save({id,commission2Basis:null});
 p=(await list()).find((r:any)=>r.id===id);expect(p.commission2_basis).toBe('none');expect(p.commission2_rate).toBeNull();
});

test('line 2 is validated like line 1',async()=>{
 await actor(db,CEO);const {id}=await save({name:'Checks',commissionBasis:'closed_cash',commissionRate:0.1});
 await expect(save({id,commission2Basis:'set_cash',commission2Rate:1.5})).rejects.toThrow(/second line/);
 await expect(save({id,commission2Basis:'closed_cash',commission2Rate:0.05})).rejects.toThrow(/different basis/);
 await expect(save({id,commission2Basis:'per_closed_deal',commission2Rate:-1})).rejects.toThrow(/permitted range/);
 await expect(save({id,commission2Basis:'per_closed_deal',commission2Rate:'50'})).rejects.toThrow(/numeric/);
 await expect(save({id,commission2Basis:'per_lunch'})).rejects.toThrow();
 await expect(save({id,commissionBasis:'per_lunch'})).rejects.toThrow();
 await save({id,commission2Basis:'other',commission2Rate:5});
 expect((await list()).find((r:any)=>r.id===id).commission2_rate).toBeNull();
});

test('only the CEO saves; anon cannot run the functions',async()=>{
 await actor(db,OTHER);await expect(save({name:'Nope',commission2Basis:'per_closed_deal',commission2Rate:50})).rejects.toThrow(/founder/);
 await expect(setPay({id:1,commission2Basis:'per_closed_deal'})).rejects.toThrow(/founder/);
 await actor(db,null);await expect(save({name:'Nope'})).rejects.toThrow(/permission denied/);
 await owner(db);
 const acl=(await db.query<{a:string}>("select array_to_string(proacl,',') a from pg_proc where proname='cockpit_ceo_people_save'")).rows[0].a;
 expect(acl).toContain('authenticated=X');expect(acl).not.toContain('anon=');expect(acl).not.toContain('service_role=');
});

test('the migration runs twice without error',async()=>{
 await owner(db);await db.exec(migration('20261011d_ceo_commission_two_lines.sql'));
 const cols=(await db.query<{c:string}>("select column_name c from information_schema.columns where table_name='cockpit_people' and column_name like 'commission2%' order by 1")).rows.map(r=>r.c);
 expect(cols).toEqual(['commission2_basis','commission2_rate']);
});

// Last: re-running 20261011d (above) narrows the constraint again, which a row on a client basis would fail.
test('the two client bases save on either line once 20261018a is applied, per unit and validated like the rest',async()=>{
 await actor(db,CEO);const {id}=await save({name:'Agent line'});
 await expect(save({id,commissionBasis:'per_client_appt_shown',commissionRate:5})).rejects.toThrow(/check constraint/);
 await expect(save({id,commission2Basis:'per_client_deal_closed',commission2Rate:20})).rejects.toThrow(/check constraint/);
 await owner(db);await db.exec(clientBases());await db.exec(clientBases());
 await actor(db,CEO);
 await save({id,commissionBasis:'per_client_appt_shown',commissionRate:5,commission2Basis:'per_client_deal_closed',commission2Rate:20});
 let p=(await list()).find((r:any)=>r.id===id);
 expect(p).toMatchObject({commission_basis:'per_client_appt_shown',commission2_basis:'per_client_deal_closed',commission_pct:null});
 expect([Number(p.commission_rate),Number(p.commission2_rate)]).toEqual([5,20]);
 // Either line, either order; a per-unit rate is an amount, so above 1 is fine.
 await save({id,commissionBasis:'per_client_deal_closed',commissionRate:20,commission2Basis:'per_client_appt_shown',commission2Rate:5});
 p=(await list()).find((r:any)=>r.id===id);
 expect([p.commission_basis,Number(p.commission_rate),p.commission2_basis,Number(p.commission2_rate)]).toEqual(['per_client_deal_closed',20,'per_client_appt_shown',5]);
 await expect(save({id,commission2Basis:'per_client_deal_closed',commission2Rate:20})).rejects.toThrow(/different basis/);
 await expect(save({id,commission2Basis:'per_client_appt_shown',commission2Rate:-5})).rejects.toThrow(/permitted range/);
 await setPay({id,commission2Basis:'per_client_appt_shown'});
 expect(Number((await list()).find((r:any)=>r.id===id).commission2_rate)).toBe(5);
 await expect(save({id,commissionBasis:'per_client_lunch'})).rejects.toThrow(/check constraint/);
 const defs=(await db.query<{d:string}>("select pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.cockpit_people'::regclass and conname in ('cockpit_people_commission_basis_check','cockpit_people_commission2_basis_check')")).rows;
 expect(defs).toHaveLength(2);
 for(const {d} of defs)for(const b of ['per_qualified_intro_shown','per_closed_deal','per_client_appt_shown','per_client_deal_closed'])expect(d).toContain(b);
});
