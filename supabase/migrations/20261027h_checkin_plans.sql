-- The shadow planner: what one 1-1 notes submit would do (docs/forms/STAGE2-CONTRACT.md
-- sections 2.3 and 7). Creative Triage (bldgtotkfmhoxmlzowdx). Additive; applies twice.
-- Migration x of three, after 20261027f_forms_core (v) and 20261027g_fathom_intake (w).
--
-- cockpit_form_checkin_plan turns a check-in response into the eight plans of
-- section 7.1, in registry order, with Make's exact payloads: the notes row
-- where the client brief reads them (call_form), the recording on the client
-- (call_match), the to-do comment, Client Happiness, Last POC, Last Check-in
-- Call, the call grade notice and the recap. v's submit writes one effect row
-- per plan; while the registry's checkin provider is not native every effect
-- is a shadow (dry_run or skipped), so nothing here reaches a card, Slack or a
-- client. The other five functions build the write-through answers (7.2), the
-- comment text, the option ids and the dates.
--
-- Every function is internal: SECURITY DEFINER with an empty search path, and
-- no role may execute it (v's submit and its SQL-effect executor call them).
-- The planner is plpgsql, so it is resolved when it runs.
BEGIN;

-- A date-only value as ClickUp takes it: 09:00 UTC on the day, in milliseconds
-- (the billing.ts form). ClickUp keeps the London date, which is the day given.
CREATE OR REPLACE FUNCTION public.cockpit_form_epoch_day(p_day date)
RETURNS bigint LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (extract(epoch FROM p_day::timestamp + interval '9 hours') * 1000)::bigint
$$;

-- A time inside the call: M:SS under an hour, H:MM:SS from an hour.
CREATE OR REPLACE FUNCTION public.cockpit_form_clock(p_seconds integer)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_seconds IS NULL OR p_seconds < 0 THEN NULL
    WHEN p_seconds < 3600 THEN (p_seconds / 60)::text || ':' || lpad((p_seconds % 60)::text, 2, '0')
    ELSE (p_seconds / 3600)::text || ':' || lpad((p_seconds % 3600 / 60)::text, 2, '0')
         || ':' || lpad((p_seconds % 60)::text, 2, '0')
  END
$$;

-- Client Happiness takes the option id, never the label: the six DEFCON labels
-- as Make [21]'s switch() writes them, equal to the live field's options.
CREATE OR REPLACE FUNCTION public.cockpit_form_happiness_option(p_label text)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE p_label
    WHEN 'Paused' THEN '67c08bcd-e629-47ab-85ba-3ac4b3796734'
    WHEN 'At Risk' THEN 'f0623c2a-161d-4aa2-8833-d1337c69e1c2'
    WHEN 'Neutral' THEN '46e595a3-17d7-4835-80f9-8a4c578b72a3'
    WHEN 'Happy' THEN 'c5d6b01f-5f2b-40c1-afac-5b9f1efab213'
    WHEN 'Very Happy (testimonial)' THEN 'd403adf4-24aa-40f0-a960-05e6a4621ee9'
    WHEN 'Churned' THEN '1c055070-45d6-4a19-ade3-958851313d7c'
  END
$$;

-- The write-through answers (7.2), with the Typeform's refs, types and titles,
-- so the client brief reads the native row as it reads a Typeform row
-- (formAnswer by title; OWNER_OURS and OWNER_THEIRS split Additional Notes).
-- Additional Notes holds one "Mahara: " line per We owe item, then one
-- "Client: " line per They owe item. The brief splits a note at an inline
-- " - " or " • " and drops a line that ends with a colon, so inside an item
-- such a dash becomes a comma and a closing colon or a leading list mark is
-- dropped: each item is written as one line, on its side. The brief also
-- joins a line of fewer than four words to the next one, reading Client Notes
-- first, so an item of one or two words, or a short last Client Notes line,
-- still lands with its neighbour. Only the brief can change that without
-- changing the CSM's words; it is open before 2b
-- (checkin-plans-supabase.test.ts).
CREATE OR REPLACE FUNCTION public.cockpit_form_checkin_legacy(p_answers jsonb, p_task_id text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a jsonb := CASE WHEN jsonb_typeof(p_answers) = 'object' THEN p_answers ELSE '{}'::jsonb END;
  v_share text := CASE WHEN a->'call'->>'kind' = 'fathom' THEN nullif(btrim(a->'call'->>'shareUrl'), '') END;
  v_notes text := CASE WHEN jsonb_typeof(a->'client_notes') = 'string' THEN nullif(btrim(a->>'client_notes'), '') END;
  v_lines text;
  v jsonb;
BEGIN
  SELECT string_agg(z.prefix || z.t, E'\n' ORDER BY z.side, z.n) INTO v_lines
    FROM (SELECT s.side, s.prefix, q.n,
                 btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(q.x->>'text', '\s+', ' ', 'g'),
                   '^\s*(?:[-*•]|\d+[.)])\s+', ''), '\s+[-•]\s+', ', ', 'g'), '\s*[:：]+\s*$', '')) AS t
            FROM (VALUES (1, 'we_owe', 'Mahara: '), (2, 'they_owe', 'Client: ')) s(side, key, prefix)
           CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a->s.key) = 'array' THEN a->s.key
                                                        ELSE '[]'::jsonb END) WITH ORDINALITY q(x, n)
           WHERE jsonb_typeof(q.x) = 'object' AND jsonb_typeof(q.x->'text') = 'string') z
   WHERE z.t <> '';

  v := jsonb_build_array(jsonb_build_object('ref', 'c484f390-9695-4ffa-9693-9cc219592713', 'type', 'short_text',
         'title', 'Client ID', 'value', p_task_id));
  IF v_share IS NOT NULL THEN
    v := v || jsonb_build_array(jsonb_build_object('ref', 'cockpit:call', 'type', 'url',
           'title', 'Call recording', 'value', v_share));
  END IF;
  IF v_lines IS NOT NULL THEN
    v := v || jsonb_build_array(jsonb_build_object('ref', '82a6b434-15d9-4a14-8496-c20c94628536', 'type', 'long_text',
           'title', 'Additional Notes', 'value', v_lines));
  END IF;
  IF v_notes IS NOT NULL THEN
    v := v || jsonb_build_array(jsonb_build_object('ref', '5d071906-da6a-4413-a729-0c76d0188d91', 'type', 'long_text',
           'title', 'Client Notes', 'value', v_notes));
  END IF;
  RETURN v || jsonb_build_array(
    jsonb_build_object('ref', 'ff7970f7-9fad-4fa5-b12b-4d719dfb7587', 'type', 'multiple_choice',
      'title', 'Defcon Status', 'value', a->'defcon'),
    jsonb_build_object('ref', 'c9f99fb1-fec9-47e7-9baa-c5554733723d', 'type', 'multiple_choice',
      'title', 'Task Priority', 'value', a->'priority'));
