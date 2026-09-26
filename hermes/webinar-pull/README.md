# Webinar pull

> 25 September correction: read [the tested checkpoint](../../docs/WEBINAR-METRICS-2026-09-25.md). `python3 pull.py readiness` is a read-only launch-settings check. Data collection health does not prove launch readiness. New code is not installed on the VPS until its separate release step.

> Objection transcripts are held by default under the current no-lead-data-to-DeepSeek decision. `WEBINAR_DEEPSEEK_TRANSCRIPTS_APPROVED=true` is only for a later explicit exception approved by Aziz; do not set it merely because a key exists. Historical tests described below predate that decision. `--dry-run` prevents database writes but can still call the model when explicitly enabled.

Reads the live training's Zoom sessions and the gift survey into Creative
Triage, hourly. The CEO cockpit's webinar funnel (Frontend tab, Webinar
funnel) computes every number from these rows on read.

Aziz, 2026-09-23: "we will collect the rest of the metrics use composio we
have zoom api. qualification in the form after also before they book a
call". The Live Training tracking brief (6 August 2026) names Zoom as the
source of truth for who showed and for how long, and Typeform for the
post-event form.

```bash
python3 pull.py doctor        # collector connections, not end-to-end readiness
python3 pull.py readiness     # read-only settings; no DB writes or transcripts
python3 pull.py               # Zoom and the survey (what cron runs)
python3 pull.py zoom --again  # read finished sessions again
python3 pull.py survey
python3 pull.py --dry-run     # read everything, write nothing
python3 -m unittest -v test_pull
```

## Reminders and objections (added the same day)

Aziz: "the scripts that you can do now, do it".

- **Reminders.** Every message HighLevel sent a registrant after they
  registered (WhatsApp, SMS, email), with the status HighLevel holds
  (sent, delivered, read, failed), through the conversations API with the
  webinar sub-account's key (`GHL_B2B_API_KEY`, location
  `7NI8yyJtwsh2OOWA5Icr`). The text is matched to the 14 WEBBY templates by
  the words after the greeting (`STEPS`) and never stored. HighLevel sits
  behind Cloudflare, which refuses Python's default user agent (error
  1010), so every call sends a browser's. Every six hours; hourly from a day
  and a half before a session to six hours after it. WhatsApp's read
  receipt is the open; clicks are the `/live` join-link clicks
  (sites/webinar). Email opens and clicks live in Kit, not here.
- **Objections.** A registrant's sales calls in Fathom (`FATHOM_API_KEY`):
  a call is theirs when an invitee's email is the registrant's and it was
  recorded after they registered. Client-service calls and team meetings
  (launch, check-in, onboarding, review, pulse) are left out by title. Each
  call is tagged once by `deepseek-flash` (the routing rule: classification
  goes to DeepSeek) into fixed categories (`CATEGORIES`), with the
  prospect's own words and whether the rep answered. At most 8 new calls a
  run (`WEBINAR_OBJECTIONS_PER_RUN`). The B2B `fathom_calls` copy stopped
  syncing on 10 September 2026, so this reads Fathom directly.

