#!/usr/bin/env python3
"""scripts/dev/make_parity.py offline (docs/forms/WAVE56-CONTRACT.md 4.15.1): urllib is mocked, so no request leaves
this machine; every key, client, phone and answer is invented. Python 3.9, as on this Mac.

fixtures/make-parity holds the two saved blueprints and Typeform definitions trimmed to what the evaluator reads: the
dispatch's headers (they hold a token) dropped, the repository owner and the fixed assignee replaced. With
MAKE_PARITY_SAVED_DIR pointing at the saved files (D-S4.0's backups), a test proves the fixtures are those files."""
from __future__ import annotations

import copy
import io
import json
import os
import re
import shutil
import sys
import tempfile
import unittest
import urllib.error
import urllib.parse
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import make_parity as mp  # noqa: E402

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "make-parity"
SERVICE_KEY = "eyJ" + "hbGciOiJIUzI1NiJ9." + "eyJyb2xlIjoic2VydmljZSJ9." + "invented_signature_part"
CLICKUP_KEY = "pk_" + "1234567_" + "INVENTEDCLICKUPKEY00000000"
DB = "https://db.test"
CARD = "86exc1tyw"
RESPONSE = "0b9c5b8e-3f4a-4c55-9a51-1d2f0e7c6a10"
PHONE = "+965 1234 5678"
EMAIL = "owner@cedar.example"
ANSWER = "Invented handoff detail nobody should see"
SECRETS = (SERVICE_KEY, CLICKUP_KEY, PHONE, EMAIL, ANSWER, CARD, "Cedar Homes", "tokOnb00001", "tokKick00001")
STATUS = "9368ca9e-3549-4320-84ff-9abd0a2901cb"
CONTRACT = "ac976d4a-409b-441c-8c13-4b0e73a0c12f"
SERVICE = "bab9a58b-15af-4b0d-8e20-b8e5a4bee2cc"
BLUEPRINT = "1b7a4a74-d0e7-4a7f-9218-59c80a738186"
MAP = "51f49cb1-9f76-48be-b639-c42ca552d20a"
PHASES = {  # decision 2's templates, verbatim
    "phase3": "أكملنا المرحلة الثانية: نموذج التعريف بالنشاط.\nالمرحلة التالية: مكالمة التعريف.\n\nاطّلع على المطلوب منك وما سنعمل عليه بعد ذلك:\n{map_link}\n\n*إذا ما رفعتوا المحتوى للحين:*\nارفعوا كل الصور والفيديوهات في مجلد المحتوى الموحد عشان توصل مباشرة لفريق الإبداع والمونتاج:\n{content_folder}",
    "phase4": "أكملنا المرحلة الثالثة: مكالمة التعريف.\nالمرحلة التالية: بناء الهوية والعرض.\n\nاطّلع على المطلوب منك وما سنعمل عليه بعد ذلك:\n{map_link}\n\n*إذا ما رفعتوا المحتوى للحين:*\nارفعوا كل الصور والفيديوهات في مجلد المحتوى الموحد عشان توصل مباشرة لفريق الإبداع والمونتاج:\n{content_folder}",
}
RELAY = {"DISPATCH_OWNER": "invented-owner", "DISPATCH_REPO": "invented-repo", "DISPATCH_EVENT": "market_intel",
         "DISPATCH_NAME_KEY": "client_name", "DISPATCH_ID_KEY": "clickup_id"}
ONBOARDING = [  # the card's stored KFRCXPFx answers, as the read model holds them
    {"ref": "533f14a0-712f-4de9-9ac7-67e1be6bc0c8", "title": "Full Name | الاسم الكامل", "value": "Invented Owner"},
    {"ref": "64f2fb80-b074-4017-b8b7-b7d549947e52", "title": "Phone | رقم التليفون", "value": PHONE},
    {"ref": "7994f0d2-baeb-451b-983a-816290873a68", "title": "Email | الايميل", "value": EMAIL},
    {"ref": "514bfd3f-4ca1-469e-b9e7-87656503f65c", "title": "Business Name | اسم الشركه (بالانقليزي)", "value": "Cedar Homes"},
    {"ref": "e5caee43-e9b5-427d-8583-6982c5dd9be8", "title": "Please enter your business address. | الرجاء كتابة عنوان الشركة", "value": "Block 1 & 2, Invented St"},
    {"ref": "b370341c-6ea3-43c9-bd8c-16e278a2d2d5", "title": "Appointment types", "value": "عن بُعد (أونلاين) | Online, في مقرّكم / مكتبكم | In your office"},
    {"ref": "ec89854f-d006-402b-958a-91738e2b3e7a", "title": "Free consultations", "value": "Yes, we do offer free consultations / نعم، نقدم استشارات مجانية✅"},
    {"ref": "7ff5d37a-df7f-4002-8248-d0b4af6c28e8", "title": "Revenue", "value": "250000"},
    {"ref": "791b99b8-c7e9-40a4-96d6-868399e1ae97", "title": "Goal", "value": "60000"},
    {"ref": "41d2d5bb-b023-4fa4-906c-72aeef7a5e46", "title": "Anything else", "value": ANSWER},
]
KICKOFF = [  # a stored tG7dnxBn kickoff, as the read model holds it (yes/no as Yes/No, lists joined)
    {"ref": "c0000001-0000-4000-8000-000000000001", "title": "Is all of the above still correct?", "value": "Yes"},
    {"ref": "c0000001-0000-4000-8000-000000000003", "title": "Is all of the above still correct?", "value": "No"},
    {"ref": "c0000001-0000-4000-8000-000000000007", "title": "Which service are we advertising?", "value": "Interior design, Other"},
    {"ref": "c0000001-0000-4000-8000-00000000000a", "title": "Contract status", "value": "Signed"},
    {"ref": "ad562fc2-6858-4e37-81c5-c4cc2375a330", "title": "Mahara OS Access Status", "value": "Logged In"},
    {"ref": "7d16afbb-b99a-4ee9-8718-4418cbeba534", "title": "Which platforms will we advertise on?", "value": "Tiktok, Snapchat"},
    {"ref": "75e97e7d-4c19-437a-b4b8-67570c29344f", "title": "Payment Amount", "value": "1500"},
    {"ref": "071c480f-17f9-48db-8155-56030f952e85", "title": "Who else should we add to the WhatsApp group?", "value": ANSWER},
]
OPTIONS = [
    {"field_id": CONTRACT, "options": [{"id": "ac8a68fa-ba2e-41da-9fcc-2e9b7d03d2e2", "name": "Signed", "orderindex": 0},
                                       {"id": "0667c501-3955-4443-829a-a4eb9a1d7176", "name": "Not sent yet", "orderindex": 3}]},
    {"field_id": STATUS, "options": [{"id": "dbd21650-59ce-429c-882d-5afd7d8aaa8a", "name": "Brand Blueprint Booked♠️", "orderindex": 4}]},
    {"field_id": SERVICE, "options": [{"id": "e9883783-96ef-49e9-83c3-efba1aebc738", "name": "Interior design", "orderindex": 1}]},
    {"field_id": "924bba47-32d4-4557-94d4-f475cd548dd2", "options": [{"id": "6239c1b7-afe7-4a5a-9fb8-e27be7618519", "name": "Logged In", "orderindex": 0}]},
]


