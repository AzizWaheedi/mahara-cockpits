-- Upsell studio, 3 of 3: proposals, their views and the door's status
-- (docs/upsell-studio/BACKEND.md section 3). Apply after 20261026v.
--
-- The CEO, 26 Oct 2026: "a place to make a proposal for it with a video
-- attached ... simple easy we can edit it and looks really nice can even put
-- the clients logo (optional)".
--
-- 1. cockpit_upsell_proposals: one row per proposal. The builder saves a
--    draft freely (copy problems never stop a save); sending checks it and
--    freezes what the client sees (the content, the price, the language, the
--    catalog lines it shows and the captures' captions), so a later edit,
--    list change, copy change or caption change never alters a page already
--    sent. "Copy link" is the only way out.
-- 2. cockpit_upsell_views (opens, plays, Yes presses, video opens; never
--    audited, purged after 90 days) and cockpit_upsell_door_status (the
--    door's last good and bad moments, so the card can say "Opens unknown").
-- 3. One shape leaves for a client, PublicProposal, built only by
--    cockpit_upsell_public_json. It never carries the list price, the price
--    reason, ids, emails, the task id, warnings or views.
-- 4. Browser functions run the client gate first. The door's four functions
--    are for the service key only (supabase/functions/upsell-door).
--
-- Tables: row security on, no policies, no browser grants; the service key
-- selects, inserts and updates. Every function is SECURITY DEFINER with
-- search_path ''. Every write to a proposal leaves one audit row (only the
-- keys it changed) through cockpit_upsell_audit (20261026u). The file
-- applies twice without error.
BEGIN;

-- ---------------------------------------------------------------------------
-- Check helpers (IMMUTABLE; the two the table CHECKs call are granted to the
-- service key, the line check to no role)
-- ---------------------------------------------------------------------------

-- A typed line on a client's page: text up to p_max, with no control or
-- direction characters (new lines pass).
CREATE OR REPLACE FUNCTION public.cockpit_upsell_line_ok(p jsonb, p_max integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_typeof(p) = 'string' AND char_length(p #>> '{}') <= p_max
    AND translate(p #>> '{}', E'\n\t', '') !~ E'[[:cntrl:]‪-‮⁦-⁩  ]', false)
$$;

-- ProposalContent v1 (BACKEND.md 3.1): every key, its shape and its caps.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_proposal_content_ok(p jsonb, p_offer text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE ks text[]; e jsonb; seen text[] := '{}'; uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN false; END IF;
  ks := ARRAY(SELECT jsonb_object_keys(p));
  IF NOT (ks @> ARRAY['v','logo','video','found','why','get','platforms','steps','button','showCsm']
          AND ks <@ ARRAY['v','logo','video','found','why','get','platforms','steps','button','showCsm']) THEN RETURN false; END IF;
  IF p->'v' <> '1'::jsonb THEN RETURN false; END IF;
  -- logo: {on, adId}
  IF jsonb_typeof(p->'logo') <> 'object' THEN RETURN false; END IF;
  ks := ARRAY(SELECT jsonb_object_keys(p->'logo'));
  IF NOT (ks @> ARRAY['on','adId'] AND ks <@ ARRAY['on','adId']) OR jsonb_typeof(p->'logo'->'on') <> 'boolean'
     OR NOT (jsonb_typeof(p->'logo'->'adId') = 'null' OR (jsonb_typeof(p->'logo'->'adId') = 'string' AND (p->'logo'->>'adId') ~ uuid_re)) THEN
    RETURN false;
  END IF;
  -- video: {kind: default} or {kind: custom, url, posterUrl, title, checkedAt}
  IF jsonb_typeof(p->'video') <> 'object' THEN RETURN false; END IF;
  ks := ARRAY(SELECT jsonb_object_keys(p->'video'));
  IF p->'video'->>'kind' = 'default' THEN
    IF ks <> ARRAY['kind'] THEN RETURN false; END IF;
  ELSIF p->'video'->>'kind' = 'custom' THEN
    IF NOT (ks @> ARRAY['kind','url','posterUrl','title','checkedAt'] AND ks <@ ARRAY['kind','url','posterUrl','title','checkedAt']) THEN RETURN false; END IF;
    IF jsonb_typeof(p->'video'->'url') <> 'string' THEN RETURN false; END IF;
    BEGIN
      PERFORM public.cockpit_csm_deck_video_parse(p->'video'->>'url');
    EXCEPTION WHEN OTHERS THEN
      RETURN false;
    END;
    IF NOT (jsonb_typeof(p->'video'->'posterUrl') = 'null' OR (jsonb_typeof(p->'video'->'posterUrl') = 'string'
            AND char_length(p->'video'->>'posterUrl') <= 500
            AND (p->'video'->>'posterUrl') ~ '^https://(cdn[.]loom[.]com|embed-ssl[.]wistia[.]com|i[.]vimeocdn[.]com|i[.]ytimg[.]com)/[A-Za-z0-9/_.~%=&?:+-]+$')) THEN
      RETURN false;
    END IF;
    IF NOT (jsonb_typeof(p->'video'->'title') = 'null' OR public.cockpit_upsell_line_ok(p->'video'->'title', 40)) THEN RETURN false; END IF;
    IF jsonb_typeof(p->'video'->'checkedAt') <> 'string' OR (p->'video'->>'checkedAt') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]{5,15}(Z|[+-][0-9:]{4,5})?$' THEN
      RETURN false;
    END IF;
  ELSE
    RETURN false;
  END IF;
  -- found: up to 3 of {fileId, caption}
  IF jsonb_typeof(p->'found') <> 'array' OR jsonb_array_length(p->'found') > 3 THEN RETURN false; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p->'found') LOOP
    IF jsonb_typeof(e) <> 'object' THEN RETURN false; END IF;
    ks := ARRAY(SELECT jsonb_object_keys(e));
    IF NOT (ks @> ARRAY['fileId','caption'] AND ks <@ ARRAY['fileId','caption']) OR jsonb_typeof(e->'fileId') <> 'string'
       OR (e->>'fileId') !~ uuid_re OR (e->>'fileId') = ANY (seen) OR NOT public.cockpit_upsell_line_ok(e->'caption', 120) THEN
      RETURN false;
    END IF;
    seen := seen || (e->>'fileId');
  END LOOP;
  -- why: {trigger, text, edited}
  IF jsonb_typeof(p->'why') <> 'object' THEN RETURN false; END IF;
  ks := ARRAY(SELECT jsonb_object_keys(p->'why'));
  IF NOT (ks @> ARRAY['trigger','text','edited'] AND ks <@ ARRAY['trigger','text','edited'])
     OR NOT (jsonb_typeof(p->'why'->'trigger') = 'null' OR (jsonb_typeof(p->'why'->'trigger') = 'string' AND (p->'why'->>'trigger') ~ '^[a-z0-9_]{1,30}$'))
     OR NOT public.cockpit_upsell_line_ok(p->'why'->'text', 400) OR jsonb_typeof(p->'why'->'edited') <> 'boolean' THEN
    RETURN false;
  END IF;
  -- get: up to 8 of {key, text, hidden, edited}
  IF jsonb_typeof(p->'get') <> 'array' OR jsonb_array_length(p->'get') > 8 THEN RETURN false; END IF;
  seen := '{}';
  FOR e IN SELECT value FROM jsonb_array_elements(p->'get') LOOP
    IF jsonb_typeof(e) <> 'object' THEN RETURN false; END IF;
    ks := ARRAY(SELECT jsonb_object_keys(e));
    IF NOT (ks @> ARRAY['key','text','hidden','edited'] AND ks <@ ARRAY['key','text','hidden','edited'])
       OR jsonb_typeof(e->'key') <> 'string' OR (e->>'key') !~ '^[a-z0-9_]{1,30}$' OR (e->>'key') = ANY (seen)
       OR NOT public.cockpit_upsell_line_ok(e->'text', 200) OR jsonb_typeof(e->'hidden') <> 'boolean' OR jsonb_typeof(e->'edited') <> 'boolean' THEN
      RETURN false;
    END IF;
    seen := seen || (e->>'key');
  END LOOP;
  -- platforms: social media only, Instagram always in
  IF p_offer = 'smm' THEN
    IF jsonb_typeof(p->'platforms') <> 'array' OR NOT (p->'platforms' @> '["instagram"]'::jsonb)
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p->'platforms') x WHERE jsonb_typeof(x) <> 'string'
                    OR (x #>> '{}') NOT IN ('instagram','tiktok','snapchat','facebook'))
       OR (SELECT count(*) FROM jsonb_array_elements_text(p->'platforms')) <> (SELECT count(DISTINCT x) FROM jsonb_array_elements_text(p->'platforms') x) THEN
      RETURN false;
    END IF;
  ELSIF jsonb_typeof(p->'platforms') <> 'null' THEN
    RETURN false;
  END IF;
  -- steps and button: {text, edited}
  FOR e IN SELECT x FROM (VALUES (p->'steps'), (p->'button')) v(x) LOOP
    IF jsonb_typeof(e) <> 'object' THEN RETURN false; END IF;
    ks := ARRAY(SELECT jsonb_object_keys(e));
    IF NOT (ks @> ARRAY['text','edited'] AND ks <@ ARRAY['text','edited']) OR jsonb_typeof(e->'edited') <> 'boolean' THEN RETURN false; END IF;
  END LOOP;
  IF NOT public.cockpit_upsell_line_ok(p->'steps'->'text', 400) OR NOT public.cockpit_upsell_line_ok(p->'button'->'text', 40) THEN RETURN false; END IF;
  IF jsonb_typeof(p->'showCsm') <> 'boolean' THEN RETURN false; END IF;
  RETURN true;
END $$;

-- A proposal's price: {parts: {partKey: dollars}, split: boolean}.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_price_ok(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_typeof(p) = 'object'
    AND (SELECT count(*) FROM jsonb_object_keys(p)) = 2 AND p ? 'parts' AND p ? 'split'
    AND jsonb_typeof(p->'parts') = 'object' AND jsonb_typeof(p->'split') = 'boolean'
    AND NOT EXISTS (SELECT 1 FROM jsonb_each(p->'parts') x WHERE x.key !~ '^[a-z_]{2,20}$' OR NOT public.cockpit_upsell_usd_ok(x.value)), false)
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cockpit_upsell_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE,
  task_id text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  client_name text NOT NULL CHECK (btrim(client_name) <> ''),
  offer_key text NOT NULL REFERENCES public.cockpit_upsell_catalog(offer_key),
  lang text NOT NULL CHECK (lang IN ('en','ar')),
  content jsonb NOT NULL CHECK (octet_length(content::text) <= 65536),
  price jsonb NOT NULL DEFAULT '{"parts":{},"split":false}'::jsonb,
  price_reason text CHECK (char_length(price_reason) BETWEEN 1 AND 140),
  list_price jsonb NOT NULL CHECK (jsonb_typeof(list_price) = 'object'),
  valid_until date NOT NULL,
  code text UNIQUE CHECK (code ~ '^[a-hj-km-np-z2-9]{12}$'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','link_copied','accepted','not_now','archived')),
  sent_content jsonb CHECK (sent_content IS NULL OR octet_length(sent_content::text) <= 131072),
  sent_price jsonb,
  sent_list_price jsonb,
  sent_lang text CHECK (sent_lang IN ('en','ar')),
  sent_rev integer,
  sent_at timestamptz,
  sent_by text,
  updated_after_send boolean NOT NULL DEFAULT false,
  objection text CHECK (char_length(objection) BETWEEN 1 AND 200),
  follow_up_on date,
  warnings_passed text[] NOT NULL DEFAULT '{}',
  preview_hash text CHECK (preview_hash ~ '^[0-9a-f]{64}$'),
  preview_until timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL CHECK (btrim(created_by) <> ''),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (btrim(updated_by) <> ''),
  CONSTRAINT cockpit_upsell_proposals_content CHECK (public.cockpit_upsell_proposal_content_ok(content, offer_key)),
  CONSTRAINT cockpit_upsell_proposals_price CHECK (public.cockpit_upsell_price_ok(price)),
  -- Sent once means sent for good: the code, the frozen copy and the time together.
  CONSTRAINT cockpit_upsell_proposals_sent CHECK (
    (sent_at IS NULL) = (code IS NULL) AND (sent_at IS NULL) = (sent_content IS NULL) AND (sent_at IS NULL) = (sent_price IS NULL)
    AND (sent_at IS NULL) = (sent_lang IS NULL) AND (sent_at IS NULL) = (sent_by IS NULL)),
  CONSTRAINT cockpit_upsell_proposals_status CHECK (status IN ('draft','archived') OR sent_at IS NOT NULL),
  CONSTRAINT cockpit_upsell_proposals_draft CHECK (status <> 'draft' OR sent_at IS NULL),
  CONSTRAINT cockpit_upsell_proposals_not_now CHECK (status <> 'not_now' OR (objection IS NOT NULL AND follow_up_on IS NOT NULL)),
  CONSTRAINT cockpit_upsell_proposals_preview CHECK ((preview_hash IS NULL) = (preview_until IS NULL))
);
CREATE INDEX IF NOT EXISTS cockpit_upsell_proposals_task_idx ON public.cockpit_upsell_proposals (task_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS cockpit_upsell_proposals_sent_idx ON public.cockpit_upsell_proposals (task_id, sent_at DESC) WHERE sent_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.cockpit_upsell_views (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  proposal_id uuid REFERENCES public.cockpit_upsell_proposals(id),
  pitch_id uuid REFERENCES public.cockpit_upsell_pitches(id),
  kind text NOT NULL CHECK (kind IN ('open','play','cta','video')),
  at timestamptz NOT NULL DEFAULT now(),
  device text CHECK (device ~ '^[A-Za-z0-9_-]{8,64}$'),
  ip_hash text CHECK (ip_hash ~ '^[0-9a-f]{64}$'),
  device_kind text CHECK (device_kind IN ('phone','tablet','computer')),
  CONSTRAINT cockpit_upsell_views_one CHECK (num_nonnulls(proposal_id, pitch_id) = 1),
  CONSTRAINT cockpit_upsell_views_kind CHECK ((kind = 'video') = (pitch_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS cockpit_upsell_views_proposal_idx ON public.cockpit_upsell_views (proposal_id, at) WHERE proposal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cockpit_upsell_views_pitch_idx ON public.cockpit_upsell_views (pitch_id, at) WHERE pitch_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.cockpit_upsell_door_status (
  route text PRIMARY KEY CHECK (route IN ('p','event','v')),
  last_ok_at timestamptz,
  last_error_at timestamptz,
  sentence text CHECK (char_length(sentence) <= 200)
);

ALTER TABLE public.cockpit_upsell_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_upsell_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_upsell_door_status ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_upsell_proposals, public.cockpit_upsell_views, public.cockpit_upsell_door_status
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.cockpit_upsell_proposals, public.cockpit_upsell_views, public.cockpit_upsell_door_status
  TO service_role;
REVOKE ALL ON SEQUENCE public.cockpit_upsell_views_id_seq FROM PUBLIC, anon, authenticated;

-- Proposals are audited; views and the door's status are not.
DROP TRIGGER IF EXISTS cockpit_upsell_proposals_audit ON public.cockpit_upsell_proposals;
CREATE TRIGGER cockpit_upsell_proposals_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_upsell_proposals
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_upsell_audit();

-- ---------------------------------------------------------------------------
-- Internal helpers (no grant to any role)
-- ---------------------------------------------------------------------------

-- RFC 3986 percent-encoding of UTF-8 (everything but A-Z a-z 0-9 - . _ ~).
CREATE OR REPLACE FUNCTION public.cockpit_upsell_urlencode(p text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE b bytea := convert_to(coalesce(p, ''), 'UTF8'); out text := ''; i integer; x integer;
BEGIN
  FOR i IN 0..length(b) - 1 LOOP
    x := get_byte(b, i);
    IF x BETWEEN 48 AND 57 OR x BETWEEN 65 AND 90 OR x BETWEEN 97 AND 122 OR x IN (45, 46, 95, 126) THEN
      out := out || chr(x);
    ELSE
      out := out || '%' || upper(lpad(to_hex(x), 2, '0'));
    END IF;
  END LOOP;
  RETURN out;
END $$;

-- A seat's first name for the client's page (never an address): the seat's
-- own name, else the team list's.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_first_name(p_email text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN x.first = lower(x.first) THEN initcap(x.first) ELSE x.first END
    FROM (SELECT nullif(split_part(btrim(coalesce(
            (SELECT CASE WHEN m.name LIKE '%@%' THEN NULL ELSE nullif(btrim(m.name), '') END
               FROM public.cockpit_members m WHERE m.email = lower(btrim(p_email)) ORDER BY m.active DESC LIMIT 1),
            (SELECT p.name FROM public.cockpit_people p
              WHERE lower(p.email) = lower(btrim(p_email)) AND p.name NOT LIKE '%@%' AND btrim(p.name) <> ''
              ORDER BY p.active DESC NULLS LAST LIMIT 1),
            '')), ' ', 1), '') AS first) x
$$;

-- The offer's own video in a language (or for any language), as the page plays it.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_offer_video(p_offer text, p_lang text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('provider', v.provider, 'url', v.url, 'embedUrl', v.embed_url, 'posterUrl', v.poster_url, 'title', v.title)
    FROM public.cockpit_csm_deck_videos v
   WHERE v.deck = 'offer_' || p_offer AND v.slot_key = 'demo' AND v.lang IN (p_lang, 'any') AND v.url IS NOT NULL
   ORDER BY (v.lang = p_lang) DESC LIMIT 1
$$;

-- The catalog's steps in one language as a new proposal joins them: whole
-- steps only, one a line, within the 400 characters the page keeps.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_copy_steps(p_copy jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v text := ''; e jsonb;
BEGIN
  FOR e IN SELECT value FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_copy->'steps') = 'array' THEN p_copy->'steps' ELSE '[]'::jsonb END) LOOP
    EXIT WHEN char_length(v) + char_length(e->>'text') + 1 > 400;
    v := v || CASE WHEN v = '' THEN '' ELSE E'\n' END || (e->>'text');
  END LOOP;
  RETURN v;
END $$;

-- A draft switched to the other language: every line that is still the old
-- language's catalog text (why by its trigger, each get line by its key, the
-- joined steps, the button) becomes the new language's catalog text for the
-- same key. Typed lines stay as typed; the send check names any line left in
-- the old language (wrong_language).
CREATE OR REPLACE FUNCTION public.cockpit_upsell_content_relang(p_content jsonb, p_from jsonb, p_to jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v jsonb := p_content; t text; n text; o_steps text; n_steps text;
  o_why jsonb; n_why jsonb; o_get jsonb; n_get jsonb;
BEGIN
  IF jsonb_typeof(p_content) <> 'object' OR jsonb_typeof(p_from) <> 'object' OR jsonb_typeof(p_to) <> 'object' THEN
    RETURN p_content;
  END IF;
  o_why := CASE WHEN jsonb_typeof(p_from->'why') = 'array' THEN p_from->'why' ELSE '[]'::jsonb END;
  n_why := CASE WHEN jsonb_typeof(p_to->'why') = 'array' THEN p_to->'why' ELSE '[]'::jsonb END;
  o_get := CASE WHEN jsonb_typeof(p_from->'get') = 'array' THEN p_from->'get' ELSE '[]'::jsonb END;
  n_get := CASE WHEN jsonb_typeof(p_to->'get') = 'array' THEN p_to->'get' ELSE '[]'::jsonb END;
  -- Why this, for you.
  IF jsonb_typeof(v->'why') = 'object' THEN
    t := btrim(coalesce(v->'why'->>'text', ''));
    IF t <> '' AND t = (SELECT btrim(k->>'text') FROM jsonb_array_elements(o_why) k WHERE k->>'key' = v->'why'->>'trigger' LIMIT 1) THEN
      n := (SELECT k->>'text' FROM jsonb_array_elements(n_why) k WHERE k->>'key' = v->'why'->>'trigger' LIMIT 1);
      IF n IS NOT NULL THEN v := jsonb_set(v, '{why,text}', to_jsonb(n)); END IF;
    END IF;
  END IF;
  -- What you get, line by line.
  IF jsonb_typeof(v->'get') = 'array' THEN
    v := jsonb_set(v, '{get}', (
      SELECT coalesce(jsonb_agg(CASE
               WHEN btrim(coalesce(g->>'text', '')) <> ''
                AND btrim(coalesce(g->>'text', '')) = (SELECT btrim(k->>'text') FROM jsonb_array_elements(o_get) k WHERE k->>'key' = g->>'key' LIMIT 1)
                AND EXISTS (SELECT 1 FROM jsonb_array_elements(n_get) k WHERE k->>'key' = g->>'key')
               THEN jsonb_set(g, '{text}', (SELECT k->'text' FROM jsonb_array_elements(n_get) k WHERE k->>'key' = g->>'key' LIMIT 1))
               ELSE g END ORDER BY i), '[]'::jsonb)
        FROM jsonb_array_elements(v->'get') WITH ORDINALITY y(g, i)));
  END IF;
  -- How it runs, joined as a new proposal joins it.
  o_steps := btrim(public.cockpit_upsell_copy_steps(p_from));
  n_steps := public.cockpit_upsell_copy_steps(p_to);
  IF jsonb_typeof(v->'steps') = 'object' AND o_steps <> '' AND n_steps <> ''
     AND btrim(coalesce(v->'steps'->>'text', '')) = o_steps THEN
    v := jsonb_set(v, '{steps,text}', to_jsonb(n_steps));
  END IF;
  -- The button.
  IF jsonb_typeof(v->'button') = 'object' AND p_from->>'button' IS NOT NULL AND p_to->>'button' IS NOT NULL
     AND btrim(coalesce(v->'button'->>'text', '')) = btrim(p_from->>'button') THEN
    v := jsonb_set(v, '{button,text}', to_jsonb(p_to->>'button'));
  END IF;
  RETURN v;
END $$;

-- What we found, as the page shows it: each picked capture that is still a
-- ready capture of this client, with its caption (the typed one, else the
-- file's own), its day and what it was searched as.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_found_live(p_task_id text, p_found jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('fileId', f.id, 'path', f.storage_path,
           'caption', coalesce(nullif(btrim(x->>'caption'), ''), f.caption, ''), 'capturedOn', to_jsonb(f.captured_on),
           'searchedAs', f.searched_as) ORDER BY i), '[]'::jsonb)
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_found) = 'array' THEN p_found ELSE '[]'::jsonb END) WITH ORDINALITY y(x, i)
    JOIN public.cockpit_upsell_files f ON f.id = (x->>'fileId')::uuid AND f.task_id = p_task_id AND f.status = 'ready'
$$;

-- What the sent page keeps from the catalog and the settings at the moment
-- it is sent: the title, the bill's line names and cadences, the terms, the
-- timing, the validity date, the work list, the split, the video, the presenter's first name,
-- the Yes button's message, and what we found with its captions. The door
-- builds the page from these, never from the live catalog or the live
-- captures. The logo stays live: it is the client's own picture, carries no
-- words, and a frozen path could name a file since replaced or deleted.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_frozen(p_row public.cockpit_upsell_proposals, p_by text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.cockpit_upsell_catalog; cp jsonb; v jsonb; vid jsonb;
BEGIN
  SELECT * INTO c FROM public.cockpit_upsell_catalog x WHERE x.offer_key = p_row.offer_key;
  cp := coalesce(c.copy->p_row.lang, '{}'::jsonb);
  v := p_row.content->'video';
  IF v->>'kind' = 'custom' THEN
    vid := public.cockpit_csm_deck_video_parse(v->>'url');
    vid := jsonb_build_object('provider', vid->'provider', 'embedUrl', vid->'embedUrl', 'posterUrl', v->'posterUrl', 'title', v->'title');
  ELSE
    vid := public.cockpit_upsell_offer_video(p_row.offer_key, p_row.lang) - 'url';
  END IF;
  RETURN jsonb_build_object(
    'title', coalesce(cp->>'deckTitle', public.cockpit_upsell_offer_name(p_row.offer_key)),
    'parts', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', x->>'key', 'label', coalesce(cp->'parts'->>(x->>'key'), replace(x->>'key', '_', ' ')),
                                                           'cadence', x->>'cadence') ORDER BY i), '[]'::jsonb)
                FROM jsonb_array_elements(c.parts) WITH ORDINALITY y(x, i)),
    'terms', cp->>'terms', 'timing', cp->>'timing',
    'validUntil', to_char(p_row.valid_until, 'YYYY-MM-DD'),
    'work', (SELECT coalesce(jsonb_agg(jsonb_build_object('label', w->>'label', 'url', w->>'url') ORDER BY i), '[]'::jsonb)
               FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cp->'work') = 'array' THEN cp->'work' ELSE '[]'::jsonb END) WITH ORDINALITY z(w, i)),
    'split', CASE WHEN c.split_allowed THEN c.split_parts END,
    'video', vid,
    'csmFirstName', public.cockpit_upsell_first_name(p_by),
    'cta', cp->>'cta',
    'found', public.cockpit_upsell_found_live(p_row.task_id, p_row.content->'found'));
