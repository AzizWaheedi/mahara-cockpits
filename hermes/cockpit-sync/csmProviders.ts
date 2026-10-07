import {type Row, callTool, providerFetch, unwrap} from './runtime';
import {appointmentRows,summarise,staleRows,byAd,toDate,MONTHS,parseAdded,parseAppt,daysBetween,type Day,type Call,type GhlAccount} from './csmProfileCalculations';
import type {Extension,CallNote} from './csmCadence';

// Provider contracts from media-buyer/convex/csmSync.ts and csmProfiles.ts.
// Any failed authoritative read aborts the plan, rather than substituting zero.
export async function cadenceInputs(){
 const notes:CallNote[]=[],exts:Extension[]=[];
 const weeksByLabel:Record<string,number>={'1 WEEK':1,'2 WEEKS':2,'4 WEEKS':4};
 for(const form of ['fRokTITH','gqBcyK6g']){
  const response=unwrap(await callTool('pd_typeform_proxy_get',{url:`https://api.typeform.com/forms/${form}/responses?page_size=200`}));
  if(!Array.isArray(response.items))throw new Error('Typeform collection missing');
  for(const item of response.items){
   const answers:Row[]=item.answers??[];
   const find=(ref:string)=>answers.find(a=>a.field?.ref===ref);
   const granted=Date.parse(item.submitted_at);if(!Number.isFinite(granted))throw new Error('Typeform submission date missing');
   if(form==='gqBcyK6g'){
    const client=String(find('5145ff0c-009b-4f51-b3a9-4651efc908be')?.text??'').trim();
    const duration=find('278c2f80-88bd-428e-b330-8c6b3175d63f');
    const weeks=weeksByLabel[String(duration?.choice?.label??duration?.text??'').trim().toUpperCase()];
    if(client&&weeks)exts.push({client,until:new Date(granted+weeks*7*86400000+10800000).toISOString().slice(0,10)});
   }else{
    const taskId=String(find('c484f390-9695-4ffa-9693-9cc219592713')?.text??'').trim();if(!taskId)continue;
    const status=/^(done|sent|ok|okay|n\/a|na|none|nothing|fine|good|no|yes|waiting|pending|follow up|followup|noted)\b/i;
    const commitments=[...new Set([find('82a6b434-15d9-4a14-8496-c20c94628536')?.text,find('5d071906-da6a-4413-a729-0c76d0188d91')?.text].filter(Boolean).flatMap(t=>String(t).split(/\n|\u2022|(?: - )/).map(s=>s.replace(/^[-*\d.\s]+/,'').trim()).filter(s=>s.length>=20&&!status.test(s))))].slice(0,4);
    notes.push({taskId,submitted:new Date(granted+10800000).toISOString().slice(0,10),notes:commitments,defcon:find('ff7970f7-9fad-4fa5-b12b-4d719dfb7587')?.choice?.label,priority:find('c9f99fb1-fec9-47e7-9baa-c5554733723d')?.choice?.label});
   }
  }
 }
 return {notes,exts};
}

