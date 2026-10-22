-- CSM decks: their ads from a Drive link (docs/csm-decks/DRIVE-IMPORT.md 2 to
-- 6). Apply after 20261020120000_csm_deck_videos.sql.
--
-- The CEO, 2026-10-20: "for their ads allow just a drive link to work and it
-- can work with folder or just the video." The client success manager pastes
-- a Drive link (or several) in prep or in the notes window; each becomes one
-- import here, and the VPS worker (hermes/editor-desk `deck-import`) brings
-- the pictures and videos behind it into the launch deck's ads tray, exactly
-- as an upload by hand would land.
--
-- 1. cockpit_csm_launch_ads_imports: one row per link per client, written
--    only by the functions below (row security on, no policies, no grants,
--    the service key included). cockpit_csm_drive_import_worker: one row,
--    when the importer last showed it was alive (a heartbeat, never audited).
-- 2. cockpit_csm_launch_ads gains its source: a Drive file is in a client's
--    tray at most once (a partial unique index), so pasting a folder again
--    brings in only what is new.
-- 3. Two functions serve the browser (request, read), gated on the client
--    success seat for that client. Seven serve the worker (claim, heartbeat,
--    plan, file reserve, file landed, file failed, finish), for service_role
--    only. Every way an import ends goes through one internal function.
-- 4. Every write leaves one cockpit_audit_log row through the decks' trigger,
--    with the worker named as the actor; a heartbeat leaves none.
--
-- Every function is SECURITY DEFINER with search_path '' except the two
-- IMMUTABLE helpers (the link parser and the sentences), which read no table.
-- The worker's functions take the import FOR UPDATE first, so two calls on
-- one import never interleave. Every set_config is transaction-local. The
-- file applies twice without error.
BEGIN;

-- ---------------------------------------------------------------------------
-- The helpers: the link parser and every sentence (no grant to any role)
-- ---------------------------------------------------------------------------

-- One Drive link, by DRIVE-IMPORT.md 2's rules in their order. The browser
-- runs the same rules (src/present/driveLink.ts); both are tested against
-- one table of cases (driveLink.cases.json). The link is rebuilt from the id
-- and its resource key alone, so usp, authuser (an email) and the rest are
-- never stored.
CREATE OR REPLACE FUNCTION public.cockpit_csm_drive_link_parse(p_link text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  s text; rest text; m text[]; authority text; host text; after text; nofrag text;
  path text; query text; v_rk text; v_id text; v_kind text; v_q int;
  c_id constant text := '[A-Za-z0-9_-]{10,200}';
BEGIN
  s := btrim(coalesce(p_link, ''), E' \t\n\r\f\v');
  IF s = '' THEN RETURN jsonb_build_object('ok', false, 'code', 'link_empty'); END IF;
  IF char_length(s) > 2000 OR s !~ '^[ -~]+$' THEN RETURN jsonb_build_object('ok', false, 'code', 'link_bad'); END IF;
  m := regexp_match(s, '^([A-Za-z][A-Za-z0-9+.-]*):');
  IF m IS NOT NULL THEN
    IF lower(m[1]) NOT IN ('http','https') THEN RETURN jsonb_build_object('ok', false, 'code', 'link_bad'); END IF;
    rest := substr(s, char_length(m[1]) + 2);
    IF left(rest, 2) <> '//' THEN RETURN jsonb_build_object('ok', false, 'code', 'link_bad'); END IF;
    rest := substr(rest, 3);
  ELSE
    rest := s;
  END IF;
  authority := substring(rest from '^[^/?#]*');
  after := substr(rest, char_length(authority) + 1);
  -- A user, a password or a port.
  IF authority ~ '[@:]' THEN RETURN jsonb_build_object('ok', false, 'code', 'link_bad'); END IF;
  host := lower(authority);
  nofrag := split_part(after, '#', 1);
  v_q := position('?' in nofrag);
  path := CASE WHEN v_q > 0 THEN left(nofrag, v_q - 1) ELSE nofrag END;
  query := CASE WHEN v_q > 0 THEN substr(nofrag, v_q + 1) ELSE '' END;
  SELECT substr(x.p, char_length('resourcekey') + 2) INTO v_rk
    FROM unnest(string_to_array(query, '&')) WITH ORDINALITY x(p, o)
   WHERE x.p LIKE 'resourcekey=%' ORDER BY x.o LIMIT 1;
  IF v_rk IS NOT NULL AND v_rk !~ '^[A-Za-z0-9_-]{1,100}$' THEN v_rk := NULL; END IF;

  IF host = 'docs.google.com' THEN
    RETURN jsonb_build_object('ok', false, 'code',
      CASE WHEN path ~ '^/(document|spreadsheets|presentation|forms|drawings)/' THEN 'link_docs' ELSE 'link_bad' END);
  ELSIF host IN ('drive.google.com', 'www.drive.google.com') THEN
    m := regexp_match(path, '^/drive(?:/u/[0-9])?(?:/mobile)?/folders/(' || c_id || ')/?$');
    IF m IS NOT NULL THEN v_id := m[1]; v_kind := 'folder';
    ELSE
      m := regexp_match(path, '^/file(?:/u/[0-9])?/d/(' || c_id || ')(?:/view|/edit|/preview|/)?$');
      IF m IS NOT NULL THEN v_id := m[1]; v_kind := 'file';
      ELSIF path IN ('/folderview', '/open', '/uc') THEN
        SELECT substr(x.p, 4) INTO v_id
          FROM unnest(string_to_array(query, '&')) WITH ORDINALITY x(p, o)
         WHERE x.p LIKE 'id=%' ORDER BY x.o LIMIT 1;
        IF v_id IS NULL OR v_id !~ ('^' || c_id || '$') THEN RETURN jsonb_build_object('ok', false, 'code', 'link_bad'); END IF;
        v_kind := CASE path WHEN '/folderview' THEN 'folder' WHEN '/open' THEN 'either' ELSE 'file' END;
      ELSIF path ~ '^/drive(?:/u/[0-9])?(?:/(?:my-drive|shared-with-me|recent|starred|home|computers|search)?)?/?$' THEN
        RETURN jsonb_build_object('ok', false, 'code', 'link_page');
      ELSE
        RETURN jsonb_build_object('ok', false, 'code', 'link_bad');
      END IF;
    END IF;
  ELSIF host = 'drive.usercontent.google.com' AND path = '/download' THEN
    SELECT substr(x.p, 4) INTO v_id
      FROM unnest(string_to_array(query, '&')) WITH ORDINALITY x(p, o)
     WHERE x.p LIKE 'id=%' ORDER BY x.o LIMIT 1;
    IF v_id IS NULL OR v_id !~ ('^' || c_id || '$') THEN RETURN jsonb_build_object('ok', false, 'code', 'link_bad'); END IF;
    v_kind := 'file';
  ELSE
    RETURN jsonb_build_object('ok', false, 'code', 'link_bad');
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'kind', v_kind, 'resourceKey', v_rk, 'link',
    CASE v_kind
      WHEN 'folder' THEN 'https://drive.google.com/drive/folders/' || v_id || coalesce('?resourcekey=' || v_rk, '')
      WHEN 'file' THEN 'https://drive.google.com/file/d/' || v_id || '/view' || coalesce('?resourcekey=' || v_rk, '')
      ELSE 'https://drive.google.com/open?id=' || v_id || coalesce('&resourcekey=' || v_rk, '')
    END);
END $$;

