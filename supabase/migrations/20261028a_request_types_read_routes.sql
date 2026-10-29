-- Requests: every seat reads when each part of a request type runs and the
-- SOP steps it adds (2026-10-28, Creative Triage bldgtotkfmhoxmlzowdx).
--
-- Live body, read only on 2026-10-28: public.cockpit_request_types_read()
-- prosrc md5 2f12d9541235919c176db2c0cc400f95 (pg_get_functiondef md5
-- 985e749039f893240dad242f967cc59a), byte for byte its body in
-- 20261026r_requests.sql. Check it has not moved before applying:
--   SELECT md5(prosrc) FROM pg_catalog.pg_proc
--    WHERE oid = 'public.cockpit_request_types_read()'::regprocedure;
-- The file checks it too: it refuses, and changes nothing, when the live body
-- is neither that one nor this file's own (prosrc md5
-- 130d4b4d67d1e6ee32c9ed55f33c8f21), so a change made since is never
-- overwritten and a second run changes nothing.
--
-- Why: the request form's redesign (tickets-look-1028, "The department map")
-- marks the question that decides where a request goes and lists the steps
-- an owner will work through, before Send. Today only editors read either
-- fact (as targets and sopSteps), so the form could only guess from the
-- preview's "Pick ... to see where it goes." note. This file adds two keys to
-- every element of each type's "parts" (TypePartView, contract 2.5), for
-- every seat:
--
--   "when"   null when the part always runs, else
--            {"fieldKey": "<the type's choice question key>",
--             "options": [{"id": "<option id>", "name": "<option name>"}]}:
--            the choices of that question that make the part run, with the
--            ids, names and order of that question's own choices in the same
--            answer (cockpit_request_field_options, where the form's choices
--            come from). A choice the question no longer offers is left out,
--            so a question ClickUp could not be read gives "options": [].
--   "steps"  null when the part uses a ClickUp template (also WhatsApp
--            connection issue, whose fallback steps go only when its template
--            brings no checklist), else the type's SOP steps in order, drafts
--            included (stepsDraft already says so): the checklist the writer
--            adds. Its length is the part's stepCount.
--
-- One statement is added to the live body, after the types are read; the
-- rest is carried forward exactly: the seat gate, SECURITY DEFINER with an
-- empty search path, the editors' fields, the order of types and parts, and
-- every other key of the answer, byte for byte. The grant is revoked and
-- given again exactly as it is live (authenticated only).
--
-- Not in scope: cockpit_request_type_view and every other function are not
-- touched, so the preview, the send, the writer, the type editor's save and
-- restore answers and the alerts are as before. No table, row or grant of any
-- other object changes. A database without this file sends neither key; the
-- form then shows no routing marks and only the step count.
--
-- How we know it works: apps/media-buyer-cockpit/scripts/request-routes-supabase.test.ts
-- applies it twice on top of 20261026r and 20261026s and checks every seat's
-- parts (Low schedule rate's two, Create an ad account's three, the
-- unconditional ones, the steps of every type), that both keys say what
-- cockpit_request_plan makes (the parts each choice runs, the checklist the
-- writer adds), the old body's answer with the two keys taken out, the grant
-- and the guard. apps/media-buyer-cockpit/scripts/requests-fit-supabase.test.ts
-- applies it with r, s and t, twice in order, and reads both keys through the
-- portal's own client: each choice's tasks against the preview, the steps
-- against the checklist the writer makes in ClickUp, and the form after this
-- file's rollback. Both tests run in scripts/ship.sh's requests block.
--
-- Read-back after applying: the md5 above for this file's body; the grant
-- {postgres=X/postgres,authenticated=X/postgres} unchanged; a seat's form
-- shows the routing marks of Low schedule rate and Create an ad account.
-- Rollback: run the types read definition of 20261026r_requests.sql again
-- (its lines 1742 to 1767; CREATE OR REPLACE keeps the grant), then
-- NOTIFY pgrst, 'reload schema'. Nothing to re-run. Safe to apply twice.

BEGIN;

