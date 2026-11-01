-- The CSM's money acts (waves 1 and 2, slice money-acts; 1 Nov 2026).
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Contract: docs/forms/WAVE12-CONTRACT.md
-- sections 2.7, 3.1, 3.2, 3.5, 4.7 to 4.10. Needs 20261101l (the staff record,
-- the notice kinds), 20261101m (the voids, kinds mrr and late, source system)
-- and 20261101n (checked rail payments); a guard below stops the file without
-- them.
--
-- 1. cockpit_billing_write takes the three staff forms and Set MRR:
--    - extension: weeks, reason, in or out of our control, the client's limits,
--      will they stop if billed on schedule, the call (or why there was none),
--      what would prevent it. Every extension moves Next Payment Date from the
--      later of the card's date and today (W13). One live grant per card: a
--      second one names the live grant in replacesGrantId and replaces it (W23).
--    - pause: kind (client request or non-payment), restart, reason, the call
--      and, for a client request, both consents the client gave on the call
--      (W8), checked here. A pause starts today (W11).
--    - resume: the day and, optionally, the next payment date.
--    - mrr: the card's MRR, one writer; 0 or lower needs a reason (Q13).
--    Each records its response (cockpit_form_staff_record), writes one event
--    whose detail is the shape of contract 3.3, queues its notice and an audit
--    row. requestId makes a repeat return the first result.
--    The billing sheet live before these forms (extension, pause, resume
--    under "edit", no requestId, no staff-form key) keeps its 20261009a rules,
--    so its buttons work until the new sheet ships and after a rollback of it.
-- 2. cockpit_extensions_v (grants from the billing log only, W9) and
--    cockpit_late_payments_v (late spells over the daily card snapshots, W10),
--    each read by the browser through a gated function.
-- 3. The ladder (pause review day 4, cancel review day 15, editable): read,
--    set and the derived review rows. No step changes a card or opens a ticket.
-- 4. cockpit_mrr_read: card MRR, the suggestion, the money refresh's rail
--    check and the downgrades this month.
-- 5. cockpit_form_prefill: every prefill value with its source sentence.
-- 6. cockpit_billing_daily: clears an ended grant on the card, opens and closes
--    late records. Off until billing.daily is on (D-P3).
-- 7. Settings seeds; forms.doors gains money; cockpit_settings_forms_audit
--    audits billing.% keys too.
-- 8. 20261101o's cockpit_client_lifecycle_v is repointed to the two views
--    above, with the same columns (section 5b).
--
-- Every function is SECURITY DEFINER with an empty search path, revoked from
-- all four roles, then granted as contract 2.7 says. The views are
-- security_invoker and readable by the service role only.
BEGIN;

-- ---------------------------------------------------------------------------
-- 0. The drift guard (contract 2.1, 2.2), then the files this one stands on.

DO $$
DECLARE
  v text;
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('cockpit_billing_write(text,jsonb)', '8d499d5faa361ea51b86905e3ff0998c', '8bdd972146ee2dfc0a5e1c6c0c5c47e4'),
      ('cockpit_settings_forms_audit()', 'ae654764bf7e86bd914d9df4cbbd089c', '62e182efea828afc7b2fca393bf58b51')
    ) AS x(fn, live, after) LOOP
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) INTO v
      FROM pg_catalog.pg_proc p WHERE p.oid = to_regprocedure('public.' || r.fn);
    IF v IS DISTINCT FROM r.live AND v IS DISTINCT FROM r.after THEN
      RAISE EXCEPTION '% changed since the waves 1-2 contract read it; stop and re-read it.', r.fn USING ERRCODE = '55000';
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regprocedure('public.cockpit_form_staff_record(text,text,jsonb,uuid,text)') IS NULL
     OR to_regclass('public.cockpit_billing_event_voids') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                     WHERE a.attrelid = 'public.cockpit_client_payments'::regclass AND a.attname = 'checked' AND NOT a.attisdropped)
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                     WHERE c.conrelid = 'public.cockpit_billing_events'::regclass AND c.conname = 'cockpit_billing_events_kind_check'
                       AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%''mrr''%' AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%''late''%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                     WHERE c.conrelid = 'public.cockpit_billing_events'::regclass AND c.conname = 'cockpit_billing_events_source_check'
                       AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%''system''%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
                     WHERE c.conrelid = 'public.cockpit_slack_notices'::regclass AND c.conname = 'cockpit_slack_notices_kind_check'
                       AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%extension.granted%') THEN
    RAISE EXCEPTION 'Apply 20261101l, 20261101m and 20261101n before 20261101p.' USING ERRCODE = '55000';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1. One request, one event. A held edit re-recorded fresh at a kind opening
--    (20261101m, W20) carries replaces_event_id and the same request id, so it
--    is left out of the rule.

CREATE UNIQUE INDEX IF NOT EXISTS cockpit_billing_events_request
  ON public.cockpit_billing_events ((detail->>'request_id'))
  WHERE detail->>'request_id' IS NOT NULL AND detail->>'replaces_event_id' IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Settings: billing.% keys are audited like forms.% (created before the seeds)

CREATE OR REPLACE FUNCTION public.cockpit_settings_forms_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_key text := CASE TG_OP WHEN 'DELETE' THEN OLD.key ELSE NEW.key END;
  v_by text := CASE TG_OP
                 WHEN 'INSERT' THEN NEW.updated_by
                 WHEN 'UPDATE' THEN CASE WHEN NEW.updated_by IS DISTINCT FROM OLD.updated_by THEN NEW.updated_by END
               END;
  v_area text;
BEGIN
  IF v_key IS NULL OR (v_key NOT LIKE 'forms.%' AND v_key NOT LIKE 'billing.%') THEN
    RETURN NULL;
  END IF;
  v_area := CASE WHEN v_key LIKE 'billing.%' THEN 'billing.setting' ELSE 'forms.switch' END;
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES (v_area || CASE TG_OP WHEN 'INSERT' THEN '_seeded' WHEN 'UPDATE' THEN '_set' ELSE '_removed' END,
          'cockpit_settings', v_key,
          coalesce(nullif(current_setting('cockpit.audit_actor', true), ''), nullif(btrim(v_by), ''), session_user::text),
          'client-success', 'supabase',
          CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN jsonb_build_object('value', OLD.value) END,
          CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN jsonb_build_object('value', NEW.value) END,
          jsonb_build_object('op', lower(TG_OP), 'key', v_key));
  RETURN NULL;
END $$;
COMMENT ON FUNCTION public.cockpit_settings_forms_audit() IS
  'Trigger on cockpit_settings: every change of a forms.% switch or a billing.% setting writes one audit row, whoever makes it (20261029z, widened by 20261101p).';
REVOKE ALL ON FUNCTION public.cockpit_settings_forms_audit() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS cockpit_settings_forms_audit ON public.cockpit_settings;
CREATE TRIGGER cockpit_settings_forms_audit AFTER INSERT OR UPDATE OR DELETE ON public.cockpit_settings
  FOR EACH ROW EXECUTE FUNCTION public.cockpit_settings_forms_audit();

INSERT INTO public.cockpit_settings (key, value, updated_by) VALUES
  ('billing.ladder', '{"pauseReviewDay":4,"cancelReviewDay":15}'::jsonb, 'migration 20261101p'),
  ('billing.mrr_tolerance', '{"pct":10}'::jsonb, 'migration 20261101p'),
  ('billing.daily', '{"on":false}'::jsonb, 'migration 20261101p')
ON CONFLICT (key) DO NOTHING;

-- The money doors open with this file (read by cockpit_form_doors, 20261101l).
-- A merge, never an overwrite; a second apply touches nothing.
INSERT INTO public.cockpit_settings (key, value, updated_by)
VALUES ('forms.doors', '{"money":true}'::jsonb, 'migration 20261101p')
ON CONFLICT (key) DO UPDATE SET value = public.cockpit_settings.value || '{"money":true}'::jsonb,
  updated_by = 'migration 20261101p', updated_at = now()
WHERE NOT (public.cockpit_settings.value @> '{"money":true}'::jsonb);

-- ---------------------------------------------------------------------------
-- 3. Small helpers (owner only)

-- The Kuwait day; every "today" in this file.
CREATE OR REPLACE FUNCTION public.cockpit_billing_today()
RETURNS date LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT (now() AT TIME ZONE 'Asia/Kuwait')::date
$$;

