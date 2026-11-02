import copy
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "film"))
from delivery import extra_cues, blockers_for
import v4a
from build import Cut


class DeliveryTests(unittest.TestCase):
    def test_arabic_clock_never_requires_english_line_ids(self):
        script = json.loads((Path(v4a.__file__).parent / "lines.json").read_text())
        timing = {"lines": [{"id": line["id"], "words": [{"w": word, "start": line["window"][0] + i * .1} for i, word in enumerate(line["text"].split())]} for line in script["ar"]]}
        cues = extra_cues("ar", timing)
        self.assertAlmostEqual(cues["thirty"], 5.7)
        self.assertAlmostEqual(cues["arabic"], 17.7)
        self.assertAlmostEqual(cues["return_projects"], 45.4)

    def test_changed_timing_fails_clearly(self):
        with self.assertRaisesRegex(ValueError, "ar-2a"):
            extra_cues("ar", {"lines": []})

    def test_real_close_retains_eight_seconds_and_narrator_stops(self):
        html = v4a.root_html(Cut("en"), True, False, False, False, has_clip=True)
        self.assertIn('id="vo" class="clip" src="assets/audio/vo.wav" data-start="0" data-duration="52"', html)
        close = v4a.close(Cut("en"), {}, True)
        self.assertIn('src="assets/media/close.mp4" data-start="0" data-duration="8"', close)
        self.assertIn("background:transparent", close)
        self.assertNotIn('data-duration="7"', close)

    def test_licence_and_real_clip_cannot_be_inferred(self):
        issues = blockers_for("ar", {"voice": True, "closing": "real"}, {}, "fingerprint", "render")
        self.assertTrue(any("commercial" in issue for issue in issues))
        self.assertTrue(any("Arabic approval" in issue for issue in issues))
        self.assertTrue(any("eight-second" in issue for issue in issues))

    def test_approval_binds_exact_take_script_clip_and_render(self):
        evidence = {"reviewedBy":"reviewer", "reviewedAt":"2026-10-26"}
        build = {"source_fingerprint":"source", "voice":True, "voice_sha256":"voice", "script_sha256":"script", "voice_copy_matches":True, "closing":"real", "closing_sha256":"clip", "closing_seconds":8, "narrator_ends_at":52, "bed":{"mode":"off"}}
        approval = {"voices":{"ar":dict(evidence,commercial=True,licenseEvidence="receipt reference",fileSha256="voice",scriptSha256="script")},"closing":{"ar":dict(evidence,real=True,approved=True,fileSha256="clip")},"arabic":dict(evidence,approved=True,scriptSha256="script"),"review":{"ar":dict(evidence,visual=True,phoneSpeaker=True,fileMd5="render")}}
        self.assertEqual(blockers_for("ar",build,approval,"source","render"), [])
        stale=copy.deepcopy(build);stale["voice_sha256"]="different"
        self.assertTrue(any("commercial" in issue for issue in blockers_for("ar",stale,approval,"source","render")))
        self.assertTrue(blockers_for("ar",build,approval,"changed-source","render"))
        self.assertTrue(blockers_for("ar",build,approval,"source","new-render"))


if __name__ == "__main__":
    unittest.main()
