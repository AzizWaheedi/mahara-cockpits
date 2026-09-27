import {financeSources} from '../../../supabase/functions/cockpit-ceo-api/finance/tools';
import {financeContext} from '../../../supabase/functions/cockpit-ceo-api/finance/context';
import {payerSources} from '../../../supabase/functions/cockpit-ceo-api/tools';
import {expect,test} from 'bun:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {actor,cockpitTestDb,member,migration,owner} from './lib/cockpitTestDb';
import {prepareBank,bankResult,payerList} from '../../../supabase/functions/cockpit-ceo-api/core';
import {ceoAction} from '../src/lib/ceoActionsClient';
const F='00000000-0000-4000-8000-000000000001', O='00000000-0000-4000-8000-000000000002';
async function fixture(){
 const db=await cockpitTestDb();
 await db.exec("CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint); CREATE TABLE storage.objects(bucket_id text,name text,metadata jsonb); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY; GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT,INSERT ON storage.objects TO authenticated;");
 const core=migration('20260919_cockpit_core.sql');
 for(const name of ['cockpit_client_billing_days','cockpit_metric_days','cockpit_payer_clients']){
  const ddl=core.match(new RegExp('create table if not exists public\\.'+name+' \\([\\s\\S]*?\\n\\);','i'));expect(ddl).not.toBeNull();await db.exec(ddl![0]);
 }
 const state=migration('20260927d_cockpit_manual_payments_access.sql').match(/CREATE TABLE IF NOT EXISTS public\.cockpit_manual_payment_state\([\s\S]*?\n\);/);expect(state).not.toBeNull();await db.exec(state![0]);await db.exec('INSERT INTO cockpit_manual_payment_state(id,history_ready) VALUES(true,true)');
 const manualDdl=migration('20260927d_cockpit_manual_payments_access.sql').match(/CREATE TABLE IF NOT EXISTS public\.cockpit_manual_payments\([\s\S]*?\n\);/);expect(manualDdl).not.toBeNull();await db.exec(manualDdl![0]);
 const ddl=migration('20260919b_people.sql').match(/create table if not exists public\.cockpit_people \([\s\S]*?\n\);/i);expect(ddl).not.toBeNull();await db.exec(ddl![0]);
 for(const f of ['20260921c_bank_statements.sql','20260921d_cockpit_metrics.sql','20260921a_cockpit_settings.sql','20260921f_cockpit_feedback.sql','20260922e_goals_and_people.sql','20260927h_cockpit_ceo_actions.sql','20260927i_cockpit_finance_refresh.sql'])await db.exec(migration(f));
 await db.exec('UPDATE cockpit_team_status_state SET history_ready=true');
 await member(db,F,'aziz@maharamedia.com',[]);await member(db,O,'other@tests.invalid',['admin','ceo']);
 await db.exec("INSERT INTO cockpit_people(name,role,monthly_cost,added_by) VALUES('Tester','Media Buyer',100,'fixture')");
 const client={async rpc(_name:string,args:any){try{return {data:(await db.query<any>('SELECT cockpit_ceo_action($1,$2::jsonb) AS result',[args.p_action,JSON.stringify(args.p_args)])).rows[0].result,error:null};}catch(error){return {data:null,error};}}} as unknown as SupabaseClient;
 await actor(db,F);return {db,client};
}
test('founder gate and raw reads',async()=>{const {db,client}=await fixture();try{
 await actor(db,O);for(const action of ['settings.get','feedback.list','profiles.page','profiles.templates'])await expect(ceoAction(client,action,{personId:1})).rejects.toThrow('Founder');
 await expect(db.query('SELECT * FROM cockpit_person_profiles')).rejects.toThrow();await actor(db,null);await expect(ceoAction(client,'feedback.list')).rejects.toThrow();
 }finally{await db.close();}});
