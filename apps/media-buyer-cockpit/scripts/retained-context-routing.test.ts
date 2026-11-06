import { expect, test } from 'bun:test';
import { previewRequest, submitRequest, submitReplacementForSeat, retainedContextVersion } from '../src/lib/requestsClient';
const valid = { key:'card_missing', enabled:true, retainedContextPolicy:'retained_v1', typeVersion:7, fields:[{key:'details',label:'Details',kind:'details',required:false}] };
function fake() {
  const calls: { name:string; args:any; headers:Record<string,string> }[] = [];
  const client:any = {
    rpc(name:string,args:any) { const headers:Record<string,string> = {}; calls.push({name,args,headers}); const p:any = Promise.resolve({data:{id:'fictional'},error:null}); p.setHeader=(key:string,value:string)=>{headers[key]=value; return p;}; return p; },
    auth: { onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}), getSession:async()=>({data:{session:{user:{id:'fictional-seat'},access_token:'fictional-token'}},error:null}), getUser:async()=>({data:{user:{id:'fictional-seat'}},error:null}) },
  };
  return {client,calls};
}
const body = { requestId:'fictional',typeKey:'card_missing',clientTaskId:'fictional-card',answers:{},dueOn:null,priority:null,source:'client_page' as const,replacesTaskId:'fictional-ticket' };
test('v1 preview, regular send and bound replacement use only pinned v1 endpoints', async()=>{
  const {client,calls}=fake(); const version=retainedContextVersion(valid);
  await previewRequest(client,'card_missing','fictional-card',{},version);
  await submitRequest(client,{...body,retainedContextVersion:version});
  await submitReplacementForSeat(client,'fictional-seat',{...body,retainedContextVersion:version},()=>true);
  expect(calls.map(c=>c.name)).toEqual(['cockpit_request_preview_v1','cockpit_request_submit_v1','cockpit_request_submit_v1']);
  expect(calls.every(c=>c.args.p_expected_version===7)).toBe(true);
  expect(calls[2].headers.Authorization).toBe('Bearer fictional-token');
});
test('legacy endpoints remain unchanged, and malformed advertised policies cannot be routed', async()=>{
  const {client,calls}=fake(); expect(retainedContextVersion({key:'card_missing'})).toBeUndefined();
  await previewRequest(client,'card_missing',null,{}); await submitRequest(client,body);
  expect(calls.map(c=>c.name)).toEqual(['cockpit_request_preview','cockpit_request_submit']);
  expect(calls.every(c=>!('p_expected_version' in c.args))).toBe(true);
  for (const bad of [{...valid,typeVersion:undefined},{...valid,retainedContextPolicy:'legacy'},{...valid,key:'other'},{...valid,fields:[]},{...valid,fields:[{...valid.fields[0],required:true}]},{key:'card_missing',typeVersion:7}]) expect(()=>retainedContextVersion(bad)).toThrow();
  expect(()=>previewRequest(client,'card_missing',null,{},0)).toThrow();
  expect(calls).toHaveLength(2);
});
