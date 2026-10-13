"""Client-service classification and digest exclusions, with fictional calls only."""
import json
import unittest
from datetime import datetime, timezone
from unittest import mock

from desk import followups, http, notes, recordings
from desk.call_scope import purpose_of
from desk.errors import Refused
from desk.supabase import Supabase
from tests.fakes import FakePostgrest, FakeProvider


class CallScope(unittest.TestCase):
    def test_classification_requires_a_real_quote_and_does_not_default_to_sales(self):
        transcript = 'Client: We have been running our campaigns with Mahara since July.'
        quote = 'We have been running our campaigns with Mahara since July.'
        self.assertEqual(purpose_of({'call_purpose': 'client_service', 'call_purpose_evidence': quote}, transcript)
                         ['call_purpose'], 'client_service')
        for evidence in ('', 'Mahara', 'A made-up quote about being a client'):
            self.assertEqual(purpose_of({'call_purpose': 'client_service', 'call_purpose_evidence': evidence}, transcript)
                             ['call_purpose'], 'unknown')
        self.assertEqual(purpose_of({}, transcript)['call_purpose'], 'unknown')
        self.assertEqual(purpose_of({'call_purpose': 'sales'}, 'Our previous agency ran ads.')['call_purpose'], 'sales')
        quote = 'This is our internal Mahara account management team meeting.'
        self.assertEqual(purpose_of({'call_purpose': 'internal', 'call_purpose_evidence': quote}, quote)
                         ['call_purpose'], 'internal')
        self.assertEqual(purpose_of({'call_purpose': 'internal', 'call_purpose_evidence': quote}, transcript)
                         ['call_purpose'], 'unknown')

    def test_arabic_quote_and_whitespace_are_supported(self):
        quote = 'نحن نعمل مع Mahara منذ شهر يوليو'
        self.assertEqual(purpose_of({'call_purpose': 'client_service', 'call_purpose_evidence': quote},
                                    'العميل: نحن نعمل مع Mahara\n منذ شهر يوليو')['call_purpose'], 'client_service')

    def test_hidden_or_missing_or_future_notes_never_reach_the_digest(self):
        pg = FakePostgrest()
        stamp = '2026-09-20T09:00:00+00:00'
        for rid, hidden in [('sales', None), ('client', 'client service'), ('internal', 'internal'), ('duplicate', 'duplicate')]:
            pg.put('cockpit_sales_recordings', {'recording_id': rid, 'hidden_reason': hidden,
                                               'started_at': stamp, 'transcript_path': rid+'.md', 'transcript_chars': 9000})
        for rid in ('sales', 'client', 'internal', 'duplicate', 'orphan', 'future'):
            pg.put('cockpit_sales_call_notes', {'recording_id': rid, 'call_at': stamp if rid != 'future' else '2027-01-01T00:00:00Z',
                                               'notes': {'questions': [rid+' question']}})
        p = FakeProvider([json.dumps({'questions': [], 'problems': [], 'objections': [], 'expectations': [], 'marketing': []})])
        with mock.patch.object(http, 'request', pg):
            out = notes.run_digest(Supabase('https://example.supabase.co', 'k'), p, lambda _: None,
                                   days=7, now=datetime(2026, 9, 26, tzinfo=timezone.utc))
        self.assertEqual((out['calls'], out['of']), (1, 1))
        self.assertIn('sales question', p.calls[0]['user'])
        for rid in ('client', 'internal', 'duplicate', 'orphan', 'future'):
            self.assertNotIn(rid+' question', p.calls[0]['user'])
        self.assertEqual(pg.rows('cockpit_sales_digests')[0]['digest']['source_recording_ids'], ['sales'])

    def test_filter_failure_does_not_publish_a_digest(self):
        sb = mock.Mock()
        sb.select_all.return_value = [{'recording_id': 'x', 'notes': {}}]
        sb.select.side_effect = RuntimeError('recording filter unavailable')
        with self.assertRaisesRegex(RuntimeError, 'filter unavailable'):
            notes.run_digest(sb, FakeProvider([]), lambda _: None, days=7)
        sb.upsert.assert_not_called()

    def test_followup_context_keeps_sales_calls_and_excludes_client_calls(self):
        pg = FakePostgrest()
        for rid, hidden in [('sale', None), ('client', 'client service'), ('internal', 'internal')]:
            pg.put('cockpit_sales_recordings', {'recording_id': rid, 'contact_id': 'lead',
                                               'hidden_reason': hidden, 'summary': rid+' summary'})
            pg.put('cockpit_sales_call_notes', {'recording_id': rid, 'contact_id': 'lead',
                                               'notes': {'summary': rid+' note'}})
        with mock.patch.object(http, 'request', pg), mock.patch.object(followups, 'ghl_history', return_value=([], True)):
            ctx = followups.context_for(Supabase('https://example.supabase.co', 'k'),
                                        {'contact_id': 'lead'}, 'fake', datetime(2026, 10, 13, tzinfo=timezone.utc))
        self.assertEqual([r['summary'] for r in ctx['recorded_calls']], ['sale summary'])
        self.assertEqual([r['summary'] for r in ctx['what_the_calls_told_us']], ['sale note'])

    def test_client_recording_cannot_be_used_for_a_proposal_even_by_id(self):
        sb, fathom = mock.Mock(), mock.Mock()
        sb.recording.return_value = {'recording_id': 'x', 'hidden_reason': 'client service'}
        with self.assertRaises(Refused):
            recordings.pick(sb, fathom, lambda _: None, contact_id='c', recording_id='x')
        fathom.transcript.assert_not_called()

    def test_exclusions_apply_before_the_digest_limit(self):
        pg = FakePostgrest()
        for rid, hidden in [('client', 'client service'), ('sale', None)]:
            pg.put('cockpit_sales_recordings', {'recording_id': rid, 'hidden_reason': hidden})
            pg.put('cockpit_sales_call_notes', {'recording_id': rid, 'call_at': '2026-09-25T00:00:00Z', 'notes': {}})
        p = FakeProvider([json.dumps({'questions': []})])
        with mock.patch.object(http, 'request', pg), mock.patch.object(notes, 'DIGEST_NOTES', 1):
            out = notes.run_digest(Supabase('https://example.supabase.co', 'k'), p, lambda _: None,
                                   days=7, now=datetime(2026, 9, 26, tzinfo=timezone.utc))
        self.assertEqual(out['calls'], 1)
        self.assertEqual(pg.rows('cockpit_sales_digests')[0]['digest']['source_recording_ids'], ['sale'])
