// Run with Node and PGLITE_MODULE pointing to an installed @electric-sql/pglite.
// This is local-only Postgres. No credentials or network calls are used.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create table cockpit_sales_recordings (
    recording_id text primary key, title text, kind text, started_at timestamptz,
    contact_id text, recorded_by text, matched_by text, duration_s int, transcript_chars int, transcript_path text,
    duplicate_of text, hidden_reason text check(hidden_reason in ('duplicate','too short'))
  );
  create table cockpit_sales_call_notes (recording_id text primary key, call_at timestamptz, notes jsonb);
  create table cockpit_sales_digests (id serial primary key, days int, from_at timestamptz, to_at timestamptz,
    calls_used int, digest jsonb);
  create table cockpit_sales_reviews (id serial primary key, recording_id text);
  create table cockpit_csm_calls (source text,source_id text,task_id text,status text,kind text,match_method text,
    unique(source,source_id));
  alter table cockpit_sales_recordings enable row level security;
  alter table cockpit_sales_call_notes enable row level security;
  alter table cockpit_sales_reviews enable row level security;
  create policy seat on cockpit_sales_recordings for select to authenticated
    using (current_setting('test.seat',true)='yes');
  create policy seat on cockpit_sales_call_notes for select to authenticated
    using (current_setting('test.seat',true)='yes');
  create policy seat on cockpit_sales_reviews for select to authenticated
    using (current_setting('test.seat',true)='yes');
  grant select on cockpit_sales_recordings,cockpit_sales_call_notes,cockpit_sales_reviews to authenticated;
  grant all on all tables in schema public to service_role;
  grant usage,select on all sequences in schema public to service_role;
  insert into cockpit_sales_recordings(recording_id,title,started_at) values
    ('190894076','Synthetic retention call','2026-10-08'),('sales','Prospect demo','2026-10-07'),
    ('191742063','Synthetic team meeting','2026-10-10');
  insert into cockpit_sales_call_notes values
    ('190894076','2026-10-08','{"summary":"Retention/save call, not a true demo. Existing Mahara client fictional fixture"}'),
    ('sales','2026-10-07','{"summary":"Prospect discusses the failures of another agency"}'),
    ('191742063','2026-10-10','{"summary":"Internal Mahara CSM daily synthetic fixture"}');
  insert into cockpit_sales_reviews(recording_id) values ('190894076'),('sales');
  insert into cockpit_sales_digests(days,from_at,to_at,calls_used,digest) values
    (7,'2026-10-06','2026-10-13',2,'{}'),(7,'2026-09-01','2026-09-08',1,'{}');