END $$;

-- PublicProposal: the only shape that leaves the server for a client, for
-- the door (from the frozen copy) and for the preview (from the draft as
-- typed). Storage paths come back in *.path; the caller signs them.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_public_json(p_row public.cockpit_upsell_proposals, p_content jsonb, p_price jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  fz jsonb; v_logo jsonb; v_found jsonb; v_parts jsonb; v_number text; v_cta text; v_split jsonb;
BEGIN
  fz := coalesce(p_content->'frozen', public.cockpit_upsell_frozen(p_row, coalesce(p_row.sent_by, p_row.created_by)));
  IF p_content->'logo'->'on' = 'true'::jsonb THEN
    IF jsonb_typeof(p_content->'logo'->'adId') = 'string' THEN
      SELECT jsonb_build_object('bucket', 'cockpit-launch-ads', 'path', a.storage_path, 'alt', p_row.client_name) INTO v_logo
        FROM public.cockpit_csm_launch_ads a
       WHERE a.id = (p_content->'logo'->>'adId')::uuid AND a.task_id = p_row.task_id AND a.status = 'ready' AND a.kind = 'logo';
    ELSE
      SELECT jsonb_build_object('bucket', 'cockpit-client-logos', 'path', l.storage_path, 'alt', p_row.client_name) INTO v_logo
        FROM public.cockpit_client_logos l WHERE l.clickup_task_id = p_row.task_id ORDER BY l.verified_at DESC LIMIT 1;
    END IF;
  END IF;
  IF jsonb_typeof(p_content->'frozen'->'found') = 'array' THEN
    -- Sent: the captions as they were checked and frozen; the live row only
    -- drops a capture removed since.
    SELECT coalesce(jsonb_agg(jsonb_build_object('bucket', 'cockpit-upsell-files', 'path', f.storage_path,
             'caption', x->'caption', 'capturedOn', x->'capturedOn', 'searchedAs', x->'searchedAs') ORDER BY i), '[]'::jsonb)
      INTO v_found
      FROM jsonb_array_elements(p_content->'frozen'->'found') WITH ORDINALITY y(x, i)
      JOIN public.cockpit_upsell_files f ON f.id = (x->>'fileId')::uuid AND f.task_id = p_row.task_id AND f.status = 'ready';
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object('bucket', 'cockpit-upsell-files', 'path', x->'path',
             'caption', x->'caption', 'capturedOn', x->'capturedOn', 'searchedAs', x->'searchedAs') ORDER BY i), '[]'::jsonb)
      INTO v_found
      FROM jsonb_array_elements(public.cockpit_upsell_found_live(p_row.task_id, p_content->'found')) WITH ORDINALITY y(x, i);
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('label', x->>'label', 'amountUsd', p_price->'parts'->(x->>'key'), 'cadence', x->>'cadence') ORDER BY i), '[]'::jsonb)
    INTO v_parts
    FROM jsonb_array_elements(coalesce(fz->'parts', '[]'::jsonb)) WITH ORDINALITY y(x, i)
   WHERE jsonb_typeof(p_price->'parts'->(x->>'key')) = 'number';
  v_split := CASE WHEN p_price->'split' = 'true'::jsonb AND jsonb_typeof(fz->'split') = 'array' THEN fz->'split' END;
  v_number := public.cockpit_upsell_settings_json()->>'whatsappNumber';
  v_cta := nullif(btrim(coalesce(fz->>'cta', '')), '');
  RETURN jsonb_build_object(
    'lang', p_row.lang, 'offer', p_row.offer_key, 'title', fz->>'title', 'clientName', p_row.client_name,
    'logo', v_logo,
    'csmFirstName', CASE WHEN p_content->'showCsm' = 'true'::jsonb THEN fz->>'csmFirstName' END,
    'date', to_char(public.cockpit_upsell_kday(coalesce(p_row.sent_at, now())), 'YYYY-MM-DD'),
    'validUntil', coalesce(fz->>'validUntil', to_char(p_row.valid_until, 'YYYY-MM-DD')),
    'video', CASE WHEN jsonb_typeof(fz->'video') = 'object' THEN fz->'video' END,
    'found', v_found,
    'why', nullif(btrim(coalesce(p_content->'why'->>'text', '')), ''),
    'get', (SELECT coalesce(jsonb_agg(btrim(x->>'text') ORDER BY i), '[]'::jsonb)
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_content->'get') = 'array' THEN p_content->'get' ELSE '[]'::jsonb END) WITH ORDINALITY y(x, i)
             WHERE x->'hidden' IS DISTINCT FROM 'true'::jsonb AND btrim(coalesce(x->>'text', '')) <> ''),
    'platforms', CASE WHEN jsonb_typeof(p_content->'platforms') = 'array' THEN p_content->'platforms' END,
    'work', coalesce(fz->'work', '[]'::jsonb),
    'steps', nullif(btrim(coalesce(p_content->'steps'->>'text', '')), ''),
    'timing', fz->>'timing',
    'investment', jsonb_build_object('parts', v_parts, 'terms', fz->>'terms', 'split', v_split),
    'button', jsonb_build_object('text', btrim(coalesce(p_content->'button'->>'text', '')),
      'whatsapp', CASE WHEN v_number IS NOT NULL THEN 'https://wa.me/' || v_number
                                                     || CASE WHEN v_cta IS NOT NULL THEN '?text=' || public.cockpit_upsell_urlencode(v_cta) ELSE '' END END));
