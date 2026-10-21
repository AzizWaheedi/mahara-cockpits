-- CSM decks: video posters (docs/csm-decks/VIDEOS.md 9, DESIGN.md 22.5.3).
-- Apply after 20261020160000_csm_launch_ads_drive.sql.
--
-- Prep's Videos section and the notes window show each recorded slot as a
-- poster card. A real picture needs the provider's own thumbnail; for Loom
-- that address carries a hash only oEmbed gives, and the browser cannot ask
-- oEmbed (connect-src allows only the app and Supabase). So the VPS worker
-- (hermes/editor-desk `deck-import`, its last step) asks once and keeps the
-- address on the row; a new link clears it.
--
-- Two worker functions (service_role only), one trigger function (nobody),
-- the read's shape and the audit replaced with one change each, and the six
-- seeds' posters backfilled. The poster is a fact about the link, not an
-- edit: revision, updated_at and updated_by never change for it, and a
-- failed check (poster_checked_at alone) writes no audit row. The file
-- applies twice without error.
BEGIN;

ALTER TABLE public.cockpit_csm_deck_videos
  ADD COLUMN IF NOT EXISTS poster_url text,
  ADD COLUMN IF NOT EXISTS poster_checked_at timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cockpit_csm_deck_videos_poster'
                   AND conrelid = 'public.cockpit_csm_deck_videos'::regclass) THEN
    ALTER TABLE public.cockpit_csm_deck_videos ADD CONSTRAINT cockpit_csm_deck_videos_poster CHECK (
      poster_url IS NULL OR (
        url IS NOT NULL AND char_length(poster_url) <= 500 AND
        poster_url ~ '^https://(cdn[.]loom[.]com|embed-ssl[.]wistia[.]com|i[.]vimeocdn[.]com|i[.]ytimg[.]com)/[A-Za-z0-9/_.~%=&?:+-]+$'));
  END IF;
END $$;

-- A new link clears the poster (save and clear are not replaced).
CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_video_poster_reset() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.url IS DISTINCT FROM OLD.url THEN
    NEW.poster_url := NULL;
    NEW.poster_checked_at := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS cockpit_csm_deck_videos_poster_reset ON public.cockpit_csm_deck_videos;
CREATE TRIGGER cockpit_csm_deck_videos_poster_reset BEFORE UPDATE ON public.cockpit_csm_deck_videos
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_csm_deck_video_poster_reset();

-- The read carries it.
CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_video_json(v public.cockpit_csm_deck_videos) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'deck', v.deck, 'slotKey', v.slot_key, 'lang', v.lang, 'provider', v.provider,
    'url', v.url, 'embedUrl', v.embed_url, 'title', v.title, 'durationSeconds', v.duration_seconds,
    'revision', v.revision, 'updatedBy', v.updated_by, 'updatedAt', to_jsonb(v.updated_at),
    'posterUrl', v.poster_url)
$$;

-- The audit: the worker names itself (cockpit.deck_actor, as the decks'
-- trigger reads it since DRIVE-IMPORT.md 5), and a failed check once a day
-- is not an action.
CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_video_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  old_row jsonb; new_row jsonb; row_any jsonb; who text; act text;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN new_row := to_jsonb(NEW); END IF;
  IF TG_OP = 'UPDATE' AND (new_row - 'poster_checked_at') = (old_row - 'poster_checked_at') THEN
    RETURN NEW;
  END IF;
  row_any := coalesce(new_row, old_row);
  act := coalesce(nullif(current_setting('cockpit.deck_action', true), ''), lower(TG_OP));
  SELECT lower(btrim(u.email)) INTO who FROM auth.users u WHERE u.id = auth.uid();
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES (act, 'cockpit_csm_deck_videos',
          (row_any->>'deck') || ':' || (row_any->>'slot_key') || ':' || (row_any->>'lang'),
          coalesce(who, nullif(current_setting('cockpit.deck_actor', true), ''), session_user),
          'client-success', 'supabase', old_row, new_row,
          jsonb_build_object('op', TG_OP, 'deck', row_any->>'deck', 'slot_key', row_any->>'slot_key',
                             'lang', row_any->>'lang', 'database_role', current_setting('role', true)));
  RETURN coalesce(NEW, OLD);
END $$;

