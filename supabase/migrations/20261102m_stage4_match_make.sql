-- Stage 4 writes what Make writes (docs/forms/WAVE56-CONTRACT.md 4.13.3, 4.14.3, 4.15.1 and the D-S4F
-- findings; the CEO's decision of 2026-11-02: "Yes, match Make"). Creative Triage (bldgtotkfmhoxmlzowdx).
-- Applies twice; stands on 20261102l.
--
-- For the same answers the native kickoff and onboarding now write what Make 12 (8925654) and Make 13
-- (8922994) write, byte for byte where Make writes text. The reference is scripts/dev/make_parity.py's
-- evaluator of the saved blueprints; stage4-match-make-supabase.test.ts runs it on the same answers.
--
-- 1. The kickoff handoff (Make 12 [11]): Make's 110 lines, each label with its value. Every empty
--    hidden value or answer is "Not provided" (ifempty); a yes/no question is Yes or No, and any other
--    answer to it "Not provided" (switch); a Payment Amount of 0 is "Not provided" (Typeform hands Make
--    a 0 as nothing); a list keeps the order it was ticked.
-- 2. The onboarding tasks (Make 12 [17] and [18], [22] and [23]): Make makes each task from its template
--    with only a name, a list and the template, so it writes no description, then posts the handoff on
--    it as a comment. The plan now carries that comment whole as comment_text (the bytes of the
--    handoff_comment, never cut). The planner (cockpit_form_stage4_plan) hands comment_text to
--    cockpit_request_create_system beside the details, never in them (a request's details stop at
--    4,000 characters; a real handoff reaches 4,656). The request keeps it whole in its new
--    task_comment column and in each part's queue payload as taskComment. Posting taskComment once on
--    the task each part makes is the request writer's step (supabase/functions/clickup-writeback/
--    requests.ts), which has none yet; the writer fixes a part's steps before its first write, so a
--    request made before that step ships never gets the comment. Until it ships, the plan also keeps
--    20261102l's details, the handoff's first 4,000 characters, so each task's description still
--    carries the handoff and the effect's 'delivered' stays true. That differs from Make, which writes
--    no description and posts the whole text: the deploy that adds the writer's step drops the details
--    from this builder in the same change.
-- 3. The kickoff's hidden values (cockpit_form_stage4_hidden, which cockpit_form_stage4_input and the
--    kickoff sheet's prefill read): what Make 13 [29]'s Kickoff Form Link carries for the card's stored
--    onboarding answer. Each answer as it is stored, never trimmed; a question answered twice gives its
--    last answer; the appointment types joined with "," (encodeURL of a list) in the order they were
--    ticked; a revenue as Make's number, so 0 is nothing. A missing or empty answer is left out (the
--    handoff then says "Not provided"), and the business name no longer falls back to the card's name.
--    So that a native onboarding answer gives the ticked order too, the answers list (the read model,
--    the texts) keeps every list in the order it was ticked, as a Typeform answer does (20261102j put a
--    native list in the form's option order).
-- 4. The kickoff's questions (cockpit_form_stage4_fields): tG7dnxBn's five follow-ups that Make 12 [11]
--    prints (c0000001-...-0012 to -0015 and -000b) join the 41, each after the question it follows, and
--    "Post call form filled?" is a Yes or No choice, as tG7dnxBn's yes/no question is. The onboarding's
--    36 questions are unchanged. The kickoff sheet's KICKOFF_FIELDS
--    (apps/client-success-cockpit/src/forms/kickoff.ts) must ask the same 46: its test reads this list,
--    and cockpit_kickoff_answers_check now refuses any other answer to Post call form filled. The
--    kickoff's version-2 record in cockpit_form_versions still lists the 41; the submit checks answers
--    against this list, never against that record.
-- 5. The raw answers comment (Make 13 [41] to [42] to [47]): "**Raw Onboarding Form Answers**", then each
--    answered question in KFRCXPFx's order as "**<its full title>**", the answer and a blank line; a
--    revenue of 0 is a blank line. The full titles are data (X20): onboarding.raw_titles, {fields: [{ref,
--    title}]} in the form's order, seeded empty here and filled at D-S4F from
--    scripts/dev/forms-deploy/stage4-raw-titles.json. While it is empty, or has no title for an answered
--    question, the comment is missing with a sentence and nothing is posted: never a wrong text. A native
--    (version 2) answer takes the full title of its Typeform ref (each of the 36 questions has one); an
--    answer whose ref is not a question of the form keeps its own title and comes after them, as Make
--    lists it.
-- 6. The Client Profile (Make 13 [29], field 7755485f): Make's seven labels, each kept when its answer is
--    empty; a revenue of 0 is blank. Cut at 5,000 characters, as 20261102l cut it: clickup-writeback's
--    forms.ts refuses a longer text value, and that refusal fails the whole row, the Kickoff Form Link
--    with it. Make has no limit, so a profile over 5,000 characters cannot match until the writer takes
--    longer text; that change lifts this cut in the same deploy.
-- 7. Service Advertised (Make 12 [21], field bab9a58b): switch(first(list)), the option ticked first, and
--    no write when that one is not an option.
-- 8. The market intel dispatch (Make 13 [25]): client_name is the typed Business Name answer (514bfd3f),
--    verbatim, and empty when there is none; clickup_id is the card.
-- 9. The Brand DNA task (Make 13 [46]): Make makes it with a name, a list, an assignee and dates, and no
--    description, so the plan carries no details (20261102l put the raw answers text there).
--
-- 20261102j's input and parity plan stay as they are: they read the replaced question list, hidden values
-- and answers list by name. The planner changes only in what it hands a system request (2 above). Every
-- other effect is 20261102l's, byte for byte: native_status, Client Status, the other eight dropdowns and
-- the Blueprint link, map_phase4, phase4_whatsapp, kickoff_notice, new_mrr, recap, the Kickoff Form Link,
-- map_phase3, phase3_whatsapp and read_model, except that a list in the read model is in the order it was
-- ticked. stage4.templates (empty live) no longer shapes any text. Nothing here posts, writes a card,
-- sends a message or reaches a sheet.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. What this file stands on (20261102l), then the drift guard: each replaced body is the one live
--    holds (read 2026-11-02), 20261102l's for the builder (20261102l replaces it first), or this file's
--    own (a second apply).

DO $$
BEGIN
  IF to_regprocedure('public.cockpit_form_stage4_build(jsonb)') IS NULL
     OR to_regprocedure('public.cockpit_form_stage4_native_answers(text,jsonb)') IS NULL
     OR to_regprocedure('public.cockpit_form_stage4_hidden_map()') IS NULL
     OR (SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) FROM pg_catalog.pg_proc p
          WHERE p.oid = to_regprocedure('public.cockpit_form_stage4_build(jsonb)')) = 'a704e72a3921191d2f06a24855d7f219' THEN
    RAISE EXCEPTION 'Apply 20261102l before 20261102m.' USING ERRCODE = '55000';
  END IF;
END $$;

DO $$
DECLARE g record; v_now text;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('public.cockpit_form_stage4_fields(text)', '8c36fd1cf1b0a60b0c776241765eddf7', '032868f54e17a1cbeacc417fb2d0dcb9'),
      ('public.cockpit_form_stage4_hidden(text)', 'cb8d434b635091957a15c7ca96652848', 'c43644ee277f532770e523e61e389aad'),
      ('public.cockpit_form_stage4_typeform_answers(text,jsonb)', '97ec3ad0bb4d2282c518be1447d4f262', 'c9ad150b861d72d497ccb6f3af16cf7e'),
      ('public.cockpit_form_stage4_build(jsonb)', '7e5f7fdaadc74983367cd07bd8c56e3c', '38533746dda5da0468717e304443fef1'),
      ('public.cockpit_request_create_system(text,text,jsonb,uuid)', '295e926095e7832e7d7a220b4d233a23', '45207dde9903fee3c1d0aa0b20eea18f'),
      ('public.cockpit_form_stage4_plan(uuid,boolean)', 'cb27a3730e539bcfbb46dea136af96ae', 'fafbabb9a934a5343f205c998e8823cd')
    ) AS x(fn, live_md5, after_md5)
  LOOP
    v_now := NULL;
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_now
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(g.fn);
    IF v_now IS NULL OR v_now NOT IN (g.live_md5, g.after_md5) THEN
      RAISE EXCEPTION '% changed since 20261102l; stop and re-read it.', replace(g.fn, 'public.', '')
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The setting (X20). Filled at D-S4F with scripts/dev/forms-deploy/stage4-raw-titles.json: the 36
--    questions of the saved KFRCXPFx (D-S4.0) in its order, each {ref, title}. Existing keys win.

INSERT INTO public.cockpit_settings(key, value, updated_by)
VALUES ('onboarding.raw_titles', '{}'::jsonb, 'migration 20261102m') ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. The comment each task of a request gets once it is made, whole: the kickoff handoff on the two
--    onboarding tasks (Make 12 [18] and [23]); NULL for every other request. Like the rest of the row,
--    only the definer functions and the workers read it.

