-- The billing rails (docs/forms/WAVE12-CONTRACT.md 2.4, 3.1, 3.3 and build
-- 4.1; plan B0). Creative Triage (bldgtotkfmhoxmlzowdx). Additive; applies
-- twice. Migration m of the waves 1-2 block, after 20261101l.
--
-- Money edits from the cockpits reach the client's card on Clients - Mahara
-- through the billing item of the ClickUp writeback queue (20261009j). This
-- file widens what one billing event may write and makes every new writer
-- safe to switch on one kind at a time:
--
-- 1. Events take the kinds mrr, ltv and late, and the source system (the
--    cockpit itself: an extension cleared on end, a daily LTV, a late spell).
-- 2. cockpit_billing_writeback_writes gains Resume On, Churn Date, Churn
--    Reason, Churn Type, MRR, LTV and the will-not-continue checkbox (3.3).
--    A churn writes Churn Date first, then Client Status (a ClickUp
--    automation appears to date cards when the status moves, 20261101g).
-- 3. cockpit_billing_writeback_comment: the silent card comment of each
--    event (3.3), roles not names, never an email. The enqueue trigger puts it
--    in payload.comment beside the seat role.
-- 4. The trigger queues churn and mrr from a person, and extension, ltv and
--    late from the system; a system pause is never queued.
-- 5. cockpit_clickup_fields: the stored ClickUp field map (W7), read daily by
--    clickup-writeback job billing_doctor. Option names are checked against
--    it (cockpit_churn_reason_card: register "Completed term" is the card's
--    "Completed term, did not renew"; Other is never written).
-- 6. cockpit_billing_detail: the one builder of an event's detail, called by
--    the canary here and by the churn confirm (o) and the money acts (p).
-- 7. cockpit_billing_mode: what the writer last reported of its billing
--    switch (CLICKUP_WRITEBACK_APPLY_BILLING, _BILLING_KINDS,
--    _BILLING_ONLY_CARDS). The general CLICKUP_WRITEBACK_APPLY no longer
--    opens billing (W2).
-- 8. Voids (cockpit_billing_event_voids) and the held-edit review
--    (cockpit_billing_held_release, W20): dry_run stays terminal for the
--    claim (cockpit_clickup_writeback_claim is not touched), so each kind
--    opening releases, re-records, closes or voids its held edits one by one,
--    a person deciding each.
-- 9. cockpit_billing_canary: an owner-only door that writes only the test
--    card 86eywg1cq (W14).
-- 10. pg_cron mahara-clickup-writeback-billing-doctor, daily at 03:41 UTC.
--
-- Nothing here reaches ClickUp: every billing item stays dry_run until
-- CLICKUP_WRITEBACK_APPLY_BILLING is exactly "true" and its kind is listed in
-- CLICKUP_WRITEBACK_BILLING_KINDS (contract 1.4).
--
-- Every new table has row security and service_role grants only; every new
-- or replaced function is revoked from all four roles, then granted exactly as
-- 2.4 says. Each replaced body is checked first against the body the contract
-- read (the drift guard, 2.1). pg_cron, pg_net and the vault are touched only
-- inside the cron block, which the PGlite test strips.
--
-- How we know it works: apps/media-buyer-cockpit/scripts/billing-rails-supabase.test.ts
-- and supabase/functions/clickup-writeback/{billing,queue,run}.test.ts.
-- Rollback: the deploy saves both replaced bodies and the trigger definition
-- to notes/forms-w12/deploy/before-*.sql; restoring them puts back 20261009j's
-- behaviour. The two new tables are inert without their functions.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard: each body this file replaces is the one the contract read
--    (2.2's live body md5) or the one this file installs (a second apply).

DO $$
DECLARE f record; v_md5 text;
BEGIN
  FOR f IN SELECT * FROM (VALUES
    ('cockpit_billing_writeback_writes(text,text,text,jsonb)', '957894a2a6ce3ae8f5a9c9c9acc1eaab', 'dc073d43dfc0c8ae6c610f97d2c75eb6'),
    ('cockpit_billing_writeback_enqueue()', 'ce6cff4631816e5352852b3726dc832d', '27ec300b559728050b72aaab25329b93')
  ) AS x(sig, live, after) LOOP
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_md5
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.' || f.sig);
    IF v_md5 IS NULL OR v_md5 NOT IN (f.live, f.after) THEN
      RAISE EXCEPTION '% changed since the waves 1-2 contract read it; stop and re-read it.', 'public.' || f.sig
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Kinds and sources (guarded swaps: each list is read from the live CHECK
--    and widened, so a kind another file added is kept)

DO $kinds$
DECLARE r record; v_def text; v_live text[]; v_all text[];
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('cockpit_billing_events_kind_check', 'kind', ARRAY['mrr', 'ltv', 'late']),
    ('cockpit_billing_events_source_check', 'source', ARRAY['system'])
  ) AS x(con, col, adds) LOOP
    SELECT pg_get_constraintdef(c.oid) INTO v_def
      FROM pg_catalog.pg_constraint c
     WHERE c.conrelid = 'public.cockpit_billing_events'::regclass AND c.conname = r.con;
    IF v_def IS NULL THEN
      RAISE EXCEPTION 'cockpit_billing_events has no %; read the live table before applying 20261101m.', r.con;
    END IF;
    IF v_def !~* ('^CHECK \(+' || r.col || ' ') THEN
      RAISE EXCEPTION '% is not a list of values (%); read it before applying 20261101m.', r.con, v_def;
    END IF;
    SELECT coalesce(array_agg(DISTINCT m[1]), '{}'::text[]) INTO v_live
      FROM regexp_matches(v_def, '''([a-z_]+)''', 'g') AS m;
    IF cardinality(v_live) = 0 THEN
      RAISE EXCEPTION 'No value could be read from % (%); read it before applying 20261101m.', r.con, v_def;
    END IF;
    IF v_live @> r.adds THEN CONTINUE; END IF;
    SELECT array_agg(DISTINCT k ORDER BY k) INTO v_all FROM unnest(v_live || r.adds) AS k;
    EXECUTE format('ALTER TABLE public.cockpit_billing_events DROP CONSTRAINT %I', r.con);
    EXECUTE format('ALTER TABLE public.cockpit_billing_events ADD CONSTRAINT %I CHECK (%I IN (%s))', r.con, r.col,
      (SELECT string_agg(quote_literal(k), ', ' ORDER BY k) FROM unnest(v_all) AS k));
  END LOOP;
