-- The CEO, 1 Nov: the $693.94 paid to Ahmed Abushaiba on 7 Oct is September pay.
UPDATE public.cockpit_goal_lockin_rows
SET leaves_out = leaves_out || ' The $693.94 paid to him on the Whop card on 7 Oct is September pay (your call, 1 Nov), so it is not in October.',
  updated_by='claude on the CEO''s word, 2026-11-01', updated_at=now()
WHERE month='2026-10' AND section='finances' AND label='Labour expenses' AND leaves_out NOT LIKE '%$693.94%';
