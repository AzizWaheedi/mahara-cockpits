import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('native_inbox', Path(__file__).with_name('inbox.py'))
inbox = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inbox)


class MemoryStore:
    apply = True
    def __init__(self):
        self.tables = {'wa_threads': [{'id': 'thread', 'provider_id': 'known-provider', 'last_inbound_at': '2026-10-01T10:00:00+00:00', 'last_outbound_at': None, 'last_at': '2026-10-01T10:00:00+00:00', 'archived': True, 'client_task_id': 'human-assignment'}], 'wa_messages': []}
    def get(self, path):
        return self.tables.get(path.split('?')[0], [])
    def upsert(self, table, rows, on_conflict='id'):
        for row in rows:
            old = next((value for value in self.tables.setdefault(table, []) if value.get(on_conflict) == row[on_conflict]), None)
            if old is None:
                self.tables[table].append(dict(row))
            else:
                old.update(row)

    def publish_thread(self, thread, messages):
        self.upsert('wa_threads', [thread])
        self.upsert('wa_messages', messages)

class InboxDeliveryTests(unittest.TestCase):
    def pull(self, status, direction='outbound', at='2026-10-01T11:00:00Z'):
        store = MemoryStore()
        message = {'id': 'real-message', 'dateAdded': at, 'direction': direction, 'body': 'Actual provider text', 'status': status}
        with patch.object(inbox, 'ghl', return_value={'messages': {'messages': [message]}}):
            inbox.pull_thread(store, 'private-fixture-token', 'location', {'id': 'thread', 'contactId': 'contact', 'fullName': 'Group', 'phone': '+86123'}, datetime(2026, 9, 20, tzinfo=timezone.utc))
        return store
    def test_pending_acceptance_does_not_answer_client(self):
        store = self.pull('pending')
        self.assertTrue(store.tables['wa_threads'][0]['awaiting_us'])
        self.assertIsNone(store.tables['wa_threads'][0]['last_outbound_at'])
        self.assertEqual(store.tables['wa_messages'][0]['delivery_status'], 'pending')
    def test_unknown_delivery_is_not_success(self):
        store = self.pull(None)
        self.assertTrue(store.tables['wa_threads'][0]['awaiting_us'])
        self.assertIsNone(store.tables['wa_messages'][0]['delivery_status'])
    def test_delivery_confirmation_answers_original_inbound(self):
        store = self.pull('delivered')
        self.assertFalse(store.tables['wa_threads'][0]['awaiting_us'])
        self.assertEqual(store.tables['wa_messages'][0]['delivery_status'], 'delivered')
    def test_new_inbound_after_delivered_reply_remains_waiting(self):
        store = self.pull('read', at='2026-10-01T09:00:00Z')
        self.assertTrue(store.tables['wa_threads'][0]['awaiting_us'])
    def test_partial_scan_preserves_human_mapping_and_provider(self):
        store = self.pull('delivered')
        thread = store.tables['wa_threads'][0]
        self.assertEqual(thread['provider_id'], 'known-provider')
        self.assertEqual(thread['client_task_id'], 'human-assignment')
        self.assertTrue(thread['archived'])
    def test_dry_store_never_posts_or_patches(self):
        with patch.dict(inbox.os.environ, {'DESK_SUPABASE_URL': 'https://bldgtotkfmhoxmlzowdx.supabase.co', 'DESK_SUPABASE_KEY': 'private-fixture-key'}), patch.object(inbox.urllib.request, 'urlopen', side_effect=AssertionError('Unexpected outward write')):
            store = inbox.Store(apply=False)
            store.upsert('wa_messages', [{'id': 'real-message'}])
            store.patch('wa_state?location_id=eq.location', {'last_scan': 'now'})
        self.assertEqual(store.planned_writes, 2)
    def test_invalid_provider_identity_fails_before_write(self):
        store = MemoryStore()
        with patch.object(inbox, 'ghl', return_value={'messages': [{'dateAdded': '2026-10-01T11:00:00Z', 'direction': 'outbound', 'body': 'text', 'status': 'delivered'}]}):
            with self.assertRaises(ValueError):
                inbox.pull_thread(store, 'fixture', 'location', {'id': 'thread', 'contactId': 'contact'}, datetime(2026, 9, 20, tzinfo=timezone.utc))
        self.assertEqual(store.tables['wa_messages'], [])


if __name__ == '__main__':
    unittest.main()
