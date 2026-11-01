-- The forms editor, ED (docs/forms/WAVE34-CONTRACT.md 2.6, 4.9, 5.13; plan
-- 4.2 ED and E18). Admins and the CEO edit the client forms' questions,
-- Arabic and English wording, WhatsApp and phone texts in data, keep a draft,
-- publish it as a new version, go back to an older version, and set the
-- routing the schedule and the low-score line read. Staff forms stay
-- code-defined and Typeform/Make forms stay where they live (V13): the
-- editor lists them read only.
--
-- 1. cockpit_form_schema_drafts: one draft per form, removed on publish (and
--    on Discard) only, audited, never deleted any other way.
-- 2. Helpers (owner only): the editor's version of a form (its newest
--    client-schema v:1 version, the rule cockpit_form_client_version of
--    20261102a follows), the group a form belongs to and why it is read only,
--    role words for whoever published, every {en, ar} text of a schema, the
--    effect labels, and the publish check (schema, text rule, field guard).
-- 3. The browser RPCs (admin or CEO): cockpit_form_editor_read() and
--    cockpit_form_editor_read_one(key) (STABLE: they run in a read-only
--    transaction), cockpit_form_draft_save, cockpit_form_publish,
--    cockpit_form_restore and cockpit_form_routing_set.
-- 4. cockpit_form_registry_apply replaced (2.2): a native client form changes
--    only through the editor ("Edit client forms in the forms editor."), and
--    no patch ever carries a schema; staff forms keep W19's refusal word for
--    word; every other rule is byte for byte the live body.
-- 5. forms.doors merged with {"editor":true} (read by cockpit_form_doors,
--    20261102a).
--
-- It stands on 20261102a (cockpit_form_schema_check, cockpit_client_text_ok,
-- cockpit_form_client_live) and 20261102c (cockpit_form_schedules) by name
-- only: every function here is plpgsql and checks those objects at run time,
-- so the file applies before them and says "after the next cockpit update"
-- until they exist. It applies twice and changes nothing the second time.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard (2.1): the replaced body is the one the contract read
--    (live md5, 11.2-c) or this file's own (a second apply).

DO $$
DECLARE g record; v_now text;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('public.cockpit_form_registry_apply(text,jsonb,jsonb)', '73a88dc6513b074e54d76ec4472d3539', '129226b2d25b878a91677012f32e9fa4')
    ) AS x(fn, live_md5, after_md5)
  LOOP
    v_now := NULL;
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_now
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(g.fn);
    IF v_now IS NULL OR v_now NOT IN (g.live_md5, g.after_md5) THEN
      RAISE EXCEPTION '% changed since the waves 3-4 contract read it; stop and re-read it.', replace(g.fn, 'public.', '')
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Drafts

CREATE TABLE IF NOT EXISTS public.cockpit_form_schema_drafts (
  form_key     text PRIMARY KEY REFERENCES public.cockpit_forms(key),
  -- The published version the draft was started from; a publish needs it
  -- to still be the published one.
  base_version integer NOT NULL CHECK (base_version >= 1),
  schema       jsonb NOT NULL CHECK (jsonb_typeof(schema) = 'object' AND octet_length(schema::text) <= 65536),
  -- The seat's address; never reaches a browser (role words do).
  saved_by     text NOT NULL CHECK (btrim(saved_by) <> ''),
  saved_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cockpit_form_schema_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_form_schema_drafts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cockpit_form_schema_drafts TO service_role;

-- One audit row per change: the form, the base, who saved it and a
-- fingerprint of the schema (its md5 and its question keys), never the text.
CREATE OR REPLACE FUNCTION public.cockpit_form_schema_drafts_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old public.cockpit_form_schema_drafts;
  v_new public.cockpit_form_schema_drafts;
  v_actor text;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN v_old := OLD; END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN v_new := NEW; END IF;
  SELECT lower(btrim(u.email)) INTO v_actor FROM auth.users u WHERE u.id = auth.uid();
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES (coalesce(nullif(current_setting('cockpit.forms_action', true), ''),
                   'forms.cockpit_form_schema_drafts.' || lower(TG_OP)),
          'cockpit_form_schema_drafts', coalesce(v_new.form_key, v_old.form_key),
          coalesce(v_actor, nullif(current_setting('cockpit.audit_actor', true), ''), session_user::text),
          'client-success', coalesce(nullif(current_setting('cockpit.audit_source', true), ''), 'supabase'),
          CASE WHEN v_old.form_key IS NOT NULL THEN jsonb_build_object(
            'base_version', v_old.base_version, 'saved_at', v_old.saved_at,
            'schema_md5', md5(v_old.schema::text),
            'fields', coalesce((SELECT jsonb_agg(f->>'key') FROM jsonb_array_elements(
                        CASE WHEN jsonb_typeof(v_old.schema->'fields') = 'array' THEN v_old.schema->'fields' END) f), '[]'::jsonb)) END,
          CASE WHEN v_new.form_key IS NOT NULL THEN jsonb_build_object(
            'base_version', v_new.base_version, 'saved_at', v_new.saved_at,
            'schema_md5', md5(v_new.schema::text),
            'fields', coalesce((SELECT jsonb_agg(f->>'key') FROM jsonb_array_elements(
                        CASE WHEN jsonb_typeof(v_new.schema->'fields') = 'array' THEN v_new.schema->'fields' END) f), '[]'::jsonb)) END,
          jsonb_build_object('op', lower(TG_OP), 'form_key', coalesce(v_new.form_key, v_old.form_key)));
  RETURN NULL;
END $$;

-- A draft leaves only by publish, restore's caller or Discard, each of which
-- sets the transaction-local cockpit.forms_draft_remove; any other delete is
-- refused like every forms record.
CREATE OR REPLACE FUNCTION public.cockpit_form_schema_drafts_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(current_setting('cockpit.forms_draft_remove', true), '') <> 'on' THEN
    RAISE EXCEPTION 'Forms records are never deleted' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END $$;

REVOKE ALL ON FUNCTION public.cockpit_form_schema_drafts_audit(), public.cockpit_form_schema_drafts_guard()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS cockpit_form_schema_drafts_audit ON public.cockpit_form_schema_drafts;
CREATE TRIGGER cockpit_form_schema_drafts_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_form_schema_drafts
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_form_schema_drafts_audit();
DROP TRIGGER IF EXISTS cockpit_form_schema_drafts_no_delete ON public.cockpit_form_schema_drafts;
CREATE TRIGGER cockpit_form_schema_drafts_no_delete BEFORE DELETE ON public.cockpit_form_schema_drafts
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_form_schema_drafts_guard();
DROP TRIGGER IF EXISTS cockpit_form_schema_drafts_no_truncate ON public.cockpit_form_schema_drafts;
CREATE TRIGGER cockpit_form_schema_drafts_no_truncate BEFORE TRUNCATE ON public.cockpit_form_schema_drafts
  FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_forms_refuse_delete();

-- ---------------------------------------------------------------------------
-- 2. Helpers (owner only)

-- The editor's version of a form: the newest version whose schema is the
-- client schema v1 (3.1). For a native client form it equals the registry's
-- version; for exit_survey before its go-live it is version 2 or later while
-- the registry still reads 1 (2.4). NULL when the form has none.
CREATE OR REPLACE FUNCTION public.cockpit_form_editor_version(p_form_key text)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN (SELECT max(v.version) FROM public.cockpit_form_versions v
           WHERE v.form_key = p_form_key AND v.schema->>'v' = '1' AND jsonb_typeof(v.schema->'fields') = 'array');
END $$;

-- Where a form sits on the editor's list and, when it is read only, why
-- (4.9.6, 5.9): {group: client|staff|typeform, editable, why}.
CREATE OR REPLACE FUNCTION public.cockpit_form_editor_kind(p public.cockpit_forms)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p.key = 'portal_feedback' THEN
    RETURN jsonb_build_object('group', 'client', 'editable', false,
      'why', 'The portal''s Share feedback writes these; edit it in the portal.');
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

-- Who published or saved, in role words (never an address on a screen).
CREATE OR REPLACE FUNCTION public.cockpit_form_editor_role(p_who text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v text := lower(btrim(coalesce(p_who, '')));
BEGIN
  IF v = '' THEN RETURN 'the cockpit'; END IF;
  IF v IN ('aziz@maharamedia.com','awaheedi2008@gmail.com') THEN RETURN 'the CEO'; END IF;
  IF v LIKE 'migration%' THEN RETURN 'a migration'; END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_members m WHERE m.email = v AND 'admin' = ANY(m.roles)) THEN
    RETURN 'an admin';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_members m WHERE m.email = v) THEN RETURN 'a team member'; END IF;
  RETURN 'the cockpit';
