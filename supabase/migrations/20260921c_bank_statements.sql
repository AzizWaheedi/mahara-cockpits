-- Bank statements, their lines, the expense exclusions, and the per-client
-- payment mirror (the LTV table)
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive.
--
-- Aziz, 2026-09-21: "Cash collected = the bank statement CSV I upload + Whop
-- payments ... Expenses = bank CSV + Whop card spend. Add an editable
-- exclusion list by card and vendor for personal spend ... every attributed
-- payment adds to the client's LTV table and the ClickUp LTV field."
--
-- CBK has no API, so a statement arrives as the CSV CBK Online exports: a
-- preamble (customer, account, period, currency), a Date,Amount,Balance,
-- Reference,TRSH_NUMBER table, and footer totals. The cockpit parses it on
-- the server, classifies every line, skips lines it already holds (hash),
-- and keeps the statement itself so the screen can say how old the newest
-- one is.

begin;

create table if not exists public.cockpit_statements (
  id            text primary key,
  account       text not null,
  account_kind  text not null default 'account' check (account_kind in ('account', 'card')),
  currency      text not null default 'KWD',
  from_day      date,
  to_day        date,
  lines         integer not null default 0,
  total_debit   numeric(14,3),
  total_credit  numeric(14,3),
  closing_balance numeric(14,3),
  file_name     text,
  imported_by   text not null,
  imported_at   timestamptz not null default now()
);
comment on table public.cockpit_statements is
  'One row per bank statement CSV uploaded on the CEO cockpit''s Money tab (CBK Online export). id = account + period.';

create table if not exists public.cockpit_bank_lines (
  id            bigserial primary key,
  statement_id  text not null references public.cockpit_statements(id) on delete cascade,
  account       text not null,
  account_kind  text not null default 'account',
  trsh          text,
  hash          text not null unique,
  day           date not null,
  amount        numeric(14,3) not null,
  balance       numeric(14,3),
  reference     text,
  currency      text not null default 'KWD',
  usd           numeric(14,2) not null,
  kind          text not null default 'unknown' check (kind in (
    'client_payment', 'whop_payout', 'whop_topup', 'tap_settlement', 'own_transfer',
    'refund_in', 'expense', 'fee', 'excluded', 'unknown')),
  category      text,
  matched_ref   text,
  matched_usd   numeric(14,2),
  note          text,
  imported_at   timestamptz not null default now()
);
comment on table public.cockpit_bank_lines is
  'Every line of every uploaded statement, signed amount in the statement currency and in USD at the cockpit''s fixed rate, with the kind the cockpit gave it. hash = account:TRSH_NUMBER, so a re-upload skips what is already here.';
create index if not exists cockpit_bank_lines_day_idx on public.cockpit_bank_lines (day);
create index if not exists cockpit_bank_lines_kind_idx on public.cockpit_bank_lines (kind);

create table if not exists public.cockpit_expense_exclusions (
  id        bigserial primary key,
  kind      text not null check (kind in ('card', 'vendor')),
  pattern   text not null,
  note      text,
  added_by  text not null,
  added_at  timestamptz not null default now()
);
comment on table public.cockpit_expense_exclusions is
  'Personal spend to keep out of the P&L: a card (the masked account on the statement) or a vendor (a case-insensitive fragment of the line''s reference). Excluded lines still show on the Transactions tab.';

create table if not exists public.cockpit_client_payments (
  payment_id       text primary key,
  clickup_task_id  text not null,
  client_name      text,
  day              date not null,
  usd              numeric(14,2) not null,
  rail             text not null,
  side             text not null,
  kind             text not null,
  person           text,
  recorded_at      timestamptz not null default now()
);
comment on table public.cockpit_client_payments is
  'Every payment in the CEO cockpit attributed to a client card (the client''s LTV table): rewritten by the money refresh from the attribution, one row per payment.';
create index if not exists cockpit_client_payments_client_idx on public.cockpit_client_payments (clickup_task_id, day);

alter table public.cockpit_statements          enable row level security;
alter table public.cockpit_bank_lines          enable row level security;
alter table public.cockpit_expense_exclusions  enable row level security;
alter table public.cockpit_client_payments     enable row level security;

revoke all on public.cockpit_statements         from anon, authenticated;
revoke all on public.cockpit_bank_lines         from anon, authenticated;
revoke all on public.cockpit_expense_exclusions from anon, authenticated;
revoke all on public.cockpit_client_payments    from anon, authenticated;

commit;