END $$;

-- The builder's full row.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_proposal_json(r public.cockpit_upsell_proposals) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', r.id, 'requestId', r.request_id, 'taskId', r.task_id, 'clientName', r.client_name, 'offerKey', r.offer_key, 'lang', r.lang,
    'content', r.content, 'price', r.price, 'priceReason', r.price_reason, 'listPrice', r.list_price,
    'validUntil', to_jsonb(r.valid_until), 'code', r.code,
    'url', CASE WHEN r.code IS NOT NULL THEN 'https://offer.maharamedia.com/' || r.code END,
    'status', r.status, 'expired', r.sent_at IS NOT NULL AND r.status <> 'archived' AND coalesce((r.sent_content#>>'{frozen,validUntil}')::date, r.valid_until) < public.cockpit_upsell_today(),
    'sentContent', r.sent_content, 'sentPrice', r.sent_price, 'sentListPrice', r.sent_list_price, 'sentLang', r.sent_lang,
    'sentRev', r.sent_rev, 'sentAt', to_jsonb(r.sent_at), 'sentBy', r.sent_by, 'updatedAfterSend', r.updated_after_send,
    'objection', r.objection, 'followUpOn', to_jsonb(r.follow_up_on), 'warningsPassed', to_jsonb(r.warnings_passed),
    'revision', r.revision, 'createdAt', to_jsonb(r.created_at), 'createdBy', r.created_by,
    'updatedAt', to_jsonb(r.updated_at), 'updatedBy', r.updated_by)
$$;

-- The gate's failing reasons, as the builder's warnings. A recent offer of
-- this same offer (its own pitch or this proposal) is the same talk, not a
-- warning (cockpit_upsell_gate_reasons, the deck's rule too).
CREATE OR REPLACE FUNCTION public.cockpit_upsell_proposal_warnings(p_task_id text, p_offer text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('key', r->'key', 'text', r->'text') ORDER BY i), '[]'::jsonb)
            FROM jsonb_array_elements(public.cockpit_upsell_gate_reasons(public.cockpit_csm_offer_gate(p_task_id), p_offer))
                 WITH ORDINALITY z(r, i));
