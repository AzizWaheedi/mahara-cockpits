-- Every sales call, and Vince's reviews of them (Aziz, 2026-09-24: "it should
-- also be pulling in all the sales calls ... there should be a call reviewer
-- here that's on the VPS").
--
-- Calls: cockpit_sales_recordings held the Fathom calls the sales desk saw in
-- its 14-day look-back (182, from 27 June). The Obsidian vault on the VPS
-- holds every Fathom sales call since 2025 with its summary and transcript
-- (517 recordings). The desk's calls-vault step now copies them in: the
-- summary and action items on the row, the transcript as a file in the
-- private bucket `sales-calls`, matched to a lead the same way as before
-- (an outside invitee's email, else one lead's intro or demo within 30
-- minutes).
--
-- Reviews: Vince (the OpenClaw sales coach, dormant since 2026-08-24) scored
-- demos and intros on a 15-item card out of 150 and posted them to
-- #sales-call-feedback, where the whole team read them. His 121 reviews are
-- imported, and the desk writes new ones here with his rubric.
--
-- Both are read by any seat (the team learns from each other's calls, as it
-- did in Slack) and written only by the desk with the service key.

begin;

alter table public.cockpit_sales_recordings
  add column if not exists source text,
  add column if not exists kind text,
  add column if not exists language text,
  add column if not exists people jsonb,
  add column if not exists summary text,
  add column if not exists action_items text,
  add column if not exists transcript_path text,
  add column if not exists transcript_chars integer,
  add column if not exists transcript_sha text,
  add column if not exists note_path text;

comment on column public.cockpit_sales_recordings.source is
  'fathom (the desk''s own look-back), vault (the Obsidian copy of Fathom) or drive (a Drive transcript with no Fathom note).';
comment on column public.cockpit_sales_recordings.transcript_path is
  'Object path in the private bucket sales-calls.';

create index if not exists cockpit_sales_recordings_contact_idx
  on public.cockpit_sales_recordings (contact_id, started_at desc);
create index if not exists cockpit_sales_recordings_started_idx
  on public.cockpit_sales_recordings (started_at desc);

create table if not exists public.cockpit_sales_reviews (
  id uuid primary key default gen_random_uuid(),
  -- Where the review came from, unique: "vince:<file name>" for the archive,
  -- "desk:<recording id>" or "desk:maqsam:<call id>" for new ones.
  source_ref text not null unique,
  source text not null check (source in ('vince-archive', 'desk')),
  recording_id text,
  maqsam_call_id text,
  contact_id text,
  call_type text check (call_type in ('intro', 'demo')),
  rep_name text,
  rep_key text,
  lead_name text,
  call_at timestamptz,
  reviewed_at timestamptz not null default now(),
  model text,
  score numeric,
  score_max numeric,
  -- [{name, score, max}]
  items jsonb,
  pros text,
  feedback text,
  -- [{fix, say}]
  fixes jsonb,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists cockpit_sales_reviews_recording_idx
  on public.cockpit_sales_reviews (recording_id);
create index if not exists cockpit_sales_reviews_contact_idx
  on public.cockpit_sales_reviews (contact_id, call_at desc);
create index if not exists cockpit_sales_reviews_rep_idx
  on public.cockpit_sales_reviews (rep_key, call_at desc);

alter table public.cockpit_sales_reviews enable row level security;

drop policy if exists cockpit_sales_reviews_seat_read on public.cockpit_sales_reviews;
create policy cockpit_sales_reviews_seat_read on public.cockpit_sales_reviews
  for select to authenticated
  using (public.cockpit_sales_seat());

revoke all on public.cockpit_sales_reviews from anon, authenticated;
grant select on public.cockpit_sales_reviews to authenticated;
grant all on public.cockpit_sales_reviews to service_role;

-- The transcripts: private, read by any seat, written by the desk only.
insert into storage.buckets (id, name, public)
values ('sales-calls', 'sales-calls', false)
on conflict (id) do nothing;

drop policy if exists sales_calls_seat_read on storage.objects;
create policy sales_calls_seat_read on storage.objects
  for select to authenticated
  using (bucket_id = 'sales-calls' and public.cockpit_sales_seat());

notify pgrst, 'reload schema';

commit;
