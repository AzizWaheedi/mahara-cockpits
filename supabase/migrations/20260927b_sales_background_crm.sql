-- A save is stored first and HighLevel hears about it in the background
-- (the call centre's lesson, SOP-NEXT-LEAD: the next lead opens as soon as
-- the save is durable). The note waits as "pending" until HighLevel takes
-- it; one that failed keeps HighLevel's reason for the rep's saved work.
alter table public.cockpit_sales_attempts
  drop constraint if exists cockpit_sales_attempts_crm_note_check;
alter table public.cockpit_sales_attempts
  add constraint cockpit_sales_attempts_crm_note_check
  check (crm_note is null or crm_note = any (array['pending', 'written', 'failed', 'skipped']));
alter table public.cockpit_sales_attempts add column if not exists crm_error text;
