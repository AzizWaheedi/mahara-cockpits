-- CSM decks: the video slots behind each main part of the onboarding and launch
-- decks (the CEO, 2026-10-20), so a part the CSM skips on the call can still be
-- watched. docs/csm-decks/VIDEOS.md is the contract this file builds; CONTENT.md
-- "Video slots" is the registry. Apply after 20261020090000.
--
-- 1. cockpit_csm_deck_videos: one row per deck, slot and language. A slot is
--    the same for every client, so there is no client column. A clear keeps
--    the row with its link removed; nobody deletes.
-- 2. The server checks every link against five providers' hosts and stores
--    the link people open and the embed address the player frames, both built
--    from constants and the captured ids only. The table refuses anything the
--    parser would not produce, so even the owner cannot store another host.
-- 3. Three browser functions (read, save, clear), SECURITY DEFINER with
--    search_path '', each gated on an active client success seat or the CEO
--    through cockpit_csm_actor(). Saves and clears carry the revision the
--    caller last saw (0 = "I saw it empty") and conflict with 40001 otherwise.
--
-- Row security on, no policies, no browser grants; the service key reads only.
-- Every write leaves one cockpit_audit_log row through a trigger. No outside
-- call is made. The file applies twice without error, and the seeds never
-- overwrite a later link or bring back a cleared one.
BEGIN;

-- ---------------------------------------------------------------------------
-- The slot list and the link parser (IMMUTABLE, read no table; created before
-- the table so its checks may call them)
-- ---------------------------------------------------------------------------

-- Twelve keys in slide order, the same as VIDEO_SLOTS in
-- apps/client-success-cockpit/src/present/videos.ts. A slot added later
-- changes this function and the code's list in the same change.
CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_video_slots()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT ARRAY[
    'onboarding:welcome', 'onboarding:meta-access', 'onboarding:whatsapp-calendar', 'onboarding:testing',
    'launch:start-to-finish', 'launch:testing', 'launch:call-team', 'launch:winning',
    'launch:portal-guide', 'launch:calendar-hours', 'launch:first-90-days', 'launch:payments'
  ]::text[];
