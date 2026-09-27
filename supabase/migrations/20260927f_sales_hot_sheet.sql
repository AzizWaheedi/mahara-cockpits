-- The hot list as a sheet (Aziz, 2026-09-27: "the hot list part should be a
-- bit simpler ... the same way a spreadsheet is for last follow-up, next
-- follow-up"). Each row now carries what his own sheet has: how hot the lead
-- is, where the deal stands, what it is worth, and when it was last followed
-- up by hand (the cockpit adds the lead's own last call and WhatsApp to that
-- on screen).
--
-- A closed or lost row stays on the list for the record; only a nurturing
-- row counts as hot for the dialer and the board (sales-api hot.ts stillHot).
-- Rows from before this migration read as nurturing, and a blank heat reads
-- as "Hot".
--
-- Written by sales-api with the service key; every seat reads. Row security
-- and the grants stay as 20260926c_sales_hot_list.sql set them, restated
-- here so the new columns ship with them.

begin;

alter table public.cockpit_sales_hot
  add column if not exists heat text
    check (heat is null or heat in ('red_hot', 'hot', 'warm')),
  add column if not exists status text not null default 'nurturing'
    check (status in ('nurturing', 'closed', 'lost')),
  add column if not exists amount numeric
    check (amount is null or amount >= 0),
  add column if not exists amount_currency text default 'USD'
    check (amount_currency is null or amount_currency in ('USD', 'KWD', 'SAR', 'AED', 'QAR', 'BHD', 'OMR')),
  add column if not exists last_fu_at timestamptz;

comment on column public.cockpit_sales_hot.heat is
  'Red hot, hot or warm (the sheet''s Lead Type). Null reads as hot.';
comment on column public.cockpit_sales_hot.status is
  'Nurturing, closed or lost. Only nurturing counts as hot for the dialer and the board.';
comment on column public.cockpit_sales_hot.amount is
  'What the deal is worth, in amount_currency. Null: not said yet (never zero).';
comment on column public.cockpit_sales_hot.last_fu_at is
  'The last follow-up marked by hand (the cell, or Followed up). The screen shows the latest of this, the last outbound call and the last WhatsApp we sent.';

alter table public.cockpit_sales_hot enable row level security;
revoke all on public.cockpit_sales_hot from public, anon, authenticated;
grant select on public.cockpit_sales_hot to authenticated;
grant all on public.cockpit_sales_hot to service_role;

notify pgrst, 'reload schema';

commit;