-- The seat that made an edit, in the words a card comment and a screen use
-- (roles, not names): the CEO, the CSM or finance.
CREATE OR REPLACE FUNCTION public.cockpit_billing_seat_role(p_client text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce(public.cockpit_is_ceo(), false) THEN RETURN 'the CEO'; END IF;
  IF coalesce(public.cockpit_has_role('csm'), false) AND coalesce(public.cockpit_client_allowed(p_client), false) THEN
    RETURN 'the CSM';
  END IF;
  IF coalesce(public.cockpit_has_role('finance'), false) THEN RETURN 'finance'; END IF;
  RETURN 'the CSM';
END $$;

-- May the caller read this client's billing: the CEO, finance, or a CSM on
-- their own client.
CREATE OR REPLACE FUNCTION public.cockpit_billing_reader_ok(p_client text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN coalesce(public.cockpit_is_ceo(), false)
      OR coalesce(public.cockpit_has_role('finance'), false)
      OR (coalesce(public.cockpit_has_role('csm'), false) AND coalesce(public.cockpit_client_allowed(p_client), false));
END $$;

-- The gate of every read here: a signed-in CEO, finance or CSM seat.
CREATE OR REPLACE FUNCTION public.cockpit_billing_read_gate()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to see billing.' USING ERRCODE = '42501'; END IF;
  IF NOT (coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('csm'), false)
          OR coalesce(public.cockpit_has_role('finance'), false)) THEN
    RAISE EXCEPTION 'Billing needs a client success, finance or CEO seat. Ask an admin to add the role.' USING ERRCODE = '42501';
  END IF;
END $$;

-- One choice from a list, by its code or its label, whatever the case; the code.
CREATE OR REPLACE FUNCTION public.cockpit_billing_pick(p_value text, p_options jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT o.key FROM jsonb_each_text(p_options) AS o(key, label)
   WHERE lower(btrim(coalesce(p_value, ''))) IN (lower(o.key), lower(o.label))
   LIMIT 1
$$;

-- A Kuwait day as the cockpit writes it in sentences: "2 Nov".
CREATE OR REPLACE FUNCTION public.cockpit_billing_day_words(p_day date)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_day IS NULL THEN NULL ELSE to_char(p_day, 'FMDD Mon') END
$$;

-- Dollars as a sentence reads them: "$1,333" or "$1,333.50".
CREATE OR REPLACE FUNCTION public.cockpit_billing_usd_words(p_usd numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_usd IS NULL THEN NULL
              ELSE '$' || regexp_replace(to_char(round(p_usd, 2), 'FM999,999,990.00'), '\.00$', '') END
$$;

-- The ladder as set, with the contract's defaults when the row is missing or
-- unreadable (pause review day 4, cancel review day 15).
CREATE OR REPLACE FUNCTION public.cockpit_billing_ladder_settings()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb; p integer; c integer;
BEGIN
  SELECT s.value INTO v FROM public.cockpit_settings s WHERE s.key = 'billing.ladder';
  p := CASE WHEN jsonb_typeof(v->'pauseReviewDay') = 'number' THEN (v->>'pauseReviewDay')::numeric::integer END;
  c := CASE WHEN jsonb_typeof(v->'cancelReviewDay') = 'number' THEN (v->>'cancelReviewDay')::numeric::integer END;
  IF p IS NULL OR c IS NULL OR NOT (1 <= p AND p < c AND c <= 60) THEN p := 4; c := 15; END IF;
  RETURN jsonb_build_object('pauseReviewDay', p, 'cancelReviewDay', c);
END $$;

-- Queue one notice; never raises. A failure is a note in cockpit_sync_state,
-- as the other notice queues do (20261025n), and the edit is still saved.
CREATE OR REPLACE FUNCTION public.cockpit_billing_notice(p_kind text, p_dedupe text, p_task text, p_client text, p_facts jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_id uuid;
BEGIN
  BEGIN
    v_id := public.cockpit_slack_notice_queue(p_kind, p_dedupe, p_task, p_client, p_facts, NULL, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.cockpit_slack_notice_queue_failed(format('The %s notice for %s could not be queued: %s', p_kind, p_client, SQLERRM));
    v_id := NULL;
  END;
  RETURN v_id;
END $$;

-- A call picked on a form: a call of this card (cockpit_csm_calls id) or a 1-1
-- response of this card (its uuid). NULL when it is neither.
CREATE OR REPLACE FUNCTION public.cockpit_billing_call_ok(p_task text, p_call text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v text := btrim(coalesce(p_call, ''));
BEGIN
  IF v ~ '^[0-9]{1,18}$' THEN
    IF EXISTS (SELECT 1 FROM public.cockpit_csm_calls c WHERE c.id = v::bigint AND c.task_id = p_task) THEN RETURN v; END IF;
  ELSIF v ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    IF EXISTS (SELECT 1 FROM public.cockpit_form_responses r
                WHERE r.id = v::uuid AND r.task_id = p_task AND r.form_key = 'checkin' AND r.state <> 'void') THEN
      RETURN lower(v);
    END IF;
  END IF;
  RETURN NULL;
END $$;

-- What the trail's card step reads right after a write: the queue item's state.
CREATE OR REPLACE FUNCTION public.cockpit_billing_card_state(p_event bigint)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT coalesce((SELECT CASE q.state WHEN 'dry_run' THEN 'held' ELSE q.state END
                     FROM public.cockpit_clickup_writeback_queue q WHERE q.dedupe_key = 'billing:' || p_event), 'none')
$$;

REVOKE ALL ON FUNCTION
  public.cockpit_billing_today(),
  public.cockpit_billing_seat_role(text),
  public.cockpit_billing_reader_ok(text),
  public.cockpit_billing_read_gate(),
  public.cockpit_billing_pick(text, jsonb),
  public.cockpit_billing_day_words(date),
  public.cockpit_billing_usd_words(numeric),
  public.cockpit_billing_ladder_settings(),
  public.cockpit_billing_notice(text, text, text, text, jsonb),
  public.cockpit_billing_call_ok(text, text),
  public.cockpit_billing_card_state(bigint)
FROM PUBLIC, anon, authenticated, service_role;

-- A text day as the views read it (the service role reads them, so not the
-- owner-only cockpit_billing_day): YYYY-MM-DD or NULL, never an error.
CREATE OR REPLACE FUNCTION public.cockpit_billing_iso_day(p_text text)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  IF p_text IS NULL OR p_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN RETURN NULL; END IF;
  RETURN left(p_text, 10)::date;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.cockpit_billing_iso_day(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_billing_iso_day(text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. cockpit_extensions_v: every grant, from the billing log only (W9)

CREATE OR REPLACE VIEW public.cockpit_extensions_v WITH (security_invoker = true) AS
WITH ev AS (
  SELECT e.* FROM public.cockpit_billing_events e
   WHERE e.kind = 'extension'
     AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids v WHERE v.event_id = e.id)
), t AS (
  -- A grant recorded again at a kind opening (cockpit_billing_held_release 'fresh') keeps its first time.
  SELECT ev.*, coalesce(CASE WHEN ev.detail->>'granted_at' ~ '^\d{4}-\d{2}-\d{2}' THEN (ev.detail->>'granted_at')::timestamptz END,
                        ev.at) AS g_at
    FROM ev
), g AS (
  SELECT ev.*, (ev.g_at AT TIME ZONE 'Asia/Kuwait')::date AS granted_on, (ev.detail->>'weeks')::integer AS weeks
    FROM t AS ev
   WHERE ev.source IN ('ceo','csm','maher') AND ev.detail->>'weeks' IN ('1','2','4')
)
SELECT
  g.id AS grant_id,
  g.clickup_task_id,
  g.client_name,
  g.g_at AS granted_at,
  g.granted_on,
  g.weeks,
  coalesce(public.cockpit_billing_iso_day(g.detail->>'from'), public.cockpit_billing_iso_day(g.from_value), g.granted_on) AS from_date,
  coalesce(public.cockpit_billing_iso_day(g.detail->>'new_date'),
           CASE WHEN g.detail->'movedDate' = 'true'::jsonb THEN public.cockpit_billing_iso_day(g.to_value) END,
           g.granted_on + g.weeks * 7) AS until,
  CASE WHEN jsonb_typeof(g.detail->'ours') = 'boolean' THEN (g.detail->>'ours')::boolean END AS ours,
  -- NULL on the two 10-19 grants: not asked then.
  CASE WHEN jsonb_typeof(g.detail->'at_risk') = 'boolean' THEN (g.detail->>'at_risk')::boolean END AS at_risk,
  g.reason,
  CASE WHEN jsonb_typeof(g.detail->'limitations') = 'array'
       THEN ARRAY(SELECT jsonb_array_elements_text(g.detail->'limitations')) END AS limitations,
  g.detail->>'call_id' AS call_id,
  g.detail->>'no_call_reason' AS no_call_reason,
  g.detail->>'prevent' AS prevent,
  CASE WHEN g.detail->>'response_id' ~ '^[0-9a-fA-F-]{36}$' THEN (g.detail->>'response_id')::uuid END AS response_id,
  coalesce(g.detail->>'seat_role',
           CASE g.source WHEN 'ceo' THEN 'the CEO' WHEN 'csm' THEN 'the CSM' WHEN 'maher' THEN 'the billing agent' END) AS seat_role,
  g.by_whom,
  CASE WHEN g.detail->>'replaces_grant_id' ~ '^[0-9]{1,18}$' THEN (g.detail->>'replaces_grant_id')::bigint END AS replaces_grant_id,
  r.replaced_by,
  CASE WHEN r.replaced_by IS NOT NULL THEN 'replaced'
       WHEN coalesce(public.cockpit_billing_iso_day(g.detail->>'new_date'),
                     CASE WHEN g.detail->'movedDate' = 'true'::jsonb THEN public.cockpit_billing_iso_day(g.to_value) END,
                     g.granted_on + g.weeks * 7) >= (now() AT TIME ZONE 'Asia/Kuwait')::date THEN 'live'
       ELSE 'ended' END AS state,
  (SELECT min(c.at) FROM ev c WHERE c.source = 'system' AND c.detail->>'grant_id' = g.id::text) AS cleared_at
FROM g
LEFT JOIN LATERAL (SELECT min(n.id) AS replaced_by FROM g n WHERE n.detail->>'replaces_grant_id' = g.id::text) r ON true;

COMMENT ON VIEW public.cockpit_extensions_v IS
  'Every extension grant, from cockpit_billing_events only (W9): one row per extension event from a person (ceo, csm, maher) of 1, 2 or 4 weeks, voided events left out. state replaced / live (until today or later, Kuwait) / ended; cleared_at is the daily step''s clear on the card. The two Typeform answers of 14 Sep were tests and are not grants.';
REVOKE ALL ON public.cockpit_extensions_v FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cockpit_extensions_v TO service_role;

-- ---------------------------------------------------------------------------
-- 5. cockpit_late_payments_v: late spells over the daily card snapshots (W10)
--
-- A spell is a maximal run, over the snapshot days present for a card (not
-- calendar days), of days with stage Active and the day past Next Payment
-- Date, with the date unchanged. A missing snapshot day (2026-10-08) sits
-- between two present days with the same stage and date, so it never splits a
-- spell.
--
-- The card snapshots trail the cockpit's own log (a held card write leaves the
-- old date on the card for days), so the log decides what the snapshots
-- cannot:
-- - A payment answers a run only once the run has ended (the card moved): an
--   open run is never dropped or stopped on a payment. Only client money paid
--   after the card's previous run ended counts, so the payment that answered
--   the last run (or one the CEO tied as not client money) never answers this
--   one. A run that ended and was paid (checked) on or before its due day was
--   never late and is left out.
-- - A person's extension granted from three days before the due day answers
--   an open run while the grant runs: the run stays open (the ladder and the
--   daily step hold it through their own live-grant checks) and its days stop
--   at the grant. A grant given on or before the due day leaves the run out
--   while it runs. When the grant ends with the card unmoved, the run counts
--   from the due day again.
-- - An ended run reads extended, its days stopping at the grant, only when it
--   was settled (paid or the card moved) by the grant's last day; one settled
--   later counts to the payment or the card's move, as if no grant.
-- - A run the daily step opened a late record for stays, whatever the rules
--   above say, so its record can close.

CREATE OR REPLACE VIEW public.cockpit_late_payments_v WITH (security_invoker = true) AS
WITH k AS (SELECT (now() AT TIME ZONE 'Asia/Kuwait')::date AS today),
d AS (
  SELECT b.clickup_task_id, b.client_name, b.day, b.stage, b.next_payment_date, b.next_payment_usd,
         coalesce(b.stage = 'Active' AND b.day > b.next_payment_date, false) AS late
    FROM public.cockpit_client_billing_days b
), o AS (
  SELECT d.*,
         lag(d.late) OVER w AS prev_late,
         lag(d.next_payment_date) OVER w AS prev_date
    FROM d WINDOW w AS (PARTITION BY d.clickup_task_id ORDER BY d.day)
), s AS (
  SELECT o.*,
         sum(CASE WHEN o.late AND (o.prev_late IS NOT TRUE OR o.prev_date IS DISTINCT FROM o.next_payment_date) THEN 1 ELSE 0 END)
           OVER (PARTITION BY o.clickup_task_id ORDER BY o.day) AS spell_no
    FROM o
), sp AS (
  SELECT s.clickup_task_id, s.spell_no,
         (array_agg(s.client_name ORDER BY s.day DESC))[1] AS client_name,
         min(s.next_payment_date) AS due_on,
         (array_agg(s.next_payment_usd ORDER BY s.day))[1] AS amount_usd,
         max(s.day) AS last_day
    FROM s WHERE s.late
   GROUP BY s.clickup_task_id, s.spell_no
), ended AS (
  SELECT sp.*, nx.day AS ended_on, nx.stage AS next_stage
    FROM sp
    LEFT JOIN LATERAL (SELECT d2.day, d2.stage FROM d d2
                        WHERE d2.clickup_task_id = sp.clickup_task_id AND d2.day > sp.last_day
                        ORDER BY d2.day LIMIT 1) nx ON true
), prior AS (
  -- The day the card's previous run ended: what came before it answered that run.
  SELECT ended.*,
         (SELECT max(e2.ended_on) FROM ended e2
           WHERE e2.clickup_task_id = ended.clickup_task_id AND e2.spell_no < ended.spell_no) AS prev_ended_on
    FROM ended
), paid AS (
  SELECT prior.*,
         (SELECT min(p.day) FROM public.cockpit_client_payments p
           WHERE p.clickup_task_id = prior.clickup_task_id AND p.active AND p.checked
             AND p.side IS DISTINCT FROM 'not_client' AND p.kind IS DISTINCT FROM 'none'
             AND p.day BETWEEN greatest(prior.due_on - 3, prior.prev_ended_on + 1) AND coalesce(prior.ended_on, k.today)) AS paid_on,
         (SELECT min(e.id) FROM public.cockpit_billing_events e
           WHERE e.clickup_task_id = prior.clickup_task_id AND e.kind = 'late' AND e.detail->>'due' = prior.due_on::text
             AND NOT (e.detail ? 'closes')
             AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids v WHERE v.event_id = e.id)) AS recorded_id
    FROM prior CROSS JOIN k
), granted AS (
  SELECT paid.*,
         -- The first grant that answers this due day (the log, not the card): from three days before it (and after
         -- the previous run ended) to the run's end; on an open run while the grant runs, on an ended run when it
         -- was settled (paid or the card moved) by the grant's last day.
         (SELECT min(x.granted_on) FROM public.cockpit_extensions_v x
           WHERE x.clickup_task_id = paid.clickup_task_id
             AND x.granted_on BETWEEN greatest(paid.due_on - 3, paid.prev_ended_on + 1) AND coalesce(paid.ended_on, k.today)
             AND CASE WHEN paid.ended_on IS NULL THEN x.until >= k.today
                      ELSE least(paid.paid_on, paid.ended_on) <= x.until END) AS granted_on,
         -- The daily step's late record for this run while it is open: one already closed is left out, so a run
         -- that is late again gets a new one.
         (SELECT min(e.id) FROM public.cockpit_billing_events e
           WHERE e.clickup_task_id = paid.clickup_task_id AND e.kind = 'late' AND e.detail->>'due' = paid.due_on::text
             AND NOT (e.detail ? 'closes')
             AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids v WHERE v.event_id = e.id)
             AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_events c
                              WHERE c.kind = 'late' AND c.detail->>'closes' = e.id::text
                                AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids cv WHERE cv.event_id = c.id))) AS late_event_id
    FROM paid CROSS JOIN k
)
SELECT
  g.clickup_task_id,
  g.client_name,
  g.due_on,
  -- NULL stays NULL: "amount missing", never 0.
  g.amount_usd,
  g.ended_on,
  CASE WHEN g.ended_on IS NULL THEN 'open'
       WHEN g.granted_on IS NOT NULL THEN 'extended'
       WHEN g.next_stage IS DISTINCT FROM 'Active' THEN 'stopped'
       ELSE 'date_moved' END AS closed_how,
  g.paid_on,
  -- A payment that landed in the three days before the due date counts as on
  -- time, never as negative days; a payment stops the count only once the run
  -- ended; a grant that answers the run stops it on its day.
  greatest(0, least(CASE WHEN g.ended_on IS NOT NULL THEN g.paid_on END, g.granted_on, g.ended_on, k.today) - g.due_on) AS days_late,
  g.late_event_id
FROM granted g CROSS JOIN k
-- Paid by the due day (once ended) or extended by it: never late (a run the daily step opened a record for stays).
WHERE g.recorded_id IS NOT NULL
   OR NOT (coalesce(g.ended_on IS NOT NULL AND g.paid_on <= g.due_on, false) OR coalesce(g.granted_on <= g.due_on, false));

COMMENT ON VIEW public.cockpit_late_payments_v IS
  'Late payments as spells over cockpit_client_billing_days (W10): due_on, amount on the first late day (NULL is missing, never 0), ended_on (first snapshot after the spell), closed_how open / extended (a person''s grant from due_on - 3, from the billing log, with the run settled by the grant''s last day) / stopped / date_moved, paid_on (earliest checked client payment from due_on - 3 and after the previous run ended), days_late (to the payment once ended, the answering grant or the end, whichever is first; an open run counts to today unless a live grant stops it), and the daily step''s open late event (one not closed yet). A run paid (once ended) or extended by its due day is left out unless the daily step opened a record for it.';
REVOKE ALL ON public.cockpit_late_payments_v FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cockpit_late_payments_v TO service_role;

-- ---------------------------------------------------------------------------
-- 5b. 20261101o's cockpit_client_lifecycle_v, repointed (contract 3.2): the
--     live extension's end comes from cockpit_extensions_v and the days late
--     from the open spell in cockpit_late_payments_v, with the same columns.
--     Only when o's view is there (o applies before this file in the deploy;
--     a database without it keeps nothing to repoint).

DO $repoint$
BEGIN
  IF to_regclass('public.cockpit_client_lifecycle_v') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE $view$
CREATE OR REPLACE VIEW public.cockpit_client_lifecycle_v WITH (security_invoker = true) AS
WITH k AS (SELECT (now() AT TIME ZONE 'Asia/Kuwait')::date AS today),
ladder AS (
  SELECT coalesce((SELECT (s.value->>'pauseReviewDay')::integer FROM public.cockpit_settings s
                    WHERE s.key = 'billing.ladder' AND s.value->>'pauseReviewDay' ~ '^[0-9]{1,2}$'), 4) AS pause_day,
         coalesce((SELECT (s.value->>'cancelReviewDay')::integer FROM public.cockpit_settings s
                    WHERE s.key = 'billing.ladder' AND s.value->>'cancelReviewDay' ~ '^[0-9]{1,2}$'), 15) AS cancel_day
),
ev AS (
  SELECT e.* FROM public.cockpit_billing_events e
   WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids v WHERE v.event_id = e.id)
)
SELECT
  b.clickup_task_id,
  b.client_name,
  b.client_status,
  b.paused_on,
  p.id AS pause_event_id,
  CASE WHEN p.detail->>'pause_kind' IN ('client_request', 'non_payment') THEN p.detail->>'pause_kind' END AS pause_kind,
  CASE WHEN p.detail->>'restart' ~ '^\d{4}-\d{2}-\d{2}$' THEN (p.detail->>'restart')::date END AS pause_restart,
  CASE WHEN b.client_status = 'Paused' AND b.paused_on IS NOT NULL THEN k.today - b.paused_on END AS pause_days,
  x.until AS extension_until,
  d.id AS departure_id,
  d.left_on,
  d.confirmed_at AS churn_confirmed_at,
  d.survey_state,
  late.days_late,
  -- The same rule as cockpit_billing_ladder_due, so the client page, the cadence and Today agree: an open run on
  -- an Active card whose date has not moved since, with no live extension, counted from the due day.
  CASE
    WHEN b.client_status = 'Paused' AND b.paused_on IS NOT NULL AND k.today - b.paused_on >= 14 THEN 'pause_day14'
    WHEN late.due_on IS NULL OR x.until IS NOT NULL OR b.client_status IS DISTINCT FROM 'Active'
         OR b.next_payment_date IS DISTINCT FROM late.due_on THEN 'none'
    WHEN k.today - late.due_on >= ladder.cancel_day THEN 'cancel_review'
    WHEN k.today - late.due_on >= ladder.pause_day THEN 'pause_review'
    ELSE 'none'
  END AS ladder_step
