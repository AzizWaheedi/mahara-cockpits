# Client review links

A finished delivery goes to the client as one link. They watch, approve
each cut or say what to change, and the notes come back here with the
second of the video they were talking about.

- **Make one:** *Send for review* in the editor cockpit. Title, client, a
  line for them, and a row per video. It hands back a URL good for 30 days.
- **Upload the cut:** the generator takes a file, not just a link. A
  Drive or Dropbox URL does not play in a video tag -- it serves a viewer
  page, not a file -- and a client who presses play and sees nothing does
  not write in to say so, they go quiet. Uploaded files go to a public
  bucket the client's browser can actually read from.
- **Send it:** paste it wherever you talk to the client, or send it from
  the WhatsApp desk in the client success cockpit.
- **Watch it:** the same screen lists every link with whether it has been
  opened and how many cuts are decided.

## How the notes reach the editor

**In the same transaction as the decision.** `review_decide` writes the
client's note into `editor_notes` -- the editor's own list, with the
timecode, `source = 'review'` and `done = false` -- so it arrives where
they already look rather than somewhere they have to remember to check.
If that write fails the decision fails with it: a note the client
believes they sent and the editor never sees is the worst outcome here.

**Slack is the nudge, not the delivery.** `hermes/review-watch` runs
every ten minutes and posts one line per review, not one per note, so a
client going through four cuts produces one message. If Slack is down or
unconfigured the notes are already in the cockpit, which is the right way
round.

## Why it is built this way

**No table is readable by the public.** The page is open to whoever holds
the link, so `anon` has no access to `review_links`, `review_items` or
`review_notes` at all. Everything goes through two security-definer
functions that take the token: a guessed or expired token returns
nothing, and there is no table to enumerate. The token is 18 random
bytes, because the link is the only credential.

**The route is answered before the sign-in gate.** A client has no
account and never will. The match is loose (`/review/<token>` anywhere in
the path) because the app is served under `/editor/` in production and at
the root in development, and a check for one breaks the other.

**Notes carry a timecode.** The playhead is captured when the client
opens the change box, so a note arrives as "0:12 — the logo at the end is
the old one" rather than a paragraph describing which shot they mean.
Pressing the timecode later jumps back to that frame.

**A change has to say something.** `review_decide` refuses an empty note
on a change request: accepting one would leave the editor with a job to
redo and nothing to go on. A note on its own with no decision *is*
allowed, because a client who has already approved may still want to add
one thing, and refusing sends them to WhatsApp where it gets lost.

**Note ids are random, not timestamps.** They were
`<item>:<epoch seconds>`, and two notes on the same cut inside one second
raised a duplicate key that rolled the whole decision back -- the client
saw an error and their note was gone. A double tap on a phone is enough.
Found by a test that did three things at once.

**A half-typed note survives a reload.** It is kept in the browser until
it is sent. Clients write these on phones, on the move, and losing one is
how a review stops being trusted.

**Who reviewed it is recorded.** Asked once, on the first decision, and
carried onto every note after that. A link gets forwarded, and "approved"
with no name on it is worth little when somebody asks later who signed
it off.

## The design

This is the only page in the repository a client ever sees, so it uses
Mahara's public palette -- Midnight, Pearl, Ocean -- rather than the
cockpit's internal teal, and Inter with IBM Plex Sans Arabic for the
Arabic that comes back in the notes.

It is built as a screening rather than a tool. The video is the whole
surface on a darker ground so the picture is the brightest thing on the
page; the decision sits directly under it as two choices rather than a
form; and the reel along the base carries each cut's decision, so the
whole delivery and how far through it they are is one glance with no
progress bar. When everything is decided the page resolves to a single
thank-you, with the reel still there to watch one again.
