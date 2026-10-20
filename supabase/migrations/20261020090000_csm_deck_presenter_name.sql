-- The presenter's first name on the deck covers came out as "aziz": the CEO's seat
-- has no name, so the screen fell back to the email address. The name now comes
-- from the seat, else the team list (cockpit_people) by email, and an all-lowercase
-- name is capitalised. Only the presenter lookup changes; grants stay as they were.
CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_sources(p_task_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb; v_name text; c jsonb; v_logo jsonb; v_ghl jsonb; v_loc text; v_editor jsonb; v_dos jsonb; v_kit jsonb;
  v_callers jsonb; v_next jsonb; v_last jsonb; v_presenter jsonb; v_notes text[] := '{}';
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  v_name := g->>'clientName';
  -- The presenting seat: its first name goes on the two covers only (CONTENT.md copy rule 8).
  SELECT jsonb_build_object('email', x.email, 'firstName',
           CASE WHEN x.first = lower(x.first) THEN initcap(x.first) ELSE x.first END)
    INTO v_presenter
    FROM (SELECT m.email, nullif(split_part(btrim(coalesce(
                   CASE WHEN m.name LIKE '%@%' THEN NULL ELSE nullif(btrim(m.name), '') END,
                   (SELECT p.name FROM public.cockpit_people p
                     WHERE lower(p.email) = lower(m.email) AND p.name NOT LIKE '%@%' AND btrim(p.name) <> ''
                     ORDER BY p.active DESC NULLS LAST LIMIT 1),
                   '')), ' ', 1), '') AS first
            FROM public.cockpit_members m WHERE m.auth_user_id = auth.uid() AND m.active LIMIT 1) x;
  SELECT s.data INTO c FROM public.cockpit_csm_sources s WHERE s.table_name = 'clients' AND s.data->>'taskId' = p_task_id;

  SELECT jsonb_build_object('bucket', 'cockpit-client-logos', 'path', l.storage_path, 'verifiedAt', l.verified_at)
    INTO v_logo FROM public.cockpit_client_logos l
   WHERE l.clickup_task_id = p_task_id ORDER BY l.verified_at DESC LIMIT 1;

  SELECT jsonb_build_object(
           'name', nullif(btrim(x.client_name), ''),
           -- The roster writes Qatar as QT; the decks key on ISO codes.
           'country', CASE upper(nullif(btrim(x.country), '')) WHEN 'QT' THEN 'QA' ELSE upper(nullif(btrim(x.country), '')) END,
           'city', nullif(btrim(x.city), ''), 'language', lower(nullif(btrim(x.language), '')),
           'serviceMode', upper(nullif(btrim(x.service_mode), ''))),
         nullif(btrim(x.location_id), '')
    INTO v_ghl, v_loc FROM public.ghl_clients x WHERE x.clickup_id = p_task_id;
  IF v_ghl IS NULL THEN v_notes := v_notes || 'No HighLevel account row carries this card, so country, language and callers are unknown.'::text; END IF;

  SELECT jsonb_build_object(
           'offer', nullif(btrim(e.offer), ''), 'offerUrl', nullif(btrim(e.offer_url), ''),
           'brandDna', nullif(btrim(e.brand_dna), ''), 'brandDnaUrl', nullif(btrim(e.brand_dna_url), ''),
           'driveUrl', nullif(btrim(e.drive_url), ''), 'website', nullif(btrim(e.website), ''),
           'instagram', nullif(btrim(e.instagram), ''), 'readAt', e.docs_read_at, 'syncedAt', e.synced_at),
         jsonb_build_object('text', nullif(btrim(e.dos_donts), ''), 'source', 'The client card''s Do''s & Don''ts field', 'syncedAt', e.synced_at)
    INTO v_editor, v_dos FROM public.editor_clients e WHERE e.task_id = p_task_id;
  IF v_editor IS NULL THEN v_notes := v_notes || 'The client card has not been read by the editor desk, so the offer and Do''s & Don''ts are unknown.'::text; END IF;

  SELECT jsonb_build_object(
           'onboardingCallOn', o.onboarding_call_on, 'launchOn', o.launch_on, 'signupOn', o.signup_on,
           'links', jsonb_strip_nulls(jsonb_build_object(
             'drive', CASE WHEN jsonb_typeof(o.links->'drive') = 'string' THEN o.links->>'drive' END,
             'driveFolder', CASE WHEN jsonb_typeof(o.links->'drive_folder') = 'string' THEN o.links->>'drive_folder' END,
             'onboardingMap', CASE WHEN jsonb_typeof(o.links->'onboarding_map') = 'string' THEN o.links->>'onboarding_map' END,
             'website', CASE WHEN jsonb_typeof(o.links->'website') = 'string' THEN o.links->>'website' END)),
           'syncedAt', o.synced_at)
    INTO v_kit FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_task_id;

  IF v_loc IS NOT NULL THEN
    BEGIN
      SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('firstName',
               CASE WHEN r.name LIKE '%@%' OR nullif(btrim(r.name), '') IS NULL THEN NULL ELSE split_part(btrim(r.name), ' ', 1) END)), '[]'::jsonb)
        INTO v_callers FROM public.cockpit_client_caller_rows() r WHERE r.location_id = v_loc;
    EXCEPTION WHEN OTHERS THEN
      v_callers := NULL;
      v_notes := v_notes || 'The dialer''s caller assignments could not be read.'::text;
    END;
  END IF;

  SELECT coalesce(jsonb_object_agg(x.kind, jsonb_build_object('startsAt', x.starts_at, 'endsAt', x.ends_at, 'status', x.status)), '{}'::jsonb)
    INTO v_next
    FROM (SELECT DISTINCT ON (k.kind) k.kind, k.starts_at, k.ends_at, k.status FROM public.cockpit_csm_calls k
           WHERE k.task_id = p_task_id AND k.kind <> 'other' AND k.starts_at > now() AND k.status IN ('booked','confirmed')
           ORDER BY k.kind, k.starts_at) x;
  SELECT coalesce(jsonb_object_agg(x.kind, jsonb_build_object('startsAt', x.starts_at, 'endsAt', x.ends_at, 'status', x.status)), '{}'::jsonb)
    INTO v_last
    FROM (SELECT DISTINCT ON (k.kind) k.kind, k.starts_at, k.ends_at, k.status FROM public.cockpit_csm_calls k
           WHERE k.task_id = p_task_id AND k.kind <> 'other' AND k.starts_at <= now() AND k.status IN ('held','showed','confirmed','booked')
           ORDER BY k.kind, k.starts_at DESC) x;

  RETURN jsonb_build_object(
    'taskId', p_task_id, 'clientName', v_name, 'at', now(), 'presenter', v_presenter,
    'client', CASE WHEN c IS NULL THEN NULL ELSE jsonb_build_object(
      'stage', c->>'stage', 'service', nullif(btrim(c->>'service'), ''), 'launchDate', c->'launchDate', 'bucket', c->>'bucket') END,
    'logo', v_logo, 'ghl', v_ghl, 'editor', v_editor, 'dosDonts', v_dos, 'kit', v_kit, 'callers', v_callers,
    'calls', jsonb_build_object('next', v_next, 'last', v_last),
    'meta', public.cockpit_csm_deck_meta(p_task_id, v_name),
    'prep', public.cockpit_csm_deck_prep_both(p_task_id),
    'launchAds', public.cockpit_csm_launch_ads_rows(p_task_id, true),
    'notes', to_jsonb(v_notes));
END $$;

