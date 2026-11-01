-- The client's side of the pause and the exit (waves 3 and 4, slice client-lifecycle; 1 Nov 2026).
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Contract: docs/forms/WAVE34-CONTRACT.md
-- sections 2.2 (the 'b' rows), 2.4, 3.8, 4.3, 4.4, 8 and 9 (D-B0, D-B1).
-- Needs 20261102a_forms_invites.sql (the invites, the go-live list, the new
-- response columns, the notice kinds); a guard below stops the file without it.
--
-- 1. Registry: pause_consent (native, audience client, signed by a typed name
--    on the link) and its version 1; exit_survey version 2 (the client schema
--    for the portal and the link) in cockpit_form_versions only. The exit
--    survey's registry row stays version 1, schema {lives:'typeform'},
--    provider typeform until cockpit_form_client_go_live('exit_survey', true)
--    moves all three (20261102a), so the live legacy recorder keeps stamping
--    Typeform answers with version 1.
-- 2. Billing kinds survey (the exit survey's comment on the card, no field,
--    D11) and nps_sent (NPS Survey Sent, the day the NPS invite went out):
--    the kinds CHECK, the write-back trigger's WHEN (system source), the
--    writes, the comment, the detail and the canary (test card only). Neither
--    reaches ClickUp until clickup-writeback's CLICKUP_WRITEBACK_BILLING_KINDS
--    lists it (survey at D-C4B, nps_sent at D-C5).
-- 3. cockpit_billing_write: a client-request pause needs the client's signed
--    consent (consentResponseId) once pause_consent is live
--    (cockpit_form_client_live), else W12's two ticks run unchanged; the
--    consent detail and the card comment say "signed". Everything else in the
--    function is as live.
-- 4. Hooks the invites dispatchers call by name (20261102a, V19):
--    issue  pause_consent  start today to today + 14, restart after the start,
--                          over14 worked out; refuses a Paused card;
--    submit pause_consent  pause.consent in #csm-general (dates_wrong variant);
--    issue  exit_survey    the open departure's survey goes to sent;
--    submit exit_survey    termination.notice and termination.submitted, one
--                          survey billing event (the card comment), the
--                          departure's survey filled.
--    A canary (the test card 86eywg1cq) mutes its notices and marks its
--    billing event by_whom 'canary', so the deploy voids it by record.
-- 5. cockpit_pause_consent_for: the card's latest consent and what it allows.
-- 6. Readers: cockpit_form_notices_in lists native exit surveys (card by their
--    invite) and fresh pause consents; cockpit_form_prefill gives the pause its
--    consent and the churn confirm the native survey and its invite;
--    cockpit_csm_churn_read gives each departure its surveyInvite; the
--    responses guard lets a native exit survey or consent take the one notice
--    answer.
-- 7. forms.doors merged with {"lifecycle":true}.
--
-- Rollback (deploy D-B1, in one transaction): flip forms.doors.lifecycle to
-- false; restore the saved bodies of the nine replaced functions; set the
-- pause_consent registry row to provider 'typeform', typeform_id 'CTUjv6l3'
-- (the restored cockpit_billing_write refuses every client-request pause while
-- a native pause_consent row exists, 20261101p); recreate the trigger from its
-- saved definition. The kinds CHECK may keep survey and nps_sent (nothing
-- inserts them once the hooks are gone).
--
-- Every function is SECURITY DEFINER with an empty search path, revoked from
-- all four roles first and granted as before (the browser reads keep their
-- authenticated grant; hooks and helpers are the owner's only). plpgsql
-- throughout: the bodies name 20261102a's objects, resolved when they run.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard (contract 2.1, 2.2), then the file this one stands on.

DO $$
DECLARE
  v text;
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('cockpit_form_responses_guard()', '38fa9795b15dbc93494a691f88766b0f', 'd013e81456ebe7a8791270fe8858b972'),
      ('cockpit_billing_write(text,jsonb)', '8bdd972146ee2dfc0a5e1c6c0c5c47e4', '08ebb9942032b1dcf52cec367bb30a4a'),
      ('cockpit_billing_writeback_writes(text,text,text,jsonb)', 'dc073d43dfc0c8ae6c610f97d2c75eb6', '547e7750bfaf4473c50365bcbdcf8dac'),
      ('cockpit_billing_writeback_comment(text,text,text,jsonb,text)', '8d46fdc717d86d7e791a4d1c03ac9bdb', '850a7430b7b8cfc62a170ecccf127d63'),
      ('cockpit_billing_detail(text,jsonb)', '9b1a740c3d6002277cf6ae4130441939', '6b483cc5047953d545123e00cb87cb07'),
      ('cockpit_billing_canary(text,jsonb)', 'c25d1d6741035e15d73f351c313ca327', '066b53ffb9b4a8be423ee464e4d897c5'),
      ('cockpit_form_notices_in()', '098efc1d02330ab8dba95b3ba76d8454', '0f45b89b5b1f01a3860555649ec353bf'),
      ('cockpit_form_prefill(text,text)', '822602f21ebe9575e45db5bc1f344072', 'c8b2a34b4b1635844ddd310c7ec2d217'),
      ('cockpit_csm_churn_read()', '8f19c5b1488146d73f72e8d8aa1aba07', '47e621e9a67da0fc195d87d407885497')
    ) AS x(fn, live, after) LOOP
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.' || r.fn);
    IF v IS DISTINCT FROM r.live AND v IS DISTINCT FROM r.after THEN
      RAISE EXCEPTION '% changed since the waves 3-4 contract read it; stop and re-read it.', r.fn USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regprocedure('public.cockpit_form_client_live(text)') IS NULL
     OR to_regprocedure('public.cockpit_form_client_version(text)') IS NULL
     OR to_regclass('public.cockpit_form_invites') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                     WHERE a.attrelid = 'public.cockpit_form_responses'::regclass AND a.attname = 'invite_id' AND NOT a.attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                     WHERE a.attrelid = 'public.cockpit_form_responses'::regclass AND a.attname = 'signer' AND NOT a.attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                     WHERE c.conrelid = 'public.cockpit_slack_notices'::regclass AND c.conname = 'cockpit_slack_notices_kind_check'
                       AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%pause.consent%')
     OR to_regclass('public.cockpit_billing_event_voids') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                     WHERE a.attrelid = 'public.cockpit_churn_departures'::regclass AND a.attname = 'survey_state' AND NOT a.attisdropped) THEN
    RAISE EXCEPTION 'Apply 20261102a_forms_invites.sql (and waves 1-2) before 20261102b_client_lifecycle.sql.' USING ERRCODE = '55000';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The registry: pause_consent and its version 1, exit_survey version 2
--    (contract 2.4, 3.1, 5.5, 5.6). The copy is section 5's, word for word;
--    the Arabic was written under the aziz-kuwaiti-voice skill and speaks to
--    the one person answering (V27); the WhatsApp texts speak to the group.

SELECT set_config('cockpit.audit_actor', 'migration', true), set_config('cockpit.audit_source', 'migration', true);

INSERT INTO public.cockpit_forms (key, title, audience, provider, typeform_id, version, schema, seats, client_scoped, effects, updated_by)
VALUES ('pause_consent', 'Pause consent', 'client', 'native', NULL, 1,
$schema${
  "v": 1,
  "key": "pause_consent",
  "title": {"en": "Confirm your pause", "ar": "أكّد الإيقاف المؤقت"},
  "intro": {"en": "Your account manager set up this pause after your call. Check the dates, then confirm.",
            "ar": "مدير حسابك جهّز هالإيقاف بعد المكالمة. شيّك على التواريخ وبعدها أكّد."},
  "minutes": 2,
  "audience": "admin",
  "signer": "typed",
  "context": [
    {"key": "start", "type": "date", "label": {"en": "Pause starts", "ar": "يبدأ الإيقاف"}},
    {"key": "restart", "type": "date", "label": {"en": "Campaign restarts", "ar": "ترجع الحملة"}}
  ],
  "fields": [
    {"key": "datesWrong", "type": "tick", "label": {"en": "These dates are wrong", "ar": "التواريخ هذي غلط"},
     "hint": null, "required": false, "showIf": null, "boldIf": null},
    {"key": "datesNote", "type": "longtext", "label": {"en": "What should they be?", "ar": "شنو التواريخ الصح؟"},
     "hint": null, "required": true, "maxLength": 2000, "showIf": {"key": "datesWrong", "equals": true}},
    {"key": "reason", "type": "choice", "label": {"en": "Why are you pausing?", "ar": "ليش تبي توقف الحملة؟"},
     "hint": null, "required": true, "showIf": null,
     "options": [
       {"value": "travel", "label": {"en": "Travel", "ar": "سفر"}},
       {"value": "temporary_closure", "label": {"en": "Temporary closure", "ar": "سكّرنا مؤقتاً"}},
       {"value": "at_capacity", "label": {"en": "We are at capacity", "ar": "عندنا شغل فوق طاقتنا"}},
       {"value": "season", "label": {"en": "Ramadan or a season", "ar": "رمضان أو موسم"}},
       {"value": "other", "label": {"en": "Something else", "ar": "شي ثاني"}}
     ]},
    {"key": "details", "type": "longtext", "label": {"en": "Tell us a little more", "ar": "قول لنا أكثر شوي"},
     "hint": null, "required": true, "maxLength": 2000, "showIf": null},
    {"key": "consentTerm", "type": "tick",
     "label": {"en": "I understand the 90-day term keeps running during the pause.",
               "ar": "أدري إن مدة العقد ٩٠ يوم تظل تمشي خلال الإيقاف."},
     "hint": null, "required": true, "showIf": {"key": "datesWrong", "equals": false}, "boldIf": null},
    {"key": "consentOver14", "type": "tick",
     "label": {"en": "I understand that a pause longer than 14 days ends our agreement.",
               "ar": "أدري إن الإيقاف إذا زاد عن ١٤ يوم ينتهي فيه الاتفاق بيننا."},
     "hint": null, "required": true, "showIf": {"key": "datesWrong", "equals": false},
     "boldIf": {"context": "over14", "equals": true}},
    {"key": "anythingElse", "type": "longtext", "label": {"en": "Anything else for your Mahara team?", "ar": "تبي تقول شي ثاني لفريق مهارة؟"},
     "hint": null, "required": false, "maxLength": 2000, "showIf": null}
  ],
  "reads": {"consent_gate": ["datesWrong", "consentTerm", "consentOver14"]},
  "submit": {"en": "Confirm the pause", "ar": "أكّد الإيقاف"},
  "done": {"en": "Confirmed. Your account manager takes it from here.", "ar": "تم التأكيد. مدير حسابك بيكمل الباقي."},
  "invite": {
    "whatsapp": {"en": "Hi {client} team, here is the pause we agreed on the call. Check the dates and confirm here: {form_link}",
                 "ar": "هلا فريق {client}، هذا الإيقاف المؤقت اللي اتفقنا عليه بالمكالمة. شيّكوا على التواريخ وأكّدوا من هني: {form_link}"},
    "push": {"en": "Your account manager sent the pause to confirm. Tap to open it.",
             "ar": "مدير حسابك أرسل لك الإيقاف عشان تأكده. اضغط وافتحه."}
  }
}$schema$::jsonb,
  ARRAY['csm'], true,
  '[{"key":"record","owner":"cockpit","delivery":"sql","label":"Stored in the cockpit"},
    {"key":"consent_notice","owner":"cockpit","delivery":"slack_notice","label":"Pause consent signed in #csm-general"},
    {"key":"consent_gate","owner":"cockpit","delivery":"sql","label":"Confirm pause waits for the signed consent"}]'::jsonb,
  'migration 20261102b')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.cockpit_form_versions (form_key, version, schema, published_by, note)
SELECT f.key, 1, f.schema, 'migration 20261102b',
       'Signed by the client admin in the portal or by a typed name on the link; live at D-C2C.'
  FROM public.cockpit_forms f WHERE f.key = 'pause_consent'
ON CONFLICT DO NOTHING;

INSERT INTO public.cockpit_form_versions (form_key, version, schema, published_by, note)
VALUES ('exit_survey', 2,
$schema${
  "v": 1,
  "key": "exit_survey",
  "title": {"en": "Before you go", "ar": "قبل لا تمشي"},
  "intro": {"en": "We are sorry to see you go. Your answers reach your account manager and our CEO, and help us do better.",
            "ar": "يعز علينا تمشي. ردودك توصل لمدير حسابك وللمدير التنفيذي، وتساعدنا نتحسن."},
  "minutes": 2,
  "audience": "admin",
  "signer": "typed",
  "context": [],
  "fields": [
    {"key": "reasons", "type": "multi", "label": {"en": "Why are you leaving?", "ar": "ليش قررت توقف؟"},
     "hint": null, "required": true, "showIf": null,
     "options": [
       {"value": "results", "label": {"en": "The results", "ar": "النتائج"}},
       {"value": "company_changes", "label": {"en": "Changes in our company", "ar": "تغييرات بشركتنا"}},
       {"value": "cheaper_provider", "label": {"en": "A cheaper provider", "ar": "لقينا أحد أرخص"}},
       {"value": "in_house", "label": {"en": "Moving it in-house", "ar": "بنسويه داخل الشركة"}},
       {"value": "other", "label": {"en": "Something else", "ar": "شي ثاني"}}
     ]},
    {"key": "ads", "type": "scale", "label": {"en": "The ads we ran for you", "ar": "الإعلانات اللي سويناها لك"},
     "hint": null, "required": true, "showIf": null, "min": 1, "max": 10,
     "lowLabel": {"en": "Poor", "ar": "ضعيف"}, "highLabel": {"en": "Excellent", "ar": "ممتاز"}},
    {"key": "people", "type": "scale", "label": {"en": "The people who reached you through the ads", "ar": "الناس اللي تواصلوا معاك من الإعلانات"},
     "hint": null, "required": true, "showIf": null, "min": 1, "max": 10,
     "lowLabel": {"en": "Poor", "ar": "ضعيف"}, "highLabel": {"en": "Excellent", "ar": "ممتاز"}},
    {"key": "comms", "type": "scale", "label": {"en": "Communication with our team", "ar": "التواصل مع فريقنا"},
     "hint": null, "required": true, "showIf": null, "min": 1, "max": 10,
     "lowLabel": {"en": "Poor", "ar": "ضعيف"}, "highLabel": {"en": "Excellent", "ar": "ممتاز"}},
    {"key": "recommend", "type": "scale",
     "label": {"en": "How likely are you to recommend Mahara to another business owner?", "ar": "شكثر ممكن تنصح فينا صاحب شركة ثاني؟"},
     "hint": null, "required": true, "showIf": null, "min": 0, "max": 10,
     "lowLabel": {"en": "Not at all", "ar": "أبد"}, "highLabel": {"en": "Definitely", "ar": "أكيد"}},
    {"key": "keptUs", "type": "longtext", "label": {"en": "What would have kept you with us?", "ar": "شنو كان ممكن يخليك تكمل معانا؟"},
     "hint": null, "required": false, "maxLength": 2000, "showIf": null},
    {"key": "comments", "type": "longtext", "label": {"en": "Anything else you want us to know?", "ar": "في شي ثاني تبينا نعرفه؟"},
     "hint": null, "required": false, "maxLength": 2000, "showIf": null}
  ],
  "reads": {"card_comment": ["reasons", "ads", "people", "comms", "recommend", "keptUs", "comments"]},
  "submit": {"en": "Send", "ar": "أرسل"},
  "done": {"en": "Thank you. Your account manager will be in touch.", "ar": "مشكور. مدير حسابك بيتواصل معاك."},
  "invite": {
    "whatsapp": {"en": "Hi {client} team, thank you for the time we worked together. Two minutes of honest feedback would help us a lot: {form_link}",
                 "ar": "هلا فريق {client}، شكراً على الفترة اللي اشتغلنا فيها سوا. دقيقتين من رأيكم الصريح تفرق معانا وايد: {form_link}"},
    "push": {"en": "Your account manager sent a short survey. Tap to open it.",
             "ar": "مدير حسابك أرسل لك استبيان قصير. اضغط وافتحه."}
  }
}$schema$::jsonb,
  'migration 20261102b',
  'The client schema for the portal and the link; the registry moves here at C4b (go-live).')
ON CONFLICT DO NOTHING;

-- Both client schemas pass 20261102a's v1 check and the client text rule at
-- seed (contract 3.1): a refusal stops the file here, before anything else.
DO $$
DECLARE
  s jsonb;
  v_problem text;
  v_text text;
BEGIN
  FOR s IN SELECT x.schema FROM public.cockpit_form_versions x
            WHERE (x.form_key, x.version) IN (('pause_consent', 1), ('exit_survey', 2)) LOOP
    v_problem := public.cockpit_form_schema_check(s);
    IF v_problem IS NOT NULL THEN
      RAISE EXCEPTION 'The % client schema fails the v1 check: %', s->>'key', v_problem USING ERRCODE = '22023';
    END IF;
    FOR v_text IN SELECT j.v #>> '{}' FROM jsonb_path_query(s, '$.**.en') AS j(v)
                  UNION ALL
                  SELECT j.v #>> '{}' FROM jsonb_path_query(s, '$.**.ar') AS j(v) LOOP
      v_problem := public.cockpit_client_text_ok(v_text);
      IF v_problem IS NOT NULL THEN
        RAISE EXCEPTION 'The % client schema has a line the client text rule refuses: %', s->>'key', v_problem USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Billing kinds survey and nps_sent (contract 3.8): the CHECK, then the
