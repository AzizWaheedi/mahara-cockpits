-- The review round of 26 September: seats, deal money, calls matched to the
-- right lead, repeated saves, duplicate recordings, a lock for the copy job,
-- and the indexes the lists sort by.

-- 1. Seats. A seat row decides on its own: a paused row is no seat, whatever
--    the portal says. Without a row, only an explicit 'sales' role opens the
--    cockpit; 'admin' alone no longer does (cockpit_has_role counts admin as
--    every role, which handed any portal admin a rep's seat).
create or replace function public.cockpit_sales_seat()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e text := public.cockpit_sales_email();
begin
  if e is null then
    return false;
  end if;
  if public.cockpit_is_ceo() then
    return true;
  end if;
  if exists (select 1 from public.cockpit_sales_people as p where p.email = e) then
    return exists (
      select 1 from public.cockpit_sales_people as p
       where p.email = e and p.via_portal and p.active
    );
  end if;
  return exists (
    select 1
      from public.cockpit_members as cm
      join auth.users as au on au.id = cm.auth_user_id
     where cm.active
       and cm.auth_user_id = auth.uid()
       and au.email_confirmed_at is not null
       and cm.email = e
       and 'sales' = any (cm.roles)
  );
end;
$$;

-- 2. A manual save names its request, so a double tap saves once.
alter table public.cockpit_sales_attempts add column if not exists request_id uuid;
create unique index if not exists cockpit_sales_attempts_request
  on public.cockpit_sales_attempts (request_id);

-- 3. A mark written to HighLevel with its automations held back says so.
alter table public.cockpit_sales_dispositions
  drop constraint if exists cockpit_sales_dispositions_crm_check;
alter table public.cockpit_sales_dispositions
  add constraint cockpit_sales_dispositions_crm_check
  check (crm = any (array['off', 'pending', 'written', 'quiet', 'skipped', 'failed']));

-- 4. Nobody signed in writes these tables, so nobody signed in needs their
--    counters (Supabase grants them by default).
revoke all on sequence public.cockpit_sales_mirror_runs_id_seq from anon, authenticated;
revoke all on sequence public.cockpit_sales_dispositions_id_seq from anon, authenticated;
revoke all on sequence public.cockpit_sales_ai_usage_id_seq from anon, authenticated;

-- 5. The orders the lists ask for, and the lookups that scanned.
create index if not exists cockpit_sales_leads_created_last
  on public.cockpit_sales_leads (lead_created_at desc nulls last);
create index if not exists cockpit_sales_dials_contact
  on public.cockpit_sales_dials (contact_id);
drop index if exists public.cockpit_sales_recordings_started_idx; -- same as _at
create index if not exists cockpit_sales_recordings_started_last
  on public.cockpit_sales_recordings (started_at desc nulls last);
create index if not exists cockpit_sales_messages_workflow_day
  on public.cockpit_sales_messages (created_at desc) where via = 'workflow';

-- 6. Calls matched to leads by the whole number. Thirteen pairs of leads share
--    their last eight digits, so eight digits alone gave some calls to the
--    wrong person. lead_digits holds every digit Maqsam stored; origin says
--    whether B2B copied the call or the sales desk read it from Maqsam itself
--    (B2B keeps setters' calls only).
alter table public.cockpit_sales_dials add column if not exists lead_digits text;
alter table public.cockpit_sales_dials
  add column if not exists origin text not null default 'b2b';
alter table public.cockpit_sales_dials drop constraint if exists cockpit_sales_dials_origin_check;
alter table public.cockpit_sales_dials
  add constraint cockpit_sales_dials_origin_check check (origin in ('b2b', 'maqsam'));

-- Links unlinked calls, and re-decides calls on shared last-eight digits.
-- When both numbers have nine or more digits they must agree on the last
-- nine; among leads with the same number, the one that existed at the call
-- wins. Eight digits alone link only when exactly one lead could be meant.
create or replace function public.cockpit_sales_link_dials()
returns integer
language sql
security definer
set search_path = ''
as $$
  with shared as (
    select l.phone8
      from public.cockpit_sales_leads as l
     where l.phone8 is not null
     group by l.phone8
    having pg_catalog.count(*) > 1
  ),
  todo as (
    select d.call_id,
           d.lead_phone8,
           d.occurred_at,
           pg_catalog.regexp_replace(coalesce(d.lead_digits, ''), '\D', '', 'g') as dd
      from public.cockpit_sales_dials as d
     where pg_catalog.length(coalesce(d.lead_phone8, '')) = 8
       and (d.contact_id is null or d.lead_phone8 in (select s.phone8 from shared as s))
  ),
  cand as (
    select t.call_id,
           l.contact_id,
           case
             when pg_catalog.length(t.dd) >= 9 and pg_catalog.length(x.ld) >= 9 then
               case when pg_catalog.right(t.dd, 9) = pg_catalog.right(x.ld, 9) then 'same' else 'other' end
             else 'maybe'
           end as fit,
           (l.lead_created_at is null or l.lead_created_at <= t.occurred_at + interval '1 hour') as existed,
           l.lead_created_at
      from todo as t
      join public.cockpit_sales_leads as l on l.phone8 = t.lead_phone8
      cross join lateral (
        select pg_catalog.regexp_replace(coalesce(l.phone, ''), '\D', '', 'g') as ld
      ) as x
  ),
  pick as (
    select c.call_id,
           case
             when pg_catalog.count(*) filter (where c.fit = 'same') > 0 then
               (array_agg(
                  c.contact_id
                  order by c.existed desc,
                           case when c.existed then c.lead_created_at end desc nulls last,
                           c.lead_created_at asc nulls last
                ) filter (where c.fit = 'same'))[1]
             when pg_catalog.count(*) filter (where c.fit = 'maybe') = 1 then
               (array_agg(c.contact_id) filter (where c.fit = 'maybe'))[1]
           end as contact_id
      from cand as c
     group by c.call_id
  ),
  u as (
    update public.cockpit_sales_dials as d
       set contact_id = p.contact_id
      from pick as p
     where d.call_id = p.call_id
       and d.contact_id is distinct from p.contact_id
    returning 1
  )
  select pg_catalog.count(*)::integer from u;
$$;
revoke all on function public.cockpit_sales_link_dials() from public, anon, authenticated;
grant execute on function public.cockpit_sales_link_dials() to service_role;

-- Per agent and day: calls Maqsam has against calls the cockpit holds, the
-- second source for every dial count. Written by the sales desk.
create table if not exists public.cockpit_sales_dial_checks (
  day date not null,
  agent_email text not null,
  maqsam_calls integer not null,
  copied_calls integer not null,
  checked_at timestamptz not null default now(),
  primary key (day, agent_email)
);
alter table public.cockpit_sales_dial_checks enable row level security;
drop policy if exists cockpit_sales_dial_checks_manager_read on public.cockpit_sales_dial_checks;
create policy cockpit_sales_dial_checks_manager_read on public.cockpit_sales_dial_checks
  for select to authenticated using ((select public.cockpit_sales_manager()));
grant select on public.cockpit_sales_dial_checks to authenticated;
grant all on public.cockpit_sales_dial_checks to service_role;

-- 7. Deal money. Any seat could read every deal's cash and contract value,
--    which is every closer's pay base. Now a rep reads the deals they closed
--    or set; managers read all. The lead page still shows every seat that a
--    lead signed, without the money, through cockpit_sales_lead_deals.
create or replace function public.cockpit_sales_my_names()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.n) filter (where x.n <> ''), '{}')
    from public.cockpit_sales_people as p
    join public.cockpit_sales_reps as r on r.id = p.b2b_rep_id
    cross join lateral pg_catalog.unnest(coalesce(r.closer_aliases, '{}') || array[r.display_name]) as a(raw)
    cross join lateral (select pg_catalog.lower(pg_catalog.btrim(a.raw)) as n) as x
   where p.email = public.cockpit_sales_email()
     and p.active;
