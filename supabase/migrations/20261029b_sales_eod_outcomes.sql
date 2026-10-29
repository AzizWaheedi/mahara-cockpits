-- After the call, part two (Aziz, 2026-10-29: "they have to make it very easy
-- to rate the lead quality"; "There has to be a specific reason"): an end of
-- day is not filed while a held intro or demo is unrated, or a held intro has
-- no demo, was not signed and has no reason (cockpit_sales_outcome_missing,
-- 20261029a). Applied after the sales app and sales-api that ask for them.

begin;

-- As 20261022125617_sales_day_review_handoffs.sql, with one more check after
-- "Review every call".

create or replace function public.cockpit_sales_submit_reviewed_eod(
  p_email text, p_role text, p_day date, p_answers jsonb, p_computed jsonb,
  p_body text, p_columns jsonb, p_review_version text, p_review_rows jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  person public.cockpit_sales_people%rowtype;
  report public.cockpit_sales_eods%rowtype;
  outgoing public.eod_outbox%rowtype;
  calls jsonb;
  first_at timestamptz := p_day::timestamp at time zone 'Asia/Kuwait';
begin
  if p_role is null or p_role not in ('setter','closer') or p_day is null or p_answers is null then
    raise exception 'Choose a report and a valid day.';
  end if;
  if p_review_rows is null or jsonb_typeof(p_review_rows) <> 'array' then
    raise exception 'Refresh your call review before sending.';
  end if;
  select * into person from public.cockpit_sales_people where email = p_email and active;
  if person.email is null or person.ghl_user_id is null then
    raise exception 'Link an active sales seat to its HighLevel user before filing.';
  end if;
  if p_day > (now() at time zone 'Asia/Kuwait')::date or p_day < (now() at time zone 'Asia/Kuwait')::date - 7 then
    raise exception 'Choose a day in the last seven days.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('sales-eod:' || p_email || ':' || p_day || ':' || p_role, 0));
  select * into report from public.cockpit_sales_eods where email=p_email and day=p_day and role=p_role;
  if report.submitted_at is not null then
    if report.answers <> p_answers then raise exception 'This report was already filed with different answers.'; end if;
    select * into outgoing from public.eod_outbox where id=report.outbox_id;
    return jsonb_build_object('eod',to_jsonb(report),'outbox',jsonb_build_object('status',outgoing.status),'repeated',true);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',appointment_id,'status',status,'mark_id',mark_id,
    'note',mark_note,'start_at',start_at) order by appointment_id), '[]') into calls
  from public.cockpit_sales_calendar
  where assigned_user_id=person.ghl_user_id and start_at>=first_at and start_at<first_at+interval '1 day'
    and start_at<=now() and call_type in ('intro','demo','follow_up','callback');
  if exists (select 1 from jsonb_array_elements(calls) r where coalesce(r->>'status','') not in ('showed','completed','noshow','cancelled','invalid')) then
    raise exception 'Review every call before sending your end of day.';
  end if;
  if exists (select 1 from public.cockpit_sales_calendar c
     where c.assigned_user_id=person.ghl_user_id and c.start_at>=first_at and c.start_at<first_at+interval '1 day'
       and c.start_at<=now() and c.call_type in ('intro','demo')
       and public.cockpit_sales_outcome_missing(c.call_type, c.status, c.lead_quality, c.no_demo_reason, c.demo_after_at, c.signed_after)) then
    raise exception 'Rate the lead on every call you held, and say why each held intro did not book a demo.';
  end if;
  -- Compare typed times, not JSON date spelling (+00:00 versus Z).
  if jsonb_array_length(calls) <> jsonb_array_length(p_review_rows) or exists (
    select 1 from jsonb_array_elements(calls) c
    where not exists (select 1 from jsonb_array_elements(p_review_rows) r
      where r->>'id'=c->>'id' and r->>'status' is not distinct from c->>'status'
      and r->>'mark_id' is not distinct from c->>'mark_id'
      and r->>'note' is not distinct from c->>'note'
      and (r->>'start_at')::timestamptz = (c->>'start_at')::timestamptz)
  ) then raise exception 'Your calls changed. Refresh the totals before sending.'; end if;
  insert into public.eod_outbox(role,day,person,slack_id,channel,tab,body,row_values)
    values ('sales_'||p_role,p_day::text,coalesce(person.name,p_email),person.slack_user_id,
      'C0AF5PJEAUX',case when p_role='setter' then 'Setter' else 'Sales Rep' end,p_body,p_columns)
    returning * into outgoing;
  insert into public.cockpit_sales_eods(email,name,role,day,answers,computed,submitted_at,outbox_id,updated_at)
    values(p_email,coalesce(person.name,p_email),p_role,p_day,p_answers,p_computed,now(),outgoing.id,now())
    on conflict (email,day,role) do update set answers=excluded.answers,computed=excluded.computed,
      submitted_at=excluded.submitted_at,outbox_id=excluded.outbox_id,updated_at=excluded.updated_at
    returning * into report;
  insert into public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,after,metadata)
    values('eod.submit','cockpit_sales_eods',report.id::text,p_email,'sales','supabase-edge',
      jsonb_build_object('day',p_day,'role',p_role,'outbox_id',outgoing.id),
      jsonb_build_object('reviewed_calls',jsonb_array_length(calls),'review_version',p_review_version));
  return jsonb_build_object('eod',to_jsonb(report),'outbox',jsonb_build_object('status',outgoing.status));
end;
$$;
revoke all on function public.cockpit_sales_submit_reviewed_eod(text,text,date,jsonb,jsonb,text,jsonb,text,jsonb) from public, anon, authenticated;
grant execute on function public.cockpit_sales_submit_reviewed_eod(text,text,date,jsonb,jsonb,text,jsonb,text,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
