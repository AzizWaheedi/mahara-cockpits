-- Team meetings v5, 2026-09-27: the weekly meeting system, managed from the
-- cockpit and kept in step with Google Calendar both ways.
--
-- The CEO's brief: every meeting with its purpose, a timed run of show, the
-- creative pipeline and the wheels, and the Team section as the place the
-- meetings are managed. A change made on a meeting's page reaches the real
-- Google Calendar event within seconds (convex/teamCalendar.ts), and a change
-- made in Google Calendar shows up in the cockpit within five minutes
-- (hermes/team-sync, every five minutes).
--
-- Adds to 20260922b_team_meetings.sql and 20260923d_team_meetings_screen.sql:
--
-- a) team_meetings: the Google Calendar series it is linked to and the
--    series itself (days, start, length, recurrence, Meet link). Google is
--    the truth for times and guests; the page writes through to it.
-- b) team_sittings: real start and end times, the Google instance, whether
--    it was moved or cancelled, and whether that week's goal was hit.
-- d) team_meeting_blocks: the fixed run of show. team_agenda stays what it
--    is, the one-off items that carry from one sitting to the next.
-- e) team_wheels, team_wheel_options, team_wheel_spins: the wheels. An option
--    label may hold {amount}; the CEO changes the number, never the sentence.
-- f) team_creative_rows: the creative pipeline, one row per video.
-- g) team_calendar_ops: every change bound for Google Calendar, so none is
--    lost when Google is slow or down.
-- h) The five meetings, their run of show and their wheels, seeded from the
--    spec, by role and never by name. Idempotent: a second run adds nothing.
--
-- Also, from the check of the team section's backend on the same day:
--
-- i) team_recordings. The editor desk's Fathom job (hermes/editor-desk,
--    desk.py meetings) wrote Fathom recordings into team_meetings, a table
--    with a different shape, and failed every hour with PGRST204; the
--    editor cockpit's Meetings page read the same table and found nothing.
--    Fathom recordings get their own table, read by the people on the invite.
-- j) The team tables are the service key's alone. They still carried the
--    default grants to anon and authenticated, and a policy let any seated
--    browser user write them directly, around the server's checks and the
--    change log. Only the cockpit's backend writes them; the browser never
--    did (the editor page's read moves to team_recordings above).

-- a) The meeting's calendar link and series ----------------------------------

alter table public.team_meetings
  add column if not exists cal_calendar  text,
  add column if not exists cal_event_id  text,
  add column if not exists cal_etag      text,
  add column if not exists tz            text not null default 'Asia/Kuwait',
  add column if not exists start_time    time,
  add column if not exists minutes       integer,
  add column if not exists weekdays      smallint[],
  add column if not exists rrule         text,
  add column if not exists ends_on       date,
  add column if not exists meet_link     text,
  add column if not exists cal_writable  boolean not null default false,
  add column if not exists cal_synced_at timestamptz,
  add column if not exists cal_error     text,
  -- The event's title when it was last read from Google. A title that
  -- differs from it was renamed in Google; one that matches it and differs
  -- from ours was renamed here and is on its way there.
  add column if not exists cal_title     text,
  -- Which pipeline view the meeting shows: the editable board (the creative
  -- call) or the read-only strip (the whole-team meeting).
  add column if not exists pipeline      text;

alter table public.team_meetings drop constraint if exists team_meetings_minutes_check;
alter table public.team_meetings
  add constraint team_meetings_minutes_check check (minutes is null or minutes between 5 and 480);
alter table public.team_meetings drop constraint if exists team_meetings_weekdays_check;
alter table public.team_meetings
  add constraint team_meetings_weekdays_check
  check (weekdays is null or weekdays <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]);
alter table public.team_meetings drop constraint if exists team_meetings_pipeline_check;
alter table public.team_meetings
  add constraint team_meetings_pipeline_check check (pipeline is null or pipeline in ('board', 'strip'));

