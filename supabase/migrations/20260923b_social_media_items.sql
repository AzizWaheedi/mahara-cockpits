-- A post is media now, not just generated pictures.
--
-- Aziz, 2026-09-23: upload our own images and videos, carousels that mix
-- them, reference images for the AI, a caption per platform, a cover made
-- for an uploaded video. And the publishing decisions he gave the same
-- day, captured now so publishing slots in later without a migration:
-- Instagram and Facebook both, unless a client only has Instagram; some
-- clients can go out without their sign-off.

alter table public.social_posts
  -- The ordered items: {kind: image|video, url, source: upload|ai, cover?}.
  -- One item is a single post, a lone video is a Reel, two to ten is a
  -- carousel -- images and videos mixed, as Instagram allows.
  add column if not exists media jsonb not null default '[]'::jsonb,
  -- Example pictures the AI should take its look from for this post.
  add column if not exists refs jsonb not null default '[]'::jsonb,
  -- Instagram's caption stays in `caption`; Facebook gets its own, since a
  -- caption written for one reads oddly on the other.
  add column if not exists caption_facebook text,
  -- Null means "whatever the client's default is".
  add column if not exists platforms text[];

alter table public.social_clients
  add column if not exists platforms text[] not null default '{instagram,facebook}',
  -- Posts go out without the client signing each one off.
  add column if not exists auto_approve boolean not null default false;

-- Existing generated pictures become media items, so nothing already on
-- the calendar loses its images.
update public.social_posts p
   set media = (
     select coalesce(jsonb_agg(jsonb_build_object('kind', 'image', 'url', u, 'source', 'ai')), '[]'::jsonb)
     from jsonb_array_elements_text(p.images) u)
 where jsonb_typeof(p.images) = 'array'
   and jsonb_array_length(p.images) > 0
   and p.media = '[]'::jsonb;

-- Uploads: images and video, public because Instagram and Facebook fetch
-- the file by URL when they publish. A gigabyte is a long finished reel,
-- not a raw shoot.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social-media', 'social-media', true, 1073741824,
        array['image/jpeg','image/png','image/webp','image/heic',
              'video/mp4','video/quicktime','video/webm'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
