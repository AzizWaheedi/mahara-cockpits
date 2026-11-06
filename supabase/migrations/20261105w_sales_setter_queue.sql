-- The setter's one queue (Aziz, 2026-11-05): the setter works one dialer
-- queue all day instead of four Slack channels. Two things need storing:
--
-- 1. Voice notes. After a call nobody answered (a new lead, a lead who just
--    booked an intro, a confirmation call), the setter sends a personal
--    voice note from their own phone. The cockpit sends nothing; it records
--    that the note went (sales-api dial.touch, audited), so the queue counts
--    it as that step's try and stops asking for it.
-- 2. "Not ready yet (nurture)": a qualified lead who is not ready for a
--    valid reason goes to long-term nurture with no "not interested" tag and
--    no disqualification. The dialer's attempts take the new outcome.
--
-- cockpit_sales_touches has row security and no policies: the browser
-- reaches it only through sales-api, which uses the service key.

BEGIN;

CREATE TABLE IF NOT EXISTS public.cockpit_sales_touches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('voice_note')),
  -- The step the note followed: a new lead's calls, a just-booked lead's,
  -- or a confirmation call.
  step text CHECK (step IS NULL OR step IN ('new', 'booked', 'confirm')),
  appointment_id text,
  rep_email text NOT NULL,
  note text CHECK (note IS NULL OR length(note) <= 500),
  -- A save sent again after a dropped connection is the same save.
  request_id uuid UNIQUE,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cockpit_sales_touches_contact ON public.cockpit_sales_touches (contact_id, kind, at DESC);
CREATE INDEX IF NOT EXISTS cockpit_sales_touches_recent ON public.cockpit_sales_touches (at DESC);

ALTER TABLE public.cockpit_sales_touches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_sales_touches FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.cockpit_sales_touches TO service_role;

-- The dialer's outcomes, with "not ready yet".
ALTER TABLE public.cockpit_sales_attempts DROP CONSTRAINT IF EXISTS cockpit_sales_attempts_outcome_check;
ALTER TABLE public.cockpit_sales_attempts ADD CONSTRAINT cockpit_sales_attempts_outcome_check
  CHECK (outcome IS NULL OR outcome IN (
    'no_answer', 'callback', 'booked', 'not_interested', 'disqualified', 'wrong_number', 'handled',
    'confirmed', 'rescheduled', 'cancelled', 'showed', 'noshow', 'not_ready'
  ));

NOTIFY pgrst, 'reload schema';

COMMIT;
