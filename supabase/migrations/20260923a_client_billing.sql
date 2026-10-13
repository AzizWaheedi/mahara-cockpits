-- Client billing: one sheet over ClickUp, a log of every decision, and an
-- inbox for payments logged outside the CEO cockpit
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive.
--
-- Aziz, 2026-09-23: "add a client billing section for both the CEO cockpit
-- and the client success one, where it's like a sheet where we can see all
-- the clients and where they're at with billing, and make decisions on it.
-- It's tied to ClickUp, and it updates in a two-way sync... which type of
-- payment they're going to use, their next payment date, if they need an
-- extension or they need to be paused... we already have a client billing
-- agent called Maher, so you can tie it to that so it can update that... For
-- any payments that come through, if it doesn't know which client it's for,
-- we can add it as well, so we can make sure what's our client LTV."
--
-- Where each fact lives, so nothing is kept twice:
--
--   - A client's billing state (how they pay, on what plan, how much, when
--     next, paused since, extended by) is the ClickUp card. It is the system
--     of record. cockpit_billing_accounts is its mirror: the sync writes it
--     from ClickUp, and every edit made in a cockpit writes ClickUp first and
--     this table second, so the two can only disagree until the next sync.
--
--   - Money received is the cockpit's existing ledger: hand-logged payments,
--     Whop, Tap and the bank statements, deduplicated and attributed to a
--     client by the money section, with LTV summed from it. Nothing here is
--     a second ledger. cockpit_billing_inbox is where a payment logged by
--     Maher or from the client success cockpit waits until the CEO cockpit
--     takes it into that ledger, checks it is not already there, and marks
--     it. A payment logged while the cockpit is down is therefore not lost.
--
--   - Every decision, from any cockpit or from Maher, is one row in
--     cockpit_billing_events: the extension log and the overdue log from the
--     old tracker, kept by the system instead of by hand.
--
-- portal_data.billing_* belongs to Mahara OS and is its Tap invoice flow; it
-- is read, never written, from here.

begin;

create table if not exists public.cockpit_billing_accounts (
  clickup_task_id     text primary key,
  client_name         text not null,
  task_url            text,
  -- The card's ClickUp status, and the group the cockpit files it under:
  -- active, paused, pipeline, sales, gone.
  stage               text,
  stage_group         text,
  client_status       text,
  payment_method      text,
  payment_plan        text,
  country             text,
  -- ClickUp's currency fields on this list are dollars.
  next_payment_usd    numeric check (next_payment_usd is null or next_payment_usd >= 0),
  next_payment_date   date,
  mrr_usd             numeric,
  ltv_field_usd       numeric,
  paused_on           date,
  extension_weeks     numeric check (extension_weeks is null or extension_weeks >= 0),
  churn_date          date,
  csm                 text,
  -- Who last wrote this row: the sync, or an edit from a cockpit or Maher.
  source              text not null default 'sync'
                      check (source in ('sync', 'ceo', 'csm', 'maher')),
  synced_at           timestamptz not null default now()
);
comment on table public.cockpit_billing_accounts is
  'The billing fields on every Clients - Mahara ClickUp card. ClickUp is the record; this is its mirror, written by the sync and by every cockpit edit after the edit has reached ClickUp. Maher reads it.';
create index if not exists cockpit_billing_accounts_next_idx
  on public.cockpit_billing_accounts (next_payment_date);

create table if not exists public.cockpit_billing_events (
  id              bigserial primary key,
  clickup_task_id text not null,
  client_name     text,
  kind            text not null check (kind in (
                    'method', 'plan', 'amount', 'date', 'extension', 'pause',
                    'resume', 'payment', 'assign', 'note', 'churn', 'invoice',
                    'chase')),
  from_value      text,
  to_value        text,
  reason          text,
  -- For an extension: in or out of our control, what the client was told.
  detail          jsonb,
  source          text not null check (source in ('ceo', 'csm', 'maher', 'clickup')),
  by_whom         text not null,
  at              timestamptz not null default now()
);
comment on table public.cockpit_billing_events is
  'Every billing decision, whoever made it: a method or plan changed, a date moved, an extension granted, a pause, a payment logged, money assigned to a client. The extension and overdue logs of the old churn tracker, kept by the system.';
create index if not exists cockpit_billing_events_client_idx
  on public.cockpit_billing_events (clickup_task_id, at desc);
create index if not exists cockpit_billing_events_at_idx
  on public.cockpit_billing_events (at desc);

create table if not exists public.cockpit_billing_inbox (
  id              bigserial primary key,
  clickup_task_id text not null,
  client_name     text,
  paid_on         date not null,
  amount          numeric not null check (amount > 0),
  currency        text not null check (currency in ('USD', 'KWD')),
  -- The ledger's rails. Card and Whop money arrives through its own feed and
  -- is never typed in, or it would be counted twice.
  method          text not null check (method in (
                    'bank_transfer', 'cheque', 'cash', 'tap', 'other')),
  reference       text,
  -- The SOP: a bank transfer without its receipt photo counts as unpaid.
  evidence_url    text,
  note            text,
  source          text not null check (source in ('csm', 'maher', 'other')),
  logged_by       text not null,
  logged_at       timestamptz not null default now(),
  status          text not null default 'pending'
                  check (status in ('pending', 'ingested', 'duplicate', 'rejected')),
  -- The ledger row it became, and why it did not when it did not.
  ledger_id       text,
  status_note     text,
  settled_at      timestamptz
);
comment on table public.cockpit_billing_inbox is
  'Payments logged by Maher or from the client success cockpit, waiting for the CEO cockpit to take them into the ledger. pending until then; ingested with the ledger id; duplicate when the same payment was already logged; rejected with the reason.';
create index if not exists cockpit_billing_inbox_pending_idx
  on public.cockpit_billing_inbox (status, logged_at) where status = 'pending';

alter table public.cockpit_billing_accounts enable row level security;
alter table public.cockpit_billing_events   enable row level security;
alter table public.cockpit_billing_inbox    enable row level security;

revoke all on public.cockpit_billing_accounts from anon, authenticated;
revoke all on public.cockpit_billing_events   from anon, authenticated;
revoke all on public.cockpit_billing_inbox    from anon, authenticated;
revoke all on sequence public.cockpit_billing_events_id_seq from anon, authenticated;
revoke all on sequence public.cockpit_billing_inbox_id_seq  from anon, authenticated;

commit;
