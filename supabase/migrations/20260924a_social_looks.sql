-- Words on the pictures, pictures that move, and alerts that reach a person.
--
-- Aziz, 2026-09-24: client posts carry words on the picture ("a lot of the
-- posts are going to be like that"), in one of two looks from the
-- mahara-context skills: bold teaching carousels (clickable-carousels) or
-- project posts for architecture and interiors firms (architecture-showcase).
-- Pictures can be made to move with the words kept still. Salma does the
-- work (hermes/salma); this is what it reads and writes.
--
-- The words, the picture without them and the moving version live on each
-- item of social_posts.media (jsonb), so nothing new is needed there.

-- How a client's pictures carry words: bold draws them in, showcase sets
-- them in type over a clean picture, plain has none.
alter table public.social_clients
  add column if not exists look text not null default 'bold';
alter table public.social_clients drop constraint if exists social_clients_look_check;
alter table public.social_clients
  add constraint social_clients_look_check check (look in ('bold', 'showcase', 'plain'));

-- Which Slack alerts a post has already caused, so the team hears once:
-- {"failed:<hash>": "<when>", "soon:<hash>": "<when>", "due:<hash>": "<when>"}.
alter table public.social_posts
  add column if not exists alerts jsonb not null default '{}'::jsonb;
