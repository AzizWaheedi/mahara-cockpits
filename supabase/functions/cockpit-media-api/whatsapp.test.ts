import {describe,expect,test} from 'bun:test';
import {providerTools} from './tools';
import {executeWhatsappReply,type WhatsappRpcClient} from './whatsapp';

const ID='40000000-0000-4000-8000-000000000001';
const env=(name:string)=>name==='GHL_MAHARA_PIT'?'fixture-pit':name==='GHL_MAHARA_LOCATION'?'mahara-location':undefined;
const args={app:'client-success',chatId:'thread-one',text:'Your campaign is live.',contextKey:'0'.repeat(32),requestId:ID,apply:true};
function clients(){
 const calls:{name:string;args:Record<string,unknown>}[]=[];
 const user:WhatsappRpcClient={rpc:async(name,a)=>{calls.push({name,args:a});return {data:{state:'new',id:ID,claimToken:'claim',context:{locationId:'mahara-location',contactId:'contact-one',providerId:'custom-provider'}},error:null};}};
 const admin:WhatsappRpcClient={rpc:async(name,a)=>{calls.push({name,args:a});return {data:name==='cockpit_wa_reply_accepted'?{state:'accepted'}:null,error:null};}};
 return {user,admin,calls};
}
function ghl(contact:Record<string,unknown>){
 const requests:{url:string;method:string;version:string|null;body:any}[]=[];
 const request:typeof fetch=async(input,init)=>{
  const headers=new Headers(init?.headers);requests.push({url:String(input),method:String(init?.method),version:headers.get('Version'),body:init?.body?JSON.parse(String(init.body)):undefined});
  return init?.method==='GET'?Response.json({contact}):Response.json({conversationId:'thread-one',messageId:'provider-message'});
 };
 return {request,requests};
}
const clean={id:'contact-one',locationId:'mahara-location',dnd:false,dndSettings:{SMS:{status:'inactive'},WhatsApp:{status:'inactive'}}};
describe('WhatsApp reply provider call',()=>{
 test('the reply is a Custom message through the bridged provider, after a do-not-disturb read',async()=>{
  const {user,admin,calls}=clients(),{request,requests}=ghl(clean);
  expect(await executeWhatsappReply(user,admin,args,env,request)).toMatchObject({ok:true,state:'accepted',providerMessageId:'provider-message'});
  expect(requests.map(r=>[r.method,r.url,r.version])).toEqual([
   ['GET','https://services.leadconnectorhq.com/contacts/contact-one','2021-07-28'],
   ['POST','https://services.leadconnectorhq.com/conversations/messages','2023-02-21'],
  ]);
  // 'SMS' would send a real text message and 'WhatsApp' goes to a channel that is not set up.
  const post=requests[1].body;
  expect(post.type).toBe('Custom');
  expect(post.conversationProviderId).toBe('custom-provider');
  expect(post).toEqual({type:'Custom',contactId:'contact-one',conversationProviderId:'custom-provider',message:'Your campaign is live.',status:'pending'});
  expect(calls.filter(c=>c.name==='cockpit_wa_health').map(c=>[(c.args.p_receipt as any).method,(c.args.p_receipt as any).resource,(c.args.p_receipt as any).phase])).toEqual([
   ['GET','contacts/contact-one','intent'],['GET','contacts/contact-one','response'],['POST','conversations/messages','intent'],['POST','conversations/messages','response'],
  ]);
 });
 for(const [label,contact] of [
  ['dnd on every channel',{...clean,dnd:true}],
  ['WhatsApp do-not-disturb active',{...clean,dndSettings:{WhatsApp:{status:'active'}}}],
  ['SMS do-not-disturb permanent',{...clean,dndSettings:{SMS:{status:'Permanent'}}}],
 ] as const){
  test(`${label} refuses the reply and makes no POST`,async()=>{
   const {user,admin,calls}=clients(),{request,requests}=ghl(contact);
   await expect(executeWhatsappReply(user,admin,args,env,request)).rejects.toThrow('do not disturb');
   expect(requests.filter(r=>r.method==='POST')).toEqual([]);
   expect(calls.find(c=>c.name==='cockpit_wa_reply_failed')?.args.p_unknown).toBe(false);
   expect(calls.some(c=>c.name==='cockpit_wa_reply_accepted')).toBe(false);
  });
 }
 test('another contact or account in the read makes no POST',async()=>{
  for(const contact of [{...clean,id:'someone-else'},{...clean,locationId:'another-account'}]){
   const {user,admin}=clients(),{request,requests}=ghl(contact);
   await expect(executeWhatsappReply(user,admin,args,env,request)).rejects.toThrow('Nothing was sent');
   expect(requests.filter(r=>r.method==='POST')).toEqual([]);
  }
 });
 test('a failed contact read is not a send: the intent fails without reconciliation',async()=>{
  const {user,admin,calls}=clients();let posts=0;
  const request:typeof fetch=async(_input,init)=>{if(init?.method==='POST')posts++;throw new Error('network down');};
  await expect(executeWhatsappReply(user,admin,args,env,request)).rejects.toThrow('Provider response is unknown');
  expect(posts).toBe(0);expect(calls.find(c=>c.name==='cockpit_wa_reply_failed')?.args.p_unknown).toBe(false);
 });
 test('the GoHighLevel allowlist opens only the contact read and the reply',async()=>{
  const p=providerTools(env,async()=>{},async()=>Response.json({}));
  for(const [method,path] of [['GET','contacts/a/b'],['GET','contacts/contact-one/notes'],['POST','contacts/contact-one'],['GET','conversations/messages'],['POST','conversations/search'],['GET','contacts/../users']])
   await expect(p.call('ghl',method,path)).rejects.toThrow();
  expect(await p.call('ghl','GET','contacts/contact-one')).toEqual({});
 });
});
