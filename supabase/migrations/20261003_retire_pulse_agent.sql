-- Retire PULSE-only reporting helpers. Client data and panel views remain intact.
-- pulse_client_credential(text) is shared by the client portal migration reader.
-- RESTRICT is intentional: stop rather than delete an unexpected dependent object.
begin;

drop function if exists public.pulse_sql_dump();
drop function if exists public.pulse_ads(text, date, date);
drop function if exists public.pulse_client_detail(text, date, date);
drop function if exists public.pulse_client_health(date);
drop function if exists public.pulse_freshness();
drop function if exists public.pulse_roster(text);

insert into public.cockpit_audit_log
  (action, entity_type, entity_id, source_app, source_system, before, after, metadata)
values
  ('retired', 'agent', 'client-watcher', 'maintenance', 'hermes',
   '{"daily_job":"acd8a3372bc3","selfcheck_job":"ce3b8d5bebf4","sidecar_port":3461}'::jsonb,
   '{"daily_job":null,"selfcheck_job":null,"runtime":"removed"}'::jsonb,
   '{"requested_by":"user","reason":"Recreate PULSE as a Supabase-backed reporting agent","preserved":["client source data","client panel views","shared portal credential RPC","Scout runtime","existing report artifacts"]}'::jsonb);

commit;
