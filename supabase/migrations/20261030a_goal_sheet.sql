-- The month as a spreadsheet, and last month locked in.
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive.
--
-- Aziz, 2026-10-30: "Maybe have that same type of spreadsheet in the Goal CEO
-- section with those objectives there. Maybe I can add some more metrics", and
-- his outline "Lock In Last Month" then "Projections For Next Month".
--
-- The sheet's targets are not stored here. They are cockpit_goal_targets rows
-- on the month's plan, so the sheet and the Goals board read one number. What
-- is new is what the plan never held: a value per day, a metric Aziz adds
-- himself, and the month's lock-in lines with their source and what they leave
-- out.
--
-- Founder only: every function goes through cockpit_goal_actor(), the same
-- door as the rest of Goals. The tables have no browser grant. Every write
-- leaves a row in cockpit_audit_log.

BEGIN;

CREATE TABLE IF NOT EXISTS public.cockpit_goal_sheet_metrics (
  key         text PRIMARY KEY CHECK (key ~ '^[a-z][a-zA-Z0-9_]{0,40}$'),
  label       text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 60),
  section     text NOT NULL CHECK (section IN ('sales_marketing','client_success','sales_x_cs','finances','client_media','call_center','creative','custom')),
  unit        text NOT NULL DEFAULT 'count' CHECK (unit IN ('usd','count','rate','x','pts','days')),
  direction   text NOT NULL DEFAULT 'up' CHECK (direction IN ('up','down')),
  rollup      text NOT NULL DEFAULT 'sum' CHECK (rollup IN ('sum','avg','last')),
  note        text CHECK (note IS NULL OR length(note) <= 300),
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by text
);
COMMENT ON TABLE public.cockpit_goal_sheet_metrics IS
  'Metrics the CEO added to the Goals sheet himself. The outline''s own metrics are in code (goalsSheetModel.ts). A removed metric is archived so its typed days are kept.';

CREATE TABLE IF NOT EXISTS public.cockpit_goal_sheet_cells (
  day        date NOT NULL,
  metric_key text NOT NULL CHECK (metric_key ~ '^[a-z][a-zA-Z0-9_]{0,40}$'),
  -- actual: what happened, typed over or beside what the cockpit measures.
  -- plan: that day's share of the projection, when an even split is not it.
  kind       text NOT NULL CHECK (kind IN ('actual','plan')),
  value      numeric NOT NULL,
  note       text CHECK (note IS NULL OR length(note) <= 300),
  updated_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, metric_key, kind)
);
COMMENT ON TABLE public.cockpit_goal_sheet_cells IS
  'One typed number per day, metric and kind on the Goals sheet. Empty means missing, never zero: clearing a cell deletes its row.';

CREATE TABLE IF NOT EXISTS public.cockpit_goal_lockin_rows (
  id          bigserial PRIMARY KEY,
  month       text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  section     text NOT NULL,
  sort        integer NOT NULL DEFAULT 0,
  label       text NOT NULL,
  value       text,
  -- measured: read from a source. partial: read, with a known hole. typed: a
  -- person's word. missing: not held anywhere yet, and source says what would
  -- give it. Never a zero standing in for a gap.
  status      text NOT NULL DEFAULT 'measured' CHECK (status IN ('measured','partial','typed','missing')),
  source      text,
  leaves_out  text,
  -- When set, the screen shows the sheet's live number until the month is locked.
  metric_key  text,
  client_task_id text,
  -- Free answers a row's section asks for: form, why, prevent, keep, missed.
  answers     jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
  updated_by  text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (month, section, label)
);
COMMENT ON TABLE public.cockpit_goal_lockin_rows IS
  'One line of a month''s lock-in: the number or the client, where it came from, what it leaves out, and the answers typed against it.';
CREATE INDEX IF NOT EXISTS cockpit_goal_lockin_rows_month ON public.cockpit_goal_lockin_rows (month, section, sort);

CREATE TABLE IF NOT EXISTS public.cockpit_goal_lockin_months (
  month     text PRIMARY KEY CHECK (month ~ '^\d{4}-\d{2}$'),
  locked_at timestamptz,
  locked_by text,
  note      text
);
COMMENT ON TABLE public.cockpit_goal_lockin_months IS
  'Whether a month''s lock-in is frozen, by whom and when.';