test('hours save, invalid input, immutable audit',async()=>{const {db,client}=await fixture();try{
 expect((await ceoAction(client,'settings.get')).hours.source).toBe('default');
 await ceoAction(client,'settings.setWorkingHours',{start:'09:00',end:'17:30',days:[1,2],timezone:'Asia/Kuwait'});
 expect((await ceoAction(client,'settings.get')).hours.start).toBe('09:00');
 await expect(db.query("SELECT cockpit_ceo_action('settings.setWorkingHours',$1)",[JSON.stringify({start:'09:00',end:'08:00',days:[1]})])).rejects.toThrow();
 await owner(db);expect((await db.query('SELECT * FROM cockpit_audit_log')).rows.length).toBe(1);await expect(db.query('DELETE FROM cockpit_audit_log')).rejects.toThrow('immutable');
 }finally{await db.close();}});
test('feedback dispatch and status preserve human note',async()=>{const {db,client}=await fixture();try{
 expect((await ceoAction(client,'feedback.add',{kind:'bug',text:'Test problem'})).id).toBe(1);
 await owner(db);await db.exec("UPDATE cockpit_feedback SET note='human note' WHERE id=1");await actor(db,F);
 expect((await ceoAction(client,'feedback.dispatch')).dispatched).toBe(1);expect((await ceoAction(client,'feedback.dispatch')).dispatched).toBe(0);
 await ceoAction(client,'feedback.setStatus',{id:1,status:'done'});expect((await ceoAction(client,'feedback.list')).closed[0].note).toBe('human note');
 await expect(ceoAction(client,'feedback.setStatus',{id:99,status:'done'})).rejects.toThrow('no longer exists');
 }finally{await db.close();}});
test('profile partial edits, scorecard history and new month copy',async()=>{const {db,client}=await fixture();try{
 await ceoAction(client,'profiles.saveProfile',{personId:1,notes:'Human notes',skill:8});await ceoAction(client,'profiles.saveProfile',{personId:1,personalGoals:'Learn'});
 let page=await ceoAction(client,'profiles.page',{personId:1,month:'2026-09'});expect(page.profile.notes).toBe('Human notes');expect(page.profile.skill).toBe(8);expect(page.scorecard).toBeNull();
 await expect(ceoAction(client,'profiles.saveProfile',{personId:1,skill:11})).rejects.toThrow();
 await ceoAction(client,'profiles.saveTemplate',{roleKey:'Media Buyer',title:'Buyer',mission:'Grow',items:[{key:'quality'}],competencies:['Care']});
 page=await ceoAction(client,'profiles.page',{personId:1,month:'2026-09'});expect(page.scorecard.fresh).toBe(true);expect(page.scorecard.roleKey).toBe('media-buyer');
 expect((await ceoAction(client,'profiles.saveScorecard',{personId:1,month:'2026-09',roleKey:'media-buyer',title:'Buyer',mission:'Grow',items:[{key:'quality',grade:'A',comment:'Human review'}],overall:'A',summary:'Good',status:'final'})).id).toBe(1);
 await ceoAction(client,'profiles.saveTemplate',{roleKey:'Media Buyer',title:'New',mission:'Different',items:[],competencies:[]});
 page=await ceoAction(client,'profiles.page',{personId:1,month:'2026-09'});expect(page.scorecard.items[0].comment).toBe('Human review');expect(page.scorecard.fresh).toBe(false);
 const next=await ceoAction(client,'profiles.page',{personId:1,month:'2026-10'});expect(next.scorecard.startedFrom).toBe('2026-09');expect(next.scorecard.items[0].grade).toBeNull();expect(next.scorecard.items[0].comment).toBe('');
 await owner(db);expect((await db.query('SELECT * FROM cockpit_audit_log')).rows.length).toBe(5);
 }finally{await db.close();}});


