-- Client references (Aziz's brief, 2026-09-24: "Sales assets and client
-- references in key links"). About 28 call notes show prospects asking to
-- speak to a client, usually one in their own country. Until now the rule
-- was a Slack post (23 March), and consent to be a reference was recorded
-- nowhere: not in B2B, not in Triage, not in mahara-context.
--
-- So each reference here carries its consent: unknown until Aziz or the
-- client's CSM asks them and says so. A rep sees who has agreed, what they
-- may say about them, and the proof in the asset library, and asks for a
-- reference call from the lead; a manager arranges it and marks it.
--
-- Seeded 2026-09-26 from the client profiles marked Very Happy (testimonial)
-- or Happy that are past launch (a client who has not launched has no
-- result to speak to). Nothing is claimed for them: trade, country and the
-- result line are left for a manager to fill in.

begin;

create table if not exists public.cockpit_sales_references (
  id uuid primary key default gen_random_uuid(),
  client_profile_id bigint,
  client_name text not null check (length(client_name) between 1 and 200),
  trade text,
  city text,
  country text,
  -- Still a client (a reference who stopped may still speak, but say so).
  active boolean,
  -- The one line a rep may say about their result, as approved.
  result_line text,
  -- Their proof in the asset library, by slug.
  asset_slugs text[] not null default '{}',
  consent text not null default 'unknown' check (consent in ('yes', 'no', 'unknown')),
  consent_by text,
  consent_at timestamptz,
  -- How a reference call is arranged (usually through their CSM).
  route text,
  last_used_at timestamptz,
  notes text,
  updated_by text not null default 'migration',
  updated_at timestamptz not null default now()
);

create unique index if not exists cockpit_sales_references_profile
  on public.cockpit_sales_references (client_profile_id) where client_profile_id is not null;

create table if not exists public.cockpit_sales_reference_asks (
  id uuid primary key default gen_random_uuid(),
  contact_id text not null,
  -- The reference asked for, or none (the manager picks).
  reference_id uuid references public.cockpit_sales_references (id) on delete set null,
  note text,
  asked_by text not null,
  asked_at timestamptz not null default now(),
  state text not null default 'asked' check (state in ('asked', 'arranged', 'done', 'declined')),
  decided_by text,
  decided_at timestamptz,
  answer text
);

create index if not exists cockpit_sales_reference_asks_open
  on public.cockpit_sales_reference_asks (state, asked_at desc);
create index if not exists cockpit_sales_reference_asks_contact
  on public.cockpit_sales_reference_asks (contact_id, asked_at desc);

do $$
declare
  t text;
begin
  foreach t in array array['cockpit_sales_references', 'cockpit_sales_reference_asks']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_seat_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.cockpit_sales_seat())',
      t || '_seat_read', t
    );
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end;
$$;

insert into public.cockpit_sales_references (client_profile_id, client_name, active, notes)
select p.id, p.client_name, p.stage = 'Active',
       'From the client profiles: ' || p.health || ', ' || coalesce(p.stage, 'no stage') || '.'
from public.cockpit_client_profiles p
where p.health in ('Very Happy (testimonial)', 'Happy')
  and coalesce(p.stage, '') not ilike 'ready for launch%'
on conflict do nothing;

notify pgrst, 'reload schema';

commit;
