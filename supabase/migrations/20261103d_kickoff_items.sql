-- Kickoff items as requests: a Yes or No for the CSM (the CEO, 2026-11-02, CEO-7: "Yes we can do that as well an
-- easy way for the CSM to just yes or no like the ticketing form"). Creative Triage (bldgtotkfmhoxmlzowdx). The
-- next-design plan's build B4, letter d (20261103a is taken by another branch); docs/forms/WAVE56-CONTRACT.md 4.20.
-- Applies twice; stands on 20261026r (requests), 20261029p (the send gate), 20261102j (the kickoff seat rule, the
-- read model) and 20261102o (the kickoff's questions and their options). It replaces no function.
--
-- What it adds:
-- 1. cockpit_kickoff_item_answers: one decision per card per item (raised or declined), row security on, revoked
--    from every role, then SELECT for the service role only. Delete and truncate are refused. Every write goes
--    through the definer functions below, and each leaves an audit row (kickoff_item.raised, .linked, .declined)
--    through cockpit_request_audit.
-- 2. The item catalogue (cockpit_kickoff_item_catalog): seven items, each a kickoff question, the options that
--    leave it open, a request type and two fixed sentences. Three are on by default (the CEO's three):
--    funded card No -> card_missing, Mahara OS Tech Issue or Didn't Receive Access -> general_tech, WhatsApp
--    Needs Integrating -> whatsapp_connection. The other four (training Need Tech Help, Facebook Need Tech Help,
--    calendar Needs Integrating, WhatsApp Pending or Requested) are off until the CEO says yes. The switch is the
--    setting forms.kickoff_items {"on": [...]}, seeded once with the three and changed through the owner's
--    cockpit_kickoff_items_switch; the settings trigger audits every change. {"on": []} stops the feature;
--    decisions already made stay shown. The switch fails closed: a missing row, or an "on" that is not a list
--    (the {"on": false} every other forms switch takes), turns every item off, and the doctor names it as a
--    problem so the guardian warns. The defaults live only in the one-time seed.
-- 3. Reading the kickoff: the card's read model (cockpit_client_onboarding.forms->kickoff, Typeform and native
--    alike: the refs are the same), else the newest live native kickoff (source cockpit, version 2 or later; never
--    the Typeform sync's version-1 pointer rows). Only an exact option of the question counts
--    (cockpit_form_stage4_fields('kickoff')); typed text never reaches a sentence. The only variable parts of a
--    sentence are the option label and the kickoff's Kuwait day. A card with no onboarding row is not on the
--    requests' client list (the submit refuses it), so there only a No can be recorded and the row says why.
-- 4. The window: an undecided item is offered while the card is in onboarding (cockpit_client_onboarding
--    .in_onboarding) or its kickoff was sent 14 or fewer Kuwait days ago. A decision stays shown for good.
-- 5. Yes (cockpit_kickoff_item_raise) raises the item in one tap through the unchanged cockpit_request_submit,
--    as the ticket form would: the type, the client, the type's default due day and priority, and the fixed
--    details sentence only where the type has a details question; source client_page. The nested call keeps the
--    caller's sign-in, so the requests gate, the client check, the validation, the idempotency hash, the insert,
--    request.submitted and the writer's kick run as they do for the form. Any refusal rolls the whole call back:
--    a request without its decision, or a decision without its request, never exists.
--    No (cockpit_kickoff_item_decline) is recorded with an optional note. "Change it first" sends through the
--    existing ticket form, then cockpit_kickoff_item_link counts that request for the item; the same call counts
--    a request of the type that was already open ("Count it").
-- 6. The gate: the CEO, or a seat with the csm role that passes cockpit_csm_client_gate for the card (the rule
--    cockpit_kickoff_seat uses for the kickoff itself, with its own sentence). Nobody else decides.
-- 7. Today (cockpit_kickoff_items_due): the cards with an item to decide, for the CEO, admins with the csm role
--    and CSMs, each CSM seeing its own cards (it sent the kickoff, or the card's CSM resolves to its seat by the
--    csm_of_card rule) and the unmatched ones (no sender seat and no CSM seat), within its client list.
-- 8. The doctor (cockpit_kickoff_items_doctor, service role, report only) and its one-row view
--    cockpit_kickoff_items_doctor_v (service role SELECT) for the guardian's kickoff_items check: each item on is
--    asked by the kickoff with its options, its type exists, is enabled and raises in one tap; the submit keeps
--    its 8 arguments and client_page; the counts; no client data.
--
-- The submit this file calls, read live 2026-11-03 (read only): public.cockpit_request_submit(uuid, text, text,
-- jsonb, date, text, text, text), md5 of its white-space-folded prosrc b85da715750d58340dbc11442716e909, granted to
-- authenticated. The guard below refuses (and changes nothing) when it no longer has those 8 arguments or no
-- longer takes the source client_page. kickoff-items-supabase.test.ts pins that md5 on the body it stands on.
--
-- Nothing here posts, writes a card or sends a message. A Yes queues a request the way the ticket form does.
--
-- Read-back after applying: the table with relrowsecurity true and relacl {postgres=arwdDxtm/postgres,
-- service_role=r/postgres}; the five browser RPCs executable by authenticated only, the doctor by service_role only,
-- the other fourteen functions by nobody; select value from public.cockpit_settings where key =
-- 'forms.kickoff_items' answers {"on": ["funded_card", "mahara_os", "whatsapp_sync"]}; select report from
-- public.cockpit_kickoff_items_doctor_v (service role) answers ok true with no problems once the systems manager's
-- type edits are in. Rollback: public.cockpit_kickoff_items_switch('{}'::text[], '<who>') stops every item; to take
-- the browser calls away, drop the five browser functions with NOTIFY pgrst. The table and its rows stay.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. What this file stands on, and the guard on the submit it calls.

DO $$
DECLARE v_src text; v_ret text;
BEGIN
  IF to_regclass('public.cockpit_requests') IS NULL
     OR to_regclass('public.cockpit_request_types') IS NULL
     OR to_regclass('public.cockpit_client_onboarding') IS NULL
     OR to_regclass('public.cockpit_form_responses') IS NULL
     OR to_regclass('public.cockpit_settings') IS NULL
     OR to_regclass('public.cockpit_clickup_members') IS NULL
     OR to_regprocedure('public.cockpit_form_actor()') IS NULL
     OR to_regprocedure('public.cockpit_csm_client_gate(text)') IS NULL
     OR to_regprocedure('public.cockpit_kickoff_seat(text)') IS NULL
     OR to_regprocedure('public.cockpit_form_stage4_fields(text)') IS NULL
     OR to_regprocedure('public.cockpit_form_stage4_typeform_answers(text,jsonb)') IS NULL
     OR to_regprocedure('public.cockpit_form_stage4_ts(text)') IS NULL
     OR to_regprocedure('public.cockpit_request_seat()') IS NULL
     OR to_regprocedure('public.cockpit_request_preview(text,text,jsonb)') IS NULL
     OR to_regprocedure('public.cockpit_request_due_default(integer)') IS NULL
     OR to_regprocedure('public.cockpit_request_day_words(date)') IS NULL
     OR to_regprocedure('public.cockpit_request_held(public.cockpit_requests)') IS NULL
     OR to_regprocedure('public.cockpit_request_send_gate(jsonb,text)') IS NULL
     OR to_regprocedure('public.cockpit_request_may_open(public.cockpit_requests,jsonb)') IS NULL
     OR to_regprocedure('public.cockpit_request_row(public.cockpit_requests,jsonb)') IS NULL
     OR to_regprocedure('public.cockpit_request_audit(text,text,text,text,jsonb,jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.cockpit_slack_notice_role_of(text)') IS NULL
     OR to_regprocedure('public.cockpit_ask_ai_owner_allowed(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Apply the requests build (20261026r, 20261029p) and Stage 4 (20261102j, 20261102o) before 20261103d.'
      USING ERRCODE = '55000';
  END IF;
  SELECT p.prosrc, p.prorettype::regtype::text INTO v_src, v_ret FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_request_submit(uuid,text,text,jsonb,date,text,text,text)');
  IF v_src IS NULL OR v_ret IS DISTINCT FROM 'jsonb' OR position('''client_page''' IN v_src) = 0 THEN
    RAISE EXCEPTION 'cockpit_request_submit no longer has the 8 arguments, the jsonb answer or the client_page source this file calls; stop and re-read it.'
      USING ERRCODE = '55000';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The item catalogue (internal, IMMUTABLE). Order is the order the screens show. Each item: its key, the short
--    name on its chip, the kickoff question's ref, the options that leave it open, the request type, a priority
--    (null: the type's own), whether it is on by default, the row sentence and the details sentence ({option}:
--    the option label; {day}: the kickoff's Kuwait day). Turning an item on or off is the setting forms.kickoff_items;
--    a new item is a new entry here and in the CHECK below (a migration).

CREATE OR REPLACE FUNCTION public.cockpit_kickoff_item_catalog()
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT '[
    {"item":"funded_card","short":"Funded card","ref":"8bee68fc-0764-41a8-b90a-db2a3f401e9d","values":["No"],
     "typeKey":"card_missing","priority":null,"defaultOn":true,
     "line":"The card with funds is not linked to the ad account.",
     "details":"Raised from the kickoff on {day}: the card with funds is not linked to the ad account yet. Get the client to add it before launch."},
    {"item":"mahara_os","short":"Mahara OS access","ref":"ad562fc2-6858-4e37-81c5-c4cc2375a330","values":["Tech Issue","Didn''t Receive Access"],
     "typeKey":"general_tech","priority":null,"defaultOn":true,
     "line":"Mahara OS access: {option}.",
     "details":"Raised from the kickoff on {day}: Mahara OS access is {option}. Get the client logged in to Mahara OS, then tell their CSM."},
    {"item":"whatsapp_sync","short":"WhatsApp sync","ref":"a813378f-06ce-499e-8f0e-14761b89b474","values":["Needs Integrating"],
     "typeKey":"whatsapp_connection","priority":null,"defaultOn":true,
     "line":"WhatsApp is not synced to Mahara OS: {option}.",
     "details":"Raised from the kickoff on {day}: WhatsApp is not synced to Mahara OS ({option}). Connect it with a QR scan."},
    {"item":"training_access","short":"Training course","ref":"c56a7e2d-6f18-4bf9-a9f6-11367eab4c11","values":["Need Tech Help"],
     "typeKey":"general_tech","priority":null,"defaultOn":false,
     "line":"Training course access: {option}.",
     "details":"Raised from the kickoff on {day}: the client needs tech help to reach the training course. Get them into it, then tell their CSM."},
    {"item":"facebook_access","short":"Facebook access","ref":"6fcbd33c-60e9-4df7-bfaa-e76b588dd887","values":["Need Tech Help"],
     "typeKey":"general_marketing","priority":null,"defaultOn":false,
     "line":"Facebook access: {option}.",
     "details":"Raised from the kickoff on {day}: the client needs tech help with Facebook access. Get access confirmed, then tell their CSM."},
    {"item":"calendar","short":"Calendar","ref":"b657c5a5-d199-42b5-8437-c8d04f78e376","values":["Needs Integrating"],
     "typeKey":"general_tech","priority":null,"defaultOn":false,
     "line":"Booking platform and Google Calendar: {option}.",
     "details":"Raised from the kickoff on {day}: the booking platform and Google Calendar need integrating. Connect them, then tell their CSM."},
    {"item":"whatsapp_pending","short":"WhatsApp sync","ref":"a813378f-06ce-499e-8f0e-14761b89b474","values":["Pending","Requested"],
     "typeKey":"whatsapp_connection","priority":null,"defaultOn":false,
     "line":"WhatsApp is not synced to Mahara OS: {option}.",
     "details":"Raised from the kickoff on {day}: WhatsApp is not synced to Mahara OS ({option}). Connect it with a QR scan once the client is ready."}
  ]'::jsonb
$$;

-- ---------------------------------------------------------------------------
-- 2. The decision table

CREATE TABLE IF NOT EXISTS public.cockpit_kickoff_item_answers (
  task_id           text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  item              text NOT NULL,
  -- The kickoff the decision was made on: the read model's response_id (a Typeform token, or a native response's
  -- uuid as text), its submitted_at, and the option label it gave (a fixed label, never typed text).
  kickoff_ref       text NOT NULL CHECK (char_length(kickoff_ref) BETWEEN 1 AND 200),
  kickoff_at        timestamptz NOT NULL,
  kickoff_value     text NOT NULL CHECK (char_length(kickoff_value) BETWEEN 1 AND 80),
  answer            text NOT NULL CHECK (answer IN ('raised', 'declined')),
  request_id        uuid REFERENCES public.cockpit_requests(id),
  -- one_tap: Yes; form: sent through "Change it first" by this seat within 10 minutes; linked: an open request counted.
  how               text CHECK (how IS NULL OR how IN ('one_tap', 'form', 'linked')),
  -- The request's type at the decision (the form may change it).
  type_key          text,
  -- An optional reason for a No.
  note              text CHECK (note IS NULL OR char_length(note) <= 240),
  decided_by_member uuid NOT NULL REFERENCES public.cockpit_members(id),
  decided_by_email  text NOT NULL CHECK (btrim(decided_by_email) <> ''),
  -- A role (cockpit_slack_notice_role_of), never a name.
  decided_by_label  text NOT NULL CHECK (btrim(decided_by_label) <> ''),
  decided_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, item),
  CONSTRAINT cockpit_kickoff_item_answers_raised_has_request CHECK ((answer = 'raised') = (request_id IS NOT NULL)),
  CONSTRAINT cockpit_kickoff_item_answers_raised_has_how CHECK ((answer = 'raised') = (how IS NOT NULL)),
  CONSTRAINT cockpit_kickoff_item_answers_raised_has_type CHECK ((answer = 'raised') = (type_key IS NOT NULL)),
  CONSTRAINT cockpit_kickoff_item_answers_note_on_no CHECK (answer = 'declined' OR note IS NULL)
);
-- One request is counted for one item at most.
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_kickoff_item_answers_request
  ON public.cockpit_kickoff_item_answers (request_id) WHERE request_id IS NOT NULL;

-- The item keys, from the catalogue (re-made only when a key is missing, so a second apply changes nothing).
DO $$
DECLARE v_def text; v_keys text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_kickoff_item_answers'::regclass AND c.conname = 'cockpit_kickoff_item_answers_item_check';
  SELECT string_agg(quote_literal(e->>'item'), ', ' ORDER BY n) INTO v_keys
    FROM jsonb_array_elements(public.cockpit_kickoff_item_catalog()) WITH ORDINALITY AS x(e, n);
  IF v_def IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements(public.cockpit_kickoff_item_catalog()) e
                               WHERE position(quote_literal(e->>'item') IN v_def) = 0) THEN
    ALTER TABLE public.cockpit_kickoff_item_answers DROP CONSTRAINT IF EXISTS cockpit_kickoff_item_answers_item_check;
    EXECUTE format('ALTER TABLE public.cockpit_kickoff_item_answers ADD CONSTRAINT cockpit_kickoff_item_answers_item_check CHECK (item IN (%s))', v_keys);
  END IF;
END $$;

ALTER TABLE public.cockpit_kickoff_item_answers ENABLE ROW LEVEL SECURITY;
-- No policies: the browser reaches it only through the functions below; the guardian and the doctor read it.
REVOKE ALL ON public.cockpit_kickoff_item_answers FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cockpit_kickoff_item_answers TO service_role;

-- A decision is never deleted (a cancelled request reopens its item by itself; a No is changed by raising it).
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_item_answers_keep()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'A kickoff item''s answer is never deleted.' USING ERRCODE = '55000';
END $$;
DROP TRIGGER IF EXISTS cockpit_kickoff_item_answers_no_delete ON public.cockpit_kickoff_item_answers;
CREATE TRIGGER cockpit_kickoff_item_answers_no_delete BEFORE DELETE ON public.cockpit_kickoff_item_answers
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_kickoff_item_answers_keep();
DROP TRIGGER IF EXISTS cockpit_kickoff_item_answers_no_truncate ON public.cockpit_kickoff_item_answers;
CREATE TRIGGER cockpit_kickoff_item_answers_no_truncate BEFORE TRUNCATE ON public.cockpit_kickoff_item_answers
  FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_kickoff_item_answers_keep();

-- ---------------------------------------------------------------------------
-- 3. The switch: forms.kickoff_items {"on": [item keys]}. Seeded once with the catalogue's defaults (an existing row
--    wins, so a re-apply never switches anything back). Every change of a forms.% setting writes its own audit row,
--    whoever makes it (cockpit_settings_forms_audit, 20261029z/20261101p): forms.switch_seeded, forms.switch_set.

