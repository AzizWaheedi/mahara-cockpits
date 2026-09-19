# Frame.io between the editor, the creative director and the client

Researched 2026-09-19. A plan, not a build.

## The problem it solves

A revision note today is a sentence in a ClickUp comment. The desk reads
those comments hourly into `editor_notes`, and to find out *where* in the
video a note refers to it runs a regular expression over the text looking
for something shaped like `1:24` (`desk.py`, the `notes` command). If
nobody typed a timestamp, `at_sec` is null and the editor scrubs.

That is the whole gap. Everything else in the loop already works: the job,
the brief, the footage, the version check, the delivery. What is missing is
a place to point at a frame and say "this bit".

The second gap is the client. Right now a cut reaches them as a link out of
the cockpit, and whatever they say comes back by whatever route they chose.
None of it lands in `editor_notes`, so the next editor to touch that client
cannot see what they asked for last time.

## What the flow becomes

One Frame.io project per client, mirroring the ClickUp client card.

1. **The editor uploads a cut.** From the Premiere panel, which is built in,
   or the web app. It becomes a version on that project.
2. **The creative director reviews first, privately.** On the Team plan,
   comments can be marked internal -- the client never sees them. Sabry
   points at frames; the editor gets timecoded notes; nothing has left the
   building yet.
3. **The client reviews on a share link.** External reviewers are free and
   unlimited: no account, no seat, no cost. Passphrase-protected and
   custom-branded on Pro and above.
4. **Approval closes the job.** A comment marked complete, or the client's
   approval on the share, and the desk moves the ClickUp card.

The order matters and is the point: the client sees a cut the creative
director has already been through, and the editor gets both sets of notes
in the same place, at the right frames.

## How it plugs into what is already here

Very little new. `editor_notes` was built for this and has been waiting:

| column | today | with Frame.io |
| --- | --- | --- |
| `at_sec` | a regex over the comment text, usually null | the comment's own frame, exact |
| `text` | the ClickUp comment | the Frame.io comment |
| `by_email` / `by_name` | the ClickUp user | the commenter, or the client's name on the share |
| `source` | `clickup` or `cockpit` | `frameio` |
| `done` | never set | `comment.completed` from the webhook |
| `version` | the cut number | the version stack position |

Three touch points, in order of value:

- **Inbound: a webhook.** Frame.io pushes `comment.created`,
  `comment.completed`, `file.versioned`, `file.upload.completed` and
  `share.viewed`, signed HMAC SHA256, scoped to a workspace. A Vercel
  function on the media buyer deployment (beside `api/watchdog.ts`, which
  already holds the Supabase service key) verifies the signature and writes
  `editor_notes`. **This needs no OAuth at all** -- see the next section for
  why that matters more than it sounds.
- **The cockpit reads it.** The job page already lists notes and already
  has a place for a preview; a Frame.io review link is the same shape as the
  Drive link it shows now. No new data layer.
- **ClickUp keeps moving.** The desk's existing writeback already sets the
  status and the Edited Video Link. A first comment becomes "Update
  required", an approval becomes done -- the buttons Aziz asked for in the
  cockpit, driven by what actually happened in review instead of by
  somebody remembering to press them.

One more that is nearly free: the Do's and Don'ts path already exists
(`desk/brand.py` appends, never replaces). A note the client repeats across
three videos is a house rule, and this is the first time we would have the
data to notice.

## The one hard constraint: authentication

Frame.io V4 authenticates with Adobe IMS OAuth. There are two kinds:

