-- SMS paused in the workflows, not on the contacts (Aziz, 2026-10-29, while
-- 20261029c was running: "no pause it in the workflow").
--
-- 20261029c put SMS do not disturb on contacts one by one. It reached 605
-- contacts in about a quarter of an hour before it was stopped; all 605 were
-- set back the same hour (none still carries the cockpit_sms_pause marker),
-- so its table and switch go. The pause is now an edit of the HighLevel
-- workflows themselves: each SMS step (the WA2 Connector twin of a WhatsApp
-- step) is taken out, its neighbours joined up, and the workflow keeps the
-- status it had. One row per workflow keeps the whole step list from before
-- the edit, so the SMS steps can be put back exactly.

begin;

insert into public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
values ('sms.pause', 'cockpit_sales_sms_pause', 'all-contacts-with-a-phone', 'aziz@maharamedia.com', 'sales', 'claude',
        jsonb_build_object('paused', 605),
        jsonb_build_object('paused', 0, 'restored', 605),
        jsonb_build_object('why', 'Aziz: "no pause it in the workflow". The contact-level pause was stopped and undone; SMS is paused in the workflows instead.',
                           'run_by', 'Claude for Aziz, 2026-10-29'));

drop table if exists public.cockpit_sales_sms_pause;
delete from public.cockpit_sales_settings where key = 'sms_pause';

create table if not exists public.cockpit_sales_workflow_sms_pause (
  workflow_id text primary key,
  name text not null,
  -- The workflow's status (published or draft), kept as it was.
  status text not null,
  version_before integer,
  version_after integer,
  -- The SMS steps taken out: id, name, body and the steps either side.
  removed jsonb not null default '[]'::jsonb,
  -- workflowData.templates before the edit, to put the SMS steps back.
  backup jsonb not null,
  paused_at timestamptz,
  paused_by text,
  restored_at timestamptz,
  error text check (error is null or length(error) <= 1000),
  updated_at timestamptz not null default now()
);

alter table public.cockpit_sales_workflow_sms_pause enable row level security;
drop policy if exists cockpit_sales_workflow_sms_pause_seat_read on public.cockpit_sales_workflow_sms_pause;
create policy cockpit_sales_workflow_sms_pause_seat_read on public.cockpit_sales_workflow_sms_pause
  for select to authenticated using ((select public.cockpit_sales_manager()));
revoke all on table public.cockpit_sales_workflow_sms_pause from public, anon, authenticated;
grant select on table public.cockpit_sales_workflow_sms_pause to authenticated;
grant all on table public.cockpit_sales_workflow_sms_pause to service_role;

commit;
