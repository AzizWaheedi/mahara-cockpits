-- The 7-day satisfaction guarantee contract in the sales cockpit's template
-- picker (Aziz, 2026-10-02: "Yes, add the 90-day agreement to the 7-day
-- satisfaction guarantee"). It takes the place of "90 Day Agreement", whose
-- section 3 guarantees 30 qualified appointments in 90 days or free work:
-- results are never guaranteed any more ("we legally can't give them a
-- result guarantee because everybody's different").
--
-- Read from the template's own content on 2026-10-02, through an unsent
-- draft on the test contact "Cockpit Test (ignore)": "90 Day Agreement (7 Day
-- Satisfaction Guarantee)" prints {{contact.company_name}} and
-- {{contact.payment_structure_for_program}}, not the daily ad spend. Its
-- section 3 refunds the full program fee when asked by email or WhatsApp
-- within 7 days of full payment, once the onboarding is done.
--
-- The other templates in the picker promise no results: 90 Day Agreement No
-- G, 60 Day Agreement and Month To Month Agreement carry no guarantee, and
-- Special Offer is a performance fee. A manager can still change the list on
-- the Contracts page; that change is audited, and so is this one.
--
-- Idempotent: once the 7-day template is in the list, nothing changes.

begin;

with before as (
  select value from public.cockpit_sales_settings where key = 'contracts'
),
next as (
  select jsonb_set(b.value, '{templates}',
           '[{"id": "6abe230d6bbbd5d9235bb774", "name": "90 Day Agreement (7 Day Satisfaction Guarantee)", "fields": ["company_name", "payment_structure"]}]'::jsonb
           || coalesce((select jsonb_agg(t order by ord)
                          from jsonb_array_elements(coalesce(b.value->'templates', '[]'::jsonb)) with ordinality as x(t, ord)
                         where t->>'id' not in ('6905c43fc69d72f15bd69206', '6abe230d6bbbd5d9235bb774')),
                       '[]'::jsonb)) as value
    from before b
   where not coalesce(b.value->'templates', '[]'::jsonb) @> '[{"id": "6abe230d6bbbd5d9235bb774"}]'::jsonb
),
done as (
  update public.cockpit_sales_settings s
     set value = n.value,
         updated_by = 'migration 20261002d',
         updated_at = now()
    from next n
   where s.key = 'contracts'
  returning s.value
)
insert into public.cockpit_audit_log
  (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
select 'contract.templates', 'cockpit_sales_settings', 'contracts', null, 'sales', 'migration',
       (select value->'templates' from before), d.value->'templates',
       jsonb_build_object(
         'by', 'migration 20261002d',
         'why', 'Aziz, 2026-10-02: the 7-day satisfaction guarantee contract replaces the one that guaranteed 30 appointments')
  from done d;

commit;
