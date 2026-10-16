/**
 * The Client Performance board's business facts (migration
 * 20261016111157_board_facts.sql) on an isolated PostgreSQL.
 *
 * The dialer's helpers and views below are the live definitions read from
 * Creative Triage on 2026-10-16 (cc_leads, cc_attempts, cc_calls, cc_people,
 * cc_clients, cc_appointments, cc_results, cc_call_backlog,
 * call_center_events, cc_totals and mahara_call_center_report itself), so the
 * dials and leads called are checked against the dialer's own report, and the
 * waiting figures against cockpit_client_calls run side by side. Every
 * client, lead, call, booking and sheet row is invented. cc_phone's Arabic
 * digits are written as U& escapes: Bun rewrites non-ASCII characters inside
 * String.raw as \u escapes, which PostgreSQL would read as text.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { USD_PER } from "../../../hermes/ceo-refresh/native/data/tap.js";
import { calendarKind } from "../../../hermes/ceo-refresh/native/data/triage.js";
import {
  actor,
  cockpitTestDb,
  member,
  migration,
  owner,
} from "./lib/cockpitTestDb";

const FILE = "20261016111157_board_facts.sql";
const SQL = migration(FILE);
/** The corrections after the second-source check of 2026-10-16, applied on top. */
const CHECKED = migration("20261016210000_board_facts_checked.sql");
const TIES = migration("20261016210200_board_account_ties.sql");

const BUYER = "00000000-0000-4000-8000-0000000000b1";
const LOC_A = "locBoardClientA00001";
const LOC_B = "locBoardClientB00002";
const LOC_C = "locBoardClientC00003";
const LOC_X = "locBoardClientX00004";
const AGENT = "agent1@maharamedia.com";
const CAL_MAIN = "calMainA";
const CAL_ONLINE = "calOnlineA";
const CAL_PROV = "calProvA";
const CAL_CB = "calCallbackA";
const CAL_B_MAIN = "calMainB";

/** Kuwait calendar days: kd(n) is n days before today; kt(n, "HH:MM") a Kuwait wall time on it. */
const DAY = 86400_000;
const kuwaitNow = new Date(Date.now() + 3 * 3600_000);
const today = kuwaitNow.toISOString().slice(0, 10);
const dayShift = (d: string, n: number) =>
  new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const kd = (n: number) => dayShift(today, -n);
const kt = (n: number, hhmm: string) =>
  new Date(`${kd(n)}T${hhmm}:00+03:00`).toISOString();
const ms = (iso: string) => Date.parse(iso);
const FROM = kd(9);
/** The sheet's month tab that holds the window's first day, e.g. "Oct 26". */
const TAB = (() => {
  const d = new Date(`${FROM}T12:00:00Z`);
  return `${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${String(d.getUTCFullYear()).slice(2)}`;
})();

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

