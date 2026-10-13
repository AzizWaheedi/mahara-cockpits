-- Cockpit settings: one row per key, the value as JSON, in Creative Triage
-- beside the other cockpit_ tables. The first key is working_hours, the
-- clock speed to lead runs on (Aziz, 2026-09-21, item 10): the clock starts
-- at the later of the lead's creation and the next working window, and only
-- working minutes count. The default when no row exists is 10:00 to 18:00
-- Asia/Kuwait, Saturday to Thursday, and it lives in code
-- (convex/ceo/workingHours.ts), so an empty table means "the default",
-- never "no hours".
--
-- Written only by the CEO through convex/ceo/settings.ts with the service
-- key, and every write leaves a ceoAudit row on the Convex side. RLS is on
-- with no permissive policy and the browser roles are revoked, so nothing
-- here is reachable from a browser bundle.

create table if not exists public.cockpit_settings (
  key         text        primary key,
  value       jsonb       not null,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

comment on table public.cockpit_settings is
  'Cockpit settings, one row per key (working_hours first). Set by the CEO through the cockpit; the defaults live in code, so a missing row means the default.';

alter table public.cockpit_settings enable row level security;
revoke all on public.cockpit_settings from anon, authenticated;
