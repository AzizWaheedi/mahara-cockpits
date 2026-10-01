-- Team meetings: a doc like a Google Doc, pictures in it, and each meeting's
-- links (the CEO, 2026-09-30: "similar to a Google Doc ... copy and paste
-- images ... bullet points, sizes, headings ... link things that are useful
-- for that like slow clients calls maybe ads management board and diagnosing
-- and fixing constraints ... any meetings that don't have an agenda let me
-- know and tell me what the agenda is").
--
-- a) team_meetings.links: the links a meeting keeps open, [{label, url}].
--    Written by its hosts, admins and the CEO through team.saveLinks
--    (convex/team.ts), each change in team_changes. The table's row security
--    and grants are unchanged: the service role is the only door.
-- b) team-docs: the private bucket the doc's pictures live in. The page signs
--    each one when it reads the doc; nothing in it is public.
-- c) The links each meeting starts with, taken from the links the cockpits
--    already carry (client success csmLinks.ts, creative creativeLinks.ts,
--    the ClickUp lists the cockpits read) and the constraints doc the CEO
--    named. Only a meeting with no links yet gets them.
-- d) The Weekly Video Quality & Feedback Sync had no purpose and no run of
--    show: both, 45 minutes, as its calendar series runs.
-- e) The days the calendar changed on 29-30 September: the Call Center's wrap
--    is on Monday and the Creative Call on Monday, so the Call Center's
--    purpose and the Creative Call's doc say so.
-- f) Every step is in team_changes, by 'team docs setup'.
--
-- Idempotent: a second run changes nothing.

begin;

-- a) ----------------------------------------------------------------------------
alter table public.team_meetings
  add column if not exists links jsonb not null default '[]'::jsonb;
alter table public.team_meetings drop constraint if exists team_meetings_links_check;
alter table public.team_meetings
  add constraint team_meetings_links_check
  check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 30);

-- b) ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-docs', 'team-docs', false, 10485760,
        array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop table if exists pg_temp.td_log;
create temporary table td_log (meeting_id text, what text, detail jsonb);

