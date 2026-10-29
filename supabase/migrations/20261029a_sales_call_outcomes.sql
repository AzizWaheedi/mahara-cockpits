-- After the call (Aziz, 2026-10-29): "If they mark an intro as shown and they
-- didn't convert to a demo ... why that intro did not turn into a demo. There
-- has to be a specific reason." And: "after they mark anybody, whether it be
-- intros or demos ... rate the lead quality from 1 to 10 (so I can also get
-- the qualitative metrics from the setter and the closer)."
--
-- 1. cockpit_sales_call_outcomes: one row per intro or demo the rep held, with
--    the lead's quality (1 to 10) and, for an intro that booked no demo, the
--    reason. Written only by sales-api (call.outcome), which audits it.
-- 2. cockpit_sales_outcome_missing(): the one rule for what a held call still
--    needs. The EOD check below, sales-api's dayReview.ts and the app's
--    lib/afterCall.ts say the same.
-- 3. cockpit_sales_calendar (the view): the same columns in the same order,
--    with the answers, the lead's next demo and whether they signed appended.
-- 4. cockpit_sales_funnel(): intros to demos for a window, the reasons, and the
--    lead quality by who rated it, gated to a sales seat.
-- 5. The end of day's check is 20261029b_sales_eod_outcomes.sql, applied once
--    the screens that answer it are live.
--
-- An intro "turned into a demo" when the lead has a demo booked at or after
-- the intro's start, as B2B's b2b_window_metrics counts it, with 30 minutes of
-- grace: an intro held a few minutes early that booked the demo on the call
-- counts (4 such intros in August 2026 that B2B's rule misses; none in
-- October). An intro the lead signed on (a New Client Form at or after the
-- intro, voided ones out) moved forward too, and is counted apart.

begin;

-- 1. The answers ------------------------------------------------------------------

create table if not exists public.cockpit_sales_call_outcomes (
  appointment_id text primary key,
  contact_id     text,
  call_type      text not null check (call_type in ('intro', 'demo')),
  start_at       timestamptz,
  lead_quality   smallint check (lead_quality between 1 and 10),
  quality_by     text,
  quality_role   text,
  quality_at     timestamptz,
  no_demo_reason text check (no_demo_reason in (
    'signed', 'no_budget', 'too_small', 'not_decision_maker', 'not_a_fit',
    'no_need', 'not_ready', 'has_agency', 'price_only', 'thinking', 'other')),
  no_demo_note   text check (no_demo_note is null or char_length(no_demo_note) <= 500),
  reason_by      text,
  reason_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint cockpit_sales_call_outcomes_reason_intro
    check (no_demo_reason is null or call_type = 'intro'),
  constraint cockpit_sales_call_outcomes_other_says_why
    check (no_demo_reason is distinct from 'other' or char_length(btrim(coalesce(no_demo_note, ''))) >= 3)
);

create index if not exists cockpit_sales_call_outcomes_contact
  on public.cockpit_sales_call_outcomes (contact_id);
create index if not exists cockpit_sales_call_outcomes_start
  on public.cockpit_sales_call_outcomes (start_at);

comment on table public.cockpit_sales_call_outcomes is
  'After the call (2026-10-29): the lead''s quality from 1 to 10 on every intro or demo held, and why a held intro booked no demo. One row per call; sales-api call.outcome writes it and audits each change in cockpit_audit_log.';
comment on column public.cockpit_sales_call_outcomes.quality_role is
  'The rater''s sales role when they rated (setter, closer, both, manager): the setter''s and the closer''s view of lead quality, apart.';
comment on column public.cockpit_sales_call_outcomes.no_demo_reason is
  'signed: they signed on this call. no_budget, too_small (under $500k a year), not_decision_maker, not_a_fit: the setter gate. no_need, not_ready, has_agency, price_only, thinking: not now. other: no_demo_note says why.';

alter table public.cockpit_sales_call_outcomes enable row level security;
drop policy if exists cockpit_sales_call_outcomes_seat_read on public.cockpit_sales_call_outcomes;
create policy cockpit_sales_call_outcomes_seat_read on public.cockpit_sales_call_outcomes
  for select to authenticated using ((select public.cockpit_sales_seat()));