-- calendar_id stays for backward compatibility. It held the recurring master
-- id (or a single event's id), which is what cal_event_id is. Two meetings
-- can hold the same one: a single sitting renamed in Google became a second
-- meeting under the old title-keyed sync. Only the meeting that sat on it
-- most recently takes the link; the other is left for the deactivation rule.
update public.team_meetings m
   set cal_event_id = m.calendar_id
 where m.cal_event_id is null
   and m.calendar_id is not null
   and not exists (
     select 1
       from public.team_meetings o
      where o.calendar_id = m.calendar_id
        and o.id <> m.id
        and coalesce((select max(s.on_date) from public.team_sittings s where s.meeting_id = o.id), date '1900-01-01')
          > coalesce((select max(s.on_date) from public.team_sittings s where s.meeting_id = m.id), date '1900-01-01')
   );

create unique index if not exists team_meetings_series
  on public.team_meetings (cal_calendar, cal_event_id)
  where cal_calendar is not null and cal_event_id is not null;
create index if not exists team_meetings_event on public.team_meetings (cal_event_id);

-- The Google optional flag a person had when the calendar was last read, so
-- the sync can tell a change made in Google from a part chosen on the page.
alter table public.team_meeting_people
  add column if not exists cal_optional boolean;

-- b) Sittings get real times ---------------------------------------------------

alter table public.team_sittings
  add column if not exists starts_at       timestamptz,
  add column if not exists ends_at         timestamptz,
  add column if not exists cal_instance_id text,
  add column if not exists status          text not null default 'scheduled',
  add column if not exists goal_hit        boolean;
alter table public.team_sittings drop constraint if exists team_sittings_status_check;
alter table public.team_sittings
  add constraint team_sittings_status_check check (status in ('scheduled', 'moved', 'cancelled'));
create index if not exists team_sittings_starts on public.team_sittings (starts_at);
create index if not exists team_sittings_instance on public.team_sittings (cal_instance_id);

-- d) The run of show -----------------------------------------------------------

create table if not exists public.team_meeting_blocks (
  id          bigserial primary key,
  meeting_id  text not null references public.team_meetings (id) on delete cascade,
  -- 0 = Sunday ... 6 = Saturday; null = every sitting.
  weekday     smallint check (weekday is null or weekday between 0 and 6),
  position    integer not null default 0,
  minutes     integer check (minutes is null or minutes between 0 and 480),
  title       text not null check (length(btrim(title)) > 0),
  detail      text,
  updated_by  text,
  updated_at  timestamptz not null default now()
);
create index if not exists team_meeting_blocks_meeting
  on public.team_meeting_blocks (meeting_id, weekday, position);

-- e) Wheels ------------------------------------------------------------------------

create table if not exists public.team_wheels (
  id                 text primary key,
  meeting_id         text references public.team_meetings (id) on delete set null,
  name               text not null check (length(btrim(name)) > 0),
  kind               text not null check (kind in ('scenario', 'person', 'prize')),
  source_url         text,
  locked_until_goal  boolean not null default false,
  active             boolean not null default true,
  position           integer not null default 0,
  updated_by         text,
  updated_at         timestamptz not null default now()
);
create index if not exists team_wheels_meeting on public.team_wheels (meeting_id, position);

create table if not exists public.team_wheel_options (
  id             bigserial primary key,
  wheel_id       text not null references public.team_wheels (id) on delete cascade,
  -- May hold {amount}: "{amount} bonus" with 100 USD reads "$100 bonus",
  -- "{amount} commission bump" with 10 and "%" reads "10% commission bump".
  label          text not null check (length(btrim(label)) > 0),
  amount         numeric(12, 2) check (amount is null or amount >= 0),
  currency       text,
  amount_suffix  text,
  condition      text,
  active         boolean not null default true,
  position       integer not null default 0,
  updated_by     text,
  updated_at     timestamptz not null default now()
);
create index if not exists team_wheel_options_wheel on public.team_wheel_options (wheel_id, position);

create table if not exists public.team_wheel_spins (
  id            bigserial primary key,
  wheel_id      text not null references public.team_wheels (id) on delete cascade,
  sitting_id    text references public.team_sittings (id) on delete cascade,
  option_id     bigint,
  -- The label as it read when the wheel landed, amount and all.
  result_label  text not null,
  spun_by       text,
  spun_for      text,
  at            timestamptz not null default now()
);
create index if not exists team_wheel_spins_wheel on public.team_wheel_spins (wheel_id, at desc);
create index if not exists team_wheel_spins_sitting on public.team_wheel_spins (sitting_id);

