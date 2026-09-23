-- Every cockpit's end of day, on its way out.
--
-- Only the media buyer's EOD ever left its cockpit. The creative
-- director's and the CSM's were saved into their own Convex tables and
-- read by nobody: not Slack, not the EOD Reports sheet, not EOD Radar,
-- not the CEO tab. So those people filled one in daily and the tracking
-- sheet recorded MISSED against them every day, which is exactly what it
-- was seeing.
--
-- The cockpits drop a row here; a worker on the VPS posts it. The VPS is
-- where the Slack token and the Google token with rights to that sheet
-- already live, and where the editor desk already appends EODs to the
-- very same spreadsheet -- so this reuses a path that is known to work
-- rather than teaching two more Convex deployments to sign Google JWTs.

create table if not exists public.eod_outbox (
  id          bigserial primary key,
  role        text not null,          -- creative | csm | media_buyer | editor
  day         text not null,          -- YYYY-MM-DD, Kuwait
  person      text not null,          -- the name EOD Radar matches in the Roster
  slack_id    text,                   -- their Slack user id, for "Submitted by"
  channel     text not null,          -- the EOD channel their roster row names
  tab         text,                   -- the EOD Reports tab, when there is one
  body        text not null,          -- the message, already in the radar's format
  row_values  jsonb,                  -- the sheet row, in that tab's column order
  status      text not null default 'queued'
              check (status in ('queued', 'sent', 'failed')),
  slack_ts    text,
  error       text,
  attempts    integer not null default 0,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  -- One EOD per person per day. A resubmit updates the row rather than
  -- posting a second time, which is how a person ends up looking like
  -- they filed twice and a strike gets cleared wrongly.
  unique (role, day, person)
);
alter table public.eod_outbox enable row level security;
grant all on public.eod_outbox to service_role;
grant usage, select on sequence public.eod_outbox_id_seq to service_role;

create index if not exists eod_outbox_pending on public.eod_outbox (status, created_at);
