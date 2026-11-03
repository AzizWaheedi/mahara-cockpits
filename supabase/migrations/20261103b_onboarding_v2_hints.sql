-- Typeform's hints and optional questions back on the native onboarding (docs/forms/WAVE56-CONTRACT.md 4.18).
-- The CEO's answer of 2026-11-02 to "Restore Typeform's hints and optional questions": "Yes". Creative Triage
-- (bldgtotkfmhoxmlzowdx). Stands on 20261102o and 20261102p; applies twice.
--
-- 1. The native onboarding's definition (cockpit_form_versions onboarding version 2) changes in place, as
--    20261102o changed it: only while no answer and no invite uses it (read 2026-11-03: none) and its text is
--    20261102o's (md5 bc89ca36000ebf7943c6ec569cd1be73). Once an invite or an answer uses it, the guard below stops the
--    file, and the same wording goes into a version 3 instead. What changes, and nothing else:
--    - nine hints KFRCXPFx gives that version 2 dropped: the personal phone (one number, for confirmations), the
--      Meta business manager (access before the onboarding call, with the Leadsie link), business hours,
--      landmark, appointment length, consultants, free consultations, the top 3 challenges, and the Drive
--      link's eight-item checklist (one item per line) in place of its one-line summary;
--    - three questions optional again, as KFRCXPFx asks them: address, projects completed and landmark;
--    - the business name's label says "(in English)" in both languages, as KFRCXPFx's does;
--    - the Meta question's fifth choice, "My account is restricted" (restricted).
--    Still 39 questions; 29 required (32 before) and 10 hints. English and Arabic are the drafted wording
--    (aziz-kuwaiti-voice: plural address, no em dash, Arabic-Indic digits); every hint stays within the 600
--    characters cockpit_form_schema_check allows. The file builds the new definition from the stored one and
--    stops unless it is exactly the drafted one (md5 38d371cd509ced4fef9b7cad6e09fb80), passes
--    cockpit_form_schema_check and has no hint or label the client text rule (cockpit_client_text_ok) refuses.
--    The registry's copy (cockpit_forms) changes with it when the onboarding is already live on version 2.
--    One audit row each (cockpit_forms_audit, action forms.stage4_v2_hints).
-- 2. The fifth Meta choice in Make's texts (cockpit_form_stage4_fields): 20261102o's list with one more option
--    on facebookAds (ddf2767d), {"value":"restricted","typeform":"My Account is restricted | حسابي مقيّد"},
--    KFRCXPFx's own label. A native "restricted" answer then prints that label in every text Make writes (the
--    raw answers comment, the kickoff handoff), and a late KFRCXPFx delivery that chose it is mapped to
--    restricted by the Typeform door and the parity plan; before this file it went to _unmapped and Make's texts
--    lost the answer (finding F3). Every other question, and the kickoff's whole list, is 20261102o's, byte for
--    byte.
--
-- The portal's copy of version 2 (client portal src/lib/forms/onboarding-v2.json) takes the same definition
-- in its own release; it reads whichever version the database returns. Nothing here posts, writes a card,
-- sends a message or reaches a sheet.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard: the replaced body is 20261102o's (live, read 2026-11-03) or this file's own (a second
--    apply). The onboarding's version 2 is 20261102o's, unused, or this file's.

