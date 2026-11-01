-- Readers repointed (waves 1 and 2, readers-guardian): the goal sheet and the
-- lock-in read the month's lifecycle from the cockpit's own records, and the
-- November plan scores three client-success targets from the metric registry.
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive. docs/forms/WAVE12-CONTRACT.md
-- sections 2.8 and 4.11. Applied last of the block 20261101l to q (D-Q1).
--
-- 1. cockpit_ceo_goal_sheet_context(text) gains `lifecycle` {extensions,
--    latePayments, departures, missing} for the month and `manualLogged`. The
--    three reads are guarded: before 20261101o/p are live the matching list is
--    NULL with a sentence in `missing`, never an empty list (missing is never
--    zero). Same gate (cockpit_goal_actor), same grants as live.
-- 2. The November plan's targets extensionsGiven, clientsChurned and churnRate
--    name their metric (actual_source). Only a NULL source is set, so a source
--    the CEO picked is never overwritten, and a second apply touches nothing.
-- 3. cockpit_csm_call_forms takes the termination survey (Typeform knIe4eF3,
--    kind exit_survey), so the csm-calls worker can keep it on the client's
--    timeline. Release csm-calls only after this file is live.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard (2.1): the live body read for this contract, or this
--    file's own body on a second apply.

DO $$
DECLARE v text;
BEGIN
  SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v
    FROM pg_catalog.pg_proc p
   WHERE p.oid = 'public.cockpit_ceo_goal_sheet_context(text)'::regprocedure;
  IF v IS DISTINCT FROM '8ca5e4d3281f5035bf7fec046c4fef15' AND v IS DISTINCT FROM '0bfea71f5d53ebf6246f84f351cfc97a' THEN
    RAISE EXCEPTION 'cockpit_ceo_goal_sheet_context changed since the waves 1-2 contract read it; stop and re-read it.'
      USING ERRCODE = '55000';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. The goal sheet's context, with the month's lifecycle

