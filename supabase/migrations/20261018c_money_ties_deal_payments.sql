-- Money ties and the deal ledger: who incoming money is credited to, and why
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Contract: docs/money/MONEY-ATTRIBUTION.md
-- section 3 (the CEO, 2026-10-18: "make it easy for me to attribute any of the
-- money coming in"). House style as docs/pay/PAY-PLANS.md section 5: written to
-- be applied once safely and to survive a second run (tables and indexes IF NOT
-- EXISTS, functions CREATE OR REPLACE, triggers dropped and created again),
-- SECURITY DEFINER with search_path '', and it loads in PGlite.
--
-- What it adds:
--   cockpit_payment_ties    the CEO's ties: one payment, every payment from a
--                           payer email, or every payment from a full payer
--                           name, to a signed deal, a client card, or "not
--                           client money". Append-only: a tie is removed
--                           (cleared_* set once), never edited or deleted.
--   cockpit_deal_payments   the deal ledger: every payment the money refresh
--                           credits to a deal's closer (deposit or remainder),
--                           rewritten each refresh like cockpit_client_payments.
--                           Read by the closer's pay (PAY-PLANS.md 4.4) and the
--                           Sales tab's front-end cash.
--   cockpit_ceo_payment_tie(jsonb), cockpit_ceo_payment_untie(jsonb)
--                           CEO RPCs. Each bumps cockpit_manual_payment_state
--                           .revision, so a refresh already running fails its
--                           fence and the next one reads the tie.
--
-- What it changes, each from its live definition read on 2026-10-18 (the
-- changed lines carry a "money ties" comment, nothing else moves):
--   cockpit_ceo_refresh_finance_snapshot()           gains the 'ties' key.
--   cockpit_finish_finance_refresh(uuid,jsonb,text)  writes 'dealPayments' when
--                           the output carries it, in the same transaction as
--                           cockpit_client_payments; without it the ledger is
--                           left alone.
--
-- Apply before any native release that reads 'ties': the native rowsFor()
-- throws on a missing snapshot key. No audit row carries an amount, a note, a
-- payer email or a payer name: ids only.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Tables

CREATE TABLE IF NOT EXISTS public.cockpit_payment_ties (
  id               bigserial PRIMARY KEY,
  /** Scope, exactly one: a single payment, as the money section ids it ... */
  payment_id       text CHECK (payment_id ~ '^(whop|tap|transfer|bank|manual):[A-Za-z0-9_.-]+$'),
  /** ... every payment from this payer email (stored lower-cased, trimmed) ... */
  payer_email      text,
  /** ... or every payment from this payer name: lower-cased, letters and digits only. */
  payer_key        text,
  /** Target, exactly one: a signed closer-form deal (B2B response_id) ... */
  deal_response_id text,
  /** ... a client card (ClickUp task id) ... */
  clickup_task_id  text,
  /** ... or money that is not a client's. */
  not_client       boolean NOT NULL DEFAULT false,
  note             text NOT NULL CHECK (length(btrim(note)) BETWEEN 3 AND 500),
  evidence         text,
  set_by           text NOT NULL,
  set_at           timestamptz NOT NULL DEFAULT now(),
  cleared_by       text,
  cleared_at       timestamptz,
  cleared_reason   text,
  CONSTRAINT cockpit_payment_ties_one_scope CHECK (num_nonnulls(payment_id, payer_email, payer_key) = 1),
  CONSTRAINT cockpit_payment_ties_one_target CHECK (num_nonnulls(deal_response_id, clickup_task_id) + (CASE WHEN not_client THEN 1 ELSE 0 END) = 1),
  CONSTRAINT cockpit_payment_ties_cleared_pair CHECK ((cleared_at IS NULL) = (cleared_by IS NULL))
);
COMMENT ON TABLE public.cockpit_payment_ties IS
  'The CEO''s money ties (2026-10-18): a payment, a payer email or a full payer name tied to a signed deal, a client card or "not client money". Read by both money writers through the finance snapshot before any automatic match. Append-only: removing a tie sets cleared_* once.';
-- One live tie per scope.
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_payment_ties_live_payment
  ON public.cockpit_payment_ties (payment_id) WHERE cleared_at IS NULL AND payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_payment_ties_live_email
  ON public.cockpit_payment_ties (lower(btrim(payer_email))) WHERE cleared_at IS NULL AND payer_email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_payment_ties_live_payer
  ON public.cockpit_payment_ties (payer_key) WHERE cleared_at IS NULL AND payer_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.cockpit_deal_payments (
  payment_id        text PRIMARY KEY,
  deal_response_id  text NOT NULL,
  /** The payment's day (Kuwait), as the money section dates it. */
  day               date NOT NULL,
  usd               numeric NOT NULL,
  rail              text NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('deposit','remainder')),
  /** The part of the payment up to the deal's typed deposit (the rest is the remainder); 0 on a remainder. */
  deposit_usd       numeric NOT NULL DEFAULT 0 CHECK (deposit_usd >= 0 AND deposit_usd <= usd),
  /** How the payment found the deal: Whop's link, payer email, card, the CEO's tie ... */
  matched_by        text NOT NULL,
  /** The cockpit_payment_ties row it rests on, when it rests on one. */
  tie_id            bigint,
  payer             text,
  active            boolean NOT NULL DEFAULT true,
  source_refresh_id uuid,
  recorded_at       timestamptz NOT NULL DEFAULT now()
);
-- A ledger created by an earlier draft of this file gains the deposit part (safe twice).
ALTER TABLE public.cockpit_deal_payments ADD COLUMN IF NOT EXISTS deposit_usd numeric NOT NULL DEFAULT 0;
COMMENT ON TABLE public.cockpit_deal_payments IS
  'The deal ledger: every payment the money refresh credits to a signed deal''s closer as front-end money (deposit up to the typed deposit, deposit_usd, then remainder up to the contract, within 120 days). Rewritten by cockpit_finish_finance_refresh from dealPayments: the last 11 months are set inactive, then upserted.';
