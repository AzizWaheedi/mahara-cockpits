import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { statusHandler } from '../api/status.js';
import { accessHandler } from '../api/access.js';
import { linksHandler } from '../api/links.js';
import { linkToken } from '../lib/links.js';
import { prepareEvent } from '../scripts/prepare.mjs';
import { registrationInput, referenceHash } from '../lib/intake.js';

const env = { WEBINAR_PUBLIC_ORIGIN: 'https://example.invalid', WEBINAR_LINK_SECRET: 'synthetic-link-secret-not-used-in-production', WEBINAR_LINK_ADMIN_SECRET: 'synthetic-admin-secret-not-used-in-production' };
const token = randomBytes(32).toString('base64url');
const state = { status: 'confirmed', registration_id: '00000000-0000-4000-8000-000000000001', revision: 1, starts_at: '2099-01-01T17:00:00Z', timezone: 'Asia/Kuwait', contact_id: 'private' };
function req(body, headers = {}) { const r = Readable.from([JSON.stringify(body)]); r.method = 'POST'; r.headers = { origin: env.WEBINAR_PUBLIC_ORIGIN, ...headers }; return r; }
function res() { return { headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(n) { this.code=n; return this; }, json(v) { this.body=v; return this; } }; }

test('status needs an unguessable capability, never a contact or request UUID', async () => {
  let calls=0; const handle=statusHandler({ env, store:{ rpc:async()=>{ calls++; return state; } } });
  for(const b of [{contact_id:'private'},{token:state.registration_id}]) { const r=res(); await handle(req(b),r); assert.equal(r.code,404); }
  assert.equal(calls,0);
});
test('public status redacts identities and only issues links after both receipts', async () => {
  for(const status of ['processing','needs_review','schedule_changed','confirmed']) {
    const calls=[]; const handle=statusHandler({env,store:{rpc:async(name,args)=>{calls.push([name,args]);return name==='cockpit_webinar_intake_status'?{...state,status}:{};}}});
    const r=res(); await handle(req({token}),r); assert.equal(r.code,200);
    assert.equal(JSON.stringify(r.body).includes(state.registration_id),false); assert.equal(r.body.contact_id,undefined);
    assert.equal(calls.length,status==='confirmed'?3:1); assert.equal(r.headers['Referrer-Policy'],'no-referrer');
    if(status==='confirmed') { assert.match(r.body.links.survey,/access.html#survey=/); assert.notEqual(r.body.links.survey,r.body.links.join); }
  }
});
test('tokens are stable per registration, revision and purpose; weak keys are rejected', () => {
  const a=linkToken(state.registration_id,1,'survey',env); assert.equal(a.length,43); assert.equal(a,linkToken(state.registration_id,1,'survey',env));
  assert.notEqual(a,linkToken(state.registration_id,2,'survey',env)); assert.notEqual(a,linkToken(state.registration_id,1,'join',env));
  assert.throws(()=>linkToken('x',1,'join',{WEBINAR_LINK_SECRET:'short'}),/configured/);
});
test('resolution fixes the destination and ignores a supplied redirect', async () => {
  const r=res(); await accessHandler({env,store:{rpc:async()=>({form_id:'P1xP4r24'})}})(req({purpose:'survey',token,url:'https://evil.invalid'}),r);
  assert.equal(r.code,200); assert.equal(r.body.destination,`https://maharamedia.typeform.com/to/P1xP4r24#webinar_ref=${token}`);
  for(const url of ['https://evil.invalid/j/123?tk=x','https://zoom.us/s/123?tk=x','https://zoom.us/j/123','https://zoom.us/j/999?tk=x']) {
    const r=res(); await accessHandler({env,store:{rpc:async()=>({meeting_id:'123',join_url:url})}})(req({purpose:'join',token}),r); assert.equal(r.code,404);
  }
});
test('revoked or expired refs, wrong purposes and foreign origins cannot resolve', async () => {
  let calls=0; const handle=accessHandler({env,store:{rpc:async()=>{calls++;return null;}}});
  for(const [body,headers,code] of [[{purpose:'join',token},{},404],[{purpose:'pitch1',token},{},404],[{purpose:'survey',token},{origin:'https://evil.invalid'},403]]) { const r=res();await handle(req(body,headers),r);assert.equal(r.code,code); }
  assert.equal(calls,1);
});
test('issuing endpoint requires its own admin credential and confirmed scope', async () => {
  let calls=0; const handle=linksHandler({env,store:{rpc:async()=>{calls++;return {status:'processing'};}}});
  let r=res(); await handle(req({registration_id:state.registration_id}),r);assert.equal(r.code,401);assert.equal(calls,0);
  r=res(); await handle(req({registration_id:state.registration_id},{authorization:'Bearer '+env.WEBINAR_LINK_ADMIN_SECRET}),r);assert.equal(r.code,200);assert.deepEqual(r.body.links,{});assert.equal(calls,1);
});
test('capability is hashed before storage; outages never leak private data', async () => {
  const input=registrationInput({request_id:'00000000-0000-4000-8000-000000000001',status_token:token,first_name:'Test',email:'test@example.invalid',phone:'+96500000000'});
  assert.equal(input.status_hash,referenceHash(token));assert.equal(JSON.stringify(input).includes(token),false);
  const r=res();await statusHandler({env,store:{rpc:async()=>{throw Error('private');}}})(req({token}),r);assert.equal(r.code,503);assert.equal(JSON.stringify(r.body).includes('private'),false);
});
test('plan-only event preparation is inert and never invents a draft date', async () => {
  const {default:current}=await import('../lib/schedule.generated.js');const {config_sha256,ends_at,legacy_round,...source}=current;
  let calls=0;const result=await prepareEvent({current:source,store:{read:async()=>{calls++;},rpc:async()=>{calls++;}}});assert.equal(calls,0);assert.equal(result.starts_at,null);assert.equal(result.mode,'plan');
});
