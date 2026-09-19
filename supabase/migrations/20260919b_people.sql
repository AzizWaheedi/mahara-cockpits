-- Who works here, what they cost, and whether they still do
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive.
--
-- There is no payroll anywhere in Mahara. The "salaries" category in the bank
-- import is a bank label: most of its rows are $6 to $39 card top-ups and it
-- names nobody. That single gap blocks gross margin, real CAC and cost per
-- client, and it is what makes the 1-to-4 ratio swing between healthy and
-- underwater depending on a number nobody has written down.
--
-- So this is a roster a person keeps, not a feed. Aziz adds people, marks them
-- active or gone, and says what they cost. Freelancers and agencies sit in the
-- same table as staff, because for a margin they are the same kind of money.
--
-- A Google Workspace import is deliberately not assumed here. The cockpit's
-- service account requests sheets, drive, docs and calendar scopes only, so it
-- cannot list Workspace users, and granting admin.directory.user.readonly
-- needs domain-wide delegation set up in the Workspace admin console. The
-- `source` and `email` columns are ready for that day; until then every row is
-- entered by hand and says so.

begin;

create table if not exists public.cockpit_people (
  id              bigint generated always as identity primary key,
  name            text        not null check (length(btrim(name)) > 0),
  /** Workspace address when there is one. The join key if a directory import ever lands. */
  email           text,
  role            text,
  /**
   * How they are engaged. A freelancer costs the business money the same way
   * a salaried person does, so they belong in the same margin.
   */
  engagement      text        not null default 'staff'
                              check (engagement in ('staff','freelancer','agency','intern')),
  /** False when they have left. Rows are never deleted: last month's cost was still real. */
  active          boolean     not null default true,
  /** Fully loaded monthly cost while active. Null means nobody has said yet. */
  monthly_cost    numeric(14,2) check (monthly_cost is null or monthly_cost >= 0),
  currency        char(3)     not null default 'USD'
                              check (currency in ('USD','KWD','AED','SAR','QAR')),
  /** Commission as a share of what they close, 0..1. Null when they earn none. */
  commission_pct  numeric(5,4) check (commission_pct is null or (commission_pct >= 0 and commission_pct <= 1)),
  /** Anything the percentage cannot say: "KD 50 per booked demo", "bonus at 10 closes". */
  commission_note text,
  /**
   * True when their job is selling. CAC counts only these people if the CAC
   * rule ever changes to include sales payroll; today's rule is ad spend only.
   */
  is_sales        boolean     not null default false,
  started_on      date,
  ended_on        date,
  note            text,
  /** 'manual' today. 'workspace' if a directory import is ever switched on. */
  source          text        not null default 'manual'
                              check (source in ('manual','workspace')),
  added_by        text        not null,
  added_at        timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (ended_on is null or started_on is null or ended_on >= started_on)
);

comment on table public.cockpit_people is
  'The people Mahara pays, staff and freelance alike. Kept by hand: nothing in the stack knows who works here. A person who leaves is marked inactive, never deleted, because the months they were paid for still happened.';

-- One live row per person. Somebody who leaves and returns gets a second row,
-- which is correct: the two spells are different engagements.
create unique index if not exists cockpit_people_active_name_idx
  on public.cockpit_people (lower(btrim(name))) where active;

create index if not exists cockpit_people_active_idx on public.cockpit_people (active);

alter table public.cockpit_people enable row level security;
revoke all on public.cockpit_people from anon, authenticated;

drop trigger if exists cockpit_people_touch on public.cockpit_people;
create trigger cockpit_people_touch
  before update on public.cockpit_people
  for each row execute function public.cockpit_touch_updated_at();

-- The monthly history table gains a link back to the person, so a month's cost
-- can be traced to the row it came from rather than matched on a typed name.
alter table public.cockpit_payroll_months
  add column if not exists person_id bigint references public.cockpit_people(id);

create index if not exists cockpit_payroll_months_person_idx
  on public.cockpit_payroll_months (person_id, month desc);

commit;
