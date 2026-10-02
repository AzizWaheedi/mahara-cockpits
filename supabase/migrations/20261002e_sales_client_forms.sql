-- The New Client Form, filled on a lead's page in the sales cockpit (Aziz,
-- 2026-10-02: "connect the new client typeform into that thing with all the
-- questions there ... as easy as possible for the closer to fill ... so that
-- it triggers the same make scenario it already triggers, but in the cockpit
-- itself").
--
-- The closer fills the real Typeform, embedded on the lead's page with its
-- hidden fields (contact_id, closer, setter) set from the lead. Typeform
-- stores the response and starts everything it starts today: Make's "10.
-- Closer Form to Onboarding (MAIN)", the HighLevel workflow, Cortana, and
-- B2B's typeform-sync for closed_deals. When Typeform says it saved the
-- response, sales-api writes a row here: which lead, which response, who sent
-- it. The deal itself reaches the cockpit through B2B (cockpit_sales_deals,
-- by response_id): that is the second source that it arrived.
--
-- The form's questions, for the list beside it, are the setting
-- `client_form`, written by the sales desk from Typeform every ten minutes.
--
-- Every seat reads the rows; only sales-api writes them, with an audit row.

begin;

create table if not exists public.cockpit_sales_client_forms (
  response_id  text primary key check (response_id ~ '^[A-Za-z0-9]{8,64}$'),
  contact_id   text not null,
  form_id      text not null,
  hidden       jsonb not null default '{}'::jsonb,
  sent_by      text not null,
  sent_by_name text,
  sent_at      timestamptz not null default now()
);

comment on table public.cockpit_sales_client_forms is
  'New Client Forms filled on a lead''s page: the Typeform response, the lead, and who sent it. The answers live in Typeform and reach B2B closed_deals (and cockpit_sales_deals) by response_id.';
comment on column public.cockpit_sales_client_forms.hidden is
  'The hidden fields the embedded form carried: contact_id, closer, setter.';

create index if not exists cockpit_sales_client_forms_contact
  on public.cockpit_sales_client_forms (contact_id, sent_at desc);

alter table public.cockpit_sales_client_forms enable row level security;
drop policy if exists cockpit_sales_client_forms_seat_read on public.cockpit_sales_client_forms;
create policy cockpit_sales_client_forms_seat_read on public.cockpit_sales_client_forms
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on public.cockpit_sales_client_forms from public, anon, authenticated;
grant select on public.cockpit_sales_client_forms to authenticated;
grant all on public.cockpit_sales_client_forms to service_role;

notify pgrst, 'reload schema';

commit;