DO $$
DECLARE g record; v_now text;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('public.cockpit_form_stage4_fields(text)', '2b874cb1ed7fcf92a3d7fd9ca00547c5', 'eadfda57d24997ad958ec6c68a1f5703')
    ) AS x(fn, live_md5, after_md5)
  LOOP
    v_now := NULL;
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_now
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(g.fn);
    IF v_now IS NULL OR v_now NOT IN (g.live_md5, g.after_md5) THEN
      RAISE EXCEPTION '% changed since 20261102o; stop and re-read it.', replace(g.fn, 'public.', '')
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE v_md5 text; v_reg text; v_used bigint;
BEGIN
  SELECT md5(v.schema::text) INTO v_md5 FROM public.cockpit_form_versions v WHERE v.form_key = 'onboarding' AND v.version = 2;
  IF v_md5 IS NULL OR v_md5 NOT IN ('bc89ca36000ebf7943c6ec569cd1be73', '38d371cd509ced4fef9b7cad6e09fb80') THEN
    RAISE EXCEPTION 'The onboarding form''s version 2 changed since 20261102o; stop and re-read it.' USING ERRCODE = '55000';
  END IF;
  SELECT md5(f.schema::text) INTO v_reg FROM public.cockpit_forms f WHERE f.key = 'onboarding' AND f.version = 2;
  IF v_reg IS NOT NULL AND v_reg NOT IN ('bc89ca36000ebf7943c6ec569cd1be73', '38d371cd509ced4fef9b7cad6e09fb80') THEN
    RAISE EXCEPTION 'The registry''s copy of the onboarding form''s version 2 changed since 20261102o; stop and re-read it.'
      USING ERRCODE = '55000';
  END IF;
  IF v_md5 = 'bc89ca36000ebf7943c6ec569cd1be73' OR v_reg = 'bc89ca36000ebf7943c6ec569cd1be73' THEN
    SELECT (SELECT count(*) FROM public.cockpit_form_responses r WHERE r.form_key = 'onboarding' AND r.form_version = 2)
         + (SELECT count(*) FROM public.cockpit_form_invites i WHERE i.form_key = 'onboarding' AND i.form_version = 2)
      INTO v_used;
    IF v_used > 0 THEN
      RAISE EXCEPTION 'The onboarding form''s version 2 is in use (% answers and invites), so it cannot change in place: stop, and put these hints in version 3.', v_used
        USING ERRCODE = '55000';
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The native onboarding's definition (1 above): 20261102o's version 2 in place, unused. Each change is set
--    by its question's key; the order, every other question and every other setting stay.

DO $$
DECLARE
  v_old jsonb;
  v_new jsonb;
  v_fields jsonb := '[]'::jsonb;
  f jsonb;
  t jsonb;
  v_problem text;
  v_hints jsonb := jsonb_build_object(
    'personalPhone', '{"en": "We send appointment confirmations and updates to this number. Write one number only. If more people should get them, tell us on the onboarding call.", "ar": "على هالرقم نرسل تأكيد المواعيد والتحديثات. اكتبوا رقم واحد بس، وإذا تبون أحد ثاني يوصله، قولوا لنا بمكالمة الانطلاق."}'::jsonb,
    'facebookAds', '{"en": "If you have a Facebook business manager, give us access before the onboarding call: https://app.leadsie.com/connect/maharamedia/manage", "ar": "إذا عندكم حساب أعمال على فيسبوك، عطونا صلاحية عليه قبل مكالمة الانطلاق من هالرابط: https://app.leadsie.com/connect/maharamedia/manage"}'::jsonb,
    'hours', '{"en": "For example: Sunday to Thursday, 9am to 5pm.", "ar": "مثلاً: من الأحد لين الخميس، من ٩ الصبح لين ٥ العصر."}'::jsonb,
    'landmark', '{"en": "Only if clients visit your office.", "ar": "بس إذا العملاء يزورونكم بالمكتب."}'::jsonb,
    'appointmentLength', '{"en": "For example: a 60-minute appointment with 15 minutes between appointments.", "ar": "مثلاً: الموعد ٦٠ دقيقة، وبين كل موعد والثاني ١٥ دقيقة."}'::jsonb,
    'consultants', '{"en": "For each one: name, speciality, nationality and qualifications.", "ar": "لكل واحد: الاسم، التخصص، الجنسية، والمؤهلات."}'::jsonb,
    'freeConsults', '{"en": "Companies that offer a free consultation often get better results and more projects.", "ar": "الشركات اللي تقدم استشارة مجانية عادةً تحصّل نتايج أحسن ومشاريع أكثر."}'::jsonb,
    'challenges', '{"en": "Name a few we can help with right away.", "ar": "اذكروا كم شي نقدر نساعدكم فيه سيده."}'::jsonb,
    'driveLink', '{"en": "What to put in it:\nTeam photos\nPhotos with homeowners and clients\nBefore and after photos of projects\nTestimonial and reaction videos from past clients\nVideos of you, your team and your work in action\nEducational content about your services\nTime-lapse or walkthrough videos of projects in progress\nYour logo as a PDF", "ar": "شنو تحطون فيه:\nصور الفريق\nصور مع أصحاب البيوت والعملاء\nصور قبل وبعد للمشاريع\nفيديوهات آراء العملاء السابقين وردة فعلهم\nفيديوهات لكم ولفريقكم وانتو تشتغلون\nمحتوى تعليمي عن خدماتكم\nفيديوهات تايم لابس أو جولات بمشاريع شغالة\nالشعار كملف PDF"}'::jsonb);
  v_label jsonb := '{"en": "Business Name (in English)", "ar": "اسم الشركة (بالإنقليزي)"}'::jsonb;
  v_restricted jsonb := '{"value": "restricted", "label": {"en": "My account is restricted", "ar": "حسابي مقيّد"}}'::jsonb;
