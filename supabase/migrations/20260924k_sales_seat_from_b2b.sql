-- A seat linked to a B2B rep takes the rep's Maqsam and Fathom addresses
-- unless the seat names its own. Aziz, 2026-09-24: "use my account so we can
-- test out the dialer on Maqsam". His seat had no Maqsam address while B2B's
-- rep directory had carried aziz@maharamedia.com all along, so the dialer
-- refused him. `maqsam_from` / `fathom_from` say which one is in use, so the
-- Team page can show it rather than an empty box.

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
  r public.cockpit_sales_reps%rowtype;
  ceo boolean;
  own_maqsam text;
  own_fathom text;
begin
  if e is null then
    return jsonb_build_object('signed_in', false);
  end if;
  ceo := public.cockpit_is_ceo();
  select * into p from public.cockpit_sales_people where email = e;
  if p.b2b_rep_id is not null then
    select * into r from public.cockpit_sales_reps where id = p.b2b_rep_id;
  end if;
  own_maqsam := nullif(btrim(p.maqsam_email), '');
  own_fathom := nullif(btrim(p.fathom_email), '');
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
    'maqsam_email', coalesce(own_maqsam, nullif(btrim(r.maqsam_email), '')),
    'maqsam_from', case
      when own_maqsam is not null then 'seat'
      when nullif(btrim(r.maqsam_email), '') is not null then 'b2b'
    end,
    'fathom_email', coalesce(own_fathom, nullif(btrim(r.fathom_email), '')),
    'fathom_from', case
      when own_fathom is not null then 'seat'
      when nullif(btrim(r.fathom_email), '') is not null then 'b2b'
    end,
    'slack_user_id', p.slack_user_id
  );
end;
$$;

revoke all on function public.cockpit_sales_whoami() from public, anon, authenticated, service_role;
grant execute on function public.cockpit_sales_whoami() to authenticated, service_role;

commit;
