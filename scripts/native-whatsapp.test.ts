import {beforeEach,afterEach,describe,expect,test} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {nativeFeedDb} from './lib/nativeFeedDb';
import {actor,member,migration,owner} from '../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';
import type {Row} from '../hermes/cockpit-sync/runtime';
import {executeWhatsappReply,type WhatsappRpcClient} from '../supabase/functions/cockpit-media-api/whatsapp';
const UID='30000000-0000-4000-8000-000000000001',OTHER='30000000-0000-4000-8000-000000000002';
let db:Awaited<ReturnType<typeof nativeFeedDb>>;
beforeEach(async()=>{
 db=await nativeFeedDb();await db.exec(migration('20260920b_wa_inbox.sql'));await db.exec(migration('20261005g_cockpit_native_whatsapp.sql'));
 await db.exec("UPDATE cockpit_wa_connections SET location_id='mahara-location' WHERE app='client-success'");
 await db.exec(migration('20261005d_cockpit_client_calendars.sql'));
 await member(db,UID,'csm@tests.invalid',['csm']);await member(db,OTHER,'other@tests.invalid',['csm']);
 await db.query('UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2',[['Alpha'],UID]);await db.query('UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2',[['Beta'],OTHER]);
 await db.exec("UPDATE cockpit_csm_source_state SET ready=true,row_count=1,source_snapshot_at=now() WHERE table_name='clients'");
 await db.exec("INSERT INTO cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) SELECT 'clients','alpha',ARRAY['Alpha'],'{\"_id\":\"alpha\",\"name\":\"Alpha\",\"taskId\":\"cu-alpha\"}',source_snapshot_at FROM cockpit_csm_source_state WHERE table_name='clients'");
 await db.exec("INSERT INTO wa_state(location_id,scan_since,last_scan) VALUES('mahara-location','2026-09-20T00:00:00Z',now())");
 await db.exec("INSERT INTO wa_threads(id,location_id,contact_id,contact_name,phone,desk,client_task_id,provider_id,is_group,last_at,last_inbound_at,awaiting_us) VALUES('thread-one','mahara-location','contact-one','Alpha group','+861234567890','csm','cu-alpha','custom-whatsapp-provider',true,now()-interval '1 minute',now()-interval '1 minute',true)");
 await db.exec("INSERT INTO wa_drafts(thread_id,ar,en,based_on) VALUES('thread-one','Original Arabic draft','Original English draft','Original incoming request')");
});
afterEach(async()=>{await db.close();});
async function rpc(name:string,args:Row){if(!/^cockpit_wa_[a-z_]+$/.test(name))throw new Error('Unsafe fixture RPC');const keys=Object.keys(args);return (await db.query<{value:Row}>(`SELECT ${name}(${keys.map((key,index)=>`${key}=>$${index+1}`).join(',')}) value`,Object.values(args))).rows[0].value;}
async function begin(id=randomUUID(),body='Reviewed reply'){
 await actor(db,UID);const context=await rpc('cockpit_wa_reply_context',{p_app:'client-success',p_thread:'thread-one'});
 const args={p_app:'client-success',p_thread:'thread-one',p_body:body,p_context_key:context.contextKey,p_request_id:id,p_apply:true};return {result:await rpc('cockpit_wa_reply_begin',args),args};
}
async function service(){await db.exec('RESET ROLE;SET ROLE service_role');}
function roleClient(user:boolean):WhatsappRpcClient{
 return {rpc:async(name,args)=>{
  try{if(user)await actor(db,UID);else await service();return {data:await rpc(name,args),error:null};}
  catch(error){return {data:null,error:{message:error instanceof Error?error.message:'SQL rejected'}};}
 }};
}
const senderEnv=(name:string)=>name==='GHL_MAHARA_PIT'?'fixture-pit':name==='GHL_MAHARA_LOCATION'?'mahara-location':undefined;
describe('native WhatsApp effect and delivery contract',()=>{
 test('same request is retained, competing context is denied, and accepted is not delivered',async()=>{
  const {result,args}=await begin();expect(result.state).toBe('new');expect((await rpc('cockpit_wa_reply_begin',args)).state).toBe('intent');
  await expect(rpc('cockpit_wa_reply_begin',{...args,p_request_id:randomUUID()})).rejects.toThrow('reply intent');await expect(rpc('cockpit_wa_reply_begin',{...args,p_body:'Different reply'})).rejects.toThrow('different inputs');
  await service();await rpc('cockpit_wa_reply_guard',{p_id:result.id,p_token:result.claimToken});
  await rpc('cockpit_wa_reply_accepted',{p_id:result.id,p_token:result.claimToken,p_receipt:{conversationId:'thread-one',messageId:'real-provider-message'}});
  await owner(db);const stored=(await db.query<{awaiting_us:boolean;sent_at:string|null;submitted_at:string|null}>("SELECT t.awaiting_us,d.sent_at,d.submitted_at FROM wa_threads t JOIN wa_drafts d ON d.thread_id=t.id WHERE t.id='thread-one'")).rows[0];
  expect(stored.awaiting_us).toBe(true);expect(stored.sent_at).toBeNull();expect(stored.submitted_at).not.toBeNull();
  await db.exec("UPDATE wa_messages SET delivery_status=NULL WHERE id='real-provider-message'");
  expect((await db.query<{state:string}>('SELECT state FROM cockpit_wa_reply_intents WHERE id=$1',[result.id])).rows[0].state).toBe('accepted');
  await db.exec("UPDATE wa_messages SET delivery_status='delivered' WHERE id='real-provider-message'");
  expect((await db.query<{state:string}>('SELECT state FROM cockpit_wa_reply_intents WHERE id=$1',[result.id])).rows[0].state).toBe('delivered');
  expect((await db.query<{body:string|null}>("SELECT sent_body AS body FROM wa_drafts WHERE thread_id='thread-one'")).rows[0].body).toBe('Reviewed reply');
 });
 test('late delivery cannot mark a newer inbound conversation answered',async()=>{
  const {result}=await begin();await service();await rpc('cockpit_wa_reply_accepted',{p_id:result.id,p_token:result.claimToken,p_receipt:{conversationId:'thread-one',messageId:'late-delivery'}});
  await owner(db);await db.exec("UPDATE wa_threads SET last_inbound_at=now()+interval '1 second' WHERE id='thread-one';UPDATE wa_messages SET delivery_status='read' WHERE id='late-delivery'");
  const current=(await db.query<{awaiting_us:boolean;sent_at:string|null}>("SELECT t.awaiting_us,d.sent_at FROM wa_threads t JOIN wa_drafts d ON d.thread_id=t.id WHERE t.id='thread-one'")).rows[0];
  expect(current.awaiting_us).toBe(true);expect(current.sent_at).toBeNull();
  expect((await db.query<{state:string}>('SELECT state FROM cockpit_wa_reply_intents WHERE id=$1',[result.id])).rows[0].state).toBe('delivered');
 });
 test('unknown provider outcome blocks repeats and cannot fabricate a message or sent draft',async()=>{
  const {result,args}=await begin();await service();await rpc('cockpit_wa_reply_failed',{p_id:result.id,p_token:result.claimToken,p_unknown:true});await actor(db,UID);
  expect((await rpc('cockpit_wa_reply_begin',args)).state).toBe('reconcile');await expect(rpc('cockpit_wa_reply_begin',{...args,p_request_id:randomUUID()})).rejects.toThrow('reply intent');
  await owner(db);expect((await db.query<{count:number}>('SELECT count(*)::int count FROM wa_messages')).rows[0].count).toBe(0);expect((await db.query<{sent_at:string|null}>("SELECT sent_at FROM wa_drafts WHERE thread_id='thread-one'")).rows[0].sent_at).toBeNull();
 });
 test('changed context and revoked actor deny effects while a real late receipt remains private',async()=>{
  const {result}=await begin();await owner(db);await db.query('UPDATE cockpit_members SET active=false WHERE auth_user_id=$1',[UID]);await service();
  await expect(rpc('cockpit_wa_reply_guard',{p_id:result.id,p_token:result.claimToken})).rejects.toThrow('access');
  const retained=await rpc('cockpit_wa_reply_accepted',{p_id:result.id,p_token:result.claimToken,p_receipt:{conversationId:'thread-one',messageId:'accepted-before-revocation'}});expect(retained.state).toBe('reconcile');
  await owner(db);expect((await db.query<{count:number}>('SELECT count(*)::int count FROM wa_messages')).rows[0].count).toBe(0);expect((await db.query<{value:string}>('SELECT provider_message_id value FROM cockpit_wa_reply_intents WHERE id=$1',[result.id])).rows[0].value).toBe('accepted-before-revocation');
 });
 test('another client, missing provider, wrong desk and anonymous callers fail closed',async()=>{
  await actor(db,OTHER);await expect(rpc('cockpit_wa_reply_context',{p_app:'client-success',p_thread:'thread-one'})).rejects.toThrow('client mapping');
  await owner(db);await db.exec("UPDATE wa_threads SET provider_id=NULL WHERE id='thread-one'");await actor(db,UID);const context=await rpc('cockpit_wa_reply_context',{p_app:'client-success',p_thread:'thread-one'});expect(context.sendSupported).toBe(false);await expect(begin()).rejects.toThrow('identifiers');
  await owner(db);await db.exec('SET ROLE anon');await expect(rpc('cockpit_wa_reply_context',{p_app:'client-success',p_thread:'thread-one'})).rejects.toMatchObject({code:'42501'});
 });
});
test('actual provider helper uses verified Custom routing and reuses the accepted provider ID',async()=>{
 await actor(db,UID);const context=await rpc('cockpit_wa_reply_context',{p_app:'client-success',p_thread:'thread-one'});
 const args={app:'client-success',chatId:'thread-one',text:'Review this exact reply.',contextKey:context.contextKey,requestId:randomUUID(),apply:true};let calls=0;
 const request:typeof fetch=async(input,init)=>{
  calls++;const body=JSON.parse(String(init?.body));
  if(String(input)!=='https://services.leadconnectorhq.com/conversations/messages'||init?.method!=='POST'||body.type!=='Custom'||body.contactId!=='contact-one'||body.conversationProviderId!=='custom-whatsapp-provider'||body.status!=='pending'||body.toNumber!==undefined)return Response.json({error:'Wrong recipient route'},{status:400});
  return Response.json({conversationId:'thread-one',messageId:'confirmed-provider-message'});
 };
 const result=await executeWhatsappReply(roleClient(true),roleClient(false),args,senderEnv,request);expect(result).toMatchObject({state:'accepted',deliveryConfirmed:false,providerMessageId:'confirmed-provider-message'});
 expect(await executeWhatsappReply(roleClient(true),roleClient(false),args,senderEnv,request)).toMatchObject({state:'accepted',providerMessageId:'confirmed-provider-message'});expect(calls).toBe(1);
 await owner(db);expect((await db.query<{id:string;body:string;status:string}>('SELECT id,body,delivery_status status FROM wa_messages')).rows).toEqual([{id:'confirmed-provider-message',body:'Review this exact reply.',status:'pending'}]);
 expect((await db.query<{count:number}>('SELECT count(*)::int count FROM cockpit_wa_provider_health')).rows[0].count).toBe(2);
});
test('ambiguous actual POST never produces a fabricated outbound row or a second request',async()=>{
 await actor(db,UID);const context=await rpc('cockpit_wa_reply_context',{p_app:'client-success',p_thread:'thread-one'});const args={app:'client-success',chatId:'thread-one',text:'One original reply',contextKey:context.contextKey,requestId:randomUUID(),apply:true};let calls=0;
 const request:typeof fetch=async()=>{calls++;throw new Error('Connection lost after acceptance');};
 await expect(executeWhatsappReply(roleClient(true),roleClient(false),args,senderEnv,request)).rejects.toThrow('reconciliation');await expect(executeWhatsappReply(roleClient(true),roleClient(false),args,senderEnv,request)).rejects.toThrow('Nothing was resent');expect(calls).toBe(1);
 await owner(db);expect((await db.query<{count:number}>('SELECT count(*)::int count FROM wa_messages')).rows[0].count).toBe(0);
});
test('a real foreign-conversation receipt is retained privately instead of publishing into the reviewed thread',async()=>{
 const {result}=await begin();await service();const outcome=await rpc('cockpit_wa_reply_accepted',{p_id:result.id,p_token:result.claimToken,p_receipt:{conversationId:'unexpected-conversation',messageId:'actual-external-id'}});expect(outcome.state).toBe('reconcile');
 await owner(db);expect((await db.query<{receipt:unknown}>('SELECT receipt FROM cockpit_wa_reply_intents WHERE id=$1',[result.id])).rows[0].receipt).toEqual({conversationId:'unexpected-conversation',messageId:'actual-external-id'});expect((await db.query<{count:number}>('SELECT count(*)::int count FROM wa_messages')).rows[0].count).toBe(0);
});
test('native desk read returns real draft columns, hides another client and distinguishes stale from answered',async()=>{
 await actor(db,UID);const current=await rpc('cockpit_wa_inbox',{p_app:'client-success'});expect(current).toMatchObject({configured:true,ready:true,totalAwaiting:1,threads:[{id:'thread-one',contextKey:expect.any(String),draft:{en:'Original English draft',sent_at:null},messages:[]}]});
 await actor(db,OTHER);expect((await rpc('cockpit_wa_inbox',{p_app:'client-success'})).threads).toEqual([]);
 await owner(db);await db.exec("UPDATE wa_state SET last_scan=now()-interval '30 minutes'");await actor(db,UID);const stale=await rpc('cockpit_wa_inbox',{p_app:'client-success'});expect(stale.ready).toBe(false);expect(stale.totalAwaiting).toBeNull();expect(stale.sourceNote).toContain('20 minutes');expect(stale.threads[0].sendSupported).toBe(false);
});
test('disabled desk does not fall back to CSM, and archiving retains its reviewed context and receipt',async()=>{
 await owner(db);await db.query('UPDATE cockpit_members SET roles=$1 WHERE auth_user_id=$2',[['csm','creative'],UID]);await actor(db,UID);const creative=await rpc('cockpit_wa_inbox',{p_app:'creative'});expect(creative.configured).toBe(false);expect(creative.threads).toEqual([]);expect(creative.totalAwaiting).toBeNull();
 const ctx=await rpc('cockpit_wa_reply_context',{p_app:'client-success',p_thread:'thread-one'});const id=randomUUID(),args={p_app:'client-success',p_thread:'thread-one',p_archived:true,p_context_key:ctx.contextKey,p_request_id:id,p_apply:true};
 const applied=await rpc('cockpit_wa_archive',args);expect(await rpc('cockpit_wa_archive',args)).toEqual(applied);expect((await rpc('cockpit_wa_inbox',{p_app:'client-success'})).threads).toEqual([]);
 await owner(db);await db.exec("UPDATE wa_threads SET archived=false,last_inbound_at=now() WHERE id='thread-one'");await actor(db,UID);
 await expect(rpc('cockpit_wa_archive',{...args,p_request_id:randomUUID()})).rejects.toThrow('conversation changed');expect(await rpc('cockpit_wa_archive',args)).toEqual(applied);
 await owner(db);expect((await db.query<{archived:boolean}>("SELECT archived FROM wa_threads WHERE id='thread-one'")).rows[0].archived).toBe(false);
});
test('atomic comms overview retains native missing-calendar notes and real scoped WhatsApp context',async()=>{
 await actor(db,UID);const current=(await db.query<{value:Row}>('SELECT cockpit_comms_overview($1) value',['client-success'])).rows[0].value;
 expect(current).toMatchObject({calendarReady:false,whatsappReady:true,whatsappConfigured:true,threads:[{chatId:'thread-one',draft:'Original English draft',contextKey:expect.any(String)}]});expect(current.sourceNote).toContain('native');
});
test('worker draft CAS preserves a newer human draft and rejects changed conversation context',async()=>{
 await owner(db);const current=(await db.query<{last_inbound_at:string;drafted_at:string}>("SELECT t.last_inbound_at,d.drafted_at FROM wa_threads t JOIN wa_drafts d ON d.thread_id=t.id WHERE t.id='thread-one'")).rows[0];
 await db.exec("UPDATE wa_threads SET last_inbound_at=now()+interval '1 second' WHERE id='thread-one'");
 await service();const draft={ar:null,en:'Generated replacement',why:null,based_on:'Old inbound',model:'deepseek-chat'};
 expect(await rpc('cockpit_wa_worker_draft',{p_thread:'thread-one',p_inbound_at:current.last_inbound_at,p_previous_drafted_at:current.drafted_at,p_draft:draft})).toBe(false);
 await owner(db);expect((await db.query<{en:string}>("SELECT en FROM wa_drafts WHERE thread_id='thread-one'")).rows[0].en).toBe('Original English draft');
 await db.exec("UPDATE wa_drafts SET drafted_at=now()+interval '3 seconds',en='New human-reviewed draft' WHERE thread_id='thread-one'");
 const inbound=(await db.query<{value:string}>("SELECT last_inbound_at value FROM wa_threads WHERE id='thread-one'")).rows[0].value;
 await service();expect(await rpc('cockpit_wa_worker_draft',{p_thread:'thread-one',p_inbound_at:inbound,p_previous_drafted_at:current.drafted_at,p_draft:draft})).toBe(false);
 await owner(db);expect((await db.query<{en:string}>("SELECT en FROM wa_drafts WHERE thread_id='thread-one'")).rows[0].en).toBe('New human-reviewed draft');
});
test('atomic provider merge preserves client/archive choices and does not downgrade delivered messages',async()=>{
 await owner(db);await db.exec("UPDATE wa_threads SET archived=true WHERE id='thread-one'");
 const message={id:'provider-out',thread_id:'thread-one',direction:'outbound',body:'Actual provider reply',kind:'text',speaker:null,at:new Date().toISOString(),delivery_status:'delivered'};
 const thread={id:'thread-one',location_id:'mahara-location',contact_id:'contact-one',contact_name:'Updated provider name',phone:'+861234567890',provider_id:'custom-whatsapp-provider',is_group:true};
 await service();expect(await rpc('cockpit_wa_worker_thread',{p_thread:thread,p_messages:[message]})).toBe(1);
 await rpc('cockpit_wa_worker_thread',{p_thread:thread,p_messages:[{...message,delivery_status:'pending'}]});
 await owner(db);const stored=(await db.query<{archived:boolean;client_task_id:string;delivery_status:string}>("SELECT t.archived,t.client_task_id,m.delivery_status FROM wa_threads t JOIN wa_messages m ON m.thread_id=t.id WHERE m.id='provider-out'")).rows[0];
 expect(stored).toEqual({archived:true,client_task_id:'cu-alpha',delivery_status:'delivered'});
 await service();await expect(rpc('cockpit_wa_worker_thread',{p_thread:{...thread,contact_id:'another-contact'},p_messages:[message]})).rejects.toThrow('identity');
});
