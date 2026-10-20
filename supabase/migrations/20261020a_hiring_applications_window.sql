-- Hiring applications per role over a run of days, for the CEO Ads tab's hiring
-- campaigns (Aziz, 2026-10-20: "applications for hiring ads"). Read only.
-- An application carries no ad id, so this is every application the role's form
-- received in those days, from any source (ad, careers page, referral). The
-- screen says so beside the number.
create or replace function public.cockpit_hiring_applications_window(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
begin
  if not (coalesce(public.cockpit_is_ceo(), false) or coalesce(public.cockpit_has_role('admin'), false)) then
    raise exception 'Only the CEO and admins see hiring applications.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 400 then
    raise exception 'Pick a first and last day, at most 400 days apart.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'roles', coalesce((
      select jsonb_object_agg(role, n)
      from (
        select a.role, count(*) as n
        from public.cockpit_hiring_applications a
        where (a.at at time zone 'Asia/Kuwait')::date between p_from and p_to
        group by a.role
      ) r
    ), '{}'::jsonb)
  );
end $$;

revoke all on function public.cockpit_hiring_applications_window(date, date) from public, anon;
grant execute on function public.cockpit_hiring_applications_window(date, date) to authenticated;