export async function sheetPerformance(url:unknown,today:Day){
 const sid=/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(String(url??''))?.[1];
 if(!sid)return undefined;
 const previous=new Date(toDate({...today,d:1}).getTime()-86400000),prev={y:previous.getUTCFullYear(),m:previous.getUTCMonth()+1,d:1};
 const thisTab=`${MONTHS[today.m-1]} ${String(today.y).slice(2)}`,lastTab=`${MONTHS[prev.m-1]} ${String(prev.y).slice(2)}`;
 const wanted=['Appointments',thisTab,lastTab];
 const query=wanted.map(t=>`ranges=${encodeURIComponent(`${t}!A1:P600`)}`).join('&');
 const data=unwrap(await callTool('pd_google_sheets_proxy_get',{url:`https://sheets.googleapis.com/v4/spreadsheets/${sid}/values:batchGet?${query}`}));
 if(!Array.isArray(data.valueRanges)||data.valueRanges.length!==3)throw new Error('Incomplete performance sheet');
 const grids:string[][][]=data.valueRanges.map((r:Row)=>{if(!r.range)throw new Error('Unverified sheet range');const rows=r.values??[];if(!Array.isArray(rows)||rows.length>=600)throw new Error('Performance sheet reached its range limit');return rows;});
 let rows=appointmentRows(grids[0],today),source='Appointments tab';
 if(!rows.length){rows=appointmentRows([...grids[1],...grids[2]],today);source='month tabs';}
 const month=`${today.y}-${String(today.m).padStart(2,'0')}`,lastMonth=`${prev.y}-${String(prev.m).padStart(2,'0')}`,stale=staleRows(rows);
 // Same monthly counts as fanout.readStatSheet, reusing the already verified batch.
 let booked=0,due=0,shows=0,quotes=0,closes=0;
 for(const row of grids[1].slice(2)){
  if(!String(row[0]??'').trim())continue;
  booked++;
  if(/^y/i.test(String(row[10]??'').trim()))quotes++;
  if(/^y/i.test(String(row[11]??'').trim()))closes++;
  const status=String(row[9]??'').trim();if(!status)continue;
  const appointment=parseAppt(row[2],today,parseAdded(row[1],today));
  if(appointment&&daysBetween(appointment,today)>0)continue;
  due++;if(/^y/i.test(status))shows++;
 }
 return {sheetId:sid,source,monthLabel:thisTab,lastMonthLabel:lastTab,
  month:summarise(rows.filter(r=>r.month===month)),lastMonth:summarise(rows.filter(r=>r.month===lastMonth)),
  allTime:summarise(rows),undated:rows.filter(r=>!r.month).length,stale:stale.slice(0,40),staleCount:stale.length,
  byAd:byAd(rows.filter(r=>r.month===month||r.month===lastMonth)),byAdAllTime:byAd(rows),recent:rows.slice(-60).reverse(),
  creativeStats:booked?{tab:thisTab,booked,due,shows,quotes,closes}:undefined,
  appointments:rows.filter(r=>r.added).map(r=>({added:r.added,appAt:r.appAt,booked:Boolean(r.appDate),show:/^y/i.test(r.show)?'y':/^n/i.test(r.show)?'n':'',quote:/^y/i.test(r.quote)?'y':'',closed:/^y/i.test(r.closed)?'y':'',ad:r.ad||r.source||''})),
 };
}

