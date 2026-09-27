-- What the sales desk spends on AI (Aziz, 2026-09-26: "bullet proof"). Every
-- model call the desk makes (proposals, follow-ups, call notes and digests,
-- reviews, research) leaves a row with its tokens, so the day's use can be
-- read and capped: past the desk's daily ceiling (SALES_AI_DAILY_TOKENS) its
-- jobs stop calling the model until midnight Kuwait and say so, instead of a
-- loop spending all night. Written by the desk with the service key; seats
-- read it.

begin;

create table if not exists public.cockpit_sales_ai_usage (
  id bigserial primary key,
  at timestamptz not null default now(),
  job text not null,
  model text,
  input_tokens integer,
  output_tokens integer,
  reasoning_tokens integer,
  total_tokens integer not null default 0
);

create index if not exists cockpit_sales_ai_usage_at on public.cockpit_sales_ai_usage (at desc);

alter table public.cockpit_sales_ai_usage enable row level security;
drop policy if exists cockpit_sales_ai_usage_seat_read on public.cockpit_sales_ai_usage;
create policy cockpit_sales_ai_usage_seat_read on public.cockpit_sales_ai_usage
  for select to authenticated using (public.cockpit_sales_seat());
revoke all on table public.cockpit_sales_ai_usage from public, anon, authenticated;
grant select on table public.cockpit_sales_ai_usage to authenticated;
grant all on table public.cockpit_sales_ai_usage to service_role;
grant usage, select on sequence public.cockpit_sales_ai_usage_id_seq to service_role;

-- The tokens used since a moment, summed in the database: a day can hold more
-- rows than one read returns (1,000).
create or replace function public.cockpit_sales_ai_tokens_since(p_since timestamptz)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(total_tokens), 0)::bigint
  from public.cockpit_sales_ai_usage
  where at >= p_since
$$;

revoke all on function public.cockpit_sales_ai_tokens_since(timestamptz) from public, anon;
grant execute on function public.cockpit_sales_ai_tokens_since(timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
