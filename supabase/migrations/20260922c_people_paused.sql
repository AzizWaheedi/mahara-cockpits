-- Pausing somebody on the payroll roster, and the accounts that are not people
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive.
--
-- Aziz, 2026-09-22: "for payroll, add an option to pause. Also, info MM is a
-- bot account, so it's just like our email for the whole company. I don't know
-- if you should count it. You could just leave it as a bot position."
--
-- Leaving and pausing are different things and the roster only had leaving.
-- Somebody inactive has gone; somebody paused is still on the team and is not
-- being paid this month. Both have to be told apart from a shared mailbox,
-- which is not a person at all and must never reach a headcount or a payroll
-- total.

begin;

alter table public.cockpit_people
  add column if not exists paused_on  date,
  add column if not exists paused_why text;

comment on column public.cockpit_people.paused_on is
  'Set while somebody is paused: still on the team, not being paid. Null means working. Leaving is active = false, which is a different thing and keeps the months already paid for.';
comment on column public.cockpit_people.paused_why is
  'Why they are paused, which is what decides when they come back.';

create index if not exists cockpit_people_paused_idx
  on public.cockpit_people (paused_on) where paused_on is not null;

commit;
