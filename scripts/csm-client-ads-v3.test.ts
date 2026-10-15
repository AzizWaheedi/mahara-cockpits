import {afterAll,beforeAll,describe,expect,test} from 'bun:test';
import {actor,member,migration,owner} from '../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';
import {nativeFeedDb} from './lib/nativeFeedDb';

// The client page's Ads tab (Aziz, 2026-10-13): cockpit_csm_client_ads v3
// adds what the media buyer's board says about each campaign, read only, and
// keeps the client gate and every key of 20261012d. Canonical SQL throughout;
// only the rows are fixtures.

// CSM covers Atlantis only, OTHER covers Beta only, LEAD covers every client
// (as every live CSM seat does today), BUYER is a media buyer with no csm role.
const CSM='70000000-0000-4000-8000-000000000001',OTHER='70000000-0000-4000-8000-000000000002';
const LEAD='70000000-0000-4000-8000-000000000003',BUYER='70000000-0000-4000-8000-000000000004';
const SIG='public.cockpit_csm_client_ads(text,date,date)';
type Json=Record<string,any>;
let db:Awaited<ReturnType<typeof nativeFeedDb>>;
let before:Json;

const FINDINGS=[
 {constraint:'Creative age',severity:'optimization',evidence:'Live 29 days at $9.74 CPL — still working.',fixes:['Queue a refresh.','Keep the winner running.']},
 {constraint:'Room to scale',severity:'optimization',evidence:'$9.74 a day under the $30 floor.',fixes:['Raise the budget.']},
];
const campaign=(id:string,client:string,name:string,deleted:boolean,extra:Json)=>db.query(
 `INSERT INTO cockpit_campaigns(client_name,source_deployment,source_id,source_deleted,raw_data) VALUES($1,'test',$2,$3,$4)`,
 [client,id,deleted,JSON.stringify({campaignName:name,clientName:client,accountName:`${client} ads`,metaCampaignId:`9${id.length}`,
  metaAccountId:'act_1',currency:'USD',budgetDaily:20,budgetLevel:'campaign',...extra})]);
async function read(who:string|null,task:string){
 await actor(db,who);
 try{return (await db.query<{v:Json}>('SELECT cockpit_csm_client_ads($1,$2::date,$3::date) v',[task,'2026-10-01','2026-10-12'])).rows[0].v;}
 finally{await owner(db);}
}

