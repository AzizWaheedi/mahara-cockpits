-- Migration: 20260926a_cockpit_decision_details.sql
-- Additive versioned migration to persist decision details (metadata, reason)
-- and add immutable audit logging for decision inserts, updates, and deletes.
-- Local only, no apply to live DB.

BEGIN;

-- 1. Add metadata and reason columns to public.cockpit_decisions
ALTER TABLE public.cockpit_decisions
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS reason text;

-- 2. Reuse the existing audit schema and immutability guard unchanged.
-- The identity/audit migration must already be installed.
DO $$ BEGIN
  IF to_regclass('public.cockpit_audit_log') IS NULL THEN
    RAISE EXCEPTION 'Install the cockpit identity/audit migration first';
  END IF;
END $$;

-- 3. Audit trigger function for public.cockpit_decisions (INSERT, UPDATE, DELETE)
CREATE OR REPLACE FUNCTION public.cockpit_audit_decision_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor text;
  v_uid uuid;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NOT NULL THEN
    SELECT lower(trim(au.email)) INTO v_actor
    FROM auth.users AS au
    WHERE au.id = v_uid;
    IF v_actor IS NULL THEN
      v_actor := v_uid::text;
    END IF;
  ELSE
    v_actor := session_user;
  END IF;

  INSERT INTO public.cockpit_audit_log (
    action, entity_type, entity_id, actor_email, source_app, source_system,
    before, after
  ) VALUES (
    TG_OP, 'cockpit_decisions',
    CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END,
    v_actor, 'cockpit-decisions', 'supabase',
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cockpit_decisions_audit ON public.cockpit_decisions;
CREATE TRIGGER trg_cockpit_decisions_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_decisions
  FOR EACH ROW
  EXECUTE FUNCTION public.cockpit_audit_decision_changes();

-- 4. Replace exact cockpit_log_decision RPC to persist reason, metadata, and metric_at_decision
CREATE OR REPLACE FUNCTION public.cockpit_log_decision(
  p_role text,
  p_day date,
  p_subject text,
  p_action text,
  p_kind text DEFAULT 'decision',
  p_evidence text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_metric_at_decision numeric DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid uuid;
  v_role text;
  v_id bigint;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in before logging a decision' USING ERRCODE = '42501';
  END IF;

  v_role := trim(coalesce(p_role, ''));
  IF v_role NOT IN ('media_buyer', 'csm', 'creative', 'editor') OR p_day IS NULL THEN
    RAISE EXCEPTION 'Invalid decision role or day' USING ERRCODE = '22023';
  END IF;

  IF NOT (public.cockpit_has_role(v_role) OR public.cockpit_has_role('admin') OR public.cockpit_is_ceo()) THEN
    RAISE EXCEPTION 'Permission denied to log decision for role: %', v_role USING ERRCODE = '42501';
  END IF;

  IF trim(coalesce(p_subject, '')) = '' OR trim(coalesce(p_action, '')) = '' THEN
    RAISE EXCEPTION 'Subject and action cannot be empty' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.cockpit_decisions (
    role,
    day,
    subject,
    action,
    kind,
    evidence,
    reason,
    metric_at_decision,
    metadata,
    logged_at,
    source_system
  ) VALUES (
    v_role,
    p_day,
    trim(p_subject),
    trim(p_action),
    coalesce(trim(p_kind), 'decision'),
    p_evidence,
    p_reason,
    p_metric_at_decision,
    coalesce(p_metadata, '{}'::jsonb),
    now(),
    'supabase'
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- 5. Revoke / Grant execution privileges explicitly
REVOKE ALL ON FUNCTION public.cockpit_log_decision(text, date, text, text, text, text, text, numeric, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_log_decision(text, date, text, text, text, text, text, numeric, jsonb)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cockpit_audit_decision_changes()
  FROM PUBLIC, anon, authenticated;

COMMIT;
