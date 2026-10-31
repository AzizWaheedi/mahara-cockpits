import {type Row, callTool, providerFetch, unwrap, supabaseQuery} from './runtime';
import {appointmentRows,summarise,staleRows,byAd,toDate,MONTHS,parseAdded,parseAppt,daysBetween,type Day,type Call,type GhlAccount} from './csmProfileCalculations';
import type {Extension,CallNote} from './csmCadence';

// The 1-1 form's client: the card id the client page's link carries (hidden task_id), else the typed Client ID.
// Given the client cards, the same order as the csm-calls worker's checkinClient: a hidden id that is not a
// card gives way to the typed one. Without them there is no roster check, so any non-blank hidden id wins.
export function checkinTaskId(item:Row,cards?:ReadonlySet<string>){
 const hidden=String(item?.hidden?.task_id??'').trim();
 const typed=String((item?.answers??[]).find((a:Row)=>a.field?.ref==='c484f390-9695-4ffa-9693-9cc219592713')?.text??'').trim();
 return hidden&&(!cards||cards.has(hidden)||!typed)?hidden:typed;
}

// The 1-1 notes, read by ref. Typeform's own items and the store's rows (cockpit_csm_call_forms, written by
// hermes/csm-calls with formAnswers, and the cockpit's native write-through, 20261027h_checkin_plans.sql) carry
// the same refs, so one rule reads both (docs/forms/STAGE2B-CONTRACT.md 4.4, release N4).
export const NOTE_REF={additional:'82a6b434-15d9-4a14-8496-c20c94628536',clientNotes:'5d071906-da6a-4413-a729-0c76d0188d91',defcon:'ff7970f7-9fad-4fa5-b12b-4d719dfb7587',priority:'c9f99fb1-fec9-47e7-9baa-c5554733723d'} as const;
export const NATIVE_FORM_ID='cockpit-checkin';
const KUWAIT_MS=10800000;
const kuwaitDay=(ms:number)=>new Date(ms+KUWAIT_MS).toISOString().slice(0,10);

/** A Typeform answer as one value, as hermes/csm-calls stores it (match.ts answerValue): text, choice label, url... */
function typeformValue(a:Row):unknown{
 switch(a?.type){
  case 'text':return a.text;
  case 'choice':return a.choice?.label??a.choice?.other;
  case 'choices':return [...(a.choices?.labels??[]),...(a.choices?.other?[a.choices.other]:[])];
  default:return a?.[a?.type]??a?.text??null;
 }
}
/** ref -> value of a Typeform API item. */
export function typeformAnswers(item:Row):Map<string,unknown>{
 const out=new Map<string,unknown>();
 for(const a of Array.isArray(item?.answers)?item.answers:[]){const ref=a?.field?.ref;if(typeof ref==='string'&&!out.has(ref))out.set(ref,typeformValue(a));}
 return out;
}
/** ref -> value of a stored row's answers ([{ref, type, title, value}]). */
export function storedAnswers(answers:unknown):Map<string,unknown>{
 const out=new Map<string,unknown>();
 for(const a of Array.isArray(answers)?answers as Row[]:[]){const ref=a?.ref;if(typeof ref==='string'&&!out.has(ref))out.set(ref,a.value);}
 return out;
}
const text=(v:unknown)=>typeof v==='string'?v:undefined;

/**
 * The commitments a note shows. A Typeform note keeps today's rule: up to 4 lines of 20 or more characters from
 * Additional Notes and Client Notes, split at new lines, bullets and " - ", status words left out. A native note
 * (the cockpit's write-through) shows its We owe items: the "Mahara: " lines of Additional Notes, label removed,
 * each whole, at most 4 (Z49).
 */
export function commitmentsOf(answers:Map<string,unknown>,native=false):string[]{
 if(native){
  const lines=String(text(answers.get(NOTE_REF.additional))??'').split('\n').map(s=>s.trim()).filter(s=>s.startsWith('Mahara: ')).map(s=>s.slice('Mahara: '.length).trim()).filter(Boolean);
  return [...new Set(lines)].slice(0,4);
 }
 const status=/^(done|sent|ok|okay|n\/a|na|none|nothing|fine|good|no|yes|waiting|pending|follow up|followup|noted)\b/i;
 return [...new Set([text(answers.get(NOTE_REF.additional)),text(answers.get(NOTE_REF.clientNotes))].filter(Boolean).flatMap(t=>String(t).split(/\n|\u2022|(?: - )/).map(s=>s.replace(/^[-*\d.\s]+/,'').trim()).filter(s=>s.length>=20&&!status.test(s))))].slice(0,4);
}
/** One note, whichever read it came from. */
export function noteOf(taskId:string,submittedAt:number,answers:Map<string,unknown>,native=false):CallNote{
 return {taskId,submitted:kuwaitDay(submittedAt),notes:commitmentsOf(answers,native),defcon:text(answers.get(NOTE_REF.defcon)),priority:text(answers.get(NOTE_REF.priority))};
}

