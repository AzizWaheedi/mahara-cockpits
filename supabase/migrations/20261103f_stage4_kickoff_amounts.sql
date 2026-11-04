-- The kickoff's daily budget as an amount and a currency, and its close rate as a number (item 5, forms half;
-- the CEO, 2026-11-02: "Yes and sync it in the ass as well", read as "the ads"; plan build B5, design
-- budget-ads.md 5.2 and 5.3 S2 and S3; docs/forms/WAVE56-CONTRACT.md 4.21). Creative Triage
-- (bldgtotkfmhoxmlzowdx). Applies twice. Stands on 20261103b (the question list), 20261102o (the answers
-- check), 20261102j (the send), 20261102p (card_facts), 20261025o (the Blueprint's sources) and 20261016111157
-- (cockpit_board_usd_rate), each read live on 2026-11-03 (Kuwait) and equal to its file.
--
-- 1. The kickoff's questions (cockpit_form_stage4_fields('kickoff')): dailyBudget (cf53482c) takes type amount,
--    {amount, currency}, in USD, SAR, KWD, AED, QAR or BHD, above 0 and at most 100,000 with 2 decimals at most;
--    coldCloseRate (079812c4) takes type percent, a whole number from 0 to 100. Every other byte is 20261103b's
--    (the onboarding's list with its fifth Meta choice included). Kickoff version 2 changes in place, as
--    20261102o changed it: only while no kickoff was sent in the cockpit outside the CEO's canary on the test
--    card (86eywg1cq) and forms.stage4.kickoff is off (read 2026-11-03: 0 sent, off). Otherwise the file stops
--    and the two questions go into a kickoff version 3. The version row in cockpit_form_versions stays the
--    staff marker 20261102o left it (the send checks answers against this list, never against that row).
-- 2. cockpit_kickoff_answers_check: an amount needs a number and a currency of the list ('range' for 0, past
--    100,000 or 3 decimals; 'option' for another currency; 'format' for a plain string or another shape); it is
--    written as Make prints a typed answer, '<amount> <CUR>' ('40 USD', '37.5 SAR'), with dailyBudgetParts
--    {amount, currency} beside it: an internal key no field names, no text prints and the sheet cannot send.
--    A percent is written 'N%' ('20%'); 12.5 and 101 are 'range'. Make's handoff lines 71 and 102 then print
--    "*Daily ad budget:* 150 SAR" and "*Current cold-lead close rate:* 20%", texts a CSM could have typed into
--    tG7dnxBn: the handoff's shape is byte for byte, and a Typeform kickoff (the parity harness) never passes
--    through the new types (cockpit_form_stage4_native_answers and _typeform_answers keep its text as it came).
-- 3. cockpit_kickoff_submit: the read model forms.kickoff gains two side keys, as payment and recording sit:
--    budget {amount, currency, usd, rate, said}, usd = amount at the cockpit's fixed rate to the cent, NULL with no
--    rate (BHD today) or when it rounds below a cent (0.01 QAR), never 0; and close_rate, the number. Each only
--    when answered. Everything else is 20261102j's.
-- 4. cockpit_kickoff_budget(task): the card's kickoff budget {amount, currency, usd, rate, said, from_text}, or
--    NULL: the native side key (converted now, so a rate added later reaches it), else the answer's text
--    (cockpit_kickoff_budget_read): the kickoff's own '<amount> <CUR>' (from_text false), else a typed figure read
--    as dollars by blueprintPrefill.parseBudget's rule (from_text true): the first number, from 1 to 100,000,
--    unless the text names another currency or a range. The launch desk's chain (20261103e,
--    cockpit_launch_kickoff_budget) reads it when it exists.
-- 5. cockpit_form_stage4_card_facts (kickoff): Daily Budget 539743c2 in USD (the field's own currency), kind
--    currency, the converted figure as a JSON number, onlyIfEmpty, source kickoff or kickoff_text, planned only
--    from 1 to 100,000 dollars; with no rate, out of range or no readable figure, a line says why and nothing is
--    planned. clickup-writeback (build B1) writes it only while the card's field is empty: the sale's figure is
--    never overwritten. Every other field is 20261102p's.
-- 6. cockpit_blueprint_sources: kit gains budgetUsd and budgetCurrency (from cockpit_kickoff_budget), beside the
--    card's Daily Budget. The gate and every other key are 20261025o's.
--
-- Nothing here writes a row, ClickUp, Meta or GHL, and no rate is added (BHD and OMR wait for the CEO). Every
-- function made here is the owner's only; the send and the Blueprint's sources keep their live grants.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. What this file stands on, the drift guard, and the window for version 2 in place.

DO $$
BEGIN
  IF to_regprocedure('public.cockpit_board_usd_rate(text)') IS NULL
     OR to_regprocedure('public.cockpit_form_stage4_on(text)') IS NULL
     OR to_regprocedure('public.cockpit_form_stage4_read_model(text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261016111157 and 20261102j before 20261103f.' USING ERRCODE = '55000';
  END IF;
END $$;

-- Each replaced body is its live one (read 2026-11-03; 20261103b's question list) or this file's own (a second
-- apply). md5 of the body with every run of white space made one space, as 20261102p reads them.
DO $$
DECLARE g record; v_now text;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('public.cockpit_form_stage4_fields(text)', 'eadfda57d24997ad958ec6c68a1f5703', '922d1d6f9b4b9f6a8c74ed131f888bb4'),
      ('public.cockpit_kickoff_answers_check(jsonb)', '8c3045bcdcf0906294d78d9ca7377a9b', '7f7c5ad2038431f1e3e2460d593c666a'),
      ('public.cockpit_kickoff_submit(text,jsonb,uuid)', 'bc569e54e47b14ecf4c99d714fdb3e92', '1760ef776ce5e9497b3cff8ba1a79e14'),
      ('public.cockpit_form_stage4_card_facts(text,text,jsonb,timestamptz)', '71dbdcbec818527002f08cdff97f36fa', '9535abd07330ccdc2ac3dd90da3147d2'),
      ('public.cockpit_blueprint_sources(text)', '91de3df5b9c21c0f45472bc9dc1dd615', 'dfba8692570efc6e1d96cb31a9f4c09f')
    ) AS x(fn, live_md5, after_md5)
  LOOP
    v_now := NULL;
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_now
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(g.fn);
    IF v_now IS NULL OR v_now NOT IN (g.live_md5, g.after_md5) THEN
      RAISE EXCEPTION '% changed since it was read for 20261103f; stop and re-read it.', replace(g.fn, 'public.', '')
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

-- Version 2 changes in place only before the kickoff is live in the cockpit (1 above): no kickoff stored from
-- the cockpit (any source but Typeform's two) outside the CEO's canary on the test card, and the switch off.
-- A second apply (the list already this file's) changes nothing, so it is not stopped.
DO $$
DECLARE v_now text; v_sent bigint; v_on boolean;
BEGIN
  SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_now
    FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.cockpit_form_stage4_fields(text)');
  IF v_now = 'eadfda57d24997ad958ec6c68a1f5703' THEN
    SELECT count(*) INTO v_sent FROM public.cockpit_form_responses r
     WHERE r.form_key = 'kickoff' AND coalesce(r.source, '') NOT IN ('typeform_webhook', 'typeform_sync')
       AND NOT coalesce(r.task_id = '86eywg1cq' AND r.answer_meta->'canary' = 'true'::jsonb, false);
    v_on := public.cockpit_form_stage4_on('kickoff');
    IF v_sent > 0 OR v_on THEN
      RAISE EXCEPTION 'The kickoff is live in the cockpit (% sent there outside the test card%), so its questions cannot change in place: stop, and ask the amount and the close rate in a kickoff version 3.',
        v_sent, CASE WHEN v_on THEN ', and its switch is on' ELSE '' END
        USING ERRCODE = '55000';
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The kickoff's questions (1 above): 20261103b's list, byte for byte, but dailyBudget (amount) and
--    coldCloseRate (percent).

CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_fields(p_form_key text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_form_key = 'kickoff' THEN
    RETURN '[{"key":"detailsCorrect","typeformRef":"c0000001-0000-4000-8000-000000000001","title":"Is all of the above still correct?","type":"choice","options":["Yes","No"]},{"key":"detailsFix","typeformRef":"c0000001-0000-4000-8000-000000000002","title":"Anything to add?","type":"longtext"},{"key":"detailsCorrection","typeformRef":"c0000001-0000-4000-8000-000000000012","title":"What is wrong? Give the correct details.","type":"longtext"},{"key":"linksCorrect","typeformRef":"c0000001-0000-4000-8000-000000000003","title":"Is all of the above still correct?","type":"choice","options":["Yes","No"]},{"key":"linksFix","typeformRef":"c0000001-0000-4000-8000-000000000004","title":"Anything to add?","type":"longtext"},{"key":"linksCorrection","typeformRef":"c0000001-0000-4000-8000-000000000013","title":"Which link is wrong, and what is the correct one?","type":"longtext"},{"key":"operationsCorrect","typeformRef":"c0000001-0000-4000-8000-000000000005","title":"Is all of the above still correct?","type":"choice","options":["Yes","No"]},{"key":"operationsFix","typeformRef":"c0000001-0000-4000-8000-000000000006","title":"Anything to add?","type":"longtext"},{"key":"operationsCorrection","typeformRef":"c0000001-0000-4000-8000-000000000014","title":"What has changed? Give the correct details.","type":"longtext"},{"key":"serviceAdvertised","typeformRef":"c0000001-0000-4000-8000-000000000007","title":"Which service are we advertising?","type":"multi","options":["Design and build","Interior design","Architectural design","Fit out and renovation","Construction only","Other"]},{"key":"consultationTypes","typeformRef":"c0000001-0000-4000-8000-000000000008","title":"Which consultation types do they offer?","type":"multi","options":["In-office","In-home or onsite","Online"]},{"key":"profileComplete","typeformRef":"c0000001-0000-4000-8000-000000000009","title":"Is the profile complete?","type":"choice","options":["Yes","No"]},{"key":"profileFix","typeformRef":"c0000001-0000-4000-8000-000000000011","title":"Anything to add?","type":"longtext"},{"key":"profileMissing","typeformRef":"c0000001-0000-4000-8000-000000000015","title":"What is missing?","type":"longtext"},{"key":"contractStatus","typeformRef":"c0000001-0000-4000-8000-00000000000a","title":"Contract status","type":"choice","options":["Signed","Sent and waiting on client","Adjustments requested by client","Not sent yet","NA - already signed"]},{"key":"contractChanges","typeformRef":"c0000001-0000-4000-8000-00000000000b","title":"What needs changing in the contract?","type":"longtext"},{"key":"inWhatsappGroup","typeformRef":"3db082bb-1939-444b-8b32-d0067fc9878c","title":"Have you been added to the WhatsApp group?","type":"choice","options":["Yes","No"]},{"key":"whatsappAdd","typeformRef":"071c480f-17f9-48db-8155-56030f952e85","title":"Who else should we add to the WhatsApp group?","type":"longtext"},{"key":"driveDiscussed","typeformRef":"87c68a44-b19b-4a86-a286-0a2c8c32134e","title":"Have drive folders and filling out spreadsheets been discussed? (Intro message Whatsapp group)","type":"choice","options":["Yes","No"]},{"key":"whatsappStatus","typeformRef":"92fab954-d771-431c-9fc4-b9f15c53cbb8","title":"WhatsApp Status","type":"choice","options":["Access confirmed.","Pending.","Invited.","Waiting on client."]},{"key":"adPlatforms","typeformRef":"7d16afbb-b99a-4ee9-8718-4418cbeba534","title":"Which platforms will we advertise on?","type":"text"},{"key":"dailyBudget","typeformRef":"cf53482c-3d7d-45ab-b294-0230e917ea5f","title":"What is your daily budget for the ads?","type":"amount","currencies":["USD","SAR","KWD","AED","QAR","BHD"],"max":100000,"decimals":2},{"key":"adAccountName","typeformRef":"e4b9dbd3-c12c-4d6f-a0e3-c3ba17c97728","title":"What is the name of the ad account? (has to be exact)","type":"text"},{"key":"facebookPageName","typeformRef":"940f494c-f99b-4920-b203-200576ddd780","title":"What is the name of the Facebook page? (has to be exact)","type":"text"},{"key":"cardLinked","typeformRef":"8bee68fc-0764-41a8-b90a-db2a3f401e9d","title":"Correct Card Linked To The Account With Funds?","type":"choice","options":["Yes","No"]},{"key":"facebookAccess","typeformRef":"6fcbd33c-60e9-4df7-bfaa-e76b588dd887","title":"Facebook Access Status?","type":"choice","options":["Requested","Waiting on Client","Access Confirmed","Pending","Using Ours","Need Tech Help","Their Page Our Ad Acc"]},{"key":"whatsappSynced","typeformRef":"a813378f-06ce-499e-8f0e-14761b89b474","title":"Whatsapp synced to Mahara OS?","type":"choice","options":["Requested","Waiting on Client","Integrated","Needs Integrating","Pending","Not Integrating"]},{"key":"bookingConnects","typeformRef":"03b0600d-04d2-40a0-a7de-75a488888eb7","title":"Does the booking platform connect to ours?","type":"choice","options":["Yes","No"]},{"key":"calendarComplete","typeformRef":"3bebf47d-c00b-4f26-8624-933b84e42ebc","title":"Google Calendar Integration Complete?","type":"choice","options":["Yes","No"]},{"key":"calendarStatus","typeformRef":"b657c5a5-d199-42b5-8437-c8d04f78e376","title":"Booking platform & Google Calendar Integration Status","type":"choice","options":["Requested","Waiting on Client","Integrated","Needs Integrating","Pending","Not Integrating","Google Synched - Not Integrated"]},{"key":"maharaOsAccess","typeformRef":"ad562fc2-6858-4e37-81c5-c4cc2375a330","title":"Mahara OS Access Status","type":"choice","options":["Logged In","Tech Issue","Didn''t Receive Access","Doesn''t Want To"]},{"key":"contentLinks","typeformRef":"3418ef58-72df-49aa-aac3-1e095e155d45","title":"Provide any marketing content links or notes.","type":"longtext"},{"key":"contentDiscussed","typeformRef":"753c4cde-4d28-4719-8459-06e4db640180","title":"Content Discussed","type":"choice","options":["Yes","No"]},{"key":"templatedAdsDiscussed","typeformRef":"f54986bc-e120-4345-afee-31c1000a5a9a","title":"Templated Ads Discussed","type":"choice","options":["Yes","No"]},{"key":"templatedAdsStatus","typeformRef":"eb7ed18c-8388-4d84-9b5c-2e3d4a030287","title":"Templated Ads Status","type":"choice","options":["Approved","Declined","Waiting On Client","Wants To See Them First"]},{"key":"hasLeads","typeformRef":"dff79b66-89dd-43ef-9664-3fa4e6a61d69","title":"Do you have pre-existing leads?","type":"choice","options":["Yes","No"]},{"key":"reachLeads","typeformRef":"85d7ebb5-ce36-4ac3-aff8-3ce464737abd","title":"Do you want us to reach out to those leads?","type":"choice","options":["Yes","No"]},{"key":"leadsLinks","typeformRef":"86a6cce0-9111-4d98-97e7-7af5b6d518c8","title":"Provide link or notes for those leads.","type":"longtext"},{"key":"coldLeadsExperience","typeformRef":"0cb88b75-f193-43a1-b802-d382178a0946","title":"Do you have experience selling to cold leads (leads from ads)?","type":"choice","options":["Yes","No"]},{"key":"coldCloseRate","typeformRef":"079812c4-bb7e-4cc3-8e57-24c3b9e886d9","title":"What is your current close rate on cold leads?","type":"percent","min":0,"max":100},{"key":"academyConfirmed","typeformRef":"4379c2f7-c5cf-4104-92c5-9b2294d65b59","title":"Premium Projects Academy Confirmed?","type":"choice","options":["Yes","No"]},{"key":"firstStepsDiscussed","typeformRef":"dc6eafd2-516e-4ca9-9d9c-89dee060e224","title":"Discussed First Steps and Important Videos?","type":"choice","options":["Yes","No"]},{"key":"trainingAccess","typeformRef":"c56a7e2d-6f18-4bf9-a9f6-11367eab4c11","title":"Training Course Access","type":"choice","options":["Confirmed","Requested","Need Tech Help","Waiting On Client"]},{"key":"paymentAmount","typeformRef":"75e97e7d-4c19-437a-b4b8-67570c29344f","title":"Payment Amount","type":"number"},{"key":"postCallFormFilled","typeformRef":"34310b2e-4df4-4ed5-b67e-9aefa9087d6e","title":"Post call form filled?","type":"choice","options":["Yes","No"]},{"key":"callRecording","typeformRef":"b5578678-d0c2-475b-b66f-7ea54d55fe31","title":"Call Recording Link","type":"url"}]'::jsonb;
  ELSIF p_form_key = 'onboarding' THEN
    RETURN '[{"key":"fullName","typeformRef":"533f14a0-712f-4de9-9ac7-67e1be6bc0c8","title":"Full Name","type":"text"},{"key":"phone","typeformRef":"64f2fb80-b074-4017-b8b7-b7d549947e52","title":"Phone","type":"text"},{"key":"email","typeformRef":"7994f0d2-baeb-451b-983a-816290873a68","title":"Email","type":"text"},{"key":"businessName","typeformRef":"514bfd3f-4ca1-469e-b9e7-87656503f65c","title":"Business Name","type":"text"},{"key":"address","typeformRef":"e5caee43-e9b5-427d-8583-6982c5dd9be8","title":"Please enter your business address.","type":"longtext"},{"key":"mapsLink","typeformRef":"f7f9f2eb-1761-4c28-83ed-a53621c2cf88","title":"Paste a Google Maps link to your location (optional).","type":"text"},{"key":"website","typeformRef":"454a425f-2ac6-4d94-92db-cec08618600e","title":"Website URL","type":"text"},{"key":"instagram","typeformRef":"adecfe45-5d55-4319-98ff-3761e04bfc9b","title":"Instagram URL","type":"text"},{"key":"facebook","typeformRef":"575d17ed-e26d-4e55-87d3-7cb31cb71939","title":"Facebook Page URL","type":"text"},{"key":"paymentOptions","typeformRef":"ee25f923-d5e1-4d1a-a95f-cd9c17abbe83","title":"What payment options do you currently offer to your clients (e.g., full payment, installment plans, minimum down payment, in-house financing, third-party financing)?","type":"longtext"},{"key":"frontDeskPhone","typeformRef":"282dac48-5031-4acb-96b6-ea469e8a5a8b","title":"Front Desk Phone","type":"text"},{"key":"personalPhone","typeformRef":"09d2e62a-51d4-4665-a3a9-30f5279b71bc","title":"Personal Phone Number","type":"text"},{"key":"yearsInBusiness","typeformRef":"ed1ba2fe-2827-4eea-a678-62205f1ce9f5","title":"How long have you been in business?","type":"text"},{"key":"bookingSoftware","typeformRef":"7a120dbb-0169-4bcc-9193-5c525a470d02","title":"Current booking software","type":"text"},{"key":"facebookAds","typeformRef":"ddf2767d-5725-4df2-b200-f0aab77a2db5","title":"Do you have a facebook business manager or have you ever ran ads on meta (Facebook & Instagram) in the past?","type":"choice","options":[{"value":"yes","typeform":"Yes"},{"value":"unsure","typeform":"IM UNSURE | لست متأكدًا"},{"value":"ran_before","typeform":"I''ve ran ads before but dont know how to access my Account |شغّلت إعلانات من قبل لكنني لا أعرف كيف أصل إلى حسابي"},{"value":"never_ran","typeform":"I Have a Business Account but have never ran ads | لديّ حساب أعمال على فيسبوك لكنني لم أقم بتشغيل إعلانات من قبل"},{"value":"restricted","typeform":"My Account is restricted | حسابي مقيّد"}]},{"key":"projectsDone","typeformRef":"0a6b5704-c46d-480c-a592-b59108683596","title":"How many projects has your company completed to date?","type":"text"},{"key":"hours","typeformRef":"b7873d40-d154-42ac-bf24-cb3b667e84cc","title":"Business hours - When are you open to schedule?","type":"longtext"},{"key":"services","typeformRef":"d976036f-6c2e-4d5d-999a-64cf9bb2ef02","title":"1) What services do you offer list all of them? Also I want to know which ones have the HIGHEST price point and Highest Profit 2) What is the PRICE of the services?","type":"longtext"},{"key":"serviceFocus","typeformRef":"6271b610-6946-4056-bb08-d03ffc274141","title":"Out of those what is the #1 service/type of project you want to focus on scaling?","type":"longtext"},{"key":"faqs","typeformRef":"f2b7bc2b-2a79-4640-9e21-377e7aa39d45","title":"What are your top five most frequently asked questions and their answers? (Feel free to add more — the more detailed, the better.)","type":"longtext"},{"key":"idealProject","typeformRef":"6c819933-3eb9-4db8-bd59-d39be11cb7f0","title":"Please describe your ideal project in detail.","type":"longtext"},{"key":"serviceAreas","typeformRef":"fa017616-3fb5-4e64-9fbd-39cea6e26c47","title":"What service areas do you cover? Please list all cities and neighborhoods you serve so we can target your ads precisely.","type":"longtext"},{"key":"appointmentTypes","typeformRef":"b370341c-6ea3-43c9-bd8c-16e278a2d2d5","title":"What types of appointments do you offer? (Select all that apply)","type":"multi","options":[{"value":"online","typeform":"عن بُعد (أونلاين) | Online"},{"value":"onsite","typeform":"في موقع العميل / في المنزل | Onsite / In-home"},{"value":"office","typeform":"في مقرّكم / مكتبكم | In your office"}]},{"key":"maxDistance","typeformRef":"35ea63c3-090a-425d-b75c-e3d183d48cd1","title":"What''s the maximum distance you would travel from your office to do an in-home consultation?","type":"text"},{"key":"landmark","typeformRef":"b7c403ea-8d66-4814-80cf-7e8d7fdb8d11","title":"Local Landmark Information (Please type this in the format shown) - Located next to the Burger King down King Saud street on the left hand side.","type":"longtext"},{"key":"appointmentLength","typeformRef":"a20cfc1a-0228-413d-80ab-d97fc97574e0","title":"Appointment length + details + buffer","type":"longtext"},{"key":"consultants","typeformRef":"0a80a0a8-3a09-4907-a1d1-6c57e57d4c47","title":"Who are the engineers in your business that will be giving these consultations?","type":"longtext"},{"key":"whyJoined","typeformRef":"7426c6c5-344f-44c9-9999-3b9daf3a06b8","title":"What motivated you to join our program? What was the reason you signed up?","type":"longtext"},{"key":"freeConsults","typeformRef":"ec89854f-d006-402b-958a-91738e2b3e7a","title":"Do you offer free consultations?","type":"choice","options":[{"value":"yes","typeform":"Yes, we do offer free consultations / نعم، نقدم استشارات مجانية✅"},{"value":"open_to_it","typeform":"No, but we''re open to considering it / حاليا لا نقدمها، لكن يمكننا مناقشه🤝"},{"value":"no","typeform":"No, we do not offer free consultations / لا، لا نقدم استشارات مجانية❌"}]},{"key":"marketing","typeformRef":"bf8c7c7b-fff9-463f-b30a-8d8ca8b622f6","title":"What is your marketing process? In other words... please explain EVERYTHING A-Z that you have in place or have tried to generate new projects","type":"longtext"},{"key":"lastRevenue","typeformRef":"7ff5d37a-df7f-4002-8248-d0b4af6c28e8","title":"Last Calendar Year - How Much Total Revenue did you do?","type":"text"},{"key":"challenges","typeformRef":"fcf43e6a-cc84-4ae7-9cef-2336069d0280","title":"What are the TOP 3 challenges that - if we were able to help you with - would make you 100% satisfied with your investment? - Be specific.","type":"longtext"},{"key":"goal90","typeformRef":"791b99b8-c7e9-40a4-96d6-868399e1ae97","title":"What is your realistic goal revenue in 90 Days?","type":"text"},{"key":"goal12","typeformRef":"f4b96a9b-bd7c-4398-98b4-6a28a7d3595a","title":"What is your ideal/stretch revenue goal within the next 12-24 months?","type":"text"},{"key":"additionalInfo","typeformRef":"41d2d5bb-b023-4fa4-906c-72aeef7a5e46","title":"Any additional information we should know before starting?","type":"longtext"},{"key":"driveLink","typeformRef":"64d23c81-1784-4f07-8356-107af764fc95","title":"Please attach a Google Drive link to all the content you have for your office (See check list below)","type":"text"}]'::jsonb;
  END IF;
  RAISE EXCEPTION 'There is no Stage 4 field map for %.', coalesce(p_form_key, '(none)') USING ERRCODE = '22023';
END $$;

-- ---------------------------------------------------------------------------
-- 2. The daily budget's readers (internal: the owner's only)

-- The kickoff's daily budget from its parts, at the cockpit's fixed rate (cockpit_board_usd_rate: the five of
-- currency.ts USD_PER): {amount, currency, usd, rate, said}. usd is the amount in dollars to the cent, NULL with no
-- rate or when the dollars round below a cent (0.01 QAR), never 0; said is '<amount> <CUR>', as the answer prints.
-- NULL unless the amount is above 0 and at most 100,000 with 2 decimals at most, and the currency one of the six
-- the kickoff asks.
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_budget_of(p_amount numeric, p_currency text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN p_amount > 0 AND p_amount <= 100000 AND scale(trim_scale(p_amount)) <= 2
                   AND p_currency IN (SELECT jsonb_array_elements_text(f->'currencies')
                                        FROM jsonb_array_elements(public.cockpit_form_stage4_fields('kickoff')) f
                                       WHERE f->>'key' = 'dailyBudget') THEN
    jsonb_build_object(
      'amount', trim_scale(p_amount),
      'currency', p_currency,
      'usd', CASE WHEN round(p_amount * public.cockpit_board_usd_rate(p_currency), 2) > 0
                  THEN trim_scale(round(p_amount * public.cockpit_board_usd_rate(p_currency), 2)) END,
      'rate', public.cockpit_board_usd_rate(p_currency),
      'said', trim_scale(p_amount)::text || ' ' || p_currency) END
$$;

-- A kickoff's daily budget answer as text, read as {amount, currency, usd, rate, said, from_text}, or NULL:
--   1. the answer the kickoff writes, '<amount> <CUR>' (cockpit_kickoff_answers_check): its amount and currency,
--      from_text false;
--   2. else a typed answer (a Typeform kickoff) by apps/client-success-cockpit/src/present/blueprintPrefill.ts
--      parseBudget's rule: Arabic-Indic and Persian digits read as digits, a thousands comma dropped; no figure
--      when the text names another currency (KWD, KD, SAR, SR, AED, QAR, BHD, OMR, EUR, GBP or the Arabic words)
--      or a range; else the first number, in dollars, from 1 to 100,000, to the cent. from_text true, said as typed.
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_budget_read(p_text text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_said text := nullif(btrim(coalesce(p_text, ''), E' \t\n\r\f\x0b '), '');
  v_latin text;
  v_m text[];
  v_n numeric;
  b jsonb;
BEGIN
  IF v_said IS NULL THEN
    RETURN NULL;
  END IF;
  v_m := regexp_match(v_said, '^([0-9]{1,6}(\.[0-9]{1,2})?) ([A-Z]{3})$');
  IF v_m IS NOT NULL THEN
    b := public.cockpit_kickoff_budget_of(v_m[1]::numeric, v_m[3]);
    IF b IS NOT NULL THEN
      RETURN b || '{"from_text": false}'::jsonb;
    END IF;
  END IF;
  v_latin := translate(v_said, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  v_latin := regexp_replace(v_latin, '([0-9]),(?=[0-9]{3}\y)', '\1', 'g');
  IF v_latin ~* '\y(KWD|KD|SAR|SR|AED|QAR|BHD|OMR|EUR|GBP)\y|دينار|ريال|درهم|جنيه|يورو'
     OR v_latin ~* '[0-9]\s*(-|–|to|إلى|الى|لين|لـ|ل)\s*[0-9]|[٠-٩]\s*(-|–|إلى|الى|لين)\s*[٠-٩]' THEN
    RETURN NULL;
  END IF;
  v_n := (regexp_match(v_latin, '([0-9]+(?:\.[0-9]+)?)'))[1]::numeric;
  IF v_n IS NULL OR v_n < 1 OR v_n > 100000 THEN
    RETURN NULL;
  END IF;
  RETURN public.cockpit_kickoff_budget_of(round(v_n, 2), 'USD') || jsonb_build_object('said', v_said, 'from_text', true);
END $$;

-- The card's kickoff budget (4 above), the shape the launch desk's chain reads (20261103e,
-- cockpit_launch_kickoff_budget): {amount, currency, usd, rate, said, from_text}, or NULL. The native side key
-- forms.kickoff.budget first, converted now; else the kickoff's answer text (ref cf53482c), as
-- cockpit_kickoff_budget_read reads it. usd is NULL with no fixed rate or below a cent, never 0.
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_budget(p_task text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE k jsonb; b jsonb; v_text text;
BEGIN
  IF p_task IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT o.forms->'kickoff' INTO k FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_task;
  IF jsonb_typeof(k) IS DISTINCT FROM 'object' THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(k->'budget') = 'object' AND jsonb_typeof(k->'budget'->'amount') = 'number' THEN
    b := public.cockpit_kickoff_budget_of((k->'budget'->>'amount')::numeric, k->'budget'->>'currency');
    IF b IS NOT NULL THEN
      RETURN b || '{"from_text": false}'::jsonb;
    END IF;
  END IF;
  SELECT x->>'value' INTO v_text
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(k->'answers') = 'array' THEN k->'answers' ELSE '[]'::jsonb END) x
   WHERE x->>'ref' LIKE 'cf53482c%' LIMIT 1;
  RETURN public.cockpit_kickoff_budget_read(v_text);
END $$;

-- ---------------------------------------------------------------------------
-- 3. The kickoff's answers check (2 above): 20261102o's, with the amount and the percent.

CREATE OR REPLACE FUNCTION public.cockpit_kickoff_answers_check(p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_in jsonb := CASE WHEN jsonb_typeof(p_answers) = 'object' THEN p_answers - 'replaceReason' ELSE '{}'::jsonb END;
  v_specs jsonb := public.cockpit_form_stage4_fields('kickoff')
                   || '[{"key":"newMrrUsd","type":"number","required":true}]'::jsonb;
  s jsonb;
  k text;
  v jsonb;
  v_text text;
  v_errors jsonb := '{}'::jsonb;
  v_out jsonb := '{}'::jsonb;
  v_n numeric;
  v_max numeric;
  v_cur text;
BEGIN
  FOR k IN SELECT jsonb_object_keys(v_in) LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_specs) x WHERE x->>'key' = k) THEN
      v_errors := v_errors || jsonb_build_object(left(k, 40), 'unknown');
    END IF;
  END LOOP;
  FOR s IN SELECT x FROM jsonb_array_elements(v_specs) x LOOP
    k := s->>'key';
    v := v_in -> k;
    IF v = 'null'::jsonb THEN v := NULL; END IF;
    -- An amount with no figure is no answer: the sheet's currency always holds its default (20261103f).
    IF s->>'type' = 'amount' AND jsonb_typeof(v) = 'object'
       AND (v->'amount' IS NULL OR v->'amount' IN ('null'::jsonb, '""'::jsonb)) THEN
      v := NULL;
    END IF;
    IF jsonb_typeof(v) = 'string' THEN
      v_text := btrim(regexp_replace(v #>> '{}', '\s+', ' ', 'g'));
      -- A long text as Typeform keeps it for Make (20261102m): its line breaks and spaces as typed.
      IF s->>'type' = 'longtext' THEN v_text := public.cockpit_form_typeform_text(v #>> '{}'); END IF;
      IF v_text = '' THEN v := NULL; END IF;
    END IF;
    IF jsonb_typeof(v) = 'array' AND jsonb_array_length(v) = 0 THEN v := NULL; END IF;
    IF v IS NULL THEN
      IF coalesce((s->>'required')::boolean, false) THEN v_errors := v_errors || jsonb_build_object(k, 'required'); END IF;
      CONTINUE;
    END IF;
    CASE s->>'type'
      WHEN 'choice' THEN
        IF jsonb_typeof(v) <> 'string' OR NOT (s->'options') ? (v #>> '{}') THEN
          v_errors := v_errors || jsonb_build_object(k, 'option');
        ELSE
          v_out := v_out || jsonb_build_object(k, v);
        END IF;
      WHEN 'multi' THEN
        IF jsonb_typeof(v) <> 'array'
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(v) x WHERE jsonb_typeof(x) <> 'string' OR NOT (s->'options') ? (x #>> '{}'))
           OR (SELECT count(DISTINCT x) FROM jsonb_array_elements(v) x) <> jsonb_array_length(v) THEN
          v_errors := v_errors || jsonb_build_object(k, 'option');
        ELSE
          v_out := v_out || jsonb_build_object(k, v);
        END IF;
      WHEN 'number' THEN
        IF jsonb_typeof(v) <> 'number' THEN
          v_errors := v_errors || jsonb_build_object(k, 'range');
        ELSE
          v_n := (v #>> '{}')::numeric;
          v_max := CASE WHEN k = 'newMrrUsd' THEN 100000 ELSE 10000000 END;
          IF v_n < 0 OR v_n > v_max OR scale(v_n) > 2 THEN
            v_errors := v_errors || jsonb_build_object(k, 'range');
          ELSE
            v_out := v_out || jsonb_build_object(k, v_n);
          END IF;
        END IF;
      -- 20261103f. The daily budget: {amount, currency}, the amount a number above 0 and at most the
      -- question's max (100,000) with 2 decimals at most, else range; the currency one of the question's six,
      -- else option; a plain string, another shape or an amount that is no number, else format. Written as
      -- Make prints it, '<amount> <CUR>' (no thousands mark, no trailing zeros: '40 USD', '37.5 SAR'), with
      -- the parts beside it under <key>Parts, an internal key no field names and no text prints.
      WHEN 'amount' THEN
        IF jsonb_typeof(v) <> 'object'
           OR EXISTS (SELECT 1 FROM jsonb_object_keys(v) x WHERE x NOT IN ('amount', 'currency'))
           OR jsonb_typeof(v->'amount') <> 'number' THEN
          v_errors := v_errors || jsonb_build_object(k, 'format');
        ELSE
          v_n := (v->>'amount')::numeric;
          v_cur := CASE WHEN jsonb_typeof(v->'currency') = 'string' THEN v->>'currency' END;
          IF v_n <= 0 OR v_n > coalesce((s->>'max')::numeric, 100000)
             OR scale(trim_scale(v_n)) > coalesce((s->>'decimals')::integer, 2) THEN
            v_errors := v_errors || jsonb_build_object(k, 'range');
          ELSIF v_cur IS NULL OR NOT coalesce((s->'currencies') ? v_cur, false) THEN
            v_errors := v_errors || jsonb_build_object(k, 'option');
          ELSE
            v_out := v_out || jsonb_build_object(k, trim_scale(v_n)::text || ' ' || v_cur,
                                                 k || 'Parts', jsonb_build_object('amount', trim_scale(v_n), 'currency', v_cur));
          END IF;
        END IF;
      -- 20261103f. The cold-lead close rate: a whole number from the question's min to its max (0 to 100),
      -- else range; written as Make prints a typed one, 'N%'.
      WHEN 'percent' THEN
        IF jsonb_typeof(v) <> 'number' THEN
          v_errors := v_errors || jsonb_build_object(k, 'range');
        ELSE
          v_n := (v #>> '{}')::numeric;
          IF v_n < coalesce((s->>'min')::numeric, 0) OR v_n > coalesce((s->>'max')::numeric, 100) OR v_n <> trunc(v_n) THEN
            v_errors := v_errors || jsonb_build_object(k, 'range');
          ELSE
            v_out := v_out || jsonb_build_object(k, trim_scale(v_n)::text || '%');
          END IF;
        END IF;
      ELSE
        IF jsonb_typeof(v) <> 'string' THEN
          v_errors := v_errors || jsonb_build_object(k, 'length');
        ELSIF char_length(v_text) > (CASE s->>'type' WHEN 'longtext' THEN 4000 ELSE 500 END) THEN
          v_errors := v_errors || jsonb_build_object(k, 'length');
        ELSIF s->>'type' = 'url' AND v_text !~ '^https?://[^\s]+\.[^\s]+$' THEN
          v_errors := v_errors || jsonb_build_object(k, 'format');
        ELSE
          v_out := v_out || jsonb_build_object(k, v_text);
        END IF;
    END CASE;
  END LOOP;
  -- Answers past the 256 KB cockpit_form_responses keeps for a kickoff (15 above): one refusal by name,
  -- never the table's error on the send. Only when every answer passed, so a fix the CSM can make is
  -- never hidden behind it.
  IF v_errors = '{}'::jsonb AND octet_length(v_out::text) > 262144 THEN
    v_errors := jsonb_build_object('_answers', 'too_large');
  END IF;
  RETURN jsonb_build_object('ok', v_errors = '{}'::jsonb, 'errors', v_errors, 'answers', v_out);
END $$;

-- ---------------------------------------------------------------------------
-- 4. The kickoff's send (3 above): 20261102j's, with the read model's budget and close_rate.

CREATE OR REPLACE FUNCTION public.cockpit_kickoff_submit(p_task_id text, p_answers jsonb, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_kickoff_seat(p_task_id);
  v_canary boolean;
  v_check jsonb;
  v_reason text := nullif(btrim(regexp_replace(coalesce(p_answers->>'replaceReason', ''), '\s+', ' ', 'g')), '');
  v_prev_at timestamptz;
  v_second boolean := false;
  v_client text;
  v_role text;
  r public.cockpit_form_responses;
  v_ta jsonb;
  v_model text;
  v_plan jsonb;
  v_trail jsonb;
  v_budget jsonb;
  v_prev text := current_setting('cockpit.forms_action', true);
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Send the kickoff''s request id, so a second press saves nothing twice.' USING ERRCODE = '22023';
  END IF;
  v_canary := p_task_id = '86eywg1cq' AND coalesce((v_seat->>'ceo')::boolean, false);
  IF NOT public.cockpit_form_stage4_on('kickoff') AND NOT v_canary THEN
    RAISE EXCEPTION 'The kickoff opens here after its switch-on. Until then use the kickoff form as before.' USING ERRCODE = '22023';
  END IF;
  -- A retry of the same press.
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.form_key = 'kickoff' AND x.external_id = 'req:' || p_request_id::text;
  IF r.id IS NOT NULL THEN
    IF r.task_id IS DISTINCT FROM p_task_id THEN
      RAISE EXCEPTION 'This kickoff was already sent for another client. Reload the sheet.' USING ERRCODE = '22023';
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('step', x.effect_key, 'state', x.state, 'reason', x.reason) ORDER BY x.created_at, x.effect_key), '[]'::jsonb)
      INTO v_trail FROM public.cockpit_form_effects x WHERE x.response_id = r.id;
    RETURN jsonb_build_object('ok', true, 'responseId', r.id, 'reused', true, 'trail', v_trail);
  END IF;
  SELECT coalesce(nullif(btrim(a.client_name), ''), nullif(btrim(o.client_name), '')) INTO v_client
    FROM (SELECT 1) one
    LEFT JOIN public.cockpit_billing_accounts a ON a.clickup_task_id = p_task_id
    LEFT JOIN public.cockpit_client_onboarding o ON o.clickup_task_id = p_task_id;
  IF v_client IS NULL AND NOT v_canary THEN
    RAISE EXCEPTION 'This client is not in the cockpit yet, so the kickoff cannot be sent from here.' USING ERRCODE = '22023';
  END IF;
  v_client := coalesce(v_client, 'Test card');
  -- One kickoff per card, counting every stored kickoff (the 30 from tG7dnxBn and BbJy6xg4 included).
  v_prev_at := public.cockpit_form_stage4_kickoff_at(p_task_id, NULL);
  IF v_prev_at IS NOT NULL THEN
    IF v_reason IS NULL OR char_length(v_reason) NOT BETWEEN 3 AND 300 THEN
      RAISE EXCEPTION 'A kickoff was sent for % on %. Say why you are sending it again.', v_client,
        public.cockpit_form_day_words(v_prev_at) USING ERRCODE = '22023';
    END IF;
    v_second := true;
  END IF;
  v_check := public.cockpit_kickoff_answers_check(p_answers);
  IF NOT (v_check->>'ok')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid', 'errors', v_check->'errors');
  END IF;
  v_role := CASE WHEN coalesce((v_seat->>'ceo')::boolean, false) THEN 'the CEO'
                 ELSE coalesce(public.cockpit_slack_notice_role_of(v_seat->>'email'), 'the CSM') END;

  PERFORM set_config('cockpit.forms_action', 'forms.kickoff_sent', true);
  PERFORM set_config('cockpit.audit_source', 'cockpit-forms', true);
  INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state,
    answers, answer_meta, hidden, created_by, created_by_id, submitted_by, submitted_at)
  VALUES ('kickoff', 2, 'cockpit', 'req:' || p_request_id::text, p_task_id, v_client, 'live', 'submitted',
          v_check->'answers',
          jsonb_strip_nulls(jsonb_build_object('notice_on', public.cockpit_form_kuwait_day(now()), 'second', v_second,
            'replace_reason', CASE WHEN v_second THEN v_reason END, 'seat_role', v_role, 'canary', CASE WHEN v_canary THEN true END)),
          jsonb_build_object('onboarding_client_id', p_task_id),
          v_seat->>'email', (v_seat->>'actorId')::uuid, v_seat->>'email', now())
  RETURNING * INTO r;

  -- The read model (4.13.2), Typeform-shaped, so growth.js, Pending payments and the Blueprint
  -- prefill read it unchanged. Its new response id queues the Stage 1 kickoff notice.
  v_ta := public.cockpit_form_stage4_typeform_answers('kickoff', r.answers);
  -- The daily budget and the close rate as figures beside the answers (20261103f), as payment and recording
  -- sit: budget {amount, currency, usd, rate, said}, usd NULL with no fixed rate (never 0), and close_rate.
  -- Each only when it was answered; the Typeform-shaped answers keep the texts Make prints.
  IF jsonb_typeof(r.answers->'dailyBudgetParts') = 'object' AND jsonb_typeof(r.answers->'dailyBudgetParts'->'amount') = 'number' THEN
    v_budget := public.cockpit_kickoff_budget_of((r.answers->'dailyBudgetParts'->>'amount')::numeric,
                                                 r.answers->'dailyBudgetParts'->>'currency');
  END IF;
  v_model := public.cockpit_form_stage4_read_model(p_task_id, 'kickoff', jsonb_build_object(
    'form_id', 'native', 'response_id', r.id::text, 'answers', v_ta,
    'payment', (SELECT a->>'value' FROM jsonb_array_elements(v_ta) a WHERE a->>'ref' = '75e97e7d-4c19-437a-b4b8-67570c29344f' LIMIT 1),
    'recording', (SELECT a->>'value' FROM jsonb_array_elements(v_ta) a WHERE a->>'ref' = 'b5578678-d0c2-475b-b66f-7ea54d55fe31' LIMIT 1),
    'submitted_at', to_char(r.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
    || CASE WHEN v_budget IS NOT NULL THEN jsonb_build_object('budget', v_budget) ELSE '{}'::jsonb END
    || CASE WHEN r.answers->>'coldCloseRate' ~ '^[0-9]{1,3}%$'
            THEN jsonb_build_object('close_rate', rtrim(r.answers->>'coldCloseRate', '%')::numeric) ELSE '{}'::jsonb END);
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev, ''), true);
  v_plan := public.cockpit_form_stage4_plan(r.id, true);
  v_trail := jsonb_build_array(jsonb_build_object('step', 'stored', 'state', 'delivered'),
                               jsonb_build_object('step', 'read_model', 'state', CASE WHEN v_model = 'written' THEN 'delivered' ELSE 'skipped' END,
                                                  'reason', CASE WHEN v_model = 'no_row' THEN 'This client has no onboarding record in the cockpit yet.' END))
    || coalesce((SELECT jsonb_agg(jsonb_build_object('step', x->>'key', 'state', x->>'state', 'reason', x->>'reason'))
                   FROM jsonb_array_elements(v_plan->'effects') x), '[]'::jsonb);
  RETURN jsonb_build_object('ok', true, 'responseId', r.id, 'reused', false, 'second', v_second, 'trail', v_trail);
END $$;

-- ---------------------------------------------------------------------------
-- 5. card_facts (5 above): 20261102p's, with Daily Budget.

CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_card_facts(p_form_key text, p_task_id text, p_by_ref jsonb, p_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a jsonb := CASE WHEN jsonb_typeof(p_by_ref) = 'object' THEN p_by_ref ELSE '{}'::jsonb END;
  v_fields jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_skip text;
  v text;
  v_ids jsonb;
  v_names text;
  v_known boolean;
  v_count integer;
  v_id text;
  v_call jsonb;
  v_day text;
  v_budget jsonb;
  v_usd numeric;
BEGIN
  IF p_form_key = 'kickoff' THEN
    -- Consultation Types (labels): every ticked type the card has, in the order ticked; any other plans none.
    v := nullif(btrim(coalesce(a->>'c0000001-0000-4000-8000-000000000008', ''), E' \t\n\r\f\x0b'), '');
    IF v IS NOT NULL THEN
      SELECT coalesce(jsonb_agg(m.id ORDER BY t.n), '[]'::jsonb), string_agg(m.name, ', ' ORDER BY t.n),
             bool_and(m.id IS NOT NULL)
        INTO v_ids, v_names, v_known
        FROM (SELECT btrim(x) AS answer, min(n) AS n FROM unnest(string_to_array(v, ', ')) WITH ORDINALITY AS u(x, n) GROUP BY 1) t
        LEFT JOIN (VALUES
          ('In-office', '82279634-6601-4dd2-a1bc-af6737260b6b', 'In Office'),
          ('In-home or onsite', '387c686d-5652-4635-abe6-10621f8359b3', 'In Home / On Site'),
          ('Online', 'd9c0f5a6-6db5-4e97-8dd4-cc80247b96ae', 'Online')) AS m(answer, id, name) ON m.answer = t.answer;
      IF v_known THEN
        v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', '45fdd2ea-f83c-4721-bce7-2e6187a43541', 'kind', 'labels',
          'label', 'Consultation Types', 'optionIds', v_ids, 'onlyIfEmpty', true, 'source', 'kickoff'));
        v_lines := v_lines || to_jsonb('Consultation Types, if empty on the card: ' || v_names);
      ELSE
        v_lines := v_lines || to_jsonb('Consultation Types: not filled, the answer has a type the card does not have.'::text);
      END IF;
    END IF;
    -- ADs Platform (drop_down): only when the answer names exactly one platform the card has.
    v := nullif(btrim(coalesce(a->>'7d16afbb-b99a-4ee9-8718-4418cbeba534', ''), E' \t\n\r\f\x0b'), '');
    IF v IS NOT NULL THEN
      SELECT count(DISTINCT m.id), min(m.id), min(m.name) INTO v_count, v_id, v_names
        FROM (VALUES
          ('\mmeta|facebook|instagram', '88d55b4b-f296-4a0b-abc6-3b228889444a', 'Facebook/Meta'),
          ('tik ?tok', 'c115bdfe-661f-4855-a86b-69a54b2e616a', 'Tiktok'),
          ('snap', '97b22a7b-c18b-4be9-bd03-ff271bacfd77', 'Snapchat')) AS m(pattern, id, name)
       WHERE lower(v) ~ m.pattern;
      IF v_count = 1 THEN
        v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', '2de15aa5-7fe9-48bf-86a1-e4cfee1306c9', 'kind', 'drop_down',
          'label', 'ADs Platform', 'optionId', v_id, 'onlyIfEmpty', true, 'source', 'kickoff'));
        v_lines := v_lines || to_jsonb('ADs Platform, if empty on the card: ' || v_names);
      ELSIF v_count > 1 THEN
        v_lines := v_lines || to_jsonb('ADs Platform: not filled, the answer names more than one platform.'::text);
      ELSE
        v_lines := v_lines || to_jsonb('ADs Platform: not filled, the answer names no platform the card has.'::text);
      END IF;
    END IF;
    -- Fathom (url): the kickoff's recording when it is a Fathom link, else the stored onboarding call's.
    v := btrim(coalesce(a->>'b5578678-d0c2-475b-b66f-7ea54d55fe31', ''), E' \t\n\r\f\x0b');
    v_call := public.cockpit_form_stage4_onboarding_call(p_task_id, p_at);
    IF v ~* '^https://(www\.)?fathom\.video/[^\s]*$' THEN
      v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', 'abaa31ee-28ff-46f6-83bf-6c6d357a26d5', 'kind', 'url',
        'label', 'Fathom', 'value', v, 'onlyIfEmpty', true, 'source', 'kickoff'));
      v_lines := v_lines || to_jsonb('Fathom, if empty on the card: the kickoff''s call recording'::text);
    ELSIF v_call->>'recordingUrl' IS NOT NULL THEN
      v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', 'abaa31ee-28ff-46f6-83bf-6c6d357a26d5', 'kind', 'url',
        'label', 'Fathom', 'value', v_call->>'recordingUrl', 'onlyIfEmpty', true, 'source', 'call_store'));
      v_lines := v_lines || to_jsonb('Fathom, if empty on the card: the stored onboarding call''s recording'::text);
    END IF;
    -- Onboarding Call Date (date): the stored call's day, else the day the kickoff was sent (Kuwait).
    IF v_call->>'startsAt' IS NOT NULL THEN
      v_day := to_char(((v_call->>'startsAt')::timestamptz AT TIME ZONE 'Asia/Kuwait')::date, 'YYYY-MM-DD');
      v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', 'ee9bf855-e05b-4afc-addf-1063cb54d3f0', 'kind', 'date',
        'label', 'Onboarding Call Date', 'value', v_day, 'onlyIfEmpty', true, 'source', 'call_store'));
      v_lines := v_lines || to_jsonb('Onboarding Call Date, if empty on the card: ' || v_day || ' (the stored onboarding call)');
    ELSIF p_at IS NOT NULL THEN
      v_day := to_char((p_at AT TIME ZONE 'Asia/Kuwait')::date, 'YYYY-MM-DD');
      v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', 'ee9bf855-e05b-4afc-addf-1063cb54d3f0', 'kind', 'date',
        'label', 'Onboarding Call Date', 'value', v_day, 'onlyIfEmpty', true, 'source', 'kickoff_day'));
      v_lines := v_lines || to_jsonb('Onboarding Call Date, if empty on the card: ' || v_day || ' (the day the kickoff was sent)');
    END IF;
    -- Daily Budget (currency, USD: the field's own currency, never the ad account's), 20261103f: the daily
    -- budget at the cockpit's fixed rate (cockpit_kickoff_budget_read: the amount and currency the kickoff
    -- writes, source kickoff, else a typed figure read as dollars, source kickoff_text), only from 1 to
    -- 100,000 dollars. The writer fills it only while the card leaves it empty, so the sale's figure stays.
    v := nullif(btrim(coalesce(a->>'cf53482c-3d7d-45ab-b294-0230e917ea5f', ''), E' \t\n\r\f\x0b'), '');
    IF v IS NOT NULL THEN
      v_budget := public.cockpit_kickoff_budget_read(v);
      v_usd := (v_budget->>'usd')::numeric;
      IF v_budget IS NULL THEN
        v_lines := v_lines || to_jsonb('Daily Budget: not filled, the answer is not an amount the cockpit can read.'::text);
      ELSIF v_usd IS NULL AND v_budget->>'rate' IS NULL THEN
        v_lines := v_lines || to_jsonb('Daily Budget: not filled, the cockpit has no fixed rate for ' || (v_budget->>'currency') || ' yet.');
      ELSIF v_usd IS NULL THEN
        v_lines := v_lines || to_jsonb('Daily Budget: not filled, ' || (v_budget->>'said') || ' a day is less than a cent in dollars, outside 1 to 100,000 dollars.');
      ELSIF v_usd < 1 OR v_usd > 100000 THEN
        v_lines := v_lines || to_jsonb('Daily Budget: not filled, ' || v_usd::text || ' USD a day is outside 1 to 100,000 dollars.');
      ELSE
        v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', '539743c2-b6cd-4eeb-bf2f-abaf64769a5e', 'kind', 'currency',
          'label', 'Daily Budget', 'value', v_budget->'usd', 'onlyIfEmpty', true,
          'source', CASE WHEN (v_budget->>'from_text')::boolean THEN 'kickoff_text' ELSE 'kickoff' END));
        v_lines := v_lines || to_jsonb('Daily Budget, if empty on the card: ' || v_usd::text || ' USD a day'
          || CASE WHEN v_budget->>'currency' <> 'USD' THEN ', from ' || (v_budget->>'said') || ' at the cockpit''s rate'
                  WHEN (v_budget->>'from_text')::boolean THEN ', read from the typed answer' ELSE '' END);
      END IF;
    END IF;
    v_skip := 'No card field to fill from this kickoff.';
  ELSE
    -- Company Website (url): an https link to the business's own site (no social, Google or link-in-bio host).
    v := nullif(btrim(coalesce(a->>'454a425f-2ac6-4d94-92db-cec08618600e', ''), E' \t\n\r\f\x0b'), '');
    IF v IS NULL THEN
      v_skip := 'No card field to fill: there is no website answer.';
    ELSIF v ~ '^https://' AND public.cockpit_form_stage4_link_kind(v) = 'site' THEN
      v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', '5d57fdde-eb70-4610-a23b-88f718b4451d', 'kind', 'url',
        'label', 'Company Website', 'value', v, 'onlyIfEmpty', true, 'source', 'onboarding'));
      v_lines := v_lines || to_jsonb('Company Website, if empty on the card: the website answer'::text);
    ELSE
      v_skip := 'No card field to fill: the website answer is not an https link to the business''s own site.';
    END IF;
  END IF;
  RETURN jsonb_build_object('key', 'card_facts', 'delivery', 'clickup_queue',
    'plan', jsonb_build_object('taskId', p_task_id, 'fields', v_fields, 'lines', v_lines))
    || CASE WHEN jsonb_array_length(v_fields) = 0 THEN jsonb_build_object('skip', v_skip) ELSE '{}'::jsonb END;