beforeAll(async()=>{
 db=await nativeFeedDb();
 const gate=migration('20261006c_csm_onboarding_checkins.sql').match(/CREATE FUNCTION public\.cockpit_csm_client_gate_for_actor[\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_csm_client_gate\(text\) TO authenticated;/)?.[0];
 if(!gate)throw new Error('Canonical client gate missing');await db.exec(gate);
 const changes=migration('20261011c_csm_call_store.sql').match(/CREATE TABLE IF NOT EXISTS public\.cockpit_csm_changes\([\s\S]*?\n\);/)?.[0];
 if(!changes)throw new Error('Canonical change table missing');await db.exec(changes);
 for(const name of ['20261012c_csm_client_ads.sql','20261012d_csm_client_ads_feed_last.sql'])await db.exec(migration(name));
 await member(db,CSM,'csm@tests.invalid',['csm']);await member(db,OTHER,'other@tests.invalid',['csm']);
 await member(db,LEAD,'lead@tests.invalid',['csm']);await member(db,BUYER,'buyer@tests.invalid',['media_buyer']);
 await db.query('UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2',[['Atlantis Contracting'],CSM]);
 await db.query('UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2',[['Beta'],OTHER]);
 await db.exec(`UPDATE cockpit_csm_source_state SET ready=true,row_count=2,source_snapshot_at=now() WHERE table_name='clients';
  INSERT INTO cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) SELECT 'clients','atl',ARRAY['Atlantis Contracting'],'{"_id":"atl","name":"Atlantis Contracting","taskId":"cu-atl"}',source_snapshot_at FROM cockpit_csm_source_state WHERE table_name='clients';
  INSERT INTO cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) SELECT 'clients','beta',ARRAY['Beta'],'{"_id":"beta","name":"Beta","taskId":"cu-beta"}',source_snapshot_at FROM cockpit_csm_source_state WHERE table_name='clients';
  UPDATE cockpit_media_feed_state SET ready=true,source_snapshot_at=now() WHERE feed IN('dailyStats','bookingEvents');`);
 const lost={total:7,byAd:{'52511354088716':4,'52511360552116':'2.0'},reasons:[{reason:'Unreachable',count:7}]};
 await campaign('a1','Atlantis Contracting','Atlantis-mahara-13\\9',false,{verdict:'scale',reason:'$23 a booking, inside the gates.',findings:FINDINGS,boardAdStatus:'Live',daysLive:29,lost});
 // An ended copy whose board fields came through malformed: each one reads as null.
 await campaign('a0','Atlantis Contracting','Atlantis-mahara-1\\9',true,{verdict:'',findings:'not a list',daysLive:'29',lost:{byAd:[1,2]}});
 await campaign('b1','Beta','Beta | Leads',false,{verdict:'kill',findings:[],boardAdStatus:'Paused',daysLive:3});
 await db.query(`INSERT INTO cockpit_media_daily_stats(source_deployment,source_id,campaign_name,day,data) VALUES('test','d1',$1,'2026-10-05',$2)`,
  ['Atlantis-mahara-13\\9',JSON.stringify({campaignName:'Atlantis-mahara-13\\9',date:'2026-10-05',spend:20,leads:2,impressions:900,linkClicks:9,metaAdId:'52511354088716',adName:'Villa reel',adSetName:'Leads'})]);
 before=await read(LEAD,'cu-atl');
 await db.exec(migration('20261013180100_csm_client_ads_v3.sql'));
});
afterAll(async()=>{await db.close();});

describe('20261013180100: the Ads tab read',()=>{
 test('a CSM seat reads its own client, with the board\'s keys on each campaign',async()=>{
  const v=await read(CSM,'cu-atl');
  expect(v.clientName).toBe('Atlantis Contracting');
  const live=v.campaigns.find((c:Json)=>c.name==='Atlantis-mahara-13\\9');
  expect(live).toMatchObject({ended:false,verdict:'scale',reason:'$23 a booking, inside the gates.',boardAdStatus:'Live',daysLive:29,
   lostByAd:{'52511354088716':4,'52511360552116':'2.0'}});
  expect(live.findings).toEqual(FINDINGS);
  const ended=v.campaigns.find((c:Json)=>c.name==='Atlantis-mahara-1\\9');
  expect(ended).toMatchObject({ended:true,verdict:null,findings:null,daysLive:null,lostByAd:null,boardAdStatus:null});
  expect(v.rows).toHaveLength(1);
 });

 test('every key of 20261012d comes back the same; only the board keys are new',async()=>{
  const v=await read(LEAD,'cu-atl');
  const strip=(x:Json)=>{const {at:_,...rest}=x;return rest;};
  const added=['verdict','reason','findings','boardAdStatus','daysLive','lostByAd'];
  expect(Object.keys(v).sort()).toEqual(Object.keys(before).sort());
  expect(v.campaigns.map((c:Json)=>Object.fromEntries(Object.entries(c).filter(([k])=>!added.includes(k)))))
   .toEqual(before.campaigns);
  for(const c of v.campaigns)expect(Object.keys(c)).toEqual(expect.arrayContaining(added));
  for(const c of before.campaigns)for(const k of added)expect(c).not.toHaveProperty(k);
  expect({...strip(v),campaigns:null}).toEqual({...strip(before),campaigns:null});
 });

 test('the same seat is refused another client, and a seat whose list excludes it too',async()=>{
  await expect(read(CSM,'cu-beta')).rejects.toMatchObject({code:'42501'});
  await expect(read(CSM,'cu-beta')).rejects.toThrow('That client is not on your access list');
  await expect(read(OTHER,'cu-atl')).rejects.toThrow('That client is not on your access list');
  expect((await read(OTHER,'cu-beta')).campaigns.map((c:Json)=>c.verdict)).toEqual(['kill']);
  expect((await read(LEAD,'cu-beta')).campaigns[0]).toMatchObject({boardAdStatus:'Paused',daysLive:3,findings:[],lostByAd:null});
 });

 test('an outsider, a signed-out caller and the service role are refused',async()=>{
  await expect(read(BUYER,'cu-atl')).rejects.toThrow('Current confirmed client-success access is required');
  await expect(read(null,'cu-atl')).rejects.toThrow(/permission denied/);
  await db.exec('SET ROLE service_role');
  try{await expect(db.query("SELECT cockpit_csm_client_ads('cu-atl','2026-10-01','2026-10-12')")).rejects.toThrow(/permission denied/);}
  finally{await owner(db);}
 });

 test('it stays a read: stable, definer, empty search path, authenticated only',async()=>{
  const p=(await db.query<Json>(`SELECT provolatile,prosecdef,proconfig,prosrc FROM pg_proc WHERE oid=$1::regprocedure`,[SIG])).rows[0];
  expect(p.provolatile).toBe('s');expect(p.prosecdef).toBe(true);
  expect(p.proconfig).toEqual(['search_path=""']);
  expect(p.prosrc).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
  const can=async(role:string)=>(await db.query<{ok:boolean}>(`SELECT has_function_privilege($1,$2,'EXECUTE') ok`,[role,SIG])).rows[0].ok;
  expect(await can('authenticated')).toBe(true);
  expect(await can('anon')).toBe(false);
  expect(await can('service_role')).toBe(false);
 });
});
