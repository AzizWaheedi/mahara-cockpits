import {beforeEach,afterEach,describe,expect,test} from 'bun:test';
import {nativeFeedDb} from './lib/nativeFeedDb';
import {migration,owner} from '../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';
import type {Row} from '../hermes/cockpit-sync/runtime';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';

let db:Awaited<ReturnType<typeof nativeFeedDb>>;

beforeEach(async()=>{
 db=await nativeFeedDb();
 await db.exec(migration('20260920b_wa_inbox.sql'));
 await db.exec(migration('20261005g_cockpit_native_whatsapp.sql'));
 await db.exec("UPDATE cockpit_wa_connections SET location_id='mahara-location' WHERE app='client-success'");

 const patchFile=join(__dirname,'../supabase/migrations/20261008e_whatsapp_mirror_noop.sql');
 if(existsSync(patchFile)){
  await db.exec(readFileSync(patchFile,'utf8'));
 }
});

afterEach(async()=>{
 await db.close();
});

async function service(){
 await db.exec('RESET ROLE;SET ROLE service_role');
}

async function rpc(name:string,args:Row){
 if(!/^cockpit_wa_[a-z_]+$/.test(name))throw new Error('Unsafe fixture RPC');
 const keys=Object.keys(args);
 return (await db.query<{value:any}>(`SELECT ${name}(${keys.map((key,index)=>`${key}=>$${index+1}`).join(',')}) value`,Object.values(args))).rows[0].value;
}

const BASE_THREAD={
 id:'thread-fixture-101',
 location_id:'mahara-location',
 contact_id:'contact-fixture-101',
 contact_name:'Original Contact Name',
 phone:'+12345678901',
 is_group:false,
 provider_id:'provider-fixture-custom'
};

const BASE_MESSAGES=[
 {
  id:'msg-fixture-101',
  thread_id:'thread-fixture-101',
  direction:'inbound',
  body:'Hello from client',
  kind:'text',
  speaker:'Client Contact',
  at:'2026-09-21T10:00:00Z',
  delivery_status:null
 },
 {
  id:'msg-fixture-102',
  thread_id:'thread-fixture-101',
  direction:'outbound',
  body:'Hello back from team',
  kind:'text',
  speaker:'Mahara Support',
  at:'2026-09-21T10:05:00Z',
  delivery_status:'delivered'
 }
];