ALTER TABLE public.cockpit_requests ADD COLUMN IF NOT EXISTS task_comment text;

-- ---------------------------------------------------------------------------
-- 3. Make's texts (internal)

-- An answer as Make writes it in text (make_parity.py typed() then to_text()): a number question's
-- answer as Typeform hands it over, without trailing zeros and 0 as nothing (Arabic-Indic digits read as
-- digits, as the evaluator's \d reads them); any other answer as it is. NULL is nothing.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_make_text(p_value text, p_type text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_num text;
BEGIN
  IF p_value IS NULL OR p_value = '' THEN
    RETURN NULL;
  END IF;
  IF p_type = 'number' THEN
    v_num := translate(btrim(p_value, E' \t\n\r\f\x0b'), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
    IF v_num ~ '^-?[0-9]+(\.[0-9]+)?$' THEN
      RETURN nullif(trim_scale(v_num::numeric)::text, '0');
    END IF;
  END IF;
  RETURN p_value;
END $$;

-- Make 12 [11]'s handoff, line by line as the saved blueprint has it (also [18] and [23]). p_hidden: the
-- kickoff's hidden values by name; p_by_ref: the answers by ref as Typeform hands them to Make. Every
-- yes_no line is a yes/no question of tG7dnxBn; the number line is its Payment Amount.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_handoff_text(p_hidden jsonb, p_by_ref jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT string_agg(x.label || CASE x.kind
           WHEN 'text' THEN ''
           WHEN 'hidden' THEN coalesce(nullif(p_hidden->>x.src, ''), 'Not provided')
           WHEN 'yes_no' THEN CASE lower(btrim(p_by_ref->>x.src, E' \t\n\r\f\x0b'))
                                WHEN 'yes' THEN 'Yes' WHEN 'true' THEN 'Yes'
                                WHEN 'no' THEN 'No' WHEN 'false' THEN 'No'
                                ELSE 'Not provided' END
           ELSE coalesce(public.cockpit_form_stage4_make_text(p_by_ref->>x.src, x.kind), 'Not provided') END,
         E'\n' ORDER BY x.n)
    FROM (VALUES
      (1, '*KICKOFF HANDOFF*', 'text', NULL),
      (2, '*Client:* ', 'hidden', 'legal_name'),
      (3, '*Call recording:* ', 'answer', 'b5578678-d0c2-475b-b66f-7ea54d55fe31'),
      (4, '', 'text', NULL),
      (5, '____________________________________', 'text', NULL),
      (6, '', 'text', NULL),
      (7, '*CLIENT DETAILS*', 'text', NULL),
      (8, '*Legal business name:* ', 'hidden', 'legal_name'),
      (9, '*Phone:* ', 'hidden', 'phone'),
      (10, '*Email:* ', 'hidden', 'email'),
      (11, '*Address:* ', 'hidden', 'address'),
      (12, '*Google Maps:* ', 'hidden', 'maps_link'),
      (13, '*Instagram:* ', 'hidden', 'instagram'),
      (14, '*Website:* ', 'hidden', 'website'),
      (15, '*Facebook:* ', 'hidden', 'facebook'),
      (16, '*Business details confirmed:* ', 'yes_no', 'c0000001-0000-4000-8000-000000000001'),
      (17, '*Business notes:* ', 'answer', 'c0000001-0000-4000-8000-000000000002'),
      (18, '*Business corrections:* ', 'answer', 'c0000001-0000-4000-8000-000000000012'),
      (19, '*Online links confirmed:* ', 'yes_no', 'c0000001-0000-4000-8000-000000000003'),
      (20, '*Online-link notes:* ', 'answer', 'c0000001-0000-4000-8000-000000000004'),
      (21, '*Online-link corrections:* ', 'answer', 'c0000001-0000-4000-8000-000000000013'),
      (22, '', 'text', NULL),
      (23, '____________________________________', 'text', NULL),
      (24, '', 'text', NULL),
      (25, '*AVAILABILITY AND OPERATIONS*', 'text', NULL),
      (26, '*Booking platform:* ', 'hidden', 'booking_platform'),
      (27, '*Working hours / availability:* ', 'hidden', 'hours'),
      (28, '*Consultants available:* ', 'hidden', 'consultants'),
      (29, '*Original service focus:* ', 'hidden', 'service_focus'),
      (30, '*Original consultation types:* ', 'hidden', 'consultation_types'),
      (31, '*Payment options:* ', 'hidden', 'payment_options'),
      (32, '*Operations confirmed:* ', 'yes_no', 'c0000001-0000-4000-8000-000000000005'),
      (33, '*Operations notes:* ', 'answer', 'c0000001-0000-4000-8000-000000000006'),
      (34, '*Operations corrections:* ', 'answer', 'c0000001-0000-4000-8000-000000000014'),
      (35, '*Services we are advertising:* ', 'list', 'c0000001-0000-4000-8000-000000000007'),
      (36, '*Consultation types confirmed at kickoff:* ', 'list', 'c0000001-0000-4000-8000-000000000008'),
      (37, '', 'text', NULL),
      (38, '____________________________________', 'text', NULL),
      (39, '', 'text', NULL),
      (40, '*GOALS AND CLIENT CONTEXT*', 'text', NULL),
      (41, '*Previous revenue:* ', 'hidden', 'last_revenue'),
      (42, '*90-day goal:* ', 'hidden', 'goal_90d'),
      (43, '*12-24 month goal:* ', 'hidden', 'goal_12_24'),
      (44, '*Marketing tried before:* ', 'hidden', 'marketing_tried'),
      (45, '*Current challenges:* ', 'hidden', 'challenges'),
      (46, '*Why they joined Mahara:* ', 'hidden', 'why_joined'),
      (47, '*Client notes:* ', 'hidden', 'client_notes'),
      (48, '*Profile complete:* ', 'yes_no', 'c0000001-0000-4000-8000-000000000009'),
      (49, '*Profile notes:* ', 'answer', 'c0000001-0000-4000-8000-000000000011'),
      (50, '*Missing profile information:* ', 'answer', 'c0000001-0000-4000-8000-000000000015'),
      (51, '', 'text', NULL),
      (52, '____________________________________', 'text', NULL),
      (53, '', 'text', NULL),
      (54, '*CONTRACT AND PAYMENT*', 'text', NULL),
      (55, '*Contract status:* ', 'answer', 'c0000001-0000-4000-8000-00000000000a'),
      (56, '*Contract changes needed:* ', 'answer', 'c0000001-0000-4000-8000-00000000000b'),
      (57, '*Payment amount:* ', 'number', '75e97e7d-4c19-437a-b4b8-67570c29344f'),
      (58, '', 'text', NULL),
      (59, '____________________________________', 'text', NULL),
      (60, '', 'text', NULL),
      (61, '*SUPPORT SETUP*', 'text', NULL),
      (62, '*Added to WhatsApp group:* ', 'yes_no', '3db082bb-1939-444b-8b32-d0067fc9878c'),
      (63, '*Other people to add:* ', 'answer', '071c480f-17f9-48db-8155-56030f952e85'),
      (64, '*Drive folders and spreadsheets discussed:* ', 'yes_no', '87c68a44-b19b-4a86-a286-0a2c8c32134e'),
      (65, '*WhatsApp status:* ', 'answer', '92fab954-d771-431c-9fc4-b9f15c53cbb8'),
      (66, '', 'text', NULL),
      (67, '____________________________________', 'text', NULL),
      (68, '', 'text', NULL),
      (69, '*ADVERTISING SETUP*', 'text', NULL),
      (70, '*Advertising platforms:* ', 'list', '7d16afbb-b99a-4ee9-8718-4418cbeba534'),
      (71, '*Daily ad budget:* ', 'answer', 'cf53482c-3d7d-45ab-b294-0230e917ea5f'),
      (72, '*Ad account name:* ', 'answer', 'e4b9dbd3-c12c-4d6f-a0e3-c3ba17c97728'),
      (73, '*Facebook page name:* ', 'answer', '940f494c-f99b-4920-b203-200576ddd780'),
      (74, '*Correct funded card linked:* ', 'yes_no', '8bee68fc-0764-41a8-b90a-db2a3f401e9d'),
      (75, '*Facebook access status:* ', 'answer', '6fcbd33c-60e9-4df7-bfaa-e76b588dd887'),
      (76, '*WhatsApp synced to CRM:* ', 'answer', 'a813378f-06ce-499e-8f0e-14761b89b474'),
      (77, '', 'text', NULL),
      (78, '____________________________________', 'text', NULL),
      (79, '', 'text', NULL),
      (80, '*BOOKING, CALENDAR AND CRM*', 'text', NULL),
      (81, '*Booking platform connects to ours:* ', 'yes_no', '03b0600d-04d2-40a0-a7de-75a488888eb7'),
      (82, '*Google Calendar integration complete:* ', 'yes_no', '3bebf47d-c00b-4f26-8624-933b84e42ebc'),
      (83, '*Booking and calendar integration status:* ', 'answer', 'b657c5a5-d199-42b5-8437-c8d04f78e376'),
      (84, '*Client CRM access status:* ', 'answer', 'ad562fc2-6858-4e37-81c5-c4cc2375a330'),
      (85, '', 'text', NULL),
      (86, '____________________________________', 'text', NULL),
      (87, '', 'text', NULL),
      (88, '*CONTENT AND CREATIVE*', 'text', NULL),
      (89, '*Client content Drive:* ', 'hidden', 'content_drive'),
      (90, '*Marketing content links / notes:* ', 'answer', '3418ef58-72df-49aa-aac3-1e095e155d45'),
      (91, '*Content discussed:* ', 'yes_no', '753c4cde-4d28-4719-8459-06e4db640180'),
      (92, '*Templated ads discussed:* ', 'yes_no', 'f54986bc-e120-4345-afee-31c1000a5a9a'),
      (93, '*Templated ads status:* ', 'answer', 'eb7ed18c-8388-4d84-9b5c-2e3d4a030287'),
      (94, '', 'text', NULL),
      (95, '____________________________________', 'text', NULL),
      (96, '', 'text', NULL),
      (97, '*LEADS AND SALES READINESS*', 'text', NULL),
      (98, '*Has pre-existing leads:* ', 'yes_no', 'dff79b66-89dd-43ef-9664-3fa4e6a61d69'),
      (99, '*Wants Mahara to contact those leads:* ', 'yes_no', '85d7ebb5-ce36-4ac3-aff8-3ce464737abd'),
      (100, '*Lead file / notes:* ', 'answer', '86a6cce0-9111-4d98-97e7-7af5b6d518c8'),
      (101, '*Experience selling to cold leads:* ', 'yes_no', '0cb88b75-f193-43a1-b802-d382178a0946'),
      (102, '*Current cold-lead close rate:* ', 'answer', '079812c4-bb7e-4cc3-8e57-24c3b9e886d9'),
      (103, '', 'text', NULL),
      (104, '____________________________________', 'text', NULL),
      (105, '', 'text', NULL),
      (106, '*TRAINING AND COMPLETION*', 'text', NULL),
      (107, '*Premium Projects Academy confirmed:* ', 'yes_no', '4379c2f7-c5cf-4104-92c5-9b2294d65b59'),
      (108, '*First steps and important videos discussed:* ', 'yes_no', 'dc6eafd2-516e-4ca9-9d9c-89dee060e224'),
      (109, '*Training course access:* ', 'answer', 'c56a7e2d-6f18-4bf9-a9f6-11367eab4c11'),
      (110, '*Post-call form completed:* ', 'yes_no', '34310b2e-4df4-4ed5-b67e-9aefa9087d6e')
    ) AS x(n, label, kind, src)
$$;

-- Make 13 [29]'s Client Profile (field 7755485f): seven labels, each kept when its answer is empty; the
-- three revenues as Typeform hands a number to Make (0 is blank).
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_profile_text(p_by_ref jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT 'Last Year''s Total Revenue: ' || coalesce(public.cockpit_form_stage4_make_text(p_by_ref->>'7ff5d37a-df7f-4002-8248-d0b4af6c28e8', 'number'), '')
      || E'\n\n90-Day Goal Revenue: ' || coalesce(public.cockpit_form_stage4_make_text(p_by_ref->>'791b99b8-c7e9-40a4-96d6-868399e1ae97', 'number'), '')
      || E'\n\n12-24 Month Revenue Goal: ' || coalesce(public.cockpit_form_stage4_make_text(p_by_ref->>'f4b96a9b-bd7c-4398-98b4-6a28a7d3595a', 'number'), '')
      || E'\n\nMarketing they''ve tried A-Z: ' || coalesce(p_by_ref->>'bf8c7c7b-fff9-463f-b30a-8d8ca8b622f6', '')
      || E'\n\nTop 3 challenges: ' || coalesce(p_by_ref->>'fcf43e6a-cc84-4ae7-9cef-2336069d0280', '')
      || E'\n\nWhy they joined: ' || coalesce(p_by_ref->>'7426c6c5-344f-44c9-9999-3b9daf3a06b8', '')
      || E'\n\nAdditional notes: ' || coalesce(p_by_ref->>'41d2d5bb-b023-4fa4-906c-72aeef7a5e46', '')
$$;

-- Make 13's raw answers comment ([41] feeds definition.fields to [42], [47] posts its text): the heading,
-- then each answered question as "**<title>**", its answer and a blank line. p_answers: the answers as
-- Typeform hands them to Make; p_titles: onboarding.raw_titles' fields, [{ref, title}] in KFRCXPFx's
-- order. An answer whose ref has no title there keeps its own and comes after them in its own order;
-- a ref answered twice takes its last answer. KFRCXPFx's three number questions are the revenues.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_raw_answers_text(p_answers jsonb, p_titles jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH a AS (
    SELECT x->>'ref' AS ref, coalesce(x->>'title', '') AS title, x->>'value' AS value, n
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_answers) = 'array' THEN p_answers ELSE '[]'::jsonb END)
           WITH ORDINALITY AS u(x, n)
     WHERE coalesce(x->>'ref', '') <> '' AND coalesce(x->>'value', '') <> ''),
  t AS (
    SELECT DISTINCT ON (y->>'ref') y->>'ref' AS ref, y->>'title' AS title, m
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_titles) = 'array' THEN p_titles ELSE '[]'::jsonb END)
           WITH ORDINALITY AS w(y, m)
     ORDER BY y->>'ref', m),
  r AS (
    SELECT DISTINCT ON (a.ref) a.ref, a.title, a.n,
           (SELECT b.value FROM a b WHERE b.ref = a.ref ORDER BY b.n DESC LIMIT 1) AS value
      FROM a ORDER BY a.ref, a.n)
  SELECT '**Raw Onboarding Form Answers**' || E'\n\n' || coalesce(string_agg(
           '**' || coalesce(t.title, r.title) || '**' || E'\n'
           || coalesce(public.cockpit_form_stage4_make_text(r.value,
                CASE WHEN r.ref IN ('7ff5d37a-df7f-4002-8248-d0b4af6c28e8', '791b99b8-c7e9-40a4-96d6-868399e1ae97',
                                    'f4b96a9b-bd7c-4398-98b4-6a28a7d3595a') THEN 'number' END), '')
           || E'\n',
           E'\n' ORDER BY t.m NULLS LAST, r.n), '')
    FROM r LEFT JOIN t ON t.ref = r.ref
