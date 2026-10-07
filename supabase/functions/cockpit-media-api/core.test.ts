import {describe,it,expect} from 'bun:test';
import {assertObjectScope,budget,confirmed,prepare,ADS_LIST,STATUS_FIELD,CITIES_FIELD,type Row} from './core';
import {providerTools} from './tools';
const scope={account:'123456',campaign:'999999',task:'taskabc',campaignName:'Campaign'};
function provider(rows:Row[]) { const calls:unknown[]=[];return {calls,async call(...args:unknown[]){calls.push(args);const row=rows.shift();if(!row)throw new Error('unexpected call');return row;}}; }
describe('provider action plans',()=>{
 it('rejects cross-account and same-account cross-campaign spoofing',()=>{
  expect(()=>assertObjectScope({account_id:'000000',campaign_id:'999999'},scope,'888888')).toThrow();
  expect(()=>assertObjectScope({account_id:'123456',campaign_id:'111111'},scope,'888888')).toThrow();
  assertObjectScope({account_id:'123456',campaign_id:'999999'},scope,'888888');
 });
 it('CEO scope remains pinned to its fixed account',()=>expect(()=>assertObjectScope({account_id:'123456'},{founder:true,account:'746108264865897'},'888888')).toThrow());
 it('previews a toggle without any writes',async()=>{
  const p=provider([{account_id:'123456',campaign_id:'999999'}]);
  const plan=await prepare('control.setStatus',{metaId:'888888',active:false,level:'ad'},scope,p);
  expect(plan).toMatchObject({method:'POST',body:{status:'PAUSED'}});expect(p.calls.every((x:any)=>x[1]==='GET')).toBe(true);
 });
 it('routes CBO budgets to campaign and rejects lifetime budgets',async()=>{
  const obj={account_id:'123456',campaign_id:'999999',campaign:{id:'999999',daily_budget:'1000'}};
  expect(await prepare('edit.setAdSetBudget',{adsetId:'888888',dailyBudget:45},scope,provider([obj]))).toMatchObject({path:'999999',body:{daily_budget:4500}});
  await expect(prepare('edit.setAdSetBudget',{adsetId:'888888',dailyBudget:45},scope,provider([{...obj,campaign:{id:'999999',lifetime_budget:'5000'}}]))).rejects.toThrow('lifetime');
 });
 it('rejects negative, nonfinite and zero budgets',()=>{for(const n of [-1,0,NaN,Infinity])expect(()=>budget(n)).toThrow();});
 it('duplicates paused and repairs Instagram placement dependency',async()=>{
  const plan:any=await prepare('edit.duplicateAdSet',{adsetId:'888888',newName:'Test'},scope,provider([{account_id:'123456',campaign_id:'999999',campaign:{id:'999999'},targeting:{instagram_positions:['explore_home']},daily_budget:1200}]));
  expect(plan.body.status).toBe('PAUSED');expect(JSON.parse(plan.body.targeting).instagram_positions).toEqual(['explore_home','explore']);
 });
 it('requires live board options and correct list',async()=>{
  const fields={fields:[{id:STATUS_FIELD,type_config:{options:[{id:'option',name:'Paused'}]}}]};
  await expect(prepare('board.setAdStatus',{status:'Unknown'},scope,provider([fields]))).rejects.toThrow();
  await expect(prepare('board.setAdStatus',{status:'Paused'},scope,provider([fields,{list:{id:'other'}}]))).rejects.toThrow('board');
  expect(await prepare('board.setAdStatus',{status:'Paused'},scope,provider([fields,{list:{id:ADS_LIST}}]))).toMatchObject({body:{value:'option'}});
 });
 it('clears cities with DELETE and checks unordered read-back',async()=>{
  const p=provider([{fields:[{id:CITIES_FIELD,type_config:{options:[{id:'kw',label:'Kuwait'}]}}]},{list:{id:ADS_LIST}}]);
  expect(await prepare('board.setAdvertisingCities',{cities:[]},scope,p)).toMatchObject({method:'DELETE'});
  expect(confirmed({custom_fields:[{id:'city',value:['b','a']}]},{field:'city',value:['a','b']})).toBe(true);
  expect(confirmed({status:'ACTIVE'},{status:'PAUSED'})).toBe(false);
 });
 it('records provider intent and response without credential data',async()=>{
  const rows:Row[]=[];const calls:unknown[]=[];
  const p=providerTools(()=> 'SECRET',async r=>{rows.push(r);},async(...args:any[])=>{calls.push(args);return new Response('{"success":true}',{status:200});});
  await p.call('meta','POST','123456',{status:'PAUSED'});
  expect(rows.map(x=>x.phase)).toEqual(['intent','response']);expect(JSON.stringify(rows)).not.toContain('SECRET');expect(calls).toHaveLength(1);
 });
 it('never retries an ambiguous provider POST',async()=>{
  let calls=0;const rows:Row[]=[];
  const p=providerTools(()=> 'SECRET',async r=>{rows.push(r);},async()=>{calls++;throw new Error('timeout');});
  await expect(p.call('meta','POST','123456',{status:'PAUSED'})).rejects.toThrow('Reconcile');
  expect(calls).toBe(1);expect(rows.at(-1)?.phase).toBe('unknown');
 });
});
