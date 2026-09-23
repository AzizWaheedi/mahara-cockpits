-- A shared mailbox is not a person: widen the engagement check to allow 'bot'
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive in effect: the constraint
-- only ever gets wider, so no row can become invalid.
--
-- Aziz, 2026-09-22: "info MM is a bot account, so it's just like our email for
-- the whole company. I don't know if you should count it. You could just leave
-- it as a bot position."
--
-- A bot never reaches a headcount or a payroll total, which the roster does in
-- code; this is only the column agreeing that the word exists.

begin;

alter table public.cockpit_people
  drop constraint if exists cockpit_people_engagement_check;

alter table public.cockpit_people
  add constraint cockpit_people_engagement_check
  check (engagement in ('staff', 'freelancer', 'agency', 'intern', 'bot'));

comment on column public.cockpit_people.engagement is
  'staff, freelancer, agency, intern, or bot. A bot is a shared mailbox or an automation: it is never counted as a head and never carries a cost.';

commit;
