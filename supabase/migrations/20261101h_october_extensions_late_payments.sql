-- The CEO, 1 Nov: log October's extensions and late payments beside the
-- churned clients on the October lock-in. Two new sections, 'extensions' and
-- 'late_payments' (goalsLockIn.tsx). Late means due on the card and unpaid on
-- 1 Nov: no Whop or Tap charge and no payment logged by hand since the due
-- day. A bank transfer shows only if someone logged it.

INSERT INTO public.cockpit_goal_lockin_rows(month,section,sort,label,value,status,source,leaves_out,client_task_id,answers,updated_by)
VALUES
  ('2026-10','extensions',1,'Liwan Limited Construction and Finishing Of Buildings','2 weeks, 15 Oct to 2 Nov','measured',
   'Your extension of 19 Oct, logged on the billing page; the card reads 2 weeks and next payment 2 Nov.',
   'Not on the Extension form, which has no real response yet.','86ewvnqj5',
   '{"why":"Ad account broke, on our side.","next":"$1,333 falls due 2 Nov. The term ended 9 Oct with no renewal on the card."}'::jsonb,
   'claude on the CEO''s word, 2026-11-01'),
  ('2026-10','extensions',2,'Marble and more','2 weeks, 19 Oct to 2 Nov','measured',
   'Your extension of 19 Oct, logged on the billing page; the card reads 2 weeks.',
   'The client churned the same day; the extension did not keep them.','86eymcqdq',
   '{"why":"Issue with the ad account, on our side.","next":"Churned 19 Oct. The $2,000 refund ask is open."}'::jsonb,
   'claude on the CEO''s word, 2026-11-01'),
  ('2026-10','extensions',3,'ARCWANI',NULL,'missing',
   'Named as an extension by you on 30 Oct.',
   'No dates or weeks anywhere: not on the billing page, the billing sheet, the Extension form or the card, so the card''s term and next payment did not move.','86ey8w5m1',
   '{}'::jsonb,'claude on the CEO''s word, 2026-11-01'),
  ('2026-10','extensions',4,'نهوض نجد',NULL,'missing',
   'Named as an extension by you on 30 Oct.',
   'No dates or weeks anywhere: not on the billing page, the billing sheet, the Extension form or the card, so the card''s term and next payment did not move.','86ex4m5ux',
   '{}'::jsonb,'claude on the CEO''s word, 2026-11-01'),

  ('2026-10','late_payments',1,'ARCWANI','$3,000 due 28 Sep, 34 days late','partial',
   'The card''s next payment; nothing on Whop, Tap or logged by hand since. The client said it was unpaid on 22 and 28 Oct.',
   'You named an extension for ARCWANI with no dates; if it moved this payment, the lateness is less.','86ey8w5m1',
   '{}'::jsonb,'claude on the CEO''s word, 2026-11-01'),
  ('2026-10','late_payments',2,'نهوض نجد','$700 due 7 Oct, 25 days late','partial',
   'The card''s next payment; last paid $735 on Whop on 22 Sep, nothing since.',
   'You named an extension with no dates; if it moved this payment, the lateness is less.','86ex4m5ux',
   '{}'::jsonb,'claude on the CEO''s word, 2026-11-01'),
  ('2026-10','late_payments',3,'Castello Industries','$2,000 due 8 Oct, 24 days late','partial',
   'The card''s next payment; nothing on Whop, Tap or logged by hand since. The CSM on 24 Oct: they want to pay the remaining amount only.',
   'A bank transfer shows only if someone logged it.','86eynfnv5',
   '{}'::jsonb,'claude on the CEO''s word, 2026-11-01'),
  ('2026-10','late_payments',4,'Safad Consultant Engineering','$1,300 due 27 Oct, 5 days late','partial',
   'The card''s next payment; last paid $1,300 on Whop on 4 Oct, nothing since.',
   'A bank transfer shows only if someone logged it.','86ewvnqgz',
   '{}'::jsonb,'claude on the CEO''s word, 2026-11-01'),
  ('2026-10','late_payments',5,'Arcturus Construction','$2,000 due 3 Oct, never paid (churned)','partial',
   'The card''s next payment; nothing on the rails since. Counted as churned on 29 Oct for non-payment.',
   'Whether to chase it or write it off is not recorded.','86eyqx2f6',
   '{}'::jsonb,'claude on the CEO''s word, 2026-11-01'),
  ('2026-10','late_payments',6,'Joe and Sera Company','$1,666 due 24 Sep, never paid (churned)','partial',
   'The card''s next payment; nothing on the rails since. Counted as churned on 29 Oct for non-payment.',
   'Whether to chase it or write it off is not recorded.','86ewvnqjb',
   '{}'::jsonb,'claude on the CEO''s word, 2026-11-01')
ON CONFLICT (month, section, label) DO NOTHING;
