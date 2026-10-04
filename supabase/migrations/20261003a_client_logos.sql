-- Verified public brand images; metadata and uploads remain service-only.
BEGIN;

CREATE TABLE IF NOT EXISTS public.cockpit_client_logos (
  client_key text PRIMARY KEY CHECK (client_key <> '' AND client_key = lower(btrim(client_key))),
  clickup_task_id text NOT NULL,
  storage_path text NOT NULL CHECK (
    storage_path ~* '^([A-Za-z0-9][A-Za-z0-9._-]*/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp)$'
  ),
  source_url text NOT NULL,
  verified_at timestamptz NOT NULL,
  updated_by text NOT NULL CHECK (btrim(updated_by) <> ''),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cockpit_client_logos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_client_logos FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cockpit_client_logos TO service_role;

DROP TRIGGER IF EXISTS trg_cockpit_client_logos_touch ON public.cockpit_client_logos;
CREATE TRIGGER trg_cockpit_client_logos_touch
BEFORE UPDATE ON public.cockpit_client_logos
FOR EACH ROW EXECUTE FUNCTION public.cockpit_touch_updated_at();

CREATE OR REPLACE FUNCTION public.trg_cockpit_client_logos_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.cockpit_client_logos%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row := OLD;
  ELSE
    v_row := NEW;
  END IF;

  INSERT INTO public.cockpit_audit_log (
    action, entity_type, entity_id, actor_email, source_app,
    source_system, before, after
  ) VALUES (
    TG_OP,
    'cockpit_client_logos',
    v_row.client_key,
    v_row.updated_by,
    'media-buyer',
    'supabase',
    CASE WHEN TG_OP = 'INSERT' THEN null ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN null ELSE to_jsonb(NEW) END
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_cockpit_client_logos_audit() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS trg_cockpit_client_logos_audit ON public.cockpit_client_logos;
CREATE TRIGGER trg_cockpit_client_logos_audit
AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_client_logos
FOR EACH ROW EXECUTE FUNCTION public.trg_cockpit_client_logos_audit();

-- Public downloads require no object SELECT policy. Service-role uploads bypass
-- storage RLS; deliberately add no browser INSERT, UPDATE or DELETE policy.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'cockpit-client-logos',
  'cockpit-client-logos',
  true,
  2097152,
  ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

COMMIT;
