-- Stage 4: Make is the floor, better data on top (the CEO, 2026-11-02: "You can even improve what's already
-- there with the data that you have. So you can add more if it gives us better data."). Creative Triage
-- (bldgtotkfmhoxmlzowdx). Applies twice; stands on 20261102o. First drafted as 20261102n, on 20261102m:
-- the goals sheet's 20261102m and 20261102n reached live first (2026-11-02), so under the letter rule
-- this file and the one it stands on took the next free letters, p and o. Comments inside the function
-- bodies still say 20261102n, so their md5s stay as stated.
--
-- Make's own output stays exactly as 20261102o plans it: the handoff comment (on the card and as each
-- onboarding task's comment_text), the raw answers comment, the Client Profile and Kickoff Form Link, the
-- nine dropdowns and the Blueprint link, both map moves and the dispatch's two keys. Every addition goes
-- into a slot Make leaves empty (a task description), an effect of its own (card_facts) or a cockpit-only
-- surface (the kickoff's Slack notice). stage4-better-data-supabase.test.ts compares every other part of
-- the plan with 20261102o's builder on the same answers.
--
-- 1. The onboarding tasks' brief (B1). The kickoff's onboarding_tasks plan carries details (the brief,
--    detailsKind 'brief'), which cockpit_request_create_system already hands to the request's
--    description, under the request writer's heading; the handoff stays the comment on each task. The
--    brief (cockpit_form_stage4_task_brief) starts with "From the onboarding and kickoff forms (cockpit)"
--    and reads only the database at plan time: the card's stored onboarding answer and links
--    (cockpit_client_onboarding), the kickoff's own answers, and the card's onboarding Fathom call
--    (cockpit_csm_calls: kind onboarding, source fathom, in the 3 days up to the kickoff, on the card by
--    an exact sign or a person: A7.14's rule 2, cockpit_form_stage4_onboarding_call). Each value is
--    cut at 400 characters ("…"; the services at 500). A missing answer leaves its line out and is named
--    on the closing "Not in the forms: ..." line; a missing card link reads "not on the card yet". No
--    full name, personal phone or email is read: the front desk phone is the only phone.
-- 2. The Brand DNA task's brief (B2). The onboarding's brand_dna_task plan carries details (detailsKind
--    'dna_brief', cockpit_form_stage4_dna_brief): "For the Brand DNA doc (cockpit)", the card's links, the
--    three social links with a check on each, and the creative facts of the answer.
-- 3. Each brief is 3,600 characters at most. Over that, lines become short pointers in a fixed order
--    (the brief functions' comments name it; the first three are the plan's: the services, then the
--    consultants, then the hours), and past every pointer the brief is its heading, the read line and
--    the cockpit client page. A request type with no details field would drop the brief silently
--    (cockpit_request_create_system keeps details only for a field keyed details), so the plan then
--    says so: its lines carry the sentence and the plan holds it as detailsMissing. The tasks are made
--    either way, as Make makes them.
-- 4. The kickoff notice's open items (B4). cockpit_slack_notice_kickoff_facts (20261025n's, live) adds
--    openItems: the kickoff's open setup items as fixed labels (cockpit_form_stage4_open_items), never
--    typed text. An empty list means every answered setup question is done; no key means none of them
--    was answered (no stored kickoff answers, or none of these questions), and the notice prints no
--    line. Everything else in the facts is 20261025n's.
-- 5. card_facts (B8): a new effect for both forms, after card_fields (kickoff) and profile_fields
--    (onboarding), delivered through the forms queue. Its plan lists only Consultation Types
--    (45fdd2ea, labels), ADs Platform (2de15aa5, drop_down), Fathom (abaa31ee, url) and Onboarding Call
--    Date (ee9bf855, date, a Kuwait day) from the kickoff, and Company Website (5d57fdde, url) from the
--    onboarding, each onlyIfEmpty with its source. Option ids are the s40 snapshot's; an answer with an
--    option the card does not have plans nothing for that field. The writer reads the card fresh and
--    writes a field only while it is empty. Never Country, Daily Budget or any other field.
-- 6. The effects arrays (cockpit_form_stage4_effects): both version-2 arrays gain card_facts; version 1
--    is unchanged. A registry row that holds 20261102l's version-2 array (after a go-live) takes the new
--    one, with one audit row; a row on version 1 is left as it is (the go-live writes the new array).
--
-- Nothing here posts, writes a card, sends a message or reaches a sheet.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. What this file stands on (20261102o's builder), then the drift guard: each replaced body is
--    20261102o's builder, 20261102l's effects arrays (live after 20261102l), 20261025n's kickoff facts
--    (live, read 2026-11-02), or this file's own (a second apply).

DO $$
BEGIN
  IF to_regprocedure('public.cockpit_form_stage4_build(jsonb)') IS NULL
     OR to_regprocedure('public.cockpit_form_stage4_handoff_text(jsonb,jsonb)') IS NULL
     OR to_regprocedure('public.cockpit_form_stage4_ts(text)') IS NULL
     OR (SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) FROM pg_catalog.pg_proc p
          WHERE p.oid = to_regprocedure('public.cockpit_form_stage4_build(jsonb)'))
        NOT IN ('a565db2d881852ff3a1481a438768e20', '5f52c05d01472cc80a9706f0d726a190') THEN
    RAISE EXCEPTION 'Apply 20261102o before 20261102p.' USING ERRCODE = '55000';
  END IF;
END $$;

DO $$
DECLARE g record; v_now text;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('public.cockpit_form_stage4_build(jsonb)', 'a565db2d881852ff3a1481a438768e20', '5f52c05d01472cc80a9706f0d726a190'),
      ('public.cockpit_form_stage4_effects(text,integer)', '1b01ccc56e88b8fa4f4fc8985d36c93c', 'a9cb7e47d632bb8147b0cf4ad1ce2e44'),
      ('public.cockpit_slack_notice_kickoff_facts(text,text,jsonb,text)', '3ecb0f63f577ec3712789bdad68bded8', '4e47c07ef41f98fc84e258dcb51eb5a2')
    ) AS x(fn, live_md5, after_md5)
  LOOP
    v_now := NULL;
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_now
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(g.fn);
    IF v_now IS NULL OR v_now NOT IN (g.live_md5, g.after_md5) THEN
      RAISE EXCEPTION '% changed since 20261102o; stop and re-read it.', replace(g.fn, 'public.', '')
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Small readers (internal)

-- A value cut at p_max characters, the last one "…"; NULL is NULL.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_cut(p text, p_max integer)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN p IS NULL THEN NULL WHEN char_length(p) <= p_max THEN p ELSE left(p, p_max - 1) || '…' END
$$;

-- What one answer links to: instagram, facebook, social (another social site), link_in_bio,
-- google_maps, google (any other Google host) or site; NULL when it is not one http(s) link.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_link_kind(p text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v text := btrim(coalesce(p, ''), E' \t\n\r\f\x0b'); h text; v_path text;
BEGIN
  IF v !~* '^https?://[^\s/?#]+[^\s]*$' THEN
    RETURN NULL;
  END IF;
  h := regexp_replace(lower(substring(v from '^[A-Za-z]+://([^/?#:\s]+)')), '^www\.', '');
  v_path := coalesce(substring(v from '^[A-Za-z]+://[^/?#\s]+(.*)$'), '');
  RETURN CASE
    WHEN h ~ '(^|\.)instagram\.com$' OR h = 'instagr.am' THEN 'instagram'
    WHEN h ~ '(^|\.)facebook\.com$' OR h IN ('fb.com', 'fb.me') THEN 'facebook'
    WHEN h ~ '(^|\.)(tiktok\.com|x\.com|twitter\.com|snapchat\.com|linkedin\.com|youtube\.com|whatsapp\.com)$'
         OR h IN ('youtu.be', 'wa.me') THEN 'social'
    WHEN h IN ('linktr.ee', 'linkin.bio', 'beacons.ai', 'bio.link', 'taplink.cc', 'solo.to', 'lnk.bio') THEN 'link_in_bio'
    WHEN h IN ('maps.app.goo.gl', 'goo.gl', 'g.page', 'g.co') OR h ~ '^maps\.google\.'
         OR (h ~ '(^|\.)google\.[a-z.]+$' AND v_path ~ '^/maps') THEN 'google_maps'
    WHEN h ~ '(^|\.)google\.[a-z.]+$' THEN 'google'
    ELSE 'site' END;
END $$;

-- The kickoff's open setup items (B4), each a fixed label: the yes/no questions by their meaning, a
-- choice by the form's own option label (cockpit_form_stage4_fields), never typed text. An answer
-- that is not one of the question's options counts as unanswered. NULL when none of these questions is
-- answered; an empty list when every answered one is done.
--   funded card (8bee68fc) done on Yes; Google Calendar (3bebf47d) done on Yes; Facebook access
--   (6fcbd33c) done on Access Confirmed, Using Ours or Their Page Our Ad Acc; WhatsApp CRM sync
--   (a813378f) on Integrated or Not Integrating; Mahara OS access (ad562fc2) on Logged In or Doesn't Want
--   To; training course (c56a7e2d) on Confirmed; contract (c0000001-...-000a) on Signed or NA - already
--   signed; the lead file is missing when pre-existing leads (dff79b66) and reaching them (85d7ebb5) are
--   both Yes and the lead file answer (86a6cce0) is empty.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_open_items(p_by_ref jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a jsonb := CASE WHEN jsonb_typeof(p_by_ref) = 'object' THEN p_by_ref ELSE '{}'::jsonb END;
  v_fields jsonb := public.cockpit_form_stage4_fields('kickoff');
  v_items text[] := '{}';
  v_answered integer := 0;
  c record;
  v text;
  v_has text;
  v_reach text;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      (1, '8bee68fc-0764-41a8-b90a-db2a3f401e9d', NULL::text[], 'funded card not linked'),
      (2, '3bebf47d-c00b-4f26-8624-933b84e42ebc', NULL::text[], 'Google Calendar not connected'),
      (3, '6fcbd33c-60e9-4df7-bfaa-e76b588dd887', ARRAY['Access Confirmed', 'Using Ours', 'Their Page Our Ad Acc'], 'Facebook access: '),
      (4, 'a813378f-06ce-499e-8f0e-14761b89b474', ARRAY['Integrated', 'Not Integrating'], 'WhatsApp CRM sync: '),
      (5, 'ad562fc2-6858-4e37-81c5-c4cc2375a330', ARRAY['Logged In', 'Doesn''t Want To'], 'Mahara OS access: '),
      (6, 'c56a7e2d-6f18-4bf9-a9f6-11367eab4c11', ARRAY['Confirmed'], 'training course: '),
      (7, 'c0000001-0000-4000-8000-00000000000a', ARRAY['Signed', 'NA - already signed'], 'contract: ')
    ) AS x(n, ref, done, line) ORDER BY n
  LOOP
    v := btrim(coalesce(a->>c.ref, ''), E' \t\n\r\f\x0b');
    IF c.done IS NULL THEN
      -- A yes/no question: Yes (or true) is done, No (or false) is open, anything else unanswered.
      IF lower(v) IN ('yes', 'true') THEN
        v_answered := v_answered + 1;
      ELSIF lower(v) IN ('no', 'false') THEN
        v_answered := v_answered + 1;
        v_items := v_items || c.line;
      END IF;
    ELSIF EXISTS (SELECT 1 FROM jsonb_array_elements(v_fields) f WHERE f->>'typeformRef' = c.ref AND (f->'options') ? v) THEN
      v_answered := v_answered + 1;
      IF NOT (v = ANY(c.done)) THEN
        v_items := v_items || (c.line || v);
      END IF;
    END IF;
  END LOOP;
  v_has := lower(btrim(coalesce(a->>'dff79b66-89dd-43ef-9664-3fa4e6a61d69', ''), E' \t\n\r\f\x0b'));
  v_reach := lower(btrim(coalesce(a->>'85d7ebb5-ce36-4ac3-aff8-3ce464737abd', ''), E' \t\n\r\f\x0b'));
  IF v_has IN ('yes', 'true', 'no', 'false') OR v_reach IN ('yes', 'true', 'no', 'false') THEN
    v_answered := v_answered + 1;
    IF v_has IN ('yes', 'true') AND v_reach IN ('yes', 'true')
       AND btrim(coalesce(a->>'86a6cce0-9111-4d98-97e7-7af5b6d518c8', ''), E' \t\n\r\f\x0b') = '' THEN
      v_items := v_items || 'lead file missing'::text;
    END IF;
  END IF;
  RETURN CASE WHEN v_answered = 0 THEN NULL ELSE to_jsonb(v_items) END;
END $$;

-- The card's onboarding Fathom call for a kickoff at p_at: the newest stored call of kind onboarding
-- from Fathom on this card that started in the 3 days up to p_at and was not cancelled, missed or
-- gone. {id, startsAt, recordingUrl (https only, else null)}, or NULL.
-- Only a row an exact sign or a person placed on this card counts: A7.14's rule 2, word for word
-- (cockpit_form_recording_tied, 20261027f). A row the Fathom worker placed from a likely sign (a name
-- at 0.6, the company domain as invitee_email at 0.8) settles nothing, so its link and day are
-- another client's as likely as this one's: the brief then names the recording as missing and card_facts
-- plans no Fathom and no call date from it (the date falls back to the kickoff's day, as with no call).
-- The tie rule's other ways in are left out on purpose: a Customer Success recording (rule 1) names no
-- card, there is no seat here (rule 4), and a likely-sign row that an exact sign of rule 3 also ties is
-- left for the CSM to pick in the forms window. Nobody chooses here, and card_facts' writes stay.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_onboarding_call(p_task_id text, p_at timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', c.id, 'startsAt', c.starts_at,
                            'recordingUrl', CASE WHEN c.recording_url ~ '^https://[^\s]+$' THEN c.recording_url END)
    FROM public.cockpit_csm_calls c
   WHERE c.task_id = p_task_id AND c.kind = 'onboarding' AND c.source = 'fathom'
     AND (c.match_method IN ('same_room', 'appointment_time', 'form_task_id', 'manual', 'client_id_field')
          OR (c.match_method = 'invitee_email' AND c.match_confidence >= 0.9))
     AND c.status NOT IN ('cancelled', 'no_show', 'gone')
     AND c.starts_at >= coalesce(p_at, now()) - interval '3 days' AND c.starts_at <= coalesce(p_at, now())
   ORDER BY c.starts_at DESC, c.id DESC
   LIMIT 1
$$;

-- One line of a brief: {g: its group, h: the group's heading, t: the line, d: the drop rank, p: the
-- pointer it becomes once dropped}; NULL when the value is missing.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_brief_line(p_g integer, p_h text, p_text text, p_drop integer, p_pointer text)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN p_text IS NOT NULL THEN jsonb_build_object('g', p_g, 'h', p_h, 't', p_text, 'd', p_drop, 'p', p_pointer) END
$$;

-- A brief's text at one drop level: its groups in order, each its heading (when it has one) and its
-- lines, a blank line between groups. A line whose drop rank is at or under the level shows its pointer,
-- or nothing when it has none; a group with no line left is left out.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_brief_join(p_parts jsonb, p_level integer)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT string_agg(z.block, E'\n\n' ORDER BY z.g)
    FROM (SELECT y.g, concat_ws(E'\n', min(y.h), string_agg(y.line, E'\n' ORDER BY y.n)) AS block
            FROM (SELECT (x->>'g')::integer AS g, x->>'h' AS h, n,
                         CASE WHEN x->>'d' IS NULL OR (x->>'d')::integer > p_level THEN x->>'t' ELSE x->>'p' END AS line
                    FROM jsonb_array_elements(p_parts) WITH ORDINALITY AS u(x, n)) y
           WHERE y.line IS NOT NULL
           GROUP BY y.g) z
$$;

-- What the link check says of the three social answers (B1, B2): website a social, link-in-bio or
-- Google Maps link; instagram not an Instagram link; facebook an Instagram link, or not a Facebook link.
-- {website, instagram, facebook}: true, or 'instagram' / 'other' for the Facebook answer; null otherwise
-- (no answer, or nothing to check).
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_link_flags(p_by_ref jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'website', CASE WHEN w IS NOT NULL AND public.cockpit_form_stage4_link_kind(w) IN ('instagram', 'facebook', 'social', 'link_in_bio', 'google_maps') THEN true END,
    'instagram', CASE WHEN i IS NOT NULL AND public.cockpit_form_stage4_link_kind(i) IS DISTINCT FROM 'instagram' THEN true END,
    'facebook', CASE WHEN f IS NULL THEN NULL
                     WHEN public.cockpit_form_stage4_link_kind(f) = 'instagram' THEN 'instagram'
                     WHEN public.cockpit_form_stage4_link_kind(f) IS DISTINCT FROM 'facebook' THEN 'other' END)
    FROM (SELECT nullif(btrim(coalesce(p_by_ref->>'454a425f-2ac6-4d94-92db-cec08618600e', ''), E' \t\n\r\f\x0b'), '') AS w,
                 nullif(btrim(coalesce(p_by_ref->>'adecfe45-5d55-4319-98ff-3761e04bfc9b', ''), E' \t\n\r\f\x0b'), '') AS i,
                 nullif(btrim(coalesce(p_by_ref->>'575d17ed-e26d-4e55-87d3-7cb31cb71939', ''), E' \t\n\r\f\x0b'), '') AS f) x
$$;

-- The sentence a plan carries when its request type would drop the brief (3 above): the type is set up
-- and has no field keyed details, so cockpit_request_create_system keeps no details. NULL otherwise
-- (no type yet: cockpit_request_create_system makes no task and says so).
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_details_note(p_type_key text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT format('The brief stays out of the task description: the %s request type has no details field. Add one (key details, kind details) to carry it.', p_type_key)
    FROM public.cockpit_request_types t
   WHERE t.key = p_type_key
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(t.fields) = 'array' THEN t.fields ELSE '[]'::jsonb END) f
                      WHERE f->>'key' = 'details')
$$;

-- ---------------------------------------------------------------------------
-- 2. The onboarding tasks' brief (1 and 3 above)

-- p_kickoff_by_ref: the kickoff's answers by ref, as the builder reads them; p_at: when it was sent.
-- Drop order past 3,600 characters (each a pointer from then on): 1 Services and prices, 2 Consultants,
-- 3 Hours (both also in the handoff comment), 4 Service areas, 5 Payment options, 6 Landmark,
-- 7 Appointment length and buffer, 8 Furthest they travel, 9 #1 service, 10 Booking software, 11 Meta
-- Business Manager, 12 Free consultations, 13 Years in business, 14 Projects completed, 15 Front desk
-- phone, 16 Appointment types, 17 Services advertised, 18 Call recording; then the short brief.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_task_brief(p_task_id text, p_kickoff_by_ref jsonb, p_at timestamptz)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  k jsonb := CASE WHEN jsonb_typeof(p_kickoff_by_ref) = 'object' THEN p_kickoff_by_ref ELSE '{}'::jsonb END;
  b jsonb := '{}'::jsonb;
  v_links jsonb;
  v_has boolean := false;
  v_page text := 'https://cockpit.maharamedia.com/client-success/clients/' || p_task_id;
  v_day text := to_char((now() AT TIME ZONE 'Asia/Kuwait')::date, 'YYYY-MM-DD');
  v_raw CONSTANT text := 'in the Raw Onboarding Form Answers comment on the client card';
  v_hand CONSTANT text := 'in the handoff comment on this task';
  v_tech CONSTANT text := 'For the tech setup (Calendars, Call Center, Custom Values)';
  v_parts jsonb := '[]'::jsonb;
  v_missing text[] := '{}';
  v_line jsonb;
  v_items jsonb;
  v_flags jsonb;
  v_checks text[] := '{}';
  v_call jsonb;
  v text;
  v_types text;
  v_types_kickoff boolean;
  v_onsite boolean;
  v_unsure text[];
  c record;
  v_out text;
  v_level integer;
BEGIN
  SELECT CASE WHEN jsonb_typeof(o.links) = 'object' THEN o.links ELSE '{}'::jsonb END,
         CASE WHEN jsonb_typeof(o.forms->'onboarding'->'answers') = 'array' THEN o.forms->'onboarding'->'answers' END
    INTO v_links, v_items
    FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_task_id;
  v_links := coalesce(v_links, '{}'::jsonb);
  -- The card's stored onboarding answer by ref: the last answer of a question answered twice.
  IF v_items IS NOT NULL THEN
    SELECT coalesce(jsonb_object_agg(x.ref, x.value), '{}'::jsonb) INTO b
      FROM (SELECT DISTINCT ON (a->>'ref') a->>'ref' AS ref, btrim(a->>'value', E' \t\n\r\f\x0b') AS value
              FROM jsonb_array_elements(v_items) WITH ORDINALITY AS u(a, n)
             WHERE coalesce(a->>'ref', '') <> '' AND btrim(coalesce(a->>'value', ''), E' \t\n\r\f\x0b') <> ''
             ORDER BY a->>'ref', n DESC) x;
    v_has := b <> '{}'::jsonb;
  END IF;

  -- The heading and the read line.
  v_parts := v_parts || jsonb_build_array(
    public.cockpit_form_stage4_brief_line(1, NULL, 'From the onboarding and kickoff forms (cockpit)', NULL, NULL),
    public.cockpit_form_stage4_brief_line(1, NULL, 'Read from the cockpit on ' || v_day || ' (Kuwait). Answers are as typed. '
      || CASE WHEN v_has THEN 'The whole onboarding answer is in the Raw Onboarding Form Answers comment on the client card.'
              ELSE 'No onboarding answer is stored for this client yet, so only the card''s links and the kickoff''s answers follow.' END,
      NULL, NULL));

  -- Links: the card's own, the cockpit's, and the call recording (the kickoff's answer, else the call store).
  v_parts := v_parts || jsonb_build_array(
    public.cockpit_form_stage4_brief_line(2, 'Links', '- Cockpit client page: ' || v_page, NULL, NULL));
  FOR c IN
    SELECT * FROM (VALUES
      (1, 'drive', 'Drive folder (from the card)', 'not on the card yet'),
      (2, 'ghl', 'GHL', 'not on the card yet'),
      (3, 'brand_dna', 'Brand DNA doc', 'not on the card yet'),
      (4, 'offer_sheet', 'Offer Cheat Sheet', 'not on the card yet'),
      (5, 'market_research', 'Market Research doc', 'not ready yet; the market intel job adds it to the card')
    ) AS x(n, key, label, none) ORDER BY n
  LOOP
    v := CASE WHEN jsonb_typeof(v_links->c.key) = 'string' AND v_links->>c.key ~ '^https://[^\s]+$' THEN v_links->>c.key END;
    v_parts := v_parts || jsonb_build_array(
      public.cockpit_form_stage4_brief_line(2, 'Links', '- ' || c.label || ': ' || coalesce(v, c.none), NULL, NULL));
  END LOOP;
  v := nullif(btrim(coalesce(k->>'b5578678-d0c2-475b-b66f-7ea54d55fe31', ''), E' \t\n\r\f\x0b'), '');
  IF v IS NULL THEN
    v_call := public.cockpit_form_stage4_onboarding_call(p_task_id, p_at);
    v := v_call->>'recordingUrl' || ' (from the call store)';
  ELSE
    v := public.cockpit_form_stage4_cut(v, 400);
  END IF;
  v_line := public.cockpit_form_stage4_brief_line(2, 'Links', '- Call recording: ' || v, 18, '- Call recording: ' || v_hand);
  IF v_line IS NULL THEN v_missing := v_missing || 'Call recording'::text; ELSE v_parts := v_parts || v_line; END IF;

  -- Still open from the kickoff (B4's items, the Slack notice's).
  v_items := public.cockpit_form_stage4_open_items(k);
  IF v_items IS NULL THEN
    v_parts := v_parts || jsonb_build_array(public.cockpit_form_stage4_brief_line(3, 'Still open from the kickoff',
      '- The kickoff left its setup questions unanswered.', NULL, NULL));
  ELSIF jsonb_array_length(v_items) = 0 THEN
    v_parts := v_parts || jsonb_build_array(public.cockpit_form_stage4_brief_line(3, 'Still open from the kickoff',
      '- Nothing open from the kickoff''s setup questions.', NULL, NULL));
  ELSE
    SELECT v_parts || coalesce(jsonb_agg(public.cockpit_form_stage4_brief_line(3, 'Still open from the kickoff',
             '- ' || upper(left(x #>> '{}', 1)) || substr(x #>> '{}', 2), NULL, NULL) ORDER BY n), '[]'::jsonb)
      INTO v_parts FROM jsonb_array_elements(v_items) WITH ORDINALITY AS u(x, n);
  END IF;

  -- For the tech setup. The appointment types confirmed at kickoff, else the onboarding's.
  v_types := nullif(btrim(coalesce(k->>'c0000001-0000-4000-8000-000000000008', ''), E' \t\n\r\f\x0b'), '');
  v_types_kickoff := v_types IS NOT NULL;
  IF v_types_kickoff THEN
    v_onsite := v_types ~ 'In-home or onsite';
    v_line := public.cockpit_form_stage4_brief_line(4, v_tech,
      '- Appointment types (confirmed at kickoff): ' || public.cockpit_form_stage4_cut(v_types, 400), 16, '- Appointment types: ' || v_hand);
  ELSE
    v_types := b->>'b370341c-6ea3-43c9-bd8c-16e278a2d2d5';
    v_onsite := coalesce(v_types ~ 'Onsite / In-home', false);
    v_line := public.cockpit_form_stage4_brief_line(4, v_tech,
      '- Appointment types: ' || public.cockpit_form_stage4_cut(v_types, 400) || ' (from the onboarding)', 16, '- Appointment types: ' || v_raw);
  END IF;
  IF v_line IS NULL THEN v_missing := v_missing || 'Appointment types'::text; ELSE v_parts := v_parts || v_line; END IF;
  -- Meta Business Manager's two answers that need the access link (KFRCXPFx's unsure and ran_before).
  SELECT array_agg(split_part(o->>'typeform', ' |', 1)) INTO v_unsure
    FROM jsonb_array_elements(public.cockpit_form_stage4_fields('onboarding')) f, jsonb_array_elements(f->'options') o
   WHERE f->>'key' = 'facebookAds' AND o->>'value' IN ('unsure', 'ran_before');
  IF v_has THEN
    FOR c IN
      SELECT * FROM (VALUES
        (1, 'Appointment length and buffer', 'a20cfc1a-0228-413d-80ab-d97fc97574e0', 7, 'raw'),
        (2, 'Hours', 'b7873d40-d154-42ac-bf24-cb3b667e84cc', 3, 'hand'),
        (3, 'Consultants', '0a80a0a8-3a09-4907-a1d1-6c57e57d4c47', 2, 'hand'),
        (4, 'Furthest they travel', '35ea63c3-090a-425d-b75c-e3d183d48cd1', 8, 'raw'),
        (5, 'Landmark', 'b7c403ea-8d66-4814-80cf-7e8d7fdb8d11', 6, 'raw'),
        (6, 'Free consultations', 'ec89854f-d006-402b-958a-91738e2b3e7a', 12, 'raw'),
        (7, 'Front desk phone', '282dac48-5031-4acb-96b6-ea469e8a5a8b', 15, 'raw'),
        (8, 'Payment options', 'ee25f923-d5e1-4d1a-a95f-cd9c17abbe83', 5, 'raw'),
        (9, 'Meta Business Manager', 'ddf2767d-5725-4df2-b200-f0aab77a2db5', 11, 'raw'),
        (10, 'Booking software', '7a120dbb-0169-4bcc-9193-5c525a470d02', 10, 'raw'),
        (11, 'Service areas', 'fa017616-3fb5-4e64-9fbd-39cea6e26c47', 4, 'raw'),
        (12, 'Services and prices', 'd976036f-6c2e-4d5d-999a-64cf9bb2ef02', 1, 'raw')
      ) AS x(n, label, ref, drop_rank, ptr) ORDER BY n
    LOOP
      -- The furthest they travel only when the appointment types include an onsite or in-home one.
      CONTINUE WHEN c.n = 4 AND NOT v_onsite;
      v := b->>c.ref;
      IF v IS NULL THEN
        v_missing := v_missing || c.label;
        CONTINUE;
      END IF;
      v := CASE c.n
        WHEN 12 THEN public.cockpit_form_stage4_cut(v, 500)
                     || CASE WHEN char_length(v) > 500 THEN ' (whole answer: raw answers comment on the card)' ELSE '' END
        WHEN 9 THEN public.cockpit_form_stage4_cut(v, 400)
                     || CASE WHEN split_part(v, ' |', 1) = ANY(coalesce(v_unsure, '{}')) THEN ' (needs the access link)' ELSE '' END
        WHEN 10 THEN public.cockpit_form_stage4_cut(v, 400)
                     || CASE WHEN lower(v) ~ '^\s*(n/?a|none|no|nothing|nil|null|not yet|-+|\.+)\s*[.!]?\s*$'
                               OR lower(v) ~ '^\s*(no |none|nothing|not yet|we don''?t|we do not|don''?t|do not)'
                               OR v ~ '^\s*(لا يوجد|لايوجد|ما عندنا|ماعندنا|لا نستخدم|ما في|مافي|لا شيء|لاشيء|ولا شي|لا$)'
                             THEN ' (no system to connect)' ELSE '' END
        ELSE public.cockpit_form_stage4_cut(v, 400) END;
      v_parts := v_parts || public.cockpit_form_stage4_brief_line(4, v_tech, '- ' || c.label || ': ' || v, c.drop_rank,
        '- ' || c.label || ': ' || CASE c.ptr WHEN 'hand' THEN v_hand ELSE v_raw END);
    END LOOP;
  END IF;

  -- For creative: the services ticked at kickoff (the card keeps only the first), then the onboarding's.
  v := nullif(btrim(coalesce(k->>'c0000001-0000-4000-8000-000000000007', ''), E' \t\n\r\f\x0b'), '');
  v_line := public.cockpit_form_stage4_brief_line(5, 'For creative',
    '- Services advertised (ticked at kickoff, in order; the card shows only the first): ' || public.cockpit_form_stage4_cut(v, 400),
    17, '- Services advertised: ' || v_hand);
  IF v_line IS NULL THEN v_missing := v_missing || 'Services advertised'::text; ELSE v_parts := v_parts || v_line; END IF;
  IF v_has THEN
    FOR c IN
      SELECT * FROM (VALUES
        (1, '#1 service', '6271b610-6946-4056-bb08-d03ffc274141', 9),
        (2, 'Years in business', 'ed1ba2fe-2827-4eea-a678-62205f1ce9f5', 13),
        (3, 'Projects completed', '0a6b5704-c46d-480c-a592-b59108683596', 14)
      ) AS x(n, label, ref, drop_rank) ORDER BY n
    LOOP
      v := b->>c.ref;
      IF v IS NULL THEN
        v_missing := v_missing || c.label;
      ELSE
        v_parts := v_parts || public.cockpit_form_stage4_brief_line(5, 'For creative',
          '- ' || c.label || ': ' || public.cockpit_form_stage4_cut(v, 400), c.drop_rank, '- ' || c.label || ': ' || v_raw);
      END IF;
    END LOOP;
    v_flags := public.cockpit_form_stage4_link_flags(b);
    IF v_flags->>'facebook' = 'instagram' THEN v_checks := v_checks || 'The Facebook answer is an Instagram link.'::text;
    ELSIF v_flags->>'facebook' = 'other' THEN v_checks := v_checks || 'The Facebook answer is not a Facebook link.'::text; END IF;
    IF (v_flags->>'instagram')::boolean THEN v_checks := v_checks || 'The Instagram answer is not an Instagram link.'::text; END IF;
    IF (v_flags->>'website')::boolean THEN v_checks := v_checks || 'The website answer is a social link.'::text; END IF;
    IF cardinality(v_checks) > 0 THEN
      v_parts := v_parts || public.cockpit_form_stage4_brief_line(5, 'For creative',
        '- Link check: ' || array_to_string(v_checks, ' '), NULL, NULL);
    END IF;
  END IF;

  IF cardinality(v_missing) > 0 THEN
    v_parts := v_parts || public.cockpit_form_stage4_brief_line(6, NULL,
      'Not in the forms: ' || array_to_string(v_missing, ', ') || '.', NULL, NULL);
  END IF;

  -- At most 3,600 characters: the drop order above, then the short brief.
  FOR v_level IN 0..18 LOOP
    v_out := public.cockpit_form_stage4_brief_join(v_parts, v_level);
    IF char_length(v_out) <= 3600 THEN
      RETURN v_out;
    END IF;
  END LOOP;
  RETURN 'From the onboarding and kickoff forms (cockpit)' || E'\n'
    || 'Read from the cockpit on ' || v_day || ' (Kuwait). This brief is too long for a task description: read the handoff comment '
    || 'on this task and the Raw Onboarding Form Answers comment on the client card.' || E'\n\n'
    || 'Links' || E'\n' || '- Cockpit client page: ' || v_page;
END $$;

-- ---------------------------------------------------------------------------
-- 3. The Brand DNA task's brief (2 and 3 above)

-- p_by_ref: the onboarding answer's own answers by ref; p_card_name: the card's name when the client
-- record has none. Drop order past 3,600 characters (each a pointer from then on): 1 Service areas,
-- 2 Payment options, 3 Ideal project, 4 Why they joined, 5 Free consultations, 6 Appointment types,
-- 7 Years in business, 8 Projects completed, 9 #1 service, 10 Website, 11 Instagram, 12 Facebook, 13 the
-- typed business name; then the short brief.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_dna_brief(p_task_id text, p_by_ref jsonb, p_card_name text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a jsonb := '{}'::jsonb;
  v_links jsonb;
  v_card text;
  v_page text := 'https://cockpit.maharamedia.com/client-success/clients/' || p_task_id;
  v_day text := to_char((now() AT TIME ZONE 'Asia/Kuwait')::date, 'YYYY-MM-DD');
  v_raw CONSTANT text := 'in the Raw Onboarding Form Answers comment on the client card';
  v_parts jsonb := '[]'::jsonb;
  v_missing text[] := '{}';
  v_flags jsonb;
  v text;
  v_typed text;
  v_n1 text;
  v_n2 text;
  c record;
  v_out text;
  v_level integer;
BEGIN
  SELECT coalesce(jsonb_object_agg(e.key, btrim(e.value #>> '{}', E' \t\n\r\f\x0b')), '{}'::jsonb) INTO a
    FROM jsonb_each(CASE WHEN jsonb_typeof(p_by_ref) = 'object' THEN p_by_ref ELSE '{}'::jsonb END) e
   WHERE jsonb_typeof(e.value) = 'string' AND btrim(e.value #>> '{}', E' \t\n\r\f\x0b') <> '';
  SELECT CASE WHEN jsonb_typeof(o.links) = 'object' THEN o.links END, nullif(btrim(o.client_name), '')
    INTO v_links, v_card
    FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_task_id;
  v_links := coalesce(v_links, '{}'::jsonb);
  v_card := coalesce(v_card, nullif(btrim(p_card_name), ''));

  v_parts := v_parts || public.cockpit_form_stage4_brief_line(1, NULL, 'For the Brand DNA doc (cockpit)', NULL, NULL);
  -- The business name as typed, only when it is not the card's name (both folded to lower-case letters and
  -- digits, neither containing the other).
  v_typed := a->>'514bfd3f-4ca1-469e-b9e7-87656503f65c';
  v_n1 := regexp_replace(lower(coalesce(v_typed, '')), '[\s[:punct:]،؛؟ـ]+', '', 'g');
  v_n2 := regexp_replace(lower(coalesce(v_card, '')), '[\s[:punct:]،؛؟ـ]+', '', 'g');
  IF v_n1 <> '' AND v_n2 <> '' AND strpos(v_n1, v_n2) = 0 AND strpos(v_n2, v_n1) = 0 THEN
    v_parts := v_parts || public.cockpit_form_stage4_brief_line(1, NULL,
      'Typed in the onboarding form as: ' || public.cockpit_form_stage4_cut(v_typed, 400), 13, NULL);
  END IF;
  v_parts := v_parts || public.cockpit_form_stage4_brief_line(1, NULL, 'Read from the cockpit on ' || v_day
    || ' (Kuwait). The whole onboarding answer is in the Raw Onboarding Form Answers comment on the client card.', NULL, NULL);

  -- Links: the card's, the cockpit's, then the three social answers with their check.
  FOR c IN
    SELECT * FROM (VALUES
      (1, 'brand_dna', 'Brand DNA doc', 'not on the card yet'),
      (2, 'offer_sheet', 'Offer Cheat Sheet', 'not on the card yet'),
      (3, 'drive', 'Drive folder (from the card)', 'not on the card yet')
    ) AS x(n, key, label, none) ORDER BY n
  LOOP
    v := CASE WHEN jsonb_typeof(v_links->c.key) = 'string' AND v_links->>c.key ~ '^https://[^\s]+$' THEN v_links->>c.key END;
    v_parts := v_parts || public.cockpit_form_stage4_brief_line(2, 'Links', '- ' || c.label || ': ' || coalesce(v, c.none), NULL, NULL);
  END LOOP;
  v := CASE WHEN jsonb_typeof(v_links->'market_research') = 'string' AND v_links->>'market_research' ~ '^https://[^\s]+$'
            THEN v_links->>'market_research' END;
  v_parts := v_parts || jsonb_build_array(
    public.cockpit_form_stage4_brief_line(2, 'Links', '- Blueprint prep: ' || v_page || '/present/blueprint?view=prep', NULL, NULL),
    public.cockpit_form_stage4_brief_line(2, 'Links', '- Cockpit client page: ' || v_page, NULL, NULL),
    public.cockpit_form_stage4_brief_line(2, 'Links', '- Market Research doc: '
      || coalesce(v, 'lands on the card''s Market Research field when the market intel job finishes'), NULL, NULL));
  v_flags := public.cockpit_form_stage4_link_flags(a);
  FOR c IN
    SELECT * FROM (VALUES
      (1, 'Website', '454a425f-2ac6-4d94-92db-cec08618600e', 10),
      (2, 'Instagram', 'adecfe45-5d55-4319-98ff-3761e04bfc9b', 11),
      (3, 'Facebook', '575d17ed-e26d-4e55-87d3-7cb31cb71939', 12)
    ) AS x(n, label, ref, drop_rank) ORDER BY n
  LOOP
    v := a->>c.ref;
    IF v IS NULL THEN
      v_missing := v_missing || c.label;
      CONTINUE;
    END IF;
    v := public.cockpit_form_stage4_cut(v, 400) || CASE
      WHEN c.n = 1 AND (v_flags->>'website')::boolean THEN ' (this looks like a social link)'
      WHEN c.n = 2 AND (v_flags->>'instagram')::boolean THEN ' (this is not an Instagram link)'
      WHEN c.n = 3 AND v_flags->>'facebook' = 'instagram' THEN ' (this is an Instagram link, not a Facebook page)'
      WHEN c.n = 3 AND v_flags->>'facebook' = 'other' THEN ' (this is not a Facebook link)'
      ELSE '' END;
    v_parts := v_parts || public.cockpit_form_stage4_brief_line(2, 'Links', '- ' || c.label || ': ' || v, c.drop_rank,
      '- ' || c.label || ': ' || v_raw);
  END LOOP;

  -- The creative facts, in the Brand DNA doc's sections.
  FOR c IN
    SELECT * FROM (VALUES
      (1, 3, 'Business Overview', 'Years in business', 'ed1ba2fe-2827-4eea-a678-62205f1ce9f5', 400, 7),
      (2, 3, 'Business Overview', 'Projects completed', '0a6b5704-c46d-480c-a592-b59108683596', 400, 8),
      (3, 3, 'Business Overview', 'Service areas', 'fa017616-3fb5-4e64-9fbd-39cea6e26c47', 400, 1),
      (4, 4, 'Business Model', 'Appointment types', 'b370341c-6ea3-43c9-bd8c-16e278a2d2d5', 400, 6),
      (5, 4, 'Business Model', 'Free consultations', 'ec89854f-d006-402b-958a-91738e2b3e7a', 400, 5),
      (6, 4, 'Business Model', 'Payment options', 'ee25f923-d5e1-4d1a-a95f-cd9c17abbe83', 400, 2),
      (7, 5, 'Market Positioning', '#1 service', '6271b610-6946-4056-bb08-d03ffc274141', 400, 9),
      (8, 6, 'Target Audience', 'Ideal project', '6c819933-3eb9-4db8-bd59-d39be11cb7f0', 600, 3),
      (9, 7, 'Why they joined', 'Why they joined', '7426c6c5-344f-44c9-9999-3b9daf3a06b8', 600, 4)
    ) AS x(n, g, h, label, ref, cut_at, drop_rank) ORDER BY n
  LOOP
    v := a->>c.ref;
    IF v IS NULL THEN
      v_missing := v_missing || c.label;
    ELSIF c.n = 9 THEN
      v_parts := v_parts || public.cockpit_form_stage4_brief_line(c.g, c.h, '- ' || public.cockpit_form_stage4_cut(v, c.cut_at),
        c.drop_rank, '- ' || upper(left(v_raw, 1)) || substr(v_raw, 2));
    ELSE
      v_parts := v_parts || public.cockpit_form_stage4_brief_line(c.g, c.h, '- ' || c.label || ': ' || public.cockpit_form_stage4_cut(v, c.cut_at),
        c.drop_rank, '- ' || c.label || ': ' || v_raw);
    END IF;
  END LOOP;

  IF cardinality(v_missing) > 0 THEN
    v_parts := v_parts || public.cockpit_form_stage4_brief_line(8, NULL,
      'Not in the forms: ' || array_to_string(v_missing, ', ') || '.', NULL, NULL);
  END IF;

  FOR v_level IN 0..13 LOOP
    v_out := public.cockpit_form_stage4_brief_join(v_parts, v_level);
    IF char_length(v_out) <= 3600 THEN
      RETURN v_out;
    END IF;
  END LOOP;
  RETURN 'For the Brand DNA doc (cockpit)' || E'\n'
    || 'Read from the cockpit on ' || v_day || ' (Kuwait). This brief is too long for a task description: read the Raw Onboarding '
    || 'Form Answers comment on the client card.' || E'\n\n'
    || 'Links' || E'\n' || '- Cockpit client page: ' || v_page;
END $$;

-- ---------------------------------------------------------------------------
-- 4. card_facts (5 above): the effect, one per form

-- {key card_facts, delivery clickup_queue, plan {taskId, fields, lines}, skip?}. fields: [{fieldId, kind
-- (labels, drop_down, url or date), label, optionIds | optionId | value, onlyIfEmpty true, source}];
-- source is kickoff, call_store, kickoff_day or onboarding. A date is the Kuwait day, YYYY-MM-DD. With no
-- field to plan the effect is skipped with its reason. p_at: when the kickoff was sent (NULL: unknown,
-- so the call date has no fallback).
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_card_facts(p_form_key text, p_task_id text, p_by_ref jsonb, p_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a jsonb := CASE WHEN jsonb_typeof(p_by_ref) = 'object' THEN p_by_ref ELSE '{}'::jsonb END;
  v_fields jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_skip text;
  v text;
  v_ids jsonb;
  v_names text;
  v_known boolean;
  v_count integer;
  v_id text;
  v_call jsonb;
  v_day text;
BEGIN
  IF p_form_key = 'kickoff' THEN
    -- Consultation Types (labels): every ticked type the card has, in the order ticked; any other plans none.
    v := nullif(btrim(coalesce(a->>'c0000001-0000-4000-8000-000000000008', ''), E' \t\n\r\f\x0b'), '');
    IF v IS NOT NULL THEN
      SELECT coalesce(jsonb_agg(m.id ORDER BY t.n), '[]'::jsonb), string_agg(m.name, ', ' ORDER BY t.n),
             bool_and(m.id IS NOT NULL)
        INTO v_ids, v_names, v_known
        FROM (SELECT btrim(x) AS answer, min(n) AS n FROM unnest(string_to_array(v, ', ')) WITH ORDINALITY AS u(x, n) GROUP BY 1) t
        LEFT JOIN (VALUES
          ('In-office', '82279634-6601-4dd2-a1bc-af6737260b6b', 'In Office'),
          ('In-home or onsite', '387c686d-5652-4635-abe6-10621f8359b3', 'In Home / On Site'),
          ('Online', 'd9c0f5a6-6db5-4e97-8dd4-cc80247b96ae', 'Online')) AS m(answer, id, name) ON m.answer = t.answer;
      IF v_known THEN
        v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', '45fdd2ea-f83c-4721-bce7-2e6187a43541', 'kind', 'labels',
          'label', 'Consultation Types', 'optionIds', v_ids, 'onlyIfEmpty', true, 'source', 'kickoff'));
        v_lines := v_lines || to_jsonb('Consultation Types, if empty on the card: ' || v_names);
      ELSE
        v_lines := v_lines || to_jsonb('Consultation Types: not filled, the answer has a type the card does not have.'::text);
      END IF;
    END IF;
    -- ADs Platform (drop_down): only when the answer names exactly one platform the card has.
    v := nullif(btrim(coalesce(a->>'7d16afbb-b99a-4ee9-8718-4418cbeba534', ''), E' \t\n\r\f\x0b'), '');
    IF v IS NOT NULL THEN
      SELECT count(DISTINCT m.id), min(m.id), min(m.name) INTO v_count, v_id, v_names
        FROM (VALUES
          ('\mmeta|facebook|instagram', '88d55b4b-f296-4a0b-abc6-3b228889444a', 'Facebook/Meta'),
          ('tik ?tok', 'c115bdfe-661f-4855-a86b-69a54b2e616a', 'Tiktok'),
          ('snap', '97b22a7b-c18b-4be9-bd03-ff271bacfd77', 'Snapchat')) AS m(pattern, id, name)
       WHERE lower(v) ~ m.pattern;
      IF v_count = 1 THEN
        v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', '2de15aa5-7fe9-48bf-86a1-e4cfee1306c9', 'kind', 'drop_down',
          'label', 'ADs Platform', 'optionId', v_id, 'onlyIfEmpty', true, 'source', 'kickoff'));
        v_lines := v_lines || to_jsonb('ADs Platform, if empty on the card: ' || v_names);
      ELSIF v_count > 1 THEN
        v_lines := v_lines || to_jsonb('ADs Platform: not filled, the answer names more than one platform.'::text);
      ELSE
        v_lines := v_lines || to_jsonb('ADs Platform: not filled, the answer names no platform the card has.'::text);
      END IF;
    END IF;
    -- Fathom (url): the kickoff's recording when it is a Fathom link, else the stored onboarding call's.
    v := btrim(coalesce(a->>'b5578678-d0c2-475b-b66f-7ea54d55fe31', ''), E' \t\n\r\f\x0b');
    v_call := public.cockpit_form_stage4_onboarding_call(p_task_id, p_at);
    IF v ~* '^https://(www\.)?fathom\.video/[^\s]*$' THEN
      v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', 'abaa31ee-28ff-46f6-83bf-6c6d357a26d5', 'kind', 'url',
        'label', 'Fathom', 'value', v, 'onlyIfEmpty', true, 'source', 'kickoff'));
      v_lines := v_lines || to_jsonb('Fathom, if empty on the card: the kickoff''s call recording'::text);
    ELSIF v_call->>'recordingUrl' IS NOT NULL THEN
      v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', 'abaa31ee-28ff-46f6-83bf-6c6d357a26d5', 'kind', 'url',
        'label', 'Fathom', 'value', v_call->>'recordingUrl', 'onlyIfEmpty', true, 'source', 'call_store'));
      v_lines := v_lines || to_jsonb('Fathom, if empty on the card: the stored onboarding call''s recording'::text);
    END IF;
    -- Onboarding Call Date (date): the stored call's day, else the day the kickoff was sent (Kuwait).
    IF v_call->>'startsAt' IS NOT NULL THEN
      v_day := to_char(((v_call->>'startsAt')::timestamptz AT TIME ZONE 'Asia/Kuwait')::date, 'YYYY-MM-DD');
      v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', 'ee9bf855-e05b-4afc-addf-1063cb54d3f0', 'kind', 'date',
        'label', 'Onboarding Call Date', 'value', v_day, 'onlyIfEmpty', true, 'source', 'call_store'));
      v_lines := v_lines || to_jsonb('Onboarding Call Date, if empty on the card: ' || v_day || ' (the stored onboarding call)');
    ELSIF p_at IS NOT NULL THEN
      v_day := to_char((p_at AT TIME ZONE 'Asia/Kuwait')::date, 'YYYY-MM-DD');
      v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', 'ee9bf855-e05b-4afc-addf-1063cb54d3f0', 'kind', 'date',
        'label', 'Onboarding Call Date', 'value', v_day, 'onlyIfEmpty', true, 'source', 'kickoff_day'));
      v_lines := v_lines || to_jsonb('Onboarding Call Date, if empty on the card: ' || v_day || ' (the day the kickoff was sent)');
    END IF;
    v_skip := 'No card field to fill from this kickoff.';
  ELSE
    -- Company Website (url): an https link to the business's own site (no social, Google or link-in-bio host).
    v := nullif(btrim(coalesce(a->>'454a425f-2ac6-4d94-92db-cec08618600e', ''), E' \t\n\r\f\x0b'), '');
    IF v IS NULL THEN
      v_skip := 'No card field to fill: there is no website answer.';
    ELSIF v ~ '^https://' AND public.cockpit_form_stage4_link_kind(v) = 'site' THEN
      v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', '5d57fdde-eb70-4610-a23b-88f718b4451d', 'kind', 'url',
        'label', 'Company Website', 'value', v, 'onlyIfEmpty', true, 'source', 'onboarding'));
      v_lines := v_lines || to_jsonb('Company Website, if empty on the card: the website answer'::text);
    ELSE
      v_skip := 'No card field to fill: the website answer is not an https link to the business''s own site.';
    END IF;
  END IF;
  RETURN jsonb_build_object('key', 'card_facts', 'delivery', 'clickup_queue',
    'plan', jsonb_build_object('taskId', p_task_id, 'fields', v_fields, 'lines', v_lines))
    || CASE WHEN jsonb_array_length(v_fields) = 0 THEN jsonb_build_object('skip', v_skip) ELSE '{}'::jsonb END;