END $$;

-- The to-do comment the card gets (7.1): plain text, no ** and no #. The
-- recording link first (or "No recording for this call."), then Mahara's lines
-- with their owner and time, the client's lines with their time, and the role
-- that wrote the notes with the call's day. A section with no item is left
-- out; the 2b writer appends its "Cockpit ref" line.
CREATE OR REPLACE FUNCTION public.cockpit_form_checkin_comment(p_answers jsonb, p_by text, p_day date)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a jsonb := CASE WHEN jsonb_typeof(p_answers) = 'object' THEN p_answers ELSE '{}'::jsonb END;
  v_share text := CASE WHEN a->'call'->>'kind' = 'fathom'
                       THEN nullif(btrim(regexp_replace(a->'call'->>'shareUrl', '[?#].*$', '')), '') END;
  v_ours text[];
  v_theirs text[];
  v_lines text[];
BEGIN
  SELECT array_agg('- ' || z.t || CASE WHEN z.extra <> '' THEN ' (' || z.extra || ')' ELSE '' END ORDER BY z.n)
         FILTER (WHERE z.side = 1),
         array_agg('- ' || z.t || CASE WHEN z.extra <> '' THEN ' (' || z.extra || ')' ELSE '' END ORDER BY z.n)
         FILTER (WHERE z.side = 2)
    INTO v_ours, v_theirs
    FROM (SELECT y.side, y.n, y.t,
                 -- The client's lines carry their time only.
                 concat_ws(', ', CASE WHEN y.side = 1 THEN y.owner END, public.cockpit_form_clock(y.at)) AS extra
            FROM (SELECT s.side, q.n,
                         btrim(regexp_replace(regexp_replace(regexp_replace(q.x->>'text', '\*{2,}|#', '', 'g'),
                           '\s+', ' ', 'g'), '^(?:[-*•]|\d+[.)])\s+', '')) AS t,
                         nullif(btrim(regexp_replace(regexp_replace(
                           CASE WHEN jsonb_typeof(q.x->'owner') = 'string' THEN q.x->>'owner' END,
                           '\*{2,}|#', '', 'g'), '\s+', ' ', 'g')), '') AS owner,
                         CASE WHEN jsonb_typeof(q.x->'at') = 'number' AND (q.x->>'at')::numeric BETWEEN 0 AND 86400
                              THEN floor((q.x->>'at')::numeric)::integer END AS at
                    FROM (VALUES (1, 'we_owe'), (2, 'they_owe')) s(side, key)
                   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a->s.key) = 'array' THEN a->s.key
                                                                ELSE '[]'::jsonb END) WITH ORDINALITY q(x, n)
                   WHERE jsonb_typeof(q.x) = 'object' AND jsonb_typeof(q.x->'text') = 'string') y
           WHERE y.t <> '') z;

  v_lines := ARRAY[coalesce('Call recording: ' || v_share, 'No recording for this call.'), ''];
  IF v_ours IS NOT NULL THEN v_lines := v_lines || '*Mahara owes*'::text || v_ours; END IF;
  IF v_theirs IS NOT NULL THEN v_lines := v_lines || '*The client owes*'::text || v_theirs; END IF;
  IF v_ours IS NOT NULL OR v_theirs IS NOT NULL THEN v_lines := v_lines || ''::text; END IF;
  RETURN array_to_string(v_lines || ('1-1 notes by ' || coalesce(nullif(btrim(p_by), ''), 'a team member')
    || ' in the cockpit' || coalesce(', '
      || (ARRAY['Sun','Mon','Tue','Wed','Thu','Fri','Sat'])[extract(dow FROM p_day)::integer + 1] || ' '
      || extract(day FROM p_day)::integer || ' '
      || (ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])[extract(month FROM p_day)::integer],
      '') || '.'), E'\n');
