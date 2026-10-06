import { expect, test } from 'bun:test';
import { nativePreviewDb, previewActors, actor, owner } from './lib/nativePreviewDb';
import { migration, member } from '../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';
import { adminOverviewSchema } from '../apps/media-buyer-cockpit/src/lib/nativeAdminClient';
const ADMIN='00000000-0000-4000-8000-000000000017';
async function fixture(){
 const db=await nativePreviewDb();
 const native=migration('20260927x_cockpit_native_media_sync.sql'),memberEnd=native.indexOf('ALTER TABLE public.cockpit_eod_reports');
 if(memberEnd<0)throw new Error('Canonical member presence catalog missing');await db.exec(native.slice(0,memberEnd)+'COMMIT;');
 const plan=migration('20260923p_cockpit_actions_and_rpcs.sql').match(/CREATE TABLE IF NOT EXISTS public\.cockpit_plan_items \([\s\S]*?GRANT ALL ON TABLE public\.cockpit_plan_items TO service_role;/)?.[0];
 if(!plan)throw new Error('Canonical daily plan catalog missing');await db.exec(plan);
 for(const name of ['20260927w_media_read_models.sql','20260927v_csm_read_models.sql']){
  const sql=migration(name),end=sql.indexOf('CREATE OR REPLACE FUNCTION');
  if(end<0)throw new Error('Canonical source catalog prefix missing');await db.exec(sql.slice(0,end)+'COMMIT;');
 }
 const mediaRuns=migration('20260927x_cockpit_native_media_sync.sql').match(/CREATE TABLE public\.cockpit_native_media_runs \([\s\S]*?\n\);/)?.[0];
 const salesRuns=migration('20260924a_sales_cockpit.sql').match(/create table if not exists public\.cockpit_sales_mirror_runs \([\s\S]*?\n\);/)?.[0];
 if(!mediaRuns||!salesRuns)throw new Error('Canonical producer ledger catalog missing');await db.exec(mediaRuns+salesRuns);
 await db.exec(migration('20261004z_native_monitor.sql'));await db.exec(migration('20261005e_cockpit_native_admin.sql'));
 await member(db,ADMIN,'native-admin@example.test',['admin']);return db;
}
async function overview(db:Awaited<ReturnType<typeof fixture>>){
 const data=(await db.query<{data:unknown}>('SELECT cockpit_admin_overview() data')).rows[0].data;
 return adminOverviewSchema.parse(data);
}
test('canonical admin view requires confirmed active directory identity, including founder revocation',async()=>{
 const db=await fixture();try{
  for(const id of [ADMIN,previewActors.founder]){await actor(db,id);expect((await overview(db)).members.map(m=>m.email)).toContain('native-admin@example.test');}
  for(const id of [previewActors.media,previewActors.spoof,previewActors.unconfirmed]){await actor(db,id);await expect(overview(db)).rejects.toMatchObject({code:'42501'});}
  await owner(db);await db.query('UPDATE cockpit_members SET active=false WHERE auth_user_id=$1',[previewActors.founder]);await actor(db,previewActors.founder);
  await expect(overview(db)).rejects.toMatchObject({code:'42501'});
  await owner(db);await db.query('UPDATE cockpit_members SET active=false WHERE auth_user_id=$1',[ADMIN]);await actor(db,ADMIN);await expect(overview(db)).rejects.toMatchObject({code:'42501'});
 }finally{await db.close();}
},30000);
test('missing source history and campaign status stay unavailable, never healthy or a live campaign count',async()=>{
 const db=await fixture();try{
  await actor(db,ADMIN);const value=await overview(db);
  expect(value.counts.clients).toBeNull();expect(value.clientNames).toBeNull();expect(value.clientError).toMatch(/catalog is unavailable/);
  expect(value.counts.campaigns).toBe(1);expect(value.counts.liveCampaigns).toBeNull();
  expect(value.sources.find(s=>s.source==='source:family-media')).toMatchObject({ok:false,at:null});
  expect(value.health.find(h=>h.app==='media-buyer')?.ok).toBe(false);
  expect(value.scheduled.find(j=>j.key==='worker:media-core')).toMatchObject({ok:false,at:null,ms:null});
  expect(value.alerts.find(a=>a.text.includes('Native producer media-core'))?.at).toBeNull();
 }finally{await db.close();}
},30000);
test('native member editing receives recorded sales subrole, presence and confirmation without changing human notes',async()=>{
 const db=await fixture();try{
  await owner(db);await db.query("UPDATE cockpit_members SET sales_role='manager',note='Keep original human note',last_seen_at='2026-10-04T21:30:00Z',last_cockpit='sales' WHERE auth_user_id=$1",[previewActors.media]);
  await actor(db,ADMIN);const value=await overview(db),person=value.members.find(m=>m.auth_user_id===previewActors.media);
  expect(person).toMatchObject({salesRole:'manager',note:'Keep original human note',lastSeenAt:Date.parse('2026-10-04T21:30:00Z'),lastCockpit:'sales',auth_confirmed:true});
  expect(value.members.find(m=>m.auth_user_id===previewActors.unconfirmed)?.auth_confirmed).toBe(false);
 }finally{await db.close();}
},30000);
test('real source-count conflicts, failed sales runs and stale captures are reflected without invented successes',async()=>{
 const db=await fixture();try{
  await owner(db);
  await db.exec("UPDATE cockpit_media_source_state SET ready=true,row_count=0,source_snapshot_at=now();INSERT INTO cockpit_sales_mirror_runs(ok,finished_at,error) VALUES(false,now(),'Actual mirror failure');");
  await actor(db,ADMIN);let value=await overview(db);
  expect(value.sources.find(s=>s.source==='source:family-media')?.ok).toBe(true);
  expect(value.sources.find(s=>s.source==='worker:sales-mirror')?.lastError).toBe('Actual mirror failure');
  await owner(db);await db.exec("UPDATE cockpit_media_source_state SET row_count=1 WHERE table_name='inbox'");await actor(db,ADMIN);value=await overview(db);
  expect(value.sources.find(s=>s.source==='source:family-media')?.lastError).toContain('inbox');
  await owner(db);await db.exec("UPDATE cockpit_media_source_state SET row_count=0,source_snapshot_at=now()-interval '2 hours'");await actor(db,ADMIN);value=await overview(db);
  expect(value.sources.find(s=>s.source==='source:family-media')).toMatchObject({ok:false,lastError:'Recorded data is overdue for the configured freshness limit. Run doctor and inspect the native worker.'});
 }finally{await db.close();}
},30000);
test('actual CSM receipt schema is monitored without a fabricated provider column',async()=>{
 const db=await fixture();try{
  await owner(db);await db.exec("INSERT INTO cockpit_csm_provider_health(method,resource,phase,http_status) VALUES('GET','calendar-read','response',503)");await actor(db,ADMIN);
  const value=await overview(db);
  expect(value.sources.find(s=>s.source.startsWith('source:cockpit_csm_provider_health:'))?.ok).toBe(false);
 }finally{await db.close();}
},30000);
test('native audit summaries retain actual actor and action without exposing private payloads or bearer links',async()=>{
 const db=await fixture();try{
  await owner(db);
  const inserted=(await db.query<{id:string}>("INSERT INTO cockpit_audit_log(action,entity_type,actor_email,after) VALUES('member.changed','cockpit_members','recorded-actor@example.test',$1) RETURNING id",[{private_note:'Private test payload',src:'https://facebook.com/?access_token=private-fixture'}])).rows[0];
  await actor(db,ADMIN);const value=await overview(db);
  expect(value.activity.find(entry=>entry.id===inserted.id)).toMatchObject({action:'member.changed',entity:'cockpit_members',actor:'recorded-actor@example.test'});
  const exposed=JSON.stringify(value);
  expect(exposed).not.toContain('Private test payload');expect(exposed).not.toContain('private-fixture');
 }finally{await db.close();}
},30000);
