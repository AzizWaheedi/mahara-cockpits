-- The follow-up agent, phases 0 and 1 (final_spec_p3.md, names from the
-- consistency check's glossary, 2026-10-03), in the exact shape the sales
-- desk already reads and writes (hermes/sales-desk/desk/waves.py and
-- desk/followups.py, lane lc-desk, NOTES-followup-agent.md section 2).
--
-- cockpit_sales_followup_levels: one row per kind, segment.language.channel
--   (for example reactivate.ar.whatsapp_template, the key the desk writes),
--   with its level: approve, send_unless_stopped, sends_by_itself or off
--   ("Approve", "Sends unless stopped", "Sends by itself", "Off"). It replaces
--   the live followups.autosend switches. A kind with no row is at Approve.
-- cockpit_sales_followup_waves: a reactivation wave over one pool of backlog
--   leads (no_show_cancelled, good_intro, unclosed_demo, never_booked), 40 a
--   day by default, with a 10% holdout. One running wave per pool.
-- cockpit_sales_followup_wave_members: who is in a wave and in which arm.
--   The desk enrols wave members as waiting and holdout members as held_out,
--   with event_at (when the lead entered the pool, for newest first).
-- cockpit_sales_followup_meta: one row per draft the agent manages: its kind,
--   its wave, when an approved batch sends it (send_after), who held or
--   approved it, and the outcome times.
-- cockpit_sales_followup_stops: a lead's stop words, kept for a rep:
--   unsubscribe (asked), any other stop word (paused 30 days), or a rep's own
--   pause (manual). The agent never sets do-not-disturb itself.
--
-- Rules the database keeps:
--   * one running wave per contact (waiting, held_out or drafted) and one
--     running or paused wave per pool;
--   * a holdout member is never drafted or sent, but its replies, bookings
--     and 14-day close are recorded, so the wave-versus-holdout comparison
--     is stored per member;
--   * a wave that is done keeps its members as they are: the desk winds it
--     down (desk/waves.py wind_down and finish: open openers taken back,
--     waiting members and held-back members whose turn never came excluded)
--     and watches the rest to their 14 days, so no opener is left open and
--     no holdout member drops out of the comparison;
--   * a kind key names a known segment, language and channel, and a WhatsApp
--     kind cannot be set to send without a person (Sends unless stopped,
--     Sends by itself) until whatsapp_guard has connector_off true and a
--     single_copy_ok_at time (glossary 1.4).
--
-- Integration pass (contract-v2.md section 10, item 9, 2026-10-03): the
-- columns the desk writes (waves enrolled_at, done_reason, settled_at;
-- members next_try_at, later_reason, fail_count, last_error, due_at,
-- replied_at, booked_at, closed_at; meta hold_reason), the member state
-- closed, and the indexes the desk reads by.
--
-- Settings: whatsapp_guard and followups gain only the keys they lack
-- (glossary 1.4), with one audit row each; opener_en/ar template rows are
-- added inactive. Every seat reads; only sales-api and the sales desk write
-- (service role). Copies the pattern of 20261002e_sales_client_forms.sql.

begin;

-- 0. The kind key -------------------------------------------------------------

-- segment.language.channel: the nine follow-up segments, ar or en, and the
-- three follow-up channels (cockpit_sales_followups_channel_check).
create or replace function public.cockpit_sales_kind_key_ok(p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_key ~ '^(reply|confirm|no_show|cancelled|new|after_call|nurture|good_intro|reactivate)\.(ar|en)\.(whatsapp|whatsapp_template|email)$', false)
$$;
revoke all on function public.cockpit_sales_kind_key_ok(text) from public, anon;
grant execute on function public.cockpit_sales_kind_key_ok(text) to authenticated, service_role;

-- 1. Levels ------------------------------------------------------------------

create table if not exists public.cockpit_sales_followup_levels (
  kind_key   text primary key constraint cockpit_sales_followup_levels_kind_key_check
               check (public.cockpit_sales_kind_key_ok(kind_key)),
  level      text not null default 'approve'
               check (level in ('approve', 'send_unless_stopped', 'sends_by_itself', 'off')),
  suggested  text check (suggested is null or suggested in ('approve', 'send_unless_stopped', 'sends_by_itself', 'off')),
  set_by     text,
  reason     text check (reason is null or length(reason) <= 500),
  version    integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now()
);
comment on table public.cockpit_sales_followup_levels is
  'How far each follow-up kind (segment.language.channel, for example no_show.ar.whatsapp_template) may send without a person: approve, send_unless_stopped, sends_by_itself, off. A kind with no row is at approve. suggested is the system''s proposed move; the manager confirms it.';

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
  if new.level in ('send_unless_stopped', 'sends_by_itself')
     and split_part(new.kind_key, '.', 3) in ('whatsapp', 'whatsapp_template') then
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
  pool          text not null check (pool in ('no_show_cancelled', 'good_intro', 'unclosed_demo', 'never_booked')),
  segment       text not null default 'reactivate' check (segment in
                  ('reply', 'confirm', 'no_show', 'cancelled', 'new', 'after_call', 'nurture', 'good_intro', 'reactivate')),
  per_day       integer not null default 40 check (per_day between 0 and 200),
  holdout_share numeric(4, 3) not null default 0.1 check (holdout_share >= 0 and holdout_share <= 0.5),
  -- The desk's four states (NOTES section 2): a manager's stop and the
  -- desk's own end are both done, with done_reason.
  state         text not null default 'draft' check (state in ('draft', 'running', 'paused', 'done')),
  made_by       text not null check (length(made_by) between 1 and 200),
  note          text check (note is null or length(note) <= 500),
  version       integer not null default 1 check (version >= 1),
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  -- Set by the desk once every chunk of the pool is in the wave.
  enrolled_at   timestamptz,
  ended_at      timestamptz,
  -- Why the wave ended: the desk's sentence, or "Stopped by a manager."
  done_reason   text check (done_reason is null or length(done_reason) <= 300),
  -- Set by the desk once a done wave has no member left to let go of or watch.
  settled_at    timestamptz,
  updated_at    timestamptz not null default now(),
  constraint cockpit_sales_followup_waves_final_check check (state <> 'done' or ended_at is not null)
);
comment on table public.cockpit_sales_followup_waves is
  'Reactivation waves over the backlog: pool (no_show_cancelled, good_intro, unclosed_demo, never_booked), the segment its drafts use (reactivate), per_day (40), and the holdout share (0.1, by sha256(''waves:''||contact_id) in the desk). sales-api followup.wave starts it (running), pauses, resumes and stops it (done, done_reason "Stopped by a manager."); the desk sets enrolled_at once the pool is in, done when nobody is left to write to, and settled_at once nobody is left to watch. Wave sends do not count toward followups.per_day.';

