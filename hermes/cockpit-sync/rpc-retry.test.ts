import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rpc} from './worker';

const env={SUPABASE_URL:'https://bldgtotkfmhoxmlzowdx.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'fixture'} as any;
const flaky=(failures:number)=>{let calls=0;const request=(async()=>{calls++;if(calls<=failures)throw new TypeError('socket connection was closed unexpectedly');return new Response('{"ok":true}');}) as unknown as typeof fetch;return {request,calls:()=>calls};};

// 2026-10-08: a stale pooled connection failed the state read and the lease
// release right after a good claim, so the lease stayed held for 30 minutes.
test('safe repository reads and lease release retry a dropped connection', async () => {
 for(const name of ['cockpit_native_media_state','cockpit_native_media_release','cockpit_native_media_fence']){
  const f=flaky(2);
  assert.deepEqual(await rpc(env,name,{},f.request),{ok:true});
  assert.equal(f.calls(),3);
 }
});

test('claims and publications are never retried automatically', async () => {
 for(const name of ['cockpit_native_media_claim','cockpit_native_media_publish']){
  const f=flaky(1);
  await assert.rejects(rpc(env,name,{},f.request));
  assert.equal(f.calls(),1);
 }
});

test('an HTTP error is not retried', async () => {
 let calls=0;
 const request=(async()=>{calls++;return new Response('no',{status:500});}) as unknown as typeof fetch;
 await assert.rejects(rpc(env,'cockpit_native_media_state',{},request));
 assert.equal(calls,1);
});