CREATE INDEX IF NOT EXISTS cockpit_deal_payments_day_idx ON public.cockpit_deal_payments (day) WHERE active;
CREATE INDEX IF NOT EXISTS cockpit_deal_payments_deal_idx ON public.cockpit_deal_payments (deal_response_id) WHERE active;

-- Row security on, no policy, every grant revoked, then read for the service path only.
ALTER TABLE public.cockpit_payment_ties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_deal_payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_payment_ties, public.cockpit_deal_payments FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cockpit_payment_ties, public.cockpit_deal_payments TO service_role;
REVOKE ALL ON SEQUENCE public.cockpit_payment_ties_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Guards: a tie is never deleted, truncated or edited; removing it sets cleared_* once

CREATE OR REPLACE FUNCTION public.cockpit_payment_ties_lock()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF OLD.cleared_at IS NOT NULL THEN
    RAISE EXCEPTION 'A removed tie is kept as it was: tie the payment again instead' USING ERRCODE='42501';
  END IF;
  IF (pg_catalog.to_jsonb(NEW) - ARRAY['cleared_by','cleared_at','cleared_reason'])
       IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) - ARRAY['cleared_by','cleared_at','cleared_reason'])
     OR NEW.cleared_at IS NULL OR NEW.cleared_by IS NULL THEN
    RAISE EXCEPTION 'A tie is never edited: remove it and tie again' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cockpit_payment_ties_guard_delete ON public.cockpit_payment_ties;
CREATE TRIGGER cockpit_payment_ties_guard_delete BEFORE DELETE ON public.cockpit_payment_ties
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_hours_refuse_delete();
DROP TRIGGER IF EXISTS cockpit_payment_ties_guard_truncate ON public.cockpit_payment_ties;
CREATE TRIGGER cockpit_payment_ties_guard_truncate BEFORE TRUNCATE ON public.cockpit_payment_ties
  FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_hours_refuse_delete();