INSERT INTO public.cockpit_settings(key, value, updated_by)
SELECT 'forms.kickoff_items', jsonb_build_object('on', jsonb_agg(e->>'item' ORDER BY n)), 'migration 20261103d'
  FROM jsonb_array_elements(public.cockpit_kickoff_item_catalog()) WITH ORDINALITY AS x(e, n)
 WHERE (e->>'defaultOn')::boolean
ON CONFLICT (key) DO NOTHING;

-- The items on now: the setting's list, in the catalogue's order, unknown keys left out. Fails closed: with no
-- setting row, or an "on" that is not a list (for example {"on": false}), no item is on, and the doctor names it as
-- a problem. The catalogue's defaults are used only by the one-time seed above.
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_items_on()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(array_agg(e->>'item' ORDER BY n), '{}'::text[])
    FROM jsonb_array_elements(public.cockpit_kickoff_item_catalog()) WITH ORDINALITY AS x(e, n)
   WHERE EXISTS (SELECT 1 FROM public.cockpit_settings s
                  WHERE s.key = 'forms.kickoff_items' AND jsonb_typeof(s.value->'on') = 'array'
                    AND (s.value->'on') ? (e->>'item'))
$$;

-- The owner's switch (no grant): turns items on or off. {} stops the feature; decisions already made stay shown.
-- The settings trigger writes the audit row (forms.switch_set) under p_actor.
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_items_switch(p_items text[], p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_after jsonb; v_bad text;
BEGIN
  IF p_actor IS NULL OR btrim(p_actor) = '' THEN
    RAISE EXCEPTION 'Say who turns kickoff items on or off.' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_bad FROM unnest(coalesce(p_items, '{}'::text[])) k
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.cockpit_kickoff_item_catalog()) e WHERE e->>'item' = k)
   LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '% is not a kickoff item. The items are: %.', v_bad,
      (SELECT string_agg(e->>'item', ', ' ORDER BY n) FROM jsonb_array_elements(public.cockpit_kickoff_item_catalog()) WITH ORDINALITY AS x(e, n))
      USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_build_object('on', coalesce(jsonb_agg(e->>'item' ORDER BY n), '[]'::jsonb)) INTO v_after
    FROM jsonb_array_elements(public.cockpit_kickoff_item_catalog()) WITH ORDINALITY AS x(e, n)
   WHERE (e->>'item') = ANY(coalesce(p_items, '{}'::text[]));
  PERFORM set_config('cockpit.audit_actor', btrim(p_actor), true);
  INSERT INTO public.cockpit_settings(key, value, updated_by, updated_at)
  VALUES ('forms.kickoff_items', v_after, btrim(p_actor), now())
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  PERFORM set_config('cockpit.audit_actor', '', true);
  RETURN v_after;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Small readers (internal)