`);
const sql = await readFile(new URL('../20261013112622_sales_client_call_exclusion.sql', import.meta.url), 'utf8');
await db.exec(sql);
const one = async sql => (await db.query(sql)).rows[0];
let checks=0;
const eq = (actual,expected) => { assert.deepEqual(actual,expected); checks++; };
eq((await one(`select hidden_reason from cockpit_sales_recordings where recording_id='190894076'`)).hidden_reason,'client service');
eq((await one(`select hidden_reason from cockpit_sales_recordings where recording_id='191742063'`)).hidden_reason,'internal');
eq((await one(`select invalidated_at is not null as yes from cockpit_sales_digests where id=1`)).yes,true);
eq((await one(`select invalidated_at is null as yes from cockpit_sales_digests where id=2`)).yes,true);
await db.exec(sql); // Replay is harmless, including the targeted correction.
await db.exec(`set role service_role; select cockpit_sales_mark_recordings();
 update cockpit_sales_recordings set title='Generic meeting',hidden_reason=null where recording_id='190894076';`);
eq((await one(`select hidden_reason from cockpit_sales_recordings where recording_id='190894076'`)).hidden_reason,'client service');
await db.exec(`insert into cockpit_sales_recordings(recording_id,title) values ('title','Acme Check-in'),('generic','Impromptu Zoom Meeting');
 insert into cockpit_sales_call_notes values ('generic','2026-10-09','{"call_purpose":"client_service","call_purpose_evidence":"We have run our campaigns with Mahara since July."}');`);
for (const rid of ['title','generic']) eq((await one(`select hidden_reason from cockpit_sales_recordings where recording_id='${rid}'`)).hidden_reason,'client service');
await db.exec(`insert into cockpit_sales_recordings(recording_id,title) values ('team','Generic meeting');
 insert into cockpit_sales_call_notes values ('team','2026-10-10','{"call_purpose":"internal","call_purpose_evidence":"Our internal team reviews existing accounts today."}');
 update cockpit_sales_recordings set hidden_reason=null where recording_id='team';
 select cockpit_sales_mark_recordings();`);
eq((await one(`select hidden_reason from cockpit_sales_recordings where recording_id='team'`)).hidden_reason,'internal');
await db.exec(`insert into cockpit_csm_calls values ('fathom','csm','client-id','held','checkin','invitee_email'),
 ('fathom','old-demo','client-id','held','other','invitee_email'),
 ('fathom','weak','client-id','held','checkin','name');
 insert into cockpit_sales_recordings(recording_id,title) values ('csm','Generic'),('old-demo','Old demo'),('weak','Generic');`);
eq((await one(`select hidden_reason from cockpit_sales_recordings where recording_id='csm'`)).hidden_reason,'client service');
for(const rid of ['sales','old-demo','weak']) eq((await one(`select hidden_reason from cockpit_sales_recordings where recording_id='${rid}'`)).hidden_reason,null);
// Late CSM matching is found by the existing importer reconciliation pass.
await db.exec(`insert into cockpit_sales_recordings(recording_id,title) values ('late','Generic');
 insert into cockpit_csm_calls values ('fathom','late','client-id','held','launch','manual');
 select cockpit_sales_mark_recordings();`);
eq((await one(`select hidden_reason from cockpit_sales_recordings where recording_id='late'`)).hidden_reason,'client service');
// A client call must not become the longest duplicate target for a prospect.
await db.exec(`insert into cockpit_sales_recordings(recording_id,title,started_at,recorded_by,duration_s) values
 ('client-long','Check-in','2026-10-12 09:00Z','rep',3600),('sale-short','Demo','2026-10-12 09:01Z','rep',1000),
 ('sale-copy','Demo','2026-10-12 09:02Z','rep',500);
 select cockpit_sales_mark_recordings();`);
eq((await one(`select hidden_reason from cockpit_sales_recordings where recording_id='sale-short'`)).hidden_reason,null);
eq((await one(`select duplicate_of from cockpit_sales_recordings where recording_id='sale-copy'`)).duplicate_of,'sale-short');
// A classification that lands during digest generation invalidates that result.
await db.exec(`insert into cockpit_sales_digests(days,from_at,to_at,calls_used,digest) values
 (7,'2026-10-06','2026-10-13',1,'{"scope_version":1,"source_recording_ids":["generic"]}'),
 (7,'2026-10-06','2026-10-13',1,'{"scope_version":1,"source_recording_ids":["sales"]}'),
 (7,'2026-10-06','2026-10-13',1,'{}');`);
eq((await one(`select count(*)::int n from cockpit_sales_digests where invalidated_at is null`)).n,2);
await db.exec(`reset role; set role authenticated; set test.seat='yes';`);
eq((await db.query(`select recording_id from cockpit_sales_call_notes order by recording_id`)).rows,[{recording_id:'sales'}]);
eq((await db.query(`select recording_id from cockpit_sales_reviews`)).rows,[{recording_id:'sales'}]);
await db.exec(`set test.seat='no'`);
eq((await one(`select count(*)::int n from cockpit_sales_call_notes`)).n,0);
await db.exec(`reset role`);
eq((await one(`select has_function_privilege('anon','cockpit_sales_call_exclusion(text,text)','EXECUTE') yes`)).yes,false);
eq((await one(`select has_function_privilege('authenticated','cockpit_sales_mark_recordings()','EXECUTE') yes`)).yes,false);
// Nothing was deleted, including the excluded recording, notes and review.
eq((await one(`select count(*)::int n from cockpit_sales_reviews`)).n,2);
await db.close();
console.log(`${checks} local Postgres checks passed, including migration replay and role boundaries.`);
