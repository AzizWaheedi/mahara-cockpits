-- A client's own form page (olivar-landing "step-form" pages, Merge Studio
-- first) and the versions of its questions published from the media buyer
-- cockpit (client page > Lead page). Muhammed, 2026-10-22: the media buyer
-- adds and removes questions without a developer; edits go live at once,
-- with every version kept so any one can be switched back.
--
-- The page reads the live questions from the public bucket page-forms
-- (<slug>/live.json). cockpit-media-api writes that file with the service
-- key after these functions record the version; nothing here is reachable
-- from a browser except the scope check, which returns no form data.
BEGIN;

CREATE TABLE IF NOT EXISTS public.cockpit_page_forms (
  slug text PRIMARY KEY CHECK (slug ~ '^[a-z][a-z0-9-]{1,40}$'),
  -- The client's name as campaigns and cockpit_members.clients spell it.
  client_name text NOT NULL,
  title text NOT NULL,
  -- Where the page is served (the review URL until the live domain is set).
  -- The editor previews it, and reads its built questions (/form.json) before
  -- the first publish.
  site_url text NOT NULL CHECK (site_url ~ '^https://[a-z0-9.-]+$'),
  object_path text NOT NULL CHECK (object_path ~ '^[a-z][a-z0-9-]*/live\.json$'),
  -- Photos the editor may put on a question or an answer; each ships with every build.
  photos text[] NOT NULL DEFAULT '{}',
  -- Launch question key -> query key of its own GHL field (tools/ghl_form_setup.py).
  bindings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(bindings) = 'object'),
  live_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cockpit_page_form_versions (
  slug text NOT NULL REFERENCES public.cockpit_page_forms(slug),
  version integer NOT NULL CHECK (version >= 1),
  spec jsonb NOT NULL CHECK (jsonb_typeof(spec->'questions') = 'array'),
  summary text NOT NULL,
  -- build: the questions the page was built with, stored at the first publish
  -- so it can be switched back to. cockpit: published from the editor.
  source text NOT NULL CHECK (source IN ('build', 'cockpit')),
  actor_id uuid,
  actor_email text,
  action_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- First time the public file was read back holding this version. Null:
  -- recorded, but the write never confirmed (it never went live).
  first_live_at timestamptz,
  PRIMARY KEY (slug, version)
);

ALTER TABLE public.cockpit_page_forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_page_form_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_page_forms, public.cockpit_page_form_versions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cockpit_page_forms, public.cockpit_page_form_versions TO service_role;

