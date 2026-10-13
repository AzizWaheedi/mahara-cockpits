-- Working hours per person: days and times per weekday, plus exceptions
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive.
--
-- Aziz, 2026-09-21: "Working hours per person: days and times per weekday,
-- plus per-day exceptions for part-time." One jsonb column, because the
-- shape is small and always read whole: nothing filters people by a weekday,
-- and a second table would be seven rows per person to answer one question.
-- The shape is checked by convex/ceo/schedule.ts (normaliseSchedule) before
-- every write, which is why the column carries no check of its own.

begin;

alter table public.cockpit_people
  add column if not exists schedule jsonb;

comment on column public.cockpit_people.schedule is
  'Working hours, or null when none are set. Shape: {"timezone":"Asia/Kuwait","week":{"mon":{"on":true,"start":"10:00","end":"18:00"},"tue":{...},"wed":{...},"thu":{...},"fri":{"on":false,"start":"10:00","end":"18:00"},"sat":{...},"sun":{...}},"exceptions":[{"date":"2026-09-25","off":true},{"date":"2026-09-26","start":"12:00","end":"16:00"}]}. Times are wall clock in the timezone, HH:MM, and a day ends after it starts. An exception replaces its date''s weekday line: off, or different hours. Validated by convex/ceo/schedule.ts before every write.';

commit;
