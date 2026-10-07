import {test,expect} from 'bun:test';
import {structuredJson} from './model';
import {prepareLaunch,readB2b} from './launch';
import {prepareRecommendation,executePlan} from './execute';
import {prepareSlack,prepareDetail} from './slack';
import {providerTools} from './tools';
import {cockpitTestDb,member,actor,owner,migration} from '../../../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';
type Row=Record<string,any>;
const scope={account:'123456',campaign:'222222',campaignName:'Client campaign',task:'card1'};
function provider(rows:Row[]){const calls:any[]=[];return {calls,async call(...args:any[]){calls.push(args);const row=rows.shift();if(!row)throw new Error('Unexpected request');return row;}};}
test('recommendations cap budget changes and refuse cuts to the last live ad',async()=>{
 const p=provider([{id:'222222',name:'Campaign',account_id:'123456',daily_budget:10000}]);
 const plan=await prepareRecommendation({action:'Raise to $500',targetBudget:500},scope,p);
 expect(plan.body?.daily_budget).toBe(12500);expect(p.calls.every(x=>x[1]==='GET')).toBe(true);
 await expect(prepareRecommendation({action:'Cut the worst ad'},scope,provider([{id:'222222',account_id:'123456'},{data:[{id:'333333',effective_status:'ACTIVE'}]}]))).rejects.toThrow('last live');
 await expect(prepareRecommendation({action:'Scale the winner'},scope,provider([{id:'222222',account_id:'123456',daily_budget:1000}]))).rejects.toThrow('$30');
});
test('paused B2B launch builds campaign/adset/clones with references and refuses prior intents',async()=>{
 const row={id:1,kind:'lead_gen',name:'Mahara | Lead Gen',brief:'Approved brief',daily_budget_usd:50,status:'ready',clone_ad_ids:['333333'],variants:[]};
 const plan=await prepareLaunch(row,provider([{id:'333333',name:'Winner',account_id:'746108264865897',creative:{id:'444444'}}]));
 expect(plan.steps.map(s=>s.body?.status)).toEqual(['PAUSED','PAUSED','PAUSED']);expect(plan.steps[0].body?.is_adset_budget_sharing_enabled).toBe('false');expect(plan.steps[1].body?.campaign_id).toBe('$step0.id');expect(plan.result.metaAdIds).toEqual(['$step2.id']);
 await expect(prepareLaunch({...row,launch_action_id:'prior'},provider([]))).rejects.toThrow('reconciliation');
});
test('Meta transport retains form encoding and nested parameter JSON from original tools',async()=>{
 let request:any;const p=providerTools(name=>name==='META_SYSTEM_TOKEN'?'SECRET':undefined,async()=>{},async(url:any,init:any)=>{request={url,init};return new Response('{"id":"123456"}');});
 await p.call('meta','POST','act_123456/campaigns',{name:'A & B',special_ad_categories:[],is_adset_budget_sharing_enabled:'false'});
 expect(request.url).toContain('/v21.0/');expect(request.init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');const fields=new URLSearchParams(request.init.body);expect(fields.get('name')).toBe('A & B');expect(fields.get('special_ad_categories')).toBe('[]');
});
test('provider errors retain useful codes while redacting server tokens',async()=>{
 const p=providerTools(()=> 'SECRET',async()=>{},async()=>new Response(JSON.stringify({error:{code:100,error_subcode:4834011,message:'Missing flag, token SECRET'}}),{status:400}));
 try{await p.call('meta','POST','123456',{});throw new Error('Expected refusal');}catch(error){expect(String(error)).toContain('100/4834011');expect(String(error)).not.toContain('SECRET');expect(String(error)).toContain('Missing flag');}
});
test('model helper falls back without leaking credentials and B2B source is fixed read-only',async()=>{
 const receipts:any[]=[];const requests:any[]=[];
 const result=await structuredJson('Approved copy',{type:'object'},k=>({AI_JSON_PROVIDERS:'openai,gemini',OPENAI_API_KEY:'SECRET1',GOOGLE_AI_API_KEY:'SECRET2'} as Row)[k],async r=>{receipts.push(r);},async(url:any,init:any)=>{requests.push({url,init});return requests.length===1?new Response('{}',{status:503}):new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{"variants":[]}'}]}}]}));});
 expect(result).toEqual({variants:[]});expect(JSON.stringify(receipts)).not.toContain('SECRET');expect(requests).toHaveLength(2);
 let body:any;await readB2b('flwboeijllbtrufxkhts','select 1',()=> 'TOKEN',async()=>{},async(_u:any,init:any)=>{body=JSON.parse(init.body);return new Response('[]');});expect(body.read_only).toBe(true);
 await expect(readB2b('other','select 1',()=> 'TOKEN',async()=>{})).rejects.toThrow('fixed');
});
test('Slack and task questions require confirmed transport receipts, never queue success',async()=>{
 const plan=prepareSlack({request:'Please review this'},scope,'buyer@example.com',()=>undefined);
 expect(plan.body?.channel).toBe('U09305KE2KS');const p=provider([{ok:true,ts:'1234.567',channel:'D123ABC'},{messages:[{ts:'1234.567',text:plan.body?.text}]}]);
 await executePlan(plan,p);expect(p.calls).toHaveLength(2);
 await expect(executePlan(plan,provider([{ok:true,ts:'1234.567',channel:'D123ABC'},{messages:[]}]))).rejects.toThrow('read-back');
 await expect(prepareDetail({taskId:'other',question:'What happened?'},scope,'buyer@example.com',provider([]))).rejects.toThrow('authorized');
});
test('workflow SQL preserves empty-client access, founder drafts, scoped language and real learning/history effects',async()=>{
 const db=await cockpitTestDb();const buyer='00000000-0000-0000-0000-000000000011',founder='00000000-0000-0000-0000-000000000012',other='00000000-0000-0000-0000-000000000013',receipt='00000000-0000-0000-0000-000000000099';
 try{
  await db.exec('CREATE TABLE public.clients(id uuid PRIMARY KEY);');const table=migration('20260923o_cockpit_domain_tables.sql').match(/CREATE TABLE IF NOT EXISTS public\.cockpit_campaigns \([\s\S]*?\n\);/)![0];await db.exec(table);await db.exec('ALTER TABLE public.cockpit_campaigns ADD COLUMN source_deleted boolean DEFAULT false;');
  const touch=migration('20260919_cockpit_core.sql').match(/create or replace function public\.cockpit_touch_updated_at\(\)[\s\S]*?\$\$;/i)![0];await db.exec(touch);await db.exec(migration('20260919c_ad_drafts.sql'));
  const ownerAllowed=migration('20260927a_cockpit_ask_ai_jobs.sql').match(/CREATE OR REPLACE FUNCTION public\.cockpit_ask_ai_owner_allowed\([\s\S]*?\$\$;/)![0];await db.exec(ownerAllowed);
  await db.exec(migration('20260927g_cockpit_media_actions.sql'));await db.exec(migration('20260927u_cockpit_media_workflows.sql'));
  await db.exec(`CREATE FUNCTION public.cockpit_media_source_read() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"tables":{"offBoardCampaigns":[{"campaignName":"Off board","clientName":"Client A","accountName":"Account A"}],"inbox":[{"taskId":"inbox1","title":"Question"}]},"source":{}}'::jsonb $$;`);
  await member(db,buyer,'buyer@example.com',['media_buyer']);await member(db,founder,'aziz@maharamedia.com',[]);await member(db,other,'csm@example.com',['csm']);
  await db.exec(`INSERT INTO public.cockpit_campaigns(client_name,meta_campaign_id,meta_account_id,task_id,cpl,raw_data) VALUES('Client A','222222','123456','card1',10,'{"campaignName":"Campaign A","clientName":"Client A","findings":[]}');`);
  await actor(db,buyer);expect((await db.query('SELECT * FROM public.cockpit_media_live_campaigns()')).rows).toHaveLength(1);
  expect((await db.query<any>(`SELECT public.cockpit_media_scope('board.addToBoard','Off board') AS s`)).rows[0].s.client).toBe('Client A');
  expect((await db.query<any>(`SELECT public.cockpit_media_task_scope('inbox1') AS s`)).rows[0].s.task).toBe('inbox1');
  await expect(db.query(`SELECT public.cockpit_media_scope('control.setStatus','Off board')`)).rejects.toThrow('missing');
  await db.query(`SELECT public.cockpit_media_preferences('Client A','en')`);expect((await db.query<any>(`SELECT public.cockpit_media_preferences() AS p`)).rows[0].p).toEqual([{clientName:'Client A',language:'en'}]);
  await expect(db.query(`SELECT public.cockpit_b2b_draft_action('list')`)).rejects.toThrow('Founder');
  await actor(db,other);await expect(db.query('SELECT * FROM public.cockpit_media_live_campaigns()')).rejects.toThrow('Media buyer');
  await actor(db,founder);const begun=(await db.query<any>(`SELECT public.cockpit_b2b_draft_action('begin',$1) AS r`,[{kind:'lead_gen',brief:'An approved sufficiently long brief',dailyBudgetUsd:50,requestId:receipt}])).rows[0].r;expect(begun.created).toBe(true);
  expect((await db.query<any>(`SELECT public.cockpit_b2b_draft_action('begin',$1) AS r`,[{kind:'lead_gen',brief:'An approved sufficiently long brief',dailyBudgetUsd:50,requestId:receipt}])).rows[0].r.created).toBe(false);
  await expect(db.query(`SELECT public.cockpit_b2b_draft_action('begin',$1)`,[{kind:'lead_gen',brief:'A changed brief for this same request',dailyBudgetUsd:50,requestId:receipt}])).rejects.toThrow('different inputs');
  await owner(db);await db.query(`UPDATE public.cockpit_ad_drafts SET status='ready' WHERE id=$1`,[begun.draft.id]);const ready=(await db.query<any>('SELECT to_jsonb(d) AS r FROM public.cockpit_ad_drafts d')).rows[0].r;
  const launchReceipt='00000000-0000-0000-0000-000000000098';await db.query(`INSERT INTO public.cockpit_media_actions(id,actor_id,operation,request) VALUES($1,$2,'ceo.b2bLaunch.launch',$3)`,[launchReceipt,founder,{args:{id:ready.id}}]);
  await db.query('SELECT public.cockpit_claim_b2b_launch($1,$2,$3)',[launchReceipt,ready.id,ready]);await expect(db.query('SELECT public.cockpit_claim_b2b_launch($1,$2,$3)',[launchReceipt,ready.id,ready])).rejects.toThrow('changed');
  await db.query(`SELECT public.cockpit_finish_media_action($1,$2,'{}')`,[launchReceipt,{ok:true,metaCampaignId:'777777',metaAdsetId:'888888',metaAdIds:['999999']}]);expect((await db.query<any>('SELECT status,meta_campaign_id FROM public.cockpit_ad_drafts')).rows[0]).toEqual({status:'launched',meta_campaign_id:'777777'});
  await owner(db);await db.query(`INSERT INTO public.cockpit_media_actions(id,actor_id,operation,campaign_name,request) VALUES($1,$2,'execute.runAction','Campaign A','{"args":{"action":"Scale the winner"}}')`,[receipt,buyer]);await db.query(`SELECT public.cockpit_finish_media_action($1,'{"ok":true,"did":"Raised campaign budget to $125"}','{}')`,[receipt]);
  await actor(db,buyer);const rows=(await db.query<any>('SELECT * FROM public.cockpit_media_live_campaigns()')).rows;expect(rows[0].raw_data.lastChangeAt).toBeGreaterThan(0);expect(rows[0].raw_data.findings[0].constraint).toContain('learning');
  expect((await db.query<any>(`SELECT public.cockpit_media_campaign_history('Campaign A') AS h`)).rows[0].h[0].text).toContain('$125');
  await db.query(`SELECT public.cockpit_dismiss_offboard('Campaign A')`);expect((await db.query<any>('SELECT * FROM public.cockpit_media_live_campaigns()')).rows[0].raw_data.offBoardDismissed).toBe(true);
  await owner(db);await db.exec(`UPDATE public.cockpit_members SET clients=ARRAY['Other client'] WHERE auth_user_id='${buyer}'`);await actor(db,buyer);expect((await db.query('SELECT * FROM public.cockpit_media_live_campaigns()')).rows).toHaveLength(0);
  await expect(db.query(`SELECT public.cockpit_media_task_scope('inbox1')`)).rejects.toThrow('access list');
  await expect(db.query(`SELECT public.cockpit_media_scope('board.addToBoard','Off board')`)).rejects.toThrow('access list');
 }finally{await db.close();}
},20000);