$$;

-- ---------------------------------------------------------------------------
-- 4. The replaced readers: 20261102j's, with the lines named

-- The kickoff's 41 answers of tG7dnxBn and the onboarding's 36 questions of KFRCXPFx (20261102j), plus
-- the kickoff's five follow-ups Make 12 [11] prints, each after the question it follows in tG7dnxBn:
-- detailsCorrection (c0000001-...-0012), linksCorrection (-0013), operationsCorrection (-0014),
-- profileMissing (-0015) and contractChanges (-000b), with tG7dnxBn's titles. postCallFormFilled is a
-- Yes or No choice, as tG7dnxBn's yes/no question is (Make 12 [11] writes Not provided for anything
-- else). Every other question is 20261102j's, word for word.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_fields(p_form_key text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_form_key = 'kickoff' THEN
    RETURN '[{"key":"detailsCorrect","typeformRef":"c0000001-0000-4000-8000-000000000001","title":"Is all of the above still correct?","type":"choice","options":["Yes","No"]},{"key":"detailsFix","typeformRef":"c0000001-0000-4000-8000-000000000002","title":"Anything to add?","type":"longtext"},{"key":"detailsCorrection","typeformRef":"c0000001-0000-4000-8000-000000000012","title":"What is wrong? Give the correct details.","type":"longtext"},{"key":"linksCorrect","typeformRef":"c0000001-0000-4000-8000-000000000003","title":"Is all of the above still correct?","type":"choice","options":["Yes","No"]},{"key":"linksFix","typeformRef":"c0000001-0000-4000-8000-000000000004","title":"Anything to add?","type":"longtext"},{"key":"linksCorrection","typeformRef":"c0000001-0000-4000-8000-000000000013","title":"Which link is wrong, and what is the correct one?","type":"longtext"},{"key":"operationsCorrect","typeformRef":"c0000001-0000-4000-8000-000000000005","title":"Is all of the above still correct?","type":"choice","options":["Yes","No"]},{"key":"operationsFix","typeformRef":"c0000001-0000-4000-8000-000000000006","title":"Anything to add?","type":"longtext"},{"key":"operationsCorrection","typeformRef":"c0000001-0000-4000-8000-000000000014","title":"What has changed? Give the correct details.","type":"longtext"},{"key":"serviceAdvertised","typeformRef":"c0000001-0000-4000-8000-000000000007","title":"Which service are we advertising?","type":"multi","options":["Design and build","Interior design","Architectural design","Fit out and renovation","Construction only","Other"]},{"key":"consultationTypes","typeformRef":"c0000001-0000-4000-8000-000000000008","title":"Which consultation types do they offer?","type":"multi","options":["In-office","In-home or onsite","Online"]},{"key":"profileComplete","typeformRef":"c0000001-0000-4000-8000-000000000009","title":"Is the profile complete?","type":"choice","options":["Yes","No"]},{"key":"profileFix","typeformRef":"c0000001-0000-4000-8000-000000000011","title":"Anything to add?","type":"longtext"},{"key":"profileMissing","typeformRef":"c0000001-0000-4000-8000-000000000015","title":"What is missing?","type":"longtext"},{"key":"contractStatus","typeformRef":"c0000001-0000-4000-8000-00000000000a","title":"Contract status","type":"choice","options":["Signed","Sent and waiting on client","Adjustments requested by client","Not sent yet","NA - already signed"]},{"key":"contractChanges","typeformRef":"c0000001-0000-4000-8000-00000000000b","title":"What needs changing in the contract?","type":"longtext"},{"key":"inWhatsappGroup","typeformRef":"3db082bb-1939-444b-8b32-d0067fc9878c","title":"Have you been added to the WhatsApp group?","type":"choice","options":["Yes","No"]},{"key":"whatsappAdd","typeformRef":"071c480f-17f9-48db-8155-56030f952e85","title":"Who else should we add to the WhatsApp group?","type":"text"},{"key":"driveDiscussed","typeformRef":"87c68a44-b19b-4a86-a286-0a2c8c32134e","title":"Have drive folders and filling out spreadsheets been discussed? (Intro message Whatsapp group)","type":"choice","options":["Yes","No"]},{"key":"whatsappStatus","typeformRef":"92fab954-d771-431c-9fc4-b9f15c53cbb8","title":"WhatsApp Status","type":"choice","options":["Access confirmed.","Pending.","Invited.","Waiting on client."]},{"key":"adPlatforms","typeformRef":"7d16afbb-b99a-4ee9-8718-4418cbeba534","title":"Which platforms will we advertise on?","type":"text"},{"key":"dailyBudget","typeformRef":"cf53482c-3d7d-45ab-b294-0230e917ea5f","title":"What is your daily budget for the ads?","type":"text"},{"key":"adAccountName","typeformRef":"e4b9dbd3-c12c-4d6f-a0e3-c3ba17c97728","title":"What is the name of the ad account? (has to be exact)","type":"text"},{"key":"facebookPageName","typeformRef":"940f494c-f99b-4920-b203-200576ddd780","title":"What is the name of the Facebook page? (has to be exact)","type":"text"},{"key":"cardLinked","typeformRef":"8bee68fc-0764-41a8-b90a-db2a3f401e9d","title":"Correct Card Linked To The Account With Funds?","type":"choice","options":["Yes","No"]},{"key":"facebookAccess","typeformRef":"6fcbd33c-60e9-4df7-bfaa-e76b588dd887","title":"Facebook Access Status?","type":"choice","options":["Requested","Waiting on Client","Access Confirmed","Pending","Using Ours","Need Tech Help","Their Page Our Ad Acc"]},{"key":"whatsappSynced","typeformRef":"a813378f-06ce-499e-8f0e-14761b89b474","title":"Whatsapp synced to Mahara OS?","type":"choice","options":["Requested","Waiting on Client","Integrated","Needs Integrating","Pending","Not Integrating"]},{"key":"bookingConnects","typeformRef":"03b0600d-04d2-40a0-a7de-75a488888eb7","title":"Does the booking platform connect to ours?","type":"choice","options":["Yes","No"]},{"key":"calendarComplete","typeformRef":"3bebf47d-c00b-4f26-8624-933b84e42ebc","title":"Google Calendar Integration Complete?","type":"choice","options":["Yes","No"]},{"key":"calendarStatus","typeformRef":"b657c5a5-d199-42b5-8437-c8d04f78e376","title":"Booking platform & Google Calendar Integration Status","type":"choice","options":["Requested","Waiting on Client","Integrated","Needs Integrating","Pending","Not Integrating","Google Synched - Not Integrated"]},{"key":"maharaOsAccess","typeformRef":"ad562fc2-6858-4e37-81c5-c4cc2375a330","title":"Mahara OS Access Status","type":"choice","options":["Logged In","Tech Issue","Didn''t Receive Access","Doesn''t Want To"]},{"key":"contentLinks","typeformRef":"3418ef58-72df-49aa-aac3-1e095e155d45","title":"Provide any marketing content links or notes.","type":"longtext"},{"key":"contentDiscussed","typeformRef":"753c4cde-4d28-4719-8459-06e4db640180","title":"Content Discussed","type":"choice","options":["Yes","No"]},{"key":"templatedAdsDiscussed","typeformRef":"f54986bc-e120-4345-afee-31c1000a5a9a","title":"Templated Ads Discussed","type":"choice","options":["Yes","No"]},{"key":"templatedAdsStatus","typeformRef":"eb7ed18c-8388-4d84-9b5c-2e3d4a030287","title":"Templated Ads Status","type":"choice","options":["Approved","Declined","Waiting On Client","Wants To See Them First"]},{"key":"hasLeads","typeformRef":"dff79b66-89dd-43ef-9664-3fa4e6a61d69","title":"Do you have pre-existing leads?","type":"choice","options":["Yes","No"]},{"key":"reachLeads","typeformRef":"85d7ebb5-ce36-4ac3-aff8-3ce464737abd","title":"Do you want us to reach out to those leads?","type":"choice","options":["Yes","No"]},{"key":"leadsLinks","typeformRef":"86a6cce0-9111-4d98-97e7-7af5b6d518c8","title":"Provide link or notes for those leads.","type":"longtext"},{"key":"coldLeadsExperience","typeformRef":"0cb88b75-f193-43a1-b802-d382178a0946","title":"Do you have experience selling to cold leads (leads from ads)?","type":"choice","options":["Yes","No"]},{"key":"coldCloseRate","typeformRef":"079812c4-bb7e-4cc3-8e57-24c3b9e886d9","title":"What is your current close rate on cold leads?","type":"text"},{"key":"academyConfirmed","typeformRef":"4379c2f7-c5cf-4104-92c5-9b2294d65b59","title":"Premium Projects Academy Confirmed?","type":"choice","options":["Yes","No"]},{"key":"firstStepsDiscussed","typeformRef":"dc6eafd2-516e-4ca9-9d9c-89dee060e224","title":"Discussed First Steps and Important Videos?","type":"choice","options":["Yes","No"]},{"key":"trainingAccess","typeformRef":"c56a7e2d-6f18-4bf9-a9f6-11367eab4c11","title":"Training Course Access","type":"choice","options":["Confirmed","Requested","Need Tech Help","Waiting On Client"]},{"key":"paymentAmount","typeformRef":"75e97e7d-4c19-437a-b4b8-67570c29344f","title":"Payment Amount","type":"number"},{"key":"postCallFormFilled","typeformRef":"34310b2e-4df4-4ed5-b67e-9aefa9087d6e","title":"Post call form filled?","type":"choice","options":["Yes","No"]},{"key":"callRecording","typeformRef":"b5578678-d0c2-475b-b66f-7ea54d55fe31","title":"Call Recording Link","type":"url"}]'::jsonb;
  ELSIF p_form_key = 'onboarding' THEN
    RETURN '[{"key":"fullName","typeformRef":"533f14a0-712f-4de9-9ac7-67e1be6bc0c8","title":"Full Name","type":"text"},{"key":"phone","typeformRef":"64f2fb80-b074-4017-b8b7-b7d549947e52","title":"Phone","type":"text"},{"key":"email","typeformRef":"7994f0d2-baeb-451b-983a-816290873a68","title":"Email","type":"text"},{"key":"businessName","typeformRef":"514bfd3f-4ca1-469e-b9e7-87656503f65c","title":"Business Name","type":"text"},{"key":"address","typeformRef":"e5caee43-e9b5-427d-8583-6982c5dd9be8","title":"Please enter your business address.","type":"text"},{"key":"mapsLink","typeformRef":"f7f9f2eb-1761-4c28-83ed-a53621c2cf88","title":"Paste a Google Maps link to your location (optional).","type":"text"},{"key":"website","typeformRef":"454a425f-2ac6-4d94-92db-cec08618600e","title":"Website URL","type":"text"},{"key":"instagram","typeformRef":"adecfe45-5d55-4319-98ff-3761e04bfc9b","title":"Instagram URL","type":"text"},{"key":"facebook","typeformRef":"575d17ed-e26d-4e55-87d3-7cb31cb71939","title":"Facebook Page URL","type":"text"},{"key":"paymentOptions","typeformRef":"ee25f923-d5e1-4d1a-a95f-cd9c17abbe83","title":"What payment options do you currently offer to your clients (e.g., full payment, installment plans, minimum down payment, in-house financing, third-party financing)?","type":"longtext"},{"key":"frontDeskPhone","typeformRef":"282dac48-5031-4acb-96b6-ea469e8a5a8b","title":"Front Desk Phone","type":"text"},{"key":"personalPhone","typeformRef":"09d2e62a-51d4-4665-a3a9-30f5279b71bc","title":"Personal Phone Number","type":"text"},{"key":"yearsInBusiness","typeformRef":"ed1ba2fe-2827-4eea-a678-62205f1ce9f5","title":"How long have you been in business?","type":"text"},{"key":"bookingSoftware","typeformRef":"7a120dbb-0169-4bcc-9193-5c525a470d02","title":"Current booking software","type":"text"},{"key":"facebookAds","typeformRef":"ddf2767d-5725-4df2-b200-f0aab77a2db5","title":"Do you have a facebook business manager or have you ever ran ads on meta (Facebook & Instagram) in the past?","type":"choice","options":[{"value":"yes","typeform":"Yes"},{"value":"unsure","typeform":"IM UNSURE | لست متأكدًا"},{"value":"ran_before","typeform":"I''ve ran ads before but dont know how to access my Account |شغّلت إعلانات من قبل لكنني لا أعرف كيف أصل إلى حسابي"},{"value":"never_ran","typeform":"I Have a Business Account but have never ran ads | لديّ حساب أعمال على فيسبوك لكنني لم أقم بتشغيل إعلانات من قبل"}]},{"key":"projectsDone","typeformRef":"0a6b5704-c46d-480c-a592-b59108683596","title":"How many projects has your company completed to date?","type":"text"},{"key":"hours","typeformRef":"b7873d40-d154-42ac-bf24-cb3b667e84cc","title":"Business hours - When are you open to schedule?","type":"text"},{"key":"services","typeformRef":"d976036f-6c2e-4d5d-999a-64cf9bb2ef02","title":"1) What services do you offer list all of them? Also I want to know which ones have the HIGHEST price point and Highest Profit 2) What is the PRICE of the services?","type":"longtext"},{"key":"serviceFocus","typeformRef":"6271b610-6946-4056-bb08-d03ffc274141","title":"Out of those what is the #1 service/type of project you want to focus on scaling?","type":"longtext"},{"key":"faqs","typeformRef":"f2b7bc2b-2a79-4640-9e21-377e7aa39d45","title":"What are your top five most frequently asked questions and their answers? (Feel free to add more — the more detailed, the better.)","type":"longtext"},{"key":"idealProject","typeformRef":"6c819933-3eb9-4db8-bd59-d39be11cb7f0","title":"Please describe your ideal project in detail.","type":"longtext"},{"key":"serviceAreas","typeformRef":"fa017616-3fb5-4e64-9fbd-39cea6e26c47","title":"What service areas do you cover? Please list all cities and neighborhoods you serve so we can target your ads precisely.","type":"longtext"},{"key":"appointmentTypes","typeformRef":"b370341c-6ea3-43c9-bd8c-16e278a2d2d5","title":"What types of appointments do you offer? (Select all that apply)","type":"multi","options":[{"value":"online","typeform":"عن بُعد (أونلاين) | Online"},{"value":"onsite","typeform":"في موقع العميل / في المنزل | Onsite / In-home"},{"value":"office","typeform":"في مقرّكم / مكتبكم | In your office"}]},{"key":"maxDistance","typeformRef":"35ea63c3-090a-425d-b75c-e3d183d48cd1","title":"What''s the maximum distance you would travel from your office to do an in-home consultation?","type":"text"},{"key":"landmark","typeformRef":"b7c403ea-8d66-4814-80cf-7e8d7fdb8d11","title":"Local Landmark Information (Please type this in the format shown) - Located next to the Burger King down King Saud street on the left hand side.","type":"text"},{"key":"appointmentLength","typeformRef":"a20cfc1a-0228-413d-80ab-d97fc97574e0","title":"Appointment length + details + buffer","type":"text"},{"key":"consultants","typeformRef":"0a80a0a8-3a09-4907-a1d1-6c57e57d4c47","title":"Who are the engineers in your business that will be giving these consultations?","type":"longtext"},{"key":"whyJoined","typeformRef":"7426c6c5-344f-44c9-9999-3b9daf3a06b8","title":"What motivated you to join our program? What was the reason you signed up?","type":"longtext"},{"key":"freeConsults","typeformRef":"ec89854f-d006-402b-958a-91738e2b3e7a","title":"Do you offer free consultations?","type":"choice","options":[{"value":"yes","typeform":"Yes, we do offer free consultations / نعم، نقدم استشارات مجانية✅"},{"value":"open_to_it","typeform":"No, but we''re open to considering it / حاليا لا نقدمها، لكن يمكننا مناقشه🤝"},{"value":"no","typeform":"No, we do not offer free consultations / لا، لا نقدم استشارات مجانية❌"}]},{"key":"marketing","typeformRef":"bf8c7c7b-fff9-463f-b30a-8d8ca8b622f6","title":"What is your marketing process? In other words... please explain EVERYTHING A-Z that you have in place or have tried to generate new projects","type":"longtext"},{"key":"lastRevenue","typeformRef":"7ff5d37a-df7f-4002-8248-d0b4af6c28e8","title":"Last Calendar Year - How Much Total Revenue did you do?","type":"text"},{"key":"challenges","typeformRef":"fcf43e6a-cc84-4ae7-9cef-2336069d0280","title":"What are the TOP 3 challenges that - if we were able to help you with - would make you 100% satisfied with your investment? - Be specific.","type":"longtext"},{"key":"goal90","typeformRef":"791b99b8-c7e9-40a4-96d6-868399e1ae97","title":"What is your realistic goal revenue in 90 Days?","type":"text"},{"key":"goal12","typeformRef":"f4b96a9b-bd7c-4398-98b4-6a28a7d3595a","title":"What is your ideal/stretch revenue goal within the next 12-24 months?","type":"text"},{"key":"additionalInfo","typeformRef":"41d2d5bb-b023-4fa4-906c-72aeef7a5e46","title":"Any additional information we should know before starting?","type":"longtext"},{"key":"driveLink","typeformRef":"64d23c81-1784-4f07-8356-107af764fc95","title":"Please attach a Google Drive link to all the content you have for your office (See check list below)","type":"text"}]'::jsonb;
  END IF;
  RAISE EXCEPTION 'There is no Stage 4 field map for %.', coalesce(p_form_key, '(none)') USING ERRCODE = '22023';
