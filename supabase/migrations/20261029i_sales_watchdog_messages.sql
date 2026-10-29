-- The watchdog watches the Messages copy too (sales-conversations/sync):
-- a run older than ten minutes, or one that says it failed, raises the same
-- alert the other sales workers do. The function is the live one as read on
-- 2026-10-29 (md5 ccc0ea69aefb167cd8339014cb21f4ae) with that one row added.

CREATE OR REPLACE FUNCTION public.cockpit_sales_watchdog()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '10s'
AS $function$
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
        -- Messages (20261029d): the copy of HighLevel's conversations, every minute.
        ('sales-conversations', 'sync', 10, 'The Messages copy',
           'New lead messages are not reaching the cockpit''s Messages page. Read them in HighLevel meanwhile.', null),
        ('sales-live', 'zoom',  null::integer, 'The Zoom webhook',
           'Zoom joins and leaves may not reach the rooms, so reps press I''m in and The lead is in themselves.',
           coalesce((rooms -> 'enabled') = 'true'::jsonb, false)),
        ('sales-live', 'slack', null::integer, 'The Slack buttons',
           'Presses on live offers in Slack may not work. Take offers from the cockpit.',
           coalesce((live -> 'enabled') = 'true'::jsonb, false) and coalesce((live -> 'slack') = 'true'::jsonb, false)),
        -- The short link's routes only while messages carry it (m1 round 2,
        -- watchdog-alerts-short-link-routes-while-off): rooms on and
        -- rooms.short_link on, as the guardian and the Team page read it.
        ('sales-live', 'open',  null::integer, 'The short link page',
           'Leads may not be able to open their room links. Send them the room''s full link.',
           coalesce((rooms -> 'enabled') = 'true'::jsonb, false) and coalesce((rooms -> 'short_link') = 'true'::jsonb, false)),
        ('sales-live', 'go',    null::integer, 'The short link',
           'Leads may not reach their room from the short link. Send them the room''s full link.',
           coalesce((rooms -> 'enabled') = 'true'::jsonb, false) and coalesce((rooms -> 'short_link') = 'true'::jsonb, false)),
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
    -- The host check's row: the sentences that name what it found first (a
    -- refused sign-in, a report it could not read), so the cut never keeps
    -- only the lines that say all is well (m1 round 4,
    -- host-check-ran-said-as-not-being-checked).
    words := rtrim(public.cockpit_sales_alert_words(
      case when subj = 'sales-desk/room-hosts' and rec.ok is false then
        coalesce(nullif(array_to_string(array(
          select btrim(x) || '.'
            from regexp_split_to_table(coalesce(rec.detail, ''), '[.]\s+') with ordinality as p(x, n)
           where x ~* '(refused|cannot|could not|did not answer|not ready|failed)'
           order by n), ' '), ''), rec.detail)
      else rec.detail end, case when subj = 'sales-desk/room-hosts' then 240 else 160 end), '.!? ');

    raised := raised + public.cockpit_sales_alert_set('missing:' || subj, is_missing, 'missing', subj,
      format('%s has never reported. %s', rec.label, rec.effect),
      jsonb_build_object('worker', rec.worker, 'job', rec.job));
    raised := raised + public.cockpit_sales_alert_set('stale:' || subj, is_stale, 'stale', subj,
      format('%s has not run since %s. %s', rec.label, since, rec.effect),
      jsonb_build_object('worker', rec.worker, 'job', rec.job, 'last_at', rec.at, 'stale_min', rec.stale_min));
    -- The room worker's row that says it is running and making rooms (a
    -- fault it rode out, a refused room message) never says rooms cannot be
    -- made (m1 round 3, watchdog-says-rooms-cannot-be-made-while-worker-
    -- makes-them): only a stale row, or one that says "Not making rooms:".
    raised := raised + public.cockpit_sales_alert_set('failing:' || subj, is_failing, 'failing', subj,
      format('%s reported a problem at %s: %s. %s', rec.label, since, coalesce(nullif(words, ''), 'no detail'),
             case when subj = 'sales-desk/rooms' and coalesce(rec.detail, '') not like 'Not making rooms:%'
                  then 'Some rooms or links may fail; read the detail.'
                  -- The host check ran (its row is fresh): seats and sign-ins
                  -- were checked, and the detail says what needs attention;
                  -- "not being checked" is for a missing or stale row only.
                  when subj = 'sales-desk/room-hosts'
                  then 'Read the detail: a seat''s Zoom or the Google sign-in needs attention.'
                  else rec.effect end),
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

  -- 2d0. A room's "booked call is near" alert is over once the room has
  -- closed (m1 round 2, booked-guard-alert-p2-words-never-resolved): nobody
  -- is in it or waiting any more. Resolved at once, never three days on.
  update public.cockpit_sales_alerts as a
     set resolved_at = t,
         dedupe_key = a.dedupe_key || ':resolved:' || a.id::text
    from public.cockpit_sales_rooms as r
   where a.resolved_at is null
     and a.dedupe_key like 'room:%:booked_guard:%'
     and a.dedupe_key not like '%:resolved:%'
     and r.id::text = split_part(a.dedupe_key, ':', 2)
     and r.state in ('ended', 'expired', 'failed', 'cancelled');

  -- 2d. Per-room alerts nobody resolved (final review): a room's mark-intro,
  -- count, undo, showed, lost-event and held alerts are a person's to act
  -- on, and sales-api answers some itself (a rep's mark, a count that
  -- settled). The rest are resolved here three days after they were raised
  -- once posted (a week when they never could be), so the open count on the
  -- Team page stops only growing. Resolved keys are never raised again (2c).
  -- The host check's Zoom report alert (room_report:{room}) is one of them
  -- (m1 numbers round 1): nothing else resolves it, and the host check reads
  -- each room's report once, within a day of its end, so it never comes back.
  update public.cockpit_sales_alerts as a
     set resolved_at = t,
         dedupe_key = a.dedupe_key || ':resolved:' || a.id::text
   where a.resolved_at is null
     and (a.dedupe_key like 'room:%' or a.dedupe_key like 'room_event_lost:%' or a.dedupe_key like 'room_held:%'
          or a.dedupe_key like 'room_report:%')
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

  -- Open alerts with no webhook reach nobody (m1 round 5,
  -- m1-numbers-r5-team-page-watchdog-green-while-recorded-only): the row is
  -- red and says what to add, never ok beside alerts nobody is told of.
  insert into public.cockpit_sales_worker_status (worker, job, ok, detail, at)
  values ('sales-api', 'watchdog', unanswered = 0 and refused = 0 and not (hook is null and open_n > 0),
          case when unanswered > 0
               then format('pg_net did not answer %s Slack %s in 3 minutes, so alerts may not reach #sales-alerts. Run select %s.worker_restart(); in the SQL editor. %s open alerts.',
                           unanswered, case when unanswered = 1 then 'post' else 'posts' end, 'net', open_n)
               when refused > 0
               then format('Slack refused the #sales-alerts webhook (it answered %s to %s %s), so alerts are not reaching the channel. Put a working incoming webhook for #sales-alerts in the vault as sales_alerts_slack_webhook. %s open alerts.',
                           refused_status, refused, case when refused = 1 then 'alert' else 'alerts' end, open_n)
               when hook is null and open_n > 0
               then format('%s open alerts, %s new, %s posted. Recorded only: the vault has no sales_alerts_slack_webhook, so they reach nobody. Put a working incoming webhook for #sales-alerts in the vault as sales_alerts_slack_webhook.',
                           open_n, raised, posted)
               else format('%s open alerts, %s new, %s posted.%s', open_n, raised, posted, coalesce(' ' || note, '')) end, t)
  on conflict (worker, job) do update
     set ok = excluded.ok, detail = excluded.detail, at = excluded.at;

  return jsonb_build_object('at', t, 'in_hours', in_hours, 'open', open_n, 'raised', raised,
                            'posted', posted, 'webhook', hook is not null, 'note', note);
end;
$function$;