/** A Postgres or ISO time ("2026-10-27 15:40:20+03", "2026-10-27T12:40:20.5+00:00") in epoch ms, else NaN. */
export function stampMs(v:unknown):number{
 const m=/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(String(v??'').trim());
 if(!m)return NaN;
 const zone=m[3]==='Z'?'Z':m[3].length===3?`${m[3]}:00`:m[3].includes(':')?m[3]:`${m[3].slice(0,3)}:${m[3].slice(3)}`;
 return Date.parse(`${m[1]}T${m[2]}${zone}`);
}

// The three reads of the store, each one select with no limit word: the native transport treats any "limit N" as
// a coverage cap (transport.ts), and a cap here would hide a client's newest note.
export const STORE_SQL={
 newest:"select distinct on (f.task_id) f.task_id, f.token, f.form_id, f.matched_by, f.submitted_at, f.answers from public.cockpit_csm_call_forms f where f.form_kind = 'checkin' and f.task_id is not null order by f.task_id, f.submitted_at desc",
 marks:"select f.token, f.task_id, f.form_kind, f.matched_by from public.cockpit_csm_call_forms f where f.form_id = 'fRokTITH' and (f.matched_by = 'manual' or f.form_kind = 'checkin_late')",
 registry:"select provider from public.cockpit_forms where key = 'checkin'",
} as const;

export type StoredNote=CallNote&{token:string;formId:string;matchedBy:string;submittedAt:number};
export type TypeformNote=CallNote&{token:string;submittedAt:number};
export type NoteMark={token:string;taskId:string|null;formKind:string;matchedBy:string};
export type ParityField='lastNoteOn'|'defcon'|'priority'|'notes';
export type NoteParity={state:'same'|'explained'|'differs'|'none'|'off';why?:'fresh'|'manual'|'native'|'late';fields?:ParityField[]};
export type NotesParity={native:boolean;byTask:Record<string,NoteParity>};

/** The store's newest 1-1 note per card, the fRokTITH rows a person placed or the cut-over made late, and the registry. */
export async function storeNotes():Promise<{newest:StoredNote[];marks:NoteMark[];provider:string}>{
 const registry=await supabaseQuery(STORE_SQL.registry);
 if(registry.length!==1||typeof registry[0]?.provider!=='string')throw new Error('The 1-1 notes registry row (cockpit_forms checkin) is missing');
 const rows=await supabaseQuery(STORE_SQL.newest);
 const newest:StoredNote[]=rows.map(r=>{
  const taskId=String(r?.task_id??'').trim(),token=String(r?.token??'').trim(),at=stampMs(r?.submitted_at);
  if(!taskId||!token||!Number.isFinite(at)||!Array.isArray(r?.answers))throw new Error('A stored 1-1 note lacks its card, token, time or answers');
  const formId=String(r.form_id??''),native=formId===NATIVE_FORM_ID;
  return {...noteOf(taskId,at,storedAnswers(r.answers),native),token,formId,matchedBy:String(r.matched_by??''),submittedAt:at};
 });
 const marks:NoteMark[]=(await supabaseQuery(STORE_SQL.marks)).map(r=>{
  const token=String(r?.token??'').trim();if(!token)throw new Error('A stored 1-1 note mark lacks its token');
  return {token,taskId:r?.task_id?String(r.task_id):null,formKind:String(r?.form_kind??''),matchedBy:String(r?.matched_by??'')};
 });
 return {newest,marks,provider:registry[0].provider};
}

const FRESH_MS=30*60000;
const sameList=(a:string[],b:string[])=>a.length===b.length&&a.every((x,i)=>x===b[i]);
function differing(a?:CallNote,b?:CallNote):ParityField[]{
 const out:ParityField[]=[];
 if(a?.submitted!==b?.submitted)out.push('lastNoteOn');
 if(a?.defcon!==b?.defcon)out.push('defcon');
 if(a?.priority!==b?.priority)out.push('priority');
 if(!sameList(a?.notes??[],b?.notes??[]))out.push('notes');
 return out;
}

/**
 * Store against Typeform, per card, while Typeform is still the record (Z18). Equal tokens and fields: same. When the
 * newer side is the store's, a hand match (manual) or a native note explains it; when it is Typeform's, a form the
 * cut-over made late, one a person placed on another card (manual), or one under 30 minutes old that the 15-minute
 * read has not stored yet (fresh) explains it. Anything else differs, with the fields that differ.
 */
