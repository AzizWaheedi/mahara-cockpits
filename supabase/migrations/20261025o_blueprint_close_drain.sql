-- The Brand Blueprint close writes ClickUp only, and a press finishes even
-- when its tab closes (docs/forms/STAGE1-CONTRACT.md section 2.2, PLAN.md 1.2
-- S3, S5 and S8). Apply after 20261024a. It does not depend on 20261025n (the
-- Slack notices); the notices read the close result's mapPhase, mapSkipped
-- and launchTaskId, which cockpit-creative-api writes.
--
-- 1. cockpit_creative_outbox gains attempts (0 to 3): how many times the
--    server drain was refused while it prepared a press.
-- 2. cockpit_creative_outbox_audit() also records source_system: 'cron' when
--    the drain wrote (the cockpit.audit_source setting, or the service key's
--    x-cockpit-source header), else NULL as before.
-- 3. cockpit_blueprint_settings_set: close_route takes card_only only. The
--    #csm-general and #media-general posts are notices now, so a Slack
--    problem never sends a close to reconcile.
-- 4. cockpit_blueprint_sources: one more key, blueprintCall (the latest
--    Blueprint call that has happened, the card's stage, the map's phase and
--    the nudge). The gate is unchanged.
-- 5. cockpit_blueprint_json: each part's outbox object carries attempts.
-- 6. The drain, for the service key only: cockpit_creative_outbox_due lists
--    Blueprint presses pending between 2 and 30 minutes and fails older ones;
--    cockpit_creative_outbox_load_for_actor loads a press as its presser's
--    'get' does, after checking that presser's seat now;
--    cockpit_creative_outbox_refused counts a refusal and fails the press at
--    the third. pg_cron's mahara-creative-drain calls
--    cockpit_creative_drain_kick every 2 minutes, which posts to
--    cockpit-creative-api only when a press waits.
--
-- The vault secrets (cockpit_creative_cron_secret, cockpit_anon_key) are
-- never in this file. Until they exist the kick posts nothing and says so in
-- cockpit_sync_state key creative-drain-kick. pg_cron, the vault and pg_net
-- are touched only inside guarded blocks, so an engine without them (PGlite)
-- applies the file. Every write leaves one cockpit_audit_log row through the
-- outbox's or the settings' audit trigger. The file applies twice without
-- error.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Attempts, and the index the drain reads
-- ---------------------------------------------------------------------------

ALTER TABLE public.cockpit_creative_outbox ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                  WHERE c.conrelid = 'public.cockpit_creative_outbox'::regclass
                    AND c.conname = 'cockpit_creative_outbox_attempts_check') THEN
    ALTER TABLE public.cockpit_creative_outbox
      ADD CONSTRAINT cockpit_creative_outbox_attempts_check CHECK (attempts BETWEEN 0 AND 3);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS cockpit_creative_outbox_pending_bp ON public.cockpit_creative_outbox (created_at)
  WHERE state = 'pending' AND kind IN ('blueprintLaunch','blueprintClose','blueprintOffer');
-- The table's grants are unchanged: SELECT, INSERT and UPDATE for the service key only.

-- ---------------------------------------------------------------------------
-- 2. The outbox audit, with where the write came from
-- ---------------------------------------------------------------------------

-- The same row as 20260927s wrote, plus source_system. The header is read
-- inside its own block: the table is service-only, so only the service key
-- can send x-cockpit-source, and an unreadable request.headers is NULL.
CREATE OR REPLACE FUNCTION public.cockpit_creative_outbox_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_header text; v_source text;
BEGIN
  BEGIN
    v_header := nullif(current_setting('request.headers', true), '')::jsonb->>'x-cockpit-source';
  EXCEPTION WHEN OTHERS THEN
    v_header := NULL;
  END;
  v_source := coalesce(nullif(current_setting('cockpit.audit_source', true), ''),
                       CASE WHEN v_header = 'cron' THEN 'cron' END);
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after)
  VALUES (lower(TG_OP), 'creative_outbox', NEW.id::text, NEW.actor_email, 'creative', v_source,
          CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) END, to_jsonb(NEW));
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------
-- 3. The close route is card_only (D5)
-- ---------------------------------------------------------------------------

