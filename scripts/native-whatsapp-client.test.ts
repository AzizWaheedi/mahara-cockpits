import {afterEach,beforeEach,describe,expect,test} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {actor,member,migration,owner} from '../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';
import type {Row} from '../hermes/cockpit-sync/runtime';
import {nativeFeedDb} from './lib/nativeFeedDb';

// UID covers Alpha only, OTHER covers Beta only, LEAD covers every client (as every live CSM seat does today).
const UID='60000000-0000-4000-8000-000000000001',OTHER='60000000-0000-4000-8000-000000000002',LEAD='60000000-0000-4000-8000-000000000003';
let db:Awaited<ReturnType<typeof nativeFeedDb>>;
async function setup(accessFix=true){
 db=await nativeFeedDb();await db.exec(migration('20260920b_wa_inbox.sql'));await db.exec(migration('20261005g_cockpit_native_whatsapp.sql'));
 await db.exec("UPDATE cockpit_wa_connections SET location_id='mahara-location' WHERE app='client-success'");
 await db.exec(migration('20261005d_cockpit_client_calendars.sql'));
 const gate=migration('20261006c_csm_onboarding_checkins.sql').match(/CREATE FUNCTION public\.cockpit_csm_client_gate_for_actor[\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_csm_client_gate\(text\) TO authenticated;/)?.[0];
 if(!gate)throw new Error('Canonical client gate missing');await db.exec(gate);
 await db.exec(migration('20261008e_whatsapp_mirror_noop.sql'));
 // What production had before 20261012d: every privilege for anon and authenticated, and the seat policies of 20260924r.
 const seat=migration('20260924r_billing_and_comms_access.sql').match(/-- 4\. WhatsApp Threads[\s\S]*?CREATE POLICY wa_drafts_seat[\s\S]*?;\n/)?.[0];
 if(!seat)throw new Error('Canonical WhatsApp seat policies missing');
 await db.exec("CREATE OR REPLACE FUNCTION public.cockpit_has_active_seat() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT auth.uid() IS NOT NULL $$;GRANT EXECUTE ON FUNCTION public.cockpit_is_ceo() TO authenticated;");
 await db.exec(seat);await db.exec('GRANT ALL ON wa_threads,wa_messages,wa_drafts,wa_state TO anon,authenticated');
 await member(db,UID,'csm@tests.invalid',['csm']);await member(db,OTHER,'other@tests.invalid',['csm']);await member(db,LEAD,'lead@tests.invalid',['csm']);
 await db.query('UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2',[['Alpha'],UID]);await db.query('UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2',[['Beta'],OTHER]);
 await db.exec("UPDATE cockpit_csm_source_state SET ready=true,row_count=2,source_snapshot_at=now() WHERE table_name='clients'");
 await db.exec(`INSERT INTO cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) SELECT 'clients','alpha',ARRAY['Alpha'],'{"_id":"alpha","name":"Alpha","taskId":"cu-alpha"}',source_snapshot_at FROM cockpit_csm_source_state WHERE table_name='clients';
  INSERT INTO cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) SELECT 'clients','beta',ARRAY['Beta'],'{"_id":"beta","name":"Beta","taskId":"cu-beta"}',source_snapshot_at FROM cockpit_csm_source_state WHERE table_name='clients'`);
 await db.exec("INSERT INTO wa_state(location_id,scan_since,last_scan) VALUES('mahara-location','2026-09-20T00:00:00Z',now())");
 await db.exec(`INSERT INTO wa_threads(id,location_id,contact_id,contact_name,phone,desk,client_task_id,provider_id,is_group,last_at,last_inbound_at,awaiting_us) VALUES
  ('thread-one','mahara-location','contact-one','Alpha group','+861234567890','csm','cu-alpha','custom-whatsapp-provider',true,now()-interval '1 minute',now()-interval '1 minute',true),
  ('thread-two','mahara-location','contact-two','Beta owner','+96512345678','csm',NULL,'custom-whatsapp-provider',false,now()-interval '2 hours',now()-interval '2 hours',true),
  ('group-new','mahara-location','contact-group','Beta team','+120363000000','csm',NULL,'custom-whatsapp-provider',true,now()-interval '3 days',NULL,false),
  ('group-old','mahara-location','contact-old','Old team','+120363000001','csm',NULL,'custom-whatsapp-provider',true,now()-interval '40 days',NULL,false)`);
 await db.exec("INSERT INTO wa_drafts(thread_id,ar,en,why,based_on) VALUES('thread-one','مسودة','Draft reply','Answers the question','Original incoming request')");
 for(const name of accessFix?['20261012d_wa_access.sql','20261012e_wa_client_link.sql','20261012f_wa_send_rules.sql']:[])await db.exec(migration(name));
}
afterEach(async()=>{await db.close();});
async function rpc(name:string,args:Row){if(!/^cockpit_[a-z_]+$/.test(name))throw new Error('Unsafe fixture RPC');const keys=Object.keys(args);return (await db.query<{value:Row}>(`SELECT ${name}(${keys.map((key,index)=>`${key}=>$${index+1}`).join(',')}) value`,Object.values(args))).rows[0].value;}
async function count(sql:string,params:unknown[]=[]){await owner(db);return (await db.query<{n:number}>(sql,params)).rows[0].n;}
async function service(){await db.exec('RESET ROLE;SET ROLE service_role');}
describe('20261012d: client chats only through the WhatsApp functions',()=>{
 test('the live grants let any seat read every chat; after the migration the tables refuse browsers and the functions still answer',async()=>{
  await setup(false);
  await actor(db,OTHER);expect((await db.query('SELECT id FROM wa_threads')).rows.length).toBe(4);
  await owner(db);await db.exec(migration('20261012d_wa_access.sql'));
  for(const who of [OTHER,null])for(const table of ['wa_threads','wa_messages','wa_drafts','wa_state']){
   await actor(db,who);await expect(db.query(`SELECT * FROM ${table}`)).rejects.toMatchObject({code:'42501'});
  }
  await actor(db,UID);await expect(db.query("UPDATE wa_drafts SET en='rewritten'")).rejects.toMatchObject({code:'42501'});
  await owner(db);expect(await count("SELECT count(*)::int n FROM pg_policies WHERE tablename LIKE 'wa\\_%'")).toBe(0);
  await actor(db,UID);expect((await rpc('cockpit_wa_inbox',{p_app:'client-success'})).threads.map((t:Row)=>t.id)).toEqual(['thread-one']);
  await service();expect((await db.query('SELECT id FROM wa_threads')).rows.length).toBe(4);
 });
});
describe('20261012e: linking chats to clients',()=>{
 beforeEach(()=>setup());
 test('a dry run changes nothing; applying links once, audits once and replays its first outcome',async()=>{
  const id=randomUUID(),args={p_thread:'thread-two',p_task_id:'cu-beta',p_request_id:id};
  await actor(db,LEAD);const dry=await rpc('cockpit_wa_link_thread',args);
  expect(dry).toMatchObject({ok:false,dryRun:true,threadId:'thread-two',taskId:'cu-beta',clientName:'Beta',linked:true,changed:true});
  expect(await count("SELECT count(*)::int n FROM wa_threads WHERE client_task_id IS NOT NULL")).toBe(1);
  await actor(db,LEAD);const applied=await rpc('cockpit_wa_link_thread',{...args,p_apply:true});
  expect(applied).toMatchObject({ok:true,id,threadId:'thread-two',taskId:'cu-beta',changed:true});
  await actor(db,LEAD);expect(await rpc('cockpit_wa_link_thread',{...args,p_apply:true})).toEqual(applied);
  await actor(db,LEAD);await expect(rpc('cockpit_wa_link_thread',{...args,p_task_id:'cu-alpha',p_apply:true})).rejects.toThrow('different inputs');
  expect(await count("SELECT count(*)::int n FROM wa_threads WHERE id='thread-two' AND client_task_id='cu-beta'")).toBe(1);
  await owner(db);const audit=(await db.query<Row>("SELECT action,entity_id,actor_email,before,after,metadata FROM cockpit_audit_log WHERE entity_type='wa_thread_link'")).rows;
  expect(audit).toEqual([{action:'wa_thread_link',entity_id:'thread-two',actor_email:'lead@tests.invalid',before:{client_task_id:null},after:{client_task_id:'cu-beta'},metadata:expect.objectContaining({requestId:id,actorId:LEAD,taskId:'cu-beta',unlink:false})}]);
 });
 test('the worker sync keeps the link',async()=>{
  await actor(db,LEAD);await rpc('cockpit_wa_link_thread',{p_thread:'thread-two',p_task_id:'cu-beta',p_request_id:randomUUID(),p_apply:true});
  await service();await rpc('cockpit_wa_worker_thread',{p_thread:{id:'thread-two',location_id:'mahara-location',contact_id:'contact-two',contact_name:'Beta owner renamed',phone:'+96512345678',provider_id:'custom-whatsapp-provider',is_group:false},p_messages:[]});
  expect(await count("SELECT count(*)::int n FROM wa_threads WHERE id='thread-two' AND client_task_id='cu-beta' AND contact_name='Beta owner renamed'")).toBe(1);
 });
 test('a chat linked to one client is not moved to another, and unlinking is audited',async()=>{
  await actor(db,LEAD);await expect(rpc('cockpit_wa_link_thread',{p_thread:'thread-one',p_task_id:'cu-beta',p_request_id:randomUUID(),p_apply:true})).rejects.toThrow('Unlink it there first');
  await actor(db,LEAD);await expect(rpc('cockpit_wa_link_thread',{p_thread:'thread-two',p_task_id:'cu-alpha',p_request_id:randomUUID(),p_apply:true,p_unlink:true})).rejects.toThrow('not linked to this client');
  await actor(db,UID);const out=await rpc('cockpit_wa_link_thread',{p_thread:'thread-one',p_task_id:'cu-alpha',p_request_id:randomUUID(),p_apply:true,p_unlink:true});
  expect(out).toMatchObject({ok:true,linked:false,changed:true});
  expect(await count("SELECT count(*)::int n FROM wa_threads WHERE id='thread-one' AND client_task_id IS NULL")).toBe(1);
  expect(await count("SELECT count(*)::int n FROM cockpit_audit_log WHERE entity_type='wa_thread_link' AND action='wa_thread_unlink' AND after->>'client_task_id' IS NULL")).toBe(1);
 });
 test('a limited seat retrying its applied unlink gets the first outcome, though the chat is now out of its reach',async()=>{
  const args={p_thread:'thread-one',p_task_id:'cu-alpha',p_request_id:randomUUID(),p_apply:true,p_unlink:true};
  await actor(db,UID);const first=await rpc('cockpit_wa_link_thread',args);
  expect(first).toMatchObject({ok:true,linked:false,changed:true});
  await actor(db,UID);expect(await rpc('cockpit_wa_link_thread',args)).toEqual(first);
  await actor(db,UID);await expect(rpc('cockpit_wa_link_thread',{...args,p_unlink:false})).rejects.toThrow('different inputs');
  await actor(db,UID);await expect(rpc('cockpit_wa_link_thread',{...args,p_request_id:randomUUID()})).rejects.toThrow('client mapping');
  await actor(db,OTHER);await expect(rpc('cockpit_wa_link_thread',args)).rejects.toThrow('access list');
  expect(await count("SELECT count(*)::int n FROM cockpit_audit_log WHERE entity_type='wa_thread_link'")).toBe(1);
 });
 test('a seat limited to some clients cannot claim another chat, and other clients and anonymous callers are refused',async()=>{
  await actor(db,UID);await expect(rpc('cockpit_wa_link_thread',{p_thread:'thread-two',p_task_id:'cu-alpha',p_request_id:randomUUID(),p_apply:true})).rejects.toThrow('client mapping');
  await actor(db,UID);await expect(rpc('cockpit_wa_link_thread',{p_thread:'thread-two',p_task_id:'cu-beta',p_request_id:randomUUID()})).rejects.toThrow('access list');
  await actor(db,null);await expect(rpc('cockpit_wa_link_thread',{p_thread:'thread-two',p_task_id:'cu-beta',p_request_id:randomUUID()})).rejects.toMatchObject({code:'42501'});
  expect(await count("SELECT count(*)::int n FROM wa_threads WHERE client_task_id IS NOT NULL")).toBe(1);
 });
 test('candidates: the client contact first, then the phone, and recent unlinked groups for a pick by hand',async()=>{
  await actor(db,LEAD);const byContact=await rpc('cockpit_csm_wa_link_candidates',{p_task_id:'cu-beta',p_contact_id:'contact-two'});
  expect(byContact).toMatchObject({configured:true,clientName:'Beta',fullScope:true,linked:[],matches:[{threadId:'thread-two',match:'contact',phoneLast4:'5678',isGroup:false,linkedElsewhere:false}],note:null});
  expect(byContact.groups.map((g:Row)=>g.threadId)).toEqual(['group-new']);
  await actor(db,LEAD);expect((await rpc('cockpit_csm_wa_link_candidates',{p_task_id:'cu-beta',p_phone:'+965 1234-5678'})).matches).toMatchObject([{threadId:'thread-two',match:'phone'}]);
  await actor(db,LEAD);expect((await rpc('cockpit_csm_wa_link_candidates',{p_task_id:'cu-beta',p_phone:'5678'})).matches).toEqual([]);
  await actor(db,UID);const scoped=await rpc('cockpit_csm_wa_link_candidates',{p_task_id:'cu-alpha',p_contact_id:'contact-two'});
  expect(scoped).toMatchObject({fullScope:false,linked:[{threadId:'thread-one',isGroup:true}],matches:[],groups:[]});expect(scoped.note).toContain('every client');
  await actor(db,UID);await expect(rpc('cockpit_csm_wa_link_candidates',{p_task_id:'cu-alpha',p_contact_id:"x' OR 1=1"})).rejects.toThrow('valid GoHighLevel contact');
 });
});
describe('20261012e: the client tab reads the day',()=>{
 beforeEach(()=>setup());
 const dayStart="(date_trunc('day',now() AT TIME ZONE 'Asia/Kuwait') AT TIME ZONE 'Asia/Kuwait')";
 test('messages since Kuwait midnight plus the 14 before, the draft, and the key the send needs',async()=>{
  await owner(db);
  await db.exec(`INSERT INTO wa_messages(id,thread_id,direction,body,kind,speaker,at) SELECT 'old-'||n,'thread-one','inbound','Earlier '||n,'text','Client',${dayStart}-make_interval(mins=>n) FROM generate_series(1,16) n`);
  await db.exec(`INSERT INTO wa_messages(id,thread_id,direction,body,kind,speaker,at,delivery_status) VALUES('today-in','thread-one','inbound','Morning','text','Client',${dayStart}+interval '1 second',NULL),('today-out','thread-one','outbound','On it','text',NULL,${dayStart}+interval '2 seconds','delivered')`);
  await actor(db,UID);const read=await rpc('cockpit_csm_client_whatsapp',{p_task_id:'cu-alpha'});
  expect(read).toMatchObject({configured:true,ready:true,stale:false,note:null,taskId:'cu-alpha',clientName:'Alpha',syncedAt:expect.any(Number),dayStart:expect.any(Number)});
  const [thread]=read.threads;
  expect(thread).toMatchObject({threadId:'thread-one',isGroup:true,awaitingUs:true,today:{inbound:1,outbound:1},draft:{en:'Draft reply',ar:'مسودة'},sendSupported:true,replyState:null,lastReply:null});
  expect(thread.messages).toHaveLength(16);
  expect(thread.messages.filter((m:Row)=>m.today).map((m:Row)=>[m.id,m.direction,m.status])).toEqual([['today-in','inbound',null],['today-out','outbound','delivered']]);
  expect(thread.messages[0].id).toBe('old-14');
  await actor(db,UID);expect(thread.contextKey).toBe((await rpc('cockpit_wa_reply_context',{p_app:'client-success',p_thread:'thread-one'})).contextKey);
 });
 test('an old scan is said in plain words and turns sending off',async()=>{
  await owner(db);await db.exec("UPDATE wa_state SET last_scan=now()-interval '30 minutes'");
  await actor(db,UID);const read=await rpc('cockpit_csm_client_whatsapp',{p_task_id:'cu-alpha'});
  expect(read).toMatchObject({ready:false,stale:true});expect(read.note).toMatch(/^WhatsApp has not synced since .+, so an empty day is not proof\.$/);
  expect(read.threads[0].sendSupported).toBe(false);
 });
 test('another client, a client with no chats and anonymous callers',async()=>{
  await actor(db,OTHER);await expect(rpc('cockpit_csm_client_whatsapp',{p_task_id:'cu-alpha'})).rejects.toThrow('access list');
  await actor(db,OTHER);expect((await rpc('cockpit_csm_client_whatsapp',{p_task_id:'cu-beta'})).threads).toEqual([]);
  await actor(db,null);await expect(rpc('cockpit_csm_client_whatsapp',{p_task_id:'cu-alpha'})).rejects.toMatchObject({code:'42501'});
 });
});
describe('20261012f: send rules',()=>{
 beforeEach(()=>setup());
 async function key(who:string,thread='thread-one'){await actor(db,who);return (await rpc('cockpit_wa_reply_context',{p_app:'client-success',p_thread:thread})).contextKey as string;}
 async function begin(who:string,body:string,opts:{thread?:string;apply?:boolean;key?:string;id?:string}={}){
  const thread=opts.thread??'thread-one',contextKey=opts.key??await key(who,thread);await actor(db,who);
  return rpc('cockpit_wa_reply_begin',{p_app:'client-success',p_thread:thread,p_body:body,p_context_key:contextKey,p_request_id:opts.id??randomUUID(),p_apply:opts.apply??false});
 }
 test('lead and cost-per-lead wording is refused in English and Arabic, before anything is stored',async()=>{
  for(const body of ['We got 12 leads this week','Your CPL is 3 KWD','Cost per lead dropped','Lead quality is up','عدد الليدز اليوم ١٢','جبنا ليد جديد','عندكم عملاء محتملين كثير','وصلنا للعملاء المحتملين','ليداتكم هالشهر ٤٠','ليدكم زاد','ليدزكم أحسن','وصلكم ٣٠ للليد','CPLs dropped']){
   await expect(begin(UID,body)).rejects.toThrow('Client messages never quote leads or cost per lead. Say how the campaign is doing, or count appointments for clients we book for.');
   await expect(begin(UID,body,{apply:true})).rejects.toThrow('never quote leads');
  }
  for(const body of ['هلا وليد، الحملة شغالة','Leadership call tomorrow','Four appointments booked today','الطريقة التقليدية','شغل تقليدي','مواليد الشهر','ليدي غاغا','Good leadership','Nothing here should mislead you'])expect(await begin(UID,body)).toEqual({ok:false,dryRun:true});
  expect(await count('SELECT count(*)::int n FROM cockpit_wa_reply_intents')).toBe(0);
 });
 test('a linked chat needs client success access to its client; an unlinked chat keeps the full-scope rule',async()=>{
  const linked=await key(LEAD),unlinked=await key(LEAD,'thread-two');
  await owner(db);await db.exec("UPDATE cockpit_csm_source_state SET row_count=3 WHERE table_name='clients'");
  await expect(begin(LEAD,'Hello',{key:linked})).rejects.toThrow('client roster is incomplete');
  expect(await begin(LEAD,'Hello',{thread:'thread-two',key:unlinked})).toEqual({ok:false,dryRun:true});
  await expect(begin(UID,'Hello',{thread:'thread-two'})).rejects.toThrow('client mapping');
 });
 test('ceilings: 5 per chat and 20 per person in 10 minutes; failed requests do not count',async()=>{
  await owner(db);
  const add=async(n:number,who:string,thread:string,state:string,ago="1 minute")=>db.query(`INSERT INTO cockpit_wa_reply_intents(id,app,actor_id,actor_email,thread_id,body,context_hash,context,state,created_at) SELECT gen_random_uuid(),'client-success',$1::uuid,'x@tests.invalid',$2,'Earlier','seed-'||$1::uuid::text||$2||'-'||$3||'-'||g,'{}',$3,now()-$4::interval FROM generate_series(1,$5) g`,[who,thread,state,ago,n]);
  await add(4,UID,'thread-one','accepted');await add(3,UID,'thread-one','failed');await add(5,UID,'thread-one','delivered','11 minutes');
  expect(await begin(UID,'Fifth one')).toEqual({ok:false,dryRun:true});
  expect((await begin(UID,'Fifth one',{apply:true})).state).toBe('new');
  await expect(begin(UID,'Sixth one')).rejects.toThrow('This chat has had 5 messages in 10 minutes');
  await owner(db);await add(5,UID,'group-old','accepted');await expect(begin(LEAD,'Into a busy chat',{thread:'group-old',apply:true})).rejects.toThrow('This chat has had 5 messages');
  await owner(db);await add(15,LEAD,'thread-one','accepted');
  expect(await begin(LEAD,'Twentieth',{thread:'thread-two'})).toEqual({ok:false,dryRun:true});
  await owner(db);await add(5,LEAD,'group-new','reconcile');
  await expect(begin(LEAD,'Twenty-first',{thread:'thread-two'})).rejects.toThrow("You have sent 20 messages in 10 minutes. Wait a few minutes; this protects Rasem's number.");
 });
 test('a follow-up after an accepted reply goes through; a double press still does not',async()=>{
  const first=await key(UID),a=randomUUID();
  const started=await begin(UID,'First message',{key:first,id:a,apply:true});expect(started.state).toBe('new');
  await expect(begin(UID,'Pressed twice',{key:first,apply:true})).rejects.toThrow('already has a reply intent');
  expect((await begin(UID,'First message',{key:first,id:a,apply:true})).state).toBe('intent');
  await service();await rpc('cockpit_wa_reply_guard',{p_id:a,p_token:started.claimToken});
  expect((await rpc('cockpit_wa_reply_accepted',{p_id:a,p_token:started.claimToken,p_receipt:{conversationId:'thread-one',messageId:'provider-first'}})).state).toBe('accepted');
  const second=await key(UID);expect(second).not.toBe(first);
  await expect(begin(UID,'Stale screen',{key:first,apply:true})).rejects.toThrow('conversation changed');
  const followUp=await begin(UID,'Second message',{key:second,apply:true});expect(followUp.state).toBe('new');expect(followUp.context.lastReplyId).toBe(a);
  await expect(begin(UID,'Pressed twice again',{key:second,apply:true})).rejects.toThrow('already has a reply intent');
  await actor(db,UID);const read=await rpc('cockpit_csm_client_whatsapp',{p_task_id:'cu-alpha'});
  expect(read.threads[0]).toMatchObject({contextKey:second,replyState:'intent',sendSupported:false,lastReply:{state:'intent'}});
 });
 test('the health ledger accepts the contact read and nothing wider',async()=>{
  const started=await begin(UID,'Hello',{apply:true});await service();
  await rpc('cockpit_wa_health',{p_id:started.id,p_token:started.claimToken,p_receipt:{provider:'ghl',method:'GET',resource:'contacts/contact-one',phase:'intent'}});
  for(const receipt of [{provider:'ghl',method:'POST',resource:'contacts/contact-one',phase:'intent'},{provider:'ghl',method:'GET',resource:'contacts/a/notes',phase:'intent'},{provider:'ghl',method:'GET',resource:'users/me',phase:'intent'}])
   await expect(rpc('cockpit_wa_health',{p_id:started.id,p_token:started.claimToken,p_receipt:receipt})).rejects.toThrow('Invalid WhatsApp provider health receipt');
  expect(await count('SELECT count(*)::int n FROM cockpit_wa_provider_health')).toBe(1);
 });
 test('privileges stay as they were live',async()=>{
  await owner(db);const acl=(await db.query<{proname:string;acl:string}>("SELECT proname,array_to_string(proacl,',') acl FROM pg_proc WHERE proname IN('cockpit_wa_reply_begin','cockpit_wa_context','cockpit_wa_health','cockpit_wa_link_thread','cockpit_csm_wa_link_candidates','cockpit_csm_client_whatsapp') ORDER BY proname")).rows;
  const roles=(a:string)=>a.split(',').map(x=>x.split('=')[0]).filter(r=>r!=='postgres'&&r!=='').sort();
  expect(Object.fromEntries(acl.map(r=>[r.proname,roles(r.acl)]))).toEqual({cockpit_csm_client_whatsapp:['authenticated'],cockpit_csm_wa_link_candidates:['authenticated'],cockpit_wa_context:[],cockpit_wa_health:['service_role'],cockpit_wa_link_thread:['authenticated'],cockpit_wa_reply_begin:['authenticated']});
 });
});
