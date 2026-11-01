-- The CEO, 1 Nov: Abdelaziz is $250 for November.
UPDATE public.cockpit_goal_targets
SET note=replace(note,'Abdelaziz $250 (carried from October)','Abdelaziz $250 (your call, 1 Nov)')
WHERE plan_id=6 AND metric_key='labour' AND note LIKE '%Abdelaziz $250 (carried from October)%';
