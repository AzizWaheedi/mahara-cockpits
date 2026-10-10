-- Hours, leave and pay: Hubstaff hours, Timetastic leave, pay worked out in the cockpit
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive, written to be applied once
-- safely and to survive a second run: every table is CREATE ... IF NOT EXISTS,
-- every function CREATE OR REPLACE, every trigger dropped and created again,
-- and every seed guarded by NOT EXISTS. Design: scratchpad hours/design.md
-- (rule hours-1, 2026-10-09) and the CEO's decisions of the same day.
--
-- What it adds:
--   18 service-only tables (row security on, every grant revoked, then only
--   what the service path needs; cockpit_hours_keys gets no grant at all);
--   three AFTER triggers on cockpit_people that keep pay, schedule and
--   employment history (they fire only on a real change); guard triggers that
--   refuse DELETE and TRUNCATE on the history and approval tables; and the
--   CEO-gated and service-only RPCs the screens and the two Edge Functions use.
--
-- House rules: every function is revoked from PUBLIC, anon, authenticated and
-- service_role, then granted to exactly one role. CEO RPCs check
-- cockpit_is_ceo() first; service RPCs call cockpit_hours_require_service()
-- first. No audit row carries a pay amount, a key or a whole row.
--
-- Nothing of the systems manager's is replaced: cockpit_ceo_costs_context,
-- cockpit_ceo_people_set_pay, cockpit_ceo_people_save and
-- cockpit_people_write_audit stay as they are. This file references no vault,
-- net or cron object outside guarded dynamic SQL, so it loads in PGlite.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Helpers

CREATE OR REPLACE FUNCTION public.cockpit_hours_require_service()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF coalesce(auth.jwt()->>'role','')<>'service_role' THEN
    RAISE EXCEPTION 'This hours function needs the service role' USING ERRCODE='42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_kw_today()
RETURNS date LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT (pg_catalog.now() AT TIME ZONE 'Asia/Kuwait')::date
$$;

/** 'YYYY-MM' or a date in the month: the first of that month. */
CREATE OR REPLACE FUNCTION public.cockpit_hours_month(p text)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
  IF p IS NULL OR (p !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' AND p !~ '^[0-9]{4}-(0[1-9]|1[0-2])-[0-9]{2}$') THEN
    RAISE EXCEPTION 'Choose a month, as YYYY-MM' USING ERRCODE='22023';
  END IF;
  RETURN pg_catalog.date_trunc('month', (left(p,7)||'-01')::date)::date;
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_day(p text)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE d date;
BEGIN
  IF p IS NULL OR p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'Choose a date, as YYYY-MM-DD' USING ERRCODE='22023'; END IF;
  BEGIN d := p::date; EXCEPTION WHEN others THEN RAISE EXCEPTION 'Choose a real date' USING ERRCODE='22023'; END;
  IF to_char(d,'YYYY-MM-DD')<>p THEN RAISE EXCEPTION 'Choose a real date' USING ERRCODE='22023'; END IF;
  RETURN d;
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_month_name(p date)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT btrim(to_char(p,'FMMonth'))
$$;

/** The verified CEO's email, or 42501. */
CREATE OR REPLACE FUNCTION public.cockpit_hours_ceo_email()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v text;
BEGIN
  IF public.cockpit_is_ceo() IS NOT TRUE THEN RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501'; END IF;
  SELECT lower(btrim(u.email)) INTO v FROM auth.users u WHERE u.id=auth.uid();
  IF v IS NULL THEN RAISE EXCEPTION 'Verified identity required' USING ERRCODE='42501'; END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_audit(p_action text,p_entity text,p_entity_id text,p_after jsonb,p_actor text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  INSERT INTO public.cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,"before","after")
  VALUES(p_action,p_entity,p_entity_id,coalesce(p_actor,'service-role'),'ceo','supabase',NULL,p_after)
$$;

/** The role defaults of design 4.1, mirrored from hoursModel.ts roleDefaults(); used only to validate terms. */
CREATE OR REPLACE FUNCTION public.cockpit_hours_role_default(p_role text,p_engagement text)
RETURNS TABLE(tracking text,pay_basis text) LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT CASE
    WHEN p_engagement='bot' OR coalesce(p_role,'') ~* '\mbot\M' OR coalesce(p_role,'') ~* '\mceo\M|founder|chief executive' OR btrim(coalesce(p_role,''))='' THEN 'exempt'
    WHEN p_engagement IN ('freelancer','agency') THEN 'exempt'
    WHEN p_role ~* 'call\s*cent(re|er)|media\s*buy' THEN 'required'
    WHEN p_role ~* 'creative\s*strateg|systems?\s*manag|\mva\M|virtual\s*assist' THEN 'exempt'
    ELSE 'optional' END,
  CASE
    WHEN p_engagement IN ('bot','freelancer','agency') THEN 'fixed'
    WHEN coalesce(p_role,'') ~* 'call\s*cent(re|er)|media\s*buy' AND coalesce(p_role,'') !~* '\mceo\M|founder|\mbot\M' THEN 'hours'
    ELSE 'fixed' END
$$;

-- ---------------------------------------------------------------------------
-- 1. Tables

CREATE TABLE IF NOT EXISTS public.cockpit_hours_terms (
  person_id bigint PRIMARY KEY REFERENCES public.cockpit_people(id),
  tracking text CHECK (tracking IS NULL OR tracking IN ('required','optional','exempt')),
  pay_basis text CHECK (pay_basis IS NULL OR pay_basis IN ('hours','fixed')),
  hours_pay_from date CHECK (hours_pay_from IS NULL OR extract(day FROM hours_pay_from)=1),
  terms_confirmed_at timestamptz,
  terms_confirmed_by text,
  contract_country char(2) CHECK (contract_country IS NULL OR contract_country ~ '^[A-Z]{2}$'),
  works_in char(2) CHECK (works_in IS NULL OR works_in ~ '^[A-Z]{2}$'),
  kw_clause_reviewed_at timestamptz,
  kw_clause_reviewed_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
COMMENT ON TABLE public.cockpit_hours_terms IS
  'Hours terms per person (tracking, pay basis, when pay follows hours, contract country). Null means the role default. Its own table, not cockpit_people columns, so saving terms never fires the people audit trigger, which copies pay.';

CREATE TABLE IF NOT EXISTS public.cockpit_pay_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id bigint NOT NULL REFERENCES public.cockpit_people(id),
  effective_from date NOT NULL,
  monthly_cost numeric(14,3) CHECK (monthly_cost IS NULL OR monthly_cost>=0),
  currency char(3) NOT NULL,
  source text NOT NULL CHECK (source IN ('seed','roster','dated')),
  recorded_by text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  replaced_at timestamptz,
  replaced_by text,
  UNIQUE (person_id, effective_from)
);
COMMENT ON TABLE public.cockpit_pay_history IS
  'Base pay per person from a date. Written only when the value really changes (triggers on cockpit_people, cockpit_ceo_hours_set_pay). Never deleted.';

CREATE TABLE IF NOT EXISTS public.cockpit_schedule_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id bigint NOT NULL REFERENCES public.cockpit_people(id),
  effective_from date NOT NULL,
  schedule jsonb,
  source text NOT NULL CHECK (source IN ('seed','roster','dated')),
  recorded_by text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (person_id, effective_from)
);

CREATE TABLE IF NOT EXISTS public.cockpit_employment_periods (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id bigint NOT NULL REFERENCES public.cockpit_people(id),
  kind text NOT NULL CHECK (kind IN ('employed','paused')),
  from_day date NOT NULL,
  to_day date,
  source text NOT NULL CHECK (source IN ('seed','roster')),
  recorded_by text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (to_day IS NULL OR to_day>=from_day-1)
);
CREATE INDEX IF NOT EXISTS cockpit_employment_periods_person_idx ON public.cockpit_employment_periods(person_id, kind, from_day);

CREATE TABLE IF NOT EXISTS public.cockpit_hours_rules (
  from_month date PRIMARY KEY CHECK (extract(day FROM from_month)=1),
  settings jsonb NOT NULL CHECK (jsonb_typeof(settings)='object'),
  saved_by text NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cockpit_leave_types (
  provider text NOT NULL CHECK (provider='timetastic'),
  external_id text NOT NULL,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  deducted boolean,
  requires_approval boolean,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, external_id)
);

