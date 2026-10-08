import {expect,test} from 'bun:test';
import {generateKeyPairSync} from 'node:crypto';
import {runReport,verifyReportAudience} from './report';
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{format:'pem',type:'pkcs8'},publicKeyEncoding:{format:'pem',type:'spki'}});
const identity='fixture-service@fixture.iam.gserviceaccount.com';
const env=(name:string)=>({CSM_REPORTS_FOLDER_ID:'folder_fixture_123456',GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:identity,private_key:privateKey})})[name as 'CSM_REPORTS_FOLDER_ID'];
const context={clientName:'Alpha',email:'csm@tests.invalid',profile:{clientName:'Alpha',performance:{appointments:[]},adLeads:{daily:[]}}};
const args={clientName:'Alpha',from:'2026-09-01',to:'2026-09-14',language:'en',extras:[]};
function harness(permissions:any[],mode:'timeout'|'checkpoint'='timeout',laterPermission?:any){
 let creates=0;const patches:any[]=[];const health:any[]=[];
 const admin={from:(table:string)=>({insert:async(row:any)=>{health.push({table,row});return {error:null};},update:(patch:any)=>({eq:()=>({eq:async()=>{patches.push(patch);return {error:mode==='checkpoint'&&patch.phase==='created'?{message:'Checkpoint unavailable'}:null};}})})}),rpc:async()=>{throw Error('A partial document cannot finish');}};
 const request=async(url:string,init:RequestInit={})=>{
  if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'local-test-token'});
  if(url.includes('/permissions?'))return Response.json(laterPermission?(url.includes('pageToken=')?{permissions:[laterPermission]}:{permissions,nextPageToken:'page-two'}):{permissions});
  if(url.includes('files/folder_fixture_123456?'))return Response.json({id:'folder_fixture_123456',mimeType:'application/vnd.google-apps.folder',capabilities:{canAddChildren:true}});
  if(url.includes('/drive/v3/files?')&&init.method==='POST'){creates++;if(mode==='timeout')throw Error('Connection lost after provider accepted the request');return Response.json({id:'document_fixture_123456'});}
  throw Error('Unexpected mock resource');
 };
 return {admin,request:request as typeof fetch,patches,health,get creates(){return creates;}};
}
test.each([{type:'user',emailAddress:'outside@example.com',role:'reader'},{type:'group',emailAddress:'outside@example.com',role:'reader'},{type:'group',emailAddress:'staff@maharamedia.com',role:'reader'}])('inherited unapproved audience is rejected before creation: %j',async permission=>{
 const h=harness([{type:'user',emailAddress:identity,role:'owner'},permission]);
 const result=await runReport(h.admin,'fixture',context,args,env,async()=>{},h.request);
 expect(h.creates).toBe(0);expect(result).toMatchObject({ok:false,state:'failed'});
});
test('an unapproved recipient on permission page two blocks creation',async()=>{
 const h=harness([{type:'user',emailAddress:identity,role:'owner'}],'timeout',{type:'user',emailAddress:'outside@example.com',role:'reader'});
 const result=await runReport(h.admin,'fixture',context,args,env,async()=>{},h.request);expect(h.creates).toBe(0);expect(result).toMatchObject({ok:false,state:'failed'});
});
test('the final document audience cannot confirm a new inherited recipient',()=>{
 const approved=new Set([identity,context.email,'aziz@maharamedia.com','abdulelah@maharamedia.com']);
 const recipients=[{type:'user',emailAddress:identity,role:'owner'},{type:'user',emailAddress:context.email,role:'writer'}];
 expect(()=>verifyReportAudience(recipients,approved)).not.toThrow();
 expect(()=>verifyReportAudience([...recipients,{type:'user',emailAddress:'outside@example.com',role:'reader'}],approved)).toThrow('unapproved');
});
test('an unknown Google creation outcome is reconcilable and never automatically posted again',async()=>{
 const h=harness([{type:'user',emailAddress:identity,role:'owner'}]);
 const result=await runReport(h.admin,'fixture',context,args,env,async()=>{},h.request);
 expect(h.creates).toBe(1);expect(result).toMatchObject({ok:false,state:'reconcile',retrySafe:false});
 expect(h.health.some(x=>x.row.phase==='unknown')).toBe(true);expect(h.patches.at(-1).state).toBe('reconcile');
});
test('a successful creation followed by a lost checkpoint preserves the original document identity',async()=>{
 const h=harness([{type:'user',emailAddress:identity,role:'owner'}],'checkpoint');
 const result=await runReport(h.admin,'fixture',context,args,env,async()=>{},h.request);
 expect(h.creates).toBe(1);expect(result).toMatchObject({ok:false,state:'reconcile',retrySafe:false,docId:'document_fixture_123456'});
});

test('verifyReportAudience defaults allowPublicEdit to false and denies anyone writer', ()=>{
 const approved=new Set([identity,context.email]);
 const publicWriter=[{type:'user',emailAddress:identity,role:'owner'},{type:'anyone',role:'writer'}];
 expect(()=>verifyReportAudience(publicWriter as any,approved)).toThrow('unapproved');
});

test('verifyReportAudience allows anyone writer only when allowPublicEdit is true', ()=>{
 const approved=new Set([identity,context.email]);
 const publicWriter=[{type:'user',emailAddress:identity,role:'owner'},{type:'anyone',role:'writer'}];
 expect(()=>verifyReportAudience(publicWriter as any,approved,true)).not.toThrow();
});