ALTER TABLE public.cockpit_goal_sheet_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_goal_sheet_cells   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_goal_lockin_rows   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_goal_lockin_months ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_goal_sheet_metrics, public.cockpit_goal_sheet_cells,
  public.cockpit_goal_lockin_rows, public.cockpit_goal_lockin_months FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.cockpit_goal_lockin_rows_id_seq FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.cockpit_goal_sheet_metrics, public.cockpit_goal_sheet_cells,
  public.cockpit_goal_lockin_rows, public.cockpit_goal_lockin_months TO service_role;
GRANT ALL ON SEQUENCE public.cockpit_goal_lockin_rows_id_seq TO service_role;

-- Every write leaves an audit row, whichever door it came through.
CREATE OR REPLACE FUNCTION public.cockpit_goal_sheet_write_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE who text; j jsonb;
BEGIN
  SELECT lower(btrim(email)) INTO who FROM auth.users WHERE id = auth.uid();
  IF TG_OP = 'DELETE' THEN j := to_jsonb(OLD); ELSE j := to_jsonb(NEW); END IF;
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after)
    VALUES (TG_OP, TG_TABLE_NAME,
      coalesce(j->>'id', j->>'key', (j->>'day')||':'||(j->>'metric_key')||':'||(j->>'kind'), j->>'month'),
      coalesce(who, session_user), 'ceo-goals-sheet', 'supabase',
      CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE NULL END,
      CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) ELSE NULL END);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS cockpit_goal_sheet_metrics_audit ON public.cockpit_goal_sheet_metrics;
CREATE TRIGGER cockpit_goal_sheet_metrics_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_goal_sheet_metrics
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_goal_sheet_write_audit();
DROP TRIGGER IF EXISTS cockpit_goal_sheet_cells_audit ON public.cockpit_goal_sheet_cells;
CREATE TRIGGER cockpit_goal_sheet_cells_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_goal_sheet_cells
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_goal_sheet_write_audit();
DROP TRIGGER IF EXISTS cockpit_goal_lockin_rows_audit ON public.cockpit_goal_lockin_rows;
CREATE TRIGGER cockpit_goal_lockin_rows_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_goal_lockin_rows
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_goal_sheet_write_audit();
DROP TRIGGER IF EXISTS cockpit_goal_lockin_months_audit ON public.cockpit_goal_lockin_months;
CREATE TRIGGER cockpit_goal_lockin_months_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_goal_lockin_months
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_goal_sheet_write_audit();

