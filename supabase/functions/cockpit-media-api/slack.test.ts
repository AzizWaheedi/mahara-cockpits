import {describe,expect,test} from 'bun:test';
import {executePlan} from './execute';
import {prepareSlack} from './slack';
import {providerTools} from './tools';
type Row=Record<string,any>;
// S1 (docs/forms/STAGE1-CONTRACT.md 5.1): the media buyer's request DM counts on Slack's receipt and a
// read-back of the bot's message by its ts. This fake Slack stores text the way the real one does: a bare
// URL in angle brackets, an email as a mailto link, & < > as entities. The old exact-text read-back failed
// on every real post for exactly this reason. Every id and address here is invented.
const BOT='B0FAKEBOT01';
function slackStored(text:string){
 return text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/\b(https?:\/\/[^\s<>]+)/g,'<$1>')
  .replace(/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,'<mailto:$1|$1>');
}
class FakeSlack{
 messages:Row[]=[];calls:Row[]=[];dm='D0FAKEDM01';
 answer:'ok'|'other-channel'|'no-ts'|'refused'='ok';history:'stored'|'missing'|'no-bot'|'other-bot'='stored';
 fetch=async(input:string|URL|Request,init:RequestInit={}):Promise<Response>=>{
  const url=new URL(String(input)),method=init.method??'GET',body=init.body?JSON.parse(String(init.body)):undefined;this.calls.push({method,url:String(url),body});
  const ok=(x:unknown)=>new Response(JSON.stringify(x),{status:200});
  if(url.host!=='slack.com')return new Response('{}',{status:599});
  if(method==='POST'&&url.pathname==='/api/chat.postMessage'){
   if(this.answer==='refused')return ok({ok:false,error:'channel_not_found'});
   const ts=`1792900000.0001${this.messages.length}0`;const channel=/^[UW]/.test(body.channel)?this.dm:body.channel;
   this.messages.push({ts,channel,text:slackStored(body.text),bot_id:BOT,type:'message'});
   if(this.answer==='no-ts')return ok({ok:true,channel});
   return ok({ok:true,ts,channel:this.answer==='other-channel'?'C0OTHER0001':channel,message:{bot_id:BOT,text:slackStored(body.text)}});
  }
  if(method==='GET'&&url.pathname==='/api/conversations.history'){
   const channel=url.searchParams.get('channel'),latest=url.searchParams.get('latest');
   if(this.history==='missing')return ok({ok:true,messages:[]});
   const list=this.messages.filter(m=>m.channel===channel&&Number(m.ts)<=Number(latest)).sort((a,b)=>Number(b.ts)-Number(a.ts)).slice(0,Number(url.searchParams.get('limit')??100));
   if(this.history==='no-bot')return ok({ok:true,messages:list.map(({bot_id:_bot,...m})=>({...m,user:'U0SOMEONE1'}))});
   if(this.history==='other-bot')return ok({ok:true,messages:list.map(m=>({...m,bot_id:'B0OTHERBOT1'}))});
   return ok({ok:true,messages:list});
  }
  return ok({ok:false,error:'unknown_method'});
 };
}
const scope={account:'123456',campaign:'222222',campaignName:'Acme & Sons: Spring',task:'card1'};
const env=(k:string)=>({SLACK_BOT_TOKEN:'xoxb-test-token'} as Record<string,string>)[k];
function run(fake:FakeSlack,request='Please check https://app.clickup.com/t/abc123 and the form at forms.example.test, reply to me'){
 const receipts:Row[]=[];const p=providerTools(env,async r=>{receipts.push(r);},fake.fetch as typeof fetch);
 const plan=prepareSlack({request},scope,'buyer@example.com',()=>undefined);
 return {plan,receipts,go:()=>executePlan(plan,p)};
}

describe('askViktorFor through executePlan (S1)',()=>{
 test('the stored text differs from what was sent, and the post still confirms on its receipt and read-back',async()=>{
  const fake=new FakeSlack();const r=run(fake);
  const result=await r.go();
  expect(fake.messages).toHaveLength(1);
  // The proof that the old rule could never pass: Slack's stored text is not the sent text.
  expect(fake.messages[0].text).not.toBe(r.plan.body?.text);
  expect(fake.messages[0].text).toContain('<mailto:buyer@example.com|buyer@example.com>');
  expect(fake.messages[0].text).toContain('<https://app.clickup.com/t/abc123>');
  expect(fake.messages[0].text).toContain('Acme &amp; Sons');
  expect(result.receipts).toEqual([{id:fake.messages[0].ts,channel:fake.dm}]);
  expect(result.actual).toMatchObject({ts:fake.messages[0].ts,channel:fake.dm,bot_id:BOT});
  // One post, one read by ts in the returned DM, nothing sent twice.
  expect(fake.calls.map(c=>`${c.method} ${new URL(c.url).pathname}`)).toEqual(['POST /api/chat.postMessage','GET /api/conversations.history']);
  const read=new URL(fake.calls[1].url).searchParams;
  expect(Object.fromEntries(read)).toEqual({channel:fake.dm,latest:fake.messages[0].ts,inclusive:'true',limit:'1'});
  // Intent and response receipts for both calls; the resource never carries the channel or the text.
  expect(r.receipts.map(x=>`${x.phase} ${x.resource}`)).toEqual(['intent chat.postMessage','response chat.postMessage','intent conversations.history','response conversations.history']);
  expect(JSON.stringify(r.receipts)).not.toContain('buyer@example.com');
 });
 test('a request with & < > and a bare email still confirms',async()=>{
  const fake=new FakeSlack();const r=run(fake,'Budget <check> & audience for buyer.two@example.com');
  await r.go();expect(fake.messages[0].text).toContain('&lt;check&gt; &amp; audience');
 });
 test('a history without the message throws for a person to reconcile, and nothing is sent again',async()=>{
  const fake=new FakeSlack();fake.history='missing';
  await expect(run(fake).go()).rejects.toThrow('Slack message read-back could not be confirmed; reconcile before sending again');
  expect(fake.calls.filter(c=>c.method==='POST')).toHaveLength(1);
 });
 test('a message without bot_id, or from another bot, does not confirm',async()=>{
  for(const history of ['no-bot','other-bot'] as const){
   const fake=new FakeSlack();fake.history=history;
   await expect(run(fake).go()).rejects.toThrow('read-back could not be confirmed');
  }
 });
 test('a receipt for another channel, or without a ts, is not a verifiable receipt and is never read back',async()=>{
  for(const answer of ['other-channel','no-ts'] as const){
   const fake=new FakeSlack();fake.answer=answer;
   await expect(run(fake).go()).rejects.toThrow('Slack did not return a verifiable message receipt');
   expect(fake.calls.map(c=>c.method)).toEqual(['POST']);
  }
 });
 test('a Slack refusal is a refusal, not a confirmation',async()=>{
  const fake=new FakeSlack();fake.answer='refused';
  await expect(run(fake).go()).rejects.toThrow('slack rejected the request');
 });
});
