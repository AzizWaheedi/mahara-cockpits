-- Market research, MI-1 (CEO decision 1, 2026-11-02: "find the market intel, or make it even better and replicate
-- and improve it with a better scraper"). Creative Triage (bldgtotkfmhoxmlzowdx). Dark: the setting market_intel
-- is seeded off, and nothing here posts, writes a card, sends a message or reaches Drive. Applies twice. Stands on
-- 20261102o (cockpit_form_stage4_fields, cockpit_form_stage4_typeform_answers) and the cockpit identity
-- (cockpit_is_ceo, cockpit_has_role, cockpit_csm_client_gate). It replaces no live function; on the live table
-- cockpit_settings it adds one trigger of its own, for the market_intel key only (section 8).
--
-- The worker hermes/market-intel (VPS, cron every 2 minutes under flock) does every pull in code and lets the
-- model judge with no tools. This file is its home:
--
-- 1. Four tables, row security on, nothing for anon or authenticated, SELECT only for service_role. Every
--    write goes through a function below, and every such function writes one cockpit_audit_log row.
--    - cockpit_market_intel_runs: one row per research run. One open run per card (partial unique index);
--      one onboarding or shadow run per stored answer. Spend is cumulative and never goes down.
--    - cockpit_market_intel_evidence: numbered evidence (E1, E2, ...) with its URL, source and time. A review
--      body never carries the reviewer (refused here as well as dropped at pull time). Bodies are pruned
--      after 180 days; ids, URLs and hashes stay.
--    - cockpit_market_intel_findings: the validated findings per language, with each rule's result.
--    - cockpit_market_intel_competitors: the picked competitors, and "Not a competitor" flags.
-- 2. The worker's functions (service_role only): enqueue, scan, claim, progress, store, release, done, input,
--    preview (the dry run's read, no run needed), nap, month spend, prune. A claim is a try and three tries end a
--    run failed; a release for an outage (the engine, the month's spend) or a pause (research turned off) gives
--    the try back, waits longer each time (up to 4 hours) and, after 24 hours of outages, ends the run
--    needs_person. progress hands back the switch and the caps, so a run stops or tightens mid-run. input and preview never return the
--    five contact answers (full name, phone, email, front desk phone, personal phone); nap compares the Maps
--    listing's phone with the front desk phone inside the database and answers match, differs or not_checked, so
--    the number never leaves it.
-- 3. The cockpit's functions (authenticated, gated here): view (CEO, admin, a CSM on their own clients through
--    cockpit_csm_client_gate, creative, media buyer), rerun and flag (CEO or admin), reached through
--    cockpit-csm-api.
-- 4. The setting market_intel, off: {on:false, mode:'shadow', apply_drive, apply_clickup, apply_kb all false,
--    only_cards [], usd_cap_run 2, usd_cap_month 25, refresh_on_kickoff false, shadow_since <apply time>}. Every
--    later change to it writes an audit row (a trigger of this file's own; the live forms and billing settings
--    trigger is not touched). view shows a run's findings only once the run is done.
-- 5. The effect market_intel is catalogued (cockpit_market_intel_effect) and is NOT in the live onboarding
--    effects arrays; the cutover migration adds it at D-S4O with the owner's agreement.
--
-- Money: the month cap is the sum of every run's Apify and ScrapeCreators spend since the first of the month
-- (UTC). A rerun or backfill is refused once it is spent; the worker refuses each pull that would pass the run
-- cap or the month cap before it starts the pull.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. What this file stands on, then the drift guard on this file's own functions (a second apply, or a later
--    file that changed one of them).

DO $$
BEGIN
  IF to_regprocedure('public.cockpit_form_stage4_fields(text)') IS NULL
     OR to_regprocedure('public.cockpit_form_stage4_typeform_answers(text,jsonb)') IS NULL
     OR to_regprocedure('public.cockpit_is_ceo()') IS NULL
     OR to_regprocedure('public.cockpit_has_role(text)') IS NULL
     OR to_regprocedure('public.cockpit_csm_client_gate(text)') IS NULL
     OR to_regclass('public.cockpit_form_responses') IS NULL
     OR to_regclass('public.cockpit_client_onboarding') IS NULL
     OR to_regclass('public.cockpit_settings') IS NULL
     OR to_regclass('public.cockpit_audit_log') IS NULL
     OR to_regclass('public.cockpit_members') IS NULL THEN
    RAISE EXCEPTION 'Apply 20261102o before 20261103i.' USING ERRCODE = '55000';
  END IF;
END $$;

DO $$
DECLARE g record; v_now text;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('public.cockpit_market_intel_audit(text,uuid,text,jsonb,jsonb,jsonb)', 'b4e06e56ae20184e58f98ca0fdb4152e'),
      ('public.cockpit_market_intel_setting_audit()', '3b7c46acde1fb5dc5747344c96d60741'),
      ('public.cockpit_market_intel_settings()', '7520bc2afc59754be5fc85fb1d2f61c0'),
      ('public.cockpit_market_intel_month_usd()', '7511f880cc105635f3e037fa54453b2e'),
      ('public.cockpit_market_intel_effect()', '651533f6b06746eed8ec80aee757367a'),
      ('public.cockpit_market_intel_answers(uuid)', '5cde6fe7ee27cd3a07d8dcf612720fd8'),
      ('public.cockpit_market_intel_enqueue(text,uuid,text,text,text)', 'f94620917fc2ccc6921f456a9f8f305e'),
      ('public.cockpit_market_intel_scan(integer)', 'ba7799148a1a867a91047521eebfadc2'),
      ('public.cockpit_market_intel_claim(text,integer)', '85f51dd08281ec0efa2b7227819a8b05'),
      ('public.cockpit_market_intel_lease(uuid,uuid)', 'a1d40f316ebdd24ad4f32f4866ca05e0'),
      ('public.cockpit_market_intel_progress(uuid,uuid,text,jsonb,jsonb)', '40ea4558b55b26d8535f6e7d3312407f'),
      ('public.cockpit_market_intel_store(uuid,uuid,text,jsonb)', 'e811ae81d49231f3a4356658c8965998'),
      ('public.cockpit_market_intel_release(uuid,uuid,text,integer,text)', 'aa2072f01110f5a2958d365e32b5f872'),
      ('public.cockpit_market_intel_done(uuid,uuid,text,text,jsonb)', '0ec65beefae41cc60b4c5d953fbe9122'),
      ('public.cockpit_market_intel_input_core(text,uuid)', '9b180fca1a23d1cba08aa9449e4b9606'),
      ('public.cockpit_market_intel_preview(text)', 'ee64c850965676fec7771bcf1a9019b2'),
      ('public.cockpit_market_intel_input(uuid)', '1d578085299d235a5893b3bed3152022'),
      ('public.cockpit_market_intel_nap(uuid,text)', '8a84777cf0dabb8dc32a585575ba4dfe'),
      ('public.cockpit_market_intel_prune(integer)', '3f6685b2e0fbf85ca3b18f9bb2228550'),
      ('public.cockpit_market_intel_seat()', '8188360c368925939781f6a9cf2e5755'),
      ('public.cockpit_market_intel_view(text)', '1002d2c204870e6c42c3b7627be2cc1d'),
      ('public.cockpit_market_intel_rerun(text,text)', '5cc4b1f39de3d5923f3486a16f73da74'),
      ('public.cockpit_market_intel_flag_competitor(uuid,text,text)', '4fa3eb3efd1151f74913c6311b4b75c4')
    ) AS x(fn, after_md5)
  LOOP
    v_now := NULL;
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_now
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(g.fn);
    IF v_now IS NOT NULL AND v_now <> g.after_md5 THEN
      RAISE EXCEPTION '% changed since 20261103i; stop and re-read it.', replace(g.fn, 'public.', '')
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Tables

