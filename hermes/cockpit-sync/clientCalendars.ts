import { z } from 'zod';
import { assertNativeFence, callTool, type Row } from './runtime';
import type { Env } from './transport';
const eventSchema=z.object({eventId:z.string().min(1),calendarId:z.string().min(1),title:z.string(),start:z.string().min(1),end:z.string().min(1),allDay:z.boolean(),attendees:z.array(z.string()),kind:z.enum(['client','team','other'])}).passthrough();
const resultSchema=z.object({events:z.array(eventSchema),checkedAt:z.number().int().nonnegative()});
export async function collectSharedGoogleCalendars(state:Row,env:Env,now=Date.now()){
 const from=now-7*86400000,to=now+21*86400000;
 const names=new Set<string>();
 for(const item of state.csm?.clients??[])if(typeof item.name==='string'&&item.name.trim())names.add(item.name);
 for(const item of state.oldCampaigns??[])if(typeof item.clientName==='string'&&item.clientName.trim())names.add(item.clientName);
 const output:Record<string,unknown>={};
 const clientNames=[...names];
 for(const [app,key] of [['client-success','CSM_CALENDAR_IDS'],['creative','CREATIVE_CALENDAR_IDS']] as const){
  const calendarIds=[...new Set((env[key]??'').split(',').map(id=>id.trim()).filter(Boolean))];
  if(!calendarIds.length){output[app]={configured:false,calendarIds,from,to,checkedAt:null,events:null};continue;}
  for(const id of calendarIds)z.string().email().parse(id);
  const serviceAccountEmail=z.string().email().parse(state.calendarConfig?.serviceAccountEmail);
  const events:z.infer<typeof eventSchema>[]=[];let checkedAt:number|null=null;
  for(const calendarId of calendarIds){
   await assertNativeFence();
   const result=resultSchema.parse(await callTool('native_google_calendar_events',{calendarId,serviceAccountEmail,timeMin:from,timeMax:to,clientNames}));
   if(result.events.some(event=>event.calendarId!==calendarId))throw new Error('Google calendar source identity does not match its configuration');
   events.push(...result.events);checkedAt=checkedAt===null?result.checkedAt:Math.min(checkedAt,result.checkedAt);
  }
  output[app]={configured:true,calendarIds,from,to,checkedAt,events};
 }
 return output;
}
