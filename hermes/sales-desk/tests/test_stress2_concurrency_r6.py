"""Stress series 2, round 6, concurrency and idempotency, the desk's half
(2026-10-05). Each test asserts what must hold; a failing test names a
defect for the fix lane. Every lead, name and line is invented.

    python3 -m unittest tests.test_stress2_concurrency_r6
"""
from __future__ import annotations

import os
import unittest
from datetime import timedelta
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http, waves  # noqa: E402
from tests import test_waves as tw  # noqa: E402
from tests.fakes import FakePostgrest  # noqa: E402
from tests.test_waves_breakit import due_draft  # noqa: E402

WNOW = tw.NOW  # 10:00 Kuwait, a Sunday


def wago(**kw) -> str:
    return (WNOW - timedelta(**kw)).isoformat()


# ---------------------------------------------------------------------------
# 1. The desk's "put off" re-arms an opener a rep released meanwhile.
#
#    followup.hold (sales-api) takes the opener's approval back on a Hold AND
#    on its release (send_after and approved_by null): "a released opener
#    waits for the next Approve all (as the page says), never goes on an
#    approval given before the rep held it" (first series,
#    release-of-approved-hold-sends-without-approval). The desk's send run
#    reads the lead's conversation in HighLevel before each opener
#    (live_conversation, stress2 round 3) and, when we messaged the lead
#    lately, puts the send off: PATCH meta send_after = until, guarded only
#    on held_by is null. A rep who held the opener and released it while the
#    run read HighLevel (a slow read, seconds) leaves held_by null and
#    send_after null; the put-off write then lands on the released row and
#    gives it a send time again. At that time the next run asks sales-api's
#    followup.send_due, which checks held_by and send_after only: the opener
#    goes with no approval, on a lead whose rep just took it back.
# ---------------------------------------------------------------------------

class APutOffAfterARelease(unittest.TestCase):
    def test_a_released_opener_is_never_given_a_send_time_again_by_the_desk(self):
        pg = FakePostgrest()
        tw.routes(pg)
        tw.wave(pg, "w1", "no_show_cancelled", enrolled_at=wago(days=1))
        due_draft(pg, 0, wid="w1", send_after=wago(minutes=5))
        f = pg.one("cockpit_sales_followups", id="f000")
        f.update({"context": {"wave_id": "w1", "language": "ar"}, "created_at": wago(hours=20),
                  "expires_at": (WNOW + timedelta(hours=40)).isoformat()})
        meta = pg.one("cockpit_sales_followup_meta", followup_id="f000")
        meta.update({"approved_by": "boss@stress.invalid", "approved_at": wago(minutes=5)})
        pg.put("cockpit_sales_inbox", {"conversation_id": "cv-p000", "contact_id": "p000", "last_direction": "outbound",
                                       "last_type": "TYPE_WHATSAPP", "last_message_at": wago(hours=2)})
        # The setter wrote to the lead by hand two hours ago: the desk puts the opener off to 20 hours after it.
        by_hand = {"id": "out-1", "direction": "outbound", "messageType": "TYPE_WHATSAPP", "source": "app",
                   "dateAdded": wago(hours=2), "body": "Hi Omar, are you free for a quick call today?"}
        released: list[str] = []

        class Ghl(tw.Ghl):
            def __call__(self, method, url, **kw):
                if "leadconnectorhq" in url and "/conversations/cv-p000/" in url and not released:
                    # While the desk reads the conversation, the rep presses Hold, then Release
                    # (sales-api followup.hold on and off): the approval is taken back.
                    meta.update({"held_by": None, "hold_reason": None, "send_after": None, "approved_by": None})
                    released.append("released")
                return super().__call__(method, url, **kw)

        ghl = Ghl(pg, {"p000": {"thread": [by_hand]}})
        clock = tw.Clock(WNOW)
        api = tw.Api(pg, clock)
        logs: list[str] = []
        with mock.patch.object(http, "request", ghl):
            out = waves.send_due(tw.sb(), api, settings=tw.SETTINGS, w=waves.settings_of(tw.SETTINGS),
                                 waves=[{"id": "w1", "state": "running"}], guard=tw.GATE_OPEN, clock=clock,
                                 sleep=clock.sleep, budget_s=270, log=logs.append, warn=logs.append, ghl_token="t")
        self.assertTrue(released, "held control: the rep's release landed while the desk read the conversation")
        self.assertEqual([], [i for _, _, i in api.calls], f"held control: nothing went in this run ({out})")
        after = pg.one("cockpit_sales_followup_meta", followup_id="f000")
        # The next run, the next morning (10:00 Kuwait, inside the first-message hours): the
        # put-off time has come and the conversation is quiet.
        later = tw.Clock(WNOW + timedelta(hours=24))
        api2 = tw.Api(pg, later)
        quiet = tw.Ghl(pg, {"p000": {"thread": []}})
        with mock.patch.object(http, "request", quiet):
            waves.send_due(tw.sb(), api2, settings=tw.SETTINGS, w=waves.settings_of(tw.SETTINGS),
                           waves=[{"id": "w1", "state": "running"}], guard=tw.GATE_OPEN, clock=later,
                           sleep=later.sleep, budget_s=270, log=logs.append, warn=logs.append, ghl_token="t")
        self.assertEqual(
            {"send_after": after.get("send_after"), "asked_to_send": [i for _, _, i in api2.calls]},
            {"send_after": None, "asked_to_send": []},
            "the rep took the opener's approval back (Hold, then Release) while the desk read the lead's "
            "conversation; the desk's put-off write (guarded on held_by alone) gave it a send time again, "
            f"approved_by {after.get('approved_by')!r}, and the next run asked sales-api to send it")


if __name__ == "__main__":
    unittest.main()
