import {expect,test} from 'bun:test';
import {actor,cockpitTestDb,member,migration,owner} from './lib/cockpitTestDb';
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
async function fixture(){
 const db=await cockpitTestDb();
 await db.exec(`CREATE TABLE editor_clients(task_id text PRIMARY KEY,name text,status text);
 CREATE SCHEMA extensions;
 CREATE FUNCTION public.gen_random_bytes(n integer) RETURNS bytea LANGUAGE sql AS $$ SELECT decode(replace(gen_random_uuid()::text,'-',''),'hex') $$;`);
 await db.exec(migration('20260920c_review.sql'));
 await db.exec(migration('20260920d_review_create.sql'));
 await db.exec(migration('20260921a_review_media.sql'));
 await db.exec(migration('20260923k_cockpit_creative_requests.sql'));
 await db.exec(migration('20260923m_unified_creative_request.sql'));
 const allowed=migration('20260926m_cockpit_csm_state.sql').match(/CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed[\s\S]*?END \$\$;/)![0];
 await db.exec(allowed);
 await db.exec(migration('20260927i_cockpit_creative_actions.sql'));
 await db.exec(migration('20260927i_cockpit_creative_actions.sql'));
 await member(db,A,'buyer@tests.invalid',['media_buyer']);
 await member(db,B,'other@tests.invalid',['csm']);
 await db.exec(`UPDATE cockpit_members SET clients=ARRAY['Alpha'] WHERE auth_user_id='${A}'; UPDATE cockpit_members SET clients=ARRAY['Beta'] WHERE auth_user_id='${B}'; INSERT INTO editor_clients VALUES('alpha','Alpha','active'),('beta','Beta','active');`);
 await actor(db,A);
 return db;
}
test('review identity is server derived, client scoped, audited; legacy browser bypass denied',async()=>{
 const db=await fixture();try{
 const result=await db.query<{v:any}>(`SELECT cockpit_review_create('Review',NULL,'Alpha','alpha','spoofed','[{"video_url":"https://example.test/movie.mp4"}]',30) v`);
 const token=result.rows[0].v.token;
 expect(result.rows[0].v.items).toBe(1);
 expect((await db.query<any>('SELECT cockpit_review_list() v')).rows[0].v).toHaveLength(1);
 await expect(db.query(`SELECT cockpit_review_create('Review',NULL,'Beta','beta','spoofed','[{"video_url":"https://example.test/movie.mp4"}]',30)`)).rejects.toThrow('assigned client');
 await expect(db.query(`SELECT review_list(25)`)).rejects.toThrow('permission denied');
 await actor(db,B);
 await expect(db.query('SELECT cockpit_review_revoke($1)',[token])).rejects.toThrow('Review not found');
 expect((await db.query<any>('SELECT cockpit_review_status($1) v',[token])).rows[0].v).toBeNull();
 expect((await db.query<any>('SELECT cockpit_review_list() v')).rows[0].v).toEqual([]);
 expect((await db.query<any>('SELECT cockpit_review_clients() v')).rows[0].v).toEqual([{task_id:'beta',name:'Beta'}]);
 await owner(db);
 expect((await db.query<any>('SELECT created_by FROM review_links')).rows[0].created_by).toBe('buyer@tests.invalid');
 expect((await db.query<any>('SELECT actor_email FROM cockpit_audit_log')).rows[0].actor_email).toBe('buyer@tests.invalid');
 await actor(db,A);
 await db.query('SELECT cockpit_review_revoke($1)',[token]);
 await db.query('SELECT cockpit_review_revoke($1)',[token]);
 await owner(db);
 expect((await db.query<any>("SELECT count(*)::int n FROM cockpit_audit_log WHERE action='revoke'")).rows[0].n).toBe(1);
 await db.exec(`UPDATE cockpit_members SET active=false WHERE auth_user_id='${A}'`);
 await actor(db,A);
 await expect(db.query('SELECT cockpit_review_list()')).rejects.toThrow('Active creative');
 await actor(db,null);
 await expect(db.query('SELECT cockpit_review_list()')).rejects.toThrow('permission denied');
 }finally{await db.close();}
});
test('folder queue uses existing worker contract and status cannot leak another client',async()=>{
 const db=await fixture();try{
 const id=(await db.query<any>(`SELECT cockpit_review_import_folder('https://drive.google.com/drive/folders/abcdefghijk01234567890','Review',NULL,'Alpha','alpha','spoofed') v`)).rows[0].v.id;
 expect((await db.query<any>('SELECT cockpit_review_import_status($1) v',[id])).rows[0].v.status).toBe('queued');
 await expect(db.query(`SELECT cockpit_review_import_folder('https://evil.test/drive.google.com','Review',NULL,'Alpha','alpha','spoofed')`)).rejects.toThrow('Google Drive');
 await actor(db,B);
 expect((await db.query<any>('SELECT cockpit_review_import_status($1) v',[id])).rows[0].v).toBeNull();
 await owner(db);
 expect((await db.query<any>('SELECT requested_by FROM review_imports')).rows[0].requested_by).toBe('buyer@tests.invalid');
 }finally{await db.close();}
});
test('creative assessment requires assigned buyer and mature launched ad; retries preserve one audit',async()=>{
 const db=await fixture();try{
 await owner(db);
 const id=(await db.query<any>(`INSERT INTO cockpit_creative_requests(campaign_name,client_name,meta_account_id,requested_by,evidence,request_reason,launched_meta_ad_id,launched_at,status) VALUES('Alpha campaign','Alpha','123','buyer@tests.invalid','Source','more_ads','ad-1',now()-interval '6 days','launched') RETURNING id`)).rows[0].id;
 await actor(db,B);
 expect((await db.query<any>('SELECT cockpit_creative_requests_list(NULL) v')).rows[0].v).toEqual([]);
 await expect(db.query(`SELECT cockpit_creative_request_review($1,'Alpha campaign','worked',NULL)`,[id])).rejects.toThrow('Media buyer');
 await actor(db,A);
 await expect(db.query(`SELECT cockpit_creative_request_review($1,'Wrong campaign','worked',NULL)`,[id])).rejects.toThrow('not found');
 await owner(db);
 await db.query("UPDATE cockpit_creative_requests SET launched_at=now() WHERE id=$1",[id]);
 await actor(db,A);
 await expect(db.query(`SELECT cockpit_creative_request_review($1,'Alpha campaign','worked',NULL)`,[id])).rejects.toThrow('three complete days');
 await owner(db);
 await db.query("UPDATE cockpit_creative_requests SET launched_at=now()-interval '6 days' WHERE id=$1",[id]);
 const baseline=(await db.query<any>('SELECT count(*)::int n FROM cockpit_creative_request_events WHERE request_id=$1',[id])).rows[0].n;
 await actor(db,A);
 const row=(await db.query<any>(`SELECT cockpit_creative_request_review($1,'Alpha campaign','worked',NULL) v`,[id])).rows[0].v;
 expect(row.reviewed_by).toBe('buyer@tests.invalid'); expect(row.feedback_error).toContain('not been confirmed');
 await db.query(`SELECT cockpit_creative_request_review($1,'Alpha campaign','worked',NULL)`,[id]);
 await expect(db.query(`SELECT cockpit_creative_request_review($1,'Alpha campaign','stop',NULL)`,[id])).rejects.toThrow('already been reviewed');
 await owner(db);
 expect((await db.query<any>('SELECT count(*)::int n FROM cockpit_creative_request_events WHERE request_id=$1',[id])).rows[0].n).toBe(baseline+1);
 }finally{await db.close();}
});
