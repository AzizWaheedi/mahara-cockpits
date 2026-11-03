-- Client form schema version 2 and the structured onboarding, version 3 (docs/forms/WAVE56-CONTRACT.md 4.22; plan
-- build B8). The CEO's answer of 2026-11-02 to "The structured onboarding (version 3)": "Do the whole redesign".
-- Creative Triage (bldgtotkfmhoxmlzowdx). Stands on 20261102p and 20261103b; applies twice. Stored, not live:
-- every invite, the go-live and the portal stay on version 2 until forms.client.schema_v2 opens it (8 below).
--
-- 1. Client form schema version 2, the structured onboarding's language (the onboarding only; every other form,
--    and version 2 of the onboarding, stays version 1, checked by 20261102o's bodies byte for byte, now named
--    cockpit_form_schema_check_v1 and cockpit_form_answers_check_v1). Additions to version 1:
--    - "rows": a list of rows, each of 1 to 6 columns (text, longtext, number, choice or tick), minRows 0 to 30,
--      maxRows 1 to 30, the words for adding a row. The answer is a list of objects with the column keys only; a
--      fully blank row is dropped; a required rows question needs max(1, minRows) rows. Codes rows_few and
--      rows_many (alone, before any cell is read), and a cell's code (required, length, range, option, unknown)
--      under "<key>.<row>.<column>", the row counted from 0 in the list as sent.
--    - "note": shown, never answered, like a heading, but not a section; a label of 300 characters at most, an
--      optional show-if, and an optional link whose address is https on an allowed host (app.leadsie.com).
--    - showIf takes exactly one of equals (as version 1), in (1 to 12 choices of an earlier choice question) or
--      includes (one choice of an earlier several-choices question). A question whose source is hidden or
--      unanswered is hidden; an unanswered tick reads false.
--    - currencyFrom on a number question or column: the earlier choice question its amount is read back in
--      (display only, the portal's; the check only names the question).
--    - 64 questions (version 1 keeps 40); a several-choices question takes up to 30 choices (Saudi Arabia's areas
--      take 19); every other limit is version 1's, the onboarding's 1,000 and 10,000 characters for texts.
--    The shared fixture (apps/media-buyer-cockpit/scripts/fixtures/client-form-answers.json, schemaV2*) holds the
--    answers check's cases; the portal copies it byte for byte.
-- 2. The switch, forms.client.schema_v2 {state: off | canary | on}, seeded off (the forms settings trigger audits
--    every change). cockpit_form_client_version counts a version in schema version 2 only while it is on. While it
--    is canary, the canary invite on the test card 86eywg1cq (cockpit_form_invite_canary) opens the structured
--    version and every other invite stays on version 2. cockpit_form_schema_v2_switch (8) is the only door.
-- 3. The printer. cockpit_form_stage4_print(form, version, answers) gives the Typeform answers list [{ref, title,
--    value}] every Make-mirroring text and reader takes: for a version without a print map (every kickoff, the
--    onboarding's version 2) it is cockpit_form_stage4_typeform_answers, byte for byte; for version 3 it applies the
--    IMMUTABLE print map cockpit_form_stage4_print_map(3), server only, in the order and with the titles of
--    cockpit_form_stage4_fields('onboarding'), as a version-2 answer's list has them. Each of KFRCXPFx's 36 refs is
--    printed in Make's text shapes: Typeform's own choice labels, revenues as plain whole numbers (Make prints a 0 as
--    blank), the currency only inside a typed-looking price line, "No Facebook page" and "No website yet" only when
--    ticked, nothing for an empty answer. The goldens are scripts/dev/fixtures/onboarding-v3-print.json, from the
--    design's reference printer. cockpit_form_stage4_input calls it with the answer's version, and for a version-3
--    answer adds structured: the answers without the five contact keys, with schemaVersion 3, which the builder
--    (20261102p's, with that one addition) puts beside answers in the read model's onboarding entry, cockpit only
--    (make_parity.py INTENDED['structured']). A version-2 answer plans byte for byte as before.
-- 4. The prefill. cockpit_form_onboarding_context(card) gives {currency, areaCountries} from the billing sheet's
--    country, else the tied sale's (QT and QA are both Qatar), else nothing. cockpit_form_invite_issue_core still
--    refuses any onboarding fact from its caller, then sets this one itself, on a structured version's invite only:
--    a version-2 invite keeps its empty context. The portal reads an invite's context only through
--    cockpit_form_client_context (portal_form_get, portal_form_token_open): 20261102a's, except that a structured
--    onboarding invite also passes currency and areaCountries, which its schema cannot declare as context facts.
-- 5. The Typeform door (X26) stores every KFRCXPFx delivery on version 2, whose questions map one to one onto
--    KFRCXPFx's, whatever version the portal issues.
-- 6. Version 3 of the onboarding is stored (cockpit_form_versions; one audit row, forms.onboarding_v3_stored): 59
--    items in four sections (54 answered, 4 headings, 1 note), 3 rows questions and 13 show-ifs. Nothing in the
--    registry changes.
-- 7. The forms editor. A form whose newest version is in schema version 2 is read only: "Its structured questions
--    change in a migration for now." (cockpit_form_editor_kind), so draft, publish and go back refuse on the
--    server; cockpit_form_editor_structured(form) gives the editor that version to show, admin or CEO.
-- 8. cockpit_form_schema_v2_switch(state, actor), owner only: off, canary (the version passes the checks and its
--    print map fits) or on (and a canary answer on the test card is stored); one audit row
--    (forms.schema_v2_switch), and the registry's copy follows when the onboarding is native.
--
-- It does not touch portal_form_onboarding_open (B3 owns it). Nothing here posts, writes a card, sends a message
-- or reaches a sheet.
--
-- Apply it only after both of these (contract 4.22 item 10, the RUNBOOK row):
-- - the csm-calls release that reads each native onboarding answer with its own version's questions
--   (hermes/csm-calls/sources.ts readStage4Forms) is deployed on the VPS. The release before it reads every answer
--   with the newest stored version's questions, which from this file on is version 3, and rewrites the timeline rows;
-- - D-S4O's look at version 2 in the forms editor is done and any version-2 wording is published: from this file on
--   the editor shows the onboarding read only (7), so a version-2 wording change after it is a migration (as
--   20261103b was).

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. What this file stands on (20261102p's builder, 20261103b's version 2 and fifth Meta choice), then the drift
--    guard: each replaced body is the one live holds (read 2026-11-03: 20261102o's checks and Typeform door,
--    20261102a's client version and client context, 20261102j's input, 20261102p's builder, 20261102i's issue core,
--    20261102d's editor kind) or this file's own (a second apply).

DO $$
BEGIN
  IF to_regprocedure('public.cockpit_form_stage4_card_facts(text,text,jsonb,timestamptz)') IS NULL
     OR to_regprocedure('public.cockpit_form_typeform_text(text)') IS NULL
     OR coalesce((SELECT md5(v.schema::text) FROM public.cockpit_form_versions v
                   WHERE v.form_key = 'onboarding' AND v.version = 2), '') <> '38d371cd509ced4fef9b7cad6e09fb80'
     OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.cockpit_form_stage4_fields('onboarding')) f
                     CROSS JOIN LATERAL jsonb_array_elements(f->'options') o
                    WHERE f->>'key' = 'facebookAds' AND o->>'value' = 'restricted') THEN
    RAISE EXCEPTION 'Apply 20261102p and 20261103b before 20261103h.' USING ERRCODE = '55000';
  END IF;
END $$;

DO $$
DECLARE g record; v_now text;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('public.cockpit_form_schema_check(jsonb)', '07f88396a8df9e1b2b42f41b5c3e189a', '9bd159ba3782c744236ed92e6a75ee41'),
      ('public.cockpit_form_answers_check(jsonb,jsonb,jsonb)', 'ac54af52c93ca8f2517a5f55b507cfa7', '5c77fa86f3d2311b01c2031a83bb944e'),
      ('public.cockpit_form_client_version(text)', '05e4c13d86b4bdf808c1bed93a9e9d23', '4087f8f1b3fd759ecc8b0183a1db1fbd'),
      ('public.cockpit_form_stage4_input(uuid)', 'a40d17418bda54193c278e63ae524fcd', 'dcc471e64ccd7c3a024054537290fc6f'),
      ('public.cockpit_form_stage4_build(jsonb)', '5f52c05d01472cc80a9706f0d726a190', 'd2965481eba07d601ffd250715342bcd'),
      ('public.cockpit_form_invite_issue_core(text,text,text[],text,text,boolean,jsonb,uuid,text,jsonb)', 'da7a50edf7252dc8ff3deb2779348e9a', 'ba1e7b0240f5ab033b6f6ce9b4c2df2c'),
      ('public.cockpit_form_onboarding_typeform(jsonb)', 'ddefa9130061bc21b8b05c882d778d72', 'cb982b25868cf061dd336e9c49c06a12'),
      ('public.cockpit_form_editor_kind(public.cockpit_forms)', 'e3c824d512f8c313eae235bc31d71868', 'b6500a6819836d0584bdaeb218d76ecf'),
      ('public.cockpit_form_client_context(public.cockpit_form_invites)', '4c8c10adadf7908a8ae6a06472aa1d33', '92dcf3a241009f5dd08c9b2452da4a05')
    ) AS x(fn, live_md5, after_md5)
  LOOP
    v_now := NULL;
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_now
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(g.fn);
    IF v_now IS NULL OR v_now NOT IN (g.live_md5, g.after_md5) THEN
      RAISE EXCEPTION '% changed since 20261103b; stop and re-read it.', replace(g.fn, 'public.', '')
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

-- The onboarding's version 3 is free, or this file's own (a second apply).
DO $$
DECLARE v_md5 text;
BEGIN
  SELECT md5(v.schema::text) INTO v_md5 FROM public.cockpit_form_versions v WHERE v.form_key = 'onboarding' AND v.version = 3;
  IF v_md5 IS NOT NULL AND v_md5 <> '86966f19afcab5dca6f009e24ffe6802' THEN
    RAISE EXCEPTION 'The onboarding form already has a version 3 that is not this file''s (md5 %); stop and re-read it.', v_md5
      USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_form_versions v WHERE v.form_key = 'onboarding' AND v.version > 3) THEN
    RAISE EXCEPTION 'The onboarding form has a version after 3; stop and re-read it.' USING ERRCODE = '55000';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The language checks (1 above)