FROM public.cockpit_billing_accounts b
CROSS JOIN k
CROSS JOIN ladder
LEFT JOIN LATERAL (
  SELECT e.id, e.detail FROM ev e
   WHERE e.clickup_task_id = b.clickup_task_id AND e.kind = 'pause' AND b.client_status = 'Paused'
     AND NOT EXISTS (SELECT 1 FROM ev r WHERE r.clickup_task_id = e.clickup_task_id AND r.kind = 'resume' AND r.at > e.at)
   ORDER BY e.at DESC, e.id DESC LIMIT 1
) p ON true
LEFT JOIN LATERAL (
  SELECT max(g.until) AS until FROM public.cockpit_extensions_v g
   WHERE g.clickup_task_id = b.clickup_task_id AND g.state = 'live'
) x ON true
LEFT JOIN LATERAL (
  SELECT dd.id, dd.left_on, dd.confirmed_at, dd.survey_state FROM public.cockpit_churn_departures dd
   WHERE dd.clickup_task_id = b.clickup_task_id AND dd.removed_at IS NULL
   ORDER BY dd.left_on DESC, dd.id DESC LIMIT 1
) d ON true
LEFT JOIN LATERAL (
  SELECT l.days_late, l.due_on FROM public.cockpit_late_payments_v l
   WHERE l.clickup_task_id = b.clickup_task_id AND l.closed_how = 'open'
   ORDER BY l.due_on DESC LIMIT 1
) late ON true
$view$;
  EXECUTE $c$COMMENT ON VIEW public.cockpit_client_lifecycle_v IS
  'One row per mirrored card: pause (event, kind, Resume On, days), the live extension''s end (cockpit_extensions_v), the latest departure and its confirm, the days late of the open spell (cockpit_late_payments_v, over the daily card snapshots) and the ladder step. NULL means nobody holds that value, never zero. Browser reads go through cockpit_client_lifecycle_read.'$c$;
  EXECUTE 'REVOKE ALL ON public.cockpit_client_lifecycle_v FROM PUBLIC, anon, authenticated, service_role';
  EXECUTE 'GRANT SELECT ON public.cockpit_client_lifecycle_v TO service_role';
END $repoint$;

