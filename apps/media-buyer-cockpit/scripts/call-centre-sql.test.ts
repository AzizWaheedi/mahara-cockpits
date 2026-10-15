/**
 * public.cockpit_client_calls and the recording gate (migration
 * 20261013180000) on an isolated PostgreSQL with the dialer's own link rule.
 *
 * The dialer's helpers and views below are copied from mahara-power-dialer
 * database/call-center-scorecard.sql (the live definitions matched on
 * 2026-10-13); cc_appointments is cut down to the columns the function reads,
 * and the dialer's report is a stub, so the test pins that the headline is the
 * report's row as it is. Every lead, call and attempt is invented. cc_phone's
 * Arabic digits are written as U& escapes: Bun rewrites non-ASCII characters
 * inside String.raw as \u escapes, which PostgreSQL would read as text.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import {
  FIRST_CALL_MINUTES,
  REACHED_GATE,
} from "../../client-success-cockpit/src/lib/kpi";
import { callCentreVerdict, parseCallCentre } from "../src/lib/callCentre";
import {
  actor,
  cockpitTestDb,
  member,
  migration,
  owner,
} from "./lib/cockpitTestDb";

const FILE = "20261013180000_cockpit_client_calls.sql";
const SQL = migration(FILE);
/** The function as it runs now: WhatsApp chats are not leads (2026-10-15). */
const CHATS_SQL = migration(
  "20261015200000_cockpit_client_calls_whatsapp_chats.sql",
);

const CEO = "00000000-0000-4000-8000-0000000000c1";
const CSM_A = "00000000-0000-4000-8000-0000000000a1";
const BUYER = "00000000-0000-4000-8000-0000000000b1";
const SALES = "00000000-0000-4000-8000-0000000000d1";
const LOC_A = "locClientA0000000001";
const LOC_B = "locClientB0000000002";

/** Kuwait calendar days, and the Monday two weeks back (a working day, 14 to 20 days ago). */
const kuwaitNow = new Date(Date.now() + 3 * 3600_000);
const today = kuwaitNow.toISOString().slice(0, 10);
const dayShift = (d: string, n: number) =>
  new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400_000)
    .toISOString()
    .slice(0, 10);
const monday = dayShift(today, -(((kuwaitNow.getUTCDay() + 6) % 7) + 14));
const from = dayShift(today, -29);
/** A Kuwait wall-clock time on that Monday, plus minutes. */
const at = (hhmm: string, plusMinutes = 0, day = monday) =>
  new Date(
    Date.parse(`${day}T${hhmm}:00+03:00`) + plusMinutes * 60_000,
  ).toISOString();

