-- The plan for a period, and a proper file on every person
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive.
--
-- Aziz, 2026-09-22: "I need to make sure that I can easily put goals for each
-- department of the team and front-end and back-end goals for the company...
-- set goals and projections for how we're going to get there through our
-- front-end funnel numbers, all of them, until the AOV and the total cash
-- collected (new cash), and then the back-end for how much MRR collection and
-- what percent MRR we want to collect", and "I need to expand the management
-- section so I could have a profile on each team member... their personal
-- goals, professional goals, their red flags and green flags, things to do,
-- things to not do based on their personality, extra notes, a place to save
-- their CV and contract... grade them from 1 to 10 on skill, will, culture
-- fit... based on the role that they have, their own specific scorecard that
-- we go over each month in their one-to-one."
--
-- Two ideas hold the goals tables together.
--
-- One: a target is a row, not a column. The September plan has forty-odd
-- numbers across the funnel, the money, the back end and six departments, and
-- next month it will have different ones. A column per metric would need a
-- migration every time Aziz adds a goal; a row per target does not.
--
-- Two: a target names the cockpit number that scores it. `actual_source` is a
-- key the cockpit already computes (growth.leads, money.cashCollected), so
-- the plan is marked against real numbers with no retyping. Where no such
-- number exists — Google reviews, testimonials, SOPs written — `actual_manual`
-- is typed and the screen says which is which. A goal that cannot be measured
-- is still a goal; it just has to admit that a person filled it in.

begin;

-- --- goals -----------------------------------------------------------------

create table if not exists public.cockpit_goal_plans (
  id           bigserial primary key,
  -- 'month' is the normal case; the other two exist so a quarter or a launch
  -- window can be planned without inventing a second table.
  period_kind  text not null default 'month'
               check (period_kind in ('month', 'quarter', 'custom')),
  period_from  date not null,
  period_to    date not null,
  title        text not null,
  -- The one sentence the plan is for, and the one number it is judged on.
  mission      text,
  headline     text,
  status       text not null default 'draft'
               check (status in ('draft', 'live', 'closed')),
  -- Working days in the period (Saturday to Thursday, 26 in September), so
  -- pace is measured against days worked and not days elapsed.
  working_days integer,
  created_by   text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint cockpit_goal_plans_span check (period_to >= period_from),
  constraint cockpit_goal_plans_period unique (period_from, period_to)
);
comment on table public.cockpit_goal_plans is
  'One plan per period. status live is the one the cockpit scores; draft is being written; closed is history. working_days is the Saturday-to-Thursday count the pace is measured against.';

create table if not exists public.cockpit_goal_targets (
  id            bigserial primary key,
  plan_id       bigint not null references public.cockpit_goal_plans(id) on delete cascade,
  -- Which part of the business: front_end, back_end, money, delivery, content,
  -- calls, creative, systems, team, or any department Aziz names.
  group_key     text not null,
  metric_key    text not null,
  label         text not null,
  unit          text not null default 'count'
                check (unit in ('usd', 'count', 'rate', 'days', 'x', 'pts', 'text')),
  -- Whether a bigger number is better. A cost per lead is 'down'.
  direction     text not null default 'up' check (direction in ('up', 'down')),
  target        numeric,
  stretch       numeric,
  -- What the same number did last period, so the plan shows the change.
  baseline      numeric,
  -- The cockpit metric that scores this target, or null when it is typed.
  actual_source text,
  actual_manual numeric,
  note          text,
  sort          integer not null default 0,
  constraint cockpit_goal_targets_key unique (plan_id, group_key, metric_key)
);
comment on table public.cockpit_goal_targets is
  'One row per number in the plan. actual_source names the cockpit metric that scores it (growth.leads, money.cashCollected, ...); when it is null the actual is typed into actual_manual and the screen says so. direction down means a smaller number is better.';
create index if not exists cockpit_goal_targets_plan_idx
  on public.cockpit_goal_targets (plan_id, group_key, sort);

-- --- the people file -------------------------------------------------------

