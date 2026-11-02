-- The CEO, 2 Nov: Ahmed Abushaiba's last payment (his Alalia commission) came
-- to $1,575, not $1,325, so his October is $3,062.50 and October's labour
-- $11,212.50. Postiz joins the software at $49 a month (October's Whop card
-- shows a $0 sign-up on 26 Oct), so November's software is $5,058. Google
-- Workspace was already on the Costs page and in the plan at $140.09, October's
-- €124.21 on the CBK card.

BEGIN;

-- October
UPDATE public.cockpit_goal_lockin_rows SET value='$11,212.50',
  source=replace(source, 'Ahmed Abushaiba $2,812.50', 'Ahmed Abushaiba $3,062.50'),
  leaves_out=replace(replace(leaves_out,
    'Ahmed''s $2,812.50', 'Ahmed''s $3,062.50'),
    'plus $1,325, his commission now that Alalia has paid in full (your figure of 1 Nov, replacing the $975 of 31 Oct)',
    'plus $1,575, his last payment, for Alalia paying in full (your figure of 2 Nov, replacing $1,325 on 1 Nov and $975 on 31 Oct)'),
  updated_by='claude on the CEO''s word, 2026-11-02', updated_at=now()
WHERE month='2026-10' AND section='finances' AND label='Labour expenses';

UPDATE public.cockpit_goal_lockin_rows SET value='$9,757.25, 34.9%',
  updated_by='claude on the CEO''s word, 2026-11-02', updated_at=now()
WHERE month='2026-10' AND section='finances' AND label='Total profit';

UPDATE public.cockpit_goal_sheet_cells SET value=11212.5,
  note='The CEO''s list of 30 Oct: base $8,150 plus Ahmed Abushaiba $3,062.50 ($1,487.50 paid 18 Oct, $1,575 last payment for Alalia, 2 Nov)',
  updated_by='claude on the CEO''s word, 2026-11-02', updated_at=now()
WHERE metric_key='labour' AND day='2026-10-29' AND kind='actual';

-- November
UPDATE public.cockpit_goal_targets
  SET note=replace(note, 'Ahmed''s $1,325 for Alalia (October labour)', 'Ahmed''s $1,575 for Alalia (October labour)')
WHERE plan_id=6 AND metric_key='labour';

INSERT INTO public.cockpit_cost_lines(kind,name,category,billing,seats,unit_price,currency,paid_with,match,status,note,sort,updated_by)
SELECT 'software','Postiz','Social media','monthly',null,49,'USD','Whop card','postiz','active',
  '$49 a month (your call, 2 Nov). October showed a $0 sign-up on 26 Oct.',51,'claude on the CEO''s word, 2026-11-02'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_cost_lines WHERE name='Postiz');

UPDATE public.cockpit_goal_targets SET target=5058,
  note=replace(note, 'Miro one seat $13.96;', 'Miro one seat $13.96, Postiz $49 (2 Nov);')
    || ' Google Workspace stays at October''s $140.09 (€124.21).'
WHERE plan_id=6 AND metric_key='software' AND target=5009;

UPDATE public.cockpit_goal_targets SET target=21303,
  note='$51,605 in, $30,302 out: software $5,058, marketing $4,350, labour $20,895. Processing fees are out.'
WHERE plan_id=6 AND metric_key='profit';

UPDATE public.cockpit_goal_targets SET target=0.413
WHERE plan_id=6 AND metric_key='margin';

COMMIT;