END $$;

-- Every client-facing text of a schema: each string under an "en" or "ar"
-- key, with its path (".fields[2].label.en"), for the text rule (V18).
CREATE OR REPLACE FUNCTION public.cockpit_form_editor_texts(p_schema jsonb)
RETURNS TABLE(path text, value text) LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH RECURSIVE n(path, v) AS (
    SELECT ''::text, p_schema
    UNION ALL
    SELECT n.path || e.step, e.val
      FROM n CROSS JOIN LATERAL (
        SELECT '.' || o.key AS step, o.value AS val
          FROM jsonb_each(CASE WHEN jsonb_typeof(n.v) = 'object' THEN n.v END) o
        UNION ALL
        SELECT '[' || (a.i - 1)::text || ']', a.value
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(n.v) = 'array' THEN n.v END) WITH ORDINALITY a(value, i)
      ) e
  )
  SELECT n.path, n.v #>> '{}' FROM n
   WHERE jsonb_typeof(n.v) = 'string' AND (n.path LIKE '%.en' OR n.path LIKE '%.ar')
   ORDER BY n.path
$$;

-- An effect's words for the field guard: the registry's label when the form
-- lists the effect, else the hooks' own names (5.5 to 5.8), else the key.
CREATE OR REPLACE FUNCTION public.cockpit_form_editor_effect_label(p_form_key text, p_effect text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v text;
BEGIN
  SELECT e->>'label' INTO v FROM public.cockpit_forms f CROSS JOIN LATERAL jsonb_array_elements(f.effects) e
   WHERE f.key = p_form_key AND e->>'key' = p_effect LIMIT 1;
  RETURN coalesce(nullif(btrim(v), ''), CASE p_effect
    WHEN 'low_score' THEN 'the low-score call on Today'
    WHEN 'nps_notice' THEN 'the NPS answer notice'
    WHEN 'csat_notice' THEN 'the onboarding survey notice'
    WHEN 'consent_gate' THEN 'the pause confirm check'
    WHEN 'card_comment' THEN 'the ClickUp card comment'
    ELSE replace(coalesce(p_effect, 'a cockpit step'), '_', ' ') END);
END $$;

-- The fields a schema's reads name, per effect: {field: [effect, ...]}.
CREATE OR REPLACE FUNCTION public.cockpit_form_editor_read_map(p_schema jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_object_agg(x.field, x.effects), '{}'::jsonb)
    FROM (SELECT f.value #>> '{}' AS field, jsonb_agg(r.key ORDER BY r.key) AS effects
            FROM jsonb_each(CASE WHEN jsonb_typeof(p_schema->'reads') = 'object' THEN p_schema->'reads' END) r
            CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(r.value) = 'array' THEN r.value END) f
           WHERE jsonb_typeof(f.value) = 'string'
           GROUP BY 1) x
$$;