create table if not exists public.cockpit_person_profiles (
  person_id          bigint primary key references public.cockpit_people(id) on delete cascade,
  personal_goals     text,
  professional_goals text,
  green_flags        text,
  red_flags          text,
  do_this            text,
  dont_do_this       text,
  notes              text,
  -- Out of ten, the three questions that decide whether somebody stays.
  skill              integer check (skill between 1 and 10),
  will               integer check (will between 1 and 10),
  culture            integer check (culture between 1 and 10),
  grades_note        text,
  updated_by         text not null,
  updated_at         timestamptz not null default now()
);
comment on table public.cockpit_person_profiles is
  'The private file on a team member: goals, flags, how to work with them, and three grades out of ten for skill, will and culture fit. One row per person, created the first time anything is written.';

create table if not exists public.cockpit_person_files (
  id          bigserial primary key,
  person_id   bigint not null references public.cockpit_people(id) on delete cascade,
  kind        text not null default 'other'
              check (kind in ('cv', 'contract', 'other')),
  name        text not null,
  -- The object path inside the private Supabase Storage bucket. The file
  -- itself never reaches Convex and is only ever handed out as a signed URL
  -- that expires.
  path        text not null unique,
  size_bytes  bigint,
  mime        text,
  uploaded_by text not null,
  uploaded_at timestamptz not null default now()
);
comment on table public.cockpit_person_files is
  'A CV, a contract or anything else kept on a person. path points into the private cockpit-people bucket; the cockpit hands out short-lived signed URLs and never a public one.';
create index if not exists cockpit_person_files_person_idx
  on public.cockpit_person_files (person_id, uploaded_at desc);

-- --- the monthly scorecard -------------------------------------------------

create table if not exists public.cockpit_scorecard_templates (
  id           bigserial primary key,
  role_key     text not null unique,
  title        text not null,
  mission      text,
  -- [{ key, accountability, lookingAt, scale: { a, b, c, d }, prompts: [] }]
  items        jsonb not null default '[]'::jsonb,
  competencies jsonb not null default '[]'::jsonb,
  bonus        text,
  updated_by   text not null,
  updated_at   timestamptz not null default now()
);
comment on table public.cockpit_scorecard_templates is
  'The scorecard for a role, from Aziz''s own documents and editable in the cockpit. items is the accountability table: what is being graded, what we look at, and what A, B, C and D mean for it.';

create table if not exists public.cockpit_scorecards (
  id          bigserial primary key,
  person_id   bigint not null references public.cockpit_people(id) on delete cascade,
  -- The month being graded, 'YYYY-MM'.
  month       text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  role_key    text not null,
  title       text not null,
  mission     text,
  -- A snapshot of the template's items with a grade and a comment on each, so
  -- editing a template never rewrites a month that has already been reviewed.
  items       jsonb not null default '[]'::jsonb,
  overall     text check (overall in ('A', 'B', 'C', 'D')),
  summary     text,
  reviewed_on date,
  reviewed_by text,
  status      text not null default 'draft' check (status in ('draft', 'final')),
  created_by  text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint cockpit_scorecards_month unique (person_id, month)
);
comment on table public.cockpit_scorecards is
  'One scorecard per person per month, carrying its own copy of the accountabilities it was graded on. A new month starts as a copy of the last one, so the conversation continues instead of restarting.';
create index if not exists cockpit_scorecards_person_idx
  on public.cockpit_scorecards (person_id, month desc);

-- --- row security ----------------------------------------------------------
-- The service key is the only door; no browser reaches these tables.

alter table public.cockpit_goal_plans          enable row level security;
alter table public.cockpit_goal_targets        enable row level security;
alter table public.cockpit_person_profiles     enable row level security;
alter table public.cockpit_person_files        enable row level security;
alter table public.cockpit_scorecard_templates enable row level security;
alter table public.cockpit_scorecards          enable row level security;

revoke all on public.cockpit_goal_plans          from anon, authenticated;
revoke all on public.cockpit_goal_targets        from anon, authenticated;
revoke all on public.cockpit_person_profiles     from anon, authenticated;
revoke all on public.cockpit_person_files        from anon, authenticated;
revoke all on public.cockpit_scorecard_templates from anon, authenticated;
revoke all on public.cockpit_scorecards          from anon, authenticated;

revoke all on sequence public.cockpit_goal_plans_id_seq          from anon, authenticated;
revoke all on sequence public.cockpit_goal_targets_id_seq        from anon, authenticated;
revoke all on sequence public.cockpit_person_files_id_seq        from anon, authenticated;
revoke all on sequence public.cockpit_scorecard_templates_id_seq from anon, authenticated;
revoke all on sequence public.cockpit_scorecards_id_seq          from anon, authenticated;

commit;
