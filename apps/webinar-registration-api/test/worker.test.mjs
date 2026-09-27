import { test } from "node:test";
import assert from "node:assert/strict";
import { runOne, exactContact, matchingAppointment, safeJoinUrl } from "../lib/worker.js";
import { createProviders } from "../lib/providers.js";

const starts=new Date(Date.now()+86400000).toISOString();
const contact={id:'contact',locationId:'location',email:'test@example.invalid',phone:'+96500000000'};
function fixture(kind='training_appointment',extra={}) {
  const calls=[],job={id:'job',intake_id:'intake',registration_id:'reg',lease_token:'lease',kind};
  const store={rpc:async(name,args)=>{calls.push([name,args]);return name==='cockpit_claim_webinar_job'?job:'reg';},read:async path=>{
    if(path.startsWith('cockpit_webinar_intakes')) return [{id:'intake',source:'web',event_id:'event',event_revision:1,payload:{email:contact.email,phone:contact.phone},location_id:'location'}];
    if(path.startsWith('cockpit_webinar_event_configs')) return [{location_id:'location',calendar_id:'calendar',meeting_id:'123',registration_open:true}];
    if(path.startsWith('cockpit_webinar_event_versions')) return [{revision:1,scheduled_at:starts}];
    return [{id:'reg',event_id:'event',location_id:'location',contact_id:'contact'}];
  }};
  const providers={appointments:async()=>[],createAppointment:async()=>{calls.push(['external_create']);return{id:'appointment',locationId:'location',calendarId:'calendar',contactId:'contact',startTime:starts,appointmentStatus:'confirmed'};},getContact:async()=>contact,findContacts:async()=>[contact],...extra};
  return {calls,store,providers,enabled:true,allow:{trainingBooking:true,zoomRegistration:true,contactCreation:true}};
}
test('failed appointment lookup never creates another booking',async()=>{
  const f=fixture('training_appointment',{appointments:async()=>{throw Error('network');}});assert.equal((await runOne(f)).status,'retry');assert.equal(f.calls.some(c=>c[0]==='external_create'),false);
});
test('intent is persisted before provider mutation; response loss becomes uncertain',async()=>{
  const f=fixture('training_appointment',{createAppointment:async()=>{f.calls.push(['external_create']);throw Error('timeout after provider accepted');}});
  assert.equal((await runOne(f)).status,'uncertain');
  assert.ok(f.calls.findIndex(c=>c[0]==='cockpit_mark_webinar_mutation')<f.calls.findIndex(c=>c[0]==='external_create'));
});
test('verified existing appointment is saved with no mutation',async()=>{
  const f=fixture('training_appointment',{appointments:async()=>[{id:'existing',locationId:'location',calendarId:'calendar',contactId:'contact',startTime:starts,appointmentStatus:'confirmed'}]});
  assert.equal((await runOne(f)).status,'succeeded');assert.equal(f.calls.some(c=>c[0]==='cockpit_mark_webinar_mutation'),false);
  assert.equal(f.calls.at(-1)[1].p_receipt.resource_id,'existing');
});
test('worker is inert unless enabled and provider write switches are explicit',async()=>{
  const f=fixture();assert.equal((await runOne({...f,enabled:false})).status,'held');assert.equal(f.calls.length,0);
  assert.equal((await runOne({...f,allow:{}})).status,'blocked');assert.equal(f.calls.some(c=>c[0]==='external_create'),false);
});
test('conflicting email and phone contacts are never selected by provider priority',()=>{
  assert.throws(()=>exactContact([contact,{...contact,id:'other',email:'other@example.invalid'}],contact,'location'),/ambiguous/);
  assert.equal(exactContact([contact,contact],contact,'location').id,'contact');
  assert.throws(()=>exactContact([{...contact,locationId:'other'}],contact,'location'),/scope_mismatch/);
});
test('duplicate appointments and host/foreign Zoom links are rejected',()=>{
  const a={id:'x',locationId:'location',calendarId:'calendar',contactId:'contact',startTime:starts};
  assert.throws(()=>matchingAppointment([a,a],{location_id:'location',calendar_id:'calendar',starts_at:starts},'contact'),/ambiguous/);
  assert.equal(safeJoinUrl('https://us02web.zoom.us/w/123?tk=private','123'),true);
  for(const url of ['https://zoom.us/start/123?zak=secret','https://zoom.us.evil.invalid/w/123?tk=x','https://zoom.us/w/999?tk=x','https://zoom.us/w/123']) assert.equal(safeJoinUrl(url,'123'),false);
});
test('Zoom settings that can email registrants prevent writes',async()=>{
  const f=fixture('zoom_registrant',{meeting:async()=>({id:123,type:2,start_time:starts,settings:{approval_type:0,registrants_confirmation_email:true}}),registrants:async()=>[],createRegistrant:async()=>{throw Error('should not run');}});
  assert.equal((await runOne(f)).code,'zoom_registration_held');assert.equal(f.calls.some(c=>c[0]==='cockpit_mark_webinar_mutation'),false);
});
test('pagination counts must reconcile before contact creation can be considered',async()=>{
  const p=createProviders({env:{GHL_TOKEN:'synthetic'},fetcher:async()=>new Response(JSON.stringify({contacts:[],meta:{total:1}}))});
  await assert.rejects(()=>p.findContacts(contact,'location'),/pagination_incomplete/);
});
test('provider error bodies never escape in diagnostics',async()=>{
  const p=createProviders({env:{GHL_TOKEN:'synthetic'},fetcher:async()=>new Response('email@example.invalid private',{status:401})});
  await assert.rejects(()=>p.getContact('contact'),e=>e.message==='provider_credentials_rejected');
});
