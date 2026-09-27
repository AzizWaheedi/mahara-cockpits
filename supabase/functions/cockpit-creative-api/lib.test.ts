import {expect,test} from 'bun:test';
import {launchLink,requestPlan,CREATIVE_LIST,feedbackText,feedbackRange} from './lib';
import {executePlan} from '../cockpit-media-api/execute';
import type {Provider,Row} from '../cockpit-media-api/core';
const scope={account:'111111',campaign:'222222',campaignName:'Alpha campaign',client:'Alpha'};
const request={campaignName:'Alpha campaign',sourceAdId:'333333',reason:'fatigue',note:'Buyer note'};
function provider(ad:Row={id:'333333',name:'Real source',account_id:'111111',campaign:{id:'222222'}}){
 const calls:any[]=[];const p:Provider={async call(provider,method,path,body){calls.push({provider,method,path,body});if(provider==='meta')return ad;if(method==='POST')return {id:'task-one'};return {id:'task-one',name:'Creative Request — Alpha — Refresh a fatigued ad',list:{id:CREATIVE_LIST},url:'https://app.clickup.com/t/task-one'};}};return {p,calls};
}
test('creative request verifies source ownership and actual ClickUp task read-back',async()=>{
 const {p,calls}=provider();const made=await requestPlan(request,scope,'req-1',{clientTag:'alpha'},p);
 expect(made.row.source_ad_name).toBe('Real source');expect(made.plan.body?.markdown_description).toContain('Creative request: req-1');
 expect(calls.filter(x=>x.method==='POST')).toHaveLength(0);
 const receipt=await executePlan(made.plan,p);expect(receipt.result.id).toBe('task-one');expect(calls.at(-1).path).toBe('task/task-one');
 await expect(requestPlan(request,scope,'req-2',{},provider({id:'333333',campaign:{id:'bad'},account_id:'111111'}).p)).rejects.toThrow('not in this campaign');
});
test('launch link verifies campaign, date and replacement identity and preserves prior link',async()=>{
 const row={id:'req-1',campaign_name:'Alpha campaign',source_meta_ad_id:'333333',created_at:'2026-09-20T00:00:00Z',status:'asset_ready'};
 const args={launchedAdId:'444444',launchedOn:'2026-09-24'};
 const p=provider({id:'444444',account_id:'111111',campaign:{id:'222222'}}).p;
 const result=await launchLink(args,scope,row,p,new Date('2026-09-27T12:00:00Z'));
 expect(result.launched_at).toBe('2026-09-23T21:00:00.000Z');expect(result.status).toBe('launched');
 await expect(launchLink({...args,launchedAdId:'333333'},scope,row,p)).rejects.toThrow('replacement');
 await expect(launchLink({...args,launchedOn:'2026-02-30'},scope,row,p)).rejects.toThrow('day');
 await expect(launchLink(args,scope,{...row,launched_meta_ad_id:'555555'},p)).rejects.toThrow('different');
 expect(await launchLink(args,scope,{...row,launched_meta_ad_id:'444444'},p)).toEqual({});
});
test('creative feedback uses three complete local days and never turns missing data into zero',()=>{
 const row={id:'request1',verdict:'worked',source_meta_ad_id:'old',source_ad_name:'Original',launched_meta_ad_id:'new',launched_at:'2026-09-23T21:00:00Z'};
 expect(feedbackRange(row)).toEqual({beforeFrom:'2026-09-21',beforeTo:'2026-09-23',afterFrom:'2026-09-25',afterTo:'2026-09-27'});
 const text=feedbackText(row,{rows:[{metaAdId:'new',date:'2026-09-25',spend:50,leads:5}],bookings:[{adId:'new',date:'2026-09-25'}]});
 expect(text).toContain('Original ad before: ad data unavailable');expect(text).toContain('$10.00 CPL, 1 bookings matched');expect(text).toContain('1 of 3 days had ad records');
});
