"""Milestone 1, video-link round 3, security angle (the desk): a Zoom host
token whose parameter name is escaped as capital letters.

    python3 -m unittest tests.test_m1_security_r3
"""
import unittest
import urllib.parse

from desk import http


class EscapedCapitalZak(unittest.TestCase):
    def test_control_zak_and_lowercase_escapes_are_scrubbed(self):
        for name in ("zak", "ZAK", "%7Aak", "%7A%61%6B"):
            line = f"https://us06web.zoom.us/j/81234567890?pwd=abc&{name}=hosttoken123"
            self.assertNotIn("hosttoken123", http.scrub(line), name)

    def test_host_link_escaped_zak_capitals_kept_by_scrub(self):
        # %5A%41%4B is ZAK once decoded: the same name the scrub hides as ZAK=.
        self.assertEqual(urllib.parse.unquote("%5A%41%4B").lower(), "zak")
        line = "https://us06web.zoom.us/j/81234567890?pwd=abc&%5A%41%4B=hosttoken123"
        self.assertNotIn("hosttoken123", http.scrub(line))


if __name__ == "__main__":
    unittest.main()
