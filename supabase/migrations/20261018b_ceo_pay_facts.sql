-- Pay plans: the facts each pay part and commission line reads (contract
-- docs/pay/PAY-PLANS.md sections 4.1-4.4 and 5.2, the CEO 2026-10-18).
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive and safe to run twice:
-- every function is CREATE OR REPLACE and the revokes repeat cleanly. Loads in
-- PGlite: plpgsql bodies are not checked against the tables at creation.
--
-- What it adds (all read-only, all SECURITY DEFINER with search_path '', all
-- revoked from PUBLIC, anon, authenticated and service_role with no grant; the
-- pay month, cockpit_pay_compute in 20261018a, is the only caller):
--   cockpit_pay_facts_calls(from, to)        the call centre: per agent the
--     client meetings due, shows, no-shows, unmarked, confirmed bookings and
--     closed client deals, credited to the agent who booked each meeting
--     (method B, hw-notes/tmp-pay/m_appt_q2.sql), the meetings nobody can be
--     credited with and why, and the official scorecard beside them
--   cockpit_pay_facts_ads(from, to, exclude) per client of the month: spend,
--     lead-campaign spend, Meta form leads, confirmed bookings, cost per lead
--     and per booking, the same counted from creative start + exclude days,
--     and the pooled ratios (hw-notes/tmp-pay/month_final.sql)
--   cockpit_pay_facts_clients(month)          churn of the start set (company
--     and each CSM book), non-payment and long-pause candidates, the
--     qualifying-client upper bound per book and the owned-creative proposal
--     (hw-notes/tmp-pay/cs_streak.sql and roster.sql)
--   cockpit_pay_facts_sales(from, to)         the closer's lines: cash that
--     cleared on each signed deal (cockpit_deal_payments, 20261018c), who
--     closed and who set it, and the paid-in-full bonus state
--
-- Sources, schema-qualified:
--   calls    public.cockpit_people, ghl_clients, client_leads, appointments,
--            ghl_calendars, cockpit_board_calendar_kind(); mahara_reporting.facts
--            and sheet_snapshots; mahara_console.attempts; portal_data.appointments
--            and appointment_outcomes; public.mahara_call_center_report (optional)
--   ads      public.cockpit_csm_sources (rosterDays, clients),
--            cockpit_board_clients, cockpit_meta_ad_days, cockpit_client_days
--   clients  public.cockpit_csm_sources (rosterDays, churnEvents, clients),
--            cockpit_client_billing_days, cockpit_people, cockpit_pay_entries,
--            cockpit_creative_sources (creativeTasks)
--   sales    public.cockpit_deal_payments, cockpit_sales_deals, cockpit_sales_reps,
--            cockpit_sales_people, cockpit_people, cockpit_sales_appointments,
--            cockpit_sales_leads, cockpit_sales_settings, cockpit_sales_rooms,
--            cockpit_pay_confirmations, cockpit_sections (money)
--
-- Missing is never zero: a value that cannot be measured is NULL with a
-- sentence saying why, and a client, meeting or deal left out is named.
-- Days are Kuwait days.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The call centre (section 4.1)
--
-- Each due client meeting (main, online or provisional calendar, its time
-- passed, not cancelled or invalid, not a Google Calendar copy) is credited to
-- the agent who booked it: the dialer's verified BOOKED receipt on the exact
-- appointment id (a reschedule walked back to the booking it replaced), else
-- the caller on the central Appointments sheet, else the caller on the client
-- sheet row at the same contact and meeting time. A booking two agents claim
-- in the dialer, or one by somebody not on cockpit_people, is not credited:
-- it is listed with why. Shows follow the board's rule (CRM status, then the
-- sheet mark, then the portal); an unmarked meeting is neither a show nor a
-- no-show. A close is the client sheet's first closed meeting per contact
-- (no conflict) or a deal the client marked won in the portal, counted once
-- per (location, contact) in the range. Only the meetings are cut to the
-- range: sheet results, the first-close rank, dialer receipts and the central
-- sheet are read over all time.

