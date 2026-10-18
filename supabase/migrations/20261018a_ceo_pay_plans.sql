-- Pay plans: commission and bonuses on Team & payroll (core)
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Contract: docs/pay/PAY-PLANS.md
-- sections 3, 5 and 6 (the CEO, 2026-10-18). Facts come from 20261018b
-- (cockpit_pay_facts_calls/ads/clients/sales), which is applied after this
-- file; every call to them is plpgsql, resolved when it runs, and a facts
-- call that fails turns the parts that read it into `missing`, never $0.
--
-- What it adds:
--   - two commission bases on both roster lines (per_client_appt_shown,
--     per_client_deal_closed); only the CHECK constraints change, because
--     cockpit_ceo_people_save names the share bases and leaves the list of
--     bases to the constraint;
--   - dated history of commission lines and role (cockpit_commission_history,
--     cockpit_role_history), kept by AFTER triggers on cockpit_people and
--     seeded with every person's current values from 2026-01-01, so a past
--     month keeps the lines and role it had;
--   - cockpit_pay_plans, cockpit_pay_entries, cockpit_pay_confirmations and
--     cockpit_pay_months, with delete/truncate guards, an update guard on
--     entries and a lock on approved months;
--   - the internal functions (plan check, band pick, plan resolution, the
--     people of a month, the compute of section 6) and the CEO RPCs.
--
-- House rules: BEGIN/COMMIT, safe to run twice, SECURITY DEFINER with
-- search_path ''. Tables: row security on, no policy, every grant revoked
-- from PUBLIC, anon, authenticated and service_role, then SELECT to
-- service_role. Sequences: revoked from all four. CEO RPCs: revoked from all
-- four, EXECUTE to authenticated, gate public.cockpit_hours_ceo_email()
-- first. Internals and trigger functions: revoked from all four, no grant.
-- Every write RPC takes the advisory lock right after the gate, before any
-- check. Audit rows (cockpit_hours_audit) carry ids, months, kinds and keys,
-- never an amount. Nothing here references vault, net or cron, so it loads in
-- PGlite.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Two new commission bases, on both lines (live constraint text + 2 bases)

ALTER TABLE public.cockpit_people DROP CONSTRAINT IF EXISTS cockpit_people_commission_basis_check;
ALTER TABLE public.cockpit_people ADD CONSTRAINT cockpit_people_commission_basis_check CHECK (commission_basis = ANY (ARRAY[
  'none','closed_cash','closed_contract','set_cash','set_contract','per_intro_shown','per_demo_shown','per_signed',
  'mrr_managed','other','per_qualified_intro_shown','per_closed_deal',
  'per_client_appt_shown','per_client_deal_closed']::text[])); -- changed: the two client bases (PAY-PLANS.md decision 2)
ALTER TABLE public.cockpit_people DROP CONSTRAINT IF EXISTS cockpit_people_commission2_basis_check;
ALTER TABLE public.cockpit_people ADD CONSTRAINT cockpit_people_commission2_basis_check CHECK (commission2_basis = ANY (ARRAY[
  'none','closed_cash','closed_contract','set_cash','set_contract','per_intro_shown','per_demo_shown','per_signed',
  'mrr_managed','other','per_qualified_intro_shown','per_closed_deal',
  'per_client_appt_shown','per_client_deal_closed']::text[])); -- changed: the two client bases (PAY-PLANS.md decision 2)

-- ---------------------------------------------------------------------------
-- 2. Tables

CREATE TABLE IF NOT EXISTS public.cockpit_commission_history (
  person_id bigint NOT NULL REFERENCES public.cockpit_people(id),
  from_month date NOT NULL CHECK (extract(day FROM from_month)=1),
  basis text NOT NULL,
  rate numeric,
  basis2 text NOT NULL,
  rate2 numeric,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, from_month)
);
COMMENT ON TABLE public.cockpit_commission_history IS
  'Commission lines per person from the 1st of a Kuwait month (PAY-PLANS.md decision 15). Written by the cockpit_pay_people_lines trigger; the pay month reads the row in force on its last day.';

CREATE TABLE IF NOT EXISTS public.cockpit_role_history (
  person_id bigint NOT NULL REFERENCES public.cockpit_people(id),
  from_month date NOT NULL CHECK (extract(day FROM from_month)=1),
  role text,
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, from_month)
);
COMMENT ON TABLE public.cockpit_role_history IS
  'Role per person from the 1st of a Kuwait month, so a role plan follows the role a person had in that month.';

CREATE TABLE IF NOT EXISTS public.cockpit_pay_plans (
  id bigserial PRIMARY KEY,
  role text CHECK (role IS NULL OR (role=btrim(role) AND length(role) BETWEEN 1 AND 80)),
  person_id bigint REFERENCES public.cockpit_people(id),
  from_month date NOT NULL CHECK (extract(day FROM from_month)=1),
  plan jsonb CHECK (plan IS NULL OR jsonb_typeof(plan)='object'),
  note text CHECK (note IS NULL OR length(note)<=500),
  set_by text NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(role, person_id)=1),
  CHECK (role IS NULL OR plan IS NOT NULL)
);
COMMENT ON TABLE public.cockpit_pay_plans IS
  'Pay plans (PAY-PLANS.md section 3) for a role or one person, from a month. A person row with plan null follows the role plan from that month.';
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_pay_plans_role_uidx ON public.cockpit_pay_plans(lower(btrim(role)), from_month) WHERE role IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_pay_plans_person_uidx ON public.cockpit_pay_plans(person_id, from_month) WHERE person_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.cockpit_pay_entries (
  id bigserial PRIMARY KEY,
  person_id bigint NOT NULL REFERENCES public.cockpit_people(id),
  month date NOT NULL CHECK (extract(day FROM month)=1),
  part_key text NOT NULL CHECK (part_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  quantity numeric,
  cash_usd numeric CHECK (cash_usd IS NULL OR cash_usd>=0),
  amount_usd numeric,
  engagement_month int CHECK (engagement_month IS NULL OR engagement_month BETWEEN 1 AND 600),
  client text CHECK (client IS NULL OR length(client)<=120),
  product text CHECK (product IS NULL OR length(product)<=120),
  cleared_on date,
  posted_on date,
  cancelled_on date,
  evidence_ref text CHECK (evidence_ref IS NULL OR length(evidence_ref)<=200),
  evidence text CHECK (evidence IS NULL OR length(evidence)<=1000),
  note text CHECK (note IS NULL OR length(note)<=500),
  from_month date CHECK (from_month IS NULL OR extract(day FROM from_month)=1),
  entered_by text NOT NULL,
  entered_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by text,
  void_reason text CHECK (void_reason IS NULL OR length(void_reason)<=300)
);
COMMENT ON TABLE public.cockpit_pay_entries IS
  'What the data cannot see, typed by the CEO: one audited entry per item (counts, cash, adjustments). Never deleted; removed by voiding.';
CREATE INDEX IF NOT EXISTS cockpit_pay_entries_person_month_idx ON public.cockpit_pay_entries(person_id, month) WHERE voided_at IS NULL;

CREATE TABLE IF NOT EXISTS public.cockpit_pay_confirmations (
  id bigserial PRIMARY KEY,
  month date NOT NULL CHECK (extract(day FROM month)=1),
  key text NOT NULL CHECK (length(key)<=200 AND key ~ '^[a-z_]+(:[A-Za-z0-9_.-]+)?$'),
  value jsonb NOT NULL,
  note text CHECK (note IS NULL OR length(note)<=500),
  set_by text NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (month, key)
);
COMMENT ON TABLE public.cockpit_pay_confirmations IS
  'Measures whose sources disagree, confirmed by the CEO (PAY-PLANS.md decision 8 and section 4). ramp_start, setter and pif keys hold one row each, under any month.';

CREATE TABLE IF NOT EXISTS public.cockpit_pay_months (
  id bigserial PRIMARY KEY,
  person_id bigint NOT NULL REFERENCES public.cockpit_people(id),
  month date NOT NULL CHECK (extract(day FROM month)=1),
  status text NOT NULL CHECK (status IN ('approved','withdrawn')),
  base_usd numeric,
  commission_usd numeric,
  parts_usd numeric NOT NULL,
  total_usd numeric,
  not_priced jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb NOT NULL,
  result_hash text NOT NULL CHECK (result_hash ~ '^[0-9a-f]{32}$'),
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_by text,
  withdrawn_at timestamptz,
  withdraw_reason text CHECK (withdraw_reason IS NULL OR length(withdraw_reason)<=300)
);
COMMENT ON TABLE public.cockpit_pay_months IS
  'An approved pay-plan month per person: the frozen result (plan JSON, inputs, evidence ids) and its hash. Figures never change; approved -> withdrawn only.';
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_pay_months_approved_uidx ON public.cockpit_pay_months(person_id, month) WHERE status='approved';

-- Row security on, no policy, every grant revoked, then service_role reads.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cockpit_commission_history','cockpit_role_history','cockpit_pay_plans','cockpit_pay_entries',
    'cockpit_pay_confirmations','cockpit_pay_months'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO service_role', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['cockpit_pay_plans_id_seq','cockpit_pay_entries_id_seq','cockpit_pay_confirmations_id_seq','cockpit_pay_months_id_seq'] LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE public.%I FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Guards

-- Plans, entries, approvals and both histories are never deleted or truncated
-- (cockpit_hours_refuse_delete from 20261009a).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cockpit_pay_plans','cockpit_pay_entries','cockpit_pay_months','cockpit_commission_history','cockpit_role_history'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t||'_guard_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.cockpit_hours_refuse_delete()', t||'_guard_delete', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t||'_guard_truncate', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_hours_refuse_delete()', t||'_guard_truncate', t);
  END LOOP;
END $$;

/** An entry changes once: voided_at, voided_by and void_reason go from null to set. */
CREATE OR REPLACE FUNCTION public.cockpit_pay_entries_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'A removed entry is kept as it was' USING ERRCODE='42501';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['voided_at','voided_by','void_reason']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['voided_at','voided_by','void_reason']) THEN
    RAISE EXCEPTION 'Entries are never edited: remove it and add a new one' USING ERRCODE='42501';
  END IF;
  IF NEW.voided_at IS NULL OR NEW.voided_by IS NULL OR NEW.void_reason IS NULL THEN
    RAISE EXCEPTION 'Removing an entry records when, by whom and why' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cockpit_pay_entries_guard ON public.cockpit_pay_entries;
CREATE TRIGGER cockpit_pay_entries_guard BEFORE UPDATE ON public.cockpit_pay_entries
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_pay_entries_guard();

/** Approved figures lock: only approved -> withdrawn, withdrawn_* set once; withdrawn rows never change. */
CREATE OR REPLACE FUNCTION public.cockpit_pay_months_lock()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF OLD.status='withdrawn' THEN
    RAISE EXCEPTION 'A withdrawn approval is kept as it was' USING ERRCODE='42501';
  END IF;
  IF (to_jsonb(NEW)-ARRAY['status','withdrawn_by','withdrawn_at','withdraw_reason'])
     IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','withdrawn_by','withdrawn_at','withdraw_reason']) THEN
    RAISE EXCEPTION 'Approved pay figures lock; a later change is added to a later month' USING ERRCODE='42501';
  END IF;
  IF NOT (NEW.status='withdrawn' AND NEW.withdrawn_by IS NOT NULL AND NEW.withdrawn_at IS NOT NULL AND NEW.withdraw_reason IS NOT NULL) THEN
    RAISE EXCEPTION 'An approval can only be withdrawn, with who, when and why' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cockpit_pay_months_lock ON public.cockpit_pay_months;
CREATE TRIGGER cockpit_pay_months_lock BEFORE UPDATE ON public.cockpit_pay_months
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_pay_months_lock();

-- ---------------------------------------------------------------------------
-- 4. Small helpers