END $$;

-- ---------------------------------------------------------------------------
-- 5. The effects arrays (6 above): 20261102l's, with card_facts in both version-2 arrays.

CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_effects(p_form_key text, p_version integer)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_form_key = 'kickoff' AND p_version = 1 THEN
    RETURN '[{"key":"handoff_comment","label":"Handoff comment","owner":"make","delivery":"clickup_queue"},
             {"key":"onboarding_tasks","label":"Onboarding tasks","owner":"make","delivery":"clickup_queue"},
             {"key":"card_fields","label":"Card fields","owner":"make","delivery":"clickup_queue"},
             {"key":"map_phase4","label":"Map phase 4","owner":"make","delivery":"clickup_queue"},
             {"key":"phase4_whatsapp","label":"Phase 4 WhatsApp","owner":"make","delivery":"client_message"},
             {"key":"kickoff_notice","label":"Kickoff notice","owner":"cockpit","delivery":"slack_notice"},
             {"key":"recap","label":"Recap","owner":"shadow","delivery":"client_message"}]'::jsonb;
  ELSIF p_form_key = 'kickoff' AND p_version = 2 THEN
    RETURN '[{"key":"handoff_comment","label":"Handoff comment","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"native_status","label":"Task status In progress","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"card_fields","label":"Card fields","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"card_facts","label":"Empty card fields filled from the kickoff","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"onboarding_tasks","label":"Tech and creative onboarding tasks","owner":"cockpit","delivery":"sql"},
             {"key":"map_phase4","label":"Map phase 4","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"phase4_whatsapp","label":"Phase 4 WhatsApp","owner":"cockpit","delivery":"client_message"},
             {"key":"kickoff_notice","label":"Kickoff notice","owner":"cockpit","delivery":"slack_notice"},
             {"key":"new_mrr","label":"New MRR","owner":"cockpit","delivery":"sql"},
             {"key":"recap","label":"Recap","owner":"shadow","delivery":"client_message"}]'::jsonb;
  ELSIF p_form_key = 'onboarding' AND p_version = 1 THEN
    -- Make's own effects. No client_data_row: Make 13 [31] searches Client Data for the card's row and
    -- writes nothing; [49] to [48] (map_phase3 and phase3_whatsapp) run once per row it finds (20261102l).
    RETURN '[{"key":"card_fields","label":"Onboarding answers on the card (Make)","owner":"make","delivery":"clickup_queue"},
             {"key":"phase3_whatsapp","label":"Phase 3 WhatsApp message (Make)","owner":"make","delivery":"client_message"},
             {"key":"brand_dna_task","label":"Brand DNA task (Make)","owner":"make","delivery":"clickup_queue"},
             {"key":"github_dispatch","label":"GitHub dispatch (Make)","owner":"make","delivery":"sql"}]'::jsonb;
  ELSIF p_form_key = 'onboarding' AND p_version = 2 THEN
    RETURN '[{"key":"profile_fields","label":"Client Profile and kickoff link","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"card_facts","label":"Company Website on the card, when empty","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"raw_answers_comment","label":"Raw answers comment","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"map_phase3","label":"Map phase 3","owner":"cockpit","delivery":"clickup_queue"},
             {"key":"github_dispatch","label":"Market intel dispatch","owner":"cockpit","delivery":"relay"},
             {"key":"phase3_whatsapp","label":"Phase 3 WhatsApp","owner":"cockpit","delivery":"client_message"},
             {"key":"brand_dna_task","label":"Brand DNA task","owner":"cockpit","delivery":"sql"},
             {"key":"read_model","label":"Answers in the client record","owner":"cockpit","delivery":"sql"}]'::jsonb;
  END IF;
  RAISE EXCEPTION 'There is no Stage 4 effects array for % version %.', coalesce(p_form_key, '(none)'), coalesce(p_version::text, '(none)')
    USING ERRCODE = '22023';
