"""The worker's card outputs against the ClickUp writer's research kind (plan build MI-1b, contract 4.23.1).

supabase/functions/clickup-writeback/fixtures/research-outputs.json holds what render.outputs() makes for one synthetic
published run (the test card, an invented run id and Doc). The writer's own test (research.test.ts) reads the same
file and checks that research.ts takes that field value and that comment as they are, so a change to either side's
shape fails here or there before it reaches a card."""
import json
import unittest
from pathlib import Path

from mi import config as config_mod
from mi import render

GOLDEN = Path(__file__).resolve().parents[3] / "supabase" / "functions" / "clickup-writeback" / "fixtures" / "research-outputs.json"


class WriterContract(unittest.TestCase):
    def setUp(self):
        self.golden = json.loads(GOLDEN.read_text(encoding="utf-8"))
        self.i = self.golden["inputs"]

    def test_render_still_makes_the_outputs_the_writer_takes(self):
        out = render.outputs(task_id=self.i["taskId"], run_id=self.i["runId"], mode="live", competitors_n=self.i["competitorsN"],
                             sources_n=self.i["sourcesN"], doc_url=self.i["docUrl"])
        self.assertEqual(out, self.golden["outputs"])

    def test_the_field_is_the_market_research_doc_and_the_link_a_google_doc(self):
        field = self.golden["outputs"]["field"]
        self.assertEqual(field["id"], config_mod.MARKET_RESEARCH_FIELD)
        self.assertEqual(field["value"], "https://docs.google.com/document/d/%s/edit" % self.i["docId"])

    def test_the_comment_ends_with_its_marker_and_never_notifies(self):
        c = self.golden["outputs"]["comment"]
        marker = "Cockpit ref MI-" + self.i["runId"].replace("-", "")[:8]
        self.assertEqual(c["marker"], marker)
        self.assertTrue(c["text"].endswith("\n" + marker))
        self.assertEqual(c["text"].count(marker), 1)
        self.assertIn("https://docs.google.com/document/d/" + self.i["docId"], c["text"])
        self.assertFalse(c["notifyAll"])
        self.assertLessEqual(len(c["text"]), 2000)


if __name__ == "__main__":
    unittest.main()
