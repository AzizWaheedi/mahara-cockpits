import {expect,test} from 'bun:test';
import {actor,cockpitTestDb,member,migration,owner} from './lib/cockpitTestDb';
import {snapshotContext,buildRoster,buildDetail,buildScripts,buildCalendar,buildScriptQueue,buildSnapshot} from '../../creative-director-cockpit/src/lib/creativeSourceModels';
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
const tables:Record<string,any[]>={clients:[{_id:'client-a',taskId:'a',name:'Alpha',aliases:['alpha'],clientStatus:'active'}],creativeTasks:[{_id:'task-a',taskId:'task-a',kind:'script',name:'Actual finished script',client:'Alpha',clients:['Alpha'],status:'complete',script:'Human script text',assignees:[],createdAt:1,updatedAt:2},{_id:'task-b',taskId:'task-b',kind:'script',name:'Actual undated request',client:'Alpha',clients:['Alpha'],status:'new',assignees:[],createdAt:3}],videoJobs:[{_id:'video-a',taskId:'video-a',name:'Real video',client:'Alpha',clients:['Alpha'],status:'internal review',editors:[],createdAt:4}],contentPosts:[],touchLog:[],campaigns:[],ads:[],metaTree:[],funnels:[],winnersArchive:[],marketPlays:[],blueprints:[]};
test('original read computations use real script/video records and leave missing dates/health unknown',async()=>{
 const ctx=snapshotContext(tables);const roster=await buildRoster(ctx,null);
 expect(roster.clients[0].openScripts).toBe(1);expect(roster.clients[0].openVideos).toBe(1);expect(roster.clients[0].hisMove).toBe(1);expect(roster.clients[0].happiness).toBeUndefined();
 const scripts=await buildScripts(ctx,{});expect(scripts.rows).toHaveLength(1);expect(scripts.rows[0].script).toBe('Human script text');
 const calendar=await buildCalendar(ctx,null);expect(calendar.unplanned.some((r:any)=>r.taskId==='task-b'&&r.day===null)).toBe(true);
 const detail=await buildDetail(ctx,'Alpha',null);expect(detail.stats).toBeNull();expect(detail.videos).toHaveLength(1);expect(detail.liveNow).toHaveLength(0);
 const queue=await buildScriptQueue(ctx,null);expect(queue).toBeDefined();
 const dashboard=await buildSnapshot(snapshotContext({...tables,checks:[],planItems:[],eodReports:[]}),null);
 expect(dashboard.counts.scripts).toBe(1);expect(dashboard.counts.videos).toBe(1);expect(dashboard.blueprintsTracked).toBe(false);
});
test('unverified feeds fail closed, rows filter on server, and client actions use real audited records',async()=>{
 const db=await cockpitTestDb();try{
 const allowed=migration('20260926m_cockpit_csm_state.sql').match(/CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed[\s\S]*?END \$\$;/)![0];await db.exec(allowed);
 await db.exec(migration('20260927s_creative_read_models.sql'));
 await member(db,A,'creative@tests.invalid',['creative']);await member(db,B,'other@tests.invalid',['creative']);
 await db.exec(`UPDATE cockpit_members SET clients=ARRAY['Alpha'] WHERE auth_user_id='${A}';UPDATE cockpit_members SET clients=ARRAY['Beta'] WHERE auth_user_id='${B}';`);
 await actor(db,A);await expect(db.query('SELECT cockpit_creative_source_read()')).rejects.toThrow('not verified');
 await owner(db);
 for(const [table,rows]of Object.entries(tables)){for(const row of rows)await db.query("INSERT INTO cockpit_creative_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES($1,$2,$3,$4,'2026-09-27T00:00:00Z')",[table,row._id,['Alpha'],row]);await db.query("UPDATE cockpit_creative_source_state SET ready=true,row_count=$2,source_snapshot_at='2026-09-27T00:00:00Z' WHERE table_name=$1",[table,rows.length]);}
 await db.query("INSERT INTO cockpit_creative_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('clients','retired-source-id',ARRAY['Alpha'],'{\"_id\":\"retired-source-id\",\"name\":\"Old source row\"}','2026-09-26T00:00:00Z')");
 await actor(db,A);expect((await db.query<any>('SELECT cockpit_creative_source_read() v')).rows[0].v.tables.videoJobs).toHaveLength(1);
 expect((await db.query<any>('SELECT cockpit_creative_source_read() v')).rows[0].v.tables.clients).toHaveLength(1);
 await db.query('SELECT cockpit_creative_client_action($1,$2)',['touch',{client:'Alpha',note:'Actual call'}]);
 expect((await db.query<any>('SELECT cockpit_creative_source_read() v')).rows[0].v.tables.touchLog).toHaveLength(1);
 await db.query('SELECT cockpit_creative_client_action($1,$2)',['queue',{kind:'comment',taskId:'task-a',payload:{text:'Reviewer note'}}]);
 const outbox=(await db.query<any>("SELECT cockpit_creative_client_action('outbox','{}') v")).rows[0].v;expect(outbox[0].state).toBe('pending');expect(outbox[0].by).toBe('creative@tests.invalid');
 await actor(db,B);expect((await db.query<any>('SELECT cockpit_creative_source_read() v')).rows[0].v.tables.clients).toEqual([]);
 await expect(db.query('SELECT cockpit_creative_client_action($1,$2)',['queue',{kind:'complete',taskId:'task-a',payload:{}}])).rejects.toThrow('outside');
 await expect(db.query('SELECT cockpit_creative_client_action($1,$2)',['touch',{client:'Alpha'}])).rejects.toThrow('assigned');
 await owner(db);await db.exec(`UPDATE cockpit_members SET clients='{}' WHERE auth_user_id='${B}'`);await actor(db,B);
 expect((await db.query<any>('SELECT cockpit_creative_source_read() v')).rows[0].v.tables.clients).toHaveLength(1);
 await owner(db);await db.exec(`UPDATE cockpit_members SET roles=ARRAY['sales'] WHERE auth_user_id='${B}'`);await actor(db,B);
 await expect(db.query('SELECT cockpit_creative_source_read()')).rejects.toThrow('creative access');
 await owner(db);expect((await db.query<any>("SELECT count(*)::int n FROM cockpit_creative_sources WHERE table_name='clients'")).rows[0].n).toBe(2);
 await db.exec("UPDATE cockpit_creative_source_state SET row_count=999 WHERE table_name='clients'");await actor(db,A);
 await expect(db.query('SELECT cockpit_creative_source_read()')).rejects.toThrow('row count');
 }finally{await db.close();}
});