END $$;

-- ---------------------------------------------------------------------------
-- 6. The plan builder: 20261102o's, with the additions (1, 2, 3 and 5 above). Every effect 20261102o
--    plans is planned the same, byte for byte, except that the onboarding tasks' and the Brand DNA task's
--    plans carry details, detailsKind and one more line; card_facts comes after card_fields (kickoff)
--    and after profile_fields (onboarding).

CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_build(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_form text := p_input->>'formKey';
  v_task text := p_input->>'taskId';
  v_answers jsonb := CASE WHEN jsonb_typeof(p_input->'answers') = 'array' THEN p_input->'answers' ELSE '[]'::jsonb END;
  v_hidden jsonb := CASE WHEN jsonb_typeof(p_input->'hidden') = 'object' THEN p_input->'hidden' ELSE '{}'::jsonb END;
  v_second boolean := coalesce((p_input->>'second')::boolean, false);
  v_titles jsonb := public.cockpit_form_stage4_setting('onboarding.raw_titles')->'fields';
  v_at timestamptz := public.cockpit_form_stage4_ts(p_input->>'submittedAt');
  v_by_ref jsonb;
  v_handoff text;
  v_new numeric;
  v_card numeric;
  v_fields jsonb := '[]'::jsonb;
  v_lines jsonb := '[]'::jsonb;
  c jsonb;
  v_answer text;
  v_option text;
  v_part text;
  v_map text;
  v_msg jsonb;
  v_profile text;
  v_raw text;
  v_raw_missing text;
  v_untitled integer;
  v_out jsonb := '[]'::jsonb;
  v_skip text;
  v_brief text;
  v_note text;
BEGIN
  IF v_form NOT IN ('kickoff','onboarding') OR v_task IS NULL OR v_task !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'The Stage 4 plan needs the form and the card.' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(jsonb_object_agg(a->>'ref', a->>'value'), '{}'::jsonb) INTO v_by_ref FROM jsonb_array_elements(v_answers) a;

  IF v_form = 'kickoff' THEN
    -- The handoff text (Make 12 [11], [18], [23]).
    v_handoff := public.cockpit_form_stage4_handoff_text(v_hidden, v_by_ref);
    v_new := CASE WHEN jsonb_typeof(p_input->'newMrrUsd') = 'number' THEN (p_input->>'newMrrUsd')::numeric END;
    v_card := CASE WHEN jsonb_typeof(p_input->'cardMrr') = 'number' THEN (p_input->>'cardMrr')::numeric END;

    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'handoff_comment', 'delivery', 'clickup_queue',
      'plan', jsonb_build_object('taskId', v_task, 'comment_text', v_handoff,
                                 'lines', jsonb_build_array('Handoff comment on the card (' || char_length(v_handoff) || ' characters)'))));
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'native_status', 'delivery', 'clickup_queue',
      'plan', jsonb_build_object('taskId', v_task, 'status', 'IN PROGRESS', 'lines', jsonb_build_array('Task status: IN PROGRESS'))));

    -- The card fields (Make 12 [21]): Client Status, the nine dropdowns by the option maps, and the
    -- Blueprint link pointing at the cockpit Blueprint (the intended difference of 4.13.3).
    v_fields := jsonb_build_array(jsonb_build_object('fieldId', '9368ca9e-3549-4320-84ff-9abd0a2901cb', 'kind', 'drop_down',
      'optionId', 'dbd21650-59ce-429c-882d-5afd7d8aaa8a', 'optionName', 'Brand Blueprint Booked♠️', 'label', 'Client Status'));
    v_lines := jsonb_build_array('Client Status: Brand Blueprint Booked♠️');
    FOR c IN SELECT x FROM jsonb_array_elements(public.cockpit_form_stage4_card_fields()) WITH ORDINALITY AS u(x, n) ORDER BY n LOOP
      v_answer := nullif(btrim(coalesce(v_by_ref->>(c->>'ref'), '')), '');
      CONTINUE WHEN v_answer IS NULL;
      v_option := NULL;
      -- Service Advertised is a multi choice: Make writes switch(first(list)), the option ticked first,
      -- and nothing when the map does not know it. Every other dropdown is one choice.
      FOREACH v_part IN ARRAY CASE WHEN c->>'fieldId' = 'bab9a58b-15af-4b0d-8e20-b8e5a4bee2cc'
                                   THEN (string_to_array(v_answer, ', '))[1:1] ELSE string_to_array(v_answer, ', ') END LOOP
        SELECT m.option_name INTO v_option FROM public.cockpit_form_option_maps m
         WHERE m.form_key = 'kickoff' AND m.field_id = c->>'fieldId' AND m.answer = btrim(v_part);
        EXIT WHEN v_option IS NOT NULL;
      END LOOP;
      CONTINUE WHEN v_option IS NULL;
      v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', c->>'fieldId', 'kind', 'drop_down',
        'optionName', v_option, 'label', c->>'label'));
      v_lines := v_lines || to_jsonb((c->>'label') || ': ' || v_option);
    END LOOP;
    v_fields := v_fields || jsonb_build_array(jsonb_build_object('fieldId', '1b7a4a74-d0e7-4a7f-9218-59c80a738186', 'kind', 'url',
      'value', 'https://cockpit.maharamedia.com/client-success/clients/' || v_task || '/present/blueprint?view=prep',
      'label', '🧬 Brand Blueprint Form Link'));
    v_lines := v_lines || to_jsonb('🧬 Brand Blueprint Form Link: the cockpit Blueprint'::text);
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'card_fields', 'delivery', 'clickup_queue',
      'plan', jsonb_build_object('taskId', v_task, 'fields', v_fields, 'lines', v_lines)));

    -- Empty card fields from the kickoff's typed answers and the call store (20261102n, B8).
    v_out := v_out || jsonb_build_array(public.cockpit_form_stage4_card_facts('kickoff', v_task, v_by_ref, v_at));

    -- The onboarding tasks (Make 12 [17] and [22] from their templates; [18] and [23] post the handoff on
    -- each, whole): comment_text is that comment, for the request writer's task_comment step to post. The
    -- cockpit brief is the details, so each task's description holds the request writer's heading and the
    -- brief (20261102n, B1); a type with no details field would drop it, and the plan says so.
    v_brief := public.cockpit_form_stage4_task_brief(v_task, v_by_ref, v_at);
    v_note := public.cockpit_form_stage4_details_note('client_onboarding');
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'onboarding_tasks', 'delivery', 'sql',
      'plan', jsonb_build_object('typeKey', 'client_onboarding', 'comment_text', v_handoff,
                                 'details', v_brief, 'detailsKind', 'brief',
                                 'lines', jsonb_build_array('Technical Onboarding Check and Creative Onboarding tasks',
                                   coalesce(v_note, 'Cockpit brief in each task''s description (' || char_length(v_brief) || ' characters)')))
              || CASE WHEN v_note IS NOT NULL THEN jsonb_build_object('detailsMissing', v_note) ELSE '{}'::jsonb END));

    v_map := public.cockpit_form_stage4_map_url(4, v_task);
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'map_phase4', 'delivery', 'clickup_queue',
      'plan', jsonb_build_object('taskId', v_task, 'fieldId', '51f49cb1-9f76-48be-b639-c42ca552d20a', 'phase', 4, 'value', v_map,
                                 'lines', jsonb_build_array('Onboarding Map: phase 4')),
      'missing', CASE WHEN v_map IS NULL THEN 'The phase 4 map link is not set up yet (onboarding.map_urls), so the map was not moved.' END));

    v_msg := public.cockpit_form_stage4_message('phase4', p_input->>'client', v_map);
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'phase4_whatsapp', 'delivery', 'client_message',
      'plan', jsonb_build_object('kind', 'phase4', 'body', v_msg->>'body', 'lines', jsonb_build_array('Phase 4 WhatsApp, waiting for the CSM''s approval')),
      'missing', v_msg->>'missing'));

    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'kickoff_notice', 'delivery', 'slack_notice',
      'plan', jsonb_build_object('dedupe', 'kickoff:' || coalesce(p_input->>'readModelResponseId', p_input->>'responseId', ''),
                                 'lines', jsonb_build_array('Kickoff notice in #csm-general'))));

    -- New MRR (Q21, 3.5): the live mrr write only when the answer differs from the card's; never for
    -- 0 against an empty card MRR; never for a card off the billing sheet.
    v_skip := CASE
      WHEN v_new IS NULL THEN 'No New MRR answer, so the card''s MRR is left as it is.'
      WHEN NOT coalesce((p_input->>'cardOnSheet')::boolean, false) THEN 'This card is not on the billing sheet, so New MRR is not written.'
      WHEN v_card IS NOT NULL AND v_card = v_new THEN 'The card already shows that MRR.'
      WHEN v_new = 0 AND coalesce(v_card, 0) = 0 THEN 'New MRR is 0 and the card''s MRR is empty, so nothing changes.'
    END;
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'new_mrr', 'delivery', 'sql',
      'plan', jsonb_build_object('from', v_card, 'to', v_new,
                                 'reason', CASE WHEN v_new = 0 THEN 'Kickoff: paid in full, no monthly fee' ELSE 'Kickoff: New MRR answer' END,
                                 'lines', jsonb_build_array('MRR: ' || coalesce('$' || trim_scale(v_card)::text, 'empty') || ' to '
                                                            || coalesce('$' || trim_scale(v_new)::text, 'not given'))),
      'skip', v_skip));
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'recap', 'delivery', 'client_message',
      'plan', jsonb_build_object('lines', jsonb_build_array('Recap: stays off (Q22)')),
      'skip', 'Kickoff recaps stay off (Q22).'));

    -- A second kickoff (4.13, 3.3): only the handoff comment again.
    IF v_second THEN
      SELECT coalesce(jsonb_agg(CASE WHEN x->>'key' = 'handoff_comment' THEN x
                                     ELSE x || jsonb_build_object('skip', coalesce(x->>'skip',
                                       'A second kickoff posts only the handoff comment.')) END ORDER BY n), '[]'::jsonb)
        INTO v_out FROM jsonb_array_elements(v_out) WITH ORDINALITY AS u(x, n);
    END IF;
    RETURN v_out;
  END IF;

  -- Onboarding (Make 13): the Client Profile and the kickoff link, the raw answers comment, the map
  -- at phase 3, the market intel dispatch (relay), the phase 3 WhatsApp, the Brand DNA task and the
  -- read model. Nothing writes Client Data: Make 13 [31] only searches it (20261102l).
  v_profile := public.cockpit_form_stage4_profile_text(v_by_ref);
  -- The raw answers comment needs a full title for every answered question of the form (X20).
  IF jsonb_typeof(v_titles) IS DISTINCT FROM 'array' THEN
    v_titles := '[]'::jsonb;
  END IF;
  IF jsonb_array_length(v_titles) = 0
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_titles) t
                 WHERE jsonb_typeof(t->'ref') IS DISTINCT FROM 'string' OR jsonb_typeof(t->'title') IS DISTINCT FROM 'string'
                    OR btrim(t->>'title') = '') THEN
    v_raw_missing := 'The onboarding form''s full question titles are not set up yet (onboarding.raw_titles), so the raw answers comment was not posted.';
  ELSE
    SELECT count(DISTINCT a->>'ref') INTO v_untitled FROM jsonb_array_elements(v_answers) a
     WHERE coalesce(a->>'value', '') <> ''
       AND EXISTS (SELECT 1 FROM jsonb_array_elements(public.cockpit_form_stage4_fields('onboarding')) s WHERE s->>'typeformRef' = a->>'ref')
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_titles) t WHERE t->>'ref' = a->>'ref');
    IF v_untitled > 0 THEN
      v_raw_missing := format('The onboarding form''s full question titles (onboarding.raw_titles) have none for %s answered question%s, so the raw answers comment was not posted.',
                              v_untitled, CASE WHEN v_untitled = 1 THEN '' ELSE 's' END);
    ELSE
      v_raw := public.cockpit_form_stage4_raw_answers_text(v_answers, v_titles);
    END IF;
  END IF;
  -- The profile whole, as Make 13 [29] writes it (20261102l cut it at 5,000 characters).
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'profile_fields', 'delivery', 'clickup_queue',
    'plan', jsonb_build_object('taskId', v_task, 'fields', jsonb_build_array(
        jsonb_build_object('fieldId', '7755485f-74a8-496c-85d8-562588e77944', 'kind', 'text', 'value', v_profile, 'label', 'Client Profile'),
        jsonb_build_object('fieldId', '87d7d889-afea-42f8-9485-6f3ead5b857f', 'kind', 'url',
                           'value', 'https://cockpit.maharamedia.com/client-success/clients/' || v_task || '?form=kickoff',
                           'label', 'Kickoff Form Link')),
      'lines', jsonb_build_array('Client Profile (' || char_length(v_profile) || ' characters)', 'Kickoff Form Link: the cockpit kickoff'))));
  -- The card's Company Website from the website answer, when the card has none (20261102n, B8).
  v_out := v_out || jsonb_build_array(public.cockpit_form_stage4_card_facts('onboarding', v_task, v_by_ref, v_at));
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'raw_answers_comment', 'delivery', 'clickup_queue',
    'plan', jsonb_build_object('taskId', v_task, 'comment_text', v_raw,
                               'lines', jsonb_build_array(CASE WHEN v_raw IS NULL THEN 'Raw answers comment'
                                                               ELSE 'Raw answers comment (' || char_length(v_raw) || ' characters)' END)),
    'missing', v_raw_missing));
  v_map := public.cockpit_form_stage4_map_url(3, v_task);
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'map_phase3', 'delivery', 'clickup_queue',
    'plan', jsonb_build_object('taskId', v_task, 'fieldId', '51f49cb1-9f76-48be-b639-c42ca552d20a', 'phase', 3, 'value', v_map,
                               'lines', jsonb_build_array('Onboarding Map: phase 3')),
    'missing', CASE WHEN v_map IS NULL THEN 'The phase 3 map link is not set up yet (onboarding.map_urls), so the map was not moved.' END));
  -- Make 13 [25] sends the typed Business Name answer as client_name, empty when there is none.
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'github_dispatch', 'delivery', 'relay',
    'plan', jsonb_build_object('payload', jsonb_build_object('taskId', v_task,
                                                             'client', coalesce(v_by_ref->>'514bfd3f-4ca1-469e-b9e7-87656503f65c', '')),
                               'lines', jsonb_build_array('Market intel dispatch'))));
  v_msg := public.cockpit_form_stage4_message('phase3', p_input->>'client', v_map);
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'phase3_whatsapp', 'delivery', 'client_message',
    'plan', jsonb_build_object('kind', 'phase3', 'body', v_msg->>'body', 'lines', jsonb_build_array('Phase 3 WhatsApp, waiting for the CSM''s approval')),
    'missing', v_msg->>'missing'));
  -- The Brand DNA task (Make 13 [46]: a name, a list and an assignee, no dates and no description). The
  -- cockpit brief is its details (20261102n, B2); a type with no details field would drop it, and the
  -- plan says so.
  v_brief := public.cockpit_form_stage4_dna_brief(v_task, v_by_ref, p_input->>'client');
  v_note := public.cockpit_form_stage4_details_note('brand_dna');
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'brand_dna_task', 'delivery', 'sql',
    'plan', jsonb_build_object('typeKey', 'brand_dna', 'details', v_brief, 'detailsKind', 'dna_brief',
                               'lines', jsonb_build_array('Brand DNA task',
                                 coalesce(v_note, 'Cockpit brief in the task''s description (' || char_length(v_brief) || ' characters)')))
            || CASE WHEN v_note IS NOT NULL THEN jsonb_build_object('detailsMissing', v_note) ELSE '{}'::jsonb END));
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'read_model', 'delivery', 'sql',
    'plan', jsonb_build_object('entry', jsonb_build_object('form_id', coalesce(p_input->>'readModelFormId', 'native'),
                                                           'response_id', coalesce(p_input->>'readModelResponseId', p_input->>'responseId'),
                                                           'submitted_at', p_input->>'submittedAt', 'answers', v_answers),
                               'lines', jsonb_build_array('Answers in the client record'))));
  RETURN v_out;
