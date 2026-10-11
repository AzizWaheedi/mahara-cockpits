-- Data view second-source check. Compares the data view's row functions with
-- direct counts on the warehouse tables, for all clients and one client, over
-- 7 and 30 days. Each fn_* column must equal its direct_* neighbour.
--   python scripts/dev/sq.py triage --write < scripts/dev/verify-data-view.sql
-- It only reads. --write is needed because the internal functions are
-- revoked from every role but the owner, the read-only role included.
WITH scopes AS (
  SELECT d AS days, loc
  FROM unnest(ARRAY[7,30]) d
  CROSS JOIN (VALUES (NULL::text), ((SELECT location_id FROM public.ghl_clients WHERE lower(client_name)='ocean home' LIMIT 1))) l(loc)
), x AS (
  SELECT s.days, s.loc, public.cockpit_data_view_from(s.days) AS since FROM scopes s
)
SELECT x.days, coalesce(g.client_name,'all clients') AS scope,
 (SELECT count(*) FROM public.cockpit_data_view_leads(x.loc,x.since,NULL,'all',NULL,NULL,NULL)) AS fn_leads,
 (SELECT count(*) FROM public.client_leads l WHERE l.created_at>=x.since AND NOT coalesce(l.deleted,false)
   AND (x.loc IS NULL OR l.location_id=x.loc)) AS direct_leads,
 (SELECT count(*) FROM public.cockpit_data_view_appointments(x.loc,x.since,NULL,'all',NULL,NULL,NULL)) AS fn_appts,
 (SELECT count(*) FROM public.appointments a WHERE a.booked_at>=x.since AND (x.loc IS NULL OR a.ghl_location_id=x.loc)) AS direct_appts,
 (SELECT count(*) FROM public.cockpit_data_view_appointments(x.loc,x.since,NULL,'any',NULL,NULL,NULL) r WHERE r.cockpit IN ('counted','twice')) AS fn_native_counted,
 (SELECT count(*) FROM public.appointments a WHERE a.booked_at>=x.since AND (x.loc IS NULL OR a.ghl_location_id=x.loc)
   AND EXISTS(SELECT 1 FROM public.cockpit_media_booking_events e WHERE e.source_deployment='native:media' AND e.data->>'eventId'=a.ghl_appointment_id)) AS direct_native_counted
FROM x LEFT JOIN public.ghl_clients g ON g.location_id=x.loc
ORDER BY x.days, scope;
