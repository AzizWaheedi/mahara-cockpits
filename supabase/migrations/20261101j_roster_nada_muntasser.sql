-- The CEO, 1 Nov: Nada left on 25 Oct, the new editor is Muntasser, and the
-- setter is not hired yet. The roster's trigger audits each change and pay
-- history takes Muntasser's $800 from 1 Nov. The setter stays a plan line
-- only: nobody to put on the roster.

BEGIN;

SELECT set_config('cockpit.pay_effective_from','2026-11-01',true),
       set_config('cockpit.pay_source','CEO, 1 Nov',true);

UPDATE public.cockpit_people SET active=false, ended_on='2026-10-25',
  note='Left 25 Oct (the CEO, 1 Nov).', updated_at=now()
WHERE id=19 AND name='Nada Al Saed';

INSERT INTO public.cockpit_people (name, role, engagement, active, monthly_cost, currency,
  commission_basis, is_sales, started_on, note, source, added_by)
SELECT 'Muntasser', 'Video editor', 'staff', true, 800, 'USD', 'none', false, '2026-11-01',
  'Editor for Mahara reels, $800 from 1 Nov (the CEO, 1 Nov).', 'manual', 'claude on the CEO''s word'
WHERE NOT EXISTS (SELECT 1 FROM public.cockpit_people WHERE name='Muntasser');

UPDATE public.cockpit_goal_lockin_rows
  SET source=replace(source, 'Nada $400 (left mid-month)', 'Nada $400 (left 25 Oct)'),
      updated_by='claude on the CEO''s word, 2026-11-01', updated_at=now()
WHERE month='2026-10' AND section='finances' AND label='Labour expenses';

UPDATE public.cockpit_goal_targets
  SET note=replace(replace(note,
    'new editor $800 (Mahara reels)', 'Muntasser $800 (editor, Mahara reels)'),
    'setter $600', 'setter $600 (not hired yet)')
WHERE plan_id=6 AND metric_key='labour';

COMMIT;