-- f) The creative pipeline -----------------------------------------------------

create table if not exists public.team_creative_rows (
  id                   bigserial primary key,
  client               text not null check (length(btrim(client)) > 0),
  angle                text,
  kind                 text check (kind is null or kind in ('new', 'refresh', 'edit')),
  source               text check (source is null or source in ('slow_client_call', 'creative_request', 'fatigue', 'other')),
  creative_request_id  text,
  script_due           date,
  footage_due          date,
  edit_due             date,
  approved_on          date,
  launch_on            date,
  launched_on          date,
  status               text not null default 'planned'
    check (status in ('planned', 'scripting', 'footage', 'editing', 'review', 'approved', 'launched', 'cut')),
  owner_id             text references public.team_people (id) on delete set null,
  -- Raised by the server when a due date that has already passed is moved.
  slip_count           integer not null default 0 check (slip_count >= 0),
  notes                text,
  created_by           text,
  created_at           timestamptz not null default now(),
  updated_by           text,
  updated_at           timestamptz not null default now()
);
create index if not exists team_creative_rows_launch on public.team_creative_rows (launch_on);
create index if not exists team_creative_rows_request on public.team_creative_rows (creative_request_id);

-- g) Changes on their way to Google Calendar -----------------------------------

create table if not exists public.team_calendar_ops (
  id            bigserial primary key,
  meeting_id    text,
  sitting_id    text,
  op            text not null,
  payload       jsonb,
  status        text not null default 'pending' check (status in ('pending', 'done', 'failed')),
  attempts      integer not null default 0,
  error         text,
  requested_by  text,
  at            timestamptz not null default now(),
  -- When an attempt last started, so the minute cron does not start a
  -- second one while the first is still talking to Google.
  tried_at      timestamptz,
  done_at       timestamptz
);
create index if not exists team_calendar_ops_pending
  on public.team_calendar_ops (meeting_id, id) where status = 'pending';
create index if not exists team_calendar_ops_meeting on public.team_calendar_ops (meeting_id, at desc);

-- i) Fathom recordings of team meetings, for the editor cockpit -----------------

create table if not exists public.team_recordings (
  recording_id    text primary key,
  title           text,
  started_at      timestamptz,
  ended_at        timestamptz,
  url             text,
  share_url       text,
  host            text,
  invitees        jsonb,
  invitee_emails  jsonb,
  summary_md      text,
  action_items    jsonb,
  language        text,
  synced_at       timestamptz
);
create index if not exists team_recordings_started on public.team_recordings (started_at desc);

alter table public.team_recordings enable row level security;
revoke all on public.team_recordings from anon, authenticated;
grant select on public.team_recordings to authenticated;
grant all on public.team_recordings to service_role;
-- An internal call can carry pay, performance or a disagreement about
-- somebody: being on the editor list is not a reason to read a meeting you
-- were not on.
drop policy if exists team_recordings_invited on public.team_recordings;
create policy team_recordings_invited on public.team_recordings
  for select to authenticated
  using (
    public.is_editor()
    and invitee_emails ? lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- Security for the new team tables, and j) for the old ones --------------------

alter table public.team_meeting_blocks enable row level security;
alter table public.team_wheels enable row level security;
alter table public.team_wheel_options enable row level security;
alter table public.team_wheel_spins enable row level security;
alter table public.team_creative_rows enable row level security;
alter table public.team_calendar_ops enable row level security;

drop policy if exists team_meetings_all on public.team_meetings;
drop policy if exists team_people_select on public.team_people;
drop policy if exists team_meeting_people_all on public.team_meeting_people;
drop policy if exists team_sittings_all on public.team_sittings;
drop policy if exists team_agenda_all on public.team_agenda;
drop policy if exists team_changes_all on public.team_changes;

revoke all on
  public.team_people, public.team_meetings, public.team_meeting_people,
  public.team_sittings, public.team_agenda, public.team_changes,
  public.team_meeting_blocks, public.team_wheels, public.team_wheel_options,
  public.team_wheel_spins, public.team_creative_rows, public.team_calendar_ops
  from anon, authenticated;
