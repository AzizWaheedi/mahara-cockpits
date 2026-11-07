-- Did the intro now (the CEO, 2026-11-07): "If he gets them on the phone, he
-- should be able to book them for the demo then and there if he confirms."
-- The setter's confirmation call can now mark the intro held before its
-- booked time (sales-api dial.save with held_now), then book the demo on the
-- same call.
--
-- What changes here:
--
-- a. "After the intro" (a demo booked after it, a deal signed after it) is
--    counted from the mark for a call whose current mark is showed and was
--    made more than ten minutes before the start it was marked against
--    (d.start_at, the call's time when it was marked). Only Did the intro
--    now, and the older video-room early mark (a lead who joined the room
--    asked for it), can make such a mark: the lead page's Calls card, Today
--    and the Calendar refuse a showed mark more than ten minutes early
--    (lib.ts refuseMark), so a mark made there keeps the booked start, as
--    in 20261029a. Every other call keeps the booked start, with the same
--    30 minutes of grace. Without this, an intro held at 12:00 for 14:30
--    whose demo was booked at 12:15 reads "no demo after it", and the
--    setter's end of day asks why it booked none.
-- b. The funnel counts a call marked showed as due, even while its booked
--    start is ahead (an intro held early on its confirmation call). Without
--    this the show rate (shown / due) could read above 100% for up to a day,
--    and the held call would read "still ahead". A call nobody has held
--    yet is due at its start, as before.
--
-- 1. cockpit_sales_calendar (the view): the same columns in the same order as
--    20261029a; only demo_after_at and signed_after read the new anchor.
--    security_invoker stays on; the grants are the live ones (read on
--    7 Nov 2026: authenticated select, service_role all, nothing for anon).
-- 2. cockpit_sales_funnel(): the same function, signature, security definer,
--    search_path and grants as 20261029a; only advanced and signed read the
--    new anchor, and due (with ahead) counts a held call.
--
-- Unchanged for every existing row. Read only, 7 Nov 2026: no current
-- showed mark was made more than ten minutes before the start it was marked
-- against (the one intro marked before its current start was marked at its
-- time on 8 Oct and moved in HighLevel a week later, so it keeps the booked
-- start), and no call marked showed has its start ahead. So the anchor and
-- the due rule change no row today. (The earlier draft, anchored on any
-- showed mark before the start, read the same as the live view and funnel
-- in all 2,736 view rows and 98 funnel windows, except all both ways.)
--
-- An intro held the evening before counts on its booked day (the end of day,
-- the funnel's window, the show counts and the setter's pay), not on the day
-- it was held.
--
-- B2B's and the CEO page's numbers (windows.ts, the ceo-refresh adapters)
-- keep B2B's own rule: an intro held early counts as shown before it is due,
-- and a demo booked on that call before the intro's booked start is not
-- "advanced". The CEO page's source note says so (pages/ceo/SOURCES.md).
--
-- Order: apply this BEFORE the sales-api that sends held_now. Without it, a
-- demo booked on the confirmation call reads "no demo after it", the end of
-- day refuses until the setter gives a reason that is not true, and that
-- reason stays. Applied on its own it changes no row today.

begin;

-- 1. The calendar view -------------------------------------------------------------

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
             and x.booked_at >= k.after_from - interval '30 minutes'),
         (select min(b.start_at) from public.cockpit_sales_bookings b
           where b.contact_id = a.contact_id and b.kind = 'demo' and b.state = 'booked'
             and b.created_at >= k.after_from - interval '30 minutes'))
       end as demo_after_at,
       case when a.call_type = 'intro' then exists (
         select 1 from public.cockpit_sales_deals x
          where x.contact_id = a.contact_id and not coalesce(x.voided, false)
            and x.submitted_at >= k.after_from - interval '30 minutes')
       end as signed_after
  from public.cockpit_sales_appointments a
  left join public.cockpit_sales_dispositions d
    on d.appointment_id = a.appointment_id and d.superseded_at is null
  -- "After the intro" starts at the mark for a call held more than ten
  -- minutes before the time it was marked against (Did the intro now); at
  -- the booked start for every other call, as before.
  cross join lateral (
    select case when d.status = 'showed' and d.marked_at < d.start_at - interval '10 minutes' then d.marked_at
                else a.start_at end as after_from
  ) k
  left join lateral (
    select x.created_at, x.from_start, x.rep_email
      from public.cockpit_sales_reschedules x
     where x.appointment_id = a.appointment_id and x.state = 'moved'
     order by x.created_at desc
     limit 1
  ) r on true
  left join public.cockpit_sales_call_outcomes o
    on o.appointment_id = a.appointment_id;

grant select on public.cockpit_sales_calendar to authenticated;
grant all on public.cockpit_sales_calendar to service_role;

-- 2. Intros to demos -----------------------------------------------------------------

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
           d.reason as mark_reason,
           -- "After the intro" starts at the mark for a call held more than
           -- ten minutes before the time it was marked against (Did the
           -- intro now, 2026-11-07); at the booked start for every other
           -- call, as before.
           case when d.status = 'showed' and d.marked_at < d.start_at - interval '10 minutes' then d.marked_at
                else a.start_at end as after_from
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
           -- A call held early (Did the intro now) is due once held.
           (c.start_at <= now() or c.status = 'showed') as due,
           (c.status = 'showed' or (c.status in ('confirmed', 'invalid') and c.start_at <= now())) as shown
      from calls c
  ),
  intros as (
    select h.*,
           exists (select 1 from public.cockpit_sales_appointments x
                    where x.contact_id = h.contact_id and x.call_type = 'demo'
                      and x.booked_at >= h.after_from - interval '30 minutes') as advanced,
           exists (select 1 from public.cockpit_sales_deals x
                    where x.contact_id = h.contact_id and not coalesce(x.voided, false)
                      and x.submitted_at >= h.after_from - interval '30 minutes') as signed,
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
  'Intros to demos for Kuwait days p_from..p_to (one host, or the team when null): B2B''s show rule, a demo booked at or after the intro (30 minutes of grace; from the mark for a call marked held more than ten minutes before its time), a call marked held counts as due, intros signed without a demo, the reasons held intros booked none, and lead quality by who rated it. A rep reads the team''s or their own; a manager reads anyone''s.';
revoke all on function public.cockpit_sales_funnel(date, date, text) from public, anon;
grant execute on function public.cockpit_sales_funnel(date, date, text) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
