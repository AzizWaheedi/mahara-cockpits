// OFFLINE TEST ONLY: synthetic database on a private Unix socket. Never connect to production.
import {SQL} from 'bun';
import {readFileSync} from 'node:fs';
const base=process.env.COCKPIT_REPO_ROOT!;
if (!process.env.SYNTHETIC_PG_SOCKET_DIR?.startsWith('/private/tmp/') || !process.env.COCKPIT_REPO_ROOT) throw Error('Synthetic socket and repository root required');
const opt={path:process.env.SYNTHETIC_PG_SOCKET_DIR!,username:'sandbox_test',database:'requests_probe',max:1};
const owner=new SQL(opt), a=new SQL(opt), b=new SQL(opt);
const assert=(v:any,msg:string)=>{if(!v)throw Error(msg)};
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function actor(c:SQL){await c.unsafe("SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-0000000000d1',false),set_config('request.jwt.claims','{\"sub\":\"00000000-0000-4000-8000-0000000000d1\",\"email\":\"sm@tests.invalid\",\"role\":\"authenticated\"}',false); SET ROLE authenticated").simple()}
async function save(c:SQL,patch:any,version:number){const x=await c.unsafe("SELECT public.cockpit_request_type_save('card_missing',$1::jsonb,$2) AS r",[patch,version]);return x[0].r}
async function submit(c:SQL,id:string){const x=await c.unsafe("SELECT public.cockpit_request_submit($1,'card_missing','taskacme1','{}'::jsonb,NULL,'normal','client_page',NULL) AS r",[id]);return x[0].r}
try {
 await owner.unsafe("CREATE TABLE public.cockpit_settings(key text PRIMARY KEY,value jsonb NOT NULL,updated_by text NOT NULL)");
 await owner.unsafe(readFileSync(base+'/docs/requests/drafts/versioned-policy-server-prototype.sql','utf8')).simple();
 await owner.unsafe("INSERT INTO public.cockpit_settings VALUES ('requests.retained_context_v1_ready','{\"ready\":true}'::jsonb,'synthetic')");
 await actor(a);await actor(b);
 const row=(await owner.unsafe("SELECT fields,version FROM public.cockpit_request_types WHERE key='card_missing'"))[0];
 const fields=[...row.fields,{key:'details',label:'What happened?',kind:'details',clickup_field_id:null,required:false,options:null,help:null}];
 const prepared=await save(a,{fields},row.version);let v=prepared.version;
 await a.unsafe('BEGIN');const accepted=await submit(a,'10000000-0000-4000-8000-000000000101');assert(accepted.id,'legacy submit did not return id');
 await b.unsafe('BEGIN');let finished=false;const activation=save(b,{retained_context_policy:'retained_v1'},v).then(x=>{finished=true;return x});await sleep(300);assert(!finished,'activation did not wait for actual legacy submit');
 await a.unsafe('COMMIT');const enabled=await activation;assert(enabled.retainedContextPolicy==='retained_v1','activation did not succeed');await b.unsafe('COMMIT');
 const back=await save(a,{retained_context_policy:'legacy'},enabled.version);v=back.version;
 await b.unsafe('BEGIN');const enabled2=await save(b,{retained_context_policy:'retained_v1'},v);
 await a.unsafe('BEGIN');finished=false;const stale=submit(a,'10000000-0000-4000-8000-000000000102').then(x=>({ok:true,x}),e=>({ok:false,e:String(e)})).finally(()=>{finished=true});await sleep(300);assert(!finished,'legacy submit did not wait for actual activation');
 await b.unsafe('COMMIT');const result=await stale;assert(!result.ok && result.e.includes('supported request form'),'legacy submit should fail closed after v1 commit: '+JSON.stringify(result));await a.unsafe('ROLLBACK');
 const count=(await owner.unsafe("SELECT count(*)::int AS n FROM public.cockpit_requests WHERE id IN ('10000000-0000-4000-8000-000000000101','10000000-0000-4000-8000-000000000102')"))[0].n;assert(count===1,'unexpected request count '+count);
 const legacy=await save(a,{retained_context_policy:'legacy'},enabled2.version);
 await b.unsafe('BEGIN');await save(b,{retained_context_policy:'retained_v1'},legacy.version);
 await a.unsafe('BEGIN');finished=false;const resumed=submit(a,'10000000-0000-4000-8000-000000000103').finally(()=>{finished=true});await sleep(300);assert(!finished,'submit did not wait for rolled-back activation');
 await b.unsafe('ROLLBACK');const resumedResult=await resumed;assert(resumedResult.id,'legacy submit did not proceed after rollback');await a.unsafe('COMMIT');
 console.log('PASS actual cockpit_request_submit / cockpit_request_type_save: both lock orders and rolled-back activation; synthetic fixture only');
} finally {await a.close();await b.close();await owner.close()}
