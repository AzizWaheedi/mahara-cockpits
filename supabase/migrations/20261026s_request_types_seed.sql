-- Requests: the seed (docs/requests/CONTRACT.md section 2.3). GENERATED: do not edit.
-- bun scripts/gen-request-types-seed.ts > supabase/migrations/20261026s_request_types_seed.sql
-- Source: docs/requests/request-types.json (the folder fields of 901812879297 and the
-- template listing of team 90182518398, both read 2026-10-26). Applies after 20261026r.
--
-- 24 ClickUp folder fields, 34 template objects, 31 request types and
-- their version 1 rows. Every insert is ON CONFLICT DO NOTHING and a type is only
-- offered when its key is new, so an editor's change survives a re-apply.

BEGIN;

-- 1. The ClickUp folder fields a request type may write.
INSERT INTO public.cockpit_request_field_catalog (clickup_field_id, clickup_name, kind, label, options, state, read_at, updated_at) VALUES
  ('2de15aa5-7fe9-48bf-86a1-e4cfee1306c9', 'ADs Platform', 'select', 'Ad platform', '[{"id":"88d55b4b-f296-4a0b-abc6-3b228889444a","name":"Facebook/Meta"},{"id":"c115bdfe-661f-4855-a86b-69a54b2e616a","name":"Tiktok"},{"id":"97b22a7b-c18b-4be9-bd03-ff271bacfd77","name":"Snapchat"}]'::jsonb, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('41930456-4cbb-4431-bdd5-0a64df42a3d7', 'AD Form Name', 'text', 'Lead form name', NULL, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('ad13480f-8e36-4241-aacd-9b874f057749', 'AD Account Name', 'text', 'Ad account name', NULL, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('fa658ecb-fb6f-4cbe-9a2f-756180f2bdd0', 'Employee', 'text', 'Employee''s full name', NULL, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('ceb60e57-eedc-4ca3-8c55-6d9cfb87e249', 'Employee - Email', 'text', 'Employee''s work email', NULL, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('6742edfb-9b6f-4615-933d-7ebd74f9542b', 'Additional Notes', 'text', 'Notes', NULL, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('e58f563a-63c7-4f3a-b5cd-07cbb4a420d4', 'Schedule Rate Issue', 'select', 'Where is the problem?', '[{"id":"a2343b36-5d92-428d-9f73-ce47711480c2","name":"Ads issue"},{"id":"cf9d1709-8d52-489b-9600-21e6a0d6ac12","name":"Call Center Issue"},{"id":"0014e47b-560a-4109-830c-77d6d60d985c","name":"Both"}]'::jsonb, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('0f8f9334-69e7-46fc-aad1-d62402387f27', 'Lead List', 'url', 'Lead list link', NULL, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('52ab75a1-20a6-4afe-aa40-95bcf99b35b0', '📍 New Company Address', 'text', 'New company address', NULL, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('faa59f18-beb5-4a76-84e8-14b93c8636a7', '🆕 New Company Name', 'text', 'New company name', NULL, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('35f4bf1a-7df5-4cc0-919c-2669aea0bc27', 'Qualification Questions', 'longtext', 'Questions to add', NULL, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('3a7c5292-0215-43e6-808a-f50abfb1f316', 'Funnel Intent Level', 'select', 'Switch to which intent level?', '[{"id":"f178d789-f938-4409-9a6d-04305cb650ae","name":"High Intent"},{"id":"b89e5675-9907-463b-ae8d-330c603dc382","name":"Mid Intent"},{"id":"17f36697-eed6-404b-a13c-fda9799db42c","name":"Low Intent"}]'::jsonb, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('5fd89e5e-98c8-4800-a1ce-33f5b739a275', 'Script Type', 'select', 'What are we writing?', '[{"id":"ba39a410-0698-4bff-9cc9-b2a3eacddb9d","name":"Paid Ads Reel"},{"id":"464556b1-f7b9-44b8-9291-b7add20f731a","name":"Organic Reel"},{"id":"b1108fa3-d59d-41dc-9366-d83ae7c6aad3","name":"UGC / Talking Head"},{"id":"58fdcaad-4497-448d-afd6-bb5ee962a684","name":"Video Sales Letter (VSL)"},{"id":"d7b94a22-254d-4bb1-8b6a-4f52d80f1711","name":"Thank You / Post-Booking Video"},{"id":"8809d9c5-29ed-42c8-851a-aba39d98a3a3","name":"Landing Page Copy"},{"id":"0649cb57-28e2-4073-b9ea-9e1af77291f7","name":"Webinar / Presentation"},{"id":"b152be7e-d5a8-479d-bbbf-32b9751633d6","name":"Email or WhatsApp Sequence"},{"id":"944139ef-05dc-4933-80ad-5bc77f1fa6ca","name":"Other (see notes)"}]'::jsonb, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('846f445e-ab13-4be2-84c5-2b5210dbca35', 'Script Style', 'select', 'How is it shot?', '[{"id":"05b0dbf6-ed17-4366-a458-28428d40ff5c","name":"UGC / Talking Head"},{"id":"00b7a6f2-af93-4263-a99d-0231baec4279","name":"Voiceover (VO)"},{"id":"58187607-f84a-479a-9707-bf7690ec1d80","name":"POV"},{"id":"e6bfb0a0-54e6-4cf2-b041-312d500486f8","name":"VO + POV"},{"id":"6d486525-7e18-4082-8ee9-8aaa77516a73","name":"AI Avatar"}]'::jsonb, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('7cbff577-4a7b-491f-ab60-5937b3bda4a3', 'Orientation', 'select', 'Orientation', '[{"id":"1dbd6ae4-6590-44e2-bc4e-eb1107e72c56","name":"Vertical 9:16"},{"id":"2ded3907-6baf-4212-83b1-9de7028d200d","name":"Horizontal 16:9"},{"id":"1f275885-78e4-44c2-9faf-3be78cd0e2ef","name":"Square 1:1"}]'::jsonb, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('833192d1-e11b-4f91-807a-60abad061ff2', 'Script Quantity', 'number', 'How many scripts?', NULL, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('fb0e7743-9076-473b-9238-72ec729df120', 'Who Films It', 'select', 'Who films it?', '[{"id":"1bbc46a6-bc2f-4fc7-8ecd-c85433c8a12d","name":"Us"},{"id":"984160c0-0142-43a8-a2c6-c8a6ccbb152d","name":"Them"}]'::jsonb, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('0d6140e8-f145-4415-a82e-1d348904924a', 'Script Language', 'select', 'Script language', '[{"id":"c3036bbc-b018-481e-930c-cf5d455fb8ba","name":"Arabic"},{"id":"a7c25514-4947-4a73-b2e2-965a84685838","name":"English"},{"id":"5ee795d2-959e-488f-9ec6-6e3af614ea25","name":"Both"}]'::jsonb, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('673028fc-8cf7-4e56-815b-bd454c8d604a', 'Arabic Dialect', 'select', 'Arabic dialect', '[{"id":"d0ef015b-fc0d-45b7-a817-26ab5ea45a05","name":"Kuwaiti"},{"id":"07a87cdb-aba4-4650-b6fa-8f1087db2838","name":"Bahraini"},{"id":"18e715c4-1c55-4d4c-a6b9-26d2e327d823","name":"Qatari"},{"id":"ced15044-acdf-4757-976d-d30a9cf269ae","name":"Emirati"},{"id":"737f5e82-52cf-444f-9194-1979486cf267","name":"Omani"},{"id":"ca26f478-b956-419d-8118-9185443edcf8","name":"Saudi - Najdi (Riyadh/central)"},{"id":"3f2a3026-571b-45e9-b4d8-5a919f2f6467","name":"Saudi - Hejazi (Jeddah/west)"},{"id":"dce1503c-38b1-4fd8-a436-b39273af93fd","name":"Saudi - Eastern"},{"id":"f6082a08-8fa0-4c0c-98a2-ace005910ccf","name":"Standard Arabic (Fusha)"},{"id":"b855466d-5063-42bd-bcb9-75e1debc13d2","name":"English only"}]'::jsonb, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('4b9c5187-430f-4534-99cf-db3fa2741dda', 'Video for Page (optional)', 'url', 'Video for the page', NULL, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('41b41285-1152-48b8-85f2-ccb080ea7662', 'Copy Doc or Link', 'longtext', 'Copy doc or link', NULL, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('dfe24578-f27a-43ea-970f-4dd9e1825b47', 'Page Goal', 'select', 'Page goal', '[{"id":"33d8bef7-9176-4190-bc2d-d92bfa338232","name":"Book a call"},{"id":"7d746cc8-5ee3-4ce5-a1fc-f84b2c244a3e","name":"Lead form submit"},{"id":"33c19c2c-dedd-4eab-80b6-38ff08270006","name":"WhatsApp chat"},{"id":"c3831a22-c5f3-4d64-9473-80fcb888e245","name":"Webinar registration"},{"id":"0cb21102-bac7-408b-a75f-f43be1347a13","name":"Other (see notes)"}]'::jsonb, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('bcba69d7-9941-486d-84f5-6d6dcdefe4d3', 'Requested Questions (optional)', 'longtext', 'Any questions to add?', NULL, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz),
  ('5000c43f-18a7-4c50-bf7b-60d59ca41417', 'Privacy Policy - Type', 'text', 'Which page needs the policy?', NULL, 'ok', '2026-10-26 00:00:00+00'::timestamptz, '2026-10-26 00:00:00+00'::timestamptz)
ON CONFLICT (clickup_field_id) DO NOTHING;

-- 2. The ClickUp template objects (id and name only).
INSERT INTO public.cockpit_request_templates (id, name, state, seen_at) VALUES
  ('t-86ex8x9xw', 'Tech Onboarding', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86ex8xaf1', 'Media Onboarding 2.0', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86eyu1w3d', 'Creative Onboarding', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86ex6fpu3', 'Ad Spend Invoice Request 🧾', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86ex1965m', 'Add Custom Values to Client''s sub account', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86exj3gx1', 'Add custom qualifiation questions🙋', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86ex6fdwu', 'Card Missing 💳 ❌', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86exj3ngz', 'Change Company Address📍', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86exj3n5t', 'Change Company Name⏎', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86ex629x6', 'Client Offboarding (Media) 👋❌', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86ex629ve', 'Client Offboarding (Tech) 👋❌', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86ex63qm7', 'Client Pause ⏸️ (Media)', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86ex63qk5', 'Client Pause ⏸️ (Tech)', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86exj3g1a', 'Client Reactivation Campaign (Media)📣', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86exghd6t', 'Client Reactivation Campaign📣', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86exj3h8f', 'Client Reactivation Campaign📣 (Tech)', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86ex63qjj', 'Client Relaunch 🚀↪️ (Media)', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86ex63qhr', 'Client Relaunch 🚀↪️ (Tech)', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86ex09tmh', 'Connecting a new lead form', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86exer2gv', 'Create Landing Page📊', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86ex6f3q7', 'Create Meta Ad Account 🛜', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86ex6ehwe', 'Create Snapchat Ad Account 👻', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86ex6ee7a', 'Create TikTok Ad Account 🎵', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86ex1964h', 'Lanuch New Client Campaign 🚀', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86exj3cvt', 'Low Schedule Rate📉 (Ads)', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86exj3d37', 'Low Schedule Rate📉 (Call Center)', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86exj3ddv', 'Low Show Rate📉', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86ex09vmq', 'Missing Leads ❌', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86ex09ytj', 'New Employee Onboarding 🙋‍♂️', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86ex63j6n', 'New Script Request✍️', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86exy04v4', 'Social Media Management Template', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86exj3gk4', 'Switch funnel intent level🌪️', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86exj3gfx', 'Switch to funnel intent🌪️', 'ok', '2026-10-26 00:00:00+00'::timestamptz),
  ('t-86ex62m1b', 'Whatsapp Connection Issue📲❌', 'ok', '2026-10-26 00:00:00+00'::timestamptz)
ON CONFLICT (id) DO NOTHING;

-- 3. The request types, in ClickUp's option order.
-- 0. Connect a new lead form
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'connect_lead_form', 0, 'Connect a new lead form', 'Connect a New Lead Form  🆕 ', '37d99ca0-e53f-4499-90e8-f1be8a21b207'::uuid, 'tech',
  '[{"part":"main","name_suffix":"","list_id":"901816723190","team":"tech","template_id":"t-86ex09tmh","template_name":"Connecting a new lead form","owner_rule":"systems_manager","owner_clickup_id":113459516,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"ads_platform","label":"Ad platform","kind":"select","clickup_field_id":"2de15aa5-7fe9-48bf-86a1-e4cfee1306c9","required":false,"options":null,"help":null},{"key":"ad_form_name","label":"Lead form name","kind":"text","clickup_field_id":"41930456-4cbb-4431-bdd5-0a64df42a3d7","required":true,"options":null,"help":null},{"key":"ad_account_name","label":"Ad account name","kind":"text","clickup_field_id":"ad13480f-8e36-4241-aacd-9b874f057749","required":true,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  NULL, 'none', 'https://docs.google.com/document/d/1cNcRmUzlT0mftjP6jqiw_yJUCHAdXhth9hZULaIDLK4/edit', 2, 'normal', false, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'connect_lead_form')
ON CONFLICT (key) DO NOTHING;
-- 1. Create an ad account
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'create_ad_account', 1, 'Create an ad account', 'Create Ad Account', 'fd4d330d-2bda-4872-b195-11e694b29231'::uuid, 'ads',
  '[{"part":"meta","name_suffix":"","list_id":"901816723196","team":"ads","template_id":"t-86ex6f3q7","template_name":"Create Meta Ad Account 🛜","owner_rule":"media_buyer_of_record","owner_clickup_id":null,"when":{"field_key":"ads_platform","options":["88d55b4b-f296-4a0b-abc6-3b228889444a"]}},{"part":"tiktok","name_suffix":"","list_id":"901816723196","team":"ads","template_id":"t-86ex6ee7a","template_name":"Create TikTok Ad Account 🎵","owner_rule":"media_buyer_of_record","owner_clickup_id":null,"when":{"field_key":"ads_platform","options":["c115bdfe-661f-4855-a86b-69a54b2e616a"]}},{"part":"snapchat","name_suffix":"","list_id":"901816723196","team":"ads","template_id":"t-86ex6ehwe","template_name":"Create Snapchat Ad Account 👻","owner_rule":"media_buyer_of_record","owner_clickup_id":null,"when":{"field_key":"ads_platform","options":["97b22a7b-c18b-4be9-bd03-ff271bacfd77"]}}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"ads_platform","label":"Ad platform","kind":"select","clickup_field_id":"2de15aa5-7fe9-48bf-86a1-e4cfee1306c9","required":true,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":true,"options":null,"help":null}]'::jsonb,
  NULL, 'none', 'https://docs.google.com/document/d/1H1jozw8G544KlDTH_4bIqD-52TOF4wXtL5zF9zoSwPE/edit', 3, 'normal', false, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'create_ad_account')
ON CONFLICT (key) DO NOTHING;
-- 2. Missing leads
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'missing_leads', 2, 'Missing leads', 'Missing Leads ❌', '9fd304bb-7078-4485-9b9f-aa19ad47ed98'::uuid, 'tech',
  '[{"part":"main","name_suffix":"","list_id":"901816723190","team":"tech","template_id":"t-86ex09vmq","template_name":"Missing Leads ❌","owner_rule":"systems_manager","owner_clickup_id":113459516,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"ads_platform","label":"Ad platform","kind":"select","clickup_field_id":"2de15aa5-7fe9-48bf-86a1-e4cfee1306c9","required":true,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  NULL, 'none', 'https://docs.google.com/document/d/1WOZE2zcUM6sXK0uGBBSgr1Tg2wnGHDIxpmvA6CJTtc4/edit', 1, 'high', false, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'missing_leads')
ON CONFLICT (key) DO NOTHING;
-- 3. New employee onboarding
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'employee_onboarding', 3, 'New employee onboarding', 'New Employee Onboarding 🤵', '88ab0389-7e36-4714-8b65-6d966ce9aed1'::uuid, 'tech',
  '[{"part":"main","name_suffix":"","list_id":"901816723190","team":"tech","template_id":"t-86ex09ytj","template_name":"New Employee Onboarding 🙋‍♂️","owner_rule":"systems_manager","owner_clickup_id":113459516,"when":null}]'::jsonb,
  '[{"key":"employee_name","label":"Employee''s full name","kind":"text","clickup_field_id":"fa658ecb-fb6f-4cbe-9a2f-756180f2bdd0","required":true,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":true,"options":null,"help":null}]'::jsonb,
  NULL, 'none', NULL, 3, 'normal', false, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'employee_onboarding')
ON CONFLICT (key) DO NOTHING;
-- 4. Employee offboarding
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'employee_offboarding', 4, 'Employee offboarding', 'Employee Offboarding 👋', '504c3ffc-9264-4402-b03e-f349d0d8cbe0'::uuid, 'tech',
  '[{"part":"main","name_suffix":"","list_id":"901816723190","team":"tech","template_id":null,"template_name":null,"owner_rule":"systems_manager","owner_clickup_id":113459516,"when":null}]'::jsonb,
  '[{"key":"employee_name","label":"Employee''s full name","kind":"text","clickup_field_id":"fa658ecb-fb6f-4cbe-9a2f-756180f2bdd0","required":true,"options":null,"help":null},{"key":"employee_email","label":"Employee''s work email","kind":"text","clickup_field_id":"ceb60e57-eedc-4ca3-8c55-6d9cfb87e249","required":true,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  '["Confirm the last working day and the seat with the requester.","Remove the person from Slack and ClickUp, and from any cockpit owner rule or ClickUp list rule that names them.","Remove their GoHighLevel user; for a dialer, remove their row in Agent Info.","Turn off their cockpit seat and end their Hubstaff and Timetastic seats.","Swap them out of every future calendar meeting and give their open tasks a new owner.","Move the files and logins they own to a company account, then suspend their Google Workspace user.","Post in the department channel that access is removed, then mark the task complete."]'::jsonb, 'draft', NULL, 1, 'normal', true, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'employee_offboarding')
ON CONFLICT (key) DO NOTHING;
-- 5. Privacy policy
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'privacy_policy', 5, 'Privacy policy', 'Create a Privacy Policy Request 📝', '5552a329-4e97-45d6-a195-9097e7df5cf5'::uuid, 'tech',
  '[{"part":"main","name_suffix":"","list_id":"901816723190","team":"tech","template_id":null,"template_name":null,"owner_rule":"systems_manager","owner_clickup_id":113459516,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"details","label":"What is needed?","kind":"details","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"privacy_policy_type","label":"Which page needs the policy?","kind":"text","clickup_field_id":"5000c43f-18a7-4c50-bf7b-60d59ca41417","required":false,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  '["Read Privacy Policy - Type: which page needs it (lead form, landing page, app or website).","Confirm the client''s legal name, address, contact email and the data the form collects.","Write the policy page in the client''s GoHighLevel sub-account, starting from the last policy page the team published.","Publish it on the client''s domain and check the link opens without a login.","Add the link where it is needed (lead form, page footer or app settings).","Paste the URL in the task and in a comment on the client card, tell the requester, and mark the task complete."]'::jsonb, 'draft', NULL, 3, 'normal', true, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'privacy_policy')
ON CONFLICT (key) DO NOTHING;
-- 6. Ad spend invoice
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'ad_spend_invoice', 6, 'Ad spend invoice', 'AD Spend Invoice Request🧾', 'a82b0b80-e4f7-4f30-a3a5-49a5ea4c7f2d'::uuid, 'client_success',
  '[{"part":"main","name_suffix":"","list_id":"901816723211","team":"client_success","template_id":"t-86ex6fpu3","template_name":"Ad Spend Invoice Request 🧾","owner_rule":"csm_of_card","owner_clickup_id":113688800,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  NULL, 'none', 'https://docs.google.com/document/d/1q9GBq3yi8jaoGQBV0ZyGsI6sXsod6QnEykhPJjyKTpw/edit', 2, 'normal', false, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'ad_spend_invoice')
ON CONFLICT (key) DO NOTHING;
-- 7. WhatsApp connection issue
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'whatsapp_connection', 7, 'WhatsApp connection issue', 'Whatsapp Connection Issue 🔁', '663ffd51-a838-4038-a8c0-a936b86f43b7'::uuid, 'client_success',
  '[{"part":"main","name_suffix":"","list_id":"901816723211","team":"client_success","template_id":"t-86ex62m1b","template_name":"Whatsapp Connection Issue📲❌","owner_rule":"csm_of_card","owner_clickup_id":113688800,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  '["Open Agency View in MaharaOS, then WhatsApp, and find the client''s account.","Confirm the connection shows disconnected or an error.","Send the client the QR code link to rescan.","Confirm WhatsApp shows active (green).","Tell the requester in Slack that it is resolved.","Mark the task complete."]'::jsonb, 'source', 'https://docs.google.com/document/d/1uQpWkwse7X3a0H9QcdTo57kayY0f4lO9tFB56_N3nr4/edit', 1, 'high', false, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'whatsapp_connection')
ON CONFLICT (key) DO NOTHING;
-- 8. WhatsApp reactivation campaign
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'whatsapp_reactivation', 8, 'WhatsApp reactivation campaign', 'Whatsapp Reactivation Campaign 📬', '862f83da-8980-4ebe-9477-7501ccbf23d3'::uuid, 'creative',
  '[{"part":"message","name_suffix":" (Media)","list_id":"901818016338","team":"creative","template_id":"t-86exj3g1a","template_name":"Client Reactivation Campaign (Media)📣","owner_rule":"creative_strategist","owner_clickup_id":113520400,"when":null},{"part":"send","name_suffix":" (Tech)","list_id":"901816723190","team":"tech","template_id":"t-86exj3h8f","template_name":"Client Reactivation Campaign📣 (Tech)","owner_rule":"systems_manager","owner_clickup_id":113459516,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"lead_list","label":"Lead list link","kind":"url","clickup_field_id":"0f8f9334-69e7-46fc-aad1-d62402387f27","required":true,"options":null,"help":null},{"key":"additional_notes","label":"Notes","kind":"text","clickup_field_id":"6742edfb-9b6f-4615-933d-7ebd74f9542b","required":false,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  NULL, 'none', 'https://docs.google.com/document/d/1VRjaZCVVOD26NCar6sCtWbxgoPGgj7vGtPI4vDrxZY8/edit', 5, 'normal', false, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'whatsapp_reactivation')
ON CONFLICT (key) DO NOTHING;
-- 9. Add custom qualification questions
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'qualification_questions', 9, 'Add custom qualification questions', 'Add Custom Qualification Questions🙋', '7fc82c41-7bcd-47f7-bae0-868d4954495b'::uuid, 'tech',
  '[{"part":"main","name_suffix":"","list_id":"901816723190","team":"tech","template_id":"t-86exj3gx1","template_name":"Add custom qualifiation questions🙋","owner_rule":"systems_manager","owner_clickup_id":113459516,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"ads_platform","label":"Ad platform","kind":"select","clickup_field_id":"2de15aa5-7fe9-48bf-86a1-e4cfee1306c9","required":true,"options":null,"help":null},{"key":"qualification_questions","label":"Questions to add","kind":"longtext","clickup_field_id":"35f4bf1a-7df5-4cc0-919c-2669aea0bc27","required":true,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  NULL, 'none', 'https://docs.google.com/document/d/1YtGLAN7yQEkMqqEAMg3EugbDt4P1Q7J_WEKbXRGD7vQ/edit', 2, 'normal', false, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'qualification_questions')
ON CONFLICT (key) DO NOTHING;
-- 10. Client offboarding
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'client_offboarding', 10, 'Client offboarding', 'Client Offboarding Request 🔴', 'd5ab86ae-18af-42d5-abd1-120c3fa2bcc3'::uuid, 'tech',
  '[{"part":"tech","name_suffix":" (Tech)","list_id":"901816723190","team":"tech","template_id":"t-86ex629ve","template_name":"Client Offboarding (Tech) 👋❌","owner_rule":"systems_manager","owner_clickup_id":113459516,"when":null},{"part":"media","name_suffix":" (Media)","list_id":"901816723196","team":"ads","template_id":"t-86ex629x6","template_name":"Client Offboarding (Media) 👋❌","owner_rule":"media_buyer_of_record","owner_clickup_id":null,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"additional_notes","label":"Notes","kind":"text","clickup_field_id":"6742edfb-9b6f-4615-933d-7ebd74f9542b","required":false,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":false,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  NULL, 'none', 'https://docs.google.com/document/d/1tlZlMcasIXU23wMNjvqcrzx1qzKeCLlPyDLOPcGfoNc/edit', 2, 'normal', true, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'client_offboarding')
ON CONFLICT (key) DO NOTHING;
-- 11. Change from DFY to DWY
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'dfy_to_dwy', 11, 'Change from DFY to DWY', 'Change From DFY to DWY 🔁', 'd5a87389-3657-4334-8aee-14d67c2129d3'::uuid, 'client_success',
  '[{"part":"main","name_suffix":"","list_id":"901816723211","team":"client_success","template_id":null,"template_name":null,"owner_rule":"csm_of_card","owner_clickup_id":113688800,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"details","label":"Details","kind":"details","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  '["Confirm the client has a call team and collect each caller''s name, email and phone.","Tell the client Mahara now runs ads only, and book the handover call with their team.","Add the callers as users in the client''s GoHighLevel sub-account and confirm each gets a test push in the LeadConnector app.","In the client''s clone only: turn on \"DWY — New Lead → Client Internal Notification\", turn off the call centre agent workflows and Mahara webhooks, and set Service Mode to DWY.","Push a dummy lead: the caller is notified and a booking sends one confirmation.","Train the client''s callers on the client dialing SOP and paste its link in the Call Center SOP Link custom value.","Stop our dialing: take the client out of Make 8850419 and 8842754, Maqsam routing and Agent Data.","Record the reporting choice (clean cut or keep visibility) and set the card''s Service field to DWY.","Confirm no Mahara channel, scenario or sheet still gets this client''s leads, then mark the task complete."]'::jsonb, 'draft', 'https://docs.google.com/document/d/1CVVFtBK4rd7rbQPnjjt6Y3aAoj4cfuYAnvzrzQeEzls/edit', 5, 'normal', true, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'dfy_to_dwy')
ON CONFLICT (key) DO NOTHING;
-- 12. Change from DWY to DFY
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'dwy_to_dfy', 12, 'Change from DWY to DFY', 'Change From DWY to DFY 🔁', '5e83c505-a5b2-43f1-849c-ce3a11c0c7b1'::uuid, 'client_success',
  '[{"part":"main","name_suffix":"","list_id":"901816723211","team":"client_success","template_id":null,"template_name":null,"owner_rule":"csm_of_card","owner_clickup_id":113688800,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"details","label":"What is needed?","kind":"details","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  '["Confirm the switch date with the client and the call centre.","In the client''s clone: turn the call centre agent workflows and Mahara webhooks back on, turn off \"DWY — New Lead → Client Internal Notification\", and set Service Mode to DFY.","Add the client back to Make 8850419 and 8842754, Maqsam routing and Agent Data.","Restore the client''s Client Data row and check its GoHighLevel API key works.","Update the call centre knowledge base and brief the agents on the client.","Push a dummy lead: our agents get the notification and the speed-to-lead tracker fires.","Set the card''s Service field to DFY, tell the client who now calls their leads, and mark the task complete."]'::jsonb, 'draft', NULL, 5, 'normal', true, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'dwy_to_dfy')
ON CONFLICT (key) DO NOTHING;
-- 13. Client pause
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'client_pause', 13, 'Client pause', 'Client Pause Request ⏸️', '196991a9-dac9-4da8-a693-6b6d64372be5'::uuid, 'tech',
  '[{"part":"tech","name_suffix":" (Tech)","list_id":"901816723190","team":"tech","template_id":"t-86ex63qk5","template_name":"Client Pause ⏸️ (Tech)","owner_rule":"systems_manager","owner_clickup_id":113459516,"when":null},{"part":"media","name_suffix":" (Media)","list_id":"901816723196","team":"ads","template_id":"t-86ex63qm7","template_name":"Client Pause ⏸️ (Media)","owner_rule":"media_buyer_of_record","owner_clickup_id":null,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":true,"options":null,"help":null}]'::jsonb,
  NULL, 'none', 'https://docs.google.com/document/d/1qctuHLsH6TJl_E9UFIfTzy-ZzkcGuHhCbHspc7SabX4/edit', 2, 'normal', false, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'client_pause')
ON CONFLICT (key) DO NOTHING;
-- 14. Client relaunch
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'client_relaunch', 14, 'Client relaunch', 'Client Relaunch Request ⏯️', '59b89a7c-6970-4aad-8c01-1d7bf58b124a'::uuid, 'tech',
  '[{"part":"tech","name_suffix":" (Tech)","list_id":"901816723190","team":"tech","template_id":"t-86ex63qhr","template_name":"Client Relaunch 🚀↪️ (Tech)","owner_rule":"systems_manager","owner_clickup_id":113459516,"when":null},{"part":"media","name_suffix":" (Media)","list_id":"901816723196","team":"ads","template_id":"t-86ex63qjj","template_name":"Client Relaunch 🚀↪️ (Media)","owner_rule":"media_buyer_of_record","owner_clickup_id":null,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":true,"options":null,"help":null}]'::jsonb,
  NULL, 'none', NULL, 2, 'normal', false, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'client_relaunch')
ON CONFLICT (key) DO NOTHING;
-- 15. Change company name
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'company_name', 15, 'Change company name', 'Change Company Name🔃', 'bbef2ea6-a3cd-49be-a82d-33352a23f7d0'::uuid, 'tech',
  '[{"part":"main","name_suffix":"","list_id":"901816723190","team":"tech","template_id":"t-86exj3n5t","template_name":"Change Company Name⏎","owner_rule":"systems_manager","owner_clickup_id":113459516,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"new_company_name","label":"New company name","kind":"text","clickup_field_id":"faa59f18-beb5-4a76-84e8-14b93c8636a7","required":true,"options":null,"help":null},{"key":"additional_notes","label":"Notes","kind":"text","clickup_field_id":"6742edfb-9b6f-4615-933d-7ebd74f9542b","required":false,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  NULL, 'none', 'https://docs.google.com/document/d/1XOPCoouk4fHTh2sRBm0yyJabGNmlEwMssYcwbNfbCCY/edit', 3, 'normal', true, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'company_name')
ON CONFLICT (key) DO NOTHING;
-- 16. Change company address
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'company_address', 16, 'Change company address', 'Change Company Address🔃', '9d0997fb-0523-477a-b5fe-54dd3971a614'::uuid, 'tech',
  '[{"part":"main","name_suffix":"","list_id":"901816723190","team":"tech","template_id":"t-86exj3ngz","template_name":"Change Company Address📍","owner_rule":"systems_manager","owner_clickup_id":113459516,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"new_company_address","label":"New company address","kind":"text","clickup_field_id":"52ab75a1-20a6-4afe-aa40-95bcf99b35b0","required":true,"options":null,"help":null},{"key":"additional_notes","label":"Notes","kind":"text","clickup_field_id":"6742edfb-9b6f-4615-933d-7ebd74f9542b","required":false,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  NULL, 'none', 'https://docs.google.com/document/d/1TbkDR0LW8MCUYMESaCqKoHVZaRRdxFUdS2_sh7AxNRs/edit', 2, 'normal', true, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'company_address')
ON CONFLICT (key) DO NOTHING;
-- 17. Switch funnel intent
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'funnel_intent', 17, 'Switch funnel intent', 'Switch Funnel Intent🌪️', '645a7f4f-a4d8-4fe7-a58c-dda546c40188'::uuid, 'tech',
  '[{"part":"main","name_suffix":"","list_id":"901816723190","team":"tech","template_id":"t-86exj3gk4","template_name":"Switch funnel intent level🌪️","owner_rule":"systems_manager","owner_clickup_id":113459516,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"funnel_intent_level","label":"Switch to which intent level?","kind":"select","clickup_field_id":"3a7c5292-0215-43e6-808a-f50abfb1f316","required":true,"options":null,"help":null},{"key":"additional_notes","label":"Notes","kind":"text","clickup_field_id":"6742edfb-9b6f-4615-933d-7ebd74f9542b","required":false,"options":null,"help":null},{"key":"requested_questions","label":"Any questions to add?","kind":"longtext","clickup_field_id":"bcba69d7-9941-486d-84f5-6d6dcdefe4d3","required":false,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  NULL, 'none', 'https://docs.google.com/document/d/1do0qlIMjKf7P3MYK47aUEZdsItQMNOIu_Y_jCcQxBvg/edit', 3, 'normal', false, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'funnel_intent')
ON CONFLICT (key) DO NOTHING;
-- 18. Create a landing page
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'landing_page', 18, 'Create a landing page', 'Create Landing Page📊', 'a2d9483c-2dde-486d-969e-78679e5d27a6'::uuid, 'tech',
  '[{"part":"main","name_suffix":"","list_id":"901816723190","team":"tech","template_id":"t-86exer2gv","template_name":"Create Landing Page📊","owner_rule":"systems_manager","owner_clickup_id":113459516,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"additional_notes","label":"Notes","kind":"text","clickup_field_id":"6742edfb-9b6f-4615-933d-7ebd74f9542b","required":false,"options":null,"help":null},{"key":"requested_questions","label":"Any questions to add?","kind":"longtext","clickup_field_id":"bcba69d7-9941-486d-84f5-6d6dcdefe4d3","required":false,"options":null,"help":null},{"key":"page_goal","label":"Page goal","kind":"select","clickup_field_id":"dfe24578-f27a-43ea-970f-4dd9e1825b47","required":false,"options":null,"help":null},{"key":"copy_link","label":"Copy doc or link","kind":"longtext","clickup_field_id":"41b41285-1152-48b8-85f2-ccb080ea7662","required":false,"options":null,"help":null},{"key":"video_for_page","label":"Video for the page","kind":"url","clickup_field_id":"4b9c5187-430f-4534-99cf-db3fa2741dda","required":false,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  NULL, 'none', 'https://docs.google.com/document/d/1jjyMvWbmV3tZDfV3yD2isqQA9E3cGEv_3AZ2JSrJcic/edit', 10, 'normal', false, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'landing_page')
ON CONFLICT (key) DO NOTHING;
-- 19. Client success request
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'csm_request', 19, 'Client success request', 'Client Success Management Request 🙋‍♂️', '6cde0a1f-a3f1-43c3-b9f9-7166e6899463'::uuid, 'client_success',
  '[{"part":"main","name_suffix":"","list_id":"901816723211","team":"client_success","template_id":null,"template_name":null,"owner_rule":"csm_of_card","owner_clickup_id":113688800,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"details","label":"What is needed?","kind":"details","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  '["Read the request and open the client''s card; ask the requester for anything missing the same day.","Agree the next step and a due date with the requester in the task comments.","Do the work, or book the client call it needs.","Log the outcome on the client card.","Tell the requester it is done and mark the task complete."]'::jsonb, 'draft', NULL, 2, 'normal', true, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'csm_request')
ON CONFLICT (key) DO NOTHING;
-- 20. Business licence missing
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'business_licence', 20, 'Business licence missing', 'Client Business License is Missing ❗', 'b286f3d0-957e-487f-92ef-ae82499c450e'::uuid, 'client_success',
  '[{"part":"main","name_suffix":"","list_id":"901816723211","team":"client_success","template_id":null,"template_name":null,"owner_rule":"csm_of_card","owner_clickup_id":113688800,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"details","label":"What is needed?","kind":"details","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  '["Ask the requester which account needs the licence (Meta business verification, TikTok, Snapchat or another) and by when.","Message the client in their group asking for a clear copy of the commercial licence and say why.","Save the file in the client''s Drive folder.","Send the file location to the requester and confirm they submitted it.","Confirm the platform accepted it.","Log it on the client card and mark the task complete."]'::jsonb, 'draft', NULL, 2, 'normal', true, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'business_licence')
ON CONFLICT (key) DO NOTHING;
-- 21. Card missing for ads
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'card_missing', 21, 'Card missing for ads', 'Client Card Missing for ADs ❗❗', '7e7ae553-abde-4cd2-af26-a1cca7be668c'::uuid, 'client_success',
  '[{"part":"main","name_suffix":"","list_id":"901816723211","team":"client_success","template_id":null,"template_name":null,"owner_rule":"csm_of_card","owner_clickup_id":113688800,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  '["Confirm the ad account is stopped by a missing or failed payment method.","Ask the client to add the card themselves on the platform''s billing page, or on a short call while they type it; never collect card numbers in chat or a form.","Check in the ad account that the payment method shows active and any unpaid balance is cleared.","Confirm with the media buyer that ads are running again.","Log it on the client card and mark the task complete."]'::jsonb, 'draft', NULL, 1, 'high', false, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'card_missing')
ON CONFLICT (key) DO NOTHING;
-- 22. New script
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'new_script', 22, 'New script', 'New Script Request 📗', 'a79b08d7-8e4f-469d-b70f-cba8514a06c3'::uuid, 'creative',
  '[{"part":"main","name_suffix":"","list_id":"901818016338","team":"creative","template_id":"t-86ex63j6n","template_name":"New Script Request✍️","owner_rule":"creative_strategist","owner_clickup_id":113520400,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"script_type","label":"What are we writing?","kind":"select","clickup_field_id":"5fd89e5e-98c8-4800-a1ce-33f5b739a275","required":true,"options":null,"help":null},{"key":"script_style","label":"How is it shot?","kind":"select","clickup_field_id":"846f445e-ab13-4be2-84c5-2b5210dbca35","required":false,"options":null,"help":null},{"key":"orientation","label":"Orientation","kind":"select","clickup_field_id":"7cbff577-4a7b-491f-ab60-5937b3bda4a3","required":true,"options":null,"help":null},{"key":"script_quantity","label":"How many scripts?","kind":"number","clickup_field_id":"833192d1-e11b-4f91-807a-60abad061ff2","required":true,"options":null,"help":null},{"key":"who_films","label":"Who films it?","kind":"select","clickup_field_id":"fb0e7743-9076-473b-9238-72ec729df120","required":true,"options":null,"help":null},{"key":"script_language","label":"Script language","kind":"select","clickup_field_id":"0d6140e8-f145-4415-a82e-1d348904924a","required":true,"options":null,"help":null},{"key":"arabic_dialect","label":"Arabic dialect","kind":"select","clickup_field_id":"673028fc-8cf7-4e56-815b-bd454c8d604a","required":false,"options":null,"help":null},{"key":"additional_notes","label":"Notes","kind":"text","clickup_field_id":"6742edfb-9b6f-4615-933d-7ebd74f9542b","required":false,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  NULL, 'none', 'https://docs.google.com/document/d/1B961T9tc5Dgu4qTHvecojnjIBxxzQpP7U5dgx_C5Imk/edit', 7, 'normal', false, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'new_script')
ON CONFLICT (key) DO NOTHING;
-- 23. Ads request
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'ads_request', 23, 'Ads request', 'Marketing/ADs Request 🃏', 'b796a968-347d-43b8-b187-c658b955587e'::uuid, 'ads',
  '[{"part":"main","name_suffix":"","list_id":"901816723196","team":"ads","template_id":null,"template_name":null,"owner_rule":"media_buyer_of_record","owner_clickup_id":null,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"details","label":"What is needed?","kind":"details","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  '["Read the request and open the client''s ad account and campaign card.","Ask the requester for anything missing (campaign, goal, deadline) in the task.","Make the change in the ads manager, or say in the task why not.","Log the change in the media buyer cockpit so it reaches the campaign card and the CSM card.","Tell the requester and mark the task complete."]'::jsonb, 'draft', NULL, 2, 'normal', true, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'ads_request')
ON CONFLICT (key) DO NOTHING;
-- 24. Edit an existing campaign
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'edit_campaign', 24, 'Edit an existing campaign', 'Edit Existing Campaign Request 🎱', '75095c91-9cc0-4505-ae96-e6317bbeade1'::uuid, 'ads',
  '[{"part":"main","name_suffix":"","list_id":"901816723196","team":"ads","template_id":null,"template_name":null,"owner_rule":"media_buyer_of_record","owner_clickup_id":null,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"details","label":"What is needed?","kind":"details","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  '["Confirm the campaign, the change (budget, audience, creative or form) and the reason with the requester.","Check the change against the client''s do''s and don''ts and the KPI gates ($15 per lead, $60 per booking).","Make the edit in the ads manager and read it back.","Log it in the media buyer cockpit so the campaign card and the CSM card show it.","Recheck the results after 3 days and note them in the task.","Tell the requester and mark the task complete."]'::jsonb, 'draft', NULL, 2, 'normal', true, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'edit_campaign')
ON CONFLICT (key) DO NOTHING;
-- 25. Low show rate
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'low_show_rate', 25, 'Low show rate', 'Low Show Rate📉', 'd85246c8-7dcc-4294-b981-d1fe8b1221a6'::uuid, 'call_center',
  '[{"part":"main","name_suffix":"","list_id":"901816723206","team":"call_center","template_id":"t-86exj3ddv","template_name":"Low Show Rate📉","owner_rule":"csm_of_card","owner_clickup_id":113688800,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"additional_notes","label":"Notes","kind":"text","clickup_field_id":"6742edfb-9b6f-4615-933d-7ebd74f9542b","required":false,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  NULL, 'none', 'https://docs.google.com/document/d/1slpC2QdEATMIQovM3g15hh-WEmeGpJubNFKujUt4LBI/edit', 3, 'normal', false, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'low_show_rate')
ON CONFLICT (key) DO NOTHING;
-- 26. Low schedule rate
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'low_schedule_rate', 26, 'Low schedule rate', 'Low Schedule Rate📉', '36ea1d39-4115-4a46-9f18-34664e7adac3'::uuid, 'call_center',
  '[{"part":"call_center","name_suffix":" (Call Center)","list_id":"901816723206","team":"call_center","template_id":"t-86exj3d37","template_name":"Low Schedule Rate📉 (Call Center)","owner_rule":"csm_of_card","owner_clickup_id":113688800,"when":{"field_key":"schedule_rate_issue","options":["cf9d1709-8d52-489b-9600-21e6a0d6ac12","0014e47b-560a-4109-830c-77d6d60d985c"]}},{"part":"ads","name_suffix":" (Ads)","list_id":"901816723196","team":"ads","template_id":"t-86exj3cvt","template_name":"Low Schedule Rate📉 (Ads)","owner_rule":"media_buyer_of_record","owner_clickup_id":null,"when":{"field_key":"schedule_rate_issue","options":["a2343b36-5d92-428d-9f73-ce47711480c2","0014e47b-560a-4109-830c-77d6d60d985c"]}}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"schedule_rate_issue","label":"Where is the problem?","kind":"select","clickup_field_id":"e58f563a-63c7-4f3a-b5cd-07cbb4a420d4","required":true,"options":null,"help":null},{"key":"additional_notes","label":"Notes","kind":"text","clickup_field_id":"6742edfb-9b6f-4615-933d-7ebd74f9542b","required":false,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  NULL, 'none', 'https://docs.google.com/document/d/15RCQBTfIKpJCLxDbH4ojzb-0t3lFs0uJHcXz3xRKndo/edit', 3, 'normal', false, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'low_schedule_rate')
ON CONFLICT (key) DO NOTHING;
-- 27. General tech request
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'general_tech', 27, 'General tech request', 'General Tech Request', '71c628d0-ee1f-4dc6-90ce-b4da84b7b367'::uuid, 'tech',
  '[{"part":"main","name_suffix":"","list_id":"901816723190","team":"tech","template_id":null,"template_name":null,"owner_rule":"systems_manager","owner_clickup_id":113459516,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":false,"options":null,"help":null},{"key":"details","label":"What is needed?","kind":"details","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":true,"options":null,"help":null}]'::jsonb,
  '["Read the request; ask the requester the same day for anything missing (client, link, deadline).","Move the task to in progress and write the plan in a comment.","Make the change and test it end to end.","Write what changed and where in the task.","Tell the requester and mark the task complete."]'::jsonb, 'draft', NULL, 2, 'normal', false, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'general_tech')
ON CONFLICT (key) DO NOTHING;
-- 28. General marketing request
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'general_marketing', 28, 'General marketing request', 'General Marketing Request', 'd52bde7c-13b5-4b1f-a34e-042478f883a6'::uuid, 'ads',
  '[{"part":"main","name_suffix":"","list_id":"901816723196","team":"ads","template_id":null,"template_name":null,"owner_rule":"media_buyer_of_record","owner_clickup_id":null,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":false,"options":null,"help":null},{"key":"details","label":"What is needed?","kind":"details","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":true,"options":null,"help":null}]'::jsonb,
  '["Read the request and ask the requester for anything missing in the task.","Agree the next step and the due date in a comment.","Do the work, or hand it to the right team with a reason.","Log any ads change in the media buyer cockpit.","Tell the requester and mark the task complete."]'::jsonb, 'draft', NULL, 2, 'normal', false, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'general_marketing')
ON CONFLICT (key) DO NOTHING;
-- 29. General CSM ticket
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'general_csm', 29, 'General CSM ticket', 'General CSM Ticket', '5db37a3e-f3cd-4513-8e38-750fecfa34c6'::uuid, 'client_success',
  '[{"part":"main","name_suffix":"","list_id":"901816723211","team":"client_success","template_id":null,"template_name":null,"owner_rule":"csm_of_card","owner_clickup_id":113688800,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":false,"options":null,"help":null},{"key":"details","label":"What is needed?","kind":"details","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":true,"options":null,"help":null}]'::jsonb,
  '["Read the request and open the client''s card if one is named.","Ask the requester for anything missing the same day.","Do the work, or book the client call it needs.","Log the outcome on the client card.","Tell the requester and mark the task complete."]'::jsonb, 'draft', NULL, 2, 'normal', false, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'general_csm')
ON CONFLICT (key) DO NOTHING;
-- 30. Social media management
INSERT INTO public.cockpit_request_types (key, type_index, label, clickup_option_name, request_type_option_id, team,
  targets, fields, sop_steps, sop_steps_state, sop_url, due_days, priority, set_request_type, enabled, version, updated_by)
SELECT 'social_media', 30, 'Social media management', 'Social Media Management Request', '108eef9b-55f7-45c5-9af0-0c9462925902'::uuid, 'creative',
  '[{"part":"main","name_suffix":"","list_id":"901818016338","team":"creative","template_id":null,"template_name":null,"owner_rule":"creative_strategist","owner_clickup_id":113520400,"when":null}]'::jsonb,
  '[{"key":"client","label":"Client","kind":"client","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"details","label":"Details","kind":"details","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"deadline","label":"Due","kind":"deadline","clickup_field_id":null,"required":true,"options":null,"help":null},{"key":"priority","label":"Priority","kind":"priority","clickup_field_id":null,"required":false,"options":null,"help":null}]'::jsonb,
  '["Confirm the client is Active and the upsell is on the client card.","Check the client''s GoHighLevel Social Planner has Instagram and Facebook connected as business accounts; test one private draft.","Collect the brand guide, logo and at least 5 real photos from the client''s Drive; ask the CSM for anything missing.","Pick the pillar mix and cadence from the SOP''s table.","Build the content bank: 10 to 15 real audience questions for the niche.","Write the month''s plan (topic and slide count per post) and approve it before any image.","Generate the approved posts in Higgsfield with the client''s colours and real photos, and self-check each set.","Have a second person review before the client sees anything.","Push the batch to Social Planner''s review queue with the client as approver and send the approval link.","Watch the queue and carry rejected reasons into next month''s content bank."]'::jsonb, 'draft', 'https://docs.google.com/document/d/1eSsQiHj3b6QM3tqY7tmXHA-ryYdDjO_Ee2P2FYehjRM/edit', 10, 'normal', false, true, 1, 'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_request_types x WHERE x.key = 'social_media')
ON CONFLICT (key) DO NOTHING;

-- 4. Version 1 of each, the whole row as seeded.
INSERT INTO public.cockpit_request_type_versions (key, version, "row", saved_by, note)
SELECT t.key, 1, to_jsonb(t), 'migration', 'Seeded 2026-10-26 from docs/requests/request-types.json'
  FROM public.cockpit_request_types t
 WHERE t.version = 1 AND t.updated_by = 'migration'
   AND t.key IN ('connect_lead_form', 'create_ad_account', 'missing_leads', 'employee_onboarding', 'employee_offboarding', 'privacy_policy', 'ad_spend_invoice', 'whatsapp_connection', 'whatsapp_reactivation', 'qualification_questions', 'client_offboarding', 'dfy_to_dwy', 'dwy_to_dfy', 'client_pause', 'client_relaunch', 'company_name', 'company_address', 'funnel_intent', 'landing_page', 'csm_request', 'business_licence', 'card_missing', 'new_script', 'ads_request', 'edit_campaign', 'low_show_rate', 'low_schedule_rate', 'general_tech', 'general_marketing', 'general_csm', 'social_media')
ON CONFLICT (key, version) DO NOTHING;

NOTIFY pgrst, 'reload schema';
COMMIT;
