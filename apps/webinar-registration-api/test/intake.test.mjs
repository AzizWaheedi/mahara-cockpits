import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import crypto from "node:crypto";
import { registerHandler } from "../api/register.js";
import { surveyHandler } from "../api/survey.js";
import { ghlRegistrationHandler } from "../api/ghl-registration.js";
import { createStore } from "../lib/store.js";
import { rawBody } from "../lib/intake.js";

const now=Date.now();
const current={status:'scheduled',event_key:'test',revision:1,starts_at:new Date(now+86400000).toISOString(),duration_minutes:90,legacy_round:'test',config_sha256:'a'.repeat(64),providers:{ghl_location_id:'location',ghl_calendar_id:'calendar'}};
const env={WEBINAR_INTAKE_ENABLED:'true',WEBINAR_PUBLIC_ORIGIN:'https://example.invalid',WEBINAR_GHL_HANDOFF_SECRET:'synthetic-secret',TYPEFORM_SECRET:'synthetic-typeform'};
const body={request_id:crypto.randomUUID(),first_name:'Test',email:'test@example.invalid',phone:'+96500000000'};
function request(value,headers={}) {
  const req=Readable.from([typeof value==='string'?value:JSON.stringify(value)]);
  req.method='POST';req.headers={'content-type':'application/json',origin:'https://example.invalid',...headers};return req;
}
function response() {return {code:0,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(value){this.body=value;return this;}};}
function fixture(handler,overrides={}) { const calls=[]; const store={async rpc(...args){calls.push(args);return {status:'accepted'};}};return {calls,handle:handler({store,env,current,now:()=>now,...overrides})}; }

test('signup returns processing only after durable commit; no contact IDs leak',async()=>{
  const {handle,calls}=fixture(registerHandler);const res=response();await handle(request(body),res);
  assert.equal(res.code,202);assert.deepEqual(res.body,{ok:true,status:'processing'});
  assert.equal(calls[0][0],'cockpit_accept_webinar_intake');assert.equal(calls[0][1].p_source_id,body.request_id);
  assert.equal(res.headers['Cache-Control'],'no-store');
});
test('database failure returns retryable error without false confirmation or private details',async()=>{
  const {handle}=fixture(registerHandler,{store:{rpc:async()=>{throw new Error('secret and email@example.invalid');}}});
  const res=response();await handle(request(body),res);assert.equal(res.code,503);assert.equal(res.headers['Retry-After'],'30');assert.equal(JSON.stringify(res.body).includes('email@'),false);
});
test('closed schedule, untrusted IDs, foreign origin and missing receipt do not reach storage',async()=>{
  for(const [input,headers,overrides,status] of [[{...body,contact_id:'victim'},{},{},400],[body,{origin:'https://evil.invalid'},{},403],[{...body,request_id:undefined},{},{},400],[body,{}, {current:{...current,status:'draft'}},503]]) {
    const {handle,calls}=fixture(registerHandler,overrides);const res=response();await handle(request(input,headers),res);assert.equal(res.code,status);assert.equal(calls.length,0);
  }
});
const survey={event_type:'form_response',form_response:{form_id:'P1xP4r24',token:'response-1',submitted_at:new Date(now-1000).toISOString(),answers:[],hidden:{}}};
function signed(value,secret=env.TYPEFORM_SECRET) {const raw=JSON.stringify(value);return request(raw,{'typeform-signature':'sha256='+crypto.createHmac('sha256',secret).update(raw).digest('base64')});}
test('signed survey is durable before ACK and carries no email fallback',async()=>{
  const {handle,calls}=fixture(surveyHandler);const res=response();await handle(signed(survey),res);assert.equal(res.code,200);assert.equal(calls[0][1].p_ref_hash,null);assert.equal(calls[0][1].p_response,'response-1');
});
test('mandatory signature, body tampering, wrong form and malformed timestamp fail closed',async()=>{
  for(const [req,options,status] of [[signed(survey),{env:{...env,TYPEFORM_SECRET:''}},503],[signed(survey,'wrong'),{},401],[signed({...survey,form_response:{...survey.form_response,form_id:'other'}}),{},400],[signed({...survey,form_response:{...survey.form_response,submitted_at:'yesterday'}}),{},400]]) {
    const {handle,calls}=fixture(surveyHandler,options),res=response();await handle(req,res);assert.equal(res.code,status);assert.equal(calls.length,0);
  }
});
test('a signed webhook still returns 503 when the durable write fails',async()=>{
  const {handle}=fixture(surveyHandler,{store:{rpc:async()=>{throw Error('db down');}}});const res=response();await handle(signed(survey),res);assert.equal(res.code,503);
});
test('streaming body limit works without Content-Length',async()=>{
  await assert.rejects(()=>rawBody(request('x'.repeat(500)),100),/body_too_large/);
});
test('native handoff requires authorization, exact location, real receipt and timestamp',async()=>{
  const input={receipt_id:'form:receipt',event_key:'test',revision:1,contact_id:'scoped-contact',location_id:'location',submitted_at:new Date(now).toISOString()};
  for(const [b,h,status] of [[input,{},401],[{...input,location_id:'wrong'},{authorization:'Bearer synthetic-secret'},400],[input,{authorization:'Bearer synthetic-secret'},202]]) {
    const {handle,calls}=fixture(ghlRegistrationHandler),res=response();await handle(request(b,h),res);assert.equal(res.code,status);assert.equal(calls.length,status===202?1:0);
  }
});
test('storage transport maps receipt conflicts without exposing SQL or credentials',async()=>{
  let requestCount=0;
  const store=createStore({WEBINAR_SUPABASE_URL:'https://synthetic.supabase.co',WEBINAR_SUPABASE_SERVICE_KEY:'private'},async()=>{requestCount++;return new Response(JSON.stringify({message:'Intake receipt reused'}),{status:400});});
  await assert.rejects(()=>store.rpc('test',{}),e=>e.status===409 && e.code==='receipt_conflict');assert.equal(requestCount,1);
});