- **Server-to-server** -- client credentials, no refresh token, nothing to
  expire. This is what an unattended worker wants. It is **Enterprise only**
  (Frame.io staff, on their forum: "If you're on an enterprise plan, you
  should have access to S2S"), and needs the account administered through
  the Adobe Admin Console.
- **User OAuth** -- needs `offline_access` for a refresh token, and that
  refresh token expires in about 30 days for a standard OAuth app.

So on a Pro or Team plan, anything the worker *pushes* to Frame.io needs a
token a human re-authorises roughly monthly. That is exactly the kind of
thing that works for five weeks and then quietly stops.

**Which is why the plan starts webhook-only.** Inbound needs no token: they
push to us, we verify a signature. Everything in the table above works with
zero OAuth and nothing that can expire. Creating projects and share links
stays manual at first -- it is a few clicks per client, done once -- and
only becomes a candidate for automation if Mahara ever moves to Enterprise,
or if the monthly re-authorisation turns out to be tolerable.

## Cost

| plan | seats | what it gives | monthly |
| --- | --- | --- | --- |
| Frame.io for Creative Cloud | 2 | 5 projects, 100 GB. Included with Premiere Pro or All Apps. | 0 |
| Pro | up to 5 | unlimited projects, 2 TB, branded and passphrase shares | $15/seat |
| Team | up to 15 | 3 TB, **internal comments**, restricted projects | $25/seat |

Clients cost nothing on any plan: reviewers on a share link are free and
unlimited, and do not count toward the seat total.

The step that matters is **internal comments, which are Team only**. Without
them the creative director's notes and the client's notes are the same
conversation, and the whole "Sabry first, then the client" order collapses.

Realistic shape: seats for the editors, Sabry, the media buyer and Aziz,
call it six -- **$150/month, about $130 annual**. Against Foreplay's $389
that is small, but it is the second recurring bill this quarter, so it
should earn its place in a pilot before it is signed.

Storage is not a worry. The footage survey found the open jobs holding
minutes, not hours; 3 TB is far past what Mahara makes.

## Phases

**0. Pilot on the free tier -- no spend, about half a day.** Frame.io for
Creative Cloud gives two seats to anyone with a Premiere subscription.
Karim and Sabry, one client, five real videos. What we are testing is
whether the review actually moves there or whether people keep going back
to WhatsApp. Nothing is built.

**1. The webhook -- two days.** `api/frameio.ts` on the media buyer
deployment: verify the HMAC, map the event, write `editor_notes` with real
`at_sec`, mirror the Frame.io link onto the job. Tests around the signature
check and the mapping, in the shape the worker's 145 already have. Still no
OAuth, nothing scheduled, nothing that can expire.

**2. The loop closes -- two days.** First client comment moves the ClickUp
card to Update required; an approval moves it to done. The editor's job page
shows the notes against the frames. The existing status buttons stay, so a
failure here is inconvenient, not blocking.

**3. Only if phase 0 says yes -- Team plan, internal comments, every
client.** One project per client card. This is the paid step and the one to
decide last.

## What could break, and what happens when it does

- **Frame.io is down, or the webhook is missed.** Notes stop arriving; the
  ClickUp comment path keeps working exactly as it does today. Nothing in
  the cockpit depends on Frame.io being up. Missed events are recoverable
  by reading the project's comments once a token exists, or by hand.
- **The signing secret is only shown once, at webhook creation.** It goes
  in the Vercel environment the same way `WATCHDOG_TOKEN` did. Write it down
  when it is created or the webhook has to be recreated.
- **A replayed webhook.** The HMAC covers a timestamp; reject anything more
  than a few minutes old, and key `editor_notes` on the Frame.io comment id
  so a duplicate is an upsert rather than a second note.
- **V2 endpoints are switched off on 1 December 2026.** Everything here is
  V4, so this is only a warning against following an old tutorial.
- **Somebody adds a fourth cockpit.** The webhook writes to `editor_notes`,
  which every cockpit already reads through its own gate. Nothing to change.

## What I need from Aziz

1. **Does Karim have a Premiere Pro or Creative Cloud subscription, and does
   Sabry?** If yes, phase 0 costs nothing and can start today.
2. **Is a second recurring bill acceptable if the pilot works?** About
   $130/month for six seats, on top of Foreplay's $389.
3. **Who reviews first?** The plan above puts Sabry before the client. If
   some clients should see cuts directly, that is fine, but it wants saying
   now because it changes whether internal comments are needed at all.