END $$;

-- The kickoff's hidden values for one card, each with where it came from: what Make 13 [29]'s Kickoff
-- Form Link carries for the card's newest stored onboarding answer (the read model, any door), decoded.
-- onboarding_client_id is the card. Every other value is the answer to its question as Typeform hands it
-- to Make and encodeURL() writes it: as stored, never trimmed, the last answer of a question answered
-- twice; the appointment types (the link's one multiple choice) joined with "," in the order they were
-- ticked; a revenue as Make's number, so 0 is nothing. A missing or empty answer is left out, so the
-- handoff says "Not provided" as Make's ifempty() does, and nothing falls back to the card's name.
-- Never stored on a response (the client's email and phone ride here).
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_hidden(p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE o public.cockpit_client_onboarding; h jsonb; v text; v_out jsonb := '{}'::jsonb;
BEGIN
  SELECT * INTO o FROM public.cockpit_client_onboarding x WHERE x.clickup_task_id = p_task_id;
  FOR h IN SELECT x FROM jsonb_array_elements(public.cockpit_form_stage4_hidden_map()) x LOOP
    v := NULL;
    IF h->>'key' = 'onboarding_client_id' THEN
      v_out := v_out || jsonb_build_object(h->>'key', jsonb_build_object('value', p_task_id, 'source', 'card'));
      CONTINUE;
    END IF;
    IF jsonb_typeof(o.forms->'onboarding'->'answers') = 'array' THEN
      SELECT a->>'value' INTO v FROM jsonb_array_elements(o.forms->'onboarding'->'answers') WITH ORDINALITY AS u(a, n)
       WHERE a->>'ref' = h->>'ref' AND coalesce(a->>'value', '') <> ''
       ORDER BY n DESC LIMIT 1;
    END IF;
    v := CASE
      WHEN h->>'ref' IN ('7ff5d37a-df7f-4002-8248-d0b4af6c28e8', '791b99b8-c7e9-40a4-96d6-868399e1ae97',
                         'f4b96a9b-bd7c-4398-98b4-6a28a7d3595a') THEN public.cockpit_form_stage4_make_text(v, 'number')
      WHEN h->>'ref' = 'b370341c-6ea3-43c9-bd8c-16e278a2d2d5' THEN replace(v, ', ', ',')
      ELSE v END;
    IF coalesce(v, '') <> '' THEN
      v_out := v_out || jsonb_build_object(h->>'key', jsonb_build_object('value', v, 'source', 'onboarding'));
    END IF;
  END LOOP;
  RETURN v_out;
END $$;

-- Native answers (keyed by question key) as the Typeform answers list [{ref, title, value}], in the
-- form's order, blanks left out: the shape the read model, the texts and Make's inputs share. A list
-- keeps the order it was ticked, as Typeform hands a multiple choice to Make (Make 12 [21]'s first() is
-- the option ticked first; Make 13 [29]'s link lists the appointment types as ticked), each option once
-- where it was first ticked; an answer that is not one of the question's options is left out.
-- 20261102j put a list in the form's option order.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_typeform_answers(p_form_key text, p_answers jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s jsonb; v jsonb; v_text text; v_out jsonb := '[]'::jsonb;
BEGIN
  FOR s IN SELECT x FROM jsonb_array_elements(public.cockpit_form_stage4_fields(p_form_key)) WITH ORDINALITY AS u(x, n) ORDER BY n LOOP
    v := p_answers -> (s->>'key');
    CONTINUE WHEN v IS NULL OR v = 'null'::jsonb;
    IF s->>'type' IN ('choice','multi') AND jsonb_typeof(v) = 'array' THEN
      -- An onboarding option is written as its Typeform label; a kickoff option is its own label.
      SELECT string_agg(y.label, ', ' ORDER BY t.n) INTO v_text
        FROM (SELECT e #>> '{}' AS val, min(n) AS n FROM jsonb_array_elements(v) WITH ORDINALITY AS u(e, n) GROUP BY 1) t
        JOIN LATERAL (SELECT CASE WHEN p_form_key = 'onboarding' THEN o->>'typeform' ELSE o #>> '{}' END AS label
                        FROM jsonb_array_elements(s->'options') o
                       WHERE CASE WHEN p_form_key = 'onboarding' THEN o->>'value' ELSE o #>> '{}' END = t.val
                       LIMIT 1) y ON true;
    ELSIF p_form_key = 'onboarding' AND s->>'type' IN ('choice','multi') THEN
      SELECT string_agg(o->>'typeform', ', ' ORDER BY n) INTO v_text
        FROM jsonb_array_elements(s->'options') WITH ORDINALITY AS u(o, n)
       WHERE jsonb_typeof(v) = 'string' AND v #>> '{}' = o->>'value';
    ELSE
      v_text := public.cockpit_form_stage4_text(v);
    END IF;
    CONTINUE WHEN v_text IS NULL OR btrim(v_text) = '';
    v_out := v_out || jsonb_build_array(jsonb_build_object('ref', s->>'typeformRef', 'title', s->>'title', 'value', v_text));
  END LOOP;
  RETURN v_out;
END $$;

-- ---------------------------------------------------------------------------
-- 5. The plan builder: 20261102l's, with Make's texts (1, 2 and 5 to 9 above). Input as there: the
--    answers as Typeform hands them to Make, each list in the order it was ticked.

CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_build(p_input jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_form text := p_input->>'formKey';
  v_task text := p_input->>'taskId';
  v_answers jsonb := CASE WHEN jsonb_typeof(p_input->'answers') = 'array' THEN p_input->'answers' ELSE '[]'::jsonb END;
  v_hidden jsonb := CASE WHEN jsonb_typeof(p_input->'hidden') = 'object' THEN p_input->'hidden' ELSE '{}'::jsonb END;
  v_second boolean := coalesce((p_input->>'second')::boolean, false);
  v_titles jsonb := public.cockpit_form_stage4_setting('onboarding.raw_titles')->'fields';
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

    -- The onboarding tasks (Make 12 [17] and [22] from their templates, no description; [18] and [23] post
    -- the handoff on each, whole): comment_text is that comment, for the request writer to post. Until
    -- requests.ts has the step that posts it, the details keep 20261102l's first 4,000 characters of the
    -- handoff, so no task is made without it.
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'onboarding_tasks', 'delivery', 'sql',
      'plan', jsonb_build_object('typeKey', 'client_onboarding', 'details', left(v_handoff, 4000), 'comment_text', v_handoff,
                                 'lines', jsonb_build_array('Technical Onboarding Check and Creative Onboarding tasks'))));

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
  -- The profile is cut at 5,000 characters, as 20261102l cut it: forms.ts refuses a longer text value,
  -- and with it the Kickoff Form Link in the same row.
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'profile_fields', 'delivery', 'clickup_queue',
    'plan', jsonb_build_object('taskId', v_task, 'fields', jsonb_build_array(
        jsonb_build_object('fieldId', '7755485f-74a8-496c-85d8-562588e77944', 'kind', 'text', 'value', left(v_profile, 5000), 'label', 'Client Profile'),
        jsonb_build_object('fieldId', '87d7d889-afea-42f8-9485-6f3ead5b857f', 'kind', 'url',
                           'value', 'https://cockpit.maharamedia.com/client-success/clients/' || v_task || '?form=kickoff',
                           'label', 'Kickoff Form Link')),
      'lines', jsonb_build_array('Client Profile (' || char_length(v_profile) || ' characters)', 'Kickoff Form Link: the cockpit kickoff'))));
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
  -- The Brand DNA task (Make 13 [46]: a name, a list, an assignee and dates, no description). No details.
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'brand_dna_task', 'delivery', 'sql',
    'plan', jsonb_build_object('typeKey', 'brand_dna', 'lines', jsonb_build_array('Brand DNA task'))));
  v_out := v_out || jsonb_build_array(jsonb_build_object('key', 'read_model', 'delivery', 'sql',
    'plan', jsonb_build_object('entry', jsonb_build_object('form_id', coalesce(p_input->>'readModelFormId', 'native'),
                                                           'response_id', coalesce(p_input->>'readModelResponseId', p_input->>'responseId'),
                                                           'submitted_at', p_input->>'submittedAt', 'answers', v_answers),
                               'lines', jsonb_build_array('Answers in the client record'))));
  RETURN v_out;
