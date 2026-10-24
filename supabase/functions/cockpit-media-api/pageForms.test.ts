import {test,expect} from 'bun:test';
import {pageFormOperation,type FormRow,type PageFormDeps,type PageFormStore,type VersionRow} from './pageForms';
type Row=Record<string,any>;

const BUILT={version:'v1',questions:[
 {key:'project_type',name:'نوع المشروع',label:'شنو نوع مشروعك؟',style:'photo',param:'ms_project_type',ghl_field:'Merge Studio LP | Project Type / نوع المشروع',options:[{value:'فيلا كاملة',image:'type-villa',icon:'home'},{value:'شقة كاملة',image:'type-apartment',icon:'building'}]},
 {key:'timing',name:'موعد البداية',label:'متى حاب تبدأ؟',style:'list',param:'ms_timing',options:[{value:'بأقرب وقت',icon:'bolt'},{value:'خلال شهر',icon:'calendar'}]},
]};
const REQ='11111111-2222-4333-8444-555555555555';

/** A page, its versions and its bucket in memory, with every call written down. */
function world(opts:{live?:number;versions?:VersionRow[];built?:Row|null;uploadFails?:boolean;storedDiffers?:boolean;publicDown?:boolean;noCounts?:boolean}={}){
 const calls:string[]=[];
 const form:FormRow={slug:'mergestudio',client_name:'mergestudio.kw',title:'Merge Studio form page',site_url:'https://mergestudio-form.vercel.app',object_path:'mergestudio/live.json',photos:['type-villa','type-apartment','band-dining'],bindings:{project_type:'ms_project_type',timing:'ms_timing'},live_version:opts.live??null};
 const versions:VersionRow[]=[...(opts.versions??[])];
 const files:Record<string,string>={};
 const actions:Record<string,Row>={};
 const health:Row[]=[];
 const store:PageFormStore={
  async forms(slugs){calls.push(`forms ${slugs}`);return slugs.includes(form.slug)?[{...form}]:[];},
  async versions(){return [...versions].sort((a,b)=>b.version-a.version);},
  async record(a){
   calls.push(`record base=${a.base} baseline=${!!a.baseline}`);
   if((form.live_version??0)!==a.base)throw new Error('Someone published a newer version');
   if(!versions.length&&a.baseline)versions.push({version:1,spec:{questions:a.baseline.questions},summary:'built',source:'build',actor_email:null,created_at:'t',first_live_at:'t'});
   const n=Math.max(0,...versions.map(v=>v.version))+1;
   versions.push({version:n,spec:a.spec,summary:a.summary,source:'cockpit',actor_email:a.email,created_at:'t',first_live_at:null});
   return n;
  },
  async goLive(_slug,version,base){calls.push(`goLive ${version} base=${base}`);if((form.live_version??0)!==base)throw new Error('changed');form.live_version=version;},
  async upload(path,body){calls.push(`upload ${path}`);if(opts.uploadFails)throw new Error('bucket missing');files[path]=body;},
  async download(path){const body=files[path];if(opts.storedDiffers)return JSON.stringify({...JSON.parse(body),version:'v0'});return body;},
  publicUrl:path=>`https://db.example/storage/v1/object/public/page-forms/${path}`,
  async begin(row){calls.push(`begin ${row.operation}`);const prior=actions[row.id];if(prior){if(prior.state==='confirmed')return prior.result;throw new Error('already');}actions[row.id]={state:'pending',...row};return null;},
  async finish(id,result){calls.push('finish');actions[id]={...actions[id],state:'confirmed',result};},
  async reconcile(id,message){calls.push('reconcile');actions[id]={...actions[id],state:'reconcile',message};},
  async funnel(slug,version,since,adsOnly){calls.push(`funnel ${slug} ${version} ${since.toISOString().slice(0,10)} ${adsOnly?'ads':'all'}`);return {screens:{intro:100,'q:project_type':60,'q:timing':45,contact:40,send:22,thanks:20,'q:retired':9},versions:[{version:'v1',visits:100}],lastAt:'2026-10-22T11:00:00Z',hosts:['mergestudio-form.vercel.app'],...(opts.noCounts?{}:{counts:{all:130,ads:100}})};},
 };
 const fetcher=(async(url:string)=>{
  calls.push(`fetch ${url}`);
  if(url.endsWith('/form.json'))return opts.built===null?new Response('nope',{status:404}):new Response(JSON.stringify(opts.built??BUILT));
  if(opts.publicDown)return new Response('down',{status:502});
  return new Response(files['mergestudio/live.json']??'{}');
 }) as typeof fetch;
 const scopes:Row[]=[];
 const d:PageFormDeps={store,fetch:fetcher,health:async r=>{health.push(r);},scope:async(slug,client)=>{scopes.push({slug,client});if(client&&client!=='mergestudio.kw')return {actor:'u1',slugs:[]};return {actor:'u1',email:'mb@maharamedia.com',slugs:['mergestudio']};},now:()=>new Date('2026-10-22T12:00:00Z')};
 return {d,calls,form,versions,files,actions,health,scopes};
}
const draft=(edit?:(q:Row[])=>void)=>{const questions=structuredClone(BUILT.questions);edit?.(questions);return {questions};};

