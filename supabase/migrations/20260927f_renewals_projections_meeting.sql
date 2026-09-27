-- Renewals & Re-sell Projections: the Sunday meeting that replaces CSM Daily's
-- Sunday sitting (the CEO's brief, 2026-09-27).
--
-- a) team_meetings.embed: which client success panel a meeting's page shows,
--    read live from the client success cockpit through the bridge:
--    'cs-projections' (the week's strip and the renewal window) or 'cs-daily'
--    (the hardest renewal for Tuesday's role play, the gold-standard count).
-- b) The meeting: Sunday 13:00 to 13:30 Kuwait, the CEO in the chair and the
--    CSM required. Its people are CSM Daily's, taken by their part there
--    (host, required), never by name.
-- c) Its run of show, the spec's six lines, 30 minutes.
-- d) CSM Daily: its Monday to Thursday theme blocks as the brief words them;
--    Sunday's theme block goes (its detail is kept in the change log), and
--    its days become Monday to Thursday, Supabase first, as the page's own
--    "change the series" does.
-- e) Two changes for Google Calendar, queued in team_calendar_ops the way the
--    page queues them: CSM Daily's Sunday series ends on 3 October (ended,
--    never deleted; the other four days are left exactly as they are), and
--    the new meeting's series is made from Sunday 4 October. The cockpit's
--    minute drain sends them once its calendar sign-in is set, and reads the
--    result back from Google.
-- f) Every step is in team_changes, by 'renewals setup'.
--
-- Roles only, no names. Idempotent: a second run adds nothing.

-- a) ----------------------------------------------------------------------------
alter table public.team_meetings add column if not exists embed text;
alter table public.team_meetings drop constraint if exists team_meetings_embed_check;
alter table public.team_meetings
  add constraint team_meetings_embed_check
  check (embed is null or embed in ('cs-projections', 'cs-daily'));

drop table if exists pg_temp.rp_log;
create temporary table rp_log (meeting_id text, what text, detail jsonb);

-- b) ----------------------------------------------------------------------------
with made as (
  insert into public.team_meetings (
    id, title, purpose, cadence, department, host_id, active, managed,
    created_by, tz, start_time, minutes, weekdays, embed, doc, doc_by, doc_at
  )
  select
    'renewals-resell-projections',
    'Renewals & Re-sell Projections',
    'The CSM''s Sunday with the CEO: last week''s projections against the actuals, every client in the renewal window planned, and this week''s blood and stretch.',
    'weekly',
    null,
    (select mp.person_id from public.team_meeting_people mp
      where mp.meeting_id = 'csm-daily' and mp.part = 'host' and not mp.removed
      order by mp.changed_at nulls last limit 1),
    true,
    'cockpit',
    'renewals setup',
    'Asia/Kuwait',
    '13:00',
    30,
    '{0}',
    'cs-projections',
    E'Who attends: the CEO chairs; the CSM is required.\n\nIt takes the place of CSM Daily''s Sunday sitting.\n\nThe week''s strip and the renewal window on this page are the client success cockpit''s Projections screen, live: change them here or there.\n\nNo row leaves the renewal window without a call date or a not-this-cycle reason.',
    'renewals setup',
    now()
  where not exists (
    select 1 from public.team_meetings where id = 'renewals-resell-projections'
  )
  returning id, title
)
insert into rp_log
select id, format('made the meeting "%s": Sundays, 13:00 to 13:30, Kuwait time', title),
       jsonb_build_object('replaces', 'CSM Daily on Sundays')
  from made;

with added as (
  insert into public.team_meeting_people (meeting_id, person_id, part, source, changed_by, changed_at)
  select 'renewals-resell-projections', mp.person_id, mp.part, 'cockpit', 'renewals setup', now()
    from public.team_meeting_people mp
   where mp.meeting_id = 'csm-daily'
     and not mp.removed
     and mp.part in ('host', 'required')
     and not exists (
       select 1 from public.team_meeting_people x
        where x.meeting_id = 'renewals-resell-projections' and x.person_id = mp.person_id
     )
  returning part
)
insert into rp_log
select 'renewals-resell-projections',
       format('put CSM Daily''s people in it: %s', string_agg(part, ', ' order by part)),
       jsonb_build_object('parts', jsonb_agg(part))
  from added
having count(*) > 0;

-- c) ----------------------------------------------------------------------------
drop table if exists pg_temp.rp_blocks;
create temporary table rp_blocks (position integer, minutes integer, title text, detail text);
insert into rp_blocks values
(1, 2, 'Win', null),
(2, 5, 'Last week blood/stretch/actual per metric', 'Re-sells, renewals, cash, reviews and referrals. Every miss gets its why.'),
(3, 12, 'Renewal window row by row', 'No row leaves without a call date or a not-this-cycle reason.'),
(4, 6, 'This week''s projections', 'Blood and stretch per metric.'),
(5, 3, 'One big thing', 'The training gap for the week.'),
(6, 2, 'Recap', null);

