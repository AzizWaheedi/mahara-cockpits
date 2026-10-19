-- CSM decks: the backend of the onboarding and launch decks the client success
-- manager presents from a client's page (docs/csm-decks/CONTENT.md data map,
-- DESIGN.md sections 10, 12.3 and 14). Apply after 20261018c.
--
-- 1. cockpit_csm_deck_prep: one row per client per deck. Prep and the notes
--    window save into it through cockpit_csm_deck_prep_save, which merges an
--    allow-listed patch (a null value removes a key).
-- 2. cockpit_csm_launch_ads: the creatives the CSM uploads for the ads tray,
--    in the PRIVATE bucket cockpit-launch-ads at <taskId>/<id>.<ext>. The
--    browser has no write policy: cockpit-csm-api reserves a row here, signs a
--    non-upserting upload with the service key, checks the object, and this
--    file's accept function checks Storage's own metadata again before the
--    row turns ready. Reads are signed URLs under one read policy. Removing a
--    file deletes its bytes (the row stays, for the audit), and the client's
--    stale uploads are swept whenever its tray is listed (launchAds.ts).
-- 3. cockpit_csm_deck_sources: everything the decks pull that a CSM seat cannot
--    read directly (logo, country, offer and Do's & Don'ts, callers, kit links
--    and dates, next calls, this client's Meta ads and stills, and its funnel
--    forms). Forms are matched by the exact Meta ad ids of this client's own
--    campaigns (or ad accounts used by no other client), never by the funnel's
--    account name. No leads, cost per lead, spend or budgets are returned.
--
-- Every function is SECURITY DEFINER with search_path '' and calls
-- cockpit_csm_client_gate first. Tables are service-only (RLS on, no browser
-- grants). Every write leaves one cockpit_audit_log row through a trigger.
-- The file applies twice without error.
BEGIN;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cockpit_csm_deck_prep (
  task_id text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  deck text NOT NULL CHECK (deck IN ('onboarding','launch')),
  overrides jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(overrides) = 'object' AND octet_length(overrides::text) <= 65536),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (btrim(updated_by) <> ''),
  PRIMARY KEY (task_id, deck)
);

