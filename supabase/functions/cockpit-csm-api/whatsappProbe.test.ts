import {describe,expect,test} from 'bun:test';
import {ghlTools} from './tools.ts';
import {runWhatsappProbe,WhatsappProbeAccessError} from './whatsappProbe.ts';

const LOCATION='wwG426bwruWWv9W3fazQ';
const env=(name:string)=>name==='GHL_MAHARA_PIT'?'fixture-pit':name==='GHL_MAHARA_LOCATION'?LOCATION:undefined;
function fixture(ceo:unknown,respond?:(url:URL)=>unknown){
 const requests:{url:URL;method:string;version:string|null;auth:string|null;body:unknown}[]=[],receipts:Record<string,unknown>[]=[];
 const client={rpc:async(name:string)=>name==='cockpit_is_ceo'?{data:ceo,error:null}:{data:null,error:{message:'unexpected rpc'}}};
 const admin={from:(table:string)=>({insert:async(row:Record<string,unknown>)=>{if(table!=='cockpit_csm_provider_health')throw new Error('unexpected table');receipts.push(row);return {error:null};}})};
 const request:typeof fetch=async(input,init)=>{
  const url=new URL(String(input)),headers=new Headers(init?.headers);requests.push({url,method:String(init?.method),version:headers.get('Version'),auth:headers.get('Authorization'),body:init?.body});
  return Response.json(respond?respond(url):url.pathname==='/conversations/search'
   ?{conversations:[{id:'conv-newest',contactId:'contact-secret',fullName:'Client Name',phone:'+96599990000',lastMessageBody:'secret text'}],total:146}
   :{messages:{lastMessageId:'m5',nextPage:true,messages:[
    {id:'m1',direction:'inbound',messageType:'TYPE_CUSTOM_SMS',conversationProviderId:'67fb79aa11bb22cc',body:'private words',from:'+965 5000 1234',to:'+965 6000 9876',contactId:'contact-secret'},
    {id:'m2',direction:'outbound',messageType:'TYPE_CUSTOM_SMS',conversationProviderId:'67fb79aa11bb22cc',body:'our reply'},
   ]}});
 };
 return {client,admin,request,requests,receipts};
}
describe('whatsapp.probe',()=>{
 test('a seat other than the CEO is refused before any GoHighLevel call',async()=>{
  for(const ceo of [false,null]){
   const f=fixture(ceo);
   await expect(runWhatsappProbe(f.client,f.admin,env,f.request)).rejects.toBeInstanceOf(WhatsappProbeAccessError);
   expect(f.requests).toEqual([]);expect(f.receipts).toEqual([]);
  }
 });
 test('the CEO gets two reads and only type, direction, provider prefix and last 4 digits',async()=>{
  const f=fixture(true);const out=await runWhatsappProbe(f.client,f.admin,env,f.request);
  expect(f.requests.map(r=>[r.method,r.url.pathname,Object.fromEntries(r.url.searchParams)])).toEqual([
   ['GET','/conversations/search',{locationId:LOCATION,limit:'1',sort:'desc',sortBy:'last_message_date'}],
   ['GET','/conversations/conv-newest/messages',{limit:'5'}],
  ]);
  expect(f.requests.every(r=>r.version==='2021-04-15'&&r.auth==='Bearer fixture-pit'&&r.body===undefined)).toBe(true);
  expect(out).toEqual({ok:true,checkedAt:expect.any(String),note:null,messages:[
   {messageType:'TYPE_CUSTOM_SMS',direction:'inbound',providerPrefix:'67fb79',fromLast4:'1234',toLast4:'9876'},
   {messageType:'TYPE_CUSTOM_SMS',direction:'outbound',providerPrefix:'67fb79',fromLast4:null,toLast4:null},
  ]});
  const text=JSON.stringify(out);for(const secret of ['private words','our reply','contact-secret','conv-newest','Client Name','99990000'])expect(text).not.toContain(secret);
  expect(f.receipts.map(r=>[r.provider,r.method,r.resource,r.phase,r.action_id])).toEqual([
   ['ghl','GET','conversations/search','intent',null],['ghl','GET','conversations/search','response',null],
   ['ghl','GET','conversations/conv-newest/messages','intent',null],['ghl','GET','conversations/conv-newest/messages','response',null],
  ]);
 });
 test('an empty account says so without a second read',async()=>{
  const f=fixture(true,()=>({conversations:[]}));
  expect(await runWhatsappProbe(f.client,f.admin,env,f.request)).toMatchObject({ok:true,messages:[],note:expect.stringContaining('no conversation')});
  expect(f.requests).toHaveLength(1);
 });
 test('another client account is refused',async()=>{
  const f=fixture(true);
  await expect(runWhatsappProbe(f.client,f.admin,name=>name==='GHL_MAHARA_LOCATION'?'another':env(name),f.request)).rejects.toThrow('not configured');
  expect(f.requests).toEqual([]);
 });
 test('the GoHighLevel allowlist opens these two reads and nothing else new',async()=>{
  const calls:string[]=[];const ghl=ghlTools('fixture-pit',async()=>{},async input=>{calls.push(String(input));return Response.json({});});
  for(const [method,path] of [['POST','conversations/messages'],['GET','conversations/messages/m1'],['POST','conversations/search?locationId=x'],['GET','conversations/a/b/messages'],['GET','contacts/contact-one'],['GET','conversations/search/../users']] as const)
   await expect(ghl.call(method,path)).rejects.toThrow('Invalid GoHighLevel resource');
  await ghl.call('GET','conversations/search?locationId=x&limit=1');await ghl.call('GET','conversations/abc/messages?limit=5');
  expect(calls).toEqual(['https://services.leadconnectorhq.com/conversations/search?locationId=x&limit=1','https://services.leadconnectorhq.com/conversations/abc/messages?limit=5']);
 });
});
