-- Ecom Payments: the new rail for every new payment link (Aziz, 2026-10-22).
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive. Tap, Whop, bank and manual
-- stay as they are, for logging and for links already sent.
--
-- 1. cockpit_ecom_invoices: one row per Ecom E-Links invoice, filled two ways
--    by the Edge Function ecom-payments-sync: the signed Ecom webhook (as it
--    happens) and a reconciliation every 15 minutes that lists every invoice
--    (Ecom has no "list transactions" endpoint, so the invoice list is the
--    ledger). A PAID row is cash, at the KWD amount Ecom charged and in USD at
--    the rate the invoice was made with, or the cockpit's fixed rate when the
--    invoice came from outside the cockpit.
-- 2. cockpit_ecom_events: every webhook as received, signature result
--    included, so a dispute can be traced.
-- 3. cockpit_invoices: a third link source, 'ecom', next to 'pasted' and
--    'whop'. The worker makes the Ecom invoice in KWD at the day's rate and
--    records the rate it used.

begin;

create table if not exists public.cockpit_ecom_invoices (
  id               text primary key,                 -- INV_...
  invoice_number   text,
  ecom_reference   text,                             -- E_L_...
  merchant_reference text,
  status           text not null,                    -- UNPAID | PAID | EXPIRED | CANCELLED ...
  amount_kwd       numeric(14,3) not null,
  currency         text not null default 'KWD',
  usd              numeric(14,2),
  usd_rate         numeric(12,6),                     -- USD per 1 KWD used for usd
  usd_rate_source  text,                             -- 'invoice' (cockpit rate at creation) | 'fixed'
  payment_method   text,
  paid_at          timestamptz,
  day              date,                             -- Kuwait day of paid_at, else of created_at
  customer_name    text,
  customer_email   text,
  description      text,
  payment_url      text,
  cockpit_invoice_id uuid,
  created_at       timestamptz,
  raw              jsonb,
  synced_at        timestamptz not null default now()
);
comment on table public.cockpit_ecom_invoices is
  'Ecom Payments E-Links invoices (live merchant), filled by the ecom-payments-sync Edge Function from the signed webhook and a 15-minute reconciliation. status PAID is cash. usd is converted at the rate the cockpit used when it made the invoice (usd_rate_source invoice) or at the fixed cockpit rate (fixed).';
create index if not exists cockpit_ecom_invoices_day_idx on public.cockpit_ecom_invoices (day);
create index if not exists cockpit_ecom_invoices_status_idx on public.cockpit_ecom_invoices (status);
create index if not exists cockpit_ecom_invoices_cockpit_idx on public.cockpit_ecom_invoices (cockpit_invoice_id);

create table if not exists public.cockpit_ecom_events (
  id            bigserial primary key,
  received_at   timestamptz not null default now(),
  event_type    text,
  signature_ok  boolean not null,
  ecom_id       text,
  product_token text,
  status        text,
  payload       jsonb not null
);
comment on table public.cockpit_ecom_events is
  'Every Ecom webhook as received by ecom-payments-sync, with whether its X-Webhook-Signature matched. Unsigned or mismatched events are kept for tracing and never change a ledger row.';

alter table public.cockpit_ecom_invoices enable row level security;
alter table public.cockpit_ecom_events   enable row level security;
revoke all on public.cockpit_ecom_invoices from anon, authenticated;
revoke all on public.cockpit_ecom_events   from anon, authenticated;
grant select on public.cockpit_ecom_invoices to authenticated;
drop policy if exists cockpit_ecom_invoices_read on public.cockpit_ecom_invoices;
create policy cockpit_ecom_invoices_read on public.cockpit_ecom_invoices for select to authenticated
  using (coalesce(public.cockpit_is_ceo(), false) or coalesce(public.cockpit_has_role('admin'), false) or coalesce(public.cockpit_has_role('finance'), false));

-- 3. The invoice desk's Ecom link ------------------------------------------
alter table public.cockpit_invoices
  add column if not exists ecom_invoice_id text check (ecom_invoice_id is null or ecom_invoice_id ~ '^INV_[A-Za-z0-9_-]{6,80}$'),
  add column if not exists ecom_started_at timestamptz,
  add column if not exists amount_kwd numeric(14,3) check (amount_kwd is null or amount_kwd > 0),
  add column if not exists kwd_rate numeric(12,6) check (kwd_rate is null or kwd_rate > 0),
  add column if not exists kwd_rate_at timestamptz;
comment on column public.cockpit_invoices.amount_kwd is 'Ecom invoices only: the KWD amount charged, amount_usd times kwd_rate rounded to 3 decimals.';
comment on column public.cockpit_invoices.kwd_rate is 'Ecom invoices only: KWD per 1 USD on the day the worker made the link (open.er-api.com), with its time in kwd_rate_at.';

alter table public.cockpit_invoices drop constraint if exists cockpit_invoices_checkout_source_check;
alter table public.cockpit_invoices add constraint cockpit_invoices_checkout_source_check
  check (checkout_source in ('pasted', 'whop', 'ecom'));
alter table public.cockpit_invoices drop constraint if exists cockpit_invoices_kind_fields;
alter table public.cockpit_invoices add constraint cockpit_invoices_kind_fields check (
  (kind = 'checkout' and due_date is not null and (checkout_url is not null or checkout_source in ('whop', 'ecom'))) or
  (kind = 'autocharge' and due_date is not null) or
  (kind = 'paid' and jsonb_array_length(payments) between 1 and 12));
alter table public.cockpit_invoices drop constraint if exists cockpit_invoices_ecom_only;
alter table public.cockpit_invoices add constraint cockpit_invoices_ecom_only
  check (checkout_source = 'ecom' or (ecom_invoice_id is null and ecom_started_at is null and amount_kwd is null and kwd_rate is null));

commit;