CREATE TABLE IF NOT EXISTS public.cockpit_csm_launch_ads (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  task_id text NOT NULL CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  kind text NOT NULL CHECK (kind IN ('starter','custom','logo','page')),
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading','ready','removed')),
  storage_path text NOT NULL UNIQUE,
  mime text NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm')),
  bytes bigint NOT NULL CHECK (bytes BETWEEN 1 AND 157286400),
  width integer CHECK (width BETWEEN 1 AND 20000),
  height integer CHECK (height BETWEEN 1 AND 20000),
  seconds numeric(8,2) CHECK (seconds > 0 AND seconds <= 3600),
  poster_path text UNIQUE,
  poster_mime text CHECK (poster_mime IN ('image/jpeg','image/png','image/webp')),
  poster_bytes bigint CHECK (poster_bytes BETWEEN 1 AND 5242880),
  file_name text CHECK (char_length(file_name) BETWEEN 1 AND 200),
  placement text CHECK (placement IN ('feed','reels','facebook')),
  primary_text text CHECK (char_length(primary_text) BETWEEN 1 AND 2200),
  headline text CHECK (char_length(headline) BETWEEN 1 AND 255),
  cta text CHECK (cta IN ('LEARN_MORE','GET_QUOTE','BOOK_NOW','CONTACT_US','SIGN_UP','SEND_WHATSAPP_MESSAGE','APPLY_NOW')),
  language text CHECK (language IN ('ar','en')),
  hidden boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  created_by_email text NOT NULL CHECK (btrim(created_by_email) <> ''),
  ready_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  removed_at timestamptz,
  -- When the stored bytes (file and poster) were deleted from the bucket.
  purged_at timestamptz,
  CONSTRAINT cockpit_csm_launch_ads_path CHECK (storage_path = task_id || '/' || id::text || '.' ||
    CASE mime WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp'
              WHEN 'video/mp4' THEN 'mp4' WHEN 'video/quicktime' THEN 'mov' ELSE 'webm' END),
  CONSTRAINT cockpit_csm_launch_ads_poster CHECK (
    (poster_path IS NULL AND poster_mime IS NULL AND poster_bytes IS NULL) OR
    (mime LIKE 'video/%' AND poster_mime IS NOT NULL AND poster_bytes IS NOT NULL AND
     poster_path = task_id || '/' || id::text || '-poster.' ||
       CASE poster_mime WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' ELSE 'webp' END)),
  CONSTRAINT cockpit_csm_launch_ads_still_kinds CHECK (kind NOT IN ('logo','page') OR mime LIKE 'image/%'),
  CONSTRAINT cockpit_csm_launch_ads_ready CHECK ((status = 'uploading') = (ready_at IS NULL) OR status = 'removed'),
  CONSTRAINT cockpit_csm_launch_ads_removed CHECK ((status = 'removed') = (removed_at IS NOT NULL)),
  CONSTRAINT cockpit_csm_launch_ads_purged CHECK (purged_at IS NULL OR status = 'removed')
);
CREATE INDEX IF NOT EXISTS cockpit_csm_launch_ads_task_idx ON public.cockpit_csm_launch_ads (task_id, status, created_at);
CREATE INDEX IF NOT EXISTS cockpit_csm_launch_ads_pending_idx ON public.cockpit_csm_launch_ads (created_by, created_at) WHERE status = 'uploading';

ALTER TABLE public.cockpit_csm_deck_prep ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_csm_launch_ads ENABLE ROW LEVEL SECURITY;
-- The service key reads, inserts and updates; it never deletes or truncates
-- (a TRUNCATE would skip the row audit), so Supabase's default grants go too.
REVOKE ALL ON public.cockpit_csm_deck_prep, public.cockpit_csm_launch_ads FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.cockpit_csm_deck_prep, public.cockpit_csm_launch_ads TO service_role;

-- One audit row per write, whoever writes. Prep rows record only the keys a
-- save changed, so a debounced field does not copy the whole prep each time.
-- The RPCs name the action through the transaction-local cockpit.deck_action.
CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  old_row jsonb; new_row jsonb; row_any jsonb; o jsonb; n jsonb; b jsonb; a jsonb; keys text[];
  entity text; who text; act text;
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
  ELSE
    entity := row_any->>'id';
  END IF;
  act := coalesce(nullif(current_setting('cockpit.deck_action', true), ''), lower(TG_OP));
  SELECT lower(btrim(u.email)) INTO who FROM auth.users u WHERE u.id = auth.uid();
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES (act, TG_TABLE_NAME, entity, coalesce(who, session_user), 'client-success', 'supabase', old_row, new_row,
          jsonb_build_object('op', TG_OP, 'task_id', row_any->>'task_id', 'changed', to_jsonb(keys),
                             'database_role', current_setting('role', true)));
  RETURN coalesce(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS cockpit_csm_deck_prep_audit ON public.cockpit_csm_deck_prep;
CREATE TRIGGER cockpit_csm_deck_prep_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_csm_deck_prep
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_csm_deck_audit();
DROP TRIGGER IF EXISTS cockpit_csm_launch_ads_audit ON public.cockpit_csm_launch_ads;
CREATE TRIGGER cockpit_csm_launch_ads_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_csm_launch_ads
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_csm_deck_audit();

-- ---------------------------------------------------------------------------
-- The private bucket and its one read policy
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('cockpit-launch-ads', 'cockpit-launch-ads', false, 157286400,
        ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- True only for the file (or video poster) of a READY upload whose client the
-- signed-in seat may open. Never raises: a policy that raises breaks listing.
CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_object_allowed(p_name text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE t text;
BEGIN
  IF p_name IS NULL OR p_name !~ '^[A-Za-z0-9_-]{1,40}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-poster)?\.(jpg|png|webp|mp4|mov|webm)$' THEN
    RETURN false;
  END IF;
  SELECT a.task_id INTO t FROM public.cockpit_csm_launch_ads a
   WHERE (a.storage_path = p_name OR a.poster_path = p_name) AND a.status = 'ready';
  IF t IS NULL OR split_part(p_name, '/', 1) <> t THEN RETURN false; END IF;
  PERFORM public.cockpit_csm_client_gate(t);
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END $$;

DROP POLICY IF EXISTS cockpit_launch_ads_read ON storage.objects;
CREATE POLICY cockpit_launch_ads_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'cockpit-launch-ads' AND public.cockpit_csm_launch_object_allowed(name));
GRANT SELECT ON storage.objects TO authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers (no browser grant)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ad_json(a public.cockpit_csm_launch_ads) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'id', a.id, 'taskId', a.task_id, 'kind', a.kind, 'status', a.status, 'path', a.storage_path,
    'mime', a.mime, 'bytes', a.bytes, 'width', a.width, 'height', a.height, 'seconds', a.seconds,
    'posterPath', a.poster_path, 'posterMime', a.poster_mime, 'posterBytes', a.poster_bytes, 'fileName', a.file_name,
    'placement', a.placement, 'primaryText', a.primary_text, 'headline', a.headline, 'cta', a.cta,
    'language', a.language, 'hidden', a.hidden, 'createdAt', a.created_at, 'createdBy', a.created_by_email,
    'readyAt', a.ready_at, 'updatedAt', a.updated_at, 'updatedBy', a.updated_by, 'removedAt', a.removed_at,
    'purgedAt', a.purged_at)
$$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ads_rows(p_task_id text, p_include_hidden boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(public.cockpit_csm_launch_ad_json(a) ORDER BY a.created_at, a.id), '[]'::jsonb)
    FROM public.cockpit_csm_launch_ads a
   WHERE a.task_id = p_task_id AND a.status = 'ready' AND (coalesce(p_include_hidden, true) OR NOT a.hidden)
$$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_prep_both(p_task_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'onboarding', (SELECT jsonb_build_object('deck', p.deck, 'overrides', p.overrides, 'revision', p.revision,
                     'updatedAt', p.updated_at, 'updatedBy', p.updated_by)
                     FROM public.cockpit_csm_deck_prep p WHERE p.task_id = p_task_id AND p.deck = 'onboarding'),
    'launch', (SELECT jsonb_build_object('deck', p.deck, 'overrides', p.overrides, 'revision', p.revision,
                 'updatedAt', p.updated_at, 'updatedBy', p.updated_by)
                 FROM public.cockpit_csm_deck_prep p WHERE p.task_id = p_task_id AND p.deck = 'launch'))
$$;

-- This client's Meta campaigns, ads (paused ones included), stills and funnel
-- forms. Campaigns are this client's when the campaign's client name has the
-- same name key as the card (the rule cockpit_csm_client_ads uses), never by
-- the ad account's name; if another client's card shares the key, nothing is
-- matched.
-- A campaign is its (name, ad account) pair, never its name alone: Meta's
-- default names ("New Leads Campaign") repeat across clients. A tree ad is
-- this client's when its pair is one of this client's pairs, or its account
-- is used by no other client. Board and daily rows carry no account, so they
-- count only for a name no other client's campaign (or another account's
-- tree ad) shares.
-- A funnel row is this client's only when one of its ads is one of this
-- client's ads (by exact Meta id) and none of its ads is another client's.
CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_meta(p_task_id text, p_client_name text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_key text := public.cockpit_csm_name_key(p_client_name);
  v_twins integer;
  v_names text[] := '{}'; v_accounts text[] := '{}'; v_ids text[] := '{}'; v_other text[] := '{}';
  v_pairs text[] := '{}'; v_loose text[] := '{}'; v_unshared text[] := '{}'; v_tree text[] := '{}';
  v_other_pairs text[] := '{}'; v_other_names text[] := '{}';
  v_campaigns jsonb := '[]'::jsonb; v_ads jsonb; v_funnels jsonb;
  v_tree_ready boolean; v_tree_at timestamptz; v_fun_ready boolean; v_fun_at timestamptz;
  v_match text := 'name'; v_note text;
  native_url constant text := '^https://bldgtotkfmhoxmlzowdx[.]supabase[.]co/storage/v1/object/public/cockpit-ad-stills/([a-f0-9]{64}/)?[a-f0-9]{64}$';
BEGIN
  SELECT s.ready, s.source_snapshot_at INTO v_tree_ready, v_tree_at FROM public.cockpit_media_source_state s WHERE s.table_name = 'metaTree';
  SELECT s.ready, s.source_snapshot_at INTO v_fun_ready, v_fun_at FROM public.cockpit_creative_source_state s WHERE s.table_name = 'funnels';

  -- Another card with the same key but another name is another client. A
  -- second card with the very same name is this client's duplicate card.
  SELECT count(*) INTO v_twins FROM public.cockpit_csm_sources s
   WHERE s.table_name = 'clients' AND s.data->>'taskId' IS DISTINCT FROM p_task_id
     AND public.cockpit_csm_name_key(s.data->>'name') = v_key
     AND lower(btrim(s.data->>'name')) IS DISTINCT FROM lower(btrim(p_client_name));
  IF v_key = '' THEN
    v_match := 'none'; v_note := 'This client''s name has no letters to match campaigns by.';
  ELSIF v_twins > 0 THEN
    v_match := 'ambiguous'; v_note := 'Another client card has the same name key, so no Meta campaign is matched to either.';
  ELSE
    WITH matched AS (
      SELECT DISTINCT ON (c.raw_data->>'campaignName', coalesce(nullif(c.raw_data->>'metaAccountId', ''), c.meta_account_id, ''))
             c.*, coalesce(nullif(c.raw_data->>'metaAccountId', ''), c.meta_account_id) AS acct
        FROM public.cockpit_campaigns c
       WHERE nullif(btrim(c.raw_data->>'campaignName'), '') IS NOT NULL
         AND (public.cockpit_csm_name_key(c.raw_data->>'clientName') = v_key
              OR public.cockpit_csm_name_key(c.client_name) = v_key)
       ORDER BY c.raw_data->>'campaignName', coalesce(nullif(c.raw_data->>'metaAccountId', ''), c.meta_account_id, ''),
                c.source_deleted, c.updated_at DESC)
    SELECT coalesce(array_agg(DISTINCT m.raw_data->>'campaignName'), '{}'),
           coalesce(array_agg(DISTINCT m.acct) FILTER (WHERE m.acct ~ '^[0-9]{3,25}$'), '{}'),
           coalesce(array_agg(DISTINCT (m.raw_data->>'campaignName') || chr(31) || coalesce(m.acct, '')), '{}'),
           coalesce(array_agg(DISTINCT m.raw_data->>'campaignName') FILTER (WHERE nullif(m.acct, '') IS NULL), '{}'),
           coalesce(jsonb_agg(jsonb_build_object(
             'id', m.raw_data->>'metaCampaignId', 'name', m.raw_data->>'campaignName',
             'accountId', m.acct, 'ended', m.source_deleted) ORDER BY m.raw_data->>'campaignName', m.acct), '[]'::jsonb)
      INTO v_names, v_accounts, v_pairs, v_loose, v_campaigns
      FROM matched m;
    IF cardinality(v_names) = 0 THEN v_match := 'none'; v_note := 'No Meta campaign carries this client''s name yet.'; END IF;
  END IF;

  -- Every other client's campaign, as (name, account) pairs.
  SELECT coalesce(array_agg(DISTINCT (c.raw_data->>'campaignName') || chr(31) ||
                    coalesce(nullif(c.raw_data->>'metaAccountId', ''), c.meta_account_id, '')), '{}'),
         coalesce(array_agg(DISTINCT c.raw_data->>'campaignName'), '{}')
    INTO v_other_pairs, v_other_names
    FROM public.cockpit_campaigns c
   WHERE nullif(btrim(c.raw_data->>'campaignName'), '') IS NOT NULL
     AND (v_key = '' OR (public.cockpit_csm_name_key(c.raw_data->>'clientName') IS DISTINCT FROM v_key
                         AND public.cockpit_csm_name_key(c.client_name) IS DISTINCT FROM v_key));

  -- An ad account counts only when no other client's campaign uses it.
  SELECT coalesce(array_agg(acct), '{}') INTO v_accounts FROM unnest(v_accounts) acct
   WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_campaigns c
                      WHERE coalesce(nullif(c.raw_data->>'metaAccountId', ''), c.meta_account_id) = acct
                        AND public.cockpit_csm_name_key(c.raw_data->>'clientName') IS DISTINCT FROM v_key
                        AND public.cockpit_csm_name_key(c.client_name) IS DISTINCT FROM v_key);

  -- Names only this client uses: no other client's campaign has it, and no
  -- tree ad carries it on an account outside this client's pairs.
  SELECT coalesce(array_agg(n), '{}') INTO v_unshared FROM unnest(v_names) n
   WHERE NOT (n = ANY(v_other_names))
     AND NOT EXISTS (SELECT 1 FROM public.cockpit_media_sources s
                      WHERE s.table_name = 'metaTree' AND s.data->>'kind' = 'ad' AND s.data->>'campaignName' = n
                        AND NOT ((n || chr(31) || coalesce(s.data->>'accountId', '')) = ANY(v_pairs))
                        AND NOT (n = ANY(v_loose)));

  -- This client's tree ads: its own pair, an account no other client uses,
  -- or (for a campaign with no account on record) a name no one else uses.
  SELECT coalesce(array_agg(DISTINCT s.data->>'metaId'), '{}') INTO v_tree
    FROM public.cockpit_media_sources s
   WHERE s.table_name = 'metaTree' AND s.data->>'kind' = 'ad' AND s.data->>'metaId' ~ '^[0-9]{5,25}$'
     AND (((s.data->>'campaignName') || chr(31) || coalesce(s.data->>'accountId', '')) = ANY(v_pairs)
          OR s.data->>'accountId' = ANY(v_accounts)
          OR (s.data->>'campaignName' = ANY(v_loose) AND s.data->>'campaignName' = ANY(v_unshared)));

  SELECT coalesce(array_agg(DISTINCT x.id), '{}') INTO v_ids FROM (
    SELECT unnest(v_tree) AS id
    UNION SELECT a.meta_ad_id FROM public.cockpit_ads a WHERE a.campaign_name = ANY(v_unshared)
    UNION SELECT d.data->>'metaAdId' FROM public.cockpit_media_daily_stats d WHERE d.campaign_name = ANY(v_unshared)
  ) x WHERE x.id ~ '^[0-9]{5,25}$';

  -- Every ad of every campaign that is not this client's: tree ads by pair
  -- (by name when that campaign has no account), board and daily rows by name
  -- unless the tree places that ad in one of this client's pairs.
  SELECT coalesce(array_agg(DISTINCT x.id), '{}') INTO v_other FROM (
    SELECT s.data->>'metaId' AS id FROM public.cockpit_media_sources s
     WHERE s.table_name = 'metaTree' AND s.data->>'kind' = 'ad'
       AND (((s.data->>'campaignName') || chr(31) || coalesce(s.data->>'accountId', '')) = ANY(v_other_pairs)
            OR ((s.data->>'campaignName') || chr(31)) = ANY(v_other_pairs))
    UNION SELECT a.meta_ad_id FROM public.cockpit_ads a
     WHERE a.campaign_name = ANY(v_other_names) AND NOT (a.meta_ad_id = ANY(v_tree))
    UNION SELECT d.data->>'metaAdId' FROM public.cockpit_media_daily_stats d
     WHERE d.campaign_name = ANY(v_other_names) AND NOT ((d.data->>'metaAdId') = ANY(v_tree))
  ) x WHERE x.id ~ '^[0-9]{5,25}$';
  v_ids := ARRAY(SELECT i FROM unnest(v_ids) i WHERE NOT (i = ANY(v_other)));

  IF v_tree_ready IS TRUE THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'id', s.data->>'metaId', 'name', s.data->>'name', 'campaignName', s.data->>'campaignName',
             'accountId', s.data->>'accountId', 'creativeId', s.data->>'creativeId',
             'status', s.data->>'status', 'effectiveStatus', s.data->>'effectiveStatus',
             'still', CASE
               WHEN st.data IS NOT NULL THEN jsonb_build_object('url', st.data->>'url',
                 'tinyUrl', CASE WHEN st.data->>'tinyUrl' ~ native_url THEN st.data->>'tinyUrl' END)
               WHEN s.data->>'stillUrl' ~ native_url THEN jsonb_build_object('url', s.data->>'stillUrl',
                 'tinyUrl', CASE WHEN s.data->>'stillTinyUrl' ~ native_url THEN s.data->>'stillTinyUrl' END)
             END) ORDER BY s.data->>'campaignName', s.data->>'name', s.source_id), '[]'::jsonb)
      INTO v_ads
      FROM public.cockpit_media_sources s
      LEFT JOIN LATERAL (
        SELECT n.data FROM public.cockpit_native_stills n
         WHERE n.data->>'status' = 'saved' AND n.data->>'url' ~ native_url
           AND (n.key = 'c:' || (s.data->>'creativeId') OR n.key = 'a:' || (s.data->>'metaId') OR n.data->>'adId' = s.data->>'metaId')
         ORDER BY (n.key = 'c:' || (s.data->>'creativeId')) DESC, (n.key = 'a:' || (s.data->>'metaId')) DESC, n.updated_at DESC
         LIMIT 1) st ON true
     WHERE s.table_name = 'metaTree' AND s.data->>'kind' = 'ad' AND s.data->>'metaId' = ANY(v_ids)
       AND s.data->>'metaId' = ANY(v_tree);
  END IF;

  IF v_fun_ready IS TRUE THEN
    SELECT coalesce(jsonb_agg(f.item ORDER BY f.item->>'kind', f.item->>'formName', f.item->>'sourceId'), '[]'::jsonb) INTO v_funnels
      FROM (
        SELECT DISTINCT ON (coalesce(nullif(c.data->>'formId', ''), c.source_id))
          jsonb_build_object(
            'sourceId', c.source_id,
            'formId', nullif(c.data->>'formId', ''),
            'formName', c.data->>'formName',
            'kind', c.data->>'kind',
            'headline', c.data->>'headline',
            'url', c.data->>'url',
            'followUpUrl', c.data->>'followUpUrl',
            'formStatus', c.data->>'formStatus',
            'staleReason', c.data->>'staleReason',
            'checkedAt', c.data->>'formCheckedAt',
            'questions', coalesce((
              SELECT jsonb_agg(jsonb_build_object(
                       'type', q->>'type', 'label', q->>'label', 'isGate', q->'isGate' = 'true'::jsonb,
                       'options', CASE WHEN jsonb_typeof(q->'options') = 'array' THEN
                         (SELECT coalesce(jsonb_agg(o) FILTER (WHERE jsonb_typeof(o) = 'string'), '[]'::jsonb)
                            FROM jsonb_array_elements(q->'options') o) ELSE '[]'::jsonb END) ORDER BY qi)
                FROM jsonb_array_elements(CASE WHEN jsonb_typeof(c.data->'questions') = 'array' THEN c.data->'questions' ELSE '[]'::jsonb END)
                     WITH ORDINALITY qq(q, qi)
               WHERE jsonb_typeof(q) = 'object'), '[]'::jsonb),
            'adIds', (SELECT coalesce(jsonb_agg(DISTINCT a->>'adId'), '[]'::jsonb) FROM jsonb_array_elements(c.data->'ads') a
                       WHERE a->>'adId' = ANY(v_ids))) AS item
          FROM public.cockpit_creative_sources c
         WHERE c.table_name = 'funnels' AND jsonb_typeof(c.data->'ads') = 'array'
           AND EXISTS (SELECT 1 FROM jsonb_array_elements(c.data->'ads') a WHERE a->>'adId' = ANY(v_ids))
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c.data->'ads') a WHERE a->>'adId' = ANY(v_other))
         ORDER BY coalesce(nullif(c.data->>'formId', ''), c.source_id), (c.source_id LIKE 'native:%') DESC,
                  c.data->>'formCheckedAt' DESC NULLS LAST, c.source_id) f;
  END IF;

  RETURN jsonb_build_object(
    'match', v_match, 'note', v_note, 'campaigns', v_campaigns,
    'ads', v_ads, 'adsAt', v_tree_at, 'adsReady', coalesce(v_tree_ready, false),
    'funnels', v_funnels, 'funnelsAt', v_fun_at, 'funnelsReady', coalesce(v_fun_ready, false));
