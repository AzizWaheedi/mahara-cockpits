-- The shape of a post, chosen the way Instagram's composer offers it.
--
-- Aziz, 2026-09-23: "choose the same way Instagram has 1080 by 1080 and
-- all the ratios". Square 1:1 (1080x1080), portrait 4:5 (1080x1350), tall
-- 3:4 (1080x1440) and landscape 1.91:1 (1080x566). A lone video is a Reel
-- and is 9:16 whatever this says. Every item in a carousel shares the
-- post's shape, as it does on Instagram.
--
-- 3:4 is in because Instagram's app takes it; its publishing API does not
-- (Meta's media reference: images "must be within a 4:5 to 1.91:1 range"),
-- so a 3:4 post goes out by hand. The screen says so where it is picked.
alter table public.social_posts
  add column if not exists aspect text not null default '4:5';
alter table public.social_posts drop constraint if exists social_posts_aspect_check;
alter table public.social_posts
  add constraint social_posts_aspect_check
  check (aspect in ('1:1', '4:5', '3:4', '1.91:1'));

-- Recorded here because it was added by hand the same day: what is said in
-- a post's first video, transcribed once and kept for its captions.
alter table public.social_posts add column if not exists transcript text;
