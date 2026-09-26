-- The pipeline, kept neat by the dialer (Aziz, 2026-09-26: "The dialer
-- should also be able to automatically move them into the pipeline stages
-- we have ... it is a bit messy in our CRM, I want to just make it extremely
-- neat").
--
-- Every stage move the cockpit makes in HighLevel, by a rep on the board or
-- by the dialer after an outcome, is written here first and then carried
-- out, so a move that HighLevel refused is seen and can be tried again.

begin;

create table if not exists public.cockpit_sales_stage_moves (
  id uuid primary key default gen_random_uuid(),
  contact_id text not null,
  opportunity_id text,
  pipeline_id text,
  from_stage_id text,
  to_stage_id text not null,
  -- What asked for it: a rep on the board, or the dialer after an outcome.
  source text not null check (source in ('board', 'dialer', 'booking')),
  outcome text,
  -- done: HighLevel took it; failed: why is in `error`; skipped: nothing to
  -- do (already there, or the rule said leave it).
  state text not null default 'pending' check (state in ('pending', 'done', 'failed', 'skipped')),
  error text,
  by_email text not null,
  at timestamptz not null default now(),
  attempt_id uuid
);

create index if not exists cockpit_sales_stage_moves_contact
  on public.cockpit_sales_stage_moves (contact_id, at desc);
create index if not exists cockpit_sales_stage_moves_recent
  on public.cockpit_sales_stage_moves (at desc);

alter table public.cockpit_sales_stage_moves enable row level security;
drop policy if exists cockpit_sales_stage_moves_seat_read on public.cockpit_sales_stage_moves;
create policy cockpit_sales_stage_moves_seat_read on public.cockpit_sales_stage_moves
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on public.cockpit_sales_stage_moves from public, anon, authenticated;
grant select on public.cockpit_sales_stage_moves to authenticated;
grant all on public.cockpit_sales_stage_moves to service_role;

notify pgrst, 'reload schema';

commit;
