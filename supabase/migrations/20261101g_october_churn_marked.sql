-- The CEO, 1 Nov: log October's churned clients and mark them, form and exit
-- call or not. The six were already on the churn register (20261030b). Their
-- ClickUp cards now read Client Status Stopped with the register's date,
-- reason and Churn Type "Mid-programme loss" (set by hand on 1 Nov; ClickUp's
-- own automation had dated Atlantis 31 Oct, corrected to 18 Oct). This file
-- brings the October lock-in's wording in line.

UPDATE public.cockpit_goal_lockin_rows
SET source = replace(source, 'ClickUp reads Active', 'ClickUp Stopped 1 Nov on your word, no form or exit call'),
  updated_by = 'claude on the CEO''s word, 2026-11-01', updated_at = now()
WHERE month = '2026-10' AND section = 'churned' AND source LIKE '%ClickUp reads Active%';

UPDATE public.cockpit_goal_lockin_rows
SET leaves_out = replace(leaves_out, 'ClickUp still reads Active.', 'ClickUp Stopped 1 Nov on your word, no form or exit call.'),
  updated_by = 'claude on the CEO''s word, 2026-11-01', updated_at = now()
WHERE month = '2026-10' AND section = 'churned' AND leaves_out LIKE '%ClickUp still reads Active.%';

UPDATE public.cockpit_churn_departures
SET note = note || ' Marked Stopped in ClickUp on 1 Nov on the CEO''s word, without the termination form or exit call.',
  updated_by = 'claude on the CEO''s word, 2026-11-01', updated_at = now()
WHERE clickup_task_id IN ('86eymcqdq','86eypmbp3','86eyqx2f6','86ewvnqjb') AND removed_at IS NULL
  AND note NOT LIKE '%Marked Stopped in ClickUp on 1 Nov%';