CREATE TABLE IF NOT EXISTS public.cockpit_market_intel_runs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id                text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  response_id            uuid NOT NULL REFERENCES public.cockpit_form_responses(id),
  reason                 text NOT NULL CHECK (reason IN ('onboarding','shadow','rerun','backfill','kickoff_refresh')),
  mode                   text NOT NULL DEFAULT 'shadow' CHECK (mode IN ('shadow','live')),
  state                  text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','claimed','pulling','picking','writing',
                           'checking','publishing','done','needs_person','failed','cancelled')),
  claim                  uuid,
  claim_until            timestamptz,
  claimed_by             text CHECK (claimed_by IS NULL OR char_length(claimed_by) <= 120),
  attempts               integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- Releases for an outage (not tries), and when the first of them was: 24 hours after it, a person is asked.
  outages                integer NOT NULL DEFAULT 0 CHECK (outages >= 0),
  outage_since           timestamptz,
  not_before             timestamptz,
  -- Ids and states only: pull keys, Apify run ids and each finished run's cost, evidence ids, stage names. Never
  -- a body or an answer.
  stage_progress         jsonb NOT NULL DEFAULT '{}'::jsonb
                           CHECK (jsonb_typeof(stage_progress) = 'object' AND octet_length(stage_progress::text) <= 262144),
  usd_apify              numeric(10,4) NOT NULL DEFAULT 0 CHECK (usd_apify >= 0),
  usd_scrapecreators     numeric(10,4) NOT NULL DEFAULT 0 CHECK (usd_scrapecreators >= 0),
  credits_scrapecreators integer NOT NULL DEFAULT 0 CHECK (credits_scrapecreators >= 0),
  credits_foreplay       integer NOT NULL DEFAULT 0 CHECK (credits_foreplay >= 0),
  model_usage            jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(model_usage) = 'object'),
  sources_n              integer CHECK (sources_n IS NULL OR sources_n >= 0),
  competitors_n          integer CHECK (competitors_n IS NULL OR competitors_n >= 0),
  doc_id                 text,
  doc_url                text CHECK (doc_url IS NULL OR doc_url ~ '^https://docs\.google\.com/document/d/'),
  field_state            text CHECK (field_state IS NULL OR field_state IN ('written','kept','not_due')),
  comment_id             text,
  kb_state               text,
  sentence               text CHECK (sentence IS NULL OR char_length(sentence) BETWEEN 1 AND 600),
  requested_by           text NOT NULL CHECK (char_length(btrim(requested_by)) BETWEEN 1 AND 200),
  request_note           text CHECK (request_note IS NULL OR char_length(request_note) <= 300),
  requested_at           timestamptz NOT NULL DEFAULT now(),
  started_at             timestamptz,
  finished_at            timestamptz,
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_market_intel_runs_one_open
  ON public.cockpit_market_intel_runs(task_id)
  WHERE state IN ('queued','claimed','pulling','picking','writing','checking','publishing');
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_market_intel_runs_one_per_answer
  ON public.cockpit_market_intel_runs(task_id, response_id)
  WHERE reason IN ('onboarding','shadow');
CREATE INDEX IF NOT EXISTS cockpit_market_intel_runs_state ON public.cockpit_market_intel_runs(state, requested_at);
CREATE INDEX IF NOT EXISTS cockpit_market_intel_runs_task ON public.cockpit_market_intel_runs(task_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS public.cockpit_market_intel_evidence (
  run_id       uuid NOT NULL REFERENCES public.cockpit_market_intel_runs(id),
  eid          text NOT NULL CHECK (eid ~ '^E[0-9]{1,4}$'),
  kind         text NOT NULL CHECK (kind IN ('maps_place','review','serp','web_page','ig_profile','fb_page','ad','tiktok',
                 'snap','blueprint','form','nap')),
  -- client, market (a search with no single subject), K<n> a candidate, C<n> a picked competitor.
  subject      text NOT NULL CHECK (subject ~ '^(client|market|K[0-9]{1,3}|C[0-9]{1,2})$'),
  url          text CHECK (url IS NULL OR (url ~ '^https?://' AND char_length(url) <= 2048)),
  retrieved_at timestamptz NOT NULL,
  source       text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 120),
  usd          numeric(10,5) NOT NULL DEFAULT 0 CHECK (usd >= 0),
  body         jsonb CHECK (body IS NULL OR octet_length(body::text) <= 65536),
  sha256       text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  pruned_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, eid)
);

CREATE TABLE IF NOT EXISTS public.cockpit_market_intel_findings (
  run_id         uuid NOT NULL REFERENCES public.cockpit_market_intel_runs(id),
  lang           text NOT NULL CHECK (lang IN ('en','ar')),
  findings       jsonb NOT NULL CHECK (jsonb_typeof(findings) = 'object' AND octet_length(findings::text) <= 1048576),
  checks         jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(checks) = 'object'),
  schema_version text NOT NULL CHECK (char_length(schema_version) BETWEEN 1 AND 40),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, lang)
);

CREATE TABLE IF NOT EXISTS public.cockpit_market_intel_competitors (
  run_id           uuid NOT NULL REFERENCES public.cockpit_market_intel_runs(id),
  cid              text NOT NULL CHECK (cid ~ '^C[0-9]{1,2}$'),
  reserve          boolean NOT NULL DEFAULT false,
  name             text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  place_url        text CHECK (place_url IS NULL OR (place_url ~ '^https://' AND char_length(place_url) <= 2048)),
  website          text CHECK (website IS NULL OR (website ~ '^https?://' AND char_length(website) <= 2048)),
  instagram        text CHECK (instagram IS NULL OR char_length(instagram) <= 200),
  facebook_page_id text CHECK (facebook_page_id IS NULL OR facebook_page_id ~ '^[0-9]{1,30}$'),
  -- NULL is "not checked", never zero.
  rating           numeric(3,2) CHECK (rating IS NULL OR (rating >= 0 AND rating <= 5)),
  reviews_n        integer CHECK (reviews_n IS NULL OR reviews_n >= 0),
  ads_active_n     integer CHECK (ads_active_n IS NULL OR ads_active_n >= 0),
  longest_ad_days  integer CHECK (longest_ad_days IS NULL OR longest_ad_days >= 0),
  why              text CHECK (why IS NULL OR char_length(why) <= 600),
  evidence         text[] NOT NULL DEFAULT '{}'::text[],
  flagged_wrong_by text,
  flagged_at       timestamptz,
  flag_reason      text CHECK (flag_reason IS NULL OR char_length(flag_reason) <= 300),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, cid)
);

ALTER TABLE public.cockpit_market_intel_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_market_intel_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_market_intel_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_market_intel_competitors ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_market_intel_runs, public.cockpit_market_intel_evidence,
  public.cockpit_market_intel_findings, public.cockpit_market_intel_competitors
  FROM PUBLIC, anon, authenticated, service_role;
-- The worker, the guardian and the cockpit's edge function read with the service key; every write goes
-- through the functions below (owner-run, audited).
GRANT SELECT ON public.cockpit_market_intel_runs, public.cockpit_market_intel_evidence,
  public.cockpit_market_intel_findings, public.cockpit_market_intel_competitors TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Small helpers (internal)

-- One audit row. Never an answer, a body or a contact value: ids, states, counts and sentences.
CREATE OR REPLACE FUNCTION public.cockpit_market_intel_audit(p_action text, p_run uuid, p_actor text, p_before jsonb,
  p_after jsonb, p_meta jsonb)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before,
    after, metadata)
  VALUES (p_action, 'cockpit_market_intel_runs', p_run::text, coalesce(nullif(btrim(p_actor), ''), 'market-intel'),
          'client-success', 'market-intel', p_before, p_after, coalesce(p_meta, '{}'::jsonb));
END $$;

-- Every change to the market_intel setting (on, mode, the caps, the publish brakes) writes an audit row with the
-- value before and after. Attached after the seed (section 8); the live trigger for the forms and billing
-- settings is not touched. Who: cockpit.audit_actor when the session sets it, else updated_by when the change
-- sets it, else the database role.
CREATE OR REPLACE FUNCTION public.cockpit_market_intel_setting_audit()
RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_key text := CASE TG_OP WHEN 'DELETE' THEN OLD.key ELSE NEW.key END;
  v_by text := CASE TG_OP
                 WHEN 'INSERT' THEN NEW.updated_by
                 WHEN 'UPDATE' THEN CASE WHEN NEW.updated_by IS DISTINCT FROM OLD.updated_by THEN NEW.updated_by END
               END;
BEGIN
  IF v_key IS DISTINCT FROM 'market_intel' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.value IS NOT DISTINCT FROM OLD.value THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before,
    after, metadata)
  VALUES ('market_intel.setting_' || CASE TG_OP WHEN 'INSERT' THEN 'added' WHEN 'UPDATE' THEN 'set' ELSE 'removed' END,
          'cockpit_settings', v_key,
          coalesce(nullif(current_setting('cockpit.audit_actor', true), ''), nullif(btrim(v_by), ''), session_user::text),
          'client-success', 'supabase',
          CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN jsonb_build_object('value', OLD.value) END,
          CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN jsonb_build_object('value', NEW.value) END,
          jsonb_build_object('op', lower(TG_OP), 'key', v_key));
  RETURN NULL;
END $$;

