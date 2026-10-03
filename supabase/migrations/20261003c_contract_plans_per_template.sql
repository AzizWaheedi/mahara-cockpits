-- Each contract offers the payment plans that fit its own fee (Aziz,
-- 2026-10-03: "Fix the 60-day and month months where they make sense in the
-- contract").
--
-- The contract prints HighLevel's Payment Structure For Program right after
-- its fee. The 3-month contracts (7-day guarantee, No G) are $6,000. The
-- 60 Day Agreement is $4,000 for 60 days, then month to month. The Month To
-- Month Agreement is $2,000 for 30 days, then month to month. Each starts
-- with the $500 on the call. Special Offer prints no payment structure.
--
-- The three new plans were added the same day to HighLevel's field (beside
-- the older ones), the New Client Form and Make's ClickUp mapping. The
-- setting's whole list is every plan a contract may print; a template's own
-- `payments` is what the contract card offers for it.
--
-- Idempotent: once every template has its list, nothing changes.

begin;

with before as (
  select value from public.cockpit_sales_settings where key = 'contracts'
),
plans(id, payments) as (
  values
    ('6abe230d6bbbd5d9235bb774', '["Paid in full ($6,000)", "Split pay ($3,000 + $3,000 after 30 days)"]'::jsonb),
    ('69d25fce5d2b0f67fa21caab', '["Paid in full ($6,000)", "Split pay ($3,000 + $3,000 after 30 days)"]'::jsonb),
    ('6995853c5831c3bd20e03db7', '["Paid in full ($4,000)", "Split pay ($2,000 + $2,000 after 30 days)"]'::jsonb),
    ('6905c5456709f1453919ac3c', '["Monthly ($2,000 a month)"]'::jsonb)
),
next as (
  select jsonb_set(
           jsonb_set(b.value, '{templates}',
             (select jsonb_agg(case when p.payments is null then t else t || jsonb_build_object('payments', p.payments) end
                               order by ord)
                from jsonb_array_elements(b.value -> 'templates') with ordinality as x(t, ord)
                left join plans p on p.id = t ->> 'id')),
           '{fields,payment_structure,options}',
           '["Paid in full ($6,000)", "Split pay ($3,000 + $3,000 after 30 days)", "Paid in full ($4,000)", "Split pay ($2,000 + $2,000 after 30 days)", "Monthly ($2,000 a month)"]'::jsonb) as value
    from before b
   where exists (
           select 1
             from jsonb_array_elements(b.value -> 'templates') t
             join plans p on p.id = t ->> 'id'
            where t -> 'payments' is distinct from p.payments)
),
done as (
  update public.cockpit_sales_settings s
     set value = n.value,
         updated_by = 'migration 20261003c',
         updated_at = now()
    from next n
   where s.key = 'contracts'
  returning s.value
)
insert into public.cockpit_audit_log
  (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
select 'contract.payment_plans', 'cockpit_sales_settings', 'contracts', null, 'sales', 'migration',
       jsonb_build_object('templates', (select value -> 'templates' from before),
                          'options', (select value #> '{fields,payment_structure,options}' from before)),
       jsonb_build_object('templates', d.value -> 'templates',
                          'options', d.value #> '{fields,payment_structure,options}'),
       jsonb_build_object(
         'by', 'migration 20261003c',
         'why', 'Aziz, 2026-10-03: the 60 Day and Month To Month contracts get plans that fit their fees')
  from done d;

commit;
