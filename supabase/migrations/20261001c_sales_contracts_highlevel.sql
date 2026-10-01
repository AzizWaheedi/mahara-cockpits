-- Contracts made in HighLevel show in the sales cockpit too, and the cockpit
-- keeps HighLevel's own Contract Status and Contract URL contact fields in
-- step with each lead's latest contract (Aziz, 2026-10-01: "Make it do those
-- things").
--
-- sales-api's contract.sync, run by the sales mirror every three minutes,
-- copies every client contract HighLevel lists. A staff contract is told
-- apart by its name: one of the staff templates' names, or a role word
-- ("Media Buyer", "Editor"); documents carry no template id. Documents
-- nobody signs yet, and leads the cockpit does not have, are left out.
--
-- Contract Status and Contract URL were set on 5 and 1 of the 278 leads ever
-- sent a document (2026-10-01): nothing kept them in step before. Writing
-- Sent, Waiting On Client and Signed on the test lead changed nothing else
-- on it (tags, fields, stage, tasks, notes, messages, documents).

begin;

alter table public.cockpit_sales_contracts
  add column if not exists source text not null default 'cockpit';
alter table public.cockpit_sales_contracts
  drop constraint if exists cockpit_sales_contracts_source_check;
alter table public.cockpit_sales_contracts
  add constraint cockpit_sales_contracts_source_check check (source in ('cockpit', 'highlevel'));
-- A contract made in HighLevel names no template the cockpit can be sure of.
alter table public.cockpit_sales_contracts alter column template_id drop not null;
alter table public.cockpit_sales_contracts alter column template_name drop not null;

comment on table public.cockpit_sales_contracts is
  'Client contracts in HighLevel''s Documents & Contracts: the ones the cockpit made, and the ones made in HighLevel (source), with their status as HighLevel last reported it.';
comment on column public.cockpit_sales_contracts.source is
  'cockpit: made from a lead''s page. highlevel: made in HighLevel and copied by contract.sync.';

grant select (source) on public.cockpit_sales_contracts to authenticated;

-- What the cockpit last wrote to each lead's Contract Status and Contract URL,
-- so it writes only a change and clears only what it wrote. The service key
-- is the only door: the URL is the client's signing link.
create table if not exists public.cockpit_sales_contract_fields (
  contact_id text primary key,
  document_id text,
  status text,
  url text,
  written_at timestamptz not null default now()
);
comment on table public.cockpit_sales_contract_fields is
  'What sales-api last wrote to a lead''s HighLevel Contract Status and Contract URL fields.';
alter table public.cockpit_sales_contract_fields enable row level security;
revoke all on public.cockpit_sales_contract_fields from public, anon, authenticated;
grant all on public.cockpit_sales_contract_fields to service_role;

-- The two HighLevel fields (ids and options read from the location on
-- 2026-10-01), how a staff contract is recognised, and the switch.
update public.cockpit_sales_settings
   set value = value
     || jsonb_build_object(
          'fields', coalesce(value -> 'fields', '{}'::jsonb) || jsonb_build_object(
            'contract_status', jsonb_build_object('id', 'kB3F4M3NQwkME1BepTrW',
              'options', jsonb_build_array('Sent', 'Waiting On Client', 'Signed', 'Working on it',
                'No Contract Yet', 'CANCELLED')),
            'contract_url', jsonb_build_object('id', '83JWg4jIXDUUtyo0UheT')),
          'staff', jsonb_build_object(
            'names', jsonb_build_array('B2B Editor Agreement', 'B2B Phone Setter', 'CSM Contract',
              'CSR Contract', 'Chief Of Staff', 'Closer Contract',
              'Creative Strategist — Engagement Agreement', 'Media Buyer - Template', 'Tech Contract'),
            'words', jsonb_build_array('closer', 'setter', 'csm', 'csr', 'chief of staff', 'media buyer',
              'editor', 'creative strategist', 'employment', 'offer letter')),
          'write_fields', true),
       updated_by = 'migration 20261001c',
       updated_at = now()
 where key = 'contracts';

notify pgrst, 'reload schema';

commit;