const DIALER = String.raw`
CREATE SCHEMA mahara_reporting; CREATE SCHEMA mahara_console; CREATE SCHEMA portal_data;
CREATE TABLE public.ghl_clients(location_id text PRIMARY KEY, client_name text, status text, clickup_id text,
 meta_ad_account text, country text, service_mode text, tiktok_ad_account text, synced_at timestamptz DEFAULT now());
CREATE TABLE public.clients(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, meta_ad_account_id text, ghl_location_id text,
 platform text DEFAULT 'meta', tiktok_advertiser_id text, hidden_from_dashboard boolean DEFAULT false);
CREATE TABLE public.ghl_client_ad_accounts(location_id text, client_id uuid, matched_by text);
CREATE TABLE public.cockpit_campaigns(id bigserial PRIMARY KEY, meta_account_id text, meta_campaign_id text, client_name text,
 source_deleted boolean DEFAULT false);
CREATE TABLE public.client_leads(ghl_contact_id text PRIMARY KEY, location_id text, created_at timestamptz, channel text,
 ad_id text, campaign_id text, contact_name text, contact_phone text, deleted boolean, attribution_raw jsonb, synced_at timestamptz DEFAULT now());
CREATE TABLE public.cockpit_people(id bigserial PRIMARY KEY, name text, email text, role text, active boolean, schedule jsonb);
CREATE TABLE public.cockpit_media_daily_stats(source_deployment text, source_id text, campaign_name text, day date, data jsonb);
CREATE TABLE public.client_opportunities(opportunity_id text PRIMARY KEY, location_id text, contact_id text, stage_id text,
 status text, created_at timestamptz, last_stage_change_at timestamptz);
CREATE TABLE public.ghl_pipelines(location_id text, pipeline_id text, pipeline_name text, stage_id text, stage_name text, position integer);
CREATE TABLE public.appointments(ghl_appointment_id text PRIMARY KEY, ghl_contact_id text, ghl_location_id text, ghl_location text,
 calendar_id text, contact_phone text, booked_at timestamptz, start_at timestamptz, status text, attended boolean,
 attended_source text, ghl_source text, updated_at timestamptz DEFAULT now());
CREATE TABLE public.ghl_calendars(location_id text, calendar_id text, name text, synced_at timestamptz DEFAULT now());
CREATE TABLE public.lead_sync_state(location_id text PRIMARY KEY, last_synced_at timestamptz, last_status text, last_error text);
CREATE TABLE public.appointment_sync_state(location_id text PRIMARY KEY, last_synced_at timestamptz, last_status text);
CREATE TABLE public.cockpit_csm_sources(table_name text, source_id text, client_names text[], data jsonb, source_snapshot_at timestamptz DEFAULT now());
CREATE TABLE public.cockpit_sync_state(key text PRIMARY KEY, last_run_at timestamptz, last_ok_at timestamptz,
 ok boolean NOT NULL DEFAULT false, note text, rows_seen integer, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE mahara_reporting.facts(namespace text, source text, kind text, external_id text, version_at timestamptz,
 captured_at timestamptz DEFAULT now(), data jsonb, conflict boolean DEFAULT false, PRIMARY KEY(namespace,source,kind,external_id));
CREATE TABLE mahara_reporting.sync_jobs(namespace text, id text, source text, location_id text, kind text, last_success timestamptz, error text);
CREATE TABLE mahara_reporting.sheet_snapshots(namespace text, id text, name text, sheet_id text, active boolean, data jsonb,
 checked_at timestamptz, error text);
CREATE TABLE mahara_reporting.call_detail_backfills(namespace text, state text, last_success timestamptz, error text);
CREATE TABLE mahara_console.attempts(namespace text, id text, lead_key text, agent text, state text, data jsonb, updated bigint);
CREATE TABLE mahara_console.metadata(namespace text, id text, data jsonb);
CREATE TABLE portal_data.appointment_outcomes(location_id text, appointment_id text, revision bigint, attendance text, deal text,
 quotation boolean, project_value numeric, currency text, lead_quality numeric, source text, captured_at timestamptz DEFAULT now(),
 PRIMARY KEY(location_id, appointment_id, revision));

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

create or replace view mahara_reporting.cc_clients with (security_invoker=true) as
 select g.location_id id,g.client_name name,g.country,g.status,coalesce(s.active,false) active
 from public.ghl_clients g left join mahara_reporting.sheet_snapshots s on s.namespace='production' and s.id=g.location_id
 where s.id is not null or exists(select 1 from mahara_reporting.facts f where f.namespace='production' and f.kind='location' and f.data->>'locationId'=g.location_id);

create or replace view mahara_reporting.cc_appointments with (security_invoker=true) as
 with records as (
  select coalesce(nullif(ghl_location_id,''),nullif(ghl_location,'')) location_id,ghl_appointment_id id,ghl_contact_id contact_id,calendar_id,
   booked_at,start_at,status,updated_at version_at,0 priority,false conflict from public.appointments
  union all
  select location_id,data->'bookingVerification'->>'id',contact_id,data->'bookingVerification'->>'calendarId',
   mahara_reporting.cc_time(data->'bookingVerification'->>'verifiedAt'),mahara_reporting.cc_time(data->'bookingVerification'->>'startTime'),
   data->'bookingVerification'->>'appointmentStatus',mahara_reporting.cc_time(data->'bookingVerification'->>'verifiedAt'),2,false
  from mahara_reporting.cc_attempts where data->'disposition'->>'outcome'='BOOKED' and data->'bookingVerification'->>'verifiedAt' is not null
  union all
  select data->>'locationId',data->>'id',data->>'contactId',data->>'calendarId',mahara_reporting.cc_time(data->>'bookedAt'),mahara_reporting.cc_time(data->>'startAt'),
   case when coalesce(data->>'deleted','false')='true' or coalesce(data->>'missingFromProvider','false')='true' then 'deleted' else data->>'status' end,
   version_at,1,conflict
  from mahara_reporting.facts where namespace='production' and kind='appointment' and source='ghl'),
 latest as (select distinct on (location_id,id) * from records
  where location_id is not null and id is not null and not exists(select 1 from public.appointments g where g.ghl_appointment_id=records.id and g.ghl_source='google_calendar')
  order by location_id,id,version_at desc nulls last,priority),
 calendars as (select distinct on (location_id,calendar_id) location_id,calendar_id,name,synced_at from (
  select location_id,calendar_id,name,synced_at from public.ghl_calendars
  union all select data->>'locationId',data->>'id',data->>'name',version_at from mahara_reporting.facts where namespace='production' and kind='calendar') c
  order by location_id,calendar_id,synced_at desc nulls last)
 select a.location_id,a.id,a.contact_id,a.calendar_id,a.booked_at,a.start_at,a.status,a.version_at,a.priority,a.conflict,c.name calendar_name,
  case when lower(c.name) ~ 'callback|call-back|reschedul' then 'excluded'
       when lower(c.name) ~ 'not confirmed|provisional|tentative' then 'provisional'
       when lower(c.name) ~ 'appointment calendar|main appointment' then case when lower(a.status) in ('new','unconfirmed') then 'provisional' else 'confirmed' end
       else 'unclassified' end booking_kind
 from latest a left join calendars c on c.location_id=a.location_id and c.calendar_id=a.calendar_id;

create or replace view mahara_reporting.cc_results with (security_invoker=true) as
 with names as (select lower(trim(name)) name,min(email) email from mahara_reporting.cc_people group by 1 having count(*)=1),
 rows as (select s.id location_id,s.checked_at,coalesce(nullif(r.value->>'currency',''),s.data->>'currency') currency,r.value r,
  mahara_reporting.cc_phone(r.value->>'phone',c.country) phone,mahara_reporting.cc_time(r.value->>'meeting') meeting,n.email agent
  from mahara_reporting.sheet_snapshots s cross join lateral jsonb_array_elements(s.data->'rows') r(value)
  left join mahara_reporting.cc_clients c on c.id=s.id left join names n on n.name=lower(trim(r.value->>'caller'))
  where s.namespace='production' and s.data->>'sheetId'=s.sheet_id),
 grouped as (select location_id,phone,meeting,min(agent) agent,min(currency) currency,max(checked_at) checked_at,
  min(r->>'show') attendance,min(r->>'closed') closed,min(r->>'confirmed') confirmed,min((r->>'value')::numeric) value,
  count(distinct jsonb_build_array(r->'show',r->'closed',r->'confirmed',r->'value',currency,agent))>1 conflict
  from rows where phone is not null and meeting is not null and meeting<=now() and coalesce(mahara_reporting.cc_time(r->>'added')<=now(),true)
  group by location_id,phone,meeting),
 phones as (select location_id,phone,min(contact_id) contact_id from mahara_reporting.cc_leads where phone is not null group by 1,2 having count(*)=1),
 matched as (select g.*,l.contact_id from grouped g left join phones l on l.location_id=g.location_id and l.phone=g.phone)
 select location_id,phone,meeting,agent,currency,checked_at,attendance,closed,confirmed,value,conflict,contact_id,
  case when closed='Y' and not conflict then row_number() over (partition by location_id,coalesce(contact_id,phone),closed,conflict order by meeting) end project_rank,
  (min(value) over w is distinct from max(value) over w or min(agent) over w is distinct from max(agent) over w
   or min(coalesce(currency,'')) over w is distinct from max(coalesce(currency,'')) over w) project_conflict
 from matched window w as (partition by location_id,coalesce(contact_id,phone),closed);

create or replace view mahara_reporting.cc_call_backlog with (security_invoker=true) as
 with phones as (select phone,count(*) n from mahara_reporting.cc_leads where phone is not null group by phone)
 select c.id,c.started_at,c.agent,right(mahara_reporting.cc_phone(c.data->>'phone'),4) phone_last4,coalesce(p.n,0::bigint) candidates,
  case when c.agent is null then 'missing_identity' when c.attribution='conflicting_link' then 'conflicting_link'
       when mahara_reporting.cc_phone(c.data->>'phone') is null then 'missing_phone' when p.n>1 then 'ambiguous_phone' else 'no_contact' end reason
 from mahara_reporting.cc_calls c left join phones p on p.phone=mahara_reporting.cc_phone(c.data->>'phone')
 where c.location_id is null and c.data->>'type'='outbound';

create or replace view mahara_reporting.call_center_events with (security_invoker=true) as
 with leads as materialized (select location_id,contact_id,created_at,phone from mahara_reporting.cc_leads),
 calls as materialized (select id,data,conflict,started_at,agent,duration,ringing,location_id,contact_id,attribution from mahara_reporting.cc_calls),
 roster as materialized (select email,name,schedule from mahara_reporting.cc_people),
 uncertain_days as (select distinct (started_at at time zone 'Asia/Kuwait')::date d from calls where agent is null),
 working as materialized (select c.*,p.schedule,mahara_reporting.cc_day(p.schedule,c.started_at) working_day,
  case when c.duration is not null and c.ringing is not null then mahara_reporting.cc_window(p.schedule,mahara_reporting.cc_day(p.schedule,c.started_at)) end working_window,
  (u.d is not null) uncertain_day
  from calls c left join roster p on p.email=c.agent left join uncertain_days u on u.d=(c.started_at at time zone 'Asia/Kuwait')::date),
 eligible as materialized (select w.*,coalesce((not w.conflict and w.agent is not null and w.data->>'type'='outbound'
  and w.data->>'state'=any(array['completed','no_answer','busy','failed','blocked','timedout','rejected','canceled'])
  and w.duration is not null and w.ringing is not null and w.working_window is not null and not lower_inf(w.working_window)
  and w.working_window @> w.started_at and not w.uncertain_day),false) gap_eligible from working w),
 segments as (select e.*,sum(case when e.gap_eligible then 0 else 1 end) over (partition by e.agent,e.working_day order by e.started_at,e.id) segment from eligible e),
 previous_calls as (select s.*,max(case when s.gap_eligible then s.started_at+make_interval(secs=>(s.duration+s.ringing)::double precision) end)
  over (partition by s.agent,s.working_day,s.segment order by s.started_at,s.id rows between unbounded preceding and 1 preceding) previous_end from segments s),
 gaps as (select p.*,case when p.gap_eligible and p.previous_end is not null then greatest(0::numeric,extract(epoch from p.started_at-p.previous_end)) end gap_seconds from previous_calls p),
 first_calls as (select distinct on (l.location_id,l.contact_id) l.location_id,l.contact_id,c.started_at,c.agent,c.id
  from leads l join calls c on c.location_id=l.location_id and c.contact_id=l.contact_id and c.started_at>=l.created_at
  where not c.conflict and c.agent is not null and c.data->>'type'='outbound' order by l.location_id,l.contact_id,c.started_at,c.id),
 connected as (select l.location_id,l.contact_id,min(c.started_at) connected_at
  from leads l join calls c on c.location_id=l.location_id and c.contact_id=l.contact_id and c.started_at>=l.created_at
  where not c.conflict and c.agent is not null and c.data->>'type'='outbound' and c.data->>'state'='completed' and c.duration>0 group by 1,2),
 bookers as (select location_id,coalesce(data->'bookingVerification'->>'id',appointment_id) id,case when count(distinct agent)=1 then min(agent) end agent
  from mahara_reporting.cc_attempts where data->'disposition'->>'outcome'='BOOKED' and data->'bookingVerification'->>'verifiedAt' is not null group by 1,2),
 sheet_bookers as (select a.location_id,a.id,case when count(distinct r.agent)=1 then min(r.agent) end agent
  from mahara_reporting.cc_appointments a join mahara_reporting.cc_results r on r.location_id=a.location_id and r.contact_id=a.contact_id and r.meeting=a.start_at and not r.conflict
  group by 1,2)
 select 'lead'::text kind,l.location_id||':'||l.contact_id event_id,l.created_at event_at,l.location_id,f.agent,l.contact_id,
  jsonb_build_object('firstDialAt',f.started_at,'firstConnectedAt',cn.connected_at,'speedSeconds',mahara_reporting.cc_work_seconds(p.schedule,l.created_at,f.started_at),'callId',f.id) data
 from leads l join mahara_reporting.cc_clients c on c.id=l.location_id left join first_calls f on f.location_id=l.location_id and f.contact_id=l.contact_id
  left join connected cn on cn.location_id=l.location_id and cn.contact_id=l.contact_id left join roster p on p.email=f.agent
 where l.created_at is not null
 union all
 select 'call',g.id,g.started_at,g.location_id,g.agent,g.contact_id,jsonb_build_object('type',g.data->>'type','state',g.data->>'state','duration',g.duration,
  'excluded',(g.conflict or g.agent is null),'gapSeconds',g.gap_seconds,'attribution',g.attribution) from gaps g
 union all
 select 'outcome',a.id,a.outcome_at,a.location_id,a.agent,a.contact_id,jsonb_build_object('outcome',a.data->'disposition'->>'outcome')
 from mahara_reporting.cc_attempts a where a.outcome_at is not null
 union all
 select 'booking',a.location_id||':'||a.id,a.booked_at,a.location_id,case when b.id is not null then b.agent else s.agent end,a.contact_id,
  jsonb_build_object('bookingKind',a.booking_kind,'status',a.status,'calendarId',a.calendar_id)
 from mahara_reporting.cc_appointments a join mahara_reporting.cc_clients c on c.id=a.location_id
  left join bookers b on b.location_id=a.location_id and b.id=a.id left join sheet_bookers s on s.location_id=a.location_id and s.id=a.id
 where a.booked_at is not null and not a.conflict and a.booking_kind<>'excluded' and a.status<>'deleted'
  and not exists(select 1 from mahara_reporting.cc_attempts r where r.location_id=a.location_id and r.appointment_id=a.id
   and r.data->'disposition'->>'outcome'='RESCHEDULE' and nullif(r.data->>'originalAppointmentId','') is not null)
 union all
 select 'result',r.location_id||':'||r.phone||':'||r.meeting::text,r.meeting,r.location_id,r.agent,r.contact_id,
  jsonb_build_object('show',r.attendance,'closed',r.closed,'project',(r.project_rank=1 and not r.project_conflict),'value',r.value,'currency',r.currency,
   'conflict',(r.conflict or (coalesce(r.confirmed,'')='C' and coalesce(r.attendance,'')='Y')))
 from mahara_reporting.cc_results r;

create or replace function mahara_reporting.cc_totals(events jsonb) returns jsonb
language sql stable set search_path=pg_catalog as $$
 with e as (select * from jsonb_to_recordset(events) as x(kind text,event_id text,location_id text,agent text,contact_id text,data jsonb)),
 sums as (select
 count(*) filter(where kind='outcome') dials,
 count(*) filter(where kind='call' and data->>'type'='outbound' and data->>'excluded'='false') provider_dials,
 count(*) filter(where kind='call' and data->>'type'='outbound' and data->>'excluded'='false' and data->>'state'='completed' and (data->>'duration')::numeric>0) connections,
 coalesce(sum((data->>'duration')::numeric) filter(where kind='call' and data->>'type'='outbound' and data->>'excluded'='false' and data->>'state'='completed'),0) talk_seconds,
 count(*) filter(where kind='lead') leads,
 count(*) filter(where kind='lead' and data->>'firstDialAt' is not null) dialed,
 count(*) filter(where kind='lead' and data->>'firstConnectedAt' is not null) contacted,
 count(*) filter(where kind='booking' and data->>'bookingKind'='confirmed') confirmed,
 count(*) filter(where kind='booking' and data->>'bookingKind'='provisional') provisional,
 count(*) filter(where kind='booking' and data->>'bookingKind'='unclassified') unclassified,
 count(*) filter(where kind='result' and data->>'conflict'='false' and data->>'show'='Y') shows,
 count(*) filter(where kind='result' and data->>'conflict'='false' and data->>'show'='N') no_show,
 count(*) filter(where kind='result' and data->>'conflict'='false' and data->>'closed'='Y' and data->>'project'='true') closed,
 avg((data->>'speedSeconds')::numeric) filter(where kind='lead') speed,
 percentile_cont(.5) within group(order by (data->>'speedSeconds')::numeric) filter(where kind='lead') median_speed,
 count(*) filter(where kind='lead' and data->>'speedSeconds' is not null) speed_samples,
 count(*) filter(where kind='lead' and (data->>'speedSeconds')::numeric<=120) within_two,
 avg((data->>'gapSeconds')::numeric) filter(where kind='call') gap,
 count(*) filter(where kind='call' and data->>'gapSeconds' is not null) gap_samples,
 count(*) filter(where kind='call' and data->>'type'='outbound' and data->>'excluded'='false' and location_id is null) unlinked,
 count(*) filter(where kind='result' and data->>'conflict'='true') conflicts
 from e), money as (select data->>'currency' currency,sum((data->>'value')::numeric) value from e
 where kind='result' and data->>'conflict'='false' and data->>'closed'='Y' and data->>'project'='true' and data->>'value' is not null group by data->>'currency' having data->>'currency' ~ '^[A-Z]{3}$' or count(distinct location_id)=1)
 select jsonb_build_object('dials',dials,'providerDials',provider_dials,'connections',connections,'talkSeconds',talk_seconds,
 'leads',leads,'leadsDialed',dialed,'leadsContacted',contacted,'noVerifiedDial',leads-dialed,
 'confirmedBookings',confirmed,'provisionalBookings',provisional,'unclassifiedBookings',unclassified,
 'shows',shows,'noShow',no_show,'closed',closed,'showRate',shows::numeric/nullif(shows+no_show,0),'closeRate',closed::numeric/nullif(shows,0),
 'connectionRate',connections::numeric/nullif(provider_dials,0),'avgSpeedSeconds',speed,'medianSpeedSeconds',median_speed,'speedSamples',speed_samples,
 'withinTwoMinutes',within_two,'withinTwoMinutesRate',within_two::numeric/nullif(leads,0),
 'avgCallGapSeconds',gap,'callGapSamples',gap_samples,'unlinkedCalls',unlinked,'conflictingResults',conflicts,
 'values',coalesce((select jsonb_agg(to_jsonb(money)) from money),'[]'::jsonb)) from sums;
$$;

create or replace function public.mahara_call_center_report(p_from date,p_to date,p_agent text default null,p_client text default null) returns jsonb
language plpgsql stable set search_path=pg_catalog,mahara_reporting as $$
declare start_at timestamptz; end_at timestamptz; rows jsonb; report jsonb;
begin
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>92 or p_to>(now() at time zone 'Asia/Kuwait')::date then raise exception 'Choose a valid date range of up to 93 days'; end if;
 if length(coalesce(p_agent,''))>254 or length(coalesce(p_client,''))>100 then raise exception 'Invalid report filter'; end if;
 start_at:=p_from::timestamp at time zone 'Asia/Kuwait'; end_at:=least((p_to+1)::timestamp at time zone 'Asia/Kuwait',now());
 execute 'select coalesce(jsonb_agg(to_jsonb(e)),''[]''::jsonb) from mahara_reporting.call_center_events e where event_at >= $1 and event_at < $2'
  ||case when nullif(trim(p_agent),'') is not null then ' and e.agent=$3' else '' end
  ||case when nullif(trim(p_client),'') is not null then ' and e.location_id=$4' else '' end
 into rows using start_at,end_at,lower(trim(p_agent)),p_client;
 with e as (select * from jsonb_to_recordset(rows)as x(kind text,event_id text,event_at timestamptz,location_id text,agent text,contact_id text,data jsonb)),
 callers as (select agent,mahara_reporting.cc_totals(jsonb_agg(to_jsonb(e))) metrics from e group by agent),
 clients as (select location_id,mahara_reporting.cc_totals(jsonb_agg(to_jsonb(e))) metrics from e group by location_id),
 days as (select (event_at at time zone 'Asia/Kuwait')::date as report_day,mahara_reporting.cc_totals(jsonb_agg(to_jsonb(e))) metrics from e group by 1)
 select jsonb_build_object('version',1,'source','mahara_reporting.call_center_events','generatedAt',now(),'timezone','Asia/Kuwait','from',p_from,'to',p_to,
 'overall',mahara_reporting.cc_totals(rows),
 'callers',coalesce((select jsonb_agg(c.metrics||jsonb_build_object('email',c.agent,'name',coalesce(p.name,c.agent,'Unattributed')) order by c.agent nulls last) from callers c left join mahara_reporting.cc_people p on p.email=c.agent),'[]'::jsonb),
 'clients',coalesce((select jsonb_agg(coalesce(c.metrics,mahara_reporting.cc_totals('[]'))||jsonb_build_object('id',p.id,'name',p.name) order by p.name)
 from mahara_reporting.cc_clients p left join clients c on c.location_id=p.id where (p.active or c.location_id is not null) and (nullif(trim(p_client),'') is null or p.id=p_client)),'[]'::jsonb),
 'daily',(select jsonb_agg(coalesce(d.metrics,mahara_reporting.cc_totals('[]'))||jsonb_build_object('day',t.day::date) order by t.day desc) from generate_series(p_from::timestamp,p_to::timestamp,interval '1 day')t(day) left join days d on d.report_day=t.day::date),
 'reconciliation',(with b as materialized(select * from mahara_reporting.cc_call_backlog where started_at>=start_at and started_at<end_at and (nullif(trim(p_agent),'') is null or agent=lower(trim(p_agent)))) select jsonb_build_object('total',(select count(*) from b),'byReason',coalesce((select jsonb_agg(to_jsonb(x)) from (select reason,count(*) count from b group by reason)x),'[]'),'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'at',started_at,'agent',agent,'reason',reason,'phoneLast4',phone_last4,'candidates',candidates)) from (select * from b order by started_at desc,id limit 20)x),'[]'),'backfill',(select jsonb_build_object('pending',count(*)filter(where state='pending'),'completed',count(*)filter(where state='complete'),'lastSuccess',max(last_success),'error',max(error)) from mahara_reporting.call_detail_backfills where namespace='production'))),
 'coverage',jsonb_build_object(
 'leadSyncAt',(select max(synced_at) from public.client_leads),
 'appointmentSyncAt',(select max(updated_at) from public.appointments),
 'callSyncAt',(select max(captured_at) from mahara_reporting.facts where namespace='production' and source='maqsam' and kind='call'),
 'sheetSyncAt',(select min(checked_at) from mahara_reporting.sheet_snapshots where namespace='production' and active),
 'sheetErrors',(select count(*) from mahara_reporting.sheet_snapshots where namespace='production' and active and (data is null or error is not null)),
 'unattributedEvents',(select count(*) from e where agent is null)),
 'warnings','[]'::jsonb) into report;
 return report;
end $$;

-- pg_cron, only as far as the migration touches it.
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigserial PRIMARY KEY, jobname text, schedule text, command text, active boolean DEFAULT true);
CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS
 $$ INSERT INTO cron.job(jobname,schedule,command) VALUES (n,s,c) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(id bigint) RETURNS boolean LANGUAGE sql AS
 $$ DELETE FROM cron.job WHERE jobid=id RETURNING true $$;
`;

let db: PGlite;