-- The setting with its defaults, each key typed. A missing or odd value falls back to the safe default
-- (off, shadow, nothing applied).
CREATE OR REPLACE FUNCTION public.cockpit_market_intel_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb; v_run numeric; v_month numeric;
BEGIN
  SELECT s.value INTO v FROM public.cockpit_settings s WHERE s.key = 'market_intel';
  IF jsonb_typeof(v) IS DISTINCT FROM 'object' THEN
    v := '{}'::jsonb;
  END IF;
  v_run := CASE WHEN jsonb_typeof(v->'usd_cap_run') = 'number' THEN (v->>'usd_cap_run')::numeric END;
  v_month := CASE WHEN jsonb_typeof(v->'usd_cap_month') = 'number' THEN (v->>'usd_cap_month')::numeric END;
  RETURN jsonb_build_object(
    'on', coalesce(v->'on' = 'true'::jsonb, false),
    'mode', CASE WHEN v->>'mode' = 'live' THEN 'live' ELSE 'shadow' END,
    'apply_drive', coalesce(v->'apply_drive' = 'true'::jsonb, false),
    'apply_clickup', coalesce(v->'apply_clickup' = 'true'::jsonb, false),
    'apply_kb', coalesce(v->'apply_kb' = 'true'::jsonb, false),
    'only_cards', CASE WHEN jsonb_typeof(v->'only_cards') = 'array' THEN v->'only_cards' ELSE '[]'::jsonb END,
    'usd_cap_run', CASE WHEN v_run > 0 AND v_run <= 20 THEN v_run ELSE 2 END,
    'usd_cap_month', CASE WHEN v_month > 0 AND v_month <= 500 THEN v_month ELSE 25 END,
    'refresh_on_kickoff', coalesce(v->'refresh_on_kickoff' = 'true'::jsonb, false),
    'shadow_since', v->'shadow_since');
END $$;

