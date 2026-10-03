-- Live calls, the foundation (spec final_spec_foundation.md, with P1 and P2's
-- additions, names from the consistency check's glossary, 2026-10-03).
--
-- A room is one video call for one lead: a Meet event on the rep's own
-- calendar or a Zoom meeting under the rep's own Zoom user, made on the VPS
-- by the room worker (hermes/sales-desk/desk/rooms.py) from a `requested`
-- row that sales-api inserts. The lead gets one short link
-- (call.maharamedia.com/{code}). A standby room has no lead yet: a closer
-- who presses Available sits in it until a handover (cockpit_sales_live)
-- is taken. A booked room wraps a HighLevel appointment's own meeting.
--
-- What is here:
--   tables  cockpit_sales_rooms, cockpit_sales_room_secrets (service role
--           only), cockpit_sales_room_events, cockpit_sales_room_hosts,
--           cockpit_sales_availability, cockpit_sales_live,
--           cockpit_sales_alerts (service role only)
--   view    cockpit_sales_presence (on_call > ready > available > away;
--           service role only, served to seats by sales-api live.status)
--   SQL     cockpit_sales_live_claim, cockpit_sales_room_event_lease,
--           cockpit_sales_rooms_sweep(), cockpit_sales_rooms_tick(),
--           cockpit_sales_watchdog() (service role only), and their helpers
--   cron    mahara-sales-rooms-sweep (every minute, runs the tick),
--           mahara-sales-watchdog (every 5 minutes)
--   settings `rooms` and `live`, every master switch off (inserted only if
--           missing; an existing row is never touched)
--
-- Rules the database itself keeps, so no caller can break them:
--   * one non-final room per lead, one non-final room per host (booked rooms
--     aside), one open handover per lead, one claimed handover per closer;
--   * a finished room or handover never changes state again (late events
--     never reopen anything), and a handover never goes back except
--     room_ready -> offered, once;
--   * no rule ends a room with the lead in it, except "no end signal" at
--     ends_at + 30 minutes; nothing here calls Zoom, Google or HighLevel;
--   * every non-final room has a deadline (lead_by, host_by, or the
--     no_deadline backstop), so nothing holds a lead, a host or a closer
--     forever;
--   * version goes up by exactly one when the state changes (or the writer
--     asks for it by writing a new version), never on other writes, so a
--     button that carries the version it saw is refused only when the room
--     or handover really moved;
--   * the host link (start_url) lives only in room_secrets.
--
-- Every seat reads rooms, events, hosts, availability and handovers; only
-- sales-api, the worker and these functions write (service role). Copies the
-- pattern of 20261002e_sales_client_forms.sql.
--
-- Checks for this migration: supabase/migrations/tests/ (run_checks.py runs
-- them inside a transaction that is rolled back).

begin;

-- 0. Helpers -----------------------------------------------------------------

-- A whole number from a settings object, or the default when the key is
-- missing, not a number, zero or negative. A bad setting can never stop the
-- sweep. Capped at one day.
create or replace function public.cockpit_sales_setting_int(p_value jsonb, p_key text, p_default integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
           when jsonb_typeof(p_value -> p_key) = 'number' and (p_value ->> p_key)::numeric > 0
             then least((p_value ->> p_key)::numeric, 86400)::integer
           else p_default
         end
$$;
revoke all on function public.cockpit_sales_setting_int(jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.cockpit_sales_setting_int(jsonb, text, integer) to authenticated, service_role;

-- A room code: six characters from A-H, J-N, P-Z and 2-9 (no I, O, 0 or 1),
-- 32^6 = 1.07 billion codes. Each random byte maps evenly onto 32 letters.
create or replace function public.cockpit_sales_room_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(x.b, i.i) % 32) + 1, 1), '' order by i.i)
    from (select extensions.gen_random_bytes(6) as b) as x,
         generate_series(0, 5) as i(i)
$$;
revoke all on function public.cockpit_sales_room_code() from public, anon, authenticated;
grant execute on function public.cockpit_sales_room_code() to service_role;

-- 1. Rooms -------------------------------------------------------------------

