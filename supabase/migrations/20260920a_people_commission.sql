-- What a person's commission is paid on, not just a percent
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive.
--
-- Aziz, 2026-09-20: "you can't just go off of percent commission, because it
-- depends on what they're commissioning on." A closer takes a share of the
-- cash that lands, a setter is paid per demo that shows up, an account
-- manager may take a share of the monthly revenue of the clients they keep.
-- So the rule is two columns: the basis (what it is paid on) and the rate
-- (a share when the basis is a share, an amount in the person's currency
-- when it is per unit). commission_pct stays, mirrored from the rate for the
-- share bases, so nothing that reads it breaks.

begin;

alter table public.cockpit_people
  add column if not exists commission_basis text not null default 'none'
    check (commission_basis in (
      'none',
      'closed_cash', 'closed_contract',
      'set_cash', 'set_contract',
      'per_intro_shown', 'per_demo_shown', 'per_signed',
      'mrr_managed',
      'other'
    )),
  add column if not exists commission_rate numeric(14,4)
    check (commission_rate is null or commission_rate >= 0);

comment on column public.cockpit_people.commission_basis is
  'What the commission is paid on: a share of cash or contract value on deals they closed or set, an amount per intro shown, demo shown or signed deal, a share of the MRR they manage, or other (see commission_note).';
comment on column public.cockpit_people.commission_rate is
  'A share (0.1 = 10%) for the share bases, an amount in the person''s currency for the per-unit bases.';

-- Rows that only had a percent were a share of what they close.
update public.cockpit_people
   set commission_basis = 'closed_cash', commission_rate = commission_pct
 where commission_pct is not null and commission_basis = 'none';
update public.cockpit_people
   set commission_basis = 'other'
 where commission_note is not null and commission_basis = 'none';

commit;