-- ---------------------------------------------------------------------------
-- 6. cockpit_billing_write: the staff forms and Set MRR (4.7 to 4.9)

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
  -- The staff forms (20261101p).
  v_req text; v_request uuid; v_first public.cockpit_billing_events; v_staff boolean := false;
  v_role text; v_answers jsonb; v_response uuid; v_message text; v_notice text; v_facts jsonb;
  v_grant record; v_replaces bigint; v_base date; v_call text; v_ours boolean; v_risk boolean;
  v_limits jsonb; v_lim text; v_pkind text; v_restart date; v_cat text; v_consent jsonb; v_term boolean; v_over boolean;
  v_effective date; v_old_mrr numeric; v_legacy boolean := false;
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
    -- The staff forms send their answers flat ({kind, weeks, ...}); the
    -- billing sheet's older tabs send them under "edit". Both read the same.
    v_edit := CASE WHEN jsonb_typeof(p_args->'edit') = 'object' THEN p_args->'edit'
                   WHEN p_args ? 'kind' THEN p_args - 'taskId' - 'source' - 'requestId' END;
    IF jsonb_typeof(v_edit) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Say what to change.' USING ERRCODE='22023'; END IF;
    v_kind := coalesce(v_edit->>'kind', '');

    -- One request, one change: a repeat (a double press, a retry after a
    -- dropped connection) returns what the first one did and writes nothing.
    v_req := nullif(btrim(coalesce(p_args->>'requestId', v_edit->>'requestId', '')), '');
    IF v_req IS NOT NULL AND v_req !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RAISE EXCEPTION 'That change could not be read. Reload the page and try again.' USING ERRCODE='22023';
    END IF;
    -- The billing sheet live before the staff forms sends {kind:'extension',
    -- weeks, reason, ours, moveDate}, {kind:'pause', reason} and {kind:'resume',
    -- nextDate} under "edit", with no requestId. Those keep the 20261009a rules
    -- unchanged until the new sheet ships, and after a rollback of it. A
    -- requestId or any staff-form key makes it the staff form, every field required.
    v_legacy := jsonb_typeof(p_args->'edit') = 'object' AND v_req IS NULL AND v_kind IN ('extension', 'pause', 'resume')
                AND NOT (v_edit ?| ARRAY['atRisk', 'limitations', 'callId', 'noCall', 'noCallReason', 'prevent', 'replacesGrantId',
                                        'pauseKind', 'reasonCat', 'restart', 'consent', 'consentTerm', 'consentOver14']);
    v_staff := v_kind IN ('extension', 'pause', 'resume', 'mrr') AND NOT v_legacy;
    IF v_staff AND v_req IS NULL THEN
      RAISE EXCEPTION 'That form is out of date. Reload the page and send it again.' USING ERRCODE='22023';
    END IF;
    IF v_req IS NOT NULL THEN
      v_request := v_req::uuid; v_req := lower(v_req);
      SELECT * INTO v_first FROM public.cockpit_billing_events e WHERE e.detail->>'request_id' = v_req ORDER BY e.id LIMIT 1;
      IF FOUND THEN
        IF v_first.clickup_task_id IS DISTINCT FROM v_task THEN
          RAISE EXCEPTION 'That change could not be read. Reload the page and try again.' USING ERRCODE='22023';
        END IF;
        RETURN to_jsonb(v_acc) || jsonb_build_object('repeat', true, 'eventId', v_first.id,
          'responseId', v_first.detail->>'response_id', 'newDate', v_acc.next_payment_date,
          'cardState', public.cockpit_billing_card_state(v_first.id), 'message', 'Already saved.');
      END IF;
    END IF;
    v_role := public.cockpit_billing_seat_role(v_acc.client_name);

    IF v_legacy THEN
      -- The 20261009a branches, unchanged.
      CASE v_kind
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
      ELSE
        v_next.client_status := 'Active'; v_next.stage := 'Active'; v_next.stage_group := 'active'; v_next.paused_on := NULL;
        v_day := public.cockpit_billing_day(v_edit->>'nextDate');
        IF v_day IS NOT NULL THEN
          v_next.next_payment_date := v_day; v_detail := jsonb_build_object('nextDate', v_day);
        END IF;
        v_from := v_acc.client_status; v_to := 'Active';
      END CASE;
    ELSE
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
      -- Give more time (contract 3.7, 4.7). The date always moves (W13).
      IF jsonb_typeof(v_edit->'weeks') IS DISTINCT FROM 'number' OR (v_edit->>'weeks') NOT IN ('1', '2', '4') THEN
        RAISE EXCEPTION 'An extension is one, two or four weeks.' USING ERRCODE='22023';
      END IF;
      v_weeks := (v_edit->>'weeks')::integer;
      v_reason := public.cockpit_manual_clean_text(v_edit->>'reason', 400);
      IF coalesce(length(v_reason), 0) < 4 THEN RAISE EXCEPTION 'Say why, so the extension log reads back.' USING ERRCODE='22023'; END IF;
      IF jsonb_typeof(v_edit->'ours') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION 'Say whether the delay was in or out of our control.' USING ERRCODE='22023';
      END IF;
      v_ours := (v_edit->>'ours')::boolean;
      IF jsonb_typeof(v_edit->'atRisk') IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION 'Say whether they will stop if billed on schedule.' USING ERRCODE='22023';
      END IF;
      v_risk := (v_edit->>'atRisk')::boolean;
      -- The client's limits: the cockpit's own eight (W17); "No limitations" alone.
      v_limits := '[]'::jsonb;
      IF v_edit ? 'limitations' AND jsonb_typeof(v_edit->'limitations') IS DISTINCT FROM 'null' THEN
        IF jsonb_typeof(v_edit->'limitations') IS DISTINCT FROM 'array' THEN
          RAISE EXCEPTION 'Pick the client''s limits from the list.' USING ERRCODE='22023';
        END IF;
        FOR v_lim IN SELECT jsonb_array_elements_text(v_edit->'limitations') LOOP
          v_cat := public.cockpit_billing_pick(v_lim, '{"none":"No limitations","budget":"Budget","launch_slipped":"Launch slipped on their side","ad_account":"Ad account or page issue","content":"Content not ready","team_change":"Team or owner change","season":"Season or holiday","other":"Other"}'::jsonb);
          IF v_cat IS NULL THEN RAISE EXCEPTION 'Pick the client''s limits from the list.' USING ERRCODE='22023'; END IF;
          v_text := ('{"none":"No limitations","budget":"Budget","launch_slipped":"Launch slipped on their side","ad_account":"Ad account or page issue","content":"Content not ready","team_change":"Team or owner change","season":"Season or holiday","other":"Other"}'::jsonb)->>v_cat;
          IF NOT v_limits @> jsonb_build_array(v_text) THEN v_limits := v_limits || jsonb_build_array(v_text); END IF;
        END LOOP;
        IF v_limits @> '["No limitations"]'::jsonb AND jsonb_array_length(v_limits) > 1 THEN
          RAISE EXCEPTION '"No limitations" cannot be picked with another limit.' USING ERRCODE='22023';
        END IF;
      END IF;
      -- The call where it was agreed, or why there was none.
      IF coalesce(v_edit->'noCall' = 'true'::jsonb, false) THEN
        v_text := public.cockpit_manual_clean_text(v_edit->>'noCallReason', 400);
        IF coalesce(length(v_text), 0) < 4 THEN
          RAISE EXCEPTION 'Pick the call where this was agreed, or say why there was no call.' USING ERRCODE='22023';
        END IF;
        v_call := NULL;
      ELSE
        IF nullif(btrim(coalesce(v_edit->>'callId', '')), '') IS NULL THEN
          RAISE EXCEPTION 'Pick the call where this was agreed, or say why there was no call.' USING ERRCODE='22023';
        END IF;
        v_call := public.cockpit_billing_call_ok(v_task, v_edit->>'callId');
        IF v_call IS NULL THEN RAISE EXCEPTION 'That call is not on this client''s record. Pick one from the list.' USING ERRCODE='22023'; END IF;
        v_text := NULL;
      END IF;
      v_note := public.cockpit_manual_clean_text(v_edit->>'prevent', 400);
      -- One live grant per card, extended by replacement (W23).
      SELECT x.grant_id, x.until INTO v_grant FROM public.cockpit_extensions_v x
       WHERE x.clickup_task_id = v_task AND x.state = 'live' ORDER BY x.grant_id DESC LIMIT 1;
      v_replaces := CASE WHEN v_edit->>'replacesGrantId' ~ '^[0-9]{1,18}$' THEN (v_edit->>'replacesGrantId')::bigint END;
      IF v_grant.grant_id IS NOT NULL AND v_replaces IS NULL THEN
        RAISE EXCEPTION 'An extension already runs to %. Open Give more time again to add weeks to it.',
          public.cockpit_billing_day_words(v_grant.until) USING ERRCODE='22023';
      END IF;
      IF v_replaces IS NOT NULL AND v_replaces IS DISTINCT FROM v_grant.grant_id THEN
        RAISE EXCEPTION 'That extension has ended or changed since the form opened. Close it and open Give more time again.' USING ERRCODE='22023';
      END IF;
      -- From the later of the card's date (already moved by a live grant) and today.
      v_base := greatest(coalesce(v_acc.next_payment_date, v_today), v_today);
      v_next.next_payment_date := v_base + v_weeks * 7;
      v_next.extension_weeks := v_weeks;
      v_moved := true;
      v_from := v_acc.next_payment_date::text; v_to := v_next.next_payment_date::text;
      v_answers := jsonb_strip_nulls(jsonb_build_object('weeks', v_weeks, 'reason', v_reason, 'ours', v_ours,
        'limitations', v_limits, 'atRisk', v_risk, 'callId', v_call, 'noCall', CASE WHEN v_call IS NULL THEN true END,
        'noCallReason', v_text, 'prevent', v_note, 'replacesGrantId', v_replaces));
      v_detail := jsonb_strip_nulls(jsonb_build_object('weeks', v_weeks, 'ours', v_ours, 'movedDate', true,
        'new_date', v_next.next_payment_date, 'from', v_base, 'limitations', v_limits, 'at_risk', v_risk,
        'call_id', v_call, 'no_call_reason', v_text, 'prevent', v_note, 'replaces_grant_id', v_replaces,
        'request_id', v_req, 'seat_role', v_role));
      v_message := format('Given: %s %s to %s', v_weeks, CASE WHEN v_weeks = 1 THEN 'week' ELSE 'weeks' END,
                          public.cockpit_billing_day_words(v_next.next_payment_date));
      v_notice := 'extension.granted';
      v_facts := jsonb_build_object('weeks', v_weeks, 'until', v_next.next_payment_date);

    WHEN 'pause' THEN
      -- Pause this client (contract 3.5, 4.8). Starts today (W11).
      IF v_acc.client_status = 'Paused' THEN
        RAISE EXCEPTION 'This client is already paused. Resume them first.' USING ERRCODE='22023';
      END IF;
      v_pkind := public.cockpit_billing_pick(v_edit->>'pauseKind', '{"client_request":"client request","non_payment":"non-payment"}'::jsonb);
      IF v_pkind IS NULL THEN RAISE EXCEPTION 'Say whether the client asked or is not paying.' USING ERRCODE='22023'; END IF;
      v_cat := public.cockpit_billing_pick(v_edit->>'reasonCat',
        '{"client_asked":"Client asked","not_paying":"Not paying","launch_slipped":"Client''s own launch slipped","seasonal":"Seasonal","other":"Other"}'::jsonb);
      IF v_cat IS NULL THEN RAISE EXCEPTION 'Pick why they pause.' USING ERRCODE='22023'; END IF;
      v_reason := public.cockpit_manual_clean_text(v_edit->>'reason', 400);
      IF coalesce(length(v_reason), 0) < 4 THEN RAISE EXCEPTION 'Say why, so the pause reads back in a month.' USING ERRCODE='22023'; END IF;
      v_restart := public.cockpit_billing_day(v_edit->>'restart');
      IF nullif(btrim(coalesce(v_edit->>'restart', '')), '') IS NOT NULL AND v_restart IS NULL THEN
        RAISE EXCEPTION 'That restart day is not a date.' USING ERRCODE='22023';
      END IF;
      IF v_restart IS NOT NULL AND v_restart <= v_today THEN
        RAISE EXCEPTION 'Pick the restart day, after today.' USING ERRCODE='22023';
      END IF;
      v_call := NULL;
      IF nullif(btrim(coalesce(v_edit->>'callId', '')), '') IS NOT NULL THEN
        v_call := public.cockpit_billing_call_ok(v_task, v_edit->>'callId');
        IF v_call IS NULL THEN RAISE EXCEPTION 'That call is not on this client''s record. Pick one from the list.' USING ERRCODE='22023'; END IF;
      END IF;
      v_consent := NULL;
      IF v_pkind = 'client_request' THEN
        IF v_restart IS NULL THEN RAISE EXCEPTION 'Pick the restart day, after today.' USING ERRCODE='22023'; END IF;
        IF v_call IS NULL THEN RAISE EXCEPTION 'Pick the call where the client asked to pause.' USING ERRCODE='22023'; END IF;
        IF EXISTS (SELECT 1 FROM public.cockpit_forms f WHERE f.key = 'pause_consent' AND f.provider = 'native') THEN
          -- Wave 3: the client's own signed consent replaces the two ticks (W8).
          IF NOT EXISTS (SELECT 1 FROM public.cockpit_form_responses r
                          WHERE r.form_key = 'pause_consent' AND r.task_id = v_task AND r.state IN ('submitted','confirmed')
                            AND r.submitted_at > now() - interval '14 days') THEN
            RAISE EXCEPTION 'The client has not signed the pause consent in the last 14 days. Send it from the client page first.' USING ERRCODE='22023';
          END IF;
          v_consent := jsonb_build_object('kind', 'signed', 'call_id', v_call);
        ELSE
          -- The call is the consent, with the CSM's two required ticks.
          v_term := coalesce((v_edit->'consent'->'term_runs') = 'true'::jsonb, (v_edit->'consent'->'termRuns') = 'true'::jsonb,
                             (v_edit->'consentTerm') = 'true'::jsonb, false);
          v_over := coalesce((v_edit->'consent'->'over_14_ends') = 'true'::jsonb, (v_edit->'consent'->'over14Ends') = 'true'::jsonb,
                             (v_edit->'consentOver14') = 'true'::jsonb, false);
          IF NOT (v_term AND v_over) THEN
            RAISE EXCEPTION 'Tick both consents the client gave on the call.' USING ERRCODE='22023';
          END IF;
          v_consent := jsonb_build_object('kind', 'call', 'call_id', v_call, 'term_runs', true, 'over_14_ends', true);
        END IF;
      END IF;
      v_next.client_status := 'Paused'; v_next.stage := 'Paused'; v_next.stage_group := 'paused'; v_next.paused_on := v_today;
      v_from := v_acc.client_status; v_to := 'Paused';
      v_answers := jsonb_strip_nulls(jsonb_build_object('pauseKind', v_pkind, 'restart', v_restart, 'reasonCat', v_cat,
        'reason', v_reason, 'callId', v_call,
        'consentTerm', CASE WHEN v_consent->>'kind' = 'call' THEN true END,
        'consentOver14', CASE WHEN v_consent->>'kind' = 'call' THEN true END));
      v_detail := jsonb_strip_nulls(jsonb_build_object('pause_kind', v_pkind, 'on', v_today, 'restart', v_restart,
        'reason_cat', v_cat, 'call_id', v_call, 'consent', v_consent, 'request_id', v_req, 'seat_role', v_role));
      v_message := 'Paused from ' || public.cockpit_billing_day_words(v_today)
                   || coalesce(', restarts ' || public.cockpit_billing_day_words(v_restart), '');
      v_notice := 'pause.agreed';
      v_facts := jsonb_strip_nulls(jsonb_build_object('on', v_today, 'restart', v_restart));

    WHEN 'resume' THEN
      IF v_acc.client_status IS DISTINCT FROM 'Paused' THEN
        RAISE EXCEPTION 'This client is not paused, so there is nothing to resume.' USING ERRCODE='22023';
      END IF;
      v_day := coalesce(public.cockpit_billing_day(v_edit->>'on'), v_today);
      IF v_day > v_today OR (v_acc.paused_on IS NOT NULL AND v_day < v_acc.paused_on) THEN
        RAISE EXCEPTION 'Pick the day they resumed: today, or a day since the pause began.' USING ERRCODE='22023';
      END IF;
      v_next_day := public.cockpit_billing_day(v_edit->>'nextDate');
      IF nullif(btrim(coalesce(v_edit->>'nextDate', '')), '') IS NOT NULL AND v_next_day IS NULL THEN
        RAISE EXCEPTION 'That next payment date is not a date.' USING ERRCODE='22023';
      END IF;
      IF v_next_day IS NOT NULL AND v_next_day < v_today - 60 THEN
        RAISE EXCEPTION 'A payment date two months back is almost certainly a typo.' USING ERRCODE='22023';
      END IF;
      v_next.client_status := 'Active'; v_next.stage := 'Active'; v_next.stage_group := 'active'; v_next.paused_on := NULL;
      IF v_next_day IS NOT NULL THEN v_next.next_payment_date := v_next_day; END IF;
      v_from := v_acc.client_status; v_to := 'Active';
      v_answers := jsonb_strip_nulls(jsonb_build_object('on', v_day, 'nextDate', v_next_day));
      v_detail := jsonb_strip_nulls(jsonb_build_object('on', v_day, 'nextDate', v_next_day,
        'pause_days', CASE WHEN v_acc.paused_on IS NOT NULL THEN v_day - v_acc.paused_on END,
        'request_id', v_req, 'seat_role', v_role));
      v_message := 'Resumed ' || public.cockpit_billing_day_words(v_day)
                   || coalesce('; next payment ' || public.cockpit_billing_day_words(v_next_day), '');
      v_notice := 'client.resumed';
      v_facts := jsonb_build_object('on', v_day);

    WHEN 'mrr' THEN
      -- Set MRR (contract 4.9): the one writer of the card's MRR.
      IF jsonb_typeof(v_edit->'value') IS DISTINCT FROM 'number' THEN
        RAISE EXCEPTION 'Type the MRR in dollars, 0 or more.' USING ERRCODE='22023';
      END IF;
      v_value := round((v_edit->>'value')::numeric, 2);
      IF v_value < 0 OR v_value > 100000 THEN RAISE EXCEPTION 'Type the MRR in dollars, 0 or more.' USING ERRCODE='22023'; END IF;
      v_old_mrr := v_acc.mrr_usd;
      IF v_old_mrr IS NOT NULL AND v_old_mrr = v_value THEN
        RAISE EXCEPTION 'The card already shows that MRR.' USING ERRCODE='22023';
      END IF;
      v_cat := public.cockpit_billing_pick(v_edit->>'reasonCat',
        '{"price_change":"Price change","plan_change":"Plan change","upsell":"Upsell","downgrade":"Downgrade","correction":"Correction"}'::jsonb);
      IF v_cat IS NULL THEN RAISE EXCEPTION 'Pick why the MRR changes.' USING ERRCODE='22023'; END IF;
      v_reason := public.cockpit_manual_clean_text(v_edit->>'reason', 400);
      IF v_value = 0 AND coalesce(length(v_reason), 0) < 4 THEN
        RAISE EXCEPTION 'Say why the MRR goes to zero.' USING ERRCODE='22023';
      END IF;
      IF v_old_mrr IS NOT NULL AND v_value < v_old_mrr AND coalesce(length(v_reason), 0) < 4 THEN
        RAISE EXCEPTION 'Say why the MRR goes down, so the downgrade reads back.' USING ERRCODE='22023';
      END IF;
      v_effective := coalesce(public.cockpit_billing_day(v_edit->>'effective'), v_today);
      IF v_effective < v_today - 60 OR v_effective > v_today + 60 THEN
        RAISE EXCEPTION 'Pick a start day within two months of today.' USING ERRCODE='22023';
      END IF;
      v_next.mrr_usd := v_value;
      v_from := trim_scale(v_old_mrr)::text; v_to := trim_scale(v_value)::text;
      v_answers := jsonb_strip_nulls(jsonb_build_object('mrrUsd', v_value, 'reasonCat', v_cat, 'reason', v_reason, 'effective', v_effective));
      v_detail := jsonb_strip_nulls(jsonb_build_object('from', v_old_mrr, 'to', v_value, 'reason_cat', v_cat,
        'effective', v_effective, 'request_id', v_req, 'seat_role', v_role));
      v_message := 'MRR set to ' || public.cockpit_billing_usd_words(v_value);

    WHEN 'note' THEN
      v_reason := public.cockpit_manual_clean_text(v_edit->>'text', 1000);
      IF coalesce(length(v_reason), 0) < 2 THEN RAISE EXCEPTION 'Write the note first.' USING ERRCODE='22023'; END IF;
    ELSE
      RAISE EXCEPTION 'That is not a change the billing sheet makes.' USING ERRCODE='22023';
    END CASE;
    END IF;

    -- An older tab's change keeps its own detail; its request id still guards a repeat.
    IF NOT v_staff AND v_req IS NOT NULL THEN
      v_detail := coalesce(v_detail, '{}'::jsonb) || jsonb_build_object('request_id', v_req);
    END IF;

    -- The form's answers, recorded once per request (20261101l).
    IF v_staff THEN
      v_response := public.cockpit_form_staff_record(v_kind, v_task, v_answers, v_request, 'cockpit');
      v_detail := v_detail || jsonb_build_object('response_id', v_response);
    END IF;

    IF v_kind <> 'note' THEN
      UPDATE public.cockpit_billing_accounts SET
        stage = v_next.stage, stage_group = v_next.stage_group, client_status = v_next.client_status,
        payment_method = v_next.payment_method, payment_plan = v_next.payment_plan,
        next_payment_usd = v_next.next_payment_usd, next_payment_date = v_next.next_payment_date,
        paused_on = v_next.paused_on, extension_weeks = v_next.extension_weeks, mrr_usd = v_next.mrr_usd,
        source = v_source, synced_at = now()
      WHERE clickup_task_id = v_task
      RETURNING * INTO v_next;
    END IF;
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (v_task, v_acc.client_name, v_kind, v_from, v_to, v_reason, v_detail, v_source, v_who)
    RETURNING id INTO v_event;
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('billing.' || v_kind, 'cockpit_billing_accounts', v_task, v_who, v_app, 'supabase', to_jsonb(v_acc), to_jsonb(v_next),
            jsonb_strip_nulls(jsonb_build_object('event_id', v_event, 'request_id', v_req, 'response_id', v_response)));
    IF NOT v_staff THEN
      RETURN to_jsonb(v_next);
    END IF;
    -- Names and dates only (contract 3.4); the kind's settings decide where it posts.
    IF v_notice IS NOT NULL THEN
      PERFORM public.cockpit_billing_notice(v_notice, v_kind || ':' || v_event, v_task, v_acc.client_name,
        v_facts || jsonb_build_object('taskId', v_task, 'client', v_acc.client_name, 'eventId', v_event));
    END IF;
    RETURN to_jsonb(v_next) || jsonb_build_object('eventId', v_event, 'responseId', v_response,
      'newDate', v_next.next_payment_date, 'cardState', public.cockpit_billing_card_state(v_event), 'message', v_message);
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
    IF v_rail IS NULL OR v_rail NOT IN ('bank_transfer', 'cheque', 'cash', 'tap', 'ecom', 'other') THEN
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
    -- One rule with the Money tab (checked money, 20261101n): the CEO's bank
    -- reference of 3 or more characters makes the entry checked at once; with
    -- none (or a shorter one, kept in the note) it is logged, not checked.
    v_ledger := public.cockpit_ceo_manual_payment_add(
      jsonb_build_object('day', v_day::text, 'amount', p_args->'amount', 'currency', v_currency, 'rail', v_rail,
        'clientName', v_acc.client_name, 'clickupTaskId', v_task,
        'note', nullif(concat_ws('; ', CASE WHEN char_length(v_ref) < 3 THEN 'ref ' || v_ref END, v_note, 'receipt ' || v_evidence), ''),
        'allowRepeat', coalesce(p_args->'allowRepeat' = 'true'::jsonb, false))
      || CASE WHEN char_length(v_ref) >= 3 THEN jsonb_build_object('reference', v_ref) ELSE '{}'::jsonb END,
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
  'Every billing change from a cockpit: edit, payment, assign. CSM, finance or CEO seat; a CSM only on their portal clients; CEO-only for the CEO cockpit and for tying a payer. Each write leaves a cockpit_billing_events row and a cockpit_audit_log row; the trigger queues card writes for ClickUp. Since 20261101p the staff forms (extension, pause, resume) and Set MRR record their response, carry requestId (a repeat returns the first result) and queue their notice. The older billing sheet''s extension, pause and resume (under edit, no requestId, no staff-form key) keep the 20261009a rules until the new sheet ships.';
REVOKE ALL ON FUNCTION public.cockpit_billing_write(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_billing_write(text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. The browser's reads of the two views

CREATE OR REPLACE FUNCTION public.cockpit_extensions_read(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_billing_read_gate();
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND (p_to < p_from OR p_to - p_from > 400) THEN
    RAISE EXCEPTION 'Pick a window of up to 400 days, from before to.' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'note', 'From the billing log: extensions given on the billing sheet and the client page. The two Typeform answers of 14 Sep were tests and are not grants.',
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'grantId', x.grant_id, 'taskId', x.clickup_task_id, 'clientName', x.client_name,
        'grantedAt', x.granted_at, 'grantedOn', x.granted_on, 'weeks', x.weeks, 'from', x.from_date, 'until', x.until,
        'ours', x.ours, 'atRisk', x.at_risk, 'reason', x.reason, 'limitations', to_jsonb(x.limitations),
        'callId', x.call_id, 'noCallReason', x.no_call_reason, 'prevent', x.prevent, 'responseId', x.response_id,
        'seatRole', x.seat_role, 'replacesGrantId', x.replaces_grant_id, 'replacedBy', x.replaced_by,
        'state', x.state, 'clearedAt', x.cleared_at) ORDER BY x.granted_at DESC)
      FROM public.cockpit_extensions_v x
     WHERE (p_from IS NULL OR x.granted_on >= p_from) AND (p_to IS NULL OR x.granted_on <= p_to)
       AND public.cockpit_billing_reader_ok(x.client_name)), '[]'::jsonb));
