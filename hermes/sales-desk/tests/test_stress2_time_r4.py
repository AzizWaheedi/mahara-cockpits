"""TIME stress, second series, round 4, desk side: the days after a lead talked
to a rep on video, with rooms.count_on_join off as it ships. Every lead and
figure is invented.

    python3 -m unittest tests.test_stress2_time_r4

With count_on_join off, sales-api's count never runs (rooms.ts runCount
answers "skipped"): a room the lead joined keeps lead_in_at and has
count_result null and count_appointment_id null. followups.live_calls()
reads a join only when the count booked or moved a call, reported it
(self_reported) or marked the room's own call (count_appointment_id), so
every video call of the shipped setup is invisible to the desk. Its own
words: "The lead talked to a rep on video, so no 'we missed you' and no
never-booked opener goes to them." A failure here is a finding.
"""
from __future__ import annotations

import os
import unittest
from datetime import timedelta
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu  # noqa: E402
from desk import http, waves  # noqa: E402
from tests import fakes  # noqa: E402
from tests.test_waves import NOW, sb, seed  # noqa: E402

fakes.PK.setdefault("cockpit_sales_rooms", ("id",))


def pg_with_rooms() -> fakes.FakePostgrest:
    pg = fakes.FakePostgrest()
    pg.tables.setdefault("cockpit_sales_rooms", {})
    return pg


def video_call_count_off(pg: fakes.FakePostgrest, c: str, joined, purpose: str = "manual") -> None:
    """The room as sales-api leaves it with count_on_join off: the lead joined and the
    call ran twenty minutes; nothing was counted (count_result and its call id null)."""
    pg.put("cockpit_sales_rooms", {
        "id": f"room-{c}", "contact_id": c, "purpose": purpose, "trigger": None, "call_kind": "intro",
        "provider": "zoom", "host_email": "setter@stress.invalid", "state": "ended", "result": "joined",
        "end_reason": "finished", "lead_in_at": joined.isoformat(),
        "ended_at": (joined + timedelta(minutes=20)).isoformat(),
        "count_claimed_at": None, "count_result": None, "count_appointment_id": None, "count_undo_at": None,
    })


class VideoCallCountOff(unittest.TestCase):
    def test_the_desk_sees_the_video_call(self):
        """Sunday 07:00 (UTC): the lead talked to the setter on video at 04:00 (07:00 Kuwait),
        from the lead page's video room. live_calls() is the desk's only record of it."""
        pg = pg_with_rooms()
        video_call_count_off(pg, "stress-t2r4-video-1", NOW - timedelta(hours=3))
        with mock.patch.object(http, "request", pg):
            seen = fu.live_calls(sb(), ["stress-t2r4-video-1"])
        # Found []: the join that stands, with nothing counted, is in none of the three reads.
        self.assertEqual(len(seen), 1, "a video call the lead held with a rep three hours ago is not seen by the desk")

    def test_no_never_booked_opener_to_a_lead_who_talked_on_video_yesterday(self):
        """A backlog lead who never booked: the setter took them into a video room yesterday
        and they talked for twenty minutes, with no booking at the end of it."""
        pg = pg_with_rooms()
        seed(pg, "stress-t2r4-video-2", "never_booked", days=60)
        video_call_count_off(pg, "stress-t2r4-video-2", NOW - timedelta(hours=26))
        with mock.patch.object(http, "request", pg):
            out = waves.pools(sb(), NOW)
        # Found: still in the never-booked pool, so the next wave writes them
        # the CEO's opener as if nobody had ever spoken to them.
        self.assertNotIn("stress-t2r4-video-2", [c for c, _ in out["never_booked"]],
                         "a lead who talked to a rep on video yesterday is still 'never booked'")

    def test_no_missed_you_step_the_day_after_the_lead_talked_on_video(self):
        """Monday 10:00 (Kuwait) intro: a no-show. The agent's first 'no_show' step went at 10:15.
        Tuesday 11:00 the setter sent a video link from the lead page and the lead talked for twenty
        minutes (the link's WhatsApp is the cockpit's last send). Wednesday 11:30, past the 20-hour
        gap after that send, the next 'no_show' step ('we missed you, shall we rebook?') is due."""
        c = "stress-t2r4-video-5"
        now = NOW + timedelta(days=3, hours=1, minutes=30)          # Wednesday 07 Oct 08:30 UTC (11:30 Kuwait)
        intro = NOW + timedelta(days=1)                               # Monday 05 Oct 07:00 UTC (10:00 Kuwait)
        joined = NOW + timedelta(days=2, hours=1)                     # Tuesday 06 Oct 08:00 UTC (11:00 Kuwait)
        lead = {"contact_id": c, "name": "Omar", "country": "KW", "lead_class": "qualified",
                "lead_created_at": (intro - timedelta(days=3)).isoformat(), "tags": ["roas-qualified"]}
        calendar = [{"appointment_id": f"{c}-intro", "contact_id": c, "call_type": "intro", "status": "noshow",
                     "start_at": intro.isoformat(), "booked_at": (intro - timedelta(days=2)).isoformat()}]
        followups = [{"contact_id": c, "segment": "no_show", "status": "sent",
                      "decided_at": (intro + timedelta(minutes=15)).isoformat(),
                      "created_at": (intro + timedelta(minutes=15)).isoformat()}]
        sends = [{"contact_id": c, "created_at": (joined - timedelta(minutes=2)).isoformat(), "state": "sent",
                  "via": "conversation", "channel": "whatsapp"}]
        pg = pg_with_rooms()
        video_call_count_off(pg, c, joined)
        with mock.patch.object(http, "request", pg):
            calendar = fu.with_live(calendar, fu.live_calls(sb(), None, since=now - timedelta(days=30), until=now))
        picked = fu.pick(now, inbox=[], calendar=calendar, leads=[lead], followups=followups, sends=sends)
        # Found [no_show]: the next "we missed you" step is drafted for a lead
        # who talked to the setter on video the day before.
        self.assertEqual([p["segment"] for p in picked if p["contact_id"] == c], [],
                         "the missed-call sequence goes on for a lead who talked to a rep on video yesterday")
        # Control: the same join with the count on (booked) ends the sequence (booked_again).
        pg.rows("cockpit_sales_rooms")[0].update({"count_result": "booked", "count_appointment_id": f"live-{c}",
                                                  "count_claimed_at": joined.isoformat()})
        base = [x for x in calendar if not x.get("live")]
        with mock.patch.object(http, "request", pg):
            counted = fu.with_live(base, fu.live_calls(sb(), None, since=now - timedelta(days=30), until=now))
        again = fu.pick(now, inbox=[], calendar=counted, leads=[lead], followups=followups, sends=sends)
        self.assertEqual([p["segment"] for p in again if p["contact_id"] == c], [])

    def test_control_a_counted_live_call_is_seen(self):
        pg = pg_with_rooms()
        video_call_count_off(pg, "stress-t2r4-video-4", NOW - timedelta(hours=3))
        pg.rows("cockpit_sales_rooms")[0].update({"count_result": "booked", "count_appointment_id": "live-4",
                                                  "count_claimed_at": (NOW - timedelta(hours=3)).isoformat()})
        with mock.patch.object(http, "request", pg):
            seen = fu.live_calls(sb(), ["stress-t2r4-video-4"])
        self.assertEqual(len(seen), 1)


if __name__ == "__main__":
    unittest.main()
