-- Follow-up to 20261102e: cockpit_form_responses also caps answers at 64 KB in a table CHECK,
-- so the New Client Form's long answers were refused with 23514 after the function allowed them.
-- The cap becomes form-aware: 1 MB for the two make-owned, record-only Typeform forms
-- (new_client, onboarding), 64 KB for every other form as before. Applies twice.
BEGIN;
DO $$
BEGIN
  IF pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = 'cockpit_form_responses_answers_check'
                            AND conrelid = 'public.cockpit_form_responses'::regclass)) NOT LIKE '%1048576%' THEN
    ALTER TABLE public.cockpit_form_responses DROP CONSTRAINT cockpit_form_responses_answers_check;
    ALTER TABLE public.cockpit_form_responses ADD CONSTRAINT cockpit_form_responses_answers_check
      CHECK (jsonb_typeof(answers) = 'object'
             AND octet_length(answers::text) <= CASE WHEN form_key IN ('new_client', 'onboarding') THEN 1048576 ELSE 65536 END);
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';
COMMIT;
