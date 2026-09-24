-- The New Client Form carries hidden fields since 2026-09-24 (Aziz: "Ok add
-- it"): contact_id, closer and setter, filled in by the sales cockpit when a
-- closer opens the form from a lead. The mirror keeps what they said:
-- `setter` for commission and the setter's numbers, and `contact_from` to
-- say whether the lead came from the form itself (exact) or from B2B's own
-- matching by email and phone (a best guess).

begin;

alter table public.cockpit_sales_deals
  add column if not exists setter text,
  add column if not exists contact_from text
    check (contact_from is null or contact_from in ('form', 'matched'));

commit;