async function ghlGet(acct:GhlAccount,path:string,params:Record<string,string>,version='2021-07-28'){
 const response=await providerFetch(`https://services.leadconnectorhq.com/${path}?${new URLSearchParams(params)}`,{headers:{Authorization:`Bearer ${acct.token}`,Version:version,Accept:'application/json'}});
 if(!response.ok)throw new Error(`GHL profile read failed (${response.status})`);
 return response.json();
}
export async function lostLeads(acct:GhlAccount){
 const response=await ghlGet(acct,'opportunities/pipelines',{locationId:acct.locationId});
 if(!Array.isArray(response.pipelines))throw new Error('GHL pipeline collection missing');
 const target=response.pipelines.find((p:Row)=>/lost/i.test(p.name??'')&&!/old/i.test(p.name??''));
 if(!target)return {reasons:[],leads:[],total:0,pipeline:''};
 const stages=new Map<string,string>((target.stages??[]).map((s:Row)=>[s.id,String(s.name??'')]));
 const found=await ghlGet(acct,'opportunities/search',{location_id:acct.locationId,pipeline_id:target.id,limit:'40'});
 if(!Array.isArray(found.opportunities)||!Number.isFinite(Number(found.meta?.total)))throw new Error('GHL lost lead count unavailable');
 const opps:Row[]=[...found.opportunities].sort((a,b)=>String(b.lastStageChangeAt??b.updatedAt??'').localeCompare(String(a.lastStageChangeAt??a.updatedAt??'')));
 const leads:Row[]=[];
 for(const [i,opp]of opps.entries()){
  const contact=opp.contact??{};let note='';
  if(i<15&&contact.id){const response=await ghlGet(acct,`contacts/${contact.id}/notes`,{});if(!Array.isArray(response.notes))throw new Error('GHL notes collection missing');note=response.notes.map((n:Row)=>String(n.bodyText??'').trim()).filter((t:string)=>!/knowledge base link|form answers|applied before|^https?:\/\/|^\s*$/i.test(t)).slice(0,2).join(' · ').slice(0,220);}
  let ad='';for(const attr of opp.attributions??[]){for(const key of ['utmContent','utmTerm','utmCampaign','adSource'])if(attr[key]){ad=String(attr[key]);break;}if(ad)break;}
  leads.push({name:opp.name||contact.name||'Unnamed',phone:contact.phone??'',reason:stages.get(opp.pipelineStageId)??'Not set',note,ad,source:opp.source??'',movedAt:String(opp.lastStageChangeAt??'').slice(0,10)});
 }
 const counts=new Map<string,number>();for(const lead of leads)counts.set(lead.reason,(counts.get(lead.reason)??0)+1);
 return {pipeline:target.name??'',total:Number(found.meta.total),sampleLimit:40,reasons:[...counts].sort((a,b)=>b[1]-a[1]).map(([reason,count])=>({reason,count})),leads};
}
export async function provisionalFor(acct:GhlAccount){
 const response=await ghlGet(acct,'calendars/',{locationId:acct.locationId},'2021-04-15');
 if(!Array.isArray(response.calendars))throw new Error('GHL calendars collection missing');
 const now=Date.now();let upcoming:Row[]=[],callbacks=0;
 for(const calendar of response.calendars){
  if(!/not confirmed|callback/i.test(calendar.name??''))continue;
  const data=await ghlGet(acct,'calendars/events',{locationId:acct.locationId,calendarId:String(calendar.id),startTime:String(now-7*86400000),endTime:String(now+90*86400000)},'2021-04-15');
  if(!Array.isArray(data.events))throw new Error('GHL calendar events missing');
  if(/callback/i.test(calendar.name)){callbacks+=data.events.filter((e:Row)=>Date.parse(e.startTime)>=now-86400000).length;continue;}
  const kuwait=(s:string)=>Number.isFinite(Date.parse(s))?new Date(Date.parse(s)+10800000).toISOString().slice(0,16).replace('T',' '):'';
  upcoming.push(...data.events.filter((e:Row)=>!/cancel|no.?show|invalid/i.test(e.appointmentStatus??'')).map((e:Row)=>({name:String(e.contact?.name??e.title??'').slice(0,80),at:kuwait(e.startTime??''),status:String(e.appointmentStatus??''),addedAt:kuwait(e.dateAdded??'')})));
 }
 upcoming.sort((a,b)=>a.at.localeCompare(b.at));return {count:upcoming.length,callbacks,upcoming:upcoming.slice(0,25)};
}
export async function fathomCalls():Promise<Call[]>{
 const since=new Date(Date.now()-90*86400000).toISOString().replace(/\.\d{3}Z$/,'Z'),out:Call[]=[];
 let cursor:string|undefined;
 for(let page=0;page<100;page++){
  const params=new URLSearchParams({created_after:since,include_summary:'true'});if(cursor)params.set('cursor',cursor);
  const body=unwrap(await callTool('native_fathom_get',{url:`https://api.fathom.ai/external/v1/meetings?${params}`}));
  if(!Array.isArray(body.items))throw new Error('Fathom meeting collection missing');
  for(const m of body.items)out.push({title:String(m.title??''),at:String(m.scheduled_start_time??m.created_at??''),host:m.recorded_by?.name,external:(m.calendar_invitees??[]).filter((i:Row)=>i.is_external).map((i:Row)=>String(i.name??i.email??'')),url:m.url??m.share_url,summary:String(m.default_summary?.markdown_formatted??'').slice(0,1500)||undefined});
  if(!body.next_cursor)return out;
  if(body.next_cursor===cursor)throw new Error('Fathom pagination did not advance');cursor=body.next_cursor;
 }
 throw new Error('Fathom pagination incomplete');
}

/** Verified legacy bridge contract: discover tab 01; never guess a Summary tab. */
export async function churnValues():Promise<string[][]>{
 const sheet='1p8CAd5pL9zKjc1mZ73Gc_hoj4NSWHfFPs4FoC_WuBUU';
 const metadata=unwrap(await callTool('pd_google_sheets_proxy_get',{url:`https://sheets.googleapis.com/v4/spreadsheets/${sheet}?fields=sheets(properties(title,sheetId))`}));
 if(!Array.isArray(metadata.sheets))throw new Error('Churn tracker metadata missing');
 const matching=metadata.sheets.filter((s:Row)=>String(s.properties?.title??'').startsWith('01'));
 if(matching.length!==1)throw new Error('Churn tracker tab 01 is missing or ambiguous');
 const range=`'${String(matching[0].properties.title).replace(/'/g,"''")}'!A1:K20`;
 const grid=unwrap(await callTool('pd_google_sheets_proxy_get',{url:`https://sheets.googleapis.com/v4/spreadsheets/${sheet}/values/${encodeURIComponent(range)}`}));
 if(!Array.isArray(grid.values))throw new Error('Churn tracker range missing');
 return grid.values;
}