-- 20261024a's body with the route branch changed: a blank close_route says
-- "Choose card_only.", any other value is refused with where the posts went.
-- Every other rule, gate and message is unchanged.
CREATE OR REPLACE FUNCTION public.cockpit_blueprint_settings_set(p_key text, p_value text, p_label text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s jsonb; v text := nullif(btrim(coalesce(p_value, '')), ''); l text := nullif(btrim(coalesce(p_label, '')), '');
  v_old public.cockpit_blueprint_settings; boss boolean;
BEGIN
  s := public.cockpit_blueprint_seat();
  boss := (s->>'admin')::boolean OR (s->>'founder')::boolean;
  IF NOT ((s->>'creative')::boolean OR boss) THEN
    RAISE EXCEPTION 'Only the creative team changes the Brand Blueprint settings' USING ERRCODE = '42501';
  END IF;
  IF p_key IS NULL OR p_key !~ '^(pack\.(design-build|interior|architecture|fitout|construction)|launch_assignee|close_route)$' THEN
    RAISE EXCEPTION 'The Brand Blueprint has no setting called %', coalesce(left(p_key, 40), '(none)') USING ERRCODE = '22023';
  END IF;
  IF p_key = 'close_route' AND NOT boss THEN
    RAISE EXCEPTION 'Only an admin or the CEO changes what happens after Close the call' USING ERRCODE = '42501';
  END IF;
  IF l IS NOT NULL AND char_length(l) > 120 THEN
    RAISE EXCEPTION 'A setting''s label is at most 120 characters' USING ERRCODE = '22023';
  END IF;

  IF v IS NULL THEN
    IF p_key = 'close_route' THEN
      RAISE EXCEPTION 'Choose card_only.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.cockpit_blueprint_settings x WHERE x.key = p_key) THEN
      PERFORM set_config('cockpit.blueprint_action', 'blueprint.setting', true);
      DELETE FROM public.cockpit_blueprint_settings x WHERE x.key = p_key;
    END IF;
    RETURN public.cockpit_blueprint_settings_read();
  END IF;

  IF p_key LIKE 'pack.%' THEN
    IF v !~ '^https://drive\.google\.com/drive/(u/[0-9]/)?folders/[A-Za-z0-9_-]{10,100}(\?[A-Za-z0-9=&_.-]{0,100})?$' THEN
      RAISE EXCEPTION 'Paste the starter pack''s Google Drive folder link' USING ERRCODE = '22023';
    END IF;
  ELSIF p_key = 'launch_assignee' THEN
    IF v !~ '^[0-9]{3,12}$' THEN
      RAISE EXCEPTION 'Choose the launch media buyer from the list' USING ERRCODE = '22023';
    END IF;
    IF l IS NULL THEN
      RAISE EXCEPTION 'The launch media buyer needs the name the list showed' USING ERRCODE = '22023';
    END IF;
  ELSIF v <> 'card_only' THEN
    -- The close writes ClickUp only (D5): its Slack posts are notices, so the
    -- 'slack' and 'make' routes are gone.
    RAISE EXCEPTION 'The close writes the card only. #csm-general and #media-general hear through the notices: Settings, Notices and routing in the client success cockpit.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old FROM public.cockpit_blueprint_settings x WHERE x.key = p_key;
  IF FOUND AND v_old.value = v AND v_old.label IS NOT DISTINCT FROM l THEN
    RETURN public.cockpit_blueprint_settings_read();
  END IF;
  PERFORM set_config('cockpit.blueprint_action', 'blueprint.setting', true);
  INSERT INTO public.cockpit_blueprint_settings(key, value, label, updated_by)
  VALUES (p_key, v, l, s->>'email')
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, label = excluded.label, updated_at = now(),
                                  updated_by = excluded.updated_by;
  RETURN public.cockpit_blueprint_settings_read();
END $$;

-- The row stays at card_only (a no-op today: the live value is card_only).
SELECT set_config('cockpit.blueprint_action', 'blueprint.setting', true);
UPDATE public.cockpit_blueprint_settings
   SET value = 'card_only', updated_at = now(), updated_by = 'migration'
 WHERE key = 'close_route' AND value <> 'card_only';
SELECT set_config('cockpit.blueprint_action', '', true);

-- ---------------------------------------------------------------------------
-- 4. The deck's sources, with the Blueprint call (S8)
-- ---------------------------------------------------------------------------

-- 20261024a's body plus blueprintCall:
--   {heldAt, status, stage, mapPhase, nudge}
-- heldAt and status: the latest kind 'blueprint' call that has started and is
-- held, showed, confirmed or booked (never cancelled, gone or a no-show);
-- stage: the onboarding mirror's client_status; mapPhase:
-- the phase in its Onboarding Map link (null when there is none); nudge: the
-- stage is Brand Blueprint Booked or Ready For Launch, the map is at phase 4
-- or lower, that call happened, and the record has no part 2.
CREATE OR REPLACE FUNCTION public.cockpit_blueprint_sources(p_task_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb; v_name text; c jsonb; cc jsonb; v_logo jsonb; v_ghl jsonb; v_editor jsonb; v_dos jsonb;
  v_deckkit jsonb; v_kit jsonb; v_next jsonb; v_last jsonb; v_prep jsonb; v_row public.cockpit_blueprints;
  v_json jsonb; v_notes text[] := '{}'; v_has_kickoff boolean := false;
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
-- 5. A row as a browser reads it, with each part's attempts
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_blueprint_json(p_row public.cockpit_blueprints) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_meta jsonb; v_parts jsonb; v_outbox jsonb;
BEGIN
  IF p_row.task_id IS NULL THEN RETURN NULL; END IF;
  SELECT coalesce(jsonb_object_agg(e.key, jsonb_strip_nulls(jsonb_build_object(
           'by', public.cockpit_blueprint_first_name(e.value->>'by'), 'at', e.value->'at', 'from', e.value->'from'))),
         '{}'::jsonb)
    INTO v_meta FROM jsonb_each(p_row.answer_meta) e;
  SELECT coalesce(jsonb_object_agg(e.key, (e.value - 'firstBy' - 'lastBy') || jsonb_build_object(
           'firstBy', public.cockpit_blueprint_first_name(e.value->>'firstBy'),
           'lastBy', public.cockpit_blueprint_first_name(e.value->>'lastBy'))), '{}'::jsonb)
    INTO v_parts FROM jsonb_each(p_row.parts) e;
  SELECT jsonb_object_agg(p.n, (
           SELECT jsonb_build_object('id', o.id, 'state', o.state, 'error', o.error, 'result', o.result,
                                     'createdAt', o.created_at, 'settledAt', o.settled_at, 'attempts', o.attempts)
             FROM public.cockpit_creative_outbox o
            WHERE o.task_id = p_row.task_id AND o.kind = p.kind
            ORDER BY o.created_at DESC, o.id LIMIT 1))
    INTO v_outbox
    FROM (VALUES ('1', 'blueprintLaunch'), ('2', 'blueprintClose'), ('3', 'blueprintOffer')) p(n, kind);
  RETURN jsonb_build_object(
    'taskId', p_row.task_id, 'clientName', p_row.client_name, 'answers', p_row.answers, 'meta', v_meta,
    'parts', v_parts, 'revision', p_row.revision, 'launchTaskId', p_row.launch_task_id,
    'createdAt', p_row.created_at, 'updatedAt', p_row.updated_at,
    'updatedBy', public.cockpit_blueprint_first_name(p_row.updated_by), 'outbox', v_outbox);
END $$;

-- ---------------------------------------------------------------------------
-- 6. The drain (service key only)
-- ---------------------------------------------------------------------------

-- Blueprint presses the browser did not finish. With p_apply (the default),
-- a press pending for over 30 minutes fails with a sentence the card shows;
-- presses pending between 2 and 30 minutes with fewer than 3 refusals are
-- listed, oldest first, at most 5. With p_apply false (or null) it writes
-- nothing, and failed is the count that would fail.
CREATE OR REPLACE FUNCTION public.cockpit_creative_outbox_due(p_apply boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_apply boolean := p_apply IS TRUE; v_failed integer := 0; v_rows jsonb;
BEGIN
  IF v_apply THEN
    PERFORM set_config('cockpit.audit_source', 'cron', true);
    WITH f AS (
      UPDATE public.cockpit_creative_outbox o
         SET state = 'failed', error = 'This press did not finish within 30 minutes. Press again.', settled_at = now()
       WHERE o.state = 'pending' AND o.kind IN ('blueprintLaunch','blueprintClose','blueprintOffer')
         AND o.created_at < now() - interval '30 minutes'
      RETURNING 1)
    SELECT count(*) INTO v_failed FROM f;
  ELSE
    SELECT count(*) INTO v_failed FROM public.cockpit_creative_outbox o
     WHERE o.state = 'pending' AND o.kind IN ('blueprintLaunch','blueprintClose','blueprintOffer')
       AND o.created_at < now() - interval '30 minutes';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'kind', d.kind, 'taskId', d.task_id, 'clientName', d.client_name, 'actorId', d.actor_id,
           'attempts', d.attempts, 'createdAt', d.created_at) ORDER BY d.created_at, d.id), '[]'::jsonb)
    INTO v_rows
    FROM (SELECT o.* FROM public.cockpit_creative_outbox o
           WHERE o.state = 'pending' AND o.kind IN ('blueprintLaunch','blueprintClose','blueprintOffer')
             AND o.created_at BETWEEN now() - interval '30 minutes' AND now() - interval '2 minutes'
             AND o.attempts < 3
           ORDER BY o.created_at, o.id LIMIT 5) d;
  RETURN jsonb_build_object('apply', v_apply, 'failed', v_failed, 'rows', v_rows);