/** The Costs page's fixed planning rates (ceoPeopleModel.ts USD_PER): USD per unit. */
CREATE OR REPLACE FUNCTION public.cockpit_pay_usd_per(p_currency text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE upper(btrim(coalesce(p_currency,'USD'))) WHEN 'USD' THEN 1 WHEN 'KWD' THEN 3.26 WHEN 'AED' THEN 0.2723
    WHEN 'SAR' THEN 0.2666 WHEN 'QAR' THEN 0.2747 END::numeric
$$;

/** A JSON number as numeric; anything else is null. */
CREATE OR REPLACE FUNCTION public.cockpit_pay_num(p jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE WHEN jsonb_typeof(p)='number' THEN (p#>>'{}')::numeric END
$$;

/** A count that facts give either as a number or as a list. */
CREATE OR REPLACE FUNCTION public.cockpit_pay_count(p jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE jsonb_typeof(p) WHEN 'number' THEN (p#>>'{}')::numeric WHEN 'array' THEN jsonb_array_length(p)::numeric END
$$;

/** '$1,200' or '$12.45', for notes only (audit rows never carry amounts). */
CREATE OR REPLACE FUNCTION public.cockpit_pay_money(p numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE WHEN p IS NULL THEN 'n/a' ELSE (CASE WHEN p<0 THEN '-' ELSE '' END)||'$'||
    CASE WHEN round(abs(p),2)=trunc(abs(p)) THEN to_char(trunc(abs(p)),'FM999,999,999,990')
      ELSE to_char(round(abs(p),2),'FM999,999,999,990.00') END END
$$;

/** Refuses a payload that is not an object or carries a key outside the list. */
CREATE OR REPLACE FUNCTION public.cockpit_pay_only(p jsonb, p_allowed text[])
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Send the details as an object' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p) LOOP
    IF NOT (k = ANY(p_allowed)) THEN RAISE EXCEPTION 'Unknown field: %', k USING ERRCODE='22023'; END IF;
  END LOOP;
END;
$$;

/** p->k as trimmed text (null when absent, null or blank), refused when not a string or too long. */
CREATE OR REPLACE FUNCTION public.cockpit_pay_text(p jsonb, k text, p_max integer)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v text;
BEGIN
  IF NOT (p ? k) OR p->k='null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(p->k)<>'string' THEN RAISE EXCEPTION '% must be text', k USING ERRCODE='22023'; END IF;
  v:=nullif(btrim(p->>k),'');
  IF length(v)>p_max THEN RAISE EXCEPTION '% is longer than % characters', k, p_max USING ERRCODE='22023'; END IF;
  RETURN v;
END;
$$;

/** p->k as a number (null when absent or null), refused when not a number. */
CREATE OR REPLACE FUNCTION public.cockpit_pay_number(p jsonb, k text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
  IF NOT (p ? k) OR p->k='null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(p->k)<>'number' THEN RAISE EXCEPTION '% must be a number', k USING ERRCODE='22023'; END IF;
  RETURN (p->>k)::numeric;
END;
$$;

/** p->k as a date (YYYY-MM-DD), null when absent or null. */
CREATE OR REPLACE FUNCTION public.cockpit_pay_date(p jsonb, k text)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
  IF NOT (p ? k) OR p->k='null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(p->k)<>'string' THEN RAISE EXCEPTION '% must be a date, as YYYY-MM-DD', k USING ERRCODE='22023'; END IF;
  RETURN public.cockpit_hours_day(p->>k);
END;
$$;

/** The latest approved pay-plan month of a person, or null. */
CREATE OR REPLACE FUNCTION public.cockpit_pay_last_approved(p_person bigint)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT max(m.month) FROM public.cockpit_pay_months m WHERE m.person_id=p_person AND m.status='approved'
$$;

/** A month can be approved from the 3rd of the next month. */
CREATE OR REPLACE FUNCTION public.cockpit_pay_settle_day(p_month date)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT (date_trunc('month',p_month)+interval '1 month'+interval '2 days')::date
$$;

/** The confirmation stored under a month, or null. */
CREATE OR REPLACE FUNCTION public.cockpit_pay_confirmed(p_month date, p_key text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT c.value FROM public.cockpit_pay_confirmations c WHERE c.month=date_trunc('month',p_month)::date AND c.key=p_key
$$;

/** A key held once whatever the month (ramp_start, setter, pif): the latest. */
CREATE OR REPLACE FUNCTION public.cockpit_pay_confirmed_any(p_key text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT c.value FROM public.cockpit_pay_confirmations c WHERE c.key=p_key ORDER BY c.set_at DESC, c.id DESC LIMIT 1
$$;

/** A commission line in words, for sentences. */
CREATE OR REPLACE FUNCTION public.cockpit_pay_line_words(p_basis text, p_rate numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE WHEN p_basis IN ('closed_cash','closed_contract','set_cash','set_contract','mrr_managed')
    THEN coalesce(trim_scale(round(p_rate*100,4))::text,'?')||'% '||CASE p_basis
      WHEN 'closed_cash' THEN 'of cash on deals they close' WHEN 'closed_contract' THEN 'of contract value on deals they close'
      WHEN 'set_cash' THEN 'of cash on deals they set' WHEN 'set_contract' THEN 'of contract value on deals they set'
      ELSE 'of MRR managed' END
    ELSE public.cockpit_pay_money(p_rate)||' '||CASE p_basis
      WHEN 'per_intro_shown' THEN 'per intro shown' WHEN 'per_demo_shown' THEN 'per demo shown' WHEN 'per_signed' THEN 'per signed deal'
      WHEN 'per_qualified_intro_shown' THEN 'per qualified intro shown' WHEN 'per_closed_deal' THEN 'per closed deal'
      WHEN 'per_client_appt_shown' THEN 'per client appointment shown' WHEN 'per_client_deal_closed' THEN 'per closed client deal'
      ELSE 'by the note' END END
$$;

-- ---------------------------------------------------------------------------
-- 5. Commission and role history (decision 15)

/** Commission lines in force for a month: the history row on or before it. */
CREATE OR REPLACE FUNCTION public.cockpit_pay_lines_at(p_person bigint, p_month date)
RETURNS TABLE(basis text, rate numeric, basis2 text, rate2 numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  RETURN QUERY SELECT h.basis, h.rate, h.basis2, h.rate2 FROM public.cockpit_commission_history h
    WHERE h.person_id=p_person AND h.from_month<=date_trunc('month',p_month)::date ORDER BY h.from_month DESC LIMIT 1;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.cockpit_commission_history h WHERE h.person_id=p_person) THEN
      -- Before their first row they had no lines.
      RETURN QUERY SELECT 'none'::text, NULL::numeric, 'none'::text, NULL::numeric;
    ELSE
      RETURN QUERY SELECT p.commission_basis, p.commission_rate, p.commission2_basis, p.commission2_rate
        FROM public.cockpit_people p WHERE p.id=p_person;
    END IF;
  END IF;
END;
$$;

/** The role in force for a month. */
CREATE OR REPLACE FUNCTION public.cockpit_pay_role_at(p_person bigint, p_month date)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v text;
BEGIN
  SELECT h.role INTO v FROM public.cockpit_role_history h
    WHERE h.person_id=p_person AND h.from_month<=date_trunc('month',p_month)::date ORDER BY h.from_month DESC LIMIT 1;
  IF FOUND THEN RETURN nullif(btrim(v),''); END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_role_history h WHERE h.person_id=p_person) THEN RETURN NULL; END IF;
  SELECT nullif(btrim(p.role),'') INTO v FROM public.cockpit_people p WHERE p.id=p_person;
  RETURN v;
END;
$$;

/**
 * A change is dated to the 1st of this Kuwait month; a new person's lines date
 * from the month they started (never after today), as cockpit_hours_people_pay
 * dates their base, so the months they worked carry them.
 */
CREATE OR REPLACE FUNCTION public.cockpit_pay_people_lines()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_from date:=date_trunc('month',CASE WHEN TG_OP='INSERT' THEN least(coalesce(NEW.started_on,public.cockpit_hours_kw_today()),public.cockpit_hours_kw_today())
  ELSE public.cockpit_hours_kw_today() END)::date;
  h public.cockpit_commission_history; v_last date;
BEGIN
  SELECT * INTO h FROM public.cockpit_commission_history c WHERE c.person_id=NEW.id AND c.from_month<=v_from ORDER BY c.from_month DESC LIMIT 1;
  IF FOUND AND h.basis=NEW.commission_basis AND h.rate IS NOT DISTINCT FROM NEW.commission_rate
    AND h.basis2=NEW.commission2_basis AND h.rate2 IS NOT DISTINCT FROM NEW.commission2_rate THEN RETURN NEW; END IF;
  v_last:=public.cockpit_pay_last_approved(NEW.id);
  IF v_last>=v_from THEN
    RAISE EXCEPTION '% is approved for %. Commission lines can change from %.', public.cockpit_hours_month_name(v_last), NEW.name,
      public.cockpit_hours_month_name((v_last+interval '1 month')::date) USING ERRCODE='22023';
  END IF;
  INSERT INTO public.cockpit_commission_history(person_id,from_month,basis,rate,basis2,rate2,recorded_by)
  VALUES(NEW.id,v_from,NEW.commission_basis,NEW.commission_rate,NEW.commission2_basis,NEW.commission2_rate,public.cockpit_hours_member_email())
  ON CONFLICT (person_id,from_month) DO UPDATE SET basis=EXCLUDED.basis,rate=EXCLUDED.rate,basis2=EXCLUDED.basis2,rate2=EXCLUDED.rate2,
    recorded_by=EXCLUDED.recorded_by,recorded_at=now();
  RETURN NEW;
END;
$$;

/** The role, dated as the lines are: a change from this month, a new person from the month they started. */
CREATE OR REPLACE FUNCTION public.cockpit_pay_people_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_from date:=date_trunc('month',CASE WHEN TG_OP='INSERT' THEN least(coalesce(NEW.started_on,public.cockpit_hours_kw_today()),public.cockpit_hours_kw_today())
  ELSE public.cockpit_hours_kw_today() END)::date;
  h public.cockpit_role_history; v_last date;
BEGIN
  SELECT * INTO h FROM public.cockpit_role_history r WHERE r.person_id=NEW.id AND r.from_month<=v_from ORDER BY r.from_month DESC LIMIT 1;
  IF FOUND AND h.role IS NOT DISTINCT FROM nullif(btrim(NEW.role),'') THEN RETURN NEW; END IF;
  v_last:=public.cockpit_pay_last_approved(NEW.id);
  IF v_last>=v_from THEN
    RAISE EXCEPTION '% is approved for %. The role can change from %.', public.cockpit_hours_month_name(v_last), NEW.name,
      public.cockpit_hours_month_name((v_last+interval '1 month')::date) USING ERRCODE='22023';
  END IF;
  INSERT INTO public.cockpit_role_history(person_id,from_month,role,recorded_by)
  VALUES(NEW.id,v_from,nullif(btrim(NEW.role),''),public.cockpit_hours_member_email())
  ON CONFLICT (person_id,from_month) DO UPDATE SET role=EXCLUDED.role,recorded_by=EXCLUDED.recorded_by,recorded_at=now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cockpit_pay_people_lines_insert ON public.cockpit_people;
CREATE TRIGGER cockpit_pay_people_lines_insert AFTER INSERT ON public.cockpit_people
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_pay_people_lines();
DROP TRIGGER IF EXISTS cockpit_pay_people_lines_update ON public.cockpit_people;
CREATE TRIGGER cockpit_pay_people_lines_update AFTER UPDATE OF commission_basis, commission_rate, commission2_basis, commission2_rate ON public.cockpit_people
  FOR EACH ROW WHEN (OLD.commission_basis IS DISTINCT FROM NEW.commission_basis OR OLD.commission_rate IS DISTINCT FROM NEW.commission_rate
    OR OLD.commission2_basis IS DISTINCT FROM NEW.commission2_basis OR OLD.commission2_rate IS DISTINCT FROM NEW.commission2_rate)
  EXECUTE FUNCTION public.cockpit_pay_people_lines();
DROP TRIGGER IF EXISTS cockpit_pay_people_role_insert ON public.cockpit_people;
CREATE TRIGGER cockpit_pay_people_role_insert AFTER INSERT ON public.cockpit_people
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_pay_people_role();
DROP TRIGGER IF EXISTS cockpit_pay_people_role_update ON public.cockpit_people;
CREATE TRIGGER cockpit_pay_people_role_update AFTER UPDATE OF role ON public.cockpit_people
  FOR EACH ROW WHEN (OLD.role IS DISTINCT FROM NEW.role)
  EXECUTE FUNCTION public.cockpit_pay_people_role();

-- Seeds: every person's current values from 2026-01-01 (guarded, so a second run writes nothing).
INSERT INTO public.cockpit_commission_history(person_id,from_month,basis,rate,basis2,rate2,recorded_by)
SELECT p.id,'2026-01-01'::date,p.commission_basis,p.commission_rate,p.commission2_basis,p.commission2_rate,'migration 20261018a'
FROM public.cockpit_people p
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_commission_history h WHERE h.person_id=p.id);

INSERT INTO public.cockpit_role_history(person_id,from_month,role,recorded_by)
SELECT p.id,'2026-01-01'::date,nullif(btrim(p.role),''),'migration 20261018a'
FROM public.cockpit_people p
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_role_history h WHERE h.person_id=p.id);

-- ---------------------------------------------------------------------------
-- 6. The plan: check, band pick, which plan applies

/**
 * The plan's first fault as a sentence, or null when it is valid
 * (PAY-PLANS.md section 3). The TS checkPlan (src/types/ceo/payPlan.ts)
 * returns the same sentences; scripts/pay-plan-model.test.ts holds the shared
 * table. Unknown keys are refused at every level.
 */
CREATE OR REPLACE FUNCTION public.cockpit_pay_plan_check(p_plan jsonb, p_is_role boolean)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE
  part jsonb; f text; pi int:=0; pk text; kind text; keys text[]:='{}'; measures text[]:='{}'; m text; churn boolean;
  allowed text[]; b jsonb; bi int; nb int; up numeric; prev numeric; x numeric; g jsonb; s jsonb; si int; ns int; prevm numeric;
  floors int:=0; pifs int:=0; line jsonb; li int:=0; bases text[]:='{}'; basis text; ev text;
BEGIN
  IF jsonb_typeof(p_plan) IS DISTINCT FROM 'object' THEN RETURN 'A pay plan is an object with a version and a list of parts.'; END IF;
  FOR f IN SELECT jsonb_object_keys(p_plan) LOOP
    IF NOT (f = ANY(ARRAY['version','parts','commission'])) THEN RETURN format('Unknown field "%s" in the plan.', f); END IF;
  END LOOP;
  IF p_plan->'version' IS DISTINCT FROM '1'::jsonb THEN RETURN 'The plan''s version must be 1.'; END IF;
  IF jsonb_typeof(p_plan->'parts') IS DISTINCT FROM 'array' THEN RETURN 'The plan needs a list of parts (it may be empty).'; END IF;
  IF jsonb_array_length(p_plan->'parts')>20 THEN RETURN 'A plan has at most 20 parts.'; END IF;
  FOR part IN SELECT t.v FROM jsonb_array_elements(p_plan->'parts') WITH ORDINALITY AS t(v,o) ORDER BY t.o LOOP
    pi:=pi+1;
    IF jsonb_typeof(part) IS DISTINCT FROM 'object' THEN RETURN format('Part %s is not an object.', pi); END IF;
    pk:=part->>'key';
    IF jsonb_typeof(part->'key') IS DISTINCT FROM 'string' OR pk !~ '^[a-z][a-z0-9_]{0,39}$' THEN
      RETURN format('Part %s needs a key: a lowercase letter, then letters, digits or _ (up to 40).', pi);
    END IF;
    IF pk='adjustment' THEN RETURN 'The key "adjustment" is kept for adjustments.'; END IF;
    IF pk = ANY(keys) THEN RETURN format('Two parts share the key "%s".', pk); END IF;
    keys:=keys||pk;
    kind:=CASE WHEN jsonb_typeof(part->'kind')='string' THEN part->>'kind' END;
    allowed:=CASE kind
      WHEN 'band' THEN ARRAY['key','kind','label','metric','covers','bands','guard']
      WHEN 'per_event' THEN ARRAY['key','kind','label','event','amount','eventLabel']
      WHEN 'share' THEN ARRAY['key','kind','label','of','steps','ends','prorateOnCancel']
      WHEN 'per_above' THEN ARRAY['key','kind','label','measure','over','amount']
      WHEN 'floor' THEN ARRAY['key','kind','label','amount','days'] END;
    IF allowed IS NULL THEN RETURN format('Part "%s" has an unknown kind.', pk); END IF;
    FOR f IN SELECT jsonb_object_keys(part) LOOP
      IF NOT (f = ANY(allowed)) THEN RETURN format('Unknown field "%s" in part "%s".', f, pk); END IF;
    END LOOP;
    IF jsonb_typeof(part->'label') IS DISTINCT FROM 'string' OR length(btrim(part->>'label')) NOT BETWEEN 1 AND 80 THEN
      RETURN format('Part "%s" needs a label of 1 to 80 characters.', pk);
    END IF;

    IF kind='band' THEN
      m:=CASE WHEN jsonb_typeof(part->'metric')='string' THEN part->>'metric' END;
      IF m IS NULL OR NOT (m = ANY(ARRAY['cpl','cpb','logo_churn_prior','csm_churn'])) THEN RETURN format('Part "%s" pays on an unknown metric.', pk); END IF;
      churn:=m IN ('logo_churn_prior','csm_churn');
      IF part ? 'covers' THEN
        IF churn THEN RETURN format('Part "%s": only cost per lead or cost per booking covers clients.', pk); END IF;
        IF jsonb_typeof(part->'covers') IS DISTINCT FROM 'string' OR NOT (part->>'covers' = ANY(ARRAY['all_clients','owned_creative'])) THEN
          RETURN format('Part "%s" covers all_clients or owned_creative.', pk);
        END IF;
      END IF;
      IF part ? 'guard' THEN
        IF churn THEN RETURN format('Part "%s": only cost per lead or cost per booking has a guard.', pk); END IF;
        g:=part->'guard';
        IF jsonb_typeof(g) IS DISTINCT FROM 'object' THEN RETURN format('The guard of part "%s" is an object.', pk); END IF;
        FOR f IN SELECT jsonb_object_keys(g) LOOP
          IF NOT (f = ANY(ARRAY['minClients','minSpendUsd','excludeDays'])) THEN RETURN format('Unknown field "%s" in the guard of part "%s".', f, pk); END IF;
        END LOOP;
        x:=public.cockpit_pay_num(g->'minClients');
        IF g ? 'minClients' AND (x IS NULL OR x<>trunc(x) OR x NOT BETWEEN 1 AND 100) THEN RETURN format('The guard of part "%s" needs minClients from 1 to 100.', pk); END IF;
        x:=public.cockpit_pay_num(g->'minSpendUsd');
        IF g ? 'minSpendUsd' AND (x IS NULL OR x NOT BETWEEN 0 AND 100000) THEN RETURN format('The guard of part "%s" needs minSpendUsd from 0 to 100,000.', pk); END IF;
        x:=public.cockpit_pay_num(g->'excludeDays');
        IF g ? 'excludeDays' AND (x IS NULL OR x<>trunc(x) OR x NOT BETWEEN 0 AND 90) THEN RETURN format('The guard of part "%s" needs excludeDays from 0 to 90.', pk); END IF;
      END IF;
      IF jsonb_typeof(part->'bands') IS DISTINCT FROM 'array' OR jsonb_array_length(part->'bands') NOT BETWEEN 2 AND 10 THEN
        RETURN format('Part "%s" needs 2 to 10 bands.', pk);
      END IF;
      nb:=jsonb_array_length(part->'bands'); bi:=0; prev:=NULL;
      FOR b IN SELECT t.v FROM jsonb_array_elements(part->'bands') WITH ORDINALITY AS t(v,o) ORDER BY t.o LOOP
        bi:=bi+1;
        IF jsonb_typeof(b) IS DISTINCT FROM 'object' THEN RETURN format('Band %s of part "%s" is not an object.', bi, pk); END IF;
        FOR f IN SELECT jsonb_object_keys(b) LOOP
          IF NOT (f = ANY(ARRAY['upTo','inclusive','amount'])) THEN RETURN format('Unknown field "%s" in band %s of part "%s".', f, bi, pk); END IF;
        END LOOP;
        x:=public.cockpit_pay_num(b->'amount');
        IF x IS NULL OR abs(x)>100000 THEN RETURN format('Band %s of part "%s" needs an amount between -100,000 and 100,000.', bi, pk); END IF;
        IF bi<nb THEN
          up:=public.cockpit_pay_num(b->'upTo');
          IF up IS NULL THEN RETURN format('Band %s of part "%s" needs a number upTo; only the last band runs on.', bi, pk); END IF;
          IF jsonb_typeof(b->'inclusive') IS DISTINCT FROM 'boolean' THEN RETURN format('Band %s of part "%s" needs inclusive: true or false.', bi, pk); END IF;
          IF churn AND up NOT BETWEEN 0 AND 100 THEN RETURN format('Band edges of part "%s" are percents from 0 to 100.', pk); END IF;
          IF NOT churn AND up<=0 THEN RETURN format('Band edges of part "%s" are amounts above 0.', pk); END IF;
          IF prev IS NOT NULL AND up<=prev THEN RETURN format('The bands of part "%s" must rise.', pk); END IF;
          prev:=up;
        ELSE
          IF b->'upTo' IS DISTINCT FROM 'null'::jsonb THEN RETURN format('The last band of part "%s" runs on: upTo null.', pk); END IF;
          IF b ? 'inclusive' AND jsonb_typeof(b->'inclusive') IS DISTINCT FROM 'boolean' THEN
            RETURN format('Band %s of part "%s" needs inclusive: true or false.', bi, pk);
          END IF;
        END IF;
      END LOOP;
      m:=CASE WHEN churn THEN m ELSE m||':'||coalesce(part->>'covers','all_clients') END;
      IF m = ANY(measures) THEN RETURN format('Two parts pay on the same measure (%s).', m); END IF;
      measures:=measures||m;

    ELSIF kind='per_event' THEN
      ev:=CASE WHEN jsonb_typeof(part->'event')='string' THEN part->>'event' END;
      IF ev IS NULL OR NOT (ev = ANY(ARRAY['renewal','reactivation','referral','video_testimonial','google_review','podcast_case_study',
        'system_built','system_built_large','custom','pif_deal_closed'])) THEN RETURN format('Part "%s" has an unknown event.', pk); END IF;
      x:=public.cockpit_pay_num(part->'amount');
      IF x IS NULL OR x<0 OR x>100000 THEN RETURN format('Part "%s" needs an amount from 0 to 100,000.', pk); END IF;
      IF ev='custom' THEN
        IF jsonb_typeof(part->'eventLabel') IS DISTINCT FROM 'string' OR length(btrim(part->>'eventLabel')) NOT BETWEEN 1 AND 80 THEN
          RETURN format('Part "%s" needs an event label of 1 to 80 characters.', pk);
        END IF;
      ELSIF part ? 'eventLabel' THEN RETURN format('Part "%s": only a custom event has a label.', pk);
      END IF;
      IF ev='pif_deal_closed' THEN
        pifs:=pifs+1;
        IF pifs>1 THEN RETURN 'The paid-in-full bonus can be in a plan once.'; END IF;
      END IF;

    ELSIF kind='share' THEN
      IF jsonb_typeof(part->'of') IS DISTINCT FROM 'string' OR NOT (part->>'of' = ANY(ARRAY['upsell_cash','recurring_revenue','smm_revenue','custom_cash'])) THEN
        RETURN format('Part "%s" is a share of an unknown amount.', pk);
      END IF;
      IF jsonb_typeof(part->'steps') IS DISTINCT FROM 'array' OR jsonb_array_length(part->'steps') NOT BETWEEN 1 AND 6 THEN
        RETURN format('Part "%s" needs 1 to 6 steps.', pk);
      END IF;
      si:=0; prevm:=NULL;
      FOR s IN SELECT t.v FROM jsonb_array_elements(part->'steps') WITH ORDINALITY AS t(v,o) ORDER BY t.o LOOP
        si:=si+1;
        IF jsonb_typeof(s) IS DISTINCT FROM 'object' THEN RETURN format('Step %s of part "%s" is not an object.', si, pk); END IF;
        FOR f IN SELECT jsonb_object_keys(s) LOOP
          IF NOT (f = ANY(ARRAY['fromMonth','rate'])) THEN RETURN format('Unknown field "%s" in step %s of part "%s".', f, si, pk); END IF;
        END LOOP;
        x:=public.cockpit_pay_num(s->'fromMonth');
        IF x IS NULL OR x<>trunc(x) OR x NOT BETWEEN 1 AND 600 THEN RETURN format('Step %s of part "%s" needs fromMonth, a month number from 1.', si, pk); END IF;
        IF si=1 AND x<>1 THEN RETURN format('The first step of part "%s" starts in month 1.', pk); END IF;
        IF prevm IS NOT NULL AND x<=prevm THEN RETURN format('The steps of part "%s" must start in later months.', pk); END IF;
        prevm:=x;
        x:=public.cockpit_pay_num(s->'rate');
        IF x IS NULL OR x NOT BETWEEN 0 AND 1 THEN RETURN format('Step %s of part "%s" needs a rate from 0 to 1.', si, pk); END IF;
      END LOOP;
      IF part ? 'ends' THEN
        IF jsonb_typeof(part->'ends') IS DISTINCT FROM 'object' THEN RETURN format('The ends of part "%s" are an object.', pk); END IF;
        FOR f IN SELECT jsonb_object_keys(part->'ends') LOOP
          IF NOT (f = ANY(ARRAY['onCancel','lapseDays'])) THEN RETURN format('Unknown field "%s" in the ends of part "%s".', f, pk); END IF;
        END LOOP;
        IF jsonb_typeof(part->'ends'->'onCancel') IS DISTINCT FROM 'boolean' THEN RETURN format('The ends of part "%s" need onCancel: true or false.', pk); END IF;
        x:=public.cockpit_pay_num(part->'ends'->'lapseDays');
        IF part->'ends' ? 'lapseDays' AND (x IS NULL OR x<>trunc(x) OR x NOT BETWEEN 1 AND 365) THEN RETURN format('Part "%s" needs lapseDays from 1 to 365.', pk); END IF;
      END IF;
      IF part ? 'prorateOnCancel' AND jsonb_typeof(part->'prorateOnCancel') IS DISTINCT FROM 'boolean' THEN
        RETURN format('Part "%s" needs prorateOnCancel: true or false.', pk);
      END IF;

    ELSIF kind='per_above' THEN
      IF part->'measure' IS DISTINCT FROM '"qualifying_clients"'::jsonb THEN RETURN format('Part "%s" counts an unknown measure.', pk); END IF;
      x:=public.cockpit_pay_num(part->'over');
      IF x IS NULL OR x<>trunc(x) OR x NOT BETWEEN 0 AND 1000 THEN RETURN format('Part "%s" needs over from 0 to 1,000.', pk); END IF;
      x:=public.cockpit_pay_num(part->'amount');
      IF x IS NULL OR x<0 OR x>100000 THEN RETURN format('Part "%s" needs an amount from 0 to 100,000.', pk); END IF;

    ELSE -- floor
      x:=public.cockpit_pay_num(part->'amount');
      IF x IS NULL OR x<=0 OR x>100000 THEN RETURN format('Part "%s" needs an amount above 0 and up to 100,000.', pk); END IF;
      x:=public.cockpit_pay_num(part->'days');
      IF x IS NULL OR x<>trunc(x) OR x NOT BETWEEN 1 AND 366 THEN RETURN format('Part "%s" needs days from 1 to 366.', pk); END IF;
      floors:=floors+1;
      IF floors>1 THEN RETURN 'A plan has at most one floor.'; END IF;
    END IF;
  END LOOP;

  IF p_plan ? 'commission' THEN
    IF NOT coalesce(p_is_role,false) THEN RETURN 'Only a role plan carries commission lines; set a person''s lines on the roster.'; END IF;
    IF jsonb_typeof(p_plan->'commission') IS DISTINCT FROM 'array' OR jsonb_array_length(p_plan->'commission')>2 THEN
      RETURN 'A role plan has at most 2 commission lines.';
    END IF;
    FOR line IN SELECT t.v FROM jsonb_array_elements(p_plan->'commission') WITH ORDINALITY AS t(v,o) ORDER BY t.o LOOP
      li:=li+1;
      IF jsonb_typeof(line) IS DISTINCT FROM 'object' THEN RETURN format('Commission line %s is not an object.', li); END IF;
      FOR f IN SELECT jsonb_object_keys(line) LOOP
        IF NOT (f = ANY(ARRAY['basis','rate'])) THEN RETURN format('Unknown field "%s" in commission line %s.', f, li); END IF;
      END LOOP;
      basis:=CASE WHEN jsonb_typeof(line->'basis')='string' THEN line->>'basis' END;
      IF basis IS NULL OR NOT (basis = ANY(ARRAY['closed_cash','closed_contract','set_cash','set_contract','per_intro_shown','per_demo_shown',
        'per_signed','mrr_managed','per_qualified_intro_shown','per_closed_deal','per_client_appt_shown','per_client_deal_closed'])) THEN
        RETURN format('Commission line %s has an unknown basis.', li);
      END IF;
      x:=public.cockpit_pay_num(line->'rate');
      IF basis IN ('closed_cash','closed_contract','set_cash','set_contract','mrr_managed') THEN
        IF x IS NULL OR x NOT BETWEEN 0 AND 1 THEN RETURN format('Commission line %s needs a rate from 0 to 1.', li); END IF;
      ELSIF x IS NULL OR x NOT BETWEEN 0 AND 100000 THEN RETURN format('Commission line %s needs a rate from 0 to 100,000.', li);
      END IF;
      IF basis = ANY(bases) THEN RETURN 'The two commission lines need different bases.'; END IF;
      bases:=bases||basis;
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

/**
 * {index, amount} of the band a value falls in. Rounds first (money and
 * percent to 2 places, half away from zero), then the first band with a
 * number upTo and inclusive ? v <= upTo : v < upTo, else the last band.
 */
CREATE OR REPLACE FUNCTION public.cockpit_pay_band_pick(p_bands jsonb, p_value numeric)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE v numeric:=round(p_value,2); b jsonb; i int; n int; up numeric;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_bands) IS DISTINCT FROM 'array' OR jsonb_array_length(p_bands)=0 THEN RETURN NULL; END IF;
  n:=jsonb_array_length(p_bands);
  FOR b, i IN SELECT t.v, (t.o-1)::int FROM jsonb_array_elements(p_bands) WITH ORDINALITY AS t(v,o) ORDER BY t.o LOOP
    up:=public.cockpit_pay_num(b->'upTo');
    IF up IS NOT NULL AND ((b->'inclusive'='true'::jsonb AND v<=up) OR (b->'inclusive' IS DISTINCT FROM 'true'::jsonb AND v<up)) THEN
      RETURN jsonb_build_object('index',i,'amount',public.cockpit_pay_num(b->'amount'));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('index',n-1,'amount',public.cockpit_pay_num(p_bands->(n-1)->'amount'));
END;
$$;

/**
 * The plan a person follows in a month: their own (a person row with a plan),
 * else their role's (role matched lower(btrim()) on the role in force), else none.
 * {source:'own'|'role'|'none', planId, fromMonth, plan, role, follows}.
 */
CREATE OR REPLACE FUNCTION public.cockpit_pay_plan_for(p_person bigint, p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m0 date:=date_trunc('month',p_month)::date; own public.cockpit_pay_plans; rp public.cockpit_pay_plans; v_role text; v_follows boolean:=false;
BEGIN
  v_role:=public.cockpit_pay_role_at(p_person,m0);
  SELECT * INTO own FROM public.cockpit_pay_plans pl WHERE pl.person_id=p_person AND pl.from_month<=m0 ORDER BY pl.from_month DESC LIMIT 1;
  IF FOUND THEN
    IF own.plan IS NOT NULL THEN
      RETURN jsonb_build_object('source','own','planId',own.id,'fromMonth',own.from_month,'plan',own.plan,'role',v_role,'follows',false);
    END IF;
    v_follows:=true;
  END IF;
  IF v_role IS NOT NULL THEN
    SELECT * INTO rp FROM public.cockpit_pay_plans pl
      WHERE pl.role IS NOT NULL AND lower(btrim(pl.role))=lower(v_role) AND pl.from_month<=m0 ORDER BY pl.from_month DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('source','role','planId',rp.id,'fromMonth',rp.from_month,'plan',rp.plan,'role',rp.role,'follows',v_follows);
    END IF;
  END IF;
  RETURN jsonb_build_object('source','none','planId',NULL,'fromMonth',NULL,'plan',NULL,'role',v_role,'follows',v_follows);
END;
$$;

/**
 * The people of a pay month: not a bot; employed on at least one day of it
 * (cockpit_employment_periods, or ended_on/paused_on inside it); with a plan
 * or a commission line in force. Plus anyone approved or with an entry in it.
 * A leaver stays in the months they worked.
 */
CREATE OR REPLACE FUNCTION public.cockpit_pay_people_in(p_month date)
RETURNS SETOF bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH b AS (SELECT date_trunc('month',p_month)::date AS m0, (date_trunc('month',p_month)+interval '1 month -1 day')::date AS m1)
  SELECT p.id FROM public.cockpit_people p CROSS JOIN b
  WHERE p.engagement<>'bot'
    AND (EXISTS (SELECT 1 FROM public.cockpit_employment_periods e WHERE e.person_id=p.id AND e.kind='employed'
           AND e.from_day<=b.m1 AND (e.to_day IS NULL OR e.to_day>=greatest(b.m0,e.from_day)))
         OR p.ended_on BETWEEN b.m0 AND b.m1 OR p.paused_on BETWEEN b.m0 AND b.m1)
    AND ((public.cockpit_pay_plan_for(p.id,b.m0)->>'source')<>'none'
         OR EXISTS (SELECT 1 FROM public.cockpit_pay_lines_at(p.id,b.m0) l WHERE l.basis<>'none' OR l.basis2<>'none'))
  UNION
  SELECT m.person_id FROM public.cockpit_pay_months m CROSS JOIN b WHERE m.month=b.m0 AND m.status='approved'
  UNION
  SELECT e.person_id FROM public.cockpit_pay_entries e CROSS JOIN b WHERE e.month=b.m0 AND e.voided_at IS NULL
$$;

-- ---------------------------------------------------------------------------
-- 7. The month (section 6)

/**
 * Pooled cost per lead or per booking over a set of clients from the ads
 * facts (null set = every client), with an optional guard: clients under
 * minSpendUsd of all spend in the month drop out, the guarded facts' `after`
 * figures (days before creative start + excludeDays dropped) are pooled, and
 * fewer than minClients left is not_met. A client the facts could not measure
 * is named and left out, never counted as zero.
 */
CREATE OR REPLACE FUNCTION public.cockpit_pay_ads_pool(p_ads jsonb, p_metric text, p_set text[], p_guard jsonb, p_guarded jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE src jsonb; c jsonb; v jsonb; why text; exd numeric; mins numeric; minc numeric;
  num numeric:=0; den numeric:=0; nonlead numeric:=0; n int:=0; ids jsonb:='[]'::jsonb; outs jsonb:='[]'::jsonb;
BEGIN
  exd:=coalesce(public.cockpit_pay_num(p_guard->'excludeDays'),0);
  src:=CASE WHEN p_guard IS NOT NULL AND exd>0 THEN p_guarded ELSE p_ads END;
  IF jsonb_typeof(src) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('state','missing','note','The ad figures could not be read.');
  END IF;
  mins:=coalesce(public.cockpit_pay_num(p_guard->'minSpendUsd'),0);
  minc:=coalesce(public.cockpit_pay_num(p_guard->'minClients'),1);
  FOR c IN SELECT x FROM jsonb_array_elements(coalesce(src->'clients','[]'::jsonb)) x LOOP
    CONTINUE WHEN p_set IS NOT NULL AND NOT (coalesce(c->>'clickupId','') = ANY(p_set));
    why:=c->'notMeasured'->>p_metric;
    IF why IS NOT NULL THEN
      outs:=outs||jsonb_build_array(jsonb_build_object('clickupId',c->'clickupId','name',c->'name','why',why)); CONTINUE;
    END IF;
    IF p_guard IS NOT NULL AND coalesce(public.cockpit_pay_num(c->'spendUsd'),0)<mins THEN
      outs:=outs||jsonb_build_array(jsonb_build_object('clickupId',c->'clickupId','name',c->'name',
        'why',format('spent %s in the month, under %s', public.cockpit_pay_money(coalesce(public.cockpit_pay_num(c->'spendUsd'),0)), public.cockpit_pay_money(mins))));
      CONTINUE;
    END IF;
    v:=CASE WHEN p_guard IS NOT NULL AND exd>0 THEN coalesce(c->'after',c) ELSE c END;
    IF p_metric='cpl' THEN
      num:=num+coalesce(public.cockpit_pay_num(v->'leadSpendUsd'),0); den:=den+coalesce(public.cockpit_pay_num(v->'leads'),0);
    ELSE
      num:=num+coalesce(public.cockpit_pay_num(v->'spendUsd'),0); den:=den+coalesce(public.cockpit_pay_num(v->'bookings'),0);
    END IF;
    nonlead:=nonlead+coalesce(public.cockpit_pay_num(c->'nonLeadSpendUsd'),0);
    n:=n+1; ids:=ids||jsonb_build_array(c->'clickupId');
  END LOOP;
  IF p_set IS NOT NULL THEN
    outs:=outs||coalesce((SELECT jsonb_agg(jsonb_build_object('clickupId',s,'name',NULL,'why','no ad figures this month') ORDER BY s)
      FROM unnest(p_set) s
      WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(src->'clients','[]'::jsonb)) x WHERE x->>'clickupId'=s)),'[]'::jsonb);
  END IF;
  IF p_guard IS NOT NULL AND n<minc THEN
    RETURN jsonb_build_object('state','not_met','left',n,'clients',ids,'out',outs,
      'note',format('%s client%s left after the guard; the bonus needs %s.', n, CASE WHEN n=1 THEN '' ELSE 's' END, minc));
  END IF;
  IF den=0 THEN
    RETURN jsonb_build_object('state','missing','left',n,'clients',ids,'out',outs,
      'note',CASE WHEN p_metric='cpl' THEN 'No Meta leads over these clients this month.' ELSE 'No confirmed bookings over these clients this month.' END);
  END IF;
  RETURN jsonb_build_object('state','measured','value',round(num/den,2),'spendUsd',round(num,2),'count',den,'left',n,'clients',ids,'out',outs,
    'nonLeadSpendUsd',round(nonlead,2));
END;
$$;

/**
 * The input of a band part for a person and month (section 4):
 * {value, unit, state, source, note, proposal, clients, out}. value is
 * already rounded to 2 places; state is measured, confirmed, missing or not_met.
 * A cost-per-lead or cost-per-booking part also carries `alsoTracked`: the
 * other money metric over the same clients and guard ({metric, over, value,
 * state, note}), tracked and never paid on. A part read from a stored
 * confirmation carries it as `confirmed`, so "Change" starts from it.
 */
CREATE OR REPLACE FUNCTION public.cockpit_pay_band_input(p_person bigint, p_name text, p_month date, p_part jsonb, p_facts jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m0 date:=date_trunc('month',p_month)::date; prior date:=(date_trunc('month',p_month)-interval '1 month')::date;
  mname text:=public.cockpit_hours_month_name(date_trunc('month',p_month)::date); metric text:=p_part->>'metric';
  cov text:=coalesce(p_part->>'covers','all_clients'); g jsonb:=p_part->'guard'; conf jsonb; owned text[]; pool jsonb; pooled jsonb;
  ads jsonb:=p_facts->'ads'; row jsonb; v numeric; lost numeric; act numeric; unit text; src text; guarded jsonb;
  other text; av numeric; alt jsonb; also jsonb; res jsonb;
BEGIN
  IF metric IN ('cpl','cpb') THEN
    unit:='usd'; other:=CASE WHEN metric='cpl' THEN 'cpb' ELSE 'cpl' END;
    IF cov='owned_creative' THEN
      src:='owned_creative:'||p_person;
      conf:=public.cockpit_pay_confirmed(m0,src);
      IF conf IS NULL THEN
        row:=(SELECT x FROM jsonb_array_elements(coalesce(p_facts->'clients'->'ownedCreative','[]'::jsonb)) x WHERE x->>'personId'=p_person::text LIMIT 1);
        RETURN jsonb_build_object('value',NULL,'unit',unit,'state','missing','source',src,
          'note',format('Confirm the clients whose running creative %s owns in %s.', p_name, mname),
          'proposal',jsonb_build_object('clients',coalesce(row->'clients','[]'::jsonb),'others',coalesce(row->'others','[]'::jsonb),
            'carried',coalesce(public.cockpit_pay_confirmed(prior,src)->'clients','[]'::jsonb)));
      END IF;
      owned:=ARRAY(SELECT jsonb_array_elements_text(coalesce(conf->'clients','[]'::jsonb)));
    END IF;
    IF g IS NULL AND owned IS NULL THEN
      -- Every client in the month: the facts' own pooled figure (ratio of sums).
      IF jsonb_typeof(ads) IS DISTINCT FROM 'object' THEN
        RETURN jsonb_build_object('value',NULL,'unit',unit,'state','missing','source','cockpit_pay_facts_ads','note','The ad figures could not be read.');
      END IF;
      pooled:=ads->'pooled';
      -- The other money metric over the same pool: tracked beside it, never paid on.
      av:=public.cockpit_pay_num(pooled->other);
      IF coalesce(public.cockpit_pay_num(pooled->CASE WHEN other='cpl' THEN 'leads' ELSE 'bookings' END),0)=0 OR av IS NULL THEN av:=NULL; END IF;
      also:=jsonb_build_object('metric',other,'over','every_client','value',round(av,2),'state',CASE WHEN av IS NULL THEN 'missing' ELSE 'measured' END,
        'note',CASE WHEN av IS NOT NULL THEN NULL WHEN other='cpl' THEN 'No client had Meta leads this month.' ELSE 'No confirmed bookings with spend this month.' END);
      IF metric='cpl' THEN
        v:=public.cockpit_pay_num(pooled->'cpl');
        IF coalesce(public.cockpit_pay_num(pooled->'leads'),0)=0 OR v IS NULL THEN
          res:=jsonb_build_object('value',NULL,'unit',unit,'state','missing','source','cockpit_pay_facts_ads','note','No client had Meta leads this month.',
            'out',coalesce(pooled->'outOfCpl','[]'::jsonb));
        ELSE
          res:=jsonb_build_object('value',round(v,2),'unit',unit,'state','measured','source','cockpit_pay_facts_ads',
            'note',format('Lead-campaign spend %s / %s Meta leads over %s clients; %s spent outside lead campaigns, not counted.',
              public.cockpit_pay_money(public.cockpit_pay_num(pooled->'leadSpendUsd')), public.cockpit_pay_num(pooled->'leads'),
              coalesce(public.cockpit_pay_count(pooled->'clients')::text,'?'), public.cockpit_pay_money(public.cockpit_pay_num(pooled->'nonLeadSpendUsd'))),
            'clients',coalesce((SELECT jsonb_agg(x->'clickupId') FROM jsonb_array_elements(coalesce(ads->'clients','[]'::jsonb)) x
              WHERE x->'notMeasured'->>'cpl' IS NULL AND coalesce(public.cockpit_pay_num(x->'leads'),0)>0),'[]'::jsonb),
            'out',coalesce(pooled->'outOfCpl','[]'::jsonb),'nonLeadSpendUsd',pooled->'nonLeadSpendUsd');
        END IF;
      ELSE
        v:=public.cockpit_pay_num(pooled->'cpb');
        IF coalesce(public.cockpit_pay_num(pooled->'bookings'),0)=0 OR v IS NULL THEN
          res:=jsonb_build_object('value',NULL,'unit',unit,'state','missing','source','cockpit_pay_facts_ads','note','No confirmed bookings with spend this month.',
            'out',coalesce(pooled->'outOfCpb','[]'::jsonb));
        ELSE
          res:=jsonb_build_object('value',round(v,2),'unit',unit,'state','measured','source','cockpit_pay_facts_ads',
            'note',format('All spend %s / %s confirmed bookings over %s clients.', public.cockpit_pay_money(public.cockpit_pay_num(pooled->'spendUsd')),
              public.cockpit_pay_num(pooled->'bookings'), coalesce(public.cockpit_pay_count(pooled->'cpbClients')::text,'?')),
            'clients',coalesce((SELECT jsonb_agg(x->'clickupId') FROM jsonb_array_elements(coalesce(ads->'clients','[]'::jsonb)) x
              WHERE x->'notMeasured'->>'cpb' IS NULL AND coalesce(public.cockpit_pay_num(x->'bookings'),0)>0),'[]'::jsonb),
            'out',coalesce(pooled->'outOfCpb','[]'::jsonb));
        END IF;
      END IF;
      RETURN res||jsonb_build_object('alsoTracked',also);
    END IF;
    guarded:=p_facts->'adsGuarded'->(coalesce(public.cockpit_pay_num(g->'excludeDays'),0)::int::text);
    pool:=public.cockpit_pay_ads_pool(ads,metric,owned,g,guarded);
    -- The other money metric over the same clients and guard, so a switch can be judged before it is made.
    alt:=public.cockpit_pay_ads_pool(ads,other,owned,g,guarded);
    also:=jsonb_build_object('metric',other,'over','same','value',alt->'value','state',alt->>'state','note',alt->>'note');
    RETURN jsonb_build_object('value',pool->'value','unit',unit,'state',pool->>'state',
      'source',CASE WHEN owned IS NULL THEN 'cockpit_pay_facts_ads' ELSE 'owned_creative:'||p_person END,
      'note',coalesce(pool->>'note',format('%s %s / %s %s over %s client%s%s.',
        CASE WHEN metric='cpl' THEN 'Lead-campaign spend' ELSE 'All spend' END, public.cockpit_pay_money(public.cockpit_pay_num(pool->'spendUsd')),
        pool->>'count', CASE WHEN metric='cpl' THEN 'Meta leads' ELSE 'confirmed bookings' END, pool->>'left',
        CASE WHEN pool->>'left'='1' THEN '' ELSE 's' END,
        CASE WHEN g IS NOT NULL AND coalesce(public.cockpit_pay_num(g->'excludeDays'),0)>0
          THEN format(', the first %s days after each creative start left out', public.cockpit_pay_num(g->'excludeDays')) ELSE '' END)),
      'clients',coalesce(pool->'clients','[]'::jsonb),'out',coalesce(pool->'out','[]'::jsonb),'nonLeadSpendUsd',pool->'nonLeadSpendUsd',
      'alsoTracked',also)
      || CASE WHEN owned IS NOT NULL THEN jsonb_build_object('confirmed',conf) ELSE '{}'::jsonb END;

  ELSIF metric='logo_churn_prior' THEN
    conf:=public.cockpit_pay_confirmed(prior,'logo_churn');
    IF conf IS NULL THEN
      RETURN jsonb_build_object('value',NULL,'unit','pct','state','missing','source','logo_churn',
        'note',format('Confirm %s''s churn.', public.cockpit_hours_month_name(prior)),'proposal',p_facts->'clientsPrior'->'logo');
    END IF;
    lost:=public.cockpit_pay_num(conf->'lost'); act:=public.cockpit_pay_num(conf->'activeAtStart');
    RETURN jsonb_build_object('value',round(lost*100/act,2),'unit','pct','state','confirmed','source','logo_churn',
      'note',format('%s of %s clients lost in %s (confirmed).', lost, act, public.cockpit_hours_month_name(prior)),'clients',coalesce(conf->'clients','[]'::jsonb),
      'confirmed',conf);

  ELSE -- csm_churn
    src:='csm_churn:'||p_person;
    conf:=public.cockpit_pay_confirmed(m0,src);
    IF conf IS NOT NULL THEN
      lost:=public.cockpit_pay_num(conf->'lost'); act:=public.cockpit_pay_num(conf->'activeAtStart');
      RETURN jsonb_build_object('value',round(lost*100/act,2),'unit','pct','state','confirmed','source',src,
        'note',format('%s of %s clients in the book lost mid-programme in %s (confirmed).', lost, act, mname),'clients',coalesce(conf->'clients','[]'::jsonb),
        'confirmed',conf);
    END IF;
    row:=(SELECT x FROM jsonb_array_elements(coalesce(p_facts->'clients'->'byCsm','[]'::jsonb)) x WHERE x->>'personId'=p_person::text LIMIT 1);
    IF row IS NULL OR (coalesce(public.cockpit_pay_count(row->'startSet'),0)=0 AND coalesce(public.cockpit_pay_count(row->'qualifying'->'clients'),0)=0
        AND coalesce(public.cockpit_pay_num(row->'qualifying'->'upperBound'),0)=0) THEN
      RETURN jsonb_build_object('value',NULL,'unit','pct','state','missing','source',src,
        'note',CASE WHEN jsonb_typeof(p_facts->'clients') IS DISTINCT FROM 'object' THEN 'The client figures could not be read.'
          ELSE format('No client card names %s as CSM.', p_name) END);
    END IF;
    RETURN jsonb_build_object('value',NULL,'unit','pct','state','missing','source',src,
      'note',format('Confirm %s''s churn for %s''s book.', mname, p_name),'proposal',row);
  END IF;
END;
$$;

/**
 * One person's month, freshly computed (section 6). Missing is never zero:
 * an unknown input leaves the part's amount null with a sentence, and the
 * total stays null until nothing is missing or waiting and the base is known.
 */
CREATE OR REPLACE FUNCTION public.cockpit_pay_person(p_person bigint, p_month date, p_facts jsonb, p_today date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE
  m0 date:=date_trunc('month',p_month)::date;
  m1 date:=(date_trunc('month',p_month)+interval '1 month -1 day')::date;
  mdays numeric:=extract(day FROM (date_trunc('month',p_month)+interval '1 month -1 day'))::numeric;
  mname text:=public.cockpit_hours_month_name(date_trunc('month',p_month)::date);
  pr public.cockpit_people; v_role text; pinfo jsonb; v_plan jsonb;
  b1 text; r1 numeric; b2 text; r2 numeric; i int; v_basis text; v_rate numeric;
  v_cur text; v_per numeric; hp public.cockpit_hours_pay_months; v_cost numeric; v_base jsonb; base_usd numeric;
  lines jsonb:='[]'::jsonb; parts jsonb:='[]'::jsonb; line jsonb; part jsonb; floor_part jsonb;
  missing text[]:='{}'; not_priced text[]:='{}'; has_missing boolean:=false; has_waiting boolean:=false; any_priced boolean:=false;
  known numeric:=0; lowest numeric:=0; total numeric; commission_usd numeric; parts_usd numeric:=0;
  calls jsonb:=p_facts->'calls'; sales jsonb:=p_facts->'sales';
  agent jsonb; spp jsonb; book jsonb; c jsonb; conf jsonb; inp jsonb; pick jsonb;
  qty numeric; amt numeric; cash numeric; w jsonb; ev jsonb; pays jsonb;
  pk text; kind text; lbl text; st text; minband numeric; over numeric;
  entries jsonb; reviews jsonb; e public.cockpit_pay_entries; rate numeric; pro numeric; csum numeric; ids jsonb;
  per_above_amt numeric:=0; per_above_missing boolean:=false;
  rc jsonb; diff int; status text; hash_src jsonb; v_note text; rs date; re date; fdays numeric; famt numeric;
  v_closed boolean:=p_today>=public.cockpit_pay_settle_day(date_trunc('month',p_month)::date);
  v_ledger text; v_who text; uk jsonb; uk_close jsonb:='[]'::jsonb; uk_set jsonb:='[]'::jsonb; uk_pif jsonb:='[]'::jsonb;
  priced jsonb:='[]'::jsonb; v_paused int:=0; v_paused_from date; v_paused_to date; v_full numeric; wd jsonb;
BEGIN
  SELECT * INTO pr FROM public.cockpit_people WHERE id=p_person;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Deal cash is read only from a written deal ledger: facts that cannot say so leave the cash lines and the
  -- paid-in-full part missing, never $0 (the Sales tile's rule).
  v_ledger:=CASE WHEN jsonb_typeof(sales) IS DISTINCT FROM 'object' THEN 'The deal figures could not be read.'
    WHEN sales->'cashThrough' IS NULL OR sales->'cashThrough'='null'::jsonb THEN 'The money refresh has not run: no deal cash is known yet.'
    WHEN sales->'ledgerReady' IS DISTINCT FROM 'true'::jsonb
      THEN 'The Money section was published before the deal ledger existed: no deal cash is known until the next money refresh.' END;
  -- Money credited to nobody because a name on the deal keys to nobody: it blocks every closer's or setter's month
  -- until the name is keyed, so it is never approved as $0.
  IF v_ledger IS NULL THEN
    uk:=(SELECT jsonb_agg(jsonb_build_object('responseId',d->'responseId','business',d->'business','name',u->'name','role',u->>'role',
          'cash',coalesce(public.cockpit_pay_num(d->'cashInMonth'),0)<>0,
          'nobodySet',d->'setter'->>'personId' IS NULL AND d->'setter'->'disagree'->'form'->>'personId' IS NULL
            AND d->'setter'->'disagree'->'intro'->>'personId' IS NULL,
          'pif',coalesce(d->'pif'->>'state' IN ('earned','waiting') AND left(d->'pif'->>'day',10) BETWEEN m0::text AND m1::text,false))
        ORDER BY u->>'responseId', u->>'role', u->>'name')
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(sales->'unkeyed')='array' THEN sales->'unkeyed' ELSE '[]'::jsonb END) u
      JOIN jsonb_array_elements(CASE WHEN jsonb_typeof(sales->'deals')='array' THEN sales->'deals' ELSE '[]'::jsonb END) d
        ON d->>'responseId'=u->>'responseId');
    uk_close:=coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(coalesce(uk,'[]'::jsonb)) x WHERE x->>'role'='closer' AND (x->'cash')::boolean),'[]'::jsonb);
    uk_set:=coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(coalesce(uk,'[]'::jsonb)) x
      WHERE x->>'role'='setter' AND (x->'cash')::boolean AND (x->'nobodySet')::boolean),'[]'::jsonb);
    uk_pif:=coalesce((SELECT jsonb_agg(x) FROM jsonb_array_elements(coalesce(uk,'[]'::jsonb)) x WHERE x->>'role'='closer' AND (x->'pif')::boolean),'[]'::jsonb);
  END IF;
  v_role:=public.cockpit_pay_role_at(p_person,m0);
  SELECT l.basis,l.rate,l.basis2,l.rate2 INTO b1,r1,b2,r2 FROM public.cockpit_pay_lines_at(p_person,m0) l;
  pinfo:=public.cockpit_pay_plan_for(p_person,m0);
  v_plan:=pinfo->'plan';

  -- Days of the month the person was paused (a paused period, or the roster's paused_on onward; both ends inclusive):
  -- the roster and Hours and pay hold those days' pay back, and so does this month.
  SELECT count(*)::int, min(g.d)::date, max(g.d)::date INTO v_paused, v_paused_from, v_paused_to
    FROM generate_series(m0::timestamp, m1::timestamp, interval '1 day') AS g(d)
    WHERE EXISTS (SELECT 1 FROM public.cockpit_employment_periods ep WHERE ep.person_id=p_person AND ep.kind='paused'
                    AND ep.from_day<=g.d::date AND (ep.to_day IS NULL OR ep.to_day>=g.d::date))
       OR (pr.paused_on IS NOT NULL AND pr.paused_on<=g.d::date);
  v_paused:=coalesce(v_paused,0);

  -- Base: the approved hours figure for the month (paused days already left out there), else the roster pay in force
  -- on its last day, less the paused days. The stored figures are never changed here.
  SELECT * INTO hp FROM public.cockpit_hours_pay_months h WHERE h.person_id=p_person AND h.month=m0 AND h.status IN ('approved','paid');
  IF FOUND AND hp.amount_usd IS NOT NULL THEN
    base_usd:=round(hp.amount_usd,2); v_cur:=hp.currency;
    v_base:=jsonb_build_object('usd',base_usd,'amount',hp.amount,'currency',hp.currency,'source','hours_approved');
  ELSE
    SELECT h.monthly_cost, h.currency INTO v_cost, v_cur FROM public.cockpit_pay_history h
      WHERE h.person_id=p_person AND h.effective_from<=m1 ORDER BY h.effective_from DESC LIMIT 1;
    IF NOT FOUND THEN v_cost:=pr.monthly_cost; v_cur:=pr.currency; END IF;
    v_per:=public.cockpit_pay_usd_per(v_cur);
    IF v_cost IS NULL OR v_per IS NULL THEN
      v_base:=jsonb_build_object('usd',NULL,'source','none','note',CASE WHEN v_cost IS NULL THEN 'No base set' ELSE 'No USD rate for '||v_cur END);
      missing:=missing||'No base set: set their pay on the roster (0 if they have none).'::text; has_missing:=true;
    ELSIF v_paused>0 THEN
      v_full:=round(v_cost*v_per,2);
      base_usd:=round(v_cost*v_per*(mdays-v_paused)/mdays,2);
      v_base:=jsonb_build_object('usd',base_usd,'amount',round(v_cost*(mdays-v_paused)/mdays,2),'currency',v_cur,'source','roster',
        'paused',jsonb_build_object('days',v_paused,'of',mdays,'from',v_paused_from,'to',v_paused_to,'fullUsd',v_full,'heldUsd',round(v_full-base_usd,2)));
    ELSE
      base_usd:=round(v_cost*v_per,2);
      v_base:=jsonb_build_object('usd',base_usd,'amount',v_cost,'currency',v_cur,'source','roster');
    END IF;
  END IF;
  v_cur:=coalesce(v_cur,pr.currency,'USD');
  v_per:=public.cockpit_pay_usd_per(v_cur);
  known:=coalesce(base_usd,0);

  -- Commission lines in force on the month's last day.
  FOR i IN 1..2 LOOP
    v_basis:=CASE i WHEN 1 THEN b1 ELSE b2 END; v_rate:=CASE i WHEN 1 THEN r1 ELSE r2 END;
    CONTINUE WHEN v_basis IS NULL OR v_basis='none';
    line:=jsonb_build_object('line',i,'basis',v_basis,'rate',v_rate);
    IF v_basis IN ('per_client_appt_shown','per_client_deal_closed') THEN
      any_priced:=true;
      IF jsonb_typeof(calls) IS DISTINCT FROM 'object' THEN
        line:=line||jsonb_build_object('quantity',NULL,'baseUsd',NULL,'amountUsd',NULL,'state','missing','note','The call centre figures could not be read.','evidence','[]'::jsonb);
        missing:=missing||format('Line %s: the call centre figures could not be read.', i); has_missing:=true;
      ELSIF v_rate IS NULL OR v_per IS NULL THEN
        line:=line||jsonb_build_object('quantity',NULL,'baseUsd',NULL,'amountUsd',NULL,'state','missing','note','This line has no rate.','evidence','[]'::jsonb);
        missing:=missing||format('Line %s has no rate: set it on the roster.', i); has_missing:=true;
      ELSIF nullif(btrim(pr.email),'') IS NULL
         OR (SELECT count(*) FROM public.cockpit_people q WHERE lower(btrim(q.email))=lower(btrim(pr.email)))>1 THEN
        -- The facts credit a meeting through one roster email: without a unique one nothing can reach them, so 0 is not known.
        v_who:=CASE WHEN nullif(btrim(pr.email),'') IS NULL THEN format('%s has no email on the roster', pr.name)
          ELSE format('%s shares an email with someone else on the roster', pr.name) END;
        line:=line||jsonb_build_object('quantity',NULL,'baseUsd',NULL,'amountUsd',NULL,'state','missing',
          'note',v_who||', so no meeting can be credited to them.','evidence','[]'::jsonb);
        missing:=missing||format('Line %s: %s, so no meeting can be credited to them. Set the email they book with.', i, v_who); has_missing:=true;
      ELSE
        agent:=(SELECT x FROM jsonb_array_elements(coalesce(calls->'agents','[]'::jsonb)) x WHERE x->>'personId'=p_person::text LIMIT 1);
        IF v_basis='per_client_appt_shown' THEN
          qty:=coalesce(public.cockpit_pay_num(agent->'shows'),0);
          amt:=round(qty*v_rate*v_per,2);
          line:=line||jsonb_build_object('quantity',qty,'baseUsd',NULL,'amountUsd',amt,'state','measured',
            'note',CASE WHEN coalesce(public.cockpit_pay_num(agent->'unmarked'),0)>0
              THEN format('%s shows credited to them; %s meetings not marked yet, not counted.', qty, public.cockpit_pay_num(agent->'unmarked'))
              ELSE format('%s shows credited to them.', qty) END,
            'unmarked',coalesce(public.cockpit_pay_num(agent->'unmarked'),0),
            'evidence',CASE WHEN jsonb_typeof(agent->'showIds')='array' THEN agent->'showIds' ELSE '[]'::jsonb END);
          known:=known+amt;
          priced:=priced||jsonb_build_array(jsonb_build_object('basis',v_basis,'amt',amt,'per',qty*v_per));
        ELSE
          qty:=0; ev:='[]'::jsonb; w:='[]'::jsonb;
          -- One close per (client, contact) a month; a portal win confirms it, a sheet-only close needs close:<appointmentId>.
          FOR c IN SELECT DISTINCT ON (coalesce(x->>'locationId',''), coalesce(x->>'contactId',x->>'appointmentId')) x
              FROM jsonb_array_elements(coalesce(agent->'closes','[]'::jsonb)) x
              ORDER BY coalesce(x->>'locationId',''), coalesce(x->>'contactId',x->>'appointmentId'), (x->>'evidence'='portal') DESC, x->>'meetingAt' LOOP
            IF c->>'evidence'='portal' THEN
              qty:=qty+1; ev:=ev||jsonb_build_array(c->'appointmentId');
            ELSE
              conf:=public.cockpit_pay_confirmed(m0,'close:'||(c->>'appointmentId'));
              IF conf IS NULL THEN
                w:=w||jsonb_build_array(jsonb_build_object('appointmentId',c->'appointmentId','client',c->'client','meetingAt',c->'meetingAt'));
              ELSIF conf->'confirmed'='true'::jsonb THEN
                qty:=qty+1; ev:=ev||jsonb_build_array(c->'appointmentId');
              END IF;
            END IF;
          END LOOP;
          amt:=round(qty*v_rate*v_per,2);
          IF jsonb_array_length(w)>0 THEN
            line:=line||jsonb_build_object('quantity',qty,'baseUsd',NULL,'amountUsd',amt,'state','waiting','waiting',w,'evidence',ev,
              'note',format('%s %s on the client sheet only %s for your confirmation.', jsonb_array_length(w),
                CASE WHEN jsonb_array_length(w)=1 THEN 'close' ELSE 'closes' END, CASE WHEN jsonb_array_length(w)=1 THEN 'waits' ELSE 'wait' END));
            missing:=missing||format('Closed client deals: %s %s for your confirmation.', jsonb_array_length(w),
              CASE WHEN jsonb_array_length(w)=1 THEN 'close waits' ELSE 'closes wait' END);
            -- What is settled is known; a waiting close can only add to it.
            has_waiting:=true; known:=known+amt;
          ELSE
            line:=line||jsonb_build_object('quantity',qty,'baseUsd',NULL,'amountUsd',amt,'state','measured','evidence',ev,
              'note',format('%s confirmed client close%s.', qty, CASE WHEN qty=1 THEN '' ELSE 's' END));
            known:=known+amt;
          END IF;
          priced:=priced||jsonb_build_array(jsonb_build_object('basis',v_basis,'amt',amt,'per',qty*v_per));
        END IF;
      END IF;
    ELSIF v_basis IN ('closed_cash','set_cash') THEN
      any_priced:=true;
      IF v_ledger IS NOT NULL THEN
        line:=line||jsonb_build_object('quantity',NULL,'baseUsd',NULL,'amountUsd',NULL,'state','missing','note',v_ledger,'evidence','[]'::jsonb);
        missing:=missing||format('Line %s: %s', i, lower(left(v_ledger,1))||substr(v_ledger,2)); has_missing:=true;
      ELSIF v_rate IS NULL THEN
        line:=line||jsonb_build_object('quantity',NULL,'baseUsd',NULL,'amountUsd',NULL,'state','missing','note','This line has no rate.','evidence','[]'::jsonb);
        missing:=missing||format('Line %s has no rate: set it on the roster.', i); has_missing:=true;
      ELSE
        spp:=(SELECT x FROM jsonb_array_elements(coalesce(sales->'people','[]'::jsonb)) x WHERE x->>'personId'=p_person::text LIMIT 1);
        cash:=coalesce(public.cockpit_pay_num(spp->CASE WHEN v_basis='closed_cash' THEN 'closedCashUsd' ELSE 'setCashUsd' END),0);
        amt:=round(cash*v_rate,2);
        ev:=coalesce((SELECT jsonb_agg(d->'responseId' ORDER BY d->>'responseId') FROM jsonb_array_elements(coalesce(sales->'deals','[]'::jsonb)) d
          WHERE d->(CASE WHEN v_basis='closed_cash' THEN 'closer' ELSE 'setter' END)->>'personId'=p_person::text
            AND coalesce(public.cockpit_pay_num(d->'cashInMonth'),0)<>0),'[]'::jsonb);
        pays:=coalesce((SELECT jsonb_agg(pm->'paymentId' ORDER BY pm->>'paymentId') FROM jsonb_array_elements(coalesce(sales->'deals','[]'::jsonb)) d
          CROSS JOIN LATERAL jsonb_array_elements(coalesce(d->'payments','[]'::jsonb)) pm
          WHERE d->(CASE WHEN v_basis='closed_cash' THEN 'closer' ELSE 'setter' END)->>'personId'=p_person::text
            AND left(pm->>'day',10) BETWEEN m0::text AND m1::text),'[]'::jsonb);
        IF v_basis='set_cash' AND coalesce(public.cockpit_pay_count(spp->'setWaiting'),0)>0 THEN
          -- Each deal waiting for its setter, as the receipt asks about it: the business, and who the form and the intro name
          -- (both null when nobody on record set it and it waits on its closer).
          wd:=coalesce((SELECT jsonb_agg(jsonb_build_object('responseId',x.rid,'business',dd.d->'business','state',dd.d->'setter'->'state',
                'form',dd.d->'setter'->'disagree'->'form'->'name','intro',dd.d->'setter'->'disagree'->'intro'->'name') ORDER BY x.rid)
            FROM (SELECT CASE WHEN jsonb_typeof(y)='object' THEN y->>'responseId' ELSE y#>>'{}' END AS rid
                    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(spp->'setWaiting')='array' THEN spp->'setWaiting' ELSE '[]'::jsonb END) y) x
            LEFT JOIN LATERAL (SELECT z AS d FROM jsonb_array_elements(coalesce(sales->'deals','[]'::jsonb)) z WHERE z->>'responseId'=x.rid LIMIT 1) dd ON true),'[]'::jsonb);
          line:=line||jsonb_build_object('quantity',NULL,'baseUsd',round(cash,2),'amountUsd',amt,'state','waiting','waiting',wd,'evidence',ev,'payments',pays,
            'note',format('%s %s for you to confirm who set %s.', public.cockpit_pay_count(spp->'setWaiting'),
              CASE WHEN public.cockpit_pay_count(spp->'setWaiting')=1 THEN 'deal waits' ELSE 'deals wait' END,
              CASE WHEN public.cockpit_pay_count(spp->'setWaiting')=1 THEN 'it' ELSE 'them' END));
          missing:=missing||format('Set cash: %s %s for you to confirm who set %s.', public.cockpit_pay_count(spp->'setWaiting'),
            CASE WHEN public.cockpit_pay_count(spp->'setWaiting')=1 THEN 'deal waits' ELSE 'deals wait' END,
            CASE WHEN public.cockpit_pay_count(spp->'setWaiting')=1 THEN 'it' ELSE 'them' END);
          -- What is settled is known; a waiting deal can only add to it.
          has_waiting:=true; known:=known+amt;
        ELSE
          line:=line||jsonb_build_object('quantity',NULL,'baseUsd',round(cash,2),'amountUsd',amt,'state','measured','evidence',ev,'payments',pays,
            'note',format('%s cleared in %s on deals they %s.', public.cockpit_pay_money(cash), mname, CASE WHEN v_basis='closed_cash' THEN 'closed' ELSE 'set' END));
          known:=known+amt;
        END IF;
        -- Cash on a deal whose closer (or setter) keys to nobody is credited to nobody: the line waits until the name is keyed.
        uk:=CASE WHEN v_basis='closed_cash' THEN uk_close ELSE uk_set END;
        IF jsonb_array_length(uk)>0 THEN
          v_who:=format('%s %s with cash in %s %s a %s that matches nobody on the team list: %s.', jsonb_array_length(uk),
            CASE WHEN jsonb_array_length(uk)=1 THEN 'deal' ELSE 'deals' END, mname, CASE WHEN jsonb_array_length(uk)=1 THEN 'names' ELSE 'name' END,
            CASE WHEN v_basis='closed_cash' THEN 'closer' ELSE 'setter' END,
            (SELECT string_agg(format('%s (%s)', coalesce(x->>'business',x->>'responseId'), coalesce(x->>'name','no name')), ', ' ORDER BY x->>'responseId')
               FROM jsonb_array_elements(uk) x));
          line:=line||jsonb_build_object('state','waiting','unkeyed',uk,'note',concat_ws(' ',line->>'note',v_who));
          missing:=missing||format('%s: %s Add the name to a sales rep''s aliases, or the rep''s seat email to the roster.',
            CASE WHEN v_basis='closed_cash' THEN 'Closed cash' ELSE 'Set cash' END, v_who);
          has_waiting:=true;
        END IF;
        priced:=priced||jsonb_build_array(jsonb_build_object('basis',v_basis,'amt',amt,'per',cash));
      END IF;
    ELSE
      -- intros, demos, signed, contract value, MRR and "other": not measured here.
      line:=line||jsonb_build_object('quantity',NULL,'baseUsd',NULL,'amountUsd',NULL,'state','not_here','evidence','[]'::jsonb,
        'note','Not worked out here; Costs prices it from the plan.');
      not_priced:=not_priced||v_basis;
    END IF;
    lines:=lines||jsonb_build_array(line);
  END LOOP;

  -- The role plan's commission against the person's lines (decision 3).
  IF pinfo->>'source'='role' AND jsonb_typeof(v_plan->'commission')='array' AND jsonb_array_length(v_plan->'commission')>0 THEN
    SELECT count(*) INTO diff FROM (
      SELECT x->>'basis' AS basis, public.cockpit_pay_num(x->'rate') AS rate FROM jsonb_array_elements(v_plan->'commission') x) want
      FULL JOIN (SELECT b1 AS basis, r1 AS rate WHERE coalesce(b1,'none')<>'none' UNION ALL SELECT b2, r2 WHERE coalesce(b2,'none')<>'none') have
      ON have.basis=want.basis AND have.rate=want.rate
      WHERE have.basis IS NULL OR want.basis IS NULL;
    IF diff=0 THEN rc:=jsonb_build_object('matches',true);
    ELSE
      rc:=jsonb_build_object('matches',false,'lines',v_plan->'commission',
        'sentence',format('The %s plan pays %s; %s''s commission lines differ.', pinfo->>'role',
          (SELECT string_agg(public.cockpit_pay_line_words(t.v->>'basis',public.cockpit_pay_num(t.v->'rate')),' and ' ORDER BY t.o)
            FROM jsonb_array_elements(v_plan->'commission') WITH ORDINALITY AS t(v,o)),
          pr.name));
      missing:=missing||(rc->>'sentence'); has_missing:=true;
      -- The floor holds whichever lines win: a priced line counts at the lower of its own rate and the plan's
      -- (nothing when the plan has no such line); a plan line they lack can only add.
      lowest:=lowest-coalesce((SELECT sum(greatest(0,(x->>'amt')::numeric-coalesce(round((x->>'per')::numeric*public.cockpit_pay_num(pl.w->'rate'),2),0)))
        FROM jsonb_array_elements(priced) x
        LEFT JOIN LATERAL (SELECT y FROM jsonb_array_elements(v_plan->'commission') y WHERE y->>'basis'=x->>'basis' LIMIT 1) pl(w) ON true),0);
    END IF;
  END IF;

  -- Entries of the month.
  entries:=coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'partKey',x.part_key,'quantity',x.quantity,'cashUsd',x.cash_usd,'amountUsd',x.amount_usd,
      'engagementMonth',x.engagement_month,'client',x.client,'product',x.product,'clearedOn',x.cleared_on,'postedOn',x.posted_on,'cancelledOn',x.cancelled_on,
      'evidenceRef',x.evidence_ref,'evidence',x.evidence,'note',x.note,'fromMonth',x.from_month,'enteredBy',x.entered_by,'enteredAt',x.entered_at) ORDER BY x.id)
    FROM public.cockpit_pay_entries x WHERE x.person_id=p_person AND x.month=m0 AND x.voided_at IS NULL),'[]'::jsonb);

  -- Parts of the plan, in order; the floor is worked out last.
  FOR part IN SELECT t.v FROM jsonb_array_elements(coalesce(v_plan->'parts','[]'::jsonb)) WITH ORDINALITY AS t(v,o) ORDER BY t.o LOOP
    pk:=part->>'key'; kind:=part->>'kind'; lbl:=part->>'label'; pick:=NULL; amt:=NULL; inp:=NULL; ev:='[]'::jsonb; st:=NULL;
    any_priced:=true;
    IF kind='floor' THEN floor_part:=part; CONTINUE; END IF;
    IF kind='band' THEN
      inp:=public.cockpit_pay_band_input(p_person,pr.name,m0,part,p_facts);
      IF inp->>'state' IN ('measured','confirmed') THEN
        pick:=public.cockpit_pay_band_pick(part->'bands',public.cockpit_pay_num(inp->'value'));
        amt:=public.cockpit_pay_num(pick->'amount'); st:='known';
      ELSIF inp->>'state'='not_met' THEN
        amt:=0; st:='not_met';
      ELSE
        st:='missing';
      END IF;
      ev:=coalesce(inp->'clients','[]'::jsonb);
    ELSIF kind='per_event' AND part->>'event'='pif_deal_closed' THEN
      IF v_ledger IS NOT NULL THEN
        inp:=jsonb_build_object('value',NULL,'unit','count','state','missing','source','cockpit_pay_facts_sales','note',v_ledger);
        st:='missing';
      ELSE
        spp:=(SELECT x FROM jsonb_array_elements(coalesce(sales->'people','[]'::jsonb)) x WHERE x->>'personId'=p_person::text LIMIT 1);
        qty:=coalesce(public.cockpit_pay_count(spp->'pifDeals'),0);
        ev:=coalesce((SELECT jsonb_agg(CASE WHEN jsonb_typeof(x)='object' THEN x->'responseId' ELSE x END) FROM jsonb_array_elements(coalesce(spp->'pifDeals','[]'::jsonb)) x),'[]'::jsonb);
        amt:=round(qty*public.cockpit_pay_num(part->'amount'),2);
        IF coalesce(public.cockpit_pay_count(spp->'pifWaiting'),0)>0 THEN
          -- Each deal paid 90 to 99%, as the receipt asks about it: the business and what it is short of its contract.
          wd:=coalesce((SELECT jsonb_agg(jsonb_build_object('responseId',x.rid,'business',dd.d->'business','shortUsd',dd.d->'pif'->'shortUsd',
                'day',dd.d->'pif'->'day') ORDER BY x.rid)
            FROM (SELECT CASE WHEN jsonb_typeof(y)='object' THEN y->>'responseId' ELSE y#>>'{}' END AS rid
                    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(spp->'pifWaiting')='array' THEN spp->'pifWaiting' ELSE '[]'::jsonb END) y) x
            LEFT JOIN LATERAL (SELECT z AS d FROM jsonb_array_elements(coalesce(sales->'deals','[]'::jsonb)) z WHERE z->>'responseId'=x.rid LIMIT 1) dd ON true),'[]'::jsonb);
          inp:=jsonb_build_object('value',qty,'unit','count','state','waiting','source','cockpit_pay_facts_sales','waiting',wd,
            'note',format('%s %s paid 90 to 99%% %s for your confirmation.', public.cockpit_pay_count(spp->'pifWaiting'),
              CASE WHEN public.cockpit_pay_count(spp->'pifWaiting')=1 THEN 'deal' ELSE 'deals' END,
              CASE WHEN public.cockpit_pay_count(spp->'pifWaiting')=1 THEN 'waits' ELSE 'wait' END));
          st:='waiting';
        ELSE
          inp:=jsonb_build_object('value',qty,'unit','count','state','measured','source','cockpit_pay_facts_sales',
            'note',format('%s deal%s they closed reached paid in full in %s.', qty, CASE WHEN qty=1 THEN '' ELSE 's' END, mname));
          st:='known';
        END IF;
        -- A deal paid in full whose closer keys to nobody is nobody's bonus: it waits until the name is keyed.
        IF jsonb_array_length(uk_pif)>0 THEN
          inp:=inp||jsonb_build_object('state','waiting','unkeyed',uk_pif,'note',concat_ws(' ',inp->>'note',
            format('%s %s paid in full in %s %s a closer that matches nobody on the team list: %s. Add the name to a sales rep''s aliases, or the rep''s seat email to the roster.',
              jsonb_array_length(uk_pif), CASE WHEN jsonb_array_length(uk_pif)=1 THEN 'deal' ELSE 'deals' END, mname,
              CASE WHEN jsonb_array_length(uk_pif)=1 THEN 'names' ELSE 'name' END,
              (SELECT string_agg(format('%s (%s)', coalesce(x->>'business',x->>'responseId'), coalesce(x->>'name','no name')), ', ' ORDER BY x->>'responseId')
                 FROM jsonb_array_elements(uk_pif) x))));
          st:='waiting';
        END IF;
      END IF;
    ELSIF kind IN ('per_event','share') THEN
      ids:=coalesce((SELECT jsonb_agg(x->'id') FROM jsonb_array_elements(entries) x WHERE x->>'partKey'=pk),'[]'::jsonb);
      IF jsonb_array_length(ids)=0 THEN
        inp:=jsonb_build_object('value',NULL,'unit',CASE WHEN kind='share' THEN 'cash' ELSE 'count' END,'state','missing','source','cockpit_pay_entries',
          'note',CASE WHEN kind='share' THEN 'Waiting for the month''s cash.' ELSE 'Waiting for your count.' END);
        st:='missing';
      ELSIF kind='per_event' THEN
        qty:=(SELECT coalesce(sum(x.quantity),0) FROM public.cockpit_pay_entries x WHERE x.person_id=p_person AND x.month=m0 AND x.voided_at IS NULL AND x.part_key=pk);
        amt:=round(qty*public.cockpit_pay_num(part->'amount'),2);
        inp:=jsonb_build_object('value',qty,'unit','count','state','typed','source','cockpit_pay_entries',
          'note',format('%s typed for %s.', qty, mname));
        st:='known'; ev:=ids;
      ELSE
        amt:=0; csum:=0;
        FOR e IN SELECT * FROM public.cockpit_pay_entries x WHERE x.person_id=p_person AND x.month=m0 AND x.voided_at IS NULL AND x.part_key=pk ORDER BY x.id LOOP
          rate:=(SELECT public.cockpit_pay_num(s->'rate') FROM jsonb_array_elements(part->'steps') s
            WHERE public.cockpit_pay_num(s->'fromMonth')<=coalesce(e.engagement_month,1) ORDER BY public.cockpit_pay_num(s->'fromMonth') DESC LIMIT 1);
          pro:=CASE WHEN part->'prorateOnCancel'='true'::jsonb AND e.cancelled_on BETWEEN m0 AND m1
            THEN extract(day FROM e.cancelled_on)::numeric/mdays ELSE 1 END;
          amt:=amt+coalesce(e.cash_usd,0)*coalesce(rate,0)*pro;
          csum:=csum+coalesce(e.cash_usd,0);
        END LOOP;
        amt:=round(amt,2);
        inp:=jsonb_build_object('value',round(csum,2),'unit','cash','state','typed','source','cockpit_pay_entries',
          'note',format('%s typed for %s.', public.cockpit_pay_money(csum), mname));
        st:='known'; ev:=ids;
      END IF;
    ELSIF kind='per_above' THEN
      over:=public.cockpit_pay_num(part->'over');
      conf:=public.cockpit_pay_confirmed(m0,'qualifying:'||p_person);
      book:=(SELECT x FROM jsonb_array_elements(coalesce(p_facts->'clients'->'byCsm','[]'::jsonb)) x WHERE x->>'personId'=p_person::text LIMIT 1);
      IF conf IS NOT NULL THEN
        qty:=public.cockpit_pay_num(conf->'count');
        inp:=jsonb_build_object('value',qty,'unit','count','state','confirmed','source','qualifying:'||p_person,
          'note',format('%s qualifying clients (confirmed).', qty),'confirmed',conf,'proposal',book->'qualifying');
      ELSIF book IS NULL OR (coalesce(public.cockpit_pay_count(book->'startSet'),0)=0 AND coalesce(public.cockpit_pay_count(book->'qualifying'->'clients'),0)=0
          AND coalesce(public.cockpit_pay_num(book->'qualifying'->'upperBound'),0)=0) THEN
        qty:=NULL;
        inp:=jsonb_build_object('value',NULL,'unit','count','state','missing','source','cockpit_pay_facts_clients',
          'note',CASE WHEN jsonb_typeof(p_facts->'clients') IS DISTINCT FROM 'object' THEN 'The client figures could not be read.'
            ELSE format('No client card names %s as CSM.', pr.name) END);
      ELSIF public.cockpit_pay_num(book->'qualifying'->'upperBound')<=over THEN
        qty:=public.cockpit_pay_num(book->'qualifying'->'upperBound');
        inp:=jsonb_build_object('value',qty,'unit','count','state','measured','source','cockpit_pay_facts_clients',
          'note',format('At most %s clients qualify, so none over %s.', qty, over),'proposal',book->'qualifying');
      ELSE
        qty:=NULL;
        inp:=jsonb_build_object('value',NULL,'unit','count','state','missing','source','cockpit_pay_facts_clients',
          'note',format('Confirm how many of %s''s clients qualified in %s (at most %s).', pr.name, mname, public.cockpit_pay_num(book->'qualifying'->'upperBound')),
          'proposal',book->'qualifying');
      END IF;
      IF qty IS NULL THEN st:='missing'; per_above_missing:=true;
      ELSE
        amt:=round(greatest(0,qty-over)*public.cockpit_pay_num(part->'amount'),2); st:='known'; per_above_amt:=per_above_amt+amt;
        ev:=CASE WHEN jsonb_typeof(book->'qualifying'->'clients')='array' AND conf IS NULL THEN book->'qualifying'->'clients' ELSE '[]'::jsonb END;
      END IF;
    END IF;

    IF st='known' OR st='not_met' THEN known:=known+amt; parts_usd:=parts_usd+amt;
    ELSIF st='waiting' THEN
      -- What is settled is known; the waiting deals can only add to it.
      has_waiting:=true; known:=known+coalesce(amt,0); parts_usd:=parts_usd+coalesce(amt,0);
      missing:=missing||format('%s: %s', lbl, inp->>'note');
    ELSE
      has_missing:=true;
      missing:=missing||format('%s: %s', lbl, coalesce(inp->>'note','Waiting for your count.'));
      IF kind='band' THEN
        minband:=(SELECT min(public.cockpit_pay_num(b->'amount')) FROM jsonb_array_elements(part->'bands') b);
        lowest:=lowest+least(0,coalesce(minband,0));
      END IF;
    END IF;
    parts:=parts||jsonb_build_array(jsonb_build_object('key',pk,'kind',kind,'label',lbl,'input',inp,
      'band',CASE WHEN pick IS NULL THEN NULL ELSE jsonb_build_object('index',pick->'index') END,
      'amountUsd',CASE WHEN st IN ('known','not_met','waiting') THEN amt END,'state',st,'evidence',ev));
  END LOOP;

  -- Adjustments (built in): signed USD amounts with a note.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(entries) x WHERE x->>'partKey'='adjustment') THEN
    amt:=round((SELECT sum(x.amount_usd) FROM public.cockpit_pay_entries x WHERE x.person_id=p_person AND x.month=m0 AND x.voided_at IS NULL AND x.part_key='adjustment'),2);
    ids:=(SELECT jsonb_agg(x->'id') FROM jsonb_array_elements(entries) x WHERE x->>'partKey'='adjustment');
    known:=known+amt; parts_usd:=parts_usd+amt; any_priced:=true;
    parts:=parts||jsonb_build_array(jsonb_build_object('key','adjustment','kind','adjustment','label','Adjustments',
      'input',jsonb_build_object('value',amt,'unit','usd','state','typed','source','cockpit_pay_entries','note',format('%s adjustment%s typed.', jsonb_array_length(ids),
        CASE WHEN jsonb_array_length(ids)=1 THEN '' ELSE 's' END)),
      'band',NULL,'amountUsd',amt,'state','known','evidence',ids));
  END IF;

  -- The floor (ramp guarantee): base + per_above against the amount, in months overlapping [start, start + days - 1].
  IF floor_part IS NOT NULL THEN
    pk:=floor_part->>'key'; lbl:=floor_part->>'label'; amt:=NULL; st:=NULL;
    famt:=public.cockpit_pay_num(floor_part->'amount'); fdays:=public.cockpit_pay_num(floor_part->'days');
    -- Paused days are not guaranteed either: the guarantee shrinks with the base it tops up.
    IF v_paused>0 AND famt IS NOT NULL THEN famt:=round(famt*(mdays-v_paused)/mdays,2); END IF;
    conf:=public.cockpit_pay_confirmed_any('ramp_start:'||p_person);
    IF conf IS NULL THEN
      st:='missing'; inp:=jsonb_build_object('value',NULL,'unit','usd','state','missing','source','ramp_start:'||p_person,'note','Type the contract start.');
    ELSE
      rs:=(conf->>'day')::date; re:=rs+(fdays::int)-1;
      IF re<m0 OR rs>m1 THEN
        amt:=0; st:='known';
        inp:=jsonb_build_object('value',NULL,'unit','usd','state','confirmed','source','ramp_start:'||p_person,'start',rs,'end',re,
          'note',format('Outside the ramp guarantee (%s to %s).', to_char(rs,'FMDD Mon YYYY'), to_char(re,'FMDD Mon YYYY')));
      ELSIF base_usd IS NULL THEN
        st:='missing'; inp:=jsonb_build_object('value',NULL,'unit','usd','state','missing','source','ramp_start:'||p_person,'start',rs,'end',re,
          'note','Set a base first: the guarantee compares it.');
      ELSIF base_usd>=famt THEN
        amt:=0; st:='known';
        inp:=jsonb_build_object('value',base_usd,'unit','usd','state','confirmed','source','ramp_start:'||p_person,'start',rs,'end',re,
          'note',format('Not needed: the base (%s) is above the guarantee (%s).', public.cockpit_pay_money(base_usd), public.cockpit_pay_money(famt)));
      ELSIF per_above_missing THEN
        st:='missing'; inp:=jsonb_build_object('value',NULL,'unit','usd','state','missing','source','ramp_start:'||p_person,'start',rs,'end',re,
          'note','Waiting for the qualifying count.');
      ELSE
        amt:=round(greatest(0,famt-(base_usd+per_above_amt)),2); st:='known';
        inp:=jsonb_build_object('value',base_usd+per_above_amt,'unit','usd','state','confirmed','source','ramp_start:'||p_person,'start',rs,'end',re,
          'note',format('Base %s + over-20 %s against the %s guarantee (%s to %s).', public.cockpit_pay_money(base_usd), public.cockpit_pay_money(per_above_amt),
            public.cockpit_pay_money(famt), to_char(rs,'FMDD Mon'), to_char(re,'FMDD Mon YYYY')));
      END IF;
    END IF;
    IF st='known' THEN known:=known+amt; parts_usd:=parts_usd+amt;
    ELSE has_missing:=true; missing:=missing||format('%s: %s', lbl, inp->>'note');
    END IF;
    parts:=parts||jsonb_build_array(jsonb_build_object('key',pk,'kind','floor','label',lbl,'input',inp,'band',NULL,
      'amountUsd',amt,'state',st,'evidence','[]'::jsonb));
  END IF;

  -- known: everything settled, waiting lines and parts included; lowest: known with every missing band at its worst
  -- (and a line the role plan pays less on at the plan's rate), so the floor is never above what is known.
  lowest:=known+lowest;
  total:=CASE WHEN NOT has_missing AND NOT has_waiting AND base_usd IS NOT NULL THEN known END;
  commission_usd:=(SELECT sum(public.cockpit_pay_num(l->'amountUsd')) FROM jsonb_array_elements(lines) l WHERE l->>'state' IN ('measured','waiting'));
  -- Nothing worked out here: never ready, so the receipt says why and what is paid instead.
  v_note:=CASE WHEN NOT any_priced THEN
    CASE WHEN v_plan IS NULL THEN 'None of their commission lines is worked out here, so this month is not approved here; their base is paid through Hours and pay.'
      ELSE 'Nothing on this pay plan is worked out here, so this month is not approved here; their base is paid through Hours and pay.' END END;
  status:=CASE WHEN has_missing THEN 'in_progress' WHEN has_waiting THEN 'waiting' WHEN NOT any_priced THEN 'in_progress'
    WHEN NOT v_closed THEN 'in_progress' ELSE 'ready' END;

  reviews:=coalesce((SELECT jsonb_agg(jsonb_build_object('entryId',x.id,'postedOn',x.posted_on,'checkBy',x.posted_on+30,'due',x.posted_on+30<=p_today) ORDER BY x.posted_on)
    FROM public.cockpit_pay_entries x
    WHERE x.person_id=p_person AND x.month=m0 AND x.voided_at IS NULL AND x.posted_on IS NOT NULL AND coalesce(x.quantity,0)>0
      AND x.part_key IN (SELECT y->>'key' FROM jsonb_array_elements(coalesce(v_plan->'parts','[]'::jsonb)) y WHERE y->>'event'='google_review')),'[]'::jsonb);

  -- The hash covers the paid inputs and amounts only: plan id, base, lines, part inputs and states, band indexes, entry ids.
  hash_src:=jsonb_build_object('personId',p_person,'month',m0,'planId',pinfo->'planId','baseUsd',base_usd,
    'commission',coalesce((SELECT jsonb_agg(jsonb_build_object('line',l->'line','basis',l->'basis','rate',l->'rate','quantity',l->'quantity',
      'baseUsd',l->'baseUsd','amountUsd',l->'amountUsd','state',l->'state') ORDER BY l->>'line') FROM jsonb_array_elements(lines) l),'[]'::jsonb),
    'parts',coalesce((SELECT jsonb_agg(jsonb_build_object('key',x->'key','value',x->'input'->'value','inputState',x->'input'->'state',
      'band',x->'band'->'index','amountUsd',x->'amountUsd','state',x->'state')) FROM jsonb_array_elements(parts) x),'[]'::jsonb),
    'entries',coalesce((SELECT jsonb_agg(x->'id' ORDER BY (x->>'id')::bigint) FROM jsonb_array_elements(entries) x),'[]'::jsonb),
    'totalUsd',total);

  RETURN jsonb_build_object('personId',pr.id,'name',pr.name,'role',v_role,'active',pr.active,'endedOn',pr.ended_on,'currency',v_cur,'base',v_base,
    'plan',jsonb_build_object('source',pinfo->>'source','planId',pinfo->'planId','fromMonth',pinfo->'fromMonth','role',pinfo->'role','follows',pinfo->'follows'),
    'roleCommission',rc,'commission',lines,'parts',parts,'entries',entries,'reviewsToCheck',reviews,
    'knownUsd',known,'lowestUsd',lowest,'totalUsd',total,'commissionUsd',commission_usd,'partsUsd',parts_usd,
    'missing',to_jsonb(missing),'notPriced',to_jsonb(not_priced),'note',v_note,
    'status',status,'approval',NULL,'sinceApproval',NULL,'resultHash',md5(hash_src::text));
END;
$$;

/**
 * The month for everyone, freshly computed (section 6), with the facts it
 * read. Approved people are swapped for their frozen result by
 * cockpit_ceo_pay_month; approval recomputes through here.
 */
CREATE OR REPLACE FUNCTION public.cockpit_pay_compute(p_month date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  m0 date:=date_trunc('month',p_month)::date;
  m1 date:=(date_trunc('month',p_month)+interval '1 month -1 day')::date;
  prior date:=(date_trunc('month',p_month)-interval '1 month')::date;
  v_today date:=public.cockpit_hours_kw_today(); v_settle date:=public.cockpit_pay_settle_day(date_trunc('month',p_month)::date);
  mname text:=public.cockpit_hours_month_name(date_trunc('month',p_month)::date);
  nname text:=public.cockpit_hours_month_name((date_trunc('month',p_month)+interval '1 month')::date);
  facts jsonb:='{}'::jsonb; errs jsonb:='{}'::jsonb; guarded jsonb:='{}'::jsonb; ex int; pid bigint;
  people jsonb:='[]'::jsonb; nap jsonb; notes text[]; k text;
BEGIN
  IF p_month IS NULL THEN RAISE EXCEPTION 'Choose a month' USING ERRCODE='22023'; END IF;
  -- Each facts function is read once; one that fails leaves its parts missing, with why.
  BEGIN facts:=facts||jsonb_build_object('calls',public.cockpit_pay_facts_calls(m0,m1));
  EXCEPTION WHEN others THEN facts:=facts||jsonb_build_object('calls',NULL); errs:=errs||jsonb_build_object('calls',SQLERRM); END;
  BEGIN facts:=facts||jsonb_build_object('ads',public.cockpit_pay_facts_ads(m0,m1,0));
  EXCEPTION WHEN others THEN facts:=facts||jsonb_build_object('ads',NULL); errs:=errs||jsonb_build_object('ads',SQLERRM); END;
  BEGIN facts:=facts||jsonb_build_object('clients',public.cockpit_pay_facts_clients(m0));
  EXCEPTION WHEN others THEN facts:=facts||jsonb_build_object('clients',NULL); errs:=errs||jsonb_build_object('clients',SQLERRM); END;
  BEGIN facts:=facts||jsonb_build_object('clientsPrior',public.cockpit_pay_facts_clients(prior));
  EXCEPTION WHEN others THEN facts:=facts||jsonb_build_object('clientsPrior',NULL); errs:=errs||jsonb_build_object('clientsPrior',SQLERRM); END;
  BEGIN facts:=facts||jsonb_build_object('sales',public.cockpit_pay_facts_sales(m0,m1));
  EXCEPTION WHEN others THEN facts:=facts||jsonb_build_object('sales',NULL); errs:=errs||jsonb_build_object('sales',SQLERRM); END;
  FOR ex IN SELECT DISTINCT public.cockpit_pay_num(g.part->'guard'->'excludeDays')::int
      FROM public.cockpit_pay_people_in(m0) AS pin(id)
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(public.cockpit_pay_plan_for(pin.id,m0)->'plan'->'parts','[]'::jsonb)) AS g(part)
      WHERE coalesce(public.cockpit_pay_num(g.part->'guard'->'excludeDays'),0)>0 LOOP
    BEGIN guarded:=guarded||jsonb_build_object(ex::text,public.cockpit_pay_facts_ads(m0,m1,ex));
    EXCEPTION WHEN others THEN guarded:=guarded||jsonb_build_object(ex::text,NULL); errs:=errs||jsonb_build_object('adsGuarded'||ex,SQLERRM); END;
  END LOOP;
  facts:=facts||jsonb_build_object('adsGuarded',guarded,'errors',errs);

  FOR pid IN SELECT pin.id FROM public.cockpit_pay_people_in(m0) AS pin(id) JOIN public.cockpit_people p ON p.id=pin.id ORDER BY p.name, p.id LOOP
    people:=people||jsonb_build_array(public.cockpit_pay_person(pid,m0,facts,v_today));
  END LOOP;

  -- Staff who worked in the month with no plan and no lines are named, not dropped.
  nap:=coalesce((SELECT jsonb_agg(jsonb_build_object('personId',p.id,'name',p.name,'role',public.cockpit_pay_role_at(p.id,m0),
      'why',CASE WHEN public.cockpit_pay_role_at(p.id,m0) IS NULL THEN 'No role on the roster'
        ELSE format('No pay plan for the role "%s"', public.cockpit_pay_role_at(p.id,m0)) END) ORDER BY p.name)
    FROM public.cockpit_people p
    WHERE p.engagement<>'bot' AND coalesce(public.cockpit_pay_role_at(p.id,m0),'') !~* '\mceo\M|founder|chief executive'
      AND (EXISTS (SELECT 1 FROM public.cockpit_employment_periods e WHERE e.person_id=p.id AND e.kind='employed'
             AND e.from_day<=m1 AND (e.to_day IS NULL OR e.to_day>=greatest(m0,e.from_day)))
           OR p.ended_on BETWEEN m0 AND m1)
      AND NOT EXISTS (SELECT 1 FROM public.cockpit_pay_people_in(m0) AS pin(id) WHERE pin.id=p.id)),'[]'::jsonb);

  notes:=ARRAY[format('Earned in %s, paid with %s''s payroll.', mname, nname)];
  IF v_today<v_settle THEN notes:=notes||format('Approve %s from %s.', mname, to_char(v_settle,'FMDD FMMonth')); END IF;
  FOR k IN SELECT jsonb_object_keys(errs) LOOP
    notes:=notes||format('The %s figures could not be read: %s', k, errs->>k);
  END LOOP;

  RETURN jsonb_build_object('month',m0,'today',v_today,'closed',v_today>=v_settle,'settleDay',v_settle,'facts',facts,
    'people',people,'notOnAPlan',nap,'notes',to_jsonb(notes));
END;
$$;

/**
 * What changed since approval: per line (by line and basis) and part (by
 * key), the frozen and the fresh figures and the evidence ids added or
 * removed. Null when nothing changed. A figure approved with an amount that
 * cannot be read now (missing, or no amount) is `unread`, never a change to
 * $0: it stays out of deltaUsd, and deltaUsd is null while anything is unread.
 */
CREATE OR REPLACE FUNCTION public.cockpit_pay_drift(p_frozen jsonb, p_now jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE ch jsonb:='[]'::jsonb; a jsonb; b jsonb; d numeric:=0; fa numeric; na numeric; k text; v_unread boolean; any_unread boolean:=false;
BEGIN
  IF p_now IS NULL THEN RETURN NULL; END IF;
  -- Lines
  FOR k IN SELECT DISTINCT (x->>'line')||':'||(x->>'basis') FROM (
      SELECT jsonb_array_elements(coalesce(p_frozen->'commission','[]'::jsonb)) x
      UNION ALL SELECT jsonb_array_elements(coalesce(p_now->'commission','[]'::jsonb))) u ORDER BY 1 LOOP
    b:=(SELECT x FROM jsonb_array_elements(coalesce(p_frozen->'commission','[]'::jsonb)) x WHERE (x->>'line')||':'||(x->>'basis')=k LIMIT 1);
    a:=(SELECT x FROM jsonb_array_elements(coalesce(p_now->'commission','[]'::jsonb)) x WHERE (x->>'line')||':'||(x->>'basis')=k LIMIT 1);
    fa:=public.cockpit_pay_num(b->'amountUsd'); na:=public.cockpit_pay_num(a->'amountUsd');
    IF fa IS DISTINCT FROM na OR public.cockpit_pay_num(b->'quantity') IS DISTINCT FROM public.cockpit_pay_num(a->'quantity')
       OR (b->>'state') IS DISTINCT FROM (a->>'state') THEN
      v_unread:=fa IS NOT NULL AND a IS NOT NULL AND (na IS NULL OR a->>'state'='missing');
      ch:=ch||jsonb_build_array(jsonb_build_object('what',coalesce(a->>'basis',b->>'basis'),'kind','line','line',coalesce(a->'line',b->'line'),
        'frozen',jsonb_build_object('quantity',b->'quantity','amountUsd',b->'amountUsd','state',b->'state'),
        'now',jsonb_build_object('quantity',a->'quantity','amountUsd',a->'amountUsd','state',a->'state'),'unread',v_unread,
        'items',CASE WHEN v_unread THEN jsonb_build_object('added','[]'::jsonb,'removed','[]'::jsonb) ELSE jsonb_build_object(
          'added',coalesce((SELECT jsonb_agg(y) FROM jsonb_array_elements(coalesce(a->'evidence','[]'::jsonb)) y WHERE NOT (coalesce(b->'evidence','[]'::jsonb) @> jsonb_build_array(y))),'[]'::jsonb),
          'removed',coalesce((SELECT jsonb_agg(y) FROM jsonb_array_elements(coalesce(b->'evidence','[]'::jsonb)) y WHERE NOT (coalesce(a->'evidence','[]'::jsonb) @> jsonb_build_array(y))),'[]'::jsonb)) END));
      IF v_unread THEN any_unread:=true; ELSE d:=d+coalesce(na,0)-coalesce(fa,0); END IF;
    END IF;
  END LOOP;
  -- Parts
  FOR k IN SELECT DISTINCT x->>'key' FROM (
      SELECT jsonb_array_elements(coalesce(p_frozen->'parts','[]'::jsonb)) x
      UNION ALL SELECT jsonb_array_elements(coalesce(p_now->'parts','[]'::jsonb))) u ORDER BY 1 LOOP
    b:=(SELECT x FROM jsonb_array_elements(coalesce(p_frozen->'parts','[]'::jsonb)) x WHERE x->>'key'=k LIMIT 1);
    a:=(SELECT x FROM jsonb_array_elements(coalesce(p_now->'parts','[]'::jsonb)) x WHERE x->>'key'=k LIMIT 1);
    fa:=public.cockpit_pay_num(b->'amountUsd'); na:=public.cockpit_pay_num(a->'amountUsd');
    IF fa IS DISTINCT FROM na OR public.cockpit_pay_num(b->'input'->'value') IS DISTINCT FROM public.cockpit_pay_num(a->'input'->'value')
       OR (b->>'state') IS DISTINCT FROM (a->>'state') THEN
      v_unread:=fa IS NOT NULL AND a IS NOT NULL AND (na IS NULL OR a->>'state'='missing');
      ch:=ch||jsonb_build_array(jsonb_build_object('what',coalesce(a->>'label',b->>'label'),'kind','part','key',k,
        'frozen',jsonb_build_object('value',b->'input'->'value','amountUsd',b->'amountUsd','state',b->'state'),
        'now',jsonb_build_object('value',a->'input'->'value','amountUsd',a->'amountUsd','state',a->'state'),'unread',v_unread,
        'items',CASE WHEN v_unread THEN jsonb_build_object('added','[]'::jsonb,'removed','[]'::jsonb) ELSE jsonb_build_object(
          'added',coalesce((SELECT jsonb_agg(y) FROM jsonb_array_elements(coalesce(a->'evidence','[]'::jsonb)) y WHERE NOT (coalesce(b->'evidence','[]'::jsonb) @> jsonb_build_array(y))),'[]'::jsonb),
          'removed',coalesce((SELECT jsonb_agg(y) FROM jsonb_array_elements(coalesce(b->'evidence','[]'::jsonb)) y WHERE NOT (coalesce(a->'evidence','[]'::jsonb) @> jsonb_build_array(y))),'[]'::jsonb)) END));
      IF v_unread THEN any_unread:=true; ELSE d:=d+coalesce(na,0)-coalesce(fa,0); END IF;
    END IF;
  END LOOP;
  -- Base
  fa:=public.cockpit_pay_num(p_frozen->'base'->'usd'); na:=public.cockpit_pay_num(p_now->'base'->'usd');
  IF fa IS DISTINCT FROM na THEN
    v_unread:=fa IS NOT NULL AND na IS NULL;
    ch:=ch||jsonb_build_array(jsonb_build_object('what','base','kind','base','frozen',jsonb_build_object('amountUsd',fa),'now',jsonb_build_object('amountUsd',na),
      'unread',v_unread,'items',jsonb_build_object('added','[]'::jsonb,'removed','[]'::jsonb)));
    IF v_unread THEN any_unread:=true; ELSE d:=d+coalesce(na,0)-coalesce(fa,0); END IF;
  END IF;
  IF jsonb_array_length(ch)=0 THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('deltaUsd',CASE WHEN NOT any_unread THEN round(d,2) END,'unread',any_unread,'changes',ch);
END;
$$;

/**
 * Would a confirmation change an approved person-month? The sentence that
 * refuses it, or null (section 4, "Confirmations and the month they affect").
 */
CREATE OR REPLACE FUNCTION public.cockpit_pay_confirm_refusal(p_month date, p_key text, p_value jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE m0 date:=date_trunc('month',p_month)::date; m1 date:=(date_trunc('month',p_month)+interval '1 month -1 day')::date;
  nxt date:=(date_trunc('month',p_month)+interval '1 month')::date; kind text:=split_part(p_key,':',1); ref text:=substr(p_key,length(split_part(p_key,':',1))+2);
  r record; old jsonb; d_old date; d_new date; lo date; hi date; facts jsonb; c jsonb; deal jsonb; who bigint[]; sm date; v_agent text;
BEGIN
  IF kind='logo_churn' THEN
    SELECT pm.month, p.name INTO r FROM public.cockpit_pay_months pm JOIN public.cockpit_people p ON p.id=pm.person_id
      WHERE pm.status='approved' AND pm.month=nxt AND coalesce(pm.result->'planJson'->'parts','[]'::jsonb) @> '[{"metric":"logo_churn_prior"}]'::jsonb
      ORDER BY p.name LIMIT 1;
    IF FOUND THEN
      RETURN format('%s is approved for %s, and it reads %s''s churn. Withdraw %s first.', public.cockpit_hours_month_name(nxt), r.name,
        public.cockpit_hours_month_name(m0), public.cockpit_hours_month_name(nxt));
    END IF;
  ELSIF kind IN ('csm_churn','qualifying','owned_creative') THEN
    SELECT pm.month, p.name INTO r FROM public.cockpit_pay_months pm JOIN public.cockpit_people p ON p.id=pm.person_id
      WHERE pm.status='approved' AND pm.month=m0 AND pm.person_id=ref::bigint;
    IF FOUND THEN RETURN format('%s is approved for %s. Withdraw it first to change this.', public.cockpit_hours_month_name(m0), r.name); END IF;
  ELSIF kind='ramp_start' THEN
    old:=public.cockpit_pay_confirmed_any(p_key);
    d_old:=(old->>'day')::date; d_new:=CASE WHEN p_value IS NOT NULL AND p_value<>'null'::jsonb THEN (p_value->>'day')::date END;
    lo:=date_trunc('month',least(coalesce(d_old,d_new),coalesce(d_new,d_old)))::date;
    hi:=greatest(coalesce(d_old,d_new),coalesce(d_new,d_old))+366;
    SELECT pm.month, p.name INTO r FROM public.cockpit_pay_months pm JOIN public.cockpit_people p ON p.id=pm.person_id
      WHERE pm.status='approved' AND pm.person_id=ref::bigint AND pm.month BETWEEN lo AND hi
        AND coalesce(pm.result->'planJson'->'parts','[]'::jsonb) @> '[{"kind":"floor"}]'::jsonb
      ORDER BY pm.month LIMIT 1;
    IF FOUND THEN
      RETURN format('%s is approved for %s with the ramp guarantee. Withdraw it first to change the start.', public.cockpit_hours_month_name(r.month), r.name);
    END IF;
  ELSIF kind='close' THEN
    BEGIN facts:=public.cockpit_pay_facts_calls(m0,m1);
    EXCEPTION WHEN others THEN RETURN 'The call centre figures could not be read, so the close cannot be checked. Try again later.'; END;
    SELECT a->>'personId' INTO v_agent FROM jsonb_array_elements(coalesce(facts->'agents','[]'::jsonb)) a
      CROSS JOIN LATERAL jsonb_array_elements(coalesce(a->'closes','[]'::jsonb)) cl WHERE cl->>'appointmentId'=ref LIMIT 1;
    IF NOT FOUND THEN
      IF p_value IS NULL OR p_value='null'::jsonb THEN RETURN NULL; END IF;
      RETURN format('There is no close with that appointment in %s''s call centre figures.', public.cockpit_hours_month_name(m0));
    END IF;
    SELECT pm.month, p.name INTO r FROM public.cockpit_pay_months pm JOIN public.cockpit_people p ON p.id=pm.person_id
      WHERE pm.status='approved' AND pm.month=m0 AND pm.person_id::text=v_agent;
    IF FOUND THEN RETURN format('%s is approved for %s. Withdraw it first to change this.', public.cockpit_hours_month_name(m0), r.name); END IF;
  ELSIF kind IN ('setter','pif') THEN
    -- Any approved month whose frozen evidence names the deal.
    SELECT pm.month, p.name INTO r FROM public.cockpit_pay_months pm JOIN public.cockpit_people p ON p.id=pm.person_id
      WHERE pm.status='approved' AND (jsonb_path_exists(pm.result,'$.commission[*].evidence[*] ? (@ == $r)',jsonb_build_object('r',ref))
        OR jsonb_path_exists(pm.result,'$.parts[*].evidence[*] ? (@ == $r)',jsonb_build_object('r',ref)))
      ORDER BY pm.month LIMIT 1;
    IF FOUND THEN RETURN format('%s is approved for %s and counts this deal. Withdraw it first to change this.', public.cockpit_hours_month_name(r.month), r.name); END IF;
    -- And the months whose cash or PIF could read it, for its closer, its setter and a newly named setter.
    BEGIN facts:=public.cockpit_pay_facts_sales(m0,m1); EXCEPTION WHEN others THEN facts:=NULL; END;
    deal:=(SELECT d FROM jsonb_array_elements(coalesce(facts->'deals','[]'::jsonb)) d WHERE d->>'responseId'=ref LIMIT 1);
    sm:=coalesce(date_trunc('month',left(deal->>'signedDay',10)::date)::date,m0);
    -- From the deal's first payment (money counts from 7 days before the form, and a tie of yours from any day) to 4 months after signing.
    lo:=least(sm,date_trunc('month',(left(deal->>'signedDay',10)::date-7))::date,
      (SELECT date_trunc('month',min(left(pm->>'day',10)::date))::date FROM jsonb_array_elements(coalesce(deal->'payments','[]'::jsonb)) pm
        WHERE pm->>'day' ~ '^\d{4}-\d{2}-\d{2}'));
    hi:=greatest((sm+interval '4 months')::date,
      (SELECT date_trunc('month',max(left(pm->>'day',10)::date))::date FROM jsonb_array_elements(coalesce(deal->'payments','[]'::jsonb)) pm
        WHERE pm->>'day' ~ '^\d{4}-\d{2}-\d{2}'));
    who:=ARRAY(SELECT x::bigint FROM unnest(ARRAY[deal->'closer'->>'personId',deal->'setter'->>'personId',
      CASE WHEN kind='setter' THEN p_value->>'personId' END]) x WHERE x ~ '^[0-9]+$');
    SELECT pm.month, p.name INTO r FROM public.cockpit_pay_months pm JOIN public.cockpit_people p ON p.id=pm.person_id
      WHERE pm.status='approved' AND pm.person_id=ANY(who) AND pm.month BETWEEN lo AND hi
        AND (jsonb_path_exists(pm.result,'$.commission[*] ? (@.basis == "set_cash" || @.basis == "closed_cash")')
          OR coalesce(pm.result->'planJson'->'parts','[]'::jsonb) @> '[{"event":"pif_deal_closed"}]'::jsonb)
      ORDER BY pm.month LIMIT 1;
    IF FOUND THEN RETURN format('%s is approved for %s and could count this deal. Withdraw it first to change this.', public.cockpit_hours_month_name(r.month), r.name); END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. CEO RPCs (payload jsonb `p`, camelCase, unknown keys refused)

CREATE OR REPLACE FUNCTION public.cockpit_ceo_pay_plans_list()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email();
BEGIN
  RETURN jsonb_build_object(
    'plans',coalesce((SELECT jsonb_agg(jsonb_build_object('id',pl.id,'role',pl.role,'personId',pl.person_id,'fromMonth',pl.from_month,'plan',pl.plan,
        'note',pl.note,'setBy',pl.set_by,'setAt',pl.set_at) ORDER BY lower(coalesce(pl.role,'')), pl.person_id, pl.from_month)
      FROM public.cockpit_pay_plans pl),'[]'::jsonb),
    'roles',coalesce((SELECT jsonb_agg(r ORDER BY lower(r)) FROM (
        SELECT DISTINCT ON (lower(x)) x AS r FROM (
          SELECT btrim(p.role) x FROM public.cockpit_people p WHERE nullif(btrim(p.role),'') IS NOT NULL
          UNION SELECT pl.role FROM public.cockpit_pay_plans pl WHERE pl.role IS NOT NULL) u ORDER BY lower(x), x) d),'[]'::jsonb),
    'people',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'role',nullif(btrim(p.role),''),'active',p.active) ORDER BY p.name)
      FROM public.cockpit_people p WHERE p.engagement<>'bot'),'[]'::jsonb),
    'lastApproved',coalesce((SELECT jsonb_agg(jsonb_build_object('personId',m.person_id,'month',m.month) ORDER BY m.person_id)
      FROM (SELECT pm.person_id, max(pm.month) AS month FROM public.cockpit_pay_months pm WHERE pm.status='approved' GROUP BY pm.person_id) m),'[]'::jsonb),
    'approvedPlanIds',coalesce((SELECT jsonb_agg(DISTINCT (pm.result->'plan'->>'planId')::bigint)
      FROM public.cockpit_pay_months pm WHERE pm.status='approved' AND pm.result->'plan'->>'planId' ~ '^[0-9]+$'),'[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_pay_plan_save(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); v_role text; v_pid bigint; v_person public.cockpit_people; v_from date;
  v_plan jsonb; v_note text; v_check text; r record; cur public.cockpit_pay_plans; v_id bigint; v_action text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_pay',0));
  PERFORM public.cockpit_pay_only(p, ARRAY['role','personId','fromMonth','plan','note']);
  v_role:=public.cockpit_pay_text(p,'role',80);
  IF p ? 'role' AND v_role IS NULL THEN RAISE EXCEPTION 'Name the role.' USING ERRCODE='22023'; END IF;
  IF p ? 'personId' AND p->'personId'<>'null'::jsonb THEN
    IF jsonb_typeof(p->'personId')<>'number' OR (p->>'personId')::numeric<>trunc((p->>'personId')::numeric) THEN
      RAISE EXCEPTION 'Choose a person first' USING ERRCODE='22023';
    END IF;
    v_pid:=(p->>'personId')::bigint;
  END IF;
  IF (v_role IS NULL)=(v_pid IS NULL) THEN RAISE EXCEPTION 'Choose a role or one person.' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p->'fromMonth') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Choose the month the plan applies from.' USING ERRCODE='22023'; END IF;
  v_from:=CASE WHEN p->>'fromMonth' ~ '^[0-9]{4}-[0-9]{2}$' THEN public.cockpit_hours_month(p->>'fromMonth') ELSE public.cockpit_hours_day(p->>'fromMonth') END;
  IF extract(day FROM v_from)<>1 THEN RAISE EXCEPTION 'Plans start on the 1st of a month.' USING ERRCODE='22023'; END IF;
  IF NOT (p ? 'plan') THEN RAISE EXCEPTION 'Send the plan, or null to follow the role plan.' USING ERRCODE='22023'; END IF;
  v_plan:=CASE WHEN p->'plan'='null'::jsonb THEN NULL ELSE p->'plan' END;
  IF v_role IS NOT NULL AND v_plan IS NULL THEN RAISE EXCEPTION 'A role plan needs its parts.' USING ERRCODE='22023'; END IF;
  IF v_plan IS NOT NULL THEN
    v_check:=public.cockpit_pay_plan_check(v_plan, v_role IS NOT NULL);
    IF v_check IS NOT NULL THEN RAISE EXCEPTION '%', v_check USING ERRCODE='22023'; END IF;
  END IF;
  v_note:=public.cockpit_pay_text(p,'note',500);
  IF v_pid IS NOT NULL THEN
    SELECT * INTO v_person FROM public.cockpit_people WHERE id=v_pid;
    IF NOT FOUND THEN RAISE EXCEPTION 'Nobody on the roster has that id' USING ERRCODE='22023'; END IF;
    IF v_person.engagement='bot' THEN RAISE EXCEPTION 'A bot is never paid' USING ERRCODE='22023'; END IF;
  END IF;

  -- A plan never rewrites an approved month: not for anyone it affects now, nor any approved month that used it.
  SELECT x.name, x.month INTO r FROM (
    SELECT pp.name, public.cockpit_pay_last_approved(pp.id) AS month FROM public.cockpit_people pp
      WHERE (v_pid IS NOT NULL AND pp.id=v_pid) OR (v_role IS NOT NULL AND lower(btrim(pp.role))=lower(v_role))
    UNION ALL
    SELECT pp.name, pm.month FROM public.cockpit_pay_months pm JOIN public.cockpit_people pp ON pp.id=pm.person_id
      WHERE v_role IS NOT NULL AND pm.status='approved' AND pm.result->'plan'->>'source'='role'
        AND lower(btrim(pm.result->'plan'->>'role'))=lower(v_role)) x
    WHERE x.month>=v_from ORDER BY x.month DESC, x.name LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION '% is approved for %. Plans can change from %.', public.cockpit_hours_month_name(r.month), r.name,
      public.cockpit_hours_month_name((r.month+interval '1 month')::date) USING ERRCODE='22023';
  END IF;

  SELECT * INTO cur FROM public.cockpit_pay_plans pl
    WHERE pl.from_month=v_from AND ((v_pid IS NOT NULL AND pl.person_id=v_pid) OR (v_role IS NOT NULL AND pl.role IS NOT NULL AND lower(btrim(pl.role))=lower(v_role)))
    FOR UPDATE;
  IF FOUND THEN
    IF EXISTS (SELECT 1 FROM public.cockpit_pay_months pm WHERE pm.status='approved' AND pm.result->'plan'->>'planId'=cur.id::text) THEN
      RAISE EXCEPTION 'This plan was used in an approved month. Save the change from a later month.' USING ERRCODE='22023';
    END IF;
    UPDATE public.cockpit_pay_plans SET role=v_role, plan=v_plan, note=v_note, set_by=v_actor, set_at=now() WHERE id=cur.id;
    v_id:=cur.id; v_action:='pay.planFix';
  ELSE
    INSERT INTO public.cockpit_pay_plans(role,person_id,from_month,plan,note,set_by) VALUES(v_role,v_pid,v_from,v_plan,v_note,v_actor) RETURNING id INTO v_id;
    v_action:='pay.planSave';
  END IF;
  PERFORM public.cockpit_hours_audit(v_action,'cockpit_pay_plans',v_id::text,
    jsonb_build_object('id',v_id,'role',v_role,'personId',v_pid,'fromMonth',to_char(v_from,'YYYY-MM'),'follows',v_plan IS NULL,
      'parts',coalesce((SELECT jsonb_agg(x->'key') FROM jsonb_array_elements(coalesce(v_plan->'parts','[]'::jsonb)) x),'[]'::jsonb),
      'kinds',coalesce((SELECT jsonb_agg(x->'kind') FROM jsonb_array_elements(coalesce(v_plan->'parts','[]'::jsonb)) x),'[]'::jsonb),
      'commission',coalesce((SELECT jsonb_agg(x->'basis') FROM jsonb_array_elements(coalesce(v_plan->'commission','[]'::jsonb)) x),'[]'::jsonb)),v_actor);
  RETURN jsonb_build_object('ok',true,'id',v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_pay_entry_save(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); v_person public.cockpit_people; m0 date; mname text; nname text; pk text; part jsonb; kind text; ev text;
  qty numeric; cash numeric; amt numeric; em numeric; v_client text; v_product text; cleared date; posted date; cancelled date;
  eref text; evid text; v_note text; fm date; v_id bigint; d date; lapse numeric; general boolean:=false;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_pay',0));
  PERFORM public.cockpit_pay_only(p, ARRAY['personId','month','partKey','quantity','cashUsd','amountUsd','engagementMonth','client','product',
    'clearedOn','postedOn','cancelledOn','evidenceRef','evidence','note','fromMonth']);
  v_person:=public.cockpit_hours_person(p);
  m0:=public.cockpit_hours_month(p->>'month'); mname:=public.cockpit_hours_month_name(m0);
  nname:=public.cockpit_hours_month_name((m0+interval '1 month')::date);
  IF EXISTS (SELECT 1 FROM public.cockpit_pay_months pm WHERE pm.person_id=v_person.id AND pm.month=m0 AND pm.status='approved') THEN
    RAISE EXCEPTION '% is approved. Add it to % as an adjustment.', mname, nname USING ERRCODE='22023';
  END IF;
  pk:=public.cockpit_pay_text(p,'partKey',40);
  IF pk IS NULL THEN RAISE EXCEPTION 'Choose the part of the plan.' USING ERRCODE='22023'; END IF;
  qty:=public.cockpit_pay_number(p,'quantity'); cash:=public.cockpit_pay_number(p,'cashUsd'); amt:=public.cockpit_pay_number(p,'amountUsd');
  em:=public.cockpit_pay_number(p,'engagementMonth');
  v_client:=public.cockpit_pay_text(p,'client',120); v_product:=public.cockpit_pay_text(p,'product',120);
  cleared:=public.cockpit_pay_date(p,'clearedOn'); posted:=public.cockpit_pay_date(p,'postedOn'); cancelled:=public.cockpit_pay_date(p,'cancelledOn');
  eref:=public.cockpit_pay_text(p,'evidenceRef',200); evid:=public.cockpit_pay_text(p,'evidence',1000); v_note:=public.cockpit_pay_text(p,'note',500);
  fm:=CASE WHEN p ? 'fromMonth' AND p->'fromMonth'<>'null'::jsonb THEN public.cockpit_hours_month(p->>'fromMonth') END;

  IF pk='adjustment' THEN
    IF amt IS NULL OR amt=0 OR abs(amt)>100000 THEN RAISE EXCEPTION 'An adjustment needs an amount in USD that is not 0.' USING ERRCODE='22023'; END IF;
    IF v_note IS NULL OR length(v_note)<3 THEN RAISE EXCEPTION 'Say what the adjustment is for in the note.' USING ERRCODE='22023'; END IF;
    IF fm IS NOT NULL AND fm>=m0 THEN RAISE EXCEPTION 'An adjustment corrects an earlier month.' USING ERRCODE='22023'; END IF;
    INSERT INTO public.cockpit_pay_entries(person_id,month,part_key,amount_usd,client,evidence_ref,evidence,note,from_month,entered_by)
    VALUES(v_person.id,m0,'adjustment',round(amt,2),v_client,eref,evid,v_note,fm,v_actor) RETURNING id INTO v_id;
  ELSE
    part:=(SELECT x FROM jsonb_array_elements(coalesce(public.cockpit_pay_plan_for(v_person.id,m0)->'plan'->'parts','[]'::jsonb)) x WHERE x->>'key'=pk LIMIT 1);
    IF part IS NULL THEN RAISE EXCEPTION '%''s plan for % has no part "%".', v_person.name, mname, pk USING ERRCODE='22023'; END IF;
    kind:=part->>'kind'; ev:=part->>'event';
    IF kind='per_event' THEN
      IF ev='pif_deal_closed' THEN RAISE EXCEPTION 'The cockpit counts paid-in-full deals; there is nothing to type.' USING ERRCODE='22023'; END IF;
      IF qty IS NULL OR qty<>trunc(qty) OR abs(qty)>1000 THEN RAISE EXCEPTION 'Type a whole number.' USING ERRCODE='22023'; END IF;
      IF qty<0 AND v_note IS NULL THEN RAISE EXCEPTION 'A negative count is a clawback: say why in the note.' USING ERRCODE='22023'; END IF;
      general:=ev IN ('renewal','reactivation','referral');
      IF ev='google_review' AND qty>0 THEN
        IF evid IS NULL OR evid !~ '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION 'Paste the link to the review.' USING ERRCODE='22023'; END IF;
        IF posted IS NULL THEN RAISE EXCEPTION 'Type the day the review was posted.' USING ERRCODE='22023'; END IF;
      END IF;
      cash:=NULL; amt:=NULL; em:=NULL;
    ELSIF kind='share' THEN
      IF cash IS NULL OR cash<0 OR cash>10000000 THEN RAISE EXCEPTION 'Type the cash in USD (0 or more).' USING ERRCODE='22023'; END IF;
      IF em IS NULL AND jsonb_array_length(part->'steps')>1 THEN
        RAISE EXCEPTION 'Say which month of the engagement this is (1 for the first).' USING ERRCODE='22023';
      END IF;
      em:=coalesce(em,1);
      IF em<>trunc(em) OR em NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'Say which month of the engagement this is (1 for the first).' USING ERRCODE='22023'; END IF;
      general:=part->>'of' IN ('upsell_cash','recurring_revenue');
      IF jsonb_typeof(part->'ends')='object' AND v_client IS NULL THEN RAISE EXCEPTION 'Name the client.' USING ERRCODE='22023'; END IF;
      -- A residual ends on cancellation or a payment lapse (decision 13, the CSM contract 7.4).
      IF em>=2 AND jsonb_typeof(part->'ends')='object' THEN
        IF part->'ends'->'onCancel'='true'::jsonb THEN
          SELECT min(e.cancelled_on) INTO d FROM public.cockpit_pay_entries e
            WHERE e.person_id=v_person.id AND e.part_key=pk AND e.voided_at IS NULL AND lower(btrim(e.client))=lower(v_client)
              AND (v_product IS NULL OR e.product IS NULL OR lower(btrim(e.product))=lower(v_product)) AND e.cancelled_on IS NOT NULL AND e.cancelled_on<m0;
          IF d IS NOT NULL THEN RAISE EXCEPTION 'The residual ended: % cancelled on %.', v_client, to_char(d,'FMDD Mon YYYY') USING ERRCODE='22023'; END IF;
        END IF;
        lapse:=public.cockpit_pay_num(part->'ends'->'lapseDays');
        IF lapse IS NOT NULL THEN
          SELECT max(e.cleared_on) INTO d FROM public.cockpit_pay_entries e
            WHERE e.person_id=v_person.id AND e.part_key=pk AND e.voided_at IS NULL AND lower(btrim(e.client))=lower(v_client)
              AND (v_product IS NULL OR e.product IS NULL OR lower(btrim(e.product))=lower(v_product)) AND e.cash_usd>0 AND e.month<m0 AND e.cleared_on IS NOT NULL;
          IF d IS NOT NULL AND coalesce(cleared,m0)-d>lapse THEN
            RAISE EXCEPTION 'The residual ended: no payment for over % days after %.', lapse, to_char(d,'FMDD Mon YYYY') USING ERRCODE='22023';
          END IF;
        END IF;
      END IF;
      qty:=NULL; amt:=NULL;
    ELSE
      RAISE EXCEPTION 'This part is worked out by the cockpit; confirm its input instead of typing it.' USING ERRCODE='22023';
    END IF;
    -- General conditions: a client, a cleared date in the month and an evidence reference.
    IF general AND coalesce(qty,cash,0)<>0 THEN
      IF v_client IS NULL THEN RAISE EXCEPTION 'Name the client.' USING ERRCODE='22023'; END IF;
      IF cleared IS NULL THEN RAISE EXCEPTION 'Type the day the payment cleared.' USING ERRCODE='22023'; END IF;
      IF date_trunc('month',cleared)::date<>m0 THEN
        RAISE EXCEPTION 'Cleared on %: add it to %.', to_char(cleared,'FMDD Mon'), public.cockpit_hours_month_name(date_trunc('month',cleared)::date) USING ERRCODE='22023';
      END IF;
      IF eref IS NULL THEN RAISE EXCEPTION 'Add the payment id or the signed contract id.' USING ERRCODE='22023'; END IF;
    END IF;
    INSERT INTO public.cockpit_pay_entries(person_id,month,part_key,quantity,cash_usd,engagement_month,client,product,cleared_on,posted_on,cancelled_on,
      evidence_ref,evidence,note,entered_by)
    VALUES(v_person.id,m0,pk,qty,cash,em::int,v_client,v_product,cleared,posted,cancelled,eref,evid,v_note,v_actor) RETURNING id INTO v_id;
  END IF;
  PERFORM public.cockpit_hours_audit('pay.entry','cockpit_pay_entries',v_id::text,
    jsonb_build_object('id',v_id,'personId',v_person.id,'month',to_char(m0,'YYYY-MM'),'partKey',pk,'kind',coalesce(kind,'adjustment')),v_actor);
  RETURN jsonb_build_object('ok',true,'id',v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_pay_entry_void(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); e public.cockpit_pay_entries; v_reason text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_pay',0));
  PERFORM public.cockpit_pay_only(p, ARRAY['id','reason']);
  IF jsonb_typeof(p->'id') IS DISTINCT FROM 'number' OR (p->>'id')::numeric<>trunc((p->>'id')::numeric) THEN
    RAISE EXCEPTION 'Choose the entry' USING ERRCODE='22023';
  END IF;
  v_reason:=public.cockpit_pay_text(p,'reason',300);
  IF v_reason IS NULL OR length(v_reason)<3 THEN RAISE EXCEPTION 'Say why, in a few words.' USING ERRCODE='22023'; END IF;
  SELECT * INTO e FROM public.cockpit_pay_entries WHERE id=(p->>'id')::bigint FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'There is no entry with that id.' USING ERRCODE='22023'; END IF;
  IF e.voided_at IS NOT NULL THEN RAISE EXCEPTION 'That entry was already removed.' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_pay_months pm WHERE pm.person_id=e.person_id AND pm.month=e.month AND pm.status='approved') THEN
    RAISE EXCEPTION '% is approved. Add it to % as an adjustment.', public.cockpit_hours_month_name(e.month),
      public.cockpit_hours_month_name((e.month+interval '1 month')::date) USING ERRCODE='22023';
  END IF;
  UPDATE public.cockpit_pay_entries SET voided_at=now(), voided_by=v_actor, void_reason=v_reason WHERE id=e.id;
  PERFORM public.cockpit_hours_audit('pay.entryVoid','cockpit_pay_entries',e.id::text,
    jsonb_build_object('id',e.id,'personId',e.person_id,'month',to_char(e.month,'YYYY-MM'),'partKey',e.part_key),v_actor);
  RETURN jsonb_build_object('ok',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_pay_none_rest(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); v_person public.cockpit_people; m0 date; v_plan jsonb; part jsonb; n int:=0; keys text[]:='{}';
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_pay',0));
  PERFORM public.cockpit_pay_only(p, ARRAY['personId','month']);
  v_person:=public.cockpit_hours_person(p);
  m0:=public.cockpit_hours_month(p->>'month');
  IF EXISTS (SELECT 1 FROM public.cockpit_pay_months pm WHERE pm.person_id=v_person.id AND pm.month=m0 AND pm.status='approved') THEN
    RAISE EXCEPTION '% is approved. Add it to % as an adjustment.', public.cockpit_hours_month_name(m0),
      public.cockpit_hours_month_name((m0+interval '1 month')::date) USING ERRCODE='22023';
  END IF;
  v_plan:=public.cockpit_pay_plan_for(v_person.id,m0)->'plan';
  IF v_plan IS NULL THEN RAISE EXCEPTION '% has no pay plan for %.', v_person.name, public.cockpit_hours_month_name(m0) USING ERRCODE='22023'; END IF;
  FOR part IN SELECT t.v FROM jsonb_array_elements(coalesce(v_plan->'parts','[]'::jsonb)) WITH ORDINALITY AS t(v,o)
      WHERE (t.v->>'kind'='per_event' AND t.v->>'event'<>'pif_deal_closed') OR t.v->>'kind'='share' ORDER BY t.o LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.cockpit_pay_entries e WHERE e.person_id=v_person.id AND e.month=m0 AND e.part_key=part->>'key' AND e.voided_at IS NULL);
    INSERT INTO public.cockpit_pay_entries(person_id,month,part_key,quantity,cash_usd,engagement_month,note,entered_by)
    VALUES(v_person.id,m0,part->>'key',CASE WHEN part->>'kind'='per_event' THEN 0 END,CASE WHEN part->>'kind'='share' THEN 0 END,
      CASE WHEN part->>'kind'='share' THEN 1 END,format('Nothing else for %s', public.cockpit_hours_month_name(m0)),v_actor);
    n:=n+1; keys:=keys||(part->>'key');
  END LOOP;
  PERFORM public.cockpit_hours_audit('pay.noneRest','cockpit_pay_entries',v_person.id::text,
    jsonb_build_object('personId',v_person.id,'month',to_char(m0,'YYYY-MM'),'parts',to_jsonb(keys)),v_actor);
  RETURN jsonb_build_object('ok',true,'parts',n);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_pay_confirm(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); m0 date; k text; kind text; ref text; val jsonb; x numeric; y numeric; d date;
  v_note text; v_refuse text; v_global boolean; v_id bigint; v_removed boolean:=false; n int;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_pay',0));
  PERFORM public.cockpit_pay_only(p, ARRAY['month','key','value','note']);
  m0:=public.cockpit_hours_month(p->>'month');
  IF jsonb_typeof(p->'key') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Choose what to confirm.' USING ERRCODE='22023'; END IF;
  k:=p->>'key';
  IF NOT (p ? 'value') THEN RAISE EXCEPTION 'Send a value, or null to remove it.' USING ERRCODE='22023'; END IF;
  val:=p->'value';
  kind:=split_part(k,':',1); ref:=substr(k,length(kind)+2);
  IF kind IN ('csm_churn','qualifying','owned_creative','ramp_start') THEN
    IF ref !~ '^[0-9]{1,18}$' OR NOT EXISTS (SELECT 1 FROM public.cockpit_people pp WHERE pp.id=ref::bigint) THEN
      RAISE EXCEPTION 'Nobody on the roster has that id' USING ERRCODE='22023';
    END IF;
  ELSIF kind IN ('close','setter','pif') THEN
    IF ref !~ '^[A-Za-z0-9_.-]{1,100}$' THEN RAISE EXCEPTION 'That id is not one the cockpit knows.' USING ERRCODE='22023'; END IF;
  ELSIF k<>'logo_churn' THEN
    RAISE EXCEPTION 'That is not something to confirm here.' USING ERRCODE='22023';
  END IF;

  IF val<>'null'::jsonb THEN
    IF kind IN ('logo_churn','csm_churn') THEN
      PERFORM public.cockpit_pay_only(val, ARRAY['lost','activeAtStart','clients']);
      x:=public.cockpit_pay_num(val->'lost'); y:=public.cockpit_pay_num(val->'activeAtStart');
      IF x IS NULL OR x<>trunc(x) OR x<0 OR y IS NULL OR y<>trunc(y) OR y<=0 OR jsonb_typeof(val->'clients') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Churn needs lost (0 or more), activeAtStart (more than 0) and the list of lost clients.' USING ERRCODE='22023';
      END IF;
      IF x>y THEN RAISE EXCEPTION 'Lost clients cannot be more than the clients active at the start.' USING ERRCODE='22023'; END IF;
      IF jsonb_array_length(val->'clients')>1000 THEN RAISE EXCEPTION 'That list is too long.' USING ERRCODE='22023'; END IF;
    ELSIF kind='qualifying' THEN
      PERFORM public.cockpit_pay_only(val, ARRAY['count']);
      x:=public.cockpit_pay_num(val->'count');
      IF x IS NULL OR x<>trunc(x) OR x NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'Type the number of qualifying clients.' USING ERRCODE='22023'; END IF;
    ELSIF kind='owned_creative' THEN
      PERFORM public.cockpit_pay_only(val, ARRAY['clients']);
      IF jsonb_typeof(val->'clients') IS DISTINCT FROM 'array' OR jsonb_array_length(val->'clients')>1000
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(val->'clients') c WHERE jsonb_typeof(c)<>'string' OR length(btrim(c#>>'{}')) NOT BETWEEN 1 AND 100) THEN
        RAISE EXCEPTION 'List the clients by their card id.' USING ERRCODE='22023';
      END IF;
    ELSIF kind='ramp_start' THEN
      PERFORM public.cockpit_pay_only(val, ARRAY['day']);
      IF jsonb_typeof(val->'day') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Type the contract start as YYYY-MM-DD.' USING ERRCODE='22023'; END IF;
      d:=public.cockpit_hours_day(val->>'day');
      m0:=date_trunc('month',d)::date; -- stored under the start month
    ELSIF kind='close' THEN
      PERFORM public.cockpit_pay_only(val, ARRAY['confirmed']);
      IF jsonb_typeof(val->'confirmed') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Say whether it is a close.' USING ERRCODE='22023'; END IF;
    ELSIF kind='setter' THEN
      PERFORM public.cockpit_pay_only(val, ARRAY['personId']);
      IF NOT (val ? 'personId') OR (val->'personId'<>'null'::jsonb AND (jsonb_typeof(val->'personId')<>'number'
          OR (val->>'personId')::numeric<>trunc((val->>'personId')::numeric)
          OR NOT EXISTS (SELECT 1 FROM public.cockpit_people pp WHERE pp.id=(val->>'personId')::bigint))) THEN
        RAISE EXCEPTION 'Choose who set the deal, or nobody.' USING ERRCODE='22023';
      END IF;
    ELSE -- pif
      PERFORM public.cockpit_pay_only(val, ARRAY['earned']);
      IF jsonb_typeof(val->'earned') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Say whether it was paid in full.' USING ERRCODE='22023'; END IF;
    END IF;
  END IF;
  v_note:=public.cockpit_pay_text(p,'note',500);
  v_global:=kind IN ('ramp_start','setter','pif');

  v_refuse:=public.cockpit_pay_confirm_refusal(m0,k,val);
  IF v_refuse IS NOT NULL THEN RAISE EXCEPTION '%', v_refuse USING ERRCODE='22023'; END IF;

  IF val='null'::jsonb THEN
    DELETE FROM public.cockpit_pay_confirmations c WHERE c.key=k AND (v_global OR c.month=m0);
    GET DIAGNOSTICS n = ROW_COUNT; v_removed:=n>0;
  ELSE
    IF v_global THEN DELETE FROM public.cockpit_pay_confirmations c WHERE c.key=k AND c.month<>m0; END IF;
    INSERT INTO public.cockpit_pay_confirmations(month,key,value,note,set_by) VALUES(m0,k,val,v_note,v_actor)
    ON CONFLICT (month,key) DO UPDATE SET value=EXCLUDED.value, note=EXCLUDED.note, set_by=EXCLUDED.set_by, set_at=now()
    RETURNING id INTO v_id;
  END IF;
  PERFORM public.cockpit_hours_audit('pay.confirm','cockpit_pay_confirmations',coalesce(v_id::text,k),
    jsonb_build_object('month',to_char(m0,'YYYY-MM'),'key',k,'removed',val='null'::jsonb),v_actor);
  RETURN jsonb_build_object('ok',true,'id',v_id,'removed',v_removed);
END;
$$;

/** The month for the CEO: fresh figures, and approved people from their frozen result with any drift since. */
CREATE OR REPLACE FUNCTION public.cockpit_ceo_pay_month(p_month date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); v jsonb; out jsonb:='[]'::jsonb; x jsonb; m public.cockpit_pay_months;
BEGIN
  IF p_month IS NULL THEN RAISE EXCEPTION 'Choose a month' USING ERRCODE='22023'; END IF;
  v:=public.cockpit_pay_compute(p_month);
  FOR x IN SELECT t.v FROM jsonb_array_elements(v->'people') WITH ORDINALITY AS t(v,o) ORDER BY t.o LOOP
    SELECT * INTO m FROM public.cockpit_pay_months pm WHERE pm.person_id=(x->>'personId')::bigint AND pm.month=(v->>'month')::date AND pm.status='approved';
    IF FOUND THEN
      x:=(m.result-'planJson')||jsonb_build_object('status','approved',
        'approval',jsonb_build_object('id',m.id,'approvedAt',m.approved_at,'approvedBy',m.approved_by,'totalUsd',m.total_usd,'frozen',m.result),
        'sinceApproval',public.cockpit_pay_drift(m.result,x));
    END IF;
    out:=out||jsonb_build_array(x);
  END LOOP;
  RETURN v||jsonb_build_object('people',out);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_pay_month_approve(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); m0 date; mname text; v jsonb; it jsonb; pid bigint; fresh jsonb; ex public.cockpit_pay_months;
  n_ok int:=0; n_ex int:=0; refused jsonb:='[]'::jsonb; v_name text; v_id bigint; v_today date; v_settle date; v_plan jsonb;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_pay',0));
  PERFORM public.cockpit_pay_only(p, ARRAY['month','people']);
  m0:=public.cockpit_hours_month(p->>'month'); mname:=public.cockpit_hours_month_name(m0);
  IF jsonb_typeof(p->'people') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'people')=0 THEN
    RAISE EXCEPTION 'Choose who to approve.' USING ERRCODE='22023';
  END IF;
  FOR it IN SELECT x FROM jsonb_array_elements(p->'people') x LOOP
    PERFORM public.cockpit_pay_only(it, ARRAY['personId','totalUsd','resultHash']);
    IF jsonb_typeof(it->'personId') IS DISTINCT FROM 'number' OR (it->>'personId')::numeric<>trunc((it->>'personId')::numeric)
      OR jsonb_typeof(it->'totalUsd') IS DISTINCT FROM 'number' OR coalesce(it->>'resultHash','') !~ '^[0-9a-f]{32}$' THEN
      RAISE EXCEPTION 'Each approval needs personId, totalUsd and resultHash.' USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF (SELECT count(*)<>count(DISTINCT x->>'personId') FROM jsonb_array_elements(p->'people') x) THEN
    RAISE EXCEPTION 'Each person can be approved once per call.' USING ERRCODE='22023';
  END IF;
  v_today:=public.cockpit_hours_kw_today(); v_settle:=public.cockpit_pay_settle_day(m0);
  v:=public.cockpit_pay_compute(m0);
  FOR it IN SELECT x FROM jsonb_array_elements(p->'people') x LOOP
    pid:=(it->>'personId')::bigint;
    SELECT pp.name INTO v_name FROM public.cockpit_people pp WHERE pp.id=pid;
    IF NOT FOUND THEN
      refused:=refused||jsonb_build_array(jsonb_build_object('personId',pid,'sentence','Nobody on the roster has that id.')); CONTINUE;
    END IF;
    SELECT * INTO ex FROM public.cockpit_pay_months pm WHERE pm.person_id=pid AND pm.month=m0 AND pm.status='approved' FOR UPDATE;
    IF FOUND THEN
      IF ex.result_hash=it->>'resultHash' THEN n_ex:=n_ex+1;
      ELSE refused:=refused||jsonb_build_array(jsonb_build_object('personId',pid,
        'sentence',format('%s is already approved for %s with other figures. Withdraw it first.', mname, v_name)));
      END IF;
      CONTINUE;
    END IF;
    IF v_today<v_settle THEN
      refused:=refused||jsonb_build_array(jsonb_build_object('personId',pid,'sentence',format('Approve %s from %s.', mname, to_char(v_settle,'FMDD FMMonth'))));
      CONTINUE;
    END IF;
    fresh:=(SELECT x FROM jsonb_array_elements(v->'people') x WHERE (x->>'personId')::bigint=pid LIMIT 1);
    IF fresh IS NULL THEN
      refused:=refused||jsonb_build_array(jsonb_build_object('personId',pid,'sentence',format('%s has no pay plan or commission for %s.', v_name, mname)));
      CONTINUE;
    END IF;
    IF fresh->>'status'<>'ready' THEN
      refused:=refused||jsonb_build_array(jsonb_build_object('personId',pid,'sentence',format('%s is not ready for %s: %s', v_name, mname,
        coalesce(fresh->'missing'->>0, fresh->>'note', 'something is still open.'))));
      CONTINUE;
    END IF;
    IF fresh->>'resultHash' IS DISTINCT FROM it->>'resultHash'
       OR round(public.cockpit_pay_num(fresh->'totalUsd'),2) IS DISTINCT FROM round(public.cockpit_pay_num(it->'totalUsd'),2) THEN
      refused:=refused||jsonb_build_array(jsonb_build_object('personId',pid,'sentence','The figures changed since you opened the month. Reload and check again.'));
      CONTINUE;
    END IF;
    v_plan:=public.cockpit_pay_plan_for(pid,m0)->'plan';
    INSERT INTO public.cockpit_pay_months(person_id,month,status,base_usd,commission_usd,parts_usd,total_usd,not_priced,result,result_hash,approved_by)
    VALUES(pid,m0,'approved',public.cockpit_pay_num(fresh->'base'->'usd'),public.cockpit_pay_num(fresh->'commissionUsd'),
      coalesce(public.cockpit_pay_num(fresh->'partsUsd'),0),public.cockpit_pay_num(fresh->'totalUsd'),coalesce(fresh->'notPriced','[]'::jsonb),
      fresh||jsonb_build_object('planJson',v_plan),fresh->>'resultHash',v_actor)
    RETURNING id INTO v_id;
    PERFORM public.cockpit_hours_audit('pay.approve','cockpit_pay_months',v_id::text,
      jsonb_build_object('id',v_id,'personId',pid,'month',to_char(m0,'YYYY-MM'),'resultHash',fresh->>'resultHash','planId',fresh->'plan'->'planId'),v_actor);
    n_ok:=n_ok+1;
  END LOOP;
  RETURN jsonb_build_object('ok',true,'approved',n_ok,'existing',n_ex,'refused',refused);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_pay_month_withdraw(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); v_person public.cockpit_people; m0 date; mname text; m public.cockpit_pay_months; v_later date; v_reason text;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_pay',0));
  PERFORM public.cockpit_pay_only(p, ARRAY['personId','month','reason']);
  v_person:=public.cockpit_hours_person(p);
  m0:=public.cockpit_hours_month(p->>'month'); mname:=public.cockpit_hours_month_name(m0);
  v_reason:=public.cockpit_pay_text(p,'reason',300);
  IF v_reason IS NULL OR length(v_reason)<3 THEN RAISE EXCEPTION 'Say why, in a few words.' USING ERRCODE='22023'; END IF;
  SELECT * INTO m FROM public.cockpit_pay_months pm WHERE pm.person_id=v_person.id AND pm.month=m0 AND pm.status='approved' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '% isn''t approved for %.', mname, v_person.name USING ERRCODE='22023'; END IF;
  -- A later approved month that carries an adjustment for this one would count it twice.
  SELECT min(e.month) INTO v_later FROM public.cockpit_pay_entries e
    JOIN public.cockpit_pay_months a ON a.person_id=e.person_id AND a.month=e.month AND a.status='approved'
    WHERE e.person_id=v_person.id AND e.part_key='adjustment' AND e.from_month=m0 AND e.voided_at IS NULL AND e.month>m0;
  IF v_later IS NOT NULL THEN
    RAISE EXCEPTION '%''s pay includes an adjustment for %. Withdraw % first.', public.cockpit_hours_month_name(v_later), mname,
      public.cockpit_hours_month_name(v_later) USING ERRCODE='22023';
  END IF;
  UPDATE public.cockpit_pay_months SET status='withdrawn', withdrawn_by=v_actor, withdrawn_at=now(), withdraw_reason=v_reason WHERE id=m.id;
  PERFORM public.cockpit_hours_audit('pay.withdraw','cockpit_pay_months',m.id::text,
    jsonb_build_object('id',m.id,'personId',v_person.id,'month',to_char(m0,'YYYY-MM')),v_actor);
  RETURN jsonb_build_object('ok',true);
END;
$$;

/** Approved commission and parts of the last 3 months, for Costs; notPriced names what was left out. */
CREATE OR REPLACE FUNCTION public.cockpit_ceo_pay_costs()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email();
BEGIN
  RETURN jsonb_build_object('months',coalesce((SELECT jsonb_agg(jsonb_build_object('personId',m.person_id,'month',m.month,
      'commissionUsd',m.commission_usd,'partsUsd',m.parts_usd,'notPriced',m.not_priced) ORDER BY m.month DESC, m.person_id)
    FROM public.cockpit_pay_months m
    WHERE m.status='approved' AND m.month>=(date_trunc('month',public.cockpit_hours_kw_today())-interval '3 months')::date),'[]'::jsonb));
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Function privileges: revoked from all four roles, then exactly one grant (CEO RPCs only)

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'cockpit_pay_entries_guard()','cockpit_pay_months_lock()','cockpit_pay_people_lines()','cockpit_pay_people_role()',
    'cockpit_pay_usd_per(text)','cockpit_pay_num(jsonb)','cockpit_pay_count(jsonb)','cockpit_pay_money(numeric)','cockpit_pay_only(jsonb,text[])',
    'cockpit_pay_text(jsonb,text,integer)','cockpit_pay_number(jsonb,text)','cockpit_pay_date(jsonb,text)','cockpit_pay_last_approved(bigint)',
    'cockpit_pay_settle_day(date)','cockpit_pay_confirmed(date,text)','cockpit_pay_confirmed_any(text)','cockpit_pay_line_words(text,numeric)',
    'cockpit_pay_lines_at(bigint,date)','cockpit_pay_role_at(bigint,date)','cockpit_pay_plan_check(jsonb,boolean)','cockpit_pay_band_pick(jsonb,numeric)',
    'cockpit_pay_plan_for(bigint,date)','cockpit_pay_people_in(date)','cockpit_pay_ads_pool(jsonb,text,text[],jsonb,jsonb)',
    'cockpit_pay_band_input(bigint,text,date,jsonb,jsonb)','cockpit_pay_person(bigint,date,jsonb,date)','cockpit_pay_compute(date)',
    'cockpit_pay_drift(jsonb,jsonb)','cockpit_pay_confirm_refusal(date,text,jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY[
    'cockpit_ceo_pay_plans_list()','cockpit_ceo_pay_plan_save(jsonb)','cockpit_ceo_pay_entry_save(jsonb)','cockpit_ceo_pay_entry_void(jsonb)',
    'cockpit_ceo_pay_none_rest(jsonb)','cockpit_ceo_pay_confirm(jsonb)','cockpit_ceo_pay_month(date)','cockpit_ceo_pay_month_approve(jsonb)',
    'cockpit_ceo_pay_month_withdraw(jsonb)','cockpit_ceo_pay_costs()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;