-- Everything one tab of the sheet needs, in one read. Numbers are read from
-- the tables and sections the rest of the cockpit reads; a section that has not
-- been computed is simply absent, so the screen says missing rather than zero.
CREATE OR REPLACE FUNCTION public.cockpit_ceo_goal_sheet_context(p_month text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  who text; first_day date; last_day date; from_day date;
  p public.cockpit_goal_plans; growth jsonb; money jsonb; delivery jsonb;
BEGIN
  who := public.cockpit_goal_actor();
  IF p_month IS NULL OR p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Choose a month like 2026-11' USING ERRCODE='22023';
  END IF;
  first_day := (p_month||'-01')::date;
  last_day := (first_day + interval '1 month - 1 day')::date;
  -- The rolling rows (the last 30 days) reach into the month before.
  from_day := (first_day - interval '1 month')::date;

  SELECT * INTO p FROM public.cockpit_goal_plans
    WHERE period_from = first_day AND period_to = last_day ORDER BY id DESC LIMIT 1;
  SELECT payload INTO growth FROM public.cockpit_sections WHERE key='growth' AND ok AND payload IS NOT NULL;
  SELECT payload INTO money FROM public.cockpit_sections WHERE key='money' AND ok AND payload IS NOT NULL;
  SELECT payload INTO delivery FROM public.cockpit_sections WHERE key='delivery' AND ok AND payload IS NOT NULL;

  RETURN jsonb_build_object(
    'today', ((now() AT TIME ZONE 'Asia/Kuwait')::date)::text,
    'month', p_month,
    'plan', CASE WHEN p.id IS NULL THEN NULL ELSE to_jsonb(p) END,
    'plans', (SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'periodFrom',x.period_from,'periodTo',x.period_to,'title',x.title,'status',x.status) ORDER BY x.period_from),'[]'::jsonb)
      FROM public.cockpit_goal_plans x WHERE x.period_kind='month'),
    'targets', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.sort,t.id),'[]'::jsonb)
      FROM public.cockpit_goal_targets t WHERE t.plan_id = p.id),
    'metrics', (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.created_at),'[]'::jsonb)
      FROM public.cockpit_goal_sheet_metrics m WHERE m.archived_at IS NULL),
    'cells', (SELECT coalesce(jsonb_agg(jsonb_build_object('day',c.day,'key',c.metric_key,'kind',c.kind,'value',c.value,'note',c.note,'by',c.updated_by,'at',c.updated_at)),'[]'::jsonb)
      FROM public.cockpit_goal_sheet_cells c WHERE c.day BETWEEN from_day AND last_day),
    'growthDaily', (SELECT coalesce(jsonb_agg(d),'[]'::jsonb) FROM jsonb_array_elements(coalesce(growth->'daily','[]'::jsonb)) d
      WHERE (d->>'date')::date BETWEEN from_day AND last_day),
    'windows', jsonb_build_array(
      jsonb_build_object('from', growth #>> '{windows,mtd,from}', 'raw', growth #> '{windows,mtd,raw}'),
      jsonb_build_object('from', growth #>> '{windows,lastMonth,from}', 'raw', growth #> '{windows,lastMonth,raw}')),
    'cashDaily', (SELECT coalesce(jsonb_agg(jsonb_build_object('date',x.day,'usd',x.usd)),'[]'::jsonb) FROM (
        SELECT t->>'day' AS day, round(sum((t->>'usd')::numeric),2) AS usd
        FROM jsonb_array_elements(coalesce(money #> '{attribution,transactions}','[]'::jsonb)) t
        WHERE t->>'direction'='in' AND (t->>'day')::date BETWEEN from_day AND last_day
          -- Bank lines matched to nobody are a classification question, not client cash: the Money tab leaves them out too.
          AND NOT (t->>'side'='unattributed' AND t->>'rail'='bank')
        GROUP BY 1) x),
    'book', money->'book',
    'refundsMonthly', (SELECT coalesce(jsonb_agg(jsonb_build_object('month',m->>'month','refunds',m->'refunds')),'[]'::jsonb)
      FROM jsonb_array_elements(coalesce(money->'monthly','[]'::jsonb)) m),
    'bankThrough', money #>> '{bank,lastStatementTo}',
    'deliveryDaily', (SELECT coalesce(jsonb_agg(d),'[]'::jsonb) FROM jsonb_array_elements(coalesce(delivery->'daily','[]'::jsonb)) d
      WHERE (d->>'date')::date BETWEEN from_day AND last_day),
    'mediaDaily', (SELECT coalesce(jsonb_agg(jsonb_build_object('date',x.day,'spend',x.spend,'impressions',x.impressions,'clicks',x.clicks,'leads',x.leads)),'[]'::jsonb) FROM (
        SELECT s.day::text AS day, sum((s.data->>'spend')::numeric) AS spend, sum((s.data->>'impressions')::numeric) AS impressions,
          sum((s.data->>'linkClicks')::numeric) AS clicks, sum((s.data->>'leads')::numeric) AS leads
        FROM public.cockpit_media_daily_stats s WHERE s.day BETWEEN from_day AND last_day GROUP BY 1) x),
    'clientDaily', (SELECT coalesce(jsonb_agg(jsonb_build_object('date',x.day,'closes',x.closes,'qualitySum',x.q,'qualityCount',x.n)),'[]'::jsonb) FROM (
        SELECT d.day::text AS day, sum(d.closes) AS closes, sum(d.lead_quality_sum) AS q, sum(d.lead_quality_count) AS n
        FROM public.cockpit_client_days d WHERE d.day BETWEEN from_day AND last_day GROUP BY 1) x),
    'churned', (SELECT coalesce(jsonb_agg(jsonb_build_object('leftOn',d.left_on,'client',d.client,'reason',d.reason)),'[]'::jsonb)
      FROM public.cockpit_churn_departures d WHERE d.removed_at IS NULL AND d.left_on BETWEEN from_day AND last_day
        -- The CEO's count (30 Oct): every departure but a finished term. Joe and Sera is on the
        -- register as non-payment, so it counts here though the Churn page's day-90 rule files it apart.
        AND d.reason <> 'Completed term, did not renew'),
    'churnMonths', (SELECT coalesce(jsonb_agg(jsonb_build_object('month',m.month,'activeAtStart',m.active_at_start,'lostBefore',m.lost_before_register)),'[]'::jsonb)
      FROM public.cockpit_churn_months m WHERE m.month IN (p_month, to_char(from_day,'YYYY-MM'))),
    'softwareMonthly', (SELECT round(sum(l.unit_price * coalesce(l.seats,1) / CASE WHEN l.billing='yearly' THEN 12 ELSE 1 END),2)
      FROM public.cockpit_cost_lines l WHERE l.kind='software' AND l.status='active' AND l.currency='USD'),
    'lockin', (SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.section,r.sort,r.id),'[]'::jsonb)
      FROM public.cockpit_goal_lockin_rows r WHERE r.month = p_month),
    'locked', (SELECT to_jsonb(l) FROM public.cockpit_goal_lockin_months l WHERE l.month = p_month));
END $$;

-- A batch of typed cells: a number sets the cell, null clears it. Pasting a
-- block from a spreadsheet lands here as one call.
CREATE OR REPLACE FUNCTION public.cockpit_ceo_goal_sheet_save_cells(p_cells jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE who text; c jsonb; n integer := 0; v_day date; v_key text; v_kind text;
BEGIN
  who := public.cockpit_goal_actor();
  IF jsonb_typeof(p_cells) IS DISTINCT FROM 'array' OR jsonb_array_length(p_cells) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'Send between 1 and 1000 cells' USING ERRCODE='22023';
  END IF;
  FOR c IN SELECT value FROM jsonb_array_elements(p_cells) LOOP
    IF jsonb_typeof(c) <> 'object' OR (c->>'day') !~ '^\d{4}-\d{2}-\d{2}$' THEN
      RAISE EXCEPTION 'Each cell needs a day' USING ERRCODE='22023';
    END IF;
    v_day := (c->>'day')::date;
    v_key := c->>'key';
    v_kind := coalesce(c->>'kind','actual');
    IF v_key IS NULL OR v_key !~ '^[a-z][a-zA-Z0-9_]{0,40}$' OR v_kind NOT IN ('actual','plan') THEN
      RAISE EXCEPTION 'Check the cell''s metric and kind' USING ERRCODE='22023';
    END IF;
    IF NOT (c ? 'value') OR c->'value' = 'null'::jsonb THEN
      DELETE FROM public.cockpit_goal_sheet_cells WHERE day=v_day AND metric_key=v_key AND kind=v_kind;
    ELSIF jsonb_typeof(c->'value') <> 'number' THEN
      RAISE EXCEPTION 'A cell holds a number or nothing' USING ERRCODE='22023';
    ELSE
      INSERT INTO public.cockpit_goal_sheet_cells(day,metric_key,kind,value,note,updated_by)
        VALUES (v_day,v_key,v_kind,(c->>'value')::numeric,left(nullif(btrim(c->>'note'),''),300),who)
        ON CONFLICT (day,metric_key,kind) DO UPDATE
          SET value=EXCLUDED.value, note=coalesce(EXCLUDED.note,public.cockpit_goal_sheet_cells.note),
              updated_by=who, updated_at=now();
    END IF;
    n := n + 1;
  END LOOP;
  RETURN jsonb_build_object('saved', n);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_goal_sheet_add_metric(p_metric jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE who text; base text; v_key text; n integer := 1; v_label text;
BEGIN
  who := public.cockpit_goal_actor();
  IF jsonb_typeof(p_metric) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Metric must be an object' USING ERRCODE='22023'; END IF;
  v_label := btrim(coalesce(p_metric->>'label',''));
  IF length(v_label) NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'Name the metric in 60 characters or fewer' USING ERRCODE='22023'; END IF;
  -- The key comes from the name; an Arabic name has no latin letters, so it falls back to a plain word.
  base := 'c' || left(regexp_replace(lower(v_label),'[^a-z0-9]+','_','g'),30);
  IF base = 'c' OR base = 'c_' THEN base := 'cmetric'; END IF;
  v_key := base;
  WHILE EXISTS (SELECT 1 FROM public.cockpit_goal_sheet_metrics WHERE key=v_key) LOOP
    n := n + 1; v_key := base || '_' || n;
  END LOOP;
  INSERT INTO public.cockpit_goal_sheet_metrics(key,label,section,unit,direction,rollup,note,created_by)
    VALUES (v_key, v_label, coalesce(p_metric->>'section','custom'), coalesce(p_metric->>'unit','count'),
      coalesce(p_metric->>'direction','up'), coalesce(p_metric->>'rollup','sum'),
      left(nullif(btrim(p_metric->>'note'),''),300), who);
  RETURN jsonb_build_object('key', v_key);
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_goal_sheet_remove_metric(p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE who text;
BEGIN
  who := public.cockpit_goal_actor();
  UPDATE public.cockpit_goal_sheet_metrics SET archived_at=now(), archived_by=who
    WHERE key=p_key AND archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'That metric is not on the sheet' USING ERRCODE='22023'; END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- A lock-in line: its answers merge; its number and status change until the month is locked.
CREATE OR REPLACE FUNCTION public.cockpit_ceo_goal_lockin_save(p_row jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE who text; r public.cockpit_goal_lockin_rows; k text;
BEGIN
  who := public.cockpit_goal_actor();
  IF jsonb_typeof(p_row) IS DISTINCT FROM 'object' OR jsonb_typeof(p_row->'id') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'Choose a line to change' USING ERRCODE='22023';
  END IF;
  FOR k IN SELECT jsonb_object_keys(p_row) LOOP
    IF k <> ALL(ARRAY['id','value','status','answers']) THEN
      RAISE EXCEPTION 'Unknown lock-in field: %', k USING ERRCODE='22023';
    END IF;
  END LOOP;
  SELECT * INTO r FROM public.cockpit_goal_lockin_rows WHERE id=(p_row->>'id')::bigint FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That line is not there any more' USING ERRCODE='22023'; END IF;
  IF (p_row ? 'value' OR p_row ? 'status')
     AND EXISTS (SELECT 1 FROM public.cockpit_goal_lockin_months m WHERE m.month=r.month AND m.locked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'This month is locked. Unlock it to change a number.' USING ERRCODE='22023';
  END IF;
  IF p_row ? 'answers' AND jsonb_typeof(p_row->'answers') <> 'object' THEN
    RAISE EXCEPTION 'Answers must be an object' USING ERRCODE='22023';
  END IF;
  IF p_row ? 'status' AND (p_row->>'status') NOT IN ('measured','partial','typed','missing') THEN
    RAISE EXCEPTION 'Unknown status' USING ERRCODE='22023';
  END IF;
  UPDATE public.cockpit_goal_lockin_rows SET
      value = CASE WHEN p_row ? 'value' THEN left(nullif(btrim(p_row->>'value'),''),400) ELSE value END,
      status = coalesce(p_row->>'status', status),
      answers = answers || coalesce(p_row->'answers','{}'::jsonb),
      updated_by = who, updated_at = now()
    WHERE id = r.id RETURNING * INTO r;
  RETURN to_jsonb(r);
END $$;

-- Lock freezes the month's numbers: lines tied to the sheet take the live
-- number the screen sends. Unlock is the same door and leaves the same audit row.
CREATE OR REPLACE FUNCTION public.cockpit_ceo_goal_lockin_lock(p_month text, p_lock boolean, p_values jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE who text; k text; v jsonb;
BEGIN
  who := public.cockpit_goal_actor();
  IF p_month IS NULL OR p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Choose a month like 2026-10' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p_values) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Values must be an object' USING ERRCODE='22023'; END IF;
  IF p_lock THEN
    FOR k, v IN SELECT key, value FROM jsonb_each(p_values) LOOP
      UPDATE public.cockpit_goal_lockin_rows SET value=left(v #>> '{}',400), updated_by=who, updated_at=now()
        WHERE month=p_month AND metric_key=k;
    END LOOP;
  END IF;
  INSERT INTO public.cockpit_goal_lockin_months(month,locked_at,locked_by)
    VALUES (p_month, CASE WHEN p_lock THEN now() END, CASE WHEN p_lock THEN who END)
    ON CONFLICT (month) DO UPDATE SET locked_at=EXCLUDED.locked_at, locked_by=EXCLUDED.locked_by;
  RETURN jsonb_build_object('locked', p_lock);
END $$;

-- The Goals board: a draft for this month is this month's plan. Without this a
-- draft for next month took the board early, because the fallback is the newest.
CREATE OR REPLACE FUNCTION public.cockpit_ceo_goals_context(p_plan_id bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE p public.cockpit_goal_plans; plans jsonb; targets jsonb; payloads jsonb;
  scorecards integer; today date := (now() AT TIME ZONE 'Asia/Kuwait')::date; result jsonb;
BEGIN
  PERFORM public.cockpit_goal_actor();
  IF p_plan_id IS NOT NULL THEN
    SELECT * INTO p FROM public.cockpit_goal_plans WHERE id=p_plan_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Plan no longer exists' USING ERRCODE='22023'; END IF;
  ELSE
    SELECT * INTO p FROM public.cockpit_goal_plans
      WHERE period_from<=today AND period_to>=today
      ORDER BY (status='draft') ASC, period_from DESC, id DESC LIMIT 1;
    IF NOT FOUND THEN
      SELECT * INTO p FROM public.cockpit_goal_plans ORDER BY period_from DESC,id DESC LIMIT 1;
    END IF;
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.period_from DESC,t.id DESC),'[]') INTO plans
    FROM (SELECT id,title,period_from,period_to,status FROM public.cockpit_goal_plans
      ORDER BY period_from DESC,id DESC LIMIT 48) t;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.group_key,t.sort,t.id),'[]') INTO targets
    FROM public.cockpit_goal_targets t WHERE t.plan_id=p.id;
  SELECT coalesce(jsonb_object_agg(key,payload),'{}') INTO payloads
    FROM public.cockpit_sections WHERE key IN ('growth','money','delivery','organic')
      AND ok AND payload IS NOT NULL;
  IF p.id IS NOT NULL AND to_char(p.period_from,'YYYY-MM')=to_char(p.period_to,'YYYY-MM') THEN
    SELECT count(*)::integer INTO scorecards FROM public.cockpit_scorecards
      WHERE month=to_char(p.period_from,'YYYY-MM') AND status='final';
  END IF;
  result := jsonb_build_object('plan',CASE WHEN p.id IS NULL THEN NULL ELSE to_jsonb(p) END,
    'plans',plans,'targets',targets,'payloads',payloads,'scorecardsDone',scorecards,'today',today::text);
  RETURN result || jsonb_build_object('fingerprint',md5((result-'plans')::text));
END $$;

REVOKE ALL ON FUNCTION public.cockpit_goal_sheet_write_audit() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.cockpit_ceo_goal_sheet_context(text), public.cockpit_ceo_goal_sheet_save_cells(jsonb),
  public.cockpit_ceo_goal_sheet_add_metric(jsonb), public.cockpit_ceo_goal_sheet_remove_metric(text),
  public.cockpit_ceo_goal_lockin_save(jsonb), public.cockpit_ceo_goal_lockin_lock(text,boolean,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_goal_sheet_context(text), public.cockpit_ceo_goal_sheet_save_cells(jsonb),
  public.cockpit_ceo_goal_sheet_add_metric(jsonb), public.cockpit_ceo_goal_sheet_remove_metric(text),
  public.cockpit_ceo_goal_lockin_save(jsonb), public.cockpit_ceo_goal_lockin_lock(text,boolean,jsonb) TO authenticated, service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