test('file reservations restrict uploads and retain removed bytes',async()=>{const {db,client}=await fixture();try{
 const f=await ceoAction(client,'profiles.reserveFile',{personId:1,kind:'cv',name:'CV.pdf',sizeBytes:3,mime:'application/pdf'});
 await expect(ceoAction(client,'profiles.confirmFile',{id:f.id})).rejects.toThrow('not confirmed');
 await expect(db.query("INSERT INTO storage.objects VALUES('cockpit-people','unreserved','{}')")).rejects.toThrow();
 await db.query("INSERT INTO storage.objects VALUES('cockpit-people',$1,'{\"size\":3}')",[f.path]);
 expect((await ceoAction(client,'profiles.page',{personId:1})).files.length).toBe(0);
 await ceoAction(client,'profiles.confirmFile',{id:f.id});expect((await ceoAction(client,'profiles.page',{personId:1})).files.length).toBe(1);
 await ceoAction(client,'profiles.removeFile',{id:f.id});await expect(ceoAction(client,'profiles.filePath',{id:f.id})).rejects.toThrow();
 expect((await db.query('SELECT * FROM storage.objects')).rows.length).toBe(0);
 await owner(db);expect((await db.query('SELECT * FROM storage.objects')).rows.length).toBe(1);expect((await db.query('SELECT * FROM cockpit_audit_log')).rows.length).toBe(3);
 }finally{await db.close();}});

test('staffing state validates known person, dates and keeps audit',async()=>{const {db,client}=await fixture();try{
 await expect(ceoAction(client,'teamStatus.set',{personKey:'media_buyer:tester',status:'paused',since:'2026-09-01'})).rejects.toThrow('Management');
 await owner(db);await db.query("INSERT INTO cockpit_sections(key,label,computed_at,payload) VALUES('team','Team',now(),$1)",[JSON.stringify({people:[{key:'media_buyer:tester',name:'Tester'}]})]);await actor(db,F);
 await ceoAction(client,'teamStatus.set',{personKey:'media_buyer:tester',status:'paused',since:'2026-09-01',note:'Keep this'});
 await ceoAction(client,'teamStatus.set',{personKey:'media_buyer:tester',status:'active',since:'2026-09-02'});
 expect((await ceoAction(client,'teamStatus.list'))[0].note).toBe('Keep this');expect((await ceoAction(client,'teamStatus.history',{personKey:'media_buyer:tester'})).length).toBe(2);
 await expect(ceoAction(client,'teamStatus.set',{personKey:'media_buyer:tester',status:'active',since:'2099-01-01'})).rejects.toThrow('start date');
 }finally{await db.close();}});

test('bank imports add once, use stored FX and preserve manual classifications',async()=>{const {db,client}=await fixture();try{
 const text=`CBK Online,,,,
Account  0011223344,,,,
Type  Current Account,,,,
Currency  KWD,,,,
,,,,
Date,Amount,Balance,Reference,TRSH_NUMBER
02/06/2026,150,5000,TRF FROM DECOR PLUS CO,1
03/06/2026,-10,4990,OPENAI SOFTWARE,2
`;
 const plan=prepareBank('test.csv',text);
 const saved=await ceoAction(client,'bankImport.commit',plan.body);expect(saved.kept).toBe(2);expect(bankResult(plan,saved).byKind.find((x:any)=>x.kind==='client_payment')?.usd).toBe(489);
 expect((await ceoAction(client,'bankImport.commit',plan.body)).kept).toBe(0);
 const ex=await ceoAction(client,'bankImport.addExclusion',{kind:'vendor',pattern:'OPENAI',note:'personal'});expect(ex.changed).toBe(1);
 const expense=saved.inserted.find((r:any)=>r.amount<0);
 await ceoAction(client,'bankImport.reclassify',{id:expense.id,kind:'expense',note:'Human review'});
 expect((await ceoAction(client,'bankImport.removeExclusion',{id:ex.id})).changed).toBe(0);
 await ceoAction(client,'bankImport.commit',plan.body);
 await owner(db);const row=(await db.query<any>('SELECT * FROM cockpit_bank_lines WHERE id=$1',[expense.id])).rows[0];expect(row.note).toBe('Human review');expect(row.kind).toBe('expense');expect(row.manual_kind).toBe(true);
 await actor(db,F);const overview=await ceoAction(client,'bankImport.overview');expect(overview.statements.length).toBe(1);expect(overview.exclusions.length).toBe(0);
 }finally{await db.close();}});

