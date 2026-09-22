# Team meetings, from the calendar

Keeps `team_meetings`, `team_people`, `team_meeting_people` and
`team_sittings` in step with Google Calendar. Hourly.

```bash
python3 sync.py
```

## What counts as a meeting

Aziz's rule: **if there is no meeting link attached, it does not count.**
That removes the personal blocks -- Morning Workflow, Sleep, his own
planning hours -- which are most of what a calendar holds.

A link alone is not enough. Every client call has one too, and there are
ten times more of those. So three things together:

1. **A meeting link** -- Meet, Zoom or Teams, on the event or in its
   location or description.
2. **Two or more of our own people, counting the organiser**, who is
   usually not in the attendee list. Without counting them every 1:1 has
   one person on it and is dropped as a solo block.
3. **Nobody from outside.** This is what separates a 1:1 with Nada from a
   client call: both are two people with a Meet link.

Against the live calendars that is 19 meetings out of 801 entries.

## Sixteen calendars, not one

The meetings are not on Aziz's calendar. They are on Miriam's, Saleh's
and Abdulelah's. Scanning only the primary calendar found four of the
nineteen.

## People

The EOD roster only holds the people who file one, so the team leads
whose calendars carry most of the meetings were missing entirely.
Anyone on our own domain who appears on an internal meeting is on the
team by definition and is added.

`ALIASES` exists because the roster spells some people one way and their
email another -- `sabry@` is the Sabri on the roster, `lamah@` is Lama.
A near-match created a second row for the same person; the map was
checked by hand once and stops the sync undoing the merge.
