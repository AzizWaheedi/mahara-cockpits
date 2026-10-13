-- Social media, ready for the first client who buys it: posts go out on
-- their day by themselves, the numbers come back onto the post, and the
-- worker says in words when something it needs is missing.
--
-- Aziz, 2026-09-23: "just prepare it for when we sell a client the social
-- media management". Nothing posts until someone switches a client on:
-- `publishing` is off for every client, and only posts due after the
-- moment it was switched on (`publishing_since`) ever go out, so turning a
-- client on never sends last week's posts.

alter table public.social_clients
  add column if not exists publishing boolean not null default false,
  add column if not exists publishing_since timestamptz,
  add column if not exists publishing_by text;

-- What went out where: {"instagram": {"id", "permalink", "at"},
-- "facebook": {"id", "at"}}. Written per platform the moment each succeeds,
-- so a retry never posts the same thing twice.
alter table public.social_posts
  add column if not exists published jsonb not null default '{}'::jsonb,
  add column if not exists publish_error text,
  add column if not exists publish_attempts integer not null default 0,
  add column if not exists results jsonb,
  add column if not exists results_at timestamptz;

-- The worker's own health: Higgsfield signed in, the Meta token alive, the
-- keys it reads present. The calendar turns a failing row into a sentence.
create table if not exists public.social_worker_status (
  check_name text primary key,
  ok         boolean not null,
  detail     text,
  checked_at timestamptz not null default now()
);
alter table public.social_worker_status enable row level security;
revoke all on public.social_worker_status from anon, authenticated;
grant select, insert, update, delete on public.social_worker_status to service_role;