CREATE TABLE IF NOT EXISTS public.cockpit_leave_type_rules (
  provider text NOT NULL CHECK (provider='timetastic'),
  external_id text NOT NULL,
  from_month date NOT NULL CHECK (extract(day FROM from_month)=1),
  pay_rule text NOT NULL CHECK (pay_rule IN ('paid','unpaid','part','not_leave')),
  paid_share numeric(4,3) CHECK (paid_share IS NULL OR (paid_share>0 AND paid_share<1)),
  set_by text NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, external_id, from_month),
  CHECK (pay_rule<>'part' OR paid_share IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.cockpit_hours_holiday_overrides (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  day date NOT NULL,
  action text NOT NULL CHECK (action IN ('add','remove')),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  scope text NOT NULL CHECK (scope IN ('all','country','person')),
  scope_value text,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 300),
  set_by text NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  withdrawn_by text,
  CHECK ((scope='all' AND scope_value IS NULL) OR (scope<>'all' AND scope_value IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.cockpit_time_accounts (
  provider text NOT NULL CHECK (provider IN ('hubstaff','timetastic')),
  external_id text NOT NULL,
  email text,
  name text,
  status text,
  membership_role text,
  trackable boolean,
  member_since date,
  removed_on date,
  time_zone text,
  extra jsonb NOT NULL DEFAULT '{}'::jsonb,
  payroll_id text,
  job_title text,
  person_id bigint REFERENCES public.cockpit_people(id),
  link_method text CHECK (link_method IS NULL OR link_method IN ('payroll_id','email','manual')),
  linked_by text,
  linked_at timestamptz,
  ignored boolean NOT NULL DEFAULT false,
  online boolean,
  last_activity_at timestamptz,
  last_client_activity_on date,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, external_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_time_accounts_person_uidx ON public.cockpit_time_accounts(provider, person_id) WHERE person_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.cockpit_hubstaff_days (
  hubstaff_user_id text NOT NULL,
  day date NOT NULL,
  tracked_s integer NOT NULL CHECK (tracked_s>=0),
  manual_s integer NOT NULL DEFAULT 0,
  idle_s integer NOT NULL DEFAULT 0,
  break_s integer NOT NULL DEFAULT 0,
  overall_s integer NOT NULL DEFAULT 0,
  input_tracked_s integer NOT NULL DEFAULT 0,
  daily_tracked_s integer,
  zone_shifted boolean NOT NULL DEFAULT false,
  verified boolean NOT NULL DEFAULT true,
  previous_tracked_s integer,
  changed_at timestamptz,
  slots integer NOT NULL DEFAULT 0,
  source_updated_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now(),
  run_id bigint,
  gone_at timestamptz,
  PRIMARY KEY (hubstaff_user_id, day)
);

CREATE TABLE IF NOT EXISTS public.cockpit_hours_coverage (
  provider text NOT NULL CHECK (provider IN ('hubstaff','timetastic')),
  day date NOT NULL,
  last_ok_at timestamptz NOT NULL,
  read_started_at timestamptz NOT NULL,
  run_id bigint,
  PRIMARY KEY (provider, day)
);

CREATE TABLE IF NOT EXISTS public.cockpit_timetastic_bookings (
  booking_id text PRIMARY KEY,
  tt_user_id text NOT NULL,
  leave_type_id text NOT NULL,
  leave_type_name text,
  status text NOT NULL CHECK (status IN ('Pending','Approved','Cancelled','Declined')),
  start_at timestamp NOT NULL,
  start_type text NOT NULL CHECK (start_type IN ('Morning','Afternoon','Hours')),
  end_at timestamp NOT NULL,
  end_type text NOT NULL CHECK (end_type IN ('Morning','Afternoon','Hours')),
  booking_unit text NOT NULL CHECK (booking_unit IN ('Days','Hours')),
  duration numeric(10,3),
  deduction numeric(10,3),
  requested_by_id text,
  actioner_id text,
  auto_approved boolean NOT NULL DEFAULT false,
  source_updated_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now(),
  run_id bigint,
  gone_at timestamptz
);
COMMENT ON TABLE public.cockpit_timetastic_bookings IS
  'Timetastic bookings (holidays endpoint). No reason or decline reason is ever kept: they can carry medical detail.';
CREATE INDEX IF NOT EXISTS cockpit_timetastic_bookings_user_idx ON public.cockpit_timetastic_bookings(tt_user_id, start_at);

CREATE TABLE IF NOT EXISTS public.cockpit_timetastic_days (
  tt_user_id text NOT NULL,
  day date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('booking','public_holiday','non_working')),
  entity_key text NOT NULL,
  detail text,
  start_local text,
  end_local text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  run_id bigint,
  gone_at timestamptz,
  PRIMARY KEY (tt_user_id, day, kind, entity_key)
);

CREATE TABLE IF NOT EXISTS public.cockpit_time_adjustments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id bigint NOT NULL REFERENCES public.cockpit_people(id),
  month date NOT NULL CHECK (extract(day FROM month)=1),
  day date,
  kind text NOT NULL CHECK (kind IN ('absent_unpaid','excused_paid','hours','leave','count_work','overtime','manual_time','not_booked','no_leave_month','correction')),
  seconds integer CHECK (seconds IS NULL OR seconds BETWEEN 0 AND 86400*31),
  mode text CHECK (mode IS NULL OR mode IN ('replace','add')),
  paid_share numeric(4,3) CHECK (paid_share IS NULL OR (paid_share>=0 AND paid_share<=1)),
  decision text CHECK (decision IS NULL OR decision IN ('count','skip')),
  booking_id text,
  amount numeric(14,3),
  currency char(3),
  from_month date,
  carried boolean NOT NULL DEFAULT false,
  carry_kind text CHECK (carry_kind IS NULL OR carry_kind IN ('change','remainder','leave_out')),
  approval_id bigint,
  snapshot jsonb,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 300),
  set_by text NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  withdrawn_by text,
  withdrawn_reason text,
  CHECK (day IS NULL OR date_trunc('month', day)::date=month)
);
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_time_adjustments_day_uidx
  ON public.cockpit_time_adjustments(person_id, day, kind) WHERE withdrawn_at IS NULL AND day IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_time_adjustments_month_uidx
  ON public.cockpit_time_adjustments(person_id, month, kind, coalesce(booking_id,''), coalesce(from_month,'1900-01-01'::date), coalesce(carry_kind,''), coalesce(decision,''))
  WHERE withdrawn_at IS NULL AND day IS NULL;

CREATE TABLE IF NOT EXISTS public.cockpit_hours_pay_months (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  person_id bigint NOT NULL REFERENCES public.cockpit_people(id),
  month date NOT NULL CHECK (extract(day FROM month)=1),
  status text NOT NULL CHECK (status IN ('approved','paid','withdrawn')),
  rule_version text NOT NULL,
  inputs jsonb NOT NULL,
  result jsonb NOT NULL,
  inputs_hash text NOT NULL CHECK (inputs_hash ~ '^[0-9a-f]{64}$'),
  amount numeric(14,3) NOT NULL,
  currency char(3) NOT NULL,
  amount_usd numeric(14,2),
  usd_rate numeric(12,6),
  payable_s integer NOT NULL CHECK (payable_s>=0),
  shadow boolean NOT NULL DEFAULT false,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  paid_by text,
  paid_at timestamptz,
  paid_note text,
  withdrawn_by text,
  withdrawn_at timestamptz,
  withdrawn_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS cockpit_hours_pay_months_active_uidx
  ON public.cockpit_hours_pay_months(person_id, month) WHERE status<>'withdrawn';

CREATE TABLE IF NOT EXISTS public.cockpit_hours_sync_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  mode text NOT NULL CHECK (mode IN ('recent','deep','month','doctor')),
  window_from date,
  window_to date,
  dry_run boolean NOT NULL DEFAULT false,
  requested_by text NOT NULL,
  holder uuid NOT NULL,
  lease_until timestamptz NOT NULL,
  read_started_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  state text NOT NULL DEFAULT 'running' CHECK (state IN ('running','ok','failed','abandoned')),
  hubstaff jsonb,
  timetastic jsonb,
  crosscheck jsonb,
  error text
);
CREATE INDEX IF NOT EXISTS cockpit_hours_sync_runs_state_idx ON public.cockpit_hours_sync_runs(state, started_at DESC);

CREATE TABLE IF NOT EXISTS public.cockpit_hours_keys (
  provider text PRIMARY KEY CHECK (provider IN ('hubstaff','timetastic')),
  kind text NOT NULL CHECK (kind IN ('hubstaff_org','hubstaff_personal','timetastic')),
  secret text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  last4 text NOT NULL,
  account_id text,
  saved_by text NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  expires_on date,
  access_token text,
  access_expires_at timestamptz,
  exchange_started_at timestamptz,
  state text NOT NULL DEFAULT 'unchecked' CHECK (state IN ('connected','unchecked','refused','plan_blocked','needs_new_key','firewall_blocked')),
  state_note text,
  checked_at timestamptz
);
COMMENT ON TABLE public.cockpit_hours_keys IS
  'Hubstaff and Timetastic keys pasted by the CEO in Connections. No role has any grant: reached only through service-only SECURITY DEFINER functions. Nothing returns a key to a browser; only last4.';

CREATE TABLE IF NOT EXISTS public.cockpit_hours_provider_health (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL CHECK (provider IN ('hubstaff','hubstaff-auth','timetastic')),
  method text NOT NULL CHECK (method IN ('GET','POST')),
  resource text NOT NULL CHECK (length(resource)<=300 AND resource !~ '[[:space:]?#@]'),
  phase text NOT NULL CHECK (phase IN ('intent','response','unknown')),
  http_status integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  run_id bigint,
  receipt_index integer,
  error text CHECK (error IS NULL OR length(error)<=240)
);
COMMENT ON TABLE public.cockpit_hours_provider_health IS
  'Receipts for every Hubstaff and Timetastic call (intent, then response or unknown). A ledger of its own so a lapsed trial or a failed Saturday read never turns the guardian''s urgent check red.';
CREATE INDEX IF NOT EXISTS cockpit_hours_provider_health_created_idx ON public.cockpit_hours_provider_health(created_at DESC);

-- Row security on every table, every grant revoked, then the service path only.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cockpit_hours_terms','cockpit_pay_history','cockpit_schedule_history','cockpit_employment_periods',
    'cockpit_hours_rules','cockpit_leave_types','cockpit_leave_type_rules','cockpit_hours_holiday_overrides','cockpit_time_accounts',
    'cockpit_hubstaff_days','cockpit_hours_coverage','cockpit_timetastic_bookings','cockpit_timetastic_days','cockpit_time_adjustments',
    'cockpit_hours_pay_months','cockpit_hours_sync_runs','cockpit_hours_keys','cockpit_hours_provider_health'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', t);
  END LOOP;
END $$;
GRANT SELECT ON public.cockpit_hours_terms, public.cockpit_pay_history, public.cockpit_schedule_history,
  public.cockpit_employment_periods, public.cockpit_hours_rules, public.cockpit_leave_types, public.cockpit_leave_type_rules,
  public.cockpit_hours_holiday_overrides, public.cockpit_time_accounts, public.cockpit_hubstaff_days, public.cockpit_hours_coverage,
  public.cockpit_timetastic_bookings, public.cockpit_timetastic_days, public.cockpit_time_adjustments, public.cockpit_hours_pay_months,
  public.cockpit_hours_sync_runs TO service_role;
GRANT SELECT, INSERT ON public.cockpit_hours_provider_health TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.cockpit_hours_provider_health_id_seq TO service_role;
-- cockpit_hours_keys: no grant to any role, service_role included.

-- ---------------------------------------------------------------------------
-- 2. Guards: history and approvals are never deleted or truncated

CREATE OR REPLACE FUNCTION public.cockpit_hours_refuse_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  RAISE EXCEPTION '% rows are kept for good: withdraw or replace instead of deleting', TG_TABLE_NAME USING ERRCODE='42501';
END;
$$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cockpit_hours_pay_months','cockpit_time_adjustments','cockpit_pay_history','cockpit_schedule_history',
    'cockpit_employment_periods','cockpit_hours_terms'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t||'_guard_delete', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.cockpit_hours_refuse_delete()', t||'_guard_delete', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', t||'_guard_truncate', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.cockpit_hours_refuse_delete()', t||'_guard_truncate', t);
  END LOOP;
END $$;

-- Approved figures lock; only approved -> paid and approved -> withdrawn.
CREATE OR REPLACE FUNCTION public.cockpit_hours_pay_months_lock()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.inputs IS DISTINCT FROM OLD.inputs OR NEW.result IS DISTINCT FROM OLD.result OR NEW.amount IS DISTINCT FROM OLD.amount
    OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.payable_s IS DISTINCT FROM OLD.payable_s OR NEW.inputs_hash IS DISTINCT FROM OLD.inputs_hash
    OR NEW.person_id IS DISTINCT FROM OLD.person_id OR NEW.month IS DISTINCT FROM OLD.month OR NEW.rule_version IS DISTINCT FROM OLD.rule_version THEN
    RAISE EXCEPTION 'Approved figures lock; a later change is carried into the next month' USING ERRCODE='42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status='approved' AND NEW.status IN ('paid','withdrawn')) THEN
    RAISE EXCEPTION 'An approval can only be marked paid or withdrawn' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS cockpit_hours_pay_months_lock ON public.cockpit_hours_pay_months;
CREATE TRIGGER cockpit_hours_pay_months_lock BEFORE UPDATE ON public.cockpit_hours_pay_months
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_hours_pay_months_lock();

-- ---------------------------------------------------------------------------
-- 3. History triggers on cockpit_people (ours, AFTER, only on a real change)

CREATE OR REPLACE FUNCTION public.cockpit_hours_member_email()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(nullif(current_setting('cockpit.ceo_actor_email', true),''),
    (SELECT m.email FROM public.cockpit_members m WHERE m.auth_user_id=auth.uid() AND m.active LIMIT 1),
    'service-role')
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_people_pay()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_from date; v_cur public.cockpit_pay_history; v_today date:=public.cockpit_hours_kw_today();
  v_source text:=coalesce(nullif(current_setting('cockpit.pay_source', true),''),'roster');
BEGIN
  IF NEW.engagement='bot' THEN RETURN NEW; END IF;
  v_from:=coalesce(nullif(current_setting('cockpit.pay_effective_from', true),'')::date,
    CASE WHEN TG_OP='INSERT' THEN least(coalesce(NEW.started_on, v_today), v_today) ELSE v_today END);
  SELECT * INTO v_cur FROM public.cockpit_pay_history h WHERE h.person_id=NEW.id AND h.effective_from<=v_from
    ORDER BY h.effective_from DESC LIMIT 1;
  IF FOUND AND v_cur.monthly_cost IS NOT DISTINCT FROM NEW.monthly_cost::numeric AND v_cur.currency=NEW.currency THEN RETURN NEW; END IF;
  INSERT INTO public.cockpit_pay_history(person_id,effective_from,monthly_cost,currency,source,recorded_by)
  VALUES(NEW.id,v_from,NEW.monthly_cost,NEW.currency,CASE WHEN v_source IN ('roster','dated') THEN v_source ELSE 'roster' END,public.cockpit_hours_member_email())
  ON CONFLICT (person_id,effective_from) DO UPDATE SET monthly_cost=EXCLUDED.monthly_cost,currency=EXCLUDED.currency,
    source=EXCLUDED.source,replaced_at=now(),replaced_by=EXCLUDED.recorded_by;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_people_schedule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_from date; v_cur public.cockpit_schedule_history; v_today date:=public.cockpit_hours_kw_today();
BEGIN
  v_from:=coalesce(nullif(current_setting('cockpit.schedule_effective_from', true),'')::date,
    CASE WHEN TG_OP='INSERT' THEN least(coalesce(NEW.started_on, v_today), v_today) ELSE v_today END);
  SELECT * INTO v_cur FROM public.cockpit_schedule_history h WHERE h.person_id=NEW.id AND h.effective_from<=v_from
    ORDER BY h.effective_from DESC LIMIT 1;
  IF FOUND AND v_cur.schedule IS NOT DISTINCT FROM NEW.schedule THEN RETURN NEW; END IF;
  IF NOT FOUND AND NEW.schedule IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.cockpit_schedule_history(person_id,effective_from,schedule,source,recorded_by)
  VALUES(NEW.id,v_from,NEW.schedule,CASE WHEN nullif(current_setting('cockpit.schedule_effective_from', true),'') IS NULL THEN 'roster' ELSE 'dated' END,
    public.cockpit_hours_member_email())
  ON CONFLICT (person_id,effective_from) DO UPDATE SET schedule=EXCLUDED.schedule,source=EXCLUDED.source,recorded_by=EXCLUDED.recorded_by,recorded_at=now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_people_employment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_on date:=coalesce(nullif(current_setting('cockpit.employment_on', true),'')::date, public.cockpit_hours_kw_today());
  v_by text:=public.cockpit_hours_member_email(); v_from date; v_id bigint; v_start date;
BEGIN
  IF TG_OP='INSERT' THEN
    v_from:=coalesce(NEW.started_on,(NEW.added_at AT TIME ZONE 'Asia/Kuwait')::date);
    INSERT INTO public.cockpit_employment_periods(person_id,kind,from_day,to_day,source,recorded_by)
    VALUES(NEW.id,'employed',v_from,CASE WHEN NEW.ended_on IS NULL THEN NULL ELSE greatest(NEW.ended_on,v_from-1) END,'roster',v_by);
    IF NEW.paused_on IS NOT NULL THEN
      INSERT INTO public.cockpit_employment_periods(person_id,kind,from_day,source,recorded_by) VALUES(NEW.id,'paused',NEW.paused_on,'roster',v_by);
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.started_on IS DISTINCT FROM OLD.started_on AND NEW.started_on IS NOT NULL THEN
    SELECT id INTO v_id FROM public.cockpit_employment_periods WHERE person_id=NEW.id AND kind='employed' ORDER BY from_day LIMIT 1;
    IF v_id IS NOT NULL THEN UPDATE public.cockpit_employment_periods SET from_day=NEW.started_on WHERE id=v_id AND (to_day IS NULL OR to_day>=NEW.started_on-1); END IF;
  END IF;
  IF NEW.ended_on IS NOT NULL AND OLD.ended_on IS NULL THEN
    SELECT id,from_day INTO v_id,v_start FROM public.cockpit_employment_periods
      WHERE person_id=NEW.id AND kind='employed' AND to_day IS NULL ORDER BY from_day DESC LIMIT 1;
    IF v_id IS NOT NULL THEN
      -- Refused only against a real start (a start date, or a return): with no start date the
      -- period starts on the day they were added to the roster, a guess, and the roster's own
      -- save of an earlier last day must never fail here. That period then holds no days.
      IF NEW.ended_on<v_start AND NEW.started_on IS NOT NULL THEN
        RAISE EXCEPTION 'The last working day is before they started (%)', to_char(v_start,'DD Mon YYYY') USING ERRCODE='22023';
      END IF;
      UPDATE public.cockpit_employment_periods SET to_day=greatest(NEW.ended_on,v_start-1) WHERE id=v_id;
    END IF;
  ELSIF NEW.ended_on IS NOT NULL AND OLD.ended_on IS NOT NULL AND NEW.ended_on<>OLD.ended_on THEN
    UPDATE public.cockpit_employment_periods SET to_day=greatest(NEW.ended_on,from_day-1)
      WHERE id=(SELECT id FROM public.cockpit_employment_periods WHERE person_id=NEW.id AND kind='employed' AND to_day=OLD.ended_on ORDER BY from_day DESC LIMIT 1);
  ELSIF NEW.ended_on IS NULL AND OLD.ended_on IS NOT NULL THEN
    INSERT INTO public.cockpit_employment_periods(person_id,kind,from_day,source,recorded_by)
    VALUES(NEW.id,'employed',greatest(v_on,OLD.ended_on+1),'roster',v_by);
  END IF;
  IF NEW.paused_on IS NOT NULL AND OLD.paused_on IS NULL THEN
    INSERT INTO public.cockpit_employment_periods(person_id,kind,from_day,source,recorded_by) VALUES(NEW.id,'paused',NEW.paused_on,'roster',v_by);
  ELSIF NEW.paused_on IS NOT NULL AND OLD.paused_on IS NOT NULL AND NEW.paused_on<>OLD.paused_on THEN
    UPDATE public.cockpit_employment_periods SET from_day=NEW.paused_on
      WHERE id=(SELECT id FROM public.cockpit_employment_periods WHERE person_id=NEW.id AND kind='paused' AND to_day IS NULL ORDER BY from_day DESC LIMIT 1);
  ELSIF NEW.paused_on IS NULL AND OLD.paused_on IS NOT NULL THEN
    UPDATE public.cockpit_employment_periods SET to_day=greatest(v_on-1,from_day-1)
      WHERE id=(SELECT id FROM public.cockpit_employment_periods WHERE person_id=NEW.id AND kind='paused' AND to_day IS NULL ORDER BY from_day DESC LIMIT 1);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cockpit_hours_people_pay_insert ON public.cockpit_people;
CREATE TRIGGER cockpit_hours_people_pay_insert AFTER INSERT ON public.cockpit_people
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_hours_people_pay();
DROP TRIGGER IF EXISTS cockpit_hours_people_pay_update ON public.cockpit_people;
CREATE TRIGGER cockpit_hours_people_pay_update AFTER UPDATE OF monthly_cost, currency ON public.cockpit_people
  FOR EACH ROW WHEN (OLD.monthly_cost IS DISTINCT FROM NEW.monthly_cost OR OLD.currency IS DISTINCT FROM NEW.currency)
  EXECUTE FUNCTION public.cockpit_hours_people_pay();
DROP TRIGGER IF EXISTS cockpit_hours_people_schedule_insert ON public.cockpit_people;
CREATE TRIGGER cockpit_hours_people_schedule_insert AFTER INSERT ON public.cockpit_people
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_hours_people_schedule();
DROP TRIGGER IF EXISTS cockpit_hours_people_schedule_update ON public.cockpit_people;
CREATE TRIGGER cockpit_hours_people_schedule_update AFTER UPDATE OF schedule ON public.cockpit_people
  FOR EACH ROW WHEN (OLD.schedule IS DISTINCT FROM NEW.schedule)
  EXECUTE FUNCTION public.cockpit_hours_people_schedule();
DROP TRIGGER IF EXISTS cockpit_hours_people_employment_insert ON public.cockpit_people;
CREATE TRIGGER cockpit_hours_people_employment_insert AFTER INSERT ON public.cockpit_people
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_hours_people_employment();
DROP TRIGGER IF EXISTS cockpit_hours_people_employment_update ON public.cockpit_people;
CREATE TRIGGER cockpit_hours_people_employment_update AFTER UPDATE OF started_on, ended_on, paused_on ON public.cockpit_people
  FOR EACH ROW WHEN (OLD.started_on IS DISTINCT FROM NEW.started_on OR OLD.ended_on IS DISTINCT FROM NEW.ended_on OR OLD.paused_on IS DISTINCT FROM NEW.paused_on)
  EXECUTE FUNCTION public.cockpit_hours_people_employment();

-- ---------------------------------------------------------------------------
-- 4. Seeds (each guarded, so a second run writes nothing)

INSERT INTO public.cockpit_pay_history(person_id,effective_from,monthly_cost,currency,source,recorded_by)
SELECT p.id,coalesce(p.started_on,'2026-01-01'::date),p.monthly_cost,p.currency,'seed','migration 20261009a'
FROM public.cockpit_people p
WHERE p.monthly_cost IS NOT NULL AND p.engagement<>'bot'
  AND NOT EXISTS (SELECT 1 FROM public.cockpit_pay_history h WHERE h.person_id=p.id);

INSERT INTO public.cockpit_schedule_history(person_id,effective_from,schedule,source,recorded_by)
SELECT p.id,'2026-01-01'::date,p.schedule,'seed','migration 20261009a'
FROM public.cockpit_people p
WHERE p.schedule IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.cockpit_schedule_history h WHERE h.person_id=p.id);

INSERT INTO public.cockpit_employment_periods(person_id,kind,from_day,to_day,source,recorded_by)
SELECT p.id,'employed',coalesce(p.started_on,(p.added_at AT TIME ZONE 'Asia/Kuwait')::date),
  CASE WHEN p.ended_on IS NULL THEN NULL ELSE greatest(p.ended_on,coalesce(p.started_on,(p.added_at AT TIME ZONE 'Asia/Kuwait')::date)-1) END,
  'seed','migration 20261009a'
FROM public.cockpit_people p
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_employment_periods e WHERE e.person_id=p.id);

INSERT INTO public.cockpit_employment_periods(person_id,kind,from_day,source,recorded_by)
SELECT p.id,'paused',p.paused_on,'seed','migration 20261009a'
FROM public.cockpit_people p
WHERE p.paused_on IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.cockpit_employment_periods e WHERE e.person_id=p.id AND e.kind='paused');

-- ---------------------------------------------------------------------------
-- 5. Reading: sources, provider rows, the month's inputs

/**
 * Both scheduled reads exist and are on (20261009b applied): true or false;
 * null where cron.job can't be read (PGlite, no pg_cron). Until it is true no
 * sentence promises an hourly read.
 */
CREATE OR REPLACE FUNCTION public.cockpit_hours_cron_on()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v boolean:=NULL;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT count(*)=2 FROM cron.job WHERE jobname IN (''mahara-hours-sync'',''mahara-hours-deep'') AND active' INTO v;
    EXCEPTION WHEN others THEN v:=NULL;
    END;
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_sources()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE out jsonb:='[]'::jsonb; pv text; k public.cockpit_hours_keys; s record; st text; note text; label text;
  zone integer; acc record; hours_ago numeric; v_cron boolean:=public.cockpit_hours_cron_on();
