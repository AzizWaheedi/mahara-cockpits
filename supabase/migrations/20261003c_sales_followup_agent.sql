-- The follow-up agent, phases 0 and 1 (final_spec_p3.md, names from the
-- consistency check's glossary, 2026-10-03): only what reactivation waves
-- and per-kind levels need. The rest of P3's tables (followup_meta,
-- reply_waits, push_subs) come with the phases that use them.
--
-- cockpit_sales_followup_levels: one row per kind (segment x language x
--   channel, for example no_show:ar:whatsapp_template) with its level:
--   approve, send_unless_stopped, sends_by_itself or off ("Approve", "Sends
--   unless stopped", "Sends by itself", "Off"). It replaces the live
--   followups.autosend switches. A kind with no row is at Approve.
-- cockpit_sales_followup_waves: a reactivation wave over one pool of
--   backlog leads, 40 a day by default, with a 10% holdout.
-- cockpit_sales_followup_wave_members: who is in a wave and in which arm
--   (wave or holdout). A contact is in at most one running wave.
--
-- Rules the database keeps:
--   * one running wave per contact (unique index on running members);
--   * a wave that is done or cancelled closes its running members, so a
--     contact is never stuck out of the next wave;
--   * a WhatsApp kind cannot be set to send without a person (Sends unless
--     stopped, Sends by itself) until whatsapp_guard has connector_off true
--     and a single_copy_ok_at time (glossary 1.4).
--
-- Every seat reads; only sales-api and the sales desk write (service role).
-- Copies the pattern of 20261002e_sales_client_forms.sql.

begin;

-- 1. Levels ------------------------------------------------------------------

create table if not exists public.cockpit_sales_followup_levels (
  kind_key   text primary key check (kind_key ~ '^[a-z][a-z0-9_]*(:[a-z0-9_]+){0,3}$' and length(kind_key) <= 80),
  level      text not null default 'approve'
               check (level in ('approve', 'send_unless_stopped', 'sends_by_itself', 'off')),
  suggested  text check (suggested is null or suggested in ('approve', 'send_unless_stopped', 'sends_by_itself', 'off')),
  set_by     text,
  reason     text check (reason is null or length(reason) <= 500),
  version    integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now()
);
comment on table public.cockpit_sales_followup_levels is
  'How far each follow-up kind (segment:language:channel) may send without a person: approve, send_unless_stopped, sends_by_itself, off. A kind with no row is at approve. suggested is the system''s proposed move; the manager confirms it.';

create or replace function public.cockpit_sales_followup_levels_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  g jsonb;
begin
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  if new.level in ('send_unless_stopped', 'sends_by_itself') and new.kind_key like '%whatsapp%' then
    g := coalesce((select s.value from public.cockpit_sales_settings as s where s.key = 'whatsapp_guard'), '{}'::jsonb);
    if not (coalesce(g -> 'connector_off' = 'true'::jsonb, false)
            and coalesce(jsonb_typeof(g -> 'single_copy_ok_at') = 'string', false)) then
      raise exception 'WhatsApp follow-ups stay on Approve until the WA Connector is off and the single-copy test has passed.'
        using errcode = 'P0001',
              hint = 'Set whatsapp_guard.connector_off to true and record single_copy_ok_at after the test.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.cockpit_sales_followup_levels_guard() from public, anon, authenticated;

drop trigger if exists cockpit_sales_followup_levels_guard on public.cockpit_sales_followup_levels;
create trigger cockpit_sales_followup_levels_guard
  before insert or update on public.cockpit_sales_followup_levels
  for each row execute function public.cockpit_sales_followup_levels_guard();

-- 2. Waves -------------------------------------------------------------------

create table if not exists public.cockpit_sales_followup_waves (
  id            uuid primary key default gen_random_uuid(),
  pool          text not null check (pool ~ '^[a-z][a-z0-9_]{0,39}$'),
  segment       text not null check (segment ~ '^[a-z][a-z0-9_]{0,39}$'),
  per_day       integer not null default 40 check (per_day between 1 and 500),
  holdout_share numeric(4, 3) not null default 0.1 check (holdout_share >= 0 and holdout_share < 1),
  state         text not null default 'planned' check (state in ('planned', 'running', 'paused', 'done', 'cancelled')),
  made_by       text not null check (length(made_by) between 1 and 200),
  note          text check (note is null or length(note) <= 500),
  version       integer not null default 1 check (version >= 1),
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  ended_at      timestamptz,
  updated_at    timestamptz not null default now(),
  constraint cockpit_sales_followup_waves_final_check check (state not in ('done', 'cancelled') or ended_at is not null)
);
comment on table public.cockpit_sales_followup_waves is
  'Reactivation waves over the backlog: pool (for example no_show_cancelled, good_intro, unclosed_demo, never_booked), the segment its drafts use, per_day (40), and the holdout share (0.1, by sha256(''waves:''||contact_id) in the desk). Wave sends do not count toward followups.per_day.';

create table if not exists public.cockpit_sales_followup_wave_members (
  wave_id     uuid not null references public.cockpit_sales_followup_waves (id) on delete cascade,
  contact_id  text not null check (contact_id <> ''),
  arm         text not null check (arm in ('wave', 'holdout')),
  state       text not null default 'added'
                check (state in ('added', 'drafted', 'sent', 'replied', 'booked', 'excluded', 'done')),
  followup_id uuid references public.cockpit_sales_followups (id) on delete set null,
  reason      text check (reason is null or length(reason) <= 200),
  added_at    timestamptz not null default now(),
  drafted_at  timestamptz,
  sent_at     timestamptz,
  outcome_at  timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (wave_id, contact_id),
  constraint cockpit_sales_followup_wave_members_holdout_check
    check (arm = 'wave' or state in ('added', 'excluded', 'done'))
);
comment on table public.cockpit_sales_followup_wave_members is
  'Who is in each wave and which arm. Running states are added, drafted and sent (a sent member stays running for 14 days, then done). A holdout member is never drafted. A contact is in at most one running wave.';

create unique index if not exists cockpit_sales_followup_wave_members_one_running
  on public.cockpit_sales_followup_wave_members (contact_id)
  where state in ('added', 'drafted', 'sent');
create index if not exists cockpit_sales_followup_wave_members_wave
  on public.cockpit_sales_followup_wave_members (wave_id, arm, state);
create index if not exists cockpit_sales_followup_waves_state
  on public.cockpit_sales_followup_waves (state, created_at desc);

create or replace function public.cockpit_sales_followup_waves_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
    if old.state in ('done', 'cancelled') and new.state is distinct from old.state then
      raise exception 'This wave has already ended (%). Start a new wave instead.', old.state
        using errcode = 'P0001';
    end if;
  end if;
  new.updated_at := now();
  if new.state = 'running' and new.started_at is null then new.started_at := now(); end if;
  if new.state in ('done', 'cancelled') and new.ended_at is null then new.ended_at := now(); end if;
  return new;
end;
$$;
revoke all on function public.cockpit_sales_followup_waves_guard() from public, anon, authenticated;

drop trigger if exists cockpit_sales_followup_waves_guard on public.cockpit_sales_followup_waves;
create trigger cockpit_sales_followup_waves_guard
  before insert or update on public.cockpit_sales_followup_waves
  for each row execute function public.cockpit_sales_followup_waves_guard();

-- When a wave ends, its running members close: never drafted becomes
-- excluded (holdout becomes done, its job is finished), sent becomes done.
create or replace function public.cockpit_sales_followup_waves_close_members()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.cockpit_sales_followup_wave_members as m
     set state = case
                   when m.arm = 'holdout' then 'done'
                   when m.state = 'sent' then 'done'
                   else 'excluded'
                 end,
         reason = coalesce(m.reason, 'wave_' || new.state)
   where m.wave_id = new.id and m.state in ('added', 'drafted', 'sent');
  return null;
end;
$$;
revoke all on function public.cockpit_sales_followup_waves_close_members() from public, anon, authenticated;

drop trigger if exists cockpit_sales_followup_waves_close_members on public.cockpit_sales_followup_waves;
create trigger cockpit_sales_followup_waves_close_members
  after update of state on public.cockpit_sales_followup_waves
  for each row
  when (new.state in ('done', 'cancelled') and old.state is distinct from new.state)
  execute function public.cockpit_sales_followup_waves_close_members();

create or replace function public.cockpit_sales_followup_wave_members_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.state = 'drafted' and new.drafted_at is null then new.drafted_at := now(); end if;
  if new.state = 'sent' and new.sent_at is null then new.sent_at := now(); end if;
  if new.state in ('replied', 'booked') and new.outcome_at is null then new.outcome_at := now(); end if;
  return new;
end;
$$;
revoke all on function public.cockpit_sales_followup_wave_members_touch() from public, anon, authenticated;

drop trigger if exists cockpit_sales_followup_wave_members_touch on public.cockpit_sales_followup_wave_members;
create trigger cockpit_sales_followup_wave_members_touch
  before insert or update on public.cockpit_sales_followup_wave_members
  for each row execute function public.cockpit_sales_followup_wave_members_touch();

-- 3. Row security and grants -------------------------------------------------

alter table public.cockpit_sales_followup_levels enable row level security;
drop policy if exists cockpit_sales_followup_levels_seat_read on public.cockpit_sales_followup_levels;
create policy cockpit_sales_followup_levels_seat_read on public.cockpit_sales_followup_levels
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on public.cockpit_sales_followup_levels from public, anon, authenticated;
grant select on public.cockpit_sales_followup_levels to authenticated;
grant all on public.cockpit_sales_followup_levels to service_role;

alter table public.cockpit_sales_followup_waves enable row level security;
drop policy if exists cockpit_sales_followup_waves_seat_read on public.cockpit_sales_followup_waves;
create policy cockpit_sales_followup_waves_seat_read on public.cockpit_sales_followup_waves
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on public.cockpit_sales_followup_waves from public, anon, authenticated;
grant select on public.cockpit_sales_followup_waves to authenticated;
grant all on public.cockpit_sales_followup_waves to service_role;

alter table public.cockpit_sales_followup_wave_members enable row level security;
drop policy if exists cockpit_sales_followup_wave_members_seat_read on public.cockpit_sales_followup_wave_members;
create policy cockpit_sales_followup_wave_members_seat_read on public.cockpit_sales_followup_wave_members
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on public.cockpit_sales_followup_wave_members from public, anon, authenticated;
grant select on public.cockpit_sales_followup_wave_members to authenticated;
grant all on public.cockpit_sales_followup_wave_members to service_role;

notify pgrst, 'reload schema';

commit;
