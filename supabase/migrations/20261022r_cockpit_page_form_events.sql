-- Where visitors stop on a client's own form page (Merge Studio first).
-- Muhammed, 2026-10-22: "make sure to add the tracking code that detects if
-- the leads are falling during the completion of the form."
--
-- The page sends one small event per screen a visit reaches (sendBeacon) to
-- the Edge Function page-form-events, which checks every field and writes
-- here with the service key. One row per visit and screen. No answers, no
-- names, phones or IP addresses: a random visit id kept in the browser tab,
-- the form version, the screen, and where the visit came from (utm, ad ids).
--
-- The Lead page's funnel counts only rows from the page's own hosts
-- (cockpit_page_forms.event_hosts) and never test visits (session ids that
-- start with "test-").
BEGIN;

-- Hosts that may post events for a page and whose events count. localhost
-- may also post (tests) but never counts. Add the live domain at go-live.
ALTER TABLE public.cockpit_page_forms
  ADD COLUMN IF NOT EXISTS event_hosts text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS public.cockpit_page_form_events (
  id bigserial PRIMARY KEY,
  slug text NOT NULL REFERENCES public.cockpit_page_forms (slug) ON DELETE CASCADE,
  -- The server's clock.
  at timestamptz NOT NULL DEFAULT now(),
  origin_host text NOT NULL,
  -- Random, made in the visitor's tab; "test-" for headless checks.
  session_id text NOT NULL CHECK (session_id ~ '^[A-Za-z0-9-]{8,64}$'),
  form_version text NOT NULL CHECK (form_version ~ '^[A-Za-z0-9._-]{1,20}$'),
  -- intro, q:<question key>, contact, send (pressed send in the survey), thanks.
  screen text NOT NULL CHECK (screen ~ '^(intro|contact|send|thanks|q:[a-z][a-z0-9_]{1,39})$'),
  step smallint CHECK (step BETWEEN 0 AND 40),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  ad_id text,
  campaign_id text,
  has_fbclid boolean NOT NULL DEFAULT false,
  device text CHECK (device IN ('mobile', 'tablet', 'desktop')),
  UNIQUE (slug, session_id, screen)
);
COMMENT ON TABLE public.cockpit_page_form_events IS
  'One row per visit and screen reached on a client form page (olivar-landing step-form pages), written by the Edge Function page-form-events. No answers and no personal data.';
CREATE INDEX IF NOT EXISTS cockpit_page_form_events_slug_at
  ON public.cockpit_page_form_events (slug, at);

ALTER TABLE public.cockpit_page_form_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_page_form_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.cockpit_page_form_events_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.cockpit_page_form_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cockpit_page_form_events_id_seq TO service_role;

-- The funnel for one version of a page since a time: visits per screen, visits
-- per version (so the Lead page can offer the versions that have any), the
-- last event, and the hosts counted. cockpit-media-api calls it after its
-- scope check.
CREATE OR REPLACE FUNCTION public.cockpit_page_form_funnel(p_slug text, p_version text, p_since timestamptz)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH f AS (
    SELECT event_hosts FROM public.cockpit_page_forms WHERE slug = p_slug
  ), e AS (
    SELECT ev.form_version, ev.screen, ev.session_id, ev.at
    FROM public.cockpit_page_form_events ev, f
    WHERE ev.slug = p_slug
      AND ev.at >= p_since
      AND ev.origin_host = ANY (f.event_hosts)
      AND ev.session_id NOT LIKE 'test-%'
  )
  SELECT jsonb_build_object(
    'screens', (SELECT coalesce(jsonb_object_agg(screen, n), '{}'::jsonb)
                FROM (SELECT screen, count(DISTINCT session_id) AS n FROM e
                      WHERE form_version = p_version GROUP BY screen) s),
    'versions', (SELECT coalesce(jsonb_agg(jsonb_build_object('version', form_version, 'visits', n) ORDER BY form_version), '[]'::jsonb)
                 FROM (SELECT form_version, count(DISTINCT session_id) AS n FROM e GROUP BY form_version) v),
    'lastAt', (SELECT max(at) FROM e),
    'hosts', (SELECT to_jsonb(event_hosts) FROM f)
  );
$$;
REVOKE ALL ON FUNCTION public.cockpit_page_form_funnel(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_page_form_funnel(text, text, timestamptz) TO service_role;

UPDATE public.cockpit_page_forms
SET event_hosts = ARRAY['mergestudio-form.vercel.app']
WHERE slug = 'mergestudio' AND event_hosts = '{}';

COMMIT;
