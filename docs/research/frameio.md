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

## Where it lands in the cockpit

Two screens change, both in the editor cockpit, and both are sections that
already exist. Nothing new gets built that Frame.io could take away.

### Job page, "The cut" -- the review link beside the Drive link

Today this section is a text box for a Drive link and two buttons, Check it
first and Deliver. It gains one line above them:

```
The cut
┌──────────────────────────────────────────────────────────┐
│  v3 · with the client since Tuesday · 2 notes open       │
│  [ Open in Frame.io ↗ ]                                  │
└──────────────────────────────────────────────────────────┘
  Link to the cut in Drive
  [ https://drive.google.com/file/d/…            ]
  [ Check it first ]  [ Deliver ]
```

The Drive box stays. Frame.io is additive: if a job has no Frame.io file
the line is absent and the page is exactly what it is now. That is the
whole defence against this becoming load-bearing.

The version and the state come from `GET /files/{file}`; "2 notes open" is
a count of `editor_notes` rows for this job with `done` false.

### Job page, "Notes" -- the notes get a frame

The notes list already has a checkbox per note and already renders
`at_sec`. What changes is that `at_sec` is finally populated, because today
it comes from a regular expression hunting for something shaped like `1:24`
in ClickUp comment text, and is usually null.

```
Notes
  ☐  0:42  Cut the pause before she says the price     Sabry · Frame.io
  ☑  1:07  Logo should be bottom-right here            Client · Frame.io
  ☐  —     Client wants it 15s for stories             Aziz · ClickUp
```

Three small things, all cheap:

- the timecode is a link that opens Frame.io at that frame;
- a source badge, because "the client said this" and "Sabry said this"
  should not look the same;
- the checkbox follows `comment.completed` both ways -- ticking it here
  marks it resolved there, so the editor is not keeping two lists.

### Pipeline and Jobs -- nothing new, just true

The pipeline board already mirrors ClickUp status. Frame.io is what makes
those columns move on their own: a first client comment sets Update
required, an approval sets the card done. The status buttons Aziz asked for
stay exactly where they are, because somebody still has to be able to move
a card when the automation is wrong or not involved.

### The creative director's cockpit -- one list, and only if wanted

Sabry's review happens in Frame.io; that is the tool. The only thing worth
adding to his cockpit is a list of cuts waiting on him, on the Work page he
already opens. It is a read of `editor_jobs` filtered to "has a Frame.io
file, not yet shared with the client" -- no new table, no new backend.

Optional on purpose. If he would rather work from Frame.io's own inbox,
nothing is lost.

### The media buyer, and the client

The media buyer's cockpit gets nothing. There is no step here that is his.

**The client never touches the cockpit**, and that is the point of choosing
Frame.io over building a review screen: a share link needs no account, no
seat and no support. There is nothing to provision for forty-one clients
and nothing to revoke when one leaves.

## How it plugs into what is already here

Very little new. `editor_notes` was built for this and has been waiting:

## The APIs, and a correction

I said earlier that the inbound half needs no OAuth. **That was wrong, and
it is worth being exact about why.** A Frame.io webhook payload is a thin
envelope: it carries IDs and nothing else. Here is their own example,
verbatim:

```json
{
  "account":   { "id": "6f70f1bd-…" },
  "project":   { "id": "7e46e495-…" },
  "resource":  { "id": "d3075547-…", "type": "file" },
  "type":      "file.ready",
  "user":      { "id": "56556a3f-…" },
  "workspace": { "id": "378fcbf7-…" }
}
```

A `comment.created` event tells you a comment exists and gives you its id.
It does not give you the text, the frame, or who wrote it. To get those you
call the API back -- and that needs a token.

### The endpoints we would actually use

| what | call |
| --- | --- |
| the comment the webhook just named | `GET /v4/accounts/{account}/comments/{comment}` |
| every comment on a cut (the polling fallback) | `GET /v4/accounts/{account}/files/{file}/comments` |
| the cut itself, for its version and name | `GET /v4/accounts/{account}/files/{file}` |
| a client review link | `POST /v4/accounts/{account}/projects/{project}/shares` |

All on `https://api.frame.io`, bearer token, and all read-only except the
last.

**A trap worth writing down now:** the comment's `timestamp` is a
**framestamp, counting from 1**, not seconds -- their migration guide says
so explicitly, and their own forum has people caught by it. `editor_notes`
stores `at_sec`, so it needs the frame rate to convert, and the file object
does not obviously carry one. First thing to check against a real comment
during the pilot, before any of this is written.

### What that means for tokens

| | |
| --- | --- |
| access token | 24 hours |
| refresh token | **14 days**, and using one returns a new one |
| server-to-server, no expiry | Enterprise only |

So it rolls: anything refreshing more often than fortnightly should keep
going indefinitely. Adobe does not actually promise that in writing, so the
right assumption is that it will break one day, and the job is to make the
break loud and the fix one click.

**Which is exactly what the desk already does for Google Drive.** It finds
footage through a stored OAuth refresh token it renews on every run. This
is the same pattern, in the same worker, with the same failure handling --
not a new class of fragility, just a second token in a place that already
has one.

### So the shape is: dumb webhook, worker does the work

1. **A Vercel function receives the event.** Verifies the HMAC, checks the
   timestamp is recent, writes one row to `editor_requests` with the event
   type and the resource id. No token, no API call, nothing that can fail
   slowly. It is about twenty lines.