CREATE OR REPLACE FUNCTION public.cockpit_pay_facts_calls(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_lo timestamptz;
  v_hi timestamptz;
  v_out jsonb;
  v_rep jsonb;
  v_sc jsonb;
  v_sc_to date;
  v_sc_note text;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 92 THEN
    RAISE EXCEPTION 'Choose a range of up to 93 days.' USING ERRCODE = '22023';
  END IF;
  v_lo := p_from::timestamp AT TIME ZONE 'Asia/Kuwait';
  v_hi := (p_to + 1)::timestamp AT TIME ZONE 'Asia/Kuwait';

  WITH RECURSIVE people AS (
    SELECT lower(btrim(p.email)) AS email, min(p.name) AS name,
           CASE WHEN count(*) = 1 THEN min(p.id) END AS person_id
      FROM public.cockpit_people AS p
     WHERE nullif(btrim(p.email), '') IS NOT NULL
     GROUP BY 1
  ), names AS (
    SELECT lower(btrim(name)) AS name, min(email) AS email FROM people GROUP BY 1 HAVING count(*) = 1
  ), ctry AS (
    SELECT g.location_id AS id, g.country, g.client_name FROM public.ghl_clients AS g
  ),
  -- the dialer's cc_leads: phone to contact, unique per location
  leads0 AS (
    SELECT l.location_id, l.ghl_contact_id AS contact_id, l.contact_phone AS ph, c.country, 0 AS pri
      FROM public.client_leads AS l LEFT JOIN ctry AS c ON c.id = l.location_id
     WHERE NOT coalesce(l.deleted, false)
    UNION ALL
    SELECT f.data->>'locationId', f.data->>'id', f.data->>'phone', c.country, 1
      FROM mahara_reporting.facts AS f LEFT JOIN ctry AS c ON c.id = f.data->>'locationId'
     WHERE f.namespace = 'production' AND f.source = 'ghl' AND f.kind = 'contact' AND NOT f.conflict
       AND coalesce(f.data->>'missingFromProvider', 'false') <> 'true'
       AND NOT EXISTS (SELECT 1 FROM public.client_leads AS l
                        WHERE l.location_id = f.data->>'locationId' AND l.ghl_contact_id = f.data->>'id' AND l.deleted)
  ), leads AS (
    SELECT DISTINCT ON (z.location_id, z.contact_id) z.location_id, z.contact_id, z.phone
      FROM (SELECT l.location_id, l.contact_id, l.pri,
                   CASE WHEN a.t ~ '[^0-9+().\s-]' THEN NULL
                        WHEN b.d ~ '^(966|971)\d{9}$|^(965|974|973|968)\d{8}$' THEN b.d
                        WHEN l.country = 'SA' AND b.d ~ '^0?5\d{8}$' THEN '966' || regexp_replace(b.d, '^0', '')
                        WHEN l.country = 'AE' AND b.d ~ '^0?5\d{8}$' THEN '971' || regexp_replace(b.d, '^0', '')
                        WHEN l.country IN ('KW', 'QT', 'BH', 'OM') AND b.d ~ '^\d{8}$'
                          THEN (CASE l.country WHEN 'KW' THEN '965' WHEN 'QT' THEN '974' WHEN 'BH' THEN '973' ELSE '968' END) || b.d
                   END AS phone
              FROM leads0 AS l
              CROSS JOIN LATERAL (SELECT translate(coalesce(l.ph, ''), U&'\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669\06F0\06F1\06F2\06F3\06F4\06F5\06F6\06F7\06F8\06F9', '01234567890123456789') AS t) AS a
              CROSS JOIN LATERAL (SELECT regexp_replace(regexp_replace(a.t, '[^0-9]', '', 'g'), '^00', '') AS d) AS b) AS z
     WHERE z.location_id IS NOT NULL AND z.contact_id IS NOT NULL
     ORDER BY z.location_id, z.contact_id, z.pri
  ), phones AS (
    SELECT location_id, phone, min(contact_id) AS contact_id
      FROM leads WHERE phone IS NOT NULL GROUP BY 1, 2 HAVING count(*) = 1
  ),
  -- the dialer's cc_results: one result per client, phone and meeting time
  raw AS (
    SELECT s.id AS location_id, r.value AS r, c.country,
           coalesce(nullif(r.value->>'currency', ''), s.data->>'currency') AS currency,
           CASE WHEN (r.value->>'meeting') ~ '^\d{12,14}$' THEN to_timestamp((r.value->>'meeting')::numeric / 1000) END AS meeting,
           CASE WHEN (r.value->>'added') ~ '^\d{12,14}$' THEN to_timestamp((r.value->>'added')::numeric / 1000) END AS added,
           translate(coalesce(r.value->>'phone', ''), U&'\0660\0661\0662\0663\0664\0665\0666\0667\0668\0669\06F0\06F1\06F2\06F3\06F4\06F5\06F6\06F7\06F8\06F9', '01234567890123456789') AS t,
           n.email AS agent
      FROM mahara_reporting.sheet_snapshots AS s
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.data->'rows') = 'array' THEN s.data->'rows' ELSE '[]'::jsonb END) AS r(value)
      LEFT JOIN ctry AS c ON c.id = s.id
      LEFT JOIN names AS n ON n.name = lower(btrim(r.value->>'caller'))
     WHERE s.namespace = 'production' AND (s.data->>'sheetId') = s.sheet_id
  ), rws AS (
    SELECT raw.*,
           CASE WHEN raw.t ~ '[^0-9+().\s-]' THEN NULL
                WHEN b.d ~ '^(966|971)\d{9}$|^(965|974|973|968)\d{8}$' THEN b.d
                WHEN raw.country = 'SA' AND b.d ~ '^0?5\d{8}$' THEN '966' || regexp_replace(b.d, '^0', '')
                WHEN raw.country = 'AE' AND b.d ~ '^0?5\d{8}$' THEN '971' || regexp_replace(b.d, '^0', '')
                WHEN raw.country IN ('KW', 'QT', 'BH', 'OM') AND b.d ~ '^\d{8}$'
                  THEN (CASE raw.country WHEN 'KW' THEN '965' WHEN 'QT' THEN '974' WHEN 'BH' THEN '973' ELSE '968' END) || b.d
           END AS phone
      FROM raw CROSS JOIN LATERAL (SELECT regexp_replace(regexp_replace(raw.t, '[^0-9]', '', 'g'), '^00', '') AS d) AS b
  ), grouped AS (
    SELECT location_id, phone, meeting, min(agent) AS agent, min(currency) AS currency,
           min(r->>'show') AS attendance, min(r->>'closed') AS closed, min(r->>'confirmed') AS confirmed,
           -- changed from m_appt_q2: a value that is not a number reads as none instead of failing the run
           min(CASE WHEN btrim(r->>'value') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN btrim(r->>'value')::numeric END) AS value,
           count(DISTINCT jsonb_build_array(r->'show', r->'closed', r->'confirmed', r->'value', currency, agent)) > 1 AS conflict
      FROM rws
     WHERE phone IS NOT NULL AND meeting IS NOT NULL AND meeting <= now() AND coalesce(added <= now(), true)
     GROUP BY 1, 2, 3
  ), res AS (
    SELECT g.*, p.contact_id,
           CASE WHEN g.closed = 'Y' AND NOT g.conflict
                THEN row_number() OVER (PARTITION BY g.location_id, coalesce(p.contact_id, g.phone), g.closed, g.conflict ORDER BY g.meeting) END AS project_rank,
           min(g.value) OVER w IS DISTINCT FROM max(g.value) OVER w
             OR min(g.agent) OVER w IS DISTINCT FROM max(g.agent) OVER w
             OR min(coalesce(g.currency, '')) OVER w IS DISTINCT FROM max(coalesce(g.currency, '')) OVER w AS project_conflict
      FROM grouped AS g LEFT JOIN phones AS p ON p.location_id = g.location_id AND p.phone = g.phone
    WINDOW w AS (PARTITION BY g.location_id, coalesce(p.contact_id, g.phone), g.closed)
  ), rm AS (  -- the sheet mark at the exact contact and time (board 3.4a)
    SELECT location_id, contact_id, meeting, bool_or(attendance = 'Y') AS mark
      FROM res WHERE NOT conflict AND contact_id IS NOT NULL AND attendance IN ('Y', 'N')
     GROUP BY 1, 2, 3 HAVING count(DISTINCT attendance) = 1
  ), rmd AS (  -- else the contact's only sheet row that Kuwait day
    SELECT location_id, contact_id, (meeting AT TIME ZONE 'Asia/Kuwait')::date AS day, bool_or(attendance = 'Y') AS mark
      FROM res WHERE NOT conflict AND contact_id IS NOT NULL
     GROUP BY 1, 2, 3 HAVING count(*) = 1 AND bool_and(coalesce(attendance, '') IN ('Y', 'N'))
  ), outc AS (
    SELECT DISTINCT ON (o.location_id, o.appointment_id) o.location_id, o.appointment_id, o.attendance, o.deal, o.project_value, o.currency
      FROM portal_data.appointment_outcomes AS o
     ORDER BY o.location_id, o.appointment_id, o.revision DESC
  ), ap AS (
    SELECT x.location_id, a.ghl_appointment_id AS id, a.ghl_contact_id AS contact_id, a.booked_at, a.start_at, a.status,
           a.attended, a.ghl_source, public.cockpit_board_calendar_kind(cal.name) AS kind
      FROM public.appointments AS a
      CROSS JOIN LATERAL (SELECT coalesce(nullif(a.ghl_location_id, ''), nullif(a.ghl_location, '')) AS location_id) AS x
      LEFT JOIN LATERAL (SELECT c.name FROM public.ghl_calendars AS c WHERE c.calendar_id = a.calendar_id
                          ORDER BY (c.location_id = x.location_id) DESC, c.synced_at DESC NULLS LAST LIMIT 1) AS cal ON true
     WHERE coalesce(a.ghl_source, '') <> 'google_calendar' AND a.start_at >= v_lo AND a.start_at < v_hi AND a.start_at <= now()
  ), due AS (
    SELECT a.*, (a.start_at AT TIME ZONE 'Asia/Kuwait')::date AS day,
           count(*) OVER (PARTITION BY a.location_id, a.contact_id, (a.start_at AT TIME ZONE 'Asia/Kuwait')::date) AS same_day
      FROM ap AS a
     WHERE a.kind IN ('main', 'online', 'provisional') AND coalesce(a.status, '') NOT IN ('cancelled', 'invalid')
  ), judged AS (
    SELECT d.*,
           CASE WHEN d.status = 'showed' THEN 'showed' WHEN d.status = 'noshow' THEN 'noshow'
                WHEN coalesce(d.attended, sm.mark, sd.mark) IS TRUE OR o.attendance = 'showed' THEN 'showed'
                WHEN coalesce(d.attended, sm.mark, sd.mark) IS FALSE OR o.attendance = 'no_show' THEN 'noshow'
                ELSE 'unknown' END AS att,
           coalesce(o.deal = 'won', false) AS portal_won, o.project_value AS portal_value, o.currency AS portal_currency,
           (SELECT jsonb_build_object('value', r.value, 'currency', r.currency) FROM res AS r
             WHERE r.location_id = d.location_id AND r.contact_id = d.contact_id AND r.meeting = d.start_at
               AND r.closed = 'Y' AND r.project_rank = 1 AND NOT r.project_conflict AND NOT r.conflict
             LIMIT 1) AS sheet_close
      FROM due AS d
      LEFT JOIN outc AS o ON o.location_id = d.location_id AND o.appointment_id = d.id
      LEFT JOIN rm AS sm ON sm.location_id = d.location_id AND sm.contact_id = d.contact_id AND sm.meeting = d.start_at
      LEFT JOIN rmd AS sd ON sm.location_id IS NULL AND d.same_day = 1 AND sd.location_id = d.location_id
                         AND sd.contact_id = d.contact_id AND sd.day = d.day
  ), att AS (
    SELECT a.agent, a.data FROM mahara_console.attempts AS a WHERE a.namespace = 'production'
  ), console AS (
    SELECT a.data->>'locationId' AS location_id, coalesce(a.data->'bookingVerification'->>'id', a.data->>'appointmentId') AS id,
           -- changed from m_appt_q2: a receipt with no agent on it credits nobody (q2 read it as CONFLICT)
           CASE WHEN count(DISTINCT lower(btrim(a.agent))) = 1 THEN min(lower(btrim(a.agent)))
                WHEN count(DISTINCT lower(btrim(a.agent))) > 1 THEN 'CONFLICT' END AS agent
      FROM att AS a
     WHERE a.data->'disposition'->>'outcome' = 'BOOKED' AND a.data->'bookingVerification'->>'verifiedAt' IS NOT NULL
     GROUP BY 1, 2
  ), resched AS (
    SELECT DISTINCT a.data->>'locationId' AS location_id, a.data->>'appointmentId' AS new_id, a.data->>'originalAppointmentId' AS orig_id
      FROM att AS a
     WHERE a.data->'disposition'->>'outcome' = 'RESCHEDULE'
       AND nullif(a.data->>'originalAppointmentId', '') IS NOT NULL AND nullif(a.data->>'appointmentId', '') IS NOT NULL
  ), walk AS (  -- changed from m_appt_q2: a reschedule of a reschedule is walked back too (q2 went one step)
    SELECT r.location_id, r.new_id AS id, r.orig_id AS back_id, 1 AS depth FROM resched AS r
    UNION ALL
    SELECT w.location_id, w.id, r.orig_id, w.depth + 1
      FROM walk AS w JOIN resched AS r ON r.location_id = w.location_id AND r.new_id = w.back_id
     WHERE w.depth < 10
  ), walked AS (
    SELECT z.location_id, z.id, CASE WHEN count(DISTINCT z.agent) = 1 THEN min(z.agent) ELSE 'CONFLICT' END AS agent
      FROM (SELECT w.location_id, w.id, w.depth, c.agent, min(w.depth) OVER (PARTITION BY w.location_id, w.id) AS first_depth
              FROM walk AS w JOIN console AS c ON c.location_id = w.location_id AND c.id = w.back_id
             WHERE c.agent IS NOT NULL) AS z
     WHERE z.depth = z.first_depth
     GROUP BY 1, 2
  ), central AS (
    SELECT DISTINCT ON (p.location_id, p.appointment_id) p.location_id, p.appointment_id AS id, p.assigned_agent, n.email AS agent
      FROM portal_data.appointments AS p LEFT JOIN names AS n ON n.name = lower(btrim(p.assigned_agent))
     WHERE p.source = 'central-appointments'
     ORDER BY p.location_id, p.appointment_id, p.source_updated_at DESC NULLS LAST
  ), base AS (
    SELECT j.*, coalesce(c1.agent, wk.agent) AS console_agent, (c1.agent IS NULL AND wk.agent IS NOT NULL) AS via_reschedule,
           ce.agent AS central_agent, ce.assigned_agent AS central_name,
           (SELECT CASE WHEN count(DISTINCT r.agent) = 1 THEN min(r.agent) END FROM res AS r
             WHERE r.location_id = j.location_id AND r.contact_id = j.contact_id AND r.meeting = j.start_at AND NOT r.conflict) AS sheet_agent
      FROM judged AS j
      LEFT JOIN console AS c1 ON c1.location_id = j.location_id AND c1.id = j.id
      LEFT JOIN walked AS wk ON wk.location_id = j.location_id AND wk.id = j.id
      LEFT JOIN central AS ce ON ce.location_id = j.location_id AND ce.id = j.id
  ), credited AS (
    SELECT b.*, coalesce(b.console_agent, b.central_agent, b.sheet_agent) AS booker,
           CASE WHEN b.console_agent IS NOT NULL THEN 'console' WHEN b.central_agent IS NOT NULL THEN 'central'
                WHEN b.sheet_agent IS NOT NULL THEN 'sheet' END AS how
      FROM base AS b
  ), placed AS (
    SELECT c.*, coalesce(g.client_name, c.location_id) AS client,
           CASE WHEN c.booker = 'CONFLICT' THEN 'Two agents booked it in the dialer.'
                WHEN c.booker IS NOT NULL AND pe.email IS NULL
                  THEN format('Booked in the dialer by %s, who is not on the team list.', c.booker)
                WHEN c.booker IS NULL AND nullif(btrim(c.central_name), '') IS NOT NULL
                  THEN format('The central sheet names %s, who matches nobody (or more than one person) on the team list.', btrim(c.central_name))
                WHEN c.booker IS NULL
                  THEN 'No dialer receipt, no caller on the central sheet and none on the client sheet at this meeting time.'
           END AS why
      FROM credited AS c
      LEFT JOIN people AS pe ON pe.email = c.booker
      LEFT JOIN ctry AS g ON g.id = c.location_id
  ), won_pick AS (  -- one close per (location, contact) in the range; a portal win is the evidence when there is one
    SELECT DISTINCT ON (p.location_id, coalesce(p.contact_id, p.id))
           p.id, p.location_id, p.contact_id, p.client, p.start_at, p.booker, p.why,
           bool_or(p.portal_won) OVER (PARTITION BY p.location_id, coalesce(p.contact_id, p.id)) AS any_portal,
           CASE WHEN p.portal_won THEN p.portal_value ELSE (p.sheet_close->>'value')::numeric END AS value,
           CASE WHEN p.portal_won THEN p.portal_currency ELSE p.sheet_close->>'currency' END AS currency
      FROM placed AS p
     WHERE p.portal_won OR p.sheet_close IS NOT NULL
     ORDER BY p.location_id, coalesce(p.contact_id, p.id), p.portal_won DESC, p.start_at, p.id
  ), rs_ids AS (  -- the call centre's RESCHEDULE and CALLBACK booking ids are never a new booking
    SELECT DISTINCT k.id
      FROM att AS a
      CROSS JOIN LATERAL (VALUES (a.data->'bookingVerification'->>'id'),
        (CASE WHEN a.data->'disposition'->>'outcome' = 'RESCHEDULE' AND nullif(a.data->>'originalAppointmentId', '') IS NOT NULL
              THEN a.data->>'appointmentId' END)) AS k(id)
     WHERE a.data->'disposition'->>'outcome' IN ('RESCHEDULE', 'CALLBACK') AND nullif(k.id, '') IS NOT NULL
  ), bk AS (  -- confirmed bookings by Kuwait booking day (hw-notes/tmp-pay/m_bookings.sql), counted once each
    SELECT x.location_id, a.ghl_appointment_id AS id
      FROM public.appointments AS a
      CROSS JOIN LATERAL (SELECT coalesce(nullif(a.ghl_location_id, ''), nullif(a.ghl_location, '')) AS location_id) AS x
      LEFT JOIN LATERAL (SELECT c.name FROM public.ghl_calendars AS c WHERE c.calendar_id = a.calendar_id
                          ORDER BY (c.location_id = x.location_id) DESC, c.synced_at DESC NULLS LAST LIMIT 1) AS cal ON true
     WHERE coalesce(a.ghl_source, '') <> 'google_calendar' AND coalesce(a.status, '') NOT IN ('cancelled', 'invalid')
       AND a.booked_at >= v_lo AND a.booked_at < v_hi AND a.booked_at <= now()
       AND public.cockpit_board_calendar_kind(cal.name) IN ('main', 'online')
       AND NOT EXISTS (SELECT 1 FROM rs_ids WHERE rs_ids.id = a.ghl_appointment_id)
  ), bk_placed AS (
    SELECT b.id, coalesce(c.agent, ce.agent) AS booker, pe.email AS person_email
      FROM bk AS b
      LEFT JOIN console AS c ON c.location_id = b.location_id AND c.id = b.id
      LEFT JOIN central AS ce ON ce.location_id = b.location_id AND ce.id = b.id
      LEFT JOIN people AS pe ON pe.email = coalesce(c.agent, ce.agent)
  ), per_agent AS (
    SELECT p.booker AS email, count(*) AS due,
           count(*) FILTER (WHERE p.att = 'showed') AS shows,
           count(*) FILTER (WHERE p.att = 'noshow') AS no_shows,
           count(*) FILTER (WHERE p.att = 'unknown') AS unmarked,
           count(*) FILTER (WHERE p.att = 'showed' AND p.how = 'console') AS by_console,
           count(*) FILTER (WHERE p.att = 'showed' AND p.how = 'central') AS by_central,
           count(*) FILTER (WHERE p.att = 'showed' AND p.how = 'sheet') AS by_sheet,
           count(*) FILTER (WHERE p.via_reschedule) AS via_reschedule,
           coalesce(jsonb_agg(p.id ORDER BY p.start_at, p.id) FILTER (WHERE p.att = 'showed'), '[]'::jsonb) AS show_ids
      FROM placed AS p WHERE p.why IS NULL GROUP BY 1
  ), unmarked_by AS (
    SELECT u.email, jsonb_agg(jsonb_build_object('client', u.client, 'count', u.n) ORDER BY u.n DESC, u.client) AS items
      FROM (SELECT p.booker AS email, p.client, count(*) AS n FROM placed AS p
             WHERE p.why IS NULL AND p.att = 'unknown' GROUP BY 1, 2) AS u
     GROUP BY 1
  ), booked AS (
    SELECT b.person_email AS email, count(*) AS n FROM bk_placed AS b WHERE b.person_email IS NOT NULL GROUP BY 1
  ), closes AS (
    SELECT w.booker AS email,
           jsonb_agg(jsonb_build_object('appointmentId', w.id, 'locationId', w.location_id, 'client', w.client,
             'contactId', w.contact_id, 'meetingAt', w.start_at, 'evidence', CASE WHEN w.any_portal THEN 'portal' ELSE 'sheet' END,
             'value', w.value, 'currency', w.currency) ORDER BY w.start_at, w.id) AS items
      FROM won_pick AS w WHERE w.why IS NULL GROUP BY 1
  ), agents AS (
    SELECT e.email FROM per_agent AS e UNION SELECT b.email FROM booked AS b
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'agents', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'email', a.email, 'personId', pe.person_id, 'name', pe.name,
               'due', coalesce(pa.due, 0), 'shows', coalesce(pa.shows, 0), 'noShows', coalesce(pa.no_shows, 0),
               'unmarked', coalesce(pa.unmarked, 0), 'booked', coalesce(bo.n, 0),
               'showsBy', jsonb_build_object('console', coalesce(pa.by_console, 0), 'central', coalesce(pa.by_central, 0),
                                             'sheet', coalesce(pa.by_sheet, 0)),
               'viaReschedule', coalesce(pa.via_reschedule, 0),
               'showIds', coalesce(pa.show_ids, '[]'::jsonb),
               'unmarkedBy', coalesce(ub.items, '[]'::jsonb),
               'closes', coalesce(cl.items, '[]'::jsonb))
             ORDER BY pe.name, a.email)
        FROM agents AS a
        JOIN people AS pe ON pe.email = a.email
        LEFT JOIN per_agent AS pa ON pa.email = a.email
        LEFT JOIN booked AS bo ON bo.email = a.email
        LEFT JOIN unmarked_by AS ub ON ub.email = a.email
        LEFT JOIN closes AS cl ON cl.email = a.email), '[]'::jsonb),
    'unattributed', jsonb_build_object(
      'due', (SELECT count(*) FROM placed AS p WHERE p.why IS NOT NULL),
      'shows', (SELECT count(*) FROM placed AS p WHERE p.why IS NOT NULL AND p.att = 'showed'),
      'closes', (SELECT count(*) FROM won_pick AS w WHERE w.why IS NOT NULL),
      'booked', (SELECT count(*) FROM bk_placed AS b WHERE b.person_email IS NULL),
      'items', coalesce((SELECT jsonb_agg(jsonb_build_object('appointmentId', p.id, 'client', p.client, 'meetingAt', p.start_at,
                                  'attendance', p.att, 'won', (p.portal_won OR p.sheet_close IS NOT NULL), 'source', p.ghl_source, 'why', p.why)
                                ORDER BY p.start_at, p.id)
                           FROM placed AS p WHERE p.why IS NOT NULL), '[]'::jsonb))
  ) INTO v_out;

  -- The official scorecard (mahara_call_center_report, sheet callers only),
  -- shown beside the pay counts and never paid on. It refuses an end date
  -- after today, so the range is cut to today.
  v_sc_to := least(p_to, v_today);
  IF p_from > v_today THEN
    v_sc_note := 'The month has not started.';
  ELSIF to_regprocedure('public.mahara_call_center_report(date,date,text,text)') IS NULL THEN
    v_sc_note := 'The call centre report is not installed here.';
  ELSE
    BEGIN
      EXECUTE 'SELECT public.mahara_call_center_report($1, $2, NULL, NULL)' INTO v_rep USING p_from, v_sc_to;
      v_sc := jsonb_build_object('to', v_sc_to, 'callers', coalesce((
        SELECT jsonb_agg(jsonb_build_object('name', c->>'name', 'email', c->>'email', 'shows', c->'shows', 'closed', c->'closed')
                         ORDER BY c->>'name')
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_rep->'callers') = 'array' THEN v_rep->'callers' ELSE '[]'::jsonb END) AS c),
        '[]'::jsonb));
      v_sc_note := format('Scorecard to %s: the official call centre report counts the client sheet''s caller only; shown beside the pay counts, never paid on.',
                          to_char(v_sc_to, 'FMDD Mon'));
    EXCEPTION WHEN OTHERS THEN
      v_sc := NULL;
      v_sc_note := 'The call centre report could not be read: ' || SQLERRM;
    END;
  END IF;

  RETURN v_out || jsonb_build_object('scorecard', v_sc, 'scorecardNote', v_sc_note);
