import type {SupabaseClient} from 'npm:@supabase/supabase-js@2';
import {z} from 'zod';
import {ghlTools, providerTools} from './tools.ts';
export class ProjectionAccessError extends Error {}
const NEXT_POC = 'c48c1323-ca6a-465f-84cb-8c24f0f62df3';
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,150}$/);
const argsSchema = z.object({taskId:idSchema,day:z.string(),time:z.string(),minutes:z.number().optional(),meetingId:z.string().optional()}).strict();
const contextSchema = z.object({actorId:z.string(),email:z.string(),taskId:idSchema,clientName:z.string(),client:z.object({ghlContactId:z.string().nullish()}).passthrough(),contactId:z.string().nullish(),appointments:z.array(z.object({apptId:idSchema})).optional()}).passthrough();
const planSchema = z.object({taskId:idSchema,when:z.string(),title:z.string(),end:z.string(),nextPoc:z.string(),nextPocValue:z.number(),calendarId:idSchema,contactId:idSchema,locationId:z.string(),phase:z.string(),eventId:idSchema.optional()});
const eventSchema = z.object({id:z.string(),calendarId:z.string(),contactId:z.string(),title:z.string(),startTime:z.string(),endTime:z.string(),appointmentStatus:z.string()});
const receiptSchema = z.object({id:z.string(),actor_id:z.string(),operation:z.string(),request:z.unknown(),state:z.enum(['sending','confirmed','reconcile','failed']),result:z.unknown(),created_at:z.string()});
type Plan = z.infer<typeof planSchema>;
type ReadProvider = {call:(method:'GET'|'POST',path:string,body?:Record<string,unknown>)=>Promise<unknown>};
type Result = {ok:boolean;error?:string;eventId?:string;when?:string;title?:string};
function canonical(value: unknown): string {
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value && typeof value === 'object') return '{'+Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
  return JSON.stringify(value) ?? 'null';
}

export function bookingPlan(rawArgs: unknown, rawContext: unknown, now = Date.now()) {
  const args=argsSchema.parse(rawArgs), context=contextSchema.parse(rawContext);
  if(args.taskId !== context.taskId) throw Error('Choose an assigned client');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(args.day) || !Number.isFinite(Date.parse(args.day+'T12:00:00Z')) || new Date(args.day+'T12:00:00Z').toISOString().slice(0,10) !== args.day || !/^([01]\d|2[0-3]):[0-5]\d$/.test(args.time)) throw Error("Pick the call's day and time.");
  const minutes = Math.round(args.minutes ?? 30);
  if(minutes < 15 || minutes > 90) throw Error('A call runs 15 to 90 minutes.');
  const when = `${args.day}T${args.time}:00+03:00`, start = Date.parse(when);
  if(start < now + 600000 || start > now + 120 * 86400000) throw Error('Pick a future time inside the next four months.');
  const name = context.clientName.replace(/\S*(upgrad|up-?sell|renew)\S*/gi,' ').replace(/\s{2,}/g,' ').replace(/^[\s:,.-]+|[\s:,.-]+$/g,'').trim();
  const title = name ? 'Results and strategy review: '+name : 'Results and strategy review';
  if(/upgrad|up-?sell|renew/i.test(title)) throw Error('A client call cannot have a sales title.');
  return {taskId:context.taskId,when,title,end:new Date(start + minutes * 60000).toISOString().replace(/\.\d{3}Z$/, '+00:00'),nextPoc:args.day,nextPocValue:Date.parse(args.day+'T09:00:00+03:00')};
}

export function appointmentMatches(rawEvent: unknown, plan: Pick<Plan,'calendarId'|'contactId'|'title'|'when'|'end'>) {
  const parsed=eventSchema.safeParse(rawEvent); if(!parsed.success) return false;
  const event=parsed.data;
  return Boolean(event.id) && event.calendarId === plan.calendarId && event.contactId === plan.contactId && event.title === plan.title && Date.parse(event.startTime) === Date.parse(plan.when) && Date.parse(event.endTime) === Date.parse(plan.end) && event.appointmentStatus === 'confirmed';
}
function fieldMatches(rawTask: unknown, plan: Pick<Plan,'taskId'|'nextPocValue'>) {
  const task=z.object({id:z.string(),custom_fields:z.array(z.object({id:z.string(),value:z.unknown().optional()}))}).parse(rawTask);
  const field=task.custom_fields.find(x=>x.id===NEXT_POC);
  return task.id===plan.taskId && (typeof field?.value==='string'||typeof field?.value==='number') && Number(field.value)===plan.nextPocValue;
}
function appointmentResponse(raw: unknown) {
  const body=z.object({appointment:z.unknown().optional(),event:z.unknown().optional()}).passthrough().parse(raw);
  return body.appointment ?? body.event ?? body;
}

