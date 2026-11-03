-- The media buyers' agreed daily budget (item 5, "sync it in the ads"; plan build B6, design budget-ads.md S1
-- and S4). Creative Triage (bldgtotkfmhoxmlzowdx). Applies twice. Stands on 20261024b (cockpit_launch_pipeline),
-- 20261026t (cockpit_media_account_scope_before_client_hold) and 20261017100100 (cockpit_board_client), each read
-- live on 2026-11-03 (Kuwait) and equal to its file.
--
-- 1. One chain, newest agreed first, in one function (cockpit_launch_agreed_chain) that the launch desk, the
--    desk's 2x cap and the client page all read:
--      a. the Ads Managment card's Daily Ad Spend (the running contract; the desk also reads the live card).
--         The boardCards mirror omits the field, so it is read from the copy cockpit-sync keeps in Supabase,
--         cockpit_campaigns.raw_data.contractedBudget (calculator.ts: field("Daily Ad Spend")), matched to the
--         client as the pipeline's inAds matches a campaign (its ad account ids or its name), dropped rows out;
--      b. Blueprint part 1's daily_budget as it was sent (parts.1.sent.daily_budget), once part 1 is sent. Its
--         stored shape is {usd, said}: the old test (`~ '^[0-9]+...$'` on the object's text) never matched, so
--         a confirmed Blueprint figure never won. A draft changed after the send is listed with a note and is
--         not the default (cockpit_blueprint_save does not lock part 1);
--      c. the kickoff's budget in USD (forms.kickoff.budget, read null-safe; build B5's
--         cockpit_kickoff_budget(text) when it exists, which also reads old Typeform text);
--      d. the sale: the card's Daily Budget (handover.daily_budget). It was labelled "Kickoff"; it now reads
--         "Sale (card Daily Budget)".
--    Two holds keep a figure from being the default, each said in a note: under $2.50 (twice it is under the
--    desk's $5 floor, so no budget could pass), any source; and $1,000 or more (it looks like a month or another
--    currency: 6 of 55 sale answers do), the Blueprint, the kickoff and the sale. The Blueprint is prefilled
--    from the card's Daily Budget, so the sale's guard holds there too.
--    Every source found is listed with its figure, and the one taken is marked. Missing is never zero: with no
--    source the figure is null, the desk says "No agreed budget yet" and the $100 seat cap applies, as today.
-- 2. cockpit_launch_pipeline (one client) adds kickoffBudget {amount, currency, usd, fromText, said, at},
--    adsCards (the Ads card figures from cockpit_campaigns) and agreedBudget (the chain), under the gate it
--    already has (cockpit_launch_member and the seat's clients). Its brief adds sentBudget (part 1's
--    daily_budget as sent), for every row.
-- 3. cockpit_media_account_scope_before_client_hold takes contractedUsd and contractSource from the chain, so
--    the desk's default and its 2x cap (cockpit-media-api budgetLimit, unchanged) follow it.
-- 4. cockpit_board_client adds an `agreed` note to the client's Budget/day cell on the client page (DEL-13):
--    "Agreed $40 a day (kickoff, 150 SAR). Set now: $25 a day." Display only, never judged, never on a slide.
--    The board's grid (cockpit_board_read) is unchanged.
--
-- Nothing here writes a row, ClickUp, Meta or GHL. The Ads card's Daily Ad Spend is written only at a switch-on
-- a media buyer presses, as today. No rate is added: BHD and OMR wait for the CEO (a kickoff in BHD keeps its
-- amount and says it is not converted).

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard: each replaced body is its live one (read 2026-11-03) or this file's own (a second apply).
--    md5 of the body with every run of white space made one space, as 20261102p reads them.

DO $$
DECLARE g record; v_now text;
BEGIN
  FOR g IN
    SELECT * FROM (VALUES
      ('public.cockpit_launch_pipeline(text)', '66e23b57d1bf4dfa4df22d62194813f4', 'f8f4df35005d4ffd0cbc1c4118dd159c'),
      ('public.cockpit_media_account_scope_before_client_hold(text,text,text,uuid)', '2507f3ec23805d4de14cceb51be68734', '2bc78370419787c00451cfb86b5298d9'),
      ('public.cockpit_board_client(text,date,date)', 'f252d3696507ca814aa28eec57723e0a', '26b20d26e0a05325eb33bbaf9f4bb024')
    ) AS x(fn, live_md5, after_md5)
  LOOP
    v_now := NULL;
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v_now
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure(g.fn);
    IF v_now IS NULL OR v_now NOT IN (g.live_md5, g.after_md5) THEN
      RAISE EXCEPTION '% changed since it was read for 20261103e; stop and re-read it.', replace(g.fn, 'public.', '')
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Small readers (internal: no grant to anon, authenticated or service_role)

