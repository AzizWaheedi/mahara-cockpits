-- The end of day reaches Slack even after a fixable refusal, and the person who
-- filed it is told the truth, 2026-10-15 (Creative Triage bldgtotkfmhoxmlzowdx).
--
-- What went wrong (the CEO, 2026-10-15: "the media buyer eods arent pulling
-- into slack correctly fix it"): the EOD worker on the VPS posted with a Slack
-- token whose bot is not in #media-eods, Slack answered channel_not_found, and
-- after 5 tries in about 20 minutes the row was marked failed. Nothing ever
-- tried it again: the 10-11 EOD sat failed for 2.5 days and the 10-13 one for
-- 12 hours, until a person reset both by hand on 10-14 at 12:36 Kuwait. The
-- report itself never learned it was posted (cockpit_eod_reports.slack_ts
-- stayed empty), and the media buyer's screen said "Slack and sheet delivery
-- are not enabled here yet" the whole time.
--
-- What this changes:
-- * A row that failed on a Slack refusal that means "not posted, and fixable"
--   (the bot not in the channel or the channel not found, the token refused
--   or missing, Slack asking us to slow down) is queued again once an hour,
--   for 48 hours from when it was filed, by pg_cron job mahara-eod-retry
--   (minute 12). Each retry gives the worker one more try (attempts is set to
--   4 of the worker's 5), so a channel the bot still cannot see costs one
--   Slack call an hour, not five. It never touches a row that may already be
--   in Slack: a timeout, a 5xx or an interrupted send stays failed for a
--   person to reconcile (20260927b), and so does anything already posted.
-- * cockpit_requeue_eod_outbox(id) is the supported version of the 10-14 hand
--   reset, for the service role, once a person has fixed the cause: the same
--   guards, a full 5 tries, after the 48 hours as well. It also queues a row
--   Slack has but the EOD sheet never took (the live worker files the sheet
--   first and gives up after 5 refusals even when Slack took the post): both
--   workers skip Slack when slack_ts is set, so only the sheet row goes again.
--   The hourly retry never does this: the live worker cannot tell a timed-out
--   append from a refused one, so a person looks at the tab first.
-- * Each change to an outbox row by these two is in the audit log as
--   eod-retry or eod-requeue, through the existing outbox audit trigger.
-- * When the outbox records a Slack timestamp, the report gets it too
--   (cockpit_eod_reports.slack_ts), in the database, so it works with the
--   VPS worker as it runs today. Reports 14 and 15 (posted 10-14) are filled
--   in here. The report's audit row reads eod.delivered, not eod.submitted.
-- * cockpit_personal_eod's `outbox` adds retries, retried_at, retrying and
--   retry_until, so the screens can say "Not posted yet, the Slack bot cannot
--   see the EOD channel; it is tried again every hour until ...".
--   `delivery` keeps its constant: screens already in people's browsers
--   still check it.
--
-- Safe to apply twice. pg_cron is touched only inside guarded dynamic SQL, so
-- the file loads in PGlite. Apply after 20261015190000 (either order works).
BEGIN;

DO $$
BEGIN
 IF to_regprocedure('public.cockpit_enqueue_personal_eod(bigint)') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid=to_regclass('public.eod_outbox')
                AND attname='report_id' AND NOT attisdropped) THEN
  RAISE EXCEPTION 'Apply 20261009g_eod_outbox_native.sql first';
 END IF;
END $$;

ALTER TABLE public.eod_outbox
 ADD COLUMN IF NOT EXISTS retries integer NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS retried_at timestamptz;

-- The Slack refusals that prove nothing was posted and that a person can fix
-- (or that pass by themselves). Both workers write them as "<Exception>: slack: <code>".
CREATE OR REPLACE FUNCTION public.cockpit_eod_retryable(p_error text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT coalesce(p_error,'') ~* '(channel_not_found|not_in_channel|is_archived|invalid_auth|not_authed|token_revoked|token_expired|account_inactive|missing_scope|no_permission|restricted_action|ratelimited|rate_limited|HTTP( Error)? 429|SLACK_BOT_TOKEN is not set)';
$$;

-- Who changed an outbox row, for its audit row: the claiming worker, else the
-- function that says so for this transaction, else the producer (20260927b).
CREATE OR REPLACE FUNCTION public.cockpit_audit_eod_outbox()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 INSERT INTO public.cockpit_audit_log
 (action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
 VALUES(lower(TG_OP),'eod_outbox',NEW.id::text,
 coalesce(NEW.claimed_by,nullif(current_setting('mahara.eod_actor',true),''),'eod-producer'),
 'hermes','eod-out',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD)-'claim_token' END,to_jsonb(NEW)-'claim_token');
 RETURN NEW;
END;
$$;

-- A failed row nobody can doubt was not posted: no Slack receipt, no send
-- started without one, nothing waiting for a person to reconcile.
CREATE OR REPLACE FUNCTION public.cockpit_eod_outbox_requeueable(o public.eod_outbox)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT o.status='failed' AND NOT o.reconciliation_needed AND o.slack_ts IS NULL
  AND o.slack_started_at IS NULL AND (o.sheet_started_at IS NULL OR o.sheet_at IS NOT NULL);
$$;

-- The hourly retry (pg_cron mahara-eod-retry). Returns how many rows it queued.
CREATE OR REPLACE FUNCTION public.cockpit_retry_eod_outbox(p_now timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n integer;
BEGIN
 PERFORM set_config('mahara.eod_actor','eod-retry',true);
 UPDATE public.eod_outbox o SET status='queued',attempts=4,retries=o.retries+1,retried_at=p_now,
  claimed_by=NULL,claim_token=NULL,claimed_at=NULL,lease_expires_at=NULL
 WHERE public.cockpit_eod_outbox_requeueable(o)
  AND public.cockpit_eod_retryable(o.error)
  AND o.created_at>p_now-interval '48 hours'
  AND o.retries<48
  AND o.updated_at<=p_now-interval '50 minutes';
 GET DIAGNOSTICS n=ROW_COUNT;
 PERFORM set_config('mahara.eod_actor','',true);
 RETURN n;
END;
$$;

-- Slack has it, the sheet never took the row, and no append was started
-- without a receipt (the claiming worker's marker): only the sheet goes again.
CREATE OR REPLACE FUNCTION public.cockpit_eod_outbox_sheet_requeueable(o public.eod_outbox)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT o.status='failed' AND NOT o.reconciliation_needed AND nullif(btrim(o.slack_ts),'') IS NOT NULL
  AND o.sheet_at IS NULL AND o.sheet_started_at IS NULL;
$$;

-- After a person fixed the cause (invited the bot, set the token, shared the
-- sheet and found the row missing from its tab): queue one failed row again
-- with a full 5 tries. Service role only.
CREATE OR REPLACE FUNCTION public.cockpit_requeue_eod_outbox(p_id bigint)
RETURNS public.eod_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.eod_outbox;
BEGIN
 SELECT * INTO o FROM public.eod_outbox WHERE id=p_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'EOD outbox row % does not exist',p_id; END IF;
 IF NOT (public.cockpit_eod_outbox_requeueable(o) OR public.cockpit_eod_outbox_sheet_requeueable(o)) THEN
  RAISE EXCEPTION 'Only a failed EOD that was certainly not posted, or not filed in the sheet, can be queued again (row %: %)',p_id,
   CASE WHEN o.status<>'failed' THEN 'it is '||o.status
    WHEN o.slack_ts IS NOT NULL AND o.sheet_at IS NOT NULL THEN 'it is already in Slack and the sheet'
    ELSE 'a send was started without a receipt; reconcile it first (hermes/eod-out/RUNBOOK.md)' END;
 END IF;
 PERFORM set_config('mahara.eod_actor','eod-requeue',true);
 UPDATE public.eod_outbox SET status='queued',attempts=0,error=NULL,retried_at=clock_timestamp(),
  claimed_by=NULL,claim_token=NULL,claimed_at=NULL,lease_expires_at=NULL
 WHERE id=p_id RETURNING * INTO o;
 PERFORM set_config('mahara.eod_actor','',true);
 RETURN o;
END;
$$;

-- The report learns its Slack timestamp when the outbox does.
CREATE OR REPLACE FUNCTION public.cockpit_eod_outbox_to_report()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.report_id IS NOT NULL AND nullif(btrim(NEW.slack_ts),'') IS NOT NULL
    AND NEW.slack_ts IS DISTINCT FROM OLD.slack_ts THEN
  UPDATE public.cockpit_eod_reports SET slack_ts=NEW.slack_ts WHERE id=NEW.report_id AND slack_ts IS NULL;
 END IF;
 RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_eod_outbox_to_report ON public.eod_outbox;
CREATE TRIGGER trg_eod_outbox_to_report AFTER UPDATE OF slack_ts ON public.eod_outbox
 FOR EACH ROW EXECUTE FUNCTION public.cockpit_eod_outbox_to_report();

-- 20260927e, with one more label: a submitted report that only gained its
-- Slack timestamp was delivered, not submitted again.
CREATE OR REPLACE FUNCTION public.cockpit_personal_eod_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text;
BEGIN
 SELECT m.email INTO actor FROM public.cockpit_members m JOIN auth.users u ON u.id=m.auth_user_id
 WHERE m.auth_user_id=auth.uid() AND m.active AND u.email_confirmed_at IS NOT NULL AND m.email=lower(btrim(u.email));
 INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
 VALUES(CASE WHEN NEW.submitted_at IS NULL THEN 'eod.draft'
  WHEN TG_OP='UPDATE' AND OLD.submitted_at IS NOT NULL AND NEW.slack_ts IS DISTINCT FROM OLD.slack_ts
   AND to_jsonb(NEW)-'slack_ts'-'updated_at'=to_jsonb(OLD)-'slack_ts'-'updated_at' THEN 'eod.delivered'
  ELSE 'eod.submitted' END,'cockpit_eod_reports',NEW.id::text,
 coalesce(actor,'service-role'),NEW.role,'supabase',CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) END,to_jsonb(NEW));
 RETURN NEW;
END;
$$;

-- Reports already posted before this trigger existed (14 and 15, posted 2026-10-14).
UPDATE public.cockpit_eod_reports r SET slack_ts=o.slack_ts
FROM public.eod_outbox o
WHERE o.report_id=r.id AND r.slack_ts IS NULL AND nullif(btrim(o.slack_ts),'') IS NOT NULL;

-- 20261009g, with the retry state in `outbox`. `delivery` keeps its constant.
CREATE OR REPLACE FUNCTION public.cockpit_personal_eod(p_role text,p_day date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid;day_for date;report jsonb;outbox jsonb;
BEGIN
 uid:=public.cockpit_eod_actor(p_role);
 day_for:=coalesce(p_day,public.cockpit_eod_working_day(now()));
 IF day_for>public.cockpit_eod_working_day(now()) THEN RAISE EXCEPTION 'EOD day cannot be in the future';END IF;
 SELECT to_jsonb(r) INTO report FROM public.cockpit_eod_reports r
 WHERE r.owner_user_id=uid AND r.role=p_role AND r.day=day_for;
 IF report IS NOT NULL THEN
  SELECT jsonb_build_object('status',o.status,'attempts',o.attempts,'slack_posted',o.slack_ts IS NOT NULL,
   'sheet_filed',o.sheet_at IS NOT NULL,'sent_at',o.sent_at,'error',o.error,'sheet_error',o.sheet_error,
   'needs_reconciliation',o.reconciliation_needed,'retries',o.retries,'retried_at',o.retried_at,
   'retry_until',o.created_at+interval '48 hours',
   -- Failed now, but the hourly retry will try it again.
   'retrying',o.status='failed' AND public.cockpit_eod_outbox_requeueable(o) AND public.cockpit_eod_retryable(o.error)
    AND o.created_at+interval '48 hours'>now() AND o.retries<48)
  INTO outbox FROM public.eod_outbox o WHERE o.report_id=(report->>'id')::bigint;
 END IF;
 -- 'delivery' is the constant earlier screens validate; 'outbox' is the real state.
 RETURN jsonb_build_object('owner',uid,'day',day_for,'report',report,'delivery','not_configured','outbox',outbox);
END;
$$;

-- The hourly job, where pg_cron exists.
DO $$
BEGIN
 IF to_regclass('cron.job') IS NOT NULL THEN
  EXECUTE 'SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname=''mahara-eod-retry''';
  EXECUTE $q$SELECT cron.schedule('mahara-eod-retry','12 * * * *',$job$SELECT public.cockpit_retry_eod_outbox();$job$)$q$;
 END IF;
END $$;

-- Trigger functions keep the grants 20260927b/e gave them (no browser role).
REVOKE ALL ON FUNCTION public.cockpit_audit_eod_outbox(),public.cockpit_eod_outbox_to_report(),
 public.cockpit_personal_eod_audit() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cockpit_eod_retryable(text),public.cockpit_eod_outbox_requeueable(public.eod_outbox),
 public.cockpit_eod_outbox_sheet_requeueable(public.eod_outbox),
 public.cockpit_retry_eod_outbox(timestamptz),public.cockpit_requeue_eod_outbox(bigint)
 FROM PUBLIC,anon,authenticated,service_role;
-- For a person who fixed the cause (hermes/eod-out/RUNBOOK.md); pg_cron runs the retry as its owner.
GRANT EXECUTE ON FUNCTION public.cockpit_requeue_eod_outbox(bigint),public.cockpit_retry_eod_outbox(timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.cockpit_personal_eod(text,date) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_personal_eod(text,date) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
