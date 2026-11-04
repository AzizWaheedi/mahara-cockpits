-- November's plan becomes the CEO's own (30 Oct): $50,000+, projected $51,605, a $10 client lead, 30% lead to booking.

BEGIN;

UPDATE public.cockpit_goal_targets t SET target=v.t, note=v.n
FROM public.cockpit_goal_plans p, (VALUES
  ('spendRetargeting',450,'Your plan: $15 a day. October: $188.'),
  ('spend',3900,'Your plan: $130 a day on average, stepping from $70 to $150. October: $1,498 (about $52 a day).'),
  ('uniqueLinkClicks',6667,NULL),
  ('cpc',0.59,'October, held: $1,498.01 over 2,559 link clicks. Your plan left it to be decided.'),
  ('landingPageConversion',0.031,NULL),
  ('leads',208,'$3,900 at $18.75 a lead.'),
  ('cpl',18.75,'Your plan: $25 an intro × 75%. October: $15.28 on the 98 leads on your sheet, $26.75 on tags.'),
  ('leadToBooked',0.75,'Your plan. October: 61% on your sheet.'),
  ('introsBooked',156,'208 leads booking at 75%.'),
  ('costPerIntroBooked',25,NULL),
  ('introsShown',94,'156 intros showing at 60%.'),
  ('introShowRate',0.6,'Your plan. October 37.7%, September 54.1%. The biggest jump in the plan.'),
  ('costPerIntroShown',41.67,NULL),
  ('demosBooked',66,'70% of 94 intros held book a demo.'),
  ('costPerDemoBooked',59.52,NULL),
  ('introToDemo',0.7,'Your plan. October 43.5% (52% with the 2 who signed on the intro).'),
  ('directDemos',0,'Your plan does not count demos with no held intro. October had 17 of 29, so this is upside.'),
  ('demosShown',46,'66 demos showing at 70%.'),
  ('demoShowRate',0.7,'Your plan. October 53.3%, September 58.8%.'),
  ('costPerDemoShown',85.03,NULL),
  ('offersMade',41,NULL),
  ('offerRate',0.9,'Your plan. October: 14 of 14 live demos in the filed EODs.'),
  ('closes',8,'46 live demos closing at 18%.'),
  ('closeRate',0.18,'Your 20% of offers is 18% of live demos at a 90% offer rate. October: 31.3% of live demos, 5 of 14 offers.'),
  ('newCash',37150,'75% of $49,533 contracted, collected in the month.'),
  ('contracted',49533,'8 clients at $6,000.'),
  ('cashShare',0.75,'Your plan: $4,500 a deal. October''s own deals: 68%.'),
  ('aov',6000,'Your plan. All five October deals were $6,000.'),
  ('roasFrontEnd',8.5,NULL),
  ('roasContracted',12.7,NULL),
  ('cac',472,NULL),
  ('mrrProjected',11333,'The Money tab''s rule, active cards on a Monthly plan, after the six: 7 cards.'),
  ('mrrCollected',9633,'85% of $11,333 MRR due.'),
  ('mrrCollectionRate',0.85,'Your plan. October 48.8%, September 28.4%. The biggest stretch on the back end.'),
  ('upsellCash',4822,'The rest of your $14,455 back-end cash after 85% of $11,333: $4,822 from 2 upsells and split-pay second halves. Your paste cut off before the back-end section, so check this split.'),
  ('totalCash',51605,'Your November plan, 30 Oct: $50,000+, projected $51,605. October: $27,981 on the rails. Type a new number here and the funnel works back from it.'),
  ('totalContracted',54355,NULL),
  ('marketingExpenses',4350,NULL),
  ('labour',14973,'October''s team from your list less Nada: $7,750, plus closer and setter at 15% of $37.2k ($5,573) and $250 on about 6.6 paid-in-full deals ($1,650). Before any new hire.'),
  ('software',5325,'The Costs page''s 44 active software lines, $5,324.74, before any cuts.'),
  ('profit',26957,'$51,605 in, $24,648 out.'),
  ('margin',0.522,NULL),
  ('clientCpl',10,'Your goal: $10. October $13.24; the gate stays $15. Kuwait 1.8% CTR and 12% opt in, Saudi 1.0% and 15%, Qatar 0.5% and 16%.'),
  ('clientCpb',33.33,'$10 a lead over 30% lead to booking.'),
  ('callLeadToBooking',0.3,'Your goal: 30%. October 15.9% (177 of 1,112); 3 of 19 clients reached the 25% line.'),
  ('upsells',2,'Your plan. October 0.'),
  ('clientsChurned',1,'October lost 6 of 21. One is the line to beat.'),
  ('callShowRate',0.6,'The client line; the aim is 70%. October 38.6% of marked.'),
  ('referrals',1,'Your goal: one client from a referral.')
) AS v(k,t,n)
WHERE t.plan_id=p.id AND p.period_from='2026-11-01' AND p.period_to='2026-11-30' AND t.metric_key=v.k;

UPDATE public.cockpit_goal_plans SET
  mission='Mahara Media to $100,000 a month.',
  headline='Collect $50,000+, projected $51,605: 8 to 9 deals on $3,900 of lead-gen spend, 85% of MRR collected, clients at a $10 lead and 30% lead to booking.'
WHERE period_from='2026-11-01' AND period_to='2026-11-30';

UPDATE public.cockpit_goal_targets t SET target=v.t, note=v.n FROM public.cockpit_goal_plans p, (VALUES
 ('cac',527,'Your plan: all ad spend, $4,350, over 8.26 deals. October $337.'),
 ('roasContracted',11.4,'Your plan: contracted over all ad spend. October 17.8×.'),
 ('totalContracted',65833,'Your plan: $49,533 on new deals plus back-end value. The back-end part of your paste was cut off, so the $16,300 is taken as given.')
) AS v(k,t,n) WHERE t.plan_id=p.id AND p.period_from='2026-11-01' AND t.metric_key=v.k;

COMMIT;
