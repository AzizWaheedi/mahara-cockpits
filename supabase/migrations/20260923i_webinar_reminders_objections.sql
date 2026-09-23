-- Reminder messages and sales-call objections for the webinar funnel,
-- 2026-09-23.
--
-- Aziz, 2026-09-23: "the scripts that you can do now, do it". Two more of
-- the tracking brief's metrics, both read by hermes/webinar-pull:
--
-- 1. cockpit_webinar_messages: every message HighLevel sent a webinar
--    registrant after they registered (WhatsApp, SMS, email), with the
--    status HighLevel holds (sent, delivered, read, failed) and, when the
--    text matches one of the WEBBY templates, which reminder it was. Read
--    from HighLevel's conversations API; the body is not stored.
-- 2. cockpit_webinar_objections: the objections a registrant raised on a
--    sales call, tagged from the Fathom transcript by deepseek-flash into a
--    fixed set of categories, with the prospect's own words. The brief:
--    "tagged from the Fathom transcript, not from the closer's notes".
--
-- Service key only, like every cockpit_ table.

begin;

create table if not exists public.cockpit_webinar_messages (
  message_id   text primary key,
  contact_id   text not null,
  channel      text not null check (channel in ('whatsapp', 'sms', 'email', 'other')),
  direction    text not null,
  status       text,
  source       text,
  -- The WEBBY template it matched (webby_05_one_hour ...), null otherwise.
  step         text,
  sent_at      timestamptz not null,
  updated_at   timestamptz,
  pulled_at    timestamptz not null default now()
);
comment on table public.cockpit_webinar_messages is
  'Outbound HighLevel messages to webinar registrants since they registered: channel, status (sent, delivered, read, failed), and the WEBBY template step when the text matches. No message text is stored.';
create index if not exists cockpit_webinar_messages_contact
  on public.cockpit_webinar_messages (contact_id, sent_at);

create table if not exists public.cockpit_webinar_objections (
  call_id      text primary key,
  contact_id   text,
  email        text,
  call_at      timestamptz,
  title        text,
  duration_s   integer,
  categories   text[] not null default '{}',
  objections   jsonb not null default '[]'::jsonb,
  summary      text,
  model        text,
  tagged_at    timestamptz not null default now()
);
comment on table public.cockpit_webinar_objections is
  'Sales calls with webinar registrants (Fathom recordings), tagged once: the objections raised, each with a category, the prospect''s words and whether the rep answered it. categories is the distinct list, for counting.';
create index if not exists cockpit_webinar_objections_contact
  on public.cockpit_webinar_objections (contact_id);

alter table public.cockpit_webinar_pulls drop constraint if exists cockpit_webinar_pulls_source_check;
alter table public.cockpit_webinar_pulls
  add constraint cockpit_webinar_pulls_source_check
  check (source in ('zoom', 'typeform', 'reminders', 'objections'));

alter table public.cockpit_webinar_messages   enable row level security;
alter table public.cockpit_webinar_objections enable row level security;
revoke all on public.cockpit_webinar_messages   from anon, authenticated;
revoke all on public.cockpit_webinar_objections from anon, authenticated;
grant all on public.cockpit_webinar_messages   to service_role;
grant all on public.cockpit_webinar_objections to service_role;

commit;
