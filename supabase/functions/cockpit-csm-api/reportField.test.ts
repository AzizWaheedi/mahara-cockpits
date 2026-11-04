import {expect,test} from 'bun:test';
import {executeCsm,prepareCsm,REPORT_FIELD_PREFIX,reportField} from './core';

// Last report sent is found by its id's prefix (a7f4ecf5), exactly one date field on Clients - Mahara,
// never by its name (docs/forms/WAVE12-CONTRACT.md 4.6.2, W7). No real ClickUp call: a stub board.
const REPORT=`${REPORT_FIELD_PREFIX}-1b2c-4d3e-8f40-0000000000aa`;
const context={actorId:'csm-1',email:'csm@tests.invalid',day:'2026-11-01',clientName:'Liwan Limited',taskId:'task-a',evidence:'Report due'};
const missing='The Last report sent field (a7f4ecf5) is missing from Clients - Mahara.';
function board(fields:any[]){
 const posts:any[]=[];const values:Record<string,unknown>={};
 const provider:any={async call(method:string,path:string,body?:any){
  if(path==='list/901816559981/field')return {fields};
  const set=path.match(/^task\/task-a\/field\/(.+)$/);
  if(method==='POST'&&set){posts.push({path,body});values[set[1]]=String(body.value);return {};}
  if(method==='GET'&&path==='task/task-a')return {custom_fields:Object.entries(values).map(([id,value])=>({id,value}))};
  throw Error(`Unexpected ClickUp call ${method} ${path}`);
 }};
 return {provider,posts};
}

test('the report act writes the one field whose id starts a7f4ecf5, whatever it is named',async()=>{
 const {provider,posts}=board([{id:'f1e2d3c4-0000-4000-8000-00000000name',name:'Last report sent',type:'date'},{id:REPORT,name:'📈 Report sent (renamed)',type:'date'}]);
 const plan=await prepareCsm('act',{kind:'report',action:'Monthly report sent to the client'},context,provider);
 expect(plan.updates).toEqual([{field:REPORT,value:Date.parse('2026-11-01T09:00:00Z'),day:'2026-11-01'}]);
 expect(plan.patch).toMatchObject({lastReport:'2026-11-01',reportDays:0,reportDue:false});
 const done=await executeCsm(plan,provider);
 expect(done.result).toMatchObject({ok:true});
 expect(posts).toEqual([{path:`task/task-a/field/${REPORT}`,body:{value:Date.parse('2026-11-01T09:00:00Z'),value_options:{time:false}}}]);
});

test('no a7f4ecf5 field, two of them, or one that is not a date: refused with the sentence, nothing written',async()=>{
 for(const fields of [
  [{id:'f1e2d3c4-0000-4000-8000-00000000name',name:'Last report sent',type:'date'}],
  [{id:REPORT,name:'Last report sent',type:'date'},{id:`${REPORT_FIELD_PREFIX}-9999`,name:'Copy',type:'date'}],
  [{id:REPORT,name:'Last report sent',type:'short_text'}],
  [],
 ]){
  const {provider,posts}=board(fields);
  await expect(prepareCsm('act',{kind:'report',action:'Report sent'},context,provider)).rejects.toThrow(missing);
  expect(posts).toEqual([]);
 }
});

test('reportField reads the stored list read the same way',()=>{
 expect(reportField({fields:[{id:REPORT,type:'date'}]}).id).toBe(REPORT);
 expect(()=>reportField({})).toThrow(missing);
 expect(()=>reportField({fields:[{id:`${REPORT_FIELD_PREFIX}`,type:'date'},{id:`${REPORT_FIELD_PREFIX}x`,type:'date'}]})).toThrow(missing);
});

test('a name-only match no longer counts: the field must carry the prefix',async()=>{
 const {provider}=board([{id:'0000aaaa-name-only',name:'Last report sent',type:'date'}]);
 await expect(prepareCsm('act',{kind:'report',action:'Report sent'},context,provider)).rejects.toThrow(missing);
});
