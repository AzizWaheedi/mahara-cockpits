-- Upsell studio, 1 of 3: the offer catalog, its settings, the client copy
-- check and the studio's audit (docs/upsell-studio/BACKEND.md section 1).
-- Apply before 20261026v and 20261026w.
--
-- The CEO, 26 Oct 2026: "Don't put a set price yet, and make it easily
-- changeable." So every list price starts blank (amount null = "no price
-- yet") and the doc's price rides along as a one-click hint. SEO and GEO is
-- locked with its 2,500 + 2,500 split, as the doc has it. Nothing waits for
-- an approval: the CEO changes the list on Money > Offers, every change is
-- audited with a plain sentence, and a revision guard stops two tabs from
-- overwriting each other.
--
-- 1. cockpit_upsell_catalog: one row per offer (7, seeded once, never
--    overwritten by a second apply). cockpit_upsell_settings: three keys.
-- 2. cockpit_client_copy_problems(text, money_ok): every client-facing line
--    goes through it (decks, proposals, the video, the offer page). Rules
--    ported from hermes/sales-desk/desk/validate.py, plus the outcome,
--    performance number, ad metric, our own words (CSM, ad spend, list
--    price), money, lead, upsell, discount and dash rules, in English and
--    Arabic.
-- 3. Three browser functions: catalog read (a CSM seat or the CEO), catalog
--    set and setting set (the CEO only).
-- 4. cockpit_upsell_audit(): the one trigger function behind every upsell
--    table (this file attaches it to the catalog and the settings; v and w
--    attach it to theirs).
--
-- Tables: row security on, no policies, no browser grants; the service key
-- selects, inserts and updates, never deletes or truncates. Every function is
-- SECURITY DEFINER with search_path '' except cockpit_client_copy_problems
-- (IMMUTABLE, SECURITY INVOKER). The file applies twice without error.
BEGIN;

-- ---------------------------------------------------------------------------
-- Check helpers (IMMUTABLE, read no table). The table CHECKs call them, so the
-- service key may run them (a direct write with the service key passes its
-- checks); no browser role may.
-- ---------------------------------------------------------------------------