// The Brand Blueprint sign-off (docs/brand-blueprint SPEC.md 4.2 and 7.1): it reads the record's parts,
// the offer row turns orange after 48 hours, and "not tracked" means only that the read failed.
const H=3_600_000,NOW=Date.parse('2026-10-24T09:00:00Z');
const iso=(hoursAgo:number)=>new Date(NOW-hoursAgo*H).toISOString();
const bpTables=(blueprints:any[])=>snapshotContext({...tables,
 clients:[{_id:'card-a',taskId:'card-a',name:'Alpha',aliases:['alpha'],clientStatus:'Launch Booked',onboardingCallDate:Date.parse('2026-10-14T09:00:00Z'),offerCheatSheet:'https://docs.google.com/document/d/example/edit'},{_id:'card-b',taskId:'card-b',name:'Beta',aliases:['beta'],clientStatus:'Launch Booked',onboardingCallDate:Date.parse('2026-10-14T09:00:00Z')}],
 creativeTasks:[...tables.creativeTasks,{_id:'task-c',taskId:'task-c',kind:'script',name:'Beta script',client:'Beta',clients:['Beta'],status:'new',assignees:[],createdAt:5}],
 blueprints,checks:[],planItems:[],eodReports:[]});
const bpRow=(taskId:string,client:string,parts:Record<string,string>,extra:any={})=>({_id:taskId,taskId,client,parts:Object.fromEntries(Object.entries(parts).map(([k,at])=>[k,{at}])),offerLine:null,approval:'first_batch',dnaStatus:'small_gaps',dnaMissing:'The colour codes',...extra});
const step=(snap:any,client:string)=>snap.clients.find((c:any)=>c.client===client).onboardingSteps.find((s:any)=>s.key==='blueprint');
test('the Brand Blueprint sign-off reads the parts: done only when the call is closed and the offer locked',async()=>{
 const snap=await buildSnapshot(bpTables([bpRow('card-a','Alpha',{'1':iso(30),'2':iso(29.5),'3':iso(2)}),bpRow('card-b','Beta',{'1':iso(20),'2':iso(19.4)})]),null,{blueprintsTracked:true,now:NOW});
 const a=snap.clients.find((c:any)=>c.client==='Alpha'),b=snap.clients.find((c:any)=>c.client==='Beta');
 expect(step(snap,'Alpha')).toMatchObject({label:'Brand Blueprint',done:true,tracked:true});
 expect(step(snap,'Alpha').note).toBe('Starter ads sent 23 Oct · call closed · offer locked 24 Oct');
 expect(a.blueprintDone).toBe(true);expect(a.offerWaiting).toBeNull();
 expect(step(snap,'Beta').done).toBe(false);expect(step(snap,'Beta').note).toBe('Starter ads sent 23 Oct · call closed · offer waiting');
 expect(b.offerWaiting).toMatchObject({late:false});expect(b.approvalNeeded).toBe('The first batch, then we run');expect(b.brandDnaStatus).toBe('Small gaps');expect(b.stillMissing).toBe('The colour codes');
 expect(snap.offersWaiting.map((o:any)=>o.client)).toEqual(['Beta']);expect(snap.blueprintsTracked).toBe(true);
 // The gap the call noted sits on the Brand DNA step, never as a ticked step above a separate warning.
 const dna=b.onboardingSteps.find((s:any)=>s.key==='brandDna');
 expect(dna).toMatchObject({done:true,gap:true,note:'Task closed. The Blueprint call noted it still needs: The colour codes'});
 expect(a.onboardingSteps.find((s:any)=>s.key==='offer').label).toBe('Offer sheet finished');
});
test('the offer row turns orange 48 hours after the call closed, the longest wait first',async()=>{
 const snap=await buildSnapshot(bpTables([bpRow('card-a','Alpha',{'1':iso(50),'2':iso(49)}),bpRow('card-b','Beta',{'1':iso(48),'2':iso(47.5)})]),null,{blueprintsTracked:true,now:NOW});
 expect(snap.offersWaiting.map((o:any)=>[o.client,o.late])).toEqual([['Alpha',true],['Beta',false]]);
 expect(step(snap,'Alpha').note).toBe('Starter ads sent 22 Oct · call closed · offer waiting 2 days');
 expect(snap.offersWaiting[0].offerSheet).toBe('https://docs.google.com/document/d/example/edit');
});
test('"not tracked" only when the read failed; a read with no rows says what is expected',async()=>{
 const failed=await buildSnapshot(bpTables([]),null,{now:NOW});
 expect(step(failed,'Alpha')).toMatchObject({done:false,tracked:false,note:'Could not read the Blueprint. Open their page to see it.'});
 // The offer step is open (no checklist on the board); an untracked Blueprint is not counted.
 expect(failed.clients.find((c:any)=>c.client==='Alpha').onboardingOpen).toBe(1);
 const empty=await buildSnapshot(bpTables([]),null,{blueprintsTracked:true,now:NOW});
 expect(step(empty,'Alpha')).toMatchObject({done:false,tracked:true});
 expect(step(empty,'Alpha').note).toBe('Not started. Run the Blueprint call from their page.');
 expect(empty.clients.find((c:any)=>c.client==='Alpha').onboardingOpen).toBe(2);
 // Rows a failed read could not have returned are never scored.
 const stale=await buildSnapshot(bpTables([bpRow('card-a','Alpha',{'1':iso(3),'2':iso(2),'3':iso(1)})]),null,{now:NOW});
 expect(step(stale,'Alpha').done).toBe(false);expect(stale.offersWaiting).toEqual([]);
});
// The creative cockpit mirrors the server's part rules (an app cannot import the deck's registry), so
// all three run on the same answers here: cockpit_blueprint_missing in PGlite against the creative
// cockpit's blueprint.ts missing() and the deck registry's blueprintForm.ts missing() (SPEC 7.1).
test('the creative cockpit\'s and the deck\'s missing() equal cockpit_blueprint_missing on 20 answer sets',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');const {missing,partAnswers}=await import('../../creative-director-cockpit/src/lib/blueprint');
 const {missing:csMissing,partAnswers:csPartAnswers}=await import('../../client-success-cockpit/src/present/blueprintForm');
 const sql=migration('20261024a_brand_blueprints.sql');
 const db=new PGlite();try{
  for(const name of ['cockpit_blueprint_part_answers','cockpit_blueprint_missing'])await db.exec(sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?END \\$\\$;`))![0]);
  const p1={service:'interior',capacity:'yes',starter:'yes',pack_url:'https://drive.google.com/drive/folders/1ExamplePack000001',pack_approval:'on_call',daily_budget:{usd:40},destination:'lead_form',identity:'their_page'};
  const p2={best_client:'Villa owners',method:'We measure first',pricing:'Per floor',minimum:{amount:8000,currency:'KWD'},anchor:{amount:25000,currency:'KWD'},competitors:[{name:'Rival',lose:true}],approval:'every',dna_status:'complete',rules:{never:['No discounts']},camera:'no',readback_yes:true};
  const sets:[number,any][]=[[1,{}],[1,p1],[1,{...p1,capacity:'tight'}],[1,{...p1,capacity:'no',capacity_note:'Two crews only'}],[1,{...p1,starter:'no',pack_url:undefined,pack_approval:undefined}],[1,{...p1,pack_approval:'wants_changes'}],[1,{...p1,pack_approval:'wants_changes',pack_changes:'Swap the second ad'}],[1,{...p1,starter:'yes',pack_url:undefined}],[1,{service:'interior'}],[1,{...p1,daily_budget:undefined,identity:undefined}],
   [2,{}],[2,p2],[2,{...p2,dna_status:'small_gaps'}],[2,{...p2,dna_status:'big_gaps',dna_missing:'Logo files'}],[2,{...p2,readback_yes:undefined,rules:undefined}],[2,{...p2,competitors:undefined,dna_status:undefined}],
   [3,{}],[3,{offer:{name:'The refresh',what:'One floor in ten weeks'}}],[3,{offer:{name:'The refresh',what:'One floor',firstStep:'A free site visit'}}],[3,{offer:{name:'The refresh',what:'One floor',firstStep:'A free site visit'},scripts_status:'in_progress'}]];
  for(const [part,raw] of sets){
   const answers=JSON.parse(JSON.stringify(raw));
   const server=(await db.query<any>('SELECT public.cockpit_blueprint_missing($1,$2::jsonb) m, public.cockpit_blueprint_part_answers($1,$2::jsonb) a',[part,answers])).rows[0];
   expect(missing(part as 1|2|3,answers)).toEqual(server.m);
   expect(partAnswers(part as 1|2|3,answers)).toEqual(server.a);
   expect(csMissing(part as 1|2|3,answers)).toEqual(server.m);
   expect(csPartAnswers(part as 1|2|3,answers)).toEqual(server.a);
  }
 }finally{await db.close();}
});
test('the client week the media sync puts on the client card reaches the dashboard through the read, and nothing marked is no show rate',async()=>{
 const db=await cockpitTestDb();try{
 const allowed=migration('20260926m_cockpit_csm_state.sql').match(/CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed[\s\S]*?END \$\$;/)![0];await db.exec(allowed);
 await db.exec(migration('20260927s_creative_read_models.sql'));
 await member(db,A,'creative@tests.invalid',['creative']);await db.exec(`UPDATE cockpit_members SET clients=ARRAY['Alpha'] WHERE auth_user_id='${A}'`);
 const ads7d={from:'2026-10-14',through:'2026-10-20',accounts:['290802986'],spend:174.53,leads:5,offBoardSpend:0,bookings:4,costPerBooking:43.63,showed:0,noShows:0,due:4,campaigns:[{campaignName:'Alpha 7\\10',spend:163.75,leads:5,bookings:3,live:true},{campaignName:'Alpha 13\\9',spend:10.78,leads:0,bookings:1,live:false}],source:'media sync'};
 const rows:Record<string,any[]>={...tables,clients:[{...tables.clients[0],ads7d}],campaigns:[{_id:'camp-a',campaignName:'Alpha 7\\10',clientName:'Alpha',metaAccountId:'act_290802986',spend7d:174.54,leads7d:5,bookings7d:3,showed7d:0}],ads:[{_id:'ad-a',campaignName:'Alpha 7\\10',adName:'ad-1',spend:174.54,leads:5}]};
 await owner(db);
 for(const [table,list]of Object.entries(rows)){for(const row of list)await db.query("INSERT INTO cockpit_creative_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES($1,$2,$3,$4,'2026-10-22T00:00:00Z')",[table,row._id,['Alpha'],row]);await db.query("UPDATE cockpit_creative_source_state SET ready=true,row_count=$2,source_snapshot_at='2026-10-22T00:00:00Z' WHERE table_name=$1",[table,list.length]);}
 await actor(db,A);const read=(await db.query<any>('SELECT cockpit_creative_source_read() v')).rows[0].v;
 expect(read.tables.clients[0].ads7d.bookings).toBe(4);
 const dashboard=await buildSnapshot(snapshotContext({...read.tables,checks:[],planItems:[],eodReports:[]}),new Set(['alpha']));
 const alpha=dashboard.clients.find((c:any)=>c.client==='Alpha');
 expect(alpha.performance.source).toBe('media sync');expect(alpha.bookings7d).toBe(4);expect(alpha.costPerBooking).toBe(43.63);expect(alpha.showRate).toBeNull();expect(alpha.performance.stoppedCampaigns).toBe(1);
 expect(dashboard.showDataAvailable).toBeUndefined();
 }finally{await db.close();}
});
