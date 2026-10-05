-- Live calls, hardening after the second stress series, fix round 1
-- (4 October 2026).
--
-- 20261003a, b, c and d are applied in production (dark: every switch off,
-- rooms.test_only true, the tables empty). This migration changes what the
-- second series found, in place of editing those files, and is idempotent
-- (every statement can run twice):
--   slot      cockpit_sales_message_slot answers a free WhatsApp message
--             whose words match one that went to the same lead within the
--             duplicate window (dup_window_s, 60 s) as that send
--             (same_words): two tabs or two seats never send the lead the
--             same words twice, and the duplicate detector never pauses
--             WhatsApp for the cockpit's own two sends.
--   claim     cockpit_sales_live_claim takes p_at, the moment the Take
--             reached sales-api (at most 30 s back), so a press in time is
--             never lost to HighLevel's contact read; a press that came
--             after the offer's end puts the closer in declined_by, so the
--             sweep's L1 never makes them Away for it.
--   presence  a Zoom meeting the last host check saw live holds the host on
--             a call for the check's 15 minutes from checked_at (the desk
--             now stores the meeting's own end in zoom_live_until, which
--             sales-api's zoom_busy reads); a closer's default room is never
--             a Basic Zoom (it ends at 40 minutes, a demo is 60).
--   sweep     S1 leaves out an intro the cockpit has marked (a rep's mark or
--             the count's), and holds a room whose sibling for the same call
--             is still open with no join (it is never "the lead joined
--             another room").
--   standby   cockpit_sales_availability keeps the last press's sentence
--             (standby_error, standby_error_at) for live.status.
--
-- Checks: supabase/migrations/tests/run_checks.py applies a, b, c, d and
-- this file in one rolled-back run; the stress runs apply d and this file
-- inside their own rolled-back runs.

begin;

-- Never queue a rep's send behind this migration for long: a lock not free
-- in 5 s fails the apply, nothing is changed, and it is simply run again.
set local lock_timeout = '5s';

-- 1. The message slot: the same words a moment ago ---------------------------

-- Words as the duplicate detector compares them (sendrules.ts normText):
-- NFKC, no zero-width or direction marks, one space, no case.
create or replace function public.cockpit_sales_norm_words(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(btrim(regexp_replace(
           regexp_replace(normalize(coalesce(p_text, ''), NFKC), '[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]', '', 'g'),
           '\s+', ' ', 'g')))
$$;
revoke all on function public.cockpit_sales_norm_words(text) from public, anon, authenticated;
grant execute on function public.cockpit_sales_norm_words(text) to service_role;

-- When HighLevel was asked to send a message (stress2 round 5,
-- slot-lost-answer-orphan-row-read-as-sent): index.ts stamps the row right
-- before its HighLevel POST or enrolment. A "sending" row with no stamp past
-- 30 seconds is a slot whose answer was lost before anything went: it holds
-- no request id, no same words and no template queue.
alter table public.cockpit_sales_messages
  add column if not exists ghl_asked_at timestamptz;
comment on column public.cockpit_sales_messages.ghl_asked_at is
  'When HighLevel was asked to send it. A sending row without it past 30 s never went.';

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
  words text;
  dup_s integer := greatest(10, least(600, coalesce((p_limits ->> 'dup_window_s')::integer, 60)));
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
    -- An earlier try's row HighLevel was never asked about (its slot's answer
    -- lost, stress2 round 5): it never went, so this try takes the slot.
    if twin.state = 'sending' and twin.ghl_asked_at is null and twin.created_at < now() - interval '30 seconds' then
      delete from public.cockpit_sales_messages as m
       where m.id = twin.id and m.state = 'sending' and m.ghl_asked_at is null;
    else
      return jsonb_build_object('code', 'repeat', 'row', to_jsonb(twin));
    end if;
  end if;
  -- The same WhatsApp words to the same lead a moment ago (stress2, round
  -- 1): one rep's Send in two tabs, or two seats answering with the same
  -- snippet, each with its own request id. Under the lead's lock, a second
  -- free message whose words match one that went (or may have) within the
  -- duplicate window is answered as that send, never a row of its own: the
  -- lead gets it once, and the duplicate detector never reads the cockpit's
  -- own two sends as the WA Connector's copy.
  if not is_template and coalesce(p_row ->> 'channel', '') = 'whatsapp' then
    words := public.cockpit_sales_norm_words(p_row ->> 'body');
    if words <> '' then
      select * into twin from public.cockpit_sales_messages as m
       where m.contact_id = contact and m.channel = 'whatsapp' and m.via = 'conversation' and m.state <> 'failed'
         and not (m.state = 'sending' and m.ghl_asked_at is null and m.created_at < now() - interval '30 seconds')
         and m.created_at >= now() - make_interval(secs => dup_s)
         and public.cockpit_sales_norm_words(m.body) = words
       order by m.created_at desc
       limit 1;
      if found then
        return jsonb_build_object('code', 'same_words', 'row', to_jsonb(twin));
      end if;
    end if;
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
                  and not (m.state = 'sending' and m.ghl_asked_at is null and m.created_at < now() - interval '30 seconds')
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

-- 2. The handover take, judged at the press -----------------------------------

-- The three-argument claim is replaced by the four-argument one (named
-- calls with three arguments still resolve to it, p_at null meaning now).
drop function if exists public.cockpit_sales_live_claim(uuid, text, integer);

create or replace function public.cockpit_sales_live_claim(p_live_id uuid, p_email text, p_version integer default null,
                                                          p_at timestamptz default null)
returns setof public.cockpit_sales_live
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  me constant text := lower(btrim(coalesce(p_email, '')));
  -- When the press reached sales-api (stress2, round 1): the offer is judged
  -- at that moment, never after HighLevel's contact read; at most 30 s back,
  -- and never ahead of now.
  at_ constant timestamptz := greatest(least(coalesce(p_at, now()), now()), now() - interval '30 seconds');
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
  prov text;
  rid uuid;
  dg bytea;
  cname text;
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
     and x.offer_until > at_
     and me = any (x.offered_to)
     and (p_version is null or x.version = p_version)
   for update;
  if not found then
    -- A Take that came after the offer's end, while the row still says
    -- offered (the sweep's L1 runs once a minute), is the closer's answer:
    -- their name goes in declined_by, so L1 never makes them Away for a
    -- missed offer. sales-api tells them the offer ended.
    update public.cockpit_sales_live as x
       set declined_by = x.declined_by || me
     where x.id = p_live_id
       and x.state = 'offered'
       and x.offer_until <= at_
       and me = any (x.offered_to)
       and not (me = any (x.declined_by));
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
     and x.offer_until > at_
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
    if not found then
      -- The sweep's standby refresh (R5 ends the old room and makes a fresh
      -- one in one transaction) ran while this read waited on the old room's
      -- lock: the read found it ended and could not see the fresh one. A
      -- second read, with a snapshot of its own, sees it (fix round 3).
      select * into r
        from public.cockpit_sales_rooms as x
       where x.host_email = me and x.purpose = 'standby' and x.contact_id is null
         and x.state in ('requested', 'creating', 'open', 'host_in')
       order by x.requested_at desc
       limit 1
       for update;
    end if;

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

    -- No room adopted: the taker's room for this lead is reserved now (see
    -- the note above the function), on the provider the host can use (the
    -- presence view's default_provider). With rooms switched off the worker
    -- never makes it: R1 fails it and L2 ends the handover, as before.
    if via = 'none' and room is null then
      select pr.default_provider into prov from public.cockpit_sales_presence as pr where pr.email = me;
      prov := coalesce(prov, case when cfg #>> '{default_provider,closer}' in ('meet', 'zoom')
                                  then cfg #>> '{default_provider,closer}' else 'zoom' end);
      -- sales-api's request id for this claim (rooms.ts finishClaim): the live
      -- id, or for a re-offer liveio.ts uuidFrom('mahara-live/{id}/{reoffers}').
      if l.reoffers = 0 then
        rid := l.id;
      else
        dg := substring(sha256(convert_to('mahara-live/' || l.id::text || '/' || l.reoffers::text, 'UTF8')) from 1 for 16);
        dg := set_byte(dg, 6, (get_byte(dg, 6) & 15) | 80);
        dg := set_byte(dg, 8, (get_byte(dg, 8) & 63) | 128);
        rid := encode(dg, 'hex')::uuid;
      end if;
      begin
        insert into public.cockpit_sales_rooms (request_id, contact_id, contact_first_name, purpose, call_kind, provider,
                                                host_email, made_by, handover_id, send_on)
        values (rid, l.contact_id, case when has_lr then lr.contact_first_name end, 'handover', l.kind, prov,
                me, me, l.id, 'host_in')
        returning id into room;
      exception when unique_violation then
        get stacked diagnostics cname = constraint_name;
        if cname = 'cockpit_sales_rooms_one_per_host' then
          -- The closer's other room got there first: the claim is undone whole.
          raise exception 'take_host_busy: You already have a live call or room open. End it, then take the next lead.'
            using errcode = 'P0001', hint = 'End the room you host, then take the lead.';
        end if;
        -- This request id's room exists already, or the lead got another
        -- room meanwhile: no reservation; sales-api's room.create decides.
        room := null;
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
revoke all on function public.cockpit_sales_live_claim(uuid, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.cockpit_sales_live_claim(uuid, text, integer, timestamptz) to service_role;

-- 3. Presence: the floor for presence, Basic Zoom never a closer's default ---

-- Zoom's daily cap on one user's meeting creates (100 a day, reset at 00:00
-- UTC): the room worker stores when it passes (stress2, round 2), so later
-- rooms skip the create and the view below reads Meet as the seat's default
-- until then.
alter table public.cockpit_sales_room_hosts
  add column if not exists zoom_capped_until timestamptz;
comment on column public.cockpit_sales_room_hosts.zoom_capped_until is
  'Zoom refused this host''s meeting creates for the day (its daily cap) until this time; the worker writes it.';

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
               -- The call's whole length (rooms.lengths_min: 30 an intro, 60
               -- a demo), never the live booking's shorter slot (booking_min).
               and now() < ap.start_at + make_interval(mins => public.cockpit_sales_setting_int(
                     coalesce(cfg.rooms -> 'lengths_min', '{}'::jsonb), coalesce(ap.call_type, ''),
                     case when ap.call_type = 'demo' then 60 else 30 end))) as appt_now,
    -- A meeting the last host check saw live holds the host on a call until
    -- the next check has looked again (its 10 minutes and 5 to spare), even
    -- past the meeting's own end: zoom_live_until is that end now (stress2,
    -- round 1), so a Zoom room is not refused for a meeting that ended.
    (coalesce(h.zoom_live_until > now(), false)
       or (h.zoom_live_until is not null and coalesce(h.checked_at > now() - interval '15 minutes', false)))
      and not mr.own_zoom as zoom_live,
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
           -- Basic Zoom ends at 40 minutes: never a closer's (a demo's) default (stress2, round 1).
           and coalesce(h.zoom_status = 'licensed' or (h.zoom_status = 'basic' and p.role is distinct from 'closer'), false)
           -- Zoom's daily create cap spent for today (stress2, round 2).
           and coalesce(h.zoom_capped_until is null or h.zoom_capped_until <= now(), true) as zoom_ok,
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

