-- Speed to lead counts the setter's calls (2026-11-05).
--
-- The setter's seat has no row on B2B's rep roster, so the sales desk copies
-- his Maqsam calls with no sales_rep_id (hermes/sales-desk/desk/
-- maqsam_calls.py rep_ids), and every speed-to-lead reader dropped them:
-- the Numbers page (apps/sales-cockpit/src/lib/calls.ts), the dialer's
-- strip (sales-api dialer.ts speedToday) and the CEO cockpit (hermes/
-- ceo-refresh/native/adapters/growth.js). B2B stays read only, so the rule
-- now lives on this side: a call counts when it carries B2B's rep id, or
-- when it was made from a sales seat's Maqsam address (a seat's or a roster
-- rep's maqsam_email). A call-centre agent's call is neither.
--
-- The Numbers page runs in the browser, where row security lets a rep read
-- only their own seat, so it cannot see which other addresses are seats'.
-- This function gives any seat the addresses alone (nothing else from the
-- seat rows), the same addresses cockpit_sales_reps already shows every seat
-- for the roster. Before it is applied the page reads what row security
-- allows and says the count may miss another seat's calls.
--
-- No table, so no row security to add; the function checks the seat itself
-- and is closed to public and anon, opened to authenticated and service_role.

create or replace function public.cockpit_sales_line_agents()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct lower(btrim(a.maqsam_email))
    from (
      select p.maqsam_email from public.cockpit_sales_people as p
      union all
      select r.maqsam_email from public.cockpit_sales_reps as r
    ) as a
   where public.cockpit_sales_seat()
     and a.maqsam_email is not null
     and position('@' in a.maqsam_email) > 0
$$;

comment on function public.cockpit_sales_line_agents() is
  'The sales seats'' Maqsam addresses, lower case: every cockpit_sales_people and cockpit_sales_reps maqsam_email. A Maqsam call from one of them, or with B2B''s sales_rep_id, is a sales seat''s call for speed to lead (calls.ts salesLineCall). Seats only; anyone else gets none.';

revoke all on function public.cockpit_sales_line_agents() from public, anon;
grant execute on function public.cockpit_sales_line_agents() to authenticated, service_role;

notify pgrst, 'reload schema';
