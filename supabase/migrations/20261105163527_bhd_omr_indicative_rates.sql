-- Informational conversions only. Existing board/Meta conversion functions,
-- card-fill planning, launch defaults and provider writes are unchanged.
-- BHD: https://www.cbb.gov.bh/wp-content/uploads/2025/03/Feb-2025.pdf
-- OMR: https://cbo.gov.om/Pages/FixedPeg.aspx
-- Source values are a fixed peg estimate, not a quoted transaction rate.
DO $$
DECLARE fn regprocedure := to_regprocedure('public.cockpit_indicative_usd_rate(text)');
BEGIN
  IF to_regprocedure('public.cockpit_board_usd_rate(text)') IS NULL THEN
    RAISE EXCEPTION 'The existing board rate function is missing.';
  END IF;
  IF fn IS NOT NULL AND (
    SELECT md5(regexp_replace(p.prosrc, '\s+', ' ', 'g')) <> 'a8c8c6bbb7ee56b3a9e4b56546ab1de2'
      OR p.prosecdef OR p.provolatile <> 'i'
    FROM pg_proc p WHERE p.oid=fn
  ) THEN
    RAISE EXCEPTION 'The indicative rate function has changed. Review before replacing it.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cockpit_indicative_usd_rate(p_currency text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE upper(btrim(coalesce(p_currency, '')))
    WHEN 'BHD' THEN 2.6596
    WHEN 'OMR' THEN 2.6008
    ELSE public.cockpit_board_usd_rate(p_currency)
  END::numeric;
$$;

-- Do not expose a new public API. A service can use this only for a reviewed
-- informational view; action-producing paths must continue using their own rate.
REVOKE ALL ON FUNCTION public.cockpit_indicative_usd_rate(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cockpit_indicative_usd_rate(text) TO service_role;