-- 4. The sweep: S1 reads the cockpit's marks and waits for an open sibling ---

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
      -- Fix round 4: a worker that never started the room is likely down, so
      -- the next step needs no worker (another room would fail the same way).
      'The room worker did not start this room within a minute. Call the lead on the phone, or send your own Zoom or Meet link.');
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
                              -- From the latest send of the link (stress2 round 5: a later
                              -- channel's email promises its own ten minutes).
                              else coalesce(greatest(x.link_sent_at, x.last_link_at), x.opened_at) + w_lead + w_grace end,
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
  -- they took meanwhile, becomes Away (one miss). Ended only 30 s after
  -- offer_until, the claim's own p_at window (stress2, round 2): a Take
  -- pressed in time whose claim lands after HighLevel's contact read still
  -- finds the row offered, and is never told the offer ended nor made Away.
  -- The strip stops offering it at offer_until; a press after the end is
  -- answered by the claim's late-take branch (declined_by).
  begin
    n := 0;
    for rec in
      select x.id, x.offered_to, x.declined_by
        from public.cockpit_sales_live as x
       where x.state = 'offered' and x.offer_until + interval '30 seconds' <= t
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
              or (r.state = any (finals)
                  and not public.cockpit_sales_room_join_stands(r.lead_in_at, r.count_undo_at, r.taken_back_join_at))
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
       where x.state in ('room_ready', 'lead_joined') and r.state = any (finals)
         -- No join that stands: none, or one "That was not the lead" took back
         -- (the guard keeps its time in lead_in_at; a join stands only after
         -- the taken-back join's own time, cockpit_sales_room_join_stands).
         and not public.cockpit_sales_room_join_stands(r.lead_in_at, r.count_undo_at, r.taken_back_join_at)
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

  -- R5. A Zoom standby room ends after standby_max (Zoom ends a meeting 40
  -- minutes after only one person is left); while its host is still
  -- Available, rooms are on, the provider is on and no booked call is near,
  -- a fresh standby room is asked for in the same run (glossary 1.9). Meet
  -- has no such rule, so a Meet standby room is never refreshed (stress2
  -- round 3): it ends with Available (R8) or before a booked call (R6). R6. An
  -- empty standby room ends booked_guard before the host's next booked call.
  -- R8. An empty standby room ends when its host is no longer available.
  -- None of these ever touches a room with a lead in it.
  begin
    n := 0; made := 0;
    for rec in
      select x.id, x.host_email, x.provider, x.call_kind
        from public.cockpit_sales_rooms as x
       where x.purpose = 'standby' and x.provider = 'zoom' and x.contact_id is null and x.state in ('open', 'host_in')
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
         and r.state = any (finals) and public.cockpit_sales_room_join_stands(r.lead_in_at, r.count_undo_at, r.taken_back_join_at)
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
  -- A settle that only waits is never given up as a failure (stress2, round
  -- 2): while another room for the same call is still open with no join
  -- that stands, it is left for that room (S1 holds the same rooms). One
  -- whose intro moved since the room was made (the copy's start is not the
  -- start the room stored, or is still ahead) is finished as "not for the
  -- intro as it is booked now", with no alert: nothing failed.
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
         and not (e.source = 'settle' and e.at >= t - interval '1 day' and exists (
               select 1
                 from public.cockpit_sales_rooms as x
                 join public.cockpit_sales_appointments as ap on ap.appointment_id = x.appointment_id
                 join public.cockpit_sales_rooms as y
                   on y.id <> x.id
                  and (y.appointment_id = x.appointment_id
                       or (y.contact_id = x.contact_id and y.requested_at >= ap.start_at - interval '1 hour'))
                where x.id = e.room_id
                  and y.state in ('requested', 'creating', 'open', 'host_in', 'lead_in')
                  and not public.cockpit_sales_room_join_stands(y.lead_in_at, y.count_undo_at, y.taken_back_join_at)))
      returning e.id, e.room_id, e.source, e.kind
    )
    insert into pg_temp.lc_gave_up (id, room_id, source, kind)
    select g.id, g.room_id, g.source, g.kind from gone as g;
    select count(*) into n from pg_temp.lc_gave_up;
    summary := summary || jsonb_build_object('gave_up', n);

    -- The intro moved since the room was made, or is still ahead: not this
    -- room's intro, so not a failure and nobody is asked to mark it.
    with moved as (
      update public.cockpit_sales_rooms as x
         set settled_mark = 'none'
        from pg_temp.lc_gave_up as g, public.cockpit_sales_appointments as ap
       where g.source = 'settle' and x.id = g.room_id and x.settled_mark is null
         and ap.appointment_id = x.appointment_id
         and ((x.appointment_start_at is not null and abs(extract(epoch from (ap.start_at - x.appointment_start_at))) >= 60)
              or ap.start_at + w_settle > t)
      returning x.id, x.code
    ),
    mev as (
      insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, handled_at, text, detail)
      select m.id, 'sweep.settle_skipped', 'sweep', 'sweep:' || m.id::text || ':settle_skipped', t,
             'Not settled: this room was not for the intro as it is booked now.',
             jsonb_build_object('why', 'not_this_intro')
        from moved as m
      on conflict (dedupe_key) do nothing
      returning 1
    ),
    mau as (
      insert into public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
      select 'room.settle', 'cockpit_sales_rooms', m.id::text, null, 'sales', 'pg_cron',
             jsonb_build_object('settled_mark', null), jsonb_build_object('settled_mark', 'none'),
             jsonb_build_object('rule', 'settle_not_this_intro', 'code', m.code)
        from moved as m
      returning 1
    )
    select count(*) into n from moved;
    summary := summary || jsonb_build_object('settle_not_this_intro', n);

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
         and not exists (select 1 from public.cockpit_sales_room_events as v
                          where v.dedupe_key = 'sweep:' || g.room_id::text || ':settle_skipped'
                            and v.detail ->> 'why' = 'not_this_intro')
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
                                                   ok boolean, same_call boolean) on commit drop;
    truncate pg_temp.lc_settle_due;
    insert into pg_temp.lc_settle_due (id, code, contact_id, doubt, ok, same_call)
    select x.id, x.code, x.contact_id, d.doubt, d.doubt is null and m.same_call and not tc.test, m.same_call
      from public.cockpit_sales_rooms as x
      join public.cockpit_sales_appointments as ap on ap.appointment_id = x.appointment_id
     -- The room was asked for inside the intro's own window (five minutes
     -- before its start, the dialer's intro item, to start + settle; stress2,
     -- round 2), and the start it stored, if any, is still the intro's
     -- (roomlogic.ts roomForThisStart, INTRO_EARLY_MS). A confirmation call's
     -- room the evening before, or in the hour before, says nothing about it.
     cross join lateral (
       select x.requested_at between ap.start_at - interval '5 minutes' and ap.start_at + w_settle
              and (x.appointment_start_at is null or x.appointment_start_at = ap.start_at) as same_call) as m
     cross join lateral (
       select coalesce(x.contact_id = any (array(select jsonb_array_elements_text(coalesce(cfg -> 'test_contacts', '[]'::jsonb)))), false)
                and coalesce(ap.calendar_id is distinct from (cfg ->> 'test_calendar_id'), true) as test) as tc
     cross join lateral (
       select case
                when x.first_open_at is not null or x.last_open_at is not null then 'the lead opened the link'
                -- The door's own record of the lead's open (fix round 4): it
                -- is stored first, so it stands when the door's write of the
                -- room's open times ran out of time (a slow database).
                when exists (select 1 from public.cockpit_sales_room_events as e
                              where e.room_id = x.id and e.kind = 'door.open'
                                and coalesce(e.detail ->> 'after_end', 'false') <> 'true')
                  then 'the lead opened the link'
                -- The lead opened the link after the room closed, inside the
                -- intro's own time (stress2 round 5): like a late Zoom join,
                -- they came, so a person marks the intro, never the timer.
                when exists (select 1 from public.cockpit_sales_room_events as e
                              where e.room_id = x.id and e.kind = 'door.open'
                                and coalesce(e.detail ->> 'after_end', 'false') = 'true'
                                and e.at <= ap.start_at + w_settle)
                  then 'the lead opened the link after the room closed'
                when x.lead_waiting_at is not null then 'the lead knocked'
                -- The link never reached the lead (refused on every channel,
                -- or "it may have gone" and never confirmed): their staying
                -- away says nothing (roomlogic.ts noShowDoubt).
                when x.link_sent_at is null then 'the link never reached the lead'
                -- Its only channel a WhatsApp template nobody saw (no text and
                -- no email went): it may never have reached the lead either
                -- (fix round 4, roomlogic.ts unconfirmedOnly).
                when x.link_unconfirmed_at is not null
                     and not (coalesce(x.link_channels, '{}'::text[]) && array['whatsapp_text', 'email']::text[])
                  then 'the link was not confirmed to have reached the lead'
                -- The link's WhatsApp failed after it was sent (stress2, round
                -- 2): sales-api's late read stored link.failed_late, or every
                -- message the link went on is failed now.
                when exists (select 1 from public.cockpit_sales_room_events as e
                              where e.room_id = x.id and e.kind = 'link.failed_late')
                     or (exists (select 1 from jsonb_each_text(coalesce(x.link_message_ids, '{}'::jsonb)) as lm(k, v)
                                   join public.cockpit_sales_messages as mm on mm.id::text = lm.v)
                         and not exists (select 1 from jsonb_each_text(coalesce(x.link_message_ids, '{}'::jsonb)) as lm(k, v)
                                           join public.cockpit_sales_messages as mm on mm.id::text = lm.v
                                          where mm.state <> 'failed'))
                  then 'the link''s WhatsApp failed after it was sent'
                -- Only a join that stands in another room for this call; a
                -- sibling merely still open holds this settle (below).
                when exists (select 1 from public.cockpit_sales_rooms as y
                              where y.id <> x.id
                                and (y.appointment_id = x.appointment_id
                                     or (y.contact_id = x.contact_id and y.requested_at >= ap.start_at - interval '1 hour'))
                                and public.cockpit_sales_room_join_stands(y.lead_in_at, y.count_undo_at, y.taken_back_join_at))
                  then 'the lead joined another room for this call'
                -- The lead on the phone after the room was asked for (stress2,
                -- round 2, roomlogic.ts phoneSince): a dial they answered, a
                -- saved attempt that spoke, or Maqsam's answered call either
                -- way. The intro may be held by phone: a person marks it. An
                -- outcome that speaks counts only on an attempt with no call
                -- record (stress2 round 3): a busy or unanswered call saved as
                -- Call back reached nobody.
                when exists (select 1 from public.cockpit_sales_attempts as pa
                              where pa.contact_id = x.contact_id
                                and (pa.started_at >= x.requested_at or pa.saved_at >= x.requested_at)
                                and pa.state = 'saved'
                                and ((lower(coalesce(pa.call_state, '')) in ('answered', 'completed', 'serviced')
                                      and coalesce(pa.call_duration_s, 1) > 0)
                                     or (pa.outcome in ('callback', 'booked', 'not_interested', 'disqualified', 'handled',
                                                        'confirmed', 'rescheduled', 'cancelled', 'showed')
                                         and coalesce(btrim(pa.call_state), '') = '')))
                     or exists (select 1 from public.cockpit_sales_dials as dl
                                 where (dl.contact_id = x.contact_id
                                        or (dl.lead_phone8 is not null
                                            and dl.lead_phone8 = (select l.phone8 from public.cockpit_sales_leads as l
                                                                   where l.contact_id = x.contact_id limit 1)))
                                   and dl.occurred_at >= x.requested_at
                                   and ((dl.direction = 'outbound' and lower(coalesce(dl.state, '')) in ('answered', 'completed', 'serviced')
                                         and coalesce(dl.duration_s, 1) > 0)
                                        or (dl.direction = 'inbound' and dl.state = 'serviced')))
                  then 'the lead was reached by phone'
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
       and not public.cockpit_sales_room_join_stands(x.lead_in_at, x.count_undo_at, x.taken_back_join_at)
       and x.settled_mark is null
       and ap.status in ('new', 'confirmed')
       and ap.start_at + w_settle < t
       -- The intro is marked in the cockpit already (a rep's mark in the
       -- dialer, or the count's from another room of the lead's): the copy
       -- (cockpit_sales_appointments) lags HighLevel by minutes, so its
       -- "confirmed" says nothing, and nobody is asked to mark it again
       -- (stress2, round 1). The settle's own no-show from an earlier try
       -- is not a person's mark: sales-api finishes that one.
       and not exists (select 1 from public.cockpit_sales_dispositions as dp
                        where dp.appointment_id = x.appointment_id and dp.superseded_at is null
                          and not (dp.status = 'noshow'
                                   and dp.note = 'Nobody joined the video room, so the intro is marked a no-show.'))
       -- A call to the lead placed after the room was asked for is still
       -- going (the setter rang again): this room waits until it is saved,
       -- never a no-show posted into a call the lead may be on (stress2,
       -- round 2). Bounded: an attempt left open for two hours holds nothing.
       and not exists (select 1 from public.cockpit_sales_attempts as pa
                        where pa.contact_id = x.contact_id
                          and pa.started_at >= x.requested_at
                          and pa.started_at >= t - interval '2 hours'
                          and pa.state in ('dialing', 'placed'))
       -- A call to the lead saved unanswered in the last two minutes: the
       -- setter's video link may be seconds away, and its room holds this
       -- settle once made (stress2 round 5; roomlogic.ts phoneSince).
       and not exists (select 1 from public.cockpit_sales_attempts as pa
                        where pa.contact_id = x.contact_id
                          and pa.started_at >= x.requested_at
                          and pa.state = 'saved'
                          and pa.saved_at > t - interval '2 minutes')
       -- Another room for this call is still live with no join that stands
       -- (the setter's second try): this room waits for it, and is settled
       -- (or told to a person) once that one closes, never read as "the lead
       -- joined another room" (stress2, round 1).
       and not exists (select 1 from public.cockpit_sales_rooms as y
                        where y.id <> x.id
                          and (y.appointment_id = x.appointment_id
                               or (y.contact_id = x.contact_id and y.requested_at >= ap.start_at - interval '1 hour'))
                          and y.state in ('requested', 'creating', 'open', 'host_in', 'lead_in')
                          and not public.cockpit_sales_room_join_stands(y.lead_in_at, y.count_undo_at, y.taken_back_join_at));

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
    -- A person marks the intro when the reason is a sign the lead may have
    -- come to this room (a room that was not the intro's says nothing).
    for rec in select q.id, q.code, q.doubt from pg_temp.lc_settle_due as q
                where not q.ok and q.doubt is not null and q.same_call loop
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

-- 5. Availability: the last press's sentence ----------------------------------

-- Why a press made no standby room (outside live hours, the ten-minute cap,
-- a provider the seat cannot use), kept on the seat's row so live.status
-- says it on every device and every read, until the next press (stress2,
-- round 1: the browser dropped it, and the strip showed the same button with
-- no reason). The table's own grants and row security cover the columns.
alter table public.cockpit_sales_availability
  add column if not exists standby_error text check (standby_error is null or length(standby_error) <= 300);
alter table public.cockpit_sales_availability
  add column if not exists standby_error_at timestamptz;
comment on column public.cockpit_sales_availability.standby_error is
  'Why the last Available press made no standby room, as the strip says it; cleared by the next press.';

-- 5b. A meeting's end kept while its room goes back to open -------------------

-- Zoom does not order its webhooks (stress2, round 2): meeting.ended read as
-- the host leaving (the room back to open, F9) is kept here, so a lead's
-- join from before it, delivered after it, ends the room joined instead of
-- leaving it lead_in on a meeting that is over (roomlogic.ts lead_in).
alter table public.cockpit_sales_rooms
  add column if not exists meeting_ended_at timestamptz;
comment on column public.cockpit_sales_rooms.meeting_ended_at is
  'When Zoom said the meeting ended while the room went back to open; a lead join from before it ends the room joined.';

-- 6. A mark replaces the call's current mark in one step ---------------------

-- index.ts markAppointment superseded the current mark in one write and
-- inserted the new one in a second (stress2, round 2): a write cut off
-- between the two left the call with no current mark (the rep's own mark
-- gone from every screen, and nothing for an undo to put back). Both now
-- happen in one transaction under the one-current-mark index
-- (cockpit_sales_dispositions_current): a failure leaves the previous mark
-- current. p_current_id is the mark read as current (null: none).
-- Marks of one call queue on the call's lock (stress2 round 4,
-- concurrent-marks-raw-unique-violation: 25 presses at once gave 24 raw
-- unique violations), and each decides on the mark current when its turn
-- comes: when that is no longer p_current_id (another mark landed first),
-- nothing moves and no row is answered, so the caller reads the call again
-- (index.ts markAppointment: a timer's mark stands down, a person's press
-- is read again once, then told the call was marked a moment ago).
create or replace function public.cockpit_sales_disposition_replace(p_current_id bigint, p_row jsonb)
returns setof public.cockpit_sales_dispositions
language plpgsql
security definer
set search_path = ''
set lock_timeout = '3s'
as $$
declare
  cur bigint;
begin
  if p_row is null or coalesce(p_row ->> 'appointment_id', '') = '' then
    raise exception 'disposition_replace: which call?' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cockpit_sales_dispositions:' || (p_row ->> 'appointment_id'), 0));
  select d.id into cur
    from public.cockpit_sales_dispositions as d
   where d.appointment_id = p_row ->> 'appointment_id' and d.superseded_at is null
   order by d.id desc
   limit 1;
  if cur is distinct from p_current_id then
    return;
  end if;
  if p_current_id is not null then
    update public.cockpit_sales_dispositions as d
       set superseded_at = now()
     where d.id = p_current_id
       and d.appointment_id = p_row ->> 'appointment_id'
       and d.superseded_at is null;
  end if;
  return query
  insert into public.cockpit_sales_dispositions (appointment_id, contact_id, call_type, start_at, status, reason, note, marked_by, crm)
  values (p_row ->> 'appointment_id', p_row ->> 'contact_id', p_row ->> 'call_type', (p_row ->> 'start_at')::timestamptz,
          p_row ->> 'status', p_row ->> 'reason', p_row ->> 'note', p_row ->> 'marked_by', coalesce(p_row ->> 'crm', 'off'))
  returning *;
end;
$$;
revoke all on function public.cockpit_sales_disposition_replace(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.cockpit_sales_disposition_replace(bigint, jsonb) to service_role;

-- 6b. An event's lease carries its holder's token (stress2, round 3) --------

-- releaseEvent cleared lease_until by dedupe key alone: a run whose lease ran
-- out (its link cascade outlasted it) gave back the lease the run that took
-- over held, and a third run took the event beside the second. The lease now
-- stores the token its taker passes; sales-api finishes and releases an
-- event only under its own token (lease_token = its token), and a lease the
-- database took as it stored the event (live.claimed) has none. Taken
-- without a token (an older sales-api), lease_token is null, as before.
alter table public.cockpit_sales_room_events add column if not exists lease_token uuid;
comment on column public.cockpit_sales_room_events.lease_token is
  'The token of the run that holds lease_until (cockpit_sales_room_event_lease p_token); a finish or release is guarded on it, so a run whose lease ran out leaves the current holder alone. Null: taken with no token.';

drop function if exists public.cockpit_sales_room_event_lease(uuid, text, integer);
create or replace function public.cockpit_sales_room_event_lease(
  p_event_id uuid default null, p_dedupe_key text default null, p_seconds integer default 60, p_token uuid default null)
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
  update public.cockpit_sales_room_events as e
     set lease_until = now() + make_interval(secs => least(greatest(coalesce(p_seconds, 60), 1), 600)),
         lease_token = p_token,
         tries = e.tries + case when e.source in ('zoom', 'slack', 'worker', 'claim', 'settle') then 1 else 0 end
   where (p_event_id is null or e.id = p_event_id)
     and (p_dedupe_key is null or e.dedupe_key = p_dedupe_key)
     and e.handled_at is null
     and (e.lease_until is null or e.lease_until <= now())
  returning e.id into got;
  return got;
end;
$$;
revoke all on function public.cockpit_sales_room_event_lease(uuid, text, integer, uuid) from public, anon, authenticated;
grant execute on function public.cockpit_sales_room_event_lease(uuid, text, integer, uuid) to service_role;

-- 6c. A setter's deal credit never comes from a live call (stress2, round 4) ---

-- cockpit_sales_setter_deals (20260927a) credits a deal whose form leaves
-- the setter blank to the rep assigned the lead's latest intro before the
-- deal, on any calendar. The live count copies its bookings into the
-- calendar copy (rooms.ts copyLiveBooking) on rooms.live_calendar_id (and
-- a test booking on rooms.test_calendar_id): a closer's video call after the
-- demo read as the lead's latest intro and took the deal off the setter's
-- pay. The fallback reads every intro but those two calendars' and any the
-- live count booked (a room's count_appointment_id); a closer's room is a
-- demo besides (sales-api roomCreate).
create or replace function public.cockpit_sales_setter_deals(
  p_rep_id text,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  response_id text,
  submitted_at timestamptz,
  closer text,
  client_name text,
  business_name text,
  payment_structure text,
  cash_collected numeric,
  contracted_revenue numeric,
  credited_by text,
  fully_closed boolean,
  fully_closed_by text
)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (
    select public.cockpit_sales_manager()
        or exists (
             select 1
               from public.cockpit_sales_people as p
              where p.email = public.cockpit_sales_email()
                and p.active
                and p.b2b_rep_id::text = p_rep_id
           ) as ok
  ),
  rep as (
    select r.ghl_user_id,
           array(
             select pg_catalog.lower(pg_catalog.btrim(x))
               from pg_catalog.unnest(coalesce(r.closer_aliases, '{}') || array[r.display_name]) as x
           ) as names
      from public.cockpit_sales_reps as r
     where r.id::text = p_rep_id
  ),
  live_cals as (
    select array_remove(array[
             nullif(pg_catalog.btrim(s.value ->> 'live_calendar_id'), ''),
             nullif(pg_catalog.btrim(s.value ->> 'test_calendar_id'), '')
           ], null) as ids
      from public.cockpit_sales_settings as s
     where s.key = 'rooms'
  ),
  credited as (
    select d.*,
           case
             when pg_catalog.lower(pg_catalog.btrim(coalesce(d.setter, ''))) = any ((select names from rep)::text[])
               then 'form'
             when nullif(pg_catalog.btrim(coalesce(d.setter, '')), '') is null
              and (select ghl_user_id from rep) is not null
              and (
                select a.assigned_user_id
                  from public.cockpit_sales_appointments as a
                 where a.contact_id = d.contact_id
                   and a.call_type = 'intro'
                   and a.start_at <= d.submitted_at
                   and not (a.calendar_id = any (coalesce((select ids from live_cals), '{}'::text[])))
                   and not exists (select 1 from public.cockpit_sales_rooms as r
                                    where r.count_appointment_id = a.appointment_id and r.count_result = 'booked')
                 order by a.start_at desc
                 limit 1
              ) = (select ghl_user_id from rep)
               then 'intro'
           end as credit
      from public.cockpit_sales_deals as d
     where d.submitted_at >= p_from
       and d.submitted_at < p_to
       and not d.voided
  )
  select c.response_id, c.submitted_at, c.closer, c.client_name, c.business_name,
         c.payment_structure, c.cash_collected, c.contracted_revenue,
         c.credit as credited_by,
         coalesce(s.fully_closed, coalesce(c.contracted_revenue > 0 and c.cash_collected >= c.contracted_revenue, false))
           as fully_closed,
         case
           when s.response_id is not null then 'confirmed'
           when c.contracted_revenue > 0 and c.cash_collected >= c.contracted_revenue then 'paid in full'
         end as fully_closed_by
    from credited as c
    left join public.cockpit_sales_deal_status as s on s.response_id = c.response_id
   where c.credit is not null
     and (select ok from allowed)
   order by c.submitted_at desc;
$$;
revoke all on function public.cockpit_sales_setter_deals(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.cockpit_sales_setter_deals(text, timestamptz, timestamptz) to authenticated, service_role;

-- 6d. The watchdog says when Slack refuses its posts (stress2, round 4) -----

-- As 20261003d made it, with three changes (slack-webhook-refused-reads-as-
-- posted): Slack refusing the #sales-alerts webhook for good (the installer
-- left: 403/404; the channel archived: 410; the hook removed) turns the
-- watchdog's own row red with what to do, until a later post succeeds; a
-- 429 (Slack's one-a-second limit) is posted again without using up one of
-- the three tries; and at most 3 posts go a run (10 before), so a burst
-- of alerts is not spent on the limit.
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
  unanswered integer := 0;
  refused integer := 0;
  refused_status integer;
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
    -- The day is said whenever the alert may be read another day: outside
    -- working hours it is posted the next working morning (fix round 4).
    since := case
      when rec.at is null then null
      when (rec.at at time zone 'Asia/Kuwait')::date = (t at time zone 'Asia/Kuwait')::date and in_hours
        then to_char(rec.at at time zone 'Asia/Kuwait', 'HH24:MI')
      else to_char(rec.at at time zone 'Asia/Kuwait', 'Dy FMDD Mon HH24:MI') end;
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

  -- 2d. Per-room alerts nobody resolved (final review): a room's mark-intro,
  -- count, undo, showed, lost-event and held alerts are a person's to act
  -- on, and sales-api answers some itself (a rep's mark, a count that
  -- settled). The rest are resolved here three days after they were raised
  -- once posted (a week when they never could be), so the open count on the
  -- Team page stops only growing. Resolved keys are never raised again (2c).
  update public.cockpit_sales_alerts as a
     set resolved_at = t,
         dedupe_key = a.dedupe_key || ':resolved:' || a.id::text
   where a.resolved_at is null
     and (a.dedupe_key like 'room:%' or a.dedupe_key like 'room_event_lost:%' or a.dedupe_key like 'room_held:%')
     and a.dedupe_key not like '%:resolved:%'
     and a.raised_at < t - interval '3 days'
     and (a.posted_at is not null or a.raised_at < t - interval '7 days');

  -- 3. Answers to earlier posts: a failed post is tried again, 3 tries at
  -- most. Slack's 429 (about one post a second) is posted again without
  -- using up a try (stress2, round 4).
  update public.cockpit_sales_alerts as a
     set post_status = coalesce(r.status_code, 0),
         post_error = case when r.status_code between 200 and 299 then null
                           else left(coalesce(r.error_msg, case when r.timed_out then 'Timed out' end,
                                              'Slack answered ' || coalesce(r.status_code::text, 'nothing')), 500) end,
         post_tries = case when r.status_code = 429 then greatest(a.post_tries - 1, 0) else a.post_tries end,
         posted_at = case when r.status_code between 200 and 299
                            or (a.post_tries >= 3 and r.status_code is distinct from 429) then a.posted_at end
    from net._http_response as r
   where r.id = a.post_request_id and a.post_status is null;

  -- 3b. A post pg_net never answered (fix round 4): its background worker
  -- stops after a database restart and pg_net then only queues posts, so no
  -- answer row ever comes. After 3 minutes the post counts as failed: posted
  -- again (3 tries at most), then kept visible with its error, and the
  -- watchdog's own row turns red with what to do.
  update public.cockpit_sales_alerts as a
     set post_status = 0,
         post_error = 'No answer from pg_net',
         posted_at = case when a.post_tries >= 3 then a.posted_at end
   where a.post_request_id is not null and a.post_status is null
     and a.posted_at < t - interval '3 minutes'
     and not exists (select 1 from net._http_response as r where r.id = a.post_request_id);
  get diagnostics unanswered = row_count;

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
       limit 3
       for update skip locked
    loop
      -- Escaped as Slack asks (& < >): stored words are shown as written,
      -- never read as markup.
      req := net.http_post(
        url := hook,
        body := jsonb_build_object('text', replace(replace(replace(rec.message, '&', '&amp;'), '<', '&lt;'), '>', '&gt;')),
        headers := jsonb_build_object('Content-Type', 'application/json'),
        timeout_milliseconds := 5000);
      update public.cockpit_sales_alerts as a
         set posted_at = t, post_request_id = req, post_tries = a.post_tries + 1, post_status = null, post_error = null
       where a.id = rec.id;
      posted := posted + 1;
    end loop;
  end if;

  select count(*) into open_n from public.cockpit_sales_alerts as a where a.resolved_at is null;

  -- Slack refused the webhook since the last post it took (stress2, round 4):
  -- a refusal that will not pass (403, 404, 410, a 4xx; never pg_net's own
  -- silence, said above, nor a 429, posted again), on an open alert. Missing
  -- is never zero: recorded alerts that reach nobody are said on this row.
  select count(*), max(a.post_status) into refused, refused_status
    from public.cockpit_sales_alerts as a
   where a.resolved_at is null
     and a.post_status is not null and a.post_status not between 200 and 299 and a.post_status not in (0, 429)
     and coalesce(a.posted_at, a.last_seen_at, a.raised_at) >= coalesce(
           (select max(b.posted_at) from public.cockpit_sales_alerts as b where b.post_status between 200 and 299),
           '-infinity'::timestamptz);

  insert into public.cockpit_sales_worker_status (worker, job, ok, detail, at)
  values ('sales-api', 'watchdog', unanswered = 0 and refused = 0,
          case when unanswered > 0
               then format('pg_net did not answer %s Slack %s in 3 minutes, so alerts may not reach #sales-alerts. Run select %s.worker_restart(); in the SQL editor. %s open alerts.',
                           unanswered, case when unanswered = 1 then 'post' else 'posts' end, 'net', open_n)
               when refused > 0
               then format('Slack refused the #sales-alerts webhook (it answered %s to %s %s), so alerts are not reaching the channel. Put a working incoming webhook for #sales-alerts in the vault as sales_alerts_slack_webhook. %s open alerts.',
                           refused_status, refused, case when refused = 1 then 'alert' else 'alerts' end, open_n)
               else format('%s open alerts, %s new, %s posted.%s', open_n, raised, posted, coalesce(' ' || note, '')) end, t)
  on conflict (worker, job) do update
     set ok = excluded.ok, detail = excluded.detail, at = excluded.at;

  return jsonb_build_object('at', t, 'in_hours', in_hours, 'open', open_n, 'raised', raised,
                            'posted', posted, 'webhook', hook is not null, 'note', note);
end;
$$;
revoke all on function public.cockpit_sales_watchdog() from public, anon, authenticated;
grant execute on function public.cockpit_sales_watchdog() to service_role;

-- 6e. A join before the press, and the link sent again (stress2, round 5) ---

-- "That was not the lead" kept only the press's own time (count_undo_at),
-- and every rule read a standing join as lead_in_at > count_undo_at. The
-- real lead's join a few seconds BEFORE the press (the press was about her
-- assistant, who joined first) read as taken back: the settle marked her
-- attended intro a no-show and the count never ran. The taken-back join's
-- own time is kept now (taken_back_join_at, written by roomlogic.ts notLead,
-- or by the guard below when a writer did not say it), and a join stands
-- when it is after that time; a room pressed before this column falls back
-- to the press, as before. Every rule reads cockpit_sales_room_join_stands.
alter table public.cockpit_sales_rooms
  add column if not exists taken_back_join_at timestamptz;
comment on column public.cockpit_sales_rooms.taken_back_join_at is
  'The own time of the join "That was not the lead" took back. A later join stands (roomlogic.ts takenBackBound).';

-- A later channel sent the link again (the rep's Also send by email, the
-- backup email after WhatsApp failed late): its words promise the lead's ten
-- minutes from that send, so lead_by moves on (roomlogic.ts link_sent) and
-- R4's open-grace cap counts from it.
alter table public.cockpit_sales_rooms
  add column if not exists last_link_at timestamptz;
comment on column public.cockpit_sales_rooms.last_link_at is
  'When a later channel sent the link again. R4''s cap and the lead''s ten minutes count from it.';

create or replace function public.cockpit_sales_room_join_stands(p_lead_in_at timestamptz, p_undo_at timestamptz, p_taken_at timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_lead_in_at is not null
         and (p_undo_at is null or p_lead_in_at > least(coalesce(p_taken_at, p_undo_at), p_undo_at));
$$;
revoke all on function public.cockpit_sales_room_join_stands(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.cockpit_sales_room_join_stands(timestamptz, timestamptz, timestamptz) to service_role;

-- Approve all pressed again after its answer was lost: the request id the
-- batch was approved under, so the repeat hands that batch back (its
-- schedule kept, one audit row) instead of approving it again.
alter table public.cockpit_sales_followup_meta
  add column if not exists approved_request uuid;
comment on column public.cockpit_sales_followup_meta.approved_request is
  'The request id of the Approve all that approved this opener. A repeat of it answers the batch made.';
create index if not exists cockpit_sales_followup_meta_approved_request
  on public.cockpit_sales_followup_meta (approved_request) where approved_request is not null;

-- The rooms guard as 20261003d made it, with the taken-back join's time.
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
    -- "That was not the lead" from a writer that does not know the column
    -- (a sales-api from before it): the taken-back join keeps its own time
    -- (stress2 round 5), so a later join (even one before the press) stands.
    -- Only when none is kept yet: a count's claim given back restores
    -- count_undo_at and must never move it onto the real lead's join.
    if new.count_undo_at is not null and new.count_undo_at is distinct from old.count_undo_at
       and new.taken_back_join_at is null then
      new.taken_back_join_at := old.lead_in_at;
    end if;
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
      -- "That was not the lead": the room waits for the real lead a little
      -- longer. lead_in_at stays: it is the time of the join that was taken
      -- back (taken_back_join_at keeps it too, so roomlogic.ts leadJoined
      -- reads no join), and roomlogic tells Zoom's second event for that same
      -- join from a new one by it.
      if old.state = 'lead_in' and new.state = 'host_in' then
        new.lead_by := greatest(coalesce(new.lead_by, old.lead_by, now()), coalesce(old.lead_by, now()),
          now() + make_interval(secs => public.cockpit_sales_setting_int(w, 'open_grace', 180)));
      end if;
      -- Into lead_in: when the room first showed it; and a writer that left a
      -- taken-back join's time as it was gets this join's time.
      if new.state = 'lead_in' then
        new.lead_in_seen_at := now();
        if new.lead_in_at is not distinct from old.lead_in_at and old.count_undo_at is not null
           and not public.cockpit_sales_room_join_stands(old.lead_in_at, old.count_undo_at, old.taken_back_join_at) then
          new.lead_in_at := now();
        end if;
      end if;
    end if;
  end if;
  -- Stamp the time of each step if the writer did not.
  if new.state = 'creating' and new.claimed_at is null then new.claimed_at := now(); end if;
  if new.state in ('open', 'host_in', 'lead_in') and new.opened_at is null then new.opened_at := now(); end if;
  if new.state in ('host_in', 'lead_in') and new.host_in_at is null then new.host_in_at := now(); end if;
  if new.state = 'lead_in' and new.lead_in_at is null then new.lead_in_at := now(); end if;
  if new.state = 'lead_in' and new.lead_in_seen_at is null then new.lead_in_seen_at := now(); end if;
  if new.state = any (finals) and new.ended_at is null then new.ended_at := now(); end if;
  return new;
end;
$$;
revoke all on function public.cockpit_sales_rooms_guard() from public, anon, authenticated;

drop trigger if exists cockpit_sales_rooms_guard on public.cockpit_sales_rooms;
create trigger cockpit_sales_rooms_guard
  before insert or update on public.cockpit_sales_rooms
  for each row execute function public.cockpit_sales_rooms_guard();

-- The short link follows the handover, as 20261003d made it, reading "no
-- join that stands" with the taken-back join's own time.
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
     and not public.cockpit_sales_room_join_stands(x.lead_in_at, x.count_undo_at, x.taken_back_join_at)
     and x.replaced_by is null;
  return null;
end;
$$;
revoke all on function public.cockpit_sales_rooms_link_replaced() from public, anon, authenticated;

-- 7. Grants (the view was made again) ---------------------------------------------

revoke all on public.cockpit_sales_presence from public, anon, authenticated;
grant select on public.cockpit_sales_presence to service_role;

notify pgrst, 'reload schema';

commit;
