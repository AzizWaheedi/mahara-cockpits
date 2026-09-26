-- The hot list (Aziz's brief, 2026-09-24: "a hot list there where they can
-- put their hot leads, when they're going to follow up with them next, and
-- all of that stuff, and the last objection"). A lead on it is hotter in the
-- dialer's order and comes up again at its follow-up time.
--
-- Written by sales-api with the service key; every seat reads.

begin;

create table if not exists public.cockpit_sales_hot (
  contact_id text primary key,
  -- Whose hot lead it is (the seat that put it there, or the one it was given to).
  owner_email text not null,
  -- When to follow up next, and how.
  next_at timestamptz,
  next_how text check (next_how is null or next_how in ('call', 'whatsapp', 'email', 'meeting')),
  last_objection text check (last_objection is null or length(last_objection) <= 500),
  note text check (note is null or length(note) <= 4000),
  added_by text not null,
  added_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Taken off the list (signed, lost, or cooled); kept for the record.
  removed_at timestamptz,
  removed_why text
);

create index if not exists cockpit_sales_hot_owner
  on public.cockpit_sales_hot (owner_email, next_at) where removed_at is null;

alter table public.cockpit_sales_hot enable row level security;
drop policy if exists cockpit_sales_hot_seat_read on public.cockpit_sales_hot;
create policy cockpit_sales_hot_seat_read on public.cockpit_sales_hot
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on public.cockpit_sales_hot from public, anon, authenticated;
grant select on public.cockpit_sales_hot to authenticated;
grant all on public.cockpit_sales_hot to service_role;

notify pgrst, 'reload schema';

commit;
