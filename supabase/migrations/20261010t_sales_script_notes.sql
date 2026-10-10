-- The call's notes saved as the call goes (sales simplify, 2026-10-10):
-- sales-api script.save keeps one cockpit_sales_notes row per call, named by
-- an id the rep's device makes, and updates it in place as the rep types.
-- No new table: the notes table's select grant and seat policy cover it.
begin;

alter table public.cockpit_sales_notes add column if not exists call_id uuid;

create unique index if not exists cockpit_sales_notes_script_call
  on public.cockpit_sales_notes (contact_id, call_id) where kind = 'script' and call_id is not null;

comment on column public.cockpit_sales_notes.call_id is
  'The call a script note belongs to (made on the rep''s device): sales-api script.save keeps one row per call and updates it as the call goes.';

commit;
