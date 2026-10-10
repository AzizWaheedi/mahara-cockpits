-- Social calendar on Supabase: the server is the gate, and every change
-- leaves an audit row.
--
-- 20260924s let any active seat read, write and delete every social table
-- from the browser, with no audit. The creative cockpit now writes these
-- tables directly (apps/creative-director-cockpit/src/lib/social.ts), so:
--
-- 1. Reads stay exactly as they were: an active seat or the CEO.
-- 2. Writes need the creative role or the CEO. A browser may only queue
--    job kinds Salma has a handler for (hermes/salma/salma.py KINDS), and
--    only as `queued` with no attempts: it cannot mark work done, failed
--    or running. It cannot write the Pages list or GoHighLevel's accounts
--    (Salma and the service key own those), cannot hard-delete a client,
--    a month, a job or a photo, and cannot delete a post GoHighLevel holds.
-- 3. One audit row per insert, update and delete on the six tables people
--    and Salma change, with the signed-in person's email as the actor (or
--    the service role's name for the worker).
-- 4. The client's sign-off link is made by one server function: it checks
--    the posts are finished, makes the review link on the existing review
--    page (/editor/review/<token>), marks the posts sent and audits it, in
--    one transaction. It makes a link; a person sends it.
-- 5. Uploads to the public `social-media` bucket need the same role, so the
--    browser can get a signed upload link (it had no storage policy, and
--    the cockpit hid that by falling back to the public address).
--
-- Service-role callers (Salma, the guardian) bypass row security, so none
-- of this changes what the worker can do.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Who may change social media work.

CREATE OR REPLACE FUNCTION public.cockpit_social_writer()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(public.cockpit_has_role('creative') OR public.cockpit_is_ceo(), false)
$$;
REVOKE ALL ON FUNCTION public.cockpit_social_writer() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_social_writer() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Grants: exactly the verbs the policies below allow.

REVOKE ALL ON public.social_clients, public.social_assets, public.social_bank,
  public.social_batches, public.social_posts, public.social_jobs,
  public.social_accounts, public.social_meta_pages, public.social_worker_status
  FROM anon;

REVOKE INSERT, UPDATE, DELETE ON public.social_accounts, public.social_meta_pages
  FROM authenticated;
REVOKE DELETE ON public.social_clients, public.social_assets, public.social_bank,
  public.social_batches, public.social_jobs
  FROM authenticated;

GRANT SELECT ON public.social_accounts, public.social_meta_pages,
  public.social_worker_status TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.social_clients, public.social_assets,
  public.social_bank, public.social_batches, public.social_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.social_posts TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Policies. The FOR ALL seat policies from 20260924s go; reads keep the
--    same rule under a read-only name.

DO $policies$
DECLARE t text; p record;
BEGIN
  -- Any policy that lets a browser write these tables goes, whatever its
  -- name, so the only doors left are the ones below. Read-only policies stay.
  FOR p IN SELECT policyname, tablename FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND cmd <> 'SELECT'
      AND tablename = ANY (ARRAY['social_clients','social_assets','social_bank',
        'social_batches','social_posts','social_jobs','social_accounts','social_meta_pages',
        'social_worker_status'])
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', p.policyname, p.tablename);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['social_clients','social_assets','social_bank',
    'social_batches','social_posts','social_jobs','social_accounts','social_meta_pages']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_seat', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      'USING (public.cockpit_has_active_seat() OR public.cockpit_is_ceo())', t || '_read', t);
  END LOOP;

  FOREACH t IN ARRAY ARRAY['social_clients','social_assets','social_bank',
    'social_batches','social_posts']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated '
      'WITH CHECK (public.cockpit_social_writer())', t || '_write', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_change', t);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated '
      'USING (public.cockpit_social_writer()) WITH CHECK (public.cockpit_social_writer())',
      t || '_change', t);
  END LOOP;
END $policies$;

