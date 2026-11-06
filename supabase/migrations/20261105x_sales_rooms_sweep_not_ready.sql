-- The rooms sweep learns "Not ready yet" (2026-11-06, the setter's one queue).
--
-- 20261105w adds the dialer outcome not_ready ("Not ready yet (nurture)": the
-- rep and the lead spoke, the lead is qualified but not now). sales-api's
-- settle (roomlogic.ts PHONE_TALKED) counts it as a phone talk, so a person
-- marks the intro and the timer does not. This is the sweep's SQL twin of
-- that list ("the lead was reached by phone"), so both settle paths agree.
--
-- The function below is 20261004a_live_calls_hardening_2.sql's definition,
-- which is the live one (pg_get_functiondef compared on 2026-11-06, equal
-- after whitespace), with one change: 'not_ready' in the outcome list of the
-- phone check. Grants are restated as they were. Apply after 20261105w (the
-- outcome itself is allowed there) and before sales-api is deployed.

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
  -- roomlogic.ts LINK_RETRY_HOLD_S (m1 round 4,
  -- unsent-link-closed-as-lead-no-show-at-open-plus-ten): a room's link still
  -- tried again (claimed, never sent, its refusal one the re-ask tries again)
  -- is never closed as the lead's no-show before the retries end, ten
  -- minutes after the claim plus two for the re-ask that says it final.
  w_link_retry constant interval := interval '720 seconds';
  unsent uuid[];
  door text;
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
  -- booked room always has its own). A video-link room (manual or fallback)
  -- whose link went keeps waiting for the host at least until the lead's ten
  -- minutes and their open grace are over (m1 round 3,
  -- later-link-promise-cut-by-host-wait; a handover keeps its own taker
  -- wait, which re-offers the lead): a later
  -- channel's "I'll be there for the next 10 minutes" moves lead_by, and the
  -- host, in a Meet that sends no join signal, is never closed out first.
  -- R3 to R8 and R7 wait while a Zoom, worker or claim event for the room
  -- is still unhandled (a knock or a join the door could not forward yet,
  -- roomlogic.ts F4 and F5), at most w_hold past the rule's due time; then
  -- the rule closes the room anyway. R1, R2 and the R9 backstop never wait.
  begin
    select coalesce(array_agg(q.id), '{}') into ids from (
      select x.id from public.cockpit_sales_rooms as x
       cross join lateral (
         select greatest(coalesce(x.host_by, coalesce(x.opened_at, x.requested_at) + case x.purpose
                  when 'handover' then w_handover
                  when 'standby' then w_standby_host
                  else w_fallback_host end),
                -- The lead's ten minutes, once started: the link went, or it
                -- was left to the rep (m1 round 5, final refusal: rooms.ts
                -- startLeadWait sets lead_by with no link_sent_at).
                case when x.purpose in ('manual', 'fallback') and x.contact_id is not null and x.lead_by is not null
                     then x.lead_by + w_grace end) as due) as d
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
           coalesce(array_agg(q.id) filter (where q.lost and not q.knocked), '{}'),
           coalesce(array_agg(q.id) filter (where (q.retrying or q.unstarted) and not q.knocked and not q.lost), '{}')
      into ids, knocked, lost, unsent from (
      select x.id, k.stands as knocked, rt.retrying,
             -- The link was claimed and never went, and the lead's ten
             -- minutes never started (no lead_by: night on the lead's clock
             -- stopped it, m1 round 3b, retried-link-cut-by-night-after-
             -- press-grace): no lead waited on a link, so never a no-show.
             (x.link_sent_at is null and x.lead_by is null and x.link_claimed_at is not null
              and x.purpose in ('manual', 'fallback')) as unstarted,
             -- Only an event that could carry a join (Zoom's): a given-up
             -- worker.ready or worker.failed says nothing about who joined
             -- (m1 round 6, m1-chaos-r6-events-lost-worker-ready-meet-room-
             -- closed-in-zoom-words), so that room closes as any other.
             exists (select 1 from public.cockpit_sales_room_events as e
                      where e.room_id = x.id and e.source = 'zoom' and e.detail ? 'gave_up') as lost
        from public.cockpit_sales_rooms as x
       -- A knock that still stands (m1 round 4, zoom-knock-of-taken-back-
       -- person-kept; roomlogic.ts knockStands): after every lead join on
       -- record. The knock of the person let in and taken back by "That was
       -- not the lead" was answered, so it is nobody at the door.
       cross join lateral (
         select (x.lead_waiting_at is not null
                 and x.lead_waiting_at > coalesce(greatest(x.lead_in_at, x.taken_back_join_at), '-infinity'::timestamptz)) as stands) as k
       -- The link still tried again (roomlogic.ts linkRetrying, m1 round 4):
       -- claimed, never sent, its refusal one the minute's re-ask tries again.
       cross join lateral (
         select (x.link_sent_at is null and x.link_claimed_at is not null
                 and coalesce(x.refusal, '') ~* 'tried again in a minute\.?$') as retrying) as rt
       cross join lateral (
         select coalesce(case when x.purpose = 'booked' then x.ends_at
                              -- From the latest send of the link (stress2 round 5: a later
                              -- channel's email promises its own ten minutes). A link
                              -- left to the rep (none went) starts the lead's ten minutes
                              -- at the refusal (m1 round 5, lead_by): never before them
                              -- plus one grace. A link that went keeps its own cap, so
                              -- lead_by moved by opens never pushes it on.
                              else greatest(coalesce(greatest(x.link_sent_at, x.last_link_at), x.opened_at) + w_lead + w_grace,
                                            case when x.purpose in ('manual', 'fallback') and x.link_sent_at is null
                                                      and x.last_link_at is null
                                                 then x.lead_by + w_grace end) end,
                         'infinity'::timestamptz) as cap) as c
       cross join lateral (
         select greatest(coalesce(x.lead_by, x.link_sent_at + w_lead, x.host_in_at + w_lead,
                                  x.opened_at + w_lead, x.requested_at + w_lead),
                         case when coalesce(x.last_open_at, x.first_open_at) is not null
                              then least(coalesce(x.last_open_at, x.first_open_at) + w_grace, c.cap) end,
                         case when k.stands
                              then least(x.lead_waiting_at + w_grace, c.cap) end,
                         -- The lead's ten minutes start at the link, never while it is tried again.
                         case when rt.retrying then x.link_claimed_at + w_link_retry end,
                         -- A link left to the rep by a final refusal whose lead_by
                         -- write was lost (m1 round 6, m1-chaos-r6-final-refusal-
                         -- lead-wait-blip-room-closed-under-hand-sent-link): the
                         -- lead's ten minutes from the refusal (its line, or the
                         -- re-ask's ten minutes at the latest), never a close a
                         -- minute after the rep was told to send it by hand.
                         -- sales-api's tick writes lead_by again within a minute.
                         case when x.link_sent_at is null and x.lead_by is null and x.link_claimed_at is not null
                                   and x.purpose in ('manual', 'fallback') and x.refusal is not null and not rt.retrying
                                   and x.refusal !~* '^It is night where the lead is'
                              then greatest(x.link_claimed_at + interval '600 seconds',
                                            coalesce((select max(e.at) from public.cockpit_sales_room_events as e
                                                       where e.room_id = x.id and e.kind in ('link.not_sent', 'link.unclear')),
                                                     '-infinity'::timestamptz)) + w_lead end) as due) as d
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
    -- The link never went and was still tried again (m1 round 4): never the
    -- lead's no-show (no result, so nothing settles it and the panel offers
    -- no No-show press).
    n := n + public.cockpit_sales_rooms_close(unsent, array['open', 'host_in'], 'expired', 'link_not_sent',
      'Closed: the link never reached the lead, so this was no no-show.', null, null);
    n := n + public.cockpit_sales_rooms_close(
      array(select i from unnest(ids) as i where not (i = any (knocked)) and not (i = any (lost)) and not (i = any (unsent))),
      array['open', 'host_in'], 'expired', 'lead_no_show',
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

  -- L0. Live handover switched off (live.enabled not true; Milestone 1
  -- fence): an offer still open ends now, so nobody is offered a lead and
  -- no Take can land on it. Nobody is made Away for it.
  begin
    n := 0;
    if not coalesce((lcfg -> 'enabled') = 'true'::jsonb, false) then
      for rec in
        select x.id from public.cockpit_sales_live as x
         where x.state = 'offered'
         for update skip locked
      loop
        n := n + public.cockpit_sales_live_move(rec.id, array['offered'], 'expired', 'live_off',
               'Live handover is switched off, so the offer ended.');
      end loop;
    end if;
    summary := summary || jsonb_build_object('offer_live_off', n); moved_live := moved_live + n;
  exception when others then
    errs := errs || jsonb_build_object('rule', 'offer_live_off', 'error', sqlerrm);
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
      -- Offered again only while live handover is on (Milestone 1 fence).
      if rec.state = 'room_ready' and rec.room_state <> 'failed' and rec.room_reason = 'host_not_in' and rec.reoffers = 0
         and coalesce((lcfg -> 'enabled') = 'true'::jsonb, false)
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
      -- Never while live handover is switched off (Milestone 1 fence): a
      -- standby room exists only for live handovers.
      fresh := coalesce((cfg -> 'enabled') = 'true'::jsonb, false)
               and coalesce((lcfg -> 'enabled') = 'true'::jsonb, false)
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
                    -- Running: the call's whole length (rooms.lengths_min), as the
                    -- presence view holds the host on it (stress2 closing sweep).
                    and ap.start_at + make_interval(mins => public.cockpit_sales_setting_int(
                          len, coalesce(ap.call_type, ''),
                          case when ap.call_type = 'demo' then 60 else 30 end)) > t);
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
         -- Running means the call's whole length (rooms.lengths_min: 30 an
         -- intro, 60 a demo), the window the presence view holds the host
         -- on it, never the live booking's shorter slot (booking_min): a
         -- standby room never stays open under a host the view still has
         -- on their booked call (stress2 closing sweep, a demo that ends early).
         select min(ap.start_at) - w_booked_guard as due
           from public.cockpit_sales_people as p
           join public.cockpit_sales_appointments as ap on ap.assigned_user_id = p.ghl_user_id
          where p.email = x.host_email and p.ghl_user_id is not null
            and ap.status in ('new', 'confirmed', 'showed')
            and ap.start_at <= t + w_booked_guard
            and ap.start_at + make_interval(mins => public.cockpit_sales_setting_int(
                  len, coalesce(ap.call_type, ''),
                  case when ap.call_type = 'demo' then 60 else 30 end)) > t) as b
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

  -- R10. Live handover switched off (live.enabled not true; Milestone 1
  -- fence): an empty standby room has nothing to wait for, so it ends, and
  -- one not made yet is cancelled (the worker closes any meeting it made).
  -- A room with a lead in it is never touched.
  begin
    if coalesce((lcfg -> 'enabled') = 'true'::jsonb, false) then
      summary := summary || jsonb_build_object('standby_live_off', 0);
    else
      select coalesce(array_agg(q.id), '{}') into ids from (
        select x.id from public.cockpit_sales_rooms as x
         where x.purpose = 'standby' and x.contact_id is null
           and x.state in ('requested', 'creating', 'open', 'host_in')
           and (x.requested_at + w_hold < t or not public.cockpit_sales_room_pending(x.id, t))
         for update of x skip locked) as q;
      n := public.cockpit_sales_rooms_close(ids, array['open', 'host_in'], 'ended', 'live_off',
        'Closed: live handover is switched off.', null, null);
      n := n + public.cockpit_sales_rooms_close(ids, array['requested', 'creating'], 'cancelled', 'live_off',
        'Cancelled: live handover is switched off.', null, null);
      summary := summary || jsonb_build_object('standby_live_off', n); moved_rooms := moved_rooms + n;
    end if;
  exception when others then
    errs := errs || jsonb_build_object('rule', 'standby_live_off', 'error', sqlerrm);
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
      select e.id, e.at from public.cockpit_sales_room_events as e
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
      returning e.id, e.at
    )
    -- In the order the events were stored, never by their ids (m1 round 3b,
    -- replay-order-lead-join-stamps-host-in-hides-meeting-end): a call's
    -- Zoom events read lead join, end, host join stamped the host in after
    -- the meeting had ended. sales-api's replay orders them again by Zoom's
    -- own times.
    select coalesce(jsonb_agg(b.id::text order by b.at, b.id), '[]'::jsonb) into replay from bumped as b;
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
  -- Only while rooms.settle is true (Milestone 1 fence: off, missing is
  -- off): with it off no settle event is made or posted, no room is marked
  -- settled and nobody is asked to mark from here; the rep marks the call.
  begin
    if not coalesce((cfg -> 'settle') = 'true'::jsonb, false) then
      summary := summary || jsonb_build_object('settle_off', true, 'settle_due', 0);
    else
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
       select coalesce(x.appointment_call_at, x.requested_at) between ap.start_at - interval '5 minutes' and ap.start_at + w_settle
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
                                     or (pa.outcome in ('callback', 'booked', 'not_interested', 'not_ready', 'disqualified', 'handled',
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
    end if;
  exception when others then
    errs := errs || jsonb_build_object('rule', 'settle', 'error', sqlerrm);
  end;

  -- T. The rooms room.event re-checks (contract-v2 S1 and S4): every room
  -- with a lead that is not final, oldest first, then every final room whose
  -- lead_in_at or count_undo_at falls in the last hour, newest first, then
  -- (every ten minutes) a final room whose count could not book while its
  -- alert is open, for three days; 100 a
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
        union all
        -- A final room whose link may have gone (its link.unclear line) and
        -- is not recorded as sent, for the link's 15 minutes of re-reads:
        -- room.event reads the lead's conversation for it once more (m1
        -- round 3b, unclear-link-never-settled-after-room-closes).
        select x.id, 1, -extract(epoch from x.link_claimed_at)
          from public.cockpit_sales_rooms as x
         where x.state = any (finals) and x.contact_id is not null
           and x.link_sent_at is null and x.link_claimed_at > t - interval '15 minutes'
           and not coalesce(x.lead_in_at > t - interval '1 hour' or x.count_undo_at > t - interval '1 hour', false)
           and exists (select 1 from public.cockpit_sales_room_events as v
                        where v.room_id = x.id and v.kind = 'link.unclear')
        union all
        -- A room the desk closed as moved to the phone (an answered call)
        -- whose run stopped before its line or audit row (its mark
        -- room.phone_close not done): room.event finishes them (m1 round 6,
        -- m1-chaos-r6-phone-close-killed-after-room-write-no-audit-row).
        select x.id, 1, -extract(epoch from x.ended_at)
          from public.cockpit_sales_rooms as x
         where x.state = 'cancelled' and x.result = 'moved_to_phone' and x.contact_id is not null
           and x.ended_at > t - interval '1 hour'
           and not coalesce(x.lead_in_at > t - interval '1 hour' or x.count_undo_at > t - interval '1 hour', false)
           and exists (select 1 from public.cockpit_sales_room_events as v
                        where v.dedupe_key = 'room.phone_close:' || x.id::text
                          and not coalesce(v.detail ->> 'done' = 'true', false))
        union all
        -- A count that could not book (failed or unclear) whose alert still
        -- asks a person to add the live call by hand: posted every ten
        -- minutes for the alert's three days, so a call added after the
        -- first hour is still found and counted (stress2 round 6,
        -- hand-booked-live-call-after-the-hour-never-copied).
        select x.id, 2, -extract(epoch from x.lead_in_at)
          from public.cockpit_sales_rooms as x
         where x.state = any (finals) and x.contact_id is not null
           and x.count_result in ('failed', 'unclear')
           and x.lead_in_at <= t - interval '1 hour' and x.lead_in_at > t - interval '3 days'
           and (x.count_undo_at is null or x.count_undo_at <= t - interval '1 hour')
           and extract(minute from t)::integer % 10 = 0
           and exists (select 1 from public.cockpit_sales_alerts as al
                        where al.dedupe_key in ('room:' || x.id::text || ':count_failed', 'room:' || x.id::text || ':count_unclear')
                          and al.resolved_at is null)
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

  -- The door to sales-api still refused or silent (the tick's
  -- sweep:door_refused or sweep:pg_net_silent alert open): the row stays red
  -- with the door's words, never green on a minute that posted nothing
  -- (m1 round 6, m1-numbers-r6-sweep-row-green-minute-after-door-refused).
  -- An answered post resolves the alert, and the next minute's row is green.
  select a.message into door
    from public.cockpit_sales_alerts as a
   where a.dedupe_key in ('sweep:door_refused', 'sweep:pg_net_silent') and a.resolved_at is null
   order by a.dedupe_key
   limit 1;
  insert into public.cockpit_sales_worker_status (worker, job, ok, detail, at)
  values ('sales-api', 'sweep', jsonb_array_length(errs) = 0 and door is null,
          left(case when jsonb_array_length(errs) > 0
                 then format('%s rules failed: %s', jsonb_array_length(errs), errs::text)
                 when door is not null then door
                 else format('%s rooms closed, %s handovers moved, %s events sent back to room.event, %s rooms to settle, %s rooms to re-check.',
                             moved_rooms, moved_live, jsonb_array_length(replay), jsonb_array_length(settle),
                             jsonb_array_length(ticks)) end, 500),
          t)
  on conflict (worker, job) do update
     set ok = excluded.ok, detail = excluded.detail, at = excluded.at;

  return summary;
end;
$$;
revoke all on function public.cockpit_sales_rooms_sweep() from public, anon, authenticated;
grant execute on function public.cockpit_sales_rooms_sweep() to service_role;
