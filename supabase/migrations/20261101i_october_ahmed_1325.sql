-- The CEO, 1 Nov: Ahmed Abushaiba's commission for Alalia.co paying in full
-- was $1,325, not $975. His October is $2,812.50 and October's labour
-- $10,962.50, so profit is $10,007.25 on $27,980.62 new cash.

BEGIN;

UPDATE public.cockpit_goal_lockin_rows SET value='$10,962.50',
  source='Your list of 30 Oct: Rasem $2,000, Lama $900, Daniya $900, Karim $800, Sabry $800, Muhammed $800, Ahmed Seediq $700, Ali $600, Nada $400 (left mid-month), Abdelaziz $250, Ahmed Abushaiba $2,812.50.',
  leaves_out='Ahmed''s $2,812.50 is his message of 18 Oct ($1,487.50 for 7 to 18 Oct on a Ziina link, including $187.50 old pending and a $250 bonus) plus $1,325, his commission now that Alalia has paid in full (your figure of 1 Nov, replacing the $975 of 31 Oct). How the $1,325 is made up is not recorded. No commission is priced on Ardon''s $2,000 (27 Oct), Al Ola''s $2,021.20 month 2 (20 Oct) or Smart Interior''s $250 deposit (16 Oct), all credited to him on the Money tab. The Costs page''s roster still shows older pay for five people. The $693.94 paid to him on the Whop card on 7 Oct is September pay (your call, 1 Nov), so it is not in October.',
  updated_by='claude on the CEO''s word, 2026-11-01', updated_at=now()
WHERE month='2026-10' AND section='finances' AND label='Labour expenses';

UPDATE public.cockpit_goal_lockin_rows SET value='$10,007.25, 35.8%',
  updated_by='claude on the CEO''s word, 2026-11-01', updated_at=now()
WHERE month='2026-10' AND section='finances' AND label='Total profit';

UPDATE public.cockpit_goal_sheet_cells SET value=10962.5,
  note='The CEO''s list of 30 Oct: base $8,150 plus Ahmed Abushaiba $2,812.50 ($1,487.50 paid 18 Oct, $1,325 owed for Alalia, 1 Nov)',
  updated_by='claude on the CEO''s word, 2026-11-01', updated_at=now()
WHERE metric_key='labour' AND day='2026-10-29' AND kind='actual';

UPDATE public.cockpit_goal_targets
  SET note=replace(note, 'Ahmed''s $975 (October labour)', 'Ahmed''s $1,325 for Alalia (October labour)')
WHERE plan_id=6 AND metric_key='labour' AND note LIKE '%Ahmed''s $975 (October labour)%';

COMMIT;
