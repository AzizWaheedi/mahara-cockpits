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

One project, a folder per client, mirroring the ClickUp client card.

1. **The editor uploads a cut.** From the Premiere panel, which is built
   in, or the web app. It becomes a version in that client's folder.
2. **The creative director reviews, when the video needs it.** Sabry
   comments in the project, pointing at frames; the editor gets timecoded
   notes. Nothing has left the building, because no share link exists yet.
3. **The client reviews on a share link, created after that pass.**
   External reviewers are free and unlimited: no account, no seat, no cost.
   Where Sabry is not needed, the share is created straight after step 1.
4. **Approval closes the job.** A comment marked complete, or the client's
   approval on the share, and the desk moves the ClickUp card.

The order is the point, and it is also what keeps this free: the client
sees a cut the creative director has already been through, without paying
for the Team plan's internal comments, because the share simply does not
exist while Sabry is still looking. The editor gets both sets of notes in
the same place, at the right frames.

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

So on anything short of Enterprise -- free tier included -- whatever the
worker *pushes* to Frame.io needs a token a human re-authorises roughly
monthly. That is exactly the kind of thing that works for five weeks and
then quietly stops.

**Which is why the plan starts webhook-only.** Inbound needs no token: they
push to us, we verify a signature. Everything in the table above works with
zero OAuth and nothing that can expire. Creating projects and share links
stays manual at first -- it is a few clicks per client, done once -- and
only becomes a candidate for automation if Mahara ever moves to Enterprise,
or if the monthly re-authorisation turns out to be tolerable.

## Cost: nothing, for a long time

Aziz's three answers on 2026-09-19 changed this section completely. Karim
has a Premiere subscription; Sabry's review is not always needed; and the
spend depends on how much.

**Frame.io comes free with Karim's Premiere subscription**, and not the
crippled public free tier -- the Creative Cloud entitlement is **two users,
five projects, 100 GB, and unlimited free reviewers**. The public free plan
is two projects and 2 GB; this is not that.

Two users is Karim and Sabry, which is the whole internal side of this.
Every client is free on any plan: a reviewer on a share link needs no
account and no seat.

**Five projects against forty-one clients sounds fatal and is not.** A
Frame.io project holds folders. One project, "Client videos", a folder per
client -- the same shape as the Drive folders the desk already reads. Five
projects is then four spare, not a ceiling.

**100 GB is about three years.** Mahara's exports are short -- the footage
survey found open jobs holding minutes, not hours -- so a finished cut is
roughly 60 to 120 MB. At thirty videos a month that is about 3 GB a month,
and deleting delivered work pushes it further out.

### The Team plan is no longer needed

Internal comments were the only reason to pay $25 a seat, and they were
only needed to keep the creative director's notes off the client's screen.
Since Sabry does not review everything, and since **a share link is a thing
you create when you are ready**, the order does the same job for free:

- Sabry reviews in the project. His comments live there.
- The editor fixes, and uploads the next version.
- *Then* the share link is created, pointed at that version. The client sees
  the cut Sabry has already been through.
- Where Sabry is not needed, the share is created straight after the upload.

The one thing this does not give you is Sabry replying privately to a
comment the client has already made -- that thread is shared. That is a $10
a seat a month problem, and not one worth paying for until it bites.

### So the real numbers

| when | cost |
| --- | --- |
| now: Karim and Sabry, all 41 clients in folders | **$0** |
| a third person needs to comment internally | Pro, $15/seat, 5 members, unlimited projects, 2 TB |
| Sabry needs to talk past a client mid-thread | Team, $25/seat |

The first of those is the one to do. The other two are decisions for later,
with a real reason attached, rather than a subscription bought on spec.

## Phases

**0. Set it up free, and find out the one thing nobody documents -- half a
day, no spend.** Karim signs in to Frame.io with his Adobe account, adds
Sabry as the second user, makes one project with a folder for one client,
and runs five real videos through it end to end including a client share.

Two things get answered here, and they are why this is a phase and not a
build:

1. **Can Sabry be the second user without his own Creative Cloud
   subscription?** The entitlement says two users share the account, and
   that Frame.io users are separate from Creative Cloud users, but Adobe's
   own wording hedges. Five minutes to find out.
2. **Can a webhook be created on this account at all?** Creating one needs
   an OAuth app in the Adobe Developer Console, and nothing documents
   whether a Creative-Cloud-backed account may do that. It is the hinge for
   everything below, so test it before writing any code.

And the real question underneath both: does the review actually move there,
or does everybody go back to WhatsApp.

**Worth saying plainly: phase 0 is most of the value.** Frame-accurate
review with the client, at no cost, is the bulk of what Frame.io is for.
Everything below only saves re-typing.

**1. The webhook -- two days, only if phase 0 says the account can make
one.** `api/frameio.ts` beside `api/watchdog.ts` on the media buyer
deployment, which already holds the Supabase service key. Verify the HMAC,
map the event, write `editor_notes` with a real `at_sec`, put the review
link on the job. Tests around the signature check and the mapping, in the
shape the worker's 145 already have. No OAuth in the running path and
nothing scheduled, so there is nothing to expire.

*If the account cannot create a webhook*, the fallback is polling the
comments endpoint with a user OAuth token that a human re-authorises about
monthly. That is worse, and worth doing only once phase 0 has proved the
review loop is real.

**2. The loop closes -- two days.** A first client comment moves the ClickUp
card to Update required; an approval moves it to done. The job page shows
the notes against their frames. The status buttons in the cockpit stay, so
a failure here is inconvenient rather than blocking.

**3. Pay for something, only with a reason.** Pro when a third person needs
to comment internally. Team when Sabry actually needs to answer a client
privately. Not before.

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

## Answered, 2026-09-19

- **Karim has a Premiere subscription**, so the free entitlement is real and
  phase 0 costs nothing. Sabry's own subscription status is the thing to
  check in the first five minutes.
- **Cost depends on how much.** It is nothing to start, and the two paid
  steps each have a trigger rather than a date.
- **Sabry does not review everything.** So internal comments, and the Team
  plan with them, are off the plan; sequencing the share link after his pass
  does the same job for free.