describe('cockpit_wa_worker_thread no-op and audit stability contract',()=>{
 test('repeating identical poll causes zero additional audit writes and no updated_at churn',async()=>{
  await service();
  const initialCount=await rpc('cockpit_wa_worker_thread',{p_thread:BASE_THREAD,p_messages:BASE_MESSAGES});
  expect(initialCount).toBe(2);

  await owner(db);
  const auditsAfterFirst=(await db.query<{count:number}>(
   "SELECT count(*)::int count FROM cockpit_audit_log WHERE entity_type IN('wa_threads','wa_messages') AND entity_id IN('thread-fixture-101','msg-fixture-101','msg-fixture-102')"
  )).rows[0].count;
  expect(auditsAfterFirst).toBeGreaterThan(0);

  const initialUpdatedAt=(await db.query<{updated_at:string}>(
   "SELECT updated_at FROM wa_threads WHERE id='thread-fixture-101'"
  )).rows[0].updated_at;

  await service();
  const secondCount=await rpc('cockpit_wa_worker_thread',{p_thread:BASE_THREAD,p_messages:BASE_MESSAGES});
  expect(secondCount).toBe(2);

  await owner(db);
  const auditsAfterRepeat=(await db.query<{count:number}>(
   "SELECT count(*)::int count FROM cockpit_audit_log WHERE entity_type IN('wa_threads','wa_messages') AND entity_id IN('thread-fixture-101','msg-fixture-101','msg-fixture-102')"
  )).rows[0].count;
  const repeatUpdatedAt=(await db.query<{updated_at:string}>(
   "SELECT updated_at FROM wa_threads WHERE id='thread-fixture-101'"
  )).rows[0].updated_at;

  expect(auditsAfterRepeat).toBe(auditsAfterFirst);
  expect(repeatUpdatedAt).toEqual(initialUpdatedAt);
 });

 test('changed provider body, metadata, or monotonic status updates and creates audits',async()=>{
  await service();
  await rpc('cockpit_wa_worker_thread',{p_thread:BASE_THREAD,p_messages:BASE_MESSAGES});

  await owner(db);
  const auditsBefore=(await db.query<{count:number}>(
   "SELECT count(*)::int count FROM cockpit_audit_log WHERE entity_type='wa_messages' AND entity_id='msg-fixture-102'"
  )).rows[0].count;

  const updatedMessages=[
   BASE_MESSAGES[0],
   {
    ...BASE_MESSAGES[1],
    delivery_status:'read'
   }
  ];

  await service();
  await rpc('cockpit_wa_worker_thread',{p_thread:BASE_THREAD,p_messages:updatedMessages});

  await owner(db);
  const msg=(await db.query<{delivery_status:string}>(
   "SELECT delivery_status FROM wa_messages WHERE id='msg-fixture-102'"
  )).rows[0];
  expect(msg.delivery_status).toBe('read');

  const auditsAfter=(await db.query<{count:number}>(
   "SELECT count(*)::int count FROM cockpit_audit_log WHERE entity_type='wa_messages' AND entity_id='msg-fixture-102'"
  )).rows[0].count;
  expect(auditsAfter).toBe(auditsBefore+1);

  await service();
  const changedBody=[{...BASE_MESSAGES[0],body:'Revised provider body'},updatedMessages[1]];
  await rpc('cockpit_wa_worker_thread',{p_thread:BASE_THREAD,p_messages:changedBody});
  await owner(db);
  expect((await db.query<{body:string}>("SELECT body FROM wa_messages WHERE id='msg-fixture-101'")).rows[0].body).toBe('Revised provider body');
  expect((await db.query<{count:number}>("SELECT count(*)::int count FROM cockpit_audit_log WHERE entity_type='wa_messages' AND entity_id='msg-fixture-101'")).rows[0].count).toBe(2);


  const changedThread={
   ...BASE_THREAD,
   contact_name:'Updated Fixture Name'
  };
  await service();
  await rpc('cockpit_wa_worker_thread',{p_thread:changedThread,p_messages:updatedMessages});

  await owner(db);
  const thread=(await db.query<{contact_name:string}>(
   "SELECT contact_name FROM wa_threads WHERE id='thread-fixture-101'"
  )).rows[0];
  expect(thread.contact_name).toBe('Updated Fixture Name');
 });

 test('delivery status monotonicity prevents status regressions',async()=>{
  await service();
  await rpc('cockpit_wa_worker_thread',{
   p_thread:BASE_THREAD,
   p_messages:[{...BASE_MESSAGES[1],delivery_status:'read'}]
  });

  await rpc('cockpit_wa_worker_thread',{
   p_thread:BASE_THREAD,
   p_messages:[{...BASE_MESSAGES[1],delivery_status:'pending'}]
  });

  await owner(db);
  const msg=(await db.query<{delivery_status:string}>(
   "SELECT delivery_status FROM wa_messages WHERE id='msg-fixture-102'"
  )).rows[0];
  expect(msg.delivery_status).toBe('read');
 });

 test('identity, desk, and switch-on checks fail closed without side effects',async()=>{
  await service();
  await rpc('cockpit_wa_worker_thread',{p_thread:BASE_THREAD,p_messages:BASE_MESSAGES});

  await expect(rpc('cockpit_wa_worker_thread',{
   p_thread:{...BASE_THREAD,location_id:'wrong-location'},
   p_messages:BASE_MESSAGES
  })).rejects.toThrow('CSM location');

  await expect(rpc('cockpit_wa_worker_thread',{
   p_thread:{...BASE_THREAD,contact_id:'tampered-contact-id'},
   p_messages:BASE_MESSAGES
  })).rejects.toThrow('identity or desk');

  await expect(rpc('cockpit_wa_worker_thread',{
   p_thread:BASE_THREAD,
   p_messages:[{...BASE_MESSAGES[0],at:'2026-09-19T23:59:59Z'}]
  })).rejects.toThrow('switch-on boundary');

  await expect(rpc('cockpit_wa_worker_thread',{
   p_thread:BASE_THREAD,
   p_messages:[BASE_MESSAGES[0],BASE_MESSAGES[0]]
  })).rejects.toThrow('duplicate identities');
 });

 test('human draft and annotation state survives unchanged and changed provider polls',async()=>{
  await service();
  await rpc('cockpit_wa_worker_thread',{p_thread:BASE_THREAD,p_messages:BASE_MESSAGES});

  await owner(db);
  await db.exec(
   "UPDATE wa_threads SET client_task_id='cu-fixture-card',archived=true WHERE id='thread-fixture-101'"
  );
  await db.exec(
   "INSERT INTO wa_drafts(thread_id,ar,en,based_on) VALUES('thread-fixture-101','مسودة عربية','English draft','Original message')"
  );

  await service();
  await rpc('cockpit_wa_worker_thread',{p_thread:BASE_THREAD,p_messages:BASE_MESSAGES});

  await owner(db);
  const stored=(await db.query<{archived:boolean;client_task_id:string;draft:string}>(
   "SELECT t.archived,t.client_task_id,d.en draft FROM wa_threads t JOIN wa_drafts d ON d.thread_id=t.id WHERE t.id='thread-fixture-101'"
  )).rows[0];
  expect(stored).toEqual({
   archived:true,
   client_task_id:'cu-fixture-card',
   draft:'English draft'
  });
 });
});