-- Every sentence of DRIVE-IMPORT.md 6 in one place. p_name is the file's
-- name; p_kind is the link's kind (not_found) or the file's (too_big).
CREATE OR REPLACE FUNCTION public.cockpit_csm_drive_import_sentence(p_code text, p_name text, p_kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE p_code
    WHEN 'link_empty' THEN 'Paste a Drive link: a folder, or one video or picture.'
    WHEN 'link_docs' THEN 'That''s a Google Docs link. Paste a Drive folder, or one video or picture.'
    WHEN 'link_page' THEN 'This link opens a Drive page, not a folder. Open the folder and copy its link.'
    WHEN 'link_bad' THEN 'This isn''t a Drive folder or file link.'
    WHEN 'too_many_open' THEN 'Ten imports are already running for this client. Wait for one to finish, then paste the link again.'
    WHEN 'too_many_links' THEN 'Too many Drive links in the last hour. Wait a few minutes, then paste it again.'
    WHEN 'not_found' THEN 'We can''t open this '
      || CASE p_kind WHEN 'folder' THEN 'folder' WHEN 'file' THEN 'file' ELSE 'link' END
      || '. Ask the client to share it as anyone with the link, or move it into their Drive folder.'
    WHEN 'not_media' THEN 'That file isn''t a picture or a video. Paste a folder, or one video or picture.'
    WHEN 'nothing_found' THEN 'There are no pictures or videos in this folder, or in the folders inside it.'
    WHEN 'drive_down' THEN 'Drive can''t be reached from our side right now. Upload the files here instead.'
    WHEN 'access_revoked' THEN 'This import stopped: whoever started it can no longer open this client.'
    WHEN 'stopped' THEN 'This import stopped three times without bringing anything in. Paste the link again, or upload the files here.'
    WHEN 'not_started' THEN 'This import couldn''t start. Paste the link again, or upload the files here.'
    WHEN 'too_big' THEN CASE WHEN p_kind = 'video'
      THEN p_name || ' is too long or too large to bring in. Upload a cut under 5 minutes, or send it in the group.'
      ELSE p_name || ' is over 150 MB. Export a smaller copy and upload it here.' END
    WHEN 'wrong_type' THEN p_name || ' isn''t a picture or a video we can show. Pictures: JPG, PNG, WebP. Videos: MP4, MOV, WebM.'
    WHEN 'heic' THEN p_name || ' is an iPhone photo (HEIC) we couldn''t convert. Export it as JPG and upload it here.'
    WHEN 'unplayable' THEN p_name || ' couldn''t be converted to play in a browser. Export it as MP4 and upload it here.'
    WHEN 'download' THEN p_name || ' didn''t come through from Drive. Paste the link again; files already in the tray are skipped.'
    WHEN 'storage' THEN p_name || ' didn''t save. Paste the link again; files already in the tray are skipped.'
    WHEN 'unfinished' THEN p_name || ' didn''t finish. Paste the link again; files already in the tray are skipped.'
    WHEN 'full' THEN 'This client has 200 files already. Remove some, then paste the link again.'
    WHEN 'converted' THEN p_name || ' was converted to MP4 so it plays in every browser.'
  END
$$;

-- ---------------------------------------------------------------------------
-- The tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cockpit_csm_launch_ads_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  link text NOT NULL CHECK (link ~ '^https://drive[.]google[.]com/' AND char_length(link) <= 400),
  drive_id text NOT NULL CHECK (drive_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  resource_key text CHECK (resource_key IS NULL OR resource_key ~ '^[A-Za-z0-9_-]{1,100}$'),
  kind text NOT NULL CHECK (kind IN ('file','folder','either')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','working','done','failed')),
  code text CHECK (code IS NULL OR code IN ('not_found','not_media','nothing_found','drive_down',
                                            'access_revoked','stopped','not_started')),
  message text CHECK (message IS NULL OR char_length(message) BETWEEN 1 AND 300),
  found integer CHECK (found IS NULL OR found BETWEEN 1 AND 20),
  over_limit boolean NOT NULL DEFAULT false,
  landed integer NOT NULL DEFAULT 0 CHECK (landed BETWEEN 0 AND 20),
  skipped integer NOT NULL DEFAULT 0 CHECK (skipped BETWEEN 0 AND 20),
  failed integer NOT NULL DEFAULT 0 CHECK (failed BETWEEN 0 AND 20),
  files jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(files) = 'array' AND jsonb_array_length(files) <= 20),
  -- Takes in a row without a file landing; file_landed sets it back to 0.
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  requested_by uuid NOT NULL,
  requested_by_email text NOT NULL CHECK (btrim(requested_by_email) <> ''),
  requested_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claimed_by text CHECK (claimed_by IS NULL OR claimed_by ~ '^[a-z0-9@._:-]{1,80}$'),
  heartbeat_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cockpit_csm_launch_ads_imports_state CHECK (
    (status = 'queued'  AND claimed_at IS NULL     AND finished_at IS NULL) OR
    (status = 'working' AND claimed_at IS NOT NULL AND finished_at IS NULL) OR
    (status IN ('done','failed') AND finished_at IS NOT NULL)),
  CONSTRAINT cockpit_csm_launch_ads_imports_failed CHECK (
    (status = 'failed') = (code IS NOT NULL AND message IS NOT NULL)),
  CONSTRAINT cockpit_csm_launch_ads_imports_counts CHECK (
    landed + skipped + failed <= coalesce(found, 0))
);
CREATE INDEX IF NOT EXISTS cockpit_csm_launch_ads_imports_task_idx
  ON public.cockpit_csm_launch_ads_imports (task_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS cockpit_csm_launch_ads_imports_open_idx
  ON public.cockpit_csm_launch_ads_imports (requested_at) WHERE status IN ('queued','working');
-- One open import per link per client: a second paste returns the first.
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_csm_launch_ads_imports_one_open
  ON public.cockpit_csm_launch_ads_imports (task_id, drive_id) WHERE status IN ('queued','working');

-- When the importer last showed it was alive. A heartbeat, not an action:
-- it is written on every worker call and leaves no audit row (the audit log
-- was compacted on 2026-10-09; 525,000 heartbeat rows a year would undo it).
CREATE TABLE IF NOT EXISTS public.cockpit_csm_drive_import_worker (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  worker text NOT NULL CHECK (worker ~ '^[a-z0-9@._:-]{1,80}$'),
  seen_at timestamptz NOT NULL
);

ALTER TABLE public.cockpit_csm_launch_ads_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_csm_drive_import_worker ENABLE ROW LEVEL SECURITY;
-- No policies and no grants, the service key included: the functions below
-- are the only door, and they run as their owner.
REVOKE ALL ON public.cockpit_csm_launch_ads_imports, public.cockpit_csm_drive_import_worker
  FROM PUBLIC, anon, authenticated, service_role;

-- The tray's table gains its source. Its grants are not changed.
ALTER TABLE public.cockpit_csm_launch_ads
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'upload' CHECK (source IN ('upload','drive')),
  ADD COLUMN IF NOT EXISTS source_drive_id text
    CHECK (source_drive_id IS NULL OR source_drive_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  ADD COLUMN IF NOT EXISTS import_id uuid REFERENCES public.cockpit_csm_launch_ads_imports(id);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cockpit_csm_launch_ads_source'
                   AND conrelid = 'public.cockpit_csm_launch_ads'::regclass) THEN
    ALTER TABLE public.cockpit_csm_launch_ads ADD CONSTRAINT cockpit_csm_launch_ads_source CHECK (
      (source = 'drive') = (source_drive_id IS NOT NULL AND import_id IS NOT NULL));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_csm_launch_ads_drive_once
  ON public.cockpit_csm_launch_ads (task_id, source_drive_id)
  WHERE source_drive_id IS NOT NULL AND status <> 'removed';

-- ---------------------------------------------------------------------------
-- The audit (DRIVE-IMPORT.md 5): the decks' trigger, its body unchanged but
-- for the actor (the worker names itself through cockpit.deck_actor) and a
-- branch for the imports (a heartbeat writes nothing; an update keeps only
-- the columns that changed, and only the files entries that changed).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  old_row jsonb; new_row jsonb; row_any jsonb; o jsonb; n jsonb; b jsonb; a jsonb; keys text[];
  entity text; who text; act text; fo jsonb; fn jsonb;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN new_row := to_jsonb(NEW); END IF;
  row_any := coalesce(new_row, old_row);
  IF TG_TABLE_NAME = 'cockpit_csm_deck_prep' THEN
    entity := (row_any->>'task_id') || ':' || (row_any->>'deck');
    o := coalesce(old_row->'overrides', '{}'::jsonb);
    n := coalesce(new_row->'overrides', '{}'::jsonb);
    SELECT coalesce(jsonb_object_agg(x.k, o->x.k) FILTER (WHERE o ? x.k), '{}'::jsonb),
           coalesce(jsonb_object_agg(x.k, n->x.k) FILTER (WHERE n ? x.k), '{}'::jsonb),
           coalesce(array_agg(x.k ORDER BY x.k), '{}')
      INTO b, a, keys
      FROM (SELECT k FROM jsonb_object_keys(o) k UNION SELECT k FROM jsonb_object_keys(n) k) x
     WHERE (o->x.k) IS DISTINCT FROM (n->x.k);
    IF old_row IS NOT NULL THEN old_row := (old_row - 'overrides') || jsonb_build_object('overrides', b); END IF;
    IF new_row IS NOT NULL THEN new_row := (new_row - 'overrides') || jsonb_build_object('overrides', a); END IF;
  ELSIF TG_TABLE_NAME = 'cockpit_csm_launch_ads_imports' THEN
    entity := row_any->>'id';
    IF TG_OP = 'UPDATE' THEN
      -- The heartbeat, and nothing else: no audit row.
      IF (new_row - 'heartbeat_at' - 'updated_at') = (old_row - 'heartbeat_at' - 'updated_at') THEN
        RETURN NEW;
      END IF;
      SELECT coalesce(array_agg(k ORDER BY k), '{}') INTO keys
        FROM jsonb_object_keys(new_row) k
       WHERE (old_row->k) IS DISTINCT FROM (new_row->k) AND k NOT IN ('heartbeat_at','updated_at');
      SELECT coalesce(jsonb_object_agg(k, old_row->k), '{}'::jsonb), coalesce(jsonb_object_agg(k, new_row->k), '{}'::jsonb)
        INTO b, a FROM unnest(keys) k;
      IF 'files' = ANY(keys) THEN
        SELECT coalesce(jsonb_object_agg(e->>'driveId', e), '{}'::jsonb) INTO fo FROM jsonb_array_elements(old_row->'files') e;
        SELECT coalesce(jsonb_object_agg(e->>'driveId', e), '{}'::jsonb) INTO fn FROM jsonb_array_elements(new_row->'files') e;
        SELECT coalesce(jsonb_object_agg(x.k, fo->x.k) FILTER (WHERE fo ? x.k), '{}'::jsonb),
               coalesce(jsonb_object_agg(x.k, fn->x.k) FILTER (WHERE fn ? x.k), '{}'::jsonb)
          INTO o, n
          FROM (SELECT k FROM jsonb_object_keys(fo) k UNION SELECT k FROM jsonb_object_keys(fn) k) x
         WHERE (fo->x.k) IS DISTINCT FROM (fn->x.k);
        b := b || jsonb_build_object('files', o);
        a := a || jsonb_build_object('files', n);
      END IF;
      old_row := b;
      new_row := a;
    END IF;
  ELSE
    entity := row_any->>'id';
  END IF;
  act := coalesce(nullif(current_setting('cockpit.deck_action', true), ''), lower(TG_OP));
  SELECT lower(btrim(u.email)) INTO who FROM auth.users u WHERE u.id = auth.uid();
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES (act, TG_TABLE_NAME, entity,
          coalesce(who, nullif(current_setting('cockpit.deck_actor', true), ''), session_user),
          'client-success', 'supabase', old_row, new_row,
          jsonb_build_object('op', TG_OP, 'task_id', row_any->>'task_id', 'changed', to_jsonb(keys),
                             'database_role', current_setting('role', true)));
  RETURN coalesce(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS cockpit_csm_launch_ads_imports_audit ON public.cockpit_csm_launch_ads_imports;
CREATE TRIGGER cockpit_csm_launch_ads_imports_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_csm_launch_ads_imports
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_csm_deck_audit();

-- ---------------------------------------------------------------------------
-- Internal: the read's shape, and the one way an import ends
-- ---------------------------------------------------------------------------

-- The browser's shape; p_worker adds the import's resource key, each file's
-- mime, resource key and Drive time, and whether it was planned already.
CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ads_import_json(i public.cockpit_csm_launch_ads_imports, p_worker boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', i.id, 'taskId', i.task_id, 'link', i.link, 'driveId', i.drive_id, 'kind', i.kind,
    'status', i.status, 'code', i.code, 'message', i.message, 'found', i.found, 'overLimit', i.over_limit,
    'landed', i.landed, 'skipped', i.skipped, 'failed', i.failed,
    'files', coalesce((
      SELECT jsonb_agg(CASE WHEN p_worker THEN x.f ELSE jsonb_build_object(
               'driveId', x.f->'driveId', 'name', x.f->'name',
               'kind', CASE WHEN x.f->>'mime' LIKE 'video/%' THEN 'video' ELSE 'image' END,
               'bytes', x.f->'bytes', 'status', x.f->'status', 'code', x.f->'code',
               'message', x.f->'message', 'note', x.f->'note', 'adId', x.f->'adId') END ORDER BY x.o)
        FROM jsonb_array_elements(i.files) WITH ORDINALITY x(f, o)), '[]'::jsonb),
    'requestedBy', i.requested_by_email, 'requestedAt', i.requested_at, 'startedAt', i.claimed_at,
    'finishedAt', i.finished_at, 'updatedAt', i.updated_at)
  || CASE WHEN p_worker
       THEN jsonb_build_object('resourceKey', i.resource_key, 'resumed', i.found IS NOT NULL)
       ELSE '{}'::jsonb END
$$;

-- However an import ends (done, failed by the worker, stopped, not started,
-- access revoked), its unfinished files fail with a sentence and their
-- uploading rows are removed, so no failed import shows a file still
-- "Bringing in" and no orphan row holds the drive_once index.
CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ads_import_end(p_import_id uuid, p_code text) RETURNS public.cockpit_csm_launch_ads_imports
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  imp public.cockpit_csm_launch_ads_imports; f jsonb; v_files jsonb := '[]'::jsonb; v_failed integer;
  v_by text := coalesce(nullif(current_setting('cockpit.deck_actor', true), ''), 'server');
BEGIN
  SELECT * INTO imp FROM public.cockpit_csm_launch_ads_imports x WHERE x.id = p_import_id FOR UPDATE;
  IF imp.id IS NULL THEN RAISE EXCEPTION 'No such import.' USING ERRCODE = 'P0002'; END IF;
  IF imp.status IN ('done','failed') THEN RETURN imp; END IF;
  v_failed := imp.failed;
  FOR f IN SELECT x.e FROM jsonb_array_elements(imp.files) WITH ORDINALITY x(e, o) ORDER BY x.o LOOP
    IF f->>'status' IN ('queued','working') THEN
      IF f->>'adId' IS NOT NULL THEN
        PERFORM set_config('cockpit.deck_action', 'driveImport.drop', true);
        UPDATE public.cockpit_csm_launch_ads a
           SET status = 'removed', removed_at = now(), updated_at = now(), updated_by = v_by
         WHERE a.id = (f->>'adId')::uuid AND a.status = 'uploading';
      END IF;
      f := f || jsonb_build_object('status', 'failed', 'code', 'unfinished',
                                   'message', public.cockpit_csm_drive_import_sentence('unfinished', f->>'name', NULL));
      v_failed := v_failed + 1;
    END IF;
    v_files := v_files || jsonb_build_array(f);
  END LOOP;
  PERFORM set_config('cockpit.deck_action', 'driveImport.finish', true);
  UPDATE public.cockpit_csm_launch_ads_imports x
     SET files = v_files, failed = v_failed,
         status = CASE WHEN p_code IS NULL THEN 'done' ELSE 'failed' END,
         code = p_code,
         message = CASE WHEN p_code IS NULL THEN NULL ELSE public.cockpit_csm_drive_import_sentence(p_code, NULL, imp.kind) END,
         finished_at = now(), updated_at = now()
   WHERE x.id = imp.id
  RETURNING * INTO imp;
  RETURN imp;
END $$;

-- ---------------------------------------------------------------------------
-- The browser's two functions
-- ---------------------------------------------------------------------------

-- Ask for one import (one link). An open import of the same link for this
-- client comes back with existing: true and nothing is written.
CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ads_import_request(p_task_id text, p_link text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE g jsonb; p jsonb; i public.cockpit_csm_launch_ads_imports; n integer;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  p := public.cockpit_csm_drive_link_parse(p_link);
  IF NOT (p->>'ok')::boolean THEN
    RAISE EXCEPTION '%', public.cockpit_csm_drive_import_sentence(p->>'code', NULL, NULL)
      USING ERRCODE = '22023', HINT = p->>'code';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_csm_launch_ads_imports:' || p_task_id, 0));
  SELECT * INTO i FROM public.cockpit_csm_launch_ads_imports x
   WHERE x.task_id = p_task_id AND x.drive_id = p->>'id' AND x.status IN ('queued','working');
  IF i.id IS NOT NULL THEN
    RETURN public.cockpit_csm_launch_ads_import_json(i, false) || jsonb_build_object('existing', true);
  END IF;
  SELECT count(*) INTO n FROM public.cockpit_csm_launch_ads_imports x
   WHERE x.task_id = p_task_id AND x.status IN ('queued','working');
  IF n >= 10 THEN
    RAISE EXCEPTION '%', public.cockpit_csm_drive_import_sentence('too_many_open', NULL, NULL)
      USING ERRCODE = '22023', HINT = 'too_many_open';
  END IF;
  SELECT count(*) INTO n FROM public.cockpit_csm_launch_ads_imports x
   WHERE x.requested_by = auth.uid() AND x.requested_at > now() - interval '1 hour';
  IF n >= 30 THEN
    RAISE EXCEPTION '%', public.cockpit_csm_drive_import_sentence('too_many_links', NULL, NULL)
      USING ERRCODE = '22023', HINT = 'too_many_links';
  END IF;
  PERFORM set_config('cockpit.deck_action', 'driveImport.request', true);
  INSERT INTO public.cockpit_csm_launch_ads_imports (task_id, link, drive_id, resource_key, kind, requested_by, requested_by_email)
  VALUES (p_task_id, p->>'link', p->>'id', p->>'resourceKey', p->>'kind', auth.uid(), g->>'email')
  RETURNING * INTO i;
  RETURN public.cockpit_csm_launch_ads_import_json(i, false) || jsonb_build_object('existing', false);
END $$;

-- This client's open imports, whatever their age, and its finished ones of
-- the last 14 days, newest first, at most 20; and when the importer was
-- last seen alive (its own row, or a working import's heartbeat: a long
-- download never reads as a worker that stopped).
CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ads_imports_read(p_task_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE g jsonb; v_list jsonb;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  SELECT coalesce(jsonb_agg(public.cockpit_csm_launch_ads_import_json(i, false) ORDER BY i.requested_at DESC, i.id), '[]'::jsonb)
    INTO v_list
    FROM public.cockpit_csm_launch_ads_imports i
   WHERE i.id IN (
     SELECT x.id FROM public.cockpit_csm_launch_ads_imports x
      WHERE x.task_id = p_task_id
        AND (x.status IN ('queued','working') OR x.requested_at > now() - interval '14 days')
      ORDER BY (x.status IN ('queued','working')) DESC, x.requested_at DESC, x.id
      LIMIT 20);
  RETURN jsonb_build_object(
    'imports', v_list,
    'workerSeenAt', greatest(
      (SELECT w.seen_at FROM public.cockpit_csm_drive_import_worker w WHERE w.id = 1),
      (SELECT max(x.heartbeat_at) FROM public.cockpit_csm_launch_ads_imports x WHERE x.status = 'working')),
    'at', now());
END $$;

-- ---------------------------------------------------------------------------
-- The worker's seven functions (service_role only). Each one, in order:
-- names the worker, records that it was seen (claim's peek excepted), and,
-- but for claim, takes the import FOR UPDATE: none is P0002, and an import
-- not working or claimed by another run is 40001 (a lost claim, and only
-- that), so the slower of two runs stops at its next call.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ads_import_claim(p_worker text, p_peek boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE imp public.cockpit_csm_launch_ads_imports; v_wait text; v_err text; v_queued integer;
BEGIN
  IF p_worker IS NULL OR p_worker !~ '^[a-z0-9@._:-]{1,80}$' THEN
    RAISE EXCEPTION 'Name the worker.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_peek, false) THEN
    -- The doctor's look: counts and times, nothing written.
    RETURN jsonb_build_object(
      'queued', (SELECT count(*) FROM public.cockpit_csm_launch_ads_imports x WHERE x.status = 'queued'),
      'working', (SELECT count(*) FROM public.cockpit_csm_launch_ads_imports x WHERE x.status = 'working'),
      'oldestQueuedAt', (SELECT min(x.requested_at) FROM public.cockpit_csm_launch_ads_imports x WHERE x.status = 'queued'),
      'workerSeenAt', greatest(
        (SELECT w.seen_at FROM public.cockpit_csm_drive_import_worker w WHERE w.id = 1),
        (SELECT max(x.heartbeat_at) FROM public.cockpit_csm_launch_ads_imports x WHERE x.status = 'working')));
  END IF;
  INSERT INTO public.cockpit_csm_drive_import_worker (id, worker, seen_at) VALUES (1, p_worker, now())
  ON CONFLICT (id) DO UPDATE SET worker = excluded.worker, seen_at = excluded.seen_at;
  PERFORM set_config('cockpit.deck_actor', 'worker:' || p_worker, true);
  -- Twenty at a time, so a few clients whose cards are missing from the
  -- roster (each waits up to 30 minutes) never hold back the next client.
  FOR imp IN
    SELECT * FROM public.cockpit_csm_launch_ads_imports x
     WHERE x.status = 'queued' OR (x.status = 'working' AND x.heartbeat_at < now() - interval '5 minutes')
     ORDER BY x.requested_at, x.id LIMIT 20
       FOR UPDATE SKIP LOCKED
  LOOP
    -- Three takes in a row without a file landing: it stops.
    IF imp.status = 'working' AND imp.attempts >= 3 THEN
      PERFORM public.cockpit_csm_launch_ads_import_end(imp.id, 'stopped');
      CONTINUE;
    END IF;
    BEGIN
      PERFORM public.cockpit_csm_client_gate_for_actor(imp.requested_by, imp.task_id);
    EXCEPTION
      WHEN insufficient_privilege THEN
        PERFORM public.cockpit_csm_launch_ads_import_end(imp.id, 'access_revoked');
        CONTINUE;
      WHEN OTHERS THEN
        -- The roster being refreshed, or this one client's card missing or
        -- ambiguous: it waits, and never blocks another client's import,
        -- until it has been quiet for 30 minutes.
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF coalesce(imp.heartbeat_at, imp.requested_at) < now() - interval '30 minutes' THEN
          PERFORM public.cockpit_csm_launch_ads_import_end(imp.id,
            CASE imp.status WHEN 'queued' THEN 'not_started' ELSE 'stopped' END);
        ELSE
          v_wait := coalesce(v_wait, v_err);
        END IF;
        CONTINUE;
    END;
    PERFORM set_config('cockpit.deck_action', 'driveImport.claim', true);
    UPDATE public.cockpit_csm_launch_ads_imports x
       SET status = 'working', claimed_at = coalesce(x.claimed_at, now()), claimed_by = p_worker,
           heartbeat_at = now(), attempts = x.attempts + 1, updated_at = now()
     WHERE x.id = imp.id
    RETURNING * INTO imp;
    SELECT count(*) INTO v_queued FROM public.cockpit_csm_launch_ads_imports x WHERE x.status = 'queued';
    RETURN jsonb_build_object('import', public.cockpit_csm_launch_ads_import_json(imp, true), 'queued', v_queued);
  END LOOP;
  SELECT count(*) INTO v_queued FROM public.cockpit_csm_launch_ads_imports x WHERE x.status = 'queued';
  IF v_wait IS NOT NULL THEN
    RETURN jsonb_build_object('import', NULL, 'waiting', v_wait, 'queued', v_queued);
  END IF;
  RETURN jsonb_build_object('import', NULL, 'queued', v_queued);
END $$;

-- A long download, conversion or upload keeps its claim and the box's "last
-- ran" line true. The one write the audit trigger skips.
CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ads_import_heartbeat(p_import_id uuid, p_worker text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE imp public.cockpit_csm_launch_ads_imports;
BEGIN
  IF p_worker IS NULL OR p_worker !~ '^[a-z0-9@._:-]{1,80}$' THEN
    RAISE EXCEPTION 'Name the worker.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cockpit_csm_drive_import_worker (id, worker, seen_at) VALUES (1, p_worker, now())
  ON CONFLICT (id) DO UPDATE SET worker = excluded.worker, seen_at = excluded.seen_at;
  SELECT * INTO imp FROM public.cockpit_csm_launch_ads_imports x WHERE x.id = p_import_id FOR UPDATE;
  IF imp.id IS NULL THEN RAISE EXCEPTION 'No such import.' USING ERRCODE = 'P0002'; END IF;
  IF imp.status <> 'working' OR imp.claimed_by IS DISTINCT FROM p_worker THEN
    RAISE EXCEPTION 'This import is not yours to work on.' USING ERRCODE = '40001';
  END IF;
  UPDATE public.cockpit_csm_launch_ads_imports x SET heartbeat_at = now(), updated_at = now() WHERE x.id = imp.id;
END $$;

-- What Drive holds behind the link, before any download: up to 20 files,
-- each skipped when it is in the tray already.
CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ads_import_plan(
  p_import_id uuid, p_worker text, p_kind text, p_files jsonb, p_over_limit boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  imp public.cockpit_csm_launch_ads_imports; f jsonb; v_files jsonb := '[]'::jsonb; v_name text;
  v_skipped integer := 0; v_n integer; v_status text; v_time timestamptz;
BEGIN
  IF p_worker IS NULL OR p_worker !~ '^[a-z0-9@._:-]{1,80}$' THEN
    RAISE EXCEPTION 'Name the worker.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cockpit_csm_drive_import_worker (id, worker, seen_at) VALUES (1, p_worker, now())
  ON CONFLICT (id) DO UPDATE SET worker = excluded.worker, seen_at = excluded.seen_at;
  SELECT * INTO imp FROM public.cockpit_csm_launch_ads_imports x WHERE x.id = p_import_id FOR UPDATE;
  IF imp.id IS NULL THEN RAISE EXCEPTION 'No such import.' USING ERRCODE = 'P0002'; END IF;
  IF imp.status <> 'working' OR imp.claimed_by IS DISTINCT FROM p_worker THEN
    RAISE EXCEPTION 'This import is not yours to work on.' USING ERRCODE = '40001';
  END IF;
  PERFORM set_config('cockpit.deck_actor', 'worker:' || p_worker, true);
  IF p_kind IS NULL OR p_kind NOT IN ('file','folder') THEN
    RAISE EXCEPTION 'Say what Drive found: a file or a folder.' USING ERRCODE = '22023';
  END IF;
  IF p_files IS NULL OR jsonb_typeof(p_files) <> 'array' OR jsonb_array_length(p_files) = 0 THEN
    RAISE EXCEPTION 'Send at least one file, or finish with nothing_found.' USING ERRCODE = '22023';
  END IF;
  v_n := jsonb_array_length(p_files);
  IF v_n > 20 THEN RAISE EXCEPTION 'Send at most 20 files.' USING ERRCODE = '22023'; END IF;
  -- Each file once: reserve, landed and failed find an entry by its id.
  IF (SELECT count(DISTINCT x.f->>'id') FROM jsonb_array_elements(p_files) x(f)) <> v_n THEN
    RAISE EXCEPTION 'Send each file once.' USING ERRCODE = '22023';
  END IF;
  -- A second plan on the same claim replaces the first only while nothing
  -- has started (never 40001, which means only a lost claim).
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(imp.files) x(e) WHERE x.e->>'status' NOT IN ('queued','skipped')) THEN
    RAISE EXCEPTION 'This import already started its files.' USING ERRCODE = '55000';
  END IF;
  FOR f IN SELECT x.e FROM jsonb_array_elements(p_files) WITH ORDINALITY x(e, o) ORDER BY x.o LOOP
    IF jsonb_typeof(f) <> 'object' OR coalesce(f->>'id', '') !~ '^[A-Za-z0-9_-]{10,200}$' THEN
      RAISE EXCEPTION 'Each file needs its Drive id.' USING ERRCODE = '22023';
    END IF;
    -- The name's last path segment, with no control (C0 or C1), invisible or
    -- direction marks (the review round: the Arabic letter mark, zero-width
    -- space, line and paragraph separators, word joiners and the BOM too).
    -- A name with nothing left is the file's Drive id: one odd name never
    -- refuses the whole plan.
    v_name := btrim(left(regexp_replace(regexp_replace(coalesce(f->>'name', ''), '^.*[/\\]', ''),
                E'[[:cntrl:]\u0080-\u009F\u061C\u200B\u200E\u200F\u2028-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]',
                '', 'g'), 200));
    IF v_name = '' THEN v_name := f->>'id'; END IF;
    IF coalesce(f->>'mime', '') !~ '^(image|video)/[a-z0-9.+-]{1,60}$' THEN
      RAISE EXCEPTION 'Each file is a picture or a video.' USING ERRCODE = '22023';
    END IF;
    IF f ? 'bytes' AND jsonb_typeof(f->'bytes') <> 'null' AND (
         jsonb_typeof(f->'bytes') <> 'number' OR (f->>'bytes')::numeric NOT BETWEEN 0 AND 1000000000000
         OR (f->>'bytes')::numeric <> trunc((f->>'bytes')::numeric)) THEN
      RAISE EXCEPTION 'A file''s size is a whole number of bytes.' USING ERRCODE = '22023';
    END IF;
    v_time := NULL;
    IF f ? 'createdTime' AND jsonb_typeof(f->'createdTime') <> 'null' THEN
      BEGIN
        v_time := (f->>'createdTime')::timestamptz;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'A file''s time is an ISO time.' USING ERRCODE = '22023';
      END;
    END IF;
    IF f ? 'resourceKey' AND jsonb_typeof(f->'resourceKey') <> 'null'
       AND coalesce(f->>'resourceKey', '') !~ '^[A-Za-z0-9_-]{1,100}$' THEN
      RAISE EXCEPTION 'A file''s resource key is not valid.' USING ERRCODE = '22023';
    END IF;
    v_status := CASE WHEN EXISTS (
        SELECT 1 FROM public.cockpit_csm_launch_ads a
         WHERE a.task_id = imp.task_id AND a.source_drive_id = f->>'id' AND a.status <> 'removed')
      THEN 'skipped' ELSE 'queued' END;
    IF v_status = 'skipped' THEN v_skipped := v_skipped + 1; END IF;
    v_files := v_files || jsonb_build_array(jsonb_build_object(
      'driveId', f->>'id', 'resourceKey', nullif(f->>'resourceKey', ''), 'name', v_name, 'mime', f->>'mime',
      'bytes', CASE WHEN jsonb_typeof(f->'bytes') = 'number' THEN f->'bytes' END,
      'createdTime', CASE WHEN v_time IS NOT NULL THEN f->'createdTime' END,
      'status', v_status, 'code', NULL, 'message', NULL, 'note', NULL, 'adId', NULL));
  END LOOP;
  PERFORM set_config('cockpit.deck_action', 'driveImport.plan', true);
  UPDATE public.cockpit_csm_launch_ads_imports x
     SET kind = p_kind, files = v_files, found = v_n, skipped = v_skipped, landed = 0, failed = 0,
         over_limit = coalesce(p_over_limit, false), heartbeat_at = now(), updated_at = now()
   WHERE x.id = imp.id
  RETURNING * INTO imp;
  RETURN public.cockpit_csm_launch_ads_import_json(imp, true);
END $$;

-- After the worker downloaded, checked, converted if needed and probed one
-- file, before it uploads: the launch ad's row, as an upload reserves it.
CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ads_import_file_reserve(
  p_import_id uuid, p_worker text, p_drive_file_id text, p_mime text, p_bytes bigint,
  p_width integer DEFAULT NULL, p_height integer DEFAULT NULL, p_seconds numeric DEFAULT NULL,
  p_poster_mime text DEFAULT NULL, p_poster_bytes bigint DEFAULT NULL, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  imp public.cockpit_csm_launch_ads_imports; a public.cockpit_csm_launch_ads; f jsonb; v_i integer;
  v_ext text; v_pext text; v_id uuid; v_count integer; v_c text; v_who text;
BEGIN
  IF p_worker IS NULL OR p_worker !~ '^[a-z0-9@._:-]{1,80}$' THEN
    RAISE EXCEPTION 'Name the worker.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cockpit_csm_drive_import_worker (id, worker, seen_at) VALUES (1, p_worker, now())
  ON CONFLICT (id) DO UPDATE SET worker = excluded.worker, seen_at = excluded.seen_at;
  SELECT * INTO imp FROM public.cockpit_csm_launch_ads_imports x WHERE x.id = p_import_id FOR UPDATE;
  IF imp.id IS NULL THEN RAISE EXCEPTION 'No such import.' USING ERRCODE = 'P0002'; END IF;
  IF imp.status <> 'working' OR imp.claimed_by IS DISTINCT FROM p_worker THEN
    RAISE EXCEPTION 'This import is not yours to work on.' USING ERRCODE = '40001';
  END IF;
  v_who := 'worker:' || p_worker;
  PERFORM set_config('cockpit.deck_actor', v_who, true);
  SELECT x.o - 1, x.e INTO v_i, f FROM jsonb_array_elements(imp.files) WITH ORDINALITY x(e, o)
   WHERE x.e->>'driveId' = p_drive_file_id LIMIT 1;
  IF f IS NULL OR f->>'status' NOT IN ('queued','working','landed','skipped','failed') THEN
    RAISE EXCEPTION 'That file is not in this import''s plan.' USING ERRCODE = '22023';
  END IF;
  IF f->>'status' IN ('landed','skipped','failed') THEN RETURN jsonb_build_object('done', true); END IF;
  -- The requester's access, as in claim. Any other gate error (the roster
  -- being refreshed) is the import's, not this file's: the worker ends its
  -- turn and the import carries on later.
  BEGIN
    PERFORM public.cockpit_csm_client_gate_for_actor(imp.requested_by, imp.task_id);
  EXCEPTION
    WHEN insufficient_privilege THEN
      PERFORM public.cockpit_csm_launch_ads_import_end(imp.id, 'access_revoked');
      RETURN jsonb_build_object('stopped', true);
    WHEN OTHERS THEN
      RAISE EXCEPTION 'The client roster is being refreshed. The import carries on shortly.'
        USING ERRCODE = '55006', HINT = 'roster';
  END;
  -- The facts, as cockpit_csm_launch_ad_reserve checks them (the worker
  -- never sends what it would refuse; this is the server's guard).
  v_ext := CASE p_mime WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp'
                       WHEN 'video/mp4' THEN 'mp4' WHEN 'video/quicktime' THEN 'mov' WHEN 'video/webm' THEN 'webm' END;
  IF v_ext IS NULL THEN RAISE EXCEPTION 'Add a picture (JPG, PNG, WebP) or a video (MP4, MOV, WebM)' USING ERRCODE = '22023'; END IF;
  IF p_bytes IS NULL OR p_bytes < 1 THEN RAISE EXCEPTION 'The file is empty' USING ERRCODE = '22023'; END IF;
  IF p_bytes > 157286400 THEN RAISE EXCEPTION 'The file is over 150 MB. Export a smaller copy to keep it' USING ERRCODE = '22023'; END IF;
  IF (p_width IS NOT NULL AND p_width NOT BETWEEN 1 AND 20000) OR (p_height IS NOT NULL AND p_height NOT BETWEEN 1 AND 20000)
     OR (p_seconds IS NOT NULL AND NOT (p_seconds > 0 AND p_seconds <= 3600)) THEN
    RAISE EXCEPTION 'The file''s size or length is not valid' USING ERRCODE = '22023';
  END IF;
  IF (p_poster_mime IS NULL) <> (p_poster_bytes IS NULL) THEN RAISE EXCEPTION 'A poster needs its type and size' USING ERRCODE = '22023'; END IF;
  IF p_poster_mime IS NOT NULL THEN
    IF p_mime NOT LIKE 'video/%' THEN RAISE EXCEPTION 'Only a video has a poster' USING ERRCODE = '22023'; END IF;
    v_pext := CASE p_poster_mime WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' END;
    IF v_pext IS NULL OR p_poster_bytes NOT BETWEEN 1 AND 5242880 THEN
      RAISE EXCEPTION 'A poster is a JPG, PNG or WebP picture up to 5 MB' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_note IS NOT NULL AND p_note <> 'converted' THEN RAISE EXCEPTION 'A file''s note is converted, or none.' USING ERRCODE = '22023'; END IF;

  -- A resumed entry: a run that died after reserving, or a retried call.
  IF f->>'adId' IS NOT NULL THEN
    SELECT * INTO a FROM public.cockpit_csm_launch_ads x WHERE x.id = (f->>'adId')::uuid FOR UPDATE;
    IF a.status = 'uploading' THEN
      IF a.mime <> p_mime OR a.poster_mime IS DISTINCT FROM p_poster_mime THEN
        RAISE EXCEPTION 'That file changed in Drive since it was reserved.' USING ERRCODE = '22023';
      END IF;
      PERFORM set_config('cockpit.deck_action', 'driveImport.reserve', true);
      UPDATE public.cockpit_csm_launch_ads x
         SET bytes = p_bytes, width = p_width, height = p_height, seconds = p_seconds, poster_bytes = p_poster_bytes,
             updated_at = now(), updated_by = v_who
       WHERE x.id = a.id
      RETURNING * INTO a;
      UPDATE public.cockpit_csm_launch_ads_imports x
         SET files = jsonb_set(x.files, ARRAY[v_i::text], f || jsonb_build_object('note', p_note)),
             heartbeat_at = now(), updated_at = now()
       WHERE x.id = imp.id;
      RETURN jsonb_build_object('adId', a.id, 'path', a.storage_path, 'posterPath', a.poster_path, 'resumed', true);
    ELSIF a.status = 'ready' THEN
      -- It turned ready another way (the requester accepted it in the
      -- browser): the file is in the tray, so the entry has landed.
      PERFORM set_config('cockpit.deck_action', 'driveImport.ready', true);
      UPDATE public.cockpit_csm_launch_ads_imports x
         SET files = jsonb_set(x.files, ARRAY[v_i::text], f || jsonb_build_object('status', 'landed')),
             landed = x.landed + 1, attempts = 0, heartbeat_at = now(), updated_at = now()
       WHERE x.id = imp.id;
      RETURN jsonb_build_object('done', true);
    END IF;
    -- Removed (the day-old sweep): reserved again below.
  END IF;

  SELECT count(*) INTO v_count FROM public.cockpit_csm_launch_ads x WHERE x.task_id = imp.task_id AND x.status <> 'removed';
  IF v_count >= 200 THEN
    PERFORM set_config('cockpit.deck_action', 'driveImport.skip', true);
    UPDATE public.cockpit_csm_launch_ads_imports x
       SET files = jsonb_set(x.files, ARRAY[v_i::text], f || jsonb_build_object('status', 'failed', 'code', 'full',
                     'message', public.cockpit_csm_drive_import_sentence('full', f->>'name', NULL))),
           failed = x.failed + 1, heartbeat_at = now(), updated_at = now()
     WHERE x.id = imp.id;
    RETURN jsonb_build_object('failed', true, 'code', 'full');
  END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_csm_launch_ads x
              WHERE x.task_id = imp.task_id AND x.source_drive_id = p_drive_file_id AND x.status <> 'removed') THEN
    PERFORM set_config('cockpit.deck_action', 'driveImport.skip', true);
    UPDATE public.cockpit_csm_launch_ads_imports x
       SET files = jsonb_set(x.files, ARRAY[v_i::text], f || jsonb_build_object('status', 'skipped')),
           skipped = x.skipped + 1, heartbeat_at = now(), updated_at = now()
     WHERE x.id = imp.id;
    RETURN jsonb_build_object('skipped', true);
  END IF;

  v_id := gen_random_uuid();
  PERFORM set_config('cockpit.deck_action', 'driveImport.reserve', true);
  BEGIN
    -- request_id is random: the resume path finds the row by the entry's
    -- adId, and no browser can compute this row's request id.
    INSERT INTO public.cockpit_csm_launch_ads (id, request_id, task_id, kind, status, storage_path, mime, bytes, width, height,
        seconds, poster_path, poster_mime, poster_bytes, file_name, created_by, created_by_email, updated_by,
        source, source_drive_id, import_id)
    VALUES (v_id, gen_random_uuid(), imp.task_id, 'custom', 'uploading', imp.task_id || '/' || v_id::text || '.' || v_ext,
        p_mime, p_bytes, p_width, p_height, p_seconds,
        CASE WHEN v_pext IS NOT NULL THEN imp.task_id || '/' || v_id::text || '-poster.' || v_pext END,
        p_poster_mime, p_poster_bytes, left(f->>'name', 200), imp.requested_by, imp.requested_by_email, v_who,
        'drive', p_drive_file_id, imp.id)
    RETURNING * INTO a;
  EXCEPTION WHEN unique_violation THEN
    -- Two imports racing for one file: the loser's entry is skipped. Any
    -- other unique violation is a real error.
    GET STACKED DIAGNOSTICS v_c = CONSTRAINT_NAME;
    IF v_c IS DISTINCT FROM 'cockpit_csm_launch_ads_drive_once' THEN RAISE; END IF;
    PERFORM set_config('cockpit.deck_action', 'driveImport.skip', true);
    UPDATE public.cockpit_csm_launch_ads_imports x
       SET files = jsonb_set(x.files, ARRAY[v_i::text], f || jsonb_build_object('status', 'skipped')),
           skipped = x.skipped + 1, heartbeat_at = now(), updated_at = now()
     WHERE x.id = imp.id;
    RETURN jsonb_build_object('skipped', true);
  END;
  UPDATE public.cockpit_csm_launch_ads_imports x
     SET files = jsonb_set(x.files, ARRAY[v_i::text], f || jsonb_build_object('status', 'working', 'adId', a.id, 'note', p_note)),
         heartbeat_at = now(), updated_at = now()
   WHERE x.id = imp.id;
  RETURN jsonb_build_object('adId', a.id, 'path', a.storage_path, 'posterPath', a.poster_path, 'resumed', false);
END $$;

-- The bytes are up: Storage's own metadata must match the row before it
-- turns ready, as cockpit_csm_launch_ad_accept checks an upload.
CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ads_import_file_landed(p_import_id uuid, p_worker text, p_drive_file_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  imp public.cockpit_csm_launch_ads_imports; a public.cockpit_csm_launch_ads; f jsonb; v_i integer; meta jsonb; pmeta jsonb;
  v_who text;
BEGIN
  IF p_worker IS NULL OR p_worker !~ '^[a-z0-9@._:-]{1,80}$' THEN
    RAISE EXCEPTION 'Name the worker.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cockpit_csm_drive_import_worker (id, worker, seen_at) VALUES (1, p_worker, now())
  ON CONFLICT (id) DO UPDATE SET worker = excluded.worker, seen_at = excluded.seen_at;
  SELECT * INTO imp FROM public.cockpit_csm_launch_ads_imports x WHERE x.id = p_import_id FOR UPDATE;
  IF imp.id IS NULL THEN RAISE EXCEPTION 'No such import.' USING ERRCODE = 'P0002'; END IF;
  IF imp.status <> 'working' OR imp.claimed_by IS DISTINCT FROM p_worker THEN
    RAISE EXCEPTION 'This import is not yours to work on.' USING ERRCODE = '40001';
  END IF;
  v_who := 'worker:' || p_worker;
  PERFORM set_config('cockpit.deck_actor', v_who, true);
  SELECT x.o - 1, x.e INTO v_i, f FROM jsonb_array_elements(imp.files) WITH ORDINALITY x(e, o)
   WHERE x.e->>'driveId' = p_drive_file_id LIMIT 1;
  IF f IS NULL THEN RAISE EXCEPTION 'That file is not in this import''s plan.' USING ERRCODE = '22023'; END IF;
  IF f->>'status' IN ('landed','skipped','failed') THEN RETURN public.cockpit_csm_launch_ads_import_json(imp, true); END IF;
  IF f->>'status' <> 'working' OR f->>'adId' IS NULL THEN
    RAISE EXCEPTION 'That file was not reserved yet.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO a FROM public.cockpit_csm_launch_ads x WHERE x.id = (f->>'adId')::uuid FOR UPDATE;
  IF a.status = 'uploading' THEN
    SELECT o.metadata INTO meta FROM storage.objects o WHERE o.bucket_id = 'cockpit-launch-ads' AND o.name = a.storage_path;
    IF meta IS NULL OR coalesce(meta->>'size', '') !~ '^[0-9]{1,12}$' OR (meta->>'size')::bigint <> a.bytes
       OR lower(coalesce(meta->>'mimetype', '')) <> a.mime THEN
      RAISE EXCEPTION 'The file did not arrive. Upload it again.' USING ERRCODE = '22023';
    END IF;
    IF a.poster_path IS NOT NULL THEN
      SELECT o.metadata INTO pmeta FROM storage.objects o WHERE o.bucket_id = 'cockpit-launch-ads' AND o.name = a.poster_path;
      IF pmeta IS NULL OR coalesce(pmeta->>'size', '') !~ '^[0-9]{1,12}$' OR (pmeta->>'size')::bigint <> a.poster_bytes
         OR lower(coalesce(pmeta->>'mimetype', '')) <> a.poster_mime THEN
        RAISE EXCEPTION 'The file did not arrive. Upload it again.' USING ERRCODE = '22023';
      END IF;
    END IF;
    PERFORM set_config('cockpit.deck_action', 'driveImport.ready', true);
    UPDATE public.cockpit_csm_launch_ads x SET status = 'ready', ready_at = now(), updated_at = now(), updated_by = v_who
     WHERE x.id = a.id;
  ELSIF a.status IS DISTINCT FROM 'ready' THEN
    -- Removed while the bytes moved: nothing landed.
    RAISE EXCEPTION 'The file did not arrive. Upload it again.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.deck_action', 'driveImport.ready', true);
  UPDATE public.cockpit_csm_launch_ads_imports x
     SET files = jsonb_set(x.files, ARRAY[v_i::text], f || jsonb_build_object('status', 'landed')),
         landed = x.landed + 1, attempts = 0, heartbeat_at = now(), updated_at = now()
   WHERE x.id = imp.id
  RETURNING * INTO imp;
  RETURN public.cockpit_csm_launch_ads_import_json(imp, true);
END $$;

-- One file's own failure, with its sentence; the others carry on.
CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ads_import_file_failed(p_import_id uuid, p_worker text, p_drive_file_id text, p_code text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE imp public.cockpit_csm_launch_ads_imports; f jsonb; v_i integer; v_who text; v_kind text;
BEGIN
  IF p_worker IS NULL OR p_worker !~ '^[a-z0-9@._:-]{1,80}$' THEN
    RAISE EXCEPTION 'Name the worker.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cockpit_csm_drive_import_worker (id, worker, seen_at) VALUES (1, p_worker, now())
  ON CONFLICT (id) DO UPDATE SET worker = excluded.worker, seen_at = excluded.seen_at;
  SELECT * INTO imp FROM public.cockpit_csm_launch_ads_imports x WHERE x.id = p_import_id FOR UPDATE;
  IF imp.id IS NULL THEN RAISE EXCEPTION 'No such import.' USING ERRCODE = 'P0002'; END IF;
  IF imp.status <> 'working' OR imp.claimed_by IS DISTINCT FROM p_worker THEN
    RAISE EXCEPTION 'This import is not yours to work on.' USING ERRCODE = '40001';
  END IF;
  v_who := 'worker:' || p_worker;
  PERFORM set_config('cockpit.deck_actor', v_who, true);
  IF p_code IS NULL OR p_code NOT IN ('too_big','wrong_type','heic','unplayable','download','storage') THEN
    RAISE EXCEPTION 'Name a file failure.' USING ERRCODE = '22023';
  END IF;
  SELECT x.o - 1, x.e INTO v_i, f FROM jsonb_array_elements(imp.files) WITH ORDINALITY x(e, o)
   WHERE x.e->>'driveId' = p_drive_file_id LIMIT 1;
  IF f IS NULL THEN RAISE EXCEPTION 'That file is not in this import''s plan.' USING ERRCODE = '22023'; END IF;
  IF f->>'status' IN ('failed','landed','skipped') THEN RETURN public.cockpit_csm_launch_ads_import_json(imp, true); END IF;
  IF f->>'adId' IS NOT NULL THEN
    PERFORM set_config('cockpit.deck_action', 'driveImport.drop', true);
    UPDATE public.cockpit_csm_launch_ads a SET status = 'removed', removed_at = now(), updated_at = now(), updated_by = v_who
     WHERE a.id = (f->>'adId')::uuid AND a.status = 'uploading';
  END IF;
  v_kind := CASE WHEN f->>'mime' LIKE 'video/%' OR f->>'name' ~* '[.](mp4|mov|m4v|webm|avi|mkv)$' THEN 'video' ELSE 'image' END;
  PERFORM set_config('cockpit.deck_action', 'driveImport.fileFailed', true);
  UPDATE public.cockpit_csm_launch_ads_imports x
     SET files = jsonb_set(x.files, ARRAY[v_i::text], f || jsonb_build_object('status', 'failed', 'code', p_code,
                   'message', public.cockpit_csm_drive_import_sentence(p_code, f->>'name', v_kind))),
         failed = x.failed + 1, heartbeat_at = now(), updated_at = now()
   WHERE x.id = imp.id
  RETURNING * INTO imp;
  RETURN public.cockpit_csm_launch_ads_import_json(imp, true);
END $$;

-- The import ends: done with null (the box words it from its counts), or
-- failed with one of the worker's four codes. The server's own codes
-- (access_revoked, stopped, not_started) are never sent.
CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ads_import_finish(p_import_id uuid, p_worker text, p_code text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE imp public.cockpit_csm_launch_ads_imports;
BEGIN
  IF p_worker IS NULL OR p_worker !~ '^[a-z0-9@._:-]{1,80}$' THEN
    RAISE EXCEPTION 'Name the worker.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.cockpit_csm_drive_import_worker (id, worker, seen_at) VALUES (1, p_worker, now())
  ON CONFLICT (id) DO UPDATE SET worker = excluded.worker, seen_at = excluded.seen_at;
  SELECT * INTO imp FROM public.cockpit_csm_launch_ads_imports x WHERE x.id = p_import_id FOR UPDATE;
  IF imp.id IS NULL THEN RAISE EXCEPTION 'No such import.' USING ERRCODE = 'P0002'; END IF;
  -- An import already finished returns itself, writing nothing.
  IF imp.status IN ('done','failed') THEN RETURN public.cockpit_csm_launch_ads_import_json(imp, true); END IF;
  IF imp.status <> 'working' OR imp.claimed_by IS DISTINCT FROM p_worker THEN
    RAISE EXCEPTION 'This import is not yours to work on.' USING ERRCODE = '40001';
  END IF;
  IF p_code IS NOT NULL AND p_code NOT IN ('not_found','not_media','nothing_found','drive_down') THEN
    RAISE EXCEPTION 'Name an import failure.' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('cockpit.deck_actor', 'worker:' || p_worker, true);
  imp := public.cockpit_csm_launch_ads_import_end(imp.id, p_code);
  RETURN public.cockpit_csm_launch_ads_import_json(imp, true);
END $$;

-- ---------------------------------------------------------------------------
-- Grants: the two browser functions for signed-in seats (the gate inside
-- decides), the seven worker functions for the service key, the helpers for
-- nobody. The browser's would refuse a service-role call anyway (the gate
-- needs auth.uid()); the worker's are out of the browser's reach.
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION
  public.cockpit_csm_launch_ads_import_request(text, text),
  public.cockpit_csm_launch_ads_imports_read(text),
  public.cockpit_csm_launch_ads_import_claim(text, boolean),
  public.cockpit_csm_launch_ads_import_heartbeat(uuid, text),
  public.cockpit_csm_launch_ads_import_plan(uuid, text, text, jsonb, boolean),
  public.cockpit_csm_launch_ads_import_file_reserve(uuid, text, text, text, bigint, integer, integer, numeric, text, bigint, text),
  public.cockpit_csm_launch_ads_import_file_landed(uuid, text, text),
  public.cockpit_csm_launch_ads_import_file_failed(uuid, text, text, text),
  public.cockpit_csm_launch_ads_import_finish(uuid, text, text),
  public.cockpit_csm_launch_ads_import_end(uuid, text),
  public.cockpit_csm_drive_link_parse(text),
  public.cockpit_csm_drive_import_sentence(text, text, text),
  public.cockpit_csm_launch_ads_import_json(public.cockpit_csm_launch_ads_imports, boolean),
  public.cockpit_csm_deck_audit()
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.cockpit_csm_launch_ads_import_request(text, text),
  public.cockpit_csm_launch_ads_imports_read(text)
TO authenticated;
GRANT EXECUTE ON FUNCTION
  public.cockpit_csm_launch_ads_import_claim(text, boolean),
  public.cockpit_csm_launch_ads_import_heartbeat(uuid, text),
  public.cockpit_csm_launch_ads_import_plan(uuid, text, text, jsonb, boolean),
  public.cockpit_csm_launch_ads_import_file_reserve(uuid, text, text, text, bigint, integer, integer, numeric, text, bigint, text),
  public.cockpit_csm_launch_ads_import_file_landed(uuid, text, text),
  public.cockpit_csm_launch_ads_import_file_failed(uuid, text, text, text),
  public.cockpit_csm_launch_ads_import_finish(uuid, text, text)
TO service_role;

COMMIT;
