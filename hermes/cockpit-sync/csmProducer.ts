import {type Row, unwrap, allAdAccounts, callTool, assertNativeFence} from './runtime';
import {buildSnapshot, CLIENTS_LIST, CS_LIST} from './csmCadence';
import {adLeadsByClient, adLeadsFor, adsForClient, adsAccess, liveCounts, metaAccountFor, normTight, gapsFor, callsFor, mergeCalls, pool, PROFILE_CF, cfById, drop, isoDate, cleanDosDonts} from './csmProfileCalculations';
import {payingState, stateOf, rosterDiff, ROSTER_KINDS, rosterEventId} from './csmRoster';
import {cadenceInputs, sheetPerformance, lostLeads, provisionalFor, fathomCalls, churnValues, staffAppointments} from './csmProviders';
import {stableId} from './capture';

export interface ClientDataRow {
  clientName: string;
  clickupId: string;
  serviceMode?: string;
  service?: string;
  ghlLocationId?: string;
  ghlToken: string;
  waGroupId: string;
  sheetLink?: string;
  driveLink?: string;
  adAccountMeta?: string;
  status: string;
  country?: string;
  city?: string;
  [key: string]: unknown;
}

const DATABASE = '1_0Nv-IFvzhH4NBNh1dxCUm6Ryp414ctM_8EO5QORBF0';

export function parseClientData(values: string[][]): { rows: ClientDataRow[]; omissions: string[] } {
  if (!values || values.length === 0) {
    throw new Error('Missing client data header row');
  }
  const head = values[0].map(h => String(h ?? '').trim());
  const col = (name: string) => head.findIndex(h => h.toLowerCase() === name.toLowerCase());

  const nameCol = col('Client Name');
  const clickupCol = col('Clickup ID');

  if (nameCol < 0 || clickupCol < 0) {
    throw new Error(`Client data header must include 'Client Name' and 'Clickup ID' (headers: ${head.join(', ')})`);
  }

  const EXPECTED = [
    'Client Name',
    'Clickup ID',
    'Service Mode',
    'GHL ID',
    'GHL API',
    'WA GROUP ID',
    'Sheet Link',
    'Google Drive Link',
    'Ad Account - Meta',
    'Status',
    'Country',
    'City',
  ];
  const omissions = EXPECTED.filter(e => !head.some(h => h.toLowerCase() === e.toLowerCase()));

  const serviceModeCol = col('Service Mode') >= 0 ? col('Service Mode') : col('Service');
  const ghlIdCol = col('GHL ID');
  const ghlApiCol = col('GHL API');
  const waCol = col('WA GROUP ID');
  const sheetCol = col('Sheet Link');
  const driveCol = col('Google Drive Link');
  const metaCol = col('Ad Account - Meta');
  const statusCol = col('Status');
  const countryCol = col('Country');
  const cityCol = col('City');

  const rows: ClientDataRow[] = [];
  for (const r of values.slice(1)) {
    const clientName = String(r[nameCol] ?? '').trim();
    if (!clientName) continue;
    const clickupId = String(r[clickupCol] ?? '').trim();
    const serviceMode = serviceModeCol >= 0 ? String(r[serviceModeCol] ?? '').trim() || undefined : undefined;
    rows.push({
      clientName,
      clickupId,
      serviceMode,
      service: serviceMode,
      ghlLocationId: ghlIdCol >= 0 ? String(r[ghlIdCol] ?? '').trim() : undefined,
      ghlToken: ghlApiCol >= 0 ? String(r[ghlApiCol] ?? '').trim() : '',
      waGroupId: waCol >= 0 ? String(r[waCol] ?? '').trim() : '',
      sheetLink: sheetCol >= 0 ? String(r[sheetCol] ?? '').trim() || undefined : undefined,
      driveLink: driveCol >= 0 ? String(r[driveCol] ?? '').trim() || undefined : undefined,
      adAccountMeta: metaCol >= 0 ? String(r[metaCol] ?? '').trim() || undefined : undefined,
      status: statusCol >= 0 ? String(r[statusCol] ?? '').trim() : 'Active',
      country: countryCol >= 0 ? String(r[countryCol] ?? '').trim() || undefined : undefined,
      city: cityCol >= 0 ? String(r[cityCol] ?? '').trim() || undefined : undefined,
    });
  }

  return { rows, omissions };
}

