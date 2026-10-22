-- CSM decks, the visual pass: three prep keys (docs/csm-decks/DRIVE-IMPORT.md 9)
-- and a wider starter_pack.
--
--   dos_donts_ar       launch row: the Arabic of each Do's & Don'ts card line,
--                      keyed by the line as parsed (DESIGN.md 22.6.2)
--   example_theme      onboarding row: the example ad's theme, read by both
--                      decks (DESIGN.md 22.4.5). The CEO, 2026-10-21: the
--                      example follows the client's main service (the
--                      kickoff form's "Which service are we advertising?"),
--                      never a sub-trade. So it takes one of the five
--                      service keys (design-build, interior, architecture,
--                      fitout, construction) or one of the eighteen example
--                      scenes (the first twelve and the six added for the
--                      services); either names a picture set the browser has.
--   service_chosen_at  onboarding row: O4's "Launch with this" (DESIGN.md
--                      22.2.0). Set with true (the server writes its own time,
--                      never the browser's), cleared with null or false (the
--                      notes window's Undo). The save's keep-the-first-time
--                      rule names only the two older stamps, so a second
--                      choice on the call stamps again.
--   starter_pack       onboarding row, widened (fixer round 2): the main
--                      service the ready pack was made for, one of the five
--                      keys or other, so O7 shows the pack only while slide
--                      4's choice is that service. A yes saved before keys
--                      is still kept and read as the kickoff's service.
--
-- It replaces cockpit_csm_deck_prep_value with the body of
-- 20261019120000_csm_decks.sql (the only file that defines it), two new
-- branches before its ELSE, one key added to its stamp branch and
-- starter_pack given its own branch out of the yes-or-no keys. Everything
-- else is unchanged, and so are its grants (revoked from every role;
-- cockpit_csm_deck_prep_save calls it as owner). The prep row's 64 KB cap and
-- the save's audit row cover the new keys. It applies twice without error.

BEGIN;

-- Checks and normalises one prep key. NULL means "remove the key". The list
-- of keys is the CONTENT.md {prep.*} row plus DESIGN.md 12.3 and 14. The
-- free-text keys CONTENT-AR.md asks to have in Arabic too take an _ar twin
-- with the same rule (service_focus_ar, goals_ar, red_lines_ar, ...).
CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_prep_value(p_task_id text, p_key text, p_value jsonb, p_meta jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t text := coalesce(jsonb_typeof(p_value), 'null');
  out jsonb := '{}'::jsonb; arr jsonb := '[]'::jsonb; k text; e jsonb; s jsonb; n integer := 0; d date; q jsonb; opts jsonb;
  v_base text := p_key;
BEGIN
  IF p_key IS NULL OR p_key !~ '^[a-z0-9_]{1,40}$' THEN RAISE EXCEPTION 'Prep keys are short lowercase names'; END IF;
  IF p_key ~ '_ar$' AND left(p_key, -3) IN ('service_focus','selling_point','project','engineer','page_name','thank_you',
                                             'goals','red_lines','services','budget_band','gate_notes') THEN
    v_base := left(p_key, -3);
  END IF;
  IF t = 'null' THEN RETURN NULL; END IF;
  CASE
  WHEN v_base IN ('service_focus','page_name','project','engineer') THEN
    RETURN public.cockpit_csm_deck_text(p_value, 200, p_key);
  WHEN v_base = 'selling_point' THEN
    RETURN public.cockpit_csm_deck_text(p_value, 300, p_key);
  WHEN v_base = 'thank_you' THEN
    RETURN public.cockpit_csm_deck_text(p_value, 500, p_key);
  WHEN p_key = 'starter_pack' THEN
    -- The service the pack was made for (DESIGN.md 22.4.6): one of the five
    -- keys or other (the service in the client's own words), or a yes
    -- saved before keys (read as the kickoff's service).
    IF t = 'boolean' THEN RETURN p_value; END IF;
    IF t = 'string' AND (p_value #>> '{}') IN ('design-build','interior','architecture','fitout','construction','other') THEN
      RETURN p_value;
    END IF;
    RAISE EXCEPTION 'starter_pack is a yes or no, or one of the service keys';
  WHEN p_key IN ('welcome_video','booking_video','call_guide_checked','dwy_os_approved') THEN
    IF t <> 'boolean' THEN RAISE EXCEPTION '% is a yes or no', p_key; END IF;
    RETURN p_value;
  WHEN p_key = 'dialect' THEN RETURN public.cockpit_csm_deck_choice(p_value, ARRAY['kw','sa'], p_key);
  WHEN p_key = 'language' THEN RETURN public.cockpit_csm_deck_choice(p_value, ARRAY['en','ar'], p_key);
  WHEN p_key = 'service_model' THEN RETURN public.cockpit_csm_deck_choice(p_value, ARRAY['DFY','DWY'], p_key);
  WHEN p_key = 'pain' THEN RETURN public.cockpit_csm_deck_choice(p_value, ARRAY['delays','design','cost'], p_key);
  WHEN p_key = 'go_live' THEN
    IF t <> 'string' OR (p_value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Choose a valid go-live date'; END IF;
    BEGIN d := (p_value #>> '{}')::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Choose a valid go-live date'; END;
    IF to_char(d, 'YYYY-MM-DD') <> (p_value #>> '{}') OR d NOT BETWEEN DATE '2025-01-01' AND DATE '2030-12-31' THEN
      RAISE EXCEPTION 'Choose a valid go-live date';
    END IF;
    RETURN p_value;
  WHEN v_base IN ('goals','budget_band','gate_notes') THEN
    IF t <> 'object' THEN RAISE EXCEPTION '% must be a set of named lines', p_key; END IF;
    FOR k, e IN SELECT key, value FROM jsonb_each(p_value) LOOP
      n := n + 1;
      IF n > 12 THEN RAISE EXCEPTION '% holds at most 12 lines', p_key; END IF;
      IF (v_base = 'gate_notes' AND char_length(k) NOT BETWEEN 1 AND 300)
         OR (v_base <> 'gate_notes' AND k !~ '^[a-z0-9_]{1,40}$') THEN
        RAISE EXCEPTION '% has an invalid line name', p_key;
      END IF;
      s := public.cockpit_csm_deck_text(e, CASE v_base WHEN 'goals' THEN 2000 ELSE 300 END, p_key);
      IF s IS NOT NULL THEN out := out || jsonb_build_object(k, s); END IF;
    END LOOP;
    RETURN nullif(out, '{}'::jsonb);
  WHEN p_key = 'access' THEN
    IF t <> 'object' THEN RAISE EXCEPTION 'access must be a set of named statuses'; END IF;
    FOR k, e IN SELECT key, value FROM jsonb_each(p_value) LOOP
      n := n + 1;
      IF n > 16 OR k !~ '^[a-z0-9_]{1,40}$' THEN RAISE EXCEPTION 'access has an invalid row name'; END IF;
      s := public.cockpit_csm_deck_choice(e, ARRAY['done','todo','unchecked'], 'Each access status');
      IF s IS NOT NULL THEN out := out || jsonb_build_object(k, s); END IF;
    END LOOP;
    RETURN nullif(out, '{}'::jsonb);
  WHEN v_base IN ('red_lines','services','dos_donts_hidden','platforms_planned') THEN
    IF t <> 'array' THEN RAISE EXCEPTION '% must be a list', p_key; END IF;
    IF jsonb_array_length(p_value) > (CASE v_base WHEN 'red_lines' THEN 20 WHEN 'services' THEN 20 WHEN 'platforms_planned' THEN 8 ELSE 100 END) THEN
      RAISE EXCEPTION '% is too long a list', p_key;
    END IF;
    FOR e IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      s := public.cockpit_csm_deck_text(e, CASE v_base WHEN 'platforms_planned' THEN 40 WHEN 'services' THEN 120 ELSE 500 END, p_key);
      IF s IS NOT NULL AND NOT (arr @> jsonb_build_array(s)) THEN arr := arr || jsonb_build_array(s); END IF;
    END LOOP;
    RETURN nullif(arr, '[]'::jsonb);
  WHEN p_key IN ('hidden_slides','shown_slides') THEN
    IF t <> 'array' OR jsonb_array_length(p_value) > 30 THEN RAISE EXCEPTION '% must be a list of slide ids', p_key; END IF;
    FOR e IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ '^[a-z0-9-]{1,40}$' THEN RAISE EXCEPTION '% must be a list of slide ids', p_key; END IF;
      IF NOT (arr @> jsonb_build_array(e)) THEN arr := arr || jsonb_build_array(e); END IF;
    END LOOP;
    RETURN nullif(arr, '[]'::jsonb);
  WHEN p_key = 'form_questions' THEN
    IF t <> 'array' OR jsonb_array_length(p_value) > 12 THEN RAISE EXCEPTION 'Type at most 12 form questions'; END IF;
    FOR q IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF jsonb_typeof(q) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(q) x WHERE x NOT IN ('label','options','isGate','note')) THEN
        RAISE EXCEPTION 'Each form question has a label, options, isGate and an optional note';
      END IF;
      s := public.cockpit_csm_deck_text(q->'label', 300, 'A question''s label');
      IF s IS NULL THEN RAISE EXCEPTION 'Each form question needs its label'; END IF;
      opts := '[]'::jsonb;
      IF q ? 'options' AND jsonb_typeof(q->'options') <> 'null' THEN
        IF jsonb_typeof(q->'options') <> 'array' OR jsonb_array_length(q->'options') > 12 THEN
          RAISE EXCEPTION 'A question has at most 12 options';
        END IF;
        FOR e IN SELECT value FROM jsonb_array_elements(q->'options') LOOP
          IF public.cockpit_csm_deck_text(e, 120, 'An option') IS NOT NULL THEN
            opts := opts || jsonb_build_array(public.cockpit_csm_deck_text(e, 120, 'An option'));
          END IF;
        END LOOP;
      END IF;
      IF q ? 'isGate' AND jsonb_typeof(q->'isGate') NOT IN ('boolean','null') THEN RAISE EXCEPTION 'isGate is a yes or no'; END IF;
      arr := arr || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'label', s, 'options', opts, 'isGate', coalesce(q->'isGate' = 'true'::jsonb, false),
        'note', public.cockpit_csm_deck_text(q->'note', 200, 'A question''s note'))));
    END LOOP;
    RETURN nullif(arr, '[]'::jsonb);
  WHEN p_key IN ('their_pick','cover_creative') THEN
    IF NOT public.cockpit_csm_deck_creative_ok(p_task_id, p_value, p_meta, p_key = 'cover_creative') THEN
      RAISE EXCEPTION '%', CASE p_key WHEN 'cover_creative' THEN 'Pick one of this client''s own uploaded custom creatives for the cover'
                                      ELSE 'Pick one of this client''s creatives' END;
    END IF;
    RETURN p_value;
  WHEN p_key = 'phones' THEN
    IF t <> 'object' THEN RAISE EXCEPTION 'phones maps feed, reels and facebook to creatives'; END IF;
    FOR k, e IN SELECT key, value FROM jsonb_each(p_value) LOOP
      IF k NOT IN ('feed','reels','facebook') THEN RAISE EXCEPTION 'phones maps feed, reels and facebook to creatives'; END IF;
      IF jsonb_typeof(e) = 'null' THEN CONTINUE; END IF;
      IF NOT public.cockpit_csm_deck_creative_ok(p_task_id, e, p_meta, false) THEN RAISE EXCEPTION 'Pick one of this client''s creatives for each phone'; END IF;
      out := out || jsonb_build_object(k, e);
    END LOOP;
    RETURN nullif(out, '{}'::jsonb);
  WHEN p_key = 'meta_ad_text' THEN
    IF t <> 'object' THEN RAISE EXCEPTION 'meta_ad_text maps this client''s Meta ad ids to their text'; END IF;
    FOR k, e IN SELECT key, value FROM jsonb_each(p_value) LOOP
      n := n + 1;
      IF n > 50 OR NOT public.cockpit_csm_deck_creative_ok(p_task_id, to_jsonb(k), p_meta, false) OR k !~ '^[0-9]{5,25}$' THEN
        RAISE EXCEPTION 'meta_ad_text maps this client''s Meta ad ids to their text';
      END IF;
      IF jsonb_typeof(e) = 'null' THEN CONTINUE; END IF;
      IF jsonb_typeof(e) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(e) x WHERE x NOT IN ('primary_text','headline','cta','language','placement')) THEN
        RAISE EXCEPTION 'An ad''s text has primary_text, headline, cta, language and placement';
      END IF;
      s := jsonb_strip_nulls(jsonb_build_object(
        'primary_text', public.cockpit_csm_deck_text(e->'primary_text', 2200, 'Primary text'),
        'headline', public.cockpit_csm_deck_text(e->'headline', 255, 'The headline'),
        'cta', public.cockpit_csm_deck_choice(e->'cta', ARRAY['LEARN_MORE','GET_QUOTE','BOOK_NOW','CONTACT_US','SIGN_UP','SEND_WHATSAPP_MESSAGE','APPLY_NOW'], 'The call to action'),
        'language', public.cockpit_csm_deck_choice(e->'language', ARRAY['ar','en'], 'The ad language'),
        'placement', public.cockpit_csm_deck_choice(e->'placement', ARRAY['feed','reels','facebook'], 'The placement')));
      IF s <> '{}'::jsonb THEN out := out || jsonb_build_object(k, s); END IF;
    END LOOP;
    RETURN nullif(out, '{}'::jsonb);
  WHEN p_key = 'form_confirmed' THEN
    IF t <> 'string' OR NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_meta->'funnels') = 'array' THEN p_meta->'funnels' ELSE '[]'::jsonb END) f
          WHERE f->>'formId' = (p_value #>> '{}') OR f->>'sourceId' = (p_value #>> '{}')) THEN
      RAISE EXCEPTION 'Tick a form from this client''s own campaigns';
    END IF;
    RETURN p_value;
  WHEN p_key IN ('creative_agreed_at','onboarding_presented_at','service_chosen_at') THEN
    -- Stamped by the server; a client clock is never trusted. false clears it.
    IF p_value = 'false'::jsonb THEN RETURN NULL; END IF;
    IF t NOT IN ('boolean','string') THEN RAISE EXCEPTION '% is set with true and cleared with null', p_key; END IF;
    RETURN to_jsonb(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  WHEN p_key = 'dos_donts_ar' THEN
    -- The Arabic of each Do's & Don'ts card line, keyed by the line as parsed
    -- (DESIGN.md 22.6.2). The browser sends the whole map on each save.
    IF t <> 'object' THEN RAISE EXCEPTION 'dos_donts_ar maps card lines to their Arabic'; END IF;
    FOR k, e IN SELECT key, value FROM jsonb_each(p_value) LOOP
      n := n + 1;
      IF n > 100 THEN RAISE EXCEPTION 'dos_donts_ar holds at most 100 lines'; END IF;
      IF char_length(btrim(k)) NOT BETWEEN 1 AND 500 THEN
        RAISE EXCEPTION 'dos_donts_ar has a card line that is empty or too long';
      END IF;
      s := public.cockpit_csm_deck_text(e, 500, 'The Arabic of a card line');
      IF s IS NOT NULL THEN out := out || jsonb_build_object(btrim(k), s); END IF;
    END LOOP;
    RETURN nullif(out, '{}'::jsonb);
  WHEN p_key = 'example_theme' THEN
    -- The example ad's theme while the client has no creative (DESIGN.md 22.4.5):
    -- a main service's key, or one of the example scenes.
    RETURN public.cockpit_csm_deck_choice(p_value,
      ARRAY['design-build','interior','architecture','fitout','construction',
            'kitchen','living','majlis','villa','bathroom','pool',
            'landscape','bedroom','office','facade','stairs',
            'designbuild','architecture2','fitout2','fitout3','construction2','construction3'], p_key);
  ELSE
    RAISE EXCEPTION 'Prep does not keep "%"', p_key;
  END CASE;
END $$;

REVOKE ALL ON FUNCTION public.cockpit_csm_deck_prep_value(text, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
