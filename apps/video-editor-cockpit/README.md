# Video editor cockpit

The screen for the [editor desk](../../hermes/editor-desk). The worker on the
VPS reads the ClickUp Video Pipeline, finds each job's footage in Drive, reads
it, and writes what it learned to Supabase. This is where a person sees it.

Aziz, 2026-09-18: *"generation and actual cutting and editing keep it to them,
just the rest to make them more efficient."* So there is no timeline here, no
generator and no caption burner. What there is:

- every open job with what is blocking it, in plain sentences;
- the brand work for that client, joined by the tag on the card: the do's and
  don'ts, the Brand DNA and the offer cheat sheet, which live on Clients -
  Mahara and which an editor otherwise never opens;
- the footage, each file with its storyboard frame, its shape, whether it has
  sound, and where its shots change;
- one search box across everything anyone said in any file, with the second;
- the cut: paste a link, have it checked, send it to client review;
- notes, including the ones people left on the ClickUp card.

## Running it

```bash
bun install
cp .env.example .env.local   # fill in VITE_SUPABASE_ANON_KEY
bun run dev
```

## How it is allowed to read anything

The anon key is public by design. Every `editor_*` table has row security on
with a single policy that calls `public.is_editor()`, which is true only for an
address on `editor_people` that is still active. A key on its own reads nothing.

The browser never holds the ClickUp key or the Google token. Anything that has
to touch the board is written to `editor_requests` and drained by the worker,
the same queue shape the ideation radar already runs on.

## Deploying

```bash
scripts/ship.sh video-editor
```