END
$kinds$;

-- ---------------------------------------------------------------------------
-- 2. The stored ClickUp field map (W7)
--
-- One row per field of a list, as clickup-writeback's billing_doctor last read
-- it. Every row of one read carries the same read_at, so the newest read is
-- the map and a field ClickUp removed simply drops out of it (its row stays as
-- history; nothing deletes here).

CREATE TABLE IF NOT EXISTS public.cockpit_clickup_fields (
  list_id text NOT NULL CHECK (list_id ~ '^[0-9]{6,20}$'),
  field_id text PRIMARY KEY CHECK (field_id ~ '^[A-Za-z0-9-]{8,64}$'),
  name text NOT NULL,
  type text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array'),
  read_at timestamptz NOT NULL,
  read_by text NOT NULL
);
CREATE INDEX IF NOT EXISTS cockpit_clickup_fields_list_read ON public.cockpit_clickup_fields(list_id, read_at DESC);
COMMENT ON TABLE public.cockpit_clickup_fields IS
  'The ClickUp field map (waves 1-2 W7): each field of a list as clickup-writeback billing_doctor last read it, options as [{id, name, orderindex}]. The rows of the newest read_at per list are the map. Written only by cockpit_clickup_fields_put.';
ALTER TABLE public.cockpit_clickup_fields ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cockpit_clickup_fields FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.cockpit_clickup_fields TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Voids: a billing event a person took back before it reached the card

CREATE TABLE IF NOT EXISTS public.cockpit_billing_event_voids (
  event_id bigint PRIMARY KEY REFERENCES public.cockpit_billing_events(id),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 4 AND 300),
  voided_by text NOT NULL CHECK (char_length(btrim(voided_by)) > 0),
  voided_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.cockpit_billing_event_voids IS
  'Billing events taken back before they reached the ClickUp card (waves 1-2 2.4). A record: never changed or deleted. Written by cockpit_billing_event_void, cockpit_billing_event_void_owner and cockpit_billing_held_release; readers of billing events (cockpit_extensions_v) leave voided events out.';
ALTER TABLE public.cockpit_billing_event_voids ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cockpit_billing_event_voids FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.cockpit_billing_event_voids TO service_role;

-- Both tables leave an audit row. The field map is read every day, so only a
-- new field or a changed name, type or option list is recorded, never a read.
CREATE OR REPLACE FUNCTION public.cockpit_billing_rails_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor text;
BEGIN
  SELECT lower(btrim(u.email)) INTO v_actor FROM auth.users u WHERE u.id = auth.uid();
  v_actor := coalesce(v_actor, nullif(current_setting('cockpit.audit_actor', true), ''), session_user::text);
  IF TG_TABLE_NAME = 'cockpit_clickup_fields' THEN
    IF TG_OP = 'UPDATE' AND OLD.name IS NOT DISTINCT FROM NEW.name AND OLD.type IS NOT DISTINCT FROM NEW.type
       AND OLD.options IS NOT DISTINCT FROM NEW.options AND OLD.list_id IS NOT DISTINCT FROM NEW.list_id THEN
      RETURN NEW;
    END IF;
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('billing.field_map.' || lower(TG_OP), TG_TABLE_NAME, NEW.field_id, v_actor, 'clickup-writeback', 'supabase',
            CASE WHEN TG_OP = 'UPDATE' THEN jsonb_build_object('list', OLD.list_id, 'name', OLD.name, 'type', OLD.type, 'options', OLD.options) END,
            jsonb_build_object('list', NEW.list_id, 'name', NEW.name, 'type', NEW.type, 'options', NEW.options),
            jsonb_build_object('read_at', NEW.read_at, 'read_by', NEW.read_by));
  ELSE
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('billing.event_void', TG_TABLE_NAME, NEW.event_id::text, v_actor,
            coalesce(nullif(current_setting('cockpit.audit_app', true), ''), 'cockpit'), 'supabase', NULL, to_jsonb(NEW),
            (SELECT jsonb_build_object('kind', e.kind, 'task', e.clickup_task_id, 'source', e.source, 'at', e.at)
               FROM public.cockpit_billing_events e WHERE e.id = NEW.event_id));
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_billing_rails_refuse()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION '% is a record: its rows are never changed or deleted.', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;