def trim_module(m: dict) -> dict:
    kind = str(m.get("module") or "")
    mapper = {k: v for k, v in (m.get("mapper") or {}).items() if k not in mp.UNREAD.get(kind, ())}
    text = json.dumps(mapper, ensure_ascii=False)
    text = re.sub(r"api\.github\.com/repos/[^/\"]+/[^/\"]+/", "api.github.com/repos/invented-owner/invented-repo/", text)
    mapper = json.loads(text)
    if isinstance(mapper.get("assignees"), list):
        mapper["assignees"] = [100000001 for _ in mapper["assignees"]]
    out = {"id": m.get("id"), "module": kind, "mapper": mapper, "filter": m.get("filter"),
           "parameters": {k: v for k, v in (m.get("parameters") or {}).items() if k in ("feeder", "rowSeparator", "customRowSeparator")}}
    if m.get("routes"):
        out["routes"] = [{"flow": [trim_module(x) for x in (r or {}).get("flow") or []]} for r in m["routes"]]
    return out


def trim_blueprint(saved: dict) -> dict:
    return {"flow": [trim_module(m) for m in mp.blueprint_of(saved).get("flow") or []]}


def trim_fields(fields: list) -> list:
    out = []
    for f in fields or []:
        props = f.get("properties") or {}
        keep = {"allow_multiple_selection": bool(props.get("allow_multiple_selection"))}
        if props.get("fields"):
            keep["fields"] = trim_fields(props["fields"])
        out.append({"id": f.get("id"), "ref": f.get("ref"), "type": f.get("type"), "title": f.get("title"), "properties": keep})
    return out


def trim_definition(saved: dict) -> dict:
    return {"id": saved.get("id"), "fields": trim_fields(saved.get("fields")), "hidden": saved.get("hidden")}


def fixture(name: str) -> dict:
    return json.loads((FIXTURES / mp.SAVED.format(name)).read_text())


def strings(v):
    if isinstance(v, str):
        yield v
    elif isinstance(v, dict):
        for x in v.values():
            yield from strings(x)
    elif isinstance(v, list):
        for x in v:
            yield from strings(x)


def unknown_in(blueprint: dict) -> set:
    """Every function, name or module type of a blueprint the evaluator does not know (module ids and names only)."""
    out = set()
    for m in mp.flat_modules(mp.blueprint_of(blueprint).get("flow")):
        kind = str(m.get("module") or "")
        if kind not in mp.KNOWN_MODULES:
            out.add(f"[{m.get('id')}] {kind}")
        mapper = {k: v for k, v in (m.get("mapper") or {}).items() if k not in mp.UNREAD.get(kind, ())}
        for s in list(strings(mapper)) + list(strings((m.get("filter") or {}).get("conditions"))):
            for part, src in mp.pieces(s):
                if part == "expr":
                    tree = mp.parse(src)
                    out |= {f"{n}()" for n in mp.walk(tree, "call") if n not in mp.FUNCTIONS}
                    out |= {n for n in mp.walk(tree, "name") if n not in mp.NAMES}
        for c in (s for g in (m.get("filter") or {}).get("conditions") or [] for s in g or []):
            if str(c.get("o")) not in mp.OPERATORS:
                out.add(f"operator {c.get('o')}")
    return out


def make12_mods(kickoff=KICKOFF, onboarding=ONBOARDING):
    hidden = mp.kickoff_hidden(mp.blueprint_of(fixture("8922994")), fixture("KFRCXPFx"), CARD, mp.clean(onboarding))
    return mp.make_modules(mp.blueprint_of(fixture("8925654")), mp.trigger_bundle(fixture("tG7dnxBn"), mp.clean(kickoff), hidden))


def make13_mods(onboarding=ONBOARDING):
    return mp.make_modules(mp.blueprint_of(fixture("8922994")),
                           mp.trigger_bundle(fixture("KFRCXPFx"), mp.clean(onboarding), {"onboarding_client_id": CARD}))