-- c) ----------------------------------------------------------------------------
with seed (meeting_id, links) as (
  values
  ('slow-client-call', '[
    {"label": "Diagnosing and fixing acquisition constraints", "url": "https://docs.google.com/document/d/1cioKqspTOI6zK76ob0lOTzfNLDMe5WS6NJ_hgTwb-p4/edit"},
    {"label": "Client performance", "url": "https://cockpit.maharamedia.com/client-success/performance"},
    {"label": "Hot list", "url": "https://cockpit.maharamedia.com/client-success/hotlist"},
    {"label": "Ads management board (ClickUp)", "url": "https://app.clickup.com/90182518398/v/li/901817774521"},
    {"label": "Ads management (cockpit)", "url": "https://cockpit.maharamedia.com/ads"},
    {"label": "Client Success board (ClickUp)", "url": "https://app.clickup.com/90182518398/v/li/901816723211"}
  ]'::jsonb),
  ('creative-call', '[
    {"label": "Video Pipeline (ClickUp)", "url": "https://app.clickup.com/90182518398/v/li/901816720767"},
    {"label": "Media / Creative board (ClickUp)", "url": "https://app.clickup.com/90182518398/v/li/901818016338"},
    {"label": "What works", "url": "https://cockpit.maharamedia.com/creative/what-works"},
    {"label": "Video request form", "url": "https://forms.clickup.com/90182518398/f/2kzmr1ky-1058/E1LP6F3OHFC3WACLU8"},
    {"label": "Ads management (cockpit)", "url": "https://cockpit.maharamedia.com/ads"},
    {"label": "Editor desk", "url": "https://cockpit.maharamedia.com/editor/"}
  ]'::jsonb),
  ('csm-daily', '[
    {"label": "Client performance", "url": "https://cockpit.maharamedia.com/client-success/performance"},
    {"label": "Clients & touchpoints", "url": "https://cockpit.maharamedia.com/client-success/clients"},
    {"label": "Projections", "url": "https://cockpit.maharamedia.com/client-success/projections"},
    {"label": "Clients - Mahara (ClickUp)", "url": "https://app.clickup.com/90182518398/v/li/901816559981"},
    {"label": "Client Success board (ClickUp)", "url": "https://app.clickup.com/90182518398/v/li/901816723211"},
    {"label": "Diagnosing and fixing acquisition constraints", "url": "https://docs.google.com/document/d/1cioKqspTOI6zK76ob0lOTzfNLDMe5WS6NJ_hgTwb-p4/edit"},
    {"label": "Client Communication SOP", "url": "https://docs.google.com/document/d/10wQorQfSebiX3Lmh0jXkEUkp3I_xMP68p4b1q-oUxcY/edit"},
    {"label": "Churn tracker 2026", "url": "https://docs.google.com/spreadsheets/d/1p8CAd5pL9zKjc1mZ73Gc_hoj4NSWHfFPs4FoC_WuBUU/edit"}
  ]'::jsonb),
  ('renewals-resell-projections', '[
    {"label": "Projections", "url": "https://cockpit.maharamedia.com/client-success/projections"},
    {"label": "Client performance", "url": "https://cockpit.maharamedia.com/client-success/performance"},
    {"label": "Churn tracker 2026", "url": "https://docs.google.com/spreadsheets/d/1p8CAd5pL9zKjc1mZ73Gc_hoj4NSWHfFPs4FoC_WuBUU/edit"},
    {"label": "Projections calculator", "url": "http://calculator.maharamedia.com"},
    {"label": "Referral programme, how it works", "url": "https://docs.google.com/document/d/15gPXbB98N9TtNqbTa0Ro7O2odcio8XuW0rL-S_qfHcs/edit"},
    {"label": "Clients - Mahara (ClickUp)", "url": "https://app.clickup.com/90182518398/v/li/901816559981"}
  ]'::jsonb),
  ('whole-team-vision-projections', '[
    {"label": "Master Dashboard - Mahara", "url": "https://docs.google.com/spreadsheets/d/1pBEyClUxPLc4-RdXR8gZ0MxsLkLLFkWJwkiVqVf2rro/edit"},
    {"label": "Client performance", "url": "https://cockpit.maharamedia.com/client-success/performance"},
    {"label": "Video Pipeline (ClickUp)", "url": "https://app.clickup.com/90182518398/v/li/901816720767"},
    {"label": "Clients - Mahara (ClickUp)", "url": "https://app.clickup.com/90182518398/v/li/901816559981"}
  ]'::jsonb),
  ('call-center', '[
    {"label": "Sales cockpit", "url": "https://cockpit.maharamedia.com/sales/"},
    {"label": "Sales numbers", "url": "https://cockpit.maharamedia.com/sales/numbers"},
    {"label": "Sales goals", "url": "https://cockpit.maharamedia.com/sales/goals"},
    {"label": "Call recordings", "url": "https://cockpit.maharamedia.com/sales/recordings"}
  ]'::jsonb),
  ('weekly-video-quality-feedback-sync', '[
    {"label": "Editor desk", "url": "https://cockpit.maharamedia.com/editor/"},
    {"label": "Video Pipeline (ClickUp)", "url": "https://app.clickup.com/90182518398/v/li/901816720767"},
    {"label": "What works", "url": "https://cockpit.maharamedia.com/creative/what-works"},
    {"label": "Media / Creative board (ClickUp)", "url": "https://app.clickup.com/90182518398/v/li/901818016338"}
  ]'::jsonb)
),
done as (
  update public.team_meetings m
     set links = s.links, updated_at = now()
    from seed s
   where m.id = s.meeting_id
     and m.links = '[]'::jsonb
  returning m.id, s.links
)
insert into td_log
select id, format('added %s links', jsonb_array_length(links)), jsonb_build_object('links', links)
  from done;

-- d) ----------------------------------------------------------------------------
with done as (
  update public.team_meetings
     set purpose = 'The editors'' weekly look at quality: last week''s client feedback and revisions, finished videos against the checklist, and one standard to raise, so fewer videos go back for changes.',
         updated_at = now()
   where id = 'weekly-video-quality-feedback-sync'
     and (purpose is null or btrim(purpose) = '')
  returning id
)
insert into td_log
select id, 'wrote its purpose', null from done;

