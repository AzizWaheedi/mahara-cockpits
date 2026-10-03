"""Backlog waves (the follow-up agent's phase 1, desk side): the holdout, the
pools, enrolment, the day's openers with no model text, and the paced
sending of an approved batch, with its refusals, its ceiling and two runs
at once. Every lead, name and line is invented.

    python3 -m unittest tests.test_waves
"""
from __future__ import annotations

import hashlib
import json
import os
import unittest
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import followups as fu, http, waves  # noqa: E402
from desk.supabase import Supabase  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402

NOW = datetime(2026, 10, 4, 7, 0, tzinfo=timezone.utc)  # 10:00 Kuwait, a Sunday
GATE_OPEN = {"templates_per_day": 250, "connector_off": True, "single_copy_ok_at": "2026-10-03T09:00:00+00:00"}
SETTINGS = {"enabled": True, "quiet": {"from": 21, "to": 9}, "quiet_days": ["friday"], "first_hours": [9, 18],
            "waves": {"per_day": 40, "holdout_share": 0.1, "batch_gap_s": 45, "salt": "waves"}}
OPENER_AR = {"key": "opener_ar", "name": "cockpit_opener_ar", "language": "ar", "purpose": "Backlog opener in Arabic.",
             "preview": "السلام عليكم {{1}}، معاك {{2}}. كيف حالك؟", "variables": ["first_name", "rep_name"],
             "workflow_id": "wf-opener-ar", "active": True, "segments": ["reactivate"], "sort": 30}
DEMO_CAL = "jQqXS1YuFnmGZKLkrE62"  # the "Demo" calendar
OPENER_EN = {**OPENER_AR, "key": "opener_en", "name": "cockpit_opener_en", "language": "en",
             "preview": "Hi {{1}}, it's {{2}} from Mahara Media. How are you?", "workflow_id": "wf-opener-en", "sort": 40}


def ago(**kw) -> str:
    return (NOW - timedelta(**kw)).isoformat()


class Clock:
    """Time that moves only when the code under test sleeps (or a test says)."""

    def __init__(self, t: datetime):
        self.t, self.slept = t, []

    def __call__(self) -> datetime:
        return self.t

    def sleep(self, s: float) -> None:
        self.slept.append(s)
        self.t += timedelta(seconds=s)


class Ghl:
    """HighLevel for invented contacts: each has a first name, a phone, its
    do-not-disturb and a thread. Everything else goes to the database."""

    def __init__(self, pg: FakePostgrest, people: Optional[dict[str, dict[str, Any]]] = None):
        self.pg, self.people, self.asked = pg, people or {}, []

    def person(self, c: str) -> dict[str, Any]:
        return {"firstName": "Omar", "phone": "+96550000000", "thread": [], **self.people.get(c, {})}

    def __call__(self, method, url, **kw):
        if "leadconnectorhq" not in url:
            if "127.0.0.1:3456" in url or "openai" in url or "anthropic" in url:
                raise AssertionError("a model was asked")
            return self.pg(method, url, **kw)
        self.asked.append((method, url))
        assert method == "GET", f"the desk wrote to HighLevel: {method} {url}"
        parts = urllib.parse.urlsplit(url)
        q = dict(urllib.parse.parse_qsl(parts.query))
        if parts.path.endswith("/conversations/search"):
            c = q.get("contactId", "")
            return 200, {}, json.dumps({"conversations": [{"id": f"cv-{c}"}] if self.person(c)["thread"] else []}).encode()
        if "/conversations/cv-" in parts.path:
            c = parts.path.split("/conversations/cv-", 1)[1].split("/", 1)[0]
            return 200, {}, json.dumps({"messages": {"messages": self.person(c)["thread"]}}).encode()
        if "/contacts/" in parts.path:
            c = parts.path.rsplit("/", 1)[-1]
            p = self.person(c)
            return 200, {}, json.dumps({"contact": {k: v for k, v in p.items() if k != "thread"}}).encode()
        raise AssertionError(url)


class Api:
    """sales-api's followup.send_due as the desk sees it: the draft sent and
    its message written as the desk's, unless a test scripts an answer."""

    def __init__(self, pg: FakePostgrest, clock: Clock, script: Optional[list] = None, extra_per_send: int = 0):
        self.pg, self.clock, self.script, self.extra = pg, clock, list(script or []), extra_per_send
        self.calls: list[tuple[datetime, str, str]] = []

    def __call__(self, action: str, payload: dict[str, Any]):
        self.calls.append((self.clock(), action, payload["id"]))
        if self.script:
            answer = self.script.pop(0)
            if isinstance(answer, BaseException):
                raise answer
            if answer is not None:
                return answer
        f = self.pg.one("cockpit_sales_followups", id=payload["id"])
        f["status"] = "sent"
        for i in range(1 + self.extra):
            self.pg.put("cockpit_sales_messages", {"id": f"msg-{payload['id']}-{i}", "followup_id": payload["id"],
                                                   "contact_id": f["contact_id"], "sent_by": "sales-desk",
                                                   "created_at": self.clock().isoformat(), "state": "sent",
                                                   "channel": "whatsapp"})
        return 200, {"followup": {"id": payload["id"], "status": "sent"}}


def sb() -> Supabase:
    return Supabase("https://example.supabase.co", "k")


