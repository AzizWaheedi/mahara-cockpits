-- The client page's "Before the call" brief reads the client's ClickUp card
-- digests (the comment watch's summary, next steps, risks and client
-- requests). The client profile keeps only the newest three, so a busy week
-- of notes hid the last call's next steps. This read returns the newest
-- twelve from the last 90 days for one client, behind the same per-client
-- gate as the call timeline. It also names the team's Meta users (anyone
-- who changed two or more clients' ads in 90 days, plus every name on the
-- people roster and the cockpit seats; only names are read), so the brief
-- can tell a change the client made
-- themselves from one the team made. No new table, no table grant.
CREATE OR REPLACE FUNCTION public.cockpit_csm_client_digests(p_task_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE g jsonb; v jsonb; t jsonb;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'kind', x.kind, 'at', x.at_ms, 'by', x.data->>'by',
      'summary', x.data->'digest'->>'summary',
      'nextSteps', coalesce(x.data->'digest'->'nextSteps', '[]'::jsonb),
      'risks', coalesce(x.data->'digest'->'risks', '[]'::jsonb),
      'clientRequests', coalesce(x.data->'digest'->'clientRequests', '[]'::jsonb),
      'dos', coalesce(x.data->'digest'->'dos', '[]'::jsonb),
      'donts', coalesce(x.data->'digest'->'donts', '[]'::jsonb)
    ) ORDER BY x.at_ms DESC), '[]'::jsonb)
    INTO v
    FROM (
      SELECT s.data, s.data->>'kind' AS kind,
             CASE WHEN s.data->>'at' ~ '^[0-9]{10,16}$' THEN (s.data->>'at')::bigint END AS at_ms
        FROM public.cockpit_media_sources s
       WHERE s.table_name = 'clientComments'
         AND s.data->>'taskId' = p_task_id
         AND jsonb_typeof(s.data->'digest') = 'object'
         AND s.data->>'at' ~ '^[0-9]{10,16}$'
         AND (s.data->>'at')::bigint > (extract(epoch FROM now() - interval '90 days') * 1000)::bigint
       ORDER BY (s.data->>'at')::bigint DESC
       LIMIT 12) x;
  SELECT coalesce(jsonb_agg(DISTINCT a), '[]'::jsonb) INTO t FROM (
    SELECT actor AS a FROM public.cockpit_csm_changes
     WHERE actor IS NOT NULL AND at > now() - interval '90 days'
     GROUP BY actor HAVING count(DISTINCT task_id) >= 2
    UNION
    SELECT name FROM public.cockpit_members WHERE coalesce(btrim(name), '') <> ''
    UNION
    SELECT name FROM public.cockpit_people WHERE coalesce(btrim(name), '') <> '') x;
  RETURN jsonb_build_object('taskId', p_task_id, 'clientName', g->>'clientName', 'digests', v,
    'teamActors', t, 'at', now());
END $function$;

REVOKE ALL ON FUNCTION public.cockpit_csm_client_digests(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_client_digests(text) TO authenticated;
