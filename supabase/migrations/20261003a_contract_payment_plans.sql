-- The two payment plans new clients get (Aziz, 2026-10-03: "from now also
-- the payments are changing so instead we only have 2 options for newer
-- clients $3k $3k after 30 days or $6k pif").
--
-- The contract prints HighLevel's Payment Structure For Program right after
-- "The total program fee is $6,000", so the plans carry their amounts. They
-- were added to that HighLevel field the same day (it keeps the four old
-- ones for older contacts), to the New Client Form (whose other payment
-- choices were removed), and to Make's ClickUp mapping (on the same ClickUp
-- options as the old paid-in-full and split plans). The contract card offers
-- only these two from now on.
--
-- Idempotent: once the options are the two plans, nothing changes.

begin;

with before as (
  select value from public.cockpit_sales_settings where key = 'contracts'
),
next as (
  select jsonb_set(b.value, '{fields,payment_structure,options}',
           '["Paid in full ($6,000)", "Split pay ($3,000 + $3,000 after 30 days)"]'::jsonb) as value
    from before b
   where b.value #> '{fields,payment_structure,options}'
         is distinct from '["Paid in full ($6,000)", "Split pay ($3,000 + $3,000 after 30 days)"]'::jsonb
     and b.value #>> '{fields,payment_structure,id}' is not null
),
done as (
  update public.cockpit_sales_settings s
     set value = n.value,
         updated_by = 'migration 20261003a',
         updated_at = now()
    from next n
   where s.key = 'contracts'
  returning s.value
)
insert into public.cockpit_audit_log
  (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
select 'contract.payment_plans', 'cockpit_sales_settings', 'contracts', null, 'sales', 'migration',
       (select value #> '{fields,payment_structure,options}' from before), d.value #> '{fields,payment_structure,options}',
       jsonb_build_object(
         'by', 'migration 20261003a',
         'why', 'Aziz, 2026-10-03: new clients pay $6,000 in full, or $3,000 and $3,000 30 days later')
  from done d;

commit;