def seed(pg: FakePostgrest, c: str, pool: str, *, days: float = 1, country: str = "Kuwait", name: str = "Omar",
         owner: Optional[str] = None, tags=("roas-qualified",), **over) -> None:
    pg.put("cockpit_sales_leads", {"contact_id": c, "name": name, "country": country, "tags": list(tags),
                                   "lead_created_at": ago(days=days + 40), "lead_class": "qualified",
                                   "assigned_to": owner, "phone": "+96550000000", "dnd": False, **over})
    at = ago(days=days)
    if pool == "no_show_cancelled":
        pg.put("cockpit_sales_calendar", {"appointment_id": f"{c}-1", "contact_id": c, "call_type": "intro",
                                          "status": "noshow", "start_at": at, "booked_at": ago(days=days + 2)})
    elif pool == "good_intro":
        pg.put("cockpit_sales_calendar", {"appointment_id": f"{c}-1", "contact_id": c, "call_type": "intro",
                                          "status": "showed", "start_at": at, "booked_at": ago(days=days + 2)})
    elif pool == "unclosed_demo":
        pg.put("cockpit_sales_calendar", {"appointment_id": f"{c}-1", "contact_id": c, "call_type": "intro",
                                          "status": "showed", "start_at": ago(days=days + 3), "booked_at": ago(days=days + 5)})
        pg.put("cockpit_sales_calendar", {"appointment_id": f"{c}-2", "contact_id": c, "call_type": "demo",
                                          "calendar_id": DEMO_CAL, "status": "confirmed", "start_at": at,
                                          "booked_at": ago(days=days + 2)})
    elif pool == "never_booked":
        pg.rows("cockpit_sales_leads")  # nothing on the calendar
        pg.one("cockpit_sales_leads", contact_id=c)["lead_created_at"] = at


def wave(pg: FakePostgrest, wid: str, pool: str, **over) -> dict:
    return pg.put("cockpit_sales_followup_waves", {"id": wid, "pool": pool, "segment": "reactivate", "per_day": 40,
                                                   "holdout_share": 0.1, "state": "running", "started_at": ago(days=1),
                                                   **over})


def routes(pg: FakePostgrest, *rows) -> None:
    for r in rows or (OPENER_AR, OPENER_EN):
        pg.put("cockpit_sales_wa_templates", r)


def run(pg, ghl=None, *, now=NOW, settings=None, guard=GATE_OPEN, api=None, budget=270.0, token="t"):
    clock = Clock(now)
    api = api or Api(pg, clock)
    if isinstance(api, Api):
        api.clock = clock
    logs: list[str] = []
    with mock.patch.object(http, "request", ghl or Ghl(pg)):
        out = waves.run(sb(), api, settings=settings or SETTINGS, guard=guard, ghl_token=token, log=logs.append,
                        warn=logs.append, clock=clock, sleep=clock.sleep, budget_s=budget)
    return out, api, clock, logs


def members(pg, wid=None, **match):
    return [m for m in pg.rows("cockpit_sales_followup_wave_members")
            if (wid is None or m["wave_id"] == wid) and all(m.get(k) == v for k, v in match.items())]


# ---------------------------------------------------------------------------

class Holdout(unittest.TestCase):
    def test_it_is_sha256_of_waves_and_the_contact_and_stable(self):
        for c in ("VjPfR4Cc1Y0OFvaqeor5", "abc", "lead-0001"):
            h = int(hashlib.sha256(f"waves:{c}".encode()).hexdigest()[:8], 16) / 2 ** 32
            self.assertEqual(waves.holdout(c, 0.1), h < 0.1, c)
            self.assertEqual(waves.holdout(c, 0.1), waves.holdout(c, 0.1))

    def test_a_tenth_is_held_back_and_apart_from_the_demo_chats_holdout(self):
        ids = [f"contact-{i:05d}" for i in range(20_000)]
        held = [c for c in ids if waves.holdout(c, 0.1)]
        self.assertAlmostEqual(len(held) / len(ids), 0.1, delta=0.01)
        threads = {c for c in ids if waves.holdout(c, 0.1, salt="threads")}
        overlap = len(set(held) & threads) / len(held)
        self.assertAlmostEqual(overlap, 0.1, delta=0.03)  # independent, not nested
        self.assertEqual([c for c in ids[:500] if waves.holdout(c, 0.0)], [])

    def test_the_settings_are_kept_in_bounds(self):
        self.assertEqual(waves.settings_of({}), {"per_day": 40, "holdout_share": 0.1, "batch_gap_s": 45.0, "salt": "waves"})
        w = waves.settings_of({"waves": {"per_day": "9999", "holdout_share": 0.9, "batch_gap_s": 1, "salt": " "}})
        self.assertEqual(w, {"per_day": 200, "holdout_share": 0.5, "batch_gap_s": 30, "salt": "waves"})
        self.assertEqual(waves.settings_of({"waves": {"per_day": "lots"}})["per_day"], 40)