Checked on 2026-09-23 without writing: two call-funnel contacts' messages
read (WhatsApp read, delivered, failed; email), and two real sales calls
tagged (a 65-minute demo call: proof three times, contract terms, "the
management has to approve", each quoted in Arabic from the transcript).

## What it writes

Seven tables, `supabase/migrations/20260923g_webinar_collection.sql` and
`20260923i_webinar_reminders_objections.sql`, service key only (the page's
own events are in `20260923h`, written by the Edge Function, see
sites/webinar):

| Table | One row per |
| --- | --- |
| `cockpit_webinar_sessions` | Zoom meeting instance that ran (its UUID) |
| `cockpit_webinar_attendance` | join and leave pair, as Zoom gives them (people rejoin; one row per person would break the retention curve) |
| `cockpit_webinar_engagement` | chat line (from the recording's chat file), poll answer, Q&A question |
| `cockpit_webinar_forms` | gift survey response (Typeform `P1xP4r24`) |
| `cockpit_webinar_messages` | message HighLevel sent a registrant: channel, status, WEBBY step (no text) |
| `cockpit_webinar_objections` | registrant's sales call in Fathom: categories, quotes, answered or not |
| `cockpit_webinar_pulls` | run of this worker, per source (zoom, typeform, reminders, objections), with what it read or why it failed |

Rows are kept as they came; nothing here is a rate. A finished session is
`complete` once it ended more than 30 minutes ago and its recording's chat
was read (or 6 hours passed without a recording, or 48 hours in any case);
until then every run reads it again. Pitch times in the sessions table are
set in the cockpit and never written here.

## Two doors into Zoom

- **Composio first**, as Aziz asked: `COMPOSIO_API_KEY` is the consumer key
  (`ck_`), spoken over MCP exactly as the editor desk's Foreplay client
  does. Its Zoom connection reads the meeting, its cloud recordings (which
  is how sessions are found: every session records to the cloud) and a
  session's participants and chat file.
- **The Zoom app on the VPS** (`ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`,
  `ZOOM_CLIENT_SECRET`, server-to-server) for what Composio's connection
  refuses: the list of past sessions, poll results and Q&A. Zoom answered
  4711 (scopes missing) to all three through Composio on 2026-09-23. It is
  also the fallback when a Composio call fails.

The survey is read through Composio's Typeform connection.

## Matching people (the brief's rule: never by name)

A Zoom row is tied to a HighLevel contact only by a registrant id or an
email. The meeting has **no registration** (`approval_type` 2), so a guest
joins with a display name and nothing else: attendance, watch time and the
retention curve are exact, but most attendees cannot be tied to a
registrant. The cockpit shows how many were and leaves per-person rates
(attendee to booked, show rate by lead time and by ad) empty rather than
guessing. A candidate fix is Zoom registration plus unique join links; verify the full
registration-to-attendee match before treating it as solved; once registrants exist, this worker reads them and
carries each registrant's email (and a custom question whose title holds
"contact", the HighLevel contact id) onto the attendance rows.

Survey responses are tied to a registrant in the cockpit by the hidden
`user_id` (a HighLevel contact id), then the email, then the phone's last
eight digits.

## Install on the VPS

As the `hermes` user, from the repo clone at `~/mahara-cockpits`. The
Supabase pair is the editor desk's (`~/.editor-desk/env`, Creative Triage);
Composio and the Zoom app keys are in `/opt/data/bibi/api-keys.env`.

```bash
cd ~/mahara-cockpits/hermes/webinar-pull
set -a; . ~/.editor-desk/env; . /opt/data/bibi/api-keys.env; set +a
python3 pull.py doctor
```

Cron, hourly at minute 23, under a lock, log in `~/.webinar-pull.log`:

```
23 * * * *  flock -n $HOME/.webinar-pull.lock bash -c "cd $HOME/mahara-cockpits/hermes/webinar-pull && set -a; . $HOME/.editor-desk/env; . /opt/data/bibi/api-keys.env; set +a; python3 pull.py --quiet" >> $HOME/.webinar-pull.log 2>&1
```

The cockpit says when Zoom and the survey were last read, and warns when a
read failed or the last good one is over three hours old (RUNBOOK.md,
"Webinar pull").

## Settings (environment, all optional)

| Name | Default |
| --- | --- |
| `WEBINAR_ZOOM_MEETING_ID` | `88628953097`, the live training's meeting (the join link stays the same every round) |
| `WEBINAR_TYPEFORM_ID` | `P1xP4r24`, the gift survey |
| `WEBINAR_SINCE` | `2026-09-01`, the first day a session can be on |
| `WEBINAR_JOIN_LINK` | `https://webinar.maharamedia.com/live`, checked every run: the WhatsApp reminders carry it |

## Checked on 2026-09-23

- Doctor on the VPS: every key set, the five tables answer, the meeting
  reads through Composio, the Zoom app has the past-session, poll, Q&A and
  participant scopes, the survey reads (no responses yet).
- The live training has not run yet (status `waiting`), so there is no
  session to read. The whole Zoom path was run against an internal meeting
  with a recording and chat (`89523393052`, 10 September): two sessions
  found from the recordings, participants read, the chat file downloaded
  and parsed, polls read through the Zoom app, rows written, a second run
  wrote no duplicates. Those test rows were deleted.
- The join link check fails: `webinar.maharamedia.com/live` answers 404.

### Reliability release, 26 September

Install `20260926083346_webinar_atomic_snapshots.sql` before this worker version.
It writes sessions and attendance in one transaction and retains snapshot receipts.
A failed chat/poll/Q&A read preserves previous source rows and marks coverage
incomplete; no failure is converted into a successful zero after a timeout.
Recent completed Zoom instances replay for seven days; use `zoom --again` for a
full discovered-instance replay. Use `survey --full-backfill` after a prolonged
outage, then compare `received` with `source_total`; capped/repeated/missing pages
fail without advancing the survey watermark. Dry run still writes nothing.

Deploy under the existing flock/cron contract after comparing and backing up the
remote worker. Keep the transcript-provider approval hold. The stable registration
ledger migration is separate from this worker and still needs registration API
wiring. See `docs/WEBINAR-HARDENING-2026-09-26.md` for live proof and remaining gates.
