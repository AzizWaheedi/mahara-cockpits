import {describe,it,expect} from 'bun:test';
import {assertObjectScope,budget,confirmed,prepare,ADS_LIST,STATUS_FIELD,CITIES_FIELD,type Row} from './core';
import {providerTools} from './tools';
import {budgetToUsd,budgetWords,spendToUsd,usdToBudget} from './currency';
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
  expect(await prepare('edit.setAdSetBudget',{adsetId:'888888',dailyBudget:45},scope,provider([obj,{currency:'USD'}]))).toMatchObject({path:'999999',body:{daily_budget:4500}});
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
describe('budgets in the account currency',()=>{
 const cbo={account_id:'123456',campaign_id:'999999',campaign:{id:'999999',daily_budget:'17500'}};
 const abo={account_id:'123456',campaign_id:'999999',campaign:{id:'999999'},targeting:{}};
 it('converts Meta budgets at the account rate, both ways',()=>{
  expect(budgetToUsd('17500','SAR')).toBeCloseTo(46.655,6);expect(budgetWords(budgetToUsd('17500','SAR')!,'SAR')).toBe('$46.66 (175.00 SAR in Meta)');
  expect(budgetToUsd('12000','SAR')).toBeCloseTo(31.992,6);expect(budgetWords(budgetToUsd('12000','SAR')!,'SAR')).toBe('$31.99 (120.00 SAR in Meta)');
  expect(usdToBudget(30,'SAR')).toBe(11253);expect(usdToBudget(30,'USD')).toBe(3000);expect(budgetWords(30,'USD')).toBe('$30.00');
  expect(budgetToUsd('3000','USD')).toBe(30);expect(budgetToUsd('10000','QAR')).toBeCloseTo(27.47,6);expect(budgetToUsd('10000','AED')).toBeCloseTo(27.23,6);
  for(const cur of ['KWD','JPY','',undefined])expect(budgetToUsd('17500',cur)).toBeUndefined();
  expect(()=>usdToBudget(30,'KWD')).toThrow('Change the budget in Ads Manager');expect(()=>usdToBudget(30,'')).toThrow('Ads Manager');
  expect(spendToUsd(757.32,'SAR')).toBeCloseTo(201.90,2);expect(spendToUsd(10,'KWD')).toBeCloseTo(32.6,6);expect(spendToUsd(10,'')).toBeUndefined();
 });
 it('sends typed dollars to a riyal account as halalas, in the body and the read-back',async()=>{
  const p=provider([cbo,{currency:'SAR'}]);
  expect(await prepare('edit.setAdSetBudget',{adsetId:'888888',dailyBudget:30},scope,p)).toMatchObject({path:'999999',body:{daily_budget:11253},expected:{daily_budget:11253}});
  expect(p.calls[1]).toEqual(['meta','GET','act_123456?fields=currency']);
  expect(await prepare('edit.setAdSetBudget',{adsetId:'888888',dailyBudget:30},scope,provider([cbo,{currency:'USD'}]))).toMatchObject({body:{daily_budget:3000},expected:{daily_budget:3000}});
 });
 it('refuses a budget write when Meta gives no currency or one without an offset',async()=>{
  await expect(prepare('edit.setAdSetBudget',{adsetId:'888888',dailyBudget:30},scope,provider([cbo,{currency:'KWD'}]))).rejects.toThrow('This ad account is in KWD. Change the budget in Ads Manager.');
  await expect(prepare('edit.setAdSetBudget',{adsetId:'888888',dailyBudget:30},scope,provider([cbo,{id:'act_123456'}]))).rejects.toThrow('Meta did not say which currency');
  await expect(prepare('edit.duplicateAdSet',{adsetId:'888888',newName:'Copy'},scope,provider([abo,{currency:'JPY'}]))).rejects.toThrow('Change the budget in Ads Manager');
 });
 it('checks the typed range before reading the currency',async()=>{
  const p=provider([cbo]);
  await expect(prepare('edit.setAdSetBudget',{adsetId:'888888',dailyBudget:0},scope,p)).rejects.toThrow('between 0 and 100000');expect(p.calls).toHaveLength(1);
 });
 it('duplicates on a riyal account: typed and default budgets convert, a copied budget passes unchanged',async()=>{
  const typed:any=await prepare('edit.duplicateAdSet',{adsetId:'888888',newName:'Copy',dailyBudget:30},scope,provider([{...abo,daily_budget:'5000'},{currency:'SAR'}]));
  expect(typed.body.daily_budget).toBe(11253);
  const fallback:any=await prepare('edit.duplicateAdSet',{adsetId:'888888',newName:'Copy'},scope,provider([abo,{currency:'SAR'}]));
  expect(fallback.body.daily_budget).toBe(11253);
  const p=provider([{...abo,daily_budget:'5000'}]);const copied:any=await prepare('edit.duplicateAdSet',{adsetId:'888888',newName:'Copy'},scope,p);
  expect(copied.body.daily_budget).toBe('5000');expect(p.calls).toHaveLength(1);
  const q=provider([{...abo,campaign:{id:'999999',daily_budget:'17500'}}]);const underCbo:any=await prepare('edit.duplicateAdSet',{adsetId:'888888',newName:'Copy',dailyBudget:30},scope,q);
  expect(underCbo.body.daily_budget).toBeUndefined();expect(q.calls).toHaveLength(1);
 });
 it("checks Mahara's account is in dollars before a B2B budget write",async()=>{
  const ceo={account:'746108264865897',founder:true},campaign={id:'123456',account_id:'746108264865897',daily_budget:'2000'};
  const p=provider([campaign,{currency:'USD'}]);
  expect(await prepare('ceo.b2bManage.setBudget',{level:'campaign',metaId:'123456',dailyUsd:25},ceo,p)).toMatchObject({body:{daily_budget:2500},expected:{daily_budget:2500}});
  expect(p.calls[1]).toEqual(['meta','GET','act_746108264865897?fields=currency']);
  await expect(prepare('ceo.b2bManage.setBudget',{level:'campaign',metaId:'123456',dailyUsd:25},ceo,provider([campaign,{currency:'SAR'}]))).rejects.toThrow('not USD');
  const read=provider([campaign]);expect(await prepare('ceo.b2bManage.inspect',{level:'campaign',metaId:'123456'},ceo,read)).toMatchObject({read:{dailyBudgetUsd:20}});expect(read.calls).toHaveLength(1);
  await expect(prepare('ceo.b2bManage.inspect',{level:'campaign',metaId:'123456'},{account:'718146936708597',founder:true},provider([]))).rejects.toThrow("Mahara's own ad account");
 });
 it("checks Mahara's account is in dollars before a B2B new ad set carries its own budget",async()=>{
  const ceo={account:'746108264865897',founder:true},abo={id:'123456',account_id:'746108264865897'},source={id:'654321',account_id:'746108264865897',targeting:{geo_locations:{countries:['KW']}}};
  const args={campaignId:'123456',copyFromAdsetId:'654321',name:'Kuwait | fresh',dailyBudgetUsd:25};
  const p=provider([abo,source,{currency:'USD'}]);const plan:any=await prepare('ceo.b2bManage.createAdset',args,ceo,p);
  expect(plan.body.daily_budget).toBe(2500);expect(p.calls[2]).toEqual(['meta','GET','act_746108264865897?fields=currency']);
  await expect(prepare('ceo.b2bManage.createAdset',args,ceo,provider([abo,source,{currency:'SAR'}]))).rejects.toThrow('not USD');
  // Under a campaign budget the new ad set carries none, so Meta is not asked for the currency.
  const cbo=provider([{...abo,daily_budget:'2000'},source]);const underCbo:any=await prepare('ceo.b2bManage.createAdset',args,ceo,cbo);
  expect(underCbo.body.daily_budget).toBeUndefined();expect(cbo.calls).toHaveLength(2);
 });
});