-- The slots waiting for a poster: recorded, not Drive (it has no oEmbed;
-- the card builds its thumbnail), no poster, not checked in 24 hours. At
-- most six, the oldest change first. Writes nothing.
CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_video_posters_due(p_worker text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_worker IS NULL OR p_worker !~ '^[a-z0-9@._:-]{1,80}$' THEN
    RAISE EXCEPTION 'Name the worker.' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('due', coalesce((
    SELECT jsonb_agg(jsonb_build_object('deck', d.deck, 'slotKey', d.slot_key, 'lang', d.lang,
                                        'provider', d.provider, 'url', d.url) ORDER BY d.updated_at, d.deck, d.slot_key, d.lang)
      FROM (SELECT v.* FROM public.cockpit_csm_deck_videos v
             WHERE v.url IS NOT NULL AND v.provider <> 'drive' AND v.poster_url IS NULL
               AND (v.poster_checked_at IS NULL OR v.poster_checked_at < now() - interval '24 hours')
             ORDER BY v.updated_at, v.deck, v.slot_key, v.lang LIMIT 6) d), '[]'::jsonb));
END $$;

-- The worker's answer for one slot: the provider's own picture, or null
-- when any step failed (asked again in a day).
CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_video_poster_save(
  p_worker text, p_deck text, p_slot_key text, p_lang text, p_url text, p_poster_url text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v public.cockpit_csm_deck_videos; v_host text;
BEGIN
  IF p_worker IS NULL OR p_worker !~ '^[a-z0-9@._:-]{1,80}$' THEN
    RAISE EXCEPTION 'Name the worker.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v FROM public.cockpit_csm_deck_videos x
   WHERE x.deck = p_deck AND x.slot_key = p_slot_key AND x.lang = p_lang FOR UPDATE;
  -- The link changed while the worker looked: nothing is written.
  IF v.deck IS NULL OR v.url IS DISTINCT FROM p_url OR p_url IS NULL THEN
    RETURN jsonb_build_object('saved', false);
  END IF;
  IF p_poster_url IS NULL THEN
    UPDATE public.cockpit_csm_deck_videos x SET poster_checked_at = now()
     WHERE x.deck = v.deck AND x.slot_key = v.slot_key AND x.lang = v.lang;
    RETURN jsonb_build_object('saved', true, 'posterUrl', NULL);
  END IF;
  v_host := CASE v.provider WHEN 'loom' THEN 'cdn.loom.com' WHEN 'wistia' THEN 'embed-ssl.wistia.com'
                            WHEN 'vimeo' THEN 'i.vimeocdn.com' WHEN 'youtube' THEN 'i.ytimg.com' END;
  IF v_host IS NULL OR lower(substring(p_poster_url from '^https://([^/?#]+)/')) IS DISTINCT FROM v_host THEN
    RAISE EXCEPTION 'That poster is not from the video''s provider.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.deck_action', 'deck_video.poster', true);
  PERFORM set_config('cockpit.deck_actor', 'worker:' || p_worker, true);
  UPDATE public.cockpit_csm_deck_videos x SET poster_url = p_poster_url, poster_checked_at = now()
   WHERE x.deck = v.deck AND x.slot_key = v.slot_key AND x.lang = v.lang;
  RETURN jsonb_build_object('saved', true, 'posterUrl', p_poster_url);
END $$;

REVOKE ALL ON FUNCTION
  public.cockpit_csm_deck_video_posters_due(text),
  public.cockpit_csm_deck_video_poster_save(text, text, text, text, text, text),
  public.cockpit_csm_deck_video_poster_reset(),
  public.cockpit_csm_deck_video_json(public.cockpit_csm_deck_videos),
  public.cockpit_csm_deck_video_audit()
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.cockpit_csm_deck_video_posters_due(text),
  public.cockpit_csm_deck_video_poster_save(text, text, text, text, text, text)
TO service_role;

-- The six seeds' posters, read from each provider's oEmbed on 2026-10-20 and
-- each checked to answer 200 image/jpeg, only where the row's link is still
-- the seed's and it has no poster.
DO $$
BEGIN
  PERFORM set_config('cockpit.deck_action', 'deck_video.poster', true);
  PERFORM set_config('cockpit.deck_actor', 'migration 20261020160200_csm_deck_video_posters', true);
  UPDATE public.cockpit_csm_deck_videos v
     SET poster_url = s.poster, poster_checked_at = now()
    FROM (VALUES
      ('onboarding', 'welcome',           'any', 'https://fast.wistia.net/embed/iframe/up0z6n691k',
       'https://embed-ssl.wistia.com/deliveries/c3cdb9067a8a3c9ae21dede3cf45611b739ee3f1.jpg?image_crop_resized=960x540'),
      ('onboarding', 'meta-access',       'any', 'https://www.loom.com/share/e2d83bffee614d9aa035d898d37d8989',
       'https://cdn.loom.com/sessions/thumbnails/e2d83bffee614d9aa035d898d37d8989-b17bc3f4ce782f9b.jpg'),
      ('onboarding', 'whatsapp-calendar', 'any', 'https://www.loom.com/share/4ddc5519935f4ba8bdc7ac6f3667a701',
       'https://cdn.loom.com/sessions/thumbnails/4ddc5519935f4ba8bdc7ac6f3667a701-1ddb7d7f640afcbd.jpg'),
      ('launch',     'portal-guide',      'en',  'https://fast.wistia.net/embed/iframe/lxlse6ckhf',
       'https://embed-ssl.wistia.com/deliveries/02b381c067d9a4e711551bdc4923c80a0b28e6f6.jpg?image_crop_resized=960x540'),
      ('launch',     'portal-guide',      'ar',  'https://fast.wistia.net/embed/iframe/hyuxh7skjv',
       'https://embed-ssl.wistia.com/deliveries/234d6305c6581a586700670201e21c8f488eaa5f.jpg?image_crop_resized=960x540'),
      ('launch',     'calendar-hours',    'any', 'https://www.loom.com/share/6aa67297dfcf421887f8961d3c1c7768',
       'https://cdn.loom.com/sessions/thumbnails/6aa67297dfcf421887f8961d3c1c7768-a2384fa2a097cc77.jpg')
    ) AS s(deck, slot_key, lang, link, poster)
   WHERE v.deck = s.deck AND v.slot_key = s.slot_key AND v.lang = s.lang
     AND v.url = (public.cockpit_csm_deck_video_parse(s.link) ->> 'url') AND v.poster_url IS NULL;
END $$;

COMMIT;