grant all on
  public.team_people, public.team_meetings, public.team_meeting_people,
  public.team_sittings, public.team_agenda, public.team_changes,
  public.team_meeting_blocks, public.team_wheels, public.team_wheel_options,
  public.team_wheel_spins, public.team_creative_rows, public.team_calendar_ops
  to service_role;

revoke all on sequence
  public.team_agenda_id_seq, public.team_changes_id_seq,
  public.team_meeting_blocks_id_seq, public.team_wheel_options_id_seq,
  public.team_wheel_spins_id_seq, public.team_creative_rows_id_seq,
  public.team_calendar_ops_id_seq
  from anon, authenticated;
grant usage, select on sequence
  public.team_agenda_id_seq, public.team_changes_id_seq,
  public.team_meeting_blocks_id_seq, public.team_wheel_options_id_seq,
  public.team_wheel_spins_id_seq, public.team_creative_rows_id_seq,
  public.team_calendar_ops_id_seq
  to service_role;

-- h) The seed: the five meetings of the spec -------------------------------------
--
-- Roles only. People come from the linked calendar event or are picked on
-- the page; the chair and the rest of who attends, by role, open each
-- meeting's doc. The whole-team meeting keeps its row and its history when
-- the calendar already brought it in (whole-team-vision-projections).

drop table if exists pg_temp.v5_meetings, pg_temp.v5_log, pg_temp.v5_blocks, pg_temp.v5_options;
create temporary table v5_meetings (
  id text, title text, cadence text, purpose text, start_time time,
  minutes integer, weekdays smallint[], pipeline text, doc text
);

insert into v5_meetings values
('whole-team', 'Whole Team', 'weekly',
 'Last week''s scoreboard, the creative pipeline and this week''s one company priority, so everyone leaves knowing who owns what by when.',
 '13:00', 30, '{6}', 'strip',
 E'Who attends: the CEO chairs; the whole team.\n\nPre-read, posted Friday: the CSM’s client board status, the media buyer’s weekly numbers, the creative lead’s pipeline board.\n\nA pipeline row that slips twice is raised here, on Saturday.'),
('csm-daily', 'CSM Daily', 'daily',
 'The CSM''s daily check with the CEO: one win, the fires, the client board and the projection against the 4 Rs.',
 '13:00', 20, '{0,1,2,3,4}', null,
 E'Who attends: the CEO and the CSM.\n\nThe spine is the same every day; the last seven minutes are the theme of the day.'),
('slow-client-call', 'Slow Client Call', 'twice a week',
 'Up to three clients whose results are slow: what breaks, and the action, owner and due date that fixes it.',
 '13:30', 30, '{0,4}', null,
 E'Who attends: the CSM chairs; the media buyer, the CEO, systems and the creative lead.\n\nSystems joins to make delivery faster: they leave each call with at least one automation or tooling fix, or nothing.\n\nCreative fixes found here go on Tuesday’s Creative Call as a “video needed” row with the date the client needs it live, not solved live.'),
('creative-call', 'Creative Call', 'weekly',
 'Plan next week''s videos and check this week''s: every video is a row on the pipeline with its dates, its owner and a launch date.',
 '13:30', 30, '{2}', 'board',
 E'Who attends: the creative lead chairs; the editors, the media buyer, the CEO and systems. The CSM by exception, for client creative feedback.\n\nSystems joins to make delivery faster: they leave each call with at least one automation or tooling fix, or nothing.\n\nWho owns each field of a row\n- Client + angle + type (new / refresh / edit): the creative lead, from the three inputs below\n- Script due: the creative lead\n- Footage due (shoot or client footage): the creative lead; the CSM chases client footage\n- Edit due (first cut): the editors\n- Approved (on the Tuesday call or async): the creative lead\n- Launch date: the media buyer\n\nWhere “videos needed” comes from, every week\n- Creative fixes raised on Sunday and Thursday Slow Client Calls (never solved live there, they land here)\n- Open creative requests in the Cockpit (more ads, new angle, fatigue, edit visuals)\n- The media buyer’s fatigue list: ads past the refresh window (7-10 days) or with CPL rising\n\nDefault weekly rhythm (confirm on the first call)\n- Tue: Creative Call locks next week’s video list and every date\n- Wed-Thu: scripts written; client footage requested the same day\n- Sun: scripts approved, shoot or footage in\n- Sun-Tue: edit, first cuts ready for the Tuesday call\n- Tue: approve / rework / cut on the call\n- Within 48h of approval: media buyer launches, launch date logged on the row\n\nRule: a video with no launch date is not planned. A row that slips twice is escalated on Saturday’s Whole Team.\n\nThe separate weekly video-quality meeting retires into this call.'),
