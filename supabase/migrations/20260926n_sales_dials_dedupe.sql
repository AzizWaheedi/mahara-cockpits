-- One call, one row. The sales desk writes the calls B2B does not keep (the
-- closers') from Maqsam's own history, under Maqsam's reference id. Maqsam's
-- ids differ between its API versions (none of 1,144 calls read both ways
-- shared an id), so if B2B later copies one of those calls too, it arrives
-- under another id. B2B's copy stays and the desk's goes: the same second,
-- and the same agent or the same lead's number. Run by sales-mirror after
-- every copy of B2B's calls.
create or replace function public.cockpit_sales_dedupe_dials()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.cockpit_sales_dials as m
     using public.cockpit_sales_dials as b
     where m.origin = 'maqsam'
       and b.origin = 'b2b'
       and pg_catalog.date_trunc('second', b.occurred_at) = pg_catalog.date_trunc('second', m.occurred_at)
       and (
         pg_catalog.lower(b.agent_email) = pg_catalog.lower(m.agent_email)
         or (m.lead_phone8 is not null and b.lead_phone8 = m.lead_phone8)
       )
    returning 1
  )
  select pg_catalog.count(*)::integer from gone;
$$;
revoke all on function public.cockpit_sales_dedupe_dials() from public, anon, authenticated;
grant execute on function public.cockpit_sales_dedupe_dials() to service_role;
