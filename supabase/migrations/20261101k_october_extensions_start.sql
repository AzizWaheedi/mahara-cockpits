-- The CEO, 1 Nov: ARCWANI's and Nohod Najd's extensions run from the last
-- payment date on their ClickUp cards (Next Payment Date: 28 Sep and 7 Oct).
-- The weeks are not given yet, so the lines are partial and the cards'
-- payment dates have not moved.

BEGIN;

UPDATE public.cockpit_goal_lockin_rows SET
  value='From 28 Sep, weeks not given', status='partial',
  source='Named as an extension by you on 30 Oct; from the last payment date on the ClickUp card (your call, 1 Nov).',
  leaves_out='How many weeks. Until then the card''s next payment date stays 28 Sep and the $3,000 reads late.',
  updated_by='claude on the CEO''s word, 2026-11-01', updated_at=now()
WHERE month='2026-10' AND section='extensions' AND label='ARCWANI';

UPDATE public.cockpit_goal_lockin_rows SET
  value='From 7 Oct, weeks not given', status='partial',
  source='Named as an extension by you on 30 Oct; from the last payment date on the ClickUp card (your call, 1 Nov).',
  leaves_out='How many weeks. Until then the card''s next payment date stays 7 Oct and the $700 reads late.',
  updated_by='claude on the CEO''s word, 2026-11-01', updated_at=now()
WHERE month='2026-10' AND section='extensions' AND label='نهوض نجد';

COMMIT;