const DIALER = String.raw`
CREATE SCHEMA mahara_reporting; CREATE SCHEMA mahara_console;
CREATE TABLE public.ghl_clients(location_id text PRIMARY KEY, client_name text, status text, clickup_id text,
 meta_ad_account text, country text, service_mode text);
CREATE TABLE public.clients(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, meta_ad_account_id text, ghl_location_id text);
CREATE TABLE public.ghl_client_ad_accounts(location_id text, client_id uuid, matched_by text);
CREATE TABLE public.cockpit_campaigns(id bigserial PRIMARY KEY, meta_account_id text, meta_campaign_id text);
CREATE TABLE public.client_leads(ghl_contact_id text PRIMARY KEY, location_id text, created_at timestamptz, channel text,
 ad_id text, campaign_id text, contact_name text, contact_phone text, deleted boolean, synced_at timestamptz DEFAULT now());
CREATE TABLE public.cockpit_people(id bigserial PRIMARY KEY, name text, email text, role text, active boolean, schedule jsonb);
CREATE TABLE public.cockpit_media_daily_stats(source_deployment text, source_id text, campaign_name text, day date, data jsonb);
CREATE TABLE public.client_opportunities(opportunity_id text PRIMARY KEY, location_id text, contact_id text, stage_id text,
 status text, created_at timestamptz, last_stage_change_at timestamptz);
CREATE TABLE public.ghl_pipelines(location_id text, pipeline_id text, pipeline_name text, stage_id text, stage_name text, position integer);
CREATE TABLE public.appointments(ghl_location_id text, ghl_appointment_id text, ghl_contact_id text, booked_at timestamptz, status text, kind text);
CREATE TABLE mahara_reporting.facts(namespace text, source text, kind text, external_id text, version_at timestamptz,
 captured_at timestamptz DEFAULT now(), data jsonb, conflict boolean DEFAULT false);
CREATE TABLE mahara_console.attempts(namespace text, id text, lead_key text, agent text, state text, data jsonb, updated bigint);
CREATE TABLE mahara_console.metadata(namespace text, id text, data jsonb);

create or replace function mahara_reporting.cc_time(v text) returns timestamptz
language plpgsql immutable strict set search_path=pg_catalog as $$
begin
 if v ~ '^\d{12,14}$' then return to_timestamp(v::numeric/1000); end if;
 if v ~ '^\d{4}-\d\d-\d\dT.*(Z|[+-]\d\d:\d\d)$' then return v::timestamptz; end if;
 return null;
exception when others then return null; end $$;

create or replace function mahara_reporting.cc_phone(v text,country text default null) returns text
language plpgsql immutable set search_path=pg_catalog as $$
declare n text;
begin
 n:=translate(coalesce(v,''),U&'\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669\06F0\06F1\06F2\06F3\06F4\06F5\06F6\06F7\06F8\06F9','01234567890123456789');
 if n ~ '[^0-9+().\s-]' then return null; end if;
 n:=regexp_replace(n,'[^0-9]','','g'); n:=regexp_replace(n,'^00','');
 if n ~ '^(966|971)\d{9}$|^(965|974|973|968)\d{8}$' then return n; end if;
 if country='SA' and n ~ '^0?5\d{8}$' then return '966'||regexp_replace(n,'^0',''); end if;
 if country='AE' and n ~ '^0?5\d{8}$' then return '971'||regexp_replace(n,'^0',''); end if;
 if country in ('KW','QT','BH','OM') and n ~ '^\d{8}$' then
  return case country when 'KW' then '965' when 'QT' then '974' when 'BH' then '973' else '968' end||n;
 end if;
 return null;
end $$;

create or replace function mahara_reporting.cc_window(s jsonb,d date) returns tstzrange
language plpgsql stable set search_path=pg_catalog as $$
declare w jsonb; z text:=s->>'timezone'; a timestamptz; b timestamptz; k text;
begin
 if s is null or jsonb_typeof(s->'exceptions')<>'array' or nullif(z,'') is null then return null; end if;
 foreach k in array array['sun','mon','tue','wed','thu','fri','sat'] loop
  if jsonb_typeof(s->'week'->k->'on') is distinct from 'boolean' then return null; end if;
  if s->'week'->k->>'on'='true' and (coalesce(s->'week'->k->>'start','') !~ '^([01]\d|2[0-3]):[0-5]\d$' or coalesce(s->'week'->k->>'end','') !~ '^([01]\d|2[0-3]):[0-5]\d$' or s->'week'->k->>'end'<=s->'week'->k->>'start') then return null; end if;
 end loop;
 if exists(select 1 from jsonb_array_elements(s->'exceptions')e group by e->>'date' having count(*)>1) then return null; end if;
 select e into w from jsonb_array_elements(s->'exceptions')e where e->>'date'=d::text;
 if not found then w:=s->'week'->(array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from d)::int+1]; end if;
 if w->>'off'='true' or w->>'on'='false' then return tstzrange(null,null,'()'); end if;
 if coalesce(w->>'start','') !~ '^([01]\d|2[0-3]):[0-5]\d$' or coalesce(w->>'end','') !~ '^([01]\d|2[0-3]):[0-5]\d$' or w->>'end'<=w->>'start' then return null; end if;
 a:=(d+(w->>'start')::time) at time zone z; b:=(d+(w->>'end')::time) at time zone z;
 if to_char(a at time zone z,'HH24:MI')<>w->>'start' or to_char(b at time zone z,'HH24:MI')<>w->>'end' then return null; end if;
 return tstzrange(a,b,'[)');
exception when others then return null; end $$;

create or replace function mahara_reporting.cc_work_seconds(s jsonb,a timestamptz,b timestamptz) returns numeric
language plpgsql stable set search_path=pg_catalog,mahara_reporting as $$
declare d date; last_day date; w tstzrange; total numeric:=0;
begin
 if a is null or b is null or b<a or b-a>interval '10 years' then return null; end if;
 d:=(a at time zone (s->>'timezone'))::date; last_day:=(b at time zone (s->>'timezone'))::date;
 if d is null or last_day is null then return null; end if;
 while d<=last_day loop
  w:=mahara_reporting.cc_window(s,d);
  if w is null then return null; end if;
  if not lower_inf(w) then total:=total+greatest(0,extract(epoch from least(b,upper(w))-greatest(a,lower(w)))); end if;
  d:=d+1;
 end loop;
 return total;
exception when others then return null; end $$;

create or replace function mahara_reporting.cc_day(s jsonb,t timestamptz) returns date
language plpgsql stable set search_path=pg_catalog as $$
begin return (t at time zone (s->>'timezone'))::date;
exception when others then return null; end $$;

create or replace view mahara_reporting.cc_people with (security_invoker=true) as
 select lower(trim(email)) email,min(name) name,
 case when count(*)=1 then (jsonb_agg(schedule))->0 end schedule
 from public.cockpit_people where nullif(trim(email),'') is not null group by lower(trim(email));

create or replace view mahara_reporting.cc_leads with (security_invoker=true) as
 select distinct on(location_id,contact_id) location_id,contact_id,created_at,phone from (
 select l.location_id,l.ghl_contact_id contact_id,l.created_at,mahara_reporting.cc_phone(l.contact_phone,g.country) phone,0 priority
 from public.client_leads l left join public.ghl_clients g on g.location_id=l.location_id where not coalesce(l.deleted,false)
 union all
 select f.data->>'locationId',f.data->>'id',mahara_reporting.cc_time(f.data->>'createdAt'),mahara_reporting.cc_phone(f.data->>'phone',g.country),1
 from mahara_reporting.facts f left join public.ghl_clients g on g.location_id=f.data->>'locationId'
 where f.namespace='production' and f.source='ghl' and f.kind='contact' and not f.conflict and coalesce(f.data->>'missingFromProvider','false')<>'true'
 and not exists(select 1 from public.client_leads l where l.location_id=f.data->>'locationId' and l.ghl_contact_id=f.data->>'id' and l.deleted)
 )l where location_id is not null and contact_id is not null order by location_id,contact_id,priority;

create or replace view mahara_reporting.cc_attempts with (security_invoker=true) as
 select id,lower(trim(agent)) agent,data->>'locationId' location_id,data->>'contactId' contact_id,
 data->>'callId' call_id,data->>'appointmentId' appointment_id,data,
 case when data->>'mode' is distinct from 'referral_booking' and data->'disposition'->>'outcome' in ('NO ANSWER','LOST','HANDLED','CALLBACK','BOOKED','CONFIRMED','NO REPLY','RESCHEDULE','CANCELLED','HANDOVER','REFERRED') and length(trim(coalesce(data->'disposition'->>'note','')))>0
 then coalesce(mahara_reporting.cc_time(nullif(data->>'dispositionSavedAt','0')),case when state='closed' then mahara_reporting.cc_time(nullif(data->>'completedAt','0')) end) end outcome_at
 from mahara_console.attempts where namespace='production';

create or replace view mahara_reporting.cc_calls with (security_invoker=true) as
 with leads as materialized(select * from mahara_reporting.cc_leads),
 phones as (select phone,min(location_id) location_id,min(contact_id) contact_id from leads where phone is not null group by phone having count(*)=1),
 links as (select call_id,count(distinct (location_id,contact_id)) n,min(location_id) location_id,min(contact_id) contact_id,min(agent) linked_agent,count(distinct agent) agents
 from mahara_reporting.cc_attempts where call_id is not null and location_id is not null and contact_id is not null group by call_id),
 raw as (select external_id id,data,conflict,mahara_reporting.cc_time(data->>'timestamp') started_at,
 case when jsonb_array_length(data->'agents')=1 then lower(data->'agents'->0->>'email') end agent,
 case when jsonb_typeof(data->'duration')='number' and (data->>'duration')::numeric between 0 and 604800 then (data->>'duration')::numeric end duration,
 case when jsonb_typeof(data->'ringingTime')='number' and (data->>'ringingTime')::numeric between 0 and 604800 then (data->>'ringingTime')::numeric end ringing
 from mahara_reporting.facts where namespace='production' and kind='call' and source='maqsam')
 select r.*,case when k.call_id is not null then case when k.n=1 and k.agents=1 and k.linked_agent=r.agent and (mahara_reporting.cc_phone(r.data->>'phone') is null or l.phone is null or l.phone=mahara_reporting.cc_phone(r.data->>'phone')) then k.location_id end else p.location_id end location_id,
 case when k.call_id is not null then case when k.n=1 and k.agents=1 and k.linked_agent=r.agent and (mahara_reporting.cc_phone(r.data->>'phone') is null or l.phone is null or l.phone=mahara_reporting.cc_phone(r.data->>'phone')) then k.contact_id end else p.contact_id end contact_id,
 case when k.n=1 and k.agents=1 and k.linked_agent=r.agent and (mahara_reporting.cc_phone(r.data->>'phone') is null or l.phone is null or l.phone=mahara_reporting.cc_phone(r.data->>'phone')) then 'exact_call_id' when k.call_id is null and p.phone is not null then 'unique_full_phone' when k.call_id is not null then 'conflicting_link' else 'unattributed' end attribution
 from raw r left join links k on k.call_id=r.id left join phones p on p.phone=mahara_reporting.cc_phone(r.data->>'phone') left join leads l on l.location_id=k.location_id and l.contact_id=k.contact_id;

-- Cut down: the function reads location, contact, booking time, kind, status, conflict.
create view mahara_reporting.cc_appointments as
 select ghl_location_id location_id,ghl_appointment_id id,ghl_contact_id contact_id,booked_at,status,false as conflict,kind booking_kind
 from public.appointments;

-- The dialer's report, stubbed: its rows come from this table, so the test can
-- check the headline is passed on as it is.
CREATE TABLE public.test_report(location_id text PRIMARY KEY, body jsonb);
create function public.mahara_call_center_report(p_from date,p_to date,p_agent text default null,p_client text default null) returns jsonb
language sql stable as $$
 select jsonb_build_object('version',1,'clients',coalesce((select jsonb_agg(body) from public.test_report where location_id=p_client),'[]'::jsonb),
  'coverage',jsonb_build_object('leadSyncAt','2026-10-13T10:00:00Z','callSyncAt','2026-10-13T10:01:00Z','appointmentSyncAt',null,'sheetSyncAt',null))
$$;
`;

