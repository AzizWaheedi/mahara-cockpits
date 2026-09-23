"""Unit tests for the webinar pull: the parts that turn Zoom and Typeform
answers into rows. Run: python3 -m unittest -v test_pull"""

from __future__ import annotations

import datetime as dt
import unittest

import pull

PULLED = "2026-09-23T12:00:00+00:00"
UUID = "ZX4as2A+Qq+ejA6SnGIcnA=="


def participant(**kw):
    base = {"id": "", "user_id": "16778240", "name": "Guest", "user_email": "",
            "join_time": "2026-09-30T17:00:30Z", "leave_time": "2026-09-30T18:20:00Z",
            "duration": 4770, "status": "in_meeting", "internal_user": False,
            "registrant_id": "", "failover": False}
    base.update(kw)
    return base


class Chat(unittest.TestCase):
    def test_tab_layout(self):
        lines = pull.parse_chat("00:10:42\tAziz Waheedi:\tأهلا بالجميع\r\n00:31:05\tسارة:\t1\r\n")
        self.assertEqual([(c["offset_s"], c["name"], c["body"]) for c in lines],
                         [(642, "Aziz Waheedi", "أهلا بالجميع"), (1865, "سارة", "1")])

    def test_from_layout_with_body_on_next_line(self):
        text = "00:31:05 From Khalid to Everyone:\n\t1\n00:31:09 From Nada to Khalid:\n\tشكرا\n"
        lines = pull.parse_chat(text)
        self.assertEqual(lines[0]["name"], "Khalid")
        self.assertEqual(lines[0]["body"], "1")
        self.assertEqual(lines[1]["to"], "Khalid")
        self.assertEqual(lines[1]["body"], "شكرا")

    def test_continuation_line_joins_the_message_above(self):
        lines = pull.parse_chat("00:01:00\tA:\tfirst line\nsecond line\n")
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]["body"], "first line\nsecond line")

    def test_same_line_twice_in_one_second_is_two_rows(self):
        lines = pull.parse_chat("00:31:05\tسارة:\t1\n00:31:05\tسارة:\t1\n")
        base = dt.datetime(2026, 9, 30, 17, 0, tzinfo=dt.timezone.utc)
        rows = pull.chat_rows(UUID, base, lines, {}, PULLED)
        self.assertEqual(len({r["row_key"] for r in rows}), 2)
        self.assertEqual(rows[0]["at"], "2026-09-30T17:31:05+00:00")
        self.assertEqual(rows[0]["person_key"], "name:سارة")

    def test_private_message_keeps_who_it_was_to(self):
        lines = pull.parse_chat("00:31:09 From Nada to Khalid:\n\thi\n")
        rows = pull.chat_rows(UUID, dt.datetime(2026, 9, 30, tzinfo=dt.timezone.utc), lines, {}, PULLED)
        self.assertEqual(rows[0]["payload"], {"to": "Khalid"})

    def test_chat_takes_the_strongest_key_for_a_name(self):
        att = pull.attendance_rows(UUID, [
            participant(name="Khalid", user_email="k@firm.com"),
            participant(name="Khalid", user_id="16778241", join_time="2026-09-30T17:40:00Z"),
        ], {}, PULLED)
        keys = pull.name_keys(att)
        self.assertEqual(keys["khalid"], "email:k@firm.com")


