-- Billing, native: the ClickUp billing mirror, the daily billing snapshot and
-- the billing inbox, kept by Supabase instead of the paused Convex deployment.
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive, except section 4, which
-- takes the browser's direct write grants on the three billing tables away
-- (reads are unchanged).
--
-- Convex stopped on 2026-10-07 22:47 UTC. Until then billing.syncMirror and
-- billing.ingestInbox (apps/media-buyer-cockpit/convex/billing.ts) kept
-- cockpit_billing_accounts and cockpit_billing_inbox moving, and the CSM sync
-- kept the card billing fields that cockpit_client_billing_days was imported
-- from. Without them the CEO clients section, payer mapping, lifetime value
-- and the CSM billing projections all refuse to run on stale billing.
--
-- 1. cockpit_billing_sync_apply: what the billing-sync Edge Function writes,
--    in one transaction: the mirror rows (a row a person edited during the
--    run is skipped, never overwritten), today's billing snapshot per card,
--    and one audit row.
-- 2. cockpit_billing_ingest_inbox: Convex's ingestFromInbox, natively. Each
--    pending inbox payment becomes a cockpit_manual_payments row, a duplicate
--    or a refusal, with the same rules; a dry run returns the verdicts only.
-- 3. cockpit_billing_write: every billing change made in a cockpit (an edit,
--    a logged payment, money tied to a client) is checked here, on the
--    server, for a CSM, finance or CEO seat, and leaves an audit row.
-- 4. The browser loses its direct INSERT/UPDATE on the billing tables.
-- 5. pg_cron calls billing-sync. Why this schedule: ClickUp edits should
--    reach the sheet within half an hour while people work (06:00 to 22:00
--    Kuwait is 03:00 to 19:00 UTC), and one run just after Kuwait midnight
--    writes the new day's snapshot even if no daytime run succeeds. The
--    longest gap is under six hours, well inside the 24-hour freshness the
--    CEO refresh, payer mapping and lifetime value demand. About 35 runs a
--    day of four to six ClickUp reads each, far below ClickUp's 100 a minute.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. What the worker reads and writes as the service role
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON public.cockpit_sync_state TO service_role;
GRANT SELECT ON public.cockpit_billing_accounts, public.cockpit_billing_events, public.cockpit_billing_inbox TO service_role;

-- ---------------------------------------------------------------------------
-- Small helpers (owner only; the functions below call them)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cockpit_billing_day(p_text text)
RETURNS date LANGUAGE plpgsql STABLE SET search_path='' AS $$
BEGIN
  IF p_text IS NULL OR p_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN NULL; END IF;
  RETURN p_text::date;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