revoke all on public.cockpit_sales_call_outcomes from public, anon, authenticated;
grant select on public.cockpit_sales_call_outcomes to authenticated;
grant all on public.cockpit_sales_call_outcomes to service_role;

-- 2. What a held call still needs ---------------------------------------------------

create or replace function public.cockpit_sales_outcome_missing(
  p_call_type text, p_status text, p_quality smallint, p_reason text,
  p_demo_after_at timestamptz, p_signed_after boolean
) returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_call_type in ('intro', 'demo')
    and coalesce(p_status, '') in ('showed', 'completed', 'invalid')
    and (p_quality is null
      or (p_call_type = 'intro'
        and p_status in ('showed', 'completed')
        and p_demo_after_at is null
        and not coalesce(p_signed_after, false)
        and p_reason is null)), false);
$$;
comment on function public.cockpit_sales_outcome_missing(text, text, smallint, text, timestamptz, boolean) is
  'A held intro or demo (showed, completed or disqualified) with no lead quality; or a held intro (not disqualified, whose mark reason says why) with no demo after it, not signed, and no reason. Same rule as sales-api dayReview.ts and the app''s lib/afterCall.ts.';
grant execute on function public.cockpit_sales_outcome_missing(text, text, smallint, text, timestamptz, boolean) to authenticated, service_role;

-- 3. The calendar view ----------------------------------------------------------------
-- The same columns in the same order as 20261011a_sales_reschedule.sql, then
-- the answers. security_invoker stays on: a seat reads the outcomes and the
-- bookings through their own policies, and a rep sees "signed" only for a deal
-- they closed or set (cockpit_sales_deals_own_read).

create or replace view public.cockpit_sales_calendar
with (security_invoker = true) as
select a.appointment_id,
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
       a.start_at < now()
         and a.call_type = any (array['intro'::text, 'demo'::text])
         and coalesce(a.status, 'new'::text) = any (array['new'::text, 'confirmed'::text])
         and d.id is null as needs_mark,
       a.meet_url,
       a.crm_rescheduled_at,
       r.created_at as rescheduled_at,
       r.from_start as rescheduled_from,
       r.rep_email as rescheduled_by,
       o.lead_quality,
       o.quality_by,
       o.quality_role,
       o.no_demo_reason,
       o.no_demo_note,
       greatest(o.quality_at, o.reason_at) as outcome_at,
       case when a.call_type = 'intro' then least(
         (select min(x.start_at) from public.cockpit_sales_appointments x
           where x.contact_id = a.contact_id and x.call_type = 'demo'
             and x.booked_at >= a.start_at - interval '30 minutes'),
         (select min(b.start_at) from public.cockpit_sales_bookings b
           where b.contact_id = a.contact_id and b.kind = 'demo' and b.state = 'booked'
             and b.created_at >= a.start_at - interval '30 minutes'))
       end as demo_after_at,
       case when a.call_type = 'intro' then exists (
         select 1 from public.cockpit_sales_deals x
          where x.contact_id = a.contact_id and not coalesce(x.voided, false)
            and x.submitted_at >= a.start_at - interval '30 minutes')
       end as signed_after
  from public.cockpit_sales_appointments a
  left join public.cockpit_sales_dispositions d
    on d.appointment_id = a.appointment_id and d.superseded_at is null
  left join lateral (
    select x.created_at, x.from_start, x.rep_email
      from public.cockpit_sales_reschedules x
     where x.appointment_id = a.appointment_id and x.state = 'moved'
     order by x.created_at desc
     limit 1
  ) r on true
  left join public.cockpit_sales_call_outcomes o
    on o.appointment_id = a.appointment_id;

-- 4. Intros to demos -----------------------------------------------------------------
-- A call's status: the cockpit's mark while B2B's copy has not caught up (the
-- first hour) or when it never reached HighLevel; otherwise the copy, so a
-- call HighLevel changed after the mark reads as HighLevel has it. Shown is
-- B2B's rule: showed, or confirmed or disqualified once its time has passed.

