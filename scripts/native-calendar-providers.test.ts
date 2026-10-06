import {afterEach,beforeEach,expect,test} from 'bun:test';
import {generateKeyPairSync} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {transport} from '../hermes/cockpit-sync/transport';
import {withNativeContext} from '../hermes/cockpit-sync/runtime';
import {collectSharedGoogleCalendars} from '../hermes/cockpit-sync/clientCalendars';
let directory:string,keyPath:string;
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'native-calendar-fixture-'));keyPath=join(directory,'service.json');const privateKey=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}).toString();await writeFile(keyPath,JSON.stringify({type:'service_account',client_email:'reader@fixture.iam.gserviceaccount.com',private_key:privateKey}));});
afterEach(async()=>{await rm(directory,{recursive:true,force:true});});
const state={calendarConfig:{serviceAccountEmail:'reader@fixture.iam.gserviceaccount.com'},csm:{clients:[{name:'Alpha'}]},oldCampaigns:[]};
const env={GOOGLE_APPLICATION_CREDENTIALS:''};
test('configured per-app calendars consume complete real transport pages with one verified OAuth identity',async()=>{
 const urls:URL[]=[];let auth=0;
 const reader=transport({...env,GOOGLE_APPLICATION_CREDENTIALS:keyPath},async(input,init)=>{
  const url=new URL(String(input));urls.push(url);
  if(url.hostname==='oauth2.googleapis.com'){auth++;return Response.json({token_type:'Bearer',access_token:'fixture-read-token'});}
  if(new Headers(init?.headers).get('Authorization')!=='Bearer fixture-read-token')return Response.json({error:'Unauthorized'},{status:403});
  const second=url.searchParams.has('pageToken');return Response.json({accessRole:'reader',items:second?[{id:'alpha',summary:'Alpha review',start:{dateTime:'2026-10-10T10:00:00+03:00'},end:{dateTime:'2026-10-10T11:00:00+03:00'}}]:[],...(!second?{nextPageToken:'next'}:{})});
 });
 const result=await withNativeContext(reader.reads,{receipts:reader.receipts},()=>collectSharedGoogleCalendars(state,{CSM_CALENDAR_IDS:'csm@calendar.example',CREATIVE_CALENDAR_IDS:'creative@calendar.example'},Date.parse('2026-10-04T12:00:00Z')));
 expect(result).toMatchObject({'client-success':{configured:true,calendarIds:['csm@calendar.example'],events:[{eventId:'alpha',clientName:'Alpha',calendarId:'csm@calendar.example'}]},creative:{configured:true,calendarIds:['creative@calendar.example'],events:[{eventId:'alpha',calendarId:'creative@calendar.example'}]}});
 expect(auth).toBe(1);expect(urls.filter(url=>url.hostname==='www.googleapis.com')).toHaveLength(4);expect(reader.receipts.filter(receipt=>receipt.phase==='response'&&receipt.http_status===200)).toHaveLength(5);expect(reader.faults).toEqual([]);
});
test('wrong service-account identity fails before any provider request',async()=>{
 let requests=0;const reader=transport({...env,GOOGLE_APPLICATION_CREDENTIALS:keyPath},async()=>{requests++;throw new Error('Forbidden request');});
 await expect(withNativeContext(reader.reads,{receipts:reader.receipts},()=>collectSharedGoogleCalendars({...state,calendarConfig:{serviceAccountEmail:'other@fixture.iam.gserviceaccount.com'}},{CSM_CALENDAR_IDS:'csm@calendar.example'}))).rejects.toThrow('identity');expect(requests).toBe(0);
});
test('one incomplete configured calendar blocks the whole result instead of publishing a partial feed',async()=>{
 const reader=transport({...env,GOOGLE_APPLICATION_CREDENTIALS:keyPath},async input=>{
  const url=new URL(String(input));
  if(url.hostname==='oauth2.googleapis.com')return Response.json({token_type:'Bearer',access_token:'fixture-read-token'});
  if(url.pathname.includes(encodeURIComponent('first@calendar.example')))return Response.json({accessRole:'reader',items:[{id:'first',summary:'Alpha review',start:{dateTime:'2026-10-10T10:00:00+03:00'},end:{dateTime:'2026-10-10T11:00:00+03:00'}}]});
  return Response.json({accessRole:'reader'});
 });
 await expect(withNativeContext(reader.reads,{receipts:reader.receipts},()=>collectSharedGoogleCalendars(state,{CSM_CALENDAR_IDS:'first@calendar.example,missing@calendar.example'}))).rejects.toThrow('list');
});
