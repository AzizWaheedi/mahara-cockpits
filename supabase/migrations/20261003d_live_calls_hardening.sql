-- Live calls, hardening after the first stress round (3 October 2026).
--
-- 20261003a, b and c are applied in production (dark: every switch off,
-- the tables empty). This migration changes what the stress round found,
-- in place of editing those files:
--   rooms        appointment_start_at (the booked intro's start when the
--                room was made: a later move of that intro is never settled
--                by this room); count_result gains unclear, already_counted
--                and self_reported.
--   messages     state gains unclear: a send whose answer was lost may have
--                gone, so nothing sends it again (never "failed").
--   slot         cockpit_sales_message_slot: the send ceilings (30 in ten
--                minutes a sender, one template a lead every two minutes,
--                the day's templates, the month's budget) counted and the
--                "sending" row written in one locked step, so a burst of
--                parallel sends cannot pass them. sales-api falls back to the
--                old checks while this function is missing.
--   guard        the database's clock owns the room timers: claimed_at and
--                opened_at are stamped here, and a room the worker opens
--                gets at least its host wait and its length from now, so a
--                VPS clock behind the database never closes a room early.
--   status rows  a desk status row written without `at` is stamped with the
--                database's clock (the health line and the watchdog compare
--                with it); the desk leaves `at` out.
--   lease        a try is counted when room.event leases an event, never
--                when the sweep only picks it; an outage never gives up a
--                Zoom join or a settle (E0 gives up after 10 real tries or a
--                day; a settle given up leaves settled_mark none and a "mark
--                this intro" alert, never a silent "confirmed").
--   claim        a closer who hosts another room cannot take a live lead
--                (take_host_busy), so the setter's room is never cancelled
--                for a room the closer cannot have.
--   unplaced     a Zoom event the door kept with no room (its lookup ran
--                out of time) is placed on its room by meeting id before any
--                rule reads the room's events; seats read only events that
--                belong to a room.
--   tick         the sweep's posts to sales-live/cron are kept by request
--                id and their answers read on the next run: a door that
--                refuses them turns the sweep's row red and raises an alert.
--   watchdog     a given-up settle or claim is one alert at once; the day's
--                give-up alert is posted again when its count rises and is
--                never resolved at midnight before it was posted.
--   presence     a booked call starting within booked_guard: away
--                (booked_soon), so no live lead is offered meanwhile.
--   sweep        R4 never closes a room whose Zoom or worker events were
--                given up as a no-show (events_lost); R5 makes a fresh
--                standby room only outside a booked call's life and inside
--                live.hours; R6 also ends a standby room during a booked call
--                already running; S1 settles a no-show only on evidence that
--                nobody came and leaves the rest for a person (settled_mark
--                none, a "mark this intro" alert).
--   watchdog     a Zoom join or worker event given up is one alert at once.
--
-- Checks: supabase/migrations/tests/run_checks.py applies a, b, c and d in
-- one rolled-back run; stress_time.py, stress_chaos.py and stress_numbers.py
-- apply d inside their own rolled-back runs.

begin;

-- 1. Columns and checks -------------------------------------------------------

alter table public.cockpit_sales_rooms
  add column if not exists appointment_start_at timestamptz;
comment on column public.cockpit_sales_rooms.appointment_start_at is
  'The booked intro''s start when the room was made. The settle compares it with the intro''s start now, so a room never settles an intro that was moved since.';

alter table public.cockpit_sales_rooms drop constraint if exists cockpit_sales_rooms_count_result_check;
alter table public.cockpit_sales_rooms add constraint cockpit_sales_rooms_count_result_check
  check (count_result is null or count_result in
         ('booked', 'moved', 'not_a_lead', 'failed', 'undone', 'unclear', 'already_counted', 'self_reported'));

alter table public.cockpit_sales_messages drop constraint if exists cockpit_sales_messages_state_check;
alter table public.cockpit_sales_messages add constraint cockpit_sales_messages_state_check
  check (state in ('sending', 'sent', 'delivered', 'read', 'failed', 'unclear'));
comment on column public.cockpit_sales_messages.state is
  'sending, then sent, delivered or read as HighLevel reports, or failed. unclear: HighLevel''s answer was lost (a timeout, a 5xx) or the write after it failed, so the message may have gone; nothing sends it again and a person reads the conversation.';

-- 2. Helpers --------------------------------------------------------------------

-- live.hours (glossary 1.10): whether live calls run at p_at. A damaged
-- value falls back to the shipped window (Saturday to Thursday, 10:00 to
-- 20:00 Kuwait), never to "always" (roomlogic.ts liveWindow).
create or replace function public.cockpit_sales_live_hours_open(p_hours jsonb, p_at timestamptz)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  tz text := coalesce(nullif(btrim(p_hours ->> 'tz'), ''), 'Asia/Kuwait');
  local_t timestamp;
  days integer[];
  f integer;
  e integer;
  m integer;
begin
  begin
    local_t := p_at at time zone tz;
  exception when others then
    local_t := p_at at time zone 'Asia/Kuwait';
  end;
  select array_agg(x::integer) into days
    from jsonb_array_elements_text(case when jsonb_typeof(p_hours -> 'days') = 'array' then p_hours -> 'days' else '[]'::jsonb end) as x
   where x ~ '^[0-6]$';
  if days is null then days := array[6, 0, 1, 2, 3, 4]; end if;
  f := case when coalesce(p_hours ->> 'from', '') ~ '^\d{1,2}:\d{2}$'
            then split_part(p_hours ->> 'from', ':', 1)::integer * 60 + split_part(p_hours ->> 'from', ':', 2)::integer end;
  e := case when coalesce(p_hours ->> 'to', '') ~ '^\d{1,2}:\d{2}$'
            then split_part(p_hours ->> 'to', ':', 1)::integer * 60 + split_part(p_hours ->> 'to', ':', 2)::integer end;
  if f is null or e is null or e <= f or e > 1440 then
    f := 600;
    e := 1200;
  end if;
  m := extract(hour from local_t)::integer * 60 + extract(minute from local_t)::integer;
  return extract(dow from local_t)::integer = any (days) and m >= f and m < e;
end;
$$;
revoke all on function public.cockpit_sales_live_hours_open(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.cockpit_sales_live_hours_open(jsonb, timestamptz) to service_role;

-- The message row under the send ceilings, in one step. Locks, always in
-- this order: the templates' day and month (templates only), the lead, the
-- sender; then counts again and writes the "sending" row. Answers
-- {code: ok, row}, {code: repeat, row} for a request id already used, or the
-- ceiling: sender_ceiling, lead_gap, per_day or budget (with count). The
-- limits come from sales-api (sendTemplate, convoSend): sender_max (30) in
-- sender_window_s (600), lead_gap_s (120), per_day, month_cap (the desk's
-- floor(budget / rate)), day_start and month_start (Kuwait).
create or replace function public.cockpit_sales_message_slot(p_row jsonb, p_limits jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
set lock_timeout = '5s'
as $$
declare
  rid uuid := (p_row ->> 'request_id')::uuid;
  contact text := nullif(btrim(coalesce(p_row ->> 'contact_id', '')), '');
  sender text := lower(btrim(coalesce(p_row ->> 'sent_by', '')));
  is_template boolean := coalesce(p_row ->> 'via', 'conversation') = 'workflow';
  twin public.cockpit_sales_messages;
  made public.cockpit_sales_messages;
  n integer;
begin
  if rid is null or contact is null then
    raise exception 'A message needs a request id and a lead.' using errcode = '22023';
  end if;
  if is_template then
    perform pg_advisory_xact_lock(hashtext('cockpit_sales_messages:templates'));
  end if;
  perform pg_advisory_xact_lock(hashtext('cockpit_sales_messages:lead:' || contact));
  perform pg_advisory_xact_lock(hashtext('cockpit_sales_messages:sender:' || sender));

  select * into twin from public.cockpit_sales_messages as m where m.request_id = rid;
  if found then
    return jsonb_build_object('code', 'repeat', 'row', to_jsonb(twin));
  end if;
  if sender <> '' then
    select count(*) into n from public.cockpit_sales_messages as m
     where m.sent_by = sender
       and m.created_at >= now() - make_interval(secs => coalesce((p_limits ->> 'sender_window_s')::integer, 600));
    if n >= coalesce((p_limits ->> 'sender_max')::integer, 30) then
      return jsonb_build_object('code', 'sender_ceiling', 'count', n);
    end if;
  end if;
  if is_template then
    if exists (select 1 from public.cockpit_sales_messages as m
                where m.contact_id = contact and m.via = 'workflow' and m.state <> 'failed'
                  and m.created_at >= now() - make_interval(secs => coalesce((p_limits ->> 'lead_gap_s')::integer, 120))) then
      return jsonb_build_object('code', 'lead_gap');
    end if;
    select count(*) into n from public.cockpit_sales_messages as m
     where m.via = 'workflow' and m.state <> 'failed'
       and m.created_at >= coalesce((p_limits ->> 'day_start')::timestamptz, date_trunc('day', now()));
    if n >= coalesce((p_limits ->> 'per_day')::integer, 250) then
      return jsonb_build_object('code', 'per_day', 'count', n);
    end if;
    select count(*) into n from public.cockpit_sales_messages as m
     where m.via = 'workflow' and m.state <> 'failed'
       and m.created_at >= coalesce((p_limits ->> 'month_start')::timestamptz, date_trunc('month', now()));
    if n >= coalesce((p_limits ->> 'month_cap')::integer, 1000000) then
      return jsonb_build_object('code', 'budget', 'count', n);
    end if;
  end if;
  insert into public.cockpit_sales_messages
    (request_id, contact_id, channel, via, template_key, workflow_id, subject, body, source, followup_id, sent_by, state)
  values (rid, contact, p_row ->> 'channel', coalesce(p_row ->> 'via', 'conversation'), p_row ->> 'template_key',
          p_row ->> 'workflow_id', p_row ->> 'subject', p_row ->> 'body', coalesce(p_row ->> 'source', 'rep'),
          nullif(p_row ->> 'followup_id', '')::uuid, coalesce(p_row ->> 'sent_by', ''), 'sending')
  returning * into made;
  return jsonb_build_object('code', 'ok', 'row', to_jsonb(made));
end;
$$;
revoke all on function public.cockpit_sales_message_slot(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.cockpit_sales_message_slot(jsonb, jsonb) to service_role;

-- The desk's status rows on the database's clock: the health line turns red
-- at 90 s and the watchdog alerts on age, both against now(), so a VPS clock
-- that is off never reads a running worker as down (or a dead one as up).
-- The desk leaves `at` out of its writes; a write that leaves it unchanged is
-- stamped now() here (an insert takes the column's default).
create or replace function public.cockpit_sales_worker_status_clock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.worker = 'sales-desk' and (new.at is null or (tg_op = 'UPDATE' and new.at is not distinct from old.at)) then
    new.at := now();
  end if;
  return new;
end;
$$;
revoke all on function public.cockpit_sales_worker_status_clock() from public, anon, authenticated;
drop trigger if exists cockpit_sales_worker_status_clock on public.cockpit_sales_worker_status;
create trigger cockpit_sales_worker_status_clock
  before insert or update on public.cockpit_sales_worker_status
  for each row execute function public.cockpit_sales_worker_status_clock();

-- 3. The rooms guard: the database's clock ------------------------------------

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
    -- A booked call wrapped late (room.wrap after its start + 15 minutes, a
    -- late lead): the call's own deadlines have passed, so the host gets the
    -- handover wait and the lead their wait from now, never past the call's
    -- end (roomlogic.ts wrapPlan). A room born past its deadlines would be
    -- closed by the next sweep as a no-join before anyone could come in.
    if new.purpose = 'booked' and new.state = 'open' and new.ends_at is not null then
      w := coalesce((select s.value -> 'waits_s' from public.cockpit_sales_settings as s where s.key = 'rooms'), '{}'::jsonb);
      if new.host_by is not null
         and new.host_by < now() + make_interval(secs => public.cockpit_sales_setting_int(w, 'handover_host', 120)) then
        new.host_by := least(now() + make_interval(secs => public.cockpit_sales_setting_int(w, 'handover_host', 120)), new.ends_at);
      end if;
      if new.lead_by is not null
         and new.lead_by < now() + make_interval(secs => public.cockpit_sales_setting_int(w, 'lead', 600)) then
        new.lead_by := greatest(coalesce(new.host_by, now()),
          least(now() + make_interval(secs => public.cockpit_sales_setting_int(w, 'lead', 600)), greatest(new.ends_at, new.lead_by)));
      end if;
    end if;
  end if;
  if tg_op = 'UPDATE' then
    -- Version: up by exactly one on a state change or when the writer asks
    -- for it (writes any new version); unchanged on every other write.
    if new.state is distinct from old.state or new.version is distinct from old.version then
      new.version := old.version + 1;
    end if;
    new.updated_at := now();
    -- The open columns, the door's only writes (door.ts OPEN_COLUMNS): the
    -- first open only ever moves earlier, the last open never moves back,
    -- and the first device read is kept. A late or repeated open, or 50 at
    -- once, can never undo one; none of them moves the version, so the lead
    -- tapping the link never makes a rep's next press "changed a moment ago".
    if old.first_open_at is not null then
      new.first_open_at := least(old.first_open_at, coalesce(new.first_open_at, old.first_open_at));
    end if;
    if old.last_open_at is not null then
      new.last_open_at := greatest(old.last_open_at, coalesce(new.last_open_at, old.last_open_at));
    end if;
    if old.open_device is not null then
      new.open_device := old.open_device;
    end if;
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
      -- The database's clock owns every timer (the sweep compares with
      -- now()): the steps the room worker reaches are stamped here, never
      -- from the VPS's clock, and a room the worker opens gets at least its
      -- host wait and its length from now (deadlines never move earlier).
      if new.state = 'creating' then
        new.claimed_at := now();
      end if;
      if new.state = 'open' and old.state in ('requested', 'creating') then
        new.opened_at := now();
        if new.purpose <> 'booked' then
          new.host_by := greatest(coalesce(new.host_by, now()), now() + make_interval(secs => case new.purpose
            when 'handover' then public.cockpit_sales_setting_int(w, 'handover_host', 120)
            when 'standby' then public.cockpit_sales_setting_int(w, 'standby_host', 300)
            else public.cockpit_sales_setting_int(w, 'fallback_host', 900) end));
          new.ends_at := greatest(coalesce(new.ends_at, now()), now() + make_interval(mins => public.cockpit_sales_setting_int(
            coalesce((select s.value -> 'lengths_min' from public.cockpit_sales_settings as s where s.key = 'rooms'), '{}'::jsonb),
            new.call_kind, case when new.call_kind = 'demo' then 60 else 30 end)));
        end if;
      end if;
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

-- 4. The event lease counts the tries ------------------------------------

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
  -- A try is counted here, when room.event really takes the event, never
  -- when the sweep only picks it for a replay nobody may answer (an outage).
  -- A settle (source settle) counts the same way: an outage of sales-api, the
  -- cron door or HighLevel never gives a booked intro's no-show up.
  update public.cockpit_sales_room_events as e
     set lease_until = now() + make_interval(secs => least(greatest(coalesce(p_seconds, 60), 1), 600)),
         tries = e.tries + case when e.source in ('zoom', 'slack', 'worker', 'claim', 'settle') then 1 else 0 end
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

-- 4b. The handover claim: never for a closer who hosts another room ---------

-- As 20261003a made it, with one check first, under the offer's lock: a
-- closer who hosts a room that is not their empty standby room, a booked
-- call's room or this lead's own is refused (take_host_busy) before anything
-- moves. Before, the claim went through, cancelled the setter's room with
-- the lead in it ("replaced") and adopted nothing; sales-api's room for the
-- closer was then refused (one room per host), and the lead's link led to a
-- closed room.
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

  -- The offer, locked, as the claim below reads it (taken, ended or not this
  -- closer's: nothing, as before).
  select * into l
    from public.cockpit_sales_live as x
   where x.id = p_live_id
     and x.state = 'offered'
     and x.offer_until > now()
     and me = any (x.offered_to)
     and (p_version is null or x.version = p_version)
   for update;
  if not found then
    return;
  end if;
  -- The taker already hosts a room that is not their empty standby room, a
  -- booked call's room or this lead's own (offered while Ready, then a dial
  -- and a room for another lead): refused before anything moves, so the
  -- lead's room is never cancelled for a room the taker cannot have (one
  -- room per host). sales-api answers "You already have a live call or room
  -- open."
  if exists (select 1 from public.cockpit_sales_rooms as x
              where lower(x.host_email) = me
                and x.state in ('requested', 'creating', 'open', 'host_in', 'lead_in')
                and x.purpose <> 'booked'
                and not (x.purpose = 'standby' and x.contact_id is null)
                and x.contact_id is distinct from l.contact_id) then
    raise exception 'take_host_busy: You already have a live call or room open. End it, then take the next lead.'
      using errcode = 'P0001', hint = 'End the room you host, then take the lead.';
  end if;

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

-- 5. Presence: a booked call starting soon ---------------------------------

-- The view as 20261003a made it, with booked_soon (a booked call of theirs
-- starting within booked_guard: away, reason booked_call_soon, booked_at and
-- booked_kind from that call), so no live lead is offered meanwhile.
drop view if exists public.cockpit_sales_presence;
create view public.cockpit_sales_presence
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
  case when w.why in ('dialing', 'lead_in', 'appointment', 'zoom', 'room_waiting', 'handover') then 'on_call'
       when w.why = 'standby' then 'ready'
       when w.why = 'available' then 'available'
       else 'away' end as state,
  case when w.why in ('standby', 'available') then av.until end as until,
  case w.why
    when 'lead_in' then mr.lead_in_id
    when 'room_waiting' then mr.waiting_id
    when 'handover' then ho.room_id
    when 'standby' then mr.standby_id
    when 'available' then mr.open_standby_id
  end as room_id,
  h.zoom_status,
  dp.provider as default_provider,
  w.why,
  case when w.why = 'booked_soon' then 'booked_call_soon'
       when av.state = 'away' and av.reason in ('missed_offer', 'expired') then av.reason end as reason,
  case when w.why = 'booked_soon' then nb.start_at end as booked_at,
  case when w.why = 'booked_soon' and nb.call_type in ('intro', 'demo') then nb.call_type end as booked_kind,
  p.role,
  coalesce(av.state, 'away') as availability,
  av.via as availability_via,
  av.reason as availability_reason
from seats as s
cross join cfg
left join public.cockpit_sales_people as p on p.email = s.email
left join public.cockpit_sales_availability as av on av.email = s.email
left join public.cockpit_sales_room_hosts as h on h.email = s.email
-- Their rooms that are not final (one that is not booked, at most, by the
-- one-per-host index; booked rooms beside it).
left join lateral (
  select
    (array_agg(r.id order by r.requested_at desc) filter (where r.state = 'lead_in'))[1] as lead_in_id,
    (array_agg(r.id order by r.requested_at desc)
       filter (where r.contact_id is not null and r.purpose <> 'booked' and r.state <> 'lead_in'))[1] as waiting_id,
    (array_agg(r.id order by r.requested_at desc)
       filter (where r.purpose = 'standby' and r.contact_id is null and r.state = 'host_in'))[1] as standby_id,
    (array_agg(r.id order by r.requested_at desc)
       filter (where r.purpose = 'standby' and r.contact_id is null))[1] as open_standby_id,
    coalesce(bool_or(r.provider = 'zoom' and r.state in ('open', 'host_in')), false) as own_zoom
    from public.cockpit_sales_rooms as r
   where r.host_email = s.email and r.state in ('requested', 'creating', 'open', 'host_in', 'lead_in')
) as mr on true
left join lateral (
  select true as held, l.room_id
    from public.cockpit_sales_live as l
   where l.claimed_by = s.email and l.state in ('claimed', 'room_ready', 'lead_joined')
   order by l.claimed_at desc nulls last
   limit 1
) as ho on true
cross join lateral (
  select
    exists (select 1 from public.cockpit_sales_attempts as a
             where a.rep_email = s.email and a.state in ('dialing', 'placed') and a.started_at > now() - interval '2 hours') as dialing,
    exists (select 1 from public.cockpit_sales_appointments as ap
             where p.ghl_user_id is not null
               and ap.assigned_user_id = p.ghl_user_id
               and ap.status in ('new', 'confirmed', 'showed')
               and ap.start_at <= now()
               and now() < ap.start_at + make_interval(mins => public.cockpit_sales_setting_int(
                     coalesce(cfg.rooms -> 'booking_min', '{}'::jsonb), coalesce(ap.call_type, ''), 30))) as appt_now,
    coalesce(h.zoom_live_until > now(), false) and not mr.own_zoom as zoom_live,
    -- A booked call of theirs starts within booked_guard: no live lead is
    -- offered to them and no standby room waits (R6 closes it).
    exists (select 1 from public.cockpit_sales_appointments as ap
             where p.ghl_user_id is not null
               and ap.assigned_user_id = p.ghl_user_id
               and ap.status in ('new', 'confirmed')
               and ap.start_at > now()
               and ap.start_at <= now() + make_interval(secs => public.cockpit_sales_setting_int(
                     coalesce(cfg.rooms -> 'waits_s', '{}'::jsonb), 'booked_guard', 600))) as booked_soon,
    coalesce(av.state = 'available' and av.until > now(), false) as avail
) as x
cross join lateral (
  select case
           when x.dialing then 'dialing'
           when mr.lead_in_id is not null then 'lead_in'
           when x.appt_now then 'appointment'
           when x.zoom_live then 'zoom'
           when mr.waiting_id is not null then 'room_waiting'
           when coalesce(ho.held, false) then 'handover'
           when x.booked_soon then 'booked_soon'
           when not x.avail then 'away'
           when mr.standby_id is not null then 'standby'
           else 'available'
         end as why
) as w
cross join lateral (
  select case
           when h.default_provider in ('meet', 'zoom') then h.default_provider
           when p.role = 'closer' then case when cfg.rooms #>> '{default_provider,closer}' in ('meet', 'zoom')
                                            then cfg.rooms #>> '{default_provider,closer}' else 'zoom' end
           else case when cfg.rooms #>> '{default_provider,setter}' in ('meet', 'zoom')
                     then cfg.rooms #>> '{default_provider,setter}' else 'meet' end
         end as pref,
         coalesce((cfg.rooms #> '{providers,zoom}') = 'true'::jsonb, false)
           and coalesce(h.zoom_status in ('licensed', 'basic'), false) as zoom_ok,
         coalesce((cfg.rooms #> '{providers,meet}') = 'true'::jsonb, false)
           and coalesce(h.google_ok, false) as meet_ok
) as pv
cross join lateral (
  select case
           when (pv.pref = 'zoom' and pv.zoom_ok) or (pv.pref = 'meet' and pv.meet_ok) then pv.pref
           when pv.pref = 'zoom' and pv.meet_ok then 'meet'
           when pv.pref = 'meet' and pv.zoom_ok then 'zoom'
           else pv.pref
         end as provider
) as dp
left join lateral (
  select ap.start_at, ap.call_type
    from public.cockpit_sales_appointments as ap
   where p.ghl_user_id is not null and ap.assigned_user_id = p.ghl_user_id
     and ap.status in ('new', 'confirmed') and ap.start_at > now()
   order by ap.start_at
   limit 1
) as nb on true;

comment on view public.cockpit_sales_presence is
  'Each rep''s live state, the first that applies (roomlogic.ts presenceOf): on_call (an open dial, the lead in their room, an appointment now, a live Zoom meeting that is not their own room, their room waiting for its lead, or a handover they hold), away (Available not pressed or run out), ready (in their own standby room), available. why names the rule; room_id is the room that matters now; default_provider is the one the host can use; reason, booked_at and booked_kind explain an Away or a closed standby room. Service role only; seats get it from sales-api live.status.';

-- 6. The sweep -----------------------------------------------------------------

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
  -- Real tries (leases by room.event) before an event is given up; an event
  -- nobody could take (an outage) waits until it is a day old.
  max_tries constant integer := 10;
  lost uuid[];
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
  ticks jsonb := '[]'::jsonb;
  settle_due integer := 0;
  -- roomlogic.ts PENDING_HOLD_MAX_S: a timer waits at most this long past
  -- its due time for the room's unhandled events to be replayed.
  w_hold constant interval := interval '300 seconds';
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

  -- P0. A Zoom event the door kept with no room (its room lookup ran out of
  -- time) is placed on its room by the meeting id, before any rule reads a
  -- room's events: R3, R4 and R7 wait for it, R4's events_lost and S1's doubt
  -- see it, as they see one the door placed. The room is the newest Zoom room
  -- on that meeting made before the event (sales-api's zoomEvent reads it the
  -- same way and places what is left by the topic's code).
  begin
    with cand as (
      select e.id,
             (select x.id from public.cockpit_sales_rooms as x
               where x.provider = 'zoom'
                 and x.provider_meeting_id = e.detail #>> '{payload,object,id}'
                 and x.requested_at <= e.at + interval '5 minutes'
                 and x.requested_at > e.at - interval '1 day'
               order by x.requested_at desc
               limit 1) as room_id
        from public.cockpit_sales_room_events as e
       where e.room_id is null and e.source = 'zoom' and e.handled_at is null
         and e.detail #>> '{payload,object,id}' is not null
         and e.at > t - interval '1 day'
       order by e.at
       limit 200
       for update of e skip locked
    ),
    placed as (
      update public.cockpit_sales_room_events as e
         set room_id = c.room_id
        from cand as c
       where e.id = c.id and c.room_id is not null
      returning e.id
    )
    select count(*) into n from placed;
    summary := summary || jsonb_build_object('zoom_placed', n);
  exception when others then
    errs := errs || jsonb_build_object('rule', 'zoom_place', 'error', sqlerrm);
  end;

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
  -- R3 to R8 and R7 wait while a Zoom, worker or claim event for the room
  -- is still unhandled (a knock or a join the door could not forward yet,
  -- roomlogic.ts F4 and F5), at most w_hold past the rule's due time; then
  -- the rule closes the room anyway. R1, R2 and the R9 backstop never wait.
  begin
    select coalesce(array_agg(q.id), '{}') into ids from (
      select x.id from public.cockpit_sales_rooms as x
       cross join lateral (
         select coalesce(x.host_by, coalesce(x.opened_at, x.requested_at) + case x.purpose
                  when 'handover' then w_handover
                  when 'standby' then w_standby_host
                  else w_fallback_host end) as due) as d
       where x.state = 'open'
         and (x.purpose <> 'booked' or x.host_by is not null)
         and d.due < t
         and (d.due + w_hold < t or not public.cockpit_sales_room_pending(x.id, t))
       for update of x skip locked) as q;
    n := public.cockpit_sales_rooms_close(ids, array['open'], 'expired', 'host_not_in',
      'Closed: the host did not join in time.', 'no_join', null);
    summary := summary || jsonb_build_object('host_not_in', n); moved_rooms := moved_rooms + n;
  exception when others then
    errs := errs || jsonb_build_object('rule', 'host_not_in', 'error', sqlerrm);
  end;

  -- R4. open or host_in with a lead: the lead did not join by lead_by, or,
  -- when unset, 10 minutes after the link went, the host came in, or the room
  -- opened (roomlogic.ts timers()). An open, or a knock in the waiting room,
  -- in the last 3 minutes keeps the room open until that moment + open_grace,
  -- never past the cap (roomlogic.ts graceCap, F12 and F18): the link (or the
  -- open) + lead + open_grace, or a booked room's ends_at. So a lead who
  -- reopens the link every 2 minutes cannot hold a room until the backstop.
  -- A lead who knocked and was never let in is not a no-show: not_admitted,
  -- result admit_blocked.
  begin
    select coalesce(array_agg(q.id), '{}'), coalesce(array_agg(q.id) filter (where q.knocked), '{}'),
           coalesce(array_agg(q.id) filter (where q.lost and not q.knocked), '{}')
      into ids, knocked, lost from (
      select x.id, x.lead_waiting_at is not null as knocked,
             exists (select 1 from public.cockpit_sales_room_events as e
                      where e.room_id = x.id and e.source in ('zoom', 'worker') and e.detail ? 'gave_up') as lost
        from public.cockpit_sales_rooms as x
       cross join lateral (
         select coalesce(case when x.purpose = 'booked' then x.ends_at
                              else coalesce(x.link_sent_at, x.opened_at) + w_lead + w_grace end,
                         'infinity'::timestamptz) as cap) as c
       cross join lateral (
         select greatest(coalesce(x.lead_by, x.link_sent_at + w_lead, x.host_in_at + w_lead,
                                  x.opened_at + w_lead, x.requested_at + w_lead),
                         case when coalesce(x.last_open_at, x.first_open_at) is not null
                              then least(coalesce(x.last_open_at, x.first_open_at) + w_grace, c.cap) end,
                         case when x.lead_waiting_at is not null
                              then least(x.lead_waiting_at + w_grace, c.cap) end) as due) as d
       where x.state in ('open', 'host_in')
         and x.contact_id is not null
         and (x.purpose <> 'booked' or x.lead_by is not null)
         and d.due < t
         and (d.due + w_hold < t or not public.cockpit_sales_room_pending(x.id, t))
       for update of x skip locked) as q;
    n := public.cockpit_sales_rooms_close(knocked, array['open', 'host_in'], 'expired', 'not_admitted',
      'Closed: the lead knocked but was not let in.', 'admit_blocked', null);
    -- A Zoom or worker event for the room was given up: whether the lead
    -- joined is not known, so the room is never closed as a no-show.
    n := n + public.cockpit_sales_rooms_close(lost, array['open', 'host_in'], 'expired', 'events_lost',
      'Closed: some of Zoom''s events for this room were never read, so whether the lead joined is not known. Mark the call by hand.',
      null, null);
    n := n + public.cockpit_sales_rooms_close(
      array(select i from unnest(ids) as i where not (i = any (knocked)) and not (i = any (lost))), array['open', 'host_in'], 'expired', 'lead_no_show',
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
         and (coalesce(x.host_in_at, x.opened_at, x.requested_at) + w_standby_max + w_hold < t
              or not public.cockpit_sales_room_pending(x.id, t))
       for update skip locked
    loop
      -- roomlogic.ts refreshWanted: no fresh room when a booked call of the
      -- host's starts before the fresh room's life and its guard are over,
      -- or is running now, and none outside live.hours.
      fresh := coalesce((cfg -> 'enabled') = 'true'::jsonb, false)
               and (lcfg -> 'standby') is distinct from 'false'::jsonb
               and coalesce((cfg -> 'providers' -> rec.provider) = 'true'::jsonb, false)
               and public.cockpit_sales_live_hours_open(lcfg -> 'hours', t)
               and exists (select 1 from public.cockpit_sales_availability as a
                            where a.email = rec.host_email and a.state = 'available' and a.until > t + w_standby_host)
               and not exists (
                 select 1
                   from public.cockpit_sales_people as p
                   join public.cockpit_sales_appointments as ap on ap.assigned_user_id = p.ghl_user_id
                  where p.email = rec.host_email and p.ghl_user_id is not null
                    and ap.status in ('new', 'confirmed', 'showed')
                    and ap.start_at <= t + w_standby_max + w_booked_guard
                    and ap.start_at + make_interval(mins => public.cockpit_sales_setting_int(
                          coalesce(cfg -> 'booking_min', '{}'::jsonb), coalesce(ap.call_type, ''), 30)) > t);
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
       cross join lateral (
         -- A booked call near, or one already running (booked late, or
         -- mirrored after its start): Zoom allows one meeting per host.
         select min(ap.start_at) - w_booked_guard as due
           from public.cockpit_sales_people as p
           join public.cockpit_sales_appointments as ap on ap.assigned_user_id = p.ghl_user_id
          where p.email = x.host_email and p.ghl_user_id is not null
            and ap.status in ('new', 'confirmed', 'showed')
            and ap.start_at <= t + w_booked_guard
            and ap.start_at + make_interval(mins => public.cockpit_sales_setting_int(
                  coalesce(cfg -> 'booking_min', '{}'::jsonb), coalesce(ap.call_type, ''), 30)) > t) as b
       where x.purpose = 'standby' and x.contact_id is null and x.state in ('open', 'host_in')
         and b.due is not null
         and (b.due + w_hold < t or not public.cockpit_sales_room_pending(x.id, t))
       for update of x skip locked) as q;
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
         and (greatest(x.requested_at + interval '60 seconds', coalesce(a.until, a.updated_at)) + w_hold < t
              or not public.cockpit_sales_room_pending(x.id, t))
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
       cross join lateral (
         select coalesce(x.ends_at,
                         coalesce(x.lead_in_at, x.opened_at, x.requested_at)
                           + make_interval(mins => public.cockpit_sales_setting_int(len, x.call_kind,
                               case when x.call_kind = 'demo' then 60 else 30 end)))
                + w_no_end as due) as d
       where x.state = 'lead_in'
         and d.due < t
         and (d.due + w_hold < t or not public.cockpit_sales_room_pending(x.id, t))
       for update of x skip locked) as q;
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

  -- E0. Events that had their real tries (max_tries leases by room.event,
  -- counted by cockpit_sales_room_event_lease, never by a pick nobody
  -- answered) and the time after the last one, or that are older than a day
  -- (roomlogic.ts REPLAY_MAX_AGE_S: left for a person, never replayed), and
  -- that nobody holds, are given up: handled, with detail.gave_up. A settle
  -- given up means the booked intro's no-show was never written: the room
  -- says settled_mark none and a person is told which intro to mark at once
  -- (room:{id}:mark_intro), never a silent "confirmed" (a show for B2B).
  -- The watchdog raises one alert a day for the rest, and one per lost join,
  -- worker event, settle or claim.
  begin
    create temp table if not exists lc_gave_up (id uuid primary key, room_id uuid, source text, kind text) on commit drop;
    truncate pg_temp.lc_gave_up;
    with gone as (
      update public.cockpit_sales_room_events as e
         set handled_at = t, lease_until = null,
             detail = e.detail || jsonb_build_object('gave_up', true, 'gave_up_at', t, 'tries', e.tries)
                      || case when e.at < t - interval '1 day' then jsonb_build_object('too_old', true) else '{}'::jsonb end
       where e.handled_at is null
         and (e.source = any (replayable) or e.source = 'settle')
         and ((e.tries >= max_tries and (e.last_try_at is null or e.last_try_at + w_replay < t))
              or e.at < t - interval '1 day')
         and (e.lease_until is null or e.lease_until < t)
      returning e.id, e.room_id, e.source, e.kind
    )
    insert into pg_temp.lc_gave_up (id, room_id, source, kind)
    select g.id, g.room_id, g.source, g.kind from gone as g;
    select count(*) into n from pg_temp.lc_gave_up;
    summary := summary || jsonb_build_object('gave_up', n);

    with marked as (
      update public.cockpit_sales_rooms as x
         set settled_mark = 'none'
        from pg_temp.lc_gave_up as g
       where g.source = 'settle' and x.id = g.room_id and x.settled_mark is null
      returning x.id, x.code
    ),
    ev as (
      insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, handled_at, text, detail)
      select m.id, 'sweep.settle_gave_up', 'sweep', 'sweep:' || m.id::text || ':settle_gave_up', t,
             'Not settled: the no-show could not be written after ten tries. A person marks the intro.',
             jsonb_build_object('why', 'gave_up')
        from marked as m
      on conflict (dedupe_key) do nothing
      returning 1
    ),
    au as (
      insert into public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
      select 'room.settle', 'cockpit_sales_rooms', m.id::text, null, 'sales', 'pg_cron',
             jsonb_build_object('settled_mark', null), jsonb_build_object('settled_mark', 'none'),
             jsonb_build_object('rule', 'settle_gave_up', 'code', m.code)
        from marked as m
      returning 1
    )
    select count(*) into n from marked;
    summary := summary || jsonb_build_object('settle_gave_up', n);
    for rec in
      select g.room_id, x.code
        from pg_temp.lc_gave_up as g
        join public.cockpit_sales_rooms as x on x.id = g.room_id
       where g.source = 'settle'
    loop
      perform public.cockpit_sales_alert_set('room:' || rec.room_id::text || ':mark_intro', true, 'room_mark_intro',
        'Room ' || rec.code,
        format('Room %s: the no-show could not be written (sales-api or HighLevel did not answer), so the booked intro is still open. Mark it shown or a no-show.', rec.code),
        jsonb_build_object('room_id', rec.room_id, 'code', rec.code));
    end loop;
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
         and e.at + w_replay < t and e.at >= t - interval '1 day' and e.tries < max_tries
         and (e.last_try_at is null or e.last_try_at + w_replay < t)
         and (e.lease_until is null or e.lease_until < t)
       order by e.at
       limit 50
       for update skip locked
    ),
    bumped as (
      -- Picked: spaced event_replay apart. The try itself is counted when
      -- room.event leases it (cockpit_sales_room_event_lease).
      update public.cockpit_sales_room_events as e
         set last_try_at = t
        from due as d
       where e.id = d.id
      returning e.id
    )
    select coalesce(jsonb_agg(b.id::text order by b.id), '[]'::jsonb) into replay from bumped as b;
    summary := summary || jsonb_build_object('replay_count', jsonb_array_length(replay));
  exception when others then
    errs := errs || jsonb_build_object('rule', 'event_replay', 'error', sqlerrm);
  end;

  -- S1. D14: a fallback room for a booked intro (not a booked room: its
  -- call is marked as any booked call is) that closed with nobody joining
  -- becomes a no-show at the intro's start + settle, as roomlogic.ts
  -- settleDue reads it: expired with no result or no_join, or ended no_join
  -- (End room, Zoom's end before anyone came, or "That was not the lead"
  -- after the room closed); never admit_blocked, moved to the phone or
  -- cancelled, and only while the intro is still new or confirmed, and only
  -- on evidence that nobody came (below). Each one gets one settle event
  -- (sweep.settle:{room id}); the tick posts the rooms
  -- as sweep.settle until room.event settles them (settled_mark) and marks
  -- the event handled, event_replay apart; E0 gives one up after max_tries
  -- real tries (leases) or a day, and then a person marks the intro.
  begin
    -- The rooms due (closed with nobody joining, the intro still new or
    -- confirmed, start + settle passed), and whether each is evidence that
    -- nobody came (roomlogic.ts noShowDoubt, roomForThisStart): a no-show is
    -- a hard number in the B2B show rate, so only a Zoom room whose events
    -- were all read and whose meeting Zoom itself reported, or a short link
    -- never opened, is settled. The rest are left for a person: settled_mark
    -- none and a "mark this intro" alert.
    create temp table if not exists lc_settle_due (id uuid primary key, code text, contact_id text, doubt text,
                                                   ok boolean) on commit drop;
    truncate pg_temp.lc_settle_due;
    insert into pg_temp.lc_settle_due (id, code, contact_id, doubt, ok)
    select x.id, x.code, x.contact_id, d.doubt, d.doubt is null and m.same_call and not tc.test
      from public.cockpit_sales_rooms as x
      join public.cockpit_sales_appointments as ap on ap.appointment_id = x.appointment_id
     cross join lateral (
       select case when x.appointment_start_at is not null then x.appointment_start_at = ap.start_at
                   else x.requested_at between ap.start_at - interval '1 hour' and ap.start_at + w_settle end as same_call) as m
     cross join lateral (
       select coalesce(x.contact_id = any (array(select jsonb_array_elements_text(coalesce(cfg -> 'test_contacts', '[]'::jsonb)))), false)
                and coalesce(ap.calendar_id is distinct from (cfg ->> 'test_calendar_id'), true) as test) as tc
     cross join lateral (
       select case
                when x.first_open_at is not null or x.last_open_at is not null then 'the lead opened the link'
                when x.lead_waiting_at is not null then 'the lead knocked'
                when exists (select 1 from public.cockpit_sales_rooms as y
                              where y.id <> x.id
                                and (y.appointment_id = x.appointment_id
                                     or (y.contact_id = x.contact_id and y.requested_at >= ap.start_at - interval '1 hour'))
                                and (y.state in ('requested', 'creating', 'open', 'host_in', 'lead_in')
                                     or (y.lead_in_at is not null and (y.count_undo_at is null or y.lead_in_at > y.count_undo_at))))
                  then 'the lead joined another room for this call'
                when exists (select 1 from public.cockpit_sales_room_events as e
                              where e.room_id = x.id
                                and ((e.kind = 'zoom.meeting.participant_joined'
                                      and (e.at > x.ended_at or (e.detail -> 'refused' ->> 'code') = 'final'))
                                     or e.kind = 'worker.held'))
                  then 'someone joined the meeting after the room closed'
                when x.provider = 'meet' and (cfg -> 'short_link') is distinct from 'true'::jsonb
                  then 'Meet sends no join signal and nobody pressed The lead is in'
                when x.provider = 'zoom' and exists (select 1 from public.cockpit_sales_room_events as e
                                                      where (e.room_id = x.id
                                                             or (e.room_id is null and x.provider_meeting_id is not null
                                                                 and e.detail #>> '{payload,object,id}' = x.provider_meeting_id
                                                                 and e.at >= x.requested_at - interval '1 minute'))
                                                        and e.source = 'zoom'
                                                        and (e.handled_at is null or e.detail ? 'gave_up'))
                  then 'a Zoom event for this room was not read'
                -- Zoom's silence is evidence only when Zoom itself reported
                -- the meeting (its start, or the host's join): otherwise the
                -- subscription may be off or the door down, and nobody can
                -- tell whether the lead came.
                when x.provider = 'zoom' and not exists (
                       select 1 from public.cockpit_sales_room_events as e
                        where e.room_id = x.id and e.source = 'zoom' and e.handled_at is not null
                          and not (e.detail ? 'gave_up')
                          and (e.kind = 'zoom.meeting.started'
                               or (e.kind in ('zoom.meeting.participant_joined', 'zoom.meeting.participant_jbh_joined')
                                   and e.detail ->> 'role' = 'host')))
                  then 'Zoom reported nothing for this room'
              end as doubt) as d
     where x.purpose <> 'booked' and x.call_kind = 'intro' and x.appointment_id is not null
       and ((x.state = 'expired' and (x.result is null or x.result = 'no_join'))
            or (x.state = 'ended' and x.result = 'no_join'))
       and (x.lead_in_at is null or (x.count_undo_at is not null and x.lead_in_at <= x.count_undo_at))
       and x.settled_mark is null
       and ap.status in ('new', 'confirmed')
       and ap.start_at + w_settle < t;

    insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, text, detail)
    select q.id, 'sweep.settle', 'settle', 'sweep.settle:' || q.id::text, t,
           'Due to be settled: the room for a booked intro closed with nobody joining.',
           jsonb_build_object('appointment_id', x.appointment_id)
      from pg_temp.lc_settle_due as q
      join public.cockpit_sales_rooms as x on x.id = q.id
     where q.ok
    on conflict (dedupe_key) do nothing;

    with skipped as (
      update public.cockpit_sales_rooms as x
         set settled_mark = 'none'
        from pg_temp.lc_settle_due as q
       where x.id = q.id and not q.ok and x.settled_mark is null
      returning x.id, x.code, q.doubt
    ),
    ev as (
      insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, handled_at, text, detail)
      select k.id, 'sweep.settle_skipped', 'sweep', 'sweep:' || k.id::text || ':settle_skipped', t,
             left('Not settled: ' || coalesce(k.doubt, 'this room was not for the intro as it is booked now, or the lead is a test contact') || '. A person marks the intro.', 500),
             jsonb_build_object('why', k.doubt)
        from skipped as k
      on conflict (dedupe_key) do nothing
      returning 1
    ),
    au as (
      insert into public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
      select 'room.settle', 'cockpit_sales_rooms', k.id::text, null, 'sales', 'pg_cron',
             jsonb_build_object('settled_mark', null), jsonb_build_object('settled_mark', 'none'),
             jsonb_build_object('rule', 'settle_skipped', 'why', k.doubt, 'code', k.code)
        from skipped as k
      returning 1
    )
    select count(*) into n from skipped;
    -- A person marks the intro when the reason is a sign the lead may have come.
    for rec in select q.id, q.code, q.doubt from pg_temp.lc_settle_due as q where not q.ok and q.doubt is not null loop
      perform public.cockpit_sales_alert_set('room:' || rec.id::text || ':mark_intro', true, 'room_mark_intro',
        'Room ' || rec.code,
        format('Room %s: the booked intro was not marked a no-show because %s. Mark it shown or a no-show.', rec.code, rec.doubt),
        jsonb_build_object('room_id', rec.id, 'code', rec.code));
    end loop;
    summary := summary || jsonb_build_object('settle_skipped', n);

    select count(*) into settle_due
      from public.cockpit_sales_room_events as e
     where e.source = 'settle' and e.handled_at is null;

    with due as (
      select e.id, e.room_id from public.cockpit_sales_room_events as e
       where e.source = 'settle' and e.handled_at is null and e.tries < max_tries
         and (e.last_try_at is null or e.last_try_at + w_replay < t)
         and (e.lease_until is null or e.lease_until < t)
       order by e.at
       limit 50
       for update skip locked
    ),
    bumped as (
      -- Picked: spaced event_replay apart. The try itself is counted when
      -- room.event leases it, so an outage (sales-api deployed, the cron door
      -- down, HighLevel unreadable) never uses a settle's tries up.
      update public.cockpit_sales_room_events as e
         set last_try_at = t
        from due as d
       where e.id = d.id
      returning e.room_id
    )
    select coalesce(jsonb_agg(b.room_id::text order by b.room_id), '[]'::jsonb) into settle from bumped as b;
    summary := summary || jsonb_build_object('settle_due', settle_due);
  exception when others then
    errs := errs || jsonb_build_object('rule', 'settle', 'error', sqlerrm);
  end;

  -- T. The rooms room.event re-checks (contract-v2 S1 and S4): every room
  -- with a lead that is not final, oldest first, then every final room whose
  -- lead_in_at or count_undo_at falls in the last hour, newest first; 100 a
  -- run at most (the tick posts them as kind tick, 50 a post). room.event
  -- moves no timer for them (the sweep owns those): it re-asks a link claimed
  -- and never sent, a count never claimed or stuck, an undo that never
  -- landed, and alerts when a room with a lead runs into a booked call.
  begin
    select coalesce(jsonb_agg(q.id::text order by q.ord, q.k), '[]'::jsonb) into ticks from (
      select y.id, y.ord, y.k from (
        select x.id, 0 as ord, extract(epoch from x.requested_at) as k
          from public.cockpit_sales_rooms as x
         where x.state in ('requested', 'creating', 'open', 'host_in', 'lead_in') and x.contact_id is not null
        union all
        select x.id, 1, -extract(epoch from greatest(x.lead_in_at, x.count_undo_at))
          from public.cockpit_sales_rooms as x
         where x.state = any (finals) and x.contact_id is not null
           and (x.lead_in_at > t - interval '1 hour' or x.count_undo_at > t - interval '1 hour')
      ) as y
      order by y.ord, y.k
      limit 100) as q;
    summary := summary || jsonb_build_object('tick_count', jsonb_array_length(ticks));
  exception when others then
    errs := errs || jsonb_build_object('rule', 'tick', 'error', sqlerrm);
  end;

  summary := summary || jsonb_build_object(
    'at', t, 'rooms_moved', moved_rooms, 'handovers_moved', moved_live,
    'replay', replay, 'settle', settle, 'tick', ticks, 'errors', errs);

  insert into public.cockpit_sales_worker_status (worker, job, ok, detail, at)
  values ('sales-api', 'sweep', jsonb_array_length(errs) = 0,
          left(case when jsonb_array_length(errs) = 0
                 then format('%s rooms closed, %s handovers moved, %s events sent back to room.event, %s rooms to settle, %s rooms to re-check.',
                             moved_rooms, moved_live, jsonb_array_length(replay), jsonb_array_length(settle),
                             jsonb_array_length(ticks))
                 else format('%s rules failed: %s', jsonb_array_length(errs), errs::text) end, 500),
          t)
  on conflict (worker, job) do update
     set ok = excluded.ok, detail = excluded.detail, at = excluded.at;

  return summary;
end;
$$;
revoke all on function public.cockpit_sales_rooms_sweep() from public, anon, authenticated;
grant execute on function public.cockpit_sales_rooms_sweep() to service_role;

-- 6b. The tick: the door's answers are read ---------------------------------

-- Each post the tick makes to sales-live/cron, by pg_net request id, until
-- its answer is read on a later run (a day at most). Service role only.
create table if not exists public.cockpit_sales_room_posts (
  request_id  bigint primary key,
  kind        text not null check (kind in ('sweep.replay', 'sweep.settle', 'tick')),
  posted_at   timestamptz not null default now(),
  checked_at  timestamptz,
  status_code integer,
  error       text check (error is null or length(error) <= 300)
);
comment on table public.cockpit_sales_room_posts is
  'The room sweep''s posts to sales-live/cron (cockpit_sales_rooms_tick), by pg_net request id. The next tick reads each answer from net._http_response; a refusal (401, 404, 5xx) or no answer within 3 minutes turns the sales-api/sweep status row red and raises the sweep:door_refused alert. Kept a day. Service role only.';
create index if not exists cockpit_sales_room_posts_open
  on public.cockpit_sales_room_posts (posted_at) where checked_at is null;
alter table public.cockpit_sales_room_posts enable row level security;
revoke all on public.cockpit_sales_room_posts from public, anon, authenticated;
grant all on public.cockpit_sales_room_posts to service_role;

-- The tick as 20261003a made it, keeping each post's request id and reading
-- the earlier posts' answers first.
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
  n_replay integer;
  n_settle integer;
  n_tick integer;
  chunk jsonb;
  i integer;
  req bigint;
  bad integer := 0;
  answered integer := 0;
  last_code text;
  door_note text;
begin
  r := public.cockpit_sales_rooms_sweep();
  if r ? 'skipped' then
    return r;
  end if;

  -- The door's answers to the earlier runs' posts (pg_net keeps them in
  -- net._http_response by request id). A post the door refused (a
  -- CRON_SECRET that no longer matches the vault, sales-live deployed with
  -- verify_jwt on, or not deployed) or never answered turns the sweep's row
  -- red and raises one alert, so a silent door is never read as a green sweep.
  begin
    with ans as (
      update public.cockpit_sales_room_posts as p
         set checked_at = now(),
             status_code = h.status_code,
             error = left(coalesce(h.error_msg, case when h.timed_out then 'timed out' end), 300)
        from net._http_response as h
       where h.id = p.request_id and p.checked_at is null
      returning p.status_code, p.error
    ),
    lost as (
      update public.cockpit_sales_room_posts as p
         set checked_at = now(), error = 'no answer'
       where p.checked_at is null and p.posted_at < now() - interval '3 minutes'
      returning p.status_code, p.error
    ),
    seen as (select * from ans union all select * from lost)
    select count(*) filter (where s.status_code is null or s.status_code not between 200 and 299),
           count(*),
           string_agg(distinct coalesce(s.status_code::text, s.error), ', ')
                filter (where s.status_code is null or s.status_code not between 200 and 299)
      into bad, answered, last_code
      from seen as s;
    delete from public.cockpit_sales_room_posts as p where p.posted_at < now() - interval '1 day';
    if bad > 0 then
      door_note := left(format('%s of the sweep''s calls to sales-live/cron were not taken (%s), so replays, settles and re-checks are not reaching sales-api. Check that sales-live is deployed with verify_jwt off and that its CRON_SECRET equals the vault''s cockpit_sync_secret.',
                               bad, coalesce(last_code, 'no answer')), 500);
      update public.cockpit_sales_worker_status as s
         set ok = false, detail = door_note
       where s.worker = 'sales-api' and s.job = 'sweep';
      perform public.cockpit_sales_alert_set('sweep:door_refused', true, 'sweep_door', 'sales-api/sweep', door_note,
        jsonb_build_object('refused', bad, 'answers', last_code));
    elsif answered > 0 then
      perform public.cockpit_sales_alert_set('sweep:door_refused', false, 'sweep_door', 'sales-api/sweep', '', '{}'::jsonb);
    end if;
  exception when others then
    -- Reading the answers never stops the posts below.
    raise warning 'cockpit_sales_rooms_tick: the door''s answers were not read: %', sqlerrm;
  end;
  n_replay := jsonb_array_length(coalesce(r -> 'replay', '[]'::jsonb));
  n_settle := jsonb_array_length(coalesce(r -> 'settle', '[]'::jsonb));
  n_tick := least(jsonb_array_length(coalesce(r -> 'tick', '[]'::jsonb)), 100);
  if n_replay + n_settle + n_tick = 0 then
    return r || jsonb_build_object('posted', 0, 'door_refused', bad);
  end if;
  select ds.decrypted_secret into secret
    from vault.decrypted_secrets as ds
   where ds.name = 'cockpit_sync_secret'
   limit 1;
  if secret is null or btrim(secret) = '' then
    update public.cockpit_sales_worker_status as s
       set ok = false,
           detail = left(format('%s %s and %s %s wait for room.event, but the vault has no cockpit_sync_secret, so nothing was sent. Add it to the vault.',
                                n_replay + n_settle, case when n_replay + n_settle = 1 then 'event' else 'events' end,
                                n_tick, case when n_tick = 1 then 'room check' else 'room checks' end), 500)
     where s.worker = 'sales-api' and s.job = 'sweep';
    return r || jsonb_build_object('posted', 0, 'post_note', 'The vault has no cockpit_sync_secret.', 'door_refused', bad);
  end if;
  if n_replay > 0 then
    req := net.http_post(
      url := v_url,
      body := jsonb_build_object('action', 'room.event', 'kind', 'sweep.replay',
                                 'payload', jsonb_build_object('event_ids', r -> 'replay')),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
      timeout_milliseconds := 10000);
    insert into public.cockpit_sales_room_posts (request_id, kind) values (req, 'sweep.replay') on conflict do nothing;
    posted := posted + 1;
  end if;
  if n_settle > 0 then
    req := net.http_post(
      url := v_url,
      body := jsonb_build_object('action', 'room.event', 'kind', 'sweep.settle',
                                 'payload', jsonb_build_object('room_ids', r -> 'settle')),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
      timeout_milliseconds := 10000);
    insert into public.cockpit_sales_room_posts (request_id, kind) values (req, 'sweep.settle') on conflict do nothing;
    posted := posted + 1;
  end if;
  for i in 0 .. (n_tick - 1) / 50 loop
    exit when n_tick = 0;
    select jsonb_agg(e.v order by e.o) into chunk
      from jsonb_array_elements_text(r -> 'tick') with ordinality as e(v, o)
     where e.o > i * 50 and e.o <= least((i + 1) * 50, n_tick);
    req := net.http_post(
      url := v_url,
      body := jsonb_build_object('action', 'room.event', 'kind', 'tick',
                                 'payload', jsonb_build_object('room_ids', chunk)),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
      timeout_milliseconds := 10000);
    insert into public.cockpit_sales_room_posts (request_id, kind) values (req, 'tick') on conflict do nothing;
    posted := posted + 1;
  end loop;
  return r || jsonb_build_object('posted', posted, 'door_refused', bad);
end;
$$;
revoke all on function public.cockpit_sales_rooms_tick() from public, anon, authenticated;
grant execute on function public.cockpit_sales_rooms_tick() to service_role;

-- 7. The watchdog --------------------------------------------------------------

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
  gave_up_words text;
  prev record;
  note text;
begin
  if not pg_try_advisory_xact_lock(hashtext('cockpit_sales_watchdog')) then
    return jsonb_build_object('skipped', 'Another watchdog run is going.');
  end if;

  -- 1. The status rows (glossary 1.7, plus the desk's waves and model rows,
  -- the room host check and the five sales-live routes).
  -- switch_on null: watched once the row exists; true or false: watched only
  -- while the feature is switched on, and then a missing row is an alert too
  -- (missing is never zero). stale_min null: a failing-only row (the door
  -- writes its routes' rows only when traffic comes), so neither a missing
  -- nor a quiet row is an alert, only a row that says it is failing.
  for rec in
    select w.worker, w.job, w.stale_min, w.label, w.effect, w.switch_on, s.ok, s.detail, s.at
      from (values
        ('sales-desk', 'rooms',     10, 'The room worker',       'New video rooms cannot be made.',
           coalesce((rooms -> 'enabled') = 'true'::jsonb, false)),
        ('sales-desk', 'room-hosts', 20, 'The room host check',
           'Zoom seats and Google sign-ins are not being checked, so a room may fail without warning.',
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
        ('sales-api',  'sweep',      5, 'The room sweep',        'Rooms past their time are not being closed.', null),
        ('sales-live', 'zoom',  null::integer, 'The Zoom webhook',
           'Zoom joins and leaves may not reach the rooms, so reps press I''m in and The lead is in themselves.',
           coalesce((rooms -> 'enabled') = 'true'::jsonb, false)),
        ('sales-live', 'slack', null::integer, 'The Slack buttons',
           'Presses on live offers in Slack may not work. Take offers from the cockpit.',
           coalesce((live -> 'enabled') = 'true'::jsonb, false) and coalesce((live -> 'slack') = 'true'::jsonb, false)),
        ('sales-live', 'open',  null::integer, 'The short link page',
           'Leads may not be able to open their room links. Send them the room''s full link.',
           coalesce((rooms -> 'enabled') = 'true'::jsonb, false)),
        ('sales-live', 'go',    null::integer, 'The short link',
           'Leads may not reach their room from the short link. Send them the room''s full link.',
           coalesce((rooms -> 'enabled') = 'true'::jsonb, false)),
        ('sales-live', 'cron',  null::integer, 'The sweep''s call to sales-api',
           'Replays, settles and re-checks from the room sweep may not reach sales-api.',
           coalesce((rooms -> 'enabled') = 'true'::jsonb, false))
      ) as w(worker, job, stale_min, label, effect, switch_on)
      left join public.cockpit_sales_worker_status as s on s.worker = w.worker and s.job = w.job
  loop
    subj := rec.worker || '/' || rec.job;
    watched := coalesce(rec.switch_on, rec.at is not null);
    is_missing := watched and rec.at is null and rec.stale_min is not null;
    is_stale := watched and rec.at is not null and rec.stale_min is not null
                and rec.at < t - make_interval(mins => rec.stale_min);
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
    format('%s Zoom, Slack, worker, claim or settle events have waited more than 10 minutes. Rooms may show the wrong state. Check the room sweep and sales-live.', stuck),
    jsonb_build_object('count', stuck));

  -- 2b. Events given up today (Kuwait day): one alert a day, its count kept
  -- up to date. When the count rises after the alert was posted, it is
  -- posted again. An earlier day's alert is resolved only once it was posted
  -- (or three days on): one raised on a Friday, or after 21:00, is posted in
  -- the next working hours, never lost at midnight.
  select count(*) into gave_up
    from public.cockpit_sales_room_events as e
   where e.detail ? 'gave_up'
     and e.handled_at >= ((t at time zone 'Asia/Kuwait')::date)::timestamp at time zone 'Asia/Kuwait';
  select a.id, coalesce((a.detail ->> 'count')::integer, 0) as n, a.posted_at
    into prev
    from public.cockpit_sales_alerts as a
   where a.dedupe_key = day_key and a.resolved_at is null;
  update public.cockpit_sales_alerts as a
     set resolved_at = t,
         dedupe_key = a.dedupe_key || ':resolved:' || a.id::text
   where a.dedupe_key like 'room_events_gave_up:%' and a.dedupe_key <> day_key and a.resolved_at is null
     and (a.posted_at is not null or a.raised_at < t - interval '3 days');
  gave_up_words := format('%s room events were given up today (10 tries by room.event, or a day old). Each one is a Zoom, Slack, worker, claim or settle signal no room acted on. Check sales-live and the room events list.', gave_up);
  raised := raised + public.cockpit_sales_alert_set(day_key, gave_up > 0, 'room_events_gave_up', 'room_events',
    gave_up_words, jsonb_build_object('count', gave_up));
  if prev.id is not null and gave_up > prev.n then
    update public.cockpit_sales_alerts as a
       set message = public.cockpit_sales_alert_words(gave_up_words, 1000),
           posted_at = null,
           post_tries = 0,
           post_status = null,
           post_error = null,
           post_request_id = null
     where a.id = prev.id and a.resolved_at is null;
  end if;

  -- 2c. A Zoom join, a worker event, a settle or a claim given up (never
  -- read by room.event): one alert per event, at once, because the room it
  -- was for may be closed as if nobody came, its booked intro left
  -- "confirmed" (a show for B2B), or a taken lead left with no room. A
  -- settle's is the room's "mark this intro" alert (the sweep raises it when
  -- it gives the settle up; this raises it again if that did not land).
  -- Resolved by a person, and never raised again once resolved.
  for rec in
    select e.id, e.kind, e.source, e.room_id, r.code,
           case when e.source = 'settle' and e.room_id is not null then 'room:' || e.room_id::text || ':mark_intro'
                else 'room_event_lost:' || e.id::text end as key
      from public.cockpit_sales_room_events as e
      left join public.cockpit_sales_rooms as r on r.id = e.room_id
     where e.detail ? 'gave_up' and e.handled_at > t - interval '1 day'
       and (e.kind like 'zoom.meeting.participant_%' or e.kind like 'worker.%' or e.source in ('settle', 'claim'))
  loop
    continue when exists (select 1 from public.cockpit_sales_alerts as a where a.dedupe_key like rec.key || ':resolved:%');
    if rec.source = 'settle' and rec.room_id is not null then
      raised := raised + public.cockpit_sales_alert_set(rec.key, true, 'room_mark_intro', 'Room ' || coalesce(rec.code, 'event'),
        format('Room %s: the no-show could not be written (sales-api or HighLevel did not answer), so the booked intro is still open. Mark it shown or a no-show.',
               coalesce(rec.code, '(none)')),
        jsonb_build_object('room_id', rec.room_id, 'code', rec.code));
    else
      raised := raised + public.cockpit_sales_alert_set(rec.key, true, 'room_event_lost',
        'Room ' || coalesce(rec.code, 'event'),
        format('Room %s: %s was never read, so the room may show the wrong state. Check the call and mark it by hand.',
               coalesce(rec.code, '(none)'),
               case when rec.kind like 'zoom.meeting.participant_joined%' then 'Zoom''s word that someone joined'
                    when rec.kind like 'zoom.%' then 'a Zoom event'
                    when rec.source = 'claim' then 'a closer''s take of a live lead'
                    else 'the room worker''s word' end),
        jsonb_build_object('event_id', rec.id, 'room_id', rec.room_id, 'kind', rec.kind));
    end if;
  end loop;

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

-- 7b. Room events: a seat reads only events that belong to a room ---------

-- An event with no room is a system event, or a Zoom event the door kept
-- while its room lookup failed, which may be from a meeting that is no room
-- (the webinar, a client call, an interview): its people stay out of seats'
-- reach. sales-api reads with the service role.
drop policy if exists cockpit_sales_room_events_seat_read on public.cockpit_sales_room_events;
create policy cockpit_sales_room_events_seat_read on public.cockpit_sales_room_events
  for select to authenticated using (public.cockpit_sales_seat() and room_id is not null);

-- The unplaced Zoom events by meeting id (the sweep's P0, sales-api's settle).
create index if not exists cockpit_sales_room_events_unplaced
  on public.cockpit_sales_room_events ((detail #>> '{payload,object,id}'))
  where room_id is null and source = 'zoom';

-- 8. Grants (the view was made again) ---------------------------------------------

revoke all on public.cockpit_sales_presence from public, anon, authenticated;
grant select on public.cockpit_sales_presence to service_role;

notify pgrst, 'reload schema';

commit;
