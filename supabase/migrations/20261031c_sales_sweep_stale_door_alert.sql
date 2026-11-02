-- 31 Oct 2026: the room sweep resolves a stale "door refused" alert by itself.
-- The sweep resolved sweep:door_refused only when a later post was answered.
-- With no rooms, it posts nothing, so a 404 from 7 Oct 03:13 (sales-live was
-- deployed at 12:59 that day) stayed open 24 days, kept the sweep row red and
-- made the watchdog raise failing:sales-api/sweep. Now a quiet minute with no
-- refused or unanswered post left in cockpit_sales_room_posts (which keeps one
-- day) resolves it; the next refused post raises it again.
-- Base: live pg_proc md5 ade88a604d8b493e88515f99cfc6704a, equal to the body in
-- 20261003d_live_calls_hardening.sql. Muhammed approved, 31 Oct 2026.

CREATE OR REPLACE FUNCTION public.cockpit_sales_rooms_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  silent integer := 0;
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
      returning p.status_code, p.error, true as heard
    ),
    lost as (
      update public.cockpit_sales_room_posts as p
         set checked_at = now(), error = 'no answer'
       where p.checked_at is null and p.posted_at < now() - interval '3 minutes'
      returning p.status_code, p.error, false as heard
    ),
    seen as (select * from ans union all select * from lost)
    -- An answer that refused the post is the door's; a post pg_net never
    -- answered at all is pg_net's own silence (its worker stopped, as after a
    -- database restart), never blamed on the door (fix round 4).
    select count(*) filter (where s.heard and (s.status_code is null or s.status_code not between 200 and 299)),
           count(*) filter (where s.heard),
           count(*) filter (where not s.heard),
           string_agg(distinct coalesce(s.status_code::text, s.error), ', ')
                filter (where s.heard and (s.status_code is null or s.status_code not between 200 and 299))
      into bad, answered, silent, last_code
      from seen as s;
    delete from public.cockpit_sales_room_posts as p where p.posted_at < now() - interval '1 day';
    if silent > 0 and answered = 0 then
      -- (The command is put together here, so this text never names pg_net's
      -- schema itself: the stress harnesses copy these functions and swap it.)
      door_note := left(format('%s of the sweep''s calls to sales-live/cron got no answer from pg_net in 3 minutes, so replays, settles and re-checks are not going out. pg_net''s worker may have stopped: run select %s.worker_restart(); in the SQL editor.',
                               silent, 'net'), 500);
      update public.cockpit_sales_worker_status as s
         set ok = false, detail = door_note
       where s.worker = 'sales-api' and s.job = 'sweep';
      perform public.cockpit_sales_alert_set('sweep:pg_net_silent', true, 'pg_net', 'sales-api/sweep', door_note,
        jsonb_build_object('unanswered', silent));
    elsif answered > 0 then
      perform public.cockpit_sales_alert_set('sweep:pg_net_silent', false, 'pg_net', 'sales-api/sweep', '', '{}'::jsonb);
    end if;
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
    elsif not exists (select 1 from public.cockpit_sales_room_posts as p
                       where p.status_code is null or p.status_code not between 200 and 299) then
      -- No refused or unanswered post is left in the day this table keeps, so
      -- an open door alert has nothing behind it: resolve it. The next refused
      -- post raises it again. (31 Oct 2026: a 404 from 7 Oct, before sales-live
      -- was deployed, stayed open 24 days because no room had work to post.)
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
$function$
;

revoke all on function public.cockpit_sales_rooms_tick() from public, anon, authenticated;
grant execute on function public.cockpit_sales_rooms_tick() to service_role;
