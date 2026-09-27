-- Setter pay (Aziz, 2026-09-27): $500 base a month, $10 for each intro the
-- setter ran that showed and qualified, and $50 for each deal from their
-- leads that fully closed: "fully closed, not onboarding fee then ghosted".

-- Whether a deal fully closed, as a manager decided it. A deal paid in full
-- at signing is fully closed without anyone saying so; any other deal waits
-- for a manager, because nothing the cockpit reads can tell a client who
-- paid past the onboarding fee from one who paid it and disappeared.
create table if not exists public.cockpit_sales_deal_status (
  response_id text primary key,
  fully_closed boolean not null,
  note text,
  decided_by text not null,
  decided_at timestamptz not null default now()
);
alter table public.cockpit_sales_deal_status enable row level security;
drop policy if exists cockpit_sales_deal_status_seat_read on public.cockpit_sales_deal_status;
create policy cockpit_sales_deal_status_seat_read on public.cockpit_sales_deal_status
  for select to authenticated using ((select public.cockpit_sales_seat()));
grant select on public.cockpit_sales_deal_status to authenticated;
grant all on public.cockpit_sales_deal_status to service_role;

-- The deals credited to a setter in a window, for their pay: the New Client
-- Form's setter field when the form carried it, else the host of the lead's
-- last intro before the deal was signed. Voided deals never count. The
-- setter reads their own; managers read anyone's. Security definer because
-- row security on deals shows a setter only the deals that name them.
create or replace function public.cockpit_sales_setter_deals(
  p_rep_id text,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  response_id text,
  submitted_at timestamptz,
  closer text,
  client_name text,
  business_name text,
  payment_structure text,
  cash_collected numeric,
  contracted_revenue numeric,
  credited_by text,
  fully_closed boolean,
  fully_closed_by text
)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (
    select public.cockpit_sales_manager()
        or exists (
             select 1
               from public.cockpit_sales_people as p
              where p.email = public.cockpit_sales_email()
                and p.active
                and p.b2b_rep_id::text = p_rep_id
           ) as ok
  ),
  rep as (
    select r.ghl_user_id,
           array(
             select pg_catalog.lower(pg_catalog.btrim(x))
               from pg_catalog.unnest(coalesce(r.closer_aliases, '{}') || array[r.display_name]) as x
           ) as names
      from public.cockpit_sales_reps as r
     where r.id::text = p_rep_id
  ),
  credited as (
    select d.*,
           case
             when pg_catalog.lower(pg_catalog.btrim(coalesce(d.setter, ''))) = any ((select names from rep)::text[])
               then 'form'
             when nullif(pg_catalog.btrim(coalesce(d.setter, '')), '') is null
              and (select ghl_user_id from rep) is not null
              and (
                select a.assigned_user_id
                  from public.cockpit_sales_appointments as a
                 where a.contact_id = d.contact_id
                   and a.call_type = 'intro'
                   and a.start_at <= d.submitted_at
                 order by a.start_at desc
                 limit 1
              ) = (select ghl_user_id from rep)
               then 'intro'
           end as credit
      from public.cockpit_sales_deals as d
     where d.submitted_at >= p_from
       and d.submitted_at < p_to
       and not d.voided
  )
  select c.response_id, c.submitted_at, c.closer, c.client_name, c.business_name,
         c.payment_structure, c.cash_collected, c.contracted_revenue,
         c.credit as credited_by,
         coalesce(s.fully_closed, coalesce(c.contracted_revenue > 0 and c.cash_collected >= c.contracted_revenue, false))
           as fully_closed,
         case
           when s.response_id is not null then 'confirmed'
           when c.contracted_revenue > 0 and c.cash_collected >= c.contracted_revenue then 'paid in full'
         end as fully_closed_by
    from credited as c
    left join public.cockpit_sales_deal_status as s on s.response_id = c.response_id
   where c.credit is not null
     and (select ok from allowed)
   order by c.submitted_at desc;
$$;
revoke all on function public.cockpit_sales_setter_deals(text, timestamptz, timestamptz) from public, anon;
grant execute on function public.cockpit_sales_setter_deals(text, timestamptz, timestamptz) to authenticated, service_role;
