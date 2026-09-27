import {expect,test} from 'bun:test';
import {actor,cockpitTestDb,member,migration,owner} from './lib/cockpitTestDb';
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
async function fixture(){
 const db=await cockpitTestDb();
 await db.exec(`CREATE TABLE cockpit_campaigns(client_name text,raw_data jsonb);
 CREATE TABLE winner_ads(ad_id text PRIMARY KEY,ad_name text,client text,spend numeric,leads int,cpl numeric,origin text,first_seen_at timestamptz,last_seen_at timestamptz,transcript text);
 ALTER TABLE winner_ads ENABLE ROW LEVEL SECURITY;GRANT SELECT ON winner_ads TO authenticated;
 CREATE POLICY fixture_winner_read ON winner_ads FOR SELECT TO authenticated USING(true);`);
 const allowed=migration('20260926m_cockpit_csm_state.sql').match(/CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed[\s\S]*?END \$\$;/)![0];await db.exec(allowed);
 await db.exec(migration('20260927j_cockpit_media_statistics.sql'));
 await db.exec(migration('20260927q_cockpit_winner_saves.sql'));
 await member(db,A,'buyer@tests.invalid',['media_buyer']);await member(db,B,'other@tests.invalid',['media_buyer']);
 await db.exec(`UPDATE cockpit_members SET clients=ARRAY['Alpha'] WHERE auth_user_id='${A}';UPDATE cockpit_members SET clients=ARRAY['Beta'] WHERE auth_user_id='${B}';
 INSERT INTO cockpit_campaigns VALUES('Alpha','{"campaignName":"Alpha campaign"}');
 UPDATE cockpit_media_feed_state SET ready=true;UPDATE cockpit_winner_save_state SET history_ready=true;
 INSERT INTO cockpit_media_daily_stats(source_deployment,source_id,campaign_name,day,data) VALUES('test','one','Alpha campaign','2026-09-20','{"campaignName":"Alpha campaign","date":"2026-09-20","metaAdId":"123456","adName":"Ad","spend":100,"leads":10,"impressions":2000,"linkClicks":100}');
 INSERT INTO cockpit_media_booking_events(source_deployment,source_id,campaign_name,day,data) VALUES('test','booking','Alpha campaign','2026-09-20','{"campaignName":"Alpha campaign","date":"2026-09-20","adId":"123456","status":"showed"}');`);
 await actor(db,A);return db;
}
const args={campaignName:'Alpha campaign',adId:'123456',adName:'Ad',start:'2026-09-24',end:'2026-09-27',note:'Human note',spend:999999};
test('winner preview widens zero-lead range and save freezes server metrics; retries and unsaves preserve audit',async()=>{
 const db=await fixture();try{
 const preview=(await db.query<any>('SELECT cockpit_winner_preview($1) v',[args])).rows[0].v;
 expect(preview.widened).toBe(true);expect(preview.stats.spend).toBe(100);expect(preview.stats.cpl).toBe(10);expect(preview.stats.bookings).toBe(1);
 await db.query('SELECT cockpit_winner_save($1)',[args]);await db.query('SELECT cockpit_winner_save($1)',[args]);
 const saved=(await db.query<any>("SELECT cockpit_winner_saved_in(ARRAY['123456']) v")).rows[0].v;
 expect(saved['123456'].saved).toBe(true);expect(saved['123456'].auto).toBe(false);
 await owner(db);
 expect((await db.query<any>('SELECT note,stats FROM cockpit_winner_saves')).rows[0]).toMatchObject({note:'Human note',stats:{spend:100}});
 expect((await db.query<any>("SELECT count(*)::int n FROM cockpit_audit_log WHERE entity_type='winner_save'")).rows[0].n).toBe(1);
 await actor(db,A);await db.query("SELECT cockpit_winner_unsave('123456')");await db.query("SELECT cockpit_winner_unsave('123456')");
 expect((await db.query<any>('SELECT * FROM winner_ads')).rows).toEqual([]);
 await owner(db);expect((await db.query<any>('SELECT count(*)::int n FROM winner_ads')).rows[0].n).toBe(1);
 expect((await db.query<any>("SELECT count(*)::int n FROM cockpit_audit_log WHERE entity_type='winner_save'")).rows[0].n).toBe(2);
 }finally{await db.close();}
});
test('existing automated winner and human capture are preserved; access and source-history gates enforce',async()=>{
 const db=await fixture();try{
 await owner(db);await db.exec("INSERT INTO winner_ads(ad_id,ad_name,client,origin,transcript,spend) VALUES('123456','Existing','Alpha','auto','Human transcript',44)");
 await actor(db,A);await db.query('SELECT cockpit_winner_save($1)',[args]);await db.query("SELECT cockpit_winner_unsave('123456')");
 expect((await db.query<any>("SELECT ad_name,transcript,spend FROM winner_ads WHERE ad_id='123456'")).rows[0]).toEqual({ad_name:'Existing',transcript:'Human transcript',spend:'44'});
 await actor(db,B);await expect(db.query('SELECT cockpit_winner_preview($1)',[args])).rejects.toThrow('assigned clients');
 await expect(db.query("SELECT cockpit_winner_unsave('123456')")).rejects.toThrow('assigned clients');
 await owner(db);await db.exec('UPDATE cockpit_winner_save_state SET history_ready=false');await actor(db,A);
 await expect(db.query('SELECT cockpit_winner_save($1)',[args])).rejects.toThrow('history');
 await owner(db);await db.exec("UPDATE cockpit_media_feed_state SET ready=false WHERE feed='dailyStats'");await actor(db,A);
 await expect(db.query('SELECT cockpit_winner_preview($1)',[args])).rejects.toThrow('histories');
 }finally{await db.close();}
});