create unique index if not exists cockpit_sales_followup_waves_one_running_pool
  on public.cockpit_sales_followup_waves (pool)
  where state in ('running', 'paused');
create index if not exists cockpit_sales_followup_waves_state
  on public.cockpit_sales_followup_waves (state, created_at desc);
create index if not exists cockpit_sales_followup_waves_settled
  on public.cockpit_sales_followup_waves (state, settled_at);

create table if not exists public.cockpit_sales_followup_wave_members (
  wave_id         uuid not null references public.cockpit_sales_followup_waves (id) on delete cascade,
  contact_id      text not null check (contact_id <> ''),
  arm             text not null check (arm in ('wave', 'holdout')),
  -- closed: 14 days after the opener (or a holdout member's due_at) with no
  -- booking. done and failed stay valid for older writers.
  state           text not null default 'waiting'
                    check (state in ('waiting', 'held_out', 'drafted', 'sent', 'excluded', 'failed', 'replied', 'booked',
                                     'closed', 'done')),
  followup_id     uuid references public.cockpit_sales_followups (id) on delete set null,
  event_at        timestamptz,
  excluded_reason text check (excluded_reason is null or length(excluded_reason) <= 300),
  added_at        timestamptz not null default now(),
  drafted_at      timestamptz,
  -- A waiting member is not looked at before this, and later_reason says why.
  next_try_at     timestamptz,
  later_reason    text check (later_reason is null or length(later_reason) <= 300),
  fail_count      integer not null default 0 check (fail_count >= 0),
  last_error      text check (last_error is null or length(last_error) <= 300),
  -- Wave arm: when the opener went. Holdout arm: when their 14 days start.
  sent_at         timestamptz,
  due_at          timestamptz,
  replied_at      timestamptz,
  booked_at       timestamptz,
  closed_at       timestamptz,
  outcome_at      timestamptz,
  updated_at      timestamptz not null default now(),
  primary key (wave_id, contact_id),
  -- A holdout member is never written to: no draft, no send, no failure.
  constraint cockpit_sales_followup_wave_members_holdout_check
    check (arm = 'wave' or state in ('held_out', 'replied', 'booked', 'closed', 'excluded', 'done')),
  constraint cockpit_sales_followup_wave_members_wave_check
    check (arm = 'holdout' or state <> 'held_out')
);
comment on table public.cockpit_sales_followup_wave_members is
  'Who is in each wave and which arm. Running states are waiting, held_out and drafted (a contact is in at most one running wave, whatever that wave''s state). A drafted member follows its draft: sent, excluded (a rep skipped it, excluded_reason), or waiting again (next_try_at, later_reason, fail_count, last_error) when the draft expired or failed once. Outcomes (replied, booked, closed after 14 days) are recorded for both arms from sent_at (wave) or due_at (holdout), for the comparison. event_at is when the lead entered the pool.';

create unique index if not exists cockpit_sales_followup_wave_members_one_running
  on public.cockpit_sales_followup_wave_members (contact_id)
  where state in ('waiting', 'held_out', 'drafted');
create index if not exists cockpit_sales_followup_wave_members_wave
  on public.cockpit_sales_followup_wave_members (wave_id, state, event_at desc);
create index if not exists cockpit_sales_followup_wave_members_drafted
  on public.cockpit_sales_followup_wave_members (wave_id, drafted_at);
create index if not exists cockpit_sales_followup_wave_members_state
  on public.cockpit_sales_followup_wave_members (state, drafted_at);
create index if not exists cockpit_sales_followup_wave_members_next_try
  on public.cockpit_sales_followup_wave_members (wave_id, state, next_try_at);
create index if not exists cockpit_sales_followup_wave_members_sent
  on public.cockpit_sales_followup_wave_members (sent_at) where sent_at is not null;
create index if not exists cockpit_sales_followup_wave_members_due
  on public.cockpit_sales_followup_wave_members (due_at) where due_at is not null;

create or replace function public.cockpit_sales_followup_waves_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
    if old.state = 'done' and new.state is distinct from old.state then
      raise exception 'This wave has already ended (%). Start a new wave instead.', old.state
        using errcode = 'P0001';
    end if;
  end if;
  new.updated_at := now();
  if new.state = 'running' and new.started_at is null then new.started_at := now(); end if;
  if new.state = 'done' and new.ended_at is null then new.ended_at := now(); end if;
  return new;
end;
$$;
revoke all on function public.cockpit_sales_followup_waves_guard() from public, anon, authenticated;

drop trigger if exists cockpit_sales_followup_waves_guard on public.cockpit_sales_followup_waves;
create trigger cockpit_sales_followup_waves_guard
  before insert or update on public.cockpit_sales_followup_waves
  for each row execute function public.cockpit_sales_followup_waves_guard();

-- A wave that ends keeps its members: the desk winds it down within five
-- minutes (desk/waves.py wind_down and finish) because only it knows which
-- openers are still open and whose 14 days have started. An earlier draft of
-- this migration closed them here, which hid held-back members from the
-- comparison and left open openers behind; it is removed if present.
drop trigger if exists cockpit_sales_followup_waves_close_members on public.cockpit_sales_followup_waves;
drop function if exists public.cockpit_sales_followup_waves_close_members();

create or replace function public.cockpit_sales_followup_wave_members_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.state = 'drafted' and new.drafted_at is null then new.drafted_at := now(); end if;
  if new.state = 'sent' and new.sent_at is null then new.sent_at := now(); end if;
  if new.state = 'replied' and new.replied_at is null then new.replied_at := now(); end if;
  if new.state = 'booked' and new.booked_at is null then new.booked_at := now(); end if;
  if new.state = 'closed' and new.closed_at is null then new.closed_at := now(); end if;
  if new.state in ('replied', 'booked', 'closed') and new.outcome_at is null then new.outcome_at := now(); end if;
  return new;
end;
$$;
revoke all on function public.cockpit_sales_followup_wave_members_touch() from public, anon, authenticated;

drop trigger if exists cockpit_sales_followup_wave_members_touch on public.cockpit_sales_followup_wave_members;
create trigger cockpit_sales_followup_wave_members_touch
  before insert or update on public.cockpit_sales_followup_wave_members
  for each row execute function public.cockpit_sales_followup_wave_members_touch();

-- 3. Draft meta --------------------------------------------------------------

create table if not exists public.cockpit_sales_followup_meta (
  followup_id    uuid primary key references public.cockpit_sales_followups (id) on delete cascade,
  kind_key       text constraint cockpit_sales_followup_meta_kind_key_check
                   check (kind_key is null or public.cockpit_sales_kind_key_ok(kind_key)),
  level_at_draft text check (level_at_draft is null or level_at_draft in ('approve', 'send_unless_stopped', 'sends_by_itself', 'off')),
  send_after     timestamptz,
  held_by        text check (held_by is null or length(held_by) between 1 and 200),
  held_at        timestamptz,
  -- The refusal that set the draft aside (held_by sales-desk), or null.
  hold_reason    text check (hold_reason is null or length(hold_reason) <= 300),
  approved_by    text check (approved_by is null or length(approved_by) between 1 and 200),
  approved_at    timestamptz,
  intent         text check (intent is null or intent ~ '^[a-z][a-z0-9_]{0,39}$'),
  edit_ratio     numeric(4, 3) check (edit_ratio is null or (edit_ratio >= 0 and edit_ratio <= 1)),
  wave_id        uuid references public.cockpit_sales_followup_waves (id) on delete set null,
  live_id        uuid references public.cockpit_sales_live (id) on delete set null,
  room_id        uuid references public.cockpit_sales_rooms (id) on delete set null,
  crm_note_id    text,
  replied_at     timestamptz,
  booked_at      timestamptz,
  showed_at      timestamptz,
  closed_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.cockpit_sales_followup_meta is
  'One row per draft the agent manages: kind_key (segment.language.channel), the level when it was drafted, wave_id for a backlog opener, send_after for an approved batch (one every followups.waves.batch_gap_s), held_by when someone held it (sales-desk when a send was refused, with hold_reason; the desk re-reads it before each send), approved_by, how much a rep edited it, the handover or room it led to, the HighLevel note, and the outcome times.';

create index if not exists cockpit_sales_followup_meta_due
  on public.cockpit_sales_followup_meta (send_after)
  where held_by is null and send_after is not null;
create index if not exists cockpit_sales_followup_meta_wave
  on public.cockpit_sales_followup_meta (wave_id) where wave_id is not null;

create or replace function public.cockpit_sales_followup_meta_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.held_by is not null and new.held_at is null then new.held_at := now(); end if;
  if new.held_by is null then new.held_at := null; new.hold_reason := null; end if;
  if new.approved_by is not null and new.approved_at is null then new.approved_at := now(); end if;
  return new;
end;
$$;
revoke all on function public.cockpit_sales_followup_meta_touch() from public, anon, authenticated;

drop trigger if exists cockpit_sales_followup_meta_touch on public.cockpit_sales_followup_meta;
create trigger cockpit_sales_followup_meta_touch
  before insert or update on public.cockpit_sales_followup_meta
  for each row execute function public.cockpit_sales_followup_meta_touch();

-- 4. Stops -------------------------------------------------------------------

create table if not exists public.cockpit_sales_followup_stops (
  contact_id   text not null check (contact_id <> ''),
  said_at      timestamptz not null,
  kind         text not null check (kind in ('unsubscribe', 'pause', 'manual')),
  said         text check (said is null or length(said) <= 200),
  state        text not null check (state in ('asked', 'paused', 'dnd', 'resumed')),
  paused_until timestamptz,
  created_by   text not null default 'sales-desk' check (length(created_by) between 1 and 200),
  created_at   timestamptz not null default now(),
  decided_by   text check (decided_by is null or length(decided_by) between 1 and 200),
  decided_at   timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (contact_id, said_at),
  constraint cockpit_sales_followup_stops_paused_check check (state <> 'paused' or paused_until is not null)
);
comment on table public.cockpit_sales_followup_stops is
  'A lead''s stop words, kept for a rep (the agent never sets do-not-disturb): kind unsubscribe waits as asked until a rep answers (dnd, paused or resumed); kind pause is paused for followups.stop_pause_days (30) from the lead''s message; kind manual is a rep''s own pause of the agent for this lead. A later message without a stop word lifts it. The primary key (contact_id, said_at) also serves the newest-first read per lead.';

create or replace function public.cockpit_sales_followup_stops_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.state is distinct from old.state and new.decided_at is null then
    new.decided_at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.cockpit_sales_followup_stops_touch() from public, anon, authenticated;

drop trigger if exists cockpit_sales_followup_stops_touch on public.cockpit_sales_followup_stops;
create trigger cockpit_sales_followup_stops_touch
  before insert or update on public.cockpit_sales_followup_stops
  for each row execute function public.cockpit_sales_followup_stops_touch();

-- 5. Row security and grants -------------------------------------------------

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

-- A draft's meta is read by whoever may read the draft (followups row
-- security: the owner, an unowned draft, or a manager).
alter table public.cockpit_sales_followup_meta enable row level security;
drop policy if exists cockpit_sales_followup_meta_seat_read on public.cockpit_sales_followup_meta;
create policy cockpit_sales_followup_meta_seat_read on public.cockpit_sales_followup_meta
  for select to authenticated using (
    public.cockpit_sales_seat()
    and exists (select 1 from public.cockpit_sales_followups as f where f.id = cockpit_sales_followup_meta.followup_id));
revoke all on public.cockpit_sales_followup_meta from public, anon, authenticated;
grant select on public.cockpit_sales_followup_meta to authenticated;
grant all on public.cockpit_sales_followup_meta to service_role;

alter table public.cockpit_sales_followup_stops enable row level security;
drop policy if exists cockpit_sales_followup_stops_seat_read on public.cockpit_sales_followup_stops;
create policy cockpit_sales_followup_stops_seat_read on public.cockpit_sales_followup_stops
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on public.cockpit_sales_followup_stops from public, anon, authenticated;
grant select on public.cockpit_sales_followup_stops to authenticated;
grant all on public.cockpit_sales_followup_stops to service_role;

-- 6. Settings: only the keys each one lacks (glossary 1.4) --------------------
-- followups: cadence.after_call stays as it is ([24, 72] today); its 30-day
-- form is P3 phase 2's change. autosend stays until followup_levels takes
-- over in sales-api.

select public.cockpit_sales_settings_add_missing('whatsapp_guard',
  $json${"connector_off": false, "single_copy_ok_at": null, "dup_window_s": 60, "template_budget_usd_month": 100,
         "health": {"room": {"window": 20, "fail_share": 0.3},
                    "thread": {"window": 20, "fail_share": 0.3},
                    "followup": {"window": 20, "fail_share": 0.3}}}$json$::jsonb,
  'migration 20261003c',
  'One WhatsApp safety home (glossary 1.4): every WhatsApp switch stays shut until the WA Connector is off and the single-copy test has passed; one budget and per-source health for every sender.');

select public.cockpit_sales_settings_add_missing('followups',
  $json${"first_hours": [9, 18],
         "cadence": {"good_intro": [24, 72, 168, 336]},
         "waves": {"per_day": 40, "holdout_share": 0.1, "batch_gap_s": 45, "salt": "waves"},
         "untagged_every_days": 14,
         "graduation": {"min_decided": 40, "min_decided_demo": 80, "as_written": 0.85, "clean_last": 20, "drop_edit_share": 0.3},
         "reply_alerts": {"manager_min": 10, "reassign_min": 15, "agent_min": 30},
         "stop_pause_days": 30}$json$::jsonb,
  'migration 20261003c',
  'The follow-up agent, phases 0 and 1 (glossary 1.4): first-message hours, the good_intro cadence, waves, the untagged nurture pace, graduation, reply alerts and the stop pause.');

-- 7. Opener template rows (P3; the CEO's opener, no AI text) ------------------

with added as (
  insert into public.cockpit_sales_wa_templates
    (key, name, language, purpose, preview, variables, workflow_id, active, segments, sort, updated_by)
  values
    ('opener_en', 'cockpit_opener_en', 'en',
     'A backlog wave''s first message in English: the CEO''s opener, no AI text. Their answer opens the window.',
     'Hi {{1}}, it''s {{2}} from Mahara Media. How are you?',
     array['first_name', 'rep_name'], null, false, array['reactivate'], 130, 'migration 20261003c'),
    ('opener_ar', 'cockpit_opener_ar', 'ar',
     'A backlog wave''s first message in Arabic: the CEO''s opener, no AI text. Their answer opens the window.',
     'السلام عليكم {{1}}، معاك {{2}}. كيف حالك؟',
     array['first_name', 'rep_name'], null, false, array['reactivate'], 131, 'migration 20261003c')
  on conflict (key) do nothing
  returning key, name, language, active
)
insert into public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
select 'wa.template.seed', 'cockpit_sales_wa_templates', a.key, null, 'sales', 'migration', null,
       jsonb_build_object('name', a.name, 'language', a.language, 'active', a.active),
       jsonb_build_object('by', 'migration 20261003c',
                          'why', 'Backlog waves: the opener rows exist, switched off, until Meta approves them and a manager picks the workflow.')
  from added as a;

notify pgrst, 'reload schema';

commit;
