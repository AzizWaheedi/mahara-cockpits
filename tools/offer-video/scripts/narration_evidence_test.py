"""Offline negative regressions. Synthetic fixtures; no media processes/network."""
import copy
import json
import math
import shutil
import subprocess
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

import narration_align as align
import narration_import as importer
import narration_transcribe as transcribe


class EvidenceRegressionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.take = self.root / 'take'
        self.take.mkdir()
        self.audio = self.take / 'source.wav'
        self.audio.write_bytes(b'fixture-audio' * 40)
        self.text = 'Your work.'
        self.text_hash = importer.text_sha(self.text)
        self.audio_hash = importer.sha256(self.audio)
        self.receipt = {'schemaVersion': 1, 'provider': 'nabarati', 'tool': 'Nabra v4',
            'voiceName': 'Rakan', 'language': 'en', 'purpose': 'full-narration',
            'textSha256': self.text_hash, 'audioSha256': self.audio_hash,
            'generationDate': '2026-10-27', 'sourceMode': 'browser-export',
            'entitlement': {'paidPlanObserved': True, 'plan': 'Professional',
                'checkedAt': '2026-10-27T12:00:00Z', 'commercialPolicyUrl': 'https://www.nabarati.ai/en'},
            'settings': {}, 'copyApproval': {'approved': True, 'textSha256': self.text_hash,
                'evidence': 'Synthetic regression fixture'}}
        (self.take / 'script.txt').write_text(self.text + '\n')
        (self.take / 'receipt.json').write_text(json.dumps(self.receipt))
        self.script = {'text': self.text, 'textSha256': self.text_hash,
            'approval': 'approved', 'approvalSheetSha256': 'b' * 64,
            'segments': [{'id': 'ugc-en-01', 'text': self.text}]}
        self.catalog = self.root / 'catalog.json'
        self.catalog.write_text(json.dumps({'approval': {'approved': True, 'sheetSha256': 'b' * 64},
            'closing': {'approved': True}, 'offers': [{'kind': 'ugc', 'languages': {'en': self.script}}]}))
        self.observed = {'language': 'en', 'audioSha256': self.audio_hash,
            'scriptSha256': self.text_hash, 'duration': 2.0,
            'words': [{'text': 'Your', 'start': .1, 'end': .6},
                      {'text': 'work.', 'start': .7, 'end': 1.2}]}
        self.asr = self.root / 'asr.json'
        self.asr.write_text(json.dumps(self.observed))
        self.args = Namespace(take=self.take, asr=self.asr, catalog=self.catalog,
            kind='ugc', language='en', out=self.root / 'bundle')
        self.facts = {'durationSeconds': 2.0, 'sampleRate': 44100,
            'channels': 1, 'codec': 'pcm_s16le', 'bytes': self.audio.stat().st_size}

    def bundle_with_receipt(self, receipt):
        with patch.object(align, 'preflight', return_value=(self.text, receipt, 2.0)):
            return align.bundle(self.args)

    def test_alignment_rechecks_missing_licence(self):
        del self.receipt['entitlement']['commercialPolicyUrl']
        with self.assertRaises(ValueError):
            self.bundle_with_receipt(self.receipt)
        self.assertFalse(self.args.out.exists())

    def test_alignment_rechecks_changed_licence(self):
        self.receipt['entitlement']['commercialPolicyUrl'] = 'https://example.com/terms'
        with self.assertRaises(ValueError):
            self.bundle_with_receipt(self.receipt)

    def test_alignment_rechecks_copy_approval(self):
        self.receipt['copyApproval']['approved'] = False
        with self.assertRaisesRegex(ValueError, 'explicit approval'):
            self.bundle_with_receipt(self.receipt)

    def test_alignment_rechecks_copy_hash(self):
        self.receipt['copyApproval']['textSha256'] = 'c' * 64
        with self.assertRaisesRegex(ValueError, 'exact script'):
            self.bundle_with_receipt(self.receipt)

    def test_alignment_rechecks_paid_evidence(self):
        self.receipt['entitlement']['paidPlanObserved'] = False
        with self.assertRaises(ValueError):
            self.bundle_with_receipt(self.receipt)

    def test_alignment_rejects_nonfinite_duration_before_output(self):
        for duration in (math.nan, math.inf, -math.inf, True, '2'):
            with self.subTest(duration=duration):
                self.observed['duration'] = duration
                self.asr.write_text(json.dumps(self.observed))
                with self.assertRaisesRegex(ValueError, 'finite number'):
                    self.bundle_with_receipt(self.receipt)
                self.assertFalse(self.args.out.exists())

    def test_word_check_rejects_nan_upper_bound(self):
        with self.assertRaisesRegex(ValueError, 'finite number'):
            transcribe.validate_words(self.observed['words'], math.nan)

    def test_receipt_rejects_url_credentials_and_nondefault_port(self):
        urls = ('https://user:password@www.nabarati.ai/en',
                'https://user@www.nabarati.ai/en',
                'https://www.nabarati.ai:444/en', 'https://www.nabarati.ai:invalid/en')
        for url in urls:
            with self.subTest(url=url):
                self.receipt['entitlement']['commercialPolicyUrl'] = url
                with self.assertRaises(ValueError):
                    importer.validate_receipt(self.receipt, self.text, self.audio_hash)

    def test_receipt_allows_explicit_default_https_port(self):
        self.receipt['entitlement']['commercialPolicyUrl'] = 'https://www.nabarati.ai:443/en'
        importer.validate_receipt(self.receipt, self.text, self.audio_hash)

    def test_probe_has_bounded_timeout(self):
        with patch.object(importer.subprocess, 'check_output', side_effect=subprocess.TimeoutExpired('ffprobe', 10)) as probe:
            with self.assertRaises(subprocess.TimeoutExpired):
                importer.probe_audio(self.audio)
        self.assertEqual(probe.call_args.kwargs['timeout'], 10)

    def test_probe_rejects_nonfinite_and_boolean_duration(self):
        for duration in ('NaN', 'Infinity', True):
            data = {'streams': [{'codec_type': 'audio'}], 'format': {'duration': duration}}
            with self.subTest(duration=duration), patch.object(importer.subprocess, 'check_output', return_value=json.dumps(data)):
                with self.assertRaises(ValueError):
                    importer.probe_audio(self.audio)

    def test_import_rechecks_copied_bytes_and_cleans_only_partial(self):
        destination = self.root / 'new-import'
        untouched = self.root / 'existing'
        untouched.mkdir()
        (untouched / 'keep.txt').write_text('preserve')
        real_copy = shutil.copyfile
        def changed_during_copy(source, target):
            Path(source).write_bytes(b'different' * 50)
            return real_copy(source, target)
        with patch.object(importer.shutil, 'copyfile', side_effect=changed_during_copy), patch.object(importer, 'probe_audio') as probe:
            with self.assertRaisesRegex(ValueError, 'Copied audio'):
                importer.import_take(self.audio, self.take / 'script.txt', self.take / 'receipt.json', destination)
        probe.assert_not_called()
        self.assertFalse(destination.exists())
        self.assertEqual((untouched / 'keep.txt').read_text(), 'preserve')

    def test_existing_import_is_never_removed(self):
        destination = self.root / 'existing-import'
        destination.mkdir()
        (destination / 'keep.txt').write_text('preserve')
        with self.assertRaisesRegex(ValueError, 'already exists'):
            importer.import_take(self.audio, self.take / 'script.txt', self.take / 'receipt.json', destination)
        self.assertEqual((destination / 'keep.txt').read_text(), 'preserve')

    def test_import_probes_the_verified_copy(self):
        destination = self.root / 'new-import'
        with patch.object(importer, 'probe_audio', return_value=self.facts) as probe:
            manifest = importer.import_take(self.audio, self.take / 'script.txt', self.take / 'receipt.json', destination)
        self.assertEqual(probe.call_args.args[0], destination / 'source.wav')
        self.assertEqual(manifest['audioSha256'], self.audio_hash)
        self.assertFalse(manifest['clientReady'])

    def test_alignment_rechecks_copied_audio(self):
        real_copy = shutil.copyfile
        def changed_during_copy(source, target):
            Path(source).write_bytes(b'different' * 50)
            return real_copy(source, target)
        with patch.object(align.shutil, 'copyfile', side_effect=changed_during_copy):
            with self.assertRaisesRegex(ValueError, 'Bundled audio'):
                self.bundle_with_receipt(self.receipt)
        self.assertFalse(self.args.out.exists())

    def test_valid_bundle_keeps_quality_unapproved(self):
        result = self.bundle_with_receipt(self.receipt)
        timing = json.loads((self.args.out / 'timing.json').read_text())
        self.assertFalse(result['clientReady'])
        self.assertTrue(timing['commercialEvidenceRecorded'])
        self.assertFalse(timing['transcriptChecked'])
        self.assertEqual(timing['asrSha256'], importer.sha256(self.args.out / 'asr.json'))


if __name__ == '__main__':
    unittest.main()
