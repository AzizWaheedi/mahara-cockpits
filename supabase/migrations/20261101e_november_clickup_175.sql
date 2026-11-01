-- The CEO, 1 Nov: ClickUp Business comes to $175, because the sales team and
-- call centre are not on ClickUp.

UPDATE public.cockpit_goal_targets SET target=4798,
  note=replace(note,'ClickUp Business 9 × $17 yearly = $153','ClickUp Business $175 (your figure, 1 Nov: the sales team and call centre are not on ClickUp)')
WHERE plan_id=6 AND metric_key='software' AND note LIKE '%ClickUp Business 9 × $17 yearly = $153%';

UPDATE public.cockpit_goal_targets SET target=21562,
  note='$51,605 in, $30,043 out: software $4,798, marketing $4,350, labour $20,895. Processing fees are out.'
WHERE plan_id=6 AND metric_key='profit';

UPDATE public.cockpit_goal_targets SET target=0.418
WHERE plan_id=6 AND metric_key='margin';
