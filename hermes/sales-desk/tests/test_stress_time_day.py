"""TIME stress, round 2 (the desk): the two doors that decide whether an
approved draft may go now, the desk's waves send_due (followups.in_hours and
lead_days) and sales-api's followup.send_due (sendrules.ts hoursRefusal),
asked the same question for every quarter hour of a week, every country in
the zone table and the Gulf by name, an opener and a later step, and three
day-off settings. Where they disagree, the desk either holds a draft
sales-api would send (it waits for nothing) or asks sales-api for a send it
refuses (an hour's wait at a time). Nothing leaves the machine: sales-api's
rule runs under bun from the repo's own file.

    python3 -m unittest tests.test_stress_time_day
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import unittest
from datetime import datetime, timedelta, timezone

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
SENDRULES = os.path.abspath(os.path.join(HERE, "..", "..", "..", "supabase", "functions", "sales-api", "sendrules.ts"))
UTC = timezone.utc
T0 = datetime(2026, 10, 7, 21, 0, tzinfo=UTC)  # Thursday 8 October 00:00 Kuwait
STEPS = [T0 + timedelta(minutes=15 * i) for i in range(8 * 24 * 4)]  # eight days, two Fridays' edges
COUNTRIES = sorted(fu.LEAD_ZONES) + ["", "United Arab Emirates", "Oman", "مسقط", "Dubai", "Kuwait", "Saudi Arabia", "XZ"]
QUIET_DAYS = (["friday"], ["friday", "saturday"], [])
SETTINGS = {"quiet": {"from": 21, "to": 9}, "first_hours": [9, 18]}

TS = r"""
import { hoursRefusal } from "%s";
const input = JSON.parse(await Bun.stdin.text());
const out: string[] = [];
for (const days of input.quiet_days) {
  const followups = { ...input.settings, quiet_days: days };
  for (const c of input.countries)
    for (const touch of [1, 2]) {
      let row = "";
      for (const t of input.times)
        row += hoursRefusal({ segment: touch === 1 ? "reactivate" : "no_show", touch, country: c, now: t, followups, dayOff: true }) === null ? "1" : "0";
      out.push(row);
    }
}
console.log(JSON.stringify(out));
"""


def desk_may_send(now: datetime, country: str, touch: int, days_off: list[str]) -> bool:
    """waves.send_due's own gate, as written there."""
    first = touch == 1
    q = SETTINGS["quiet"]
    hours = SETTINGS["first_hours"] if first else (int(q.get("to", 9)), int(q.get("from", 21)))
    return fu.in_hours(now, country, hours, first=first) and not fu.lead_days_off(now, country, days_off)


@unittest.skipUnless(shutil.which("bun"), "bun is not installed")
class TwoDoorsOneClock(unittest.TestCase):
    def test_the_desk_and_sales_api_agree_on_every_quarter_hour_of_a_week(self):
        script = os.path.join(HERE, ".stress_time_day_rules.ts")
        with open(script, "w") as f:
            f.write(TS % SENDRULES.replace("\\", "/"))
        try:
            payload = {"quiet_days": list(QUIET_DAYS), "settings": SETTINGS, "countries": COUNTRIES,
                       "times": [int(t.timestamp() * 1000) for t in STEPS]}
            done = subprocess.run(["bun", "run", script], input=json.dumps(payload), capture_output=True, text=True,
                                  timeout=120)
        finally:
            os.remove(script)
        self.assertEqual(done.returncode, 0, done.stderr[-2000:])
        rows = json.loads(done.stdout)
        wrong: list[str] = []
        i = 0
        for days in QUIET_DAYS:
            for c in COUNTRIES:
                for touch in (1, 2):
                    api = rows[i]
                    i += 1
                    for j, t in enumerate(STEPS):
                        desk = desk_may_send(t, c, touch, days)
                        if desk != (api[j] == "1"):
                            wrong.append(f"{c or '(none)'} touch {touch} days_off {days} at {t.isoformat()}: "
                                         f"desk {'sends' if desk else 'holds'}, sales-api {'sends' if api[j] == '1' else 'refuses'}")
        self.assertEqual(wrong[:10], [], f"{len(wrong)} disagreements")


class OpenersOnTheLeadsClockAcrossMidnight(unittest.TestCase):
    def test_a_utc_plus_4_leads_friday_starts_at_23_00_kuwait_on_thursday(self):
        thu_2259 = datetime(2026, 10, 8, 19, 59, tzinfo=UTC)  # 22:59 Kuwait, 23:59 Dubai, Thursday
        fri_0000 = datetime(2026, 10, 8, 20, 0, tzinfo=UTC)   # 23:00 Kuwait Thursday, 00:00 Dubai Friday
        self.assertEqual(fu.lead_days(thu_2259, "AE"), {"thursday"})
        self.assertEqual(fu.lead_days(fri_0000, "AE"), {"friday"})
        self.assertEqual(fu.lead_days(fri_0000, "KW"), {"thursday"})
        # Saturday 00:00 Dubai is Friday 23:00 Kuwait: the Dubai lead's day off is over, a Kuwait lead's is not.
        sat = datetime(2026, 10, 9, 20, 0, tzinfo=UTC)
        self.assertEqual((fu.lead_days(sat, "AE"), fu.lead_days(sat, "KW")), ({"saturday"}, {"friday"}))


if __name__ == "__main__":
    unittest.main()