test('read shows the built questions before the first publish', async () => {
 const w=world();
 const out=await pageFormOperation('pageForms.read',{client:'mergestudio.kw'},false,undefined,w.d) as Row;
 expect(out.pages).toHaveLength(1);
 expect(out.pages[0].liveVersion).toBe(0);
 expect(out.pages[0].current.questions[0].key).toBe('project_type');
 expect(out.pages[0].publicUrl).toBe('https://db.example/storage/v1/object/public/page-forms/mergestudio/live.json');
 expect(w.health.map(h=>`${h.provider} ${h.phase}`)).toEqual(['page intent','page response']);
});

test('read lists nothing for a client the member cannot reach', async () => {
 const w=world();
 const out=await pageFormOperation('pageForms.read',{client:'someone.else'},false,undefined,w.d) as Row;
 expect(out.pages).toEqual([]);
});

test('a dry run checks the draft and writes nothing', async () => {
 const w=world();
 const out=await pageFormOperation('pageForms.publish',{slug:'mergestudio',base:0,spec:draft(q=>q.pop())},false,undefined,w.d) as Row;
 expect(out).toMatchObject({ok:false,dryRun:true,summary:'Removed "موعد البداية"'});
 expect(w.calls.some(c=>c.startsWith('upload')||c.startsWith('record')||c.startsWith('begin'))).toBe(false);
});

test('the first publish keeps the built questions as v1, goes live as v2 and reads the file back', async () => {
 const w=world();
 const out=await pageFormOperation('pageForms.publish',{slug:'mergestudio',base:0,spec:draft(q=>{q.push({key:'q_budget',name:'الميزانية',label:'كم الميزانية؟',style:'list',param:'ms_forged',options:[{value:'أقل'},{value:'أكثر'}]});})},true,REQ,w.d) as Row;
 expect(out).toMatchObject({ok:true,version:2,label:'v2',receiptId:REQ});
 expect(out.did).toBe('Merge Studio form page: Added "الميزانية" (v2)');
 expect(w.versions.map(v=>`${v.version}:${v.source}`)).toEqual(['1:build','2:cockpit']);
 expect(w.form.live_version).toBe(2);
 const file=JSON.parse(w.files['mergestudio/live.json']);
 expect(file.version).toBe('v2');
 expect(file.questions).toHaveLength(3);
 // params come from the page's bindings, never from the browser
 expect(file.questions[0].param).toBe('ms_project_type');
 expect(file.questions[2].param).toBeUndefined();
 expect(file.questions[0].ghl_field).toBeUndefined();
 expect(w.calls.filter(c=>/^(begin|record|upload|goLive|finish)/.test(c))).toEqual(['begin pageForms.publish','record base=0 baseline=true','upload mergestudio/live.json','goLive 2 base=0','finish']);
 expect(w.health.filter(h=>h.provider==='storage').map(h=>`${h.method} ${h.phase}`)).toEqual(['PUT intent','PUT response','GET intent','GET response']);
});