END;
$$;

COMMENT ON FUNCTION public.cockpit_pay_facts_calls(date, date) IS
  'Pay facts, call centre (PAY-PLANS.md 4.1): client meetings, shows and closes credited per booking agent (method B), unattributed meetings with why, the scorecard beside them. Internal: the pay month calls it.';

-- ---------------------------------------------------------------------------
-- 2. Ads (section 4.2)
--
-- Clients are the cards Active on at least one roster snapshot in the range,
-- joined to cockpit_board_clients by ClickUp id. Spend, lead-campaign spend
-- and Meta form leads come from cockpit_meta_ad_days on the client's ad
-- accounts, to yesterday on each account's clock; confirmed bookings from
-- cockpit_client_days to Kuwait yesterday. Cost per lead is lead-campaign
-- spend / Meta form leads, cost per booking all spend / confirmed bookings,
-- both pooled as ratios of sums. A client whose spend has an unpriced row, or
-- whose bookings are not stored for every day, is left out of that pool and
-- named. `after` counts from the client's creative start (the card's launch
-- date, else its first lead-campaign spend day) plus p_exclude_days.

CREATE OR REPLACE FUNCTION public.cockpit_pay_facts_ads(p_from date, p_to date, p_exclude_days integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_through date;
  v_days integer;
  v_ex integer := coalesce(p_exclude_days, 0);
  v_out jsonb;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 92 THEN
    RAISE EXCEPTION 'Choose a range of up to 93 days.' USING ERRCODE = '22023';
  END IF;
  IF v_ex < 0 OR v_ex > 90 THEN
    RAISE EXCEPTION 'Days left out after a creative starts are 0 to 90.' USING ERRCODE = '22023';
  END IF;
  v_through := least(p_to, v_today - 1);
  v_days := greatest(0, v_through - p_from + 1);

  WITH snap AS (
    SELECT x.d, c.value->>'key' AS k, c.value->>'name' AS n, c.value->>'status' AS st
      FROM public.cockpit_csm_sources AS s
      CROSS JOIN LATERAL (SELECT CASE WHEN s.data->>'day' ~ '^\d{4}-\d{2}-\d{2}$' THEN (s.data->>'day')::date END AS d) AS x
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.data->'clients') = 'array' THEN s.data->'clients' ELSE '[]'::jsonb END) AS c(value)
     WHERE s.table_name = 'rosterDays' AND x.d BETWEEN p_from AND p_to AND nullif(c.value->>'key', '') IS NOT NULL
  ), act AS (
    SELECT k, count(DISTINCT d) FILTER (WHERE st = 'Active') AS active_days, (array_agg(n ORDER BY d DESC))[1] AS roster_name
      FROM snap GROUP BY k HAVING count(*) FILTER (WHERE st = 'Active') > 0
  ), card AS (
    SELECT DISTINCT ON (s.data->>'taskId') s.data->>'taskId' AS k, x.launch
      FROM public.cockpit_csm_sources AS s
      CROSS JOIN LATERAL (SELECT CASE WHEN s.data->>'launchDate' ~ '^\d{4}-\d{2}-\d{2}' THEN left(s.data->>'launchDate', 10)::date END AS launch) AS x
     WHERE s.table_name = 'clients' AND nullif(s.data->>'taskId', '') IS NOT NULL
     ORDER BY s.data->>'taskId', s.source_snapshot_at DESC NULLS LAST
  ), cs AS (
    SELECT a.k, a.active_days, a.roster_name, b.location_id, b.client_name, b.service_mode, b.tiktok,
           coalesce(b.ad_account_ids, '{}'::text[]) AS ad_account_ids, card.launch,
           coalesce(card.launch, (SELECT min(m.day) FROM public.cockpit_meta_ad_days AS m
                                   WHERE m.account_id = ANY (b.ad_account_ids) AND m.spend > 0 AND m.leads IS NOT NULL)) AS creative_start
      FROM act AS a
      LEFT JOIN public.cockpit_board_clients AS b ON b.clickup_id = a.k
      LEFT JOIN card ON card.k = a.k
  ), meta AS (
    SELECT cs.k, cs.location_id, count(*) AS row_count,
           sum(m.spend_usd) AS spend,
           sum(m.spend_usd) FILTER (WHERE m.leads IS NOT NULL) AS lead_spend,
           sum(m.leads) AS leads,
           count(*) FILTER (WHERE m.leads IS NOT NULL) AS lead_rows,
           count(*) FILTER (WHERE m.spend > 0 AND m.spend_usd IS NULL) AS unpriced,
           sum(m.spend_usd) FILTER (WHERE cs.creative_start IS NULL OR m.day >= cs.creative_start + v_ex) AS spend_x,
           sum(m.spend_usd) FILTER (WHERE m.leads IS NOT NULL AND (cs.creative_start IS NULL OR m.day >= cs.creative_start + v_ex)) AS lead_spend_x,
           sum(m.leads) FILTER (WHERE cs.creative_start IS NULL OR m.day >= cs.creative_start + v_ex) AS leads_x
      FROM cs JOIN public.cockpit_meta_ad_days AS m ON m.account_id = ANY (cs.ad_account_ids)
     WHERE m.day BETWEEN p_from AND p_to
       AND m.day < (now() AT TIME ZONE coalesce(m.account_timezone, 'Asia/Kuwait'))::date
     GROUP BY cs.k, cs.location_id
  ), biz AS (
    SELECT cs.k, cs.location_id, sum(d.confirmed_bookings) AS bookings, count(d.confirmed_bookings) AS stored_days,
           sum(d.confirmed_bookings) FILTER (WHERE cs.creative_start IS NULL OR d.day >= cs.creative_start + v_ex) AS bookings_x
      FROM cs JOIN public.cockpit_client_days AS d ON d.location_id = cs.location_id
     WHERE d.day BETWEEN p_from AND v_through
     GROUP BY cs.k, cs.location_id
  ), rowsj AS (
    SELECT cs.*, m.row_count, m.spend, m.lead_spend, m.leads, m.lead_rows, coalesce(m.unpriced, 0) AS unpriced,
           m.spend_x, m.lead_spend_x, m.leads_x, b.bookings, b.bookings_x,
           greatest(v_days - coalesce(b.stored_days, 0), 0) AS null_days,
           CASE
             WHEN cs.location_id IS NULL THEN 'No board row for this card.'
             WHEN v_days = 0 THEN 'No finished day in this range yet.'
             WHEN cardinality(cs.ad_account_ids) = 0 THEN 'No ad account is linked to this client.'
             WHEN coalesce(m.unpriced, 0) > 0 THEN format('%s spend rows have no USD price.', m.unpriced)
             WHEN coalesce(m.lead_rows, 0) = 0 THEN 'No lead-form campaign ran in this range.'
           END AS out_cpl,
           CASE
             WHEN cs.location_id IS NULL THEN 'No board row for this card.'
             WHEN upper(coalesce(cs.service_mode, '')) = 'DWY' THEN 'Done with you: the client books its own meetings.'
             WHEN v_days = 0 THEN 'No finished day in this range yet.'
             WHEN cardinality(cs.ad_account_ids) = 0 THEN 'No ad account is linked to this client.'
             WHEN coalesce(m.unpriced, 0) > 0 THEN format('%s spend rows have no USD price.', m.unpriced)
             WHEN coalesce(m.row_count, 0) = 0 THEN 'No Meta spend was recorded in this range.'
             WHEN v_days - coalesce(b.stored_days, 0) > 0
               THEN format('Bookings are not stored for %s of the %s days.', v_days - coalesce(b.stored_days, 0), v_days)
           END AS out_cpb,
           -- spend is measured: a linked account with rows and no unpriced row
           (cs.location_id IS NOT NULL AND v_days > 0 AND cardinality(cs.ad_account_ids) > 0
             AND coalesce(m.row_count, 0) > 0 AND coalesce(m.unpriced, 0) = 0) AS spend_measured
      FROM cs
      LEFT JOIN meta AS m ON m.k = cs.k AND m.location_id IS NOT DISTINCT FROM cs.location_id
      LEFT JOIN biz AS b ON b.k = cs.k AND b.location_id IS NOT DISTINCT FROM cs.location_id
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to, 'adThrough', CASE WHEN v_days > 0 THEN v_through END, 'excludeDays', v_ex,
    'clients', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'clickupId', r.k, 'locationId', r.location_id, 'name', coalesce(r.client_name, r.roster_name, r.k),
               'serviceMode', r.service_mode, 'tiktok', r.tiktok, 'activeDays', r.active_days,
               'launchDate', r.launch, 'creativeStart', r.creative_start,
               'spendUsd', round(r.spend, 2), 'leadSpendUsd', round(r.lead_spend, 2),
               'nonLeadSpendUsd', round(r.spend - coalesce(r.lead_spend, 0), 2),
               'leads', r.leads, 'bookings', r.bookings,
               'cpl', CASE WHEN r.out_cpl IS NULL AND r.leads > 0 THEN round(r.lead_spend / r.leads, 2) END,
               'cpb', CASE WHEN r.out_cpb IS NULL AND r.bookings > 0 THEN round(r.spend / r.bookings, 2) END,
               'unpricedRows', r.unpriced, 'nullBookingDays', CASE WHEN r.location_id IS NOT NULL THEN r.null_days END,
               'after', jsonb_build_object('from', CASE WHEN r.creative_start IS NOT NULL THEN r.creative_start + v_ex END,
                                           'spendUsd', round(r.spend_x, 2), 'leadSpendUsd', round(r.lead_spend_x, 2),
                                           'leads', r.leads_x, 'bookings', r.bookings_x),
               'notMeasured', jsonb_build_object('cpl', r.out_cpl, 'cpb', r.out_cpb))
             ORDER BY r.spend DESC NULLS LAST, coalesce(r.client_name, r.roster_name, r.k))
        FROM rowsj AS r), '[]'::jsonb),
    'pooled', (
      SELECT jsonb_build_object(
               'clients', count(*) FILTER (WHERE r.out_cpl IS NULL),
               'leadSpendUsd', round(sum(r.lead_spend) FILTER (WHERE r.out_cpl IS NULL), 2),
               'leads', sum(r.leads) FILTER (WHERE r.out_cpl IS NULL),
               'cpl', CASE WHEN sum(r.leads) FILTER (WHERE r.out_cpl IS NULL) > 0
                           THEN round(sum(r.lead_spend) FILTER (WHERE r.out_cpl IS NULL) / sum(r.leads) FILTER (WHERE r.out_cpl IS NULL), 2) END,
               'nonLeadSpendUsd', round(sum(r.spend - coalesce(r.lead_spend, 0)) FILTER (WHERE r.spend_measured), 2),
               'spendUsd', round(sum(r.spend) FILTER (WHERE r.out_cpb IS NULL), 2),
               'bookings', sum(r.bookings) FILTER (WHERE r.out_cpb IS NULL),
               'cpb', CASE WHEN sum(r.bookings) FILTER (WHERE r.out_cpb IS NULL) > 0
                           THEN round(sum(r.spend) FILTER (WHERE r.out_cpb IS NULL) / sum(r.bookings) FILTER (WHERE r.out_cpb IS NULL), 2) END,
               'cpbClients', count(*) FILTER (WHERE r.out_cpb IS NULL),
               'outOfCpl', coalesce(jsonb_agg(jsonb_build_object('clickupId', r.k, 'name', coalesce(r.client_name, r.roster_name, r.k), 'why', r.out_cpl)
                                              ORDER BY coalesce(r.client_name, r.roster_name, r.k)) FILTER (WHERE r.out_cpl IS NOT NULL), '[]'::jsonb),
               'outOfCpb', coalesce(jsonb_agg(jsonb_build_object('clickupId', r.k, 'name', coalesce(r.client_name, r.roster_name, r.k), 'why', r.out_cpb)
                                              ORDER BY coalesce(r.client_name, r.roster_name, r.k)) FILTER (WHERE r.out_cpb IS NOT NULL), '[]'::jsonb))
        FROM rowsj AS r),
    'note', to_jsonb(array_remove(ARRAY[
      'Clients: the cards Active on at least one roster snapshot in the range.',
      'Spend and Meta form leads to yesterday on each ad account''s clock; confirmed main and online bookings to Kuwait yesterday.',
      'Cost per lead is lead-campaign spend / Meta form leads; cost per booking is all spend / confirmed bookings; both pooled as ratios of sums.',
      'Non-lead spend is pooled over every client whose spend is measured.',
      'A client left out of a pool is named with why, never counted as 0.',
      CASE WHEN EXISTS (SELECT 1 FROM rowsj AS r WHERE r.tiktok) THEN 'TikTok spend is not counted: figures are Meta only.' END,
      CASE WHEN v_ex > 0 THEN format('"after" counts from each client''s creative start (the card''s launch date, else its first lead-campaign spend day) plus %s days.', v_ex) END], NULL))
  ) INTO v_out;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.cockpit_pay_facts_ads(date, date, integer) IS
  'Pay facts, ads (PAY-PLANS.md 4.2): per client spend, lead spend, Meta leads, confirmed bookings, CPL and CPB, the same after creative start + exclude days, and the pooled ratios. Internal: the pay month calls it.';