END $$;

-- ---------------------------------------------------------------------------
-- 6. The onboarding tasks' comment reaches the request writer (2 above)

-- The system's requests: 20261102j's, with the comment each task gets once it is made. p_answers'
-- comment_text is that comment, not an answer: kept whole, as given, on the request (task_comment) and
-- in each part's queue payload (taskComment), never in its description or answers; the audit row holds
-- its length, not its text. Missing or blank, the request has none, as before.
CREATE OR REPLACE FUNCTION public.cockpit_request_create_system(p_type_key text, p_task_id text, p_answers jsonb, p_response_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t public.cockpit_request_types;
  r public.cockpit_form_responses;
  v_existing public.cockpit_requests;
  v_id uuid := gen_random_uuid();
  v_answers jsonb := '{}'::jsonb;
  v_client text;
  v_member uuid;
  v_email text;
  v_label text;
  v_due date;
  v_plan jsonb;
  v_e jsonb;
  v_queue uuid;
  v_details text := nullif(btrim(coalesce(p_answers->>'details', '')), '');
  v_comment text := CASE WHEN btrim(coalesce(p_answers->>'comment_text', '')) <> '' THEN p_answers->>'comment_text' END;
BEGIN
  IF p_type_key NOT IN ('client_onboarding','brand_dna') THEN
    RAISE EXCEPTION 'The system makes only the onboarding tasks and the Brand DNA task.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  IF r.id IS NULL OR r.task_id IS DISTINCT FROM p_task_id THEN
    RAISE EXCEPTION 'The request must come from an answer on the same card.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM public.cockpit_request_types x WHERE x.key = p_type_key;
  IF t.key IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'missing', format('The %s request type is not set up yet, so no task was made.', p_type_key));
  END IF;
  IF NOT t.enabled THEN
    RETURN jsonb_build_object('ok', false, 'missing', format('The %s request type is turned off, so no task was made.', p_type_key));
  END IF;
  SELECT * INTO v_existing FROM public.cockpit_requests q WHERE q.form_response_id = p_response_id AND q.type_key = p_type_key;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'requestId', v_existing.id, 'reused', true);
  END IF;
  SELECT * INTO v_existing FROM public.cockpit_requests q
   WHERE q.type_key = p_type_key AND q.client_task_id = p_task_id AND q.source = 'form'
     AND q.state NOT IN ('cancelled','failed','routed')
   ORDER BY q.created_at DESC LIMIT 1;
  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'skipped', 'Already made for this client.', 'requestId', v_existing.id);
  END IF;
  SELECT coalesce(nullif(btrim(o.client_name), ''), nullif(btrim(a.client_name), ''), r.client_name) INTO v_client
    FROM (SELECT 1) one
    LEFT JOIN public.cockpit_client_onboarding o ON o.clickup_task_id = p_task_id
    LEFT JOIN public.cockpit_billing_accounts a ON a.clickup_task_id = p_task_id;
  -- The requester: the CSM who sent the kickoff; the client's onboarding answer has none.
  IF r.created_by_id IS NOT NULL THEN
    SELECT m.id, m.email INTO v_member, v_email FROM public.cockpit_members m
     WHERE m.auth_user_id = r.created_by_id AND m.active ORDER BY m.updated_at DESC LIMIT 1;
  END IF;
  v_label := CASE WHEN v_member IS NOT NULL THEN coalesce(public.cockpit_slack_notice_role_of(v_email), 'the CSM')
                  ELSE 'the cockpit (client onboarding form)' END;
  IF v_details IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(t.fields) f WHERE f->>'key' = 'details') THEN
    v_answers := jsonb_build_object('details', v_details);
  END IF;
  v_due := public.cockpit_request_due_default(t.due_days);
  v_plan := public.cockpit_request_plan(t, v_id, p_task_id, v_client, v_answers, v_due, t.priority, v_label, NULL);
  PERFORM set_config('cockpit.audit_source', 'forms-stage4', true);
  INSERT INTO public.cockpit_requests(id, type_key, type_version, type_label, requester_member_id, requester_email, requester_label,
    source, client_task_id, client_name, answers, due_on, priority, state, content_hash, form_response_id, task_comment)
  VALUES (v_id, t.key, t.version, t.label, v_member, v_email, v_label, 'form', p_task_id, v_client, v_answers, v_due, t.priority,
          'sending', public.cockpit_request_hash(t.key, p_task_id, v_answers, v_due, t.priority, NULL), p_response_id, v_comment);
  FOR v_e IN SELECT e FROM jsonb_array_elements(v_plan) WITH ORDINALITY AS x(e, n) ORDER BY n LOOP
    INSERT INTO public.cockpit_request_parts(request_id, part, list_id, team, template_id, template_name, task_name,
      owner_rule, owner_clickup_id, owner_how, owner_label, owner_note, state)
    SELECT v_id, v_e->>'part', v_e->>'listId', v_e->>'team', v_e->>'templateId', v_e->>'templateName', v_e->>'taskName',
      g->>'owner_rule', CASE WHEN jsonb_typeof(v_e->'owner'->'clickupId') = 'number' THEN (v_e->'owner'->>'clickupId')::bigint END,
      v_e->'owner'->>'how', v_e->'owner'->>'label', v_e->'owner'->>'note', 'queued'
      FROM jsonb_array_elements(t.targets) g WHERE g->>'part' = v_e->>'part';
    INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key, kind, source_table, source_id, campaign_name, payload)
    VALUES ('request:' || v_id::text || ':' || (v_e->>'part'), 'request', 'cockpit_requests', v_id::text, NULL,
            v_e->'payload' || CASE WHEN v_comment IS NOT NULL THEN jsonb_build_object('taskComment', v_comment) ELSE '{}'::jsonb END)
    RETURNING id INTO v_queue;
    UPDATE public.cockpit_request_parts SET queue_id = v_queue WHERE request_id = v_id AND part = v_e->>'part';
  END LOOP;
  PERFORM public.cockpit_request_audit('request.submitted', 'cockpit_requests', v_id::text, coalesce(v_email, 'forms-stage4'), NULL,
    (SELECT to_jsonb(q) - 'task_comment' FROM public.cockpit_requests q WHERE q.id = v_id),
    jsonb_build_object('type', t.key, 'type_version', t.version, 'source', 'form', 'response_id', p_response_id,
      'parts', (SELECT coalesce(jsonb_agg(e->>'part' ORDER BY n), '[]'::jsonb) FROM jsonb_array_elements(v_plan) WITH ORDINALITY AS x(e, n)))
    || CASE WHEN v_comment IS NOT NULL THEN jsonb_build_object('taskCommentChars', char_length(v_comment)) ELSE '{}'::jsonb END);
  BEGIN
    PERFORM public.cockpit_clickup_requests_kick();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  RETURN jsonb_build_object('ok', true, 'requestId', v_id, 'reused', false, 'parts', jsonb_array_length(v_plan));