const SCHEDULE = {
  timezone: "Asia/Kuwait",
  exceptions: [],
  week: Object.fromEntries(
    ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map(d => [
      d,
      { on: d !== "fri", start: "10:00", end: "18:00" },
    ]),
  ),
};

type Lead = {
  id: string;
  loc?: string;
  phone: string | null;
  ad?: string | null;
  campaign?: string | null;
  created: string;
  name?: string;
  channel?: string;
};
const LEADS: Lead[] = [
  {
    id: "a1",
    phone: "+96550000001",
    ad: "AD1",
    campaign: "CMP1",
    created: at("11:00"),
    name: "Sara Ahmed",
  },
  {
    id: "a2",
    phone: "+96550000002",
    ad: "AD1",
    campaign: "CMP1",
    created: at("11:30"),
  },
  {
    id: "a3",
    phone: "+96550000003",
    ad: "AD2",
    campaign: "CMP2",
    created: at("22:00"),
  },
  { id: "a4", phone: null, ad: "AD2", campaign: "CMP2", created: at("12:00") },
  { id: "a5", phone: "abc", ad: null, campaign: null, created: at("12:30") },
  {
    id: "a6",
    phone: "+96550000006",
    ad: "AD2",
    campaign: "CMP2",
    created: at("13:00"),
  },
  {
    id: "a7",
    phone: "+96550000007",
    ad: "AD1",
    campaign: "CMP1",
    created: at("14:00"),
    name: "Khalid Al Test",
  },
  {
    id: "a8",
    phone: "+96550000008",
    ad: "AD2",
    campaign: "CMP2",
    created: at("15:00"),
    name: "Noura",
  },
  {
    id: "a9",
    phone: "+96550000009",
    ad: "AD1",
    campaign: "CMP1",
    created: at("16:00"),
  },
  {
    id: "a10",
    phone: "+96550000010",
    ad: "AD1",
    campaign: "CMP1",
    created: at("16:30"),
    name: "<test lead: dummy data for full_name>",
  },
  // Before the window: never counted.
  {
    id: "a0",
    phone: "+96550000099",
    ad: "AD1",
    campaign: "CMP1",
    created: new Date(Date.now() - 60 * 86400_000).toISOString(),
  },
  // Client B shares a6's phone, so calls to it link to neither lead.
  { id: "b6", loc: LOC_B, phone: "+96550000006", created: at("13:05") },
  { id: "b1", loc: LOC_B, phone: "+966500000001", created: at("11:00") },
];

type Call = {
  id: string;
  phone: string;
  at: string;
  state: string;
  duration: number;
  type?: string;
  agent?: string;
};
const AGENT = "agent1@maharamedia.com";
const CALLS: Call[] = [
  {
    id: "1001",
    phone: "+96550000001",
    at: at("11:00", 3),
    state: "completed",
    duration: 150,
  },
  {
    id: "1002",
    phone: "+96550000002",
    at: at("11:30", 40),
    state: "no_answer",
    duration: 0,
  },
  {
    id: "1003",
    phone: "+96550000002",
    at: at("11:30", 180),
    state: "no_answer",
    duration: 0,
  },
  {
    id: "1004",
    phone: "+96550000002",
    at: at("11:30", 1440),
    state: "busy",
    duration: 0,
  },
  {
    id: "1006",
    phone: "+96550000006",
    at: at("13:00", 5),
    state: "completed",
    duration: 10,
  },
  {
    id: "1071",
    phone: "+96550000007",
    at: at("14:00", 10),
    state: "completed",
    duration: 45,
  },
  {
    id: "1072",
    phone: "+96550000007",
    at: at("14:00", 1440),
    state: "completed",
    duration: 200,
  },
  {
    id: "1081",
    phone: "+96550000008",
    at: at("15:00", 60),
    state: "no_answer",
    duration: 0,
  },
  {
    id: "1082",
    phone: "+96550000008",
    at: at("15:00", 1500),
    state: "no_answer",
    duration: 0,
  },
  {
    id: "1091",
    phone: "+96550000009",
    at: at("16:00", 4),
    state: "completed",
    duration: 20,
  },
  {
    id: "2001",
    phone: "+966500000001",
    at: at("11:00", 2),
    state: "completed",
    duration: 300,
  },
  // A missed call from a3, never returned.
  {
    id: "3001",
    phone: "+96550000003",
    at: at("09:00", 1440),
    state: "abandoned",
    duration: 5,
    type: "inbound",
  },
];

