"""TIME stress for the desk: the waves job's sends run every 5 minutes on a
fake clock for a whole week, for leads in UTC+3 and UTC+4, across Kuwait's
midnight, the quiet hours and the Friday day off, checked against each lead's
real clock (zoneinfo). Every lead and line is invented; nothing leaves the
process.

    python3 -m unittest tests.test_stress_time
"""
from __future__ import annotations

import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest import mock
from zoneinfo import ZoneInfo

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu, http, waves  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_waves import GATE_OPEN, SETTINGS, Api, Clock, sb  # noqa: E402

UTC = timezone.utc
ZONES = {"Kuwait": "Asia/Kuwait", "UAE": "Asia/Dubai", "Oman": "Asia/Muscat", "Saudi Arabia": "Asia/Riyadh",
         "AE": "Asia/Dubai", "KW": "Asia/Kuwait", "OM": "Asia/Muscat", "SA": "Asia/Riyadh"}
# Thursday 8 October 2026, 17:30 Kuwait (18:30 Dubai): a batch approved late on the last working day
# before Friday, so it runs into the evening, the night, Friday and Saturday morning.
APPROVED = datetime(2026, 10, 8, 14, 30, tzinfo=UTC)


def local(country: str, t: datetime) -> datetime:
    return t.astimezone(ZoneInfo(ZONES[country]))


class HoursOnTheLeadsClock(unittest.TestCase):
    def test_every_minute_of_a_week_matches_the_real_zone(self):
        t0 = datetime(2026, 10, 7, 21, 0, tzinfo=UTC)  # Thursday 00:00 Kuwait
        wrong = []
        for i in range(8 * 24 * 60):
            t = t0 + timedelta(minutes=i)
            for country in ZONES:
                h = local(country, t).hour
                if fu.in_hours(t, country, (9, 18)) != (9 <= h < 18):
                    wrong.append((country, t.isoformat()))
                if (t + fu.lead_offset(country)).strftime("%A") != local(country, t).strftime("%A"):
                    wrong.append((country, "day", t.isoformat()))
        self.assertEqual(wrong[:5], [])

    def test_the_drafting_quiet_hours_turn_on_the_second(self):
        q = {"from": 21, "to": 9}
        self.assertFalse(fu.quiet(datetime(2026, 10, 8, 17, 59, 59, tzinfo=UTC), q))  # 20:59:59 Kuwait
        self.assertTrue(fu.quiet(datetime(2026, 10, 8, 18, 0, 0, tzinfo=UTC), q))     # 21:00 Kuwait
        self.assertTrue(fu.quiet(datetime(2026, 10, 9, 5, 59, 59, tzinfo=UTC), q))    # 08:59:59 Kuwait
        self.assertFalse(fu.quiet(datetime(2026, 10, 9, 6, 0, 0, tzinfo=UTC), q))     # 09:00 Kuwait

    def test_kuwait_midnight_is_21_utc(self):
        self.assertEqual(waves.kuwait_midnight(datetime(2026, 10, 8, 20, 59, 59, tzinfo=UTC)),
                         datetime(2026, 10, 7, 21, 0, tzinfo=UTC))
        self.assertEqual(waves.kuwait_midnight(datetime(2026, 10, 8, 21, 0, 0, tzinfo=UTC)),
                         datetime(2026, 10, 8, 21, 0, tzinfo=UTC))

    def test_a_calls_day_and_time_on_the_leads_clock_across_midnight(self):
        # A call at 23:30 Kuwait on Thursday is 00:30 on Friday in Dubai.
        start = datetime(2026, 10, 8, 20, 30, tzinfo=UTC)
        now = datetime(2026, 10, 8, 10, 0, tzinfo=UTC)
        kw = fu.call_words(start, now, "KW")
        ae = fu.call_words(start, now, "AE")
        self.assertEqual((kw["time_24h"], kw["relative"]), ("23:30", "today"))
        self.assertEqual((ae["time_24h"], ae["relative"]), ("00:30", "tomorrow"))