-- The items one kickoff leaves open, by its answers keyed by ref: [{item, short, typeKey, ref, value, line,
-- defaultOn}] in the catalogue's order, whether on or not. Only an exact option of the question counts, read
-- through the form's own question list; anything else (typed text, an old label) leaves the item out.
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_request_items(p_by_ref jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a jsonb := CASE WHEN jsonb_typeof(p_by_ref) = 'object' THEN p_by_ref ELSE '{}'::jsonb END;
  v_fields jsonb := public.cockpit_form_stage4_fields('kickoff');
  c jsonb;
  v text;
  v_out jsonb := '[]'::jsonb;
BEGIN
  FOR c IN SELECT e FROM jsonb_array_elements(public.cockpit_kickoff_item_catalog()) WITH ORDINALITY AS x(e, n) ORDER BY n LOOP
    v := btrim(coalesce(a->>(c->>'ref'), ''), E' \t\n\r\f\x0b');
    CONTINUE WHEN v = '' OR NOT (c->'values') ? v;
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_fields) f
                               WHERE f->>'typeformRef' = c->>'ref' AND jsonb_typeof(f->'options') = 'array' AND (f->'options') ? v);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'item', c->>'item', 'short', c->>'short', 'typeKey', c->>'typeKey', 'ref', c->>'ref', 'value', v,
      'line', replace(c->>'line', '{option}', v), 'defaultOn', (c->>'defaultOn')::boolean));
  END LOOP;
  RETURN v_out;
END $$;

-- The fixed details sentence for an item, its option and the kickoff's Kuwait day. NULL for an unknown item.
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_item_details(p_item text, p_value text, p_day date)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT replace(replace(e->>'details', '{option}', coalesce(p_value, '')), '{day}', public.cockpit_request_day_words(p_day))
    FROM jsonb_array_elements(public.cockpit_kickoff_item_catalog()) e
   WHERE e->>'item' = p_item
$$;

-- Whether a request type raises in one tap: every required question is the client, the details, the due day or the
-- priority (the kickoff fills the first two, the type's defaults the last two), and every part always runs.
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_item_one_tap(t public.cockpit_request_types)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.key IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t.fields) f
                      WHERE coalesce((f->>'required')::boolean, false)
                        AND coalesce(f->>'kind', '') NOT IN ('client', 'details', 'deadline', 'priority'))
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(t.targets) g WHERE jsonb_typeof(g->'when') = 'object')
$$;

