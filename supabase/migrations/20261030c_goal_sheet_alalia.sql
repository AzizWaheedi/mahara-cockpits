-- Alalia.co's $3,494.88 of 28 Oct was logged on the CEO's word with its statement.
-- It is the $3,500 the lock-in had no rail for, and it moves October's own deals to
-- 68% up front, so November's plan is worked again from the same goal.

BEGIN;

UPDATE public.cockpit_goal_targets t SET target=v.t, note=v.n
FROM public.cockpit_goal_plans p, (VALUES
  ('spendRetargeting',288,'October''s share of lead-gen spend: 12.6% ($188.23 on $1,497.90).'),
  ('spend',2285,NULL),
  ('uniqueLinkClicks',3906,NULL),
  ('cpc',0.59,'October, held: $1,498.01 over 2,559 link clicks.'),
  ('landingPageConversion',0.039,NULL),
  ('leads',152,'$2,285 at $15 a lead.'),
  ('cpl',15,'The official gate. October read $26.75 on tagged leads, $15.28 on the 98 leads on your sheet, $10.93 on the dashboard''s 137.'),
  ('leadToBooked',0.6,'Your sheet''s October: 60 intros from 98 leads (61%). The tag rate (82.1%) likely reads high: setters tag by hand and 83 contacts have no tag. $15 at 60% is $25 an intro; October paid $24.56.'),
  ('introsBooked',91,'152 leads booking at 60%.'),
  ('costPerIntroBooked',25,NULL),
  ('introsShown',46,'91 intros showing at 50%.'),
  ('introShowRate',0.5,'October 37.7% (23 of 61 due, B2B and the cockpit agree). Halfway to the 60% in October''s plan.'),
  ('costPerIntroShown',50,NULL),
  ('demosBooked',41,'52% of 46 intros held book a demo, plus 17 booked straight from a lead.'),
  ('costPerDemoBooked',56.06,NULL),
  ('introToDemo',0.52,'October: 12 of 23 held intros went on, 10 to a demo and 2 signed on the intro.'),
  ('directDemos',17,'October''s count held flat: 17 of the 29 leads who booked a demo had no held intro. Not in your outline; the plan needs it or it would ask for twice the leads.'),
  ('demosShown',26,'41 demos showing at 65%.'),
  ('demoShowRate',0.65,'October 53.3% (16 of 30 due). Halfway to the 75% in October''s plan.'),
  ('costPerDemoShown',86.24,NULL),
  ('offersMade',24,NULL),
  ('offerRate',0.9,'Every live demo in the 10 filed sales EODs got an offer (14 of 14). 90% allows for the unqualified ones. Your sheet''s 24 offers on 12 shown cannot be used.'),
  ('closes',8,'26 live demos closing at 30%.'),
  ('closeRate',0.3,'October 31.3% (5 of 16 live demos), rounded down.'),
  ('newCash',32434,'68% of $47,696 contracted, collected in the month.'),
  ('contracted',47696,'8 clients at $6,000.'),
  ('cashShare',0.68,'Cash on October''s own deals: $20,356 of $30,000 (68%), with Alalia''s $3,494.88 of 28 Oct. The Cash collected actual also counts earlier deals'' remainders ($4,021 in October), so it will read above this.'),
  ('aov',6000,'All five October deals were $6,000, confirmed in B2B''s closed_deals.'),
  ('roasFrontEnd',12.6,NULL),
  ('roasContracted',20.9,NULL),
  ('cac',287,NULL),
  ('mrrProjected',11333,'The Money tab''s rule, active cards on a Monthly plan, after the five: 7 cards. October was $14,999 on 9; Joe and Sera and Arcturus come off. Split-pay second halves are upside: منشآت خالدة $3,000 on 14 Nov.'),
  ('mrrCollected',7366,'65% of $11,333 MRR due.'),
  ('mrrCollectionRate',0.65,'October 48.8% ($7,321 of $14,999), September 28.4%. October''s plan asked 80%; this is a step toward it.'),
  ('upsellCash',3500,'The SEO/GEO add-on in Ocean Home''s proposal: $13,500 against $10,000 for the six months alone. It has not been sent.'),
  ('totalCash',43300,'The goal: the $43,300 October''s own plan set and did not reach ($27,981 on the rails by 29 Oct). Type a new number here and the funnel works back from it.'),
  ('totalContracted',51196,NULL),
  ('marketingExpenses',2573,NULL),
  ('labour',14115,'October''s team from your list less Nada: $7,750 (the new media buyer at his October $250). Ahmed Abushaiba at 15% of $32.4k new cash ($4,865) and $250 on 6 paid-in-full deals ($1,500). No bonus for you, the CSM, media or creative is priced.'),
  ('software',5325,'The Costs page''s 44 active software lines, $5,324.74, usage lines at their estimate. The bank statement stops at 2 Oct, so it cannot check this month.'),
  ('profit',21287,'$43,300 in, $22,013 out.'),
  ('margin',0.492,NULL),
  ('clientCpl',15,'The official gate. October $13.24.'),
  ('clientCpb',60,'$15 a lead over 25% lead to booking.'),
  ('callLeadToBooking',0.25,'The official line: $15 at 25% is the $60 booking. October 15.9% (177 of 1,112); 3 of 19 clients reached it.')
) AS v(k,t,n)
WHERE t.plan_id=p.id AND p.period_from='2026-11-01' AND p.period_to='2026-11-30' AND t.metric_key=v.k;

UPDATE public.cockpit_goal_plans SET headline='Collect $43,300, the number October set and did not reach on the rails: 8 deals from 152 leads on $2,285 of lead-gen spend, keep about $21,300.'
WHERE period_from='2026-11-01' AND period_to='2026-11-30';

UPDATE public.cockpit_goal_lockin_rows SET value='$27,980.62',source='Every payment on the rails, 1 to 29 Oct: by hand $15,906.16 (Alalia''s $3,494.88 of 28 Oct among them, statement in hand), Whop $10,050, Tap $2,021.20, Ecom $3.26. $24,377.36 is on signed deals, $3,600 on existing clients.',leaves_out='Other bank transfers since 2 Oct not logged by hand. Your sheet also has $2,000 on 29 Oct with no rail.', updated_by='claude on the CEO''s word, 2026-10-30', updated_at=now() WHERE month='2026-10' AND section='finances' AND label='Total new cash';
UPDATE public.cockpit_goal_lockin_rows SET value='$10,807.25, 38.6%',source='Total new cash less the three lines above.',leaves_out='Processing fees and refunds.', updated_by='claude on the CEO''s word, 2026-10-30', updated_at=now() WHERE month='2026-10' AND section='finances' AND label='Total profit';
UPDATE public.cockpit_goal_lockin_rows SET leaves_out='Ahmed''s $2,012.50 is his message of 18 Oct ($1,487.50 for 7 to 18 Oct, on a Ziina link rather than Whop, paid by your word and including $187.50 old pending and a $250 bonus) plus $525, your 15% of Alalia''s $3,500 still owed ($524.23 on the exact $3,494.88). The Money tab credits him $18,263 in October, more cash than those commissions cover. The Costs page''s roster still shows older pay for five people.', updated_by='claude on the CEO''s word, 2026-10-30', updated_at=now() WHERE month='2026-10' AND section='finances' AND label='Labour expenses';
COMMIT;