END $$;

-- A press as its presser's cockpit_creative_client_action('get') returns it,
-- for the drain. The presser's seat and client are checked now, not at the
-- press: a seat that lost the creative role or the client is refused.
CREATE OR REPLACE FUNCTION public.cockpit_creative_outbox_load_for_actor(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE queued public.cockpit_creative_outbox;
BEGIN
  SELECT * INTO queued FROM public.cockpit_creative_outbox o WHERE o.id = p_id;
  IF NOT FOUND OR queued.kind NOT IN ('blueprintLaunch','blueprintClose','blueprintOffer') THEN
    RAISE EXCEPTION 'This press is not a Brand Blueprint press.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.cockpit_blueprint_gate_for_actor(queued.actor_id, queued.task_id, true);
  RETURN to_jsonb(queued) || jsonb_build_object('sourceTask', (
    SELECT r.data FROM public.cockpit_creative_sources r
     WHERE r.table_name IN ('creativeTasks','videoJobs','contentPosts')
       AND public.cockpit_creative_source_current(r.table_name, r.source_snapshot_at)
       AND r.data->>'taskId' = queued.task_id LIMIT 1));
END $$;

-- The drain was refused while it prepared a press (nothing was sent): one
-- more attempt and the sentence; the third fails the press, so the card
-- says to fix it and press again. A press no longer pending is returned as
-- it is.
CREATE OR REPLACE FUNCTION public.cockpit_creative_outbox_refused(p_id uuid, p_error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  q public.cockpit_creative_outbox;
  v_error text := left(coalesce(nullif(btrim(p_error), ''), 'The press was refused while it was prepared.'), 1000);
BEGIN
  PERFORM set_config('cockpit.audit_source', 'cron', true);
  SELECT * INTO q FROM public.cockpit_creative_outbox o WHERE o.id = p_id FOR UPDATE;
  IF NOT FOUND OR q.kind NOT IN ('blueprintLaunch','blueprintClose','blueprintOffer') THEN
    RAISE EXCEPTION 'This press is not a Brand Blueprint press.' USING ERRCODE = '22023';
  END IF;
  IF q.state <> 'pending' THEN
    RETURN jsonb_build_object('id', q.id, 'state', q.state, 'attempts', q.attempts);
  END IF;
  UPDATE public.cockpit_creative_outbox o
     SET attempts = least(o.attempts + 1, 3), error = v_error,
         state = CASE WHEN o.attempts + 1 >= 3 THEN 'failed' ELSE o.state END,
         settled_at = CASE WHEN o.attempts + 1 >= 3 THEN now() ELSE o.settled_at END
   WHERE o.id = q.id
  RETURNING o.* INTO q;
  RETURN jsonb_build_object('id', q.id, 'state', q.state, 'attempts', q.attempts);
END $$;

-- pg_cron's caller (no grant: pg_cron runs it as its owner). It posts to
-- cockpit-creative-api only when a Blueprint press has waited over 2
-- minutes, with the vault's cron secret and the public anon key (the
-- function keeps its JWT check). Each run leaves a plain note in
-- cockpit_sync_state key creative-drain-kick.
CREATE OR REPLACE FUNCTION public.cockpit_creative_drain_kick()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_url constant text := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/cockpit-creative-api';
  v_secret text; v_anon text; v_request bigint; v_note text; v_missing text[] := '{}'; v_waiting integer;
BEGIN
  SELECT count(*) INTO v_waiting FROM public.cockpit_creative_outbox o
   WHERE o.state = 'pending' AND o.kind IN ('blueprintLaunch','blueprintClose','blueprintOffer')
     AND o.created_at < now() - interval '2 minutes';
  IF v_waiting = 0 THEN
    INSERT INTO public.cockpit_sync_state(key, last_run_at, last_ok_at, ok, note, updated_at)
    VALUES ('creative-drain-kick', now(), now(), true, 'Nothing to drain', now())
    ON CONFLICT (key) DO UPDATE SET last_run_at = now(), last_ok_at = now(), ok = true, note = EXCLUDED.note,
                                    updated_at = now();
    RETURN NULL;
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE 'SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.name=$1 LIMIT 1'
      INTO v_secret USING 'cockpit_creative_cron_secret';
    EXECUTE 'SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.name=$1 LIMIT 1'
      INTO v_anon USING 'cockpit_anon_key';
  END IF;
  IF v_secret IS NULL OR btrim(v_secret) = '' THEN v_missing := v_missing || 'cockpit_creative_cron_secret'::text; END IF;
  IF v_anon IS NULL OR btrim(v_anon) = '' THEN v_missing := v_missing || 'cockpit_anon_key'::text; END IF;
  IF cardinality(v_missing) > 0 THEN
    v_note := format('The vault has no %s, so the Brand Blueprint drain did not run (%s waiting). Add %s to the vault.',
                     array_to_string(v_missing, ' and no '),
                     CASE WHEN v_waiting = 1 THEN '1 press' ELSE v_waiting || ' presses' END,
                     CASE WHEN cardinality(v_missing) = 1 THEN 'it' ELSE 'them' END);
  ELSIF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc f JOIN pg_catalog.pg_namespace n ON n.oid = f.pronamespace
                     WHERE n.nspname = 'net' AND f.proname = 'http_post') THEN
    v_note := format('pg_net is not installed, so the Brand Blueprint drain did not run (%s waiting). Turn the pg_net extension on.',
                     CASE WHEN v_waiting = 1 THEN '1 press' ELSE v_waiting || ' presses' END);
  END IF;
  IF v_note IS NOT NULL THEN
    INSERT INTO public.cockpit_sync_state(key, last_run_at, ok, note, updated_at)
    VALUES ('creative-drain-kick', now(), false, v_note, now())
    ON CONFLICT (key) DO UPDATE SET last_run_at = now(), ok = false, note = EXCLUDED.note, updated_at = now();
    RETURN NULL;
  END IF;
  EXECUTE 'SELECT net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)' INTO v_request
    USING v_url, jsonb_build_object('operation', 'cron', 'job', 'drain', 'apply', true),
          jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret,
                             'Authorization', 'Bearer ' || v_anon, 'apikey', v_anon);
  INSERT INTO public.cockpit_sync_state(key, last_run_at, last_ok_at, ok, note, updated_at)
  VALUES ('creative-drain-kick', now(), now(), true, 'Posted a drain run', now())
  ON CONFLICT (key) DO UPDATE SET last_run_at = now(), last_ok_at = now(), ok = true, note = EXCLUDED.note,
                                  updated_at = now();
  RETURN v_request;
END $$;

DO $$
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname=''mahara-creative-drain''';
    EXECUTE $q$SELECT cron.schedule('mahara-creative-drain','*/2 * * * *',$job$SELECT public.cockpit_creative_drain_kick();$job$)$q$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Grants: every function here loses Supabase's default grants, then gets
-- exactly one (or none).
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION
  public.cockpit_creative_outbox_audit(),
  public.cockpit_blueprint_settings_set(text, text, text),
  public.cockpit_blueprint_sources(text),
  public.cockpit_blueprint_json(public.cockpit_blueprints),
  public.cockpit_creative_outbox_due(boolean),
  public.cockpit_creative_outbox_load_for_actor(uuid),
  public.cockpit_creative_outbox_refused(uuid, text),
  public.cockpit_creative_drain_kick()
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public.cockpit_blueprint_settings_set(text, text, text),
  public.cockpit_blueprint_sources(text)
TO authenticated;

GRANT EXECUTE ON FUNCTION
  public.cockpit_creative_outbox_due(boolean),
  public.cockpit_creative_outbox_load_for_actor(uuid),
  public.cockpit_creative_outbox_refused(uuid, text)
TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