export function parseKpi(rows: string[][], today: string, now: number): Row[] {
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const month=today.slice(0,7),name=months[Number(today.slice(5,7))-1];
  const matching=rows.filter(row=>String(row[0]??'').trim()===name);
  if(matching.length>1)throw new Error('Churn tracker month is ambiguous');
  const row=matching[0]??[],start=String(row[1]??'').trim(),lost=String(row[2]??'').trim();
  const source=`Churn Tracker sheet, tab 01, ${name} row`;
  const note=start&&lost
    ? 'Churn = clients lost this month divided by clients at the start of the month; the sheet is a cross-check against the recorded roster.'
    : `Not published: the ${name} row is missing ${[!lost?'clients lost':'',!start?'clients at start of month':''].filter(Boolean).join(' and ')}. An empty formula result is not zero churn.`;
  const proposed=[
    {key:'churn',label:'Churn this month',value:start&&lost?String(row[4]??'').trim():'',note},
    {key:'clients_at_start',label:'Clients at start of month',value:start},
    {key:'clients_lost',label:'Clients lost this month',value:lost},
  ];
  const result:Row[]=proposed.filter(r=>r.value!=='').map(r=>{
    const cleaned=r.value.replace(/[^0-9.\-]/g,''),numeric=cleaned!==''?Number(cleaned):NaN;
    return {...r,numeric:Number.isFinite(numeric)?numeric:undefined,month,source,at:now};
  });
  if(!result.some(r=>r.key==='churn'))result.push({key:'churn_missing',label:'Churn not published',value:'unfilled',month,source,note,at:now});
  return result;
}

export function mergeDailyStats(existing: Row[], incoming: Row[]): Row[] {
  const map = new Map<string, Row>();
  const key = (r: Row) => JSON.stringify([r.campaignName,r.date,r.metaAdId??r.adName??'',r.adSetName??'']);
  for (const r of existing) {
    map.set(key(r), r);
  }
  for (const r of incoming) {
    map.set(key(r), r);
  }
  return [...map.values()];
}

export function reconcileRoster(
  tasks: Row[],
  rosterDays: Row[],
  churnEvents: Row[],
  today: string,
  now: number,
): { rosterDays: Row[]; churnEvents: Row[] } {
  const rows = tasks.map(c => ({
    key: String(c.taskId ?? c.id ?? c.key ?? c.name),
    name: String(c.name ?? 'unnamed'),
    status: String(c.stage ?? c.status ?? ''),
    paying: payingState(String(c.stage ?? c.status ?? '')),
  }));

  const month = today.slice(0, 7);
  const prior = [...rosterDays]
    .filter(r => r.day < today)
    .sort((a, b) => b.day.localeCompare(a.day))[0];

  const todayDoc = {
    _id: rosterDays.find(r => r.day === today)?._id ?? stableId('rosterDays', [today]),
    day: today,
    month,
    clients: rows,
    paying: rows.filter(r => r.paying).length,
    total: rows.length,
    at: now,
  };

  const otherDays = rosterDays.filter(r => r.day !== today);
  const updatedRosterDays = [...otherDays, todayDoc].sort((a, b) => a.day.localeCompare(b.day));

  if (!prior) {
    return { rosterDays: updatedRosterDays, churnEvents };
  }

  const want = rosterDiff(prior.clients, rows);

  // Preserve human-entered churn events and non-today derived events
  const preservedEvents = churnEvents.filter(e => e.day !== today || !Object.hasOwn(ROSTER_KINDS,e.kind));
  const existing = new Map(churnEvents.filter(e => e.day === today && Object.hasOwn(ROSTER_KINDS,e.kind)).map(e => [rosterEventId({key:e.key,from:e.from,to:e.to,kind:e.kind}), e]));
  const newDerivedEvents = want.map(w => existing.get(rosterEventId(w)) ?? ({
    _id: stableId('churnEvents', [today, rosterEventId(w)]),
    day: today, month, ...w, at: now,
  }));

  return {
    rosterDays: updatedRosterDays,
    churnEvents: [...preservedEvents, ...newDerivedEvents],
  };
}