/** Reads only. An absent or ambiguous event never permits another create. */
export async function reconcileBooking(plan: Omit<Plan,'phase'>, ghl: ReadProvider, clickup: ReadProvider): Promise<Result> {
  let events: unknown[];
  if(plan.eventId) events=[appointmentResponse(await ghl.call('GET','calendars/events/appointments/'+encodeURIComponent(idSchema.parse(plan.eventId))))];
  else {
    const query=new URLSearchParams({locationId:plan.locationId,calendarId:plan.calendarId,startTime:String(Date.parse(plan.when)-60000),endTime:String(Date.parse(plan.end)+60000)});
    const got=z.object({events:z.array(z.unknown()).max(200),nextPage:z.unknown().optional(),meta:z.object({nextPageUrl:z.unknown().optional()}).optional()}).parse(await ghl.call('GET','calendars/events?'+query));
    if(got.nextPage || got.meta?.nextPageUrl) return {ok:false,error:'Appointment search was incomplete. Reconcile in GoHighLevel.'};
    events=got.events;
  }
  const matches=events.filter(event=>appointmentMatches(event,plan));
  if(matches.length!==1) return {ok:false,error:'The existing appointment is missing or ambiguous. Check GoHighLevel before making another booking.'};
  const event=eventSchema.parse(matches[0]);
  if(!fieldMatches(await clickup.call('GET','task/'+idSchema.parse(plan.taskId)),plan)) return {ok:false,eventId:event.id,error:'The appointment exists, but ClickUp next contact is not confirmed. Reconcile the client card; do not book again.'};
  return {ok:true,eventId:event.id,when:plan.when,title:plan.title};
}

export function billingFreshness(finishedAt: string | null, now=Date.now()) {
  const parsed=finishedAt===null ? NaN : Date.parse(finishedAt);
  const ledgerSyncedAt=Number.isFinite(parsed) ? parsed : null;
  const ok=ledgerSyncedAt!==null && ledgerSyncedAt<=now && now-ledgerSyncedAt<=3600000;
  return {ok,ledgerSyncedAt,error:ok ? null : ledgerSyncedAt===null ? 'Billing has no confirmed native finance refresh yet.' : 'Billing facts are older than one hour. Reading them does not refresh the finance ledger.'};
}

