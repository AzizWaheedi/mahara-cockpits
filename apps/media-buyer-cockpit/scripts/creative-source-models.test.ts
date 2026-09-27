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
