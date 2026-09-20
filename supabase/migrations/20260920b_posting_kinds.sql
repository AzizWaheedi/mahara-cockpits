-- Reels, long videos and image posts are three different jobs
--
-- Creative Triage (bldgtotkfmhoxmlzowdx). Additive.
--
-- Aziz, 2026-09-20: "for posts and reels, long-form and short-form should be
-- separated for posting because those will have different steps." A reel
-- gets a 9:16 cover and a caption and goes to Instagram and YouTube Shorts;
-- a long video gets a 16:9 thumbnail, a title, a description with chapters
-- and tags and goes to YouTube; a post is one to ten images with a caption
-- and goes to Instagram. The row gains the third kind, an image source, the
-- images themselves and the brief Aziz types for a post.

begin;

alter table public.cockpit_posts drop constraint if exists cockpit_posts_kind_check;
alter table public.cockpit_posts
  add constraint cockpit_posts_kind_check check (kind in ('reel', 'video', 'post'));

alter table public.cockpit_posts drop constraint if exists cockpit_posts_source_kind_check;
alter table public.cockpit_posts
  add constraint cockpit_posts_source_kind_check check (source_kind in ('upload', 'drive', 'url', 'image'));

alter table public.cockpit_posts
  add column if not exists images jsonb not null default '[]'::jsonb,
  add column if not exists brief text;

comment on column public.cockpit_posts.images is 'Bucket paths of the images of a post, in order; one to ten. Empty for a reel or a video.';
comment on column public.cockpit_posts.brief is 'What the post is about, in Aziz''s words: the source the caption is written from when there is no transcript.';

commit;