test('publishing from a stale base is refused before anything is written', async () => {
 const w=world({live:3,versions:[{version:3,spec:draft(),summary:'',source:'cockpit',actor_email:null,created_at:'t',first_live_at:'t'}]});
 await expect(pageFormOperation('pageForms.publish',{slug:'mergestudio',base:2,spec:draft(q=>q.pop())},true,REQ,w.d)).rejects.toThrow('Someone published a newer version');
 expect(w.calls.some(c=>c.startsWith('begin'))).toBe(false);
});

test('a draft with problems is refused with the first problem', async () => {
 const w=world();
 const out=await pageFormOperation('pageForms.publish',{slug:'mergestudio',base:0,spec:draft(q=>{q[1].options=[{value:'واحد'}];})},true,REQ,w.d) as Row;
 expect(out.ok).toBe(false);
 expect(out.error).toBe('Question 2 needs at least two answers.');
 expect(w.calls.some(c=>c.startsWith('begin'))).toBe(false);
});

test('an unchanged draft is not published', async () => {
 const w=world();
 const out=await pageFormOperation('pageForms.publish',{slug:'mergestudio',base:0,spec:draft()},true,REQ,w.d) as Row;
 expect(out.error).toBe('Nothing changed. Edit a question before you publish.');
});

test('a failed upload leaves the receipt to reconcile and the page as it was', async () => {
 const w=world({uploadFails:true});
 await expect(pageFormOperation('pageForms.publish',{slug:'mergestudio',base:0,spec:draft(q=>q.pop())},true,REQ,w.d)).rejects.toThrow(`bucket missing. Reconcile before retrying. (receipt ${REQ})`);
 expect(w.form.live_version).toBeNull();
 expect(w.actions[REQ].state).toBe('reconcile');
});

test('a read-back that does not match is not marked live', async () => {
 const w=world({storedDiffers:true});
 await expect(pageFormOperation('pageForms.publish',{slug:'mergestudio',base:0,spec:draft(q=>q.pop())},true,REQ,w.d)).rejects.toThrow('reading it back did not show this version');
 expect(w.form.live_version).toBeNull();
 expect(w.calls).toContain('reconcile');
});

test('a public address that does not answer is not marked live', async () => {
 const w=world({publicDown:true});
 await expect(pageFormOperation('pageForms.publish',{slug:'mergestudio',base:0,spec:draft(q=>q.pop())},true,REQ,w.d)).rejects.toThrow('its public address does not serve it');
 expect(w.form.live_version).toBeNull();
});

test('the first publish is refused when the built questions cannot be read', async () => {
 const w=world({built:null});
 await expect(pageFormOperation('pageForms.publish',{slug:'mergestudio',base:0,spec:draft(q=>q.pop())},true,REQ,w.d)).rejects.toThrow('did not return the questions it was built with');
});

test('a retried request returns its first result and writes nothing again', async () => {
 const w=world();
 const args={slug:'mergestudio',base:0,spec:draft(q=>q.pop())};
 const first=await pageFormOperation('pageForms.publish',args,true,REQ,w.d) as Row;
 w.form.live_version=0; // the retry arrives with the same base as the first
 const again=await pageFormOperation('pageForms.publish',args,true,REQ,w.d) as Row;
 expect(again).toEqual(first);
 expect(w.calls.filter(c=>c.startsWith('upload'))).toHaveLength(1);
});

