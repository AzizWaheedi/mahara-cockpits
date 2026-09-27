"""The sync's rules, checked without the network: `python3 -m unittest -v test_sync`."""

import datetime as dt
import unittest

import sync

NOW = dt.datetime(2026, 9, 27, 9, 0, tzinfo=dt.timezone.utc)  # a Sunday, 12:00 in Kuwait
CEO = "ceo@maharamedia.com"
CSM = "csm@maharamedia.com"
AGENT = "agent@maharamedia.com"
ORG = CEO  # the CEO's own calendar organises the series


def occ(day: str, master: str = "abc", start: str = "13:30", minutes: int = 30, title: str = "Slow Client Call",
        guests=(CEO, CSM), moved_to: str = "", status: str = "confirmed", org: str = ORG, mark: str = "") -> dict:
    """One occurrence as events.list returns it (singleEvents=true)."""
    s = dt.datetime.fromisoformat(f"{day}T{start}:00+03:00")
    at = dt.datetime.fromisoformat(moved_to) if moved_to else s
    e = {
        "id": f"{master}_{s.astimezone(dt.timezone.utc):%Y%m%dT%H%M%SZ}",
        "recurringEventId": master,
        "status": status,
        "summary": title,
        "organizer": {"email": org},
        "hangoutLink": "https://meet.google.com/aaa-bbbb-ccc",
        "attendees": [{"email": g, **({"organizer": True} if g == org else {})} for g in guests],
        "originalStartTime": {"dateTime": s.isoformat()},
        "start": {"dateTime": at.isoformat()},
        "end": {"dateTime": (at + dt.timedelta(minutes=minutes)).isoformat()},
    }
    if mark:
        e["extendedProperties"] = {"private": {"teamMeetingId": mark}}
    return e


def master_event(master: str = "abc", title: str = "Slow Client Call", guests=(CEO, CSM), byday: str = "SU,TH",
                 start: str = "2026-09-06T13:30:00+03:00", minutes: int = 30, optional=()) -> dict:
    s = dt.datetime.fromisoformat(start)
    return {
        "id": master, "status": "confirmed", "summary": title, "etag": '"e1"',
        "organizer": {"email": ORG}, "hangoutLink": "https://meet.google.com/aaa-bbbb-ccc",
        "recurrence": [f"RRULE:FREQ=WEEKLY;BYDAY={byday}"],
        "attendees": [{"email": g, **({"optional": True} if g in optional else {})} for g in guests],
        "start": {"dateTime": s.isoformat(), "timeZone": "Asia/Kuwait"},
        "end": {"dateTime": (s + dt.timedelta(minutes=minutes)).isoformat(), "timeZone": "Asia/Kuwait"},
    }


def meeting(**kw) -> dict:
    base = {
        "id": "slow-client-call", "title": "Slow Client Call", "managed": "cockpit", "active": True,
        "cal_calendar": ORG, "cal_event_id": "abc", "cal_title": "Slow Client Call", "calendar_id": "abc",
        "start_time": "13:30:00", "minutes": 30, "weekdays": [0, 4], "tz": "Asia/Kuwait",
        "rrule": "RRULE:FREQ=WEEKLY;BYDAY=SU,TH", "ends_on": None, "meet_link": "https://meet.google.com/aaa-bbbb-ccc",
        "cal_etag": '"e1"', "cal_writable": True, "cal_error": None,
    }
    base.update(kw)
    return base


PEOPLE = [
    {"id": "ceo", "name": "The CEO", "email": CEO},
    {"id": "csm", "name": "The CSM", "email": CSM},
    {"id": "agent", "name": "An Agent", "email": AGENT},
]


def state(meetings, links=(), sittings=(), pending=()) -> sync.State:
    return sync.State(list(meetings), PEOPLE, list(links), list(sittings), set(pending))


def plan(st: sync.State, events, masters=None, everything=True) -> sync.Plan:
    series = sync.group(list(events))
    newcomers = []
    return sync.plan_pass(st, series, masters or {}, {ORG}, NOW, everything, sync.roster(st, newcomers))


def paths(p: sync.Plan) -> list:
    return [f"{m} {path}" for m, path, _, _ in p.writes]