export function fathomCheckpoint(at: number): Row {
  if (typeof at !== 'number' || !Number.isFinite(at)) {
    throw new Error('fathomCheckpoint requires a finite epoch millisecond timestamp');
  }
  return {
    _id: stableId('syncRuns', ['csm', 'native_fathom', at]),
    kind: 'native_fathom',
    ok: true,
    at,
  };
}

export function fathomSince(syncRuns: Row[], now: number, optionalSeed?: string): string {
  let newestAt: number | undefined;

  for (const run of syncRuns) {
    if (run.kind === 'native_fathom' || run.kind === 'health') {
      if (run.ok === true) {
        const at = run.at;
        if (typeof at !== 'number' || !Number.isFinite(at) || at > now) {
          throw new Error('Invalid candidate checkpoint: timestamp must be a finite epoch milliseconds not in future');
        }
        if (newestAt === undefined || at > newestAt) {
          newestAt = at;
        }
      }
    }
  }

  if (newestAt !== undefined) {
    return new Date(newestAt - 24 * 60 * 60 * 1000).toISOString();
  }

  if (optionalSeed !== undefined) {
    if (typeof optionalSeed === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(optionalSeed)) {
      const parsed = Date.parse(optionalSeed);
      if (Number.isFinite(parsed) && parsed <= now) {
        return optionalSeed;
      }
    }
    throw new Error('Verified checkpoint required: provided seed is invalid');
  }

  throw new Error('Verified checkpoint required: no successful native_fathom or health record found and no valid seed provided');
}

