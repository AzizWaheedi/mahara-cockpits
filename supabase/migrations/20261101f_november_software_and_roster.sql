-- The CEO, 1 Nov: November's software calls (GoGHL 25 accounts; Typeform,
-- Hubstaff, Make, Proton and Vercel's seat kept; Miro one seat; OpenAI one $200
-- Codex plan; Zapier, Convex, Cursor cancelled; ManyChat $29 and GoDaddy on the
-- personal brand) on the plan and the Costs page, and the roster at the pay on
-- his list of 30 Oct and 1 Nov. Every change here is audited by its table's
-- trigger; pay history takes effect from 1 Nov.

BEGIN;

SELECT set_config('cockpit.pay_effective_from','2026-11-01',true),
       set_config('cockpit.pay_source','CEO list, 30 Oct and 1 Nov',true);

-- The plan
UPDATE public.cockpit_goal_targets SET target=5009,
  note='October billed $5,277 on the CBK card and Whop. November uses your calls of 1 Nov: Claude $600, OpenAI one Codex plan $200, ClickUp Business $175 (sales and call centre are not on it), GoGHL 25 accounts × $19 = $475, Vercel about $65 (seat kept, the heavy feature off), Miro one seat $13.96; Typeform $79, Make $64.71, Hubstaff $45 and Proton $12.99 kept; Zapier, Convex and Cursor cancelled; ManyChat ($29) and GoDaddy ($25.70 one-off) on your personal brand. Every other tool at October''s charge. Each line is on the Costs page.'
WHERE plan_id=6 AND metric_key='software';

UPDATE public.cockpit_goal_targets SET target=21352,
  note='$51,605 in, $30,253 out: software $5,009, marketing $4,350, labour $20,895. Processing fees are out.'
WHERE plan_id=6 AND metric_key='profit';

UPDATE public.cockpit_goal_targets SET target=0.414
WHERE plan_id=6 AND metric_key='margin';

-- The Costs page: November's projection, line by line
UPDATE public.cockpit_cost_lines AS c SET seats=v.seats, unit_price=v.price, billing=v.billing, status=v.status,
  name=coalesce(v.name,c.name), note=v.note, updated_by='claude on the CEO''s word, 2026-11-01', updated_at=now()
FROM (VALUES
  (1,  null::numeric, 782.43::numeric, 'usage',   'active',    null::text, 'October billed $782.43; November assumes the same.'),
  (4,  null, 817.77, 'usage',   'active',    null, 'October billed $817.77 on both cards; November assumes the same.'),
  (5,  25,   19,     'monthly', 'active',    null, '25 accounts at $19 (your call, 1 Nov). Each new client adds one.'),
  (7,  null, 40,     'usage',   'active',    null, 'October: $40 of auto-recharges.'),
  (8,  1,    20,     'monthly', 'cancelled', null, 'OpenAI is one $200 Codex plan from November (your call, 1 Nov).'),
  (9,  1,    200,    'monthly', 'active',    'OpenAI Codex', 'One $200 Codex plan (your call, 1 Nov). October billed $220.'),
  (10, null, 600,    'monthly', 'active',    null, '$600 a month (your call). October billed $602.31.'),
  (11, 7,    25,     'monthly', 'active',    null, 'Business, $175 (your call, 1 Nov): the sales team and call centre are not on ClickUp. Unlimited allows 1,000 automation actions a month, too few for October''s 471 runs.'),
  (12, null, 140.09, 'monthly', 'active',    null, 'October billed $140.09.'),
  (17, null, 102.08, 'monthly', 'active',    null, 'October billed $102.08.'),
  (19, null, 69.17,  'usage',   'cancelled', null, 'Cancelled (your call, 1 Nov).'),
  (20, null, 64.71,  'monthly', 'active',    null, 'Kept as it is (your call, 1 Nov).'),
  (22, null, 45,     'monthly', 'active',    null, 'Kept (your call, 1 Nov).'),
  (26, null, 29.99,  'monthly', 'cancelled', null, 'Cancelled (your call, 1 Nov).'),
  (30, null, 50.83,  'monthly', 'active',    null, 'October billed $50.83.'),
  (32, null, 20.20,  'monthly', 'active',    null, 'October billed $20.20.'),
  (33, 1,    20,     'monthly', 'cancelled', null, 'Cancelled (your call, 1 Nov).'),
  (34, null, 65,     'usage',   'active',    null, 'Pro $20, one extra seat $20 (kept) and about $25 of usage now the heavy feature is off. October''s cycle reached $71.83 by 31 Oct.'),
  (36, null, 43.04,  'monthly', 'active',    null, 'October billed $43.04.'),
  (39, 1,    12.99,  'monthly', 'active',    null, 'Kept (your call, 1 Nov).'),
  (16, null, 79,     'monthly', 'active',    null, 'Kept on its plan for now (your call, 1 Nov).'),
  (45, 1,    13.96,  'monthly', 'active',    null, 'One seat from November (your call, 1 Nov); October billed $27.92 for two.'),
  (47, null, 29,     'monthly', 'paused',    null, 'Personal brand from November, $29 (your call, 1 Nov). Kept out of Mahara''s costs.')
) AS v(id,seats,price,billing,status,name,note)
WHERE c.id=v.id;

INSERT INTO public.cockpit_cost_lines(kind,name,category,billing,seats,unit_price,currency,paid_with,match,status,note,sort,updated_by)
VALUES
  ('software','Surfshark','Security','monthly',1,22.04,'USD','Whop card','surfshark','active','October billed $22.04.',47,'claude on the CEO''s word, 2026-11-01'),
  ('software','Frame.io','Video','monthly',1,15,'USD','Whop card','frame.io','active','October billed $15.',48,'claude on the CEO''s word, 2026-11-01'),
  ('software','Cloudflare','Hosting','monthly',null,5,'USD','Whop card','cloudflare','active','October billed $5.',49,'claude on the CEO''s word, 2026-11-01'),
  ('software','GoDaddy','Domains','yearly',null,25.70,'USD','Whop card','godaddy','cancelled','A one-off $25.70 in October for your personal brand (your call, 1 Nov). Filed there, not in Mahara''s costs.',50,'claude on the CEO''s word, 2026-11-01');

-- The roster: base pay from 1 Nov
UPDATE public.cockpit_people AS p SET monthly_cost=v.pay
FROM (VALUES (11,800::numeric),(12,900),(7,900),(18,800),(21,800),(29,250)) AS v(id,pay)
WHERE p.id=v.id;

UPDATE public.cockpit_people SET note='Replaces Nada on media buyer meetings from 2026-10-20. $250 a month (your call, 1 Nov).'
WHERE id=29;

COMMIT;