('call-center', 'Call Center', 'three times a week',
 'The call-center agents'' week: Sunday kickoff and call review, Tuesday role play on the wheel, Thursday wrap and the prize wheel when the team hits its goal.',
 '14:00', 25, '{0,2,4}', null,
 E'Who attends: the CEO and the call-center agents.\n\nThe prize wheel is earned: the top booker spins it on Thursday only if the team hit its weekly goal.');

-- The whole-team meeting keeps the row the calendar brought in, if there is one.
update v5_meetings
   set id = 'whole-team-vision-projections'
 where id = 'whole-team'
   and exists (select 1 from public.team_meetings where id = 'whole-team-vision-projections');

create temporary table v5_log (meeting_id text, what text, detail jsonb);

-- New meetings. One that exists already is left as it is.
with made as (
  insert into public.team_meetings
    (id, title, purpose, cadence, active, managed, created_by, start_time,
     minutes, weekdays, tz, pipeline, doc, doc_by, doc_at, doc_version, updated_at)
  select id, title, purpose, cadence, true, 'cockpit', 'v5 setup', start_time,
         minutes, weekdays, 'Asia/Kuwait', pipeline, doc, 'v5 setup', now(), 1, now()
    from v5_meetings
  on conflict (id) do nothing
  returning id, title
)
insert into v5_log select id, format('set up "%s" from the v5 spec', title), null from made;

-- The existing whole-team row: the spec's title, time and purpose, once.
with fixed as (
  update public.team_meetings t
     set title = v.title,
         purpose = v.purpose,
         cadence = v.cadence,
         start_time = v.start_time,
         minutes = v.minutes,
         weekdays = v.weekdays,
         pipeline = v.pipeline,
         managed = 'cockpit',
         active = true,
         doc = case when coalesce(t.doc, '') = '' then v.doc else t.doc end,
         doc_by = case when coalesce(t.doc, '') = '' then 'v5 setup' else t.doc_by end,
         doc_at = case when coalesce(t.doc, '') = '' then now() else t.doc_at end,
         doc_version = case when coalesce(t.doc, '') = '' then t.doc_version + 1 else t.doc_version end,
         updated_at = now()
    from v5_meetings v
   where t.id = v.id
     and t.id = 'whole-team-vision-projections'
     and not exists (
       select 1 from public.team_changes c
        where c.meeting_id = t.id and c.by_whom = 'v5 setup'
     )
  returning t.id, t.title
)
insert into v5_log select id, format('set up "%s" from the v5 spec', title), null from fixed;

-- Run of show: every agenda line of the spec is one block, same order,
-- minutes and wording. A meeting that already has blocks keeps its own.
create temporary table v5_blocks (
  meeting_id text, weekday smallint, position integer, minutes integer, title text, detail text
);

