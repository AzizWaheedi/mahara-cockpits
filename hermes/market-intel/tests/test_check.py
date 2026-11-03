"""The validator's eight rules, one failing case each, plus a passing pair."""
import copy
import unittest

from mi import check
from mi.evidence import Draft, Pack
from mi.prompts import SECTIONS


def pack() -> Pack:
    p = Pack()
    p.add(Draft(kind="form", subject="client", source="cockpit:onboarding form", body={"claimsOfTheClient": {"x": "y"}}))
    p.add(Draft(kind="maps_place", subject="client", source="maps", url="https://maps.example/client", body={"rating": 4.6}))
    for i in range(1, 7):
        p.add(Draft(kind="maps_place", subject=f"K{i}", source="maps", url=f"https://maps.example/k{i}", body={"rating": 4}))
        p.add(Draft(kind="web_page", subject=f"C{i}", source="web", url=f"https://rival{i}.example/", body={"title": "x"}))
    for i in range(8):
        p.add(Draft(kind="serp", subject="market", source="serp", url=f"https://www.google.com/search?q={i}", body={"query": "q"}))
    return p


COMPS = [{"cid": f"C{i}", "reserve": False, "evidence": [f"E{1 + 2 * i}"]} for i in range(1, 7)]
PRESENCE = {"maps": {"state": "found"}, "website": {"state": "found"}, "instagram": {"state": "none_found"},
            "facebook": {"state": "found"}, "ads": {"state": "not_checked"}, "tiktok_snapchat": {"state": "not_checked"}}


def findings(lang: str = "en") -> dict:
    secs = []
    for key, title, _ in SECTIONS:
        kind = "recommendation" if key in ("positioning", "plan") else "limit" if key == "limits" else "research"
        text = "In the first 30 days, fix the listing." if key == "plan" else "Rated {m1} on Google." if key == "summary" else "A finding."
        claim = {"id": f"{key}-1", "kind": kind, "text": text, "evidence": [] if kind == "limit" else ["E2"],
                 "metrics": [{"ref": "m1", "metric": "maps.rating", "of": "client"}] if key == "summary" else []}
        secs.append({"key": key, "title": title, "claims": [claim]})
    secs[1]["claims"].append({"id": "profile-2", "kind": "client_claim", "text": "They say villas.", "evidence": ["E1"], "metrics": []})
    f = {"schema": "mi.findings.v1", "lang": lang, "sections": secs,
         "competitors": [{"cid": c["cid"], "name": f"Rival {c['cid']}", "why": "Same work, same area.", "evidence": c["evidence"]} for c in COMPS],
         "mysteryShop": {"speed": None}}
    if lang == "ar":
        f["labels"] = {"clientClaim": "x {date}", "recommendation": "x", "notChecked": "x", "sources": "x", "evidence": "x"}
    return f


def run(en, ar=None, comps=COMPS, presence=PRESENCE, p=None):
    return check.check(en, ar, p or pack(), competitors=comps, presence=presence, task_id="taskMiCedar1",
                       run_id="11111111-2222-4333-8444-555555555555")


class Rules(unittest.TestCase):
    def test_a_good_pair_passes_every_rule(self):
        v = run(findings("en"), findings("ar"))
        self.assertTrue(v.ok, v.errors)
        self.assertEqual(sorted(v.rules), ["r1_shape", "r2_evidence", "r3_numbers", "r4_parity", "r5_minimums",
                                           "r6_client_claims", "r7_privacy", "r8_recommendations"])

    def test_r1_a_missing_section_or_an_unplaced_metric(self):
        f = findings()
        f["sections"].pop(4)
        v = run(f)
        self.assertFalse(v.ok)
        self.assertIn("missing competitors", " ".join(v.errors))
        f = findings()
        f["sections"][0]["claims"][0]["text"] = "Rated well."
        self.assertIn("metric m1 is not placed in the text", " ".join(run(f).errors))
        ar = findings("ar")
        del ar["labels"]["clientClaim"]
        self.assertIn("labels.clientClaim is missing", " ".join(run(findings(), ar).errors))

    def test_r2_evidence_never_pulled_or_a_page_never_opened(self):
        f = findings()
        f["sections"][2]["claims"][0]["evidence"] = ["E999"]
        f["sections"][3]["claims"][0]["text"] = "See https://invented-elsewhere.example/page."
        v = run(f)
        self.assertEqual(v.sentence, "Research finished, but 2 claims cite evidence or pages this run never opened. "
                                     "Open the evidence or run it again.")

    def test_r3_a_typed_number_but_not_a_plan_duration_or_a_placeholder(self):
        f = findings()
        f["sections"][2]["claims"][0]["text"] = "There are 12 rivals."
        self.assertIn("r3_numbers", [k for k, r in run(f).rules.items() if not r["ok"]])
        f = findings()
        f["sections"][2]["claims"][0]["text"] = "There are ١٢ rivals."
        self.assertFalse(run(f).rules["r3_numbers"]["ok"])
        self.assertTrue(run(findings()).rules["r3_numbers"]["ok"])

    def test_r4_arabic_and_english_carry_the_same_claims(self):
        ar = findings("ar")
        ar["sections"][2]["claims"].append({"id": "extra-1", "kind": "research", "text": "x", "evidence": ["E2"], "metrics": []})
        v = run(findings(), ar)
        self.assertIn("only in Arabic: extra-1", " ".join(v.errors))

    def test_r5_too_few_competitors_sources_or_channels(self):
        v = run(findings(), comps=COMPS[:4])
        self.assertIn("only 4 competitors were picked", v.sentence)
        small = Pack()
        small.items = pack().items[:10]
        self.assertIn("only 10 evidence items", " ".join(run(findings(), p=small).errors))
        thin = dict(PRESENCE, facebook={"state": "not_checked"}, website={"state": "not_checked"})
        self.assertIn("checked on 2 of 6 channels", " ".join(run(findings(), presence=thin).errors))
        single = [dict(c, evidence=[]) for c in COMPS]
        p = Pack()
        p.items = [e for e in pack().items if e["kind"] != "web_page"]
        for i in range(12):
            p.add(Draft(kind="serp", subject="market", source="serp", body={}))
        self.assertIn("rest on one kind of source", " ".join(run(findings(), comps=single, p=p).errors))

    def test_r6_form_answers_only_as_the_clients_claims_and_no_mystery_shop(self):
        f = findings()
        f["sections"][1]["claims"][1]["kind"] = "research"
        self.assertFalse(run(f).rules["r6_client_claims"]["ok"])
        f = findings()
        f["mysteryShop"]["speed"] = "2 hours"
        self.assertFalse(run(f).rules["r6_client_claims"]["ok"])

    def test_r7_no_email_phone_or_internal_id(self):
        for text in ("Write to owner@cedar.invalid.", "Card taskMiCedar1 shows it.", "Ref 11111111-2222-4333-8444-555555555555."):
            f = findings()
            f["sections"][2]["claims"][0]["text"] = text
            self.assertFalse(run(f).rules["r7_privacy"]["ok"], text)

    def test_r8_recommendations_are_labelled(self):
        f = findings()
        f["sections"][10]["claims"][0]["kind"] = "research"
        self.assertEqual(run(f).sentence, "Research finished, but a recommendation is not labelled as one. Run it again.")
        f = findings()
        f["sections"][7]["claims"][0]["kind"] = "recommendation"
        self.assertFalse(run(f).rules["r8_recommendations"]["ok"])


if __name__ == "__main__":
    unittest.main()
