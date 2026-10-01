-- Contracts from the sales cockpit, through HighLevel's Documents &
-- Contracts (Aziz, 2026-10-01: "an easy way for the sales people to send and
-- edit contracts to clients using our main contract templates"; "we use ghl
-- to send contracts").
--
-- A row is a HighLevel document the cockpit made from one of the main
-- templates for a lead: sales-api writes it when a rep creates the draft and
-- when it is sent, and contract.refresh reads its status back (draft, sent,
-- viewed, completed). Contracts sent from HighLevel directly are not copied:
-- the same account holds the team's own employment contracts.
--
-- Every seat reads the rows except the client's signing link. Whoever holds
-- that link can sign as the client, so only sales-api hands it out
-- (contract.link, to the closers and managers).

begin;

create table if not exists public.cockpit_sales_contracts (
  document_id text primary key,
  contact_id text not null,
  template_id text not null,
  template_name text not null,
  name text,
  status text not null default 'draft',
  fields jsonb not null default '{}'::jsonb,
  client_link text,
  created_by text not null,
  sent_by text,
  sent_via text check (sent_via is null or sent_via in ('email', 'link')),
  sent_at timestamptz,
  viewed_at timestamptz,
  signed_at timestamptz,
  revision int,
  ghl_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  checked_at timestamptz
);

comment on table public.cockpit_sales_contracts is
  'Contracts the sales cockpit made in HighLevel from a main template, with their status as HighLevel last reported it.';
comment on column public.cockpit_sales_contracts.fields is
  'What the rep filled in before the draft was made: company_name, payment_structure, daily_ad_spend.';
comment on column public.cockpit_sales_contracts.client_link is
  'The client''s signing link. Not readable by seats: sales-api hands it to closers and managers.';
comment on column public.cockpit_sales_contracts.checked_at is
  'When the status was last read back from HighLevel.';

create index if not exists cockpit_sales_contracts_contact
  on public.cockpit_sales_contracts (contact_id, created_at desc);
create index if not exists cockpit_sales_contracts_open
  on public.cockpit_sales_contracts (status) where status in ('draft', 'sent', 'viewed');

alter table public.cockpit_sales_contracts enable row level security;
drop policy if exists cockpit_sales_contracts_seat_read on public.cockpit_sales_contracts;
create policy cockpit_sales_contracts_seat_read on public.cockpit_sales_contracts
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on public.cockpit_sales_contracts from public, anon, authenticated;
-- Every column but the signing link.
grant select (
  document_id, contact_id, template_id, template_name, name, status, fields,
  created_by, sent_by, sent_via, sent_at, viewed_at, signed_at, revision,
  ghl_updated_at, created_at, updated_at, checked_at
) on public.cockpit_sales_contracts to authenticated;
grant all on public.cockpit_sales_contracts to service_role;

-- The main templates, and the HighLevel fields each one fills in. Read from
-- each template's own content on 2026-10-01: every one uses
-- {{contact.company_name}}; the 90-day, 60-day and month-to-month ones use
-- {{contact.payment_structure_for_program}}; the 90-day and Special Offer use
-- {{contact.daily_ad_spend}}. A manager changes the list on the Contracts page.
-- HighLevel's own Contract Status and Contract URL fields are left alone:
-- writing them could start an automation in HighLevel nobody meant to start.
insert into public.cockpit_sales_settings (key, value, updated_by, updated_at)
values (
  'contracts',
  jsonb_build_object(
    'templates', jsonb_build_array(
      jsonb_build_object('id', '6905c43fc69d72f15bd69206', 'name', '90 Day Agreement',
        'fields', jsonb_build_array('company_name', 'payment_structure', 'daily_ad_spend')),
      jsonb_build_object('id', '69d25fce5d2b0f67fa21caab', 'name', '90 Day Agreement No G',
        'fields', jsonb_build_array('company_name', 'payment_structure')),
      jsonb_build_object('id', '6995853c5831c3bd20e03db7', 'name', '60 Day Agreement',
        'fields', jsonb_build_array('company_name', 'payment_structure')),
      jsonb_build_object('id', '6905c5456709f1453919ac3c', 'name', 'Month To Month Agreement',
        'fields', jsonb_build_array('company_name', 'payment_structure')),
      jsonb_build_object('id', '6a4cf9b8da68ef6b3d32c92c', 'name', 'Special Offer',
        'fields', jsonb_build_array('company_name', 'daily_ad_spend'))
    ),
    'fields', jsonb_build_object(
      'daily_ad_spend', jsonb_build_object('id', 'MVKV0Gu07a8yU1Tynqnt'),
      'payment_structure', jsonb_build_object('id', 'OmkRPnw5IEKzB4BFG9l9',
        'options', jsonb_build_array('Paid in full (90 days)', 'Split Pay (2x payments)',
          '1.0K Start / $2K Months After', 'Monthly'))
    ),
    'link_base', 'https://link.maharamedia.com/documents/v1/',
    'editor_url', 'https://app.gohighlevel.com/v2/location/7NI8yyJtwsh2OOWA5Icr/payments/proposals-estimates'
  ),
  'migration 20261001a',
  now()
)
on conflict (key) do nothing;

notify pgrst, 'reload schema';

commit;
