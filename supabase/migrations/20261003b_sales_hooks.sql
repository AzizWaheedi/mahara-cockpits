-- Live calls, the hooks commit's database side (consistency check C25, C26,
-- glossary 1.4 and P3's new kinds, 2026-10-03).
--
-- 1. cockpit_sales_messages.source: adds 'room' (a room link, F and P1) and
--    'thread' (a demo chat step, P4), so per-source WhatsApp health can tell
--    them from a rep's own sends ('rep') and follow-ups ('followup').
-- 2. cockpit_sales_followups.segment: adds 'good_intro' (qualified at the
--    intro, no demo 24 h later) and 'reactivate' (a wave member whose window
--    is closed), P3 phases 1 and 2.
-- 3. cockpit_sales_wa_templates.button_variable (C25): the variable a
--    template's URL button takes from a contact field ('join_code' for
--    call_link, filled from wa_fields.join). sendTemplate writes that field
--    when the route has one.
-- 4. The template rows the glossary names (1.4), inactive with no workflow
--    until a manager picks the approved HighLevel workflow: call_link_en/ar
--    (C24's one body) and demo_host_en/ar (P4). opener_en/ar come with
--    20261003c. A row that exists is never touched.
-- 5. wa_fields gains join (contact.cockpit_join_code) and when
--    (contact.cockpit_call_time), with no field id until the fields are made
--    in HighLevel (an id of null reads as "not set up", never as zero).
--
-- 1 and 2 only widen the allowed set, so every row that passes today passes
-- after (on 2026-10-03: 0 messages rows; 81 follow-ups, nurture and reply).
-- The check first stops the migration with a plain sentence if any row
-- would not fit, before a constraint is dropped. Settings only gain missing
-- keys (cockpit_sales_settings_add_missing), with one audit row per setting
-- changed. Running it twice changes nothing.

begin;

do $$
declare
  bad integer;
begin
  select count(*) into bad from public.cockpit_sales_messages
   where source is null or source not in ('rep', 'followup', 'thread', 'room');
  if bad > 0 then
    raise exception '% messages rows have a source outside rep, followup, thread, room. Fix them before this migration.', bad;
  end if;
  select count(*) into bad from public.cockpit_sales_followups
   where segment is null or segment not in
     ('reply', 'confirm', 'no_show', 'cancelled', 'new', 'after_call', 'nurture', 'good_intro', 'reactivate');
  if bad > 0 then
    raise exception '% follow-up rows have a segment outside the nine kinds. Fix them before this migration.', bad;
  end if;
end;
$$;

alter table public.cockpit_sales_messages
  drop constraint if exists cockpit_sales_messages_source_check;
alter table public.cockpit_sales_messages
  add constraint cockpit_sales_messages_source_check
  check (source = any (array['rep', 'followup', 'thread', 'room']::text[]));

comment on column public.cockpit_sales_messages.source is
  'Who sent it: rep (a rep''s own send), followup (the follow-up desk), room (a live-call room link), thread (a demo chat step).';

alter table public.cockpit_sales_followups
  drop constraint if exists cockpit_sales_followups_segment_check;
alter table public.cockpit_sales_followups
  add constraint cockpit_sales_followups_segment_check
  check (segment = any (array['reply', 'confirm', 'no_show', 'cancelled', 'new', 'after_call', 'nurture',
                              'good_intro', 'reactivate']::text[]));

-- Settings: add only what is missing ------------------------------------------

-- p_base with every key of p_add it does not have yet, recursively into
-- objects both sides hold. A value already there is never changed.
create or replace function public.cockpit_sales_jsonb_add_missing(p_base jsonb, p_add jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  acc jsonb := coalesce(p_base, '{}'::jsonb);
begin
  if jsonb_typeof(acc) <> 'object' or jsonb_typeof(p_add) is distinct from 'object' then
    return acc;
  end if;
  for k, v in select e.key, e.value from jsonb_each(p_add) as e loop
    if not (acc ? k) then
      acc := acc || jsonb_build_object(k, v);
    elsif jsonb_typeof(acc -> k) = 'object' and jsonb_typeof(v) = 'object' then
      acc := jsonb_set(acc, array[k], public.cockpit_sales_jsonb_add_missing(acc -> k, v));
    end if;
  end loop;
  return acc;
end;
$$;
revoke all on function public.cockpit_sales_jsonb_add_missing(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.cockpit_sales_jsonb_add_missing(jsonb, jsonb) to service_role;

-- Adds the missing keys of p_add to the setting p_key, with one audit row
-- when anything changed. Returns false when the setting does not exist (it is
-- not made here) or already had every key.
create or replace function public.cockpit_sales_settings_add_missing(p_key text, p_add jsonb, p_by text, p_why text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_v jsonb;
  after_v jsonb;
begin
  select s.value into before_v from public.cockpit_sales_settings as s where s.key = p_key for update;
  if not found then
    raise notice 'Setting % does not exist, so nothing was added to it.', p_key;
    return false;
  end if;
  after_v := public.cockpit_sales_jsonb_add_missing(before_v, p_add);
  if after_v = before_v then
    return false;
  end if;
  update public.cockpit_sales_settings as s
     set value = after_v, updated_by = p_by, updated_at = now()
   where s.key = p_key;
  insert into public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  values ('settings.update', 'cockpit_sales_settings', p_key, null, 'sales', 'migration', before_v, after_v,
          jsonb_build_object('by', p_by, 'why', p_why,
                             'added', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
                                         from jsonb_object_keys(after_v) as k where not (before_v ? k))));
  return true;
end;
$$;
revoke all on function public.cockpit_sales_settings_add_missing(text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.cockpit_sales_settings_add_missing(text, jsonb, text, text) to service_role;

select public.cockpit_sales_settings_add_missing('wa_fields',
  '{"join": {"id": null, "key": "contact.cockpit_join_code"}, "when": {"id": null, "key": "contact.cockpit_call_time"}}'::jsonb,
  'migration 20261003b',
  'Live calls: the join code fills call_link''s URL button, and the call time fills demo_host (glossary 1.4). The field ids come when the fields are made in HighLevel.');

-- Template routes ---------------------------------------------------------------

alter table public.cockpit_sales_wa_templates
  add column if not exists button_variable text
    constraint cockpit_sales_wa_templates_button_variable_check
    check (button_variable is null or button_variable in ('join_code'));
comment on column public.cockpit_sales_wa_templates.button_variable is
  'The variable the template''s URL button takes (join_code: the room code, written to the contact field wa_fields.join before the send). Null when the template has no button variable.';

with added as (
  insert into public.cockpit_sales_wa_templates
    (key, name, language, purpose, preview, variables, button_variable, workflow_id, active, segments, sort, updated_by)
  values
    ('call_link_en', 'cockpit_call_link_en', 'en',
     'A live call''s link when the lead''s WhatsApp window is closed. The button opens the room.',
     'Hi {{1}}, your call with {{2}} from Mahara Media is ready now. Tap the button below to join.',
     array['first_name', 'rep_name'], 'join_code', null, false, '{}', 110, 'migration 20261003b'),
    ('call_link_ar', 'cockpit_call_link_ar', 'ar',
     'A live call''s link in Arabic when the lead''s WhatsApp window is closed. The button opens the room.',
     'هلا {{1}}، مكالمتك مع {{2}} من مهارة ميديا جاهزة الحين. اضغط الزر اللي تحت عشان تدخل.',
     array['first_name', 'rep_name'], 'join_code', null, false, '{}', 111, 'migration 20261003b'),
    ('demo_host_en', 'cockpit_demo_host_en', 'en',
     'The closer introduces themselves before a booked demo, when the WhatsApp window is closed.',
     'Hi {{1}}, this is {{2}} from Mahara Media. I''ll host your demo on {{3}}. I''ll send the Zoom link here 15 minutes before. Can you still make it?',
     array['first_name', 'rep_name', 'call_time'], null, null, false, '{}', 120, 'migration 20261003b'),
    ('demo_host_ar', 'cockpit_demo_host_ar', 'ar',
     'The closer introduces themselves in Arabic before a booked demo, when the WhatsApp window is closed.',
     'هلا {{1}}، معاك {{2}} من مهارة ميديا. بكون معاك بمكالمتك {{3}}، وبرسل لك لينك زووم هني قبلها بربع ساعة. ليلحين الوقت يناسبك؟',
     array['first_name', 'rep_name', 'call_time'], null, null, false, '{}', 121, 'migration 20261003b')
  on conflict (key) do nothing
  returning key, name, language, active
)
insert into public.cockpit_audit_log (action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
select 'wa.template.seed', 'cockpit_sales_wa_templates', a.key, null, 'sales', 'migration', null,
       jsonb_build_object('name', a.name, 'language', a.language, 'active', a.active),
       jsonb_build_object('by', 'migration 20261003b',
                          'why', 'Live calls: the template rows exist, switched off, until Meta approves them and a manager picks the workflow.')
  from added as a;

notify pgrst, 'reload schema';

commit;