type Attempt = {
  id: string;
  contact: string;
  outcome: string;
  note: string;
  savedAt: string;
  reason?: string;
  callId?: string;
  leadName?: string;
  callbackAt?: number;
  mode?: string;
};
const ATTEMPTS: Attempt[] = [
  {
    id: "t3",
    contact: "a3",
    outcome: "NO ANSWER",
    note: "No answer",
    savedAt: at("10:05", 1440),
  },
  {
    id: "t7",
    contact: "a7",
    outcome: "LOST",
    reason: "Other",
    callId: "1071",
    savedAt: at("15:00", 1440),
    note: "Call notes:\nHe doesn't have a project. Not interested.\n\nClient handover:\nHe doesn't have a project. [mahara:abc]",
  },
  {
    id: "t8",
    contact: "a8",
    outcome: "LOST",
    reason: "Unreachable",
    note: "لا يرد",
    savedAt: at("15:00", 3 * 1440),
  },
  {
    id: "t9",
    contact: "a9",
    outcome: "CALLBACK",
    note: "Busy, call tomorrow",
    savedAt: at("16:05"),
    callbackAt: Date.parse(at("10:00", 1440)),
  },
  {
    id: "t10",
    contact: "a10",
    outcome: "LOST",
    reason: "Other",
    note: "Test lead",
    savedAt: at("17:00"),
    leadName: "<test lead: dummy data for full_name>",
  },
];

let db: PGlite;

function report(overrides: Record<string, unknown> = {}) {
  return {
    id: LOC_A,
    name: "Client A",
    leads: 10,
    leadsDialed: 5,
    leadsContacted: 3,
    noVerifiedDial: 5,
    providerDials: 9,
    connections: 3,
    dials: 4,
    talkSeconds: 415,
    connectionRate: 3 / 9,
    medianSpeedSeconds: 600,
    avgSpeedSeconds: 1404,
    speedSamples: 5,
    withinTwoMinutes: 0,
    withinTwoMinutesRate: 0,
    confirmedBookings: 1,
    provisionalBookings: 0,
    unclassifiedBookings: 0,
    shows: 0,
    noShow: 0,
    showRate: null,
    closed: 0,
    closeRate: null,
    avgCallGapSeconds: null,
    callGapSamples: 0,
    unlinkedCalls: 0,
    conflictingResults: 0,
    values: [],
    ...overrides,
  };
}

