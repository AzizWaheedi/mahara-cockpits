-- Adversarial checks for 20261003a/b/c (review of lane lc-db, 2026-10-03).
--
-- Each check states the behaviour the specs, the glossary or another lane
-- expect. They failed until the findings were fixed; now they are regression
-- checks and every one must pass. Changed after the fixes (lc-db, same day),
-- only where a chosen fix changed what a valid fixture is: a booked room now
-- always carries its deadlines (helper, X6, X6b), room_ready needs its room
-- (X7), and presence is service role only (X11).
--
-- X16 to X22 were added in the integration pass (contract-v2.md section 2):
-- each failed on the merged branch before its fix.
--
-- Run ONLY inside a transaction that is rolled back, after the three
-- migrations, through run_adversarial.py (same safety as run_checks.py:
-- one transaction, lock_timeout 5 s, rollback, leftovers query after).
-- Fixtures use lc-test-* ids and @example.invalid addresses only. One
-- auth.users row (lc-test-seat@example.invalid) is made for the
-- presence-as-a-seat check and rolled back with the rest.

create temp table lc_checks (n serial primary key, name text not null, ok boolean not null, detail text) on commit drop;

create function pg_temp.ck(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into pg_temp.lc_checks (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail)
$$;

create function pg_temp.errm(p_sql text)
returns text language plpgsql as $$
begin
  execute p_sql;
  return 'none';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end;
$$;

create function pg_temp.room(p_contact text, p_host text, p_purpose text, p_state text default 'requested',
                             p_kind text default 'intro', p_appt text default null)
returns uuid language plpgsql as $$
declare
  v uuid;
begin
  insert into public.cockpit_sales_rooms
    (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, join_url, appointment_id,
     host_by, lead_by, ends_at)
  values (gen_random_uuid(), p_contact, p_purpose, p_kind, 'zoom', p_host, p_host, p_state,
          case when p_state in ('open', 'host_in', 'lead_in') then 'https://zoom.example.invalid/j/9' end, p_appt,
          -- A booked room carries its appointment's deadlines (fix for X6).
          case when p_purpose = 'booked' then now() + interval '15 minutes' end,
          case when p_purpose = 'booked' then now() + interval '20 minutes' end,
          case when p_purpose = 'booked' then now() + interval '60 minutes' end)
  returning id into v;
  return v;
end;
$$;

create function pg_temp.live(p_contact text, p_offered text[], p_until interval default interval '2 minutes',
                             p_kind text default 'demo')
returns uuid language plpgsql as $$
declare
  v uuid;
begin
  insert into public.cockpit_sales_live (request_id, contact_id, asked_by, kind, reason, offered_to, offer_until)
  values (gen_random_uuid(), p_contact, 'lc-test-xsetter@example.invalid', p_kind, 'on_call', p_offered, now() + p_until)
  returning id into v;
  return v;
end;
$$;

-- X1. A Take press carries the version it saw (contract: "Every write carries
-- request_id or version"; Offer has a version). Non-state writes bump it.
do $$
declare
  l uuid; v integer;
begin
  l := pg_temp.live('lc-test-x1', array['lc-test-x1k@example.invalid']);
  select version into v from public.cockpit_sales_live where id = l;
  -- The worker records the Slack post it made for this offer.
  update public.cockpit_sales_live
     set slack_posts = '[{"email":"lc-test-x1k@example.invalid","channel":"D0","ts":"1.0"}]'::jsonb where id = l;
  perform pg_temp.ck('X1 a Take with the version the offer was shown at still wins after the Slack post is recorded',
    exists (select 1 from public.cockpit_sales_live_claim(l, 'lc-test-x1k@example.invalid', v)),
    format('offer shown at version %s, now %s', v, (select version from public.cockpit_sales_live where id = l)));

  l := pg_temp.live('lc-test-x1b', array['lc-test-x1a@example.invalid', 'lc-test-x1c@example.invalid']);
  select version into v from public.cockpit_sales_live where id = l;
  -- Closer A presses Not now (live.decline appends to declined_by).
  update public.cockpit_sales_live set declined_by = declined_by || array['lc-test-x1a@example.invalid'] where id = l;
  perform pg_temp.ck('X1b after another closer presses Not now, the remaining closer''s Take still wins',
    exists (select 1 from public.cockpit_sales_live_claim(l, 'lc-test-x1c@example.invalid', v)));
exception when others then
  perform pg_temp.ck('X1 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- X2. A room with a lead in host_in whose link never went out (read out, or
-- every channel refused) has no deadline at all, so it holds the lead, the
-- host and (for a handover) the closer forever.
do $$
declare
  r uuid; l uuid; s jsonb; got text;
begin
  r := pg_temp.room('lc-test-x2', 'lc-test-x2h@example.invalid', 'fallback', 'host_in');
  update public.cockpit_sales_rooms
     set requested_at = now() - interval '3 hours', opened_at = now() - interval '3 hours',
         host_in_at = now() - interval '3 hours', host_by = now() - interval '2 hours 45 minutes'
   where id = r;
  -- A handover room the taker entered; the link was never sent.
  l := pg_temp.live('lc-test-x2b', array['lc-test-x2k@example.invalid']);
  r := pg_temp.room('lc-test-x2b', 'lc-test-x2k@example.invalid', 'handover', 'host_in', 'demo');
  update public.cockpit_sales_rooms
     set requested_at = now() - interval '3 hours', opened_at = now() - interval '3 hours',
         host_in_at = now() - interval '3 hours', handover_id = l, send_on = 'host_in'
   where id = r;
  update public.cockpit_sales_live set state = 'claimed', claimed_by = 'lc-test-x2k@example.invalid', room_id = r where id = l;
  update public.cockpit_sales_live set state = 'room_ready' where id = l;
  update public.cockpit_sales_live set claimed_at = now() - interval '3 hours' where id = l;
  s := public.cockpit_sales_rooms_sweep();
  s := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('X2 a host_in fallback room with no lead_by and no link_sent_at is closed 3 hours later',
    (select state <> 'host_in' from public.cockpit_sales_rooms where contact_id = 'lc-test-x2'),
    (select state from public.cockpit_sales_rooms where contact_id = 'lc-test-x2'));
  perform pg_temp.ck('X2b its handover does not stay room_ready for 3 hours',
    (select state <> 'room_ready' from public.cockpit_sales_live where id = l),
    (select state from public.cockpit_sales_live where id = l));
  got := pg_temp.errm(format('select * from public.cockpit_sales_live_claim(%L, %L)',
           pg_temp.live('lc-test-x2c', array['lc-test-x2k@example.invalid']), 'lc-test-x2k@example.invalid'));
  perform pg_temp.ck('X2c that closer can take a new live lead 3 hours later', got = 'none', got);
exception when others then
  perform pg_temp.ck('X2 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- X3. "That was not the lead" after the handover reached lead_joined, then
-- the real lead never comes: the room expires, the handover must end.
do $$
declare
  l uuid; r uuid; s jsonb; got text;
begin
  l := pg_temp.live('lc-test-x3', array['lc-test-x3k@example.invalid']);
  r := pg_temp.room('lc-test-x3', 'lc-test-x3k@example.invalid', 'handover', 'lead_in', 'demo');
  update public.cockpit_sales_rooms set handover_id = l where id = r;
  update public.cockpit_sales_live set state = 'claimed', claimed_by = 'lc-test-x3k@example.invalid', room_id = r where id = l;
  update public.cockpit_sales_live set state = 'lead_joined' where id = l;
  -- room.mark not_lead: lead_in back to host_in (the trigger clears lead_in_at).
  update public.cockpit_sales_rooms set state = 'host_in' where id = r;
  -- The real lead never comes.
  update public.cockpit_sales_rooms set lead_by = now() - interval '1 minute' where id = r;
  s := public.cockpit_sales_rooms_sweep();
  s := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('X3 room expired (setup)', (select state = 'expired' from public.cockpit_sales_rooms where id = r),
    (select state from public.cockpit_sales_rooms where id = r));
  perform pg_temp.ck('X3 a lead_joined handover whose room ended with no lead in it is ended by the sweep',
    (select state in ('done', 'expired', 'cancelled', 'failed') from public.cockpit_sales_live where id = l),
    (select state from public.cockpit_sales_live where id = l));
  got := pg_temp.errm(format('select * from public.cockpit_sales_live_claim(%L, %L)',
           pg_temp.live('lc-test-x3b', array['lc-test-x3k@example.invalid']), 'lc-test-x3k@example.invalid'));
  perform pg_temp.ck('X3b that closer can take the next live lead', got = 'none', got);
exception when others then
  perform pg_temp.ck('X3 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- X4. One miss sets Away (C17). A closer who took another offer in the same
-- two minutes did not miss anything.
do $$
declare
  a uuid; b uuid; s jsonb;
begin
  insert into public.cockpit_sales_availability (email, state, until)
    values ('lc-test-x4k@example.invalid', 'available', now() + interval '1 hour');
  a := pg_temp.live('lc-test-x4a', array['lc-test-x4k@example.invalid'], interval '-1 second');
  b := pg_temp.live('lc-test-x4b', array['lc-test-x4k@example.invalid']);
  perform 1 from public.cockpit_sales_live_claim(b, 'lc-test-x4k@example.invalid');
  s := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('X4 a closer who took one offer is not set Away when the other offer to them ends',
    (select state = 'available' from public.cockpit_sales_availability where email = 'lc-test-x4k@example.invalid'),
    (select state || ' ' || coalesce(reason, '') from public.cockpit_sales_availability where email = 'lc-test-x4k@example.invalid'));
exception when others then
  perform pg_temp.ck('X4 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- X5. The taker leaves before the lead comes; the handover is offered again
-- and another closer takes it. "The short link follows the new room" (P2,
-- foundation): the lead's first room must point at the new one.
do $$
declare
  l uuid; r1 uuid; r2 uuid; s jsonb; got public.cockpit_sales_live;
begin
  insert into public.cockpit_sales_availability (email, state, until) values
    ('lc-test-x5t@example.invalid', 'available', now() + interval '1 hour'),
    ('lc-test-x5u@example.invalid', 'available', now() + interval '1 hour');
  r1 := pg_temp.room(null, 'lc-test-x5t@example.invalid', 'standby', 'host_in', 'demo');
  r2 := pg_temp.room(null, 'lc-test-x5u@example.invalid', 'standby', 'host_in', 'demo');
  l := pg_temp.live('lc-test-x5', array['lc-test-x5t@example.invalid', 'lc-test-x5u@example.invalid']);
  select * into got from public.cockpit_sales_live_claim(l, 'lc-test-x5t@example.invalid');
  perform pg_temp.ck('X5 setup: first taker adopted their room', got.room_id = r1 and got.state = 'room_ready', got.state);
  -- sales-api finished the Take (integration pass: an unhandled live.claimed
  -- event holds the room's timers for at most 5 minutes).
  update public.cockpit_sales_room_events set handled_at = now(), lease_until = null
   where dedupe_key = 'live.claimed:' || l::text || ':0';
  update public.cockpit_sales_rooms set link_sent_at = now() where id = r1;   -- the link went to the lead
  update public.cockpit_sales_rooms set state = 'open' where id = r1;          -- the taker left
  update public.cockpit_sales_rooms set host_by = now() - interval '1 second' where id = r1;
  s := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('X5 setup: offered again to the other closer',
    (select state = 'offered' and offered_to = array['lc-test-x5u@example.invalid'] from public.cockpit_sales_live where id = l),
    (select state || ' ' || offered_to::text from public.cockpit_sales_live where id = l));
  select * into got from public.cockpit_sales_live_claim(l, 'lc-test-x5u@example.invalid');
  perform pg_temp.ck('X5 after the second Take, the first room points at the new one (replaced_by), so the lead''s link follows',
    (select replaced_by = r2 from public.cockpit_sales_rooms where id = r1),
    format('second room %s, first room replaced_by %s', got.room_id, (select replaced_by from public.cockpit_sales_rooms where id = r1)));
exception when others then
  perform pg_temp.ck('X5 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- X6. Booked rooms: deadlines come from the appointment (glossary 1.9:
-- host_by start + 15, lead_by start + 20). A booked room written without
-- them must not fall back to the fallback-room waits.
do $$
declare
  r uuid; r2 uuid; s jsonb; got text;
begin
  -- Wrapped 20 minutes before a call an hour away: start + 15, + 20, ends + 60.
  r := pg_temp.room('lc-test-x6', 'lc-test-x6h@example.invalid', 'booked', 'open', 'demo', 'lc-test-appt-x6');
  update public.cockpit_sales_rooms set opened_at = now() - interval '20 minutes', requested_at = now() - interval '20 minutes',
         host_by = now() + interval '55 minutes', lead_by = now() + interval '60 minutes', ends_at = now() + interval '100 minutes'
   where id = r;
  -- The link went 15 minutes before the start, 11 minutes ago.
  r2 := pg_temp.room('lc-test-x6b', 'lc-test-x6h2@example.invalid', 'booked', 'host_in', 'demo', 'lc-test-appt-x6b');
  update public.cockpit_sales_rooms set link_sent_at = now() - interval '11 minutes',
         host_by = now() + interval '19 minutes', lead_by = now() + interval '24 minutes', ends_at = now() + interval '64 minutes'
   where id = r2;
  s := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('X6 a booked room wrapped 20 min before a call an hour away is not expired by the 15-minute fallback wait',
    (select state = 'open' from public.cockpit_sales_rooms where id = r),
    (select state || ' ' || coalesce(end_reason, '') from public.cockpit_sales_rooms where id = r));
  perform pg_temp.ck('X6b a booked room whose link went 11 min ago is not expired by link + 600 s',
    (select state = 'host_in' from public.cockpit_sales_rooms where id = r2),
    (select state || ' ' || coalesce(end_reason, '') from public.cockpit_sales_rooms where id = r2));
  got := pg_temp.errm($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, state, join_url, appointment_id)
                         values (gen_random_uuid(), 'lc-test-x6c', 'booked', 'demo', 'zoom', 'lc-test-x6h3@example.invalid', 'x', 'open', 'https://zoom.example.invalid/j/6', 'lc-test-appt-x6c')$q$);
  perform pg_temp.ck('X6c (alternative fix) a booked room without host_by, lead_by and ends_at is refused', got like '23514%', got);
exception when others then
  perform pg_temp.ck('X6 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- X7. The handover machine (glossary 1.3): the only way back is
-- room_ready -> offered, once. Nothing goes back from lead_joined.
do $$
declare
  l uuid; got text; r uuid;
begin
  l := pg_temp.live('lc-test-x7', array['lc-test-x7k@example.invalid']);
  update public.cockpit_sales_live set state = 'claimed', claimed_by = 'lc-test-x7k@example.invalid' where id = l;
  r := pg_temp.room('lc-test-x7', 'lc-test-x7k@example.invalid', 'handover', 'host_in', 'demo');   -- room_ready needs its room
  update public.cockpit_sales_live set state = 'room_ready', room_id = r where id = l;
  update public.cockpit_sales_live set state = 'lead_joined' where id = l;
  got := pg_temp.errm(format($q$update public.cockpit_sales_live set state = 'offered', claimed_by = null,
                                  offer_until = now() + interval '2 minutes' where id = %L$q$, l));
  perform pg_temp.ck('X7 a handover with the lead in the call cannot go back to offered (P0001)', got like 'P0001%', got);
  l := pg_temp.live('lc-test-x7b', array['lc-test-x7k2@example.invalid']);
  update public.cockpit_sales_live set state = 'claimed', claimed_by = 'lc-test-x7k2@example.invalid' where id = l;
  got := pg_temp.errm(format($q$update public.cockpit_sales_live set state = 'offered', claimed_by = null where id = %L$q$, l));
  perform pg_temp.ck('X7b claimed cannot go back to offered without counting the one re-offer (P0001)', got like 'P0001%', got);
exception when others then
  perform pg_temp.ck('X7 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- X8. Channel names: the glossary's switch is rooms.send.whatsapp_text and
-- roomlogic.ts writes link_channels ['whatsapp_text', 'whatsapp_template',
-- 'email'] and link_message_ids as {channel: id}.
do $$
declare
  got text;
begin
  got := pg_temp.errm($q$insert into public.cockpit_sales_rooms (request_id, contact_id, purpose, call_kind, provider, host_email, made_by, link_channels)
                         values (gen_random_uuid(), 'lc-test-x8', 'fallback', 'intro', 'meet', 'lc-test-x8h@example.invalid', 'x', '{whatsapp_text}')$q$);
  perform pg_temp.ck('X8 link_channels takes the logic lane''s whatsapp_text', got = 'none', got);
  perform pg_temp.ck('X8b link_message_ids can hold {channel: message id} as roomlogic.ts reads it',
    (select data_type = 'jsonb' from information_schema.columns
      where table_schema = 'public' and table_name = 'cockpit_sales_rooms' and column_name = 'link_message_ids'),
    (select data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'cockpit_sales_rooms' and column_name = 'link_message_ids'));
exception when others then
  perform pg_temp.ck('X8 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- X9. Waves as the desk lane (lc-desk, desk/waves.py) writes them.
do $$
declare
  w uuid; got text;
begin
  insert into public.cockpit_sales_followup_waves (pool, segment, state, made_by)
    values ('no_show_cancelled', 'reactivate', 'running', 'lc-test') returning id into w;
  got := pg_temp.errm(format($q$insert into public.cockpit_sales_followup_wave_members (wave_id, contact_id, arm, state, event_at)
                                 values (%L, 'lc-test-x9a', 'wave', 'waiting', now())$q$, w));
  perform pg_temp.ck('X9 a wave member as the desk enrols it (state waiting, event_at) is accepted', got = 'none', got);
  got := pg_temp.errm(format($q$insert into public.cockpit_sales_followup_wave_members (wave_id, contact_id, arm, state)
                                 values (%L, 'lc-test-x9b', 'holdout', 'held_out')$q$, w));
  perform pg_temp.ck('X9b a holdout member as the desk enrols it (state held_out) is accepted', got = 'none', got);
  insert into public.cockpit_sales_followup_wave_members (wave_id, contact_id, arm) values (w, 'lc-test-x9c', 'wave');
  got := pg_temp.errm(format($q$update public.cockpit_sales_followup_wave_members set state = 'excluded', excluded_reason = 'x'
                                 where wave_id = %L and contact_id = 'lc-test-x9c'$q$, w));
  perform pg_temp.ck('X9c the desk''s exclusion (excluded_reason) is accepted', got = 'none', got);
  perform pg_temp.ck('X9d cockpit_sales_followup_meta exists (the desk writes wave_id and kind_key there for batches)',
    to_regclass('public.cockpit_sales_followup_meta') is not null);
  perform pg_temp.ck('X9e cockpit_sales_followup_stops exists (the desk lane''s stop rule table)',
    to_regclass('public.cockpit_sales_followup_stops') is not null);
exception when others then
  perform pg_temp.ck('X9 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- X10. Levels: one kind key format, and no way around the WhatsApp gate.
do $$
declare
  got text;
begin
  update public.cockpit_sales_settings set value = value - 'connector_off' - 'single_copy_ok_at' where key = 'whatsapp_guard';
  got := pg_temp.errm($q$insert into public.cockpit_sales_followup_levels (kind_key, level, set_by) values ('no_show', 'sends_by_itself', 'lc-test')$q$);
  perform pg_temp.ck('X10 a kind key with no channel cannot send by itself while the WhatsApp gate is shut',
    got like 'P0001%' or got like '23514%', got);
  got := pg_temp.errm($q$insert into public.cockpit_sales_followup_levels (kind_key, level, set_by) values ('reactivate.ar.whatsapp_template', 'approve', 'lc-test')$q$);
  perform pg_temp.ck('X10b the kind key the desk writes (reactivate.ar.whatsapp_template) fits the levels table', got = 'none', got);
exception when others then
  perform pg_temp.ck('X10 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- X11. Presence as a seat would read it (security_invoker, people own-row for
-- non-managers) gave seats wrong answers. Fix chosen: the view is service
-- role only and sales-api serves it (live.status), so a seat cannot read a
-- wrong answer, and sales-api's answer is the true one.
do $$
declare
  uid uuid := gen_random_uuid();
  svc record; seat record; made text;
begin
  made := pg_temp.errm(format($q$insert into auth.users (id, email, email_confirmed_at, aud, role)
                                  values (%L, 'lc-test-seat@example.invalid', now(), 'authenticated', 'authenticated')$q$, uid));
  if made <> 'none' then
    perform pg_temp.ck('X11 skipped: cannot make a test sign-in', true, made);
    return;
  end if;
  insert into public.cockpit_sales_people (email, name, role, active, via_portal, ghl_user_id) values
    ('lc-test-seat@example.invalid', 'Test', 'setter', true, true, null),
    ('lc-test-x11c@example.invalid', 'Test', 'closer', true, true, 'lc-test-ghl-x11');
  insert into public.cockpit_sales_availability (email, state, until)
    values ('lc-test-x11c@example.invalid', 'available', now() + interval '1 hour');
  insert into public.cockpit_sales_appointments (appointment_id, contact_id, call_type, status, assigned_user_id, start_at, origin)
    values ('lc-test-appt-x11', 'lc-test-x11-lead', 'demo', 'confirmed', 'lc-test-ghl-x11', now() - interval '5 minutes', 'ghl');
  select state, default_provider into svc from public.cockpit_sales_presence where email = 'lc-test-x11c@example.invalid';
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated', 'email', 'lc-test-seat@example.invalid')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role authenticated;
  made := pg_temp.errm($q$select state, default_provider from public.cockpit_sales_presence where email = 'lc-test-x11c@example.invalid'$q$);
  reset role;
  perform pg_temp.ck('X11 a seat cannot read presence directly (no wrong answer to read; 42501)', made like '42501%', made);
  perform pg_temp.ck('X11 sales-api (service role) sees the closer on the call, on their own Zoom default',
    svc.state = 'on_call' and svc.default_provider = 'zoom', format('service: %s/%s', svc.state, svc.default_provider));
exception when others then
  reset role;
  perform pg_temp.ck('X11 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- X12. An event the sweep gave up on (3 tries) stays unhandled forever, so
-- the watchdog's room_events alert can never clear and a later incident
-- raises nothing new.
do $$
declare
  w jsonb; s jsonb;
begin
  delete from public.cockpit_sales_alerts;
  update public.cockpit_sales_room_events set handled_at = now() where handled_at is null;
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at, tries, last_try_at)
    values (null, 'zoom.meeting.started', 'zoom', 'lc-test-x12', now() - interval '2 days', 3, now() - interval '2 days');
  s := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('X12 an event the sweep gave up on is marked as given up (handled_at or a gave_up mark)',
    (select handled_at is not null or detail ? 'gave_up' from public.cockpit_sales_room_events where dedupe_key = 'lc-test-x12'));
  w := public.cockpit_sales_watchdog();
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at)
    values (null, 'zoom.meeting.ended', 'zoom', 'lc-test-x12b', now() - interval '11 minutes');
  w := public.cockpit_sales_watchdog();
  perform pg_temp.ck('X12b a new stuck event two days after an old one raises a new alert', (w ->> 'raised')::integer >= 1, w::text);
exception when others then
  perform pg_temp.ck('X12 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- X13. creating: the spec and roomlogic.ts timers give the worker a recover
-- step at claimed + 60 s and fail at claimed + 120 s; the worker only adopts
-- another run's Zoom room after 60 s.
do $$
declare
  r uuid; s jsonb;
begin
  r := pg_temp.room('lc-test-x13', 'lc-test-x13h@example.invalid', 'fallback', 'creating');
  update public.cockpit_sales_rooms set claimed_at = now() - interval '70 seconds' where id = r;
  s := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('X13 a room claimed 70 s ago is left for the worker to recover (fail at 120 s)',
    (select state = 'creating' from public.cockpit_sales_rooms where id = r),
    (select state || ' ' || coalesce(end_reason, '') from public.cockpit_sales_rooms where id = r));
exception when others then
  perform pg_temp.ck('X13 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- X14. The host stepping out (host_in -> open) never shortens host_by
-- (roomlogic.ts: "host_by, lead_by and ends_at only ever move later").
do $$
declare
  r uuid; before_by timestamptz; after_by timestamptz; s jsonb;
begin
  -- A fallback room: host_by was 13 minutes ahead, the lead has 8 minutes left.
  r := pg_temp.room('lc-test-x14', 'lc-test-x14h@example.invalid', 'fallback', 'host_in');
  update public.cockpit_sales_rooms set host_by = now() + interval '13 minutes', lead_by = now() + interval '8 minutes',
                                        link_sent_at = now() - interval '2 minutes' where id = r;
  select host_by into before_by from public.cockpit_sales_rooms where id = r;
  update public.cockpit_sales_rooms set state = 'open' where id = r;
  select host_by into after_by from public.cockpit_sales_rooms where id = r;
  perform pg_temp.ck('X14 a fallback host stepping out keeps the host_by they had', after_by >= before_by,
    format('host_by moved from +%s to +%s', before_by - now(), after_by - now()));
  -- The same write as roomlogic.ts makes it: host_by sent unchanged (laterIso kept the old value).
  r := pg_temp.room('lc-test-x14b', 'lc-test-x14h2@example.invalid', 'booked', 'host_in', 'intro', 'lc-test-appt-x14b');
  update public.cockpit_sales_rooms set host_by = now() + interval '14 minutes', lead_by = now() + interval '19 minutes' where id = r;
  select host_by into before_by from public.cockpit_sales_rooms where id = r;
  update public.cockpit_sales_rooms set state = 'open', host_by = before_by where id = r;
  select host_by into after_by from public.cockpit_sales_rooms where id = r;
  perform pg_temp.ck('X14b a booked-call host stepping out at the start keeps start + 15 min', after_by >= before_by,
    format('host_by moved from +%s to +%s', before_by - now(), after_by - now()));
exception when others then
  perform pg_temp.ck('X14 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- X15. declined_by is compared with lower-case availability emails.
do $$
declare
  got text;
begin
  got := pg_temp.errm($q$insert into public.cockpit_sales_live (request_id, contact_id, asked_by, kind, reason, offered_to, declined_by, offer_until)
                         values (gen_random_uuid(), 'lc-test-x15', 'lc-test-xsetter@example.invalid', 'demo', 'on_call',
                                 '{lc-test-x15@example.invalid}', '{LC-Test-X15@Example.invalid}', now() + interval '2 minutes')$q$);
  perform pg_temp.ck('X15 a mixed-case email in declined_by is refused, as in offered_to (23514)', got like '23514%', got);
exception when others then
  perform pg_temp.ck('X15 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- Integration pass (contract-v2.md section 2, the defects found at merge
-- that no lane's own tests spanned). Each states what the other lanes do.

-- X16. The door writes open_device phone, tablet or computer (door.ts
-- OPEN_DEVICES), and roomlogic.ts reads the same three.
do $$
declare
  r uuid; got text;
begin
  r := pg_temp.room('lc-test-x16', 'lc-test-x16h@example.invalid', 'fallback', 'open');
  got := pg_temp.errm(format($q$update public.cockpit_sales_rooms set first_open_at = now(), open_device = 'computer'
                                 where id = %L and first_open_at is null$q$, r));
  perform pg_temp.ck('X16 a computer''s first open is written with its device', got = 'none'
    and (select open_device = 'computer' and version = 1 from public.cockpit_sales_rooms where id = r), got);
  got := pg_temp.errm(format($q$update public.cockpit_sales_rooms set open_device = 'phone' where id = %L$q$, r));
  perform pg_temp.ck('X16b a later open from another device keeps the first device read',
    got = 'none' and (select open_device = 'computer' from public.cockpit_sales_rooms where id = r), got);
  r := pg_temp.room('lc-test-x16c', 'lc-test-x16h2@example.invalid', 'fallback', 'open');
  got := pg_temp.errm(format($q$update public.cockpit_sales_rooms set open_device = 'desktop' where id = %L$q$, r));
  perform pg_temp.ck('X16c a device name outside the three is refused, never stored', got like '23514%', got);
exception when others then
  perform pg_temp.ck('X16 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- X17. Columns other lanes write: roomlogic.ts (link_claimed_at,
-- count_undo_at), the message service (link_unconfirmed_at), and the desk
-- (wave, member and meta columns, member state closed).
do $$
declare
  r uuid; w uuid; f uuid; got text;
begin
  r := pg_temp.room('lc-test-x17', 'lc-test-x17h@example.invalid', 'fallback', 'host_in');
  got := pg_temp.errm(format($q$update public.cockpit_sales_rooms set link_claimed_at = now() where id = %L and link_claimed_at is null$q$, r));
  perform pg_temp.ck('X17 sales-api claims the link (link_claimed_at) in a guarded write', got = 'none', got);
  got := pg_temp.errm(format($q$update public.cockpit_sales_rooms set link_unconfirmed_at = now(), count_undo_at = now() where id = %L$q$, r));
  perform pg_temp.ck('X17b link_unconfirmed_at and count_undo_at are columns', got = 'none', got);
  insert into public.cockpit_sales_followup_waves (pool, state, made_by) values ('never_booked', 'running', 'lc-test') returning id into w;
  got := pg_temp.errm(format($q$update public.cockpit_sales_followup_waves set enrolled_at = now(), done_reason = 'x', settled_at = null
                                 where id = %L$q$, w));
  perform pg_temp.ck('X17c the desk''s wave columns (enrolled_at, done_reason, settled_at)', got = 'none', got);
  insert into public.cockpit_sales_followup_wave_members (wave_id, contact_id, arm, state) values (w, 'lc-test-x17m', 'wave', 'waiting');
  got := pg_temp.errm(format($q$update public.cockpit_sales_followup_wave_members
                                 set next_try_at = now(), later_reason = 'x', fail_count = 1, last_error = 'x', due_at = now(),
                                     replied_at = now(), booked_at = now(), closed_at = now()
                                 where wave_id = %L$q$, w));
  perform pg_temp.ck('X17d the desk''s member columns', got = 'none', got);
  got := pg_temp.errm(format($q$update public.cockpit_sales_followup_wave_members set state = 'closed' where wave_id = %L$q$, w));
  perform pg_temp.ck('X17e the desk''s 14-day close (member state closed)', got = 'none', got);
  insert into public.cockpit_sales_followups (contact_id, segment, channel, body, why)
    values ('lc-test-x17f', 'reactivate', 'whatsapp_template', 'Hi.', 'Test.') returning id into f;
  insert into public.cockpit_sales_followup_meta (followup_id, kind_key, wave_id) values (f, 'reactivate.en.whatsapp_template', w);
  got := pg_temp.errm(format($q$update public.cockpit_sales_followup_meta set send_after = null, held_by = 'sales-desk', held_at = now(),
                                 hold_reason = 'x' where followup_id = %L and held_by is null$q$, f));
  perform pg_temp.ck('X17f the desk sets a refused opener aside (hold_reason)', got = 'none', got);
exception when others then
  perform pg_temp.ck('X17 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- X18. A lead who reopens the link every 2 minutes cannot hold a room until
-- the backstop: the open grace stops at the link + lead + open_grace.
do $$
declare
  r uuid; s jsonb;
begin
  r := pg_temp.room('lc-test-x18', 'lc-test-x18h@example.invalid', 'fallback', 'host_in');
  update public.cockpit_sales_rooms
     set link_sent_at = now() - interval '25 minutes', first_open_at = now() - interval '24 minutes',
         last_open_at = now() - interval '2 minutes', lead_by = now() - interval '12 minutes'
   where id = r;
  s := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('X18 a lead reopening the link 25 minutes on: the room closes (no join), not held for 30 minutes more',
    (select state = 'expired' and result = 'no_join' from public.cockpit_sales_rooms where id = r),
    (select state || ' ' || coalesce(end_reason, '') from public.cockpit_sales_rooms where id = r));
exception when others then
  perform pg_temp.ck('X18 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- X19. A knock the door stored but could not forward: the sweep replays it,
-- and holds the room's timer meanwhile (at most 300 s past due), so the lead
-- is not closed out while their knock is on its way.
do $$
declare
  r uuid; e uuid; s jsonb;
begin
  r := pg_temp.room('lc-test-x19', 'lc-test-x19h@example.invalid', 'fallback', 'host_in');
  update public.cockpit_sales_rooms set lead_by = now() - interval '1 minute' where id = r;
  insert into public.cockpit_sales_room_events (room_id, kind, source, dedupe_key, at)
    values (r, 'zoom.meeting.participant_joined_waiting_room', 'zoom', 'lc-test-x19-knock', now() - interval '40 seconds')
    returning id into e;
  s := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('X19 the unforwarded knock is replayed to room.event',
    (s -> 'replay') ? e::text, (s -> 'replay')::text);
  perform pg_temp.ck('X19b and the room is not closed while it waits',
    (select state = 'host_in' from public.cockpit_sales_rooms where id = r),
    (select state || ' ' || coalesce(end_reason, '') from public.cockpit_sales_rooms where id = r));
  update public.cockpit_sales_rooms set lead_by = now() - interval '6 minutes' where id = r;
  s := public.cockpit_sales_rooms_sweep();
  perform pg_temp.ck('X19c the hold ends 300 s past due: the room closes even if room.event never handles it',
    (select state = 'expired' from public.cockpit_sales_rooms where id = r),
    (select state from public.cockpit_sales_rooms where id = r));
exception when others then
  perform pg_temp.ck('X19 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- X20. The settle path reaches the cron door in a body it passes on
-- (sales-live cron.ts: room.event sweep.settle or tick, 1 to 50 room ids),
-- for the room roomlogic.ts settleDue settles: the setter's fallback room for
-- a booked intro, never a booked room.
do $$
declare
  fb uuid; bk uuid; r jsonb; max_id bigint; made boolean := false;
begin
  update public.cockpit_sales_room_events set handled_at = now() where handled_at is null;
  update public.cockpit_sales_rooms set state = 'cancelled' where state in ('requested', 'creating', 'open', 'host_in', 'lead_in');
  update public.cockpit_sales_rooms set lead_in_at = lead_in_at - interval '2 hours' where lead_in_at > now() - interval '1 hour';
  update public.cockpit_sales_rooms set count_undo_at = count_undo_at - interval '2 hours' where count_undo_at > now() - interval '1 hour';
  if not exists (select 1 from vault.secrets where name = 'cockpit_sync_secret') then
    perform vault.create_secret('lc-test-not-a-real-secret', 'cockpit_sync_secret', 'lc-db test, rolled back');
    made := true;
  end if;
  insert into public.cockpit_sales_appointments (appointment_id, contact_id, call_type, status, assigned_user_id, start_at, origin) values
    ('lc-test-appt-x20a', 'lc-test-x20a', 'intro', 'confirmed', 'lc-test-ghl-x20a', now() - interval '25 minutes', 'ghl'),
    ('lc-test-appt-x20b', 'lc-test-x20b', 'intro', 'confirmed', 'lc-test-ghl-x20b', now() - interval '25 minutes', 'ghl');
  fb := pg_temp.room('lc-test-x20a', 'lc-test-x20ah@example.invalid', 'fallback', 'open');
  -- Made a minute after the intro's start (20261003d: a room settles only the intro it was made for).
  update public.cockpit_sales_rooms set appointment_id = 'lc-test-appt-x20a', host_by = now() - interval '1 minute',
                                        requested_at = now() - interval '24 minutes' where id = fb;
  bk := pg_temp.room('lc-test-x20b', 'lc-test-x20bh@example.invalid', 'booked', 'open', 'intro', 'lc-test-appt-x20b');
  update public.cockpit_sales_rooms set host_by = now() - interval '1 minute' where id = bk;
  select coalesce(max(q.id), 0) into max_id from net.http_request_queue as q;
  r := public.cockpit_sales_rooms_tick();
  perform pg_temp.ck('X20 the fallback room for a booked intro is posted as room.event sweep.settle with its room id only',
    exists (select 1 from net.http_request_queue as q
             where q.id > max_id and q.url = 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/cron'
               and convert_from(q.body, 'utf8')::jsonb = jsonb_build_object('action', 'room.event', 'kind', 'sweep.settle',
                     'payload', jsonb_build_object('room_ids', to_jsonb(array[fb::text])))),
    r::text);
  perform pg_temp.ck('X20b a booked room is never posted to settle (roomlogic.ts settleDue refuses it)',
    not exists (select 1 from public.cockpit_sales_room_events where dedupe_key = 'sweep.settle:' || bk::text));
  perform pg_temp.ck('X20c every body the tick posts is one the cron door forwards (room.event: sweep.replay, sweep.settle or tick; 1 to 50 ids)',
    (select bool_and(b ->> 'action' = 'room.event'
                     and b ->> 'kind' in ('sweep.replay', 'sweep.settle', 'tick')
                     and jsonb_array_length(coalesce(b #> '{payload,room_ids}', b #> '{payload,event_ids}')) between 1 and 50)
       from (select convert_from(q.body, 'utf8')::jsonb as b from net.http_request_queue as q
              where q.id > max_id and q.url = 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/cron') as x),
    case when made then 'a test secret was made for this run' end);
exception when others then
  perform pg_temp.ck('X20 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- X21. Presence agrees with roomlogic.ts presenceOf and defaultProvider
-- (contract-v2 S5), the three cases where the two disagreed at merge.
do $$
declare
  rooms_v jsonb;
begin
  insert into public.cockpit_sales_people (email, name, role, active) values
    ('lc-test-x21a@example.invalid', 'Test', 'closer', true),
    ('lc-test-x21b@example.invalid', 'Test', 'closer', true),
    ('lc-test-x21c@example.invalid', 'Test', 'setter', true),
    ('lc-test-x21d@example.invalid', 'Test', 'closer', true);
  insert into public.cockpit_sales_availability (email, state, until) values
    ('lc-test-x21a@example.invalid', 'available', now() - interval '1 minute'),
    ('lc-test-x21b@example.invalid', 'available', now() + interval '1 hour');
  perform pg_temp.room(null, 'lc-test-x21a@example.invalid', 'standby', 'host_in', 'demo');
  perform pg_temp.room(null, 'lc-test-x21b@example.invalid', 'standby', 'host_in', 'demo');
  insert into public.cockpit_sales_room_hosts (email, zoom_live_until, zoom_status, google_ok)
    values ('lc-test-x21b@example.invalid', now() + interval '10 minutes', 'licensed', true),
           ('lc-test-x21d@example.invalid', null, 'pending', true);
  perform pg_temp.room('lc-test-x21c-lead', 'lc-test-x21c@example.invalid', 'fallback', 'open');
  perform pg_temp.ck('X21 a closer still in the standby room after Available ran out is not ready (no offers)',
    (select state = 'away' from public.cockpit_sales_presence where email = 'lc-test-x21a@example.invalid'));
  perform pg_temp.ck('X21b the host''s own open Zoom room is not "a live Zoom meeting": still ready',
    (select state = 'ready' from public.cockpit_sales_presence where email = 'lc-test-x21b@example.invalid'));
  perform pg_temp.ck('X21c a host whose room waits for its lead is on_call',
    (select state = 'on_call' from public.cockpit_sales_presence where email = 'lc-test-x21c@example.invalid'));
  select value into rooms_v from public.cockpit_sales_settings where key = 'rooms';
  update public.cockpit_sales_settings set value = jsonb_set(value, '{providers}', '{"zoom": true, "meet": true}') where key = 'rooms';
  perform pg_temp.ck('X21d a closer with a pending Zoom seat is offered Meet by default',
    (select default_provider = 'meet' from public.cockpit_sales_presence where email = 'lc-test-x21d@example.invalid'));
  update public.cockpit_sales_settings set value = rooms_v where key = 'rooms';
exception when others then
  perform pg_temp.ck('X21 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

-- X22. A wave a manager stops keeps its held-back members for the desk, so
-- the wave-versus-holdout comparison is not left with an empty holdout.
do $$
declare
  w uuid;
begin
  insert into public.cockpit_sales_followup_waves (pool, state, made_by) values ('good_intro', 'running', 'lc-test') returning id into w;
  insert into public.cockpit_sales_followup_wave_members (wave_id, contact_id, arm, state, due_at) values
    (w, 'lc-test-x22a', 'holdout', 'held_out', now() - interval '1 day'),
    (w, 'lc-test-x22b', 'wave', 'drafted', null);
  update public.cockpit_sales_followup_waves set state = 'done', done_reason = 'Stopped by a manager.' where id = w;
  perform pg_temp.ck('X22 the held-back member whose 14 days started is still watched (held_out), not closed by the database',
    (select state = 'held_out' from public.cockpit_sales_followup_wave_members where wave_id = w and contact_id = 'lc-test-x22a'));
  perform pg_temp.ck('X22b a drafted member stays drafted, so the desk finds and takes back its open opener',
    (select state = 'drafted' from public.cockpit_sales_followup_wave_members where wave_id = w and contact_id = 'lc-test-x22b'));
exception when others then
  perform pg_temp.ck('X22 section crashed', false, sqlstate || ': ' || sqlerrm);
end;
$$;

select name, ok, detail from pg_temp.lc_checks order by n;
