-- Keep the signature Ecom sends with each webhook, the raw body and the
-- non-secret headers, so the signature rule can be proven on a real delivery.
alter table public.cockpit_ecom_events
  add column if not exists signature_header text,
  add column if not exists raw_body text,
  add column if not exists headers jsonb;