-- The first reason a schema cannot be published over the published one, as
-- {problem, where}; NULL when it can (4.9.3 to 4.9.5). The order: whose form
-- it is; against the published version, who answers, what the cockpit reads,
-- the invite facts, the field guard and the key rules (so a removed question
-- is named by the effect that reads it); then the v1 schema check
-- (20261102a), the WhatsApp placeholder and the text rule on every text.
CREATE OR REPLACE FUNCTION public.cockpit_form_editor_problem(p_form_key text, p_published jsonb, p_next jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_msg text;
  t record;
  r record;
  v_reads jsonb;
  v_old jsonb;
  v_new jsonb;
  v_label text;
  v_effect text;
  v_lang text;
  v_wa text;
  v_old_keys text[];
  v_new_keys text[];
  i integer;
BEGIN
  IF jsonb_typeof(p_next) IS DISTINCT FROM 'object' OR p_next->>'v' IS DISTINCT FROM '1'
     OR p_next->>'key' IS DISTINCT FROM p_form_key THEN
    RETURN jsonb_build_object('problem', 'This draft belongs to another form. Reload it.', 'where', NULL);
  END IF;
  IF octet_length(p_next::text) > 65536 THEN
    RETURN jsonb_build_object('problem', 'A form is at most 64 KB. Shorten its texts.', 'where', NULL);
  END IF;

  -- Against the published version first, so a removed question is named
  -- by the effect that reads it rather than by the schema check.
  IF p_published IS NOT NULL AND jsonb_typeof(p_next->'fields') = 'array'
     AND jsonb_typeof(p_published->'fields') = 'array' THEN

  -- Who answers, what the cockpit reads and which invite facts show are
  -- set in code (4.9.3).
  IF (p_next->'audience') IS DISTINCT FROM (p_published->'audience')
     OR (p_next->'signer') IS DISTINCT FROM (p_published->'signer') THEN
    RETURN jsonb_build_object('problem', 'Who answers this form is set in the cockpit''s code.', 'where', NULL);
  END IF;
  IF coalesce(p_next->'reads', '{}'::jsonb) IS DISTINCT FROM coalesce(p_published->'reads', '{}'::jsonb) THEN
    RETURN jsonb_build_object('problem', 'Which questions the cockpit reads is set in its code.', 'where', '.reads');
  END IF;
  IF (SELECT coalesce(jsonb_agg(jsonb_build_array(c->>'key', c->>'type') ORDER BY o), '[]'::jsonb)
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_next->'context') = 'array' THEN p_next->'context' END)
             WITH ORDINALITY q(c, o))
     IS DISTINCT FROM
     (SELECT coalesce(jsonb_agg(jsonb_build_array(c->>'key', c->>'type') ORDER BY o), '[]'::jsonb)
        FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_published->'context') = 'array' THEN p_published->'context' END)
             WITH ORDINALITY q(c, o)) THEN
    RETURN jsonb_build_object('problem',
      'The facts shown from the invite are set in the cockpit''s code. Change only their wording.', 'where', '.context');
  END IF;

  -- The field guard: a field an effect reads stays, stays visible, and keeps
  -- its type, range, requirement and choice values; its words may change.
  v_reads := public.cockpit_form_editor_read_map(p_published);
  FOR r IN SELECT k AS field, v_reads->k AS effects FROM jsonb_object_keys(v_reads) k ORDER BY k LOOP
    v_old := NULL;
    SELECT f INTO v_old FROM jsonb_array_elements(p_published->'fields') f WHERE f->>'key' = r.field LIMIT 1;
    IF v_old IS NULL THEN CONTINUE; END IF;
    v_new := NULL;
    SELECT f INTO v_new FROM jsonb_array_elements(p_next->'fields') f WHERE f->>'key' = r.field LIMIT 1;
    v_label := coalesce(v_old #>> '{label,en}', r.field);
    v_effect := public.cockpit_form_editor_effect_label(p_form_key, r.effects->>0);
    IF v_new IS NULL
       OR (coalesce(v_new->'showIf', 'null'::jsonb) IS DISTINCT FROM coalesce(v_old->'showIf', 'null'::jsonb)
           AND coalesce(v_new->'showIf', 'null'::jsonb) <> 'null'::jsonb) THEN
      RETURN jsonb_build_object('problem', format('%s is read by %s. Remove that effect first.', v_label, v_effect),
                                'where', '.fields.' || r.field);
    END IF;
    IF (v_new->'type') IS DISTINCT FROM (v_old->'type')
       OR (v_new->'min') IS DISTINCT FROM (v_old->'min')
       OR (v_new->'max') IS DISTINCT FROM (v_old->'max')
       OR coalesce(v_new->'required', 'false'::jsonb) IS DISTINCT FROM coalesce(v_old->'required', 'false'::jsonb)
       OR coalesce(v_new->'showIf', 'null'::jsonb) IS DISTINCT FROM coalesce(v_old->'showIf', 'null'::jsonb)
       OR (SELECT coalesce(array_agg(o->>'value' ORDER BY o->>'value'), '{}'::text[])
             FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_new->'options') = 'array' THEN v_new->'options' END) o)
          IS DISTINCT FROM
          (SELECT coalesce(array_agg(o->>'value' ORDER BY o->>'value'), '{}'::text[])
             FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_old->'options') = 'array' THEN v_old->'options' END) o) THEN
      RETURN jsonb_build_object('problem',
        format('%s is read by %s, so its type, range and choices stay as they are.', v_label, v_effect),
        'where', '.fields.' || r.field);
    END IF;
  END LOOP;

  -- Keys of published fields never change (3.1): a question that keeps its
  -- place, type and English words under a new key is a rename.
  SELECT coalesce(array_agg(f->>'key' ORDER BY o), '{}') INTO v_old_keys
    FROM jsonb_array_elements(p_published->'fields') WITH ORDINALITY q(f, o);
  SELECT coalesce(array_agg(f->>'key' ORDER BY o), '{}') INTO v_new_keys
    FROM jsonb_array_elements(p_next->'fields') WITH ORDINALITY q(f, o);
  FOR i IN 1 .. coalesce(array_length(v_new_keys, 1), 0) LOOP
    IF i <= coalesce(array_length(v_old_keys, 1), 0)
       AND v_new_keys[i] IS DISTINCT FROM v_old_keys[i]
       AND NOT (v_old_keys[i] = ANY(v_new_keys))
       AND NOT (v_new_keys[i] = ANY(v_old_keys))
       AND (p_next->'fields'->(i - 1)->'type') IS NOT DISTINCT FROM (p_published->'fields'->(i - 1)->'type')
       AND (p_next->'fields'->(i - 1) #>> '{label,en}') IS NOT DISTINCT FROM (p_published->'fields'->(i - 1) #>> '{label,en}') THEN
      RETURN jsonb_build_object('problem',
        format('Question keys never change once published. Keep the key %s.', v_old_keys[i]),
        'where', '.fields.' || v_new_keys[i]);
    END IF;
  END LOOP;

  -- A key used before keeps its type for good, so old answers stay readable.
  FOR r IN
    SELECT nf->>'key' AS k, nf->>'type' AS ty, v.version, pf->>'type' AS was
      FROM jsonb_array_elements(p_next->'fields') nf
      JOIN public.cockpit_form_versions v ON v.form_key = p_form_key AND v.schema->>'v' = '1'
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v.schema->'fields') = 'array' THEN v.schema->'fields' END) pf
     WHERE pf->>'key' = nf->>'key' AND pf->>'type' IS DISTINCT FROM nf->>'type'
     ORDER BY v.version DESC LIMIT 1
  LOOP
    RETURN jsonb_build_object('problem',
      format('%s was a %s question in version %s. Pick a new key.', r.k, r.was, r.version),
      'where', '.fields.' || r.k);
  END LOOP;
  END IF;

  -- The client form schema v1 (3.1), checked by the same function every
  -- issue and go-live uses.
  IF to_regprocedure('public.cockpit_form_schema_check(jsonb)') IS NULL
     OR to_regprocedure('public.cockpit_client_text_ok(text)') IS NULL THEN
    RETURN jsonb_build_object('problem', 'The form checks open after the next cockpit update. Publish then.', 'where', NULL);
  END IF;
  v_msg := public.cockpit_form_schema_check(p_next);
  IF v_msg IS NOT NULL THEN
    RETURN jsonb_build_object('problem', v_msg, 'where', NULL);
  END IF;

  -- The WhatsApp text carries the link exactly once and fits a message (3.9).
  FOREACH v_lang IN ARRAY ARRAY['en','ar'] LOOP
    v_wa := p_next #>> ARRAY['invite','whatsapp',v_lang];
    IF v_wa IS NOT NULL AND (array_length(string_to_array(v_wa, '{form_link}'), 1) IS DISTINCT FROM 2) THEN
      RETURN jsonb_build_object('problem', 'The WhatsApp text needs {form_link} exactly once, where the link goes.',
                                'where', '.invite.whatsapp.' || v_lang);
    END IF;
    IF v_wa IS NOT NULL AND char_length(v_wa) > 1000 THEN
      RETURN jsonb_build_object('problem', 'The WhatsApp text is at most 1,000 characters.',
                                'where', '.invite.whatsapp.' || v_lang);
    END IF;
  END LOOP;

  -- The text rule on every client-facing text (V18).
  FOR t IN SELECT * FROM public.cockpit_form_editor_texts(p_next) LOOP
    v_msg := public.cockpit_client_text_ok(t.value);
    IF v_msg IS NOT NULL THEN
      RETURN jsonb_build_object('problem', v_msg, 'where', t.path);
    END IF;
  END LOOP;

  RETURN NULL;
END $$;

-- The editor's gate: an admin seat or the CEO (4.9.1). Returns the seat.
CREATE OR REPLACE FUNCTION public.cockpit_form_editor_seat()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_seat jsonb;
BEGIN
  v_seat := public.cockpit_form_actor();
  IF NOT (coalesce((v_seat->>'ceo')::boolean, false) OR coalesce((v_seat->>'admin')::boolean, false)) THEN
    RAISE EXCEPTION 'Only an admin or the CEO edits forms.' USING ERRCODE = '42501';
  END IF;
  RETURN v_seat;
END $$;

-- The routing the editor shows and sets (4.9.2): the two schedule rows
-- (20261102c), the low-score line and the schedule's master switch (read
-- only here; it is a deploy step).
CREATE OR REPLACE FUNCTION public.cockpit_form_editor_routing()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_sched jsonb;
  v_low jsonb;
  v_master jsonb;