-- A dollar amount: a JSON number from 1 to 1,000,000 with at most two decimals.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_usd_ok(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_typeof(p) = 'number'
    AND (p #>> '{}')::numeric BETWEEN 1 AND 1000000
    AND (p #>> '{}')::numeric = round((p #>> '{}')::numeric, 2), false)
$$;

-- The price parts of an offer: 1 to 3 of {key, cadence, amount, hint}, keys
-- unique; amount null means "no price yet", hint is the doc's price.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_parts_ok(p_parts jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e jsonb; seen text[] := '{}'; ks text[];
BEGIN
  IF p_parts IS NULL OR jsonb_typeof(p_parts) <> 'array' OR jsonb_array_length(p_parts) NOT BETWEEN 1 AND 3 THEN RETURN false; END IF;
  FOR e IN SELECT value FROM jsonb_array_elements(p_parts) LOOP
    IF jsonb_typeof(e) <> 'object' THEN RETURN false; END IF;
    ks := ARRAY(SELECT jsonb_object_keys(e));
    IF NOT (ks @> ARRAY['key','cadence','amount','hint'] AND ks <@ ARRAY['key','cadence','amount','hint']) THEN RETURN false; END IF;
    IF jsonb_typeof(e->'key') <> 'string' OR (e->>'key') !~ '^[a-z_]{2,20}$' OR (e->>'key') = ANY(seen) THEN RETURN false; END IF;
    IF jsonb_typeof(e->'cadence') <> 'string' OR (e->>'cadence') NOT IN ('one_time','monthly','per_day','per_90_days') THEN RETURN false; END IF;
    IF jsonb_typeof(e->'amount') <> 'null' AND NOT public.cockpit_upsell_usd_ok(e->'amount') THEN RETURN false; END IF;
    IF NOT public.cockpit_upsell_usd_ok(e->'hint') THEN RETURN false; END IF;
    seen := seen || (e->>'key');
  END LOOP;
  RETURN true;
END $$;

-- A split: two dollar amounts.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_split_ok(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_typeof(p) = 'array' AND jsonb_array_length(p) = 2
    AND public.cockpit_upsell_usd_ok(p->0) AND public.cockpit_upsell_usd_ok(p->1), false)
$$;

-- A copy string: text, not blank, at most p_max characters.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_copy_text_ok(p jsonb, p_max integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_typeof(p) = 'string' AND btrim(p #>> '{}') <> '' AND char_length(p #>> '{}') <= p_max, false)
$$;

-- An offer's client copy: '{}' (not written yet) or {"en": C, "ar": C}, where
-- C has every key below (platforms for smm only), within its caps, and the
-- two languages carry the same keys and the same list keys in the same order.
-- With p_parts, C.parts names exactly the catalog's parts.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_copy_ok(p_copy jsonb, p_parts jsonb DEFAULT NULL, p_offer text DEFAULT NULL) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  lang text; c jsonb; e jsonb; k text; ks text[]; want text[]; seen text[]; list text; lo integer; hi integer; tcap integer;
  item_keys text[]; order_en jsonb := '{}'::jsonb; order_ar jsonb := '{}'::jsonb; seq jsonb;
  caps constant jsonb := '{"name":40,"deckTitle":40,"line":200,"terms":200,"timing":160,"button":40,"cta":80,"close":120}';
  lists constant jsonb := '{"get":[1,8,200],"need":[0,4,80],"steps":[1,6,160],"why":[1,3,400],"work":[0,6,0]}';
BEGIN
  IF p_copy IS NULL OR jsonb_typeof(p_copy) <> 'object' THEN RETURN false; END IF;
  IF p_copy = '{}'::jsonb THEN RETURN true; END IF;
  ks := ARRAY(SELECT jsonb_object_keys(p_copy));
  IF NOT (ks @> ARRAY['en','ar'] AND ks <@ ARRAY['en','ar']) THEN RETURN false; END IF;
  FOREACH lang IN ARRAY ARRAY['en','ar'] LOOP
    c := p_copy->lang;
    IF jsonb_typeof(c) <> 'object' THEN RETURN false; END IF;
    want := ARRAY['name','deckTitle','line','parts','terms','timing','get','need','steps','why','button','cta','close','work'];
    IF (p_offer IS NULL AND c ? 'platforms') OR p_offer = 'smm' THEN want := want || 'platforms'::text; END IF;
    ks := ARRAY(SELECT jsonb_object_keys(c));
    IF NOT (ks @> want AND ks <@ want) THEN RETURN false; END IF;
    FOR k IN SELECT jsonb_object_keys(caps) LOOP
      IF NOT public.cockpit_upsell_copy_text_ok(c->k, (caps->>k)::integer) THEN RETURN false; END IF;
    END LOOP;
    -- The bill's line names: one per catalog part.
    IF jsonb_typeof(c->'parts') <> 'object' OR c->'parts' = '{}'::jsonb THEN RETURN false; END IF;
    FOR k, e IN SELECT key, value FROM jsonb_each(c->'parts') LOOP
      IF NOT public.cockpit_upsell_copy_text_ok(e, 120) THEN RETURN false; END IF;
    END LOOP;
    IF p_parts IS NOT NULL THEN
      ks := ARRAY(SELECT jsonb_object_keys(c->'parts'));
      want := ARRAY(SELECT x->>'key' FROM jsonb_array_elements(p_parts) x);
      IF NOT (ks @> want AND ks <@ want) THEN RETURN false; END IF;
    END IF;
    IF c ? 'platforms' THEN
      IF jsonb_typeof(c->'platforms') <> 'object' THEN RETURN false; END IF;
      ks := ARRAY(SELECT jsonb_object_keys(c->'platforms'));
      want := ARRAY['instagram','tiktok','snapchat','facebook'];
      IF NOT (ks @> want AND ks <@ want) THEN RETURN false; END IF;
      FOR k, e IN SELECT key, value FROM jsonb_each(c->'platforms') LOOP
        IF NOT public.cockpit_upsell_copy_text_ok(e, 120) THEN RETURN false; END IF;
      END LOOP;
    END IF;
    FOR list IN SELECT jsonb_object_keys(lists) LOOP
      lo := (lists->list->>0)::integer; hi := (lists->list->>1)::integer; tcap := (lists->list->>2)::integer;
      IF jsonb_typeof(c->list) <> 'array' OR jsonb_array_length(c->list) NOT BETWEEN lo AND hi THEN RETURN false; END IF;
      item_keys := CASE list WHEN 'why' THEN ARRAY['key','label','text'] WHEN 'work' THEN ARRAY['key','label','url'] ELSE ARRAY['key','text'] END;
      seen := '{}';
      FOR e IN SELECT value FROM jsonb_array_elements(c->list) LOOP
        IF jsonb_typeof(e) <> 'object' THEN RETURN false; END IF;
        ks := ARRAY(SELECT jsonb_object_keys(e));
        IF NOT (ks @> item_keys AND ks <@ item_keys) THEN RETURN false; END IF;
        IF jsonb_typeof(e->'key') <> 'string' OR (e->>'key') !~ '^[a-z0-9_]{1,30}$' OR (e->>'key') = ANY(seen) THEN RETURN false; END IF;
        seen := seen || (e->>'key');
        IF list = 'work' THEN
          IF NOT public.cockpit_upsell_copy_text_ok(e->'label', 60) OR jsonb_typeof(e->'url') <> 'string'
             OR (e->>'url') !~ '^https://[^[:space:]<>"'']+$' OR char_length(e->>'url') > 308 THEN RETURN false; END IF;
        ELSE
          IF NOT public.cockpit_upsell_copy_text_ok(e->'text', tcap) THEN RETURN false; END IF;
          IF list = 'why' AND NOT public.cockpit_upsell_copy_text_ok(e->'label', 60) THEN RETURN false; END IF;
        END IF;
      END LOOP;
      seq := to_jsonb(seen);
      IF lang = 'en' THEN order_en := order_en || jsonb_build_object(list, seq); ELSE order_ar := order_ar || jsonb_build_object(list, seq); END IF;
    END LOOP;
  END LOOP;
  -- get, need, steps and why: the same keys in the same order in both languages.
  RETURN (order_en - 'work') = (order_ar - 'work');
END $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.cockpit_upsell_catalog (
  offer_key text PRIMARY KEY CHECK (offer_key IN ('website','second_campaign','seo_geo','smm','ugc','closer','cameraman')),
  sort smallint NOT NULL UNIQUE CHECK (sort BETWEEN 1 AND 7),
  parts jsonb NOT NULL CHECK (public.cockpit_upsell_parts_ok(parts)),
  locked boolean NOT NULL DEFAULT false,
  split_allowed boolean NOT NULL DEFAULT false,
  split_parts jsonb CHECK (split_parts IS NULL OR jsonb_typeof(split_parts) = 'array'),
  min_months smallint CHECK (min_months IS NULL OR min_months BETWEEN 1 AND 24),
  waits_on text CHECK (waits_on IS NULL OR char_length(waits_on) BETWEEN 1 AND 160),
  copy jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (btrim(updated_by) <> ''),
  CONSTRAINT cockpit_upsell_catalog_split CHECK (split_parts IS NULL OR public.cockpit_upsell_split_ok(split_parts)),
  CONSTRAINT cockpit_upsell_catalog_copy CHECK (public.cockpit_upsell_copy_ok(copy, parts, offer_key))
);

CREATE TABLE IF NOT EXISTS public.cockpit_upsell_settings (
  key text PRIMARY KEY CHECK (key IN ('whatsapp_number','valid_days','door_live')),
  value text NOT NULL CHECK (char_length(value) BETWEEN 1 AND 40),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (btrim(updated_by) <> ''),
  CONSTRAINT cockpit_upsell_settings_value CHECK (
    (key = 'whatsapp_number' AND value ~ '^[0-9]{8,15}$')
    OR (key = 'valid_days' AND value ~ '^[0-9]{1,2}$' AND value::integer BETWEEN 7 AND 90)
    OR (key = 'door_live' AND value IN ('true','false')))
);

ALTER TABLE public.cockpit_upsell_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_upsell_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_upsell_catalog, public.cockpit_upsell_settings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.cockpit_upsell_catalog, public.cockpit_upsell_settings TO service_role;

-- ---------------------------------------------------------------------------
-- The audit: one cockpit_audit_log row per write to any upsell table
-- ---------------------------------------------------------------------------

-- The functions name the action in the transaction-local cockpit.upsell_action
-- and the CEO card's sentence in cockpit.upsell_line (metadata.line). A
-- proposal row records only the keys the write changed; its frozen copy
-- (sent_content) only when it is sent or its link updated.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  old_row jsonb; new_row jsonb; row_any jsonb; keys text[]; who text; act text; line text; entity text; b jsonb; a jsonb;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN old_row := to_jsonb(OLD); END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN new_row := to_jsonb(NEW); END IF;
  row_any := coalesce(new_row, old_row);
  SELECT coalesce(array_agg(x.k ORDER BY x.k), '{}') INTO keys
    FROM (SELECT k FROM jsonb_object_keys(coalesce(old_row, '{}'::jsonb)) k
          UNION SELECT k FROM jsonb_object_keys(coalesce(new_row, '{}'::jsonb)) k) x
   WHERE (old_row->x.k) IS DISTINCT FROM (new_row->x.k);
  act := coalesce(nullif(current_setting('cockpit.upsell_action', true), ''), lower(TG_OP));
  line := nullif(current_setting('cockpit.upsell_line', true), '');
  entity := CASE TG_TABLE_NAME WHEN 'cockpit_upsell_catalog' THEN row_any->>'offer_key'
                               WHEN 'cockpit_upsell_settings' THEN row_any->>'key'
                               ELSE row_any->>'id' END;
  IF TG_TABLE_NAME = 'cockpit_upsell_proposals' THEN
    SELECT jsonb_object_agg(k, old_row->k) FILTER (WHERE old_row ? k),
           jsonb_object_agg(k, new_row->k) FILTER (WHERE new_row ? k)
      INTO b, a
      FROM unnest(keys) k
     WHERE k <> 'sent_content' OR act IN ('upsellProposal.send','upsellProposal.updateLink');
    IF old_row IS NOT NULL THEN old_row := coalesce(b, '{}'::jsonb) || jsonb_build_object('id', row_any->'id'); END IF;
    IF new_row IS NOT NULL THEN new_row := coalesce(a, '{}'::jsonb) || jsonb_build_object('id', row_any->'id'); END IF;
  END IF;
  SELECT lower(btrim(u.email)) INTO who FROM auth.users u WHERE u.id = auth.uid();
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES (act, TG_TABLE_NAME, entity, coalesce(who, session_user), 'client-success', 'supabase', old_row, new_row,
          jsonb_strip_nulls(jsonb_build_object('op', TG_OP, 'task_id', row_any->>'task_id', 'offer_key', row_any->>'offer_key',
                                               'changed', to_jsonb(keys), 'line', line,
                                               'database_role', current_setting('role', true))));
  RETURN coalesce(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS cockpit_upsell_catalog_audit ON public.cockpit_upsell_catalog;
CREATE TRIGGER cockpit_upsell_catalog_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_upsell_catalog
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_upsell_audit();
DROP TRIGGER IF EXISTS cockpit_upsell_settings_audit ON public.cockpit_upsell_settings;
CREATE TRIGGER cockpit_upsell_settings_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_upsell_settings
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_upsell_audit();

-- ---------------------------------------------------------------------------
-- The seed: every amount blank, the doc's prices as hints (applied once)
-- ---------------------------------------------------------------------------

SELECT set_config('cockpit.upsell_action', 'upsellCatalog.seed', true), set_config('cockpit.upsell_line', 'Seeded with every price blank', true);
INSERT INTO public.cockpit_upsell_catalog (offer_key, sort, parts, locked, split_allowed, split_parts, min_months, waits_on, updated_by)
VALUES
  ('website', 1, '[{"key":"build","cadence":"one_time","amount":null,"hint":2000},{"key":"care","cadence":"monthly","amount":null,"hint":200}]',
   false, false, NULL, NULL, NULL, 'migration'),
  ('second_campaign', 2, '[{"key":"monthly","cadence":"monthly","amount":null,"hint":500}]',
   false, false, NULL, NULL, 'Deck and video follow the website.', 'migration'),
  ('seo_geo', 3, '[{"key":"program","cadence":"per_90_days","amount":null,"hint":5000}]',
   true, true, '[2500,2500]', NULL, 'Needs a delivery owner, a fulfilment list and proof.', 'migration'),
  ('smm', 4, '[{"key":"monthly","cadence":"monthly","amount":null,"hint":1000}]',
   false, false, NULL, NULL, 'Needs a delivery owner, a fulfilment list and proof.', 'migration'),
  ('cameraman', 5, '[{"key":"day","cadence":"per_day","amount":null,"hint":800}]',
   false, false, NULL, NULL, 'Needs a cameraman listed for the client''s city.', 'migration'),
  ('ugc', 6, '[{"key":"package","cadence":"one_time","amount":null,"hint":3500}]',
   false, false, NULL, NULL, 'Needs real UGC videos we produced.', 'migration'),
  ('closer', 7, '[{"key":"placement","cadence":"one_time","amount":null,"hint":4000},{"key":"management","cadence":"monthly","amount":null,"hint":750}]',
   false, false, NULL, 3, 'Needs a named recruiter.', 'migration')
ON CONFLICT (offer_key) DO NOTHING;
SELECT set_config('cockpit.upsell_action', 'upsellSettings.seed', true), set_config('cockpit.upsell_line', '', true);
-- whatsapp_number stays absent: the client page then shows no Yes button and
-- says to message the account manager.
INSERT INTO public.cockpit_upsell_settings (key, value, updated_by)
VALUES ('valid_days', '30', 'migration'), ('door_live', 'false', 'migration')
ON CONFLICT (key) DO NOTHING;
SELECT set_config('cockpit.upsell_action', '', true);

-- ---------------------------------------------------------------------------
-- Internal helpers (no grant to any role)
-- ---------------------------------------------------------------------------

-- The offer's name in the CEO card's sentences.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_offer_name(p_offer text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE p_offer WHEN 'website' THEN 'Website' WHEN 'second_campaign' THEN 'Second campaign'
    WHEN 'seo_geo' THEN 'SEO and GEO' WHEN 'smm' THEN 'Social media' WHEN 'cameraman' THEN 'Cameraman day'
    WHEN 'ugc' THEN 'UGC videos' WHEN 'closer' THEN 'Closer placement' ELSE p_offer END
$$;

-- A price part's name in a sentence ("Website care plan"), never its raw key.
-- p_mid lowers the first letter for the middle of a sentence ("Type a price
-- for the website care plan."), unless the name starts with an acronym.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_part_name(p_offer text, p_key text, p_mid boolean DEFAULT false) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN coalesce(p_mid, false) AND x.n !~ '^[A-Z]{2}' THEN lower(left(x.n, 1)) || substr(x.n, 2) ELSE x.n END
    FROM (SELECT CASE p_offer || '/' || p_key
      WHEN 'website/build' THEN 'Website build' WHEN 'website/care' THEN 'Website care plan'
      WHEN 'second_campaign/monthly' THEN 'Second campaign, monthly' WHEN 'seo_geo/program' THEN 'SEO and GEO, 90 days'
      WHEN 'smm/monthly' THEN 'Social media, monthly' WHEN 'cameraman/day' THEN 'Cameraman day'
      WHEN 'ugc/package' THEN 'UGC videos' WHEN 'closer/placement' THEN 'Closer placement'
      WHEN 'closer/management' THEN 'Closer management, monthly'
      ELSE public.cockpit_upsell_offer_name(p_offer) || ' ' || replace(p_key, '_', ' ') END AS n) x
$$;

-- Typed or catalog text placed inside a longer sentence: trimmed, without its
-- closing full stop, so a line never reads "website., by the CEO".
CREATE OR REPLACE FUNCTION public.cockpit_upsell_clause(p text) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT nullif(rtrim(btrim(p), '.!?؟ '), '')
$$;

-- Today in Kuwait. The team works on Gulf time; the database clock is UTC,
-- so between midnight and 03:00 its own date is still yesterday.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_today() RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (now() AT TIME ZONE 'Asia/Kuwait')::date
$$;

-- The Kuwait day of a moment, for day labels and day windows.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_kday(p timestamptz) RETURNS date
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (p AT TIME ZONE 'Asia/Kuwait')::date
$$;

-- 2,000 or 1,999.50 (dollars, without the sign); blank for null.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_money(p numeric) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN p IS NULL THEN 'blank'
    WHEN round(p, 2) = trunc(p) THEN to_char(trunc(p), 'FM999,999,999,990')
    ELSE to_char(round(p, 2), 'FM999,999,999,990.00') END
$$;

CREATE OR REPLACE FUNCTION public.cockpit_upsell_catalog_json(r public.cockpit_upsell_catalog) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'offerKey', r.offer_key, 'sort', r.sort, 'parts', r.parts, 'locked', r.locked,
    'splitAllowed', r.split_allowed, 'splitParts', r.split_parts, 'minMonths', r.min_months,
    'waitsOn', r.waits_on, 'copy', r.copy, 'revision', r.revision,
    'updatedAt', to_jsonb(r.updated_at), 'updatedBy', r.updated_by)
$$;

CREATE OR REPLACE FUNCTION public.cockpit_upsell_settings_json() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'whatsappNumber', (SELECT s.value FROM public.cockpit_upsell_settings s WHERE s.key = 'whatsapp_number'),
    'validDays', coalesce((SELECT s.value::integer FROM public.cockpit_upsell_settings s WHERE s.key = 'valid_days'), 30),
    'doorLive', coalesce((SELECT s.value = 'true' FROM public.cockpit_upsell_settings s WHERE s.key = 'door_live'), false))
$$;

-- The list price of an offer as {partKey: amount|null}.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_list_of(p_parts jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_object_agg(x->>'key', x->'amount'), '{}'::jsonb) FROM jsonb_array_elements(p_parts) x
$$;

-- ---------------------------------------------------------------------------
-- The client copy check (IMMUTABLE, SECURITY INVOKER, for every seat and the
-- service key: the decks, the proposals, the video and the offer page)
-- ---------------------------------------------------------------------------

-- [{rule, match, why, block}], one per rule that hits, in the rule order.
-- mention only warns (block false); money is let through with p_money_ok
-- (the investment lines). Arabic-Indic digits read as digits, and Arabic
-- diacritics and the tatweel are dropped before matching.
CREATE OR REPLACE FUNCTION public.cockpit_client_copy_problems(p_text text, p_money_ok boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  t text; out jsonb := '[]'::jsonb; r record; m text; hit text; pre text; pos integer; off integer;
  negated constant text := '(?:\y(?:not|never|no|cannot)\y|n''t|(?:^|\s)(?:ما|مو|لا|ماحد|محد)\s)\s*(?:\S+\s+){0,2}$';
BEGIN
  IF p_text IS NULL OR btrim(p_text) = '' THEN RETURN out; END IF;
  t := regexp_replace(translate(p_text, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹٬٫', '01234567890123456789,.'), '[ً-ْٰـ]', '', 'g');
  FOR r IN
    SELECT * FROM (VALUES
      (1, 'promise', true, 'Promises money back or more work for free. Say what we do instead.',
       '\yno\s+(?:further|extra|additional)\s+fees?\y|money[- ]back|\yrefund(?:s|ed)?\y'
       || '|\ykeep\s+working\y[^.]{0,60}\y(?:free|no\s+(?:further|extra|additional))'
       || '|\ywork(?:ing)?\s+for\s+free\y|\yfor\s+free\s+until\y'
       || '|(?:نعمل|نشتغل|نستمر)[^.]{0,40}(?:مجانا|ببلاش|بلاش)'
       || '|بدون رسوم إضافية|دون رسوم إضافية|بلا رسوم إضافية|بدون أي رسوم إضافية|استرداد|نسترد'
       || '|نعيد (?:لك )?المبلغ|إعادة المبلغ|نستمر[^.]{0,60}(?:مجانا|بدون مقابل|دون مقابل|بدون رسوم|دون رسوم)'
       || '|(?:نرجع|نرد|نعيد) (?:لك |لكم )?(?:فلوسك|فلوسكم|أموالك|المبلغ)'),
      (2, 'free_work', true, 'Offers work for free until a result arrives. We never do.',
       '\ywork(?:ing)?\s+for\s+free\y|\yfor\s+free\s+until\y'
       || '|\ykeep\s+working\y[^.]{0,60}\y(?:free|no\s+(?:further|extra|additional))'
       || '|\ywe(?:''ll|\s+will)?\s+(?:continue|carry\s+on|keep\s+going)\y[^.]{0,60}\yno\s+(?:further|extra|additional)\s+(?:fees?|costs?|charges?)\y'
       || '|(?:نعمل|نشتغل|نستمر|نكمل)[^.]{0,40}(?:مجانا|ببلاش|بلاش|بدون مقابل|دون مقابل)'
       || '|(?:نستمر|نكمل|نواصل)[^.]{0,40}(?:دون|بدون|بلا)\s+(?:أي\s+)?رسوم'),
      (3, 'result_guarantee', true, 'Guarantees a result. We never promise results.',
       '\yguarantee[ds]?\y(?:\s+\w+){0,4}?\s+(?:[0-9][0-9,]*\s+)?(?:qualified\s+)?'
       || '(?:results?|appointments?|meetings?|visits?|leads?|projects?|revenue|sales|roi|clients?|bookings?)\y'
       || '|\yguaranteed\s+(?:results?|appointments?|meetings?|visits?|leads?|projects?|revenue|sales|roi|clients?|bookings?)\y'
       -- "Results guaranteed", "Bookings are guaranteed" ("are not guaranteed" never matches).
       || '|\y(?:results?|appointments?|meetings?|leads?|projects?|revenue|sales|roi|clients?|bookings?|enquir(?:y|ies)|inquir(?:y|ies))\s+(?:are\s+|is\s+)?guaranteed\y'
       -- "We promise you 10 new projects": a promised result, whatever the verb.
       || '|\ywe(?:''ll|\s+will)?\s+promise\y[^.]{0,40}\y(?:results?|projects?|clients?|customers?|bookings?|appointments?|enquir(?:y|ies)|sales|revenue)\y'
       || '|(?:نضمن|يضمن|تضمن|سنضمن)(?:\s+\S+){0,3}?\s+(?:[0-9]+\s+)?'
       || '(?:موعد|مواعيد|موعدا|اجتماع|اجتماعات|اجتماعا|زيارة|زيارات|نتائج|نتيجة|مشاريع|مشروع|مشروعا|عملاء|عميل|ليدز|صفقات|عقود|مبيعات|المبيعات|زيادة|أرباح|الأرباح)'
       || '|ضمان\s+(?:على\s+)?(?:ال)?(?:نتائج|مواعيد)'
       -- "نتائج مضمونة"; a negation between the two words ("غير مضمونة") is let through.
       || '|(?:نتائج|نتيجة|مواعيد|مبيعات|المبيعات|مشاريع|عملاء|عقود)\s+(?:(?!(?:مو|ما|غير|مب|مش|ليس|ليست)\s)\S+\s+)?مضمون(?:ة|ه)?'
       || '|(?:نوعدك|نوعدكم|نعدك|نعدكم)\s+(?:\S+\s+){0,3}?(?:مشاريع|مشروع|عملاء|عميل|مبيعات|نتائج|نتيجة|مواعيد)'),
      (4, 'mention', false, 'Mentions a guarantee or something free. Check it is the agreed terms and never a result.',
       '\yguarantee[ds]?\y|free of charge|\yat no (?:extra|further|additional) cost\y|ضمان|نضمن|مضمون|مجانا|بدون مقابل|دون مقابل'),
      (5, 'outcome', true, 'Promises an outcome: a rate, a ranking or more clients. Say what we build, not what it will do.',
       '\yshow(?:-|\s)?(?:up\s+)?rates?\y|\yclos(?:e|ing)\s+rates?\y|\yconversion\s+rates?\y'
       || '|\ymore\s+(?:qualified\s+)?(?:appointments?|meetings?|clients?|customers?|bookings?|enquiries|inquiries|calls|projects|sales)\y'
       || '|\ypage\s+(?:one|1)\y|\yfirst\s+page\s+(?:of|on)\s+google\y'
       || '|\y(?:rank|ranks|ranked|ranking)\s+(?:first|#\s?1|number\s+one|1st|top|at\s+the\s+top)|#\s?1\s+on\s+google|\ytop\s+of\s+google\y'
       || '|\y(?:appear|appears|appearing|show\s+up|shows\s+up)\s+(?:in|on)\s+(?:chat\s?gpt|gemini|perplexity|ai\s+answers)'
       || '|\y(?:turn|show)\s+up\s+and\s+sign\y'
       || '|نسب(?:ة|ه)\s+(?:ال)?(?:حضور|إغلاق|اغلاق|تقفيل|تحويل)'
       || '|(?<![ء-ي])(?:مواعيد|اجتماعات|عملاء|زبائن|حجوزات|مشاريع)\s+(?:أكثر|اكثر)(?![ء-ي])'
       || '|(?<![ء-ي])(?:أكثر|اكثر)\s+(?:من\s+)?(?:ال)?(?:مواعيد|اجتماعات|عملاء|زبائن|حجوزات|مشاريع)(?![ء-ي])'
       || '|(?:ال)?صفح(?:ة|ه)\s+(?:ال)?(?:أولى|اولى)|(?<![ء-ي])(?:ال)?مركز\s+(?:ال)?(?:أول|اول)(?![ء-ي])'
       || '|(?:الأول|الاول|رقم\s+(?:1|واحد))\s+(?:في|على|ب)\s*(?:جوجل|قوقل|غوغل)'
       || '|(?:تظهر|يظهر|تطلع|يطلع|ظهور|ظهورك)\s+(?:\S+\s+){0,2}?(?:في|ب|على)\s*(?:شات\s*جي\s*بي\s*تي|chat\s?gpt|الذكاء\s+الاصطناعي)'
       || '|(?:يحضرون|يحضر|يجون|يجي)\s+(?:و)?(?:يوقعون|يوقع)'
       -- "Double your enquiries", "2x your sales".
       || '|\y(?:double|triple|2x|3x|10x)\s+(?:your\s+)?(?:enquir(?:y|ies)|inquir(?:y|ies)|clients?|customers?|projects?|sales|bookings?|appointments?|revenue)\y'
       || '|(?:نضاعف|يضاعف|تضاعف|ضاعف)\s+(?:\S+\s+)?(?:عملاء|زبائن|مبيعات|مشاريع|حجوزات|مواعيد)'),
      (6, 'performance_number', true, 'Puts a number beside leads, bookings, spend, a budget or a rate. Clients never see those.',
       '[0-9][0-9,.]*\s*(?:%|k\y)?\s*(?:\S+\s+)?(?:leads?|appointments?|bookings?|meetings?|cpl|roas|spend|budget|show\s+rate|close\s+rate)\y'
       || '|\y(?:leads?|appointments?|bookings?|cpl|roas|spend|budget|show\s+rate|close\s+rate|cost\s+per\s+lead)\y\s*(?:of|at|:|=|is|was|were|by|to)?\s*\$?\s*[0-9]'
       || '|[0-9][0-9,.]*\s*%?\s*(?:\S+\s+)?(?<![ء-ي])(?:ال)?(?:ليدز|ليد|عملاء\s+محتملين|مواعيد|موعد|حجوزات|حجز|اجتماعات)(?![ء-ي])'
       || '|(?<![ء-ي])(?:(?:ال)?ليدز|(?:ال)?ليد|(?:ال)?مواعيد|(?:ال)?حجوزات|تكلفة\s+(?:ال)?ليد|(?:ال)?ميزانية|(?:ال)?صرف|(?:ال)?إنفاق|(?:ال)?انفاق'
       || '|نسبة\s+(?:ال)?حضور|نسبة\s+(?:ال)?إغلاق)\s*[:=]?\s*[0-9]'),
      -- An ad metric by name, with or without a number ("Lower your CPL").
      (7, 'metric_word', true, 'Names an ad metric like CPL or ROAS. Clients never see those.',
       '\y(?:cpl|roas|cpa)\y|\ycost\s+per\s+(?:lead|booking|result|acquisition)\y'
       || '|تكلفة\s+(?:ال)?(?:حجز|موعد|عميل\s+(?:ال)?محتمل)'),
      -- Contract section 0: our own words never reach a client. CSM (client
      -- copy says "your account manager"), ad spend, and a list or original
      -- price (the client sees one price). "Spend a day on site" and "a
      -- listing on Google" pass.
      (8, 'internal_word', true, 'Uses our own words (CSM, ad spend, list price). Say "your account manager", and show one price only.',
       '\ycsms?\y|\yad(?:s|vertising)?\s+spend(?:ing)?\y|\yspend(?:ing)?\s+on\s+(?:ads|advertising)\y'
       || '|\ylist\s+prices?\y|\y(?:regular|usual|normal|original)\s+prices?\y'
       || '|(?<![ء-ي])[وفبل]?(?:ال)?(?:صرف|إنفاق|انفاق)\s+(?:ال)?(?:إعلان|اعلان)\S*'
       || '|(?<![ء-ي])[وفبل]?(?:ال)?سعر\s+(?:ال)?(?:أصلي|اصلي|رسمي)(?![ء-ي])'),
      (9, 'money', true, 'Shows money. Prices go on the investment lines only.',
       '\$|\yusd\y|\y(?:kwd|sar|aed|qar|bhd|omr|kd)\y|\y(?:dollars?|dinars?|riyals?|dirhams?)\y|﷼'
       || '|(?<![ء-ي])(?:دولار|دولارات|دينار|دنانير|ريال|ريالات|درهم|دراهم)(?![ء-ي])|د\.ك|ر\.س|د\.إ'),
      -- One-letter prefixes (and, so, with, for) only on ليدز: وليد is a
      -- common first name (Waleed). ليد after a lighting or screen word is
      -- LED ("إضاءة ليد مخفية"), which fit-out clients say every day.
      (10, 'lead_word', true, 'Says lead. Say enquiry or client.',
       '\yleads?\y|(?<![ء-ي])(?:و|ف|ب|ل|ال|وال|بال|لل|فال)?ليدز(?![ء-ي])'
       || '|(?<![ء-ي])(?<!إضاءة )(?<!اضاءة )(?<!إضاءات )(?<!اضاءات )(?<!إنارة )(?<!انارة )(?<!شاشة )(?<!شاشات )'
       || '(?:ال|وال|بال|لل|فال)?ليد(?![ء-ي])'),
      -- Renewal in Arabic only with its object (contract, subscription,
      -- programme, package, plan), noun or verb, because التجديد alone is
      -- also renovation ("نجدد بيتك" passes). A one-letter prefix (و ف ب ل)
      -- may come before it: "وتجديد العقد", "والعقد يتجدد".
      (11, 'upsell_word', true, 'Says upsell or renewal. Clients never see those words.',
       '\yup-?sell\w*|\ycross-?sell\w*|\yrenew(?:al|als|ed|ing|s)?\y|[أا]ب\s?سيل'
       || '|(?<![ء-ي])[وفبل]?(?:ال)?(?:تجديد|يتجدد|تتجدد|نجدد|يجدد|تجدد|بنجدد)\s+(?:\S+\s+)?(?:ال)?(?:عقد|اشتراك|برنامج|باقة|خطة)'
       || '|(?<![ء-ي])[وفبل]?(?:ال)?(?:عقد|اشتراك|باقة|خطة)\S*\s+(?:\S+\s+)?(?:يتجدد|تتجدد|يجدد|تجدد)(?![ء-ي])'),
      -- Contract section 0: never a discount on a client's screen, page or
      -- message. تخفيض only with a price word ("تخفيض التكاليف" passes).
      (12, 'discount', true, 'Offers a discount. Clients see one price, never a discount.',
       '\ydiscount\w*|\y[0-9]+(?:[.,][0-9]+)?\s*%\s*off\y|\yspecial\s+(?:price|prices|pricing|rate)\y'
       || '|(?<![ء-ي])[وفبل]?(?:ال)?(?:خصم|خصومات|تخفيضات)(?![ء-ي])'
       || '|(?<![ء-ي])[وفبل]?(?:ال)?تخفيض\s+(?:(?:في|على)\s+)?(?:ال)?(?:سعر|أسعار|اسعار)'
       || '|(?<![ء-ي])[وفبل]?(?:ال)?سعر\s+خاص'),
      -- An em dash, a horizontal bar, or a spaced en dash standing in for
      -- one ("2025–2026" passes).
      (13, 'em_dash', true, 'Uses a dash between clauses. Use a comma, a full stop or brackets.', '—|―|\s–\s')
    ) x(n, rule, block, why, pattern) ORDER BY n
  LOOP
    IF r.rule = 'money' AND coalesce(p_money_ok, false) THEN CONTINUE; END IF;
    hit := NULL;
    IF r.rule = 'result_guarantee' THEN
      -- "We do not guarantee results" says the opposite: a guarantee right
      -- after a negation is let through (validate.py _NEGATED).
      off := 1;
      FOR m IN SELECT x[1] FROM regexp_matches(t, '(' || r.pattern || ')', 'gi') x LOOP
        pos := strpos(substr(t, off), m) + off - 1;
        pre := left(t, pos - 1);
        off := pos + char_length(m);
        IF pre !~* negated THEN hit := m; EXIT; END IF;
      END LOOP;
    ELSE
      hit := (regexp_match(t, '(' || r.pattern || ')', 'i'))[1];
    END IF;
    IF hit IS NOT NULL THEN
      out := out || jsonb_build_array(jsonb_build_object('rule', r.rule, 'match', btrim(hit), 'why', r.why, 'block', r.block));
    END IF;
  END LOOP;
  RETURN out;
END $$;

-- ---------------------------------------------------------------------------
-- Browser functions
-- ---------------------------------------------------------------------------

-- The price list, the settings and the offer videos, for a client success
-- seat or the CEO.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_catalog_read() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_csm_actor();
  RETURN jsonb_build_object(
    'rows', (SELECT coalesce(jsonb_agg(public.cockpit_upsell_catalog_json(c) ORDER BY c.sort), '[]'::jsonb)
               FROM public.cockpit_upsell_catalog c),
    'settings', public.cockpit_upsell_settings_json(),
    'videos', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                 'deck', v.deck, 'slotKey', v.slot_key, 'lang', v.lang, 'provider', v.provider, 'url', v.url,
                 'embedUrl', v.embed_url, 'posterUrl', v.poster_url, 'title', v.title,
                 'durationSeconds', v.duration_seconds, 'revision', v.revision) ORDER BY v.deck, v.slot_key, v.lang), '[]'::jsonb)
                 FROM public.cockpit_csm_deck_videos v WHERE v.deck LIKE 'offer\_%' AND v.url IS NOT NULL),
    'isCeo', coalesce(public.cockpit_is_ceo(), false),
    'at', to_jsonb(now()));
END $$;

-- The CEO changes one offer's list prices (existing parts only), its lock,
-- its split or what it waits on. The revision the CEO last saw must still be
-- the row's (40001 otherwise). An unchanged patch writes nothing.
CREATE OR REPLACE FUNCTION public.cockpit_upsell_catalog_set(p_offer text, p_patch jsonb, p_base_revision integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  cur public.cockpit_upsell_catalog; nxt public.cockpit_upsell_catalog; k text; v jsonb; e jsonb; o jsonb; ks text[];
  v_name text; v_who text; v_lines text[] := '{}'; v_single numeric;
BEGIN
  IF NOT coalesce(public.cockpit_is_ceo(), false) THEN
    RAISE EXCEPTION 'Only the CEO changes the price list.' USING ERRCODE = '42501';
  END IF;
  IF p_offer IS NULL OR p_offer NOT IN ('website','second_campaign','seo_geo','smm','ugc','closer','cameraman') THEN
    RAISE EXCEPTION 'Choose one of the seven offers.' USING ERRCODE = '22023';
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'Send the changes as named values.' USING ERRCODE = '22023';
  END IF;
  IF p_base_revision IS NULL THEN RAISE EXCEPTION 'Read the price list again, then save.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO cur FROM public.cockpit_upsell_catalog c WHERE c.offer_key = p_offer FOR UPDATE;
  IF cur.offer_key IS NULL THEN RAISE EXCEPTION 'Choose one of the seven offers.' USING ERRCODE = '22023'; END IF;
  IF cur.revision <> p_base_revision THEN
    RAISE EXCEPTION 'Someone else saved this. Read it again.' USING ERRCODE = '40001';
  END IF;
  nxt := cur;
  v_name := public.cockpit_upsell_offer_name(p_offer);
  FOR k, v IN SELECT key, value FROM jsonb_each(p_patch) LOOP
    CASE k
    WHEN 'parts' THEN
      IF jsonb_typeof(v) <> 'array' OR jsonb_array_length(v) NOT BETWEEN 1 AND 3 THEN
        RAISE EXCEPTION 'Send the prices as a list of parts, each with its key and amount.' USING ERRCODE = '22023';
      END IF;
      FOR e IN SELECT value FROM jsonb_array_elements(v) LOOP
        IF jsonb_typeof(e) <> 'object' THEN
          RAISE EXCEPTION 'Send the prices as a list of parts, each with its key and amount.' USING ERRCODE = '22023';
        END IF;
        ks := ARRAY(SELECT jsonb_object_keys(e));
        IF NOT (ks @> ARRAY['key','amount'] AND ks <@ ARRAY['key','amount']) THEN
          RAISE EXCEPTION 'Send the prices as a list of parts, each with its key and amount.' USING ERRCODE = '22023';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(nxt.parts) x WHERE x->>'key' = e->>'key') THEN
          RAISE EXCEPTION 'The % offer has no part called %.', v_name, coalesce(e->>'key', 'that') USING ERRCODE = '22023';
        END IF;
        IF jsonb_typeof(e->'amount') <> 'null' AND NOT public.cockpit_upsell_usd_ok(e->'amount') THEN
          RAISE EXCEPTION 'A price is a dollar amount from 1 to 1,000,000, with at most two decimals.' USING ERRCODE = '22023';
        END IF;
        nxt.parts := (SELECT jsonb_agg(CASE WHEN x->>'key' = e->>'key' THEN x || jsonb_build_object('amount', e->'amount') ELSE x END ORDER BY i)
                        FROM jsonb_array_elements(nxt.parts) WITH ORDINALITY y(x, i));
      END LOOP;
    WHEN 'locked' THEN
      IF jsonb_typeof(v) <> 'boolean' THEN RAISE EXCEPTION 'Set Locked to on or off.' USING ERRCODE = '22023'; END IF;
      nxt.locked := (v #>> '{}')::boolean;
    WHEN 'split_allowed' THEN
      IF jsonb_typeof(v) <> 'boolean' THEN RAISE EXCEPTION 'Set Split allowed to on or off.' USING ERRCODE = '22023'; END IF;
      nxt.split_allowed := (v #>> '{}')::boolean;
    WHEN 'split_parts' THEN
      IF jsonb_typeof(v) = 'null' THEN nxt.split_parts := NULL;
      ELSIF public.cockpit_upsell_split_ok(v) THEN nxt.split_parts := v;
      ELSE RAISE EXCEPTION 'A split is two dollar amounts.' USING ERRCODE = '22023';
      END IF;
    WHEN 'waits_on' THEN
      IF jsonb_typeof(v) = 'null' OR (jsonb_typeof(v) = 'string' AND btrim(v #>> '{}') = '') THEN nxt.waits_on := NULL;
      ELSIF jsonb_typeof(v) = 'string' AND char_length(btrim(v #>> '{}')) <= 160 THEN nxt.waits_on := btrim(v #>> '{}');
      ELSE RAISE EXCEPTION 'Say what the offer waits on in 160 characters or fewer.' USING ERRCODE = '22023';
      END IF;
    ELSE
      RAISE EXCEPTION 'The price list does not keep "%".', k USING ERRCODE = '22023';
    END CASE;
  END LOOP;

  -- A split must add up to the price it splits, when that price is set.
  IF nxt.split_parts IS NOT NULL AND jsonb_array_length(nxt.parts) = 1 THEN
    v_single := (nxt.parts->0->>'amount')::numeric;
    IF v_single IS NOT NULL AND (nxt.split_parts->>0)::numeric + (nxt.split_parts->>1)::numeric <> v_single THEN
      RAISE EXCEPTION 'The split must add up to the price (%). Change both together.', public.cockpit_upsell_money(v_single) USING ERRCODE = '22023';
    END IF;
  END IF;

  IF nxt IS NOT DISTINCT FROM cur THEN
    RETURN public.cockpit_upsell_catalog_json(cur) || jsonb_build_object('changed', false);
  END IF;

  -- The CEO card's sentence, one clause per change.
  FOR e IN SELECT value FROM jsonb_array_elements(nxt.parts) LOOP
    SELECT x INTO o FROM jsonb_array_elements(cur.parts) x WHERE x->>'key' = e->>'key';
    IF (o->'amount') IS DISTINCT FROM (e->'amount') THEN
      v_lines := v_lines || format('%s: %s to %s', public.cockpit_upsell_part_name(p_offer, e->>'key'),
        public.cockpit_upsell_money((o->>'amount')::numeric), public.cockpit_upsell_money((e->>'amount')::numeric));
    END IF;
  END LOOP;
  IF nxt.locked IS DISTINCT FROM cur.locked THEN
    v_lines := v_lines || format('%s: price %s', v_name, CASE WHEN nxt.locked THEN 'locked' ELSE 'unlocked' END);
  END IF;
  IF nxt.split_allowed IS DISTINCT FROM cur.split_allowed THEN
    v_lines := v_lines || format('%s: split %s', v_name, CASE WHEN nxt.split_allowed THEN 'allowed' ELSE 'not allowed' END);
  END IF;
  IF nxt.split_parts IS DISTINCT FROM cur.split_parts THEN
    v_lines := v_lines || CASE WHEN nxt.split_parts IS NULL THEN format('%s: no split', v_name)
      ELSE format('%s split: %s + %s', v_name, public.cockpit_upsell_money((nxt.split_parts->>0)::numeric),
                  public.cockpit_upsell_money((nxt.split_parts->>1)::numeric)) END;
  END IF;
  IF nxt.waits_on IS DISTINCT FROM cur.waits_on THEN
    v_lines := v_lines || CASE WHEN nxt.waits_on IS NULL THEN format('%s no longer waits', v_name)
      ELSE format('%s waits on: %s', v_name, public.cockpit_upsell_clause(nxt.waits_on)) END;
  END IF;

  SELECT lower(btrim(u.email)) INTO v_who FROM auth.users u WHERE u.id = auth.uid();
  PERFORM set_config('cockpit.upsell_action', 'upsellCatalog.set', true);
  PERFORM set_config('cockpit.upsell_line', array_to_string(v_lines, '; ') || ', by the CEO', true);
  UPDATE public.cockpit_upsell_catalog c
     SET parts = nxt.parts, locked = nxt.locked, split_allowed = nxt.split_allowed, split_parts = nxt.split_parts,
         waits_on = nxt.waits_on, revision = c.revision + 1, updated_at = now(), updated_by = coalesce(v_who, 'ceo')
   WHERE c.offer_key = p_offer
  RETURNING * INTO nxt;
  RETURN public.cockpit_upsell_catalog_json(nxt) || jsonb_build_object('changed', true);
END $$;

-- The CEO sets one setting: whatsapp_number (digits with the country code,
-- 8 to 15; blank removes it), valid_days (7 to 90) or door_live (true/false).
CREATE OR REPLACE FUNCTION public.cockpit_upsell_setting_set(p_key text, p_value text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v text; cur text; v_who text; v_line text;
BEGIN
  IF NOT coalesce(public.cockpit_is_ceo(), false) THEN
    RAISE EXCEPTION 'Only the CEO changes the offer settings.' USING ERRCODE = '42501';
  END IF;
  IF p_key IS NULL OR p_key NOT IN ('whatsapp_number','valid_days','door_live') THEN
    RAISE EXCEPTION 'Choose the WhatsApp number, the days a proposal stays open or video view counting.' USING ERRCODE = '22023';
  END IF;
  v := nullif(btrim(p_value), '');
  IF p_key = 'whatsapp_number' THEN
    v := nullif(regexp_replace(coalesce(v, ''), '[[:space:]+-]', '', 'g'), '');
    IF v IS NOT NULL AND v !~ '^[0-9]{8,15}$' THEN
      RAISE EXCEPTION 'Type the WhatsApp number as digits with the country code, 8 to 15 of them.' USING ERRCODE = '22023';
    END IF;
  ELSIF p_key = 'valid_days' THEN
    IF v IS NULL OR v !~ '^[0-9]{1,2}$' OR v::integer NOT BETWEEN 7 AND 90 THEN
      RAISE EXCEPTION 'A proposal stays open 7 to 90 days.' USING ERRCODE = '22023';
    END IF;
    v := (v::integer)::text;
  ELSE
    v := lower(v);
    IF v IS NULL OR v NOT IN ('true','false') THEN
      RAISE EXCEPTION 'Video view counting is on (true) or off (false).' USING ERRCODE = '22023';
    END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_upsell_settings:' || p_key, 0));
  SELECT s.value INTO cur FROM public.cockpit_upsell_settings s WHERE s.key = p_key FOR UPDATE;
  IF cur IS NOT DISTINCT FROM v THEN
    RETURN public.cockpit_upsell_settings_json() || jsonb_build_object('changed', false);
  END IF;
  v_line := CASE p_key
    WHEN 'whatsapp_number' THEN CASE WHEN v IS NULL THEN 'WhatsApp number removed from the client page'
                                     ELSE 'WhatsApp number for the client page changed' END
    WHEN 'valid_days' THEN format('Proposals stay open %s days (was %s)', v, coalesce(cur, 'unset'))
    ELSE CASE WHEN v = 'true' THEN 'Video links now count views' ELSE 'Video links go straight to the video, uncounted' END
  END || ', by the CEO';
  SELECT lower(btrim(u.email)) INTO v_who FROM auth.users u WHERE u.id = auth.uid();
  PERFORM set_config('cockpit.upsell_action', 'upsellSettings.set', true);
  PERFORM set_config('cockpit.upsell_line', v_line, true);
  IF v IS NULL THEN
    DELETE FROM public.cockpit_upsell_settings s WHERE s.key = p_key;
  ELSE
    INSERT INTO public.cockpit_upsell_settings AS s (key, value, updated_at, updated_by)
    VALUES (p_key, v, now(), coalesce(v_who, 'ceo'))
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  END IF;
  RETURN public.cockpit_upsell_settings_json() || jsonb_build_object('changed', true);
END $$;

-- ---------------------------------------------------------------------------
-- Grants, restated
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION
  public.cockpit_upsell_usd_ok(jsonb),
  public.cockpit_upsell_parts_ok(jsonb),
  public.cockpit_upsell_split_ok(jsonb),
  public.cockpit_upsell_copy_text_ok(jsonb, integer),
  public.cockpit_upsell_copy_ok(jsonb, jsonb, text),
  public.cockpit_upsell_audit(),
  public.cockpit_upsell_offer_name(text),
  public.cockpit_upsell_part_name(text, text, boolean),
  public.cockpit_upsell_clause(text),
  public.cockpit_upsell_today(),
  public.cockpit_upsell_kday(timestamptz),
  public.cockpit_upsell_money(numeric),
  public.cockpit_upsell_catalog_json(public.cockpit_upsell_catalog),
  public.cockpit_upsell_settings_json(),
  public.cockpit_upsell_list_of(jsonb)
FROM PUBLIC, anon, authenticated, service_role;
-- The table CHECKs call these, so the service key (the door for the tables)
-- may run them; they read no data.
GRANT EXECUTE ON FUNCTION
  public.cockpit_upsell_usd_ok(jsonb),
  public.cockpit_upsell_parts_ok(jsonb),
  public.cockpit_upsell_split_ok(jsonb),
  public.cockpit_upsell_copy_text_ok(jsonb, integer),
  public.cockpit_upsell_copy_ok(jsonb, jsonb, text)
TO service_role;

REVOKE ALL ON FUNCTION
  public.cockpit_upsell_catalog_read(),
  public.cockpit_upsell_catalog_set(text, jsonb, integer),
  public.cockpit_upsell_setting_set(text, text)
FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION
  public.cockpit_upsell_catalog_read(),
  public.cockpit_upsell_catalog_set(text, jsonb, integer),
  public.cockpit_upsell_setting_set(text, text)
TO authenticated;

REVOKE ALL ON FUNCTION public.cockpit_client_copy_problems(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_client_copy_problems(text, boolean) TO authenticated, service_role;

COMMIT;