DROP TRIGGER IF EXISTS cockpit_payment_ties_lock ON public.cockpit_payment_ties;
CREATE TRIGGER cockpit_payment_ties_lock BEFORE UPDATE ON public.cockpit_payment_ties
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_payment_ties_lock();

-- ---------------------------------------------------------------------------
-- 3. CEO RPCs

/**
 * Tie money: {paymentId?|payerEmail?|payerKey?, dealResponseId?|clickupTaskId?|notClient?, note, evidence?}.
 * payerKey is the payer's full name as the payment shows it; the stored key is
 * lower-cased with everything but letters and digits stripped (as payers.assign).
 * Replaces the live tie of the same scope. Returns {ok, id}.
 */
CREATE OR REPLACE FUNCTION public.cockpit_ceo_payment_tie(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); k text;
  v_payment text; v_email text; v_name text; v_key text; v_deal text; v_card text; v_not_client boolean;
  v_note text; v_evidence text; v_scope text; v_target text; d public.cockpit_sales_deals; v_old bigint; v_id bigint; n integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_payment_ties',0));
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'A tie must be an object' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p) LOOP
    IF k<>ALL(ARRAY['paymentId','payerEmail','payerKey','dealResponseId','clickupTaskId','notClient','note','evidence']) THEN
      RAISE EXCEPTION 'Unsupported field: %',k USING ERRCODE='22023';
    END IF;
    IF k='notClient' AND jsonb_typeof(p->k) NOT IN ('boolean','null') THEN
      RAISE EXCEPTION 'notClient is true or false' USING ERRCODE='22023';
    ELSIF k<>'notClient' AND jsonb_typeof(p->k) NOT IN ('string','null') THEN
      RAISE EXCEPTION '% must be text',k USING ERRCODE='22023';
    END IF;
  END LOOP;
  v_payment:=nullif(btrim(p->>'paymentId'),'');
  v_email:=lower(nullif(btrim(p->>'payerEmail'),''));
  v_name:=nullif(btrim(p->>'payerKey'),'');
  v_deal:=nullif(btrim(p->>'dealResponseId'),'');
  v_card:=nullif(btrim(p->>'clickupTaskId'),'');
  v_not_client:=coalesce((p->>'notClient')::boolean,false);
  v_note:=btrim(coalesce(p->>'note',''));
  v_evidence:=nullif(btrim(p->>'evidence'),'');

  IF num_nonnulls(v_payment,v_email,v_name)<>1 THEN
    RAISE EXCEPTION 'Tie one payment, one payer email or one payer name' USING ERRCODE='22023';
  END IF;
  IF num_nonnulls(v_deal,v_card)+(CASE WHEN v_not_client THEN 1 ELSE 0 END)<>1 THEN
    RAISE EXCEPTION 'Choose one: a signed deal, a client card or not client money' USING ERRCODE='22023';
  END IF;
  IF length(v_note) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Say why in a note of 3 to 500 characters' USING ERRCODE='22023'; END IF;
  IF length(v_evidence)>1000 THEN RAISE EXCEPTION 'Keep the evidence under 1,000 characters' USING ERRCODE='22023'; END IF;

  -- The scope.
  IF v_payment IS NOT NULL THEN
    v_scope:='payment';
    IF length(v_payment)>200 OR v_payment !~ '^(whop|tap|transfer|bank|manual):[A-Za-z0-9_.-]+$' THEN
      RAISE EXCEPTION 'That is not a payment id from the Transactions tab' USING ERRCODE='22023';
    END IF;
    -- In the last published money transactions (money in), or in a source table Triage holds.
    IF NOT EXISTS(SELECT 1 FROM public.cockpit_sections s
          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.payload#>'{attribution,transactions}')='array'
            THEN s.payload#>'{attribution,transactions}' ELSE '[]'::jsonb END) t
          WHERE s.key='money' AND t->>'id'=v_payment AND t->>'direction'='in')
      AND NOT (v_payment LIKE 'tap:%' AND EXISTS(SELECT 1 FROM public.cockpit_tap_charges c
          WHERE c.id=substr(v_payment,5) AND c.live AND c.status='CAPTURED'))
      AND NOT (v_payment LIKE 'bank:%' AND EXISTS(SELECT 1 FROM public.cockpit_bank_lines l
          WHERE l.id::text=substr(v_payment,6) AND l.usd>0))
      AND NOT (v_payment LIKE 'manual:%' AND EXISTS(SELECT 1 FROM public.cockpit_manual_payments m
          WHERE m.id=substr(v_payment,8) AND m.deleted_at IS NULL AND m.kind<>'refund')) THEN
      RAISE EXCEPTION 'That payment is not in the ledger yet; refresh Money first.' USING ERRCODE='22023';
    END IF;
  ELSIF v_email IS NOT NULL THEN
    v_scope:='payerEmail';
    IF length(v_email)>320 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' THEN
      RAISE EXCEPTION 'That is not an email address' USING ERRCODE='22023';
    END IF;
  ELSE
    v_scope:='payerKey';
    v_key:=regexp_replace(lower(v_name),'[^[:alnum:]]','','g');
    -- Never a first name alone (the "Dena" lesson): six letters or more, two words or more.
    IF length(v_name)>200 OR length(v_key)<6 OR v_name !~ '[^[:space:]][[:space:]]+[^[:space:]]' THEN
      RAISE EXCEPTION 'Tie by email or the full payer name.' USING ERRCODE='22023';
    END IF;
  END IF;

  -- The target.
  IF v_deal IS NOT NULL THEN
    v_target:='deal';
    SELECT * INTO d FROM public.cockpit_sales_deals WHERE response_id=v_deal;
    IF d.response_id IS NULL OR d.submitted_at IS NULL THEN
      RAISE EXCEPTION 'That deal is not a signed closer-form deal. Choose one from the list.' USING ERRCODE='22023';
    END IF;
    IF d.voided THEN RAISE EXCEPTION 'That deal was voided. Choose a signed deal.' USING ERRCODE='22023'; END IF;
  ELSIF v_card IS NOT NULL THEN
    v_target:='card';
    IF NOT EXISTS(SELECT 1 FROM public.cockpit_client_billing_days b WHERE b.clickup_task_id=v_card)
      AND NOT EXISTS(SELECT 1 FROM public.cockpit_finance_client_aliases a WHERE a.task_id=v_card) THEN
      RAISE EXCEPTION 'That client card is unknown. Choose a card from the list.' USING ERRCODE='22023';
    END IF;
  ELSE
    v_target:='notClient';
  END IF;

  UPDATE public.cockpit_payment_ties t SET cleared_by=v_actor,cleared_at=now(),cleared_reason='Replaced by a new tie'
    WHERE t.cleared_at IS NULL
      AND ((v_payment IS NOT NULL AND t.payment_id=v_payment)
        OR (v_email IS NOT NULL AND lower(btrim(t.payer_email))=v_email)
        OR (v_key IS NOT NULL AND t.payer_key=v_key))
    RETURNING t.id INTO v_old;
  INSERT INTO public.cockpit_payment_ties(payment_id,payer_email,payer_key,deal_response_id,clickup_task_id,not_client,note,evidence,set_by)
    VALUES(v_payment,v_email,v_key,v_deal,v_card,v_not_client,v_note,v_evidence,v_actor)
    RETURNING id INTO v_id;
  -- The fence: a refresh already running fails at its finish; the next one reads the tie.
  UPDATE public.cockpit_manual_payment_state SET revision=revision+1,updated_at=now() WHERE id;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'The finance source state is missing; nothing was tied'; END IF;
  PERFORM public.cockpit_hours_audit('money.tie','cockpit_payment_ties',v_id::text,
    jsonb_strip_nulls(jsonb_build_object('id',v_id,'replaced',v_old,'scope',v_scope,'paymentId',v_payment,
      'target',v_target,'dealResponseId',v_deal,'clickupTaskId',v_card)),v_actor);
  RETURN jsonb_build_object('ok',true,'id',v_id);
