import json
import unittest
from pathlib import Path

WORKSPACE_ROOT = Path(__file__).resolve().parent.parent

COCKPITS = [
    {
        "name": "media-buyer",
        "path": WORKSPACE_ROOT / "apps" / "media-buyer-cockpit" / "vercel.json",
    },
    {
        "name": "client-success",
        "path": WORKSPACE_ROOT / "apps" / "client-success-cockpit" / "vercel.json",
    },
    {
        "name": "creative-director",
        "path": WORKSPACE_ROOT / "apps" / "creative-director-cockpit" / "vercel.json",
    },
    {
        "name": "video-editor",
        "path": WORKSPACE_ROOT / "apps" / "video-editor-cockpit" / "vercel.json",
    },
    {
        "name": "sales",
        "path": WORKSPACE_ROOT / "apps" / "sales-cockpit" / "vercel.json",
    },
]

EXPECTED_TOKENS = {
    "'self'",
    "https://bldgtotkfmhoxmlzowdx.supabase.co",
    "wss://bldgtotkfmhoxmlzowdx.supabase.co",
}

ARBITRARY_CONVEX_ORIGINS = [
    "https://happy-otter-123.convex.cloud",
    "wss://happy-otter-123.convex.cloud",
    "https://swift-fox-456.convex.site",
    "https://convex.cloud",
    "wss://convex.cloud",
    "https://convex.site",
]


class TestCockpitConnectPolicy(unittest.TestCase):
    def test_enforced_connect_src_and_token_sets(self):
        for cockpit in COCKPITS:
            with self.subTest(cockpit=cockpit["name"]):
                with open(cockpit["path"], "r", encoding="utf-8") as f:
                    config = json.load(f)

                headers_entries = config.get("headers", [])
                global_routes = [h for h in headers_entries if h.get("source") == "/(.*)"]
                self.assertEqual(len(global_routes), 1)

                route_headers = global_routes[0].get("headers", [])
                csp_headers = [
                    h for h in route_headers
                    if h.get("key", "").lower() == "content-security-policy"
                ]
                self.assertEqual(len(csp_headers), 1)

                report_only_headers = [
                    h for h in route_headers
                    if h.get("key", "").lower() == "content-security-policy-report-only"
                ]
                self.assertEqual(len(report_only_headers), 0)

                raw_policy = csp_headers[0].get("value", "").strip()
                directives = [d.strip() for d in raw_policy.split(";") if d.strip()]
                self.assertEqual(len(directives), 1)

                directive_parts = directives[0].split()
                self.assertEqual(directive_parts[0], "connect-src")

                token_set = set(directive_parts[1:])
                self.assertEqual(token_set, EXPECTED_TOKENS)

                for convex in ARBITRARY_CONVEX_ORIGINS:
                    self.assertNotIn(convex, token_set)

    def test_preserve_configuration_properties(self):
        for cockpit in COCKPITS:
            with self.subTest(cockpit=cockpit["name"]):
                with open(cockpit["path"], "r", encoding="utf-8") as f:
                    config = json.load(f)
                self.assertIn("rewrites", config)


if __name__ == "__main__":
    unittest.main()