/** Client-call calendars, ported from ghlCalendar.ts and the finite CSM bridge. */
export async function staffAppointments(clientNames:string[],today:string){
 const location='wwG426bwruWWv9W3fazQ',base='https://services.leadconnectorhq.com';
 const calendars=unwrap(await callTool('native_csm_ghl_get',{url:`${base}/calendars/?locationId=${location}`,version:'2021-04-15'}));
 if(!Array.isArray(calendars.calendars))throw new Error('CSM calendar collection missing');
 const midnight=Date.parse(`${today}T00:00:00+03:00`),from=midnight-14*86400000,to=midnight+42*86400000;
 const events=new Map<string,Row>();
 for(const calendar of calendars.calendars){
  if(typeof calendar.id!=='string'||!calendar.id.trim()||typeof calendar.name!=='string'||!calendar.name.trim())throw new Error('CSM calendar identity or name missing');
  for(let offset=-14;offset<42;offset+=7){
   const params=new URLSearchParams({locationId:location,calendarId:String(calendar.id),startTime:String(midnight+offset*86400000),endTime:String(midnight+(offset+7)*86400000)});
   const result=unwrap(await callTool('native_csm_ghl_get',{url:`${base}/calendars/events?${params}`,version:'2021-04-15'}));
   if(!Array.isArray(result.events))throw new Error('CSM calendar window missing');
   for(const event of result.events){
    if(typeof event.id!=='string'||!event.id.trim()||typeof event.startTime!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(event.startTime)||!Number.isFinite(Date.parse(event.startTime)))throw new Error('CSM appointment identity or date missing');
    if(!/cancel/i.test(String(event.appointmentStatus??event.status??''))&&(typeof event.endTime!=='string'||!/(Z|[+-]\d{2}:\d{2})$/.test(event.endTime)||!Number.isFinite(Date.parse(event.endTime))||Date.parse(event.endTime)<=Date.parse(event.startTime)))throw new Error('CSM appointment end time is missing or invalid');
    const next={...event,calendar:calendar.name,calendarId:calendar.id};const previous=events.get(event.id);
    if(previous&&JSON.stringify(previous)!==JSON.stringify(next))throw new Error('CSM appointment identity changed across calendar windows');
    events.set(event.id,next);
   }
  }
 }
 const contacts=new Map<string,Row>();
 for(const event of events.values()){
  if(!event.contactId||contacts.has(String(event.contactId)))continue;
  const result=unwrap(await callTool('native_csm_ghl_get',{url:`${base}/contacts/${encodeURIComponent(event.contactId)}`,version:'2021-07-28'}));
  if(!result.contact?.id)throw new Error('CSM appointment contact missing');
  const contact=result.contact;contacts.set(String(contact.id),{name:String(contact.contactName??`${contact.firstName??''} ${contact.lastName??''}`).trim(),companyName:contact.companyName});
 }
 const callKinds:Record<string,string[]>={blueprint:['brand blueprint'],launch:['launch'],onboarding:['onboarding'],checkin:['check in','check-in','checkin','sucess','success']};
 const norm=(name:string)=>name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');
 const rows:Row[]=[];
 for(const event of events.values()){
  const start=Date.parse(event.startTime);if(start<from||start>=to)continue;
  const contact=contacts.get(String(event.contactId)),blob=[event.title??'',contact?.companyName??'',contact?.name??'',event.notes??''].map(norm).join(' ');
  const hits=clientNames.filter(name=>norm(name).length>=4&&blob.includes(norm(name))).sort((a,b)=>norm(b).length-norm(a).length);
  const clientName=hits.length===1||(hits.length>1&&norm(hits[0]).length>norm(hits[1]).length)?hits[0]:undefined;
  const kind=Object.entries(callKinds).find(([,needles])=>needles.some(needle=>event.calendar.toLowerCase().includes(needle)))?.[0]??'other';
  rows.push({apptId:String(event.id),calendar:event.calendar,calendarId:event.calendarId,title:event.title??event.calendar,kind,startTime:event.startTime,endTime:event.endTime,day:new Date(start+10800000).toISOString().slice(0,10),status:event.appointmentStatus??event.status??'',contactName:contact?.name,clientName,joinUrl:event.address,notes:typeof event.notes==='string'?event.notes:undefined});
 }
 rows.sort((a,b)=>a.startTime.localeCompare(b.startTime));
 return {rows,from,to,checkedAt:Date.now(),calendars:calendars.calendars.map((calendar:Row)=>({id:calendar.id,name:calendar.name}))};
}