CREATE OR REPLACE FUNCTION public.cockpit_ceo_goal_sheet_context(p_month text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  who text; first_day date; last_day date; from_day date;
  p public.cockpit_goal_plans; growth jsonb; money jsonb; delivery jsonb;
  today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  ext jsonb; late jsonb; dep jsonb; missing jsonb := '[]'::jsonb;
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

  -- The month's lifecycle, from the three records the CSM's acts write (WAVE12-CONTRACT 2.8, 4.11):
  -- extension grants (cockpit_extensions_v, billing events only), late spells (cockpit_late_payments_v,
  -- the daily card snapshots) and departures (the churn register with its confirm columns). Each row
  -- carries its source sentence. A record that is not there yet is NULL with a sentence in `missing`,
  -- never an empty list that reads as none.
  IF to_regclass('public.cockpit_extensions_v') IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'grantId', e.grant_id, 'taskId', e.clickup_task_id, 'client', e.client_name,
        'grantedOn', e.granted_on, 'weeks', e.weeks, 'from', e.from_date, 'until', e.until,
        'state', e.state, 'reason', e.reason, 'ours', e.ours, 'atRisk', e.at_risk,
        'seatRole', e.seat_role,
        'source', format('Given in the cockpit on %s%s; the grant %s.',
          to_char(e.granted_on, 'FMDD Mon'),
          CASE e.seat_role WHEN 'csm' THEN ' by the CSM' WHEN 'finance' THEN ' by finance' WHEN 'ceo' THEN ' by the CEO' ELSE ' on the billing sheet' END,
          CASE e.state WHEN 'live' THEN format('runs to %s', to_char(e.until, 'FMDD Mon'))
                       WHEN 'replaced' THEN 'was replaced by a longer one'
                       ELSE format('ended %s', to_char(e.until, 'FMDD Mon')) END))
        ORDER BY e.granted_on, e.grant_id), '[]'::jsonb)
      INTO ext
      FROM public.cockpit_extensions_v e
     WHERE e.granted_on BETWEEN first_day AND last_day;
  ELSE
    missing := missing || jsonb_build_array('Extensions are not read: cockpit_extensions_v is not live yet (migration 20261101p).');
  END IF;

  IF to_regclass('public.cockpit_late_payments_v') IS NOT NULL THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'taskId', l.clickup_task_id, 'client', l.client_name, 'dueOn', l.due_on,
        'amountUsd', l.amount_usd, 'endedOn', l.ended_on, 'closedHow', l.closed_how,
        'paidOn', l.paid_on, 'daysLate', l.days_late,
        'source', format('The card''s next payment date in the daily snapshots: due %s, %s%s.',
          to_char(l.due_on, 'FMDD Mon'),
          CASE l.closed_how WHEN 'open' THEN format('still late, %s days', l.days_late)
                            WHEN 'extended' THEN 'an extension moved the date'
                            WHEN 'stopped' THEN 'the client stopped'
                            ELSE 'the date moved on the card' END,
          CASE WHEN l.paid_on IS NOT NULL THEN format('; paid %s on the rails', to_char(l.paid_on, 'FMDD Mon'))
               ELSE '; no payment on the rails' END))
        ORDER BY l.due_on, l.client_name), '[]'::jsonb)
      INTO late
      FROM public.cockpit_late_payments_v l
     WHERE l.due_on <= last_day AND coalesce(l.ended_on, today) >= first_day;
  ELSE
    missing := missing || jsonb_build_array('Late payments are not read: cockpit_late_payments_v is not live yet (migration 20261101p).');
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
              WHERE a.attrelid = 'public.cockpit_churn_departures'::regclass
                AND a.attname = 'confirmed_at' AND NOT a.attisdropped) THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'departureId', d.id, 'taskId', d.clickup_task_id, 'client', d.client, 'leftOn', d.left_on,
        'reason', d.reason, 'churnType', d.churn_type, 'whyDetail', d.why_detail,
        'howToStop', d.how_to_stop, 'surveyState', d.survey_state, 'noticeOn', d.notice_on,
        'mrrLostUsd', d.mrr_lost_usd, 'confirmed', d.confirmed_at IS NOT NULL,
        'confirmedOn', ((d.confirmed_at AT TIME ZONE 'Asia/Kuwait')::date),
        'source', CASE WHEN d.confirmed_at IS NOT NULL
          THEN format('Confirmed in the cockpit on %s; left %s.',
                 to_char((d.confirmed_at AT TIME ZONE 'Asia/Kuwait')::date, 'FMDD Mon'), to_char(d.left_on, 'FMDD Mon'))
          ELSE format('Logged in the churn register, not confirmed; left %s.', to_char(d.left_on, 'FMDD Mon')) END)
        ORDER BY d.left_on, d.id), '[]'::jsonb)
      INTO dep
      FROM public.cockpit_churn_departures d
     WHERE d.removed_at IS NULL AND d.left_on BETWEEN first_day AND last_day;
  ELSE
    missing := missing || jsonb_build_array('Departures are read without their confirm: the churn confirm columns are not live yet (migration 20261101o).');
  END IF;

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
    'locked', (SELECT to_jsonb(l) FROM public.cockpit_goal_lockin_months l WHERE l.month = p_month))
  || jsonb_build_object(
    'lifecycle', jsonb_build_object('extensions', ext, 'latePayments', late, 'departures', dep, 'missing', missing),
    -- Hand-logged money not yet checked against the bank (checked-money's rails.manualLogged): the lock-in's
    -- "Logged, not checked" line on Total new cash. NULL until the money refresh writes it.
    'manualLogged', money #> '{rails,manualLogged}');
END $$;

REVOKE ALL ON FUNCTION public.cockpit_ceo_goal_sheet_context(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_goal_sheet_context(text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. November's client-success targets name the metric that scores them

SELECT set_config('cockpit.audit_actor', 'migration 20261101q', true),
       set_config('cockpit.audit_source', 'migration', true);

UPDATE public.cockpit_goal_targets t
   SET actual_source = v.source
  FROM (VALUES ('extensionsGiven', 'clients.extensions.granted'),
               ('clientsChurned', 'clients.churn.confirmed'),
               ('churnRate', 'clients.churn.rate')) AS v(metric_key, source)
 WHERE t.metric_key = v.metric_key
   AND t.actual_source IS NULL
   AND t.plan_id = (SELECT g.id FROM public.cockpit_goal_plans g
                     WHERE g.period_from = DATE '2026-11-01' AND g.period_kind = 'month'
                     ORDER BY g.id DESC LIMIT 1);

-- ---------------------------------------------------------------------------
-- 3. The termination survey on the CSM's call store (csm-calls FORMS)

DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_csm_call_forms'::regclass
     AND c.conname = 'cockpit_csm_call_forms_form_id_check';
  IF v_def IS DISTINCT FROM 'CHECK ((form_id = ANY (ARRAY[''fRokTITH''::text, ''KFRCXPFx''::text, ''tG7dnxBn''::text, ''BbJy6xg4''::text, ''oYZKtogO''::text, ''cockpit-checkin''::text, ''knIe4eF3''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((form_id = ANY (ARRAY[''fRokTITH''::text, ''KFRCXPFx''::text, ''tG7dnxBn''::text, ''BbJy6xg4''::text, ''oYZKtogO''::text, ''cockpit-checkin''::text])))' THEN
      RAISE EXCEPTION 'cockpit_csm_call_forms_form_id_check changed since the waves 1-2 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_csm_call_forms DROP CONSTRAINT IF EXISTS cockpit_csm_call_forms_form_id_check;
    ALTER TABLE public.cockpit_csm_call_forms ADD CONSTRAINT cockpit_csm_call_forms_form_id_check
      CHECK (form_id = ANY (ARRAY['fRokTITH','KFRCXPFx','tG7dnxBn','BbJy6xg4','oYZKtogO','cockpit-checkin','knIe4eF3']));
  END IF;
  SELECT pg_catalog.pg_get_constraintdef(c.oid) INTO v_def FROM pg_catalog.pg_constraint c
   WHERE c.conrelid = 'public.cockpit_csm_call_forms'::regclass
     AND c.conname = 'cockpit_csm_call_forms_form_kind_check';
  IF v_def IS DISTINCT FROM 'CHECK ((form_kind = ANY (ARRAY[''checkin''::text, ''onboarding''::text, ''kickoff''::text, ''kickoff_old''::text, ''blueprint''::text, ''checkin_late''::text, ''exit_survey''::text])))' THEN
    IF v_def IS DISTINCT FROM 'CHECK ((form_kind = ANY (ARRAY[''checkin''::text, ''onboarding''::text, ''kickoff''::text, ''kickoff_old''::text, ''blueprint''::text, ''checkin_late''::text])))' THEN
      RAISE EXCEPTION 'cockpit_csm_call_forms_form_kind_check changed since the waves 1-2 contract read it; stop and re-read it.' USING ERRCODE = '55000';
    END IF;
    ALTER TABLE public.cockpit_csm_call_forms DROP CONSTRAINT IF EXISTS cockpit_csm_call_forms_form_kind_check;
    ALTER TABLE public.cockpit_csm_call_forms ADD CONSTRAINT cockpit_csm_call_forms_form_kind_check
      CHECK (form_kind = ANY (ARRAY['checkin','onboarding','kickoff','kickoff_old','blueprint','checkin_late','exit_survey']));
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;