class Evaluator(unittest.TestCase):
    def setUp(self):
        self.ctx = {"outputs": {
            1: {"hidden": {"legal_name": "Cedar Homes", "blank": ""},
                "mappable_answers": {"yes": True, "no": False, "list": ["A", "B"], "one": "Signed", "num": 1500}},
            5: mp.Synthetic({"7": "{content_folder}"})}, "random": 0.5}

    def r(self, text):
        return mp.render(text, self.ctx)

    def test_each_function_and_name_as_make_evaluates_it(self):
        self.assertEqual(self.r('{{ifempty(1.hidden.blank; "Not provided")}}'), "Not provided")
        self.assertEqual(self.r('{{ifempty(1.hidden.legal_name; "Not provided")}}'), "Cedar Homes")
        self.assertEqual(self.r('{{ifempty(1.hidden.nothing; "Not provided")}}'), "Not provided")
        yes_no = '{{switch(get(1.mappable_answers; "%s"); true; "Yes"; false; "No"; "Not provided")}}'
        self.assertEqual(self.r(yes_no % "yes"), "Yes")
        self.assertEqual(self.r(yes_no % "no"), "No")
        self.assertEqual(self.r(yes_no % "one"), "Not provided")  # a text never equals true
        self.assertEqual(self.r(yes_no % "nothing"), "Not provided")
        self.assertIsNone(self.r('{{switch(1.mappable_answers.`one`; "Sent"; "id-1")}}'))
        self.assertEqual(self.r('{{switch(1.mappable_answers.`one`; "Sent"; "id-1"; "Signed"; "id-2")}}'), "id-2")
        listed = '{{join(flatten(add(emptyarray; get(1.mappable_answers; "%s"))); ", ")}}'
        self.assertEqual(self.r(listed % "list"), "A, B")
        self.assertEqual(self.r(listed % "one"), "Signed")
        self.assertEqual(self.r(listed % "nothing"), "")
        self.assertEqual(self.r('{{ifempty(join(flatten(add(emptyarray; get(1.mappable_answers; "nothing"))); ", "); "Not provided")}}'),
                         "Not provided")
        self.assertEqual(self.r("{{first(1.mappable_answers.`list`)}}"), "A")
        self.assertEqual(self.r('{{encodeURL("Block 1 & 2/3 é")}}'), "Block%201%20%26%202%2F3%20%C3%A9")
        # Proven by the fidelity check on real cards: encodeURL() joins a list with "," and no space.
        self.assertEqual(self.r("{{encodeURL(1.mappable_answers.`list`)}}"), "A%2CB")
        self.assertEqual(self.r("{{encodeURL(1.mappable_answers.`nothing`)}}"), "")
        self.assertEqual(self.r('{{ifempty(1.mappable_answers.`no`; "Not provided")}}'), False)
        self.assertEqual(self.r("{{floor(random * 91) + 30}}"), 75)
        self.assertEqual(self.r("{{1.mappable_answers.`num`}}"), 1500)  # one expression keeps its type
        self.assertEqual(self.r("paid {{1.mappable_answers.`num`}} and {{1.mappable_answers.`yes`}}"), "paid 1500 and true")
        self.assertEqual(self.r("{{5.`7`}}"), "{content_folder}")
        self.assertEqual(mp.pieces('a {{ifempty(1.x; "}}")}} b'), [("text", "a "), ("expr", 'ifempty(1.x; "}}")'), ("text", " b")])
        self.assertEqual(mp.walk(mp.parse('ifempty(join(flatten(add(emptyarray; 1.a)); ", "); "x")'), "call"),
                         {"ifempty", "join", "flatten", "add"})

    def test_anything_unknown_stops_instead_of_guessing(self):
        for text in ('{{replace(1.hidden.legal_name; "a"; "b")}}', "{{5.`6`}}", "{{9.id}}", "{{now}}", "{{1.hidden.legal_name +}}",
                     "{{unclosed", '{{"a" * 2}}'):
            with self.assertRaises(mp.Unsupported, msg=text):
                self.r(text)
        with self.assertRaises(mp.Unsupported):
            mp.passes({"conditions": [[{"a": "x", "b": "y", "o": "number:greater"}]]}, self.ctx)
        with self.assertRaises(mp.Unsupported):
            mp.make_modules({"flow": [{"id": 1, "module": "typeform:WatchEventsWithResponses"},
                                      {"id": 2, "module": "google-sheets:addRow", "mapper": {}}]}, {})

    def test_filters(self):
        group = lambda o, a, b="": {"conditions": [[{"a": a, "b": b, "o": o}]]}  # noqa: E731
        self.assertTrue(mp.passes(None, self.ctx))
        self.assertTrue(mp.passes({"name": "TECH", "conditions": []}, self.ctx))
        self.assertTrue(mp.passes(group("text:notequal", "{{5.`7`}}"), self.ctx))
        self.assertFalse(mp.passes(group("text:notequal", "{{1.hidden.blank}}"), self.ctx))
        self.assertTrue(mp.passes(group("text:equal:ci", "{{1.hidden.legal_name}}", "cedar homes"), self.ctx))
        self.assertFalse(mp.passes({"conditions": [[{"a": "x", "b": "x", "o": "text:equal"}, {"a": "x", "b": "y", "o": "text:equal"}]]}, self.ctx))

    def test_every_expression_and_module_of_both_blueprints_is_known(self):
        sources = {name: fixture(name) for name in ("8925654", "8922994")}
        saved = os.environ.get("MAKE_PARITY_SAVED_DIR")
        if saved:
            sources.update({f"saved {n}": json.loads((Path(saved) / mp.SAVED.format(n)).read_text()) for n in ("8925654", "8922994")})
        for name, bp in sources.items():
            self.assertEqual(unknown_in(bp), set(), name)
            self.assertGreater(len(mp.flat_modules(mp.blueprint_of(bp).get("flow"))), 10, name)
        doctored = copy.deepcopy(sources["8925654"])
        doctored["flow"][1]["mapper"]["comment_text"] += '{{replace(1.hidden.legal_name; "a"; "b")}}{{now}}'
        self.assertEqual(unknown_in(doctored), {"replace()", "now"})

    @unittest.skipUnless(os.environ.get("MAKE_PARITY_SAVED_DIR"), "MAKE_PARITY_SAVED_DIR is not set")
    def test_the_fixtures_are_the_saved_files_trimmed(self):
        saved = Path(os.environ["MAKE_PARITY_SAVED_DIR"])
        for name in ("8925654", "8922994"):
            self.assertEqual(trim_blueprint(json.loads((saved / mp.SAVED.format(name)).read_text())), fixture(name), name)
        for name in ("tG7dnxBn", "KFRCXPFx"):
            self.assertEqual(trim_definition(json.loads((saved / mp.SAVED.format(name)).read_text())), fixture(name), name)
        for path in FIXTURES.iterdir():
            self.assertNotRegex(path.read_text(), r"gh[pousr]_|github_pat_|[Bb]earer |[Tt]oken [A-Za-z0-9]")

    def test_stored_answers_become_what_typeform_hands_make(self):
        self.assertIs(mp.typed("Yes", "yes_no", False), True)
        self.assertIs(mp.typed("No", "yes_no", False), False)
        self.assertEqual(mp.typed("Maybe", "yes_no", False), "Maybe")
        self.assertEqual(mp.typed("1500", "number", False), 1500)
        self.assertEqual(mp.typed("12.5", "number", False), 12.5)
        self.assertIsNone(mp.typed("0", "number", False))  # Typeform hands Make a 0 as empty (seen on real cards)
        self.assertEqual(mp.typed("about 10", "number", False), "about 10")
        self.assertEqual(mp.typed("A, B", "multiple_choice", True), ["A", "B"])
        self.assertEqual(mp.typed("Yes, we do", "dropdown", False), "Yes, we do")  # one choice keeps its comma
        refs = [f["ref"] for f in mp.question_fields(fixture("KFRCXPFx"))]
        self.assertIn("e5caee43-e9b5-427d-8583-6982c5dd9be8", refs)  # inside the address group
        self.assertNotIn("4f14f57a-f7ce-42cf-abb6-b9577e1c0c33", refs)  # the group itself
        self.assertNotIn("aa18b411-1e74-4bc2-b584-7ad343442647", [f["ref"] for f in mp.question_fields(fixture("tG7dnxBn"))])
        self.assertEqual(mp.hidden_of("https://x.test/to/f#a=1&b=Block%201%20%26%202&c="), {"a": "1", "b": "Block 1 & 2", "c": ""})

    def test_make12_on_a_stored_kickoff(self):
        mods = make12_mods()
        text = mods[11]["input"]["comment_text"].splitlines()
        self.assertEqual(text[:3], ["*KICKOFF HANDOFF*", "*Client:* Cedar Homes", "*Call recording:* Not provided"])
        for line in ("*Phone:* " + PHONE, "*Email:* " + EMAIL, "*Address:* Block 1 & 2, Invented St",
                     "*Business details confirmed:* Yes", "*Online links confirmed:* No", "*Operations confirmed:* Not provided",
                     "*Business corrections:* Not provided", "*Services we are advertising:* Interior design, Other",
                     "*Advertising platforms:* Tiktok, Snapchat", "*Payment amount:* 1500", "*Previous revenue:* 250000",
                     "*Original consultation types:* عن بُعد (أونلاين) | Online,في مقرّكم / مكتبكم | In your office",
                     "*Contract status:* Signed", "*Client content Drive:* Not provided"):
            self.assertIn(line, text)
        self.assertEqual(mods[18]["input"]["comment_text"], mods[11]["input"]["comment_text"])
        self.assertEqual(mods[18]["input"]["task_id"], "{task:17}")
        cf = mods[21]["input"]["custom_fields"]
        self.assertEqual(cf[CONTRACT], "ac8a68fa-ba2e-41da-9fcc-2e9b7d03d2e2")
        self.assertEqual(cf[SERVICE], "e9883783-96ef-49e9-83c3-efba1aebc738")  # first() of the list
        self.assertEqual(cf[STATUS], "dbd21650-59ce-429c-882d-5afd7d8aaa8a")
        self.assertEqual(cf["924bba47-32d4-4557-94d4-f475cd548dd2"], "6239c1b7-afe7-4a5a-9fb8-e27be7618519")
        self.assertIsNone(cf["a1520ef3-ec23-47a4-9584-e24257486a3e"])
        self.assertEqual((mods[17]["input"]["list_id"], mods[17]["input"]["template_id"]), ("901816723190", "t-86ex8x9xw"))
        self.assertEqual((mods[22]["input"]["list_id"], mods[22]["input"]["template_id"]), ("901818016338", "t-86eyu1w3d"))
        self.assertEqual(mods[26]["input"]["custom_fields"][MAP], f"https://mahara-onboarding-map.vercel.app/?phase=4&cid={CARD}")
        self.assertEqual(mods[25]["input"]["body"], PHASES["phase4"])
        self.assertEqual(mods[25]["input"]["to"], "{wa_group}")
        self.assertEqual(mods[24]["input"]["filter"][0][0]["b"], CARD)
        self.assertEqual(mods[28]["input"]["duration"], 75)
        zero = [dict(a, value="0") if a["ref"].startswith("75e97e7d") else a for a in KICKOFF]
        onb_zero = [dict(a, value="0") if a["ref"].startswith("7ff5d37a") else a for a in ONBOARDING]
        text = make12_mods(zero, onb_zero)[11]["input"]["comment_text"].splitlines()
        self.assertIn("*Payment amount:* Not provided", text)
        self.assertIn("*Previous revenue:* Not provided", text)

    def test_make13_on_a_stored_onboarding_answer(self):
        mods = make13_mods()
        link = mods[29]["input"]["custom_fields"][mp.FIELD["kickoff_link"]]
        hidden = mp.hidden_of(link)
        self.assertEqual(hidden["onboarding_client_id"], CARD)
        self.assertEqual(hidden["address"], "Block 1 & 2, Invented St")
        self.assertEqual(hidden["maps_link"], "")
        self.assertEqual(len(hidden), 23)
        profile = mods[29]["input"]["custom_fields"][mp.FIELD["profile"]]
        self.assertTrue(profile.startswith("Last Year's Total Revenue: 250000\n\n90-Day Goal Revenue: 60000\n\n12-24 Month Revenue Goal: \n\n"))
        raw = mods[47]["input"]["comment_text"]
        self.assertTrue(raw.startswith("**Raw Onboarding Form Answers**\n\n**Full Name | الاسم الكامل**\nInvented Owner\n\n**Phone"))
        # As the fidelity check found on real cards: the answered questions only, under the saved form's titles.
        titles = {f["ref"]: f["title"] for f in mp.question_fields(fixture("KFRCXPFx"))}
        self.assertIn(f"\n**{titles['b370341c-6ea3-43c9-bd8c-16e278a2d2d5']}**\nعن بُعد (أونلاين) | Online, في مقرّكم / مكتبكم | In your office\n", raw)
        self.assertIn(f"\n**{titles['ec89854f-d006-402b-958a-91738e2b3e7a']}**\nYes, we do offer free consultations / نعم، نقدم استشارات مجانية✅\n", raw)
        self.assertNotIn("**Appointment types**", raw)
        zero = [dict(a, value="0") if a["ref"].startswith("7ff5d37a") else a for a in ONBOARDING]
        self.assertIn(f"**{titles['7ff5d37a-df7f-4002-8248-d0b4af6c28e8']}**\n\n", make13_mods(zero)[47]["input"]["comment_text"])
        self.assertEqual(raw.count("\n**"), len(ONBOARDING))
        self.assertLess(raw.index(titles["7ff5d37a-df7f-4002-8248-d0b4af6c28e8"]), raw.index(titles["41d2d5bb-b023-4fa4-906c-72aeef7a5e46"]))
        gone = mp.trigger_bundle(fixture("KFRCXPFx"), [{"ref": "retired-ref", "title": "Old question", "value": "x"}] + mp.clean(ONBOARDING[:1]), {})
        self.assertEqual([f["title"] for f in gone["definition"]["fields"]], [titles["533f14a0-712f-4de9-9ac7-67e1be6bc0c8"], "Old question"])
        self.assertEqual(json.loads(mods[25]["input"]["jsonStringBodyContent"]),
                         {"event_type": "market_intel", "client_payload": {"client_name": "Cedar Homes", "clickup_id": CARD}})
        self.assertEqual(mods[25]["input"]["url"], "https://api.github.com/repos/invented-owner/invented-repo/dispatches")
        self.assertNotIn("headers", mods[25]["input"])
        self.assertEqual(mods[48]["input"]["body"], PHASES["phase3"])
        self.assertEqual(mods[46]["input"]["name"], "Cedar Homes - Brand DNA 🧬🧬")
        self.assertEqual(mods[31]["module"], "google-sheets:filterRows")
        self.assertEqual(mp.line_of(fixture("8922994"), 31), "[31] search")
        self.assertEqual(mp.line_of(fixture("8925654"), 24), "[24] search")
        self.assertEqual(mp.line_of({}, 24), "[24] not found in the blueprint")

    def test_fidelity_reads_clickup_as_it_returns_comments(self):
        made = make12_mods()[11]["input"]["comment_text"]
        labels = mp.comment_labels("kickoff", mp.blueprint_of(fixture("8925654")), fixture("KFRCXPFx"))
        plain = "\n".join(line for line in made.replace("*", "").splitlines() if not set(line) <= {"_"}) + "\n"
        self.assertEqual(mp.fidelity(made, [{"comment_text": made + "  \n", "date": "1"}], "kickoff", labels, 0), "equal")
        self.assertEqual(mp.fidelity(made, [{"comment_text": "Other note"}, {"comment_text": plain, "date": "2"}], "kickoff", labels, 0), "equal")
        changed = plain.replace("*Phone:* " + PHONE, "Phone: +965 0000 0000").replace("Phone: " + PHONE, "Phone: +965 0000 0000")
        verdict = mp.fidelity(made, [{"comment_text": changed, "date": "2"}], "kickoff", labels, 0)
        self.assertRegex(verdict, r"^differs: line \d+ \(Phone\); \d+ lines evaluated, \d+ on the card$")
        self.assertNotIn("0000", verdict)
        self.assertEqual(mp.fidelity(made, [{"comment_text": "Something else"}], "kickoff", labels, 0),
                         "differs: no handoff comment on the card")
        raw = make13_mods()[47]["input"]["comment_text"]
        labels13 = mp.comment_labels("onboarding", {}, fixture("KFRCXPFx"))
        dropped = raw.replace("Invented Owner\n", "Somebody Else\n")
        self.assertEqual(mp.fidelity(raw, [{"comment_text": dropped, "date": "5"}], "onboarding", labels13, 0),
                         f"differs: line 3 (the answer under 533f14a0-712f-4de9-9ac7-67e1be6bc0c8); "
                         f"{len([x for x in raw.splitlines() if x.strip()])} lines evaluated, "
                         f"{len([x for x in dropped.splitlines() if x.strip()])} on the card")

    def test_runs_take_the_newest_stored_answers(self):
        readmodel = [{"clickup_task_id": CARD, "client_name": "Cedar Homes",
                      "kickoff": {"form_id": "tG7dnxBn", "response_id": "tokKick00001", "submitted_at": "2026-10-20T11:55:11Z", "answers": KICKOFF},
                      "onboarding": {"form_id": "KFRCXPFx", "response_id": "tokOnb00001", "submitted_at": "2026-10-01T08:00:00Z", "answers": ONBOARDING}},
                     {"clickup_task_id": "86other01", "kickoff": {"form_id": "BbJy6xg4", "response_id": "old", "submitted_at": "2026-04-01T00:00:00Z", "answers": []}}]
        responses = [{"id": RESPONSE, "form_key": "kickoff", "external_id": "tokKick00001", "client_name": "Cedar Homes"},
                     {"id": "r-2", "form_key": "onboarding", "external_id": "tokOnb00002", "task_id": "86other01",
                      "submitted_at": "2026-10-18T19:11:56+00:00", "answers": {"fields": ONBOARDING[:2]}, "hidden": {}},
                     {"id": "r-3", "form_key": "onboarding", "external_id": "tokOnb00003", "task_id": None,
                      "submitted_at": "2026-10-19T19:11:56+00:00", "answers": {"fields": ONBOARDING[:2]}, "hidden": {}}]
        kick = mp.kickoff_runs(readmodel, responses, 7)
        self.assertEqual([(r["task"], r["responseId"]) for r in kick], [(CARD, RESPONSE)])
        onb = mp.onboarding_runs(readmodel, responses, 5)
        self.assertEqual([(r["task"], r["responseId"]) for r in onb], [("86other01", "r-2"), (CARD, None)])
        self.assertEqual(len(mp.card_onboarding(CARD, readmodel, responses)), len(ONBOARDING))
        self.assertEqual(len(mp.card_onboarding("86other01", readmodel, responses)), 2)
        self.assertEqual(mp.ms_of("2026-10-18T19:11:56+00:00"), mp.ms_of("2026-10-18 22:11:56.5+03") - 500)