-- A post GoHighLevel already holds is removed there first, so the two never
-- disagree about what the client was sent.
DROP POLICY IF EXISTS social_posts_remove ON public.social_posts;
CREATE POLICY social_posts_remove ON public.social_posts FOR DELETE TO authenticated
  USING (public.cockpit_social_writer() AND ghl_post_id IS NULL);

-- A browser asks for work; only Salma says how the work went.
DROP POLICY IF EXISTS social_jobs_write ON public.social_jobs;
CREATE POLICY social_jobs_write ON public.social_jobs FOR INSERT TO authenticated
  WITH CHECK (
    public.cockpit_social_writer()
    AND status = 'queued' AND attempts = 0
    AND kind = ANY (ARRAY['fill','plan','caption','generate','cover','accounts','words','motion'])
  );
DROP POLICY IF EXISTS social_jobs_change ON public.social_jobs;
CREATE POLICY social_jobs_change ON public.social_jobs FOR UPDATE TO authenticated
  USING (public.cockpit_social_writer())
  WITH CHECK (
    public.cockpit_social_writer()
    AND status = 'queued' AND attempts = 0
    AND kind = ANY (ARRAY['fill','plan','caption','generate','cover','accounts','words','motion'])
  );

-- ---------------------------------------------------------------------------
-- 4. One audit row for every change.

CREATE OR REPLACE FUNCTION public.cockpit_audit_social_changes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor text;
  v_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
BEGIN
  IF v_uid IS NOT NULL THEN
    SELECT lower(btrim(au.email)) INTO v_actor FROM auth.users au WHERE au.id = v_uid;
    v_actor := coalesce(v_actor, v_uid::text);
  ELSE
    -- The worker and anything else holding the service key, by role name.
    v_actor := coalesce(nullif(auth.jwt() ->> 'role', ''), session_user);
  END IF;
  INSERT INTO public.cockpit_audit_log (
    action, entity_type, entity_id, actor_email, source_app, source_system, before, after
  ) VALUES (
    TG_OP, TG_TABLE_NAME,
    coalesce(v_row ->> 'id', v_row ->> 'client_task_id'),
    v_actor, 'creative-social', 'supabase',
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END
  );
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_audit_social_changes() FROM PUBLIC, anon, authenticated, service_role;

DO $triggers$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['social_clients','social_assets','social_bank',
    'social_batches','social_posts','social_jobs']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t || '_audit', t);
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON public.%I '
      'FOR EACH ROW EXECUTE FUNCTION public.cockpit_audit_social_changes()', t || '_audit', t);
  END LOOP;
END $triggers$;

-- ---------------------------------------------------------------------------
-- 5. The client's sign-off link.

CREATE OR REPLACE FUNCTION public.cockpit_social_send_signoff(
  p_client_task_id text, p_month text, p_post_ids text[], p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_email text;
  v_asked integer;
  v_ready text[];
  v_items jsonb;
  v_made jsonb;
  v_token text;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 600);