DROP TRIGGER IF EXISTS cockpit_clickup_fields_audit ON public.cockpit_clickup_fields;
CREATE TRIGGER cockpit_clickup_fields_audit AFTER INSERT OR UPDATE ON public.cockpit_clickup_fields
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_billing_rails_audit();
DROP TRIGGER IF EXISTS cockpit_clickup_fields_no_delete ON public.cockpit_clickup_fields;
CREATE TRIGGER cockpit_clickup_fields_no_delete BEFORE DELETE ON public.cockpit_clickup_fields
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_billing_rails_refuse();
DROP TRIGGER IF EXISTS cockpit_clickup_fields_no_truncate ON public.cockpit_clickup_fields;
CREATE TRIGGER cockpit_clickup_fields_no_truncate BEFORE TRUNCATE ON public.cockpit_clickup_fields
  FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_billing_rails_refuse();

DROP TRIGGER IF EXISTS cockpit_billing_event_voids_audit ON public.cockpit_billing_event_voids;
CREATE TRIGGER cockpit_billing_event_voids_audit AFTER INSERT ON public.cockpit_billing_event_voids
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_billing_rails_audit();
DROP TRIGGER IF EXISTS cockpit_billing_event_voids_no_change ON public.cockpit_billing_event_voids;
CREATE TRIGGER cockpit_billing_event_voids_no_change BEFORE UPDATE OR DELETE ON public.cockpit_billing_event_voids
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_billing_rails_refuse();
DROP TRIGGER IF EXISTS cockpit_billing_event_voids_no_truncate ON public.cockpit_billing_event_voids;
CREATE TRIGGER cockpit_billing_event_voids_no_truncate BEFORE TRUNCATE ON public.cockpit_billing_event_voids
  FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_billing_rails_refuse();

-- ---------------------------------------------------------------------------
-- 4. The field map's writer and readers