class Answer:
    def __init__(self, status: int, text: str):
        self.status = status
        self._text = text.encode()

    def read(self):
        return self._text

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class Net:
    """Supabase, the parity plan and ClickUp's comments, faked. The plan answers what the cockpit would write when
    it matches Make; each test changes what it needs."""

    def __init__(self):
        self.requests = []
        self.receipt_fails = set()
        self.messages = dict(PHASES)
        self.targets = [{"key": "client_onboarding", "targets": [{"list_id": "901816723190", "template_id": "t-86ex8x9xw"},
                                                                 {"list_id": "901818016338", "template_id": "t-86eyu1w3d"}]}]
        self.card_name = "Cedar Homes"
        self.with_client_data_row = True
        self.unmapped = None
        self.k_mods, self.o_mods = make12_mods(), make13_mods()
        self.handoff = self.k_mods[11]["input"]["comment_text"]
        self.contract = "Signed"
        # ClickUp hands comment_text back without the markdown marks.
        self.comments = [{"id": "c2", "date": "1760961400000", "comment_text": "A person's note"},
                         {"id": "c1", "date": "1760961320000", "comment_text": self.k_mods[11]["input"]["comment_text"].replace("*", "")},
                         {"id": "c0", "date": "1759305700000", "comment_text": self.o_mods[47]["input"]["comment_text"].replace("**", "")}]

    def __call__(self, req, timeout=None):
        url = req.full_url
        method = req.get_method()
        headers = {k.lower(): v for k, v in req.header_items()}
        body = json.loads(req.data) if req.data else None
        self.requests.append({"method": method, "url": url, "headers": headers, "json": body})
        status, out = self.route(method, url, headers, body)
        text = out if isinstance(out, str) else json.dumps(out)
        if status >= 400:
            raise urllib.error.HTTPError(url, status, "refused", None, io.BytesIO(text.encode()))
        return Answer(status, text)

    def plan(self, form, inp):
        assert inp["taskId"] == CARD and inp["client"] == self.card_name
        if form == "kickoff":
            assert inp["hidden"]["legal_name"] == "Cedar Homes" and "maps_link" not in inp["hidden"]
            body = (self.messages.get("phase4") or "").replace("{map_link}", "https://mahara-onboarding-map.vercel.app/?phase=4&cid=" + CARD)
            return [{"key": "handoff_comment", "plan": {"comment_text": self.handoff}},
                    {"key": "native_status", "plan": {"status": "IN PROGRESS"}},
                    {"key": "card_fields", "plan": {"fields": [
                        {"fieldId": STATUS, "kind": "drop_down", "optionName": "Brand Blueprint Booked♠️"},
                        {"fieldId": CONTRACT, "kind": "drop_down", "optionName": self.contract},
                        {"fieldId": SERVICE, "kind": "drop_down", "optionName": "Interior design"},
                        {"fieldId": "924bba47-32d4-4557-94d4-f475cd548dd2", "kind": "drop_down", "optionName": "Logged In"},
                        {"fieldId": BLUEPRINT, "kind": "url", "value": "https://cockpit.maharamedia.com/x"}]}},
                    {"key": "onboarding_tasks", "plan": {"typeKey": "client_onboarding"}},
                    {"key": "map_phase4", "plan": {"value": "https://mahara-onboarding-map.vercel.app/?phase=4&cid=" + CARD}},
                    {"key": "phase4_whatsapp", "plan": {"body": body or None}, "missing": None if body else "not set up"},
                    {"key": "kickoff_notice", "plan": {}}, {"key": "new_mrr", "plan": {}}, {"key": "recap", "plan": {}}]
        assert inp["hidden"] == {} and inp["answers"][3]["value"] == "Cedar Homes"
        body = (self.messages.get("phase3") or "").replace("{map_link}", "https://mahara-onboarding-map.vercel.app/?phase=3&cid=" + CARD)
        out = [{"key": "profile_fields", "plan": {"fields": [{"fieldId": mp.FIELD["profile"],
                                                             "value": self.o_mods[29]["input"]["custom_fields"][mp.FIELD["profile"]]}]}},
               {"key": "raw_answers_comment", "plan": {"comment_text": self.o_mods[47]["input"]["comment_text"]}},
               {"key": "map_phase3", "plan": {"value": "https://mahara-onboarding-map.vercel.app/?phase=3&cid=" + CARD}},
               {"key": "github_dispatch", "plan": {"payload": {"taskId": CARD, "client": inp["client"]}}},
               {"key": "phase3_whatsapp", "plan": {"body": body or None}, "missing": None if body else "not set up"},
               {"key": "brand_dna_task", "plan": {"typeKey": "brand_dna"}},
               {"key": "read_model", "plan": {}}]
        if self.with_client_data_row:
            out.insert(3, {"key": "client_data_row", "plan": {"payload": {"taskId": CARD}}})
        return out

    def route(self, method, url, headers, body):
        if url.startswith(DB):
            assert headers["apikey"] == SERVICE_KEY
            assert method == "GET" or url.endswith(("/cockpit_csm_provider_health", "/rpc/cockpit_form_parity_plan"))
        path = url[len(DB):] if url.startswith(DB) else url
        if path == "/rest/v1/cockpit_csm_provider_health":
            return (400, "{}") if body["phase"] in self.receipt_fails else (201, "")
        if path.startswith("/rest/v1/cockpit_clickup_fields?"):
            return 200, OPTIONS
        if path.startswith("/rest/v1/cockpit_request_types?"):
            return 200, self.targets
        if path.startswith("/rest/v1/cockpit_settings?"):
            assert "key=eq.stage4.messages" in path
            return 200, [{"key": "stage4.messages", "value": self.messages}]
        if path.startswith("/rest/v1/cockpit_client_onboarding?"):
            return 200, [{"clickup_task_id": CARD, "client_name": "Cedar Homes (old)",
                          "kickoff": {"form_id": "tG7dnxBn", "response_id": "tokKick00001", "submitted_at": "2026-10-20T11:55:11Z", "answers": KICKOFF},
                          "onboarding": {"form_id": "KFRCXPFx", "response_id": "tokOnb00001", "submitted_at": "2026-10-01T08:00:00Z", "answers": ONBOARDING}}]
        if path.startswith("/rest/v1/cockpit_form_responses?"):
            return 200, [{"id": RESPONSE, "form_key": "kickoff", "external_id": "tokKick00001", "task_id": CARD, "client_name": "Cedar Homes",
                          "submitted_at": "2026-10-20T11:55:11+00:00", "answers": {"formId": "tG7dnxBn", "token": "tokKick00001"}},
                         {"id": "7d1c0e2a-9b8f-4e5d-8c3b-2a1f0e9d8c7b", "form_key": "onboarding", "external_id": "tokOnb00001", "task_id": CARD,
                          "client_name": "Cedar Homes", "submitted_at": "2026-10-01T08:00:00+00:00", "answers": {"fields": ONBOARDING},
                          "hidden": {"onboarding_client_id": CARD}}]
        if path.startswith("/rest/v1/cockpit_billing_accounts?"):
            assert f"clickup_task_id=in.({CARD})" in path
            return 200, [{"clickup_task_id": CARD, "client_name": self.card_name}]
        if path == "/rest/v1/rpc/cockpit_form_parity_plan":
            return 200, {"formKey": body["p_form_key"], "effects": self.plan(body["p_form_key"], body["p_input"]), "unmapped": self.unmapped}
        if url.startswith("https://api.clickup.com/api/v2/task/"):
            assert method == "GET" and headers["authorization"] == CLICKUP_KEY
            assert urllib.parse.urlsplit(url).path == f"/api/v2/task/{CARD}/comment"
            return 200, {"comments": self.comments}
        raise AssertionError(f"no fake for {method} {url}")


