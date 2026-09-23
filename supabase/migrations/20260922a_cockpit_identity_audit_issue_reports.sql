-- Migration: 20260922a_cockpit_identity_audit_issue_reports.sql
-- Slice 1: Cockpit Identity, Audit Log, and Issue Report Mirror
-- Idempotent, transaction-wrapped, non-destructive

BEGIN;

-- 1. Identity Directory: public.cockpit_members
CREATE TABLE IF NOT EXISTS public.cockpit_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email text NOT NULL,
  name text,
  roles text[] NOT NULL DEFAULT '{}'::text[],
  clients text[] NOT NULL DEFAULT '{}'::text[],
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Normalized unique email constraint & index
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cockpit_members_email_key'
  ) THEN
    ALTER TABLE public.cockpit_members ADD CONSTRAINT cockpit_members_email_key UNIQUE (email);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cockpit_members_email_normalized'
  ) THEN
    ALTER TABLE public.cockpit_members ADD CONSTRAINT cockpit_members_email_normalized CHECK (email = lower(trim(email)));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_cockpit_members_auth_user_id ON public.cockpit_members(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_cockpit_members_active ON public.cockpit_members(active);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cockpit_members_auth_user_unique
ON public.cockpit_members(auth_user_id)
WHERE auth_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cockpit_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cockpit_members_touch ON public.cockpit_members;
CREATE TRIGGER trg_cockpit_members_touch
BEFORE UPDATE ON public.cockpit_members
FOR EACH ROW EXECUTE FUNCTION public.cockpit_touch_updated_at();

-- 2. Audit Log: public.cockpit_audit_log
CREATE TABLE IF NOT EXISTS public.cockpit_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  actor_email text,
  source_app text,
  source_system text,
  before jsonb,
  after jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cockpit_audit_log_entity ON public.cockpit_audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_cockpit_audit_log_created_at ON public.cockpit_audit_log(created_at DESC);

-- Immutability enforcement on audit log
CREATE OR REPLACE FUNCTION public.cockpit_audit_log_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'cockpit_audit_log rows are immutable';
END;
$$;

DROP TRIGGER IF EXISTS trg_cockpit_audit_log_immutable ON public.cockpit_audit_log;
CREATE TRIGGER trg_cockpit_audit_log_immutable
BEFORE UPDATE OR DELETE ON public.cockpit_audit_log
FOR EACH ROW EXECUTE FUNCTION public.cockpit_audit_log_immutable();

CREATE OR REPLACE FUNCTION public.trg_cockpit_members_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.cockpit_audit_log (
    action, entity_type, entity_id, actor_email,
    source_app, source_system, before, after
  ) VALUES (
    TG_OP, 'cockpit_members', NEW.id::text,
    nullif(auth.jwt() ->> 'email', ''),
    'cockpit-access', 'supabase',
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cockpit_members_audit ON public.cockpit_members;
CREATE TRIGGER trg_cockpit_members_audit
AFTER INSERT OR UPDATE ON public.cockpit_members
FOR EACH ROW EXECUTE FUNCTION public.trg_cockpit_members_audit();

-- Seed the six static seats from apps/media-buyer-cockpit/convex/roles.ts.
-- Add-only: union roles, link an existing Auth user, and never overwrite a
-- human name, client restriction, active flag, or existing Auth link.
WITH seats(email, roles) AS (
  VALUES
    ('aziz@maharamedia.com', ARRAY['ceo', 'admin', 'media_buyer', 'csm', 'creative', 'editor']::text[]),
    ('awaheedi2008@gmail.com', ARRAY['ceo', 'admin', 'media_buyer', 'csm', 'creative', 'editor']::text[]),
    ('nada@maharamedia.com', ARRAY['media_buyer']::text[]),
    ('abdulelah@maharamedia.com', ARRAY['csm']::text[]),
    ('abdu@maharamedia.com', ARRAY['csm']::text[]),
    ('karim@maharamedia.com', ARRAY['editor']::text[])
)
INSERT INTO public.cockpit_members (email, auth_user_id, roles)
SELECT seats.email, users.id, seats.roles
FROM seats
LEFT JOIN auth.users AS users
  ON lower(users.email) = seats.email
 AND users.email_confirmed_at IS NOT NULL
ON CONFLICT (email) DO UPDATE
SET
  auth_user_id = coalesce(public.cockpit_members.auth_user_id, excluded.auth_user_id),
  roles = (
    SELECT array_agg(DISTINCT r ORDER BY r)
    FROM unnest(coalesce(public.cockpit_members.roles, '{}'::text[]) || coalesce(excluded.roles, '{}'::text[])) AS r
  )
WHERE public.cockpit_members.auth_user_id IS DISTINCT FROM
      coalesce(public.cockpit_members.auth_user_id, excluded.auth_user_id)
   OR public.cockpit_members.roles IS DISTINCT FROM (
     SELECT array_agg(DISTINCT r ORDER BY r)
     FROM unnest(coalesce(public.cockpit_members.roles, '{}'::text[]) || coalesce(excluded.roles, '{}'::text[])) AS r
   );

-- 3. Issue reports are separate from cockpit_feedback, which is Aziz's
-- changes-and-bugs dispatch queue and has its own autonomous worker.
CREATE TABLE IF NOT EXISTS public.cockpit_issue_reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind text NOT NULL,
  text text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  batch text,
  note text,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  done_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  source_system text,
  source_id text,
  app text NOT NULL,
  page text NOT NULL,
  role text NOT NULL,
  actor_email text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT cockpit_issue_reports_source_unique UNIQUE (source_system, source_id)
);

CREATE INDEX IF NOT EXISTS idx_cockpit_issue_reports_created_at
ON public.cockpit_issue_reports(created_at DESC);

-- 4. Audit trigger on issue report insert/update
CREATE OR REPLACE FUNCTION public.trg_cockpit_issue_reports_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor text;
  v_action text;
  v_before jsonb;
  v_after jsonb;
BEGIN
  v_action := TG_OP;

  IF TG_OP = 'INSERT' THEN
    v_actor := coalesce(
      NEW.actor_email,
      nullif(auth.jwt() ->> 'email', ''),
      nullif(current_setting('request.jwt.claim.email', true), '')
    );
    v_before := null;
    v_after := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_actor := coalesce(
      NEW.actor_email,
      OLD.actor_email,
      nullif(auth.jwt() ->> 'email', ''),
      nullif(current_setting('request.jwt.claim.email', true), '')
    );
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
  END IF;

  INSERT INTO public.cockpit_audit_log (
    action,
    entity_type,
    entity_id,
    actor_email,
    source_app,
    source_system,
    before,
    after,
    metadata,
    created_at
  ) VALUES (
    v_action,
    'cockpit_issue_reports',
    NEW.id::text,
    v_actor,
    NEW.app,
    coalesce(NEW.source_system, 'supabase'),
    v_before,
    v_after,
    coalesce(NEW.metadata, '{}'::jsonb),
    now()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cockpit_issue_reports_audit ON public.cockpit_issue_reports;
CREATE TRIGGER trg_cockpit_issue_reports_audit
AFTER INSERT OR UPDATE ON public.cockpit_issue_reports
FOR EACH ROW EXECUTE FUNCTION public.trg_cockpit_issue_reports_audit();

-- 5. Security-definer role helpers
CREATE OR REPLACE FUNCTION public.cockpit_is_ceo()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_is_ceo boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT exists (
    SELECT 1
    FROM public.cockpit_members cm
    JOIN auth.users au ON au.id = cm.auth_user_id
    WHERE cm.active = true
      AND cm.auth_user_id = v_uid
      AND au.email_confirmed_at IS NOT NULL
      AND cm.email = lower(trim(au.email))
      AND (
        'ceo' = ANY(cm.roles)
        OR 'admin' = ANY(cm.roles)
      )
  ) INTO v_is_ceo;

  RETURN coalesce(v_is_ceo, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_has_role(required_role text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid;
  v_has_role boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT exists (
    SELECT 1
    FROM public.cockpit_members cm
    JOIN auth.users au ON au.id = cm.auth_user_id
    WHERE cm.active = true
      AND cm.auth_user_id = v_uid
      AND au.email_confirmed_at IS NOT NULL
      AND cm.email = lower(trim(au.email))
      AND (
        required_role = ANY(cm.roles)
        OR 'admin' = ANY(cm.roles)
      )
  ) INTO v_has_role;

  RETURN coalesce(v_has_role, false);
END;
$$;

-- 6. Authenticated RPC: cockpit_submit_issue_report(app, page, text, role)
CREATE OR REPLACE FUNCTION public.cockpit_submit_issue_report(
  p_app text,
  p_page text,
  p_text text,
  p_role text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_app text;
  v_page text;
  v_text text;
  v_role text;
  v_email text;
  v_uid uuid;
  v_report_id bigint;
BEGIN
  v_uid := auth.uid();
  v_email := lower(trim(coalesce(
    auth.jwt() ->> 'email',
    current_setting('request.jwt.claim.email', true),
    ''
  )));

  -- Validate bounded nonblank values
  v_app := trim(coalesce(p_app, ''));
  v_page := trim(coalesce(p_page, ''));
  v_text := trim(coalesce(p_text, ''));
  v_role := trim(coalesce(p_role, ''));

  IF v_uid IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Sign in before reporting an issue';
  END IF;

  IF v_app = '' OR length(v_app) > 64 THEN
    RAISE EXCEPTION 'app must be nonblank and at most 64 characters';
  END IF;

  IF v_page = '' OR length(v_page) > 255 THEN
    RAISE EXCEPTION 'page must be nonblank and at most 255 characters';
  END IF;

  IF v_text = '' OR length(v_text) > 10000 THEN
    RAISE EXCEPTION 'text must be nonblank and at most 10000 characters';
  END IF;

  IF v_role = '' OR length(v_role) > 64 THEN
    RAISE EXCEPTION 'role must be nonblank and at most 64 characters';
  END IF;

  IF v_role IS DISTINCT FROM (CASE v_app
    WHEN 'media-buyer' THEN 'media_buyer'
    WHEN 'client-success' THEN 'csm'
    WHEN 'creative' THEN 'creative'
    WHEN 'editor' THEN 'editor'
    ELSE NULL
  END) THEN
    RAISE EXCEPTION 'App and role do not match';
  END IF;

  -- Require role or admin/CEO
  IF NOT (public.cockpit_has_role(v_role) OR public.cockpit_has_role('admin') OR public.cockpit_is_ceo()) THEN
    RAISE EXCEPTION 'Permission denied: caller lacks required role or admin/CEO access';
  END IF;

  -- Insert issue report (trigger automatically appends audit log entry)
  INSERT INTO public.cockpit_issue_reports (
    kind,
    app,
    page,
    text,
    role,
    actor_email,
    source_system,
    created_by,
    metadata
  ) VALUES (
    'issue',
    v_app,
    v_page,
    v_text,
    v_role,
    nullif(v_email, ''),
    'rpc',
    coalesce(nullif(v_email, ''), 'authenticated-cockpit-user'),
    jsonb_build_object(
      'submitted_via', 'rpc',
      'auth_user_id', v_uid
    )
  )
  RETURNING id INTO v_report_id;

  RETURN v_report_id;
END;
$$;

-- 7. Row Level Security & Grants
ALTER TABLE public.cockpit_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_issue_reports ENABLE ROW LEVEL SECURITY;

-- Policies: public.cockpit_members
-- Browser users read only their active member row; admin/CEO can read all active rows
DROP POLICY IF EXISTS cockpit_members_select_own ON public.cockpit_members;
CREATE POLICY cockpit_members_select_own
ON public.cockpit_members
FOR SELECT
TO authenticated
USING (
  active = true
  AND (
    auth.uid() IS NOT NULL
    AND auth_user_id = auth.uid()
    AND email = lower(trim(coalesce(auth.jwt() ->> 'email', '')))
  )
);

DROP POLICY IF EXISTS cockpit_members_select_admin ON public.cockpit_members;
CREATE POLICY cockpit_members_select_admin
ON public.cockpit_members
FOR SELECT
TO authenticated
USING (
  public.cockpit_has_role('admin') OR public.cockpit_is_ceo()
);

-- Policies: public.cockpit_issue_reports
-- Admin/CEO can read issue reports; no direct browser writes
DROP POLICY IF EXISTS cockpit_issue_reports_select_admin ON public.cockpit_issue_reports;
CREATE POLICY cockpit_issue_reports_select_admin
ON public.cockpit_issue_reports
FOR SELECT
TO authenticated
USING (
  public.cockpit_has_role('admin') OR public.cockpit_is_ceo()
);

-- Policies: public.cockpit_audit_log
-- Admin/CEO can read audit log; immutable to browser roles (no write policies)
DROP POLICY IF EXISTS cockpit_audit_log_select_admin ON public.cockpit_audit_log;
CREATE POLICY cockpit_audit_log_select_admin
ON public.cockpit_audit_log
FOR SELECT
TO authenticated
USING (
  public.cockpit_has_role('admin') OR public.cockpit_is_ceo()
);

-- Permissions and grants
REVOKE ALL ON public.cockpit_members FROM public, anon, authenticated;
REVOKE ALL ON public.cockpit_issue_reports FROM public, anon, authenticated;
REVOKE ALL ON public.cockpit_audit_log FROM public, anon, authenticated;

REVOKE ALL ON FUNCTION public.cockpit_is_ceo() FROM public, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_has_role(text) FROM public, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_submit_issue_report(text, text, text, text) FROM public, anon, authenticated, service_role;

-- Least execute grants
GRANT EXECUTE ON FUNCTION public.cockpit_is_ceo() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_has_role(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_submit_issue_report(text, text, text, text) TO authenticated, service_role;

-- Authenticated table grants (reads constrained by RLS, no direct browser writes)
GRANT SELECT ON public.cockpit_members TO authenticated;
GRANT SELECT ON public.cockpit_issue_reports TO authenticated;
GRANT SELECT ON public.cockpit_audit_log TO authenticated;

-- Service role is backend door
GRANT ALL ON public.cockpit_members TO service_role;
GRANT ALL ON public.cockpit_issue_reports TO service_role;
GRANT ALL ON public.cockpit_audit_log TO service_role;

DO $$
DECLARE
  seq_name text;
BEGIN
  seq_name := pg_get_serial_sequence('public.cockpit_issue_reports', 'id');
  IF seq_name IS NOT NULL THEN
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO service_role', seq_name);
  END IF;
END;
$$;

COMMIT;
