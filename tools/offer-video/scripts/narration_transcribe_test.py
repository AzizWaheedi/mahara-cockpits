import importlib.util
import math
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("transcribe", Path(__file__).with_name("narration_transcribe.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TranscriptEvidenceTests(unittest.TestCase):
    def words(self, *texts):
        return [{"start": i, "end": i + .5, "text": text} for i, text in enumerate(texts)]

    def test_punctuation_and_diacritics_only(self):
        report = module.compare_words("خلّوا مشاريعكم. Your work!", self.words("خلوا", "مشاريعكم", "your", "work"))
        self.assertTrue(report["normalizedExactSequence"])
        self.assertFalse(report["transcriptChecked"])
        self.assertFalse(report["clientReady"])

    def test_dropped_word_stays_explicit(self):
        report = module.compare_words("We do not promise results", self.words("We", "do", "promise", "results"))
        self.assertFalse(report["normalizedExactSequence"])
        self.assertEqual(report["differences"][0]["expected"], ["not"])

    def test_number_is_not_silently_rewritten(self):
        report = module.compare_words("eight videos", self.words("80", "videos"))
        self.assertEqual(report["differences"][0]["observed"], ["80"])

    def test_arabic_word_substitution_not_hidden(self):
        report = module.compare_words("مقدّم يتكلم بلهجتكم", self.words("مقدم", "يتكلم", "بلغتكم"))
        self.assertEqual(len(report["differences"]), 1)

    def test_insertions_stay_explicit(self):
        report = module.compare_words("Your company", self.words("Your", "amazing", "company"))
        self.assertEqual(report["differences"][0]["operation"], "insert")

    def test_valid_words(self):
        module.validate_words(self.words("one", "two"), 2)

    def test_bad_timing_rejected(self):
        for words in ([], [{"text": "x", "start": math.nan, "end": 1}],
                      [{"text": "x", "start": 1, "end": 0}],
                      [{"text": "x", "start": 0, "end": 9}],
                      self.words("one", "two")[::-1]):
            with self.subTest(words=words), self.assertRaises(ValueError):
                module.validate_words(words, 2)


if __name__ == "__main__":
    unittest.main()