create table if not exists public.cockpit_sales_rooms (
  id                   uuid primary key default gen_random_uuid(),
  request_id           uuid not null unique,
  -- Filled by the guard trigger when the writer leaves it out, with a fresh
  -- code that no room has, so a code collision is never read as a repeated
  -- request_id. A code the writer chose is kept as written.
  code                 text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
  -- What it is for
  contact_id           text,
  contact_first_name   text check (contact_first_name is null or length(contact_first_name) <= 80),
  purpose              text not null check (purpose in ('fallback', 'handover', 'standby', 'booked', 'manual')),
  trigger              text check (trigger is null or trigger in
                         ('no_answer', 'busy', 'did_not_connect', 'no_talk', 'hung_up', 'bad_number', 'manual', 'auto')),
  call_kind            text not null check (call_kind in ('intro', 'demo')),
  provider             text not null check (provider in ('zoom', 'meet')),
  host_email           text not null check (host_email = lower(btrim(host_email)) and host_email <> ''),
  made_by              text not null check (length(made_by) between 1 and 200),
  appointment_id       text,
  handover_id          uuid,
  replaced_by          uuid references public.cockpit_sales_rooms (id),
  attempt_id           uuid,
  -- State
  state                text not null default 'requested' check (state in
                         ('requested', 'creating', 'open', 'host_in', 'lead_in', 'ended', 'expired', 'failed', 'cancelled')),
  version              integer not null default 1 check (version >= 1),
  error                text check (error is null or length(error) <= 500),
  refusal              text check (refusal is null or length(refusal) <= 500),
  result               text check (result is null or result in
                         ('joined', 'no_join', 'moved_to_phone', 'cancelled', 'failed', 'admit_blocked')),
  settled_mark         text check (settled_mark is null or settled_mark in ('showed', 'noshow', 'none')),
  end_reason           text check (end_reason is null or end_reason ~ '^[a-z][a-z0-9_.]{0,39}$'),
  -- Provider and link
  provider_meeting_id  text,
  join_url             text check (join_url is null or join_url ~ '^https://'),
  send_on              text not null default 'open' check (send_on in ('open', 'host_in')),
  worker_run           text,
  -- Deadlines
  host_by              timestamptz,
  lead_by              timestamptz,
  ends_at              timestamptz,
  -- One time per step
  requested_at         timestamptz not null default now(),
  claimed_at           timestamptz,
  opened_at            timestamptz,
  link_sent_at         timestamptz,
  first_open_at        timestamptz,
  last_open_at         timestamptz,
  lead_waiting_at      timestamptz,
  host_in_at           timestamptz,
  lead_in_at           timestamptz,
  ended_at             timestamptz,
  -- Messages: the channels the link went on (roomlogic.ts LINK_CHANNELS), and
  -- each channel's message id as {channel: id}.
  link_channels        text[] not null default '{}'
                         check (link_channels <@ array['whatsapp_text', 'whatsapp_template', 'email']::text[]),
  link_message_ids     jsonb not null default '{}'::jsonb check (jsonb_typeof(link_message_ids) = 'object'),
  open_device          text check (open_device is null or open_device in ('phone', 'tablet', 'desktop', 'unknown')),
  -- The one booking claim (countLive)
  count_claimed_at     timestamptz,
  count_appointment_id text,
  count_result         text check (count_result is null or count_result in ('booked', 'moved', 'not_a_lead', 'failed', 'undone')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  -- A standby room has no lead; every other room has one.
  constraint cockpit_sales_rooms_standby_check check ((contact_id is not null or purpose = 'standby')
                                                      and (purpose <> 'standby' or contact_id is null)),
  -- A booked room carries its appointment and the appointment's deadlines
  -- (glossary 1.9: host by start + 15, lead by start + 20, ends at its end),
  -- so it never falls back to the fallback room's waits.
  constraint cockpit_sales_rooms_booked_check check (purpose <> 'booked'
                                                     or (appointment_id is not null and host_by is not null
                                                         and lead_by is not null and ends_at is not null)),
  constraint cockpit_sales_rooms_link_check check (state not in ('open', 'host_in', 'lead_in') or join_url is not null),
  constraint cockpit_sales_rooms_final_check check (state not in ('ended', 'expired', 'failed', 'cancelled') or ended_at is not null),
  constraint cockpit_sales_rooms_count_check check (count_result is null or count_claimed_at is not null)
);

comment on table public.cockpit_sales_rooms is
  'Video rooms for live calls: one row per room, made on the VPS from a requested row. The host link is in cockpit_sales_room_secrets, never here. Timers live in host_by, lead_by and ends_at; cockpit_sales_rooms_sweep() enforces them every minute.';
comment on column public.cockpit_sales_rooms.code is
  'Six characters from A-H, J-N, P-Z and 2-9. The short link is https://call.maharamedia.com/{code}. Left out on insert, the guard picks one no room has.';
comment on column public.cockpit_sales_rooms.appointment_id is
  'Only the booked call this room wraps (purpose booked). A live booking made by countLive goes in count_appointment_id.';
comment on column public.cockpit_sales_rooms.version is
  'Goes up by exactly one when the state changes, or when the writer writes a new version (an adoption). Other writes (an open counted, a link sent, a message id) leave it. A button carries the version it saw; a mismatch means "This changed a moment ago."';
comment on column public.cockpit_sales_rooms.end_reason is
  'Why the room is final. The sweep writes request_timeout, create_timeout, host_not_in, lead_no_show, not_admitted, no_deadline, standby_refresh, booked_call_soon, host_away or no_end_signal; the claim writes replaced.';
comment on column public.cockpit_sales_rooms.last_open_at is
  'The latest counted open of the short link (first_open_at is the first). An open in the last 3 minutes before lead_by keeps the room open until that open + open_grace.';
comment on column public.cockpit_sales_rooms.link_message_ids is
  'The message id of each send of the link, as {channel: id}, for example {"whatsapp_template": "...", "email": "..."}.';
comment on column public.cockpit_sales_rooms.replaced_by is
  'The room the lead''s link now leads to. Set on a final room no lead reached when a later room of the same handover is made or adopted, so the short link follows it.';

create unique index if not exists cockpit_sales_rooms_one_per_lead
  on public.cockpit_sales_rooms (contact_id)
  where state in ('requested', 'creating', 'open', 'host_in', 'lead_in') and contact_id is not null;
create unique index if not exists cockpit_sales_rooms_one_per_host
  on public.cockpit_sales_rooms (host_email)
  where state in ('requested', 'creating', 'open', 'host_in', 'lead_in') and purpose <> 'booked';
create index if not exists cockpit_sales_rooms_live_states
  on public.cockpit_sales_rooms (state, requested_at)
  where state in ('requested', 'creating', 'open', 'host_in', 'lead_in');
create index if not exists cockpit_sales_rooms_host
  on public.cockpit_sales_rooms (host_email, requested_at desc);
create index if not exists cockpit_sales_rooms_contact
  on public.cockpit_sales_rooms (contact_id, requested_at desc) where contact_id is not null;
create index if not exists cockpit_sales_rooms_appointment
  on public.cockpit_sales_rooms (appointment_id) where appointment_id is not null;
create index if not exists cockpit_sales_rooms_handover
  on public.cockpit_sales_rooms (handover_id) where handover_id is not null;

-- 2. The host link: service role only ----------------------------------------

create table if not exists public.cockpit_sales_room_secrets (
  room_id    uuid primary key references public.cockpit_sales_rooms (id) on delete cascade,
  start_url  text not null check (start_url ~ '^https://'),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
comment on table public.cockpit_sales_room_secrets is
  'The host link (Zoom start_url) per room. Service role only, no policy: it reaches the host through room.open and is deleted when the room ends.';

-- 3. Room events: every Zoom, worker, door, person and sweep event -----------

create table if not exists public.cockpit_sales_room_events (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid references public.cockpit_sales_rooms (id),
  kind        text not null check (kind ~ '^[a-z][a-z0-9_.]{0,79}$'),
  source      text not null check (source ~ '^[a-z][a-z0-9_.-]{0,31}$'),
  dedupe_key  text not null unique check (length(dedupe_key) between 1 and 300),
  at          timestamptz not null default now(),
  handled_at  timestamptz,
  tries       integer not null default 0 check (tries >= 0),
  last_try_at timestamptz,
  lease_until timestamptz,
  text        text check (text is null or length(text) <= 500),
  detail      jsonb not null default '{}'::jsonb
);
comment on table public.cockpit_sales_room_events is
  'Every room event, once (unique dedupe_key). room_id is null for system events. Work for room.event: an event from zoom, slack, worker or claim with handled_at null; the sweep replays it through sales-live/cron after rooms.waits_s.event_replay seconds, 3 tries at most, then marks it handled with detail.gave_up (the watchdog raises one alert a day for those). A settle event (source settle) is posted as sweep.settle until room.event handles it. Writers of log-only events set handled_at. detail is redacted: no host links, no tokens.';
comment on column public.cockpit_sales_room_events.lease_until is
  'Whoever is handling this event right now holds it until this time (cockpit_sales_room_event_lease); the sweep neither replays nor gives up a held event, so two room.event runs never overlap.';
create index if not exists cockpit_sales_room_events_room
  on public.cockpit_sales_room_events (room_id, at desc);
create index if not exists cockpit_sales_room_events_unhandled
  on public.cockpit_sales_room_events (at) where handled_at is null;

-- 4. Room hosts: each rep's Zoom user and Google connection -----------------

create table if not exists public.cockpit_sales_room_hosts (
  email            text primary key check (email = lower(btrim(email)) and email <> ''),
  zoom_user_id     text,
  zoom_status      text check (zoom_status is null or zoom_status in ('licensed', 'basic', 'pending', 'missing')),
  zoom_live_until  timestamptz,
  google_ok        boolean not null default false,
  default_provider text check (default_provider is null or default_provider in ('meet', 'zoom')),
  checked_at       timestamptz,
  updated_at       timestamptz not null default now()
);
comment on table public.cockpit_sales_room_hosts is
  'One row per rep who can host a room: Zoom user and status (checked every 10 minutes on the VPS), whether their Google calendar is connected, and their default provider. No tokens here; they stay on the VPS.';

-- 5. Availability: every seat reads every row (people is own-row only) -------

create table if not exists public.cockpit_sales_availability (
  email      text primary key check (email = lower(btrim(email)) and email <> ''),
  state      text not null default 'away' check (state in ('away', 'available')),
  until      timestamptz,
  via        text not null default 'cockpit' check (via ~ '^[a-z][a-z_]{0,19}$'),
  reason     text check (reason is null or length(reason) <= 200),
  version    integer not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  constraint cockpit_sales_availability_until_check check (state = 'away' or until is not null)
);
comment on table public.cockpit_sales_availability is
  'Who pressed Available, until when (rooms.available_hours, 2 h), and through what (cockpit, slack, sweep). Available always has an end. The sweep sets Away when it ends or when an offer is missed (reason missed_offer).';

-- 6. Handovers ---------------------------------------------------------------

create table if not exists public.cockpit_sales_live (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null unique,
  contact_id     text not null,
  asked_by       text not null check (asked_by = lower(btrim(asked_by)) and asked_by <> ''),
  kind           text not null check (kind in ('intro', 'demo')),
  reason         text not null check (reason in ('on_call', 'replied', 'manual')),
  entry          text not null default 'dialer' check (entry in ('dialer', 'lead_page', 'inbox', 'followup')),
  note           text check (note is null or length(note) <= 200),
  attempt_id     uuid,
  state          text not null default 'offered' check (state in
                   ('offered', 'claimed', 'room_ready', 'lead_joined', 'done', 'expired', 'cancelled', 'failed')),
  version        integer not null default 1 check (version >= 1),
  offered_to     text[] not null default '{}'
                   check (array_to_string(offered_to, ',') = lower(array_to_string(offered_to, ','))),
  declined_by    text[] not null default '{}'
                   check (array_to_string(declined_by, ',') = lower(array_to_string(declined_by, ','))),
  offer_until    timestamptz,
  reoffers       integer not null default 0 check (reoffers between 0 and 1),
  claimed_by     text check (claimed_by is null or (claimed_by = lower(btrim(claimed_by)) and claimed_by <> '')),
  claim_room     text check (claim_room is null or claim_room in ('standby', 'own_room', 'lead_room', 'busy', 'none')),
  room_id        uuid references public.cockpit_sales_rooms (id),
  slack_posts    jsonb not null default '[]'::jsonb,
  end_reason     text check (end_reason is null or end_reason ~ '^[a-z][a-z0-9_.]{0,39}$'),
  created_at     timestamptz not null default now(),
  offered_at     timestamptz not null default now(),
  claimed_at     timestamptz,
  room_ready_at  timestamptz,
  lead_joined_at timestamptz,
  ended_at       timestamptz,
  updated_at     timestamptz not null default now(),
  constraint cockpit_sales_live_offer_check check (state <> 'offered' or offer_until is not null),
  constraint cockpit_sales_live_claim_check check (state not in ('claimed', 'room_ready', 'lead_joined') or claimed_by is not null),
  constraint cockpit_sales_live_room_check check (state not in ('room_ready', 'lead_joined') or room_id is not null),
  constraint cockpit_sales_live_final_check check (state not in ('done', 'expired', 'cancelled', 'failed') or ended_at is not null)
);
comment on table public.cockpit_sales_live is
  'Live handovers: a setter offers a lead on the line (or one who just replied) to every ready or available closer for live.closer_wait_s; the first Take wins through cockpit_sales_live_claim. declined_by holds who pressed Not now (they are not set Away when the offer ends). reoffers: back to offered once if the taker leaves the room before the lead arrives.';
comment on column public.cockpit_sales_live.slack_posts is
  'The Slack messages posted for this offer, so they can be updated: [{email, channel, ts}].';
comment on column public.cockpit_sales_live.claim_room is
  'How the last Take found a room: standby (the taker''s standby room was adopted), own_room (the taker already had a room for this lead), lead_room (the lead was already in a room, so the taker gets that room''s link and nothing goes to the lead), busy (the lead has a booked room open, so no room was made), none (sales-api makes the room).';
comment on column public.cockpit_sales_live.version is
  'Goes up by exactly one when the state, offered_to or offer_until changes (or the writer writes a new version). A Slack post recorded, or another closer''s Not now, leaves it, so the offer a closer sees stays takeable.';

alter table public.cockpit_sales_rooms
  drop constraint if exists cockpit_sales_rooms_handover_fk;
alter table public.cockpit_sales_rooms
  add constraint cockpit_sales_rooms_handover_fk foreign key (handover_id) references public.cockpit_sales_live (id);

create unique index if not exists cockpit_sales_live_one_open_per_lead
  on public.cockpit_sales_live (contact_id)
  where state in ('offered', 'claimed', 'room_ready', 'lead_joined');
create unique index if not exists cockpit_sales_live_one_claim_per_closer
  on public.cockpit_sales_live (claimed_by)
  where state in ('claimed', 'room_ready', 'lead_joined');
create index if not exists cockpit_sales_live_open
  on public.cockpit_sales_live (state, offer_until)
  where state in ('offered', 'claimed', 'room_ready', 'lead_joined');
create index if not exists cockpit_sales_live_contact
  on public.cockpit_sales_live (contact_id, created_at desc);

-- 7. Alerts: one row per incident, from the watchdog or any worker ----------

create table if not exists public.cockpit_sales_alerts (
  id              uuid primary key default gen_random_uuid(),
  dedupe_key      text not null unique check (length(dedupe_key) between 1 and 300),
  source          text not null default 'watchdog' check (source ~ '^[a-z][a-z0-9_.-]{0,39}$'),
  kind            text not null check (kind ~ '^[a-z][a-z0-9_.]{0,39}$'),
  subject         text check (subject is null or length(subject) <= 100),
  message         text not null check (length(message) between 1 and 1000),
  detail          jsonb not null default '{}'::jsonb,
  raised_at       timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  resolved_at     timestamptz,
  posted_at       timestamptz,
  post_tries      integer not null default 0 check (post_tries between 0 and 10),
  post_request_id bigint,
  post_status     integer,
  post_error      text check (post_error is null or length(post_error) <= 500)
);
comment on table public.cockpit_sales_alerts is
  'Alerts, one per incident. An open alert holds the bare dedupe_key (for example stale:sales-desk/rooms); when it clears, the key gets a :resolved: suffix so the next incident raises a new row. Posted to #sales-alerts through pg_net when the vault holds sales_alerts_slack_webhook, Saturday to Thursday 09:00 to 21:00 Kuwait time; otherwise recorded only. Service role only.';
create index if not exists cockpit_sales_alerts_open
  on public.cockpit_sales_alerts (raised_at) where resolved_at is null;

-- 8. Triggers: version, times, and the transitions no one may make ---------

create or replace function public.cockpit_sales_rooms_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  finals constant text[] := array['ended', 'expired', 'failed', 'cancelled'];
  rank_old integer;
  rank_new integer;
  w jsonb;
  i integer;
begin
  if tg_op = 'INSERT' then
    -- A code no room has. Ten tries at 1 in a billion each; a code the
    -- writer chose is kept, and a clash is a 23505 on cockpit_sales_rooms_code_key.
    if new.code is null then
      for i in 1 .. 10 loop
        new.code := public.cockpit_sales_room_code();
        exit when not exists (select 1 from public.cockpit_sales_rooms as x where x.code = new.code);
      end loop;
    end if;
  end if;
  if tg_op = 'UPDATE' then
    -- Version: up by exactly one on a state change or when the writer asks
    -- for it (writes any new version); unchanged on every other write.
    if new.state is distinct from old.state or new.version is distinct from old.version then
      new.version := old.version + 1;
    end if;
    new.updated_at := now();
    if new.state is distinct from old.state then
      if old.state = any (finals) then
        raise exception 'Room % has already %. A finished room never changes state.', old.code, old.state
          using errcode = 'P0001', hint = 'Make a new room instead.';
      end if;
      if old.state = 'lead_in' and new.state in ('expired', 'failed') then
        raise exception 'Room % has the lead in it. It can only end (ended), be cancelled by a person, or go back to host_in.', old.code
          using errcode = 'P0001';
      end if;
      rank_old := array_position(array['requested', 'creating', 'open', 'host_in', 'lead_in'], old.state);
      rank_new := array_position(array['requested', 'creating', 'open', 'host_in', 'lead_in'], new.state);
      if rank_new is not null and rank_new <= rank_old
         and (old.state, new.state) not in (('creating', 'requested'), ('host_in', 'open'), ('lead_in', 'host_in')) then
        raise exception 'Room % cannot move from % back to %.', old.code, old.state, new.state
          using errcode = 'P0001';
      end if;
      w := coalesce((select s.value -> 'waits_s' from public.cockpit_sales_settings as s where s.key = 'rooms'), '{}'::jsonb);
      -- The host left before the lead came (P2): at least the host wait from
      -- now, never less than the host already had (a booked call keeps
      -- start + 15, a fallback room keeps its 15 minutes).
      if old.state = 'host_in' and new.state = 'open' then
        new.host_by := greatest(coalesce(new.host_by, old.host_by, now()), coalesce(old.host_by, now()),
          now() + make_interval(secs => case when new.purpose = 'standby'
            then public.cockpit_sales_setting_int(w, 'standby_host', 300)
            else public.cockpit_sales_setting_int(w, 'handover_host', 120) end));
      end if;
      -- "That was not the lead": the room waits for the real lead a little longer.
      if old.state = 'lead_in' and new.state = 'host_in' then
        if new.lead_in_at is not distinct from old.lead_in_at then
          new.lead_in_at := null;
        end if;
        new.lead_by := greatest(coalesce(new.lead_by, old.lead_by, now()), coalesce(old.lead_by, now()),
          now() + make_interval(secs => public.cockpit_sales_setting_int(w, 'open_grace', 180)));
      end if;
    end if;
  end if;
  -- Stamp the time of each step if the writer did not.
  if new.state = 'creating' and new.claimed_at is null then new.claimed_at := now(); end if;
  if new.state in ('open', 'host_in', 'lead_in') and new.opened_at is null then new.opened_at := now(); end if;
  if new.state in ('host_in', 'lead_in') and new.host_in_at is null then new.host_in_at := now(); end if;
  if new.state = 'lead_in' and new.lead_in_at is null then new.lead_in_at := now(); end if;
  if new.state = any (finals) and new.ended_at is null then new.ended_at := now(); end if;
  return new;
end;
$$;
revoke all on function public.cockpit_sales_rooms_guard() from public, anon, authenticated;

drop trigger if exists cockpit_sales_rooms_guard on public.cockpit_sales_rooms;
create trigger cockpit_sales_rooms_guard
  before insert or update on public.cockpit_sales_rooms
  for each row execute function public.cockpit_sales_rooms_guard();

-- The short link follows the handover: when a room of a handover is made or
-- adopted, every earlier room of that handover that is final and never had
-- the lead in it points at the new one (the door follows replaced_by).
create or replace function public.cockpit_sales_rooms_link_replaced()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.cockpit_sales_rooms as x
     set replaced_by = new.id
   where x.handover_id = new.handover_id
     and x.id <> new.id
     and x.state in ('ended', 'expired', 'failed', 'cancelled')
     and x.lead_in_at is null
     and x.replaced_by is null;
  return null;
end;
$$;
revoke all on function public.cockpit_sales_rooms_link_replaced() from public, anon, authenticated;

drop trigger if exists cockpit_sales_rooms_link_replaced on public.cockpit_sales_rooms;
create trigger cockpit_sales_rooms_link_replaced
  after insert or update of handover_id on public.cockpit_sales_rooms
  for each row
  when (new.handover_id is not null and new.state not in ('ended', 'expired', 'failed', 'cancelled'))
  execute function public.cockpit_sales_rooms_link_replaced();

create or replace function public.cockpit_sales_live_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  finals constant text[] := array['done', 'expired', 'cancelled', 'failed'];
  steps constant text[] := array['offered', 'claimed', 'room_ready', 'lead_joined'];
  rank_old integer;
  rank_new integer;
begin
  if tg_op = 'UPDATE' then
    -- Version: up by one when what a closer acts on changes (state, who it is
    -- offered to, until when) or the writer writes a new version.
    if new.state is distinct from old.state or new.offered_to is distinct from old.offered_to
       or new.offer_until is distinct from old.offer_until or new.version is distinct from old.version then
      new.version := old.version + 1;
    end if;
    new.updated_at := now();
    if new.state is distinct from old.state then
      if old.state = any (finals) then
        raise exception 'This handover has already %. It never changes state again.', old.state
          using errcode = 'P0001';
      end if;
      -- Forward only (glossary 1.3), except room_ready -> offered, once (P2).
      rank_old := array_position(steps, old.state);
      rank_new := array_position(steps, new.state);
      if rank_new is not null and rank_new < rank_old
         and not (old.state = 'room_ready' and new.state = 'offered' and new.reoffers = old.reoffers + 1) then
        raise exception 'This handover cannot go back from % to %.', old.state, new.state
          using errcode = 'P0001', hint = 'Only room_ready may go back to offered, once, counted in reoffers.';
      end if;
      if new.state = 'offered' then
        new.offered_at := now();
      end if;
    end if;
  end if;
  if new.state = 'claimed' and new.claimed_at is null then new.claimed_at := now(); end if;
  if new.state = 'room_ready' and new.room_ready_at is null then new.room_ready_at := now(); end if;
  if new.state = 'lead_joined' and new.lead_joined_at is null then new.lead_joined_at := now(); end if;
  if new.state = any (finals) and new.ended_at is null then new.ended_at := now(); end if;
  return new;
end;
$$;
revoke all on function public.cockpit_sales_live_guard() from public, anon, authenticated;

drop trigger if exists cockpit_sales_live_guard on public.cockpit_sales_live;
create trigger cockpit_sales_live_guard
  before insert or update on public.cockpit_sales_live
  for each row execute function public.cockpit_sales_live_guard();

create or replace function public.cockpit_sales_touch_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.cockpit_sales_touch_version() from public, anon, authenticated;

drop trigger if exists cockpit_sales_availability_touch on public.cockpit_sales_availability;
create trigger cockpit_sales_availability_touch
  before update on public.cockpit_sales_availability
  for each row execute function public.cockpit_sales_touch_version();

create or replace function public.cockpit_sales_touch_updated()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.cockpit_sales_touch_updated() from public, anon, authenticated;

drop trigger if exists cockpit_sales_room_hosts_touch on public.cockpit_sales_room_hosts;
create trigger cockpit_sales_room_hosts_touch
  before update on public.cockpit_sales_room_hosts
  for each row execute function public.cockpit_sales_touch_updated();

-- 9. Presence: the first state that applies wins ----------------------------
--   on_call   a room with the lead in it; a handover they hold; a room for a
--             lead they are in (not standby); an open dial (dialing or
--             placed, started in the last 2 hours); an appointment of theirs
--             running now (rooms.booking_min long); or a live Zoom meeting
--   ready     in their own standby room (host_in, no lead)
--   available pressed Available and it has not ended
--   away      anything else
-- Service role only: people is own-row for a seat, so a seat reading this
-- view would get another rep's role and appointments wrong. sales-api serves
-- it to the strip through live.status.

create or replace view public.cockpit_sales_presence
with (security_invoker = true) as
with cfg as (
  select coalesce((select s.value from public.cockpit_sales_settings as s where s.key = 'rooms'), '{}'::jsonb) as rooms
),
seats as (
  select p.email from public.cockpit_sales_people as p where p.active
  union
  select a.email from public.cockpit_sales_availability as a
  union
  select h.email from public.cockpit_sales_room_hosts as h
  union
  select r.host_email from public.cockpit_sales_rooms as r
   where r.state in ('requested', 'creating', 'open', 'host_in', 'lead_in')
  union
  select l.claimed_by from public.cockpit_sales_live as l
   where l.state in ('claimed', 'room_ready', 'lead_joined')
)
select
  s.email,
  case
    when oc.why is not null then 'on_call'
    when rd.id is not null then 'ready'
    when av.state = 'available' and av.until > now() then 'available'
    else 'away'
  end as state,
  case when av.state = 'available' and av.until > now() then av.until end as until,
  coalesce(oc.room_id, rd.id, own.id) as room_id,
  h.zoom_status,
  coalesce(
    h.default_provider,
    case when p.role = 'closer' then cfg.rooms #>> '{default_provider,closer}' else cfg.rooms #>> '{default_provider,setter}' end,
    case when p.role = 'closer' then 'zoom' else 'meet' end
  ) as default_provider,
  oc.why as on_call_why,
  p.role,
  coalesce(av.state, 'away') as availability,
  av.via as availability_via,
  av.reason as availability_reason
from seats as s
cross join cfg
left join public.cockpit_sales_people as p on p.email = s.email
left join public.cockpit_sales_availability as av on av.email = s.email
left join public.cockpit_sales_room_hosts as h on h.email = s.email
left join lateral (
  select x.why, x.room_id
    from (
      select 'room'::text as why, r.id as room_id, 1 as ord
        from public.cockpit_sales_rooms as r
       where r.host_email = s.email and r.state = 'lead_in'
      union all
      select 'handover'::text, l.room_id, 2
        from public.cockpit_sales_live as l
       where l.claimed_by = s.email and l.state in ('claimed', 'room_ready', 'lead_joined')
      union all
      select 'room'::text, r.id, 3
        from public.cockpit_sales_rooms as r
       where r.host_email = s.email and r.state = 'host_in' and r.purpose <> 'standby'
      union all
      select 'attempt'::text, null::uuid, 4
        from public.cockpit_sales_attempts as a
       where a.rep_email = s.email and a.state in ('dialing', 'placed') and a.started_at > now() - interval '2 hours'
      union all
      select 'appointment'::text, null::uuid, 5
        from public.cockpit_sales_appointments as ap
       where p.ghl_user_id is not null
         and ap.assigned_user_id = p.ghl_user_id
         and ap.status in ('new', 'confirmed', 'showed')
         and ap.start_at <= now()
         and now() < ap.start_at + make_interval(mins => public.cockpit_sales_setting_int(
               coalesce(cfg.rooms -> 'booking_min', '{}'::jsonb), coalesce(ap.call_type, ''), 30))
      union all
      select 'zoom'::text, null::uuid, 6
       where h.zoom_live_until > now()
    ) as x
   order by x.ord
   limit 1
) as oc on true
left join lateral (
  select r.id
    from public.cockpit_sales_rooms as r
   where r.host_email = s.email and r.purpose = 'standby' and r.state = 'host_in'
   order by r.requested_at desc
   limit 1
) as rd on true
left join lateral (
  select r.id
    from public.cockpit_sales_rooms as r
   where r.host_email = s.email and r.purpose <> 'booked'
     and r.state in ('requested', 'creating', 'open', 'host_in', 'lead_in')
   order by r.requested_at desc
   limit 1
) as own on true;

comment on view public.cockpit_sales_presence is
  'Each rep''s live state, first that applies: on_call (lead in their room, a handover they hold, in a room for a lead, an open dial in the last 2 h, an appointment running now, a live Zoom meeting), ready (in their own standby room), available (until not passed), away. room_id is the room that matters now. Service role only; seats get it from sales-api live.status.';

-- 10. The claim: one Take wins ----------------------------------------------
-- Returns the handover the caller now holds, or nothing when someone else
-- took it, the offer ended, it was never offered to them, or p_version is
-- stale (the version moves only when the state, offered_to or offer_until
-- moves). A 23505 (cockpit_sales_live_one_claim_per_closer) means the caller
-- already holds a live call: "You already have a live call." A lock it cannot
-- get in 3 s is a 55P03: "Try again."
--
-- The room, in the same transaction; claim_room on the returned row says
-- which case happened:
--   lead_room  the lead is already in a room (lead_in): the handover is
--              lead_joined with that room, no new link goes to the lead (C16);
--   busy       the lead has a booked room open: nothing is adopted;
--   own_room   the taker already hosts a room for this lead: it is used;
--   standby    the taker's standby room is adopted (lead set, purpose
--              handover); room_ready at once when they are in it. A room the
--              lead had (no lead in it) is cancelled (end_reason replaced) and
--              points at this one, so the lead's link follows;
--   none       no standby room: sales-api makes one with handover_id set, and
--              the lead's cancelled room points at it the moment it is made.
-- It also writes a live.claimed room event, held by sales-api for 60 s: if
-- sales-api stops before it marks the event handled (link sent, or room
-- made), the sweep replays it to room.event. And one audit row.

create or replace function public.cockpit_sales_live_claim(p_live_id uuid, p_email text, p_version integer default null)
returns setof public.cockpit_sales_live
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  me constant text := lower(btrim(coalesce(p_email, '')));
  l public.cockpit_sales_live;
  r public.cockpit_sales_rooms;
  lr public.cockpit_sales_rooms;
  has_lr boolean := false;
  cfg jsonb := coalesce((select s.value from public.cockpit_sales_settings as s where s.key = 'rooms'), '{}'::jsonb);
  w jsonb;
  via text := 'none';
  room uuid;
  next_state text := 'claimed';
  replaced uuid;
begin
  if p_live_id is null or me = '' then
    return;
  end if;
  w := coalesce(cfg -> 'waits_s', '{}'::jsonb);

  update public.cockpit_sales_live as x
     set state = 'claimed', claimed_by = me, claimed_at = now(), claim_room = null
   where x.id = p_live_id
     and x.state = 'offered'
     and x.offer_until > now()
     and me = any (x.offered_to)
     and (p_version is null or x.version = p_version)
  returning x.* into l;
  if not found then
    return;
  end if;

  -- The lead's own room, if one is not final.
  select * into lr
    from public.cockpit_sales_rooms as x
   where x.contact_id = l.contact_id
     and x.state in ('requested', 'creating', 'open', 'host_in', 'lead_in')
   order by x.requested_at desc
   limit 1
   for update;
  has_lr := found;

  if has_lr and lr.state = 'lead_in' then
    -- C16: the lead is in a room already. The taker joins that room; it is
    -- not replaced and no new link goes to the lead.
    update public.cockpit_sales_rooms as x set handover_id = l.id where x.id = lr.id;
    via := 'lead_room'; room := lr.id; next_state := 'lead_joined';
  elsif has_lr and lr.purpose = 'booked' then
    via := 'busy';
  elsif has_lr and lr.host_email = me then
    update public.cockpit_sales_rooms as x set handover_id = l.id, version = x.version + 1
     where x.id = lr.id
    returning x.* into r;
    via := 'own_room'; room := r.id;
    next_state := case when r.state = 'host_in' then 'room_ready' else 'claimed' end;
  else
    if has_lr then
      -- The lead's room with nobody's lead in it (a setter's fallback room):
      -- it makes way for the closer's room and points at it once that exists.
      update public.cockpit_sales_rooms as x
         set state = 'cancelled', end_reason = 'replaced', result = 'cancelled', handover_id = l.id
       where x.id = lr.id and x.state = lr.state;
      replaced := lr.id;
      insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, handled_at, text, detail)
      values (lr.id, 'live.replaced', 'claim', 'live.replaced:' || lr.id::text, now(),
              'Closed: a closer took this lead live, so the lead''s link now leads to the closer''s room.',
              jsonb_build_object('handover_id', l.id, 'from', lr.state))
      on conflict (dedupe_key) do nothing;
      insert into public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
      values ('room.replace', 'cockpit_sales_rooms', lr.id::text, me, 'sales', 'sales-api',
              jsonb_build_object('state', lr.state, 'host_email', lr.host_email),
              jsonb_build_object('state', 'cancelled', 'end_reason', 'replaced'),
              jsonb_build_object('handover_id', l.id));
    end if;

    select * into r
      from public.cockpit_sales_rooms as x
     where x.host_email = me and x.purpose = 'standby' and x.contact_id is null
       and x.state in ('requested', 'creating', 'open', 'host_in')
     order by x.requested_at desc
     limit 1
     for update;

    if found then
      begin
        update public.cockpit_sales_rooms as x
           set contact_id = l.contact_id,
               purpose = 'handover',
               handover_id = l.id,
               call_kind = l.kind,
               send_on = case when x.state = 'host_in' then 'open' else 'host_in' end,
               host_by = case when x.state = 'host_in' then x.host_by
                              else greatest(coalesce(x.host_by, now()),
                                            now() + make_interval(secs => public.cockpit_sales_setting_int(w, 'handover_host', 120))) end,
               lead_by = case when x.state = 'host_in'
                              then greatest(coalesce(x.lead_by, now()),
                                            now() + make_interval(secs => public.cockpit_sales_setting_int(w, 'lead', 600)))
                              else x.lead_by end,
               ends_at = greatest(coalesce(x.ends_at, now()), now() + make_interval(mins => public.cockpit_sales_setting_int(
                           coalesce(cfg -> 'lengths_min', '{}'::jsonb), l.kind, case when l.kind = 'demo' then 60 else 30 end))),
               version = x.version + 1
         where x.id = r.id
        returning x.* into r;
        via := 'standby'; room := r.id;
        next_state := case when r.state = 'host_in' then 'room_ready' else 'claimed' end;
      exception when unique_violation then
        -- The lead got another room in the meantime: keep the claim, adopt nothing.
        via := 'none'; room := null; next_state := 'claimed';
      end;
    end if;
  end if;

  update public.cockpit_sales_live as x
     set room_id = room, state = next_state, claim_room = via
   where x.id = l.id
  returning x.* into l;

  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, lease_until, text, detail)
  values (l.room_id, 'live.claimed', 'claim', 'live.claimed:' || l.id::text || ':' || l.reoffers::text, now() + interval '60 seconds',
          case via
            when 'lead_room' then 'A closer took this lead live and joins the room the lead is in.'
            when 'busy' then 'A closer took this lead live, but the lead has a booked call open, so no room was made.'
            when 'none' then 'A closer took this lead live. Their room is being made.'
            else 'A closer took this lead live in their own room.' end,
          jsonb_build_object('handover_id', l.id, 'claim_room', via, 'state', l.state, 'replaced_room_id', replaced))
  on conflict (dedupe_key) do nothing;
  insert into public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  values ('live.claim', 'cockpit_sales_live', l.id::text, me, 'sales', 'sales-api',
          jsonb_build_object('state', 'offered'),
          jsonb_build_object('state', l.state, 'claimed_by', me, 'room_id', l.room_id, 'claim_room', via),
          jsonb_build_object('contact_id', l.contact_id, 'reoffers', l.reoffers, 'replaced_room_id', replaced));

  return next l;