async function rpc(name: string, ...args: unknown[]) {
  const params = args.map((_, i) => `$${i + 1}`).join(",");
  const r = await db.query<{ r: unknown }>(
    `SELECT public.${name}(${params}) AS r`,
    args,
  );
  return r.rows[0].r;
}
const calls = (key: string, f = from, t = today) =>
  rpc("cockpit_client_calls", key, f, t);

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  const allowed = migration("20260926m_cockpit_csm_state.sql").match(
    /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\(p_name text\)[\s\S]*?END \$\$;/,
  );
  expect(allowed).not.toBeNull();
  await db.exec(allowed![0]);
  await db.exec(DIALER);
  await member(db, CEO, "aziz@maharamedia.com", ["admin", "ceo"]);
  await member(db, CSM_A, "csm-a@tests.invalid", ["csm"]);
  await member(db, BUYER, "buyer@tests.invalid", ["media_buyer"]);
  await member(db, SALES, "sales@tests.invalid", ["sales"]);
  await db.query(
    "UPDATE public.cockpit_members SET clients=$1 WHERE auth_user_id=$2",
    [["Client A"], CSM_A],
  );

  await db.exec(`
    INSERT INTO public.ghl_clients VALUES
     ('${LOC_A}','Client A','Active','CU_A','client a account','KW','DFY'),
     ('${LOC_B}','Client B','Active','CU_B',NULL,'SA','DWY');
    INSERT INTO public.clients(name,meta_ad_account_id,ghl_location_id) VALUES ('Client A ads','act_111111',NULL);
    INSERT INTO public.ghl_client_ad_accounts SELECT '${LOC_A}',id,'name' FROM public.clients WHERE name='Client A ads';
    INSERT INTO public.cockpit_campaigns(meta_account_id,meta_campaign_id) VALUES ('act_222222','CMPB');
    INSERT INTO public.cockpit_people(name,email,role,active,schedule) VALUES
     ('Agent One','${AGENT}','Call centre agent',true,'${JSON.stringify(SCHEDULE)}'),
     ('The Boss','boss@maharamedia.com','CEO',true,NULL),
     ('Helper','helper@maharamedia.com','Systems manager',true,NULL);
    INSERT INTO mahara_console.metadata VALUES
     ('production','access:agent:${AGENT}','{"email":"${AGENT}","active":true,"locationIds":["${LOC_A}","${LOC_B}"]}'),
     ('production','identity:account:${AGENT}','{"email":"${AGENT}","role":"agent","enabled":true}'),
     ('production','access:agent:boss@maharamedia.com','{"email":"boss@maharamedia.com","active":true,"locationIds":["${LOC_A}"]}'),
     ('production','identity:account:boss@maharamedia.com','{"email":"boss@maharamedia.com","role":"admin","enabled":true}'),
     ('production','access:agent:helper@maharamedia.com','{"email":"helper@maharamedia.com","active":true,"locationIds":["${LOC_A}"]}'),
     ('production','access:agent:gone@maharamedia.com','{"email":"gone@maharamedia.com","active":false,"locationIds":["${LOC_A}"]}');
    INSERT INTO public.cockpit_media_daily_stats VALUES
     ('d','1','Campaign one','${monday}','{"metaAdId":"AD1","adName":"Ad one","campaignName":"Campaign one"}'),
     ('d','2','Campaign two','${monday}','{"metaAdId":"AD2","adName":"Ad two","campaignName":"Campaign two"}');
    INSERT INTO public.ghl_pipelines VALUES
     ('${LOC_A}','P1','New Leads Pipeline 📲','S1','Day 1 AM - Follow Up',1),
     ('${LOC_A}','P1','New Leads Pipeline 📲','S2','📲Call Back Requested',0),
     ('${LOC_A}','P2','Main Pipeline 📅','S3','Booked Appointments 🟢',1);
    INSERT INTO public.client_opportunities VALUES
     ('o1','${LOC_A}','a3','S1','open','${at("22:00")}',NULL),
     ('o2','${LOC_A}','a10','S1','open','${at("16:30")}',NULL),
     ('o3','${LOC_A}','a1','S3','open','${at("11:00")}',NULL),
     ('o4','${LOC_A}','a2','S1','lost','${at("11:30")}',NULL);
    INSERT INTO public.appointments VALUES ('${LOC_A}','ap1','a1','${at("11:10")}','confirmed','confirmed');
  `);
  for (const l of LEADS)
    await db.query(
      "INSERT INTO public.client_leads(ghl_contact_id,location_id,created_at,channel,ad_id,campaign_id,contact_name,contact_phone) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        l.id,
        l.loc ?? LOC_A,
        l.created,
        l.channel ?? "Meta",
        l.ad ?? null,
        l.campaign ?? null,
        l.name ?? null,
        l.phone,
      ],
    );
  for (const c of CALLS)
    await db.query(
      "INSERT INTO mahara_reporting.facts(namespace,source,kind,external_id,data) VALUES('production','maqsam','call',$1,$2::jsonb)",
      [
        c.id,
        JSON.stringify({
          id: c.id,
          type: c.type ?? "outbound",
          phone: c.phone,
          state: c.state,
          duration: c.duration,
          ringingTime: 5,
          timestamp: c.at,
          agents: [{ name: "Agent One", email: c.agent ?? AGENT }],
        }),
      ],
    );
  for (const a of ATTEMPTS)
    await db.query(
      "INSERT INTO mahara_console.attempts VALUES('production',$1,$2,$3,'closed',$4::jsonb,$5)",
      [
        a.id,
        `${LOC_A}:${a.contact}`,
        AGENT,
        JSON.stringify({
          locationId: LOC_A,
          contactId: a.contact,
          callId: a.callId ?? null,
          mode: a.mode ?? "outcome",
          leadName: a.leadName ?? null,
          scheduledCallbackAt: a.callbackAt ?? null,
          dispositionSavedAt: Date.parse(a.savedAt),
          disposition: {
            outcome: a.outcome,
            reason: a.reason ?? null,
            note: a.note,
          },
        }),
        Date.parse(a.savedAt),
      ],
    );
  await db.query("INSERT INTO public.test_report VALUES($1,$2::jsonb)", [
    LOC_A,
    JSON.stringify(report()),
  ]);
  await db.exec(SQL);
  await db.exec(CHATS_SQL);
}, 60_000);
afterAll(async () => {
  await db?.close();
});

describe("the gate", () => {
  test("no seat, a seat without the role, and a client outside the seat are refused in plain words", async () => {
    await actor(db, null);
    await expect(calls("CU_A")).rejects.toThrow(/permission denied/);
    await actor(db, SALES);
    await expect(calls("CU_A")).rejects.toThrow(
      "Call centre numbers are for client success and media buyers. Ask the CEO for access.",
    );
    await actor(db, CSM_A);
    await expect(calls("CU_B")).rejects.toThrow(
      "This client is not on your cockpit seat. Ask the CEO to add it.",
    );
    await expect(calls("not a key!")).rejects.toThrow("Choose a client first.");
    await expect(calls("CU_NOPE")).rejects.toThrow(
      "No client matches this link.",
    );
    await expect(calls("CU_A", dayShift(today, -93), today)).rejects.toThrow(
      "covering at most 93 days",
    );
    await expect(calls("CU_A", from, dayShift(today, 1))).rejects.toThrow(
      "up to today",
    );
    await owner(db);
  });

  test("a ClickUp task id, an ad account with or without act_, a location id, or an ad account found through its campaigns", async () => {
    await actor(db, BUYER);
    for (const key of ["CU_A", "act_111111", "111111", LOC_A])
      expect(
        ((await calls(key)) as { client: { name: string } }).client.name,
      ).toBe("Client A");
    // Client B's account is on no client record; its campaign's leads say where it belongs.
    await db.exec("RESET ROLE");
    await db.query(
      "UPDATE public.client_leads SET campaign_id='CMPB' WHERE ghl_contact_id='b1'",
    );
    await actor(db, BUYER);
    expect(
      ((await calls("act_222222")) as { client: { name: string } }).client.name,
    ).toBe("Client B");
    await owner(db);
  });

  test("an ad account linked to two clients is refused with a step the media buyer can take", async () => {
    await owner(db);
    await db.exec(`
      INSERT INTO public.clients(name,meta_ad_account_id,ghl_location_id) VALUES
       ('Shared ads one','act_333333','${LOC_A}'),
       ('Shared ads two','act_333333','${LOC_B}');
    `);
    try {
      await actor(db, BUYER);
      await expect(calls("act_333333")).rejects.toThrow(
        "This ad account is linked to more than one client. Ask the CEO to fix the ad account on the client record.",
      );
    } finally {
      await owner(db);
      await db.exec(
        "DELETE FROM public.clients WHERE name IN ('Shared ads one','Shared ads two')",
      );
    }
  });

  test("only signed-in seats may run it; the helpers are closed to everyone", async () => {
    await owner(db);
    const can = async (role: string, fn: string) =>
      (
        await db.query<{ ok: boolean }>(
          "SELECT has_function_privilege($1,$2,'execute') AS ok",
          [role, fn],
        )
      ).rows[0].ok;
    for (const fn of [
      "public.cockpit_client_calls(text,date,date)",
      "public.cockpit_call_recording_scope(text)",
      "public.cockpit_call_recording_played(text)",
    ]) {
      expect(await can("authenticated", fn)).toBe(true);
      expect(await can("anon", fn)).toBe(false);
      expect(await can("service_role", fn)).toBe(false);
    }
    for (const fn of [
      "public.cockpit_call_centre_seat()",
      "public.cockpit_call_centre_client(text)",
      "public.cockpit_call_centre_is_test(jsonb)",
      "public.cockpit_call_centre_note(text)",
      "public.cockpit_call_centre_lost_key(text,text)",
    ])
      for (const role of ["anon", "authenticated", "service_role"])
        expect(await can(role, fn)).toBe(false);
  });
});

