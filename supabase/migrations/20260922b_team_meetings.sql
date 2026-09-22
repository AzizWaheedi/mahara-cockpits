-- Team meetings, their agendas, and what came out of them.
--
-- Supabase, not Convex: the migration is the direction and new data
-- belongs here (Aziz, 2026-09-22).
--
-- The shape that matters is the carry-over. An agenda item belongs to a
-- meeting series, not to one sitting, and moves between sittings until
-- somebody closes it. That is what makes the next meeting open with what
-- was not finished rather than a blank page, which is the whole point of
-- keeping agendas at all.

create table if not exists public.team_people (
  id          text primary key,           -- lower-case first name, stable
  name        text not null,
  role        text,
  department  text,
  email       text,
  slack_id    text,
  active      boolean not null default true,
  updated_at  timestamptz not null default now()
);

create table if not exists public.team_meetings (
  id            text primary key,
  title         text not null,
  -- One sentence, and required, because "every meeting has a specific
  -- purpose" is the rule this is here to enforce.
  purpose       text,
  cadence       text,                     -- weekly, monthly, as needed
  department    text,
  host_id       text references public.team_people(id),
  -- The Google Calendar series, when there is one. A meeting can exist
  -- here without one; not everything worth an agenda is in a calendar.
  calendar_id   text,
  active        boolean not null default true,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.team_meeting_people (
  meeting_id  text not null references public.team_meetings(id) on delete cascade,
  person_id   text not null references public.team_people(id) on delete cascade,
  -- host, required, optional. A meeting may have more than one host.
  part        text not null default 'required'
              check (part in ('host', 'required', 'optional')),
  primary key (meeting_id, person_id)
);

create table if not exists public.team_sittings (
  id          text primary key,           -- <meeting>:<YYYY-MM-DD>
  meeting_id  text not null references public.team_meetings(id) on delete cascade,
  on_date     date not null,
  -- Free notes for the sitting: what was actually said. The agenda is
  -- structured; this is not, because minutes never are.
  notes       text,
  notes_by    text,
  notes_at    timestamptz,
  held        boolean not null default false,
  unique (meeting_id, on_date)
);

create table if not exists public.team_agenda (
  id          bigserial primary key,
  meeting_id  text not null references public.team_meetings(id) on delete cascade,
  -- Null until it is discussed: an item waiting for the next sitting.
  sitting_id  text references public.team_sittings(id) on delete set null,
  text        text not null,
  owner_id    text references public.team_people(id),
  -- open carries to the next sitting; done and dropped do not.
  status      text not null default 'open'
              check (status in ('open', 'done', 'dropped')),
  position    integer not null default 0,
  added_by    text,
  added_at    timestamptz not null default now(),
  closed_at   timestamptz,
  closed_by   text
);
create index if not exists team_agenda_meeting on public.team_agenda (meeting_id, status, position);

alter table public.team_people        enable row level security;
alter table public.team_meetings      enable row level security;
alter table public.team_meeting_people enable row level security;
alter table public.team_sittings      enable row level security;
alter table public.team_agenda        enable row level security;
grant all on public.team_people, public.team_meetings, public.team_meeting_people,
             public.team_sittings, public.team_agenda to service_role;
grant usage, select on sequence public.team_agenda_id_seq to service_role;
