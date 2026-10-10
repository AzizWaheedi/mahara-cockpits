-- The new-hire onboarding form, into the person's file.
--
-- Aziz, 2026-10-09: walk each new team member through their role scorecard,
-- learn their financial and non-financial goals, and keep it on their profile
-- in the CEO cockpit ("it pulls in").
--
-- The Typeform "Mahara Media | Team Onboarding" (Cef2QGBh) posts every
-- submission to the team-onboarding-intake Edge Function, which checks
-- Typeform's signature and calls cockpit_team_onboarding_record here. One row
-- per submission, matched to a person by email, then by exact name. A
-- submission nobody matches waits until Aziz says who it is.
--
-- The first submission for a person writes their goals into the empty goal
-- boxes of their private file. It never overwrites what Aziz wrote; "Copy
-- into Who they are" appends on request.
--
-- The service key is the only door to the tables. The browser reads through
-- cockpit_ceo_onboarding, which is the CEO's address and nothing else.

BEGIN;

CREATE TABLE IF NOT EXISTS public.cockpit_team_onboarding (
  id              bigserial PRIMARY KEY,
  -- Typeform's response token: a redelivery of the same submission updates
  -- the row instead of adding a second one.
  response_token  text NOT NULL UNIQUE CHECK (length(response_token) BETWEEN 1 AND 200),
  form_id         text NOT NULL,
  person_id       bigint REFERENCES public.cockpit_people(id) ON DELETE SET NULL,
  matched_by      text CHECK (matched_by IN ('email', 'name', 'manual')),
  email           text,
  full_name       text,
  preferred_name  text,
  role_label      text,
  submitted_at    timestamptz NOT NULL,
  -- The standards check: right answers out of the questions asked, and the
  -- topics they got wrong ([{ref, topic, answered, correct}]).
  score           integer CHECK (score BETWEEN 0 AND 100),
  score_max       integer CHECK (score_max BETWEEN 1 AND 100),
  missed          jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- {money12m, moneyFor, life, career3y, help}
  goals           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Every answer in form order: [{ref, section, title, value}]
  answers         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- {done: [...], missing: [...], blocked}
  setup           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- {device, speedMbps, backup, cameraAndMic, quietSpace}
  workspace       jsonb NOT NULL DEFAULT '{}'::jsonb,
  goals_copied_at timestamptz,
  goals_copied_by text,
  received_at     timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  raw             jsonb NOT NULL
);
COMMENT ON TABLE public.cockpit_team_onboarding IS
  'One row per submission of the new-hire onboarding Typeform (Cef2QGBh), written by the team-onboarding-intake Edge Function. Private: goals, contacts and answers. Read through cockpit_ceo_onboarding only.';