$$;
revoke all on function public.cockpit_sales_my_names() from public, anon;
grant execute on function public.cockpit_sales_my_names() to authenticated, service_role;

drop policy if exists cockpit_sales_deals_seat_read on public.cockpit_sales_deals;
drop policy if exists cockpit_sales_deals_own_read on public.cockpit_sales_deals;
create policy cockpit_sales_deals_own_read on public.cockpit_sales_deals
  for select to authenticated
  using (
    (select public.cockpit_sales_manager())
    or (
      (select public.cockpit_sales_seat())
      and (
        pg_catalog.lower(pg_catalog.btrim(coalesce(closer, ''))) = any ((select public.cockpit_sales_my_names())::text[])
        or pg_catalog.lower(pg_catalog.btrim(coalesce(setter, ''))) = any ((select public.cockpit_sales_my_names())::text[])
      )
    )
  );

create or replace function public.cockpit_sales_lead_deals(p_contact_id text)
returns table (
  response_id text,
  submitted_at timestamptz,
  closer text,
  setter text,
  voided boolean,
  payment_structure text,
  agreement_type text
)
language sql
stable
security definer
set search_path = ''
as $$
  select d.response_id, d.submitted_at, d.closer, d.setter, d.voided,
         d.payment_structure, d.agreement_type
    from public.cockpit_sales_deals as d
   where public.cockpit_sales_seat()
     and d.contact_id = p_contact_id
   order by d.submitted_at desc;
$$;
revoke all on function public.cockpit_sales_lead_deals(text) from public, anon;
grant execute on function public.cockpit_sales_lead_deals(text) to authenticated, service_role;

-- The month the first deal was signed, for every seat: closes and cash
-- before it are unknown, not zero.
create or replace function public.cockpit_sales_first_deal_at()
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.min(d.submitted_at)
    from public.cockpit_sales_deals as d
   where public.cockpit_sales_seat();
$$;
revoke all on function public.cockpit_sales_first_deal_at() from public, anon;
grant execute on function public.cockpit_sales_first_deal_at() to authenticated, service_role;

