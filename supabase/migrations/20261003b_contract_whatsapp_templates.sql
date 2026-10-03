-- The templates HighLevel's workflow "3. WhatsApp the Contract Link (Arabic)"
-- sends the client a link for (Aziz, 2026-10-03: "make the workflow send them
-- the contract in a link in arabic on whatsapp").
--
-- The workflow (d7bdb897-e58e-4f8b-b83d-fbe9a404b96d) has one Documents &
-- Contracts trigger per template: status Sent, recipient a contact. It sends
-- the approved template contract_link_ar from +965 9005 4963, with the
-- contact's first name and the document's link. The contract card says
-- "and WhatsApp" only for these templates and a lead with a number, so a
-- template added to the picker later is not promised a message until the
-- workflow has a trigger for it too.
--
-- Idempotent: once the list is there, nothing changes.

begin;

with before as (
  select value from public.cockpit_sales_settings where key = 'contracts'
),
next as (
  select jsonb_set(b.value, '{whatsapp}', jsonb_build_object(
           'template_ids', '["6abe230d6bbbd5d9235bb774", "69d25fce5d2b0f67fa21caab", "6995853c5831c3bd20e03db7", "6905c5456709f1453919ac3c", "6a4cf9b8da68ef6b3d32c92c"]'::jsonb,
           'template', 'contract_link_ar',
           'workflow', '3. WhatsApp the Contract Link (Arabic)')) as value
    from before b
   where b.value -> 'whatsapp' is null
),
done as (
  update public.cockpit_sales_settings s
     set value = n.value,
         updated_by = 'migration 20261003b',
         updated_at = now()
    from next n
   where s.key = 'contracts'
  returning s.value
)
insert into public.cockpit_audit_log
  (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
select 'contract.whatsapp', 'cockpit_sales_settings', 'contracts', null, 'sales', 'migration',
       null, d.value -> 'whatsapp',
       jsonb_build_object(
         'by', 'migration 20261003b',
         'why', 'Aziz, 2026-10-03: HighLevel sends the client the contract link on WhatsApp, in Arabic')
  from done d;

commit;
