-- Exception alerts (plan item 4.1, approved by Muhammed 2026-10-26; Creative Triage
-- bldgtotkfmhoxmlzowdx). hermes/exception-alerts checks every active client once an
-- hour, flags only the broken ones and messages the client's owner with a link to the
-- right cockpit page. It rides the lead sync watch's existing cron line (no scheduler of
-- its own). Rules, floors and owners: hermes/exception-alerts/README.md.
--
-- cockpit_exception_state: one row per (rule, client), the current picture. The media
--   buyer's Today page lists the open ones. RLS: CEO, admins, and the media buyers
--   allowed on the client (the cockpit_lead_sync_status rule).
-- cockpit_exception_alerts: the alert ledger (plan shared service 3), modelled on
--   cockpit_lead_sync_alerts (20261014b). Keyed by rule, client and episode, one row per
--   person or channel. The row is claimed (INSERT ... ON CONFLICT DO NOTHING) before
--   every send: sending, sent, failed, unknown as in the model, plus dry (delivery is in
--   dry run, nothing was sent), queued (over the person's 5 a day, waits for the digest)
--   and mirror rows for the lead sync watch's own #tech-general posts, so its gap is
--   counted here without a second message. Service role only.
-- cockpit_exception_summary(): when the last check ran, whether it was clean and whether
--   messages are live, for the Today list's footer (the health row in cockpit_sync_state
--   has no browser policy). CEO, admins and media buyers; no client data.
-- cockpit_native_monitor: the reliability monitor's RPC gains one check,
--   worker:exception-alerts (last success from cockpit_sync_state key exception-alerts,
--   at most 150 minutes old, and no failed, unknown or stuck send in the ledger in the
--   last 24 hours; "failed" carries that count). It is
--   added only once the worker has written its first health row, so applying this file
--   before the release does not page. The live body is restated unchanged around it.
--
-- Missing is never zero: a count the worker could not read is null in evidence, and the
-- rule's state is unknown, never ok.
-- Not in scope: client-facing messages, the dialer alarms (2.4, 2.5), the media-buyer
-- owner field (4.2), any change to the lead sync watch's own ledger or posts.
-- How we know it works: hermes/exception-alerts/*.test.ts (rules, floors, two-run
-- confirm, ledger claims) and scripts/exception-alerts-supabase.test.ts (this file twice
-- on PGlite, RLS, the monitor check before and after a failed send).
-- Safe to run twice. Refuses, changing nothing, if the live cockpit_native_monitor body
-- is neither the one it was written against nor this file's.
-- Rollback: restore cockpit_native_monitor from 20261009n_native_monitor_speed.sql, then
-- DROP TABLE public.cockpit_exception_alerts, public.cockpit_exception_state.
BEGIN;
SET LOCAL lock_timeout = '5s';

DO $guard$
DECLARE v_md5 text;
BEGIN
  SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p
   WHERE p.oid = to_regprocedure('public.cockpit_native_monitor()');
  -- The live body (20261009n), and this file's body with LF or CRLF line endings.
  IF v_md5 IS NULL OR v_md5 NOT IN ('43733577ade5ca2b27cd6645d55b2482', '5fff65c518260d66473f4569a500a9f0', 'c947e5cc4a0c22489a111b04b14c8d64') THEN
    RAISE EXCEPTION 'cockpit_native_monitor is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file', coalesce(v_md5, 'missing');
  END IF;
END $guard$;

CREATE TABLE IF NOT EXISTS public.cockpit_exception_state (
  rule            text NOT NULL CHECK (rule IN ('zero_leads','cpb_over_line','campaign_stopped','lead_sync')),
  client_key      text NOT NULL,
  client_name     text NOT NULL,
  clickup_id      text,
  state           text NOT NULL CHECK (state IN ('ok','watch','open','too_little_data','unknown')),
  reason          text NOT NULL DEFAULT '',
  evidence        jsonb NOT NULL DEFAULT '{}'::jsonb,
  strikes         integer NOT NULL DEFAULT 0,
  clears          integer NOT NULL DEFAULT 0,
  episode_id      text,
  first_seen_at   timestamptz,
  opened_at       timestamptz,
  last_strike_at  timestamptz,
  link            text,
  delivery        jsonb NOT NULL DEFAULT '[]'::jsonb,
  checked_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (rule, client_key)
);

CREATE TABLE IF NOT EXISTS public.cockpit_exception_alerts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule            text NOT NULL CHECK (rule IN ('zero_leads','cpb_over_line','campaign_stopped','lead_sync','digest')),
  client_key      text NOT NULL,
  client_name     text NOT NULL,
  episode_id      text NOT NULL,
  recipient       text NOT NULL,
  recipient_name  text NOT NULL DEFAULT '',
  kind            text NOT NULL CHECK (kind IN ('alert','digest','mirror')),
  status          text NOT NULL CHECK (status IN ('sending','sent','failed','unknown','dry','queued')),
  alert_day       date NOT NULL,
  channel         text,
  slack_ts        text,
  digest_id       uuid,
  body            text NOT NULL,
  error           text,
  attempts        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  UNIQUE (rule, client_key, episode_id, recipient, kind)
);

CREATE INDEX IF NOT EXISTS cockpit_exception_alerts_day ON public.cockpit_exception_alerts (alert_day, recipient);
CREATE INDEX IF NOT EXISTS cockpit_exception_alerts_open ON public.cockpit_exception_alerts (status)
  WHERE status IN ('sending','unknown','failed','queued');

ALTER TABLE public.cockpit_exception_state  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_exception_alerts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.cockpit_exception_state, public.cockpit_exception_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cockpit_exception_state TO authenticated;
GRANT ALL ON public.cockpit_exception_state, public.cockpit_exception_alerts TO service_role;

DROP POLICY IF EXISTS exception_state_read ON public.cockpit_exception_state;
CREATE POLICY exception_state_read ON public.cockpit_exception_state FOR SELECT TO authenticated
  USING (
    public.cockpit_is_ceo() OR public.cockpit_has_role('admin')
    OR (public.cockpit_has_role('media_buyer') AND public.cockpit_client_allowed(client_name))
  );

-- The alert ledger holds Slack IDs and message bodies; no browser policy, service role only.

-- When the last check ran, whether it was healthy and whether messages are live, for the
-- list's footer (cockpit_sync_state itself has no browser policy). Gated like the state.
CREATE OR REPLACE FUNCTION public.cockpit_exception_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s record;
BEGIN
  IF NOT (public.cockpit_is_ceo() OR public.cockpit_has_role('admin') OR public.cockpit_has_role('media_buyer')) THEN
    RAISE EXCEPTION 'Verified media-buyer access required' USING ERRCODE = '42501';
  END IF;
  SELECT x.last_run_at, x.last_ok_at, x.ok, x.detail->>'delivery' AS delivery INTO s
    FROM public.cockpit_sync_state x WHERE x.key = 'exception-alerts';
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('checkedAt', s.last_run_at, 'lastOkAt', s.last_ok_at, 'ok', s.ok,
    'delivery', coalesce(s.delivery, 'dry'));
END $$;
REVOKE ALL ON FUNCTION public.cockpit_exception_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_exception_summary() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cockpit_native_monitor()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE snapshot jsonb; filtered jsonb; check_item jsonb; check_key text; superseded boolean;
 health jsonb; bad_sends bigint;
BEGIN
 snapshot:=public.cockpit_native_monitor_base();
 filtered:='[]'::jsonb;
 FOR check_item IN SELECT value FROM jsonb_array_elements(snapshot->'checks') LOOP
  check_key:=check_item->>'key';
  superseded:=false;
  IF check_key LIKE 'source:cockpit_media_provider_health:%' THEN
   -- The ledger records the upload response, not its later public GET. A proof
   -- alone is insufficient: require the exact content-addressed path in canonical
   -- saved still state and an actual published native media run too.
   superseded:=EXISTS (
    SELECT 1 FROM public.cockpit_media_provider_health t
    JOIN public.cockpit_native_still_readback p ON p.resource=t.resource
    JOIN public.cockpit_native_stills s ON s.data->>'status'='saved'
     AND s.data->>'url'='https://bldgtotkfmhoxmlzowdx.supabase.co/storage/v1/object/public/' || substring(t.resource from length('/storage/v1/object/')+1)
    WHERE t.provider='storage' AND t.method='POST' AND t.phase='response' AND t.http_status>=400
     AND check_key='source:cockpit_media_provider_health:'||md5(t.resource)
     AND p.http_status=200 AND p.verified_at>t.created_at
     AND EXISTS (SELECT 1 FROM public.cockpit_native_media_runs r WHERE r.status='published')
     AND t.id=(SELECT latest.id FROM public.cockpit_media_provider_health latest
       WHERE latest.provider=t.provider AND latest.resource=t.resource AND latest.phase<>'intent'
       ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1));
  ELSIF check_key LIKE 'source:cockpit_ceo_provider_health:%' THEN
   -- A later *canonical* CEO publication supersedes only this exact publish RPC,
   -- never another CEO provider failure. A partial run is a committed publish.
   superseded:=EXISTS (
    SELECT 1 FROM public.cockpit_ceo_provider_health t
    JOIN public.cockpit_ceo_refresh_runs r ON r.status IN ('published','partial')
     AND r.created_at>t.created_at AND r.finished_at>t.created_at
    WHERE t.method='POST' AND t.resource ~ '/rest/v1/rpc/cockpit_ceo_refresh_publish$'
     AND t.phase='response' AND t.http_status>=400
     AND check_key='source:cockpit_ceo_provider_health:'||md5(t.resource)
     AND t.id=(SELECT latest.id FROM public.cockpit_ceo_provider_health latest
       WHERE latest.provider=t.provider AND latest.resource=t.resource AND latest.phase='response'
       ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1));
  END IF;
  IF NOT superseded THEN
   filtered:=filtered||jsonb_build_array(check_item);
  END IF;
 END LOOP;
 -- Exception alerts (hermes/exception-alerts, 20261026150000): the last good hourly run
 -- and the ledger's failed, unknown or stuck sends. Listed once the worker has written
 -- its first health row. A fault here is reported as this one check, never as a failed
 -- monitor call.
 BEGIN
  SELECT jsonb_build_object('ok',s.ok,'note',s.note,'last_ok_at',s.last_ok_at) INTO health
   FROM public.cockpit_sync_state s WHERE s.key='exception-alerts';
  IF health IS NOT NULL THEN
   -- The last 24 hours; mirror rows are the lead sync watch's own posts, which its own
   -- health row already reports.
   SELECT count(*) INTO bad_sends FROM public.cockpit_exception_alerts a
    WHERE a.status IN ('failed','unknown','sending') AND a.kind<>'mirror' AND a.created_at>now()-interval '24 hours'
     AND (a.status<>'sending' OR a.created_at<now()-interval '10 minutes');
   filtered:=filtered||jsonb_build_array(jsonb_build_object('key','worker:exception-alerts','name','Exception alerts',
    'ok',coalesce((health->>'ok')::boolean,false) AND bad_sends=0,
    'error',CASE WHEN bad_sends>0 THEN bad_sends::text||' alert sends failed or unknown; read cockpit_exception_alerts'
     WHEN NOT coalesce((health->>'ok')::boolean,false) THEN coalesce(nullif(health->>'note',''),'Latest run failed') END,
    'failed',bad_sends,'at',health->>'last_ok_at','max_age_min',150));
  END IF;
 EXCEPTION WHEN OTHERS THEN
  filtered:=filtered||jsonb_build_array(jsonb_build_object('key','worker:exception-alerts','name','Exception alerts',
   'ok',false,'error','Exception alert health unreadable: '||left(SQLERRM,160),'at',NULL,'max_age_min',NULL));
 END;
 RETURN jsonb_set(snapshot,'{checks}',filtered);
END $function$;

REVOKE ALL ON FUNCTION public.cockpit_native_monitor() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_native_monitor() TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