END $$;

-- ---------------------------------------------------------------------------
-- 7. The kickoff notice's facts (4 above): 20261025n's, with openItems.

CREATE OR REPLACE FUNCTION public.cockpit_slack_notice_kickoff_facts(p_task text, p_client text, p_forms jsonb, p_old_response text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_k jsonb := coalesce(p_forms->'kickoff', '{}'::jsonb);
  v_rid text := nullif(v_k->>'response_id', '');
  v_old text := nullif(btrim(p_old_response), '');
  v_other boolean := v_old IS NOT NULL AND v_old IS DISTINCT FROM v_rid;
  v_by_ref jsonb;
  v_items jsonb;
BEGIN
  -- The kickoff's open setup items, read from its stored answers by ref (the last answer of a question
  -- answered twice). No key when none of those questions is answered (20261102n).
  IF jsonb_typeof(v_k->'answers') = 'array' THEN
    SELECT jsonb_object_agg(x.ref, x.value) INTO v_by_ref
      FROM (SELECT DISTINCT ON (a->>'ref') a->>'ref' AS ref, a->>'value' AS value
              FROM jsonb_array_elements(v_k->'answers') WITH ORDINALITY AS u(a, n)
             WHERE jsonb_typeof(a) = 'object' AND coalesce(a->>'ref', '') <> '' AND coalesce(a->>'value', '') <> ''
             ORDER BY a->>'ref', n DESC) x;
    v_items := public.cockpit_form_stage4_open_items(v_by_ref);
  END IF;
  RETURN jsonb_build_object(
    'taskId', p_task,
    'client', p_client,
    'responseId', v_rid,
    'formId', nullif(v_k->>'form_id', ''),
    'submittedAt', v_k->>'submitted_at',
    'second', v_other OR coalesce((SELECT s.second FROM public.cockpit_csm_form_sends s WHERE s.response_id = v_rid), false),
    'previousResponseId', CASE WHEN v_other THEN v_old END)
    || CASE WHEN v_items IS NOT NULL THEN jsonb_build_object('openItems', v_items) ELSE '{}'::jsonb END;
