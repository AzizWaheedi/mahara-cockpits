-- One-off cleanup of public.cockpit_media_booking_events, 2026-10-12
-- (Creative Triage bldgtotkfmhoxmlzowdx). Not a migration: it removes data once.
-- Approved by Muhammed on 2026-10-12 ("approved, cleanup plus delete the 45
-- Safad rows"). APPLY needs his approval again for the run itself.
--
-- Why: the range read (cockpit_media_statistics 'range'), the funnel sheet,
-- the campaign range table, change results and creative feedback count every
-- row. The old Convex import (source_deployment 'adorable-seahorse-418',
-- 15 Jan to 27 Sep 2026) holds 43,158 rows for about 150 bookings. Three kinds
-- of Convex row are not bookings and are removed:
--   placeholder  Safad | MAHARA | 16-8 rows dated 15 Jan 2026, and every copy:
--                one 'confirmed' row per day from 14 Aug to 27 Sep, no ad, a
--                booking day before the campaign existed; 32 of the 45 days
--                have no appointment at Safad's GHL location (public.appointments).
--   repeat       a copy that a later Convex sync wrote again. Per group
--                (campaign, day, status, appointmentDate, adId, client) the rows
--                of one sync stay: the sync with the most rows, then the latest.
--                Same rule as hermes/ceo-refresh/repository.ts.
--   twin         a Convex booking the native sync also holds (8 to 27 Sep): same
--                campaign, booking day and appointment day, paired one to one.
--                The native row stays.
-- Native rows ('native:media') are never touched. Unmatched Convex rows stay.
--
-- Run order:
--   1. DRY RUN: the two read-only SELECTs below.
--   2. Copy the dry-run TOTAL counts (placeholder, repeat, twin, convex_after) into `expected` in APPLY. Run APPLY only with
--      approval for that run. It refuses when the data no longer matches.
--   3. VERIFY: the queries at the end.
-- Every deleted row is kept in full in cockpit_audit_log by the trigger
-- cockpit_native_booking_delete_audit (action 'delete', before = the row).
-- APPLY adds one summary row (action 'booking_convex_cleanup').

-- >>> DRY RUN: before and after per campaign ---------------------------------
-- plan:start
WITH convex AS (
 SELECT source_id, campaign_name, day,
  coalesce(data->>'status','') AS status, coalesce(data->>'appointmentDate','') AS appointment,
  coalesce(data->>'adId','') AS ad, coalesce(data->>'client','') AS client,
  (data->>'syncedAt')::numeric AS synced_at,
  campaign_name='Safad | MAHARA | 16-8' AND day=date '2026-01-15' AS placeholder
 FROM public.cockpit_media_booking_events WHERE source_deployment='adorable-seahorse-418'
), sized AS (
 SELECT *, count(*) OVER (PARTITION BY campaign_name,day,status,appointment,ad,client,synced_at) AS sync_rows
 FROM convex
), ranked AS (
 SELECT *, dense_rank() OVER (PARTITION BY campaign_name,day,status,appointment,ad,client ORDER BY sync_rows DESC,synced_at DESC) AS sync_rank
 FROM sized
), kept AS (
 SELECT source_id, campaign_name, day, left(appointment,10) AS appointment_day,
  row_number() OVER (PARTITION BY campaign_name,day,left(appointment,10) ORDER BY source_id) AS pair
 FROM ranked WHERE sync_rank=1 AND NOT placeholder
), native AS (
 SELECT campaign_name, day, left(coalesce(data->>'startTime',data->>'appointmentDate'),10) AS appointment_day,
  row_number() OVER (PARTITION BY campaign_name,day,left(coalesce(data->>'startTime',data->>'appointmentDate'),10) ORDER BY source_id) AS pair
 FROM public.cockpit_media_booking_events WHERE source_deployment='native:media'
), plan AS (
 SELECT source_id, CASE WHEN placeholder THEN 'placeholder' ELSE 'repeat' END AS reason
 FROM ranked WHERE placeholder OR sync_rank>1
 UNION ALL
 SELECT k.source_id, 'twin' FROM kept k JOIN native n USING (campaign_name,day,appointment_day,pair)
)
-- plan:end
SELECT coalesce(b.campaign_name,'TOTAL') AS campaign,
 count(*) AS rows_now,
 count(*) FILTER (WHERE b.source_deployment='native:media') AS native_rows,
 count(*) FILTER (WHERE p.reason='placeholder') AS placeholder,
 count(*) FILTER (WHERE p.reason='repeat') AS repeat,
 count(*) FILTER (WHERE p.reason='twin') AS twin,
 count(*) FILTER (WHERE p.reason IS NULL) AS after_cleanup,
 count(*) FILTER (WHERE b.source_deployment='adorable-seahorse-418' AND p.reason IS NULL) AS convex_after
FROM public.cockpit_media_booking_events b
LEFT JOIN plan p ON b.source_deployment='adorable-seahorse-418' AND p.source_id=b.source_id
GROUP BY ROLLUP(b.campaign_name)
ORDER BY b.campaign_name NULLS LAST;
-- <<< DRY RUN

-- >>> PLACEHOLDER CHECK: what the Safad 15 January rows are -------------------
SELECT count(*) AS rows,
 count(DISTINCT (data->>'appointmentDate',data->>'status',data->>'syncedAt')) AS distinct_rows_per_sync,
 count(DISTINCT data->>'appointmentDate') AS appointment_days,
 min(data->>'appointmentDate') AS first_appointment, max(data->>'appointmentDate') AS last_appointment,
 count(*) FILTER (WHERE nullif(data->>'adId','') IS NOT NULL) AS with_ad,
 array_agg(DISTINCT data->>'status') AS statuses
FROM public.cockpit_media_booking_events
WHERE source_deployment='adorable-seahorse-418' AND campaign_name='Safad | MAHARA | 16-8' AND day=date '2026-01-15';
-- <<< PLACEHOLDER CHECK

-- >>> APPLY: one transaction; refuses unless the counts equal the dry run -----
DO $apply$
DECLARE
 expected constant jsonb := '{"placeholder":41943,"repeat":1109,"twin":57,"convex_after":49}'; -- approved dry run, 2026-10-12
 got jsonb; rows_before bigint; rows_after bigint; planned bigint; distinct_ids bigint; deleted bigint; feed_before bigint;
BEGIN
 PERFORM set_config('lock_timeout','10s',true);
 -- Hold off a native publish until this commits; reads continue.
 LOCK TABLE public.cockpit_media_booking_events IN SHARE ROW EXCLUSIVE MODE;
 CREATE TEMP TABLE booking_cleanup ON COMMIT DROP AS
-- plan:start
WITH convex AS (
 SELECT source_id, campaign_name, day,
  coalesce(data->>'status','') AS status, coalesce(data->>'appointmentDate','') AS appointment,
  coalesce(data->>'adId','') AS ad, coalesce(data->>'client','') AS client,
  (data->>'syncedAt')::numeric AS synced_at,
  campaign_name='Safad | MAHARA | 16-8' AND day=date '2026-01-15' AS placeholder
 FROM public.cockpit_media_booking_events WHERE source_deployment='adorable-seahorse-418'
), sized AS (
 SELECT *, count(*) OVER (PARTITION BY campaign_name,day,status,appointment,ad,client,synced_at) AS sync_rows
 FROM convex
), ranked AS (
 SELECT *, dense_rank() OVER (PARTITION BY campaign_name,day,status,appointment,ad,client ORDER BY sync_rows DESC,synced_at DESC) AS sync_rank
 FROM sized
), kept AS (
 SELECT source_id, campaign_name, day, left(appointment,10) AS appointment_day,
  row_number() OVER (PARTITION BY campaign_name,day,left(appointment,10) ORDER BY source_id) AS pair
 FROM ranked WHERE sync_rank=1 AND NOT placeholder
), native AS (
 SELECT campaign_name, day, left(coalesce(data->>'startTime',data->>'appointmentDate'),10) AS appointment_day,
  row_number() OVER (PARTITION BY campaign_name,day,left(coalesce(data->>'startTime',data->>'appointmentDate'),10) ORDER BY source_id) AS pair
 FROM public.cockpit_media_booking_events WHERE source_deployment='native:media'
), plan AS (
 SELECT source_id, CASE WHEN placeholder THEN 'placeholder' ELSE 'repeat' END AS reason
 FROM ranked WHERE placeholder OR sync_rank>1
 UNION ALL
 SELECT k.source_id, 'twin' FROM kept k JOIN native n USING (campaign_name,day,appointment_day,pair)
)
-- plan:end
 SELECT source_id, reason FROM plan;

 SELECT count(*), count(DISTINCT source_id) INTO planned, distinct_ids FROM booking_cleanup;
 IF planned<>distinct_ids THEN RAISE EXCEPTION 'A row was planned for removal twice'; END IF;
 SELECT count(*) INTO rows_before FROM public.cockpit_media_booking_events;
 SELECT jsonb_build_object(
  'placeholder',count(*) FILTER (WHERE reason='placeholder'),
  'repeat',count(*) FILTER (WHERE reason='repeat'),
  'twin',count(*) FILTER (WHERE reason='twin'),
  -- Convex rows only: native rows keep changing while the sync runs.
  'convex_after',(SELECT count(*) FROM public.cockpit_media_booking_events WHERE source_deployment='adorable-seahorse-418')-count(*))
 INTO got FROM booking_cleanup;
 IF got IS DISTINCT FROM expected THEN
  RAISE EXCEPTION 'Cleanup counts % differ from the approved dry run %; nothing was removed',got,expected;
 END IF;

 DELETE FROM public.cockpit_media_booking_events b USING booking_cleanup c
 WHERE b.source_deployment='adorable-seahorse-418' AND b.source_id=c.source_id;
 GET DIAGNOSTICS deleted = ROW_COUNT;
 IF deleted<>planned THEN RAISE EXCEPTION 'Removed % rows, planned %',deleted,planned; END IF;

 -- The CEO refresh refuses booking history whose count differs from this.
 SELECT count(*) INTO rows_after FROM public.cockpit_media_booking_events;
 SELECT source_rows INTO feed_before FROM public.cockpit_media_feed_state WHERE feed='bookingEvents' AND ready;
 IF feed_before IS DISTINCT FROM rows_before THEN
  RAISE EXCEPTION 'Booking feed state says % rows, table had %',feed_before,rows_before;
 END IF;
 UPDATE public.cockpit_media_feed_state SET source_rows=rows_after,updated_at=clock_timestamp()
 WHERE feed='bookingEvents' AND ready;

 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after,metadata)
 VALUES('booking_convex_cleanup','cockpit_media_booking_events','adorable-seahorse-418','maintenance','media-buyer','supabase',
  jsonb_build_object('rows',rows_before,'feed_source_rows',feed_before),
  jsonb_build_object('rows',rows_after,'feed_source_rows',rows_after),
  jsonb_build_object('removed',got-'convex_after','file','supabase/maintenance/20261012_booking_events_convex_cleanup.sql',
   'approved_by','Muhammed','approved_on','2026-10-12','run_by','Claude',
   'rule','placeholder: Safad 15 Jan rows; repeat: copies from other Convex syncs; twin: Convex copy of a native booking'));
 RAISE NOTICE 'Removed % rows (%); % rows remain',deleted,got-'convex_after',rows_after;