class Parity(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        release = self.tmp / "releases" / "86eebpf1"
        release.mkdir(parents=True)
        (self.tmp / "current").symlink_to(release)
        state = self.tmp / "state"
        state.mkdir()
        (state / "runtime-86eebpf1.json").write_text(json.dumps({"SUPABASE_URL": DB, "SUPABASE_SERVICE_ROLE_KEY": SERVICE_KEY,
                                                               "CLICKUP_API_TOKEN": CLICKUP_KEY}))
        (self.tmp / "relay.env").write_text("".join(f"{k}={v}\n" for k, v in RELAY.items()))
        self.net = Net()
        for patch in (mock.patch.object(mp, "NATIVE_CURRENT", str(self.tmp / "current")),
                      mock.patch.object(mp, "NATIVE_STATE", str(state)),
                      mock.patch.object(mp, "RELAY_CONFIG", str(self.tmp / "relay.env")),
                      mock.patch.object(mp, "BLUEPRINT_DIR", str(FIXTURES)),
                      mock.patch.object(mp, "TYPEFORM_DIR", str(FIXTURES)),
                      mock.patch.object(mp.urllib.request, "urlopen", lambda req, timeout=None: self.net(req, timeout))):
            patch.start()
            self.addCleanup(patch.stop)

    def run_cmd(self, *args):
        out = io.StringIO()
        with redirect_stdout(out):
            code = mp.main(list(args))
        text = out.getvalue()
        for secret in SECRETS:
            self.assertNotIn(secret, text)
        return code, text

    def test_a_kickoff_equal_to_make_passes_with_the_24_line_and_every_effect_named(self):
        code, out = self.run_cmd("kickoff", "--last", "1")
        self.assertEqual(code, 0, out)
        self.assertEqual(out.strip().splitlines(), [
            "kickoff [24] search",
            f"kickoff run 1: from response {RESPONSE}",
            "kickoff run 1: handoff_comment equal",
            "kickoff run 1: native_status equal",
            "kickoff run 1: card_fields equal",
            "kickoff run 1: card_fields intended: the Blueprint link points at the cockpit Blueprint",
            "kickoff run 1: onboarding_tasks equal",
            f"kickoff run 1: onboarding_tasks intended: {mp.INTENDED['task_name']}; {mp.INTENDED['dedupe']}",
            "kickoff run 1: map_phase4 equal",
            "kickoff run 1: phase4_whatsapp intended: waits for the CSM's approval (2b rule)",
            "kickoff run 1: kickoff_notice intended: the cockpit's Stage 1 notice (Make posts none)",
            "kickoff run 1: new_mrr intended: new (Q21)",
            "kickoff run 1: recap intended: stays off (Q22)",
            "kickoff run 1: fidelity equal",
            "PASS: 1 run of 8925654, 0 differences."])

    def test_a_kickoff_opened_from_the_cockpits_link_is_proven_with_its_values(self):
        hidden = mp.cockpit_hidden(mp.blueprint_of(fixture("8922994")), CARD, mp.clean(ONBOARDING), "Cedar Homes (card)")
        self.assertEqual(hidden["consultation_types"], "عن بُعد (أونلاين) | Online, في مقرّكم / مكتبكم | In your office")
        self.assertEqual(hidden["onboarding_client_id"], CARD)
        self.assertNotIn("maps_link", hidden)
        self.assertEqual(mp.cockpit_hidden(mp.blueprint_of(fixture("8922994")), CARD, [], "Cedar Homes")["legal_name"], "Cedar Homes")
        made = mp.make_modules(mp.blueprint_of(fixture("8925654")), mp.trigger_bundle(fixture("tG7dnxBn"), mp.clean(KICKOFF), hidden))
        self.net.comments = [{"id": "c1", "date": "1760961320000", "comment_text": made[11]["input"]["comment_text"]}]
        self.net.handoff = made[11]["input"]["comment_text"]
        code, out = self.run_cmd("kickoff")
        self.assertEqual(code, 0, out)
        self.assertIn("kickoff run 1: hidden values from the cockpit's kickoff link, not Make 13 [29]'s", out)
        self.assertIn("kickoff run 1: fidelity equal", out)
        self.assertEqual(len([r for r in self.net.requests if r["url"].startswith("https://api.clickup.com/")]), 1)

    def test_a_missing_phase_text_is_its_own_verdict_and_the_run_is_not_proven(self):
        self.net.messages = {}
        code, out = self.run_cmd("kickoff")
        self.assertEqual(code, 1)
        self.assertIn("kickoff run 1: phase4_whatsapp setting missing", out)
        self.assertEqual(out.strip().splitlines()[-1],
                         "NOT PROVEN: 1 run of 8925654, 0 differences; stage4.messages has no phase 4 text, so it was not compared.")
        self.net.messages = {"phase4": PHASES["phase4"].replace("{content_folder}", "")}
        code, out = self.run_cmd("kickoff")
        self.assertIn("kickoff run 1: phase4_whatsapp differs: text", out)

    def test_differences_name_field_ids_lines_and_labels_only(self):
        self.net.handoff = "KICKOFF HANDOFF for Cedar Homes\n" + ANSWER
        self.net.contract = "Not sent yet"
        self.net.targets = []
        self.net.unmapped = ["c0000001-0000-4000-8000-00000000000a", "c0000001-0000-4000-8000-000000000007"]
        self.net.comments = [{"id": "c1", "date": "1760961320000",
                              "comment_text": self.net.k_mods[11]["input"]["comment_text"].replace(PHONE, "+965 0000 0000")}]
        code, out = self.run_cmd("kickoff")
        self.assertEqual(code, 1)
        self.assertIn("kickoff run 1: handoff_comment differs: text", out)
        self.assertIn("kickoff run 1: card_fields differs: ac976d4a", out)
        self.assertIn("kickoff run 1: onboarding_tasks differs: the client_onboarding request type is not set up", out)
        self.assertIn("kickoff run 1: answers differs: the cockpit maps no option for "
                      "c0000001-0000-4000-8000-000000000007, c0000001-0000-4000-8000-00000000000a\n", out)
        self.assertRegex(out, r"kickoff run 1: fidelity differs: line \d+ \(Phone\); \d+ lines evaluated, \d+ on the card")
        self.assertIn("FAIL: 1 run of 8925654, 5 differences.", out)
        self.net.comments = []
        code, out = self.run_cmd("kickoff")
        self.assertIn("kickoff run 1: fidelity differs: no handoff comment on the card", out)

    def test_an_onboarding_answer_compares_the_dispatch_the_texts_and_the_client_data_search(self):
        self.net.messages = {"phase4": PHASES["phase4"]}
        code, out = self.run_cmd("onboarding", "--last", "1")
        self.assertEqual(code, 1)
        self.assertEqual(out.strip().splitlines(), [
            "onboarding [31] search",
            "onboarding run 1: from response 7d1c0e2a-9b8f-4e5d-8c3b-2a1f0e9d8c7b",
            "onboarding run 1: github_dispatch equal",
            "onboarding run 1: profile_fields equal",
            f"onboarding run 1: profile_fields intended: {mp.INTENDED['kickoff_link']}",
            "onboarding run 1: raw_answers_comment equal",
            "onboarding run 1: client_data_row differs: Make 13 [31] only searches Client Data, so Make writes no row",
            "onboarding run 1: map_phase3 equal",
            "onboarding run 1: phase3_whatsapp setting missing",
            "onboarding run 1: brand_dna_task differs: the brand_dna request type is not set up",
            f"onboarding run 1: read_model intended: {mp.INTENDED['read_model']}",
            "onboarding run 1: fidelity equal",
            "FAIL: 1 run of 8922994, 2 differences; stage4.messages has no phase 3 text, so it was not compared."])
        self.net.with_client_data_row = False
        self.net.messages = dict(PHASES)
        self.net.targets = [{"key": "brand_dna", "targets": [{"list_id": "901818016338", "owner_clickup_id": 100000001}]}]
        self.net.card_name = "Cedar Homes Trading Co"
        code, out = self.run_cmd("onboarding")
        self.assertNotIn("client_data_row", out)
        self.assertIn("onboarding run 1: github_dispatch differs: client name", out)
        self.assertIn("onboarding run 1: brand_dna_task equal", out)
        self.assertIn("onboarding run 1: phase3_whatsapp intended: waits for the CSM's approval (2b rule)", out)
        self.assertIn("FAIL: 1 run of 8922994, 1 difference.", out)
        (self.tmp / "relay.env").write_text("")
        code, out = self.run_cmd("onboarding")
        self.assertIn("github_dispatch differs: the relay's dispatch settings are not filled (~/.forms-relay/config.env)", out)

    def test_every_clickup_read_sits_between_its_receipts_and_none_is_made_without_one(self):
        self.run_cmd("kickoff", "--last", "1")
        made = [r for r in self.net.requests if not r["url"].startswith(DB)]
        self.assertEqual(len(made), 1)
        self.assertTrue(all(r["url"].startswith("https://api.clickup.com/") for r in made))
        receipts = [r["json"] for r in self.net.requests if r["url"].endswith("cockpit_csm_provider_health")]
        self.assertEqual([(r["provider"], r["phase"]) for r in receipts], [("clickup", "intent"), ("clickup", "response")])
        self.assertEqual(receipts[1]["http_status"], 200)
        self.assertTrue(receipts[0]["run_key"].startswith("make-parity:"))
        self.net = Net()
        self.net.receipt_fails = {"intent"}
        code, out = self.run_cmd("kickoff")
        self.assertEqual(code, 1)
        self.assertIn("could not be saved, so the call was not made", out)
        self.assertEqual([r for r in self.net.requests if not r["url"].startswith(DB)], [])

    def test_usage_saved_files_and_an_unknown_expression_stop_plainly(self):
        for args in ((), ("checkin",), ("kickoff", "--last"), ("kickoff", "--last", "99"), ("kickoff", "--days", "3"),
                     ("kickoff", "--last", "1", "--last", "2")):
            code, out = self.run_cmd(*args)
            self.assertEqual(code, 2)
        self.assertEqual(self.net.requests, [])
        empty = self.tmp / "empty"
        empty.mkdir()
        code, out = self.run_cmd("kickoff", "--blueprint-dir", str(empty))
        self.assertEqual(code, 1)
        self.assertIn("8925654-before-s40-20261102s40.json is not in", out)
        doctored = self.tmp / "doctored"
        shutil.copytree(FIXTURES, doctored)
        bp = json.loads((doctored / mp.SAVED.format("8925654")).read_text())
        bp["flow"][1]["mapper"]["comment_text"] += '{{replace(1.hidden.legal_name; "a"; "b")}}'
        (doctored / mp.SAVED.format("8925654")).write_text(json.dumps(bp))
        code, out = self.run_cmd("kickoff", "--blueprint-dir", str(doctored), "--typeform-dir", str(FIXTURES))
        self.assertEqual(code, 1)
        self.assertIn("make parity stopped: the evaluator does not know the function replace()", out)

    def test_a_client_data_write_is_compared_by_its_columns(self):
        relay = {"CLIENT_DATA_COLUMNS": json.dumps({"A": "client", "C": "task"})}
        plan = [{"key": "client_data_row", "plan": {"payload": {"taskId": CARD, "client": "Cedar Homes", "answers": {}}}}]
        mods = {31: {"input": {"values": {"0": "Cedar Homes", "2": CARD}}, "module": "google-sheets:addRow"}}
        lines = dict(mp.compare_onboarding(plan, mods, {"relay": relay, "targets": {}}))
        self.assertEqual(lines["client_data_row"], "equal")
        mods[31]["input"]["values"]["4"] = "extra"
        self.assertEqual(dict(mp.compare_onboarding(plan, mods, {"relay": relay, "targets": {}}))["client_data_row"], "differs: columns E")
        self.assertEqual(dict(mp.compare_onboarding([], mods, {"relay": relay, "targets": {}}))["client_data_row"],
                         "differs: Make 13 [31] writes a Client Data row the cockpit does not plan")

    def test_a_writing_24_is_printed_with_its_columns_and_stops_the_run(self):
        doctored = self.tmp / "doctored"
        shutil.copytree(FIXTURES, doctored)
        bp = json.loads((doctored / mp.SAVED.format("8925654")).read_text())
        m24 = next(m for m in mp.flat_modules(mp.blueprint_of(bp)["flow"]) if m["id"] == 24)
        m24.update(module="google-sheets:updateRow",
                   mapper={"rowNumber": "2", "values": {"5": "{{1.hidden.legal_name}}", "2": "{{1.hidden.onboarding_client_id}}"}})
        self.assertEqual(mp.line_of(bp, 24), "[24] writes: 2, 5")
        (doctored / mp.SAVED.format("8925654")).write_text(json.dumps(bp))
        code, out = self.run_cmd("kickoff", "--blueprint-dir", str(doctored), "--typeform-dir", str(FIXTURES))
        self.assertEqual(code, 1)
        self.assertEqual(out.splitlines()[0], "kickoff [24] writes: 2, 5")
        self.assertIn("make parity stopped: the evaluator does not know [24] google-sheets:updateRow", out)

    def test_the_service_is_intended_only_when_make_writes_none(self):
        # The test field map lists Interior design only, so Make's id for any other service must still differ.
        plan = self.net.plan("kickoff", {"taskId": CARD, "client": "Cedar Homes", "hidden": {"legal_name": "Cedar Homes"}})
        ctx = {"options": {o["field_id"]: o["options"] for o in OPTIONS}, "targets": {}, "messages": PHASES}

        def card(service):
            kickoff = [dict(a, value=service) if a["ref"].endswith("0007") else a for a in KICKOFF]
            mods = make12_mods(kickoff)
            return mods[21]["input"]["custom_fields"][SERVICE], [v for k, v in mp.compare_kickoff(plan, mods, ctx) if k == "card_fields"]

        blueprint = f"intended: {mp.INTENDED['blueprint']}"
        self.assertEqual(card("Interior design, Other"), ("e9883783-96ef-49e9-83c3-efba1aebc738", ["equal", blueprint]))
        self.assertEqual(card("Fit out and renovation"), ("889744ae-e3c5-4dc0-bf29-7f6c183be11e", ["differs: bab9a58b", blueprint]))
        self.assertEqual(card("Landscaping"), (None, ["equal", blueprint, f"intended: {mp.INTENDED['service']}"]))


if __name__ == "__main__":
    unittest.main()
