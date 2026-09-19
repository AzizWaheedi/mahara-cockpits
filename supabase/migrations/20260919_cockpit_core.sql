-- Mahara cockpit: a Supabase home for the numbers that have none
--
-- Run this in the Creative Triage project (bldgtotkfmhoxmlzowdx), the one the
-- Supabase migration plan calls Mahara Core. Paste it into the SQL editor: the
-- cockpit's own logins cannot create tables, by design. The management-API
-- login is `supabase_read_only_user` on both projects, and the service-role key
-- reaches PostgREST, which runs no DDL.
--
-- Why `public` and not a new schema. PostgREST only serves the schemas exposed
-- in the project's API settings, and the cockpit already reads and writes
-- through `/rest/v1/` with the service-role key (convex/ideation.ts). A new
-- schema would need that setting changed first. The `cockpit_` prefix keeps the
-- domain boundary visible without breaking the path that already works.
--
-- Conventions follow the migration plan, section 3:
--   * money is exact numeric with its own currency column, never a float
--   * timestamps are UTC; a business day is a separate `date` in Kuwait time
--   * absent, null and zero mean three different things and are kept apart
--   * every table says where its numbers came from, so nothing reads as measured
--     when it was typed
--
-- Nothing here duplicates a table that already exists. Off-Whop client cash is
-- deliberately absent: `public.transfers` in the B2B project already has the
-- right shape and is simply empty.

begin;

-- ---------------------------------------------------------------------------
-- 1. Payroll, by person and month
-- ---------------------------------------------------------------------------
-- The single biggest hole in the unit economics. Without it there is no gross
-- margin, no real CAC and no cost per client, and the 1-to-4 ratio swings from
-- healthy to underwater on a number nobody has written down. About eight rows a
-- month is the whole ask.
--
-- This is deliberately NOT read from the bank statement. The `salaries` category
-- in the B2B expense import is a bank label: most of its rows are $6-$39 card
-- top-ups, and it carries no person, role or rate.

create table if not exists public.cockpit_payroll_months (
  id              bigint generated always as identity primary key,
  -- First name plus surname as payroll knows them. Not an email: this table is
  -- read by the CEO cockpit and must carry no login identity.
  person          text        not null check (length(btrim(person)) > 0),
  role            text,
  -- The month this cost belongs to, as its first day, Kuwait calendar.
  month           date        not null check (month = date_trunc('month', month)::date),
  -- Fully loaded monthly cost: salary plus anything paid on top of it.
  cost            numeric(14,2) not null check (cost >= 0),
  currency        char(3)     not null default 'USD' check (currency in ('USD','KWD','AED','SAR','QAR')),
  -- Employment shape, so a contractor month is never read as a salaried one.
  engagement      text        not null default 'staff'
                              check (engagement in ('staff','contractor','agency','intern')),
  -- Whether this person's job is selling. CAC counts only these when the CAC
  -- rule changes to include sales payroll; today's rule is ad spend only.
  is_sales        boolean     not null default false,
  note            text,
  entered_by      text        not null,
  entered_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (person, month)
);

comment on table public.cockpit_payroll_months is
  'Fully loaded monthly cost per person. Typed in by hand, one file a month; never derived from the bank import, whose salaries category is a bank label rather than a payroll.';

create index if not exists cockpit_payroll_months_month_idx
  on public.cockpit_payroll_months (month desc);

-- ---------------------------------------------------------------------------
-- 2. Who worked on which client, by month
-- ---------------------------------------------------------------------------
-- ClickUp time tracking returned zero entries across the whole workspace for
-- June through September 2026, so there is no measured split and there may
-- never be one. This is the agreed substitute: a rough share per person per
-- month, which is enough for a per-client cost and honest about being an
-- estimate.

create table if not exists public.cockpit_person_client_months (
  id              bigint generated always as identity primary key,
  person          text        not null check (length(btrim(person)) > 0),
  month           date        not null check (month = date_trunc('month', month)::date),
  -- The one client key the whole cockpit joins on.
  clickup_task_id text        not null check (length(btrim(clickup_task_id)) > 0),
  -- Share of this person's month spent on this client, 0..1. The shares for one
  -- person in one month should sum to 1 or less; the rest is unallocated time,
  -- which is a real answer and not an error.
  share           numeric(5,4) not null check (share > 0 and share <= 1),
  -- How the share was arrived at, so a guess never reads as a measurement.
  basis           text        not null default 'estimate'
                              check (basis in ('estimate','timesheet','tracked')),
  note            text,
  entered_by      text        not null,
  entered_at      timestamptz not null default now(),
  unique (person, month, clickup_task_id)
);