-- Who may read or publish a page's questions: the same rule as the media
-- buyer's campaign actions (cockpit_media_scope). A confirmed, active member
-- who is a founder, an admin or a media buyer, and whose client list (when
-- they have one) names the page's client. Returns the pages in reach;
-- raises when the caller is not allowed or the named page is not theirs.
CREATE OR REPLACE FUNCTION public.cockpit_page_form_scope(p_slug text DEFAULT NULL, p_client text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE m public.cockpit_members; founder boolean; slugs text[];
BEGIN
 SELECT cm.* INTO m FROM public.cockpit_members cm JOIN auth.users u ON u.id = cm.auth_user_id
 WHERE cm.auth_user_id = auth.uid() AND cm.active AND u.email_confirmed_at IS NOT NULL
   AND cm.email = lower(btrim(u.email));
 IF m.auth_user_id IS NULL THEN RAISE EXCEPTION 'Current confirmed membership required'; END IF;
 founder := m.email IN ('aziz@maharamedia.com', 'awaheedi2008@gmail.com');
 IF NOT (founder OR 'admin' = ANY(m.roles) OR 'media_buyer' = ANY(m.roles)) THEN
   RAISE EXCEPTION 'Media buyer access required';
 END IF;
 SELECT coalesce(array_agg(f.slug ORDER BY f.slug), '{}') INTO slugs
 FROM public.cockpit_page_forms f
 WHERE (p_slug IS NULL OR f.slug = p_slug)
   AND (p_client IS NULL OR lower(btrim(f.client_name)) = lower(btrim(p_client)))
   AND (founder OR 'admin' = ANY(m.roles) OR cardinality(m.clients) = 0 OR EXISTS (
     SELECT 1 FROM unnest(m.clients) allowed WHERE lower(btrim(allowed)) = lower(btrim(f.client_name))));
 IF p_slug IS NOT NULL AND cardinality(slugs) <> 1 THEN
   RAISE EXCEPTION 'That page is not on your access list';
 END IF;
 RETURN jsonb_build_object('actor', auth.uid(), 'email', m.email, 'slugs', to_jsonb(slugs));
END $function$;
REVOKE ALL ON FUNCTION public.cockpit_page_form_scope(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_page_form_scope(text, text) TO authenticated, service_role;

-- Record a new version from the editor. p_base is the version the draft
-- started from (0: the built questions, before any publish), so two people
-- editing at once cannot overwrite each other. The first publish also stores
-- the built questions as version 1 (source 'build'). Returns the new number.
CREATE OR REPLACE FUNCTION public.cockpit_page_form_record(
  p_slug text, p_spec jsonb, p_summary text, p_base integer, p_baseline jsonb,
  p_actor uuid, p_email text, p_action uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE f public.cockpit_page_forms; latest integer; n integer;
BEGIN
 SELECT * INTO f FROM public.cockpit_page_forms WHERE slug = p_slug FOR UPDATE;
 IF f.slug IS NULL THEN RAISE EXCEPTION 'Unknown page'; END IF;
 IF coalesce(f.live_version, 0) <> coalesce(p_base, -1) THEN
   RAISE EXCEPTION 'Someone published a newer version of these questions. Reload the editor to see it.';
 END IF;
 SELECT max(version) INTO latest FROM public.cockpit_page_form_versions WHERE slug = p_slug;
 IF latest IS NULL THEN
   IF p_baseline IS NULL OR jsonb_typeof(p_baseline->'questions') <> 'array' THEN
     RAISE EXCEPTION 'The questions the page was built with are required for the first publish';
   END IF;
   INSERT INTO public.cockpit_page_form_versions(slug, version, spec, summary, source, first_live_at)
   VALUES (p_slug, 1, jsonb_build_object('questions', p_baseline->'questions'), 'The questions the page was built with', 'build', f.created_at);
   latest := 1;
 END IF;
 n := latest + 1;
 INSERT INTO public.cockpit_page_form_versions(slug, version, spec, summary, source, actor_id, actor_email, action_id)
 VALUES (p_slug, n, p_spec, left(coalesce(nullif(btrim(p_summary), ''), 'Published'), 400), 'cockpit', p_actor, p_email, p_action);
 RETURN n;
END $function$;

-- The public file was read back holding version p_version: it is live.
CREATE OR REPLACE FUNCTION public.cockpit_page_form_go_live(p_slug text, p_version integer, p_base integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE f public.cockpit_page_forms;
BEGIN
 SELECT * INTO f FROM public.cockpit_page_forms WHERE slug = p_slug FOR UPDATE;
 IF f.slug IS NULL THEN RAISE EXCEPTION 'Unknown page'; END IF;
 IF coalesce(f.live_version, 0) <> coalesce(p_base, -1) THEN
   RAISE EXCEPTION 'The live version changed while this one was being written. Reload the editor and reconcile.';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.cockpit_page_form_versions WHERE slug = p_slug AND version = p_version) THEN
   RAISE EXCEPTION 'Unknown version';
 END IF;
 UPDATE public.cockpit_page_form_versions SET first_live_at = coalesce(first_live_at, now())
 WHERE slug = p_slug AND version = p_version;
 UPDATE public.cockpit_page_forms SET live_version = p_version, updated_at = now() WHERE slug = p_slug;
END $function$;

REVOKE ALL ON FUNCTION public.cockpit_page_form_record(text, jsonb, text, integer, jsonb, uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cockpit_page_form_go_live(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_page_form_record(text, jsonb, text, integer, jsonb, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_page_form_go_live(text, integer, integer) TO service_role;

-- Public downloads need no object SELECT policy. Service-role uploads bypass
-- storage RLS; deliberately no browser INSERT, UPDATE or DELETE policy.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('page-forms', 'page-forms', true, 131072, ARRAY['application/json']::text[])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Merge Studio: the first page. Bindings match form.json's launch questions.
INSERT INTO public.cockpit_page_forms (slug, client_name, title, site_url, object_path, photos, bindings)
VALUES (
  'mergestudio', 'mergestudio.kw', 'Merge Studio form page', 'https://mergestudio-form.vercel.app', 'mergestudio/live.json',
  ARRAY['type-villa', 'type-apartment', 'type-renovation', 'type-construction', 'type-other',
        'help-interior', 'help-design-build', 'help-execution', 'help-unsure',
        'stage-plans', 'stage-construction', 'stage-ready', 'stage-renovation',
        'band-dining', 'band-stairs', 'band-living', 'hero-living'],
  '{"project_type": "ms_project_type", "help": "ms_help", "stage": "ms_stage", "timing": "ms_timing", "size": "ms_size"}'::jsonb
)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
