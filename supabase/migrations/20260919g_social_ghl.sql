-- Credentials for the Social Planner, and the cached calendar.
--
-- Two things, both learned the hard way elsewhere in this project.
--
-- Tokens do not go in `social_clients`, because the roster reads that
-- table with `select=*` and a token would ride along to the browser. They
-- live here, in a table with no policies and no grants, which only the
-- service key opens.
--
-- And the calendar is cached rather than read live. GoHighLevel's API is
-- not reliable enough to sit in front of a page load: the cockpit shows
-- what it last saw, says when that was, and refreshes on a timer or on
-- demand. A slow GHL should make the calendar stale, never blank.

create table if not exists public.social_ghl_auth (
  -- 'agency' for the company-level token, or a location id for a
  -- sub-account's own Private Integration Token.
  id            text primary key,
  token         text,
  -- A location token minted from the agency one expires; a Private
  -- Integration Token does not. Null means it does not expire.
  expires_at    timestamptz,
  scopes        text,
  error         text,
  checked_at    timestamptz,
  updated_at    timestamptz not null default now()
);

-- Which of a client's social accounts GHL actually holds. Read from
-- `/social-media-posting/{location}/accounts`, stored so the cockpit can
-- say "Instagram and Facebook" without calling GHL to draw a list.
create table if not exists public.social_accounts (
  id             text primary key,          -- the GHL account id
  client_task_id text not null,
  location_id    text not null,
  platform       text,                      -- instagram | facebook | linkedin | ...
  name           text,
  avatar         text,
  -- GHL keeps an account row after the OAuth behind it has expired, so
  -- this is what the connection check writes.
  ok             boolean not null default true,
  seen_at        timestamptz not null default now()
);
create index if not exists social_accounts_by_client on public.social_accounts (client_task_id);

alter table public.social_ghl_auth enable row level security;
alter table public.social_accounts enable row level security;
revoke all on public.social_ghl_auth from anon, authenticated;
revoke all on public.social_accounts from anon, authenticated;

-- What the cockpit last saw in GHL for a post it pushed. `social_posts`
-- holds our side; these are the columns that only GHL can answer.
alter table public.social_posts
  add column if not exists ghl_status     text,
  add column if not exists ghl_synced_at  timestamptz,
  add column if not exists approval_url   text;
