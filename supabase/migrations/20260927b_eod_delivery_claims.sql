-- Local preparation only. Applying this does not authorize outward delivery.
BEGIN;
ALTER TABLE public.eod_outbox DROP CONSTRAINT IF EXISTS eod_outbox_status_check;
ALTER TABLE public.eod_outbox ADD CONSTRAINT eod_outbox_status_check
 CHECK (status IN ('queued','processing','sent','failed'));
ALTER TABLE public.eod_outbox
 ADD COLUMN IF NOT EXISTS sheet_at timestamptz,
 ADD COLUMN IF NOT EXISTS sheet_error text,
 ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
 ADD COLUMN IF NOT EXISTS claimed_by text,
 ADD COLUMN IF NOT EXISTS claim_token uuid,
 ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
 ADD COLUMN IF NOT EXISTS slack_started_at timestamptz,
 ADD COLUMN IF NOT EXISTS sheet_started_at timestamptz,
 ADD COLUMN IF NOT EXISTS reconciliation_needed boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS reconcile_reason text,
 ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS eod_outbox_queue_claim_idx ON public.eod_outbox(status,lease_expires_at,created_at)
 WHERE status IN ('queued','processing');

CREATE OR REPLACE FUNCTION public.cockpit_protect_eod_outbox()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 -- Merge-duplicate producers must not overwrite a report already being delivered.
 IF (OLD.status<>'queued' OR OLD.slack_started_at IS NOT NULL OR OLD.sheet_started_at IS NOT NULL
     OR OLD.slack_ts IS NOT NULL OR OLD.sheet_at IS NOT NULL) AND
    ROW(NEW.role,NEW.day,NEW.person,NEW.slack_id,NEW.channel,NEW.tab,NEW.body,NEW.row_values)
    IS DISTINCT FROM ROW(OLD.role,OLD.day,OLD.person,OLD.slack_id,OLD.channel,OLD.tab,OLD.body,OLD.row_values) THEN
   RAISE EXCEPTION 'Cannot overwrite a claimed or delivered EOD';
 END IF;
 IF (OLD.slack_ts IS NOT NULL AND NEW.slack_ts IS DISTINCT FROM OLD.slack_ts)
    OR (OLD.sheet_at IS NOT NULL AND NEW.sheet_at IS DISTINCT FROM OLD.sheet_at)
    OR (OLD.sent_at IS NOT NULL AND NEW.sent_at IS DISTINCT FROM OLD.sent_at) THEN
   RAISE EXCEPTION 'Confirmed EOD receipts are immutable';
 END IF;
 IF OLD.status='sent' AND NEW.status<>'sent' THEN RAISE EXCEPTION 'Cannot requeue a delivered EOD'; END IF;
 IF OLD.status='processing' AND NEW.status='queued' AND
    (NEW.claimed_by IS NOT NULL OR NEW.claim_token IS NOT NULL OR NEW.lease_expires_at IS NOT NULL) THEN
   RAISE EXCEPTION 'Cannot requeue an in-flight EOD without releasing its claim';
 END IF;
 IF NEW.status='sent' AND (nullif(btrim(NEW.slack_ts),'') IS NULL OR NEW.reconciliation_needed OR
     (nullif(btrim(NEW.tab),'') IS NOT NULL AND NEW.row_values IS NOT NULL
      AND NEW.row_values NOT IN ('null'::jsonb,'{}'::jsonb,'[]'::jsonb) AND NEW.sheet_at IS NULL)) THEN
   RAISE EXCEPTION 'Both required delivery receipts must be confirmed before sent';
 END IF;
 NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_protect_eod_outbox ON public.eod_outbox;
CREATE TRIGGER trg_protect_eod_outbox BEFORE UPDATE ON public.eod_outbox
 FOR EACH ROW EXECUTE FUNCTION public.cockpit_protect_eod_outbox();

CREATE OR REPLACE FUNCTION public.cockpit_audit_eod_outbox()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.cockpit_audit_log
 (action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
 VALUES(lower(TG_OP),'eod_outbox',NEW.id::text,coalesce(NEW.claimed_by,'eod-producer'),
 'hermes','eod-out',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD)-'claim_token' END,to_jsonb(NEW)-'claim_token');
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_audit_eod_outbox ON public.eod_outbox;
CREATE TRIGGER trg_audit_eod_outbox AFTER INSERT OR UPDATE ON public.eod_outbox
 FOR EACH ROW EXECUTE FUNCTION public.cockpit_audit_eod_outbox();

