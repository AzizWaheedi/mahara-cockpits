-- Frame.io: the review link on a job, and somewhere to keep a token that
-- rotates.
--
-- Google's refresh token never changes, so it lives in the worker's env
-- file. Adobe's does: every refresh returns a new one, and the old one is
-- spent. A token that changes cannot live in a file the worker only reads,
-- so it lives here, in a table nothing but the service key can open.

create table if not exists public.frameio_auth (
  id             text primary key default 'default',
  account_id     text,
  refresh_token  text,
  -- When the token last worked. If this goes quiet the worker is locked out
  -- and somebody has to re-authorise; the health check reads it.
  refreshed_at   timestamptz,
  -- Why the last refresh failed, so the alert can say something useful.
  error          text,
  updated_at     timestamptz not null default now()
);

alter table public.frameio_auth enable row level security;
-- Deliberately no policies and no grants. Row security with no policy denies
-- everyone; the service key bypasses both. The browser must never see this,
-- and there is no cockpit screen that wants it.
revoke all on public.frameio_auth from anon, authenticated;

-- The cut in Frame.io, on the job it belongs to.
alter table public.editor_jobs
  add column if not exists frameio_file_id   text,
  -- The link the editor opens. Kept as given rather than rebuilt from ids,
  -- so a change to their URL shape cannot silently break every job.
  add column if not exists frameio_url       text,
  add column if not exists frameio_version   integer,
  -- The client's review link, once somebody makes one. Its presence is what
  -- "the client has it" means.
  add column if not exists frameio_share_url text,
  add column if not exists frameio_seen_at   timestamptz;

comment on column public.editor_jobs.frameio_file_id is
  'The Frame.io file this job''s cut lives on. Null until a cut is uploaded there; every screen treats null as "not using Frame.io for this one".';

-- editor_notes needs nothing new: at_sec, source, done and version are all
-- already there, and have been since the desk was built. A Frame.io note is
-- keyed `frameio:<comment id>` so the same comment read twice is one row.
