-- CSM call list: the clients that ignored the Thursday message twice (2026-10-21,
-- Creative Triage bldgtotkfmhoxmlzowdx).
--
-- Program 1, item 1.5 of the 20 October software plan. The Thursday reminder script
-- (checkReportSheets.gs in the Google Service Account project, Thursdays 10:00 GMT+3) asks,
-- for every Active client, about meetings from the last 14 days whose Show cell (column J) is
-- blank, or whose Show is Y and Closed (column L) is blank, skipping cancelled rows (column F
-- is C). Muhammed (21 October): after two chases with no change in the sheet, the client
-- becomes a call task for the CSM, and no third message is sent. At most 5 clients a week,
-- most missing meetings first. The rest are queued.
--
-- The rule (the script's own, read from the same sheet rows the dialer keeps in
-- mahara_reporting.sheet_snapshots, which are the client report sheets):
--   A meeting counts when at least two Thursday runs have passed since it ended and it is
--   still blank. A Thursday run asks about a meeting when the meeting ended before the run
--   and not more than 14 days before it, so each meeting is asked about at most twice (on the
--   first two Thursdays after it, inside 14 days), and the count never rises above two.
--   Blank means: Show empty, or Show Y and Closed empty. A cancelled row never counts.
--   "Thursday run" is every Thursday 10:00 Kuwait time. The week is the ISO week, the same
--   week key as the Make record key (report-<GHL location id>-<ISO week>).
--
-- Whether a Thursday message was really sent lives in the Make data store "Pending Report
-- Reminders" (173772), not in this database: a draft is saved there as pending, and only a CSM
-- pressing Send makes it sent (on 20 October 32 of 97 drafts were sent, 1 denied, 64 pending,
-- and sends happened on 4 of the last 10 Thursdays). How this file handles it:
--   - By default it counts the Thursday runs that were due, whether or not the card was sent,
--     and says so in every row (runs_basis = 'scheduled_runs'). That is the plan's default. It
--     can over-count: a client whose cards were never sent has not really been asked twice.
--   - When the caller passes p_sent, the records of that store (a JSON array of the record keys,
--     or of {key, status} or {key, data:{status}} records), only runs whose key
--     report-<location>-<ISO week> is in the list with status sent count (runs_basis =
--     'sent_runs'). A server that can read the Make store passes it; this database never does.
--
-- What it adds (read-only, service key only): cockpit_csm_call_list(now, cap, sent, min_runs,
-- since_days). It returns one row per client with at least one counted meeting: the rank, call
-- or queued, the number of missing meetings (and how many are Show or Closed), the oldest, how
-- many more are still in their first chase, and the meetings (first name, day, which cell,
-- how many runs).
--
-- Not in scope: sending anything, any Make or Apps Script change, writing a sheet, remembering
-- who was already called this week (the list is worked out fresh from the sheets each time, so a
-- client the CSM fixed drops out and a queued client moves up), clients the script skips (no
-- WhatsApp group id or no sheet link in its Client Data sheet: the database cannot see that).
--
-- How we know it works: apps/media-buyer-cockpit/scripts/results-speed-data-supabase.test.ts runs
-- this file on PGlite: a meeting before the first run or inside one run does not count, one past
-- two runs counts, a filled Show or a Y with Closed filled does not, a cancelled row does not, the
-- cap of 5 marks the sixth client queued, most missing meetings rank first, and with p_sent only
-- sent runs count.
--
-- Database work: it reads the 20 sheet snapshots (about 400 rows in all) and the 67 board client
-- rows, once. No table is scanned in a loop and nothing is scheduled.
--
-- Safe to apply twice. Rollback: DROP FUNCTION public.cockpit_csm_call_list.

BEGIN;
SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF to_regclass('public.cockpit_board_clients') IS NULL OR to_regclass('mahara_reporting.sheet_snapshots') IS NULL
     OR to_regprocedure('mahara_reporting.cc_time(text)') IS NULL THEN
    RAISE EXCEPTION 'The board clients or the dialer''s sheet snapshots are missing';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_csm_call_list(
  p_now timestamptz DEFAULT now(), p_cap integer DEFAULT 5, p_sent jsonb DEFAULT NULL,
  p_min_runs integer DEFAULT 2, p_since_days integer DEFAULT 60)
