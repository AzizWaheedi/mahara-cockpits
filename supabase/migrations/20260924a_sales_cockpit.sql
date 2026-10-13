-- The sales cockpit: seats, the B2B mirror, and what reps do in the cockpit.
--
-- Aziz, 2026-09-24: a cockpit for Mahara's own setters and closers, at
-- cockpit.maharamedia.com/sales/. The plan is SALES_COCKPIT_PLAN.md.
--
-- Three kinds of table live here:
--
-- 1. Seats. `cockpit_sales_people` is who may open the cockpit and what they
--    are (setter, closer, both, manager), with the ids that join them to
--    HighLevel, Maqsam, Fathom and Slack. The portal writes `via_portal`;
--    the sales manager writes the rest through the cockpit's server.
--
-- 2. The mirror. B2B (Muhammed's project, read only for us) is the record of
--    leads, appointments, Maqsam calls and signed deals, and it already
--    matches HighLevel within its 15 minute sync. The browser cannot reach
--    it, so the `sales-mirror` Edge Function copies the columns the cockpit
--    shows into `cockpit_sales_*` tables every few minutes. Nothing here
--    recomputes a B2B number: rep scorecards are B2B's own function's output,
--    stored as it returned them.
--
-- 3. What happens in the cockpit: dispositions, notes, requests for the VPS
--    worker (proposals, reviews, briefs), proposals, Fathom recordings,
--    links, settings. The browser only reads. Every write goes through the
--    `sales-api` Edge Function, which checks the seat and writes an audit
--    row in `cockpit_audit_log`.
--
-- Row security: every table has one policy, `cockpit_sales_seat()`, for
-- select only. No browser role can insert, update or delete, and the grants
-- say exactly the same thing as the policies (a missing grant once made a
-- save fail silently; a leftover anon grant once answered 200 with nothing).

begin;

-- ---------------------------------------------------------------------------
-- Seats
-- ---------------------------------------------------------------------------

create table if not exists public.cockpit_sales_people (
  email text primary key
    check (email = pg_catalog.lower(pg_catalog.btrim(email)) and email <> ''),
  name text,
  -- What the person does. A manager sees everyone's numbers and can edit
  -- seats, links and settings; the CEO always can.
  role text not null default 'setter'
    check (role in ('setter', 'closer', 'both', 'manager')),
  -- Written by the portal: true while the person has the sales cockpit on
  -- their access. Taking it away in /admin switches the seat off here.
  via_portal boolean not null default false,
  -- Written by the sales manager: a seat can be paused without touching the
  -- portal.
  active boolean not null default true,
  ghl_user_id text,
  b2b_rep_id uuid,
  maqsam_email text,
  fathom_email text,
  slack_user_id text,
  -- Weekly and monthly goals, in units and cash, set by the manager.
  goals jsonb not null default '{}'::jsonb,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text
);

comment on table public.cockpit_sales_people is
  'Sales cockpit seats. via_portal comes from the portal; role, ids and goals from the sales manager. Written only by the server.';

-- The confirmed address of whoever is asking, or null.
create or replace function public.cockpit_sales_email()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e text;
begin
  if auth.uid() is null then
    return null;
  end if;
  select pg_catalog.lower(pg_catalog.btrim(au.email))
    into e
    from auth.users as au
   where au.id = auth.uid()
     and au.email_confirmed_at is not null;
  return e;
end;
$$;

-- May this person open the sales cockpit? The CEO always may; otherwise a
-- live seat, or the sales role in the shared member directory (the
-- Supabase sign-in Muhammed is building reads that directory).
create or replace function public.cockpit_sales_seat()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e text := public.cockpit_sales_email();
begin
  if e is null then
    return false;
  end if;
  if public.cockpit_is_ceo() then
    return true;
  end if;
  if exists (
    select 1 from public.cockpit_sales_people as p
     where p.email = e and p.via_portal and p.active
  ) then
    return true;
  end if;
  return public.cockpit_has_role('sales');
end;
$$;

-- May this person see every rep and change seats, links and settings?
create or replace function public.cockpit_sales_manager()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e text := public.cockpit_sales_email();
begin
  if e is null then
    return false;
  end if;
  if public.cockpit_is_ceo() then
    return true;
  end if;
  return exists (
    select 1 from public.cockpit_sales_people as p
     where p.email = e and p.via_portal and p.active and p.role = 'manager'
  );
end;
$$;

revoke all on function public.cockpit_sales_email() from public, anon, authenticated, service_role;
revoke all on function public.cockpit_sales_seat() from public, anon, authenticated, service_role;
revoke all on function public.cockpit_sales_manager() from public, anon, authenticated, service_role;
grant execute on function public.cockpit_sales_email() to authenticated, service_role;
grant execute on function public.cockpit_sales_seat() to authenticated, service_role;
grant execute on function public.cockpit_sales_manager() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Settings and links
-- ---------------------------------------------------------------------------

create table if not exists public.cockpit_sales_settings (
  key text primary key,
  value jsonb not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists public.cockpit_sales_links (
  id uuid primary key default gen_random_uuid(),
  label text not null check (pg_catalog.btrim(label) <> ''),
  url text not null check (url ~ '^https://'),
  kind text not null default 'other'
    check (kind in ('deck', 'form', 'calculator', 'proof', 'library', 'script', 'other')),
  note text,
  sort integer not null default 100,
  active boolean not null default true,
  updated_by text,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The B2B mirror (filled by the sales-mirror Edge Function)
-- ---------------------------------------------------------------------------

-- B2B sales_reps, the roster the scorecard credits calls and closes to.
create table if not exists public.cockpit_sales_reps (
  id uuid primary key,
  display_name text,
  role text,
  ghl_user_id text,
  closer_aliases text[] not null default '{}',
  is_active boolean,
  maqsam_email text,
  fathom_email text,
  mirrored_at timestamptz not null default now()
);

-- One row per contact in the sales sub-account (B2B leads), with the form
-- answers lifted out of the custom fields by id.
create table if not exists public.cockpit_sales_leads (
  contact_id text primary key,
  name text,
  email text,
  phone text,
  -- The last eight digits, which is how Maqsam calls reach a lead (Maqsam
  -- rows carry no contact id).
  phone8 text,
  company text,
  country text,
  source text,
  tags text[] not null default '{}',
  -- qualified | unqualified | unprepared, from the roas-* tags (the lead
  -- rule of 2026-09-21), or null.
  lead_class text,
  is_lead boolean,
  contact_type text,
  dnd boolean,
  assigned_to text,
  ad_id text,
  adset_id text,
  campaign_id text,
  ad_name text,
  adset_name text,
  campaign_name text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  booking_channel text,
  -- The qualification form's answers.
  revenue text,
  readiness text,
  revenue_goal text,
  decision_maker text,
  challenge text,
  services text,
  grade text,
  setter_name text,
  lead_stage text,
  opportunity_id text,
  pipeline_id text,
  pipeline_name text,
  stage_id text,
  stage_name text,
  opp_status text,
  monetary_value numeric,
  opp_updated_at timestamptz,
  lead_created_at timestamptz,
  lead_updated_at timestamptz,
  mirrored_at timestamptz not null default now()
);

create index if not exists cockpit_sales_leads_phone8 on public.cockpit_sales_leads (phone8);
create index if not exists cockpit_sales_leads_created on public.cockpit_sales_leads (lead_created_at desc);
create index if not exists cockpit_sales_leads_stage on public.cockpit_sales_leads (stage_id);
create index if not exists cockpit_sales_leads_email on public.cockpit_sales_leads (pg_catalog.lower(email));

-- Intro and demo appointments (B2B calls), plus the Follow Up and Callback
-- calendars, which B2B does not carry and the mirror reads from HighLevel.
create table if not exists public.cockpit_sales_appointments (
  appointment_id text primary key,
  contact_id text,
  contact_name text,
  calendar_id text,
  call_type text,
  start_at timestamptz,
  booked_at timestamptz,
  status text,
  assigned_user_id text,
  assigned_user_name text,
  ad_id text,
  -- b2b: from B2B calls. ghl: read from HighLevel directly.
  origin text not null default 'b2b' check (origin in ('b2b', 'ghl')),
  mirrored_at timestamptz not null default now()
);

create index if not exists cockpit_sales_appointments_start on public.cockpit_sales_appointments (start_at);
create index if not exists cockpit_sales_appointments_contact on public.cockpit_sales_appointments (contact_id);
create index if not exists cockpit_sales_appointments_rep on public.cockpit_sales_appointments (assigned_user_id, start_at);

-- Maqsam calls (B2B maqsam_calls). Transcripts stay in B2B; the worker reads
-- them when it needs them.
create table if not exists public.cockpit_sales_dials (
  call_id text primary key,
  occurred_at timestamptz,
  agent_email text,
  agent_name text,
  sales_rep_id uuid,
  direction text,
  state text,
  duration_s integer,
  ringing_s integer,
  handling_s integer,
  lead_phone8 text,
  contact_id text,
  sentiment text,
  summary_en text,
  summary_ar text,
  has_transcript boolean,
  tags text[] not null default '{}',
  mirrored_at timestamptz not null default now()
);

create index if not exists cockpit_sales_dials_phone8 on public.cockpit_sales_dials (lead_phone8);
create index if not exists cockpit_sales_dials_at on public.cockpit_sales_dials (occurred_at desc);
create index if not exists cockpit_sales_dials_agent on public.cockpit_sales_dials (agent_email, occurred_at);

-- Signed deals (B2B closed_deals, from the New Client Form). `voided` is
-- B2B's own record_voids, shown, never silently dropped.
create table if not exists public.cockpit_sales_deals (
  response_id text primary key,
  submitted_at timestamptz,
  closer text,
  contact_id text,
  client_name text,
  business_name text,
  email text,
  phone8 text,
  country text,
  payment_structure text,
  agreement_type text,
  cash_collected numeric,
  contracted_revenue numeric,
  new_mrr numeric,
  daily_ad_spend numeric,
  csm text,
  fathom_link text,
  lead_source text,
  ad_id text,
  voided boolean not null default false,
  mirrored_at timestamptz not null default now()
);

create index if not exists cockpit_sales_deals_contact on public.cockpit_sales_deals (contact_id);
create index if not exists cockpit_sales_deals_at on public.cockpit_sales_deals (submitted_at desc);

-- B2B's b2b_rep_scorecard output, one row per window, exactly as returned.
create table if not exists public.cockpit_sales_scorecards (
  window_key text primary key,
  from_day date not null,
  to_day date not null,
  payload jsonb not null,
  computed_at timestamptz not null default now()
);

-- Each mirror run, so the cockpit can say when it last read B2B and what
-- went wrong. Missing is never zero: a failed run says so on screen.
create table if not exists public.cockpit_sales_mirror_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  mode text,
  ok boolean,
  counts jsonb not null default '{}'::jsonb,
  error text
);

create index if not exists cockpit_sales_mirror_runs_at on public.cockpit_sales_mirror_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- What happens in the cockpit
-- ---------------------------------------------------------------------------

-- Every mark a rep makes on an appointment. The newest one per appointment
-- is current; older ones are kept with superseded_at, so a change of mind
-- leaves a trail. `crm` says what happened in HighLevel.
create table if not exists public.cockpit_sales_dispositions (
  id bigint generated always as identity primary key,
  appointment_id text not null,
  contact_id text,
  call_type text,
  start_at timestamptz,
  status text not null
    check (status in ('showed', 'noshow', 'cancelled', 'rescheduled', 'invalid')),
  reason text,
  note text,
  marked_by text not null,
  marked_at timestamptz not null default now(),
  -- off: HighLevel writes are switched off. skipped: an old appointment,
  -- kept out of HighLevel on purpose. written / failed: what HighLevel said.
  crm text not null default 'off'
    check (crm in ('off', 'pending', 'written', 'skipped', 'failed')),
  crm_error text,
  crm_at timestamptz,
  superseded_at timestamptz
);

create unique index if not exists cockpit_sales_dispositions_current
  on public.cockpit_sales_dispositions (appointment_id)
  where superseded_at is null;
create index if not exists cockpit_sales_dispositions_contact
  on public.cockpit_sales_dispositions (contact_id);

create table if not exists public.cockpit_sales_notes (
  id uuid primary key default gen_random_uuid(),
  contact_id text not null,
  appointment_id text,
  kind text not null default 'note'
    check (kind in ('note', 'call', 'script', 'ai', 'handoff')),
  body text not null default '',
  fields jsonb not null default '{}'::jsonb,
  author text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists cockpit_sales_notes_contact
  on public.cockpit_sales_notes (contact_id, created_at desc);

-- Work for the VPS worker (hermes/sales-desk): proposals, call reviews,
-- briefs, research. Claimed one at a time, four tries.
create table if not exists public.cockpit_sales_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null
    check (kind in ('proposal', 'review', 'brief', 'research', 'followup', 'eod', 'recordings')),
  contact_id text,
  appointment_id text,
  params jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  claimed_by text,
  attempts integer not null default 0,
  finished_at timestamptz,
  error text,
  result jsonb
);

create index if not exists cockpit_sales_requests_open
  on public.cockpit_sales_requests (status, requested_at);
create index if not exists cockpit_sales_requests_contact
  on public.cockpit_sales_requests (contact_id, requested_at desc);

-- Fathom recordings of sales calls, per rep, matched to a lead where the
-- worker could. Transcripts stay in Fathom.
create table if not exists public.cockpit_sales_recordings (
  recording_id text primary key,
  title text,
  recorded_by text,
  started_at timestamptz,
  duration_s integer,
  share_url text,
  contact_id text,
  appointment_id text,
  -- how the match was made: email, appointment, phone, title, none
  matched_by text,
  indexed_at timestamptz not null default now()
);

create index if not exists cockpit_sales_recordings_contact
  on public.cockpit_sales_recordings (contact_id);
create index if not exists cockpit_sales_recordings_at
  on public.cockpit_sales_recordings (started_at desc);

-- The AI sales proposal (the engine brought over from Mahara-B2B
-- proposals/, run by our worker under our keys).
create table if not exists public.cockpit_sales_proposals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid references public.cockpit_sales_requests (id),
  contact_id text,
  appointment_id text,
  recording_id text,
  lang text not null default 'ar' check (lang in ('ar', 'en')),
  -- specific | general | blind: how much of the call the draft could use
  variant text,
  status text not null default 'drafting'
    check (status in ('drafting', 'needs_input', 'ready', 'sent', 'failed', 'archived')),
  deal jsonb,
  validation jsonb,
  fill_count integer,
  html_path text,
  pdf_path text,
  model text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by text,
  error text
);

create index if not exists cockpit_sales_proposals_contact
  on public.cockpit_sales_proposals (contact_id, created_at desc);

-- The worker's own health, one row per job, shaped like social_worker_status.
create table if not exists public.cockpit_sales_worker_status (
  worker text not null,
  job text not null,
  ok boolean not null,
  detail text,
  at timestamptz not null default now(),
  primary key (worker, job)
);

-- ---------------------------------------------------------------------------
-- Row security and grants: select for a seat, nothing else for a browser
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'cockpit_sales_people',
    'cockpit_sales_settings',
    'cockpit_sales_links',
    'cockpit_sales_reps',
    'cockpit_sales_leads',
    'cockpit_sales_appointments',
    'cockpit_sales_dials',
    'cockpit_sales_deals',
    'cockpit_sales_scorecards',
    'cockpit_sales_mirror_runs',
    'cockpit_sales_dispositions',
    'cockpit_sales_notes',
    'cockpit_sales_requests',
    'cockpit_sales_recordings',
    'cockpit_sales_proposals',
    'cockpit_sales_worker_status'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_seat_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.cockpit_sales_seat())',
      t || '_seat_read', t
    );
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end;
$$;