-- ---------------------------------------------------------------------------
-- 3. Clients (section 4.3)
--
-- The start set is the cards Active or Paused on the last roster snapshot
-- before the month (else the month's first snapshot, said so), for the
-- company and for every CSM book alike. A loss counts in the % only when the
-- card is in the start set. Candidates are start-set cards more than 14 days
-- past their next payment date on a billing day in the month, or Paused for
-- more than 14 days; the proposal counts them and the CEO unticks. Day of term
-- runs from the later of the card's launch date and its latest renewal entry.
-- A book is today's CSM field on the card, matched to cockpit_people by name.

CREATE OR REPLACE FUNCTION public.cockpit_pay_facts_clients(p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_end date;
  v_first date;
  v_last date;
  v_start_from date;
  v_start_note text;
  v_q_to date;
  v_q_from date;
  v_out jsonb;
BEGIN
  IF p_month IS NULL OR extract(day FROM p_month) <> 1 THEN
    RAISE EXCEPTION 'Choose a month by its first day.' USING ERRCODE = '22023';
  END IF;
  v_end := (p_month + interval '1 month')::date - 1;
  v_q_to := least(v_end, v_today);
  v_q_from := v_q_to - 29;

  SELECT min(z.d) FILTER (WHERE z.d BETWEEN p_month AND v_end), max(z.d) FILTER (WHERE z.d BETWEEN p_month AND v_end),
         max(z.d) FILTER (WHERE z.d < p_month)
    INTO v_first, v_last, v_start_from
    FROM (SELECT CASE WHEN s.data->>'day' ~ '^\d{4}-\d{2}-\d{2}$' THEN (s.data->>'day')::date END AS d
            FROM public.cockpit_csm_sources AS s WHERE s.table_name = 'rosterDays') AS z;
  IF v_start_from IS NULL THEN
    v_start_from := v_first;
    v_start_note := CASE WHEN v_first IS NULL THEN 'No roster snapshot in or before this month: there is no start count.'
                         ELSE format('No roster snapshot before %s: the start count is the month''s first snapshot, %s.',
                                     to_char(p_month, 'FMDD Mon YYYY'), to_char(v_first, 'FMDD Mon')) END;
  END IF;

  WITH snap AS (
    SELECT DISTINCT ON (x.d, c.value->>'key') x.d, c.value->>'key' AS k, c.value->>'name' AS n, c.value->>'status' AS st
      FROM public.cockpit_csm_sources AS s
      CROSS JOIN LATERAL (SELECT CASE WHEN s.data->>'day' ~ '^\d{4}-\d{2}-\d{2}$' THEN (s.data->>'day')::date END AS d) AS x
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.data->'clients') = 'array' THEN s.data->'clients' ELSE '[]'::jsonb END) AS c(value)
     WHERE s.table_name = 'rosterDays' AND x.d <= v_end AND nullif(c.value->>'key', '') IS NOT NULL
     ORDER BY x.d, c.value->>'key', s.source_snapshot_at DESC NULLS LAST
  ), card AS (
    SELECT DISTINCT ON (s.data->>'taskId') s.data->>'taskId' AS k, nullif(btrim(s.data->>'name'), '') AS name,
           nullif(btrim(s.data->>'csmAssigned'), '') AS csm, x.launch
      FROM public.cockpit_csm_sources AS s
      CROSS JOIN LATERAL (SELECT CASE WHEN s.data->>'launchDate' ~ '^\d{4}-\d{2}-\d{2}' THEN left(s.data->>'launchDate', 10)::date END AS launch) AS x
     WHERE s.table_name = 'clients' AND nullif(s.data->>'taskId', '') IS NOT NULL
     ORDER BY s.data->>'taskId', s.source_snapshot_at DESC NULLS LAST
  ), cname AS (
    SELECT k, (array_agg(n ORDER BY d DESC))[1] AS n FROM snap WHERE nullif(btrim(n), '') IS NOT NULL GROUP BY k
  ), start_set AS (
    SELECT s.k, s.st AS start_status FROM snap AS s WHERE s.d = v_start_from AND s.st IN ('Active', 'Paused')
  ), lost_ev AS (
    SELECT DISTINCT ON (e.data->>'key') e.data->>'key' AS k, x.d AS day, e.data->>'from' AS from_status, e.data->>'to' AS to_status
      FROM public.cockpit_csm_sources AS e
      CROSS JOIN LATERAL (SELECT CASE WHEN e.data->>'day' ~ '^\d{4}-\d{2}-\d{2}$' THEN (e.data->>'day')::date END AS d) AS x
     WHERE e.table_name = 'churnEvents' AND e.data->>'kind' = 'lost' AND x.d BETWEEN p_month AND v_end
       AND nullif(e.data->>'key', '') IS NOT NULL
     ORDER BY e.data->>'key', x.d
  ), bill AS (
    SELECT b.clickup_task_id AS k, b.day, b.next_payment_date, b.paused_on
      FROM public.cockpit_client_billing_days AS b WHERE b.day <= v_end
  ), nonpay AS (
    SELECT DISTINCT ON (b.k) b.k, b.day, b.next_payment_date
      FROM bill AS b JOIN start_set AS s ON s.k = b.k
     WHERE b.day BETWEEN p_month AND v_end AND b.next_payment_date IS NOT NULL AND b.day - b.next_payment_date > 14
     ORDER BY b.k, b.day
  ), streak AS (  -- runs of one status per card over the snapshots; prev_run is the snapshot ahead of the run
    SELECT z.k, z.d, z.st, first_value(z.d) OVER w AS since, first_value(z.prev_d) OVER w AS prev_run
      FROM (SELECT s.k, s.d, s.st, lag(s.d) OVER (PARTITION BY s.k ORDER BY s.d) AS prev_d,
                   row_number() OVER (PARTITION BY s.k ORDER BY s.d) - row_number() OVER (PARTITION BY s.k, s.st ORDER BY s.d) AS grp
              FROM snap AS s) AS z
    WINDOW w AS (PARTITION BY z.k, z.st, z.grp ORDER BY z.d)
  ), paused AS (
    SELECT DISTINCT ON (q.k) q.k, q.d AS day, q.since
      FROM (SELECT t.k, t.d,
                   -- the card's own pause date counts when it falls inside the run's unseen start
                   CASE WHEN b.paused_on IS NOT NULL AND b.paused_on < t.since AND (t.prev_run IS NULL OR b.paused_on > t.prev_run)
                        THEN b.paused_on ELSE t.since END AS since
              FROM streak AS t JOIN start_set AS s ON s.k = t.k
              LEFT JOIN bill AS b ON b.k = t.k AND b.day = t.d
             WHERE t.st = 'Paused' AND t.d BETWEEN p_month AND v_end) AS q
     WHERE q.d - q.since > 14
     ORDER BY q.k, q.d
  ), cand AS (  -- one candidate per card: its first day over 14, a real loss in the month wins
    SELECT DISTINCT ON (c.k) c.kind, c.k, c.day, c.why
      FROM (SELECT 'non_payment' AS kind, n.k, n.day,
                   format('Non-payment over 14 days: the payment due %s was %s days late on %s.',
                          to_char(n.next_payment_date, 'FMDD Mon'), n.day - n.next_payment_date, to_char(n.day, 'FMDD Mon')) AS why
              FROM nonpay AS n
            UNION ALL
            SELECT 'paused', p.k, p.day,
                   format('Paused over 14 days: paused since %s, %s days on %s.', to_char(p.since, 'FMDD Mon'), p.day - p.since, to_char(p.day, 'FMDD Mon'))
              FROM paused AS p) AS c
     WHERE NOT EXISTS (SELECT 1 FROM lost_ev AS l WHERE l.k = c.k)
     ORDER BY c.k, c.day, c.kind
  ), items AS (
    SELECT 'lost' AS kind, l.k, l.day,
           format('Lost: %s to %s on %s.', coalesce(l.from_status, 'unknown'), coalesce(l.to_status, 'unknown'), to_char(l.day, 'FMDD Mon')) AS why
      FROM lost_ev AS l
    UNION ALL
    SELECT c.kind, c.k, c.day, c.why FROM cand AS c
  ), enriched AS (
    SELECT i.kind, i.k, i.day, i.why, s.start_status, (s.k IS NOT NULL) AS in_start,
           coalesce(cn.n, cd.name, i.k) AS name, cd.csm, t.term_start,
           i.day - t.term_start AS day_of_term,
           CASE WHEN t.term_start IS NOT NULL THEN i.day - t.term_start < 90 END AS mid,
           (SELECT b.churn_type FROM public.cockpit_client_billing_days AS b
             WHERE b.clickup_task_id = i.k ORDER BY b.day DESC LIMIT 1) AS churn_type
      FROM items AS i
      LEFT JOIN start_set AS s ON s.k = i.k
      LEFT JOIN cname AS cn ON cn.k = i.k
      LEFT JOIN card AS cd ON cd.k = i.k
      CROSS JOIN LATERAL (
        -- a renewal is an entry on a part that is a renewal event in the person's plan for that month, whatever its key;
        -- a clawback (a count of 0 or less) starts no term
        SELECT greatest(cd.launch, (
                 SELECT max(e.cleared_on) FROM public.cockpit_pay_entries AS e
                  WHERE e.voided_at IS NULL AND e.cleared_on IS NOT NULL AND e.cleared_on <= i.day AND coalesce(e.quantity, 0) > 0
                    AND (btrim(e.client) = i.k OR lower(btrim(e.client)) IN (lower(btrim(cn.n)), lower(btrim(cd.name))))
                    AND e.part_key IN (SELECT y->>'key'
                                         FROM jsonb_array_elements(coalesce(public.cockpit_pay_plan_for(e.person_id, e.month)->'plan'->'parts', '[]'::jsonb)) AS y
                                        WHERE y->>'event' = 'renewal'))) AS term_start
      ) AS t
  ), item_json AS (
    SELECT e.*, jsonb_build_object('clickupId', e.k, 'name', e.name, 'day', e.day, 'kind', e.kind, 'startStatus', e.start_status,
             'termStart', e.term_start, 'dayOfTerm', e.day_of_term, 'midProgramme', e.mid,
             'cardChurnType', e.churn_type, 'csm', e.csm, 'why', e.why) AS j
      FROM enriched AS e
  ), pmatch AS (
    SELECT lower(btrim(p.name)) AS nm, CASE WHEN count(*) = 1 THEN min(p.id) END AS person_id, min(p.name) AS pname
      FROM public.cockpit_people AS p WHERE nullif(btrim(p.name), '') IS NOT NULL GROUP BY 1
  ), keys AS (  -- every card the month speaks of, with its book
    SELECT u.k, coalesce(cn.n, cd.name, u.k) AS name, cd.csm, pm.person_id,
           CASE WHEN pm.person_id IS NOT NULL THEN 'p:' || pm.person_id ELSE 'x:' || coalesce(lower(cd.csm), '') END AS book
      FROM (SELECT k FROM start_set UNION SELECT k FROM items UNION SELECT k FROM card) AS u
      LEFT JOIN cname AS cn ON cn.k = u.k
      LEFT JOIN card AS cd ON cd.k = u.k
      LEFT JOIN pmatch AS pm ON pm.nm = lower(cd.csm) AND pm.person_id IS NOT NULL
  ), qwin AS (
    SELECT DISTINCT s.d FROM snap AS s WHERE s.d BETWEEN v_q_from AND v_q_to
  ), qcard AS (  -- Active on every snapshot of the last 30 days
    SELECT kk.k FROM keys AS kk
     WHERE EXISTS (SELECT 1 FROM qwin)
       AND NOT EXISTS (SELECT 1 FROM qwin AS w
                        WHERE NOT EXISTS (SELECT 1 FROM snap AS s WHERE s.k = kk.k AND s.d = w.d AND s.st = 'Active'))
  ), qpay AS (
    SELECT q.k, (b.k IS NOT NULL AND b.next_payment_date IS NOT NULL) AS checked,
           coalesce(b.next_payment_date < v_q_to, false) AS overdue
      FROM qcard AS q LEFT JOIN bill AS b ON b.k = q.k AND b.day = v_q_to
  ), books AS (
    SELECT DISTINCT kk.book, kk.person_id, CASE WHEN kk.person_id IS NOT NULL THEN pm.pname ELSE kk.csm END AS name
      FROM keys AS kk
      LEFT JOIN pmatch AS pm ON pm.person_id = kk.person_id
     WHERE kk.k IN (SELECT k FROM start_set UNION SELECT k FROM items UNION SELECT k FROM qcard)
  ), creative_tasks AS (
    SELECT t.data
      FROM public.cockpit_creative_sources AS t
      CROSS JOIN LATERAL (SELECT CASE WHEN t.data->>'createdAt' ~ '^\d+(\.\d+)?$'
                                      THEN to_timestamp((t.data->>'createdAt')::numeric / 1000) END AS created) AS x
     WHERE t.table_name = 'creativeTasks' AND t.data->>'kind' = 'script' AND coalesce(t.data->>'status', '') <> 'cancelled'
       AND (x.created IS NULL OR x.created < (v_end + 1)::timestamp AT TIME ZONE 'Asia/Kuwait')
  ), assignees AS (
    SELECT DISTINCT btrim(a.x) AS assignee
      FROM creative_tasks AS t
      CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(t.data->'assignees') = 'array' THEN t.data->'assignees' ELSE '[]'::jsonb END) AS a(x)
     WHERE nullif(btrim(a.x), '') IS NOT NULL
  ), amatch AS (  -- the full name, else a one-word ClickUp name that is a word of exactly one person's name
    SELECT a.assignee,
           coalesce((SELECT CASE WHEN count(*) = 1 THEN min(p.id) END FROM public.cockpit_people AS p
                      WHERE lower(btrim(p.name)) = lower(a.assignee)),
                    (SELECT CASE WHEN count(*) = 1 THEN min(p.id) END FROM public.cockpit_people AS p
                      WHERE a.assignee !~ '\s' AND lower(a.assignee) = ANY (regexp_split_to_array(lower(btrim(p.name)), '\s+')))) AS person_id
      FROM assignees AS a
  ), knames AS (
    SELECT DISTINCT k, lower(btrim(n)) AS nm FROM snap WHERE nullif(btrim(n), '') IS NOT NULL
    UNION SELECT k, lower(name) FROM card WHERE name IS NOT NULL
  ), task_client AS (
    SELECT DISTINCT am.person_id, kn.k
      FROM creative_tasks AS t
      CROSS JOIN LATERAL (SELECT btrim(x) AS cn FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(t.data->'clients') = 'array' THEN t.data->'clients' ELSE '[]'::jsonb END) AS x
                          UNION SELECT btrim(t.data->>'client')) AS c
      CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(t.data->'assignees') = 'array' THEN t.data->'assignees' ELSE '[]'::jsonb END) AS a(x)
      JOIN amatch AS am ON am.assignee = btrim(a.x) AND am.person_id IS NOT NULL
      JOIN knames AS kn ON kn.nm = lower(c.cn)
  ), active_month AS (
    SELECT s.k, (array_agg(s.n ORDER BY s.d DESC))[1] AS n
      FROM snap AS s WHERE s.d BETWEEN p_month AND v_end AND s.st = 'Active' GROUP BY s.k
  ), creators AS (  -- whoever wrote a script for a client of the month, and every creative strategist
    SELECT tc.person_id FROM task_client AS tc JOIN active_month AS a ON a.k = tc.k
    UNION SELECT p.id FROM public.cockpit_people AS p WHERE lower(btrim(coalesce(p.role, ''))) = 'creative strategist'
  )
  SELECT jsonb_build_object(
    'month', p_month,
    'snapshots', jsonb_build_object('first', v_first, 'last', v_last, 'startFrom', v_start_from),
    'logo', jsonb_build_object(
      'startSet', coalesce((SELECT jsonb_agg(jsonb_build_object('clickupId', s.k, 'name', kk.name, 'status', s.start_status, 'csm', kk.csm)
                                             ORDER BY kk.name) FROM start_set AS s JOIN keys AS kk ON kk.k = s.k), '[]'::jsonb),
      'lost', coalesce((SELECT jsonb_agg(j ORDER BY day, name) FROM item_json WHERE kind = 'lost' AND in_start), '[]'::jsonb),
      'candidates', coalesce((SELECT jsonb_agg(j ORDER BY day, name) FROM item_json WHERE kind <> 'lost'), '[]'::jsonb),
      'notInStart', coalesce((SELECT jsonb_agg(j ORDER BY day, name) FROM item_json WHERE kind = 'lost' AND NOT in_start), '[]'::jsonb),
      'proposal', (SELECT jsonb_build_object(
                     'lost', count(*) FILTER (WHERE i.in_start),
                     'activeAtStart', (SELECT count(*) FROM start_set),
                     'pct', CASE WHEN (SELECT count(*) FROM start_set) > 0
                                 THEN round(100.0 * count(*) FILTER (WHERE i.in_start) / (SELECT count(*) FROM start_set), 2) END,
                     'clients', coalesce(jsonb_agg(i.k ORDER BY i.k) FILTER (WHERE i.in_start), '[]'::jsonb))
                     FROM item_json AS i)),
    'byCsm', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'personId', bk.person_id, 'name', bk.name,
               'startSet', coalesce((SELECT jsonb_agg(jsonb_build_object('clickupId', s.k, 'name', kk.name, 'status', s.start_status) ORDER BY kk.name)
                                       FROM start_set AS s JOIN keys AS kk ON kk.k = s.k WHERE kk.book = bk.book), '[]'::jsonb),
               'lost', coalesce((SELECT jsonb_agg(i.j ORDER BY i.day, i.name) FROM item_json AS i JOIN keys AS kk ON kk.k = i.k
                                  WHERE kk.book = bk.book AND i.kind = 'lost' AND i.in_start), '[]'::jsonb),
               'candidates', coalesce((SELECT jsonb_agg(i.j ORDER BY i.day, i.name) FROM item_json AS i JOIN keys AS kk ON kk.k = i.k
                                        WHERE kk.book = bk.book AND i.kind <> 'lost'), '[]'::jsonb),
               'proposal', (SELECT jsonb_build_object(
                              'lost', count(i.k),
                              'activeAtStart', st.n,
                              'pct', CASE WHEN st.n > 0 THEN round(100.0 * count(i.k) / st.n, 2) END,
                              'clients', coalesce(jsonb_agg(i.k ORDER BY i.k) FILTER (WHERE i.k IS NOT NULL), '[]'::jsonb))
                              FROM (SELECT count(*) AS n FROM start_set AS s JOIN keys AS kk ON kk.k = s.k WHERE kk.book = bk.book) AS st
                              LEFT JOIN (item_json AS i JOIN keys AS kk ON kk.k = i.k)
                                ON kk.book = bk.book AND i.in_start AND i.mid IS DISTINCT FROM false
                             GROUP BY st.n),
               'qualifying', jsonb_build_object(
                 'upperBound', (SELECT count(*) FROM qpay AS q JOIN keys AS kk ON kk.k = q.k WHERE kk.book = bk.book AND NOT q.overdue),
                 'clients', coalesce((SELECT jsonb_agg(jsonb_build_object('clickupId', q.k, 'name', kk.name, 'paymentChecked', q.checked) ORDER BY kk.name)
                                        FROM qpay AS q JOIN keys AS kk ON kk.k = q.k WHERE kk.book = bk.book AND NOT q.overdue), '[]'::jsonb),
                 'paymentNotChecked', (SELECT count(*) FROM qpay AS q JOIN keys AS kk ON kk.k = q.k
                                        WHERE kk.book = bk.book AND NOT q.overdue AND NOT q.checked),
                 'checkedFrom', (SELECT min(d) FROM qwin), 'checkedTo', v_q_to,
                 'paymentCheckedOn', CASE WHEN EXISTS (SELECT 1 FROM bill AS b WHERE b.day = v_q_to) THEN v_q_to END))
             ORDER BY bk.person_id IS NULL, bk.name NULLS LAST)
        FROM books AS bk), '[]'::jsonb),
    'ownedCreative', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'personId', p.id, 'name', p.name,
               'clients', coalesce((SELECT jsonb_agg(jsonb_build_object('clickupId', a.k, 'name', a.n) ORDER BY a.n)
                                      FROM active_month AS a WHERE EXISTS (SELECT 1 FROM task_client AS tc WHERE tc.person_id = p.id AND tc.k = a.k)), '[]'::jsonb),
               'others', coalesce((SELECT jsonb_agg(jsonb_build_object('clickupId', a.k, 'name', a.n, 'why', 'No script task on record.') ORDER BY a.n)
                                     FROM active_month AS a WHERE NOT EXISTS (SELECT 1 FROM task_client AS tc WHERE tc.person_id = p.id AND tc.k = a.k)), '[]'::jsonb))
             ORDER BY p.name)
        FROM public.cockpit_people AS p WHERE p.id IN (SELECT person_id FROM creators)), '[]'::jsonb),
    'note', to_jsonb(array_remove(ARRAY[
      v_start_note,
      'The start set is the cards Active or Paused on the start snapshot; a loss counts in the % only when the card is in it.',
      'Candidates (more than 14 days past the next payment date, or Paused more than 14 days) are counted in the proposal for you to untick.',
      'Day of term runs from the later of the card''s launch date and its latest renewal entry; mid-programme is before day 90, unknown without a launch date.',
      'A CSM book is today''s CSM field on each card: nothing records who the CSM was earlier. The CSM proposal counts mid-programme losses and unknowns.',
      format('Qualifying clients: Active on every roster snapshot from %s to %s, minus cards past their next payment date on the billing row of %s; a card with no billing row stays in, counted as payment not checked.',
             to_char(v_q_from, 'FMDD Mon'), to_char(v_q_to, 'FMDD Mon'), to_char(v_q_to, 'FMDD Mon')),
      (SELECT 'Script task names that match nobody on the team list: ' || string_agg(a.assignee, ', ' ORDER BY a.assignee) || '.'
         FROM amatch AS a WHERE a.person_id IS NULL)], NULL))
  ) INTO v_out;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.cockpit_pay_facts_clients(date) IS
  'Pay facts, clients (PAY-PLANS.md 4.3): start set, losses and candidates for logo churn and each CSM book, the qualifying upper bound, the owned-creative proposal. Internal: the pay month calls it.';

