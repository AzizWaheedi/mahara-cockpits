-- Pitch links for the live training, 2026-09-23.
--
-- The tracking brief: "CTA link clicks: one distinct booking URL per pitch so
-- we know which pitch converted. This is the single highest-value thing on
-- this list." webinar.maharamedia.com/p1 and /p2 (sites/webinar/p1.html,
-- p2.html) record the click and open the booking page with
-- utm_content=pitch1 or pitch2, which HighLevel keeps on whoever books. So
-- the page events gain one page, `pitch`, and one event, `pitch_click`.

begin;

alter table public.cockpit_webinar_page_events
  drop constraint if exists cockpit_webinar_page_events_page_check,
  drop constraint if exists cockpit_webinar_page_events_event_check;
alter table public.cockpit_webinar_page_events
  add constraint cockpit_webinar_page_events_page_check
    check (page in ('landing', 'thank_you', 'live', 'pitch')),
  add constraint cockpit_webinar_page_events_event_check
    check (event in (
      'page_view', 'page_leave', 'scroll', 'cta_click',
      'form_view', 'form_focus', 'form_submit',
      'video_play', 'video_progress',
      'calendar_add', 'whatsapp_click',
      'survey_start', 'survey_submit', 'join_click', 'pitch_click'));

commit;