class Attendance(unittest.TestCase):
    def test_a_guest_is_a_name_and_never_an_email(self):
        [row] = pull.attendance_rows(UUID, [participant(name="  Abu  Fahad ")], {}, PULLED)
        self.assertEqual(row["person_key"], "name:abu fahad")
        self.assertIsNone(row["email"])
        self.assertIsNone(row["contact_id"])

    def test_identity_order(self):
        self.assertEqual(pull.person_key({"registrant_id": "r1", "user_email": "a@b.com"}), "reg:r1")
        self.assertEqual(pull.person_key({"user_email": " A@B.com ", "id": "z"}), "email:a@b.com")
        self.assertEqual(pull.person_key({"id": "z9"}), "zoom:z9")

    def test_our_domain_and_zoom_account_are_internal(self):
        rows = pull.attendance_rows(UUID, [
            participant(user_email="nada@maharamedia.com"),
            participant(internal_user=True, user_id="2"),
            participant(user_id="3"),
        ], {}, PULLED)
        self.assertEqual([r["internal"] for r in rows], [True, True, False])

    def test_waiting_room_row_is_kept_with_its_status(self):
        [row] = pull.attendance_rows(UUID, [participant(status="in_waiting_room", duration=4)], {}, PULLED)
        self.assertEqual(row["status"], "in_waiting_room")
        self.assertEqual(row["seconds"], 4)

    def test_registrant_brings_email_and_contact(self):
        [row] = pull.attendance_rows(UUID, [participant(registrant_id="R1")],
                                     {"R1": {"email": "x@y.com", "contact_id": "abcDEF1234567890abcd"}}, PULLED)
        self.assertEqual(row["email"], "x@y.com")
        self.assertEqual(row["contact_id"], "abcDEF1234567890abcd")
        self.assertEqual(row["person_key"], "reg:R1")

    def test_row_key_is_stable_and_rejoins_are_separate(self):
        a = pull.attendance_rows(UUID, [participant()], {}, PULLED)[0]["row_key"]
        b = pull.attendance_rows(UUID, [participant()], {}, PULLED)[0]["row_key"]
        c = pull.attendance_rows(UUID, [participant(join_time="2026-09-30T17:50:00Z")], {}, PULLED)[0]["row_key"]
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)

    def test_every_row_has_the_same_keys(self):
        # PostgREST refuses a bulk upsert whose objects differ in keys.
        rows = pull.attendance_rows(UUID, [participant(), participant(user_email="a@b.com", leave_time=None)], {}, PULLED)
        self.assertEqual(set(rows[0]), set(rows[1]))


class Answers(unittest.TestCase):
    def test_poll_answers(self):
        data = {"questions": [{"name": "Khalid", "email": "K@firm.com", "question_details": [
            {"question": "كم مشروع؟", "answer": "3", "date_time": "2026-09-30 17:45:10", "polling_id": "p1"}]}]}
        start = dt.datetime(2026, 9, 30, 17, 0, tzinfo=dt.timezone.utc)
        [row] = pull.answer_rows(UUID, data, "poll", start, PULLED)
        self.assertEqual(row["offset_s"], 2710)
        self.assertEqual(row["person_key"], "email:k@firm.com")
        self.assertEqual(row["payload"]["polling_id"], "p1")


