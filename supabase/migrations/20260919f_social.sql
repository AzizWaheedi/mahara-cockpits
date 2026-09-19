-- Social media management for clients.
--
-- The workflow is the one locked on 2026-09-18 and written up in
-- `docs/research/` -- three pillars, a monthly batch, a written plan
-- approved before anything is generated, an internal review, then the
-- client approves in GoHighLevel and GHL publishes natively.
--
-- Two things decide the shape of these tables.
--
-- A client is a ClickUp card. `client_task_id` is the id on the Clients
-- board, the same key `editor_clients` already uses, so the brand DNA, the
-- do's and don'ts, the offer and the website are already on file and are
-- not copied here. This table holds only what is true about a client's
-- *social media*, and nothing that is true about the client generally.
--
-- Nothing is generated before it is approved in writing. A plan row exists
-- with no images at all, which is the cheap checkpoint: catching a wrong
-- direction costs nothing before generation and real money after.

-- ---------------------------------------------------------------------------
-- Who is on the package, and how their month is shaped.

create table if not exists public.social_clients (
  client_task_id   text primary key,
  -- The flag the cockpit shows on the client: is this client on social
  -- media management at all. Everything else here is meaningless without it.
  active           boolean not null default false,
  -- The GHL sub-account that holds their connected Instagram and Facebook
  -- and does the actual publishing.
  ghl_location_id  text,
  -- Their dialect, never Aziz's Kuwaiti voice on client work.
  dialect          text,
  -- Which of the three pillars apply. Portfolio needs live project photos;
  -- a client with none shifts the ratio to the other two rather than
  -- posting something stale.
  pillars          text[] not null default array['portfolio','craft','education'],
  posts_per_month  integer not null default 12,
  -- Day of the month the batch is built. The roster groups by this and by
  -- pillar mix, not alphabetically, so one reviewer can do every client's
  -- Craft work in one sitting -- which is the whole time-leverage mechanic.
  batch_day        integer,
  -- Onboarding is done when all four of these are set.
  socials_connected_at timestamptz,
  test_post_at         timestamptz,
  slots_blocked_at     timestamptz,
  bank_ready_at        timestamptz,
  note             text,
  started_at       timestamptz,
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- The real photographs. Not stock, and not a headshot on its own: the
-- research found headshot-only degrades likeness on lifestyle images.

create table if not exists public.social_assets (
  id             text primary key,
  client_task_id text not null,
  kind           text not null default 'product',   -- person | project | product
  path           text,                              -- in the private bucket
  url            text,                              -- or somewhere we do not host
  caption        text,
  active         boolean not null default true,
  added_by       text,
  at             timestamptz not null default now()
);
create index if not exists social_assets_by_client on public.social_assets (client_task_id);

-- ---------------------------------------------------------------------------
-- The Content Bank: what this client's audience actually asks, and every
-- correction anybody has ever made. This is the part that makes the system
-- get better per client instead of re-explaining the brand every cycle.

create table if not exists public.social_bank (
  id             text primary key,
  client_task_id text not null,
  -- question and objection feed the Education pillar; correction is what
  -- somebody said was wrong last cycle and must not happen again.
  kind           text not null default 'question',
  text           text not null,
  pillar         text,
  source         text,          -- comments | research | client | correction | cockpit
  active         boolean not null default true,
  used_at        timestamptz,
  added_by       text,
  at             timestamptz not null default now()
);
create index if not exists social_bank_by_client on public.social_bank (client_task_id, active);

-- ---------------------------------------------------------------------------
-- One month, one client.

create table if not exists public.social_batches (
  id             text primary key,               -- <client_task_id>:<yyyy-mm>
  client_task_id text not null,
  month          text not null,                  -- yyyy-mm
  -- How many of each pillar this month, decided on what material exists.
  mix            jsonb not null default '{}'::jsonb,
  -- planning -> planned -> approved -> generating -> review -> with_client
  -- -> scheduled -> done. A batch never skips approved: that is the rule
  -- the whole cost model rests on.
  status         text not null default 'planning',
  planned_at     timestamptz,
  approved_at    timestamptz,
  approved_by    text,
  reviewed_at    timestamptz,
  reviewed_by    text,
  sent_at        timestamptz,
  error          text,
  updated_at     timestamptz not null default now(),
  unique (client_task_id, month)
);
create index if not exists social_batches_by_status on public.social_batches (status, month);

-- ---------------------------------------------------------------------------
-- One post. Exists as a written plan long before it is a picture.

create table if not exists public.social_posts (
  id                text primary key,
  batch_id          text not null,
  client_task_id    text not null,
  n                 integer not null default 0,
  pillar            text not null,
  -- The plan. This is all there is at the approval checkpoint.
  topic             text,
  slides            integer not null default 1,
  caption_direction text,
  -- What generation produced.
  caption           text,
  images            jsonb not null default '[]'::jsonb,
  checks            jsonb,          -- the automated self-check's findings
  -- planned -> approved -> generating -> generated -> internal_ok
  -- -> with_client -> client_approved | client_rejected -> scheduled
  -- -> published | failed
  status            text not null default 'planned',
  -- A rejection always carries a written reason, and that reason goes into
  -- the Content Bank as a correction rather than being fixed once and lost.
  rejected_reason   text,
  ghl_post_id       text,
  scheduled_at      timestamptz,
  published_at      timestamptz,
  error             text,
  at                timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists social_posts_by_batch on public.social_posts (batch_id, n);
create index if not exists social_posts_by_status on public.social_posts (status);
create index if not exists social_posts_by_client on public.social_posts (client_task_id);

-- ---------------------------------------------------------------------------
-- Work for an agent that can reach Higgsfield.
--
-- Images are generated on Mahara's existing Higgsfield subscription through
-- its MCP, not the metered API (Aziz, 2026-09-19). An MCP tool cannot be
-- called from a Convex action, so the cockpit does not generate anything:
-- it writes a job here and an agent that can speak MCP drains it. The same
-- outbox pattern as everything else that leaves a cockpit.

create table if not exists public.social_jobs (
  id             text primary key,
  kind           text not null,                  -- plan | generate | caption | publish
  client_task_id text,
  batch_id       text,
  post_id        text,
  params         jsonb not null default '{}'::jsonb,
  status         text not null default 'queued', -- queued | running | done | failed
  attempts       integer not null default 0,
  result         jsonb,
  error          text,
  requested_by   text,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  updated_at     timestamptz not null default now()
);
create index if not exists social_jobs_queued on public.social_jobs (status, created_at);

-- ---------------------------------------------------------------------------
-- Row security on, and no policies or grants yet on purpose.
--
-- Everything above is read and written by the creative director cockpit
-- through a Convex action holding the service key, which bypasses both.
-- Nothing in a browser touches these tables directly today. The moment
-- something does, its policy and its matching grant go in together -- a
-- policy without a grant does nothing, which cost a day on the ideation
-- board (see 20260919d).

alter table public.social_clients enable row level security;
alter table public.social_assets  enable row level security;
alter table public.social_bank    enable row level security;
alter table public.social_batches enable row level security;
alter table public.social_posts   enable row level security;
alter table public.social_jobs    enable row level security;

revoke all on public.social_clients from anon, authenticated;
revoke all on public.social_assets  from anon, authenticated;
revoke all on public.social_bank    from anon, authenticated;
revoke all on public.social_batches from anon, authenticated;
revoke all on public.social_posts   from anon, authenticated;
revoke all on public.social_jobs    from anon, authenticated;