--    write-back trigger's WHEN (system source only; a system pause is still
--    never queued).

DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_billing_events'::regclass AND c.conname = 'cockpit_billing_events_kind_check';
  IF v_def IS NULL OR v_def NOT LIKE '%''survey''%' OR v_def NOT LIKE '%''nps_sent''%' THEN
    ALTER TABLE public.cockpit_billing_events DROP CONSTRAINT IF EXISTS cockpit_billing_events_kind_check;
    ALTER TABLE public.cockpit_billing_events ADD CONSTRAINT cockpit_billing_events_kind_check CHECK (kind IN (
      'amount','assign','chase','churn','confirm','date','exclude','extension','invoice','late','link','ltv','method','mrr',
      'note','pause','payment','plan','resume','unconfirm','unexclude','unlink','survey','nps_sent'));
  END IF;
END $$;

DROP TRIGGER IF EXISTS cockpit_billing_events_clickup_writeback ON public.cockpit_billing_events;
CREATE TRIGGER cockpit_billing_events_clickup_writeback AFTER INSERT ON public.cockpit_billing_events
 FOR EACH ROW WHEN ((NEW.source IN ('ceo','csm') AND NEW.kind IN ('method','plan','amount','date','extension','pause','resume','payment','note','churn','mrr'))
                 OR (NEW.source = 'system' AND NEW.kind IN ('extension','ltv','late','survey','nps_sent')))
 EXECUTE FUNCTION public.cockpit_billing_writeback_enqueue();

-- ---------------------------------------------------------------------------
-- 3. The new helpers and hooks come first: the replaced readers call them.

-- The day in Kuwait as the cockpit writes a timestamp in a consent (fixed
-- +03:00, no daylight saving), so the card comment reads the same day
-- whatever the session's time zone.
CREATE OR REPLACE FUNCTION public.cockpit_kuwait_stamp(p_at timestamptz)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = '' AS $$
BEGIN
  RETURN CASE WHEN p_at IS NULL THEN NULL
              ELSE to_char(p_at AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM-DD"T"HH24:MI:SS') || '+03:00' END;
END $$;
COMMENT ON FUNCTION public.cockpit_kuwait_stamp(timestamptz) IS
  'A timestamp as Kuwait local time with its fixed +03:00 offset (20261102b); the first ten characters are the Kuwait day.';

-- The card's open departure for the exit survey (W12 W21, contract 4.4): not
-- removed, confirmed or not, and no resume after it that was not voided.
CREATE OR REPLACE FUNCTION public.cockpit_exit_survey_departure(p_task_id text)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d public.cockpit_churn_departures;
BEGIN
  IF p_task_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO d FROM public.cockpit_churn_departures x
   WHERE x.clickup_task_id = p_task_id AND x.removed_at IS NULL
   ORDER BY x.left_on DESC, x.id DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_billing_events e
              WHERE e.clickup_task_id = p_task_id AND e.kind = 'resume'
                AND (e.at AT TIME ZONE 'Asia/Kuwait')::date > d.left_on
                AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids v WHERE v.event_id = e.id)) THEN
    RETURN NULL;
  END IF;
  RETURN d.id;
END $$;
COMMENT ON FUNCTION public.cockpit_exit_survey_departure(text) IS
  'The card''s departure an exit survey belongs to: the newest not removed (confirmed or not) with no unvoided resume after it; NULL when none (20261102b).';

-- One exit survey invite as the churn tracker and the churn confirm read it
-- (contract 4.4.5): the departure's own (context.departureId), else the card's
-- newest that names no departure; never a canary's. An open invite past its
-- end reads expired without writing (V25).
CREATE OR REPLACE FUNCTION public.cockpit_exit_survey_invite_for(p_task_id text, p_departure_id bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE i public.cockpit_form_invites;
BEGIN
  IF p_task_id IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO i FROM public.cockpit_form_invites x
   WHERE x.task_id = p_task_id AND x.form_key = 'exit_survey' AND x.origin <> 'canary'
     AND ((p_departure_id IS NOT NULL AND x.context->>'departureId' = p_departure_id::text)
          OR NOT (x.context ? 'departureId')
          OR p_departure_id IS NULL)
   ORDER BY (p_departure_id IS NOT NULL AND x.context->>'departureId' = p_departure_id::text) DESC, x.issued_at DESC, x.id DESC
   LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'inviteId', i.id,
    'state', CASE WHEN i.state = 'open' AND i.expires_at <= now() THEN 'expired' ELSE i.state END,
    'channels', to_jsonb(i.channels),
    'issuedAt', i.issued_at,
    'answeredAt', i.answered_at,
    'responseId', i.response_id,
    'expiresAt', i.expires_at);
END $$;
COMMENT ON FUNCTION public.cockpit_exit_survey_invite_for(text, bigint) IS
  'The exit survey invite of a departure (its own, else the card''s newest naming no departure), never a canary''s: {inviteId, state (open past its end reads expired), channels, issuedAt, answeredAt, responseId, expiresAt}, or NULL (20261102b).';

-- A native exit survey's ratings for the churn tracker's notice band, in the
-- shape of cockpit_churn_survey_ratings (20261101o): numbers only, never a
-- typed answer, at most four.
CREATE OR REPLACE FUNCTION public.cockpit_exit_survey_native_ratings(p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('title', x.title, 'value', (p_answers->>x.k)::numeric) ORDER BY x.n), '[]'::jsonb)
            FROM (VALUES (1, 'ads', 'Ads'), (2, 'people', 'The people who reached them'),
                         (3, 'comms', 'Communication'), (4, 'recommend', 'Would recommend')) AS x(n, k, title)
           WHERE jsonb_typeof(p_answers) = 'object' AND jsonb_typeof(p_answers->x.k) = 'number');
END $$;
COMMENT ON FUNCTION public.cockpit_exit_survey_native_ratings(jsonb) IS
  'The four ratings of a portal or link exit survey as [{title, value}] for the churn tracker (20261102b).';

-- ---------------------------------------------------------------------------
-- The card's latest pause consent and what it allows (contract 4.3.4).
--   state none         no consent sent, the latest was withdrawn, or a pause has used it
--         sent         out to the client, not answered yet
--         signed       answered in the last 14 days, dates not marked wrong, no pause after it
--         dates_wrong  the client says the dates are wrong (in the last 14 days)
--         expired      the invite ended unanswered, or it was signed over 14 days ago
-- via is portal or link; signer is "the client admin" in the portal, the typed
-- name on the link (the screens show it so the CSM can check it). Canary
-- invites and their shadow answers count only for the test card 86eywg1cq,
-- which is not on the billing sheet, so no pause can ever use one.
CREATE OR REPLACE FUNCTION public.cockpit_pause_consent_for(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_test boolean := p_task_id = '86eywg1cq';
  i public.cockpit_form_invites;
  r public.cockpit_form_responses;
  v_state text;
  v_used boolean;
BEGIN
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'That is not a ClickUp card id.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO i FROM public.cockpit_form_invites x
   WHERE x.task_id = p_task_id AND x.form_key = 'pause_consent' AND (x.origin <> 'canary' OR v_test)
   ORDER BY x.issued_at DESC, x.id DESC LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'none', 'inviteId', NULL, 'sentAt', NULL, 'expiresAt', NULL, 'responseId', NULL,
      'signedAt', NULL, 'via', NULL, 'signer', NULL, 'start', NULL, 'restart', NULL, 'over14', NULL, 'datesNote', NULL);
  END IF;
  IF i.state = 'answered' THEN
    SELECT * INTO r FROM public.cockpit_form_responses x
     WHERE x.form_key = 'pause_consent' AND x.task_id = p_task_id AND x.state IN ('submitted', 'confirmed')
       AND (x.id = i.response_id OR x.invite_id = i.id)
       AND (x.mode = 'live' OR v_test)
     ORDER BY x.submitted_at DESC LIMIT 1;
  END IF;
  IF r.id IS NOT NULL THEN
    v_used := EXISTS (SELECT 1 FROM public.cockpit_billing_events e
                       WHERE e.clickup_task_id = p_task_id AND e.kind = 'pause' AND e.at > r.submitted_at
                         AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids v WHERE v.event_id = e.id));
    v_state := CASE WHEN v_used THEN 'none'
                    WHEN r.submitted_at <= now() - interval '14 days' THEN 'expired'
                    WHEN r.answers->'datesWrong' = 'true'::jsonb THEN 'dates_wrong'
                    ELSE 'signed' END;
  ELSE
    v_state := CASE WHEN i.state = 'open' AND i.expires_at > now() THEN 'sent'
                    WHEN i.state IN ('open', 'expired') THEN 'expired'
                    ELSE 'none' END;
  END IF;
  RETURN jsonb_build_object(
    'state', v_state,
    'inviteId', i.id,
    'sentAt', i.issued_at,
    'expiresAt', i.expires_at,
    'responseId', r.id,
    'signedAt', public.cockpit_kuwait_stamp(r.submitted_at),
    'via', CASE WHEN r.id IS NULL THEN NULL WHEN r.source = 'portal' THEN 'portal' ELSE 'link' END,
    'signer', CASE WHEN r.id IS NULL THEN NULL WHEN r.source = 'portal' THEN 'the client admin'
                   ELSE coalesce(nullif(btrim(coalesce(r.signer, '')), ''), 'someone with the link') END,
    'start', i.context->>'start',
    'restart', i.context->>'restart',
    'over14', CASE WHEN jsonb_typeof(i.context->'over14') = 'boolean' THEN i.context->'over14' END,
    'datesNote', CASE WHEN r.answers->'datesWrong' = 'true'::jsonb THEN left(r.answers->>'datesNote', 2000) END);
END $$;
COMMENT ON FUNCTION public.cockpit_pause_consent_for(text) IS
  'The card''s latest pause consent (contract 4.3.4): {state none|sent|signed|dates_wrong|expired, inviteId, sentAt, expiresAt, responseId, signedAt (Kuwait, +03:00), via portal|link, signer (the client admin, or the typed name), start, restart, over14, datesNote}. signed: answered within 14 days, dates not marked wrong, no unvoided pause after it. Canary consents count only for the test card. Read by cockpit_billing_write and cockpit_form_prefill (20261102b).';