class Survey(unittest.TestCase):
    def test_profit_bands(self):
        self.assertEqual(pull.profit_min("أقل من $100,000"), 0)
        self.assertEqual(pull.profit_min("$100K - $250k"), 100_000)
        self.assertEqual(pull.profit_min("$250k - $500k"), 250_000)
        self.assertEqual(pull.profit_min("$500k - $1M"), 500_000)
        self.assertEqual(pull.profit_min("$1M - $2.5M"), 1_000_000)
        self.assertEqual(pull.profit_min("$2.5M+"), 2_500_000)
        self.assertIsNone(pull.profit_min(None))

    def test_phone_digits(self):
        self.assertEqual(pull.digits("+965 9999 1234"), "96599991234")
        self.assertEqual(pull.digits("00965 9999 1234"), "96599991234")
        self.assertIsNone(pull.digits(""))

    def test_a_response(self):
        item = {
            "response_id": "abc", "token": "abc", "landed_at": "2026-09-30T19:00:00Z",
            "submitted_at": "2026-09-30T19:03:00Z",
            "hidden": {"user_id": "a1B2c3D4e5F6g7H8i9J0", "email": "", "utm_source": "whatsapp"},
            "answers": [
                {"field": {"ref": pull.REFS["profit"]}, "type": "choice", "choice": {"label": "$250k - $500k"}},
                {"field": {"ref": pull.REFS["work"]}, "type": "choice", "choice": {"other": "مقاولات بحرية"}},
                {"field": {"ref": pull.REFS["first"]}, "type": "text", "text": "خالد"},
                {"field": {"ref": pull.REFS["last"]}, "type": "text", "text": "العلي"},
                {"field": {"ref": pull.REFS["email"]}, "type": "email", "email": "Khalid@Firm.com"},
                {"field": {"ref": pull.REFS["phone"]}, "type": "phone_number", "phone_number": "+96599991234"},
            ],
        }
        row = pull.survey_row(item, PULLED)
        self.assertEqual(row["profit_min"], 250_000)
        self.assertEqual(row["work_type"], "مقاولات بحرية")
        self.assertEqual(row["email"], "khalid@firm.com")
        self.assertEqual(row["phone"], "96599991234")
        self.assertEqual(row["contact_id"], "a1B2c3D4e5F6g7H8i9J0")
        self.assertEqual(row["name"], "خالد العلي")
        self.assertEqual(row["hidden"], {"user_id": "a1B2c3D4e5F6g7H8i9J0", "utm_source": "whatsapp"})

    def test_a_template_placeholder_is_not_a_contact_id(self):
        item = {"response_id": "x", "submitted_at": "2026-09-30T19:03:00Z",
                "hidden": {"user_id": "{{contact.id}}"}, "answers": []}
        self.assertIsNone(pull.survey_row(item, PULLED)["contact_id"])

    def test_unsubmitted_is_skipped(self):
        self.assertIsNone(pull.survey_row({"response_id": "x", "answers": []}, PULLED))


class Reminders(unittest.TestCase):
    def test_each_template_is_known_after_the_greeting(self):
        self.assertEqual(pull.step_of("هلا محمد.. بعد ساعة نبدأ وأنا قاعد أجهّز. هذا رابط التدريب"), "webby_05_one_hour")
        self.assertEqual(pull.step_of("هلا سارة..  بنبدي بعد ٥ دقايق. دش الحين"), "webby_07_five_min")
        self.assertEqual(pull.step_of("السلام عليكم خالد معاك عزيز من ماهرة ميديا.. وصلني تسجيلك بالتدريب."),
                         "webby_01_registered_question")
        self.assertIsNone(pull.step_of("مرحبا، موعد مكالمتك غداً"))
        self.assertIsNone(pull.step_of(None))

    def test_message_rows(self):
        since = dt.datetime(2026, 9, 25, tzinfo=dt.timezone.utc)
        msgs = [
            {"id": "m1", "direction": "outbound", "messageType": "TYPE_WHATSAPP", "status": "read",
             "source": "workflow", "dateAdded": "2026-09-30T16:00:00Z", "body": "هلا علي.. بعد ساعة نبدأ"},
            {"id": "m2", "direction": "inbound", "messageType": "TYPE_WHATSAPP", "status": "delivered",
             "dateAdded": "2026-09-30T16:05:00Z", "body": "تمام"},
            {"id": "m3", "direction": "outbound", "messageType": "TYPE_CALL", "dateAdded": "2026-09-30T16:06:00Z"},
            {"id": "m4", "direction": "outbound", "messageType": "TYPE_SMS", "status": "failed",
             "dateAdded": "2026-09-01T10:00:00Z", "body": "old"},
            {"id": "m5", "direction": "outbound", "messageType": "TYPE_EMAIL", "status": None,
             "dateAdded": "2026-09-29T10:00:00Z", "body": "<p>hi</p>"},
        ]
        rows = pull.message_rows("c1", msgs, since, PULLED)
        self.assertEqual([(r["message_id"], r["channel"], r["status"], r["step"]) for r in rows],
                         [("m1", "whatsapp", "read", "webby_05_one_hour"), ("m5", "email", None, None)])
        self.assertNotIn("body", rows[0])

    def test_registration_start_follows_the_webinar_rule(self):
        old = {"dateAdded": "2026-06-01T00:00:00Z",
               "customFields": [{"id": pull.SESSION_FIELD, "value": "1790791200000"}]}
        start = pull.registered_from(old)
        self.assertEqual(start, pull.session_of(old) - dt.timedelta(days=21))
        new = {"dateAdded": "2026-09-28T00:00:00Z",
               "customFields": [{"id": pull.SESSION_FIELD, "value": "2026-09-30"}]}
        self.assertEqual(pull.registered_from(new), dt.datetime(2026, 9, 28, tzinfo=dt.timezone.utc))
        self.assertEqual(pull.registered_from({"dateAdded": "2026-09-28T00:00:00Z"}),
                         dt.datetime(2026, 9, 28, tzinfo=dt.timezone.utc))