BEGIN
  IF to_regclass('public.cockpit_form_schedules') IS NOT NULL THEN
    SELECT coalesce(jsonb_object_agg(s.form_key, jsonb_build_object(
             'on', s."on", 'rule', s.rule, 'updatedAt', s.updated_at,
             'updatedBy', public.cockpit_form_editor_role(s.updated_by))), '{}'::jsonb)
      INTO v_sched FROM public.cockpit_form_schedules s WHERE s.form_key IN ('nps','csat');
  END IF;
  SELECT c.value INTO v_low FROM public.cockpit_settings c WHERE c.key = 'voice.low_score';
  SELECT c.value INTO v_master FROM public.cockpit_settings c WHERE c.key = 'forms.schedule';
  RETURN jsonb_build_object(
    'schedules', v_sched,
    'lowScore', CASE WHEN jsonb_typeof(v_low->'max') = 'number' THEN jsonb_build_object('max', (v_low->>'max')::integer) END,
    'scheduleOn', CASE WHEN jsonb_typeof(v_master->'on') = 'boolean' THEN (v_master->>'on')::boolean END,
    'note', CASE
      WHEN v_sched IS NULL THEN 'The schedules open after the next cockpit update.'
      WHEN jsonb_typeof(v_master->'on') IS DISTINCT FROM 'boolean' OR NOT (v_master->>'on')::boolean
        THEN 'The automatic schedule is off for every client; these rules apply once it is turned on.'
      ELSE 'The automatic schedule runs every morning at 10:00 Kuwait time.' END);
END $$;

-- One form's line on the editor's list.
CREATE OR REPLACE FUNCTION public.cockpit_form_editor_row(p public.cockpit_forms)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_kind jsonb := public.cockpit_form_editor_kind(p);
  v_version integer;
  v public.cockpit_form_versions;
  d public.cockpit_form_schema_drafts;
  v_live boolean;