END $$;
COMMENT ON FUNCTION public.cockpit_extensions_read(date, date) IS
  'Extension grants given in a window (Kuwait days, both ends included; NULL for open ends): the CEO and finance see all, a CSM their own clients. Each row as cockpit_extensions_v, the seat as a role.';

CREATE OR REPLACE FUNCTION public.cockpit_late_payments_read(p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public.cockpit_billing_read_gate();
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND (p_to < p_from OR p_to - p_from > 400) THEN
    RAISE EXCEPTION 'Pick a window of up to 400 days, from before to.' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'note', 'From the daily ClickUp card snapshots (since 7 Oct; 8 Oct is missing and does not split a late run). Paid means a checked payment on the rails; a date that moved is named, not counted as paid.',
    'rows', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'taskId', l.clickup_task_id, 'clientName', l.client_name, 'dueOn', l.due_on, 'amountUsd', l.amount_usd,
        'endedOn', l.ended_on, 'closedHow', l.closed_how, 'paidOn', l.paid_on, 'daysLate', l.days_late,
        'lateEventId', l.late_event_id) ORDER BY l.due_on DESC, l.client_name)
      FROM public.cockpit_late_payments_v l
     WHERE (p_from IS NULL OR l.due_on >= p_from) AND (p_to IS NULL OR l.due_on <= p_to)
       AND public.cockpit_billing_reader_ok(l.client_name)), '[]'::jsonb));