CREATE INDEX IF NOT EXISTS cockpit_team_onboarding_person_idx
  ON public.cockpit_team_onboarding (person_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS cockpit_team_onboarding_email_idx
  ON public.cockpit_team_onboarding (lower(btrim(email)));

-- The intake's own heartbeat: when a form last arrived, and when and why the
-- last delivery failed. The person page says so when the last delivery failed.
CREATE TABLE IF NOT EXISTS public.cockpit_team_onboarding_state (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),
  last_ok_at     timestamptz,
  last_error_at  timestamptz,
  last_error     text,
  failed_count   integer NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.cockpit_team_onboarding_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.cockpit_team_onboarding       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_team_onboarding_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_team_onboarding       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cockpit_team_onboarding_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.cockpit_team_onboarding_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cockpit_team_onboarding       TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.cockpit_team_onboarding_state TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cockpit_team_onboarding_id_seq TO service_role;

-- The goals as the two boxes on the person's file read them.
CREATE OR REPLACE FUNCTION public.cockpit_team_onboarding_goal_text(g jsonb, which text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
  SELECT nullif(array_to_string(array_remove(CASE which
    WHEN 'personal' THEN ARRAY[
      CASE WHEN nullif(btrim(g->>'money12m'),'') IS NOT NULL THEN 'Earning in 12 months: '||btrim(g->>'money12m') END,
      CASE WHEN nullif(btrim(g->>'moneyFor'),'') IS NOT NULL THEN 'What the money is for: '||btrim(g->>'moneyFor') END,
      CASE WHEN nullif(btrim(g->>'life'),'') IS NOT NULL THEN 'Outside work, this year: '||btrim(g->>'life') END]
    ELSE ARRAY[
      CASE WHEN nullif(btrim(g->>'career3y'),'') IS NOT NULL THEN 'In 3 years: '||btrim(g->>'career3y') END,
      CASE WHEN nullif(btrim(g->>'help'),'') IS NOT NULL THEN 'How Mahara can help: '||btrim(g->>'help') END]
  END, NULL), E'\n'), '')
$$;

-- Write a form's goals onto the person's file. 'fill' writes only into an
-- empty box; 'append' adds below what is there unless it is already there.
-- Internal: called by the two functions below, never by a browser.
CREATE OR REPLACE FUNCTION public.cockpit_team_onboarding_write_goals(p_id bigint, p_mode text, p_who text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f record; personal text; professional text; old jsonb; obj jsonb; head text; changed boolean := false;
BEGIN
  SELECT * INTO f FROM cockpit_team_onboarding WHERE id = p_id;
  IF f.id IS NULL OR f.person_id IS NULL THEN RETURN jsonb_build_object('changed', false); END IF;
  personal := cockpit_team_onboarding_goal_text(f.goals, 'personal');
  professional := cockpit_team_onboarding_goal_text(f.goals, 'professional');
  IF personal IS NULL AND professional IS NULL THEN RETURN jsonb_build_object('changed', false); END IF;
  head := 'From the onboarding form, ' || to_char(f.submitted_at AT TIME ZONE 'Asia/Kuwait', 'FMDD Mon YYYY') || E':\n';
  SELECT to_jsonb(t) INTO old FROM cockpit_person_profiles t WHERE person_id = f.person_id;
  INSERT INTO cockpit_person_profiles(person_id, updated_by) VALUES (f.person_id, p_who) ON CONFLICT (person_id) DO NOTHING;
  IF personal IS NOT NULL THEN
    UPDATE cockpit_person_profiles SET personal_goals = CASE
        WHEN coalesce(btrim(personal_goals), '') = '' THEN head || personal
        WHEN p_mode = 'append' AND position(personal IN personal_goals) = 0 THEN personal_goals || E'\n\n' || head || personal
        ELSE personal_goals END
      WHERE person_id = f.person_id AND personal_goals IS DISTINCT FROM CASE
        WHEN coalesce(btrim(personal_goals), '') = '' THEN head || personal
        WHEN p_mode = 'append' AND position(personal IN personal_goals) = 0 THEN personal_goals || E'\n\n' || head || personal
        ELSE personal_goals END;
    changed := changed OR FOUND;
  END IF;
  IF professional IS NOT NULL THEN
    UPDATE cockpit_person_profiles SET professional_goals = CASE
        WHEN coalesce(btrim(professional_goals), '') = '' THEN head || professional
        WHEN p_mode = 'append' AND position(professional IN professional_goals) = 0 THEN professional_goals || E'\n\n' || head || professional
        ELSE professional_goals END
      WHERE person_id = f.person_id AND professional_goals IS DISTINCT FROM CASE
        WHEN coalesce(btrim(professional_goals), '') = '' THEN head || professional
        WHEN p_mode = 'append' AND position(professional IN professional_goals) = 0 THEN professional_goals || E'\n\n' || head || professional
        ELSE professional_goals END;
    changed := changed OR FOUND;
  END IF;
  IF changed THEN
    UPDATE cockpit_person_profiles SET updated_by = p_who, updated_at = now() WHERE person_id = f.person_id
      RETURNING to_jsonb(cockpit_person_profiles.*) INTO obj;
    UPDATE cockpit_team_onboarding SET goals_copied_at = now(), goals_copied_by = p_who, updated_at = now() WHERE id = p_id;
    INSERT INTO cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
      VALUES ('onboarding.goals', 'cockpit_person_profiles', f.person_id::text, p_who, 'media-buyer-cockpit', 'supabase',
        old, obj, jsonb_build_object('onboarding_id', p_id, 'mode', p_mode));
  END IF;
  RETURN jsonb_build_object('changed', changed);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_team_onboarding_write_goals(bigint, text, text) FROM PUBLIC, anon, authenticated, service_role;

-- The intake: the Edge Function hands over one parsed submission.
CREATE OR REPLACE FUNCTION public.cockpit_team_onboarding_record(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE em text; nm text; pid bigint; how text; cnt integer; old jsonb; rid bigint; row_after jsonb; goals jsonb := '{}'::jsonb;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(p->>'responseToken', '') = '' OR coalesce(p->>'formId', '') = ''
     OR p->>'submittedAt' IS NULL OR jsonb_typeof(p->'raw') IS DISTINCT FROM 'object' OR octet_length(p::text) > 2000000 THEN
    RAISE EXCEPTION 'Invalid onboarding submission';
  END IF;
  em := nullif(lower(btrim(coalesce(p->>'email', ''))), '');
  nm := nullif(btrim(coalesce(p->>'fullName', '')), '');
  IF em IS NOT NULL THEN
    SELECT count(*), min(id) INTO cnt, pid FROM cockpit_people WHERE lower(btrim(email)) = em;
    IF cnt = 1 THEN how := 'email'; ELSE pid := NULL; END IF;
  END IF;
  IF pid IS NULL AND nm IS NOT NULL THEN
    SELECT count(*), min(id) INTO cnt, pid FROM cockpit_people WHERE lower(btrim(name)) = lower(nm);
    IF cnt = 1 THEN how := 'name'; ELSE pid := NULL; END IF;
  END IF;
  SELECT jsonb_build_object('id', id, 'person_id', person_id, 'matched_by', matched_by, 'score', score)
    INTO old FROM cockpit_team_onboarding WHERE response_token = p->>'responseToken' FOR UPDATE;
  IF jsonb_typeof(p->'goals') = 'object' THEN goals := p->'goals'; END IF;
  INSERT INTO cockpit_team_onboarding(response_token, form_id, person_id, matched_by, email, full_name, preferred_name, role_label,
      submitted_at, score, score_max, missed, goals, answers, setup, workspace, raw)
    VALUES (p->>'responseToken', p->>'formId', pid, how, em, nm, nullif(btrim(p->>'preferredName'), ''), nullif(btrim(p->>'roleLabel'), ''),
      (p->>'submittedAt')::timestamptz, (p->>'score')::integer, (p->>'scoreMax')::integer,
      CASE WHEN jsonb_typeof(p->'missed') = 'array' THEN p->'missed' ELSE '[]'::jsonb END, goals,
      CASE WHEN jsonb_typeof(p->'answers') = 'array' THEN p->'answers' ELSE '[]'::jsonb END,
      CASE WHEN jsonb_typeof(p->'setup') = 'object' THEN p->'setup' ELSE '{}'::jsonb END,
      CASE WHEN jsonb_typeof(p->'workspace') = 'object' THEN p->'workspace' ELSE '{}'::jsonb END,
      p->'raw')
    ON CONFLICT (response_token) DO UPDATE SET
      -- A link Aziz made by hand survives a redelivery.
      person_id = CASE WHEN cockpit_team_onboarding.matched_by = 'manual' THEN cockpit_team_onboarding.person_id ELSE excluded.person_id END,
      matched_by = CASE WHEN cockpit_team_onboarding.matched_by = 'manual' THEN 'manual' ELSE excluded.matched_by END,
      email = excluded.email, full_name = excluded.full_name, preferred_name = excluded.preferred_name, role_label = excluded.role_label,
      submitted_at = excluded.submitted_at, score = excluded.score, score_max = excluded.score_max, missed = excluded.missed,
      goals = excluded.goals, answers = excluded.answers, setup = excluded.setup, workspace = excluded.workspace,
      raw = excluded.raw, updated_at = now()
    RETURNING id, jsonb_build_object('id', id, 'person_id', person_id, 'matched_by', matched_by, 'score', score) INTO rid, row_after;
  UPDATE cockpit_team_onboarding_state SET last_ok_at = now(), updated_at = now() WHERE id;
  INSERT INTO cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES (CASE WHEN old IS NULL THEN 'onboarding.received' ELSE 'onboarding.redelivered' END, 'cockpit_team_onboarding', rid::text,
      em, 'typeform', 'supabase', old, row_after, jsonb_build_object('form_id', p->>'formId'));
  -- Only a first delivery fills empty goal boxes; a redelivery never rewrites the file.
  RETURN row_after || jsonb_build_object('duplicate', old IS NOT NULL,
    'goals', CASE WHEN old IS NULL THEN cockpit_team_onboarding_write_goals(rid, 'fill', 'onboarding form') ELSE '{"changed":false}'::jsonb END);
END $$;
REVOKE ALL ON FUNCTION public.cockpit_team_onboarding_record(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_team_onboarding_record(jsonb) TO service_role;

-- The intake reports a delivery it could not store, so the page can say so.
CREATE OR REPLACE FUNCTION public.cockpit_team_onboarding_failed(p_error text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
  UPDATE cockpit_team_onboarding_state SET last_error_at = now(), last_error = left(coalesce(p_error, 'unknown'), 300),
    failed_count = failed_count + 1, updated_at = now() WHERE id;
$$;
REVOKE ALL ON FUNCTION public.cockpit_team_onboarding_failed(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_team_onboarding_failed(text) TO service_role;

-- The person page: the forms for one person, the forms nobody matched, and
-- the two things Aziz can do with them.
CREATE OR REPLACE FUNCTION public.cockpit_ceo_onboarding(p_action text, p_args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE who text; n bigint; rid bigint; em text; old jsonb; obj jsonb;
BEGIN
  IF NOT public.cockpit_is_ceo() THEN RAISE EXCEPTION 'Founder access required'; END IF;
  SELECT lower(email) INTO who FROM auth.users WHERE id = auth.uid();
  IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid onboarding request'; END IF;
  CASE p_action
  WHEN 'person' THEN
    n := (p_args->>'personId')::bigint;
    SELECT nullif(lower(btrim(email)), '') INTO em FROM cockpit_people WHERE id = n;
    IF NOT FOUND THEN RAISE EXCEPTION 'Person no longer exists'; END IF;
    RETURN jsonb_build_object(
      'forms', coalesce((SELECT jsonb_agg(to_jsonb(t) - 'raw' ORDER BY t.submitted_at DESC) FROM cockpit_team_onboarding t
        WHERE t.person_id = n OR (t.person_id IS NULL AND em IS NOT NULL AND lower(btrim(t.email)) = em)), '[]'::jsonb),
      'unmatched', coalesce((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'fullName', t.full_name, 'preferredName', t.preferred_name,
          'email', t.email, 'role', t.role_label, 'submittedAt', t.submitted_at) ORDER BY t.submitted_at DESC)
        FROM cockpit_team_onboarding t WHERE t.person_id IS NULL AND (em IS NULL OR lower(btrim(coalesce(t.email, ''))) <> em)), '[]'::jsonb),
      'state', (SELECT jsonb_build_object('lastOkAt', last_ok_at, 'lastErrorAt', last_error_at, 'lastError', last_error, 'failedCount', failed_count)
        FROM cockpit_team_onboarding_state WHERE id));
  WHEN 'link' THEN
    rid := (p_args->>'id')::bigint; n := (p_args->>'personId')::bigint;
    IF NOT EXISTS (SELECT 1 FROM cockpit_people WHERE id = n) THEN RAISE EXCEPTION 'Person no longer exists'; END IF;
    SELECT jsonb_build_object('person_id', person_id, 'matched_by', matched_by) INTO old FROM cockpit_team_onboarding WHERE id = rid FOR UPDATE;
    IF old IS NULL THEN RAISE EXCEPTION 'That form no longer exists'; END IF;
    UPDATE cockpit_team_onboarding SET person_id = n, matched_by = 'manual', updated_at = now() WHERE id = rid
      RETURNING jsonb_build_object('person_id', person_id, 'matched_by', matched_by) INTO obj;
    INSERT INTO cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after)
      VALUES ('onboarding.link', 'cockpit_team_onboarding', rid::text, who, 'media-buyer-cockpit', 'supabase', old, obj);
    -- Linking is when the file first hears about this form, so fill its empty goal boxes now.
    RETURN jsonb_build_object('ok', true, 'goals', cockpit_team_onboarding_write_goals(rid, 'fill', who));
  WHEN 'copyGoals' THEN
    rid := (p_args->>'id')::bigint;
    SELECT person_id INTO n FROM cockpit_team_onboarding WHERE id = rid;
    IF n IS NULL THEN
      -- A form found by email but not yet linked: link it to the person asking.
      n := (p_args->>'personId')::bigint;
      IF n IS NULL OR NOT EXISTS (SELECT 1 FROM cockpit_people WHERE id = n) THEN RAISE EXCEPTION 'Choose who this form belongs to first'; END IF;
      UPDATE cockpit_team_onboarding SET person_id = n, matched_by = 'email', updated_at = now()
        WHERE id = rid AND person_id IS NULL AND lower(btrim(email)) = (SELECT lower(btrim(email)) FROM cockpit_people WHERE id = n);
      IF NOT FOUND THEN RAISE EXCEPTION 'Choose who this form belongs to first'; END IF;
    END IF;
    RETURN jsonb_build_object('ok', true, 'goals', cockpit_team_onboarding_write_goals(rid, 'append', who));
  ELSE RAISE EXCEPTION 'Unsupported onboarding action: %', p_action;
  END CASE;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_ceo_onboarding(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_onboarding(text, jsonb) TO authenticated;

COMMIT;