class Rules(unittest.TestCase):
    def test_weekdays_and_cadence_from_the_rule(self):
        self.assertEqual(sync.weekdays_of("RRULE:FREQ=WEEKLY;BYDAY=SU,TH", None), [0, 4])
        self.assertIsNone(sync.weekdays_of("RRULE:FREQ=MONTHLY;BYDAY=1SA", None))
        self.assertEqual(sync.cadence_of("RRULE:FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH"), "daily")
        self.assertEqual(sync.cadence_of("RRULE:FREQ=WEEKLY;BYDAY=SU,TU,TH"), "three times a week")
        self.assertEqual(sync.cadence_of("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SA"), "every two weeks")
        self.assertEqual(sync.cadence_of(None), "as needed")

    def test_until_is_the_last_day_in_kuwait(self):
        # 20:59:59 UTC on the 30th is 23:59:59 in Kuwait on the 30th.
        self.assertEqual(sync.until_of("RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20261030T205959Z", "Asia/Kuwait"), "2026-10-30")

    def test_series_fields(self):
        f = sync.series_fields(master_event(), "Asia/Kuwait")
        self.assertEqual((f["start_time"], f["minutes"], f["weekdays"]), ("13:30:00", 30, [0, 4]))
        self.assertEqual(f["meet_link"], "https://meet.google.com/aaa-bbbb-ccc")

    def test_what_counts_as_a_meeting(self):
        self.assertTrue(sync.is_meeting(occ("2026-09-27")))
        self.assertFalse(sync.is_meeting(occ("2026-09-27", guests=(CEO, "client@example.com"))))
        self.assertFalse(sync.is_meeting({**occ("2026-09-27"), "hangoutLink": None}))

    def test_a_moved_occurrence_keeps_its_day(self):
        o = sync.occurrence(occ("2026-10-01", moved_to="2026-10-02T15:00:00+03:00"), "Asia/Kuwait")
        self.assertEqual((o["on_date"], o["status"]), ("2026-10-01", "moved"))
        self.assertTrue(o["starts_at"].startswith("2026-10-02T12:00"))