END $$;

-- Every problem with a proposal, in the order the CEO's contract lists them:
-- [{field, rule, text, block}]. Copy problems are checked on every line that
-- is not the catalog's own text in the proposal's language (the server works
-- that out; the browser's "edited" flag is never trusted), on what we found
-- (the caption the page shows and what it was searched as) and on a custom
-- video's title. A shown line that is still the other language's catalog
-- text is a blocking wrong_language problem, so a page never goes out half
-- in English and half in Arabic. With p_send, also what stops a send: no
-- video in that language, an unpriced part, a locked price off its list,
-- below list with no reason, a split without full price held, a past date,
-- an empty page, and a gate warning not ticked.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_proposal_problems(r public.cockpit_upsell_proposals, p_ack text[], p_send boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  out jsonb := '[]'::jsonb; c public.cockpit_upsell_catalog; x record; p jsonb; e jsonb; i integer; v_list jsonb; v_price numeric; v_lang text;
  cp jsonb; op jsonb; v_other text; t text;
BEGIN
  SELECT * INTO c FROM public.cockpit_upsell_catalog o WHERE o.offer_key = r.offer_key;
  v_lang := CASE r.lang WHEN 'ar' THEN 'Arabic' ELSE 'English' END;
  v_other := CASE r.lang WHEN 'ar' THEN 'English' ELSE 'Arabic' END;
  cp := coalesce(c.copy->r.lang, '{}'::jsonb);
  op := coalesce(c.copy->(CASE r.lang WHEN 'ar' THEN 'en' ELSE 'ar' END), '{}'::jsonb);
  IF p_send AND r.content->'video'->>'kind' = 'default' AND public.cockpit_upsell_offer_video(r.offer_key, r.lang) IS NULL THEN
    out := out || jsonb_build_array(jsonb_build_object('field', 'video', 'rule', 'no_video', 'block', true,
      'text', format('This offer has no %s video yet. The CEO saves it on Money > Offers, or paste a custom video.', v_lang)));
  END IF;
  -- Every shown line, with the catalog's own text for its key in this
  -- language (mine) and in the other one (other), trimmed as the page shows
  -- them. What we found and a custom video's title have no catalog text.
  FOR x IN
    SELECT 'why' AS field, 'Why this, for you' AS label, r.content->'why'->>'text' AS txt,
           (SELECT btrim(k->>'text') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cp->'why') = 'array' THEN cp->'why' ELSE '[]'::jsonb END) k
             WHERE k->>'key' = r.content->'why'->>'trigger' LIMIT 1) AS mine,
           (SELECT btrim(k->>'text') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(op->'why') = 'array' THEN op->'why' ELSE '[]'::jsonb END) k
             WHERE k->>'key' = r.content->'why'->>'trigger' LIMIT 1) AS other
    UNION ALL
    SELECT 'get.' || n, 'What you get, line ' || n, g->>'text',
           (SELECT btrim(k->>'text') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cp->'get') = 'array' THEN cp->'get' ELSE '[]'::jsonb END) k
             WHERE k->>'key' = g->>'key' LIMIT 1),
           (SELECT btrim(k->>'text') FROM jsonb_array_elements(CASE WHEN jsonb_typeof(op->'get') = 'array' THEN op->'get' ELSE '[]'::jsonb END) k
             WHERE k->>'key' = g->>'key' LIMIT 1)
      FROM jsonb_array_elements(r.content->'get') WITH ORDINALITY y(g, n)
     WHERE g->'hidden' IS DISTINCT FROM 'true'::jsonb
    UNION ALL
    SELECT 'steps', 'How it runs', r.content->'steps'->>'text',
           nullif(btrim(public.cockpit_upsell_copy_steps(cp)), ''), nullif(btrim(public.cockpit_upsell_copy_steps(op)), '')
    UNION ALL
    SELECT 'button', 'The button', r.content->'button'->>'text', btrim(cp->>'button'), btrim(op->>'button')
    UNION ALL
    SELECT 'found.' || n, 'What we found, picture ' || n, f->>'caption', NULL, NULL
      FROM jsonb_array_elements(public.cockpit_upsell_found_live(r.task_id, r.content->'found')) WITH ORDINALITY y(f, n)
    UNION ALL
    SELECT 'found.' || n || '.searchedAs', 'What we found, picture ' || n || ', searched as', f->>'searchedAs', NULL, NULL
      FROM jsonb_array_elements(public.cockpit_upsell_found_live(r.task_id, r.content->'found')) WITH ORDINALITY y(f, n)
    UNION ALL
    SELECT 'video.title', 'The video title', r.content->'video'->>'title', NULL, NULL WHERE r.content->'video'->>'kind' = 'custom'
  LOOP
    t := btrim(coalesce(x.txt, ''));
    -- The catalog's own line in this language is not checked again.
    CONTINUE WHEN t IS NOT DISTINCT FROM x.mine;
    -- The other language's catalog line, left behind by a language switch.
    IF t <> '' AND t = x.other THEN
      out := out || jsonb_build_array(jsonb_build_object('field', x.field, 'rule', 'wrong_language', 'block', true,
        'text', format('%s: still in %s. Write it in %s.', x.label, v_other, v_lang)));
    END IF;
    FOR p IN SELECT value FROM jsonb_array_elements(public.cockpit_client_copy_problems(x.txt, false)) LOOP
      out := out || jsonb_build_array(jsonb_build_object('field', x.field, 'rule', p->'rule', 'block', p->'block',
        'text', format('%s: %s ("%s")', x.label, p->>'why', p->>'match')));
    END LOOP;
  END LOOP;
  IF NOT p_send THEN RETURN out; END IF;

  v_list := public.cockpit_upsell_list_of(c.parts);
  -- Every part priced.
  FOR e IN SELECT value FROM jsonb_array_elements(c.parts) LOOP
    IF jsonb_typeof(r.price->'parts'->(e->>'key')) <> 'number' OR (r.price->'parts'->(e->>'key')) IS NULL THEN
      out := out || jsonb_build_array(jsonb_build_object('field', 'price', 'rule', 'no_price', 'block', true,
        'text', format('Type a price for the %s.', public.cockpit_upsell_part_name(r.offer_key, e->>'key', true))));
    END IF;
  END LOOP;
  -- Below list needs a reason; a locked price is its list.
  FOR e IN SELECT value FROM jsonb_array_elements(c.parts) LOOP
    v_price := (r.price->'parts'->>(e->>'key'))::numeric;
    IF jsonb_typeof(e->'amount') = 'number' AND v_price < (e->>'amount')::numeric AND r.price_reason IS NULL AND NOT c.locked THEN
      out := out || jsonb_build_array(jsonb_build_object('field', 'price', 'rule', 'below_list', 'block', true,
        'text', format('%s: below the list price (%s). Add a one-line reason.', public.cockpit_upsell_part_name(r.offer_key, e->>'key'),
                       public.cockpit_upsell_money((e->>'amount')::numeric))));
    END IF;
  END LOOP;
  IF c.locked THEN
    IF EXISTS (SELECT 1 FROM jsonb_each(v_list) l WHERE jsonb_typeof(l.value) = 'null') THEN
      out := out || jsonb_build_array(jsonb_build_object('field', 'price', 'rule', 'locked', 'block', true,
        'text', 'This price is locked. The CEO sets it on Money > Offers.'));
    ELSIF EXISTS (SELECT 1 FROM jsonb_each(v_list) l WHERE (r.price->'parts'->>l.key)::numeric IS DISTINCT FROM (l.value #>> '{}')::numeric) THEN
      out := out || jsonb_build_array(jsonb_build_object('field', 'price', 'rule', 'locked', 'block', true,
        'text', format('This price is locked at the list price (%s).', public.cockpit_upsell_price_text(c.parts, v_list))));
    END IF;
  END IF;
  IF r.price->'split' = 'true'::jsonb THEN
    IF NOT c.split_allowed THEN
      out := out || jsonb_build_array(jsonb_build_object('field', 'price', 'rule', 'split', 'block', true, 'text', 'This offer has no split.'));
    ELSIF NOT public.cockpit_upsell_held_full(r.task_id, r.offer_key) THEN
      out := out || jsonb_build_array(jsonb_build_object('field', 'price', 'rule', 'split', 'block', true,
        'text', 'The split shows only after full price was held: on a call, or in a proposal sent at full price, in the last 60 days.'));
    END IF;
  END IF;
  IF r.valid_until < public.cockpit_upsell_today() THEN
    out := out || jsonb_build_array(jsonb_build_object('field', 'valid_until', 'rule', 'expired', 'block', true,
      'text', '"Valid until" has passed. Pick a new date.'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r.content->'get') g
                  WHERE g->'hidden' IS DISTINCT FROM 'true'::jsonb AND btrim(coalesce(g->>'text', '')) <> '') THEN
    out := out || jsonb_build_array(jsonb_build_object('field', 'get', 'rule', 'empty', 'block', true,
      'text', 'Show at least one line under What you get.'));
  END IF;
  IF btrim(coalesce(r.content->'button'->>'text', '')) = '' THEN
    out := out || jsonb_build_array(jsonb_build_object('field', 'button', 'rule', 'empty', 'block', true,
      'text', 'Type the words on the button.'));
  END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(public.cockpit_upsell_proposal_warnings(r.task_id, r.offer_key)) LOOP
    IF NOT coalesce((e->>'key') = ANY (coalesce(p_ack, '{}')), false) THEN
      out := out || jsonb_build_array(jsonb_build_object('field', 'warnings', 'rule', e->'key', 'block', true,
        'text', 'Tick the warning first: ' || (e->>'text')));
    END IF;
  END LOOP;
  RETURN out;
END $$;

-- The task-level checks a draft's content passes on save: its captures and
-- logo are this client's, its lines are the offer's.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_proposal_content_check(p_task_id text, p_offer text, p jsonb) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE c public.cockpit_upsell_catalog; e jsonb;
BEGIN
  IF NOT public.cockpit_upsell_proposal_content_ok(p, p_offer) THEN
    RAISE EXCEPTION 'The proposal''s content is not in the shape the page reads. Reload the builder.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO c FROM public.cockpit_upsell_catalog x WHERE x.offer_key = p_offer;
  FOR e IN SELECT value FROM jsonb_array_elements(p->'found') LOOP
    IF NOT EXISTS (SELECT 1 FROM public.cockpit_upsell_files f WHERE f.id = (e->>'fileId')::uuid AND f.task_id = p_task_id
                     AND f.status = 'ready' AND f.kind = 'capture') THEN
      RAISE EXCEPTION 'Pick one of this client''s own captures.' USING ERRCODE = '22023';
    END IF;
  END LOOP;
  IF jsonb_typeof(p->'logo'->'adId') = 'string' AND NOT EXISTS (
       SELECT 1 FROM public.cockpit_csm_launch_ads a WHERE a.id = (p->'logo'->>'adId')::uuid AND a.task_id = p_task_id
          AND a.status = 'ready' AND a.kind = 'logo') THEN
    RAISE EXCEPTION 'Pick one of this client''s own logos.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p->'get') g
              WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(c.copy->'en'->'get', '[]'::jsonb)) k WHERE k->>'key' = g->>'key')) THEN
    RAISE EXCEPTION 'What you get has a line this offer does not have. Reload the builder.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p->'why'->'trigger') = 'string' AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(coalesce(c.copy->'en'->'why', '[]'::jsonb)) k WHERE k->>'key' = p->'why'->>'trigger') THEN
    RAISE EXCEPTION '"Why this, for you" names a reason this offer does not have. Reload the builder.' USING ERRCODE = '22023';
  END IF;
