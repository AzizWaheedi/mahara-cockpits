-- OFFER_PREP_KEYS_ADDED: recruiter_name
-- All seven offer presentations: preparation stays editable while readiness is
-- incomplete. Existing eligibility, price rules and manual catalogue holds stay.
-- Not in scope: new automatic fit logic, changed prices, client sends, external writes.
-- Verification: offer-presentations-supabase.test.ts plus existing gate/proposal parity.
BEGIN;
DO $guard$
DECLARE r record; f oid; got text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('cockpit_upsell_pitch_save(text,text,uuid,jsonb,integer)', '2c066b505992e0cbb7a8e1b144828b39', '1c97c814402a4b6070c4554ea3dfd9ca', true),
    ('cockpit_csm_offer_prep_value(text,text,text,jsonb)', '511707d9e8683242f2e212d845a20086', '8b203ec8d4af8191e67bedcbb7021079', false),
    ('cockpit_csm_deck_prep_save(text,text,jsonb)', '73b22af7ceed38cfbc0981d2b5d83f66', 'a6a2b31dae34ed0ebb13f54280c6badb', true),
    ('cockpit_csm_offer_sources(text,text)', 'ad2b14649392dc7cd3aa202b45eacfb4', 'c48b45f2943a17a1f39c4790ce7d147a', true),
    ('cockpit_csm_offer_status(text)', '779452063c0726b7f6d2962da0927371', '974fa7165fe918802575a713feee17a0', true),
    ('cockpit_upsell_proposal_problems(public.cockpit_upsell_proposals,text[],boolean)', 'c2c7baa76c7feca29705d3b3af6fbf52', 'cac568c601ba3fefe59de0732909502e', false)
  ) x(signature, before_md5, after_md5, authenticated_ok) LOOP
    f := to_regprocedure('public.' || r.signature);
    SELECT md5(prosrc) INTO got FROM pg_catalog.pg_proc WHERE oid = f;
    IF got IS NULL OR got NOT IN (r.before_md5, r.after_md5) THEN
      RAISE EXCEPTION 'Offer presentation dependency % changed (prosrc md5 %). Re-read the current definition.', r.signature, coalesce(got,'missing');
    END IF;
    IF has_function_privilege('anon', f, 'EXECUTE')
       OR has_function_privilege('authenticated', f, 'EXECUTE') IS DISTINCT FROM r.authenticated_ok
       OR has_function_privilege('service_role', f, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
                   LEFT JOIN pg_catalog.pg_roles role ON role.oid = a.grantee
                  WHERE p.oid = f AND a.grantee <> p.proowner AND NOT (r.authenticated_ok AND role.rolname = 'authenticated' AND a.privilege_type = 'EXECUTE' AND NOT a.is_grantable)) THEN
      RAISE EXCEPTION 'Offer presentation dependency % grants changed. Re-read the current grants.', r.signature;
    END IF;
  END LOOP;
  f := to_regprocedure('public.cockpit_upsell_offer_readiness(text,text)');
  IF f IS NOT NULL THEN
    SELECT md5(prosrc) INTO got FROM pg_catalog.pg_proc WHERE oid=f;
    IF got <> '5eb9d671f9cadbfbdf0bcdbf25695851' OR EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
      WHERE p.oid=f AND a.grantee<>p.proowner) THEN
      RAISE EXCEPTION 'Offer readiness helper changed. Re-read its definition and grants.';
    END IF;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.cockpit_upsell_offer_readiness(p_task_id text, p_offer text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.cockpit_upsell_catalog; p jsonb; missing text[] := '{}'; newest date; hold text; recruiter_ok boolean;
BEGIN
  SELECT * INTO c FROM public.cockpit_upsell_catalog x WHERE x.offer_key = p_offer;
  IF c.offer_key IS NULL THEN RAISE EXCEPTION 'Choose one of the seven offers.' USING ERRCODE = '22023'; END IF;
  p := public.cockpit_upsell_prep_of(p_task_id, p_offer);
  hold := c.waits_on;
  -- Site/search evidence belongs to these offers. Do not ask for a website
  -- screenshot to discuss a campaign, social work, filming or hiring.
  IF p_offer IN ('website', 'seo_geo') THEN
    SELECT max(f.captured_on) INTO newest FROM public.cockpit_upsell_files f
     WHERE f.task_id = p_task_id AND f.status = 'ready' AND f.kind = 'capture';
    IF newest IS NULL THEN missing := missing || 'no_capture'::text;
    ELSIF newest < public.cockpit_upsell_today() - 7 THEN missing := missing || 'capture_old'::text; END IF;
  END IF;
  IF (c.locked AND EXISTS (SELECT 1 FROM jsonb_array_elements(c.parts) x WHERE jsonb_typeof(x->'amount') = 'null'))
     OR (NOT (p ? 'opening_price') AND EXISTS (SELECT 1 FROM jsonb_array_elements(c.parts) x WHERE jsonb_typeof(x->'amount') = 'null'))
     OR public.cockpit_upsell_price_problem(p_offer, p) IS NOT NULL THEN
    missing := missing || 'no_price'::text;
  END IF;
  IF NOT (p ? 'payment_link') THEN missing := missing || 'no_payment_link'::text; END IF;
  IF p_offer = 'closer' THEN
    recruiter_ok := coalesce(jsonb_typeof(p->'recruiter_name') = 'string'
      AND char_length(btrim(p->>'recruiter_name')) BETWEEN 3 AND 120, false);
    IF NOT recruiter_ok THEN missing := missing || 'no_recruiter'::text;
    ELSIF hold = 'Needs a named recruiter.' THEN hold := NULL; END IF;
  END IF;
  -- Other manual fulfilment holds remain visible, separate from the real
  -- eligibility gate. This change does not create an automatic fit verdict.
  RETURN jsonb_build_object('ok', cardinality(missing) = 0, 'missing', to_jsonb(missing), 'waitsOn', hold);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_offer_prep_value(p_task_id text, p_offer text, p_key text, p_value jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t text := coalesce(jsonb_typeof(p_value), 'null');
  s text; d date; e jsonb; m jsonb; arr jsonb := '[]'::jsonb; out jsonb := '{}'::jsonb; k text; ks text[]; n numeric;
  v_parts jsonb; v_want text[];
BEGIN
  IF p_key IS NULL OR p_key !~ '^[a-z0-9_]{1,40}$' THEN
    RAISE EXCEPTION 'Prep keys are short lowercase names.' USING ERRCODE = '22023';
  END IF;
  IF t = 'null' THEN RETURN NULL; END IF;
  CASE p_key
  WHEN 'recruiter_name' THEN
    IF p_offer <> 'closer' THEN RAISE EXCEPTION 'A named recruiter belongs to Closer placement prep.' USING ERRCODE = '22023'; END IF;
    RETURN to_jsonb(public.cockpit_upsell_text(p_value, 120, 'The named recruiter', 3));
  WHEN 'language' THEN RETURN public.cockpit_upsell_choice(p_value, ARRAY['en','ar'], 'The language');
  WHEN 'dialect' THEN RETURN public.cockpit_upsell_choice(p_value, ARRAY['kw','sa'], 'The dialect');
  WHEN 'goal_pick' THEN RETURN public.cockpit_upsell_choice(p_value, ARRAY['goal90','goal12_24','challenges','why','typed'], 'The goal');
  WHEN 'site_thin' THEN
    IF t <> 'boolean' THEN RAISE EXCEPTION 'site_thin is a yes or no.' USING ERRCODE = '22023'; END IF;
    RETURN p_value;
  WHEN 'site_url' THEN
    s := public.cockpit_upsell_text(p_value, 300, 'The site address');
    IF s IS NULL THEN RETURN NULL; END IF;
    IF s !~* '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(/[^[:space:]<>"''\\]*)?$' THEN
      RAISE EXCEPTION 'Paste the site''s https address, without a user, a port or an IP address.' USING ERRCODE = '22023';
    END IF;
    RETURN to_jsonb(s);
  WHEN 'goal_typed' THEN RETURN to_jsonb(public.cockpit_upsell_text(p_value, 300, 'The typed goal'));
  WHEN 'opening_reason' THEN RETURN to_jsonb(public.cockpit_upsell_text(p_value, 140, 'The reason'));
  WHEN 'goal_typed_on' THEN
    d := public.cockpit_upsell_date(p_value, 'The goal''s date');
    IF d > public.cockpit_upsell_today() THEN RAISE EXCEPTION 'The goal''s date is today or earlier.' USING ERRCODE = '22023'; END IF;
    RETURN to_jsonb(to_char(d, 'YYYY-MM-DD'));
  WHEN 'captures' THEN
    IF t <> 'array' OR jsonb_array_length(p_value) > 3 THEN
      RAISE EXCEPTION 'Pick at most 3 captures.' USING ERRCODE = '22023';
    END IF;
    FOR e IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF jsonb_typeof(e) <> 'object' THEN RAISE EXCEPTION 'Each capture is its id and an optional mark.' USING ERRCODE = '22023'; END IF;
      ks := ARRAY(SELECT jsonb_object_keys(e));
      IF NOT (ks <@ ARRAY['id','mark']) OR NOT (e ? 'id') THEN
        RAISE EXCEPTION 'Each capture is its id and an optional mark.' USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(e->'id') <> 'string' OR (e->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         OR NOT EXISTS (SELECT 1 FROM public.cockpit_upsell_files f WHERE f.id = (e->>'id')::uuid AND f.task_id = p_task_id
                          AND f.status = 'ready' AND f.kind = 'capture') THEN
        RAISE EXCEPTION 'Pick one of this client''s own captures.' USING ERRCODE = '22023';
      END IF;
      IF arr @> jsonb_build_array(jsonb_build_object('id', e->'id')) THEN
        RAISE EXCEPTION 'Each capture once.' USING ERRCODE = '22023';
      END IF;
      m := NULL;
      IF e ? 'mark' AND jsonb_typeof(e->'mark') <> 'null' THEN
        m := e->'mark';
        ks := CASE WHEN jsonb_typeof(m) = 'object' THEN ARRAY(SELECT jsonb_object_keys(m)) END;
        IF ks IS NULL OR NOT (ks @> ARRAY['x','y','w','h'] AND ks <@ ARRAY['x','y','w','h'])
           OR EXISTS (SELECT 1 FROM jsonb_each(m) z WHERE jsonb_typeof(z.value) <> 'number' OR (z.value #>> '{}')::numeric NOT BETWEEN 0 AND 1)
           OR (m->>'w')::numeric < 0.04 OR (m->>'h')::numeric < 0.04
           OR (m->>'x')::numeric + (m->>'w')::numeric > 1 OR (m->>'y')::numeric + (m->>'h')::numeric > 1 THEN
          RAISE EXCEPTION 'The gap mark sits inside the capture and is at least 4%% of it each way.' USING ERRCODE = '22023';
        END IF;
      END IF;
      arr := arr || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', e->'id', 'mark', m)));
    END LOOP;
    RETURN nullif(arr, '[]'::jsonb);
  WHEN 'example_stills' THEN
    IF t <> 'array' OR jsonb_array_length(p_value) > 3 THEN RAISE EXCEPTION 'Pick at most 3 example stills.' USING ERRCODE = '22023'; END IF;
    FOR e IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         OR NOT EXISTS (SELECT 1 FROM public.cockpit_csm_launch_ads a WHERE a.id = (e #>> '{}')::uuid AND a.task_id = p_task_id
                          AND a.status = 'ready' AND a.mime LIKE 'image/%') THEN
        RAISE EXCEPTION 'Pick one of this client''s own pictures from the ads tray.' USING ERRCODE = '22023';
      END IF;
      IF NOT (arr @> jsonb_build_array(e)) THEN arr := arr || jsonb_build_array(e); END IF;
    END LOOP;
    RETURN nullif(arr, '[]'::jsonb);
  WHEN 'example_colors' THEN
    IF t <> 'array' OR jsonb_array_length(p_value) > 3 THEN RAISE EXCEPTION 'Pick at most 3 colours.' USING ERRCODE = '22023'; END IF;
    FOR e IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ '^#[0-9A-Fa-f]{6}$' THEN
        RAISE EXCEPTION 'A colour is #rrggbb.' USING ERRCODE = '22023';
      END IF;
      IF NOT (arr @> jsonb_build_array(lower(e #>> '{}'))) THEN arr := arr || jsonb_build_array(lower(e #>> '{}')); END IF;
    END LOOP;
    RETURN nullif(arr, '[]'::jsonb);
  WHEN 'opening_price' THEN
    SELECT c.parts INTO v_parts FROM public.cockpit_upsell_catalog c WHERE c.offer_key = p_offer;
    v_want := ARRAY(SELECT x->>'key' FROM jsonb_array_elements(v_parts) x);
    IF t <> 'object' THEN RAISE EXCEPTION 'The opening price names each part and its dollars.' USING ERRCODE = '22023'; END IF;
    ks := ARRAY(SELECT jsonb_object_keys(p_value));
    IF NOT (ks @> v_want AND ks <@ v_want) THEN
      RAISE EXCEPTION 'Type the opening price for %.', public.cockpit_upsell_parts_named(p_offer, v_parts) USING ERRCODE = '22023';
    END IF;
    FOR k, e IN SELECT key, value FROM jsonb_each(p_value) LOOP
      IF NOT public.cockpit_upsell_usd_ok(e) THEN
        RAISE EXCEPTION 'A price is a dollar amount from 1 to 1,000,000, with at most two decimals.' USING ERRCODE = '22023';
      END IF;
    END LOOP;
    RETURN p_value;
  WHEN 'project_value' THEN
    IF t <> 'object' THEN RAISE EXCEPTION 'A typical project is its amount, its currency and where it came from.' USING ERRCODE = '22023'; END IF;
    ks := ARRAY(SELECT jsonb_object_keys(p_value));
    IF NOT (ks <@ ARRAY['amount','currency','from','said_on'] AND ks @> ARRAY['amount','currency','from']) THEN
      RAISE EXCEPTION 'A typical project is its amount, its currency and where it came from.' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_value->'amount') <> 'number' OR (p_value->>'amount')::numeric <= 0 OR (p_value->>'amount')::numeric > 100000000 THEN
      RAISE EXCEPTION 'The typical project is an amount above 0 and up to 100,000,000.' USING ERRCODE = '22023';
    END IF;
    PERFORM public.cockpit_upsell_choice(p_value->'currency', ARRAY['KWD','SAR','AED','QAR','BHD','OMR','USD'], 'The currency');
    PERFORM public.cockpit_upsell_choice(p_value->'from', ARRAY['typed','onboarding'], 'Where it came from');
    d := public.cockpit_upsell_date(p_value->'said_on', 'The date they said it');
    IF d > public.cockpit_upsell_today() THEN RAISE EXCEPTION 'The date they said it is today or earlier.' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_strip_nulls(jsonb_build_object('amount', p_value->'amount', 'currency', p_value->'currency',
                                                'from', p_value->'from', 'said_on', to_char(d, 'YYYY-MM-DD')));
  WHEN 'payment_link' THEN
    s := public.cockpit_upsell_text(p_value, 330, 'The payment link');
    IF s IS NULL THEN RETURN NULL; END IF;
    IF s !~ '^https://whop\.com/checkout/[A-Za-z0-9_-]{3,80}/?$'
       AND NOT (s ~ '^https://invoice\.ecom\.io/[^[:space:]<>"'']+$' AND char_length(s) <= 326) THEN
      RAISE EXCEPTION 'Paste a Whop checkout link or an ecom invoice link.' USING ERRCODE = '22023';
    END IF;
    RETURN to_jsonb(s);
  WHEN 'client_asked' THEN
    IF t <> 'object' THEN RAISE EXCEPTION 'Client asked is their words and the date they said them.' USING ERRCODE = '22023'; END IF;
    ks := ARRAY(SELECT jsonb_object_keys(p_value));
    IF NOT (ks @> ARRAY['words','on'] AND ks <@ ARRAY['words','on']) THEN
      RAISE EXCEPTION 'Client asked is their words and the date they said them.' USING ERRCODE = '22023';
    END IF;
    s := public.cockpit_upsell_text(p_value->'words', 300, 'What they said', 3);
    IF s IS NULL THEN RAISE EXCEPTION 'Type their words, at least 3 characters.' USING ERRCODE = '22023'; END IF;
    d := public.cockpit_upsell_date(p_value->'on', 'The date they asked');
    IF d IS NULL OR d > public.cockpit_upsell_today() OR d < public.cockpit_upsell_today() - 30 THEN
      RAISE EXCEPTION 'The date they asked is within the last 30 days.' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('words', s, 'on', to_char(d, 'YYYY-MM-DD'));
  WHEN 'hidden_slides', 'shown_slides' THEN
    IF t <> 'array' OR jsonb_array_length(p_value) > 30 THEN RAISE EXCEPTION '% must be a list of slide ids', p_key USING ERRCODE = '22023'; END IF;
    FOR e IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ '^[a-z0-9-]{1,40}$' THEN
        RAISE EXCEPTION '% must be a list of slide ids', p_key USING ERRCODE = '22023';
      END IF;
      IF NOT (arr @> jsonb_build_array(e)) THEN arr := arr || jsonb_build_array(e); END IF;
    END LOOP;
    RETURN nullif(arr, '[]'::jsonb);
  WHEN 'presented_at' THEN
    -- Stamped by the server; a client clock is never trusted. false clears it.
    IF p_value = 'false'::jsonb THEN RETURN NULL; END IF;
    IF t NOT IN ('boolean','string') THEN RAISE EXCEPTION 'presented_at is set with true and cleared with null' USING ERRCODE = '22023'; END IF;
    RETURN to_jsonb(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  ELSE
    RAISE EXCEPTION 'Prep does not keep "%"', p_key USING ERRCODE = '22023';
  END CASE;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_prep_save(p_task_id text, p_deck text, p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb; cur public.cockpit_csm_deck_prep; merged jsonb; k text; v jsonb; nv jsonb; v_meta jsonb; v_offer text;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  v_offer := substring(p_deck from '^offer_(website|second_campaign|seo_geo|smm|ugc|closer|cameraman)$');
  IF p_deck IS NULL OR (p_deck NOT IN ('onboarding','launch') AND v_offer IS NULL) THEN RAISE EXCEPTION 'Choose the onboarding or the launch deck'; END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'Send the prep changes as named values';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_patch)) > 40 THEN RAISE EXCEPTION 'Send at most 40 prep changes at once'; END IF;
  -- Two windows (prep and notes) save the same row: one merge at a time.
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_csm_deck_prep:' || p_task_id || ':' || p_deck, 0));
  SELECT * INTO cur FROM public.cockpit_csm_deck_prep p WHERE p.task_id = p_task_id AND p.deck = p_deck FOR UPDATE;
  merged := coalesce(cur.overrides, '{}'::jsonb);
  IF v_offer IS NULL AND EXISTS (SELECT 1 FROM jsonb_each(p_patch) x
              WHERE x.key IN ('their_pick','phones','meta_ad_text','form_confirmed') AND jsonb_typeof(x.value) <> 'null') THEN
    v_meta := public.cockpit_csm_deck_meta(p_task_id, g->>'clientName');
  END IF;
  FOR k, v IN SELECT key, value FROM jsonb_each(p_patch) LOOP
    IF v_offer IS NULL THEN
      nv := public.cockpit_csm_deck_prep_value(p_task_id, k, v, v_meta);
    ELSE
      nv := public.cockpit_csm_offer_prep_value(p_task_id, v_offer, k, v);
    END IF;
    -- A stamp keeps its first time until it is cleared.
    IF k IN ('creative_agreed_at','onboarding_presented_at','presented_at') AND nv IS NOT NULL AND merged ? k THEN CONTINUE; END IF;
    IF nv IS NULL THEN merged := merged - k; ELSE merged := merged || jsonb_build_object(k, nv); END IF;
  END LOOP;
  -- Validate the merged row so naming the recruiter and starting the deck
  -- in one save works, regardless of JSON key order. Blank still clears prep.
  IF v_offer = 'closer' AND merged ? 'presented_at' AND p_patch ? 'presented_at'
     AND coalesce(char_length(btrim(merged->>'recruiter_name')), 0) NOT BETWEEN 3 AND 120 THEN
    RAISE EXCEPTION 'Name the recruiter who will own this search before presenting.' USING ERRCODE = '22023';
  END IF;
  IF v_offer IS NOT NULL AND (p_patch ? 'opening_price' OR p_patch ? 'opening_reason') THEN
    PERFORM public.cockpit_csm_offer_price_check(v_offer, merged);
  END IF;
  IF octet_length(merged::text) > 65536 THEN RAISE EXCEPTION 'This deck''s prep is too large to save. Shorten the typed lines'; END IF;
  IF cur.task_id IS NOT NULL AND merged = cur.overrides THEN
    RETURN jsonb_build_object('deck', cur.deck, 'overrides', cur.overrides, 'revision', cur.revision,
                              'updatedAt', cur.updated_at, 'updatedBy', cur.updated_by, 'changed', false);
  END IF;
  IF cur.task_id IS NULL AND merged = '{}'::jsonb THEN
    RETURN jsonb_build_object('deck', p_deck, 'overrides', merged, 'revision', 0, 'updatedAt', NULL, 'updatedBy', NULL, 'changed', false);
  END IF;
  PERFORM set_config('cockpit.deck_action', 'deckPrep.save', true);
  INSERT INTO public.cockpit_csm_deck_prep AS p (task_id, deck, overrides, revision, updated_at, updated_by)
  VALUES (p_task_id, p_deck, merged, 1, now(), g->>'email')
  ON CONFLICT (task_id, deck) DO UPDATE
    SET overrides = excluded.overrides, revision = p.revision + 1, updated_at = now(), updated_by = excluded.updated_by
  RETURNING * INTO cur;
  RETURN jsonb_build_object('deck', cur.deck, 'overrides', cur.overrides, 'revision', cur.revision,
                            'updatedAt', cur.updated_at, 'updatedBy', cur.updated_by, 'changed', true);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_offer_sources(p_task_id text, p_offer text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb; v_gate jsonb; v_cat public.cockpit_upsell_catalog; v_prep public.cockpit_csm_deck_prep; v_mode text; v_reasons jsonb;
  v_forms jsonb; v_submitted date; v_answers jsonb; v_goals jsonb; v_onb jsonb; v_sheet jsonb;
  v_country text; v_currency text; v_closes bigint; v_valued bigint; v_rev numeric; v_ready jsonb;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  IF NOT public.cockpit_upsell_offer_ok(p_offer) THEN RAISE EXCEPTION 'Choose one of the seven offers.' USING ERRCODE = '22023'; END IF;
  v_gate := public.cockpit_csm_offer_gate(p_task_id);
  SELECT * INTO v_cat FROM public.cockpit_upsell_catalog c WHERE c.offer_key = p_offer;
  SELECT * INTO v_prep FROM public.cockpit_csm_deck_prep p WHERE p.task_id = p_task_id AND p.deck = 'offer_' || p_offer;
  v_reasons := public.cockpit_upsell_gate_reasons(v_gate, p_offer);
  v_mode := CASE WHEN jsonb_array_length(v_reasons) = 0 THEN 'proactive'
                 WHEN public.cockpit_upsell_asked_ok(v_prep.overrides->'client_asked') THEN 'client_asked'
                 ELSE 'refused' END;

  -- The onboarding answers the deck quotes, each with its date.
  SELECT o.forms->'onboarding' INTO v_forms FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_task_id;
  IF jsonb_typeof(v_forms) = 'object' AND jsonb_typeof(v_forms->'answers') = 'array' THEN
    BEGIN
      v_submitted := left(v_forms->>'submitted_at', 10)::date;
    EXCEPTION WHEN OTHERS THEN v_submitted := NULL;
    END;
    SELECT coalesce(jsonb_object_agg(a->>'ref', left(btrim(a->>'value'), 600)) FILTER (WHERE btrim(coalesce(a->>'value', '')) <> ''), '{}'::jsonb)
      INTO v_answers FROM jsonb_array_elements(v_forms->'answers') a WHERE jsonb_typeof(a) = 'object';
    v_goals := jsonb_build_object(
      'goal90', CASE WHEN v_answers ? '791b99b8-c7e9-40a4-96d6-868399e1ae97' THEN jsonb_build_object('answer', v_answers->'791b99b8-c7e9-40a4-96d6-868399e1ae97', 'answeredOn', v_submitted) END,
      'goal12_24', CASE WHEN v_answers ? 'f4b96a9b-bd7c-4398-98b4-6a28a7d3595a' THEN jsonb_build_object('answer', v_answers->'f4b96a9b-bd7c-4398-98b4-6a28a7d3595a', 'answeredOn', v_submitted) END,
      'challenges', CASE WHEN v_answers ? 'fcf43e6a-cc84-4ae7-9cef-2336069d0280' THEN jsonb_build_object('answer', v_answers->'fcf43e6a-cc84-4ae7-9cef-2336069d0280', 'answeredOn', v_submitted) END,
      'why', CASE WHEN v_answers ? '7426c6c5-344f-44c9-9999-3b9daf3a06b8' THEN jsonb_build_object('answer', v_answers->'7426c6c5-344f-44c9-9999-3b9daf3a06b8', 'answeredOn', v_submitted) END);
    -- "Which services have the highest price point": where the typical project comes from.
    IF v_answers ? 'd976036f-6c2e-4d5d-999a-64cf9bb2ef02' THEN
      v_onb := jsonb_build_object('answer', v_answers->'d976036f-6c2e-4d5d-999a-64cf9bb2ef02', 'answeredOn', v_submitted);
    END IF;
  END IF;

  -- Signed projects with a value on their sheet in the last 180 days.
  SELECT sum(d.closes), sum(d.closes_with_value), sum(d.revenue_usd) INTO v_closes, v_valued, v_rev
    FROM public.cockpit_client_days d
   WHERE d.location_id IN (SELECT x.location_id FROM public.ghl_clients x WHERE x.clickup_id = p_task_id)
     AND d.day >= public.cockpit_upsell_today() - 180;
  IF coalesce(v_valued, 0) > 0 AND coalesce(v_rev, 0) > 0 THEN
    v_sheet := jsonb_build_object('usd', round(v_rev / v_valued), 'closes', v_closes, 'withValue', v_valued,
                                  'from', 'cockpit_client_days', 'window', '180 days');
  END IF;

  SELECT CASE upper(nullif(btrim(x.country), '')) WHEN 'QT' THEN 'QA' ELSE upper(nullif(btrim(x.country), '')) END
    INTO v_country FROM public.ghl_clients x WHERE x.clickup_id = p_task_id ORDER BY x.location_id LIMIT 1;
  v_currency := CASE v_country WHEN 'KW' THEN 'KWD' WHEN 'SA' THEN 'SAR' WHEN 'AE' THEN 'AED' WHEN 'QA' THEN 'QAR'
                               WHEN 'BH' THEN 'BHD' WHEN 'OM' THEN 'OMR' ELSE 'USD' END;

  v_ready := public.cockpit_upsell_offer_readiness(p_task_id, p_offer);
  RETURN jsonb_build_object(
    'mode', v_mode, 'gate', v_gate, 'ready', v_ready - 'waitsOn', 'waitsOn', v_ready->'waitsOn',
    'catalog', CASE WHEN v_mode = 'refused' THEN NULL ELSE public.cockpit_upsell_catalog_json(v_cat) END,
    'prep', CASE WHEN v_prep.task_id IS NULL THEN NULL ELSE jsonb_build_object('overrides', v_prep.overrides, 'revision', v_prep.revision,
                   'updatedAt', to_jsonb(v_prep.updated_at), 'updatedBy', v_prep.updated_by) END,
    'priceProblem', public.cockpit_upsell_price_problem(p_offer, v_prep.overrides),
    'files', public.cockpit_upsell_files_rows(p_task_id),
    'site', public.cockpit_client_site_verdict(p_task_id),
    'project', jsonb_build_object('onboarding', v_onb, 'sheet', v_sheet),
    'goals', coalesce(v_goals, jsonb_build_object('goal90', NULL, 'goal12_24', NULL, 'challenges', NULL, 'why', NULL)),
    'country', v_country, 'currency', v_currency,
    'fx', jsonb_build_object('usdPer', public.cockpit_pay_usd_per(v_currency), 'from', 'cockpit_pay_usd_per',
                             'note', CASE WHEN public.cockpit_pay_usd_per(v_currency) IS NULL
                                          THEN format('No fixed rate for %s: the figure stays in US dollars.', v_currency) END),
    'pitches', (SELECT coalesce(jsonb_agg(public.cockpit_upsell_pitch_json(p) ORDER BY p.pitched_on DESC, p.created_at DESC), '[]'::jsonb)
                  FROM (SELECT * FROM public.cockpit_upsell_pitches p WHERE p.task_id = p_task_id AND p.offer_key = p_offer
                        ORDER BY p.pitched_on DESC, p.created_at DESC LIMIT 10) p),
    'heldFullRecently', public.cockpit_upsell_held_full(p_task_id, p_offer),
    'doorLive', (public.cockpit_upsell_settings_json()->>'doorLive')::boolean,
    'at', to_jsonb(now()));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_offer_status(p_task_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb; v_gate jsonb; v_site jsonb; v_fit jsonb; v_prep jsonb; v_offers jsonb := '[]'::jsonb;
  c public.cockpit_upsell_catalog; v_this text; v_this_why text; v_last jsonb; v_verdict text; v_ready jsonb;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  v_gate := public.cockpit_csm_offer_gate(p_task_id);
  v_site := public.cockpit_client_site_verdict(p_task_id);
  v_verdict := v_site->>'verdict';
  FOR c IN SELECT * FROM public.cockpit_upsell_catalog x ORDER BY x.sort LOOP
    v_prep := public.cockpit_upsell_prep_of(p_task_id, c.offer_key);
    v_ready := public.cockpit_upsell_offer_readiness(p_task_id, c.offer_key);
    IF c.offer_key = 'website' THEN
      v_fit := CASE
        WHEN v_verdict = 'broken' THEN jsonb_build_object('ok', true, 'why', rtrim(split_part(v_site->>'note', '.', 1), '.'))
        WHEN v_verdict = 'none_on_file' THEN jsonb_build_object('ok', true, 'why', 'No website on file')
        WHEN v_prep->'site_thin' = 'true'::jsonb THEN jsonb_build_object('ok', true, 'why', 'Their site is thin, ticked in prep')
        WHEN v_verdict = 'not_checked' THEN jsonb_build_object('ok', NULL, 'why', 'Site not checked yet')
        WHEN v_verdict = 'failing' THEN jsonb_build_object('ok', NULL, 'why', rtrim(split_part(v_site->>'note', '.', 1), '.'))
        ELSE jsonb_build_object('ok', false, 'why', 'Their site works') END;
    ELSE
      v_fit := jsonb_build_object('ok', NULL, 'why', coalesce(v_ready->>'waitsOn', 'Review their needs with them before choosing this offer.'));
    END IF;
    SELECT jsonb_build_object('on', p.pitched_on, 'answer', p.answer, 'mode', p.mode) INTO v_last
      FROM public.cockpit_upsell_pitches p WHERE p.task_id = p_task_id AND p.offer_key = c.offer_key
     ORDER BY p.pitched_on DESC, p.created_at DESC LIMIT 1;
    v_offers := v_offers || jsonb_build_array(jsonb_build_object(
      'key', c.offer_key, 'fit', v_fit,
      'ready', v_ready - 'waitsOn',
      'waitsOn', v_ready->'waitsOn', 'lastPitch', v_last));
    IF v_this IS NULL AND (v_gate->>'ok')::boolean AND v_fit->'ok' = 'true'::jsonb AND c.waits_on IS NULL THEN
      v_this := c.offer_key; v_this_why := v_fit->>'why';
    END IF;
    v_last := NULL;
  END LOOP;
  IF v_this IS NULL THEN
    v_this_why := CASE WHEN NOT (v_gate->>'ok')::boolean THEN 'Not this month: ' || (v_gate->'reasons'->0->>'text')
                       ELSE 'No offer fits yet: ' || lower(left(v_offers->0->'fit'->>'why', 1)) || substr(v_offers->0->'fit'->>'why', 2) || '.' END;
  END IF;
  RETURN jsonb_build_object(
    'gate', jsonb_build_object('ok', v_gate->'ok', 'reasons', v_gate->'reasons'),
    'thisMonth', v_this, 'thisMonthWhy', v_this_why, 'offers', v_offers, 'at', to_jsonb(now()));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_upsell_proposal_problems(r public.cockpit_upsell_proposals, p_ack text[], p_send boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  out jsonb := '[]'::jsonb; c public.cockpit_upsell_catalog; x record; p jsonb; e jsonb; i integer; v_list jsonb; v_price numeric; v_lang text;
  cp jsonb; op jsonb; v_other text; t text;
BEGIN
  SELECT * INTO c FROM public.cockpit_upsell_catalog o WHERE o.offer_key = r.offer_key;
  v_lang := CASE r.lang WHEN 'ar' THEN 'Arabic' ELSE 'English' END;
  v_other := CASE r.lang WHEN 'ar' THEN 'English' ELSE 'Arabic' END;
  cp := coalesce(c.copy->r.lang, '{}'::jsonb);
  op := coalesce(c.copy->(CASE r.lang WHEN 'ar' THEN 'en' ELSE 'ar' END), '{}'::jsonb);
  IF p_send AND r.offer_key = 'closer'
     AND public.cockpit_upsell_offer_readiness(r.task_id, r.offer_key)->'missing' ? 'no_recruiter' THEN
    out := out || jsonb_build_array(jsonb_build_object('field', 'recruiter_name', 'rule', 'no_recruiter', 'block', true,
      'text', 'Name the recruiter who will own this search in preparation before sending.'));
  END IF;
  IF p_send AND r.content->'video'->>'kind' = 'default' AND public.cockpit_upsell_offer_video(r.offer_key, r.lang) IS NULL THEN
    out := out || jsonb_build_array(jsonb_build_object('field', 'video', 'rule', 'no_video', 'block', true,
      'text', format('This offer has no %s video yet. The CEO saves it on Money > Offers, or paste a custom video.', v_lang)));
  END IF;
  -- Every shown line, with the catalog's own text for its key in this
  -- language (mine) and in the other one (other), trimmed as the page shows
  -- them. What we found and a custom video's title have no catalog text.
  FOR x IN
    SELECT 'why' AS field, 'Why this, for you' AS label, r.content->'why'->>'text' AS txt,
           (SELECT btrim(k->>'text') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cp->'why') = 'array' THEN cp->'why' ELSE '[]'::jsonb END) k
             WHERE k->>'key' = r.content->'why'->>'trigger' LIMIT 1) AS mine,
           (SELECT btrim(k->>'text') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(op->'why') = 'array' THEN op->'why' ELSE '[]'::jsonb END) k
             WHERE k->>'key' = r.content->'why'->>'trigger' LIMIT 1) AS other
    UNION ALL
    SELECT 'get.' || n, 'What you get, line ' || n, g->>'text',
           (SELECT btrim(k->>'text') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cp->'get') = 'array' THEN cp->'get' ELSE '[]'::jsonb END) k
             WHERE k->>'key' = g->>'key' LIMIT 1),
           (SELECT btrim(k->>'text') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(op->'get') = 'array' THEN op->'get' ELSE '[]'::jsonb END) k
             WHERE k->>'key' = g->>'key' LIMIT 1)
      FROM jsonb_array_elements(r.content->'get') WITH ORDINALITY y(g, n)
     WHERE g->'hidden' IS DISTINCT FROM 'true'::jsonb
    UNION ALL
    SELECT 'steps', 'How it runs', r.content->'steps'->>'text',
           nullif(btrim(public.cockpit_upsell_copy_steps(cp)), ''), nullif(btrim(public.cockpit_upsell_copy_steps(op)), '')
    UNION ALL
    SELECT 'button', 'The button', r.content->'button'->>'text', btrim(cp->>'button'), btrim(op->>'button')
    UNION ALL
    SELECT 'found.' || n, 'What we found, picture ' || n, f->>'caption', NULL, NULL
      FROM jsonb_array_elements(public.cockpit_upsell_found_live(r.task_id, r.content->'found')) WITH ORDINALITY y(f, n)
    UNION ALL
    SELECT 'found.' || n || '.searchedAs', 'What we found, picture ' || n || ', searched as', f->>'searchedAs', NULL, NULL
      FROM jsonb_array_elements(public.cockpit_upsell_found_live(r.task_id, r.content->'found')) WITH ORDINALITY y(f, n)
    UNION ALL
    SELECT 'video.title', 'The video title', r.content->'video'->>'title', NULL, NULL WHERE r.content->'video'->>'kind' = 'custom'
  LOOP
    t := btrim(coalesce(x.txt, ''));
    -- The catalog's own line in this language is not checked again.
    CONTINUE WHEN t IS NOT DISTINCT FROM x.mine;
    -- The other language's catalog line, left behind by a language switch.
    IF t <> '' AND t = x.other THEN
      out := out || jsonb_build_array(jsonb_build_object('field', x.field, 'rule', 'wrong_language', 'block', true,
        'text', format('%s: still in %s. Write it in %s.', x.label, v_other, v_lang)));
    END IF;
    FOR p IN SELECT value FROM jsonb_array_elements(public.cockpit_client_copy_problems(x.txt, false)) LOOP
      out := out || jsonb_build_array(jsonb_build_object('field', x.field, 'rule', p->'rule', 'block', p->'block',
        'text', format('%s: %s ("%s")', x.label, p->>'why', p->>'match')));
    END LOOP;
  END LOOP;
  IF NOT p_send THEN RETURN out; END IF;

  v_list := public.cockpit_upsell_list_of(c.parts);
  -- Every part priced.
  FOR e IN SELECT value FROM jsonb_array_elements(c.parts) LOOP
    IF jsonb_typeof(r.price->'parts'->(e->>'key')) <> 'number' OR (r.price->'parts'->(e->>'key')) IS NULL THEN
      out := out || jsonb_build_array(jsonb_build_object('field', 'price', 'rule', 'no_price', 'block', true,
        'text', format('Type a price for the %s.', public.cockpit_upsell_part_name(r.offer_key, e->>'key', true))));
    END IF;
  END LOOP;
  -- Below list needs a reason; a locked price is its list.
  FOR e IN SELECT value FROM jsonb_array_elements(c.parts) LOOP
    v_price := (r.price->'parts'->>(e->>'key'))::numeric;
    IF jsonb_typeof(e->'amount') = 'number' AND v_price < (e->>'amount')::numeric AND r.price_reason IS NULL AND NOT c.locked THEN
      out := out || jsonb_build_array(jsonb_build_object('field', 'price', 'rule', 'below_list', 'block', true,
        'text', format('%s: below the list price (%s). Add a one-line reason.', public.cockpit_upsell_part_name(r.offer_key, e->>'key'),
                       public.cockpit_upsell_money((e->>'amount')::numeric))));
    END IF;
  END LOOP;
  IF c.locked THEN
    IF EXISTS (SELECT 1 FROM jsonb_each(v_list) l WHERE jsonb_typeof(l.value) = 'null') THEN
      out := out || jsonb_build_array(jsonb_build_object('field', 'price', 'rule', 'locked', 'block', true,
        'text', 'This price is locked. The CEO sets it on Money > Offers.'));
    ELSIF EXISTS (SELECT 1 FROM jsonb_each(v_list) l WHERE (r.price->'parts'->>l.key)::numeric IS DISTINCT FROM (l.value #>> '{}')::numeric) THEN
      out := out || jsonb_build_array(jsonb_build_object('field', 'price', 'rule', 'locked', 'block', true,
        'text', format('This price is locked at the list price (%s).', public.cockpit_upsell_price_text(c.parts, v_list))));
    END IF;
  END IF;
  IF r.price->'split' = 'true'::jsonb THEN
    IF NOT c.split_allowed THEN
      out := out || jsonb_build_array(jsonb_build_object('field', 'price', 'rule', 'split', 'block', true, 'text', 'This offer has no split.'));
    ELSIF NOT public.cockpit_upsell_held_full(r.task_id, r.offer_key) THEN
      out := out || jsonb_build_array(jsonb_build_object('field', 'price', 'rule', 'split', 'block', true,
        'text', 'The split shows only after full price was held: on a call, or in a proposal sent at full price, in the last 60 days.'));
    END IF;
  END IF;
  IF r.valid_until < public.cockpit_upsell_today() THEN
    out := out || jsonb_build_array(jsonb_build_object('field', 'valid_until', 'rule', 'expired', 'block', true,
      'text', '"Valid until" has passed. Pick a new date.'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.content->'get') g
                  WHERE g->'hidden' IS DISTINCT FROM 'true'::jsonb AND btrim(coalesce(g->>'text', '')) <> '') THEN
    out := out || jsonb_build_array(jsonb_build_object('field', 'get', 'rule', 'empty', 'block', true,
      'text', 'Show at least one line under What you get.'));
  END IF;
  IF btrim(coalesce(r.content->'button'->>'text', '')) = '' THEN
    out := out || jsonb_build_array(jsonb_build_object('field', 'button', 'rule', 'empty', 'block', true,
      'text', 'Type the words on the button.'));
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(public.cockpit_upsell_proposal_warnings(r.task_id, r.offer_key)) LOOP
    IF NOT coalesce((e->>'key') = ANY (coalesce(p_ack, '{}')), false) THEN
      out := out || jsonb_build_array(jsonb_build_object('field', 'warnings', 'rule', e->'key', 'block', true,
        'text', 'Tick the warning first: ' || (e->>'text')));
    END IF;
  END LOOP;
  RETURN out;
END $$;
CREATE OR REPLACE FUNCTION public.cockpit_upsell_pitch_save(p_task_id text, p_offer text, p_request_id uuid, p_patch jsonb, p_base_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb; cur public.cockpit_upsell_pitches; nxt public.cockpit_upsell_pitches; c public.cockpit_upsell_catalog;
  v_gate jsonb; v_prep jsonb; k text; v jsonb; e jsonb; ks text[]; v_want text[]; v_lines text[] := '{}'; v_name text;
  v_list jsonb; v_creating boolean := false; i integer; v_reasons jsonb;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  IF NOT public.cockpit_upsell_offer_ok(p_offer) THEN RAISE EXCEPTION 'Choose one of the seven offers.' USING ERRCODE = '22023'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'A pitch request id is required.' USING ERRCODE = '22023'; END IF;
  IF p_patch IS NULL THEN p_patch := '{}'::jsonb; END IF;
  IF jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'Send the changes as named values.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO c FROM public.cockpit_upsell_catalog x WHERE x.offer_key = p_offer;
  v_name := public.cockpit_upsell_offer_name(p_offer);
  v_list := public.cockpit_upsell_list_of(c.parts);
  v_want := ARRAY(SELECT x->>'key' FROM jsonb_array_elements(c.parts) x);

  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_upsell_pitches:' || p_request_id::text, 0));
  SELECT * INTO cur FROM public.cockpit_upsell_pitches x WHERE x.request_id = p_request_id FOR UPDATE;
  IF cur.id IS NOT NULL THEN
    IF cur.task_id <> p_task_id OR cur.offer_key <> p_offer THEN
      RAISE EXCEPTION 'This request id belongs to another pitch.' USING ERRCODE = '42501';
    END IF;
    IF p_base_revision IS NULL OR p_base_revision <> cur.revision THEN
      RAISE EXCEPTION 'Someone else saved this. Read it again.' USING ERRCODE = '40001';
    END IF;
    nxt := cur;
  ELSE
    IF coalesce(p_base_revision, 0) <> 0 THEN
      RAISE EXCEPTION 'Someone else saved this. Read it again.' USING ERRCODE = '40001';
    END IF;
    IF p_offer = 'closer' AND public.cockpit_upsell_offer_readiness(p_task_id,p_offer)->'missing' ? 'no_recruiter' THEN
      RAISE EXCEPTION 'Name the recruiter who will own this search before recording a presentation.' USING ERRCODE = '22023';
    END IF;
    v_creating := true;
    v_gate := public.cockpit_csm_offer_gate(p_task_id);
    v_prep := public.cockpit_upsell_prep_of(p_task_id, p_offer);
    nxt.id := gen_random_uuid();
    nxt.request_id := p_request_id;
    nxt.task_id := p_task_id;
    nxt.offer_key := p_offer;
    nxt.pitched_on := public.cockpit_upsell_today();
    nxt.csm_email := g->>'email';
    -- The same reasons the deck's mode is worked out from (stored raw in gate).
    v_reasons := public.cockpit_upsell_gate_reasons(v_gate, p_offer);
    IF jsonb_array_length(v_reasons) > 0 AND public.cockpit_upsell_asked_ok(v_prep->'client_asked') THEN
      nxt.mode := 'client_asked';
      nxt.client_words := btrim(v_prep->'client_asked'->>'words');
      nxt.client_asked_on := (v_prep->'client_asked'->>'on')::date;
    ELSE
      nxt.mode := 'proactive';
    END IF;
    nxt.gate := jsonb_build_object('ok', v_gate->'ok', 'checkedAt', v_gate->'checkedAt',
      'reasons', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', r->'key', 'text', r->'text')), '[]'::jsonb) FROM jsonb_array_elements(v_gate->'reasons') r),
      'win', v_gate->'win');
    nxt.list_price := v_list;
    nxt.opening_price := coalesce(v_prep->'opening_price',
      CASE WHEN NOT EXISTS (SELECT 1 FROM jsonb_each(v_list) l WHERE jsonb_typeof(l.value) = 'null') THEN v_list END);
    nxt.opening_reason := v_prep->>'opening_reason';
    nxt.payment_link := v_prep->>'payment_link';
    nxt.lang := coalesce(v_prep->>'language', 'en');
    nxt.held_full := false;
    nxt.split := false;
    nxt.revision := 1;
    FOR i IN 1..5 LOOP
      nxt.video_code := public.cockpit_upsell_code(10);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.cockpit_upsell_pitches x WHERE x.video_code = nxt.video_code);
    END LOOP;
  END IF;

  FOR k, v IN SELECT key, value FROM jsonb_each(p_patch) LOOP
    CASE k
    WHEN 'held_full' THEN
      IF jsonb_typeof(v) <> 'boolean' THEN RAISE EXCEPTION 'held_full is a yes or no.' USING ERRCODE = '22023'; END IF;
      nxt.held_full := (v #>> '{}')::boolean;
    WHEN 'split' THEN
      IF jsonb_typeof(v) <> 'boolean' THEN RAISE EXCEPTION 'split is a yes or no.' USING ERRCODE = '22023'; END IF;
      nxt.split := (v #>> '{}')::boolean;
    WHEN 'final_price' THEN
      IF jsonb_typeof(v) = 'null' THEN nxt.final_price := NULL;
      ELSE
        IF jsonb_typeof(v) <> 'object' THEN RAISE EXCEPTION 'The final price names each part and its dollars.' USING ERRCODE = '22023'; END IF;
        ks := ARRAY(SELECT jsonb_object_keys(v));
        IF NOT (ks @> v_want AND ks <@ v_want) THEN
          RAISE EXCEPTION 'Type the final price for %.', public.cockpit_upsell_parts_named(p_offer, c.parts) USING ERRCODE = '22023';
        END IF;
        FOR e IN SELECT value FROM jsonb_each(v) LOOP
          IF NOT public.cockpit_upsell_usd_ok(e) THEN
            RAISE EXCEPTION 'A price is a dollar amount from 1 to 1,000,000, with at most two decimals.' USING ERRCODE = '22023';
          END IF;
        END LOOP;
        nxt.final_price := v;
      END IF;
    WHEN 'final_reason' THEN nxt.final_reason := public.cockpit_upsell_text(v, 140, 'The reason');
    WHEN 'answer' THEN nxt.answer := public.cockpit_upsell_choice(v, ARRAY['yes_paid','yes_unpaid','not_now','no'], 'The answer') #>> '{}';
    WHEN 'follow_up_on' THEN nxt.follow_up_on := public.cockpit_upsell_date(v, 'The follow-up date');
    WHEN 'no_reason' THEN nxt.no_reason := public.cockpit_upsell_text(v, 200, 'Why they said no');
    ELSE RAISE EXCEPTION 'A pitch does not keep "%".', k USING ERRCODE = '22023';
    END CASE;
  END LOOP;

  -- The rules, on the whole row.
  IF nxt.final_price IS NOT NULL THEN
    IF c.locked AND (EXISTS (SELECT 1 FROM jsonb_each(v_list) l WHERE jsonb_typeof(l.value) = 'null')
                     OR EXISTS (SELECT 1 FROM jsonb_each(v_list) l WHERE (nxt.final_price->>l.key)::numeric IS DISTINCT FROM (l.value #>> '{}')::numeric)) THEN
      RAISE EXCEPTION 'This price is locked at the list price.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each(coalesce(nxt.opening_price, '{}'::jsonb)) o
                WHERE (nxt.final_price->>o.key)::numeric < (o.value #>> '{}')::numeric) THEN
      IF NOT nxt.held_full THEN
        RAISE EXCEPTION 'Tap "Held full price" before saying a lower price.' USING ERRCODE = '22023';
      END IF;
      IF nxt.final_reason IS NULL THEN
        RAISE EXCEPTION 'A price below the opening price needs a one-line reason.' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;
  IF nxt.split THEN
    IF NOT c.split_allowed THEN RAISE EXCEPTION 'This offer has no split.' USING ERRCODE = '22023'; END IF;
    IF NOT nxt.held_full THEN RAISE EXCEPTION 'The split comes only after "Held full price".' USING ERRCODE = '22023'; END IF;
  END IF;
  IF nxt.answer = 'not_now' AND (nxt.follow_up_on IS NULL OR nxt.follow_up_on < public.cockpit_upsell_today()
                                 OR nxt.follow_up_on > public.cockpit_upsell_today() + 120) THEN
    RAISE EXCEPTION 'Pick a follow-up date in the next 120 days.' USING ERRCODE = '22023';
  END IF;
  IF nxt.answer = 'no' AND nxt.no_reason IS NULL THEN
    RAISE EXCEPTION 'Say why they said no, in a line.' USING ERRCODE = '22023';
  END IF;

  IF NOT v_creating AND nxt IS NOT DISTINCT FROM cur THEN
    RETURN public.cockpit_upsell_pitch_json(cur) || jsonb_build_object('videoUrl', public.cockpit_upsell_video_link(cur)->'url', 'changed', false);
  END IF;

  -- The CEO card's sentence.
  IF v_creating THEN
    v_lines := v_lines || format('%s offered to %s%s', v_name, g->>'clientName',
      CASE WHEN nxt.mode = 'client_asked' THEN ' (they asked)' WHEN jsonb_array_length(v_reasons) > 0 THEN ' (gate not passed)' ELSE '' END);
    IF nxt.opening_price IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_each(v_list) l WHERE jsonb_typeof(l.value) = 'number'
                                                   AND (nxt.opening_price->>l.key)::numeric < (l.value #>> '{}')::numeric) THEN
      v_lines := v_lines || format('Opening price %s below list %s: %s', public.cockpit_upsell_price_text(c.parts, nxt.opening_price),
                                   public.cockpit_upsell_price_text(c.parts, v_list), coalesce(nxt.opening_reason, 'no reason'));
    END IF;
  END IF;
  IF nxt.held_full AND (cur.id IS NULL OR NOT cur.held_full) THEN v_lines := v_lines || 'Held full price'::text; END IF;
  IF nxt.final_price IS DISTINCT FROM cur.final_price AND nxt.final_price IS NOT NULL THEN
    v_lines := v_lines || CASE WHEN EXISTS (SELECT 1 FROM jsonb_each(coalesce(nxt.opening_price, '{}'::jsonb)) o
                                             WHERE (nxt.final_price->>o.key)::numeric < (o.value #>> '{}')::numeric)
      THEN format('Final price %s below opening %s: %s', public.cockpit_upsell_price_text(c.parts, nxt.final_price),
                  public.cockpit_upsell_price_text(c.parts, nxt.opening_price), nxt.final_reason)
      ELSE format('Final price %s', public.cockpit_upsell_price_text(c.parts, nxt.final_price)) END;
  END IF;
  IF nxt.split AND (cur.id IS NULL OR NOT cur.split) THEN v_lines := v_lines || 'Split in two payments'::text; END IF;
  IF nxt.answer IS DISTINCT FROM cur.answer AND nxt.answer IS NOT NULL THEN
    v_lines := v_lines || CASE nxt.answer
      WHEN 'yes_paid' THEN 'Answer: yes, paid'
      WHEN 'yes_unpaid' THEN 'Answer: yes, not paid yet'
      WHEN 'not_now' THEN format('Answer: not now, follow up %s', public.cockpit_upsell_day(nxt.follow_up_on))
      ELSE format('Answer: no, %s', nxt.no_reason) END;
  END IF;
  PERFORM set_config('cockpit.upsell_action', CASE WHEN v_creating THEN 'upsellPitch.create' ELSE 'upsellPitch.save' END, true);
  PERFORM set_config('cockpit.upsell_line', coalesce(nullif(array_to_string(v_lines, '; '), ''), v_name || ' pitch updated'), true);
  IF v_creating THEN
    INSERT INTO public.cockpit_upsell_pitches (id, request_id, task_id, offer_key, pitched_on, csm_email, mode, client_words, client_asked_on,
        gate, list_price, opening_price, opening_reason, held_full, final_price, final_reason, split, answer, follow_up_on, no_reason,
        payment_link, lang, video_code, revision, updated_by)
    VALUES (nxt.id, nxt.request_id, nxt.task_id, nxt.offer_key, nxt.pitched_on, nxt.csm_email, nxt.mode, nxt.client_words, nxt.client_asked_on,
        nxt.gate, nxt.list_price, nxt.opening_price, nxt.opening_reason, nxt.held_full, nxt.final_price, nxt.final_reason, nxt.split,
        nxt.answer, nxt.follow_up_on, nxt.no_reason, nxt.payment_link, nxt.lang, nxt.video_code, 1, g->>'email')
    RETURNING * INTO nxt;
  ELSE
    UPDATE public.cockpit_upsell_pitches x
       SET held_full = nxt.held_full, final_price = nxt.final_price, final_reason = nxt.final_reason, split = nxt.split,
           answer = nxt.answer, follow_up_on = nxt.follow_up_on, no_reason = nxt.no_reason,
           revision = x.revision + 1, updated_at = now(), updated_by = g->>'email'
     WHERE x.id = cur.id RETURNING * INTO nxt;
  END IF;
  RETURN public.cockpit_upsell_pitch_json(nxt) || jsonb_build_object('videoUrl', public.cockpit_upsell_video_link(nxt)->'url', 'changed', true);
END $$;

REVOKE ALL ON FUNCTION public.cockpit_upsell_offer_readiness(text,text) FROM PUBLIC, anon, authenticated, service_role;

-- Three genuine presenter examples, approved from the user's source folders.
-- Wistia processing/availability was verified on 27 October 2026 before this
-- file was prepared. No actor identity or result claim is inferred. Public
-- proposals already freeze work[] on send; old sent links are not rewritten.
DO $examples$
DECLARE
  en constant jsonb := '[{"key":"khalda","label":"Presenter example: Khalda","url":"https://maharamedia.wistia.com/medias/qlwysqfu2g"},{"key":"castello","label":"Presenter example: Castello","url":"https://maharamedia.wistia.com/medias/btp2dokvjr"},{"key":"alkhalil","label":"Presenter example: AlKhalil","url":"https://maharamedia.wistia.com/medias/nix1oq0h3a"}]'::jsonb;
  ar constant jsonb := '[{"key":"khalda","label":"مثال تقديم: خالدة","url":"https://maharamedia.wistia.com/medias/qlwysqfu2g"},{"key":"castello","label":"مثال تقديم: كاستيلو","url":"https://maharamedia.wistia.com/medias/btp2dokvjr"},{"key":"alkhalil","label":"مثال تقديم: الخليل","url":"https://maharamedia.wistia.com/medias/nix1oq0h3a"}]'::jsonb;
  c public.cockpit_upsell_catalog; cp jsonb; next_hold text; x jsonb;
BEGIN
  SELECT * INTO c FROM public.cockpit_upsell_catalog WHERE offer_key='ugc' FOR UPDATE;
  IF c.offer_key IS NULL OR NOT (c.copy ? 'en' AND c.copy ? 'ar') THEN
    RAISE EXCEPTION 'Apply the bilingual offer copy before the presenter examples.';
  END IF;
  IF c.copy#>'{en,work}' NOT IN ('[]'::jsonb,en) OR c.copy#>'{ar,work}' NOT IN ('[]'::jsonb,ar) THEN
    RAISE EXCEPTION 'Presenter examples changed. Read the current work list before applying.';
  END IF;
  FOR x IN SELECT value FROM jsonb_array_elements(en || ar) LOOP
    IF public.cockpit_csm_deck_video_parse(x->>'url')->>'provider' <> 'wistia'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(public.cockpit_client_copy_problems(x->>'label', false)) p WHERE p->'block'='true'::jsonb) THEN
      RAISE EXCEPTION 'Presenter example failed its provider or copy check.';
    END IF;
  END LOOP;
  cp := jsonb_set(jsonb_set(c.copy,'{en,work}',en),'{ar,work}',ar);
  IF NOT public.cockpit_upsell_copy_ok(cp,c.parts,c.offer_key) THEN RAISE EXCEPTION 'Presenter examples do not match the catalog contract.'; END IF;
  next_hold := CASE WHEN c.waits_on='Needs real UGC videos we produced.' THEN NULL ELSE c.waits_on END;
  IF cp IS DISTINCT FROM c.copy OR next_hold IS DISTINCT FROM c.waits_on THEN
    PERFORM set_config('cockpit.upsell_action','upsellCatalog.copy',true);
    PERFORM set_config('cockpit.upsell_line','Presenter videos: three approved work examples added in English and Arabic',true);
    UPDATE public.cockpit_upsell_catalog SET copy=cp, waits_on=next_hold, revision=revision+1, updated_at=now(), updated_by='migration' WHERE offer_key='ugc';
  END IF;
  -- The former pilot-only note becomes stale once this release supplies all
  -- seven presentations. Preserve any CEO-entered replacement hold verbatim.
  SELECT * INTO c FROM public.cockpit_upsell_catalog WHERE offer_key='second_campaign' FOR UPDATE;
  IF c.waits_on='Deck and video follow the website.' THEN
    PERFORM set_config('cockpit.upsell_action','upsellCatalog.save',true);
    PERFORM set_config('cockpit.upsell_line','Second campaign: presentation is available; video readiness is checked separately',true);
    UPDATE public.cockpit_upsell_catalog SET waits_on=NULL, revision=revision+1, updated_at=now(), updated_by='migration' WHERE offer_key='second_campaign';
  END IF;
  PERFORM set_config('cockpit.upsell_action','',true);
  PERFORM set_config('cockpit.upsell_line','',true);
END $examples$;

COMMIT;
