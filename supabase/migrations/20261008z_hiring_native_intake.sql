BEGIN;
-- Delivery configuration is separate from code and starts disabled.
CREATE TABLE public.cockpit_hiring_intake_sources (
 provider text NOT NULL CHECK(provider IN ('tally','typeform')),
 form_id text PRIMARY KEY, role text NOT NULL,
 mode text NOT NULL DEFAULT 'shadow' CHECK(mode IN ('shadow','live','paused')),
 accept_since timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.cockpit_hiring_intake_sources(provider,form_id,role) VALUES
 ('tally','9qQR6G','sales-closer'),('tally','b5VvQZ','call-centre'),
 ('typeform','rqv3Fkts','sales-closer'),('typeform','oW8CWRhi','csm');
CREATE TABLE public.cockpit_hiring_intake_receipts (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 provider text NOT NULL, form_id text NOT NULL REFERENCES public.cockpit_hiring_intake_sources(form_id),
 response_id text NOT NULL, payload_hash text NOT NULL, application jsonb,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('shadow','queued','processing','complete','review')),
 phase text, contact_id text, opportunity_id text, error_code text,
 received_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(provider,form_id,response_id)
);
CREATE INDEX cockpit_hiring_intake_pending ON public.cockpit_hiring_intake_receipts(status,received_at);
ALTER TABLE public.cockpit_hiring_intake_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_hiring_intake_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_hiring_intake_sources,public.cockpit_hiring_intake_receipts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.cockpit_hiring_intake_sources,public.cockpit_hiring_intake_receipts TO service_role;
REVOKE ALL ON SEQUENCE public.cockpit_hiring_intake_receipts_id_seq FROM PUBLIC,anon,authenticated;
GRANT ALL ON SEQUENCE public.cockpit_hiring_intake_receipts_id_seq TO service_role;

CREATE FUNCTION public.cockpit_claim_hiring_intake() RETURNS SETOF public.cockpit_hiring_intake_receipts
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- A crashed worker is held for reconciliation, never blindly replayed.
 UPDATE public.cockpit_hiring_intake_receipts SET status='review',error_code='worker_interrupted',updated_at=now()
 WHERE status='processing' AND updated_at<now()-interval '10 minutes';
 -- One worker across all four forms prevents simultaneous cross-form upserts.
 IF NOT pg_try_advisory_xact_lock(872398102) THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM public.cockpit_hiring_intake_receipts WHERE status='processing') THEN RETURN; END IF;
 RETURN QUERY WITH next AS (
 SELECT r.id FROM public.cockpit_hiring_intake_receipts r
 JOIN public.cockpit_hiring_intake_sources s ON s.form_id=r.form_id AND s.provider=r.provider
 WHERE r.status='queued' AND s.mode='live' ORDER BY r.received_at,r.id LIMIT 1 FOR UPDATE OF r SKIP LOCKED
 ) UPDATE public.cockpit_hiring_intake_receipts r SET status='processing',phase='claimed',updated_at=now()
 FROM next WHERE r.id=next.id RETURNING r.*;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_claim_hiring_intake() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_claim_hiring_intake() TO service_role;
COMMIT;
