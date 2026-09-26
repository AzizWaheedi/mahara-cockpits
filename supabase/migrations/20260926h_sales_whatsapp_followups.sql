-- WhatsApp first, and the follow-ups that replace HighLevel's automations
-- (Aziz, 2026-09-26):
--
-- - "For the follow-ups part, I want you to also have a lot of WhatsApp
--   messages that they can send, not just email, because the reply rates
--   are very low."
-- - "I want to actually start replacing our follow-ups ... it should be for
--   the hottest leads first ... Long term, they may not even need approval
--   after a while. Instead of having our manual follow-ups for the
--   automations that go out (no-shows, cancellations, new leads who didn't
--   book), maybe we can have more customized messages that go out."
--
-- Found the same day: 54 of the 62 drafts waiting were emails, because
-- WhatsApp takes a free message only within 24 hours of the lead's own last
-- message (6 leads had that window open). Outside it, WhatsApp takes only a
-- Meta-approved template, and HighLevel's public API cannot send one: a
-- template goes out through a HighLevel workflow the contact is enrolled in.
-- So a template here is a route: the approved template's name and text, and
-- the workflow that sends it. The "line" templates carry one line the agent
-- or the rep writes, through the contact field "Cockpit WhatsApp line".
--
-- Also here: the ready-made WhatsApp messages reps pick from (snippets), the
-- two new follow-up kinds (cancelled calls, and confirming a call booked more
-- than a day ahead), and, per kind, the HighLevel automations the cockpit
-- replaces: with "take over" on, a lead the cockpit has messaged is taken out
-- of the old sequence so they never get both.

begin;

-- ---------------------------------------------------------------------------
-- Follow-up drafts: new kinds, the template channel, and what happened next
-- ---------------------------------------------------------------------------

alter table public.cockpit_sales_followups drop constraint if exists cockpit_sales_followups_segment_check;
alter table public.cockpit_sales_followups add constraint cockpit_sales_followups_segment_check
  check (segment in ('reply', 'confirm', 'no_show', 'cancelled', 'new', 'after_call', 'nurture'));

alter table public.cockpit_sales_followups drop constraint if exists cockpit_sales_followups_channel_check;
alter table public.cockpit_sales_followups add constraint cockpit_sales_followups_channel_check
  check (channel in ('whatsapp', 'whatsapp_template', 'email'));