class Pools(unittest.TestCase):
    L = {"contact_id": "x", "tags": ["roas-unqualified"], "lead_created_at": ago(days=50)}

    def call(self, kind, status, days, **over):
        cal = {"demo": DEMO_CAL, "intro": "dsqmJ393Dwl9fDSbIVOI"}.get(kind)
        return {"appointment_id": f"{kind}{days}{status}", "contact_id": "x", "call_type": kind, "status": status,
                "calendar_id": cal,
                "start_at": ago(days=days) if days >= 0 else (NOW + timedelta(days=-days)).isoformat(), **over}

    def pool(self, calls, lead=None, dealt=False):
        p = waves.pool_of(lead or self.L, fu.with_kinds(calls), dealt, NOW)
        return p[0] if p else None

    def test_each_pool(self):
        self.assertEqual(self.pool([]), "never_booked")
        self.assertEqual(waves.pool_of(self.L, [], False, NOW)[1], fu._ts(self.L["lead_created_at"]))
        self.assertEqual(self.pool([self.call("intro", "noshow", 3)]), "no_show_cancelled")
        self.assertEqual(self.pool([self.call("demo", "cancelled", -2)]), "no_show_cancelled")
        self.assertEqual(self.pool([self.call("intro", "showed", 3)]), "good_intro")
        self.assertEqual(self.pool([self.call("intro", "confirmed", 3)]), "good_intro")  # the B2B rule
        self.assertEqual(self.pool([self.call("intro", "showed", 9), self.call("demo", "confirmed", 3)]), "unclosed_demo")
        self.assertEqual(self.pool([self.call("intro", "showed", 9), self.call("demo", "noshow", 3)]), "no_show_cancelled")
        demo2 = self.call("x", "showed", 2, calendar_id="NDBNz6Og4yfpdpWmHrue", call_type=None)
        self.assertEqual(self.pool([demo2]), "unclosed_demo")

    def test_nobody_with_a_call_to_come_a_deal_a_client_tag_or_a_disqualified_call(self):
        self.assertIsNone(self.pool([self.call("intro", "noshow", 9), self.call("demo", "confirmed", -1)]))
        self.assertIsNone(self.pool([self.call("demo", "showed", 3)], dealt=True))
        self.assertIsNone(self.pool([self.call("intro", "invalid", 3)]))
        self.assertIsNone(self.pool([self.call("intro", "new", 3)]))  # never marked, never confirmed: not held
        self.assertIsNone(self.pool([], lead={**self.L, "tags": ["roas-qualified", "client"]}))
        self.assertIsNone(self.pool([], lead={**self.L, "contact_type": "customer"}))
        self.assertIsNone(self.pool([], lead={**self.L, "opp_status": "won"}))
        # Untagged and not-ready contacts are not leads: email nurture only.
        for tags in ([], ["roas-unprepared"], ["unqualified"], None):
            self.assertIsNone(self.pool([], lead={**self.L, "tags": tags}), tags)
        # A lost opportunity is what reactivation is for.
        self.assertEqual(self.pool([], lead={**self.L, "opp_status": "lost"}), "never_booked")

    def test_the_summary_counts_each_pool_and_its_holdout_and_writes_nothing(self):
        pg = FakePostgrest()
        for i in range(30):
            seed(pg, f"n{i:02d}", "no_show_cancelled")
        for i in range(12):
            seed(pg, f"g{i:02d}", "good_intro")
        seed(pg, "u1", "never_booked", tags=())
        with mock.patch.object(http, "request", pg):
            out = waves.pools_summary(sb(), NOW, waves.settings_of(SETTINGS))
        held = sum(waves.holdout(f"n{i:02d}", 0.1) for i in range(30))
        self.assertEqual(out["no_show_cancelled"], {"leads": 30, "held_back": held, "to_message": 30 - held})
        self.assertEqual(out["good_intro"]["leads"], 12)
        self.assertEqual(out["never_booked"]["leads"], 0)
        self.assertEqual(pg.writes(), [])


