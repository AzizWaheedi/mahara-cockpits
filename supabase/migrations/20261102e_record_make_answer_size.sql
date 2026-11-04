-- The New Client Form's answers can be far larger than 64 KB: one long-text answer holds a
-- pasted call summary of about 180 KB (27 of its 55 responses read on 2026-11-02 are over
-- 64 KB). cockpit_form_record_make refused them with 22023, so the D-NCF backfill stored 39 of
-- 55, and a live submission of that size would be refused by the signed webhook (forms-door
-- answers 500, Typeform retries and can switch the webhook off). forms-door already takes a body
-- of up to 1,500,000 bytes; the record now takes answers of up to 1 MB for the two make-owned,
-- record-only forms (onboarding, new_client). Only that size check and its sentence change; the
-- live body is edited in place so the grants stay. Applies twice.
BEGIN;
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.cockpit_form_record_make(jsonb)'::regprocedure);
  IF position('octet_length(v_answers::text) > 1048576' IN d) > 0 THEN
    RETURN;
  END IF;
  IF position('octet_length(v_answers::text) > 65536' IN d) = 0 THEN
    RAISE EXCEPTION 'cockpit_form_record_make changed since 20261102c; stop and re-read it.' USING ERRCODE = '55000';
  END IF;
  d := replace(d, 'octet_length(v_answers::text) > 65536', 'octet_length(v_answers::text) > 1048576');
  d := replace(d, 'Send the answers as {fields: [...]} under 64 KB.', 'Send the answers as {fields: [...]} under 1 MB.');
  EXECUTE d;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