type Row = Record<string, unknown>;
async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(text, params)).rows;
}
async function refresh(from = FROM, to = today) {
  await owner(db);
  return (
    await q<{ r: Row }>(
      "SELECT public.cockpit_board_facts_refresh($1,$2) AS r",
      [from, to],
    )
  )[0].r;
}
async function dayRow(loc: string, day: string) {
  await owner(db);
  return (
    await q<Row>(
      "SELECT *, revenue_usd::float AS revenue, lead_quality_sum::float AS lq_sum FROM public.cockpit_client_days WHERE location_id=$1 AND day=$2",
      [loc, day],
    )
  )[0];
}
async function sum(loc: string, column: string) {
  await owner(db);
  if (!/^[a-z_]+$/.test(column)) throw new Error("bad column");
  return Number(
    (
      await q<{ n: string | null }>(
        `SELECT sum(${column}) AS n FROM public.cockpit_client_days WHERE location_id=$1 AND day BETWEEN $2 AND $3`,
        [loc, FROM, today],
      )
    )[0].n ?? 0,
  );
}

async function lead(id: string, loc: string, created: string, extra: Row = {}) {
  await q(
    "INSERT INTO public.client_leads(ghl_contact_id,location_id,created_at,channel,ad_id,campaign_id,contact_phone,deleted,attribution_raw) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)",
    [
      id,
      loc,
      created,
      extra.channel ?? "Meta",
      extra.ad ?? null,
      extra.campaign ?? null,
      extra.phone ?? null,
      extra.deleted ?? false,
      extra.attribution ? JSON.stringify(extra.attribution) : null,
    ],
  );
  if (extra.tags)
    await q(
      "INSERT INTO mahara_reporting.facts(namespace,source,kind,external_id,data) VALUES('production','ghl','contact',$1,$2::jsonb)",
      [
        `${loc}:${id}`,
        JSON.stringify({
          id,
          locationId: loc,
          createdAt: created,
          phone: extra.phone ?? null,
          tags: extra.tags,
        }),
      ],
    );
}
async function appt(id: string, loc: string, extra: Row) {
  await q(
    `INSERT INTO public.appointments(ghl_appointment_id,ghl_contact_id,ghl_location_id,calendar_id,contact_phone,booked_at,start_at,status,attended,attended_source,ghl_source)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      extra.contact ?? null,
      loc,
      extra.calendar ?? CAL_MAIN,
      extra.phone ?? null,
      extra.booked,
      extra.start,
      extra.status ?? "confirmed",
      extra.attended ?? null,
      extra.attended === undefined || extra.attended === null ? null : "sheet",
      extra.source ?? null,
    ],
  );
}
async function outcome(
  loc: string,
  appointment: string,
  revision: number,
  extra: Row,
) {
  await q(
    "INSERT INTO portal_data.appointment_outcomes(location_id,appointment_id,revision,attendance,deal,quotation,project_value,currency,lead_quality,source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'portal')",
    [
      loc,
      appointment,
      revision,
      extra.attendance ?? null,
      extra.deal ?? null,
      extra.quotation ?? null,
      extra.value ?? null,
      extra.currency ?? null,
      extra.lq ?? null,
    ],
  );
}
async function call(
  id: string,
  phone: string,
  at: string,
  state = "completed",
  duration = 60,
) {
  await q(
    "INSERT INTO mahara_reporting.facts(namespace,source,kind,external_id,data) VALUES('production','maqsam','call',$1,$2::jsonb)",
    [
      id,
      JSON.stringify({
        id,
        type: "outbound",
        phone,
        state,
        duration,
        ringingTime: 5,
        timestamp: at,
        agents: [{ name: "Agent One", email: AGENT }],
      }),
    ],
  );
}
async function attempt(
  id: string,
  loc: string,
  contact: string,
  outcomeName: string,
  note: string,
  savedAt: string,
  extra: Row = {},
) {
  await q(
    "INSERT INTO mahara_console.attempts VALUES('production',$1,$2,$3,'closed',$4::jsonb,$5)",
    [
      id,
      `${loc}:${contact}`,
      AGENT,
      JSON.stringify({
        locationId: loc,
        contactId: contact,
        mode: extra.mode ?? "outcome",
        dispositionSavedAt: ms(savedAt),
        disposition: { outcome: outcomeName, note },
        ...(extra.booking ? { bookingVerification: extra.booking } : {}),
      }),
      ms(savedAt),
    ],
  );
}
async function provisionalFact(
  id: string,
  loc: string,
  contact: string,
  booked: string,
  start: string,
  extra: Row = {},
) {
  await q(
    "INSERT INTO mahara_reporting.facts(namespace,source,kind,external_id,version_at,data) VALUES('production','ghl','appointment',$1,$2,$3::jsonb)",
    [
      `${loc}:${id}`,
      booked,
      JSON.stringify({
        id,
        locationId: loc,
        contactId: contact,
        calendarId: extra.calendar ?? CAL_PROV,
        bookedAt: booked,
        startAt: start,
        status: extra.status ?? "confirmed",
        deleted: extra.deleted ?? false,
      }),
    ],
  );
}

// The scenario. Client A (DFY) fills everything; Client B (DWY) only the
// portal; Client C nothing at all; Client X is cancelled.
const AP = {
  showedSheet: { start: kt(2, "12:00"), booked: kt(3, "11:00") },
  noshowCrm: { start: kt(2, "13:00"), booked: kt(3, "12:00") },
  showedPortal: { start: kt(2, "14:00"), booked: kt(3, "13:00") },
  unmarked: { start: kt(2, "15:00"), booked: kt(3, "14:00") },
  google: { start: kt(2, "16:00"), booked: kt(3, "15:00") },
  online: { start: kt(1, "10:00"), booked: kt(2, "09:00") },
  statusNew: { start: kt(1, "09:00"), booked: kt(1, "07:00") },
};

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  const allowed = migration("20260926m_cockpit_csm_state.sql").match(
    /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed\(p_name text\)[\s\S]*?END \$\$;/,
  );
  expect(allowed).not.toBeNull();
  await db.exec(allowed![0]);
  await db.exec(DIALER);
  await member(db, BUYER, "buyer@tests.invalid", ["media_buyer"]);
  await owner(db);

  await db.exec(`
    INSERT INTO public.ghl_clients(location_id,client_name,status,clickup_id,meta_ad_account,country,service_mode,tiktok_ad_account) VALUES
     ('${LOC_A}','Client A','Active','CU_A','Client A ads','KW','DFY',NULL),
     ('${LOC_B}','Client B','Active','CU_B',NULL,'SA','dwy',NULL),
     ('${LOC_C}','Client C','Launching','CU_C',NULL,'KW',NULL,'Client C TikTok'),
     ('${LOC_X}','Old client','Cancelled','CU_X',NULL,'KW','DFY',NULL);
    INSERT INTO public.clients(name,meta_ad_account_id,ghl_location_id,hidden_from_dashboard) VALUES
     ('Client A ads','act_111111',NULL,false),
     ('Client A old account','act_333333','${LOC_A}',false),
     ('A hidden account','act_555555','${LOC_A}',true),
     ('MaharaMedia','act_666666','${LOC_A}',false),
     ('Old client ads','act_777777',NULL,false);
    INSERT INTO public.ghl_client_ad_accounts SELECT '${LOC_A}',id,'meta_exact' FROM public.clients WHERE name='Client A ads';
    INSERT INTO public.ghl_client_ad_accounts SELECT '${LOC_X}',id,'meta_exact' FROM public.clients WHERE name='Old client ads';
    INSERT INTO public.cockpit_campaigns(meta_account_id,meta_campaign_id,client_name,source_deleted) VALUES
     ('222222','CMPB','Client B',false),
     ('act_444444','CMPB2','client-b',true);
    INSERT INTO public.cockpit_people(name,email,role,active,schedule) VALUES
     ('Agent One','${AGENT}','Call centre agent',true,'${JSON.stringify(SCHEDULE)}');
    INSERT INTO mahara_console.metadata VALUES
     ('production','access:agent:${AGENT}','{"email":"${AGENT}","active":true,"locationIds":["${LOC_A}","${LOC_B}","${LOC_C}"]}'),
     ('production','identity:account:${AGENT}','{"email":"${AGENT}","role":"agent","enabled":true}');
    INSERT INTO public.ghl_calendars(location_id,calendar_id,name) VALUES
     ('${LOC_A}','${CAL_MAIN}','Main Appointment Calendar'),
     ('${LOC_A}','${CAL_ONLINE}','Online Appointment Calendar'),
     ('${LOC_A}','${CAL_PROV}','Not Confirmed Appointments'),
     ('${LOC_A}','${CAL_CB}','Callback Calendar'),
     ('${LOC_B}','${CAL_B_MAIN}','Main Appointment Calendar');
    INSERT INTO public.lead_sync_state VALUES ('${LOC_A}',now(),'success',NULL),('${LOC_B}',now(),'success',NULL);
    INSERT INTO public.appointment_sync_state VALUES ('${LOC_A}',now(),'success'),('${LOC_B}',now(),'success');
    INSERT INTO mahara_reporting.sync_jobs VALUES
     ('production','j1','ghl','${LOC_A}','appointments_recent',now(),NULL),
     ('production','j2','ghl','${LOC_B}','appointments_recent',now(),NULL),
     ('production','maqsam:${AGENT}','maqsam','${AGENT}','calls',now(),NULL),
     ('production','maqsam:gone@maharamedia.com','maqsam','gone@maharamedia.com','calls',now() - interval '30 days',NULL);
    INSERT INTO mahara_reporting.facts(namespace,source,kind,external_id,data) VALUES
     ('production','ghl','location','${LOC_B}','{"locationId":"${LOC_B}"}');
  `);

  // Client A's leads. Kuwait day 3: Meta with an ad, Meta without one, a
  // WhatsApp chat (no ad, tagged), a WhatsApp reply (another tag, kept), and a
  // deleted contact. Day 2: Other with an ad id.
  await lead("L1", LOC_A, kt(3, "10:00"), {
    ad: "AD1",
    campaign: "C1",
    phone: "+96550000001",
  });
  await lead("L2", LOC_A, kt(3, "23:30"), { phone: "+96550000002" });
  await lead("L3", LOC_A, kt(3, "02:00"), {
    channel: "Other",
    phone: "+96550000003",
    tags: ["inbound whatsapp"],
  });
  await lead("L4", LOC_A, kt(3, "12:00"), {
    channel: "Other",
    phone: "+966500000004",
    tags: ["another-device-replied-whatsapp"],
  });
  await lead("L5", LOC_A, kt(3, "13:00"), {
    phone: "+96550000005",
    deleted: true,
  });
  await lead("L6", LOC_A, kt(2, "09:00"), {
    channel: "Other",
    ad: "AD2",
    phone: "+971500000006",
  });
  // L7 came from an ad with no ad id on the contact, only Meta's click id.
  await lead("L7", LOC_A, kt(2, "11:00"), {
    phone: "+201000000007",
    attribution: { medium: "facebook", utmFbclid: "fbclid-L7" },
  });
  // L8 came in minutes ago (and always today in Kuwait, even just after midnight).
  await lead(
    "L8",
    LOC_A,
    new Date(
      Math.max(Date.now() - 20 * 60_000, Date.parse(`${today}T00:00:30+03:00`)),
    ).toISOString(),
    {
      phone: "+96550000008",
    },
  );
  await lead("L10", LOC_A, kt(4, "10:00"), { phone: "+96550000010" });
  await lead("L11", LOC_A, kt(5, "10:00"), { phone: "+96550000011" });
  await lead("Lold", LOC_A, new Date(Date.now() - 60 * DAY).toISOString(), {
    phone: "+96550000099",
  });
  // Client B shares L6's phone, so a call to it links to neither lead.
  await lead("B1", LOC_B, kt(2, "09:30"), {
    channel: "Other",
    phone: "+971500000006",
  });
  await lead("B2", LOC_B, kt(2, "10:00"), {
    ad: "ADB",
    campaign: "CB",
    phone: "+966500000002",
  });
  await lead("C1", LOC_C, kt(3, "10:00"), {
    ad: "ADC",
    campaign: "CC",
    phone: "+96550000031",
  });

  // Client A's appointments.
  await appt("AP1", LOC_A, {
    contact: "L10",
    phone: "+96550000010",
    ...AP.showedSheet,
    attended: true,
  });
  await appt("AP2", LOC_A, {
    contact: "L2",
    ...AP.noshowCrm,
    status: "noshow",
  });
  await appt("AP3", LOC_A, { contact: "L4", ...AP.showedPortal });
  await appt("AP4", LOC_A, { contact: "L1", ...AP.unmarked });
  await appt("AP5", LOC_A, {
    contact: "L1",
    start: kt(2, "17:00"),
    booked: kt(3, "16:00"),
    status: "cancelled",
  });
  await appt("AP6", LOC_A, {
    contact: "L1",
    start: kt(2, "18:00"),
    booked: kt(3, "17:00"),
    status: "invalid",
  });
  await appt("AP7", LOC_A, {
    contact: "GC1",
    ...AP.google,
    source: "google_calendar",
  });
  await appt("AP8", LOC_A, {
    contact: "L6",
    calendar: CAL_ONLINE,
    ...AP.online,
    attended: false,
  });
  await appt("AP9", LOC_A, {
    contact: "L6",
    calendar: CAL_CB,
    start: kt(1, "11:00"),
    booked: kt(2, "10:00"),
  });
  await appt("AP10", LOC_A, {
    contact: "L7",
    start: kt(-1, "10:00"),
    booked: kt(1, "08:00"),
  });
  await appt("AP11", LOC_A, {
    contact: "L11",
    phone: "+96550000011",
    ...AP.statusNew,
    status: "new",
  });
  // Client B: one meeting nobody marked, one the client reported won.
  await appt("BAP1", LOC_B, {
    contact: "B1",
    calendar: CAL_B_MAIN,
    start: kt(2, "10:00"),
    booked: kt(3, "10:00"),
  });
  await appt("BAP2", LOC_B, {
    contact: "B2",
    calendar: CAL_B_MAIN,
    start: kt(1, "10:00"),
    booked: kt(2, "11:00"),
  });

  // Portal outcomes: the latest revision wins; an out-of-range score and an
  // outcome on an appointment this database does not hold are left out.
  await outcome(LOC_A, "AP3", 1, { attendance: "no_show" });
  await outcome(LOC_A, "AP3", 2, {
    attendance: "showed",
    quotation: true,
    lq: 7,
    deal: "pending",
  });
  await outcome(LOC_A, "AP11", 1, {
    quotation: true,
    lq: 8,
    deal: "won",
    value: 5000,
    currency: "KWD",
  });
  await outcome(LOC_A, "AP1", 1, { quotation: false, lq: 11 });
  await outcome(LOC_A, "APX", 1, { attendance: "showed", lq: 9 });
  await outcome(LOC_B, "BAP2", 1, {
    attendance: "showed",
    quotation: false,
    deal: "won",
    value: 1000,
    currency: "USD",
    lq: 6,
  });

  // Provisional: one fact, one Google copy by contact and time, one deleted,
  // one cancelled, one with a Google copy's id, one dialer verified booking.
  await provisionalFact("P1", LOC_A, "L6", kt(2, "10:00"), kt(1, "11:00"));
  await provisionalFact("P2", LOC_A, "GC1", kt(2, "10:30"), AP.google.start);
  await provisionalFact("P3", LOC_A, "L7", kt(2, "11:00"), kt(1, "12:00"), {
    deleted: true,
  });
  await provisionalFact("P5", LOC_A, "L7", kt(2, "11:30"), kt(1, "13:00"), {
    status: "cancelled",
  });
  await provisionalFact("AP7", LOC_A, "GC1", kt(2, "12:00"), kt(1, "14:00"));

  // The dialer: calls and saved outcomes.
  await call("1001", "+96550000001", kt(3, "10:05"));
  // L3 is a WhatsApp chat the dialer still called.
  await call("1003", "+96550000003", kt(3, "10:10"));
  await call("1002", "+96550000001", kt(2, "10:00"), "no_answer", 0);
  await call("1006", "+971500000006", kt(2, "09:10"));
  await attempt("T1", LOC_A, "L4", "NO ANSWER", "No answer", kt(3, "12:30"));
  await attempt("T2", LOC_A, "L1", "CALLBACK", "Call tomorrow", kt(2, "11:00"));
  await attempt("T3", LOC_A, "Lold", "LOST", "", kt(2, "11:30"));
  await attempt(
    "T4",
    LOC_A,
    "L1",
    "BOOKED",
    "Booked by referral",
    kt(2, "12:00"),
    { mode: "referral_booking" },
  );
  await attempt("T5", LOC_A, "L2", "NO ANSWER", "Test call", kt(2, "12:30"));
  await attempt(
    "T6",
    LOC_A,
    "L9",
    "BOOKED",
    "Booked on the not confirmed calendar",
    kt(1, "09:00"),
    {
      booking: {
        id: "P4",
        calendarId: CAL_PROV,
        startTime: kt(-2, "12:00"),
        verifiedAt: kt(1, "09:00"),
        appointmentStatus: "confirmed",
      },
    },
  );

  // Client A's sheets: the CSM copy (quotations, Y only) and the dialer's read
  // (closes). R1 is the portal's won deal; R2 has no currency; R3 is the same
  // contact's second closed meeting; R4 is pending.
  await q(
    "INSERT INTO public.cockpit_csm_sources(table_name,source_id,data) VALUES('clientProfiles','p1',$1::jsonb)",
    [
      JSON.stringify({
        taskId: "CU_A",
        performanceSyncedAt: Date.now(),
        performance: {
          source: "Appointments tab",
          appointments: [
            { added: kd(4), appAt: kd(2), quote: "y", show: "y" },
            { added: kd(3), appAt: kd(2), quote: "y", show: "y" },
            { added: kd(3), appAt: kd(2), quote: "", show: "n" },
            { added: kd(3), appAt: kd(1), quote: "", show: "" },
            { added: kd(3), appAt: "", quote: "y", show: "" },
          ],
        },
      }),
    ],
  );
  await q(
    "INSERT INTO mahara_reporting.sheet_snapshots VALUES('production',$1,'Client A','S_A',true,$2::jsonb,now(),NULL)",
    [
      LOC_A,
      JSON.stringify({
        sheetId: "S_A",
        currency: null,
        rows: [
          {
            tab: TAB,
            phone: "+96550000011",
            meeting: ms(AP.statusNew.start),
            show: "Y",
            closed: "Y",
            value: 5000,
            currency: "KWD",
          },
          {
            tab: TAB,
            phone: "+96550000010",
            meeting: ms(AP.showedSheet.start),
            show: "Y",
            closed: "Y",
            value: 2000,
            currency: "",
          },
          {
            tab: TAB,
            phone: "+96550000010",
            meeting: ms(kt(1, "15:00")),
            show: "Y",
            closed: "Y",
            value: 2000,
            currency: "",
          },
          {
            tab: TAB,
            phone: "+96550000012",
            meeting: ms(kt(2, "17:00")),
            show: "Y",
            closed: "P",
            value: 0,
          },
        ],
      }),
    ],
  );

  await db.exec(migration("20261013180000_cockpit_client_calls.sql"));
  await db.exec(
    migration("20261015200000_cockpit_client_calls_whatsapp_chats.sql"),
  );
  await db.exec(SQL);
  await db.exec(CHECKED);
}, 120_000);
afterAll(async () => {
  await db?.close();
});

describe("a source that cannot be read", () => {
  test("on a new row writes NULL and says why, never 0, and the rest still lands", async () => {
    await owner(db);
    await db.exec(
      "ALTER TABLE portal_data.appointment_outcomes RENAME TO appointment_outcomes_off",
    );
    try {
      const r = await refresh();
      expect(r.ok).toBe(false);
      expect(JSON.stringify(r.failures)).toContain("outcomes");
      const d2 = await dayRow(LOC_A, kd(2));
      expect(d2.meetings_due).toBeNull();
      expect(d2.shows).toBeNull();
      expect(d2.no_shows).toBeNull();
      expect(d2.no_outcome).toBeNull();
      expect(d2.lead_quality_count).toBeNull();
      expect(d2.quotations).toBeNull();
      expect(d2.closes).toBeNull();
      // Leads and confirmed bookings do not need the portal.
      expect((await dayRow(LOC_A, kd(3))).crm_leads).toBe(3);
      expect((await dayRow(LOC_A, kd(3))).confirmed_bookings).toBe(4);
      const sources = d2.sources as Record<string, Row>;
      expect(sources.outcomes.state).toBe("failed");
      expect(sources.outcomes.ok).toBe(false);
      expect(String(sources.outcomes.note)).toContain("could not be read");
      const state = (
        await q<Row>(
          "SELECT ok, note FROM public.cockpit_sync_state WHERE key='board-facts'",
        )
      )[0];
      expect(state.ok).toBe(false);
      expect(String(state.note)).toContain("outcomes");
    } finally {
      await owner(db);
      await db.exec(
        "ALTER TABLE portal_data.appointment_outcomes_off RENAME TO appointment_outcomes",
      );
    }
    const r = await refresh();
    expect(r.ok).toBe(true);
    expect((await dayRow(LOC_A, kd(2))).meetings_due).toBe(4);
  });
});

describe("the client spine", () => {
  test("ties ad accounts in lead-sync-watch order, digits only, without hidden or Mahara's own accounts", async () => {
    await owner(db);
    const rows = await q<Row>(
      "SELECT * FROM public.cockpit_board_clients ORDER BY location_id",
    );
    const a = rows.find(r => r.location_id === LOC_A)!;
    expect(a.ad_account_ids).toEqual(["111111", "333333"]);
    const ties = Object.fromEntries(
      (a.ad_account_ties as Row[]).map(t => [t.account, t.matchedBy]),
    );
    expect(ties).toEqual({
      "111111": "ghl_client_ad_accounts",
      "333333": "clients.ghl_location_id",
    });
    const b = rows.find(r => r.location_id === LOC_B)!;
    expect(b.ad_account_ids).toEqual(["222222", "444444"]);
    expect(
      (b.ad_account_ties as Row[]).every(
        t => t.matchedBy === "ghl_clients name",
      ),
    ).toBe(true);
    expect(b.service_mode).toBe("DWY");
    const c = rows.find(r => r.location_id === LOC_C)!;
    expect(c.tiktok).toBe(true);
    expect(c.ad_account_ids).toEqual([]);
    expect(a.tiktok).toBe(false);
    // A cancelled client stays on the spine with its status, and gets no days.
    expect(rows.find(r => r.location_id === LOC_X)!.status).toBe("Cancelled");
    const x = await q<Row>(
      "SELECT count(*)::int AS n FROM public.cockpit_client_days WHERE location_id=$1",
      [LOC_X],
    );
    expect(x[0].n).toBe(0);
    const days = await q<Row>(
      "SELECT count(*)::int AS n FROM public.cockpit_client_days WHERE location_id=$1",
      [LOC_A],
    );
    expect(days[0].n).toBe(10);
  });
});

describe("CRM leads", () => {
  test("by Kuwait creation day, WhatsApp chats and deleted contacts left out, ad leads apart", async () => {
    const d3 = await dayRow(LOC_A, kd(3));
    // L1, L2 and L4 (another WhatsApp tag is kept); L3 is a chat, L5 deleted.
    expect(d3.crm_leads).toBe(3);
    // L1 has an ad id. L2 is on the Meta channel with no ad id, no Facebook
    // Ads source and no click id: an Instagram or Messenger DM, kept in CRM
    // leads and counted apart, never an ad lead (2026-10-16 check: 98 such
    // contacts made Ocean Home read 139 ad leads against Meta's 115).
    expect(d3.crm_ad_leads).toBe(1);
    expect(d3.crm_dm_contacts).toBe(1);
    const d2 = await dayRow(LOC_A, kd(2));
    expect(d2.crm_leads).toBe(2);
    // L6 by its ad id (channel Other), L7 by Meta's click id alone.
    expect(d2.crm_ad_leads).toBe(2);
    expect(d2.crm_dm_contacts).toBe(0);
    expect((await dayRow(LOC_A, kd(6))).crm_leads).toBe(0);
    expect((await dayRow(LOC_A, kd(6))).crm_dm_contacts).toBe(0);
  });
});

describe("bookings", () => {
  test("confirmed by booking day: main and online calendars, minus cancelled, invalid and Google copies", async () => {
    // Day 3: AP1 to AP4. AP5 cancelled, AP6 invalid, AP7 a Google copy.
    expect((await dayRow(LOC_A, kd(3))).confirmed_bookings).toBe(4);
    // Day 2: the online calendar's AP8; AP9 is a callback.
    expect((await dayRow(LOC_A, kd(2))).confirmed_bookings).toBe(1);
    // Day 1: AP10 (meeting still to come) and AP11 (status new, as on CEO Delivery).
    expect((await dayRow(LOC_A, kd(1))).confirmed_bookings).toBe(2);
  });

  test("provisional by booking day, Google copies by contact and time or id, deleted and cancelled left out", async () => {
    expect((await dayRow(LOC_A, kd(2))).provisional_bookings).toBe(1);
    expect((await dayRow(LOC_A, kd(1))).provisional_bookings).toBe(1);
    expect(await sum(LOC_A, "provisional_bookings")).toBe(2);
  });
});

describe("attendance", () => {
  test("by meeting day: the CRM status, then the sheet, then the portal's latest revision; unknown is never a no-show", async () => {
    const d2 = await dayRow(LOC_A, kd(2));
    expect(d2.meetings_due).toBe(4);
    expect(d2.shows).toBe(2);
    expect(d2.no_shows).toBe(1);
    // AP2 (CRM noshow, nothing reported) and AP4 (nothing at all).
    expect(d2.no_outcome).toBe(2);
    const d1 = await dayRow(LOC_A, kd(1));
    expect(d1.meetings_due).toBe(2);
    // AP11 has no mark on the appointment, but the sheet's row on the same
    // contact at the same time says it showed (the dialer's match); AP8 is
    // the sheet's no-show.
    expect(d1.shows).toBe(1);
    expect(d1.no_shows).toBe(1);
    expect(d1.no_outcome).toBe(0);
  });

  test("a day whose due meetings nobody marked has no shows and no no-shows: NULL, while a day with none due is 0", async () => {
    const b2 = await dayRow(LOC_B, kd(2));
    expect(b2.meetings_due).toBe(1);
    expect(b2.shows).toBeNull();
    expect(b2.no_shows).toBeNull();
    expect(b2.no_outcome).toBe(1);
    const b5 = await dayRow(LOC_B, kd(5));
    expect(b5.meetings_due).toBe(0);
    expect(b5.shows).toBe(0);
  });
});

describe("quotations, closes, revenue and lead quality", () => {
  test("quotations: the larger of the sheet's Y and the portal's true per day; answers unknown while the sheet keeps only Y", async () => {
    const d2 = await dayRow(LOC_A, kd(2));
    expect(d2.quotations).toBe(2);
    expect(d2.quotation_answers).toBeNull();
    expect((await dayRow(LOC_A, kd(1))).quotations).toBe(1);
    expect(
      String((d2.sources as Record<string, Row>).sheet_copy.note),
    ).toContain("only Y");
    // Client B has no sheet copy, so the portal's answers are the answers.
    const b1 = await dayRow(LOC_B, kd(1));
    expect(b1.quotations).toBe(0);
    expect(b1.quotation_answers).toBe(1);
  });

  test("closes: the sheet's first closed meeting per contact and the portal's wins, one deal counted once, USD at the fixed rates", async () => {
    const d1 = await dayRow(LOC_A, kd(1));
    // R1 and the portal's AP11 are one deal: 5,000 KWD.
    expect(d1.closes).toBe(1);
    expect(d1.closes_with_value).toBe(1);
    expect(d1.revenue).toBe(16300);
    // R2 has no currency: counted, its value left out and named. R3 is the
    // same contact's second closed meeting; R4 is pending.
    const d2 = await dayRow(LOC_A, kd(2));
    expect(d2.closes).toBe(1);
    expect(d2.closes_with_value).toBe(0);
    expect(d2.revenue).toBe(0);
    expect(String((d2.sources as Record<string, Row>).sheet.note)).toContain(
      "no known currency",
    );
    expect(await sum(LOC_A, "closes")).toBe(2);
    // Answered deals count a sheet win where closes does: R3, the contact's
    // second closed meeting, is in neither. Client A marks P, so the
    // breakdown is known.
    expect(d1).toMatchObject({ closes_answered: 1, closes_pending: 0, closes_lost: 0 });
    // Client B reports only in the portal, and marks wins only: lost and
    // pending are not known, so the breakdown is NULL (answered = won would
    // read 100%).
    const b1 = await dayRow(LOC_B, kd(1));
    expect(b1.closes).toBe(1);
    expect(b1.revenue).toBe(1000);
    expect(b1).toMatchObject({ closes_answered: null, closes_pending: null, closes_lost: null });
  });

  test("lead quality: the latest revision, 1 to 10 only", async () => {
    const d2 = await dayRow(LOC_A, kd(2));
    expect(d2.lead_quality_count).toBe(1);
    expect(d2.lq_sum).toBe(7);
    const d1 = await dayRow(LOC_A, kd(1));
    expect(d1.lead_quality_count).toBe(1);
    expect(d1.lq_sum).toBe(8);
    const note = String((d2.sources as Record<string, Row>).outcomes.note);
    expect(note).toContain("outside 1 to 10");
    expect(note).toContain("does not hold");
  });

  test("a portal-only client: nothing before the first meeting it reported, figures from then on", async () => {
    // Client B's first reported meeting is BAP2, a day ago.
    const b1 = await dayRow(LOC_B, kd(1));
    expect(b1.closes).toBe(1);
    expect(b1.lead_quality_count).toBe(1);
    expect(String((b1.sources as Record<string, Row>).outcomes.from)).toBe(
      kd(1),
    );
    const b2 = await dayRow(LOC_B, kd(2));
    expect(b2.quotations).toBeNull();
    expect(b2.quotation_answers).toBeNull();
    expect(b2.closes).toBeNull();
    expect(b2.revenue_usd).toBeNull();
    expect(b2.lead_quality_count).toBeNull();
    // Leads, bookings and attendance do not depend on the portal.
    expect(b2.crm_leads).toBe(2);
    expect(b2.meetings_due).toBe(1);
  });

  test("a client who fills nothing: NULL for quotations, closes and lead quality; 0 where the source was read", async () => {
    const c3 = await dayRow(LOC_C, kd(3));
    expect(c3.quotations).toBeNull();
    expect(c3.quotation_answers).toBeNull();
    expect(c3.closes).toBeNull();
    expect(c3.revenue_usd).toBeNull();
    expect(c3.lead_quality_count).toBeNull();
    // Not in the dialer's client list: neither dials nor leads called are
    // known (2026-10-16: 15 such clients read 0 dials on every day).
    expect(c3.dials).toBeNull();
    expect(c3.leads_called).toBeNull();
    const sources = c3.sources as Record<string, Row>;
    expect(sources.sheet.state).toBe("none");
    expect(sources.dialer_leads.state).toBe("none");
    expect(sources.dialer.state).toBe("none");
    expect(String(sources.dialer.note)).toContain("does not list this client");
  });

  test("a client no sync has ever read: what is found counts, a day with nothing found stays empty, never 0", async () => {
    // Client C has no lead sync, appointments sync or dialer appointment
    // sync record at all.
    const c3 = await dayRow(LOC_C, kd(3));
    // C1 is in the table, so 1 is at least true.
    expect(c3.crm_leads).toBe(1);
    expect(c3.crm_ad_leads).toBe(1);
    expect(c3.confirmed_bookings).toBeNull();
    expect(c3.provisional_bookings).toBeNull();
    expect(c3.meetings_due).toBeNull();
    expect(c3.shows).toBeNull();
    expect(c3.no_outcome).toBeNull();
    const c5 = await dayRow(LOC_C, kd(5));
    expect(c5.crm_leads).toBeNull();
    const sources = c3.sources as Record<string, Row>;
    expect(sources.leads.state).toBe("stale");
    expect(sources.leads.as_of).toBeNull();
    expect(String(sources.leads.note)).toContain("no record of a run");
    expect(String(sources.appointments.note)).toContain("no record of a run");
    expect(String(sources.provisional.note)).toContain("no appointment sync");
  });

  test("a sheet whose Closed column is blank and a copy with no quotation Y give NULL, not 0; one N gives 0", async () => {
    const LOC_D = "locBoardClientD00005";
    await owner(db);
    await q(
      "INSERT INTO public.ghl_clients(location_id,client_name,status,clickup_id,country,service_mode) VALUES($1,'Client D','Launching','CU_D','KW','DFY')",
      [LOC_D],
    );
    await q(
      "INSERT INTO public.cockpit_csm_sources(table_name,source_id,data) VALUES('clientProfiles','pD',$1::jsonb)",
      [
        JSON.stringify({
          taskId: "CU_D",
          performanceSyncedAt: Date.now(),
          performance: {
            source: "Appointments tab",
            appointments: [
              { added: kd(4), appAt: kd(3), quote: "", show: "y" },
              { added: kd(4), appAt: kd(2), quote: "", show: "n" },
            ],
          },
        }),
      ],
    );
    const rows = [
      {
        tab: TAB,
        phone: "+96550000041",
        meeting: ms(kt(9, "12:00")),
        show: "Y",
        closed: "",
        value: null,
      },
      {
        tab: TAB,
        phone: "+96550000042",
        meeting: ms(kt(9, "13:00")),
        show: "N",
        closed: " ",
        value: null,
      },
    ];
    await q(
      "INSERT INTO mahara_reporting.sheet_snapshots VALUES('production',$1,'Client D','S_D',true,$2::jsonb,now(),NULL)",
      [LOC_D, JSON.stringify({ sheetId: "S_D", currency: "KWD", rows })],
    );
    // A portal report with the deal and the quotation left blank.
    await appt("DAP1", LOC_D, {
      contact: "D1",
      calendar: "calMainD",
      start: kt(9, "15:00"),
      booked: kt(10, "10:00"),
    });
    await q(
      "INSERT INTO public.ghl_calendars(location_id,calendar_id,name) VALUES($1,'calMainD','Main Appointment Calendar')",
      [LOC_D],
    );
    await outcome(LOC_D, "DAP1", 1, { attendance: "showed", deal: "unknown" });
    try {
      await refresh();
      let d9 = await dayRow(LOC_D, kd(9));
      expect(d9.closes).toBeNull();
      expect(d9.closes_with_value).toBeNull();
      expect(d9.revenue_usd).toBeNull();
      expect(d9.quotations).toBeNull();
      const sources = d9.sources as Record<string, Row>;
      expect(String(sources.sheet.note)).toContain("no Closed marks");
      expect(String(sources.sheet_copy.note)).toContain(
        "no Y in the Quotation column",
      );
      expect(String(sources.outcomes.note)).toContain("mark no deal");

      // One N in the Closed column, one Y in the copy: the client fills
      // both, so a day the sheet covers with nothing closed is 0.
      rows[1].closed = "N";
      await q(
        "UPDATE mahara_reporting.sheet_snapshots SET data=$2::jsonb WHERE id=$1",
        [LOC_D, JSON.stringify({ sheetId: "S_D", currency: "KWD", rows })],
      );
      await q(
        `UPDATE public.cockpit_csm_sources SET data = jsonb_set(data, '{performance,appointments,0,quote}', '"y"') WHERE source_id='pD'`,
      );
      await refresh();
      d9 = await dayRow(LOC_D, kd(9));
      expect(d9.closes).toBe(0);
      expect(d9.closes_with_value).toBe(0);
      expect(d9.revenue).toBe(0);
      expect(d9.closes_lost).toBe(1);
      expect(d9.closes_answered).toBe(1);
      // The client fills the Quotation column now, but the copy holds no row
      // for DAP1, the meeting due that day: nothing answered, so unknown.
      expect(d9.quotations).toBeNull();
      expect((await dayRow(LOC_D, kd(3))).quotations).toBe(1);
      expect(
        String((d9.sources as Record<string, Row>).sheet.note),
      ).not.toContain("no Closed marks");
    } finally {
      await owner(db);
      await q("DELETE FROM public.ghl_clients WHERE location_id=$1", [LOC_D]);
      await q("DELETE FROM public.cockpit_board_clients WHERE location_id=$1", [
        LOC_D,
      ]);
      await q("DELETE FROM public.cockpit_csm_sources WHERE source_id='pD'");
      await q("DELETE FROM mahara_reporting.sheet_snapshots WHERE id=$1", [
        LOC_D,
      ]);
      await q(
        "DELETE FROM portal_data.appointment_outcomes WHERE location_id=$1",
        [LOC_D],
      );
      await q("DELETE FROM public.appointments WHERE ghl_location_id=$1", [
        LOC_D,
      ]);
      await q("DELETE FROM public.ghl_calendars WHERE location_id=$1", [LOC_D]);
    }
  });

  test("a deal in no known currency is named on its own day only, as unpricedCloses", async () => {
    await owner(db);
    await refresh();
    // R2 (kd 2) has a value and no currency; kd 1's close is priced.
    const d2 = (await dayRow(LOC_A, kd(2))).sources as Record<string, Row>;
    expect(d2.sheet.unpricedCloses).toBe(1);
    expect(String(d2.sheet.note)).toContain(
      "1 closed deal this day carries a value in no known currency",
    );
    const d1 = (await dayRow(LOC_A, kd(1))).sources as Record<string, Row>;
    expect(d1.sheet.unpricedCloses).toBeUndefined();
    expect(String(d1.sheet.note)).not.toContain("no known currency");
  });
});

describe("the dialer", () => {
  test("dials and leads called add up to the dialer's own report", async () => {
    await owner(db);
    const report = (
      await q<{ r: { clients: Row[] } }>(
        "SELECT public.mahara_call_center_report($1,$2,NULL,$3) AS r",
        [FROM, today, LOC_A],
      )
    )[0].r;
    const official = report.clients[0];
    expect(await sum(LOC_A, "dials")).toBe(Number(official.dials));
    // The dialer counts the WhatsApp chat L3 it called; leads called leave it
    // out, as CRM leads do, and the note says so.
    expect(await sum(LOC_A, "leads_called")).toBe(
      Number(official.leadsDialed) - 1,
    );
    const d3 = await dayRow(LOC_A, kd(3));
    expect(
      String((d3.sources as Record<string, Row>).dialer_leads.note),
    ).toContain("1 WhatsApp chat contact the dialer called");
    // T1 on day 3; T2 and the test call T5 on day 2 (the report counts it);
    // the BOOKED save T6 on day 1. T3 has no note, T4 is a referral booking.
    expect((await dayRow(LOC_A, kd(3))).dials).toBe(1);
    expect((await dayRow(LOC_A, kd(2))).dials).toBe(2);
    expect((await dayRow(LOC_A, kd(1))).dials).toBe(1);
    expect((await dayRow(LOC_A, kd(3))).leads_called).toBe(1);
    // The dials are read live by the refresh: yesterday is complete and today
    // is so far, whenever the last dial was saved; the newest saved attempt
    // is kept apart as activity.
    const dialer1 = ((await dayRow(LOC_A, kd(1))).sources as Record<string, Row>).dialer;
    expect(dialer1.partial).toBe(false);
    expect(dialer1.lastAttemptAt).toBeTruthy();
    expect(new Date(String(dialer1.as_of)).getTime()).toBeGreaterThan(
      new Date(String(dialer1.lastAttemptAt)).getTime(),
    );
    expect(
      ((await dayRow(LOC_A, today)).sources as Record<string, Row>).dialer.partial,
    ).toBe(true);
    // Client B is done with you, and the dialer lists it: the call centre
    // does not call its leads, so dials and leads called do not apply (NULL),
    // never a 0 that reads as no work done.
    expect(
      await q("SELECT 1 FROM mahara_reporting.cc_clients WHERE id = $1", [LOC_B]),
    ).toHaveLength(1);
    for (const n of [1, 2, 3]) {
      const b = await dayRow(LOC_B, kd(n));
      expect(b.dials).toBeNull();
      expect(b.leads_called).toBeNull();
    }
    const b1 = (await dayRow(LOC_B, kd(1))).sources as Record<string, Row>;
    expect(b1.dialer).toMatchObject({ state: "none" });
    expect(String(b1.dialer.note)).toContain("Done with you");
  });

  test("waiting now equals cockpit_client_calls for every client, and the median first call equals the report's", async () => {
    await owner(db);
    const now = await q<Row>(
      "SELECT * FROM public.cockpit_client_now ORDER BY location_id",
    );
    expect(now.map(r => r.location_id).sort()).toEqual(
      [LOC_A, LOC_B, LOC_C].sort(),
    );
    for (const [loc, key] of [
      [LOC_A, "CU_A"],
      [LOC_B, "CU_B"],
      [LOC_C, "CU_C"],
    ]) {
      await actor(db, BUYER);
      const calls = (
        await q<{
          r: {
            waiting: {
              callable: number;
              touched: number;
              untouched: { count: number; oldestAt: string | null };
            };
          };
        }>("SELECT public.cockpit_client_calls($1,$2,$3) AS r", [
          key,
          kd(29),
          today,
        ])
      )[0].r;
      await owner(db);
      const row = now.find(r => r.location_id === loc)!;
      if (loc === LOC_B) {
        // Done with you: the call centre does not call this client's leads,
        // so no waiting figures are stored (they read as a failing 0% before).
        for (const k of [
          "callable_30d",
          "touched_30d",
          "untouched_leads",
          "oldest_untouched_at",
          "touched_share_30d",
          "verified_called_30d",
          "outcome_only_30d",
        ])
          expect(row[k]).toBeNull();
      } else {
        expect(row.callable_30d).toBe(Number(calls.waiting.callable));
        expect(row.touched_30d).toBe(Number(calls.waiting.touched));
        expect(row.untouched_leads).toBe(Number(calls.waiting.untouched.count));
        expect(
          row.oldest_untouched_at
            ? (row.oldest_untouched_at as Date).getTime()
            : null,
        ).toBe(
          calls.waiting.untouched.oldestAt
            ? Date.parse(calls.waiting.untouched.oldestAt)
            : null,
        );
      }
      const report = (
        await q<{ r: { clients: Row[] } }>(
          "SELECT public.mahara_call_center_report($1,$2,NULL,$3) AS r",
          [kd(29), today, loc],
        )
      )[0].r;
      const median = report.clients[0]?.medianSpeedSeconds;
      expect(
        row.first_call_median_work_seconds_30d === null
          ? null
          : Number(row.first_call_median_work_seconds_30d),
      ).toBe(
        median === null || median === undefined
          ? null
          : Math.round(Number(median)),
      );
    }
    const a = now.find(r => r.location_id === LOC_A)!;
    // L1 dialled, L4 with a saved attempt, L6 dialled under another lead.
    expect(Number(a.touched_30d)).toBeGreaterThanOrEqual(3);
    expect(Number(a.untouched_leads)).toBeGreaterThanOrEqual(3);
    expect(Number(a.touched_share_30d)).toBeCloseTo(
      Number(a.touched_30d) / Number(a.callable_30d),
      4,
    );
    expect(a.first_call_median_work_seconds_30d).not.toBeNull();
    expect(String(a.note)).toContain("WhatsApp chat contact");
    // Touched = a Maqsam call or a saved outcome. L4 has only the saved NO
    // ANSWER T1 and no call to its number: touched, not verified.
    expect(Number(a.verified_called_30d) + Number(a.outcome_only_30d)).toBe(
      Number(a.touched_30d),
    );
    expect(Number(a.outcome_only_30d)).toBeGreaterThanOrEqual(1);
    expect(String(a.note)).toContain("no Maqsam call to the number");
    expect(String(now.find(r => r.location_id === LOC_B)!.note)).toContain(
      "Done with you",
    );
  });
});

/** The month tab a Kuwait day falls in, as the client sheets name it ("Oct 26"). */
const tabOf = (day: string) => {
  const d = new Date(`${day}T12:00:00Z`);
  return `${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${String(d.getUTCFullYear()).slice(2)}`;
};

describe("the corrections after the 2026-10-16 check", () => {
  test("status and service come from the ClickUp card, the registry only without one; a Stopped client gets no new days", async () => {
    const LOC_E = "locBoardClientE00006";
    const LOC_F = "locBoardClientF00007";
    await owner(db);
    await q(
      `INSERT INTO public.ghl_clients(location_id,client_name,status,clickup_id,country,service_mode) VALUES
       ($1,'Client E','Paused','CU_E','KW','DFY'), ($2,'Client F','Launching','CU_F','KW',NULL)`,
      [LOC_E, LOC_F],
    );
    await q(
      `INSERT INTO public.cockpit_csm_sources(table_name,source_id,data) VALUES
       ('clients','cE',$1::jsonb), ('clients','cF',$2::jsonb), ('clients','cX',$3::jsonb), ('clientProfiles','pF',$4::jsonb)`,
      [
        JSON.stringify({ taskId: "CU_E", stage: "Stopped", service: "DFY" }),
        JSON.stringify({ taskId: "CU_F", stage: "Active", service: "DWY" }),
        JSON.stringify({ taskId: "CU_X", stage: "Stopped", service: "DFY" }),
        JSON.stringify({ taskId: "CU_F", adsPlatform: "Tiktok" }),
      ],
    );
    try {
      await refresh();
      const rows = await q<Row>(
        "SELECT location_id, status, registry_status, card_stage, service_mode, tiktok FROM public.cockpit_board_clients WHERE location_id = ANY($1)",
        [[LOC_E, LOC_F, LOC_X, LOC_A]],
      );
      const by = Object.fromEntries(rows.map(r => [r.location_id, r]));
      // Lost on the card, Paused in the registry: Stopped (2026-10-16:
      // three clients lost on 20 Sep still read Paused or Ghosting).
      expect(by[LOC_E]).toMatchObject({
        status: "Stopped",
        registry_status: "Paused",
        card_stage: "Stopped",
      });
      // Active on the card, Launching in the registry (Shades on 16 Oct);
      // the card's service and Ads Platform count.
      expect(by[LOC_F]).toMatchObject({
        status: "Active",
        registry_status: "Launching",
        service_mode: "DWY",
        tiktok: true,
      });
      // A Stopped card on a client the registry calls Cancelled keeps the
      // registry's word; with no card the registry's status stands.
      expect(by[LOC_X].status).toBe("Cancelled");
      expect(by[LOC_A]).toMatchObject({ status: "Active", card_stage: null });
      const days = async (loc: string) =>
        (
          await q<{ n: number }>(
            "SELECT count(*)::int AS n FROM public.cockpit_client_days WHERE location_id=$1",
            [loc],
          )
        )[0].n;
      expect(await days(LOC_E)).toBe(0);
      expect(await days(LOC_F)).toBe(10);
      const doctor = (
        await q<{ r: Row }>("SELECT public.cockpit_board_facts_doctor() AS r")
      )[0].r;
      // No 120-day fill has run in this file yet: the doctor says so in plain
      // words (its text[] append needs a typed literal).
      expect((doctor.problems as string[]).join(" ")).toContain(
        "The 120-day fill has not run yet",
      );
      const spine = doctor.spine as Row;
      const disagree = JSON.stringify(spine.registryDisagrees);
      expect(disagree).toContain("Client E");
      expect(disagree).toContain("Client F");
      expect(disagree).not.toContain("Old client");
      expect(spine.noCard as string[]).toContain("Client A");
    } finally {
      await owner(db);
      await q("DELETE FROM public.ghl_clients WHERE location_id = ANY($1)", [
        [LOC_E, LOC_F],
      ]);
      await q(
        "DELETE FROM public.cockpit_board_clients WHERE location_id = ANY($1)",
        [[LOC_E, LOC_F]],
      );
      await q(
        "DELETE FROM public.cockpit_csm_sources WHERE source_id IN ('cE','cF','cX','pF')",
      );
      await refresh();
    }
  });

  test("a hand tie comes first, holds even for a hidden account, never for Mahara's own; a kept-out row ties nothing; the doctor names a tie to no client", async () => {
    await owner(db);
    await q(
      `INSERT INTO public.cockpit_board_account_ties(account_id,location_id,evidence,added_by,kept_out) VALUES
       ('888888',$1,'Owned by the client''s Meta business, checked by hand','test',false),
       ('555555',$1,'The hidden account is this client''s, checked by hand','test',false),
       ('666666',$1,'Mahara''s own account, which is never tied','test',false),
       ('333333',$2,'The client''s own boosts, kept out of its figures','test',true)`,
      [LOC_C, LOC_A],
    );
    try {
      await refresh();
      const c = (
        await q<Row>(
          "SELECT ad_account_ids, ad_account_ties FROM public.cockpit_board_clients WHERE location_id=$1",
          [LOC_C],
        )
      )[0];
      expect(c.ad_account_ids).toEqual(["555555", "888888"]);
      expect(
        (c.ad_account_ties as Row[]).every(
          t => t.matchedBy === "cockpit_board_account_ties",
        ),
      ).toBe(true);
      const a = (
        await q<Row>(
          "SELECT ad_account_ids FROM public.cockpit_board_clients WHERE location_id=$1",
          [LOC_A],
        )
      )[0];
      // 333333 would tie to client A through its clients row; kept out by
      // hand, it ties to nobody.
      expect(a.ad_account_ids).toEqual(["111111"]);
      await q(
        "INSERT INTO public.cockpit_board_account_ties(account_id,location_id,evidence,added_by) VALUES ('999999','locNowhere0000000000','A location that is not in the registry','test')",
      );
      const doctor = (
        await q<{ r: Row }>("SELECT public.cockpit_board_facts_doctor() AS r")
      )[0].r;
      const problems = (doctor.problems as string[]).join(" ");
      expect(problems).toContain("999999 to locNowhere0000000000");
      expect(doctor.handTies.keptOut).toEqual([
        { account: "333333", client: expect.any(String) },
      ]);
    } finally {
      await owner(db);
      await q("DELETE FROM public.cockpit_board_account_ties");
      await refresh();
    }
  });

  test("the registry's own ad account field ties last: a known account id written in it, or a name equal to one Meta account's", async () => {
    const LOCS = {
      H: "locBoardClientH00009",
      I: "locBoardClientI00010",
      J: "locBoardClientJ00011",
      K: "locBoardClientK00012",
      L: "locBoardClientL00013",
    };
    await owner(db);
    // The ad-day store, as far as the spine reads it.
    await db.exec(`CREATE TABLE public.cockpit_meta_ad_days (account_id text, account_name text, day date, ad_id text);
      INSERT INTO public.cockpit_meta_ad_days VALUES
        ('9876543210123', '9876543210123', current_date, '1'),
        ('5432109876543', 'Shades Store', current_date, '2'),
        ('1212121212121', 'Twin', current_date, '3'),
        ('3434343434343', 'Twin', current_date, '4');`);
    await q(
      `INSERT INTO public.ghl_clients(location_id,client_name,status,clickup_id,meta_ad_account,country) VALUES
       ($1,'Client H','Active','CU_H','9876543210123, KWD','KW'),
       ($2,'Client I','Launching','CU_I','Shades Store','KW'),
       ($3,'Client J','Active','CU_J','Twin','KW'),
       ($4,'Client K','Cancelled','CU_K','Shades Store','KW'),
       ($5,'Client L','Active','CU_L','call 96550001234567','KW')`,
      [LOCS.H, LOCS.I, LOCS.J, LOCS.K, LOCS.L],
    );
    try {
      await refresh();
      const ties = async (loc: string) =>
        (
          await q<Row>(
            "SELECT ad_account_ids, ad_account_ties FROM public.cockpit_board_clients WHERE location_id=$1",
            [loc],
          )
        )[0];
      // An account id written in the field (Ardon's "718146936708597, SAR").
      const h = await ties(LOCS.H);
      expect(h.ad_account_ids).toEqual(["9876543210123"]);
      expect((h.ad_account_ties as Row[])[0].matchedBy).toBe(
        "ghl_clients.meta_ad_account",
      );
      // A name equal to one Meta account's name ("Shades"); the cancelled
      // client with the same name does not count.
      expect((await ties(LOCS.I)).ad_account_ids).toEqual(["5432109876543"]);
      // Two Meta accounts share the name: no tie.
      expect((await ties(LOCS.J)).ad_account_ids).toEqual([]);
      // A number that is no known account: no tie.
      expect((await ties(LOCS.L)).ad_account_ids).toEqual([]);
      // Ties that existed keep their order.
      expect((await ties(LOC_A)).ad_account_ids).toEqual(["111111", "333333"]);
    } finally {
      await owner(db);
      await db.exec("DROP TABLE public.cockpit_meta_ad_days");
      await q("DELETE FROM public.ghl_clients WHERE location_id = ANY($1)", [
        Object.values(LOCS),
      ]);
      await q(
        "DELETE FROM public.cockpit_board_clients WHERE location_id = ANY($1)",
        [Object.values(LOCS)],
      );
      await refresh();
    }
  });

  test("the hand-tie migration applies twice, each tie with its evidence", async () => {
    await owner(db);
    await db.exec(TIES);
    await db.exec(TIES);
    const rows = await q<Row>(
      "SELECT account_id, location_id, evidence, kept_out FROM public.cockpit_board_account_ties ORDER BY account_id",
    );
    // Alkhalil's SAR account holds only the client's own post boosts: named,
    // kept out of its figures.
    expect(rows.filter(r => r.kept_out).map(r => r.account_id)).toEqual([
      "640644143620696",
    ]);
    expect(rows.map(r => r.account_id)).toEqual([
      "134992869555229",
      "640644143620696",
      "718146936708597",
      "762687672022667",
      "854779610674376",
    ]);
    for (const r of rows) {
      expect(String(r.location_id)).toMatch(/^[A-Za-z0-9]{20}$/);
      expect(String(r.evidence)).toContain("Checked 2026-10-16");
    }
    await q("DELETE FROM public.cockpit_board_account_ties");
  });

  test("meetings: a booking replaced before its time, a reschedule, a moved time, deal answers, quotation N, bulk uploads, a day so far", async () => {
    const LOC_G = "locBoardClientG00008";
    const phone = (n: number) => `+9655000006${n}`;
    await owner(db);
    await q(
      "INSERT INTO public.ghl_clients(location_id,client_name,status,clickup_id,country,service_mode) VALUES($1,'Client G','Active','CU_G','KW','DFY')",
      [LOC_G],
    );
    await q(
      `INSERT INTO public.ghl_calendars(location_id,calendar_id,name) VALUES
       ($1,'calMainG','Main Appointment Calendar'),
       ($1,'calQualG','مكالمة مراجعة المشروع وتنسيق الاستشارة | Project Review & Qualification Call')`,
      [LOC_G],
    );
    await q(
      "INSERT INTO public.lead_sync_state VALUES ($1,now(),'success',NULL)",
      [LOC_G],
    );
    await q(
      "INSERT INTO public.appointment_sync_state VALUES ($1,now(),'success')",
      [LOC_G],
    );
    await q(
      "INSERT INTO mahara_reporting.sync_jobs VALUES ('production','jG','ghl',$1,'appointments_recent',now(),NULL)",
      [LOC_G],
    );
    for (let i = 1; i <= 7; i++)
      await lead(`G${i}`, LOC_G, kt(9, "09:00"), {
        phone: phone(i),
        ad: `ADG${i}`,
      });
    // Ten contacts within one hour: an upload in bulk.
    for (let i = 0; i < 10; i++)
      await lead(
        `GB${i}`,
        LOC_G,
        kt(6, `10:${String(i * 5).padStart(2, "0")}`),
        {
          phone: `+9655100000${i}`,
          ad: "ADGB",
        },
      );
    const main = { calendar: "calMainG" };
    // G1 booked a meeting, then booked another before the first one's time.
    await appt("G_old", LOC_G, {
      ...main,
      contact: "G1",
      booked: kt(6, "09:00"),
      start: kt(4, "12:00"),
    });
    await appt("G_new", LOC_G, {
      ...main,
      contact: "G1",
      booked: kt(5, "10:00"),
      start: kt(3, "12:00"),
    });
    // G3 booked again before the first meeting, but the client's sheet lists
    // the first one (a row at its time, not marked yet): both are real.
    await appt("G3_a", LOC_G, {
      ...main,
      contact: "G3",
      phone: phone(3),
      booked: kt(9, "10:00"),
      start: kt(7, "12:00"),
    });
    await appt("G3_b", LOC_G, {
      ...main,
      contact: "G3",
      phone: phone(3),
      booked: kt(8, "10:00"),
      start: kt(-2, "12:00"),
    });
    // G2 booked again only after the first meeting's time: a likely no-show, kept.
    await appt("G_late", LOC_G, {
      ...main,
      contact: "G2",
      booked: kt(8, "10:00"),
      start: kt(6, "12:00"),
    });
    await appt("G_late2", LOC_G, {
      ...main,
      contact: "G2",
      booked: kt(5, "11:00"),
      start: kt(2, "12:00"),
    });
    // The call centre moved G4's meeting: a RESCHEDULE booking.
    await appt("G_rs", LOC_G, {
      ...main,
      contact: "G4",
      booked: kt(5, "12:00"),
      start: kt(2, "10:00"),
    });
    await attempt(
      "GR1",
      LOC_G,
      "G4",
      "RESCHEDULE",
      "Moved to another day",
      kt(5, "12:00"),
      {
        booking: {
          id: "G_rs",
          calendarId: "calMainG",
          startTime: kt(2, "10:00"),
          verifiedAt: kt(5, "12:00"),
          appointmentStatus: "confirmed",
        },
      },
    );
    // A callback on the qualification calendar: not a booking, not a meeting.
    await appt("G_cb", LOC_G, {
      calendar: "calQualG",
      contact: "G3",
      booked: kt(5, "14:00"),
      start: kt(1, "10:00"),
    });
    // The CRM holds G5's meeting at 15:15; the sheet marks it at 13:00.
    await appt("G_moved", LOC_G, {
      ...main,
      contact: "G5",
      phone: phone(5),
      booked: kt(5, "13:00"),
      start: kt(3, "15:15"),
    });
    const rows = [
      {
        tab: tabOf(kd(3)),
        phone: phone(5),
        meeting: ms(kt(3, "13:00")),
        show: "Y",
        closed: "",
      },
      {
        tab: tabOf(kd(4)),
        phone: phone(6),
        meeting: ms(kt(4, "11:00")),
        show: "Y",
        closed: "P",
      },
      {
        tab: tabOf(kd(4)),
        phone: phone(7),
        meeting: ms(kt(4, "12:30")),
        show: "N",
        closed: "N",
      },
      {
        tab: tabOf(kd(6)),
        phone: phone(2),
        meeting: ms(kt(6, "12:00")),
        show: "",
        closed: "",
      },
      {
        tab: tabOf(kd(7)),
        phone: phone(3),
        meeting: ms(kt(7, "12:00")),
        show: "",
        closed: "",
      },
    ];
    await q(
      "INSERT INTO mahara_reporting.sheet_snapshots VALUES('production',$1,'Client G','S_G',true,$2::jsonb,now(),NULL)",
      [LOC_G, JSON.stringify({ sheetId: "S_G", currency: "KWD", rows })],
    );
    // The CSM copy keeps N once its worker says so (quoteKeepsN).
    await q(
      "INSERT INTO public.cockpit_csm_sources(table_name,source_id,data) VALUES('clientProfiles','pG',$1::jsonb)",
      [
        JSON.stringify({
          taskId: "CU_G",
          performanceSyncedAt: Date.now(),
          performance: {
            source: "Appointments tab",
            quoteKeepsN: true,
            appointments: [
              { added: kd(6), appAt: kd(3), quote: "y", show: "y" },
              { added: kd(6), appAt: kd(2), quote: "n", show: "" },
            ],
          },
        }),
      ],
    );
    try {
      await refresh();
      const g = (n: number) => dayRow(LOC_G, kd(n));
      // G_old: replaced before its time with no mark, so not a meeting due;
      // the day's note counts it.
      const d4 = await g(4);
      expect(d4.meetings_due).toBe(0);
      expect(d4.no_outcome).toBe(0);
      expect(
        String((d4.sources as Record<string, Row>).appointments.note),
      ).toContain("1 booking the contact replaced before its time");
      // G3_a stays due: the sheet lists it.
      expect((await g(7)).meetings_due).toBe(1);
      // G_late stays due: the contact booked again after its time.
      const d6 = await g(6);
      expect(d6.meetings_due).toBe(1);
      expect(d6.no_outcome).toBe(1);
      // G_moved takes the sheet's 13:00 mark: G5's only meeting and only
      // sheet row that day. G_new (G1) has no mark.
      const d3 = await g(3);
      expect(d3.meetings_due).toBe(2);
      expect(d3.shows).toBe(1);
      expect(d3.no_shows).toBe(0);
      expect(d3.no_outcome).toBe(1);
      // G_rs is due as a meeting, but the reschedule is not a new booking;
      // the callback is neither.
      expect((await g(2)).meetings_due).toBe(2);
      expect((await g(5)).confirmed_bookings).toBe(3);
      expect((await g(1)).meetings_due).toBe(0);
      // Deal answers: P and N on day 4 (no meeting due there in the CRM).
      expect(d4).toMatchObject({
        closes: 0,
        closes_pending: 1,
        closes_lost: 1,
        closes_answered: 2,
      });
      // Day 6 had a meeting due and no deal or quotation answer: unknown,
      // closes and its breakdown alike.
      expect(d6.closes).toBeNull();
      expect(d6.revenue_usd).toBeNull();
      expect(d6.closes_answered).toBeNull();
      expect(d6.closes_pending).toBeNull();
      expect(d6.closes_lost).toBeNull();
      expect(d6.quotations).toBeNull();
      // Quotation Y and N from the copy: answers known.
      expect(d3).toMatchObject({ quotations: 1, quotation_answers: 1 });
      const d2 = await g(2);
      expect(d2).toMatchObject({ quotations: 0, quotation_answers: 1 });
      expect(
        String((d2.sources as Record<string, Row>).sheet_copy.note ?? ""),
      ).not.toContain("only Y");
      // Ten contacts within one hour on day 6.
      const leads6 = (d6.sources as Record<string, Row>).leads;
      expect(leads6.bulkImport).toBe(10);
      expect(String(leads6.note)).toContain(
        "10 contacts arrived within one hour",
      );
      expect(d6.crm_leads).toBe(10);
      // Today is so far; day 3 is complete.
      expect(
        ((await dayRow(LOC_G, today)).sources as Record<string, Row>).leads
          .partial,
      ).toBe(true);
      expect((d3.sources as Record<string, Row>).leads.partial).toBe(false);
      expect(
        (d3.sources as Record<string, Row>).outcomes.partial,
      ).toBeUndefined();
    } finally {
      await owner(db);
      await q("DELETE FROM public.ghl_clients WHERE location_id=$1", [LOC_G]);
      await q("DELETE FROM public.cockpit_board_clients WHERE location_id=$1", [
        LOC_G,
      ]);
      await q("DELETE FROM public.ghl_calendars WHERE location_id=$1", [LOC_G]);
      await q("DELETE FROM public.client_leads WHERE location_id=$1", [LOC_G]);
      await q("DELETE FROM public.appointments WHERE ghl_location_id=$1", [
        LOC_G,
      ]);
      await q("DELETE FROM public.lead_sync_state WHERE location_id=$1", [
        LOC_G,
      ]);
      await q(
        "DELETE FROM public.appointment_sync_state WHERE location_id=$1",
        [LOC_G],
      );
      await q("DELETE FROM mahara_reporting.sync_jobs WHERE id='jG'");
      await q("DELETE FROM mahara_reporting.sheet_snapshots WHERE id=$1", [
        LOC_G,
      ]);
      await q("DELETE FROM public.cockpit_csm_sources WHERE source_id='pG'");
      await q("DELETE FROM mahara_console.attempts WHERE id='GR1'");
    }
  });
});

describe("the closed-day rule", () => {
  test("a source that is behind never lowers a closed day; a complete read may, and the audit row lists the drop", async () => {
    await owner(db);
    expect((await dayRow(LOC_A, kd(3))).crm_leads).toBe(3);
    await q(
      "UPDATE public.lead_sync_state SET last_status='error', last_error='GoHighLevel 502' WHERE location_id=$1",
      [LOC_A],
    );
    await q(
      "UPDATE public.client_leads SET deleted=true WHERE ghl_contact_id='L2'",
    );
    await refresh();
    const kept = await dayRow(LOC_A, kd(3));
    expect(kept.crm_leads).toBe(3);
    const sources = kept.sources as Record<string, Row>;
    expect(sources.leads.state).toBe("stale");
    expect(String(sources.leads.note)).toContain("never lowered");

    await q(
      "UPDATE public.lead_sync_state SET last_status='success', last_error=NULL, last_synced_at=now() WHERE location_id=$1",
      [LOC_A],
    );
    const r = await refresh();
    expect(Number(r.drops)).toBeGreaterThanOrEqual(1);
    expect((await dayRow(LOC_A, kd(3))).crm_leads).toBe(2);
    const audit = (
      await q<{ after: Row }>(
        "SELECT after FROM public.cockpit_audit_log WHERE action='board_facts.refresh' ORDER BY created_at DESC, id LIMIT 1",
      )
    )[0].after;
    expect(audit.droppedDays as Row[]).toContainEqual({
      location: LOC_A,
      day: kd(3),
      metric: "crm_leads",
      from: 3,
      to: 2,
    });
    await q(
      "UPDATE public.client_leads SET deleted=false WHERE ghl_contact_id='L2'",
    );
  });

  test("a source that fails keeps the figures stored before", async () => {
    await owner(db);
    await refresh();
    expect((await dayRow(LOC_A, kd(1))).closes).toBe(1);
    await db.exec(
      "ALTER VIEW mahara_reporting.cc_results RENAME TO cc_results_off",
    );
    try {
      const r = await refresh();
      expect(r.ok).toBe(false);
      const d1 = await dayRow(LOC_A, kd(1));
      expect(d1.closes).toBe(1);
      expect(d1.revenue).toBe(16300);
      expect((d1.sources as Record<string, Row>).sheet.state).toBe("failed");
      // Without the sheet's own marks attendance is partial: a closed day
      // keeps the show it had.
      expect((d1.sources as Record<string, Row>).sheet_marks.state).toBe(
        "failed",
      );
      expect(d1.shows).toBe(1);
    } finally {
      await owner(db);
      await db.exec(
        "ALTER VIEW mahara_reporting.cc_results_off RENAME TO cc_results",
      );
    }
    expect((await refresh()).ok).toBe(true);
  });

  test("a day in a month the sheet holds no tab for, before the portal's first report: never 0, never lowered", async () => {
    await owner(db);
    const old = kd(40);
    const median = async () =>
      (
        await q<Row>(
          "SELECT first_call_median_work_seconds_30d::float AS m FROM public.cockpit_client_now WHERE location_id=$1",
          [LOC_A],
        )
      )[0].m;
    const medianBefore = await median();
    expect(medianBefore).not.toBeNull();
    await refresh(old, old);
    // A refresh of past days still reads the last 30 days' first calls.
    expect(await median()).toBe(medianBefore);
    let row = await dayRow(LOC_A, old);
    // No source covers the day's closes, so it stays empty rather than 0.
    expect(row.closes).toBeNull();
    expect(row.revenue_usd).toBeNull();
    expect(row.lead_quality_count).toBeNull();
    // The CSM copy is the Appointments tab, which covers every day.
    expect(row.quotations).toBe(0);
    expect(String((row.sources as Record<string, Row>).sheet.note)).toContain(
      `month tab ${TAB.slice(0, 3)}`,
    );
    await q(
      "UPDATE public.cockpit_client_days SET closes=3 WHERE location_id=$1 AND day=$2",
      [LOC_A, old],
    );
    await refresh(old, old);
    expect((await dayRow(LOC_A, old)).closes).toBe(3);

    // A close the sheet does hold for that day is at least true: it fills an
    // empty day, and never lowers a stored one.
    const extra = {
      tab: TAB,
      phone: "+96550000077",
      meeting: ms(kt(40, "12:00")),
      show: "Y",
      closed: "Y",
      value: 100,
      currency: "USD",
    };
    await q(
      "UPDATE mahara_reporting.sheet_snapshots SET data = jsonb_set(data, '{rows}', (data->'rows') || $2::jsonb) WHERE id=$1",
      [LOC_A, JSON.stringify([extra])],
    );
    try {
      await refresh(old, old);
      expect((await dayRow(LOC_A, old)).closes).toBe(3);
      await q(
        "UPDATE public.cockpit_client_days SET closes=NULL, revenue_usd=NULL WHERE location_id=$1 AND day=$2",
        [LOC_A, old],
      );
      await refresh(old, old);
      row = await dayRow(LOC_A, old);
      expect(row.closes).toBe(1);
      expect(row.revenue).toBe(100);
    } finally {
      await q(
        "UPDATE mahara_reporting.sheet_snapshots SET data = jsonb_set(data, '{rows}', (SELECT jsonb_agg(r) FROM jsonb_array_elements(data->'rows') r WHERE r->>'phone' <> $2)) WHERE id=$1",
        [LOC_A, extra.phone],
      );
    }
  });

  test("a source that is behind says nothing about the days after it last read: never 0, but what it holds still counts", async () => {
    await owner(db);
    await refresh();
    await q(
      "UPDATE public.lead_sync_state SET last_synced_at=$2 WHERE location_id=$1",
      [LOC_A, kt(2, "18:00")],
    );
    await q(
      "DELETE FROM public.cockpit_client_days WHERE location_id=$1 AND day IN ($2, $3)",
      [LOC_A, kd(1), today],
    );
    try {
      await refresh();
      // A day ago: no lead found and the sync has not read it, so empty, not 0.
      const d1 = await dayRow(LOC_A, kd(1));
      expect(d1.crm_leads).toBeNull();
      expect(d1.crm_ad_leads).toBeNull();
      // The other sources are fresh, so the rest of the day still lands.
      expect(d1.confirmed_bookings).toBe(2);
      expect(d1.dials).toBe(1);
      expect(String((d1.sources as Record<string, Row>).leads.note)).toContain(
        "later days stay empty",
      );
      // Today: L8 is in the table, so at least 1 is true.
      expect((await dayRow(LOC_A, today)).crm_leads).toBe(1);
      expect((await dayRow(LOC_A, kd(3))).crm_leads).toBe(3);
    } finally {
      await q(
        "UPDATE public.lead_sync_state SET last_synced_at=now() WHERE location_id=$1",
        [LOC_A],
      );
    }
    await refresh();
    expect((await dayRow(LOC_A, kd(1))).crm_leads).toBe(0);
  });

  test("a Maqsam call sync that is behind: leads called after its last run stay empty, and who is waiting says so", async () => {
    await owner(db);
    await refresh();
    const calledBefore = (await dayRow(LOC_A, kd(3))).leads_called;
    expect(calledBefore).toBe(1);
    // The assigned caller's job is current; a retired caller's 30-day-old
    // job (no active dialer access) does not hold the client back.
    expect(
      ((await dayRow(LOC_A, kd(1))).sources as Record<string, Row>).dialer_leads
        .state,
    ).toBe("ok");
    await q(
      "UPDATE mahara_reporting.sync_jobs SET last_success=$2 WHERE kind='calls' AND location_id=$1",
      [AGENT, kt(2, "18:00")],
    );
    await q(
      "DELETE FROM public.cockpit_client_days WHERE location_id=$1 AND day IN ($2, $3)",
      [LOC_A, kd(1), today],
    );
    try {
      await refresh();
      const d1 = await dayRow(LOC_A, kd(1));
      // No lead called found, and the calls after the sync's last run are
      // not read yet: empty, not 0.
      expect(d1.leads_called).toBeNull();
      // Dials are the dialer's own saved outcomes, not the call sync.
      expect(d1.dials).toBe(1);
      const src = (d1.sources as Record<string, Row>).dialer_leads;
      expect(src.state).toBe("stale");
      expect(String(src.note)).toContain("Maqsam call sync last ran");
      // A closed day the sync did read is never lowered.
      expect((await dayRow(LOC_A, kd(3))).leads_called).toBe(calledBefore);
      const now = (
        await q<Row>(
          "SELECT note FROM public.cockpit_client_now WHERE location_id=$1",
          [LOC_A],
        )
      )[0];
      expect(String(now.note)).toContain(
        "leads called since then may still show as waiting",
      );
      // An error on the job is behind too, whatever its time.
      await q(
        "UPDATE mahara_reporting.sync_jobs SET last_success=now(), error='Maqsam answered 500' WHERE kind='calls' AND location_id=$1",
        [AGENT],
      );
      await refresh();
      expect(
        String(
          ((await dayRow(LOC_A, kd(1))).sources as Record<string, Row>)
            .dialer_leads.note,
        ),
      ).toContain("reports an error");
    } finally {
      await q(
        "UPDATE mahara_reporting.sync_jobs SET last_success=now(), error=NULL WHERE kind='calls' AND location_id=$1",
        [AGENT],
      );
    }
    await refresh();
    expect((await dayRow(LOC_A, kd(1))).leads_called).toBe(0);
    const now = (
      await q<Row>(
        "SELECT note FROM public.cockpit_client_now WHERE location_id=$1",
        [LOC_A],
      )
    )[0];
    expect(String(now.note)).not.toContain("Maqsam call sync");
  });

  test("running twice gives the same days", async () => {
    await owner(db);
    const before = await q<Row>(
      "SELECT location_id, day, crm_leads, confirmed_bookings, shows, no_shows, quotations, closes, revenue_usd, dials, leads_called FROM public.cockpit_client_days WHERE day BETWEEN $1 AND $2 ORDER BY 1,2",
      [FROM, today],
    );
    await refresh();
    const after = await q<Row>(
      "SELECT location_id, day, crm_leads, confirmed_bookings, shows, no_shows, quotations, closes, revenue_usd, dials, leads_called FROM public.cockpit_client_days WHERE day BETWEEN $1 AND $2 ORDER BY 1,2",
      [FROM, today],
    );
    expect(after).toEqual(before);
  });
});

describe("the rules are the code's own", () => {
  test("USD rates are tap.js USD_PER; a blank or unlisted currency is unknown", async () => {
    await owner(db);
    for (const [code, rate] of Object.entries(USD_PER)) {
      const r = (
        await q<{ r: string }>(
          "SELECT public.cockpit_board_usd_rate($1)::text AS r",
          [code],
        )
      )[0].r;
      expect(Number(r)).toBe(rate);
    }
    for (const code of ["", null, "EUR"])
      expect(
        (
          await q<{ r: unknown }>(
            "SELECT public.cockpit_board_usd_rate($1) AS r",
            [code],
          )
        )[0].r,
      ).toBeNull();
  });

  test("calendar kinds are triage.js calendarKind", async () => {
    await owner(db);
    for (const name of [
      "Main Appointment Calendar",
      "Online Appointment Calendar",
      "Not Confirmed Appointments",
      "Provisional bookings",
      "Callback Calendar",
      "Call-back",
      "Reschedule Calendar",
      "",
      "Team meeting",
      "Tentative main appointment",
      // The call centre's callback calendar at Atlantis (CALLBACK bookings only).
      "مكالمة مراجعة المشروع وتنسيق الاستشارة | Project Review & Qualification Call",
      "A. Appointment Calendar (In Office)",
    ]) {
      const r = (
        await q<{ r: string }>(
          "SELECT public.cockpit_board_calendar_kind($1) AS r",
          [name],
        )
      )[0].r;
      expect(r).toBe(calendarKind(name));
    }
  });
});

describe("the gate and the jobs", () => {
  test("no browser role reads the tables or runs the functions; the service key reads and runs the doctor only", async () => {
    await owner(db);
    for (const t of [
      "cockpit_board_clients",
      "cockpit_client_days",
      "cockpit_client_now",
    ]) {
      const r = (
        await q<Row>(
          `SELECT relrowsecurity AS rls,
          has_table_privilege('anon','public.${t}','select') AS anon,
          has_table_privilege('authenticated','public.${t}','select') AS auth,
          has_table_privilege('service_role','public.${t}','select') AS svc,
          has_table_privilege('service_role','public.${t}','insert') AS svc_write
         FROM pg_class WHERE oid='public.${t}'::regclass`,
        )
      )[0];
      expect(r).toEqual({
        rls: true,
        anon: false,
        auth: false,
        svc: true,
        svc_write: false,
      });
    }
    for (const f of [
      "cockpit_board_facts_refresh(date,date)",
      "cockpit_board_facts_run(text)",
      "cockpit_board_norm(text)",
      "cockpit_board_calendar_kind(text)",
      "cockpit_board_usd_rate(text)",
      "cockpit_board_facts_pick(text,date,date,numeric,numeric)",
    ]) {
      const r = (
        await q<Row>(
          `SELECT has_function_privilege('anon','public.${f}','execute') AS anon,
          has_function_privilege('authenticated','public.${f}','execute') AS auth,
          has_function_privilege('service_role','public.${f}','execute') AS svc`,
        )
      )[0];
      expect(r).toEqual({ anon: false, auth: false, svc: false });
    }
    const doctor = (
      await q<Row>(
        `SELECT has_function_privilege('service_role','public.cockpit_board_facts_doctor()','execute') AS svc,
        has_function_privilege('authenticated','public.cockpit_board_facts_doctor()','execute') AS auth`,
      )
    )[0];
    expect(doctor).toEqual({ svc: true, auth: false });
    const definers = await q<Row>(
      `SELECT p.proname, p.prosecdef, p.proconfig FROM pg_proc p WHERE p.proname IN ('cockpit_board_facts_refresh','cockpit_board_facts_run','cockpit_board_facts_doctor')`,
    );
    for (const p of definers) {
      expect(p.prosecdef).toBe(true);
      expect(p.proconfig).toEqual(['search_path=""']);
    }
    await actor(db, BUYER);
    await expect(q("SELECT * FROM public.cockpit_client_days")).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      q("SELECT public.cockpit_board_facts_refresh($1,$2)", [FROM, today]),
    ).rejects.toThrow(/permission denied/);
    await owner(db);
  });

  test("a window past today, over 400 days or a mode it does not know is refused in plain words", async () => {
    await owner(db);
    await expect(refresh(today, dayShift(today, 1))).rejects.toThrow(
      "Choose days up to today",
    );
    await expect(refresh(dayShift(today, -400), today)).rejects.toThrow(
      "at most 400",
    );
    await expect(
      q("SELECT public.cockpit_board_facts_run('weekly')"),
    ).rejects.toThrow("Choose recent");
  });

  test("the run wrapper refreshes 3 or 120 days and writes the state row; the jobs are scheduled once", async () => {
    await owner(db);
    const recent = (
      await q<{ r: Row }>(
        "SELECT public.cockpit_board_facts_run('recent') AS r",
      )
    )[0].r;
    expect(recent.ok).toBe(true);
    expect(recent.from).toBe(kd(2));
    let state = (
      await q<{ detail: Row }>(
        "SELECT detail FROM public.cockpit_sync_state WHERE key='board-facts'",
      )
    )[0];
    const nightly = (
      await q<{ r: Row }>(
        "SELECT public.cockpit_board_facts_run('nightly') AS r",
      )
    )[0].r;
    expect(nightly.ok).toBe(true);
    expect(nightly.from).toBe(kd(119));
    state = (
      await q<{ detail: Row }>(
        "SELECT detail FROM public.cockpit_sync_state WHERE key='board-facts'",
      )
    )[0];
    expect(state.detail.lastDeepFrom).toBe(kd(119));
    await q("SELECT public.cockpit_board_facts_run('recent')");
    state = (
      await q<{ detail: Row }>(
        "SELECT detail FROM public.cockpit_sync_state WHERE key='board-facts'",
      )
    )[0];
    expect(state.detail.lastDeepFrom).toBe(kd(119));
    const rows = (
      await q<Row>(
        "SELECT count(*)::int AS n FROM public.cockpit_client_days WHERE location_id=$1",
        [LOC_A],
      )
    )[0];
    expect(rows.n).toBe(120);

    // Apply the files again: still one job each.
    await db.exec(SQL);
    await db.exec(CHECKED);
    const jobs = await q<Row>(
      "SELECT jobname, schedule, command FROM cron.job ORDER BY jobname",
    );
    expect(jobs).toEqual([
      {
        jobname: "mahara-board-facts",
        schedule: "10,40 * * * *",
        command: "SELECT public.cockpit_board_facts_run('recent');",
      },
      {
        jobname: "mahara-board-facts-nightly",
        schedule: "50 0 * * *",
        command: "SELECT public.cockpit_board_facts_run('nightly');",
      },
    ]);
    const doctor = (
      await q<{ r: Row }>("SELECT public.cockpit_board_facts_doctor() AS r")
    )[0].r;
    expect(doctor.problems).toEqual([]);
    expect((doctor.spine as Row).activeWithoutAdAccount).toEqual([]);
  });

  test("the doctor sees a 120-day fill that failed, stopped or is too old, even after a good 30-minute run", async () => {
    await owner(db);
    const problems = async () =>
      (
        (
          await q<{ r: Row }>("SELECT public.cockpit_board_facts_doctor() AS r")
        )[0].r.problems as string[]
      ).join(" | ");

    // A fill that could not read a source, then a good 30-minute run.
    await db.exec(
      "ALTER TABLE portal_data.appointment_outcomes RENAME TO appointment_outcomes_off",
    );
    try {
      const r = (
        await q<{ r: Row }>(
          "SELECT public.cockpit_board_facts_run('nightly') AS r",
        )
      )[0].r;
      expect(r.ok).toBe(false);
    } finally {
      await owner(db);
      await db.exec(
        "ALTER TABLE portal_data.appointment_outcomes_off RENAME TO appointment_outcomes",
      );
    }
    // A 30-minute run within 3 hours of the last refill leaves it: the
    // doctor still sees the fill that failed.
    await q(
      "UPDATE public.cockpit_sync_state SET detail = jsonb_set(detail, '{lastHealAt}', to_jsonb(now())) WHERE key='board-facts'",
    );
    await q("SELECT public.cockpit_board_facts_run('recent')");
    expect(await problems()).toContain("The 120-day fill of");
    expect(await problems()).toContain("could not read outcomes");
    // Later, the next 30-minute run finds the portal reading again and fills
    // the 120 days again, so no old day keeps the failed read's note.
    await q(
      "UPDATE public.cockpit_sync_state SET detail = jsonb_set(detail, '{lastHealAt}', to_jsonb(now() - interval '4 hours')) WHERE key='board-facts'",
    );
    const healed = (
      await q<{ r: Row }>(
        "SELECT public.cockpit_board_facts_run('recent') AS r",
      )
    )[0].r;
    expect(healed.healed as string[]).toContain(`outcomes:${LOC_A}`);
    expect(healed.healOk).toBe(true);
    expect(await problems()).toBe("");
    expect(
      ((await dayRow(LOC_A, kd(60))).sources as Record<string, Row>).outcomes
        .state,
    ).toBe("ok");
    // Nothing more to heal: the next run does not fill again.
    const quiet = (
      await q<{ r: Row }>(
        "SELECT public.cockpit_board_facts_run('recent') AS r",
      )
    )[0].r;
    expect(quiet.healed).toBeUndefined();

    // A fill that stopped altogether.
    await db.exec("ALTER TABLE public.ghl_clients RENAME TO ghl_clients_off");
    try {
      const r = (
        await q<{ r: Row }>(
          "SELECT public.cockpit_board_facts_run('nightly') AS r",
        )
      )[0].r;
      expect(r.ok).toBe(false);
    } finally {
      await owner(db);
      await db.exec("ALTER TABLE public.ghl_clients_off RENAME TO ghl_clients");
    }
    await q("SELECT public.cockpit_board_facts_run('recent')");
    expect(await problems()).toContain("The 120-day fill stopped at");

    // A good fill clears both; one more than 26 hours old is named.
    await q("SELECT public.cockpit_board_facts_run('nightly')");
    expect(await problems()).toBe("");
    await q(
      "UPDATE public.cockpit_sync_state SET detail = jsonb_set(detail, '{lastDeepAt}', to_jsonb(now() - interval '30 hours')) WHERE key='board-facts'",
    );
    expect(await problems()).toContain("The 120-day fill last ran");
    await q("SELECT public.cockpit_board_facts_run('nightly')");
    expect(await problems()).toBe("");
  });
});