BEGIN
  v_version := CASE WHEN (v_kind->>'editable')::boolean THEN public.cockpit_form_editor_version(p.key) ELSE p.version END;
  SELECT * INTO v FROM public.cockpit_form_versions x WHERE x.form_key = p.key AND x.version = v_version;
  SELECT * INTO d FROM public.cockpit_form_schema_drafts x WHERE x.form_key = p.key;
  IF (v_kind->>'group') = 'client' AND to_regprocedure('public.cockpit_form_client_live(text)') IS NOT NULL THEN
    v_live := public.cockpit_form_client_live(p.key);
  END IF;
  RETURN jsonb_build_object(
    'key', p.key,
    'title', coalesce(v.schema #>> '{title,en}', p.title),
    'titleAr', v.schema #>> '{title,ar}',
    'group', v_kind->>'group',
    'editable', (v_kind->>'editable')::boolean,
    'why', v_kind->>'why',
    'provider', p.provider,
    'audience', p.audience,
    'version', v_version,
    'registryVersion', p.version,
    'publishedAt', v.published_at,
    'publishedBy', CASE WHEN v.form_key IS NOT NULL THEN public.cockpit_form_editor_role(v.published_by) END,
    'questions', CASE WHEN jsonb_typeof(v.schema->'fields') = 'array' THEN jsonb_array_length(v.schema->'fields')
                      WHEN jsonb_typeof(p.schema->'fields') = 'array' THEN jsonb_array_length(p.schema->'fields') END,
    'live', v_live,
    'draft', CASE WHEN d.form_key IS NOT NULL THEN jsonb_build_object(
      'baseVersion', d.base_version, 'savedAt', d.saved_at,
      'savedBy', public.cockpit_form_editor_role(d.saved_by),
      'stale', d.base_version IS DISTINCT FROM v_version) END);
END $$;

REVOKE ALL ON FUNCTION
  public.cockpit_form_editor_version(text),
  public.cockpit_form_editor_kind(public.cockpit_forms),
  public.cockpit_form_editor_role(text),
  public.cockpit_form_editor_texts(jsonb),
  public.cockpit_form_editor_effect_label(text,text),
  public.cockpit_form_editor_read_map(jsonb),
  public.cockpit_form_editor_problem(text,jsonb,jsonb),
  public.cockpit_form_editor_seat(),
  public.cockpit_form_editor_routing(),
  public.cockpit_form_editor_row(public.cockpit_forms)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The browser RPCs

-- Every form, grouped (5.13), with the routing and the workspaces the real
-- preview can open on (4.9.7: open workspaces, Active first, by name).
CREATE OR REPLACE FUNCTION public.cockpit_form_editor_read()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_forms jsonb;
  v_ws jsonb;
BEGIN
  PERFORM public.cockpit_form_editor_seat();
  SELECT coalesce(jsonb_agg(x.item ORDER BY x.g, x.item->>'title'), '[]'::jsonb) INTO v_forms
    FROM (SELECT public.cockpit_form_editor_row(f) AS item,
                 CASE public.cockpit_form_editor_kind(f)->>'group' WHEN 'client' THEN 1 WHEN 'staff' THEN 2 ELSE 3 END AS g
            FROM public.cockpit_forms f) x;
  IF to_regclass('portal_data.workspaces') IS NOT NULL THEN
    EXECUTE $q$
      SELECT coalesce(jsonb_agg(jsonb_build_object('locationId', w.location_id, 'name', w.name, 'status', w.status)
                                ORDER BY (w.status = 'Active') DESC, lower(w.name), w.location_id), '[]'::jsonb)
        FROM portal_data.workspaces w
       WHERE w.location_id ~ '^[A-Za-z0-9_-]{1,100}$'
         AND coalesce(w.status, '') NOT IN ('Cancelled','Removed from sheet')$q$ INTO v_ws;
  END IF;
  RETURN jsonb_build_object(
    'forms', v_forms,
    'routing', public.cockpit_form_editor_routing(),
    'portalBase', 'https://portal.maharamedia.com',
    'workspaces', coalesce(v_ws, '[]'::jsonb));
END $$;

-- One form: the published schema, the draft (and whether it can publish),
-- the history, what the cockpit reads, and the registry record for a read
-- only form.
CREATE OR REPLACE FUNCTION public.cockpit_form_editor_read_one(p_form_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f public.cockpit_forms;
  v_kind jsonb;
  v_version integer;
  v public.cockpit_form_versions;
  d public.cockpit_form_schema_drafts;
  v_problem jsonb;
  v_history jsonb;
  v_reads jsonb;
BEGIN
  PERFORM public.cockpit_form_editor_seat();
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = p_form_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no form called %.', coalesce(p_form_key, '') USING ERRCODE = '22023';
  END IF;
  v_kind := public.cockpit_form_editor_kind(f);
  v_version := CASE WHEN (v_kind->>'editable')::boolean THEN public.cockpit_form_editor_version(f.key) ELSE f.version END;
  SELECT * INTO v FROM public.cockpit_form_versions x WHERE x.form_key = f.key AND x.version = v_version;
  SELECT * INTO d FROM public.cockpit_form_schema_drafts x WHERE x.form_key = f.key;
  IF d.form_key IS NOT NULL THEN
    v_problem := CASE
      WHEN d.base_version IS DISTINCT FROM v_version THEN jsonb_build_object('problem',
        format('Someone published version %s since you opened this. Reload it.', v_version), 'where', NULL)
      WHEN d.schema = v.schema THEN jsonb_build_object('problem', 'No changes yet.', 'where', NULL)
      ELSE public.cockpit_form_editor_problem(f.key, v.schema, d.schema) END;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'version', x.version, 'publishedAt', x.published_at,
           'publishedBy', public.cockpit_form_editor_role(x.published_by), 'note', x.note,
           'client', x.schema->>'v' = '1', 'current', x.version = v_version) ORDER BY x.version DESC), '[]'::jsonb)
    INTO v_history FROM public.cockpit_form_versions x WHERE x.form_key = f.key;
  SELECT coalesce(jsonb_agg(jsonb_build_object('effect', r.key,
           'label', public.cockpit_form_editor_effect_label(f.key, r.key), 'fields', r.value) ORDER BY r.key), '[]'::jsonb)
    INTO v_reads
    FROM jsonb_each(CASE WHEN jsonb_typeof(v.schema->'reads') = 'object' THEN v.schema->'reads' END) r;
  RETURN jsonb_build_object(
    'form', public.cockpit_form_editor_row(f),
    'published', CASE WHEN v.form_key IS NOT NULL AND (v_kind->>'editable')::boolean THEN jsonb_build_object(
      'version', v.version, 'schema', v.schema, 'publishedAt', v.published_at,
      'publishedBy', public.cockpit_form_editor_role(v.published_by), 'note', v.note) END,
    'draft', CASE WHEN d.form_key IS NOT NULL THEN jsonb_build_object(
      'schema', d.schema, 'baseVersion', d.base_version, 'savedAt', d.saved_at,
      'savedBy', public.cockpit_form_editor_role(d.saved_by),
      'stale', d.base_version IS DISTINCT FROM v_version,
      'problem', v_problem->>'problem', 'where', v_problem->>'where') END,
    'history', v_history,
    'reads', v_reads,
    -- A read-only form's record (staff forms: the keys formDefs.ts holds).
    'record', CASE WHEN NOT (v_kind->>'editable')::boolean THEN jsonb_build_object(
      'fields', coalesce((SELECT jsonb_agg(coalesce(q->>'key', q #>> '{}')) FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(f.schema->'fields') = 'array' THEN f.schema->'fields' END) q), '[]'::jsonb),
      'lives', f.schema->>'lives', 'typeformId', f.typeform_id) END);
END $$;

-- Save (or with p_schema NULL, discard) the draft of a client form. The
-- base is the published version the screen opened; an older one is refused.
CREATE OR REPLACE FUNCTION public.cockpit_form_draft_save(p_form_key text, p_schema jsonb, p_base_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb;
  f public.cockpit_forms;
  v_kind jsonb;
  v_version integer;
BEGIN
  v_seat := public.cockpit_form_editor_seat();
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = p_form_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no form called %.', coalesce(p_form_key, '') USING ERRCODE = '22023';
  END IF;
  v_kind := public.cockpit_form_editor_kind(f);
  IF NOT (v_kind->>'editable')::boolean THEN
    RAISE EXCEPTION '%', v_kind->>'why' USING ERRCODE = '22023';
  END IF;
  v_version := public.cockpit_form_editor_version(f.key);
  IF p_base_version IS NULL OR p_base_version < v_version THEN
    RAISE EXCEPTION 'Someone published version % since you opened this. Reload it.', v_version USING ERRCODE = '22023';
  ELSIF p_base_version > v_version THEN
    RAISE EXCEPTION 'There is no version % of this form. Reload it.', p_base_version USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('cockpit.audit_actor', v_seat->>'email', true);
  IF p_schema IS NULL OR p_schema = 'null'::jsonb THEN
    PERFORM set_config('cockpit.forms_action', 'forms.editor_discard', true);
    PERFORM set_config('cockpit.forms_draft_remove', 'on', true);
    DELETE FROM public.cockpit_form_schema_drafts x WHERE x.form_key = f.key;
    PERFORM set_config('cockpit.forms_draft_remove', '', true);
  ELSE
    IF jsonb_typeof(p_schema) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'A form is one object of questions. Reload it.' USING ERRCODE = '22023';
    END IF;
    IF octet_length(p_schema::text) > 65536 THEN
      RAISE EXCEPTION 'A form is at most 64 KB. Shorten its texts.' USING ERRCODE = '22023';
    END IF;
    IF p_schema->>'v' IS DISTINCT FROM '1' OR p_schema->>'key' IS DISTINCT FROM f.key THEN
      RAISE EXCEPTION 'This draft belongs to another form. Reload it.' USING ERRCODE = '22023';
    END IF;
    PERFORM set_config('cockpit.forms_action', 'forms.editor_draft', true);
    INSERT INTO public.cockpit_form_schema_drafts AS d (form_key, base_version, schema, saved_by, saved_at)
    VALUES (f.key, v_version, p_schema, v_seat->>'email', now())
    ON CONFLICT (form_key) DO UPDATE
      SET base_version = EXCLUDED.base_version, schema = EXCLUDED.schema,
          saved_by = EXCLUDED.saved_by, saved_at = now();
  END IF;
  PERFORM set_config('cockpit.forms_action', '', true);
  PERFORM set_config('cockpit.audit_actor', '', true);
  RETURN public.cockpit_form_editor_read_one(f.key);
END $$;

-- Publish a schema as the next version (shared by publish and restore). The
-- caller has gated, locked the form and checked the base.
CREATE OR REPLACE FUNCTION public.cockpit_form_editor_publish_schema(p_seat jsonb, p public.cockpit_forms,
  p_schema jsonb, p_note text, p_action text, p_base integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_published public.cockpit_form_versions;
  v_problem jsonb;
  v_next integer;
  v_registry boolean;
  v_added jsonb;
  v_removed jsonb;
BEGIN
  SELECT * INTO v_published FROM public.cockpit_form_versions x WHERE x.form_key = p.key AND x.version = p_base;
  IF p_schema = v_published.schema THEN
    RAISE EXCEPTION 'No changes yet.' USING ERRCODE = '22023';
  END IF;
  v_problem := public.cockpit_form_editor_problem(p.key, v_published.schema, p_schema);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION '%', v_problem->>'problem' USING ERRCODE = '22023', HINT = coalesce(v_problem->>'where', '');
  END IF;
  SELECT max(x.version) + 1 INTO v_next FROM public.cockpit_form_versions x WHERE x.form_key = p.key;
  -- The registry follows only a native client form; the exit survey on
  -- Typeform keeps its registry row until its go-live takes the newest v1
  -- version (4.9.2, 2.4).
  v_registry := p.provider = 'native';

  PERFORM set_config('cockpit.forms_action', p_action, true);
  PERFORM set_config('cockpit.audit_actor', p_seat->>'email', true);
  PERFORM set_config('cockpit.audit_source', 'cockpit', true);
  INSERT INTO public.cockpit_form_versions (form_key, version, schema, published_by, note)
  VALUES (p.key, v_next, p_schema, p_seat->>'email', left(p_note, 240));
  IF v_registry THEN
    UPDATE public.cockpit_forms x SET schema = p_schema, version = v_next,
           updated_by = p_seat->>'email', updated_at = now()
     WHERE x.key = p.key;
  END IF;
  PERFORM set_config('cockpit.forms_draft_remove', 'on', true);
  DELETE FROM public.cockpit_form_schema_drafts x WHERE x.form_key = p.key AND p_action = 'forms.editor_publish';
  PERFORM set_config('cockpit.forms_draft_remove', '', true);

  SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) INTO v_added
    FROM (SELECT f->>'key' k FROM jsonb_array_elements(p_schema->'fields') f
          EXCEPT SELECT f->>'key' FROM jsonb_array_elements(v_published.schema->'fields') f) a;
  SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb) INTO v_removed
    FROM (SELECT f->>'key' k FROM jsonb_array_elements(v_published.schema->'fields') f
          EXCEPT SELECT f->>'key' FROM jsonb_array_elements(p_schema->'fields') f) a;
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES (p_action, 'cockpit_forms', p.key, p_seat->>'email', 'client-success', 'cockpit',
          jsonb_build_object('version', p_base, 'schema_md5', md5(v_published.schema::text)),
          jsonb_build_object('version', v_next, 'schema_md5', md5(p_schema::text), 'note', left(p_note, 240)),
          jsonb_build_object('op', CASE WHEN p_action = 'forms.editor_restore' THEN 'restore' ELSE 'publish' END,
                             'form_key', p.key, 'registry', CASE WHEN v_registry THEN 'updated' ELSE 'left as it was' END,
                             'added', v_added, 'removed', v_removed));
  PERFORM set_config('cockpit.forms_action', '', true);
  PERFORM set_config('cockpit.audit_actor', '', true);
  PERFORM set_config('cockpit.audit_source', '', true);
  RETURN jsonb_build_object('version', v_next, 'registryUpdated', v_registry);
END $$;

REVOKE ALL ON FUNCTION public.cockpit_form_editor_publish_schema(jsonb, public.cockpit_forms, jsonb, text, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;

-- Publish the draft (4.9.4).
CREATE OR REPLACE FUNCTION public.cockpit_form_publish(p_form_key text, p_note text, p_base_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb;
  f public.cockpit_forms;
  v_kind jsonb;
  v_version integer;
  d public.cockpit_form_schema_drafts;
  v_note text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g')), '');
  v_out jsonb;
BEGIN
  v_seat := public.cockpit_form_editor_seat();
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = p_form_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no form called %.', coalesce(p_form_key, '') USING ERRCODE = '22023';
  END IF;
  v_kind := public.cockpit_form_editor_kind(f);
  IF NOT (v_kind->>'editable')::boolean THEN
    RAISE EXCEPTION '%', v_kind->>'why' USING ERRCODE = '22023';
  END IF;
  v_version := public.cockpit_form_editor_version(f.key);
  IF p_base_version IS DISTINCT FROM v_version THEN
    RAISE EXCEPTION 'Someone published version % since you opened this. Reload it.', v_version USING ERRCODE = '22023';
  END IF;
  SELECT * INTO d FROM public.cockpit_form_schema_drafts x WHERE x.form_key = f.key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No changes yet.' USING ERRCODE = '22023';
  END IF;
  IF d.base_version IS DISTINCT FROM v_version THEN
    RAISE EXCEPTION 'Someone published version % since you opened this. Reload it.', v_version USING ERRCODE = '22023';
  END IF;
  IF v_note IS NULL OR char_length(v_note) NOT BETWEEN 3 AND 240 THEN
    RAISE EXCEPTION 'Say what changed in a few words (3 to 240 characters); it shows in the history.' USING ERRCODE = '22023';
  END IF;
  v_out := public.cockpit_form_editor_publish_schema(v_seat, f, d.schema, v_note, 'forms.editor_publish', v_version);
  RETURN v_out || jsonb_build_object('read', public.cockpit_form_editor_read_one(f.key));
END $$;

-- Go back to an older version: its schema published as a new one, through
-- the same checks (4.9.5). A draft is kept; it reads stale until it is saved
-- again on the new version or discarded.
CREATE OR REPLACE FUNCTION public.cockpit_form_restore(p_form_key text, p_version integer, p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb;
  f public.cockpit_forms;
  v_kind jsonb;
  v_version integer;
  v_old public.cockpit_form_versions;
  v_extra text := nullif(btrim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g')), '');
  v_out jsonb;
BEGIN
  v_seat := public.cockpit_form_editor_seat();
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = p_form_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no form called %.', coalesce(p_form_key, '') USING ERRCODE = '22023';
  END IF;
  v_kind := public.cockpit_form_editor_kind(f);
  IF NOT (v_kind->>'editable')::boolean THEN
    RAISE EXCEPTION '%', v_kind->>'why' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_old FROM public.cockpit_form_versions x WHERE x.form_key = f.key AND x.version = p_version;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no version % of this form.', coalesce(p_version::text, '') USING ERRCODE = '22023';
  END IF;
  IF v_old.schema->>'v' IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'Version % is not a portal form, so it cannot come back here.', p_version USING ERRCODE = '22023';
  END IF;
  v_version := public.cockpit_form_editor_version(f.key);
  IF p_version = v_version THEN
    RAISE EXCEPTION 'Version % is the published one already.', p_version USING ERRCODE = '22023';
  END IF;
  v_out := public.cockpit_form_editor_publish_schema(v_seat, f, v_old.schema,
             'Restored version ' || p_version || coalesce(': ' || v_extra, ''), 'forms.editor_restore', v_version);
  RETURN v_out || jsonb_build_object('read', public.cockpit_form_editor_read_one(f.key));
END $$;

-- The routing (4.9.2): {nps?: {on?, rule?}, csat?: {on?, rule?}, lowScore?: {max}}.
-- A rule patch merges over the stored rule; the result must hold every key
-- of its form, each a whole number in its bounds, and nothing else.
CREATE OR REPLACE FUNCTION public.cockpit_form_routing_set(p_patch jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb;
  v_form text;
  v_part jsonb;
  v_rule jsonb;
  v_before jsonb;
  v_on boolean;
  v_old_on boolean;
  v_old_rule jsonb;
  b record;
  v_low jsonb;
  v_max jsonb;
  v_found boolean;
BEGIN
  v_seat := public.cockpit_form_editor_seat();
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR p_patch = '{}'::jsonb
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) k WHERE k NOT IN ('nps','csat','lowScore')) THEN
    RAISE EXCEPTION 'Change the NPS schedule, the onboarding survey schedule or the low-score line.' USING ERRCODE = '22023';
  END IF;

  FOREACH v_form IN ARRAY ARRAY['nps','csat'] LOOP
    CONTINUE WHEN NOT p_patch ? v_form;
    v_part := p_patch->v_form;
    IF jsonb_typeof(v_part) IS DISTINCT FROM 'object' OR v_part = '{}'::jsonb
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(v_part) k WHERE k NOT IN ('on','rule'))
       OR (v_part ? 'on' AND jsonb_typeof(v_part->'on') IS DISTINCT FROM 'boolean')
       OR (v_part ? 'rule' AND jsonb_typeof(v_part->'rule') IS DISTINCT FROM 'object') THEN
      RAISE EXCEPTION 'A schedule change is its switch and its rule.' USING ERRCODE = '22023';
    END IF;
    IF to_regclass('public.cockpit_form_schedules') IS NULL THEN
      RAISE EXCEPTION 'The schedules open after the next cockpit update.' USING ERRCODE = '55000';
    END IF;
    v_old_on := NULL;
    v_old_rule := NULL;
    SELECT s."on", s.rule INTO v_old_on, v_old_rule FROM public.cockpit_form_schedules s WHERE s.form_key = v_form FOR UPDATE;
    v_found := FOUND;
    v_before := CASE WHEN v_found THEN jsonb_build_object('on', v_old_on, 'rule', v_old_rule) END;
    v_rule := CASE WHEN jsonb_typeof(v_old_rule) = 'object' THEN v_old_rule ELSE '{}'::jsonb END
              || coalesce(v_part->'rule', '{}'::jsonb);
    v_on := coalesce((v_part->>'on')::boolean, v_old_on);
    IF v_on IS NULL THEN
      RAISE EXCEPTION 'Say whether this schedule is on.' USING ERRCODE = '22023';
    END IF;
    -- Each key, its words and its bounds (4.9.2).
    FOR b IN SELECT * FROM (VALUES
        ('nps', 'firstDay', 'The first NPS day after launch', 30, 180),
        ('nps', 'everyDays', 'The days between NPS rounds', 30, 365),
        ('nps', 'remindAfterDays', 'The days before an unanswered NPS shows on Today', 1, 14),
        ('csat', 'afterLaunchDays', 'The days after launch before the onboarding survey', 0, 30),
        ('csat', 'whatsappAfterDays', 'The day after launch the WhatsApp link goes', 0, 14),
        ('csat', 'snoozeDays', 'The days "Not now" waits', 1, 14),
        ('csat', 'reissues', 'The number of re-tries', 0, 5),
        ('csat', 'retryAfterDays', 'The days between re-tries', 1, 30),
        ('csat', 'maxAgeDays', 'The last day after launch it can go', 14, 120)
      ) AS x(form, k, words, lo, hi) WHERE x.form = v_form
    LOOP
      IF NOT v_rule ? b.k THEN
        RAISE EXCEPTION '% is missing. Set it, then save.', b.words USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(v_rule->b.k) IS DISTINCT FROM 'number' OR (v_rule->>b.k) !~ '^-?[0-9]+$'
         OR (v_rule->>b.k)::numeric NOT BETWEEN b.lo AND b.hi THEN
        RAISE EXCEPTION '% is a whole number from % to %.', b.words, b.lo, b.hi USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_rule) k
                WHERE NOT (k = ANY(CASE WHEN v_form = 'nps' THEN ARRAY['firstDay','everyDays','remindAfterDays']
                                        ELSE ARRAY['afterLaunchDays','whatsappAfterDays','snoozeDays','reissues',
                                                   'retryAfterDays','maxAgeDays'] END))) THEN
      RAISE EXCEPTION 'That rule has a setting the schedule does not read. Reload it.' USING ERRCODE = '22023';
    END IF;
    IF v_form = 'csat' AND ((v_rule->>'maxAgeDays')::integer <= (v_rule->>'afterLaunchDays')::integer
                            OR (v_rule->>'maxAgeDays')::integer <= (v_rule->>'whatsappAfterDays')::integer) THEN
      RAISE EXCEPTION 'The last day it can go must come after the day it first goes.' USING ERRCODE = '22023';
    END IF;

    IF v_before IS NOT DISTINCT FROM jsonb_build_object('on', v_on, 'rule', v_rule) THEN
      CONTINUE;
    END IF;
    PERFORM set_config('cockpit.audit_actor', v_seat->>'email', true);
    PERFORM set_config('cockpit.forms_action', 'forms.routing_set', true);
    INSERT INTO public.cockpit_form_schedules AS s (form_key, "on", rule, updated_by, updated_at)
    VALUES (v_form, v_on, v_rule, v_seat->>'email', now())
    ON CONFLICT (form_key) DO UPDATE SET "on" = EXCLUDED."on", rule = EXCLUDED.rule,
      updated_by = EXCLUDED.updated_by, updated_at = now();
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('forms.routing_set', 'cockpit_form_schedules', v_form, v_seat->>'email', 'client-success', 'cockpit',
            v_before, jsonb_build_object('on', v_on, 'rule', v_rule),
            jsonb_build_object('op', 'schedule', 'form_key', v_form));
  END LOOP;

  IF p_patch ? 'lowScore' THEN
    v_max := p_patch #> '{lowScore,max}';
    IF jsonb_typeof(p_patch->'lowScore') IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch->'lowScore') k WHERE k <> 'max')
       OR jsonb_typeof(v_max) IS DISTINCT FROM 'number' OR (v_max #>> '{}') !~ '^[0-9]+$'
       OR (v_max #>> '{}')::numeric NOT BETWEEN 0 AND 8 THEN
      RAISE EXCEPTION 'The low-score line is a whole number from 0 to 8.' USING ERRCODE = '22023';
    END IF;
    SELECT c.value INTO v_low FROM public.cockpit_settings c WHERE c.key = 'voice.low_score' FOR UPDATE;
    IF (v_low->'max') IS DISTINCT FROM v_max THEN
      INSERT INTO public.cockpit_settings AS c (key, value, updated_by)
      VALUES ('voice.low_score', jsonb_build_object('max', v_max), v_seat->>'email')
      ON CONFLICT (key) DO UPDATE
        SET value = CASE WHEN jsonb_typeof(c.value) = 'object' THEN c.value ELSE '{}'::jsonb END
                    || jsonb_build_object('max', v_max),
            updated_by = EXCLUDED.updated_by, updated_at = now();
      INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
      VALUES ('forms.routing_set', 'cockpit_settings', 'voice.low_score', v_seat->>'email', 'client-success', 'cockpit',
              CASE WHEN v_low IS NOT NULL THEN jsonb_build_object('value', v_low) END,
              jsonb_build_object('value', coalesce(v_low, '{}'::jsonb) || jsonb_build_object('max', v_max)),
              jsonb_build_object('op', 'low_score'));
    END IF;
  END IF;
  PERFORM set_config('cockpit.forms_action', '', true);
  PERFORM set_config('cockpit.audit_actor', '', true);
  RETURN public.cockpit_form_editor_routing();
END $$;

-- ---------------------------------------------------------------------------
-- 4. cockpit_form_registry_apply (2.2): the live body (20261101l) with two
--    changes. A native client form changes only in the forms editor, and a
--    patch that names schema, version or fields is refused the same way for
--    every client form; staff forms keep W19's refusal word for word.

CREATE OR REPLACE FUNCTION public.cockpit_form_registry_apply(p_form_key text, p_patch jsonb, p_actor jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_bad constant text := 'Change only provider and owners, with make, shadow or cockpit for effects this form has.';
  f public.cockpit_forms;
  v_actor jsonb := CASE WHEN jsonb_typeof(p_actor) = 'object' THEN p_actor ELSE '{}'::jsonb END;
  v_via text;
  v_who text;
  v_owners jsonb;
  v_provider text;
  v_effects jsonb := '[]'::jsonb;
  e jsonb;
  v_owner text;
  v_clause text;
  v_prev_action text := current_setting('cockpit.forms_action', true);
  v_prev_actor text := current_setting('cockpit.audit_actor', true);
  v_prev_source text := current_setting('cockpit.audit_source', true);
  k text;
BEGIN
  v_via := v_actor->>'via';
  v_who := v_actor->>'who';
  IF v_via IS NULL OR v_via NOT IN ('cockpit','cutover','cutover-rollback') THEN
    RAISE EXCEPTION 'The registry changes only from the cockpit or the cut-over.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = p_form_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'There is no form called %.', coalesce(p_form_key, '') USING ERRCODE = '22023';
  END IF;
  -- The allow-list (waves 1-2, 4.3): checkin keeps every 2b rule; the
  -- termination survey, the pause request, kickoff and the Brand Blueprint
  -- take owner changes from the CEO seat; the five staff forms are set in
  -- code (formDefs.ts, W19) and every other form by migration. Waves 3-4
  -- (4.9): a native client form, and any patch that names its questions,
  -- changes only in the forms editor (cockpit_form_publish).
  IF f.key IN ('extension','pause','resume','churn_confirm','mrr') THEN
    RAISE EXCEPTION 'This form is set in the cockpit''s code until the form editor ships.' USING ERRCODE = '22023';
  ELSIF f.audience = 'client' AND (
          (f.provider = 'native' AND f.key NOT IN ('exit_survey','pause_request'))
          OR (jsonb_typeof(p_patch) = 'object'
              AND EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) x WHERE x IN ('schema','version','fields','title')))) THEN
    RAISE EXCEPTION 'Edit client forms in the forms editor.' USING ERRCODE = '22023';
  ELSIF f.key NOT IN ('checkin','exit_survey','pause_request','kickoff','blueprint') THEN
    RAISE EXCEPTION 'That form changes only by migration until its editor ships.' USING ERRCODE = '22023';
  ELSIF f.key <> 'checkin' AND NOT (v_via = 'cockpit' AND v_who = 'ceo') THEN
    RAISE EXCEPTION 'Only the CEO changes who delivers this form''s steps.' USING ERRCODE = '42501';
  END IF;

  -- The patch's shape.
  IF jsonb_typeof(p_patch) IS DISTINCT FROM 'object' OR p_patch = '{}'::jsonb
     OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_patch) x WHERE x NOT IN ('provider','owners')) THEN
    RAISE EXCEPTION '%', v_bad USING ERRCODE = '22023';
  END IF;
  IF p_patch ? 'provider' AND (jsonb_typeof(p_patch->'provider') IS DISTINCT FROM 'string'
                               OR p_patch->>'provider' NOT IN ('typeform','native')) THEN
    RAISE EXCEPTION '%', v_bad USING ERRCODE = '22023';
  END IF;
  v_owners := p_patch->'owners';
  IF p_patch ? 'owners' THEN
    IF jsonb_typeof(v_owners) = 'string' THEN
      IF v_owners #>> '{}' NOT IN ('make','shadow','cockpit') THEN
        RAISE EXCEPTION '%', v_bad USING ERRCODE = '22023';
      END IF;
    ELSIF jsonb_typeof(v_owners) = 'object' AND v_owners <> '{}'::jsonb THEN
      FOR k IN SELECT x FROM jsonb_object_keys(v_owners) x LOOP
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(f.effects) q WHERE q->>'key' = k)
           OR jsonb_typeof(v_owners->k) IS DISTINCT FROM 'string'
           OR v_owners->>k NOT IN ('make','shadow','cockpit') THEN
          RAISE EXCEPTION '%', v_bad USING ERRCODE = '22023';
        END IF;
      END LOOP;
    ELSE
      RAISE EXCEPTION '%', v_bad USING ERRCODE = '22023';
    END IF;
  END IF;

  -- The provider: native only through the cut-over; any other move by the
  -- CEO seat or the cut-over's rollback.
  v_provider := coalesce(p_patch->>'provider', f.provider);
  IF v_provider IS DISTINCT FROM f.provider AND f.key <> 'checkin' THEN
    -- Only the termination survey and the pause request move, forward to
    -- the cockpit, by the CEO (gated above); kickoff and the Blueprint keep
    -- where they are filled.
    IF NOT (f.key IN ('exit_survey','pause_request') AND f.provider = 'typeform' AND v_provider = 'native') THEN
      RAISE EXCEPTION 'Only the termination survey and the pause request move here, from Typeform to the cockpit.'
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_provider IS DISTINCT FROM f.provider THEN
    IF v_provider = 'native' AND v_via IS DISTINCT FROM 'cutover' THEN
      RAISE EXCEPTION 'The 1-1 notes open in the cockpit only through the switch-over function at the cut-over hour.'
        USING ERRCODE = '42501';
    END IF;
    IF NOT (v_who = 'ceo' OR v_via IN ('cutover','cutover-rollback')) THEN
      RAISE EXCEPTION 'Only the CEO switches where the 1-1 notes are filled: it goes with closing the Typeform and turning Make off.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- The effects, in the registry's order, each keeping its key, delivery and label.
  FOR e IN SELECT q FROM jsonb_array_elements(f.effects) WITH ORDINALITY z(q, o) ORDER BY o LOOP
    v_owner := CASE WHEN jsonb_typeof(v_owners) = 'string' THEN v_owners #>> '{}'
                    WHEN jsonb_typeof(v_owners) = 'object' AND v_owners ? (e->>'key') THEN v_owners->>(e->>'key')
                    ELSE e->>'owner' END;
    -- Delivery paths are checked for the 1-1 notes; the other forms' owners are a record of who delivers.
    IF v_owner = 'cockpit' AND e->>'owner' IS DISTINCT FROM 'cockpit' AND f.key = 'checkin' THEN
      v_clause := public.cockpit_form_delivery_ready(f.key, e->>'key');
      IF v_clause IS NOT NULL THEN
        RAISE EXCEPTION '% cannot move to the cockpit yet: %.', e->>'label', v_clause USING ERRCODE = '55000';
      END IF;
    END IF;
    v_effects := v_effects || jsonb_build_array(e || jsonb_build_object('owner', v_owner));
  END LOOP;
  IF v_provider = 'native' AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(v_effects) q
        WHERE q->>'key' IN ('call_form','call_match') AND q->>'owner' IS DISTINCT FROM 'cockpit') THEN
    RAISE EXCEPTION 'Move the notes row and the recording match to the cockpit with the switch, or the notes reach no client brief.'
      USING ERRCODE = '22023';
  END IF;

  -- Nothing to change: the view, and no row.
  IF v_provider = f.provider AND v_effects = f.effects THEN
    RETURN public.cockpit_form_registry_view(f);
  END IF;

  PERFORM set_config('cockpit.forms_action', 'forms.registry_set', true);
  PERFORM set_config('cockpit.audit_actor', coalesce(nullif(btrim(v_actor->>'email'), ''), v_via), true);
  PERFORM set_config('cockpit.audit_source', v_via, true);
  UPDATE public.cockpit_forms x
     SET provider = v_provider, effects = v_effects,
         updated_by = coalesce(nullif(btrim(v_actor->>'email'), ''), v_via), updated_at = now()
   WHERE x.key = f.key
  RETURNING * INTO f;
  -- The flip closes every open shadow draft in the same transaction.
  IF v_provider = 'native' THEN
    PERFORM public.cockpit_form_shadow_close(f.key);
  END IF;
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev_action, ''), true);
  PERFORM set_config('cockpit.audit_actor', coalesce(v_prev_actor, ''), true);
  PERFORM set_config('cockpit.audit_source', coalesce(v_prev_source, ''), true);
  RETURN public.cockpit_form_registry_view(f);
