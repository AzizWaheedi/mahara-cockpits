"""Narrow source/cue contract tests. No renderer, network, provider or ASR work."""
import copy
import importlib.util
import json
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("offer_series", Path(__file__).with_name("offer_series.py"))
F = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(F)

class PictureContract(unittest.TestCase):
    def timing(self, kind="ugc", lang="en"):
        script = F.script_for(kind, lang)
        cursor, segments, words = 0.0, [], []
        for seg in script["segments"]:
            start=cursor
            for token in seg["text"].split():
                words.append({"start":cursor,"end":cursor+.3,"text":token})
                cursor+=.33
            segments.append(dict(seg,start=start,end=cursor))
        return script, {"schemaVersion":1,"kind":kind,"language":lang,
          "scriptSha256":script["textSha256"],"copyApproved":True,
          "commercialEvidenceRecorded":True,"audioFile":"voice.wav",
          "duration":cursor,"segments":segments,"words":words,
          "transcriptChecked":False,"subjectiveListen":False}

    def load(self, raw, script):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            (root/"voice.wav").write_bytes(b"fixture-audio-bytes"*20)
            raw=copy.deepcopy(raw)
            raw.setdefault("audioSha256",F.sha(root/"voice.wav"))
            (root/"timing.json").write_text(json.dumps(raw))
            with patch.object(F,"audio_duration",return_value=raw["duration"]):
                return F.read_timing(root/"timing.json",raw["kind"],raw["language"],script)

    def test_all_fourteen_maps_cover_approved_copy(self):
        for kind in F.KINDS:
            for lang in ("en","ar"):
                with self.subTest(kind=kind,lang=lang):
                    script=F.script_for(kind,lang)
                    self.assertEqual(len(F.STORIES[kind]),len(script["segments"]))
                    timing=F.layout_timing(kind,lang,script)
                    for (visual,lines),segment in zip(F.STORIES[kind],timing["segments"]):
                        for _,text,index in F.phases_for(segment,lines,lang,timing,0):
                            self.assertIn(text,segment["text"])
                            self.assertLessEqual(len(text),70)
                            body,_=F.picture(visual,text,index,lang,"test",5)
                            self.assertIn(F.esc(text),body)

    def test_search_film_uses_real_captures_in_both_languages(self):
        for lang in ("en", "ar"):
            google, _ = F.picture("search", "Query", 0, lang, "search", 4)
            chatgpt, _ = F.picture("answers", "Answer", 1, lang, "answer", 4)
            self.assertIn("assets/search/google-web-search.png", google)
            self.assertIn("assets/search/chatgpt-search.png", chatgpt)
            self.assertIn("Google", google)
            self.assertIn("ChatGPT", chatgpt)
            self.assertIn("not a client result" if lang == "en" else "ليس نتيجة لعميل", google)

    def test_search_sequence_keeps_real_profile_and_observed_transitions(self):
        for lang in ("en", "ar"):
            script, raw = self.timing("seo_geo", lang)
            timing = self.load(raw, script)
            cues, offset = [], 0
            for seq, ((visual, lines), segment) in enumerate(zip(F.STORIES["seo_geo"][:3], timing["segments"][:3])):
                phases = F.phases_for(segment, lines, lang, timing, offset)
                offset += len(segment["text"].split())
                for j, (start, text, index) in enumerate(phases):
                    end = phases[j+1][0] if j+1 < len(phases) else timing["segments"][seq+1]["start"]
                    cues.append(dict(id=f"seo-{seq}-{j}", visual=visual, phaseIndex=index, start=start, end=end, text=text))
            source = F.seo_evidence_component(lang, cues)
            self.assertIn("assets/search/google-business-profile.jpg", source)
            self.assertIn("width:460px;height:510px;object-fit:contain", source)
            self.assertIn("assets/search/google-web-search.png", source)
            self.assertIn("assets/search/chatgpt-search.png", source)
            self.assertIn("Google · ", source)
            self.assertIn("ChatGPT · ", source)
            self.assertIn("مثال، وليس نتيجة لعميل" if lang == "ar" else "Example, not a client result", source)
            profile = next(c["start"] for c in cues if c["visual"] == "dossier" and c["phaseIndex"] == 2)
            answer = next(c["start"] for c in cues if c["visual"] == "answers")
            self.assertIn(f"ease:'power2.inOut'}},{profile:.3f}", source)
            self.assertIn(f"ease:'power2.inOut'}},{answer:.3f}", source)
            self.assertNotIn("repeat:", source)
            self.assertNotIn("yoyo:", source)
            self.assertNotIn("autoAlpha", source)
            self.assertNotIn("tl.to('.head", source)
            self.assertNotIn("tl.fromTo('.head", source)
            self.assertIn('data-track-index="1"', source)
            self.assertIn('window.__timelines["seo-evidence-sequence"]=tl', source)

    def test_search_sequence_refuses_reordered_evidence(self):
        cues = [
            dict(id="profile", visual="dossier", phaseIndex=2, start=7.74, end=10.70, text="Profile"),
            dict(id="answer", visual="answers", phaseIndex=0, start=4.0, end=12.0, text="Answer"),
        ]
        with self.assertRaises(ValueError):
            F.seo_evidence_component("en", cues)

    def test_closing_keeps_the_final_sentence_and_observed_start(self):
        script, raw = self.timing("seo_geo", "en")
        timing = self.load(raw, script)
        segment = timing["segments"][-1]
        offset = sum(len(s["text"].split()) for s in timing["segments"][:-1])
        phases = F.phases_for(segment, [], "en", timing, offset, closing=True)
        self.assertEqual(phases[-1][1], "Your account manager will explain the work and the next step.")
        word_index = next(i for i in range(offset, len(timing["words"])) if timing["words"][i]["text"] == "Your")
        self.assertEqual(phases[-1][0], timing["words"][word_index]["start"])
        self.assertEqual(" ".join(p[1] for p in phases), segment["text"])

    def test_search_headlines_do_not_end_in_orphaned_fragments(self):
        for lang in ("en", "ar"):
            script = F.script_for("seo_geo", lang)
            timing = F.layout_timing("seo_geo", lang, script)
            for index in (2, 3):
                lines = F.STORIES["seo_geo"][index][1]
                phases = F.phases_for(timing["segments"][index], lines, lang, timing, 0)
                self.assertEqual(len(phases), 2)
                self.assertTrue(all(len(text.split()) >= 3 for _, text, _ in phases))

    def test_actual_take_flags_are_not_promoted(self):
        script,raw=self.timing()
        result=self.load(raw,script)
        self.assertTrue(result["wordsExact"])
        self.assertFalse(result["transcriptChecked"])
        self.assertFalse(result["subjectiveListen"])

    def test_wrong_script_or_audio_refused(self):
        script,raw=self.timing()
        for field in ("scriptSha256","audioSha256"):
            bad=copy.deepcopy(raw);bad[field]="0"*64
            with self.subTest(field=field),self.assertRaises(ValueError):
                self.load(bad,script)

    def test_unlicensed_audio_and_unapproved_copy_refused(self):
        script,raw=self.timing()
        for flag in ("copyApproved","commercialEvidenceRecorded"):
            bad=copy.deepcopy(raw);bad[flag]=False
            with self.subTest(flag=flag),self.assertRaises(ValueError):
                self.load(bad,script)

    def test_audio_path_escape_refused(self):
        script,raw=self.timing()
        for name in ("../voice.wav","/tmp/voice.wav"):
            bad=copy.deepcopy(raw);bad["audioFile"]=name
            with self.subTest(name=name),self.assertRaises(ValueError):
                self.load(bad,script)

    def test_segment_drift_and_overlap_refused(self):
        script,raw=self.timing()
        for mut in ("text","overlap","nan"):
            bad=copy.deepcopy(raw)
            if mut=="text":bad["segments"][0]["text"]+=" changed"
            elif mut=="overlap":bad["segments"][1]["start"]=0
            else:bad["segments"][0]["end"]=float("nan")
            with self.subTest(mut=mut),self.assertRaises(ValueError):
                self.load(bad,script)

    def test_words_cannot_move_outside_their_segment_or_before_zero(self):
        script,raw=self.timing()
        for mode in ("negative","shifted"):
            bad=copy.deepcopy(raw)
            if mode=="negative":bad["words"][0]["start"]=-.01
            else:
                for word in bad["words"]:word["start"]+=.2;word["end"]+=.2
                bad["duration"]+=.3
            with self.subTest(mode=mode),self.assertRaises(ValueError):self.load(bad,script)

    def test_actual_audio_duration_must_match(self):
        script,raw=self.timing()
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/"voice.wav").write_bytes(b"fixture"*40)
            raw["audioSha256"]=F.sha(root/"voice.wav")
            (root/"timing.json").write_text(json.dumps(raw))
            with patch.object(F,"audio_duration",return_value=raw["duration"]+1),self.assertRaises(ValueError):
                F.read_timing(root/"timing.json","ugc","en",script)

    def test_mismatched_words_never_produce_guessed_captions(self):
        script,raw=self.timing()
        raw["words"][2]["text"]="invented"
        result=self.load(raw,script)
        self.assertFalse(result["wordsExact"])
        self.assertEqual(F.captions_for(script,result),[])
        with self.assertRaises(ValueError):
            F.phases_for(result["segments"][0],F.STORIES["ugc"][0][1],"en",result,0)

    def test_caption_words_reconstruct_exact_approved_script(self):
        for lang in ("en","ar"):
            script,raw=self.timing("ugc",lang)
            timing=self.load(raw,script)
            captions=F.captions_for(script,timing)
            self.assertEqual(" ".join(c["text"] for c in captions)," ".join(script["text"].split()))
            self.assertTrue(all(c["end"]>c["start"] for c in captions))
            self.assertTrue(all(len(c["text"])<=80 for c in captions))

    def test_picture_changes_use_observed_word_boundaries(self):
        script,raw=self.timing("ugc","en")
        timing=self.load(raw,script)
        offset=sum(len(s["text"].split()) for s in script["segments"][:2])
        phases=F.phases_for(timing["segments"][2],F.STORIES["ugc"][2][1],"en",timing,offset)
        self.assertEqual([p[2] for p in phases],[0,1,2])
        actual={w["start"] for w in timing["words"]}
        self.assertTrue(all(p[0] in actual for p in phases))

    def test_ugc_uses_real_muted_media_no_placeholder_tiles(self):
        body,_=F.picture("casting","a presenter",0,"en","ugc-test",6,2)
        self.assertEqual(body.count("<video"),3)
        self.assertEqual(body.count("muted playsinline"),3)
        self.assertIn('data-media-start="2"',body)
        self.assertNotIn('class="play"',body)
        self.assertIn("Example",body)

    def test_logo_is_visible_without_opacity_or_clip_wipe(self):
        body,_=F.picture("close","Approved exact closing",0,"en","close-test",5)
        html=F.component("close-test","en",body,"close")
        self.assertIn('src="assets/brand/logo.png"',html)
        self.assertNotIn("opacity:0",html)
        self.assertNotIn("clipPath",html)

    def test_phone_title_and_label_reserve_distinct_safe_areas(self):
        # Source geometry only; actual glyph bounds are still verified in the first rendered pair.
        import re
        def css(name):
            text=re.search(r"\."+name+r"\{([^}]+)\}",F.CSS).group(1)
            return dict(part.split(":",1) for part in text.split(";") if ":" in part)
        headline,label,caption=css("head"),css("tag"),css("caption")
        px=lambda value:float(value.removesuffix("px"))
        self.assertNotIn("max-height",headline)
        self.assertGreaterEqual(px(headline["font-size"])*360/1920,18)
        self.assertGreaterEqual(px(label["font-size"])*360/1920,14)
        self.assertGreaterEqual(px(caption["font-size"])*360/1920,14)
        title_bottom=px(headline["top"])+2*px(headline["font-size"])*1.18
        self.assertGreaterEqual(px(headline["top"]),108)
        self.assertLess(title_bottom,350)
        label_bottom=px(label["top"])+px(label["font-size"])*float(label["line-height"])+12
        caption_top=1080-px(caption["bottom"])-2*px(caption["font-size"])*float(caption["line-height"])
        self.assertGreater(px(label["top"]),title_bottom)
        self.assertLess(label_bottom,caption_top)
        self.assertIn("top:360px",F.svg(""))

    def test_legacy_generator_is_not_reused_or_rewritten(self):
        source=Path(F.__file__).read_text()
        self.assertNotIn("import build as",source)
        self.assertNotIn("v4a.py",source)
        self.assertIn('"clientReady":False',source)

if __name__=="__main__":
    unittest.main()