alter table public.cockpit_sales_followups
  -- Which template route carries a whatsapp_template draft (its body is the line).
  add column if not exists template_key text,
  -- The draft's place in its kind's sequence: 1 for the first message.
  add column if not exists touch integer,
  -- How hot the lead was when the draft was written (the dialer's score).
  add column if not exists heat integer,
  -- The appointment a confirm, no_show or cancelled draft is about.
  add column if not exists appointment_id text,
  -- The lead wrote back after this was sent (read by the desk).
  add column if not exists replied_at timestamptz,
  -- HighLevel workflows the lead was taken out of when this went out.
  add column if not exists took_over jsonb;

create index if not exists cockpit_sales_followups_sent_idx
  on public.cockpit_sales_followups (segment, decided_at desc) where status = 'sent';

-- ---------------------------------------------------------------------------
-- Sends: a template goes out through a workflow, not the conversation
-- ---------------------------------------------------------------------------

alter table public.cockpit_sales_messages
  add column if not exists via text not null default 'conversation',
  add column if not exists template_key text,
  add column if not exists workflow_id text;
alter table public.cockpit_sales_messages drop constraint if exists cockpit_sales_messages_via_check;
alter table public.cockpit_sales_messages add constraint cockpit_sales_messages_via_check
  check (via in ('conversation', 'workflow'));

-- ---------------------------------------------------------------------------
-- WhatsApp templates the cockpit can send, each through its workflow
-- ---------------------------------------------------------------------------

create table if not exists public.cockpit_sales_wa_templates (
  key text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  -- The template's name in HighLevel / Meta.
  name text not null check (length(name) between 1 and 120),
  language text not null check (language in ('ar', 'en')),
  -- What it is for, in plain words, for the rep choosing it.
  purpose text not null check (length(purpose) between 1 and 300),
  -- The approved text, with {{1}}, {{2}} ... where the values go.
  preview text not null check (length(preview) between 1 and 1024),
  -- What each {{n}} is, in order: first_name, rep_name or line.
  variables text[] not null default '{}',
  -- The published HighLevel workflow whose only step sends this template.
  workflow_id text,
  active boolean not null default false,
  -- Follow-up kinds that may use it; empty means any.
  segments text[] not null default '{}',
  sort integer not null default 100,
  updated_by text not null default 'migration',
  updated_at timestamptz not null default now()
);

alter table public.cockpit_sales_wa_templates enable row level security;
drop policy if exists cockpit_sales_wa_templates_seat_read on public.cockpit_sales_wa_templates;
create policy cockpit_sales_wa_templates_seat_read on public.cockpit_sales_wa_templates
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on table public.cockpit_sales_wa_templates from public, anon, authenticated;
grant select on table public.cockpit_sales_wa_templates to authenticated;
grant all on table public.cockpit_sales_wa_templates to service_role;

-- The two line templates, to be created and approved in HighLevel (Settings,
-- WhatsApp, Templates; category Marketing) and each sent by a one-step
-- workflow. Off until a manager picks the workflow in the cockpit.
insert into public.cockpit_sales_wa_templates (key, name, language, purpose, preview, variables, sort)
values
  ('line_ar', 'cockpit_line_ar', 'ar',
   'Any follow-up in Arabic when the WhatsApp window is closed: the line is written for this lead.',
   E'هلا {{1}}، معاك {{2}} من مهارة ميديا.\n{{3}}\nإذا حاب نكمل، رد علي هني.',
   array['first_name', 'rep_name', 'line'], 10),
  ('line_en', 'cockpit_line_en', 'en',
   'Any follow-up in English when the WhatsApp window is closed: the line is written for this lead.',
   E'Hi {{1}}, it''s {{2}} from Mahara Media.\n{{3}}\nJust reply here if you''d like to continue.',
   array['first_name', 'rep_name', 'line'], 20)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Ready-made WhatsApp messages reps pick from
-- ---------------------------------------------------------------------------

create table if not exists public.cockpit_sales_snippets (
  id uuid primary key default gen_random_uuid(),
  moment text not null check (moment in (
    'first_touch', 'missed_call', 'no_show', 'cancelled', 'confirm', 'booked',
    'after_intro', 'after_demo', 'no_reply', 'nurture', 'proof', 'reactivate', 'other')),
  language text not null check (language in ('ar', 'en')),
  -- {name}, {rep}, {day} and {time} are filled in from the lead and the call.
  body text not null check (length(body) between 1 and 1500),
  sort integer not null default 100,
  created_by text not null default 'migration',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists cockpit_sales_snippets_moment
  on public.cockpit_sales_snippets (moment, language, sort) where deleted_at is null;

alter table public.cockpit_sales_snippets enable row level security;
drop policy if exists cockpit_sales_snippets_seat_read on public.cockpit_sales_snippets;
create policy cockpit_sales_snippets_seat_read on public.cockpit_sales_snippets
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on table public.cockpit_sales_snippets from public, anon, authenticated;
grant select on table public.cockpit_sales_snippets to authenticated;
grant all on table public.cockpit_sales_snippets to service_role;

-- Written in the team's spoken Gulf voice (the aziz-kuwaiti-voice rules: no
-- em-dashes, no quote marks, Arabic-Indic digits, the one approved proof
-- line). Seeded once; managers edit them in the cockpit.
insert into public.cockpit_sales_snippets (moment, language, body, sort)
select * from (values
  ('first_touch', 'ar', 'هلا {name}، معاك {rep} من مهارة ميديا. وصلنا طلبك وحبيت أتواصل معاك بنفسي.. متى يناسبك نتكلم ١٠ دقايق؟', 10),
  ('first_touch', 'ar', 'هلا {name}، {rep} من مهارة ميديا. شفت إنك تبي مشاريع أكثر لشركتك. عندي سؤالين سريعين قبل لا نحجز مكالمة، أقدر أسألك هني؟', 20),
  ('first_touch', 'en', 'Hi {name}, {rep} here from Mahara Media. Thanks for reaching out. When suits you for a quick 10-minute call?', 30),
  ('missed_call', 'ar', 'هلا {name}، توني اتصلت عليك من مهارة ميديا بس ما لحقت عليك. متى يناسبك أرجع أتصل؟', 10),
  ('missed_call', 'ar', 'هلا {name}، حاولت أتصل عليك الحين. إذا المكالمة ما تناسبك الحين نقدر نكمل هني، شنو أكثر شي تبي تعرفه؟', 20),
  ('missed_call', 'en', 'Hi {name}, I just tried calling you from Mahara Media. When is a better time to reach you?', 30),
  ('no_show', 'ar', 'هلا {name}، كنا ننطرك بالمكالمة وما صار نصيب. عادي تصير.. متى يناسبك نحجز وقت ثاني؟', 10),
  ('no_show', 'ar', 'هلا {name}، شكله صار عندك شي وقت المكالمة. تبيني أرسل لك أوقات ثانية؟', 20),
  ('no_show', 'en', 'Hi {name}, we missed you on the call. No problem, it happens. Shall I send you a couple of new times?', 30),
  ('cancelled', 'ar', 'هلا {name}، شفت إن المكالمة تكنسلت. كل شي تمام؟ إذا الوقت ما كان مناسب قول لي شنو يناسبك وأرتبها لك.', 10),
  ('cancelled', 'en', 'Hi {name}, I saw the call was cancelled. All good? If the time did not work, tell me what suits you and I will set it up.', 20),
  ('confirm', 'ar', 'هلا {name}، معاك {rep} من مهارة ميديا. بس حبيت أتأكد إن موعدنا {day} الساعة {time} للحين مناسب لك؟', 10),
  ('confirm', 'ar', 'هلا {name}، قاعد أجهز لمكالمتنا {day} الساعة {time} وأراجع شغلكم. إذا تغير شي قول لي ونغير الوقت.', 20),
  ('confirm', 'en', 'Hi {name}, {rep} from Mahara Media. Just checking we are still on for {day} at {time}?', 30),
  ('booked', 'ar', 'هلا {name}، حجزنا المكالمة {day} الساعة {time}. عشان نستفيد من الوقت، فكر بأكبر شي موقفك الحين عن مشاريع أكثر ونبدي منه.', 10),
  ('booked', 'en', 'Hi {name}, you are booked for {day} at {time}. To make the most of it, think about the biggest thing holding you back from more projects right now, and we will start there.', 20),
  ('after_intro', 'ar', 'هلا {name}، شكراً على وقتك اليوم. الخطوة الياية مكالمة ثانية نوريك فيها النظام بالتفصيل.. أي وقت يناسبك؟', 10),
  ('after_intro', 'en', 'Hi {name}, thanks for your time today. Next is a second call where we walk you through the system in detail. What time suits you?', 20),
  ('after_demo', 'ar', 'هلا {name}، شكراً على المكالمة. إذا فيه أي سؤال بعقلك أو شي تبي نوضحه، أنا موجود هني.', 10),
  ('after_demo', 'ar', 'هلا {name}، شلون الأمور؟ فكرت بالسالفة اللي تكلمنا فيها؟ إذا فيه شي مخليك متردد قول لي بصراحة.', 20),
  ('after_demo', 'en', 'Hi {name}, thanks for the call. If any questions came up afterwards, I am right here.', 30),
  ('no_reply', 'ar', 'هلا {name}، أراجع رسالتي اللي فاتت.. شكلها ضاعت بين الرسايل. للحين مهتم؟', 10),
  ('no_reply', 'en', 'Hi {name}, bumping my last message in case it got buried. Still interested?', 20),
  ('nurture', 'ar', 'هلا {name}، من فترة ما تكلمنا. شلون الشغل عندكم هالفترة؟ للحين تدورون على مشاريع أكثر؟', 10),
  ('nurture', 'en', 'Hi {name}, it has been a while. How is work on your side these days? Still looking to bring in more projects?', 20),
  ('proof', 'ar', 'هلا {name}، اشتغلنا مع أكثر من ٧٠ شركة بالخليج بنفس مجالك ويبنا لهم مشاريع عالية القيمة. تبي أرسل لك مثال قريب من شغلكم؟', 10),
  ('proof', 'en', 'Hi {name}, we have worked with more than 70 firms across the Gulf in your field. Want me to send you an example close to your work?', 20),
  ('reactivate', 'ar', 'هلا {name}، أدري مر وقت من آخر مرة تكلمنا. إذا للحين تفكر تكبر شغلك هالسنة، عندنا شي يديد يستاهل تسمعه. أرسل لك التفاصيل؟', 10),
  ('reactivate', 'en', 'Hi {name}, I know it has been a while. If growing the business is still on your mind this year, we have something new worth hearing. Shall I send the details?', 20)
) as s(moment, language, body, sort)
where not exists (select 1 from public.cockpit_sales_snippets);

-- How a rep's name reads inside an Arabic message ("معاك تحرير من مهارة
-- ميديا"): the seats hold English names, and a template in Arabic that says
-- "معاك Tahrir" reads wrong. Until it is set, Arabic templates sign as the
-- sales team.
alter table public.cockpit_sales_people add column if not exists name_ar text
  check (name_ar is null or length(name_ar) between 1 and 60);

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------

-- The follow-up agent: the new kinds (off until a person trusts them), the
-- HighLevel automations each kind replaces (by workflow id, read 2026-09-26),
-- whether to take a messaged lead out of them, email only as a fallback, and
-- when each message of a sequence is due (hours after the event).
update public.cockpit_sales_settings
set value = jsonb_build_object(
      'autosend',
      '{"reply": false, "confirm": false, "no_show": false, "cancelled": false, "new": false, "after_call": false, "nurture": false}'::jsonb
        || coalesce(value->'autosend', '{}'::jsonb),
      'takeover',
      '{"new": false, "no_show": false, "cancelled": false, "nurture": false}'::jsonb
        || coalesce(value->'takeover', '{}'::jsonb),
      'replaces',
      coalesce(value->'replaces', '{
        "new": ["c5467d7f-0692-4fef-b0c0-f286011db66b", "94887b79-44f7-4278-951d-34deecdda896"],
        "no_show": ["d8f6b1d3-16d4-4db2-8f5f-16e8e3cd8956", "b322dd8f-8b02-4ee8-bb09-c8fc3206a143"],
        "cancelled": ["f55a5830-45fd-4611-9e0b-c3dd9bbf6d7a", "04d5a67b-4e93-4fb9-9f9f-19ef9ef70282"],
        "nurture": ["d7ec270b-bb68-4443-a969-9feb8dfee058"]
      }'::jsonb),
      'email_fallback',
      '{"reply": true, "confirm": false, "no_show": true, "cancelled": true, "new": true, "after_call": true, "nurture": true}'::jsonb
        || coalesce(value->'email_fallback', '{}'::jsonb),
      'cadence',
      '{"new": [0.5, 24, 48, 96, 168], "no_show": [0.25, 24, 72, 144], "cancelled": [0.5, 48, 120], "after_call": [24, 72]}'::jsonb
        || coalesce(value->'cadence', '{}'::jsonb),
      'automation_gap_hours', coalesce(value->'automation_gap_hours', '20'::jsonb)
    ) || (value - 'autosend' - 'takeover' - 'replaces' - 'email_fallback' - 'cadence' - 'automation_gap_hours'),
    updated_by = 'migration',
    updated_at = now()
where key = 'followups';

-- The HighLevel contact fields a line template reads (made 2026-09-26).
insert into public.cockpit_sales_settings (key, value, updated_by)
values ('wa_fields', '{
  "line": {"id": "AUz1jpnWsYArbMFExJWP", "key": "contact.cockpit_whatsapp_line"},
  "rep": {"id": "y3WveySqHx3lb4b8uv5G", "key": "contact.cockpit_rep_name"}
}'::jsonb, 'migration')
on conflict (key) do nothing;

notify pgrst, 'reload schema';

commit;