class Enrol(unittest.TestCase):
    def test_a_running_wave_enrols_its_pool_once_with_a_tenth_held_back(self):
        pg = FakePostgrest()
        routes(pg)
        for i in range(60):
            seed(pg, f"n{i:02d}", "no_show_cancelled", days=i + 1)
        for i in range(5):
            seed(pg, f"g{i}", "good_intro")
        wave(pg, "w1", "no_show_cancelled")
        out, _, _, _ = run(pg, guard={})  # the gate shut: enrolment still happens, nothing is written
        ms = members(pg, "w1")
        self.assertEqual(len(ms), 60)
        held = {m["contact_id"] for m in ms if m["arm"] == "holdout"}
        # Drawn with the wave's own salt (fix round 3): the same lead lands the
        # same way every run of this wave, and afresh in the next wave.
        salt = waves.wave_salt("waves", "w1")
        self.assertEqual(held, {f"n{i:02d}" for i in range(60) if waves.holdout(f"n{i:02d}", 0.1, salt)})
        self.assertTrue(all(m["state"] == ("held_out" if m["arm"] == "holdout" else "waiting") for m in ms))
        self.assertEqual(out["enrolled"]["w1"], {"enrolled": 60, "held_back": len(held), "skipped_busy": 0})
        self.assertEqual(pg.one("cockpit_sales_followup_wave_members", wave_id="w1", contact_id="n00")["event_at"], ago(days=1))
        self.assertEqual(pg.rows("cockpit_sales_followups"), [])
        out, _, _, _ = run(pg, guard={})
        self.assertEqual(out["enrolled"], {})  # once

    def test_a_lead_in_another_wave_or_sent_an_opener_lately_is_left_out(self):
        pg = FakePostgrest()
        for c in ("a", "b", "c"):
            seed(pg, c, "never_booked")
        wave(pg, "w0", "no_show_cancelled", state="paused")
        pg.put("cockpit_sales_followup_wave_members", {"wave_id": "w0", "contact_id": "a", "arm": "wave", "state": "waiting"})
        wave(pg, "old", "never_booked", state="done")
        pg.put("cockpit_sales_followup_wave_members", {"wave_id": "old", "contact_id": "b", "arm": "wave", "state": "sent",
                                                       "drafted_at": ago(days=10), "sent_at": ago(days=10)})
        wave(pg, "w1", "never_booked")
        run(pg, guard={})
        self.assertEqual({m["contact_id"] for m in members(pg, "w1")}, {"c"})

    def test_a_lead_held_back_by_a_running_wave_is_never_taken_by_another(self):
        pg = FakePostgrest()
        seed(pg, "h", "never_booked")
        wave(pg, "w0", "no_show_cancelled")
        pg.put("cockpit_sales_followup_wave_members", {"wave_id": "w0", "contact_id": "h", "arm": "holdout",
                                                       "state": "held_out"})
        wave(pg, "w1", "never_booked")
        run(pg, guard={})
        self.assertEqual(members(pg, "w1"), [])

    def test_an_empty_pool_ends_the_wave(self):
        pg = FakePostgrest()
        wave(pg, "w1", "good_intro")
        out, _, _, logs = run(pg)
        self.assertEqual(pg.one("cockpit_sales_followup_waves", id="w1")["state"], "done")
        self.assertIn("waves: good intros with no demo: nobody is in this pool now; the wave is done", logs)

    def test_a_lead_another_wave_claims_meanwhile_stays_out_and_the_rest_go_in(self):
        class Claimed(FakePostgrest):
            def __call__(self, method, url, **kw):
                if method == "POST" and "cockpit_sales_followup_wave_members" in url:
                    body = json.loads(kw["data"].decode())
                    if any(r["contact_id"] == "c07" for r in body):
                        raise http.HttpError(409, '{"code":"23505","message":"one running wave per contact"}', b"", url)
                return super().__call__(method, url, **kw)

        pg = Claimed()
        for i in range(10):
            seed(pg, f"c{i:02d}", "never_booked")
        wave(pg, "w1", "never_booked")
        run(pg, guard={})
        self.assertEqual({m["contact_id"] for m in members(pg, "w1")}, {f"c{i:02d}" for i in range(10)} - {"c07"})