-- A positive dollar figure from a jsonb number or a plain numeric string, to the cent; NULL otherwise (0, a
-- negative, a figure of a billion or more, any other text).
CREATE OR REPLACE FUNCTION public.cockpit_launch_usd(p jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN x.n > 0 AND x.n < 1000000000 THEN x.n END
    FROM (SELECT round(CASE
            WHEN jsonb_typeof(p) = 'number' THEN (p #>> '{}')::numeric
            WHEN jsonb_typeof(p) = 'string' AND btrim(p #>> '{}') ~ '^[0-9]{1,9}(\.[0-9]+)?$' THEN btrim(p #>> '{}')::numeric
          END, 2) AS n) x
$$;

-- Dollars in words, as the cockpit's format.ts money() writes them: cents only under $100 when there are any
-- ($39.99), else whole dollars with commas ($1,000).
CREATE OR REPLACE FUNCTION public.cockpit_launch_usd_words(p numeric)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p IS NULL THEN NULL
    WHEN abs(p) < 100 AND round(abs(p) * 100) % 100 <> 0 THEN '$' || to_char(round(abs(p), 2), 'FM990.00')
    ELSE '$' || to_char(round(abs(p)), 'FM999,999,999,990')
  END
$$;

-- The kickoff's daily budget for one card, or NULL: build B5's cockpit_kickoff_budget(text) when it exists (the
-- native side key, else old Typeform text read as dollars), else the read model's forms.kickoff.budget side key.
-- {amount, currency, usd, fromText, said, at}; usd is NULL with no fixed rate, never 0. `said` is kept only for
-- an answer read from typed text, cut at 40 characters.
CREATE OR REPLACE FUNCTION public.cockpit_launch_kickoff_budget(p_task text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE k jsonb; b jsonb; v_amount numeric; v_usd numeric; v_cur text; v_text boolean; v_said text;
BEGIN
  IF p_task IS NULL THEN RETURN NULL; END IF;
  SELECT o.forms->'kickoff' INTO k FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_task;
  IF to_regprocedure('public.cockpit_kickoff_budget(text)') IS NOT NULL THEN
    EXECUTE 'SELECT public.cockpit_kickoff_budget($1)' INTO b USING p_task;
  ELSIF jsonb_typeof(k) = 'object' AND jsonb_typeof(k->'budget') = 'object' THEN
    b := k->'budget';
  END IF;
  IF jsonb_typeof(b) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
  v_amount := public.cockpit_launch_usd(b->'amount');
  v_usd := public.cockpit_launch_usd(b->'usd');
  IF v_amount IS NULL AND v_usd IS NULL THEN RETURN NULL; END IF;
  v_cur := upper(btrim(coalesce(b->>'currency', '')));
  v_text := coalesce(b->'from_text' = 'true'::jsonb OR b->'fromText' = 'true'::jsonb, false);
  v_said := CASE WHEN v_text THEN nullif(btrim(regexp_replace(coalesce(b->>'said', ''), '\s+', ' ', 'g')), '') END;
  RETURN jsonb_build_object(
    'amount', v_amount,
    'currency', CASE WHEN v_cur ~ '^[A-Z]{3}$' THEN v_cur END,
    'usd', v_usd,
    'fromText', v_text,
    'said', CASE WHEN char_length(v_said) > 40 THEN left(v_said, 39) || '…' ELSE v_said END,
    'at', CASE WHEN jsonb_typeof(k) = 'object' THEN k->>'submitted_at' END);
END $$;

-- The Ads card's Daily Ad Spend as cockpit-sync keeps it (cockpit_campaigns.raw_data.contractedBudget): the
-- boardCards mirror omits the field. One per Ads card (its latest synced row), matched as the pipeline's inAds
-- matches a campaign: the client's ad account ids or its name; a row the sync dropped is left out.
-- [{taskId, dailyAdSpend}], the chain's card shape.
CREATE OR REPLACE FUNCTION public.cockpit_launch_ads_cards(p_ids text[], p_name text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('taskId', x.task, 'dailyAdSpend', x.usd) ORDER BY x.task NULLS LAST), '[]'::jsonb)
    FROM (SELECT DISTINCT ON (coalesce(nullif(c.task_id, ''), nullif(c.raw_data->>'taskId', '')))
                 coalesce(nullif(c.task_id, ''), nullif(c.raw_data->>'taskId', '')) AS task,
                 public.cockpit_launch_usd(c.raw_data->'contractedBudget') AS usd
            FROM public.cockpit_campaigns c
           WHERE NOT c.source_deleted
             AND public.cockpit_launch_usd(c.raw_data->'contractedBudget') IS NOT NULL
             AND (regexp_replace(coalesce(c.meta_account_id, ''), '^act_', '') = ANY(coalesce(p_ids, '{}'::text[]))
                  OR lower(coalesce(nullif(c.raw_data->>'clientName', ''), nullif(c.raw_data->>'accountName', ''), c.client_name)) = lower(p_name))
           ORDER BY coalesce(nullif(c.task_id, ''), nullif(c.raw_data->>'taskId', '')), c.synced_at DESC NULLS LAST,
                    c.updated_at DESC, c.id DESC) x
$$;

-- Why a figure is not the default, or NULL: twice it is under the desk's $5 floor (cockpit-media-api
-- budgetCheck), so no budget could pass; or, with p_ask, $1,000 or more, which looks like a month or another
-- currency. launchModel.budgetHold is the same rule.
CREATE OR REPLACE FUNCTION public.cockpit_launch_budget_hold(p_whose text, p_usd numeric, p_ask text)
RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_usd IS NULL THEN NULL
    WHEN p_usd * 2 < 5 THEN format('%s %s a day is too low: twice it is under the desk''s $5 floor, so it is not the default.',
                                   p_whose, public.cockpit_launch_usd_words(p_usd))
    WHEN p_ask IS NOT NULL AND p_usd >= 1000 THEN format('%s %s a day looks like a month or another currency, so it is not the default. Ask the %s.',
                                   p_whose, public.cockpit_launch_usd_words(p_usd), p_ask)
  END
$$;

-- The chain itself: pure, from the launch row's own parts (cards, with the pipeline's adsCards after them; brief
-- {answers, sentAt, sentBudget}; kickoffBudget; handover). apps/media-buyer-cockpit/src/lib/launchModel.ts
-- agreedBudget() is the same rule, and launch-agreed-budget-supabase.test.ts holds the two equal. Returns
-- {usd, key, source, from, sources: [{key, label, from, usd, used, note}], notes}.
CREATE OR REPLACE FUNCTION public.cockpit_launch_agreed_chain(p_cards jsonb, p_brief jsonb, p_kickoff jsonb, p_handover jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE
  v_sources jsonb := '[]'::jsonb;
  v_pick jsonb;
  v_card numeric; v_bp numeric; v_bp_was numeric; v_bp_sent boolean := false; v_kick numeric; v_amount numeric;
  v_cur text; v_sale numeric;
  v_label text; v_from text; v_note text;
BEGIN
  -- a. The Ads card: the first card (by task id, then as listed) whose Daily Ad Spend is a figure above 0.
  SELECT public.cockpit_launch_usd(x->'dailyAdSpend') INTO v_card
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_cards) = 'array' THEN p_cards ELSE '[]'::jsonb END) WITH ORDINALITY AS t(x, i)
   WHERE public.cockpit_launch_usd(x->'dailyAdSpend') IS NOT NULL
   ORDER BY x->>'taskId', i LIMIT 1;
  IF v_card IS NOT NULL THEN
    v_sources := v_sources || jsonb_build_array(jsonb_build_object('key', 'adsCard', 'label', 'Ads card',
      'from', 'the Ads card', 'usd', v_card, 'used', false,
      'note', public.cockpit_launch_budget_hold('The Ads card''s', v_card, NULL)));
  END IF;

  -- b. Blueprint part 1: {usd, said} (a bare figure is read too). The figure sent (sentBudget) once part 1 is
  --    sent; the draft, when it differs, only with a note.
  IF jsonb_typeof(p_brief) = 'object' THEN
    v_bp := CASE WHEN jsonb_typeof(p_brief->'answers'->'daily_budget') = 'object'
                 THEN public.cockpit_launch_usd(p_brief->'answers'->'daily_budget'->'usd')
                 ELSE public.cockpit_launch_usd(p_brief->'answers'->'daily_budget') END;
    v_bp_sent := nullif(p_brief->>'sentAt', '') IS NOT NULL;
    IF v_bp_sent THEN
      v_bp_was := CASE WHEN jsonb_typeof(p_brief->'sentBudget') = 'object'
                       THEN public.cockpit_launch_usd(p_brief->'sentBudget'->'usd')
                       ELSE public.cockpit_launch_usd(p_brief->'sentBudget') END;
    END IF;
  END IF;
  IF v_bp_was IS NOT NULL THEN
    v_sources := v_sources || jsonb_build_array(jsonb_build_object('key', 'blueprint', 'label', 'Blueprint part 1',
      'from', 'Blueprint part 1', 'usd', v_bp_was, 'used', false,
      'note', public.cockpit_launch_budget_hold('Blueprint part 1''s', v_bp_was, 'creative director')));
  END IF;
  IF v_bp IS NOT NULL AND v_bp IS DISTINCT FROM v_bp_was THEN
    v_sources := v_sources || jsonb_build_array(jsonb_build_object(
      'key', CASE WHEN v_bp_was IS NULL THEN 'blueprint' ELSE 'blueprintDraft' END,
      'label', CASE WHEN v_bp_was IS NULL THEN 'Blueprint part 1' ELSE 'Blueprint part 1, change not sent' END,
      'from', CASE WHEN v_bp_was IS NULL THEN 'Blueprint part 1' ELSE 'the unsent Blueprint change' END,
      'usd', v_bp, 'used', false,
      'note', CASE WHEN v_bp_sent
                   THEN format('Blueprint part 1 now says %s a day but the change is not sent yet, so it is not the default.',
                               public.cockpit_launch_usd_words(v_bp))
                   ELSE format('Blueprint part 1 says %s a day but is not sent yet, so it is not the default.',
                               public.cockpit_launch_usd_words(v_bp)) END));
  END IF;

  -- c. The kickoff, in dollars at the cockpit's fixed rate.
  IF jsonb_typeof(p_kickoff) = 'object' THEN
    v_kick := public.cockpit_launch_usd(p_kickoff->'usd');
    v_amount := public.cockpit_launch_usd(p_kickoff->'amount');
    v_cur := nullif(p_kickoff->>'currency', '');
    IF v_kick IS NOT NULL OR v_amount IS NOT NULL THEN
      IF p_kickoff->'fromText' = 'true'::jsonb THEN
        v_label := 'Kickoff, as typed: ' || coalesce(nullif(p_kickoff->>'said', ''), public.cockpit_launch_usd_words(v_kick), trim_scale(v_amount)::text);
      ELSIF v_cur IS NOT NULL AND v_cur <> 'USD' AND v_amount IS NOT NULL THEN
        v_label := format('Kickoff, %s %s', trim_scale(v_amount)::text, v_cur);
      ELSE
        v_label := 'Kickoff';
      END IF;
      v_from := lower(left(v_label, 1)) || substr(v_label, 2);
      v_note := CASE
        WHEN v_kick IS NULL AND v_cur IS NULL THEN format('The kickoff''s %s has no currency, so it is not the default.', trim_scale(v_amount)::text)
        WHEN v_kick IS NULL THEN format('No fixed rate for %s yet, so the kickoff''s %s %s is not the default.',
                                        v_cur, trim_scale(v_amount)::text, v_cur)
        ELSE public.cockpit_launch_budget_hold('The kickoff''s', v_kick, 'CSM')
      END;
      v_sources := v_sources || jsonb_build_array(jsonb_build_object('key', 'kickoff', 'label', v_label,
        'from', v_from, 'usd', v_kick, 'used', false, 'note', v_note));
    END IF;
  END IF;

  -- d. The sale: the card's Daily Budget. $1,000 or more is never the default; nor is one under $2.50.
  IF jsonb_typeof(p_handover) = 'object' THEN
    v_sale := public.cockpit_launch_usd(p_handover->'daily_budget');
  END IF;
  IF v_sale IS NOT NULL THEN
    v_sources := v_sources || jsonb_build_array(jsonb_build_object('key', 'sale', 'label', 'Sale (card Daily Budget)',
      'from', 'the sale', 'usd', v_sale, 'used', false,
      'note', coalesce(public.cockpit_launch_budget_hold('The sale''s', v_sale, NULL),
                       CASE WHEN v_sale >= 1000 THEN format('The sale''s figure, %s a day, looks like a month or another currency, so it is not the default. Ask the CSM.',
                                                            public.cockpit_launch_usd_words(v_sale)) END)));
  END IF;

  -- The first source with a figure and no note is the default.
  SELECT x INTO v_pick FROM jsonb_array_elements(v_sources) WITH ORDINALITY AS t(x, i)
   WHERE jsonb_typeof(x->'usd') = 'number' AND jsonb_typeof(x->'note') = 'null'
   ORDER BY i LIMIT 1;
  IF v_pick IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(CASE WHEN x->>'key' = v_pick->>'key' THEN jsonb_set(x, '{used}', 'true'::jsonb) ELSE x END ORDER BY i), '[]'::jsonb)
      INTO v_sources FROM jsonb_array_elements(v_sources) WITH ORDINALITY AS t(x, i);
  END IF;

  RETURN jsonb_build_object(
    'usd', v_pick->'usd',
    'key', v_pick->'key',
    'source', v_pick->'label',
    'from', v_pick->'from',
    'sources', v_sources,
    'notes', coalesce((SELECT jsonb_agg(x->'note' ORDER BY i) FROM jsonb_array_elements(v_sources) WITH ORDINALITY AS t(x, i)
                       WHERE jsonb_typeof(x->'note') = 'string'), '[]'::jsonb));