-- A hook's notice (contract 3.4, 3.10): queued as every notice is; a
-- canary's goes straight on to muted with its reason (a notice is always
-- inserted queued or skipped, 20261025n's guard), so the deploy's read-back
-- sees it and Slack never does.
CREATE OR REPLACE FUNCTION public.cockpit_lifecycle_notice(p_kind text, p_dedupe text, p_task text, p_client text,
  p_facts jsonb, p_canary boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  v_id := public.cockpit_slack_notice_queue(p_kind, p_dedupe, p_task, p_client, p_facts, NULL, 'queued', NULL);
  IF v_id IS NOT NULL AND coalesce(p_canary, false) THEN
    UPDATE public.cockpit_slack_notices
       SET state = 'muted', finished_at = now(), error = 'Canary on the test card: not posted'
     WHERE id = v_id AND state = 'queued';
  END IF;
  RETURN v_id;
END $$;
COMMENT ON FUNCTION public.cockpit_lifecycle_notice(text, text, text, text, jsonb, boolean) IS
  'Queues one notice of the client lifecycle hooks (20261102b); a canary''s is muted at once with "Canary on the test card: not posted". A repeated dedupe key adds nothing.';

-- ---------------------------------------------------------------------------
-- Hooks (V19). 20261102a's dispatchers call them by name: an issue hook that
-- raises rolls the issue back (it is a rule); a submit hook runs after the
-- answer is stored and the invite closed, in its own sub-block, so a raise is
-- recorded as hook_failed and the answer is kept. Each is safe to run again
-- for the same row: notices by their dedupe keys, the survey event once per
-- response, the departure only forward.

CREATE OR REPLACE FUNCTION public.cockpit_form_issue_hook_pause_consent(p_invite_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  i public.cockpit_form_invites;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_start date;
  v_restart date;
BEGIN
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = p_invite_id FOR UPDATE;
  IF NOT FOUND OR i.form_key IS DISTINCT FROM 'pause_consent' THEN
    RAISE EXCEPTION 'That invite is not a pause consent.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = i.task_id AND a.client_status = 'Paused') THEN
    RAISE EXCEPTION 'This client is already paused. Resume them first.' USING ERRCODE = '22023';
  END IF;
  -- The pause starts today unless the sheet says a later day, at most 14 days on (contract 3.2).
  IF nullif(btrim(coalesce(i.context->>'start', '')), '') IS NULL THEN
    v_start := v_today;
  ELSE
    v_start := public.cockpit_billing_day(i.context->>'start');
  END IF;
  IF v_start IS NULL OR v_start < v_today OR v_start > v_today + 14 THEN
    RAISE EXCEPTION 'The pause starts today or within 14 days.' USING ERRCODE = '22023';
  END IF;
  v_restart := public.cockpit_billing_day(i.context->>'restart');
  IF v_restart IS NULL OR v_restart <= v_start THEN
    RAISE EXCEPTION 'Pick the restart day, after the start.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.cockpit_form_invites
     SET context = i.context || jsonb_build_object('start', v_start, 'restart', v_restart, 'over14', (v_restart - v_start) > 14),
         updated_at = now()
   WHERE id = i.id;
END $$;
COMMENT ON FUNCTION public.cockpit_form_issue_hook_pause_consent(uuid) IS
  'Issue hook of pause_consent (contract 4.3.2): refuses a Paused card, a start outside today to today + 14 (none: today) and a restart on or before the start; writes start, restart and over14 (restart - start > 14) into the invite''s context (20261102b).';

CREATE OR REPLACE FUNCTION public.cockpit_form_hook_pause_consent(p_response_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.cockpit_form_responses;
  i public.cockpit_form_invites;
  v_canary boolean;
  v_client text;
  v_wrong boolean;
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  IF NOT FOUND OR r.form_key IS DISTINCT FROM 'pause_consent' OR r.state NOT IN ('submitted', 'confirmed') THEN
    RAISE EXCEPTION 'That answer is not a sent pause consent.' USING ERRCODE = '22023';
  END IF;
  IF r.task_id IS NULL THEN
    RAISE EXCEPTION 'That pause consent has no card.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = r.invite_id;
  v_canary := r.mode = 'shadow' OR coalesce(r.answer_meta->>'canary', '') = 'true' OR i.origin = 'canary';
  SELECT a.client_name INTO v_client FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = r.task_id;
  v_client := coalesce(v_client, r.client_name, i.client_name, CASE WHEN v_canary THEN 'Test card (canary)' END, r.task_id);
  -- Only the box the consent gate reads (schema reads.consent_gate); never a typed answer.
  v_wrong := r.answers->'datesWrong' = 'true'::jsonb;
  -- Names and dates only (contract 3.4): no typed name, no note, no address.
  PERFORM public.cockpit_lifecycle_notice('pause.consent', 'consent:' || r.id::text, r.task_id, v_client,
    jsonb_strip_nulls(jsonb_build_object(
      'taskId', r.task_id, 'client', v_client, 'responseId', r.id, 'inviteId', r.invite_id,
      'datesWrong', coalesce(v_wrong, false), 'variant', CASE WHEN v_wrong THEN 'dates_wrong' ELSE 'signed' END,
      'via', CASE WHEN r.source = 'portal' THEN 'portal' ELSE 'link' END,
      'start', i.context->>'start', 'restart', i.context->>'restart',
      'signedAt', public.cockpit_slack_notice_iso(r.submitted_at))),
    v_canary);
END $$;
COMMENT ON FUNCTION public.cockpit_form_hook_pause_consent(uuid) IS
  'Submit hook of pause_consent (contract 4.3.3): queues pause.consent (facts.variant dates_wrong when the client ticked These dates are wrong), dedupe consent:<response id>; a canary''s notice is inserted muted. Nothing on the card (D11). (20261102b)';

CREATE OR REPLACE FUNCTION public.cockpit_form_issue_hook_exit_survey(p_invite_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  i public.cockpit_form_invites;
  v_dep bigint;
BEGIN
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = p_invite_id FOR UPDATE;
  IF NOT FOUND OR i.form_key IS DISTINCT FROM 'exit_survey' THEN
    RAISE EXCEPTION 'That invite is not an exit survey.' USING ERRCODE = '22023';
  END IF;
  IF i.origin = 'canary' THEN RETURN; END IF;
  v_dep := public.cockpit_exit_survey_departure(i.task_id);
  IF v_dep IS NULL THEN RETURN; END IF;
  UPDATE public.cockpit_churn_departures
     SET survey_state = 'sent', updated_by = 'the cockpit', updated_at = now()
   WHERE id = v_dep AND survey_state = 'not_sent';
  UPDATE public.cockpit_form_invites
     SET context = i.context || jsonb_build_object('departureId', v_dep), updated_at = now()
   WHERE id = i.id;
END $$;
COMMENT ON FUNCTION public.cockpit_form_issue_hook_exit_survey(uuid) IS
  'Issue hook of exit_survey (contract 4.4.2): the card''s open departure (cockpit_exit_survey_departure) goes from survey not_sent to sent and its id is written into the invite''s context.departureId. A canary touches no departure. (20261102b)';

CREATE OR REPLACE FUNCTION public.cockpit_form_hook_exit_survey(p_response_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.cockpit_form_responses;
  i public.cockpit_form_invites;
  v_canary boolean;
  v_client text;
  v_notice date;
  v_via text;
  v_facts jsonb;
  v_detail jsonb;
  v_dep bigint;
  a jsonb;
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  IF NOT FOUND OR r.form_key IS DISTINCT FROM 'exit_survey' OR r.state NOT IN ('submitted', 'confirmed') THEN
    RAISE EXCEPTION 'That answer is not a sent exit survey.' USING ERRCODE = '22023';
  END IF;
  IF r.task_id IS NULL OR r.invite_id IS NULL THEN
    RAISE EXCEPTION 'That exit survey came without its invite, so it is not this hook''s.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO i FROM public.cockpit_form_invites x WHERE x.id = r.invite_id;
  v_canary := r.mode = 'shadow' OR coalesce(r.answer_meta->>'canary', '') = 'true' OR i.origin = 'canary';
  SELECT b.client_name INTO v_client FROM public.cockpit_billing_accounts b WHERE b.clickup_task_id = r.task_id;
  v_client := coalesce(v_client, r.client_name, i.client_name, CASE WHEN v_canary THEN 'Test card (canary)' END, r.task_id);
  v_notice := coalesce(public.cockpit_billing_day(r.answer_meta->>'notice_on'), (r.submitted_at AT TIME ZONE 'Asia/Kuwait')::date);
  v_via := CASE WHEN r.source = 'portal' THEN 'portal' ELSE 'link' END;
  a := r.answers;

  -- #csm-general (tags the CSM) and #csm-announcements (posts once its setting
  -- is on, at D-C4B). The same facts the legacy notice carries: names and days.
  v_facts := jsonb_build_object('responseId', r.id, 'submittedAt', public.cockpit_slack_notice_iso(r.submitted_at),
    'noticeOn', v_notice, 'matched', true, 'client', v_client, 'taskId', r.task_id, 'via', v_via);
  PERFORM public.cockpit_lifecycle_notice('termination.notice', 'termination:' || r.id::text, r.task_id, v_client, v_facts, v_canary);
  PERFORM public.cockpit_lifecycle_notice('termination.submitted', 'termination-sub:' || r.id::text, r.task_id, v_client, v_facts, v_canary);

  -- The card comment through the billing rails (kind survey, contract 3.8), once
  -- per answer. It changes no card field (D11).
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_billing_events e
                  WHERE e.kind = 'survey' AND e.clickup_task_id = r.task_id AND e.detail->>'response_id' = r.id::text) THEN
    v_detail := public.cockpit_billing_detail('survey', jsonb_build_object(
      'responseId', r.id, 'inviteId', r.invite_id, 'noticeOn', v_notice, 'seatRole', 'system',
      'reasons', a->'reasons',
      'ratings', jsonb_build_object('ads', a->'ads', 'people', a->'people', 'comms', a->'comms'),
      'recommend', a->'recommend', 'keptUs', a->>'keptUs', 'comments', a->>'comments', 'via', v_via));
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (r.task_id, v_client, 'survey', NULL, NULL, 'Exit survey answered', v_detail, 'system',
            CASE WHEN v_canary THEN 'canary' ELSE 'the cockpit' END);
  END IF;

  -- The departure's survey: filled with this answer (never moved back).
  IF NOT v_canary THEN
    v_dep := CASE WHEN i.context->>'departureId' ~ '^[0-9]{1,18}$'
                       AND EXISTS (SELECT 1 FROM public.cockpit_churn_departures d
                                    WHERE d.id = (i.context->>'departureId')::bigint AND d.removed_at IS NULL
                                      AND d.clickup_task_id = r.task_id)
                  THEN (i.context->>'departureId')::bigint
                  ELSE public.cockpit_exit_survey_departure(r.task_id) END;
    IF v_dep IS NOT NULL THEN
      UPDATE public.cockpit_churn_departures
         SET survey_response_id = coalesce(survey_response_id, r.id), survey_state = 'filled',
             updated_by = 'the cockpit', updated_at = now()
       WHERE id = v_dep AND (survey_state IS DISTINCT FROM 'filled' OR survey_response_id IS NULL);
    END IF;
  END IF;
END $$;
COMMENT ON FUNCTION public.cockpit_form_hook_exit_survey(uuid) IS
  'Submit hook of exit_survey (contract 4.4.3): queues termination.notice (dedupe termination:<id>) and termination.submitted (termination-sub:<id>), inserts one system billing event of kind survey (the card comment, by_whom canary for a canary), and fills the open departure''s survey. Never a card field. (20261102b)';

-- ---------------------------------------------------------------------------
-- 4. The nine replaced functions (contract 2.2), each the live body with its
--    change and nothing else.


CREATE OR REPLACE FUNCTION public.cockpit_form_responses_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  -- Waves 1-2: carve-outs for a stored termination survey or pause
  -- request (state legacy), each only under its transaction-local
  -- setting: a person's match to a card (task_id from none, or off a card
  -- found only by the link's hidden id, set by cockpit_form_legacy_match),
  -- a person's word that such a card is right (answer_meta.match from
  -- hidden_id_unverified to confirmed_by_person with answer_meta.matched,
  -- once, by the match or 20261101o's churn confirm), and the one answer to
  -- its notice (answer_meta.answered, added once, by 20261101o's notice answer).
  v_legacy boolean := OLD.state = 'legacy' AND OLD.form_key IN ('exit_survey','pause_request');
  -- Waves 3-4 (20261102b): a client's own exit survey or pause consent from the
  -- portal or the link (state submitted) takes the same one answer to its notice.
  v_native boolean := OLD.state = 'submitted' AND OLD.form_key IN ('exit_survey','pause_consent');
  v_setting text := coalesce(current_setting('cockpit.forms_legacy', true), '');
  v_unverified boolean := coalesce(OLD.answer_meta->>'match', '') = 'hidden_id_unverified';
  v_match boolean := false;
  v_mark boolean := false;
  v_answer boolean := false;
BEGIN
  v_mark := v_legacy AND v_setting IN ('match','confirm') AND v_unverified
            AND NOT (OLD.answer_meta ? 'matched')
            AND coalesce(NEW.answer_meta->>'match', '') = 'confirmed_by_person'
            AND jsonb_typeof(NEW.answer_meta->'matched') = 'object'
            AND (NEW.answer_meta - 'match' - 'matched') = (OLD.answer_meta - 'match');
  -- A card moves only with the person's mark in the same write.
  v_match := v_legacy AND v_setting = 'match' AND NEW.task_id IS NOT NULL
             AND (OLD.task_id IS NULL OR v_mark);
  v_answer := (v_legacy OR v_native) AND v_setting = 'answer'
              AND NOT (OLD.answer_meta ? 'answered') AND jsonb_typeof(NEW.answer_meta->'answered') = 'object'
              AND (NEW.answer_meta - 'answered') = OLD.answer_meta;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.form_key IS DISTINCT FROM OLD.form_key
     OR NEW.form_version IS DISTINCT FROM OLD.form_version OR NEW.source IS DISTINCT FROM OLD.source
     OR (NEW.task_id IS DISTINCT FROM OLD.task_id AND NOT v_match) OR NEW.mode IS DISTINCT FROM OLD.mode
     OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'A response keeps its form, version, source, card, mode, seat and creation time' USING ERRCODE = '55000';
  END IF;
  IF OLD.state <> 'draft' AND (NEW.answers IS DISTINCT FROM OLD.answers
                              OR (NEW.answer_meta IS DISTINCT FROM OLD.answer_meta AND NOT (v_answer OR v_mark))) THEN
    RAISE EXCEPTION 'Sent notes keep their answers' USING ERRCODE = '55000';
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
       (OLD.state = 'draft' AND NEW.state IN ('submitted','void'))
    OR (OLD.state = 'submitted' AND NEW.state = 'confirmed')) THEN
    RAISE EXCEPTION 'A response goes from % to % only through the cockpit', OLD.state, NEW.state USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_billing_writeback_writes(p_kind text, p_from text, p_to text, p_detail jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
 d jsonb:=CASE WHEN jsonb_typeof(p_detail)='object' THEN p_detail ELSE '{}'::jsonb END;
 w jsonb:='[]'::jsonb;
 num text:='^-?[0-9]+(\.[0-9]+)?$';
 v_reason text;
BEGIN
 CASE p_kind
 WHEN 'method' THEN w:=jsonb_build_array(jsonb_build_object('field','method','value',p_to,'old',p_from));
 WHEN 'plan' THEN w:=jsonb_build_array(jsonb_build_object('field','plan','value',p_to,'old',p_from));
 WHEN 'amount' THEN w:=jsonb_build_array(jsonb_build_object('field','nextAmount',
   'value',CASE WHEN p_to~num THEN p_to::numeric END,'old',CASE WHEN p_from~num THEN p_from::numeric END));
 WHEN 'date' THEN w:=jsonb_build_array(jsonb_build_object('field','nextDate','value',p_to,'old',p_from));
 WHEN 'extension' THEN
  -- A system clear carries weeks 0 and no moved date: the field goes back to 0.
  w:=jsonb_build_array(jsonb_build_object('field','extension','value',CASE WHEN d->>'weeks'~num THEN (d->>'weeks')::numeric END));
  IF d->'movedDate'='true'::jsonb THEN
   w:=w||jsonb_build_object('field','nextDate','value',coalesce(p_to,d->>'new_date'),'old',p_from);
  END IF;
  IF jsonb_typeof(d->'at_risk')='boolean' THEN w:=w||jsonb_build_object('field','willNotContinue','value',d->'at_risk'); END IF;
 WHEN 'pause' THEN
  w:=jsonb_build_array(jsonb_build_object('field','status','value','Paused','old',p_from),
                       jsonb_build_object('field','pausedOn','value',d->>'on'),
                       jsonb_build_object('field','resumeOn','value',d->>'restart'));
 WHEN 'resume' THEN
  -- Paused On is cleared, or the next pause is measured from this one (billingCore); Resume On goes with it.
  w:=jsonb_build_array(jsonb_build_object('field','status','value','Active','old',p_from),
                       jsonb_build_object('field','pausedOn','value',NULL,'clear',true),
                       jsonb_build_object('field','resumeOn','value',NULL,'clear',true));
  IF d->>'nextDate' IS NOT NULL THEN w:=w||jsonb_build_object('field','nextDate','value',d->>'nextDate'); END IF;
 WHEN 'payment' THEN
  IF p_to IS NOT NULL AND p_to IS DISTINCT FROM p_from THEN
   w:=jsonb_build_array(jsonb_build_object('field','nextDate','value',p_to,'old',p_from));
  END IF;
 WHEN 'churn' THEN
  -- The date first: a ClickUp automation appears to date cards when Client Status moves (20261101g).
  v_reason:=CASE WHEN d ? 'card_reason' THEN d->>'card_reason' ELSE public.cockpit_churn_reason_card(d->>'reason') END;
  w:=jsonb_build_array(jsonb_build_object('field','churnDate','value',d->>'left_on'),
                       jsonb_build_object('field','status','value','Stopped','old',p_from),
                       jsonb_build_object('field','churnReason','value',v_reason),
                       jsonb_build_object('field','churnType','value',d->>'card_type'));
  IF d->'clear_paused'='true'::jsonb THEN w:=w||jsonb_build_object('field','pausedOn','value',NULL,'clear',true); END IF;
 WHEN 'mrr' THEN w:=jsonb_build_array(jsonb_build_object('field','mrr',
   'value',CASE WHEN p_to~num THEN p_to::numeric END,'old',CASE WHEN p_from~num THEN p_from::numeric END));
 WHEN 'ltv' THEN w:=jsonb_build_array(jsonb_build_object('field','ltv','value',CASE WHEN p_to~num THEN p_to::numeric END));
 -- Waves 3-4 (20261102b, contract 3.8): NPS Survey Sent is the Kuwait day the NPS invite went out.
 WHEN 'nps_sent' THEN w:=jsonb_build_array(jsonb_build_object('field','npsSent','value',d->>'on'));
 -- An exit survey changes no card field (D11): its comment is its whole write.
 WHEN 'survey' THEN NULL;
 ELSE NULL; -- late and every other kind write no field (a late close writes its comment only).
 END CASE;
 -- A value the event does not carry is not guessed; only a deliberate clear is empty.
 RETURN (SELECT coalesce(jsonb_agg(x-'clear' ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(w) WITH ORDINALITY AS t(x,n)
         WHERE x->'value'<>'null'::jsonb OR x->'clear'='true'::jsonb);
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_billing_writeback_comment(p_kind text, p_from text, p_to text, p_detail jsonb, p_client text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  d jsonb := CASE WHEN jsonb_typeof(p_detail) = 'object' THEN p_detail ELSE '{}'::jsonb END;
  l text[] := '{}';
  v_by text := CASE d->>'seat_role' WHEN 'csm' THEN 'the CSM' WHEN 'finance' THEN 'finance'
                                    WHEN 'ceo' THEN 'the CEO' WHEN 'system' THEN 'the cockpit'
                                    WHEN 'the CSM' THEN 'the CSM' WHEN 'the CEO' THEN 'the CEO'
                                    WHEN 'the cockpit' THEN 'the cockpit' END;
  v_why text := nullif(concat_ws(': ', nullif(btrim(coalesce(d->>'reason_cat', '')), ''),
                                       nullif(btrim(coalesce(d->>'reason', '')), '')), '');
  v_n integer;
  v_text text;
  v_from numeric;
  v_to numeric;
BEGIN
  CASE p_kind
  WHEN 'extension' THEN
    IF coalesce(d->>'weeks', '') !~ '^[1-9][0-9]*$' THEN RETURN NULL; END IF; -- a system clear posts nothing
    v_n := (d->>'weeks')::integer;
    v_text := coalesce(d->>'new_date', CASE WHEN d->'movedDate' = 'true'::jsonb THEN p_to END);
    l := l || ('CLIENT EXTENSION: ' || v_n || CASE WHEN v_n = 1 THEN ' week' ELSE ' weeks' END || coalesce(', to ' || v_text, ''));
    IF v_why IS NOT NULL THEN l := l || ('Why: ' || v_why); END IF;
    IF jsonb_typeof(d->'ours') = 'boolean' THEN
      l := l || ('Ours to control: ' || CASE WHEN (d->>'ours')::boolean THEN 'yes' ELSE 'no' END);
    END IF;
    IF jsonb_typeof(d->'limitations') = 'array' AND jsonb_array_length(d->'limitations') > 0 THEN
      l := l || ('Client limits: ' || (SELECT string_agg(x, ', ' ORDER BY n) FROM jsonb_array_elements_text(d->'limitations') WITH ORDINALITY AS t(x, n)));
    END IF;
    IF jsonb_typeof(d->'at_risk') = 'boolean' THEN
      l := l || ('Will not continue if billed on schedule: ' || CASE WHEN (d->>'at_risk')::boolean THEN 'yes' ELSE 'no' END);
    END IF;
    IF d ? 'call_on' OR d ? 'call_id' THEN l := l || ('Call: ' || coalesce(d->>'call_on', 'logged in the cockpit'));
    ELSIF d ? 'no_call_reason' THEN l := l || ('No call: ' || (d->>'no_call_reason'));
    END IF;
  WHEN 'pause' THEN
    l := l || ('PAUSE AGREED ' || coalesce(d->>'on', 'today') || ' to ' || coalesce(d->>'restart', 'no restart date'));
    IF d ? 'pause_kind' THEN
      l := l || ('Kind: ' || CASE d->>'pause_kind' WHEN 'non_payment' THEN 'non-payment' ELSE 'client request' END);
    END IF;
    IF v_why IS NOT NULL THEN l := l || ('Why: ' || v_why); END IF;
    IF d->'consent'->>'kind' = 'call' THEN
      l := l || ('Consent: on the call ' || coalesce(d->>'call_on', 'logged in the cockpit'));
    -- Waves 3-4 (20261102b): the client's own signed consent; the day only, never a name or an address.
    ELSIF d->'consent'->>'kind' = 'signed' THEN
      l := l || ('Consent: signed ' || CASE d->'consent'->>'via' WHEN 'link' THEN 'by link' ELSE 'in the portal' END
                 || coalesce(' ' || nullif(left(coalesce(d->'consent'->>'signed_at', ''), 10), ''), ''));
    ELSIF d->'consent'->>'kind' IS NOT NULL THEN
      l := l || ('Consent: ' || (d->'consent'->>'kind'));
    END IF;
  WHEN 'resume' THEN
    l := l || ('RESUMED ' || coalesce(d->>'on', 'today'));
    IF d ? 'nextDate' THEN l := l || ('Next payment: ' || (d->>'nextDate')); END IF;
  WHEN 'churn' THEN
    l := l || ('CHURN CONFIRMED: left ' || coalesce(d->>'left_on', 'on a day not recorded'));
    IF d ? 'reason' THEN
      l := l || ('Reason: ' || (d->>'reason'));
      -- No write reaches the field in either case, so the card keeps whatever reason it holds.
      IF lower(btrim(d->>'reason')) = 'other' THEN
        l := l || 'Reason Other: the card''s Churn Reason is left as it is.'::text;
      ELSIF d ? 'card_reason' AND d->>'card_reason' IS NULL THEN
        l := l || 'Not on the card''s list, so the card''s Churn Reason is left as it is.'::text;
      END IF;
    END IF;
    IF coalesce(d->>'card_type', d->>'churn_type') IS NOT NULL THEN
      l := l || ('Type: ' || coalesce(d->>'card_type', d->>'churn_type'));
    END IF;
    IF d ? 'why_detail' THEN l := l || ('Why: ' || (d->>'why_detail')); END IF;
    IF d ? 'notice_on' THEN l := l || ('Notice on: ' || (d->>'notice_on')); END IF;
    IF d ? 'survey_state' THEN
      l := l || ('Exit survey: ' || CASE d->>'survey_state' WHEN 'not_sent' THEN 'not sent' WHEN 'filled' THEN 'filled in'
                                                              ELSE d->>'survey_state' END);
    END IF;
  WHEN 'mrr' THEN
    v_from := CASE WHEN p_from ~ '^-?[0-9]+(\.[0-9]+)?$' THEN p_from::numeric END;
    v_to := CASE WHEN p_to ~ '^-?[0-9]+(\.[0-9]+)?$' THEN p_to::numeric END;
    IF v_to IS NULL THEN RETURN NULL; END IF;
    l := l || ('MRR '
      || coalesce('$' || to_char(v_from, CASE WHEN v_from = trunc(v_from) THEN 'FM999,999,990' ELSE 'FM999,999,990.00' END), 'none')
      || ' → $' || to_char(v_to, CASE WHEN v_to = trunc(v_to) THEN 'FM999,999,990' ELSE 'FM999,999,990.00' END)
      || coalesce(' from ' || (d->>'effective'), ''));
    IF v_why IS NOT NULL THEN l := l || ('Why: ' || v_why); END IF;
  WHEN 'survey' THEN
    -- The exit survey's answer on the card (contract 3.8): reasons, the three
    -- ratings, the recommend score and the two typed answers (each at most 300
    -- characters, cut by the detail builder). No name, no address, no field.
    l := l || ('CONTRACT TERMINATION SURVEY (notice received ' || coalesce(d->>'notice_on', 'on a day not recorded') || ')');
    l := l || ('Why: ' || coalesce((SELECT string_agg(CASE x WHEN 'results' THEN 'The results'
                                                              WHEN 'company_changes' THEN 'Changes in their company'
                                                              WHEN 'cheaper_provider' THEN 'A cheaper provider'
                                                              WHEN 'in_house' THEN 'Moving it in-house'
                                                              WHEN 'other' THEN 'Something else'
                                                              ELSE x END, ', ' ORDER BY n)
                                      FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(d->'reasons') = 'array'
                                                                          THEN d->'reasons' ELSE '[]'::jsonb END) WITH ORDINALITY AS t(x, n)),
                                    'not said'));
    l := l || ('Ads ' || coalesce((d->'ratings'->>'ads') || '/10', 'not rated')
               || ' · The people who reached them ' || coalesce((d->'ratings'->>'people') || '/10', 'not rated')
               || ' · Communication ' || coalesce((d->'ratings'->>'comms') || '/10', 'not rated'));
    l := l || ('Would recommend: ' || coalesce((d->>'recommend') || '/10', 'not said'));
    l := l || ('What would have kept them: ' || coalesce(nullif(btrim(coalesce(d->>'kept_us', '')), ''), 'not said'));
    l := l || ('Comments: ' || coalesce(nullif(btrim(coalesce(d->>'comments', '')), ''), 'none'));
    l := l || ('Filled: ' || CASE d->>'via' WHEN 'portal' THEN 'in the portal' WHEN 'link' THEN 'by link' ELSE 'not recorded' END);
    l := l || 'Confirm the churn or answer the notice in the cockpit.'::text;
    RETURN array_to_string(l, E'\n');
  WHEN 'late' THEN
    IF NOT d ? 'closes' OR coalesce(d->>'days_late', '') !~ '^[0-9]+$' THEN RETURN NULL; END IF; -- an open spell posts nothing
    v_n := (d->>'days_late')::integer;
    RETURN 'LATE ' || v_n || CASE WHEN v_n = 1 THEN ' day' ELSE ' days' END || coalesce(': due ' || (d->>'due'), '') || ', '
      || CASE WHEN d ? 'paid_on' THEN 'paid ' || (d->>'paid_on')
              WHEN d->>'closed_how' = 'extended' THEN 'extension moved the date'
              WHEN d->>'closed_how' = 'stopped' THEN 'client stopped'
              ELSE 'the date moved on the card' END;
  ELSE
    RETURN NULL; -- method, plan, amount, date, payment, note and nps_sent post no comment (a note is its own comment)
  END CASE;
  IF v_by IS NOT NULL THEN l := l || ('By: ' || v_by); END IF;
  RETURN array_to_string(l, E'\n');
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_billing_detail(p_kind text, p_args jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  a jsonb := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  v_seat text := nullif(btrim(coalesce(a->>'seatRole', '')), '');
  d jsonb;
  v_extra jsonb := '{}'::jsonb;
  k text;
  v_type text;
BEGIN
  IF v_seat IS NOT NULL AND v_seat NOT IN ('csm', 'finance', 'ceo', 'system') THEN
    RAISE EXCEPTION 'A billing change comes from the CSM, finance, the CEO or the cockpit, not %.', v_seat USING ERRCODE = '22023';
  END IF;
  d := jsonb_build_object('request_id', a->'requestId', 'response_id', a->'responseId', 'seat_role', v_seat);
  CASE p_kind
  WHEN 'extension' THEN
    IF a->'system' = 'true'::jsonb THEN
      d := d || jsonb_build_object('weeks', 0, 'reason', 'grant ended', 'grant_id', a->'grantId');
    ELSE
      IF coalesce(a->>'weeks', '') NOT IN ('1', '2', '4') THEN
        RAISE EXCEPTION 'Give 1, 2 or 4 weeks.' USING ERRCODE = '22023';
      END IF;
      d := d || jsonb_build_object(
        'weeks', (a->>'weeks')::integer,
        'ours', CASE WHEN jsonb_typeof(a->'ours') = 'boolean' THEN a->'ours' END,
        -- Extend always moves the date (W13).
        'movedDate', CASE WHEN jsonb_typeof(a->'movedDate') = 'boolean' THEN a->'movedDate' ELSE 'true'::jsonb END,
        'new_date', a->>'newDate', 'from', a->>'from',
        'reason_cat', a->>'reasonCat', 'reason', a->>'reason',
        'limitations', CASE WHEN jsonb_typeof(a->'limitations') = 'array' AND jsonb_array_length(a->'limitations') > 0 THEN a->'limitations' END,
        'at_risk', CASE WHEN jsonb_typeof(a->'atRisk') = 'boolean' THEN a->'atRisk' END,
        'call_id', a->>'callId', 'call_on', a->>'callOn', 'no_call_reason', a->>'noCallReason',
        'prevent', a->>'prevent', 'replaces_grant_id', a->'replacesGrantId');
    END IF;
  WHEN 'pause' THEN
    IF coalesce(a->>'pauseKind', 'client_request') NOT IN ('client_request', 'non_payment') THEN
      RAISE EXCEPTION 'A pause is a client request or non-payment.' USING ERRCODE = '22023';
    END IF;
    d := d || jsonb_build_object(
      'pause_kind', a->>'pauseKind', 'on', a->>'on', 'restart', a->>'restart',
      'reason_cat', a->>'reasonCat', 'reason', a->>'reason',
      'call_id', a->>'callId', 'call_on', a->>'callOn',
      'consent', CASE WHEN jsonb_typeof(a->'consent') = 'object' THEN jsonb_strip_nulls(jsonb_build_object(
                   'kind', a->'consent'->>'kind', 'call_id', a->'consent'->>'call_id', 'evidence_url', a->'consent'->>'evidence_url',
                   -- Waves 3-4 (20261102b): a signed consent names its response, when and how it was signed.
                   'response_id', a->'consent'->>'response_id', 'signed_at', a->'consent'->>'signed_at',
                   'via', CASE WHEN a->'consent'->>'via' IN ('portal', 'link') THEN a->'consent'->>'via' END,
                   'term_runs', CASE WHEN jsonb_typeof(a->'consent'->'term_runs') = 'boolean' THEN a->'consent'->'term_runs' END,
                   'over_14_ends', CASE WHEN jsonb_typeof(a->'consent'->'over_14_ends') = 'boolean' THEN a->'consent'->'over_14_ends' END)) END);
  WHEN 'resume' THEN
    d := d || jsonb_build_object('on', a->>'on', 'nextDate', a->>'nextDate');
  WHEN 'churn' THEN
    IF coalesce(a->>'leftOn', '') = '' THEN
      RAISE EXCEPTION 'Pick the day they left, today or before.' USING ERRCODE = '22023';
    END IF;
    v_type := CASE a->>'churnType' WHEN 'mid_programme' THEN 'mid_programme' WHEN 'completed' THEN 'completed' END;
    d := d || jsonb_build_object(
      'left_on', a->>'leftOn', 'reason', a->>'reason', 'churn_type', v_type,
      -- The card's own option names (the churn-confirm file's cockpit_churn_type_card says the same).
      'card_type', CASE v_type WHEN 'mid_programme' THEN 'Mid-programme loss (counts as churn)'
                               WHEN 'completed' THEN 'Completed term (does NOT count as churn)' END,
      'clear_paused', CASE WHEN jsonb_typeof(a->'clearPaused') = 'boolean' THEN a->'clearPaused' END,
      'departure_id', a->'departureId', 'why_detail', a->>'whyDetail', 'notice_on', a->>'noticeOn',
      'survey_state', a->>'surveyState', 'exit_call_id', a->>'exitCallId');
    v_extra := jsonb_build_object('card_reason', public.cockpit_churn_reason_card(a->>'reason'));
  WHEN 'mrr' THEN
    IF coalesce(a->>'to', '') !~ '^[0-9]+(\.[0-9]+)?$' THEN
      RAISE EXCEPTION 'Set MRR to a dollar amount of 0 or more.' USING ERRCODE = '22023';
    END IF;
    d := d || jsonb_build_object(
      'from', CASE WHEN a->>'from' ~ '^[0-9]+(\.[0-9]+)?$' THEN (a->>'from')::numeric END, 'to', (a->>'to')::numeric,
      'reason_cat', a->>'reasonCat', 'reason', a->>'reason', 'effective', a->>'effective', 'win_id', a->'winId');
  WHEN 'ltv' THEN
    d := d || jsonb_build_object('sum', a->'sum', 'rows', a->'rows', 'as_of', a->>'asOf');
  WHEN 'late' THEN
    IF a ? 'closes' THEN
      IF coalesce(a->>'closedHow', '') NOT IN ('extended', 'stopped', 'date_moved') THEN
        RAISE EXCEPTION 'A late spell closes as extended, stopped or date_moved.' USING ERRCODE = '22023';
      END IF;
      d := d || jsonb_build_object('closes', a->'closes', 'due', a->>'due', 'days_late', a->'daysLate',
                                   'paid_on', a->>'paidOn', 'closed_how', a->>'closedHow');
    ELSE
      d := d || jsonb_build_object('due', a->>'due', 'spell_day', a->'spellDay', 'amount_usd', a->'amountUsd');
    END IF;
  WHEN 'survey' THEN
    -- The exit survey's answer (contract 3.8): option values, whole-number ratings, typed answers cut to 300.
    d := d || jsonb_build_object(
      'form_key', 'exit_survey', 'invite_id', a->>'inviteId', 'notice_on', a->>'noticeOn',
      'reasons', (SELECT jsonb_agg(x ORDER BY n) FROM jsonb_array_elements_text(
                    CASE WHEN jsonb_typeof(a->'reasons') = 'array' THEN a->'reasons' ELSE '[]'::jsonb END) WITH ORDINALITY AS t(x, n)
                   WHERE x ~ '^[a-z][a-z0-9_]{1,30}$'),
      'ratings', nullif(jsonb_strip_nulls(jsonb_build_object(
                   'ads', CASE WHEN a->'ratings'->>'ads' ~ '^([0-9]|10)$' THEN (a->'ratings'->>'ads')::integer END,
                   'people', CASE WHEN a->'ratings'->>'people' ~ '^([0-9]|10)$' THEN (a->'ratings'->>'people')::integer END,
                   'comms', CASE WHEN a->'ratings'->>'comms' ~ '^([0-9]|10)$' THEN (a->'ratings'->>'comms')::integer END)), '{}'::jsonb),
      'recommend', CASE WHEN a->>'recommend' ~ '^([0-9]|10)$' THEN (a->>'recommend')::integer END,
      'kept_us', nullif(left(btrim(regexp_replace(coalesce(a->>'keptUs', ''), '\s+', ' ', 'g')), 300), ''),
      'comments', nullif(left(btrim(regexp_replace(coalesce(a->>'comments', ''), '\s+', ' ', 'g')), 300), ''),
      'via', CASE WHEN a->>'via' IN ('portal', 'link') THEN a->>'via' END);
  WHEN 'nps_sent' THEN
    IF coalesce(a->>'on', '') = '' THEN
      RAISE EXCEPTION 'An NPS sent event needs the day it went out (YYYY-MM-DD).' USING ERRCODE = '22023';
    END IF;
    d := d || jsonb_build_object('invite_id', a->>'inviteId', 'on', a->>'on',
      'round', CASE WHEN a->>'round' ~ '^[1-9][0-9]{0,3}$' THEN (a->>'round')::integer END);
  WHEN 'date', 'payment', 'method', 'plan', 'amount', 'note' THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'No billing detail is defined for kind %.', coalesce(p_kind, 'null') USING ERRCODE = '22023';
  END CASE;
  d := jsonb_strip_nulls(d);
  -- Every day is a real day, written as ClickUp's date fields take it.
  FOREACH k IN ARRAY ARRAY['new_date', 'from', 'on', 'restart', 'left_on', 'notice_on', 'effective', 'due', 'paid_on',
                           'as_of', 'nextDate', 'call_on'] LOOP
    IF jsonb_typeof(d->k) = 'string' AND (CASE WHEN d->>k !~ '^\d{4}-\d{2}-\d{2}$' THEN true
                                               ELSE to_char((d->>k)::date, 'YYYY-MM-DD') <> d->>k END) THEN
      RAISE EXCEPTION 'That is not a day (YYYY-MM-DD): %.', d->>k USING ERRCODE = '22023';
    END IF;
  END LOOP;
  RETURN d || v_extra;
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_billing_canary(p_kind text, p_args jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  a jsonb := CASE WHEN jsonb_typeof(p_args) = 'object' THEN p_args ELSE '{}'::jsonb END;
  v_task text := coalesce(nullif(btrim(coalesce(a->>'taskId', '')), ''), '86eywg1cq');
  v_system boolean := coalesce(a->'system' = 'true'::jsonb, false);
  v_detail jsonb;
  v_from text;
  v_to text;
  v_id bigint;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'The canary runs only through the deploy connection.' USING ERRCODE = '42501';
  END IF;
  IF v_task <> '86eywg1cq' THEN
    RAISE EXCEPTION 'The canary writes only the test card 86eywg1cq.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_kind, '') NOT IN ('churn', 'extension', 'pause', 'resume', 'mrr', 'late', 'date', 'survey', 'nps_sent') THEN
    RAISE EXCEPTION 'The canary takes churn, extension, pause, resume, mrr, late, date, survey or nps_sent.' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'late' AND NOT v_system THEN
    RAISE EXCEPTION 'A late event comes from the cockpit itself: send system true.' USING ERRCODE = '22023';
  END IF;
  -- Waves 3-4 (20261102b): an exit survey comment and NPS Survey Sent come from the cockpit itself.
  IF p_kind IN ('survey', 'nps_sent') AND NOT v_system THEN
    RAISE EXCEPTION 'A survey or NPS sent event comes from the cockpit itself: send system true.' USING ERRCODE = '22023';
  END IF;
  IF v_system AND p_kind NOT IN ('extension', 'late', 'survey', 'nps_sent') THEN
    RAISE EXCEPTION 'Only an extension clear, a late event, a survey or NPS sent comes from the cockpit itself.' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'nps_sent' AND coalesce(a->>'on', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'An NPS sent canary needs the day in on (YYYY-MM-DD).' USING ERRCODE = '22023';
  END IF;
  v_detail := public.cockpit_billing_detail(p_kind,
    a || jsonb_build_object('seatRole', coalesce(nullif(a->>'seatRole', ''), CASE WHEN v_system THEN 'system' ELSE 'ceo' END)));
  v_from := nullif(a->>'from', '');
  v_to := CASE p_kind
    WHEN 'churn' THEN 'Stopped' WHEN 'pause' THEN 'Paused' WHEN 'resume' THEN 'Active'
    WHEN 'extension' THEN CASE WHEN v_system THEN NULL ELSE coalesce(nullif(a->>'newDate', ''), nullif(a->>'to', '')) END
    WHEN 'late' THEN NULL
    WHEN 'survey' THEN NULL WHEN 'nps_sent' THEN NULL
    ELSE nullif(a->>'to', '') END;
  IF p_kind = 'date' AND coalesce(v_to, '') !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'A date canary needs the new day in to (YYYY-MM-DD).' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'extension' AND NOT v_system AND v_to IS NULL THEN
    RAISE EXCEPTION 'An extension canary needs the new day in newDate (YYYY-MM-DD).' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
  VALUES (v_task, 'Test card (canary)', p_kind, v_from, v_to,
          coalesce(nullif(a->>'reason', ''), 'Canary on the test card'), v_detail,
          CASE WHEN v_system THEN 'system' ELSE 'ceo' END, 'canary')
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_billing_write(p_action text, p_args jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_who text;
  v_ceo boolean;
  v_source text;
  v_app text;
  v_task text;
  v_acc public.cockpit_billing_accounts;
  v_next public.cockpit_billing_accounts;
  v_edit jsonb;
  v_kind text;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_day date;
  v_value numeric;
  v_text text;
  v_weeks integer;
  v_moved boolean := false;
  v_from text; v_to text; v_reason text; v_detail jsonb;
  v_event bigint;
  v_inbox public.cockpit_billing_inbox;
  v_ledger text;
  v_amount numeric; v_currency text; v_rail text; v_evidence text; v_ref text; v_note text; v_next_day date;
  v_payer text; v_mapped jsonb; v_usd numeric; v_count integer; v_name text;
  -- The staff forms (20261101p).
  v_req text; v_request uuid; v_first public.cockpit_billing_events; v_staff boolean := false;
  v_role text; v_answers jsonb; v_response uuid; v_message text; v_notice text; v_facts jsonb;
  v_grant record; v_replaces bigint; v_base date; v_call text; v_ours boolean; v_risk boolean;
  v_limits jsonb; v_lim text; v_pkind text; v_restart date; v_cat text; v_consent jsonb; v_term boolean; v_over boolean;
  v_effective date; v_old_mrr numeric; v_legacy boolean := false;
  -- The client's signed pause consent (20261102b).
  v_signed jsonb; v_signed_id text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in before changing billing.' USING ERRCODE='42501'; END IF;
  v_ceo := coalesce(public.cockpit_is_ceo(), false);
  IF NOT (v_ceo OR coalesce(public.cockpit_has_role('csm'), false) OR coalesce(public.cockpit_has_role('finance'), false)) THEN
    RAISE EXCEPTION 'Billing changes need a client success, finance or CEO seat. Ask an admin to add the role.' USING ERRCODE='42501';
  END IF;
  SELECT lower(btrim(au.email)) INTO v_who FROM auth.users au WHERE au.id = v_uid;
  IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' OR octet_length(p_args::text) > 20000 THEN
    RAISE EXCEPTION 'That billing change could not be read. Reload the page and try again.' USING ERRCODE='22023';
  END IF;
  v_source := coalesce(nullif(p_args->>'source', ''), CASE WHEN v_ceo THEN 'ceo' ELSE 'csm' END);
  IF v_source NOT IN ('ceo', 'csm') THEN RAISE EXCEPTION 'That billing change came from an unknown cockpit.' USING ERRCODE='22023'; END IF;
  IF v_source = 'ceo' AND NOT v_ceo THEN
    RAISE EXCEPTION '%', CASE WHEN p_action = 'assign' THEN 'Only the CEO can tie money to a client.'
                              ELSE 'Only the CEO can make a change from the CEO cockpit.' END USING ERRCODE='42501';
  END IF;
  v_app := CASE v_source WHEN 'ceo' THEN 'media-buyer-cockpit' ELSE 'client-success-cockpit' END;
  v_task := btrim(coalesce(p_args->>'taskId', ''));
  IF v_task !~ '^[A-Za-z0-9_-]{1,40}$' THEN RAISE EXCEPTION 'That is not a ClickUp card id.' USING ERRCODE='22023'; END IF;

  -- Money nobody had tied to a client: the payer mapping, then the log line.
  IF p_action = 'assign' THEN
    IF NOT v_ceo THEN RAISE EXCEPTION 'Only the CEO can tie money to a client.' USING ERRCODE='42501'; END IF;
    v_payer := btrim(coalesce(p_args->>'payer', ''));
    IF v_payer = '' OR length(v_payer) > 200 THEN RAISE EXCEPTION 'Choose a payer name up to 200 characters.' USING ERRCODE='22023'; END IF;
    -- payers.assign checks the card's billing is fresh, maps the payer, audits it and marks finance for a refresh.
    v_mapped := public.cockpit_ceo_action('payers.assign', jsonb_build_object('payer', v_payer, 'clickupTaskId', v_task));
    SELECT client_name INTO v_name FROM public.cockpit_billing_accounts WHERE clickup_task_id = v_task;
    v_name := coalesce(v_name, v_mapped->>'client', nullif(btrim(p_args->>'clientName'), ''), v_task);
    v_usd := CASE WHEN jsonb_typeof(p_args->'usd') = 'number' THEN round((p_args->>'usd')::numeric, 2) END;
    v_count := CASE WHEN jsonb_typeof(p_args->'count') = 'number' THEN floor((p_args->>'count')::numeric)::integer END;
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (v_task, v_name, 'assign', NULL, v_payer,
      CASE WHEN v_usd IS NOT NULL AND v_count IS NOT NULL THEN
        format('%s %s from %s, $%s, tied to %s. They count as %s''s money from the next refresh; LTV adds only those from 19 Sep on.',
          v_count, CASE WHEN v_count = 1 THEN 'payment' ELSE 'payments' END, v_payer,
          regexp_replace(to_char(v_usd, 'FM999,999,990.00'), '\.?0+$', ''), v_name, v_name)
      ELSE format('Payments from %s tied to %s. They count as %s''s money from the next refresh.', v_payer, v_name, v_name) END,
      jsonb_build_object('payer', v_payer, 'usd', v_usd, 'count', v_count), 'ceo', v_who)
    RETURNING id INTO v_event;
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('billing.assign', 'cockpit_billing_events', v_event::text, v_who, v_app, 'supabase', NULL,
            (SELECT to_jsonb(e) FROM public.cockpit_billing_events e WHERE e.id = v_event), jsonb_build_object('mapping', v_mapped));
    RETURN jsonb_build_object('ok', true, 'client', v_name, 'eventId', v_event);
  END IF;

  SELECT * INTO v_acc FROM public.cockpit_billing_accounts WHERE clickup_task_id = v_task FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That client card is not on the billing sheet. Refresh the page and pick it again.' USING ERRCODE='P0002';
  END IF;
  IF NOT v_ceo AND NOT coalesce(public.cockpit_client_allowed(v_acc.client_name), false) THEN
    RAISE EXCEPTION '% is not one of your clients in the portal, so its billing is not yours to change.', v_acc.client_name USING ERRCODE='42501';
  END IF;
  v_next := v_acc;

  IF p_action = 'edit' THEN
    -- The staff forms send their answers flat ({kind, weeks, ...}); the
    -- billing sheet's older tabs send them under "edit". Both read the same.
    v_edit := CASE WHEN jsonb_typeof(p_args->'edit') = 'object' THEN p_args->'edit'
                   WHEN p_args ? 'kind' THEN p_args - 'taskId' - 'source' - 'requestId' END;
    IF jsonb_typeof(v_edit) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Say what to change.' USING ERRCODE='22023'; END IF;
    v_kind := coalesce(v_edit->>'kind', '');

    -- One request, one change: a repeat (a double press, a retry after a
    -- dropped connection) returns what the first one did and writes nothing.
    v_req := nullif(btrim(coalesce(p_args->>'requestId', v_edit->>'requestId', '')), '');
    IF v_req IS NOT NULL AND v_req !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RAISE EXCEPTION 'That change could not be read. Reload the page and try again.' USING ERRCODE='22023';
    END IF;
    -- The billing sheet live before the staff forms sends {kind:'extension',
    -- weeks, reason, ours, moveDate}, {kind:'pause', reason} and {kind:'resume',
    -- nextDate} under "edit", with no requestId. Those keep the 20261009a rules
    -- unchanged until the new sheet ships, and after a rollback of it. A
    -- requestId or any staff-form key makes it the staff form, every field required.
    v_legacy := jsonb_typeof(p_args->'edit') = 'object' AND v_req IS NULL AND v_kind IN ('extension', 'pause', 'resume')
                AND NOT (v_edit ?| ARRAY['atRisk', 'limitations', 'callId', 'noCall', 'noCallReason', 'prevent', 'replacesGrantId',
                                        'pauseKind', 'reasonCat', 'restart', 'consent', 'consentTerm', 'consentOver14']);
    v_staff := v_kind IN ('extension', 'pause', 'resume', 'mrr') AND NOT v_legacy;
    IF v_staff AND v_req IS NULL THEN
      RAISE EXCEPTION 'That form is out of date. Reload the page and send it again.' USING ERRCODE='22023';
    END IF;
    IF v_req IS NOT NULL THEN
      v_request := v_req::uuid; v_req := lower(v_req);
      SELECT * INTO v_first FROM public.cockpit_billing_events e WHERE e.detail->>'request_id' = v_req ORDER BY e.id LIMIT 1;
      IF FOUND THEN
        IF v_first.clickup_task_id IS DISTINCT FROM v_task THEN
          RAISE EXCEPTION 'That change could not be read. Reload the page and try again.' USING ERRCODE='22023';
        END IF;
        RETURN to_jsonb(v_acc) || jsonb_build_object('repeat', true, 'eventId', v_first.id,
          'responseId', v_first.detail->>'response_id', 'newDate', v_acc.next_payment_date,
          'cardState', public.cockpit_billing_card_state(v_first.id), 'message', 'Already saved.');
      END IF;
    END IF;
    v_role := public.cockpit_billing_seat_role(v_acc.client_name);

    IF v_legacy THEN
      -- The 20261009a branches, unchanged.
      CASE v_kind
      WHEN 'extension' THEN
        IF jsonb_typeof(v_edit->'weeks') IS DISTINCT FROM 'number' OR (v_edit->>'weeks') NOT IN ('1', '2', '4') THEN
          RAISE EXCEPTION 'An extension is one, two or four weeks, as on the extension form.' USING ERRCODE='22023';
        END IF;
        v_weeks := (v_edit->>'weeks')::integer;
        v_reason := public.cockpit_manual_clean_text(v_edit->>'reason', 400);
        IF coalesce(length(v_reason), 0) < 4 THEN RAISE EXCEPTION 'Say why, so the extension log reads back.' USING ERRCODE='22023'; END IF;
        v_next.extension_weeks := v_weeks;
        IF v_edit->'moveDate' = 'true'::jsonb THEN
          -- Cover runs from today or the date already set, whichever is later.
          v_next.next_payment_date := greatest(coalesce(v_acc.next_payment_date, v_today), v_today) + v_weeks * 7;
          v_moved := true;
        END IF;
        v_from := v_acc.next_payment_date::text; v_to := v_next.next_payment_date::text;
        v_detail := jsonb_build_object('weeks', v_weeks, 'ours', coalesce(v_edit->'ours' = 'true'::jsonb, false), 'movedDate', v_moved);
      WHEN 'pause' THEN
        v_reason := public.cockpit_manual_clean_text(v_edit->>'reason', 400);
        IF coalesce(length(v_reason), 0) < 4 THEN RAISE EXCEPTION 'Say why, so the pause reads back in a month.' USING ERRCODE='22023'; END IF;
        v_day := coalesce(public.cockpit_billing_day(v_edit->>'on'), v_today);
        v_next.client_status := 'Paused'; v_next.stage := 'Paused'; v_next.stage_group := 'paused'; v_next.paused_on := v_day;
        v_from := v_acc.client_status; v_to := 'Paused'; v_detail := jsonb_build_object('on', v_day);
      ELSE
        v_next.client_status := 'Active'; v_next.stage := 'Active'; v_next.stage_group := 'active'; v_next.paused_on := NULL;
        v_day := public.cockpit_billing_day(v_edit->>'nextDate');
        IF v_day IS NOT NULL THEN
          v_next.next_payment_date := v_day; v_detail := jsonb_build_object('nextDate', v_day);
        END IF;
        v_from := v_acc.client_status; v_to := 'Active';
      END CASE;
    ELSE
    CASE v_kind
    WHEN 'method' THEN
      IF coalesce(v_edit->>'value', '') NOT IN ('Card on file', 'Bank transfer', 'Tap link', 'Whop link', 'Check') THEN
        RAISE EXCEPTION 'Pick one of the payment methods on the card.' USING ERRCODE='22023';
      END IF;
      v_next.payment_method := v_edit->>'value'; v_from := v_acc.payment_method; v_to := v_edit->>'value';
    WHEN 'plan' THEN
      IF coalesce(v_edit->>'value', '') NOT IN ('Monthly', 'Split Pay (2x payments)', 'Paid in full (90 days)',
                                                 '1.0K Start / $2K Months After', 'Performance ($3k/$3k)') THEN
        RAISE EXCEPTION 'Pick one of the payment plans on the card.' USING ERRCODE='22023';
      END IF;
      v_next.payment_plan := v_edit->>'value'; v_from := v_acc.payment_plan; v_to := v_edit->>'value';
    WHEN 'amount' THEN
      IF jsonb_typeof(v_edit->'value') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'The amount has to be a real payment in dollars.' USING ERRCODE='22023';
      END IF;
      v_value := round((v_edit->>'value')::numeric, 2);
      IF NOT (v_value > 0) OR v_value > 100000 THEN
        RAISE EXCEPTION 'The amount has to be a real payment in dollars.' USING ERRCODE='22023';
      END IF;
      v_next.next_payment_usd := v_value; v_from := trim_scale(v_acc.next_payment_usd)::text; v_to := trim_scale(v_value)::text;
    WHEN 'date' THEN
      v_day := public.cockpit_billing_day(v_edit->>'value');
      IF v_day IS NULL THEN RAISE EXCEPTION 'That is not a date.' USING ERRCODE='22023'; END IF;
      IF v_day < v_today - 60 THEN
        RAISE EXCEPTION 'A payment date two months back is almost certainly a typo.' USING ERRCODE='22023';
      END IF;
      v_next.next_payment_date := v_day; v_from := v_acc.next_payment_date::text; v_to := v_day::text;
      v_reason := public.cockpit_manual_clean_text(v_edit->>'reason', 400);

    WHEN 'extension' THEN
      -- Give more time (contract 3.7, 4.7). The date always moves (W13).
      IF jsonb_typeof(v_edit->'weeks') IS DISTINCT FROM 'number' OR (v_edit->>'weeks') NOT IN ('1', '2', '4') THEN
        RAISE EXCEPTION 'An extension is one, two or four weeks.' USING ERRCODE='22023';
      END IF;
      v_weeks := (v_edit->>'weeks')::integer;
      v_reason := public.cockpit_manual_clean_text(v_edit->>'reason', 400);
      IF coalesce(length(v_reason), 0) < 4 THEN RAISE EXCEPTION 'Say why, so the extension log reads back.' USING ERRCODE='22023'; END IF;
      IF jsonb_typeof(v_edit->'ours') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION 'Say whether the delay was in or out of our control.' USING ERRCODE='22023';
      END IF;
      v_ours := (v_edit->>'ours')::boolean;
      IF jsonb_typeof(v_edit->'atRisk') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION 'Say whether they will stop if billed on schedule.' USING ERRCODE='22023';
      END IF;
      v_risk := (v_edit->>'atRisk')::boolean;
      -- The client's limits: the cockpit's own eight (W17); "No limitations" alone.
      v_limits := '[]'::jsonb;
      IF v_edit ? 'limitations' AND jsonb_typeof(v_edit->'limitations') IS DISTINCT FROM 'null' THEN
        IF jsonb_typeof(v_edit->'limitations') IS DISTINCT FROM 'array' THEN
          RAISE EXCEPTION 'Pick the client''s limits from the list.' USING ERRCODE='22023';
        END IF;
        FOR v_lim IN SELECT jsonb_array_elements_text(v_edit->'limitations') LOOP
          v_cat := public.cockpit_billing_pick(v_lim, '{"none":"No limitations","budget":"Budget","launch_slipped":"Launch slipped on their side","ad_account":"Ad account or page issue","content":"Content not ready","team_change":"Team or owner change","season":"Season or holiday","other":"Other"}'::jsonb);
          IF v_cat IS NULL THEN RAISE EXCEPTION 'Pick the client''s limits from the list.' USING ERRCODE='22023'; END IF;
          v_text := ('{"none":"No limitations","budget":"Budget","launch_slipped":"Launch slipped on their side","ad_account":"Ad account or page issue","content":"Content not ready","team_change":"Team or owner change","season":"Season or holiday","other":"Other"}'::jsonb)->>v_cat;
          IF NOT v_limits @> jsonb_build_array(v_text) THEN v_limits := v_limits || jsonb_build_array(v_text); END IF;
        END LOOP;
        IF v_limits @> '["No limitations"]'::jsonb AND jsonb_array_length(v_limits) > 1 THEN
          RAISE EXCEPTION '"No limitations" cannot be picked with another limit.' USING ERRCODE='22023';
        END IF;
      END IF;
      -- The call where it was agreed, or why there was none.
      IF coalesce(v_edit->'noCall' = 'true'::jsonb, false) THEN
        v_text := public.cockpit_manual_clean_text(v_edit->>'noCallReason', 400);
        IF coalesce(length(v_text), 0) < 4 THEN
          RAISE EXCEPTION 'Pick the call where this was agreed, or say why there was no call.' USING ERRCODE='22023';
        END IF;
        v_call := NULL;
      ELSE
        IF nullif(btrim(coalesce(v_edit->>'callId', '')), '') IS NULL THEN
          RAISE EXCEPTION 'Pick the call where this was agreed, or say why there was no call.' USING ERRCODE='22023';
        END IF;
        v_call := public.cockpit_billing_call_ok(v_task, v_edit->>'callId');
        IF v_call IS NULL THEN RAISE EXCEPTION 'That call is not on this client''s record. Pick one from the list.' USING ERRCODE='22023'; END IF;
        v_text := NULL;
      END IF;
      v_note := public.cockpit_manual_clean_text(v_edit->>'prevent', 400);
      -- One live grant per card, extended by replacement (W23).
      SELECT x.grant_id, x.until INTO v_grant FROM public.cockpit_extensions_v x
       WHERE x.clickup_task_id = v_task AND x.state = 'live' ORDER BY x.grant_id DESC LIMIT 1;
      v_replaces := CASE WHEN v_edit->>'replacesGrantId' ~ '^[0-9]{1,18}$' THEN (v_edit->>'replacesGrantId')::bigint END;
      IF v_grant.grant_id IS NOT NULL AND v_replaces IS NULL THEN
        RAISE EXCEPTION 'An extension already runs to %. Open Give more time again to add weeks to it.',
          public.cockpit_billing_day_words(v_grant.until) USING ERRCODE='22023';
      END IF;
      IF v_replaces IS NOT NULL AND v_replaces IS DISTINCT FROM v_grant.grant_id THEN
        RAISE EXCEPTION 'That extension has ended or changed since the form opened. Close it and open Give more time again.' USING ERRCODE='22023';
      END IF;
      -- From the later of the card's date (already moved by a live grant) and today.
      v_base := greatest(coalesce(v_acc.next_payment_date, v_today), v_today);
      v_next.next_payment_date := v_base + v_weeks * 7;
      v_next.extension_weeks := v_weeks;
      v_moved := true;
      v_from := v_acc.next_payment_date::text; v_to := v_next.next_payment_date::text;
      v_answers := jsonb_strip_nulls(jsonb_build_object('weeks', v_weeks, 'reason', v_reason, 'ours', v_ours,
        'limitations', v_limits, 'atRisk', v_risk, 'callId', v_call, 'noCall', CASE WHEN v_call IS NULL THEN true END,
        'noCallReason', v_text, 'prevent', v_note, 'replacesGrantId', v_replaces));
      v_detail := jsonb_strip_nulls(jsonb_build_object('weeks', v_weeks, 'ours', v_ours, 'movedDate', true,
        'new_date', v_next.next_payment_date, 'from', v_base, 'limitations', v_limits, 'at_risk', v_risk,
        'call_id', v_call, 'no_call_reason', v_text, 'prevent', v_note, 'replaces_grant_id', v_replaces,
        'request_id', v_req, 'seat_role', v_role));
      v_message := format('Given: %s %s to %s', v_weeks, CASE WHEN v_weeks = 1 THEN 'week' ELSE 'weeks' END,
                          public.cockpit_billing_day_words(v_next.next_payment_date));
      v_notice := 'extension.granted';
      v_facts := jsonb_build_object('weeks', v_weeks, 'until', v_next.next_payment_date);

    WHEN 'pause' THEN
      -- Pause this client (contract 3.5, 4.8). Starts today (W11).
      IF v_acc.client_status = 'Paused' THEN
        RAISE EXCEPTION 'This client is already paused. Resume them first.' USING ERRCODE='22023';
      END IF;
      v_pkind := public.cockpit_billing_pick(v_edit->>'pauseKind', '{"client_request":"client request","non_payment":"non-payment"}'::jsonb);
      IF v_pkind IS NULL THEN RAISE EXCEPTION 'Say whether the client asked or is not paying.' USING ERRCODE='22023'; END IF;
      v_cat := public.cockpit_billing_pick(v_edit->>'reasonCat',
        '{"client_asked":"Client asked","not_paying":"Not paying","launch_slipped":"Client''s own launch slipped","seasonal":"Seasonal","other":"Other"}'::jsonb);
      IF v_cat IS NULL THEN RAISE EXCEPTION 'Pick why they pause.' USING ERRCODE='22023'; END IF;
      v_reason := public.cockpit_manual_clean_text(v_edit->>'reason', 400);
      IF coalesce(length(v_reason), 0) < 4 THEN RAISE EXCEPTION 'Say why, so the pause reads back in a month.' USING ERRCODE='22023'; END IF;
      v_restart := public.cockpit_billing_day(v_edit->>'restart');
      IF nullif(btrim(coalesce(v_edit->>'restart', '')), '') IS NOT NULL AND v_restart IS NULL THEN
        RAISE EXCEPTION 'That restart day is not a date.' USING ERRCODE='22023';
      END IF;
      IF v_restart IS NOT NULL AND v_restart <= v_today THEN
        RAISE EXCEPTION 'Pick the restart day, after today.' USING ERRCODE='22023';
      END IF;
      v_call := NULL;
      IF nullif(btrim(coalesce(v_edit->>'callId', '')), '') IS NOT NULL THEN
        v_call := public.cockpit_billing_call_ok(v_task, v_edit->>'callId');
        IF v_call IS NULL THEN RAISE EXCEPTION 'That call is not on this client''s record. Pick one from the list.' USING ERRCODE='22023'; END IF;
      END IF;
      v_consent := NULL;
      IF v_pkind = 'client_request' THEN
        IF v_restart IS NULL THEN RAISE EXCEPTION 'Pick the restart day, after today.' USING ERRCODE='22023'; END IF;
        IF v_call IS NULL THEN RAISE EXCEPTION 'Pick the call where the client asked to pause.' USING ERRCODE='22023'; END IF;
        IF public.cockpit_form_client_live('pause_consent') THEN
          -- Waves 3-4 (20261102b, contract 4.3): the client's own signed consent
          -- replaces the two ticks once the pause consent is live (W8, V5). It is
          -- the card's latest, signed within 14 days, dates not marked wrong, not
          -- yet used by a pause, and the restart is the one the client signed (V22).
          v_signed := public.cockpit_pause_consent_for(v_task);
          v_signed_id := lower(nullif(btrim(coalesce(v_edit->>'consentResponseId', '')), ''));
          IF v_signed->>'state' = 'dates_wrong' THEN
            RAISE EXCEPTION 'The client says these dates are wrong. Change the restart and send a new consent.' USING ERRCODE='22023';
          ELSIF v_signed->>'state' = 'expired' THEN
            RAISE EXCEPTION 'The client has not signed the pause consent in the last 14 days. Send it again.' USING ERRCODE='22023';
          ELSIF v_signed->>'state' IS DISTINCT FROM 'signed' OR v_signed_id IS NULL
                OR v_signed_id IS DISTINCT FROM v_signed->>'responseId' THEN
            RAISE EXCEPTION 'Send the pause consent from this sheet, then confirm once the client signs.' USING ERRCODE='22023';
          END IF;
          IF public.cockpit_billing_day(v_signed->>'restart') IS DISTINCT FROM v_restart THEN
            RAISE EXCEPTION 'The client signed a restart of %. Use that date or send a new consent.',
              coalesce(public.cockpit_billing_day_words(public.cockpit_billing_day(v_signed->>'restart')), 'a day not recorded')
              USING ERRCODE='22023';
          END IF;
          v_consent := jsonb_build_object('kind', 'signed', 'response_id', v_signed->>'responseId',
                                          'signed_at', v_signed->>'signedAt', 'via', v_signed->>'via', 'call_id', v_call);
        ELSE
          -- The call is the consent, with the CSM's two required ticks.
          v_term := coalesce((v_edit->'consent'->'term_runs') = 'true'::jsonb, (v_edit->'consent'->'termRuns') = 'true'::jsonb,
                             (v_edit->'consentTerm') = 'true'::jsonb, false);
          v_over := coalesce((v_edit->'consent'->'over_14_ends') = 'true'::jsonb, (v_edit->'consent'->'over14Ends') = 'true'::jsonb,
                             (v_edit->'consentOver14') = 'true'::jsonb, false);
          IF NOT (v_term AND v_over) THEN
            RAISE EXCEPTION 'Tick both consents the client gave on the call.' USING ERRCODE='22023';
          END IF;
          v_consent := jsonb_build_object('kind', 'call', 'call_id', v_call, 'term_runs', true, 'over_14_ends', true);
        END IF;
      END IF;
      v_next.client_status := 'Paused'; v_next.stage := 'Paused'; v_next.stage_group := 'paused'; v_next.paused_on := v_today;
      v_from := v_acc.client_status; v_to := 'Paused';
      v_answers := jsonb_strip_nulls(jsonb_build_object('pauseKind', v_pkind, 'restart', v_restart, 'reasonCat', v_cat,
        'reason', v_reason, 'callId', v_call,
        'consentTerm', CASE WHEN v_consent->>'kind' = 'call' THEN true END,
        'consentOver14', CASE WHEN v_consent->>'kind' = 'call' THEN true END,
        'consentResponseId', CASE WHEN v_consent->>'kind' = 'signed' THEN v_consent->>'response_id' END));
      v_detail := jsonb_strip_nulls(jsonb_build_object('pause_kind', v_pkind, 'on', v_today, 'restart', v_restart,
        'reason_cat', v_cat, 'call_id', v_call, 'consent', v_consent, 'request_id', v_req, 'seat_role', v_role));
      v_message := 'Paused from ' || public.cockpit_billing_day_words(v_today)
                   || coalesce(', restarts ' || public.cockpit_billing_day_words(v_restart), '');
      v_notice := 'pause.agreed';
      v_facts := jsonb_strip_nulls(jsonb_build_object('on', v_today, 'restart', v_restart));

    WHEN 'resume' THEN
      IF v_acc.client_status IS DISTINCT FROM 'Paused' THEN
        RAISE EXCEPTION 'This client is not paused, so there is nothing to resume.' USING ERRCODE='22023';
      END IF;
      v_day := coalesce(public.cockpit_billing_day(v_edit->>'on'), v_today);
      IF v_day > v_today OR (v_acc.paused_on IS NOT NULL AND v_day < v_acc.paused_on) THEN
        RAISE EXCEPTION 'Pick the day they resumed: today, or a day since the pause began.' USING ERRCODE='22023';
      END IF;
      v_next_day := public.cockpit_billing_day(v_edit->>'nextDate');
      IF nullif(btrim(coalesce(v_edit->>'nextDate', '')), '') IS NOT NULL AND v_next_day IS NULL THEN
        RAISE EXCEPTION 'That next payment date is not a date.' USING ERRCODE='22023';
      END IF;
      IF v_next_day IS NOT NULL AND v_next_day < v_today - 60 THEN
        RAISE EXCEPTION 'A payment date two months back is almost certainly a typo.' USING ERRCODE='22023';
      END IF;
      v_next.client_status := 'Active'; v_next.stage := 'Active'; v_next.stage_group := 'active'; v_next.paused_on := NULL;
      IF v_next_day IS NOT NULL THEN v_next.next_payment_date := v_next_day; END IF;
      v_from := v_acc.client_status; v_to := 'Active';
      v_answers := jsonb_strip_nulls(jsonb_build_object('on', v_day, 'nextDate', v_next_day));
      v_detail := jsonb_strip_nulls(jsonb_build_object('on', v_day, 'nextDate', v_next_day,
        'pause_days', CASE WHEN v_acc.paused_on IS NOT NULL THEN v_day - v_acc.paused_on END,
        'request_id', v_req, 'seat_role', v_role));
      v_message := 'Resumed ' || public.cockpit_billing_day_words(v_day)
                   || coalesce('; next payment ' || public.cockpit_billing_day_words(v_next_day), '');
      v_notice := 'client.resumed';
      v_facts := jsonb_build_object('on', v_day);

    WHEN 'mrr' THEN
      -- Set MRR (contract 4.9): the one writer of the card's MRR.
      IF jsonb_typeof(v_edit->'value') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Type the MRR in dollars, 0 or more.' USING ERRCODE='22023';
      END IF;
      v_value := round((v_edit->>'value')::numeric, 2);
      IF v_value < 0 OR v_value > 100000 THEN RAISE EXCEPTION 'Type the MRR in dollars, 0 or more.' USING ERRCODE='22023'; END IF;
      v_old_mrr := v_acc.mrr_usd;
      IF v_old_mrr IS NOT NULL AND v_old_mrr = v_value THEN
        RAISE EXCEPTION 'The card already shows that MRR.' USING ERRCODE='22023';
      END IF;
      v_cat := public.cockpit_billing_pick(v_edit->>'reasonCat',
        '{"price_change":"Price change","plan_change":"Plan change","upsell":"Upsell","downgrade":"Downgrade","correction":"Correction"}'::jsonb);
      IF v_cat IS NULL THEN RAISE EXCEPTION 'Pick why the MRR changes.' USING ERRCODE='22023'; END IF;
      v_reason := public.cockpit_manual_clean_text(v_edit->>'reason', 400);
      IF v_value = 0 AND coalesce(length(v_reason), 0) < 4 THEN
        RAISE EXCEPTION 'Say why the MRR goes to zero.' USING ERRCODE='22023';
      END IF;
      IF v_old_mrr IS NOT NULL AND v_value < v_old_mrr AND coalesce(length(v_reason), 0) < 4 THEN
        RAISE EXCEPTION 'Say why the MRR goes down, so the downgrade reads back.' USING ERRCODE='22023';
      END IF;
      v_effective := coalesce(public.cockpit_billing_day(v_edit->>'effective'), v_today);
      IF v_effective < v_today - 60 OR v_effective > v_today + 60 THEN
        RAISE EXCEPTION 'Pick a start day within two months of today.' USING ERRCODE='22023';
      END IF;
      v_next.mrr_usd := v_value;
      v_from := trim_scale(v_old_mrr)::text; v_to := trim_scale(v_value)::text;
      v_answers := jsonb_strip_nulls(jsonb_build_object('mrrUsd', v_value, 'reasonCat', v_cat, 'reason', v_reason, 'effective', v_effective));
      v_detail := jsonb_strip_nulls(jsonb_build_object('from', v_old_mrr, 'to', v_value, 'reason_cat', v_cat,
        'effective', v_effective, 'request_id', v_req, 'seat_role', v_role));
      v_message := 'MRR set to ' || public.cockpit_billing_usd_words(v_value);

    WHEN 'note' THEN
      v_reason := public.cockpit_manual_clean_text(v_edit->>'text', 1000);
      IF coalesce(length(v_reason), 0) < 2 THEN RAISE EXCEPTION 'Write the note first.' USING ERRCODE='22023'; END IF;
    ELSE
      RAISE EXCEPTION 'That is not a change the billing sheet makes.' USING ERRCODE='22023';
    END CASE;
    END IF;

    -- An older tab's change keeps its own detail; its request id still guards a repeat.
    IF NOT v_staff AND v_req IS NOT NULL THEN
      v_detail := coalesce(v_detail, '{}'::jsonb) || jsonb_build_object('request_id', v_req);
    END IF;

    -- The form's answers, recorded once per request (20261101l).
    IF v_staff THEN
      v_response := public.cockpit_form_staff_record(v_kind, v_task, v_answers, v_request, 'cockpit');
      v_detail := v_detail || jsonb_build_object('response_id', v_response);
    END IF;

    IF v_kind <> 'note' THEN
      UPDATE public.cockpit_billing_accounts SET
        stage = v_next.stage, stage_group = v_next.stage_group, client_status = v_next.client_status,
        payment_method = v_next.payment_method, payment_plan = v_next.payment_plan,
        next_payment_usd = v_next.next_payment_usd, next_payment_date = v_next.next_payment_date,
        paused_on = v_next.paused_on, extension_weeks = v_next.extension_weeks, mrr_usd = v_next.mrr_usd,
        source = v_source, synced_at = now()
      WHERE clickup_task_id = v_task
      RETURNING * INTO v_next;
    END IF;
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (v_task, v_acc.client_name, v_kind, v_from, v_to, v_reason, v_detail, v_source, v_who)
    RETURNING id INTO v_event;
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('billing.' || v_kind, 'cockpit_billing_accounts', v_task, v_who, v_app, 'supabase', to_jsonb(v_acc), to_jsonb(v_next),
            jsonb_strip_nulls(jsonb_build_object('event_id', v_event, 'request_id', v_req, 'response_id', v_response)));
    IF NOT v_staff THEN
      RETURN to_jsonb(v_next);
    END IF;
    -- Names and dates only (contract 3.4); the kind's settings decide where it posts.
    IF v_notice IS NOT NULL THEN
      PERFORM public.cockpit_billing_notice(v_notice, v_kind || ':' || v_event, v_task, v_acc.client_name,
        v_facts || jsonb_build_object('taskId', v_task, 'client', v_acc.client_name, 'eventId', v_event));
    END IF;
    RETURN to_jsonb(v_next) || jsonb_build_object('eventId', v_event, 'responseId', v_response,
      'newDate', v_next.next_payment_date, 'cardState', public.cockpit_billing_card_state(v_event), 'message', v_message);
  END IF;

  IF p_action = 'payment' THEN
    v_day := public.cockpit_billing_day(p_args->>'day');
    IF v_day IS NULL OR v_day > v_today OR v_day < date '2025-01-01' THEN
      RAISE EXCEPTION 'Pick the day the money arrived, today or before.' USING ERRCODE='22023';
    END IF;
    IF jsonb_typeof(p_args->'amount') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Type the amount as a number.' USING ERRCODE='22023'; END IF;
    v_amount := (p_args->>'amount')::numeric;
    v_currency := p_args->>'currency';
    IF v_currency IS NULL OR v_currency NOT IN ('USD', 'KWD') THEN RAISE EXCEPTION 'Pick dollars or dinars.' USING ERRCODE='22023'; END IF;
    v_text := public.cockpit_billing_amount_problem(v_amount, v_currency);
    IF v_text IS NOT NULL THEN RAISE EXCEPTION '%', v_text USING ERRCODE='22023'; END IF;
    v_rail := p_args->>'rail';
    IF v_rail IS NULL OR v_rail NOT IN ('bank_transfer', 'cheque', 'cash', 'tap', 'ecom', 'other') THEN
      RAISE EXCEPTION 'Pick how the money came.' USING ERRCODE='22023';
    END IF;
    v_evidence := nullif(btrim(coalesce(p_args->>'evidenceUrl', '')), '');
    IF v_evidence IS NOT NULL AND v_evidence !~ '^https?://[^[:space:]]+$' THEN
      RAISE EXCEPTION 'The receipt has to be a link that opens, starting https://.' USING ERRCODE='22023';
    END IF;
    v_ref := public.cockpit_manual_clean_text(p_args->>'reference', 120);
    v_note := public.cockpit_manual_clean_text(p_args->>'note', 500);
    IF nullif(p_args->>'nextDate', '') IS NOT NULL THEN
      v_next_day := public.cockpit_billing_day(p_args->>'nextDate');
      IF v_next_day IS NULL OR v_next_day <= v_day THEN
        RAISE EXCEPTION 'Their next payment has to be after this one.' USING ERRCODE='22023';
      END IF;
      IF v_next_day < v_today - 60 THEN
        RAISE EXCEPTION 'A payment date two months back is almost certainly a typo.' USING ERRCODE='22023';
      END IF;
    END IF;

    IF v_source = 'csm' THEN
      -- The SOP: a bank transfer without its receipt photo counts as unpaid.
      IF v_rail = 'bank_transfer' AND v_evidence IS NULL THEN
        RAISE EXCEPTION 'Add the link to the transfer''s receipt photo first. A bank transfer without its photo counts as unpaid.' USING ERRCODE='22023';
      END IF;
      INSERT INTO public.cockpit_billing_inbox(clickup_task_id, client_name, paid_on, amount, currency, method, reference,
                                               evidence_url, note, source, logged_by)
      VALUES (v_task, v_acc.client_name, v_day, round(v_amount, 3), v_currency, v_rail, v_ref, v_evidence, v_note, 'csm', v_who)
      RETURNING * INTO v_inbox;
      INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
      VALUES ('billing.payment', 'cockpit_billing_inbox', v_inbox.id::text, v_who, v_app, 'supabase', NULL, to_jsonb(v_inbox), '{}'::jsonb);
      IF v_next_day IS NOT NULL AND v_next_day IS DISTINCT FROM v_acc.next_payment_date THEN
        UPDATE public.cockpit_billing_accounts SET next_payment_date = v_next_day, source = 'csm', synced_at = now()
         WHERE clickup_task_id = v_task RETURNING * INTO v_next;
        INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
        VALUES (v_task, v_acc.client_name, 'date', v_acc.next_payment_date::text, v_next_day::text, 'Paid; next payment set',
                jsonb_build_object('inbox', v_inbox.id), 'csm', v_who)
        RETURNING id INTO v_event;
        INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
        VALUES ('billing.date', 'cockpit_billing_accounts', v_task, v_who, v_app, 'supabase', to_jsonb(v_acc), to_jsonb(v_next),
                jsonb_build_object('event_id', v_event, 'inbox', v_inbox.id));
        v_moved := true;
      END IF;
      RETURN jsonb_build_object('route', 'inbox', 'id', v_inbox.id, 'moved', v_moved,
                                'nextDate', v_next.next_payment_date, 'account', to_jsonb(v_next));
    END IF;

    -- The CEO cockpit logs straight into the ledger the Money tab reads, with
    -- its duplicate check, Tap guard and history gate (Convex manualPayments.add).
    -- One rule with the Money tab (checked money, 20261101n): the CEO's bank
    -- reference of 3 or more characters makes the entry checked at once; with
    -- none (or a shorter one, kept in the note) it is logged, not checked.
    v_ledger := public.cockpit_ceo_manual_payment_add(
      jsonb_build_object('day', v_day::text, 'amount', p_args->'amount', 'currency', v_currency, 'rail', v_rail,
        'clientName', v_acc.client_name, 'clickupTaskId', v_task,
        'note', nullif(concat_ws('; ', CASE WHEN char_length(v_ref) < 3 THEN 'ref ' || v_ref END, v_note, 'receipt ' || v_evidence), ''),
        'allowRepeat', coalesce(p_args->'allowRepeat' = 'true'::jsonb, false))
      || CASE WHEN char_length(v_ref) >= 3 THEN jsonb_build_object('reference', v_ref) ELSE '{}'::jsonb END,
      gen_random_uuid());
    IF v_next_day IS NOT NULL AND v_next_day IS DISTINCT FROM v_acc.next_payment_date THEN
      UPDATE public.cockpit_billing_accounts SET next_payment_date = v_next_day, source = 'ceo', synced_at = now()
       WHERE clickup_task_id = v_task RETURNING * INTO v_next;
      v_moved := true;
    END IF;
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (v_task, v_acc.client_name, 'payment', v_acc.next_payment_date::text, v_next.next_payment_date::text, NULL,
            jsonb_build_object('amount', p_args->'amount', 'currency', v_currency, 'day', v_day, 'rail', v_rail,
                               'reference', v_ref, 'ledgerId', v_ledger),
            'ceo', v_who)
    RETURNING id INTO v_event;
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('billing.payment', 'cockpit_billing_accounts', v_task, v_who, v_app, 'supabase', to_jsonb(v_acc), to_jsonb(v_next),
            jsonb_build_object('event_id', v_event, 'ledger_id', v_ledger));
    RETURN jsonb_build_object('route', 'ledger', 'id', v_ledger, 'moved', v_moved,
                              'nextDate', v_next.next_payment_date, 'account', to_jsonb(v_next));
  END IF;

  RAISE EXCEPTION 'That is not a billing action.' USING ERRCODE='22023';
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_form_notices_in()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ceo boolean;
  v_confirm boolean;
  v_covered uuid[] := '{}'::uuid[];
  v_open jsonb := '{}'::jsonb;
  v_rows jsonb;
BEGIN
  PERFORM public.cockpit_form_actor();
  v_ceo := coalesce(public.cockpit_is_ceo(), false);
  IF NOT v_ceo AND NOT coalesce(public.cockpit_has_role('csm'), false) THEN
    RAISE EXCEPTION 'Notices in are for client success and the CEO.' USING ERRCODE = '42501';
  END IF;
  -- 20261101o's confirm columns, read by name: before o no departure is confirmed.
  v_confirm := public.cockpit_form_column_exists('cockpit_churn_departures', 'confirmed_at');
  IF v_confirm THEN
    EXECUTE 'SELECT coalesce(array_agg(r.id), ''{}''::uuid[]) FROM public.cockpit_form_responses r'
            ' WHERE r.form_key = ''exit_survey'' AND r.task_id IS NOT NULL AND EXISTS ('
            '   SELECT 1 FROM public.cockpit_churn_departures d WHERE d.clickup_task_id = r.task_id AND d.removed_at IS NULL'
            '      AND d.confirmed_at IS NOT NULL'
            '      AND (d.confirmed_at >= r.submitted_at OR d.left_on >= (r.answer_meta->>''notice_on'')::date))'
      INTO v_covered;
    EXECUTE 'SELECT coalesce(jsonb_object_agg(x.t, x.id), ''{}''::jsonb) FROM ('
            '  SELECT DISTINCT ON (d.clickup_task_id) d.clickup_task_id AS t, d.id FROM public.cockpit_churn_departures d'
            '   WHERE d.removed_at IS NULL AND d.confirmed_at IS NULL AND d.clickup_task_id IS NOT NULL'
            '   ORDER BY d.clickup_task_id, d.left_on DESC, d.id DESC) x'
      INTO v_open;
  ELSE
    SELECT coalesce(jsonb_object_agg(x.t, x.id), '{}'::jsonb) INTO v_open
      FROM (SELECT DISTINCT ON (d.clickup_task_id) d.clickup_task_id AS t, d.id FROM public.cockpit_churn_departures d
             WHERE d.removed_at IS NULL AND d.clickup_task_id IS NOT NULL
             ORDER BY d.clickup_task_id, d.left_on DESC, d.id DESC) x;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'kind', CASE WHEN z.form_key = 'exit_survey' THEN 'termination'
                        WHEN z.form_key = 'pause_consent' THEN 'pause_consent' ELSE 'pause_request' END,
           'responseId', z.id,
           'taskId', z.task_id,
           'clientName', z.shown_name,
           'noticeOn', z.answer_meta->>'notice_on',
           'submittedAt', z.submitted_at,
           'matched', z.task_id IS NOT NULL,
           -- On its card only by the link's hidden id, and no person has checked it yet.
           'unverified', z.task_id IS NOT NULL AND coalesce(z.answer_meta->>'match', '') = 'hidden_id_unverified'
                         AND NOT (z.answer_meta ? 'matched'),
           'departureId', CASE WHEN z.form_key = 'exit_survey' AND z.task_id IS NOT NULL
                               THEN (v_open->>z.task_id)::bigint END)
         -- Waves 3-4 (20261102b): a client's own answer from the portal or the
         -- link carries its invite, how it came and, for a consent, what it says.
         || CASE WHEN z.invite_id IS NOT NULL THEN jsonb_build_object(
              'native', true, 'inviteId', z.invite_id,
              'via', CASE WHEN z.source = 'portal' THEN 'portal' ELSE 'link' END) ELSE '{}'::jsonb END
         || CASE WHEN z.form_key = 'pause_consent' THEN jsonb_build_object(
              'datesWrong', coalesce(z.answers->'datesWrong' = 'true'::jsonb, false),
              'signer', CASE WHEN z.source = 'portal' THEN 'the client admin' ELSE coalesce(z.signer, 'someone with the link') END,
              'start', z.inv_context->>'start', 'restart', z.inv_context->>'restart') ELSE '{}'::jsonb END
         ORDER BY z.submitted_at DESC, z.id), '[]'::jsonb)
    INTO v_rows
    FROM (SELECT r.*,
                 CASE WHEN r.task_id IS NULL THEN coalesce(r.hidden->>'client_name', r.client_name)
                      ELSE coalesce(a.client_name, r.client_name) END AS shown_name,
                 a.client_name AS card_name,
                 i.context AS inv_context
            FROM public.cockpit_form_responses r
            LEFT JOIN public.cockpit_billing_accounts a ON a.clickup_task_id = r.task_id
            LEFT JOIN public.cockpit_form_invites i ON i.id = r.invite_id
           WHERE r.form_key IN ('exit_survey','pause_request','pause_consent') AND r.mode = 'live'
             AND r.state IN ('legacy','submitted','confirmed')
             AND NOT (r.answer_meta ? 'answered')
             AND NOT (r.id = ANY(v_covered))
             AND NOT (r.form_key = 'pause_request' AND r.task_id IS NOT NULL AND EXISTS (
                   SELECT 1 FROM public.cockpit_billing_events e
                    WHERE e.clickup_task_id = r.task_id AND e.kind = 'pause' AND e.at > r.submitted_at))
             -- A portal or link answer is on its card by its invite (verified),
             -- never a canary's (those are stored shadow and stop at mode above).
             AND (r.invite_id IS NULL OR (i.task_id = r.task_id AND i.origin <> 'canary'))
             -- A pause consent: signed or dates marked wrong in the last 14 days,
             -- no pause after it (a voided one does not count) and no newer
             -- consent sent to the card since.
             AND (r.form_key <> 'pause_consent' OR (
                   r.invite_id IS NOT NULL AND r.task_id IS NOT NULL AND r.state IN ('submitted','confirmed')
                   AND r.submitted_at > now() - interval '14 days'
                   AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_events e
                                    WHERE e.clickup_task_id = r.task_id AND e.kind = 'pause' AND e.at > r.submitted_at
                                      AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids v WHERE v.event_id = e.id))
                   AND NOT EXISTS (SELECT 1 FROM public.cockpit_form_invites n
                                    WHERE n.task_id = r.task_id AND n.form_key = 'pause_consent' AND n.origin <> 'canary'
                                      AND n.id <> r.invite_id AND n.issued_at > r.submitted_at)))
           ORDER BY r.submitted_at DESC, r.id
           LIMIT 200) z
   -- Matched rows: the CEO, or the CSM of the client. Unmatched: every CSM seat (W22).
   WHERE z.task_id IS NULL OR v_ceo OR coalesce(public.cockpit_client_allowed(coalesce(z.card_name, z.client_name)), false);
  RETURN v_rows;
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_form_prefill(p_form_key text, p_task_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_today date := public.cockpit_billing_today();
  a public.cockpit_billing_accounts;
  v_values jsonb := '[]'::jsonb;
  v_calls jsonb;
  v_hints jsonb := '[]'::jsonb;
  v_grant jsonb;
  v_survey jsonb;
  v_type jsonb;
  v_last jsonb;
  v_checkin record;
  v_late record;
  v_card text := 'the ClickUp card';
  -- Waves 3-4 (20261102b): the pause consent and the exit survey's invite.
  v_consent jsonb;
  v_invite jsonb;
BEGIN
  PERFORM public.cockpit_billing_read_gate();
  IF p_form_key IS NULL OR p_form_key NOT IN ('extension','pause','resume','churn_confirm','mrr') THEN
    RAISE EXCEPTION 'That is not one of the staff forms.' USING ERRCODE = '22023';
  END IF;
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'That is not a ClickUp card id.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO a FROM public.cockpit_billing_accounts WHERE clickup_task_id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That client card is not on the billing sheet. Refresh the page and pick it again.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.cockpit_billing_reader_ok(a.client_name) THEN
    RAISE EXCEPTION '% is not one of your clients in the portal.', a.client_name USING ERRCODE = '42501';
  END IF;

  -- The card's last 30 days of calls and 1-1 notes, newest first.
  SELECT coalesce(jsonb_agg(c ORDER BY c->>'at' DESC), '[]'::jsonb) INTO v_calls FROM (
    SELECT jsonb_build_object('id', k.id::text, 'at', k.starts_at, 'kind', k.kind,
             'source', CASE k.source WHEN 'fathom' THEN 'Fathom' WHEN 'ghl_appointment' THEN 'the booking'
                                     WHEN 'zoom' THEN 'Zoom' WHEN 'checkin_form' THEN 'the 1-1 notes'
                                     ELSE 'the call log' END
                       || ', ' || public.cockpit_billing_day_words((k.starts_at AT TIME ZONE 'Asia/Kuwait')::date),
             'title', k.title) AS c
      FROM public.cockpit_csm_calls k
     WHERE k.task_id = p_task_id AND k.starts_at >= now() - interval '30 days' AND k.starts_at <= now()
       AND coalesce(k.status, '') NOT IN ('cancelled','canceled','no_show','noshow')
    UNION ALL
    SELECT jsonb_build_object('id', r.id::text, 'at', coalesce(r.submitted_at, r.created_at), 'kind', 'checkin',
             'source', 'the 1-1 notes, ' || public.cockpit_billing_day_words((coalesce(r.submitted_at, r.created_at) AT TIME ZONE 'Asia/Kuwait')::date),
             'title', '1-1 notes')
      FROM public.cockpit_form_responses r
     WHERE r.form_key = 'checkin' AND r.task_id = p_task_id AND r.state IN ('submitted','confirmed')
       AND coalesce(r.submitted_at, r.created_at) >= now() - interval '30 days'
  ) t;
  v_last := CASE WHEN jsonb_array_length(v_calls) > 0 THEN v_calls->0 END;

  -- An extension hint when the latest 1-1 notes in 30 days mention one.
  SELECT r.id, coalesce(r.submitted_at, r.created_at) AS at, r.answers INTO v_checkin
    FROM public.cockpit_form_responses r
   WHERE r.form_key = 'checkin' AND r.task_id = p_task_id AND r.state IN ('submitted','confirmed')
     AND coalesce(r.submitted_at, r.created_at) >= now() - interval '30 days'
   ORDER BY coalesce(r.submitted_at, r.created_at) DESC LIMIT 1;
  IF v_checkin.id IS NOT NULL AND v_checkin.answers::text ILIKE '%extension%' THEN
    v_hints := v_hints || jsonb_build_array(jsonb_build_object('text', 'The last 1-1 notes mention an extension',
      'source', 'the 1-1 notes, ' || public.cockpit_billing_day_words((v_checkin.at AT TIME ZONE 'Asia/Kuwait')::date)));
  END IF;

  SELECT jsonb_build_object('grantId', x.grant_id, 'weeks', x.weeks, 'from', x.from_date, 'until', x.until,
           'grantedOn', x.granted_on, 'reason', x.reason, 'seatRole', x.seat_role) INTO v_grant
    FROM public.cockpit_extensions_v x WHERE x.clickup_task_id = p_task_id AND x.state = 'live'
   ORDER BY x.grant_id DESC LIMIT 1;

  -- unverified: the card came only from the link's unsigned hidden id (20261101l), so the survey fills
  -- nothing until the CSM says it is this client's.
  -- A portal or link survey (20261102b) is on the card by its invite, so it is verified.
  SELECT jsonb_build_object('responseId', r.id, 'submittedAt', r.submitted_at, 'state', r.state,
           'noticeOn', coalesce(r.answer_meta->>'notice_on', ((r.submitted_at AT TIME ZONE 'Asia/Kuwait')::date)::text),
           'unverified', coalesce(r.answer_meta->>'match' = 'hidden_id_unverified', false),
           'native', r.invite_id IS NOT NULL, 'inviteId', r.invite_id,
           'via', CASE WHEN r.invite_id IS NULL THEN 'typeform' WHEN r.source = 'portal' THEN 'portal' ELSE 'link' END) INTO v_survey
    FROM public.cockpit_form_responses r
   WHERE r.form_key = 'exit_survey' AND r.task_id = p_task_id AND r.state <> 'void' AND r.mode = 'live'
     AND (r.invite_id IS NULL OR EXISTS (SELECT 1 FROM public.cockpit_form_invites i
                                          WHERE i.id = r.invite_id AND i.task_id = r.task_id AND i.origin <> 'canary'))
   ORDER BY r.submitted_at DESC NULLS LAST LIMIT 1;
  IF p_form_key = 'pause' THEN
    v_consent := public.cockpit_pause_consent_for(p_task_id)
                 || jsonb_build_object('live', coalesce(public.cockpit_form_client_live('pause_consent'), false));
  ELSIF p_form_key = 'churn_confirm' THEN
    v_invite := public.cockpit_exit_survey_invite_for(p_task_id, NULL);
  END IF;

  SELECT l.due_on, l.days_late INTO v_late FROM public.cockpit_late_payments_v l
   WHERE l.clickup_task_id = p_task_id AND l.closed_how = 'open' ORDER BY l.due_on DESC LIMIT 1;

  CASE p_form_key
  WHEN 'extension' THEN
    v_values := jsonb_build_array(
      CASE WHEN v_last IS NOT NULL THEN jsonb_build_object('key', 'callId', 'value', v_last->>'id', 'source', v_last->>'source')
           ELSE jsonb_build_object('key', 'callId', 'value', NULL, 'source', 'No call or 1-1 notes on this client in the last 30 days.') END);
  WHEN 'pause' THEN
    v_values := jsonb_build_array(
      CASE WHEN v_late.due_on IS NOT NULL
           THEN jsonb_build_object('key', 'pauseKind', 'value', 'non_payment',
                  'source', format('the late-payment record: due %s, %s days late', public.cockpit_billing_day_words(v_late.due_on), v_late.days_late))
           ELSE jsonb_build_object('key', 'pauseKind', 'value', NULL, 'source', 'Nobody holds this yet: say whether the client asked or is not paying.') END,
      CASE WHEN v_last IS NOT NULL THEN jsonb_build_object('key', 'callId', 'value', v_last->>'id', 'source', v_last->>'source')
           ELSE jsonb_build_object('key', 'callId', 'value', NULL, 'source', 'No call or 1-1 notes on this client in the last 30 days.') END);
  WHEN 'resume' THEN
    v_values := jsonb_build_array(
      jsonb_build_object('key', 'on', 'value', v_today, 'source', 'today'),
      CASE WHEN a.next_payment_date IS NOT NULL AND a.paused_on IS NOT NULL
           THEN jsonb_build_object('key', 'nextDate', 'value', a.next_payment_date + greatest(0, v_today - a.paused_on),
                  'source', format('the ClickUp card: its date %s plus %s paused days',
                                   public.cockpit_billing_day_words(a.next_payment_date), greatest(0, v_today - a.paused_on)))
           ELSE jsonb_build_object('key', 'nextDate', 'value', NULL,
                  'source', CASE WHEN a.paused_on IS NULL THEN 'The card has no Paused On date, so no next date is suggested.'
                                 ELSE 'The card has no Next Payment Date, so no next date is suggested.' END) END);
  WHEN 'churn_confirm' THEN
    IF to_regprocedure('public.cockpit_churn_type_default(text,date)') IS NOT NULL THEN
      EXECUTE 'SELECT to_jsonb(public.cockpit_churn_type_default($1, $2))' INTO v_type USING p_task_id, v_today;
    END IF;
    v_values := jsonb_build_array(
      jsonb_build_object('key', 'leftOn', 'value', NULL, 'source', 'Nobody holds this yet: pick the day they left.'),
      CASE WHEN v_survey->'unverified' = 'true'::jsonb
           THEN jsonb_build_object('key', 'noticeOn', 'value', NULL,
                  'source', 'The termination survey''s card came from its link, not checked: pick the notice day if it is this client''s.')
           WHEN v_survey IS NOT NULL
           THEN jsonb_build_object('key', 'noticeOn', 'value', v_survey->>'noticeOn',
                  'source', 'the termination survey, ' || public.cockpit_billing_day_words((v_survey->>'noticeOn')::date))
           ELSE jsonb_build_object('key', 'noticeOn', 'value', NULL, 'source', 'No termination survey from this client.') END,
      jsonb_build_object('key', 'reason', 'value', NULL, 'source', 'Nobody holds this yet: pick why they left.'),
      CASE WHEN v_type IS NOT NULL AND jsonb_typeof(v_type) = 'string'
           THEN jsonb_build_object('key', 'churnType', 'value', v_type #>> '{}', 'source', 'the day-90 rule')
           ELSE jsonb_build_object('key', 'churnType', 'value', NULL, 'source', 'The day-90 rule is not live yet: pick the type.') END,
      CASE WHEN a.mrr_usd IS NOT NULL THEN jsonb_build_object('key', 'mrrLostUsd', 'value', a.mrr_usd, 'source', v_card)
           ELSE jsonb_build_object('key', 'mrrLostUsd', 'value', NULL, 'source', 'The card has no MRR.') END,
      CASE WHEN v_survey->'unverified' = 'true'::jsonb
           THEN jsonb_build_object('key', 'surveyState', 'value', NULL,
                  'source', 'The termination survey''s card came from its link, not checked: say whether this client filled it.')
           WHEN v_survey IS NOT NULL THEN jsonb_build_object('key', 'surveyState', 'value', 'filled',
                  'source', 'the termination survey, ' || public.cockpit_billing_day_words((v_survey->>'noticeOn')::date))
           WHEN v_invite->>'state' = 'open' THEN jsonb_build_object('key', 'surveyState', 'value', 'sent',
                  'source', 'the exit survey, sent ' || public.cockpit_billing_day_words(((v_invite->>'issuedAt')::timestamptz AT TIME ZONE 'Asia/Kuwait')::date))
           ELSE jsonb_build_object('key', 'surveyState', 'value', NULL, 'source', 'No termination survey from this client.') END,
      -- Never preselected: the latest call is not the exit call unless the CSM says so.
      CASE WHEN v_last IS NOT NULL THEN jsonb_build_object('key', 'exitCallId', 'value', NULL,
                  'source', 'Pick the exit call if there was one; the calls of the last 30 days are listed.')
           ELSE jsonb_build_object('key', 'exitCallId', 'value', NULL, 'source', 'No call or 1-1 notes on this client in the last 30 days.') END);
  WHEN 'mrr' THEN
    v_values := jsonb_build_array(
      CASE WHEN a.mrr_usd IS NOT NULL THEN jsonb_build_object('key', 'mrrUsd', 'value', a.mrr_usd, 'source', v_card)
           ELSE jsonb_build_object('key', 'mrrUsd', 'value', NULL, 'source', 'The card has no MRR yet.') END,
      jsonb_build_object('key', 'effective', 'value', v_today, 'source', 'today'));
  END CASE;

  RETURN jsonb_build_object(
    'formKey', p_form_key, 'taskId', p_task_id, 'clientName', a.client_name,
    'values', v_values, 'calls', v_calls, 'hints', v_hints,
    'card', jsonb_build_object(
      'status', jsonb_build_object('value', a.client_status, 'source', v_card),
      'nextDate', jsonb_build_object('value', a.next_payment_date, 'source', v_card),
      'nextAmountUsd', jsonb_build_object('value', a.next_payment_usd, 'source', v_card),
      'plan', jsonb_build_object('value', a.payment_plan, 'source', v_card),
      'mrrUsd', jsonb_build_object('value', a.mrr_usd, 'source', v_card),
      'pausedOn', jsonb_build_object('value', a.paused_on, 'source', v_card),
      'extensionWeeks', jsonb_build_object('value', a.extension_weeks, 'source', v_card),
      'syncedAt', a.synced_at),
    'grant', v_grant, 'survey', v_survey,
    'consent', v_consent, 'surveyInvite', v_invite,
    'late', CASE WHEN v_late.due_on IS NOT NULL THEN jsonb_build_object('dueOn', v_late.due_on, 'daysLate', v_late.days_late) END,
    'churnTypeDefault', CASE WHEN p_form_key = 'churn_confirm' AND jsonb_typeof(v_type) = 'string' THEN v_type #>> '{}' END);
END $function$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_churn_read()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  uid uuid; today date := (now() AT TIME ZONE 'Asia/Kuwait')::date; mon text; src jsonb; roster jsonb; starts jsonb;
  v_in jsonb; v_notices jsonb; v_unmatched jsonb; v_stopped jsonb;
BEGIN
  uid := public.cockpit_csm_actor(); mon := to_char(today, 'YYYY-MM');
  src := public.cockpit_csm_source_read()->'tables';
  SELECT coalesce(jsonb_agg(jsonb_build_object('key', c->>'taskId', 'name', c->>'name', 'stage', coalesce(c->>'stage', ''),
    'launchedOn', c->>'launchDate', 'csm', c->>'csmAssigned', 'pausedSince', c->>'pausedSince', 'pausedDays', c->'pausedDays')), '[]')
    INTO roster FROM jsonb_array_elements(src->'clients') c;
  SELECT coalesce(jsonb_agg(jsonb_build_object('month', months.mon, 'day', r.data->>'day', 'paying', r.data->'paying') ORDER BY months.mon), '[]')
    INTO starts
    FROM (SELECT to_char(generate_series(date_trunc('month', today) - interval '3 months', date_trunc('month', today), interval '1 month'), 'YYYY-MM') mon) months
    LEFT JOIN LATERAL (SELECT d AS data FROM jsonb_array_elements(src->'rosterDays') d WHERE d->>'month' = months.mon ORDER BY d->>'day' LIMIT 1) r ON true;

  -- The derived notice rows (20261101l): its own scope rules, so a CSM sees
  -- matched notices of their clients and every unmatched one (W22).
  v_in := coalesce(public.cockpit_form_notices_in(), '[]'::jsonb);
  SELECT coalesce(jsonb_agg(n || jsonb_build_object(
           -- A portal or link exit survey (20261102b) has flat answers; a Typeform one a field list.
           'ratings', CASE WHEN r.invite_id IS NOT NULL THEN public.cockpit_exit_survey_native_ratings(r.answers)
                           ELSE public.cockpit_churn_survey_ratings(r.answers) END,
           'typeDefault', public.cockpit_churn_type_default(n->>'taskId', today))
         ORDER BY n->>'submittedAt' DESC), '[]')
    INTO v_notices
    FROM jsonb_array_elements(v_in) n
    LEFT JOIN public.cockpit_form_responses r ON r.id::text = n->>'responseId'
   WHERE n->>'kind' = 'termination' AND (n->>'matched')::boolean IS TRUE;
  SELECT coalesce(jsonb_agg(n ORDER BY n->>'submittedAt' DESC), '[]')
    INTO v_unmatched
    FROM jsonb_array_elements(v_in) n
   WHERE n->>'kind' = 'termination' AND (n->>'matched')::boolean IS NOT TRUE;

  -- Stopped on the card with no departure in the register: a review list,
  -- never a bulk write (Q5). stoppedSince is NULL when every snapshot of the
  -- card reads Stopped, so the day it stopped is not known.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'taskId', b.clickup_task_id, 'clientName', b.client_name, 'churnDate', b.churn_date,
           'mrrUsd', b.mrr_usd, 'csm', b.csm,
           'stoppedSince', (SELECT min(s.day) FROM public.cockpit_client_billing_days s
                             WHERE s.clickup_task_id = b.clickup_task_id AND s.stage = 'Stopped'
                               AND s.day > (SELECT max(o.day) FROM public.cockpit_client_billing_days o
                                             WHERE o.clickup_task_id = b.clickup_task_id AND o.stage IS DISTINCT FROM 'Stopped')),
           'typeDefault', public.cockpit_churn_type_default(b.clickup_task_id, coalesce(b.churn_date, today)))
         ORDER BY b.churn_date DESC NULLS LAST, b.client_name), '[]')
    INTO v_stopped
    FROM public.cockpit_billing_accounts b
   WHERE b.client_status = 'Stopped'
     AND public.cockpit_client_allowed(b.client_name)
     AND NOT EXISTS (SELECT 1 FROM public.cockpit_churn_departures d
                      WHERE d.clickup_task_id = b.clickup_task_id AND d.removed_at IS NULL);

  RETURN jsonb_build_object('today', today, 'month', mon,
    'me', jsonb_build_object('email', (SELECT email FROM auth.users WHERE id = uid), 'isCeo', public.cockpit_is_ceo(),
                             'isAdmin', public.cockpit_has_role('admin')),
    'deps', coalesce((SELECT jsonb_agg(to_jsonb(d) || jsonb_build_object(
               'confirmed_role', CASE WHEN d.confirmed_at IS NULL THEN NULL
                                      WHEN d.confirmed_by LIKE 'the CEO%' THEN 'the CEO'
                                      ELSE coalesce(public.cockpit_slack_notice_role_of(d.confirmed_by), 'a team member') END,
               'card_state', CASE WHEN d.billing_event_id IS NULL THEN NULL
                                  ELSE coalesce((SELECT CASE q.state WHEN 'dry_run' THEN 'held' ELSE q.state END
                                                   FROM public.cockpit_clickup_writeback_queue q
                                                  WHERE q.dedupe_key = 'billing:' || d.billing_event_id), 'none') END,
               'card_error', (SELECT left(q.error, 240) FROM public.cockpit_clickup_writeback_queue q
                               WHERE q.dedupe_key = 'billing:' || d.billing_event_id AND q.state IN ('failed', 'skipped')),
               'churn_type_default', CASE WHEN d.clickup_task_id IS NOT NULL
                                          THEN public.cockpit_churn_type_default(d.clickup_task_id, d.left_on) END,
               -- The departure's exit survey invite (20261102b): its own, else the card's latest with no departure named.
               'surveyInvite', CASE WHEN d.clickup_task_id IS NOT NULL
                                    THEN public.cockpit_exit_survey_invite_for(d.clickup_task_id, d.id) END)
             ORDER BY left_on DESC, id DESC)
             FROM public.cockpit_churn_departures d WHERE removed_at IS NULL AND public.cockpit_client_allowed(client)), '[]'),
    'monthRows', coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY month) FROM public.cockpit_churn_months m WHERE public.cockpit_csm_scope_all()), '[]'),
    'cards', coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM public.cockpit_billing_accounts b WHERE public.cockpit_client_allowed(client_name)), '[]'),
    'log', coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY at DESC) FROM public.cockpit_churn_log l
                      WHERE public.cockpit_csm_scope_all() OR public.cockpit_client_allowed(coalesce(detail->>'client', detail->'after'->>'client', detail->'before'->>'client'))), '[]'),
    'roster', jsonb_build_object('cards', roster, 'starts', starts,
      'left', coalesce((SELECT jsonb_agg(jsonb_build_object('key', e->>'key', 'name', e->>'name', 'day', e->>'day', 'to', coalesce(e->>'to', e->>'kind')))
                          FROM jsonb_array_elements(src->'churnEvents') e
                         WHERE e->>'kind' IN ('lost', 'removed', 'offboarded') AND e->>'month' >= to_char(today - interval '3 months', 'YYYY-MM')), '[]')),
    'notices', v_notices,
    'unmatched', v_unmatched,
    'stoppedNotInRegister', v_stopped);