-- billingCore.amountProblem: dollars have cents, dinars have fils.
CREATE OR REPLACE FUNCTION public.cockpit_billing_amount_problem(p_amount numeric, p_currency text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE
    WHEN p_amount IS NULL OR p_amount <= 0 THEN 'The amount has to be above zero.'
    WHEN p_amount > 100000 THEN 'That is too large for one client payment; check the amount.'
    WHEN p_currency = 'USD' AND p_amount <> round(p_amount, 2) THEN 'A dollar amount has at most two decimals.'
    WHEN p_currency <> 'USD' AND p_amount <> round(p_amount, 3) THEN 'A dinar amount has at most three decimals.'
  END
$$;

REVOKE ALL ON FUNCTION public.cockpit_billing_day(text), public.cockpit_billing_amount_problem(numeric, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. The sync's writes
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cockpit_billing_sync_apply(p_accounts jsonb, p_days jsonb, p_run jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_item jsonb;
  v_row public.cockpit_billing_accounts;
  v_n integer;
  v_written integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_days integer := 0;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
BEGIN
  IF jsonb_typeof(p_accounts) IS DISTINCT FROM 'array' OR jsonb_typeof(p_days) IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_run) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'The billing sync payload must be two arrays and a run summary' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_days) x
             WHERE public.cockpit_billing_day(x->>'day') IS NULL
                OR public.cockpit_billing_day(x->>'day') NOT BETWEEN v_today - 1 AND v_today + 1) THEN
    RAISE EXCEPTION 'Billing snapshots are written for today only; no past day is rewritten' USING ERRCODE='22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('cockpit_billing_sync_apply'));

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_accounts) LOOP
    v_row := jsonb_populate_record(NULL::public.cockpit_billing_accounts, v_item->'row');
    IF v_row.clickup_task_id IS NULL OR v_row.clickup_task_id !~ '^[A-Za-z0-9_-]{1,40}$'
       OR coalesce(btrim(v_row.client_name), '') = ''
       OR v_row.stage_group IS NULL OR v_row.stage_group NOT IN ('active','paused','pipeline','sales','gone') THEN
      RAISE EXCEPTION 'A billing sync row has no card id, name or group' USING ERRCODE='22023';
    END IF;
    v_row.source := coalesce(v_row.source, 'sync');
    v_row.synced_at := coalesce(v_row.synced_at, now());
    -- Optimistic: a row whose synced_at moved since the sync read it was
    -- edited in a cockpit meanwhile, and that edit wins until the next run.
    INSERT INTO public.cockpit_billing_accounts AS t SELECT (v_row).*
    ON CONFLICT (clickup_task_id) DO UPDATE SET
      client_name = excluded.client_name, task_url = excluded.task_url, stage = excluded.stage,
      stage_group = excluded.stage_group, client_status = excluded.client_status,
      payment_method = excluded.payment_method, payment_plan = excluded.payment_plan, country = excluded.country,
      next_payment_usd = excluded.next_payment_usd, next_payment_date = excluded.next_payment_date,
      mrr_usd = excluded.mrr_usd, ltv_field_usd = excluded.ltv_field_usd, paused_on = excluded.paused_on,
      extension_weeks = excluded.extension_weeks, churn_date = excluded.churn_date, csm = excluded.csm,
      source = excluded.source, synced_at = excluded.synced_at
    WHERE t.synced_at IS NOT DISTINCT FROM (v_item->>'expected_synced_at')::timestamptz;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 1 THEN v_written := v_written + 1;
    ELSE v_skipped := v_skipped || to_jsonb(v_row.clickup_task_id);
    END IF;
  END LOOP;

  -- One row per card per Kuwait day; a later run that day refreshes it. A row
  -- imported from Convex (source_id set) is history and is never rewritten.
  INSERT INTO public.cockpit_client_billing_days AS t
  SELECT * FROM jsonb_populate_recordset(NULL::public.cockpit_client_billing_days, p_days)
  ON CONFLICT (day, clickup_task_id) DO UPDATE SET
    client_name = excluded.client_name, stage = excluded.stage, mrr_usd = excluded.mrr_usd,
    ltv_usd = excluded.ltv_usd, next_payment_usd = excluded.next_payment_usd,
    source_currency = excluded.source_currency, next_payment_date = excluded.next_payment_date,
    signup_date = excluded.signup_date, launch_date = excluded.launch_date, paused_on = excluded.paused_on,
    churn_date = excluded.churn_date, next_renewal_date = excluded.next_renewal_date,
    payment_plan = excluded.payment_plan, payment_method = excluded.payment_method,
    contract_status = excluded.contract_status, churn_reason = excluded.churn_reason,
    churn_type = excluded.churn_type, closer = excluded.closer, lead_source = excluded.lead_source,
    captured_at = excluded.captured_at, source_deployment = excluded.source_deployment
  WHERE t.source_id IS NULL;
  GET DIAGNOSTICS v_days = ROW_COUNT;

  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('billingSync.apply', 'cockpit_billing_accounts', NULL, 'billing-sync', 'billing-sync', 'supabase', NULL, p_run,
          jsonb_build_object('written', v_written, 'skipped', v_skipped, 'days', v_days));
  RETURN jsonb_build_object('written', v_written, 'skipped', v_skipped, 'days', v_days);
END $$;
COMMENT ON FUNCTION public.cockpit_billing_sync_apply(jsonb, jsonb, jsonb) IS
  'billing-sync only. Upserts the ClickUp billing mirror (skipping rows edited since the read), today''s cockpit_client_billing_days snapshot per card (never an imported Convex row), and one audit row per run.';