END $$;

-- ---------------------------------------------------------------------------
-- 8. The registry rows (6 above): a row holding 20261102l's version-2 array (after a go-live) takes the
--    new one; a row on version 1, or already on the new array, is left as it is; any other array stops
--    the file. 20261102l's version-2 array is the new one without card_facts. One audit row each
--    (cockpit_forms_audit).

DO $$
DECLARE
  f public.cockpit_forms;
  k text;
  v_new1 jsonb;
  v_new2 jsonb;
  v_old2 jsonb;
BEGIN
  FOREACH k IN ARRAY ARRAY['kickoff', 'onboarding'] LOOP
    SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = k FOR UPDATE;
    IF f.key IS NULL THEN
      RAISE EXCEPTION 'There is no % row in the forms registry; apply 20261102j before 20261102p.', k USING ERRCODE = '55000';
    END IF;
    v_new1 := public.cockpit_form_stage4_effects(k, 1);
    v_new2 := public.cockpit_form_stage4_effects(k, 2);
    CONTINUE WHEN f.effects = v_new1 OR f.effects = v_new2;
    SELECT jsonb_agg(e ORDER BY n) INTO v_old2
      FROM jsonb_array_elements(v_new2) WITH ORDINALITY AS u(e, n) WHERE e->>'key' <> 'card_facts';
    IF f.effects IS DISTINCT FROM v_old2 THEN
      RAISE EXCEPTION 'The % effects changed since 20261102l; stop and re-read them.', k USING ERRCODE = '55000';
    END IF;
    PERFORM set_config('cockpit.audit_actor', 'migration 20261102p', true);
    PERFORM set_config('cockpit.audit_source', 'migration', true);
    PERFORM set_config('cockpit.forms_action', 'forms.stage4_card_facts', true);
    UPDATE public.cockpit_forms SET effects = v_new2, updated_by = 'migration 20261102p', updated_at = now() WHERE key = k;
    PERFORM set_config('cockpit.forms_action', '', true);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 9. Privileges: every function here is the owner's only, as 20261025n, 20261102l and 20261102o left
--    the three it replaces.

REVOKE ALL ON FUNCTION public.cockpit_form_stage4_cut(text,integer), public.cockpit_form_stage4_link_kind(text),
  public.cockpit_form_stage4_open_items(jsonb), public.cockpit_form_stage4_onboarding_call(text,timestamptz),
  public.cockpit_form_stage4_brief_line(integer,text,text,integer,text), public.cockpit_form_stage4_brief_join(jsonb,integer),
  public.cockpit_form_stage4_link_flags(jsonb), public.cockpit_form_stage4_details_note(text),
  public.cockpit_form_stage4_task_brief(text,jsonb,timestamptz), public.cockpit_form_stage4_dna_brief(text,jsonb,text),
  public.cockpit_form_stage4_card_facts(text,text,jsonb,timestamptz), public.cockpit_form_stage4_effects(text,integer),
  public.cockpit_form_stage4_build(jsonb), public.cockpit_slack_notice_kickoff_facts(text,text,jsonb,text)
  FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
