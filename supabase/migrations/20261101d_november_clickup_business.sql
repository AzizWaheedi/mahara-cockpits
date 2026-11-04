-- The CEO, 1 Nov: ClickUp moves to Business (yearly), not Unlimited, because
-- Unlimited's 1,000 automation actions a month is below October's use.

UPDATE public.cockpit_goal_targets SET target=4776,
  note=replace(note,'ClickUp Unlimited 9 × $12 = $108','ClickUp Business 9 × $17 yearly = $153 (Unlimited''s 1,000 automation actions a month is too few: 471 runs in October)')
WHERE plan_id=6 AND metric_key='software' AND note LIKE '%ClickUp Unlimited 9 × $12 = $108%';

UPDATE public.cockpit_goal_targets SET target=21584,
  note='$51,605 in, $30,021 out: software $4,776, marketing $4,350, labour $20,895. Processing fees are out.'
WHERE plan_id=6 AND metric_key='profit';

UPDATE public.cockpit_goal_targets SET target=0.418
WHERE plan_id=6 AND metric_key='margin';
