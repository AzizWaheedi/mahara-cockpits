import {expect,test} from 'bun:test';
import {runReportOperation} from './reportOperation';
const id='52000000-0000-4000-8000-000000000001';
const input={requestId:id,args:{clientName:'Alpha',from:'2026-09-01',to:'2026-09-14',language:'en',extras:[]},apply:true};
const context={actorId:'staff-a',email:'csm@tests.invalid',clientName:'Alpha',taskId:'cu-alpha',profile:{clientName:'Alpha',performance:{appointments:[]},adLeads:{daily:[]}}};
function client(begin:any,scope:any=context){return {auth:{getUser:async()=>({data:{user:{id:'staff-a'}},error:null})},rpc:async(name:string)=>({data:name==='cockpit_csm_report_begin'?begin:scope,error:null})};}
const noAdmin={from:()=>{throw Error('Unexpected database write');}};
test('dry-run, pending, reconciliation and confirmed retry never call a provider',async()=>{
 let calls=0;const request=async()=>{calls++;throw Error('Network prohibited');};
 expect(await runReportOperation(client({state:'dry_run'}),noAdmin,{...input,apply:false},()=>undefined,request as any)).toMatchObject({dryRun:true,liveWrites:0});
 for(const state of ['sending','reconcile'])expect(await runReportOperation(client({state,id}),noAdmin,input,()=>undefined,request as any)).toMatchObject({ok:false,state,retrySafe:false});
 expect(await runReportOperation(client({state:'confirmed',id,result:{ok:true,receiptId:id,docUrl:'https://docs.google.com/document/d/document_alpha_123456/edit'}}),noAdmin,input,()=>undefined,request as any)).toMatchObject({status:'ready',id});
 expect(calls).toBe(0);
});
test('anonymous and context actor mismatch are denied before any provider call',async()=>{
 const anonymous={auth:{getUser:async()=>({data:{user:null},error:null})},rpc:async()=>{throw Error('Unauthorized RPC');}};
 await expect(runReportOperation(anonymous,noAdmin,input,()=>undefined)).rejects.toThrow('Sign in');
 await expect(runReportOperation(client({state:'new',id,context:{...context,actorId:'other'}}),noAdmin,input,()=>undefined)).rejects.toThrow('actor');
});
test('missing producer configuration and changed source preserve a failed intent without a provider POST',async()=>{
 let calls=0;const updates:any[]=[];
 const admin={from:(table:string)=>({update:(patch:any)=>({eq:()=>({eq:async()=>{updates.push({table,patch});return {error:null};}})})})};
 const request=async()=>{calls++;throw Error('Network prohibited');};
 const first=await runReportOperation(client({state:'new',id,context}),admin,input,()=>undefined,request as any);
 expect(first).toMatchObject({ok:false,status:'unavailable',state:'failed',retrySafe:true});
 const second=await runReportOperation(client({state:'new',id,context},{...context,taskId:'changed'}),admin,input,()=>undefined,request as any);
 expect(second).toMatchObject({ok:false,status:'unavailable'});expect(updates.every(x=>x.patch.state==='failed')).toBe(true);expect(calls).toBe(0);
});
