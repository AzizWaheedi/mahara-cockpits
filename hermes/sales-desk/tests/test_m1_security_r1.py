"""Milestone 1, video-link round 1, security angle on the desk: a Zoom host
link must never reach a log line, a Supabase row or the cockpit. The scrub
every error passes through (desk/http.py) is the one guard. Nothing reaches
the network.

    python3 -m unittest tests.test_m1_security_r1
"""
from __future__ import annotations

import os
import unittest

os.environ["SALES_NO_KEY_FILES"] = "1"

from desk import http  # noqa: E402


class HostLinkScrub(unittest.TestCase):
    def test_control_plain_zak_is_hidden(self) -> None:
        """The plain form is hidden (the fixture works)."""
        out = http.scrub("Zoom said: https://us06web.zoom.us/s/81234567890?zak=hosttoken123")
        self.assertNotIn("hosttoken123", out)

    def test_host_link_escaped_zak(self) -> None:
        """Zoom reads %7A as z in a parameter's name: ?%7Aak= is the host's zak=."""
        out = http.scrub("Zoom said: https://us06web.zoom.us/j/81234567890?pwd=abc&%7Aak=hosttoken123")
        self.assertNotIn("hosttoken123", out)


if __name__ == "__main__":
    unittest.main()