drop table if exists pg_temp.vq_blocks;
create temporary table vq_blocks (position int, minutes int, title text, detail text);
insert into vq_blocks values
  (1, 2, 'Win', 'The best video of the week and what made it work.'),
  (2, 10, 'Client feedback and revisions', 'Every revision a client asked for last week: what they asked for, where it came from (brief, script or edit), and whether it is a one-off or a pattern.'),
  (3, 15, 'Watch 2 or 3 finished videos together', 'Against the checklist: the hook in the first 3 seconds, pacing, captions and Arabic spelling, B-roll, sound, branding, length and format.'),
  (4, 5, 'What won on the ads', 'Last week''s winners and losers in What works: what to repeat, what to stop.'),
  (5, 8, 'One standard to raise', 'One change to the editing checklist or a template this week, and who makes it.'),
  (6, 5, 'Recap: owners and dates', 'Every fix goes on the Video Pipeline with an owner and a due date.');

with added as (
  insert into public.team_meeting_blocks (meeting_id, weekday, position, minutes, title, detail, updated_by)
  select 'weekly-video-quality-feedback-sync', null, b.position, b.minutes, b.title, b.detail, 'team docs setup'
    from vq_blocks b
   where exists (select 1 from public.team_meetings m where m.id = 'weekly-video-quality-feedback-sync')
     and not exists (
       select 1 from public.team_meeting_blocks x where x.meeting_id = 'weekly-video-quality-feedback-sync'
     )
  returning 1
)
insert into td_log
select 'weekly-video-quality-feedback-sync', format('set the run of show (%s blocks, 45 minutes)', count(*)), null
  from added
having count(*) > 0;

-- e) ----------------------------------------------------------------------------
with done as (
  update public.team_meetings
     set purpose = 'The call-center agents'' week: Sunday kickoff and call review, Monday wrap and the prize wheel when the team hits its goal, Tuesday role play on the wheel.',
         updated_at = now()
   where id = 'call-center'
     and purpose like '%Thursday wrap%'
  returning id
)
insert into td_log
select id, 'the purpose says the wrap is on Monday, the day the calendar has it', null from done;

with before as (
  select id, doc from public.team_meetings where id = 'creative-call'
),
done as (
  update public.team_meetings m
     set doc = replace(replace(replace(replace(replace(m.doc,
               'Approved (on the Tuesday call or async)', 'Approved (on the Monday call or async)'),
               'raised on Sunday and Thursday Slow Client Calls', 'raised on Sunday and Tuesday Slow Client Calls'),
               '- Tue: Creative Call locks', '- Mon: Creative Call locks'),
               '- Sun-Tue: edit, first cuts ready for the Tuesday call', '- Sun-Mon: edit, first cuts ready for the Monday call'),
               '- Tue: approve / rework / cut on the call', '- Mon: approve / rework / cut on the call'),
         doc_version = m.doc_version + 1,
         doc_by = 'team docs setup',
         doc_at = now()
    from before b
   where m.id = b.id
     and m.doc is not null
     and m.doc <> replace(replace(replace(replace(replace(m.doc,
               'Approved (on the Tuesday call or async)', 'Approved (on the Monday call or async)'),
               'raised on Sunday and Thursday Slow Client Calls', 'raised on Sunday and Tuesday Slow Client Calls'),
               '- Tue: Creative Call locks', '- Mon: Creative Call locks'),
               '- Sun-Tue: edit, first cuts ready for the Tuesday call', '- Sun-Mon: edit, first cuts ready for the Monday call'),
               '- Tue: approve / rework / cut on the call', '- Mon: approve / rework / cut on the call')
  returning m.id, b.doc
)
insert into td_log
select id, 'the doc says the call is on Monday and the Slow Client Calls on Sunday and Tuesday',
       jsonb_build_object('before', doc)
  from done;

-- f) ----------------------------------------------------------------------------
insert into public.team_changes (by_whom, meeting_id, what, detail)
select 'team docs setup', meeting_id, what, detail from td_log;

notify pgrst, 'reload schema';

commit;