CREATE OR REPLACE FUNCTION public.cockpit_claim_eod_outbox(
 p_worker_id text,p_lease_seconds integer DEFAULT 300,p_limit integer DEFAULT 20
) RETURNS SETOF public.eod_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_now timestamptz:=clock_timestamp();
BEGIN
 IF nullif(btrim(p_worker_id),'') IS NULL OR length(p_worker_id)>160
    OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 10 AND 3600
    OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION 'Invalid worker, lease or batch limit';
 END IF;
 -- A missing receipt after send-start does not prove absence of an external effect.
 UPDATE public.eod_outbox SET status='failed',reconciliation_needed=true,
   reconcile_reason='Interrupted send: verify the external receipt before retrying'
 WHERE (status='queued' OR (status='processing' AND lease_expires_at<=v_now))
   AND ((slack_started_at IS NOT NULL AND slack_ts IS NULL)
     OR (sheet_started_at IS NOT NULL AND sheet_at IS NULL));
 UPDATE public.eod_outbox SET status='failed',error=coalesce(error,'Maximum delivery attempts exceeded')
 WHERE (status='queued' OR (status='processing' AND lease_expires_at<=v_now)) AND attempts>=5;
 RETURN QUERY WITH candidates AS (
   SELECT id FROM public.eod_outbox
   WHERE (status='queued' OR (status='processing' AND lease_expires_at<=v_now))
     AND NOT reconciliation_needed AND attempts<5
   ORDER BY created_at,id LIMIT p_limit FOR UPDATE SKIP LOCKED
 ) UPDATE public.eod_outbox o SET status='processing',claimed_by=p_worker_id,
   claimed_at=v_now,claim_token=gen_random_uuid(),lease_expires_at=v_now+make_interval(secs=>p_lease_seconds),
   attempts=o.attempts+1 FROM candidates c WHERE o.id=c.id RETURNING o.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_start_eod_send(
 p_id bigint,p_worker_id text,p_claim_token uuid,p_transport text
) RETURNS public.eod_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.eod_outbox;
BEGIN
 IF p_transport IS NULL OR p_transport NOT IN ('slack','sheet') THEN RAISE EXCEPTION 'Invalid transport'; END IF;
 SELECT * INTO v_row FROM public.eod_outbox WHERE id=p_id AND status='processing'
   AND claimed_by=p_worker_id AND claim_token=p_claim_token AND lease_expires_at>clock_timestamp()
   AND NOT reconciliation_needed FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Fenced send-start write rejected'; END IF;
 IF (p_transport='slack' AND (v_row.slack_ts IS NOT NULL OR v_row.slack_started_at IS NOT NULL))
   OR (p_transport='sheet' AND (v_row.sheet_at IS NOT NULL OR v_row.sheet_started_at IS NOT NULL)) THEN
   RAISE EXCEPTION 'Transport already sent or in progress';
 END IF;
 IF p_transport='sheet' AND (nullif(btrim(v_row.tab),'') IS NULL OR v_row.row_values IS NULL
     OR v_row.row_values IN ('null'::jsonb,'{}'::jsonb,'[]'::jsonb)) THEN RAISE EXCEPTION 'No sheet delivery required'; END IF;
 UPDATE public.eod_outbox SET
   slack_started_at=CASE WHEN p_transport='slack' THEN clock_timestamp() ELSE slack_started_at END,
   sheet_started_at=CASE WHEN p_transport='sheet' THEN clock_timestamp() ELSE sheet_started_at END
   WHERE id=p_id RETURNING * INTO v_row;
 RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_record_eod_receipt(
 p_id bigint,p_worker_id text,p_claim_token uuid,p_slack_ts text DEFAULT NULL,
 p_slack_error text DEFAULT NULL,p_sheet_at timestamptz DEFAULT NULL,p_sheet_error text DEFAULT NULL,
 p_status text DEFAULT NULL,p_reconciliation_needed boolean DEFAULT false,p_reconcile_reason text DEFAULT NULL
) RETURNS public.eod_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.eod_outbox;
BEGIN
 SELECT * INTO v_row FROM public.eod_outbox WHERE id=p_id AND status='processing'
   AND claimed_by=p_worker_id AND claim_token=p_claim_token AND lease_expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Fenced receipt write rejected'; END IF;
 IF p_status IS NOT NULL AND p_status NOT IN ('queued','processing','sent','failed') THEN RAISE EXCEPTION 'Invalid receipt status'; END IF;
 IF p_slack_ts IS NOT NULL AND (nullif(btrim(p_slack_ts),'') IS NULL OR v_row.slack_started_at IS NULL) THEN
   RAISE EXCEPTION 'Slack receipt requires a send-start and nonblank timestamp';
 END IF;
 IF p_sheet_at IS NOT NULL AND v_row.sheet_started_at IS NULL THEN RAISE EXCEPTION 'Sheet receipt requires a send-start'; END IF;
 IF (p_slack_ts IS NOT NULL AND p_slack_error IS NOT NULL) OR (p_sheet_at IS NOT NULL AND p_sheet_error IS NOT NULL) THEN
   RAISE EXCEPTION 'A transport cannot succeed and fail together';
 END IF;
 -- Errors here mean confirmed rejection/preflight failure. Unknown outcomes
 -- must set reconciliation_needed and retain their durable send intent.
 v_row.slack_ts:=coalesce(p_slack_ts,v_row.slack_ts);
 v_row.sheet_at:=coalesce(p_sheet_at,v_row.sheet_at);
 IF p_slack_ts IS NOT NULL THEN v_row.error:=NULL; v_row.sent_at:=coalesce(v_row.sent_at,clock_timestamp());
 ELSIF p_slack_error IS NOT NULL THEN v_row.error:=left(p_slack_error,1000); END IF;
 IF p_sheet_at IS NOT NULL THEN v_row.sheet_error:=NULL;
 ELSIF p_sheet_error IS NOT NULL THEN v_row.sheet_error:=left(p_sheet_error,1000); END IF;
 v_row.reconciliation_needed:=v_row.reconciliation_needed OR coalesce(p_reconciliation_needed,false);
 IF NOT v_row.reconciliation_needed THEN
   IF p_slack_error IS NOT NULL THEN v_row.slack_started_at:=NULL; END IF;
   IF p_sheet_error IS NOT NULL THEN v_row.sheet_started_at:=NULL; END IF;
 END IF;
 v_row.status:=coalesce(p_status,v_row.status);
 IF v_row.reconciliation_needed THEN v_row.status:='failed'; END IF;
 IF v_row.status IN ('queued','failed') AND NOT v_row.reconciliation_needed AND
   ((v_row.slack_started_at IS NOT NULL AND v_row.slack_ts IS NULL)
    OR (v_row.sheet_started_at IS NOT NULL AND v_row.sheet_at IS NULL)) THEN
   RAISE EXCEPTION 'Uncertain delivery must be reconciled, not retried';
 END IF;
 IF v_row.status='queued' AND v_row.attempts>=5 THEN v_row.status:='failed'; END IF;
 UPDATE public.eod_outbox SET slack_ts=v_row.slack_ts,sent_at=v_row.sent_at,error=v_row.error,
   sheet_at=v_row.sheet_at,sheet_error=v_row.sheet_error,status=v_row.status,
   slack_started_at=v_row.slack_started_at,sheet_started_at=v_row.sheet_started_at,
   reconciliation_needed=v_row.reconciliation_needed,
   reconcile_reason=coalesce(left(p_reconcile_reason,1000),v_row.reconcile_reason),
   claimed_by=CASE WHEN v_row.status='queued' THEN NULL ELSE v_row.claimed_by END,
   claim_token=CASE WHEN v_row.status='queued' THEN NULL ELSE v_row.claim_token END,
   lease_expires_at=CASE WHEN v_row.status='queued' THEN NULL ELSE v_row.lease_expires_at END
   WHERE id=p_id RETURNING * INTO v_row;
 RETURN v_row;
END;
$$;

ALTER TABLE public.eod_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.eod_outbox FROM anon,authenticated;
GRANT ALL ON public.eod_outbox TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.eod_outbox_id_seq TO service_role;
REVOKE ALL ON FUNCTION public.cockpit_protect_eod_outbox(),public.cockpit_audit_eod_outbox() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_claim_eod_outbox(text,integer,integer),
 public.cockpit_start_eod_send(bigint,text,uuid,text),
 public.cockpit_record_eod_receipt(bigint,text,uuid,text,text,timestamptz,text,text,boolean,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_claim_eod_outbox(text,integer,integer),
 public.cockpit_start_eod_send(bigint,text,uuid,text),
 public.cockpit_record_eod_receipt(bigint,text,uuid,text,text,timestamptz,text,text,boolean,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