END $function$;

-- ---------------------------------------------------------------------------
-- 5. The lifecycle doors open with this file (read by cockpit_form_doors,
--    20261102a). A merge, never an overwrite; a second apply touches nothing.

INSERT INTO public.cockpit_settings (key, value, updated_by)
VALUES ('forms.doors', '{"lifecycle":true}'::jsonb, 'migration 20261102b')
ON CONFLICT (key) DO UPDATE SET value = public.cockpit_settings.value || '{"lifecycle":true}'::jsonb,
  updated_by = 'migration 20261102b', updated_at = now()
WHERE NOT (public.cockpit_settings.value @> '{"lifecycle":true}'::jsonb);

-- ---------------------------------------------------------------------------
-- 6. Privileges: every new and replaced function revoked from all four roles,
--    then the three browser reads and the billing write granted back to
--    authenticated exactly as live. Hooks and helpers stay the owner's.

REVOKE ALL ON FUNCTION
  public.cockpit_kuwait_stamp(timestamptz),
  public.cockpit_lifecycle_notice(text, text, text, text, jsonb, boolean),
  public.cockpit_exit_survey_departure(text),
  public.cockpit_exit_survey_invite_for(text, bigint),
  public.cockpit_exit_survey_native_ratings(jsonb),
  public.cockpit_pause_consent_for(text),
  public.cockpit_form_issue_hook_pause_consent(uuid),
  public.cockpit_form_hook_pause_consent(uuid),
  public.cockpit_form_issue_hook_exit_survey(uuid),
  public.cockpit_form_hook_exit_survey(uuid),
  public.cockpit_form_responses_guard(),
  public.cockpit_billing_write(text, jsonb),
  public.cockpit_billing_writeback_writes(text, text, text, jsonb),
  public.cockpit_billing_writeback_comment(text, text, text, jsonb, text),
  public.cockpit_billing_detail(text, jsonb),
  public.cockpit_billing_canary(text, jsonb),
  public.cockpit_form_notices_in(),
  public.cockpit_form_prefill(text, text),
  public.cockpit_csm_churn_read()
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.cockpit_billing_write(text, jsonb),
  public.cockpit_form_notices_in(),
  public.cockpit_form_prefill(text, text),
  public.cockpit_csm_churn_read()
TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