END;
$$;

/** Remove a tie: {id, reason}. Returns {ok, id}. */
CREATE OR REPLACE FUNCTION public.cockpit_ceo_payment_untie(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); k text; v_id bigint; v_reason text; t public.cockpit_payment_ties; n integer;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_payment_ties',0));
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Removing a tie needs an object' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p) LOOP
    IF k<>ALL(ARRAY['id','reason']) THEN RAISE EXCEPTION 'Unsupported field: %',k USING ERRCODE='22023'; END IF;
  END LOOP;
  IF coalesce(jsonb_typeof(p->'id'),'') NOT IN ('number','string') OR coalesce(p->>'id','') !~ '^[0-9]{1,18}$' THEN
    RAISE EXCEPTION 'Choose a tie to remove' USING ERRCODE='22023';
  END IF;
  v_id:=(p->>'id')::bigint;
  IF p ? 'reason' AND jsonb_typeof(p->'reason') NOT IN ('string','null') THEN RAISE EXCEPTION 'reason must be text' USING ERRCODE='22023'; END IF;
  v_reason:=btrim(coalesce(p->>'reason',''));
  IF length(v_reason) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'Say why the tie goes, in 3 to 500 characters' USING ERRCODE='22023'; END IF;
  SELECT * INTO t FROM public.cockpit_payment_ties WHERE id=v_id FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'That tie does not exist' USING ERRCODE='22023'; END IF;
  IF t.cleared_at IS NOT NULL THEN RAISE EXCEPTION 'That tie is already removed' USING ERRCODE='22023'; END IF;
  UPDATE public.cockpit_payment_ties SET cleared_by=v_actor,cleared_at=now(),cleared_reason=v_reason WHERE id=v_id;
  UPDATE public.cockpit_manual_payment_state SET revision=revision+1,updated_at=now() WHERE id;
  GET DIAGNOSTICS n=ROW_COUNT;
  IF n<>1 THEN RAISE EXCEPTION 'The finance source state is missing; the tie stays'; END IF;
  PERFORM public.cockpit_hours_audit('money.untie','cockpit_payment_ties',v_id::text,jsonb_build_object('id',v_id),v_actor);
  RETURN jsonb_build_object('ok',true,'id',v_id);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. The finance snapshot: live definition (2026-10-18) + the 'ties' key