END $$;
COMMENT ON FUNCTION public.cockpit_late_payments_read(date, date) IS
  'Late payments whose due date falls in a window (Kuwait days, both ends included; NULL for open ends): the CEO and finance see all, a CSM their own clients. Each row as cockpit_late_payments_v.';

-- ---------------------------------------------------------------------------
-- 8. The ladder (LD): read, set, and the derived review rows

CREATE OR REPLACE FUNCTION public.cockpit_billing_ladder_read()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public.cockpit_billing_read_gate();
  v := public.cockpit_billing_ladder_settings();
  RETURN v || jsonb_build_object(
    'updatedAt', (SELECT s.updated_at FROM public.cockpit_settings s WHERE s.key = 'billing.ladder'),
    'canEdit', coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('admin'), false),
    'sentence', format('The ladder: a pause review on day %s and a cancel review on day %s. Neither changes the card by itself.',
                       v->>'pauseReviewDay', v->>'cancelReviewDay'));
END $$;
COMMENT ON FUNCTION public.cockpit_billing_ladder_read() IS
  'The overdue steps (billing.ladder): pause review day and cancel review day, with the sentence the billing sheet shows. Any billing seat.';

CREATE OR REPLACE FUNCTION public.cockpit_billing_ladder_set(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_who text; v_old jsonb; v_new jsonb; v_p integer; v_c integer;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to change the overdue steps.' USING ERRCODE = '42501'; END IF;
  IF NOT (coalesce(public.cockpit_is_ceo(), false) OR coalesce(public.cockpit_has_role('admin'), false)) THEN
    RAISE EXCEPTION 'Only the CEO or an admin changes the overdue steps.' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object'
     OR jsonb_typeof(p->'pauseReviewDay') IS DISTINCT FROM 'number' OR jsonb_typeof(p->'cancelReviewDay') IS DISTINCT FROM 'number'
     OR (p->>'pauseReviewDay') !~ '^[0-9]{1,2}$' OR (p->>'cancelReviewDay') !~ '^[0-9]{1,2}$' THEN
    RAISE EXCEPTION 'Type each step as a whole number of days late.' USING ERRCODE = '22023';
  END IF;
  v_p := (p->>'pauseReviewDay')::integer; v_c := (p->>'cancelReviewDay')::integer;
  IF v_p < 1 THEN RAISE EXCEPTION 'The pause review is on day 1 or later.' USING ERRCODE = '22023'; END IF;
  IF v_c <= v_p THEN RAISE EXCEPTION 'The cancel review comes after the pause review.' USING ERRCODE = '22023'; END IF;
  IF v_c > 60 THEN RAISE EXCEPTION 'The cancel review is on day 60 or earlier.' USING ERRCODE = '22023'; END IF;
  SELECT lower(btrim(au.email)) INTO v_who FROM auth.users au WHERE au.id = auth.uid();
  v_old := public.cockpit_billing_ladder_settings();
  v_new := jsonb_build_object('pauseReviewDay', v_p, 'cancelReviewDay', v_c);
  -- The settings trigger writes the billing.setting_set audit row with this actor.
  PERFORM set_config('cockpit.audit_actor', coalesce(v_who, 'unknown'), true);
  INSERT INTO public.cockpit_settings (key, value, updated_by, updated_at)
  VALUES ('billing.ladder', v_new, v_who, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now();
  PERFORM set_config('cockpit.audit_actor', '', true);
  RETURN v_new || jsonb_build_object('saved', true, 'before', v_old);
END $$;
COMMENT ON FUNCTION public.cockpit_billing_ladder_set(jsonb) IS
  'Set the overdue steps: {pauseReviewDay, cancelReviewDay}, 1 <= pause < cancel <= 60. The CEO or an admin; the settings trigger writes the audit row.';

CREATE OR REPLACE FUNCTION public.cockpit_billing_ladder_due()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_lad jsonb; v_p integer; v_c integer; v_today date := public.cockpit_billing_today();
BEGIN
  PERFORM public.cockpit_billing_read_gate();
  v_lad := public.cockpit_billing_ladder_settings();
  v_p := (v_lad->>'pauseReviewDay')::integer; v_c := (v_lad->>'cancelReviewDay')::integer;
  RETURN coalesce((SELECT jsonb_agg(r ORDER BY (r->>'daysLate')::integer DESC NULLS LAST, r->>'clientName') FROM (
    -- An open late run on an Active card whose date has not moved since, with no live extension.
    SELECT jsonb_build_object('taskId', l.clickup_task_id, 'clientName', a.client_name,
             'step', CASE WHEN v_today - l.due_on >= v_c THEN 'cancel_review' ELSE 'pause_review' END,
             'dueOn', l.due_on, 'daysLate', v_today - l.due_on, 'amountUsd', l.amount_usd,
             'extendedUntil', (SELECT max(x.until) FROM public.cockpit_extensions_v x WHERE x.clickup_task_id = l.clickup_task_id),
             'pausedOn', NULL) AS r
      FROM public.cockpit_late_payments_v l
      JOIN public.cockpit_billing_accounts a ON a.clickup_task_id = l.clickup_task_id
     WHERE l.closed_how = 'open' AND v_today - l.due_on >= v_p
       AND a.client_status = 'Active' AND a.next_payment_date IS NOT DISTINCT FROM l.due_on
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_extensions_v x WHERE x.clickup_task_id = l.clickup_task_id AND x.state = 'live')
       AND public.cockpit_billing_reader_ok(a.client_name)
    UNION ALL
    -- Paused for 14 days or more: restart or confirm churn.
    SELECT jsonb_build_object('taskId', a.clickup_task_id, 'clientName', a.client_name, 'step', 'pause_day14',
             'dueOn', a.next_payment_date, 'daysLate', NULL, 'pauseDays', v_today - a.paused_on, 'amountUsd', a.next_payment_usd,
             'extendedUntil', NULL, 'pausedOn', a.paused_on)
      FROM public.cockpit_billing_accounts a
     WHERE a.client_status = 'Paused' AND a.paused_on IS NOT NULL AND v_today - a.paused_on >= 14
       AND public.cockpit_billing_reader_ok(a.client_name)
  ) t), '[]'::jsonb);
END $$;
COMMENT ON FUNCTION public.cockpit_billing_ladder_due() IS
  'The overdue steps due today, derived (never a card change, never a ticket): pause_review from the ladder''s pause day, cancel_review from its cancel day (open late runs with no live extension on Active cards), pause_day14 for cards paused 14 days or more. A CSM sees their own clients.';

-- ---------------------------------------------------------------------------
-- 9. MRR: the card, the suggestion, the rail check and the downgrades

CREATE OR REPLACE FUNCTION public.cockpit_mrr_read()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tol numeric; v_money record; v_stale boolean; v_rows jsonb; v_month date;
  v_rail_note text;
BEGIN
  PERFORM public.cockpit_billing_read_gate();
  SELECT CASE WHEN jsonb_typeof(s.value->'pct') = 'number' AND (s.value->>'pct')::numeric BETWEEN 1 AND 50
              THEN (s.value->>'pct')::numeric ELSE 10 END INTO v_tol
    FROM public.cockpit_settings s WHERE s.key = 'billing.mrr_tolerance';
  v_tol := coalesce(v_tol, 10);
  SELECT c.updated_at, c.payload->'mrrCheck' AS mrr_check INTO v_money FROM public.cockpit_sections c WHERE c.key = 'money';
  v_stale := v_money.updated_at IS NULL OR v_money.updated_at < now() - interval '36 hours';
  v_rail_note := CASE WHEN v_money.updated_at IS NULL THEN 'The money refresh has not run, so rail cash is not compared.'
                      WHEN v_stale THEN 'The money refresh is older than a day and a half, so rail cash is not compared.'
                      WHEN jsonb_typeof(v_money.mrr_check->'rows') IS DISTINCT FROM 'array' THEN 'The money refresh has not compared rail cash yet.'
                 END;
  v_month := date_trunc('month', public.cockpit_billing_today())::date;

  WITH cards AS (
    SELECT a.clickup_task_id, a.client_name, a.mrr_usd, a.payment_plan, a.next_payment_usd,
           coalesce(a.payment_plan = 'Monthly', false) AS monthly
      FROM public.cockpit_billing_accounts a
     WHERE a.stage_group = 'active' AND public.cockpit_billing_reader_ok(a.client_name)
  ), rail AS (
    SELECT x->>'taskId' AS task, CASE WHEN jsonb_typeof(x->'railMonthlyUsd') = 'number' THEN (x->>'railMonthlyUsd')::numeric END AS usd,
           x->>'note' AS note
      FROM jsonb_array_elements(CASE WHEN NOT v_stale AND jsonb_typeof(v_money.mrr_check->'rows') = 'array'
                                     THEN v_money.mrr_check->'rows' ELSE '[]'::jsonb END) x
  ), j AS (
    SELECT c.*, CASE WHEN c.monthly THEN c.next_payment_usd END AS suggested, r.usd AS rail_usd, r.note AS rail_row_note
      FROM cards c LEFT JOIN rail r ON r.task = c.clickup_task_id
  ), f AS (
    SELECT j.*,
      CASE WHEN j.mrr_usd IS NULL THEN 'missing'
           WHEN NOT j.monthly THEN 'not_recurring'
           WHEN j.suggested IS NOT NULL AND j.suggested > 0 AND abs(j.mrr_usd - j.suggested) > j.suggested * v_tol / 100 THEN 'differs_suggestion'
           WHEN j.rail_usd IS NOT NULL AND j.mrr_usd > 0 AND abs(j.mrr_usd - j.rail_usd) > j.mrr_usd * v_tol / 100 THEN 'differs_rail'
           ELSE 'ok' END AS flag
      FROM j
  )
  SELECT jsonb_build_object(
    'rows', coalesce(jsonb_agg(jsonb_build_object(
       'taskId', f.clickup_task_id, 'clientName', f.client_name, 'plan', f.payment_plan, 'mrrUsd', f.mrr_usd,
       'suggestedUsd', f.suggested,
       'suggestionWhy', CASE WHEN NOT f.monthly THEN 'Not a monthly plan, so no suggestion.'
                             WHEN f.next_payment_usd IS NULL THEN 'The card has no Next Payment Amount, so no suggestion.'
                             ELSE 'The card''s Next Payment Amount on a monthly plan.' END,
       'railMonthlyUsd', f.rail_usd,
       'railNote', coalesce(v_rail_note, f.rail_row_note,
                            CASE WHEN f.rail_usd IS NULL THEN 'No recurring rail payment is tied to this card over the last two full months.' END),
       'flag', f.flag) ORDER BY (f.flag = 'ok'), f.client_name), '[]'::jsonb),
    'totals', jsonb_build_object(
       -- As the CEO projected MRR counts: active cards on a monthly plan.
       -- NULL when no monthly card holds an MRR: missing is never zero.
       'onBooks', sum(f.mrr_usd) FILTER (WHERE f.monthly),
       'onBooksCards', count(*) FILTER (WHERE f.monthly AND f.mrr_usd IS NOT NULL),
       'suggested', sum(f.suggested),
       'noSuggestion', count(*) FILTER (WHERE f.suggested IS NULL),
       'missing', count(*) FILTER (WHERE f.flag = 'missing'),
       'differ', count(*) FILTER (WHERE f.flag IN ('differs_suggestion','differs_rail'))))
  INTO v_rows FROM f;

  RETURN v_rows || jsonb_build_object(
    'asOf', v_money.updated_at,
    'tolerancePct', v_tol,
    'railNote', v_rail_note,
    'note', 'MRR is the card''s own field (Set MRR is its one writer). The suggestion is the card''s Next Payment Amount on a monthly plan; rail cash is checked rail money over the last two full months, from the money refresh.',
    'downgrades', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'taskId', e.clickup_task_id, 'clientName', e.client_name,
        'fromUsd', (e.from_value)::numeric, 'toUsd', (e.to_value)::numeric,
        'effective', coalesce(e.detail->>'effective', ((e.at AT TIME ZONE 'Asia/Kuwait')::date)::text),
        'reason', e.reason, 'reasonCat', e.detail->>'reason_cat',
        'seatRole', coalesce(e.detail->>'seat_role', CASE e.source WHEN 'ceo' THEN 'the CEO' ELSE 'the CSM' END),
        'eventId', e.id) ORDER BY e.at DESC)
      FROM public.cockpit_billing_events e
     WHERE e.kind = 'mrr' AND (e.at AT TIME ZONE 'Asia/Kuwait')::date >= v_month
       AND e.from_value ~ '^[0-9]+(\.[0-9]+)?$' AND e.to_value ~ '^[0-9]+(\.[0-9]+)?$'
       AND e.to_value::numeric < e.from_value::numeric
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids v WHERE v.event_id = e.id)
       AND public.cockpit_billing_reader_ok(e.client_name)), '[]'::jsonb));