class Objections(unittest.TestCase):
    def test_answer_is_checked(self):
        meeting = {"recording_id": 123, "title": "Intro call", "recording_start_time": "2026-10-01T10:00:00Z",
                   "recording_end_time": "2026-10-01T10:31:30Z"}
        answer = {"objections": [
            {"category": "Price", "quote": "الميزانية ما تسمح الحين", "handled": "partly"},
            {"category": "weather", "quote": "x" * 400, "handled": "maybe"},
            "not an object",
        ], "summary": "They asked for a proposal."}
        row = pull.objection_row(meeting, {"id": "c9"}, "k@firm.com", answer, PULLED)
        self.assertEqual(row["call_id"], "123")
        self.assertEqual(row["duration_s"], 1890)
        self.assertEqual(row["categories"], ["other", "price"])
        self.assertEqual(row["objections"][0], {"category": "price", "quote": "الميزانية ما تسمح الحين", "handled": "partly"})
        self.assertEqual(len(row["objections"][1]["quote"]), 240)
        self.assertIsNone(row["objections"][1]["handled"])
        self.assertEqual(row["model"], pull.OBJECTIONS_MODEL)

    def test_no_objection_is_an_empty_list(self):
        row = pull.objection_row({"recording_id": 1}, {"id": "c"}, "e@x.com", {"objections": []}, PULLED)
        self.assertEqual((row["categories"], row["objections"]), ([], []))

    def test_transcript_lines(self):
        text = pull.transcript_text([
            {"speaker": {"display_name": "Nada"}, "text": " أهلا ", "timestamp": "00:00:05"},
            {"speaker": {"display_name": "Khalid"}, "text": "", "timestamp": "00:00:07"},
            {"speaker": None, "text": "ok", "timestamp": "00:00:09"},
        ])
        self.assertEqual(text, "[00:00:05] Nada: أهلا\n[00:00:09] Speaker: ok")

    def test_every_category_has_words_for_the_screen(self):
        self.assertIn("other", pull.CATEGORIES)
        self.assertTrue(all(pull.CATEGORIES.values()))


class Zoom(unittest.TestCase):
    def test_uuid_path(self):
        self.assertEqual(pull.uuid_path("ZX4as2A+Qq+ejA6SnGIcnA=="), "ZX4as2A%2BQq%2BejA6SnGIcnA%3D%3D")
        self.assertEqual(pull.uuid_path("/ajXp112QmuoKj4854875=="), "%252FajXp112QmuoKj4854875%253D%253D")
        self.assertEqual(pull.uuid_path("ab//cd=="), "ab%252F%252Fcd%253D%253D")

    def test_poll_time_without_zone_is_utc(self):
        self.assertEqual(pull.parse_ts("2026-09-30 17:45:10"),
                         dt.datetime(2026, 9, 30, 17, 45, 10, tzinfo=dt.timezone.utc))

    def test_sse(self):
        body = b'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"content":[]}}\n\n'
        self.assertEqual(pull.Composio.sse(body)["id"], 2)


if __name__ == "__main__":
    unittest.main()
