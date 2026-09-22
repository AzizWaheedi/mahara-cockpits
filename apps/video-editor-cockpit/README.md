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
  Mahara and which an editor otherwise never opens. These stay current: a
  brand document is edited in place, so the desk compares the document's own
  revision in Drive rather than its link, and reads it again only when it
  actually changed. The job page says when it last did;
- the footage, each file with its storyboard frame, its shape, whether it has
  sound, and where its shots change;
- one search box across everything anyone said in any file, with the second;
- a way to ask for what is missing. The reason a job is blocked and the
  buttons to do something about it sit in the same panel, because the moment
  a person reads "the footage folder has no video in it yet" is the moment
  they want to ask for it. One click puts it on the ClickUp card in the words
  a colleague would use, and the job remembers it was asked so nobody asks
  twice;
- where the job is on the board. Pressing "I've started" moves the ClickUp
  card to In progress and "Needs changes" moves it to Update required.
  Finishing and cancelling are deliberately absent: those are somebody else's
  decision, and the worker refuses them even if this screen asks;
- the cut: paste a link, have it checked, send it to client review;
- notes, including the ones people left on the ClickUp card.

## Running it

```bash
bun install
cp .env.example .env.local   # fill in VITE_SUPABASE_ANON_KEY
bun run dev
```

## The screens

Grouped down the left exactly as the other three cockpits are.

| Group | | |
|---|---|---|
| Your day | Jobs | grouped by what can be started, what is stuck, what is unread, what is delivered |
| | Pipeline | the same jobs as columns by their ClickUp status, so it matches the board |
| | End of day | the Video Editors Typeform's own questions, filed to the same sheet |
| The work | Footage | every clip the desk has read, across all jobs |
| Library | Ideation | the board the creative director works from; keeping something keeps it for both |
| | What works | the ads that already paid, mirrored from the media buyer |

Ideation and What works keep the names they have in the creative cockpit
because they are literally the same rows. Renaming them here would make
switching cockpits feel like two products.

## End of day

The seven questions are the Video Editors EOD form's own, in its order, and
an answer lands on the same `Video Editors` tab of the EOD Reports sheet
(`1EhPp7x0jZfV8dNjUvmuWv_alNvduMGpe_COjUAB13bw`) that the Typeform writes to.
That sheet is the accountability record for every role, so a filing from here
has to be indistinguishable from a filing from the form.

Columns are read off the tab's live header row rather than hard-coded. A
column added on the sheet cannot shift every value one to the left, and a
column this does not recognise is left empty rather than filled with its
neighbour's value. Only ever append.

## Why it stays light

The Drive frame is the most expensive thing on a job page: a whole embedded
player. It does not mount on its own. The storyboard still stands in for it
until somebody presses play, and picking another file puts the still back.
Everything else on these screens is a stored frame, signed in one batch per
page and lazily loaded.

Winners and Ideas are shared on purpose (Aziz, 2026-09-19). Winners are
mirrored into `winner_ads` by the media buyer deployment, so there is one
definition of a proven ad in the company rather than two that drift. Ideas are
not mirrored at all: this reads and writes the same `ideation_posts` rows the
creative cockpit does, and Postgres grants the browser exactly the columns a
save touches, so a scan's own numbers can never be edited from here.

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

Pushes to `main` build this app from the repository root. The Vercel project
`mahara-video-editor` has its Root Directory at the repository root, install
`bun install`, and build `bun run build`. That script installs this package
and publishes `dist/`. From a machine, the same site still ships from this folder:

```bash
scripts/ship.sh video-editor
```