describe("one client's call centre", () => {
  test("the headline is the dialer's report, and the rest follows the dialer's link rule", async () => {
    await actor(db, CSM_A);
    const raw = await calls("CU_A");
    await owner(db);
    const data = parseCallCentre(raw);
    expect(data.official?.providerDials).toBe(9);
    expect(data.official?.leads).toBe(10);
    expect(data.officialCoverage?.callSyncAt).toBe("2026-10-13T10:01:00Z");
    expect(data.client).toMatchObject({
      locationId: LOC_A,
      name: "Client A",
      serviceMode: "DFY",
      dialerActive: true,
    });
    // Same leads and dials as the report, so no mismatch note.
    expect(data.cohort).toEqual({
      leads: 10,
      called: 5,
      dials: 9,
      reached: 3,
      talked30: 2,
      talked120: 2,
      booked: 1,
      confirmed: 1,
    });
    // Calls made in the dates: four connected (150, 45, 200 and 20 seconds).
    expect(data.window).toEqual({
      dials: 9,
      reached: 4,
      talked30: 3,
      talked120: 2,
      talkSeconds: 415,
    });
    expect(data.notes.some(n => n.includes("differ from the dialer"))).toBe(
      false,
    );
    expect(data.notes.join(" ")).not.toMatch(/[—]/);
    // Not called, by cause: one blank phone, one unreadable, one phone dialled
    // under client B's lead, two good phones never dialled (one has an outcome
    // saved with no call).
    expect(data.notCalled).toEqual({
      total: 5,
      noPhone: 1,
      unreadablePhone: 1,
      dialledUnderAnotherLead: 1,
      neverDialled: 2,
      neverDialledOutsideDialerCountries: 0,
      neverDialledWithSavedOutcome: 1,
    });
    // First calls 3, 4, 10, 40 and 60 minutes after arrival; one lead came at 22:00.
    expect(data.speed).toMatchObject({
      hoursSource: "schedule",
      leads: 10,
      medianClockSeconds: 600,
      withinFiveMinutes: 2,
    });
    expect(data.speed.inHours).toMatchObject({
      leads: 9,
      called: 5,
      withinFiveMinutes: 2,
    });
    expect(data.speed.outOfHours).toMatchObject({
      leads: 1,
      called: 0,
      medianClockSeconds: null,
    });
    // a2: 3 calls, a8: 2 calls, neither answered in 72 hours.
    expect(data.followUp).toEqual({ leads: 2, calls: 5, threePlus: 1 });
    // a3's no-answer and a8's lost were saved with no Maqsam call.
    expect(data.messages).toEqual({ handled: 0, outcomesWithoutCall: 2 });
  });

  test("ads and campaigns carry their names, their leads and dials, beside the client's average", async () => {
    await actor(db, CSM_A);
    const data = parseCallCentre(await calls(LOC_A));
    await owner(db);
    expect(
      data.byAd.map(r => [
        r.id,
        r.name,
        r.campaignName,
        r.leads,
        r.called,
        r.dials,
        r.reached,
        r.booked,
      ]),
    ).toEqual([
      ["AD1", "Ad one", "Campaign one", 5, 4, 7, 3, 1],
      ["AD2", "Ad two", "Campaign two", 4, 1, 2, 0, 0],
    ]);
    expect(data.byCampaign.map(r => [r.id, r.name, r.leads, r.dials])).toEqual([
      ["CMP1", "Campaign one", 5, 7],
      ["CMP2", "Campaign two", 4, 2],
    ]);
    expect(data.clientAverage).toMatchObject({
      id: null,
      leads: 10,
      called: 5,
      dials: 9,
    });
    expect(data.coverage).toMatchObject({
      leadsWithoutPhone: 1,
      leadsWithUnreadablePhone: 1,
      leadsWithoutAdId: 1,
      metaLeadsWithoutAdId: 1,
      unlinkedCalls: 1,
      leadsOnlyInGhl: 0,
    });
  });

  test("who is waiting: untouched leads, ladder stages, callbacks and missed calls", async () => {
    await actor(db, CSM_A);
    const data = parseCallCentre(await calls("CU_A"));
    await owner(db);
    // Eight leads have a phone the dialer can call; a10's only attempt is a test.
    expect(data.waiting.callable).toBe(8);
    expect(data.waiting.touched).toBe(7);
    expect(data.waiting.untouched.count).toBe(1);
    expect(data.waiting.untouched.oldestAt).not.toBeNull();
    expect(data.waiting.untouched.oldestWorkSeconds).toBeGreaterThan(3600);
    expect(data.waiting.stages).toEqual([
      expect.objectContaining({
        stage: "Day 1 AM - Follow Up",
        count: 2,
        overSevenDays: 2,
      }),
    ]);
    expect(data.waiting.callbacks).toMatchObject({
      count: 1,
      overThreeDays: 1,
      scheduled: 1,
      overdue: 1,
    });
    expect(data.waiting.missedInbound).toMatchObject({
      count: 1,
      callers: 1,
      never: 1,
      withinDay: 0,
    });
  });

  test("why leads were lost: the note sorted, the agent's words only, the longest call to play", async () => {
    await actor(db, CSM_A);
    const data = parseCallCentre(await calls("CU_A"));
    await owner(db);
    expect(data.lost.total).toBe(2); // the test lead is left out
    expect(data.lost.reasons).toEqual([
      { key: "not_a_fit", count: 1 },
      { key: "unreachable", count: 1 },
    ]);
    expect(data.lost.otherNotes).toEqual({ total: 1, sorted: 1 });
    expect(data.lost.unreachable).toEqual({
      leads: 1,
      calls: 2,
      noCall: 0,
      fourPlus: 0,
      connected: 0,
    });
    const [noura, khalid] = data.lost.latest;
    expect(noura).toMatchObject({
      firstName: "Noura",
      key: "unreachable",
      calls: 2,
      longestSeconds: null,
      longestCallId: null,
      agent: "Agent One",
      adName: "Ad two",
    });
    expect(khalid).toMatchObject({
      firstName: "Khalid",
      adId: "AD1",
      adName: "Ad one",
      reason: "Other",
      key: "not_a_fit",
      note: "He doesn't have a project. Not interested.",
      calls: 2,
      longestSeconds: 200,
      longestCallId: "1072",
    });
  });

  test("the assigned caller is the dialer's agent; admins and others with access are listed apart", async () => {
    await actor(db, CSM_A);
    const data = parseCallCentre(await calls("CU_A"));
    await owner(db);
    expect(data.callers.assigned).toEqual([
      { email: AGENT, name: "Agent One" },
    ]);
    expect(data.callers.otherAccess).toEqual([
      {
        email: "helper@maharamedia.com",
        name: "Helper",
        why: "Not a call centre agent",
      },
      {
        email: "boss@maharamedia.com",
        name: "The Boss",
        why: "Dialer admin, not a caller",
      },
    ]);
    expect(data.callers.dialled).toEqual([
      { email: AGENT, name: "Agent One", dials: 9 },
    ]);
  });

  test("the verdict reads the same numbers: leads waiting and slow follow-up are the call centre's", async () => {
    await actor(db, CSM_A);
    const data = parseCallCentre(await calls("CU_A"));
    await owner(db);
    // Ten leads is under the verdict's floor.
    expect(callCentreVerdict(data).kind).toBe("not_enough");
    expect(REACHED_GATE).toBe(35);
  });

  test("a WhatsApp chat with no ad is left out, named in a note, and added back before comparing with the report", async () => {
    await owner(db);
    const created = at("12:45");
    await db.query(
      "INSERT INTO public.client_leads(ghl_contact_id,location_id,created_at,channel,contact_phone) VALUES('w1',$1,$2,'Other','+96550000021')",
      [LOC_A, created],
    );
    // w1 wrote on WhatsApp and came from no ad; a9 came from an ad and wrote later, so it stays.
    await db.query(
      "INSERT INTO mahara_reporting.facts(namespace,source,kind,external_id,data) VALUES ('production','ghl','contact',$1,$2::jsonb),('production','ghl','contact',$3,$4::jsonb)",
      [
        `${LOC_A}:w1`,
        JSON.stringify({
          id: "w1",
          locationId: LOC_A,
          createdAt: created,
          phone: "+96550000021",
          tags: ["inbound whatsapp", "wa: +96550000000"],
        }),
        `${LOC_A}:a9`,
        JSON.stringify({
          id: "a9",
          locationId: LOC_A,
          createdAt: at("16:00"),
          phone: "+96550000009",
          tags: ["facebook ads lead", "Inbound WhatsApp"],
        }),
      ],
    );
    // The dialer's report counts the chat as a lead.
    await db.query(
      "UPDATE public.test_report SET body=$1::jsonb WHERE location_id=$2",
      [JSON.stringify(report({ leads: 11 })), LOC_A],
    );
    try {
      await actor(db, CSM_A);
      const raw = (await calls("CU_A")) as {
        coverage: { whatsappChats: number; whatsappChatsCalled: number };
      };
      await owner(db);
      const data = parseCallCentre(raw);
      expect(data.cohort.leads).toBe(10);
      expect(data.clientAverage?.leads).toBe(10);
      expect(data.waiting.callable).toBe(8);
      expect(data.waiting.untouched.count).toBe(1);
      expect(data.notCalled.total).toBe(5);
      expect(raw.coverage.whatsappChats).toBe(1);
      expect(raw.coverage.whatsappChatsCalled).toBe(0);
      expect(data.notes).toContain(
        "1 WhatsApp chat contact is left out of the figures worked out here: tagged \"inbound whatsapp\" in GoHighLevel, with no ad. The dialer's headline still counts them.",
      );
      expect(data.notes.some(n => n.includes("differ from the dialer"))).toBe(
        false,
      );
    } finally {
      await owner(db);
      await db.exec(
        "DELETE FROM public.client_leads WHERE ghl_contact_id='w1'; DELETE FROM mahara_reporting.facts WHERE source='ghl' AND kind='contact';",
      );
      await db.query(
        "UPDATE public.test_report SET body=$1::jsonb WHERE location_id=$2",
        [JSON.stringify(report()), LOC_A],
      );
    }
  });

  test("a report that disagrees is named; a missing report row is missing, never zero", async () => {
    await owner(db);
    await db.query(
      "UPDATE public.test_report SET body=$1::jsonb WHERE location_id=$2",
      [JSON.stringify(report({ providerDials: 11 })), LOC_A],
    );
    await actor(db, CSM_A);
    let data = parseCallCentre(await calls("CU_A"));
    expect(
      data.notes.some(n =>
        n.startsWith("Dials here (9) differ from the dialer's report (11)"),
      ),
    ).toBe(true);
    await owner(db);
    await db.query("DELETE FROM public.test_report WHERE location_id=$1", [
      LOC_A,
    ]);
    await actor(db, CSM_A);
    data = parseCallCentre(await calls("CU_A"));
    await owner(db);
    expect(data.official).toBeNull();
    expect(callCentreVerdict(data).kind).toBe("no_data");
    expect(data.notes.some(n => n.includes("has no row for this client"))).toBe(
      true,
    );
    await db.query("INSERT INTO public.test_report VALUES($1,$2::jsonb)", [
      LOC_A,
      JSON.stringify(report()),
    ]);
  });
});