END $$;

-- ---------------------------------------------------------------------------
-- 5. The editor's door opens with this file (cockpit_form_doors, 20261102a).
--    A merge, never an overwrite; a second apply touches nothing.

SELECT set_config('cockpit.audit_actor', 'migration 20261102d', true);
INSERT INTO public.cockpit_settings (key, value, updated_by)
VALUES ('forms.doors', '{"editor":true}'::jsonb, 'migration 20261102d')
ON CONFLICT (key) DO UPDATE
  SET value = public.cockpit_settings.value || '{"editor":true}'::jsonb,
      updated_by = 'migration 20261102d', updated_at = now()
  WHERE NOT (public.cockpit_settings.value @> '{"editor":true}'::jsonb);
SELECT set_config('cockpit.audit_actor', '', true);

-- ---------------------------------------------------------------------------
-- 6. Grants: every new browser RPC to signed-in seats (the gate is inside),
--    the replaced registry apply to the owner only (2.2), the helpers to none.

REVOKE ALL ON FUNCTION
  public.cockpit_form_editor_read(),
  public.cockpit_form_editor_read_one(text),
  public.cockpit_form_draft_save(text,jsonb,integer),
  public.cockpit_form_publish(text,text,integer),
  public.cockpit_form_restore(text,integer,text),
  public.cockpit_form_routing_set(jsonb),
  public.cockpit_form_registry_apply(text,jsonb,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.cockpit_form_editor_read(),
  public.cockpit_form_editor_read_one(text),
  public.cockpit_form_draft_save(text,jsonb,integer),
  public.cockpit_form_publish(text,text,integer),
  public.cockpit_form_restore(text,integer,text),
  public.cockpit_form_routing_set(jsonb)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
