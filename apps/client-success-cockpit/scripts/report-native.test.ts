import {expect,test} from 'bun:test';
import {requestNativeReport} from '../src/lib/reportClient';
const args={clientName:'Alpha',from:'2026-09-01',to:'2026-09-14',language:'en'};
function fake(invoke:(body:any)=>Promise<any>,user='staff-a'){
 return {auth:{getSession:async()=>({data:{session:user?{user:{id:user}}:null},error:null})},functions:{invoke:async(_name:string,{body}:any)=>invoke(body)}} as any;
}
test('a lost report response retains the same request id for a deliberate retry',async()=>{
 const ids:string[]=[];let first=true;
 const client=fake(async body=>{ids.push(body.requestId);if(first){first=false;return {error:{message:'Timed out'}};}return {data:{ok:true,status:'ready',id:body.requestId,docUrl:'https://docs.google.com/document/d/document_alpha_123456/edit'}};});
 await expect(requestNativeReport(client,{...args,note:'lost-response'})).rejects.toThrow('Timed out');
 expect(await requestNativeReport(client,{...args,note:'lost-response'})).toMatchObject({status:'ready'});expect(ids[0]).toBe(ids[1]);
});
test('a sign-in change during completion cannot acknowledge the old account result',async()=>{
 let current='staff-a';
 const client=fake(async body=>{current='staff-b';return {data:{ok:true,status:'ready',id:body.requestId,docUrl:'https://docs.google.com/document/d/document_alpha_123456/edit'}};});
 client.auth.getSession=async()=>({data:{session:{user:{id:current}}},error:null});
 await expect(requestNativeReport(client,{...args,note:'actor-change'})).rejects.toThrow('account changed');
});
test('no sign-in and an incomplete receipt never report successful creation',async()=>{
 let calls=0;const signedOut=fake(async()=>{calls++;return {};},'');
 await expect(requestNativeReport(signedOut,args)).rejects.toThrow();expect(calls).toBe(0);
 const missingReceipt=fake(async()=>({data:{ok:true,status:'ready'}}));await expect(requestNativeReport(missingReceipt,{...args,note:'bad-receipt'})).rejects.toThrow();
});