create or replace function public.cockpit_sales_funnel(p_from date, p_to date, p_host text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me_host text;
  first_at timestamptz := p_from::timestamp at time zone 'Asia/Kuwait';
  last_at timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Kuwait';
  out jsonb;
begin
  if not public.cockpit_sales_seat() then
    raise exception 'A sales seat is needed to read these numbers.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 400 then
    raise exception 'Choose a window of up to 400 days.';
  end if;
  if p_host is not null and not public.cockpit_sales_manager() then
    select p.ghl_user_id into me_host from public.cockpit_sales_people p
     where p.email = public.cockpit_sales_email() and p.active;
    if me_host is distinct from p_host then
      raise exception 'You can read your own calls or the team''s.' using errcode = '42501';
    end if;
  end if;

  with calls as (
    select a.appointment_id, a.contact_id, a.contact_name, a.call_type, a.start_at, a.booked_at,
           a.assigned_user_id, a.assigned_user_name,
           case
             when d.id is null or d.status is not distinct from a.status then a.status
             when d.marked_at > now() - interval '1 hour' then d.status
             when d.crm not in ('written', 'quiet') then d.status
             else a.status
           end as status,
           d.reason as mark_reason
      from public.cockpit_sales_appointments a
      left join public.cockpit_sales_dispositions d
        on d.appointment_id = a.appointment_id and d.superseded_at is null
     where a.call_type in ('intro', 'demo')
       and (p_host is null or a.assigned_user_id = p_host)
       and ((a.start_at >= first_at and a.start_at < last_at)
         or (a.booked_at >= first_at and a.booked_at < last_at))
  ),
  held as (
    select c.*,
           c.start_at >= first_at and c.start_at < last_at as in_window,
           c.start_at <= now() as due,
           (c.status = 'showed' or (c.status in ('confirmed', 'invalid') and c.start_at <= now())) as shown
      from calls c
  ),
  intros as (
    select h.*,
           exists (select 1 from public.cockpit_sales_appointments x
                    where x.contact_id = h.contact_id and x.call_type = 'demo'
                      and x.booked_at >= h.start_at - interval '30 minutes') as advanced,
           exists (select 1 from public.cockpit_sales_deals x
                    where x.contact_id = h.contact_id and not coalesce(x.voided, false)
                      and x.submitted_at >= h.start_at - interval '30 minutes') as signed,
           o.no_demo_reason, o.no_demo_note
      from held h
      left join public.cockpit_sales_call_outcomes o on o.appointment_id = h.appointment_id
     where h.call_type = 'intro' and h.in_window and h.shown
  ),
  stalled as (
    select i.*,
           case when i.status = 'invalid' then 'disqualified'
                else coalesce(i.no_demo_reason, 'none') end as why
      from intros i
     where not i.advanced and not i.signed
  ),
  rated as (
    select h.call_type, o.lead_quality, coalesce(o.quality_role, 'unknown') as role
      from held h
      join public.cockpit_sales_call_outcomes o on o.appointment_id = h.appointment_id
     where h.in_window and h.shown and o.lead_quality is not null
  ),
  counts as (
    select h.call_type,
           count(*) filter (where h.booked_at >= first_at and h.booked_at < last_at) as booked,
           count(*) filter (where h.in_window) as scheduled,
           count(*) filter (where h.in_window and h.due) as due,
           count(*) filter (where h.in_window and h.shown) as shown,
           count(*) filter (where h.in_window and (h.status = 'showed' or (h.status = 'confirmed' and h.due))) as qualified,
           count(*) filter (where h.in_window and h.status = 'invalid' and h.due) as disqualified,
           count(*) filter (where h.in_window and h.status = 'noshow') as noshow,
           count(*) filter (where h.in_window and h.status = 'cancelled') as cancelled,
           count(*) filter (where h.in_window and h.status = 'confirmed' and h.due) as unmarked,
           count(*) filter (where h.in_window and not h.due) as ahead
      from held h
     group by h.call_type
  ),
  side as (
    select k.kind,
           coalesce((select jsonb_build_object(
             'booked', c.booked, 'scheduled', c.scheduled, 'due', c.due, 'shown', c.shown,
             'qualified', c.qualified, 'disqualified', c.disqualified, 'noshow', c.noshow,
             'cancelled', c.cancelled, 'unmarked', c.unmarked, 'ahead', c.ahead)
             from counts c where c.call_type = k.kind),
             jsonb_build_object('booked', 0, 'scheduled', 0, 'due', 0, 'shown', 0, 'qualified', 0,
               'disqualified', 0, 'noshow', 0, 'cancelled', 0, 'unmarked', 0, 'ahead', 0)) as c,
           (select jsonb_build_object(
              'held', (select count(*) from held h where h.call_type = k.kind and h.in_window and h.shown),
              'rated', count(*),
              'average', round(avg(r.lead_quality)::numeric, 1))
              from rated r where r.call_type = k.kind) as q
      from (values ('intro'), ('demo')) k(kind)
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'host', p_host, 'as_of', now(),
    'intros', (select s.c from side s where s.kind = 'intro') || jsonb_build_object(
      'advanced', (select count(*) from intros where advanced),
      'signed', (select count(*) from intros where signed and not advanced),
      'stalled', (select count(*) from stalled),
      'quality', (select s.q from side s where s.kind = 'intro')),
    'demos', (select s.c from side s where s.kind = 'demo') || jsonb_build_object(
      'quality', (select s.q from side s where s.kind = 'demo')),
    'reasons', coalesce((select jsonb_agg(jsonb_build_object('why', g.why, 'n', g.n) order by g.n desc, g.why)
      from (select why, count(*) as n from stalled group by why) g), '[]'::jsonb),
    'disqualified_why', coalesce((select jsonb_agg(jsonb_build_object('why', g.why, 'n', g.n) order by g.n desc, g.why)
      from (select coalesce(nullif(btrim(mark_reason), ''), 'No reason given') as why, count(*) as n
              from stalled where why = 'disqualified' group by 1) g), '[]'::jsonb),
    'others', coalesce((select jsonb_agg(jsonb_build_object('note', s.no_demo_note, 'start_at', s.start_at,
        'contact_id', s.contact_id, 'contact_name', s.contact_name) order by s.start_at desc)
      from stalled s where s.why = 'other'), '[]'::jsonb),
    'missing', coalesce((select jsonb_agg(jsonb_build_object('appointment_id', s.appointment_id,
        'contact_id', s.contact_id, 'contact_name', s.contact_name, 'start_at', s.start_at,
        'status', s.status, 'host', s.assigned_user_name) order by s.start_at desc)
      from (select * from stalled where why = 'none' order by start_at desc limit 50) s), '[]'::jsonb),
    'quality_by_role', coalesce((select jsonb_agg(jsonb_build_object('role', g.role, 'call_type', g.call_type,
        'rated', g.n, 'average', g.average) order by g.call_type desc, g.role)
      from (select role, call_type, count(*) as n, round(avg(lead_quality)::numeric, 1) as average
              from rated group by role, call_type) g), '[]'::jsonb),
    'closes', case when p_host is null then (select count(*) from public.cockpit_sales_deals x
      where not coalesce(x.voided, false) and x.submitted_at >= first_at and x.submitted_at < last_at) end
  ) into out;
  return out;
end;
$$;
comment on function public.cockpit_sales_funnel(date, date, text) is
  'Intros to demos for Kuwait days p_from..p_to (one host, or the team when null): B2B''s show rule, a demo booked at or after the intro (30 minutes of grace), intros signed without a demo, the reasons held intros booked none, and lead quality by who rated it. A rep reads the team''s or their own; a manager reads anyone''s.';
revoke all on function public.cockpit_sales_funnel(date, date, text) from public, anon;
grant execute on function public.cockpit_sales_funnel(date, date, text) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