export async function runProjectionOperation(client: SupabaseClient, admin: SupabaseClient, rawInput: unknown, env: (name:string)=>string|undefined) {
  const input=z.object({operation:z.enum(['projections.bookCall','projections.refreshBillingNow']),args:z.unknown().optional(),apply:z.boolean().optional(),requestId:z.string().optional()}).parse(rawInput);
  if(input.operation==='projections.refreshBillingNow') {
    const {data,error}=await client.rpc('cockpit_csm_projection_refresh_billing');
    if(error) throw new ProjectionAccessError(error.message);
    const facts=z.object({payments:z.number(),accounts:z.number(),finishedAt:z.string().nullable()}).passthrough().parse(data);
    return {...facts,...billingFreshness(facts.finishedAt),readOnly:true};
  }
  const args=argsSchema.parse(input.args);
  const scope=async()=>{
    const {data,error}=await client.rpc('cockpit_csm_projection_booking_context',{p_task_id:args.taskId,p_meeting_id:args.meetingId??null});
    if(error) throw new ProjectionAccessError(error.message);
    return contextSchema.parse(data);
  };
  const context=await scope();
  const checkScope=async()=>{if(canonical(await scope())!==canonical(context)) throw Error('Client access or source changed; refresh before applying.');};
  if(input.apply!==true) return {dryRun:true,plan:bookingPlan(args,context)};
  const requestId=z.string().uuid().parse(input.requestId);
  const when=`${args.day}T${args.time}:00+03:00`;
  // The task/time key also blocks a new request id duplicating an uncertain send.
  const first=await admin.from('cockpit_csm_actions').select('*').eq('id',requestId).maybeSingle();
  if(first.error) throw Error('Could not inspect the booking receipt.');
  let prior=first.data ? receiptSchema.parse(first.data) : null;
  if(!prior) {
    const found=await admin.from('cockpit_csm_actions').select('*').eq('operation','projections.bookCall').eq('context->>taskId',context.taskId).eq('context->>bookingWhen',when).maybeSingle();
    if(found.error) throw Error('Could not inspect the existing booking.');
    prior=found.data ? receiptSchema.parse(found.data) : null;
  }
  if(prior && (prior.actor_id!==context.actorId || prior.operation!==input.operation || canonical(prior.request)!==canonical(args))) throw Error('A different request already owns this booking. Reconcile it before continuing.');
  if(prior?.state==='confirmed') return prior.result;
  let actionId=prior?.id;
  const health=async(row:Record<string,unknown>)=>{const {error}=await admin.from('cockpit_csm_provider_health').insert({...row,action_id:actionId??null});if(error) throw Error('Could not save the provider health receipt.');};
  const ghl=ghlTools(env('GHL_MAHARA_PIT')??'',health), clickup=providerTools(env('CLICKUP_API_TOKEN')??'',health);
  const finish=async(result:Result)=>{
    await checkScope();
    const {data,error}=await admin.rpc('cockpit_csm_projection_finish_booking',{p_id:actionId,p_result:result});
    if(error) throw Error('The booking exists, but local confirmation failed. Reconcile this receipt before retrying.');
    return data as unknown;
  };
  const checkpoint=async(plan:Plan)=>{
    const {data,error}=await admin.from('cockpit_csm_actions').update({result:plan}).eq('id',actionId).eq('state','sending').select('id').maybeSingle();
    if(error || !data) throw Error('Could not save the booking checkpoint.');
  };
  try {
    if(prior) {
      if(prior.state==='sending' && Date.now()-Date.parse(prior.created_at)<120000) return {ok:false,reconcile:true,receiptId:actionId,error:'This booking is still being processed. Check this same request after two minutes.'};
      const parsed=planSchema.safeParse(prior.result);
      if(!parsed.success) return {ok:false,reconcile:true,receiptId:actionId,error:'The booking intent is incomplete. Inspect its provider receipts before booking again.'};
      const result=await reconcileBooking(parsed.data,ghl,clickup);
      if(!result.ok) return {...result,reconcile:true,receiptId:actionId};
      return await finish(result);
    }
    const base=bookingPlan(args,context);
    const locationId=env('GHL_MAHARA_LOCATION');
    if(!locationId) throw Error('GHL_MAHARA_LOCATION is not configured.');
    const calendars=z.object({calendars:z.array(z.object({id:idSchema,name:z.string(),isActive:z.boolean().optional(),teamMembers:z.array(z.object({isPrimary:z.boolean().optional(),userId:z.string().optional()})).optional()})).max(200)}).parse(await ghl.call('GET','calendars/?locationId='+encodeURIComponent(locationId)));
    const calendar=calendars.calendars.find(c=>c.isActive!==false && /check[\s-]*in/i.test(c.name));
    if(!calendar) throw Error('There is no active check-in calendar in GoHighLevel.');
    const member=calendar.teamMembers?.find(m=>m.isPrimary)??calendar.teamMembers?.[0];
    let contactId=context.client.ghlContactId??context.contactId;
    if(!contactId) for(const appt of (context.appointments??[]).slice(0,5)) {
      const event=z.object({contactId:z.string().optional()}).parse(appointmentResponse(await ghl.call('GET','calendars/events/appointments/'+encodeURIComponent(appt.apptId))));
      if(event.contactId) {contactId=event.contactId;break;}
    }
    if(!contactId) throw Error('No GoHighLevel contact is linked to this client. Book in GoHighLevel, then record its date.');
    const plan:Plan={...base,contactId:idSchema.parse(contactId),calendarId:calendar.id,locationId,phase:'prepared'};
    await checkScope();
    const {error:insert}=await admin.from('cockpit_csm_actions').insert({id:requestId,operation:input.operation,actor_id:context.actorId,actor_email:context.email,context:{...context,bookingWhen:plan.when},request:args,result:plan});
    if(insert) throw Error('Another request may own this booking. Check the existing receipt before retrying.');
    actionId=requestId;
    await checkScope();
    plan.phase='creating'; await checkpoint(plan);
    const made=z.object({id:idSchema}).parse(appointmentResponse(await ghl.call('POST','calendars/events/appointments',{calendarId:plan.calendarId,locationId,contactId:plan.contactId,startTime:plan.when,endTime:plan.end,title:plan.title,appointmentStatus:'confirmed',ignoreFreeSlotValidation:true,toNotify:true,...(member?.userId ? {assignedUserId:member.userId} : {})})));
    plan.eventId=made.id; plan.phase='created'; await checkpoint(plan);
    if(!appointmentMatches(appointmentResponse(await ghl.call('GET','calendars/events/appointments/'+encodeURIComponent(plan.eventId))),plan)) throw Error('GoHighLevel appointment read-back did not match. Reconcile before retrying.');
    await checkScope();
    plan.phase='clickup'; await checkpoint(plan);
    await clickup.call('POST',`task/${plan.taskId}/field/${NEXT_POC}`,{value:plan.nextPocValue});
    if(!fieldMatches(await clickup.call('GET','task/'+plan.taskId),plan)) throw Error('ClickUp next-contact read-back was not confirmed.');
    plan.phase='verified'; await checkpoint(plan);
    return await finish({ok:true,eventId:plan.eventId,when:plan.when,title:plan.title});
  } catch(error) {
    const message=error instanceof Error ? error.message : 'Booking failed.';
    if(actionId) {
      const {error:save}=await admin.from('cockpit_csm_actions').update({state:'reconcile',error:message.slice(0,1500),finished_at:new Date().toISOString()}).eq('id',actionId).eq('state','sending');
      if(save) throw Error('Booking outcome and its failure receipt need reconciliation. Do not book again.');
      return {ok:false,reconcile:true,receiptId:actionId,error:message};
    }
    throw error;
  }
}
