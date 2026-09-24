-- The power dialer: who is calling whom right now, what each call ended as,
-- and when each lead is due again.
--
-- Built from mahara-power-dialer's tested rules (one open attempt per lead
-- and per rep, the retry ladder, a note on every outcome), in the sales
-- cockpit's own tables. The queue itself is computed on request by the
-- sales-api function from the leads, the calendar, Maqsam's calls, replies
-- and the state below; nothing here is a copy of HighLevel.

begin;

create table if not exists public.cockpit_sales_attempts (
  id uuid primary key default gen_random_uuid(),
  contact_id text not null,
  rep_email text not null,
  maqsam_email text,
  phone text,
  caller text,
  -- dialing: asked Maqsam; placed: Maqsam took it; failed: Maqsam refused;
  -- saved: the rep chose an outcome; released: skipped without one.
  state text not null default 'dialing'
    check (state in ('dialing', 'placed', 'failed', 'saved', 'released')),
  maqsam_ref text,
  error text,
  outcome text
    check (outcome is null or outcome in ('no_answer', 'callback', 'booked', 'not_interested', 'disqualified', 'wrong_number', 'handled')),
  reason text,
  note text,
  callback_at timestamptz,
  crm_note text check (crm_note is null or crm_note in ('written', 'failed', 'skipped')),
  started_at timestamptz not null default now(),
  saved_at timestamptz
);

-- One live call per lead, and one per rep: the dialer's locks.
create unique index if not exists cockpit_sales_attempts_one_per_lead
  on public.cockpit_sales_attempts (contact_id) where state in ('dialing', 'placed');
create unique index if not exists cockpit_sales_attempts_one_per_rep
  on public.cockpit_sales_attempts (rep_email) where state in ('dialing', 'placed');
create index if not exists cockpit_sales_attempts_contact
  on public.cockpit_sales_attempts (contact_id, started_at desc);
create index if not exists cockpit_sales_attempts_rep
  on public.cockpit_sales_attempts (rep_email, started_at desc);

create table if not exists public.cockpit_sales_queue_state (
  contact_id text primary key,
  -- Unanswered tries so far on the retry ladder (0 to 3).
  step integer not null default 0,
  due_at timestamptz,
  callback_at timestamptz,
  callback_by text,
  -- booked, unreachable, not_interested, disqualified, wrong_number: out of
  -- the queue until something new happens (a reply, a new booking).
  closed text,
  closed_at timestamptz,
  last_outcome text,
  last_outcome_at timestamptz,
  last_rep text,
  updated_at timestamptz not null default now()
);

do $$
declare
  t text;
begin
  foreach t in array array['cockpit_sales_attempts', 'cockpit_sales_queue_state']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_seat_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.cockpit_sales_seat())',
      t || '_seat_read', t
    );
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end;
$$;

commit;
