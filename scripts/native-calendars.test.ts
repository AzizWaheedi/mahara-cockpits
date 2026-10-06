import {afterEach,beforeEach,describe,expect,test} from 'bun:test';
import {randomUUID,createHash} from 'node:crypto';
import {nativeFeedDb} from './lib/nativeFeedDb';
import {actor,member,migration,owner} from '../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';
import type {Row} from '../hermes/cockpit-sync/runtime';
let db:Awaited<ReturnType<typeof nativeFeedDb>>;
const CSM='20000000-0000-4000-8000-000000000001',CREATIVE='20000000-0000-4000-8000-000000000002',MB='20000000-0000-4000-8000-000000000003';
beforeEach(async()=>{
 db=await nativeFeedDb();await db.exec(migration('20261005d_cockpit_client_calendars.sql'));
 for(const [id,email,role] of [[CSM,'csm@tests.invalid','csm'],[CREATIVE,'creative@tests.invalid','creative'],[MB,'buyer@tests.invalid','media_buyer']]){await member(db,id,email,[role]);await db.query('UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2',[['Alpha'],id]);}
});
afterEach(async()=>{await db.close();});
const overview=async(app:string)=> (await db.query<{value:Row}>('SELECT cockpit_calendar_overview($1) value',[app])).rows[0].value;
async function publish(empty=false){
 await owner(db);
 for(const family of ['media','csm','creative'])await db.exec(`UPDATE cockpit_${family}_source_state SET ready=true,row_count=0,source_snapshot_at=now()-interval '1 second'`);
 await db.exec("UPDATE cockpit_media_feed_state SET ready=true,source_rows=0,source_snapshot_at=now()-interval '1 second'");
 await db.exec('SET ROLE service_role');
 const s=(await db.query<{value:Row}>('SELECT cockpit_native_media_state() value')).rows[0].value;
 const now=Date.now(),stamp=new Date(now).toISOString(),today=new Date(now+10800000).toISOString().slice(0,10);
 const call=(id:string,client:string|undefined,calendar:string)=>({_id:id,apptId:id,calendarId:calendar.includes('Blueprint')?'blueprint':'checkin',calendar,title:`Call ${id}`,startTime:`${today}T09:00:00+03:00`,endTime:`${today}T10:00:00+03:00`,status:'confirmed',clientName:client,contactName:client});
 const appointments=empty?[]:[call('alpha-checkin','Alpha','Client Check-In'),call('alpha-blueprint','Alpha','Brand Blueprint'),call('beta-blueprint','Beta','Brand Blueprint'),call('unmatched',undefined,'Client Check-In')];
 const google=(id:string)=>({eventId:id,calendarId:'shared@calendar.example',title:id,start:`${today}T11:00:00+03:00`,end:`${today}T12:00:00+03:00`,allDay:false,kind:'client',clientName:'Alpha',attendees:[]});
 const plan:Row={producer:'media-core',version:1,begun_at:stamp,source_snapshot_at:stamp,working_day:today,window_since:today,expected:s.expected,
  tables:{...s.media,campaigns:s.oldCampaigns,ads:s.oldAds,winnersArchive:s.winners,adStills:s.stills,dailyStats:[],bookingEvents:[],checkProposals:[]},csm:{...s.csm,clients:[{_id:'client-alpha',name:'Alpha'},{_id:'client-beta',name:'Beta'}],appointments,checks:[]},creative:{...s.creative,campaigns:s.oldCampaigns,ads:s.oldAds},counts:{},
  csmCalendar:{from:now-14*86400000,to:now+42*86400000,checkedAt:now,calendars:empty?[]:[{id:'checkin',name:'Client Check-In'},{id:'blueprint',name:'Brand Blueprint'}],eventIds:appointments.map(row=>row.apptId)},
  googleCalendars:Object.fromEntries(['client-success','creative'].map(app=>[app,empty?{configured:false,calendarIds:[],from:now-7*86400000,to:now+21*86400000,checkedAt:null,events:null}:{configured:true,calendarIds:['shared@calendar.example'],from:now-7*86400000,to:now+21*86400000,checkedAt:now,events:[google(`${app}-google`)]}]))};
 for(const [family,tables] of Object.entries({tables:plan.tables,csm:plan.csm,creative:plan.creative}) as [string,Record<string,Row[]>][])for(const [key,rows] of Object.entries(tables))plan.counts[(family==='tables'?'':family+'_')+key]=rows.length;
 const claim=(await db.query<{value:Row}>('SELECT cockpit_native_media_claim($1) value',[randomUUID()])).rows[0].value;
 const sha=createHash('sha256').update(JSON.stringify(plan)).digest('hex');
 await db.query('SELECT cockpit_native_media_publish($1,$2,$3,$4,$5)',[claim.run_id,claim.lease_token,plan,sha,[]]);return plan;
}
describe('native calendar consumer contract',()=>{
 test('preserves original app distribution, explicit Google calendars and client scope',async()=>{
  await publish();await actor(db,CSM);const csm=await overview('client-success');
  expect(csm.today.map((event:Row)=>event.eventId)).toEqual(['alpha-checkin','alpha-blueprint','client-success-google']);expect(csm.calendarReady).toBe(true);expect(csm.sourceNote).toContain('verified client match');
  await actor(db,CREATIVE);const creative=await overview('creative');expect(creative.today.map((event:Row)=>event.eventId)).toEqual(['alpha-blueprint','creative-google']);
  await actor(db,MB);const buyer=await overview('media-buyer');expect(buyer.today).toEqual([]);expect(buyer.calendarConfigured).toBe(false);expect(buyer.sourceNote).toContain('Connect');
 });
 test('verified provider empty is distinct from a missing feed or Google configuration',async()=>{
  await actor(db,CSM);const missing=await overview('client-success');expect(missing.calendarReady).toBe(false);expect(missing.syncedAt).toBeNull();expect(missing.calendarSources).toContainEqual({provider:'ghl',configured:null,checkedAt:null,calendars:null});
  await publish(true);await actor(db,CSM);const empty=await overview('client-success');expect(empty.calendarReady).toBe(true);expect(empty.today).toEqual([]);expect(empty.calendarSources).toContainEqual({provider:'google',configured:false,checkedAt:null,calendars:null});
  expect(empty.calendarSources.find((source:Row)=>source.provider==='ghl').calendars).toBe(0);
 });
 test('a changed source row with unchanged count and stamp cannot borrow a publication receipt',async()=>{
  await publish();await owner(db);await db.exec("UPDATE cockpit_csm_sources SET data=data||'{\"title\":\"Changed outside the published source\"}'::jsonb WHERE source_id='alpha-checkin'");await actor(db,CSM);
  const current=await overview('client-success');expect(current.calendarReady).toBe(false);expect(current.today.map((event:Row)=>event.eventId)).toEqual(['client-success-google']);expect(current.sourceNote).toContain('not published verified data');expect(current.syncedAt).toBeNull();
 });
 test('wrong role, unsupported app, anonymous and revoked seats never receive cached calendars',async()=>{
  await publish();await actor(db,MB);await expect(overview('client-success')).rejects.toThrow('seat');await expect(overview('sales')).rejects.toThrow('seat');
  await owner(db);await db.exec('SET ROLE anon');await expect(overview('creative')).rejects.toMatchObject({code:'42501'});
  await actor(db,CSM);await overview('client-success');await owner(db);await db.query('UPDATE cockpit_members SET active=false WHERE auth_user_id=$1',[CSM]);await actor(db,CSM);await expect(overview('client-success')).rejects.toThrow('seat');
 });
});