END $$;

-- The planner: 20261102j's, except that a system request (the onboarding tasks, the Brand DNA task) is
-- handed the plan's comment_text beside its details.
CREATE OR REPLACE FUNCTION public.cockpit_form_stage4_plan(p_response_id uuid, p_apply boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.cockpit_form_responses;
  f public.cockpit_forms;
  v_input jsonb;
  v_built jsonb;
  v_v2 jsonb;
  v_live boolean;
  v_canary boolean;
  v_once timestamptz;
  b jsonb;
  spec jsonb;
  v_owner text;
  v_state text;
  v_reason text;
  e public.cockpit_form_effects;
  v_out jsonb := '[]'::jsonb;
  v_ref text;
  v_qstate text;
  v_qerror text;
  v_payload jsonb;
  v_res jsonb;
  v_event bigint;
  v_text text;
  v_prev text := current_setting('cockpit.forms_action', true);
BEGIN
  SELECT * INTO r FROM public.cockpit_form_responses x WHERE x.id = p_response_id;
  IF r.id IS NULL OR r.form_key NOT IN ('kickoff','onboarding') OR r.form_version < 2 OR r.task_id IS NULL
     OR r.state NOT IN ('submitted','confirmed') THEN
    RETURN jsonb_build_object('planned', false, 'reason', 'Only a native kickoff or onboarding answer on a card is planned.', 'effects', '[]'::jsonb);
  END IF;
  SELECT * INTO f FROM public.cockpit_forms x WHERE x.key = r.form_key;
  v_v2 := public.cockpit_form_stage4_effects(r.form_key, 2);
  v_live := f.effects = v_v2 AND f.provider = 'native';
  v_canary := r.task_id = '86eywg1cq';
  v_input := public.cockpit_form_stage4_input(r.id);
  v_built := public.cockpit_form_stage4_build(v_input);
  -- Once per card (4.14.3): an onboarding answer after another stored answer or kickoff plans nothing.
  -- The test card's rehearsal answer (a canary invite, stored shadow) is exempt: the kickoff canary
  -- may already have left a kickoff on that card.
  IF r.form_key = 'onboarding' AND NOT (v_canary AND r.mode = 'shadow') THEN
    v_once := public.cockpit_form_stage4_answered_at(r.task_id, r.id, v_input->>'readModelResponseId');
  END IF;

  FOR spec IN SELECT x FROM jsonb_array_elements(v_v2) WITH ORDINALITY AS u(x, n) ORDER BY n LOOP
    SELECT x INTO b FROM jsonb_array_elements(v_built) x WHERE x->>'key' = spec->>'key';
    v_owner := CASE
      WHEN spec->>'owner' = 'shadow' THEN 'shadow'
      WHEN v_live THEN coalesce(public.cockpit_form_effect_owner(r.form_key, spec->>'key'), 'make')
      WHEN v_canary THEN spec->>'owner'
      ELSE 'make' END;
    IF r.mode = 'shadow' AND NOT v_canary THEN v_owner := 'shadow'; END IF;
    v_reason := NULL;
    IF v_owner <> 'cockpit' THEN
      v_state := CASE WHEN v_owner = 'shadow' AND spec->>'key' <> 'recap' THEN 'skipped' ELSE 'dry_run' END;
      v_reason := CASE v_owner WHEN 'make' THEN 'Make does this until the go-live.'
                               ELSE coalesce(b->>'skip', 'A rehearsal answer: nothing is written.') END;
    ELSIF v_once IS NOT NULL THEN
      v_state := 'skipped';
      v_reason := 'This client already answered on ' || public.cockpit_form_day_words(v_once) || ', so nothing runs again.';
    ELSIF b->>'skip' IS NOT NULL THEN
      v_state := 'skipped';
      v_reason := b->>'skip';
    ELSE
      v_state := 'planned';
    END IF;
    IF NOT coalesce(p_apply, false) THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', spec->>'key', 'delivery', spec->>'delivery', 'owner', v_owner,
        'state', CASE WHEN v_state = 'planned' AND b->>'missing' IS NOT NULL THEN 'failed' ELSE v_state END,
        'reason', coalesce(v_reason, b->>'missing'), 'plan', b->'plan'));
      CONTINUE;
    END IF;

    PERFORM set_config('cockpit.forms_action', 'forms.stage4_planned', true);
    INSERT INTO public.cockpit_form_effects(response_id, form_key, effect_key, dedupe_key, owner, delivery, plan, state, reason)
    VALUES (r.id, r.form_key, spec->>'key', r.id::text || ':' || (spec->>'key'), v_owner, spec->>'delivery',
            coalesce(b->'plan', '{}'::jsonb), v_state, left(v_reason, 240))
    ON CONFLICT (response_id, effect_key) DO NOTHING
    RETURNING * INTO e;
    IF e.id IS NULL OR e.state <> 'planned' THEN
      SELECT * INTO e FROM public.cockpit_form_effects x WHERE x.response_id = r.id AND x.effect_key = spec->>'key';
      v_out := v_out || jsonb_build_array(jsonb_build_object('key', e.effect_key, 'delivery', e.delivery, 'owner', e.owner,
        'state', e.state, 'reason', e.reason));
      e := NULL;
      CONTINUE;
    END IF;

    -- Dispatch one planned effect; an error keeps it planned with the error as its reason.
    BEGIN
      PERFORM set_config('cockpit.forms_action', 'forms.effect_dispatched', true);
      IF b->>'missing' IS NOT NULL THEN
        UPDATE public.cockpit_form_effects x SET state = 'failed', reason = left(b->>'missing', 240) WHERE x.id = e.id;

      ELSIF e.delivery = 'clickup_queue' THEN
        v_payload := jsonb_build_object('formKey', r.form_key, 'responseId', r.id, 'effectId', e.id, 'effectKey', e.effect_key,
                       'taskId', r.task_id, 'clientName', v_input->>'client')
                     || (e.plan - 'lines' - 'comment_text');
        IF jsonb_typeof(e.plan->'comment_text') = 'string' THEN
          v_payload := v_payload || jsonb_build_object(
            'commentChars', char_length(e.plan->>'comment_text'),
            'commentSha256', encode(pg_catalog.sha256(convert_to(e.plan->>'comment_text', 'UTF8')), 'hex'));
        END IF;
        INSERT INTO public.cockpit_clickup_writeback_queue(dedupe_key, kind, source_table, source_id, task_id, payload)
        VALUES (e.dedupe_key, 'form', 'cockpit_form_effects', e.id::text, r.task_id, v_payload)
        ON CONFLICT (dedupe_key) DO NOTHING;
        SELECT q.id::text, q.state, q.error INTO v_ref, v_qstate, v_qerror
          FROM public.cockpit_clickup_writeback_queue q WHERE q.dedupe_key = e.dedupe_key;
        UPDATE public.cockpit_form_effects x
           SET state = 'queued', delivery_ref = v_ref, receipt = jsonb_build_object('queueId', v_ref), reason = NULL
         WHERE x.id = e.id;

      ELSIF e.delivery = 'client_message' THEN
        v_text := b->'plan'->>'body';
        INSERT INTO public.cockpit_client_messages(dedupe_key, task_id, client_name, kind, response_id, body, body_sha256)
        VALUES (e.dedupe_key, r.task_id, v_input->>'client', b->'plan'->>'kind', r.id, v_text,
                encode(pg_catalog.sha256(convert_to(v_text, 'UTF8')), 'hex'))
        ON CONFLICT (dedupe_key) DO NOTHING;
        SELECT m.id::text INTO v_ref FROM public.cockpit_client_messages m WHERE m.dedupe_key = e.dedupe_key;
        UPDATE public.cockpit_form_effects x
           SET state = 'queued', delivery_ref = v_ref, receipt = jsonb_build_object('messageId', v_ref),
               reason = 'Waiting for the CSM''s approval.'
         WHERE x.id = e.id;

      ELSIF e.delivery = 'slack_notice' THEN
        SELECT n.id::text, n.state, n.error INTO v_ref, v_qstate, v_qerror
          FROM public.cockpit_slack_notices n WHERE n.dedupe_key = b->'plan'->>'dedupe';
        IF v_ref IS NULL THEN
          UPDATE public.cockpit_form_effects x
             SET state = 'failed', reason = 'No kickoff notice was queued: this client has no onboarding record in the cockpit yet.'
           WHERE x.id = e.id;
        ELSE
          UPDATE public.cockpit_form_effects x
             SET state = 'queued', delivery_ref = v_ref, receipt = jsonb_build_object('noticeId', v_ref), reason = NULL
           WHERE x.id = e.id;
          IF v_qstate IN ('posted','failed','unknown','skipped','muted') THEN
            PERFORM public.cockpit_form_effects_settle('slack_notice', v_ref,
              CASE v_qstate WHEN 'posted' THEN 'delivered' WHEN 'muted' THEN 'skipped' ELSE v_qstate END,
              CASE WHEN v_qstate = 'muted' THEN 'The kickoff notice is off in Notices and routing.' ELSE v_qerror END,
              jsonb_build_object('table', 'cockpit_slack_notices', 'id', v_ref, 'state', v_qstate, 'at', now()), false);
          END IF;
        END IF;

      ELSIF e.delivery = 'relay' THEN
        INSERT INTO public.cockpit_form_relay_outbox(response_id, effect_key, task_id, payload, dedupe_key)
        VALUES (r.id, e.effect_key, r.task_id, coalesce(b->'plan'->'payload', '{}'::jsonb), 'relay:' || r.id::text || ':' || e.effect_key)
        ON CONFLICT (dedupe_key) DO NOTHING;
        SELECT o.id::text INTO v_ref FROM public.cockpit_form_relay_outbox o WHERE o.dedupe_key = 'relay:' || r.id::text || ':' || e.effect_key;
        UPDATE public.cockpit_form_effects x
           SET state = 'queued', delivery_ref = v_ref, receipt = jsonb_build_object('relayId', v_ref), reason = NULL
         WHERE x.id = e.id;

      ELSIF e.effect_key IN ('onboarding_tasks','brand_dna_task') THEN
        -- The comment each task gets once it is made goes beside the details, never in them.
        v_res := public.cockpit_request_create_system(b->'plan'->>'typeKey', r.task_id,
                   jsonb_build_object('details', b->'plan'->>'details', 'comment_text', b->'plan'->>'comment_text'), r.id);
        IF coalesce((v_res->>'ok')::boolean, false) THEN
          UPDATE public.cockpit_form_effects x
             SET state = 'delivered', delivery_ref = v_res->>'requestId', receipt = v_res, reason = NULL WHERE x.id = e.id;
        ELSIF v_res->>'skipped' IS NOT NULL THEN
          UPDATE public.cockpit_form_effects x
             SET state = 'skipped', delivery_ref = v_res->>'requestId', receipt = v_res, reason = left(v_res->>'skipped', 240) WHERE x.id = e.id;
        ELSE
          UPDATE public.cockpit_form_effects x SET state = 'failed', receipt = v_res, reason = left(v_res->>'missing', 240) WHERE x.id = e.id;
        END IF;

      ELSIF e.effect_key = 'new_mrr' THEN
        v_event := public.cockpit_form_stage4_mrr(r.id, b->'plan');
        UPDATE public.cockpit_form_effects x
           SET state = 'delivered', delivery_ref = v_event::text, receipt = jsonb_build_object('eventId', v_event), reason = NULL
         WHERE x.id = e.id;

      ELSIF e.effect_key = 'read_model' THEN
        v_text := public.cockpit_form_stage4_read_model(r.task_id, 'onboarding', b->'plan'->'entry');
        UPDATE public.cockpit_form_effects x
           SET state = CASE WHEN v_text = 'written' THEN 'delivered' ELSE 'skipped' END,
               receipt = jsonb_build_object('readModel', v_text),
               reason = CASE v_text WHEN 'no_row' THEN 'This client has no onboarding record in the cockpit yet.'
                                    WHEN 'newer_kept' THEN 'The client record already holds a newer onboarding answer.' END
         WHERE x.id = e.id;
      ELSE
        UPDATE public.cockpit_form_effects x SET state = 'failed', reason = 'This effect has no writer.' WHERE x.id = e.id;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      PERFORM public.cockpit_form_effect_note(e.id, left(SQLERRM, 240));
    END;
    SELECT * INTO e FROM public.cockpit_form_effects x WHERE x.id = e.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('key', e.effect_key, 'delivery', e.delivery, 'owner', e.owner,
      'state', e.state, 'reason', e.reason));
    e := NULL;
  END LOOP;
  PERFORM set_config('cockpit.forms_action', coalesce(v_prev, ''), true);
  RETURN jsonb_build_object('planned', true, 'live', v_live, 'canary', v_canary AND NOT v_live, 'effects', v_out);
END $$;

-- ---------------------------------------------------------------------------
-- 7. Privileges: every function here is the owner's only, as 20261102j left them.

REVOKE ALL ON FUNCTION public.cockpit_form_stage4_make_text(text,text), public.cockpit_form_stage4_handoff_text(jsonb,jsonb),
  public.cockpit_form_stage4_profile_text(jsonb), public.cockpit_form_stage4_raw_answers_text(jsonb,jsonb),
  public.cockpit_form_stage4_fields(text), public.cockpit_form_stage4_hidden(text),
  public.cockpit_form_stage4_typeform_answers(text,jsonb), public.cockpit_form_stage4_build(jsonb),
  public.cockpit_request_create_system(text,text,jsonb,uuid), public.cockpit_form_stage4_plan(uuid,boolean)
  FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