-- The CSM seat the card's CSM resolves to by the csm_of_card rule (cockpit_request_owner): exactly one active
-- ClickUp member named as the card's CSM whose address is an active csm seat. Its address, or NULL.
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_items_csm_email(p_csm text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN count(DISTINCT c.clickup_user_id) = 1 THEN min(lower(btrim(c.email))) END
    FROM public.cockpit_clickup_members c
   WHERE nullif(btrim(coalesce(p_csm, '')), '') IS NOT NULL
     AND c.active AND lower(btrim(c.username)) = lower(btrim(p_csm))
     AND EXISTS (SELECT 1 FROM public.cockpit_members m
                  WHERE m.active AND 'csm' = ANY(m.roles) AND lower(btrim(m.email)) = lower(btrim(c.email)))
$$;

-- The card's kickoff as the items read it, or NULL when none is stored:
--   {source: read_model | native, formId, ref, at, sender (the native sender's auth id), answered, byRef,
--    inOnboarding, clientName, csm, hasRow}
-- The read model first (Typeform and native share the refs). When it holds no answers (or the card has no
-- onboarding row, j's 'no_row'), the newest live native kickoff (source cockpit, version 2 or later; never the
-- Typeform sync's version-1 pointer rows), mapped to refs as the read model is.
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_items_kickoff(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o public.cockpit_client_onboarding;
  r public.cockpit_form_responses;
  v_k jsonb;
  v_answers jsonb;
  v_by_ref jsonb;
  v_ref text;
  v_at timestamptz;
  v_form text;
  v_sender uuid;
  v_source text;
BEGIN
  SELECT * INTO o FROM public.cockpit_client_onboarding x WHERE x.clickup_task_id = p_task_id;
  IF o.clickup_task_id IS NOT NULL AND jsonb_typeof(o.forms->'kickoff') = 'object' THEN
    v_k := o.forms->'kickoff';
  END IF;
  IF v_k IS NOT NULL AND jsonb_typeof(v_k->'answers') = 'array' AND jsonb_array_length(v_k->'answers') > 0 THEN
    v_answers := v_k->'answers';
    v_ref := nullif(btrim(coalesce(v_k->>'response_id', '')), '');
    v_at := coalesce(public.cockpit_form_stage4_ts(v_k->>'submitted_at'), o.synced_at);
    v_form := nullif(btrim(coalesce(v_k->>'form_id', '')), '');
    v_source := 'read_model';
    IF v_ref ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      SELECT x.created_by_id INTO v_sender FROM public.cockpit_form_responses x
       WHERE x.id = v_ref::uuid AND x.form_key = 'kickoff';
    END IF;
  ELSE
    SELECT * INTO r FROM public.cockpit_form_responses x
     WHERE x.form_key = 'kickoff' AND x.task_id = p_task_id AND x.state NOT IN ('draft', 'void') AND x.mode = 'live'
       AND x.source = 'cockpit' AND x.form_version >= 2
     ORDER BY coalesce(x.submitted_at, x.created_at) DESC, x.created_at DESC LIMIT 1;
    IF r.id IS NOT NULL THEN
      v_answers := public.cockpit_form_stage4_typeform_answers('kickoff', r.answers);
      v_ref := r.id::text;
      v_at := coalesce(r.submitted_at, r.created_at);
      v_form := 'native';
      v_sender := r.created_by_id;
      v_source := 'native';
    ELSIF v_k IS NOT NULL THEN
      -- A stored kickoff without its answers (a pointer row): the screens say the answers are not here.
      v_ref := nullif(btrim(coalesce(v_k->>'response_id', '')), '');
      v_at := coalesce(public.cockpit_form_stage4_ts(v_k->>'submitted_at'), o.synced_at);
      v_form := nullif(btrim(coalesce(v_k->>'form_id', '')), '');
      v_source := 'read_model';
    ELSE
      RETURN NULL;
    END IF;
  END IF;
  -- The last answer of a question answered twice, blanks left out (cockpit_slack_notice_kickoff_facts' rule).
  IF jsonb_typeof(v_answers) = 'array' THEN
    SELECT jsonb_object_agg(x.ref, x.value) INTO v_by_ref
      FROM (SELECT DISTINCT ON (a->>'ref') a->>'ref' AS ref, a->>'value' AS value
              FROM jsonb_array_elements(v_answers) WITH ORDINALITY AS u(a, n)
             WHERE jsonb_typeof(a) = 'object' AND coalesce(a->>'ref', '') <> '' AND coalesce(a->>'value', '') <> ''
             ORDER BY a->>'ref', n DESC) x;
  END IF;
  RETURN jsonb_build_object(
    'source', v_source, 'formId', v_form, 'ref', coalesce(v_ref, 'unknown'), 'at', v_at, 'sender', v_sender,
    'answered', v_by_ref IS NOT NULL, 'byRef', coalesce(v_by_ref, '{}'::jsonb),
    'inOnboarding', coalesce(o.in_onboarding, false),
    'clientName', coalesce(nullif(btrim(o.client_name), ''), nullif(btrim(r.client_name), '')),
    'csm', nullif(btrim(coalesce(o.csm, '')), ''), 'hasRow', o.clickup_task_id IS NOT NULL);
END $$;

-- The shared computation for read, raise, link, decline, Today and the doctor. p_seat is the caller's requests
-- seat (cockpit_request_seat()), or NULL for the doctor (then no request detail and no route). p_route adds the
-- preview's route to each row that can still be raised.
--   {kickoff: {...} | null, inWindow, reason, note, items: [ItemRow]}
-- ItemRow = {item, short, line, value, typeKey, typeLabel, typeEnabled, oneTap, details, priority, state, offered,
--            stillOpen, blocked, actions: {raise, decline, link}, route, decision, request, existing}
-- state: open | already_open | type_off (no decision yet, inside the window) | raised | declined | reopened (its
-- request was cancelled or failed while the kickoff still leaves the item open).
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_items_state(p_task_id text, p_seat jsonb, p_route boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_k jsonb := public.cockpit_kickoff_items_kickoff(p_task_id);
  v_on text[] := public.cockpit_kickoff_items_on();
  v_trig jsonb := '[]'::jsonb;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_day date;
  v_since timestamptz;
  v_in_window boolean := false;
  v_items jsonb := '[]'::jsonb;
  c jsonb;
  t jsonb;
  d public.cockpit_kickoff_item_answers;
  ty public.cockpit_request_types;
  r public.cockpit_requests;
  x public.cockpit_requests;
  v_state text;
  v_enabled boolean;
  v_one_tap boolean;
  v_details_key text;
  v_details text;
  v_value text;
  v_priority text;
  v_request jsonb;
  v_existing jsonb;
  v_route jsonb;
  v_preview jsonb;
  v_rowj jsonb;
  v_offered boolean;
  v_blocked text;
  v_reason text;
  v_note text;
BEGIN
  IF v_k IS NOT NULL THEN
    v_day := (((v_k->>'at')::timestamptz) AT TIME ZONE 'Asia/Kuwait')::date;
    v_since := ((v_day - 1)::timestamp) AT TIME ZONE 'Asia/Kuwait';
    v_in_window := coalesce((v_k->>'inOnboarding')::boolean, false) OR (v_today - v_day) <= 14;
    IF coalesce((v_k->>'answered')::boolean, false) THEN
      v_trig := public.cockpit_kickoff_request_items(v_k->'byRef');
    END IF;
  END IF;

  FOR c IN SELECT e FROM jsonb_array_elements(public.cockpit_kickoff_item_catalog()) WITH ORDINALITY AS u(e, n) ORDER BY n LOOP
    t := NULL; d := NULL; ty := NULL; r := NULL; x := NULL;
    v_request := NULL; v_existing := NULL; v_route := NULL; v_details := NULL; v_details_key := NULL;
    SELECT e INTO t FROM jsonb_array_elements(v_trig) e WHERE e->>'item' = c->>'item' LIMIT 1;
    IF NOT (c->>'item') = ANY(v_on) THEN t := NULL; END IF;
    SELECT * INTO d FROM public.cockpit_kickoff_item_answers a WHERE a.task_id = p_task_id AND a.item = c->>'item';
    CONTINUE WHEN t IS NULL AND d.task_id IS NULL;
    -- An undecided item shows only inside the window.
    CONTINUE WHEN d.task_id IS NULL AND NOT v_in_window;

    SELECT * INTO ty FROM public.cockpit_request_types q WHERE q.key = c->>'typeKey';
    v_enabled := coalesce(ty.enabled, false);
    v_one_tap := ty.key IS NOT NULL AND public.cockpit_kickoff_item_one_tap(ty);
    v_value := coalesce(t->>'value', d.kickoff_value);
    v_priority := coalesce(c->>'priority', ty.priority);
    IF ty.key IS NOT NULL THEN
      SELECT f->>'key' INTO v_details_key FROM jsonb_array_elements(ty.fields) WITH ORDINALITY AS z(f, n)
       WHERE f->>'kind' = 'details' ORDER BY n LIMIT 1;
    END IF;
    IF v_details_key IS NOT NULL AND v_day IS NOT NULL THEN
      v_details := public.cockpit_kickoff_item_details(c->>'item', v_value, v_day);
    END IF;

    -- The request counted for the item.
    IF d.request_id IS NOT NULL THEN
      SELECT * INTO r FROM public.cockpit_requests q WHERE q.id = d.request_id;
      IF p_seat IS NOT NULL AND public.cockpit_request_may_open(r, p_seat) THEN
        v_rowj := public.cockpit_request_row(r, p_seat);
        v_request := jsonb_build_object('id', r.id, 'state', r.state, 'done', r.done_at IS NOT NULL,
          'typeKey', r.type_key, 'typeLabel', r.type_label, 'dueOn', to_char(r.due_on, 'YYYY-MM-DD'), 'priority', r.priority,
          'held', v_rowj->'held', 'heldNote', v_rowj->'heldNote',
          'url', v_rowj->'parts'->0->'url', 'partState', v_rowj->'parts'->0->'state', 'mayOpen', true);
      ELSE
        v_request := jsonb_build_object('state', r.state, 'done', r.done_at IS NOT NULL, 'typeLabel', r.type_label,
          'raisedBy', coalesce(nullif(btrim(r.requester_label), ''), 'a team member'), 'mayOpen', false);
      END IF;
    END IF;

    -- The state.
    IF d.answer = 'raised' THEN
      v_state := CASE WHEN r.state IN ('cancelled', 'failed') AND t IS NOT NULL THEN 'reopened' ELSE 'raised' END;
    ELSIF d.answer = 'declined' THEN
      v_state := 'declined';
    ELSIF NOT v_enabled THEN
      v_state := 'type_off';
    ELSE
      v_state := 'open';
    END IF;

    -- An open request of the item's type already on the card, made since the kickoff day less one day, not counted
    -- for another item (an old form ticket imported from ClickUp counts).
    IF v_state IN ('open', 'declined', 'reopened') AND v_enabled AND v_since IS NOT NULL THEN
      SELECT * INTO x FROM public.cockpit_requests q
       WHERE q.client_task_id = p_task_id AND q.type_key = c->>'typeKey'
         AND q.state NOT IN ('cancelled', 'failed', 'routed') AND q.done_at IS NULL
         AND (q.source <> 'import' OR q.import_left_at IS NULL)
         AND q.created_at >= v_since
         AND NOT EXISTS (SELECT 1 FROM public.cockpit_kickoff_item_answers o
                          WHERE o.request_id = q.id AND NOT (o.task_id = p_task_id AND o.item = c->>'item'))
       ORDER BY q.created_at DESC LIMIT 1;
      IF x.id IS NOT NULL THEN
        v_existing := jsonb_build_object('requestId', x.id, 'typeLabel', x.type_label, 'createdAt', x.created_at,
          'requesterLabel', coalesce(nullif(btrim(x.requester_label), ''), 'a team member'),
          'imported', x.source = 'import',
          'mayOpen', p_seat IS NOT NULL AND public.cockpit_request_may_open(x, p_seat));
        IF v_state = 'open' THEN v_state := 'already_open'; END IF;
      END IF;
    END IF;

    -- To decide now (Today counts these): inside the window only.
    v_offered := v_in_window AND v_state IN ('open', 'already_open', 'reopened');
    -- A card with no onboarding row is not on the requests' client list (cockpit_request_submit refuses it), so
    -- only a No can be recorded there.
    v_blocked := CASE WHEN NOT coalesce((v_k->>'hasRow')::boolean, false) AND v_state IN ('open', 'already_open', 'reopened', 'declined')
                      THEN 'This client is not on the cockpit''s client list yet, so a request cannot be raised for it here. Raise it in ClickUp.' END;

    -- Where a Yes would go, from the same plan the submit runs (owners by role).
    IF p_route AND p_seat IS NOT NULL AND v_enabled AND v_blocked IS NULL AND v_state IN ('open', 'already_open', 'reopened', 'declined') THEN
      BEGIN
        v_preview := public.cockpit_request_preview(ty.key, p_task_id,
          CASE WHEN v_details IS NOT NULL THEN jsonb_build_object(v_details_key, v_details) ELSE '{}'::jsonb END);
        v_route := jsonb_build_object(
          'teamLabel', v_preview->'parts'->0->>'teamLabel',
          'ownerLabel', v_preview->'parts'->0->'owner'->>'label',
          'ownerNote', v_preview->'parts'->0->'owner'->>'note',
          'dueDefault', v_preview->>'dueDefault',
          'dueWords', public.cockpit_request_day_words((v_preview->>'dueDefault')::date),
          'priority', v_priority,
          'writer', v_preview->'writer');
      EXCEPTION WHEN OTHERS THEN
        v_route := jsonb_build_object('note', SQLERRM);
      END;
    END IF;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'item', c->>'item', 'short', c->>'short',
      'line', replace(c->>'line', '{option}', coalesce(v_value, '')),
      'value', v_value, 'typeKey', c->>'typeKey', 'typeLabel', coalesce(ty.label, c->>'typeKey'),
      'typeEnabled', v_enabled, 'oneTap', v_one_tap, 'details', v_details, 'priority', v_priority,
      'state', v_state, 'offered', v_offered, 'stillOpen', t IS NOT NULL,
      'blocked', v_blocked,
      'actions', jsonb_build_object(
        'raise', v_enabled AND v_one_tap AND v_existing IS NULL AND v_blocked IS NULL
                 AND (v_state = 'open' OR (v_state IN ('declined', 'reopened') AND t IS NOT NULL)),
        'decline', v_state IN ('open', 'already_open', 'reopened'),
        'link', v_blocked IS NULL AND v_state IN ('open', 'already_open', 'reopened', 'declined', 'type_off')),
      'route', v_route,
      'decision', CASE WHEN d.task_id IS NOT NULL THEN jsonb_build_object(
        'answer', d.answer, 'how', d.how, 'typeKey', d.type_key, 'byLabel', d.decided_by_label, 'at', d.decided_at, 'note', d.note,
        'mine', p_seat IS NOT NULL AND d.decided_by_member::text = p_seat->>'memberId',
        'kickoffRef', d.kickoff_ref) END,
      'request', v_request,
      'existing', v_existing));
  END LOOP;

  IF v_k IS NULL THEN
    v_reason := 'no_kickoff';
    v_note := 'No kickoff is stored for this client yet.';
  ELSIF NOT coalesce((v_k->>'answered')::boolean, false) AND jsonb_array_length(v_items) = 0 THEN
    v_reason := 'no_answers';
    v_note := 'The kickoff''s answers are not in the cockpit, so its open items cannot show here. They are in the card''s Kickoff Handoff comment.';
  ELSIF jsonb_array_length(v_items) = 0 AND NOT v_in_window THEN
    v_reason := 'closed';
    v_note := 'Kickoff items show while the client is in onboarding, or for 14 days after the kickoff.';
  ELSIF jsonb_array_length(v_items) = 0 THEN
    v_reason := 'none';
    v_note := 'Nothing from the kickoff needs a request.';
  END IF;

  RETURN jsonb_build_object(
    'kickoff', CASE WHEN v_k IS NOT NULL THEN jsonb_build_object('at', v_k->'at', 'formId', v_k->'formId', 'ref', v_k->'ref',
                 'source', v_k->'source', 'answered', v_k->'answered', 'inOnboarding', v_k->'inOnboarding',
                 'day', public.cockpit_request_day_words(v_day)) END,
    'inWindow', v_in_window, 'reason', v_reason, 'note', v_note, 'items', v_items);
END $$;

-- The gate: the CEO, or a seat with the csm role the client gate lets in for the card (an admin, or a CSM with the
-- client on its access list). The kickoff's own rule (cockpit_kickoff_seat), with this feature's sentence.
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_items_seat(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_seat jsonb := public.cockpit_form_actor();
BEGIN
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023';
  END IF;
  IF NOT coalesce((v_seat->>'ceo')::boolean, false) THEN
    IF NOT coalesce((v_seat->>'csm')::boolean, false) THEN
      RAISE EXCEPTION 'Only the CEO or the client''s CSM decides kickoff items.' USING ERRCODE = '42501';
    END IF;
    PERFORM public.cockpit_csm_client_gate(p_task_id);
  END IF;
  RETURN v_seat;
END $$;

-- One item's row from the state, or NULL.
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_items_row(p_state jsonb, p_item text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT e FROM jsonb_array_elements(coalesce(p_state->'items', '[]'::jsonb)) e WHERE e->>'item' = p_item LIMIT 1
$$;

-- Refuses an item key that is not in the catalogue.
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_items_known(p_item text)
RETURNS void LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_item IS NULL OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(public.cockpit_kickoff_item_catalog()) e
                                    WHERE e->>'item' = p_item) THEN
    RAISE EXCEPTION 'That is not a kickoff item. Reload the page.' USING ERRCODE = '22023';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Browser RPCs (a signed-in seat; the gate first)

-- The client page and the kickoff sheet: {asOf, kickoff: {at, day, formId, ref, source, answered, inOnboarding} |
-- null, inWindow, reason, note, items: [ItemRow with route]}.
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_items_read(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_kickoff_items_seat(p_task_id);
  v_rseat jsonb := public.cockpit_request_seat();
BEGIN
  RETURN jsonb_build_object('asOf', now(), 'taskId', p_task_id)
      || public.cockpit_kickoff_items_state(p_task_id, v_rseat, true);
END $$;

-- Yes: raise the item in one tap. p_request_id is the browser's request id, kept for the press across retries.
-- Answers {ok, raised, reused, state: 'already_open' when an open request of the type is there (nothing written),
-- item: ItemRow, submit: {id, state, held, note}}. A retry of the same press answers reused with submit built from
-- the counted request, as cockpit_request_submit answers its own retry (held now, and the send gate's note when held).
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_item_raise(p_task_id text, p_item text, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_kickoff_items_seat(p_task_id);
  v_rseat jsonb;
  c jsonb;
  d public.cockpit_kickoff_item_answers;
  v_after public.cockpit_kickoff_item_answers;
  v_state jsonb;
  v_row jsonb;
  ty public.cockpit_request_types;
  v_details_key text;
  v_answers jsonb := '{}'::jsonb;
  v_submit jsonb;
  v_k jsonb;
  v_again boolean;
  v_req public.cockpit_requests;
  v_held boolean;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Send the request id, so a second press raises nothing twice.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.cockpit_kickoff_items_known(p_item);
  -- Two presses on two screens are taken in turn.
  PERFORM pg_advisory_xact_lock(hashtext('kickoff_item:' || p_task_id || ':' || p_item));
  v_rseat := public.cockpit_request_seat();
  SELECT * INTO d FROM public.cockpit_kickoff_item_answers a WHERE a.task_id = p_task_id AND a.item = p_item FOR UPDATE;
  -- A retry of the same press.
  IF d.request_id = p_request_id THEN
    SELECT * INTO v_req FROM public.cockpit_requests q WHERE q.id = d.request_id;
    v_held := coalesce(public.cockpit_request_held(v_req), false);
    v_state := public.cockpit_kickoff_items_state(p_task_id, v_rseat, false);
    RETURN jsonb_build_object('ok', true, 'raised', true, 'reused', true,
      'item', public.cockpit_kickoff_items_row(v_state, p_item),
      'submit', jsonb_build_object('id', v_req.id, 'state', v_req.state, 'held', v_held,
        'note', CASE WHEN v_held THEN public.cockpit_request_send_gate(v_rseat, p_task_id)->>'note' END));
  END IF;
  v_state := public.cockpit_kickoff_items_state(p_task_id, v_rseat, false);
  v_row := public.cockpit_kickoff_items_row(v_state, p_item);
  IF v_row IS NULL OR (v_row->>'state' IN ('declined', 'reopened') AND NOT (v_row->>'stillOpen')::boolean) THEN
    RAISE EXCEPTION 'That item is not open on this client''s kickoff any more.' USING ERRCODE = '22023';
  END IF;
  IF v_row->>'state' = 'raised' THEN
    RAISE EXCEPTION 'Already raised on % by %.', public.cockpit_request_day_words((d.decided_at AT TIME ZONE 'Asia/Kuwait')::date),
      d.decided_by_label USING ERRCODE = '55000';
  END IF;
  IF v_row->>'state' = 'type_off' THEN
    RAISE EXCEPTION '% is turned off in Requests settings, so it cannot be raised here. Ask the systems manager.',
      v_row->>'typeLabel' USING ERRCODE = '55000';
  END IF;
  IF v_row->>'blocked' IS NOT NULL THEN
    RAISE EXCEPTION USING MESSAGE = v_row->>'blocked', ERRCODE = '55000';
  END IF;
  IF NOT coalesce((v_row->>'oneTap')::boolean, false) THEN
    RAISE EXCEPTION '% needs answers the kickoff does not have. Raise it with the form.', v_row->>'typeLabel'
      USING ERRCODE = '55000';
  END IF;
  IF jsonb_typeof(v_row->'existing') = 'object' THEN
    -- Nothing is written: the screen offers "Count it".
    RETURN jsonb_build_object('ok', true, 'raised', false, 'reused', false, 'state', 'already_open', 'item', v_row);
  END IF;

  -- The answers as the form builds them: the details sentence where the type asks for details.
  SELECT e INTO c FROM jsonb_array_elements(public.cockpit_kickoff_item_catalog()) e WHERE e->>'item' = p_item;
  SELECT * INTO ty FROM public.cockpit_request_types q WHERE q.key = c->>'typeKey';
  SELECT f->>'key' INTO v_details_key FROM jsonb_array_elements(ty.fields) WITH ORDINALITY AS z(f, n)
   WHERE f->>'kind' = 'details' ORDER BY n LIMIT 1;
  IF v_details_key IS NOT NULL AND v_row->>'details' IS NOT NULL THEN
    v_answers := jsonb_build_object(v_details_key, v_row->>'details');
  END IF;
  -- The one create path, as the caller (the requests gate, the client check, the checks, the audit, the kick).
  v_submit := public.cockpit_request_submit(p_request_id, ty.key, p_task_id, v_answers,
    public.cockpit_request_due_default(ty.due_days), coalesce(c->>'priority', ty.priority), 'client_page', NULL);
  IF v_submit->>'id' IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = coalesce(v_submit->>'note', 'The request could not be raised. Raise it with the form.'),
      ERRCODE = '55000';
  END IF;

  v_k := v_state->'kickoff';
  v_again := d.task_id IS NOT NULL;
  INSERT INTO public.cockpit_kickoff_item_answers AS a(task_id, item, kickoff_ref, kickoff_at, kickoff_value, answer, request_id,
    how, type_key, note, decided_by_member, decided_by_email, decided_by_label, decided_at, updated_at)
  VALUES (p_task_id, p_item, v_k->>'ref', (v_k->>'at')::timestamptz, v_row->>'value', 'raised', (v_submit->>'id')::uuid,
    'one_tap', ty.key, NULL, (v_seat->>'memberId')::uuid, v_seat->>'email',
    coalesce(public.cockpit_slack_notice_role_of(v_seat->>'email'), 'a team member'), now(), now())
  ON CONFLICT (task_id, item) DO UPDATE SET kickoff_ref = excluded.kickoff_ref, kickoff_at = excluded.kickoff_at,
    kickoff_value = excluded.kickoff_value, answer = excluded.answer, request_id = excluded.request_id, how = excluded.how,
    type_key = excluded.type_key, note = NULL, decided_by_member = excluded.decided_by_member,
    decided_by_email = excluded.decided_by_email, decided_by_label = excluded.decided_by_label,
    decided_at = excluded.decided_at, updated_at = now()
  RETURNING * INTO v_after;
  PERFORM public.cockpit_request_audit('kickoff_item.raised', 'cockpit_kickoff_item_answers', p_task_id || ':' || p_item,
    v_seat->>'email', CASE WHEN v_again THEN to_jsonb(d) END, to_jsonb(v_after),
    jsonb_build_object('item', p_item, 'type', ty.key, 'requestId', v_submit->>'id', 'kickoffRef', v_k->>'ref',
      'value', v_row->>'value', 'how', 'one_tap', 'again', v_again));

  v_state := public.cockpit_kickoff_items_state(p_task_id, v_rseat, false);
  RETURN jsonb_build_object('ok', true, 'raised', true, 'reused', coalesce((v_submit->>'reused')::boolean, false),
    'item', public.cockpit_kickoff_items_row(v_state, p_item),
    'submit', jsonb_build_object('id', v_submit->'id', 'state', v_submit->'state', 'held', v_submit->'held',
      'note', v_submit->'note'));
END $$;

-- Count a request already sent for the item: one the CSM sent through "Change it first" (the ticket form,
-- any type), or "Count it" on one that was already open. Answers {ok, linked, reused, item: ItemRow}.
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_item_link(p_task_id text, p_item text, p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_kickoff_items_seat(p_task_id);
  v_rseat jsonb;
  d public.cockpit_kickoff_item_answers;
  v_after public.cockpit_kickoff_item_answers;
  r public.cockpit_requests;
  v_state jsonb;
  v_row jsonb;
  v_k jsonb;
  v_since timestamptz;
  v_mine boolean;
  v_how text;
  v_again boolean;
BEGIN
  IF p_request_id IS NULL THEN
    RAISE EXCEPTION 'Send the request to count.' USING ERRCODE = '22023';
  END IF;
  PERFORM public.cockpit_kickoff_items_known(p_item);
  PERFORM pg_advisory_xact_lock(hashtext('kickoff_item:' || p_task_id || ':' || p_item));
  v_rseat := public.cockpit_request_seat();
  SELECT * INTO d FROM public.cockpit_kickoff_item_answers a WHERE a.task_id = p_task_id AND a.item = p_item FOR UPDATE;
  IF d.request_id = p_request_id THEN
    v_state := public.cockpit_kickoff_items_state(p_task_id, v_rseat, false);
    RETURN jsonb_build_object('ok', true, 'linked', true, 'reused', true, 'item', public.cockpit_kickoff_items_row(v_state, p_item));
  END IF;
  v_state := public.cockpit_kickoff_items_state(p_task_id, v_rseat, false);
  v_row := public.cockpit_kickoff_items_row(v_state, p_item);
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'That item is not open on this client''s kickoff any more.' USING ERRCODE = '22023';
  END IF;
  IF v_row->>'state' = 'raised' THEN
    RAISE EXCEPTION 'Already raised on % by %.', public.cockpit_request_day_words((d.decided_at AT TIME ZONE 'Asia/Kuwait')::date),
      d.decided_by_label USING ERRCODE = '55000';
  END IF;
  SELECT * INTO r FROM public.cockpit_requests q WHERE q.id = p_request_id;
  IF r.id IS NULL OR r.client_task_id IS DISTINCT FROM p_task_id THEN
    RAISE EXCEPTION 'That request is not for this client.' USING ERRCODE = '22023';
  END IF;
  IF r.state IN ('cancelled', 'failed', 'routed') THEN
    RAISE EXCEPTION 'That request was cancelled or did not reach ClickUp, so it cannot be counted. Raise the item again.'
      USING ERRCODE = '55000';
  END IF;
  v_k := v_state->'kickoff';
  v_since := (((((v_k->>'at')::timestamptz) AT TIME ZONE 'Asia/Kuwait')::date - 1)::timestamp) AT TIME ZONE 'Asia/Kuwait';
  IF r.created_at < v_since THEN
    RAISE EXCEPTION 'That request is older than the kickoff, so it is not counted for it.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_kickoff_item_answers o
              WHERE o.request_id = r.id AND NOT (o.task_id = p_task_id AND o.item = p_item)) THEN
    RAISE EXCEPTION 'That request is already counted for another kickoff item.' USING ERRCODE = '55000';
  END IF;
  v_mine := r.requester_member_id IS NOT NULL AND r.requester_member_id::text = v_rseat->>'memberId';
  IF NOT v_mine AND NOT public.cockpit_request_may_open(r, v_rseat) THEN
    RAISE EXCEPTION 'You cannot count that request. Ask whoever raised it.' USING ERRCODE = '42501';
  END IF;
  v_how := CASE WHEN v_mine AND r.created_at >= now() - interval '10 minutes' THEN 'form' ELSE 'linked' END;
  v_again := d.task_id IS NOT NULL;
  INSERT INTO public.cockpit_kickoff_item_answers AS a(task_id, item, kickoff_ref, kickoff_at, kickoff_value, answer, request_id,
    how, type_key, note, decided_by_member, decided_by_email, decided_by_label, decided_at, updated_at)
  VALUES (p_task_id, p_item, v_k->>'ref', (v_k->>'at')::timestamptz, v_row->>'value', 'raised', r.id, v_how, r.type_key, NULL,
    (v_seat->>'memberId')::uuid, v_seat->>'email', coalesce(public.cockpit_slack_notice_role_of(v_seat->>'email'), 'a team member'),
    now(), now())
  ON CONFLICT (task_id, item) DO UPDATE SET kickoff_ref = excluded.kickoff_ref, kickoff_at = excluded.kickoff_at,
    kickoff_value = excluded.kickoff_value, answer = excluded.answer, request_id = excluded.request_id, how = excluded.how,
    type_key = excluded.type_key, note = NULL, decided_by_member = excluded.decided_by_member,
    decided_by_email = excluded.decided_by_email, decided_by_label = excluded.decided_by_label,
    decided_at = excluded.decided_at, updated_at = now()
  RETURNING * INTO v_after;
  PERFORM public.cockpit_request_audit('kickoff_item.linked', 'cockpit_kickoff_item_answers', p_task_id || ':' || p_item,
    v_seat->>'email', CASE WHEN v_again THEN to_jsonb(d) END, to_jsonb(v_after),
    jsonb_build_object('item', p_item, 'type', r.type_key, 'requestId', r.id, 'kickoffRef', v_k->>'ref',
      'value', v_row->>'value', 'how', v_how, 'again', v_again));
  v_state := public.cockpit_kickoff_items_state(p_task_id, v_rseat, false);
  RETURN jsonb_build_object('ok', true, 'linked', true, 'reused', false, 'item', public.cockpit_kickoff_items_row(v_state, p_item));
END $$;

-- No: recorded, with an optional note (240 characters at most). Answers {ok, declined, reused, item: ItemRow}.
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_item_decline(p_task_id text, p_item text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_kickoff_items_seat(p_task_id);
  v_rseat jsonb;
  d public.cockpit_kickoff_item_answers;
  v_after public.cockpit_kickoff_item_answers;
  v_state jsonb;
  v_row jsonb;
  v_k jsonb;
  v_note text := nullif(left(btrim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g')), 240), '');
  v_again boolean;
BEGIN
  PERFORM public.cockpit_kickoff_items_known(p_item);
  PERFORM pg_advisory_xact_lock(hashtext('kickoff_item:' || p_task_id || ':' || p_item));
  v_rseat := public.cockpit_request_seat();
  SELECT * INTO d FROM public.cockpit_kickoff_item_answers a WHERE a.task_id = p_task_id AND a.item = p_item FOR UPDATE;
  v_state := public.cockpit_kickoff_items_state(p_task_id, v_rseat, false);
  v_row := public.cockpit_kickoff_items_row(v_state, p_item);
  IF v_row IS NULL THEN
    RAISE EXCEPTION 'That item is not open on this client''s kickoff any more.' USING ERRCODE = '22023';
  END IF;
  IF v_row->>'state' = 'raised' AND v_row->'request'->>'state' IN ('cancelled', 'failed') THEN
    RAISE EXCEPTION 'That item is not open on this client''s kickoff any more.' USING ERRCODE = '22023';
  END IF;
  IF v_row->>'state' = 'raised' THEN
    RAISE EXCEPTION 'This was raised as a request. Cancel the request in My requests if it is not needed.' USING ERRCODE = '55000';
  END IF;
  IF v_row->>'state' = 'declined' THEN
    RETURN jsonb_build_object('ok', true, 'declined', true, 'reused', true, 'item', v_row);
  END IF;
  IF v_row->>'state' = 'type_off' THEN
    RAISE EXCEPTION '% is turned off in Requests settings, so it cannot be raised here. Ask the systems manager.',
      v_row->>'typeLabel' USING ERRCODE = '55000';
  END IF;
  v_k := v_state->'kickoff';
  v_again := d.task_id IS NOT NULL;
  INSERT INTO public.cockpit_kickoff_item_answers AS a(task_id, item, kickoff_ref, kickoff_at, kickoff_value, answer, request_id,
    how, type_key, note, decided_by_member, decided_by_email, decided_by_label, decided_at, updated_at)
  VALUES (p_task_id, p_item, v_k->>'ref', (v_k->>'at')::timestamptz, v_row->>'value', 'declined', NULL, NULL, NULL, v_note,
    (v_seat->>'memberId')::uuid, v_seat->>'email', coalesce(public.cockpit_slack_notice_role_of(v_seat->>'email'), 'a team member'),
    now(), now())
  ON CONFLICT (task_id, item) DO UPDATE SET kickoff_ref = excluded.kickoff_ref, kickoff_at = excluded.kickoff_at,
    kickoff_value = excluded.kickoff_value, answer = excluded.answer, request_id = NULL, how = NULL, type_key = NULL,
    note = excluded.note, decided_by_member = excluded.decided_by_member, decided_by_email = excluded.decided_by_email,
    decided_by_label = excluded.decided_by_label, decided_at = excluded.decided_at, updated_at = now()
  RETURNING * INTO v_after;
  PERFORM public.cockpit_request_audit('kickoff_item.declined', 'cockpit_kickoff_item_answers', p_task_id || ':' || p_item,
    v_seat->>'email', CASE WHEN v_again THEN to_jsonb(d) END, to_jsonb(v_after),
    jsonb_build_object('item', p_item, 'kickoffRef', v_k->>'ref', 'value', v_row->>'value', 'noted', v_note IS NOT NULL,
      'again', v_again));
  v_state := public.cockpit_kickoff_items_state(p_task_id, v_rseat, false);
  RETURN jsonb_build_object('ok', true, 'declined', true, 'reused', false, 'item', public.cockpit_kickoff_items_row(v_state, p_item));
END $$;

-- The cards a kickoff item may be offered on: in onboarding, or a kickoff (read model or native) in the last 16
-- days (the state applies the exact 14 Kuwait days).
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_items_cards()
RETURNS TABLE(task_id text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT o.clickup_task_id FROM public.cockpit_client_onboarding o
   WHERE o.in_onboarding
      OR (jsonb_typeof(o.forms->'kickoff') = 'object'
          AND coalesce(public.cockpit_form_stage4_ts(o.forms->'kickoff'->>'submitted_at'), o.synced_at) >= now() - interval '16 days')
  UNION
  SELECT r.task_id FROM public.cockpit_form_responses r
   WHERE r.form_key = 'kickoff' AND r.task_id IS NOT NULL AND r.state NOT IN ('draft', 'void') AND r.mode = 'live'
     AND r.source = 'cockpit' AND r.form_version >= 2
     AND coalesce(r.submitted_at, r.created_at) >= now() - interval '16 days'
$$;

-- Today, "Kickoff items to decide": {asOf, rows: [{taskId, clientName, kickoffAt, kickoffDay, due, items:
-- [ItemRow without route]}], more, note}. Oldest kickoff first, 30 cards at most. The CEO and admins see every
-- card their client list allows; a CSM its own cards and the unmatched ones.
CREATE OR REPLACE FUNCTION public.cockpit_kickoff_items_due()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_form_actor();
  v_rseat jsonb;
  v_all boolean;
  v_me text;
  v_task text;
  v_k jsonb;
  v_st jsonb;
  v_due integer;
  v_csm_email text;
  v_sender uuid;
  v_sender_seat boolean;
  v_rows jsonb := '[]'::jsonb;
  v_n integer := 0;
BEGIN
  IF NOT (coalesce((v_seat->>'ceo')::boolean, false) OR coalesce((v_seat->>'csm')::boolean, false)) THEN
    RAISE EXCEPTION 'Kickoff items are for the client success team.' USING ERRCODE = '42501';
  END IF;
  v_rseat := public.cockpit_request_seat();
  v_all := coalesce((v_seat->>'ceo')::boolean, false) OR coalesce((v_seat->>'admin')::boolean, false);
  v_me := lower(btrim(v_seat->>'email'));
  FOR v_task, v_k IN
    SELECT c.task_id, public.cockpit_kickoff_items_kickoff(c.task_id) FROM public.cockpit_kickoff_items_cards() c
  LOOP
    CONTINUE WHEN v_k IS NULL OR NOT coalesce((v_k->>'answered')::boolean, false);
    -- A card with no client name is never "every client": only the CEO and admins see it.
    CONTINUE WHEN v_k->>'clientName' IS NULL AND NOT v_all;
    CONTINUE WHEN NOT public.cockpit_ask_ai_owner_allowed(auth.uid(), 'client-success', v_k->>'clientName');
    IF NOT v_all THEN
      v_sender := (v_k->>'sender')::uuid;
      v_sender_seat := v_sender IS NOT NULL AND EXISTS (SELECT 1 FROM public.cockpit_members m
                                                         WHERE m.auth_user_id = v_sender AND m.active);
      v_csm_email := public.cockpit_kickoff_items_csm_email(v_k->>'csm');
      -- Its own card (it sent the kickoff, or the card's CSM is its seat), or an unmatched one (nobody's).
      CONTINUE WHEN NOT (coalesce(v_sender = auth.uid(), false) OR coalesce(v_csm_email = v_me, false)
                         OR (NOT v_sender_seat AND v_csm_email IS NULL));
    END IF;
    v_st := public.cockpit_kickoff_items_state(v_task, v_rseat, false);
    SELECT count(*) INTO v_due FROM jsonb_array_elements(v_st->'items') e WHERE (e->>'offered')::boolean;
    CONTINUE WHEN v_due = 0;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('taskId', v_task, 'clientName', v_k->>'clientName',
      'kickoffAt', v_k->'at', 'kickoffDay', v_st->'kickoff'->'day', 'due', v_due,
      'items', (SELECT coalesce(jsonb_agg(e - 'route' ORDER BY n), '[]'::jsonb)
                  FROM jsonb_array_elements(v_st->'items') WITH ORDINALITY AS u(e, n))));
  END LOOP;
  SELECT coalesce(jsonb_agg(e ORDER BY (e->>'kickoffAt')::timestamptz, e->>'taskId'), '[]'::jsonb), count(*)
    INTO v_rows, v_n FROM jsonb_array_elements(v_rows) e;
  RETURN jsonb_build_object('asOf', now(),
    'rows', (SELECT coalesce(jsonb_agg(e ORDER BY n), '[]'::jsonb) FROM jsonb_array_elements(v_rows) WITH ORDINALITY AS u(e, n) WHERE n <= 30),
    'more', v_n > 30,
    'note', CASE WHEN v_n = 0 THEN 'No kickoff items to decide.' END);
END $$;

-- ---------------------------------------------------------------------------
-- 6. The doctor (service role, report only): one plain sentence per problem, counts, no client data.

CREATE OR REPLACE FUNCTION public.cockpit_kickoff_items_doctor()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_on text[] := public.cockpit_kickoff_items_on();
  v_fields jsonb := public.cockpit_form_stage4_fields('kickoff');
  v_problems text[] := '{}';
  v_notes text[] := '{}';
  v_items jsonb := '[]'::jsonb;
  c jsonb;
  f jsonb;
  ty public.cockpit_request_types;
  v_asked boolean;
  v_missing text;
  v_one_tap boolean;
  v_src text;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_task text;
  v_st jsonb;
  v_offered integer := 0;
  v_type_off integer := 0;
  v_reopened integer := 0;
  v_cards integer := 0;
  v_oldest integer;
  e jsonb;
BEGIN
  -- The switch fails closed (cockpit_kickoff_items_on): a missing or malformed setting is a problem, never a note.
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_settings s WHERE s.key = 'forms.kickoff_items') THEN
    v_problems := v_problems || 'forms.kickoff_items: the setting is missing, so every kickoff item is off. Set it with cockpit_kickoff_items_switch: the items to keep on, or {} to stop them all.'::text;
  ELSIF NOT EXISTS (SELECT 1 FROM public.cockpit_settings s WHERE s.key = 'forms.kickoff_items' AND jsonb_typeof(s.value->'on') = 'array') THEN
    v_problems := v_problems || 'forms.kickoff_items: the setting is not a list of items, so every kickoff item is off. Set it with cockpit_kickoff_items_switch: the items to keep on, or {} to stop them all.'::text;
  ELSIF cardinality(v_on) = 0 THEN
    v_notes := v_notes || 'Every kickoff item is off (forms.kickoff_items), so none is offered.'::text;
  END IF;
  FOR c IN SELECT x FROM jsonb_array_elements(public.cockpit_kickoff_item_catalog()) WITH ORDINALITY AS u(x, n) ORDER BY n LOOP
    ty := NULL; f := NULL; v_missing := NULL;
    SELECT * INTO ty FROM public.cockpit_request_types q WHERE q.key = c->>'typeKey';
    SELECT x INTO f FROM jsonb_array_elements(v_fields) x WHERE x->>'typeformRef' = c->>'ref' LIMIT 1;
    SELECT string_agg(v, ', ') INTO v_missing FROM jsonb_array_elements_text(c->'values') v
     WHERE f IS NULL OR jsonb_typeof(f->'options') <> 'array' OR NOT (f->'options') ? v;
    v_asked := f IS NOT NULL AND v_missing IS NULL;
    v_one_tap := ty.key IS NOT NULL AND public.cockpit_kickoff_item_one_tap(ty);
    v_items := v_items || jsonb_build_array(jsonb_build_object('item', c->>'item', 'on', (c->>'item') = ANY(v_on),
      'typeKey', c->>'typeKey', 'typeExists', ty.key IS NOT NULL, 'typeEnabled', coalesce(ty.enabled, false),
      'oneTap', v_one_tap, 'asked', v_asked,
      'details', ty.key IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(ty.fields) z WHERE z->>'kind' = 'details')));
    CONTINUE WHEN NOT (c->>'item') = ANY(v_on);
    IF ty.key IS NULL THEN
      v_problems := v_problems || format('%s: the request type %s is missing, so the item cannot be raised. Restore the type, or turn the item off.',
        c->>'short', c->>'typeKey');
    ELSIF NOT ty.enabled THEN
      v_problems := v_problems || format('%s: %s is turned off in Requests settings, so the item shows as turned off. Turn the type on, or turn the item off.',
        c->>'short', ty.label);
    ELSIF NOT v_one_tap THEN
      v_problems := v_problems || format('%s: %s asks something the kickoff does not have, so Yes opens the form. Make that question optional in Requests settings.',
        c->>'short', ty.label);
    END IF;
    IF NOT v_asked THEN
      v_problems := v_problems || format('%s: the kickoff no longer asks %s with the answer %s, so the item is never offered. Update the item list (20261103d''s catalogue).',
        c->>'short', coalesce('"' || (f->>'title') || '"', 'its question (' || (c->>'ref') || ')'), coalesce(v_missing, (c->'values')->>0));
    END IF;
  END LOOP;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_request_submit(uuid,text,text,jsonb,date,text,text,text)');
  IF v_src IS NULL OR position('''client_page''' IN v_src) = 0 THEN
    v_problems := v_problems || 'cockpit_request_submit no longer has the 8 arguments or the client_page source that Yes calls, so Yes fails. Re-read it and fix 20261103d on a branch.'::text;
  END IF;
  FOR v_task IN SELECT c2.task_id FROM public.cockpit_kickoff_items_cards() c2 LOOP
    v_st := public.cockpit_kickoff_items_state(v_task, NULL, false);
    CONTINUE WHEN jsonb_array_length(v_st->'items') = 0;
    v_cards := v_cards + 1;
    FOR e IN SELECT x FROM jsonb_array_elements(v_st->'items') x LOOP
      IF (e->>'offered')::boolean THEN
        v_offered := v_offered + 1;
        v_oldest := greatest(coalesce(v_oldest, 0),
          v_today - (((v_st->'kickoff'->>'at')::timestamptz) AT TIME ZONE 'Asia/Kuwait')::date);
      END IF;
      IF e->>'state' = 'type_off' THEN v_type_off := v_type_off + 1; END IF;
      IF e->>'state' = 'reopened' THEN v_reopened := v_reopened + 1; END IF;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('ok', cardinality(v_problems) = 0, 'problems', to_jsonb(v_problems), 'notes', to_jsonb(v_notes),
    'on', to_jsonb(v_on), 'items', v_items,
    'counts', jsonb_build_object(
      'cards', v_cards, 'offered', v_offered, 'typeOff', v_type_off, 'reopened', v_reopened,
      'raised', (SELECT count(*) FROM public.cockpit_kickoff_item_answers a WHERE a.answer = 'raised'),
      'declined', (SELECT count(*) FROM public.cockpit_kickoff_item_answers a WHERE a.answer = 'declined'),
      'oldestUndecidedDays', v_oldest),
    'checkedAt', now());
END $$;

-- The doctor as one row, for the guardian's REST read (the service key; never the browser).
CREATE OR REPLACE VIEW public.cockpit_kickoff_items_doctor_v WITH (security_invoker = true) AS
  SELECT public.cockpit_kickoff_items_doctor() AS report;
REVOKE ALL ON public.cockpit_kickoff_items_doctor_v FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cockpit_kickoff_items_doctor_v TO service_role;

-- ---------------------------------------------------------------------------
-- 7. Function privileges: revoked from all four roles, then the browser RPCs to authenticated and the doctor to
--    the service role. Everything else is the owner's only.

REVOKE ALL ON FUNCTION public.cockpit_kickoff_item_catalog(), public.cockpit_kickoff_item_answers_keep(),
  public.cockpit_kickoff_items_on(), public.cockpit_kickoff_items_switch(text[], text),
  public.cockpit_kickoff_request_items(jsonb), public.cockpit_kickoff_item_details(text, text, date),
  public.cockpit_kickoff_item_one_tap(public.cockpit_request_types), public.cockpit_kickoff_items_csm_email(text),
  public.cockpit_kickoff_items_kickoff(text), public.cockpit_kickoff_items_state(text, jsonb, boolean),
  public.cockpit_kickoff_items_seat(text), public.cockpit_kickoff_items_row(jsonb, text), public.cockpit_kickoff_items_known(text),
  public.cockpit_kickoff_items_read(text), public.cockpit_kickoff_item_raise(text, text, uuid),
  public.cockpit_kickoff_item_link(text, text, uuid), public.cockpit_kickoff_item_decline(text, text, text),
  public.cockpit_kickoff_items_cards(), public.cockpit_kickoff_items_due(), public.cockpit_kickoff_items_doctor()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_kickoff_items_read(text), public.cockpit_kickoff_item_raise(text, text, uuid),
  public.cockpit_kickoff_item_link(text, text, uuid), public.cockpit_kickoff_item_decline(text, text, text),
  public.cockpit_kickoff_items_due() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_kickoff_items_doctor() TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