export function notesParity(store:StoredNote[],typeform:TypeformNote[],marks:NoteMark[],now:number):Record<string,NoteParity>{
 const s=new Map(store.map(n=>[n.taskId,n])),t=new Map<string,TypeformNote>();
 for(const n of typeform){const seen=t.get(n.taskId);if(!seen||n.submittedAt>seen.submittedAt)t.set(n.taskId,n);}
 const mark=new Map(marks.map(m=>[m.token,m]));
 const out:Record<string,NoteParity>={};
 for(const task of new Set([...s.keys(),...t.keys()])){
  const a=s.get(task),b=t.get(task);
  if(a&&b&&a.token===b.token){const fields=differing(a,b);out[task]=fields.length?{state:'differs',fields}:{state:'same'};continue;}
  const fields=differing(a,b);
  if(a&&(!b||a.submittedAt>b.submittedAt)){
   if(a.formId===NATIVE_FORM_ID){out[task]={state:'explained',why:'native'};continue;}
   if(a.matchedBy==='manual'){out[task]={state:'explained',why:'manual'};continue;}
  }else if(b&&(!a||b.submittedAt>a.submittedAt)){
   const m=mark.get(b.token);
   if(m?.formKind==='checkin_late'){out[task]={state:'explained',why:'late'};continue;}
   if(m?.matchedBy==='manual'){out[task]={state:'explained',why:'manual'};continue;}
   if(now-b.submittedAt<FRESH_MS){out[task]={state:'explained',why:'fresh'};continue;}
  }
  out[task]={state:'differs',fields};
 }
 return out;
}

// Provider contracts from media-buyer/convex/csmSync.ts and csmProfiles.ts.
// Any failed authoritative read aborts the plan, rather than substituting zero.
// Release N4 (docs/forms/STAGE2B-CONTRACT.md 4.4): the 1-1 notes come from the store; while the registry says
// Typeform still fills them, fRokTITH is read beside them as a comparator, and a failed read still aborts the plan.
export async function cadenceInputs(cards?:ReadonlySet<string>,now=Date.now()):Promise<{notes:CallNote[];exts:Extension[];parity:NotesParity}>{
 const exts:Extension[]=[],typeform:TypeformNote[]=[];
 const store=await storeNotes(),native=store.provider==='native';
 const weeksByLabel:Record<string,number>={'1 WEEK':1,'2 WEEKS':2,'4 WEEKS':4};
 for(const form of native?['gqBcyK6g']:['fRokTITH','gqBcyK6g']){
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
    const taskId=checkinTaskId(item,cards);if(!taskId)continue;
    typeform.push({...noteOf(taskId,granted,typeformAnswers(item)),token:String(item.token??''),submittedAt:granted});
   }
  }
 }
 const notes:CallNote[]=store.newest.map(({taskId,submitted,notes,defcon,priority})=>({taskId,submitted,notes,defcon,priority}));
 return {notes,exts,parity:{native,byTask:native?{}:notesParity(store.newest,typeform,store.marks,now)}};
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
  // Quotation N is kept (2026-10-16): the Client Performance board needs Y and
  // N to tell "no quotation" from "not answered". quoteKeepsN tells the board's
  // facts that this copy keeps N, so a copy from before still reads as Y only.
  quoteKeepsN:true,
  appointments:rows.filter(r=>r.added).map(r=>({added:r.added,appAt:r.appAt,booked:Boolean(r.appDate),show:/^y/i.test(r.show)?'y':/^n/i.test(r.show)?'n':'',quote:/^y/i.test(r.quote)?'y':/^n/i.test(r.quote)?'n':'',closed:/^y/i.test(r.closed)?'y':'',ad:r.ad||r.source||''})),
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
export async function fathomCalls(sinceArg?: string): Promise<Call[]> {
  let since = sinceArg;
  if (since !== undefined) {
    const parsed = Date.parse(since);
    if (!Number.isFinite(parsed)) throw new Error('Invalid Fathom since timestamp');
  } else {
    since = new Date(Date.now() - 90 * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  const out: Call[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 100; page++) {
    const params = new URLSearchParams({ created_after: since, include_summary: 'true' });
    if (cursor) params.set('cursor', cursor);
    const body = unwrap(await callTool('native_fathom_get', { url: `https://api.fathom.ai/external/v1/meetings?${params}` }));
    if (!Array.isArray(body.items)) throw new Error('Fathom meeting collection missing');
    for (const m of body.items) {
      out.push({
        title: String(m.title ?? ''),
        at: String(m.scheduled_start_time ?? m.created_at ?? ''),
        host: m.recorded_by?.name,
        external: (m.calendar_invitees ?? []).filter((i: Row) => i.is_external).map((i: Row) => String(i.name ?? i.email ?? '')),
        url: m.url ?? m.share_url,
        summary: String(m.default_summary?.markdown_formatted ?? '').slice(0, 1500) || undefined,
      });
    }
    if (!body.next_cursor) return out;
    if (body.next_cursor === cursor) throw new Error('Fathom pagination did not advance');
    cursor = body.next_cursor;
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