BEGIN
  SELECT v.schema INTO v_old FROM public.cockpit_form_versions v
   WHERE v.form_key = 'onboarding' AND v.version = 2 AND md5(v.schema::text) = 'bc89ca36000ebf7943c6ec569cd1be73';
  IF v_old IS NULL THEN
    -- A second apply: the version row is already this file's (the guard in 0 allows nothing else).
    SELECT v.schema INTO v_new FROM public.cockpit_form_versions v WHERE v.form_key = 'onboarding' AND v.version = 2;
  ELSE
    FOR f IN SELECT x FROM jsonb_array_elements(v_old->'fields') WITH ORDINALITY AS u(x, n) ORDER BY n LOOP
      IF v_hints ? (f->>'key') THEN
        f := f || jsonb_build_object('hint', v_hints->(f->>'key'));
      END IF;
      IF f->>'key' IN ('address', 'projectsDone', 'landmark') THEN
        f := f || '{"required": false}'::jsonb;
      END IF;
      IF f->>'key' = 'businessName' THEN
        f := f || jsonb_build_object('label', v_label);
      END IF;
      IF f->>'key' = 'facebookAds' THEN
        f := jsonb_set(f, '{options}', (f->'options') || jsonb_build_array(v_restricted));
      END IF;
      v_fields := v_fields || jsonb_build_array(f);
    END LOOP;
    v_new := jsonb_set(v_old, '{fields}', v_fields);
  END IF;
  IF md5(v_new::text) IS DISTINCT FROM '38d371cd509ced4fef9b7cad6e09fb80' THEN
    RAISE EXCEPTION 'The onboarding form''s new version 2 is not the drafted one (md5 %); stop and re-read it.', md5(v_new::text)
      USING ERRCODE = '55000';
  END IF;
  v_problem := public.cockpit_form_schema_check(v_new);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'The onboarding form''s new version 2 fails the form check: %', v_problem USING ERRCODE = '22023';
  END IF;
  FOR t IN SELECT x FROM jsonb_each(v_hints) e(k, x) UNION ALL SELECT v_label UNION ALL SELECT v_restricted->'label' LOOP
    v_problem := coalesce(public.cockpit_client_text_ok(t->>'en'), public.cockpit_client_text_ok(t->>'ar'));
    IF v_problem IS NOT NULL THEN
      RAISE EXCEPTION 'A new hint or label fails the client text rule: %', v_problem USING ERRCODE = '22023';
    END IF;
  END LOOP;

  PERFORM set_config('cockpit.audit_actor', 'migration 20261103b', true);
  PERFORM set_config('cockpit.audit_source', 'migration', true);
  PERFORM set_config('cockpit.forms_action', 'forms.stage4_v2_hints', true);
  UPDATE public.cockpit_form_versions v SET schema = v_new
   WHERE v.form_key = 'onboarding' AND v.version = 2 AND md5(v.schema::text) = 'bc89ca36000ebf7943c6ec569cd1be73';
  UPDATE public.cockpit_forms f SET schema = v_new, updated_by = 'migration 20261103b', updated_at = now()
   WHERE f.key = 'onboarding' AND f.version = 2 AND md5(f.schema::text) = 'bc89ca36000ebf7943c6ec569cd1be73';
  PERFORM set_config('cockpit.forms_action', '', true);
END $$;

-- ---------------------------------------------------------------------------
-- 2. The fifth Meta choice in Make's texts (2 above)

