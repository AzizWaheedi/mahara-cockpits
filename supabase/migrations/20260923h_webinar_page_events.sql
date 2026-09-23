-- The live training's page events, 2026-09-23.
--
-- Aziz, 2026-09-23: "for all the metrics for the landing pages and the
-- scripts that you can do now, do it". The tracking brief (6 August 2026):
-- "Landing page (Vercel) events: page views, form submits, and CTA link
-- clicks. Fired client-side to a Supabase edge function. This is our source
-- of truth for traffic volume and on-page conversion."
--
-- webinar.maharamedia.com (sites/webinar in the repo) loads /mm-track.js,
-- which sends small events to the Edge Function `webinar-events` in this
-- project; the function checks every field and writes here with the service
-- key. No names, emails, phones or IP addresses: a random visitor id kept in
-- the browser, a session that ends after 30 idle minutes, and where the
-- visit came from (utm_*).
--
-- The CEO cockpit's webinar section counts only rows whose origin_host is
-- the live site, so a test from a preview or from localhost never counts.

begin;

create table if not exists public.cockpit_webinar_page_events (
  id             bigserial primary key,
  -- Made in the browser, so a retried send is written once.
  event_id       text not null unique,
  -- The server's clock; client_at is the browser's, kept for reference.
  at             timestamptz not null default now(),
  client_at      timestamptz,
  origin_host    text not null,
  page           text not null check (page in ('landing', 'thank_you', 'live')),
  event          text not null check (event in (
                   'page_view', 'page_leave', 'scroll', 'cta_click',
                   'form_view', 'form_focus', 'form_submit',
                   'video_play', 'video_progress',
                   'calendar_add', 'whatsapp_click',
                   'survey_start', 'survey_submit', 'join_click')),
  visitor_id     text not null,
  session_id     text not null,
  label          text,
  value          numeric,
  utm_source     text,
  utm_medium     text,
  utm_campaign   text,
  utm_content    text,
  utm_term       text,
  has_fbclid     boolean not null default false,
  referrer_host  text,
  lang           text,
  device         text,
  path           text
);
comment on table public.cockpit_webinar_page_events is
  'Page events from webinar.maharamedia.com (landing, thank-you, /live), written by the Edge Function webinar-events. No personal data; visitor_id is a random id kept in the browser.';
create index if not exists cockpit_webinar_page_events_at
  on public.cockpit_webinar_page_events (at);
create index if not exists cockpit_webinar_page_events_kind
  on public.cockpit_webinar_page_events (page, event, at);
create index if not exists cockpit_webinar_page_events_ad
  on public.cockpit_webinar_page_events (utm_content) where utm_content is not null;

alter table public.cockpit_webinar_page_events enable row level security;
revoke all on public.cockpit_webinar_page_events from anon, authenticated;
revoke all on sequence public.cockpit_webinar_page_events_id_seq from anon, authenticated;
grant all on public.cockpit_webinar_page_events to service_role;
grant usage, select on sequence public.cockpit_webinar_page_events_id_seq to service_role;

commit;