$$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_video_slot_ok(p_deck text, p_slot_key text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT coalesce((p_deck || ':' || p_slot_key) = ANY (public.cockpit_csm_deck_video_slots()), false);
$$;

-- Returns {"provider", "url", "embedUrl"} or raises one sentence (22023).
-- Hosts are matched by equality (or the one anchored Wistia account pattern),
-- ids by anchored patterns, and both addresses are built only from the
-- constants here and the captured ids: every other query value is dropped.
-- parse(parse(x).url) = parse(x) for every accepted link.
CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_video_parse(p_url text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  hosts constant text := 'Paste a link from Loom, YouTube, Wistia, Vimeo or Google Drive.';
  v text; m text[]; h text; p text; q text; x text[]; t text[];
  v_name text; v_provider text; v_id text; v_extra text; v_start integer;
  v_url text; v_embed text;
BEGIN
  v := btrim(p_url);
  IF v IS NULL OR v = '' THEN RAISE EXCEPTION '%', hosts USING ERRCODE = '22023'; END IF;
  IF char_length(v) > 500 THEN
    RAISE EXCEPTION 'That link is too long. Copy the video''s share link.' USING ERRCODE = '22023';
  END IF;
  IF v ~* '^http://' THEN RAISE EXCEPTION 'Use the https link.' USING ERRCODE = '22023'; END IF;
  -- Not https (javascript:, data: and the rest), anything outside printable
  -- ASCII (spaces, controls, a non-ASCII homograph), or a backslash.
  IF v !~* '^https://' OR v !~ '^[!-~]+$' OR position(chr(92) IN v) > 0 THEN
    RAISE EXCEPTION '%', hosts USING ERRCODE = '22023';
  END IF;
  m := regexp_match(v, '^[Hh][Tt][Tt][Pp][Ss]://([^/?#]+)(/[^?#]*)?(\?[^#]*)?(#.*)?$');
  -- A user, a port or an encoded host.
  IF m IS NULL OR m[1] ~ '[@:%]' THEN RAISE EXCEPTION '%', hosts USING ERRCODE = '22023'; END IF;
  h := lower(m[1]);
  p := coalesce(m[2], '');
  q := coalesce(m[3], '');  -- with its '?'; the fragment is dropped

  IF h IN ('www.loom.com', 'loom.com') THEN
    v_provider := 'loom'; v_name := 'Loom';
    x := regexp_match(p, '^/(?:share|embed)/(?:[A-Za-z0-9-]{1,200}-)?([0-9a-f]{32})/?$');
    IF x IS NOT NULL THEN
      v_url := 'https://www.loom.com/share/' || x[1];
      v_embed := 'https://www.loom.com/embed/' || x[1] || '?hideEmbedTopBar=true';
    END IF;

  ELSIF h IN ('www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com') THEN
    v_provider := 'youtube'; v_name := 'YouTube';
    IF h = 'youtu.be' THEN
      x := regexp_match(p, '^/([A-Za-z0-9_-]{11})/?$');
      v_id := x[1];
    ELSIF h = 'www.youtube-nocookie.com' THEN
      x := regexp_match(p, '^/embed/([A-Za-z0-9_-]{11})/?$');
      v_id := x[1];
    ELSIF p ~ '^/watch/?$' THEN
      x := regexp_match(q, '(?:^\?|&)v=([A-Za-z0-9_-]{11})(?:&|$)');
      v_id := x[1];
    ELSE
      x := regexp_match(p, '^/embed/([A-Za-z0-9_-]{11})/?$');
      v_id := x[1];
    END IF;
    IF v_id IS NOT NULL THEN
      -- The start: plain seconds, else hours, minutes and seconds; kept only
      -- between 1 second and 12 hours (anything else is dropped, never cast).
      t := regexp_match(q, '(?:^\?|&)(?:t|start)=([0-9]{1,5})s?(?:&|$)');
      IF t IS NOT NULL THEN
        v_start := t[1]::integer;
      ELSE
        t := regexp_match(q, '(?:^\?|&)t=(?:([0-9]{1,2})h)?(?:([0-9]{1,3})m)?(?:([0-9]{1,5})s)?(?:&|$)');
        IF t IS NOT NULL THEN
          v_start := coalesce(t[1]::integer, 0) * 3600 + coalesce(t[2]::integer, 0) * 60 + coalesce(t[3]::integer, 0);
        END IF;
      END IF;
      IF v_start IS NOT NULL AND v_start NOT BETWEEN 1 AND 43200 THEN v_start := NULL; END IF;
      v_url := 'https://www.youtube.com/watch?v=' || v_id || coalesce('&t=' || v_start::text, '');
      v_embed := 'https://www.youtube-nocookie.com/embed/' || v_id || '?rel=0&playsinline=1&enablejsapi=1'
                 || coalesce('&start=' || v_start::text, '');
    END IF;

  ELSIF h = 'fast.wistia.net' OR h ~ '^[a-z0-9-]{1,63}\.wistia\.com$' THEN
    v_provider := 'wistia'; v_name := 'Wistia';
    IF h = 'fast.wistia.net' THEN
      x := regexp_match(p, '^/embed/iframe/([a-z0-9]{10})/?$');
    ELSE
      x := regexp_match(p, '^/medias/([a-z0-9]{10})/?$');
    END IF;
    IF x IS NOT NULL THEN
      v_url := 'https://fast.wistia.net/embed/iframe/' || x[1];
      v_embed := 'https://fast.wistia.net/embed/iframe/' || x[1] || '?seo=false';
    END IF;

  ELSIF h IN ('vimeo.com', 'www.vimeo.com', 'player.vimeo.com') THEN
    v_provider := 'vimeo'; v_name := 'Vimeo';
    IF h = 'player.vimeo.com' THEN
      x := regexp_match(p, '^/video/([0-9]{6,12})/?$');
      v_id := x[1];
      v_extra := (regexp_match(q, '(?:^\?|&)h=([0-9a-f]{6,20})(?:&|$)'))[1];
    ELSE
      x := regexp_match(p, '^/([0-9]{6,12})(?:/([0-9a-f]{6,20}))?/?$');
      v_id := x[1];
      v_extra := x[2];
    END IF;
    IF v_id IS NOT NULL THEN
      v_url := 'https://vimeo.com/' || v_id || coalesce('/' || v_extra, '');
      v_embed := 'https://player.vimeo.com/video/' || v_id || '?dnt=1' || coalesce('&h=' || v_extra, '');
    END IF;

  ELSIF h = 'drive.google.com' THEN
    v_provider := 'drive'; v_name := 'Drive';
    IF p ~ '^/drive/(?:u/[0-9]+/)?folders/' THEN
      RAISE EXCEPTION 'That Drive link is a folder. Paste the link to the video file.' USING ERRCODE = '22023';
    END IF;
    x := regexp_match(p, '^/file/d/([A-Za-z0-9_-]{20,100})(?:/(?:view|preview))?/?$');
    IF x IS NOT NULL THEN
      -- Files shared before Google's 2021 security update need their key.
      v_extra := (regexp_match(q, '(?:^\?|&)resourcekey=([A-Za-z0-9_-]{1,100})(?:&|$)'))[1];
      v_url := 'https://drive.google.com/file/d/' || x[1] || '/view' || coalesce('?resourcekey=' || v_extra, '');
      v_embed := 'https://drive.google.com/file/d/' || x[1] || '/preview' || coalesce('?resourcekey=' || v_extra, '');
    END IF;

  ELSE
    RAISE EXCEPTION '%', hosts USING ERRCODE = '22023';
  END IF;

  IF v_url IS NULL THEN
    RAISE EXCEPTION 'That % link has no video in it. Copy the video''s share link.', v_name USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('provider', v_provider, 'url', v_url, 'embedUrl', v_embed);
END $$;

-- ---------------------------------------------------------------------------
-- The table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cockpit_csm_deck_videos (
  deck text NOT NULL CHECK (deck IN ('onboarding','launch')),
  slot_key text NOT NULL CHECK (slot_key ~ '^[a-z0-9-]{1,40}$'),
  lang text NOT NULL CHECK (lang IN ('en','ar','any')),
  provider text CHECK (provider IN ('loom','youtube','wistia','vimeo','drive')),
  url text CHECK (url IS NULL OR (url ~ '^https://' AND char_length(url) <= 500)),
  embed_url text CHECK (embed_url IS NULL OR (embed_url ~ '^https://' AND char_length(embed_url) <= 600)),
  title text CHECK (title IS NULL OR (title = btrim(title) AND char_length(title) BETWEEN 1 AND 40
                                      AND title !~ E'[[:cntrl:]\u202A-\u202E\u2066-\u2069\u2028\u2029]')),
  duration_seconds integer CHECK (duration_seconds IS NULL OR duration_seconds BETWEEN 1 AND 10800),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (btrim(updated_by) <> ''),
  cleared_at timestamptz,
  PRIMARY KEY (deck, slot_key, lang),
  -- Only the registry's slots.
  CONSTRAINT cockpit_csm_deck_videos_slot CHECK (public.cockpit_csm_deck_video_slot_ok(deck, slot_key)),
  -- Recorded, or cleared: never half of each.
  CONSTRAINT cockpit_csm_deck_videos_state CHECK (
    (url IS NULL) = (embed_url IS NULL) AND (url IS NULL) = (provider IS NULL)
    AND (url IS NULL) = (cleared_at IS NOT NULL)
    AND (url IS NOT NULL OR (title IS NULL AND duration_seconds IS NULL))),
  -- The table itself refuses a link the parser would not produce, so even
  -- the owner cannot store a host outside the list.
  CONSTRAINT cockpit_csm_deck_videos_link CHECK (url IS NULL OR (
    public.cockpit_csm_deck_video_parse(url) ->> 'url' = url AND
    public.cockpit_csm_deck_video_parse(url) ->> 'embedUrl' = embed_url AND
    public.cockpit_csm_deck_video_parse(url) ->> 'provider' = provider))
);

-- Row security on, no policies. Nothing writes videos except the three
-- functions below, so the service key reads and nothing more (stricter than
-- the decks tables on purpose), and Supabase's default grants go.
ALTER TABLE public.cockpit_csm_deck_videos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_csm_deck_videos FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cockpit_csm_deck_videos TO service_role;

-- ---------------------------------------------------------------------------
-- Internal helpers (no grant to any role)
-- ---------------------------------------------------------------------------

-- The row in the read's shape.
CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_video_json(v public.cockpit_csm_deck_videos) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'deck', v.deck, 'slotKey', v.slot_key, 'lang', v.lang, 'provider', v.provider,
    'url', v.url, 'embedUrl', v.embed_url, 'title', v.title, 'durationSeconds', v.duration_seconds,
    'revision', v.revision, 'updatedBy', v.updated_by, 'updatedAt', to_jsonb(v.updated_at))
$$;

-- One audit row per write, whoever writes (a DELETE cannot happen through any
-- grant; if the owner ever runs one by hand, it is still recorded). The
-- functions name the action through the transaction-local cockpit.deck_action.
CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_video_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  old_row jsonb; new_row jsonb; row_any jsonb; who text; act text;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN new_row := to_jsonb(NEW); END IF;
  row_any := coalesce(new_row, old_row);
  act := coalesce(nullif(current_setting('cockpit.deck_action', true), ''), lower(TG_OP));
  SELECT lower(btrim(u.email)) INTO who FROM auth.users u WHERE u.id = auth.uid();
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES (act, 'cockpit_csm_deck_videos',
          (row_any->>'deck') || ':' || (row_any->>'slot_key') || ':' || (row_any->>'lang'),
          coalesce(who, session_user), 'client-success', 'supabase', old_row, new_row,
          jsonb_build_object('op', TG_OP, 'deck', row_any->>'deck', 'slot_key', row_any->>'slot_key',
                             'lang', row_any->>'lang', 'database_role', current_setting('role', true)));
  RETURN coalesce(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS cockpit_csm_deck_videos_audit ON public.cockpit_csm_deck_videos;
CREATE TRIGGER cockpit_csm_deck_videos_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_csm_deck_videos
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_csm_deck_video_audit();

-- ---------------------------------------------------------------------------
-- The browser functions. Each checks, in order, and stops at the first
-- failure: the gate, the deck, the slot, the language, the revision.
-- ---------------------------------------------------------------------------

-- This deck's recorded rows (a cleared or never-recorded slot is absent: the
-- frontend reads it as "Not recorded yet", revision 0), this deck's slot keys
-- in registry order, and the server's time.
CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_videos_read(p_deck text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_csm_actor();
  IF p_deck IS NULL OR p_deck NOT IN ('onboarding','launch') THEN
    RAISE EXCEPTION 'Choose the onboarding or the launch deck.' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'rows', coalesce((SELECT jsonb_agg(public.cockpit_csm_deck_video_json(v) ORDER BY v.slot_key, v.lang)
                        FROM public.cockpit_csm_deck_videos v
                       WHERE v.deck = p_deck AND v.url IS NOT NULL), '[]'::jsonb),
    'slots', coalesce((SELECT jsonb_agg(s.key ORDER BY s.n)
                         FROM unnest(public.cockpit_csm_deck_video_slots()) WITH ORDINALITY AS s(key, n)
                        WHERE split_part(s.key, ':', 1) = p_deck), '[]'::jsonb),
    'at', to_jsonb(now()));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_video_save(
  p_deck text, p_slot_key text, p_lang text, p_url text,
  p_title text DEFAULT NULL, p_duration_seconds integer DEFAULT NULL, p_revision integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_link jsonb; v_title text; v_who text;
  cur public.cockpit_csm_deck_videos; saved public.cockpit_csm_deck_videos;
BEGIN
  PERFORM public.cockpit_csm_actor();
  IF p_deck IS NULL OR p_deck NOT IN ('onboarding','launch') THEN
    RAISE EXCEPTION 'Choose the onboarding or the launch deck.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.cockpit_csm_deck_video_slot_ok(p_deck, p_slot_key) THEN
    RAISE EXCEPTION 'That video slot is not in the % deck.', p_deck USING ERRCODE = '22023';
  END IF;
  IF p_lang IS NULL OR p_lang NOT IN ('en','ar','any') THEN
    RAISE EXCEPTION 'Choose English, Arabic or any language.' USING ERRCODE = '22023';
  END IF;
  IF p_revision IS NULL OR p_revision < 0 THEN
    RAISE EXCEPTION 'Read the videos again, then save.' USING ERRCODE = '22023';
  END IF;

  v_link := public.cockpit_csm_deck_video_parse(p_url);
  v_title := nullif(btrim(p_title), '');
  IF char_length(v_title) > 40 THEN
    RAISE EXCEPTION 'Keep the title under 40 characters.' USING ERRCODE = '22023';
  END IF;
  -- Control characters, and the bidi embeddings, overrides and isolates and
  -- the line and paragraph separators: the title sits beside the link in
  -- the WhatsApp recap, where U+202E would reverse how the link reads and
  -- U+2028 would split the line. Arabic text and U+200F (RLM) pass.
  IF v_title ~ E'[[:cntrl:]\u202A-\u202E\u2066-\u2069\u2028\u2029]' THEN
    RAISE EXCEPTION 'The title has a character it can''t keep. Type it again.' USING ERRCODE = '22023';
  END IF;
  IF p_duration_seconds IS NOT NULL AND p_duration_seconds NOT BETWEEN 1 AND 10800 THEN
    RAISE EXCEPTION 'The length must be between 1 second and 3 hours.' USING ERRCODE = '22023';
  END IF;
  SELECT lower(btrim(u.email)) INTO v_who FROM auth.users u WHERE u.id = auth.uid();

  -- Two CSMs saving the same slot: one at a time.
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_csm_deck_videos:' || p_deck || ':' || p_slot_key || ':' || p_lang, 0));
  SELECT * INTO cur FROM public.cockpit_csm_deck_videos v
   WHERE v.deck = p_deck AND v.slot_key = p_slot_key AND v.lang = p_lang FOR UPDATE;

  -- 0 is "I saw this slot empty": it matches a missing or cleared row and
  -- conflicts with a recorded one. n >= 1 must equal the stored revision.
  IF (p_revision = 0 AND cur.url IS NOT NULL)
     OR (p_revision > 0 AND (cur.deck IS NULL OR cur.revision <> p_revision)) THEN
    RAISE EXCEPTION 'Someone else changed this video just now. Check it, then save again.' USING ERRCODE = '40001';
  END IF;

  IF cur.url IS NOT NULL AND cur.url = v_link->>'url'
     AND cur.title IS NOT DISTINCT FROM v_title AND cur.duration_seconds IS NOT DISTINCT FROM p_duration_seconds THEN
    RETURN public.cockpit_csm_deck_video_json(cur) || jsonb_build_object('changed', false);
  END IF;

  PERFORM set_config('cockpit.deck_action', 'deck_video.save', true);
  IF cur.deck IS NULL THEN
    INSERT INTO public.cockpit_csm_deck_videos
      (deck, slot_key, lang, provider, url, embed_url, title, duration_seconds, revision, updated_at, updated_by, cleared_at)
    VALUES (p_deck, p_slot_key, p_lang, v_link->>'provider', v_link->>'url', v_link->>'embedUrl', v_title,
            p_duration_seconds, 1, now(), v_who, NULL)
    RETURNING * INTO saved;
  ELSE
    UPDATE public.cockpit_csm_deck_videos v
       SET provider = v_link->>'provider', url = v_link->>'url', embed_url = v_link->>'embedUrl',
           title = v_title, duration_seconds = p_duration_seconds, cleared_at = NULL,
           revision = v.revision + 1, updated_by = v_who, updated_at = now()
     WHERE v.deck = p_deck AND v.slot_key = p_slot_key AND v.lang = p_lang
    RETURNING * INTO saved;
  END IF;
  RETURN public.cockpit_csm_deck_video_json(saved) || jsonb_build_object('changed', true);
END $$;

-- A clear keeps the row with its link removed; prep's Undo is a save of the
-- old values with revision 0 (a new revision, its own audit row).
CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_video_clear(
  p_deck text, p_slot_key text, p_lang text, p_revision integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_who text; cur public.cockpit_csm_deck_videos; saved public.cockpit_csm_deck_videos;
BEGIN
  PERFORM public.cockpit_csm_actor();
  IF p_deck IS NULL OR p_deck NOT IN ('onboarding','launch') THEN
    RAISE EXCEPTION 'Choose the onboarding or the launch deck.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.cockpit_csm_deck_video_slot_ok(p_deck, p_slot_key) THEN
    RAISE EXCEPTION 'That video slot is not in the % deck.', p_deck USING ERRCODE = '22023';
  END IF;
  IF p_lang IS NULL OR p_lang NOT IN ('en','ar','any') THEN
    RAISE EXCEPTION 'Choose English, Arabic or any language.' USING ERRCODE = '22023';
  END IF;
  IF p_revision IS NULL OR p_revision < 0 THEN
    RAISE EXCEPTION 'Read the videos again, then clear.' USING ERRCODE = '22023';
  END IF;
  SELECT lower(btrim(u.email)) INTO v_who FROM auth.users u WHERE u.id = auth.uid();

  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_csm_deck_videos:' || p_deck || ':' || p_slot_key || ':' || p_lang, 0));
  SELECT * INTO cur FROM public.cockpit_csm_deck_videos v
   WHERE v.deck = p_deck AND v.slot_key = p_slot_key AND v.lang = p_lang FOR UPDATE;

  -- Nothing recorded: nothing to clear, and nothing written.
  IF cur.url IS NULL THEN
    RETURN jsonb_build_object('deck', p_deck, 'slotKey', p_slot_key, 'lang', p_lang,
                              'cleared', false, 'revision', cur.revision);
  END IF;
  IF p_revision <> cur.revision THEN
    RAISE EXCEPTION 'Someone else changed this video just now. Check it, then clear it again.' USING ERRCODE = '40001';
  END IF;

  PERFORM set_config('cockpit.deck_action', 'deck_video.clear', true);
  UPDATE public.cockpit_csm_deck_videos v
     SET provider = NULL, url = NULL, embed_url = NULL, title = NULL, duration_seconds = NULL,
         cleared_at = now(), revision = v.revision + 1, updated_by = v_who, updated_at = now()
   WHERE v.deck = p_deck AND v.slot_key = p_slot_key AND v.lang = p_lang
  RETURNING * INTO saved;
  RETURN jsonb_build_object('deck', p_deck, 'slotKey', p_slot_key, 'lang', p_lang,
                            'cleared', true, 'revision', saved.revision);
END $$;

-- ---------------------------------------------------------------------------
-- Grants: the three browser functions for signed-in seats (the gate inside
-- decides); the helpers for nobody. The functions run as their owner, so the
-- table's checks may call the helpers.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION
  public.cockpit_csm_deck_videos_read(text),
  public.cockpit_csm_deck_video_save(text, text, text, text, text, integer, integer),
  public.cockpit_csm_deck_video_clear(text, text, text, integer)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION
  public.cockpit_csm_deck_videos_read(text),
  public.cockpit_csm_deck_video_save(text, text, text, text, text, integer, integer),
  public.cockpit_csm_deck_video_clear(text, text, text, integer)
TO authenticated;
REVOKE ALL ON FUNCTION
  public.cockpit_csm_deck_video_slots(),
  public.cockpit_csm_deck_video_slot_ok(text, text),
  public.cockpit_csm_deck_video_parse(text),
  public.cockpit_csm_deck_video_json(public.cockpit_csm_deck_videos),
  public.cockpit_csm_deck_video_audit()
FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Seeds: Mahara's own videos that fill slots on day one. DO NOTHING, so a
-- second apply never overwrites a CSM's later link and never brings back a
-- seed someone cleared (a cleared row still holds its key). The first five
-- come from mahara-context context/projects/mahara-os.md, "Guides and video
-- deliverables"; the sixth is the Loom the Gamma launch deck embeds on
-- "Blocking Calendar Times" (the CEO, 2026-10-20). Lengths are the providers'
-- own oEmbed durations, read 2026-10-20 and rounded to the second. The
-- calendar Loom really is 11 s (Loom's oEmbed says 11.1, read again after
-- the visual review asked): a short screen clip, not a typo.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  PERFORM set_config('cockpit.deck_action', 'deck_video.seed', true);
  INSERT INTO public.cockpit_csm_deck_videos
    (deck, slot_key, lang, provider, url, embed_url, duration_seconds, updated_by)
  SELECT s.deck, s.slot_key, s.lang, x.p ->> 'provider', x.p ->> 'url', x.p ->> 'embedUrl',
         s.seconds, 'migration 20261020120000_csm_deck_videos'
    FROM (VALUES
      ('onboarding', 'welcome',           'any', 'https://fast.wistia.net/embed/iframe/up0z6n691k',             148),
      ('onboarding', 'meta-access',       'any', 'https://www.loom.com/share/e2d83bffee614d9aa035d898d37d8989', 94),
      ('onboarding', 'whatsapp-calendar', 'any', 'https://www.loom.com/share/4ddc5519935f4ba8bdc7ac6f3667a701', 231),
      ('launch',     'portal-guide',      'en',  'https://fast.wistia.net/embed/iframe/lxlse6ckhf',             277),
      ('launch',     'portal-guide',      'ar',  'https://fast.wistia.net/embed/iframe/hyuxh7skjv',             285),
      ('launch',     'calendar-hours',    'any', 'https://www.loom.com/share/6aa67297dfcf421887f8961d3c1c7768', 11)
    ) AS s(deck, slot_key, lang, link, seconds)
    CROSS JOIN LATERAL (SELECT public.cockpit_csm_deck_video_parse(s.link) AS p) x
  ON CONFLICT (deck, slot_key, lang) DO NOTHING;
END $$;

COMMIT;
