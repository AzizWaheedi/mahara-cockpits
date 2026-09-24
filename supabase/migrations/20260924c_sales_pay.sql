-- Each rep's pay rule, on their seat.
--
-- Aziz, 2026-09-24: "Right now it's 10% cash collected on contract so if
-- it's $2k upfront and $6k contracted they get $200 now and the $400 while
-- we collect it, and $250 PIF bonus, but pay should be flexible. For setters
-- it's different."
--
-- So a rule is a small object, not a single rate:
--   cash_rate        share of the cash collected on the rep's contracts,
--                    earned as each payment clears (0.10 = 10%)
--   pif_bonus        a fixed amount when the client pays the contract in full
--   per_intro_shown  a fixed amount per intro the rep set that showed
--   per_demo_shown   a fixed amount per demo that showed
--   per_signed       a fixed amount per signed client
--   currency         USD unless stated
--   note             the plan in words, as agreed with the rep
-- An empty object means no rule has been set, and the cockpit says so
-- rather than showing zero.

begin;

alter table public.cockpit_sales_people
  add column if not exists pay jsonb not null default '{}'::jsonb;

comment on column public.cockpit_sales_people.pay is
  'Pay rule: cash_rate, pif_bonus, per_intro_shown, per_demo_shown, per_signed, currency, note. {} = not set.';

commit;