class AWeekOfSends(unittest.TestCase):
    """40 openers approved Thursday 17:30 Kuwait, 45 s apart; the waves job runs
    every 5 minutes for a week with 270 s each."""

    def setUp(self):
        self.pg = FakePostgrest()
        for i in range(40):
            country = "UAE" if i % 2 else "Kuwait"
            c = f"t{i:02d}"
            self.pg.put("cockpit_sales_leads", {"contact_id": c, "country": country, "tags": ["roas-qualified"]})
            self.pg.put("cockpit_sales_followups", {"id": f"f{i:02d}", "contact_id": c, "segment": "reactivate",
                                                    "channel": "whatsapp_template", "status": "draft", "touch": 1,
                                                    "created_at": (APPROVED - timedelta(hours=2)).isoformat()})
            self.pg.put("cockpit_sales_followup_meta", {"followup_id": f"f{i:02d}",
                                                        "send_after": (APPROVED + timedelta(seconds=45 * i)).isoformat(),
                                                        "held_by": None, "wave_id": "w1"})
        self.country = {f"f{i:02d}": ("UAE" if i % 2 else "Kuwait") for i in range(40)}

    def run_week(self, settings=SETTINGS):
        clock = Clock(APPROVED)
        api = Api(self.pg, clock)
        runs = 0
        while clock() < APPROVED + timedelta(days=7):
            start = clock()
            with mock.patch.object(http, "request", self.pg):
                waves.send_due(sb(), api, settings=settings, w=waves.settings_of(settings),
                               waves=[{"id": "w1", "state": "running"}], guard=GATE_OPEN, clock=clock,
                               sleep=clock.sleep, budget_s=270, log=lambda _m: None, warn=lambda _m: None)
            runs += 1
            clock.t = max(clock(), start + timedelta(minutes=5))
        return api, runs

    def test_every_send_lands_in_hours_on_the_leads_own_clock_and_never_on_their_friday(self):
        api, _ = self.run_week()
        sent = [(t, fid) for t, action, fid in api.calls if action == "followup.send_due"]
        bad = []
        for t, fid in sent:
            lt = local(self.country[fid], t)
            if not (9 <= lt.hour < 18) or lt.strftime("%A") == "Friday":
                bad.append((fid, lt.isoformat()))
        self.assertEqual(bad, [])
        self.assertEqual(len({fid for _, fid in sent}), 40)  # all of them went, by the next working day
        times = sorted(t for t, _ in sent)
        self.assertTrue(all((b - a).total_seconds() >= 45 for a, b in zip(times, times[1:])))
        # Thursday's sends stop at 18:00 on each lead's clock; the rest wait for Saturday 09:00.
        later = [(t, fid) for t, fid in sent if t > APPROVED + timedelta(hours=12)]
        self.assertTrue(later)
        for t, fid in later:
            self.assertGreaterEqual(local(self.country[fid], t).replace(tzinfo=None), datetime(2026, 10, 10, 9, 0))

    def test_an_opener_approved_on_thursday_still_goes_on_saturday_morning(self):
        """Openers are drafted at 09:00 Kuwait and expire 48 h later (waves._draft_row); sales-api's
        sendFollowup refuses a draft past expires_at ("went stale"). Approved on Thursday afternoon, the
        ones the hours and the Friday hold back reach Saturday 09:00 just as they expire."""
        drafted = datetime(2026, 10, 8, 6, 1, tzinfo=UTC)  # Thursday 09:01 Kuwait, the day's batch
        approved = datetime(2026, 10, 8, 14, 50, tzinfo=UTC)  # Thursday 17:50 Kuwait
        for f in self.pg.rows("cockpit_sales_followups"):
            f["created_at"] = drafted.isoformat()
            f["expires_at"] = (drafted + timedelta(hours=48)).isoformat()
        for i, m in enumerate(sorted(self.pg.rows("cockpit_sales_followup_meta"), key=lambda m: m["followup_id"])):
            m["send_after"] = (approved + timedelta(seconds=45 * i)).isoformat()

        class StaleAware(Api):
            def __call__(inner, action, payload):  # noqa: N805
                f = inner.pg.one("cockpit_sales_followups", id=payload["id"])
                if f.get("expires_at") and datetime.fromisoformat(f["expires_at"]) < inner.clock():
                    inner.calls.append((inner.clock(), "stale", payload["id"]))
                    f["status"] = "expired"
                    return 409, {"error": "This draft went stale. The agent writes a new one if it is still due."}
                return super().__call__(action, payload)

        clock = Clock(approved)
        api = StaleAware(self.pg, clock)
        while clock() < approved + timedelta(days=3):
            start = clock()
            with mock.patch.object(http, "request", self.pg):
                waves.send_due(sb(), api, settings=SETTINGS, w=waves.settings_of(SETTINGS),
                               waves=[{"id": "w1", "state": "running"}], guard=GATE_OPEN, clock=clock,
                               sleep=clock.sleep, budget_s=270, log=lambda _m: None, warn=lambda _m: None)
            clock.t = max(clock(), start + timedelta(minutes=5))
        sent = {fid for _, action, fid in api.calls if action == "followup.send_due"}
        stale = sorted({fid for _, action, fid in api.calls if action == "stale"})
        self.assertEqual((len(sent), stale), (40, []))

    def test_quiet_days_set_to_friday_and_saturday_hold_saturday_too(self):
        api, _ = self.run_week({**SETTINGS, "quiet_days": ["friday", "saturday"]})
        days = {local(self.country[fid], t).strftime("%A") for t, _, fid in api.calls}
        self.assertNotIn("Friday", days)
        self.assertNotIn("Saturday", days)


if __name__ == "__main__":
    unittest.main()
