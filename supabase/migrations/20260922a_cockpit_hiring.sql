-- The hiring funnel: candidates, what happened to them, and the cached ids
-- of the GoHighLevel account that holds them
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive.
--
-- Aziz, 2026-09-22: "make me an amazing recruiting and hiring part of the CEO
-- cockpit ... a pipeline stage based on the interview process ... each role
-- have a test project assigned to it that would be easily changeable based on
-- the custom values ... I can grade each one based on the interview process."
--
-- GoHighLevel holds the board and the conversations. This mirror is what the
-- cockpit reads and what any LLM reads: one row per candidate, one row per
-- thing that happened, in plain columns. No email and no phone number lands
-- here; those stay in GoHighLevel and the cockpit links out to them, the same
-- rule the CEO payloads already follow for leads.

begin;

create table if not exists public.cockpit_hiring_candidates (
  -- The GoHighLevel opportunity id: one application to one role.
  id                  text primary key,
  contact_id          text not null,
  location_id         text not null,
  role                text not null,
  role_label          text not null,
  pipeline_id         text not null,
  stage               text not null,
  stage_name          text not null,
  -- The name is needed to grade a person; contact details are not.
  name                text not null default '',
  country             text,
  source              text,
  years_experience    numeric(4,1),
  arabic              text,
  portfolio_url       text,
  loom_url            text,
  test_project_url    text,
  score_application   numeric(4,1),
  score_loom          numeric(4,1),
  score_group         numeric(4,1),
  score_one_to_one    numeric(4,1),
  score_test_project  numeric(4,1),
  score_total         numeric(4,1),
  disqualify_reason   text,
  bench_reason        text,
  applied_at          timestamptz,
  stage_since         timestamptz,
  offer_sent_on       date,
  start_date          date,
  agreed_comp         text,
  notes               text,
  -- Set when the person leaves the funnel, so the board can be read as a funnel.
  exited_at           timestamptz,
  ghl_updated_at      timestamptz,
  synced_at           timestamptz not null default now()
);
comment on table public.cockpit_hiring_candidates is
  'One row per job application, mirrored from the GoHighLevel hiring sub-account. role is the cockpit key (media-buyer, csm, sales-rep, call-centre, video-editor); stage is the funnel key (application, disqualified, loom, group, one-to-one, offer, bench, hired, fired, churn). score_total is the mean of the scores given, computed by the cockpit.';
create index if not exists cockpit_hiring_candidates_role_idx
  on public.cockpit_hiring_candidates (role, stage);
create index if not exists cockpit_hiring_candidates_applied_idx
  on public.cockpit_hiring_candidates (applied_at desc);

create table if not exists public.cockpit_hiring_events (
  id            bigserial primary key,
  candidate_id  text not null references public.cockpit_hiring_candidates(id) on delete cascade,
  role          text not null,
  -- 'stage' when the card moved, 'action' when the cockpit did something,
  -- 'score' when someone graded, 'note' when someone wrote.
  kind          text not null check (kind in ('stage', 'action', 'score', 'note')),
  from_stage    text,
  to_stage      text,
  -- For an action: which one (loom_request, test_project, booking_link,
  -- rejection, offer, bench_followup, nudge).
  action        text,
  detail        text,
  -- False when the action was planned but the send failed; the reason is in detail.
  ok            boolean not null default true,
  by_whom       text not null default 'the cockpit',
  at            timestamptz not null default now()
);
comment on table public.cockpit_hiring_events is
  'Everything that happened to a candidate: stage moves, messages the cockpit sent, scores given, notes written. This is the audit trail for the hiring engine and the source of time-in-stage and time-to-hire.';
create index if not exists cockpit_hiring_events_candidate_idx
  on public.cockpit_hiring_events (candidate_id, at desc);
create index if not exists cockpit_hiring_events_at_idx
  on public.cockpit_hiring_events (at desc);

-- The GoHighLevel ids the engine needs on every call: pipeline per role,
-- stage per pipeline, custom field per spec key. Re-read by the sync, cached
-- here so a message send is one call and not four.
create table if not exists public.cockpit_hiring_meta (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
comment on table public.cockpit_hiring_meta is
  'Cached GoHighLevel ids for the hiring account: pipelines by role, stages by pipeline, custom fields by spec key. Written by the sync, read by the engine.';

alter table public.cockpit_hiring_candidates enable row level security;
alter table public.cockpit_hiring_events enable row level security;
alter table public.cockpit_hiring_meta enable row level security;
revoke all on public.cockpit_hiring_candidates from anon, authenticated;
revoke all on public.cockpit_hiring_events from anon, authenticated;
revoke all on public.cockpit_hiring_meta from anon, authenticated;
revoke all on sequence public.cockpit_hiring_events_id_seq from anon, authenticated;

commit;
