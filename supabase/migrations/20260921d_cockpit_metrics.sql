-- Every CEO cockpit number, in Supabase, in a shape any LLM can read
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive.
--
-- Aziz, 2026-09-21: "all these sources of truth should pull into Supabase as
-- the number one thing and be formatted really cleanly in a table that any
-- LLM would be able to understand. The whole thing should pull into
-- Supabase."
--
-- Three tables, written by every refresh of the CEO cockpit:
--   cockpit_sections            the whole prepared payload of each section, as jsonb
--   cockpit_metric_definitions  one row per metric: what it is, in plain words, where it comes from, what it leaves out
--   cockpit_metric_values       one row per metric, scope, window and day: the number
-- A reader joins values to definitions on `metric`. Scope is "company" or
-- "client:<clickup task id>" or "person:<name>"; window names the days the
-- value covers (today, yesterday, last7, mtd, lastMonth, last30, last90,
-- 12m, all, snapshot).

begin;

create table if not exists public.cockpit_sections (
  key          text primary key,
  label        text not null,
  ok           boolean not null default true,
  error        text,
  computed_at  timestamptz not null,
  payload      jsonb,
  sources      jsonb,
  updated_at   timestamptz not null default now()
);
comment on table public.cockpit_sections is
  'The CEO cockpit''s prepared sections (growth, money, delivery, calls, clients, team, organic, machine, ...), one row each with the full payload the screens read, rewritten every refresh.';

create table if not exists public.cockpit_metric_definitions (
  metric      text primary key,
  section     text not null,
  label       text not null,
  definition  text not null,
  source      text not null,
  leaves_out  text,
  unit        text not null default 'count',
  updated_at  timestamptz not null default now()
);
comment on table public.cockpit_metric_definitions is
  'One row per CEO cockpit metric: the plain-words definition, the system it is read from, what it leaves out, and its unit (usd, count, share, minutes, days, ratio). Join cockpit_metric_values on metric.';

create table if not exists public.cockpit_metric_values (
  day          date not null,
  metric       text not null references public.cockpit_metric_definitions(metric) on delete cascade,
  scope        text not null default 'company',
  "window"     text not null default 'snapshot',
  value        numeric(18,4),
  window_from  date,
  window_to    date,
  captured_at  timestamptz not null default now(),
  primary key (day, metric, scope, "window")
);
comment on table public.cockpit_metric_values is
  'The CEO cockpit''s numbers: one row per metric, scope (company, client:<clickup id>, person:<name>), window (today, yesterday, last7, mtd, lastMonth, last30, last90, 12m, all, snapshot) and Kuwait day it was captured. Null value means not measurable that day, never zero.';
create index if not exists cockpit_metric_values_metric_idx on public.cockpit_metric_values (metric, scope, day);

alter table public.cockpit_sections            enable row level security;
alter table public.cockpit_metric_definitions  enable row level security;
alter table public.cockpit_metric_values       enable row level security;
revoke all on public.cockpit_sections           from anon, authenticated;
revoke all on public.cockpit_metric_definitions from anon, authenticated;
revoke all on public.cockpit_metric_values      from anon, authenticated;

commit;
