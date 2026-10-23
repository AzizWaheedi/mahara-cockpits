-- Pending payments in Billing: the writes (confirm, withdraw, link, unlink)
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive. Needs 20261023x (the
-- tables, the kind check and the helpers) and 20261009a
-- (cockpit_billing_amount_problem, cockpit_billing_day) and 20260927d
-- (cockpit_manual_clean_text). Plan: hw-notes/billing-pending/PLAN.md 1.3
-- and 3.1.
--
-- cockpit_billing_balance_write(p_action, p_args) is a new function next to
-- cockpit_billing_write, which is left alone. It opens the same way: signed
-- in; a CEO, client success or finance seat; source 'ceo' only for the CEO;
-- a real card, locked; a success manager only on their own clients.
--
--   confirm   {taskId, dealResponseId?, part, partNo?, amount, currency, rail,
--              paidOn, evidenceUrl?, note?, source?}
--             A person's word that a part was paid on Whop, Tap or an Ecom
--             link. A transfer, cheque or cash is refused with a pointer to
--             Log a payment, because those never arrive on their own. Writes
--             one cockpit_billing_confirmations row, one cockpit_billing_events
--             row (kind confirm) and one cockpit_audit_log row (billing.confirm)
--             in one transaction, and nothing else: never a payment, the
--             inbox, the ledger, cash, LTV, pay or ClickUp.
--   withdraw  {taskId, confirmationId, reason}  the confirmer or the CEO, once.
--   link      {dealResponseId, taskId, note?}   CEO only: a signed deal no card
--             claims, tied to a card on the list whose own deal (if any) is
--             older, for this screen. The note stays in the link and audit rows.
--   unlink    {dealResponseId, reason}          CEO only.
--
-- Checks on confirm (PLAN 1.2 and 3.1): the card is on the caller's pending
-- payments list (cockpit_billing_card_listed; the CEO's includes Back with
-- sales); the amount passes cockpit_billing_amount_problem; the USD is the
-- amount, or KWD x 3.26; the deal's live confirmations that no rail payment
-- has proven yet (with the card's own from before it had a deal), plus this
-- one, stay within contract - rails + 1% of the contract; the paid-on day is
-- today (Kuwait) or before and no earlier than seven days before signing; the
-- deal is the card's newest live deal under cockpit_billing_deal_cards(), and
-- a confirmation with no deal is only for part 'all' on a card in onboarding
-- with no deal on record ("Terms not on record"). confirmed_by_ceo comes from
-- cockpit_is_ceo(), never from the request. The same confirmation sent twice
-- within two minutes is answered with the first, not saved again.
--
-- Safe to run twice: CREATE OR REPLACE and grants only.

BEGIN;

CREATE OR REPLACE FUNCTION public.cockpit_billing_balance_write(p_action text, p_args jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_who text;
  v_ceo boolean;
  v_source text;
  v_app text;
  v_task text;
  v_acc public.cockpit_billing_accounts;
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_deal_id text;
  v_deal public.cockpit_sales_deals;
  v_card_deal text;
  v_signed date;
  v_part text;
  v_part_no integer;
  v_amount numeric;
  v_currency text;
  v_usd numeric;
  v_rail text;
  v_day date;
  v_floor date;
  v_evidence text;
  v_note text;
  v_reason text;
  v_problem text;
  v_rails numeric;
  v_rails_as_of timestamptz;
  v_live numeric;
  v_left numeric;
  v_id bigint;
  v_event bigint;
  v_conf public.cockpit_billing_confirmations;
  v_before public.cockpit_billing_confirmations;
  v_link public.cockpit_billing_deal_links;
  v_link_before public.cockpit_billing_deal_links;
  v_assigned record;
  v_card_signed timestamptz;
  v_rail_name text;
  v_c public.cockpit_billing_confirmations;
  v_pid text;
  v_used text[] := '{}'::text[];
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in before changing billing.' USING ERRCODE = '42501'; END IF;
  v_ceo := coalesce(public.cockpit_is_ceo(), false);
  IF NOT (v_ceo OR coalesce(public.cockpit_has_role('csm'), false) OR coalesce(public.cockpit_has_role('finance'), false)) THEN
    RAISE EXCEPTION 'Billing changes need a client success, finance or CEO seat. Ask an admin to add the role.' USING ERRCODE = '42501';
  END IF;
  SELECT lower(btrim(au.email)) INTO v_who FROM auth.users au WHERE au.id = v_uid;
  IF v_who IS NULL OR v_who = '' THEN RAISE EXCEPTION 'Sign in before changing billing.' USING ERRCODE = '42501'; END IF;
  IF jsonb_typeof(p_args) IS DISTINCT FROM 'object' OR octet_length(p_args::text) > 20000 THEN
    RAISE EXCEPTION 'That billing change could not be read. Reload the page and try again.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_action, '') NOT IN ('confirm', 'withdraw', 'link', 'unlink') THEN
    RAISE EXCEPTION 'That is not a pending payments action.' USING ERRCODE = '22023';
  END IF;
  v_source := coalesce(nullif(p_args ->> 'source', ''), CASE WHEN v_ceo THEN 'ceo' ELSE 'csm' END);
  IF v_source NOT IN ('ceo', 'csm') THEN RAISE EXCEPTION 'That billing change came from an unknown cockpit.' USING ERRCODE = '22023'; END IF;
  IF v_source = 'ceo' AND NOT v_ceo THEN
    RAISE EXCEPTION 'Only the CEO can make a change from the CEO cockpit.' USING ERRCODE = '42501';
  END IF;
  IF p_action IN ('link', 'unlink') AND NOT v_ceo THEN
    RAISE EXCEPTION 'Only the CEO can link a signed deal to a client card.' USING ERRCODE = '42501';
  END IF;
  v_app := CASE v_source WHEN 'ceo' THEN 'media-buyer-cockpit' ELSE 'client-success-cockpit' END;

  -- ---------------------------------------------------------------------------
  -- unlink: needs no card id from the request; the live link names it.
  IF p_action = 'unlink' THEN
    v_deal_id := btrim(coalesce(p_args ->> 'dealResponseId', ''));
    IF v_deal_id !~ '^[A-Za-z0-9_-]{1,80}$' THEN RAISE EXCEPTION 'That is not a signed deal id.' USING ERRCODE = '22023'; END IF;
    v_reason := public.cockpit_manual_clean_text(p_args ->> 'reason', 300);
    IF coalesce(length(v_reason), 0) < 3 THEN RAISE EXCEPTION 'Say why in 3 to 300 characters.' USING ERRCODE = '22023'; END IF;
    SELECT * INTO v_link_before FROM public.cockpit_billing_deal_links l
     WHERE l.deal_response_id = v_deal_id AND l.cleared_at IS NULL FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That deal is not linked to a card. Reload the page.' USING ERRCODE = 'P0002'; END IF;
    SELECT * INTO v_acc FROM public.cockpit_billing_accounts WHERE clickup_task_id = v_link_before.clickup_task_id FOR UPDATE;
    UPDATE public.cockpit_billing_deal_links SET cleared_by = v_who, cleared_at = now(), cleared_reason = v_reason
     WHERE id = v_link_before.id RETURNING * INTO v_link;
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (v_link.clickup_task_id, coalesce(v_acc.client_name, v_link.clickup_task_id), 'unlink', v_deal_id, NULL, v_reason,
            jsonb_build_object('linkId', v_link.id, 'dealResponseId', v_deal_id), v_source, v_who)
    RETURNING id INTO v_event;
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('billing.unlink', 'cockpit_billing_deal_links', v_link.id::text, v_who, v_app, 'supabase',
            to_jsonb(v_link_before), to_jsonb(v_link), jsonb_build_object('event_id', v_event));
    RETURN jsonb_build_object('ok', true,
      'sentence', format('Unlinked from %s.', coalesce(v_acc.client_name, 'the card')),
      'link', jsonb_build_object('id', v_link.id, 'dealResponseId', v_link.deal_response_id, 'taskId', v_link.clickup_task_id,
                                 'clearedAt', v_link.cleared_at));
  END IF;

  -- Every other action names a card.
  v_task := btrim(coalesce(p_args ->> 'taskId', ''));
  IF v_task !~ '^[A-Za-z0-9_-]{1,40}$' THEN RAISE EXCEPTION 'That is not a ClickUp card id.' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_acc FROM public.cockpit_billing_accounts WHERE clickup_task_id = v_task FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That client card is not on the billing sheet. Refresh the page and pick it again.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_ceo AND NOT coalesce(public.cockpit_client_allowed(v_acc.client_name), false) THEN
    RAISE EXCEPTION '% is not one of your clients in the portal, so its billing is not yours to change.', v_acc.client_name USING ERRCODE = '42501';
  END IF;

  -- ---------------------------------------------------------------------------
  IF p_action = 'link' THEN
    v_deal_id := btrim(coalesce(p_args ->> 'dealResponseId', ''));
    IF v_deal_id !~ '^[A-Za-z0-9_-]{1,80}$' THEN RAISE EXCEPTION 'That is not a signed deal id.' USING ERRCODE = '22023'; END IF;
    v_note := public.cockpit_manual_clean_text(p_args ->> 'note', 500);
    -- One link at a time: two CEO tabs linking the same deal wait for each other.
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cockpit_billing_deal_links:' || v_deal_id, 0));
    SELECT * INTO v_assigned FROM public.cockpit_billing_deal_assignments() x WHERE x.deal_response_id = v_deal_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'That is not a live signed deal (voided, a test, or not mirrored yet).' USING ERRCODE = 'P0002';
    END IF;
    IF v_assigned.link_id IS NOT NULL THEN
      RAISE EXCEPTION 'That deal is already linked to a card. Unlink it first.' USING ERRCODE = '22023';
    END IF;
    IF v_assigned.clickup_task_id IS NOT NULL THEN
      RAISE EXCEPTION 'That deal already matches % by its %. If that is wrong, tie its payments on Money instead.',
        coalesce((SELECT a.client_name FROM public.cockpit_billing_accounts a WHERE a.clickup_task_id = v_assigned.clickup_task_id), 'a card'),
        CASE v_assigned.matched_by WHEN 'ledger' THEN 'payments' WHEN 'alias' THEN 'alias' ELSE 'name' END
        USING ERRCODE = '22023';
    END IF;
    -- The card has to be one the CEO sees on the list, and the deal has to
    -- become its deal: a link to a gone card, or to a card whose own deal is
    -- as new or newer, would take the deal off the no-card group and put it
    -- on no row.
    IF NOT public.cockpit_billing_card_listed(v_task, true) THEN
      RAISE EXCEPTION '% is not on the pending payments list. Link the deal to a client who is.', v_acc.client_name USING ERRCODE = '22023';
    END IF;
    SELECT x.signed_at INTO v_card_signed
    FROM public.cockpit_billing_deal_cards() dc
    JOIN public.cockpit_billing_deal_assignments() x ON x.deal_response_id = dc.deal_response_id
    WHERE dc.clickup_task_id = v_task;
    IF v_card_signed IS NOT NULL AND v_card_signed >= v_assigned.signed_at THEN
      RAISE EXCEPTION '% already has a signed deal from %; link this one to the client it belongs to.',
        v_acc.client_name, to_char((v_card_signed AT TIME ZONE 'Asia/Kuwait')::date, 'FMDD Mon YYYY') USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.cockpit_billing_deal_links(deal_response_id, clickup_task_id, note, set_by)
    VALUES (v_deal_id, v_task, v_note, v_who) RETURNING * INTO v_link;
    -- The note stays in the link row and the audit row: the billing log is
    -- read more widely, so its reason is left empty.
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (v_task, v_acc.client_name, 'link', NULL, v_deal_id, NULL,
            jsonb_build_object('linkId', v_link.id, 'dealResponseId', v_deal_id), v_source, v_who)
    RETURNING id INTO v_event;
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('billing.link', 'cockpit_billing_deal_links', v_link.id::text, v_who, v_app, 'supabase', NULL, to_jsonb(v_link),
            jsonb_build_object('event_id', v_event));
    RETURN jsonb_build_object('ok', true, 'sentence', format('Linked to %s.', v_acc.client_name),
      'link', jsonb_build_object('id', v_link.id, 'dealResponseId', v_link.deal_response_id, 'taskId', v_link.clickup_task_id,
                                 'setAt', v_link.set_at));
  END IF;

  -- ---------------------------------------------------------------------------
  IF p_action = 'withdraw' THEN
    IF jsonb_typeof(p_args -> 'confirmationId') IS DISTINCT FROM 'number' OR (p_args ->> 'confirmationId') !~ '^[0-9]{1,18}$' THEN
      RAISE EXCEPTION 'Say which confirmation to withdraw.' USING ERRCODE = '22023';
    END IF;
    v_reason := public.cockpit_manual_clean_text(p_args ->> 'reason', 300);
    IF coalesce(length(v_reason), 0) < 3 THEN RAISE EXCEPTION 'Say why in 3 to 300 characters.' USING ERRCODE = '22023'; END IF;
    SELECT * INTO v_before FROM public.cockpit_billing_confirmations c
     WHERE c.id = (p_args ->> 'confirmationId')::bigint AND c.clickup_task_id = v_task FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'That confirmation is not on this client. Reload the page.' USING ERRCODE = 'P0002'; END IF;
    IF v_before.withdrawn_at IS NOT NULL THEN
      RAISE EXCEPTION 'That confirmation was already withdrawn.' USING ERRCODE = '22023';
    END IF;
    IF NOT v_ceo AND v_before.confirmed_by IS DISTINCT FROM v_who THEN
      RAISE EXCEPTION 'Only the person who confirmed it, or the CEO, can withdraw it.' USING ERRCODE = '42501';
    END IF;
    UPDATE public.cockpit_billing_confirmations SET withdrawn_by = v_who, withdrawn_at = now(), withdrawn_reason = v_reason
     WHERE id = v_before.id RETURNING * INTO v_conf;
    INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
    VALUES (v_task, v_acc.client_name, 'unconfirm', trim_scale(v_conf.usd)::text, NULL, v_reason,
            jsonb_build_object('confirmationId', v_conf.id, 'part', v_conf.part, 'partNo', v_conf.part_no,
                               'dealResponseId', v_conf.deal_response_id), v_source, v_who)
    RETURNING id INTO v_event;
    INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
    VALUES ('billing.unconfirm', 'cockpit_billing_confirmations', v_conf.id::text, v_who, v_app, 'supabase',
            to_jsonb(v_before), to_jsonb(v_conf), jsonb_build_object('event_id', v_event));
    RETURN jsonb_build_object('ok', true, 'sentence', 'Withdrawn.',
      'confirmation', jsonb_build_object('id', v_conf.id, 'taskId', v_conf.clickup_task_id, 'withdrawnAt', v_conf.withdrawn_at,
                                         'withdrawnReason', v_conf.withdrawn_reason));
  END IF;

  -- ---------------------------------------------------------------------------
  -- confirm: only on a card the caller's pending payments list shows (the
  -- CEO's includes Back with sales), so no confirmation sits where no screen
  -- shows it. Withdraw above stays open, so a stray row can still be taken back.
  IF NOT public.cockpit_billing_card_listed(v_task, v_ceo) THEN
    RAISE EXCEPTION '% is not on the pending payments list. Reload the page to see who is.', v_acc.client_name USING ERRCODE = '22023';
  END IF;
  v_rail := lower(btrim(coalesce(p_args ->> 'rail', '')));
  IF v_rail = '' THEN RAISE EXCEPTION 'Pick how they paid: Whop, Tap or an Ecom link.' USING ERRCODE = '22023'; END IF;
  IF v_rail NOT IN ('whop', 'tap', 'ecom') THEN
    RAISE EXCEPTION 'A transfer, cheque or cash never arrives on its own. Log it as a payment with its receipt instead.' USING ERRCODE = '22023';
  END IF;
  v_rail_name := CASE v_rail WHEN 'whop' THEN 'Whop' WHEN 'tap' THEN 'Tap' ELSE 'Ecom' END;

  v_part := coalesce(p_args ->> 'part', '');
  IF v_part NOT IN ('deposit', 'onboarding', 'later', 'all') THEN
    RAISE EXCEPTION 'Say which part of the plan was paid.' USING ERRCODE = '22023';
  END IF;
  IF p_args -> 'partNo' IS NULL OR jsonb_typeof(p_args -> 'partNo') = 'null' THEN
    v_part_no := CASE WHEN v_part = 'later' THEN NULL ELSE 0 END;
  ELSIF jsonb_typeof(p_args -> 'partNo') = 'number' AND (p_args ->> 'partNo') ~ '^[0-9]{1,2}$' THEN
    v_part_no := (p_args ->> 'partNo')::integer;
  END IF;
  IF v_part_no IS NULL OR (v_part = 'later' AND v_part_no NOT BETWEEN 1 AND 36) OR (v_part <> 'later' AND v_part_no <> 0) THEN
    RAISE EXCEPTION 'Say which part of the plan was paid.' USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(p_args -> 'amount') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Type the amount as a number.' USING ERRCODE = '22023'; END IF;
  v_amount := (p_args ->> 'amount')::numeric;
  v_currency := p_args ->> 'currency';
  IF v_currency IS NULL OR v_currency NOT IN ('USD', 'KWD') THEN RAISE EXCEPTION 'Pick dollars or dinars.' USING ERRCODE = '22023'; END IF;
  v_problem := public.cockpit_billing_amount_problem(v_amount, v_currency);
  IF v_problem IS NOT NULL THEN RAISE EXCEPTION '%', v_problem USING ERRCODE = '22023'; END IF;
  v_usd := CASE v_currency WHEN 'USD' THEN v_amount ELSE round(v_amount * 3.26, 2) END;

  v_day := public.cockpit_billing_day(p_args ->> 'paidOn');
  IF v_day IS NULL OR v_day > v_today THEN
    RAISE EXCEPTION 'Pick the day they paid, today or before.' USING ERRCODE = '22023';
  END IF;

  v_evidence := nullif(btrim(coalesce(p_args ->> 'evidenceUrl', '')), '');
  IF v_evidence IS NOT NULL AND (v_evidence !~ '^https://[^[:space:]<>"'']+$' OR length(v_evidence) > 1000) THEN
    RAISE EXCEPTION 'The receipt has to be a link that opens, starting https://.' USING ERRCODE = '22023';
  END IF;
  v_note := public.cockpit_manual_clean_text(p_args ->> 'note', 500);

  -- The deal: the card's newest live deal, or none for a card with no terms on record.
  v_deal_id := nullif(btrim(coalesce(p_args ->> 'dealResponseId', '')), '');
  SELECT dc.deal_response_id INTO v_card_deal FROM public.cockpit_billing_deal_cards() dc WHERE dc.clickup_task_id = v_task;
  IF v_deal_id IS NULL THEN
    IF v_card_deal IS NOT NULL THEN
      RAISE EXCEPTION 'This client has a signed deal on record. Reload the page and confirm against it.' USING ERRCODE = '22023';
    END IF;
    -- "Terms not on record" is a card in onboarding (PLAN 1.2); a card past
    -- onboarding with no deal is only a footnote on the screen.
    IF coalesce(v_acc.stage_group, '') <> 'pipeline' THEN
      RAISE EXCEPTION '% has no signed deal on record and is past onboarding. Link its closer form to the card first (the CEO''s Link to a card), then confirm against it.',
        v_acc.client_name USING ERRCODE = '22023';
    END IF;
    IF v_part <> 'all' THEN
      RAISE EXCEPTION 'With no signed deal on record, confirm what they paid in all.' USING ERRCODE = '22023';
    END IF;
    v_signed := NULL;
  ELSE
    IF v_card_deal IS DISTINCT FROM v_deal_id THEN
      RAISE EXCEPTION 'That signed deal is not this client''s newest deal on record. Reload the page.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_deal FROM public.cockpit_sales_deals d WHERE d.response_id = v_deal_id;
    v_signed := (v_deal.submitted_at AT TIME ZONE 'Asia/Kuwait')::date;
  END IF;

  v_floor := coalesce(v_signed, (SELECT o.signup_on FROM public.cockpit_client_onboarding o WHERE o.clickup_task_id = v_task)) - 7;
  IF v_day < coalesce(v_floor, date '2025-01-01') THEN
    RAISE EXCEPTION 'That day is before they signed. Pick the day they paid.' USING ERRCODE = '22023';
  END IF;

  -- The same confirmation sent twice (a double press) is answered with the first.
  SELECT * INTO v_conf FROM public.cockpit_billing_confirmations c
   WHERE c.clickup_task_id = v_task AND c.deal_response_id IS NOT DISTINCT FROM v_deal_id AND c.part = v_part
     AND c.part_no = v_part_no AND c.rail = v_rail AND c.usd = v_usd AND c.paid_on = v_day
     AND c.confirmed_by = v_who AND c.withdrawn_at IS NULL AND c.confirmed_at > now() - interval '2 minutes'
   ORDER BY c.id DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'repeated', true,
      'sentence', format('Confirmed by you · waiting for %s', v_rail_name),
      'confirmation', jsonb_build_object('id', v_conf.id, 'taskId', v_conf.clickup_task_id, 'dealResponseId', v_conf.deal_response_id,
        'part', v_conf.part, 'partNo', v_conf.part_no, 'amount', v_conf.amount, 'currency', v_conf.currency, 'usd', v_conf.usd,
        'rail', v_conf.rail, 'paidOn', v_conf.paid_on, 'confirmedByCeo', v_conf.confirmed_by_ceo, 'confirmedAt', v_conf.confirmed_at));
  END IF;

  -- The cap: what confirmations still hold, with this one, stays within what
  -- the rails have not shown, plus 1% of the contract.
  IF v_deal_id IS NOT NULL THEN
    SELECT coalesce(sum(r.usd), 0), max(r.recorded_at) INTO v_rails, v_rails_as_of
    FROM public.cockpit_billing_deal_rails(v_deal_id, v_task) r;
    -- What still holds (PLAN 1.2 "reserved") is the live confirmations no
    -- rail payment has proven yet: a proven one's dollars are already inside
    -- the rails, so counting it again would refuse the next part. The deal's
    -- confirmations, and those made on the card before it had a deal (part
    -- 'all'), oldest first. Proof (PLAN 1.2): a payment in the deal's rails on
    -- the rail it named, within 2% of its dollars, dated from 3 days before to
    -- 14 days after its paid-on day, not already proving an older one; the
    -- closest day wins, then the earlier day, then the payment id.
    v_live := 0;
    FOR v_c IN
      SELECT * FROM public.cockpit_billing_confirmations c
       WHERE c.withdrawn_at IS NULL
         AND (c.deal_response_id = v_deal_id OR (c.clickup_task_id = v_task AND c.deal_response_id IS NULL))
       ORDER BY c.confirmed_at, c.id
    LOOP
      SELECT r.payment_id INTO v_pid FROM public.cockpit_billing_deal_rails(v_deal_id, v_task) r
       WHERE lower(r.rail) = v_c.rail AND abs(r.usd - v_c.usd) <= 0.02 * v_c.usd
         AND r.day BETWEEN v_c.paid_on - 3 AND v_c.paid_on + 14
         AND NOT (r.payment_id = ANY (v_used))
       ORDER BY abs(r.day - v_c.paid_on), r.day, r.payment_id
       LIMIT 1;
      IF v_pid IS NULL THEN
        v_live := v_live + v_c.usd;
      ELSE
        v_used := v_used || v_pid;
      END IF;
    END LOOP;
  ELSE
    v_rails := NULL;
    SELECT coalesce(sum(c.usd), 0) INTO v_live FROM public.cockpit_billing_confirmations c
     WHERE c.clickup_task_id = v_task AND c.deal_response_id IS NULL AND c.withdrawn_at IS NULL;
  END IF;
  IF v_deal_id IS NOT NULL AND coalesce(v_deal.contracted_revenue, 0) > 0 THEN
    IF v_live + v_usd > v_deal.contracted_revenue - v_rails + round(0.01 * v_deal.contracted_revenue, 2) THEN
      v_left := greatest(0, round(v_deal.contracted_revenue - v_rails - v_live, 2));
      RAISE EXCEPTION 'That is more than the $% the rails have not shown.%',
        CASE WHEN v_left = trunc(v_left) THEN to_char(v_left, 'FM999,999,990') ELSE to_char(v_left, 'FM999,999,990.00') END,
        CASE WHEN v_live > 0 THEN format(' Confirmations already cover $%s of it.',
          CASE WHEN v_live = trunc(v_live) THEN to_char(v_live, 'FM999,999,990') ELSE to_char(v_live, 'FM999,999,990.00') END) ELSE '' END
        USING ERRCODE = '22023';
    END IF;
  ELSIF v_live + v_usd > 100000 THEN
    -- No contract on the closer form: the only cap is one client's payments.
    RAISE EXCEPTION 'That is too large for one client''s payments; check the amount.' USING ERRCODE = '22023';
  END IF;

  v_id := nextval(pg_catalog.pg_get_serial_sequence('public.cockpit_billing_confirmations', 'id'));
  INSERT INTO public.cockpit_billing_events(clickup_task_id, client_name, kind, from_value, to_value, reason, detail, source, by_whom)
  VALUES (v_task, v_acc.client_name, 'confirm', NULL, trim_scale(v_usd)::text, NULL,
          jsonb_build_object('confirmationId', v_id, 'part', v_part, 'partNo', v_part_no, 'rail', v_rail, 'usd', v_usd,
                             'paidOn', v_day, 'railsUsdAtConfirm', v_rails, 'dealResponseId', v_deal_id),
          v_source, v_who)
  RETURNING id INTO v_event;
  INSERT INTO public.cockpit_billing_confirmations(id, clickup_task_id, deal_response_id, part, part_no, amount, currency, usd, rail,
      paid_on, evidence_url, note, rails_usd_at_confirm, rails_as_of, source, confirmed_by, confirmed_by_ceo, event_id)
  VALUES (v_id, v_task, v_deal_id, v_part, v_part_no, v_amount, v_currency, v_usd, v_rail,
      v_day, v_evidence, v_note, v_rails, v_rails_as_of, v_source, v_who, v_ceo, v_event)
  RETURNING * INTO v_conf;
  INSERT INTO public.cockpit_audit_log(action, entity_type, entity_id, actor_email, source_app, source_system, before, after, metadata)
  VALUES ('billing.confirm', 'cockpit_billing_confirmations', v_conf.id::text, v_who, v_app, 'supabase', NULL, to_jsonb(v_conf),
          jsonb_build_object('event_id', v_event, 'deal_response_id', v_deal_id));

  RETURN jsonb_build_object('ok', true,
    'sentence', format('Confirmed by you · waiting for %s', v_rail_name),
    'confirmation', jsonb_build_object('id', v_conf.id, 'taskId', v_conf.clickup_task_id, 'dealResponseId', v_conf.deal_response_id,
      'part', v_conf.part, 'partNo', v_conf.part_no, 'amount', v_conf.amount, 'currency', v_conf.currency, 'usd', v_conf.usd,
      'rail', v_conf.rail, 'paidOn', v_conf.paid_on, 'evidenceUrl', v_conf.evidence_url, 'note', v_conf.note,
      'railsUsdAtConfirm', v_conf.rails_usd_at_confirm, 'railsAsOf', v_conf.rails_as_of, 'source', v_conf.source,
      'confirmedByCeo', v_conf.confirmed_by_ceo, 'byYou', true, 'confirmedAt', v_conf.confirmed_at));
END $$;
COMMENT ON FUNCTION public.cockpit_billing_balance_write(text, jsonb) IS
  'Pending payments writes (23 Oct 2026): confirm and withdraw (CEO, client success or finance; a success manager only on their portal clients) and link and unlink (CEO only). Each write leaves its row, a cockpit_billing_events row and a cockpit_audit_log row in one transaction. A confirmation is a person''s word, never money: nothing here writes a payment, the inbox, the ledger, LTV, pay or ClickUp.';

REVOKE ALL ON FUNCTION public.cockpit_billing_balance_write(text, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cockpit_billing_balance_write(text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