grant usage, select on sequence public.cockpit_sales_mirror_runs_id_seq to service_role;
grant usage, select on sequence public.cockpit_sales_dispositions_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- Seeds
-- ---------------------------------------------------------------------------

-- The founder is the first manager. Everyone else arrives through the portal
-- once Aziz names the team (the rosters disagree today, so none is guessed).
insert into public.cockpit_sales_people (email, name, role, via_portal, ghl_user_id, updated_by)
values
  ('aziz@maharamedia.com', 'Aziz Waheedi', 'manager', true, 'Q4DIfzNbhg1BXJCsipwW', 'migration'),
  ('awaheedi2008@gmail.com', 'Aziz Waheedi', 'manager', true, 'Q4DIfzNbhg1BXJCsipwW', 'migration')
on conflict (email) do nothing;

insert into public.cockpit_sales_settings (key, value, updated_by)
values
  -- Marking a call in the cockpit writes HighLevel only once Aziz says yes.
  -- Appointments older than backlog_days are never written, so an old lead
  -- does not get a no-show message.
  ('crm_writes', '{"dispositions": false, "backlog_days": 7}'::jsonb, 'migration'),
  -- Which calendar is which kind of call. The intro pair is read from the
  -- booking pages (B2B's calendar_call_type_map has their labels swapped).
  ('calendars', '{
     "cFeDl0FY8iaXll61lus8": {"type": "intro", "label": "Intro (unqualified page)"},
     "dsqmJ393Dwl9fDSbIVOI": {"type": "intro", "label": "Intro (qualified page)"},
     "jQqXS1YuFnmGZKLkrE62": {"type": "demo", "label": "Demo"},
     "NDBNz6Og4yfpdpWmHrue": {"type": "demo", "label": "Demo 2"},
     "JTNg1Wd62qxuT8W8sroh": {"type": "follow_up", "label": "Follow up call"},
     "Vo8Jh1EJQE3pzwsKebxK": {"type": "callback", "label": "Callback request"}
   }'::jsonb, 'migration'),
  ('pipeline', '{"id": "96oywOezX39jQzXP3Mg0", "name": "Sales Pipeline (2-Call)"}'::jsonb, 'migration')
on conflict (key) do nothing;

insert into public.cockpit_sales_links (label, url, kind, note, sort, updated_by)
select * from (values
  ('Pitch deck', 'https://pitch.com/v/maharamedia-startup-deck-2aba8c', 'deck',
   'The 48-slide Gulf Arabic deck for the demo.', 10, 'migration'),
  ('New client form', 'https://maharamedia.typeform.com/to/BTzMwXiw', 'form',
   'Fill it the moment a client signs. It starts onboarding.', 20, 'migration'),
  ('Closer end of day', 'https://maharamedia.typeform.com/to/BfnrbVWJ', 'form',
   'Until the end of day is filed in the cockpit.', 30, 'migration'),
  ('Setter end of day', 'https://maharamedia.typeform.com/to/x0FWfEpA', 'form',
   'Until the end of day is filed in the cockpit.', 40, 'migration')
) as v(label, url, kind, note, sort, updated_by)
where not exists (select 1 from public.cockpit_sales_links);

commit;
