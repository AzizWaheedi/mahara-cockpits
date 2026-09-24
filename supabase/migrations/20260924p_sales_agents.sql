-- The two agents on the sales desk (Aziz, 2026-09-24):
--
-- "a lead researcher where you can have an agent go ahead and research the
-- person, search them up on LinkedIn, Google, and everything about the
-- person as well if they trigger"
--
-- "an agent ... that goes into our CRM and actually follows up ... with
-- context on their specific situation, with the history, the call we had,
-- and anything it has in terms of data ... for the first few days with
-- approval, and even for long-term leads as well, until it's fully
-- trained. They can just approve it, and it goes straight up. The sales
-- manager should be able to see it as well."
--
-- Both run on the VPS (hermes/sales-desk) with the VPS keys; lead data goes
-- to OpenAI and Apify's Google search, never to DeepSeek. Written by the
-- desk and by sales-api with the service key only.

begin;

-- ---------------------------------------------------------------------------
-- Research briefs
-- ---------------------------------------------------------------------------

create table if not exists public.cockpit_sales_research (
  id uuid primary key default gen_random_uuid(),
  request_id uuid unique,
  contact_id text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'ready', 'failed')),
  -- {person, company, signals, talking_points, cautions, not_found}; every
  -- claim carries the URL it came from.
  brief jsonb,
  -- Every page the search consulted, and whether a claim cites it.
  sources jsonb,
  model text,
  error text,
  requested_by text,
  requested_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists cockpit_sales_research_contact_idx
  on public.cockpit_sales_research (contact_id, requested_at desc);

alter table public.cockpit_sales_research enable row level security;
drop policy if exists cockpit_sales_research_seat_read on public.cockpit_sales_research;
create policy cockpit_sales_research_seat_read on public.cockpit_sales_research
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on public.cockpit_sales_research from anon, authenticated;
grant select on public.cockpit_sales_research to authenticated;
grant all on public.cockpit_sales_research to service_role;

-- ---------------------------------------------------------------------------
-- Follow-up drafts, waiting for a rep's yes
-- ---------------------------------------------------------------------------

create table if not exists public.cockpit_sales_followups (
  id uuid primary key default gen_random_uuid(),
  contact_id text not null,
  -- The seat whose lead it is (the HighLevel owner, or the intro/demo rep).
  owner_email text,
  owner_ghl text,
  -- Why this lead now: new (first days), no_show, after_call, nurture
  -- (long-term), reply (they wrote and nobody answered).
  segment text not null
    check (segment in ('new', 'no_show', 'after_call', 'nurture', 'reply')),
  channel text not null check (channel in ('whatsapp', 'email')),
  subject text,
  body text not null check (length(body) between 1 and 10000),
  -- One sentence a rep reads before approving: why this, why now.
  why text not null,
  -- What the agent was given: the facts it could use, for the rep to check.
  context jsonb,
  model text,
  status text not null default 'draft'
    check (status in ('draft', 'sending', 'sent', 'skipped', 'expired', 'failed')),
  created_at timestamptz not null default now(),
  -- A draft goes stale: a WhatsApp window closes, a lead answers.
  expires_at timestamptz,
  decided_by text,
  decided_at timestamptz,
  final_subject text,
  final_body text,
  -- The rep changed the words before sending: how the agent learns.
  edited boolean,
  skip_reason text,
  message_id uuid,
  error text,
  -- Sent without a person because the manager trusted this kind of draft.
  auto boolean not null default false
);

-- One open draft per lead at a time.
create unique index if not exists cockpit_sales_followups_one_open
  on public.cockpit_sales_followups (contact_id) where status in ('draft', 'sending');
create index if not exists cockpit_sales_followups_owner_idx
  on public.cockpit_sales_followups (owner_email, status, created_at desc);
create index if not exists cockpit_sales_followups_status_idx
  on public.cockpit_sales_followups (status, created_at desc);

alter table public.cockpit_sales_followups enable row level security;
drop policy if exists cockpit_sales_followups_read on public.cockpit_sales_followups;
-- A rep sees the drafts for their own leads; a manager sees every one.
create policy cockpit_sales_followups_read on public.cockpit_sales_followups
  for select to authenticated
  using (
    public.cockpit_sales_seat()
    and (public.cockpit_sales_manager() or owner_email = public.cockpit_sales_email())
  );
revoke all on public.cockpit_sales_followups from anon, authenticated;
grant select on public.cockpit_sales_followups to authenticated;
grant all on public.cockpit_sales_followups to service_role;

-- What the follow-up agent may do. Everything waits for a person until a
-- manager switches a kind of draft to send by itself.
insert into public.cockpit_sales_settings (key, value, updated_by)
values ('followups', '{
  "enabled": true,
  "autosend": {"new": false, "no_show": false, "after_call": false, "nurture": false, "reply": false},
  "per_run": 12,
  "per_day": 60,
  "quiet": {"from": 21, "to": 9},
  "nurture_every_days": 7
}'::jsonb, 'migration')
on conflict (key) do nothing;

notify pgrst, 'reload schema';

commit;