class DayBatch(unittest.TestCase):
    def setup(self, n=100, pool="no_show_cancelled", **kw):
        pg = FakePostgrest()
        routes(pg)
        pg.put("cockpit_sales_people", {"email": "setter@x.co", "ghl_user_id": "u-set", "name": "Sara Haddad",
                                        "name_ar": "سارة", "active": True})
        for i in range(n):
            seed(pg, f"n{i:03d}", pool, days=i + 1, owner="u-set", **kw)
        wave(pg, "w1", pool)
        return pg

    def test_forty_openers_newest_first_no_model_text_one_meta_row_each(self):
        pg = self.setup()
        out, api, _, _ = run(pg)
        drafts = pg.rows("cockpit_sales_followups")
        self.assertEqual(len(drafts), 40)
        wave_arm = sorted((m for m in members(pg, "w1") if m["arm"] == "wave"), key=lambda m: m["event_at"], reverse=True)
        self.assertEqual({d["contact_id"] for d in drafts}, {m["contact_id"] for m in wave_arm[:40]})
        self.assertFalse({d["contact_id"] for d in drafts} & {m["contact_id"] for m in members(pg, "w1", arm="holdout")})
        d = drafts[0]
        self.assertEqual((d["segment"], d["channel"], d["template_key"], d["model"], d["touch"], d["status"]),
                         ("reactivate", "whatsapp_template", "opener_ar", None, 1, "draft"))
        self.assertEqual(d["body"], "السلام عليكم Omar، معاك سارة. كيف حالك؟")
        self.assertEqual(d["owner_email"], "setter@x.co")
        self.assertIn("the CEO's opener, no AI text", d["why"])
        self.assertEqual(d["context"]["wave_id"], "w1")
        meta = {m["followup_id"]: m for m in pg.rows("cockpit_sales_followup_meta")}
        self.assertEqual(set(meta), {x["id"] for x in drafts})
        self.assertEqual({m["wave_id"] for m in meta.values()}, {"w1"})
        self.assertEqual(len(members(pg, "w1", state="drafted")), 40)
        self.assertEqual(api.calls, [])  # nothing is sent until a person approves the batch
        self.assertEqual(out["drafted"]["drafted"], 40)

    def test_the_day_is_written_once_and_the_next_waits_for_the_last_batch(self):
        pg = self.setup()
        run(pg)
        out, _, _, _ = run(pg, now=NOW + timedelta(hours=2))
        self.assertIn("Today's 40 openers are written", out["drafted"]["waiting"])
        self.assertEqual(len(pg.rows("cockpit_sales_followups")), 40)
        tomorrow = NOW + timedelta(days=1)
        out, _, _, _ = run(pg, now=tomorrow)
        self.assertIn("still wait for approval", out["drafted"]["waiting"])
        for f in pg.rows("cockpit_sales_followups"):
            f["status"] = "sent"
        out, _, _, _ = run(pg, now=tomorrow)
        self.assertEqual(out["synced"]["sent"], 40)
        self.assertEqual(out["drafted"]["drafted"], 40)
        self.assertEqual(len(members(pg, "w1", state="sent")), 40)

    def test_nothing_is_written_while_the_gate_is_shut_before_nine_or_on_friday(self):
        for guard, now, says in (({}, NOW, fu.GATE_CLOSED),
                                 ({"connector_off": True, "single_copy_ok_at": None}, NOW, fu.GATE_CLOSED),
                                 (GATE_OPEN, NOW.replace(hour=5), "after 9:00 on a working day"),
                                 (GATE_OPEN, datetime(2026, 10, 9, 8, 0, tzinfo=timezone.utc), "after 9:00 on a working day")):
            pg = self.setup(n=5)
            out, _, _, _ = run(pg, now=now, guard=guard)
            self.assertIn(says, out["drafted"]["waiting"], (guard, now))
            self.assertEqual(pg.rows("cockpit_sales_followups"), [])
        ok, words = waves.words(run(self.setup(n=5), guard={})[0])
        self.assertFalse(ok)
        self.assertIn(fu.GATE_CLOSED.rstrip("."), words)

    def test_no_opener_without_its_template(self):
        pg = self.setup(n=5)
        pg.tables["cockpit_sales_wa_templates"].clear()
        out, _, _, _ = run(pg)
        self.assertIn("opener templates (opener_ar, opener_en) are not set up", out["drafted"]["waiting"])
        self.assertFalse(waves.words(out)[0])
        # Only the Arabic one: English leads wait for theirs, Arabic ones go.
        routes(pg, OPENER_AR)
        pg.put("cockpit_sales_leads", {**pg.one("cockpit_sales_leads", contact_id="n000"), "country": "United Kingdom"})
        out, _, _, _ = run(pg)
        self.assertEqual(out["drafted"]["later"] >= 1, True)
        self.assertNotIn("n000", {d["contact_id"] for d in pg.rows("cockpit_sales_followups")})

    def test_who_is_left_out_and_who_waits_for_another_day(self):
        pg = self.setup(n=12)
        people = {
            "n000": {"dndSettings": {"WhatsApp": {"status": "active"}}},
            "n001": {"phone": ""},
            "n002": {"firstName": ""},
            "n003": {"thread": [{"id": "s", "direction": "inbound", "messageType": "TYPE_WHATSAPP",
                                 "dateAdded": ago(days=3), "body": "مو مهتم"}]},
            "n004": {"thread": [{"id": "h", "direction": "inbound", "messageType": "TYPE_WHATSAPP",
                                 "dateAdded": ago(hours=2), "body": "Hi, any update?"}]},
            "n005": {"thread": [{"id": "w", "direction": "outbound", "messageType": "TYPE_WHATSAPP", "source": "workflow",
                                 "dateAdded": ago(hours=3), "body": "Reminder"}]},
        }
        pg.put("cockpit_sales_leads", {**pg.one("cockpit_sales_leads", contact_id="n006"), "name": "Al Noor Trading Est"})
        pg.put("cockpit_sales_followups", {"id": "open", "contact_id": "n007", "segment": "nurture", "status": "draft",
                                           "channel": "email", "created_at": ago(hours=1)})
        ghl = Ghl(pg, people)
        run(pg, ghl, guard={})  # enrol only
        # Booked again after the wave began.
        pg.put("cockpit_sales_calendar", {"appointment_id": "rebooked", "contact_id": "n008", "call_type": "intro",
                                          "status": "confirmed", "start_at": (NOW + timedelta(days=1)).isoformat()})
        for m in members(pg, "w1"):  # every one of them in the wave arm, for this test
            m.update({"arm": "wave", "state": "waiting"})
        out, _, _, _ = run(pg, ghl)
        why = {m["contact_id"]: m.get("excluded_reason") for m in members(pg, "w1", state="excluded")}
        self.assertIn("do-not-disturb", why["n000"])
        self.assertIn("No phone", why["n001"])
        self.assertIn("No first name", why["n002"])
        self.assertIn("paused until", why["n003"])
        self.assertIn("wrote to us lately", why["n004"])
        self.assertIn("No first name", why["n006"])
        self.assertIn("No longer in a backlog pool", why["n008"])
        waiting = {m["contact_id"] for m in members(pg, "w1", state="waiting")}
        self.assertEqual(waiting, {"n005", "n007"})  # an automation lately; another draft open
        self.assertEqual(len(members(pg, "w1", state="drafted")), 3)
        stop = pg.one("cockpit_sales_followup_stops", contact_id="n003")
        self.assertEqual((stop["kind"], stop["state"]), ("pause", "paused"))
        self.assertTrue(all(m == "GET" for m, _ in ghl.asked))

    def test_highlevel_down_for_one_lead_leaves_it_waiting_and_the_rest_go(self):
        pg = self.setup(n=3)
        run(pg, guard={})
        for m in members(pg, "w1"):
            m.update({"arm": "wave", "state": "waiting"})

        class Flaky(Ghl):
            def __call__(self, method, url, **kw):
                if "leadconnectorhq" in url and "n001" in url:
                    raise http.HttpError(0, "timed out", b"", url)
                return super().__call__(method, url, **kw)

        out, _, _, logs = run(pg, Flaky(pg))
        self.assertEqual((out["drafted"]["drafted"], out["drafted"]["unreadable"]), (2, 1))
        self.assertEqual({m["contact_id"] for m in members(pg, "w1", state="waiting")}, {"n001"})
        self.assertTrue(any("n001 waits: HighLevel could not be read" in x for x in logs))
        self.assertIn("1 waiting because HighLevel could not be read", waves.words(out)[1])

    def test_an_english_lead_with_no_rep_is_greeted_by_the_sales_team(self):
        pg = self.setup(n=1, country="United Kingdom")
        pg.one("cockpit_sales_leads", contact_id="n000")["assigned_to"] = None
        run(pg, guard={})
        for m in members(pg, "w1"):
            m.update({"arm": "wave", "state": "waiting"})
        run(pg)
        d = pg.rows("cockpit_sales_followups")[0]
        self.assertEqual((d["template_key"], d["body"]), ("opener_en", "Hi Omar, it's the sales team from Mahara Media. How are you?"))

    def test_running_waves_share_the_day_in_pool_order(self):
        pg = FakePostgrest()
        routes(pg)
        for i in range(25):
            seed(pg, f"n{i:02d}", "no_show_cancelled", days=i + 1)
        for i in range(60):
            seed(pg, f"b{i:02d}", "never_booked", days=i + 1)
        wave(pg, "w-never", "never_booked", started_at=ago(days=3))
        wave(pg, "w-noshow", "no_show_cancelled", started_at=ago(days=1))
        run(pg)
        made = pg.rows("cockpit_sales_followups")
        self.assertEqual(len(made), 40)
        by_wave = {}
        for d in made:
            by_wave[d["context"]["wave_id"]] = by_wave.get(d["context"]["wave_id"], 0) + 1
        n_noshow = len(members(pg, "w-noshow", arm="wave"))
        self.assertEqual(by_wave, {"w-noshow": n_noshow, "w-never": 40 - n_noshow})
        # A wave's own per_day is its ceiling within the day's.
        pg2 = self.setup(n=30)
        pg2.one("cockpit_sales_followup_waves", id="w1")["per_day"] = 7
        run(pg2)
        self.assertEqual(len(pg2.rows("cockpit_sales_followups")), 7)

    def test_a_run_that_stopped_after_writing_a_draft_adopts_it_and_a_race_is_not_a_second_draft(self):
        pg = self.setup(n=3)
        run(pg, guard={})
        for m in members(pg, "w1"):
            m.update({"arm": "wave", "state": "waiting"})
        pg.put("cockpit_sales_followups", {"id": "orphan", "contact_id": "n000", "segment": "reactivate", "status": "draft",
                                           "channel": "whatsapp_template", "created_at": NOW.isoformat(),
                                           "context": {"wave_id": "w1"}})
        run(pg)
        m = pg.one("cockpit_sales_followup_wave_members", wave_id="w1", contact_id="n000")
        self.assertEqual((m["state"], m["followup_id"]), ("drafted", "orphan"))
        self.assertEqual(len([d for d in pg.rows("cockpit_sales_followups") if d["contact_id"] == "n000"]), 1)

        class Raced(FakePostgrest):
            def __call__(self, method, url, **kw):
                if method == "POST" and url.endswith("/rest/v1/cockpit_sales_followups"):
                    raise http.HttpError(409, '{"code":"23505"}', b"", url)
                return super().__call__(method, url, **kw)

        pg3 = Raced()
        pg3.tables = pg.tables
        for m in members(pg3, "w1"):
            if m["state"] == "drafted" and m["contact_id"] != "n000":
                m.update({"state": "waiting", "followup_id": None, "drafted_at": None})
        for d in [d for d in pg3.rows("cockpit_sales_followups") if d["contact_id"] != "n000"]:
            del pg3.tables["cockpit_sales_followups"][(d["id"],)]
        out, _, _, _ = run(pg3)
        self.assertEqual((out["drafted"]["drafted"], out["drafted"]["raced"]), (0, 2))
        self.assertEqual(len(members(pg3, "w1", state="waiting")), 2)

    def test_members_follow_their_drafts(self):
        pg = self.setup(n=4)
        run(pg, guard={})
        for m in members(pg, "w1"):
            m.update({"arm": "wave", "state": "waiting"})
        run(pg)
        status = dict(zip(sorted(f["id"] for f in pg.rows("cockpit_sales_followups")), ("sent", "skipped", "expired", "failed")))
        for f in pg.rows("cockpit_sales_followups"):
            f["status"] = status[f["id"]]
        with mock.patch.object(http, "request", pg):
            out = waves.sync(sb(), ["w1"], NOW)
        self.assertEqual(out, {"sent": 1, "excluded": 1, "failed": 1, "back": 1})
        back = members(pg, "w1", state="waiting")[0]
        self.assertEqual((back["followup_id"], back["drafted_at"]), (None, None))
        self.assertEqual(members(pg, "w1", state="excluded")[0]["excluded_reason"], "A rep skipped the opener.")