-- The kickoff's 46 questions and the onboarding's 36 (KFRCXPFx's), each with its Typeform ref and title:
-- 20261102o's, byte for byte, but for one more option on the onboarding's facebookAds (ddf2767d), restricted,
-- with KFRCXPFx's label "My Account is restricted | حسابي مقيّد". A native answer prints that label in Make's
-- texts, and a KFRCXPFx answer with it maps to restricted (it went to _unmapped before: finding F3).
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_fields(p_form_key text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_form_key = 'kickoff' THEN
    RETURN '[{"key":"detailsCorrect","typeformRef":"c0000001-0000-4000-8000-000000000001","title":"Is all of the above still correct?","type":"choice","options":["Yes","No"]},{"key":"detailsFix","typeformRef":"c0000001-0000-4000-8000-000000000002","title":"Anything to add?","type":"longtext"},{"key":"detailsCorrection","typeformRef":"c0000001-0000-4000-8000-000000000012","title":"What is wrong? Give the correct details.","type":"longtext"},{"key":"linksCorrect","typeformRef":"c0000001-0000-4000-8000-000000000003","title":"Is all of the above still correct?","type":"choice","options":["Yes","No"]},{"key":"linksFix","typeformRef":"c0000001-0000-4000-8000-000000000004","title":"Anything to add?","type":"longtext"},{"key":"linksCorrection","typeformRef":"c0000001-0000-4000-8000-000000000013","title":"Which link is wrong, and what is the correct one?","type":"longtext"},{"key":"operationsCorrect","typeformRef":"c0000001-0000-4000-8000-000000000005","title":"Is all of the above still correct?","type":"choice","options":["Yes","No"]},{"key":"operationsFix","typeformRef":"c0000001-0000-4000-8000-000000000006","title":"Anything to add?","type":"longtext"},{"key":"operationsCorrection","typeformRef":"c0000001-0000-4000-8000-000000000014","title":"What has changed? Give the correct details.","type":"longtext"},{"key":"serviceAdvertised","typeformRef":"c0000001-0000-4000-8000-000000000007","title":"Which service are we advertising?","type":"multi","options":["Design and build","Interior design","Architectural design","Fit out and renovation","Construction only","Other"]},{"key":"consultationTypes","typeformRef":"c0000001-0000-4000-8000-000000000008","title":"Which consultation types do they offer?","type":"multi","options":["In-office","In-home or onsite","Online"]},{"key":"profileComplete","typeformRef":"c0000001-0000-4000-8000-000000000009","title":"Is the profile complete?","type":"choice","options":["Yes","No"]},{"key":"profileFix","typeformRef":"c0000001-0000-4000-8000-000000000011","title":"Anything to add?","type":"longtext"},{"key":"profileMissing","typeformRef":"c0000001-0000-4000-8000-000000000015","title":"What is missing?","type":"longtext"},{"key":"contractStatus","typeformRef":"c0000001-0000-4000-8000-00000000000a","title":"Contract status","type":"choice","options":["Signed","Sent and waiting on client","Adjustments requested by client","Not sent yet","NA - already signed"]},{"key":"contractChanges","typeformRef":"c0000001-0000-4000-8000-00000000000b","title":"What needs changing in the contract?","type":"longtext"},{"key":"inWhatsappGroup","typeformRef":"3db082bb-1939-444b-8b32-d0067fc9878c","title":"Have you been added to the WhatsApp group?","type":"choice","options":["Yes","No"]},{"key":"whatsappAdd","typeformRef":"071c480f-17f9-48db-8155-56030f952e85","title":"Who else should we add to the WhatsApp group?","type":"longtext"},{"key":"driveDiscussed","typeformRef":"87c68a44-b19b-4a86-a286-0a2c8c32134e","title":"Have drive folders and filling out spreadsheets been discussed? (Intro message Whatsapp group)","type":"choice","options":["Yes","No"]},{"key":"whatsappStatus","typeformRef":"92fab954-d771-431c-9fc4-b9f15c53cbb8","title":"WhatsApp Status","type":"choice","options":["Access confirmed.","Pending.","Invited.","Waiting on client."]},{"key":"adPlatforms","typeformRef":"7d16afbb-b99a-4ee9-8718-4418cbeba534","title":"Which platforms will we advertise on?","type":"text"},{"key":"dailyBudget","typeformRef":"cf53482c-3d7d-45ab-b294-0230e917ea5f","title":"What is your daily budget for the ads?","type":"text"},{"key":"adAccountName","typeformRef":"e4b9dbd3-c12c-4d6f-a0e3-c3ba17c97728","title":"What is the name of the ad account? (has to be exact)","type":"text"},{"key":"facebookPageName","typeformRef":"940f494c-f99b-4920-b203-200576ddd780","title":"What is the name of the Facebook page? (has to be exact)","type":"text"},{"key":"cardLinked","typeformRef":"8bee68fc-0764-41a8-b90a-db2a3f401e9d","title":"Correct Card Linked To The Account With Funds?","type":"choice","options":["Yes","No"]},{"key":"facebookAccess","typeformRef":"6fcbd33c-60e9-4df7-bfaa-e76b588dd887","title":"Facebook Access Status?","type":"choice","options":["Requested","Waiting on Client","Access Confirmed","Pending","Using Ours","Need Tech Help","Their Page Our Ad Acc"]},{"key":"whatsappSynced","typeformRef":"a813378f-06ce-499e-8f0e-14761b89b474","title":"Whatsapp synced to Mahara OS?","type":"choice","options":["Requested","Waiting on Client","Integrated","Needs Integrating","Pending","Not Integrating"]},{"key":"bookingConnects","typeformRef":"03b0600d-04d2-40a0-a7de-75a488888eb7","title":"Does the booking platform connect to ours?","type":"choice","options":["Yes","No"]},{"key":"calendarComplete","typeformRef":"3bebf47d-c00b-4f26-8624-933b84e42ebc","title":"Google Calendar Integration Complete?","type":"choice","options":["Yes","No"]},{"key":"calendarStatus","typeformRef":"b657c5a5-d199-42b5-8437-c8d04f78e376","title":"Booking platform & Google Calendar Integration Status","type":"choice","options":["Requested","Waiting on Client","Integrated","Needs Integrating","Pending","Not Integrating","Google Synched - Not Integrated"]},{"key":"maharaOsAccess","typeformRef":"ad562fc2-6858-4e37-81c5-c4cc2375a330","title":"Mahara OS Access Status","type":"choice","options":["Logged In","Tech Issue","Didn''t Receive Access","Doesn''t Want To"]},{"key":"contentLinks","typeformRef":"3418ef58-72df-49aa-aac3-1e095e155d45","title":"Provide any marketing content links or notes.","type":"longtext"},{"key":"contentDiscussed","typeformRef":"753c4cde-4d28-4719-8459-06e4db640180","title":"Content Discussed","type":"choice","options":["Yes","No"]},{"key":"templatedAdsDiscussed","typeformRef":"f54986bc-e120-4345-afee-31c1000a5a9a","title":"Templated Ads Discussed","type":"choice","options":["Yes","No"]},{"key":"templatedAdsStatus","typeformRef":"eb7ed18c-8388-4d84-9b5c-2e3d4a030287","title":"Templated Ads Status","type":"choice","options":["Approved","Declined","Waiting On Client","Wants To See Them First"]},{"key":"hasLeads","typeformRef":"dff79b66-89dd-43ef-9664-3fa4e6a61d69","title":"Do you have pre-existing leads?","type":"choice","options":["Yes","No"]},{"key":"reachLeads","typeformRef":"85d7ebb5-ce36-4ac3-aff8-3ce464737abd","title":"Do you want us to reach out to those leads?","type":"choice","options":["Yes","No"]},{"key":"leadsLinks","typeformRef":"86a6cce0-9111-4d98-97e7-7af5b6d518c8","title":"Provide link or notes for those leads.","type":"longtext"},{"key":"coldLeadsExperience","typeformRef":"0cb88b75-f193-43a1-b802-d382178a0946","title":"Do you have experience selling to cold leads (leads from ads)?","type":"choice","options":["Yes","No"]},{"key":"coldCloseRate","typeformRef":"079812c4-bb7e-4cc3-8e57-24c3b9e886d9","title":"What is your current close rate on cold leads?","type":"text"},{"key":"academyConfirmed","typeformRef":"4379c2f7-c5cf-4104-92c5-9b2294d65b59","title":"Premium Projects Academy Confirmed?","type":"choice","options":["Yes","No"]},{"key":"firstStepsDiscussed","typeformRef":"dc6eafd2-516e-4ca9-9d9c-89dee060e224","title":"Discussed First Steps and Important Videos?","type":"choice","options":["Yes","No"]},{"key":"trainingAccess","typeformRef":"c56a7e2d-6f18-4bf9-a9f6-11367eab4c11","title":"Training Course Access","type":"choice","options":["Confirmed","Requested","Need Tech Help","Waiting On Client"]},{"key":"paymentAmount","typeformRef":"75e97e7d-4c19-437a-b4b8-67570c29344f","title":"Payment Amount","type":"number"},{"key":"postCallFormFilled","typeformRef":"34310b2e-4df4-4ed5-b67e-9aefa9087d6e","title":"Post call form filled?","type":"choice","options":["Yes","No"]},{"key":"callRecording","typeformRef":"b5578678-d0c2-475b-b66f-7ea54d55fe31","title":"Call Recording Link","type":"url"}]'::jsonb;
  ELSIF p_form_key = 'onboarding' THEN
    RETURN '[{"key":"fullName","typeformRef":"533f14a0-712f-4de9-9ac7-67e1be6bc0c8","title":"Full Name","type":"text"},{"key":"phone","typeformRef":"64f2fb80-b074-4017-b8b7-b7d549947e52","title":"Phone","type":"text"},{"key":"email","typeformRef":"7994f0d2-baeb-451b-983a-816290873a68","title":"Email","type":"text"},{"key":"businessName","typeformRef":"514bfd3f-4ca1-469e-b9e7-87656503f65c","title":"Business Name","type":"text"},{"key":"address","typeformRef":"e5caee43-e9b5-427d-8583-6982c5dd9be8","title":"Please enter your business address.","type":"longtext"},{"key":"mapsLink","typeformRef":"f7f9f2eb-1761-4c28-83ed-a53621c2cf88","title":"Paste a Google Maps link to your location (optional).","type":"text"},{"key":"website","typeformRef":"454a425f-2ac6-4d94-92db-cec08618600e","title":"Website URL","type":"text"},{"key":"instagram","typeformRef":"adecfe45-5d55-4319-98ff-3761e04bfc9b","title":"Instagram URL","type":"text"},{"key":"facebook","typeformRef":"575d17ed-e26d-4e55-87d3-7cb31cb71939","title":"Facebook Page URL","type":"text"},{"key":"paymentOptions","typeformRef":"ee25f923-d5e1-4d1a-a95f-cd9c17abbe83","title":"What payment options do you currently offer to your clients (e.g., full payment, installment plans, minimum down payment, in-house financing, third-party financing)?","type":"longtext"},{"key":"frontDeskPhone","typeformRef":"282dac48-5031-4acb-96b6-ea469e8a5a8b","title":"Front Desk Phone","type":"text"},{"key":"personalPhone","typeformRef":"09d2e62a-51d4-4665-a3a9-30f5279b71bc","title":"Personal Phone Number","type":"text"},{"key":"yearsInBusiness","typeformRef":"ed1ba2fe-2827-4eea-a678-62205f1ce9f5","title":"How long have you been in business?","type":"text"},{"key":"bookingSoftware","typeformRef":"7a120dbb-0169-4bcc-9193-5c525a470d02","title":"Current booking software","type":"text"},{"key":"facebookAds","typeformRef":"ddf2767d-5725-4df2-b200-f0aab77a2db5","title":"Do you have a facebook business manager or have you ever ran ads on meta (Facebook & Instagram) in the past?","type":"choice","options":[{"value":"yes","typeform":"Yes"},{"value":"unsure","typeform":"IM UNSURE | لست متأكدًا"},{"value":"ran_before","typeform":"I''ve ran ads before but dont know how to access my Account |شغّلت إعلانات من قبل لكنني لا أعرف كيف أصل إلى حسابي"},{"value":"never_ran","typeform":"I Have a Business Account but have never ran ads | لديّ حساب أعمال على فيسبوك لكنني لم أقم بتشغيل إعلانات من قبل"},{"value":"restricted","typeform":"My Account is restricted | حسابي مقيّد"}]},{"key":"projectsDone","typeformRef":"0a6b5704-c46d-480c-a592-b59108683596","title":"How many projects has your company completed to date?","type":"text"},{"key":"hours","typeformRef":"b7873d40-d154-42ac-bf24-cb3b667e84cc","title":"Business hours - When are you open to schedule?","type":"longtext"},{"key":"services","typeformRef":"d976036f-6c2e-4d5d-999a-64cf9bb2ef02","title":"1) What services do you offer list all of them? Also I want to know which ones have the HIGHEST price point and Highest Profit 2) What is the PRICE of the services?","type":"longtext"},{"key":"serviceFocus","typeformRef":"6271b610-6946-4056-bb08-d03ffc274141","title":"Out of those what is the #1 service/type of project you want to focus on scaling?","type":"longtext"},{"key":"faqs","typeformRef":"f2b7bc2b-2a79-4640-9e21-377e7aa39d45","title":"What are your top five most frequently asked questions and their answers? (Feel free to add more — the more detailed, the better.)","type":"longtext"},{"key":"idealProject","typeformRef":"6c819933-3eb9-4db8-bd59-d39be11cb7f0","title":"Please describe your ideal project in detail.","type":"longtext"},{"key":"serviceAreas","typeformRef":"fa017616-3fb5-4e64-9fbd-39cea6e26c47","title":"What service areas do you cover? Please list all cities and neighborhoods you serve so we can target your ads precisely.","type":"longtext"},{"key":"appointmentTypes","typeformRef":"b370341c-6ea3-43c9-bd8c-16e278a2d2d5","title":"What types of appointments do you offer? (Select all that apply)","type":"multi","options":[{"value":"online","typeform":"عن بُعد (أونلاين) | Online"},{"value":"onsite","typeform":"في موقع العميل / في المنزل | Onsite / In-home"},{"value":"office","typeform":"في مقرّكم / مكتبكم | In your office"}]},{"key":"maxDistance","typeformRef":"35ea63c3-090a-425d-b75c-e3d183d48cd1","title":"What''s the maximum distance you would travel from your office to do an in-home consultation?","type":"text"},{"key":"landmark","typeformRef":"b7c403ea-8d66-4814-80cf-7e8d7fdb8d11","title":"Local Landmark Information (Please type this in the format shown) - Located next to the Burger King down King Saud street on the left hand side.","type":"longtext"},{"key":"appointmentLength","typeformRef":"a20cfc1a-0228-413d-80ab-d97fc97574e0","title":"Appointment length + details + buffer","type":"longtext"},{"key":"consultants","typeformRef":"0a80a0a8-3a09-4907-a1d1-6c57e57d4c47","title":"Who are the engineers in your business that will be giving these consultations?","type":"longtext"},{"key":"whyJoined","typeformRef":"7426c6c5-344f-44c9-9999-3b9daf3a06b8","title":"What motivated you to join our program? What was the reason you signed up?","type":"longtext"},{"key":"freeConsults","typeformRef":"ec89854f-d006-402b-958a-91738e2b3e7a","title":"Do you offer free consultations?","type":"choice","options":[{"value":"yes","typeform":"Yes, we do offer free consultations / نعم، نقدم استشارات مجانية✅"},{"value":"open_to_it","typeform":"No, but we''re open to considering it / حاليا لا نقدمها، لكن يمكننا مناقشه🤝"},{"value":"no","typeform":"No, we do not offer free consultations / لا، لا نقدم استشارات مجانية❌"}]},{"key":"marketing","typeformRef":"bf8c7c7b-fff9-463f-b30a-8d8ca8b622f6","title":"What is your marketing process? In other words... please explain EVERYTHING A-Z that you have in place or have tried to generate new projects","type":"longtext"},{"key":"lastRevenue","typeformRef":"7ff5d37a-df7f-4002-8248-d0b4af6c28e8","title":"Last Calendar Year - How Much Total Revenue did you do?","type":"text"},{"key":"challenges","typeformRef":"fcf43e6a-cc84-4ae7-9cef-2336069d0280","title":"What are the TOP 3 challenges that - if we were able to help you with - would make you 100% satisfied with your investment? - Be specific.","type":"longtext"},{"key":"goal90","typeformRef":"791b99b8-c7e9-40a4-96d6-868399e1ae97","title":"What is your realistic goal revenue in 90 Days?","type":"text"},{"key":"goal12","typeformRef":"f4b96a9b-bd7c-4398-98b4-6a28a7d3595a","title":"What is your ideal/stretch revenue goal within the next 12-24 months?","type":"text"},{"key":"additionalInfo","typeformRef":"41d2d5bb-b023-4fa4-906c-72aeef7a5e46","title":"Any additional information we should know before starting?","type":"longtext"},{"key":"driveLink","typeformRef":"64d23c81-1784-4f07-8356-107af764fc95","title":"Please attach a Google Drive link to all the content you have for your office (See check list below)","type":"text"}]'::jsonb;
  END IF;
  RAISE EXCEPTION 'There is no Stage 4 field map for %.', coalesce(p_form_key, '(none)') USING ERRCODE = '22023';
END $$;

-- ---------------------------------------------------------------------------
-- 3. Privileges: the owner's only, as 20261102o left it (CREATE OR REPLACE keeps them; said again here).

REVOKE ALL ON FUNCTION public.cockpit_form_stage4_fields(text) FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
