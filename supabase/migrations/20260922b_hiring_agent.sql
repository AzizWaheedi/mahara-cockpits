-- What a candidate wrote, and what the recruiting agent made of it
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive.
--
-- Aziz, 2026-09-22: "You don't need the API key. Just tell me what you want
-- the VPS to do. It can make the agent."
--
-- So the agent runs on the VPS beside the ideation radar, which already holds
-- language model keys and a cron. For that to work it needs everything in
-- Supabase and nothing from GoHighLevel: the application text moves out of the
-- GoHighLevel note it was living in, and the agent's verdict lands on the
-- candidate row where the cockpit already reads.

begin;

create table if not exists public.cockpit_hiring_applications (
  -- The GoHighLevel contact, which is what a candidate row carries.
  contact_id  text primary key,
  role        text not null,
  form        text,
  -- The whole questionnaire as the applicant answered it, question by answer.
  text        text not null,
  at          timestamptz not null default now()
);
comment on table public.cockpit_hiring_applications is
  'The application as the candidate wrote it, kept here so the recruiting agent on the VPS can read it without a GoHighLevel token. Written by the cockpit''s intake; one row per contact.';

alter table public.cockpit_hiring_candidates
  add column if not exists agent_score   numeric(4,1),
  add column if not exists agent_verdict text,
  add column if not exists agent_note    text,
  add column if not exists agent_asks    text,
  add column if not exists agent_at      timestamptz;

comment on column public.cockpit_hiring_candidates.agent_score is
  'What the recruiting agent would give this application out of ten. A proposal. Aziz''s own score_application is the one that counts, and the gap between them is what calibrates the agent.';
comment on column public.cockpit_hiring_candidates.agent_verdict is
  'advance, look closer, or drop. Never acted on by itself.';
comment on column public.cockpit_hiring_candidates.agent_asks is
  'The two or three questions that would settle whether this person is real, written to be read out on a call.';

create index if not exists cockpit_hiring_candidates_agent_idx
  on public.cockpit_hiring_candidates (role, agent_score desc nulls last);

alter table public.cockpit_hiring_applications enable row level security;
revoke all on public.cockpit_hiring_applications from anon, authenticated;

commit;
