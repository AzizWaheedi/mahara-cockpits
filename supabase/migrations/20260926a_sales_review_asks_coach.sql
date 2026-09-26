-- Reviews a rep asks for, and Aziz's own call reviews (Aziz, 2026-09-26:
-- "they can pick the ones they also want reviewed by the AI" and "a place
-- for me to put my own manual call reviews that we have on Skool for them
-- to see as well").
--
-- Written by sales-api (asks, coach reviews) and the sales desk (review
-- state) with the service key only; every seat reads.

begin;

-- ---------------------------------------------------------------------------
-- A rep's ask: review this call
-- ---------------------------------------------------------------------------

create table if not exists public.cockpit_sales_review_asks (
  id uuid primary key default gen_random_uuid(),
  recording_id text not null,
  requested_by text not null,
  requested_at timestamptz not null default now(),
  -- queued: waiting for the desk; reviewing: the model is on it; done: the
  -- review is in cockpit_sales_reviews; failed: why is in `error`.
  state text not null default 'queued'
    check (state in ('queued', 'reviewing', 'done', 'failed')),
  error text,
  finished_at timestamptz
);

-- One open ask per call: pressing twice asks once.
create unique index if not exists cockpit_sales_review_asks_one_open
  on public.cockpit_sales_review_asks (recording_id) where state in ('queued', 'reviewing');
create index if not exists cockpit_sales_review_asks_state
  on public.cockpit_sales_review_asks (state, requested_at);

-- ---------------------------------------------------------------------------
-- Aziz's reviews (Skool and anywhere else), for the team to learn from
-- ---------------------------------------------------------------------------

create table if not exists public.cockpit_sales_coach_reviews (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 2 and 200),
  -- The Skool post or video, or any other link.
  url text check (url is null or url ~* '^https?://'),
  -- The call it is about, when it is in the cockpit.
  recording_id text,
  contact_id text,
  call_type text check (call_type is null or call_type in ('intro', 'demo', 'phone', 'other')),
  -- Who it is for: a seat's email, or null for the whole team.
  for_email text,
  -- What to take from it.
  lessons text check (lessons is null or length(lessons) <= 20000),
  tags text[] not null default '{}',
  score numeric check (score is null or score between 0 and 100),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists cockpit_sales_coach_reviews_recent
  on public.cockpit_sales_coach_reviews (created_at desc) where deleted_at is null;
create index if not exists cockpit_sales_coach_reviews_recording
  on public.cockpit_sales_coach_reviews (recording_id) where recording_id is not null;

do $$
declare
  t text;
begin
  foreach t in array array['cockpit_sales_review_asks', 'cockpit_sales_coach_reviews']
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

notify pgrst, 'reload schema';

commit;
