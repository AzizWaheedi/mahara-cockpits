-- Upsell offers take a Tap invoice link too (Aziz, 2026-11-05: "Ecom is the
-- main one, but I need to have WHOP and Tap as backups ... Go through all the
-- billing sections"). Only the payment_link rule of
-- cockpit_csm_offer_prep_value changes: Ecom and Whop links stay as they were,
-- and a live Tap invoice page (https://...tap.company/..., never sandbox) is
-- now accepted. Grants are kept (CREATE OR REPLACE): the owner only.
-- Creative Triage (bldgtotkfmhoxmlzowdx).
BEGIN;
DO $guard$
DECLARE got text;
BEGIN
  SELECT md5(prosrc) INTO got FROM pg_catalog.pg_proc
   WHERE oid = to_regprocedure('public.cockpit_csm_offer_prep_value(text,text,text,jsonb)');
  -- 20261027115820's version, or this one already applied.
  IF got IS NULL OR got NOT IN ('8b203ec8d4af8191e67bedcbb7021079', 'd8686a853ef8c1fb1f66fb016c01d506') THEN
    RAISE EXCEPTION 'cockpit_csm_offer_prep_value changed (prosrc md5 %). Re-read the current definition.', coalesce(got, 'missing');
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_offer_prep_value(p_task_id text, p_offer text, p_key text, p_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    -- Ecom is the main link; Whop and Tap are the backups (Aziz, 2026-11-05).
    -- A Tap link is a live Tap invoice page, never a sandbox one.
    IF s !~ '^https://whop\.com/checkout/[A-Za-z0-9_-]{3,80}/?$'
       AND NOT (s ~ '^https://invoice\.ecom\.io/[^[:space:]<>"'']+$' AND char_length(s) <= 326)
       AND NOT (s ~ '^https://([a-z0-9-]+\.)*tap\.company/[^[:space:]<>"'']+$' AND s !~* 'sandbox' AND char_length(s) <= 326) THEN
      RAISE EXCEPTION 'Paste an Ecom invoice link, a Whop checkout link or a Tap invoice link.' USING ERRCODE = '22023';
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
END $function$;

COMMIT;
