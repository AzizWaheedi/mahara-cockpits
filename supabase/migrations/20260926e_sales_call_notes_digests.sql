-- Notes after every call, and what prospects keep asking (Aziz's brief,
-- 2026-09-24):
--
-- - "it should automatically be able to take notes ... It takes notes from
--   the intro call and automatically makes notes for the closer from the
--   demo call ... and marked them if they're good" (the old Sales AI Notes);
-- - "what the most frequent questions, objections, problems, and
--   expectations are from prospects for the last week or last 30 days ...
--   The more recent sales calls can also help us with the marketing side".
--
-- Written by the sales desk on the VPS (OpenAI on the VPS key; no lead data
-- to DeepSeek) with the service key; every seat reads.

begin;

create table if not exists public.cockpit_sales_call_notes (
  id uuid primary key default gen_random_uuid(),
  -- The call: a recording (Fathom through the vault) or a Maqsam phone call.
  recording_id text not null unique,
  contact_id text,
  call_type text check (call_type is null or call_type in ('intro', 'demo', 'phone', 'other')),
  call_at timestamptz,
  rep text,
  -- {summary, pains[], goals[], current_state, budget, timeline,
  --  decision_maker, questions[], objections[{objection, handled, how}],
  --  expectations[], next_steps[], for_closer}
  notes jsonb not null,
  -- The lead, as the call showed them.
  verdict text check (verdict is null or verdict in ('qualified', 'not_qualified', 'unclear')),
  verdict_why text,
  model text,
  written_at timestamptz not null default now()
);

create index if not exists cockpit_sales_call_notes_contact
  on public.cockpit_sales_call_notes (contact_id, call_at desc);
create index if not exists cockpit_sales_call_notes_recent
  on public.cockpit_sales_call_notes (call_at desc);

create table if not exists public.cockpit_sales_digests (
  id uuid primary key default gen_random_uuid(),
  -- 7 or 30 days back from `to_at`.
  days integer not null check (days in (7, 30)),
  from_at timestamptz not null,
  to_at timestamptz not null,
  calls_used integer not null default 0,
  -- {questions[{text,count,example}], objections[{text,count,answer}],
  --  problems[{text,count}], expectations[{text,count}], marketing[{idea,why}]}
  digest jsonb not null,
  model text,
  written_at timestamptz not null default now()
);

create index if not exists cockpit_sales_digests_recent
  on public.cockpit_sales_digests (days, written_at desc);

do $$
declare
  t text;
begin
  foreach t in array array['cockpit_sales_call_notes', 'cockpit_sales_digests']
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

notify pgrst, 'reload schema';

commit;
