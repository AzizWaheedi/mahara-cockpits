import {test,expect} from 'bun:test';
import {prepare,type Row} from './core';
import {executePlan} from './execute';
const s={account:'746108264865897',founder:true};
function provider(rows:Row[]){const calls:any[]=[];return {calls,async call(...args:any[]){calls.push(args);const row=rows.shift();if(!row)throw new Error('Unexpected request');return row;}};}
test('B2B rename preserves attribution kind and budgets refuse invalid ownership',async()=>{
 await expect(prepare('ceo.b2bManage.rename',{level:'campaign',metaId:'123456',name:'Lead Gen'},s,provider([{account_id:s.account,name:'Retargeting'}]))).rejects.toThrow('kind');
 await expect(prepare('ceo.b2bManage.setBudget',{level:'adset',metaId:'123456',dailyUsd:25},s,provider([{account_id:s.account,campaign:{daily_budget:500}}]))).rejects.toThrow('campaign holds');
 await expect(prepare('ceo.b2bManage.setBudget',{level:'campaign',metaId:'123456',dailyUsd:6000},s,provider([{account_id:s.account,daily_budget:500}]))).rejects.toThrow('$5000');
});
test('audience changes preserve exclusion and placement details',async()=>{
 const plan:any=await prepare('ceo.b2bManage.setAudience',{adsetId:'123456',countries:['kw'],ageMin:25},s,provider([{id:'123456',account_id:s.account,targeting:{excluded_custom_audiences:[{id:'654321'}],geo_locations:{countries:['SA']},age_min:18,age_max:60}}]));
 expect(JSON.parse(plan.body.targeting)).toMatchObject({excluded_custom_audiences:[{id:'654321'}],geo_locations:{countries:['KW']},age_min:25,age_max:60});
});
test('creative copy plan resolves created IDs and verifies paused ads before success',async()=>{
 const p=provider([{id:'123456',name:'Winner',account_id:s.account,campaign_id:'333333',adset_id:'222222',creative:{object_story_spec:{page_id:'555555',link_data:{link:'https://example.com',image_hash:'abc',message:'Old'}}}},{id:'222222',account_id:s.account,campaign_id:'333333'}]);
 const plan:any=await prepare('edit.newAdsFromExisting',{sourceAdId:'123456',variants:[{headline:'Approved',message:'Approved body'}]},s,p);
 expect(p.calls.every(x=>x[1]==='GET')).toBe(true);expect(plan.steps).toHaveLength(2);
 const execution=provider([{id:'666666'},{id:'666666'},{id:'777777'},{id:'777777',status:'PAUSED',adset_id:'222222'}]);
 const result=await executePlan(plan,execution);
 expect(result.result.made).toEqual(['777777']);expect(JSON.parse(execution.calls[2][3].creative).creative_id).toBe('666666');
});
test('a failed intermediate readback stops later provider writes',async()=>{
 const p=provider([{id:'666666'},{id:'wrong'}]);
 await expect(executePlan({steps:[{provider:'meta',method:'POST',path:'act_123/adcreatives',body:{},verifyPath:'$id?fields=id',expected:{}},{provider:'meta',method:'POST',path:'act_123/ads',verifyPath:'$id',expected:{}}],result:{}},p)).rejects.toThrow('different object');
 expect(p.calls).toHaveLength(2);
});
test('duplicate adset and ads are all paused and cannot silently truncate source ads',async()=>{
 const base={id:'123456',account_id:s.account,campaign_id:'222222',name:'Set',campaign:{daily_budget:2000}};
 await expect(prepare('ceo.b2bManage.duplicateAdset',{adsetId:'123456',withAds:true},s,provider([base,{data:[],paging:{next:'next'}}]))).rejects.toThrow('100');
 const plan:any=await prepare('ceo.b2bManage.duplicateAdset',{adsetId:'123456',withAds:true},s,provider([base,{data:[{id:'333333',account_id:s.account,creative:{id:'444444'}}]}]));
 expect(plan.steps.map((x:any)=>x.body.status)).toEqual(['PAUSED','PAUSED']);expect(plan.steps[0].body.daily_budget).toBeUndefined();
});
test('image URL upload is only a preview step and image hash is independently read back',async()=>{
 const source={id:'123456',name:'Winner',account_id:s.account,campaign_id:'333333',adset_id:'222222',creative:{object_story_spec:{page_id:'555555',link_data:{link:'https://example.com',image_hash:'abc',message:'Old'}}}};
 const p=provider([source,{id:'222222',account_id:s.account,campaign_id:'333333'}]);
 const plan:any=await prepare('edit.addCreativeToCampaign',{sourceAdId:'123456',imageUrl:'https://example.com/image.jpg'},s,p);
 expect(p.calls.every(x=>x[1]==='GET')).toBe(true);expect(plan.steps[0].imageUpload).toBe(true);
 const execution=provider([{images:{file:{hash:'abcd1234'}}},{data:[{hash:'abcd1234'}]},{id:'666666'},{id:'666666'},{id:'777777'},{id:'777777',status:'PAUSED',adset_id:'222222'}]);
 const result=await executePlan(plan,execution);expect(result.result.adId).toBe('777777');expect(JSON.parse(execution.calls[2][3].object_story_spec).link_data.image_hash).toBe('abcd1234');
});
