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

## Getting in

The portal is the media buyer app at https://cockpit.maharamedia.com. Sign in
there once and this cockpit opens at `/editor/` with no second password;
`Switch cockpit` in the header goes back to any of the others. Seats are the
portal's `members` table, edited at `/admin`, and they are pushed into
`editor_people` whenever they change.

The swap is the one part that differs from the other cockpits. They are Convex
apps and trade the portal's two-minute pass for a session in their own
backend. This one has no backend, so it posts the pass to the portal, which
verifies the signature it made and hands back a Supabase sign-in token. The
browser never names the address it is asking about.

Email and password still works, for a day when the portal does not.

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