END $$;

-- Send and update link share one freeze: the checks, then the frozen copy.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_proposal_freeze(p_id uuid, p_base_revision integer, p_ack text[], p_update boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r public.cockpit_upsell_proposals; g jsonb; v_problems jsonb; v_block jsonb; v_who text; v_code text; v_list jsonb; c public.cockpit_upsell_catalog;
  v_warn text[]; v_line text; i integer;
BEGIN
  SELECT * INTO r FROM public.cockpit_upsell_proposals x WHERE x.id = p_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'That proposal is not one you can open.' USING ERRCODE = '42501'; END IF;
  g := public.cockpit_csm_client_gate(r.task_id);
  IF p_base_revision IS NULL OR p_base_revision <> r.revision THEN
    RAISE EXCEPTION 'Someone else saved this. Read it again.' USING ERRCODE = '40001';
  END IF;
  IF r.status = 'archived' THEN RAISE EXCEPTION 'This proposal is archived. Make a new one.' USING ERRCODE = '22023'; END IF;
  IF p_update AND r.code IS NULL THEN RAISE EXCEPTION 'Copy the link once first.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO c FROM public.cockpit_upsell_catalog x WHERE x.offer_key = r.offer_key;
  v_list := public.cockpit_upsell_list_of(c.parts);
  r.list_price := v_list;
  v_problems := public.cockpit_upsell_proposal_problems(r, p_ack, true);
  SELECT coalesce(jsonb_agg(p), '[]'::jsonb) INTO v_block FROM jsonb_array_elements(v_problems) p WHERE p->'block' = 'true'::jsonb;
  IF jsonb_array_length(v_block) > 0 THEN
    RAISE EXCEPTION '%', v_block->0->>'text' USING ERRCODE = '22023', DETAIL = v_block::text;
  END IF;
  v_who := g->>'email';
  v_code := r.code;
  IF v_code IS NULL THEN
    FOR i IN 1..5 LOOP
      v_code := public.cockpit_upsell_code(12);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.cockpit_upsell_proposals x WHERE x.code = v_code);
    END LOOP;
  END IF;
  v_warn := ARRAY(SELECT e->>'key' FROM jsonb_array_elements(public.cockpit_upsell_proposal_warnings(r.task_id, r.offer_key)) e);
  -- The CEO card's sentence: plain words, never a raw gate key, and no
  -- "blank + blank" while the list is still unset.
  v_line := format('Proposal for %s %s at %s %s', public.cockpit_upsell_offer_name(r.offer_key),
    CASE WHEN p_update THEN 'updated' ELSE 'sent' END, public.cockpit_upsell_price_text(c.parts, r.price->'parts'),
    CASE WHEN EXISTS (SELECT 1 FROM jsonb_each(v_list) l WHERE jsonb_typeof(l.value) = 'number')
         THEN format('(list %s)', public.cockpit_upsell_price_text(c.parts, v_list)) ELSE '(no list price yet)' END)
    || CASE WHEN r.price_reason IS NOT NULL THEN ': ' || r.price_reason ELSE '' END
    || CASE WHEN r.price->'split' = 'true'::jsonb THEN ', split in two' ELSE '' END
    || CASE WHEN cardinality(v_warn) > 0 THEN ', warnings ticked: ' || (
         SELECT string_agg(CASE u.wk
             WHEN 'not_active' THEN 'not active' WHEN 'too_new' THEN 'live 30 days or less'
             WHEN 'no_win' THEN 'no win in 30 days' WHEN 'not_happy' THEN 'not happy'
             WHEN 'happiness_stale' THEN 'happiness not confirmed in 14 days' WHEN 'red' THEN 'at red'
             WHEN 'pause_required' THEN 'pause needed' WHEN 'raised_on_last_call' THEN 'raised on the last call'
             WHEN 'recent_offer' THEN 'offered in the last 30 days' WHEN 'renewal_window' THEN 'near renewal'
             ELSE replace(u.wk, '_', ' ') END, ', ' ORDER BY u.wn)
           FROM unnest(v_warn) WITH ORDINALITY u(wk, wn)) ELSE '' END;
  PERFORM set_config('cockpit.upsell_action', CASE WHEN p_update THEN 'upsellProposal.updateLink' ELSE 'upsellProposal.send' END, true);
  PERFORM set_config('cockpit.upsell_line', v_line, true);
  UPDATE public.cockpit_upsell_proposals x
     SET sent_content = r.content || jsonb_build_object('frozen', public.cockpit_upsell_frozen(r, v_who)),
         sent_price = r.price, sent_list_price = v_list, sent_lang = r.lang, sent_rev = r.revision + 1,
         sent_at = now(), sent_by = v_who, code = v_code, list_price = v_list,
         status = CASE WHEN r.status IN ('accepted','not_now') THEN r.status ELSE 'link_copied' END,
         updated_after_send = false,
         warnings_passed = ARRAY(SELECT DISTINCT w FROM unnest(v_warn) w WHERE w = ANY (coalesce(p_ack, '{}')) ORDER BY w),
         revision = x.revision + 1, updated_at = now(), updated_by = v_who
   WHERE x.id = r.id RETURNING * INTO r;
  RETURN jsonb_build_object('code', r.code, 'url', 'https://offer.maharamedia.com/' || r.code, 'status', r.status,
    'revision', r.revision, 'problems', (SELECT coalesce(jsonb_agg(p), '[]'::jsonb) FROM jsonb_array_elements(v_problems) p WHERE p->'block' = 'false'::jsonb));
