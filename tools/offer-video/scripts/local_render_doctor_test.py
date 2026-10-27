import unittest
from io import StringIO
from unittest.mock import patch

from local_render_doctor import REQUIRED, OPTIONAL_UNUSED, local_render_readiness, main


def ready():
    return {"ok": True, "checks": [{"name": name, "ok": True} for name in sorted(REQUIRED)]}


class LocalRenderDoctorTests(unittest.TestCase):
    def test_local_dependencies_pass_without_unused_tools(self):
        report = ready()
        report["ok"] = False
        report["checks"] += [{"name": name, "ok": False} for name in sorted(OPTIONAL_UNUSED)]
        for status in (0, 1):
            result = local_render_readiness(report, status)
            self.assertTrue(result["ok"])
            self.assertEqual(set(result["optionalUnavailable"]), OPTIONAL_UNUSED)

    def test_unexpected_cli_exit_fails_even_with_a_passing_report(self):
        for status in (-1, 2, 127, 137, None, "0", True):
            self.assertFalse(local_render_readiness(ready(), status)["ok"])

    def test_exit_one_cannot_hide_bad_or_incomplete_json(self):
        self.assertFalse(local_render_readiness({}, 1)["ok"])
        report = ready()
        report["checks"][0]["ok"] = False
        self.assertFalse(local_render_readiness(report, 1)["ok"])

    def test_cli_rejects_malformed_json_with_exit_one(self):
        with patch("sys.argv", ["local_render_doctor.py", "doctor.json", "1"]), \
             patch("local_render_doctor.Path.read_text", return_value="{invalid"), \
             patch("sys.stdout", new_callable=StringIO) as output:
            self.assertEqual(main(), 1)
            self.assertIn("Doctor JSON could not be read", output.getvalue())

    def test_every_local_dependency_is_required_and_must_pass(self):
        for name in REQUIRED:
            with self.subTest(name=name):
                report = ready()
                report["checks"] = [c for c in report["checks"] if c["name"] != name]
                self.assertIn(f"Missing check: {name}", local_render_readiness(report)["failures"])
                report["checks"].append({"name": name, "ok": False})
                self.assertIn(name, local_render_readiness(report)["failures"])

    def test_unknown_failure_and_shared_memory_failure_block(self):
        for name in ("New render dependency", "/dev/shm", "Docker storage"):
            report = ready()
            report["checks"].append({"name": name, "ok": False})
            self.assertFalse(local_render_readiness(report)["ok"])

    def test_global_ok_cannot_hide_an_individual_failure(self):
        report = ready()
        report["checks"][0]["ok"] = False
        self.assertFalse(local_render_readiness(report)["ok"])

    def test_malformed_empty_and_duplicate_results_fail_closed(self):
        for report in (None, [], {}, {"checks": []}, {"checks": [None]}):
            self.assertFalse(local_render_readiness(report)["ok"])
        for value in (None, "true", 1):
            report = ready()
            report["checks"][0]["ok"] = value
            self.assertFalse(local_render_readiness(report)["ok"])
            report = ready()
            report["ok"] = value
            self.assertFalse(local_render_readiness(report)["ok"])
        report = ready()
        report["checks"].append(report["checks"][0].copy())
        self.assertFalse(local_render_readiness(report)["ok"])

    def test_environment_details_are_not_echoed(self):
        report = ready()
        report["checks"].append({"name": "Docker running", "ok": False, "detail": "private-environment-value"})
        self.assertNotIn("private-environment-value", str(local_render_readiness(report)))


if __name__ == "__main__":
    unittest.main()
