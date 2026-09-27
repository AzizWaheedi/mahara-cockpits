import {test,expect} from 'bun:test';
import {validateBuild,prepareBuild,launchBuildPlan} from './build';
import type {Provider} from '../cockpit-media-api/core';
const scope={client:'Alpha',clientTag:'alpha',account:'111111',campaign:'222222',campaignName:'Alpha campaign'};
const args={clientTag:'alpha',clientName:'Forged',accountId:'act_111111',kind:'campaign',brief:'Real brief',dailyBudget:40,creativeLinks:['https://example.test/video'],language:'English'};
test('builder derives identity and settings from scoped live source, validates actual generated copy',async()=>{
 const clean=validateBuild(args,scope);expect(clean.clientName).toBe('Alpha');
 const p:Provider={async call(){return {data:[{id:'set1',name:'Best',account_id:'111111',campaign_id:'222222',targeting:{geo_locations:{countries:['SA']}},promoted_object:{page_id:'page1'},optimization_goal:'LEAD_GENERATION',billing_event:'IMPRESSIONS'}]};}};
 const built=await prepareBuild(clean,scope,p,async()=>({variants:[{headline:'Real copy',primaryText:'Based on the brief'}]}),'No unsupported promises');
 expect(built.targeting.geo_locations.countries).toEqual(['SA']);expect(built.variants).toHaveLength(1);
 await expect(prepareBuild(clean,scope,p,async()=>({variants:[]}))).rejects.toThrow('valid copy');
 expect(()=>validateBuild({...args,accountId:'other'},scope)).toThrow('does not match');
});
test('launch plan remains paused, uses account currency guard and binds copied targeting',async()=>{
 const draft={status:'ready',kind:'campaign',dailyBudget:40,targeting:{geo_locations:{countries:['SA']}},promotedObject:{page_id:'page1'},variants:[{}]};
 const p:Provider={async call(){return {id:'act_111111',account_status:1,currency:'USD'};}};
 const plan=await launchBuildPlan(draft,scope,p,new Date('2026-09-27T00:00:00Z'));
 expect(plan.steps.map(s=>s.body?.status)).toEqual(['PAUSED','PAUSED']);expect(plan.steps[1].body?.daily_budget).toBe(4000);expect(plan.steps[1].expected.targeting).toEqual(draft.targeting);
 const other:Provider={async call(){return {id:'act_111111',account_status:1,currency:'KWD'};}};
 await expect(launchBuildPlan(draft,scope,other)).rejects.toThrow('another currency');
});
