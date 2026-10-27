import {test,expect} from 'bun:test';
import {prepareOutbox,executeOutbox,runClientAction,browserLoader,serviceLoader,ClientActionError} from './outbox';
import type {Provider,Row} from '../cockpit-media-api/core';
test('complete uses the actual done status, never the cancelled status; stale tags refuse',async()=>{
 const calls:Row[]=[];const p:Provider={async call(_provider,method,path,body){calls.push({method,path,body});if(path==='list/list1')return {statuses:[{type:'closed',status:'cancelled'},{type:'done',status:'delivered'}]};return {id:'task',tags:[{name:'alpha'}],list:{id:'list1'},status:{status:calls.some(x=>x.method==='PUT')?'delivered':'new'}};}};
 const row={kind:'complete',task_id:'task',sourceTask:{tags:['alpha']},payload:{}};
 const plan=await prepareOutbox(row,p);await executeOutbox(plan,p);
 expect(calls.find(x=>x.method==='PUT')?.body).toEqual({status:'delivered'});
 await expect(prepareOutbox({...row,sourceTask:{tags:['beta']}},p)).rejects.toThrow('tags changed');
});
test('new script carries canonical client tag and due date, preview performs no write',async()=>{
 const calls:Row[]=[];const p:Provider={async call(_provider,method,path,body){calls.push({method,path,body});return {};}};
 const plan=await prepareOutbox({kind:'planScript',client_name:'Alpha',payload:{client:'forged',title:'Script',brief:'Real brief',due:'2026-10-01'}},p);
 expect(calls).toHaveLength(0);expect('steps'in plan&&plan.steps[0].body?.tags).toEqual(['alpha']);
 expect('steps'in plan&&plan.steps[0].body?.due_date).toBe(Date.parse('2026-10-01T09:00:00+03:00'));
 await expect(prepareOutbox({kind:'planScript',client_name:'Alpha',payload:{brief:'Brief',due:'2026-02-30'}},p)).rejects.toThrow('valid due date');
});
test('comment requires confirmed provider identity and exact read-back text',async()=>{
 const plan={comment:{task:'task',text:'Human note'}};
 const good:Provider={async call(_provider,method){return method==='POST'?{id:'123'}:{comments:[{id:'123',comment_text:'Human note'}]};}};
 expect(await executeOutbox(plan,good)).toEqual({taskId:'task',commentId:'123'});
 const wrong:Provider={async call(_provider,method){return method==='POST'?{id:'123'}:{comments:[{id:'124',comment_text:'Human note'}]};}};
 await expect(executeOutbox(plan,wrong)).rejects.toThrow('not confirmed');
});
test('the browser loads a press as the signed-in seat, the drain as its presser through the service RPC',async()=>{
 const seen:Row[]=[];const rpc=async(name:string,args:Row)=>{seen.push({name,args});return {data:{id:'p1'},error:null};};
 expect(await browserLoader({rpc})('p1')).toEqual({id:'p1'});expect(await serviceLoader({rpc})('p1')).toEqual({id:'p1'});
 expect(seen).toEqual([{name:'cockpit_creative_client_action',args:{p_operation:'get',p_args:{id:'p1'}}},{name:'cockpit_creative_outbox_load_for_actor',args:{p_id:'p1'}}]);
 await expect(serviceLoader({rpc:async()=>({data:null,error:{message:'That client is not on your access list'}})})('p1')).rejects.toThrow('not on your access list');
});
test('a press already done returns its result to the browser and is skipped by the drain; one in reconcile refuses the browser, not started',async()=>{
 const admin={from:()=>{throw new Error('nothing is written');},rpc:async()=>{throw new Error('nothing is called');}};
 const load=(row:Row)=>async()=>row;
 expect(await runClientAction({args:{id:'p1'},apply:true},load({id:'p1',state:'done',result:{taskId:'t'}}),admin,()=>undefined,'actor')).toEqual({id:'p1',state:'done',result:{taskId:'t'}});
 for(const state of ['done','sending','reconcile','failed'])
  expect(await runClientAction({args:{id:'p1'},apply:true},load({id:'p1',state}),admin,()=>undefined,'actor',{source:'cron'})).toEqual({id:'p1',skipped:true,state});
 const refused=await runClientAction({args:{id:'p1'},apply:true},load({id:'p1',state:'reconcile'}),admin,()=>undefined,'actor').catch(e=>e);
 expect(refused).toBeInstanceOf(ClientActionError);expect(refused.started).toBe(false);expect(refused.message).toBe('This client action needs reconciliation before retrying');
 const lost=await runClientAction({args:{id:'p1'},apply:true},async()=>{throw new Error('That client is not on your access list');},admin,()=>undefined,'actor',{source:'cron'}).catch(e=>e);
 expect(lost).toBeInstanceOf(ClientActionError);expect(lost.started).toBe(false);expect(lost.message).toBe('That client is not on your access list');
});
test('no outbox path sends anything to Make any more',async()=>{
 const src=await Bun.file(new URL('./outbox.ts',import.meta.url)).text();
 expect(src).not.toMatch(/'make'|\.make\b|Make did not confirm/);
 const bp=await Bun.file(new URL('./blueprint.ts',import.meta.url)).text();
 expect(bp).not.toMatch(/makeClose|slackCloseText|MEDIA_GENERAL|BLUEPRINT_MAKE_CLOSE|provider:'slack'/);
});