BEGIN
  FOREACH pv IN ARRAY ARRAY['hubstaff','timetastic'] LOOP
    label:=CASE pv WHEN 'hubstaff' THEN 'Hubstaff' ELSE 'Timetastic' END;
    SELECT * INTO k FROM public.cockpit_hours_keys WHERE provider=pv;
    SELECT x.last_run_at,x.last_ok_at,x.ok,x.note INTO s FROM public.cockpit_sync_state x WHERE x.key=pv||'-sync';
    IF k.provider IS NULL THEN st:='missing_key';
    ELSIF k.state IN ('refused','plan_blocked','needs_new_key','unchecked','firewall_blocked') THEN st:=k.state;
    ELSIF s.last_run_at IS NULL AND s.last_ok_at IS NULL THEN st:='never_run';
    ELSIF s.ok IS FALSE AND s.last_run_at>coalesce(s.last_ok_at,'-infinity'::timestamptz) THEN st:='failing';
    ELSIF s.last_ok_at IS NULL THEN st:='never_run';
    ELSIF s.last_ok_at<now()-interval '3 hours' THEN st:='stale';
    ELSIF pv='hubstaff' AND k.expires_on IS NOT NULL AND k.expires_on<=public.cockpit_hours_kw_today()+14 THEN st:='expiring';
    ELSE st:='connected'; END IF;
    hours_ago:=floor(extract(epoch FROM now()-s.last_ok_at)/3600);
    note:=CASE
      WHEN st='missing_key' AND pv='hubstaff' THEN 'Hubstaff isn''t connected, so hours show as no data. As the Hubstaff owner, open Settings, Organization, API tokens, make an organisation token (it starts hsoat_), and paste it here.'
      WHEN st='missing_key' THEN 'Timetastic isn''t connected, so the cockpit doesn''t know about leave or public holidays. As a Timetastic admin, copy the token from app.timetastic.co.uk/api and paste it here.'
      WHEN st='unchecked' THEN format('The key is saved, but %s couldn''t be reached to check it. The next hourly read tries again.', label)
      WHEN st='refused' AND pv='hubstaff' AND k.state_note='role_not_manager' THEN 'This Hubstaff key belongs to an account that can''t read everyone''s time. Make the token as the organisation owner or a manager, and paste it here.'
      WHEN st='refused' AND pv='hubstaff' THEN 'Hubstaff refused the saved key. It may have expired or been revoked. Paste a new one here.'
      WHEN st='refused' THEN 'Timetastic refused the saved key. An admin can renew it at app.timetastic.co.uk/api. Paste the new one here.'
      WHEN st='plan_blocked' THEN 'Hubstaff says this plan doesn''t include API access. Check the plan in Hubstaff under Settings, Billing.'
      WHEN st='firewall_blocked' THEN 'Hubstaff''s firewall blocked the cockpit''s last request (error 1010), so nothing new was read. This isn''t a problem with the key. The next hourly read tries again, or press Sync now.'
      WHEN st='needs_new_key' THEN 'Hubstaff''s personal key was used up and can''t be renewed. Make a new personal token in Hubstaff and paste it here.'
      WHEN st='expiring' THEN format('The Hubstaff key expires about %s. Make a new one in Hubstaff and paste it here before then.', to_char(k.expires_on,'FMDD Mon'))
      WHEN st='stale' THEN format('%s was last read %s h ago. Press Sync now. If it fails, this card says why.', label, hours_ago)
      -- The hourly read is promised only once its job exists (20261009b), never before.
      WHEN st='never_run' AND v_cron IS TRUE THEN 'Nothing has been read yet. The hourly read runs at 17 minutes past the hour, or press Sync now.'
      WHEN st='never_run' THEN 'Nothing has been read yet. Press Sync now to read it.'
      WHEN st='failing' THEN format('The last %s read failed%s. The next hourly read tries again, or press Sync now.', label, CASE WHEN s.note IS NULL THEN '' ELSE ' ('||left(s.note,160)||')' END)
      ELSE NULL END;
    SELECT count(*) FILTER (WHERE NOT a.ignored) AS accounts,
           count(*) FILTER (WHERE a.person_id IS NOT NULL AND NOT a.ignored) AS linked,
           count(*) FILTER (WHERE a.person_id IS NULL AND NOT a.ignored) AS unlinked,
           count(*) FILTER (WHERE a.ignored) AS ignored
      INTO acc FROM public.cockpit_time_accounts a
      WHERE a.provider=pv AND coalesce(a.status,'') NOT IN ('removed','archived');
    SELECT count(*) INTO zone FROM public.cockpit_hubstaff_days h WHERE pv='hubstaff' AND h.zone_shifted AND h.gone_at IS NULL AND h.day>=public.cockpit_hours_kw_today()-31;
    out:=out||jsonb_build_array(jsonb_build_object(
      'provider',pv,'state',st,'note',note,
      'key',CASE WHEN k.provider IS NULL THEN NULL ELSE jsonb_build_object('kind',k.kind,'last4',k.last4,'savedAt',k.saved_at,'savedBy',k.saved_by,
        'expiresOn',to_char(k.expires_on,'YYYY-MM-DD')) END,
      'accountId',k.account_id,'lastRunAt',s.last_run_at,'lastOkAt',s.last_ok_at,'zoneShiftedDays',coalesce(zone,0),
      'accounts',coalesce(acc.accounts,0),'linked',coalesce(acc.linked,0),'unlinked',coalesce(acc.unlinked,0),'ignored',coalesce(acc.ignored,0)));
  END LOOP;
  RETURN out;
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_account_id(p_person bigint,p_provider text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT a.external_id FROM public.cockpit_time_accounts a WHERE a.provider=p_provider AND a.person_id=p_person AND NOT a.ignored LIMIT 1
$$;

/** The Timetastic user standing for the CEO: linked to a CEO-role person, else the CEO's own address. */
CREATE OR REPLACE FUNCTION public.cockpit_hours_ceo_tt_user()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(
    (SELECT a.external_id FROM public.cockpit_time_accounts a JOIN public.cockpit_people p ON p.id=a.person_id
      WHERE a.provider='timetastic' AND p.role ~* '\mceo\M|founder' ORDER BY a.external_id LIMIT 1),
    (SELECT a.external_id FROM public.cockpit_time_accounts a WHERE a.provider='timetastic'
      AND lower(btrim(a.email)) IN ('aziz@maharamedia.com','awaheedi2008@gmail.com') ORDER BY a.external_id LIMIT 1))
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_hub_days_json(p_account text,p_from date,p_to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'day',to_char(h.day,'YYYY-MM-DD'),
    'trackedS',CASE WHEN h.gone_at IS NULL THEN h.tracked_s ELSE 0 END,
    'manualS',CASE WHEN h.gone_at IS NULL THEN h.manual_s ELSE 0 END,
    'idleS',CASE WHEN h.gone_at IS NULL THEN h.idle_s ELSE 0 END,
    'breakS',CASE WHEN h.gone_at IS NULL THEN h.break_s ELSE 0 END,
    'overallS',CASE WHEN h.gone_at IS NULL THEN h.overall_s ELSE 0 END,
    'inputTrackedS',CASE WHEN h.gone_at IS NULL THEN h.input_tracked_s ELSE 0 END,
    'dailyTrackedS',CASE WHEN h.gone_at IS NULL THEN h.daily_tracked_s ELSE NULL END,
    'zoneShifted',h.zone_shifted,
    'verified',CASE WHEN h.gone_at IS NULL THEN h.verified ELSE true END,
    'previousTrackedS',CASE WHEN h.gone_at IS NULL THEN h.previous_tracked_s ELSE h.tracked_s END,
    'changedAt',CASE WHEN h.gone_at IS NULL THEN h.changed_at ELSE h.gone_at END
  ) ORDER BY h.day),'[]'::jsonb)
  FROM public.cockpit_hubstaff_days h
  WHERE p_account IS NOT NULL AND h.hubstaff_user_id=p_account AND h.day BETWEEN p_from AND p_to
    AND (h.gone_at IS NULL OR h.tracked_s>900)
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_bookings_json(p_tt text,p_from date,p_to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'bookingId',b.booking_id,'ttUserId',b.tt_user_id,'leaveTypeId',b.leave_type_id,'leaveTypeName',coalesce(b.leave_type_name,'Leave'),
    'status',b.status,'startAt',to_char(b.start_at,'YYYY-MM-DD"T"HH24:MI:SS'),'startType',b.start_type,
    'endAt',to_char(b.end_at,'YYYY-MM-DD"T"HH24:MI:SS'),'endType',b.end_type,'bookingUnit',b.booking_unit,
    'deduction',b.deduction,'requestedById',b.requested_by_id,'actionerId',b.actioner_id,'autoApproved',b.auto_approved
  ) ORDER BY b.start_at,b.booking_id),'[]'::jsonb)
  FROM public.cockpit_timetastic_bookings b
  WHERE p_tt IS NOT NULL AND b.tt_user_id=p_tt AND b.gone_at IS NULL AND b.start_at::date<=p_to AND b.end_at::date>=p_from
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_tt_days_json(p_tt text,p_from date,p_to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('day',to_char(d.day,'YYYY-MM-DD'),'kind',d.kind,'entityId',d.entity_key,'detail',d.detail)
    ORDER BY d.day,d.kind,d.entity_key),'[]'::jsonb)
  FROM public.cockpit_timetastic_days d
  WHERE p_tt IS NOT NULL AND d.tt_user_id=p_tt AND d.gone_at IS NULL AND d.day BETWEEN p_from AND p_to
$$;

/** Public holidays for one person: Timetastic's for their user (or the CEO's, without a link), plus adds and minus removes in scope. */
CREATE OR REPLACE FUNCTION public.cockpit_hours_holidays_json(p_person bigint,p_from date,p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_tt text; v_country text; out jsonb;
BEGIN
  v_tt:=coalesce(public.cockpit_hours_account_id(p_person,'timetastic'),public.cockpit_hours_ceo_tt_user());
  SELECT coalesce(t.works_in,(SELECT a.extra->>'countryCode' FROM public.cockpit_time_accounts a WHERE a.provider='timetastic' AND a.person_id=p_person LIMIT 1),t.contract_country)
    INTO v_country FROM (SELECT 1) one LEFT JOIN public.cockpit_hours_terms t ON t.person_id=p_person;
  WITH scoped AS (
    SELECT o.* FROM public.cockpit_hours_holiday_overrides o
    WHERE o.withdrawn_at IS NULL AND o.day BETWEEN p_from AND p_to
      AND (o.scope='all' OR (o.scope='country' AND o.scope_value=upper(coalesce(v_country,''))) OR (o.scope='person' AND o.scope_value=p_person::text))
  ), base AS (
    SELECT DISTINCT ON (d.day) d.day,coalesce(nullif(btrim(d.detail),''),'Public holiday') AS name,'timetastic'::text AS source
    FROM public.cockpit_timetastic_days d
    WHERE v_tt IS NOT NULL AND d.tt_user_id=v_tt AND d.kind='public_holiday' AND d.gone_at IS NULL AND d.day BETWEEN p_from AND p_to
    ORDER BY d.day,d.entity_key
  ), kept AS (
    SELECT * FROM base b WHERE NOT EXISTS (SELECT 1 FROM scoped s WHERE s.action='remove' AND s.day=b.day)
    UNION ALL
    SELECT s.day,s.name,'override' FROM scoped s WHERE s.action='add'
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('day',to_char(k.day,'YYYY-MM-DD'),'name',k.name,'source',k.source) ORDER BY k.day),'[]'::jsonb)
    INTO out FROM kept k;
  RETURN out;
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_coverage_json(p_from date,p_to date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object(
    'hubstaff',coalesce((SELECT jsonb_agg(to_char(c.day,'YYYY-MM-DD') ORDER BY c.day) FROM public.cockpit_hours_coverage c WHERE c.provider='hubstaff' AND c.day BETWEEN p_from AND p_to),'[]'::jsonb),
    'timetastic',coalesce((SELECT jsonb_agg(to_char(c.day,'YYYY-MM-DD') ORDER BY c.day) FROM public.cockpit_hours_coverage c WHERE c.provider='timetastic' AND c.day BETWEEN p_from AND p_to),'[]'::jsonb))
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_approval_json(r public.cockpit_hours_pay_months)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('status',r.status,'ruleVersion',r.rule_version,'inputsHash',r.inputs_hash,'shadow',r.shadow,
    'amount',r.amount,'currency',r.currency,'amountUsd',r.amount_usd,'payableS',r.payable_s,'approvedAt',r.approved_at,
    'approvedBy',r.approved_by,'paidAt',r.paid_at,'paidNote',r.paid_note,'inputs',r.inputs,'result',r.result,
    'carriedSoFar',coalesce((SELECT sum(a.amount) FROM public.cockpit_time_adjustments a WHERE a.person_id=r.person_id AND a.from_month=r.month
      AND a.kind='correction' AND a.carry_kind IN ('change','leave_out') AND a.withdrawn_at IS NULL),0))
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_adjustments_json(p_person bigint,p_month date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'kind',a.kind,'month',to_char(a.month,'YYYY-MM'),'day',to_char(a.day,'YYYY-MM-DD'),'seconds',a.seconds,'mode',a.mode,
    'paidShare',a.paid_share,'decision',CASE WHEN a.carry_kind='leave_out' THEN 'skip' ELSE a.decision END,'bookingId',a.booking_id,
    'amount',a.amount,'currency',a.currency,'fromMonth',to_char(a.from_month,'YYYY-MM'),'carried',a.carried,'snapshot',a.snapshot,
    'reason',a.reason,'setBy',a.set_by,'setAt',a.set_at) ORDER BY a.id),'[]'::jsonb)
  FROM public.cockpit_time_adjustments a
  WHERE a.person_id=p_person AND a.month=p_month AND a.withdrawn_at IS NULL
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_inputs_body(p_month date,p_person bigint)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m0 date:=date_trunc('month',p_month)::date; m1 date; v_today date:=public.cockpit_hours_kw_today();
  v_close timestamptz; v_people jsonb; v_rules jsonb; v_leave jsonb; v_over jsonb; v_cov jsonb; v_closed jsonb; v_ceo_tt text;
BEGIN
  IF p_month IS NULL THEN RAISE EXCEPTION 'Choose a month' USING ERRCODE='22023'; END IF;
  m1:=(m0+interval '1 month'-interval '1 day')::date;
  v_close:=((m0+interval '1 month')::date+2)::timestamp AT TIME ZONE 'Asia/Kuwait';
  v_ceo_tt:=public.cockpit_hours_ceo_tt_user();
  SELECT jsonb_build_object('fromMonth',to_char(r.from_month,'YYYY-MM'),'settings',r.settings,'savedBy',r.saved_by,'savedAt',r.saved_at)
    INTO v_rules FROM public.cockpit_hours_rules r WHERE r.from_month<=m0 ORDER BY r.from_month DESC LIMIT 1;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'externalId',t.external_id,'name',t.name,'active',t.active,'deducted',coalesce(t.deducted,false),'requiresApproval',coalesce(t.requires_approval,false),
      'payRule',r.pay_rule,'paidShare',r.paid_share,'ruleFromMonth',to_char(r.from_month,'YYYY-MM'),
      'suggested',CASE WHEN t.name ~* 'unpaid' THEN 'unpaid' WHEN t.name ~* 'working from home|wfh|meeting|remote' THEN 'not_leave'
        WHEN t.name ~* 'holiday|annual|sick|maternity|paternity|compassionate|bereavement' THEN 'paid' ELSE NULL END,
      'bookingsThisMonth',(SELECT count(*) FROM public.cockpit_timetastic_bookings b WHERE b.leave_type_id=t.external_id AND b.gone_at IS NULL
        AND b.status IN ('Pending','Approved') AND b.start_at::date<=m1 AND b.end_at::date>=m0)
    ) ORDER BY t.name),'[]'::jsonb)
    INTO v_leave
    FROM public.cockpit_leave_types t
    LEFT JOIN LATERAL (SELECT * FROM public.cockpit_leave_type_rules x WHERE x.provider=t.provider AND x.external_id=t.external_id AND x.from_month<=m0
      ORDER BY x.from_month DESC LIMIT 1) r ON true
    WHERE t.provider='timetastic';
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,'day',to_char(o.day,'YYYY-MM-DD'),'action',o.action,'name',o.name,'scope',o.scope,
      'scopeValue',o.scope_value,'reason',o.reason) ORDER BY o.day,o.id),'[]'::jsonb)
    INTO v_over FROM public.cockpit_hours_holiday_overrides o WHERE o.withdrawn_at IS NULL AND o.day BETWEEN m0 AND m1;
  v_cov:=public.cockpit_hours_coverage_json(m0,m1);
  v_closed:=jsonb_build_object(
    'hubstaff',(SELECT count(*) FROM public.cockpit_hours_coverage c WHERE c.provider='hubstaff' AND c.day BETWEEN m0 AND m1 AND c.last_ok_at>=v_close)=(m1-m0+1),
    'timetastic',(SELECT count(*) FROM public.cockpit_hours_coverage c WHERE c.provider='timetastic' AND c.day BETWEEN m0 AND m1 AND c.last_ok_at>=v_close)=(m1-m0+1));

  SELECT coalesce(jsonb_agg(person ORDER BY person->>'name',(person->>'personId')::bigint),'[]'::jsonb) INTO v_people
  FROM (
    SELECT jsonb_build_object(
      'personId',p.id,'name',p.name,'role',p.role,'engagement',p.engagement,'active',p.active,
      'startedOn',to_char(p.started_on,'YYYY-MM-DD'),'endedOn',to_char(p.ended_on,'YYYY-MM-DD'),
      'addedOn',to_char((p.added_at AT TIME ZONE 'Asia/Kuwait')::date,'YYYY-MM-DD'),
      'employment',coalesce((SELECT jsonb_agg(jsonb_build_object('kind',e.kind,'from',to_char(e.from_day,'YYYY-MM-DD'),'to',to_char(e.to_day,'YYYY-MM-DD'))
        ORDER BY e.from_day,e.id) FROM public.cockpit_employment_periods e WHERE e.person_id=p.id),'[]'::jsonb),
      'terms',jsonb_build_object('tracking',t.tracking,'payBasis',t.pay_basis,'hoursPayFrom',to_char(t.hours_pay_from,'YYYY-MM'),
        'termsConfirmedAt',t.terms_confirmed_at,'contractCountry',t.contract_country,'worksIn',t.works_in,'kwClauseReviewedAt',t.kw_clause_reviewed_at),
      'schedules',coalesce((SELECT jsonb_agg(jsonb_build_object('effectiveFrom',to_char(h.effective_from,'YYYY-MM-DD'),'schedule',h.schedule) ORDER BY h.effective_from)
        FROM public.cockpit_schedule_history h WHERE h.person_id=p.id AND h.effective_from<=m1
          AND h.effective_from>=coalesce((SELECT max(z.effective_from) FROM public.cockpit_schedule_history z WHERE z.person_id=p.id AND z.effective_from<=m0),'1900-01-01'::date)),'[]'::jsonb),
      'payHistory',coalesce((SELECT jsonb_agg(jsonb_build_object('effectiveFrom',to_char(h.effective_from,'YYYY-MM-DD'),'monthlyCost',h.monthly_cost,'currency',h.currency,'source',h.source) ORDER BY h.effective_from)
        FROM public.cockpit_pay_history h WHERE h.person_id=p.id AND h.effective_from<=m1
          AND h.effective_from>=coalesce((SELECT max(z.effective_from) FROM public.cockpit_pay_history z WHERE z.person_id=p.id AND z.effective_from<=m0),'1900-01-01'::date)),'[]'::jsonb),
      'accounts',coalesce((SELECT jsonb_agg(jsonb_build_object(
          'provider',a.provider,'externalId',a.external_id,'email',a.email,'name',a.name,'linkMethod',a.link_method,'status',a.status,
          'memberSince',to_char(a.member_since,'YYYY-MM-DD'),'removedOn',to_char(a.removed_on,'YYYY-MM-DD'),'trackable',a.trackable,
          'lastClientActivityOn',to_char(a.last_client_activity_on,'YYYY-MM-DD'),'online',a.online,'lastActivityAt',a.last_activity_at,
          'allowanceRemaining',CASE WHEN a.provider='timetastic' AND jsonb_typeof(a.extra->'allowanceRemaining')='number' THEN (a.extra->>'allowanceRemaining')::numeric END,
          'allowanceUnit',CASE WHEN a.provider='timetastic' AND a.extra->>'allowanceUnit' IN ('Days','Hours') THEN a.extra->>'allowanceUnit' END,
          'scheduleMismatch',public.cockpit_hours_schedule_mismatch(a.extra,p.schedule),
          'emailDiffers',coalesce(a.email IS NOT NULL AND p.email IS NOT NULL AND lower(btrim(a.email))<>lower(btrim(p.email)),false)
        ) ORDER BY a.provider) FROM public.cockpit_time_accounts a WHERE a.person_id=p.id AND NOT a.ignored),'[]'::jsonb),
      'hubstaffDays',public.cockpit_hours_hub_days_json(public.cockpit_hours_account_id(p.id,'hubstaff'),m0,m1),
      'bookings',public.cockpit_hours_bookings_json(public.cockpit_hours_account_id(p.id,'timetastic'),m0,m1),
      'ttDays',public.cockpit_hours_tt_days_json(public.cockpit_hours_account_id(p.id,'timetastic'),m0,m1),
      'holidays',public.cockpit_hours_holidays_json(p.id,m0,m1),
      'adjustments',public.cockpit_hours_adjustments_json(p.id,m0),
      'sickDaysThisYear',(SELECT coalesce(sum(greatest(0,least(b.end_at::date,m1)-greatest(b.start_at::date,date_trunc('year',m0)::date)+1)),0)
        FROM public.cockpit_timetastic_bookings b JOIN public.cockpit_time_accounts a ON a.provider='timetastic' AND a.external_id=b.tt_user_id AND a.person_id=p.id
        WHERE b.gone_at IS NULL AND b.status='Approved' AND b.leave_type_name ~* 'sick' AND b.end_at::date>=date_trunc('year',m0)::date AND b.start_at::date<=m1),
      'approval',(SELECT public.cockpit_hours_approval_json(pm) FROM public.cockpit_hours_pay_months pm WHERE pm.person_id=p.id AND pm.month=m0 AND pm.status<>'withdrawn'),
      'priorApprovals',coalesce((SELECT jsonb_agg(jsonb_build_object(
          'month',to_char(pm.month,'YYYY-MM'),
          'approval',public.cockpit_hours_approval_json(pm),
          'current',jsonb_build_object(
            'hubstaffDays',public.cockpit_hours_hub_days_json(public.cockpit_hours_account_id(p.id,'hubstaff'),pm.month,(pm.month+interval '1 month'-interval '1 day')::date),
            'bookings',public.cockpit_hours_bookings_json(public.cockpit_hours_account_id(p.id,'timetastic'),pm.month,(pm.month+interval '1 month'-interval '1 day')::date),
            'ttDays',public.cockpit_hours_tt_days_json(public.cockpit_hours_account_id(p.id,'timetastic'),pm.month,(pm.month+interval '1 month'-interval '1 day')::date),
            'holidays',public.cockpit_hours_holidays_json(p.id,pm.month,(pm.month+interval '1 month'-interval '1 day')::date),
            'coverage',public.cockpit_hours_coverage_json(pm.month,(pm.month+interval '1 month'-interval '1 day')::date)),
          'carried',coalesce((SELECT sum(a.amount) FROM public.cockpit_time_adjustments a WHERE a.person_id=p.id AND a.from_month=pm.month
            AND a.kind='correction' AND a.carry_kind IN ('change','leave_out') AND a.withdrawn_at IS NULL),0)
        ) ORDER BY pm.month)
        FROM public.cockpit_hours_pay_months pm WHERE pm.person_id=p.id AND pm.status<>'withdrawn'
          AND pm.month>=(m0-interval '6 months')::date AND pm.month<m0),'[]'::jsonb)
    ) AS person
    FROM public.cockpit_people p
    LEFT JOIN public.cockpit_hours_terms t ON t.person_id=p.id
    WHERE (p_person IS NULL OR p.id=p_person)
      AND (p.active OR p.ended_on IS NULL OR p.ended_on>=(m0-interval '7 months')::date)
  ) q;

  RETURN jsonb_build_object(
    'month',to_char(m0,'YYYY-MM'),
    'today',to_char(v_today,'YYYY-MM-DD'),
    'nowMinute',(extract(hour FROM now() AT TIME ZONE 'Asia/Kuwait')*60+extract(minute FROM now() AT TIME ZONE 'Asia/Kuwait'))::integer,
    'rules',v_rules,
    'sources',public.cockpit_hours_sources(),
    'coverage',v_cov,
    'closed',v_closed,
    'leaveTypes',v_leave,
    'holidayOverrides',v_over,
    'ceoTtUserId',v_ceo_tt,
    'people',v_people,
    -- The Costs page's fixed planning rates (ceoCostsClient.ts USD_PER), display only.
    'usdPer',jsonb_build_object('USD',1,'KWD',3.26,'AED',0.2723,'SAR',0.2666,'QAR',0.2747));