-- One list's field read from ClickUp (GET list/{id}/field), as returned. An
-- empty read keeps the stored map: ClickUp returning nothing is not evidence
-- the fields are gone.
CREATE OR REPLACE FUNCTION public.cockpit_clickup_fields_put(p_list text, p_fields jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_at timestamptz := clock_timestamp(); v_n integer;
BEGIN
  IF coalesce(p_list, '') !~ '^[0-9]{6,20}$' THEN
    RAISE EXCEPTION 'That is not a ClickUp list id.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_fields) IS DISTINCT FROM 'array' OR jsonb_array_length(p_fields) = 0 THEN
    RAISE EXCEPTION 'ClickUp returned no fields for list %, so the stored field map was kept.', p_list USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.audit_actor', 'clickup-writeback billing_doctor', true);
  INSERT INTO public.cockpit_clickup_fields AS t(list_id, field_id, name, type, options, read_at, read_by)
  SELECT DISTINCT ON (f->>'id') p_list, f->>'id',
         coalesce(nullif(btrim(f->>'name'), ''), '(no name)'),
         coalesce(nullif(btrim(f->>'type'), ''), 'unknown'),
         coalesce((SELECT jsonb_agg(jsonb_build_object('id', o->>'id', 'name', o->>'name', 'orderindex', o->'orderindex') ORDER BY n)
                     FROM jsonb_array_elements(CASE WHEN jsonb_typeof(f->'type_config'->'options') = 'array'
                                                    THEN f->'type_config'->'options' ELSE '[]'::jsonb END) WITH ORDINALITY AS x(o, n)
                    WHERE jsonb_typeof(o) = 'object'), '[]'::jsonb),
         v_at, 'clickup-writeback billing_doctor'
    FROM jsonb_array_elements(p_fields) AS f
   WHERE jsonb_typeof(f) = 'object' AND coalesce(f->>'id', '') ~ '^[A-Za-z0-9-]{8,64}$'
  ON CONFLICT (field_id) DO UPDATE SET
    list_id = EXCLUDED.list_id, name = EXCLUDED.name, type = EXCLUDED.type, options = EXCLUDED.options,
    read_at = EXCLUDED.read_at, read_by = EXCLUDED.read_by;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'ClickUp returned no field with an id for list %, so the stored field map was kept.', p_list USING ERRCODE = '22023';
  END IF;
  RETURN v_n;
END $$;
COMMENT ON FUNCTION public.cockpit_clickup_fields_put(text, jsonb) IS
  'clickup-writeback billing_doctor: stores one list''s field read (W7). Every field of the read gets the same read_at; an empty read is refused and the stored map kept.';

-- The one field of Clients - Mahara whose id starts with the prefix, from the
-- newest read: {field_id, name, type, options, read_at}. NULL when no field or
-- more than one matches, so a prefix is never a guess.
CREATE OR REPLACE FUNCTION public.cockpit_clickup_field(p_prefix text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE v_n integer; v_row jsonb;
BEGIN
  IF coalesce(p_prefix, '') !~ '^[A-Za-z0-9-]{4,64}$' THEN RETURN NULL; END IF;
  SELECT count(*), (array_agg(jsonb_build_object('field_id', f.field_id, 'name', f.name, 'type', f.type,
                                                 'options', f.options, 'read_at', f.read_at)))[1]
    INTO v_n, v_row
    FROM public.cockpit_clickup_fields f
   WHERE f.list_id = '901816559981'
     AND f.read_at = (SELECT max(m.read_at) FROM public.cockpit_clickup_fields m WHERE m.list_id = '901816559981')
     AND left(f.field_id, length(p_prefix)) = p_prefix;
  RETURN CASE WHEN v_n = 1 THEN v_row END;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_clickup_option_ok(p_prefix text, p_name text)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE v_field jsonb := public.cockpit_clickup_field(p_prefix);
BEGIN
  IF v_field IS NULL OR nullif(btrim(coalesce(p_name, '')), '') IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM jsonb_array_elements(v_field->'options') o
                  WHERE lower(btrim(o->>'name')) = lower(btrim(p_name)));
END $$;

-- The card's Churn Reason option for a register reason, from the stored map
-- (never a copy of the name): "Completed term" (and the register's own
-- "Completed term, did not renew") is the card's "Completed term, did not
-- renew"; Other is never written; any other reason is the option of the same
-- name when the stored Churn Reason field (796f25e7) has it, else NULL, and
-- the churn writes skip that one field. With no stored map at all (the billing
-- doctor has not read the field yet, or its read failed) nothing is decided
-- here: the reason goes on as named and clickup-writeback's softMissing judges
-- it against the live list at write time, so a valid reason is never dropped
-- for good. Kept equal to clickup-writeback's churnReasonCard (billing.ts) by
-- billing-rails-supabase.test.ts.
CREATE OR REPLACE FUNCTION public.cockpit_churn_reason_card(p_reason text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_target text; v_field jsonb; v_name text;
BEGIN
  IF v_reason IS NULL OR lower(v_reason) = 'other' THEN RETURN NULL; END IF;
  v_target := CASE WHEN lower(v_reason) IN ('completed term', 'completed term, did not renew')
                   THEN 'Completed term, did not renew' ELSE v_reason END;
  v_field := public.cockpit_clickup_field('796f25e7');
  IF v_field IS NULL THEN RETURN v_target; END IF;
  SELECT o->>'name' INTO v_name FROM jsonb_array_elements(v_field->'options') o
   WHERE lower(btrim(o->>'name')) = lower(v_target) LIMIT 1;
  RETURN v_name;
END $$;

-- ---------------------------------------------------------------------------
-- 5. The one detail builder (3.1, 3.3)
--
-- p_args are the camelCase keys a screen or a door sends; the result is the
-- event detail every reader and the writes below use. Keys with no value are
-- left out (so "at_risk" is present only when asked), except a churn's
-- card_reason, which is kept as null when the card's list lacks the reason.

CREATE OR REPLACE FUNCTION public.cockpit_billing_detail(p_kind text, p_args jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
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
END $$;
COMMENT ON FUNCTION public.cockpit_billing_detail(text, jsonb) IS
  'The builder of a billing event''s detail (waves 1-2 3.1, 3.3), from the camelCase keys a screen sends; the canary (cockpit_billing_canary) builds its detail with it. cockpit_client_lifecycle_confirm (o) and cockpit_billing_write (p) build theirs by hand to the same snake_case keys (p stores the seat in words, this the code; every reader takes both), and forms-w12-chain-supabase.test.ts checks that a canary and a real Give more time and Client is leaving queue the same card writes.';

-- ---------------------------------------------------------------------------
-- 6. What one billing event writes on the card (3.3; replaces 20261009j)

CREATE OR REPLACE FUNCTION public.cockpit_billing_writeback_writes(p_kind text,p_from text,p_to text,p_detail jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
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
 ELSE NULL; -- late and every other kind write no field (a late close writes its comment only).
 END CASE;
 -- A value the event does not carry is not guessed; only a deliberate clear is empty.
 RETURN (SELECT coalesce(jsonb_agg(x-'clear' ORDER BY n),'[]'::jsonb) FROM jsonb_array_elements(w) WITH ORDINALITY AS t(x,n)
         WHERE x->'value'<>'null'::jsonb OR x->'clear'='true'::jsonb);
END $$;
COMMENT ON FUNCTION public.cockpit_billing_writeback_writes(text,text,text,jsonb) IS
 'The ClickUp field writes one cockpit_billing_events row makes, in order: [{field, value, old?}] (waves 1-2 3.3; field keys are BILLING_FIELDS in clickup-writeback/billing.ts). A null value is a clear. A churn writes Churn Date before Client Status. Empty when the event changes no card field.';

-- The silent comment one event posts on the card (3.3), or NULL. Roles, never
-- names or emails: the seat_role words are the CSM, finance, the CEO and the
-- cockpit. The detail holds the code (csm, finance, ceo, system) as
-- cockpit_billing_detail writes it, or already the words (20261101p's money
-- acts store the words); both read the same. A line whose value the event
-- does not carry is left out.
CREATE OR REPLACE FUNCTION public.cockpit_billing_writeback_comment(p_kind text, p_from text, p_to text, p_detail jsonb, p_client text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
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
  WHEN 'late' THEN
    IF NOT d ? 'closes' OR coalesce(d->>'days_late', '') !~ '^[0-9]+$' THEN RETURN NULL; END IF; -- an open spell posts nothing
    v_n := (d->>'days_late')::integer;
    RETURN 'LATE ' || v_n || CASE WHEN v_n = 1 THEN ' day' ELSE ' days' END || coalesce(': due ' || (d->>'due'), '') || ', '
      || CASE WHEN d ? 'paid_on' THEN 'paid ' || (d->>'paid_on')
              WHEN d->>'closed_how' = 'extended' THEN 'extension moved the date'
              WHEN d->>'closed_how' = 'stopped' THEN 'client stopped'
              ELSE 'the date moved on the card' END;
  ELSE
    RETURN NULL; -- method, plan, amount, date, payment and note keep 20261009j's behaviour (a note is its own comment)
  END CASE;
  IF v_by IS NOT NULL THEN l := l || ('By: ' || v_by); END IF;
  RETURN array_to_string(l, E'\n');
END $$;
COMMENT ON FUNCTION public.cockpit_billing_writeback_comment(text, text, text, jsonb, text) IS
  'The silent ClickUp comment of one billing event (waves 1-2 3.3), or NULL: extension, pause, resume, churn, mrr and a late close. Roles, never names or emails. clickup-writeback adds the reference line.';

CREATE OR REPLACE FUNCTION public.cockpit_billing_writeback_enqueue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_writes jsonb; v_note text; v_comment text; v_seat text; v_d jsonb;
BEGIN
 v_d:=CASE WHEN jsonb_typeof(NEW.detail)='object' THEN NEW.detail ELSE '{}'::jsonb END;
 -- The seat a comment names: the event's own, else its source (an older event carries none).
 v_seat:=coalesce(nullif(v_d->>'seat_role',''),CASE NEW.source WHEN 'ceo' THEN 'ceo' WHEN 'csm' THEN 'csm' WHEN 'system' THEN 'system' END);
 v_d:=v_d||jsonb_strip_nulls(jsonb_build_object('seat_role',v_seat,
   'reason',CASE WHEN v_d ? 'reason' THEN NULL ELSE nullif(btrim(coalesce(NEW.reason,'')),'') END));
 v_writes:=public.cockpit_billing_writeback_writes(NEW.kind,NEW.from_value,NEW.to_value,v_d);
 v_note:=CASE WHEN NEW.kind='note' THEN nullif(btrim(coalesce(NEW.reason,'')),'') END;
 v_comment:=nullif(btrim(coalesce(public.cockpit_billing_writeback_comment(NEW.kind,NEW.from_value,NEW.to_value,v_d,NEW.client_name),'')),'');
 -- A payment taken in from the inbox, one that moved no date, or a late spell opening writes nothing on the card.
 IF jsonb_array_length(v_writes)=0 AND v_note IS NULL AND v_comment IS NULL THEN RETURN NEW; END IF;
 -- Not wrapped in an exception handler: an edit that cannot be queued for ClickUp is not saved.
 INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key,kind,source_table,source_id,task_id,payload)
 VALUES('billing:'||NEW.id,'billing','cockpit_billing_events',NEW.id::text,NEW.clickup_task_id,jsonb_build_object(
  'eventId',NEW.id,'taskId',NEW.clickup_task_id,'clientName',NEW.client_name,'kind',NEW.kind,
  'source',NEW.source,'by',NEW.by_whom,'at',round(extract(epoch FROM NEW.at)*1000),
  'writes',v_writes,'note',v_note,'comment',v_comment,'seatRole',v_seat))
 ON CONFLICT (dedupe_key) DO NOTHING;
 RETURN NEW;
END $$;
COMMENT ON FUNCTION public.cockpit_billing_writeback_enqueue() IS
 'Trigger on cockpit_billing_events: queues the ClickUp write-back of a billing event in the same transaction, dedupe key billing:<event id>; payload carries the writes, a note, the 3.3 comment and the seat role. clickup-writeback writes it only when the billing switch opens its kind (waves 1-2 1.4).';

DROP TRIGGER IF EXISTS cockpit_billing_events_clickup_writeback ON public.cockpit_billing_events;
CREATE TRIGGER cockpit_billing_events_clickup_writeback AFTER INSERT ON public.cockpit_billing_events
 FOR EACH ROW WHEN ((NEW.source IN ('ceo','csm') AND NEW.kind IN ('method','plan','amount','date','extension','pause','resume','payment','note','churn','mrr'))
                 OR (NEW.source = 'system' AND NEW.kind IN ('extension','ltv','late')))
 EXECUTE FUNCTION public.cockpit_billing_writeback_enqueue();

-- ---------------------------------------------------------------------------
-- 7. The billing switch as the writer last reported it

-- clickup-writeback writes cockpit_sync_state clickup-writeback:billing on every
-- log run (every two minutes): {mode, kinds, onlyCards, ...}. A report older
-- than an hour is unknown, so no release trusts a switch that may have moved.
CREATE OR REPLACE FUNCTION public.cockpit_billing_mode()
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE s public.cockpit_sync_state; v_mode text;
BEGIN
  SELECT * INTO s FROM public.cockpit_sync_state WHERE key = 'clickup-writeback:billing';
  IF NOT FOUND OR jsonb_typeof(s.detail) IS DISTINCT FROM 'object' OR s.detail->>'mode' IS NULL THEN
    RETURN jsonb_build_object('mode', 'unknown', 'kinds', '[]'::jsonb, 'onlyCards', '[]'::jsonb, 'at', NULL,
      'note', 'clickup-writeback has not reported its billing switch yet.');
  END IF;
  IF s.updated_at < now() - interval '1 hour' THEN
    RETURN jsonb_build_object('mode', 'unknown', 'kinds', '[]'::jsonb, 'onlyCards', '[]'::jsonb, 'at', s.updated_at,
      'note', 'The billing switch was last reported over an hour ago; the log job reports it every two minutes, so read it again after the next run.');
  END IF;
  v_mode := CASE WHEN s.detail->>'mode' IN ('dry_run', 'apply_limited', 'apply') THEN s.detail->>'mode' ELSE 'unknown' END;
  RETURN jsonb_build_object(
    'mode', v_mode,
    'kinds', CASE WHEN v_mode IN ('apply', 'apply_limited') AND jsonb_typeof(s.detail->'kinds') = 'array' THEN s.detail->'kinds' ELSE '[]'::jsonb END,
    'onlyCards', CASE WHEN jsonb_typeof(s.detail->'onlyCards') = 'array' THEN s.detail->'onlyCards' ELSE '[]'::jsonb END,
    'at', s.updated_at);
END $$;
COMMENT ON FUNCTION public.cockpit_billing_mode() IS
  'The billing switch as clickup-writeback last reported it: {mode unknown|dry_run|apply_limited|apply, kinds, onlyCards, at}. kinds is empty unless the switch is open; a report over an hour old reads unknown.';

-- Held billing edits for the run note and the guardian: every dry_run billing
-- item, and those whose kind the switch now opens (heldOpenKind, W20).
CREATE OR REPLACE FUNCTION public.cockpit_billing_writeback_held(p_kinds text[])
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'held', coalesce(sum(n), 0),
    'heldOpenKind', coalesce(sum(n) FILTER (WHERE kind = ANY (coalesce(p_kinds, '{}'::text[]))), 0),
    'byKind', coalesce(jsonb_object_agg(kind, n) FILTER (WHERE kind IS NOT NULL), '{}'::jsonb))
  FROM (SELECT q.payload->>'kind' AS kind, count(*) AS n
          FROM public.cockpit_clickup_writeback_queue q
         WHERE q.kind = 'billing' AND q.state = 'dry_run'
         GROUP BY 1) AS t
$$;

-- ---------------------------------------------------------------------------
-- 8. Voids and the held-edit review (W20)

-- The one void: closes the event's unsent item and records the void. Never an
-- item that reached the card, nor one being written right now.
CREATE OR REPLACE FUNCTION public.cockpit_billing_event_void_do(p_event_id bigint, p_reason text, p_actor text, p_app text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_reason text := btrim(coalesce(p_reason, ''));
  v_event public.cockpit_billing_events;
  v_item public.cockpit_clickup_writeback_queue;
  v_at timestamptz;
  v_state text;
BEGIN
  IF char_length(v_reason) NOT BETWEEN 4 AND 300 THEN
    RAISE EXCEPTION 'Say why in 4 to 300 characters, so the void reads back.' USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(coalesce(p_actor, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Name who decided the void.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_event FROM public.cockpit_billing_events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That billing change is not in the log.' USING ERRCODE = '22023'; END IF;
  -- One void at a time per event: the lock is taken before the check.
  PERFORM pg_advisory_xact_lock(hashtextextended('billing_event_void:' || p_event_id, 0));
  SELECT v.voided_at INTO v_at FROM public.cockpit_billing_event_voids v WHERE v.event_id = p_event_id;
  IF FOUND THEN
    RAISE EXCEPTION 'This change was already voided on %.', to_char((v_at AT TIME ZONE 'Asia/Kuwait')::date, 'YYYY-MM-DD')
      USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_item FROM public.cockpit_clickup_writeback_queue q
   WHERE q.source_table = 'cockpit_billing_events' AND q.source_id = p_event_id::text
   ORDER BY q.created_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    v_state := v_item.state;
    IF v_item.state = 'delivered' THEN
      RAISE EXCEPTION 'The card already shows this change; make a new edit instead.' USING ERRCODE = '22023';
    END IF;
    IF v_item.state IN ('sending', 'unknown') THEN
      RAISE EXCEPTION 'This change is being written to the card right now. Try again in a few minutes.' USING ERRCODE = '22023';
    END IF;
    IF v_item.state = 'retry' AND EXISTS (
         SELECT 1 FROM jsonb_each(v_item.progress) AS e(k, v)
          WHERE jsonb_typeof(e.v) = 'object' AND (e.v->'done' = 'true'::jsonb OR e.v->'started' = 'true'::jsonb)) THEN
      RAISE EXCEPTION 'Part of this change is already on the card; make a new edit instead.' USING ERRCODE = '22023';
    END IF;
    IF v_item.state IN ('dry_run', 'queued', 'retry') THEN
      UPDATE public.cockpit_clickup_writeback_queue
         SET state = 'skipped', error = left('Voided in the cockpit: ' || v_reason, 500), next_attempt_at = now(), updated_at = now()
       WHERE id = v_item.id;
      v_state := 'skipped';
    END IF;
  END IF;
  PERFORM set_config('cockpit.audit_actor', btrim(p_actor), true);
  PERFORM set_config('cockpit.audit_app', coalesce(nullif(btrim(coalesce(p_app, '')), ''), 'cockpit'), true);
  INSERT INTO public.cockpit_billing_event_voids(event_id, reason, voided_by) VALUES (p_event_id, v_reason, btrim(p_actor));
  RETURN jsonb_build_object('eventId', p_event_id, 'kind', v_event.kind, 'voided', true,
                            'itemId', v_item.id, 'itemState', v_state);
END $$;

-- The screen's void: the CEO or finance.
CREATE OR REPLACE FUNCTION public.cockpit_billing_event_void(p_event_id bigint, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_uid uuid := auth.uid(); v_ceo boolean; v_who text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in before voiding a billing change.' USING ERRCODE = '42501'; END IF;
  v_ceo := coalesce(public.cockpit_is_ceo(), false);
  IF NOT (v_ceo OR coalesce(public.cockpit_has_role('finance'), false)) THEN
    RAISE EXCEPTION 'Only finance or the CEO voids a billing change.' USING ERRCODE = '42501';
  END IF;
  SELECT lower(btrim(u.email)) INTO v_who FROM auth.users u WHERE u.id = v_uid;
  RETURN public.cockpit_billing_event_void_do(p_event_id, p_reason, v_who,
    CASE WHEN v_ceo THEN 'media-buyer-cockpit' ELSE 'client-success-cockpit' END);
END $$;
COMMENT ON FUNCTION public.cockpit_billing_event_void(bigint, text) IS
  'The CEO or finance takes back a billing event before it reaches the card: its unsent item (dry_run, queued, or retry with nothing written) settles skipped "Voided in the cockpit: {reason}". Refuses a delivered item. One audit row per void.';

-- The deploy's void (D-B5), credited to whoever decided it.
CREATE OR REPLACE FUNCTION public.cockpit_billing_event_void_owner(p_event_id bigint, p_reason text, p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'The owner void runs only through the deploy connection.' USING ERRCODE = '42501';
  END IF;
  RETURN public.cockpit_billing_event_void_do(p_event_id, p_reason, p_actor, 'deploy');
END $$;

-- The held-edit review (W20): one dry_run billing item whose kind the switch
-- now opens, released one of four ways by a person who read the card:
--   replan  back to queued with no frozen steps, so the next run plans it
--           afresh (the card was read unchanged since the event)
--   fresh   the event is voided and recorded again now, with
--           detail.replaces_event_id; its own trigger queues a new item, so
--           the stale verdict (card changed after the edit) does not skip it
--   close   settled skipped; the event stays a record (an ended extension
--           grant still counts)
--   void    as cockpit_billing_event_void
-- Never a general log edit, never an item of a kind the switch keeps closed.
CREATE OR REPLACE FUNCTION public.cockpit_billing_held_release(p_event_id bigint, p_how text, p_reason text, p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_reason text := btrim(coalesce(p_reason, ''));
  v_actor text := nullif(btrim(coalesce(p_actor, '')), '');
  v_event public.cockpit_billing_events;
  v_item public.cockpit_clickup_writeback_queue;
  v_mode jsonb;
  v_new bigint;
  v_state text;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'The held-edit review runs only through the deploy connection.' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_how, '') NOT IN ('replan', 'fresh', 'close', 'void') THEN
    RAISE EXCEPTION 'Release a held edit with replan, fresh, close or void.' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_reason) NOT BETWEEN 4 AND 300 THEN
    RAISE EXCEPTION 'Say why in 4 to 300 characters, so the release reads back.' USING ERRCODE = '22023';
  END IF;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Name who decided the release.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_event FROM public.cockpit_billing_events WHERE id = p_event_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That billing change is not in the log.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_item FROM public.cockpit_clickup_writeback_queue q
   WHERE q.source_table = 'cockpit_billing_events' AND q.source_id = p_event_id::text
   ORDER BY q.created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Billing event % has no ClickUp item to release.', p_event_id USING ERRCODE = '22023';
  END IF;
  IF v_item.kind <> 'billing' THEN
    RAISE EXCEPTION 'Only a billing edit is released here; this item is kind %.', v_item.kind USING ERRCODE = '22023';
  END IF;
  IF v_item.state <> 'dry_run' THEN
    RAISE EXCEPTION 'Only a held edit (dry_run) is released here; this one is %.', v_item.state USING ERRCODE = '22023';
  END IF;
  v_mode := public.cockpit_billing_mode();
  IF NOT coalesce((v_mode->'kinds') ? v_event.kind, false) THEN
    RAISE EXCEPTION 'Kind % is not open on the billing switch (now %), so a released edit would be held again. Open the kind first.',
      v_event.kind, v_mode->>'mode' USING ERRCODE = '22023';
  END IF;
  IF p_how IN ('replan', 'fresh') AND jsonb_array_length(v_mode->'onlyCards') > 0 AND NOT (v_mode->'onlyCards') ? v_event.clickup_task_id THEN
    RAISE EXCEPTION 'The billing switch is limited to other cards (CLICKUP_WRITEBACK_BILLING_ONLY_CARDS), so this edit would be held again. Clear the list first, or close the edit.'
      USING ERRCODE = '22023';
  END IF;

  IF p_how = 'replan' THEN
    UPDATE public.cockpit_clickup_writeback_queue
       SET state = 'queued', steps = NULL, progress = '{}'::jsonb, error = NULL, next_attempt_at = now(), updated_at = now()
     WHERE id = v_item.id;
    v_state := 'queued';
  ELSIF p_how = 'close' THEN
    UPDATE public.cockpit_clickup_writeback_queue
       SET state = 'skipped', error = left('Closed at the kind opening: ' || v_reason, 500), updated_at = now()
     WHERE id = v_item.id;
    v_state := 'skipped';
  ELSIF p_how = 'void' THEN
    PERFORM public.cockpit_billing_event_void_do(p_event_id, v_reason, v_actor, 'deploy');
    v_state := 'skipped';
  ELSE
    PERFORM public.cockpit_billing_event_void_do(p_event_id, left('Recorded again at the kind opening: ' || v_reason, 300), v_actor, 'deploy');
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (v_event.clickup_task_id, v_event.client_name, v_event.kind, v_event.from_value, v_event.to_value, v_event.reason,
            -- The copy is new (its at is now, so the stale check still holds), but the grant keeps its own day:
            -- cockpit_extensions_v reads granted_at, so the month the grant counts in does not move.
            CASE WHEN jsonb_typeof(v_event.detail) = 'object' THEN v_event.detail ELSE '{}'::jsonb END
              || jsonb_build_object('replaces_event_id', v_event.id, 'released_by', v_actor,
                                    'granted_at', coalesce(v_event.detail->>'granted_at', v_event.at::text)),
            v_event.source, v_event.by_whom)
    RETURNING id INTO v_new;
    SELECT q.state INTO v_state FROM public.cockpit_clickup_writeback_queue q
     WHERE q.source_table = 'cockpit_billing_events' AND q.source_id = v_new::text;
    IF v_state IS NULL THEN
      RAISE EXCEPTION 'The change recorded again queued no card write, so nothing was changed.' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('billing.held_release', 'cockpit_clickup_writeback_queue', v_item.id::text, v_actor, 'deploy', 'supabase',
          jsonb_build_object('state', v_item.state),
          jsonb_build_object('state', CASE WHEN p_how = 'fresh' THEN 'skipped' ELSE v_state END, 'how', p_how, 'newEventId', v_new),
          jsonb_build_object('eventId', p_event_id, 'kind', v_event.kind, 'task', v_event.clickup_task_id, 'reason', v_reason,
                             'mode', v_mode->>'mode'));
  RETURN jsonb_build_object('itemId', v_item.id, 'how', p_how, 'newEventId', v_new, 'state', v_state);
END $$;
COMMENT ON FUNCTION public.cockpit_billing_held_release(bigint, text, text, text) IS
  'The held-edit review of waves 1-2 W20, owner only: one dry_run billing item of an open kind is replanned, recorded fresh, closed or voided, a person deciding each. One audit row each. The general log edits are never touched.';

-- ---------------------------------------------------------------------------
-- 9. The canary (W14): one billing event on the test card, its card writes
--    the same as the real door's

CREATE OR REPLACE FUNCTION public.cockpit_billing_canary(p_kind text, p_args jsonb)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
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
  IF coalesce(p_kind, '') NOT IN ('churn', 'extension', 'pause', 'resume', 'mrr', 'late', 'date') THEN
    RAISE EXCEPTION 'The canary takes churn, extension, pause, resume, mrr, late or date.' USING ERRCODE = '22023';
  END IF;
  IF p_kind = 'late' AND NOT v_system THEN
    RAISE EXCEPTION 'A late event comes from the cockpit itself: send system true.' USING ERRCODE = '22023';
  END IF;
  IF v_system AND p_kind NOT IN ('extension', 'late') THEN
    RAISE EXCEPTION 'Only an extension clear or a late event comes from the cockpit itself.' USING ERRCODE = '22023';
  END IF;
  v_detail := public.cockpit_billing_detail(p_kind,
    a || jsonb_build_object('seatRole', coalesce(nullif(a->>'seatRole', ''), CASE WHEN v_system THEN 'system' ELSE 'ceo' END)));
  v_from := nullif(a->>'from', '');
  v_to := CASE p_kind
    WHEN 'churn' THEN 'Stopped' WHEN 'pause' THEN 'Paused' WHEN 'resume' THEN 'Active'
    WHEN 'extension' THEN CASE WHEN v_system THEN NULL ELSE coalesce(nullif(a->>'newDate', ''), nullif(a->>'to', '')) END
    WHEN 'late' THEN NULL
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
END $$;
COMMENT ON FUNCTION public.cockpit_billing_canary(text, jsonb) IS
  'Owner only, deploy steps D-B3, D-C1, D-C2, D-P3: inserts one billing event on the test card 86eywg1cq (never another card), its detail built by cockpit_billing_detail to the keys the real doors write (the card writes match; the seat is the code here, words on a real act). Never used by a screen.';

-- ---------------------------------------------------------------------------
-- 10. The daily field read (only where pg_cron exists; the PGlite test strips
--     this block)

-- cron:begin
DO $cron$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'No pg_cron here (cron.job is missing), so the billing doctor was not scheduled.';
    RETURN;
  END IF;
  EXECUTE 'SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname = ''mahara-clickup-writeback-billing-doctor''';
  EXECUTE $q$SELECT cron.schedule('mahara-clickup-writeback-billing-doctor', '41 3 * * *', $job$ select net.http_post(url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/clickup-writeback', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cockpit_sync_secret')), body := jsonb_build_object('job','billing_doctor'), timeout_milliseconds := 150000); $job$)$q$;
END
$cron$;
-- cron:end

-- ---------------------------------------------------------------------------
-- 11. Function privileges: revoked from all four roles, then exactly as 2.4 says

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'cockpit_billing_rails_audit()', 'cockpit_billing_rails_refuse()',
    'cockpit_clickup_fields_put(text,jsonb)', 'cockpit_clickup_field(text)', 'cockpit_clickup_option_ok(text,text)',
    'cockpit_churn_reason_card(text)', 'cockpit_billing_detail(text,jsonb)',
    'cockpit_billing_writeback_writes(text,text,text,jsonb)', 'cockpit_billing_writeback_comment(text,text,text,jsonb,text)',
    'cockpit_billing_writeback_enqueue()', 'cockpit_billing_mode()', 'cockpit_billing_writeback_held(text[])',
    'cockpit_billing_event_void_do(bigint,text,text,text)', 'cockpit_billing_event_void(bigint,text)',
    'cockpit_billing_event_void_owner(bigint,text,text)', 'cockpit_billing_held_release(bigint,text,text,text)',
    'cockpit_billing_canary(text,jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  -- clickup-writeback's two calls.
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.cockpit_clickup_fields_put(text,jsonb) TO service_role';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.cockpit_billing_writeback_held(text[]) TO service_role';
  -- The screen's void (CEO or finance, gated inside).
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.cockpit_billing_event_void(bigint,text) TO authenticated';
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
