-- Reschedule, book and follow up from the lead (2026-10-11).
--
-- The CEO asked for rescheduling any intro or demo to be really easy, and for
-- the lead page to book an intro, a demo or a follow-up call and reschedule
-- any of the lead's calls in as few presses as possible. sales-api's
-- book.move now moves a call in place in HighLevel and writes every move down
-- here first; sales-mirror keeps the cockpit's new time until B2B's copy
-- carries it.
--
-- 1. cockpit_sales_reschedules: one row per press that moved (or tried to
--    move) a call: who, from where, why, the old and new time and host,
--    whether HighLevel took it, and whether the lead was told. The one-moving
--    index is the lock (one move at a time per call); request_id makes a
--    repeated press the same press.
-- 2. cockpit_sales_appointments gains meet_url (the demo's Zoom address,
--    mirrored from B2B's raw_payload and read back on every book and move)
--    and crm_rescheduled_at (HighLevel's own reschedule stamp, for the
--    closer's end of day).
-- 3. cockpit_sales_bookings: a follow-up call can be booked, and the booking
--    says where it was pressed.
-- 4. cockpit_sales_confirmations: a follow-up call can be confirmed.
-- 5. cockpit_sales_snippets: a new moment, rescheduled, with the team's first
--    two messages (Arabic and English).
-- 6. cockpit_sales_zoom_links gains keep_until: a moved call's instant link
--    is kept past the tidy until the new start plus three hours.
-- 7. cockpit_sales_calendar (the view): the same columns in the same order,
--    with the two new columns and the call's newest cockpit reschedule
--    appended at the end.
--
-- Row security and grants as 20260924a: a seat reads, only the service role
-- writes. Nothing here sends anything or touches HighLevel.

begin;

-- 1. The reschedules ------------------------------------------------------------

create table if not exists public.cockpit_sales_reschedules (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null unique,
  appointment_id text not null,
  contact_id     text not null,
  call_type      text check (call_type is null or call_type in ('intro', 'demo', 'follow_up')),
  calendar_id    text not null,
  from_start     timestamptz not null,
  to_start       timestamptz not null,
  from_user_id   text,
  to_user_id     text,
  reason         text not null check (reason in ('they_asked', 'host_cant', 'other')),
  note           text,
  source         text not null check (source in ('lead', 'today', 'calendar', 'dialer', 'script')),
  after_start    boolean not null default false,
  rep_email      text not null,
  attempt_id     uuid,
  state          text not null default 'moving'
                   check (state in ('moving', 'moved', 'not_moved', 'failed', 'unverified')),
  error          text,
  created_at     timestamptz not null default now(),
  finished_at    timestamptz,
  b2b_caught_at  timestamptz,
  released_at    timestamptz,
  released_why   text,
  told_at        timestamptz,
  told_how       text check (told_how is null or told_how in ('whatsapp', 'copy', 'link_whatsapp', 'link_copy')),
  told_lang      text check (told_lang is null or told_lang in ('ar', 'en'))
);

-- The lock: one move at a time per call.
create unique index if not exists cockpit_sales_reschedules_one_moving
  on public.cockpit_sales_reschedules (appointment_id) where state = 'moving';
create index if not exists cockpit_sales_reschedules_appt
  on public.cockpit_sales_reschedules (appointment_id, created_at desc);
create index if not exists cockpit_sales_reschedules_contact
  on public.cockpit_sales_reschedules (contact_id, created_at desc);
-- The mirror's read: moves B2B has not carried yet.
create index if not exists cockpit_sales_reschedules_open_holds
  on public.cockpit_sales_reschedules (created_at desc)
  where state = 'moved' and b2b_caught_at is null and released_at is null;

comment on table public.cockpit_sales_reschedules is
  'One row per press of a time in the cockpit''s Reschedule (sales-api book.move, 2026-10-11): written as moving before HighLevel is asked, then settled from HighLevel''s own read-back. sales-mirror keeps to_start on the cockpit''s copy until B2B shows it (b2b_caught_at), someone moves the call again in HighLevel (released_at), or the hold lapses.';
comment on column public.cockpit_sales_reschedules.state is
  'moving: HighLevel asked, answer not read yet (the lock). moved: HighLevel shows the new time. not_moved: HighLevel did not answer and still shows the old time. failed: HighLevel refused (an HTTP answer). unverified: HighLevel shows a third time, or could not be read for a minute: a person checks.';
comment on column public.cockpit_sales_reschedules.reason is
  'they_asked: the lead asked (their confirmation of the new time). host_cant: the host cannot make it. other: the note says why.';
comment on column public.cockpit_sales_reschedules.after_start is 'Moved after the call''s start (allowed up to 20 minutes after).';
comment on column public.cockpit_sales_reschedules.told_how is
  'How the rep told the lead from the cockpit: their own WhatsApp opened with the message (whatsapp), the message copied (copy), or the pick-a-time link either way. The cockpit itself never sends.';

-- 2. The cockpit's copy of a call ----------------------------------------------

alter table public.cockpit_sales_appointments add column if not exists meet_url text;
alter table public.cockpit_sales_appointments add column if not exists crm_rescheduled_at timestamptz;
comment on column public.cockpit_sales_appointments.meet_url is
  'The call''s Zoom join link from HighLevel''s address (B2B raw_payload->>address, or HighLevel''s read-back), only when it is a zoom.us link.';
comment on column public.cockpit_sales_appointments.crm_rescheduled_at is
  'HighLevel''s own reschedule stamp (B2B raw_payload->>rescheduledAt): moves made in HighLevel and in the cockpit.';

-- 3. Bookings: a follow-up call, and where it was pressed -----------------------

alter table public.cockpit_sales_bookings drop constraint if exists cockpit_sales_bookings_kind_check;
alter table public.cockpit_sales_bookings add constraint cockpit_sales_bookings_kind_check
  check (kind in ('intro', 'demo', 'follow_up'));
alter table public.cockpit_sales_bookings add column if not exists source text;
comment on column public.cockpit_sales_bookings.source is 'Where the booking was pressed: lead, today, calendar, dialer or script (null before 2026-10-11).';

-- 4. Confirmations of a follow-up call -------------------------------------------

alter table public.cockpit_sales_confirmations drop constraint if exists cockpit_sales_confirmations_call_type_check;
alter table public.cockpit_sales_confirmations add constraint cockpit_sales_confirmations_call_type_check
  check (call_type is null or call_type in ('intro', 'demo', 'follow_up'));

-- 5. The rescheduled moment in the message library -----------------------------

alter table public.cockpit_sales_snippets drop constraint if exists cockpit_sales_snippets_moment_check;
alter table public.cockpit_sales_snippets add constraint cockpit_sales_snippets_moment_check
  check (moment in ('first_touch', 'missed_call', 'no_show', 'cancelled', 'confirm', 'booked', 'rescheduled',
                    'after_intro', 'after_demo', 'no_reply', 'nurture', 'proof', 'reactivate', 'other'));

-- The team's first words for it ({name}, {day} and {time} are filled in on
-- the lead's own clock by the cockpit; the team edits them on the WhatsApp
-- page like any other).
insert into public.cockpit_sales_snippets (moment, language, body, sort, created_by)
select v.moment, v.language, v.body, v.sort, 'migration'
  from (values
    ('rescheduled', 'ar', 'هلا {name}، غيرنا موعد المكالمة. صار {day} الساعة {time}. إذا ما يناسبك الوقت، اكتب لي هني.', 10),
    ('rescheduled', 'en', 'Hi {name}, your call is now on {day} at {time}. If that time doesn''t suit you, reply here.', 20)
  ) as v(moment, language, body, sort)
 where not exists (
   select 1 from public.cockpit_sales_snippets s
    where s.moment = v.moment and s.language = v.language and s.deleted_at is null
 );

-- 6. A moved call keeps its instant Zoom link --------------------------------------

alter table public.cockpit_sales_zoom_links add column if not exists keep_until timestamptz;
comment on column public.cockpit_sales_zoom_links.keep_until is
  'The tidy leaves the meeting alone until then: set to the new start plus three hours when the lead''s call is rescheduled in the cockpit.';

-- Row security and grants on the new table --------------------------------------

alter table public.cockpit_sales_reschedules enable row level security;
drop policy if exists cockpit_sales_reschedules_seat_read on public.cockpit_sales_reschedules;
create policy cockpit_sales_reschedules_seat_read on public.cockpit_sales_reschedules
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on public.cockpit_sales_reschedules from public, anon, authenticated;
grant select on public.cockpit_sales_reschedules to authenticated;
grant all on public.cockpit_sales_reschedules to service_role;

-- 7. The calendar view ----------------------------------------------------------
-- The live definition (pg_get_viewdef, 2026-10-11) with the same columns in
-- the same order, and the new ones appended at the end. security_invoker
-- stays on, so a seat reads the reschedules through their own policy.

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
       r.rep_email as rescheduled_by
  from public.cockpit_sales_appointments a
  left join public.cockpit_sales_dispositions d
    on d.appointment_id = a.appointment_id and d.superseded_at is null
  left join lateral (
    select x.created_at, x.from_start, x.rep_email
      from public.cockpit_sales_reschedules x
     where x.appointment_id = a.appointment_id and x.state = 'moved'
     order by x.created_at desc
     limit 1
  ) r on true;

revoke all on public.cockpit_sales_calendar from public, anon, authenticated;
grant select on public.cockpit_sales_calendar to authenticated;
grant all on public.cockpit_sales_calendar to service_role;

notify pgrst, 'reload schema';

commit;