END $$;

-- A trimmed text value; blank means "remove the key".
CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_text(p_value jsonb, p_max integer, p_what text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE s text;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_value) <> 'string' THEN RAISE EXCEPTION '% must be text', p_what; END IF;
  s := btrim(p_value #>> '{}');
  IF s = '' THEN RETURN NULL; END IF;
  IF char_length(s) > p_max THEN RAISE EXCEPTION '% is too long. Keep it under % characters', p_what, p_max; END IF;
  RETURN to_jsonb(s);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_choice(p_value jsonb, p_allowed text[], p_what text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p_value) <> 'string' OR NOT ((p_value #>> '{}') = ANY(p_allowed)) THEN
    RAISE EXCEPTION '% must be one of: %', p_what, array_to_string(p_allowed, ', ');
  END IF;
  RETURN p_value;
END $$;

-- A creative on the tray: one of this client's ready uploads (its id) or one
-- of this client's Meta ads (its Meta id). The cover takes custom uploads only.
CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_creative_ok(p_task_id text, p_ref jsonb, p_meta jsonb, p_custom_only boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN jsonb_typeof(p_ref) <> 'string' THEN false
    WHEN (p_ref #>> '{}') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN EXISTS (
      SELECT 1 FROM public.cockpit_csm_launch_ads a
       WHERE a.id = (p_ref #>> '{}')::uuid AND a.task_id = p_task_id AND a.status = 'ready'
         AND a.kind IN ('starter','custom') AND (NOT p_custom_only OR a.kind = 'custom'))
    WHEN (p_ref #>> '{}') ~ '^[0-9]{5,25}$' AND NOT p_custom_only THEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_meta->'ads') = 'array' THEN p_meta->'ads' ELSE '[]'::jsonb END) x
       WHERE x->>'id' = (p_ref #>> '{}'))
    ELSE false END
$$;

-- Checks and normalises one prep key. NULL means "remove the key". The list
-- of keys is the CONTENT.md {prep.*} row plus DESIGN.md 12.3 and 14. The
-- free-text keys CONTENT-AR.md asks to have in Arabic too take an _ar twin
-- with the same rule (service_focus_ar, goals_ar, red_lines_ar, ...).
CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_prep_value(p_task_id text, p_key text, p_value jsonb, p_meta jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  t text := coalesce(jsonb_typeof(p_value), 'null');
  out jsonb := '{}'::jsonb; arr jsonb := '[]'::jsonb; k text; e jsonb; s jsonb; n integer := 0; d date; q jsonb; opts jsonb;
  v_base text := p_key;
BEGIN
  IF p_key IS NULL OR p_key !~ '^[a-z0-9_]{1,40}$' THEN RAISE EXCEPTION 'Prep keys are short lowercase names'; END IF;
  IF p_key ~ '_ar$' AND left(p_key, -3) IN ('service_focus','selling_point','project','engineer','page_name','thank_you',
                                             'goals','red_lines','services','budget_band','gate_notes') THEN
    v_base := left(p_key, -3);
  END IF;
  IF t = 'null' THEN RETURN NULL; END IF;
  CASE
  WHEN v_base IN ('service_focus','page_name','project','engineer') THEN
    RETURN public.cockpit_csm_deck_text(p_value, 200, p_key);
  WHEN v_base = 'selling_point' THEN
    RETURN public.cockpit_csm_deck_text(p_value, 300, p_key);
  WHEN v_base = 'thank_you' THEN
    RETURN public.cockpit_csm_deck_text(p_value, 500, p_key);
  WHEN p_key IN ('starter_pack','welcome_video','booking_video','call_guide_checked','dwy_os_approved') THEN
    IF t <> 'boolean' THEN RAISE EXCEPTION '% is a yes or no', p_key; END IF;
    RETURN p_value;
  WHEN p_key = 'dialect' THEN RETURN public.cockpit_csm_deck_choice(p_value, ARRAY['kw','sa'], p_key);
  WHEN p_key = 'language' THEN RETURN public.cockpit_csm_deck_choice(p_value, ARRAY['en','ar'], p_key);
  WHEN p_key = 'service_model' THEN RETURN public.cockpit_csm_deck_choice(p_value, ARRAY['DFY','DWY'], p_key);
  WHEN p_key = 'pain' THEN RETURN public.cockpit_csm_deck_choice(p_value, ARRAY['delays','design','cost'], p_key);
  WHEN p_key = 'go_live' THEN
    IF t <> 'string' OR (p_value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Choose a valid go-live date'; END IF;
    BEGIN d := (p_value #>> '{}')::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Choose a valid go-live date'; END;
    IF to_char(d, 'YYYY-MM-DD') <> (p_value #>> '{}') OR d NOT BETWEEN DATE '2025-01-01' AND DATE '2030-12-31' THEN
      RAISE EXCEPTION 'Choose a valid go-live date';
    END IF;
    RETURN p_value;
  WHEN v_base IN ('goals','budget_band','gate_notes') THEN
    IF t <> 'object' THEN RAISE EXCEPTION '% must be a set of named lines', p_key; END IF;
    FOR k, e IN SELECT key, value FROM jsonb_each(p_value) LOOP
      n := n + 1;
      IF n > 12 THEN RAISE EXCEPTION '% holds at most 12 lines', p_key; END IF;
      IF (v_base = 'gate_notes' AND char_length(k) NOT BETWEEN 1 AND 300)
         OR (v_base <> 'gate_notes' AND k !~ '^[a-z0-9_]{1,40}$') THEN
        RAISE EXCEPTION '% has an invalid line name', p_key;
      END IF;
      s := public.cockpit_csm_deck_text(e, CASE v_base WHEN 'goals' THEN 2000 ELSE 300 END, p_key);
      IF s IS NOT NULL THEN out := out || jsonb_build_object(k, s); END IF;
    END LOOP;
    RETURN nullif(out, '{}'::jsonb);
  WHEN p_key = 'access' THEN
    IF t <> 'object' THEN RAISE EXCEPTION 'access must be a set of named statuses'; END IF;
    FOR k, e IN SELECT key, value FROM jsonb_each(p_value) LOOP
      n := n + 1;
      IF n > 16 OR k !~ '^[a-z0-9_]{1,40}$' THEN RAISE EXCEPTION 'access has an invalid row name'; END IF;
      s := public.cockpit_csm_deck_choice(e, ARRAY['done','todo','unchecked'], 'Each access status');
      IF s IS NOT NULL THEN out := out || jsonb_build_object(k, s); END IF;
    END LOOP;
    RETURN nullif(out, '{}'::jsonb);
  WHEN v_base IN ('red_lines','services','dos_donts_hidden','platforms_planned') THEN
    IF t <> 'array' THEN RAISE EXCEPTION '% must be a list', p_key; END IF;
    IF jsonb_array_length(p_value) > (CASE v_base WHEN 'red_lines' THEN 20 WHEN 'services' THEN 20 WHEN 'platforms_planned' THEN 8 ELSE 100 END) THEN
      RAISE EXCEPTION '% is too long a list', p_key;
    END IF;
    FOR e IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      s := public.cockpit_csm_deck_text(e, CASE v_base WHEN 'platforms_planned' THEN 40 WHEN 'services' THEN 120 ELSE 500 END, p_key);
      IF s IS NOT NULL AND NOT (arr @> jsonb_build_array(s)) THEN arr := arr || jsonb_build_array(s); END IF;
    END LOOP;
    RETURN nullif(arr, '[]'::jsonb);
  WHEN p_key IN ('hidden_slides','shown_slides') THEN
    IF t <> 'array' OR jsonb_array_length(p_value) > 30 THEN RAISE EXCEPTION '% must be a list of slide ids', p_key; END IF;
    FOR e IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF jsonb_typeof(e) <> 'string' OR (e #>> '{}') !~ '^[a-z0-9-]{1,40}$' THEN RAISE EXCEPTION '% must be a list of slide ids', p_key; END IF;
      IF NOT (arr @> jsonb_build_array(e)) THEN arr := arr || jsonb_build_array(e); END IF;
    END LOOP;
    RETURN nullif(arr, '[]'::jsonb);
  WHEN p_key = 'form_questions' THEN
    IF t <> 'array' OR jsonb_array_length(p_value) > 12 THEN RAISE EXCEPTION 'Type at most 12 form questions'; END IF;
    FOR q IN SELECT value FROM jsonb_array_elements(p_value) LOOP
      IF jsonb_typeof(q) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(q) x WHERE x NOT IN ('label','options','isGate','note')) THEN
        RAISE EXCEPTION 'Each form question has a label, options, isGate and an optional note';
      END IF;
      s := public.cockpit_csm_deck_text(q->'label', 300, 'A question''s label');
      IF s IS NULL THEN RAISE EXCEPTION 'Each form question needs its label'; END IF;
      opts := '[]'::jsonb;
      IF q ? 'options' AND jsonb_typeof(q->'options') <> 'null' THEN
        IF jsonb_typeof(q->'options') <> 'array' OR jsonb_array_length(q->'options') > 12 THEN
          RAISE EXCEPTION 'A question has at most 12 options';
        END IF;
        FOR e IN SELECT value FROM jsonb_array_elements(q->'options') LOOP
          IF public.cockpit_csm_deck_text(e, 120, 'An option') IS NOT NULL THEN
            opts := opts || jsonb_build_array(public.cockpit_csm_deck_text(e, 120, 'An option'));
          END IF;
        END LOOP;
      END IF;
      IF q ? 'isGate' AND jsonb_typeof(q->'isGate') NOT IN ('boolean','null') THEN RAISE EXCEPTION 'isGate is a yes or no'; END IF;
      arr := arr || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'label', s, 'options', opts, 'isGate', coalesce(q->'isGate' = 'true'::jsonb, false),
        'note', public.cockpit_csm_deck_text(q->'note', 200, 'A question''s note'))));
    END LOOP;
    RETURN nullif(arr, '[]'::jsonb);
  WHEN p_key IN ('their_pick','cover_creative') THEN
    IF NOT public.cockpit_csm_deck_creative_ok(p_task_id, p_value, p_meta, p_key = 'cover_creative') THEN
      RAISE EXCEPTION '%', CASE p_key WHEN 'cover_creative' THEN 'Pick one of this client''s own uploaded custom creatives for the cover'
                                      ELSE 'Pick one of this client''s creatives' END;
    END IF;
    RETURN p_value;
  WHEN p_key = 'phones' THEN
    IF t <> 'object' THEN RAISE EXCEPTION 'phones maps feed, reels and facebook to creatives'; END IF;
    FOR k, e IN SELECT key, value FROM jsonb_each(p_value) LOOP
      IF k NOT IN ('feed','reels','facebook') THEN RAISE EXCEPTION 'phones maps feed, reels and facebook to creatives'; END IF;
      IF jsonb_typeof(e) = 'null' THEN CONTINUE; END IF;
      IF NOT public.cockpit_csm_deck_creative_ok(p_task_id, e, p_meta, false) THEN RAISE EXCEPTION 'Pick one of this client''s creatives for each phone'; END IF;
      out := out || jsonb_build_object(k, e);
    END LOOP;
    RETURN nullif(out, '{}'::jsonb);
  WHEN p_key = 'meta_ad_text' THEN
    IF t <> 'object' THEN RAISE EXCEPTION 'meta_ad_text maps this client''s Meta ad ids to their text'; END IF;
    FOR k, e IN SELECT key, value FROM jsonb_each(p_value) LOOP
      n := n + 1;
      IF n > 50 OR NOT public.cockpit_csm_deck_creative_ok(p_task_id, to_jsonb(k), p_meta, false) OR k !~ '^[0-9]{5,25}$' THEN
        RAISE EXCEPTION 'meta_ad_text maps this client''s Meta ad ids to their text';
      END IF;
      IF jsonb_typeof(e) = 'null' THEN CONTINUE; END IF;
      IF jsonb_typeof(e) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(e) x WHERE x NOT IN ('primary_text','headline','cta','language','placement')) THEN
        RAISE EXCEPTION 'An ad''s text has primary_text, headline, cta, language and placement';
      END IF;
      s := jsonb_strip_nulls(jsonb_build_object(
        'primary_text', public.cockpit_csm_deck_text(e->'primary_text', 2200, 'Primary text'),
        'headline', public.cockpit_csm_deck_text(e->'headline', 255, 'The headline'),
        'cta', public.cockpit_csm_deck_choice(e->'cta', ARRAY['LEARN_MORE','GET_QUOTE','BOOK_NOW','CONTACT_US','SIGN_UP','SEND_WHATSAPP_MESSAGE','APPLY_NOW'], 'The call to action'),
        'language', public.cockpit_csm_deck_choice(e->'language', ARRAY['ar','en'], 'The ad language'),
        'placement', public.cockpit_csm_deck_choice(e->'placement', ARRAY['feed','reels','facebook'], 'The placement')));
      IF s <> '{}'::jsonb THEN out := out || jsonb_build_object(k, s); END IF;
    END LOOP;
    RETURN nullif(out, '{}'::jsonb);
  WHEN p_key = 'form_confirmed' THEN
    IF t <> 'string' OR NOT EXISTS (
         SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_meta->'funnels') = 'array' THEN p_meta->'funnels' ELSE '[]'::jsonb END) f
          WHERE f->>'formId' = (p_value #>> '{}') OR f->>'sourceId' = (p_value #>> '{}')) THEN
      RAISE EXCEPTION 'Tick a form from this client''s own campaigns';
    END IF;
    RETURN p_value;
  WHEN p_key IN ('creative_agreed_at','onboarding_presented_at') THEN
    -- Stamped by the server; a client clock is never trusted. false clears it.
    IF p_value = 'false'::jsonb THEN RETURN NULL; END IF;
    IF t NOT IN ('boolean','string') THEN RAISE EXCEPTION '% is set with true and cleared with null', p_key; END IF;
    RETURN to_jsonb(to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  ELSE
    RAISE EXCEPTION 'Prep does not keep "%"', p_key;
  END CASE;
END $$;

REVOKE ALL ON FUNCTION
  public.cockpit_csm_deck_audit(),
  public.cockpit_csm_launch_ad_json(public.cockpit_csm_launch_ads),
  public.cockpit_csm_launch_ads_rows(text, boolean),
  public.cockpit_csm_deck_prep_both(text),
  public.cockpit_csm_deck_meta(text, text),
  public.cockpit_csm_deck_text(jsonb, integer, text),
  public.cockpit_csm_deck_choice(jsonb, text[], text),
  public.cockpit_csm_deck_creative_ok(text, jsonb, jsonb, boolean),
  public.cockpit_csm_deck_prep_value(text, text, jsonb, jsonb)
FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_sources(p_task_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb; v_name text; c jsonb; v_logo jsonb; v_ghl jsonb; v_loc text; v_editor jsonb; v_dos jsonb; v_kit jsonb;
  v_callers jsonb; v_next jsonb; v_last jsonb; v_presenter jsonb; v_notes text[] := '{}';
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  v_name := g->>'clientName';
  -- The presenting seat: its first name goes on the two covers only (CONTENT.md copy rule 8).
  SELECT jsonb_build_object('email', m.email, 'firstName',
           CASE WHEN m.name LIKE '%@%' THEN NULL ELSE nullif(split_part(btrim(coalesce(m.name, '')), ' ', 1), '') END)
    INTO v_presenter FROM public.cockpit_members m WHERE m.auth_user_id = auth.uid() AND m.active LIMIT 1;
  SELECT s.data INTO c FROM public.cockpit_csm_sources s WHERE s.table_name = 'clients' AND s.data->>'taskId' = p_task_id;

  SELECT jsonb_build_object('bucket', 'cockpit-client-logos', 'path', l.storage_path, 'verifiedAt', l.verified_at)
    INTO v_logo FROM public.cockpit_client_logos l
   WHERE l.clickup_task_id = p_task_id ORDER BY l.verified_at DESC LIMIT 1;

  SELECT jsonb_build_object(
           'name', nullif(btrim(x.client_name), ''),
           -- The roster writes Qatar as QT; the decks key on ISO codes.
           'country', CASE upper(nullif(btrim(x.country), '')) WHEN 'QT' THEN 'QA' ELSE upper(nullif(btrim(x.country), '')) END,
           'city', nullif(btrim(x.city), ''), 'language', lower(nullif(btrim(x.language), '')),
           'serviceMode', upper(nullif(btrim(x.service_mode), ''))),
         nullif(btrim(x.location_id), '')
    INTO v_ghl, v_loc FROM public.ghl_clients x WHERE x.clickup_id = p_task_id;
  IF v_ghl IS NULL THEN v_notes := v_notes || 'No HighLevel account row carries this card, so country, language and callers are unknown.'::text; END IF;

  SELECT jsonb_build_object(
           'offer', nullif(btrim(e.offer), ''), 'offerUrl', nullif(btrim(e.offer_url), ''),
           'brandDna', nullif(btrim(e.brand_dna), ''), 'brandDnaUrl', nullif(btrim(e.brand_dna_url), ''),
           'driveUrl', nullif(btrim(e.drive_url), ''), 'website', nullif(btrim(e.website), ''),
           'instagram', nullif(btrim(e.instagram), ''), 'readAt', e.docs_read_at, 'syncedAt', e.synced_at),
         jsonb_build_object('text', nullif(btrim(e.dos_donts), ''), 'source', 'The client card''s Do''s & Don''ts field', 'syncedAt', e.synced_at)
    INTO v_editor, v_dos FROM public.editor_clients e WHERE e.task_id = p_task_id;
  IF v_editor IS NULL THEN v_notes := v_notes || 'The client card has not been read by the editor desk, so the offer and Do''s & Don''ts are unknown.'::text; END IF;

  SELECT jsonb_build_object(
           'onboardingCallOn', o.onboarding_call_on, 'launchOn', o.launch_on, 'signupOn', o.signup_on,
           'links', jsonb_strip_nulls(jsonb_build_object(
             'drive', CASE WHEN jsonb_typeof(o.links->'drive') = 'string' THEN o.links->>'drive' END,
             'driveFolder', CASE WHEN jsonb_typeof(o.links->'drive_folder') = 'string' THEN o.links->>'drive_folder' END,
             'onboardingMap', CASE WHEN jsonb_typeof(o.links->'onboarding_map') = 'string' THEN o.links->>'onboarding_map' END,
             'website', CASE WHEN jsonb_typeof(o.links->'website') = 'string' THEN o.links->>'website' END)),
           'syncedAt', o.synced_at)
    INTO v_kit FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_task_id;

  IF v_loc IS NOT NULL THEN
    BEGIN
      SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('firstName',
               CASE WHEN r.name LIKE '%@%' OR nullif(btrim(r.name), '') IS NULL THEN NULL ELSE split_part(btrim(r.name), ' ', 1) END)), '[]'::jsonb)
        INTO v_callers FROM public.cockpit_client_caller_rows() r WHERE r.location_id = v_loc;
    EXCEPTION WHEN OTHERS THEN
      v_callers := NULL;
      v_notes := v_notes || 'The dialer''s caller assignments could not be read.'::text;
    END;
  END IF;

  SELECT coalesce(jsonb_object_agg(x.kind, jsonb_build_object('startsAt', x.starts_at, 'endsAt', x.ends_at, 'status', x.status)), '{}'::jsonb)
    INTO v_next
    FROM (SELECT DISTINCT ON (k.kind) k.kind, k.starts_at, k.ends_at, k.status FROM public.cockpit_csm_calls k
           WHERE k.task_id = p_task_id AND k.kind <> 'other' AND k.starts_at > now() AND k.status IN ('booked','confirmed')
           ORDER BY k.kind, k.starts_at) x;
  SELECT coalesce(jsonb_object_agg(x.kind, jsonb_build_object('startsAt', x.starts_at, 'endsAt', x.ends_at, 'status', x.status)), '{}'::jsonb)
    INTO v_last
    FROM (SELECT DISTINCT ON (k.kind) k.kind, k.starts_at, k.ends_at, k.status FROM public.cockpit_csm_calls k
           WHERE k.task_id = p_task_id AND k.kind <> 'other' AND k.starts_at <= now() AND k.status IN ('held','showed','confirmed','booked')
           ORDER BY k.kind, k.starts_at DESC) x;

  RETURN jsonb_build_object(
    'taskId', p_task_id, 'clientName', v_name, 'at', now(), 'presenter', v_presenter,
    'client', CASE WHEN c IS NULL THEN NULL ELSE jsonb_build_object(
      'stage', c->>'stage', 'service', nullif(btrim(c->>'service'), ''), 'launchDate', c->'launchDate', 'bucket', c->>'bucket') END,
    'logo', v_logo, 'ghl', v_ghl, 'editor', v_editor, 'dosDonts', v_dos, 'kit', v_kit, 'callers', v_callers,
    'calls', jsonb_build_object('next', v_next, 'last', v_last),
    'meta', public.cockpit_csm_deck_meta(p_task_id, v_name),
    'prep', public.cockpit_csm_deck_prep_both(p_task_id),
    'launchAds', public.cockpit_csm_launch_ads_rows(p_task_id, true),
    'notes', to_jsonb(v_notes));
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_prep_read(p_task_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_csm_client_gate(p_task_id);
  RETURN public.cockpit_csm_deck_prep_both(p_task_id);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ads_read(p_task_id text, p_include_hidden boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_csm_client_gate(p_task_id);
  RETURN public.cockpit_csm_launch_ads_rows(p_task_id, p_include_hidden);
END $$;

-- One upload of this client, any status. `mine` says whether the signed-in
-- seat started it (only that seat can finish it).
CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ad_get(p_task_id text, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.cockpit_csm_launch_ads;
BEGIN
  PERFORM public.cockpit_csm_client_gate(p_task_id);
  SELECT * INTO a FROM public.cockpit_csm_launch_ads x WHERE x.id = p_id AND x.task_id = p_task_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'That file is not one of this client''s uploads' USING ERRCODE = '42501'; END IF;
  RETURN public.cockpit_csm_launch_ad_json(a) || jsonb_build_object('mine', a.created_by = auth.uid());
END $$;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_prep_save(p_task_id text, p_deck text, p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb; cur public.cockpit_csm_deck_prep; merged jsonb; k text; v jsonb; nv jsonb; v_meta jsonb;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  IF p_deck IS NULL OR p_deck NOT IN ('onboarding','launch') THEN RAISE EXCEPTION 'Choose the onboarding or the launch deck'; END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'Send the prep changes as named values';
  END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(p_patch)) > 40 THEN RAISE EXCEPTION 'Send at most 40 prep changes at once'; END IF;
  -- Two windows (prep and notes) save the same row: one merge at a time.
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_csm_deck_prep:' || p_task_id || ':' || p_deck, 0));
  SELECT * INTO cur FROM public.cockpit_csm_deck_prep p WHERE p.task_id = p_task_id AND p.deck = p_deck FOR UPDATE;
  merged := coalesce(cur.overrides, '{}'::jsonb);
  IF EXISTS (SELECT 1 FROM jsonb_each(p_patch) x
              WHERE x.key IN ('their_pick','phones','meta_ad_text','form_confirmed') AND jsonb_typeof(x.value) <> 'null') THEN
    v_meta := public.cockpit_csm_deck_meta(p_task_id, g->>'clientName');
  END IF;
  FOR k, v IN SELECT key, value FROM jsonb_each(p_patch) LOOP
    nv := public.cockpit_csm_deck_prep_value(p_task_id, k, v, v_meta);
    -- A stamp keeps its first time until it is cleared.
    IF k IN ('creative_agreed_at','onboarding_presented_at') AND nv IS NOT NULL AND merged ? k THEN CONTINUE; END IF;
    IF nv IS NULL THEN merged := merged - k; ELSE merged := merged || jsonb_build_object(k, nv); END IF;
  END LOOP;
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

-- Reserves one upload. The same request id returns the same reservation (for
-- the same seat and file only); the Edge Function then signs its upload.
CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ad_reserve(
  p_request_id uuid, p_task_id text, p_kind text, p_mime text, p_bytes bigint,
  p_width integer DEFAULT NULL, p_height integer DEFAULT NULL, p_seconds numeric DEFAULT NULL,
  p_file_name text DEFAULT NULL, p_poster_mime text DEFAULT NULL, p_poster_bytes bigint DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  g jsonb; a public.cockpit_csm_launch_ads; v_id uuid; v_ext text; v_pext text; v_name text; v_pending integer; v_count integer;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  IF p_request_id IS NULL THEN RAISE EXCEPTION 'An upload request id is required'; END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('starter','custom','logo','page') THEN RAISE EXCEPTION 'Choose starter, custom, logo or page'; END IF;
  v_ext := CASE p_mime WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp'
                       WHEN 'video/mp4' THEN 'mp4' WHEN 'video/quicktime' THEN 'mov' WHEN 'video/webm' THEN 'webm' END;
  IF v_ext IS NULL THEN RAISE EXCEPTION 'Add a picture (JPG, PNG, WebP) or a video (MP4, MOV, WebM)'; END IF;
  IF p_kind IN ('logo','page') AND p_mime NOT LIKE 'image/%' THEN RAISE EXCEPTION 'A logo or a page screenshot is a picture (JPG, PNG, WebP)'; END IF;
  IF p_bytes IS NULL OR p_bytes < 1 THEN RAISE EXCEPTION 'The file is empty'; END IF;
  IF p_bytes > 157286400 THEN RAISE EXCEPTION 'The file is over 150 MB. Export a smaller copy to keep it'; END IF;
  IF (p_width IS NOT NULL AND p_width NOT BETWEEN 1 AND 20000) OR (p_height IS NOT NULL AND p_height NOT BETWEEN 1 AND 20000)
     OR (p_seconds IS NOT NULL AND NOT (p_seconds > 0 AND p_seconds <= 3600)) THEN
    RAISE EXCEPTION 'The file''s size or length is not valid';
  END IF;
  IF (p_poster_mime IS NULL) <> (p_poster_bytes IS NULL) THEN RAISE EXCEPTION 'A poster needs its type and size'; END IF;
  IF p_poster_mime IS NOT NULL THEN
    IF p_mime NOT LIKE 'video/%' THEN RAISE EXCEPTION 'Only a video has a poster'; END IF;
    v_pext := CASE p_poster_mime WHEN 'image/jpeg' THEN 'jpg' WHEN 'image/png' THEN 'png' WHEN 'image/webp' THEN 'webp' END;
    IF v_pext IS NULL OR p_poster_bytes NOT BETWEEN 1 AND 5242880 THEN RAISE EXCEPTION 'A poster is a JPG, PNG or WebP picture up to 5 MB'; END IF;
  END IF;
  -- The name the notes window shows ("Saving kitchen-reel.mp4"): no folders, no control characters.
  v_name := nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p_file_name, ''), '^.*[/\\]', ''), '[[:cntrl:]]', '', 'g')), 200), '');

  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_csm_launch_ads:' || p_request_id::text, 0));
  SELECT * INTO a FROM public.cockpit_csm_launch_ads x WHERE x.request_id = p_request_id;
  IF a.id IS NOT NULL THEN
    IF a.created_by IS DISTINCT FROM auth.uid() OR a.task_id <> p_task_id OR a.kind <> p_kind OR a.mime <> p_mime OR a.bytes <> p_bytes
       OR a.poster_mime IS DISTINCT FROM p_poster_mime OR a.poster_bytes IS DISTINCT FROM p_poster_bytes THEN
      RAISE EXCEPTION 'This request id belongs to a different file. Add the file again' USING ERRCODE = '42501';
    END IF;
    RETURN public.cockpit_csm_launch_ad_json(a);
  END IF;
  -- A failed upload is removed by the page at once; one left by a closed tab
  -- stops counting after an hour, so the cap clears itself.
  SELECT count(*) INTO v_pending FROM public.cockpit_csm_launch_ads x
   WHERE x.created_by = auth.uid() AND x.status = 'uploading' AND x.created_at > now() - interval '1 hour';
  IF v_pending >= 30 THEN RAISE EXCEPTION 'Too many unfinished uploads in the last hour. Wait a few minutes, then add the file again'; END IF;
  SELECT count(*) INTO v_count FROM public.cockpit_csm_launch_ads x WHERE x.task_id = p_task_id AND x.status <> 'removed';
  IF v_count >= 200 THEN RAISE EXCEPTION 'This client has 200 files already. Remove some first'; END IF;

  v_id := gen_random_uuid();
  PERFORM set_config('cockpit.deck_action', 'launchAds.reserve', true);
  INSERT INTO public.cockpit_csm_launch_ads (id, request_id, task_id, kind, status, storage_path, mime, bytes, width, height, seconds,
      poster_path, poster_mime, poster_bytes, file_name, created_by, created_by_email, updated_by)
  VALUES (v_id, p_request_id, p_task_id, p_kind, 'uploading', p_task_id || '/' || v_id::text || '.' || v_ext, p_mime, p_bytes,
      p_width, p_height, p_seconds,
      CASE WHEN v_pext IS NOT NULL THEN p_task_id || '/' || v_id::text || '-poster.' || v_pext END, p_poster_mime, p_poster_bytes,
      v_name, auth.uid(), g->>'email', g->>'email')
  RETURNING * INTO a;
  RETURN public.cockpit_csm_launch_ad_json(a);
END $$;

-- The upload arrived: Storage's own metadata must match the reservation.
-- Only the seat that reserved it can accept it; a second accept is a no-op.
CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ad_accept(p_task_id text, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g jsonb; a public.cockpit_csm_launch_ads; meta jsonb; pmeta jsonb;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  SELECT * INTO a FROM public.cockpit_csm_launch_ads x WHERE x.id = p_id AND x.task_id = p_task_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'That file is not one of this client''s uploads' USING ERRCODE = '42501'; END IF;
  IF a.created_by IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the person who started this upload can finish it' USING ERRCODE = '42501';
  END IF;
  IF a.status = 'removed' THEN RAISE EXCEPTION 'This file was removed. Add it again'; END IF;
  IF a.status = 'ready' THEN RETURN public.cockpit_csm_launch_ad_json(a); END IF;
  SELECT o.metadata INTO meta FROM storage.objects o WHERE o.bucket_id = 'cockpit-launch-ads' AND o.name = a.storage_path;
  IF meta IS NULL THEN RAISE EXCEPTION 'The file did not arrive. Add it again'; END IF;
  IF coalesce(meta->>'size', '') !~ '^[0-9]{1,12}$' OR (meta->>'size')::bigint <> a.bytes
     OR lower(coalesce(meta->>'mimetype', '')) <> a.mime THEN
    RAISE EXCEPTION 'The uploaded file does not match what was reserved. Add it again';
  END IF;
  IF a.poster_path IS NOT NULL THEN
    SELECT o.metadata INTO pmeta FROM storage.objects o WHERE o.bucket_id = 'cockpit-launch-ads' AND o.name = a.poster_path;
    IF pmeta IS NULL THEN RAISE EXCEPTION 'The video''s poster did not arrive. Add the video again'; END IF;
    IF coalesce(pmeta->>'size', '') !~ '^[0-9]{1,12}$' OR (pmeta->>'size')::bigint <> a.poster_bytes
       OR lower(coalesce(pmeta->>'mimetype', '')) <> a.poster_mime THEN
      RAISE EXCEPTION 'The video''s poster does not match what was reserved. Add the video again';
    END IF;
  END IF;
  PERFORM set_config('cockpit.deck_action', 'launchAds.ready', true);
  UPDATE public.cockpit_csm_launch_ads x SET status = 'ready', ready_at = now(), updated_at = now(), updated_by = g->>'email'
   WHERE x.id = a.id RETURNING * INTO a;
  RETURN public.cockpit_csm_launch_ad_json(a);
END $$;

-- Text, placement, language, starter or custom, and hidden. A null clears a
-- text value. Any seat that can open the client may edit; unchanged is a no-op.
CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ad_update(p_task_id text, p_id uuid, p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g jsonb; cur public.cockpit_csm_launch_ads; nxt public.cockpit_csm_launch_ads; k text; v jsonb;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN RAISE EXCEPTION 'Send the changes as named values'; END IF;
  SELECT * INTO cur FROM public.cockpit_csm_launch_ads x WHERE x.id = p_id AND x.task_id = p_task_id FOR UPDATE;
  IF cur.id IS NULL THEN RAISE EXCEPTION 'That file is not one of this client''s uploads' USING ERRCODE = '42501'; END IF;
  IF cur.status = 'removed' THEN RAISE EXCEPTION 'This file was removed'; END IF;
  nxt := cur;
  FOR k, v IN SELECT key, value FROM jsonb_each(p_patch) LOOP
    CASE k
    WHEN 'hidden' THEN
      IF jsonb_typeof(v) <> 'boolean' THEN RAISE EXCEPTION 'hidden is a yes or no'; END IF;
      nxt.hidden := (v #>> '{}')::boolean;
    WHEN 'kind' THEN
      IF cur.kind NOT IN ('starter','custom') THEN RAISE EXCEPTION 'A logo or a page screenshot stays what it is'; END IF;
      nxt.kind := public.cockpit_csm_deck_choice(v, ARRAY['starter','custom'], 'kind') #>> '{}';
      IF nxt.kind IS NULL THEN RAISE EXCEPTION 'kind must be one of: starter, custom'; END IF;
    WHEN 'placement' THEN nxt.placement := public.cockpit_csm_deck_choice(v, ARRAY['feed','reels','facebook'], 'The placement') #>> '{}';
    WHEN 'primary_text' THEN nxt.primary_text := public.cockpit_csm_deck_text(v, 2200, 'Primary text') #>> '{}';
    WHEN 'headline' THEN nxt.headline := public.cockpit_csm_deck_text(v, 255, 'The headline') #>> '{}';
    WHEN 'cta' THEN nxt.cta := public.cockpit_csm_deck_choice(v, ARRAY['LEARN_MORE','GET_QUOTE','BOOK_NOW','CONTACT_US','SIGN_UP','SEND_WHATSAPP_MESSAGE','APPLY_NOW'], 'The call to action') #>> '{}';
    WHEN 'language' THEN nxt.language := public.cockpit_csm_deck_choice(v, ARRAY['ar','en'], 'The ad language') #>> '{}';
    ELSE RAISE EXCEPTION 'A creative does not keep "%"', k;
    END CASE;
  END LOOP;
  IF nxt IS NOT DISTINCT FROM cur THEN RETURN public.cockpit_csm_launch_ad_json(cur); END IF;
  PERFORM set_config('cockpit.deck_action', 'launchAds.update', true);
  UPDATE public.cockpit_csm_launch_ads x
     SET hidden = nxt.hidden, kind = nxt.kind, placement = nxt.placement, primary_text = nxt.primary_text,
         headline = nxt.headline, cta = nxt.cta, language = nxt.language, updated_at = now(), updated_by = g->>'email'
   WHERE x.id = cur.id RETURNING * INTO cur;
  RETURN public.cockpit_csm_launch_ad_json(cur);
END $$;

-- Takes a file off the tray for good, an unfinished upload included. The row
-- stays (status removed) for the audit; no new read link can be signed for it
-- because the read policy wants a ready row, but a link signed earlier works
-- until it expires (READ_SECONDS in launchAds.ts). cockpit-csm-api then
-- deletes the bytes and records it with cockpit_csm_launch_ad_purged. A
-- second remove is a no-op.
CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ad_remove(p_task_id text, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g jsonb; a public.cockpit_csm_launch_ads;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  SELECT * INTO a FROM public.cockpit_csm_launch_ads x WHERE x.id = p_id AND x.task_id = p_task_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'That file is not one of this client''s uploads' USING ERRCODE = '42501'; END IF;
  IF a.status = 'removed' THEN RETURN public.cockpit_csm_launch_ad_json(a); END IF;
  PERFORM set_config('cockpit.deck_action', 'launchAds.remove', true);
  UPDATE public.cockpit_csm_launch_ads x SET status = 'removed', removed_at = now(), updated_at = now(), updated_by = g->>'email'
   WHERE x.id = a.id RETURNING * INTO a;
  RETURN public.cockpit_csm_launch_ad_json(a);
END $$;

-- This client's files whose bytes should go: removed and not yet purged, or
-- an upload left unfinished for a day (a closed tab). At most 50 at a time.
CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ad_stale(p_task_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_csm_client_gate(p_task_id);
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'path', x.storage_path, 'posterPath', x.poster_path) ORDER BY x.created_at), '[]'::jsonb)
            FROM (SELECT a.id, a.storage_path, a.poster_path, a.created_at FROM public.cockpit_csm_launch_ads a
                   WHERE a.task_id = p_task_id
                     AND ((a.status = 'removed' AND a.purged_at IS NULL)
                          OR (a.status = 'uploading' AND a.created_at < now() - interval '1 day'))
                   ORDER BY a.created_at LIMIT 50) x);
END $$;

-- The bytes of these files were deleted from the bucket: each stale or
-- removed row of this client turns removed with its purge time (audited).
-- Ready rows, fresh uploads and other clients' ids are left alone.
CREATE OR REPLACE FUNCTION public.cockpit_csm_launch_ad_purged(p_task_id text, p_ids uuid[]) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE g jsonb; n integer;
BEGIN
  g := public.cockpit_csm_client_gate(p_task_id);
  IF p_ids IS NULL OR cardinality(p_ids) > 50 THEN RAISE EXCEPTION 'Send at most 50 files at once'; END IF;
  PERFORM set_config('cockpit.deck_action', 'launchAds.purge', true);
  UPDATE public.cockpit_csm_launch_ads x
     SET status = 'removed', removed_at = coalesce(x.removed_at, now()), purged_at = now(), updated_at = now(), updated_by = g->>'email'
   WHERE x.task_id = p_task_id AND x.id = ANY(p_ids) AND x.purged_at IS NULL
     AND (x.status = 'removed' OR (x.status = 'uploading' AND x.created_at < now() - interval '1 day'));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION
  public.cockpit_csm_launch_object_allowed(text),
  public.cockpit_csm_deck_sources(text),
  public.cockpit_csm_deck_prep_read(text),
  public.cockpit_csm_launch_ads_read(text, boolean),
  public.cockpit_csm_launch_ad_get(text, uuid),
  public.cockpit_csm_deck_prep_save(text, text, jsonb),
  public.cockpit_csm_launch_ad_reserve(uuid, text, text, text, bigint, integer, integer, numeric, text, text, bigint),
  public.cockpit_csm_launch_ad_accept(text, uuid),
  public.cockpit_csm_launch_ad_update(text, uuid, jsonb),
  public.cockpit_csm_launch_ad_remove(text, uuid),
  public.cockpit_csm_launch_ad_stale(text),
  public.cockpit_csm_launch_ad_purged(text, uuid[])
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION
  public.cockpit_csm_launch_object_allowed(text),
  public.cockpit_csm_deck_sources(text),
  public.cockpit_csm_deck_prep_read(text),
  public.cockpit_csm_launch_ads_read(text, boolean),
  public.cockpit_csm_launch_ad_get(text, uuid),
  public.cockpit_csm_deck_prep_save(text, text, jsonb),
  public.cockpit_csm_launch_ad_reserve(uuid, text, text, text, bigint, integer, integer, numeric, text, text, bigint),
  public.cockpit_csm_launch_ad_accept(text, uuid),
  public.cockpit_csm_launch_ad_update(text, uuid, jsonb),
  public.cockpit_csm_launch_ad_remove(text, uuid),
  public.cockpit_csm_launch_ad_stale(text),
  public.cockpit_csm_launch_ad_purged(text, uuid[])
TO authenticated;

COMMIT;
