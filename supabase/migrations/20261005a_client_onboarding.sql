-- Every client's onboarding links and forms, for the client success cockpit
-- (Aziz, 2026-10-05: "the kickoff form as well linked for any people in
-- onboarding (so the CSM has easy access to it, as well as their call
-- recording and all of that stuff). Prior to the onboarding call, their
-- onboarding form and everything: he has easy links to the per CLIENT").
--
-- Where the things come from, as of 2026-10-05:
--
--   * The ClickUp client card (Clients - Mahara, list 901816559981) already
--     holds the links, written by Make: the Kickoff Form Link (prefilled
--     with the client's onboarding answers once they are in), Onboarding
--     Map, Brand Blueprint Form Link, Brand DNA, Offer Cheat Sheet, Sales
--     Meeting Link (the closer's Fathom), Sales Call Transcript, Contract
--     Link, Drive Link / Drive Folder, Sheet Link and the closer's notes.
--   * The forms are Typeform, keyed to the card by the hidden field
--     onboarding_client_id (the ClickUp task id): the client's onboarding
--     form KFRCXPFx, the CSM's kickoff form tG7dnxBn (BbJy6xg4 before
--     2026-09-14), and the Brand Blueprint form oYZKtogO.
--
-- a) cockpit_client_onboarding: one row per card, rewritten by the sync in
--    convex/onboarding.ts (every 10 minutes, and for one client when the
--    CSM presses Refresh). Nothing here is typed by a person: the card and
--    the forms stay the source of truth.
-- b) cockpit_client_onboarding_runs: every sync, when, why, what it read
--    and what failed, so the screen can say how fresh it is and why not.
--
-- The service role is the only door. Idempotent.

begin;

-- a) ----------------------------------------------------------------------------
create table if not exists public.cockpit_client_onboarding (
  clickup_task_id     text primary key,
  client_name         text not null,
  -- ClickUp's own status (on boarding / in progress / cancelled).
  clickup_status      text,
  -- The card's "Client Status" dropdown: Needs Contacting, Onboarding
  -- Booked, Brand Blueprint Booked, LAUNCH BOOKED, Ready For Launch, ...
  client_status       text,
  in_onboarding       boolean not null default false,
  csm                 text,
  signup_on           date,
  onboarding_call_on  date,
  launch_on           date,
  -- Card links by name: kickoff_form, onboarding_map, blueprint_form,
  -- brand_dna, offer_sheet, sales_call, fathom, last_meeting, contract,
  -- drive, report_sheet, history_doc, market_research, website, clickup.
  links               jsonb not null default '{}'::jsonb,
  -- The closer's handover as the card has it: closer, closer_notes,
  -- billing_notes, client_profile, payment_plan, contract_status,
  -- daily_budget, service.
  handover            jsonb not null default '{}'::jsonb,
  -- The card's Sales Call Transcript (Make keeps 48,000 characters).
  sales_transcript    text,
  -- onboarding / kickoff / blueprint: {form_id, response_id, submitted_at,
  -- answers: [{ref, title, value}]} for the newest response of each.
  forms               jsonb not null default '{}'::jsonb,
  card_updated_at     timestamptz,
  -- The last sync that saw the card on the list, and the last write.
  seen_at             timestamptz not null default now(),
  synced_at           timestamptz not null default now()
);
create index if not exists cockpit_client_onboarding_in
  on public.cockpit_client_onboarding (in_onboarding, seen_at desc);

-- b) ----------------------------------------------------------------------------
create table if not exists public.cockpit_client_onboarding_runs (
  id           bigint generated always as identity primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  -- cron, refresh (a CSM pressed it) or one (a single client).
  trigger      text not null,
  actor_email  text,
  ok           boolean,
  counts       jsonb not null default '{}'::jsonb,
  -- What could not be read, in plain words; null when everything was.
  problem      text
);
create index if not exists cockpit_client_onboarding_runs_at
  on public.cockpit_client_onboarding_runs (started_at desc);

alter table public.cockpit_client_onboarding      enable row level security;
alter table public.cockpit_client_onboarding_runs enable row level security;

revoke all on public.cockpit_client_onboarding      from anon, authenticated;
revoke all on public.cockpit_client_onboarding_runs from anon, authenticated;

grant all on public.cockpit_client_onboarding      to service_role;
grant all on public.cockpit_client_onboarding_runs to service_role;

commit;