END;
$$;

/** Timetastic's working week against the roster's, in plain words, or null when they agree. */
CREATE OR REPLACE FUNCTION public.cockpit_hours_schedule_mismatch(p_extra jsonb,p_schedule jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE tt text[]; ros text[]; d text; names constant text[]:=ARRAY['sat','sun','mon','tue','wed','thu','fri'];
BEGIN
  IF jsonb_typeof(p_extra->'workDays') IS DISTINCT FROM 'array' OR jsonb_typeof(p_schedule->'week') IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
  FOREACH d IN ARRAY names LOOP
    IF p_extra->'workDays' ? d THEN tt:=array_append(tt,initcap(d)); END IF;
    IF (p_schedule->'week'->d->>'on')='true' THEN ros:=array_append(ros,initcap(d)); END IF;
  END LOOP;
  IF coalesce(tt,'{}')=coalesce(ros,'{}') THEN RETURN NULL; END IF;
  RETURN format('Timetastic: %s; roster: %s', coalesce(array_to_string(tt,', '),'none'), coalesce(array_to_string(ros,', '),'none'));
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_inputs(p_month date,p_person bigint DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.cockpit_hours_require_service();
  RETURN public.cockpit_hours_inputs_body(p_month,p_person);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_hours_inputs(p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF public.cockpit_is_ceo() IS NOT TRUE THEN RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501'; END IF;
  RETURN public.cockpit_hours_inputs_body(p_month,NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_hours_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_run jsonb; v_cron boolean:=public.cockpit_hours_cron_on(); v_accounts jsonb;
BEGIN
  IF public.cockpit_is_ceo() IS NOT TRUE THEN RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object('id',r.id,'mode',r.mode,'state',r.state,'finishedAt',r.finished_at) INTO v_run
    FROM public.cockpit_hours_sync_runs r ORDER BY r.started_at DESC, r.id DESC LIMIT 1;
  SELECT coalesce(jsonb_agg(jsonb_build_object('provider',a.provider,'externalId',a.external_id,'email',a.email,'name',a.name,'status',a.status,
      'membershipRole',a.membership_role,'personId',a.person_id,'linkMethod',a.link_method,'ignored',a.ignored,
      'emailDiffers',coalesce(a.email IS NOT NULL AND p.email IS NOT NULL AND lower(btrim(a.email))<>lower(btrim(p.email)),false))
      ORDER BY a.provider,a.person_id NULLS FIRST,a.name),'[]'::jsonb)
    INTO v_accounts FROM public.cockpit_time_accounts a LEFT JOIN public.cockpit_people p ON p.id=a.person_id
    WHERE coalesce(a.status,'') NOT IN ('removed','archived') OR a.person_id IS NOT NULL;
  RETURN jsonb_build_object('sources',public.cockpit_hours_sources(),'lastRun',v_run,'cronScheduled',v_cron,'accounts',v_accounts);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_hours_costs()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE out jsonb;
BEGIN
  IF public.cockpit_is_ceo() IS NOT TRUE THEN RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('personId',m.person_id,'month',to_char(m.month,'YYYY-MM'),'status',m.status,'amount',m.amount,
      'currency',m.currency,'amountUsd',m.amount_usd,'shadow',m.shadow) ORDER BY m.month DESC,m.person_id),'[]'::jsonb)
    INTO out FROM public.cockpit_hours_pay_months m
    WHERE m.status IN ('approved','paid') AND m.month>=(date_trunc('month',public.cockpit_hours_kw_today())-interval '3 months')::date;
  RETURN out;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. CEO writes (one audit row each, never an amount)

CREATE OR REPLACE FUNCTION public.cockpit_hours_person(p jsonb)
RETURNS public.cockpit_people LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.cockpit_people;
BEGIN
  IF jsonb_typeof(p->'personId') IS DISTINCT FROM 'number' OR (p->>'personId')::numeric<>trunc((p->>'personId')::numeric) THEN
    RAISE EXCEPTION 'Choose a person first' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v FROM public.cockpit_people WHERE id=(p->>'personId')::bigint;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nobody on the roster has that id' USING ERRCODE='22023'; END IF;
  RETURN v;
END;
$$;

/** The latest approved (or paid) month of a person, or null. */
CREATE OR REPLACE FUNCTION public.cockpit_hours_last_approved(p_person bigint)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT max(m.month) FROM public.cockpit_hours_pay_months m WHERE m.person_id=p_person AND m.status IN ('approved','paid')
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_hours_terms_save(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); v_person public.cockpit_people; t public.cockpit_hours_terms; k text;
  v_fields text[]:='{}'; v_values jsonb:='{}'; d record; v_track text; v_basis text; v_from date;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Settings must be an object' USING ERRCODE='22023'; END IF;
  v_person:=public.cockpit_hours_person(p);
  FOR k IN SELECT jsonb_object_keys(p) LOOP
    IF k<>ALL(ARRAY['personId','tracking','payBasis','hoursPayFrom','termsConfirmed','contractCountry','worksIn','kwClauseReviewed']) THEN
      RAISE EXCEPTION 'Unsupported setting: %',k USING ERRCODE='22023';
    END IF;
  END LOOP;
  INSERT INTO public.cockpit_hours_terms(person_id,updated_by) VALUES(v_person.id,v_actor) ON CONFLICT (person_id) DO NOTHING;
  SELECT * INTO t FROM public.cockpit_hours_terms WHERE person_id=v_person.id FOR UPDATE;
  IF p ? 'tracking' THEN
    IF p->'tracking'<>'null'::jsonb AND (p->>'tracking') NOT IN ('required','optional','exempt') THEN RAISE EXCEPTION 'Tracking is required, optional or exempt' USING ERRCODE='22023'; END IF;
    t.tracking:=p->>'tracking'; v_fields:=array_append(v_fields,'tracking'); v_values:=v_values||jsonb_build_object('tracking',p->'tracking');
  END IF;
  IF p ? 'payBasis' THEN
    IF p->'payBasis'<>'null'::jsonb AND (p->>'payBasis') NOT IN ('hours','fixed') THEN RAISE EXCEPTION 'Pay follows hours or is fixed' USING ERRCODE='22023'; END IF;
    t.pay_basis:=p->>'payBasis'; v_fields:=array_append(v_fields,'payBasis'); v_values:=v_values||jsonb_build_object('payBasis',p->'payBasis');
  END IF;
  IF p ? 'contractCountry' THEN
    IF p->'contractCountry'<>'null'::jsonb AND upper(p->>'contractCountry') !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'A country is two letters, like KW or EG' USING ERRCODE='22023'; END IF;
    t.contract_country:=upper(p->>'contractCountry'); v_fields:=array_append(v_fields,'contractCountry'); v_values:=v_values||jsonb_build_object('contractCountry',upper(p->>'contractCountry'));
  END IF;
  IF p ? 'worksIn' THEN
    IF p->'worksIn'<>'null'::jsonb AND upper(p->>'worksIn') !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'A country is two letters, like KW or EG' USING ERRCODE='22023'; END IF;
    t.works_in:=upper(p->>'worksIn'); v_fields:=array_append(v_fields,'worksIn'); v_values:=v_values||jsonb_build_object('worksIn',upper(p->>'worksIn'));
  END IF;
  IF p ? 'termsConfirmed' THEN
    IF p->'termsConfirmed'<>'true'::jsonb THEN RAISE EXCEPTION 'Tick the box to confirm the signed contract' USING ERRCODE='22023'; END IF;
    t.terms_confirmed_at:=now(); t.terms_confirmed_by:=v_actor; v_fields:=array_append(v_fields,'termsConfirmed');
  END IF;
  IF p ? 'kwClauseReviewed' THEN
    IF p->'kwClauseReviewed'<>'true'::jsonb THEN RAISE EXCEPTION 'Tick the box to confirm the lawyer''s review' USING ERRCODE='22023'; END IF;
    t.kw_clause_reviewed_at:=now(); t.kw_clause_reviewed_by:=v_actor; v_fields:=array_append(v_fields,'kwClauseReviewed');
  END IF;
  IF p ? 'hoursPayFrom' THEN
    t.hours_pay_from:=CASE WHEN p->'hoursPayFrom'='null'::jsonb THEN NULL ELSE public.cockpit_hours_month(p->>'hoursPayFrom') END;
    v_fields:=array_append(v_fields,'hoursPayFrom'); v_values:=v_values||jsonb_build_object('hoursPayFrom',to_char(t.hours_pay_from,'YYYY-MM'));
  END IF;
  SELECT * INTO d FROM public.cockpit_hours_role_default(v_person.role,v_person.engagement);
  v_track:=coalesce(t.tracking,d.tracking); v_basis:=coalesce(t.pay_basis,d.pay_basis);
  IF v_basis='hours' AND v_track<>'required' THEN RAISE EXCEPTION 'Pay can follow hours only when tracking is required' USING ERRCODE='22023'; END IF;
  IF t.hours_pay_from IS NOT NULL THEN
    IF v_basis<>'hours' THEN RAISE EXCEPTION 'Set pay to follow hours before choosing a month' USING ERRCODE='22023'; END IF;
    IF t.terms_confirmed_at IS NULL THEN RAISE EXCEPTION 'Confirm the signed contract says pay follows tracked hours' USING ERRCODE='22023'; END IF;
    IF t.contract_country IS NULL THEN RAISE EXCEPTION 'Choose the contract country first' USING ERRCODE='22023'; END IF;
    IF t.contract_country='KW' AND t.kw_clause_reviewed_at IS NULL THEN
      RAISE EXCEPTION 'A Kuwaiti lawyer has to review the pay-follows-hours clause first' USING ERRCODE='22023';
    END IF;
    -- Switching pay to hours from a month already under way would cut pay already earned (design 4.1, decision 13).
    IF t.contract_country='KW' AND (p ? 'hoursPayFrom')
       AND t.hours_pay_from<=date_trunc('month',public.cockpit_hours_kw_today())::date THEN
      RAISE EXCEPTION 'Kuwait law doesn''t allow a backdated pay cut. Choose next month or later' USING ERRCODE='22023';
    END IF;
    v_from:=public.cockpit_hours_last_approved(v_person.id);
    IF v_from IS NOT NULL AND t.hours_pay_from<=v_from AND (p ? 'hoursPayFrom') THEN
      RAISE EXCEPTION '% is approved. Choose % or later', public.cockpit_hours_month_name(v_from), public.cockpit_hours_month_name((v_from+interval '1 month')::date) USING ERRCODE='22023';
    END IF;
  END IF;
  UPDATE public.cockpit_hours_terms SET tracking=t.tracking,pay_basis=t.pay_basis,hours_pay_from=t.hours_pay_from,
    terms_confirmed_at=t.terms_confirmed_at,terms_confirmed_by=t.terms_confirmed_by,contract_country=t.contract_country,
    works_in=t.works_in,kw_clause_reviewed_at=t.kw_clause_reviewed_at,kw_clause_reviewed_by=t.kw_clause_reviewed_by,
    updated_at=now(),updated_by=v_actor WHERE person_id=v_person.id;
  PERFORM public.cockpit_hours_audit('hours.terms','cockpit_hours_terms',v_person.id::text,jsonb_build_object('fields',to_jsonb(v_fields),'values',v_values),v_actor);
  RETURN jsonb_build_object('ok',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_hours_link(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); a public.cockpit_time_accounts; v_person bigint; v_label text;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR (p->>'provider') NOT IN ('hubstaff','timetastic') OR coalesce(p->>'externalId','')='' THEN
    RAISE EXCEPTION 'Choose an account first' USING ERRCODE='22023';
  END IF;
  v_label:=CASE p->>'provider' WHEN 'hubstaff' THEN 'Hubstaff' ELSE 'Timetastic' END;
  SELECT * INTO a FROM public.cockpit_time_accounts WHERE provider=p->>'provider' AND external_id=p->>'externalId' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That % account isn''t in the last read', v_label USING ERRCODE='22023'; END IF;
  IF p ? 'ignored' THEN
    IF jsonb_typeof(p->'ignored') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Not on the roster is yes or no' USING ERRCODE='22023'; END IF;
    UPDATE public.cockpit_time_accounts SET ignored=(p->>'ignored')::boolean,
      person_id=CASE WHEN (p->>'ignored')::boolean THEN NULL ELSE person_id END,
      link_method=CASE WHEN (p->>'ignored')::boolean THEN NULL ELSE link_method END,
      linked_by=v_actor,linked_at=now() WHERE provider=a.provider AND external_id=a.external_id;
    PERFORM public.cockpit_hours_audit('hours.ignore','cockpit_time_accounts',a.provider||':'||a.external_id,
      jsonb_build_object('provider',a.provider,'externalId',a.external_id,'ignored',(p->>'ignored')::boolean),v_actor);
    RETURN jsonb_build_object('ok',true);
  END IF;
  IF NOT (p ? 'personId') THEN RAISE EXCEPTION 'Choose a person, or Not on the roster' USING ERRCODE='22023'; END IF;
  IF p->'personId'='null'::jsonb THEN
    UPDATE public.cockpit_time_accounts SET person_id=NULL,link_method=NULL,linked_by=v_actor,linked_at=now() WHERE provider=a.provider AND external_id=a.external_id;
    PERFORM public.cockpit_hours_audit('hours.unlink','cockpit_time_accounts',a.provider||':'||a.external_id,
      jsonb_build_object('provider',a.provider,'externalId',a.external_id,'personId',a.person_id),v_actor);
    RETURN jsonb_build_object('ok',true);
  END IF;
  v_person:=(public.cockpit_hours_person(p)).id;
  IF EXISTS (SELECT 1 FROM public.cockpit_time_accounts x WHERE x.provider=a.provider AND x.person_id=v_person AND x.external_id<>a.external_id) THEN
    RAISE EXCEPTION 'Unlink the other % account first', v_label USING ERRCODE='22023';
  END IF;
  UPDATE public.cockpit_time_accounts SET person_id=v_person,link_method='manual',linked_by=v_actor,linked_at=now(),ignored=false
    WHERE provider=a.provider AND external_id=a.external_id;
  PERFORM public.cockpit_hours_audit('hours.link','cockpit_time_accounts',a.provider||':'||a.external_id,
    jsonb_build_object('provider',a.provider,'externalId',a.external_id,'personId',v_person),v_actor);
  RETURN jsonb_build_object('ok',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_hours_leave_type_save(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); v_from date; v_rule text; v_share numeric;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR coalesce(p->>'externalId','')='' THEN RAISE EXCEPTION 'Choose a leave type first' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_leave_types WHERE provider='timetastic' AND external_id=p->>'externalId') THEN
    RAISE EXCEPTION 'That leave type isn''t in the last Timetastic read' USING ERRCODE='22023';
  END IF;
  v_rule:=p->>'payRule';
  IF v_rule NOT IN ('paid','unpaid','part','not_leave') THEN RAISE EXCEPTION 'Choose Paid, Unpaid, Part paid or Not time off' USING ERRCODE='22023'; END IF;
  IF v_rule='part' THEN
    IF jsonb_typeof(p->'paidShare') IS DISTINCT FROM 'number' OR (p->>'paidShare')::numeric<=0 OR (p->>'paidShare')::numeric>=1 THEN
      RAISE EXCEPTION 'A part-paid type needs a share between 1%% and 99%%' USING ERRCODE='22023';
    END IF;
    v_share:=round((p->>'paidShare')::numeric,3);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cockpit_leave_type_rules WHERE provider='timetastic' AND external_id=p->>'externalId') THEN
    v_from:='2000-01-01';  -- a type's first rule applies to every month waiting on it
  ELSE
    v_from:=CASE WHEN p ? 'fromMonth' AND p->'fromMonth'<>'null'::jsonb THEN public.cockpit_hours_month(p->>'fromMonth')
      ELSE date_trunc('month',public.cockpit_hours_kw_today())::date END;
  END IF;
  INSERT INTO public.cockpit_leave_type_rules(provider,external_id,from_month,pay_rule,paid_share,set_by)
  VALUES('timetastic',p->>'externalId',v_from,v_rule,v_share,v_actor)
  ON CONFLICT (provider,external_id,from_month) DO UPDATE SET pay_rule=EXCLUDED.pay_rule,paid_share=EXCLUDED.paid_share,set_by=EXCLUDED.set_by,set_at=now();
  PERFORM public.cockpit_hours_audit('hours.leaveType','cockpit_leave_type_rules',p->>'externalId',
    jsonb_build_object('type',p->>'externalId','rule',v_rule,'share',v_share,'fromMonth',to_char(v_from,'YYYY-MM')),v_actor);
  RETURN jsonb_build_object('ok',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_hours_holiday_override(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); v_id bigint; v_day date; v_scope text; v_value text; o public.cockpit_hours_holiday_overrides;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Holidays must be an object' USING ERRCODE='22023'; END IF;
  IF length(btrim(coalesce(p->>'reason','')))<3 OR length(btrim(p->>'reason'))>300 THEN RAISE EXCEPTION 'Say why, in 3 to 300 characters' USING ERRCODE='22023'; END IF;
  IF p ? 'withdrawId' THEN
    SELECT * INTO o FROM public.cockpit_hours_holiday_overrides WHERE id=(p->>'withdrawId')::bigint AND withdrawn_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That holiday change is already withdrawn' USING ERRCODE='22023'; END IF;
    UPDATE public.cockpit_hours_holiday_overrides SET withdrawn_at=now(),withdrawn_by=v_actor WHERE id=o.id;
    PERFORM public.cockpit_hours_audit('hours.holiday','cockpit_hours_holiday_overrides',o.id::text,
      jsonb_build_object('day',to_char(o.day,'YYYY-MM-DD'),'action','withdraw','scope',o.scope),v_actor);
    RETURN jsonb_build_object('ok',true,'id',o.id);
  END IF;
  v_day:=public.cockpit_hours_day(p->>'day');
  IF (p->>'action') NOT IN ('add','remove') THEN RAISE EXCEPTION 'Add or remove a holiday' USING ERRCODE='22023'; END IF;
  v_scope:=coalesce(p->>'scope','all');
  IF v_scope NOT IN ('all','country','person') THEN RAISE EXCEPTION 'A holiday is for everyone, a country or one person' USING ERRCODE='22023'; END IF;
  v_value:=CASE WHEN v_scope='all' THEN NULL WHEN v_scope='country' THEN upper(p->>'scopeValue') ELSE p->>'scopeValue' END;
  IF v_scope='country' AND coalesce(v_value,'') !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'A country is two letters, like KW or EG' USING ERRCODE='22023'; END IF;
  IF v_scope='person' AND NOT EXISTS (SELECT 1 FROM public.cockpit_people WHERE id::text=v_value) THEN RAISE EXCEPTION 'Choose a person on the roster' USING ERRCODE='22023'; END IF;
  IF length(btrim(coalesce(p->>'name','')))<1 THEN RAISE EXCEPTION 'Name the holiday' USING ERRCODE='22023'; END IF;
  INSERT INTO public.cockpit_hours_holiday_overrides(day,action,name,scope,scope_value,reason,set_by)
  VALUES(v_day,p->>'action',left(btrim(p->>'name'),120),v_scope,v_value,btrim(p->>'reason'),v_actor) RETURNING id INTO v_id;
  PERFORM public.cockpit_hours_audit('hours.holiday','cockpit_hours_holiday_overrides',v_id::text,
    jsonb_build_object('day',to_char(v_day,'YYYY-MM-DD'),'action',p->>'action','scope',v_scope),v_actor);
  RETURN jsonb_build_object('ok',true,'id',v_id);
END;
$$;

/** The day as it is now, kept with a day decision. */
CREATE OR REPLACE FUNCTION public.cockpit_hours_day_snapshot(p_person bigint,p_day date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH acc AS (SELECT a.* FROM public.cockpit_time_accounts a WHERE a.provider='hubstaff' AND a.person_id=p_person AND NOT a.ignored LIMIT 1),
  cov AS (SELECT EXISTS (SELECT 1 FROM public.cockpit_hours_coverage c, acc WHERE c.provider='hubstaff' AND c.day=p_day
    AND (acc.member_since IS NULL OR p_day>=acc.member_since) AND (acc.removed_on IS NULL OR p_day<acc.removed_on)) AS covered),
  h AS (SELECT d.* FROM public.cockpit_hubstaff_days d, acc WHERE d.hubstaff_user_id=acc.external_id AND d.day=p_day AND d.gone_at IS NULL)
  SELECT jsonb_build_object(
    'trackedS',CASE WHEN (SELECT covered FROM cov) THEN coalesce((SELECT tracked_s FROM h),0) END,
    'manualS',CASE WHEN (SELECT covered FROM cov) THEN coalesce((SELECT manual_s FROM h),0) END,
    'covered',(SELECT covered FROM cov),
    'leaveS',0)
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_month_currency(p_person bigint,p_month date)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce(
    (SELECT h.currency FROM public.cockpit_pay_history h WHERE h.person_id=p_person AND h.effective_from<=(p_month+interval '1 month'-interval '1 day')::date
      ORDER BY h.effective_from DESC LIMIT 1),
    (SELECT p.currency FROM public.cockpit_people p WHERE p.id=p_person))
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_hours_adjust(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); v_person public.cockpit_people; k text; v_kind text; v_month date; v_day date;
  v_seconds integer; v_mode text; v_share numeric; v_decision text; v_booking text; v_amount numeric; v_currency text; v_from date;
  v_carried boolean:=false; v_carry_kind text; v_snapshot jsonb; v_id bigint; v_old public.cockpit_time_adjustments; v_month_currency text;
  v_reason text:=btrim(coalesce(p->>'reason',''));
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'A decision must be an object' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p) LOOP
    IF k<>ALL(ARRAY['personId','kind','month','day','seconds','mode','paidShare','decision','bookingId','amount','currency','fromMonth','reason']) THEN
      RAISE EXCEPTION 'Unsupported decision field: %',k USING ERRCODE='22023';
    END IF;
  END LOOP;
  v_person:=public.cockpit_hours_person(p);
  v_kind:=p->>'kind';
  IF v_kind NOT IN ('absent_unpaid','excused_paid','hours','leave','count_work','overtime','manual_time','not_booked','no_leave_month','correction') THEN
    RAISE EXCEPTION 'Unknown decision' USING ERRCODE='22023';
  END IF;
  IF length(v_reason)<3 OR length(v_reason)>300 THEN RAISE EXCEPTION 'The reason needs 3 to 300 characters' USING ERRCODE='22023'; END IF;
  IF p ? 'day' AND p->'day'<>'null'::jsonb THEN v_day:=public.cockpit_hours_day(p->>'day'); END IF;
  v_month:=CASE WHEN v_day IS NOT NULL THEN date_trunc('month',v_day)::date ELSE public.cockpit_hours_month(p->>'month') END;
  IF p ? 'month' AND p->'month'<>'null'::jsonb AND public.cockpit_hours_month(p->>'month')<>v_month THEN
    RAISE EXCEPTION 'The day is not in that month' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_hours_pay_months m WHERE m.person_id=v_person.id AND m.month=v_month AND m.status IN ('approved','paid')) THEN
    RAISE EXCEPTION '% is approved. Changes now are carried into the next month automatically', public.cockpit_hours_month_name(v_month) USING ERRCODE='22023';
  END IF;
  IF jsonb_typeof(p->'seconds')='number' THEN
    IF (p->>'seconds')::numeric<0 OR (p->>'seconds')::numeric>86400 OR (p->>'seconds')::numeric<>trunc((p->>'seconds')::numeric) THEN
      RAISE EXCEPTION 'Hours must be between 0 and 24' USING ERRCODE='22023';
    END IF;
    v_seconds:=(p->>'seconds')::integer;
  END IF;
  IF v_kind IN ('absent_unpaid','excused_paid','hours','leave','count_work','overtime') THEN
    IF v_day IS NULL THEN RAISE EXCEPTION 'Choose the day' USING ERRCODE='22023'; END IF;
    v_snapshot:=public.cockpit_hours_day_snapshot(v_person.id,v_day);
    IF v_kind IN ('hours','count_work','overtime') AND v_seconds IS NULL THEN RAISE EXCEPTION 'Enter the time' USING ERRCODE='22023'; END IF;
    IF v_kind='hours' THEN
      v_mode:=coalesce(p->>'mode',CASE WHEN (v_snapshot->>'covered')::boolean THEN 'add' ELSE 'replace' END);
      IF v_mode NOT IN ('replace','add') THEN RAISE EXCEPTION 'Hours replace or add' USING ERRCODE='22023'; END IF;
    END IF;
    IF v_kind='leave' THEN
      v_share:=CASE WHEN jsonb_typeof(p->'paidShare')='number' THEN (p->>'paidShare')::numeric ELSE 1 END;
      IF v_share<0 OR v_share>1 THEN RAISE EXCEPTION 'A paid share is between 0 and 1' USING ERRCODE='22023'; END IF;
    END IF;
    -- Confirm absent and Count as worked are each other's undo: the other one is withdrawn, never asked.
    IF v_kind IN ('absent_unpaid','excused_paid') THEN
      UPDATE public.cockpit_time_adjustments SET withdrawn_at=now(),withdrawn_by=v_actor,withdrawn_reason='Replaced by a new decision'
        WHERE person_id=v_person.id AND day=v_day AND kind IN ('absent_unpaid','excused_paid') AND withdrawn_at IS NULL;
    ELSE
      UPDATE public.cockpit_time_adjustments SET withdrawn_at=now(),withdrawn_by=v_actor,withdrawn_reason='Replaced by a new decision'
        WHERE person_id=v_person.id AND day=v_day AND kind=v_kind AND withdrawn_at IS NULL;
    END IF;
  ELSIF v_kind='manual_time' THEN
    v_decision:=p->>'decision';
    IF v_decision NOT IN ('count','skip') OR coalesce(v_seconds,0)<=0 THEN RAISE EXCEPTION 'Count it or don''t, for the manual minutes shown' USING ERRCODE='22023'; END IF;
    SELECT * INTO v_old FROM public.cockpit_time_adjustments WHERE person_id=v_person.id AND month=v_month AND day IS NULL AND kind='manual_time'
      AND decision=v_decision AND withdrawn_at IS NULL FOR UPDATE;
    IF FOUND THEN
      v_seconds:=v_seconds+coalesce(v_old.seconds,0);
      UPDATE public.cockpit_time_adjustments SET withdrawn_at=now(),withdrawn_by=v_actor,withdrawn_reason='Added to by a later decision' WHERE id=v_old.id;
    END IF;
  ELSIF v_kind='not_booked' THEN
    v_booking:=p->>'bookingId';
    IF NOT EXISTS (SELECT 1 FROM public.cockpit_timetastic_bookings b JOIN public.cockpit_time_accounts a ON a.provider='timetastic' AND a.external_id=b.tt_user_id
      WHERE b.booking_id=v_booking AND a.person_id=v_person.id) THEN RAISE EXCEPTION 'That booking isn''t this person''s' USING ERRCODE='22023'; END IF;
    IF EXISTS (SELECT 1 FROM public.cockpit_time_adjustments WHERE person_id=v_person.id AND month=v_month AND kind='not_booked' AND booking_id=v_booking AND withdrawn_at IS NULL) THEN
      RETURN jsonb_build_object('ok',true,'id',(SELECT id FROM public.cockpit_time_adjustments WHERE person_id=v_person.id AND month=v_month AND kind='not_booked' AND booking_id=v_booking AND withdrawn_at IS NULL));
    END IF;
  ELSIF v_kind='no_leave_month' THEN
    IF EXISTS (SELECT 1 FROM public.cockpit_time_adjustments WHERE person_id=v_person.id AND month=v_month AND kind='no_leave_month' AND withdrawn_at IS NULL) THEN
      RETURN jsonb_build_object('ok',true,'id',(SELECT id FROM public.cockpit_time_adjustments WHERE person_id=v_person.id AND month=v_month AND kind='no_leave_month' AND withdrawn_at IS NULL));
    END IF;
  ELSIF v_kind='correction' THEN
    IF jsonb_typeof(p->'amount') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Enter the amount' USING ERRCODE='22023'; END IF;
    v_amount:=(p->>'amount')::numeric;
    v_currency:=upper(coalesce(p->>'currency',''));
    v_month_currency:=public.cockpit_hours_month_currency(v_person.id,v_month);
    IF v_currency<>v_month_currency THEN
      RAISE EXCEPTION 'A correction must be in %, the month''s currency', v_month_currency USING ERRCODE='22023';
    END IF;
    IF p ? 'fromMonth' AND p->'fromMonth'<>'null'::jsonb THEN v_from:=public.cockpit_hours_month(p->>'fromMonth'); END IF;
    IF (p->>'decision')='skip' THEN
      -- "Leave it out": the carried change from that month is recorded as dealt with, and not paid.
      IF v_from IS NULL OR v_from>=v_month THEN RAISE EXCEPTION 'Choose the earlier month the change came from' USING ERRCODE='22023'; END IF;
      v_carried:=true; v_carry_kind:='leave_out'; v_decision:='skip';
    ELSIF v_amount=0 THEN RAISE EXCEPTION 'A correction needs an amount' USING ERRCODE='22023';
    END IF;
  END IF;
  INSERT INTO public.cockpit_time_adjustments(person_id,month,day,kind,seconds,mode,paid_share,decision,booking_id,amount,currency,from_month,
    carried,carry_kind,snapshot,reason,set_by)
  VALUES(v_person.id,v_month,v_day,v_kind,v_seconds,v_mode,v_share,v_decision,v_booking,v_amount,nullif(v_currency,''),v_from,
    v_carried,v_carry_kind,v_snapshot,v_reason,v_actor) RETURNING id INTO v_id;
  PERFORM public.cockpit_hours_audit('hours.adjust','cockpit_time_adjustments',v_id::text,
    jsonb_build_object('personId',v_person.id,'kind',v_kind,'day',to_char(v_day,'YYYY-MM-DD'),'month',to_char(v_month,'YYYY-MM')),v_actor);
  RETURN jsonb_build_object('ok',true,'id',v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_hours_adjust_withdraw(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); a public.cockpit_time_adjustments;
BEGIN
  IF jsonb_typeof(p->'id') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Choose a decision' USING ERRCODE='22023'; END IF;
  IF length(btrim(coalesce(p->>'reason','')))<3 THEN RAISE EXCEPTION 'Say why, in a few words' USING ERRCODE='22023'; END IF;
  SELECT * INTO a FROM public.cockpit_time_adjustments WHERE id=(p->>'id')::bigint AND withdrawn_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That decision is already withdrawn' USING ERRCODE='22023'; END IF;
  IF a.approval_id IS NOT NULL THEN RAISE EXCEPTION 'That line was written by an approval. Withdraw the approval instead' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_hours_pay_months m WHERE m.person_id=a.person_id AND m.month=a.month AND m.status IN ('approved','paid')) THEN
    RAISE EXCEPTION '% is approved. Changes now are carried into the next month automatically', public.cockpit_hours_month_name(a.month) USING ERRCODE='22023';
  END IF;
  UPDATE public.cockpit_time_adjustments SET withdrawn_at=now(),withdrawn_by=v_actor,withdrawn_reason=left(btrim(p->>'reason'),300) WHERE id=a.id;
  PERFORM public.cockpit_hours_audit('hours.adjustWithdraw','cockpit_time_adjustments',a.id::text,jsonb_build_object('id',a.id),v_actor);
  RETURN jsonb_build_object('ok',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_hours_rules_save(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); v_from date; v_prev jsonb; v_new jsonb; k text; v jsonb;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR jsonb_typeof(p->'settings') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Rules must be an object' USING ERRCODE='22023';
  END IF;
  v_from:=public.cockpit_hours_month(p->>'fromMonth');
  FOR k,v IN SELECT key,value FROM jsonb_each(p->'settings') LOOP
    IF k IN ('breakMinutes','keptIdleMaxMinutesPerDay','notTrackingAfterMinutes') THEN
      IF jsonb_typeof(v)<>'number' OR (v#>>'{}')::numeric<0 OR (v#>>'{}')::numeric>600 THEN RAISE EXCEPTION '% is minutes, 0 to 600', k USING ERRCODE='22023'; END IF;
    ELSIF k IN ('breakWhenLongerThanHours','dayLimitHours') THEN
      IF jsonb_typeof(v)<>'number' OR (v#>>'{}')::numeric<=0 OR (v#>>'{}')::numeric>24 THEN RAISE EXCEPTION '% is hours, up to 24', k USING ERRCODE='22023'; END IF;
    ELSIF k IN ('graceShare','correctionCapShare') THEN
      IF jsonb_typeof(v)<>'number' OR (v#>>'{}')::numeric<0 OR (v#>>'{}')::numeric>0.5 THEN RAISE EXCEPTION '% is a share between 0 and 50%%', k USING ERRCODE='22023'; END IF;
    ELSIF k='lowActivityShare' THEN
      IF v<>'null'::jsonb AND (jsonb_typeof(v)<>'number' OR (v#>>'{}')::numeric<0 OR (v#>>'{}')::numeric>1) THEN RAISE EXCEPTION 'The low-activity level is a share, or off' USING ERRCODE='22023'; END IF;
    ELSIF k IN ('countKeptIdle','countTrackedBreaks') THEN
      IF jsonb_typeof(v)<>'boolean' THEN RAISE EXCEPTION '% is yes or no', k USING ERRCODE='22023'; END IF;
    ELSIF k='manualTime' THEN
      IF v#>>'{}' NOT IN ('review','counts') THEN RAISE EXCEPTION 'Manual time needs your OK, or counts' USING ERRCODE='22023'; END IF;
    ELSIF k='dayOffWork' THEN
      IF v#>>'{}' NOT IN ('counts','needs_ok') THEN RAISE EXCEPTION 'Day-off work counts, or needs your OK' USING ERRCODE='22023'; END IF;
    ELSIF k='overtime' THEN
      IF jsonb_typeof(v)<>'object' OR jsonb_typeof(v->'on') IS DISTINCT FROM 'boolean' OR jsonb_typeof(v->'rate') IS DISTINCT FROM 'number'
        OR (v->>'rate')::numeric<1 OR (v->>'rate')::numeric>3 THEN RAISE EXCEPTION 'Overtime is on or off, at a rate from 1 to 3' USING ERRCODE='22023'; END IF;
    ELSE RAISE EXCEPTION 'Unknown rule: %', k USING ERRCODE='22023';
    END IF;
  END LOOP;
  SELECT r.settings INTO v_prev FROM public.cockpit_hours_rules r WHERE r.from_month<=v_from ORDER BY r.from_month DESC LIMIT 1;
  v_new:=coalesce(v_prev,'{}'::jsonb)||(p->'settings');
  INSERT INTO public.cockpit_hours_rules(from_month,settings,saved_by) VALUES(v_from,v_new,v_actor)
  ON CONFLICT (from_month) DO UPDATE SET settings=EXCLUDED.settings,saved_by=EXCLUDED.saved_by,saved_at=now();
  PERFORM public.cockpit_hours_audit('hours.rules','cockpit_hours_rules',to_char(v_from,'YYYY-MM'),
    jsonb_build_object('fromMonth',to_char(v_from,'YYYY-MM'),'changed',p->'settings'),v_actor);
  RETURN jsonb_build_object('ok',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_hours_set_pay(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); v_person public.cockpit_people; v_from date; v_mode text; v_cost numeric; v_currency text;
  v_last date; v_later public.cockpit_pay_history; v_cur public.cockpit_pay_history; v_today date:=public.cockpit_hours_kw_today(); v_country text;
  k text;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Pay must be an object' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT jsonb_object_keys(p) LOOP
    IF k<>ALL(ARRAY['personId','monthlyCost','currency','effectiveFrom','mode']) THEN RAISE EXCEPTION 'Unsupported pay field: %',k USING ERRCODE='22023'; END IF;
  END LOOP;
  v_person:=public.cockpit_hours_person(p);
  v_mode:=coalesce(p->>'mode','dated');
  IF v_mode NOT IN ('dated','replace') THEN RAISE EXCEPTION 'Pay is recorded from a date, or replaces a typo' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p->'monthlyCost') IS DISTINCT FROM 'number' OR (p->>'monthlyCost')::numeric<0 THEN RAISE EXCEPTION 'Enter the monthly pay' USING ERRCODE='22023'; END IF;
  v_cost:=(p->>'monthlyCost')::numeric;
  v_currency:=upper(coalesce(p->>'currency',v_person.currency));
  v_from:=public.cockpit_hours_day(p->>'effectiveFrom');
  IF v_from>v_today THEN RAISE EXCEPTION 'Pay can be recorded up to today. Record a future change on its day' USING ERRCODE='22023'; END IF;
  v_last:=public.cockpit_hours_last_approved(v_person.id);
  SELECT contract_country INTO v_country FROM public.cockpit_hours_terms WHERE person_id=v_person.id;
  IF v_mode='replace' THEN
    SELECT * INTO v_cur FROM public.cockpit_pay_history WHERE person_id=v_person.id AND effective_from<=v_from ORDER BY effective_from DESC LIMIT 1;
    IF NOT FOUND THEN RAISE EXCEPTION 'There is no recorded pay to correct yet' USING ERRCODE='22023'; END IF;
    IF v_last IS NOT NULL AND (v_last+interval '1 month')::date>v_cur.effective_from THEN
      RAISE EXCEPTION '% is approved. Record the change from 1 % instead; anything owed for % is carried automatically',
        public.cockpit_hours_month_name(v_last), public.cockpit_hours_month_name((v_last+interval '1 month')::date), public.cockpit_hours_month_name(v_last) USING ERRCODE='22023';
    END IF;
    v_from:=v_cur.effective_from;
  ELSE
    IF v_last IS NOT NULL AND v_from<(v_last+interval '1 month')::date THEN
      RAISE EXCEPTION '% is approved. Record the change from 1 %; anything owed for % is carried automatically',
        public.cockpit_hours_month_name(v_last), public.cockpit_hours_month_name((v_last+interval '1 month')::date), public.cockpit_hours_month_name(v_last) USING ERRCODE='22023';
    END IF;
    SELECT * INTO v_later FROM public.cockpit_pay_history WHERE person_id=v_person.id AND effective_from>v_from ORDER BY effective_from LIMIT 1;
    IF FOUND THEN RAISE EXCEPTION 'Pay from % is already recorded. Change that one first', to_char(v_later.effective_from,'FMDD Mon') USING ERRCODE='22023'; END IF;
    SELECT * INTO v_cur FROM public.cockpit_pay_history WHERE person_id=v_person.id AND effective_from<=v_from ORDER BY effective_from DESC LIMIT 1;
    IF v_country='KW' AND FOUND AND v_cur.currency=v_currency AND v_cost<v_cur.monthly_cost AND v_from<v_today THEN
      RAISE EXCEPTION 'Kuwait law doesn''t allow a backdated pay cut. Record it from today' USING ERRCODE='22023';
    END IF;
  END IF;
  PERFORM set_config('cockpit.pay_effective_from',to_char(v_from,'YYYY-MM-DD'),true);
  PERFORM set_config('cockpit.pay_source','dated',true);
  PERFORM public.cockpit_ceo_people_set_pay(jsonb_build_object('id',v_person.id,'monthlyCost',v_cost,'currency',v_currency));
  -- The roster row may already hold this value (no trigger fired): the dated row is written here either way.
  INSERT INTO public.cockpit_pay_history(person_id,effective_from,monthly_cost,currency,source,recorded_by)
  VALUES(v_person.id,v_from,v_cost,v_currency,'dated',v_actor)
  ON CONFLICT (person_id,effective_from) DO UPDATE SET monthly_cost=EXCLUDED.monthly_cost,currency=EXCLUDED.currency,source='dated',
    replaced_at=CASE WHEN v_mode='replace' THEN now() ELSE public.cockpit_pay_history.replaced_at END,
    replaced_by=CASE WHEN v_mode='replace' THEN v_actor ELSE public.cockpit_pay_history.replaced_by END;
  PERFORM set_config('cockpit.pay_effective_from','',true);
  PERFORM set_config('cockpit.pay_source','',true);
  PERFORM public.cockpit_hours_audit('hours.setPay','cockpit_pay_history',v_person.id::text,
    jsonb_build_object('personId',v_person.id,'effectiveFrom',to_char(v_from,'YYYY-MM-DD'),'mode',v_mode),v_actor);
  RETURN jsonb_build_object('ok',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_hours_schedule_save(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); v_person public.cockpit_people; v_from date; v_last date;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Hours must be an object' USING ERRCODE='22023'; END IF;
  v_person:=public.cockpit_hours_person(p);
  v_from:=public.cockpit_hours_day(p->>'effectiveFrom');
  PERFORM public.cockpit_people_schedule_check(p->'schedule');
  v_last:=public.cockpit_hours_last_approved(v_person.id);
  IF v_last IS NOT NULL AND v_from<(v_last+interval '1 month')::date THEN
    RAISE EXCEPTION '% is approved. Apply the new hours from 1 %', public.cockpit_hours_month_name(v_last), public.cockpit_hours_month_name((v_last+interval '1 month')::date) USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_schedule_history h WHERE h.person_id=v_person.id AND h.effective_from>v_from) THEN
    RAISE EXCEPTION 'Hours from a later date are already recorded. Change that one first' USING ERRCODE='22023';
  END IF;
  PERFORM set_config('cockpit.schedule_effective_from',to_char(v_from,'YYYY-MM-DD'),true);
  PERFORM public.cockpit_ceo_people_save(jsonb_build_object('id',v_person.id,'schedule',p->'schedule'));
  INSERT INTO public.cockpit_schedule_history(person_id,effective_from,schedule,source,recorded_by)
  VALUES(v_person.id,v_from,CASE WHEN p->'schedule'='null'::jsonb THEN NULL ELSE p->'schedule' END,'dated',v_actor)
  ON CONFLICT (person_id,effective_from) DO UPDATE SET schedule=EXCLUDED.schedule,source='dated',recorded_by=EXCLUDED.recorded_by,recorded_at=now();
  PERFORM set_config('cockpit.schedule_effective_from','',true);
  PERFORM public.cockpit_hours_audit('hours.schedule','cockpit_schedule_history',v_person.id::text,
    jsonb_build_object('personId',v_person.id,'effectiveFrom',to_char(v_from,'YYYY-MM-DD')),v_actor);
  RETURN jsonb_build_object('ok',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_hours_employment(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); v_person public.cockpit_people; v_on date; v_event text;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Employment must be an object' USING ERRCODE='22023'; END IF;
  v_person:=public.cockpit_hours_person(p);
  v_event:=p->>'event';
  v_on:=public.cockpit_hours_day(p->>'on');
  IF v_event IS NULL OR v_event NOT IN ('left','rehired','paused','resumed') THEN RAISE EXCEPTION 'Choose left, back, paused or resumed' USING ERRCODE='22023'; END IF;
  PERFORM set_config('cockpit.employment_on',to_char(v_on,'YYYY-MM-DD'),true);
  IF v_event='left' THEN
    IF NOT v_person.active AND v_person.ended_on IS NOT NULL THEN RAISE EXCEPTION 'They are already marked as left' USING ERRCODE='22023'; END IF;
    PERFORM public.cockpit_ceo_people_save(jsonb_build_object('id',v_person.id,'active',false,'endedOn',to_char(v_on,'YYYY-MM-DD')));
  ELSIF v_event='rehired' THEN
    IF v_person.active AND v_person.ended_on IS NULL THEN RAISE EXCEPTION 'They are already on the team' USING ERRCODE='22023'; END IF;
    IF v_person.ended_on IS NOT NULL AND v_on<=v_person.ended_on THEN RAISE EXCEPTION 'The first day back must be after the last working day' USING ERRCODE='22023'; END IF;
    PERFORM public.cockpit_ceo_people_save(jsonb_build_object('id',v_person.id,'active',true));
    IF v_person.ended_on IS NULL THEN
      INSERT INTO public.cockpit_employment_periods(person_id,kind,from_day,source,recorded_by)
      SELECT v_person.id,'employed',v_on,'roster',v_actor
      WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_employment_periods e WHERE e.person_id=v_person.id AND e.kind='employed' AND e.to_day IS NULL);
    END IF;
  ELSIF v_event='paused' THEN
    IF v_person.paused_on IS NOT NULL THEN RAISE EXCEPTION 'They are already paused' USING ERRCODE='22023'; END IF;
    PERFORM public.cockpit_ceo_people_save(jsonb_build_object('id',v_person.id,'pausedOn',to_char(v_on,'YYYY-MM-DD'),
      'pausedWhy',CASE WHEN p ? 'why' THEN p->'why' ELSE 'null'::jsonb END));
  ELSE
    IF v_person.paused_on IS NULL THEN RAISE EXCEPTION 'They aren''t paused' USING ERRCODE='22023'; END IF;
    IF v_on<=v_person.paused_on THEN RAISE EXCEPTION 'Back on must be after the pause started' USING ERRCODE='22023'; END IF;
    PERFORM public.cockpit_ceo_people_save(jsonb_build_object('id',v_person.id,'pausedOn',NULL,'pausedWhy',NULL));
  END IF;
  PERFORM set_config('cockpit.employment_on','',true);
  PERFORM public.cockpit_hours_audit('hours.employment','cockpit_employment_periods',v_person.id::text,
    jsonb_build_object('personId',v_person.id,'event',v_event,'on',to_char(v_on,'YYYY-MM-DD')),v_actor);
  RETURN jsonb_build_object('ok',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_hours_key_expiry(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); v_day date;
BEGIN
  IF (p->>'provider') NOT IN ('hubstaff','timetastic') THEN RAISE EXCEPTION 'Choose Hubstaff or Timetastic' USING ERRCODE='22023'; END IF;
  v_day:=CASE WHEN p->'expiresOn'='null'::jsonb THEN NULL ELSE public.cockpit_hours_day(p->>'expiresOn') END;
  -- A personal token renews itself on every read, so it has no end date to record.
  IF EXISTS (SELECT 1 FROM public.cockpit_hours_keys WHERE provider=p->>'provider' AND kind='hubstaff_personal') AND v_day IS NOT NULL THEN
    RAISE EXCEPTION 'A personal token renews itself, so it has no expiry date' USING ERRCODE='22023';
  END IF;
  UPDATE public.cockpit_hours_keys SET expires_on=v_day WHERE provider=p->>'provider';
  IF NOT FOUND THEN RAISE EXCEPTION 'There is no saved key yet' USING ERRCODE='22023'; END IF;
  PERFORM public.cockpit_hours_audit('hours.keyExpiry','cockpit_hours_keys',p->>'provider',
    jsonb_build_object('provider',p->>'provider','expiresOn',to_char(v_day,'YYYY-MM-DD')),v_actor);
  RETURN jsonb_build_object('ok',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_hours_withdraw_approval(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); v_person public.cockpit_people; v_month date; m public.cockpit_hours_pay_months; v_later date;
BEGIN
  v_person:=public.cockpit_hours_person(p);
  v_month:=public.cockpit_hours_month(p->>'month');
  IF length(btrim(coalesce(p->>'reason','')))<3 THEN RAISE EXCEPTION 'Say why, in a few words' USING ERRCODE='22023'; END IF;
  SELECT * INTO m FROM public.cockpit_hours_pay_months WHERE person_id=v_person.id AND month=v_month AND status<>'withdrawn' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '% isn''t approved', public.cockpit_hours_month_name(v_month) USING ERRCODE='22023'; END IF;
  IF m.status='paid' THEN RAISE EXCEPTION '% is marked paid, so the approval stays' , public.cockpit_hours_month_name(v_month) USING ERRCODE='22023'; END IF;
  SELECT min(a.month) INTO v_later FROM public.cockpit_time_adjustments a
    WHERE a.person_id=v_person.id AND a.from_month=v_month AND a.kind='correction' AND a.withdrawn_at IS NULL
      AND NOT (a.approval_id=m.id AND a.carry_kind='remainder'
               AND NOT EXISTS (SELECT 1 FROM public.cockpit_hours_pay_months x WHERE x.person_id=a.person_id AND x.month=a.month AND x.status IN ('approved','paid')));
  IF v_later IS NOT NULL THEN
    RAISE EXCEPTION '%''s figure includes a change carried from %. Withdraw % first',
      public.cockpit_hours_month_name(v_later), public.cockpit_hours_month_name(v_month), public.cockpit_hours_month_name(v_later) USING ERRCODE='22023';
  END IF;
  -- What this approval wrote, and nothing approved since depends on, goes with it.
  UPDATE public.cockpit_time_adjustments SET withdrawn_at=now(),withdrawn_by=v_actor,withdrawn_reason='The approval was withdrawn'
    WHERE approval_id=m.id AND withdrawn_at IS NULL;
  UPDATE public.cockpit_hours_pay_months SET status='withdrawn',withdrawn_by=v_actor,withdrawn_at=now(),withdrawn_reason=left(btrim(p->>'reason'),300) WHERE id=m.id;
  PERFORM public.cockpit_hours_audit('hours.withdrawApproval','cockpit_hours_pay_months',m.id::text,
    jsonb_build_object('personId',v_person.id,'month',to_char(v_month,'YYYY-MM')),v_actor);
  RETURN jsonb_build_object('ok',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_ceo_hours_mark_paid(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text:=public.cockpit_hours_ceo_email(); v_person public.cockpit_people; v_month date; v_on date; m public.cockpit_hours_pay_months;
BEGIN
  v_person:=public.cockpit_hours_person(p);
  v_month:=public.cockpit_hours_month(p->>'month');
  v_on:=public.cockpit_hours_day(p->>'paidOn');
  SELECT * INTO m FROM public.cockpit_hours_pay_months WHERE person_id=v_person.id AND month=v_month AND status<>'withdrawn' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approve % first', public.cockpit_hours_month_name(v_month) USING ERRCODE='22023'; END IF;
  IF m.status='paid' THEN RETURN jsonb_build_object('ok',true); END IF;
  UPDATE public.cockpit_hours_pay_months SET status='paid',paid_by=v_actor,paid_at=(v_on::timestamp AT TIME ZONE 'Asia/Kuwait'),
    paid_note=nullif(left(btrim(coalesce(p->>'note','')),300),'') WHERE id=m.id;
  PERFORM public.cockpit_hours_audit('hours.markPaid','cockpit_hours_pay_months',m.id::text,
    jsonb_build_object('personId',v_person.id,'month',to_char(v_month,'YYYY-MM'),'paidOn',to_char(v_on,'YYYY-MM-DD')),v_actor);
  RETURN jsonb_build_object('ok',true);
END;
$$;

-- ---------------------------------------------------------------------------
-- 7. Service: actor, lease, apply, keys, approve, prune

CREATE OR REPLACE FUNCTION public.cockpit_hours_actor(p_actor_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.cockpit_hours_require_service();
  RETURN public.cockpit_ceo_verified_actor_email(p_actor_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_lease_claim(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_hours_sync_runs; v_mode text:=p->>'mode'; v_by text:=coalesce(p->>'requestedBy','cron'); v_id bigint; v_holder uuid:=gen_random_uuid();
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF v_mode NOT IN ('recent','deep','month','doctor') THEN RAISE EXCEPTION 'Unknown read mode' USING ERRCODE='22023'; END IF;
  IF v_by<>'cron' AND v_by !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN RAISE EXCEPTION 'A read is requested by cron or a verified email' USING ERRCODE='22023'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('cockpit_hours_sync_lease'));
  UPDATE public.cockpit_hours_sync_runs SET state='abandoned',finished_at=now(),error=coalesce(error,'The lease ran out before the read finished')
    WHERE state='running' AND lease_until<now();
  SELECT * INTO r FROM public.cockpit_hours_sync_runs WHERE state='running' ORDER BY started_at DESC LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('ok',false,'busy',true,'since',r.started_at,'runId',r.id); END IF;
  INSERT INTO public.cockpit_hours_sync_runs(mode,window_from,window_to,dry_run,requested_by,holder,lease_until)
  VALUES(v_mode,nullif(p->>'windowFrom','')::date,nullif(p->>'windowTo','')::date,coalesce((p->>'dryRun')::boolean,false),v_by,v_holder,now()+interval '10 minutes')
  RETURNING id INTO v_id;
  IF v_by<>'cron' AND coalesce((p->>'audit')::boolean,true) THEN
    PERFORM public.cockpit_hours_audit('hours.syncNow','cockpit_hours_sync_runs',v_id::text,
      jsonb_build_object('mode',v_mode,'windowFrom',p->>'windowFrom','windowTo',p->>'windowTo','dryRun',coalesce((p->>'dryRun')::boolean,false)),v_by);
  END IF;
  RETURN jsonb_build_object('ok',true,'runId',v_id,'leaseToken',v_holder);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_lease_renew(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.cockpit_hours_require_service();
  UPDATE public.cockpit_hours_sync_runs SET lease_until=now()+interval '10 minutes'
    WHERE id=(p->>'runId')::bigint AND holder=(p->>'leaseToken')::uuid AND state='running';
  RETURN jsonb_build_object('ok',FOUND);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_run_finish(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_hours_sync_runs; pv text; part jsonb; v_ok boolean; v_note text;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  SELECT * INTO r FROM public.cockpit_hours_sync_runs WHERE id=(p->>'runId')::bigint AND holder=(p->>'leaseToken')::uuid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That read is not this lease''s' USING ERRCODE='42501'; END IF;
  IF r.state<>'running' THEN RETURN jsonb_build_object('ok',false,'state',r.state); END IF;
  UPDATE public.cockpit_hours_sync_runs SET state=CASE WHEN p->>'state'='ok' THEN 'ok' ELSE 'failed' END,finished_at=now(),
    hubstaff=p->'hubstaff',timetastic=p->'timetastic',crosscheck=p->'crosscheck',error=left(p->>'error',240)
    WHERE id=r.id;
  IF NOT r.dry_run THEN
    FOREACH pv IN ARRAY ARRAY['hubstaff','timetastic'] LOOP
      part:=p->pv;
      IF jsonb_typeof(part)='object' AND part->>'state' IN ('ok','failed','no_key','refused','plan_blocked','needs_new_key','firewall_blocked') THEN
        v_ok:=part->>'state'='ok';
        v_note:=left(coalesce(part->>'note',''),240);
        INSERT INTO public.cockpit_sync_state(key,last_run_at,last_ok_at,ok,note,rows_seen,updated_at)
        VALUES(pv||'-sync',now(),CASE WHEN v_ok THEN now() END,v_ok,nullif(v_note,''),nullif(part->>'rows','')::integer,now())
        ON CONFLICT (key) DO UPDATE SET last_run_at=now(),last_ok_at=CASE WHEN v_ok THEN now() ELSE public.cockpit_sync_state.last_ok_at END,
          ok=v_ok,note=nullif(v_note,''),rows_seen=EXCLUDED.rows_seen,updated_at=now();
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('ok',true);
END;
$$;

/** Automatic links: Timetastic by payrollId (the roster id), then email for both providers. Never removed automatically. */
CREATE OR REPLACE FUNCTION public.cockpit_hours_autolink(p_provider text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a record; v_person bigint; n integer:=0;
BEGIN
  FOR a IN SELECT * FROM public.cockpit_time_accounts x WHERE x.provider=p_provider AND x.person_id IS NULL AND NOT x.ignored ORDER BY x.external_id LOOP
    v_person:=NULL;
    IF p_provider='timetastic' AND coalesce(a.payroll_id,'') ~ '^[0-9]{1,15}$' THEN
      SELECT p.id INTO v_person FROM public.cockpit_people p
       WHERE p.id=a.payroll_id::bigint AND p.active
         AND NOT EXISTS (SELECT 1 FROM public.cockpit_time_accounts y WHERE y.provider=p_provider AND y.person_id=p.id);
      IF v_person IS NOT NULL THEN
        UPDATE public.cockpit_time_accounts SET person_id=v_person,link_method='payroll_id',linked_by='sync',linked_at=now() WHERE provider=a.provider AND external_id=a.external_id;
        PERFORM public.cockpit_hours_audit('hours.autolink','cockpit_time_accounts',a.provider||':'||a.external_id,
          jsonb_build_object('provider',a.provider,'externalId',a.external_id,'personId',v_person,'method','payroll_id'),'sync');
        n:=n+1; CONTINUE;
      END IF;
    END IF;
    IF coalesce(btrim(a.email),'')<>'' THEN
      SELECT min(p.id) INTO v_person FROM public.cockpit_people p
       WHERE p.active AND lower(btrim(p.email))=lower(btrim(a.email))
         AND NOT EXISTS (SELECT 1 FROM public.cockpit_time_accounts y WHERE y.provider=p_provider AND y.person_id=p.id)
       HAVING count(*)=1;
      IF v_person IS NOT NULL THEN
        UPDATE public.cockpit_time_accounts SET person_id=v_person,link_method='email',linked_by='sync',linked_at=now() WHERE provider=a.provider AND external_id=a.external_id;
        PERFORM public.cockpit_hours_audit('hours.autolink','cockpit_time_accounts',a.provider||':'||a.external_id,
          jsonb_build_object('provider',a.provider,'externalId',a.external_id,'personId',v_person,'method','email'),'sync');
        n:=n+1;
      END IF;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

/** Which accounts of a provider are linked: ids only, for the deep read to fetch payroll ids of the unlinked ones. */
CREATE OR REPLACE FUNCTION public.cockpit_hours_account_links(p_provider text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.cockpit_hours_require_service();
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('externalId',a.external_id,'linked',a.person_id IS NOT NULL OR a.ignored) ORDER BY a.external_id)
    FROM public.cockpit_time_accounts a WHERE a.provider=p_provider),'[]'::jsonb);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_sync_apply(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.cockpit_hours_sync_runs; v_provider text:=p->>'provider'; v_read timestamptz; v_from date; v_to date;
  v_rows integer; n_accounts integer:=0; n_days integer:=0; n_bookings integer:=0; n_tt integer:=0; n_types integer:=0;
  n_swept integer:=0; n_cov integer:=0; n_links integer:=0; x jsonb; v_bfrom date; v_bto date; v_dfrom date; v_dto date;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR v_provider NOT IN ('hubstaff','timetastic') THEN RAISE EXCEPTION 'A sync payload names its provider' USING ERRCODE='22023'; END IF;
  IF octet_length(p::text)>2*1024*1024 THEN RAISE EXCEPTION 'The sync payload is over 2 MB' USING ERRCODE='54000'; END IF;
  v_rows:=coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(p->'accounts')='array' THEN p->'accounts' END),0)
    +coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(p->'hubstaffDays')='array' THEN p->'hubstaffDays' END),0)
    +coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(p->'bookings')='array' THEN p->'bookings' END),0)
    +coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(p->'ttDays')='array' THEN p->'ttDays' END),0)
    +coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(p->'leaveTypes')='array' THEN p->'leaveTypes' END),0)
    +coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(p->'coverageDays')='array' THEN p->'coverageDays' END),0);
  IF v_rows>20000 THEN RAISE EXCEPTION 'The sync payload has more than 20,000 rows' USING ERRCODE='54000'; END IF;
  SELECT * INTO r FROM public.cockpit_hours_sync_runs WHERE id=(p->>'runId')::bigint FOR UPDATE;
  IF NOT FOUND OR r.holder IS DISTINCT FROM (p->>'leaseToken')::uuid OR r.state<>'running' THEN
    RAISE EXCEPTION 'This read no longer holds the lease; nothing was written' USING ERRCODE='40001';
  END IF;
  IF r.dry_run THEN RAISE EXCEPTION 'A dry run writes nothing' USING ERRCODE='22023'; END IF;
  v_read:=(p->>'readStartedAt')::timestamptz;
  v_from:=(p#>>'{window,from}')::date; v_to:=(p#>>'{window,to}')::date;
  IF v_read IS NULL OR v_from IS NULL OR v_to IS NULL OR v_to<v_from THEN RAISE EXCEPTION 'A sync payload names its window and read time' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM public.cockpit_hours_coverage c WHERE c.provider=v_provider AND c.day BETWEEN v_from AND v_to AND c.read_started_at>v_read) THEN
    RAISE EXCEPTION 'A newer read of these days is already applied; nothing was written' USING ERRCODE='40001';
  END IF;

  -- Accounts (directory fields only; links are never removed here)
  FOR x IN SELECT value FROM jsonb_array_elements(coalesce(p->'accounts','[]'::jsonb)) LOOP
    INSERT INTO public.cockpit_time_accounts(provider,external_id,email,name,status,membership_role,trackable,member_since,removed_on,time_zone,
      extra,payroll_id,job_title,online,last_activity_at,last_client_activity_on,first_seen_at,last_seen_at)
    VALUES(v_provider,x->>'externalId',nullif(btrim(x->>'email'),''),left(x->>'name',200),x->>'status',x->>'membershipRole',(x->>'trackable')::boolean,
      (x->>'memberSince')::date,(x->>'removedOn')::date,x->>'timeZone',coalesce(x->'extra','{}'::jsonb),x->>'payrollId',left(x->>'jobTitle',200),
      (x->>'online')::boolean,(x->>'lastActivityAt')::timestamptz,(x->>'lastClientActivityOn')::date,now(),now())
    ON CONFLICT (provider,external_id) DO UPDATE SET email=EXCLUDED.email,name=EXCLUDED.name,status=EXCLUDED.status,
      membership_role=coalesce(EXCLUDED.membership_role,public.cockpit_time_accounts.membership_role),
      trackable=coalesce(EXCLUDED.trackable,public.cockpit_time_accounts.trackable),
      member_since=coalesce(EXCLUDED.member_since,public.cockpit_time_accounts.member_since),removed_on=EXCLUDED.removed_on,
      time_zone=coalesce(EXCLUDED.time_zone,public.cockpit_time_accounts.time_zone),
      extra=public.cockpit_time_accounts.extra||EXCLUDED.extra,
      payroll_id=coalesce(EXCLUDED.payroll_id,public.cockpit_time_accounts.payroll_id),
      job_title=coalesce(EXCLUDED.job_title,public.cockpit_time_accounts.job_title),
      online=coalesce(EXCLUDED.online,public.cockpit_time_accounts.online),
      last_activity_at=coalesce(EXCLUDED.last_activity_at,public.cockpit_time_accounts.last_activity_at),
      last_client_activity_on=coalesce(EXCLUDED.last_client_activity_on,public.cockpit_time_accounts.last_client_activity_on),
      last_seen_at=now();
    n_accounts:=n_accounts+1;
  END LOOP;
  n_links:=public.cockpit_hours_autolink(v_provider);

  IF v_provider='hubstaff' THEN
    FOR x IN SELECT value FROM jsonb_array_elements(coalesce(p->'hubstaffDays','[]'::jsonb)) LOOP
      IF (x->>'day')::date NOT BETWEEN v_from AND v_to THEN RAISE EXCEPTION 'A Hubstaff day falls outside the window' USING ERRCODE='22023'; END IF;
      INSERT INTO public.cockpit_hubstaff_days(hubstaff_user_id,day,tracked_s,manual_s,idle_s,break_s,overall_s,input_tracked_s,daily_tracked_s,
        zone_shifted,verified,slots,source_updated_at,synced_at,run_id,gone_at)
      VALUES(x->>'hubstaffUserId',(x->>'day')::date,(x->>'trackedS')::integer,coalesce((x->>'manualS')::integer,0),coalesce((x->>'idleS')::integer,0),
        coalesce((x->>'breakS')::integer,0),coalesce((x->>'overallS')::integer,0),coalesce((x->>'inputTrackedS')::integer,0),(x->>'dailyTrackedS')::integer,
        coalesce((x->>'zoneShifted')::boolean,false),coalesce((x->>'verified')::boolean,true),coalesce((x->>'slots')::integer,0),
        (x->>'sourceUpdatedAt')::timestamptz,now(),r.id,NULL)
      ON CONFLICT (hubstaff_user_id,day) DO UPDATE SET
        previous_tracked_s=CASE WHEN coalesce(CASE WHEN public.cockpit_hubstaff_days.gone_at IS NULL THEN public.cockpit_hubstaff_days.tracked_s END,0)-EXCLUDED.tracked_s>900
          THEN public.cockpit_hubstaff_days.tracked_s ELSE public.cockpit_hubstaff_days.previous_tracked_s END,
        changed_at=CASE WHEN coalesce(CASE WHEN public.cockpit_hubstaff_days.gone_at IS NULL THEN public.cockpit_hubstaff_days.tracked_s END,0)-EXCLUDED.tracked_s>900
          THEN now() ELSE public.cockpit_hubstaff_days.changed_at END,
        tracked_s=EXCLUDED.tracked_s,manual_s=EXCLUDED.manual_s,idle_s=EXCLUDED.idle_s,break_s=EXCLUDED.break_s,overall_s=EXCLUDED.overall_s,
        input_tracked_s=EXCLUDED.input_tracked_s,daily_tracked_s=EXCLUDED.daily_tracked_s,zone_shifted=EXCLUDED.zone_shifted,verified=EXCLUDED.verified,
        slots=EXCLUDED.slots,source_updated_at=EXCLUDED.source_updated_at,synced_at=now(),run_id=EXCLUDED.run_id,gone_at=NULL;
      n_days:=n_days+1;
    END LOOP;
    -- Sweep only accounts this run's /members read lists as active: a removed leader keeps their month.
    WITH gone AS (
      UPDATE public.cockpit_hubstaff_days h SET gone_at=now(),
        previous_tracked_s=CASE WHEN h.tracked_s>900 THEN h.tracked_s ELSE h.previous_tracked_s END,
        changed_at=CASE WHEN h.tracked_s>900 THEN now() ELSE h.changed_at END
      WHERE h.gone_at IS NULL AND h.day BETWEEN v_from AND v_to
        AND h.hubstaff_user_id IN (SELECT jsonb_array_elements_text(coalesce(p->'activeAccountIds','[]'::jsonb)))
        AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p->'hubstaffDays','[]'::jsonb)) y
                        WHERE y->>'hubstaffUserId'=h.hubstaff_user_id AND (y->>'day')::date=h.day)
      RETURNING 1)
    SELECT count(*) INTO n_swept FROM gone;
  ELSE
    FOR x IN SELECT value FROM jsonb_array_elements(coalesce(p->'leaveTypes','[]'::jsonb)) LOOP
      INSERT INTO public.cockpit_leave_types(provider,external_id,name,active,deducted,requires_approval,synced_at)
      VALUES('timetastic',x->>'externalId',left(coalesce(x->>'name','Leave'),120),coalesce((x->>'active')::boolean,true),(x->>'deducted')::boolean,(x->>'requiresApproval')::boolean,now())
      ON CONFLICT (provider,external_id) DO UPDATE SET name=EXCLUDED.name,active=EXCLUDED.active,deducted=EXCLUDED.deducted,
        requires_approval=EXCLUDED.requires_approval,synced_at=now();
      n_types:=n_types+1;
    END LOOP;
    v_bfrom:=(p#>>'{bookingsRange,from}')::date; v_bto:=(p#>>'{bookingsRange,to}')::date;
    FOR x IN SELECT value FROM jsonb_array_elements(coalesce(p->'bookings','[]'::jsonb)) LOOP
      INSERT INTO public.cockpit_timetastic_bookings(booking_id,tt_user_id,leave_type_id,leave_type_name,status,start_at,start_type,end_at,end_type,
        booking_unit,duration,deduction,requested_by_id,actioner_id,auto_approved,source_updated_at,synced_at,run_id,gone_at)
      VALUES(x->>'bookingId',x->>'ttUserId',x->>'leaveTypeId',left(x->>'leaveTypeName',120),x->>'status',(x->>'startAt')::timestamp,x->>'startType',
        (x->>'endAt')::timestamp,x->>'endType',x->>'bookingUnit',(x->>'duration')::numeric,(x->>'deduction')::numeric,x->>'requestedById',
        x->>'actionerId',coalesce((x->>'autoApproved')::boolean,false),(x->>'updatedAt')::timestamptz,now(),r.id,NULL)
      ON CONFLICT (booking_id) DO UPDATE SET tt_user_id=EXCLUDED.tt_user_id,leave_type_id=EXCLUDED.leave_type_id,leave_type_name=EXCLUDED.leave_type_name,
        status=EXCLUDED.status,start_at=EXCLUDED.start_at,start_type=EXCLUDED.start_type,end_at=EXCLUDED.end_at,end_type=EXCLUDED.end_type,
        booking_unit=EXCLUDED.booking_unit,duration=EXCLUDED.duration,deduction=EXCLUDED.deduction,requested_by_id=EXCLUDED.requested_by_id,
        actioner_id=EXCLUDED.actioner_id,auto_approved=EXCLUDED.auto_approved,source_updated_at=EXCLUDED.source_updated_at,synced_at=now(),
        run_id=EXCLUDED.run_id,gone_at=NULL;
      n_bookings:=n_bookings+1;
    END LOOP;
    IF v_bfrom IS NOT NULL AND v_bto IS NOT NULL THEN
      WITH gone AS (
        UPDATE public.cockpit_timetastic_bookings b SET gone_at=now()
        WHERE b.gone_at IS NULL AND b.start_at::date BETWEEN v_bfrom AND v_bto
          AND b.tt_user_id NOT IN (SELECT jsonb_array_elements_text(coalesce(p->'archivedUserIds','[]'::jsonb)))
          AND b.booking_id NOT IN (SELECT y->>'bookingId' FROM jsonb_array_elements(coalesce(p->'bookings','[]'::jsonb)) y)
        RETURNING 1)
      SELECT n_swept+count(*) INTO n_swept FROM gone;
    END IF;
    v_dfrom:=(p#>>'{ttDaysRange,from}')::date; v_dto:=(p#>>'{ttDaysRange,to}')::date;
    FOR x IN SELECT value FROM jsonb_array_elements(coalesce(p->'ttDays','[]'::jsonb)) LOOP
      INSERT INTO public.cockpit_timetastic_days(tt_user_id,day,kind,entity_key,detail,start_local,end_local,synced_at,run_id,gone_at)
      VALUES(x->>'ttUserId',(x->>'day')::date,x->>'kind',coalesce(x->>'entityKey',''),left(x->>'detail',120),x->>'startLocal',x->>'endLocal',now(),r.id,NULL)
      ON CONFLICT (tt_user_id,day,kind,entity_key) DO UPDATE SET detail=EXCLUDED.detail,start_local=EXCLUDED.start_local,end_local=EXCLUDED.end_local,
        synced_at=now(),run_id=EXCLUDED.run_id,gone_at=NULL;
      n_tt:=n_tt+1;
    END LOOP;
    IF v_dfrom IS NOT NULL AND v_dto IS NOT NULL THEN
      WITH gone AS (
        UPDATE public.cockpit_timetastic_days d SET gone_at=now()
        WHERE d.gone_at IS NULL AND d.day BETWEEN v_dfrom AND v_dto
          AND d.tt_user_id NOT IN (SELECT jsonb_array_elements_text(coalesce(p->'archivedUserIds','[]'::jsonb)))
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p->'ttDays','[]'::jsonb)) y
            WHERE y->>'ttUserId'=d.tt_user_id AND (y->>'day')::date=d.day AND y->>'kind'=d.kind AND coalesce(y->>'entityKey','')=d.entity_key)
        RETURNING 1)
      SELECT n_swept+count(*) INTO n_swept FROM gone;
    END IF;
  END IF;

  -- Coverage only for the days this complete window read.
  FOR x IN SELECT value FROM jsonb_array_elements(coalesce(p->'coverageDays','[]'::jsonb)) LOOP
    IF (x#>>'{}')::date NOT BETWEEN v_from AND v_to THEN RAISE EXCEPTION 'A covered day falls outside the window' USING ERRCODE='22023'; END IF;
    INSERT INTO public.cockpit_hours_coverage(provider,day,last_ok_at,read_started_at,run_id) VALUES(v_provider,(x#>>'{}')::date,now(),v_read,r.id)
    ON CONFLICT (provider,day) DO UPDATE SET last_ok_at=now(),read_started_at=EXCLUDED.read_started_at,run_id=EXCLUDED.run_id;
    n_cov:=n_cov+1;
  END LOOP;

  UPDATE public.cockpit_hours_sync_runs SET lease_until=greatest(lease_until,now()+interval '5 minutes') WHERE id=r.id;
  PERFORM public.cockpit_hours_audit('hours.sync','cockpit_hours_sync_runs',r.id::text,
    jsonb_build_object('provider',v_provider,'window',jsonb_build_object('from',v_from,'to',v_to),'accounts',n_accounts,'days',n_days,
      'bookings',n_bookings,'ttDays',n_tt,'leaveTypes',n_types,'swept',n_swept,'covered',n_cov,'autolinked',n_links),'sync');
  RETURN jsonb_build_object('ok',true,'accounts',n_accounts,'days',n_days,'bookings',n_bookings,'ttDays',n_tt,'leaveTypes',n_types,
    'swept',n_swept,'covered',n_cov,'autolinked',n_links);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_key_get(p_provider text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE k public.cockpit_hours_keys;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  SELECT * INTO k FROM public.cockpit_hours_keys WHERE provider=p_provider;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('provider',k.provider,'kind',k.kind,'secret',k.secret,'version',k.version,'accountId',k.account_id,
    'accessToken',k.access_token,'accessExpiresAt',k.access_expires_at,'exchangeStartedAt',k.exchange_started_at,'state',k.state,
    'expiresOn',to_char(k.expires_on,'YYYY-MM-DD'),'savedAt',k.saved_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_key_put(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k public.cockpit_hours_keys; v_secret text:=p->>'secret'; v_kind text:=p->>'kind'; v_provider text:=p->>'provider'; v_version integer;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF v_provider NOT IN ('hubstaff','timetastic') OR v_kind NOT IN ('hubstaff_org','hubstaff_personal','timetastic')
    OR (v_provider='timetastic')<>(v_kind='timetastic') THEN RAISE EXCEPTION 'Unknown key kind' USING ERRCODE='22023'; END IF;
  IF v_secret IS NULL OR length(v_secret) NOT BETWEEN 10 AND 4000 OR v_secret ~ '[[:space:]]' THEN RAISE EXCEPTION 'That doesn''t look like a key' USING ERRCODE='22023'; END IF;
  IF coalesce(p->>'savedBy','') !~ '^[^[:space:]@]+@[^[:space:]@]+$' THEN RAISE EXCEPTION 'A key is saved by a verified email' USING ERRCODE='22023'; END IF;
  SELECT * INTO k FROM public.cockpit_hours_keys WHERE provider=v_provider FOR UPDATE;
  IF p ? 'expectVersion' AND p->'expectVersion'<>'null'::jsonb AND (p->>'expectVersion')::integer IS DISTINCT FROM k.version THEN
    RAISE EXCEPTION 'The key changed while this one was being checked. Paste it again' USING ERRCODE='40001';
  END IF;
  v_version:=coalesce(k.version,0)+1;
  INSERT INTO public.cockpit_hours_keys(provider,kind,secret,version,last4,account_id,saved_by,saved_at,expires_on,access_token,access_expires_at,
    exchange_started_at,state,state_note,checked_at)
  VALUES(v_provider,v_kind,v_secret,v_version,right(v_secret,4),p->>'accountId',p->>'savedBy',now(),
    CASE WHEN p ? 'expiresOn' AND p->'expiresOn'<>'null'::jsonb THEN (p->>'expiresOn')::date END,
    p->>'accessToken',(p->>'accessExpiresAt')::timestamptz,NULL,coalesce(p->>'state','unchecked'),left(p->>'stateNote',240),
    CASE WHEN p->>'state'='connected' THEN now() END)
  ON CONFLICT (provider) DO UPDATE SET kind=EXCLUDED.kind,secret=EXCLUDED.secret,version=EXCLUDED.version,last4=EXCLUDED.last4,
    account_id=EXCLUDED.account_id,saved_by=EXCLUDED.saved_by,saved_at=now(),expires_on=EXCLUDED.expires_on,access_token=EXCLUDED.access_token,
    access_expires_at=EXCLUDED.access_expires_at,exchange_started_at=NULL,state=EXCLUDED.state,state_note=EXCLUDED.state_note,checked_at=EXCLUDED.checked_at;
  PERFORM public.cockpit_hours_audit('hours.keySaved','cockpit_hours_keys',v_provider,
    jsonb_build_object('provider',v_provider,'kind',v_kind,'savedBy',p->>'savedBy'),p->>'savedBy');
  RETURN jsonb_build_object('ok',true,'version',v_version,'last4',right(v_secret,4));
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_key_exchange_begin(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k public.cockpit_hours_keys;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  SELECT * INTO k FROM public.cockpit_hours_keys WHERE provider=coalesce(p->>'provider','hubstaff') FOR UPDATE;
  IF NOT FOUND OR k.kind<>'hubstaff_personal' THEN RETURN jsonb_build_object('ok',false,'reason','no_personal_key'); END IF;
  IF k.version IS DISTINCT FROM (p->>'version')::integer THEN RETURN jsonb_build_object('ok',false,'reason','version_changed','version',k.version); END IF;
  IF k.exchange_started_at IS NOT NULL THEN
    -- An exchange whose outcome is unknown: the refresh token may already be used. Never burn another attempt.
    UPDATE public.cockpit_hours_keys SET state='needs_new_key',state_note='An earlier exchange did not finish' WHERE provider=k.provider;
    RETURN jsonb_build_object('ok',false,'reason','in_flight');
  END IF;
  UPDATE public.cockpit_hours_keys SET exchange_started_at=now() WHERE provider=k.provider;
  RETURN jsonb_build_object('ok',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_key_rotate(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_new integer;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF coalesce(p->>'secret','')='' OR length(p->>'secret')<10 THEN RAISE EXCEPTION 'The new refresh token is missing' USING ERRCODE='22023'; END IF;
  UPDATE public.cockpit_hours_keys SET secret=p->>'secret',version=version+1,last4=right(p->>'secret',4),access_token=p->>'accessToken',
    access_expires_at=(p->>'accessExpiresAt')::timestamptz,exchange_started_at=NULL,state='connected',state_note=NULL,checked_at=now()
  WHERE provider=coalesce(p->>'provider','hubstaff') AND kind='hubstaff_personal' AND version=(p->>'version')::integer
  RETURNING version INTO v_new;
  IF v_new IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','version_changed'); END IF;
  PERFORM public.cockpit_hours_audit('hours.keyRotated','cockpit_hours_keys',coalesce(p->>'provider','hubstaff'),
    jsonb_build_object('provider',coalesce(p->>'provider','hubstaff'),'version',v_new),'sync');
  RETURN jsonb_build_object('ok',true,'version',v_new);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_key_state(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM public.cockpit_hours_require_service();
  IF (p->>'state') NOT IN ('connected','unchecked','refused','plan_blocked','needs_new_key','firewall_blocked') THEN RAISE EXCEPTION 'Unknown key state' USING ERRCODE='22023'; END IF;
  -- exchangeAborted: a personal-token exchange the firewall stopped before Hubstaff saw it, so the token is unused and may be exchanged again.
  UPDATE public.cockpit_hours_keys SET state=p->>'state',state_note=left(p->>'note',240),checked_at=now(),
    account_id=coalesce(p->>'accountId',account_id),
    exchange_started_at=CASE WHEN (p->>'exchangeAborted')::boolean IS TRUE THEN NULL ELSE exchange_started_at END
  WHERE provider=p->>'provider' AND (NOT (p ? 'version') OR version=(p->>'version')::integer);
  RETURN jsonb_build_object('ok',FOUND);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_pay_month_approve(p_actor_id uuid,p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor text; v_person bigint; v_month date; m public.cockpit_hours_pay_months; v_id bigint; c jsonb; v_next date; v_currency text;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  v_actor:=public.cockpit_ceo_verified_actor_email(p_actor_id);
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Verified founder access required' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR jsonb_typeof(p->'personId') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Choose a person first' USING ERRCODE='22023'; END IF;
  v_person:=(p->>'personId')::bigint;
  v_month:=public.cockpit_hours_month(p->>'month');
  IF coalesce(p->>'inputsHash','') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'The approval has no inputs hash' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(p->'inputs') IS DISTINCT FROM 'object' OR jsonb_typeof(p->'result') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'The approval needs its snapshot' USING ERRCODE='22023'; END IF;
  v_currency:=upper(p->>'currency');
  SELECT * INTO m FROM public.cockpit_hours_pay_months WHERE person_id=v_person AND month=v_month AND status<>'withdrawn' FOR UPDATE;
  IF FOUND THEN
    IF m.inputs_hash=p->>'inputsHash' THEN
      RETURN jsonb_build_object('ok',true,'existing',true,'approvedAt',m.approved_at,'amount',m.amount,'currency',m.currency);
    END IF;
    RAISE EXCEPTION '% is already approved with other figures. Withdraw it first to approve again', public.cockpit_hours_month_name(v_month) USING ERRCODE='23505';
  END IF;
  INSERT INTO public.cockpit_hours_pay_months(person_id,month,status,rule_version,inputs,result,inputs_hash,amount,currency,amount_usd,usd_rate,payable_s,shadow,approved_by)
  VALUES(v_person,v_month,'approved',p->>'ruleVersion',p->'inputs',p->'result',p->>'inputsHash',(p->>'amount')::numeric,v_currency,
    (p->>'amountUsd')::numeric,(p->>'usdRate')::numeric,(p->>'payableS')::integer,coalesce((p->>'shadow')::boolean,false),v_actor)
  RETURNING id INTO v_id;
  -- Changes carried from earlier approved months, written so the next recompute finds nothing left to carry.
  FOR c IN SELECT value FROM jsonb_array_elements(coalesce(p->'carries','[]'::jsonb)) LOOP
    INSERT INTO public.cockpit_time_adjustments(person_id,month,kind,amount,currency,from_month,carried,carry_kind,approval_id,reason,set_by)
    VALUES(v_person,v_month,'correction',(c->>'amount')::numeric,v_currency,public.cockpit_hours_month(c->>'fromMonth'),true,'change',v_id,
      'Carried at approval: changed since '||public.cockpit_hours_month_name(public.cockpit_hours_month(c->>'fromMonth'))||' was approved',v_actor);
  END LOOP;
  -- A negative correction above the monthly limit: the rest moves to the next month.
  IF jsonb_typeof(p->'remainder')='number' AND (p->>'remainder')::numeric<0 THEN
    v_next:=(v_month+interval '1 month')::date;
    INSERT INTO public.cockpit_time_adjustments(person_id,month,kind,amount,currency,from_month,carried,carry_kind,approval_id,reason,set_by)
    VALUES(v_person,v_next,'correction',(p->>'remainder')::numeric,v_currency,v_month,true,'remainder',v_id,
      'Carried at approval: the rest of a negative correction above the monthly limit',v_actor);
  END IF;
  PERFORM public.cockpit_hours_audit('hours.approve','cockpit_hours_pay_months',v_id::text,
    jsonb_build_object('personId',v_person,'month',to_char(v_month,'YYYY-MM'),'inputsHash',p->>'inputsHash','ruleVersion',p->>'ruleVersion','status','approved'),v_actor);
  RETURN jsonb_build_object('ok',true,'existing',false,'approvedAt',now(),'amount',(p->>'amount')::numeric,'currency',v_currency);
END;
$$;

CREATE OR REPLACE FUNCTION public.cockpit_hours_prune()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n_receipts integer; n_runs integer;
BEGIN
  PERFORM public.cockpit_hours_require_service();
  WITH d AS (DELETE FROM public.cockpit_hours_provider_health WHERE created_at<now()-interval '90 days' RETURNING 1) SELECT count(*) INTO n_receipts FROM d;
  WITH d AS (DELETE FROM public.cockpit_hours_sync_runs WHERE state<>'running' AND coalesce(finished_at,started_at)<now()-interval '90 days' RETURNING 1) SELECT count(*) INTO n_runs FROM d;
  IF n_receipts+n_runs>0 THEN
    PERFORM public.cockpit_hours_audit('hours.prune','cockpit_hours_provider_health',NULL,
      jsonb_build_object('receipts',n_receipts,'runs',n_runs,'olderThanDays',90),'sync');
  END IF;
  RETURN jsonb_build_object('ok',true,'receipts',n_receipts,'runs',n_runs);
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Function privileges: revoked from all four roles, then exactly one grant

DO $$
DECLARE f text;
BEGIN
  -- Internal: no role at all (called by the definer functions above).
  FOREACH f IN ARRAY ARRAY[
    'cockpit_hours_require_service()','cockpit_hours_kw_today()','cockpit_hours_month(text)','cockpit_hours_day(text)','cockpit_hours_month_name(date)',
    'cockpit_hours_ceo_email()','cockpit_hours_audit(text,text,text,jsonb,text)','cockpit_hours_role_default(text,text)','cockpit_hours_refuse_delete()',
    'cockpit_hours_pay_months_lock()','cockpit_hours_member_email()','cockpit_hours_people_pay()','cockpit_hours_people_schedule()',
    'cockpit_hours_people_employment()','cockpit_hours_sources()','cockpit_hours_account_id(bigint,text)','cockpit_hours_ceo_tt_user()',
    'cockpit_hours_hub_days_json(text,date,date)','cockpit_hours_bookings_json(text,date,date)','cockpit_hours_tt_days_json(text,date,date)',
    'cockpit_hours_holidays_json(bigint,date,date)','cockpit_hours_coverage_json(date,date)','cockpit_hours_approval_json(public.cockpit_hours_pay_months)',
    'cockpit_hours_adjustments_json(bigint,date)','cockpit_hours_inputs_body(date,bigint)','cockpit_hours_schedule_mismatch(jsonb,jsonb)',
    'cockpit_hours_person(jsonb)','cockpit_hours_last_approved(bigint)','cockpit_hours_day_snapshot(bigint,date)','cockpit_hours_month_currency(bigint,date)',
    'cockpit_hours_autolink(text)','cockpit_hours_cron_on()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  -- CEO RPCs, called from the browser.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_ceo_hours_inputs(date)','cockpit_ceo_hours_status()','cockpit_ceo_hours_costs()','cockpit_ceo_hours_terms_save(jsonb)',
    'cockpit_ceo_hours_link(jsonb)','cockpit_ceo_hours_leave_type_save(jsonb)','cockpit_ceo_hours_holiday_override(jsonb)',
    'cockpit_ceo_hours_adjust(jsonb)','cockpit_ceo_hours_adjust_withdraw(jsonb)','cockpit_ceo_hours_rules_save(jsonb)',
    'cockpit_ceo_hours_set_pay(jsonb)','cockpit_ceo_hours_schedule_save(jsonb)','cockpit_ceo_hours_employment(jsonb)',
    'cockpit_ceo_hours_key_expiry(jsonb)','cockpit_ceo_hours_withdraw_approval(jsonb)','cockpit_ceo_hours_mark_paid(jsonb)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
  END LOOP;
  -- Service RPCs, called by cockpit-hours-sync and cockpit-hours-api with the service key.
  FOREACH f IN ARRAY ARRAY[
    'cockpit_hours_inputs(date,bigint)','cockpit_hours_actor(uuid)','cockpit_hours_lease_claim(jsonb)','cockpit_hours_lease_renew(jsonb)',
    'cockpit_hours_run_finish(jsonb)','cockpit_hours_sync_apply(jsonb)','cockpit_hours_key_get(text)','cockpit_hours_key_put(jsonb)',
    'cockpit_hours_key_exchange_begin(jsonb)','cockpit_hours_key_rotate(jsonb)','cockpit_hours_key_state(jsonb)',
    'cockpit_hours_pay_month_approve(uuid,jsonb)','cockpit_hours_prune()','cockpit_hours_account_links(text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