BEGIN
  IF NOT public.cockpit_social_writer() THEN
    RAISE EXCEPTION 'Only the creative team can send posts for sign-off.' USING ERRCODE = '42501';
  END IF;
  SELECT lower(btrim(u.email)) INTO v_email FROM auth.users u WHERE u.id = auth.uid();
  IF coalesce(btrim(p_client_task_id), '') = '' THEN
    RAISE EXCEPTION 'Pick a client first.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_month, '') !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'That is not a month.' USING ERRCODE = '22023';
  END IF;
  SELECT count(DISTINCT x) INTO v_asked
    FROM unnest(coalesce(p_post_ids, '{}'::text[])) x WHERE coalesce(btrim(x), '') <> '';
  IF v_asked = 0 THEN
    RAISE EXCEPTION 'Pick at least one post to send.' USING ERRCODE = '22023';
  END IF;
  IF v_asked > 100 THEN
    RAISE EXCEPTION 'Send at most 100 posts in one link.' USING ERRCODE = '22023';
  END IF;

  -- Finished means pictures, a caption, and not already gone out.
  WITH picked AS (
    SELECT p.id, p.topic, p.scheduled_at,
      CASE
        WHEN jsonb_typeof(p.media) = 'array' AND jsonb_array_length(p.media) > 0 THEN p.media -> 0
        WHEN jsonb_typeof(p.images) = 'array' AND jsonb_array_length(p.images) > 0
          THEN jsonb_build_object('kind', 'image', 'url', p.images ->> 0)
      END AS lead
    FROM public.social_posts p
    WHERE p.client_task_id = p_client_task_id
      AND p.id = ANY (p_post_ids)
      AND btrim(coalesce(p.caption, '')) <> ''
      AND p.status IS DISTINCT FROM 'published'
  )
  SELECT array_agg(id ORDER BY scheduled_at, id),
         jsonb_agg(jsonb_build_object(
           'kind', 'post',
           'post_id', id,
           'title', coalesce(left(nullif(btrim(topic), ''), 200), 'Post'),
           -- What the reel of posts shows: the picture, or a video's cover.
           'video_url', CASE WHEN lead ->> 'kind' = 'video'
                             THEN coalesce(nullif(lead ->> 'cover', ''), lead ->> 'url')
                             ELSE lead ->> 'url' END,
           'poster_url', CASE WHEN lead ->> 'kind' = 'video' THEN nullif(lead ->> 'cover', '') END)
           ORDER BY scheduled_at, id)
    INTO v_ready, v_items
    FROM picked
   WHERE coalesce(lead ->> 'url', '') <> '';

  IF v_ready IS NULL THEN
    RAISE EXCEPTION 'None of those posts is finished yet. Each needs its pictures and a caption before the client sees it.'
      USING ERRCODE = '22023';
  END IF;

  -- The existing review link: checks the creative seat and that this seat
  -- may work on this client, then writes its own audit row.
  v_made := public.cockpit_review_create(
    to_char(to_date(p_month || '-01', 'YYYY-MM-DD'), 'FMMonth') || ' posts',
    v_note, NULL, p_client_task_id, v_email, v_items, 30);
  v_token := v_made ->> 'token';
  IF coalesce(v_token, '') = '' THEN
    RAISE EXCEPTION 'The link could not be made. Try again.';
  END IF;

  UPDATE public.social_posts
     SET client_status = 'sent', client_sent_at = now(), review_token = v_token, updated_at = now()
   WHERE id = ANY (v_ready);

  INSERT INTO public.cockpit_audit_log (
    action, entity_type, entity_id, actor_email, source_app, source_system, after
  ) VALUES (
    'social.signoff.send', 'social_batch', p_client_task_id || ':' || p_month,
    v_email, 'creative-social', 'supabase',
    jsonb_build_object('token', v_token, 'posts', to_jsonb(v_ready), 'note', v_note,
                       'asked', v_asked)
  );

  RETURN jsonb_build_object('token', v_token, 'sent', cardinality(v_ready),
                            'skipped', v_asked - cardinality(v_ready),
                            'posts', to_jsonb(v_ready));
END $$;
REVOKE ALL ON FUNCTION public.cockpit_social_send_signoff(text, text, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_social_send_signoff(text, text, text[], text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Uploads. Storage checks INSERT (and reads the new row back) before it
--    signs an upload link, so both are allowed for the same people, in this
--    one bucket only. The bucket is public already: nothing here widens who
--    can see a file.

DO $storage$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    GRANT SELECT, INSERT ON storage.objects TO authenticated;
    DROP POLICY IF EXISTS social_media_upload ON storage.objects;
    CREATE POLICY social_media_upload ON storage.objects FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'social-media' AND public.cockpit_social_writer());
    DROP POLICY IF EXISTS social_media_read ON storage.objects;
    CREATE POLICY social_media_read ON storage.objects FOR SELECT TO authenticated
      USING (bucket_id = 'social-media' AND public.cockpit_social_writer());
  END IF;
END $storage$;

NOTIFY pgrst, 'reload schema';
COMMIT;