describe("recordings", () => {
  test("a linked call of a client the seat may see can be played, and every play leaves an audit row", async () => {
    await actor(db, CSM_A);
    expect(await rpc("cockpit_call_recording_scope", "1001")).toEqual({
      ok: true,
      clientName: "Client A",
      locationId: LOC_A,
    });
    await rpc("cockpit_call_recording_played", "1072");
    await expect(rpc("cockpit_call_recording_scope", "1006")).rejects.toThrow(
      "This call is not linked to a client",
    );
    await expect(rpc("cockpit_call_recording_scope", "2001")).rejects.toThrow(
      "not on your cockpit seat",
    );
    await expect(rpc("cockpit_call_recording_played", "2001")).rejects.toThrow(
      "not on your cockpit seat",
    );
    await expect(rpc("cockpit_call_recording_scope", "12ab")).rejects.toThrow(
      "Choose a call to play.",
    );
    await actor(db, SALES);
    await expect(rpc("cockpit_call_recording_scope", "1001")).rejects.toThrow(
      "Ask the CEO for access",
    );
    await owner(db);
    const rows = (
      await db.query<{
        action: string;
        entity_id: string;
        actor_email: string;
        metadata: { clientName: string; locationId: string };
      }>(
        "SELECT action,entity_id,actor_email,metadata FROM public.cockpit_audit_log WHERE action='call.recording.play'",
      )
    ).rows;
    expect(rows).toEqual([
      {
        action: "call.recording.play",
        entity_id: "1072",
        actor_email: "csm-a@tests.invalid",
        metadata: { clientName: "Client A", locationId: LOC_A },
      },
    ]);
  });
});