-- ---------------------------------------------------------------------------
-- 4. Sales (section 4.4)
--
-- Cash is cockpit_deal_payments (active rows, written by the money refresh:
-- front-end money tied to a signed deal, up to its contract within 120 days)
-- by the Kuwait day it cleared. ledgerReady says whether the Money section
-- carries its own count of that ledger (attribution.dealLedger): until it
-- does, pay reads no deal cash at all. A name keys to a person through
-- cockpit_sales_reps (closer_aliases and display_name, lower(btrim), one rep),
-- the rep's sales seat email and cockpit_people (one person, active or not).
-- Who set a deal: the CEO's confirmation setter:<responseId>, else the form's
-- setter and the latest intro before signing (on the deal's contact, else on
-- the one lead with the deal's phone8) when they agree or only one exists;
-- when they disagree it waits, and a deal with neither waits on its closer.
-- Paid in full: the deal's cash reaches 99% of its contract within 45 days of
-- signing, in the month of that payment; 90-99% waits for pif:<responseId>.

CREATE OR REPLACE FUNCTION public.cockpit_pay_facts_sales(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Kuwait')::date;
  v_through timestamptz;
  v_ledger boolean;
  v_orphans integer;
  v_out jsonb;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 92 THEN
    RAISE EXCEPTION 'Choose a range of up to 93 days.' USING ERRCODE = '22023';
  END IF;

  SELECT coalesce((SELECT s.computed_at FROM public.cockpit_sections AS s WHERE s.key = 'money'),
                  (SELECT max(p.recorded_at) FROM public.cockpit_deal_payments AS p))
    INTO v_through;
  -- The ledger is written once the Money section carries its own count of it (attribution.dealLedger, growth.js
  -- readDealLedger's rule): a section published before the ledger existed knows no deal cash, so pay reads it as missing.
  SELECT coalesce((SELECT jsonb_typeof(s.payload->'attribution'->'dealLedger'->'from') = 'string'
                     FROM public.cockpit_sections AS s WHERE s.key = 'money'), false)
    INTO v_ledger;
  SELECT count(*) INTO v_orphans
    FROM public.cockpit_deal_payments AS p
   WHERE p.active AND p.day BETWEEN p_from AND p_to
     AND NOT EXISTS (SELECT 1 FROM public.cockpit_sales_deals AS d
                      WHERE d.response_id = p.deal_response_id AND NOT coalesce(d.voided, false));

  WITH conf AS (
    SELECT DISTINCT ON (c.key) c.key, c.value
      FROM public.cockpit_pay_confirmations AS c
     WHERE c.key LIKE 'setter:%' OR c.key LIKE 'pif:%'
     ORDER BY c.key, c.set_at DESC, c.id DESC
  ), rep_alias AS (
    SELECT lower(btrim(x)) AS alias, CASE WHEN count(DISTINCT r.id) = 1 THEN min(r.id::text) END AS rep_id
      FROM public.cockpit_sales_reps AS r
      CROSS JOIN LATERAL unnest(coalesce(r.closer_aliases, '{}'::text[]) || ARRAY[r.display_name]) AS x
     WHERE nullif(btrim(x), '') IS NOT NULL
     GROUP BY 1
  ), rep_ghl AS (
    SELECT r.ghl_user_id, CASE WHEN count(DISTINCT r.id) = 1 THEN min(r.id::text) END AS rep_id
      FROM public.cockpit_sales_reps AS r WHERE nullif(btrim(r.ghl_user_id), '') IS NOT NULL GROUP BY 1
  ), rep_person AS (  -- no active filter: a leaver still earns on cash that clears after
    SELECT sp.b2b_rep_id::text AS rep_id, CASE WHEN count(DISTINCT cp.id) = 1 THEN min(cp.id) END AS person_id
      FROM public.cockpit_sales_people AS sp
      JOIN public.cockpit_people AS cp ON lower(btrim(cp.email)) = lower(btrim(sp.email))
     WHERE sp.b2b_rep_id IS NOT NULL
     GROUP BY 1
  ), live_cals AS (
    SELECT coalesce((SELECT array_remove(ARRAY[nullif(btrim(s.value->>'live_calendar_id'), ''), nullif(btrim(s.value->>'test_calendar_id'), '')], NULL)
                       FROM public.cockpit_sales_settings AS s WHERE s.key = 'rooms' LIMIT 1), '{}'::text[]) AS ids
  ), deals AS (
    SELECT d.response_id, d.submitted_at, (d.submitted_at AT TIME ZONE 'Asia/Kuwait')::date AS signed_day,
           coalesce(nullif(btrim(d.business_name), ''), nullif(btrim(d.client_name), ''), d.response_id) AS business,
           CASE WHEN nullif(btrim(d.payment_structure), '') IS NULL THEN NULL
                WHEN d.payment_structure ~* 'paid in full|\mpif\M' THEN 'pif'
                WHEN d.payment_structure ~* 'split' THEN 'split'
                WHEN d.payment_structure ~* 'monthly' THEN 'monthly' ELSE 'other' END AS plan,
           d.contracted_revenue, d.cash_collected,
           nullif(btrim(d.closer), '') AS closer, nullif(btrim(d.setter), '') AS setter,
           nullif(btrim(d.contact_id), '') AS contact_id, nullif(btrim(d.phone8), '') AS phone8
      FROM public.cockpit_sales_deals AS d
     WHERE NOT coalesce(d.voided, false) AND d.submitted_at IS NOT NULL
  ), pay AS (
    SELECT p.* FROM public.cockpit_deal_payments AS p JOIN deals AS d ON d.response_id = p.deal_response_id WHERE p.active
  ), money AS (
    SELECT d.response_id,
           coalesce(sum(p.usd) FILTER (WHERE p.day BETWEEN p_from AND p_to), 0) AS cash_in_month,
           coalesce(sum(p.usd) FILTER (WHERE p.day <= p_to), 0) AS cash_to_date,
           count(p.payment_id) FILTER (WHERE p.day BETWEEN p_from AND p_to) AS pays_in_month
      FROM deals AS d LEFT JOIN pay AS p ON p.deal_response_id = d.response_id
     GROUP BY 1
  ), pif_run AS (
    SELECT p.deal_response_id AS rid, p.day,
           sum(p.usd) OVER (PARTITION BY p.deal_response_id ORDER BY p.day, p.payment_id ROWS UNBOUNDED PRECEDING) AS cum
      FROM pay AS p JOIN deals AS d ON d.response_id = p.deal_response_id
     WHERE p.day <= d.signed_day + 45
  ), pif AS (
    SELECT d.response_id, d.signed_day + 45 AS until, z.top, z.day99, z.day90, z.last_day,
           CASE WHEN jsonb_typeof(cf.value->'earned') = 'boolean' THEN (cf.value->>'earned')::boolean END AS confirmed,
           CASE WHEN coalesce(d.contracted_revenue, 0) > 0 THEN round(greatest(d.contracted_revenue - coalesce(z.top, 0), 0), 2) END AS short_usd,
           coalesce(d.contracted_revenue, 0) > 0 AS has_contract
      FROM deals AS d
      LEFT JOIN conf AS cf ON cf.key = 'pif:' || d.response_id
      CROSS JOIN LATERAL (
        SELECT max(r.cum) AS top, max(r.day) AS last_day,
               min(r.day) FILTER (WHERE r.cum >= 0.99 * d.contracted_revenue) AS day99,
               min(r.day) FILTER (WHERE r.cum >= 0.90 * d.contracted_revenue) AS day90
          FROM pif_run AS r WHERE r.rid = d.response_id) AS z
  ), pif_state AS (
    SELECT f.response_id, f.until, f.short_usd,
           CASE WHEN NOT f.has_contract THEN 'no'
                WHEN f.confirmed IS TRUE THEN 'earned'
                WHEN f.confirmed IS FALSE THEN 'no'
                WHEN f.day99 IS NOT NULL THEN 'earned'
                WHEN f.day90 IS NOT NULL THEN 'waiting'
                ELSE 'no' END AS state,
           CASE WHEN NOT f.has_contract THEN NULL
                WHEN f.confirmed IS TRUE THEN coalesce(f.day99, f.day90, f.last_day)
                WHEN f.confirmed IS FALSE THEN NULL
                ELSE coalesce(f.day99, f.day90) END AS day,
           CASE WHEN f.confirmed IS NOT NULL THEN 'confirmed' WHEN f.day99 IS NOT NULL OR f.day90 IS NOT NULL THEN 'cash' END AS source
      FROM pif AS f
  ), intro_contact AS (
    SELECT d.response_id, a.assigned_user_id, a.assigned_user_name, a.start_at, 'intro' AS how
      FROM deals AS d
      CROSS JOIN LATERAL (
        SELECT a.* FROM public.cockpit_sales_appointments AS a
         WHERE a.contact_id = d.contact_id AND a.call_type = 'intro' AND a.start_at <= d.submitted_at
           -- changed from cockpit_sales_setter_deals: a cancelled or invalid intro is no evidence, and an intro with no calendar is not dropped
           AND coalesce(a.status, '') NOT IN ('cancelled', 'invalid')
           AND (a.calendar_id IS NULL OR NOT (a.calendar_id = ANY (coalesce((SELECT ids FROM live_cals), '{}'::text[]))))
           AND NOT EXISTS (SELECT 1 FROM public.cockpit_sales_rooms AS r
                            WHERE r.count_appointment_id = a.appointment_id AND r.count_result = 'booked')
         ORDER BY a.start_at DESC LIMIT 1) AS a
     WHERE d.contact_id IS NOT NULL
  ), phone_lead AS (
    SELECT d.response_id, min(l.contact_id) AS contact_id
      FROM deals AS d JOIN public.cockpit_sales_leads AS l ON l.phone8 = d.phone8
     WHERE d.phone8 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM intro_contact AS i WHERE i.response_id = d.response_id)
     GROUP BY 1 HAVING count(DISTINCT l.contact_id) = 1
  ), intro_phone AS (
    SELECT d.response_id, a.assigned_user_id, a.assigned_user_name, a.start_at, 'phone_intro' AS how
      FROM deals AS d
      JOIN phone_lead AS pl ON pl.response_id = d.response_id
      CROSS JOIN LATERAL (
        SELECT a.* FROM public.cockpit_sales_appointments AS a
         WHERE a.contact_id = pl.contact_id AND a.call_type = 'intro' AND a.start_at <= d.submitted_at
           AND coalesce(a.status, '') NOT IN ('cancelled', 'invalid')
           AND (a.calendar_id IS NULL OR NOT (a.calendar_id = ANY (coalesce((SELECT ids FROM live_cals), '{}'::text[]))))
           AND NOT EXISTS (SELECT 1 FROM public.cockpit_sales_rooms AS r
                            WHERE r.count_appointment_id = a.appointment_id AND r.count_result = 'booked')
         ORDER BY a.start_at DESC LIMIT 1) AS a
  ), intro AS (
    SELECT * FROM intro_contact UNION ALL SELECT * FROM intro_phone
  ), who AS (
    SELECT d.*, crp.person_id AS closer_person,
           fa.rep_id AS form_rep, frp.person_id AS form_person,
           i.assigned_user_name AS intro_name, i.start_at AS intro_at, i.how AS intro_how,
           ig.rep_id AS intro_rep, irp.person_id AS intro_person,
           (cf.key IS NOT NULL) AS setter_confirmed,
           CASE WHEN jsonb_typeof(cf.value->'personId') = 'number' THEN (cf.value->>'personId')::bigint END AS confirmed_person
      FROM deals AS d
      LEFT JOIN rep_alias AS ca ON ca.alias = lower(d.closer)
      LEFT JOIN rep_person AS crp ON crp.rep_id = ca.rep_id
      LEFT JOIN rep_alias AS fa ON fa.alias = lower(d.setter)
      LEFT JOIN rep_person AS frp ON frp.rep_id = fa.rep_id
      LEFT JOIN intro AS i ON i.response_id = d.response_id
      LEFT JOIN rep_ghl AS ig ON ig.ghl_user_id = i.assigned_user_id
      LEFT JOIN rep_person AS irp ON irp.rep_id = ig.rep_id
      LEFT JOIN conf AS cf ON cf.key = 'setter:' || d.response_id
  ), judged AS (
    SELECT w.*,
           CASE WHEN w.setter_confirmed THEN 'known'
                WHEN w.setter IS NOT NULL AND w.intro_at IS NOT NULL
                  THEN CASE WHEN w.form_rep IS NOT NULL AND w.form_rep = w.intro_rep THEN 'known' ELSE 'waiting' END
                WHEN w.setter IS NOT NULL OR w.intro_at IS NOT NULL THEN 'known'
                ELSE 'none' END AS setter_state,
           CASE WHEN w.setter_confirmed THEN 'confirmed'
                WHEN w.setter IS NOT NULL THEN 'form'
                WHEN w.intro_at IS NOT NULL THEN w.intro_how
                ELSE 'none' END AS setter_source
      FROM who AS w
  ), scoped AS (
    SELECT j.*, m.cash_in_month, m.cash_to_date, m.pays_in_month, ps.state AS pif_state, ps.day AS pif_day, ps.source AS pif_source,
           ps.until AS pif_until, ps.short_usd,
           CASE WHEN j.setter_state <> 'known' THEN NULL
                WHEN j.setter_confirmed THEN j.confirmed_person
                WHEN j.setter IS NOT NULL THEN j.form_person
                ELSE j.intro_person END AS setter_person,
           CASE WHEN j.setter_state = 'waiting' OR j.setter_state = 'none' THEN NULL
                WHEN j.setter_confirmed THEN (SELECT p.name FROM public.cockpit_people AS p WHERE p.id = j.confirmed_person)
                WHEN j.setter IS NOT NULL THEN j.setter
                ELSE j.intro_name END AS setter_name,
           (ps.day BETWEEN p_from AND p_to) AS pif_in_month
      FROM judged AS j
      JOIN money AS m ON m.response_id = j.response_id
      JOIN pif_state AS ps ON ps.response_id = j.response_id
     WHERE j.signed_day BETWEEN p_from AND p_to OR m.pays_in_month > 0
        OR (ps.state IN ('earned', 'waiting') AND ps.day BETWEEN p_from AND p_to)
  ), credit AS (
    SELECT s.closer_person AS person_id, s.cash_in_month AS closed_cash, 0::numeric AS set_cash, NULL::text AS set_wait,
           CASE WHEN s.pif_state = 'earned' AND s.pif_in_month THEN s.response_id END AS pif_deal,
           CASE WHEN s.pif_state = 'waiting' AND s.pif_in_month THEN s.response_id END AS pif_wait
      FROM scoped AS s WHERE s.closer_person IS NOT NULL
    UNION ALL
    SELECT s.setter_person, 0, s.cash_in_month, NULL, NULL, NULL
      FROM scoped AS s WHERE s.setter_person IS NOT NULL
    UNION ALL  -- the form and the intro disagree: it waits for both people they name
    SELECT x.pid, 0, 0, s.response_id, NULL, NULL
      FROM scoped AS s CROSS JOIN LATERAL (VALUES (s.form_person), (s.intro_person)) AS x(pid)
     WHERE s.setter_state = 'waiting' AND s.pays_in_month > 0 AND x.pid IS NOT NULL
    UNION ALL  -- nobody on record set it: it waits on its closer
    SELECT s.closer_person, 0, 0, s.response_id, NULL, NULL
      FROM scoped AS s WHERE s.setter_state = 'none' AND s.pays_in_month > 0 AND s.closer_person IS NOT NULL
  ), unkeyed AS (
    SELECT s.response_id, s.closer AS name, 'closer' AS role FROM scoped AS s WHERE s.closer IS NOT NULL AND s.closer_person IS NULL
    UNION
    SELECT s.response_id, s.setter, 'setter' FROM scoped AS s WHERE s.setter IS NOT NULL AND s.form_person IS NULL AND NOT s.setter_confirmed
    UNION
    SELECT s.response_id, coalesce(s.intro_name, 'the intro''s assigned user'), 'setter'
      FROM scoped AS s WHERE s.intro_at IS NOT NULL AND s.intro_person IS NULL AND NOT s.setter_confirmed
    UNION
    SELECT s.response_id, 'person ' || s.confirmed_person, 'setter'
      FROM scoped AS s WHERE s.setter_confirmed AND s.confirmed_person IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.cockpit_people AS p WHERE p.id = s.confirmed_person)
  )
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to, 'cashThrough', v_through, 'ledgerReady', v_ledger,
    'deals', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'responseId', s.response_id, 'signedDay', s.signed_day, 'business', s.business, 'plan', s.plan,
               'contracted', s.contracted_revenue, 'depositTyped', s.cash_collected,
               'closer', jsonb_build_object('name', s.closer, 'personId', s.closer_person),
               'setter', jsonb_build_object(
                 'name', s.setter_name, 'personId', s.setter_person, 'source', s.setter_source, 'state', s.setter_state,
                 'disagree', CASE WHEN s.setter_state = 'waiting' THEN jsonb_build_object(
                   'form', jsonb_build_object('name', s.setter, 'personId', s.form_person),
                   'intro', jsonb_build_object('name', s.intro_name, 'personId', s.intro_person, 'at', s.intro_at, 'by', s.intro_how)) END),
               'payments', coalesce((SELECT jsonb_agg(jsonb_build_object('paymentId', p.payment_id, 'rail', p.rail, 'day', p.day, 'usd', p.usd,
                                                        'kind', p.kind, 'matchedBy', p.matched_by, 'inMonth', p.day BETWEEN p_from AND p_to)
                                                      ORDER BY p.day, p.payment_id)
                                       FROM pay AS p WHERE p.deal_response_id = s.response_id AND p.day <= p_to), '[]'::jsonb),
               'cashInMonth', round(s.cash_in_month, 2), 'cashToDate', round(s.cash_to_date, 2),
               'pif', jsonb_build_object('state', s.pif_state, 'day', s.pif_day, 'shortUsd', s.short_usd, 'until', s.pif_until, 'source', s.pif_source))
             ORDER BY s.signed_day, s.response_id)
        FROM scoped AS s), '[]'::jsonb),
    'people', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'personId', c.person_id, 'name', (SELECT p.name FROM public.cockpit_people AS p WHERE p.id = c.person_id),
               'closedCashUsd', c.closed_cash, 'setCashUsd', c.set_cash,
               'setWaiting', c.set_waiting, 'pifDeals', c.pif_deals, 'pifWaiting', c.pif_waiting)
             ORDER BY c.person_id)
        FROM (SELECT cr.person_id, round(sum(cr.closed_cash), 2) AS closed_cash, round(sum(cr.set_cash), 2) AS set_cash,
                     coalesce(jsonb_agg(DISTINCT cr.set_wait) FILTER (WHERE cr.set_wait IS NOT NULL), '[]'::jsonb) AS set_waiting,
                     coalesce(jsonb_agg(DISTINCT cr.pif_deal) FILTER (WHERE cr.pif_deal IS NOT NULL), '[]'::jsonb) AS pif_deals,
                     coalesce(jsonb_agg(DISTINCT cr.pif_wait) FILTER (WHERE cr.pif_wait IS NOT NULL), '[]'::jsonb) AS pif_waiting
                FROM credit AS cr GROUP BY cr.person_id) AS c), '[]'::jsonb),
    'unkeyed', coalesce((SELECT jsonb_agg(jsonb_build_object('responseId', u.response_id, 'name', u.name, 'role', u.role)
                                          ORDER BY u.response_id, u.role, u.name) FROM unkeyed AS u), '[]'::jsonb),
    'unattributed', (
      SELECT jsonb_build_object('count', count(*), 'usd', round(coalesce(sum(t.usd), 0), 2),
               'items', coalesce(jsonb_agg(jsonb_build_object('paymentId', t.id, 'day', t.day, 'usd', t.usd, 'payer', t.payer, 'rail', t.rail)
                                           ORDER BY t.day, t.id), '[]'::jsonb))
        FROM (SELECT x->>'id' AS id, x->>'day' AS day, x->>'rail' AS rail, coalesce(x->>'payerName', x->>'payerEmail') AS payer,
                     CASE WHEN x->>'usd' ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (x->>'usd')::numeric END AS usd
                FROM public.cockpit_sections AS s
                CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.payload->'attribution'->'transactions') = 'array'
                                                             THEN s.payload->'attribution'->'transactions' ELSE '[]'::jsonb END) AS x
               WHERE s.key = 'money' AND x->>'direction' = 'in' AND x->>'side' = 'unattributed' AND coalesce(x->>'rail', '') <> 'bank'
                 AND x->>'day' BETWEEN p_from::text AND p_to::text) AS t),
    'note', to_jsonb(array_remove(ARRAY[
      'Cash is each payment the money refresh tied to a signed deal (front end: up to the contract, within 120 days of signing), from every rail, by the Kuwait day it cleared.',
      'Who set a deal: your confirmation, else the form''s setter and the latest intro before signing when they agree or only one exists; when they disagree it waits.',
      'Paid in full: the deal''s cash reaches 99% of its contract within 45 days of signing, counted in the month of that payment; 90 to 99% waits for your confirmation.',
      'Money not tied to a deal is listed under unattributed and never counted.',
      CASE WHEN v_through IS NULL THEN 'The money refresh has not run: no deal cash is known yet.'
           WHEN NOT v_ledger THEN 'The Money section was published before the deal ledger existed: no deal cash is known until the next money refresh.'
           WHEN p_to >= v_today AND v_through < now() - interval '2 hours'
             THEN format('The money refresh last ran %s Kuwait time: payments since then are not counted yet.',
                         to_char(v_through AT TIME ZONE 'Asia/Kuwait', 'FMDD Mon HH24:MI')) END,
      CASE WHEN v_orphans > 0 THEN format('%s deal payments in the range point at a deal that is voided or missing and are left out.', v_orphans) END], NULL))
  ) INTO v_out;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION public.cockpit_pay_facts_sales(date, date) IS
  'Pay facts, sales (PAY-PLANS.md 4.4): cash cleared per signed deal, who closed and who set it, the paid-in-full state, per person closed and set cash. Internal: the pay month calls it.';

-- ---------------------------------------------------------------------------
-- 5. Privileges: internal, so revoked from all four roles with no grant.

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['cockpit_pay_facts_calls(date,date)', 'cockpit_pay_facts_ads(date,date,integer)',
    'cockpit_pay_facts_clients(date)', 'cockpit_pay_facts_sales(date,date)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
END $$;

COMMIT;