test('switch puts an earlier version back live without making a new one', async () => {
 const w=world();
 await pageFormOperation('pageForms.publish',{slug:'mergestudio',base:0,spec:draft(q=>q.pop())},true,REQ,w.d);
 const out=await pageFormOperation('pageForms.switch',{slug:'mergestudio',base:2,version:1},true,'21111111-2222-4333-8444-555555555555',w.d) as Row;
 expect(out).toMatchObject({ok:true,version:1,did:'Merge Studio form page: Switched back to v1'});
 expect(w.form.live_version).toBe(1);
 expect(w.versions).toHaveLength(2);
 expect(JSON.parse(w.files['mergestudio/live.json']).version).toBe('v1');
 const already=await pageFormOperation('pageForms.switch',{slug:'mergestudio',base:1,version:1},true,'31111111-2222-4333-8444-555555555555',w.d) as Row;
 expect(already.error).toBe('v1 is already live.');
});

test('a removed key cannot come back as a new question', async () => {
 const w=world();
 await pageFormOperation('pageForms.publish',{slug:'mergestudio',base:0,spec:draft(q=>q.pop())},true,REQ,w.d);
 const out=await pageFormOperation('pageForms.publish',{slug:'mergestudio',base:2,spec:draft()},false,undefined,w.d) as Row;
 expect(out.error).toBe('Question 2 reuses the key of a removed question.');
});

test('apply needs a request id', async () => {
 const w=world();
 await expect(pageFormOperation('pageForms.publish',{slug:'mergestudio',base:0,spec:draft(q=>q.pop())},true,'not-a-uuid',w.d)).rejects.toThrow('A request id is required');
});

test('the funnel follows the version\'s own questions, in order, and names zero visits as zero', async () => {
 const w=world();
 const out=await pageFormOperation('pageForms.funnel',{slug:'mergestudio',days:7},false,undefined,w.d) as Row;
 expect(out.version).toBe('v1');
 expect(out.steps.map((s:Row)=>`${s.screen}=${s.visits}`)).toEqual(['intro=100','q:project_type=60','q:timing=45','contact=40','send=22','thanks=20']);
 expect(out.steps[1].label).toBe('شنو نوع مشروعك؟');
 expect(w.calls).toContain('funnel mergestudio v1 2026-10-15 ads');
 expect(w.scopes).toContainEqual({slug:'mergestudio',client:null});
});

test('the funnel counts visits from ads unless all visits are asked for, and returns both totals', async () => {
 const w=world();
 const ads=await pageFormOperation('pageForms.funnel',{slug:'mergestudio',days:7},false,undefined,w.d) as Row;
 expect(ads.source).toBe('ads');
 expect(ads.counts).toEqual({all:130,ads:100});
 const all=await pageFormOperation('pageForms.funnel',{slug:'mergestudio',days:7,source:'all'},false,undefined,w.d) as Row;
 expect(all.source).toBe('all');
 await pageFormOperation('pageForms.funnel',{slug:'mergestudio',days:7,source:'bots'},false,undefined,w.d);
 expect(w.calls.filter(c=>c.startsWith('funnel'))).toEqual(['funnel mergestudio v1 2026-10-15 ads','funnel mergestudio v1 2026-10-15 all','funnel mergestudio v1 2026-10-15 ads']);
});

test('a funnel read from the old database function names missing totals as zero', async () => {
 const w=world({noCounts:true});
 const out=await pageFormOperation('pageForms.funnel',{slug:'mergestudio'},false,undefined,w.d) as Row;
 expect(out.counts).toEqual({all:0,ads:0});
});

test('the funnel of a published version uses that version, and refuses an unknown one', async () => {
 const w=world();
 await pageFormOperation('pageForms.publish',{slug:'mergestudio',base:0,spec:draft(q=>q.pop())},true,REQ,w.d);
 const out=await pageFormOperation('pageForms.funnel',{slug:'mergestudio',days:999},false,undefined,w.d) as Row;
 expect(out.version).toBe('v2');
 expect(out.days).toBe(30);
 expect(out.steps.map((s:Row)=>s.screen)).toEqual(['intro','q:project_type','contact','send','thanks']);
 await expect(pageFormOperation('pageForms.funnel',{slug:'mergestudio',version:'v9'},false,undefined,w.d)).rejects.toThrow('v9 is not a version of this page');
});