END $$;

-- A view the door records: a device id, the hashed address and the device kind
-- are kept only when they are in their own shape.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_view_add(p_proposal uuid, p_pitch uuid, p_kind text, p_device text, p_ip_hash text, p_device_kind text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.cockpit_upsell_views (proposal_id, pitch_id, kind, device, ip_hash, device_kind)
  VALUES (p_proposal, p_pitch, p_kind,
          CASE WHEN p_device ~ '^[A-Za-z0-9_-]{8,64}$' THEN p_device END,
          CASE WHEN p_ip_hash ~ '^[0-9a-f]{64}$' THEN p_ip_hash END,
          CASE WHEN p_device_kind IN ('phone','tablet','computer') THEN p_device_kind END)
$$;

-- ---------------------------------------------------------------------------
-- Browser functions (each runs the client gate first)
-- ---------------------------------------------------------------------------

-- A new draft in one language, filled from the catalog's copy: the first
-- reason, every line of what they get, the steps, the button, the offer's
-- own video, the verified logo when there is one, the list price where it is
-- set, open for the settings' days. The same request id returns the same
-- draft. The gate's failing reasons come back as warnings; none stops it.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_proposal_create(p_task_id text, p_offer text, p_lang text, p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb; r public.cockpit_upsell_proposals; c public.cockpit_upsell_catalog; cp jsonb; v_content jsonb;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  IF NOT public.cockpit_upsell_offer_ok(p_offer) THEN RAISE EXCEPTION 'Choose one of the seven offers.' USING ERRCODE = '22023'; END IF;
  IF p_lang IS NULL OR p_lang NOT IN ('en','ar') THEN RAISE EXCEPTION 'Choose English or Arabic.' USING ERRCODE = '22023'; END IF;
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'A proposal request id is required.' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_upsell_proposals:' || p_request_id::text, 0));
  SELECT * INTO r FROM public.cockpit_upsell_proposals x WHERE x.request_id = p_request_id;
  IF r.id IS NOT NULL THEN
    IF r.task_id <> p_task_id OR r.offer_key <> p_offer OR r.created_by <> g->>'email' THEN
      RAISE EXCEPTION 'This request id belongs to another proposal.' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object('proposal', public.cockpit_upsell_proposal_json(r),
                              'warnings', public.cockpit_upsell_proposal_warnings(p_task_id, p_offer));
  END IF;
  SELECT * INTO c FROM public.cockpit_upsell_catalog x WHERE x.offer_key = p_offer;
  cp := coalesce(c.copy->p_lang, '{}'::jsonb);
  v_content := jsonb_build_object(
    'v', 1,
    'logo', jsonb_build_object('on', EXISTS (SELECT 1 FROM public.cockpit_client_logos l WHERE l.clickup_task_id = p_task_id), 'adId', NULL),
    'video', jsonb_build_object('kind', 'default'),
    'found', '[]'::jsonb,
    'why', jsonb_build_object('trigger', cp->'why'->0->'key', 'text', coalesce(cp->'why'->0->>'text', ''), 'edited', false),
    'get', (SELECT coalesce(jsonb_agg(jsonb_build_object('key', x->'key', 'text', x->'text', 'hidden', false, 'edited', false) ORDER BY i), '[]'::jsonb)
              FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cp->'get') = 'array' THEN cp->'get' ELSE '[]'::jsonb END) WITH ORDINALITY y(x, i)),
    'platforms', CASE WHEN p_offer = 'smm' THEN '["instagram"]'::jsonb ELSE 'null'::jsonb END,
    'steps', jsonb_build_object('text', public.cockpit_upsell_copy_steps(cp), 'edited', false),
    'button', jsonb_build_object('text', coalesce(cp->>'button', ''), 'edited', false),
    'showCsm', true);
  PERFORM set_config('cockpit.upsell_action', 'upsellProposal.create', true);
  PERFORM set_config('cockpit.upsell_line', format('Proposal for %s started for %s', public.cockpit_upsell_offer_name(p_offer), g->>'clientName'), true);
  INSERT INTO public.cockpit_upsell_proposals (request_id, task_id, client_name, offer_key, lang, content, price, list_price,
      valid_until, created_by, updated_by)
  VALUES (p_request_id, p_task_id, g->>'clientName', p_offer, p_lang, v_content,
      jsonb_build_object('parts', (SELECT coalesce(jsonb_object_agg(x->>'key', x->'amount') FILTER (WHERE jsonb_typeof(x->'amount') = 'number'), '{}'::jsonb)
                                     FROM jsonb_array_elements(c.parts) x), 'split', false),
      public.cockpit_upsell_list_of(c.parts),
      public.cockpit_upsell_today() + (public.cockpit_upsell_settings_json()->>'validDays')::integer, g->>'email', g->>'email')
  RETURNING * INTO r;
  RETURN jsonb_build_object('proposal', public.cockpit_upsell_proposal_json(r),
                            'warnings', public.cockpit_upsell_proposal_warnings(p_task_id, p_offer));
END $$;

-- A draft saves whatever is typed (copy problems come back, they never stop
-- a save). A language switch on its own swaps the catalog's lines to the new
-- language. A save after sending marks the proposal "updated after sending"
-- until its link is updated.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_proposal_save(p_id uuid, p_patch jsonb, p_base_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  cur public.cockpit_upsell_proposals; nxt public.cockpit_upsell_proposals; g jsonb; k text; v jsonb; d date; c public.cockpit_upsell_catalog;
BEGIN
  SELECT * INTO cur FROM public.cockpit_upsell_proposals x WHERE x.id = p_id FOR UPDATE;
  IF cur.id IS NULL THEN RAISE EXCEPTION 'That proposal is not one you can open.' USING ERRCODE = '42501'; END IF;
  g := public.cockpit_csm_client_gate(cur.task_id);
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'Send the changes as named values.' USING ERRCODE = '22023';
  END IF;
  IF p_base_revision IS NULL OR p_base_revision <> cur.revision THEN
    RAISE EXCEPTION 'Someone else saved this. Read it again.' USING ERRCODE = '40001';
  END IF;
  IF cur.status = 'archived' THEN RAISE EXCEPTION 'This proposal is archived. Make a new one.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO c FROM public.cockpit_upsell_catalog x WHERE x.offer_key = cur.offer_key;
  nxt := cur;
  FOR k, v IN SELECT key, value FROM jsonb_each(p_patch) LOOP
    CASE k
    WHEN 'content' THEN
      PERFORM public.cockpit_upsell_proposal_content_check(cur.task_id, cur.offer_key, v);
      nxt.content := v;
    WHEN 'lang' THEN nxt.lang := public.cockpit_upsell_choice(v, ARRAY['en','ar'], 'The language') #>> '{}';
      IF nxt.lang IS NULL THEN RAISE EXCEPTION 'Choose English or Arabic.' USING ERRCODE = '22023'; END IF;
    WHEN 'price' THEN
      IF NOT public.cockpit_upsell_price_ok(v) THEN
        RAISE EXCEPTION 'A price is a dollar amount from 1 to 1,000,000 for each part, with at most two decimals.' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(v->'parts') pk WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c.parts) x WHERE x->>'key' = pk)) THEN
        RAISE EXCEPTION 'The price names a part this offer does not have.' USING ERRCODE = '22023';
      END IF;
      nxt.price := v;
    WHEN 'price_reason' THEN nxt.price_reason := public.cockpit_upsell_text(v, 140, 'The reason');
    WHEN 'valid_until' THEN
      d := public.cockpit_upsell_date(v, '"Valid until"');
      IF d IS NULL OR d < public.cockpit_upsell_today() - 365 OR d > public.cockpit_upsell_today() + 365 THEN
        RAISE EXCEPTION 'Pick a "Valid until" date within a year.' USING ERRCODE = '22023';
      END IF;
      nxt.valid_until := d;
    ELSE RAISE EXCEPTION 'A proposal does not keep "%".', k USING ERRCODE = '22023';
    END CASE;
  END LOOP;
  -- A language switch on its own brings the catalog's lines along, so the
  -- page never mixes English and Arabic. Typed lines stay as typed.
  -- Only the lines change, so only their shape is checked again (a capture
  -- removed since never blocks a language switch; the page drops it).
  IF nxt.lang IS DISTINCT FROM cur.lang AND NOT (p_patch ? 'content') THEN
    nxt.content := public.cockpit_upsell_content_relang(nxt.content, c.copy->cur.lang, c.copy->nxt.lang);
    IF nxt.content IS DISTINCT FROM cur.content AND NOT public.cockpit_upsell_proposal_content_ok(nxt.content, cur.offer_key) THEN
      RAISE EXCEPTION 'The proposal''s content is not in the shape the page reads. Reload the builder.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF nxt IS NOT DISTINCT FROM cur THEN
    RETURN public.cockpit_upsell_proposal_json(cur) || jsonb_build_object('changed', false,
      'problems', public.cockpit_upsell_proposal_problems(cur, NULL, false));
  END IF;
  PERFORM set_config('cockpit.upsell_action', 'upsellProposal.save', true);
  PERFORM set_config('cockpit.upsell_line', '', true);
  UPDATE public.cockpit_upsell_proposals x
     SET content = nxt.content, lang = nxt.lang, price = nxt.price, price_reason = nxt.price_reason, valid_until = nxt.valid_until,
         list_price = public.cockpit_upsell_list_of(c.parts),
         updated_after_send = x.updated_after_send OR x.sent_at IS NOT NULL,
         revision = x.revision + 1, updated_at = now(), updated_by = g->>'email'
   WHERE x.id = cur.id RETURNING * INTO nxt;
  RETURN public.cockpit_upsell_proposal_json(nxt) || jsonb_build_object('changed', true,
    'problems', public.cockpit_upsell_proposal_problems(nxt, NULL, false));