test('staffing history gate, masked notes and repeated schema preserve records',async()=>{const {db,client}=await fixture();try{
 await owner(db);await db.exec("UPDATE cockpit_team_status_state SET history_ready=false");await actor(db,F);await expect(ceoAction(client,'teamStatus.list')).rejects.toThrow('reconciled');
 await owner(db);await db.query("INSERT INTO cockpit_team_status(person_key,status,since,note,set_by) VALUES('media_buyer:tester','paused','2026-09-01',$1,'source')",['Original user@example.com \u2014 +96512345678']);await db.exec("UPDATE cockpit_team_status_state SET history_ready=true");
 await db.exec(migration('20260927h_cockpit_ceo_actions.sql'));await actor(db,F);
 const r=(await ceoAction(client,'teamStatus.list'))[0];expect(r.note).toBe('Original [email], [number]');await ceoAction(client,'teamStatus.set',{personKey:r.personKey,status:'active',since:'2026-09-01',note:r.note});
 await owner(db);expect((await db.query<any>("SELECT note FROM cockpit_team_status")).rows[0].note).toBe('Original user@example.com \u2014 +96512345678');
 }finally{await db.close();}});

test('payer mapping and bank changes invalidate finance totals; LTV requires real sources',async()=>{const {db,client}=await fixture();try{
 await expect(ceoAction(client,'payers.context')).rejects.toThrow('missing or stale');
 await owner(db);await db.exec("INSERT INTO cockpit_client_billing_days(day,clickup_task_id,client_name,stage,ltv_usd) VALUES(current_date,'task1','Client','Active',100); INSERT INTO cockpit_metric_days(day,metric,scope,value) VALUES('2026-09-01','money.ltv.card','client:task1',100)");
 await db.query("INSERT INTO cockpit_sections(key,label,computed_at,payload) VALUES('money','Money',now(),$1)",[JSON.stringify({attribution:{transactions:[{direction:'in',clientTaskId:'task1',day:'2026-09-02',usd:25}]}})]);await actor(db,F);
 expect((await ceoAction(client,'ltv.preview')).rows[0].target).toBe(125);
 await ceoAction(client,'payers.assign',{payer:'Person',clickupTaskId:'task1',note:'Human reason'});
 await expect(ceoAction(client,'ltv.preview')).rejects.toThrow('reconciliation');
 expect((await ceoAction(client,'payers.context')).mappings[0].note).toBe('Human reason');
 await ceoAction(client,'payers.assign',{payer:'Person',clickupTaskId:null});expect((await ceoAction(client,'payers.context')).mappings.length).toBe(0);
 await owner(db);expect((await db.query<any>('SELECT revision,totals_revision FROM cockpit_manual_payment_state')).rows[0]).toEqual({revision:2,totals_revision:0});expect((await db.query('SELECT * FROM cockpit_payer_clients')).rows.length).toBe(1);
 }finally{await db.close();}});
test('payer list counts voided deal money but excludes intact deals',()=>{
 const source={payments:[{payment_id:'a',billing_name:'Person',net_amount:20,paid_on:'2026-09-01',deal_response_id:'void'},{payment_id:'b',billing_name:'Person',net_amount:30,paid_on:'2026-09-02',deal_response_id:null},{payment_id:'c',billing_name:'Other',net_amount:99,paid_on:'2026-09-02',deal_response_id:'real'}],voids:[{record_id:'void'}]};
 const result=payerList(source,{cards:[{clickupTaskId:'task1',client:'Person'}],mappings:[{payer_key:'person',clickup_task_id:'task1',client_name:'Person',note:'human'}]});expect(result.totalUsd).toBe(50);expect(result.mappedUsd).toBe(50);expect(result.payers.length).toBe(1);expect(result.payers[0].payments).toBe(2);expect(result.payers[0].suggestion?.clickupTaskId).toBe('task1');
});

