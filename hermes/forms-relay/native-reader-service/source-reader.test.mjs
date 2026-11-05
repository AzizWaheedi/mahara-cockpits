// Synthetic local Postgres only. By default this uses schema/validator stubs;
// REAL_SCHEMA=1 uses read-only captured schema and functions with fake answers.
// Neither mode establishes real provider behavior or concurrent correctness.
import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { committedSourcePort, READ_SOURCE_SQL } from './source-port.ts';
import { committedGateway } from './gateway.ts';
import { nodePostgresOwnedPool } from './pg-driver.ts';
if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE to the local PGlite dist/index.js');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const path = new URL('../../../supabase/migrations/20261105162937_native_research_source_reader_candidate.sql', import.meta.url);
let sql = await readFile(path, 'utf8');
await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE public.cockpit_form_responses (id uuid primary key,task_id text,form_key text,form_version int,source text,state text,mode text,submitted_at timestamptz,answer_meta jsonb,invite_id uuid,answers jsonb);
 CREATE TABLE public.cockpit_form_invites (id uuid primary key,task_id text,form_key text,form_version int,response_id uuid,context jsonb);
 CREATE TABLE public.cockpit_form_effects (id uuid primary key,response_id uuid,effect_key text,form_key text,owner text,delivery text,state text,plan jsonb,delivery_ref text,dedupe_key text);
 CREATE TABLE public.cockpit_clickup_writeback_queue (id uuid primary key,state text,kind text,source_table text,source_id text,task_id text,dedupe_key text,payload jsonb,progress jsonb);
 CREATE TABLE public.cockpit_form_versions (form_key text,version int,schema jsonb);
 CREATE TABLE public.cockpit_settings (key text primary key,value jsonb);
 CREATE FUNCTION public.cockpit_form_answers_check_v1(jsonb,jsonb,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
 CREATE FUNCTION public.cockpit_form_answers_check_v2(jsonb,jsonb,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
 CREATE FUNCTION public.cockpit_form_answers_check(jsonb,jsonb,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT CASE WHEN $2 ? 'required' AND (SELECT count(*) FROM jsonb_object_keys($2))=1 THEN jsonb_build_object('ok',true,'answers',$2) ELSE '{"ok":false}'::jsonb END $$;
 CREATE FUNCTION public.cockpit_form_kuwait_day(timestamptz) RETURNS date LANGUAGE sql AS $$ SELECT current_date $$;
 CREATE FUNCTION public.cockpit_form_rows_blank_cell(jsonb) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
 CREATE FUNCTION public.cockpit_form_stage4_fields(text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '[]'::jsonb $$;
 CREATE FUNCTION public.cockpit_form_stage4_print_map(integer) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
 CREATE FUNCTION public.cockpit_form_stage4_print_part(jsonb,jsonb) RETURNS text LANGUAGE sql AS $$ SELECT 'synthetic'::text $$;
 CREATE FUNCTION public.cockpit_form_stage4_print(text,integer,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_array(jsonb_build_object('ref','synthetic','title','Synthetic','value',$3->>'required')) $$;
 CREATE FUNCTION public.cockpit_form_stage4_text(jsonb) RETURNS text LANGUAGE sql AS $$ SELECT 'synthetic'::text $$;
 CREATE FUNCTION public.cockpit_form_stage4_typeform_answers(text,jsonb) RETURNS jsonb LANGUAGE sql AS $$ SELECT '[]'::jsonb $$;
 CREATE FUNCTION public.cockpit_form_typeform_text(text) RETURNS text LANGUAGE sql AS $$ SELECT $1 $$;
 CREATE FUNCTION public.cockpit_form_stage4_make_text(text,text) RETURNS text LANGUAGE sql AS $$ SELECT $1 $$;
 CREATE FUNCTION public.cockpit_form_stage4_raw_answers_text(jsonb,jsonb) RETURNS text LANGUAGE sql AS $$ SELECT 'Synthetic comment'::text $$;
 CREATE FUNCTION public.cockpit_form_responses_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
`);
const real = process.env.REAL_SCHEMA === '1';
const formVersion=real && process.env.SOURCE_VERSION === '2' ? 2 : 3;
let capturedFunctions;
if (real) {
 capturedFunctions=JSON.parse(await readFile(process.env.ONBOARDING_FUNCTION_FIXTURE,'utf8'));
 const order=['cockpit_form_typeform_text','cockpit_form_kuwait_day','cockpit_form_rows_blank_cell','cockpit_form_stage4_fields',
  'cockpit_form_stage4_text','cockpit_form_stage4_typeform_answers','cockpit_form_stage4_print_map','cockpit_form_stage4_print_part',
  'cockpit_form_stage4_print','cockpit_form_stage4_make_text','cockpit_form_stage4_raw_answers_text','cockpit_form_responses_guard',
  'cockpit_form_answers_check_v1','cockpit_form_answers_check_v2','cockpit_form_answers_check'];
 for(const name of order) await db.exec(capturedFunctions.find(x=>x.signature.startsWith(name+'(')).definition);
}
await db.exec('CREATE TRIGGER cockpit_form_responses_guard BEFORE UPDATE ON public.cockpit_form_responses FOR EACH ROW EXECUTE FUNCTION public.cockpit_form_responses_guard()');
// Bind the same migration to the synthetic schema and stub function bodies;
// production pins remain untouched in the checked-in migration.
const defs = await db.query(`select 'public.'||p.oid::regprocedure::text sig,encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex') hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'cockpit_form_%'`);
for (const {sig,hash} of real ? [] : defs.rows) {
 if(sig==='public.cockpit_form_responses_guard()') continue;
 const escaped=sig.replaceAll(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const re=new RegExp("('"+escaped+"',')[0-9a-f]{64}(')");
 assert.match(sql,re,`missing pin ${sig}`); sql=sql.replace(re,`$1${hash}$2`);
}
if(!real) {
 const {rows:[guard]}=await db.query("select encode(sha256(convert_to(pg_get_triggerdef(t.oid),'UTF8')),'hex') trigger_hash,encode(sha256(convert_to(pg_get_functiondef(t.tgfoid),'UTF8')),'hex') guard_hash from pg_trigger t where t.tgrelid='public.cockpit_form_responses'::regclass and t.tgname='cockpit_form_responses_guard'");
 sql=sql.replace('dc2c8a5472453ce9a47d6306852f6e9714032a0e0696b3e99552b6fdb0b320ca',guard.trigger_hash)
        .replace('37c56aa8e315838c4b101d2e10cb99569f1a2bdacec3d2007bb940c37c8b7b50',guard.guard_hash);
}
const schema=real ? JSON.parse(await readFile(process.env.ONBOARDING_SCHEMA_FIXTURE,'utf8')).find(s=>s.version===formVersion).schema
                  : {v:2,key:'onboarding',fields:[{key:'required',type:'text',required:true}]};
await db.query('insert into public.cockpit_form_versions values ($1,$2,$3::jsonb)', ['onboarding',formVersion,JSON.stringify(schema)]);
const {rows:[{h}]}=await db.query("select encode(sha256(convert_to(schema::text,'UTF8')),'hex') h from public.cockpit_form_versions");
if (!real) sql=sql.replace('175f46516fd0bf33423e47dc74a2571e6f881d26d88fdf05bb08b3462f0df3e7',h);
else assert.equal(h,formVersion===2 ? 'acafcf8c397502000d5ff7314e8d21ba513f116e726efdd7b991b7d3cafebf9e'
                                  : '175f46516fd0bf33423e47dc74a2571e6f881d26d88fdf05bb08b3462f0df3e7');
await db.exec(sql);
await db.exec(await readFile(new URL('../../../supabase/migrations/20261105164639_native_research_gateway_reservations_candidate.sql', import.meta.url),'utf8'));
const response='11111111-1111-4111-8111-111111111111', invite='22222222-2222-4222-8222-222222222222';
const effect='33333333-3333-4333-8333-333333333333', queue='44444444-4444-4444-8444-444444444444';
const secret=Buffer.alloc(32,7).toString('base64url'), capHash=createHash('sha256').update(Buffer.alloc(32,7)).digest('hex');
await db.query("insert into public.cockpit_form_invites values ($1,'test_task','onboarding',$3,$2,'{}')",[invite,response,formVersion]);
function sample(s) {
 const a={};
 for(const f of s.fields) {
  if(!f.required) continue; const c=f.showIf; const v=c ? (a[c.key] ?? false) : null;
  if(c && ('includes' in c ? !(Array.isArray(v)&&v.includes(c.includes)) : 'in' in c ? !c.in.includes(v) : v!==c.equals)) continue;
  const val=x => x.type==='number' ? Math.max(x.min ?? 0,0) : x.type==='choice' ? x.options[0].value
   : x.type==='multi' ? [x.options[0].value] : x.type==='tick' ? true : x.format==='phone' ? '+96511111111'
   : x.format==='email' ? 'fictional@example.invalid' : x.format==='url' ? 'https://example.invalid' : 'Fictional answer';
  if(f.type==='rows') { const row={}; for(const col of f.columns) if(col.required) row[col.key]=val(col); a[f.key]=Array.from({length:f.minRows??1},()=>({...row})); }
  else a[f.key]=val(f);
 }
 return a;
}
let baseAnswers=real ? sample(schema) : {required:'synthetic'};
if(real) { const v=(await db.query('select public.cockpit_form_answers_check($1::jsonb,$2::jsonb,$3::jsonb) result',[JSON.stringify(schema),JSON.stringify(baseAnswers),'{}'])).rows[0].result;
 assert.equal(v.ok,true,JSON.stringify(v.errors)); baseAnswers=v.answers; }
const titles=real ? JSON.parse(await readFile(process.env.ONBOARDING_TITLES_FIXTURE,'utf8'))[0].titles
                  : Array.from({length:36},(_,n)=>({ref:n===0?'synthetic':`synthetic_${n}`,title:'Synthetic'}));
await db.query("insert into public.cockpit_settings values ('onboarding.raw_titles',$1::jsonb)",[JSON.stringify({fields:titles})]);
const {rows:[rendered]}=await db.query("select public.cockpit_form_stage4_raw_answers_text(public.cockpit_form_stage4_print('onboarding',$1,$2::jsonb),$3::jsonb) text",[formVersion,JSON.stringify(baseAnswers),JSON.stringify(titles)]);
const text=rendered.text, digest=createHash('sha256').update(text).digest('hex');
await db.query("insert into public.cockpit_form_responses values ($1,'test_task','onboarding',$4,'portal','submitted','live',now(),'{}',$2,$3::jsonb)",[response,invite,JSON.stringify(baseAnswers),formVersion]);
await db.query("insert into public.cockpit_form_effects values ($1,$2,'raw_answers_comment','onboarding','cockpit','clickup_queue','delivered',$3::jsonb,$4,'dedupe')",[effect,response,JSON.stringify({taskId:'test_task',comment_text:text}),queue]);
await db.query("insert into public.cockpit_clickup_writeback_queue values ($1,'delivered','form','cockpit_form_effects',$2,'test_task','dedupe',$3::jsonb,$4::jsonb)",[queue,effect,JSON.stringify({responseId:response,effectId:effect,effectKey:'raw_answers_comment',taskId:'test_task',formKey:'onboarding',commentSha256:digest}),JSON.stringify({steps:{raw_answers_comment:{state:'done',commentId:'test_comment'}}})]);
await db.query("insert into native_research_private.capabilities (capability_sha256,response_id,task_id,form_version,comment_id,comment_sha256,issued_at,expires_at) values ($1,$2,'test_task',$4,'test_comment',$3,now(),now()+interval '5 minutes')",[capHash,response,digest,formVersion]);
async function read(overrides={}) {
 const a={secret,task:'test_task',response,version:formVersion,comment:'test_comment',digest,run:'1',attempt:1,...overrides};
 const x=await db.query('select native_research_private.read_source($1,$2,$3,$4,$5,$6,$7,$8) result',[a.secret,a.task,a.response,a.version,a.comment,a.digest,a.run,a.attempt]); return x.rows[0].result;
}
assert.equal(await read(),null,'disabled by default');
for(const role of ['anon','authenticated','service_role']) {
 const {rows:[p]}=await db.query("select has_schema_privilege($1,'native_research_private','USAGE') allowed",[role]); assert.equal(p.allowed,false);
 const {rows:[f]}=await db.query("select has_function_privilege($1,'native_research_private.read_source(text,text,uuid,integer,text,text,text,integer)','EXECUTE') allowed",[role]); assert.equal(f.allowed,false);
 const {rows:[t]}=await db.query("select has_table_privilege($1,'native_research_private.capabilities','SELECT') allowed",[role]); assert.equal(t.allowed,false);
}
const {rows:[restricted]}=await db.query("select rolcanlogin,rolsuper,rolbypassrls from pg_roles where rolname='cockpit_native_research_reader'");
assert.deepEqual(restricted,{rolcanlogin:false,rolsuper:false,rolbypassrls:false});
assert.equal((await db.query("select count(*)::int count from pg_auth_members m join pg_roles r on r.oid=m.roleid where r.rolname='cockpit_native_research_reader'")).rows[0].count,0);
assert.equal((await db.query("select has_table_privilege('cockpit_native_research_reader','native_research_private.capabilities','SELECT') allowed")).rows[0].allowed,false);
await db.exec('update native_research_private.settings set enabled=true');
assert.equal(await read({task:'other'}),null,'wrong task');
assert.equal(await read({secret:Buffer.alloc(32,8).toString('base64url')}),null,'wrong capability');
assert.equal(await read({comment:'other'}),null,'wrong receipt');
assert.equal(await read({version:formVersion===2 ? 3 : 2}),null,'wrong schema version');
assert.equal(await read({digest:'0'.repeat(64)}),null,'wrong digest');
await db.exec("update native_research_private.capabilities set issued_at=now()-interval '10 minutes',expires_at=now()-interval '5 minutes'");
assert.equal(await read(),null,'expired capability');
await db.exec("update native_research_private.capabilities set issued_at=now(),expires_at=now()+interval '5 minutes'");
await db.exec('begin');
await db.exec("update native_research_private.capabilities set issued_at=clock_timestamp()-interval '1 second',expires_at=clock_timestamp()+interval '40 milliseconds'");
await db.exec('select pg_sleep(0.10)');
assert.equal(await read(),null,'expiration uses wall clock even inside an old transaction');
await db.exec('rollback');
async function unsafeFixtureUpdate(query,params=[]) {
 await db.exec('alter table public.cockpit_form_responses disable trigger cockpit_form_responses_guard');
 await db.query(query,params);
 await db.exec('alter table public.cockpit_form_responses enable trigger cockpit_form_responses_guard');
}
await unsafeFixtureUpdate("update public.cockpit_form_responses set answers=answers || '{\"unknown\":true}'::jsonb");
assert.equal(await read(),null,'unknown raw input');
await unsafeFixtureUpdate("update public.cockpit_form_responses set answers='{}'");
assert.equal(await read(),null,'missing required raw input');
await unsafeFixtureUpdate('update public.cockpit_form_responses set answers=$1::jsonb',[JSON.stringify(baseAnswers)]);
if(real) {
 await unsafeFixtureUpdate("update public.cockpit_form_responses set answers=jsonb_set(answers,'{facebookAds}', '\"unknown-option\"')");
 assert.equal(await read(),null,'unknown choice');
 await unsafeFixtureUpdate('update public.cockpit_form_responses set answers=$1::jsonb',[JSON.stringify(baseAnswers)]);
}
const changed={...baseAnswers,[real ? 'fullName' : 'required']:'Different fictional answer'};
await unsafeFixtureUpdate('update public.cockpit_form_responses set answers=$1::jsonb',[JSON.stringify(changed)]);
if(real) assert.equal(await read(),null,'current answers must reproduce the delivered comment');
await unsafeFixtureUpdate('update public.cockpit_form_responses set answers=$1::jsonb',[JSON.stringify(baseAnswers)]);
await db.exec('alter table public.cockpit_form_responses disable trigger cockpit_form_responses_guard');
assert.equal(await read(),null,'immutable-answer trigger disabled');
await db.exec('alter table public.cockpit_form_responses enable trigger cockpit_form_responses_guard');
await db.exec("update public.cockpit_clickup_writeback_queue set state='unknown'");
assert.equal(await read(),null,'uncertain receipt');
assert.equal((await db.query('select uses from native_research_private.capabilities')).rows[0].uses,0,'denials do not consume a claim');
await db.exec("update public.cockpit_clickup_writeback_queue set state='delivered'");
await db.exec("update public.cockpit_form_versions set schema=jsonb_set(schema,'{unreviewed}','true')");
assert.equal(await read(),null,'schema fingerprint drift');
await db.exec("update public.cockpit_form_versions set schema=schema-'unreviewed'");
await db.exec(real ? "create or replace function public.cockpit_form_stage4_text(p jsonb) returns text language sql as $$ select 'changed'::text $$"
                   : "create or replace function public.cockpit_form_stage4_text(jsonb) returns text language sql as $$ select 'changed'::text $$");
assert.equal(await read(),null,'printer dependency drift');
await db.exec(real ? capturedFunctions.find(x=>x.signature.startsWith('cockpit_form_stage4_text(')).definition
                   : "create or replace function public.cockpit_form_stage4_text(jsonb) returns text language sql as $$ SELECT 'synthetic'::text $$");
await db.query("insert into public.cockpit_form_responses values ($1,'test_task','onboarding',$3,'portal','submitted','live',now()+interval '1 minute','{}',$2,'{\"required\":\"newer\"}')",['55555555-5555-4555-8555-555555555555',invite,formVersion]);
assert.equal(await read(),null,'superseded response');
await db.query("delete from public.cockpit_form_responses where id=$1",['55555555-5555-4555-8555-555555555555']);
await db.query("insert into public.cockpit_form_responses values ($1,'test_task','onboarding',$3,'typeform_webhook','submitted','live',now()+interval '1 minute','{}',$2,'{}')",['55555555-5555-4555-8555-555555555555',invite,formVersion]);
assert.equal(await read(),null,'a newer legacy response also supersedes the native response');
await db.query("delete from public.cockpit_form_responses where id=$1",['55555555-5555-4555-8555-555555555555']);
await db.query("insert into public.cockpit_form_responses values ($1,'test_task','onboarding',$3,'typeform_webhook','confirmed','live',null,'{}',$2,'{}')",['55555555-5555-4555-8555-555555555555',invite,formVersion]);
assert.equal(await read(),null,'unknown competing response time');
await db.query("delete from public.cockpit_form_responses where id=$1",['55555555-5555-4555-8555-555555555555']);
await db.query("insert into public.cockpit_form_responses select $1,task_id,form_key,form_version,source,state,mode,submitted_at,answer_meta,invite_id,answers from public.cockpit_form_responses where id=$2",['55555555-5555-4555-8555-555555555555',response]);
assert.equal(await read(),null,'equal timestamps are ambiguous and fail closed');
await db.query("delete from public.cockpit_form_responses where id=$1",['55555555-5555-4555-8555-555555555555']);
// A direct DB caller can roll back a read after receiving results and avoid
// consuming the counter. This is an explicit activation blocker, not a pass
// on durable abuse limiting. A trusted gateway must commit before any output.
await db.exec('set role cockpit_native_research_reader');
for(let n=0;n<2;n++) { await db.exec('begin'); assert.ok(await read()); await db.exec('rollback'); }
await db.exec('reset role');
assert.equal((await db.query('select uses from native_research_private.capabilities')).rows[0].uses,0,'rollback does not create durable quota');
await db.exec('set role cockpit_native_research_reader');
const sourcePort=committedSourcePort(async (query,params,signal)=>{
 assert.equal(signal.aborted,false); return await db.query(query,[...params]);
});
const requestBinding={taskId:'test_task',responseId:response,schemaVersion:formVersion,commentId:'test_comment',commentSha256:digest};
const sourceIdentity={runId:'1',attempt:'1'};
const signal=new AbortController().signal;
const got=await sourcePort(requestBinding,secret,sourceIdentity,signal);
assert.ok(got,'valid synthetic response should pass'); assert.equal(got.responseId,response); assert.ok(got.answers.length>0);
assert.equal(await read({run:'2'}),null,'different run replay');
assert.equal(await read({attempt:2}),null,'different attempt replay');
await db.exec('reset role');
await unsafeFixtureUpdate("update public.cockpit_form_responses set state='confirmed'");
await db.exec('set role cockpit_native_research_reader');
assert.equal((await sourcePort(requestBinding,secret,sourceIdentity,signal)).state,'confirmed','the true response state is preserved');
for(let n=0;n<4;n++) assert.ok(await read());
assert.equal(await read(),null,'six committed reads exhausted');
await db.exec('reset role');
await db.exec("update native_research_private.capabilities set uses=0,run_id=null,run_attempt=null");
await db.exec('begin');
await db.exec("update native_research_private.capabilities set issued_at=clock_timestamp()-interval '1 second',expires_at=clock_timestamp()+interval '40 milliseconds'");
await db.exec('select pg_sleep(0.10)');
const expiredReservation=await db.query('select native_research_private.reserve_source($1,$2,$3,$4,$5,$6,$7,$8) value',[secret,'test_task',response,formVersion,'test_comment',digest,'1',1]);
assert.equal(expiredReservation.rows[0].value,null,'reservation expiration uses wall clock inside an old transaction');
await db.exec('rollback');
await db.exec('set role cockpit_native_research_reader');
let gatewaySql=[]; let failRead=false; let releaseDiscard=false;
const gateway=committedGateway({acquire:async()=>({
 idle:true,
 // PGlite does not expose command tags; this fixture labels successful local
 // transaction calls. A production driver must expose actual server tags.
 execute:async (statement,params)=>{gatewaySql.push(statement); if(failRead && statement===READ_SOURCE_SQL) throw Error('fictional failure'); const result=await db.query(statement,[...params]); return {...result,command:statement==='BEGIN'||statement==='COMMIT'?statement:undefined};},
 release:async ({discard})=>{releaseDiscard=discard;},
})});
const throughGateway=committedSourcePort(gateway);
assert.ok(await throughGateway(requestBinding,secret,sourceIdentity,signal));
assert.ok(await throughGateway(requestBinding,secret,sourceIdentity,signal));
assert.deepEqual(gatewaySql.slice(0,7),['select current_user as role','BEGIN','select native_research_private.reserve_source($1,$2,$3,$4,$5,$6,$7,$8) as admission','COMMIT','BEGIN',READ_SOURCE_SQL,'COMMIT']);
failRead=true;
assert.equal(await throughGateway(requestBinding,secret,sourceIdentity,signal),null,'source failure emits no answer');
assert.equal(releaseDiscard,true,'failed connection is discarded');
await db.exec('reset role');
assert.equal((await db.query('select reservations from native_research_private.gateway_quotas')).rows[0].reservations,3,'admission commits even when the source transaction fails');
assert.equal((await db.query('select uses from native_research_private.capabilities')).rows[0].uses,2,'failed source transaction did not expose or consume an answer');
for(const role of ['anon','authenticated','service_role']) {
 const {rows:[f]}=await db.query("select has_function_privilege($1,'native_research_private.reserve_source(text,text,uuid,integer,text,text,text,integer)','EXECUTE') allowed",[role]);
 assert.equal(f.allowed,false);
}
assert.equal((await db.query("select has_table_privilege('cockpit_native_research_reader','native_research_private.gateway_quotas','SELECT') allowed")).rows[0].allowed,false);
failRead=false;
await db.exec('set role cockpit_native_research_reader');
assert.equal(await throughGateway(requestBinding,secret,{runId:'456',attempt:'1'},signal),null,'quota is bound to the verified run');
for(let n=0;n<3;n++) assert.ok(await throughGateway(requestBinding,secret,sourceIdentity,signal));
assert.equal(await throughGateway(requestBinding,secret,sourceIdentity,signal),null,'six committed admissions exhaust quota');
await db.exec('reset role');
assert.equal((await db.query('select reservations from native_research_private.gateway_quotas')).rows[0].reservations,6);
if(process.env.PG_MODULE && process.env.PGLITE_PG_MODULE) {
  // Fictional session and transport. The in-memory socket cannot verify TLS;
  // these synthetic attributes exercise the guard only, never production TLS.
  await db.exec("delete from native_research_private.gateway_quotas; update native_research_private.capabilities set uses=0,run_id=null,run_attempt=null; create role synthetic_reader_login login noinherit; grant cockpit_native_research_reader to synthetic_reader_login; revoke execute on all functions in schema public from public");
  const pg=(await import(pathToFileURL(process.env.PG_MODULE).href)).default;
  const {createPgConfig}=await import(pathToFileURL(process.env.PGLITE_PG_MODULE).href);
  const rawPool=new pg.Pool(createPgConfig(db));
  const localClient=await rawPool.connect();
  await localClient.query('set session authorization synthetic_reader_login');
  Object.assign(localClient.connection.stream,{encrypted:true,authorized:true,servername:'db.example.invalid'});
  localClient.release();
  const owned=nodePostgresOwnedPool(rawPool,'synthetic_reader_login','db.example.invalid');
  const driverPort=committedSourcePort(committedGateway(owned));
  assert.ok(await driverPort(requestBinding,secret,sourceIdentity,signal),'node-postgres adapter, role, reservation and actual source SQL integrate');
  assert.ok(await driverPort(requestBinding,secret,sourceIdentity,signal),'reused connection resets to the restricted login');
  await rawPool.end();
}
console.log(`Synthetic local source-reader checks passed (v${formVersion}${real ? ', deployed schema definitions' : ', stubs'}).`);
await db.close();