CREATE OR REPLACE FUNCTION public.cockpit_ceo_refresh_finance_snapshot()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT jsonb_build_object(
    'revision',coalesce((SELECT revision FROM public.cockpit_manual_payment_state WHERE id=true),0),
    'totals_revision',coalesce((SELECT totals_revision FROM public.cockpit_manual_payment_state WHERE id=true),0),
    'history_ready',coalesce((SELECT history_ready FROM public.cockpit_manual_payment_state WHERE id=true),false),
    'updated_at',(SELECT updated_at FROM public.cockpit_manual_payment_state WHERE id=true),
    'aliases_ready',coalesce((SELECT aliases_ready FROM public.cockpit_finance_source_state WHERE id=true),false),
    'manual_ready',coalesce((SELECT manual_ready FROM public.cockpit_finance_source_state WHERE id=true),false),
    'manual',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.day,p.added_at,p.id) FROM public.cockpit_manual_payments p),'[]'::jsonb),
    'aliases',coalesce((SELECT jsonb_agg(to_jsonb(a)-'source_record' ORDER BY a.source_kind,a.source_id) FROM public.cockpit_finance_client_aliases a),'[]'::jsonb),
    'billing',coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.clickup_task_id) FROM (SELECT DISTINCT ON(clickup_task_id) * FROM public.cockpit_client_billing_days ORDER BY clickup_task_id,day DESC) b),'[]'::jsonb),
    'series',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.day) FROM public.cockpit_metric_days m WHERE m.metric IN ('money.book.projected','money.book.collected') AND m.day>=(date_trunc('month',now() AT TIME ZONE 'Asia/Kuwait')::date-interval '11 months')),'[]'::jsonb),
    'statements',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.to_day DESC NULLS LAST,s.imported_at DESC) FROM (SELECT * FROM public.cockpit_statements ORDER BY to_day DESC NULLS LAST,imported_at DESC LIMIT 36) s),'[]'::jsonb),
    'bank_lines',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.day,l.id) FROM public.cockpit_bank_lines l WHERE l.day>=(date_trunc('month',now() AT TIME ZONE 'Asia/Kuwait')::date-interval '11 months')),'[]'::jsonb),
    'exclusions',coalesce((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.id) FROM public.cockpit_expense_exclusions e WHERE e.removed_at IS NULL),'[]'::jsonb),
    'payers',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.payer_key) FROM public.cockpit_payer_clients p WHERE p.cleared_at IS NULL),'[]'::jsonb),
    'newestManualChange',(SELECT max(created_at) FROM public.cockpit_audit_log WHERE entity_type='cockpit_manual_payments'), -- money ties: comma added
    'ties',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.id) FROM public.cockpit_payment_ties t WHERE t.cleared_at IS NULL),'[]'::jsonb) -- money ties: the CEO's live ties
  )