describe("lost notes", () => {
  test("the agent's words without the dialer's system lines", async () => {
    await owner(db);
    const clean = async (note: string | null) =>
      (
        await db.query<{ n: string | null }>(
          "SELECT public.cockpit_call_centre_note($1) AS n",
          [note],
        )
      ).rows[0].n;
    expect(
      await clean(
        "No answer verified by Maqsam call 376516682; duration 0 seconds. Automatic follow-up disposition.",
      ),
    ).toBeNull();
    expect(
      await clean(
        "Call notes:\nبس عم يسأل عن العروض.\n\nClient handover:\nبس عم يسأل عن العروض.",
      ),
    ).toBe("بس عم يسأل عن العروض.");
    expect(
      await clean(
        "Not ready. [mahara:7f3a]\nFeedback shared with client: call him in April",
      ),
    ).toBe("Not ready.");
    expect(
      await clean(":  Follow-up ladder exhausted. Lost: Unreachable."),
    ).toBeNull();
    expect(await clean(null)).toBeNull();
  });

  test("Other notes sort into plain reasons the way the agents write them", async () => {
    await owner(db);
    const key = async (reason: string, note: string) =>
      (
        await db.query<{ k: string }>(
          "SELECT public.cockpit_call_centre_lost_key($1,$2) AS k",
          [reason, note],
        )
      ).rows[0].k;
    const cases: [string, string][] = [
      ["He doesn't have a project. Not interested.", "not_a_fit"],
      ["She thought we were a real estate company.", "not_a_fit"],
      ["مقاول و يدور شغل", "not_a_fit"],
      ["غير مناسب للعميل", "not_a_fit"],
      ["Not interested anymore.", "not_interested"],
      ["سكرت الخط و بعها سوت بلوك", "not_interested"],
      ["غير مهتمة", "not_interested"],
      ["not ready hasn't bought the land yet", "not_ready"],
      ["لا لا مو الحين بعد اشهر", "not_ready"],
      [
        "Not interested. He filled out the form by mistake.",
        "applied_by_mistake",
      ],
      ["بلغلط ما عندي مشروغ", "applied_by_mistake"],
      ["Invalid number", "bad_number"],
      ["الرقم طويل جربت احذف واحد", "bad_number"],
      [
        "Not interested. He already agreed with another company.",
        "went_elsewhere",
      ],
      ["في الدمام و بدها بناء مشكلة مسافة", "distance"],
      ["لا يرد", "unreachable"],
      ["Assigned to client.", "unclassified"],
    ];
    for (const [note, expected] of cases)
      expect([note, await key("Other", note)]).toEqual([note, expected]);
    expect(await key("Distance Issue", "He is in Abha")).toBe("distance");
    expect(await key("Financial Issue", "overpriced")).toBe("financial");
    expect(await key("Unreachable", "no answer")).toBe("unreachable");
    expect(await key("Has a setup issue", "Wrong number.")).toBe("setup_issue");
  });
});

describe("the migration text", () => {
  test("every function has an empty search path and the browser grant is explicit", () => {
    const fns =
      SQL.match(
        /CREATE OR REPLACE FUNCTION public\.[a-z_]+\([^)]*\)[^$]*?AS \$\$/g,
      ) ?? [];
    expect(fns.length).toBe(8);
    for (const f of fns) expect(f).toContain("SET search_path=''");
    expect(SQL).toContain(
      "REVOKE ALL ON FUNCTION public.cockpit_client_calls(text,date,date) FROM PUBLIC,anon,service_role;",
    );
    expect(SQL).toContain(
      "GRANT EXECUTE ON FUNCTION public.cockpit_client_calls(text,date,date) TO authenticated;",
    );
    expect(SQL).not.toMatch(/GRANT [^;]* TO (anon|PUBLIC|service_role)/);
    expect(SQL).not.toMatch(/[—]/);
  });
  test("its five-minute line is the gate in kpi.ts", () => {
    expect(SQL).toContain(`interval '${FIRST_CALL_MINUTES} minutes'`);
    expect(CHATS_SQL).toContain(`interval '${FIRST_CALL_MINUTES} minutes'`);
  });
  test("the WhatsApp chat migration replaces one function and keeps its grant", () => {
    const fns =
      CHATS_SQL.match(
        /CREATE OR REPLACE FUNCTION public\.[a-z_]+\([^)]*\)[^$]*?AS \$\$/g,
      ) ?? [];
    expect(fns.length).toBe(1);
    expect(fns[0]).toContain("public.cockpit_client_calls(");
    expect(fns[0]).toContain("SET search_path=''");
    expect(CHATS_SQL).toContain(
      "GRANT EXECUTE ON FUNCTION public.cockpit_client_calls(text,date,date) TO authenticated;",
    );
    expect(CHATS_SQL).not.toMatch(/GRANT [^;]* TO (anon|PUBLIC|service_role)/);
    expect(CHATS_SQL).not.toMatch(/[—]/);
  });
});
