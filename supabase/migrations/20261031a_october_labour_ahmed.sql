-- The CEO, 31 Oct: Ahmed Abushaiba is owed $975 more for October now that
-- Alalia.co has paid in full. It replaces the $525 the lock-in carried, so his
-- October is $2,462.50 and October's labour $10,612.50.

BEGIN;

UPDATE public.cockpit_goal_lockin_rows SET value='$10,612.50',
  source='Your list of 30 Oct: Rasem $2,000, Lama $900, Daniya $900, Karim $800, Sabry $800, Muhammed $800, Ahmed Seediq $700, Ali $600, Nada $400 (left mid-month), Abdelaziz $250, Ahmed Abushaiba $2,462.50.',
  leaves_out='Ahmed''s $2,462.50 is his message of 18 Oct ($1,487.50 for 7 to 18 Oct on a Ziina link, including $187.50 old pending and a $250 bonus) plus $975, your figure of 31 Oct now that Alalia has paid in full. How the $975 is made up is not recorded: 15% of Alalia''s $5,492.06 after its deposit is $823.81. No commission is priced on Ardon''s $2,000 (27 Oct), Al Ola''s $2,021.20 month 2 (20 Oct) or Smart Interior''s $250 deposit (16 Oct), all credited to him on the Money tab. The Costs page''s roster still shows older pay for five people.',
  updated_by='claude on the CEO''s word, 2026-10-31', updated_at=now()
WHERE month='2026-10' AND section='finances' AND label='Labour expenses';

UPDATE public.cockpit_goal_lockin_rows SET value='$10,357.25, 37.0%',
  updated_by='claude on the CEO''s word, 2026-10-31', updated_at=now()
WHERE month='2026-10' AND section='finances' AND label='Total profit';

UPDATE public.cockpit_goal_sheet_cells SET value=10612.5,
  note='The CEO''s list of 30 Oct: base $8,150 plus Ahmed Abushaiba $2,462.50 ($1,487.50 paid 18 Oct, $975 owed for Alalia, 31 Oct)',
  updated_by='claude on the CEO''s word, 2026-10-31', updated_at=now()
WHERE metric_key='labour' AND day='2026-10-29' AND kind='actual';

COMMIT;