class Pacing(unittest.TestCase):
    """An approved batch, sent by the desk."""

    def due(self, pg, n=10, *, country="Kuwait", channel="whatsapp_template", wid="w1", start=0):
        for i in range(start, start + n):
            c = f"p{i:02d}"
            pg.put("cockpit_sales_leads", {"contact_id": c, "country": country, "tags": ["roas-qualified"]})
            pg.put("cockpit_sales_followups", {"id": f"f{i:02d}", "contact_id": c, "segment": "reactivate",
                                               "channel": channel, "status": "draft", "touch": 1, "created_at": ago(hours=1)})
            pg.put("cockpit_sales_followup_meta", {"followup_id": f"f{i:02d}", "send_after": ago(minutes=30 - i),
                                                   "held_by": None, "wave_id": wid})

    def send(self, pg, *, guard=GATE_OPEN, budget=270.0, now=NOW, api=None, waves_=None, settings=None):
        clock = Clock(now)
        api = api or Api(pg, clock)
        api.clock = clock
        logs: list[str] = []
        with mock.patch.object(http, "request", pg):
            out = waves.send_due(sb(), api, settings=settings or SETTINGS, w=waves.settings_of(settings or SETTINGS),
                                 waves=waves_ or [{"id": "w1", "state": "running"}], guard=guard, clock=clock,
                                 sleep=clock.sleep, budget_s=budget, log=logs.append, warn=logs.append)
        return out, api, clock

    def test_one_every_45_seconds_in_order_until_the_runs_time_is_up(self):
        pg = FakePostgrest()
        self.due(pg)
        out, api, _ = self.send(pg)
        times = [t for t, _, _ in api.calls]
        self.assertEqual([i for _, _, i in api.calls], [f"f{i:02d}" for i in range(6)])
        self.assertTrue(all((b - a).total_seconds() >= 45 for a, b in zip(times, times[1:])))
        self.assertEqual((out["sent"], out["due"]), (6, 10))
        self.assertIn("time is up", out["stopped"])
        # The next run carries on, and keeps the gap from the last send.
        out2, api2, _ = self.send(pg, now=times[-1] + timedelta(seconds=10))
        self.assertEqual(api2.calls[0][0] - times[-1], timedelta(seconds=45))
        self.assertEqual(api2.calls[0][2], "f06")

    def test_nothing_on_whatsapp_while_the_gate_is_shut_and_email_still_goes(self):
        pg = FakePostgrest()
        self.due(pg, 3)
        self.due(pg, 1, channel="email", start=3)
        out, api, _ = self.send(pg, guard={"connector_off": False, "single_copy_ok_at": NOW.isoformat()})
        self.assertEqual(([i for _, _, i in api.calls], out["gate"]), (["f03"], 3))
        ok, words = waves.words({"waves": [{"state": "running"}], "sent": out})
        self.assertFalse(ok)
        self.assertIn("approved but held", words)

    def test_only_between_nine_and_six_on_the_leads_clock_and_never_on_their_day_off(self):
        pg = FakePostgrest()
        self.due(pg, 1, country="UAE")
        self.due(pg, 1, country="Kuwait", start=1)
        at = datetime(2026, 10, 4, 14, 30, tzinfo=timezone.utc)  # 18:30 Dubai, 17:30 Kuwait
        out, api, _ = self.send(pg, now=at)
        self.assertEqual(([i for _, _, i in api.calls], out["outside_hours"]), (["f01"], 1))
        friday = datetime(2026, 10, 9, 8, 0, tzinfo=timezone.utc)
        pg2 = FakePostgrest()
        self.due(pg2, 2)
        out, api, _ = self.send(pg2, now=friday)
        self.assertEqual((api.calls, out["outside_hours"]), ([], 2))

    def test_a_draft_held_while_the_desk_waits_is_not_sent(self):
        pg = FakePostgrest()
        self.due(pg, 3)
        clock = Clock(NOW)
        api = Api(pg, clock)

        def sleep(s):
            clock.sleep(s)
            pg.one("cockpit_sales_followup_meta", followup_id="f01")["held_by"] = "setter@x.co"

        with mock.patch.object(http, "request", pg):
            out = waves.send_due(sb(), api, settings=SETTINGS, w=waves.settings_of(SETTINGS),
                                 waves=[{"id": "w1", "state": "running"}], guard=GATE_OPEN, clock=clock, sleep=sleep,
                                 budget_s=1000, log=lambda _m: None, warn=lambda _m: None)
        self.assertEqual(([i for _, _, i in api.calls], out["held"]), (["f00", "f02"], 1))

    def test_a_paused_wave_sends_nothing(self):
        pg = FakePostgrest()
        self.due(pg, 3)
        out, api, _ = self.send(pg, waves_=[{"id": "w1", "state": "paused"}])
        self.assertEqual((api.calls, out["due"]), ([], 0))

    def test_it_stops_short_of_the_sender_ceiling_with_ten_left_for_the_demo_chat(self):
        pg = FakePostgrest()
        self.due(pg, 5)
        for i in range(20):
            pg.put("cockpit_sales_messages", {"id": f"old{i}", "sent_by": "sales-desk", "created_at": ago(minutes=5),
                                              "state": "sent"})
        out, api, _ = self.send(pg)
        self.assertEqual(api.calls, [])
        self.assertIn("keeps 10 for the demo chat", out["stopped"])

    def test_fifty_due_with_other_desk_sends_alongside_never_reach_the_ceiling(self):
        pg = FakePostgrest()
        self.due(pg, 50)
        # Each wave send comes with three more desk sends in the same moment (a busy demo chat tick).
        out, api, clock = self.send(pg, budget=7200, api=Api(pg, Clock(NOW), extra_per_send=3))
        sends = sorted(fu._ts(m["created_at"]) for m in pg.rows("cockpit_sales_messages"))
        worst = max(sum(1 for t in sends if s <= t < s + timedelta(minutes=10)) for s in sends)
        self.assertLess(worst, waves.CEILING)
        self.assertIn("sender ceiling", out["stopped"])

    def test_a_refusal_for_everyone_stops_the_run_and_one_for_a_lead_does_not(self):
        for answer in ((409, {"error": "Today's 250 WhatsApp templates have gone out."}),
                       (429, {"error": "That is 30 messages in ten minutes from you."}),
                       (409, {"error": "Something", "hold_all": True}),
                       (409, {"error": "Automatic WhatsApp sends are paused: 6 of the last day's 20 failed."})):
            pg = FakePostgrest()
            self.due(pg, 4)
            out, api, _ = self.send(pg, budget=1000, api=Api(pg, Clock(NOW), script=[answer]))
            self.assertEqual((len(api.calls), out["sent"]), (1, 0), answer)
            self.assertTrue(out["stopped"])
        pg = FakePostgrest()
        self.due(pg, 4)
        lead_refusal = (409, {"error": "This lead asked not to be contacted on WhatsApp (do not disturb is on in HighLevel)."})
        out, api, _ = self.send(pg, budget=1000, api=Api(pg, Clock(NOW), script=[lead_refusal]))
        self.assertEqual((len(api.calls), out["sent"], out["refused"]), (4, 3, 1))
        pg = FakePostgrest()
        self.due(pg, 5)
        out, api, _ = self.send(pg, budget=1000, api=Api(pg, Clock(NOW), script=[lead_refusal] * 3))
        self.assertEqual(len(api.calls), 3)
        self.assertIn("Three sends in a row were refused", out["stopped"])

    def test_a_door_that_does_not_answer_stops_the_run_and_nothing_is_marked(self):
        pg = FakePostgrest()
        self.due(pg, 3)
        out, api, _ = self.send(pg, api=Api(pg, Clock(NOW), script=[http.HttpError(0, "timed out")]))
        self.assertEqual((len(api.calls), out["sent"]), (1, 0))
        self.assertIn("sales-api did not answer", out["stopped"])
        self.assertEqual({f["status"] for f in pg.rows("cockpit_sales_followups")}, {"draft"})