comment on table public.cockpit_person_client_months is
  'Rough share of a person''s month per client. Estimates by default: ClickUp time tracking has never recorded an entry, so nothing here is measured unless basis says so.';

create index if not exists cockpit_person_client_months_month_idx
  on public.cockpit_person_client_months (month desc, clickup_task_id);

-- ---------------------------------------------------------------------------
-- 3. The billing fields on each ClickUp client card, day by day
-- ---------------------------------------------------------------------------
-- ClickUp keeps no field history and never will, so the day somebody retypes
-- the MRR field the old number is gone. The cockpit began writing this into
-- Convex on 2026-09-18; this is its Supabase home, and the shape is the same so
-- the existing rows port across unchanged.
--
-- One row per card per Kuwait day. Everything here is a number a person typed
-- on a card. None of it is a measurement.

create table if not exists public.cockpit_client_billing_days (
  day               date        not null,
  clickup_task_id   text        not null,
  client_name       text        not null,
  -- Client Status exactly as ClickUp spells it, so a stage rename is visible
  -- rather than silently remapped.
  stage             text,
  mrr_usd           numeric(14,2),
  ltv_usd           numeric(14,2),
  next_payment_usd  numeric(14,2),
  -- The currency the card's money fields declared, kept so a converted figure
  -- can always be traced back to what was typed.
  source_currency   char(3),
  next_payment_date date,
  signup_date       date,
  launch_date       date,
  paused_on         date,
  churn_date        date,
  next_renewal_date date,
  payment_plan      text,
  payment_method    text,
  contract_status   text,
  churn_reason      text,
  churn_type        text,
  closer            text,
  lead_source       text,
  captured_at       timestamptz not null default now(),
  primary key (day, clickup_task_id)
);

comment on table public.cockpit_client_billing_days is
  'Daily snapshot of the billing and lifecycle fields on the Clients - Mahara cards. Every value was typed by a person; a null means nobody filled the field, which is different from zero.';

create index if not exists cockpit_client_billing_days_card_idx
  on public.cockpit_client_billing_days (clickup_task_id, day desc);
create index if not exists cockpit_client_billing_days_day_idx
  on public.cockpit_client_billing_days (day desc);

-- ---------------------------------------------------------------------------
-- 4. Daily history for every cockpit metric
-- ---------------------------------------------------------------------------
-- The generic trend store behind every headline number, so a figure whose
-- source keeps no history of its own still has a past. Mirrors the Convex
-- `ceoDaily` table one for one.

create table if not exists public.cockpit_metric_days (
  day        date        not null,
  -- Dotted metric id, e.g. money.mrr.activeBook. Defined once in code.
  metric     text        not null,
  -- 'company', or 'client:<clickup id>', 'person:<key>', 'rep:<name>', 'agent:<name>'.
  scope      text        not null default 'company',
  value      double precision not null,
  captured_at timestamptz not null default now(),
  primary key (day, metric, scope)
);

comment on table public.cockpit_metric_days is
  'One value per metric per scope per Kuwait day. A day with no row means the metric was not computed that day, which is not the same as a zero.';

create index if not exists cockpit_metric_days_metric_idx
  on public.cockpit_metric_days (metric, scope, day desc);

-- ---------------------------------------------------------------------------
-- Access: service role only
-- ---------------------------------------------------------------------------
-- Payroll and per-client cost are the most sensitive numbers in the business.
-- RLS is on with no permissive policy, so the anon and authenticated browser
-- roles can read nothing at all; only the service-role key used by the backend
-- passes. Nothing here is ever reachable from a browser bundle.

alter table public.cockpit_payroll_months        enable row level security;
alter table public.cockpit_person_client_months  enable row level security;
alter table public.cockpit_client_billing_days   enable row level security;
alter table public.cockpit_metric_days           enable row level security;

revoke all on public.cockpit_payroll_months       from anon, authenticated;
revoke all on public.cockpit_person_client_months from anon, authenticated;
revoke all on public.cockpit_client_billing_days  from anon, authenticated;
revoke all on public.cockpit_metric_days          from anon, authenticated;

-- Keep updated_at honest on payroll edits.
create or replace function public.cockpit_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists cockpit_payroll_months_touch on public.cockpit_payroll_months;
create trigger cockpit_payroll_months_touch
  before update on public.cockpit_payroll_months
  for each row execute function public.cockpit_touch_updated_at();

commit;