insert into v5_blocks values
-- Whole Team, Sat 13:00-13:30.
('whole-team', null, 1, 3, 'Wins round', 'one each, personal counts'),
('whole-team', null, 2, 7, 'Last week scoreboard', 'active clients, clients green/amber/red, qualified appts booked, churn/renewals'),
('whole-team', null, 3, 3, 'Creative pipeline', 'videos launched last week vs planned, this week’s launches, anything slipped twice'),
('whole-team', null, 4, 8, 'This week’s ONE company priority, owner, finish line', null),
('whole-team', null, 5, 5, 'Cross-team dependencies and announcements', null),
('whole-team', null, 6, 4, 'Recap: who owns what by when', null),
('whole-team', null, 7, null, 'Pre-read, posted Friday', 'CSM’s client board status, media buyer’s weekly numbers, creative lead’s pipeline board.'),
-- CSM Daily, Sun-Thu 13:00-13:20: the fixed spine, then the theme of the day.
('csm-daily', null, 1, 2, 'Win', 'client, testimonial, upsell, personal'),
('csm-daily', null, 2, 5, 'Fires, solutions only, max 2 clients', 'Anything bigger goes to the next Slow Client Call.'),
('csm-daily', null, 3, 3, 'Board check', 'every client’s status + last touchpoint current'),
('csm-daily', null, 4, 3, 'Projection vs actual', '4 Rs: retain, re-sell, review, refer'),
('csm-daily', 0, 5, 7, 'Projections', 'set blood + stretch for the week on the 4 Rs; review the week’s check-ins, launches, onboardings'),
('csm-daily', 1, 5, 7, 'Game Tape', 'review one recorded client call against the coaching log'),
('csm-daily', 2, 5, 7, 'Role Play', 'spin the CSM role-play wheel; the hardest conversation coming up this week (upsell, renewal, bad-results call)'),
('csm-daily', 3, 5, 7, 'Strategy', 'one training topic (upsell timing, review ask, referral ask, onboarding gate)'),
('csm-daily', 4, 5, 7, 'Wrap', 'projection vs reality, why, one change for next week. The CSM spins the CSM prize wheel only if the week’s goal was hit'),
-- Slow Client Call, Sun + Thu 13:30-14:00.
('slow-client-call', null, 1, 2, 'Last call’s actions', 'done / not done'),
('slow-client-call', null, 2, 24, 'Max 3 clients, ~8m each', 'CSM shows stats and where it breaks, media buyer on campaign changes, CEO on what the agents hear from the leads, systems on any tracking/automation/funnel cause. Decide action, owner, due date'),
('slow-client-call', null, 3, 4, 'Recap + ClickUp tasks', null),
('slow-client-call', null, 4, null, 'Creative fixes found here go on Tuesday’s Creative Call as a “video needed” row with the date the client needs it live, not solved live', null),
-- Creative Call, Tue 13:30-14:00.
('creative-call', null, 1, 3, 'This week’s rows: launched / slipped', 'Every slip gets a new date and a reason'),
('creative-call', null, 2, 4, 'Media buyer', 'which creatives won and lost last week by CPL, and what’s fatiguing'),
('creative-call', null, 3, 6, 'Videos needed next week', 'go through the three inputs (Slow Client Call fixes, open creative requests, fatigue list). Each becomes a row: client, angle, type'),
('creative-call', null, 4, 5, 'Dates for every new row', 'script due, footage due, edit due, launch date. Owner on each'),
('creative-call', null, 5, 8, 'Watch 2 real first cuts together', 'Decide approve / rework / cut. Editing notes on the spot: hook, pacing, captions, B-roll, length. Approved ones get a launch date now'),
('creative-call', null, 6, 2, 'Production bottlenecks', 'what slowed scripting, footage or editing this week. Systems owns any fix that’s a tool or template'),
('creative-call', null, 7, 2, 'Owners + dates into ClickUp', null),
-- Call Center, 14:00-14:25: one line a day.
('call-center', 0, 1, null, 'Kickoff', 'last week vs projection, set blood + stretch per agent, review 1 real call against the coaching log'),
('call-center', 2, 1, null, 'Role Play', '2m wins. Spin the scenario wheel, spin the name wheel for who plays the agent, CEO plays the lead. 2 rounds, 8m each with 2m feedback. Log the scenario and the fix in the sitting notes'),
('call-center', 4, 1, null, 'Wrap', 'projection vs reality, leaderboard. Top booker spins the prize wheel only if the team hit its weekly goal. The wheel is earned');

update v5_blocks
   set meeting_id = 'whole-team-vision-projections'
 where meeting_id = 'whole-team'
   and exists (select 1 from v5_meetings where id = 'whole-team-vision-projections');

with added as (
  insert into public.team_meeting_blocks (meeting_id, weekday, position, minutes, title, detail, updated_by)
  select b.meeting_id, b.weekday, b.position, b.minutes, b.title, b.detail, 'v5 setup'
    from v5_blocks b
   where not exists (select 1 from public.team_meeting_blocks x where x.meeting_id = b.meeting_id)
  returning meeting_id
)
insert into v5_log
select meeting_id, format('set the run of show (%s blocks)', count(*)), null
  from added group by meeting_id;