2. **The worker drains it**, the same way it drains everything else the
   cockpit asks for. It holds the Frame.io refresh token beside the Google
   one, fetches the comment, and writes `editor_notes`.

Two things fall out of that split, and both matter:

- **A token failure loses nothing.** The events are already queued. When the
  token is fixed the backlog drains.
- **The webhook is an optimisation, not a dependency.** If phase 0 finds
  this account cannot create one, the worker polls
  `GET /files/{id}/comments` for the open jobs on the run it already makes
  every twenty minutes. Same token, same code, one less moving part. The
  plan does not collapse on the one unknown.

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

## Who makes the account

Aziz asked whether he can just make it. Yes, and he should -- but which
tier he gets depends on whose Adobe subscription it is created under, and
that is not something you can change later.

**The entitlement is not transferable.** Adobe says so plainly: it is tied
to the Creative Cloud account that claimed it. And Adobe's own advice for
teams is that "your administrator be the first person to sign in to
Frame.io and create the account" -- whoever signs in first owns it.

**Mahara pays for the subscriptions, individually** (Aziz, 2026-09-19).
That settles most of it: the subscriptions sit on `@maharamedia.com`
addresses, so whichever one signs in, the Adobe account is on a domain Aziz
controls and can recover. The account cannot walk out with an employee.

So, in order:

1. **If any Mahara-paid subscription is on an address Aziz uses himself,
   sign in with that one.** Cleanest: the account is his, and it does not
   depend on Karim's licence staying active.
2. **Otherwise sign in with `karim@maharamedia.com`** -- it carries the
   Premiere subscription, so it claims the entitlement, and it is a Mahara
   mailbox rather than a personal one. Then add Sabry as the second user.
   The one thing to watch is that cancelling Karim's licence would take the
   entitlement with it, because Adobe says it is not transferable.
3. **Do not sign in with a personal Adobe account**, anyone's. That is the
   only way to end up with the company's review history attached to a
   person.

Either way the tier is the same: **two users, five projects, 100 GB,
unlimited free reviewers.**

Worth a thought at renewal, not now: consolidating those individual
subscriptions onto **Creative Cloud for teams** would put Aziz in the Adobe
Admin Console as administrator and raise the Frame.io side to **3 TB pooled
plus 2 TB per licence, up to 15 members** -- more than the $25-a-seat Team
plan this document was originally costing, bundled. It is a billing change
rather than a Frame.io decision, so it belongs at the next renewal, once
the pilot has said whether any of this is worth keeping.

There is also a **30-day Frame.io Team trial** on first sign-up, which
includes internal comments and up to 15 members. Worth spending it during
the pilot rather than letting it lapse unused -- it is the cheapest way to
find out whether internal comments are wanted before deciding they are not.

## Phases

**0. Set it up free, and find out the one thing nobody documents -- half a
day, no spend.** Aziz signs in to frame.io first, with the Mahara Adobe
login that holds a Premiere subscription, so the account is the company's
and claims the entitlement (see above). He adds Karim and Sabry, makes one project with a folder for one client,
and runs five real videos through it end to end including a client share.

Two things get answered here, and they are why this is a phase and not a
build:

1. **Can Sabry be the second user without his own Creative Cloud
   subscription?** The entitlement says two users share the account, and
   that Frame.io users are separate from Creative Cloud users, but Adobe's
   own wording hedges. Five minutes to find out.
2. **Can an OAuth app be created in the Adobe Developer Console for this
   account?** This is the real hinge -- not the webhook, which is optional,
   but the token. Without one, nothing can read a comment back and the
   integration is off; the review loop still works, by hand, and still
   costs nothing.
3. **What unit is a comment's `timestamp`?** Their docs say a framestamp
   from 1, their create example looks like seconds, and their forum has
   people caught between the two. One real comment settles it, and it
   decides how `at_sec` is computed.

And the real question underneath both: does the review actually move there,
or does everybody go back to WhatsApp.

**Worth saying plainly: phase 0 is most of the value.** Frame-accurate
review with the client, at no cost, is the bulk of what Frame.io is for.
Everything below only saves re-typing.

**1. Notes arrive with their frames -- two to three days.** Two pieces, in
this order, because the second is useful without the first:

*The worker half, which is the part that matters.* A Frame.io refresh
token stored beside the Google one, renewed on every run. A `frameio`
command that reads the open jobs' comments and writes `editor_notes` with
a real `at_sec`. Tests around the framestamp conversion and the token
refresh, in the shape the worker's 145 already have. This works on its own,
polling every twenty minutes, with no webhook at all.

*The webhook half, if phase 0 says the account can create one.*
`api/frameio.ts` beside `api/watchdog.ts`: verify the HMAC, check the
timestamp, queue one row. Twenty lines, no token. It turns twenty minutes
into seconds and nothing depends on it.

Also here: the review link and version on the job page, which is a read of
one field.

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

- **Karim has a Premiere subscription and Mahara pays for it**, as an
  individual subscription rather than through Creative Cloud for teams. So
  the free entitlement is real, phase 0 costs nothing, and the Adobe login
  is on a Mahara address either way. Whether Sabry can be the second user
  without his own subscription is the thing to check in the first five
  minutes.
- **Cost depends on how much.** It is nothing to start, and the two paid
  steps each have a trigger rather than a date.
- **Sabry does not review everything.** So internal comments, and the Team
  plan with them, are off the plan; sequencing the share link after his pass
  does the same job for free.