with added as (
  insert into public.team_meeting_blocks (meeting_id, weekday, position, minutes, title, detail, updated_by)
  select 'renewals-resell-projections', null, b.position, b.minutes, b.title, b.detail, 'renewals setup'
    from rp_blocks b
   where not exists (
     select 1 from public.team_meeting_blocks x where x.meeting_id = 'renewals-resell-projections'
   )
  returning 1
)
insert into rp_log
select 'renewals-resell-projections', format('set the run of show (%s blocks, 30 minutes)', count(*)), null
  from added
having count(*) > 0;

-- d) ----------------------------------------------------------------------------
drop table if exists pg_temp.rp_themes;
create temporary table rp_themes (weekday smallint, title text, detail text);
insert into rp_themes values
(1, 'Onboarding call review', 'Did we set the next-step-after-first-win precedent?'),
(2, 'Role play', 'Spin the CSM role-play wheel; the scenario is the hardest row on this week''s renewal window, shown on this page.'),
(3, 'Strategy: this week''s one big thing', null),
(4, 'Re-sell & renewal call review', 'Against the gold-standard library, then projection vs actual. The prize wheel only if the blood goal was hit.');

-- Only blocks still as the v5 setup left them: an edit made on the page since wins.
with changed as (
  update public.team_meeting_blocks b
     set title = t.title,
         detail = t.detail,
         updated_by = 'renewals setup',
         updated_at = now()
    from rp_themes t
   where b.meeting_id = 'csm-daily'
     and b.weekday = t.weekday
     and b.position = 5
     and b.updated_by = 'v5 setup'
  returning b.weekday, b.title
)
insert into rp_log
select 'csm-daily',
       format('set the theme of the day: %s', string_agg(title, '; ' order by weekday)),
       null
  from changed
having count(*) > 0;

with gone as (
  delete from public.team_meeting_blocks b
   where b.meeting_id = 'csm-daily'
     and b.weekday = 0
     and b.updated_by = 'v5 setup'
  returning b.title, b.detail, b.minutes
)
insert into rp_log
select 'csm-daily',
       'took Sunday''s theme block off: Sundays are Renewals & Re-sell Projections now',
       jsonb_build_object('was', jsonb_agg(jsonb_build_object('title', title, 'detail', detail, 'minutes', minutes)))
  from gone
having count(*) > 0;

update public.team_meetings
   set embed = 'cs-daily', updated_at = now()
 where id = 'csm-daily' and embed is null;

with moved as (
  update public.team_meetings
     set weekdays = '{1,2,3,4}', managed = 'cockpit', updated_at = now()
   where id = 'csm-daily' and weekdays = '{0,1,2,3,4}'
  returning id, start_time, minutes
)
insert into rp_log
select id,
       'set the series to Mon to Thu, from 2026-10-04: Sunday''s sitting is now Renewals & Re-sell Projections',
       jsonb_build_object('before', jsonb_build_object('weekdays', '[0,1,2,3,4]'::jsonb))
  from moved;

-- e) ----------------------------------------------------------------------------
with queued as (
  insert into public.team_calendar_ops (meeting_id, op, payload, requested_by)
  select v.meeting_id, v.op, v.payload, 'renewals setup'
    from (values
      ('csm-daily', 'series',
       jsonb_build_object('weekdays', '[1,2,3,4]'::jsonb, 'startTime', '13:00', 'minutes', 30, 'from', '2026-10-04')),
      ('renewals-resell-projections', 'create',
       jsonb_build_object('from', '2026-10-04'))
    ) as v(meeting_id, op, payload)
   where exists (select 1 from public.team_meetings m where m.id = v.meeting_id)
     and not exists (
       select 1 from public.team_calendar_ops o
        where o.meeting_id = v.meeting_id and o.op = v.op and o.requested_by = 'renewals setup'
     )
  returning meeting_id, op
)
insert into rp_log
select meeting_id,
       case op
         when 'series' then 'queued for Google Calendar: end the Sunday series on 3 Oct, the other days unchanged'
         else 'queued for Google Calendar: the Sunday series from 4 Oct, with its people as guests'
       end,
       null
  from queued;

-- f) ----------------------------------------------------------------------------
insert into public.team_changes (by_whom, meeting_id, what, detail)
select 'renewals setup', meeting_id, what, detail from rp_log;

drop table if exists pg_temp.rp_log, pg_temp.rp_blocks, pg_temp.rp_themes;
