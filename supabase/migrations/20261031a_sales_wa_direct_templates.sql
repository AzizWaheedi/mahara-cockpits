-- WhatsApp templates the cockpit sends straight through HighLevel's
-- conversations API (2026-10-31). Tested that day: POST /conversations/messages
-- with whatsapp {type: template, template {name, lang}, placeholders {body}}
-- delivered an approved template to a number whose 24-hour window was closed,
-- and it shows in the HighLevel conversation. No workflow is needed, so a
-- direct template is live once it is active.
--
-- The rows are 19 of the sales sub-account's 49 approved Arabic templates
-- (Settings, WhatsApp, Templates, read 2026-10-31): the ones a rep sends by
-- hand to a quiet lead, whose only value is the lead's first name. Webinar,
-- summer reactivation, meeting-link and rejection templates are left out.
-- Segments stay empty, so the follow-up agent never picks them on its own.

alter table public.cockpit_sales_wa_templates
  add column if not exists direct boolean not null default false;

comment on column public.cockpit_sales_wa_templates.direct is
  'Sent straight through HighLevel''s conversations API by its name (no workflow). Live when active.';

insert into public.cockpit_sales_wa_templates
  (key, name, language, purpose, preview, variables, sort, direct, active)
values
  ('new_lead_1', 'new_lead_1', 'ar', 'New lead: do you have room for more projects?',
   E'عندكم القدرة تستلمون مشاريع زيادة، صح؟',
   '{}'::text[], 300, true, true),
  ('new_lead_2', 'new_lead_2', 'ar', 'New lead: you reached out a few days ago, still need help?',
   E'اهلا {{1}}، تواصلت معنا قبل كم يوم بخصوص الحصول على مشاريع أكثر\nهل للحين تحتاج مساعدة بهالشي؟',
   array['first_name'], 310, true, true),
  ('new_lead_3', 'new_lead_3', 'ar', 'New lead: following up to see if we can help',
   E'وصلت لنا قبل كم يوم {{1}}، حبيت أتابع معاك وأشوف إذا نقدر نساعدك.',
   array['first_name'], 320, true, true),
  ('new_lead_3_1', 'new_lead_3_1', 'ar', 'New lead: offer the first steps that bring results',
   E'ساعدنا عدد كبير من شركات التصميم و التنفيذ على حل التحديات اللي يواجهونها .أرسل لك بعض الخطوات اللي تقدر تطبّقها فوراً وتبدأ تشوف النتائج؟',
   '{}'::text[], 330, true, true),
  ('new_lead_4', 'new_lead_4', 'ar', 'New lead: offer to explain how we fill their calendar',
   E'تبيني أشرح لك بالضبط كيف نقدر نملّي جدولك بعملاء جادّين وجاهزين يبدأون مشاريعهم؟',
   '{}'::text[], 340, true, true),
  ('new_lead_5', 'new_lead_5', 'ar', 'New lead: ask for a quick call',
   E'السلام عليكم {{1}}، بس حبيت أشوف إذا أنتم فاضيين المكالمة سريعة عشان نشوف كيف نقدر نخدمكم',
   array['first_name'], 350, true, true),
  ('new_lead_6', 'new_lead_6', 'ar', 'New lead: last message, our proven system',
   E'هلا {{1}}، آخر رسالة مني\nعندنا نظام مُجرّب يحوّل شركات المقاولات والتصميم مثلك من شهور فاضية إلى جدول مليان بفرص مشاريع عالية القيمة وعملاء مؤهلين وجادين وبصراحة، حبينا نوريكم إياه.',
   array['first_name'], 360, true, true),
  ('no_show_1', 'no_show_1', 'ar', 'No-show: we had a call booked, what happened?',
   E'السلام عليكم {{1}}، كان عندنا مكالمة مجدولة في وقت سابق لكنك ما انضمّيت، صار شيء؟',
   array['first_name'], 370, true, true),
  ('no_show_2', 'no_show_2', 'ar', 'No-show: still interested in more projects?',
   E'السلام عليكم. بس حبيت أشوف إذا لحينكم مهتمين تشوفون كيف نقدر نساعد شركتكم تحصل مشاريع أكثر؟',
   '{}'::text[], 380, true, true),
  ('no_show_3', 'no_show_3', 'ar', 'No-show: check your email, I sent something',
   E'هلا {{1}}، شِك إيميلك، أرسلت لك شيء متأكد إنه بيساعدك',
   array['first_name'], 390, true, true),
  ('cancelled_2', 'cancelled_2', 'ar', 'Cancelled: did you mean to cancel our call?',
   E'هلا {{1}}، هل كنت تقصد إلغاء مكالمتنا أمس؟\n بس حبيت أتأكد وأشوف إذا لحينك مهتم تشوفون شلون نقدر نجيب لكم مشاريع أكثر.',
   array['first_name'], 400, true, true),
  ('cancelled_3', 'cancelled_3', 'ar', 'Cancelled: check your email, I sent something',
   E'السلام عليكم {{1}}، شيّك على إيميلك، أرسلت لك شيء متأكد إنه راح يفيدك.',
   array['first_name'], 410, true, true),
  ('unconfirmed_1', 'unconfirmed_1', 'ar', 'Unconfirmed: checking my last message',
   E'أراجع رسالتي السابقة  هذا {{1}}، صح؟',
   array['first_name'], 420, true, true),
  ('unconfirmed_2', 'unconfirmed_2', 'ar', 'Unconfirmed: was that time right? No reply yet',
   E'بس حبيت أتأكد إذا الوقت هذا كان الصحيح  ما وصلني رد منك، فافترضت يمكن صار فيه خطأ أو التباس',
   '{}'::text[], 430, true, true),
  ('intro_24hr_reminder', 'intro_24hr_reminder', 'ar', 'Reminder: our call is tomorrow',
   E'هلا {{1}}، تذكير بسيط لمكالمتنا غدًا.',
   array['first_name'], 440, true, true),
  ('follow_up_call_24_hrs', 'follow_up_call_24_hrs', 'ar', 'Reminder: see you on the call tomorrow',
   E'أهلا {{1}} أشوفك على المكالمة بكرة.',
   array['first_name'], 450, true, true),
  ('1_hour_before_intro', '1_hour_before_intro', 'ar', 'Reminder: I will call in an hour',
   E'هلا {{1}}، راح أتصل بعد ساعة',
   array['first_name'], 460, true, true),
  ('follow_up_call_1hr', 'follow_up_call_1hr', 'ar', 'Reminder: I will call you in an hour',
   E'السلام عليكم {{1}} اكلمكم بك بعد ساعة.',
   array['first_name'], 470, true, true),
  ('10_mins_before_intro', '10_mins_before_intro', 'ar', 'Calling in a few minutes',
   E'اهلا شوي وادق',
   '{}'::text[], 480, true, true)
on conflict (key) do nothing;