class Matching(unittest.TestCase):
    def test_a_rename_in_google_renames_the_same_meeting(self):
        st = state([meeting()])
        events = [occ("2026-09-27", title="Slow Clients"), occ("2026-10-01", title="Slow Clients")]
        masters = {(ORG, "abc"): master_event(title="Slow Clients")}
        p = plan(st, events, masters)
        creates = [w for w in p.writes if w[0] == "POST" and w[1] == "team_meetings"]
        self.assertEqual(creates, [])  # no second meeting
        patch = next(body for m, path, body, _ in p.writes if path == "team_meetings?id=eq.slow-client-call")
        self.assertEqual(patch["title"], "Slow Clients")
        self.assertEqual(patch["cal_title"], "Slow Clients")
        self.assertIn('renamed it "Slow Clients"', [c["what"] for c in p.changes])

    def test_a_title_set_on_the_page_survives_the_first_read(self):
        # Linked before the sync knew the event's title: record it, rename nothing.
        st = state([meeting(title="Whole Team", cal_title=None, cal_calendar=None)])
        p = plan(st, [occ("2026-09-27", title="Old calendar title")], {(ORG, "abc"): master_event(title="Old calendar title")})
        patch = next(body for m, path, body, _ in p.writes if path == "team_meetings?id=eq.slow-client-call")
        self.assertNotIn("title", patch)
        self.assertEqual(patch["cal_title"], "Old calendar title")
        self.assertEqual(patch["cal_calendar"], ORG)  # the organiser's calendar is learned

    def test_a_meeting_with_a_change_on_its_way_is_left_alone(self):
        st = state([meeting()], pending=["slow-client-call"])
        events = [occ("2026-10-01", moved_to="2026-10-01T15:00:00+03:00", title="Renamed")]
        p = plan(st, events, {(ORG, "abc"): master_event(title="Renamed", start="2026-09-06T15:00:00+03:00")})
        self.assertFalse([w for w in p.writes if "slow-client-call" in w[1] or (
            isinstance(w[2], list) and any(r.get("meeting_id") == "slow-client-call" for r in w[2]))])
        self.assertFalse([c for c in p.changes if c["meeting_id"] == "slow-client-call"])

    def test_the_rest_of_a_series_split_in_google_stays_the_same_meeting(self):
        st = state([meeting()])
        events = [occ("2026-10-04", master="abc_R20261004T103000", title="Slow Client Call")]
        p = plan(st, events, {(ORG, "abc_R20261004T103000"): master_event(master="abc_R20261004T103000")})
        creates = [w for w in p.writes if w[1] == "team_meetings" and w[0] == "POST"]
        self.assertEqual(creates, [])
        patch = next(body for m, path, body, _ in p.writes if path == "team_meetings?id=eq.slow-client-call")
        self.assertEqual(patch["cal_event_id"], "abc_R20261004T103000")

    def test_the_cockpits_own_mark_finds_a_one_off_sitting(self):
        st = state([meeting()])
        extra = {**occ("2026-10-06", master="oneoff1", start="11:00"), "recurringEventId": None, "id": "oneoff1"}
        extra["extendedProperties"] = {"private": {"teamMeetingId": "slow-client-call"}}
        p = plan(st, [occ("2026-09-27"), extra], {(ORG, "abc"): master_event()})
        rows = [r for m, path, body, _ in p.writes if path.startswith("team_sittings") and isinstance(body, list) for r in body]
        self.assertIn("slow-client-call:2026-10-06", {r["id"] for r in rows})

    def test_a_new_team_series_is_a_new_meeting_named_by_its_title(self):
        st = state([meeting()])
        events = [occ("2026-09-29", master="xyz", title="Creative Call", start="13:30")]
        p = plan(st, events, {(ORG, "xyz"): master_event(master="xyz", title="Creative Call", byday="TU")})
        create = next(body for m, path, body, _ in p.writes if path == "team_meetings" and m == "POST")[0]
        self.assertEqual((create["id"], create["cal_event_id"], create["weekdays"]), ("creative-call", "xyz", [2]))

    def test_a_series_the_old_sync_already_filed_is_not_made_again(self):
        st = state([meeting(id="august-plan", managed="calendar", cal_calendar=None, cal_event_id=None, calendar_id="old")])
        p = plan(st, [occ("2026-09-27", master="old", title="Whole Team")])
        self.assertFalse([w for w in p.writes if w[1] == "team_meetings" and w[0] == "POST"])


    def test_a_same_titled_series_joins_the_calendar_meeting_the_old_sync_filed(self):
        st = state([meeting(id="b2b-drill", title="B2B Drill", managed="calendar", cal_calendar=None,
                            cal_event_id="orig", calendar_id="orig")])
        p = plan(st, [occ("2026-09-28", master="dup", title="B2B Drill", start="10:00")],
                 {(ORG, "dup"): master_event(master="dup", title="B2B Drill", byday="MO")})
        self.assertFalse([w for w in p.writes if w[1] == "team_meetings" and w[0] == "POST"])
        parts = [body[0] for m_, path, body, _ in p.writes if path.startswith("team_meeting_series")]
        self.assertEqual([(r["meeting_id"], r["cal_event_id"]) for r in parts], [("b2b-drill", "dup")])
        self.assertIn("found another series of it", [c["what"] for c in p.changes])

    def test_a_same_titled_series_with_nothing_live_is_left_alone(self):
        # Every pass would otherwise join it again without a row to show for it.
        st = state([meeting(id="b2b-drill", title="B2B Drill", managed="calendar", cal_calendar=None,
                            cal_event_id="orig", calendar_id="orig")])
        p = plan(st, [occ("2026-09-20", master="dup", title="B2B Drill", start="10:00", status="cancelled")])
        self.assertFalse([c for c in p.changes if "another series" in c["what"]])
        self.assertFalse([w for w in p.writes if w[1].startswith("team_meeting_series")])

    def test_an_old_series_of_a_meeting_the_cockpit_manages_is_left_alone(self):
        st = state([meeting(id="whole-team-vision-projections", title="Whole Team", cal_event_id="new")])
        p = plan(st, [occ("2026-10-03", master="old", title="🏢 Whole Team — Vision & Projections", start="11:45")])
        self.assertFalse([w for w in p.writes if w[1] in ("team_meetings", "team_meeting_series")])

    def test_a_series_on_its_way_out_is_not_a_new_meeting(self):
        ending = master_event(master="bye", title="Pulse", byday="SU")
        ending["recurrence"] = ["RRULE:FREQ=WEEKLY;UNTIL=20261002T205959Z;BYDAY=SU"]
        p = plan(state([meeting()]), [occ("2026-09-27", master="bye", title="Pulse", start="14:00")],
                 {(ORG, "bye"): ending})
        self.assertFalse([w for w in p.writes if w[1] == "team_meetings" and w[0] == "POST"])