END $$;

-- ---------------------------------------------------------------------------
-- 6. The Blueprint's sources (6 above): 20261025o's, with kit.budgetUsd and kit.budgetCurrency.

CREATE OR REPLACE FUNCTION public.cockpit_blueprint_sources(p_task_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb; v_name text; c jsonb; cc jsonb; v_logo jsonb; v_ghl jsonb; v_editor jsonb; v_dos jsonb;
  v_deckkit jsonb; v_kit jsonb; v_next jsonb; v_last jsonb; v_prep jsonb; v_row public.cockpit_blueprints;
  v_json jsonb; v_notes text[] := '{}'; v_has_kickoff boolean := false; v_budget jsonb;
  v_held_at timestamptz; v_held_status text; v_stage text; v_phase_text text; v_phase integer; v_nudge boolean;
BEGIN
  g := public.cockpit_blueprint_gate_for_actor(auth.uid(), p_task_id, false);
  v_name := g->>'clientName';

  SELECT s.data INTO c FROM public.cockpit_csm_sources s
   WHERE s.table_name = 'clients' AND s.data->>'taskId' = p_task_id LIMIT 1;
  IF c IS NULL THEN
    v_notes := v_notes || 'This card is not in the client success roster, so its stage and launch date are unknown.'::text;
  END IF;
  SELECT r.data INTO cc FROM public.cockpit_creative_sources r
   WHERE r.table_name = 'clients' AND r.data->>'taskId' = p_task_id
     AND public.cockpit_creative_source_current(r.table_name, r.source_snapshot_at) LIMIT 1;

  SELECT jsonb_build_object('bucket', 'cockpit-client-logos', 'path', l.storage_path, 'verifiedAt', l.verified_at)
    INTO v_logo FROM public.cockpit_client_logos l
   WHERE l.clickup_task_id = p_task_id ORDER BY l.verified_at DESC LIMIT 1;

  SELECT jsonb_build_object(
           'name', nullif(btrim(x.client_name), ''),
           'country', CASE upper(nullif(btrim(x.country), '')) WHEN 'QT' THEN 'QA' ELSE upper(nullif(btrim(x.country), '')) END,
           'city', nullif(btrim(x.city), ''), 'language', lower(nullif(btrim(x.language), '')),
           'serviceMode', upper(nullif(btrim(x.service_mode), '')))
    INTO v_ghl FROM public.ghl_clients x WHERE x.clickup_id = p_task_id LIMIT 1;

  SELECT jsonb_build_object(
           'offer', nullif(btrim(e.offer), ''), 'offerUrl', nullif(btrim(e.offer_url), ''),
           'brandDna', nullif(btrim(e.brand_dna), ''), 'brandDnaUrl', nullif(btrim(e.brand_dna_url), ''),
           'driveUrl', nullif(btrim(e.drive_url), ''), 'website', nullif(btrim(e.website), ''),
           'instagram', nullif(btrim(e.instagram), ''), 'readAt', e.docs_read_at, 'syncedAt', e.synced_at),
         jsonb_build_object('text', nullif(btrim(e.dos_donts), ''), 'source', 'The client card''s Do''s & Don''ts field',
                            'syncedAt', e.synced_at)
    INTO v_editor, v_dos FROM public.editor_clients e WHERE e.task_id = p_task_id;
  IF v_editor IS NULL THEN
    v_notes := v_notes || 'The client card has not been read by the editor desk, so the offer and Do''s & Don''ts are unknown.'::text;
  END IF;

  SELECT jsonb_build_object(
           'onboardingCallOn', o.onboarding_call_on, 'launchOn', o.launch_on, 'signupOn', o.signup_on,
           'links', jsonb_strip_nulls(jsonb_build_object(
             'drive', CASE WHEN jsonb_typeof(o.links->'drive') = 'string' THEN o.links->>'drive' END,
             'driveFolder', CASE WHEN jsonb_typeof(o.links->'drive_folder') = 'string' THEN o.links->>'drive_folder' END,
             'onboardingMap', CASE WHEN jsonb_typeof(o.links->'onboarding_map') = 'string' THEN o.links->>'onboarding_map' END,
             'website', CASE WHEN jsonb_typeof(o.links->'website') = 'string' THEN o.links->>'website' END)),
           'syncedAt', o.synced_at),
         jsonb_build_object(
           'clickup_task_id', o.clickup_task_id, 'client_name', o.client_name, 'client_status', o.client_status,
           -- Names only: the sync writes a username or, without one, an address.
           'csm', nullif(array_to_string(ARRAY(
                    SELECT btrim(x) FROM unnest(string_to_array(coalesce(o.csm, ''), ',')) x
                     WHERE btrim(x) <> '' AND x NOT LIKE '%@%'), ', '), ''),
           -- Only the links the Blueprint opens: never the contract, the sales
           -- call recording or the report sheet (leads and cost per lead).
           'links', (SELECT coalesce(jsonb_object_agg(l.key, l.value), '{}'::jsonb)
                       FROM jsonb_each(CASE WHEN jsonb_typeof(o.links) = 'object' THEN o.links ELSE '{}'::jsonb END) l
                      WHERE l.key IN ('drive','drive_folder','brand_dna','offer_sheet','market_research','website',
                                      'onboarding_map','clickup')
                        AND jsonb_typeof(l.value) = 'string'),
           'handover', (SELECT coalesce(jsonb_object_agg(k, o.handover->k), '{}'::jsonb)
                          FROM unnest(ARRAY['closer','closer_notes','handoff_risks','go_live','client_profile',
                                            'daily_budget','service']) k
                         WHERE jsonb_typeof(o.handover) = 'object' AND o.handover ? k),
           'forms', jsonb_strip_nulls(jsonb_build_object(
             'onboarding', o.forms->'onboarding',
             -- The kickoff without its payment: the top-level key and the
             -- "Payment Amount" question (ref 75e97e7d…) among its answers.
             'kickoff', CASE WHEN jsonb_typeof(o.forms->'kickoff') = 'object' THEN
               ((o.forms->'kickoff') - 'payment') || jsonb_build_object('answers', (
                 SELECT coalesce(jsonb_agg(e.v ORDER BY e.i), '[]'::jsonb)
                   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(o.forms->'kickoff'->'answers') = 'array'
                                                  THEN o.forms->'kickoff'->'answers' ELSE '[]'::jsonb END)
                        WITH ORDINALITY e(v, i)
                  WHERE coalesce(e.v->>'ref', '') NOT LIKE '75e97e7d%')) END))),
         jsonb_typeof(o.forms->'kickoff') = 'object'
    INTO v_deckkit, v_kit, v_has_kickoff
    FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_task_id;
  -- The kickoff's daily budget in dollars and its currency (20261103f), beside the card's Daily Budget
  -- (kit.handover.daily_budget): cockpit_kickoff_budget, the native amount at the cockpit's fixed rate, else
  -- old Typeform text read as dollars. NULL when there is none, and budgetUsd NULL with no fixed rate: never 0.
  IF v_kit IS NOT NULL THEN
    v_budget := public.cockpit_kickoff_budget(p_task_id);
    v_kit := v_kit || jsonb_build_object('budgetUsd', v_budget->'usd', 'budgetCurrency', v_budget->'currency');
  END IF;
  IF v_kit IS NULL THEN
    v_notes := v_notes || 'No onboarding record carries this card yet, so the onboarding and kickoff answers are unknown.'::text;
  END IF;
  IF v_has_kickoff IS NOT TRUE THEN
    v_notes := v_notes || 'No kickoff on record: ask the service and the budget.'::text;
  END IF;

  SELECT coalesce(jsonb_object_agg(x.kind, jsonb_build_object('startsAt', x.starts_at, 'endsAt', x.ends_at, 'status', x.status)), '{}'::jsonb)
    INTO v_next
    FROM (SELECT DISTINCT ON (k.kind) k.kind, k.starts_at, k.ends_at, k.status FROM public.cockpit_csm_calls k
           WHERE k.task_id = p_task_id AND k.kind <> 'other' AND k.starts_at > now() AND k.status IN ('booked','confirmed')
           ORDER BY k.kind, k.starts_at) x;
  SELECT coalesce(jsonb_object_agg(x.kind, jsonb_build_object('startsAt', x.starts_at, 'endsAt', x.ends_at, 'status', x.status)), '{}'::jsonb)
    INTO v_last
    FROM (SELECT DISTINCT ON (k.kind) k.kind, k.starts_at, k.ends_at, k.status FROM public.cockpit_csm_calls k
           WHERE k.task_id = p_task_id AND k.kind <> 'other' AND k.starts_at <= now()
             AND k.status IN ('held','showed','confirmed','booked')
           ORDER BY k.kind, k.starts_at DESC) x;

  -- The onboarding deck's prep, only the keys the Blueprint prefills from.
  SELECT jsonb_build_object(
           'deck', 'onboarding',
           'overrides', (SELECT coalesce(jsonb_object_agg(k, p.overrides->k), '{}'::jsonb)
                           FROM unnest(ARRAY['goals','red_lines','red_lines_ar','services','services_ar','service_focus',
                                             'service_focus_ar','service_chosen_at','starter_pack','dialect','language',
                                             'service_model']) k
                          WHERE p.overrides ? k),
           'revision', p.revision, 'updatedAt', p.updated_at,
           'updatedBy', public.cockpit_blueprint_first_name(p.updated_by))
    INTO v_prep FROM public.cockpit_csm_deck_prep p WHERE p.task_id = p_task_id AND p.deck = 'onboarding';

  SELECT * INTO v_row FROM public.cockpit_blueprints b WHERE b.task_id = p_task_id;
  v_json := public.cockpit_blueprint_json(v_row);

  -- The Blueprint call (S8): the latest one that has happened, the card's
  -- stage, the Onboarding Map's phase, and whether the call page should be
  -- opened because the call is over and nobody closed it in the cockpit. The
  -- nudge is for cards still before launch only (map phase 4 or lower).
  SELECT k.starts_at, k.status INTO v_held_at, v_held_status FROM public.cockpit_csm_calls k
   WHERE k.task_id = p_task_id AND k.kind = 'blueprint' AND k.starts_at <= now()
     AND k.status IN ('held','showed','confirmed','booked')
   ORDER BY k.starts_at DESC, k.id DESC LIMIT 1;
  SELECT o.client_status,
         substring(CASE WHEN jsonb_typeof(o.links->'onboarding_map') = 'string' THEN o.links->>'onboarding_map' END
                   FROM '[?&]phase=([0-9]+)')
    INTO v_stage, v_phase_text
    FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_task_id;
  v_phase := CASE WHEN v_phase_text ~ '^[0-9]{1,6}$' THEN v_phase_text::integer END;
  v_nudge := coalesce(v_stage ~* '(brand blueprint booked|ready for launch)', false)
             AND coalesce(v_phase, 0) <= 4 AND v_held_at IS NOT NULL
             AND NOT coalesce(v_row.parts ? '2', false);

  RETURN jsonb_build_object(
    'taskId', p_task_id, 'clientName', v_name, 'at', now(),
    'can', jsonb_build_object('write', g->'write', 'rehearse', g->'rehearse'),
    'presenter', jsonb_build_object('firstName', g->>'firstName'),
    'deck', jsonb_build_object(
      'taskId', p_task_id, 'clientName', v_name, 'at', now(),
      'presenter', jsonb_build_object('firstName', g->>'firstName'),
      'client', CASE WHEN c IS NULL THEN NULL ELSE jsonb_build_object(
        'stage', c->>'stage', 'service', nullif(btrim(c->>'service'), ''), 'launchDate', c->'launchDate',
        'bucket', c->>'bucket') END,
      'logo', v_logo, 'ghl', v_ghl, 'editor', v_editor, 'dosDonts', v_dos, 'kit', v_deckkit,
      'calls', jsonb_build_object('next', v_next, 'last', v_last),
      'prep', jsonb_build_object('onboarding', v_prep),
      'launchAds', '[]'::jsonb, 'notes', to_jsonb(v_notes)),
    'kit', v_kit,
    'card', CASE WHEN cc IS NULL THEN NULL ELSE jsonb_build_object(
      'templatedAds', cc->>'templatedAdsStatus', 'canSelfRecord', cc->>'canSelfRecord',
      'adApproval', cc->>'adApprovalNeeded', 'offerCreation', cc->>'offerCreationStatus') END,
    'creativeOnboarding', public.cockpit_blueprint_steps(v_name),
    'settings', public.cockpit_blueprint_settings_json() - 'changes',
    'blueprint', v_json,
    'outbox', coalesce(v_json->'outbox', jsonb_build_object('1', NULL, '2', NULL, '3', NULL)),
    'blueprintCall', jsonb_build_object('heldAt', v_held_at, 'status', v_held_status, 'stage', v_stage,
                                        'mapPhase', v_phase, 'nudge', v_nudge));
END $$;

-- ---------------------------------------------------------------------------
-- 7. Privileges: the owner's only for everything made or replaced here, as 20261103b, 20261102o and 20261102p
--    left the three it replaces; the send and the Blueprint's sources keep their live grant to authenticated
--    (each gated inside: cockpit_kickoff_seat, cockpit_blueprint_gate_for_actor).

REVOKE ALL ON FUNCTION public.cockpit_form_stage4_fields(text), public.cockpit_kickoff_budget_of(numeric,text),
  public.cockpit_kickoff_budget_read(text), public.cockpit_kickoff_budget(text), public.cockpit_kickoff_answers_check(jsonb),
  public.cockpit_form_stage4_card_facts(text,text,jsonb,timestamptz),
  public.cockpit_kickoff_submit(text,jsonb,uuid), public.cockpit_blueprint_sources(text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_kickoff_submit(text,jsonb,uuid), public.cockpit_blueprint_sources(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