-- Wheels: exactly as the spec, amounts in USD, thresholds as the condition.
-- Both prize wheels are earned. Name wheels have no options: they are filled
-- from the sitting's attendees when they spin.
with made as (
  insert into public.team_wheels (id, meeting_id, name, kind, source_url, locked_until_goal, active, position, updated_by)
  values
    ('csr-role-play', 'call-center', 'CSR role play', 'scenario', 'https://pickerwheel.com/pw?id=WSaUT', false, true, 1, 'v5 setup'),
    ('call-center-names', 'call-center', 'Name wheel', 'person', null, false, true, 2, 'v5 setup'),
    ('csr-prize', 'call-center', 'CSR prize', 'prize', 'https://pickerwheel.com/pw?id=i87d3', true, true, 3, 'v5 setup'),
    ('csm-role-play', 'csm-daily', 'CSM role play', 'scenario', 'https://pickerwheel.com/pw?id=N2fVW', false, true, 1, 'v5 setup'),
    ('csm-daily-names', 'csm-daily', 'Name wheel', 'person', null, false, true, 2, 'v5 setup'),
    ('csm-prize', 'csm-daily', 'CSM prize', 'prize', 'https://pickerwheel.com/pw?id=a4bXU', true, true, 3, 'v5 setup')
  on conflict (id) do nothing
  returning id, meeting_id, name
)
insert into v5_log select meeting_id, format('added the %s wheel', name), jsonb_build_object('wheel', id) from made;

create temporary table v5_options (
  wheel_id text, position integer, label text, amount numeric, currency text, amount_suffix text, condition text
);

insert into v5_options values
('csr-role-play', 1, 'New Inquiry', null, null, null, null),
('csr-role-play', 2, 'Price Shopper', null, null, null, null),
('csr-role-play', 3, 'Objection-Heavy Call', null, null, null, null),
('csr-role-play', 4, 'Emotional Lead', null, null, null, null),
('csr-role-play', 5, '“I Need to Think About It”', null, null, null, null),
('csr-role-play', 6, 'It’s Ramadan', null, null, null, null),
('csr-role-play', 7, 'I prefer a virtual meeting', null, null, null, null),
('csr-role-play', 8, 'I’m busy Thursday', null, null, null, null),
('csr-prize', 1, '{amount} commission increase for 24h', 2.50, 'USD', null, null),
('csr-prize', 2, '{amount} bonus', 100, 'USD', null, '7+ appts on 3+ days'),
('csr-prize', 3, '{amount} bonus', 150, 'USD', null, '10+ appts'),
('csr-prize', 4, '{amount} bonus', 250, 'USD', null, '12+ appts'),
('csr-prize', 5, 'Spin again', null, null, null, null),
('csr-prize', 6, 'Team dare', null, null, null, null),
('csm-role-play', 1, 'Upsell', null, null, null, null),
('csm-role-play', 2, 'Renewal', null, null, null, null),
('csm-role-play', 3, 'Bad-results call', null, null, null, null),
('csm-prize', 1, '{amount} commission bump', 10, null, '%', null),
('csm-prize', 2, 'Spin again', null, null, null, null),
('csm-prize', 3, 'Exec dare', null, null, null, null),
('csm-prize', 4, '{amount} bonus', 500, 'USD', null, 'on an upsell worth 500+');

with added as (
  insert into public.team_wheel_options (wheel_id, label, amount, currency, amount_suffix, condition, active, position, updated_by)
  select o.wheel_id, o.label, o.amount, o.currency, o.amount_suffix, o.condition, true, o.position, 'v5 setup'
    from v5_options o
   where exists (select 1 from public.team_wheels w where w.id = o.wheel_id)
     and not exists (select 1 from public.team_wheel_options x where x.wheel_id = o.wheel_id)
  returning wheel_id
)
insert into v5_log
select w.meeting_id, format('set the options of the %s wheel (%s)', w.name, count(*)), jsonb_build_object('wheel', w.id)
  from added a join public.team_wheels w on w.id = a.wheel_id
 group by w.meeting_id, w.name, w.id;

insert into public.team_changes (by_whom, meeting_id, what, detail)
select 'v5 setup', meeting_id, what, detail from v5_log;

drop table if exists pg_temp.v5_meetings, pg_temp.v5_log, pg_temp.v5_blocks, pg_temp.v5_options;