class Guests(unittest.TestCase):
    def links(self, **extra):
        return [
            {"meeting_id": "slow-client-call", "person_id": "ceo", "part": "host", "removed": False, "source": "calendar", "cal_optional": False},
            {"meeting_id": "slow-client-call", "person_id": "csm", "part": "required", "removed": False, "source": "calendar", "cal_optional": False},
            *extra.get("more", []),
        ]

    def test_added_in_google_is_added_taken_off_is_marked_removed(self):
        st = state([meeting()], links=self.links())
        master = master_event(guests=(CEO, AGENT))  # the CSM taken off, an agent added
        p = plan(st, [occ("2026-09-27", guests=(CEO, AGENT))], {(ORG, "abc"): master})
        whats = [c["what"] for c in p.changes]
        self.assertIn("added An Agent", whats)
        self.assertIn("took The CSM off the invite", whats)
        self.assertNotIn("took The CEO off the invite", whats)  # the organiser stays

    def test_a_part_chosen_on_the_page_stays_unless_google_optional_changed(self):
        st = state([meeting()], links=self.links())
        # The CEO made the CSM a host on the page (host = required in Google): nothing changes.
        st.links[1]["part"] = "host"
        p = plan(st, [occ("2026-09-27")], {(ORG, "abc"): master_event()})
        self.assertFalse([c for c in p.changes if "The CSM" in c["what"]])
        # Then someone ticks "optional" for the CSM in Google.
        p = plan(st, [occ("2026-09-27")], {(ORG, "abc"): master_event(optional=(CSM,))})
        self.assertIn("made The CSM optional", [c["what"] for c in p.changes])

    def test_someone_added_on_the_page_before_the_link_is_not_taken_off(self):
        extra = {"meeting_id": "slow-client-call", "person_id": "agent", "part": "optional", "removed": False, "source": "cockpit", "cal_optional": None}
        st = state([meeting()], links=self.links(more=[extra]))
        p = plan(st, [occ("2026-09-27")], {(ORG, "abc"): master_event()})
        self.assertFalse([c for c in p.changes if "An Agent" in c["what"]])


class Sittings(unittest.TestCase):
    def test_one_sitting_per_occurrence_with_real_times(self):
        st = state([meeting()])
        p = plan(st, [occ("2026-09-27"), occ("2026-10-01", status="cancelled")], {(ORG, "abc"): master_event()})
        rows = {r["id"]: r for m, path, body, _ in p.writes if path.startswith("team_sittings?on_conflict") for r in body}
        self.assertEqual(rows["slow-client-call:2026-09-27"]["status"], "scheduled")
        self.assertTrue(rows["slow-client-call:2026-09-27"]["starts_at"].startswith("2026-09-27T10:30"))
        self.assertEqual(rows["slow-client-call:2026-10-01"]["status"], "cancelled")

    def test_an_occurrence_google_dropped_goes_unless_something_hangs_on_it(self):
        stored = [
            {"id": "slow-client-call:2026-10-08", "meeting_id": "slow-client-call", "on_date": "2026-10-08", "cal_instance_id": "gone1", "status": "scheduled", "notes": ""},
            {"id": "slow-client-call:2026-10-11", "meeting_id": "slow-client-call", "on_date": "2026-10-11", "cal_instance_id": "gone2", "status": "scheduled", "notes": "Agenda drafted"},
        ]
        st = state([meeting()], sittings=stored)
        p = plan(st, [occ("2026-09-27")], {(ORG, "abc"): master_event()})
        self.assertIn("DELETE team_sittings?id=eq.slow-client-call%3A2026-10-08", paths(p))
        self.assertIn("PATCH team_sittings?id=eq.slow-client-call%3A2026-10-11", paths(p))


class Quiet(unittest.TestCase):
    def test_a_quiet_calendar_meeting_is_marked_inactive_never_a_cockpit_one(self):
        quiet = meeting(id="one-to-one", managed="calendar", cal_calendar=None, cal_event_id="q1", calendar_id="q1")
        cockpit = meeting(id="csm-daily", managed="cockpit", cal_calendar=None, cal_event_id=None, calendar_id=None)
        st = state([quiet, cockpit])
        p = plan(st, [occ("2026-09-01", master="q1", title="1:1")])  # 26 days ago, nothing ahead
        self.assertIn("PATCH team_meetings?id=eq.one-to-one", paths(p))
        self.assertNotIn("PATCH team_meetings?id=eq.csm-daily", paths(p))

    def test_nothing_is_marked_inactive_when_a_calendar_could_not_be_read(self):
        quiet = meeting(id="one-to-one", managed="calendar", cal_calendar=None, cal_event_id="q1", calendar_id="q1")
        p = plan(state([quiet]), [], everything=False)
        self.assertEqual(p.writes, [])


