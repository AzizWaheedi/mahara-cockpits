-- Migration: 20260923e_cockpit_daily_checks.sql
-- Service-only historical/shadow store. Convex remains the live read path.

BEGIN;

CREATE TABLE IF NOT EXISTS public.cockpit_daily_checks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role text NOT NULL CHECK (role IN ('media_buyer', 'csm', 'creative')),
  owner_app text NOT NULL,
  day date NOT NULL,
  check_key text NOT NULL,
  label text NOT NULL,
  detail text,
  phase text,
  block text,
  display_order numeric,
  href text,
  done boolean NOT NULL,
  done_at timestamptz,
  source_system text NOT NULL DEFAULT 'convex',
  source_deployment text NOT NULL,
  source_id text NOT NULL,
  source_created_at timestamptz,
  source_snapshot_ts text NOT NULL,
  source_row jsonb NOT NULL,
  changed_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cockpit_daily_checks_owner CHECK (
    (role = 'media_buyer' AND owner_app = 'media-buyer') OR
    (role = 'csm' AND owner_app = 'client-success') OR
    (role = 'creative' AND owner_app = 'creative-director')
  ),
  CONSTRAINT cockpit_daily_checks_logical_unique UNIQUE (role, day, check_key),
  CONSTRAINT cockpit_daily_checks_source_unique UNIQUE (source_deployment, source_id)
);

CREATE INDEX IF NOT EXISTS idx_cockpit_daily_checks_owner_day
ON public.cockpit_daily_checks(owner_app, day DESC);

DROP TRIGGER IF EXISTS trg_cockpit_daily_checks_touch ON public.cockpit_daily_checks;
CREATE TRIGGER trg_cockpit_daily_checks_touch
BEFORE UPDATE ON public.cockpit_daily_checks
FOR EACH ROW EXECUTE FUNCTION public.cockpit_touch_updated_at();

CREATE OR REPLACE FUNCTION public.trg_cockpit_daily_checks_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.cockpit_daily_checks%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;

  INSERT INTO public.cockpit_audit_log (
    action, entity_type, entity_id, actor_email, source_app,
    source_system, before, after, metadata
  ) VALUES (
    TG_OP,
    'cockpit_daily_checks',
    v_row.id::text,
    v_row.changed_by,
    v_row.owner_app,
    v_row.source_system,
    CASE WHEN TG_OP = 'INSERT' THEN null ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN null ELSE to_jsonb(NEW) END,
    jsonb_build_object(
      'source_deployment', v_row.source_deployment,
      'source_id', v_row.source_id,
      'source_snapshot_ts', v_row.source_snapshot_ts
    )
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cockpit_daily_checks_audit ON public.cockpit_daily_checks;
CREATE TRIGGER trg_cockpit_daily_checks_audit
AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_daily_checks
FOR EACH ROW EXECUTE FUNCTION public.trg_cockpit_daily_checks_audit();

ALTER TABLE public.cockpit_daily_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_daily_checks FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cockpit_daily_checks TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cockpit_daily_checks_id_seq TO service_role;

COMMIT;
