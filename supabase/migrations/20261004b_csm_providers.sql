BEGIN;
-- Projection bookings preserve the GHL check-in call and ClickUp next-POC flow.
-- A request remains reconcilable after an unknown delivery. Neither a retry nor
-- a new browser request id is allowed to create the same task/time twice.
ALTER TABLE public.cockpit_csm_actions DROP CONSTRAINT IF EXISTS cockpit_csm_actions_operation_check;
ALTER TABLE public.cockpit_csm_actions ADD CONSTRAINT cockpit_csm_actions_operation_check
  CHECK (operation IN ('act','plan','projections.bookCall'));
ALTER TABLE public.cockpit_csm_provider_health ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'clickup';
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_csm_booking_once
  ON public.cockpit_csm_actions ((context->>'taskId'), (context->>'bookingWhen'))
  WHERE operation='projections.bookCall';

CREATE OR REPLACE FUNCTION public.cockpit_csm_projection_finish_booking(p_id uuid,p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.cockpit_csm_actions; booking_result jsonb;
BEGIN
  SELECT * INTO a FROM public.cockpit_csm_actions WHERE id=p_id FOR UPDATE;
  IF a.id IS NULL OR a.operation<>'projections.bookCall' THEN RAISE EXCEPTION 'Booking receipt not found'; END IF;
  IF a.state='confirmed' THEN RETURN a.result; END IF;
  IF a.state NOT IN ('sending','reconcile') OR p_result->>'ok' IS DISTINCT FROM 'true'
     OR coalesce(p_result->>'eventId','') !~ '^[A-Za-z0-9_-]{1,150}$'
     OR p_result->>'when' IS DISTINCT FROM a.context->>'bookingWhen'
     OR p_result->>'title' IS DISTINCT FROM a.result->>'title'
     OR coalesce(p_result->>'title','') ~* '(upgrad|up-?sell|renew)'
  THEN RAISE EXCEPTION 'Booking providers have not been confirmed'; END IF;
  -- The service-only native recorder checks the actor is still active, assigned
  -- to this client, and (where supplied) still allowed into the meeting.
  PERFORM public.cockpit_csm_projection_record_booking(a.actor_id,a.context->>'taskId',p_result->>'when',p_result->>'eventId',a.request->>'meetingId');
  INSERT INTO public.cockpit_csm_client_overrides(task_id,client_name,data,action_id)
    VALUES(a.context->>'taskId',a.context->>'clientName',jsonb_build_object('nextPoc',a.request->>'day'),a.id)
    ON CONFLICT(task_id) DO UPDATE SET
      data=(CASE WHEN EXISTS(
        SELECT 1 FROM public.cockpit_csm_sources r
        JOIN public.cockpit_csm_source_state st ON st.table_name=r.table_name AND st.source_snapshot_at=r.source_snapshot_at AND st.ready
        WHERE r.table_name='clients' AND r.data->>'taskId'=public.cockpit_csm_client_overrides.task_id
          AND (r.data->>'syncedAt')::numeric>=extract(epoch FROM public.cockpit_csm_client_overrides.confirmed_at)*1000
      ) THEN '{}'::jsonb ELSE public.cockpit_csm_client_overrides.data END)||excluded.data,
      action_id=excluded.action_id,confirmed_at=now();
  booking_result:=p_result||jsonb_build_object('receiptId',a.id);
  UPDATE public.cockpit_csm_actions SET state='confirmed',result=booking_result,error=NULL,finished_at=now() WHERE id=a.id;
  RETURN booking_result;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_projection_finish_booking(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_projection_finish_booking(uuid,jsonb) TO service_role;

-- A refresh here is a scoped native read, not a request to a payment provider.
-- finishedAt remains the original confirmed finance-run time, never read time.
CREATE OR REPLACE FUNCTION public.cockpit_csm_projection_refresh_billing()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor uuid; finished timestamptz;
BEGIN
  actor:=public.cockpit_csm_actor();
  SELECT finished_at INTO finished FROM public.cockpit_finance_refreshes
    WHERE status='confirmed' AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'payments',(SELECT count(*) FROM public.cockpit_client_payments p WHERE p.active AND p.day >= (now() AT TIME ZONE 'Asia/Kuwait')::date-400 AND public.cockpit_client_allowed(p.client_name)),
    'accounts',(SELECT count(*) FROM public.cockpit_billing_accounts a WHERE public.cockpit_client_allowed(a.client_name)),
    'finishedAt',finished,
    'source','Active native payment facts (last 400 days), ClickUp billing mirror, latest confirmed finance refresh; no provider refresh was requested.');
END $$;
REVOKE ALL ON FUNCTION public.cockpit_csm_projection_refresh_billing() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_projection_refresh_billing() TO authenticated;
COMMENT ON FUNCTION public.cockpit_csm_projection_refresh_billing() IS 'Read-only scoped billing facts. The edge reports missing or older-than-one-hour confirmed finance refreshes as not fresh; reading never advances freshness.';
COMMENT ON INDEX public.cockpit_csm_booking_once IS 'Durable task/time idempotency fence, including unknown GHL outcomes. Existing requests are reconciled with bounded provider GETs, never blindly recreated.';
COMMIT;