END $apply$;
-- <<< APPLY

-- >>> VERIFY ------------------------------------------------------------------
-- SELECT source_deployment,count(*) FROM public.cockpit_media_booking_events GROUP BY 1;
-- SELECT source_rows,(SELECT count(*) FROM public.cockpit_media_booking_events) FROM public.cockpit_media_feed_state WHERE feed='bookingEvents';
-- SELECT count(*) FROM public.cockpit_audit_log WHERE entity_type='cockpit_media_booking_events' AND action='delete' AND created_at>now()-interval '1 hour';
-- SELECT * FROM public.cockpit_audit_log WHERE action='booking_convex_cleanup';
-- Rerun DRY RUN: placeholder and repeat are 0. Twin is 1, and that is expected:
-- pairing is one-shot. ARCWANI-MAHARA-29\8 on 20 Sep had two Convex rows and one
-- native row for the 21 Sep appointment day. The pair was removed; the other
-- Convex row stays and now re-pairs with the same native row. GHL
-- (public.appointments) holds two bookings there (18:30, the native row, and
-- 15:30), so it is real. Never run APPLY twice; its count guard refuses anyway.
--
-- Run on 2026-10-12 13:17 Kuwait: removed placeholder 41,943, repeat 1,109,
-- twin 57 (43,109 rows, each in cockpit_audit_log). Rows 43,310 -> 201
-- (152 native, 49 Convex); feed source_rows 201.
-- <<< VERIFY
