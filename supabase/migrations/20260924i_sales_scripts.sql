-- The call scripts: Aziz's Intro Call Framework (setter) and Sales Call
-- Framework (closer), each in English and Gulf Arabic, imported from the
-- Google Docs by hermes/sales-desk/scripts_import. One row per script,
-- language and version; the newest active one is what the call screen shows.
-- `doc` holds the stages (goal, time, spoken lines, branches, notes, exit
-- checklist), the objection and FAQ playbooks, and the capture fields each
-- stage fills in on the lead.

begin;

create table if not exists public.cockpit_sales_scripts (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key in ('intro', 'demo')),
  lang text not null check (lang in ('en', 'ar')),
  version integer not null,
  title text,
  doc jsonb not null,
  -- The document id and tab it came from, and a hash of the text, so a
  -- re-import only adds a version when the script changed.
  source jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  imported_at timestamptz not null default now(),
  imported_by text,
  unique (key, lang, version)
);

alter table public.cockpit_sales_scripts enable row level security;
drop policy if exists cockpit_sales_scripts_seat_read on public.cockpit_sales_scripts;
create policy cockpit_sales_scripts_seat_read on public.cockpit_sales_scripts
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on table public.cockpit_sales_scripts from public, anon, authenticated;
grant select on table public.cockpit_sales_scripts to authenticated;
grant all on table public.cockpit_sales_scripts to service_role;

commit;