END $$;

-- The eight plans of one check-in submit (7.1), in registry order. Each is
-- {effect, delivery, state planned|skipped, reason, plan {..., lines}}; a
-- skipped plan says why in its reason and would do nothing, so its lines are
-- empty. Besides the response it reads the recording's call row and that
-- row's parent (where the notes link, and whether the recording is already on
-- this client), the ready grade of the recording, and the role of the seat
-- that sent the notes.
CREATE OR REPLACE FUNCTION public.cockpit_form_checkin_plan(p_response public.cockpit_form_responses)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.cockpit_form_responses := p_response;
  rc public.cockpit_csm_calls;
  a jsonb;
  v_call jsonb;
  v_kind text;
  v_rec text;
  v_share text;
  v_task text := p_response.task_id;
  v_client text := nullif(btrim(p_response.client_name), '');
  v_token text := 'cockpit:' || p_response.id::text;
  v_at timestamptz := coalesce(p_response.submitted_at, now());
  v_start timestamptz;
  v_end timestamptz;
  v_call_day date;
  v_checkin_day date;
  v_by text := public.cockpit_slack_notice_role_of(p_response.submitted_by);
  v_link bigint;
  v_after boolean := false;
  v_on_client boolean := false;
  v_ours integer;
  v_theirs integer;
  v_defcon text;
  v_option text;
  v_grade text;
  v_months text[] := ARRAY['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  v_plans jsonb;
  v_out jsonb := '[]'::jsonb;
  k text;
BEGIN
  IF r.form_key IS DISTINCT FROM 'checkin' THEN RETURN '[]'::jsonb; END IF;
  a := CASE WHEN jsonb_typeof(r.answers) = 'object' THEN r.answers ELSE '{}'::jsonb END;
  v_call := CASE WHEN jsonb_typeof(a->'call') = 'object' THEN a->'call' ELSE '{}'::jsonb END;
  v_kind := CASE WHEN v_call->>'kind' = 'fathom' AND (v_call->>'recordingId') ~ '^[0-9]{3,20}$' THEN 'fathom'
                 WHEN v_call->>'kind' = 'booking' THEN 'booking' ELSE 'none' END;
  v_rec := CASE WHEN v_kind = 'fathom' THEN v_call->>'recordingId' END;
  v_share := CASE WHEN v_kind = 'fathom' THEN nullif(btrim(v_call->>'shareUrl'), '') END;
  BEGIN
    v_start := (v_call->>'startsAt')::timestamptz;
  EXCEPTION WHEN others THEN v_start := NULL;
  END;
  BEGIN
    v_end := (v_call->>'endsAt')::timestamptz;
  EXCEPTION WHEN others THEN v_end := NULL;
  END;
  -- Last POC is the day the call ended (a recording) or started (a booking),
  -- else the day of the notes; Last Check-in Call the day it started.
  v_call_day := public.cockpit_form_kuwait_day(CASE v_kind WHEN 'fathom' THEN coalesce(v_end, v_start, v_at)
                                                           WHEN 'booking' THEN coalesce(v_start, v_at) ELSE v_at END);
  v_checkin_day := public.cockpit_form_kuwait_day(CASE WHEN v_kind IN ('fathom','booking') THEN coalesce(v_start, v_at)
                                                       ELSE v_at END);

  -- Where the notes link (the timeline shows a form under the call it links,
  -- and hides a row linked to a live parent on the same card): a recording's
  -- booking when its row is linked to one that is on this card and not gone,
  -- else the recording's own row; a recording with no row yet is linked by the
  -- executor after call_match has made one.
  IF v_kind = 'fathom' THEN
    SELECT * INTO rc FROM public.cockpit_csm_calls x WHERE x.source = 'fathom' AND x.source_id = v_rec;
    IF FOUND THEN
      v_on_client := rc.task_id IS NOT DISTINCT FROM v_task;
      v_link := CASE WHEN rc.linked_call_id IS NOT NULL AND EXISTS (
                            SELECT 1 FROM public.cockpit_csm_calls p
                             WHERE p.id = rc.linked_call_id AND p.task_id = v_task AND p.status <> 'gone')
                     THEN rc.linked_call_id ELSE rc.id END;
    ELSE
      v_after := true;
    END IF;
    -- One grade per call, whichever client's window started it.
    SELECT d.id::text INTO v_grade FROM public.cockpit_form_drafts d
     WHERE d.recording_id = v_rec AND d.kind = 'grade' AND d.state = 'ready'
     ORDER BY d.finished_at DESC NULLS LAST, d.started_at DESC LIMIT 1;
  ELSIF v_kind = 'booking' THEN
    v_link := CASE WHEN (v_call->>'callId') ~ '^[0-9]{1,18}$' THEN (v_call->>'callId')::bigint END;
  END IF;

  SELECT count(*) FILTER (WHERE s.side = 1), count(*) FILTER (WHERE s.side = 2) INTO v_ours, v_theirs
    FROM (VALUES (1, 'we_owe'), (2, 'they_owe')) s(side, key)
   CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(a->s.key) = 'array' THEN a->s.key ELSE '[]'::jsonb END) q(x)
   WHERE jsonb_typeof(q.x) = 'object' AND jsonb_typeof(q.x->'text') = 'string'
     AND btrim(regexp_replace(q.x->>'text', '\s+', ' ', 'g')) <> '';
  v_defcon := nullif(btrim(a->>'defcon'), '');
  v_option := public.cockpit_form_happiness_option(v_defcon);

  v_plans := jsonb_build_object(
    'call_form', jsonb_build_object('effect', 'call_form', 'delivery', 'sql', 'state', 'planned', 'reason', NULL,
      'plan', jsonb_build_object(
        'row', jsonb_build_object('token', v_token, 'form_id', 'cockpit-checkin', 'form_kind', 'checkin',
          'task_id', v_task, 'typed_client', NULL, 'matched_by', 'cockpit_form', 'submitted_at', v_at,
          'answers', public.cockpit_form_checkin_legacy(a, v_task), 'hidden', '{}'::jsonb,
          'recording_url', v_share, 'linked_call_id', v_link),
        'linkAfterMatch', v_after,
        'lines', jsonb_build_array('Would save the notes where the client brief and Today read them.'))),

    'call_match', CASE
      WHEN v_kind <> 'fathom' THEN jsonb_build_object('effect', 'call_match', 'delivery', 'sql', 'state', 'skipped',
        'reason', 'No recording to put on this client.',
        'plan', jsonb_build_object('taskId', v_task, 'lines', '[]'::jsonb))
      WHEN v_on_client THEN jsonb_build_object('effect', 'call_match', 'delivery', 'sql', 'state', 'skipped',
        'reason', 'The recording is already on this client.',
        'plan', jsonb_build_object('recordingId', v_rec, 'callId', rc.id, 'taskId', v_task, 'lines', '[]'::jsonb))
      ELSE jsonb_build_object('effect', 'call_match', 'delivery', 'sql', 'state', 'planned', 'reason', NULL,
        'plan', jsonb_build_object('recordingId', v_rec, 'callId', rc.id, 'taskId', v_task, 'method', 'manual',
          'lines', jsonb_build_array('Would put this recording on ' || coalesce(v_client, 'this client') || '.')))
    END,

    'todo_comment', CASE
      WHEN v_ours + v_theirs = 0 THEN jsonb_build_object('effect', 'todo_comment', 'delivery', 'clickup_queue',
        'state', 'skipped', 'reason', 'No comment: We owe and They owe are empty.',
        'plan', jsonb_build_object('taskId', v_task, 'items', 0, 'sides', jsonb_build_object('ours', 0, 'theirs', 0),
          'lines', '[]'::jsonb))
      ELSE jsonb_build_object('effect', 'todo_comment', 'delivery', 'clickup_queue', 'state', 'planned', 'reason', NULL,
        'plan', jsonb_build_object('taskId', v_task,
          'comment_text', public.cockpit_form_checkin_comment(a, v_by, v_call_day),
          'notify_all', false, 'items', v_ours + v_theirs,
          'sides', jsonb_build_object('ours', v_ours, 'theirs', v_theirs),
          'lines', jsonb_build_array('Would post the to-do comment on the card: ' || (v_ours + v_theirs)
            || CASE WHEN v_ours + v_theirs = 1 THEN ' line' ELSE ' lines' END
            || CASE WHEN v_share IS NOT NULL THEN ', recording link first.' ELSE '.' END)))
    END,

    -- DEFCON is required, so a submitted response always has its option.
    'happiness', CASE
      WHEN v_option IS NULL THEN jsonb_build_object('effect', 'happiness', 'delivery', 'clickup_queue',
        'state', 'skipped', 'reason', 'No Client Happiness option matches this DEFCON.',
        'plan', jsonb_build_object('taskId', v_task, 'lines', '[]'::jsonb))
      ELSE jsonb_build_object('effect', 'happiness', 'delivery', 'clickup_queue', 'state', 'planned', 'reason', NULL,
        'plan', jsonb_build_object('taskId', v_task, 'field', '4e3924e3-4898-4e98-aca1-cc1ac3015b73',
          'label', v_defcon, 'value', v_option,
          'lines', jsonb_build_array('Would set Client Happiness to '
            || upper(left(v_defcon, 1)) || lower(substr(v_defcon, 2)) || '.')))
    END,

    'last_poc', jsonb_build_object('effect', 'last_poc', 'delivery', 'clickup_queue', 'state', 'planned', 'reason', NULL,
      'plan', jsonb_build_object('taskId', v_task, 'field', 'e183f2ce-8b7a-491a-b160-2287a247758b',
        'day', v_call_day, 'value', public.cockpit_form_epoch_day(v_call_day),
        'value_options', jsonb_build_object('time', false), 'rule', 'forward_only',
        'lines', jsonb_build_array('Would set Last POC to ' || extract(day FROM v_call_day)::integer || ' '
          || v_months[extract(month FROM v_call_day)::integer] || ', only if the card''s date is older.'))),

    'last_checkin_call', jsonb_build_object('effect', 'last_checkin_call', 'delivery', 'clickup_queue',
      'state', 'planned', 'reason', NULL,
      'plan', jsonb_build_object('taskId', v_task, 'field', '032203ad-e327-4d76-a0ce-c07496da6486',
        'day', v_checkin_day, 'value', public.cockpit_form_epoch_day(v_checkin_day),
        'value_options', jsonb_build_object('time', false), 'rule', 'forward_only',
        'lines', jsonb_build_array('Would set Last Check-in Call to ' || extract(day FROM v_checkin_day)::integer || ' '
          || v_months[extract(month FROM v_checkin_day)::integer] || ', only if the card''s date is older.'))),

    -- The notice's own dedupe is per recording: one grade post per call,
    -- whichever response or seat planned it.
    'grade_notice', CASE
      WHEN v_kind <> 'fathom' THEN jsonb_build_object('effect', 'grade_notice', 'delivery', 'slack_notice',
        'state', 'skipped', 'reason', 'No grade: no recording for this call.',
        'plan', jsonb_build_object('taskId', v_task, 'lines', '[]'::jsonb))
      ELSE jsonb_build_object('effect', 'grade_notice', 'delivery', 'slack_notice', 'state', 'planned', 'reason', NULL,
        'plan', jsonb_build_object('kind', 'checkin.grade', 'target', 'C09SVG6FHGU', 'dedupe', 'grade:' || v_rec,
          'recordingId', v_rec,
          'facts', jsonb_build_object('responseId', r.id, 'recordingId', v_rec, 'taskId', v_task,
            'client', v_client, 'submittedAt', v_at),
          'grade', coalesce(v_grade, 'pending'),
          'lines', jsonb_build_array('Would post the call grade in #client-call-feedback.')))
    END,

    -- The recap is begun only after the send, from the sent They owe (6.5),
    -- so it has no draft at submit; the 2b dispatch finds it by response_id.
    'recap', CASE
      WHEN v_kind <> 'fathom' THEN jsonb_build_object('effect', 'recap', 'delivery', 'client_message',
        'state', 'skipped', 'reason', 'No recap: no recording for this call.',
        'plan', jsonb_build_object('taskId', v_task, 'lines', '[]'::jsonb))
      ELSE jsonb_build_object('effect', 'recap', 'delivery', 'client_message', 'state', 'planned', 'reason', NULL,
        'plan', jsonb_build_object('kind', 'recap_checkin', 'taskId', v_task, 'draftId', NULL,
          'bookingBlock', 'checkin', 'state', 'awaiting_approval',
          'lines', jsonb_build_array('Would hold the client''s recap for approval in the cockpit.')))
    END);

  -- A call with no recording keeps its notes on a call row of its own.
  IF v_kind = 'none' THEN
    v_plans := jsonb_set(v_plans, '{call_form,plan,ownCall}', jsonb_build_object(
      'source', 'checkin_form', 'source_id', v_token, 'task_id', v_task, 'client_name', v_client,
      'match_method', 'form_task_id', 'match_confidence', 1, 'kind', 'checkin',
      'title', 'Check-in call (1-1 notes in the cockpit)', 'starts_at', v_at,
      'status', 'held', 'provider_status', 'notes sent'));
  END IF;

  -- The registry's order; an effect the registry does not list goes last.
  FOR k IN
    SELECT z.key
      FROM unnest(ARRAY['call_form','call_match','todo_comment','happiness','last_poc','last_checkin_call',
                        'grade_notice','recap']) WITH ORDINALITY z(key, n)
      LEFT JOIN (SELECT q.e->>'key' AS key, min(q.o) AS o
                   FROM public.cockpit_forms f
                  CROSS JOIN LATERAL jsonb_array_elements(f.effects) WITH ORDINALITY q(e, o)
                  WHERE f.key = 'checkin' GROUP BY 1) reg ON reg.key = z.key
     ORDER BY coalesce(reg.o, 1000 + z.n)
  LOOP
    v_out := v_out || jsonb_build_array(v_plans->k);
  END LOOP;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.cockpit_form_epoch_day(date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_form_clock(integer) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_form_happiness_option(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_form_checkin_legacy(jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_form_checkin_comment(jsonb, text, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_form_checkin_plan(public.cockpit_form_responses)
  FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
