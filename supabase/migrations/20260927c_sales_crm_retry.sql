-- Saves HighLevel has not taken are sent again by the sales desk every two
-- minutes (the call centre's durable-worker lesson), at most five times and
-- ten minutes apart, so a contact HighLevel deleted is not retried forever.
alter table public.cockpit_sales_attempts add column if not exists crm_tries integer not null default 0;
alter table public.cockpit_sales_attempts add column if not exists crm_tried_at timestamptz;
create index if not exists cockpit_sales_attempts_crm_retry
  on public.cockpit_sales_attempts (saved_at)
  where crm_note in ('pending', 'failed');
