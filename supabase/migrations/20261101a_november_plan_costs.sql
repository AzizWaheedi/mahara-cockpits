-- The CEO, 1 Nov: November's plan carries his software cuts, the marketing
-- plan and the new pay plans (setter, closer, new editor, Karim at $800).
-- Plan 6 stays a draft. The goal-target trigger writes the audit rows.

BEGIN;

UPDATE public.cockpit_goal_targets SET target=4731,
  note='October billed $5,277 on the CBK card and Whop. November uses your calls of 1 Nov: Claude $600, OpenAI $200, ClickUp Unlimited 9 × $12 = $108, GoGHL 21 slots × $19 = $399 (15 active, 3 onboarding, 3 own), Vercel about $65, Typeform Basic $39, Make $32, Miro about $10; Hubstaff, Zapier, Proton, Convex and Cursor cut; GoDaddy and ManyChat ($29) moved to the personal brand; DeepSeek, Hostinger and Atlassian kept. Each new client adds $19 of GoGHL. Vercel and Miro are estimates.'
WHERE plan_id=6 AND metric_key='software';

UPDATE public.cockpit_goal_targets SET
  note='$3,900 lead gen plus $450 Hammer Them. $150 a day all month would be $4,950. October: $1,832 billed on the cards ($1,686 Meta-reported to 29 Oct), all Meta.'
WHERE plan_id=6 AND metric_key='marketingExpenses';

UPDATE public.cockpit_goal_targets SET target=20895,
  note='Bases $9,150: Rasem $2,000, Lama $900, Daniya $900, Karim $800, Sabry $800, Muhammed $800, new editor $800 (Mahara reels), Ahmed Seediq $700, Ali $600, setter $600, Abdelaziz $250 (carried from October). On 8 deals and $37,150 new cash: setter 5% $1,858 + $250; closer 10% $3,715 + 4 PIF × $250 + $500 + $250 at 75% UF; CSM $2,182 (retention $1,000, 10% of $4,822 upsell, referral, 2 testimonials, 2 reviews); call centre $1,590 (198 shown × $5, 30 closes × $20); media buyer and creative $200 each at a $10 CPL. Leaves out the closer''s 15% on October balances, renewals, systems bonuses and Ahmed''s $975 (October labour). Ten deals: about $22,720.'
WHERE plan_id=6 AND metric_key='labour';

UPDATE public.cockpit_goal_targets SET target=21629,
  note='$51,605 in, $29,976 out: software $4,731, marketing $4,350, labour $20,895. Processing fees are out.'
WHERE plan_id=6 AND metric_key='profit';

UPDATE public.cockpit_goal_targets SET target=0.419
WHERE plan_id=6 AND metric_key='margin';

COMMIT;