-- 8. One meeting recorded twice, and phone "transcripts" that are only the
--    carrier's message, are hidden from the list and from review requests.
--    Two meeting recordings are one meeting when they start within ten
--    minutes of each other and share the lead or the person recording (nobody
--    holds two meetings at once). The longest is kept and the others point at
--    it; when only a hidden one knew the lead, the kept one takes it. Phone
--    calls are each their own call, never duplicates.
alter table public.cockpit_sales_recordings add column if not exists duplicate_of text;
alter table public.cockpit_sales_recordings add column if not exists hidden_reason text;
alter table public.cockpit_sales_recordings
  drop constraint if exists cockpit_sales_recordings_hidden_reason_check;
alter table public.cockpit_sales_recordings
  add constraint cockpit_sales_recordings_hidden_reason_check
  check (hidden_reason in ('duplicate', 'too short'));

create or replace function public.cockpit_sales_mark_recordings()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
  linked integer;
begin
  with best as (
    select r.recording_id,
           (select b.recording_id
              from public.cockpit_sales_recordings as b
             where coalesce(b.kind, '') = coalesce(r.kind, '')
               and b.started_at between r.started_at - interval '10 minutes'
                                    and r.started_at + interval '10 minutes'
               and (b.contact_id = r.contact_id or b.recorded_by = r.recorded_by)
             order by coalesce(b.duration_s, 0) desc,
                      coalesce(b.transcript_chars, 0) desc,
                      b.recording_id
             limit 1) as keep
      from public.cockpit_sales_recordings as r
     where r.started_at is not null
       and coalesce(r.kind, '') <> 'phone'
       and (r.contact_id is not null or r.recorded_by is not null)
  ),
  want as (
    select r.recording_id,
           case when b.keep <> r.recording_id then b.keep end as duplicate_of,
           case
             when b.keep <> r.recording_id then 'duplicate'
             when r.kind = 'phone'
              and r.transcript_path is not null
              and coalesce(r.transcript_chars, 0) < 200
              and coalesce(r.duration_s, 0) < 60 then 'too short'
           end as hidden_reason
      from public.cockpit_sales_recordings as r
      left join best as b on b.recording_id = r.recording_id
  )
  update public.cockpit_sales_recordings as r
     set duplicate_of = w.duplicate_of,
         hidden_reason = w.hidden_reason
    from want as w
   where r.recording_id = w.recording_id
     and (r.duplicate_of is distinct from w.duplicate_of
          or r.hidden_reason is distinct from w.hidden_reason);
  get diagnostics changed = row_count;

  update public.cockpit_sales_recordings as k
     set contact_id = h.contact_id,
         matched_by = 'same meeting'
    from (
      select distinct on (d.duplicate_of) d.duplicate_of, d.contact_id
        from public.cockpit_sales_recordings as d
       where d.duplicate_of is not null
         and d.contact_id is not null
       order by d.duplicate_of, coalesce(d.duration_s, 0) desc
    ) as h
   where k.recording_id = h.duplicate_of
     and k.contact_id is null;
  get diagnostics linked = row_count;

  return changed + linked;
end;
$$;
revoke all on function public.cockpit_sales_mark_recordings() from public, anon, authenticated;
grant execute on function public.cockpit_sales_mark_recordings() to service_role;
select public.cockpit_sales_mark_recordings();

-- 9. A lock for the copy job: a run that finds the last one still going
--    stops, so two runs never write (or drop) the same rows at once. A lock
--    nobody released lapses by itself.
create table if not exists public.cockpit_sales_locks (
  name text primary key,
  holder text not null,
  held_until timestamptz not null
);
alter table public.cockpit_sales_locks enable row level security;
grant all on public.cockpit_sales_locks to service_role;

create or replace function public.cockpit_sales_lock(p_name text, p_holder text, p_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  insert into public.cockpit_sales_locks as k (name, holder, held_until)
  values (p_name, p_holder, now() + pg_catalog.make_interval(secs => p_seconds))
  on conflict (name) do update
     set holder = excluded.holder, held_until = excluded.held_until
   where k.held_until < now() or k.holder = excluded.holder;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke all on function public.cockpit_sales_lock(text, text, integer) from public, anon, authenticated;
grant execute on function public.cockpit_sales_lock(text, text, integer) to service_role;

create or replace function public.cockpit_sales_unlock(p_name text, p_holder text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.cockpit_sales_locks where name = p_name and holder = p_holder;
$$;
revoke all on function public.cockpit_sales_unlock(text, text) from public, anon, authenticated;
grant execute on function public.cockpit_sales_unlock(text, text) to service_role;

-- 10. What the sales desk failed on, per job and item, so an item that keeps
--     failing is set aside for a day instead of retried every run.
create table if not exists public.cockpit_sales_desk_failures (
  job text not null,
  item_id text not null,
  failures integer not null default 1,
  last_error text,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (job, item_id)
);
alter table public.cockpit_sales_desk_failures enable row level security;
drop policy if exists cockpit_sales_desk_failures_manager_read on public.cockpit_sales_desk_failures;
create policy cockpit_sales_desk_failures_manager_read on public.cockpit_sales_desk_failures
  for select to authenticated using ((select public.cockpit_sales_manager()));
grant select on public.cockpit_sales_desk_failures to authenticated;
grant all on public.cockpit_sales_desk_failures to service_role;
