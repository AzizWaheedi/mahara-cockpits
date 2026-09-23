# Webinar pull

Reads the live training's Zoom sessions and the gift survey into Creative
Triage, hourly. The CEO cockpit's webinar funnel (Frontend tab, Webinar
funnel) computes every number from these rows on read.

Aziz, 2026-09-23: "we will collect the rest of the metrics use composio we
have zoom api. qualification in the form after also before they book a
call". The Live Training tracking brief (6 August 2026) names Zoom as the
source of truth for who showed and for how long, and Typeform for the
post-event form.

```bash
python3 pull.py doctor        # every key by name, each door, the join link
python3 pull.py               # Zoom and the survey (what cron runs)
python3 pull.py zoom --again  # read finished sessions again
python3 pull.py survey
python3 pull.py --dry-run     # read everything, write nothing
python3 -m unittest -v test_pull
```

## What it writes

Five tables, `supabase/migrations/20260923g_webinar_collection.sql`, service
key only:

| Table | One row per |
| --- | --- |
| `cockpit_webinar_sessions` | Zoom meeting instance that ran (its UUID) |
| `cockpit_webinar_attendance` | join and leave pair, as Zoom gives them (people rejoin; one row per person would break the retention curve) |
| `cockpit_webinar_engagement` | chat line (from the recording's chat file), poll answer, Q&A question |
| `cockpit_webinar_forms` | gift survey response (Typeform `P1xP4r24`) |
| `cockpit_webinar_pulls` | run of this worker, per source, with what it read or why it failed |

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
guessing. Turning Zoom registration on, and sending each registrant their
own join link, fixes it; once registrants exist, this worker reads them and
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
