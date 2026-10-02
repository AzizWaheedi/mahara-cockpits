-- The software sheet's first lines (2026-10-02), from September 2026's real
-- charges on the CBK card ending 4348 (statement PDF, 1 Sep to 2 Oct) and the
-- USD card (CSV export), checked against Aziz's own software sheet
-- (183zGLw7V…, its August actuals and target actions). Seat counts marked
-- "a guess" are read from the amount; usage lines carry September's level.
-- 46 paying lines, $6,189.97 a month; ManyChat is paused until it is known
-- whether it was cancelled. Runs only on an empty sheet.

begin;

insert into public.cockpit_cost_lines (kind, name, category, billing, seats, unit_price, currency, paid_with, match, status, note, sort, updated_by)
select * from (values
  ('software', 'Maqsam', 'Call centre', 'usage', null, 901.42, 'USD', 'CBK card 4348', 'maqsam', 'active', 'Usage: four top-ups in September ($1,343.34 over six in August). Your sheet: usage, about $1,200.', 0, 'seed 20261002c'),
  ('software', 'Viktor', 'AI', 'monthly', null, 400, 'USD', 'CBK card 4348', 'viktor', 'active', 'The plan, renewed 3 Sep. Your sheet: keep, $500 with top-ups.', 1, 'seed 20261002c'),
  ('software', 'Viktor top-ups', 'AI', 'usage', null, 465.23, 'USD', 'CBK and USD cards', 'viktor', 'active', 'Top-ups on both cards in September.', 2, 'seed 20261002c'),
  ('software', 'Higgsfield', 'AI', 'usage', null, 860, 'USD', 'CBK and USD cards', 'higgsfield', 'active', 'Plan plus credit packs, on both cards. Your sheet: downgrade, $804.', 3, 'seed 20261002c'),
  ('software', 'GoGHL', 'CRM', 'monthly', null, 532, 'USD', 'USD card', null, 'active', 'On the USD card since September (CBK in July and August). Your sheet: keep.', 4, 'seed 20261002c'),
  ('software', 'GoHighLevel Agency', 'CRM', 'monthly', null, 497, 'USD', 'CBK card 4348', 'highlevel', 'active', '$497 looks like the Agency Pro price (a guess). Your sheet: keep, $617 with the wallet.', 5, 'seed 20261002c'),
  ('software', 'GoHighLevel wallet', 'CRM', 'usage', null, 90, 'USD', 'CBK card 4348', 'highlevel', 'active', 'Nine $10 auto-recharges in September, twelve in August.', 6, 'seed 20261002c'),
  ('software', 'ChatGPT Plus', 'AI', 'monthly', 1, 20, 'USD', 'USD card', null, 'active', 'One seat, on the USD card. A second $20 came on 1 Oct: check whether there are two plans.', 7, 'seed 20261002c'),
  ('software', 'OpenAI API', 'AI', 'usage', null, 393.68, 'USD', 'USD card', null, 'active', 'API credit, a guess from the amounts ($100, $103.68, $90, $100). Your sheet had OpenAI at $30.', 8, 'seed 20261002c'),
  ('software', 'Claude (Anthropic)', 'AI', 'monthly', null, 400.12, 'USD', 'USD card', null, 'active', 'Three plans: $200 on 9 Sep, then $100.00 and $100.12 on 17 Sep, 50 minutes apart. One may be a duplicate. Your sheet: trim, $305.', 9, 'seed 20261002c'),
  ('software', 'ClickUp', 'Projects', 'monthly', 8, 29, 'USD', 'CBK and USD cards', 'clickup', 'active', 'Eight seats is a guess from $232; a ninth ($26.10) is pending on 1 Oct. The CBK renewal failed. Your sheet: downgrade (10 x $29 in August).', 10, 'seed 20261002c'),
  ('software', 'Google Workspace', 'Email and docs', 'monthly', null, 164.35, 'USD', 'CBK card 4348', 'google', 'active', 'Billed in EUR (141.51 in September); the seat count is not readable from the amount. Your sheet: downgrade.', 11, 'seed 20261002c'),
  ('software', 'Roasform', 'Forms', 'monthly', null, 99, 'USD', 'CBK card 4348', 'roasform', 'active', 'Your sheet: your call.', 12, 'seed 20261002c'),
  ('software', 'Wistia', 'Video', 'monthly', null, 99, 'USD', 'USD card', 'wistia', 'active', 'Does the same job as Vidalytics. Your sheet: keep.', 13, 'seed 20261002c'),
  ('software', 'Vidalytics', 'Video', 'monthly', null, 79, 'USD', 'CBK card 4348', 'vidalytics', 'active', 'Does the same job as Wistia. Your sheet: your call.', 14, 'seed 20261002c'),
  ('software', 'Typeform', 'Forms', 'monthly', null, 79, 'USD', 'CBK card 4348', 'typeform', 'active', 'One account in September (two in August). Your sheet: consolidate.', 15, 'seed 20261002c'),
  ('software', 'Slack', 'Communication', 'monthly', 9, 8.75, 'USD', 'USD card', null, 'active', 'Nine seats is a guess from $81.29 (sixteen in August). Your sheet: downgrade.', 16, 'seed 20261002c'),
  ('software', 'Fathom', 'Call recording', 'monthly', 4, 18, 'USD', 'USD card', null, 'active', 'Four seats is a guess from $72 (seven in August). Your sheet: downgrade.', 17, 'seed 20261002c'),
  ('software', 'Convex', 'Hosting', 'usage', null, 69.17, 'USD', 'CBK card 4348', 'convex', 'active', 'Usage billing: four charges, 16 to 23 Sep. Not in your sheet.', 18, 'seed 20261002c'),
  ('software', 'Make', 'Automation', 'monthly', null, 64.71, 'USD', 'CBK card 4348', 'make.com', 'active', 'Your sheet: keep.', 19, 'seed 20261002c'),
  ('software', 'Leadsie', 'Client onboarding', 'monthly', null, 59, 'USD', 'CBK card 4348', 'leadsie', 'active', 'New since 29 Aug. Not in your sheet.', 20, 'seed 20261002c'),
  ('software', 'Hubstaff', 'Time tracking', 'monthly', null, 45, 'USD', 'CBK card 4348', 'hubstaff', 'active', 'Possibly 5 seats at $9 (a guess). Your sheet: keep.', 21, 'seed 20261002c'),
  ('software', 'Hostinger', 'Hosting', 'monthly', null, 42.99, 'USD', 'CBK card 4348', 'hostinger', 'active', 'One charge in September (two in August). Your sheet: consolidate.', 22, 'seed 20261002c'),
  ('software', 'Kit', 'Email marketing', 'monthly', null, 39, 'USD', 'CBK card 4348', 'kit.com', 'active', 'Your sheet: keep.', 23, 'seed 20261002c'),
  ('software', 'Whapi.Cloud', 'WhatsApp', 'monthly', 1, 35, 'USD', 'CBK card 4348', 'whapi', 'active', 'One channel (a guess). Your sheet: keep.', 24, 'seed 20261002c'),
  ('software', 'Zapier', 'Automation', 'monthly', null, 29.99, 'USD', 'CBK card 4348', 'zapier', 'active', 'On your cancel list (Make covers it) and still billing. The cockpit filed it as a bank fee until 2 Oct.', 25, 'seed 20261002c'),
  ('software', 'Apify', 'Scraping', 'monthly', null, 29, 'USD', 'CBK card 4348', 'apify', 'active', 'Your sheet: keep.', 26, 'seed 20261002c'),
  ('software', 'Skool', 'Community', 'monthly', 3, 9, 'USD', 'CBK card 4348', 'skool', 'active', 'Three $9 charges: three groups or memberships (a guess). Your sheet: keep.', 27, 'seed 20261002c'),
  ('software', 'Nabarati', 'AI', 'monthly', null, 25, 'USD', 'USD card', 'nabarati', 'active', 'Arabic voice tool (a guess). Your sheet: keep.', 28, 'seed 20261002c'),
  ('software', 'Supabase', 'Hosting', 'monthly', null, 25, 'USD', 'USD card', null, 'active', 'Pro plan, per organisation. Not in your sheet.', 29, 'seed 20261002c'),
  ('software', 'Windsor.ai', 'Ad data', 'monthly', null, 23, 'USD', 'CBK card 4348', 'windsor', 'active', 'Your sheet: keep.', 30, 'seed 20261002c'),
  ('software', 'Obsidian', 'Notes', 'monthly', null, 20, 'USD', 'USD card', null, 'active', 'Sync or Publish (a guess). Not in your sheet.', 31, 'seed 20261002c'),
  ('software', 'Cursor', 'AI', 'monthly', 1, 20, 'USD', 'USD card', null, 'active', 'Pro, one seat. Not in your sheet.', 32, 'seed 20261002c'),
  ('software', 'Vercel', 'Hosting', 'monthly', 1, 20, 'USD', 'USD card', null, 'active', 'Pro, one seat. Not in your sheet.', 33, 'seed 20261002c'),
  ('software', 'Atlassian', 'Projects', 'monthly', null, 18, 'USD', 'CBK card 4348', 'atlassian', 'active', 'On your cancel list and still billing: charged 27 Sep.', 34, 'seed 20261002c'),
  ('software', 'Zoom', 'Communication', 'monthly', 1, 16.99, 'USD', 'CBK card 4348', 'zoom', 'active', 'One licence in September (four in August). Your sheet: downgrade.', 35, 'seed 20261002c'),
  ('software', 'Wispr Flow', 'AI', 'monthly', 1, 15, 'USD', 'CBK card 4348', 'wispr', 'active', 'Your sheet: keep.', 36, 'seed 20261002c'),
  ('software', 'Brain.fm', 'Focus', 'monthly', 1, 14.99, 'USD', 'CBK card 4348', 'brain.fm', 'active', 'On your cancel list and still billing: charged 27 Sep.', 37, 'seed 20261002c'),
  ('software', 'Proton', 'Email and security', 'monthly', 1, 12.99, 'USD', 'CBK card 4348', 'proton', 'active', 'Your sheet: keep.', 38, 'seed 20261002c'),
  ('software', 'Elfsight', 'Website', 'monthly', null, 12, 'USD', 'CBK card 4348', 'elfsigh', 'active', 'Billed through Paddle. Your sheet: keep.', 39, 'seed 20261002c'),
  ('software', 'Pitch', 'Decks', 'monthly', 1, 12, 'USD', 'CBK card 4348', 'pitch', 'active', 'On your cancel list (Gamma stays) and still billing.', 40, 'seed 20261002c'),
  ('software', 'Gamma', 'Decks', 'monthly', 1, 12, 'USD', 'USD card', 'gamma', 'active', 'Your sheet: keep.', 41, 'seed 20261002c'),
  ('software', 'Dropbox', 'Storage', 'monthly', 1, 11.99, 'USD', 'CBK card 4348', 'dropbox', 'active', 'Your sheet: keep.', 42, 'seed 20261002c'),
  ('software', 'DeepSeek API', 'AI', 'usage', null, 10.6, 'USD', 'USD card', null, 'active', 'Credit through PayPal (a guess from the descriptor). Not in your sheet.', 43, 'seed 20261002c'),
  ('software', 'Miro', 'Design', 'monthly', 1, 10, 'USD', 'CBK card 4348', 'miro', 'active', 'Your sheet: keep.', 44, 'seed 20261002c'),
  ('software', 'Excalidraw+', 'Design', 'monthly', 1, 7, 'USD', 'CBK card 4348', 'excalidraw', 'active', null, 45, 'seed 20261002c'),
  ('software', 'ManyChat', 'Messaging', 'monthly', null, 39, 'USD', 'CBK card 4348', 'manychat', 'paused', 'No charge in September: it was due around 28 to 29 Sep, when the CBK card was declining for low balance. Check whether it was cancelled.', 46, 'seed 20261002c')
) as v(kind, name, category, billing, seats, unit_price, currency, paid_with, match, status, note, sort, updated_by)
where not exists (select 1 from public.cockpit_cost_lines);

commit;