END $$;

-- The chain for one card, read the way cockpit_launch_pipeline reads it (the client page's way in).
CREATE OR REPLACE FUNCTION public.cockpit_launch_agreed_budget(p_clickup_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_name text; v_location text; v_cards jsonb; v_brief jsonb; v_handover jsonb;
BEGIN
  IF p_clickup_id IS NULL THEN RETURN NULL; END IF;
  SELECT b.client_name, b.location_id INTO v_name, v_location FROM public.cockpit_board_clients b
   WHERE b.clickup_id = p_clickup_id ORDER BY b.updated_at DESC NULLS LAST LIMIT 1;
  SELECT coalesce(jsonb_agg(s.data ORDER BY s.data->>'name'), '[]'::jsonb) INTO v_cards
    FROM public.cockpit_media_sources s
   WHERE v_name IS NOT NULL AND s.table_name = 'boardCards'
     AND (EXISTS (SELECT 1 FROM unnest(s.client_names) n WHERE lower(n) = lower(v_name))
          OR lower(coalesce(s.data->>'tag', s.data->>'clientTag')) = lower(v_name));
  -- The mirror omits Daily Ad Spend: the Ads card's figure comes from cockpit-sync's copy, as in the pipeline.
  IF v_name IS NOT NULL THEN
    v_cards := v_cards || public.cockpit_launch_ads_cards(public.cockpit_launch_accounts(v_location), v_name);
  END IF;
  SELECT jsonb_build_object('answers', jsonb_build_object('daily_budget', public.cockpit_blueprint_part_answers(1, bp.answers)->'daily_budget'),
                            'sentAt', bp.parts->'1'->'lastAt', 'sentBudget', bp.parts->'1'->'sent'->'daily_budget')
    INTO v_brief FROM public.cockpit_blueprints bp WHERE bp.task_id = p_clickup_id;
  SELECT coalesce(o.handover, '{}'::jsonb) INTO v_handover FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = p_clickup_id;
  RETURN public.cockpit_launch_agreed_chain(v_cards, v_brief, public.cockpit_launch_kickoff_budget(p_clickup_id), v_handover);
END $$;

-- The client page's note on the Budget/day cell: the agreed figure, then the budget set now (the cell's own
-- figure). {usd, key, from, head, now, words, notes, sources}.
CREATE OR REPLACE FUNCTION public.cockpit_board_agreed_note(p_clickup_id text, p_cell jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a jsonb; v_now numeric; v_head text; v_set text;
BEGIN
  a := public.cockpit_launch_agreed_budget(p_clickup_id);
  v_head := CASE WHEN jsonb_typeof(a->'usd') = 'number'
                 THEN format('Agreed %s a day (%s).', public.cockpit_launch_usd_words((a->>'usd')::numeric), a->>'from')
                 ELSE 'No agreed budget yet.' END;
  v_now := CASE WHEN jsonb_typeof(p_cell->'v') = 'number' THEN (p_cell->>'v')::numeric END;
  v_set := CASE
    WHEN v_now IS NULL THEN NULL
    WHEN v_now > 0 THEN format('Set now: %s%s a day.', CASE WHEN p_cell->'atLeast' = 'true'::jsonb THEN 'at least ' ELSE '' END,
                               public.cockpit_launch_usd_words(v_now))
    ELSE 'Set now: no daily budget switched on.' END;
  RETURN jsonb_build_object(
    'usd', a->'usd', 'key', a->'key', 'from', a->'from',
    'head', v_head, 'now', v_set, 'words', concat_ws(' ', v_head, v_set),
    'notes', coalesce(a->'notes', '[]'::jsonb), 'sources', coalesce(a->'sources', '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.cockpit_launch_usd(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_launch_usd_words(numeric) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_launch_kickoff_budget(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_launch_ads_cards(text[],text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_launch_budget_hold(text,numeric,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_launch_agreed_chain(jsonb,jsonb,jsonb,jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_launch_agreed_budget(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_board_agreed_note(text,jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. cockpit_launch_pipeline: 20261024b's body, with kick and ads declared, sentBudget in the brief and, for one
--    client, kickoffBudget, adsCards and agreedBudget beside handover. Grants as live: authenticated only.

CREATE OR REPLACE FUNCTION public.cockpit_launch_pipeline(p_clickup_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE m public.cockpit_members; b public.cockpit_board_clients; o jsonb; brief jsonb; cards jsonb; tasks jsonb;
 ids text[]; accounts jsonb; launches jsonb; history jsonb; out_rows jsonb:='[]'; row_data jsonb;
 lane text; in_ads boolean; waiting boolean; ready boolean; caller boolean; part jsonb; source_at timestamptz; kick jsonb; ads jsonb;
BEGIN
 m:=public.cockpit_launch_member();
 FOR b IN SELECT * FROM public.cockpit_board_clients WHERE status NOT IN ('Cancelled','Removed from sheet') AND clickup_id IS NOT NULL AND (p_clickup_id IS NULL OR clickup_id=p_clickup_id) ORDER BY client_name LOOP
  IF NOT (m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com') OR 'admin'=ANY(m.roles) OR cardinality(m.clients)=0 OR EXISTS(SELECT 1 FROM unnest(m.clients)c WHERE lower(btrim(c))=lower(btrim(b.client_name)))) THEN CONTINUE; END IF;
  ids:=public.cockpit_launch_accounts(b.location_id);
  SELECT to_jsonb(x) INTO o FROM public.cockpit_client_onboarding x WHERE clickup_task_id=b.clickup_id;
  SELECT jsonb_build_object('answers',public.cockpit_blueprint_part_answers(1,answers),'sentAt',parts->'1'->'lastAt','sentBudget',parts->'1'->'sent'->'daily_budget','launchTaskId',launch_task_id) INTO brief FROM public.cockpit_blueprints WHERE task_id=b.clickup_id;
  -- Parts 2/3 and answer metadata never cross the media buyer boundary.
  SELECT coalesce(jsonb_agg(data ORDER BY data->>'name'),'[]') INTO cards FROM public.cockpit_media_sources s WHERE table_name='boardCards' AND (EXISTS(SELECT 1 FROM unnest(client_names)n WHERE lower(n)=lower(b.client_name)) OR lower(coalesce(data->>'tag',data->>'clientTag'))=lower(b.client_name));
  SELECT coalesce(jsonb_agg(data),'[]') INTO tasks FROM public.cockpit_media_sources s WHERE table_name='onboardings' AND coalesce(data->>'parent','')='' AND lower(coalesce(data->>'status','')) NOT IN ('complete','closed','done','cancelled') AND (EXISTS(SELECT 1 FROM unnest(client_names)n WHERE lower(n)=lower(b.client_name)) OR lower(data->>'clientName')=lower(b.client_name));
  caller:=NULL;
  IF b.service_mode='DWY' THEN caller:=true;
  ELSIF to_regclass('mahara_console.metadata') IS NOT NULL THEN
   BEGIN
    EXECUTE $q$ SELECT EXISTS(SELECT 1 FROM mahara_console.metadata WHERE namespace='production' AND id LIKE 'access:agent:%' AND data->>'active'='true' AND data->'locationIds' ? $1) $q$ INTO caller USING b.location_id;
   EXCEPTION WHEN undefined_column OR insufficient_privilege THEN caller:=NULL; END;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',i,'name',coalesce((SELECT t->>'name' FROM jsonb_array_elements(b.ad_account_ties)t WHERE t->>'account'=i LIMIT 1),d.name),'status',s.account_status,'currency',s.currency,'readAt',s.fetched_at,'lastRan',d.last_ran,'hasHistory',d.n>0) ORDER BY (s.account_status=1) DESC NULLS LAST,d.last_ran DESC NULLS LAST,i),'[]') INTO accounts
  FROM unnest(ids)i LEFT JOIN public.cockpit_meta_account_state s ON s.account_id=i
  LEFT JOIN LATERAL (SELECT max(account_name) name,max(day) FILTER(WHERE spend>0) last_ran,count(*) n FROM public.cockpit_meta_ad_days WHERE account_id=i) d ON true;
  in_ads:=EXISTS(SELECT 1 FROM public.cockpit_campaigns c WHERE NOT c.source_deleted AND (regexp_replace(c.meta_account_id,'^act_','')=ANY(ids) OR lower(coalesce(nullif(c.raw_data->>'clientName',''),nullif(c.raw_data->>'accountName',''),c.client_name))=lower(b.client_name)));
  SELECT coalesce(jsonb_agg(to_jsonb(l)-'created_by_email'||jsonb_build_object('inAds',EXISTS(SELECT 1 FROM public.cockpit_campaigns c WHERE NOT c.source_deleted AND c.meta_campaign_id=l.meta_campaign_id),'today',(SELECT jsonb_build_object('impressions',sum(d.impressions),'spend',sum(d.spend_usd),'leads',sum(d.leads)) FROM public.cockpit_meta_ad_days d WHERE d.campaign_id=l.meta_campaign_id AND d.day=(now() AT TIME ZONE 'Asia/Kuwait')::date),'firstImpressionAt',(SELECT min(d.day) FROM public.cockpit_meta_ad_days d WHERE d.campaign_id=l.meta_campaign_id AND l.state='switched_on' AND d.day>=coalesce(l.impression_day,l.switched_on_at::date,l.created_at::date) GROUP BY d.day HAVING sum(d.impressions)>CASE WHEN d.day=l.impression_day THEN l.impressions_at_switch ELSE 0 END ORDER BY d.day LIMIT 1),'hasImpressions',EXISTS(SELECT 1 FROM public.cockpit_meta_ad_days d WHERE d.campaign_id=l.meta_campaign_id AND l.state='switched_on' AND d.day>=coalesce(l.impression_day,l.switched_on_at::date,l.created_at::date) GROUP BY d.day HAVING sum(d.impressions)>CASE WHEN d.day=l.impression_day THEN l.impressions_at_switch ELSE 0 END)) ORDER BY l.created_at DESC),'[]') INTO launches FROM public.cockpit_launches l WHERE clickup_id=b.clickup_id AND state<>'discarded';
  waiting:=EXISTS(SELECT 1 FROM jsonb_array_elements(launches)l WHERE l->>'state' IN ('built','switched_on','reconcile') AND l->>'inAds'='false' AND coalesce(l->>'hasImpressions','false')='false');
  ready:=(brief->>'sentAt' IS NOT NULL OR jsonb_array_length(tasks)>0) AND (b.status IN ('Launching','Active') OR coalesce((o->>'in_onboarding')::boolean,false));
  lane:=CASE WHEN b.status IN ('Stopped','Ghosting') THEN 'search' WHEN in_ads THEN 'ads' WHEN waiting THEN 'waiting' WHEN ready THEN 'ready' WHEN b.status='Launching' OR coalesce((o->>'in_onboarding')::boolean,false) THEN 'onboarding' WHEN waiting THEN 'waiting' ELSE 'nothing' END;
  history:='[]';
  IF p_clickup_id IS NOT NULL THEN
   SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.leads DESC NULLS LAST),'[]') INTO history FROM (
    SELECT d.account_id,d.campaign_id,max(d.campaign_name) name,max(d.day) FILTER(WHERE d.spend>0) last_ran,sum(d.leads) leads,sum(d.spend_usd) spend,CASE WHEN sum(d.leads)>0 THEN sum(d.spend_usd)/sum(d.leads) END cpl,
    (SELECT a.actor_name FROM public.cockpit_csm_meta_activities a WHERE a.account_id=d.account_id AND a.object_id=d.campaign_id AND a.event_type ILIKE '%create%' ORDER BY a.event_time LIMIT 1) creator
    FROM public.cockpit_meta_ad_days d WHERE d.account_id=ANY(ids) AND d.day>=current_date-120 GROUP BY d.account_id,d.campaign_id
   ) h;
  END IF;
  row_data:=jsonb_build_object('id',b.clickup_id,'locationId',b.location_id,'name',b.client_name,'status',b.status,'registryStatus',b.registry_status,'stage',b.card_stage,'serviceMode',b.service_mode,'lane',lane,'ghosted',coalesce(b.card_stage,'') ILIKE '%ghost%','readOnly',b.status IN ('Stopped','Ghosting'),'accounts',accounts,'brief',brief,'caller',caller,'cards',cards,'tasks',tasks,'launches',launches,'waiting',waiting,'inAds',in_ads,'history',history,'updatedAt',b.updated_at);
  IF p_clickup_id IS NOT NULL THEN
   row_data:=row_data||jsonb_build_object('handover',coalesce(o->'handover','{}'),'links',coalesce(o->'links','{}'),'people',coalesce((SELECT jsonb_agg(jsonb_build_object('name',actor_name,'kind',kind)) FROM public.cockpit_meta_people),'[]'),'activities',coalesce((SELECT jsonb_agg(to_jsonb(a)-'extra_data'-'task_id') FROM (SELECT * FROM public.cockpit_csm_meta_activities WHERE account_id=ANY(ids) ORDER BY event_time DESC LIMIT 500)a),'[]'),'excludedAds',coalesce((SELECT jsonb_agg(ad_id) FROM public.cockpit_excluded_ads WHERE account_id=ANY(ids)),'[]'),'starterPack',(SELECT value FROM public.cockpit_blueprint_settings WHERE key='pack.'||(brief->'answers'->>'service')));
   -- The agreed daily budget (20261103e): the kickoff's figure, the Ads card's (the mirror omits it) and the
   -- chain the desk's default and cap follow.
   kick:=public.cockpit_launch_kickoff_budget(b.clickup_id);
   ads:=public.cockpit_launch_ads_cards(ids,b.client_name);
   row_data:=row_data||jsonb_build_object('kickoffBudget',kick,'adsCards',ads,'agreedBudget',public.cockpit_launch_agreed_chain(cards||ads,brief,kick,coalesce(o->'handover','{}')));
  END IF;
  out_rows:=out_rows||jsonb_build_array(row_data);
 END LOOP;
 IF p_clickup_id IS NOT NULL AND jsonb_array_length(out_rows)<>1 THEN RAISE EXCEPTION 'That client is not on your access list'; END IF;
 SELECT max(updated_at) INTO source_at FROM public.cockpit_board_clients;
 RETURN jsonb_build_object('asOf',now(),'sources',jsonb_build_object('board',jsonb_build_object('at',source_at,'ok',source_at IS NOT NULL),'accounts',jsonb_build_object('at',(SELECT max(fetched_at) FROM public.cockpit_meta_account_state),'ok',EXISTS(SELECT 1 FROM public.cockpit_meta_account_state)),'onboarding',jsonb_build_object('at',(SELECT max(to_jsonb(obsource)->>'updated_at') FROM public.cockpit_client_onboarding obsource),'ok',EXISTS(SELECT 1 FROM public.cockpit_client_onboarding)),'blueprints',jsonb_build_object('at',(SELECT max(to_jsonb(bp)->>'updated_at') FROM public.cockpit_blueprints bp),'ok',true),'media',coalesce((SELECT jsonb_object_agg(ms.table_name,jsonb_build_object('at',ms.source_snapshot_at,'ok',ms.ready)) FROM public.cockpit_media_source_state ms WHERE ms.table_name IN ('boardCards','onboardings')),'{}')),'clients',out_rows,'lanes',jsonb_build_object('onboarding',(SELECT count(*) FROM jsonb_array_elements(out_rows)x WHERE x->>'lane'='onboarding'),'ready',(SELECT count(*) FROM jsonb_array_elements(out_rows)x WHERE x->>'lane'='ready'),'nothing',(SELECT count(*) FROM jsonb_array_elements(out_rows)x WHERE x->>'lane'='nothing'),'waiting',(SELECT count(*) FROM jsonb_array_elements(out_rows)x WHERE x->>'waiting'='true' AND x->>'readOnly'='false'),'ads',(SELECT count(*) FROM jsonb_array_elements(out_rows)x WHERE x->>'inAds'='true' AND x->>'readOnly'='false')));
END $function$;
REVOKE ALL ON FUNCTION public.cockpit_launch_pipeline(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_launch_pipeline(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. cockpit_media_account_scope_before_client_hold: 20261026t's body, with the contract read from the chain
--    (the pipeline row's agreedBudget). Grants as live: none (the wrapper cockpit_media_account_scope calls it).

CREATE OR REPLACE FUNCTION public.cockpit_media_account_scope_before_client_hold(p_operation text, p_clickup_id text, p_account text, p_launch uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE m public.cockpit_members; c jsonb; a jsonb; l public.cockpit_launches; contract numeric; source text; agreed jsonb;
BEGIN
 m:=public.cockpit_launch_member();
 IF p_operation NOT IN ('launch.readiness','launch.copyIdeas','launch.switchOn','launch.copy','launch.rebuild','launch.new','launch.attachAccount','launch.discard','launch.logCampaign') THEN RAISE EXCEPTION 'Unknown launch operation'; END IF;
 c:=public.cockpit_launch_pipeline(p_clickup_id)->'clients'->0;
 IF p_operation NOT IN ('launch.readiness','launch.copyIdeas') AND (c->>'readOnly')::boolean THEN RAISE EXCEPTION 'This client is stopped. Its launch history is read-only.'; END IF;
 IF p_operation NOT IN ('launch.readiness','launch.copyIdeas','launch.discard') AND c->>'status' NOT IN ('Active','Paused','Launching') THEN RAISE EXCEPTION 'The CSM marks this client Active before a launch'; END IF;
 IF p_operation='launch.readiness' AND p_account IS NULL THEN RETURN jsonb_build_object('actor',auth.uid(),'client',c->>'name','clickupId',p_clickup_id,'locationId',c->>'locationId','account',NULL); END IF;
 IF coalesce(p_account,'') !~ '^[0-9]{5,25}$' THEN RAISE EXCEPTION 'Choose a valid ad account'; END IF;
 SELECT x INTO a FROM jsonb_array_elements(c->'accounts')x WHERE x->>'id'=p_account;
 IF a IS NULL AND p_operation<>'launch.attachAccount' THEN RAISE EXCEPTION 'This ad account is not linked to this client'; END IF;
 IF p_operation='launch.attachAccount' AND EXISTS(SELECT 1 FROM public.cockpit_board_clients b WHERE b.location_id<>c->>'locationId' AND p_account=ANY(public.cockpit_launch_accounts(b.location_id))) THEN RAISE EXCEPTION 'This ad account belongs to another client'; END IF;
 IF p_operation='launch.attachAccount' AND EXISTS(SELECT 1 FROM public.cockpit_board_account_ties WHERE account_id=p_account AND (kept_out OR location_id<>c->>'locationId')) THEN RAISE EXCEPTION 'This ad account is kept out or belongs to another client'; END IF;
 IF p_operation NOT IN ('launch.readiness','launch.copyIdeas','launch.discard') THEN
  IF a->>'status'='3' THEN RAISE EXCEPTION 'This ad account owes Meta a payment. Meta refuses every change on it, pausing included, until the client pays in Ads Manager.'; END IF;
  IF a->>'status'='2' THEN RAISE EXCEPTION 'Meta has disabled this ad account. Nothing can run on it until the client''s appeal is accepted.'; END IF;
  IF a->>'status' IN ('100','101') THEN RAISE EXCEPTION 'This ad account is closed. Choose another account for this client.'; END IF;
 END IF;
 IF p_launch IS NOT NULL THEN
  SELECT * INTO l FROM public.cockpit_launches WHERE id=p_launch;
  IF l.id IS NULL OR l.clickup_id<>p_clickup_id OR l.account_id<>p_account OR l.state NOT IN ('built','switched_on') OR (p_operation IN ('launch.switchOn','launch.discard') AND l.state<>'built') THEN RAISE EXCEPTION 'This launch is unavailable or belongs to another client'; END IF;
 END IF;
 -- The agreed daily budget (20261103e): the Ads card, Blueprint part 1 sent, the kickoff, then the sale under $1,000.
 agreed:=coalesce(c->'agreedBudget',public.cockpit_launch_agreed_chain(c->'cards',c->'brief',c->'kickoffBudget',c->'handover'));
 contract:=CASE WHEN jsonb_typeof(agreed->'usd')='number' THEN (agreed->>'usd')::numeric END;
 source:=agreed->>'source';
 RETURN jsonb_build_object('actor',auth.uid(),'client',c->>'name','clickupId',p_clickup_id,'locationId',c->>'locationId','account',p_account,'founder',m.email IN ('aziz@maharamedia.com','awaheedi2008@gmail.com'),'admin','admin'=ANY(m.roles),'boardStatus',c->>'status','serviceMode',c->>'serviceMode','contractedUsd',contract,'contractSource',CASE WHEN contract IS NOT NULL THEN source END,'launch',CASE WHEN l.id IS NOT NULL THEN to_jsonb(l)-'created_by_email' END);
END $function$;
REVOKE ALL ON FUNCTION public.cockpit_media_account_scope_before_client_hold(text,text,text,uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. cockpit_board_client: 20261017100100's body, with the agreed note on the client's Budget/day cell. A note
--    that cannot be read says so in one sentence; the rest of the page stands. Grants as live: authenticated.

CREATE OR REPLACE FUNCTION public.cockpit_board_client(p_location text, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  c public.cockpit_board_clients;
  v_meta jsonb;
  v_row jsonb;
  t jsonb;
  v_marks jsonb;
  v_tree jsonb;
  v_cover jsonb;
  v_list jsonb;
  v_levers jsonb;
  v_board numeric;
  v_live integer;
  v_check text;
  v_facts_at timestamptz;
  v_budgets jsonb;
BEGIN
  IF NOT coalesce(public.cockpit_has_active_seat(), false) THEN
    RAISE EXCEPTION 'Sign in with an active cockpit seat to see the Client Performance board.' USING ERRCODE = '42501';
  END IF;
  PERFORM public.cockpit_board_check_window(p_from, p_to);
  SELECT * INTO c FROM public.cockpit_board_clients b WHERE b.location_id = p_location;
  IF c.location_id IS NULL OR NOT coalesce(public.cockpit_client_allowed(c.client_name), false) THEN
    RAISE EXCEPTION 'This client is not on your board.' USING ERRCODE = '42501';
  END IF;
  v_meta := public.cockpit_meta_ad_days_status();
  v_row := public.cockpit_board_rows(p_from, p_to, c.location_id, v_meta)->0;
  -- The agreed daily budget against the budget now (20261103e, DEL-13): display only, never judged.
  IF c.clickup_id IS NOT NULL AND jsonb_typeof(v_row->'values'->'dailyBudget') = 'object' THEN
    BEGIN
      v_row := jsonb_set(v_row, '{values,dailyBudget,agreed}', public.cockpit_board_agreed_note(c.clickup_id, v_row->'values'->'dailyBudget'));
    EXCEPTION WHEN OTHERS THEN
      v_row := jsonb_set(v_row, '{values,dailyBudget,agreed}', jsonb_build_object('words',
        'The agreed budget could not be read just now. Reload the page; if it stays, the tech lead checks the launch desk''s budget chain.'));
    END;
  END IF;
  t := public.cockpit_board_targets_map(c.clickup_id);
  v_marks := public.cockpit_board_marks_json(c.location_id, p_from, p_to);
  v_cover := public.cockpit_board_ad_cover(c.ad_account_ids, p_from, p_to, v_meta);
  v_tree := public.cockpit_board_tree(c.location_id, c.ad_account_ids, p_from, p_to, t, v_marks, v_cover);
  v_list := public.cockpit_board_no_outcome_list(c.location_id, p_from, p_to, v_marks);
  v_budgets := public.cockpit_board_budget_list(c.ad_account_ids, p_from, p_to, v_cover, v_meta, t);
  SELECT coalesce(jsonb_agg(public.cockpit_board_lever_json(l) ORDER BY l.created_at DESC), '[]'::jsonb) INTO v_levers
  FROM (SELECT * FROM public.cockpit_board_levers x WHERE x.location_id = c.location_id ORDER BY x.created_at DESC LIMIT 50) l;

  v_board := (v_row->>'noOutcome')::numeric;
  v_live := jsonb_array_length(v_list);
  v_facts_at := (v_row->>'computedAt')::timestamptz;
  v_check := concat_ws(' ',
    CASE WHEN v_marks IS NULL THEN 'The client sheet''s marks could not be read just now, so a meeting marked only in the sheet may be listed.' END,
    CASE WHEN v_board IS NOT NULL AND v_live < v_board THEN format('%s of the board''s %s ha%s been marked since the board''s figures were worked out at %s Kuwait time.',
           v_board - v_live, v_board, CASE WHEN v_board - v_live = 1 THEN 's' ELSE 've' END, to_char(v_facts_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI'))
         WHEN v_board IS NOT NULL AND v_live > v_board THEN format('%s more than the board''s %s: the board''s figures were worked out at %s Kuwait time.',
           v_live - v_board, v_board, to_char(v_facts_at AT TIME ZONE 'Asia/Kuwait', 'DD Mon HH24:MI')) END);

  RETURN jsonb_build_object(
    'version', 1,
    'from', p_from, 'to', p_to, 'today', v_today,
    'adWindow', jsonb_build_object('from', p_from, 'to', least(p_to, v_today - 1),
      'note', concat_ws(' ', 'Ad numbers end yesterday on each ad account''s own clock; CRM leads, bookings and shows per ad run to the end of the time frame.',
        v_cover->>'note')),
    'adCover', v_cover,
    'generatedAt', now(),
    'client', v_row,
    'clientName', c.client_name, 'locationId', c.location_id, 'clickupId', c.clickup_id, 'status', c.status,
    'targets', t,
    'campaigns', coalesce(v_tree->'campaigns', '[]'::jsonb),
    'notInStore', coalesce(v_tree->'notInStore', '[]'::jsonb),
    'noAd', v_tree->'noAd',
    'noOutcomeAppointments', v_list,
    'noOutcomeCheck', jsonb_build_object('board', v_board, 'live', v_live, 'note', nullif(v_check, '')),
    'levers', v_levers,
    'budgets', v_budgets,
    'canEditTargets', coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('admin'), false));
END $function$;
REVOKE ALL ON FUNCTION public.cockpit_board_client(text,date,date) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_board_client(text,date,date) TO authenticated;

COMMIT;