-- What this month's runs have spent on scraping (Apify plus ScrapeCreators), since the first of the month UTC.
CREATE OR REPLACE FUNCTION public.cockpit_market_intel_month_usd()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(sum(r.usd_apify + r.usd_scrapecreators), 0)::numeric
    FROM public.cockpit_market_intel_runs r
   WHERE r.requested_at >= (date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
$$;

-- The effect, catalogued for the cutover migration (D-S4O). It is not in cockpit_form_stage4_effects or any
-- registry row until then.
CREATE OR REPLACE FUNCTION public.cockpit_market_intel_effect()
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT '{"key":"market_intel","label":"Market research","owner":"cockpit","delivery":"sql"}'::jsonb
$$;

-- One stored onboarding answer in the Typeform shape [{ref, title, value}], whatever door it came through.
CREATE OR REPLACE FUNCTION public.cockpit_market_intel_answers(p_response_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cockpit_form_responses;
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  IF r.id IS NULL OR r.form_key IS DISTINCT FROM 'onboarding' THEN
    RETURN '[]'::jsonb;
  END IF;
  IF jsonb_typeof(r.answers->'fields') = 'array' THEN
    RETURN r.answers->'fields';
  END IF;
  RETURN coalesce(public.cockpit_form_stage4_typeform_answers('onboarding', r.answers), '[]'::jsonb);
END $$;

-- ---------------------------------------------------------------------------
-- 3. The queue (service_role)

CREATE OR REPLACE FUNCTION public.cockpit_market_intel_enqueue(p_task_id text, p_response_id uuid, p_reason text,
  p_by text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.cockpit_form_responses;
  v_set jsonb := public.cockpit_market_intel_settings();
  v_month numeric;
  v_cap numeric;
  v_id uuid;
  v_open uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
BEGIN
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('onboarding','shadow','rerun','backfill','kickoff_refresh') THEN
    RAISE EXCEPTION 'A research run starts from the onboarding form, a shadow scan, a rerun, a backfill or a kickoff refresh.'
      USING ERRCODE = '22023';
  END IF;
  IF p_by IS NULL OR char_length(btrim(p_by)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Say who asked for this run.' USING ERRCODE = '22023';
  END IF;
  IF p_reason IN ('rerun','backfill') AND (v_note IS NULL OR char_length(v_note) NOT BETWEEN 10 AND 300) THEN
    RETURN jsonb_build_object('ok', false, 'sentence', 'Give a reason of 10 to 300 characters.');
  END IF;
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  IF r.id IS NULL OR r.form_key IS DISTINCT FROM 'onboarding' OR r.task_id IS DISTINCT FROM p_task_id
     OR r.state NOT IN ('submitted','confirmed') THEN
    RETURN jsonb_build_object('ok', false, 'sentence', 'That is not a submitted onboarding answer on this card.');
  END IF;
  IF r.mode IS DISTINCT FROM 'live' AND p_task_id <> '86eywg1cq' THEN
    RETURN jsonb_build_object('ok', false, 'sentence', 'That onboarding answer is not live, so it is not researched.');
  END IF;
  IF p_reason IN ('onboarding','shadow') THEN
    SELECT x.id INTO v_id FROM public.cockpit_market_intel_runs x
     WHERE x.task_id = p_task_id AND x.response_id = p_response_id AND x.reason IN ('onboarding','shadow');
    IF v_id IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'runId', v_id, 'reused', true);
    END IF;
  END IF;
  SELECT x.id INTO v_open FROM public.cockpit_market_intel_runs x
   WHERE x.task_id = p_task_id AND x.state IN ('queued','claimed','pulling','picking','writing','checking','publishing');
  IF v_open IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'runId', v_open, 'open', true,
      'sentence', 'Research is already running for this client. Wait for it to finish.');
  END IF;
  IF p_reason IN ('rerun','backfill','kickoff_refresh') THEN
    v_month := public.cockpit_market_intel_month_usd();
    v_cap := (v_set->>'usd_cap_month')::numeric;
    IF v_month >= v_cap THEN
      RETURN jsonb_build_object('ok', false, 'sentence', format(
        'This month''s research budget is spent (USD %s of %s). Raise usd_cap_month or wait for the 1st.',
        to_char(v_month, 'FM999990.00'), to_char(v_cap, 'FM999990.00')));
    END IF;
  END IF;
  BEGIN
    INSERT INTO public.cockpit_market_intel_runs(task_id, response_id, reason, mode, requested_by, request_note)
    VALUES (p_task_id, p_response_id, p_reason, v_set->>'mode', btrim(p_by), v_note)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT x.id INTO v_id FROM public.cockpit_market_intel_runs x
     WHERE x.task_id = p_task_id AND (x.state IN ('queued','claimed','pulling','picking','writing','checking','publishing')
           OR (x.response_id = p_response_id AND x.reason IN ('onboarding','shadow')))
     ORDER BY x.requested_at DESC LIMIT 1;
    RETURN jsonb_build_object('ok', p_reason IN ('onboarding','shadow'), 'runId', v_id, 'reused', true,
      'sentence', 'Research is already running for this client. Wait for it to finish.');
  END;
  PERFORM public.cockpit_market_intel_audit('market_intel.enqueued', v_id, p_by, NULL,
    jsonb_build_object('state', 'queued', 'reason', p_reason, 'mode', v_set->>'mode'),
    jsonb_build_object('taskId', p_task_id, 'responseId', p_response_id, 'noteChars', char_length(coalesce(v_note, ''))));
  RETURN jsonb_build_object('ok', true, 'runId', v_id, 'reused', false);
END $$;

-- Shadow (before the cutover): every live onboarding answer stored since the setting's shadow_since, with no
-- run yet, gets one. Nothing while the setting is off.
CREATE OR REPLACE FUNCTION public.cockpit_market_intel_scan(p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_set jsonb := public.cockpit_market_intel_settings();
  v_since timestamptz;
  r record;
  v_out jsonb;
  v_ids jsonb := '[]'::jsonb;
  v_waiting integer := 0;
BEGIN
  IF NOT (v_set->>'on')::boolean THEN
    RETURN jsonb_build_object('on', false, 'enqueued', 0, 'sentence', 'Market research is off (cockpit_settings market_intel).');
  END IF;
  BEGIN
    v_since := (v_set->>'shadow_since')::timestamptz;
  EXCEPTION WHEN OTHERS THEN
    v_since := NULL;
  END;
  IF v_since IS NULL THEN
    RETURN jsonb_build_object('on', true, 'enqueued', 0,
      'sentence', 'market_intel.shadow_since is not set, so no answer is scanned. Set it to the install time.');
  END IF;
  FOR r IN
    SELECT x.id, x.task_id FROM public.cockpit_form_responses x
     WHERE x.form_key = 'onboarding' AND x.task_id IS NOT NULL AND x.state IN ('submitted','confirmed')
       AND x.mode = 'live' AND x.submitted_at >= v_since
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_market_intel_runs m
                        WHERE m.task_id = x.task_id AND m.response_id = x.id AND m.reason IN ('onboarding','shadow'))
     ORDER BY x.submitted_at
     LIMIT greatest(1, least(coalesce(p_limit, 20), 100))
  LOOP
    v_out := public.cockpit_market_intel_enqueue(r.task_id, r.id,
      CASE WHEN v_set->>'mode' = 'live' THEN 'onboarding' ELSE 'shadow' END, 'market-intel scan', NULL);
    IF (v_out->>'ok')::boolean AND NOT coalesce((v_out->>'reused')::boolean, false) THEN
      v_ids := v_ids || jsonb_build_array(v_out->>'runId');
    ELSE
      v_waiting := v_waiting + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('on', true, 'enqueued', jsonb_array_length(v_ids), 'runIds', v_ids, 'waiting', v_waiting);
END $$;

-- One run at a time: the oldest lapsed lease first (a resume), else the oldest queued run. A run past three
-- tries ends failed with the last sentence.
CREATE OR REPLACE FUNCTION public.cockpit_market_intel_claim(p_worker text, p_lease_minutes integer DEFAULT 60)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_set jsonb := public.cockpit_market_intel_settings();
  r public.cockpit_market_intel_runs;
  v_busy uuid;
  v_claim uuid;
  v_lease integer := greatest(10, least(coalesce(p_lease_minutes, 60), 120));
  v_sentence text;
  i integer;
BEGIN
  IF p_worker IS NULL OR char_length(btrim(p_worker)) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Name the worker that claims.' USING ERRCODE = '22023';
  END IF;
  IF NOT (v_set->>'on')::boolean THEN
    RETURN jsonb_build_object('off', true, 'sentence', 'Market research is off (cockpit_settings market_intel).');
  END IF;
  SELECT x.id INTO v_busy FROM public.cockpit_market_intel_runs x
   WHERE x.state IN ('claimed','pulling','picking','writing','checking','publishing') AND x.claim_until > now()
   LIMIT 1;
  IF v_busy IS NOT NULL THEN
    RETURN jsonb_build_object('busy', true, 'runId', v_busy);
  END IF;
  FOR i IN 1..5 LOOP
    SELECT * INTO r FROM public.cockpit_market_intel_runs x
     WHERE (x.state = 'queued' AND (x.not_before IS NULL OR x.not_before <= now()))
        OR (x.state IN ('claimed','pulling','picking','writing','checking','publishing')
            AND (x.claim_until IS NULL OR x.claim_until <= now()))
     ORDER BY CASE WHEN x.state = 'queued' THEN 1 ELSE 0 END, x.requested_at
     LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF r.id IS NULL THEN
      RETURN jsonb_build_object('idle', true);
    END IF;
    IF r.attempts >= 3 THEN
      v_sentence := left('Research stopped after 3 tries. ' || coalesce(r.sentence, 'The last try left no sentence.'), 600);
      UPDATE public.cockpit_market_intel_runs SET state = 'failed', claim = NULL, claim_until = NULL,
             sentence = v_sentence, finished_at = now(), updated_at = now()
       WHERE id = r.id;
      PERFORM public.cockpit_market_intel_audit('market_intel.failed', r.id, p_worker,
        jsonb_build_object('state', r.state, 'attempts', r.attempts), jsonb_build_object('state', 'failed'),
        jsonb_build_object('why', 'three tries'));
      r := NULL;
      CONTINUE;
    END IF;
    v_claim := gen_random_uuid();
    UPDATE public.cockpit_market_intel_runs
       SET claim = v_claim, claim_until = now() + make_interval(mins => v_lease), claimed_by = btrim(p_worker),
           attempts = attempts + 1, state = CASE WHEN state = 'queued' THEN 'claimed' ELSE state END,
           started_at = coalesce(started_at, now()), not_before = NULL, updated_at = now()
     WHERE id = r.id
    RETURNING * INTO r;
    PERFORM public.cockpit_market_intel_audit('market_intel.claimed', r.id, p_worker, NULL,
      jsonb_build_object('state', r.state, 'attempts', r.attempts), jsonb_build_object('leaseMinutes', v_lease));
    RETURN jsonb_build_object('runId', r.id, 'taskId', r.task_id, 'responseId', r.response_id, 'reason', r.reason,
      'mode', r.mode, 'state', r.state, 'claim', v_claim, 'attempts', r.attempts, 'stageProgress', r.stage_progress,
      'spend', jsonb_build_object('usdApify', r.usd_apify, 'usdScrapeCreators', r.usd_scrapecreators,
                                  'creditsScrapeCreators', r.credits_scrapecreators),
      'monthUsd', public.cockpit_market_intel_month_usd(),
      'caps', jsonb_build_object('run', v_set->'usd_cap_run', 'month', v_set->'usd_cap_month'),
      'settings', v_set);
  END LOOP;
  RETURN jsonb_build_object('idle', true);
END $$;

-- The run, while this claim holds its lease. Anything else is refused (55000), so a second worker that lost
-- the lease cannot write.
CREATE OR REPLACE FUNCTION public.cockpit_market_intel_lease(p_run_id uuid, p_claim uuid)
RETURNS public.cockpit_market_intel_runs LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cockpit_market_intel_runs;
BEGIN
  SELECT * INTO r FROM public.cockpit_market_intel_runs x WHERE x.id = p_run_id FOR UPDATE;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'There is no research run with that ID.' USING ERRCODE = '22023';
  END IF;
  IF p_claim IS NULL OR r.claim IS DISTINCT FROM p_claim OR r.claim_until IS NULL OR r.claim_until <= now()
     OR r.state NOT IN ('claimed','pulling','picking','writing','checking','publishing') THEN
    RAISE EXCEPTION 'This run''s lease has lapsed or belongs to another worker. Stop and claim again.'
      USING ERRCODE = '55000';
  END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_market_intel_progress(p_run_id uuid, p_claim uuid, p_state text,
  p_progress jsonb, p_spend jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.cockpit_market_intel_runs := public.cockpit_market_intel_lease(p_run_id, p_claim);
  v_set jsonb := public.cockpit_market_intel_settings();
  v_spend jsonb := CASE WHEN jsonb_typeof(p_spend) = 'object' THEN p_spend ELSE '{}'::jsonb END;
  v_apify numeric;
  v_sc numeric;
  v_credits integer;
  v_fp integer;
BEGIN
  IF p_state IS NOT NULL AND p_state NOT IN ('pulling','picking','writing','checking','publishing') THEN
    RAISE EXCEPTION 'A run in progress is pulling, picking, writing, checking or publishing.' USING ERRCODE = '22023';
  END IF;
  IF p_progress IS NOT NULL AND jsonb_typeof(p_progress) <> 'object' THEN
    RAISE EXCEPTION 'Progress is an object of ids and states.' USING ERRCODE = '22023';
  END IF;
  v_apify := CASE WHEN jsonb_typeof(v_spend->'usdApify') = 'number' THEN (v_spend->>'usdApify')::numeric END;
  v_sc := CASE WHEN jsonb_typeof(v_spend->'usdScrapeCreators') = 'number' THEN (v_spend->>'usdScrapeCreators')::numeric END;
  v_credits := CASE WHEN jsonb_typeof(v_spend->'creditsScrapeCreators') = 'number'
                    THEN (v_spend->>'creditsScrapeCreators')::numeric::integer END;
  v_fp := CASE WHEN jsonb_typeof(v_spend->'creditsForeplay') = 'number' THEN (v_spend->>'creditsForeplay')::numeric::integer END;
  IF coalesce(v_apify, 0) < 0 OR coalesce(v_sc, 0) < 0 OR coalesce(v_credits, 0) < 0 OR coalesce(v_fp, 0) < 0 THEN
    RAISE EXCEPTION 'Spend is never negative.' USING ERRCODE = '22023';
  END IF;
  -- Spend is cumulative for the run and never goes down (a resume reports what it already knew).
  UPDATE public.cockpit_market_intel_runs
     SET state = coalesce(p_state, state),
         stage_progress = stage_progress || coalesce(p_progress, '{}'::jsonb),
         usd_apify = greatest(usd_apify, coalesce(v_apify, 0)),
         usd_scrapecreators = greatest(usd_scrapecreators, coalesce(v_sc, 0)),
         credits_scrapecreators = greatest(credits_scrapecreators, coalesce(v_credits, 0)),
         credits_foreplay = greatest(credits_foreplay, coalesce(v_fp, 0)),
         model_usage = model_usage || CASE WHEN jsonb_typeof(v_spend->'modelUsage') = 'object' THEN v_spend->'modelUsage'
                                           ELSE '{}'::jsonb END,
         claim_until = now() + interval '60 minutes', updated_at = now()
   WHERE id = r.id
  RETURNING * INTO r;
  PERFORM public.cockpit_market_intel_audit('market_intel.progress', r.id, r.claimed_by, NULL,
    jsonb_build_object('state', r.state, 'usdApify', r.usd_apify, 'usdScrapeCreators', r.usd_scrapecreators),
    jsonb_build_object('keys', (SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb)
                                  FROM jsonb_object_keys(coalesce(p_progress, '{}'::jsonb)) k)));
  -- The switch and the caps as they are now: off stops the run before its next pull, a lowered cap applies next.
  RETURN jsonb_build_object('ok', true, 'state', r.state, 'on', v_set->'on',
    'runUsd', r.usd_apify + r.usd_scrapecreators, 'monthUsd', public.cockpit_market_intel_month_usd(),
    'caps', jsonb_build_object('run', v_set->'usd_cap_run', 'month', v_set->'usd_cap_month'));
END $$;

-- Evidence (insert once, never rewritten: a resume finds it there), findings per language and competitors
-- (upserted; a person's "Not a competitor" flag is kept).
CREATE OR REPLACE FUNCTION public.cockpit_market_intel_store(p_run_id uuid, p_claim uuid, p_kind text, p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.cockpit_market_intel_runs := public.cockpit_market_intel_lease(p_run_id, p_claim);
  e jsonb;
  v_n integer := 0;
  v_in integer := 0;
  v_rows integer;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('evidence','findings','competitors') THEN
    RAISE EXCEPTION 'Store evidence, findings or competitors.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows) > 200 THEN
    RAISE EXCEPTION 'Store at most 200 rows at a time, as an array.' USING ERRCODE = '22023';
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(p_rows) x LOOP
    v_n := v_n + 1;
    IF jsonb_typeof(e) <> 'object' THEN
      RAISE EXCEPTION 'Row % is not an object.', v_n USING ERRCODE = '22023';
    END IF;
    IF p_kind = 'evidence' THEN
      -- A review never names its reviewer (dropped at pull time; refused here as well).
      IF e->>'kind' = 'review' AND jsonb_typeof(e->'body') = 'object'
         AND (e->'body') ?| ARRAY['name','reviewer','reviewerName','reviewerId','reviewerUrl','reviewerPhotoUrl',
                                   'author','authorName','userName','profileUrl'] THEN
        RAISE EXCEPTION 'Evidence % is a review that names its reviewer. Drop the reviewer and store it again.', e->>'eid'
          USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.cockpit_market_intel_evidence(run_id, eid, kind, subject, url, retrieved_at, source, usd, body, sha256)
      VALUES (r.id, e->>'eid', e->>'kind', e->>'subject', nullif(e->>'url', ''), (e->>'retrievedAt')::timestamptz,
              e->>'source', coalesce((e->>'usd')::numeric, 0),
              CASE WHEN jsonb_typeof(e->'body') IN ('object','array') THEN e->'body' END, e->>'sha256')
      ON CONFLICT (run_id, eid) DO NOTHING;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_in := v_in + v_rows;
    ELSIF p_kind = 'findings' THEN
      INSERT INTO public.cockpit_market_intel_findings(run_id, lang, findings, checks, schema_version)
      VALUES (r.id, e->>'lang', e->'findings', coalesce(e->'checks', '{}'::jsonb), e->>'schemaVersion')
      ON CONFLICT (run_id, lang) DO UPDATE
        SET findings = excluded.findings, checks = excluded.checks, schema_version = excluded.schema_version,
            updated_at = now();
      v_in := v_in + 1;
    ELSE
      INSERT INTO public.cockpit_market_intel_competitors(run_id, cid, reserve, name, place_url, website, instagram,
        facebook_page_id, rating, reviews_n, ads_active_n, longest_ad_days, why, evidence)
      VALUES (r.id, e->>'cid', coalesce((e->>'reserve')::boolean, false), e->>'name', nullif(e->>'placeUrl', ''),
              nullif(e->>'website', ''), nullif(e->>'instagram', ''), nullif(e->>'facebookPageId', ''),
              (e->>'rating')::numeric, (e->>'reviewsN')::integer, (e->>'adsActiveN')::integer,
              (e->>'longestAdDays')::integer, left(e->>'why', 600),
              coalesce(ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(e->'evidence') = 'array'
                                                                   THEN e->'evidence' ELSE '[]'::jsonb END)), '{}'::text[]))
      ON CONFLICT (run_id, cid) DO UPDATE
        SET reserve = excluded.reserve, name = excluded.name, place_url = excluded.place_url,
            website = excluded.website, instagram = excluded.instagram, facebook_page_id = excluded.facebook_page_id,
            rating = excluded.rating, reviews_n = excluded.reviews_n, ads_active_n = excluded.ads_active_n,
            longest_ad_days = excluded.longest_ad_days, why = excluded.why, evidence = excluded.evidence,
            updated_at = now();
      v_in := v_in + 1;
    END IF;
  END LOOP;
  UPDATE public.cockpit_market_intel_runs SET claim_until = now() + interval '60 minutes', updated_at = now()
   WHERE id = r.id;
  PERFORM public.cockpit_market_intel_audit('market_intel.stored', r.id, r.claimed_by, NULL, NULL,
    jsonb_build_object('kind', p_kind, 'rows', v_n, 'written', v_in));
  RETURN jsonb_build_object('ok', true, 'rows', v_n, 'written', v_in);
END $$;

-- Back to the queue: the evidence stays, the next claim resumes after the wait. p_kind says why:
--   error   an unexpected error; the claim counted it as a try (three end the run failed).
--   outage  the engine is down or the month's spend could not be read: not a try (the claim's is given back);
--           the wait doubles with each outage up to 4 hours, and 24 hours after the first outage the run ends
--           needs_person with the sentence (a person fixes the engine and runs research again).
--   paused  market research was turned off mid-run: not a try, and the outage clock starts again.
CREATE OR REPLACE FUNCTION public.cockpit_market_intel_release(p_run_id uuid, p_claim uuid, p_sentence text,
  p_retry_minutes integer DEFAULT 30, p_kind text DEFAULT 'error')
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.cockpit_market_intel_runs := public.cockpit_market_intel_lease(p_run_id, p_claim);
  v_kind text := coalesce(p_kind, 'error');
  v_retry integer := greatest(5, least(coalesce(p_retry_minutes, 30), 1440));
  v_sentence text;
  v_from text;
BEGIN
  v_from := r.state;
  IF p_sentence IS NULL OR char_length(btrim(p_sentence)) NOT BETWEEN 1 AND 600 THEN
    RAISE EXCEPTION 'Say in one sentence why the run waits.' USING ERRCODE = '22023';
  END IF;
  IF v_kind NOT IN ('error','outage','paused') THEN
    RAISE EXCEPTION 'A run waits after an error, an outage or a pause.' USING ERRCODE = '22023';
  END IF;
  IF v_kind = 'outage' AND r.outage_since IS NOT NULL AND r.outage_since <= now() - interval '24 hours' THEN
    v_sentence := left('Research waited 24 hours and stopped: ' || btrim(p_sentence)
                       || ' Fix it, then run research again from the cockpit.', 600);
    UPDATE public.cockpit_market_intel_runs
       SET state = 'needs_person', claim = NULL, claim_until = NULL, not_before = NULL, sentence = v_sentence,
           attempts = greatest(attempts - 1, 0), outages = outages + 1, finished_at = now(), updated_at = now()
     WHERE id = r.id;
    PERFORM public.cockpit_market_intel_audit('market_intel.needs_person', r.id, r.claimed_by,
      jsonb_build_object('state', r.state), jsonb_build_object('state', 'needs_person'),
      jsonb_build_object('why', 'outage for 24 hours', 'outages', r.outages + 1, 'attempts', r.attempts));
    RETURN jsonb_build_object('ok', true, 'state', 'needs_person', 'sentence', v_sentence);
  END IF;
  IF v_kind = 'outage' THEN
    v_retry := greatest(v_retry, least(240, v_retry * (2 ^ least(r.outages, 3))::integer));
  END IF;
  UPDATE public.cockpit_market_intel_runs
     SET state = 'queued', claim = NULL, claim_until = NULL, not_before = now() + make_interval(mins => v_retry),
         sentence = btrim(p_sentence),
         attempts = CASE WHEN v_kind = 'error' THEN attempts ELSE greatest(attempts - 1, 0) END,
         outages = outages + CASE WHEN v_kind = 'outage' THEN 1 ELSE 0 END,
         outage_since = CASE v_kind WHEN 'outage' THEN coalesce(outage_since, now()) WHEN 'paused' THEN NULL
                                    ELSE outage_since END,
         updated_at = now()
   WHERE id = r.id
  RETURNING * INTO r;
  PERFORM public.cockpit_market_intel_audit('market_intel.released', r.id, r.claimed_by,
    jsonb_build_object('state', v_from), jsonb_build_object('state', 'queued'),
    jsonb_build_object('kind', v_kind, 'retryMinutes', v_retry, 'attempts', r.attempts, 'outages', r.outages));
  RETURN jsonb_build_object('ok', true, 'state', 'queued', 'retryMinutes', v_retry);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_market_intel_done(p_run_id uuid, p_claim uuid, p_state text, p_sentence text,
  p_summary jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.cockpit_market_intel_runs := public.cockpit_market_intel_lease(p_run_id, p_claim);
  v jsonb := CASE WHEN jsonb_typeof(p_summary) = 'object' THEN p_summary ELSE '{}'::jsonb END;
BEGIN
  IF p_state IS NULL OR p_state NOT IN ('done','needs_person','failed','cancelled') THEN
    RAISE EXCEPTION 'A run ends done, needs_person, failed or cancelled.' USING ERRCODE = '22023';
  END IF;
  IF p_sentence IS NULL OR char_length(btrim(p_sentence)) NOT BETWEEN 1 AND 600 THEN
    RAISE EXCEPTION 'Say in one sentence how the run ended.' USING ERRCODE = '22023';
  END IF;
  IF r.mode = 'shadow' AND (nullif(v->>'docUrl', '') IS NOT NULL OR nullif(v->>'commentId', '') IS NOT NULL
                            OR coalesce(v->>'fieldState', 'not_due') <> 'not_due') THEN
    RAISE EXCEPTION 'A shadow run publishes nothing: no Doc, no card field, no comment.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.cockpit_market_intel_runs
     SET state = p_state, sentence = btrim(p_sentence), claim = NULL, claim_until = NULL, finished_at = now(),
         sources_n = CASE WHEN jsonb_typeof(v->'sourcesN') = 'number' THEN (v->>'sourcesN')::integer ELSE sources_n END,
         competitors_n = CASE WHEN jsonb_typeof(v->'competitorsN') = 'number' THEN (v->>'competitorsN')::integer
                              ELSE competitors_n END,
         doc_id = coalesce(nullif(v->>'docId', ''), doc_id), doc_url = coalesce(nullif(v->>'docUrl', ''), doc_url),
         field_state = coalesce(nullif(v->>'fieldState', ''), field_state, CASE WHEN p_state = 'done' THEN 'not_due' END),
         comment_id = coalesce(nullif(v->>'commentId', ''), comment_id), kb_state = coalesce(nullif(v->>'kbState', ''), kb_state),
         updated_at = now()
   WHERE id = r.id
  RETURNING * INTO r;
  PERFORM public.cockpit_market_intel_audit('market_intel.' || p_state, r.id, r.claimed_by, NULL,
    jsonb_build_object('state', r.state, 'sourcesN', r.sources_n, 'competitorsN', r.competitors_n,
                       'usd', r.usd_apify + r.usd_scrapecreators),
    jsonb_build_object('mode', r.mode, 'attempts', r.attempts));
  RETURN jsonb_build_object('ok', true, 'state', r.state);
END $$;

-- ---------------------------------------------------------------------------
-- 4. What the worker reads (service_role). Never the five contact answers.

-- The answer's research subset, its Onboarding Answers tab and the card's facts (internal; input and preview).
CREATE OR REPLACE FUNCTION public.cockpit_market_intel_input_core(p_task_id text, p_response_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  -- Full name, phone, email, front desk phone, personal phone (KFRCXPFx refs).
  c_contact constant text[] := ARRAY['533f14a0-712f-4de9-9ac7-67e1be6bc0c8','64f2fb80-b074-4017-b8b7-b7d549947e52',
    '7994f0d2-baeb-451b-983a-816290873a68','282dac48-5031-4acb-96b6-ea469e8a5a8b','09d2e62a-51d4-4665-a3a9-30f5279b71bc'];
  c_contact_keys constant text[] := ARRAY['fullName','phone','email','frontDeskPhone','personalPhone'];
  r public.cockpit_form_responses;
  o public.cockpit_client_onboarding;
  v_all jsonb;
  v_answers jsonb := '{}'::jsonb;
  v_tab jsonb := '[]'::jsonb;
  v_titles jsonb;
  s jsonb;
  a jsonb;
  v text;
  v_front text;
  v_country text;
  v_phone_country text;
  v_name text;
  v_service text;
  v_blueprint text;
  v_flagged jsonb;
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id AND x.task_id = p_task_id;
  IF r.id IS NULL THEN
    RAISE EXCEPTION 'That onboarding answer is not on this card.' USING ERRCODE = '22023';
  END IF;
  v_all := public.cockpit_market_intel_answers(r.id);
  -- The research subset, keyed by the form's own keys.
  FOR s IN SELECT x FROM jsonb_array_elements(public.cockpit_form_stage4_fields('onboarding')) x LOOP
    CONTINUE WHEN s->>'key' = ANY (c_contact_keys) OR s->>'typeformRef' = ANY (c_contact) OR s->>'key' = 'driveLink';
    SELECT nullif(btrim(e->>'value'), '') INTO v FROM jsonb_array_elements(v_all) e WHERE e->>'ref' = s->>'typeformRef' LIMIT 1;
    IF v IS NOT NULL THEN
      v_answers := v_answers || jsonb_build_object(s->>'key', left(v, 4000));
    END IF;
  END LOOP;
  -- The Onboarding Answers tab: every answer but the contact ones, in the stored order, under the form's titles.
  v_titles := (SELECT st.value->'fields' FROM public.cockpit_settings st WHERE st.key = 'onboarding.raw_titles');
  FOR a IN SELECT e FROM jsonb_array_elements(v_all) e LOOP
    CONTINUE WHEN a->>'ref' = ANY (c_contact) OR nullif(btrim(a->>'value'), '') IS NULL;
    v_tab := v_tab || jsonb_build_array(jsonb_build_object('ref', a->>'ref',
      'title', coalesce((SELECT t->>'title' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_titles) = 'array'
                                                                       THEN v_titles ELSE '[]'::jsonb END) t
                          WHERE t->>'ref' = a->>'ref' LIMIT 1), a->>'title'),
      'value', left(a->>'value', 4000)));
  END LOOP;
  -- The front desk phone stays here: only its country leaves, as a hint for the searches.
  SELECT e->>'value' INTO v_front FROM jsonb_array_elements(v_all) e WHERE e->>'ref' = '282dac48-5031-4acb-96b6-ea469e8a5a8b' LIMIT 1;
  v_front := regexp_replace(coalesce(v_front, ''), '[^0-9+]', '', 'g');
  v_phone_country := CASE
    WHEN v_front ~ '^(\+|00)965' THEN 'KW' WHEN v_front ~ '^(\+|00)966' THEN 'SA' WHEN v_front ~ '^(\+|00)971' THEN 'AE'
    WHEN v_front ~ '^(\+|00)974' THEN 'QA' WHEN v_front ~ '^(\+|00)973' THEN 'BH' WHEN v_front ~ '^(\+|00)968' THEN 'OM' END;
  SELECT * INTO o FROM public.cockpit_client_onboarding x WHERE x.clickup_task_id = p_task_id;
  IF to_regclass('public.cockpit_billing_accounts') IS NOT NULL THEN
    EXECUTE 'SELECT upper(btrim(a.country)), nullif(btrim(a.client_name), '''') FROM public.cockpit_billing_accounts a
              WHERE a.clickup_task_id = $1 LIMIT 1' INTO v_country, v_name USING p_task_id;
  END IF;
  v_country := CASE WHEN v_country = 'QT' THEN 'QA' WHEN v_country ~ '^[A-Z]{2}$' THEN v_country END;
  IF jsonb_typeof(o.forms->'kickoff'->'answers') = 'array' THEN
    SELECT nullif(btrim(e->>'value'), '') INTO v_service FROM jsonb_array_elements(o.forms->'kickoff'->'answers') e
     WHERE e->>'ref' = 'c0000001-0000-4000-8000-000000000007' LIMIT 1;
  END IF;
  IF to_regclass('public.cockpit_blueprints') IS NOT NULL THEN
    EXECUTE 'SELECT left(nullif(btrim(b.answers->>''competitors''), ''''), 1000) FROM public.cockpit_blueprints b
              WHERE b.task_id = $1 LIMIT 1' INTO v_blueprint USING p_task_id;
  END IF;
  SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('name', c.name, 'placeUrl', c.place_url, 'website', c.website)), '[]'::jsonb)
    INTO v_flagged
    FROM public.cockpit_market_intel_competitors c JOIN public.cockpit_market_intel_runs m ON m.id = c.run_id
   WHERE m.task_id = p_task_id AND c.flagged_wrong_by IS NOT NULL;
  RETURN jsonb_build_object(
    'taskId', p_task_id, 'responseId', r.id, 'source', r.source, 'formDate', to_char(r.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'answers', v_answers, 'tab', v_tab,
    'card', jsonb_build_object(
      'name', coalesce(nullif(btrim(o.client_name), ''), v_name, nullif(btrim(r.client_name), '')),
      'country', v_country, 'phoneCountry', v_phone_country,
      'drive', coalesce(o.links->>'drive_folder', o.links->>'drive'), 'website', o.links->>'website',
      'marketResearch', o.links->>'market_research', 'serviceAdvertised', v_service),
    'blueprintCompetitors', v_blueprint, 'notCompetitors', v_flagged);
END $$;

-- A run's input (service_role).
CREATE OR REPLACE FUNCTION public.cockpit_market_intel_input(p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE run public.cockpit_market_intel_runs;
BEGIN
  SELECT * INTO run FROM public.cockpit_market_intel_runs x WHERE x.id = p_run_id;
  IF run.id IS NULL THEN
    RAISE EXCEPTION 'There is no research run with that ID.' USING ERRCODE = '22023';
  END IF;
  RETURN public.cockpit_market_intel_input_core(run.task_id, run.response_id)
    || jsonb_build_object('runId', run.id, 'reason', run.reason, 'mode', run.mode);
END $$;

-- The same read for a card's newest live onboarding answer, with no run: the worker's dry run prints the pull
-- plan and its cost from it (service_role).
CREATE OR REPLACE FUNCTION public.cockpit_market_intel_preview(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_response uuid;
BEGIN
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;
  SELECT x.id INTO v_response FROM public.cockpit_form_responses x
   WHERE x.form_key = 'onboarding' AND x.task_id = p_task_id AND x.state IN ('submitted','confirmed')
     AND (x.mode = 'live' OR p_task_id = '86eywg1cq')
   ORDER BY x.submitted_at DESC NULLS LAST, x.created_at DESC LIMIT 1;
  IF v_response IS NULL THEN
    RAISE EXCEPTION 'This client has no onboarding answer to research yet.' USING ERRCODE = '22023';
  END IF;
  RETURN public.cockpit_market_intel_input_core(p_task_id, v_response) || jsonb_build_object('preview', true);
END $$;

-- Does the Maps listing's phone equal the front desk phone? match, differs or not_checked; never a number.
CREATE OR REPLACE FUNCTION public.cockpit_market_intel_nap(p_run_id uuid, p_listing_phone text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE run public.cockpit_market_intel_runs; v_front text; v_list text;
BEGIN
  SELECT * INTO run FROM public.cockpit_market_intel_runs x WHERE x.id = p_run_id;
  IF run.id IS NULL THEN
    RAISE EXCEPTION 'There is no research run with that ID.' USING ERRCODE = '22023';
  END IF;
  SELECT e->>'value' INTO v_front FROM jsonb_array_elements(public.cockpit_market_intel_answers(run.response_id)) e
   WHERE e->>'ref' = '282dac48-5031-4acb-96b6-ea469e8a5a8b' LIMIT 1;
  v_front := regexp_replace(coalesce(v_front, ''), '[^0-9]', '', 'g');
  v_list := regexp_replace(coalesce(p_listing_phone, ''), '[^0-9]', '', 'g');
  IF char_length(v_front) < 7 OR char_length(v_list) < 7 THEN
    RETURN 'not_checked';
  END IF;
  -- The last eight digits: Gulf local numbers are eight digits (Saudi nine), so a country code or a leading 0 on
  -- one side does not count as a difference.
  RETURN CASE WHEN right(v_front, 8) = right(v_list, 8) THEN 'match' ELSE 'differs' END;
END $$;

-- Raw bodies after p_days (180 by default); ids, URLs and hashes stay.
CREATE OR REPLACE FUNCTION public.cockpit_market_intel_prune(p_days integer DEFAULT 180)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_days integer := greatest(30, least(coalesce(p_days, 180), 3650)); v_n integer;
BEGIN
  UPDATE public.cockpit_market_intel_evidence SET body = NULL, pruned_at = now()
   WHERE body IS NOT NULL AND created_at < now() - make_interval(days => v_days);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    PERFORM public.cockpit_market_intel_audit('market_intel.pruned', NULL, 'market-intel prune', NULL, NULL,
      jsonb_build_object('rows', v_n, 'days', v_days));
  END IF;
  RETURN jsonb_build_object('ok', true, 'pruned', v_n, 'days', v_days);
END $$;

-- ---------------------------------------------------------------------------
-- 5. The cockpit (authenticated; gated here, reached through cockpit-csm-api)

-- The signed-in seat: roles, never a person's name.
CREATE OR REPLACE FUNCTION public.cockpit_market_intel_seat()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE m public.cockpit_members;
BEGIN
  SELECT cm.* INTO m FROM public.cockpit_members cm JOIN auth.users u ON u.id = cm.auth_user_id
   WHERE auth.uid() IS NOT NULL AND cm.auth_user_id = auth.uid() AND cm.active AND u.email_confirmed_at IS NOT NULL
     AND cm.email = lower(btrim(u.email))
   LIMIT 1;
  IF m.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Sign in to the cockpit first.' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('email', m.email, 'ceo', public.cockpit_is_ceo(), 'admin', 'admin' = ANY (m.roles),
    'csm', 'csm' = ANY (m.roles), 'creative', 'creative' = ANY (m.roles), 'mediaBuyer', 'media_buyer' = ANY (m.roles));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_market_intel_view(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb;
  v_lead boolean;
  v_set jsonb := public.cockpit_market_intel_settings();
  run public.cockpit_market_intel_runs;
  v_comp jsonb;
  v_en jsonb;
  v_sentence text;
BEGIN
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;
  v_seat := public.cockpit_market_intel_seat();
  v_lead := (v_seat->>'ceo')::boolean OR (v_seat->>'admin')::boolean;
  IF NOT v_lead THEN
    IF (v_seat->>'csm')::boolean THEN
      PERFORM public.cockpit_csm_client_gate(p_task_id);
    ELSIF NOT ((v_seat->>'creative')::boolean OR (v_seat->>'mediaBuyer')::boolean) THEN
      RAISE EXCEPTION 'Market research is open to client success, creative, media buying and the CEO.' USING ERRCODE = '42501';
    END IF;
  END IF;
  SELECT * INTO run FROM public.cockpit_market_intel_runs x WHERE x.task_id = p_task_id
   ORDER BY x.requested_at DESC LIMIT 1;
  IF run.id IS NULL THEN
    RETURN jsonb_build_object('state', 'none', 'on', v_set->'on', 'canRerun', v_lead,
      'sentence', CASE WHEN (v_set->>'on')::boolean
                       THEN 'No research yet. It starts by itself when the onboarding form arrives.'
                       ELSE 'No research yet. Market research is off; it starts once it is turned on.' END);
  END IF;
  v_sentence := CASE
    WHEN run.state = 'queued' AND run.sentence IS NOT NULL THEN run.sentence
    WHEN run.state = 'queued' THEN 'Waiting for its turn. One research run goes at a time.'
    WHEN run.state IN ('claimed','pulling','picking','writing','checking','publishing')
      THEN format('Researching since %s (Kuwait).', to_char(run.started_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'))
    WHEN run.state = 'needs_person' THEN 'Research needs a person: ' || coalesce(run.sentence, 'no sentence was saved.')
    ELSE coalesce(run.sentence, initcap(run.state)) END;
  SELECT coalesce(jsonb_agg(jsonb_build_object('cid', c.cid, 'reserve', c.reserve, 'name', c.name,
           'placeUrl', c.place_url, 'website', c.website, 'instagram', c.instagram, 'rating', c.rating,
           'reviewsN', c.reviews_n, 'adsActiveN', c.ads_active_n, 'longestAdDays', c.longest_ad_days, 'why', c.why,
           'evidence', to_jsonb(c.evidence), 'flagged', c.flagged_wrong_by IS NOT NULL, 'flagReason', c.flag_reason)
           ORDER BY c.reserve, c.cid), '[]'::jsonb)
    INTO v_comp FROM public.cockpit_market_intel_competitors c WHERE c.run_id = run.id;
  -- Findings only from a run that finished: a run that failed its checks keeps them for a person (check.json and
  -- the stored row), never for readers.
  IF run.state = 'done' THEN
    SELECT f.findings INTO v_en FROM public.cockpit_market_intel_findings f WHERE f.run_id = run.id AND f.lang = 'en';
  END IF;
  RETURN jsonb_build_object('state', run.state, 'on', v_set->'on', 'canRerun', v_lead,
    'run', jsonb_build_object('id', run.id, 'reason', run.reason, 'mode', run.mode, 'requestedAt', run.requested_at,
      'startedAt', run.started_at, 'finishedAt', run.finished_at, 'sourcesN', run.sources_n,
      'competitorsN', run.competitors_n, 'usd', run.usd_apify + run.usd_scrapecreators, 'docUrl', run.doc_url,
      'fieldState', run.field_state),
    'sentence', v_sentence, 'competitors', v_comp, 'findings', v_en,
    'budget', CASE WHEN v_lead THEN jsonb_build_object('monthUsd', public.cockpit_market_intel_month_usd(),
                                                       'capMonth', v_set->'usd_cap_month', 'capRun', v_set->'usd_cap_run') END);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_market_intel_rerun(p_task_id text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_market_intel_seat();
  v_set jsonb := public.cockpit_market_intel_settings();
  v_response uuid;
  v_out jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  IF NOT ((v_seat->>'ceo')::boolean OR (v_seat->>'admin')::boolean) THEN
    RAISE EXCEPTION 'Only the CEO or an admin can run research again.' USING ERRCODE = '42501';
  END IF;
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;
  IF NOT (v_set->>'on')::boolean THEN
    RAISE EXCEPTION 'Market research is off. Turn it on first (cockpit_settings market_intel).' USING ERRCODE = '55000';
  END IF;
  IF char_length(v_reason) NOT BETWEEN 10 AND 300 THEN
    RAISE EXCEPTION 'Give a reason of 10 to 300 characters.' USING ERRCODE = '22023';
  END IF;
  SELECT x.id INTO v_response FROM public.cockpit_form_responses x
   WHERE x.form_key = 'onboarding' AND x.task_id = p_task_id AND x.state IN ('submitted','confirmed')
     AND (x.mode = 'live' OR p_task_id = '86eywg1cq')
   ORDER BY x.submitted_at DESC NULLS LAST, x.created_at DESC LIMIT 1;
  IF v_response IS NULL THEN
    RAISE EXCEPTION 'This client has no onboarding answer to research yet.' USING ERRCODE = '22023';
  END IF;
  v_out := public.cockpit_market_intel_enqueue(p_task_id, v_response, 'rerun', v_seat->>'email', v_reason);
  IF NOT coalesce((v_out->>'ok')::boolean, false) THEN
    RAISE EXCEPTION '%', v_out->>'sentence' USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object('ok', true, 'runId', v_out->>'runId', 'sentence', 'Running. About 20 minutes.');
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_market_intel_flag_competitor(p_run_id uuid, p_cid text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_market_intel_seat();
  c public.cockpit_market_intel_competitors;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  IF NOT ((v_seat->>'ceo')::boolean OR (v_seat->>'admin')::boolean) THEN
    RAISE EXCEPTION 'Only the CEO or an admin can mark a competitor as wrong.' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_reason) NOT BETWEEN 3 AND 300 THEN
    RAISE EXCEPTION 'Say in 3 to 300 characters why this is not a competitor.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.cockpit_market_intel_competitors x WHERE x.run_id = p_run_id AND x.cid = p_cid FOR UPDATE;
  IF c.run_id IS NULL THEN
    RAISE EXCEPTION 'That competitor is not in this research run.' USING ERRCODE = '22023';
  END IF;
  IF c.flagged_wrong_by IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'sentence', 'Already marked. The next run leaves it out.');
  END IF;
  UPDATE public.cockpit_market_intel_competitors SET flagged_wrong_by = v_seat->>'email', flagged_at = now(),
         flag_reason = v_reason, updated_at = now()
   WHERE run_id = p_run_id AND cid = p_cid;
  PERFORM public.cockpit_market_intel_audit('market_intel.competitor_flagged', p_run_id, v_seat->>'email',
    jsonb_build_object('flagged', false), jsonb_build_object('flagged', true),
    jsonb_build_object('cid', p_cid, 'reasonChars', char_length(v_reason)));
  RETURN jsonb_build_object('ok', true, 'already', false, 'sentence', 'Marked. The next run leaves it out.');
END $$;

-- ---------------------------------------------------------------------------
-- 6. Grants: the worker's functions to service_role only; the cockpit's three to authenticated (they gate
--    inside); the helpers to nobody but the owner.

REVOKE ALL ON FUNCTION
  public.cockpit_market_intel_audit(text,uuid,text,jsonb,jsonb,jsonb),
  public.cockpit_market_intel_settings(),
  public.cockpit_market_intel_month_usd(),
  public.cockpit_market_intel_effect(),
  public.cockpit_market_intel_answers(uuid),
  public.cockpit_market_intel_enqueue(text,uuid,text,text,text),
  public.cockpit_market_intel_scan(integer),
  public.cockpit_market_intel_claim(text,integer),
  public.cockpit_market_intel_lease(uuid,uuid),
  public.cockpit_market_intel_progress(uuid,uuid,text,jsonb,jsonb),
  public.cockpit_market_intel_store(uuid,uuid,text,jsonb),
  public.cockpit_market_intel_release(uuid,uuid,text,integer,text),
  public.cockpit_market_intel_done(uuid,uuid,text,text,jsonb),
  public.cockpit_market_intel_input_core(text,uuid),
  public.cockpit_market_intel_input(uuid),
  public.cockpit_market_intel_preview(text),
  public.cockpit_market_intel_nap(uuid,text),
  public.cockpit_market_intel_prune(integer),
  public.cockpit_market_intel_seat(),
  public.cockpit_market_intel_view(text),
  public.cockpit_market_intel_rerun(text,text),
  public.cockpit_market_intel_flag_competitor(uuid,text,text),
  public.cockpit_market_intel_setting_audit()
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public.cockpit_market_intel_settings(),
  public.cockpit_market_intel_month_usd(),
  public.cockpit_market_intel_effect(),
  public.cockpit_market_intel_enqueue(text,uuid,text,text,text),
  public.cockpit_market_intel_scan(integer),
  public.cockpit_market_intel_claim(text,integer),
  public.cockpit_market_intel_progress(uuid,uuid,text,jsonb,jsonb),
  public.cockpit_market_intel_store(uuid,uuid,text,jsonb),
  public.cockpit_market_intel_release(uuid,uuid,text,integer,text),
  public.cockpit_market_intel_done(uuid,uuid,text,text,jsonb),
  public.cockpit_market_intel_input(uuid),
  public.cockpit_market_intel_preview(text),
  public.cockpit_market_intel_nap(uuid,text),
  public.cockpit_market_intel_prune(integer)
  TO service_role;

GRANT EXECUTE ON FUNCTION
  public.cockpit_market_intel_view(text),
  public.cockpit_market_intel_rerun(text,text),
  public.cockpit_market_intel_flag_competitor(uuid,text,text)
  TO authenticated;

COMMENT ON TABLE public.cockpit_market_intel_runs IS
  'Market research runs (hermes/market-intel, 20261103i). One open run per card; spend is cumulative. Written only through the cockpit_market_intel_* functions, each with an audit row.';
COMMENT ON TABLE public.cockpit_market_intel_evidence IS
  'Numbered evidence per run (E1...): source, URL, time, cost, trimmed body (reviews never carry the reviewer). Bodies pruned after 180 days.';
COMMENT ON FUNCTION public.cockpit_market_intel_input(uuid) IS
  'The worker''s one read of a run''s onboarding answer: the research subset and the Onboarding Answers tab, never the five contact answers. Service role only.';
COMMENT ON FUNCTION public.cockpit_market_intel_nap(uuid, text) IS
  'match, differs or not_checked for the Maps listing phone against the front desk phone; the number never leaves the database. Service role only.';

-- ---------------------------------------------------------------------------
-- 7. The setting, off. Seeded once with its audit row; an existing value is kept.

DO $$
DECLARE v_n integer;
BEGIN
  INSERT INTO public.cockpit_settings(key, value, updated_by)
  VALUES ('market_intel', jsonb_build_object('on', false, 'mode', 'shadow', 'apply_drive', false, 'apply_clickup', false,
            'apply_kb', false, 'only_cards', '[]'::jsonb, 'usd_cap_run', 2, 'usd_cap_month', 25,
            'refresh_on_kickoff', false,
            'shadow_since', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')), '20261103i')
  ON CONFLICT (key) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 1 THEN
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before,
      after, metadata)
    VALUES ('market_intel.setting_seeded', 'cockpit_settings', 'market_intel', '20261103i', 'client-success', 'deploy',
            NULL, jsonb_build_object('on', false, 'mode', 'shadow'), '{}'::jsonb);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 8. From here on, every change to the setting is audited (after the seed, which wrote its own row).

DROP TRIGGER IF EXISTS cockpit_market_intel_setting_audit ON public.cockpit_settings;
CREATE TRIGGER cockpit_market_intel_setting_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_settings
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_market_intel_setting_audit();

COMMIT;