RETURNS TABLE(
  location_id text, client_name text, week_key text, rank integer, status text,
  missing_meetings integer, missing_show integer, missing_closed integer, oldest_meeting date,
  in_first_chase integer, runs_basis text, meetings jsonb, sheet_checked_at timestamptz, sheet_error text, note text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_cap IS NULL OR p_cap < 1 OR p_min_runs IS NULL OR p_min_runs < 1 OR p_since_days IS NULL OR p_since_days < 14 OR p_since_days > 366 THEN
    RAISE EXCEPTION 'Choose a cap of at least 1, at least 1 run, and a look-back of 14 to 366 days.' USING ERRCODE = '22023';
  END IF;
  IF p_sent IS NOT NULL AND jsonb_typeof(p_sent) <> 'array' THEN
    RAISE EXCEPTION 'p_sent is a JSON array of the Make store''s records.' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH runs AS (
    -- Every Thursday 10:00 Kuwait time that has already passed, with its ISO week.
    SELECT ((g.d + time '10:00') AT TIME ZONE 'Asia/Kuwait') AS t, to_char(g.d, 'IYYY-"W"IW') AS wk
    FROM (SELECT (p_now AT TIME ZONE 'Asia/Kuwait')::date - o AS d FROM generate_series(0, p_since_days + 14) AS o) g
    WHERE extract(dow FROM g.d) = 4 AND ((g.d + time '10:00') AT TIME ZONE 'Asia/Kuwait') <= p_now
  ), sent AS (
    SELECT DISTINCT CASE WHEN jsonb_typeof(e) = 'string' THEN e #>> '{}' ELSE e->>'key' END AS k
    FROM jsonb_array_elements(coalesce(p_sent, '[]'::jsonb)) e
    WHERE jsonb_typeof(e) = 'string' OR coalesce(e->>'status', e->'data'->>'status') = 'sent'
  ), sheet AS (
    SELECT b.location_id AS loc, b.client_name AS name, s.checked_at, s.error,
      btrim(coalesce(r->>'name', '')) AS lead, mahara_reporting.cc_time(r->>'meeting') AS t,
      btrim(coalesce(r->>'show', '')) AS show, btrim(coalesce(r->>'closed', '')) AS closed,
      upper(btrim(coalesce(r->>'confirmed', ''))) AS conf
    FROM public.cockpit_board_clients b
    JOIN mahara_reporting.sheet_snapshots s ON s.id = b.location_id AND s.namespace = 'production' AND s.data->>'sheetId' = s.sheet_id
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.data->'rows') = 'array' THEN s.data->'rows' ELSE '[]'::jsonb END) r
    WHERE b.status = 'Active'
  ), gaps AS (
    SELECT sh.*, CASE WHEN sh.show = '' THEN 'show' WHEN upper(sh.show) = 'Y' AND sh.closed = '' THEN 'closed' END AS kind
    FROM sheet sh
    WHERE sh.lead <> '' AND sh.conf <> 'C' AND sh.t IS NOT NULL AND sh.t <= p_now
      AND sh.t >= p_now - make_interval(days => p_since_days)
  ), asked AS (
    SELECT g.*, (
      SELECT count(*) FROM runs u
      WHERE u.t >= g.t AND u.t <= g.t + interval '14 days'
        AND (p_sent IS NULL OR ('report-' || g.loc || '-' || u.wk) IN (SELECT k FROM sent))
    ) AS asks
    FROM gaps g WHERE g.kind IS NOT NULL
  ), per AS (
    SELECT a.loc, a.name, max(a.checked_at) AS checked, max(a.error) AS err,
      count(*) FILTER (WHERE a.asks >= p_min_runs) AS missing,
      count(*) FILTER (WHERE a.asks >= p_min_runs AND a.kind = 'show') AS m_show,
      count(*) FILTER (WHERE a.asks >= p_min_runs AND a.kind = 'closed') AS m_closed,
      min(a.t) FILTER (WHERE a.asks >= p_min_runs) AS oldest,
      count(*) FILTER (WHERE a.asks BETWEEN 1 AND p_min_runs - 1) AS first_chase,
      jsonb_agg(jsonb_build_object(
        'name', (regexp_match(a.lead, '^[^[:space:]]+'))[1],
        'day', to_char(a.t AT TIME ZONE 'Asia/Kuwait', 'YYYY-MM-DD'),
        'cell', CASE a.kind WHEN 'show' THEN 'Show' ELSE 'Closed' END,
        'runs', a.asks) ORDER BY a.t, a.lead) FILTER (WHERE a.asks >= p_min_runs) AS list
    FROM asked a GROUP BY a.loc, a.name
  )
  SELECT p.loc, p.name, to_char(p_now AT TIME ZONE 'Asia/Kuwait', 'IYYY-"W"IW'),
    (row_number() OVER (ORDER BY p.missing DESC, p.oldest, p.name, p.loc))::integer,
    CASE WHEN row_number() OVER (ORDER BY p.missing DESC, p.oldest, p.name, p.loc) <= p_cap THEN 'call' ELSE 'queued' END,
    p.missing::integer, p.m_show::integer, p.m_closed::integer, (p.oldest AT TIME ZONE 'Asia/Kuwait')::date,
    p.first_chase::integer,
    CASE WHEN p_sent IS NULL THEN 'scheduled_runs' ELSE 'sent_runs' END,
    p.list, p.checked, p.err,
    nullif(concat_ws(' ',
      CASE WHEN p_sent IS NULL THEN 'Counted by Thursday runs that were due, not by cards sent: the Make store holds which cards went out.' END,
      CASE WHEN p.err IS NOT NULL THEN 'The dialer''s last read of this client''s sheet reported an error, so the rows may be out of date.' END), '')
  FROM per p
  WHERE p.missing > 0
  ORDER BY 4;
END $$;

REVOKE ALL ON FUNCTION public.cockpit_csm_call_list(timestamptz, integer, jsonb, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_csm_call_list(timestamptz, integer, jsonb, integer, integer) TO service_role;

COMMIT;