class WholeRun(unittest.TestCase):
    def test_start_draft_approve_and_send_and_the_status_line_says_so(self):
        pg = FakePostgrest()
        routes(pg)
        for i in range(12):
            seed(pg, f"n{i:02d}", "no_show_cancelled", days=i + 1)
        wave(pg, "w1", "no_show_cancelled")
        out, api, _, _ = run(pg)
        ok, words = waves.words(out)
        n = len(members(pg, "w1", arm="wave"))
        self.assertTrue(ok)
        self.assertIn(f"{n} openers written for approval", words)
        self.assertEqual(api.calls, [])
        # The owner approves the batch (sales-api followup.batch writes send_after).
        for i, m in enumerate(sorted(pg.rows("cockpit_sales_followup_meta"), key=lambda m: m["followup_id"])):
            m["send_after"] = (NOW + timedelta(seconds=45 * i)).isoformat()
        out, api, clock, _ = run(pg, now=NOW + timedelta(minutes=1), budget=270)
        self.assertGreaterEqual(out["sent"]["sent"], 2)
        ok, words = waves.words(out)
        self.assertIn(f"{out['sent']['sent']} sent", words)
        self.assertEqual(len(members(pg, "w1", state="drafted")), n)  # synced as sent on the next run
        out, _, _, _ = run(pg, now=NOW + timedelta(minutes=10))
        self.assertGreater(out["synced"]["sent"], 0)

    def test_without_the_highlevel_key_it_says_so_and_is_not_ok(self):
        pg = FakePostgrest()
        routes(pg)
        seed(pg, "n1", "never_booked")
        wave(pg, "w1", "never_booked")
        out, _, _, _ = run(pg, token="")
        ok, words = waves.words(out)
        self.assertFalse(ok)
        self.assertIn("GHL_B2B_API_KEY is not set", words)


class TestOpener(unittest.TestCase):
    def test_the_test_path_writes_the_opener_for_a_test_contact_on_do_not_disturb(self):
        pg = FakePostgrest()
        routes(pg)
        pg.put("cockpit_sales_leads", {"contact_id": "t1", "name": "Aziz", "tags": ["cockpit-test"], "dnd": True,
                                       "phone": "+96550000001", "country": "Kuwait"})
        with mock.patch.object(http, "request", Ghl(pg, {"t1": {"firstName": "Aziz", "dnd": True}})):
            out = fu.run(sb(), None, lambda _m: None, settings=SETTINGS, ghl_token="t", now=NOW,
                         only_contact="t1", force_segment="reactivate")
        self.assertEqual((out["written"], out["test"]), (1, True))
        d = pg.rows("cockpit_sales_followups")[0]
        self.assertEqual((d["segment"], d["template_key"], d["model"]), ("reactivate", "opener_ar", None))
        self.assertTrue(d["why"].startswith("Test contact: do-not-disturb is on"))
        self.assertEqual(pg.rows("cockpit_sales_followup_wave_members"), [])
        self.assertEqual(pg.rows("cockpit_sales_followup_meta"), [])


if __name__ == "__main__":
    unittest.main()
