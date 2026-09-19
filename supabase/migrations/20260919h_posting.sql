-- The posting desk for Mahara's own channels
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive.
--
-- A finished video becomes a post here: fetched, transcribed with
-- timestamps, written up (a YouTube title, an SEO description with chapters,
-- tags, an Instagram caption and hashtags, a thumbnail line), rendered into a
-- thumbnail and a cover from a real frame, and then published only after
-- Aziz has read it and pressed approve. The worker on the VPS does the
-- fetching, listening, writing and rendering; the cockpit does the reading,
-- editing and approving; Instagram publishes from the cockpit and YouTube
-- from the worker. TikTok, LinkedIn and X ride the same `targets` and
-- `published` columns later, so nothing is reshaped for them.
--
-- Row security is on and nothing is granted: the service key is the only
-- door, on both sides.

begin;

create table if not exists public.cockpit_posts (
  id                  bigint generated always as identity primary key,
  kind                text        not null default 'reel' check (kind in ('reel','video')),
  title_working       text,
  /** upload = a file in the posting bucket; drive = a Google Drive file id or link; url = a fetchable link. */
  source_kind         text        not null check (source_kind in ('upload','drive','url')),
  source_ref          text        not null,
  /** The video in the bucket once fetched, whatever the source was. */
  video_path          text,
  duration_sec        numeric,
  width               integer,
  height              integer,
  size_bytes          bigint,
  language            text,
  status              text        not null default 'new'
                                  check (status in ('new','preparing','ready','approved','publishing','published','failed','discarded')),
  targets             text[]      not null default array['instagram','youtube'],
  /** {text, language, method, segments:[{from_sec,to_sec,text}], warnings} */
  transcript          jsonb,
  /** [{at_sec, title}] from the transcript, first one at 0. */
  chapters            jsonb       not null default '[]'::jsonb,
  yt_title            text,
  yt_title_options    jsonb       not null default '[]'::jsonb,
  yt_description      text,
  yt_tags             text[]      not null default '{}',
  ig_caption          text,
  ig_hashtags         text[]      not null default '{}',
  thumb_text          text,
  thumb_text_options  jsonb       not null default '[]'::jsonb,
  thumb_frame_ms      integer,
  thumb_path          text,
  cover_path          text,
  /** [{ms, path}] candidate frames in the bucket. */
  frames              jsonb       not null default '[]'::jsonb,
  /** Which model listened, which wrote, which rendered; never a secret. */
  method              jsonb       not null default '{}'::jsonb,
  /** The outliers on the Mahara board that briefed the title and thumbnail. */
  outlier_refs        jsonb       not null default '[]'::jsonb,
  scheduled_at        timestamptz,
  approved_by         text,
  approved_at         timestamptz,
  /** {instagram:{id,permalink,at,container}, youtube:{id,url,at,privacy}} */
  published           jsonb       not null default '{}'::jsonb,
  error               text,
  created_by          text        not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.cockpit_posts is
  'Mahara''s own posts: one finished video, prepared by the worker, read and approved by Aziz, published to each target.';
create index if not exists cockpit_posts_status_idx on public.cockpit_posts (status, created_at desc);

create table if not exists public.cockpit_post_jobs (
  id          bigint generated always as identity primary key,
  /** Null for jobs that are not about one post (the YouTube consent exchange). */
  post_id     bigint references public.cockpit_posts(id) on delete cascade,
  kind        text        not null check (kind in ('prepare','render','publish_youtube','youtube_auth')),
  status      text        not null default 'queued' check (status in ('queued','running','done','failed')),
  attempts    integer     not null default 0,
  params      jsonb       not null default '{}'::jsonb,
  result      jsonb,
  error       text,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz,
  updated_at  timestamptz not null default now()
);
comment on table public.cockpit_post_jobs is
  'The posting worker''s queue. The cockpit writes a job; radar.py posts on the VPS claims it, does it, and writes the result.';
create index if not exists cockpit_post_jobs_queue_idx on public.cockpit_post_jobs (status, created_at);

create table if not exists public.cockpit_channels (
  platform     text primary key,
  handle       text,
  external_id  text,
  connected    boolean     not null default false,
  connected_at timestamptz,
  /** For YouTube before consent: the link Aziz clicks once. Never a secret. */
  auth_url     text,
  note         text,
  checked_at   timestamptz,
  updated_at   timestamptz not null default now()
);
comment on table public.cockpit_channels is
  'Where Mahara can publish and whether the door is open. Status only; every secret stays on the VPS or in Convex.';

insert into public.cockpit_channels (platform, handle, external_id, connected, connected_at, note) values
  ('instagram', 'mahara_media', '17841473441237528', true, now(), 'Reels publish through the Meta system token from the cockpit; 100 posts a day.'),
  ('youtube', 'maharamedia', 'UCnJqIFZlyCKeeW6Jkp5HZHw', false, null, 'Needs one consent; the Posting tab shows the link.'),
  ('facebook', 'MaharaMedia', '587094101153861', false, null, 'The system user needs pages_manage_posts before the Page can be posted to.'),
  ('tiktok', null, null, false, null, 'Link the account in Composio first.'),
  ('linkedin', null, null, false, null, 'Link the account in Composio first.'),
  ('x', null, null, false, null, 'Connected in Composio; publishing arrives with the cross-post step.')
on conflict (platform) do nothing;

alter table public.cockpit_posts     enable row level security;
alter table public.cockpit_post_jobs enable row level security;
alter table public.cockpit_channels  enable row level security;
revoke all on public.cockpit_posts, public.cockpit_post_jobs, public.cockpit_channels from anon, authenticated;

drop trigger if exists cockpit_posts_touch on public.cockpit_posts;
create trigger cockpit_posts_touch before update on public.cockpit_posts
  for each row execute function public.cockpit_touch_updated_at();
drop trigger if exists cockpit_post_jobs_touch on public.cockpit_post_jobs;
create trigger cockpit_post_jobs_touch before update on public.cockpit_post_jobs
  for each row execute function public.cockpit_touch_updated_at();
drop trigger if exists cockpit_channels_touch on public.cockpit_channels;
create trigger cockpit_channels_touch before update on public.cockpit_channels
  for each row execute function public.cockpit_touch_updated_at();

-- The private bucket the videos, frames, thumbnails and covers live in.
-- Meta fetches a reel from a signed link that lasts two days; nothing is public.
insert into storage.buckets (id, name, public, file_size_limit)
  values ('posting', 'posting', false, 2147483648)
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

commit;