$function$;

-- ---------------------------------------------------------------------------
-- 5. Finishing a finance refresh: live definition (2026-10-18) + the deal ledger

CREATE OR REPLACE FUNCTION public.cockpit_finish_finance_refresh(p_id uuid, p_output jsonb DEFAULT NULL::jsonb, p_error text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE job cockpit_finance_refreshes; rev bigint; section jsonb; point jsonb; row_data jsonb; previous jsonb; section_count integer; since_day date;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('cockpit_finance_refresh'));
 SELECT * INTO job FROM cockpit_finance_refreshes WHERE id=p_id FOR UPDATE;
 IF job.id IS NULL THEN RAISE EXCEPTION 'Finance refresh not found'; END IF;
 IF job.status='confirmed' THEN RETURN job.result; END IF;
 IF job.status<>'running' THEN RAISE EXCEPTION 'Finance refresh is no longer running'; END IF;
 IF p_error IS NOT NULL THEN
  UPDATE cockpit_finance_refreshes SET status='failed',error=left(p_error,2000),finished_at=now() WHERE id=p_id;
  INSERT INTO cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,metadata) VALUES('finance.failed','cockpit_finance_refreshes',p_id::text,job.actor_email,'media-buyer-cockpit','supabase',jsonb_build_object('error',left(p_error,2000)));
  RETURN jsonb_build_object('ok',false,'error',left(p_error,2000));
 END IF;
 PERFORM cockpit_finance_refresh_input(p_id); -- Re-check founder and source import readiness at the write boundary.
 SELECT revision INTO rev FROM cockpit_manual_payment_state WHERE id FOR UPDATE;
 IF rev<>job.revision THEN RAISE EXCEPTION 'Finance inputs changed during this refresh; run it again'; END IF;
 IF job.created_at<now()-interval '5 minutes' THEN RAISE EXCEPTION 'Finance refresh expired'; END IF;
 IF jsonb_typeof(p_output->'sections') IS DISTINCT FROM 'array' OR jsonb_array_length(p_output->'sections')<>2 OR jsonb_typeof(p_output->'payments') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Incomplete finance output'; END IF;
 SELECT count(DISTINCT s->>'key') INTO section_count FROM jsonb_array_elements(p_output->'sections') s WHERE s->>'key' IN ('money','expenses');
 IF section_count<>2 THEN RAISE EXCEPTION 'Money and expenses must commit together'; END IF;
 FOR section IN SELECT * FROM jsonb_array_elements(p_output->'sections') LOOP
  IF jsonb_typeof(section->'payload') IS DISTINCT FROM 'object' OR jsonb_typeof(section->'sources') IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(section->'sources') s WHERE (s->>'ok')::boolean IS NOT TRUE) THEN RAISE EXCEPTION 'Unconfirmed finance source'; END IF;
  IF section->>'key'='money' AND (jsonb_typeof(section#>'{payload,attribution,transactions}') IS DISTINCT FROM 'array' OR section#>'{payload,rails,manual}' IS NULL) THEN RAISE EXCEPTION 'Attribution or manual source missing'; END IF;
  SELECT to_jsonb(s) INTO previous FROM cockpit_sections s WHERE key=section->>'key';
  INSERT INTO cockpit_sections(key,label,ok,error,computed_at,payload,sources) VALUES(section->>'key',section->>'label',true,NULL,now(),section->'payload',section->'sources')
   ON CONFLICT(key) DO UPDATE SET label=excluded.label,ok=true,error=NULL,computed_at=now(),payload=excluded.payload,sources=excluded.sources,updated_at=now();
  INSERT INTO cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after,metadata) VALUES('finance.refreshed','cockpit_sections',section->>'key',job.actor_email,'media-buyer-cockpit','supabase',previous,section,jsonb_build_object('refreshId',p_id,'revision',rev));
  FOR point IN SELECT * FROM jsonb_array_elements(coalesce(section->'daily','[]'::jsonb)) LOOP
   IF point->>'metric' !~ '^(money|expenses)[.]' OR jsonb_typeof(point->'value') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Invalid finance history point'; END IF;
   INSERT INTO cockpit_metric_days(day,metric,scope,value) VALUES((point->>'date')::date,point->>'metric',point->>'scope',(point->>'value')::double precision)
    ON CONFLICT(day,metric,scope) DO UPDATE SET value=excluded.value,captured_at=now();
  END LOOP;
 END LOOP;
 since_day:=date_trunc('month',now() AT TIME ZONE 'Asia/Kuwait')::date-interval '11 months';
 UPDATE cockpit_client_payments SET active=false,source_refresh_id=p_id WHERE day>=since_day AND active;
 FOR row_data IN SELECT * FROM jsonb_array_elements(p_output->'payments') LOOP
  INSERT INTO cockpit_client_payments(payment_id,clickup_task_id,client_name,day,usd,rail,side,kind,person,active,source_refresh_id)
   VALUES(row_data->>'payment_id',row_data->>'clickup_task_id',row_data->>'client_name',(row_data->>'day')::date,(row_data->>'usd')::numeric,row_data->>'rail',row_data->>'side',row_data->>'kind',row_data->>'person',true,p_id)
   ON CONFLICT(payment_id) DO UPDATE SET clickup_task_id=excluded.clickup_task_id,client_name=excluded.client_name,day=excluded.day,usd=excluded.usd,rail=excluded.rail,side=excluded.side,kind=excluded.kind,person=excluded.person,active=true,source_refresh_id=p_id,recorded_at=now();
 END LOOP;
 -- money ties: the deal ledger, rewritten like cockpit_client_payments when this output carries it; without the key it is left alone.
 -- money ties: each row as {payment_id, deal_response_id, day, usd, rail, kind, deposit_usd?, matched_by, tie_id?, payer?} (camelCase accepted);
 -- money ties: without deposit_usd a deposit row is all deposit and a remainder row none (a worker from before the split).
 IF p_output ? 'dealPayments' THEN -- money ties
  IF jsonb_typeof(p_output->'dealPayments') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Incomplete finance output'; END IF; -- money ties
  UPDATE cockpit_deal_payments SET active=false,source_refresh_id=p_id WHERE day>=since_day AND active; -- money ties
  FOR row_data IN SELECT jsonb_build_object( -- money ties
     'payment_id',coalesce(d->'payment_id',d->'paymentId'),'deal_response_id',coalesce(d->'deal_response_id',d->'dealResponseId'), -- money ties
     'day',d->'day','usd',d->'usd','rail',d->'rail','kind',d->'kind','deposit_usd',coalesce(d->'deposit_usd',d->'depositUsd'), -- money ties
     'matched_by',coalesce(d->'matched_by',d->'matchedBy'), -- money ties
     'tie_id',coalesce(d->'tie_id',d->'tieId'),'payer',d->'payer') -- money ties
    FROM jsonb_array_elements(p_output->'dealPayments') d LOOP -- money ties
   IF coalesce(btrim(row_data->>'payment_id'),'')='' OR coalesce(btrim(row_data->>'deal_response_id'),'')='' -- money ties
    OR coalesce(row_data->>'day','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR jsonb_typeof(row_data->'usd') IS DISTINCT FROM 'number' -- money ties
    OR coalesce(btrim(row_data->>'rail'),'')='' OR coalesce(row_data->>'kind','') NOT IN ('deposit','remainder') -- money ties
    OR coalesce(btrim(row_data->>'matched_by'),'')='' OR (row_data->'tie_id' IS NOT NULL AND jsonb_typeof(row_data->'tie_id') NOT IN ('number','null')) -- money ties
    OR (row_data->'deposit_usd' IS NOT NULL AND jsonb_typeof(row_data->'deposit_usd') NOT IN ('number','null')) -- money ties
    OR (jsonb_typeof(row_data->'deposit_usd')='number' AND ((row_data->>'deposit_usd')::numeric<0 OR (row_data->>'deposit_usd')::numeric>(row_data->>'usd')::numeric)) THEN -- money ties
    RAISE EXCEPTION 'Invalid deal payment %',left(coalesce(row_data->>'payment_id','(no id)'),120); -- money ties
   END IF; -- money ties
   INSERT INTO cockpit_deal_payments(payment_id,deal_response_id,day,usd,rail,kind,deposit_usd,matched_by,tie_id,payer,active,source_refresh_id) -- money ties
    VALUES(row_data->>'payment_id',row_data->>'deal_response_id',(row_data->>'day')::date,(row_data->>'usd')::numeric,row_data->>'rail',row_data->>'kind', -- money ties
     coalesce((row_data->>'deposit_usd')::numeric,CASE WHEN row_data->>'kind'='deposit' THEN (row_data->>'usd')::numeric ELSE 0 END), -- money ties
     row_data->>'matched_by',(row_data->>'tie_id')::bigint,row_data->>'payer',true,p_id) -- money ties
    ON CONFLICT(payment_id) DO UPDATE SET deal_response_id=excluded.deal_response_id,day=excluded.day,usd=excluded.usd,rail=excluded.rail,kind=excluded.kind,deposit_usd=excluded.deposit_usd,matched_by=excluded.matched_by,tie_id=excluded.tie_id,payer=excluded.payer,active=true,source_refresh_id=p_id,recorded_at=now(); -- money ties
  END LOOP; -- money ties
 END IF; -- money ties
 UPDATE cockpit_manual_payment_state SET totals_revision=rev,history_ready=true,updated_at=now() WHERE id;
 UPDATE cockpit_finance_refreshes SET status='confirmed',result=jsonb_build_object('ok',true,'id',p_id,'revision',rev,'sections',jsonb_build_array('money','expenses'),'payments',jsonb_array_length(p_output->'payments')),finished_at=now() WHERE id=p_id RETURNING result INTO previous;
 INSERT INTO cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,after) VALUES('finance.confirmed','cockpit_finance_refreshes',p_id::text,job.actor_email,'media-buyer-cockpit','supabase',previous);
 RETURN previous;
END $function$;

-- ---------------------------------------------------------------------------
-- 6. Function privileges: revoked from all four roles, then exactly one grant (or none)

-- Internal: no role at all. The snapshot is read through cockpit_finance_refresh_input
-- and cockpit_ceo_refresh_finance_source_snapshot (definers), as live.
REVOKE ALL ON FUNCTION public.cockpit_payment_ties_lock(), public.cockpit_ceo_refresh_finance_snapshot()
  FROM PUBLIC, anon, authenticated, service_role;
-- CEO RPCs, called from the browser.
REVOKE ALL ON FUNCTION public.cockpit_ceo_payment_tie(jsonb), public.cockpit_ceo_payment_untie(jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_ceo_payment_tie(jsonb), public.cockpit_ceo_payment_untie(jsonb) TO authenticated;
-- The refresh writer, as live: the service role only.
REVOKE ALL ON FUNCTION public.cockpit_finish_finance_refresh(uuid,jsonb,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_finish_finance_refresh(uuid,jsonb,text) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
