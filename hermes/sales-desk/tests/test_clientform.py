"""The New Client Form's questions into the cockpit (desk/clientform.py):
the form's screens in order, refs kept, statements left out, at most every
ten minutes, and an empty form never replaces the last good copy."""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from typing import Any

from desk import clientform


FORM: dict[str, Any] = {
    "id": "BTzMwXiw",
    "title": "New Client Form",
    "last_updated_at": "2026-09-24T08:45:18.753867Z",
    "hidden": ["contact_id", "closer", "setter"],
    "_links": {"display": "https://maharamedia.typeform.com/to/BTzMwXiw"},
    "fields": [
        {"type": "inline_group", "title": "General Information", "ref": "g1", "properties": {"fields": [
            {"type": "dropdown", "title": "Who Closed The Deal?", "ref": "closer-ref",
             "validations": {"required": True},
             "properties": {"description": "Choose the closer.", "choices": [{"label": "Aziz Waheedi"}, {"label": "Maria"}]}},
            {"type": "short_text", "title": "Client First Name", "ref": "first-ref", "validations": {"required": True},
             "properties": {}},
            {"type": "statement", "title": "Thanks!", "ref": "s1", "properties": {}},
        ]}},
        {"type": "long_text", "title": "Anything else?", "ref": "loose-ref", "properties": {}},
    ],
}


class FakeSettings:
    def __init__(self, value: Any = None):
        self.value = value
        self.writes: list[Any] = []

    def setting(self, key: str) -> Any:
        assert key == clientform.SETTING_KEY
        return self.value

    def store_setting(self, key: str, value: Any, by: str) -> None:
        assert (key, by) == (clientform.SETTING_KEY, "sales-desk")
        self.value = value
        self.writes.append(value)


NOW = datetime(2026, 10, 2, 16, 0, tzinfo=timezone.utc)


class ClientFormTests(unittest.TestCase):
    def test_the_screens_follow_the_form_with_refs_and_choices(self):
        s = clientform.setting_from(FORM, "2026-10-02T16:00:00Z")
        self.assertEqual([x["title"] for x in s["screens"]], ["General Information", ""])
        first = s["screens"][0]["questions"]
        self.assertEqual([q["ref"] for q in first], ["closer-ref", "first-ref"])
        self.assertEqual(first[0]["choices"], ["Aziz Waheedi", "Maria"])
        self.assertTrue(first[0]["required"])
        self.assertEqual(first[0]["description"], "Choose the closer.")
        self.assertEqual(s["hidden"], ["contact_id", "closer", "setter"])
        self.assertEqual(s["url"], "https://maharamedia.typeform.com/to/BTzMwXiw")
        self.assertEqual(s["screens"][1]["questions"][0]["ref"], "loose-ref")

    def test_it_reads_at_most_every_ten_minutes_unless_forced(self):
        sb = FakeSettings({"synced_at": (NOW - timedelta(minutes=4)).isoformat()})
        calls: list[str] = []

        def reader(token: str) -> dict[str, Any]:
            calls.append(token)
            return FORM

        self.assertFalse(clientform.sync_client_form(sb, "t", lambda _m: None, now=NOW, reader=reader))
        self.assertEqual(calls, [])
        self.assertTrue(clientform.sync_client_form(sb, "t", lambda _m: None, now=NOW, reader=reader, force=True))
        later = NOW + timedelta(minutes=11)
        self.assertTrue(clientform.sync_client_form(sb, "t", lambda _m: None, now=later, reader=reader))
        self.assertEqual(len(calls), 2)
        self.assertEqual(sb.value["synced_at"], "2026-10-02T16:11:00Z")

    def test_a_form_with_no_questions_keeps_the_last_copy(self):
        good = clientform.setting_from(FORM, "2026-10-02T15:00:00Z")
        sb = FakeSettings(good)
        with self.assertRaises(ValueError):
            clientform.sync_client_form(sb, "t", lambda _m: None, force=True, now=NOW,
                                        reader=lambda _t: {"id": "BTzMwXiw", "fields": []})
        self.assertEqual(sb.value, good)
        self.assertEqual(sb.writes, [])

    def test_no_token_says_so_by_name(self):
        with self.assertRaises(ValueError) as e:
            clientform.read_form("")
        self.assertIn("TYPEFORM_API_TOKEN", str(e.exception))


if __name__ == "__main__":
    unittest.main()
