# Team meetings, from Google Calendar

Keeps the cockpit's team meetings (`team_meetings`, `team_meeting_series`,
`team_people`, `team_meeting_people`, `team_sittings`) in step with Google
Calendar, every five minutes. The other direction, the cockpit writing to
Google, is `apps/media-buyer-cockpit/convex/teamCalendar.ts`.

```bash
python3 sync.py                 # one pass
python3 sync.py --dry-run       # what a pass would change, nothing written
python3 sync.py links           # propose Google series for the cockpit's own meetings
python3 sync.py links --apply   # and link the exact matches
python3 sync.py doctor          # which Google sign-in and Supabase it reaches
python3 -m unittest -v test_sync
```

## Cron (VPS, user `hermes`)

```
*/5 * * * *  flock -n $HOME/.teamsync.lock bash -c "cd $HOME/mahara-cockpits/hermes/team-sync && set -a; . $HOME/.editor-desk/env; . /opt/data/bibi/api-keys.env; [ -f $HOME/.team-sync/env ] && . $HOME/.team-sync/env; set +a; python3 sync.py" >> $HOME/.teamsync.log 2>&1
```

`$HOME/.team-sync/env` holds `GOOGLE_CAL_CLIENT_ID`, `GOOGLE_CAL_CLIENT_SECRET`
and `GOOGLE_CAL_REFRESH_TOKEN`: the CEO account's OAuth client with the
calendar scope, the same three the cockpit's Convex deployment writes with.
They are set by hand, never committed and never printed. Until they are
there, the editor desk's Google sign-in reads the calendars; `doctor` says
which one a pass used.

## What a meeting is keyed on

The calendar that organises it and the recurring event's id (a single
event's own id when it does not repeat). Not the title: renaming an event in
Google renames the same meeting. A title only names a meeting the first time
it is seen.

A meeting can be several series. The CEO's calendar holds the v5 week as one
series per day where the day has a theme of its own (CSM Daily is five weekly
series, Call Center three), each titled for its day; all of them are one
cockpit meeting, listed in `team_meeting_series`. The rest of a series split
in Google Calendar ("this and following events", id `<id>_R<date>`) stays
the same meeting, and so does an event the cockpit made for a single sitting
(it carries the meeting's id in its private properties).

## What Google decides, and what it never touches

For a linked meeting Google is the truth for its days, start, length,
recurrence, end, Meet link and guests, and for its sittings: one per
occurrence with its real times, moved or cancelled. A sitting belongs to the
day it was planned for, so one moved to another day keeps its notes. An
occurrence Google drops is removed from the cockpit, unless something hangs
on it (notes, a spin, the week's goal, a closed agenda item): then it stays,
cancelled.

Guests added in Google are added, guests taken off are marked removed, and a
part chosen on the page (host, required, optional) stays unless Google's
optional flag for that person changed. Only a calendar the account can edit
shows the whole guest list, so only there is anyone taken off. A person put
in on the page before the meeting was on the calendar was never on the
invite, so the invite does not take them off.

The sync never touches a purpose, a doc, notes, agendas, the run of show,
wheels or the creative pipeline, and it skips any meeting with a change
still on its way to Google (`team_calendar_ops`, status `pending`), so it
never undoes an edit that has not landed yet.

## What counts as a meeting

For a series no meeting owns yet, three things together:

1. **A meeting link**: Meet, Zoom or Teams, on the event or in its location
   or description. That rules out personal time blocks.
2. **Two or more of our own people, counting the organiser**, who is often
   not in the attendee list.
3. **Nobody from outside.** This is what separates an internal 1:1 from a
   client call: both are two people with a link.

A series that ends in the next two weeks is not made a meeting, and one whose
title matches a meeting the old hourly sync filed by title joins that
meeting as another series instead of making a second one.

## People

Anyone on our own domain who turns up on an internal meeting is on the team
and is added to `team_people`. An address is matched by the email the roster
holds; a roster row with no email yet takes the address of the first guest
whose first name is its first name, once, so the match is exact from then
on. Nobody's name or address is written in this code.

## Quiet meetings

A calendar meeting with no occurrence in the last 21 days and none in the
next 45 is marked inactive. Never deleted, and never a meeting the cockpit
manages (`managed = 'cockpit'`). A pass where a calendar could not be read
marks nothing inactive. The first v5 pass (2026-09-27) switched off eight
one-to-ones whose last sitting was 1 September.
