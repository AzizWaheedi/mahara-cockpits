-- The sales assets, in the cockpit (Aziz's brief, 2026-09-24: "Sales assets
-- and client references in key links", and a closer should be able to send
-- the right proof for a lead's objection).
--
-- The library itself is Muhammed's, in B2B (flwboeijllbtrufxkhts, built 1-12
-- August 2026): 203 published assets, every one tagged with the stages and
-- objections it answers, what it proves, and a message in Arabic and English
-- ready to paste. B2B stays read-only: sales-mirror copies the published
-- assets and the tag vocabulary here every hour, with B2B's own rule for
-- what may be sent (published, link not broken, claims not expired, no
-- YouTube video from before 19 July) worked out there as `sendable`.
--
-- What a rep sends from the cockpit is logged here, with the message it went
-- in; B2B's own send counts are copied, not written to.

begin;

create table if not exists public.cockpit_sales_assets (
  id uuid primary key,
  slug text not null unique,
  title text not null,
  asset_type text not null,
  send_when text,
  stages text[] not null default '{}',
  objections text[] not null default '{}',
  industries text[] not null default '{}',
  personas text[] not null default '{}',
  proof_types text[] not null default '{}',
  language text,
  what_it_proves text,
  paste_message_ar text,
  paste_message_en text,
  does_not_cover text,
  usage_notes text,
  url text,
  thumbnail_url text,
  duration_seconds integer,
  published_at date,
  theme text,
  is_canonical boolean not null default false,
  claims_expire_at date,
  link_ok boolean,
  sendable boolean not null default false,
  send_count integer,
  updated_at timestamptz,
  mirrored_at timestamptz not null default now()
);

create index if not exists cockpit_sales_assets_pick
  on public.cockpit_sales_assets (sendable, is_canonical, language);

create table if not exists public.cockpit_sales_asset_vocab (
  facet text not null,
  value text not null,
  label text,
  description text,
  sort_order integer,
  mirrored_at timestamptz not null default now(),
  primary key (facet, value)
);

create table if not exists public.cockpit_sales_asset_sends (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null,
  contact_id text not null,
  channel text not null check (channel in ('whatsapp', 'email')),
  -- The message it went out in (cockpit_sales_messages).
  message_id uuid,
  sent_by text not null,
  sent_at timestamptz not null default now()
);

create index if not exists cockpit_sales_asset_sends_contact
  on public.cockpit_sales_asset_sends (contact_id, sent_at desc);
create index if not exists cockpit_sales_asset_sends_asset
  on public.cockpit_sales_asset_sends (asset_id, sent_at desc);

do $$
declare
  t text;
begin
  foreach t in array array['cockpit_sales_assets', 'cockpit_sales_asset_vocab', 'cockpit_sales_asset_sends']
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