class ADayEach(unittest.TestCase):
    """CSM Daily on the CEO's calendar is one weekly series per day."""

    def parts(self):
        return [
            {"meeting_id": "csm-daily", "cal_calendar": ORG, "cal_event_id": "sun", "weekday": 0},
            {"meeting_id": "csm-daily", "cal_calendar": ORG, "cal_event_id": "mon", "weekday": 1},
        ]

    def test_every_days_series_feeds_the_one_meeting(self):
        m = meeting(id="csm-daily", title="CSM Daily", cal_event_id="sun", calendar_id="sun", weekdays=[0, 1],
                    cal_title=None, start_time="13:00:00", minutes=20)
        st = sync.State([m], PEOPLE, [], [], set(), self.parts())
        events = [occ("2026-10-04", master="sun", start="13:00", title="CSM Daily: Projections", guests=(CEO, CSM)),
                  occ("2026-10-05", master="mon", start="13:00", title="CSM Daily: Game Tape", guests=(CEO, CSM, AGENT))]
        masters = {(ORG, "sun"): master_event(master="sun", title="CSM Daily: Projections", byday="SU",
                                             start="2026-10-04T13:00:00+03:00"),
                   (ORG, "mon"): master_event(master="mon", title="CSM Daily: Game Tape", byday="MO",
                                             start="2026-10-05T13:00:00+03:00", guests=(CEO, CSM, AGENT))}
        p = plan(st, events, masters)
        rows = {r["id"] for m_, path, body, _ in p.writes if path.startswith("team_sittings?on_conflict") for r in body}
        self.assertEqual(rows, {"csm-daily:2026-10-04", "csm-daily:2026-10-05"})
        patch = next(body for m_, path, body, _ in p.writes if path == "team_meetings?id=eq.csm-daily")
        self.assertEqual(patch["minutes"], 30)  # Google's length wins over the 20 set here
        self.assertEqual(patch.get("weekdays", m["weekdays"]), [0, 1])
        self.assertNotIn("title", patch)  # each day's series carries its own title
        self.assertIn("added An Agent", [c["what"] for c in p.changes])
        stored = [body[0] for m_, path, body, _ in p.writes if path.startswith("team_meeting_series")]
        self.assertEqual({(r["cal_event_id"], r["weekday"]) for r in stored}, {("sun", 0), ("mon", 1)})


class Links(unittest.TestCase):
    def test_an_exact_match_is_same_days_same_start_on_an_editable_calendar(self):
        m = meeting(cal_calendar=None, cal_event_id=None)
        events = [occ("2026-09-27"), occ("2026-10-01"), occ("2026-10-04"), occ("2026-10-08")]
        found = sync.propose_links([m], sync.group(events), {ORG}, NOW, {})[0]
        self.assertEqual(found["link"]["kind"], "one series")
        found = sync.propose_links([m], sync.group(events), set(), NOW, {})[0]
        self.assertIsNone(found["link"])  # read only: proposed, not linked
        found = sync.propose_links([meeting(cal_calendar=None, cal_event_id=None, weekdays=[0])],
                                   sync.group(events), {ORG}, NOW, {})[0]
        self.assertIsNone(found["link"])  # it meets on Thursdays too: not the same days

    def test_a_series_a_day_links_when_every_day_has_one(self):
        m = meeting(id="call-center", title="Call Center", cal_calendar=None, cal_event_id=None,
                    start_time="14:00:00", weekdays=[0, 2])
        events = [occ("2026-10-04", master="kick", start="14:00", title="Call Center: Kickoff"),
                  occ("2026-10-06", master="role", start="14:00", title="Call Center: Role Play"),
                  # The old Sunday series at the same time ends this week: retiring, not a candidate.
                  occ("2026-09-27", master="pulse", start="14:00", title="Call Center Pulse")]
        found = sync.propose_links([m], sync.group(events), {ORG}, NOW, {(ORG, "pulse"): "2026-10-02"})[0]
        self.assertEqual(found["link"]["kind"], "a series a day")
        self.assertEqual([(c["event"], d) for c, d in found["link"]["parts"]], [("kick", 0), ("role", 2)])
        # Without knowing the old one ends, Sunday has two series with the
        # meeting's name at its time: nothing is linked, it is left for the page.
        found = sync.propose_links([m], sync.group(events), {ORG}, NOW, {})[0]
        self.assertIsNone(found["link"])


if __name__ == "__main__":
    unittest.main()
