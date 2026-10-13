-- Prompts, and somewhere the images can actually live.
--
-- GoHighLevel fetches media **by URL, when it publishes** -- which may be
-- days after we push the post. So an image behind a short-lived signed
-- link would work in testing and 404 on the morning it goes out. These
-- have to be publicly readable for as long as the post exists.
--
-- That is a real exposure and worth being deliberate about: the bucket
-- holds finished marketing images for a client's own feed, which are
-- about to be public anyway. Nothing private goes in it. The client's
-- reference photographs stay in `social_assets`, which is not this.

insert into storage.buckets (id, name, public)
values ('social-images', 'social-images', true)
on conflict (id) do update set public = true;

alter table public.social_posts
  -- One prompt per slide, written before anything is generated, so a
  -- person can paste them into Higgsfield by hand while the API route is
  -- not wired -- and so the prompt is reviewable on its own, which is
  -- cheaper than reviewing the picture it produced.
  add column if not exists prompts jsonb not null default '[]'::jsonb,
  add column if not exists images_by text;

comment on column public.social_posts.prompts is
  'One image prompt per slide. Written by the plan-to-prompt step; the pictures may be made by hand or by API from the same text.';