test('B2B payer helper is fixed-host GET-only and rejects unproven page counts',async()=>{
 const receipts:any[]=[],requests:string[]=[];
 const mock=async(input:any,init:any)=>{requests.push(String(input));expect(init.method).toBe('GET');expect(String(input).startsWith('https://flwboeijllbtrufxkhts.supabase.co/rest/v1/')).toBe(true);return new Response('[]',{headers:{'content-range':'*/0'}});};
 const out=await payerSources(k=>k==='B2B_READ_ONLY_KEY'?'fixture':undefined,async r=>{receipts.push(r)},mock as typeof fetch);expect(out).toEqual({payments:[],voids:[]});expect(requests.length).toBe(2);expect(receipts.length).toBe(4);expect(JSON.stringify(receipts).includes('fixture')).toBe(false);
 await expect(payerSources(()=>undefined,async()=>{},mock as typeof fetch)).rejects.toThrow('not configured');
 await expect(payerSources(()=> 'fixture',async()=>{},(async()=>new Response('[]')) as typeof fetch)).rejects.toThrow('row count');
});

const financeOutput={sections:[{key:'money',label:'Money',payload:{month:'2026-09',attribution:{transactions:[]},rails:{manual:{connected:true}}},sources:[{name:'Verified fixture',ok:true}],daily:[{date:'2026-09-27',metric:'money.test',scope:'company',value:3}]},{key:'expenses',label:'Expenses',payload:{month:'2026-09'},sources:[{name:'Verified fixture',ok:true}]}],payments:[]};
test('finance refresh gates history and rejects browser completion',async()=>{const {db}=await fixture();try{
 await expect(db.query('SELECT cockpit_begin_finance_refresh()')).rejects.toThrow('reconciled');
 await owner(db);await db.exec('UPDATE cockpit_finance_source_state SET aliases_ready=true,manual_ready=true');await actor(db,F);
 const job=(await db.query<any>('SELECT cockpit_begin_finance_refresh() AS job')).rows[0].job;
 expect((await db.query<any>('SELECT cockpit_begin_finance_refresh() AS job')).rows[0].job.existing).toBe(true);
 await expect(db.query('SELECT cockpit_finish_finance_refresh($1,$2)',[job.id,financeOutput])).rejects.toThrow('permission');
 await owner(db);await db.exec('SET ROLE service_role');const source=(await db.query<any>('SELECT cockpit_finance_refresh_input($1) AS source',[job.id])).rows[0].source;expect(source.revision).toBe(0);
 }finally{await db.close();}});
test('finance changes race rejects entire snapshot and keeps previous figures',async()=>{const {db}=await fixture();try{
 await owner(db);await db.exec("UPDATE cockpit_finance_source_state SET aliases_ready=true,manual_ready=true; INSERT INTO cockpit_sections(key,label,computed_at,payload) VALUES('money','Money',now(),'{\"keep\":true}'); UPDATE cockpit_manual_payment_state SET history_ready=false");await actor(db,F);
 const job=(await db.query<any>('SELECT cockpit_begin_finance_refresh() AS job')).rows[0].job;
 await owner(db);await db.exec('UPDATE cockpit_manual_payment_state SET revision=revision+1; SET ROLE service_role');
 await expect(db.query('SELECT cockpit_finish_finance_refresh($1,$2)',[job.id,financeOutput])).rejects.toThrow('changed');
 await db.query('SELECT cockpit_finish_finance_refresh($1,NULL,$2)',[job.id,'Source changed; try again']);await owner(db);
 expect((await db.query<any>("SELECT payload FROM cockpit_sections WHERE key='money'")).rows[0].payload).toEqual({keep:true});expect((await db.query<any>('SELECT history_ready,totals_revision FROM cockpit_manual_payment_state')).rows[0]).toEqual({history_ready:false,totals_revision:0});
 }finally{await db.close();}});