test.each([
 {type:'anyone',role:'reader'},
 {type:'anyone',role:'commenter'},
 {type:'group',emailAddress:'team@example.com',role:'writer'},
 {type:'domain',domain:'maharamedia.com',role:'writer'},
 {type:'user',emailAddress:'unapproved@example.com',role:'writer'}
])('verifyReportAudience rejects non-anyone/writer audiences even with allowPublicEdit true: %j', permission=>{
 const approved=new Set([identity,context.email]);
 const perms=[{type:'user',emailAddress:identity,role:'owner'},permission];
 expect(()=>verifyReportAudience(perms as any,approved,true)).toThrow('unapproved');
});

test('runReport allows public edit when approved folder matches and guards document audience', async()=>{
 const folderId='folder_fixture_123456';
 const customEnv=(name:string)=>({
  CSM_REPORTS_FOLDER_ID:folderId,
  CSM_REPORTS_PUBLIC_EDIT_APPROVED_FOLDER_ID:folderId,
  GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:identity,private_key:privateKey})
 })[name as 'CSM_REPORTS_FOLDER_ID'];

 const h=harness([{type:'user',emailAddress:identity,role:'owner'},{type:'anyone',role:'writer'}]);
 const result=await runReport(h.admin,'fixture',context,args,customEnv,async()=>{},h.request);
 expect(h.creates).toBe(1);
 expect(result).toMatchObject({ok:false,state:'reconcile'});
});

test('runReport denies public edit when approved folder id does not match', async()=>{
 const customEnv=(name:string)=>({
  CSM_REPORTS_FOLDER_ID:'folder_fixture_123456',
  CSM_REPORTS_PUBLIC_EDIT_APPROVED_FOLDER_ID:'different_folder_999999',
  GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:identity,private_key:privateKey})
 })[name as 'CSM_REPORTS_FOLDER_ID'];

 const h=harness([{type:'user',emailAddress:identity,role:'owner'},{type:'anyone',role:'writer'}]);
 const result=await runReport(h.admin,'fixture',context,args,customEnv,async()=>{},h.request);
 expect(h.creates).toBe(0);
 expect(result).toMatchObject({ok:false,state:'failed'});
});

test('runReport denies folder owner email when member has active nonstaff role', async()=>{
 const customEnv=(name:string)=>({
  CSM_REPORTS_FOLDER_ID:'folder_fixture_123456',
  CSM_REPORTS_FOLDER_OWNER_EMAIL:'active_viewer@example.com',
  GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:identity,private_key:privateKey})
 })[name as 'CSM_REPORTS_FOLDER_ID'];

 const h=harness([{type:'user',emailAddress:identity,role:'owner'},{type:'user',emailAddress:'active_viewer@example.com',role:'writer'}]);
 const origFrom=h.admin.from;
 h.admin.from=(table:string)=>{
  if(table==='cockpit_members'){
   return {
    select:()=>({
     eq:()=>({
      maybeSingle:async()=>({data:{email:'active_viewer@example.com',roles:['viewer'],active:true},error:null})
     })
    })
   };
  }
  return origFrom(table);
 };

 const result=await runReport(h.admin,'fixture',context,args,customEnv,async()=>{},h.request);
 expect(h.creates).toBe(0);
 expect(result).toMatchObject({ok:false,state:'failed'});
});

test('runReport denies folder owner email when member has staff role but is inactive', async()=>{
 const customEnv=(name:string)=>({
  CSM_REPORTS_FOLDER_ID:'folder_fixture_123456',
  CSM_REPORTS_FOLDER_OWNER_EMAIL:'inactive_csm@example.com',
  GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:identity,private_key:privateKey})
 })[name as 'CSM_REPORTS_FOLDER_ID'];

 const h=harness([{type:'user',emailAddress:identity,role:'owner'},{type:'user',emailAddress:'inactive_csm@example.com',role:'writer'}]);
 const origFrom=h.admin.from;
 h.admin.from=(table:string)=>{
  if(table==='cockpit_members'){
   return {
    select:()=>({
     eq:()=>({
      maybeSingle:async()=>({data:{email:'inactive_csm@example.com',roles:['csm'],active:false},error:null})
     })
    })
   };
  }
  return origFrom(table);
 };

 const result=await runReport(h.admin,'fixture',context,args,customEnv,async()=>{},h.request);
 expect(h.creates).toBe(0);
 expect(result).toMatchObject({ok:false,state:'failed'});
});

test('runReport allows confirmed folder owner when active staff role matches', async()=>{
 const ownerEmail='staff_owner@maharamedia.com';
 const customEnv=(name:string)=>({
  CSM_REPORTS_FOLDER_ID:'folder_fixture_123456',
  CSM_REPORTS_FOLDER_OWNER_EMAIL:ownerEmail,
  GOOGLE_SERVICE_ACCOUNT_JSON:JSON.stringify({client_email:identity,private_key:privateKey})
 })[name as 'CSM_REPORTS_FOLDER_ID'];

 const h=harness([{type:'user',emailAddress:identity,role:'owner'},{type:'user',emailAddress:ownerEmail,role:'writer'}]);
 const origFrom=h.admin.from;
 h.admin.from=(table:string)=>{
  if(table==='cockpit_members'){
   return {
    select:()=>({
     eq:()=>({
      maybeSingle:async()=>({data:{email:ownerEmail,roles:['csm'],active:true},error:null})
     })
    })
   };
  }
  return origFrom(table);
 };

 const result=await runReport(h.admin,'fixture',context,args,customEnv,async()=>{},h.request);
 expect(h.creates).toBe(1);
 expect(result).toMatchObject({ok:false,state:'reconcile'});
});
