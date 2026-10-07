import {expect,test} from 'bun:test';
import {actor,cockpitTestDb,member,migration,owner} from './lib/cockpitTestDb';
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
async function fixture(){
 const db=await cockpitTestDb(); await db.exec(schema);
 await db.exec(`CREATE TABLE foreplay_ads(id text,link_url text,name text,headline text,full_transcription text,publisher_platform jsonb,running_duration integer);
 CREATE TABLE winner_ads(ad_id text,client text,headline text,spend numeric,leads integer,cpl numeric);
 CREATE TABLE foreplay_boards(id text);
 CREATE TABLE cockpit_ads(meta_ad_id text,campaign_name text,ad_name text,synced_at timestamptz,spend numeric,leads numeric);
 CREATE TABLE cockpit_campaigns(client_name text,raw_data jsonb);`);
 await db.exec("CREATE FUNCTION public.is_editor() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;");
 const allowed=migration('20260926m_cockpit_csm_state.sql').match(/CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed[\s\S]*?END \$\$;/)![0]; await db.exec(allowed);
 await db.exec(migration('20260927p_cockpit_ideation_access.sql'));
 await member(db,A,'buyer@tests.invalid',['media_buyer']); await member(db,B,'sales@tests.invalid',['sales']); await actor(db,A);
 return db;
}
test('new cockpit member can use shared board; actor is derived and worker content protected',async()=>{
 const db=await fixture();try{
 await db.exec(`INSERT INTO ideation_posts(key,platform,url,origin,status,pasted_by,saved_by) VALUES('post','instagram','https://instagram.com/p/123','manual','queued','spoof','spoof')`);
 expect((await db.query<any>("SELECT pasted_by,saved_by FROM ideation_posts WHERE key='post'")).rows[0]).toEqual({pasted_by:'buyer@tests.invalid',saved_by:'buyer@tests.invalid'});
 await db.exec("UPDATE ideation_posts SET note='Human note',saved_note='Human note' WHERE key='post'");
 await expect(db.exec("UPDATE ideation_posts SET transcript='Forged capture' WHERE key='post'")).rejects.toThrow('worker-owned');
 await expect(db.exec("UPDATE ideation_posts SET status='saved' WHERE key='post'")).rejects.toThrow('not saved');
 await owner(db);expect((await db.query<any>("SELECT count(*)::int n FROM cockpit_audit_log")).rows[0].n).toBe(2);
 await actor(db,B);expect((await db.query<any>('SELECT * FROM ideation_posts')).rows).toEqual([]);
 await expect(db.exec("INSERT INTO ideation_posts(key,platform,url,origin,status) VALUES('bad','instagram','https://instagram.com/x','manual','queued')")).rejects.toThrow('Active ideation');
 await owner(db);await db.exec(`UPDATE cockpit_members SET active=false WHERE auth_user_id='${A}'`);await actor(db,A);
 expect((await db.query<any>('SELECT * FROM ideation_posts')).rows).toEqual([]);
 }finally{await db.close();}
});
test('scrapes queue through existing worker table with no forged result or actor',async()=>{
 const db=await fixture();try{
 await db.exec(`INSERT INTO ideation_requests(id,kind,input,status,requested_by,result,attempts) VALUES('req','profile','instagram:example','queued','spoof','{"fake":true}',99)`);
 expect((await db.query<any>('SELECT requested_by,result,attempts FROM ideation_requests')).rows[0]).toEqual({requested_by:'buyer@tests.invalid',result:null,attempts:0});
 await expect(db.exec("UPDATE ideation_requests SET status='done' WHERE id='req'")).rejects.toThrow('permission denied');
 await actor(db,null);await owner(db);await db.exec("UPDATE ideation_requests SET status='done',result='{}' WHERE id='req'");
 await actor(db,A);expect((await db.query<any>('SELECT status FROM ideation_requests')).rows[0].status).toBe('done');
 }finally{await db.close();}
});
test('saved ad copies read canonical source and preserve human notes on retries',async()=>{
 const db=await fixture();try{
 await owner(db);
 await db.exec(`INSERT INTO foreplay_ads VALUES('f1','https://example.test/ad','Advertiser','Original caption','Real transcript','["instagram"]',12);
 INSERT INTO winner_ads VALUES('w1','Alpha','Winner caption',0,0,NULL);
 INSERT INTO cockpit_campaigns VALUES('Alpha','{"campaignName":"Alpha campaign"}');
 INSERT INTO cockpit_ads VALUES('a1','Alpha campaign','Client ad',now(),20,2);`);
 await actor(db,A);
 const out=(await db.query<any>("SELECT cockpit_ideation_copy('foreplay','f1','Human note') v")).rows[0].v;
 expect(out.key).toBe('foreplay:f1');
 expect((await db.query<any>("SELECT caption,transcript,saved_by,note FROM ideation_posts WHERE key='foreplay:f1'")).rows[0]).toEqual({caption:'Original caption',transcript:'Real transcript',saved_by:'buyer@tests.invalid',note:'Human note'});
 await db.query("SELECT cockpit_ideation_copy('foreplay','f1',NULL)");
 expect((await db.query<any>("SELECT note FROM ideation_posts WHERE key='foreplay:f1'")).rows[0].note).toBe('Human note');
 await db.query("SELECT cockpit_ideation_copy('winner','w1',NULL)");
 expect((await db.query<any>("SELECT spend,leads,cpl FROM ideation_posts WHERE key='meta_ads:w1'")).rows[0]).toEqual({spend:'0',leads:0,cpl:null});
 await db.query("SELECT cockpit_ideation_copy('client_ad','a1',NULL)");
 expect((await db.query<any>("SELECT caption FROM ideation_posts WHERE key='meta_ads:a1'")).rows[0].caption).toBe('Client ad');
 await owner(db); await db.exec(`UPDATE cockpit_members SET clients=ARRAY['Beta'] WHERE auth_user_id='${A}'`);await actor(db,A);
 expect((await db.query<any>("SELECT cockpit_ideation_copy('winner','w1',NULL) v")).rows[0].v.key).toBe('meta_ads:w1');
 await expect(db.query("SELECT cockpit_ideation_copy('client_ad','a1',NULL)")).rejects.toThrow('not available');
 }finally{await db.close();}
});
// Sanitized column metadata read from Creative Triage on 2026-09-27.
const schema="CREATE TABLE ideation_posts(\"key\" text NOT NULL,\"platform\" text NOT NULL,\"post_id\" text,\"url\" text NOT NULL,\"origin\" text DEFAULT 'scan'::text NOT NULL,\"status\" text DEFAULT 'proposed'::text NOT NULL,\"at\" timestamp with time zone DEFAULT now() NOT NULL,\"created_at\" timestamp with time zone DEFAULT now() NOT NULL,\"author_handle\" text,\"author_name\" text,\"author_followers\" bigint,\"posted_at\" timestamp with time zone,\"views\" bigint,\"likes\" bigint,\"comments\" bigint,\"shares\" bigint,\"saves\" bigint,\"caption\" text,\"duration_sec\" numeric,\"thumb_url\" text,\"media_url\" text,\"target_key\" text,\"industry\" text DEFAULT 'other'::text NOT NULL,\"tags\" jsonb DEFAULT '[]'::jsonb NOT NULL,\"baseline_views\" numeric,\"baseline_raw\" numeric,\"baseline_floored\" boolean,\"baseline_n\" integer,\"baseline_confidence\" text,\"baseline_method\" text,\"baseline_rules\" jsonb,\"multiplier\" numeric,\"tier\" text,\"engagement_rate\" numeric,\"reach_rate\" numeric,\"robust_z\" numeric,\"packaging_only\" boolean,\"provisional\" boolean,\"checkpoint\" text,\"scanned_at\" timestamp with time zone,\"captured_at\" timestamp with time zone,\"language\" text,\"dialect\" text,\"has_speech\" boolean,\"voice\" text,\"transcript\" text,\"on_screen_text\" jsonb DEFAULT '[]'::jsonb NOT NULL,\"format\" text,\"hook\" jsonb,\"beats\" jsonb DEFAULT '[]'::jsonb NOT NULL,\"cta\" text,\"why_it_works\" text,\"transferable\" text,\"adaptations\" jsonb DEFAULT '[]'::jsonb NOT NULL,\"music\" text,\"method\" jsonb,\"confidence\" jsonb,\"warnings\" jsonb DEFAULT '[]'::jsonb NOT NULL,\"error\" text,\"pasted_by\" text,\"pasted_by_name\" text,\"pasted_at\" timestamp with time zone,\"note\" text,\"saved_by\" text,\"saved_by_name\" text,\"saved_at\" timestamp with time zone,\"saved_note\" text,\"dismissed_by\" text,\"dismissed_at\" timestamp with time zone,\"fetching_at\" timestamp with time zone,\"attempts\" integer DEFAULT 0 NOT NULL,\"still_path\" text,\"still_at\" timestamp with time zone,\"still_error\" text,\"updated_at\" timestamp with time zone DEFAULT now() NOT NULL,\"format_label\" text,\"hook_kind\" text,\"topic\" text,\"format_vec\" jsonb,\"trend_id\" text,\"trend_label\" text,\"trend_n\" integer,\"trend_at\" timestamp with time zone,\"ad_id\" text,\"ad_page_id\" text,\"advertiser\" text,\"ad_started_at\" timestamp with time zone,\"ad_last_seen_at\" timestamp with time zone,\"running_days\" integer,\"ad_platforms\" jsonb,\"ad_format\" text,\"ad_active\" boolean,\"source_request\" text,\"client\" text,\"spend\" numeric,\"leads\" integer,\"cpl\" numeric);\nCREATE TABLE ideation_watchlist(\"key\" text NOT NULL,\"platform\" text NOT NULL,\"kind\" text DEFAULT 'account'::text NOT NULL,\"value\" text NOT NULL,\"industry\" text DEFAULT 'other'::text NOT NULL,\"tags\" jsonb DEFAULT '[]'::jsonb NOT NULL,\"active\" boolean DEFAULT true NOT NULL,\"note\" text,\"source\" text DEFAULT 'manual'::text NOT NULL,\"added_by\" text,\"added_at\" timestamp with time zone DEFAULT now() NOT NULL,\"last_scanned_at\" timestamp with time zone,\"last_status\" text,\"baseline_views\" numeric,\"baseline_n\" integer,\"followers\" bigint,\"updated_at\" timestamp with time zone DEFAULT now() NOT NULL);\nCREATE TABLE ideation_requests(\"id\" text NOT NULL,\"kind\" text NOT NULL,\"platform\" text,\"input\" text NOT NULL,\"params\" jsonb DEFAULT '{}'::jsonb NOT NULL,\"status\" text DEFAULT 'queued'::text NOT NULL,\"requested_by\" text,\"requested_by_name\" text,\"created_at\" timestamp with time zone DEFAULT now() NOT NULL,\"started_at\" timestamp with time zone,\"finished_at\" timestamp with time zone,\"attempts\" integer DEFAULT 0 NOT NULL,\"result\" jsonb,\"error\" text,\"updated_at\" timestamp with time zone DEFAULT now() NOT NULL);";