export async function collectCsm(state: Row, tables: Record<string, Row[]>, seed?: string): Promise<{ tables: Record<string, Row[]>; calendarWindow: { from: number; to: number; checkedAt: number; calendars: { id: string; name: string }[]; eventIds: string[] } }> {
  await assertNativeFence();
  for (const key of ['clients','csTasks','kpi','appointments','rosterDays','churnEvents','syncRuns','clientProfiles','decisions','reportDocs','outbox'])
    if (!Array.isArray(state.csm?.[key])) throw new Error(`CSM ${key} source is not initialized`);
  const now = Date.now(), today = new Date(now + 10800000).toISOString().slice(0, 10);
  const checkpoints=unwrap(await callTool('native_fathom_checkpoint_get',{}));
  if(!Array.isArray(checkpoints)||checkpoints.length>1)throw new Error('Native Fathom publication checkpoint is unverified');
  const published=checkpoints.length?[fathomCheckpoint(Date.parse(checkpoints[0]?.started_at))]:[];
  const sinceTimestamp = fathomSince([...state.csm.syncRuns,...published], now, seed);
  const day = {y:Number(today.slice(0,4)),m:Number(today.slice(5,7)),d:Number(today.slice(8,10))};
  const taskRows = async (list: string): Promise<Row[]> => {
    const result = unwrap(await callTool('pd_clickup_proxy_get', {url:`https://api.clickup.com/api/v2/list/${list}/task?include_closed=${list===CLIENTS_LIST}`}));
    if (!Array.isArray(result.tasks)) throw new Error('CSM ClickUp collection missing');
    return result.tasks;
  };
  const clientTasks = await taskRows(CLIENTS_LIST), csTasks = await taskRows(CS_LIST);
  const sheet = unwrap(await callTool('pd_google_sheets_proxy_get', {url:`https://sheets.googleapis.com/v4/spreadsheets/${DATABASE}/values/${encodeURIComponent("'Client Data'!A1:Z200")}`}));
  if (!Array.isArray(sheet.values) || sheet.values.length >= 200) throw new Error('Client Data is missing or truncated');
  const parsed = parseClientData(sheet.values);
  // Missing credentials/identity columns cannot be converted to empty account collections.
  if (parsed.omissions.length) throw new Error(`Client Data columns missing: ${parsed.omissions.join(', ')}`);
  const {notes,exts} = await cadenceInputs();
  const fieldResponse = unwrap(await callTool('pd_clickup_proxy_get',{url:`https://api.clickup.com/api/v2/list/${CLIENTS_LIST}/field`}));
  if (!Array.isArray(fieldResponse.fields)) throw new Error('Client custom-field collection missing');
  const reportFieldId = fieldResponse.fields.find((f:Row)=>String(f.name).toLowerCase()==='last report sent')?.id;
  const renewalFieldId = fieldResponse.fields.find((f:Row)=>String(f.name).toLowerCase()==='contract end date')?.id;
  const snapshot = buildSnapshot({today,now,exts,notes,reportFieldId,renewalFieldId,clientTasks,csTasks,liveWatch:tables.launchWatch,campaigns:tables.campaigns,changeLog:state.mediaDecisions});
  for (const c of snapshot.clients) {
    const row = parsed.rows.find(r => r.clickupId === c.taskId) ?? parsed.rows.find(r => normTight(r.clientName) === normTight(c.name));
    if (row?.serviceMode) { c.service = /dwy|done with/i.test(row.serviceMode) ? 'DWY' : row.serviceMode; c.dwy = /dwy|done with/i.test(row.serviceMode); }
    if (!c.sheetLink && row?.sheetLink) c.sheetLink = row.sheetLink;
  }
  const roster = reconcileRoster(snapshot.clients,state.csm.rosterDays,state.csm.churnEvents,today,now);
  const pausedSince = new Map<string,string>();
  for (const e of [...roster.churnEvents].sort((a,b)=>a.day===b.day?a.at-b.at:a.day.localeCompare(b.day))) {
    if (e.kind==='paused'||e.kind==='paused_by_csm') { if(!pausedSince.has(e.key))pausedSince.set(e.key,e.day); }
    else if (['regained','lost','new','removed','offboarded'].includes(e.kind)) pausedSince.delete(e.key);
  }
  for (const c of snapshot.clients) {
    const since=stateOf(String(c.stage??''))==='paused'?pausedSince.get(String(c.taskId??c.name)):undefined;
    c.pausedSince=since;c.pausedDays=since?Math.round((Date.parse(today)-Date.parse(since))/86400000):undefined;
  }
  const history = mergeDailyStats(state.dailyStats,tables.dailyStats);
  const adLeads = Object.fromEntries(adLeadsByClient(tables.campaigns,history,now).map(r=>[r.key,r]));
  const visibleAccounts = (await allAdAccounts()).map(a=>({name:String(a.name??''),id:String(a.account_id??'')}));
  const calls = await fathomCalls(sinceTimestamp);
  const clientProfiles = await pool(snapshot.clients,4,async c => {
    const data = parsed.rows.find(r=>r.clickupId===c.taskId) ?? parsed.rows.find(r=>normTight(r.clientName)===normTight(c.name));
    const task = clientTasks.find(t=>t.id===c.taskId), fields = cfById(task ?? {});
    const sheetLink = c.sheetLink || data?.sheetLink, driveLink = fields[PROFILE_CF.drive]?.value ?? fields[PROFILE_CF.driveFolder]?.value ?? data?.driveLink;
    const ads = adsForClient(c.name,tables.campaigns,tables.metaTree);
    const meta = metaAccountFor(c.name,data,ads.find(a=>a.accountId)?.accountId,visibleAccounts);
    const acct = data?.ghlLocationId && data.ghlToken ? {name:data.clientName,locationId:data.ghlLocationId,token:data.ghlToken,clickupId:data.clickupId} : undefined;
    const perf = await sheetPerformance(sheetLink,day);
    const lost = acct ? await lostLeads(acct) : undefined;
    const provisional = acct ? await provisionalFor(acct) : undefined;
    const old = state.csm.clientProfiles.find((p:Row)=>p.taskId===c.taskId || p.clientName===c.name);
    const clientCalls = mergeCalls(callsFor(c.name,calls),old?.calls ?? [],c.name);
    const matchingBriefs = (state.callBriefs ?? [])
      .filter((b:Row) => b.clientName === c.name && b.status === 'done')
      .sort((a:Row,b:Row) => Number(b.at ?? 0) - Number(a.at ?? 0));
    const callBrief = matchingBriefs[0];
    const callsBrief = callBrief?.overall ?? old?.callsBrief;
    const briefByUrl = new Map<string, string>();
    if (Array.isArray(old?.calls)) {
      for (const oldCall of old.calls) {
        if (oldCall?.url && oldCall?.brief && !briefByUrl.has(String(oldCall.url))) {
          briefByUrl.set(String(oldCall.url), String(oldCall.brief));
        }
      }
    }
    for (const b of matchingBriefs) {
      if (Array.isArray(b?.perCall)) {
        for (const item of b.perCall) {
          if (item?.url && item?.brief && !briefByUrl.has(String(item.url))) {
            briefByUrl.set(String(item.url), String(item.brief));
          }
        }
      }
    }
    for (const call of clientCalls) {
      if (!call.brief && call.url && briefByUrl.has(String(call.url))) {
        call.brief = briefByUrl.get(String(call.url));
      }
    }
    const profile = {
      clientName:c.name,taskId:c.taskId,service:c.service,stage:c.stage,happiness:c.happiness,
      launchDate:isoDate(fields[PROFILE_CF.launch]),adsPlatform:drop(fields[PROFILE_CF.platform]),
      profileText:fields[PROFILE_CF.profile]?.value,dosDonts:cleanDosDonts(String(fields[PROFILE_CF.dosDonts]?.value??'')).text,
      links:{clickup:c.taskUrl,sheet:sheetLink,drive:driveLink,ghl:acct?`https://app.maharamedia.com/v2/location/${acct.locationId}/dashboard`:undefined,adAccount:meta?`https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${meta.id}`:undefined,contract:fields[PROFILE_CF.contract]?.value},
      performance:perf,ads,live:liveCounts(ads),adsAccess:adsAccess(ads),lost,provisional,
      adLeads:adLeadsFor(c.name,adLeads),calls:clientCalls,callsBrief,
      updates:state.media.clientComments.filter((r:Row)=>r.taskId===c.taskId),
      gaps:gapsFor({client:{...c,sheetLink,driveLink},row:data,perf,acct,lost,accountId:meta?.visible?meta.id:undefined,onBoard:tables.campaigns.some(k=>normTight(k.clientName)===normTight(c.name)),visibleAccounts,calls:clientCalls.length,clientDataOk:true}),
      syncedAt:now,
    };
    return profile;
  });
  const [kpiRows,calendar]=await Promise.all([churnValues(),staffAppointments(snapshot.clients.map(c=>String(c.name)),today)]);
  const appointments=new Map<string,Row>();
  for(const old of state.csm.appointments){
    const start=Date.parse(old.startTime);
    if(!Number.isFinite(start)||start<calendar.from||start>=calendar.to)appointments.set(old.apptId,old);
  }
  for(const row of calendar.rows)appointments.set(row.apptId,row);

  // Reports, decisions and delivery history have no replay route and retain their source stamps.
  return { tables: {...state.csm,clients:snapshot.clients,csTasks:snapshot.tasks,checks:snapshot.checks.map((c:Row)=>({...c,role:'csm',day:today})),rosterDays:roster.rosterDays,churnEvents:roster.churnEvents,clientProfiles,kpi:parseKpi(kpiRows,today,now),appointments:[...appointments.values()].sort((a,b)=>String(a.startTime??'').localeCompare(String(b.startTime??'')))}, calendarWindow: {from:calendar.from,to:calendar.to,checkedAt:calendar.checkedAt,calendars:calendar.calendars,eventIds:calendar.rows.map(row=>String(row.apptId))} };
}