end;
$$;
revoke all on function public.cockpit_sales_live_claim(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.cockpit_sales_live_claim(uuid, text, integer) to service_role;

-- 10b. One room.event run per event --------------------------------------
-- room.event takes the event before it acts and sets handled_at when done:
--   select public.cockpit_sales_room_event_lease(p_event_id => id)  -- or p_dedupe_key
-- returns the event id when this caller now holds it for p_seconds, or null
-- when it is handled already or someone else holds it (then do nothing).
-- The door may insert its Zoom and Slack events with lease_until set to its
-- forward's time budget, so the sweep never replays an event the door is
-- still passing on.

create or replace function public.cockpit_sales_room_event_lease(
  p_event_id uuid default null, p_dedupe_key text default null, p_seconds integer default 60)
returns uuid
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  got uuid;
begin
  if p_event_id is null and p_dedupe_key is null then
    return null;
  end if;
  update public.cockpit_sales_room_events as e
     set lease_until = now() + make_interval(secs => least(greatest(coalesce(p_seconds, 60), 1), 600))
   where (p_event_id is null or e.id = p_event_id)
     and (p_dedupe_key is null or e.dedupe_key = p_dedupe_key)
     and e.handled_at is null
     and (e.lease_until is null or e.lease_until <= now())
  returning e.id into got;
  return got;
end;
$$;
revoke all on function public.cockpit_sales_room_event_lease(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.cockpit_sales_room_event_lease(uuid, text, integer) to service_role;

-- 11. The sweep: every timer, every minute, nothing outside -----------------

-- Closes the given rooms if they are still in one of p_from, with one room
-- event and one audit row each. Returns how many moved.
create or replace function public.cockpit_sales_rooms_close(
  p_ids uuid[], p_from text[], p_to text, p_rule text, p_text text,
  p_result text default null, p_error text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;
  with prev as (
    select x.id, x.state as old_state
      from public.cockpit_sales_rooms as x
     where x.id = any (p_ids)
  ),
  moved as (
    update public.cockpit_sales_rooms as r
       set state = p_to,
           end_reason = p_rule,
           result = coalesce(r.result, case when p_result = 'no_join' and r.contact_id is null then null else p_result end),
           error = coalesce(p_error, r.error)
      from prev as o
     where r.id = o.id and r.state = any (p_from)
    returning r.id, r.code, o.old_state, r.state as new_state
  ),
  ev as (
    insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, handled_at, text, detail)
    select m.id, 'sweep.' || p_rule, 'sweep', 'sweep:' || m.id::text || ':' || p_rule, now(), p_text,
           jsonb_build_object('from', m.old_state, 'to', m.new_state)
      from moved as m
    on conflict (dedupe_key) do nothing
    returning 1
  ),
  au as (
    insert into public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    select 'room.sweep', 'cockpit_sales_rooms', m.id::text, null, 'sales', 'pg_cron',
           jsonb_build_object('state', m.old_state),
           jsonb_build_object('state', m.new_state, 'end_reason', p_rule),
           jsonb_build_object('rule', p_rule, 'code', m.code)
      from moved as m
    returning 1
  )
  select count(*) into n from moved;
  return n;
end;
$$;
revoke all on function public.cockpit_sales_rooms_close(uuid[], text[], text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.cockpit_sales_rooms_close(uuid[], text[], text, text, text, text, text) to service_role;

-- Moves one handover to a final state with an event and an audit row.
-- Returns 1 if it moved.
create or replace function public.cockpit_sales_live_move(
  p_id uuid, p_from text[], p_to text, p_rule text, p_text text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.cockpit_sales_live;
  before_state text;
begin
  select x.state into before_state from public.cockpit_sales_live as x where x.id = p_id;
  update public.cockpit_sales_live as x
     set state = p_to,
         end_reason = case when p_to in ('done', 'expired', 'cancelled', 'failed') then p_rule else x.end_reason end
   where x.id = p_id and x.state = any (p_from)
  returning x.* into l;
  if not found then
    return 0;
  end if;
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, handled_at, text, detail)
  values (l.room_id, 'sweep.live_' || p_rule, 'sweep', 'sweep:live:' || l.id::text || ':' || p_rule || ':' || l.version, now(), p_text,
          jsonb_build_object('handover_id', l.id, 'from', before_state, 'to', l.state))
  on conflict (dedupe_key) do nothing;
  insert into public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  values ('live.sweep', 'cockpit_sales_live', l.id::text, null, 'sales', 'pg_cron',
          jsonb_build_object('state', before_state), jsonb_build_object('state', l.state, 'end_reason', l.end_reason),
          jsonb_build_object('rule', p_rule, 'contact_id', l.contact_id));
  return 1;
end;
$$;
revoke all on function public.cockpit_sales_live_move(uuid, text[], text, text, text) from public, anon, authenticated;
grant execute on function public.cockpit_sales_live_move(uuid, text[], text, text, text) to service_role;

create or replace function public.cockpit_sales_rooms_sweep()
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '10s'
as $$
declare
  t constant timestamptz := now();
  finals constant text[] := array['ended', 'expired', 'failed', 'cancelled'];
  replayable constant text[] := array['zoom', 'slack', 'worker', 'claim'];
  cfg jsonb := coalesce((select s.value from public.cockpit_sales_settings as s where s.key = 'rooms'), '{}'::jsonb);
  lcfg jsonb := coalesce((select s.value from public.cockpit_sales_settings as s where s.key = 'live'), '{}'::jsonb);
  w jsonb;
  w_fail interval;
  w_handover interval;
  w_standby_host interval;
  w_fallback_host interval;
  w_lead interval;
  w_grace interval;
  w_replay interval;
  w_settle interval;
  w_no_end interval;
  w_standby_max interval;
  w_booked_guard interval;
  w_closer interval;
  len jsonb;
  lead_min integer;
  standby_min integer;
  ids uuid[];
  knocked uuid[];
  summary jsonb := '{}'::jsonb;
  errs jsonb := '[]'::jsonb;
  n integer;
  made integer;
  fresh boolean;
  new_id uuid;
  moved_rooms integer := 0;
  moved_live integer := 0;
  rec record;
  eligible text[];
  replay jsonb := '[]'::jsonb;
  settle jsonb := '[]'::jsonb;
  settle_due integer := 0;
begin
  if not pg_try_advisory_xact_lock(hashtext('cockpit_sales_rooms_sweep')) then
    return jsonb_build_object('skipped', 'Another sweep is running.');
  end if;

  w := coalesce(cfg -> 'waits_s', '{}'::jsonb);
  w_fail          := make_interval(secs => public.cockpit_sales_setting_int(w, 'fail', 60));
  w_handover      := make_interval(secs => public.cockpit_sales_setting_int(w, 'handover_host', 120));
  w_standby_host  := make_interval(secs => public.cockpit_sales_setting_int(w, 'standby_host', 300));
  w_fallback_host := make_interval(secs => public.cockpit_sales_setting_int(w, 'fallback_host', 900));
  w_lead          := make_interval(secs => public.cockpit_sales_setting_int(w, 'lead', 600));
  w_grace         := make_interval(secs => public.cockpit_sales_setting_int(w, 'open_grace', 180));
  w_replay        := make_interval(secs => public.cockpit_sales_setting_int(w, 'event_replay', 20));
  w_settle        := make_interval(secs => public.cockpit_sales_setting_int(w, 'settle', 1200));
  w_no_end        := make_interval(secs => public.cockpit_sales_setting_int(w, 'no_end_signal', 1800));
  w_standby_max   := make_interval(secs => public.cockpit_sales_setting_int(w, 'standby_max', 2100));
  w_booked_guard  := make_interval(secs => public.cockpit_sales_setting_int(w, 'booked_guard', 600));
  w_closer        := make_interval(secs => public.cockpit_sales_setting_int(lcfg, 'closer_wait_s', 120));
  len := coalesce(cfg -> 'lengths_min', '{}'::jsonb);
  lead_min := greatest(1, round(extract(epoch from w_lead) / 60)::integer);
  standby_min := greatest(1, round(extract(epoch from w_standby_max) / 60)::integer);

  -- R1. requested: the worker did not pick it up in time.
  begin
    select coalesce(array_agg(q.id), '{}') into ids from (
      select x.id from public.cockpit_sales_rooms as x
       where x.state = 'requested' and x.requested_at + w_fail < t
       for update skip locked) as q;
    n := public.cockpit_sales_rooms_close(ids, array['requested'], 'failed', 'request_timeout',
      'Not made: the room worker did not pick this room up in time.', 'failed',
      'The room worker did not start this room within a minute. Try again.');
    summary := summary || jsonb_build_object('request_timeout', n); moved_rooms := moved_rooms + n;
  exception when others then
    errs := errs || jsonb_build_object('rule', 'request_timeout', 'error', sqlerrm);
  end;

  -- R2. creating: making it took too long. The worker recovers a lost make at
  -- claimed + fail (it adopts another run's Zoom room only then); the sweep
  -- fails it at claimed + 2 x fail, as roomlogic.ts timers() do. The worker
  -- closes anything it made.
  begin
    select coalesce(array_agg(q.id), '{}') into ids from (
      select x.id from public.cockpit_sales_rooms as x
       where x.state = 'creating' and coalesce(x.claimed_at, x.requested_at) + 2 * w_fail < t
       for update skip locked) as q;
    n := public.cockpit_sales_rooms_close(ids, array['creating'], 'failed', 'create_timeout',
      'Not made: making the room took too long.', 'failed',
      'Making the room took more than two minutes. Try again, or use the other provider.');
    summary := summary || jsonb_build_object('create_timeout', n); moved_rooms := moved_rooms + n;
  exception when others then
    errs := errs || jsonb_build_object('rule', 'create_timeout', 'error', sqlerrm);
  end;

  -- R3. open: the host did not come in by host_by (by purpose when unset; a
  -- booked room always has its own).
  begin
    select coalesce(array_agg(q.id), '{}') into ids from (
      select x.id from public.cockpit_sales_rooms as x
       where x.state = 'open'
         and (x.purpose <> 'booked' or x.host_by is not null)
         and coalesce(x.host_by, coalesce(x.opened_at, x.requested_at) + case x.purpose
               when 'handover' then w_handover
               when 'standby' then w_standby_host
               else w_fallback_host end) < t
       for update skip locked) as q;
    n := public.cockpit_sales_rooms_close(ids, array['open'], 'expired', 'host_not_in',
      'Closed: the host did not join in time.', 'no_join', null);
    summary := summary || jsonb_build_object('host_not_in', n); moved_rooms := moved_rooms + n;
  exception when others then
    errs := errs || jsonb_build_object('rule', 'host_not_in', 'error', sqlerrm);
  end;

  -- R4. open or host_in with a lead: the lead did not join by lead_by, or,
  -- when unset, 10 minutes after the link went, the host came in, or the room
  -- opened (roomlogic.ts timers()). An open, or a knock in the waiting room,
  -- in the last 3 minutes keeps the room open until that moment + open_grace.
  -- A lead who knocked and was never let in is not a no-show: not_admitted,
  -- result admit_blocked.
  begin
    select coalesce(array_agg(q.id), '{}'), coalesce(array_agg(q.id) filter (where q.knocked), '{}')
      into ids, knocked from (
      select x.id, x.lead_waiting_at is not null as knocked from public.cockpit_sales_rooms as x
       where x.state in ('open', 'host_in')
         and x.contact_id is not null
         and (x.purpose <> 'booked' or x.lead_by is not null)
         and greatest(coalesce(x.lead_by, x.link_sent_at + w_lead, x.host_in_at + w_lead,
                               x.opened_at + w_lead, x.requested_at + w_lead),
                      coalesce(x.last_open_at, x.first_open_at) + w_grace,
                      x.lead_waiting_at + w_grace) < t
       for update skip locked) as q;
    n := public.cockpit_sales_rooms_close(knocked, array['open', 'host_in'], 'expired', 'not_admitted',
      'Closed: the lead knocked but was not let in.', 'admit_blocked', null);
    n := n + public.cockpit_sales_rooms_close(
      array(select i from unnest(ids) as i where not (i = any (knocked))), array['open', 'host_in'], 'expired', 'lead_no_show',
      format('Closed: the lead did not join in %s minutes.', lead_min), 'no_join', null);
    summary := summary || jsonb_build_object('lead_no_show', n); moved_rooms := moved_rooms + n;
  exception when others then
    errs := errs || jsonb_build_object('rule', 'lead_no_show', 'error', sqlerrm);
  end;

  -- R9. The backstop: a room that is open or has the host in it, long past its
  -- planned length plus no_end_signal, closes whatever its deadlines say, so
  -- no room holds a lead, a host or a closer forever. Never a lead_in room.
  begin
    select coalesce(array_agg(q.id), '{}') into ids from (
      select x.id from public.cockpit_sales_rooms as x
       where x.state in ('open', 'host_in')
         and case when x.purpose = 'booked' and x.ends_at is not null then x.ends_at
                  else x.requested_at + make_interval(mins => public.cockpit_sales_setting_int(len, x.call_kind,
                         case when x.call_kind = 'demo' then 60 else 30 end)) end
             + w_no_end < t
       for update skip locked) as q;
    n := public.cockpit_sales_rooms_close(ids, array['open', 'host_in'], 'expired', 'no_deadline',
      'Closed: this room was long past its planned length.', 'no_join', null);
    summary := summary || jsonb_build_object('no_deadline', n); moved_rooms := moved_rooms + n;
  exception when others then
    errs := errs || jsonb_build_object('rule', 'no_deadline', 'error', sqlerrm);
  end;

  -- A1. Available has ended: Away.
  begin
    with gone as (
      update public.cockpit_sales_availability as a
         set state = 'away', until = null, via = 'sweep', reason = 'expired'
       where a.state = 'available' and a.until <= t
      returning a.email
    ),
    au as (
      insert into public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
      select 'availability.sweep', 'cockpit_sales_availability', g.email, null, 'sales', 'pg_cron',
             jsonb_build_object('state', 'available'), jsonb_build_object('state', 'away'),
             jsonb_build_object('rule', 'available_ended')
        from gone as g
      returning 1
    )
    select count(*) into n from gone;
    summary := summary || jsonb_build_object('available_ended', n);
  exception when others then
    errs := errs || jsonb_build_object('rule', 'available_ended', 'error', sqlerrm);
  end;

  -- L1. offered: nobody took it in time. Everyone it went to who did not
  -- press Not now, is still Available, and is not holding another live call
  -- they took meanwhile, becomes Away (one miss).
  begin
    n := 0;
    for rec in
      select x.id, x.offered_to, x.declined_by
        from public.cockpit_sales_live as x
       where x.state = 'offered' and x.offer_until <= t
       for update skip locked
    loop
      n := n + public.cockpit_sales_live_move(rec.id, array['offered'], 'expired', 'no_rep',
             'The offer ended and nobody took it.');
      with missed as (
        update public.cockpit_sales_availability as a
           set state = 'away', until = null, via = 'sweep', reason = 'missed_offer'
         where a.email = any (rec.offered_to)
           and not (a.email = any (rec.declined_by))
           and a.state = 'available'
           and not exists (
             select 1 from public.cockpit_sales_live as y
              where y.claimed_by = a.email and y.state in ('claimed', 'room_ready', 'lead_joined'))
        returning a.email
      )
      insert into public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
      select 'availability.sweep', 'cockpit_sales_availability', m.email, null, 'sales', 'pg_cron',
             jsonb_build_object('state', 'available'), jsonb_build_object('state', 'away'),
             jsonb_build_object('rule', 'missed_offer', 'handover_id', rec.id)
        from missed as m;
    end loop;
    summary := summary || jsonb_build_object('offer_ended', n); moved_live := moved_live + n;
  exception when others then
    errs := errs || jsonb_build_object('rule', 'offer_ended', 'error', sqlerrm);
  end;

  -- L2. claimed: the room failed (failed), or the taker was not in the room
  -- within handover_host of the claim, or the room closed before they came
  -- in (expired, rep_not_in_room; lead_has_booked_room when the claim found
  -- the lead's booked room open).
  begin
    n := 0;
    for rec in
      select x.id, x.claim_room, r.state as room_state
        from public.cockpit_sales_live as x
        left join public.cockpit_sales_rooms as r on r.id = x.room_id
       where x.state = 'claimed'
         and (r.state = 'failed'
              or (r.state = any (finals) and r.lead_in_at is null)
              or (x.claimed_at + w_handover < t and (r.id is null or r.state not in ('host_in', 'lead_in'))))
       for update of x skip locked
    loop
      if rec.room_state = 'failed' then
        n := n + public.cockpit_sales_live_move(rec.id, array['claimed'], 'failed', 'room_failed',
               'The room for this handover could not be made.');
      elsif rec.claim_room = 'busy' and rec.room_state is null then
        n := n + public.cockpit_sales_live_move(rec.id, array['claimed'], 'expired', 'lead_has_booked_room',
               'The lead has a booked call open, so no live room could be made.');
      else
        n := n + public.cockpit_sales_live_move(rec.id, array['claimed'], 'expired', 'rep_not_in_room',
               'The closer who took it did not get into the room in time.');
      end if;
    end loop;
    summary := summary || jsonb_build_object('taker_not_in', n); moved_live := moved_live + n;
  exception when others then
    errs := errs || jsonb_build_object('rule', 'taker_not_in', 'error', sqlerrm);
  end;

  -- L3. room_ready or lead_joined: the room closed with no lead in it (for
  -- lead_joined: "That was not the lead", then the real lead never came). If
  -- a room_ready taker left and did not come back (host_not_in), it goes back
  -- to offered once, to closers still ready or available, with the lead's
  -- time left. Otherwise it ends.
  begin
    n := 0;
    for rec in
      select x.id, x.state, x.reoffers, x.offered_to, x.declined_by, x.claimed_by,
             r.state as room_state, r.end_reason as room_reason,
             coalesce(r.lead_by, r.link_sent_at + w_lead) as room_lead_by
        from public.cockpit_sales_live as x
        join public.cockpit_sales_rooms as r on r.id = x.room_id
       where x.state in ('room_ready', 'lead_joined') and r.state = any (finals) and r.lead_in_at is null
       for update of x skip locked
    loop
      eligible := null;
      if rec.state = 'room_ready' and rec.room_state <> 'failed' and rec.room_reason = 'host_not_in' and rec.reoffers = 0
         and (rec.room_lead_by is null or rec.room_lead_by > t + interval '60 seconds') then
        select coalesce(array_agg(pr.email order by pr.email), '{}') into eligible
          from public.cockpit_sales_presence as pr
         where pr.email = any (rec.offered_to)
           and pr.email is distinct from rec.claimed_by
           and not (pr.email = any (rec.declined_by))
           and pr.state in ('ready', 'available');
      end if;
      if rec.room_state = 'failed' then
        n := n + public.cockpit_sales_live_move(rec.id, array['room_ready', 'lead_joined'], 'failed', 'room_failed',
               'The room for this handover failed.');
      elsif eligible is not null and cardinality(eligible) > 0 then
        update public.cockpit_sales_live as x
           set state = 'offered', reoffers = x.reoffers + 1, claimed_by = null, claimed_at = null, room_id = null,
               room_ready_at = null, claim_room = null, offered_to = eligible,
               offer_until = case when rec.room_lead_by is null then t + w_closer
                                  else least(t + w_closer, rec.room_lead_by) end
         where x.id = rec.id and x.state = 'room_ready';
        if found then
          insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, handled_at, text, detail)
          values (null, 'sweep.live_reoffered', 'sweep', 'sweep:live:' || rec.id::text || ':reoffered', t,
                  'The closer left the room before the lead came. Offered again, once.',
                  jsonb_build_object('handover_id', rec.id, 'offered_to', to_jsonb(eligible)))
          on conflict (dedupe_key) do nothing;
          insert into public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
          values ('live.sweep', 'cockpit_sales_live', rec.id::text, null, 'sales', 'pg_cron',
                  jsonb_build_object('state', 'room_ready', 'claimed_by', rec.claimed_by),
                  jsonb_build_object('state', 'offered', 'offered_to', to_jsonb(eligible)),
                  jsonb_build_object('rule', 'reoffered'));
          n := n + 1;
        end if;
      else
        n := n + public.cockpit_sales_live_move(rec.id, array['room_ready', 'lead_joined'], 'expired',
               case rec.room_reason when 'lead_no_show' then 'lead_no_show'
                                    when 'not_admitted' then 'lead_not_admitted'
                                    when 'host_not_in' then 'rep_not_in_room'
                                    else 'room_closed' end,
               case rec.room_reason when 'lead_no_show' then 'The lead did not join.'
                                    when 'not_admitted' then 'The lead knocked but was not let in.'
                                    when 'host_not_in' then 'The closer left the room and did not come back.'
                                    else 'The room closed before the lead joined.' end);
      end if;
    end loop;
    summary := summary || jsonb_build_object('room_closed_no_lead', n); moved_live := moved_live + n;
  exception when others then
    errs := errs || jsonb_build_object('rule', 'room_closed_no_lead', 'error', sqlerrm);
  end;

  -- R5. A standby room ends after standby_max (Zoom ends a meeting 40
  -- minutes after only one person is left); while its host is still
  -- Available, rooms are on, the provider is on and no booked call is near,
  -- a fresh standby room is asked for in the same run (glossary 1.9). R6. An
  -- empty standby room ends booked_guard before the host's next booked call.
  -- R8. An empty standby room ends when its host is no longer available.
  -- None of these ever touches a room with a lead in it.
  begin
    n := 0; made := 0;
    for rec in
      select x.id, x.host_email, x.provider, x.call_kind
        from public.cockpit_sales_rooms as x
       where x.purpose = 'standby' and x.contact_id is null and x.state in ('open', 'host_in')
         and coalesce(x.host_in_at, x.opened_at, x.requested_at) + w_standby_max < t
       for update skip locked
    loop
      fresh := coalesce((cfg -> 'enabled') = 'true'::jsonb, false)
               and (lcfg -> 'standby') is distinct from 'false'::jsonb
               and coalesce((cfg -> 'providers' -> rec.provider) = 'true'::jsonb, false)
               and exists (select 1 from public.cockpit_sales_availability as a
                            where a.email = rec.host_email and a.state = 'available' and a.until > t + w_standby_host)
               and not exists (
                 select 1
                   from public.cockpit_sales_people as p
                   join public.cockpit_sales_appointments as ap on ap.assigned_user_id = p.ghl_user_id
                  where p.email = rec.host_email and p.ghl_user_id is not null
                    and ap.status in ('new', 'confirmed')
                    and ap.start_at > t and ap.start_at <= t + w_booked_guard);
      n := n + public.cockpit_sales_rooms_close(array[rec.id], array['open', 'host_in'], 'ended', 'standby_refresh',
        case when fresh
          then format('Closed after %s minutes, before Zoom closes it. A fresh room is being made: join it from the strip.', standby_min)
          else format('Closed after %s minutes, before Zoom closes it. Press I''m available for a fresh room.', standby_min) end,
        null, null);
      if fresh then
        begin
          insert into public.cockpit_sales_rooms (request_id, purpose, call_kind, provider, host_email, made_by)
          values (gen_random_uuid(), 'standby', rec.call_kind, rec.provider, rec.host_email, 'sweep')
          returning id into new_id;
          insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, handled_at, text, detail)
          values (new_id, 'sweep.standby_fresh', 'sweep', 'sweep:' || new_id::text || ':standby_fresh', t,
                  'A fresh standby room, because the last one reached its time.', jsonb_build_object('replaces', rec.id));
          insert into public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
          values ('room.create', 'cockpit_sales_rooms', new_id::text, null, 'sales', 'pg_cron', null,
                  jsonb_build_object('state', 'requested', 'purpose', 'standby', 'host_email', rec.host_email),
                  jsonb_build_object('rule', 'standby_fresh', 'replaces', rec.id));
          made := made + 1;
        exception when unique_violation then
          null; -- The host has another room already.
        end;
      end if;
    end loop;
    summary := summary || jsonb_build_object('standby_refresh', n, 'standby_fresh', made); moved_rooms := moved_rooms + n;
  exception when others then
    errs := errs || jsonb_build_object('rule', 'standby_refresh', 'error', sqlerrm);
  end;

  begin
    select coalesce(array_agg(q.id), '{}') into ids from (
      select x.id from public.cockpit_sales_rooms as x
       where x.purpose = 'standby' and x.contact_id is null and x.state in ('open', 'host_in')
         and exists (
           select 1
             from public.cockpit_sales_people as p
             join public.cockpit_sales_appointments as ap on ap.assigned_user_id = p.ghl_user_id
            where p.email = x.host_email and p.ghl_user_id is not null
              and ap.status in ('new', 'confirmed')
              and ap.start_at > t and ap.start_at <= t + w_booked_guard)
       for update skip locked) as q;
    n := public.cockpit_sales_rooms_close(ids, array['open', 'host_in'], 'ended', 'booked_call_soon',
      format('Closed: the host has a booked call starting within %s minutes.',
             round(extract(epoch from w_booked_guard) / 60)), null, null);
    summary := summary || jsonb_build_object('booked_call_soon', n); moved_rooms := moved_rooms + n;
  exception when others then
    errs := errs || jsonb_build_object('rule', 'booked_call_soon', 'error', sqlerrm);
  end;

  begin
    select coalesce(array_agg(q.id), '{}') into ids from (
      select x.id from public.cockpit_sales_rooms as x
        join public.cockpit_sales_availability as a on a.email = x.host_email
       where x.purpose = 'standby' and x.contact_id is null
         and x.state in ('requested', 'creating', 'open', 'host_in')
         and x.requested_at < t - interval '60 seconds'
         and (a.state = 'away' or a.until <= t)
       for update of x skip locked) as q;
    n := public.cockpit_sales_rooms_close(ids, array['open', 'host_in'], 'ended', 'host_away',
      'Closed: the host is no longer available.', null, null);
    n := n + public.cockpit_sales_rooms_close(ids, array['requested', 'creating'], 'cancelled', 'host_away',
      'Cancelled: the host is no longer available.', null, null);
    summary := summary || jsonb_build_object('host_away', n); moved_rooms := moved_rooms + n;
  exception when others then
    errs := errs || jsonb_build_object('rule', 'host_away', 'error', sqlerrm);
  end;

  -- R7. lead_in: no end signal by ends_at + no_end_signal. The only rule that
  -- ends a room with the lead in it. No call goes to Zoom or Google.
  begin
    select coalesce(array_agg(q.id), '{}') into ids from (
      select x.id from public.cockpit_sales_rooms as x
       where x.state = 'lead_in'
         and coalesce(x.ends_at,
                      coalesce(x.lead_in_at, x.opened_at, x.requested_at)
                        + make_interval(mins => public.cockpit_sales_setting_int(len, x.call_kind,
                            case when x.call_kind = 'demo' then 60 else 30 end)))
             + w_no_end < t
       for update skip locked) as q;
    n := public.cockpit_sales_rooms_close(ids, array['lead_in'], 'ended', 'no_end_signal',
      format('Ended: no end signal %s minutes after the planned end.', round(extract(epoch from w_no_end) / 60)),
      'joined', null);
    summary := summary || jsonb_build_object('no_end_signal', n); moved_rooms := moved_rooms + n;
  exception when others then
    errs := errs || jsonb_build_object('rule', 'no_end_signal', 'error', sqlerrm);
  end;

  -- L4. The room ended after the lead joined: the handover is done. Rooms that
  -- closed with no lead in this run were picked up by L2 and L3 above or are
  -- picked up next minute.
  begin
    n := 0;
    for rec in
      select x.id
        from public.cockpit_sales_live as x
        join public.cockpit_sales_rooms as r on r.id = x.room_id
       where x.state in ('claimed', 'room_ready', 'lead_joined')
         and r.state = any (finals) and r.lead_in_at is not null
       for update of x skip locked
    loop
      n := n + public.cockpit_sales_live_move(rec.id, array['claimed', 'room_ready', 'lead_joined'], 'done', 'room_ended',
             'The call ended.');
    end loop;
    summary := summary || jsonb_build_object('handover_done', n); moved_live := moved_live + n;
  exception when others then
    errs := errs || jsonb_build_object('rule', 'handover_done', 'error', sqlerrm);
  end;

  -- E0. Events that had their 3 tries and the time after the last one, and
  -- that nobody holds, are given up: handled, with detail.gave_up. The
  -- watchdog raises one alert a day for them.
  begin
    with gone as (
      update public.cockpit_sales_room_events as e
         set handled_at = t, lease_until = null,
             detail = e.detail || jsonb_build_object('gave_up', true, 'gave_up_at', t, 'tries', e.tries)
       where e.handled_at is null
         and (e.source = any (replayable) or e.source = 'settle')
         and e.tries >= 3
         and (e.last_try_at is null or e.last_try_at + w_replay < t)
         and (e.lease_until is null or e.lease_until < t)
      returning e.id
    )
    select count(*) into n from gone;
    summary := summary || jsonb_build_object('gave_up', n);
  exception when others then
    errs := errs || jsonb_build_object('rule', 'event_give_up', 'error', sqlerrm);
  end;

  -- E1. Events still unhandled after event_replay seconds, and not held by a
  -- room.event run, go back to room.event, at most 3 tries each,
  -- event_replay apart, 50 a run. This function only picks them; the tick
  -- posts them to sales-live/cron as sweep.replay.
  begin
    with due as (
      select e.id from public.cockpit_sales_room_events as e
       where e.handled_at is null and e.source = any (replayable)
         and e.at + w_replay < t and e.tries < 3
         and (e.last_try_at is null or e.last_try_at + w_replay < t)
         and (e.lease_until is null or e.lease_until < t)
       order by e.at
       limit 50
       for update skip locked
    ),
    bumped as (
      update public.cockpit_sales_room_events as e
         set tries = e.tries + 1, last_try_at = t
        from due as d
       where e.id = d.id
      returning e.id
    )
    select coalesce(jsonb_agg(b.id::text order by b.id), '[]'::jsonb) into replay from bumped as b;
    summary := summary || jsonb_build_object('replay_count', jsonb_array_length(replay));
  exception when others then
    errs := errs || jsonb_build_object('rule', 'event_replay', 'error', sqlerrm);
  end;

  -- S1. A booked intro that expired with no lead in it and no knock becomes a
  -- no-show at start + settle (D14). Each one gets one settle event
  -- (sweep.settle:{room id}); the tick posts the rooms as sweep.settle until
  -- room.event settles them (settled_mark) and marks the event handled, 3
  -- tries, event_replay apart.
  begin
    insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, text, detail)
    select x.id, 'sweep.settle', 'settle', 'sweep.settle:' || x.id::text, t,
           'Due to be settled: the booked intro expired with no lead in it.',
           jsonb_build_object('appointment_id', x.appointment_id)
      from public.cockpit_sales_rooms as x
      join public.cockpit_sales_appointments as ap on ap.appointment_id = x.appointment_id
     where x.purpose = 'booked' and x.call_kind = 'intro' and x.state = 'expired'
       and x.settled_mark is null and x.lead_in_at is null and x.result is distinct from 'admit_blocked'
       and ap.start_at + w_settle < t
    on conflict (dedupe_key) do nothing;

    select count(*) into settle_due
      from public.cockpit_sales_room_events as e
     where e.source = 'settle' and e.handled_at is null;

    with due as (
      select e.id, e.room_id from public.cockpit_sales_room_events as e
       where e.source = 'settle' and e.handled_at is null and e.tries < 3
         and (e.last_try_at is null or e.last_try_at + w_replay < t)
         and (e.lease_until is null or e.lease_until < t)
       order by e.at
       limit 50
       for update skip locked
    ),
    bumped as (
      update public.cockpit_sales_room_events as e
         set tries = e.tries + 1, last_try_at = t
        from due as d
       where e.id = d.id
      returning e.room_id
    )
    select coalesce(jsonb_agg(b.room_id::text order by b.room_id), '[]'::jsonb) into settle from bumped as b;
    summary := summary || jsonb_build_object('settle_due', settle_due);
  exception when others then
    errs := errs || jsonb_build_object('rule', 'settle', 'error', sqlerrm);
  end;

  summary := summary || jsonb_build_object(
    'at', t, 'rooms_moved', moved_rooms, 'handovers_moved', moved_live,
    'replay', replay, 'settle', settle, 'errors', errs);

  insert into public.cockpit_sales_worker_status (worker, job, ok, detail, at)
  values ('sales-api', 'sweep', jsonb_array_length(errs) = 0,
          left(case when jsonb_array_length(errs) = 0
                 then format('%s rooms closed, %s handovers moved, %s events sent back to room.event, %s rooms to settle.',
                             moved_rooms, moved_live, jsonb_array_length(replay), jsonb_array_length(settle))
                 else format('%s rules failed: %s', jsonb_array_length(errs), errs::text) end, 500),
          t)
  on conflict (worker, job) do update
     set ok = excluded.ok, detail = excluded.detail, at = excluded.at;

  return summary;
end;
$$;
revoke all on function public.cockpit_sales_rooms_sweep() from public, anon, authenticated;
grant execute on function public.cockpit_sales_rooms_sweep() to service_role;

-- The cron job's one statement: the sweep, then the posts to sales-live/cron
-- with the shared cron secret (vault cockpit_sync_secret), like
-- mahara-sales-mirror:
--   {"action": "room.event", "kind": "sweep.replay", "payload": {"event_ids": [...]}}
--   {"action": "room.event", "kind": "sweep.settle", "payload": {"room_ids": [...]}}
-- room.event takes each event (cockpit_sales_room_event_lease) and sets
-- handled_at when it is done. Nothing is posted when nothing is due. The
-- sweep always runs, secret or not; without the secret the sweep's status
-- row says what is waiting.
create or replace function public.cockpit_sales_rooms_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url constant text := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/cron';
  r jsonb;
  secret text;
  posted integer := 0;
  waiting integer;
begin
  r := public.cockpit_sales_rooms_sweep();
  if r ? 'skipped' then
    return r;
  end if;
  waiting := jsonb_array_length(coalesce(r -> 'replay', '[]'::jsonb)) + jsonb_array_length(coalesce(r -> 'settle', '[]'::jsonb));
  if waiting = 0 then
    return r || jsonb_build_object('posted', 0);
  end if;
  select ds.decrypted_secret into secret
    from vault.decrypted_secrets as ds
   where ds.name = 'cockpit_sync_secret'
   limit 1;
  if secret is null or btrim(secret) = '' then
    update public.cockpit_sales_worker_status as s
       set ok = false,
           detail = left(format('%s events wait for room.event, but the vault has no cockpit_sync_secret, so nothing was sent. Add it to the vault.', waiting), 500)
     where s.worker = 'sales-api' and s.job = 'sweep';
    return r || jsonb_build_object('posted', 0, 'post_note', 'The vault has no cockpit_sync_secret.');
  end if;
  if jsonb_array_length(coalesce(r -> 'replay', '[]'::jsonb)) > 0 then
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('action', 'room.event', 'kind', 'sweep.replay',
                                 'payload', jsonb_build_object('event_ids', r -> 'replay')),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
      timeout_milliseconds := 10000);
    posted := posted + 1;
  end if;
  if jsonb_array_length(coalesce(r -> 'settle', '[]'::jsonb)) > 0 then
    perform net.http_post(
      url := v_url,
      body := jsonb_build_object('action', 'room.event', 'kind', 'sweep.settle',
                                 'payload', jsonb_build_object('room_ids', r -> 'settle')),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
      timeout_milliseconds := 10000);
    posted := posted + 1;
  end if;
  return r || jsonb_build_object('posted', posted);
end;
$$;
revoke all on function public.cockpit_sales_rooms_tick() from public, anon, authenticated;
grant execute on function public.cockpit_sales_rooms_tick() to service_role;

-- 12. The watchdog: one alert per incident -----------------------------------

-- Saturday to Thursday, 09:00 to 21:00 Kuwait time.
create or replace function public.cockpit_sales_alert_hours(p_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select extract(isodow from (p_at at time zone 'Asia/Kuwait')) <> 5
     and extract(hour from (p_at at time zone 'Asia/Kuwait')) >= 9
     and extract(hour from (p_at at time zone 'Asia/Kuwait')) < 21
$$;
revoke all on function public.cockpit_sales_alert_hours(timestamptz) from public, anon, authenticated;
grant execute on function public.cockpit_sales_alert_hours(timestamptz) to service_role;

-- A worker's own words, fit for #sales-alerts: one line, no addresses, a
-- person's first name replaced by their role (the channel names roles, never
-- people), and cut at the last full sentence that fits in p_max characters.
create or replace function public.cockpit_sales_alert_words(p_text text, p_max integer default 160)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s text := btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
  r record;
  cut text;
begin
  s := regexp_replace(s, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', 'an address', 'g');
  for r in
    select distinct lower(split_part(btrim(p.name), ' ', 1)) as word,
           case p.role when 'closer' then 'the closer' when 'setter' then 'the setter' else 'a manager' end as role_words
      from public.cockpit_sales_people as p
     where split_part(btrim(coalesce(p.name, '')), ' ', 1) ~ '^[A-Za-z]{3,30}$'
  loop
    s := regexp_replace(s, '\m' || r.word || '\M', r.role_words, 'gi');
  end loop;
  if length(s) <= p_max then
    return s;
  end if;
  -- The last sentence end that fits (a . ! or ? followed by a space).
  cut := substring(left(s, p_max + 1) from '^(.*[.!?])\s');
  if cut is not null and length(cut) >= 20 then
    return cut;
  end if;
  cut := substring(left(s, p_max) from '^(.*)\s');
  return coalesce(nullif(cut, ''), left(s, p_max)) || '...';
end;
$$;
revoke all on function public.cockpit_sales_alert_words(text, integer) from public, anon, authenticated;
grant execute on function public.cockpit_sales_alert_words(text, integer) to service_role;

-- Opens (or keeps open) the alert for p_key, or closes it when p_on is false.
-- Returns 1 when a new incident was raised.
create or replace function public.cockpit_sales_alert_set(
  p_key text, p_on boolean, p_kind text, p_subject text, p_message text, p_detail jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  fresh boolean;
begin
  if p_on then
    insert into public.cockpit_sales_alerts as a (dedupe_key, source, kind, subject, message, detail)
    values (p_key, 'watchdog', p_kind, p_subject, p_message, coalesce(p_detail, '{}'::jsonb))
    on conflict (dedupe_key) do update
       set last_seen_at = now(), detail = excluded.detail
    returning (a.xmax = 0) into fresh;
    return case when fresh then 1 else 0 end;
  end if;
  update public.cockpit_sales_alerts as a
     set resolved_at = now(),
         dedupe_key = a.dedupe_key || ':resolved:' || a.id::text
   where a.dedupe_key = p_key and a.resolved_at is null;
  return 0;
end;
$$;
revoke all on function public.cockpit_sales_alert_set(text, boolean, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.cockpit_sales_alert_set(text, boolean, text, text, text, jsonb) to service_role;

create or replace function public.cockpit_sales_watchdog()
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '10s'
as $$
declare
  t constant timestamptz := now();
  in_hours constant boolean := public.cockpit_sales_alert_hours(now());
  day_key constant text := 'room_events_gave_up:' || to_char(now() at time zone 'Asia/Kuwait', 'YYYY-MM-DD');
  rooms jsonb := coalesce((select s.value from public.cockpit_sales_settings as s where s.key = 'rooms'), '{}'::jsonb);
  live jsonb := coalesce((select s.value from public.cockpit_sales_settings as s where s.key = 'live'), '{}'::jsonb);
  threads jsonb := coalesce((select s.value from public.cockpit_sales_settings as s where s.key = 'threads'), '{}'::jsonb);
  rec record;
  subj text;
  since text;
  words text;
  watched boolean;
  is_missing boolean;
  is_stale boolean;
  is_failing boolean;
  raised integer := 0;
  open_n integer;
  posted integer := 0;
  hook text;
  req bigint;
  stuck integer;
  gave_up integer;
  note text;
begin
  if not pg_try_advisory_xact_lock(hashtext('cockpit_sales_watchdog')) then
    return jsonb_build_object('skipped', 'Another watchdog run is going.');
  end if;

  -- 1. The status rows (glossary 1.7, plus the desk's waves and model rows).
  -- switch_on null: watched once the row exists; true or false: watched only
  -- while the feature is switched on, and then a missing row is an alert too
  -- (missing is never zero).
  for rec in
    select w.worker, w.job, w.stale_min, w.label, w.effect, w.switch_on, s.ok, s.detail, s.at
      from (values
        ('sales-desk', 'rooms',     10, 'The room worker',       'New video rooms cannot be made.',
           coalesce((rooms -> 'enabled') = 'true'::jsonb, false)),
        ('sales-desk', 'slack',     10, 'The Slack poster',      'Live offers cannot reach Slack.',
           coalesce((live -> 'enabled') = 'true'::jsonb, false) and coalesce((live -> 'slack') = 'true'::jsonb, false)),
        ('sales-desk', 'watch',     10, 'The reply watcher',     'New replies are not being flagged.', null),
        ('sales-desk', 'followups', 75, 'The follow-up drafter', 'No new follow-ups are being drafted.', null),
        ('sales-desk', 'waves',     15, 'The backlog wave run',  'Backlog openers are not being written or sent.', null),
        ('sales-desk', 'model',     75, 'The drafting model',    'Nothing that needs the model can be drafted.', null),
        ('sales-desk', 'doctor',    75, 'The sales desk doctor', 'Nobody is checking the desk. Check the VPS and the Claude sign-in.', null),
        ('sales-api',  'threads',   10, 'The demo chat tick',    'Demo chat steps are not going out.',
           coalesce((threads -> 'enabled') = 'true'::jsonb, false)),
        ('sales-api',  'sweep',      5, 'The room sweep',        'Rooms past their time are not being closed.', null)
      ) as w(worker, job, stale_min, label, effect, switch_on)
      left join public.cockpit_sales_worker_status as s on s.worker = w.worker and s.job = w.job
  loop
    subj := rec.worker || '/' || rec.job;
    watched := coalesce(rec.switch_on, rec.at is not null);
    is_missing := watched and rec.at is null;
    is_stale := watched and rec.at is not null and rec.at < t - make_interval(mins => rec.stale_min);
    is_failing := watched and rec.at is not null and not is_stale and rec.ok is false;
    since := case
      when rec.at is null then null
      when (rec.at at time zone 'Asia/Kuwait')::date = (t at time zone 'Asia/Kuwait')::date
        then to_char(rec.at at time zone 'Asia/Kuwait', 'HH24:MI')
      else to_char(rec.at at time zone 'Asia/Kuwait', 'FMDD Mon HH24:MI') end;
    words := rtrim(public.cockpit_sales_alert_words(rec.detail, 160), '.!? ');

    raised := raised + public.cockpit_sales_alert_set('missing:' || subj, is_missing, 'missing', subj,
      format('%s has never reported. %s', rec.label, rec.effect),
      jsonb_build_object('worker', rec.worker, 'job', rec.job));
    raised := raised + public.cockpit_sales_alert_set('stale:' || subj, is_stale, 'stale', subj,
      format('%s has not run since %s. %s', rec.label, since, rec.effect),
      jsonb_build_object('worker', rec.worker, 'job', rec.job, 'last_at', rec.at, 'stale_min', rec.stale_min));
    raised := raised + public.cockpit_sales_alert_set('failing:' || subj, is_failing, 'failing', subj,
      format('%s reported a problem at %s: %s. %s', rec.label, since, coalesce(nullif(words, ''), 'no detail'), rec.effect),
      jsonb_build_object('worker', rec.worker, 'job', rec.job, 'last_at', rec.at));
  end loop;

  -- 2. Room events that have waited more than 10 minutes (in the last day)
  -- and are still not handled: the sweep or room.event is not keeping up.
  select count(*) into stuck
    from public.cockpit_sales_room_events as e
   where e.handled_at is null and e.source in ('zoom', 'slack', 'worker', 'claim', 'settle')
     and e.at < t - interval '10 minutes' and e.at > t - interval '1 day';
  raised := raised + public.cockpit_sales_alert_set('room_events_unhandled', stuck > 0, 'room_events', 'room_events',
    format('%s Zoom, Slack, worker or claim events have waited more than 10 minutes. Rooms may show the wrong state. Check the room sweep and sales-live.', stuck),
    jsonb_build_object('count', stuck));

  -- 2b. Events given up after 3 tries today (Kuwait day): one alert a day.
  select count(*) into gave_up
    from public.cockpit_sales_room_events as e
   where e.detail ? 'gave_up'
     and e.handled_at >= ((t at time zone 'Asia/Kuwait')::date)::timestamp at time zone 'Asia/Kuwait';
  update public.cockpit_sales_alerts as a
     set resolved_at = t,
         dedupe_key = a.dedupe_key || ':resolved:' || a.id::text
   where a.dedupe_key like 'room_events_gave_up:%' and a.dedupe_key <> day_key and a.resolved_at is null;
  raised := raised + public.cockpit_sales_alert_set(day_key, gave_up > 0, 'room_events_gave_up', 'room_events',
    format('%s room events were given up today after 3 tries. Each one is a Zoom, Slack, worker or claim signal no room acted on. Check sales-live and the room events list.', gave_up),
    jsonb_build_object('count', gave_up));

  -- 3. Answers to earlier posts: a failed post is tried again, 3 tries at most.
  update public.cockpit_sales_alerts as a
     set post_status = coalesce(r.status_code, 0),
         post_error = case when r.status_code between 200 and 299 then null
                           else left(coalesce(r.error_msg, case when r.timed_out then 'Timed out' end,
                                              'Slack answered ' || coalesce(r.status_code::text, 'nothing')), 500) end,
         posted_at = case when r.status_code between 200 and 299 or a.post_tries >= 3 then a.posted_at end
    from net._http_response as r
   where r.id = a.post_request_id and a.post_status is null;

  -- 4. Post open alerts that were not posted yet, in working hours only.
  select ds.decrypted_secret into hook
    from vault.decrypted_secrets as ds
   where ds.name = 'sales_alerts_slack_webhook'
   limit 1;
  if hook is not null and hook !~ '^https://' then
    hook := null;
  end if;

  if not in_hours then
    note := 'Waiting for working hours: Saturday to Thursday, 09:00 to 21:00 Kuwait time.';
  elsif hook is null then
    note := 'Recorded only: the vault has no sales_alerts_slack_webhook.';
  end if;

  if note is not null then
    update public.cockpit_sales_alerts as a
       set post_error = note
     where a.resolved_at is null and a.posted_at is null and a.post_tries = 0 and a.post_error is distinct from note;
  else
    for rec in
      select a.id, a.message
        from public.cockpit_sales_alerts as a
       where a.resolved_at is null and a.posted_at is null and a.post_tries < 3
       order by a.raised_at
       limit 10
       for update skip locked
    loop
      req := net.http_post(
        url := hook,
        body := jsonb_build_object('text', rec.message),
        headers := jsonb_build_object('Content-Type', 'application/json'),
        timeout_milliseconds := 5000);
      update public.cockpit_sales_alerts as a
         set posted_at = t, post_request_id = req, post_tries = a.post_tries + 1, post_status = null, post_error = null
       where a.id = rec.id;
      posted := posted + 1;
    end loop;
  end if;

  select count(*) into open_n from public.cockpit_sales_alerts as a where a.resolved_at is null;

  insert into public.cockpit_sales_worker_status (worker, job, ok, detail, at)
  values ('sales-api', 'watchdog', true,
          format('%s open alerts, %s new, %s posted.%s', open_n, raised, posted, coalesce(' ' || note, '')), t)
  on conflict (worker, job) do update
     set ok = excluded.ok, detail = excluded.detail, at = excluded.at;

  return jsonb_build_object('at', t, 'in_hours', in_hours, 'open', open_n, 'raised', raised,
                            'posted', posted, 'webhook', hook is not null, 'note', note);
end;
$$;
revoke all on function public.cockpit_sales_watchdog() from public, anon, authenticated;
grant execute on function public.cockpit_sales_watchdog() to service_role;

-- 13. Row security and grants ------------------------------------------------

alter table public.cockpit_sales_rooms enable row level security;
drop policy if exists cockpit_sales_rooms_seat_read on public.cockpit_sales_rooms;
create policy cockpit_sales_rooms_seat_read on public.cockpit_sales_rooms
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on public.cockpit_sales_rooms from public, anon, authenticated;
grant select on public.cockpit_sales_rooms to authenticated;
grant all on public.cockpit_sales_rooms to service_role;

alter table public.cockpit_sales_room_secrets enable row level security;
revoke all on public.cockpit_sales_room_secrets from public, anon, authenticated;
grant all on public.cockpit_sales_room_secrets to service_role;

alter table public.cockpit_sales_room_events enable row level security;
drop policy if exists cockpit_sales_room_events_seat_read on public.cockpit_sales_room_events;
create policy cockpit_sales_room_events_seat_read on public.cockpit_sales_room_events
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on public.cockpit_sales_room_events from public, anon, authenticated;
grant select on public.cockpit_sales_room_events to authenticated;
grant all on public.cockpit_sales_room_events to service_role;

alter table public.cockpit_sales_room_hosts enable row level security;
drop policy if exists cockpit_sales_room_hosts_seat_read on public.cockpit_sales_room_hosts;
create policy cockpit_sales_room_hosts_seat_read on public.cockpit_sales_room_hosts
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on public.cockpit_sales_room_hosts from public, anon, authenticated;
grant select on public.cockpit_sales_room_hosts to authenticated;
grant all on public.cockpit_sales_room_hosts to service_role;

alter table public.cockpit_sales_availability enable row level security;
drop policy if exists cockpit_sales_availability_seat_read on public.cockpit_sales_availability;
create policy cockpit_sales_availability_seat_read on public.cockpit_sales_availability
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on public.cockpit_sales_availability from public, anon, authenticated;
grant select on public.cockpit_sales_availability to authenticated;
grant all on public.cockpit_sales_availability to service_role;

alter table public.cockpit_sales_live enable row level security;
drop policy if exists cockpit_sales_live_seat_read on public.cockpit_sales_live;
create policy cockpit_sales_live_seat_read on public.cockpit_sales_live
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on public.cockpit_sales_live from public, anon, authenticated;
grant select on public.cockpit_sales_live to authenticated;
grant all on public.cockpit_sales_live to service_role;

alter table public.cockpit_sales_alerts enable row level security;
revoke all on public.cockpit_sales_alerts from public, anon, authenticated;
grant all on public.cockpit_sales_alerts to service_role;

-- Presence: service role only (see section 9).
revoke all on public.cockpit_sales_presence from public, anon, authenticated;
grant select on public.cockpit_sales_presence to service_role;

-- 14. Settings: every master switch off. An existing row is never changed. ---

with added as (
  insert into public.cockpit_sales_settings (key, value, updated_by)
  values
    ('rooms', $json${"enabled": false, "test_only": true, "test_contacts": ["VjPfR4Cc1Y0OFvaqeor5"], "test_calendar_id": null,
      "providers": {"zoom": false, "meet": false}, "default_provider": {"setter": "meet", "closer": "zoom"},
      "send": {"whatsapp_text": false, "whatsapp_template": false, "email": false},
      "template_route": "call_link", "count_on_join": false, "short_link": false,
      "waits_s": {"ready": 15, "fail": 60, "meet_pending": 30, "manual_buttons": 30, "handover_host": 120,
        "standby_host": 300, "fallback_host": 900, "lead": 600, "open_grace": 180, "not_lead_undo": 300,
        "event_replay": 20, "settle": 1200, "no_end_signal": 1800, "standby_max": 2100, "booked_guard": 600,
        "unconfirmed": 20},
      "lengths_min": {"intro": 30, "demo": 60}, "booking_min": {"intro": 15, "demo": 45}, "available_hours": 2,
      "fallback": {"scope": "intro", "auto_on_miss": false, "pilot_emails": [], "ended_page_whatsapp": null}}$json$::jsonb,
     'migration 20261003a'),
    ('live', $json${"enabled": false, "slack": false, "closer_wait_s": 120,
      "kinds": {"demo": false, "intro": false},
      "entries": {"dialer": true, "lead_page": false, "inbox": false, "followup": false}, "standby": true,
      "hours": {"days": [6, 0, 1, 2, 3, 4], "from": "10:00", "to": "20:00", "tz": "Asia/Kuwait"}}$json$::jsonb,
     'migration 20261003a')
  on conflict (key) do nothing
  returning key, value
)
insert into public.cockpit_audit_log
  (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
select 'settings.create', 'cockpit_sales_settings', a.key, null, 'sales', 'migration', null, a.value,
       jsonb_build_object('by', 'migration 20261003a',
                          'why', 'Live calls foundation: rooms and handovers ship switched off (rooms.enabled and live.enabled false).')
  from added as a;

-- 15. pg_cron: the tick every minute, the watchdog every 5 minutes -----------

select cron.unschedule(j.jobid) from cron.job as j where j.jobname = 'mahara-sales-rooms-sweep';
select cron.schedule('mahara-sales-rooms-sweep', '* * * * *', $job$select public.cockpit_sales_rooms_tick();$job$);

select cron.unschedule(j.jobid) from cron.job as j where j.jobname = 'mahara-sales-watchdog';
select cron.schedule('mahara-sales-watchdog', '*/5 * * * *', $job$select public.cockpit_sales_watchdog();$job$);

notify pgrst, 'reload schema';

commit;
