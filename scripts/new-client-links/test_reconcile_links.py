import copy
import json
import os
import tempfile
import unittest

import reconcile_links as r


def fixture():
    urls = {
        "folderLink": "https://drive.google.com/drive/folders/fake_folder",
        "offerLink": "https://docs.google.com/document/d/fake_offer/edit",
        "brandDnaLink": "https://docs.google.com/document/d/fake_dna/edit",
        "reportLink": "https://docs.google.com/spreadsheets/d/fake_sheet/edit",
    }
    files = {}
    for name, mime in r.FIELDS.items():
        files[name] = {"id": r.file_id(urls[name], name), "mimeType": mime, "trashed": False,
                       "parents": [] if name == "folderLink" else ["fake_folder"]}
    return {"complete_task_fields": True, "source_task_id": "test123",
            "source_execution_id": "a" * 32,
            "task": {"id": "test123", "date_updated": "100", "custom_fields": [
                {"id": "unrelated", "value": [1, 2]},
                *[{"id": "synthetic_" + name} for name in r.FIELDS],
            ]},
            "make_output": {"success": True, **urls}, "drive_metadata": files,
            "field_schema": {name: {"id": "synthetic_" + name, "type": "url"} for name in r.FIELDS}}


class ReconciliationTests(unittest.TestCase):
    def test_dry_run_and_before_after(self):
        s = fixture()
        p = r.create_plan(s)
        self.assertEqual(len(p["changes"]), 4)
        self.assertTrue(r.check(p, s["task"], "before")["verified"])
        done = copy.deepcopy(s["task"])
        done["date_updated"] = "101"
        for field in done["custom_fields"]:
            for name, value in p["changes"].items():
                if field["id"] == s["field_schema"][name]["id"]:
                    field["value"] = value
        self.assertTrue(r.check(p, done, "after")["verified"])
        self.assertEqual(r.create_plan({**s, "task": done})["changes"], {})

    def test_different_existing_value_refuses(self):
        s = fixture()
        next(f for f in s["task"]["custom_fields"] if f["id"] == s["field_schema"]["folderLink"]["id"])["value"] = "https://different.example/"
        with self.assertRaises(r.Refusal): r.create_plan(s)

    def test_same_existing_value_is_not_changed(self):
        s = fixture()
        next(f for f in s["task"]["custom_fields"] if f["id"] == s["field_schema"]["folderLink"]["id"])["value"] = s["make_output"]["folderLink"]
        self.assertNotIn("folderLink", r.create_plan(s)["changes"])

    def test_concurrent_change_refuses_before(self):
        s = fixture(); p = r.create_plan(s); current = copy.deepcopy(s["task"])
        current["date_updated"] = "101"
        with self.assertRaises(r.Refusal): r.check(p, current, "before")
        current["date_updated"] = "100"
        next(f for f in current["custom_fields"] if f["id"] == s["field_schema"]["folderLink"]["id"])["value"] = "different"
        with self.assertRaises(r.Refusal): r.check(p, current, "before")

    def test_omitted_field_is_not_assumed_unset(self):
        for name in r.FIELDS:
            s = fixture()
            plan = r.create_plan(s)
            s["task"]["custom_fields"] = [f for f in s["task"]["custom_fields"] if f["id"] != s["field_schema"][name]["id"]]
            with self.subTest(field=name, phase="plan"), self.assertRaises(r.Refusal):
                r.create_plan(s)
            for phase in ("before", "after"):
                with self.subTest(field=name, phase=phase), self.assertRaises(r.Refusal):
                    r.check(plan, s["task"], phase)

    def test_present_field_with_null_or_empty_value_is_unset(self):
        for empty in (None, ""):
            s = fixture()
            target = next(f for f in s["task"]["custom_fields"] if f["id"] == s["field_schema"]["folderLink"]["id"])
            target["value"] = empty
            self.assertEqual(len(r.create_plan(s)["changes"]), 4)

    def test_incomplete_after_refuses(self):
        s = fixture(); p = r.create_plan(s)
        with self.assertRaises(r.Refusal): r.check(p, s["task"], "after")

    def test_source_must_match_task_and_be_complete(self):
        for change in ({"source_task_id": "another"}, {"complete_task_fields": False}, {"source_execution_id": "oops"}):
            s = fixture(); s.update(change)
            with self.assertRaises(r.Refusal): r.create_plan(s)

    def test_unknown_url_and_unverified_files_refused(self):
        for field, value in [("offerLink", "https://evil.example/document/d/fake_offer/edit"),
                             ("folderLink", "http://drive.google.com/drive/folders/fake_folder")]:
            s = fixture(); s["make_output"][field] = value
            with self.assertRaises(r.Refusal): r.create_plan(s)
        for field, mutation in [("reportLink", {"parents": ["other"]}), ("brandDnaLink", {"trashed": True}),
                                ("offerLink", {"mimeType": "text/plain"})]:
            s = fixture(); s["drive_metadata"][field].update(mutation)
            with self.assertRaises(r.Refusal): r.create_plan(s)

    def test_wrong_schema_and_duplicate_field_refused(self):
        s = fixture(); s["field_schema"]["folderLink"]["type"] = "text"
        with self.assertRaises(r.Refusal): r.create_plan(s)
        s = fixture(); s["task"]["custom_fields"] += [{"id": "duplicate"}, {"id": "duplicate"}]
        with self.assertRaises(r.Refusal): r.create_plan(s)

    def test_tampered_plan_refused(self):
        s = fixture(); p = r.create_plan(s); p["changes"]["reportLink"] = "https://evil.example"
        with self.assertRaises(r.Refusal): r.check(p, s["task"], "before")

    def test_private_save_is_owner_only_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "plan.json")
            r.private_write(path, r.create_plan(fixture()))
            self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError): r.private_write(path, {})
            with open(path, encoding="utf-8") as f: self.assertEqual(json.load(f)["task_id"], "test123")

    def test_private_save_refuses_repo_and_symlink(self):
        with tempfile.TemporaryDirectory() as d:
            repo = os.path.join(d, "repo"); os.mkdir(repo)
            os.mkdir(os.path.join(repo, ".git"))
            with self.assertRaises(r.Refusal): r.private_write(os.path.join(repo, "plan.json"), {})
            target = os.path.join(d, "target"); link = os.path.join(d, "link")
            with open(target, "w", encoding="utf-8") as f: f.write("preserve")
            os.symlink(target, link)
            with self.assertRaises(FileExistsError): r.private_write(link, {})


if __name__ == "__main__": unittest.main()