END $$;
COMMENT ON FUNCTION public.cockpit_mrr_read() IS
  'Set MRR''s read (contract 3.1, 4.9): each active card''s MRR, the suggestion (Next Payment Amount on a monthly plan, else NULL with the reason), the money refresh''s rail cash (NULL with a sentence when that section is older than 36 hours), a flag, the totals and this month''s downgrades. Any billing seat; a CSM sees their own clients.';

-- ---------------------------------------------------------------------------
-- 10. Prefill: every value with where it came from (contract 3.1)

CREATE OR REPLACE FUNCTION public.cockpit_form_prefill(p_form_key text, p_task_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today date := public.cockpit_billing_today();
  a public.cockpit_billing_accounts;
  v_values jsonb := '[]'::jsonb;
  v_calls jsonb;
  v_hints jsonb := '[]'::jsonb;
  v_grant jsonb;
  v_survey jsonb;
  v_type jsonb;
  v_last jsonb;
  v_checkin record;
  v_late record;
  v_card text := 'the ClickUp card';
BEGIN
  PERFORM public.cockpit_billing_read_gate();
  IF p_form_key IS NULL OR p_form_key NOT IN ('extension','pause','resume','churn_confirm','mrr') THEN
    RAISE EXCEPTION 'That is not one of the staff forms.' USING ERRCODE = '22023';
  END IF;
  IF p_task_id IS NULL OR p_task_id !~ '^[A-Za-z0-9_-]{1,40}$' THEN
    RAISE EXCEPTION 'That is not a ClickUp card id.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO a FROM public.cockpit_billing_accounts WHERE clickup_task_id = p_task_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That client card is not on the billing sheet. Refresh the page and pick it again.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.cockpit_billing_reader_ok(a.client_name) THEN
    RAISE EXCEPTION '% is not one of your clients in the portal.', a.client_name USING ERRCODE = '42501';
  END IF;

  -- The card's last 30 days of calls and 1-1 notes, newest first.
  SELECT coalesce(jsonb_agg(c ORDER BY c->>'at' DESC), '[]'::jsonb) INTO v_calls FROM (
    SELECT jsonb_build_object('id', k.id::text, 'at', k.starts_at, 'kind', k.kind,
             'source', CASE k.source WHEN 'fathom' THEN 'Fathom' WHEN 'ghl_appointment' THEN 'the booking'
                                     WHEN 'zoom' THEN 'Zoom' WHEN 'checkin_form' THEN 'the 1-1 notes'
                                     ELSE 'the call log' END
                       || ', ' || public.cockpit_billing_day_words((k.starts_at AT TIME ZONE 'Asia/Kuwait')::date),
             'title', k.title) AS c
      FROM public.cockpit_csm_calls k
     WHERE k.task_id = p_task_id AND k.starts_at >= now() - interval '30 days' AND k.starts_at <= now()
       AND coalesce(k.status, '') NOT IN ('cancelled','canceled','no_show','noshow')
    UNION ALL
    SELECT jsonb_build_object('id', r.id::text, 'at', coalesce(r.submitted_at, r.created_at), 'kind', 'checkin',
             'source', 'the 1-1 notes, ' || public.cockpit_billing_day_words((coalesce(r.submitted_at, r.created_at) AT TIME ZONE 'Asia/Kuwait')::date),
             'title', '1-1 notes')
      FROM public.cockpit_form_responses r
     WHERE r.form_key = 'checkin' AND r.task_id = p_task_id AND r.state IN ('submitted','confirmed')
       AND coalesce(r.submitted_at, r.created_at) >= now() - interval '30 days'
  ) t;
  v_last := CASE WHEN jsonb_array_length(v_calls) > 0 THEN v_calls->0 END;

  -- An extension hint when the latest 1-1 notes in 30 days mention one.
  SELECT r.id, coalesce(r.submitted_at, r.created_at) AS at, r.answers INTO v_checkin
    FROM public.cockpit_form_responses r
   WHERE r.form_key = 'checkin' AND r.task_id = p_task_id AND r.state IN ('submitted','confirmed')
     AND coalesce(r.submitted_at, r.created_at) >= now() - interval '30 days'
   ORDER BY coalesce(r.submitted_at, r.created_at) DESC LIMIT 1;
  IF v_checkin.id IS NOT NULL AND v_checkin.answers::text ILIKE '%extension%' THEN
    v_hints := v_hints || jsonb_build_array(jsonb_build_object('text', 'The last 1-1 notes mention an extension',
      'source', 'the 1-1 notes, ' || public.cockpit_billing_day_words((v_checkin.at AT TIME ZONE 'Asia/Kuwait')::date)));
  END IF;

  SELECT jsonb_build_object('grantId', x.grant_id, 'weeks', x.weeks, 'from', x.from_date, 'until', x.until,
           'grantedOn', x.granted_on, 'reason', x.reason, 'seatRole', x.seat_role) INTO v_grant
    FROM public.cockpit_extensions_v x WHERE x.clickup_task_id = p_task_id AND x.state = 'live'
   ORDER BY x.grant_id DESC LIMIT 1;

  -- unverified: the card came only from the link's unsigned hidden id (20261101l), so the survey fills
  -- nothing until the CSM says it is this client's.
  SELECT jsonb_build_object('responseId', r.id, 'submittedAt', r.submitted_at, 'state', r.state,
           'noticeOn', coalesce(r.answer_meta->>'notice_on', ((r.submitted_at AT TIME ZONE 'Asia/Kuwait')::date)::text),
           'unverified', coalesce(r.answer_meta->>'match' = 'hidden_id_unverified', false)) INTO v_survey
    FROM public.cockpit_form_responses r
   WHERE r.form_key = 'exit_survey' AND r.task_id = p_task_id AND r.state <> 'void'
   ORDER BY r.submitted_at DESC NULLS LAST LIMIT 1;

  SELECT l.due_on, l.days_late INTO v_late FROM public.cockpit_late_payments_v l
   WHERE l.clickup_task_id = p_task_id AND l.closed_how = 'open' ORDER BY l.due_on DESC LIMIT 1;

  CASE p_form_key
  WHEN 'extension' THEN
    v_values := jsonb_build_array(
      CASE WHEN v_last IS NOT NULL THEN jsonb_build_object('key', 'callId', 'value', v_last->>'id', 'source', v_last->>'source')
           ELSE jsonb_build_object('key', 'callId', 'value', NULL, 'source', 'No call or 1-1 notes on this client in the last 30 days.') END);
  WHEN 'pause' THEN
    v_values := jsonb_build_array(
      CASE WHEN v_late.due_on IS NOT NULL
           THEN jsonb_build_object('key', 'pauseKind', 'value', 'non_payment',
                  'source', format('the late-payment record: due %s, %s days late', public.cockpit_billing_day_words(v_late.due_on), v_late.days_late))
           ELSE jsonb_build_object('key', 'pauseKind', 'value', NULL, 'source', 'Nobody holds this yet: say whether the client asked or is not paying.') END,
      CASE WHEN v_last IS NOT NULL THEN jsonb_build_object('key', 'callId', 'value', v_last->>'id', 'source', v_last->>'source')
           ELSE jsonb_build_object('key', 'callId', 'value', NULL, 'source', 'No call or 1-1 notes on this client in the last 30 days.') END);
  WHEN 'resume' THEN
    v_values := jsonb_build_array(
      jsonb_build_object('key', 'on', 'value', v_today, 'source', 'today'),
      CASE WHEN a.next_payment_date IS NOT NULL AND a.paused_on IS NOT NULL
           THEN jsonb_build_object('key', 'nextDate', 'value', a.next_payment_date + greatest(0, v_today - a.paused_on),
                  'source', format('the ClickUp card: its date %s plus %s paused days',
                                   public.cockpit_billing_day_words(a.next_payment_date), greatest(0, v_today - a.paused_on)))
           ELSE jsonb_build_object('key', 'nextDate', 'value', NULL,
                  'source', CASE WHEN a.paused_on IS NULL THEN 'The card has no Paused On date, so no next date is suggested.'
                                 ELSE 'The card has no Next Payment Date, so no next date is suggested.' END) END);
  WHEN 'churn_confirm' THEN
    IF to_regprocedure('public.cockpit_churn_type_default(text,date)') IS NOT NULL THEN
      EXECUTE 'SELECT to_jsonb(public.cockpit_churn_type_default($1, $2))' INTO v_type USING p_task_id, v_today;
    END IF;
    v_values := jsonb_build_array(
      jsonb_build_object('key', 'leftOn', 'value', NULL, 'source', 'Nobody holds this yet: pick the day they left.'),
      CASE WHEN v_survey->'unverified' = 'true'::jsonb
           THEN jsonb_build_object('key', 'noticeOn', 'value', NULL,
                  'source', 'The termination survey''s card came from its link, not checked: pick the notice day if it is this client''s.')
           WHEN v_survey IS NOT NULL
           THEN jsonb_build_object('key', 'noticeOn', 'value', v_survey->>'noticeOn',
                  'source', 'the termination survey, ' || public.cockpit_billing_day_words((v_survey->>'noticeOn')::date))
           ELSE jsonb_build_object('key', 'noticeOn', 'value', NULL, 'source', 'No termination survey from this client.') END,
      jsonb_build_object('key', 'reason', 'value', NULL, 'source', 'Nobody holds this yet: pick why they left.'),
      CASE WHEN v_type IS NOT NULL AND jsonb_typeof(v_type) = 'string'
           THEN jsonb_build_object('key', 'churnType', 'value', v_type #>> '{}', 'source', 'the day-90 rule')
           ELSE jsonb_build_object('key', 'churnType', 'value', NULL, 'source', 'The day-90 rule is not live yet: pick the type.') END,
      CASE WHEN a.mrr_usd IS NOT NULL THEN jsonb_build_object('key', 'mrrLostUsd', 'value', a.mrr_usd, 'source', v_card)
           ELSE jsonb_build_object('key', 'mrrLostUsd', 'value', NULL, 'source', 'The card has no MRR.') END,
      CASE WHEN v_survey->'unverified' = 'true'::jsonb
           THEN jsonb_build_object('key', 'surveyState', 'value', NULL,
                  'source', 'The termination survey''s card came from its link, not checked: say whether this client filled it.')
           WHEN v_survey IS NOT NULL THEN jsonb_build_object('key', 'surveyState', 'value', 'filled',
                  'source', 'the termination survey, ' || public.cockpit_billing_day_words((v_survey->>'noticeOn')::date))
           ELSE jsonb_build_object('key', 'surveyState', 'value', NULL, 'source', 'No termination survey from this client.') END,
      -- Never preselected: the latest call is not the exit call unless the CSM says so.
      CASE WHEN v_last IS NOT NULL THEN jsonb_build_object('key', 'exitCallId', 'value', NULL,
                  'source', 'Pick the exit call if there was one; the calls of the last 30 days are listed.')
           ELSE jsonb_build_object('key', 'exitCallId', 'value', NULL, 'source', 'No call or 1-1 notes on this client in the last 30 days.') END);
  WHEN 'mrr' THEN
    v_values := jsonb_build_array(
      CASE WHEN a.mrr_usd IS NOT NULL THEN jsonb_build_object('key', 'mrrUsd', 'value', a.mrr_usd, 'source', v_card)
           ELSE jsonb_build_object('key', 'mrrUsd', 'value', NULL, 'source', 'The card has no MRR yet.') END,
      jsonb_build_object('key', 'effective', 'value', v_today, 'source', 'today'));
  END CASE;

  RETURN jsonb_build_object(
    'formKey', p_form_key, 'taskId', p_task_id, 'clientName', a.client_name,
    'values', v_values, 'calls', v_calls, 'hints', v_hints,
    'card', jsonb_build_object(
      'status', jsonb_build_object('value', a.client_status, 'source', v_card),
      'nextDate', jsonb_build_object('value', a.next_payment_date, 'source', v_card),
      'nextAmountUsd', jsonb_build_object('value', a.next_payment_usd, 'source', v_card),
      'plan', jsonb_build_object('value', a.payment_plan, 'source', v_card),
      'mrrUsd', jsonb_build_object('value', a.mrr_usd, 'source', v_card),
      'pausedOn', jsonb_build_object('value', a.paused_on, 'source', v_card),
      'extensionWeeks', jsonb_build_object('value', a.extension_weeks, 'source', v_card),
      'syncedAt', a.synced_at),
    'grant', v_grant, 'survey', v_survey,
    'late', CASE WHEN v_late.due_on IS NOT NULL THEN jsonb_build_object('dueOn', v_late.due_on, 'daysLate', v_late.days_late) END,
    'churnTypeDefault', CASE WHEN p_form_key = 'churn_confirm' AND jsonb_typeof(v_type) = 'string' THEN v_type #>> '{}' END);
END $$;
COMMENT ON FUNCTION public.cockpit_form_prefill(text, text) IS
  'One read per staff form open (contract 3.1): each prefill value with its source sentence (NULL with a sentence when nobody holds it, never 0), the card''s calls and 1-1 notes of the last 30 days, hints, the card facts, the live grant, the latest termination survey (unverified when its card came only from the link''s hidden id, which then prefills nothing) and the day-90 default for a churn. A CSM on their own client, finance or the CEO.';

-- ---------------------------------------------------------------------------
-- 11. The daily step (contract 4.10): clear ended grants, open and close late records

-- The step for one Kuwait day (owner only; tests pass a day to move the clock).
CREATE OR REPLACE FUNCTION public.cockpit_billing_daily_run(p_today date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today date := coalesce(p_today, public.cockpit_billing_today());
  v_on boolean;
  v_lad jsonb; v_p integer;
  v_cleared integer := 0; v_opened integer := 0; v_closed integer := 0;
  v_note text; v_id bigint;
  g record; l record; o record;
BEGIN
  SELECT coalesce(s.value->'on' = 'true'::jsonb, false) INTO v_on FROM public.cockpit_settings s WHERE s.key = 'billing.daily';
  IF NOT coalesce(v_on, false) THEN
    INSERT INTO public.cockpit_sync_state(key, last_run_at, last_ok_at, ok, note, rows_seen, detail, updated_at)
    VALUES ('billing-daily', now(), now(), true, 'Off: billing.daily is off, so no extension was cleared and no late record was written.', 0,
            jsonb_build_object('ran', false), now())
    ON CONFLICT (key) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, last_ok_at = EXCLUDED.last_ok_at, ok = true,
      note = EXCLUDED.note, rows_seen = 0, detail = EXCLUDED.detail, updated_at = EXCLUDED.updated_at;
    RETURN jsonb_build_object('ran', false, 'why', 'billing.daily is off');
  END IF;
  -- One run at a time; a second run the same day finds nothing left to do.
  PERFORM pg_advisory_xact_lock(hashtext('cockpit_billing_daily'));
  PERFORM set_config('cockpit.audit_source', 'cron', true);
  v_lad := public.cockpit_billing_ladder_settings();
  v_p := (v_lad->>'pauseReviewDay')::integer;

  -- (1) A grant that ended yesterday or before, not replaced, not cleared yet,
  --     while the card still shows extension weeks: the cockpit clears it.
  FOR g IN
    SELECT x.grant_id, x.clickup_task_id, x.client_name, x.until, a.extension_weeks
      FROM public.cockpit_extensions_v x
      JOIN public.cockpit_billing_accounts a ON a.clickup_task_id = x.clickup_task_id
     WHERE x.until < v_today AND x.replaced_by IS NULL AND x.cleared_at IS NULL AND coalesce(a.extension_weeks, 0) > 0
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_extensions_v n
                        WHERE n.clickup_task_id = x.clickup_task_id AND n.grant_id > x.grant_id)
     ORDER BY x.grant_id
  LOOP
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (g.clickup_task_id, g.client_name, 'extension', trim_scale(g.extension_weeks)::text, '0', 'grant ended',
            jsonb_build_object('weeks', 0, 'reason', 'grant ended', 'grant_id', g.grant_id, 'until', g.until, 'seat_role', 'the cockpit'),
            'system', 'the cockpit');
    UPDATE public.cockpit_billing_accounts SET extension_weeks = 0, synced_at = now() WHERE clickup_task_id = g.clickup_task_id;
    v_cleared := v_cleared + 1;
  END LOOP;

  -- (2) Open a late record for each run that reached the pause review day,
  --     unless a grant still runs for the card (it opens when the grant ends unpaid).
  FOR l IN
    SELECT v.clickup_task_id, v.client_name, v.due_on, v.amount_usd
      FROM public.cockpit_late_payments_v v
     WHERE v.closed_how = 'open' AND v.late_event_id IS NULL AND v_today - v.due_on >= v_p
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_extensions_v x
                        WHERE x.clickup_task_id = v.clickup_task_id AND x.replaced_by IS NULL AND x.until >= v_today)
  LOOP
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (l.clickup_task_id, l.client_name, 'late', NULL, l.due_on::text,
            format('Late payment: day %s past %s', v_today - l.due_on, public.cockpit_billing_day_words(l.due_on)),
            jsonb_build_object('due', l.due_on, 'spell_day', v_today - l.due_on, 'amount_usd', l.amount_usd, 'seat_role', 'the cockpit'),
            'system', 'the cockpit');
    v_opened := v_opened + 1;
  END LOOP;

  -- ...and close each open record whose run has ended.
  FOR o IN
    SELECT e.id, e.clickup_task_id, e.client_name, v.due_on, v.days_late, v.paid_on, v.closed_how
      FROM public.cockpit_billing_events e
      JOIN public.cockpit_late_payments_v v ON v.clickup_task_id = e.clickup_task_id AND v.due_on::text = e.detail->>'due'
     WHERE e.kind = 'late' AND NOT (e.detail ? 'closes') AND v.closed_how <> 'open'
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids x WHERE x.event_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_events c WHERE c.kind = 'late' AND c.detail->>'closes' = e.id::text
                         AND NOT EXISTS (SELECT 1 FROM public.cockpit_billing_event_voids cv WHERE cv.event_id = c.id))
  LOOP
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (o.clickup_task_id, o.client_name, 'late', o.due_on::text, coalesce(o.paid_on::text, o.closed_how),
            format('Late %s days: due %s, %s', o.days_late, public.cockpit_billing_day_words(o.due_on),
                   CASE o.closed_how WHEN 'stopped' THEN 'client stopped' WHEN 'extended' THEN 'extension moved the date'
                                     ELSE coalesce('paid ' || public.cockpit_billing_day_words(o.paid_on), 'the date moved on the card') END),
            jsonb_strip_nulls(jsonb_build_object('closes', o.id, 'due', o.due_on, 'days_late', o.days_late, 'paid_on', o.paid_on,
                                                 'closed_how', o.closed_how, 'seat_role', 'the cockpit')),
            'system', 'the cockpit')
    RETURNING id INTO v_id;
    v_closed := v_closed + 1;
  END LOOP;

  v_note := format('Ran for %s: %s extension%s cleared, %s late record%s opened, %s closed.', v_today,
                   v_cleared, CASE WHEN v_cleared = 1 THEN '' ELSE 's' END, v_opened, CASE WHEN v_opened = 1 THEN '' ELSE 's' END, v_closed);
  INSERT INTO public.cockpit_sync_state(key, last_run_at, last_ok_at, ok, note, rows_seen, detail, updated_at)
  VALUES ('billing-daily', now(), now(), true, v_note, v_cleared + v_opened + v_closed,
          jsonb_build_object('ran', true, 'day', v_today, 'cleared', v_cleared, 'lateOpened', v_opened, 'lateClosed', v_closed, 'at', now()), now())
  ON CONFLICT (key) DO UPDATE SET last_run_at = EXCLUDED.last_run_at, last_ok_at = EXCLUDED.last_ok_at, ok = true,
    note = EXCLUDED.note, rows_seen = EXCLUDED.rows_seen, detail = EXCLUDED.detail, updated_at = EXCLUDED.updated_at;
  IF v_cleared + v_opened + v_closed > 0 THEN
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('billing.daily', 'cockpit_billing_events', v_today::text, 'the cockpit', 'client-success', 'supabase', NULL,
            jsonb_build_object('cleared', v_cleared, 'lateOpened', v_opened, 'lateClosed', v_closed), jsonb_build_object('day', v_today));
  END IF;
  RETURN jsonb_build_object('ran', true, 'day', v_today, 'cleared', v_cleared, 'lateOpened', v_opened, 'lateClosed', v_closed);
END $$;
COMMENT ON FUNCTION public.cockpit_billing_daily_run(date) IS
  'The daily billing step for one Kuwait day (owner only; cockpit_billing_daily runs it for today).';

CREATE OR REPLACE FUNCTION public.cockpit_billing_daily()
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT public.cockpit_billing_daily_run(public.cockpit_billing_today())
$$;
COMMENT ON FUNCTION public.cockpit_billing_daily() IS
  'The daily billing step (contract 4.10), off while billing.daily is off: clears an ended, unreplaced grant on the card (extension event source system), opens a late record when a run reaches the pause review day and closes it when the run ends; writes cockpit_sync_state billing-daily. Never inserts pause, churn or date.';

-- ---------------------------------------------------------------------------
-- 12. Privileges

REVOKE ALL ON FUNCTION
  public.cockpit_extensions_read(date, date),
  public.cockpit_late_payments_read(date, date),
  public.cockpit_billing_ladder_read(),
  public.cockpit_billing_ladder_set(jsonb),
  public.cockpit_billing_ladder_due(),
  public.cockpit_mrr_read(),
  public.cockpit_form_prefill(text, text),
  public.cockpit_billing_daily_run(date),
  public.cockpit_billing_daily()
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION
  public.cockpit_extensions_read(date, date),
  public.cockpit_late_payments_read(date, date),
  public.cockpit_billing_ladder_read(),
  public.cockpit_billing_ladder_set(jsonb),
  public.cockpit_billing_ladder_due(),
  public.cockpit_mrr_read(),
  public.cockpit_form_prefill(text, text)
TO authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_billing_daily() TO service_role;

-- ---------------------------------------------------------------------------
-- 13. The schedule: 08:10 Kuwait. It does nothing while billing.daily is off.

-- cron:begin
SELECT cron.unschedule(j.jobid) FROM cron.job AS j WHERE j.jobname = 'mahara-billing-daily';
SELECT cron.schedule('mahara-billing-daily', '10 5 * * *', $job$ select public.cockpit_billing_daily(); $job$);
-- cron:end

NOTIFY pgrst, 'reload schema';
COMMIT;
