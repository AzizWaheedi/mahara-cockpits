-- Upsell studio, 2 of 3: offer decks, capture files, site checks, wins, the
-- offer gate and the pitch log (docs/upsell-studio/BACKEND.md section 2).
-- Apply after 20261026u_upsell_catalog.sql and before 20261026w.
--
-- 1. Guards: the five deck functions this file replaces must still have the
--    bodies read live on 26 Oct (or this file's own, for a second apply),
--    and the two deck CHECK constraints their definitions; otherwise the file
--    stops before it changes anything.
-- 2. The deck tables take offer decks (offer_<key> for the seven catalog
--    offers). cockpit_csm_deck_prep_save sends an offer deck's keys to
--    cockpit_csm_offer_prep_value (the price rules included) and leaves the
--    onboarding and launch decks exactly as they were. The video slots gain
--    offer_<key>:demo after the twelve, and only the CEO saves or clears an
--    offer's video.
-- 3. cockpit_upsell_files: dated screenshots of a client's gap ("captures"),
--    in the PRIVATE bucket cockpit-upsell-files at <taskId>/<id>.<ext>, the
--    launch tray's upload chain copied (reserve, the Edge Function signs and
--    uploads, accept checks Storage's own metadata). One read policy.
-- 4. cockpit_upsell_wins (the CSM's "They've had a win"),
--    cockpit_client_site_checks (the on-demand site check, never audited) and
--    the site verdict: broken only after two failed checks 20 hours apart.
-- 5. cockpit_csm_offer_gate: the ten reasons an offer waits, in order.
--    cockpit_csm_offer_sources and cockpit_csm_offer_status feed the deck,
--    the picker and the Hot list row. Never leads, cost per lead, spend or
--    budgets.
-- 6. cockpit_upsell_pitches: one row per offer raised on a call, stamped from
--    the gate and prep, with its answer and the price steps.
--
-- New tables: row security on, no policies, no browser grants; the service
-- key selects, inserts and updates. Every new function is SECURITY DEFINER
-- with search_path ''; replaced functions keep their attributes and grants.
-- Every write to files, wins and pitches leaves one audit row through
-- cockpit_upsell_audit (20261026u); prep writes through the decks' own audit.
-- The file applies twice without error.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Guards
-- ---------------------------------------------------------------------------

DO $guard$
DECLARE f record; v_md5 text; v_def text;
BEGIN
  -- Each replaced body: the live md5 (26 Oct), then this file's body with LF
  -- and with CRLF line endings.
  FOR f IN SELECT * FROM (VALUES
    ('cockpit_csm_deck_prep_save(text,text,jsonb)',
     ARRAY['e6b8e4d80bd8dd30498ebc1b5ab92859', '73b22af7ceed38cfbc0981d2b5d83f66', 'ae54595f2b5554075f547d889540edad']),
    ('cockpit_csm_deck_video_slots()',
     ARRAY['9f670ba72f102080504a1a348d5c9309', 'a5543c7b0e0c59ed080d59b7b15ad97b', '739418461753a8e8942e333ca21e5f6b']),
    ('cockpit_csm_deck_videos_read(text)',
     ARRAY['e645051690f2f32543e4da89beecb890', '6f3e17f756447f3dd0388933cbd1f3df', '9530d0583d15f3f7f812f27e9fecba05']),
    ('cockpit_csm_deck_video_save(text,text,text,text,text,integer,integer)',
     ARRAY['eeaf74c7b6fd1ec12db44e26d59c6848', '51ec4657e0eb4abbf49a610eb44d3bd8', '797f09276c4db93cc40ec2e418a851b3']),
    ('cockpit_csm_deck_video_clear(text,text,text,integer)',
     ARRAY['df961267904ba26d2bb9e425fae40d92', '04fa758685afdb78c46dbbb3cb94fa21', '8943572d6241f02a0b50d33d3196e5c0'])
  ) x(sig, ok) LOOP
    SELECT md5(p.prosrc) INTO v_md5 FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.' || f.sig);
    IF v_md5 IS NULL OR NOT (v_md5 = ANY (f.ok)) THEN
      RAISE EXCEPTION '% is not the definition this file was written against (prosrc md5 %). Re-read the live definition and rebase this file',
        f.sig, coalesce(v_md5, 'missing');
    END IF;
  END LOOP;
  -- The two deck checks: the live definition, or the one this file adds.
  FOR f IN SELECT * FROM (VALUES ('public.cockpit_csm_deck_prep', 'cockpit_csm_deck_prep_deck_check'),
                                 ('public.cockpit_csm_deck_videos', 'cockpit_csm_deck_videos_deck_check')) x(tbl, con) LOOP
    SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
     WHERE c.conrelid = to_regclass(f.tbl) AND c.conname = f.con;
    IF v_def IS NULL OR v_def NOT IN (
         'CHECK ((deck = ANY (ARRAY[''onboarding''::text, ''launch''::text])))',
         'CHECK (((deck = ANY (ARRAY[''onboarding''::text, ''launch''::text])) OR (deck ~ ''^offer_(website|second_campaign|seo_geo|smm|ugc|closer|cameraman)$''::text)))') THEN
      RAISE EXCEPTION '% is not the definition this file was written against (%). Re-read the live definition and rebase this file',
        f.con, coalesce(v_def, 'missing');
    END IF;
  END LOOP;
END $guard$;

-- ---------------------------------------------------------------------------
-- 2. The deck tables take offer decks
-- ---------------------------------------------------------------------------

ALTER TABLE public.cockpit_csm_deck_prep DROP CONSTRAINT IF EXISTS cockpit_csm_deck_prep_deck_check;
ALTER TABLE public.cockpit_csm_deck_prep ADD CONSTRAINT cockpit_csm_deck_prep_deck_check
  CHECK (deck IN ('onboarding','launch') OR deck ~ '^offer_(website|second_campaign|seo_geo|smm|ugc|closer|cameraman)$');
ALTER TABLE public.cockpit_csm_deck_videos DROP CONSTRAINT IF EXISTS cockpit_csm_deck_videos_deck_check;
ALTER TABLE public.cockpit_csm_deck_videos ADD CONSTRAINT cockpit_csm_deck_videos_deck_check
  CHECK (deck IN ('onboarding','launch') OR deck ~ '^offer_(website|second_campaign|seo_geo|smm|ugc|closer|cameraman)$');

-- The twelve deck slots in the same order, then one demo per offer in the
-- written order. present/videos.ts keeps the twelve; the offer decks read
-- their own registry (src/present/offer/videos.ts).
CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_video_slots()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT ARRAY[
    'onboarding:welcome', 'onboarding:meta-access', 'onboarding:whatsapp-calendar', 'onboarding:testing',
    'launch:start-to-finish', 'launch:testing', 'launch:call-team', 'launch:winning',
    'launch:portal-guide', 'launch:calendar-hours', 'launch:first-90-days', 'launch:payments',
    'offer_website:demo', 'offer_second_campaign:demo', 'offer_seo_geo:demo', 'offer_smm:demo',
    'offer_cameraman:demo', 'offer_ugc:demo', 'offer_closer:demo'
  ]::text[];
$$;

-- ---------------------------------------------------------------------------
-- 3. Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cockpit_upsell_files (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  task_id text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  kind text NOT NULL CHECK (kind IN ('capture')),
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','ready','removed')),
  storage_path text NOT NULL UNIQUE,
  mime text NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  bytes bigint NOT NULL CHECK (bytes BETWEEN 1 AND 10485760),
  width integer CHECK (width BETWEEN 1 AND 20000),
  height integer CHECK (height BETWEEN 1 AND 20000),
  file_name text CHECK (char_length(file_name) BETWEEN 1 AND 200),
  searched_as text CHECK (char_length(searched_as) BETWEEN 1 AND 80),
  captured_on date NOT NULL,
  caption text CHECK (char_length(caption) BETWEEN 1 AND 120),
  created_by uuid NOT NULL,
  created_by_email text NOT NULL CHECK (btrim(created_by_email) <> ''),
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  removed_at timestamptz,
  purged_at timestamptz,
  CONSTRAINT cockpit_upsell_files_path CHECK (storage_path = task_id || '/' || id::text || '.' ||
    CASE mime WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' ELSE 'webp' END),
  CONSTRAINT cockpit_upsell_files_ready CHECK ((status = 'uploading') = (ready_at IS NULL) OR status = 'removed'),
  CONSTRAINT cockpit_upsell_files_removed CHECK ((status = 'removed') = (removed_at IS NOT NULL)),
  CONSTRAINT cockpit_upsell_files_purged CHECK (purged_at IS NULL OR status = 'removed')
);
CREATE INDEX IF NOT EXISTS cockpit_upsell_files_task_idx ON public.cockpit_upsell_files (task_id, status, captured_on DESC);

CREATE TABLE IF NOT EXISTS public.cockpit_upsell_wins (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  text text NOT NULL CHECK (char_length(text) BETWEEN 3 AND 200),
  won_on date NOT NULL,
  created_by_email text NOT NULL CHECK (btrim(created_by_email) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cockpit_upsell_wins_task_idx ON public.cockpit_upsell_wins (task_id, won_on DESC);

CREATE TABLE IF NOT EXISTS public.cockpit_client_site_checks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  url text NOT NULL CHECK (char_length(url) BETWEEN 1 AND 300),
  source text NOT NULL CHECK (source IN ('card','onboarding','prep')),
  status text NOT NULL CHECK (status IN ('ok','parked','expired','dns','tls','http_error','timeout','redirect_offsite','instagram','empty','refused')),
  http_status integer CHECK (http_status BETWEEN 100 AND 599),
  final_url text CHECK (char_length(final_url) <= 500),
  title text CHECK (char_length(title) <= 200),
  checked_at timestamptz NOT NULL DEFAULT now(),
  checked_by_email text NOT NULL CHECK (btrim(checked_by_email) <> '')
);
CREATE INDEX IF NOT EXISTS cockpit_client_site_checks_task_idx ON public.cockpit_client_site_checks (task_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS public.cockpit_upsell_pitches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  task_id text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  offer_key text NOT NULL REFERENCES public.cockpit_upsell_catalog(offer_key),
  pitched_on date NOT NULL,
  csm_email text NOT NULL CHECK (btrim(csm_email) <> ''),
  mode text NOT NULL CHECK (mode IN ('proactive','client_asked')),
  client_words text CHECK (char_length(client_words) BETWEEN 3 AND 300),
  client_asked_on date,
  gate jsonb NOT NULL CHECK (jsonb_typeof(gate) = 'object'),
  list_price jsonb NOT NULL CHECK (jsonb_typeof(list_price) = 'object'),
  opening_price jsonb CHECK (opening_price IS NULL OR jsonb_typeof(opening_price) = 'object'),
  opening_reason text CHECK (char_length(opening_reason) BETWEEN 1 AND 140),
  held_full boolean NOT NULL DEFAULT false,
  final_price jsonb CHECK (final_price IS NULL OR jsonb_typeof(final_price) = 'object'),
  final_reason text CHECK (char_length(final_reason) BETWEEN 1 AND 140),
  split boolean NOT NULL DEFAULT false,
  answer text CHECK (answer IN ('yes_paid','yes_unpaid','not_now','no')),
  follow_up_on date,
  no_reason text CHECK (char_length(no_reason) BETWEEN 1 AND 200),
  payment_link text CHECK (char_length(payment_link) <= 500),
  lang text NOT NULL CHECK (lang IN ('en','ar')),
  video_code text NOT NULL UNIQUE CHECK (video_code ~ '^[a-hj-km-np-z2-9]{10}$'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (btrim(updated_by) <> ''),
  CONSTRAINT cockpit_upsell_pitches_asked CHECK ((mode = 'client_asked') = (client_words IS NOT NULL AND client_asked_on IS NOT NULL)),
  CONSTRAINT cockpit_upsell_pitches_not_now CHECK (answer IS DISTINCT FROM 'not_now' OR follow_up_on IS NOT NULL),
  CONSTRAINT cockpit_upsell_pitches_no CHECK (answer IS DISTINCT FROM 'no' OR no_reason IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS cockpit_upsell_pitches_task_idx ON public.cockpit_upsell_pitches (task_id, pitched_on DESC);
CREATE INDEX IF NOT EXISTS cockpit_upsell_pitches_month_idx ON public.cockpit_upsell_pitches (pitched_on);

ALTER TABLE public.cockpit_upsell_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_upsell_wins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_client_site_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_upsell_pitches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_upsell_files, public.cockpit_upsell_wins, public.cockpit_client_site_checks, public.cockpit_upsell_pitches
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.cockpit_upsell_files, public.cockpit_upsell_wins, public.cockpit_client_site_checks, public.cockpit_upsell_pitches
  TO service_role;
-- The identity sequences: Supabase grants every new sequence to the browser
-- roles too; they need none.
REVOKE ALL ON SEQUENCE public.cockpit_upsell_wins_id_seq, public.cockpit_client_site_checks_id_seq FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cockpit_upsell_files_audit ON public.cockpit_upsell_files;
CREATE TRIGGER cockpit_upsell_files_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_upsell_files
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_upsell_audit();
DROP TRIGGER IF EXISTS cockpit_upsell_wins_audit ON public.cockpit_upsell_wins;
CREATE TRIGGER cockpit_upsell_wins_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_upsell_wins
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_upsell_audit();
DROP TRIGGER IF EXISTS cockpit_upsell_pitches_audit ON public.cockpit_upsell_pitches;
CREATE TRIGGER cockpit_upsell_pitches_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_upsell_pitches
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_upsell_audit();

-- ---------------------------------------------------------------------------
-- The private bucket and its one read policy
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('cockpit-upsell-files', 'cockpit-upsell-files', false, 10485760, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- True only for the file of a READY capture whose client the signed-in seat
-- may open. Never raises: a policy that raises breaks listing.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_object_allowed(p_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t text;
BEGIN
  IF p_name IS NULL OR p_name !~ '^[A-Za-z0-9_-]{1,40}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$' THEN
    RETURN false;
  END IF;
  SELECT f.task_id INTO t FROM public.cockpit_upsell_files f WHERE f.storage_path = p_name AND f.status = 'ready';
  IF t IS NULL OR split_part(p_name, '/', 1) <> t THEN RETURN false; END IF;
  PERFORM public.cockpit_csm_client_gate(t);
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END $$;

DROP POLICY IF EXISTS cockpit_upsell_files_read ON storage.objects;
CREATE POLICY cockpit_upsell_files_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'cockpit-upsell-files' AND public.cockpit_upsell_object_allowed(name));

-- ---------------------------------------------------------------------------
-- Internal helpers (no grant to any role)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_upsell_offer_ok(p_offer text) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(p_offer IN ('website','second_campaign','seo_geo','smm','ugc','closer','cameraman'), false)
$$;

-- A typed line: trimmed text, null when blank, 22023 when not text, too long,
-- too short or carrying a control or direction character (tabs and new lines pass).
CREATE OR REPLACE FUNCTION public.cockpit_upsell_text(p jsonb, p_max integer, p_what text, p_min integer DEFAULT 1) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE s text;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p) <> 'string' THEN RAISE EXCEPTION '% must be text.', p_what USING ERRCODE = '22023'; END IF;
  s := btrim(p #>> '{}');
  IF s = '' THEN RETURN NULL; END IF;
  IF char_length(s) > p_max THEN RAISE EXCEPTION '% is too long. Keep it to % characters.', p_what, p_max USING ERRCODE = '22023'; END IF;
  IF char_length(s) < p_min THEN RAISE EXCEPTION '% is too short. Use at least % characters.', p_what, p_min USING ERRCODE = '22023'; END IF;
  IF translate(s, E'\n\t', '') ~ E'[[:cntrl:]‪-‮⁦-⁩  ]' THEN
    RAISE EXCEPTION '% has a character it can''t keep. Type it again.', p_what USING ERRCODE = '22023';
  END IF;
  RETURN s;
END $$;

-- A YYYY-MM-DD date, or 22023.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_date(p jsonb, p_what text) RETURNS date
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE d date;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p) <> 'string' OR (p #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    RAISE EXCEPTION '% must be a date (YYYY-MM-DD).', p_what USING ERRCODE = '22023';
  END IF;
  BEGIN
    d := (p #>> '{}')::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION '% must be a date (YYYY-MM-DD).', p_what USING ERRCODE = '22023';
  END;
  IF to_char(d, 'YYYY-MM-DD') <> (p #>> '{}') OR d NOT BETWEEN DATE '2024-01-01' AND DATE '2035-12-31' THEN
    RAISE EXCEPTION '% must be a date (YYYY-MM-DD).', p_what USING ERRCODE = '22023';
  END IF;
  RETURN d;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_upsell_choice(p jsonb, p_allowed text[], p_what text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p IS NULL OR jsonb_typeof(p) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p) <> 'string' OR NOT ((p #>> '{}') = ANY (p_allowed)) THEN
    RAISE EXCEPTION '% must be one of: %.', p_what, array_to_string(p_allowed, ', ') USING ERRCODE = '22023';
  END IF;
  RETURN p;
END $$;

-- "26 Oct" this year, "26 Oct 2025" another year. Every date rule in v and
-- w counts days in Kuwait (cockpit_upsell_today and cockpit_upsell_kday,
-- 20261026u): the database clock is UTC, three hours behind.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_day(d date) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN d IS NULL THEN NULL
    WHEN extract(year FROM d) = extract(year FROM public.cockpit_upsell_today()) THEN to_char(d, 'FMDD Mon')
    ELSE to_char(d, 'FMDD Mon YYYY') END
$$;

-- "the website build and the website care plan": an offer's parts in a sentence.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_parts_named(p_offer text, p_parts jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT string_agg('the ' || public.cockpit_upsell_part_name(p_offer, x->>'key', true), ' and ' ORDER BY i)
    FROM jsonb_array_elements(coalesce(p_parts, '[]'::jsonb)) WITH ORDINALITY y(x, i)
$$;

-- A line a client may see (a capture's caption, what it was searched as):
-- 22023 with the first blocking copy problem, else the line itself.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_copy_refuse(p_text text, p_what text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p jsonb;
BEGIN
  SELECT x INTO p FROM jsonb_array_elements(public.cockpit_client_copy_problems(p_text, false)) x
   WHERE x->'block' = 'true'::jsonb LIMIT 1;
  IF p IS NOT NULL THEN
    RAISE EXCEPTION '%: % ("%")', p_what, p->>'why', p->>'match' USING ERRCODE = '22023';
  END IF;
  RETURN p_text;
END $$;

-- "26 and 27 Oct", "30 Sep and 2 Oct", or one day.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_two_days(a date, b date) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN a = b THEN public.cockpit_upsell_day(a)
    WHEN date_trunc('month', a) = date_trunc('month', b) THEN to_char(a, 'FMDD') || ' and ' || public.cockpit_upsell_day(b)
    ELSE public.cockpit_upsell_day(a) || ' and ' || public.cockpit_upsell_day(b) END
$$;

-- A random code from gen_random_uuid() bytes, in the 31 characters that never
-- read alike (no i, l, o, 0 or 1). Bytes of 248 and over are skipped, so
-- every character is equally likely.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_code(p_len integer) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  b bytea; out text := ''; i integer; x integer;
BEGIN
  WHILE char_length(out) < p_len LOOP
    b := uuid_send(gen_random_uuid());
    FOR i IN 0..15 LOOP
      CONTINUE WHEN i IN (6, 8);  -- the version and variant bytes
      x := get_byte(b, i);
      CONTINUE WHEN x >= 248;
      out := out || substr(alphabet, (x % 31) + 1, 1);
      EXIT WHEN char_length(out) = p_len;
    END LOOP;
  END LOOP;
  RETURN out;
END $$;

-- This client as the projections read it: the roster row merged with the
-- overrides confirmed after its sync (cockpit_csm_projection_client's rule,
-- without its own access check: every caller has passed the client gate).
CREATE OR REPLACE FUNCTION public.cockpit_csm_offer_client(p_task_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT s.data || coalesce(o.data, '{}'::jsonb)
    FROM public.cockpit_csm_sources s
    JOIN public.cockpit_csm_source_state st USING (table_name)
    LEFT JOIN public.cockpit_csm_client_overrides o
      ON o.task_id = s.data->>'taskId'
     AND extract(epoch FROM o.confirmed_at) * 1000 > coalesce((s.data->>'syncedAt')::numeric, 0)
   WHERE s.table_name = 'clients' AND st.ready AND s.source_snapshot_at = st.source_snapshot_at
     AND s.data->>'taskId' = p_task_id
   LIMIT 1
$$;

-- An offer deck's prep overrides ('{}' when none).
CREATE OR REPLACE FUNCTION public.cockpit_upsell_prep_of(p_task_id text, p_offer text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT p.overrides FROM public.cockpit_csm_deck_prep p
                    WHERE p.task_id = p_task_id AND p.deck = 'offer_' || p_offer), '{}'::jsonb)
$$;

-- prep's "client asked" still counts: their words and a date within 30 days.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_asked_ok(p jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_typeof(p) = 'object' AND jsonb_typeof(p->'words') = 'string'
    AND char_length(btrim(p->>'words')) BETWEEN 3 AND 300
    AND (p->>'on') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    AND (p->>'on')::date BETWEEN public.cockpit_upsell_today() - 30 AND public.cockpit_upsell_today(), false)
$$;

-- A ready capture of this client, as the deck and the proposal read it.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_file_json(f public.cockpit_upsell_files) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', f.id, 'kind', f.kind, 'status', f.status, 'mime', f.mime, 'bytes', f.bytes, 'width', f.width, 'height', f.height,
    'fileName', f.file_name, 'searchedAs', f.searched_as, 'capturedOn', to_jsonb(f.captured_on), 'caption', f.caption,
    'createdAt', to_jsonb(f.created_at), 'createdBy', f.created_by_email, 'path', f.storage_path)
$$;

CREATE OR REPLACE FUNCTION public.cockpit_upsell_files_rows(p_task_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(public.cockpit_upsell_file_json(f) ORDER BY f.captured_on DESC, f.created_at DESC), '[]'::jsonb)
    FROM public.cockpit_upsell_files f WHERE f.task_id = p_task_id AND f.status = 'ready'
$$;

-- ---------------------------------------------------------------------------
-- 2 (cont.). Offer prep: the keys and the price rules
-- ---------------------------------------------------------------------------

-- Checks and normalises one offer prep key (BACKEND.md 2.1, the same list as
-- src/present/offer/prepKeys.ts). NULL means "remove the key".
-- OFFER_PREP_KEYS: language dialect site_url site_thin captures goal_pick goal_typed goal_typed_on example_stills example_colors opening_price opening_reason project_value payment_link client_asked hidden_slides shown_slides presented_at
CREATE OR REPLACE FUNCTION public.cockpit_csm_offer_prep_value(p_task_id text, p_offer text, p_key text, p_value jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t text := coalesce(jsonb_typeof(p_value), 'null');
  s text; d date; e jsonb; m jsonb; arr jsonb := '[]'::jsonb; out jsonb := '{}'::jsonb; k text; ks text[]; n numeric;
  v_parts jsonb; v_want text[];
BEGIN
  IF p_key IS NULL OR p_key !~ '^[a-z0-9_]{1,40}$' THEN
    RAISE EXCEPTION 'Prep keys are short lowercase names.' USING ERRCODE = '22023';
  END IF;
  IF t = 'null' THEN RETURN NULL; END IF;
  CASE p_key
  WHEN 'language' THEN RETURN public.cockpit_upsell_choice(p_value, ARRAY['en','ar'], 'The language');
  WHEN 'dialect' THEN RETURN public.cockpit_upsell_choice(p_value, ARRAY['kw','sa'], 'The dialect');
  WHEN 'goal_pick' THEN RETURN public.cockpit_upsell_choice(p_value, ARRAY['goal90','goal12_24','challenges','why','typed'], 'The goal');
  WHEN 'site_thin' THEN
    IF t <> 'boolean' THEN RAISE EXCEPTION 'site_thin is a yes or no.' USING ERRCODE = '22023'; END IF;
    RETURN p_value;
  WHEN 'site_url' THEN
    s := public.cockpit_upsell_text(p_value, 300, 'The site address');
    IF s IS NULL THEN RETURN NULL; END IF;
    IF s !~* '^https://([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(/[^[:space:]<>"''\\]*)?$' THEN
      RAISE EXCEPTION 'Paste the site''s https address, without a user, a port or an IP address.' USING ERRCODE = '22023';
    END IF;
    RETURN to_jsonb(s);
  WHEN 'goal_typed' THEN RETURN to_jsonb(public.cockpit_upsell_text(p_value, 300, 'The typed goal'));
  WHEN 'opening_reason' THEN RETURN to_jsonb(public.cockpit_upsell_text(p_value, 140, 'The reason'));
  WHEN 'goal_typed_on' THEN
    d := public.cockpit_upsell_date(p_value, 'The goal''s date');
    IF d > public.cockpit_upsell_today() THEN RAISE EXCEPTION 'The goal''s date is today or earlier.' USING ERRCODE = '22023'; END IF;
    RETURN to_jsonb(to_char(d, 'YYYY-MM-DD'));
  WHEN 'captures' THEN
    IF t <> 'array' OR jsonb_array_length(p_value) > 3 THEN
      RAISE EXCEPTION 'Pick at most 3 captures.' USING ERRCODE = '22023';
    END IF;
    FOR e IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF jsonb_typeof(e) <> 'object' THEN RAISE EXCEPTION 'Each capture is its id and an optional mark.' USING ERRCODE = '22023'; END IF;
      ks := ARRAY(SELECT jsonb_object_keys(e));
      IF NOT (ks <@ ARRAY['id','mark']) OR NOT (e ? 'id') THEN
        RAISE EXCEPTION 'Each capture is its id and an optional mark.' USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(e->'id') <> 'string' OR (e->>'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         OR NOT EXISTS (SELECT 1 FROM public.cockpit_upsell_files f WHERE f.id = (e->>'id')::uuid AND f.task_id = p_task_id
                          AND f.status = 'ready' AND f.kind = 'capture') THEN
        RAISE EXCEPTION 'Pick one of this client''s own captures.' USING ERRCODE = '22023';
      END IF;
      IF arr @> jsonb_build_array(jsonb_build_object('id', e->'id')) THEN
        RAISE EXCEPTION 'Each capture once.' USING ERRCODE = '22023';
      END IF;
      m := NULL;
      IF e ? 'mark' AND jsonb_typeof(e->'mark') <> 'null' THEN
        m := e->'mark';
        ks := CASE WHEN jsonb_typeof(m) = 'object' THEN ARRAY(SELECT jsonb_object_keys(m)) END;
        IF ks IS NULL OR NOT (ks @> ARRAY['x','y','w','h'] AND ks <@ ARRAY['x','y','w','h'])
           OR EXISTS (SELECT 1 FROM jsonb_each(m) z WHERE jsonb_typeof(z.value) <> 'number' OR (z.value #>> '{}')::numeric NOT BETWEEN 0 AND 1)
           OR (m->>'w')::numeric < 0.04 OR (m->>'h')::numeric < 0.04
           OR (m->>'x')::numeric + (m->>'w')::numeric > 1 OR (m->>'y')::numeric + (m->>'h')::numeric > 1 THEN
          RAISE EXCEPTION 'The gap mark sits inside the capture and is at least 4%% of it each way.' USING ERRCODE = '22023';
        END IF;
      END IF;
      arr := arr || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', e->'id', 'mark', m)));
    END LOOP;
    RETURN nullif(arr, '[]'::jsonb);
  WHEN 'example_stills' THEN
    IF t <> 'array' OR jsonb_array_length(p_value) > 3 THEN RAISE EXCEPTION 'Pick at most 3 example stills.' USING ERRCODE = '22023'; END IF;
    FOR e IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         OR NOT EXISTS (SELECT 1 FROM public.cockpit_csm_launch_ads a WHERE a.id = (e #>> '{}')::uuid AND a.task_id = p_task_id
                          AND a.status = 'ready' AND a.mime LIKE 'image/%') THEN
        RAISE EXCEPTION 'Pick one of this client''s own pictures from the ads tray.' USING ERRCODE = '22023';
      END IF;
      IF NOT (arr @> jsonb_build_array(e)) THEN arr := arr || jsonb_build_array(e); END IF;
    END LOOP;
    RETURN nullif(arr, '[]'::jsonb);
  WHEN 'example_colors' THEN
    IF t <> 'array' OR jsonb_array_length(p_value) > 3 THEN RAISE EXCEPTION 'Pick at most 3 colours.' USING ERRCODE = '22023'; END IF;
    FOR e IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ '^#[0-9A-Fa-f]{6}$' THEN
        RAISE EXCEPTION 'A colour is #rrggbb.' USING ERRCODE = '22023';
      END IF;
      IF NOT (arr @> jsonb_build_array(lower(e #>> '{}'))) THEN arr := arr || jsonb_build_array(lower(e #>> '{}')); END IF;
    END LOOP;
    RETURN nullif(arr, '[]'::jsonb);
  WHEN 'opening_price' THEN
    SELECT c.parts INTO v_parts FROM public.cockpit_upsell_catalog c WHERE c.offer_key = p_offer;
    v_want := ARRAY(SELECT x->>'key' FROM jsonb_array_elements(v_parts) x);
    IF t <> 'object' THEN RAISE EXCEPTION 'The opening price names each part and its dollars.' USING ERRCODE = '22023'; END IF;
    ks := ARRAY(SELECT jsonb_object_keys(p_value));
    IF NOT (ks @> v_want AND ks <@ v_want) THEN
      RAISE EXCEPTION 'Type the opening price for %.', public.cockpit_upsell_parts_named(p_offer, v_parts) USING ERRCODE = '22023';
    END IF;
    FOR k, e IN SELECT key, value FROM jsonb_each(p_value) LOOP
      IF NOT public.cockpit_upsell_usd_ok(e) THEN
        RAISE EXCEPTION 'A price is a dollar amount from 1 to 1,000,000, with at most two decimals.' USING ERRCODE = '22023';
      END IF;
    END LOOP;
    RETURN p_value;
  WHEN 'project_value' THEN
    IF t <> 'object' THEN RAISE EXCEPTION 'A typical project is its amount, its currency and where it came from.' USING ERRCODE = '22023'; END IF;
    ks := ARRAY(SELECT jsonb_object_keys(p_value));
    IF NOT (ks <@ ARRAY['amount','currency','from','said_on'] AND ks @> ARRAY['amount','currency','from']) THEN
      RAISE EXCEPTION 'A typical project is its amount, its currency and where it came from.' USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(p_value->'amount') <> 'number' OR (p_value->>'amount')::numeric <= 0 OR (p_value->>'amount')::numeric > 100000000 THEN
      RAISE EXCEPTION 'The typical project is an amount above 0 and up to 100,000,000.' USING ERRCODE = '22023';
    END IF;
    PERFORM public.cockpit_upsell_choice(p_value->'currency', ARRAY['KWD','SAR','AED','QAR','BHD','OMR','USD'], 'The currency');
    PERFORM public.cockpit_upsell_choice(p_value->'from', ARRAY['typed','onboarding'], 'Where it came from');
    d := public.cockpit_upsell_date(p_value->'said_on', 'The date they said it');
    IF d > public.cockpit_upsell_today() THEN RAISE EXCEPTION 'The date they said it is today or earlier.' USING ERRCODE = '22023'; END IF;
    RETURN jsonb_strip_nulls(jsonb_build_object('amount', p_value->'amount', 'currency', p_value->'currency',
                                                'from', p_value->'from', 'said_on', to_char(d, 'YYYY-MM-DD')));
  WHEN 'payment_link' THEN
    s := public.cockpit_upsell_text(p_value, 330, 'The payment link');
    IF s IS NULL THEN RETURN NULL; END IF;
    IF s !~ '^https://whop\.com/checkout/[A-Za-z0-9_-]{3,80}/?$'
       AND NOT (s ~ '^https://invoice\.ecom\.io/[^[:space:]<>"'']+$' AND char_length(s) <= 326) THEN
      RAISE EXCEPTION 'Paste a Whop checkout link or an ecom invoice link.' USING ERRCODE = '22023';
    END IF;
    RETURN to_jsonb(s);
  WHEN 'client_asked' THEN
    IF t <> 'object' THEN RAISE EXCEPTION 'Client asked is their words and the date they said them.' USING ERRCODE = '22023'; END IF;
    ks := ARRAY(SELECT jsonb_object_keys(p_value));
    IF NOT (ks @> ARRAY['words','on'] AND ks <@ ARRAY['words','on']) THEN
      RAISE EXCEPTION 'Client asked is their words and the date they said them.' USING ERRCODE = '22023';
    END IF;
    s := public.cockpit_upsell_text(p_value->'words', 300, 'What they said', 3);
    IF s IS NULL THEN RAISE EXCEPTION 'Type their words, at least 3 characters.' USING ERRCODE = '22023'; END IF;
    d := public.cockpit_upsell_date(p_value->'on', 'The date they asked');
    IF d IS NULL OR d > public.cockpit_upsell_today() OR d < public.cockpit_upsell_today() - 30 THEN
      RAISE EXCEPTION 'The date they asked is within the last 30 days.' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('words', s, 'on', to_char(d, 'YYYY-MM-DD'));
  WHEN 'hidden_slides', 'shown_slides' THEN
    IF t <> 'array' OR jsonb_array_length(p_value) > 30 THEN RAISE EXCEPTION '% must be a list of slide ids', p_key USING ERRCODE = '22023'; END IF;
    FOR e IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ '^[a-z0-9-]{1,40}$' THEN
        RAISE EXCEPTION '% must be a list of slide ids', p_key USING ERRCODE = '22023';
      END IF;
      IF NOT (arr @> jsonb_build_array(e)) THEN arr := arr || jsonb_build_array(e); END IF;
    END LOOP;
    RETURN nullif(arr, '[]'::jsonb);
  WHEN 'presented_at' THEN
    -- Stamped by the server; a client clock is never trusted. false clears it.
    IF p_value = 'false'::jsonb THEN RETURN NULL; END IF;
    IF t NOT IN ('boolean','string') THEN RAISE EXCEPTION 'presented_at is set with true and cleared with null' USING ERRCODE = '22023'; END IF;
    RETURN to_jsonb(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  ELSE
    RAISE EXCEPTION 'Prep does not keep "%"', p_key USING ERRCODE = '22023';
  END CASE;
END $$;

-- The price rules after the merge: a locked offer opens at its list price
-- (and cannot open while its list is blank); below a set list needs a reason.
CREATE OR REPLACE FUNCTION public.cockpit_csm_offer_price_check(p_offer text, p_prep jsonb) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.cockpit_upsell_catalog; op jsonb; e jsonb;
BEGIN
  op := p_prep->'opening_price';
  IF op IS NULL THEN RETURN; END IF;
  SELECT * INTO c FROM public.cockpit_upsell_catalog x WHERE x.offer_key = p_offer;
  IF p_offer = 'website' AND NOT (op ? 'build' AND op ? 'care') THEN
    RAISE EXCEPTION 'The website always carries its care plan: type both prices.' USING ERRCODE = '22023';
  END IF;
  IF c.locked THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(c.parts) x WHERE jsonb_typeof(x->'amount') = 'null') THEN
      RAISE EXCEPTION 'This price is locked. The CEO sets it on Money > Offers.' USING ERRCODE = '22023';
    END IF;
    FOR e IN SELECT value FROM jsonb_array_elements(c.parts) LOOP
      IF (op->>(e->>'key'))::numeric IS DISTINCT FROM (e->>'amount')::numeric THEN
        RAISE EXCEPTION '%: locked at the list price (%).', public.cockpit_upsell_part_name(p_offer, e->>'key'),
          public.cockpit_upsell_money((e->>'amount')::numeric) USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(c.parts) LOOP
    IF jsonb_typeof(e->'amount') = 'number' AND (op->>(e->>'key'))::numeric < (e->>'amount')::numeric
       AND NOT (p_prep ? 'opening_reason') THEN
      RAISE EXCEPTION '%: below the list price (%). Add a one-line reason.', public.cockpit_upsell_part_name(p_offer, e->>'key'),
        public.cockpit_upsell_money((e->>'amount')::numeric) USING ERRCODE = '22023';
    END IF;
  END LOOP;
END $$;

-- The price rules' sentence for the opening price prep holds now, or null
-- when it passes. A save checks the rules only when it touches the price, so
-- a later list change or lock can leave a stored price that no longer
-- passes: the status counts it as no_price and the sources say why.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_price_problem(p_offer text, p_prep jsonb) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_csm_offer_price_check(p_offer, coalesce(p_prep, '{}'::jsonb));
  RETURN NULL;
EXCEPTION WHEN sqlstate '22023' THEN
  RETURN SQLERRM;
END $$;

-- The decks' one prep save, now for offer decks too (20261026v). Onboarding
-- and launch keep every rule they had; an offer deck's keys go through
-- cockpit_csm_offer_prep_value, and its price rules run after the merge
-- whenever the save touches the opening price or its reason.
CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_prep_save(p_task_id text, p_deck text, p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb; cur public.cockpit_csm_deck_prep; merged jsonb; k text; v jsonb; nv jsonb; v_meta jsonb; v_offer text;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  v_offer := substring(p_deck from '^offer_(website|second_campaign|seo_geo|smm|ugc|closer|cameraman)$');
  IF p_deck IS NULL OR (p_deck NOT IN ('onboarding','launch') AND v_offer IS NULL) THEN RAISE EXCEPTION 'Choose the onboarding or the launch deck'; END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'Send the prep changes as named values';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_patch)) > 40 THEN RAISE EXCEPTION 'Send at most 40 prep changes at once'; END IF;
  -- Two windows (prep and notes) save the same row: one merge at a time.
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_csm_deck_prep:' || p_task_id || ':' || p_deck, 0));
  SELECT * INTO cur FROM public.cockpit_csm_deck_prep p WHERE p.task_id = p_task_id AND p.deck = p_deck FOR UPDATE;
  merged := coalesce(cur.overrides, '{}'::jsonb);
  IF v_offer IS NULL AND EXISTS (SELECT 1 FROM jsonb_each(p_patch) x
              WHERE x.key IN ('their_pick','phones','meta_ad_text','form_confirmed') AND jsonb_typeof(x.value) <> 'null') THEN
    v_meta := public.cockpit_csm_deck_meta(p_task_id, g->>'clientName');
  END IF;
  FOR k, v IN SELECT key, value FROM jsonb_each(p_patch) LOOP
    IF v_offer IS NULL THEN
      nv := public.cockpit_csm_deck_prep_value(p_task_id, k, v, v_meta);
    ELSE
      nv := public.cockpit_csm_offer_prep_value(p_task_id, v_offer, k, v);
    END IF;
    -- A stamp keeps its first time until it is cleared.
    IF k IN ('creative_agreed_at','onboarding_presented_at','presented_at') AND nv IS NOT NULL AND merged ? k THEN CONTINUE; END IF;
    IF nv IS NULL THEN merged := merged - k; ELSE merged := merged || jsonb_build_object(k, nv); END IF;
  END LOOP;
  IF v_offer IS NOT NULL AND (p_patch ? 'opening_price' OR p_patch ? 'opening_reason') THEN
    PERFORM public.cockpit_csm_offer_price_check(v_offer, merged);
  END IF;
  IF octet_length(merged::text) > 65536 THEN RAISE EXCEPTION 'This deck''s prep is too large to save. Shorten the typed lines'; END IF;
  IF cur.task_id IS NOT NULL AND merged = cur.overrides THEN
    RETURN jsonb_build_object('deck', cur.deck, 'overrides', cur.overrides, 'revision', cur.revision,
                              'updatedAt', cur.updated_at, 'updatedBy', cur.updated_by, 'changed', false);
  END IF;
  IF cur.task_id IS NULL AND merged = '{}'::jsonb THEN
    RETURN jsonb_build_object('deck', p_deck, 'overrides', merged, 'revision', 0, 'updatedAt', NULL, 'updatedBy', NULL, 'changed', false);
  END IF;
  PERFORM set_config('cockpit.deck_action', 'deckPrep.save', true);
  INSERT INTO public.cockpit_csm_deck_prep AS p (task_id, deck, overrides, revision, updated_at, updated_by)
  VALUES (p_task_id, p_deck, merged, 1, now(), g->>'email')
  ON CONFLICT (task_id, deck) DO UPDATE
    SET overrides = excluded.overrides, revision = p.revision + 1, updated_at = now(), updated_by = excluded.updated_by
  RETURNING * INTO cur;
  RETURN jsonb_build_object('deck', cur.deck, 'overrides', cur.overrides, 'revision', cur.revision,
                            'updatedAt', cur.updated_at, 'updatedBy', cur.updated_by, 'changed', true);
END $$;

-- ---------------------------------------------------------------------------
-- 2 (cont.). Videos: offer decks read like the others; only the CEO changes
-- an offer's video
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_videos_read(p_deck text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_csm_actor();
  IF p_deck IS NULL OR (p_deck NOT IN ('onboarding','launch')
                        AND p_deck !~ '^offer_(website|second_campaign|seo_geo|smm|ugc|closer|cameraman)$') THEN
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
  IF p_deck IS NULL OR (p_deck NOT IN ('onboarding','launch')
                        AND p_deck !~ '^offer_(website|second_campaign|seo_geo|smm|ugc|closer|cameraman)$') THEN
    RAISE EXCEPTION 'Choose the onboarding or the launch deck.' USING ERRCODE = '22023';
  END IF;
  IF p_deck LIKE 'offer\_%' AND NOT coalesce(public.cockpit_is_ceo(), false) THEN
    RAISE EXCEPTION 'Only the CEO changes an offer''s video.' USING ERRCODE = '42501';
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
  IF v_title ~ E'[[:cntrl:]‪-‮⁦-⁩  ]' THEN
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

CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_video_clear(
  p_deck text, p_slot_key text, p_lang text, p_revision integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_who text; cur public.cockpit_csm_deck_videos; saved public.cockpit_csm_deck_videos;
BEGIN
  PERFORM public.cockpit_csm_actor();
  IF p_deck IS NULL OR (p_deck NOT IN ('onboarding','launch')
                        AND p_deck !~ '^offer_(website|second_campaign|seo_geo|smm|ugc|closer|cameraman)$') THEN
    RAISE EXCEPTION 'Choose the onboarding or the launch deck.' USING ERRCODE = '22023';
  END IF;
  IF p_deck LIKE 'offer\_%' AND NOT coalesce(public.cockpit_is_ceo(), false) THEN
    RAISE EXCEPTION 'Only the CEO changes an offer''s video.' USING ERRCODE = '42501';
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
-- 3 (cont.). Capture files
-- ---------------------------------------------------------------------------

-- Reserves one capture upload. The same request id returns the same row for
-- the same seat and file; the Edge Function then signs its upload.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_file_reserve(
  p_request_id uuid, p_task_id text, p_kind text, p_mime text, p_bytes bigint,
  p_width integer, p_height integer, p_file_name text, p_captured_on date, p_searched_as text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g jsonb; f public.cockpit_upsell_files; v_id uuid; v_ext text; v_name text; v_searched text; v_pending integer; v_count integer;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'An upload request id is required.' USING ERRCODE = '22023'; END IF;
  IF p_kind IS NULL OR p_kind <> 'capture' THEN RAISE EXCEPTION 'A capture is the only kind of file here.' USING ERRCODE = '22023'; END IF;
  v_ext := CASE p_mime WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' END;
  IF v_ext IS NULL THEN RAISE EXCEPTION 'Add a picture (JPG, PNG or WebP).' USING ERRCODE = '22023'; END IF;
  IF p_bytes IS NULL OR p_bytes < 1 THEN RAISE EXCEPTION 'The picture is empty.' USING ERRCODE = '22023'; END IF;
  IF p_bytes > 10485760 THEN RAISE EXCEPTION 'The picture is over 10 MB. Export a smaller copy.' USING ERRCODE = '22023'; END IF;
  IF (p_width IS NOT NULL AND p_width NOT BETWEEN 1 AND 20000) OR (p_height IS NOT NULL AND p_height NOT BETWEEN 1 AND 20000) THEN
    RAISE EXCEPTION 'The picture''s size is not valid.' USING ERRCODE = '22023';
  END IF;
  IF p_captured_on IS NULL OR p_captured_on > public.cockpit_upsell_today() OR p_captured_on < public.cockpit_upsell_today() - 365 THEN
    RAISE EXCEPTION 'Give the day the screenshot was taken, today or in the last year.' USING ERRCODE = '22023';
  END IF;
  -- The deck and the proposal show it to the client.
  v_searched := public.cockpit_upsell_copy_refuse(public.cockpit_upsell_text(to_jsonb(p_searched_as), 80, 'Searched as'), 'Searched as');
  -- The name the notes show: no folders, no control characters.
  v_name := nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p_file_name, ''), '^.*[/\\]', ''), '[[:cntrl:]]', '', 'g')), 200), '');

  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_upsell_files:' || p_request_id::text, 0));
  SELECT * INTO f FROM public.cockpit_upsell_files x WHERE x.request_id = p_request_id;
  IF f.id IS NOT NULL THEN
    IF f.created_by IS DISTINCT FROM auth.uid() OR f.task_id <> p_task_id OR f.kind <> p_kind OR f.mime <> p_mime OR f.bytes <> p_bytes THEN
      RAISE EXCEPTION 'This request id belongs to a different file. Add the file again.' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object('id', f.id, 'path', f.storage_path, 'kind', f.kind, 'mime', f.mime, 'bytes', f.bytes, 'status', f.status);
  END IF;
  -- Request first, client second: idempotent retries return above; different
  -- uploads of this client share one cap check and insert transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_upsell_files:client:' || p_task_id, 0));
  -- A failed upload is removed by the page at once; one left by a closed tab
  -- stops counting after an hour, so the cap clears itself.
  SELECT count(*) INTO v_pending FROM public.cockpit_upsell_files x
   WHERE x.task_id = p_task_id AND x.status = 'uploading' AND x.created_at > now() - interval '1 hour';
  IF v_pending >= 20 THEN
    RAISE EXCEPTION 'This client has 20 unfinished uploads. Wait a few minutes, then add the picture again.' USING ERRCODE = '22023';
  END IF;
  SELECT count(*) INTO v_count FROM public.cockpit_upsell_files x WHERE x.task_id = p_task_id AND x.status <> 'removed';
  IF v_count >= 100 THEN RAISE EXCEPTION 'This client has 100 captures already. Remove some first.' USING ERRCODE = '22023'; END IF;

  v_id := gen_random_uuid();
  PERFORM set_config('cockpit.upsell_action', 'upsellFiles.reserve', true);
  PERFORM set_config('cockpit.upsell_line', '', true);
  INSERT INTO public.cockpit_upsell_files (id, request_id, task_id, kind, status, storage_path, mime, bytes, width, height,
      file_name, searched_as, captured_on, created_by, created_by_email, updated_by)
  VALUES (v_id, p_request_id, p_task_id, p_kind, 'uploading', p_task_id || '/' || v_id::text || '.' || v_ext, p_mime, p_bytes,
      p_width, p_height, v_name, v_searched, p_captured_on, auth.uid(), g->>'email', g->>'email')
  RETURNING * INTO f;
  RETURN jsonb_build_object('id', f.id, 'path', f.storage_path, 'kind', f.kind, 'mime', f.mime, 'bytes', f.bytes, 'status', f.status);
END $$;

-- The upload arrived: Storage's own metadata must match the reservation.
-- Only the seat that reserved it can accept it; a second accept is a no-op.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_file_accept(p_task_id text, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g jsonb; f public.cockpit_upsell_files; meta jsonb;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  SELECT * INTO f FROM public.cockpit_upsell_files x WHERE x.id = p_id AND x.task_id = p_task_id FOR UPDATE;
  IF f.id IS NULL THEN RAISE EXCEPTION 'That file is not one of this client''s captures.' USING ERRCODE = '42501'; END IF;
  IF f.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the person who started this upload can finish it.' USING ERRCODE = '42501';
  END IF;
  IF f.status = 'removed' THEN RAISE EXCEPTION 'This capture was removed. Add it again.' USING ERRCODE = '22023'; END IF;
  IF f.status = 'ready' THEN RETURN public.cockpit_upsell_file_json(f); END IF;
  SELECT o.metadata INTO meta FROM storage.objects o WHERE o.bucket_id = 'cockpit-upsell-files' AND o.name = f.storage_path;
  IF meta IS NULL THEN RAISE EXCEPTION 'The picture did not arrive. Add it again.' USING ERRCODE = '22023'; END IF;
  IF coalesce(meta->>'size', '') !~ '^[0-9]{1,12}$' OR (meta->>'size')::bigint <> f.bytes
     OR lower(coalesce(meta->>'mimetype', '')) <> f.mime THEN
    RAISE EXCEPTION 'The uploaded picture does not match what was reserved. Add it again.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.upsell_action', 'upsellFiles.ready', true);
  PERFORM set_config('cockpit.upsell_line', '', true);
  UPDATE public.cockpit_upsell_files x SET status = 'ready', ready_at = now(), updated_at = now(), updated_by = g->>'email'
   WHERE x.id = f.id RETURNING * INTO f;
  RETURN public.cockpit_upsell_file_json(f);
END $$;

-- What it was searched as, the day it was taken and its caption. A null
-- clears the search or the caption; the day stays.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_file_update(p_task_id text, p_id uuid, p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g jsonb; cur public.cockpit_upsell_files; nxt public.cockpit_upsell_files; k text; v jsonb; d date;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'Send the changes as named values.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO cur FROM public.cockpit_upsell_files x WHERE x.id = p_id AND x.task_id = p_task_id FOR UPDATE;
  IF cur.id IS NULL THEN RAISE EXCEPTION 'That file is not one of this client''s captures.' USING ERRCODE = '42501'; END IF;
  IF cur.status = 'removed' THEN RAISE EXCEPTION 'This capture was removed.' USING ERRCODE = '22023'; END IF;
  nxt := cur;
  FOR k, v IN SELECT key, value FROM jsonb_each(p_patch) LOOP
    CASE k
    -- Both show to the client on the deck and the proposal.
    WHEN 'searched_as' THEN nxt.searched_as := public.cockpit_upsell_copy_refuse(public.cockpit_upsell_text(v, 80, 'Searched as'), 'Searched as');
    WHEN 'caption' THEN nxt.caption := public.cockpit_upsell_copy_refuse(public.cockpit_upsell_text(v, 120, 'The caption'), 'The caption');
    WHEN 'captured_on' THEN
      d := public.cockpit_upsell_date(v, 'The day it was taken');
      IF d IS NULL OR d > public.cockpit_upsell_today() OR d < public.cockpit_upsell_today() - 365 THEN
        RAISE EXCEPTION 'Give the day the screenshot was taken, today or in the last year.' USING ERRCODE = '22023';
      END IF;
      nxt.captured_on := d;
    ELSE RAISE EXCEPTION 'A capture does not keep "%".', k USING ERRCODE = '22023';
    END CASE;
  END LOOP;
  IF nxt IS NOT DISTINCT FROM cur THEN RETURN public.cockpit_upsell_file_json(cur); END IF;
  PERFORM set_config('cockpit.upsell_action', 'upsellFiles.update', true);
  PERFORM set_config('cockpit.upsell_line', '', true);
  UPDATE public.cockpit_upsell_files x
     SET searched_as = nxt.searched_as, caption = nxt.caption, captured_on = nxt.captured_on, updated_at = now(), updated_by = g->>'email'
   WHERE x.id = cur.id RETURNING * INTO cur;
  RETURN public.cockpit_upsell_file_json(cur);
END $$;

-- Takes a capture away for good (an unfinished upload included). The row
-- stays for the audit; cockpit-csm-api deletes the bytes and records it with
-- cockpit_upsell_file_purged. A second remove is a no-op.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_file_remove(p_task_id text, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g jsonb; f public.cockpit_upsell_files;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  SELECT * INTO f FROM public.cockpit_upsell_files x WHERE x.id = p_id AND x.task_id = p_task_id FOR UPDATE;
  IF f.id IS NULL THEN RAISE EXCEPTION 'That file is not one of this client''s captures.' USING ERRCODE = '42501'; END IF;
  IF f.status = 'removed' THEN RETURN public.cockpit_upsell_file_json(f); END IF;
  PERFORM set_config('cockpit.upsell_action', 'upsellFiles.remove', true);
  PERFORM set_config('cockpit.upsell_line', '', true);
  UPDATE public.cockpit_upsell_files x SET status = 'removed', removed_at = now(), updated_at = now(), updated_by = g->>'email'
   WHERE x.id = f.id RETURNING * INTO f;
  RETURN public.cockpit_upsell_file_json(f);
END $$;

-- This client's ready captures, newest day first.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_files_read(p_task_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_csm_client_gate(p_task_id);
  RETURN jsonb_build_object('rows', public.cockpit_upsell_files_rows(p_task_id));
END $$;

-- This client's files whose bytes should go: removed and not yet purged, or
-- an upload left unfinished for a day. At most 50 at a time.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_files_stale(p_task_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_csm_client_gate(p_task_id);
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'path', x.storage_path) ORDER BY x.created_at), '[]'::jsonb)
            FROM (SELECT f.id, f.storage_path, f.created_at FROM public.cockpit_upsell_files f
                   WHERE f.task_id = p_task_id
                     AND ((f.status = 'removed' AND f.purged_at IS NULL)
                          OR (f.status = 'uploading' AND f.created_at < now() - interval '1 day'))
                   ORDER BY f.created_at LIMIT 50) x);
END $$;

-- The bytes were deleted from the bucket (cockpit-csm-api, with the service
-- key): each removed or day-old unfinished row of this client turns removed
-- with its purge time (audited). Ready rows and other clients' ids stay.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_file_purged(p_task_id text, p_ids uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n integer;
BEGIN
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN RAISE EXCEPTION 'Choose a valid ClickUp client ID' USING ERRCODE = '22023'; END IF;
  IF p_ids IS NULL OR cardinality(p_ids) > 50 THEN RAISE EXCEPTION 'Send at most 50 files at once.' USING ERRCODE = '22023'; END IF;
  PERFORM set_config('cockpit.upsell_action', 'upsellFiles.purge', true);
  PERFORM set_config('cockpit.upsell_line', '', true);
  UPDATE public.cockpit_upsell_files x
     SET status = 'removed', removed_at = coalesce(x.removed_at, now()), purged_at = now(), updated_at = now(), updated_by = 'cockpit-csm-api'
   WHERE x.task_id = p_task_id AND x.id = ANY (p_ids) AND x.purged_at IS NULL
     AND (x.status = 'removed' OR (x.status = 'uploading' AND x.created_at < now() - interval '1 day'));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Wins and site checks
-- ---------------------------------------------------------------------------

-- The CSM's "They've had a win": the win in their words and its day, within
-- the last 30 days. Audited with the CEO card's sentence.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_win_mark(p_task_id text, p_text text, p_won_on date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g jsonb; v_text text; w public.cockpit_upsell_wins;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  v_text := public.cockpit_upsell_text(to_jsonb(p_text), 200, 'The win', 3);
  IF v_text IS NULL THEN RAISE EXCEPTION 'Write the win in, at least 3 characters.' USING ERRCODE = '22023'; END IF;
  IF p_won_on IS NULL OR p_won_on > public.cockpit_upsell_today() OR p_won_on < public.cockpit_upsell_today() - 30 THEN
    RAISE EXCEPTION 'A win counts when it happened in the last 30 days.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.upsell_action', 'upsellWin.mark', true);
  PERFORM set_config('cockpit.upsell_line', format('Win ticked for %s: %s (%s)', g->>'clientName', v_text, public.cockpit_upsell_day(p_won_on)), true);
  INSERT INTO public.cockpit_upsell_wins (task_id, text, won_on, created_by_email)
  VALUES (p_task_id, v_text, p_won_on, g->>'email') RETURNING * INTO w;
  RETURN jsonb_build_object('id', w.id, 'taskId', w.task_id, 'text', w.text, 'wonOn', to_jsonb(w.won_on),
                            'createdBy', w.created_by_email, 'createdAt', to_jsonb(w.created_at));
END $$;

-- The site: every address on file, the latest checks of those addresses and
-- the verdict. broken needs two failed checks 20 hours apart with no working
-- check since the first of them; one failure (or failures closer together)
-- is failing. A check the Edge Function refused to make counts for neither.
CREATE OR REPLACE FUNCTION public.cockpit_client_site_verdict(p_task_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_urls jsonb := '[]'::jsonb; v_norm text[] := '{}'; v_card text; v_onb text; v_prep text; x record;
  v_checks jsonb; v_latest public.cockpit_client_site_checks; v_last_ok timestamptz; v_first_fail timestamptz; v_last_fail timestamptz;
  v_fails integer; v_verdict text; v_note text; v_disagree boolean := false; v_insta boolean := false;
BEGIN
  SELECT nullif(btrim(e.website), '') INTO v_card FROM public.editor_clients e WHERE e.task_id = p_task_id;
  SELECT CASE WHEN jsonb_typeof(o.links->'website') = 'string' THEN nullif(btrim(o.links->>'website'), '') END INTO v_onb
    FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_task_id;
  v_prep := nullif(btrim(public.cockpit_upsell_prep_of(p_task_id, 'website')->>'site_url'), '');
  FOR x IN SELECT * FROM (VALUES (1, v_card, 'card'), (2, v_onb, 'onboarding'), (3, v_prep, 'prep')) u(n, url, src)
            WHERE u.url IS NOT NULL ORDER BY u.n LOOP
    IF NOT (public.cockpit_upsell_url_key(x.url) = ANY (v_norm)) THEN
      v_norm := v_norm || public.cockpit_upsell_url_key(x.url);
      v_urls := v_urls || jsonb_build_array(jsonb_build_object('url', x.url, 'from', x.src));
    END IF;
  END LOOP;
  IF v_card IS NOT NULL AND v_onb IS NOT NULL THEN
    v_disagree := split_part(public.cockpit_upsell_url_key(v_card), '/', 1) <> split_part(public.cockpit_upsell_url_key(v_onb), '/', 1);
  END IF;
  v_insta := cardinality(v_norm) > 0 AND NOT EXISTS (SELECT 1 FROM unnest(v_norm) n WHERE split_part(n, '/', 1) NOT IN ('instagram.com','instagr.am'));

  SELECT coalesce(jsonb_agg(jsonb_build_object('url', c.url, 'source', c.source, 'status', c.status, 'httpStatus', c.http_status,
           'finalUrl', c.final_url, 'title', c.title, 'checkedAt', to_jsonb(c.checked_at)) ORDER BY c.checked_at DESC, c.id DESC), '[]'::jsonb)
    INTO v_checks
    FROM (SELECT * FROM public.cockpit_client_site_checks c WHERE c.task_id = p_task_id
            AND public.cockpit_upsell_url_key(c.url) = ANY (v_norm)
          ORDER BY c.checked_at DESC, c.id DESC LIMIT 10) c;

  SELECT * INTO v_latest FROM public.cockpit_client_site_checks c
   WHERE c.task_id = p_task_id AND c.status <> 'refused' AND public.cockpit_upsell_url_key(c.url) = ANY (v_norm)
   ORDER BY c.checked_at DESC, c.id DESC LIMIT 1;
  IF cardinality(v_norm) = 0 THEN
    v_verdict := 'none_on_file';
    v_note := 'No website on file: not on the card, the onboarding form or prep.';
  ELSIF v_latest.id IS NULL THEN
    v_verdict := 'not_checked';
    v_note := 'Site not checked yet. Run the site check.';
  ELSIF v_latest.status = 'ok' THEN
    v_verdict := 'ok';
    v_note := format('The site worked when checked on %s.', public.cockpit_upsell_day(public.cockpit_upsell_kday(v_latest.checked_at)));
  ELSE
    SELECT max(c.checked_at) INTO v_last_ok FROM public.cockpit_client_site_checks c
     WHERE c.task_id = p_task_id AND c.status = 'ok' AND public.cockpit_upsell_url_key(c.url) = ANY (v_norm);
    SELECT min(c.checked_at), max(c.checked_at), count(*) INTO v_first_fail, v_last_fail, v_fails
      FROM public.cockpit_client_site_checks c
     WHERE c.task_id = p_task_id AND c.status NOT IN ('ok','refused') AND public.cockpit_upsell_url_key(c.url) = ANY (v_norm)
       AND (v_last_ok IS NULL OR c.checked_at > v_last_ok);
    IF v_last_fail - v_first_fail >= interval '20 hours' THEN
      v_verdict := 'broken';
      v_note := format('No working site, checked %s, %s.', CASE v_fails WHEN 2 THEN 'twice' ELSE v_fails::text || ' times' END,
                       public.cockpit_upsell_two_days(public.cockpit_upsell_kday(v_first_fail), public.cockpit_upsell_kday(v_last_fail)));
    ELSE
      v_verdict := 'failing';
      v_note := format('The site failed on %s. Check again from %s to confirm.', public.cockpit_upsell_day(public.cockpit_upsell_kday(v_first_fail)),
                       public.cockpit_upsell_day(public.cockpit_upsell_kday(v_first_fail + interval '20 hours')));
    END IF;
  END IF;
  IF v_disagree THEN v_note := v_note || ' The card and the onboarding form give different sites.'; END IF;
  IF v_insta THEN v_note := v_note || ' The only address on file is an Instagram page.'; END IF;
  RETURN jsonb_build_object('verdict', v_verdict, 'urls', v_urls, 'checks', v_checks, 'disagree', v_disagree,
                            'instagramOnly', v_insta, 'note', v_note,
                            'firstFailAt', CASE WHEN v_verdict IN ('broken','failing') THEN to_jsonb(v_first_fail) END,
                            'lastFailAt', CASE WHEN v_verdict IN ('broken','failing') THEN to_jsonb(v_last_fail) END);
END $$;

-- An address to compare: no scheme, no www., no trailing slash, lower case.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_url_key(p_url text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT rtrim(regexp_replace(regexp_replace(lower(btrim(coalesce(p_url, ''))), '^[a-z]+://', ''), '^www\.', ''), '/')
$$;

-- One site check, as the Edge Function made it (status, HTTP status, final
-- address, title). At most 6 per client per hour.
CREATE OR REPLACE FUNCTION public.cockpit_client_site_check_record(p_task_id text, p_url text, p_source text, p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g jsonb; v_url text; v_status text; v_http integer; v_final text; v_title text; n integer; c public.cockpit_client_site_checks;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  v_url := btrim(coalesce(p_url, ''));
  IF v_url = '' OR char_length(v_url) > 300 OR v_url !~* '^https?://[^[:space:]]+$' THEN
    RAISE EXCEPTION 'Check a site''s http or https address.' USING ERRCODE = '22023';
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('card','onboarding','prep') THEN
    RAISE EXCEPTION 'Say where the address came from: card, onboarding or prep.' USING ERRCODE = '22023';
  END IF;
  IF p_result IS NULL OR jsonb_typeof(p_result) <> 'object' THEN
    RAISE EXCEPTION 'Send the check''s result.' USING ERRCODE = '22023';
  END IF;
  v_status := p_result->>'status';
  IF v_status IS NULL OR v_status NOT IN ('ok','parked','expired','dns','tls','http_error','timeout','redirect_offsite','instagram','empty','refused') THEN
    RAISE EXCEPTION 'The check''s status is not one the site check knows.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_result->'httpStatus') = 'number' AND (p_result->>'httpStatus') ~ '^[0-9]{3}$'
     AND (p_result->>'httpStatus')::integer BETWEEN 100 AND 599 THEN
    v_http := (p_result->>'httpStatus')::integer;
  END IF;
  IF jsonb_typeof(p_result->'finalUrl') = 'string' THEN
    v_final := nullif(left(regexp_replace(btrim(p_result->>'finalUrl'), '[[:space:][:cntrl:]]', '', 'g'), 500), '');
  END IF;
  IF jsonb_typeof(p_result->'title') = 'string' THEN
    v_title := nullif(left(btrim(regexp_replace(p_result->>'title', E'[[:cntrl:]‪-‮⁦-⁩  ]', ' ', 'g')), 200), '');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_client_site_checks:' || p_task_id, 0));
  SELECT count(*) INTO n FROM public.cockpit_client_site_checks x WHERE x.task_id = p_task_id AND x.checked_at > now() - interval '1 hour';
  IF n >= 6 THEN RAISE EXCEPTION 'Checked 6 times this hour. Try again later.' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.cockpit_client_site_checks (task_id, url, source, status, http_status, final_url, title, checked_by_email)
  VALUES (p_task_id, v_url, p_source, v_status, v_http, v_final, v_title, g->>'email') RETURNING * INTO c;
  RETURN jsonb_build_object(
    'check', jsonb_build_object('id', c.id, 'url', c.url, 'source', c.source, 'status', c.status, 'httpStatus', c.http_status,
                                'finalUrl', c.final_url, 'title', c.title, 'checkedAt', to_jsonb(c.checked_at)),
    'verdict', public.cockpit_client_site_verdict(p_task_id));
END $$;

-- ---------------------------------------------------------------------------
-- 5. The offer gate, the sources and the status
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_csm_offer_check(p_key text, p_ok boolean, p_fail text, p_pass text, p_source text, p_at jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('key', p_key, 'ok', coalesce(p_ok, false),
    'text', CASE WHEN coalesce(p_ok, false) THEN p_pass ELSE p_fail END, 'source', p_source, 'at', p_at)
$$;

-- The ten checks, in order (BACKEND.md 2.3). Failing checks are reasons,
-- passing ones are passed; the deck opens proactively only when reasons is
-- empty. A win is a quotation in the last 30 days, a signed project on any
-- day, or the CSM's tick in the last 30 days. The renewal date is the latest
-- renewal plan's, else the launch date + 90 days; offers pause from 30 days
-- before it until an outcome is recorded, and at most until 30 days after it.
-- Each check's source is a plain label the CSM reads on the refusal screen
-- and the picker ("Call log", "Client sheet"), never a table name.
CREATE OR REPLACE FUNCTION public.cockpit_csm_offer_gate(p_task_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb; c jsonb; checks jsonb := '[]'::jsonb; ok boolean;
  v_synced jsonb; v_stage text; v_happy text; v_launch date; v_days integer;
  v_q date; v_close date; v_tick public.cockpit_upsell_wins; v_win jsonb; v_win_source text;
  v_conf timestamptz; v_call timestamptz; v_last timestamptz;
  v_lc_at timestamptz; v_lc_summary text; v_sentence text;
  v_pitch_on date; v_pitch_offer text; v_prop_on date; v_prop_offer text; v_last_offer jsonb; v_lo_on date; v_lo_offer text;
  v_plan public.cockpit_csm_renewal_plans; v_renew date; v_renew_from text; v_settled boolean;
  esc constant text := '\y(angry|upset|frustrat\w*|furious|complain\w*|threat\w* to (?:leave|cancel)|wants? to cancel|cancel the contract|refund|unhappy|disappointed)\y|زعلان|غاضب|منزعج|مستاء|إلغاء العقد|استرجاع';
  prob constant text := '\y(none qualified|not qualified|no(?:t a single)? (?:leads?|bookings?|shows?)|poor|weak|problem\w*|issues?|blocked|low quality|didn''?t show|concern\w*|worr\w*|unhappy with|not reflect\w*|bottleneck|constraint)\y|(?<![0-9.])0\s?%|مشكل\w*|سيئة|ضعيف|ضعف|لا أحد|غير مؤهل|مخاوف|قلق|غير راض\w*|لا تعكس';
  money constant text := '\y(invoice|billing|contract|dispute|complain\w*|refund|overcharg\w*|postpon\w*)\y|فاتورة|الفوترة|العقد|خلاف|شكوى|استرداد|تأجيل الدفع|الدفعة';
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  c := coalesce(public.cockpit_csm_offer_client(p_task_id), '{}'::jsonb);
  v_synced := CASE WHEN jsonb_typeof(c->'syncedAt') = 'number' THEN to_jsonb(to_timestamp((c->>'syncedAt')::numeric / 1000)) END;
  v_stage := btrim(coalesce(c->>'stage', ''));
  v_happy := btrim(coalesce(c->>'happiness', ''));
  BEGIN
    v_launch := CASE WHEN (c->>'launchDate') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN left(c->>'launchDate', 10)::date END;
  EXCEPTION WHEN OTHERS THEN
    v_launch := NULL;
  END;
  v_days := public.cockpit_upsell_today() - v_launch;

  -- not_active
  ok := lower(v_stage) = 'active' AND (v_stage || ' ' || v_happy) !~* '(paus|stop|cancel|ghost)';
  checks := checks || public.cockpit_csm_offer_check('not_active', ok,
    CASE WHEN v_stage = '' THEN 'No stage on the card. Set it in ClickUp.'
         WHEN lower(v_stage) = 'active' THEN format('The card says Active, but the client is %s.', lower(v_happy))
         ELSE format('The card says %s. Offers wait for Active clients.', v_stage) END,
    'Active on the card.', 'ClickUp card', v_synced);

  -- too_new
  checks := checks || public.cockpit_csm_offer_check('too_new', v_days > 30,
    CASE WHEN v_launch IS NULL THEN 'No launch date on the card. Add it in ClickUp.'
         ELSE format('Live %s days (launched %s). Offers open after day 30, from %s.', v_days, public.cockpit_upsell_day(v_launch),
                     public.cockpit_upsell_day(v_launch + 31)) END,
    format('Live %s days, launched %s.', v_days, public.cockpit_upsell_day(v_launch)), 'ClickUp card', to_jsonb(v_launch));

  -- no_win
  SELECT max(d.day) FILTER (WHERE d.quotations > 0 AND d.day BETWEEN public.cockpit_upsell_today() - 30 AND public.cockpit_upsell_today()),
         max(d.day) FILTER (WHERE d.closes > 0)
    INTO v_q, v_close
    FROM public.cockpit_client_days d
   WHERE d.location_id IN (SELECT x.location_id FROM public.ghl_clients x WHERE x.clickup_id = p_task_id);
  SELECT * INTO v_tick FROM public.cockpit_upsell_wins w
   WHERE w.task_id = p_task_id AND w.won_on BETWEEN public.cockpit_upsell_today() - 30 AND public.cockpit_upsell_today()
   ORDER BY w.won_on DESC, w.id DESC LIMIT 1;
  SELECT y.w, y.src INTO v_win, v_win_source FROM (VALUES
      (1, v_q, jsonb_build_object('kind', 'quotation', 'on', v_q, 'text', format('A quotation on %s, from their sheet.', public.cockpit_upsell_day(v_q))), 'Client sheet'),
      (2, v_close, jsonb_build_object('kind', 'signed', 'on', v_close, 'text', format('A signed project on %s, from their sheet.', public.cockpit_upsell_day(v_close))), 'Client sheet'),
      (3, v_tick.won_on, jsonb_build_object('kind', 'csm_tick', 'on', v_tick.won_on, 'text', v_tick.text), 'Win ticked in the cockpit')
    ) y(n, on_day, w, src)
   WHERE y.on_day IS NOT NULL ORDER BY y.on_day DESC, y.n LIMIT 1;
  checks := checks || public.cockpit_csm_offer_check('no_win', v_win IS NOT NULL,
    'No quotation in 30 days, no signed project on their sheet and no win ticked. If they have had one, tick "They''ve had a win" and write it in.',
    v_win->>'text', coalesce(v_win_source, 'Client sheet and ticked wins'), v_win->'on');

  -- not_happy
  checks := checks || public.cockpit_csm_offer_check('not_happy', v_happy ~* '^(very\s+)?happy\y',
    CASE WHEN v_happy = '' THEN 'No happiness on the card. Set it after your next call.'
         ELSE format('Happiness is %s on the card. Offers wait for Happy or Very Happy.', v_happy) END,
    format('%s on the card.', v_happy), 'ClickUp card', v_synced);

  -- happiness_stale
  SELECT o.confirmed_at INTO v_conf FROM public.cockpit_csm_client_overrides o WHERE o.task_id = p_task_id AND o.data ? 'happiness';
  SELECT max(k.starts_at) INTO v_call FROM public.cockpit_csm_calls k
   WHERE k.task_id = p_task_id AND k.status IN ('held','showed') AND k.starts_at <= now();
  v_last := greatest(v_conf, v_call);
  checks := checks || public.cockpit_csm_offer_check('happiness_stale', v_last >= now() - interval '14 days',
    CASE WHEN v_last IS NULL THEN 'Happiness has never been confirmed on a call. Confirm it on the client page after your next call.'
         ELSE format('Happiness last confirmed %s, more than 14 days ago. Confirm it on the client page after your next call.',
                     public.cockpit_upsell_day(public.cockpit_upsell_kday(v_last))) END,
    format('Happiness confirmed %s.', public.cockpit_upsell_day(public.cockpit_upsell_kday(v_last))),
    CASE WHEN v_conf IS NOT NULL AND v_conf >= coalesce(v_call, v_conf) THEN 'Happiness confirmed in the cockpit' ELSE 'Call log' END,
    to_jsonb(v_last));

  -- red
  checks := checks || public.cockpit_csm_offer_check('red', lower(coalesce(c->>'level', '')) <> 'red',
    'The client is at red. Bring them back first.', 'Not at red.', 'ClickUp card', v_synced);

  -- pause_required
  checks := checks || public.cockpit_csm_offer_check('pause_required', (c->'pauseRequired') IS DISTINCT FROM 'true'::jsonb,
    'The card says a pause is needed. Sort the pause first.', 'No pause needed.', 'ClickUp card', v_synced);

  -- raised_on_last_call
  SELECT k.starts_at, k.summary INTO v_lc_at, v_lc_summary FROM public.cockpit_csm_calls k
   WHERE k.task_id = p_task_id AND k.status IN ('held','showed') AND k.starts_at <= now()
   ORDER BY k.starts_at DESC, k.id DESC LIMIT 1;
  IF v_lc_summary IS NOT NULL THEN
    SELECT btrim(s) INTO v_sentence FROM regexp_split_to_table(v_lc_summary, '(?<=[.!?؟])\s+|\n+') WITH ORDINALITY z(s, i)
     WHERE btrim(s) <> '' AND (s ~* esc OR s ~* prob OR s ~* money) ORDER BY i LIMIT 1;
  END IF;
  checks := checks || public.cockpit_csm_offer_check('raised_on_last_call', v_sentence IS NULL,
    format('Raised on the last call, %s: "%s"', public.cockpit_upsell_day(public.cockpit_upsell_kday(v_lc_at)),
           CASE WHEN char_length(v_sentence) > 160 THEN left(v_sentence, 159) || '…' ELSE v_sentence END),
    CASE WHEN v_lc_at IS NULL THEN 'No held call on record.'
         ELSE format('Nothing raised on the last call, %s.', public.cockpit_upsell_day(public.cockpit_upsell_kday(v_lc_at))) END,
    'Call log', to_jsonb(v_lc_at));

  -- recent_offer
  SELECT p.pitched_on, p.offer_key INTO v_pitch_on, v_pitch_offer FROM public.cockpit_upsell_pitches p
   WHERE p.task_id = p_task_id ORDER BY p.pitched_on DESC, p.created_at DESC LIMIT 1;
  IF to_regclass('public.cockpit_upsell_proposals') IS NOT NULL THEN
    EXECUTE 'SELECT public.cockpit_upsell_kday(x.sent_at), x.offer_key FROM public.cockpit_upsell_proposals x
              WHERE x.task_id = $1 AND x.sent_at IS NOT NULL ORDER BY x.sent_at DESC LIMIT 1'
       INTO v_prop_on, v_prop_offer USING p_task_id;
  END IF;
  IF v_pitch_on IS NOT NULL AND (v_prop_on IS NULL OR v_pitch_on >= v_prop_on) THEN
    v_last_offer := jsonb_build_object('kind', 'pitch', 'offer', v_pitch_offer, 'on', v_pitch_on);
    v_lo_on := v_pitch_on; v_lo_offer := v_pitch_offer;
  ELSIF v_prop_on IS NOT NULL THEN
    v_last_offer := jsonb_build_object('kind', 'proposal', 'offer', v_prop_offer, 'on', v_prop_on);
    v_lo_on := v_prop_on; v_lo_offer := v_prop_offer;
  END IF;
  checks := checks || public.cockpit_csm_offer_check('recent_offer', v_lo_on IS NULL OR v_lo_on < public.cockpit_upsell_today() - 30,
    format('%s offered on %s, %s. The next offer can open from %s.', public.cockpit_upsell_offer_name(v_lo_offer),
           public.cockpit_upsell_day(v_lo_on), CASE v_last_offer->>'kind' WHEN 'proposal' THEN 'in a proposal' ELSE 'on a call' END,
           public.cockpit_upsell_day(v_lo_on + 31)),
    CASE WHEN v_lo_on IS NULL THEN 'No offer made yet.'
         ELSE format('Last offer on %s.', public.cockpit_upsell_day(v_lo_on)) END,
    CASE v_last_offer->>'kind' WHEN 'proposal' THEN 'Proposals' ELSE 'Offer log' END,
    to_jsonb(v_lo_on));

  -- renewal_window
  SELECT * INTO v_plan FROM public.cockpit_csm_renewal_plans p WHERE p.task_id = p_task_id ORDER BY p.renewal_date DESC LIMIT 1;
  v_renew := coalesce(v_plan.renewal_date, v_launch + 90);
  v_renew_from := CASE WHEN v_plan.id IS NOT NULL THEN 'plan' WHEN v_launch IS NOT NULL THEN 'launch_plus_90' END;
  v_settled := v_plan.id IS NOT NULL AND coalesce(v_plan.data->>'status', '') IN ('renewed','resold','not_this_cycle','lost');
  checks := checks || public.cockpit_csm_offer_check('renewal_window',
    v_renew IS NULL OR v_settled OR public.cockpit_upsell_today() < v_renew - 30 OR public.cockpit_upsell_today() > v_renew + 30,
    -- Without a plan the date is a guess from the launch, and says so.
    CASE WHEN v_renew_from = 'plan'
      THEN format('Renewal is due %s. Offers wait until the renewal plan has an outcome, or until %s. The website can ride in the renewal as the free care-plan month.',
                  public.cockpit_upsell_day(v_renew), public.cockpit_upsell_day(v_renew + 31))
      ELSE format('No renewal plan on file, so renewal counts as launch + 90 days: %s. Offers wait until %s. The website can ride in the renewal as the free care-plan month.',
                  public.cockpit_upsell_day(v_renew), public.cockpit_upsell_day(v_renew + 31)) END,
    CASE WHEN v_renew IS NULL THEN 'No renewal date yet.'
         WHEN v_settled THEN format('Renewal of %s is settled.', public.cockpit_upsell_day(v_renew))
         ELSE format('Renewal due %s, outside its 30 days.', public.cockpit_upsell_day(v_renew)) END,
    CASE v_renew_from WHEN 'plan' THEN 'Renewal plan' ELSE 'Launch date + 90 days' END,
    to_jsonb(v_renew));

  RETURN jsonb_build_object(
    'ok', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(checks) x WHERE x->'ok' = 'false'::jsonb),
    'taskId', p_task_id, 'checkedAt', to_jsonb(now()),
    'reasons', (SELECT coalesce(jsonb_agg(x - 'ok' ORDER BY i), '[]'::jsonb) FROM jsonb_array_elements(checks) WITH ORDINALITY z(x, i) WHERE x->'ok' = 'false'::jsonb),
    'passed', (SELECT coalesce(jsonb_agg(x - 'ok' ORDER BY i), '[]'::jsonb) FROM jsonb_array_elements(checks) WITH ORDINALITY z(x, i) WHERE x->'ok' = 'true'::jsonb),
    'win', coalesce(v_win, jsonb_build_object('kind', NULL, 'on', NULL, 'text', NULL)),
    'renewal', jsonb_build_object('date', v_renew, 'from', v_renew_from),
    'lastOffer', v_last_offer);
END $$;

-- A pitch in the read's shape.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_pitch_json(p public.cockpit_upsell_pitches) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', p.id, 'requestId', p.request_id, 'taskId', p.task_id, 'offerKey', p.offer_key, 'pitchedOn', to_jsonb(p.pitched_on),
    'csm', p.csm_email, 'mode', p.mode, 'clientWords', p.client_words, 'clientAskedOn', to_jsonb(p.client_asked_on),
    'gate', p.gate, 'listPrice', p.list_price, 'openingPrice', p.opening_price, 'openingReason', p.opening_reason,
    'heldFull', p.held_full, 'finalPrice', p.final_price, 'finalReason', p.final_reason, 'split', p.split,
    'answer', p.answer, 'followUpOn', to_jsonb(p.follow_up_on), 'noReason', p.no_reason, 'paymentLink', p.payment_link,
    'lang', p.lang, 'videoCode', p.video_code, 'revision', p.revision, 'createdAt', to_jsonb(p.created_at),
    'updatedAt', to_jsonb(p.updated_at), 'updatedBy', p.updated_by)
$$;

-- Full price was held for this offer: a pitch with held_full in the last 60
-- days, or a proposal sent at (or above) its list price in the last 60 days.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_held_full(p_task_id text, p_offer text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v boolean := false;
BEGIN
  IF EXISTS (SELECT 1 FROM public.cockpit_upsell_pitches p WHERE p.task_id = p_task_id AND p.offer_key = p_offer
               AND p.held_full AND p.pitched_on >= public.cockpit_upsell_today() - 60) THEN
    RETURN true;
  END IF;
  IF to_regclass('public.cockpit_upsell_proposals') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.cockpit_upsell_proposals x
               WHERE x.task_id = $1 AND x.offer_key = $2 AND x.sent_at >= now() - interval ''60 days''
                 AND NOT EXISTS (SELECT 1 FROM jsonb_each(coalesce(x.sent_list_price, ''{}''::jsonb)) l
                                  WHERE jsonb_typeof(l.value) = ''number''
                                    AND coalesce((x.sent_price->''parts''->>l.key)::numeric, 0) < (l.value #>> ''{}'')::numeric)
                 AND EXISTS (SELECT 1 FROM jsonb_each(coalesce(x.sent_list_price, ''{}''::jsonb)) l WHERE jsonb_typeof(l.value) = ''number''))'
      INTO v USING p_task_id, p_offer;
  END IF;
  RETURN coalesce(v, false);
END $$;

-- The video a pitch's client is sent: the offer's video in the pitch's
-- language (or for any language), through the offer page's door when it is
-- live (each open counted), else its own link (not counted). With no video
-- in that language there is no link at all, door or not: the door would
-- only answer unknown.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_video_link(p public.cockpit_upsell_pitches) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_url text;
BEGIN
  SELECT v.url INTO v_url FROM public.cockpit_csm_deck_videos v
   WHERE v.deck = 'offer_' || p.offer_key AND v.slot_key = 'demo' AND v.lang IN (p.lang, 'any') AND v.url IS NOT NULL
   ORDER BY (v.lang = p.lang) DESC LIMIT 1;
  IF v_url IS NULL THEN
    RETURN jsonb_build_object('url', NULL, 'counted', false,
      'note', format('No %s video saved for this offer yet. The CEO adds it on Money > Offers.',
                     CASE p.lang WHEN 'ar' THEN 'Arabic' ELSE 'English' END));
  END IF;
  IF (public.cockpit_upsell_settings_json()->>'doorLive')::boolean THEN
    RETURN jsonb_build_object('url', 'https://offer.maharamedia.com/v/' || p.video_code, 'counted', true);
  END IF;
  RETURN jsonb_build_object('url', v_url, 'counted', false, 'note', NULL);
END $$;

-- The gate's failing reasons for one offer's talk. A recent offer of this
-- same offer (its own pitch or its own proposal) is the same talk, not a
-- reason: the deck reopens and its proposal sends without a warning. This
-- departs from the contract's literal recent_offer (BACKEND.md 2.3).
CREATE OR REPLACE FUNCTION public.cockpit_upsell_gate_reasons(p_gate jsonb, p_offer text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(r ORDER BY i), '[]'::jsonb)
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_gate->'reasons') = 'array' THEN p_gate->'reasons' ELSE '[]'::jsonb END)
         WITH ORDINALITY z(r, i)
   WHERE NOT coalesce(r->>'key' = 'recent_offer' AND p_gate->'lastOffer'->>'offer' = p_offer, false)
$$;

-- What a deck needs beyond the decks' own sources: the gate and its mode,
-- the catalog row (null when refused), this offer deck's prep, the
-- captures, the site, the typical project, the onboarding goals, the
-- currency and its fixed rate, this offer's pitches and the door switch.
CREATE OR REPLACE FUNCTION public.cockpit_csm_offer_sources(p_task_id text, p_offer text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb; v_gate jsonb; v_cat public.cockpit_upsell_catalog; v_prep public.cockpit_csm_deck_prep; v_mode text; v_reasons jsonb;
  v_forms jsonb; v_submitted date; v_answers jsonb; v_goals jsonb; v_onb jsonb; v_sheet jsonb;
  v_country text; v_currency text; v_closes bigint; v_valued bigint; v_rev numeric;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  IF NOT public.cockpit_upsell_offer_ok(p_offer) THEN RAISE EXCEPTION 'Choose one of the seven offers.' USING ERRCODE = '22023'; END IF;
  v_gate := public.cockpit_csm_offer_gate(p_task_id);
  SELECT * INTO v_cat FROM public.cockpit_upsell_catalog c WHERE c.offer_key = p_offer;
  SELECT * INTO v_prep FROM public.cockpit_csm_deck_prep p WHERE p.task_id = p_task_id AND p.deck = 'offer_' || p_offer;
  v_reasons := public.cockpit_upsell_gate_reasons(v_gate, p_offer);
  v_mode := CASE WHEN jsonb_array_length(v_reasons) = 0 THEN 'proactive'
                 WHEN public.cockpit_upsell_asked_ok(v_prep.overrides->'client_asked') THEN 'client_asked'
                 ELSE 'refused' END;

  -- The onboarding answers the deck quotes, each with its date.
  SELECT o.forms->'onboarding' INTO v_forms FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_task_id;
  IF jsonb_typeof(v_forms) = 'object' AND jsonb_typeof(v_forms->'answers') = 'array' THEN
    BEGIN
      v_submitted := left(v_forms->>'submitted_at', 10)::date;
    EXCEPTION WHEN OTHERS THEN v_submitted := NULL;
    END;
    SELECT coalesce(jsonb_object_agg(a->>'ref', left(btrim(a->>'value'), 600)) FILTER (WHERE btrim(coalesce(a->>'value', '')) <> ''), '{}'::jsonb)
      INTO v_answers FROM jsonb_array_elements(v_forms->'answers') a WHERE jsonb_typeof(a) = 'object';
    v_goals := jsonb_build_object(
      'goal90', CASE WHEN v_answers ? '791b99b8-c7e9-40a4-96d6-868399e1ae97' THEN jsonb_build_object('answer', v_answers->'791b99b8-c7e9-40a4-96d6-868399e1ae97', 'answeredOn', v_submitted) END,
      'goal12_24', CASE WHEN v_answers ? 'f4b96a9b-bd7c-4398-98b4-6a28a7d3595a' THEN jsonb_build_object('answer', v_answers->'f4b96a9b-bd7c-4398-98b4-6a28a7d3595a', 'answeredOn', v_submitted) END,
      'challenges', CASE WHEN v_answers ? 'fcf43e6a-cc84-4ae7-9cef-2336069d0280' THEN jsonb_build_object('answer', v_answers->'fcf43e6a-cc84-4ae7-9cef-2336069d0280', 'answeredOn', v_submitted) END,
      'why', CASE WHEN v_answers ? '7426c6c5-344f-44c9-9999-3b9daf3a06b8' THEN jsonb_build_object('answer', v_answers->'7426c6c5-344f-44c9-9999-3b9daf3a06b8', 'answeredOn', v_submitted) END);
    -- "Which services have the highest price point": where the typical project comes from.
    IF v_answers ? 'd976036f-6c2e-4d5d-999a-64cf9bb2ef02' THEN
      v_onb := jsonb_build_object('answer', v_answers->'d976036f-6c2e-4d5d-999a-64cf9bb2ef02', 'answeredOn', v_submitted);
    END IF;
  END IF;

  -- Signed projects with a value on their sheet in the last 180 days.
  SELECT sum(d.closes), sum(d.closes_with_value), sum(d.revenue_usd) INTO v_closes, v_valued, v_rev
    FROM public.cockpit_client_days d
   WHERE d.location_id IN (SELECT x.location_id FROM public.ghl_clients x WHERE x.clickup_id = p_task_id)
     AND d.day >= public.cockpit_upsell_today() - 180;
  IF coalesce(v_valued, 0) > 0 AND coalesce(v_rev, 0) > 0 THEN
    v_sheet := jsonb_build_object('usd', round(v_rev / v_valued), 'closes', v_closes, 'withValue', v_valued,
                                  'from', 'cockpit_client_days', 'window', '180 days');
  END IF;

  SELECT CASE upper(nullif(btrim(x.country), '')) WHEN 'QT' THEN 'QA' ELSE upper(nullif(btrim(x.country), '')) END
    INTO v_country FROM public.ghl_clients x WHERE x.clickup_id = p_task_id ORDER BY x.location_id LIMIT 1;
  v_currency := CASE v_country WHEN 'KW' THEN 'KWD' WHEN 'SA' THEN 'SAR' WHEN 'AE' THEN 'AED' WHEN 'QA' THEN 'QAR'
                               WHEN 'BH' THEN 'BHD' WHEN 'OM' THEN 'OMR' ELSE 'USD' END;

  RETURN jsonb_build_object(
    'mode', v_mode, 'gate', v_gate,
    'catalog', CASE WHEN v_mode = 'refused' THEN NULL ELSE public.cockpit_upsell_catalog_json(v_cat) END,
    'prep', CASE WHEN v_prep.task_id IS NULL THEN NULL ELSE jsonb_build_object('overrides', v_prep.overrides, 'revision', v_prep.revision,
                   'updatedAt', to_jsonb(v_prep.updated_at), 'updatedBy', v_prep.updated_by) END,
    'priceProblem', public.cockpit_upsell_price_problem(p_offer, v_prep.overrides),
    'files', public.cockpit_upsell_files_rows(p_task_id),
    'site', public.cockpit_client_site_verdict(p_task_id),
    'project', jsonb_build_object('onboarding', v_onb, 'sheet', v_sheet),
    'goals', coalesce(v_goals, jsonb_build_object('goal90', NULL, 'goal12_24', NULL, 'challenges', NULL, 'why', NULL)),
    'country', v_country, 'currency', v_currency,
    'fx', jsonb_build_object('usdPer', public.cockpit_pay_usd_per(v_currency), 'from', 'cockpit_pay_usd_per',
                             'note', CASE WHEN public.cockpit_pay_usd_per(v_currency) IS NULL
                                          THEN format('No fixed rate for %s: the figure stays in US dollars.', v_currency) END),
    'pitches', (SELECT coalesce(jsonb_agg(public.cockpit_upsell_pitch_json(p) ORDER BY p.pitched_on DESC, p.created_at DESC), '[]'::jsonb)
                  FROM (SELECT * FROM public.cockpit_upsell_pitches p WHERE p.task_id = p_task_id AND p.offer_key = p_offer
                        ORDER BY p.pitched_on DESC, p.created_at DESC LIMIT 10) p),
    'heldFullRecently', public.cockpit_upsell_held_full(p_task_id, p_offer),
    'doorLive', (public.cockpit_upsell_settings_json()->>'doorLive')::boolean,
    'at', to_jsonb(now()));
END $$;

-- For the picker and the Hot list row: the gate, this month's offer and why,
-- and for every offer its fit, what is missing before it is ready, what it
-- waits on and its last pitch.
CREATE OR REPLACE FUNCTION public.cockpit_csm_offer_status(p_task_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb; v_gate jsonb; v_site jsonb; v_fit jsonb; v_missing text[]; v_newest date; v_prep jsonb; v_offers jsonb := '[]'::jsonb;
  c public.cockpit_upsell_catalog; v_this text; v_this_why text; v_last jsonb; v_verdict text;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  v_gate := public.cockpit_csm_offer_gate(p_task_id);
  v_site := public.cockpit_client_site_verdict(p_task_id);
  v_verdict := v_site->>'verdict';
  SELECT max(f.captured_on) INTO v_newest FROM public.cockpit_upsell_files f
   WHERE f.task_id = p_task_id AND f.status = 'ready' AND f.kind = 'capture';
  FOR c IN SELECT * FROM public.cockpit_upsell_catalog x ORDER BY x.sort LOOP
    v_prep := public.cockpit_upsell_prep_of(p_task_id, c.offer_key);
    IF c.offer_key = 'website' THEN
      v_fit := CASE
        WHEN v_verdict = 'broken' THEN jsonb_build_object('ok', true, 'why', rtrim(split_part(v_site->>'note', '.', 1), '.'))
        WHEN v_verdict = 'none_on_file' THEN jsonb_build_object('ok', true, 'why', 'No website on file')
        WHEN v_prep->'site_thin' = 'true'::jsonb THEN jsonb_build_object('ok', true, 'why', 'Their site is thin, ticked in prep')
        WHEN v_verdict = 'not_checked' THEN jsonb_build_object('ok', NULL, 'why', 'Site not checked yet')
        WHEN v_verdict = 'failing' THEN jsonb_build_object('ok', NULL, 'why', rtrim(split_part(v_site->>'note', '.', 1), '.'))
        ELSE jsonb_build_object('ok', false, 'why', 'Their site works') END;
    ELSE
      v_fit := jsonb_build_object('ok', NULL, 'why', coalesce(c.waits_on, 'No fit check for this offer yet.'));
    END IF;
    v_missing := '{}';
    IF v_newest IS NULL THEN v_missing := v_missing || 'no_capture'::text;
    ELSIF v_newest < public.cockpit_upsell_today() - 7 THEN v_missing := v_missing || 'capture_old'::text; END IF;
    IF (c.locked AND EXISTS (SELECT 1 FROM jsonb_array_elements(c.parts) x WHERE jsonb_typeof(x->'amount') = 'null'))
       OR (NOT (v_prep ? 'opening_price') AND EXISTS (SELECT 1 FROM jsonb_array_elements(c.parts) x WHERE jsonb_typeof(x->'amount') = 'null'))
       -- A stored opening price the list has since moved past (below a new
       -- list with no reason, off a new lock).
       OR public.cockpit_upsell_price_problem(c.offer_key, v_prep) IS NOT NULL THEN
      v_missing := v_missing || 'no_price'::text;
    END IF;
    IF NOT (v_prep ? 'payment_link') THEN v_missing := v_missing || 'no_payment_link'::text; END IF;
    SELECT jsonb_build_object('on', p.pitched_on, 'answer', p.answer, 'mode', p.mode) INTO v_last
      FROM public.cockpit_upsell_pitches p WHERE p.task_id = p_task_id AND p.offer_key = c.offer_key
     ORDER BY p.pitched_on DESC, p.created_at DESC LIMIT 1;
    v_offers := v_offers || jsonb_build_array(jsonb_build_object(
      'key', c.offer_key, 'fit', v_fit,
      'ready', jsonb_build_object('ok', cardinality(v_missing) = 0, 'missing', to_jsonb(v_missing)),
      'waitsOn', c.waits_on, 'lastPitch', v_last));
    IF v_this IS NULL AND (v_gate->>'ok')::boolean AND v_fit->'ok' = 'true'::jsonb AND c.waits_on IS NULL THEN
      v_this := c.offer_key; v_this_why := v_fit->>'why';
    END IF;
    v_last := NULL;
  END LOOP;
  IF v_this IS NULL THEN
    v_this_why := CASE WHEN NOT (v_gate->>'ok')::boolean THEN 'Not this month: ' || (v_gate->'reasons'->0->>'text')
                       ELSE 'No offer fits yet: ' || lower(left(v_offers->0->'fit'->>'why', 1)) || substr(v_offers->0->'fit'->>'why', 2) || '.' END;
  END IF;
  RETURN jsonb_build_object(
    'gate', jsonb_build_object('ok', v_gate->'ok', 'reasons', v_gate->'reasons'),
    'thisMonth', v_this, 'thisMonthWhy', v_this_why, 'offers', v_offers, 'at', to_jsonb(now()));
END $$;

-- ---------------------------------------------------------------------------
-- 6. Pitches
-- ---------------------------------------------------------------------------

-- "1,800 + 150" for the parts of a price, in the catalog's part order.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_price_text(p_parts jsonb, p_price jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT string_agg(public.cockpit_upsell_money((p_price->>(x->>'key'))::numeric), ' + ' ORDER BY i)
    FROM jsonb_array_elements(p_parts) WITH ORDINALITY y(x, i)
$$;

-- One pitch: the first save (by its request id) creates the row and stamps it
-- from the gate and the offer's prep; later saves carry the revision last
-- seen and change the answer and the price steps. It never refuses for the
-- gate: the gate's result is stored with the pitch.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_pitch_save(p_task_id text, p_offer text, p_request_id uuid, p_patch jsonb, p_base_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb; cur public.cockpit_upsell_pitches; nxt public.cockpit_upsell_pitches; c public.cockpit_upsell_catalog;
  v_gate jsonb; v_prep jsonb; k text; v jsonb; e jsonb; ks text[]; v_want text[]; v_lines text[] := '{}'; v_name text;
  v_list jsonb; v_creating boolean := false; i integer; v_reasons jsonb;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  IF NOT public.cockpit_upsell_offer_ok(p_offer) THEN RAISE EXCEPTION 'Choose one of the seven offers.' USING ERRCODE = '22023'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'A pitch request id is required.' USING ERRCODE = '22023'; END IF;
  IF p_patch IS NULL THEN p_patch := '{}'::jsonb; END IF;
  IF jsonb_typeof(p_patch) <> 'object' THEN RAISE EXCEPTION 'Send the changes as named values.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO c FROM public.cockpit_upsell_catalog x WHERE x.offer_key = p_offer;
  v_name := public.cockpit_upsell_offer_name(p_offer);
  v_list := public.cockpit_upsell_list_of(c.parts);
  v_want := ARRAY(SELECT x->>'key' FROM jsonb_array_elements(c.parts) x);

  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_upsell_pitches:' || p_request_id::text, 0));
  SELECT * INTO cur FROM public.cockpit_upsell_pitches x WHERE x.request_id = p_request_id FOR UPDATE;
  IF cur.id IS NOT NULL THEN
    IF cur.task_id <> p_task_id OR cur.offer_key <> p_offer THEN
      RAISE EXCEPTION 'This request id belongs to another pitch.' USING ERRCODE = '42501';
    END IF;
    IF p_base_revision IS NULL OR p_base_revision <> cur.revision THEN
      RAISE EXCEPTION 'Someone else saved this. Read it again.' USING ERRCODE = '40001';
    END IF;
    nxt := cur;
  ELSE
    IF coalesce(p_base_revision, 0) <> 0 THEN
      RAISE EXCEPTION 'Someone else saved this. Read it again.' USING ERRCODE = '40001';
    END IF;
    v_creating := true;
    v_gate := public.cockpit_csm_offer_gate(p_task_id);
    v_prep := public.cockpit_upsell_prep_of(p_task_id, p_offer);
    nxt.id := gen_random_uuid();
    nxt.request_id := p_request_id;
    nxt.task_id := p_task_id;
    nxt.offer_key := p_offer;
    nxt.pitched_on := public.cockpit_upsell_today();
    nxt.csm_email := g->>'email';
    -- The same reasons the deck's mode is worked out from (stored raw in gate).
    v_reasons := public.cockpit_upsell_gate_reasons(v_gate, p_offer);
    IF jsonb_array_length(v_reasons) > 0 AND public.cockpit_upsell_asked_ok(v_prep->'client_asked') THEN
      nxt.mode := 'client_asked';
      nxt.client_words := btrim(v_prep->'client_asked'->>'words');
      nxt.client_asked_on := (v_prep->'client_asked'->>'on')::date;
    ELSE
      nxt.mode := 'proactive';
    END IF;
    nxt.gate := jsonb_build_object('ok', v_gate->'ok', 'checkedAt', v_gate->'checkedAt',
      'reasons', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', r->'key', 'text', r->'text')), '[]'::jsonb) FROM jsonb_array_elements(v_gate->'reasons') r),
      'win', v_gate->'win');
    nxt.list_price := v_list;
    nxt.opening_price := coalesce(v_prep->'opening_price',
      CASE WHEN NOT EXISTS (SELECT 1 FROM jsonb_each(v_list) l WHERE jsonb_typeof(l.value) = 'null') THEN v_list END);
    nxt.opening_reason := v_prep->>'opening_reason';
    nxt.payment_link := v_prep->>'payment_link';
    nxt.lang := coalesce(v_prep->>'language', 'en');
    nxt.held_full := false;
    nxt.split := false;
    nxt.revision := 1;
    FOR i IN 1..5 LOOP
      nxt.video_code := public.cockpit_upsell_code(10);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.cockpit_upsell_pitches x WHERE x.video_code = nxt.video_code);
    END LOOP;
  END IF;

  FOR k, v IN SELECT key, value FROM jsonb_each(p_patch) LOOP
    CASE k
    WHEN 'held_full' THEN
      IF jsonb_typeof(v) <> 'boolean' THEN RAISE EXCEPTION 'held_full is a yes or no.' USING ERRCODE = '22023'; END IF;
      nxt.held_full := (v #>> '{}')::boolean;
    WHEN 'split' THEN
      IF jsonb_typeof(v) <> 'boolean' THEN RAISE EXCEPTION 'split is a yes or no.' USING ERRCODE = '22023'; END IF;
      nxt.split := (v #>> '{}')::boolean;
    WHEN 'final_price' THEN
      IF jsonb_typeof(v) = 'null' THEN nxt.final_price := NULL;
      ELSE
        IF jsonb_typeof(v) <> 'object' THEN RAISE EXCEPTION 'The final price names each part and its dollars.' USING ERRCODE = '22023'; END IF;
        ks := ARRAY(SELECT jsonb_object_keys(v));
        IF NOT (ks @> v_want AND ks <@ v_want) THEN
          RAISE EXCEPTION 'Type the final price for %.', public.cockpit_upsell_parts_named(p_offer, c.parts) USING ERRCODE = '22023';
        END IF;
        FOR e IN SELECT value FROM jsonb_each(v) LOOP
          IF NOT public.cockpit_upsell_usd_ok(e) THEN
            RAISE EXCEPTION 'A price is a dollar amount from 1 to 1,000,000, with at most two decimals.' USING ERRCODE = '22023';
          END IF;
        END LOOP;
        nxt.final_price := v;
      END IF;
    WHEN 'final_reason' THEN nxt.final_reason := public.cockpit_upsell_text(v, 140, 'The reason');
    WHEN 'answer' THEN nxt.answer := public.cockpit_upsell_choice(v, ARRAY['yes_paid','yes_unpaid','not_now','no'], 'The answer') #>> '{}';
    WHEN 'follow_up_on' THEN nxt.follow_up_on := public.cockpit_upsell_date(v, 'The follow-up date');
    WHEN 'no_reason' THEN nxt.no_reason := public.cockpit_upsell_text(v, 200, 'Why they said no');
    ELSE RAISE EXCEPTION 'A pitch does not keep "%".', k USING ERRCODE = '22023';
    END CASE;
  END LOOP;

  -- The rules, on the whole row.
  IF nxt.final_price IS NOT NULL THEN
    IF c.locked AND (EXISTS (SELECT 1 FROM jsonb_each(v_list) l WHERE jsonb_typeof(l.value) = 'null')
                     OR EXISTS (SELECT 1 FROM jsonb_each(v_list) l WHERE (nxt.final_price->>l.key)::numeric IS DISTINCT FROM (l.value #>> '{}')::numeric)) THEN
      RAISE EXCEPTION 'This price is locked at the list price.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_each(coalesce(nxt.opening_price, '{}'::jsonb)) o
                WHERE (nxt.final_price->>o.key)::numeric < (o.value #>> '{}')::numeric) THEN
      IF NOT nxt.held_full THEN
        RAISE EXCEPTION 'Tap "Held full price" before saying a lower price.' USING ERRCODE = '22023';
      END IF;
      IF nxt.final_reason IS NULL THEN
        RAISE EXCEPTION 'A price below the opening price needs a one-line reason.' USING ERRCODE = '22023';
      END IF;
    END IF;
  END IF;
  IF nxt.split THEN
    IF NOT c.split_allowed THEN RAISE EXCEPTION 'This offer has no split.' USING ERRCODE = '22023'; END IF;
    IF NOT nxt.held_full THEN RAISE EXCEPTION 'The split comes only after "Held full price".' USING ERRCODE = '22023'; END IF;
  END IF;
  IF nxt.answer = 'not_now' AND (nxt.follow_up_on IS NULL OR nxt.follow_up_on < public.cockpit_upsell_today()
                                 OR nxt.follow_up_on > public.cockpit_upsell_today() + 120) THEN
    RAISE EXCEPTION 'Pick a follow-up date in the next 120 days.' USING ERRCODE = '22023';
  END IF;
  IF nxt.answer = 'no' AND nxt.no_reason IS NULL THEN
    RAISE EXCEPTION 'Say why they said no, in a line.' USING ERRCODE = '22023';
  END IF;

  IF NOT v_creating AND nxt IS NOT DISTINCT FROM cur THEN
    RETURN public.cockpit_upsell_pitch_json(cur) || jsonb_build_object('videoUrl', public.cockpit_upsell_video_link(cur)->'url', 'changed', false);
  END IF;

  -- The CEO card's sentence.
  IF v_creating THEN
    v_lines := v_lines || format('%s offered to %s%s', v_name, g->>'clientName',
      CASE WHEN nxt.mode = 'client_asked' THEN ' (they asked)' WHEN jsonb_array_length(v_reasons) > 0 THEN ' (gate not passed)' ELSE '' END);
    IF nxt.opening_price IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_each(v_list) l WHERE jsonb_typeof(l.value) = 'number'
                                                   AND (nxt.opening_price->>l.key)::numeric < (l.value #>> '{}')::numeric) THEN
      v_lines := v_lines || format('Opening price %s below list %s: %s', public.cockpit_upsell_price_text(c.parts, nxt.opening_price),
                                   public.cockpit_upsell_price_text(c.parts, v_list), coalesce(nxt.opening_reason, 'no reason'));
    END IF;
  END IF;
  IF nxt.held_full AND (cur.id IS NULL OR NOT cur.held_full) THEN v_lines := v_lines || 'Held full price'::text; END IF;
  IF nxt.final_price IS DISTINCT FROM cur.final_price AND nxt.final_price IS NOT NULL THEN
    v_lines := v_lines || CASE WHEN EXISTS (SELECT 1 FROM jsonb_each(coalesce(nxt.opening_price, '{}'::jsonb)) o
                                             WHERE (nxt.final_price->>o.key)::numeric < (o.value #>> '{}')::numeric)
      THEN format('Final price %s below opening %s: %s', public.cockpit_upsell_price_text(c.parts, nxt.final_price),
                  public.cockpit_upsell_price_text(c.parts, nxt.opening_price), nxt.final_reason)
      ELSE format('Final price %s', public.cockpit_upsell_price_text(c.parts, nxt.final_price)) END;
  END IF;
  IF nxt.split AND (cur.id IS NULL OR NOT cur.split) THEN v_lines := v_lines || 'Split in two payments'::text; END IF;
  IF nxt.answer IS DISTINCT FROM cur.answer AND nxt.answer IS NOT NULL THEN
    v_lines := v_lines || CASE nxt.answer
      WHEN 'yes_paid' THEN 'Answer: yes, paid'
      WHEN 'yes_unpaid' THEN 'Answer: yes, not paid yet'
      WHEN 'not_now' THEN format('Answer: not now, follow up %s', public.cockpit_upsell_day(nxt.follow_up_on))
      ELSE format('Answer: no, %s', nxt.no_reason) END;
  END IF;
  PERFORM set_config('cockpit.upsell_action', CASE WHEN v_creating THEN 'upsellPitch.create' ELSE 'upsellPitch.save' END, true);
  PERFORM set_config('cockpit.upsell_line', coalesce(nullif(array_to_string(v_lines, '; '), ''), v_name || ' pitch updated'), true);
  IF v_creating THEN
    INSERT INTO public.cockpit_upsell_pitches (id, request_id, task_id, offer_key, pitched_on, csm_email, mode, client_words, client_asked_on,
        gate, list_price, opening_price, opening_reason, held_full, final_price, final_reason, split, answer, follow_up_on, no_reason,
        payment_link, lang, video_code, revision, updated_by)
    VALUES (nxt.id, nxt.request_id, nxt.task_id, nxt.offer_key, nxt.pitched_on, nxt.csm_email, nxt.mode, nxt.client_words, nxt.client_asked_on,
        nxt.gate, nxt.list_price, nxt.opening_price, nxt.opening_reason, nxt.held_full, nxt.final_price, nxt.final_reason, nxt.split,
        nxt.answer, nxt.follow_up_on, nxt.no_reason, nxt.payment_link, nxt.lang, nxt.video_code, 1, g->>'email')
    RETURNING * INTO nxt;
  ELSE
    UPDATE public.cockpit_upsell_pitches x
       SET held_full = nxt.held_full, final_price = nxt.final_price, final_reason = nxt.final_reason, split = nxt.split,
           answer = nxt.answer, follow_up_on = nxt.follow_up_on, no_reason = nxt.no_reason,
           revision = x.revision + 1, updated_at = now(), updated_by = g->>'email'
     WHERE x.id = cur.id RETURNING * INTO nxt;
  END IF;
  RETURN public.cockpit_upsell_pitch_json(nxt) || jsonb_build_object('videoUrl', public.cockpit_upsell_video_link(nxt)->'url', 'changed', true);
END $$;

-- This client's pitches, newest first.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_pitches_read(p_task_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_csm_client_gate(p_task_id);
  RETURN jsonb_build_object('rows', (SELECT coalesce(jsonb_agg(public.cockpit_upsell_pitch_json(p) ORDER BY p.pitched_on DESC, p.created_at DESC), '[]'::jsonb)
                                       FROM public.cockpit_upsell_pitches p WHERE p.task_id = p_task_id));
END $$;

-- One month's pitches: every client for the CEO, a CSM's own clients for a CSM.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_pitch_log(p_month date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_month date;
BEGIN
  PERFORM public.cockpit_csm_actor();
  v_month := date_trunc('month', coalesce(p_month, public.cockpit_upsell_today()))::date;
  RETURN jsonb_build_object('month', to_char(v_month, 'YYYY-MM'), 'rows', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', p.id, 'taskId', p.task_id, 'clientName', n.name, 'offerKey', p.offer_key, 'pitchedOn', to_jsonb(p.pitched_on),
             'csm', p.csm_email, 'mode', p.mode, 'listPrice', p.list_price, 'openingPrice', p.opening_price,
             'openingReason', p.opening_reason, 'finalPrice', p.final_price, 'finalReason', p.final_reason,
             'answer', p.answer, 'followUpOn', to_jsonb(p.follow_up_on)) ORDER BY p.pitched_on DESC, p.created_at DESC), '[]'::jsonb)
      FROM public.cockpit_upsell_pitches p
      LEFT JOIN LATERAL (SELECT s.data->>'name' AS name FROM public.cockpit_csm_sources s
                          WHERE s.table_name = 'clients' AND s.data->>'taskId' = p.task_id LIMIT 1) n ON true
     WHERE p.pitched_on >= v_month AND p.pitched_on < (v_month + interval '1 month')::date
       AND (coalesce(public.cockpit_is_ceo(), false) OR public.cockpit_client_allowed(n.name))));
END $$;

-- The link to send with the WhatsApp recap: {url, counted}.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_pitch_video(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.cockpit_upsell_pitches;
BEGIN
  PERFORM public.cockpit_csm_actor();
  SELECT * INTO p FROM public.cockpit_upsell_pitches x WHERE x.id = p_id;
  IF p.id IS NULL THEN RAISE EXCEPTION 'That pitch is not one you can open.' USING ERRCODE = '42501'; END IF;
  PERFORM public.cockpit_csm_client_gate(p.task_id);
  RETURN public.cockpit_upsell_video_link(p);
END $$;

-- ---------------------------------------------------------------------------
-- Grants, restated
-- ---------------------------------------------------------------------------

-- Replaced: the browser four keep theirs; the slot list and its check stay with nobody.
REVOKE ALL ON FUNCTION
  public.cockpit_csm_deck_prep_save(text, text, jsonb),
  public.cockpit_csm_deck_videos_read(text),
  public.cockpit_csm_deck_video_save(text, text, text, text, text, integer, integer),
  public.cockpit_csm_deck_video_clear(text, text, text, integer)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION
  public.cockpit_csm_deck_prep_save(text, text, jsonb),
  public.cockpit_csm_deck_videos_read(text),
  public.cockpit_csm_deck_video_save(text, text, text, text, text, integer, integer),
  public.cockpit_csm_deck_video_clear(text, text, text, integer)
TO authenticated;
REVOKE ALL ON FUNCTION public.cockpit_csm_deck_video_slots(), public.cockpit_csm_deck_video_slot_ok(text, text)
FROM PUBLIC, anon, authenticated, service_role;

-- Internal helpers: nobody.
REVOKE ALL ON FUNCTION
  public.cockpit_upsell_offer_ok(text),
  public.cockpit_upsell_text(jsonb, integer, text, integer),
  public.cockpit_upsell_date(jsonb, text),
  public.cockpit_upsell_choice(jsonb, text[], text),
  public.cockpit_upsell_day(date),
  public.cockpit_upsell_parts_named(text, jsonb),
  public.cockpit_upsell_copy_refuse(text, text),
  public.cockpit_upsell_two_days(date, date),
  public.cockpit_upsell_code(integer),
  public.cockpit_csm_offer_client(text),
  public.cockpit_upsell_prep_of(text, text),
  public.cockpit_upsell_asked_ok(jsonb),
  public.cockpit_upsell_file_json(public.cockpit_upsell_files),
  public.cockpit_upsell_files_rows(text),
  public.cockpit_csm_offer_prep_value(text, text, text, jsonb),
  public.cockpit_csm_offer_price_check(text, jsonb),
  public.cockpit_upsell_price_problem(text, jsonb),
  public.cockpit_client_site_verdict(text),
  public.cockpit_upsell_url_key(text),
  public.cockpit_csm_offer_check(text, boolean, text, text, text, jsonb),
  public.cockpit_upsell_pitch_json(public.cockpit_upsell_pitches),
  public.cockpit_upsell_held_full(text, text),
  public.cockpit_upsell_video_link(public.cockpit_upsell_pitches),
  public.cockpit_upsell_gate_reasons(jsonb, text),
  public.cockpit_upsell_price_text(jsonb, jsonb)
FROM PUBLIC, anon, authenticated, service_role;

-- The browser functions: signed-in seats (each runs the client gate or the
-- client success seat gate first).
REVOKE ALL ON FUNCTION
  public.cockpit_upsell_object_allowed(text),
  public.cockpit_upsell_file_reserve(uuid, text, text, text, bigint, integer, integer, text, date, text),
  public.cockpit_upsell_file_accept(text, uuid),
  public.cockpit_upsell_file_update(text, uuid, jsonb),
  public.cockpit_upsell_file_remove(text, uuid),
  public.cockpit_upsell_files_read(text),
  public.cockpit_upsell_files_stale(text),
  public.cockpit_upsell_win_mark(text, text, date),
  public.cockpit_client_site_check_record(text, text, text, jsonb),
  public.cockpit_csm_offer_gate(text),
  public.cockpit_csm_offer_sources(text, text),
  public.cockpit_csm_offer_status(text),
  public.cockpit_upsell_pitch_save(text, text, uuid, jsonb, integer),
  public.cockpit_upsell_pitches_read(text),
  public.cockpit_upsell_pitch_log(date),
  public.cockpit_upsell_pitch_video(uuid)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION
  public.cockpit_upsell_object_allowed(text),
  public.cockpit_upsell_file_reserve(uuid, text, text, text, bigint, integer, integer, text, date, text),
  public.cockpit_upsell_file_accept(text, uuid),
  public.cockpit_upsell_file_update(text, uuid, jsonb),
  public.cockpit_upsell_file_remove(text, uuid),
  public.cockpit_upsell_files_read(text),
  public.cockpit_upsell_files_stale(text),
  public.cockpit_upsell_win_mark(text, text, date),
  public.cockpit_client_site_check_record(text, text, text, jsonb),
  public.cockpit_csm_offer_gate(text),
  public.cockpit_csm_offer_sources(text, text),
  public.cockpit_csm_offer_status(text),
  public.cockpit_upsell_pitch_save(text, text, uuid, jsonb, integer),
  public.cockpit_upsell_pitches_read(text),
  public.cockpit_upsell_pitch_log(date),
  public.cockpit_upsell_pitch_video(uuid)
TO authenticated;

-- The service key only: the Edge Function records deleted bytes.
REVOKE ALL ON FUNCTION public.cockpit_upsell_file_purged(text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_upsell_file_purged(text, uuid[]) TO service_role;

COMMIT;