test('finance snapshots commit together once and reconcile exact revision',async()=>{const {db}=await fixture();try{
 await owner(db);await db.exec('UPDATE cockpit_finance_source_state SET aliases_ready=true,manual_ready=true; UPDATE cockpit_manual_payment_state SET history_ready=false,revision=7');await actor(db,F);
 const job=(await db.query<any>('SELECT cockpit_begin_finance_refresh() AS job')).rows[0].job;
 await owner(db);await db.exec('SET ROLE service_role');
 await expect(db.query('SELECT cockpit_finish_finance_refresh($1,$2)',[job.id,{sections:[financeOutput.sections[0]],payments:[]}])).rejects.toThrow('Incomplete');
 const result=(await db.query<any>('SELECT cockpit_finish_finance_refresh($1,$2) AS result',[job.id,financeOutput])).rows[0].result;expect(result.revision).toBe(7);
 expect((await db.query<any>('SELECT cockpit_finish_finance_refresh($1,$2) AS result',[job.id,financeOutput])).rows[0].result).toEqual(result);
 await owner(db);expect((await db.query('SELECT * FROM cockpit_sections')).rows.length).toBe(2);expect((await db.query<any>('SELECT revision,totals_revision,history_ready FROM cockpit_manual_payment_state')).rows[0]).toEqual({revision:7,totals_revision:7,history_ready:true});
 expect((await db.query("SELECT * FROM cockpit_audit_log WHERE action='finance.confirmed'")).rows.length).toBe(1);
 }finally{await db.close();}});
test('finance SQL wrapper only permits fixed projects with read_only and row-count proof',async()=>{
 const sent:any[]=[];const read=financeSources('fixture',async()=>{},(async(url:any,init:any)=>{sent.push({url,body:JSON.parse(init.body)});return new Response(JSON.stringify([{rows:[{value:4}],row_count:1}]));})as typeof fetch);
 expect(await read('flwboeijllbtrufxkhts','SELECT 4 AS value')).toEqual([{value:4}]);expect(sent[0].body.read_only).toBe(true);expect(sent[0].body.query).toContain('count(*) AS row_count');
 await expect(read('other','SELECT 1')).rejects.toThrow('not allowed');await expect(read('flwboeijllbtrufxkhts','DELETE FROM whop_payments')).rejects.toThrow('not allowed');expect(sent.length).toBe(1);
});
test('finance manual context preserves stored FX, exact aliases, removals and source gaps',async()=>{
 const manual={id:'one',day:'2026-09-01',amount:1,currency:'KWD',amount_usd:3.25,usd_per_unit:3.25,client_name:'Client',clickup_task_id:'card',rail:'cash',kind:'payment',deal_contracted:null,deal_contracted_usd:null,note:'x@example.com',added_at:'2026-09-01T00:00:00Z',deleted_at:null};
 const context=financeContext({billing:[{clickup_task_id:'card',client_name:'Client',captured_at:'2026-09-01',ltv_usd:100}],manual:[manual,{...manual,id:'removed',deleted_at:'2026-09-02'}],aliases:[{task_id:'card',name:'Client',aliases:['Client alias'],csm:'Staff Person'},{task_id:null,name:'Unmapped',aliases:[]}],series:[],newestManualChange:'2026-09-02'});
 const loaded=await context.runQuery('manual',{from:'2026-09-01',month:'2026-09'});expect(loaded.live[0].amountUsd).toBe(3.25);expect(loaded.live[0].note).toBe('[email]');expect(loaded.removedThisMonth.length).toBe(1);expect(loaded.cards).toEqual([{taskId:'card',names:['Client','Client alias'],csm:'Staff'}]);
 expect(()=>financeContext({billing:[]})).toThrow('empty');
});

test('imported alias changes invalidate readiness and preserve original source audit',async()=>{const {db}=await fixture();try{
 await owner(db);await db.exec("UPDATE cockpit_finance_source_state SET aliases_ready=true,manual_ready=true; INSERT INTO cockpit_finance_client_aliases(source_kind,source_id,task_id,name,source_record) VALUES('client','old-id','card','Client','{\"_id\":\"old-id\",\"name\":\"Client\"}')");
 expect((await db.query<any>('SELECT aliases_ready FROM cockpit_finance_source_state')).rows[0].aliases_ready).toBe(false);expect((await db.query<any>('SELECT revision FROM cockpit_manual_payment_state')).rows[0].revision).toBe(1);
 await db.exec("UPDATE cockpit_finance_client_aliases SET name=name");expect((await db.query<any>('SELECT revision FROM cockpit_manual_payment_state')).rows[0].revision).toBe(1);expect((await db.query<any>("SELECT after FROM cockpit_audit_log WHERE action='finance.aliasImported'")).rows[0].after.source_record._id).toBe('old-id');
 }finally{await db.close();}});