-- ---------------------------------------------------------------------------
-- 2. The billing inbox into the ledger (Convex ingestFromInbox)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cockpit_billing_ingest_inbox(p_apply boolean, p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  r public.cockpit_billing_inbox;
  v_twin public.cockpit_manual_payments;
  v_verdict text; v_note text; v_ledger text; v_fresh boolean;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_tap boolean; v_client text; v_key text; v_amount numeric; v_rate numeric; v_problem text; v_event bigint;
  v_rows jsonb := '[]'::jsonb; v_in integer := 0; v_dup integer := 0; v_rej integer := 0; v_wait integer := 0; v_pending integer;
BEGIN
  IF p_apply IS NULL THEN RAISE EXCEPTION 'Say whether to apply or only preview' USING ERRCODE='22023'; END IF;
  SELECT count(*) INTO v_pending FROM public.cockpit_billing_inbox WHERE status = 'pending';
  IF NOT coalesce((SELECT history_ready FROM public.cockpit_manual_payment_state WHERE id), false) THEN
    RETURN jsonb_build_object('ready', false, 'pending', v_pending,
      'note', 'The manual payment history is not reconciled, so inbox payments wait in the inbox.');
  END IF;
  v_tap := public.cockpit_manual_tap_status();
  FOR r IN SELECT * FROM public.cockpit_billing_inbox WHERE status = 'pending'
           ORDER BY logged_at, id LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
           FOR UPDATE SKIP LOCKED LOOP
    v_verdict := NULL; v_note := NULL; v_ledger := NULL; v_fresh := false; v_event := NULL;
    v_problem := public.cockpit_billing_amount_problem(r.amount, r.currency);
    IF r.paid_on > v_today OR r.paid_on < date '2025-01-01' THEN
      v_verdict := 'rejected'; v_note := format('The day %s is not a day money could have arrived.', r.paid_on);
    ELSIF v_problem IS NOT NULL THEN
      v_verdict := 'rejected'; v_note := v_problem;
    ELSIF r.method = 'tap' AND v_tap IS TRUE THEN
      v_verdict := 'rejected';
      v_note := 'Tap is connected, so a Tap payment arrives on the Tap rail by itself; logging it would count it twice.';
    ELSIF r.method = 'tap' AND v_tap IS NULL THEN
      v_note := 'Not taken in yet: the Tap connection state is unknown. It is tried again at the next run.';
    ELSIF NOT EXISTS (SELECT 1 FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = r.clickup_task_id)
      AND NOT EXISTS (SELECT 1 FROM public.cockpit_client_billing_days b WHERE b.clickup_task_id = r.clickup_task_id) THEN
      v_verdict := 'rejected'; v_note := 'That client card is not on the roster any more.';
    ELSE
      v_client := coalesce(public.cockpit_manual_clean_text(r.client_name, 120), r.clickup_task_id);
      v_amount := round(r.amount, 3);
      v_rate := CASE r.currency WHEN 'USD' THEN 1 ELSE 3.26 END;
      v_key := public.cockpit_manual_name_key(v_client);
      -- Already taken in by an earlier run that stopped before marking it.
      SELECT * INTO v_twin FROM public.cockpit_manual_payments p
       WHERE p.source_system = 'supabase' AND p.source_deployment = 'billing-inbox' AND p.source_id = r.id::text;
      IF FOUND THEN
        v_verdict := 'ingested'; v_ledger := v_twin.id; v_note := 'In the ledger.';
      ELSE
        SELECT * INTO v_twin FROM public.cockpit_manual_payments p
         WHERE p.deleted_at IS NULL AND p.day = r.paid_on AND p.currency = r.currency
           AND abs(p.amount - v_amount) < 0.0005
           AND ((v_key <> '' AND p.client_key = v_key) OR p.clickup_task_id = r.clickup_task_id)
         ORDER BY p.added_at, p.id LIMIT 1;
        IF FOUND THEN
          v_verdict := 'duplicate'; v_ledger := v_twin.id;
          v_note := format('%s from %s on %s was already in the ledger (%s), so this was not counted a second time.',
            '$' || to_char(v_twin.amount_usd, 'FM999,999,990.00') ||
              CASE WHEN v_twin.currency = 'USD' THEN ''
                   ELSE ' (' || regexp_replace(to_char(v_twin.amount, 'FM999,999,990.000'), '\.?0+$', '') || ' ' || v_twin.currency || ')' END,
            v_twin.client_name, r.paid_on,
            CASE v_twin.rail WHEN 'bank_transfer' THEN 'bank transfer' WHEN 'tap' THEN 'Tap' ELSE v_twin.rail END);
        ELSE
          v_verdict := 'ingested'; v_note := 'In the ledger.'; v_fresh := true;
          IF p_apply THEN
            INSERT INTO public.cockpit_manual_payments(day, amount, currency, amount_usd, usd_per_unit, client_name, client_key,
              clickup_task_id, rail, kind, note, added_by, source_system, source_deployment, source_id)
            VALUES (r.paid_on, v_amount, r.currency, round(v_amount * v_rate, 2), v_rate, v_client, v_key,
              r.clickup_task_id, r.method, 'payment',
              public.cockpit_manual_clean_text(concat_ws('; ', 'ref ' || r.reference, r.note, 'receipt ' || r.evidence_url), 500),
              r.source || ': ' || coalesce(public.cockpit_manual_clean_text(r.logged_by, 80), 'unknown'),
              'supabase', 'billing-inbox', r.id::text)
            RETURNING id INTO v_ledger;
          END IF;
        END IF;
      END IF;
    END IF;

    IF v_verdict IS NULL THEN v_wait := v_wait + 1;
    ELSIF v_verdict = 'ingested' THEN v_in := v_in + 1;
    ELSIF v_verdict = 'duplicate' THEN v_dup := v_dup + 1;
    ELSE v_rej := v_rej + 1;
    END IF;

    IF p_apply AND (v_verdict IS NOT NULL OR r.status_note IS DISTINCT FROM v_note) THEN
      IF v_verdict IS NULL THEN
        UPDATE public.cockpit_billing_inbox SET status_note = v_note WHERE id = r.id;
      ELSE
        UPDATE public.cockpit_billing_inbox
           SET status = v_verdict, ledger_id = v_ledger, status_note = v_note, settled_at = now()
         WHERE id = r.id;
        IF v_fresh THEN
          INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
          VALUES (r.clickup_task_id, r.client_name, 'payment', NULL, NULL, NULL,
            jsonb_build_object('amount', r.amount, 'currency', r.currency, 'day', r.paid_on, 'rail', r.method,
                               'reference', r.reference, 'inbox', r.id, 'ledgerId', v_ledger),
            CASE WHEN r.source = 'maher' THEN 'maher' ELSE 'csm' END, r.logged_by)
          RETURNING id INTO v_event;
        END IF;
      END IF;
      INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
      VALUES ('billingInbox.' || coalesce(v_verdict, 'waiting'), 'cockpit_billing_inbox', r.id::text, 'billing-sync', 'billing-sync',
              'supabase', to_jsonb(r), (SELECT to_jsonb(i) FROM public.cockpit_billing_inbox i WHERE i.id = r.id),
              jsonb_build_object('ledger_id', v_ledger, 'event_id', v_event));
    END IF;
    v_rows := v_rows || jsonb_build_object('id', r.id, 'verdict', coalesce(v_verdict, 'waiting'), 'note', v_note, 'ledgerId', v_ledger);
  END LOOP;
  RETURN jsonb_build_object('ready', true, 'pending', v_pending, 'ingested', v_in, 'duplicate', v_dup,
                            'rejected', v_rej, 'waiting', v_wait, 'rows', v_rows);
END $$;
COMMENT ON FUNCTION public.cockpit_billing_ingest_inbox(boolean, integer) IS
  'billing-sync only. Convex ingestFromInbox natively: each pending inbox payment becomes a cockpit_manual_payments row (source billing-inbox, so a retry cannot add it twice), a duplicate or a refusal, with an event and an audit row. p_apply=false returns the verdicts and writes nothing.';

REVOKE ALL ON FUNCTION public.cockpit_billing_sync_apply(jsonb, jsonb, jsonb), public.cockpit_billing_ingest_inbox(boolean, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_billing_sync_apply(jsonb, jsonb, jsonb), public.cockpit_billing_ingest_inbox(boolean, integer)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Billing changes from the cockpits
-- ---------------------------------------------------------------------------
-- The rules are billingCore.applyEdit's and the CSM logPayment's, so the
-- sentences match what the sheet has always said. Nothing here writes to
-- ClickUp: an edit lands on the mirror and in the log, and billing-sync keeps
-- it until the ClickUp card changes after it.
CREATE OR REPLACE FUNCTION public.cockpit_billing_write(p_action text, p_args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_who text;
  v_ceo boolean;
  v_source text;
  v_app text;
  v_task text;
  v_acc public.cockpit_billing_accounts;
  v_next public.cockpit_billing_accounts;
  v_edit jsonb;
  v_kind text;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_day date;
  v_value numeric;
  v_text text;
  v_weeks integer;
  v_moved boolean := false;
  v_from text; v_to text; v_reason text; v_detail jsonb;
  v_event bigint;
  v_inbox public.cockpit_billing_inbox;
  v_ledger text;
  v_amount numeric; v_currency text; v_rail text; v_evidence text; v_ref text; v_note text; v_next_day date;
  v_payer text; v_mapped jsonb; v_usd numeric; v_count integer; v_name text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in before changing billing.' USING ERRCODE='42501'; END IF;
  v_ceo := coalesce(public.cockpit_is_ceo(), false);
  IF NOT (v_ceo OR coalesce(public.cockpit_has_role('csm'), false) OR coalesce(public.cockpit_has_role('finance'), false)) THEN
    RAISE EXCEPTION 'Billing changes need a client success, finance or CEO seat. Ask an admin to add the role.' USING ERRCODE='42501';
  END IF;
  SELECT lower(btrim(au.email)) INTO v_who FROM auth.users au WHERE au.id = v_uid;
  IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' OR octet_length(p_args::text) > 20000 THEN
    RAISE EXCEPTION 'That billing change could not be read. Reload the page and try again.' USING ERRCODE='22023';
  END IF;
  v_source := coalesce(nullif(p_args->>'source', ''), CASE WHEN v_ceo THEN 'ceo' ELSE 'csm' END);
  IF v_source NOT IN ('ceo', 'csm') THEN RAISE EXCEPTION 'That billing change came from an unknown cockpit.' USING ERRCODE='22023'; END IF;
  IF v_source = 'ceo' AND NOT v_ceo THEN
    RAISE EXCEPTION '%', CASE WHEN p_action = 'assign' THEN 'Only the CEO can tie money to a client.'
                              ELSE 'Only the CEO can make a change from the CEO cockpit.' END USING ERRCODE='42501';
  END IF;
  v_app := CASE v_source WHEN 'ceo' THEN 'media-buyer-cockpit' ELSE 'client-success-cockpit' END;
  v_task := btrim(coalesce(p_args->>'taskId', ''));
  IF v_task !~ '^[A-Za-z0-9_-]{1,40}$' THEN RAISE EXCEPTION 'That is not a ClickUp card id.' USING ERRCODE='22023'; END IF;

  -- Money nobody had tied to a client: the payer mapping, then the log line.
  IF p_action = 'assign' THEN
    IF NOT v_ceo THEN RAISE EXCEPTION 'Only the CEO can tie money to a client.' USING ERRCODE='42501'; END IF;
    v_payer := btrim(coalesce(p_args->>'payer', ''));
    IF v_payer = '' OR length(v_payer) > 200 THEN RAISE EXCEPTION 'Choose a payer name up to 200 characters.' USING ERRCODE='22023'; END IF;
    -- payers.assign checks the card's billing is fresh, maps the payer, audits it and marks finance for a refresh.
    v_mapped := public.cockpit_ceo_action('payers.assign', jsonb_build_object('payer', v_payer, 'clickupTaskId', v_task));
    SELECT client_name INTO v_name FROM public.cockpit_billing_accounts WHERE clickup_task_id = v_task;
    v_name := coalesce(v_name, v_mapped->>'client', nullif(btrim(p_args->>'clientName'), ''), v_task);
    v_usd := CASE WHEN jsonb_typeof(p_args->'usd') = 'number' THEN round((p_args->>'usd')::numeric, 2) END;
    v_count := CASE WHEN jsonb_typeof(p_args->'count') = 'number' THEN floor((p_args->>'count')::numeric)::integer END;
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (v_task, v_name, 'assign', NULL, v_payer,
      CASE WHEN v_usd IS NOT NULL AND v_count IS NOT NULL THEN
        format('%s %s from %s, $%s, tied to %s. They count as %s''s money from the next refresh; LTV adds only those from 19 Sep on.',
          v_count, CASE WHEN v_count = 1 THEN 'payment' ELSE 'payments' END, v_payer,
          regexp_replace(to_char(v_usd, 'FM999,999,990.00'), '\.?0+$', ''), v_name, v_name)
      ELSE format('Payments from %s tied to %s. They count as %s''s money from the next refresh.', v_payer, v_name, v_name) END,
      jsonb_build_object('payer', v_payer, 'usd', v_usd, 'count', v_count), 'ceo', v_who)
    RETURNING id INTO v_event;
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('billing.assign', 'cockpit_billing_events', v_event::text, v_who, v_app, 'supabase', NULL,
            (SELECT to_jsonb(e) FROM public.cockpit_billing_events e WHERE e.id = v_event), jsonb_build_object('mapping', v_mapped));
    RETURN jsonb_build_object('ok', true, 'client', v_name, 'eventId', v_event);
  END IF;

  SELECT * INTO v_acc FROM public.cockpit_billing_accounts WHERE clickup_task_id = v_task FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That client card is not on the billing sheet. Refresh the page and pick it again.' USING ERRCODE='P0002';
  END IF;
  IF NOT v_ceo AND NOT coalesce(public.cockpit_client_allowed(v_acc.client_name), false) THEN
    RAISE EXCEPTION '% is not one of your clients in the portal, so its billing is not yours to change.', v_acc.client_name USING ERRCODE='42501';
  END IF;
  v_next := v_acc;

  IF p_action = 'edit' THEN
    v_edit := p_args->'edit';
    IF jsonb_typeof(v_edit) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Say what to change.' USING ERRCODE='22023'; END IF;
    v_kind := coalesce(v_edit->>'kind', '');
    CASE v_kind
    WHEN 'method' THEN
      IF coalesce(v_edit->>'value', '') NOT IN ('Card on file', 'Bank transfer', 'Tap link', 'Whop link', 'Check') THEN
        RAISE EXCEPTION 'Pick one of the payment methods on the card.' USING ERRCODE='22023';
      END IF;
      v_next.payment_method := v_edit->>'value'; v_from := v_acc.payment_method; v_to := v_edit->>'value';
    WHEN 'plan' THEN
      IF coalesce(v_edit->>'value', '') NOT IN ('Monthly', 'Split Pay (2x payments)', 'Paid in full (90 days)',
                                                 '1.0K Start / $2K Months After', 'Performance ($3k/$3k)') THEN
        RAISE EXCEPTION 'Pick one of the payment plans on the card.' USING ERRCODE='22023';
      END IF;
      v_next.payment_plan := v_edit->>'value'; v_from := v_acc.payment_plan; v_to := v_edit->>'value';
    WHEN 'amount' THEN
      IF jsonb_typeof(v_edit->'value') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'The amount has to be a real payment in dollars.' USING ERRCODE='22023';
      END IF;
      v_value := round((v_edit->>'value')::numeric, 2);
      IF NOT (v_value > 0) OR v_value > 100000 THEN
        RAISE EXCEPTION 'The amount has to be a real payment in dollars.' USING ERRCODE='22023';
      END IF;
      v_next.next_payment_usd := v_value; v_from := trim_scale(v_acc.next_payment_usd)::text; v_to := trim_scale(v_value)::text;
    WHEN 'date' THEN
      v_day := public.cockpit_billing_day(v_edit->>'value');
      IF v_day IS NULL THEN RAISE EXCEPTION 'That is not a date.' USING ERRCODE='22023'; END IF;
      IF v_day < v_today - 60 THEN
        RAISE EXCEPTION 'A payment date two months back is almost certainly a typo.' USING ERRCODE='22023';
      END IF;
      v_next.next_payment_date := v_day; v_from := v_acc.next_payment_date::text; v_to := v_day::text;
      v_reason := public.cockpit_manual_clean_text(v_edit->>'reason', 400);
    WHEN 'extension' THEN
      IF jsonb_typeof(v_edit->'weeks') IS DISTINCT FROM 'number' OR (v_edit->>'weeks') NOT IN ('1', '2', '4') THEN
        RAISE EXCEPTION 'An extension is one, two or four weeks, as on the extension form.' USING ERRCODE='22023';
      END IF;
      v_weeks := (v_edit->>'weeks')::integer;
      v_reason := public.cockpit_manual_clean_text(v_edit->>'reason', 400);
      IF coalesce(length(v_reason), 0) < 4 THEN RAISE EXCEPTION 'Say why, so the extension log reads back.' USING ERRCODE='22023'; END IF;
      v_next.extension_weeks := v_weeks;
      IF v_edit->'moveDate' = 'true'::jsonb THEN
        -- Cover runs from today or the date already set, whichever is later.
        v_next.next_payment_date := greatest(coalesce(v_acc.next_payment_date, v_today), v_today) + v_weeks * 7;
        v_moved := true;
      END IF;
      v_from := v_acc.next_payment_date::text; v_to := v_next.next_payment_date::text;
      v_detail := jsonb_build_object('weeks', v_weeks, 'ours', coalesce(v_edit->'ours' = 'true'::jsonb, false), 'movedDate', v_moved);
    WHEN 'pause' THEN
      v_reason := public.cockpit_manual_clean_text(v_edit->>'reason', 400);
      IF coalesce(length(v_reason), 0) < 4 THEN RAISE EXCEPTION 'Say why, so the pause reads back in a month.' USING ERRCODE='22023'; END IF;
      v_day := coalesce(public.cockpit_billing_day(v_edit->>'on'), v_today);
      v_next.client_status := 'Paused'; v_next.stage := 'Paused'; v_next.stage_group := 'paused'; v_next.paused_on := v_day;
      v_from := v_acc.client_status; v_to := 'Paused'; v_detail := jsonb_build_object('on', v_day);
    WHEN 'resume' THEN
      v_next.client_status := 'Active'; v_next.stage := 'Active'; v_next.stage_group := 'active'; v_next.paused_on := NULL;
      v_day := public.cockpit_billing_day(v_edit->>'nextDate');
      IF v_day IS NOT NULL THEN
        v_next.next_payment_date := v_day; v_detail := jsonb_build_object('nextDate', v_day);
      END IF;
      v_from := v_acc.client_status; v_to := 'Active';
    WHEN 'note' THEN
      v_reason := public.cockpit_manual_clean_text(v_edit->>'text', 1000);
      IF coalesce(length(v_reason), 0) < 2 THEN RAISE EXCEPTION 'Write the note first.' USING ERRCODE='22023'; END IF;
    ELSE
      RAISE EXCEPTION 'That is not a change the billing sheet makes.' USING ERRCODE='22023';
    END CASE;

    IF v_kind <> 'note' THEN
      UPDATE public.cockpit_billing_accounts SET
        stage = v_next.stage, stage_group = v_next.stage_group, client_status = v_next.client_status,
        payment_method = v_next.payment_method, payment_plan = v_next.payment_plan,
        next_payment_usd = v_next.next_payment_usd, next_payment_date = v_next.next_payment_date,
        paused_on = v_next.paused_on, extension_weeks = v_next.extension_weeks,
        source = v_source, synced_at = now()
      WHERE clickup_task_id = v_task
      RETURNING * INTO v_next;
    END IF;
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (v_task, v_acc.client_name, v_kind, v_from, v_to, v_reason, v_detail, v_source, v_who)
    RETURNING id INTO v_event;
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('billing.' || v_kind, 'cockpit_billing_accounts', v_task, v_who, v_app, 'supabase', to_jsonb(v_acc), to_jsonb(v_next),
            jsonb_build_object('event_id', v_event));
    RETURN to_jsonb(v_next);
  END IF;

  IF p_action = 'payment' THEN
    v_day := public.cockpit_billing_day(p_args->>'day');
    IF v_day IS NULL OR v_day > v_today OR v_day < date '2025-01-01' THEN
      RAISE EXCEPTION 'Pick the day the money arrived, today or before.' USING ERRCODE='22023';
    END IF;
    IF jsonb_typeof(p_args->'amount') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Type the amount as a number.' USING ERRCODE='22023'; END IF;
    v_amount := (p_args->>'amount')::numeric;
    v_currency := p_args->>'currency';
    IF v_currency IS NULL OR v_currency NOT IN ('USD', 'KWD') THEN RAISE EXCEPTION 'Pick dollars or dinars.' USING ERRCODE='22023'; END IF;
    v_text := public.cockpit_billing_amount_problem(v_amount, v_currency);
    IF v_text IS NOT NULL THEN RAISE EXCEPTION '%', v_text USING ERRCODE='22023'; END IF;
    v_rail := p_args->>'rail';
    IF v_rail IS NULL OR v_rail NOT IN ('bank_transfer', 'cheque', 'cash', 'tap', 'other') THEN
      RAISE EXCEPTION 'Pick how the money came.' USING ERRCODE='22023';
    END IF;
    v_evidence := nullif(btrim(coalesce(p_args->>'evidenceUrl', '')), '');
    IF v_evidence IS NOT NULL AND v_evidence !~ '^https?://[^[:space:]]+$' THEN
      RAISE EXCEPTION 'The receipt has to be a link that opens, starting https://.' USING ERRCODE='22023';
    END IF;
    v_ref := public.cockpit_manual_clean_text(p_args->>'reference', 120);
    v_note := public.cockpit_manual_clean_text(p_args->>'note', 500);
    IF nullif(p_args->>'nextDate', '') IS NOT NULL THEN
      v_next_day := public.cockpit_billing_day(p_args->>'nextDate');
      IF v_next_day IS NULL OR v_next_day <= v_day THEN
        RAISE EXCEPTION 'Their next payment has to be after this one.' USING ERRCODE='22023';
      END IF;
      IF v_next_day < v_today - 60 THEN
        RAISE EXCEPTION 'A payment date two months back is almost certainly a typo.' USING ERRCODE='22023';
      END IF;
    END IF;

    IF v_source = 'csm' THEN
      -- The SOP: a bank transfer without its receipt photo counts as unpaid.
      IF v_rail = 'bank_transfer' AND v_evidence IS NULL THEN
        RAISE EXCEPTION 'Add the link to the transfer''s receipt photo first. A bank transfer without its photo counts as unpaid.' USING ERRCODE='22023';
      END IF;
      INSERT INTO public.cockpit_billing_inbox(clickup_task_id, client_name, paid_on, amount, currency, method, reference,
                                               evidence_url, note, source, logged_by)
      VALUES (v_task, v_acc.client_name, v_day, round(v_amount, 3), v_currency, v_rail, v_ref, v_evidence, v_note, 'csm', v_who)
      RETURNING * INTO v_inbox;
      INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
      VALUES ('billing.payment', 'cockpit_billing_inbox', v_inbox.id::text, v_who, v_app, 'supabase', NULL, to_jsonb(v_inbox), '{}'::jsonb);
      IF v_next_day IS NOT NULL AND v_next_day IS DISTINCT FROM v_acc.next_payment_date THEN
        UPDATE public.cockpit_billing_accounts SET next_payment_date = v_next_day, source = 'csm', synced_at = now()
         WHERE clickup_task_id = v_task RETURNING * INTO v_next;
        INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
        VALUES (v_task, v_acc.client_name, 'date', v_acc.next_payment_date::text, v_next_day::text, 'Paid; next payment set',
                jsonb_build_object('inbox', v_inbox.id), 'csm', v_who)
        RETURNING id INTO v_event;
        INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
        VALUES ('billing.date', 'cockpit_billing_accounts', v_task, v_who, v_app, 'supabase', to_jsonb(v_acc), to_jsonb(v_next),
                jsonb_build_object('event_id', v_event, 'inbox', v_inbox.id));
        v_moved := true;
      END IF;
      RETURN jsonb_build_object('route', 'inbox', 'id', v_inbox.id, 'moved', v_moved,
                                'nextDate', v_next.next_payment_date, 'account', to_jsonb(v_next));
    END IF;

    -- The CEO cockpit logs straight into the ledger the Money tab reads, with
    -- its duplicate check, Tap guard and history gate (Convex manualPayments.add).
    v_ledger := public.cockpit_ceo_manual_payment_add(
      jsonb_build_object('day', v_day::text, 'amount', p_args->'amount', 'currency', v_currency, 'rail', v_rail,
        'clientName', v_acc.client_name, 'clickupTaskId', v_task,
        'note', nullif(concat_ws('; ', 'ref ' || v_ref, v_note, 'receipt ' || v_evidence), ''),
        'allowRepeat', coalesce(p_args->'allowRepeat' = 'true'::jsonb, false)),
      gen_random_uuid());
    IF v_next_day IS NOT NULL AND v_next_day IS DISTINCT FROM v_acc.next_payment_date THEN
      UPDATE public.cockpit_billing_accounts SET next_payment_date = v_next_day, source = 'ceo', synced_at = now()
       WHERE clickup_task_id = v_task RETURNING * INTO v_next;
      v_moved := true;
    END IF;
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (v_task, v_acc.client_name, 'payment', v_acc.next_payment_date::text, v_next.next_payment_date::text, NULL,
            jsonb_build_object('amount', p_args->'amount', 'currency', v_currency, 'day', v_day, 'rail', v_rail,
                               'reference', v_ref, 'ledgerId', v_ledger),
            'ceo', v_who)
    RETURNING id INTO v_event;
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('billing.payment', 'cockpit_billing_accounts', v_task, v_who, v_app, 'supabase', to_jsonb(v_acc), to_jsonb(v_next),
            jsonb_build_object('event_id', v_event, 'ledger_id', v_ledger));
    RETURN jsonb_build_object('route', 'ledger', 'id', v_ledger, 'moved', v_moved,
                              'nextDate', v_next.next_payment_date, 'account', to_jsonb(v_next));
  END IF;

  RAISE EXCEPTION 'That is not a billing action.' USING ERRCODE='22023';
END $$;
COMMENT ON FUNCTION public.cockpit_billing_write(text, jsonb) IS
  'Every billing change from a cockpit: edit, payment, assign. CSM, finance or CEO seat; a CSM only on their portal clients; CEO-only for the CEO cockpit and for tying a payer. Each write leaves a cockpit_billing_events row and a cockpit_audit_log row. Writes nothing to ClickUp.';

REVOKE ALL ON FUNCTION public.cockpit_billing_write(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_billing_write(text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. The browser writes only through cockpit_billing_write. This step moved to
--    20261009h_billing_browser_writes_closed.sql so it lands with the cockpit
--    release that calls cockpit_billing_write (the live frontends still write
--    the tables directly until then).
-- ---------------------------------------------------------------------------
-- 5. The schedule (the reason is in the header)
-- ---------------------------------------------------------------------------
-- cron:begin
SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname IN ('mahara-billing-sync', 'mahara-billing-sync-overnight');
SELECT cron.schedule('mahara-billing-sync', '7,37 3-18 * * *', $job$ select net.http_post(url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/billing-sync', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cockpit_sync_secret')), body := '{}'::jsonb, timeout_milliseconds := 150000); $job$);
SELECT cron.schedule('mahara-billing-sync-overnight', '17 21 * * *', $job$ select net.http_post(url := 'https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/billing-sync', headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='cockpit_sync_secret')), body := '{}'::jsonb, timeout_milliseconds := 150000); $job$);
-- cron:end

NOTIFY pgrst, 'reload schema';
COMMIT;
