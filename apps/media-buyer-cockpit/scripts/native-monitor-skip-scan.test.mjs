import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
// Fictional ledgers only. Proves 20261019140000 returns exactly what the
// 20261009n DISTINCT ON read returned, on the same rows.
const sql = name => readFileSync(new URL(`../../../supabase/migrations/${name}`,import.meta.url),'utf8');
const md5 = text => createHash('md5').update(text).digest('hex');
const ledgers = ['cockpit_media_provider_health','cockpit_csm_provider_health','cockpit_ceo_provider_health'];
const skipScan = '20261019140000_native_monitor_skip_scan.sql';
async function fixture(){
 const db=new PGlite();
 await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE cockpit_sections(key text,ok boolean,error text,computed_at timestamptz);
 CREATE TABLE cockpit_media_provider_health(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,provider text NOT NULL,resource text NOT NULL,method text,phase text,http_status int,created_at timestamptz DEFAULT now());
 CREATE TABLE cockpit_ceo_provider_health(LIKE cockpit_media_provider_health INCLUDING ALL);
 CREATE TABLE cockpit_csm_provider_health(LIKE cockpit_media_provider_health INCLUDING ALL);
 CREATE TABLE cockpit_native_stills(key text PRIMARY KEY,data jsonb);
 CREATE TABLE cockpit_native_media_runs(run_id uuid PRIMARY KEY,status text,plan jsonb,error text,created_at timestamptz DEFAULT now(),published_at timestamptz DEFAULT now());
 CREATE TABLE cockpit_ceo_refresh_runs(run_id uuid PRIMARY KEY,status text,error text,created_at timestamptz,finished_at timestamptz);
 `);
 for(const name of ['20261004z_native_monitor.sql','20261008j_native_receipt_classification.sql',
  '20261008l_native_receipt_phase_correction.sql','20261009n_native_monitor_speed.sql'])await db.exec(sql(name));
 // Same partial index as 20261009m, which the skip scan walks.
 for(const table of ledgers)await db.exec(`CREATE INDEX ${table}_latest_idx ON ${table}(provider,resource,created_at DESC,id DESC)
  INCLUDE(phase,http_status,method) WHERE phase<>'intent'`);
 return db;
}
async function receipt(db,table,provider,resource,phase,status,at){
 await db.query(`INSERT INTO ${table}(provider,resource,method,phase,http_status,created_at) VALUES($1,$2,'GET',$3,$4,$5)`,[provider,resource,phase,status,at]);
}
async function checks(db){const {rows}=await db.query('SELECT public.cockpit_native_monitor_base() AS s');return rows[0].s.checks;}
const providerChecks = list => list.filter(c=>c.key.startsWith('source:cockpit_'));
function random(seed){return()=>{seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const pick = (next,list) => list[Math.floor(next()*list.length)];
async function grants(db){
 const {rows}=await db.query(`SELECT r.role,f.fn,has_function_privilege(r.role,f.fn,'EXECUTE') AS can
  FROM unnest(ARRAY['anon','authenticated','service_role']) r(role),
  unnest(ARRAY['public.cockpit_native_monitor_base()','public.cockpit_native_monitor()']) f(fn) ORDER BY 1,2`);
 return rows;
}

test('skip scan returns the same checks as DISTINCT ON on random fictional ledgers',async()=>{
 for(const seed of [1,2,3]){
  const db=await fixture();
  try{
   const next=random(seed);
   for(let i=0;i<400;i++){
    const provider=pick(next,['clickup','google','meta','storage','supabase']);
    const phase=pick(next,['intent','intent','response','response','response','failure','unknown']);
    // Six distinct minutes make created_at ties common, so id must break them.
    await receipt(db,pick(next,ledgers),provider,`fictional.example/${provider}/r${Math.floor(next()*12)}`,phase,
     phase==='unknown'?null:pick(next,[200,200,200,204,400,403,429,500,null]),
     new Date(Date.UTC(2026,9,19,8,Math.floor(next()*6))).toISOString());
   }
   const before=await checks(db);
   assert.ok(providerChecks(before).length>5,`seed ${seed} must exercise failing receipts`);
   await db.exec(sql(skipScan));
   assert.deepEqual(await checks(db),before,`seed ${seed}`);
  }finally{await db.close();}
 }
});

test('latest receipt rules: id breaks ties, intent is ignored, unknown stays open',async()=>{
 const db=await fixture();
 try{
  const media='cockpit_media_provider_health',ceo='cockpit_ceo_provider_health',at='2026-10-19T10:00:00Z';
  await receipt(db,media,'meta','fictional.example/tie-closed','response',400,at);
  await receipt(db,media,'meta','fictional.example/tie-closed','response',200,at);
  await receipt(db,media,'meta','fictional.example/tie-open','response',200,at);
  await receipt(db,media,'meta','fictional.example/tie-open','response',500,at);
  await receipt(db,media,'google','fictional.example/intent-after','response',403,at);
  await receipt(db,media,'google','fictional.example/intent-after','intent',null,'2026-10-19T10:05:00Z');
  await receipt(db,media,'storage','fictional.example/intent-only','intent',null,at);
  await receipt(db,ceo,'supabase','fictional.example/unknown','unknown',null,at);
  await receipt(db,ceo,'supabase','fictional.example/recovered','response',500,at);
  await receipt(db,ceo,'supabase','fictional.example/recovered','response',200,'2026-10-19T10:01:00Z');
  const expected=[[media,'fictional.example/intent-after'],[media,'fictional.example/tie-open'],[ceo,'fictional.example/unknown']]
   .map(([table,resource])=>`source:${table}:${md5(resource)}`).sort();
  const before=providerChecks(await checks(db));
  assert.deepEqual(before.map(c=>c.key).sort(),expected);
  await db.exec(sql(skipScan));
  assert.deepEqual(providerChecks(await checks(db)),before);
 }finally{await db.close();}
});

test('migration reapplies, keeps grants, and the wrapper view still reads',async()=>{
 const db=await fixture();
 try{
  await receipt(db,'cockpit_csm_provider_health','google','fictional.example/sheet','response',403,'2026-10-19T10:00:00Z');
  const access=await grants(db);
  await db.exec(sql(skipScan));
  await db.exec(sql(skipScan));
  assert.deepEqual(await grants(db),access);
  assert.equal(access.find(r=>r.role==='anon'&&r.fn.endsWith('monitor()')).can,false);
  const {rows}=await db.query("SELECT snapshot->'checks' AS checks FROM cockpit_native_monitor_state");
  assert.deepEqual(providerChecks(rows[0].checks).map(c=>c.name),['Provider google']);
 }finally{await db.close();}
});

test('the skip scan reads the latest-receipt index instead of sorting the ledger',async()=>{
 const db=await fixture();
 try{
  await db.exec(sql(skipScan));
  await db.exec('SET enable_seqscan=off');
  const {rows}=await db.query(`EXPLAIN WITH RECURSIVE g AS (
   (SELECT t.provider,t.resource FROM public.cockpit_media_provider_health t WHERE t.phase<>'intent'
     ORDER BY t.provider,t.resource,t.created_at DESC,t.id DESC LIMIT 1)
   UNION ALL
   SELECT n.provider,n.resource FROM g CROSS JOIN LATERAL (SELECT t.provider,t.resource FROM public.cockpit_media_provider_health t
     WHERE t.phase<>'intent' AND (t.provider,t.resource)>(g.provider,g.resource)
     ORDER BY t.provider,t.resource,t.created_at DESC,t.id DESC LIMIT 1) n) SELECT * FROM g`);
  const plan=rows.map(r=>r['QUERY PLAN']).join('\n');
  assert.match(plan,/cockpit_media_provider_health_latest_idx/);
  assert.doesNotMatch(plan,/\bSort\b/);
 }finally{await db.close();}
});
