import {test,expect} from 'bun:test';
import {cockpitTestDb,member,actor,owner,migration} from '../../../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';
const buyer='00000000-0000-0000-0000-000000000001',outsider='00000000-0000-0000-0000-000000000002';
test('media provider schema enforces current membership, campaign scope, private receipts and atomic finalization',async()=>{
 const db=await cockpitTestDb();
 try {
  await db.exec(`CREATE TABLE public.cockpit_campaigns(id bigint PRIMARY KEY,client_name text,meta_campaign_id text,meta_account_id text,task_id text,task_url text,raw_data jsonb,updated_at timestamptz);`);
  await db.exec(migration('20260927g_cockpit_media_actions.sql'));
  await member(db,buyer,'buyer@example.com',['media_buyer']);await member(db,outsider,'other@example.com',['csm']);
  await db.exec(`UPDATE public.cockpit_members SET clients=ARRAY['Client A'] WHERE email='buyer@example.com'; INSERT INTO public.cockpit_campaigns(id,client_name,meta_campaign_id,meta_account_id,raw_data) VALUES(1,'Client A','999999','act_123456','{"campaignName":"A"}'),(2,'Client B','888888','act_234567','{"campaignName":"B"}');`);
  await actor(db,buyer);
  expect((await db.query<any>(`SELECT public.cockpit_media_scope('control.setStatus','A') AS s`)).rows[0].s.account).toBe('123456');
  await owner(db);await db.exec(`UPDATE public.cockpit_campaigns SET client_name='Campaign Name incorrectly imported',raw_data=raw_data||'{"clientName":"Client A"}' WHERE id=1;`);await actor(db,buyer);
  expect((await db.query<any>(`SELECT public.cockpit_media_scope('control.setStatus','A') AS s`)).rows[0].s.client).toBe('Client A');
  await expect(db.query(`SELECT public.cockpit_media_scope('control.setStatus','B')`)).rejects.toThrow('access list');
  await expect(db.query(`SELECT public.cockpit_media_scope('ceo.b2bControl.setStatus',NULL)`)).rejects.toThrow('Founder');
  await expect(db.query('SELECT * FROM public.cockpit_media_actions')).rejects.toThrow('permission');
  await actor(db,outsider);await expect(db.query(`SELECT public.cockpit_media_scope('control.setStatus','A')`)).rejects.toThrow('Media buyer');
  await owner(db);await db.exec(`UPDATE public.cockpit_members SET active=false WHERE auth_user_id='${buyer}'`);await actor(db,buyer);
  await expect(db.query(`SELECT public.cockpit_media_scope('control.setStatus','A')`)).rejects.toThrow('confirmed membership');
  await owner(db);
  await db.query(`INSERT INTO public.cockpit_media_actions(id,actor_id,operation,campaign_name,request) VALUES($1,$2,'board.setAdStatus','A','{"args":{"status":"Paused"}}')`,[buyer,buyer]);
  await db.query(`SELECT public.cockpit_finish_media_action($1,'{"ok":true}','{}')`,[buyer]);
  expect((await db.query<any>('SELECT raw_data FROM public.cockpit_campaigns WHERE id=1')).rows[0].raw_data.boardAdStatus).toBe('Paused');
  expect((await db.query<any>('SELECT count(*)::int AS n FROM public.cockpit_audit_log')).rows[0].n).toBe(1);
  await expect(db.query(`UPDATE public.cockpit_media_actions SET result='{}' WHERE id=$1`,[buyer])).rejects.toThrow('immutable');
 } finally {await db.close();}
},20000);
