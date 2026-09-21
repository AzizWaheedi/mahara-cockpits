-- Changes and bugs Aziz logs on the cockpit, queued for a build
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive.
--
-- Aziz, 2026-09-21: "a feedback part, and I can update changes or bugs.
-- There are two options: changes or bugs, and I can queue them. There's a
-- button to deploy them whenever I want, but it also scans for anything I
-- put in the log."

begin;

create table if not exists public.cockpit_feedback (
  id            bigserial primary key,
  kind          text not null check (kind in ('change', 'bug')),
  text          text not null,
  status        text not null default 'queued' check (status in ('queued', 'dispatched', 'in_progress', 'done', 'dismissed')),
  batch         text,
  note          text,
  created_by    text not null,
  created_at    timestamptz not null default now(),
  dispatched_at timestamptz,
  done_at       timestamptz,
  updated_at    timestamptz not null default now()
);
comment on table public.cockpit_feedback is
  'Changes and bugs Aziz logs on the CEO cockpit. queued = written; dispatched = the Deploy button sent the batch; in_progress / done = the builder''s state; dismissed = withdrawn. The builder scans this table on a schedule.';
create index if not exists cockpit_feedback_status_idx on public.cockpit_feedback (status, created_at);

alter table public.cockpit_feedback enable row level security;
revoke all on public.cockpit_feedback from anon, authenticated;

commit;
