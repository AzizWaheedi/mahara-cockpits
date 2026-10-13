-- Who is asking, in one call: the cockpit's shell and its server both ask
-- this, so the browser and the server can never disagree about a seat.

begin;

create or replace function public.cockpit_sales_whoami()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e text := public.cockpit_sales_email();
  p public.cockpit_sales_people%rowtype;
  ceo boolean;
begin
  if e is null then
    return jsonb_build_object('signed_in', false);
  end if;
  ceo := public.cockpit_is_ceo();
  select * into p from public.cockpit_sales_people where email = e;
  return jsonb_build_object(
    'signed_in', true,
    'email', e,
    'seat', public.cockpit_sales_seat(),
    'manager', public.cockpit_sales_manager(),
    'ceo', ceo,
    'name', p.name,
    'role', coalesce(p.role, case when ceo then 'manager' end),
    'active', p.active,
    'via_portal', p.via_portal,
    'ghl_user_id', p.ghl_user_id,
    'b2b_rep_id', p.b2b_rep_id,
    'maqsam_email', p.maqsam_email,
    'fathom_email', p.fathom_email,
    'slack_user_id', p.slack_user_id
  );
end;
$$;

revoke all on function public.cockpit_sales_whoami() from public, anon, authenticated, service_role;
grant execute on function public.cockpit_sales_whoami() to authenticated, service_role;

commit;
