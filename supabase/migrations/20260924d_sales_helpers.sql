-- Two helpers for the sales cockpit.
--
-- 1. cockpit_sales_link_dials(): Maqsam rows carry no contact id, so a call
--    reaches a lead by the last eight digits of the phone, the same join the
--    CEO cockpit uses (84% of calls join this way). Where two leads share the
--    digits, the newer lead wins. Run by the mirror after each copy; only the
--    service key may call it.
--
-- 2. cockpit_sales_calendar: each appointment with the rep's current mark
--    beside HighLevel's status. `needs_mark` is a past intro or demo that is
--    still new or confirmed in the CRM and has no mark in the cockpit: an
--    unmarked past call counts as shown in every show rate, so these are the
--    calls a rep is reminded about. security_invoker, so the seat policy on
--    the tables underneath still decides who sees a row.

begin;

create or replace function public.cockpit_sales_link_dials()
returns integer
language sql
security definer
set search_path = ''
as $$
  with m as (
    select distinct on (d.call_id) d.call_id, l.contact_id
      from public.cockpit_sales_dials as d
      join public.cockpit_sales_leads as l on l.phone8 = d.lead_phone8
     where d.contact_id is null
       and pg_catalog.length(coalesce(d.lead_phone8, '')) = 8
     order by d.call_id, l.lead_created_at desc nulls last
  ),
  u as (
    update public.cockpit_sales_dials as d
       set contact_id = m.contact_id
      from m
     where d.call_id = m.call_id
    returning 1
  )
  select pg_catalog.count(*)::integer from u;
$$;

revoke all on function public.cockpit_sales_link_dials() from public, anon, authenticated;
grant execute on function public.cockpit_sales_link_dials() to service_role;

create or replace view public.cockpit_sales_calendar
with (security_invoker = true) as
select
  a.appointment_id,
  a.contact_id,
  a.contact_name,
  a.calendar_id,
  a.call_type,
  a.start_at,
  a.booked_at,
  a.status as crm_status,
  a.assigned_user_id,
  a.assigned_user_name,
  a.ad_id,
  a.origin,
  a.mirrored_at,
  d.id as mark_id,
  d.status as marked_status,
  d.reason as mark_reason,
  d.note as mark_note,
  d.marked_by,
  d.marked_at,
  d.crm as mark_crm,
  d.crm_error as mark_crm_error,
  coalesce(d.status, a.status) as status,
  (
    a.start_at < now()
    and a.call_type in ('intro', 'demo')
    and coalesce(a.status, 'new') in ('new', 'confirmed')
    and d.id is null
  ) as needs_mark
from public.cockpit_sales_appointments as a
left join public.cockpit_sales_dispositions as d
  on d.appointment_id = a.appointment_id
 and d.superseded_at is null;

revoke all on public.cockpit_sales_calendar from public, anon, authenticated;
grant select on public.cockpit_sales_calendar to authenticated, service_role;

commit;
