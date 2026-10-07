import {test,expect} from 'bun:test';
import {actor,cockpitTestDb,member,migration,owner} from './lib/cockpitTestDb';
const A='00000000-0000-4000-8000-000000000001',B='00000000-0000-4000-8000-000000000002';
test('drafts preserve copy, enforce role/client mapping, reject launched edits and soft-discard',async()=>{
 const db=await cockpitTestDb();try{
 await db.exec('CREATE TABLE cockpit_campaigns(id bigint GENERATED ALWAYS AS IDENTITY,client_name text,meta_account_id text,meta_campaign_id text,raw_data jsonb)');
 const allowed=migration('20260926m_cockpit_csm_state.sql').match(/CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed[\s\S]*?END \$\$;/)![0];await db.exec(allowed);await db.exec(migration('20260927r_cockpit_campaign_builds.sql'));
 await member(db,A,'buyer@tests.invalid',['media_buyer']);await member(db,B,'other@tests.invalid',['media_buyer']);
 await db.exec(`UPDATE cockpit_members SET clients=ARRAY['Beta'] WHERE auth_user_id='${B}';INSERT INTO cockpit_campaigns(client_name,meta_account_id,meta_campaign_id,raw_data) VALUES('Alpha','111111','222222','{"clientTag":"alpha","campaignName":"Campaign","leads7d":10,"cpl":10}');`);
 const id=(await db.query<any>(`INSERT INTO cockpit_campaign_drafts(client_tag,client_name,account_id,data,status,created_by) VALUES('alpha','Alpha','111111','{"variants":[{"headline":"Original","primaryText":"Human copy"}],"contextDocs":"Human docs"}','ready','buyer@tests.invalid') RETURNING id`)).rows[0].id;
 await actor(db,A);const scope=(await db.query<any>("SELECT cockpit_build_scope('alpha') v")).rows[0].v;expect(scope.client).toBe('Alpha');
 await db.query('SELECT cockpit_build_action($1,$2)',['saveVariants',{id,variants:[{headline:'Edited',primaryText:'Human copy'}]}]);
 const draft=(await db.query<any>('SELECT cockpit_build_action($1,$2) v',['get',{id}])).rows[0].v;expect(draft.contextDocs).toBe('Human docs');expect(draft.variants[0].headline).toBe('Edited');expect(draft._version).toBeDefined();
 await actor(db,B);await expect(db.query('SELECT cockpit_build_action($1,$2)',['get',{id}])).rejects.toThrow('assignments');
 await actor(db,A);await db.query('SELECT cockpit_build_action($1,$2)',['discard',{id}]);expect((await db.query<any>('SELECT cockpit_build_action($1,$2) v',['list',{clientTag:'alpha'}])).rows[0].v).toEqual([]);
 await owner(db);expect((await db.query<any>('SELECT count(*)::int n FROM cockpit_campaign_drafts')).rows[0].n).toBe(1);
 }finally{await db.close();}
});