-- 20261102o's client form schema check, byte for byte under its own name: every schema in version 1.
CREATE OR REPLACE FUNCTION public.cockpit_form_schema_check_v1(p_schema jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f jsonb;
  o jsonb;
  c jsonb;
  d jsonb;
  k text;
  t text;
  v_keys text[] := '{}';
  v_ctx text[] := '{}';
  v_vals text[];
  v_n integer := 0;
  v_max integer;
  -- Waves 5-6 (20261102i): headings are shown, never answered, so a show-if, a read or a
  -- thank-you line names only the answered questions (v_keys); v_all holds every key.
  v_all text[] := '{}';
  v_bucket text[] := ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf'];
BEGIN
  IF jsonb_typeof(p_schema) IS DISTINCT FROM 'object' THEN
    RETURN 'The schema must be an object.';
  END IF;
  IF p_schema->'v' IS DISTINCT FROM '1'::jsonb THEN
    RETURN 'The schema must be client form schema version 1.';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_schema) LOOP
    IF k NOT IN ('v','key','title','intro','minutes','audience','signer','context','fields','reads','submit','done','doneIf','invite') THEN
      RETURN format('The schema has a part it does not know: %s.', left(k, 40));
    END IF;
  END LOOP;
  IF jsonb_typeof(p_schema->'key') IS DISTINCT FROM 'string' OR (p_schema->>'key') !~ '^[a-z][a-z0-9_]{1,30}$' THEN
    RETURN 'The schema needs the form''s key.';
  END IF;
  IF NOT public.cockpit_form_schema_pair(p_schema->'title', 200) THEN
    RETURN 'The title needs English and Arabic, each 200 characters at most.';
  END IF;
  IF p_schema ? 'intro' AND p_schema->'intro' <> 'null'::jsonb AND NOT public.cockpit_form_schema_pair(p_schema->'intro', 600) THEN
    RETURN 'The introduction needs English and Arabic, each 600 characters at most.';
  END IF;
  -- Up to an hour (waves 5-6): the native onboarding honestly takes about 25 minutes.
  IF jsonb_typeof(p_schema->'minutes') IS DISTINCT FROM 'number'
     OR (p_schema->>'minutes') !~ '^[0-9]{1,2}$' OR (p_schema->>'minutes')::integer NOT BETWEEN 1 AND 60 THEN
    RETURN 'Minutes must be a whole number from 1 to 60.';
  END IF;
  IF coalesce(p_schema->>'audience', '') NOT IN ('any','admin') OR jsonb_typeof(p_schema->'audience') <> 'string' THEN
    RETURN 'Who answers must be any or admin.';
  END IF;
  IF coalesce(p_schema->>'signer', '') NOT IN ('none','typed') OR jsonb_typeof(p_schema->'signer') <> 'string' THEN
    RETURN 'The signer must be none or typed.';
  END IF;

  -- Read-only facts shown from the invite's context.
  IF p_schema ? 'context' THEN
    IF jsonb_typeof(p_schema->'context') IS DISTINCT FROM 'array' OR jsonb_array_length(p_schema->'context') > 10 THEN
      RETURN 'The context is a list of at most 10 facts.';
    END IF;
    FOR c IN SELECT x FROM jsonb_array_elements(p_schema->'context') x LOOP
      IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR EXISTS (
           SELECT 1 FROM jsonb_object_keys(c) ck WHERE ck NOT IN ('key','type','label'))
         OR coalesce(c->>'key', '') !~ '^[a-z][a-zA-Z0-9]{1,30}$' OR jsonb_typeof(c->'key') <> 'string'
         OR coalesce(c->>'type', '') NOT IN ('date','text','number','boolean')
         OR NOT public.cockpit_form_schema_pair(c->'label', 200) THEN
        RETURN 'Each context fact needs a key, a type (date, text, number or boolean) and English and Arabic labels.';
      END IF;
      IF (c->>'key') = ANY(v_ctx) THEN
        RETURN format('Two context facts share the key %s.', c->>'key');
      END IF;
      v_ctx := v_ctx || (c->>'key');
    END LOOP;
  END IF;

  -- The questions, in order.
  IF jsonb_typeof(p_schema->'fields') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_schema->'fields') NOT BETWEEN 1 AND 40 THEN
    RETURN 'A form needs 1 to 40 questions.';
  END IF;
  FOR f IN SELECT x FROM jsonb_array_elements(p_schema->'fields') x LOOP
    v_n := v_n + 1;
    IF jsonb_typeof(f) IS DISTINCT FROM 'object' THEN
      RETURN format('Question %s is not an object.', v_n);
    END IF;
    k := CASE WHEN jsonb_typeof(f->'key') = 'string' THEN f->>'key' END;
    IF k IS NULL OR k !~ '^[a-z][a-zA-Z0-9]{1,30}$' THEN
      RETURN format('Question %s needs a key: a lowercase letter, then 1 to 30 letters or digits.', v_n);
    END IF;
    IF k = ANY(v_all) THEN
      RETURN format('Two questions share the key %s.', k);
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(f) fk
                WHERE fk NOT IN ('key','type','label','hint','required','min','max','lowLabel','highLabel',
                                 'options','maxLength','showIf','boldIf',
                                 'accept','maxBytes','notAfter','notBeforeDays','decimals','format')) THEN
      RETURN format('Question %s has a setting it does not know.', k);
    END IF;
    t := CASE WHEN jsonb_typeof(f->'type') = 'string' THEN f->>'type' END;
    IF t IS NULL OR t NOT IN ('scale','choice','multi','text','longtext','tick','file','date','number','heading') THEN
      RETURN format('Question %s has a type client forms do not know.', k);
    END IF;
    IF NOT public.cockpit_form_schema_pair(f->'label', 200) THEN
      RETURN format('Question %s needs an English and an Arabic label, each 200 characters at most.', k);
    END IF;
    IF f ? 'hint' AND f->'hint' <> 'null'::jsonb AND NOT public.cockpit_form_schema_pair(f->'hint', 600) THEN
      RETURN format('The hint of question %s needs English and Arabic, each 600 characters at most.', k);
    END IF;
    IF t = 'heading' THEN
      IF f ? 'required' AND f->'required' IS DISTINCT FROM 'false'::jsonb THEN
        RETURN format('Heading %s is shown, never answered, so it cannot be required.', k);
      END IF;
    ELSIF jsonb_typeof(f->'required') IS DISTINCT FROM 'boolean' THEN
      RETURN format('Question %s must say whether it is required.', k);
    END IF;

    -- Settings that belong to one type only.
    IF (t NOT IN ('scale','number') AND (f ? 'min' OR f ? 'max')) OR (t <> 'scale' AND (f ? 'lowLabel' OR f ? 'highLabel')) THEN
      RETURN format('Question %s has scale settings but is not a scale.', k);
    END IF;
    IF t <> 'number' AND f ? 'decimals' THEN
      RETURN format('Question %s has decimals but is not a number.', k);
    END IF;
    IF t <> 'file' AND (f ? 'accept' OR f ? 'maxBytes') THEN
      RETURN format('Question %s has file settings but is not a file.', k);
    END IF;
    IF t <> 'date' AND (f ? 'notAfter' OR f ? 'notBeforeDays') THEN
      RETURN format('Question %s has date limits but is not a date.', k);
    END IF;
    IF t <> 'text' AND f ? 'format' THEN
      RETURN format('Question %s has a text format but is not a short text.', k);
    END IF;
    IF t NOT IN ('choice','multi') AND f ? 'options' THEN
      RETURN format('Question %s has choices but is not a choice.', k);
    END IF;
    IF t NOT IN ('text','longtext') AND f ? 'maxLength' THEN
      RETURN format('Question %s has a length limit but is not a text.', k);
    END IF;
    IF t <> 'tick' AND f ? 'boldIf' AND f->'boldIf' <> 'null'::jsonb THEN
      RETURN format('Question %s can be bold only on a tick and a context fact.', k);
    END IF;

    IF t = 'scale' THEN
      IF jsonb_typeof(f->'min') IS DISTINCT FROM 'number' OR jsonb_typeof(f->'max') IS DISTINCT FROM 'number'
         OR (f->>'min')::numeric NOT IN (0, 1) OR (f->>'max')::numeric <> trunc((f->>'max')::numeric)
         OR (f->>'max')::numeric <= (f->>'min')::numeric OR (f->>'max')::numeric > 10 THEN
        RETURN format('Question %s needs a scale from 0 or 1 up to at most 10.', k);
      END IF;
      IF NOT public.cockpit_form_schema_pair(f->'lowLabel', 200) OR NOT public.cockpit_form_schema_pair(f->'highLabel', 200) THEN
        RETURN format('Question %s needs English and Arabic words for both ends of the scale.', k);
      END IF;
    ELSIF t IN ('choice','multi') THEN
      IF jsonb_typeof(f->'options') IS DISTINCT FROM 'array' OR jsonb_array_length(f->'options') NOT BETWEEN 2 AND 12 THEN
        RETURN format('Question %s needs 2 to 12 choices.', k);
      END IF;
      v_vals := '{}';
      FOR o IN SELECT x FROM jsonb_array_elements(f->'options') x LOOP
        IF jsonb_typeof(o) IS DISTINCT FROM 'object'
           OR (SELECT array_agg(ok ORDER BY ok) FROM jsonb_object_keys(o) ok) IS DISTINCT FROM ARRAY['label','value']
           OR jsonb_typeof(o->'value') IS DISTINCT FROM 'string' OR (o->>'value') !~ '^[a-z][a-z0-9_]{1,30}$'
           OR NOT public.cockpit_form_schema_pair(o->'label', 200) THEN
          RETURN format('Each choice of question %s needs a value and English and Arabic labels.', k);
        END IF;
        IF (o->>'value') = ANY(v_vals) THEN
          RETURN format('Question %s repeats the choice %s.', k, o->>'value');
        END IF;
        v_vals := v_vals || (o->>'value');
      END LOOP;
    ELSIF t IN ('text','longtext') THEN
      -- The client onboarding takes what KFRCXPFx took (20261102m): its longest stored answers are 431
      -- characters (a short text) and 2,695 (a long one). Every other form keeps 200 and 2,000.
      v_max := CASE WHEN p_schema->>'key' = 'onboarding' THEN CASE t WHEN 'text' THEN 1000 ELSE 10000 END
                    ELSE CASE t WHEN 'text' THEN 200 ELSE 2000 END END;
      IF f ? 'maxLength' AND (jsonb_typeof(f->'maxLength') IS DISTINCT FROM 'number'
           OR (f->>'maxLength')::numeric <> trunc((f->>'maxLength')::numeric)
           OR (f->>'maxLength')::numeric NOT BETWEEN 1 AND v_max) THEN
        RETURN format('Question %s allows at most %s characters.', k, v_max);
      END IF;
      IF f ? 'format' AND (jsonb_typeof(f->'format') IS DISTINCT FROM 'string'
                           OR f->>'format' NOT IN ('plain','url','email','phone')) THEN
        RETURN format('Question %s has a format that is not plain, url, email or phone.', k);
      END IF;
    ELSIF t = 'number' THEN
      IF jsonb_typeof(f->'min') IS DISTINCT FROM 'number' OR jsonb_typeof(f->'max') IS DISTINCT FROM 'number'
         OR (f->>'min')::numeric >= (f->>'max')::numeric
         OR abs((f->>'min')::numeric) > 1000000000 OR abs((f->>'max')::numeric) > 1000000000 THEN
        RETURN format('Question %s needs a lowest and a highest number, the lowest below the highest.', k);
      END IF;
      IF f ? 'decimals' AND (jsonb_typeof(f->'decimals') IS DISTINCT FROM 'number'
                             OR (f->>'decimals')::numeric NOT IN (0, 1, 2, 3)) THEN
        RETURN format('Question %s allows 0 to 3 decimals.', k);
      END IF;
    ELSIF t = 'date' THEN
      IF f ? 'notAfter' AND f->'notAfter' <> 'null'::jsonb AND f->'notAfter' IS DISTINCT FROM '"today"'::jsonb THEN
        RETURN format('Question %s can only stop at today.', k);
      END IF;
      IF f ? 'notBeforeDays' AND f->'notBeforeDays' <> 'null'::jsonb
         AND (jsonb_typeof(f->'notBeforeDays') IS DISTINCT FROM 'number'
              OR (f->>'notBeforeDays')::numeric <> trunc((f->>'notBeforeDays')::numeric)
              OR (f->>'notBeforeDays')::numeric NOT BETWEEN 1 AND 3650) THEN
        RETURN format('Question %s goes back 1 to 3,650 days.', k);
      END IF;
    ELSIF t = 'file' THEN
      IF jsonb_typeof(f->'accept') IS DISTINCT FROM 'array' OR jsonb_array_length(f->'accept') = 0
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(f->'accept') e
                     WHERE jsonb_typeof(e) <> 'string' OR NOT ((e #>> '{}') = ANY(v_bucket)))
         OR (SELECT count(DISTINCT e #>> '{}') FROM jsonb_array_elements(f->'accept') e) <> jsonb_array_length(f->'accept') THEN
        RETURN format('Question %s takes photos (JPG, PNG, WEBP, HEIC) or PDFs only, each named once.', k);
      END IF;
      IF jsonb_typeof(f->'maxBytes') IS DISTINCT FROM 'number'
         OR (f->>'maxBytes')::numeric <> trunc((f->>'maxBytes')::numeric)
         OR (f->>'maxBytes')::numeric NOT BETWEEN 1 AND 10485760 THEN
        RETURN format('Question %s takes files of 10 MB at most.', k);
      END IF;
    END IF;

    -- One equality on an earlier question.
    IF f ? 'showIf' AND f->'showIf' <> 'null'::jsonb THEN
      IF jsonb_typeof(f->'showIf') IS DISTINCT FROM 'object'
         OR (SELECT array_agg(sk ORDER BY sk) FROM jsonb_object_keys(f->'showIf') sk) IS DISTINCT FROM ARRAY['equals','key']
         OR jsonb_typeof(f->'showIf'->'key') IS DISTINCT FROM 'string'
         OR jsonb_typeof(f->'showIf'->'equals') NOT IN ('string','number','boolean') THEN
        RETURN format('Question %s shows on one answer of an earlier question: give its key and the answer.', k);
      END IF;
      IF NOT ((f->'showIf'->>'key') = ANY(v_keys)) THEN
        RETURN format('Question %s can only follow an earlier question, and %s is not before it.', k, left(f->'showIf'->>'key', 40));
      END IF;
    END IF;
    IF f ? 'boldIf' AND f->'boldIf' <> 'null'::jsonb THEN
      IF jsonb_typeof(f->'boldIf') IS DISTINCT FROM 'object'
         OR (SELECT array_agg(bk ORDER BY bk) FROM jsonb_object_keys(f->'boldIf') bk) IS DISTINCT FROM ARRAY['context','equals']
         OR jsonb_typeof(f->'boldIf'->'context') IS DISTINCT FROM 'string'
         OR (f->'boldIf'->>'context') !~ '^[a-z][a-zA-Z0-9]{1,30}$'
         OR jsonb_typeof(f->'boldIf'->'equals') NOT IN ('string','number','boolean') THEN
        RETURN format('Question %s can be bold only on a tick and a context fact.', k);
      END IF;
    END IF;
    v_all := v_all || k;
    IF t <> 'heading' THEN v_keys := v_keys || k; END IF;
  END LOOP;

  -- Which questions each effect reads (the editor's guard).
  IF p_schema ? 'reads' THEN
    IF jsonb_typeof(p_schema->'reads') IS DISTINCT FROM 'object' THEN
      RETURN 'The reads list must be an object of effect keys.';
    END IF;
    FOR k, d IN SELECT * FROM jsonb_each(p_schema->'reads') LOOP
      IF k !~ '^[a-z][a-z0-9_]{1,40}$' OR jsonb_typeof(d) IS DISTINCT FROM 'array' THEN
        RETURN 'The reads list must map effect keys to lists of questions.';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(d) e WHERE jsonb_typeof(e) <> 'string' OR NOT ((e #>> '{}') = ANY(v_keys))) THEN
        RETURN format('The reads list of %s names a question the form does not have.', k);
      END IF;
    END LOOP;
  END IF;

  IF NOT public.cockpit_form_schema_pair(p_schema->'submit', 200) THEN
    RETURN 'The send button needs English and Arabic words.';
  END IF;
  IF NOT public.cockpit_form_schema_pair(p_schema->'done', 600) THEN
    RETURN 'The thank-you line needs English and Arabic.';
  END IF;
  -- Another thank-you line for one answer (the pause consent's dates wrong).
  IF p_schema ? 'doneIf' THEN
    IF jsonb_typeof(p_schema->'doneIf') IS DISTINCT FROM 'array' OR jsonb_array_length(p_schema->'doneIf') > 3 THEN
      RETURN 'The other thank-you lines are a list of at most 3.';
    END IF;
    FOR d IN SELECT x FROM jsonb_array_elements(p_schema->'doneIf') x LOOP
      IF jsonb_typeof(d) IS DISTINCT FROM 'object'
         OR (SELECT array_agg(dk ORDER BY dk) FROM jsonb_object_keys(d) dk) IS DISTINCT FROM ARRAY['equals','key','text']
         OR jsonb_typeof(d->'key') IS DISTINCT FROM 'string' OR NOT ((d->>'key') = ANY(v_keys))
         OR jsonb_typeof(d->'equals') NOT IN ('string','number','boolean')
         OR NOT public.cockpit_form_schema_pair(d->'text', 600) THEN
        RETURN 'Each other thank-you line names a question, its answer and English and Arabic words.';
      END IF;
    END LOOP;
  END IF;

  -- The WhatsApp text and the phone alert (a form with no invite path has none).
  IF p_schema ? 'invite' THEN
    IF jsonb_typeof(p_schema->'invite') IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_schema->'invite') ik WHERE ik NOT IN ('whatsapp','push')) THEN
      RETURN 'The invite holds the WhatsApp text and the phone alert only.';
    END IF;
    IF p_schema->'invite' ? 'whatsapp' THEN
      IF NOT public.cockpit_form_schema_pair(p_schema->'invite'->'whatsapp', 1000) THEN
        RETURN 'The WhatsApp text needs English and Arabic, each 1,000 characters at most.';
      END IF;
      IF (char_length(p_schema->'invite'->'whatsapp'->>'en') - char_length(replace(p_schema->'invite'->'whatsapp'->>'en', '{form_link}', ''))) <> char_length('{form_link}')
         OR (char_length(p_schema->'invite'->'whatsapp'->>'ar') - char_length(replace(p_schema->'invite'->'whatsapp'->>'ar', '{form_link}', ''))) <> char_length('{form_link}') THEN
        RETURN 'The WhatsApp text needs {form_link} exactly once in each language.';
      END IF;
    END IF;
    IF p_schema->'invite' ? 'push' AND NOT public.cockpit_form_schema_pair(p_schema->'invite'->'push', 200) THEN
      RETURN 'The phone alert needs English and Arabic, each 200 characters at most.';
    END IF;
  END IF;
  RETURN NULL;
END $$;

-- NULL when the schema is a valid client form schema version 2, else its first problem as a sentence: version 1's
-- rules, with rows, notes, show-ifs on in and includes, currencyFrom, 64 questions and 30 choices on a several-
-- choices question. Only the client onboarding is written in it.
CREATE OR REPLACE FUNCTION public.cockpit_form_schema_check_v2(p_schema jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f jsonb;
  o jsonb;
  c jsonb;
  d jsonb;
  s jsonb;
  k text;
  t text;
  ck text;
  ct text;
  v_src text;
  v_keys text[] := '{}';
  v_all text[] := '{}';
  v_types jsonb := '{}'::jsonb;
  v_opts jsonb := '{}'::jsonb;
  v_ctx text[] := '{}';
  v_vals text[];
  v_cols text[];
  v_n integer := 0;
  v_max integer;
  v_cap integer;
  v_bucket text[] := ARRAY['image/jpeg','image/png','image/webp','image/heic','application/pdf'];
  -- A note's link goes only to these hosts (the portal keeps the same list).
  v_hosts text[] := ARRAY['app.leadsie.com'];
BEGIN
  -- Every {en, ar} text is read through coalesce(..., false): a missing text is refused, where version 1's
  -- NOT cockpit_form_schema_pair(NULL) reads NULL and lets it pass.
  IF jsonb_typeof(p_schema) IS DISTINCT FROM 'object' THEN
    RETURN 'The schema must be an object.';
  END IF;
  IF p_schema->'v' IS DISTINCT FROM '2'::jsonb THEN
    RETURN 'The schema must be client form schema version 2.';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_schema) LOOP
    IF k NOT IN ('v','key','title','intro','minutes','audience','signer','context','fields','reads','submit','done','doneIf','invite') THEN
      RETURN format('The schema has a part it does not know: %s.', left(k, 40));
    END IF;
  END LOOP;
  IF jsonb_typeof(p_schema->'key') IS DISTINCT FROM 'string' OR (p_schema->>'key') IS DISTINCT FROM 'onboarding' THEN
    RETURN 'Client form schema version 2 is the client onboarding''s only.';
  END IF;
  IF NOT coalesce(public.cockpit_form_schema_pair(p_schema->'title', 200), false) THEN
    RETURN 'The title needs English and Arabic, each 200 characters at most.';
  END IF;
  IF p_schema ? 'intro' AND p_schema->'intro' <> 'null'::jsonb AND NOT coalesce(public.cockpit_form_schema_pair(p_schema->'intro', 600), false) THEN
    RETURN 'The introduction needs English and Arabic, each 600 characters at most.';
  END IF;
  IF jsonb_typeof(p_schema->'minutes') IS DISTINCT FROM 'number'
     OR (p_schema->>'minutes') !~ '^[0-9]{1,2}$' OR (p_schema->>'minutes')::integer NOT BETWEEN 1 AND 60 THEN
    RETURN 'Minutes must be a whole number from 1 to 60.';
  END IF;
  IF coalesce(p_schema->>'audience', '') NOT IN ('any','admin') OR jsonb_typeof(p_schema->'audience') <> 'string' THEN
    RETURN 'Who answers must be any or admin.';
  END IF;
  IF coalesce(p_schema->>'signer', '') NOT IN ('none','typed') OR jsonb_typeof(p_schema->'signer') <> 'string' THEN
    RETURN 'The signer must be none or typed.';
  END IF;
  IF p_schema ? 'context' THEN
    IF jsonb_typeof(p_schema->'context') IS DISTINCT FROM 'array' OR jsonb_array_length(p_schema->'context') > 10 THEN
      RETURN 'The context is a list of at most 10 facts.';
    END IF;
    FOR c IN SELECT x FROM jsonb_array_elements(p_schema->'context') x LOOP
      IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR EXISTS (
           SELECT 1 FROM jsonb_object_keys(c) cx WHERE cx NOT IN ('key','type','label'))
         OR coalesce(c->>'key', '') !~ '^[a-z][a-zA-Z0-9]{1,30}$' OR jsonb_typeof(c->'key') <> 'string'
         OR coalesce(c->>'type', '') NOT IN ('date','text','number','boolean')
         OR NOT coalesce(public.cockpit_form_schema_pair(c->'label', 200), false) THEN
        RETURN 'Each context fact needs a key, a type (date, text, number or boolean) and English and Arabic labels.';
      END IF;
      IF (c->>'key') = ANY(v_ctx) THEN
        RETURN format('Two context facts share the key %s.', c->>'key');
      END IF;
      v_ctx := v_ctx || (c->>'key');
    END LOOP;
  END IF;

  -- The questions, in order.
  IF jsonb_typeof(p_schema->'fields') IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_schema->'fields') NOT BETWEEN 1 AND 64 THEN
    RETURN 'A structured form needs 1 to 64 questions.';
  END IF;
  FOR f IN SELECT x FROM jsonb_array_elements(p_schema->'fields') x LOOP
    v_n := v_n + 1;
    IF jsonb_typeof(f) IS DISTINCT FROM 'object' THEN
      RETURN format('Question %s is not an object.', v_n);
    END IF;
    k := CASE WHEN jsonb_typeof(f->'key') = 'string' THEN f->>'key' END;
    IF k IS NULL OR k !~ '^[a-z][a-zA-Z0-9]{1,30}$' THEN
      RETURN format('Question %s needs a key: a lowercase letter, then 1 to 30 letters or digits.', v_n);
    END IF;
    IF k = ANY(v_all) THEN
      RETURN format('Two questions share the key %s.', k);
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(f) fk
                WHERE fk NOT IN ('key','type','label','hint','required','min','max','lowLabel','highLabel',
                                 'options','maxLength','showIf','boldIf',
                                 'accept','maxBytes','notAfter','notBeforeDays','decimals','format',
                                 'columns','minRows','maxRows','addLabel','link','currencyFrom')) THEN
      RETURN format('Question %s has a setting it does not know.', k);
    END IF;
    t := CASE WHEN jsonb_typeof(f->'type') = 'string' THEN f->>'type' END;
    IF t IS NULL OR t NOT IN ('scale','choice','multi','text','longtext','tick','file','date','number','heading','rows','note') THEN
      RETURN format('Question %s has a type client forms do not know.', k);
    END IF;
    IF NOT coalesce(public.cockpit_form_schema_pair(f->'label', CASE WHEN t = 'note' THEN 300 ELSE 200 END), false) THEN
      RETURN format('Question %s needs an English and an Arabic label, each %s characters at most.', k,
                    CASE WHEN t = 'note' THEN 300 ELSE 200 END);
    END IF;
    IF f ? 'hint' AND f->'hint' <> 'null'::jsonb AND NOT coalesce(public.cockpit_form_schema_pair(f->'hint', 600), false) THEN
      RETURN format('The hint of question %s needs English and Arabic, each 600 characters at most.', k);
    END IF;
    IF t IN ('heading','note') THEN
      IF f ? 'required' AND f->'required' IS DISTINCT FROM 'false'::jsonb THEN
        RETURN format('%s %s is shown, never answered, so it cannot be required.', CASE t WHEN 'heading' THEN 'Heading' ELSE 'Note' END, k);
      END IF;
    ELSIF jsonb_typeof(f->'required') IS DISTINCT FROM 'boolean' THEN
      RETURN format('Question %s must say whether it is required.', k);
    END IF;

    -- Settings that belong to one type only.
    IF (t NOT IN ('scale','number') AND (f ? 'min' OR f ? 'max')) OR (t <> 'scale' AND (f ? 'lowLabel' OR f ? 'highLabel')) THEN
      RETURN format('Question %s has scale settings but is not a scale.', k);
    END IF;
    IF t <> 'number' AND f ? 'decimals' THEN
      RETURN format('Question %s has decimals but is not a number.', k);
    END IF;
    IF t <> 'file' AND (f ? 'accept' OR f ? 'maxBytes') THEN
      RETURN format('Question %s has file settings but is not a file.', k);
    END IF;
    IF t <> 'date' AND (f ? 'notAfter' OR f ? 'notBeforeDays') THEN
      RETURN format('Question %s has date limits but is not a date.', k);
    END IF;
    IF t <> 'text' AND f ? 'format' THEN
      RETURN format('Question %s has a text format but is not a short text.', k);
    END IF;
    IF t NOT IN ('choice','multi') AND f ? 'options' THEN
      RETURN format('Question %s has choices but is not a choice.', k);
    END IF;
    IF t NOT IN ('text','longtext') AND f ? 'maxLength' THEN
      RETURN format('Question %s has a length limit but is not a text.', k);
    END IF;
    IF t <> 'tick' AND f ? 'boldIf' AND f->'boldIf' <> 'null'::jsonb THEN
      RETURN format('Question %s can be bold only on a tick and a context fact.', k);
    END IF;
    IF t <> 'rows' AND (f ? 'columns' OR f ? 'minRows' OR f ? 'maxRows' OR f ? 'addLabel') THEN
      RETURN format('Question %s has row settings but is not a rows question.', k);
    END IF;
    IF t <> 'note' AND f ? 'link' THEN
      RETURN format('Question %s has a link but is not a note.', k);
    END IF;
    IF t <> 'number' AND f ? 'currencyFrom' THEN
      RETURN format('Question %s reads a currency but is not a number.', k);
    END IF;

    IF t = 'scale' THEN
      IF jsonb_typeof(f->'min') IS DISTINCT FROM 'number' OR jsonb_typeof(f->'max') IS DISTINCT FROM 'number'
         OR (f->>'min')::numeric NOT IN (0, 1) OR (f->>'max')::numeric <> trunc((f->>'max')::numeric)
         OR (f->>'max')::numeric <= (f->>'min')::numeric OR (f->>'max')::numeric > 10 THEN
        RETURN format('Question %s needs a scale from 0 or 1 up to at most 10.', k);
      END IF;
      IF NOT coalesce(public.cockpit_form_schema_pair(f->'lowLabel', 200), false) OR NOT coalesce(public.cockpit_form_schema_pair(f->'highLabel', 200), false) THEN
        RETURN format('Question %s needs English and Arabic words for both ends of the scale.', k);
      END IF;
    ELSIF t IN ('choice','multi') THEN
      v_cap := CASE t WHEN 'multi' THEN 30 ELSE 12 END;
      IF jsonb_typeof(f->'options') IS DISTINCT FROM 'array' OR jsonb_array_length(f->'options') NOT BETWEEN 2 AND v_cap THEN
        RETURN format('Question %s needs 2 to %s choices.', k, v_cap);
      END IF;
      v_vals := '{}';
      FOR o IN SELECT x FROM jsonb_array_elements(f->'options') x LOOP
        IF jsonb_typeof(o) IS DISTINCT FROM 'object'
           OR (SELECT array_agg(ok ORDER BY ok) FROM jsonb_object_keys(o) ok) IS DISTINCT FROM ARRAY['label','value']
           OR jsonb_typeof(o->'value') IS DISTINCT FROM 'string' OR (o->>'value') !~ '^[a-z][a-z0-9_]{1,30}$'
           OR NOT coalesce(public.cockpit_form_schema_pair(o->'label', 200), false) THEN
          RETURN format('Each choice of question %s needs a value and English and Arabic labels.', k);
        END IF;
        IF (o->>'value') = ANY(v_vals) THEN
          RETURN format('Question %s repeats the choice %s.', k, o->>'value');
        END IF;
        v_vals := v_vals || (o->>'value');
      END LOOP;
      v_opts := v_opts || jsonb_build_object(k, to_jsonb(v_vals));
    ELSIF t IN ('text','longtext') THEN
      v_max := CASE t WHEN 'text' THEN 1000 ELSE 10000 END;
      IF f ? 'maxLength' AND (jsonb_typeof(f->'maxLength') IS DISTINCT FROM 'number'
           OR (f->>'maxLength')::numeric <> trunc((f->>'maxLength')::numeric)
           OR (f->>'maxLength')::numeric NOT BETWEEN 1 AND v_max) THEN
        RETURN format('Question %s allows at most %s characters.', k, v_max);
      END IF;
      IF f ? 'format' AND (jsonb_typeof(f->'format') IS DISTINCT FROM 'string'
                           OR f->>'format' NOT IN ('plain','url','email','phone')) THEN
        RETURN format('Question %s has a format that is not plain, url, email or phone.', k);
      END IF;
    ELSIF t = 'number' THEN
      IF jsonb_typeof(f->'min') IS DISTINCT FROM 'number' OR jsonb_typeof(f->'max') IS DISTINCT FROM 'number'
         OR (f->>'min')::numeric >= (f->>'max')::numeric
         OR abs((f->>'min')::numeric) > 1000000000 OR abs((f->>'max')::numeric) > 1000000000 THEN
        RETURN format('Question %s needs a lowest and a highest number, the lowest below the highest.', k);
      END IF;
      IF f ? 'decimals' AND (jsonb_typeof(f->'decimals') IS DISTINCT FROM 'number'
                             OR (f->>'decimals')::numeric NOT IN (0, 1, 2, 3)) THEN
        RETURN format('Question %s allows 0 to 3 decimals.', k);
      END IF;
      IF f ? 'currencyFrom' AND (jsonb_typeof(f->'currencyFrom') IS DISTINCT FROM 'string'
                                 OR v_types->>(f->>'currencyFrom') IS DISTINCT FROM 'choice') THEN
        RETURN format('Question %s reads its currency from %s, which is not an earlier choice question.', k,
                      left(coalesce(f->>'currencyFrom', '(none)'), 40));
      END IF;
    ELSIF t = 'date' THEN
      IF f ? 'notAfter' AND f->'notAfter' <> 'null'::jsonb AND f->'notAfter' IS DISTINCT FROM '"today"'::jsonb THEN
        RETURN format('Question %s can only stop at today.', k);
      END IF;
      IF f ? 'notBeforeDays' AND f->'notBeforeDays' <> 'null'::jsonb
         AND (jsonb_typeof(f->'notBeforeDays') IS DISTINCT FROM 'number'
              OR (f->>'notBeforeDays')::numeric <> trunc((f->>'notBeforeDays')::numeric)
              OR (f->>'notBeforeDays')::numeric NOT BETWEEN 1 AND 3650) THEN
        RETURN format('Question %s goes back 1 to 3,650 days.', k);
      END IF;
    ELSIF t = 'file' THEN
      IF jsonb_typeof(f->'accept') IS DISTINCT FROM 'array' OR jsonb_array_length(f->'accept') = 0
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(f->'accept') e
                     WHERE jsonb_typeof(e) <> 'string' OR NOT ((e #>> '{}') = ANY(v_bucket)))
         OR (SELECT count(DISTINCT e #>> '{}') FROM jsonb_array_elements(f->'accept') e) <> jsonb_array_length(f->'accept') THEN
        RETURN format('Question %s takes photos (JPG, PNG, WEBP, HEIC) or PDFs only, each named once.', k);
      END IF;
      IF jsonb_typeof(f->'maxBytes') IS DISTINCT FROM 'number'
         OR (f->>'maxBytes')::numeric <> trunc((f->>'maxBytes')::numeric)
         OR (f->>'maxBytes')::numeric NOT BETWEEN 1 AND 10485760 THEN
        RETURN format('Question %s takes files of 10 MB at most.', k);
      END IF;
    ELSIF t = 'rows' THEN
      IF jsonb_typeof(f->'columns') IS DISTINCT FROM 'array' OR jsonb_array_length(f->'columns') NOT BETWEEN 1 AND 6 THEN
        RETURN format('Question %s needs 1 to 6 columns.', k);
      END IF;
      v_cols := '{}';
      FOR c IN SELECT x FROM jsonb_array_elements(f->'columns') x LOOP
        ck := CASE WHEN jsonb_typeof(c->'key') = 'string' THEN c->>'key' END;
        ct := CASE WHEN jsonb_typeof(c->'type') = 'string' THEN c->>'type' END;
        IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR ck IS NULL OR ck !~ '^[a-z][a-zA-Z0-9]{1,30}$'
           OR EXISTS (SELECT 1 FROM jsonb_object_keys(c) cx
                       WHERE cx NOT IN ('key','type','label','hint','required','maxLength','min','max','decimals','options','currencyFrom'))
           OR ct IS NULL OR ct NOT IN ('text','longtext','number','choice','tick')
           OR NOT coalesce(public.cockpit_form_schema_pair(c->'label', 200), false)
           OR jsonb_typeof(c->'required') IS DISTINCT FROM 'boolean' THEN
          RETURN format('Each column of question %s needs a key, a type (text, longtext, number, choice or tick), English and Arabic labels and whether it is required.', k);
        END IF;
        IF ck = ANY(v_cols) THEN
          RETURN format('Question %s has two columns called %s.', k, ck);
        END IF;
        IF c ? 'hint' AND c->'hint' <> 'null'::jsonb AND NOT coalesce(public.cockpit_form_schema_pair(c->'hint', 600), false) THEN
          RETURN format('The hint of column %s of question %s needs English and Arabic, each 600 characters at most.', ck, k);
        END IF;
        IF (ct NOT IN ('text','longtext') AND c ? 'maxLength') OR (ct <> 'number' AND (c ? 'min' OR c ? 'max' OR c ? 'decimals' OR c ? 'currencyFrom'))
           OR (ct <> 'choice' AND c ? 'options') THEN
          RETURN format('Column %s of question %s has a setting its type does not take.', ck, k);
        END IF;
        IF ct IN ('text','longtext') AND c ? 'maxLength' AND (jsonb_typeof(c->'maxLength') IS DISTINCT FROM 'number'
             OR (c->>'maxLength')::numeric <> trunc((c->>'maxLength')::numeric)
             OR (c->>'maxLength')::numeric NOT BETWEEN 1 AND CASE ct WHEN 'text' THEN 1000 ELSE 10000 END) THEN
          RETURN format('Column %s of question %s allows at most %s characters.', ck, k, CASE ct WHEN 'text' THEN 1000 ELSE 10000 END);
        END IF;
        IF ct = 'number' THEN
          IF jsonb_typeof(c->'min') IS DISTINCT FROM 'number' OR jsonb_typeof(c->'max') IS DISTINCT FROM 'number'
             OR (c->>'min')::numeric >= (c->>'max')::numeric
             OR abs((c->>'min')::numeric) > 1000000000 OR abs((c->>'max')::numeric) > 1000000000 THEN
            RETURN format('Column %s of question %s needs a lowest and a highest number, the lowest below the highest.', ck, k);
          END IF;
          IF c ? 'decimals' AND (jsonb_typeof(c->'decimals') IS DISTINCT FROM 'number'
                                 OR (c->>'decimals')::numeric NOT IN (0, 1, 2, 3)) THEN
            RETURN format('Column %s of question %s allows 0 to 3 decimals.', ck, k);
          END IF;
          IF c ? 'currencyFrom' AND (jsonb_typeof(c->'currencyFrom') IS DISTINCT FROM 'string'
                                     OR v_types->>(c->>'currencyFrom') IS DISTINCT FROM 'choice') THEN
            RETURN format('Column %s of question %s reads its currency from %s, which is not an earlier choice question.', ck, k,
                          left(coalesce(c->>'currencyFrom', '(none)'), 40));
          END IF;
        ELSIF ct = 'choice' THEN
          IF jsonb_typeof(c->'options') IS DISTINCT FROM 'array' OR jsonb_array_length(c->'options') NOT BETWEEN 2 AND 12 THEN
            RETURN format('Column %s of question %s needs 2 to 12 choices.', ck, k);
          END IF;
          v_vals := '{}';
          FOR o IN SELECT x FROM jsonb_array_elements(c->'options') x LOOP
            IF jsonb_typeof(o) IS DISTINCT FROM 'object'
               OR (SELECT array_agg(ok ORDER BY ok) FROM jsonb_object_keys(o) ok) IS DISTINCT FROM ARRAY['label','value']
               OR jsonb_typeof(o->'value') IS DISTINCT FROM 'string' OR (o->>'value') !~ '^[a-z][a-z0-9_]{1,30}$'
               OR NOT coalesce(public.cockpit_form_schema_pair(o->'label', 200), false) OR (o->>'value') = ANY(v_vals) THEN
              RETURN format('Each choice of column %s of question %s needs its own value and English and Arabic labels.', ck, k);
            END IF;
            v_vals := v_vals || (o->>'value');
          END LOOP;
        END IF;
        v_cols := v_cols || ck;
      END LOOP;
      IF (f ? 'minRows' AND (jsonb_typeof(f->'minRows') IS DISTINCT FROM 'number' OR (f->>'minRows') !~ '^[0-9]{1,2}$'
                             OR (f->>'minRows')::integer > 30))
         OR jsonb_typeof(f->'maxRows') IS DISTINCT FROM 'number' OR (f->>'maxRows') !~ '^[0-9]{1,2}$'
         OR (f->>'maxRows')::integer NOT BETWEEN 1 AND 30
         OR coalesce((f->>'minRows')::integer, 0) > (f->>'maxRows')::integer THEN
        RETURN format('Question %s takes from 0 to 30 rows, the fewest no more than the most.', k);
      END IF;
      IF NOT coalesce(public.cockpit_form_schema_pair(f->'addLabel', 60), false) THEN
        RETURN format('Question %s needs English and Arabic words for adding a row, each 60 characters at most.', k);
      END IF;
    ELSIF t = 'note' AND f ? 'link' AND f->'link' <> 'null'::jsonb THEN
      IF jsonb_typeof(f->'link') IS DISTINCT FROM 'object'
         OR (SELECT array_agg(lk ORDER BY lk) FROM jsonb_object_keys(f->'link') lk) IS DISTINCT FROM ARRAY['href','label']
         OR jsonb_typeof(f->'link'->'href') IS DISTINCT FROM 'string' OR char_length(f->'link'->>'href') > 500
         OR (f->'link'->>'href') !~ '^https://[^/?#\s]+(/[^\s]*)?$'
         OR NOT (lower(substring(f->'link'->>'href' FROM '^https://([^/?#\s:]+)')) = ANY(v_hosts))
         OR NOT coalesce(public.cockpit_form_schema_pair(f->'link'->'label', 60), false) THEN
        RETURN format('The link of note %s must be https on %s, with English and Arabic words of 60 characters at most.', k,
                      array_to_string(v_hosts, ', '));
      END IF;
    END IF;

    -- One show-if on an earlier answered question: equals one answer, in (1 to 12 choices of a choice question) or
    -- includes (one choice of a several-choices question).
    IF f ? 'showIf' AND f->'showIf' <> 'null'::jsonb THEN
      s := f->'showIf';
      IF jsonb_typeof(s) IS DISTINCT FROM 'object' OR jsonb_typeof(s->'key') IS DISTINCT FROM 'string'
         OR (SELECT array_agg(sk ORDER BY sk) FROM jsonb_object_keys(s) sk) NOT IN (ARRAY['equals','key'], ARRAY['in','key'], ARRAY['includes','key']) THEN
        RETURN format('Question %s shows on one earlier question: give its key and one of equals, in or includes.', k);
      END IF;
      v_src := s->>'key';
      IF NOT (v_src = ANY(v_keys)) THEN
        RETURN format('Question %s can only follow an earlier question, and %s is not before it.', k, left(v_src, 40));
      END IF;
      IF s ? 'equals' AND jsonb_typeof(s->'equals') NOT IN ('string','number','boolean') THEN
        RETURN format('Question %s shows on one answer of an earlier question: give its key and the answer.', k);
      END IF;
      IF s ? 'in' AND (v_types->>v_src IS DISTINCT FROM 'choice' OR jsonb_typeof(s->'in') IS DISTINCT FROM 'array'
                       OR jsonb_array_length(s->'in') NOT BETWEEN 1 AND 12
                       OR EXISTS (SELECT 1 FROM jsonb_array_elements(s->'in') e
                                   WHERE jsonb_typeof(e) <> 'string' OR NOT (v_opts->v_src ? (e #>> '{}')))) THEN
        RETURN format('Question %s shows on in: 1 to 12 choices of the earlier choice question %s.', k, left(v_src, 40));
      END IF;
      IF s ? 'includes' AND (v_types->>v_src IS DISTINCT FROM 'multi' OR jsonb_typeof(s->'includes') IS DISTINCT FROM 'string'
                             OR NOT (v_opts->v_src ? (s->>'includes'))) THEN
        RETURN format('Question %s shows on includes: one choice of the earlier several-choices question %s.', k, left(v_src, 40));
      END IF;
    END IF;
    IF f ? 'boldIf' AND f->'boldIf' <> 'null'::jsonb THEN
      IF jsonb_typeof(f->'boldIf') IS DISTINCT FROM 'object'
         OR (SELECT array_agg(bk ORDER BY bk) FROM jsonb_object_keys(f->'boldIf') bk) IS DISTINCT FROM ARRAY['context','equals']
         OR jsonb_typeof(f->'boldIf'->'context') IS DISTINCT FROM 'string'
         OR (f->'boldIf'->>'context') !~ '^[a-z][a-zA-Z0-9]{1,30}$'
         OR jsonb_typeof(f->'boldIf'->'equals') NOT IN ('string','number','boolean') THEN
        RETURN format('Question %s can be bold only on a tick and a context fact.', k);
      END IF;
    END IF;
    v_all := v_all || k;
    IF t NOT IN ('heading','note') THEN
      v_keys := v_keys || k;
      v_types := v_types || jsonb_build_object(k, t);
    END IF;
  END LOOP;

  -- Which questions each effect reads (the editor's guard).
  IF p_schema ? 'reads' THEN
    IF jsonb_typeof(p_schema->'reads') IS DISTINCT FROM 'object' THEN
      RETURN 'The reads list must be an object of effect keys.';
    END IF;
    FOR k, d IN SELECT * FROM jsonb_each(p_schema->'reads') LOOP
      IF k !~ '^[a-z][a-z0-9_]{1,40}$' OR jsonb_typeof(d) IS DISTINCT FROM 'array' THEN
        RETURN 'The reads list must map effect keys to lists of questions.';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(d) e WHERE jsonb_typeof(e) <> 'string' OR NOT ((e #>> '{}') = ANY(v_keys))) THEN
        RETURN format('The reads list of %s names a question the form does not have.', k);
      END IF;
    END LOOP;
  END IF;

  IF NOT coalesce(public.cockpit_form_schema_pair(p_schema->'submit', 200), false) THEN
    RETURN 'The send button needs English and Arabic words.';
  END IF;
  IF NOT coalesce(public.cockpit_form_schema_pair(p_schema->'done', 600), false) THEN
    RETURN 'The thank-you line needs English and Arabic.';
  END IF;
  IF p_schema ? 'doneIf' THEN
    IF jsonb_typeof(p_schema->'doneIf') IS DISTINCT FROM 'array' OR jsonb_array_length(p_schema->'doneIf') > 3 THEN
      RETURN 'The other thank-you lines are a list of at most 3.';
    END IF;
    FOR d IN SELECT x FROM jsonb_array_elements(p_schema->'doneIf') x LOOP
      IF jsonb_typeof(d) IS DISTINCT FROM 'object'
         OR (SELECT array_agg(dk ORDER BY dk) FROM jsonb_object_keys(d) dk) IS DISTINCT FROM ARRAY['equals','key','text']
         OR jsonb_typeof(d->'key') IS DISTINCT FROM 'string' OR NOT ((d->>'key') = ANY(v_keys))
         OR jsonb_typeof(d->'equals') NOT IN ('string','number','boolean')
         OR NOT coalesce(public.cockpit_form_schema_pair(d->'text', 600), false) THEN
        RETURN 'Each other thank-you line names a question, its answer and English and Arabic words.';
      END IF;
    END LOOP;
  END IF;
  IF p_schema ? 'invite' THEN
    IF jsonb_typeof(p_schema->'invite') IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_schema->'invite') ik WHERE ik NOT IN ('whatsapp','push')) THEN
      RETURN 'The invite holds the WhatsApp text and the phone alert only.';
    END IF;
    IF p_schema->'invite' ? 'whatsapp' THEN
      IF NOT coalesce(public.cockpit_form_schema_pair(p_schema->'invite'->'whatsapp', 1000), false) THEN
        RETURN 'The WhatsApp text needs English and Arabic, each 1,000 characters at most.';
      END IF;
      IF (char_length(p_schema->'invite'->'whatsapp'->>'en') - char_length(replace(p_schema->'invite'->'whatsapp'->>'en', '{form_link}', ''))) <> char_length('{form_link}')
         OR (char_length(p_schema->'invite'->'whatsapp'->>'ar') - char_length(replace(p_schema->'invite'->'whatsapp'->>'ar', '{form_link}', ''))) <> char_length('{form_link}') THEN
        RETURN 'The WhatsApp text needs {form_link} exactly once in each language.';
      END IF;
    END IF;
    IF p_schema->'invite' ? 'push' AND NOT coalesce(public.cockpit_form_schema_pair(p_schema->'invite'->'push', 200), false) THEN
      RETURN 'The phone alert needs English and Arabic, each 200 characters at most.';
    END IF;
  END IF;
  RETURN NULL;
END $$;

-- The one schema check every caller reads (issue, go-live, the canary, the editor, the version rows): version 2 to
-- its own check, everything else to 20261102o's, byte for byte.
CREATE OR REPLACE FUNCTION public.cockpit_form_schema_check(p_schema jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- 20261103h: client form schema version 2 (the structured onboarding) has its own check; every other schema is
  -- checked by 20261102o's version-1 check, now cockpit_form_schema_check_v1, byte for byte.
  IF jsonb_typeof(p_schema) = 'object' AND p_schema->'v' = '2'::jsonb THEN
    RETURN public.cockpit_form_schema_check_v2(p_schema);
  END IF;
  RETURN public.cockpit_form_schema_check_v1(p_schema);
END $$;

-- 20261102o's client form answers check, byte for byte under its own name: every answer to a version-1 schema.
CREATE OR REPLACE FUNCTION public.cockpit_form_answers_check_v1(p_schema jsonb, p_answers jsonb, p_context jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_answers jsonb := CASE WHEN jsonb_typeof(p_answers) = 'object' THEN p_answers ELSE '{}'::jsonb END;
  v_errors jsonb := '{}'::jsonb;
  v_out jsonb := '{}'::jsonb;
  v_types jsonb := '{}'::jsonb;
  v_keys text[] := '{}';
  f jsonb;
  k text;
  t text;
  v jsonb;
  v_cmp jsonb;
  v_vis boolean;
  v_req boolean;
  v_s text;
  v_num numeric;
  v_ok boolean;
  -- Waves 5-6 (20261102i): numbers, dates and files.
  v_today date := public.cockpit_form_kuwait_day(now());
  v_d date;
  v_dec integer;
  v_code text;
  v_path text;
  v_meta jsonb;
  v_slot record;
BEGIN
  FOR f IN SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_schema->'fields') = 'array'
                                                  THEN p_schema->'fields' ELSE '[]'::jsonb END) x LOOP
    k := f->>'key';
    t := f->>'type';
    CONTINUE WHEN k IS NULL;
    v_keys := v_keys || k;
    v_types := v_types || jsonb_build_object(k, t);
    v_req := coalesce(f->>'required', '') = 'true';
    v_vis := true;
    IF jsonb_typeof(f->'showIf') = 'object' THEN
      v_cmp := v_out -> (f->'showIf'->>'key');
      IF v_cmp IS NULL AND v_types->>(f->'showIf'->>'key') = 'tick' THEN
        v_cmp := 'false'::jsonb;
      END IF;
      v_vis := v_cmp IS NOT NULL AND v_cmp = f->'showIf'->'equals';
    END IF;
    v := v_answers -> k;
    IF v = 'null'::jsonb THEN v := NULL; END IF;
    -- A heading is shown, never answered.
    IF t = 'heading' THEN
      IF v IS NOT NULL THEN v_errors := v_errors || jsonb_build_object(k, 'unknown'); END IF;
      CONTINUE;
    END IF;
    IF NOT v_vis THEN
      IF v IS NOT NULL THEN v_errors := v_errors || jsonb_build_object(k, 'hidden'); END IF;
      CONTINUE;
    END IF;
    -- Blank: missing, an empty or blank text, an empty list.
    IF v IS NULL OR (jsonb_typeof(v) = 'string' AND btrim(regexp_replace(v #>> '{}', '\s+', ' ', 'g')) = '')
       OR (jsonb_typeof(v) = 'array' AND jsonb_array_length(v) = 0) THEN
      IF v_req THEN v_errors := v_errors || jsonb_build_object(k, CASE WHEN t = 'file' THEN 'file_missing' ELSE 'required' END); END IF;
      CONTINUE;
    END IF;
    CASE t
      WHEN 'scale' THEN
        v_ok := jsonb_typeof(v) = 'number';
        IF v_ok THEN
          v_num := (v #>> '{}')::numeric;
          v_ok := v_num = trunc(v_num) AND v_num >= (f->>'min')::numeric AND v_num <= (f->>'max')::numeric;
        END IF;
        IF v_ok THEN v_out := v_out || jsonb_build_object(k, v_num::integer);
        ELSE v_errors := v_errors || jsonb_build_object(k, 'range'); END IF;
      WHEN 'choice' THEN
        IF jsonb_typeof(v) = 'string' AND EXISTS (SELECT 1 FROM jsonb_array_elements(f->'options') o WHERE o->>'value' = v #>> '{}') THEN
          v_out := v_out || jsonb_build_object(k, v);
        ELSE v_errors := v_errors || jsonb_build_object(k, 'option'); END IF;
      WHEN 'multi' THEN
        IF jsonb_typeof(v) = 'array'
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) e
                            WHERE jsonb_typeof(e) <> 'string'
                               OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(f->'options') o WHERE o->>'value' = e #>> '{}'))
           AND (SELECT count(DISTINCT e #>> '{}') FROM jsonb_array_elements(v) e) = jsonb_array_length(v) THEN
          v_out := v_out || jsonb_build_object(k, v);
        ELSE v_errors := v_errors || jsonb_build_object(k, 'option'); END IF;
      WHEN 'text', 'longtext' THEN
        IF jsonb_typeof(v) <> 'string' THEN
          v_errors := v_errors || jsonb_build_object(k, 'required');
        ELSE
          -- The client onboarding keeps an answer as Typeform keeps it for Make (20261102m): its line
          -- breaks and spaces as typed. Every other form folds each run of white space to one space.
          v_s := CASE WHEN p_schema->>'key' = 'onboarding' THEN public.cockpit_form_typeform_text(v #>> '{}')
                      ELSE btrim(regexp_replace(v #>> '{}', '\s+', ' ', 'g')) END;
          IF v_s = '' THEN
            -- Only white space the fold above does not see (a no-break space, say): blank.
            IF v_req THEN v_errors := v_errors || jsonb_build_object(k, 'required'); END IF;
          ELSIF char_length(v_s) > coalesce((f->>'maxLength')::integer, CASE t WHEN 'text' THEN 200 ELSE 2000 END) THEN
            v_errors := v_errors || jsonb_build_object(k, 'length');
          ELSIF t = 'text' AND f->>'format' = 'phone' AND p_schema->>'key' = 'onboarding' THEN
            -- The client onboarding stores a phone as E.164, as KFRCXPFx's phone_number question handed
            -- it to Make (20261102m, 13): spaces (direction marks too), dashes, dots and brackets out,
            -- Arabic-Indic digits as digits, a leading 00 as +, then "+" and 8 to 15 digits. A number
            -- with no country code is refused with the phone code (format).
            v_s := translate(translate(v_s, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
                             E' \t\n\r\x0b\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u200b\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u202f\u205f\u2066\u2067\u2068\u2069\u3000\ufeff-\u2010\u2011\u2012\u2013\u2014\u2015\u2212.()[]\uff08\uff09',
                             '');
            IF left(v_s, 2) = '00' THEN
              v_s := '+' || substr(v_s, 3);
            END IF;
            IF v_s ~ '^\+[0-9]{8,15}$' THEN
              v_out := v_out || jsonb_build_object(k, v_s);
            ELSE
              v_errors := v_errors || jsonb_build_object(k, 'format');
            END IF;
          ELSIF t = 'text' AND (CASE f->>'format'
                  WHEN 'url' THEN v_s !~ '^https?://[^\s]+\.[^\s]+$'
                  WHEN 'email' THEN v_s !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
                  WHEN 'phone' THEN v_s !~ '^\+?[0-9 ()-]{7,20}$'
                  ELSE false END) THEN
            v_errors := v_errors || jsonb_build_object(k, 'format');
          ELSE
            v_out := v_out || jsonb_build_object(k, v_s);
          END IF;
        END IF;
      WHEN 'tick' THEN
        IF jsonb_typeof(v) <> 'boolean' THEN
          v_errors := v_errors || jsonb_build_object(k, 'option');
        ELSIF v_req AND v = 'false'::jsonb THEN
          v_errors := v_errors || jsonb_build_object(k, 'required');
        ELSE
          v_out := v_out || jsonb_build_object(k, v);
        END IF;
      WHEN 'number' THEN
        v_ok := jsonb_typeof(v) = 'number';
        IF v_ok THEN
          v_num := (v #>> '{}')::numeric;
          v_dec := coalesce((f->>'decimals')::integer, 0);
          v_ok := v_num >= (f->>'min')::numeric AND v_num <= (f->>'max')::numeric AND v_num = round(v_num, v_dec);
        END IF;
        IF v_ok THEN v_out := v_out || jsonb_build_object(k, v_num);
        ELSE v_errors := v_errors || jsonb_build_object(k, 'range'); END IF;
      WHEN 'date' THEN
        v_d := NULL;
        IF jsonb_typeof(v) = 'string' AND (v #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
          BEGIN
            v_d := (v #>> '{}')::date;
          EXCEPTION WHEN OTHERS THEN v_d := NULL;
          END;
        END IF;
        IF v_d IS NULL OR (f->>'notAfter' = 'today' AND v_d > v_today)
           OR (jsonb_typeof(f->'notBeforeDays') = 'number' AND v_d < v_today - (f->>'notBeforeDays')::integer) THEN
          v_errors := v_errors || jsonb_build_object(k, 'range');
        ELSE
          v_out := v_out || jsonb_build_object(k, to_char(v_d, 'YYYY-MM-DD'));
        END IF;
      WHEN 'file' THEN
        -- {path, mime, bytes, sha256, name}: a slot of an open invite of this form with these facts, for
        -- this field, unused, and an object in the private bucket whose type and size match.
        v_code := NULL;
        IF jsonb_typeof(v) <> 'object'
           OR EXISTS (SELECT 1 FROM jsonb_object_keys(v) fk WHERE fk NOT IN ('path','mime','bytes','sha256','name'))
           OR jsonb_typeof(v->'path') IS DISTINCT FROM 'string' OR jsonb_typeof(v->'mime') IS DISTINCT FROM 'string'
           OR jsonb_typeof(v->'bytes') IS DISTINCT FROM 'number' OR jsonb_typeof(v->'sha256') IS DISTINCT FROM 'string'
           OR (v ? 'name' AND jsonb_typeof(v->'name') NOT IN ('string','null')) THEN
          v_code := 'file_missing';
        ELSE
          v_path := v->>'path';
          v_slot := NULL;
          SELECT s.id, s.mime, s.bytes INTO v_slot
            FROM public.cockpit_form_file_slots s JOIN public.cockpit_form_invites i ON i.id = s.invite_id
           WHERE s.path = v_path AND s.field_key = k AND s.sha256 = v->>'sha256' AND s.used_by IS NULL
             AND i.form_key = p_schema->>'key' AND i.state = 'open'
             AND i.context = (CASE WHEN jsonb_typeof(p_context) = 'object' THEN p_context ELSE '{}'::jsonb END) - 'signer'
           LIMIT 1;
          v_meta := NULL;
          SELECT o.metadata INTO v_meta FROM storage.objects o WHERE o.bucket_id = 'cockpit-form-files' AND o.name = v_path LIMIT 1;
          IF v_slot.id IS NULL OR v_meta IS NULL THEN
            v_code := 'file_missing';
          ELSIF NOT (coalesce(f->'accept', '[]'::jsonb) ? (v->>'mime')) OR v->>'mime' IS DISTINCT FROM v_slot.mime
                OR v->>'mime' IS DISTINCT FROM v_meta->>'mimetype' THEN
            v_code := 'file_type';
          ELSIF (v->>'bytes')::numeric > coalesce((f->>'maxBytes')::numeric, 10485760)
                OR (v->>'bytes')::numeric IS DISTINCT FROM v_slot.bytes::numeric
                OR (v->>'bytes')::numeric IS DISTINCT FROM (CASE WHEN v_meta->>'size' ~ '^[0-9]+$' THEN (v_meta->>'size')::numeric END) THEN
            v_code := 'file_size';
          END IF;
        END IF;
        IF v_code IS NULL THEN
          v_out := v_out || jsonb_build_object(k, jsonb_build_object('path', v_path, 'mime', v->>'mime',
                     'bytes', (v->>'bytes')::bigint, 'sha256', v->>'sha256',
                     'name', nullif(left(btrim(regexp_replace(coalesce(v->>'name', ''), '\s+', ' ', 'g')), 120), '')));
        ELSE
          v_errors := v_errors || jsonb_build_object(k, v_code);
        END IF;
      ELSE
        v_errors := v_errors || jsonb_build_object(k, 'unknown');
    END CASE;
  END LOOP;
  FOR k IN SELECT jsonb_object_keys(v_answers) LOOP
    IF NOT (k = ANY(v_keys)) THEN v_errors := v_errors || jsonb_build_object(k, 'unknown'); END IF;
  END LOOP;
  IF p_schema->>'signer' = 'typed' AND jsonb_typeof(p_context) = 'object' AND p_context ? 'signer' THEN
    v_s := btrim(regexp_replace(coalesce(CASE WHEN jsonb_typeof(p_context->'signer') = 'string' THEN p_context->>'signer' END, ''), '\s+', ' ', 'g'));
    IF v_s = '' THEN
      v_errors := v_errors || jsonb_build_object('signer', 'required');
    ELSIF char_length(v_s) NOT BETWEEN 2 AND 120 THEN
      v_errors := v_errors || jsonb_build_object('signer', 'length');
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', v_errors = '{}'::jsonb, 'errors', v_errors, 'answers', v_out);
END $$;

-- One rows cell, blank: missing, null, a blank text or false (a tick left alone).
CREATE OR REPLACE FUNCTION public.cockpit_form_rows_blank_cell(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p IS NULL OR p = 'null'::jsonb OR p = 'false'::jsonb
      OR (jsonb_typeof(p) = 'string' AND btrim(regexp_replace(p #>> '{}', '\s+', ' ', 'g')) = '')
$$;

-- The answers to a client form schema version 2: version 1's rules and codes, with show-ifs on in and includes,
-- notes never answered, and rows (1 above). {ok, errors: {key or key.row.column: code}, answers}.
CREATE OR REPLACE FUNCTION public.cockpit_form_answers_check_v2(p_schema jsonb, p_answers jsonb, p_context jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_answers jsonb := CASE WHEN jsonb_typeof(p_answers) = 'object' THEN p_answers ELSE '{}'::jsonb END;
  v_errors jsonb := '{}'::jsonb;
  v_out jsonb := '{}'::jsonb;
  v_types jsonb := '{}'::jsonb;
  v_keys text[] := '{}';
  f jsonb;
  c jsonb;
  k text;
  t text;
  v jsonb;
  v_cmp jsonb;
  v_vis boolean;
  v_req boolean;
  v_s text;
  v_num numeric;
  v_ok boolean;
  v_today date := public.cockpit_form_kuwait_day(now());
  v_d date;
  v_dec integer;
  v_code text;
  v_path text;
  v_meta jsonb;
  v_slot record;
  -- Rows (20261103h).
  v_row jsonb;
  v_i integer;
  v_cell jsonb;
  v_rows jsonb;
  v_kept jsonb;
  v_ck text;
  v_cn integer;
  v_cerr jsonb;
  v_ckeys text[];
BEGIN
  FOR f IN SELECT x FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_schema->'fields') = 'array'
                                                  THEN p_schema->'fields' ELSE '[]'::jsonb END) x LOOP
    k := f->>'key';
    t := f->>'type';
    CONTINUE WHEN k IS NULL;
    v_keys := v_keys || k;
    v_types := v_types || jsonb_build_object(k, t);
    v_req := coalesce(f->>'required', '') = 'true';
    v_vis := true;
    IF jsonb_typeof(f->'showIf') = 'object' THEN
      v_cmp := v_out -> (f->'showIf'->>'key');
      IF v_cmp IS NULL AND v_types->>(f->'showIf'->>'key') = 'tick' THEN
        v_cmp := 'false'::jsonb;
      END IF;
      -- An unanswered or hidden source hides the question (false, never NULL).
      v_vis := coalesce(CASE
        WHEN f->'showIf' ? 'in' THEN v_cmp IS NOT NULL AND jsonb_typeof(f->'showIf'->'in') = 'array'
                                     AND EXISTS (SELECT 1 FROM jsonb_array_elements(f->'showIf'->'in') e WHERE e = v_cmp)
        WHEN f->'showIf' ? 'includes' THEN jsonb_typeof(v_cmp) = 'array' AND v_cmp @> jsonb_build_array(f->'showIf'->'includes')
        ELSE v_cmp IS NOT NULL AND v_cmp = f->'showIf'->'equals' END, false);
    END IF;
    v := v_answers -> k;
    IF v = 'null'::jsonb THEN v := NULL; END IF;
    -- A heading or a note is shown, never answered.
    IF t IN ('heading','note') THEN
      IF v IS NOT NULL THEN v_errors := v_errors || jsonb_build_object(k, 'unknown'); END IF;
      CONTINUE;
    END IF;
    IF NOT v_vis THEN
      IF v IS NOT NULL THEN v_errors := v_errors || jsonb_build_object(k, 'hidden'); END IF;
      CONTINUE;
    END IF;
    -- Rows: a list of objects; a fully blank row is dropped before anything is counted.
    IF t = 'rows' AND v IS NOT NULL THEN
      IF jsonb_typeof(v) <> 'array' OR EXISTS (SELECT 1 FROM jsonb_array_elements(v) e WHERE jsonb_typeof(e) <> 'object') THEN
        v_errors := v_errors || jsonb_build_object(k, 'required');
        CONTINUE;
      END IF;
      SELECT coalesce(jsonb_agg(jsonb_build_object('i', n - 1, 'row', e) ORDER BY n), '[]'::jsonb) INTO v_rows
        FROM jsonb_array_elements(v) WITH ORDINALITY AS u(e, n)
       WHERE EXISTS (SELECT 1 FROM jsonb_each(e) ce WHERE NOT public.cockpit_form_rows_blank_cell(ce.value));
      v := CASE WHEN jsonb_array_length(v_rows) = 0 THEN NULL ELSE v END;
    END IF;
    -- Blank: missing, an empty or blank text, an empty list, no row with anything in it.
    IF v IS NULL OR (jsonb_typeof(v) = 'string' AND btrim(regexp_replace(v #>> '{}', '\s+', ' ', 'g')) = '')
       OR (jsonb_typeof(v) = 'array' AND jsonb_array_length(v) = 0) THEN
      IF v_req THEN v_errors := v_errors || jsonb_build_object(k, CASE WHEN t = 'file' THEN 'file_missing' ELSE 'required' END); END IF;
      CONTINUE;
    END IF;
    CASE t
      WHEN 'rows' THEN
        v_cn := jsonb_array_length(v_rows);
        -- More rows than the question takes is rows_many alone, before any cell is read: a long list costs one pass.
        IF v_cn > (f->>'maxRows')::integer THEN
          v_errors := v_errors || jsonb_build_object(k, 'rows_many');
          CONTINUE;
        END IF;
        v_cerr := '{}'::jsonb;
        v_kept := '[]'::jsonb;
        v_ckeys := ARRAY(SELECT x->>'key' FROM jsonb_array_elements(f->'columns') x);
        FOR v_i, v_row IN SELECT (x->>'i')::integer, x->'row' FROM jsonb_array_elements(v_rows) x LOOP
          FOR v_ck IN SELECT jsonb_object_keys(v_row) LOOP
            IF NOT (v_ck = ANY(v_ckeys)) THEN
              v_cerr := v_cerr || jsonb_build_object(k || '.' || v_i || '.' || v_ck, 'unknown');
            END IF;
          END LOOP;
          v_cell := '{}'::jsonb;
          FOR c IN SELECT x FROM jsonb_array_elements(f->'columns') x LOOP
            v_ck := c->>'key';
            v_s := NULL;
            IF public.cockpit_form_rows_blank_cell(v_row->v_ck) AND v_row->v_ck IS DISTINCT FROM 'false'::jsonb THEN
              IF coalesce(c->>'required', '') = 'true' THEN
                v_cerr := v_cerr || jsonb_build_object(k || '.' || v_i || '.' || v_ck, 'required');
              END IF;
              CONTINUE;
            END IF;
            CASE c->>'type'
              WHEN 'text', 'longtext' THEN
                IF jsonb_typeof(v_row->v_ck) <> 'string' THEN
                  v_cerr := v_cerr || jsonb_build_object(k || '.' || v_i || '.' || v_ck, 'required');
                ELSE
                  v_s := CASE WHEN p_schema->>'key' = 'onboarding' THEN public.cockpit_form_typeform_text(v_row->>v_ck)
                              ELSE btrim(regexp_replace(v_row->>v_ck, '\s+', ' ', 'g')) END;
                  IF v_s = '' THEN
                    IF coalesce(c->>'required', '') = 'true' THEN
                      v_cerr := v_cerr || jsonb_build_object(k || '.' || v_i || '.' || v_ck, 'required');
                    END IF;
                  ELSIF char_length(v_s) > coalesce((c->>'maxLength')::integer, CASE c->>'type' WHEN 'text' THEN 200 ELSE 2000 END) THEN
                    v_cerr := v_cerr || jsonb_build_object(k || '.' || v_i || '.' || v_ck, 'length');
                  ELSE
                    v_cell := v_cell || jsonb_build_object(v_ck, v_s);
                  END IF;
                END IF;
              WHEN 'number' THEN
                v_ok := jsonb_typeof(v_row->v_ck) = 'number';
                IF v_ok THEN
                  v_num := (v_row->>v_ck)::numeric;
                  v_ok := v_num >= (c->>'min')::numeric AND v_num <= (c->>'max')::numeric
                          AND v_num = round(v_num, coalesce((c->>'decimals')::integer, 0));
                END IF;
                IF v_ok THEN v_cell := v_cell || jsonb_build_object(v_ck, v_num);
                ELSE v_cerr := v_cerr || jsonb_build_object(k || '.' || v_i || '.' || v_ck, 'range'); END IF;
              WHEN 'choice' THEN
                IF jsonb_typeof(v_row->v_ck) = 'string'
                   AND EXISTS (SELECT 1 FROM jsonb_array_elements(c->'options') o WHERE o->>'value' = v_row->>v_ck) THEN
                  v_cell := v_cell || jsonb_build_object(v_ck, v_row->v_ck);
                ELSE v_cerr := v_cerr || jsonb_build_object(k || '.' || v_i || '.' || v_ck, 'option'); END IF;
              WHEN 'tick' THEN
                IF jsonb_typeof(v_row->v_ck) <> 'boolean' THEN
                  v_cerr := v_cerr || jsonb_build_object(k || '.' || v_i || '.' || v_ck, 'option');
                ELSIF coalesce(c->>'required', '') = 'true' AND v_row->v_ck = 'false'::jsonb THEN
                  v_cerr := v_cerr || jsonb_build_object(k || '.' || v_i || '.' || v_ck, 'required');
                ELSE
                  v_cell := v_cell || jsonb_build_object(v_ck, v_row->v_ck);
                END IF;
              ELSE
                v_cerr := v_cerr || jsonb_build_object(k || '.' || v_i || '.' || v_ck, 'unknown');
            END CASE;
          END LOOP;
          v_kept := v_kept || jsonb_build_array(v_cell);
        END LOOP;
        IF v_cn < greatest(coalesce((f->>'minRows')::integer, 0), CASE WHEN v_req THEN 1 ELSE 0 END) THEN
          v_errors := v_errors || jsonb_build_object(k, 'rows_few');
        END IF;
        v_errors := v_errors || v_cerr;
        IF NOT (v_errors ? k) AND v_cerr = '{}'::jsonb THEN
          v_out := v_out || jsonb_build_object(k, v_kept);
        END IF;
      WHEN 'scale' THEN
        v_ok := jsonb_typeof(v) = 'number';
        IF v_ok THEN
          v_num := (v #>> '{}')::numeric;
          v_ok := v_num = trunc(v_num) AND v_num >= (f->>'min')::numeric AND v_num <= (f->>'max')::numeric;
        END IF;
        IF v_ok THEN v_out := v_out || jsonb_build_object(k, v_num::integer);
        ELSE v_errors := v_errors || jsonb_build_object(k, 'range'); END IF;
      WHEN 'choice' THEN
        IF jsonb_typeof(v) = 'string' AND EXISTS (SELECT 1 FROM jsonb_array_elements(f->'options') o WHERE o->>'value' = v #>> '{}') THEN
          v_out := v_out || jsonb_build_object(k, v);
        ELSE v_errors := v_errors || jsonb_build_object(k, 'option'); END IF;
      WHEN 'multi' THEN
        IF jsonb_typeof(v) = 'array'
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v) e
                            WHERE jsonb_typeof(e) <> 'string'
                               OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(f->'options') o WHERE o->>'value' = e #>> '{}'))
           AND (SELECT count(DISTINCT e #>> '{}') FROM jsonb_array_elements(v) e) = jsonb_array_length(v) THEN
          v_out := v_out || jsonb_build_object(k, v);
        ELSE v_errors := v_errors || jsonb_build_object(k, 'option'); END IF;
      WHEN 'text', 'longtext' THEN
        IF jsonb_typeof(v) <> 'string' THEN
          v_errors := v_errors || jsonb_build_object(k, 'required');
        ELSE
          v_s := CASE WHEN p_schema->>'key' = 'onboarding' THEN public.cockpit_form_typeform_text(v #>> '{}')
                      ELSE btrim(regexp_replace(v #>> '{}', '\s+', ' ', 'g')) END;
          IF v_s = '' THEN
            IF v_req THEN v_errors := v_errors || jsonb_build_object(k, 'required'); END IF;
          ELSIF char_length(v_s) > coalesce((f->>'maxLength')::integer, CASE t WHEN 'text' THEN 200 ELSE 2000 END) THEN
            v_errors := v_errors || jsonb_build_object(k, 'length');
          ELSIF t = 'text' AND f->>'format' = 'phone' AND p_schema->>'key' = 'onboarding' THEN
            v_s := translate(translate(v_s, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
                             E' \t\n\r\x0b\f             ​‎‏‪‫‬‭‮  ⁦⁧⁨⁩　﻿-‐‑‒–—―−.()[]（）',
                             '');
            IF left(v_s, 2) = '00' THEN
              v_s := '+' || substr(v_s, 3);
            END IF;
            IF v_s ~ '^\+[0-9]{8,15}$' THEN
              v_out := v_out || jsonb_build_object(k, v_s);
            ELSE
              v_errors := v_errors || jsonb_build_object(k, 'format');
            END IF;
          ELSIF t = 'text' AND (CASE f->>'format'
                  WHEN 'url' THEN v_s !~ '^https?://[^\s]+\.[^\s]+$'
                  WHEN 'email' THEN v_s !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
                  WHEN 'phone' THEN v_s !~ '^\+?[0-9 ()-]{7,20}$'
                  ELSE false END) THEN
            v_errors := v_errors || jsonb_build_object(k, 'format');
          ELSE
            v_out := v_out || jsonb_build_object(k, v_s);
          END IF;
        END IF;
      WHEN 'tick' THEN
        IF jsonb_typeof(v) <> 'boolean' THEN
          v_errors := v_errors || jsonb_build_object(k, 'option');
        ELSIF v_req AND v = 'false'::jsonb THEN
          v_errors := v_errors || jsonb_build_object(k, 'required');
        ELSE
          v_out := v_out || jsonb_build_object(k, v);
        END IF;
      WHEN 'number' THEN
        v_ok := jsonb_typeof(v) = 'number';
        IF v_ok THEN
          v_num := (v #>> '{}')::numeric;
          v_dec := coalesce((f->>'decimals')::integer, 0);
          v_ok := v_num >= (f->>'min')::numeric AND v_num <= (f->>'max')::numeric AND v_num = round(v_num, v_dec);
        END IF;
        IF v_ok THEN v_out := v_out || jsonb_build_object(k, v_num);
        ELSE v_errors := v_errors || jsonb_build_object(k, 'range'); END IF;
      WHEN 'date' THEN
        v_d := NULL;
        IF jsonb_typeof(v) = 'string' AND (v #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
          BEGIN
            v_d := (v #>> '{}')::date;
          EXCEPTION WHEN OTHERS THEN v_d := NULL;
          END;
        END IF;
        IF v_d IS NULL OR (f->>'notAfter' = 'today' AND v_d > v_today)
           OR (jsonb_typeof(f->'notBeforeDays') = 'number' AND v_d < v_today - (f->>'notBeforeDays')::integer) THEN
          v_errors := v_errors || jsonb_build_object(k, 'range');
        ELSE
          v_out := v_out || jsonb_build_object(k, to_char(v_d, 'YYYY-MM-DD'));
        END IF;
      WHEN 'file' THEN
        v_code := NULL;
        IF jsonb_typeof(v) <> 'object'
           OR EXISTS (SELECT 1 FROM jsonb_object_keys(v) fk WHERE fk NOT IN ('path','mime','bytes','sha256','name'))
           OR jsonb_typeof(v->'path') IS DISTINCT FROM 'string' OR jsonb_typeof(v->'mime') IS DISTINCT FROM 'string'
           OR jsonb_typeof(v->'bytes') IS DISTINCT FROM 'number' OR jsonb_typeof(v->'sha256') IS DISTINCT FROM 'string'
           OR (v ? 'name' AND jsonb_typeof(v->'name') NOT IN ('string','null')) THEN
          v_code := 'file_missing';
        ELSE
          v_path := v->>'path';
          v_slot := NULL;
          SELECT s.id, s.mime, s.bytes INTO v_slot
            FROM public.cockpit_form_file_slots s JOIN public.cockpit_form_invites i ON i.id = s.invite_id
           WHERE s.path = v_path AND s.field_key = k AND s.sha256 = v->>'sha256' AND s.used_by IS NULL
             AND i.form_key = p_schema->>'key' AND i.state = 'open'
             AND i.context = (CASE WHEN jsonb_typeof(p_context) = 'object' THEN p_context ELSE '{}'::jsonb END) - 'signer'
           LIMIT 1;
          v_meta := NULL;
          SELECT o.metadata INTO v_meta FROM storage.objects o WHERE o.bucket_id = 'cockpit-form-files' AND o.name = v_path LIMIT 1;
          IF v_slot.id IS NULL OR v_meta IS NULL THEN
            v_code := 'file_missing';
          ELSIF NOT (coalesce(f->'accept', '[]'::jsonb) ? (v->>'mime')) OR v->>'mime' IS DISTINCT FROM v_slot.mime
                OR v->>'mime' IS DISTINCT FROM v_meta->>'mimetype' THEN
            v_code := 'file_type';
          ELSIF (v->>'bytes')::numeric > coalesce((f->>'maxBytes')::numeric, 10485760)
                OR (v->>'bytes')::numeric IS DISTINCT FROM v_slot.bytes::numeric
                OR (v->>'bytes')::numeric IS DISTINCT FROM (CASE WHEN v_meta->>'size' ~ '^[0-9]+$' THEN (v_meta->>'size')::numeric END) THEN
            v_code := 'file_size';
          END IF;
        END IF;
        IF v_code IS NULL THEN
          v_out := v_out || jsonb_build_object(k, jsonb_build_object('path', v_path, 'mime', v->>'mime',
                     'bytes', (v->>'bytes')::bigint, 'sha256', v->>'sha256',
                     'name', nullif(left(btrim(regexp_replace(coalesce(v->>'name', ''), '\s+', ' ', 'g')), 120), '')));
        ELSE
          v_errors := v_errors || jsonb_build_object(k, v_code);
        END IF;
      ELSE
        v_errors := v_errors || jsonb_build_object(k, 'unknown');
    END CASE;
  END LOOP;
  FOR k IN SELECT jsonb_object_keys(v_answers) LOOP
    IF NOT (k = ANY(v_keys)) THEN v_errors := v_errors || jsonb_build_object(k, 'unknown'); END IF;
  END LOOP;
  IF p_schema->>'signer' = 'typed' AND jsonb_typeof(p_context) = 'object' AND p_context ? 'signer' THEN
    v_s := btrim(regexp_replace(coalesce(CASE WHEN jsonb_typeof(p_context->'signer') = 'string' THEN p_context->>'signer' END, ''), '\s+', ' ', 'g'));
    IF v_s = '' THEN
      v_errors := v_errors || jsonb_build_object('signer', 'required');
    ELSIF char_length(v_s) NOT BETWEEN 2 AND 120 THEN
      v_errors := v_errors || jsonb_build_object('signer', 'length');
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', v_errors = '{}'::jsonb, 'errors', v_errors, 'answers', v_out);
END $$;

-- The one answers check every caller reads (the portal's store, the link page, the canary): an answer to a
-- version-2 schema to its own check, every other to 20261102o's, byte for byte.
CREATE OR REPLACE FUNCTION public.cockpit_form_answers_check(p_schema jsonb, p_answers jsonb, p_context jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- 20261103h: client form schema version 2 (the structured onboarding) has its own check; every other schema's
  -- answers are checked by 20261102o's, now cockpit_form_answers_check_v1, byte for byte.
  IF jsonb_typeof(p_schema) = 'object' AND p_schema->'v' = '2'::jsonb THEN
    RETURN public.cockpit_form_answers_check_v2(p_schema, p_answers, p_context);
  END IF;
  RETURN public.cockpit_form_answers_check_v1(p_schema, p_answers, p_context);
END $$;

-- ---------------------------------------------------------------------------
-- 2. The switch (2 above). Seeded off; the forms settings trigger (20261029z) writes an audit row for every change.

SELECT set_config('cockpit.audit_actor', 'migration 20261103h', true);
INSERT INTO public.cockpit_settings(key, value, updated_by)
VALUES ('forms.client.schema_v2', '{"state":"off"}'::jsonb, 'migration 20261103h') ON CONFLICT (key) DO NOTHING;
SELECT set_config('cockpit.audit_actor', '', true);

-- off, canary or on: forms.client.schema_v2's state; anything else, or no row, reads off.
CREATE OR REPLACE FUNCTION public.cockpit_form_schema_v2_state()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT CASE WHEN jsonb_typeof(c.value->'state') = 'string' AND c.value->>'state' IN ('off','canary','on')
                               THEN c.value->>'state' END
                     FROM public.cockpit_settings c WHERE c.key = 'forms.client.schema_v2'), 'off')
$$;

-- The newest version of a form written in client form schema version 2; NULL when it has none.
CREATE OR REPLACE FUNCTION public.cockpit_form_structured_version(p_form_key text)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT max(v.version) FROM public.cockpit_form_versions v WHERE v.form_key = p_form_key AND v.schema->'v' = '2'::jsonb
$$;

-- The version a client gets: 20261102a's rule (the newest version in client form schema version 1), and a
-- version in schema version 2 too, but only while forms.client.schema_v2 is on.
CREATE OR REPLACE FUNCTION public.cockpit_form_client_version(p_form_key text)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- 20261103h: a version in client form schema version 2 counts only while forms.client.schema_v2 is on.
  RETURN (SELECT max(v.version) FROM public.cockpit_form_versions v
           WHERE v.form_key = p_form_key
             AND (v.schema->'v' = '1'::jsonb
                  OR (v.schema->'v' = '2'::jsonb AND public.cockpit_form_schema_v2_state() = 'on')));
END $$;

-- ---------------------------------------------------------------------------
-- 3. The printer (3 above)

-- The print map of a version of the onboarding: for each of KFRCXPFx's 36 refs, which answers print into it and how
-- (text, tickText, number, choice, list, rows, areas, lines, join, template). Server only, never sent to the portal.
-- NULL for every version without one (version 2's answers map one to one onto KFRCXPFx's).
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_print_map(p_version integer)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_version = 3 THEN
    RETURN '{"version":3,"refs":[{"ref":"533f14a0-712f-4de9-9ac7-67e1be6bc0c8","title":"Full Name","print":{"text":"fullName"}},{"ref":"64f2fb80-b074-4017-b8b7-b7d549947e52","title":"Phone","print":{"text":"phone"}},{"ref":"7994f0d2-baeb-451b-983a-816290873a68","title":"Email","print":{"text":"email"}},{"ref":"514bfd3f-4ca1-469e-b9e7-87656503f65c","title":"Business Name","print":{"text":"businessName"}},{"ref":"e5caee43-e9b5-427d-8583-6982c5dd9be8","title":"Please enter your business address.","print":{"text":"address"}},{"ref":"f7f9f2eb-1761-4c28-83ed-a53621c2cf88","title":"Paste a Google Maps link to your location (optional).","print":{"text":"mapsLink"}},{"ref":"454a425f-2ac6-4d94-92db-cec08618600e","title":"Website URL","print":{"tickText":"noWebsite","whenTicked":"No website yet","else":{"text":"website"}}},{"ref":"adecfe45-5d55-4319-98ff-3761e04bfc9b","title":"Instagram URL","print":{"text":"instagram"}},{"ref":"575d17ed-e26d-4e55-87d3-7cb31cb71939","title":"Facebook Page URL","print":{"tickText":"noFacebookPage","whenTicked":"No Facebook page","else":{"text":"facebook"}}},{"ref":"ee25f923-d5e1-4d1a-a95f-cd9c17abbe83","title":"What payment options do you currently offer to your clients (e.g., full payment, installment plans, minimum down payment, in-house financing, third-party financing)?","print":{"lines":[{"list":"paymentMethods","labels":{"full":"Full payment","instalments":"Installment plans","down_payment":"Down payment first","in_house":"In-house financing","third_party":"Third-party financing"}},{"text":"paymentDetails"}]}},{"ref":"282dac48-5031-4acb-96b6-ea469e8a5a8b","title":"Front Desk Phone","print":{"text":"frontDeskPhone"}},{"ref":"09d2e62a-51d4-4665-a3a9-30f5279b71bc","title":"Personal Phone Number","print":{"text":"personalPhone"}},{"ref":"ed1ba2fe-2827-4eea-a678-62205f1ce9f5","title":"How long have you been in business?","print":{"number":"startYear","template":"Since {n}"}},{"ref":"7a120dbb-0169-4bcc-9193-5c525a470d02","title":"Current booking software","print":{"list":"bookingTools","labels":{"whatsapp":"WhatsApp","phone":"Phone calls","paper_excel":"Notebook or Excel","google_calendar":"Google Calendar","calendly":"Calendly","other_software":{"text":"bookingOther"}}}},{"ref":"ddf2767d-5725-4df2-b200-f0aab77a2db5","title":"Do you have a facebook business manager or have you ever ran ads on meta (Facebook & Instagram) in the past?","print":{"choice":"facebookAds","labels":{"yes":"Yes","unsure":"IM UNSURE | لست متأكدًا","ran_before":"I''ve ran ads before but dont know how to access my Account |شغّلت إعلانات من قبل لكنني لا أعرف كيف أصل إلى حسابي","never_ran":"I Have a Business Account but have never ran ads | لديّ حساب أعمال على فيسبوك لكنني لم أقم بتشغيل إعلانات من قبل","restricted":"My Account is restricted | حسابي مقيّد"}}},{"ref":"0a6b5704-c46d-480c-a592-b59108683596","title":"How many projects has your company completed to date?","print":{"number":"projectsDone","template":"{n}"}},{"ref":"b7873d40-d154-42ac-bf24-cb3b667e84cc","title":"Business hours - When are you open to schedule?","print":{"join":": ","parts":[{"list":"hoursDays","labels":{"sun":"Sun","mon":"Mon","tue":"Tue","wed":"Wed","thu":"Thu","fri":"Fri","sat":"Sat"}},{"text":"hoursTimes"}]}},{"ref":"d976036f-6c2e-4d5d-999a-64cf9bb2ef02","title":"1) What services do you offer list all of them? Also I want to know which ones have the HIGHEST price point and Highest Profit 2) What is the PRICE of the services?","print":{"rows":"services","line":"{name}{price? : {unit=starts_from?starting from }{price} {CUR}{unit!=starts_from? {unit}}}{topPrice? (highest price)}{topProfit? (most profit)}","units":{"project":"per project","sqm":"per square metre","visit":"per visit","starts_from":""}}},{"ref":"6271b610-6946-4056-bb08-d03ffc274141","title":"Out of those what is the #1 service/type of project you want to focus on scaling?","print":{"text":"serviceFocus"}},{"ref":"f2b7bc2b-2a79-4640-9e21-377e7aa39d45","title":"What are your top five most frequently asked questions and their answers? (Feel free to add more — the more detailed, the better.)","print":{"rows":"faqs","line":"{n}. {question}\n{answer}","sep":"\n\n"}},{"ref":"6c819933-3eb9-4db8-bd59-d39be11cb7f0","title":"Please describe your ideal project in detail.","print":{"text":"idealProject"}},{"ref":"fa017616-3fb5-4e64-9fbd-39cea6e26c47","title":"What service areas do you cover? Please list all cities and neighborhoods you serve so we can target your ads precisely.","print":{"areas":"areaCountries","countries":{"sa":"Saudi Arabia","kw":"Kuwait","ae":"UAE","qa":"Qatar","bh":"Bahrain","om":"Oman"},"lists":{"sa":"areasSA","kw":"areasKW","ae":"areasAE","qa":"areasQA","bh":"areasBH","om":"areasOM"},"other":"areasOther","note":"areasNote","labels":{"sa":{"all_sa":"All of Saudi Arabia","riyadh":"Riyadh","jeddah":"Jeddah","makkah":"Makkah","madinah":"Madinah","dammam":"Dammam","khobar":"Khobar","dhahran":"Dhahran","qatif":"Qatif","ahsa":"Al Ahsa","jubail":"Jubail","qassim":"Qassim","taif":"Taif","abha_khamis":"Abha and Khamis Mushait","tabuk":"Tabuk","hail":"Hail","jazan":"Jazan","najran":"Najran","yanbu":"Yanbu"},"kw":{"all_kw":"All of Kuwait","capital":"Capital","hawalli":"Hawalli","farwaniya":"Farwaniya","mubarak":"Mubarak Al-Kabeer","ahmadi":"Ahmadi","jahra":"Jahra"},"ae":{"all_ae":"All of the UAE","dubai":"Dubai","abu_dhabi":"Abu Dhabi","sharjah":"Sharjah","ajman":"Ajman","al_ain":"Al Ain","rak":"Ras Al Khaimah","fujairah":"Fujairah","uaq":"Umm Al Quwain"},"qa":{"all_qa":"All of Qatar","doha":"Doha","rayyan":"Al Rayyan","lusail":"Lusail","wakrah":"Al Wakrah","khor":"Al Khor","umm_salal":"Umm Salal","daayen":"Al Daayen"},"bh":{"all_bh":"All of Bahrain","capital":"Capital (Manama)","muharraq":"Muharraq","northern":"Northern","southern":"Southern"},"om":{"all_om":"All of Oman","muscat":"Muscat","dhofar":"Dhofar (Salalah)","batinah":"Al Batinah (Sohar)","dakhiliyah":"Ad Dakhiliyah (Nizwa)","sharqiyah":"Ash Sharqiyah"}}}},{"ref":"b370341c-6ea3-43c9-bd8c-16e278a2d2d5","title":"What types of appointments do you offer? (Select all that apply)","print":{"list":"appointmentTypes","labels":{"online":"عن بُعد (أونلاين) | Online","onsite":"في موقع العميل / في المنزل | Onsite / In-home","office":"في مقرّكم / مكتبكم | In your office"},"sep":", ","order":"ticked"}},{"ref":"35ea63c3-090a-425d-b75c-e3d183d48cd1","title":"What''s the maximum distance you would travel from your office to do an in-home consultation?","print":{"choice":"distanceMode","labels":{"anywhere":"Anywhere in our service areas","limit":{"number":"maxDistanceKm","template":"{n} km"}}}},{"ref":"b7c403ea-8d66-4814-80cf-7e8d7fdb8d11","title":"Local Landmark Information (Please type this in the format shown) - Located next to the Burger King down King Saud street on the left hand side.","print":{"text":"landmark"}},{"ref":"a20cfc1a-0228-413d-80ab-d97fc97574e0","title":"Appointment length + details + buffer","print":{"lines":[{"template":"{apptMinutes} minutes, {bufferMinutes=0?no time:{bufferMinutes} minutes} between appointments"},{"text":"apptDetails"}]}},{"ref":"0a80a0a8-3a09-4907-a1d1-6c57e57d4c47","title":"Who are the engineers in your business that will be giving these consultations?","print":{"rows":"consultants","line":"{name} - {speciality}{nationality? - {nationality}}{qualifications? - {qualifications}}"}},{"ref":"7426c6c5-344f-44c9-9999-3b9daf3a06b8","title":"What motivated you to join our program? What was the reason you signed up?","print":{"text":"whyJoined"}},{"ref":"ec89854f-d006-402b-958a-91738e2b3e7a","title":"Do you offer free consultations?","print":{"choice":"freeConsults","labels":{"yes":"Yes, we do offer free consultations / نعم، نقدم استشارات مجانية✅","open_to_it":"No, but we''re open to considering it / حاليا لا نقدمها، لكن يمكننا مناقشه🤝","no":"No, we do not offer free consultations / لا، لا نقدم استشارات مجانية❌"}}},{"ref":"bf8c7c7b-fff9-463f-b30a-8d8ca8b622f6","title":"What is your marketing process? In other words... please explain EVERYTHING A-Z that you have in place or have tried to generate new projects","print":{"lines":[{"list":"marketingChannels","prefix":"Channels: ","labels":{"referrals":"Referrals","instagram":"Instagram","meta_ads":"Facebook and Instagram ads","google":"Google","tiktok":"TikTok","snapchat":"Snapchat","website":"Website","exhibitions":"Exhibitions and events","whatsapp":"WhatsApp","agency":"A marketing agency","none_yet":"Nothing yet"}},{"text":"marketing"}]}},{"ref":"7ff5d37a-df7f-4002-8248-d0b4af6c28e8","title":"Last Calendar Year - How Much Total Revenue did you do?","print":{"number":"lastRevenue","template":"{n}","make":"number"}},{"ref":"fcf43e6a-cc84-4ae7-9cef-2336069d0280","title":"What are the TOP 3 challenges that - if we were able to help you with - would make you 100% satisfied with your investment? - Be specific.","print":{"text":"challenges"}},{"ref":"791b99b8-c7e9-40a4-96d6-868399e1ae97","title":"What is your realistic goal revenue in 90 Days?","print":{"number":"goal90","template":"{n}","make":"number"}},{"ref":"f4b96a9b-bd7c-4398-98b4-6a28a7d3595a","title":"What is your ideal/stretch revenue goal within the next 12-24 months?","print":{"number":"goal12","template":"{n}","make":"number"}},{"ref":"41d2d5bb-b023-4fa4-906c-72aeef7a5e46","title":"Any additional information we should know before starting?","print":{"text":"additionalInfo"}},{"ref":"64d23c81-1784-4f07-8356-107af764fc95","title":"Please attach a Google Drive link to all the content you have for your office (See check list below)","print":{"text":"driveLink"}}],"sidecar":{"keysExcluded":["fullName","phone","email","frontDeskPhone","personalPhone"]}}'::jsonb;
  END IF;
  RETURN NULL;
END $$;

-- One part of the print map on one answer, as the design's reference printer (next-design/v3_print.py) prints it;
-- NULL for nothing. A services row: "<name>: [starting from ]<price, grouped> <CUR>[ <unit>][ (highest price)]
-- [ (most profit)]"; a FAQ: "<n>. <question>\n<answer>"; a consultant: the filled cells joined with " - ".
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_print_part(p_spec jsonb, p_answers jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a jsonb := CASE WHEN jsonb_typeof(p_answers) = 'object' THEN p_answers ELSE '{}'::jsonb END;
  v jsonb;
  v_lab jsonb;
  v_el jsonb;
  v_row jsonb;
  v_n bigint;
  v_txt text;
  v_parts text[] := '{}';
  v_country text;
  v_cur text;
  v_unit text;
BEGIN
  IF p_spec ? 'text' THEN
    v := a->(p_spec->>'text');
    RETURN CASE WHEN jsonb_typeof(v) = 'string' THEN nullif(v #>> '{}', '') END;
  ELSIF p_spec ? 'tickText' THEN
    IF a->(p_spec->>'tickText') = 'true'::jsonb THEN
      RETURN p_spec->>'whenTicked';
    END IF;
    RETURN public.cockpit_form_stage4_print_part(p_spec->'else', a);
  ELSIF p_spec ? 'number' THEN
    v := a->(p_spec->>'number');
    IF jsonb_typeof(v) IS DISTINCT FROM 'number' THEN
      RETURN NULL;
    END IF;
    RETURN replace(p_spec->>'template', '{n}', trunc((v #>> '{}')::numeric)::text);
  ELSIF p_spec ? 'choice' THEN
    v := a->(p_spec->>'choice');
    IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR v #>> '{}' = '' THEN
      RETURN NULL;
    END IF;
    v_lab := p_spec->'labels'->(v #>> '{}');
    RETURN CASE jsonb_typeof(v_lab) WHEN 'object' THEN public.cockpit_form_stage4_print_part(v_lab, a)
                                    WHEN 'string' THEN v_lab #>> '{}' END;
  ELSIF p_spec ? 'list' THEN
    FOR v_el IN SELECT u.el FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a->(p_spec->>'list')) = 'array'
                                                            THEN a->(p_spec->>'list') ELSE '[]'::jsonb END)
                                 WITH ORDINALITY AS u(el, n) ORDER BY u.n LOOP
      v_lab := CASE WHEN jsonb_typeof(v_el) = 'string' THEN p_spec->'labels'->(v_el #>> '{}') END;
      v_txt := CASE jsonb_typeof(v_lab) WHEN 'object' THEN public.cockpit_form_stage4_print_part(v_lab, a)
                                        WHEN 'string' THEN v_lab #>> '{}' END;
      IF coalesce(v_txt, '') <> '' THEN
        v_parts := v_parts || v_txt;
      END IF;
    END LOOP;
    IF cardinality(v_parts) = 0 THEN
      RETURN NULL;
    END IF;
    RETURN coalesce(p_spec->>'prefix', '') || array_to_string(v_parts, coalesce(p_spec->>'sep', ', '));
  ELSIF p_spec ? 'rows' THEN
    v := a->(p_spec->>'rows');
    IF jsonb_typeof(v) IS DISTINCT FROM 'array' OR jsonb_array_length(v) = 0 THEN
      RETURN NULL;
    END IF;
    v_cur := CASE a->>'currency' WHEN 'sar' THEN 'SAR' WHEN 'kwd' THEN 'KWD' WHEN 'aed' THEN 'AED' WHEN 'qar' THEN 'QAR'
                                 WHEN 'bhd' THEN 'BHD' WHEN 'omr' THEN 'OMR' WHEN 'usd' THEN 'USD' END;
    FOR v_row, v_n IN SELECT u.el, u.n FROM jsonb_array_elements(v) WITH ORDINALITY AS u(el, n) ORDER BY u.n LOOP
      IF p_spec->>'rows' = 'services' THEN
        v_txt := coalesce(v_row->>'name', '');
        IF jsonb_typeof(v_row->'price') = 'number' THEN
          v_unit := v_row->>'unit';
          v_txt := v_txt || ': ' || CASE WHEN v_unit = 'starts_from' THEN 'starting from ' ELSE '' END
                   || to_char(trunc((v_row->>'price')::numeric), 'FM999,999,999,999,990') || coalesce(' ' || v_cur, '');
          IF coalesce(v_unit, '') <> '' AND v_unit <> 'starts_from' THEN
            v_txt := v_txt || ' ' || coalesce(p_spec->'units'->>v_unit, v_unit);
          END IF;
        END IF;
        IF v_row->'topPrice' = 'true'::jsonb THEN v_txt := v_txt || ' (highest price)'; END IF;
        IF v_row->'topProfit' = 'true'::jsonb THEN v_txt := v_txt || ' (most profit)'; END IF;
      ELSIF p_spec->>'rows' = 'faqs' THEN
        v_txt := v_n || '. ' || coalesce(v_row->>'question', '') || E'\n' || coalesce(v_row->>'answer', '');
      ELSE
        v_txt := array_to_string(ARRAY(SELECT x FROM unnest(ARRAY[v_row->>'name', v_row->>'speciality', v_row->>'nationality',
                                                                 v_row->>'qualifications']) WITH ORDINALITY AS w(x, o)
                                        WHERE coalesce(x, '') <> '' ORDER BY o), ' - ');
      END IF;
      v_parts := v_parts || v_txt;
    END LOOP;
    RETURN array_to_string(v_parts, coalesce(p_spec->>'sep', E'\n'));
  ELSIF p_spec ? 'areas' THEN
    FOR v_el IN SELECT u.el FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a->(p_spec->>'areas')) = 'array'
                                                            THEN a->(p_spec->>'areas') ELSE '[]'::jsonb END)
                                 WITH ORDINALITY AS u(el, n) ORDER BY u.n LOOP
      v_country := v_el #>> '{}';
      IF v_country = 'other' THEN
        IF coalesce(a->>(p_spec->>'other'), '') <> '' THEN
          v_parts := v_parts || ('Other: ' || (a->>(p_spec->>'other')));
        END IF;
        CONTINUE;
      END IF;
      v_txt := array_to_string(ARRAY(
        SELECT p_spec->'labels'->v_country->>(w.el #>> '{}')
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(a->(p_spec->'lists'->>v_country)) = 'array'
                                         THEN a->(p_spec->'lists'->>v_country) ELSE '[]'::jsonb END) WITH ORDINALITY AS w(el, n)
         WHERE p_spec->'labels'->v_country->>(w.el #>> '{}') IS NOT NULL
         ORDER BY w.n), ', ');
      IF coalesce(v_txt, '') <> '' THEN
        v_parts := v_parts || ((p_spec->'countries'->>v_country) || ': ' || v_txt);
      END IF;
    END LOOP;
    IF coalesce(a->>(p_spec->>'note'), '') <> '' THEN
      v_parts := v_parts || (a->>(p_spec->>'note'));
    END IF;
    RETURN nullif(array_to_string(v_parts, E'\n'), '');
  ELSIF p_spec ? 'lines' OR p_spec ? 'join' THEN
    FOR v_el IN SELECT u.el FROM jsonb_array_elements(CASE WHEN p_spec ? 'lines' THEN p_spec->'lines' ELSE p_spec->'parts' END)
                                 WITH ORDINALITY AS u(el, n) ORDER BY u.n LOOP
      v_txt := public.cockpit_form_stage4_print_part(v_el, a);
      IF coalesce(v_txt, '') <> '' THEN
        v_parts := v_parts || v_txt;
      END IF;
    END LOOP;
    RETURN nullif(array_to_string(v_parts, CASE WHEN p_spec ? 'lines' THEN E'\n' ELSE p_spec->>'join' END), '');
  ELSIF p_spec ? 'template' THEN
    -- The appointment: "<length> minutes, <buffer> minutes between appointments", "no time" for no buffer.
    IF jsonb_typeof(a->'apptMinutes') IS DISTINCT FROM 'number' THEN
      RETURN NULL;
    END IF;
    RETURN trim_scale((a->>'apptMinutes')::numeric)::text || ' minutes, '
        || CASE WHEN jsonb_typeof(a->'bufferMinutes') = 'number' AND (a->>'bufferMinutes')::numeric <> 0
                THEN trim_scale((a->>'bufferMinutes')::numeric)::text || ' minutes' ELSE 'no time' END
        || ' between appointments';
  END IF;
  RAISE EXCEPTION 'The print map has a part the printer does not know.' USING ERRCODE = '22023';
END $$;

-- NULL when a version's print map fits it, else the first reason it does not: it prints exactly the 36 refs of
-- cockpit_form_stage4_fields('onboarding'), and every answer key it reads is a question of that version.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_print_problem(p_version integer, p_schema jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_map jsonb := public.cockpit_form_stage4_print_map(p_version);
  v_keys text[];
  v_obj jsonb;
  v_part text;
BEGIN
  IF v_map IS NULL THEN
    RETURN format('Version %s has no print map, so its answers cannot reach Make''s texts.', p_version);
  END IF;
  IF (SELECT array_agg(r->>'ref' ORDER BY r->>'ref') FROM jsonb_array_elements(v_map->'refs') r)
     IS DISTINCT FROM (SELECT array_agg(f->>'typeformRef' ORDER BY f->>'typeformRef')
                         FROM jsonb_array_elements(public.cockpit_form_stage4_fields('onboarding')) f) THEN
    RETURN format('The print map of version %s does not print exactly KFRCXPFx''s 36 questions.', p_version);
  END IF;
  v_keys := ARRAY(SELECT f->>'key' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_schema->'fields') = 'array'
                                                                  THEN p_schema->'fields' ELSE '[]'::jsonb END) f
                   WHERE f->>'type' NOT IN ('heading','note'));
  FOR v_obj IN SELECT o FROM jsonb_path_query(v_map->'refs', 'strict $.**') o WHERE jsonb_typeof(o) = 'object' LOOP
    FOR v_part IN SELECT x FROM unnest(ARRAY['text','number','list','choice','rows','tickText','areas','other','note']) x LOOP
      IF jsonb_typeof(v_obj->v_part) = 'string' AND NOT ((v_obj->>v_part) = ANY(v_keys)) THEN
        RETURN format('The print map of version %s reads %s, which that version does not ask.', p_version, left(v_obj->>v_part, 40));
      END IF;
    END LOOP;
    IF jsonb_typeof(v_obj->'lists') = 'object'
       AND EXISTS (SELECT 1 FROM jsonb_each_text(v_obj->'lists') l WHERE NOT (l.value = ANY(v_keys))) THEN
      RETURN format('The print map of version %s reads an area list that version does not ask.', p_version);
    END IF;
    IF v_obj ? 'template' AND NOT v_obj ? 'number' AND NOT (ARRAY['apptMinutes','bufferMinutes'] <@ v_keys) THEN
      RETURN format('The print map of version %s reads the appointment''s minutes, which that version does not ask.', p_version);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

-- A version's answers as the Typeform answers list [{ref, title, value}] every Make-mirroring text and reader
-- takes. Without a print map (every kickoff, the onboarding's version 2): cockpit_form_stage4_typeform_answers,
-- byte for byte. With one: each of cockpit_form_stage4_fields('onboarding')'s refs in its order and with its title,
-- printed by the map, an empty one left out.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_print(p_form_key text, p_version integer, p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_map jsonb := CASE WHEN p_form_key = 'onboarding' THEN public.cockpit_form_stage4_print_map(p_version) END;
  v_q jsonb;
  v_spec jsonb;
  v_text text;
  v_out jsonb := '[]'::jsonb;
BEGIN
  IF v_map IS NULL THEN
    RETURN public.cockpit_form_stage4_typeform_answers(p_form_key, p_answers);
  END IF;
  FOR v_q IN SELECT u.el FROM jsonb_array_elements(public.cockpit_form_stage4_fields('onboarding')) WITH ORDINALITY AS u(el, n)
              ORDER BY u.n LOOP
    v_spec := NULL;
    SELECT r->'print' INTO v_spec FROM jsonb_array_elements(v_map->'refs') r WHERE r->>'ref' = v_q->>'typeformRef' LIMIT 1;
    CONTINUE WHEN v_spec IS NULL;
    v_text := public.cockpit_form_stage4_print_part(v_spec, p_answers);
    CONTINUE WHEN v_text IS NULL OR v_text = '';
    v_out := v_out || jsonb_build_array(jsonb_build_object('ref', v_q->>'typeformRef', 'title', v_q->>'title', 'value', v_text));
  END LOOP;
  RETURN v_out;
END $$;

-- The read model's structured sidecar of a version with a print map: its answers without the contact keys (the
-- map's sidecar.keysExcluded: full name, phone, email, front desk phone, personal phone), with schemaVersion.
-- NULL for every other version. Cockpit only; never in a Make-mirroring text.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_structured(p_version integer, p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_map jsonb := public.cockpit_form_stage4_print_map(p_version); v jsonb; v_key text;
BEGIN
  IF v_map IS NULL OR jsonb_typeof(p_answers) IS DISTINCT FROM 'object' THEN
    RETURN NULL;
  END IF;
  v := p_answers;
  FOR v_key IN SELECT x FROM jsonb_array_elements_text(v_map->'sidecar'->'keysExcluded') x LOOP
    v := v - v_key;
  END LOOP;
  RETURN v || jsonb_build_object('schemaVersion', p_version);
END $$;

-- One response as the builder's input: 20261102j's, except that the answers list is printed for the answer's
-- version (cockpit_form_stage4_print; a version-2 answer's list is byte for byte as before) and a version-3 answer
-- adds structured.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_input(p_response_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cockpit_form_responses; a public.cockpit_billing_accounts; v_hidden jsonb := '{}'::jsonb; h record;
  v_structured jsonb;
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  IF r.id IS NULL OR r.form_key NOT IN ('kickoff','onboarding') OR r.task_id IS NULL THEN
    RAISE EXCEPTION 'There is no Stage 4 answer with that ID.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO a FROM public.cockpit_billing_accounts x WHERE x.clickup_task_id = r.task_id;
  IF r.form_key = 'kickoff' THEN
    FOR h IN SELECT k, v FROM jsonb_each(public.cockpit_form_stage4_hidden(r.task_id)) AS e(k, v) LOOP
      v_hidden := v_hidden || jsonb_build_object(h.k, h.v->>'value');
    END LOOP;
  END IF;
  -- 20261103h: a version with a print map (the structured onboarding) carries its answers beside the list.
  v_structured := CASE WHEN r.form_key = 'onboarding' THEN public.cockpit_form_stage4_structured(r.form_version, r.answers) END;
  RETURN jsonb_build_object(
    'formKey', r.form_key, 'taskId', r.task_id,
    'client', coalesce(nullif(btrim(a.client_name), ''), r.client_name),
    'responseId', r.id, 'submittedAt', to_char(r.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'second', coalesce((r.answer_meta->>'second')::boolean, false),
    'answers', public.cockpit_form_stage4_print(r.form_key, r.form_version, r.answers),
    'hidden', v_hidden,
    'newMrrUsd', CASE WHEN jsonb_typeof(r.answers->'newMrrUsd') = 'number' THEN r.answers->'newMrrUsd' END,
    'cardMrr', to_jsonb(a.mrr_usd), 'cardOnSheet', a.clickup_task_id IS NOT NULL,
    'readModelFormId', CASE WHEN r.source IN ('typeform_webhook','typeform_sync') THEN 'KFRCXPFx' ELSE 'native' END,
    'readModelResponseId', CASE WHEN r.source IN ('typeform_webhook','typeform_sync') THEN r.external_id ELSE r.id::text END)
    || CASE WHEN v_structured IS NOT NULL THEN jsonb_build_object('structured', v_structured) ELSE '{}'::jsonb END;
END $$;

-- The plan builder: 20261102p's, except that the read model's entry carries the input's structured sidecar
-- when there is one (a version-3 onboarding answer). Every other part, and every version-2 plan, is as before.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_build(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_form text := p_input->>'formKey';
  v_task text := p_input->>'taskId';
  v_answers jsonb := CASE WHEN jsonb_typeof(p_input->'answers') = 'array' THEN p_input->'answers' ELSE '[]'::jsonb END;
  v_hidden jsonb := CASE WHEN jsonb_typeof(p_input->'hidden') = 'object' THEN p_input->'hidden' ELSE '{}'::jsonb END;
  v_second boolean := coalesce((p_input->>'second')::boolean, false);
  v_titles jsonb := public.cockpit_form_stage4_setting('onboarding.raw_titles')->'fields';
  v_at timestamptz := public.cockpit_form_stage4_ts(p_input->>'submittedAt');
  v_by_ref jsonb;
  v_handoff text;
  v_new numeric;
  v_card numeric;
  v_fields jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb;
  c jsonb;
  v_answer text;
  v_option text;
  v_part text;
  v_map text;
  v_msg jsonb;
  v_profile text;
  v_raw text;
  v_raw_missing text;
  v_untitled integer;
  v_out jsonb := '[]'::jsonb;
  v_skip text;
  v_brief text;
  v_note text;
BEGIN
  IF v_form NOT IN ('kickoff','onboarding') OR v_task IS NULL OR v_task !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'The Stage 4 plan needs the form and the card.' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(jsonb_object_agg(a->>'ref', a->>'value'), '{}'::jsonb) INTO v_by_ref FROM jsonb_array_elements(v_answers) a;

  IF v_form = 'kickoff' THEN
    -- The handoff text (Make 12 [11], [18], [23]).
    v_handoff := public.cockpit_form_stage4_handoff_text(v_hidden, v_by_ref);
    v_new := CASE WHEN jsonb_typeof(p_input->'newMrrUsd') = 'number' THEN (p_input->>'newMrrUsd')::numeric END;
    v_card := CASE WHEN jsonb_typeof(p_input->'cardMrr') = 'number' THEN (p_input->>'cardMrr')::numeric END;

    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'handoff_comment', 'delivery', 'clickup_queue',
      'plan', jsonb_build_object('taskId', v_task, 'comment_text', v_handoff,
                                 'lines', jsonb_build_array('Handoff comment on the card (' || char_length(v_handoff) || ' characters)'))));
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'native_status', 'delivery', 'clickup_queue',
      'plan', jsonb_build_object('taskId', v_task, 'status', 'IN PROGRESS', 'lines', jsonb_build_array('Task status: IN PROGRESS'))));

    -- The card fields (Make 12 [21]): Client Status, the nine dropdowns by the option maps, and the
    -- Blueprint link pointing at the cockpit Blueprint (the intended difference of 4.13.3).
    v_fields := jsonb_build_array(jsonb_build_object('fieldId', '9368ca9e-3549-4320-84ff-9abd0a2901cb', 'kind', 'drop_down',
      'optionId', 'dbd21650-59ce-429c-882d-5afd7d8aaa8a', 'optionName', 'Brand Blueprint Booked♠️', 'label', 'Client Status'));
    v_lines := jsonb_build_array('Client Status: Brand Blueprint Booked♠️');
    FOR c IN SELECT x FROM jsonb_array_elements(public.cockpit_form_stage4_card_fields()) WITH ORDINALITY AS u(x, n) ORDER BY n LOOP
      v_answer := nullif(btrim(coalesce(v_by_ref->>(c->>'ref'), '')), '');
      CONTINUE WHEN v_answer IS NULL;
      v_option := NULL;
      -- Service Advertised is a multi choice: Make writes switch(first(list)), the option ticked first,
      -- and nothing when the map does not know it. Every other dropdown is one choice.
      FOREACH v_part IN ARRAY CASE WHEN c->>'fieldId' = 'bab9a58b-15af-4b0d-8e20-b8e5a4bee2cc'
                                   THEN (string_to_array(v_answer, ', '))[1:1] ELSE string_to_array(v_answer, ', ') END LOOP
        SELECT m.option_name INTO v_option FROM public.cockpit_form_option_maps m
         WHERE m.form_key = 'kickoff' AND m.field_id = c->>'fieldId' AND m.answer = btrim(v_part);
        EXIT WHEN v_option IS NOT NULL;
      END LOOP;
      CONTINUE WHEN v_option IS NULL;
      v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', c->>'fieldId', 'kind', 'drop_down',
        'optionName', v_option, 'label', c->>'label'));
      v_lines := v_lines || to_jsonb((c->>'label') || ': ' || v_option);
    END LOOP;
    v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', '1b7a4a74-d0e7-4a7f-9218-59c80a738186', 'kind', 'url',
      'value', 'https://cockpit.maharamedia.com/client-success/clients/' || v_task || '/present/blueprint?view=prep',
      'label', '🧬 Brand Blueprint Form Link'));
    v_lines := v_lines || to_jsonb('🧬 Brand Blueprint Form Link: the cockpit Blueprint'::text);
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'card_fields', 'delivery', 'clickup_queue',
      'plan', jsonb_build_object('taskId', v_task, 'fields', v_fields, 'lines', v_lines)));

    -- Empty card fields from the kickoff's typed answers and the call store (20261102n, B8).
    v_out := v_out || jsonb_build_array(public.cockpit_form_stage4_card_facts('kickoff', v_task, v_by_ref, v_at));

    -- The onboarding tasks (Make 12 [17] and [22] from their templates; [18] and [23] post the handoff on
    -- each, whole): comment_text is that comment, for the request writer's task_comment step to post. The
    -- cockpit brief is the details, so each task's description holds the request writer's heading and the
    -- brief (20261102n, B1); a type with no details field would drop it, and the plan says so.
    v_brief := public.cockpit_form_stage4_task_brief(v_task, v_by_ref, v_at);
    v_note := public.cockpit_form_stage4_details_note('client_onboarding');
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'onboarding_tasks', 'delivery', 'sql',
      'plan', jsonb_build_object('typeKey', 'client_onboarding', 'comment_text', v_handoff,
                                 'details', v_brief, 'detailsKind', 'brief',
                                 'lines', jsonb_build_array('Technical Onboarding Check and Creative Onboarding tasks',
                                   coalesce(v_note, 'Cockpit brief in each task''s description (' || char_length(v_brief) || ' characters)')))
              || CASE WHEN v_note IS NOT NULL THEN jsonb_build_object('detailsMissing', v_note) ELSE '{}'::jsonb END));

    v_map := public.cockpit_form_stage4_map_url(4, v_task);
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'map_phase4', 'delivery', 'clickup_queue',
      'plan', jsonb_build_object('taskId', v_task, 'fieldId', '51f49cb1-9f76-48be-b639-c42ca552d20a', 'phase', 4, 'value', v_map,
                                 'lines', jsonb_build_array('Onboarding Map: phase 4')),
      'missing', CASE WHEN v_map IS NULL THEN 'The phase 4 map link is not set up yet (onboarding.map_urls), so the map was not moved.' END));

    v_msg := public.cockpit_form_stage4_message('phase4', p_input->>'client', v_map);
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'phase4_whatsapp', 'delivery', 'client_message',
      'plan', jsonb_build_object('kind', 'phase4', 'body', v_msg->>'body', 'lines', jsonb_build_array('Phase 4 WhatsApp, waiting for the CSM''s approval')),
      'missing', v_msg->>'missing'));

    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'kickoff_notice', 'delivery', 'slack_notice',
      'plan', jsonb_build_object('dedupe', 'kickoff:' || coalesce(p_input->>'readModelResponseId', p_input->>'responseId', ''),
                                 'lines', jsonb_build_array('Kickoff notice in #csm-general'))));

    -- New MRR (Q21, 3.5): the live mrr write only when the answer differs from the card's; never for
    -- 0 against an empty card MRR; never for a card off the billing sheet.
    v_skip := CASE
      WHEN v_new IS NULL THEN 'No New MRR answer, so the card''s MRR is left as it is.'
      WHEN NOT coalesce((p_input->>'cardOnSheet')::boolean, false) THEN 'This card is not on the billing sheet, so New MRR is not written.'
      WHEN v_card IS NOT NULL AND v_card = v_new THEN 'The card already shows that MRR.'
      WHEN v_new = 0 AND coalesce(v_card, 0) = 0 THEN 'New MRR is 0 and the card''s MRR is empty, so nothing changes.'
    END;
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'new_mrr', 'delivery', 'sql',
      'plan', jsonb_build_object('from', v_card, 'to', v_new,
                                 'reason', CASE WHEN v_new = 0 THEN 'Kickoff: paid in full, no monthly fee' ELSE 'Kickoff: New MRR answer' END,
                                 'lines', jsonb_build_array('MRR: ' || coalesce('$' || trim_scale(v_card)::text, 'empty') || ' to '
                                                            || coalesce('$' || trim_scale(v_new)::text, 'not given'))),
      'skip', v_skip));
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'recap', 'delivery', 'client_message',
      'plan', jsonb_build_object('lines', jsonb_build_array('Recap: stays off (Q22)')),
      'skip', 'Kickoff recaps stay off (Q22).'));

    -- A second kickoff (4.13, 3.3): only the handoff comment again.
    IF v_second THEN
      SELECT coalesce(jsonb_agg(CASE WHEN x->>'key' = 'handoff_comment' THEN x
                                     ELSE x || jsonb_build_object('skip', coalesce(x->>'skip',
                                       'A second kickoff posts only the handoff comment.')) END ORDER BY n), '[]'::jsonb)
        INTO v_out FROM jsonb_array_elements(v_out) WITH ORDINALITY AS u(x, n);
    END IF;
    RETURN v_out;
  END IF;

  -- Onboarding (Make 13): the Client Profile and the kickoff link, the raw answers comment, the map
  -- at phase 3, the market intel dispatch (relay), the phase 3 WhatsApp, the Brand DNA task and the
  -- read model. Nothing writes Client Data: Make 13 [31] only searches it (20261102l).
  v_profile := public.cockpit_form_stage4_profile_text(v_by_ref);
  -- The raw answers comment needs a full title for every answered question of the form (X20).
  IF jsonb_typeof(v_titles) IS DISTINCT FROM 'array' THEN
    v_titles := '[]'::jsonb;
  END IF;
  IF jsonb_array_length(v_titles) = 0
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_titles) t
                 WHERE jsonb_typeof(t->'ref') IS DISTINCT FROM 'string' OR jsonb_typeof(t->'title') IS DISTINCT FROM 'string'
                    OR btrim(t->>'title') = '') THEN
    v_raw_missing := 'The onboarding form''s full question titles are not set up yet (onboarding.raw_titles), so the raw answers comment was not posted.';
  ELSE
    SELECT count(DISTINCT a->>'ref') INTO v_untitled FROM jsonb_array_elements(v_answers) a
     WHERE coalesce(a->>'value', '') <> ''
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(public.cockpit_form_stage4_fields('onboarding')) s WHERE s->>'typeformRef' = a->>'ref')
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_titles) t WHERE t->>'ref' = a->>'ref');
    IF v_untitled > 0 THEN
      v_raw_missing := format('The onboarding form''s full question titles (onboarding.raw_titles) have none for %s answered question%s, so the raw answers comment was not posted.',
                              v_untitled, CASE WHEN v_untitled = 1 THEN '' ELSE 's' END);
    ELSE
      v_raw := public.cockpit_form_stage4_raw_answers_text(v_answers, v_titles);
    END IF;
  END IF;
  -- The profile whole, as Make 13 [29] writes it (20261102l cut it at 5,000 characters).
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'profile_fields', 'delivery', 'clickup_queue',
    'plan', jsonb_build_object('taskId', v_task, 'fields', jsonb_build_array(
        jsonb_build_object('fieldId', '7755485f-74a8-496c-85d8-562588e77944', 'kind', 'text', 'value', v_profile, 'label', 'Client Profile'),
        jsonb_build_object('fieldId', '87d7d889-afea-42f8-9485-6f3ead5b857f', 'kind', 'url',
                           'value', 'https://cockpit.maharamedia.com/client-success/clients/' || v_task || '?form=kickoff',
                           'label', 'Kickoff Form Link')),
      'lines', jsonb_build_array('Client Profile (' || char_length(v_profile) || ' characters)', 'Kickoff Form Link: the cockpit kickoff'))));
  -- The card's Company Website from the website answer, when the card has none (20261102n, B8).
  v_out := v_out || jsonb_build_array(public.cockpit_form_stage4_card_facts('onboarding', v_task, v_by_ref, v_at));
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'raw_answers_comment', 'delivery', 'clickup_queue',
    'plan', jsonb_build_object('taskId', v_task, 'comment_text', v_raw,
                               'lines', jsonb_build_array(CASE WHEN v_raw IS NULL THEN 'Raw answers comment'
                                                               ELSE 'Raw answers comment (' || char_length(v_raw) || ' characters)' END)),
    'missing', v_raw_missing));
  v_map := public.cockpit_form_stage4_map_url(3, v_task);
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'map_phase3', 'delivery', 'clickup_queue',
    'plan', jsonb_build_object('taskId', v_task, 'fieldId', '51f49cb1-9f76-48be-b639-c42ca552d20a', 'phase', 3, 'value', v_map,
                               'lines', jsonb_build_array('Onboarding Map: phase 3')),
    'missing', CASE WHEN v_map IS NULL THEN 'The phase 3 map link is not set up yet (onboarding.map_urls), so the map was not moved.' END));
  -- Make 13 [25] sends the typed Business Name answer as client_name, empty when there is none.
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'github_dispatch', 'delivery', 'relay',
    'plan', jsonb_build_object('payload', jsonb_build_object('taskId', v_task,
                                                             'client', coalesce(v_by_ref->>'514bfd3f-4ca1-469e-b9e7-87656503f65c', '')),
                               'lines', jsonb_build_array('Market intel dispatch'))));
  v_msg := public.cockpit_form_stage4_message('phase3', p_input->>'client', v_map);
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'phase3_whatsapp', 'delivery', 'client_message',
    'plan', jsonb_build_object('kind', 'phase3', 'body', v_msg->>'body', 'lines', jsonb_build_array('Phase 3 WhatsApp, waiting for the CSM''s approval')),
    'missing', v_msg->>'missing'));
  -- The Brand DNA task (Make 13 [46]: a name, a list and an assignee, no dates and no description). The
  -- cockpit brief is its details (20261102n, B2); a type with no details field would drop it, and the
  -- plan says so.
  v_brief := public.cockpit_form_stage4_dna_brief(v_task, v_by_ref, p_input->>'client');
  v_note := public.cockpit_form_stage4_details_note('brand_dna');
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'brand_dna_task', 'delivery', 'sql',
    'plan', jsonb_build_object('typeKey', 'brand_dna', 'details', v_brief, 'detailsKind', 'dna_brief',
                               'lines', jsonb_build_array('Brand DNA task',
                                 coalesce(v_note, 'Cockpit brief in the task''s description (' || char_length(v_brief) || ' characters)')))
            || CASE WHEN v_note IS NOT NULL THEN jsonb_build_object('detailsMissing', v_note) ELSE '{}'::jsonb END));
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'read_model', 'delivery', 'sql',
    'plan', jsonb_build_object('entry', jsonb_build_object('form_id', coalesce(p_input->>'readModelFormId', 'native'),
                                                           'response_id', coalesce(p_input->>'readModelResponseId', p_input->>'responseId'),
                                                           'submitted_at', p_input->>'submittedAt', 'answers', v_answers)
                                        -- 20261103h: a version-3 answer's structured sidecar, cockpit only.
                                        || CASE WHEN jsonb_typeof(p_input->'structured') = 'object'
                                                THEN jsonb_build_object('structured', p_input->'structured') ELSE '{}'::jsonb END,
                               'lines', jsonb_build_array('Answers in the client record'))));
  RETURN v_out;
END $$;

-- ---------------------------------------------------------------------------
-- 4. The prefill (4 above)

-- {currency, areaCountries} for a card's onboarding invite, set by the server: from the billing sheet's country
-- (SA, KW, AE, QT, BH, OM), else from the newest sale tied to the card without a conflict (cockpit_sales_deals,
-- which writes Qatar QA), else {} (nothing prefilled: the client picks).
CREATE OR REPLACE FUNCTION public.cockpit_form_onboarding_context(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_map jsonb := '{"SA":["sar","sa"],"KW":["kwd","kw"],"AE":["aed","ae"],"QT":["qar","qa"],"QA":["qar","qa"],"BH":["bhd","bh"],"OM":["omr","om"]}'::jsonb;
  v_country text;
BEGIN
  SELECT upper(btrim(a.country)) INTO v_country FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = p_task_id;
  IF NOT (v_map ? coalesce(v_country, '')) THEN
    v_country := NULL;
    IF to_regprocedure('public.cockpit_billing_deal_cards()') IS NOT NULL AND to_regclass('public.cockpit_sales_deals') IS NOT NULL THEN
      SELECT upper(btrim(d.country)) INTO v_country
        FROM public.cockpit_billing_deal_cards() dc
        JOIN public.cockpit_sales_deals d ON d.response_id = dc.deal_response_id
       WHERE dc.clickup_task_id = p_task_id AND NOT coalesce(dc.conflict, false)
       ORDER BY d.submitted_at DESC NULLS LAST LIMIT 1;
    END IF;
  END IF;
  IF NOT (v_map ? coalesce(v_country, '')) THEN
    RETURN '{}'::jsonb;
  END IF;
  RETURN jsonb_build_object('currency', v_map->v_country->>0, 'areaCountries', jsonb_build_array(v_map->v_country->>1));
END $$;

-- The issue core: 20261102i's, except that the canary on the test card opens the structured onboarding while
-- forms.client.schema_v2 is canary, and a structured onboarding invite carries the server-set prefill.
CREATE OR REPLACE FUNCTION public.cockpit_form_invite_issue_core(p_task_id text, p_form_key text, p_channels text[],
  p_note text, p_lang text, p_push boolean, p_context jsonb, p_id uuid, p_origin text, p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f public.cockpit_forms;
  v_canary boolean := p_origin = 'canary';
  v_ver integer;
  v_schema jsonb;
  v_problem text;
  v_client text;
  v_open public.cockpit_form_invites;
  v_csat timestamptz;
  -- Waves 5-6 (20261102i): the bank receipt and the onboarding form in a sentence.
  v_words jsonb := CASE p_form_key WHEN 'bank_receipt' THEN '{"words":"receipt request","article":"A"}'::jsonb
                                   WHEN 'onboarding' THEN '{"words":"onboarding form","article":"An"}'::jsonb
                                   ELSE public.cockpit_form_words(p_form_key) END;
  v_channels text[];
  v_allowed text[];
  v_ws jsonb;
  v_location text;
  v_lang text := coalesce(nullif(btrim(p_lang), ''), 'ar');
  v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g')), '');
  v_ctx jsonb := coalesce(p_context, '{}'::jsonb);
  v_key text;
  v_start date;
  v_restart date;
  v_today date := public.cockpit_form_kuwait_day(now());
  v_body text;
  v_msg uuid;
  v_push boolean;
  v_prev text := current_setting('cockpit.forms_action', true);
BEGIN
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = p_form_key;
  IF f.key IS NULL OR f.audience <> 'client' OR p_form_key NOT IN ('pause_consent','exit_survey','nps','csat','bank_receipt','onboarding') THEN
    RAISE EXCEPTION 'This form is not sent to clients from here.' USING ERRCODE = '22023';
  END IF;
  IF v_canary AND p_task_id <> '86eywg1cq' THEN
    RAISE EXCEPTION 'The canary writes only the test card 86eywg1cq.' USING ERRCODE = '22023';
  END IF;
  IF NOT v_canary AND NOT public.cockpit_form_client_live(p_form_key) THEN
    RAISE EXCEPTION 'This form opens to clients after its switch-on.' USING ERRCODE = '22023';
  END IF;
  v_ver := public.cockpit_form_client_version(p_form_key);
  -- 20261103h: while forms.client.schema_v2 is canary, the canary on the test card opens the structured onboarding.
  IF v_canary AND p_form_key = 'onboarding' AND public.cockpit_form_schema_v2_state() = 'canary' THEN
    v_ver := coalesce(public.cockpit_form_structured_version(p_form_key), v_ver);
  END IF;
  IF v_ver IS NULL THEN
    RAISE EXCEPTION 'This form has no client version yet, so it cannot be sent.' USING ERRCODE = '22023';
  END IF;
  SELECT v.schema INTO v_schema FROM public.cockpit_form_versions v WHERE v.form_key = p_form_key AND v.version = v_ver;
  v_problem := coalesce(public.cockpit_form_schema_check(v_schema), public.cockpit_form_schema_text_problem(v_schema));
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'This form''s version % cannot be sent: %', v_ver, v_problem USING ERRCODE = '22023';
  END IF;
  -- Review fix: the portal before waves 5-6 (v1.6.0) refuses an invite over 10 minutes, and its
  -- release (D-P1) comes after this file. Until a waves 5-6 portal form (the bank receipt or the
  -- onboarding form) is live for clients, which the deploy order puts after D-P1, a longer form is
  -- not sent. The onboarding form is never held: it reaches clients only after its own go-live.
  IF p_form_key <> 'onboarding' AND (v_schema->>'minutes') ~ '^[0-9]{1,2}$' AND (v_schema->>'minutes')::integer > 10
     AND NOT (public.cockpit_form_client_live('bank_receipt') OR public.cockpit_form_client_live('onboarding')) THEN
    RAISE EXCEPTION 'This form takes % minutes, and the client portal shows a form of 10 minutes at most until the new portal is live. Publish it with 10 minutes or less.',
      (v_schema->>'minutes')::integer USING ERRCODE = '22023';
  END IF;
  IF p_form_key = 'pause_consent' AND p_origin NOT IN ('pause','canary') THEN
    RAISE EXCEPTION 'Send the pause consent from Pause this client.' USING ERRCODE = '22023';
  END IF;
  IF p_form_key = 'bank_receipt' AND p_origin NOT IN ('billing','canary') THEN
    RAISE EXCEPTION 'Ask for the receipt from Pending payments or Checks waiting.' USING ERRCODE = '22023';
  END IF;
  IF p_origin = 'billing' AND p_form_key <> 'bank_receipt' THEN
    RAISE EXCEPTION 'Pending payments and Checks waiting send the receipt request only.' USING ERRCODE = '22023';
  END IF;
  IF p_form_key = 'onboarding' AND p_origin NOT IN ('csm','portal','canary') THEN
    RAISE EXCEPTION 'Send the onboarding form from the client page.' USING ERRCODE = '22023';
  END IF;
  IF p_origin = 'portal' AND p_form_key <> 'onboarding' THEN
    RAISE EXCEPTION 'The portal opens the onboarding form only.' USING ERRCODE = '22023';
  END IF;

  SELECT a.client_name INTO v_client FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = p_task_id;
  IF v_client IS NULL THEN
    IF NOT v_canary THEN
      RAISE EXCEPTION 'This client is not on the billing sheet, so no form goes to them.' USING ERRCODE = '22023';
    END IF;
    v_client := 'Test card';
  END IF;
  v_client := left(btrim(v_client), 200);

  IF p_form_key = 'csat' THEN
    SELECT max(r.submitted_at) INTO v_csat FROM public.cockpit_form_responses r
     WHERE r.form_key = 'csat' AND r.task_id = p_task_id AND r.state IN ('submitted','confirmed') AND r.mode = 'live';
    IF v_csat IS NOT NULL THEN
      RAISE EXCEPTION 'They already filled the onboarding survey on %.', public.cockpit_form_day_words(v_csat) USING ERRCODE = '22023';
    END IF;
  END IF;
  SELECT * INTO v_open FROM public.cockpit_form_invites x
   WHERE x.task_id = p_task_id AND x.form_key = p_form_key AND x.purpose = p_form_key AND x.state = 'open';
  IF v_open.id IS NOT NULL THEN
    RAISE EXCEPTION '% % is already out to %, sent %. Withdraw it to send a new one.', v_words->>'article', v_words->>'words',
      v_client, public.cockpit_form_day_words(v_open.issued_at) USING ERRCODE = '22023';
  END IF;
  v_problem := public.cockpit_form_card_allows(p_task_id, p_form_key);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION '%', v_problem USING ERRCODE = '22023';
  END IF;

  -- Channels: the seats and the schedule pick the portal, WhatsApp or both;
  -- the canary takes a copy link, with or without a WhatsApp draft.
  v_allowed := CASE WHEN v_canary THEN ARRAY['copy','whatsapp'] ELSE ARRAY['portal','whatsapp'] END;
  SELECT coalesce(array_agg(DISTINCT c ORDER BY c), '{}') INTO v_channels FROM unnest(coalesce(p_channels, '{}')) c;
  IF cardinality(v_channels) = 0 OR NOT v_channels <@ v_allowed OR (v_canary AND NOT 'copy' = ANY(v_channels)) THEN
    RAISE EXCEPTION '%', CASE WHEN v_canary THEN 'The canary takes copy, or copy and whatsapp.'
                              ELSE 'Pick Portal, WhatsApp link or both.' END USING ERRCODE = '22023';
  END IF;
  v_ws := public.cockpit_form_workspace_of(p_task_id);
  v_location := CASE WHEN (v_ws->>'n')::integer = 1 THEN v_ws->>'locationId' END;
  IF 'portal' = ANY(v_channels) AND ((v_ws->>'n')::integer <> 1 OR (v_ws->>'closed')::boolean) THEN
    RAISE EXCEPTION '% has no open Mahara OS workspace. Send the WhatsApp link.', v_client USING ERRCODE = '22023';
  END IF;
  IF v_lang NOT IN ('ar','en') THEN
    RAISE EXCEPTION 'Pick Arabic or English for the WhatsApp text.' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_note) > 280 THEN
    RAISE EXCEPTION 'Keep the line for the client to 280 characters.' USING ERRCODE = '22023';
  END IF;
  v_problem := public.cockpit_client_text_ok(v_note);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION '%', v_problem USING ERRCODE = '22023';
  END IF;

  -- The context, per purpose (3.2); the issue hooks set the rest.
  IF jsonb_typeof(v_ctx) IS DISTINCT FROM 'object' OR octet_length(v_ctx::text) > 4096 THEN
    RAISE EXCEPTION 'Send the form''s facts as an object under 4 KB.' USING ERRCODE = '22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(v_ctx) LOOP
    IF NOT (v_key = ANY(CASE p_form_key WHEN 'pause_consent' THEN ARRAY['start','restart','reasonCat','callId','over14']
                                        WHEN 'exit_survey' THEN ARRAY['departureId']
                                        WHEN 'nps' THEN ARRAY['round']
                                        WHEN 'bank_receipt' THEN ARRAY['part','partNo','expectedAmount','currency','dueOn',
                                                                       'manualPaymentId','dealResponseId']
                                        WHEN 'onboarding' THEN ARRAY[]::text[]
                                        ELSE ARRAY['try'] END)) THEN
      RAISE EXCEPTION 'The % does not take %.', v_words->>'words', left(v_key, 40) USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF p_form_key = 'pause_consent' THEN
    BEGIN
      v_start := (v_ctx->>'start')::date;
      v_restart := (v_ctx->>'restart')::date;
    EXCEPTION WHEN OTHERS THEN
      v_start := NULL;
    END;
    IF v_start IS NULL OR v_start < v_today OR v_start > v_today + 14 THEN
      RAISE EXCEPTION 'The pause starts today or within 14 days.' USING ERRCODE = '22023';
    END IF;
    IF v_restart IS NULL OR v_restart <= v_start THEN
      RAISE EXCEPTION 'Pick the restart day, after the start.' USING ERRCODE = '22023';
    END IF;
    IF (v_ctx ? 'reasonCat' AND (jsonb_typeof(v_ctx->'reasonCat') <> 'string' OR char_length(v_ctx->>'reasonCat') > 60))
       OR (v_ctx ? 'callId' AND v_ctx->'callId' <> 'null'::jsonb
           AND (jsonb_typeof(v_ctx->'callId') <> 'string' OR char_length(v_ctx->>'callId') > 200)) THEN
      RAISE EXCEPTION 'Send the pause reason and the call as short texts.' USING ERRCODE = '22023';
    END IF;
    v_ctx := v_ctx || jsonb_build_object('start', v_start, 'restart', v_restart, 'over14', (v_restart - v_start) > 14);
  ELSIF p_form_key = 'exit_survey' AND v_ctx ? 'departureId'
        AND (jsonb_typeof(v_ctx->'departureId') <> 'number' OR (v_ctx->>'departureId') !~ '^[0-9]{1,18}$') THEN
    RAISE EXCEPTION 'Send the departure as its number.' USING ERRCODE = '22023';
  ELSIF p_form_key = 'nps' AND v_ctx ? 'round'
        AND (jsonb_typeof(v_ctx->'round') <> 'number' OR (v_ctx->>'round') !~ '^[1-9][0-9]{0,3}$') THEN
    RAISE EXCEPTION 'The NPS round is a whole number from 1.' USING ERRCODE = '22023';
  ELSIF p_form_key = 'csat' AND v_ctx ? 'try'
        AND (jsonb_typeof(v_ctx->'try') <> 'number' OR (v_ctx->>'try') !~ '^[1-4]$') THEN
    RAISE EXCEPTION 'The onboarding survey try is a whole number from 1 to 4.' USING ERRCODE = '22023';
  END IF;

  -- 20261103h: a structured onboarding invite carries the prefill the server sets (its caller sends none: refused
  -- above); a version-2 invite keeps an empty context.
  IF p_form_key = 'onboarding' AND v_schema->'v' = '2'::jsonb THEN
    v_ctx := public.cockpit_form_onboarding_context(p_task_id);
  END IF;
  IF 'whatsapp' = ANY(v_channels) THEN
    v_body := v_schema->'invite'->'whatsapp'->>v_lang;
    IF v_body IS NULL THEN
      RAISE EXCEPTION 'This form has no WhatsApp text yet.' USING ERRCODE = '22023';
    END IF;
    v_body := replace(v_body, '{client}', v_client);
    v_problem := public.cockpit_client_text_ok(v_body);
    IF v_problem IS NOT NULL OR char_length(v_body) > 1000 THEN
      RAISE EXCEPTION '%', coalesce(v_problem, 'The WhatsApp text is over 1,000 characters with the client''s name in it.')
        USING ERRCODE = '22023';
    END IF;
  END IF;
  v_push := coalesce(p_push, false) AND 'portal' = ANY(v_channels) AND NOT v_canary;

  PERFORM set_config('cockpit.forms_action', 'forms.invite_issued', true);
  BEGIN
    INSERT INTO public.cockpit_form_invites(id, task_id, client_name, location_id, form_key, form_version, purpose, context,
      channels, audience, note, lang, origin, issued_by, issued_by_email, issued_by_role, expires_at, push, push_state)
    VALUES (p_id, p_task_id, v_client, v_location, p_form_key, v_ver, p_form_key, v_ctx, v_channels,
            coalesce(v_schema->>'audience', 'any'), v_note, v_lang, p_origin,
            CASE WHEN p_actor->>'id' ~ '^[0-9a-fA-F-]{36}$' THEN (p_actor->>'id')::uuid END,
            lower(nullif(btrim(p_actor->>'email'), '')), coalesce(nullif(btrim(p_actor->>'role'), ''), 'the cockpit'),
            now() + interval '14 days', v_push, CASE WHEN v_push THEN 'waiting' ELSE 'off' END);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION '% % is already out to %. Withdraw it to send a new one.', v_words->>'article', v_words->>'words', v_client
      USING ERRCODE = '22023';
  END;
  PERFORM public.cockpit_form_invite_event(p_id, coalesce(p_actor->>'source', 'cockpit'), 'issued', NULL,
    jsonb_build_object('channels', to_jsonb(v_channels), 'push', v_push, 'origin', p_origin, 'note', v_note IS NOT NULL));
  IF v_body IS NOT NULL THEN
    PERFORM set_config('cockpit.forms_action', 'forms.message_drafted', true);
    INSERT INTO public.cockpit_client_messages(dedupe_key, task_id, client_name, kind, body, body_sha256, group_source, invite_id)
    VALUES ('invite:' || p_id::text, p_task_id, v_client, 'form_invite', v_body,
            encode(pg_catalog.sha256(convert_to(v_body, 'UTF8')), 'hex'), 'client_data_f', p_id)
    RETURNING id INTO v_msg;
    PERFORM set_config('cockpit.forms_action', 'forms.invite_message', true);
    UPDATE public.cockpit_form_invites SET message_id = v_msg, updated_at = now() WHERE id = p_id;
  END IF;
  PERFORM public.cockpit_form_client_issued(p_id);
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev, ''), true);
  RETURN jsonb_build_object('inviteId', p_id, 'messageId', v_msg,
    'delivered', CASE WHEN 'portal' = ANY(v_channels) THEN 'portal'
                      WHEN 'whatsapp' = ANY(v_channels) THEN 'waiting_approval' ELSE 'copy' END);
END $$;

-- The invite's context as a client may see it: 20261102a's (only the facts the schema declares, the keys its boldIf
-- lines read, and over14), except that a structured onboarding invite (client form schema version 2) also passes
-- currency and areaCountries, the prefill the issue core set on it, so the portal's prefillAnswers can fill them
-- (portal_form_get, portal_form_token_open). Every other invite passes exactly what it passed before.
CREATE OR REPLACE FUNCTION public.cockpit_form_client_context(p_invite public.cockpit_form_invites)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s jsonb := public.cockpit_form_invite_schema(p_invite); v_keys text[];
BEGIN
  SELECT coalesce(array_agg(k), '{}') INTO v_keys FROM (
    SELECT c->>'key' AS k
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s->'context') = 'array' THEN s->'context' ELSE '[]'::jsonb END) c
     WHERE jsonb_typeof(c) = 'object'
    UNION
    SELECT f->'boldIf'->>'context'
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s->'fields') = 'array' THEN s->'fields' ELSE '[]'::jsonb END) f
     WHERE jsonb_typeof(f) = 'object' AND jsonb_typeof(f->'boldIf') = 'object'
    UNION
    SELECT 'over14'
    UNION
    -- 20261103h: the structured onboarding's server-set prefill (cockpit_form_onboarding_context).
    SELECT x FROM unnest(ARRAY['currency', 'areaCountries']) x
     WHERE p_invite.form_key = 'onboarding' AND s->'v' = '2'::jsonb) u WHERE k IS NOT NULL;
  RETURN coalesce((SELECT jsonb_object_agg(e.key, e.value)
                     FROM jsonb_each(CASE WHEN jsonb_typeof(p_invite.context) = 'object' THEN p_invite.context ELSE '{}'::jsonb END) e
                    WHERE e.key = ANY(v_keys)), '{}'::jsonb);
END $$;

-- ---------------------------------------------------------------------------
-- 5. The Typeform door (5 above): 20261102o's, except that a KFRCXPFx delivery is always stored on version 2.
CREATE OR REPLACE FUNCTION public.cockpit_form_onboarding_typeform(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f public.cockpit_forms;
  v_token text := p_payload->>'externalId';
  v_at timestamptz;
  v_raw jsonb;
  v_hidden jsonb;
  v_card text;
  v_task text;
  v_client text;
  v_answered timestamptz;
  v_onboarding boolean := false;
  v_native jsonb;
  v_version integer;
  v_id uuid;
  v_state text;
  v_plan jsonb;
  v_prev_action text := current_setting('cockpit.forms_action', true);
  v_prev_actor text := current_setting('cockpit.audit_actor', true);
  v_prev_source text := current_setting('cockpit.audit_source', true);
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' OR p_payload->>'formKey' IS DISTINCT FROM 'onboarding' THEN
    RAISE EXCEPTION 'Only the client onboarding form is taken here.' USING ERRCODE = '22023';
  END IF;
  IF v_token IS NULL OR v_token !~ '^[A-Za-z0-9]{8,64}$' THEN
    RAISE EXCEPTION 'That is not a Typeform response token.' USING ERRCODE = '22023';
  END IF;
  v_at := public.cockpit_form_stage4_ts(p_payload->>'submittedAt');
  IF v_at IS NULL THEN
    RAISE EXCEPTION 'The response has no readable submit time.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_payload->'answers') IS DISTINCT FROM 'object' OR jsonb_typeof(p_payload->'answers'->'fields') IS DISTINCT FROM 'array'
     OR octet_length((p_payload->'answers')::text) > 1048576 THEN
    RAISE EXCEPTION 'Send the answers as {fields: [...]} under 1 MB.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = 'onboarding';
  v_raw := CASE WHEN jsonb_typeof(p_payload->'hidden') = 'object' THEN p_payload->'hidden' ELSE '{}'::jsonb END;
  v_hidden := jsonb_strip_nulls(jsonb_build_object(
    'client_name', CASE WHEN jsonb_typeof(v_raw->'client_name') = 'string' THEN left(nullif(btrim(v_raw->>'client_name'), ''), 200) END,
    'onboarding_client_id', CASE WHEN jsonb_typeof(v_raw->'onboarding_client_id') = 'string'
                                 THEN left(nullif(btrim(v_raw->>'onboarding_client_id'), ''), 60) END));
  v_card := coalesce(nullif(btrim(p_payload->>'taskId'), ''), v_hidden->>'onboarding_client_id');
  IF v_card ~ '^[A-Za-z0-9_-]{1,40}$' THEN
    SELECT x.t, x.n INTO v_task, v_client FROM (
      SELECT a.clickup_task_id AS t, a.client_name AS n, 1 AS o FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = v_card
      UNION ALL
      SELECT o.clickup_task_id, o.client_name, 2 FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = v_card) x
     ORDER BY x.o LIMIT 1;
  END IF;
  -- A token already stored: the same answer again.
  SELECT r.id, r.state INTO v_id, v_state FROM public.cockpit_form_responses r WHERE r.form_key = 'onboarding' AND r.external_id = v_token;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('inserted', false, 'responseId', v_id, 'taskId', v_task, 'stored', v_state);
  END IF;
  IF v_task IS NOT NULL THEN
    v_answered := public.cockpit_form_stage4_answered_at(v_task, NULL, v_token);
    v_onboarding := EXISTS (SELECT 1 FROM public.cockpit_client_onboarding o
                             WHERE o.clickup_task_id = v_task
                               AND (coalesce(o.in_onboarding, false) OR o.signup_on >= public.cockpit_billing_today() - 30))
                 OR EXISTS (SELECT 1 FROM public.cockpit_billing_accounts a
                             WHERE a.clickup_task_id = v_task AND a.stage_group = 'pipeline')
                 OR EXISTS (SELECT 1 FROM public.cockpit_billing_deal_cards() dc
                              JOIN public.cockpit_sales_deals d ON d.response_id = dc.deal_response_id
                             WHERE dc.clickup_task_id = v_task AND d.submitted_at >= now() - interval '30 days');
  END IF;

  PERFORM set_config('cockpit.audit_actor', 'typeform', true);
  PERFORM set_config('cockpit.audit_source', 'forms-door', true);
  IF v_task IS NULL OR v_answered IS NOT NULL OR NOT v_onboarding THEN
    -- Kept as an old link's answer (4.15.3), version 1's Typeform shape, never planned.
    PERFORM set_config('cockpit.forms_action', 'forms.legacy_recorded', true);
    INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state,
      answers, answer_meta, hidden, created_by, submitted_by, submitted_at)
    VALUES ('onboarding', 1, 'typeform_webhook', v_token, v_task, coalesce(v_client, v_hidden->>'client_name'), 'live', 'legacy',
            p_payload->'answers',
            jsonb_build_object('notice_on', public.cockpit_form_kuwait_day(v_at), 'owner', 'cockpit',
                               'why', CASE WHEN v_task IS NULL THEN 'no_card' WHEN v_answered IS NOT NULL THEN 'answered'
                                           ELSE 'not_onboarding' END)
              || CASE WHEN v_task IS NOT NULL THEN jsonb_build_object('match', 'hidden_id_unverified') ELSE '{}'::jsonb END,
            v_hidden, 'forms-door', 'typeform', v_at)
    RETURNING id INTO v_id;
    PERFORM public.cockpit_slack_notice_queue('legacy.received', 'legacy:' || v_id::text, v_task,
      CASE WHEN v_task IS NOT NULL THEN v_client END,
      jsonb_strip_nulls(jsonb_build_object('responseId', v_id, 'form', 'onboarding', 'matched', v_task IS NOT NULL, 'taskId', v_task,
        'client', CASE WHEN v_task IS NOT NULL THEN v_client END, 'submittedAt', public.cockpit_slack_notice_iso(v_at))),
      NULL, NULL, NULL);
    PERFORM set_config('cockpit.forms_action', coalesce(v_prev_action, ''), true);
    PERFORM set_config('cockpit.audit_actor', coalesce(v_prev_actor, ''), true);
    PERFORM set_config('cockpit.audit_source', coalesce(v_prev_source, ''), true);
    RETURN jsonb_build_object('inserted', true, 'responseId', v_id, 'taskId', v_task, 'stored', 'legacy');
  END IF;

  -- 20261102j's mapping, then each number question of the version it is stored on as a number (16).
  -- 20261103h: always version 2, the version whose questions map one to one onto KFRCXPFx's (a structured
  -- version's keys are not Typeform's, so mapping into it would lose the answers to _unmapped).
  v_version := 2;
  v_native := public.cockpit_form_stage4_numbers(
    (SELECT v.schema FROM public.cockpit_form_versions v WHERE v.form_key = 'onboarding' AND v.version = v_version),
    public.cockpit_form_stage4_native_answers('onboarding', p_payload->'answers'->'fields'));
  PERFORM set_config('cockpit.forms_action', 'forms.onboarding_typeform', true);
  INSERT INTO public.cockpit_form_responses(form_key, form_version, source, external_id, task_id, client_name, mode, state,
    answers, answer_meta, hidden, created_by, submitted_by, submitted_at)
  VALUES ('onboarding', v_version, 'typeform_webhook', v_token, v_task,
          v_client, 'live', 'submitted', v_native - '_unmapped',
          jsonb_strip_nulls(jsonb_build_object('notice_on', public.cockpit_form_kuwait_day(v_at), 'owner', 'cockpit', 'via', 'typeform',
            'match', 'hidden_id_unverified', 'unmapped', v_native->'_unmapped')),
          v_hidden, 'forms-door', 'typeform', v_at)
  RETURNING id INTO v_id;
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev_action, ''), true);
  v_plan := public.cockpit_form_hook_onboarding(v_id);
  PERFORM set_config('cockpit.audit_actor', coalesce(v_prev_actor, ''), true);
  PERFORM set_config('cockpit.audit_source', coalesce(v_prev_source, ''), true);
  RETURN jsonb_build_object('inserted', true, 'responseId', v_id, 'taskId', v_task, 'stored', 'native',
    'effects', jsonb_array_length(coalesce(v_plan->'effects', '[]'::jsonb)));
END $$;

-- ---------------------------------------------------------------------------
-- 6. Version 3 of the onboarding, stored (6 above). It must pass the version-2 check and the client text rule,
--    its print map must fit it, and its text must be the drafted one; then one row and one audit row
--    (cockpit_forms_audit, forms.onboarding_v3_stored). A second apply finds this file's row and changes nothing.

DO $$
DECLARE
  v_schema jsonb := '{"v":2,"key":"onboarding","title":{"en":"Tell us about your business","ar":"عرّفونا على شغلكم"},"intro":{"en":"Tell us about your business so your onboarding call starts in the right place. It takes about 30 minutes. Your answers stay on this device, so you can finish it in more than one sitting.","ar":"عرّفونا على شغلكم عشان مكالمة الانطلاق تبدي من المكان الصح. تاخذ تقريباً ٣٠ دقيقة، وردودكم تنحفظ على هالجهاز، فتقدرون تكملونها على كم مرة."},"minutes":30,"audience":"any","signer":"none","context":[],"fields":[{"key":"aboutYou","type":"heading","label":{"en":"About you and your business","ar":"عنكم وعن شغلكم"},"hint":null,"required":false},{"key":"fullName","type":"text","label":{"en":"Full Name","ar":"الاسم الكامل"},"hint":null,"required":true,"maxLength":1000},{"key":"phone","type":"text","label":{"en":"Phone","ar":"رقم التلفون"},"hint":null,"required":true,"maxLength":1000,"format":"phone"},{"key":"email","type":"text","label":{"en":"Email","ar":"الإيميل"},"hint":null,"required":true,"maxLength":1000,"format":"email"},{"key":"businessName","type":"text","label":{"en":"Business Name (in English)","ar":"اسم الشركة (بالإنقليزي)"},"hint":null,"required":true,"maxLength":1000},{"key":"address","type":"longtext","label":{"en":"Please enter your business address.","ar":"اكتبوا عنوان الشركة."},"hint":null,"required":false,"maxLength":10000},{"key":"mapsLink","type":"text","label":{"en":"Paste a Google Maps link to your location.","ar":"حطوا رابط موقعكم على قوقل ماب."},"hint":null,"required":false,"maxLength":1000},{"key":"noWebsite","type":"tick","label":{"en":"We don''t have a website yet","ar":"ما عندنا موقع ليلحين"},"hint":null,"required":false},{"key":"website","type":"text","label":{"en":"Website URL","ar":"رابط الموقع"},"hint":{"en":"For example: www.yourcompany.com","ar":"مثلاً: www.yourcompany.com"},"required":true,"maxLength":1000,"format":"url","showIf":{"key":"noWebsite","equals":false}},{"key":"instagram","type":"text","label":{"en":"Instagram URL","ar":"رابط الإنستقرام"},"hint":{"en":"For example: instagram.com/yourbrand","ar":"مثلاً: instagram.com/yourbrand"},"required":true,"maxLength":1000,"format":"url"},{"key":"noFacebookPage","type":"tick","label":{"en":"We don''t have a Facebook page","ar":"ما عندنا صفحة فيسبوك"},"hint":null,"required":false},{"key":"facebook","type":"text","label":{"en":"Facebook Page URL","ar":"رابط صفحة الفيسبوك"},"hint":{"en":"The link to your Facebook page, not your Instagram.","ar":"رابط صفحتكم على فيسبوك، مو الإنستقرام."},"required":true,"maxLength":1000,"format":"url","showIf":{"key":"noFacebookPage","equals":false}},{"key":"frontDeskPhone","type":"text","label":{"en":"Front Desk Phone","ar":"رقم الاستقبال"},"hint":null,"required":true,"maxLength":1000,"format":"phone"},{"key":"personalPhone","type":"text","label":{"en":"Personal Phone Number","ar":"رقمك الشخصي"},"hint":{"en":"We send appointment confirmations and updates to this number. Write one number only. If more people should get them, tell us on the onboarding call.","ar":"على هالرقم نرسل تأكيد المواعيد والتحديثات. اكتبوا رقم واحد بس، وإذا تبون أحد ثاني يوصله، قولوا لنا بمكالمة الانطلاق."},"required":true,"maxLength":1000,"format":"phone"},{"key":"startYear","type":"number","label":{"en":"What year did you start the business?","ar":"بأي سنة بديتوا الشغل؟"},"hint":{"en":"For example: 2015.","ar":"مثلاً: ٢٠١٥."},"required":true,"min":1950,"max":2030,"decimals":0},{"key":"projectsDone","type":"number","label":{"en":"About how many projects have you completed so far?","ar":"تقريباً كم مشروع خلّصتوا لين الحين؟"},"hint":{"en":"A rough number is fine.","ar":"رقم تقريبي يكفي."},"required":false,"min":0,"max":1000000,"decimals":0},{"key":"workHeading","type":"heading","label":{"en":"How you work with clients","ar":"شلون تشتغلون مع عملائكم"},"hint":null,"required":false},{"key":"facebookAds","type":"choice","label":{"en":"Do you have a facebook business manager or have you ever ran ads on meta (Facebook & Instagram) in the past?","ar":"عندكم حساب أعمال على فيسبوك، أو شغّلتوا إعلانات على ميتا (فيسبوك وإنستقرام) قبل؟"},"hint":null,"required":true,"options":[{"value":"yes","label":{"en":"Yes","ar":"إي"}},{"value":"unsure","label":{"en":"I''m not sure","ar":"مو متأكد"}},{"value":"ran_before","label":{"en":"I''ve run ads before but don''t know how to access my account","ar":"شغّلت إعلانات قبل بس ما أعرف شلون أدخل حسابي"}},{"value":"never_ran","label":{"en":"I have a business account but have never run ads","ar":"عندي حساب أعمال بس عمري ما شغّلت إعلانات"}},{"value":"restricted","label":{"en":"My account is restricted","ar":"حسابي مقيّد"}}]},{"key":"metaAccess","type":"note","label":{"en":"Give us access to your Facebook business manager before the onboarding call.","ar":"عطونا صلاحية على حساب الأعمال بفيسبوك قبل مكالمة الانطلاق."},"hint":null,"required":false,"link":{"href":"https://app.leadsie.com/connect/maharamedia/manage","label":{"en":"Give access","ar":"عطونا الصلاحية"}},"showIf":{"key":"facebookAds","in":["yes","never_ran"]}},{"key":"bookingTools","type":"multi","label":{"en":"How do clients book appointments with you today? (Select all that apply)","ar":"شلون يحجزون العملاء مواعيدهم عندكم الحين؟ (اختاروا كل اللي ينطبق)"},"hint":null,"required":true,"options":[{"value":"whatsapp","label":{"en":"WhatsApp messages","ar":"رسايل واتساب"}},{"value":"phone","label":{"en":"Phone calls","ar":"اتصالات"}},{"value":"paper_excel","label":{"en":"A notebook or an Excel sheet","ar":"دفتر أو شيت إكسل"}},{"value":"google_calendar","label":{"en":"Google Calendar","ar":"قوقل كالندر"}},{"value":"calendly","label":{"en":"Calendly","ar":"كالندلي"}},{"value":"other_software","label":{"en":"Other booking software","ar":"برنامج حجز ثاني"}}]},{"key":"bookingOther","type":"text","label":{"en":"Which booking software?","ar":"شنو اسم البرنامج؟"},"hint":null,"required":true,"maxLength":1000,"showIf":{"key":"bookingTools","includes":"other_software"}},{"key":"hoursDays","type":"multi","label":{"en":"Which days are you open for appointments?","ar":"أي أيام تستقبلون فيها مواعيد؟"},"hint":null,"required":true,"options":[{"value":"sun","label":{"en":"Sunday","ar":"الأحد"}},{"value":"mon","label":{"en":"Monday","ar":"الاثنين"}},{"value":"tue","label":{"en":"Tuesday","ar":"الثلاثاء"}},{"value":"wed","label":{"en":"Wednesday","ar":"الأربعاء"}},{"value":"thu","label":{"en":"Thursday","ar":"الخميس"}},{"value":"fri","label":{"en":"Friday","ar":"الجمعة"}},{"value":"sat","label":{"en":"Saturday","ar":"السبت"}}]},{"key":"hoursTimes","type":"text","label":{"en":"What hours? Write each shift.","ar":"شنو الأوقات؟ اكتبوا كل فترة."},"hint":{"en":"For example: 9am to 1pm and 4pm to 9pm.","ar":"مثلاً: من ٩ الصبح لين ١ الظهر، ومن ٤ العصر لين ٩ بالليل."},"required":true,"maxLength":1000},{"key":"appointmentTypes","type":"multi","label":{"en":"What types of appointments do you offer? (Select all that apply)","ar":"شنو أنواع المواعيد اللي تقدمونها؟ (اختاروا كل اللي ينطبق)"},"hint":null,"required":true,"options":[{"value":"online","label":{"en":"Online","ar":"أونلاين"}},{"value":"onsite","label":{"en":"Onsite / In-home","ar":"في موقع العميل أو بيته"}},{"value":"office","label":{"en":"In your office","ar":"في مكتبكم"}}]},{"key":"distanceMode","type":"choice","label":{"en":"How far do you travel for a home visit?","ar":"شكثر تبعدون عشان زيارة بيت العميل؟"},"hint":null,"required":true,"options":[{"value":"limit","label":{"en":"Up to a set distance","ar":"لين مسافة معيّنة"}},{"value":"anywhere","label":{"en":"Anywhere in the areas we serve","ar":"أي مكان بالمناطق اللي نخدمها"}}],"showIf":{"key":"appointmentTypes","includes":"onsite"}},{"key":"maxDistanceKm","type":"number","label":{"en":"The furthest you travel, in kilometres","ar":"أبعد مسافة تروحونها، بالكيلومتر"},"hint":null,"required":true,"min":1,"max":1000,"decimals":0,"showIf":{"key":"distanceMode","equals":"limit"}},{"key":"landmark","type":"longtext","label":{"en":"Local Landmark Information (Please type this in the format shown) - Located next to the Burger King down King Saud street on the left hand side.","ar":"معلم قريب منكم (اكتبوه بنفس الطريقة): مثلاً جنب برقر كنق بشارع الملك سعود على اليسار."},"hint":{"en":"Only if clients visit your office.","ar":"بس إذا العملاء يزورونكم بالمكتب."},"required":false,"maxLength":10000},{"key":"apptMinutes","type":"number","label":{"en":"How long is one appointment, in minutes?","ar":"كم دقيقة ياخذ الموعد الواحد؟"},"hint":{"en":"For example: 60.","ar":"مثلاً: ٦٠."},"required":true,"min":5,"max":480,"decimals":0},{"key":"bufferMinutes","type":"number","label":{"en":"How many minutes do you need between appointments?","ar":"كم دقيقة تحتاجون بين كل موعد والثاني؟"},"hint":{"en":"Write 0 if you need no time between them.","ar":"اكتبوا ٠ إذا ما تحتاجون وقت بينهم."},"required":true,"min":0,"max":240,"decimals":0},{"key":"apptDetails","type":"longtext","label":{"en":"Anything else about the appointment?","ar":"فيه شي ثاني عن الموعد؟"},"hint":{"en":"For example: what happens in it, or who should attend.","ar":"مثلاً: شنو يصير فيه، أو منو لازم يحضر."},"required":false,"maxLength":10000},{"key":"consultants","type":"rows","label":{"en":"Who are the engineers in your business that will be giving these consultations?","ar":"منو المهندسين في شركتكم اللي بيعطون الاستشارات ضمن هالبرنامج؟"},"hint":{"en":"One person per row.","ar":"كل شخص بسطر."},"required":true,"minRows":1,"maxRows":15,"addLabel":{"en":"Add another person","ar":"ضيفوا شخص ثاني"},"columns":[{"key":"name","type":"text","label":{"en":"Name","ar":"الاسم"},"hint":null,"required":true,"maxLength":300},{"key":"speciality","type":"text","label":{"en":"Speciality","ar":"التخصص"},"hint":null,"required":true,"maxLength":300},{"key":"nationality","type":"text","label":{"en":"Nationality","ar":"الجنسية"},"hint":null,"required":false,"maxLength":200},{"key":"qualifications","type":"text","label":{"en":"Qualifications","ar":"المؤهلات"},"hint":null,"required":false,"maxLength":1000}]},{"key":"freeConsults","type":"choice","label":{"en":"Do you offer free consultations?","ar":"تقدمون استشارات مجانية؟"},"hint":{"en":"Companies that offer a free consultation often get better results and more projects.","ar":"الشركات اللي تقدم استشارة مجانية عادةً تحصّل نتايج أحسن ومشاريع أكثر."},"required":true,"options":[{"value":"yes","label":{"en":"Yes, we offer free consultations","ar":"إي، نقدم استشارات مجانية"}},{"value":"open_to_it","label":{"en":"No, but we are open to it","ar":"لا، بس نقدر نفكر فيها"}},{"value":"no","label":{"en":"No, we do not offer them","ar":"لا، ما نقدمها"}}]},{"key":"paymentMethods","type":"multi","label":{"en":"Which payment options do you offer your clients? (Select all that apply)","ar":"شنو طرق الدفع اللي تعطونها لعملائكم؟ (اختاروا كل اللي ينطبق)"},"hint":null,"required":true,"options":[{"value":"full","label":{"en":"Full payment","ar":"دفعة كاملة"}},{"value":"instalments","label":{"en":"Installment plans","ar":"أقساط"}},{"value":"down_payment","label":{"en":"A down payment first","ar":"دفعة أولى (مقدّم)"}},{"value":"in_house","label":{"en":"Financing from you","ar":"تمويل منكم"}},{"value":"third_party","label":{"en":"Financing from a bank or another company","ar":"تمويل من بنك أو جهة ثانية"}}]},{"key":"paymentDetails","type":"longtext","label":{"en":"Anything we should know about your payment terms?","ar":"فيه شي لازم نعرفه عن طريقة الدفع عندكم؟"},"hint":{"en":"For example: 30% down, then three payments.","ar":"مثلاً: ٣٠٪ مقدّم، والباقي على ٣ دفعات."},"required":false,"maxLength":10000},{"key":"servicesHeading","type":"heading","label":{"en":"Your services and where you work","ar":"خدماتكم ووين تشتغلون"},"hint":null,"required":false},{"key":"currency","type":"choice","label":{"en":"Which currency do you price in?","ar":"بأي عملة تسعّرون؟"},"hint":{"en":"Your prices and revenue in this form use it.","ar":"الأسعار والدخل بهالفورم بهالعملة."},"required":true,"options":[{"value":"sar","label":{"en":"Saudi riyal (SAR)","ar":"ريال سعودي"}},{"value":"kwd","label":{"en":"Kuwaiti dinar (KWD)","ar":"دينار كويتي"}},{"value":"aed","label":{"en":"UAE dirham (AED)","ar":"درهم إماراتي"}},{"value":"qar","label":{"en":"Qatari riyal (QAR)","ar":"ريال قطري"}},{"value":"bhd","label":{"en":"Bahraini dinar (BHD)","ar":"دينار بحريني"}},{"value":"omr","label":{"en":"Omani riyal (OMR)","ar":"ريال عماني"}},{"value":"usd","label":{"en":"US dollar (USD)","ar":"دولار أمريكي"}}]},{"key":"services","type":"rows","label":{"en":"List all your services and their prices.","ar":"اكتبوا كل خدماتكم وأسعارها."},"hint":{"en":"One service per row. Tick the ones with the highest price and the most profit.","ar":"كل خدمة بسطر، وحطوا علامة على الأعلى سعر والأكثر ربح."},"required":true,"minRows":1,"maxRows":25,"addLabel":{"en":"Add another service","ar":"ضيفوا خدمة ثانية"},"columns":[{"key":"name","type":"text","label":{"en":"Service","ar":"الخدمة"},"hint":null,"required":true,"maxLength":300},{"key":"price","type":"number","label":{"en":"Price","ar":"السعر"},"hint":null,"required":false,"min":0,"max":1000000000,"decimals":0,"currencyFrom":"currency"},{"key":"unit","type":"choice","label":{"en":"Price is","ar":"السعر"},"hint":null,"required":false,"options":[{"value":"project","label":{"en":"per project","ar":"للمشروع"}},{"value":"sqm","label":{"en":"per square metre","ar":"للمتر المربع"}},{"value":"visit","label":{"en":"per visit","ar":"للزيارة"}},{"value":"starts_from","label":{"en":"a starting price","ar":"سعر يبدأ منه"}}]},{"key":"topPrice","type":"tick","label":{"en":"Highest price","ar":"الأعلى سعر"},"hint":null,"required":false},{"key":"topProfit","type":"tick","label":{"en":"Most profit","ar":"الأكثر ربح"},"hint":null,"required":false}]},{"key":"serviceFocus","type":"text","label":{"en":"Out of those what is the #1 service/type of project you want to focus on scaling?","ar":"من هالخدمات، شنو أهم خدمة أو نوع مشروع تبون تكبرونه؟"},"hint":{"en":"Pick one from your list above.","ar":"اختاروا وحدة من القائمة اللي فوق."},"required":true,"maxLength":1000},{"key":"idealProject","type":"longtext","label":{"en":"Please describe your ideal project in detail.","ar":"وصفوا لنا المشروع المثالي لكم بالتفصيل."},"hint":{"en":"For example: the type, the size, the budget and the area.","ar":"مثلاً: نوعه، حجمه، الميزانية، والمنطقة."},"required":true,"maxLength":10000},{"key":"faqs","type":"rows","label":{"en":"What are your top five most frequently asked questions and their answers? (Feel free to add more — the more detailed, the better.)","ar":"شنو أكثر خمس أسئلة يسألونكم عنها العملاء، وشنو أجوبتها؟ (تقدرون تزيدون، وكل ما كانت التفاصيل أكثر كان أحسن.)"},"hint":{"en":"Add at least three. More is better.","ar":"ضيفوا ٣ على الأقل، وكل ما زادت أحسن."},"required":true,"minRows":3,"maxRows":20,"addLabel":{"en":"Add another question","ar":"ضيفوا سؤال ثاني"},"columns":[{"key":"question","type":"text","label":{"en":"Question","ar":"السؤال"},"hint":null,"required":true,"maxLength":300},{"key":"answer","type":"longtext","label":{"en":"Your answer","ar":"جوابكم"},"hint":null,"required":true,"maxLength":2000}]},{"key":"areaCountries","type":"multi","label":{"en":"Which countries do you work in?","ar":"بأي دول تشتغلون؟"},"hint":{"en":"We target your ads on the areas you pick.","ar":"نوجّه إعلاناتكم على المناطق اللي تختارونها."},"required":true,"options":[{"value":"sa","label":{"en":"Saudi Arabia","ar":"السعودية"}},{"value":"kw","label":{"en":"Kuwait","ar":"الكويت"}},{"value":"ae","label":{"en":"UAE","ar":"الإمارات"}},{"value":"qa","label":{"en":"Qatar","ar":"قطر"}},{"value":"bh","label":{"en":"Bahrain","ar":"البحرين"}},{"value":"om","label":{"en":"Oman","ar":"عُمان"}},{"value":"other","label":{"en":"Another country","ar":"دولة ثانية"}}]},{"key":"areasSA","type":"multi","label":{"en":"Where in Saudi Arabia?","ar":"وين بالسعودية؟"},"hint":null,"required":true,"options":[{"value":"all_sa","label":{"en":"All of Saudi Arabia","ar":"كل السعودية"}},{"value":"riyadh","label":{"en":"Riyadh","ar":"الرياض"}},{"value":"jeddah","label":{"en":"Jeddah","ar":"جدة"}},{"value":"makkah","label":{"en":"Makkah","ar":"مكة"}},{"value":"madinah","label":{"en":"Madinah","ar":"المدينة"}},{"value":"dammam","label":{"en":"Dammam","ar":"الدمام"}},{"value":"khobar","label":{"en":"Khobar","ar":"الخبر"}},{"value":"dhahran","label":{"en":"Dhahran","ar":"الظهران"}},{"value":"qatif","label":{"en":"Qatif","ar":"القطيف"}},{"value":"ahsa","label":{"en":"Al Ahsa","ar":"الأحساء"}},{"value":"jubail","label":{"en":"Jubail","ar":"الجبيل"}},{"value":"qassim","label":{"en":"Qassim","ar":"القصيم"}},{"value":"taif","label":{"en":"Taif","ar":"الطائف"}},{"value":"abha_khamis","label":{"en":"Abha and Khamis Mushait","ar":"أبها وخميس مشيط"}},{"value":"tabuk","label":{"en":"Tabuk","ar":"تبوك"}},{"value":"hail","label":{"en":"Hail","ar":"حائل"}},{"value":"jazan","label":{"en":"Jazan","ar":"جازان"}},{"value":"najran","label":{"en":"Najran","ar":"نجران"}},{"value":"yanbu","label":{"en":"Yanbu","ar":"ينبع"}}],"showIf":{"key":"areaCountries","includes":"sa"}},{"key":"areasKW","type":"multi","label":{"en":"Where in Kuwait?","ar":"وين بالكويت؟"},"hint":null,"required":true,"options":[{"value":"all_kw","label":{"en":"All of Kuwait","ar":"كل الكويت"}},{"value":"capital","label":{"en":"Capital","ar":"العاصمة"}},{"value":"hawalli","label":{"en":"Hawalli","ar":"حولي"}},{"value":"farwaniya","label":{"en":"Farwaniya","ar":"الفروانية"}},{"value":"mubarak","label":{"en":"Mubarak Al-Kabeer","ar":"مبارك الكبير"}},{"value":"ahmadi","label":{"en":"Ahmadi","ar":"الأحمدي"}},{"value":"jahra","label":{"en":"Jahra","ar":"الجهراء"}}],"showIf":{"key":"areaCountries","includes":"kw"}},{"key":"areasAE","type":"multi","label":{"en":"Where in the UAE?","ar":"وين بالإمارات؟"},"hint":null,"required":true,"options":[{"value":"all_ae","label":{"en":"All of the UAE","ar":"كل الإمارات"}},{"value":"dubai","label":{"en":"Dubai","ar":"دبي"}},{"value":"abu_dhabi","label":{"en":"Abu Dhabi","ar":"أبوظبي"}},{"value":"sharjah","label":{"en":"Sharjah","ar":"الشارقة"}},{"value":"ajman","label":{"en":"Ajman","ar":"عجمان"}},{"value":"al_ain","label":{"en":"Al Ain","ar":"العين"}},{"value":"rak","label":{"en":"Ras Al Khaimah","ar":"رأس الخيمة"}},{"value":"fujairah","label":{"en":"Fujairah","ar":"الفجيرة"}},{"value":"uaq","label":{"en":"Umm Al Quwain","ar":"أم القيوين"}}],"showIf":{"key":"areaCountries","includes":"ae"}},{"key":"areasQA","type":"multi","label":{"en":"Where in Qatar?","ar":"وين بقطر؟"},"hint":null,"required":true,"options":[{"value":"all_qa","label":{"en":"All of Qatar","ar":"كل قطر"}},{"value":"doha","label":{"en":"Doha","ar":"الدوحة"}},{"value":"rayyan","label":{"en":"Al Rayyan","ar":"الريان"}},{"value":"lusail","label":{"en":"Lusail","ar":"لوسيل"}},{"value":"wakrah","label":{"en":"Al Wakrah","ar":"الوكرة"}},{"value":"khor","label":{"en":"Al Khor","ar":"الخور"}},{"value":"umm_salal","label":{"en":"Umm Salal","ar":"أم صلال"}},{"value":"daayen","label":{"en":"Al Daayen","ar":"الضعاين"}}],"showIf":{"key":"areaCountries","includes":"qa"}},{"key":"areasBH","type":"multi","label":{"en":"Where in Bahrain?","ar":"وين بالبحرين؟"},"hint":null,"required":true,"options":[{"value":"all_bh","label":{"en":"All of Bahrain","ar":"كل البحرين"}},{"value":"capital","label":{"en":"Capital (Manama)","ar":"العاصمة (المنامة)"}},{"value":"muharraq","label":{"en":"Muharraq","ar":"المحرق"}},{"value":"northern","label":{"en":"Northern","ar":"الشمالية"}},{"value":"southern","label":{"en":"Southern","ar":"الجنوبية"}}],"showIf":{"key":"areaCountries","includes":"bh"}},{"key":"areasOM","type":"multi","label":{"en":"Where in Oman?","ar":"وين بعُمان؟"},"hint":null,"required":true,"options":[{"value":"all_om","label":{"en":"All of Oman","ar":"كل عُمان"}},{"value":"muscat","label":{"en":"Muscat","ar":"مسقط"}},{"value":"dhofar","label":{"en":"Dhofar (Salalah)","ar":"ظفار (صلالة)"}},{"value":"batinah","label":{"en":"Al Batinah (Sohar)","ar":"الباطنة (صحار)"}},{"value":"dakhiliyah","label":{"en":"Ad Dakhiliyah (Nizwa)","ar":"الداخلية (نزوى)"}},{"value":"sharqiyah","label":{"en":"Ash Sharqiyah","ar":"الشرقية"}}],"showIf":{"key":"areaCountries","includes":"om"}},{"key":"areasOther","type":"text","label":{"en":"Which country and cities?","ar":"أي دولة وأي مدن؟"},"hint":null,"required":true,"maxLength":1000,"showIf":{"key":"areaCountries","includes":"other"}},{"key":"areasNote","type":"longtext","label":{"en":"Any neighbourhoods you focus on, or areas you don''t serve?","ar":"فيه أحياء تركزون عليها، أو مناطق ما تخدمونها؟"},"hint":null,"required":false,"maxLength":10000},{"key":"goalsHeading","type":"heading","label":{"en":"Your goals and marketing","ar":"أهدافكم والتسويق"},"hint":null,"required":false},{"key":"whyJoined","type":"longtext","label":{"en":"What motivated you to join our program? What was the reason you signed up?","ar":"شنو اللي خلاكم تنضمون للبرنامج؟ ليش اشتركتوا؟"},"hint":null,"required":true,"maxLength":10000},{"key":"marketingChannels","type":"multi","label":{"en":"Where do your projects come from today? (Select all that apply)","ar":"من وين توصلكم المشاريع الحين؟ (اختاروا كل اللي ينطبق)"},"hint":null,"required":true,"options":[{"value":"referrals","label":{"en":"Referrals and word of mouth","ar":"توصيات ومعارف"}},{"value":"instagram","label":{"en":"Instagram","ar":"إنستقرام"}},{"value":"meta_ads","label":{"en":"Facebook and Instagram ads","ar":"إعلانات فيسبوك وإنستقرام"}},{"value":"google","label":{"en":"Google","ar":"قوقل"}},{"value":"tiktok","label":{"en":"TikTok","ar":"تيك توك"}},{"value":"snapchat","label":{"en":"Snapchat","ar":"سناب شات"}},{"value":"website","label":{"en":"Our website","ar":"موقعنا"}},{"value":"exhibitions","label":{"en":"Exhibitions and events","ar":"معارض وفعاليات"}},{"value":"whatsapp","label":{"en":"WhatsApp","ar":"واتساب"}},{"value":"agency","label":{"en":"A marketing agency","ar":"شركة تسويق"}},{"value":"none_yet","label":{"en":"Nothing yet","ar":"ولا شي ليلحين"}}]},{"key":"marketing","type":"longtext","label":{"en":"What is your marketing process? In other words... please explain EVERYTHING A-Z that you have in place or have tried to generate new projects","ar":"شلون تسوقون الحين؟ يعني اشرحوا لنا كل شي من الألف للياء، اللي عندكم أو اللي جربتوه عشان تجيبون مشاريع يديدة."},"hint":{"en":"What worked, what didn''t, and what you spend on it.","ar":"شنو نفع، شنو ما نفع، وكم تصرفون عليه."},"required":true,"maxLength":10000},{"key":"challenges","type":"longtext","label":{"en":"What are the TOP 3 challenges that - if we were able to help you with - would make you 100% satisfied with your investment? - Be specific.","ar":"شنو أكبر ٣ تحديات، لو ساعدناكم فيها، بتكونون راضين ١٠٠٪ عن استثماركم؟ خلكم محددين."},"hint":{"en":"Name a few we can help with right away.","ar":"اذكروا كم شي نقدر نساعدكم فيه سيده."},"required":true,"maxLength":10000},{"key":"lastRevenue","type":"number","label":{"en":"Last Calendar Year - How Much Total Revenue did you do?","ar":"السنة اللي طافت: شكثر كان مجموع دخلكم؟"},"hint":{"en":"The whole year, as a full number. For example: 1500000.","ar":"دخل السنة كلها كرقم كامل. مثلاً: ١٥٠٠٠٠٠."},"required":true,"min":0,"max":1000000000,"decimals":0,"currencyFrom":"currency"},{"key":"goal90","type":"number","label":{"en":"What is your realistic goal revenue in 90 Days?","ar":"شكثر الدخل اللي تطمحون له بشكل واقعي خلال ٩٠ يوم؟"},"hint":null,"required":true,"min":0,"max":1000000000,"decimals":0,"currencyFrom":"currency"},{"key":"goal12","type":"number","label":{"en":"What is your ideal/stretch revenue goal within the next 12-24 months?","ar":"شكثر الدخل اللي تحلمون فيه خلال ١٢ إلى ٢٤ شهر؟"},"hint":null,"required":true,"min":0,"max":1000000000,"decimals":0,"currencyFrom":"currency"},{"key":"driveLink","type":"text","label":{"en":"Please attach a Google Drive link to all the content you have for your office.","ar":"حطوا رابط قوقل درايف فيه كل المحتوى اللي عندكم لمكتبكم."},"hint":{"en":"What to put in it:\nTeam photos\nPhotos with homeowners and clients\nBefore and after photos of projects\nTestimonial and reaction videos from past clients\nVideos of you, your team and your work in action\nEducational content about your services\nTime-lapse or walkthrough videos of projects in progress\nYour logo as a PDF","ar":"شنو تحطون فيه:\nصور الفريق\nصور مع أصحاب البيوت والعملاء\nصور قبل وبعد للمشاريع\nفيديوهات آراء العملاء السابقين وردة فعلهم\nفيديوهات لكم ولفريقكم وانتو تشتغلون\nمحتوى تعليمي عن خدماتكم\nفيديوهات تايم لابس أو جولات بمشاريع شغالة\nالشعار كملف PDF"},"required":false,"maxLength":1000,"format":"url"},{"key":"additionalInfo","type":"longtext","label":{"en":"Any additional information we should know before starting?","ar":"فيه شي ثاني لازم نعرفه قبل لا نبدي؟"},"hint":null,"required":false,"maxLength":10000}],"reads":{"profile":["lastRevenue","goal90","goal12","marketingChannels","marketing","challenges","whyJoined","additionalInfo"],"contact":["fullName","businessName"]},"submit":{"en":"Send my answers","ar":"أرسل ردودي"},"done":{"en":"Got it. Your account manager will see your answers before your onboarding call.","ar":"وصلنا. مدير حسابكم بيشوف ردودكم قبل مكالمة الانطلاق."},"invite":{"whatsapp":{"en":"Hi {client} team, here is your onboarding form. Fill it before our onboarding call: {form_link}","ar":"هلا فريق {client}، هذا فورم التعريف. عبّوه قبل مكالمة الانطلاق: {form_link}"},"push":{"en":"Your onboarding form is ready. Tap to start.","ar":"فورم التعريف جاهز. اضغط وابدِ."}}}'::jsonb;
  v_problem text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.cockpit_form_versions v WHERE v.form_key = 'onboarding' AND v.version = 3) THEN
    RETURN;
  END IF;
  IF md5(v_schema::text) IS DISTINCT FROM '86966f19afcab5dca6f009e24ffe6802' THEN
    RAISE EXCEPTION 'The onboarding form''s version 3 is not the drafted one (md5 %); stop and re-read it.', md5(v_schema::text)
      USING ERRCODE = '55000';
  END IF;
  v_problem := coalesce(public.cockpit_form_schema_check(v_schema), public.cockpit_form_schema_text_problem(v_schema),
                        public.cockpit_form_stage4_print_problem(3, v_schema));
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'The onboarding form''s version 3 cannot be stored: %', v_problem USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.audit_actor', 'migration 20261103h', true);
  PERFORM set_config('cockpit.audit_source', 'migration', true);
  PERFORM set_config('cockpit.forms_action', 'forms.onboarding_v3_stored', true);
  INSERT INTO public.cockpit_form_versions(form_key, version, schema, published_by, note)
  VALUES ('onboarding', 3, v_schema, 'migration 20261103h',
          'The structured onboarding (client form schema version 2), stored and not live: forms.client.schema_v2 opens it.');
  PERFORM set_config('cockpit.forms_action', '', true);
  PERFORM set_config('cockpit.audit_actor', '', true);
  PERFORM set_config('cockpit.audit_source', '', true);
END $$;

-- ---------------------------------------------------------------------------
-- 7. The forms editor (7 above)

-- Where a form sits on the editor's list: 20261102d's, except that a form whose newest version is in client form
-- schema version 2 is read only (a version-1 version published over it would overtake it).
CREATE OR REPLACE FUNCTION public.cockpit_form_editor_kind(p public.cockpit_forms)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p.key = 'portal_feedback' THEN
    RETURN jsonb_build_object('group', 'client', 'editable', false,
      'why', 'The portal''s Share feedback writes these; edit it in the portal.');
  END IF;
  -- 20261103h: a form whose newest version is in client form schema version 2 (the structured onboarding) is read
  -- only, so draft, publish and go back refuse with these words.
  IF EXISTS (SELECT 1 FROM public.cockpit_form_versions v
              WHERE v.form_key = p.key AND v.schema->'v' = '2'::jsonb
                AND v.version = (SELECT max(x.version) FROM public.cockpit_form_versions x WHERE x.form_key = p.key)) THEN
    RETURN jsonb_build_object('group', 'client', 'editable', false,
      'why', 'Its structured questions change in a migration for now.');
  END IF;
  IF p.audience = 'client' AND p.provider IN ('native','typeform')
     AND public.cockpit_form_editor_version(p.key) IS NOT NULL THEN
    RETURN jsonb_build_object('group', 'client', 'editable', true, 'why', NULL);
  END IF;
  IF p.provider = 'native' AND p.audience = 'team' THEN
    RETURN jsonb_build_object('group', 'staff', 'editable', false,
      'why', 'Set in the cockpit''s code; the SQL checks these fields word for word.');
  END IF;
  RETURN jsonb_build_object('group', 'typeform', 'editable', false,
    'why', 'Lives in Typeform; Make owns its effects until Stage 4.');
END $$;

-- The structured version the editor shows read only (admin or the CEO): NULL when the form's newest version is
-- not in client form schema version 2. Its schema, who stored it in role words, the switch's state, the version
-- new invites get, and how many answers and open invites use it.
CREATE OR REPLACE FUNCTION public.cockpit_form_editor_structured(p_form_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.cockpit_form_versions;
BEGIN
  PERFORM public.cockpit_form_editor_seat();
  SELECT * INTO v FROM public.cockpit_form_versions x
   WHERE x.form_key = p_form_key AND x.schema->'v' = '2'::jsonb
     AND x.version = (SELECT max(y.version) FROM public.cockpit_form_versions y WHERE y.form_key = p_form_key);
  IF v.form_key IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'version', v.version,
    'schema', v.schema,
    'publishedAt', v.published_at,
    'publishedBy', public.cockpit_form_editor_role(v.published_by),
    'note', v.note,
    'state', public.cockpit_form_schema_v2_state(),
    'issuing', public.cockpit_form_client_version(p_form_key),
    'answers', (SELECT count(*) FROM public.cockpit_form_responses r WHERE r.form_key = p_form_key AND r.form_version = v.version),
    'openInvites', (SELECT count(*) FROM public.cockpit_form_invites i
                     WHERE i.form_key = p_form_key AND i.form_version = v.version AND i.state = 'open'));
END $$;

-- ---------------------------------------------------------------------------
-- 8. The deploy switch (8 above), owner only.

CREATE OR REPLACE FUNCTION public.cockpit_form_schema_v2_switch(p_state text, p_actor text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_before text := public.cockpit_form_schema_v2_state();
  v_ver integer := public.cockpit_form_structured_version('onboarding');
  v_schema jsonb;
  v_problem text;
  f public.cockpit_forms;
  v_client integer;
  v_registry text := 'left as it was';
BEGIN
  IF v_actor IS NULL OR char_length(v_actor) NOT BETWEEN 2 AND 120 THEN
    RAISE EXCEPTION 'Say who switches the structured onboarding.' USING ERRCODE = '22023';
  END IF;
  IF p_state IS NULL OR p_state NOT IN ('off','canary','on') THEN
    RAISE EXCEPTION 'Say off, canary or on.' USING ERRCODE = '22023';
  END IF;
  IF p_state <> 'off' THEN
    IF v_ver IS NULL THEN
      RAISE EXCEPTION 'The onboarding form has no structured version to open.' USING ERRCODE = '22023';
    END IF;
    SELECT v.schema INTO v_schema FROM public.cockpit_form_versions v WHERE v.form_key = 'onboarding' AND v.version = v_ver;
    v_problem := coalesce(public.cockpit_form_schema_check(v_schema), public.cockpit_form_schema_text_problem(v_schema),
                          public.cockpit_form_stage4_print_problem(v_ver, v_schema));
    IF v_problem IS NOT NULL THEN
      RAISE EXCEPTION 'Version % cannot open: %', v_ver, v_problem USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_state = 'on' AND NOT EXISTS (
       SELECT 1 FROM public.cockpit_form_responses r
        WHERE r.form_key = 'onboarding' AND r.form_version = v_ver AND r.task_id = '86eywg1cq'
          AND r.state IN ('submitted','confirmed')) THEN
    RAISE EXCEPTION 'Version % opens to every client only after a canary answer on the test card 86eywg1cq is stored. Switch to canary first and answer it.', v_ver
      USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.audit_actor', v_actor, true);
  PERFORM set_config('cockpit.audit_source', 'deploy', true);
  INSERT INTO public.cockpit_settings(key, value, updated_by)
  VALUES ('forms.client.schema_v2', jsonb_build_object('state', p_state), v_actor)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now();
  -- The registry's copy follows the version clients get, once the onboarding is native (after its go-live).
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = 'onboarding' FOR UPDATE;
  v_client := greatest(coalesce(public.cockpit_form_client_version('onboarding'), 2), 2);
  IF f.provider = 'native' AND f.version IS DISTINCT FROM v_client THEN
    PERFORM set_config('cockpit.forms_action', 'forms.schema_v2_registry', true);
    UPDATE public.cockpit_forms x
       SET version = v_client,
           schema = (SELECT v.schema FROM public.cockpit_form_versions v WHERE v.form_key = 'onboarding' AND v.version = v_client),
           updated_by = v_actor, updated_at = now()
     WHERE x.key = 'onboarding';
    PERFORM set_config('cockpit.forms_action', '', true);
    v_registry := 'updated';
  END IF;
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('forms.schema_v2_switch', 'cockpit_settings', 'forms.client.schema_v2', v_actor, 'client-success', 'deploy',
          jsonb_build_object('state', v_before), jsonb_build_object('state', p_state),
          jsonb_build_object('version', v_ver, 'issuing', v_client, 'registry', v_registry));
  PERFORM set_config('cockpit.audit_actor', '', true);
  PERFORM set_config('cockpit.audit_source', '', true);
  RETURN jsonb_build_object('state', p_state, 'before', v_before, 'version', v_ver, 'issuing', v_client, 'registry', v_registry);
END $$;

-- ---------------------------------------------------------------------------
-- 9. Privileges. Every function here is the owner's only, as the bodies it replaces were, except
--    cockpit_form_editor_structured, a browser RPC for signed-in seats with its gate inside (as 20261102d's
--    editor RPCs), and the Typeform door, which keeps its live grant (service_role, forms-door), as 20261102j
--    left it.

REVOKE ALL ON FUNCTION
  public.cockpit_form_schema_check_v1(jsonb), public.cockpit_form_schema_check_v2(jsonb), public.cockpit_form_schema_check(jsonb),
  public.cockpit_form_answers_check_v1(jsonb,jsonb,jsonb), public.cockpit_form_answers_check_v2(jsonb,jsonb,jsonb),
  public.cockpit_form_answers_check(jsonb,jsonb,jsonb), public.cockpit_form_rows_blank_cell(jsonb),
  public.cockpit_form_schema_v2_state(), public.cockpit_form_structured_version(text), public.cockpit_form_client_version(text),
  public.cockpit_form_stage4_print_map(integer), public.cockpit_form_stage4_print_part(jsonb,jsonb),
  public.cockpit_form_stage4_print_problem(integer,jsonb), public.cockpit_form_stage4_print(text,integer,jsonb),
  public.cockpit_form_stage4_structured(integer,jsonb), public.cockpit_form_stage4_input(uuid),
  public.cockpit_form_stage4_build(jsonb), public.cockpit_form_onboarding_context(text),
  public.cockpit_form_invite_issue_core(text,text,text[],text,text,boolean,jsonb,uuid,text,jsonb),
  public.cockpit_form_client_context(public.cockpit_form_invites),
  public.cockpit_form_onboarding_typeform(jsonb), public.cockpit_form_editor_kind(public.cockpit_forms),
  public.cockpit_form_editor_structured(text), public.cockpit_form_schema_v2_switch(text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_form_onboarding_typeform(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_form_editor_structured(text) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
