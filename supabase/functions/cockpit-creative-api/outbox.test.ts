import {test,expect} from 'bun:test';
import {prepareOutbox,executeOutbox} from './outbox';
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