END $$;

-- Send by copying the link (the only way in the pilot): every check, then
-- the freeze. The code is set once and never changes.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_proposal_send(p_id uuid, p_base_revision integer, p_via text, p_ack text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_via IS NULL OR p_via <> 'copy' THEN
    RAISE EXCEPTION '"Copy link" is the only way to send for now.' USING ERRCODE = '22023';
  END IF;
  RETURN public.cockpit_upsell_proposal_freeze(p_id, p_base_revision, p_ack, false);
END $$;

-- After an edit to a sent proposal: the same checks, a new freeze on the
-- same link, and "updated after sending" cleared.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_proposal_update_link(p_id uuid, p_base_revision integer, p_ack text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN public.cockpit_upsell_proposal_freeze(p_id, p_base_revision, p_ack, true);
END $$;

-- The client's answer, or archived. Accepted and not now need the link sent
-- first; not now needs the objection and a follow-up date in 120 days.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_proposal_mark(p_id uuid, p_status text, p_objection text, p_follow_up_on date, p_base_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cockpit_upsell_proposals; g jsonb; v_obj text; v_line text;
BEGIN
  SELECT * INTO r FROM public.cockpit_upsell_proposals x WHERE x.id = p_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'That proposal is not one you can open.' USING ERRCODE = '42501'; END IF;
  g := public.cockpit_csm_client_gate(r.task_id);
  IF p_status IS NULL OR p_status NOT IN ('accepted','not_now','archived') THEN
    RAISE EXCEPTION 'Mark it accepted, not now or archived.' USING ERRCODE = '22023';
  END IF;
  IF p_base_revision IS NULL OR p_base_revision <> r.revision THEN
    RAISE EXCEPTION 'Someone else saved this. Read it again.' USING ERRCODE = '40001';
  END IF;
  IF p_status IN ('accepted','not_now') AND r.sent_at IS NULL THEN
    RAISE EXCEPTION 'Copy the link first, then mark their answer.' USING ERRCODE = '22023';
  END IF;
  v_obj := public.cockpit_upsell_text(to_jsonb(p_objection), 200, 'Their objection');
  IF p_status = 'not_now' THEN
    IF v_obj IS NULL THEN RAISE EXCEPTION 'Write what held them back, in a line.' USING ERRCODE = '22023'; END IF;
    IF p_follow_up_on IS NULL OR p_follow_up_on < public.cockpit_upsell_today() OR p_follow_up_on > public.cockpit_upsell_today() + 120 THEN
      RAISE EXCEPTION 'Pick a follow-up date in the next 120 days.' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF r.status = p_status AND (p_status <> 'not_now' OR (r.objection IS NOT DISTINCT FROM v_obj AND r.follow_up_on IS NOT DISTINCT FROM p_follow_up_on)) THEN
    RETURN public.cockpit_upsell_proposal_json(r) || jsonb_build_object('changed', false);
  END IF;
  v_line := format('Proposal for %s marked %s', public.cockpit_upsell_offer_name(r.offer_key),
    CASE p_status WHEN 'accepted' THEN 'accepted' WHEN 'archived' THEN 'archived'
         ELSE format('not now: %s, follow up %s', v_obj, public.cockpit_upsell_day(p_follow_up_on)) END);
  PERFORM set_config('cockpit.upsell_action', 'upsellProposal.mark', true);
  PERFORM set_config('cockpit.upsell_line', v_line, true);
  UPDATE public.cockpit_upsell_proposals x
     SET status = p_status,
         objection = CASE WHEN p_status = 'not_now' THEN v_obj ELSE x.objection END,
         follow_up_on = CASE WHEN p_status = 'not_now' THEN p_follow_up_on ELSE x.follow_up_on END,
         revision = x.revision + 1, updated_at = now(), updated_by = g->>'email'
   WHERE x.id = r.id RETURNING * INTO r;
  RETURN public.cockpit_upsell_proposal_json(r) || jsonb_build_object('changed', true);
END $$;

-- This client's proposals for the card: status, opens worked out from the
-- views (and whether they can be trusted), expiry, updated after sending,
-- and a "not now" answer's objection and follow-up date.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_proposals_read(p_task_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE ds public.cockpit_upsell_door_status;
BEGIN
  PERFORM public.cockpit_csm_client_gate(p_task_id);
  SELECT * INTO ds FROM public.cockpit_upsell_door_status d WHERE d.route = 'p';
  RETURN jsonb_build_object('rows', (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', r.id, 'offerKey', r.offer_key, 'lang', r.lang, 'status', r.status,
             'opened', CASE WHEN r.sent_at IS NULL THEN NULL ELSE jsonb_build_object(
                 'devices', (SELECT count(DISTINCT coalesce(w.device, w.ip_hash, w.id::text)) FROM public.cockpit_upsell_views w WHERE w.proposal_id = r.id AND w.kind = 'open'),
                 'visits', (SELECT count(*) FROM public.cockpit_upsell_views w WHERE w.proposal_id = r.id AND w.kind = 'open'),
                 'lastAt', (SELECT to_jsonb(max(w.at)) FROM public.cockpit_upsell_views w WHERE w.proposal_id = r.id AND w.kind = 'open'),
                 'played', (SELECT count(*) FROM public.cockpit_upsell_views w WHERE w.proposal_id = r.id AND w.kind = 'play'),
                 'pressedYes', (SELECT count(*) FROM public.cockpit_upsell_views w WHERE w.proposal_id = r.id AND w.kind = 'cta'),
                 'known', ds.last_ok_at IS NOT NULL AND NOT coalesce(ds.last_error_at > r.sent_at, false)) END,
             'expired', r.sent_at IS NOT NULL AND r.status <> 'archived' AND coalesce((r.sent_content#>>'{frozen,validUntil}')::date, r.valid_until) < public.cockpit_upsell_today(),
             'updatedAfterSend', r.updated_after_send, 'sentAt', to_jsonb(r.sent_at),
             'validUntil', to_jsonb(coalesce((r.sent_content#>>'{frozen,validUntil}')::date, r.valid_until)),
             'objection', r.objection, 'followUpOn', to_jsonb(r.follow_up_on),
             'code', r.code, 'revision', r.revision, 'updatedAt', to_jsonb(r.updated_at)) ORDER BY r.updated_at DESC, r.id), '[]'::jsonb)
      FROM public.cockpit_upsell_proposals r WHERE r.task_id = p_task_id));
END $$;

-- The full row for the builder, with today's warnings, the list price now,
-- whether full price was held and whether the offer has a video in its language.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_proposal_get(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cockpit_upsell_proposals; c public.cockpit_upsell_catalog;
BEGIN
  SELECT * INTO r FROM public.cockpit_upsell_proposals x WHERE x.id = p_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'That proposal is not one you can open.' USING ERRCODE = '42501'; END IF;
  PERFORM public.cockpit_csm_client_gate(r.task_id);
  SELECT * INTO c FROM public.cockpit_upsell_catalog x WHERE x.offer_key = r.offer_key;
  RETURN public.cockpit_upsell_proposal_json(r) || jsonb_build_object(
    'listNow', public.cockpit_upsell_list_of(c.parts),
    'warnings', public.cockpit_upsell_proposal_warnings(r.task_id, r.offer_key),
    'heldFull', public.cockpit_upsell_held_full(r.task_id, r.offer_key),
    'videoReady', public.cockpit_upsell_offer_video(r.offer_key, r.lang) IS NOT NULL,
    'problems', public.cockpit_upsell_proposal_problems(r, NULL, false));
END $$;

-- PublicProposal for the draft as typed (or as the builder holds it right
-- now): the server's preview and the parity test's.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_proposal_public(p_id uuid, p_content jsonb DEFAULT NULL, p_price jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cockpit_upsell_proposals;
BEGIN
  SELECT * INTO r FROM public.cockpit_upsell_proposals x WHERE x.id = p_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'That proposal is not one you can open.' USING ERRCODE = '42501'; END IF;
  PERFORM public.cockpit_csm_client_gate(r.task_id);
  IF p_content IS NOT NULL AND NOT public.cockpit_upsell_proposal_content_ok(p_content, r.offer_key) THEN
    RAISE EXCEPTION 'The proposal''s content is not in the shape the page reads. Reload the builder.' USING ERRCODE = '22023';
  END IF;
  IF p_price IS NOT NULL AND NOT public.cockpit_upsell_price_ok(p_price) THEN
    RAISE EXCEPTION 'A price is a dollar amount from 1 to 1,000,000 for each part, with at most two decimals.' USING ERRCODE = '22023';
  END IF;
  r.sent_at := NULL;
  RETURN public.cockpit_upsell_public_json(r, coalesce(p_content, r.content), coalesce(p_price, r.price));
END $$;

-- A 30-minute link to the live page that is never counted as an open. Only
-- the token's sha256 is kept. Not an edit: the revision stays.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_proposal_preview(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cockpit_upsell_proposals; v_token text; v_until timestamptz := now() + interval '30 minutes';
BEGIN
  SELECT * INTO r FROM public.cockpit_upsell_proposals x WHERE x.id = p_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'That proposal is not one you can open.' USING ERRCODE = '42501'; END IF;
  PERFORM public.cockpit_csm_client_gate(r.task_id);
  IF r.code IS NULL THEN RAISE EXCEPTION 'Copy the link once, then open the live page.' USING ERRCODE = '22023'; END IF;
  v_token := public.cockpit_upsell_code(24);
  PERFORM set_config('cockpit.upsell_action', 'upsellProposal.preview', true);
  PERFORM set_config('cockpit.upsell_line', '', true);
  UPDATE public.cockpit_upsell_proposals x
     SET preview_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), preview_until = v_until
   WHERE x.id = r.id;
  RETURN jsonb_build_object('url', 'https://offer.maharamedia.com/' || r.code || '?pv=' || v_token, 'until', to_jsonb(v_until));
END $$;

-- ---------------------------------------------------------------------------
-- The door (service key only: supabase/functions/upsell-door)
-- ---------------------------------------------------------------------------

-- The page asks for its proposal: built from the frozen copy, price and
-- language. An open is counted unless the preview token is the live one.
-- This proposal's views older than 90 days go.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_door_open(p_code text, p_device text, p_ip_hash text, p_device_kind text, p_preview text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r public.cockpit_upsell_proposals; v_contact jsonb; v_preview boolean;
BEGIN
  v_contact := jsonb_build_object('whatsapp', public.cockpit_upsell_settings_json()->'whatsappNumber');
  IF p_code IS NULL OR p_code !~ '^[a-hj-km-np-z2-9]{12}$' THEN
    RETURN jsonb_build_object('state', 'unknown', 'proposal', NULL, 'contact', v_contact);
  END IF;
  SELECT * INTO r FROM public.cockpit_upsell_proposals x WHERE x.code = p_code;
  IF r.id IS NULL OR r.sent_at IS NULL THEN
    RETURN jsonb_build_object('state', 'unknown', 'proposal', NULL, 'contact', v_contact);
  END IF;
  IF r.status = 'archived' THEN
    RETURN jsonb_build_object('state', 'archived', 'proposal', NULL, 'contact', v_contact);
  END IF;
  v_preview := p_preview IS NOT NULL AND r.preview_hash IS NOT NULL AND r.preview_until > now()
               AND r.preview_hash = encode(sha256(convert_to(p_preview, 'UTF8')), 'hex');
  -- A draft date change does not close or reopen the sent page. Update link replaces this snapshot.
  IF coalesce((r.sent_content#>>'{frozen,validUntil}')::date, r.valid_until) < public.cockpit_upsell_today() AND NOT v_preview THEN
    RETURN jsonb_build_object('state', 'expired', 'proposal', NULL, 'contact', v_contact);
  END IF;
  DELETE FROM public.cockpit_upsell_views w WHERE w.proposal_id = r.id AND w.at < now() - interval '90 days';
  IF NOT v_preview THEN
    PERFORM public.cockpit_upsell_view_add(r.id, NULL, 'open', p_device, p_ip_hash, p_device_kind);
  END IF;
  r.lang := r.sent_lang;
  RETURN jsonb_build_object('state', 'open', 'proposal', public.cockpit_upsell_public_json(r, r.sent_content, r.sent_price), 'contact', v_contact);
END $$;

-- The page's play and Yes presses. An unknown code is ignored.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_door_event(p_code text, p_kind text, p_device text, p_ip_hash text, p_device_kind text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  IF p_kind IS NULL OR p_kind NOT IN ('play','cta') THEN
    RAISE EXCEPTION 'An event is play or cta.' USING ERRCODE = '22023';
  END IF;
  IF p_code IS NULL OR p_code !~ '^[a-hj-km-np-z2-9]{12}$' THEN RETURN; END IF;
  SELECT x.id INTO v_id FROM public.cockpit_upsell_proposals x WHERE x.code = p_code AND x.sent_at IS NOT NULL AND x.status <> 'archived';
  IF v_id IS NULL THEN RETURN; END IF;
  PERFORM public.cockpit_upsell_view_add(v_id, NULL, p_kind, p_device, p_ip_hash, p_device_kind);
END $$;

-- A pitch's video link (offer.maharamedia.com/v/<code>): the offer's video in
-- the pitch's language, and one counted view. An unknown code is unknown.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_door_video(p_code text, p_device text, p_ip_hash text, p_device_kind text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.cockpit_upsell_pitches; v jsonb;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[a-hj-km-np-z2-9]{10}$' THEN RETURN jsonb_build_object('state', 'unknown', 'url', NULL); END IF;
  SELECT * INTO p FROM public.cockpit_upsell_pitches x WHERE x.video_code = p_code;
  IF p.id IS NULL THEN RETURN jsonb_build_object('state', 'unknown', 'url', NULL); END IF;
  v := public.cockpit_upsell_offer_video(p.offer_key, p.lang);
  IF v IS NULL THEN RETURN jsonb_build_object('state', 'unknown', 'url', NULL); END IF;
  DELETE FROM public.cockpit_upsell_views w WHERE w.pitch_id = p.id AND w.at < now() - interval '90 days';
  PERFORM public.cockpit_upsell_view_add(NULL, p.id, 'video', p_device, p_ip_hash, p_device_kind);
  RETURN jsonb_build_object('state', 'open', 'url', v->>'url');
END $$;

-- The door's health per route: written when the state changes, or at most
-- once a minute while it holds.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_door_status_set(p_route text, p_ok boolean, p_sentence text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE s public.cockpit_upsell_door_status; v_was text; v_now text;
BEGIN
  IF p_route IS NULL OR p_route NOT IN ('p','event','v') THEN RAISE EXCEPTION 'A door route is p, event or v.' USING ERRCODE = '22023'; END IF;
  IF p_ok IS NULL THEN RAISE EXCEPTION 'Say whether the route worked.' USING ERRCODE = '22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_upsell_door_status:' || p_route, 0));
  SELECT * INTO s FROM public.cockpit_upsell_door_status d WHERE d.route = p_route FOR UPDATE;
  v_now := CASE WHEN p_ok THEN 'ok' ELSE 'error' END;
  IF s.route IS NOT NULL THEN
    v_was := CASE WHEN coalesce(s.last_error_at, '-infinity') > coalesce(s.last_ok_at, '-infinity') THEN 'error' ELSE 'ok' END;
    IF v_was = v_now AND greatest(s.last_ok_at, s.last_error_at) > now() - interval '1 minute' THEN RETURN; END IF;
  END IF;
  INSERT INTO public.cockpit_upsell_door_status AS d (route, last_ok_at, last_error_at, sentence)
  VALUES (p_route, CASE WHEN p_ok THEN now() END, CASE WHEN NOT p_ok THEN now() END,
          nullif(left(btrim(coalesce(p_sentence, '')), 200), ''))
  ON CONFLICT (route) DO UPDATE
    SET last_ok_at = CASE WHEN p_ok THEN now() ELSE d.last_ok_at END,
        last_error_at = CASE WHEN NOT p_ok THEN now() ELSE d.last_error_at END,
        sentence = CASE WHEN NOT p_ok THEN excluded.sentence ELSE d.sentence END;
END $$;

-- ---------------------------------------------------------------------------
-- Grants, restated
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION
  public.cockpit_upsell_line_ok(jsonb, integer),
  public.cockpit_upsell_proposal_content_ok(jsonb, text),
  public.cockpit_upsell_price_ok(jsonb),
  public.cockpit_upsell_urlencode(text),
  public.cockpit_upsell_first_name(text),
  public.cockpit_upsell_offer_video(text, text),
  public.cockpit_upsell_copy_steps(jsonb),
  public.cockpit_upsell_content_relang(jsonb, jsonb, jsonb),
  public.cockpit_upsell_found_live(text, jsonb),
  public.cockpit_upsell_frozen(public.cockpit_upsell_proposals, text),
  public.cockpit_upsell_public_json(public.cockpit_upsell_proposals, jsonb, jsonb),
  public.cockpit_upsell_proposal_json(public.cockpit_upsell_proposals),
  public.cockpit_upsell_proposal_warnings(text, text),
  public.cockpit_upsell_proposal_problems(public.cockpit_upsell_proposals, text[], boolean),
  public.cockpit_upsell_proposal_content_check(text, text, jsonb),
  public.cockpit_upsell_proposal_freeze(uuid, integer, text[], boolean),
  public.cockpit_upsell_view_add(uuid, uuid, text, text, text, text)
FROM PUBLIC, anon, authenticated, service_role;
-- The table CHECKs call these two, so the service key (which may insert and
-- update proposals) runs them, as it runs 20261026u's check helpers. Both
-- are definers: their own helpers need no grant.
GRANT EXECUTE ON FUNCTION
  public.cockpit_upsell_proposal_content_ok(jsonb, text),
  public.cockpit_upsell_price_ok(jsonb)
TO service_role;

REVOKE ALL ON FUNCTION
  public.cockpit_upsell_proposal_create(text, text, text, uuid),
  public.cockpit_upsell_proposal_save(uuid, jsonb, integer),
  public.cockpit_upsell_proposal_send(uuid, integer, text, text[]),
  public.cockpit_upsell_proposal_update_link(uuid, integer, text[]),
  public.cockpit_upsell_proposal_mark(uuid, text, text, date, integer),
  public.cockpit_upsell_proposals_read(text),
  public.cockpit_upsell_proposal_get(uuid),
  public.cockpit_upsell_proposal_public(uuid, jsonb, jsonb),
  public.cockpit_upsell_proposal_preview(uuid)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION
  public.cockpit_upsell_proposal_create(text, text, text, uuid),
  public.cockpit_upsell_proposal_save(uuid, jsonb, integer),
  public.cockpit_upsell_proposal_send(uuid, integer, text, text[]),
  public.cockpit_upsell_proposal_update_link(uuid, integer, text[]),
  public.cockpit_upsell_proposal_mark(uuid, text, text, date, integer),
  public.cockpit_upsell_proposals_read(text),
  public.cockpit_upsell_proposal_get(uuid),
  public.cockpit_upsell_proposal_public(uuid, jsonb, jsonb),
  public.cockpit_upsell_proposal_preview(uuid)
TO authenticated;

REVOKE ALL ON FUNCTION
  public.cockpit_upsell_door_open(text, text, text, text, text),
  public.cockpit_upsell_door_event(text, text, text, text, text),
  public.cockpit_upsell_door_video(text, text, text, text),
  public.cockpit_upsell_door_status_set(text, boolean, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.cockpit_upsell_door_open(text, text, text, text, text),
  public.cockpit_upsell_door_event(text, text, text, text, text),
  public.cockpit_upsell_door_video(text, text, text, text),
  public.cockpit_upsell_door_status_set(text, boolean, text)
TO service_role;

COMMIT;
