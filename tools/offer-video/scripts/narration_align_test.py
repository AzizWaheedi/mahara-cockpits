import copy
import unittest
from narration_align import align_exact
from narration_transcribe import text_sha


class ExactAlignmentTests(unittest.TestCase):
    def fixture(self):
        text = 'Your work.\n\nكل المواد لكم.'
        script = {'text': text, 'textSha256': text_sha(text), 'segments': [
            {'id': 'a', 'text': 'Your work.'}, {'id': 'b', 'text': 'كل المواد لكم.'}]}
        words = [{'text': t, 'start': i, 'end': i + .8} for i, t in enumerate(['your', 'work', 'كل', 'المواد', 'لكم'])]
        return script, {'scriptSha256': text_sha(text), 'duration': 5, 'words': words}

    def test_exact_approved_words_and_observed_bounds(self):
        script, observed = self.fixture()
        segments, words = align_exact(script, observed)
        self.assertEqual([w['text'] for w in words], script['text'].split())
        self.assertEqual(segments[1]['start'], 2)
        self.assertEqual(words[1]['observedText'], 'work')

    def test_spoken_substitution_blocks_bundle(self):
        script, observed = self.fixture()
        observed['words'][1]['text'] = 'guarantee'
        with self.assertRaisesRegex(ValueError, 'not an exact'):
            align_exact(script, observed)

    def test_missing_word_blocks_bundle(self):
        script, observed = self.fixture()
        observed['words'].pop()
        with self.assertRaises(ValueError):
            align_exact(script, observed)

    def test_merged_words_not_split_by_invention(self):
        script, observed = self.fixture()
        observed['words'][0]['text'] = 'Your work'
        observed['words'].pop(1)
        with self.assertRaises(ValueError):
            align_exact(script, observed)

    def test_zero_duration_blocks_bundle(self):
        script, observed = self.fixture()
        observed['words'][0]['end'] = 0
        with self.assertRaisesRegex(ValueError, 'empty or overlap'):
            align_exact(script, observed)

    def test_wrong_script_hash_blocks_bundle(self):
        script, observed = self.fixture()
        observed['scriptSha256'] = '0' * 64
        with self.assertRaises(ValueError):
            align_exact(script, observed)


if __name__ == '__main__':
    unittest.main()
