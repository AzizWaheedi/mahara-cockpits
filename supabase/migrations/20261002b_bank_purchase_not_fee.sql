-- A card purchase is never a bank fee (2026-10-02). Zapier's descriptor reads
-- "P-…-ZAPIER.COM/CHARGE", and the fee rule matched the word "charge", so its
-- three monthly charges from July to September ($92.81) were filed as bank
-- fees and left out of software. convex/ceo/bank.ts now keeps a purchase
-- ("P-<number>-") out of fees and checks named vendors before the word
-- "charge"; this puts the rows already imported right. Only Zapier's three
-- rows matched on 2026-10-02.

begin;

update public.cockpit_bank_lines
   set kind = 'expense', category = 'software'
 where kind = 'fee'
   and reference ~* '^P-[0-9]+-'
   and reference ~* 'zapier';

commit;