DO $$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_request_types_read()');
  IF v_md5 IS NULL OR v_md5 NOT IN ('2f12d9541235919c176db2c0cc400f95', '130d4b4d67d1e6ee32c9ed55f33c8f21') THEN
    RAISE EXCEPTION 'cockpit_request_types_read is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_request_types_read()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_seat jsonb := public.cockpit_request_seat();
  v_editor boolean := (v_seat->>'isEditor')::boolean;
  v_writer jsonb := public.cockpit_request_writer_view(v_seat, NULL);
  v_types jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(public.cockpit_request_type_view(t, v_editor)
           ORDER BY public.cockpit_request_team_order(t.team), t.type_index), '[]'::jsonb)
    INTO v_types FROM public.cockpit_request_types t WHERE t.enabled OR v_editor;
  -- Every seat also reads, on each part, when it runs and the SOP steps it adds
  -- (20261028a). "when": null when the part always runs, else the key of the
  -- choice question that decides it and the choices that make it run, with the
  -- ids, names and order of that question's choices in "fields" above.
  -- "steps": null when the part uses a ClickUp template, else the type's SOP
  -- steps in order, drafts included: the checklist the writer adds. No type or
  -- part is added, dropped or moved, and no other key changes.
  SELECT coalesce(jsonb_agg(v.e || jsonb_build_object('parts', coalesce((
           SELECT jsonb_agg(CASE WHEN g.e IS NULL THEN p.e ELSE p.e || jsonb_build_object(
                    'when', CASE WHEN g.e->'when' IS NULL OR jsonb_typeof(g.e->'when') = 'null' THEN NULL
                              ELSE jsonb_build_object('fieldKey', g.e->'when'->>'field_key', 'options', coalesce((
                                SELECT jsonb_agg(jsonb_build_object('id', o.e->>'id', 'name', o.e->>'name') ORDER BY o.n)
                                  FROM jsonb_array_elements(public.cockpit_request_field_options((
                                         SELECT f.e FROM jsonb_array_elements(t.fields) WITH ORDINALITY AS f(e, n)
                                          WHERE f.e->>'key' = g.e->'when'->>'field_key' ORDER BY f.n LIMIT 1)))
                                       WITH ORDINALITY AS o(e, n)
                                 WHERE o.e->>'id' IN (SELECT jsonb_array_elements_text(
                                         CASE WHEN jsonb_typeof(g.e->'when'->'options') = 'array'
                                              THEN g.e->'when'->'options' ELSE '[]'::jsonb END))), '[]'::jsonb)) END,
                    'steps', CASE WHEN g.e->>'template_id' IS NULL THEN coalesce(t.sop_steps, '[]'::jsonb) END) END
                  ORDER BY p.n)
             FROM jsonb_array_elements(v.e->'parts') WITH ORDINALITY AS p(e, n)
             LEFT JOIN LATERAL (SELECT x.e FROM jsonb_array_elements(t.targets) WITH ORDINALITY AS x(e, n)
                                 WHERE x.e->>'part' = p.e->>'part' ORDER BY x.n LIMIT 1) g ON true), '[]'::jsonb))
         ORDER BY v.n), '[]'::jsonb)
    INTO v_types
    FROM jsonb_array_elements(v_types) WITH ORDINALITY AS v(e, n)
    LEFT JOIN public.cockpit_request_types t ON t.key = v.e->>'key';
  RETURN jsonb_build_object('asOf', now(),
    'seat', jsonb_build_object('label', v_seat->>'label', 'link', v_seat->>'link', 'teams', v_seat->'teams',
      'editor', v_editor,
      'all', v_editor OR (v_seat->>'isAdmin')::boolean OR (v_seat->>'isCeo')::boolean),
    'writer', v_writer,
    'types', v_types)
    -- Editors pick fields and templates from what ClickUp last showed.
    || CASE WHEN v_editor THEN jsonb_build_object(
         'catalog', coalesce((SELECT jsonb_agg(jsonb_build_object('clickupFieldId', c.clickup_field_id, 'clickupName', c.clickup_name,
                       'label', c.label, 'kind', c.kind, 'options', c.options, 'state', c.state) ORDER BY lower(c.label), c.clickup_field_id)
                     FROM public.cockpit_request_field_catalog c), '[]'::jsonb),
         'templates', coalesce((SELECT jsonb_agg(jsonb_build_object('id', tp.id, 'name', tp.name, 'state', tp.state) ORDER BY lower(tp.name), tp.id)
                       FROM public.cockpit_request_templates tp), '[]'::jsonb))
       ELSE '{}'::jsonb END;
END $$;

-- The grant as it is live: revoked from all four roles, then the screens' one.
REVOKE ALL ON FUNCTION public.cockpit_request_types_read() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_request_types_read() TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
