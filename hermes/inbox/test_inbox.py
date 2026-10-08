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

class MainStore:
    apply = True
    def __init__(self):
        self.watermark = '2026-10-07T12:00:00+00:00'
        self.patches = []
        self.queries = []
        self.drafts = {}
        self.waiting = [
            {'id':'legacy','contact_name':'Old client','is_group':False,'last_inbound_at':'2026-09-21T10:00:00+00:00'},
            {'id':'thread','contact_name':'Client','is_group':False,'last_inbound_at':'2026-10-08T10:00:00+00:00'},
        ]
    def get(self, path):
        self.queries.append(path)
        if path.startswith('wa_state?'): return [{'scan_since':self.watermark}]
        if path.startswith('cockpit_wa_connections?'): return [{'enabled':True,'location_id':'location'}]
        if path.startswith('wa_threads?'):
            value=next((part.split('=',1)[1].removeprefix('gte.') for part in path.split('&') if part.startswith('last_inbound_at=gte.')),None)
            if value is not None:
                from urllib.parse import unquote
                cutoff=datetime.fromisoformat(unquote(value))
                rows=[row for row in self.waiting if datetime.fromisoformat(row['last_inbound_at'])>=cutoff]
            else: rows=self.waiting
            params=dict(part.split('=',1) for part in path.split('?',1)[1].split('&') if '=' in part)
            offset=int(params.get('offset','0'));limit=int(params.get('limit',str(len(rows))))
            return rows[offset:offset+limit]
        if path.startswith('wa_drafts?'):
            thread_id=path.split('thread_id=eq.',1)[1]
            return [{'drafted_at':self.drafts[thread_id]}] if thread_id in self.drafts else []
        return []
    def patch(self, path, body):
        self.patches.append((path,body))
        if 'scan_since' in body: self.watermark=body['scan_since']

class ObserveStore:
    def __init__(self, current=None, intents=None):
        self.current=current;self.intents=intents if intents is not None else [self.intent()];self.queries=[];self.patches=[]
    @staticmethod
    def intent():
        return {'id':'intent','thread_id':'thread','provider_message_id':'message','context':{'locationId':'location','contactId':'contact','providerId':'provider'}}
    def get(self,path):
        self.queries.append(path)
        if path.startswith('cockpit_wa_reply_intents?'): return self.intents
        if path.startswith('wa_messages?'): return [{'delivery_status':self.current}]
        return []
    def patch(self,path,body): self.patches.append((path,body))

class InboxDeliveryTests(unittest.TestCase):
    def pull(self, status, direction='outbound', at='2026-10-01T11:00:00Z'):
        store = MemoryStore()
        message = {'id': 'real-message', 'dateAdded': at, 'direction': direction, 'body': 'Actual provider text', 'status': status, 'messageType':'TYPE_CUSTOM_SMS'}
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
        with patch.object(inbox, 'ghl', return_value={'messages': [{'dateAdded': '2026-10-01T11:00:00Z', 'direction': 'outbound', 'body': 'text', 'status': 'delivered', 'messageType':'TYPE_CUSTOM_SMS'}]}):
            with self.assertRaises(ValueError):
                inbox.pull_thread(store, 'fixture', 'location', {'id': 'thread', 'contactId': 'contact'}, datetime(2026, 9, 20, tzinfo=timezone.utc))
        self.assertEqual(store.tables['wa_messages'], [])

class InboxMessageTypeTests(unittest.TestCase):
    def test_unfiltered_pages_are_locally_filtered_and_cursor_uses_raw_page(self):
        pages=[
            {'messages':[{'id':'wa-1','dateAdded':'2026-10-01T10:00:00Z','messageType':'TYPE_CUSTOM_SMS'},
                         {'id':'email-raw-last','dateAdded':'2026-10-01T10:01:00Z','messageType':'TYPE_EMAIL'}],'nextPage':True},
            {'messages':[{'id':'wa-2','dateAdded':'2026-10-01T10:02:00Z','messageType':'TYPE_CUSTOM_SMS'}],'nextPage':False},
        ]
        requests=[]
        def provider(path,*args,**kwargs):
            requests.append(path)
            return {'messages':pages.pop(0)}
        with patch.object(inbox,'ghl',side_effect=provider):
            result=inbox.messages_since(MemoryStore(),'fixture','thread',datetime(2026,9,20,tzinfo=timezone.utc))
        self.assertEqual([row['id'] for row in result],['wa-1','wa-2'])
        self.assertTrue(all('type=' not in path for path in requests))
        self.assertIn('lastMessageId=email-raw-last',requests[1])

    def test_pull_thread_never_publishes_sms_or_email_messages(self):
        store=MemoryStore()
        messages=[
            {'id':'wa','dateAdded':'2026-10-01T11:00:00Z','direction':'inbound','body':'WhatsApp','messageType':'TYPE_CUSTOM_SMS'},
            {'id':'sms','dateAdded':'2026-10-01T11:01:00Z','direction':'inbound','body':'SMS','messageType':'TYPE_SMS'},
            {'id':'email','dateAdded':'2026-10-01T11:02:00Z','direction':'inbound','body':'Email','messageType':'TYPE_EMAIL'},
        ]
        with patch.object(inbox,'ghl',return_value={'messages':{'messages':messages,'nextPage':False}}):
            inbox.pull_thread(store,'fixture','location',{'id':'thread','contactId':'contact'},datetime(2026,9,20,tzinfo=timezone.utc))
        self.assertEqual([row['id'] for row in store.tables['wa_messages']],['wa'])

    def test_missing_or_invalid_message_type_fails_before_publication(self):
        for value in (None, '', 7):
            with self.subTest(message_type=value):
                store=MemoryStore()
                message={'id':'unknown','dateAdded':'2026-10-01T11:00:00Z','direction':'inbound','body':'Unknown type'}
                if value is not None: message['messageType']=value
                with patch.object(inbox,'ghl',return_value={'messages':{'messages':[message],'nextPage':False}}):
                    with self.assertRaises(ValueError):
                        inbox.pull_thread(store,'fixture','location',{'id':'thread','contactId':'contact'},datetime(2026,9,20,tzinfo=timezone.utc))
                self.assertEqual(store.tables['wa_messages'],[])

class InboxScanTests(unittest.TestCase):
    def test_explicit_recent_cutoff_overrides_stale_database_watermark(self):
        class Store:
            def get(self,path): return [{'scan_since':'2026-09-20T00:00:00+00:00'}]
        with patch.object(inbox,'ghl',return_value={'conversations':[{'id':'old','lastMessageDate':'2026-09-25T10:00:00Z'}]}), \
             patch.object(inbox,'pull_thread') as pull:
            result=inbox.scan(Store(),'fixture','location','2026-10-07T00:00:00+00:00')
        self.assertEqual(result,(0,0))
        pull.assert_not_called()

    def test_scan_rejects_naive_pre_switch_and_future_cutoffs_before_provider_read(self):
        class Store:
            def get(self,path): raise AssertionError('scan must use its explicit cutoff')
        for cutoff in ('2026-10-07T00:00:00','2026-09-19T23:59:59+00:00','2099-01-01T00:00:00+00:00'):
            with self.subTest(cutoff=cutoff), patch.object(inbox,'ghl') as provider:
                with self.assertRaises(ValueError): inbox.scan(Store(),'fixture','location',cutoff)
                provider.assert_not_called()

class InboxActivationTests(unittest.TestCase):
    def run_main(self, argv, scan_side_effect=None, store=None, draft_side_effect=None):
        store=store or MainStore()
        env={'GHL_MAHARA_PIT':'fixture','GHL_MAHARA_LOCATION':'location','DESK_SUPABASE_URL':'https://bldgtotkfmhoxmlzowdx.supabase.co','DESK_SUPABASE_KEY':'fixture'}
        if '--apply' in argv and '--source-only' not in argv: env['DEEPSEEK_API_KEY']='fixture'
        with patch.dict(inbox.os.environ,env,clear=True), patch.object(inbox.sys,'argv',['inbox.py',*argv]), \
             patch.object(inbox,'Store',return_value=store), patch.object(inbox,'now',return_value='2026-10-08T12:05:00+00:00'), \
             patch.object(inbox,'scan',side_effect=scan_side_effect or (lambda *args:(1,1))) as scan, \
             patch.object(inbox,'observe_submitted') as observe, patch.object(inbox,'draft_for',side_effect=draft_side_effect or (lambda *args:True)) as draft:
            try: code=inbox.main()
            except Exception as error: code=error
        return code,store,scan,observe,draft

    def test_source_only_apply_skips_delivery_observation_and_drafts(self):
        code,store,scan,observe,draft=self.run_main(['--apply','--source-only'])
        self.assertEqual(code,0)
        scan.assert_called_once()
        observe.assert_not_called()
        draft.assert_not_called()
        self.assertEqual(store.patches[0][1]['scan_since'],'2026-10-08T12:05:00+00:00')

    def test_drafting_query_is_restricted_to_the_current_scan_watermark(self):
        code,store,_,observe,draft=self.run_main(['--apply'])
        self.assertEqual(code,0)
        observe.assert_called_once()
        self.assertEqual([call.args[1]['id'] for call in draft.call_args_list],['thread'])
        query=next(path for path in store.queries if path.startswith('wa_threads?'))
        self.assertIn('last_inbound_at=gte.2026-10-07T12%3A00%3A00%2B00%3A00', query)

    def test_failed_scan_does_not_advance_watermark_or_start_drafting(self):
        reason='The conversation scan reached its safety bound. Do not publish a healthy scan'
        error,store,_,observe,draft=self.run_main(['--apply','--source-only'],ValueError(reason))
        self.assertIsInstance(error,ValueError)
        self.assertEqual(str(error),reason)
        self.assertEqual(store.patches,[])
        observe.assert_not_called()
        draft.assert_not_called()

    def test_failed_draft_returns_nonzero_without_advancing_watermark(self):
        store=MainStore()
        env={'GHL_MAHARA_PIT':'fixture','GHL_MAHARA_LOCATION':'location','DESK_SUPABASE_URL':'https://bldgtotkfmhoxmlzowdx.supabase.co','DESK_SUPABASE_KEY':'fixture','DEEPSEEK_API_KEY':'fixture'}
        with patch.dict(inbox.os.environ,env,clear=True), patch.object(inbox.sys,'argv',['inbox.py','--apply']), \
             patch.object(inbox,'Store',return_value=store), patch.object(inbox,'now',return_value='2026-10-08T12:05:00+00:00'), \
             patch.object(inbox,'scan',return_value=(1,1)), patch.object(inbox,'observe_submitted',return_value=0), \
             patch.object(inbox,'draft_for',side_effect=RuntimeError('model unavailable')):
            result=inbox.main()
        self.assertEqual(result,1)
        self.assertEqual(store.patches,[])

    def test_paged_draft_remainder_is_reached_on_retry_without_repeating_successes(self):
        store=MainStore()
        store.waiting=[{'id':f'thread-{i}','contact_name':'Client','is_group':False,'last_inbound_at':'2026-10-08T10:00:00+00:00'} for i in range(141)]
        store.drafts={f'thread-{i}':'2026-10-08T10:00:00+00:00' for i in range(100)}
        def persist(_sb,thread):
            store.drafts[thread['id']]=thread['last_inbound_at']
            return True
        first,_,_,_,first_draft=self.run_main(['--apply'],store=store,draft_side_effect=persist)
        self.assertEqual(first,1)
        self.assertEqual([call.args[1]['id'] for call in first_draft.call_args_list],[f'thread-{i}' for i in range(100,140)])
        self.assertTrue(any('offset=100' in path for path in store.queries))
        self.assertEqual(store.patches,[])
        second,_,_,_,second_draft=self.run_main(['--apply'],store=store,draft_side_effect=persist)
        self.assertEqual(second,0)
        self.assertEqual([call.args[1]['id'] for call in second_draft.call_args_list],['thread-140'])
        self.assertEqual(store.patches[-1][1]['scan_since'],'2026-10-08T12:05:00+00:00')

    def test_waiting_pagination_safety_cap_holds_watermark(self):
        store=MainStore()
        store.waiting=[{'id':f'thread-{i}','contact_name':'Client','is_group':False,'last_inbound_at':'2026-10-08T10:00:00+00:00'} for i in range(2000)]
        store.drafts={thread['id']:thread['last_inbound_at'] for thread in store.waiting}
        result,_,_,_,draft=self.run_main(['--apply'],store=store)
        self.assertEqual(result,1)
        self.assertEqual(draft.call_count,0)
        self.assertEqual(store.patches,[])

class InboxObserveTests(unittest.TestCase):
    def observe(self, current, status, store=None):
        store=store or ObserveStore(current)
        message={'id':'message','conversationId':'thread','locationId':'location','contactId':'contact','conversationProviderId':'provider','direction':'outbound','messageType':'TYPE_CUSTOM_SMS','status':status}
        with patch.object(inbox,'ghl',return_value=message):
            result=inbox.observe_submitted(store,'fixture','location')
        return result,store

    def test_delivery_status_noop_and_terminal_ranks_do_not_patch(self):
        for current,status in [('pending','pending'),('delivered','sent'),('delivered','failed'),('read','delivered')]:
            with self.subTest(current=current,status=status):
                _,store=self.observe(current,status)
                self.assertEqual(store.patches,[])

    def test_delivered_to_read_is_the_only_update_after_delivery(self):
        count,store=self.observe('delivered','read')
        self.assertEqual(count,1)
        self.assertIn('limit=1',store.queries[1])
        self.assertEqual(store.patches[0][1],{'delivery_status':'read'})
        self.assertIn('delivery_status=eq.delivered',store.patches[0][0])

    def test_null_delivery_status_uses_a_conditional_null_filter(self):
        count,store=self.observe(None,'sent')
        self.assertEqual(count,1)
        self.assertIn('delivery_status=is.null',store.patches[0][0])

    def test_accepted_intent_query_is_location_scoped_and_capped(self):
        store=ObserveStore(intents=[])
        result,_=self.observe(None,'delivered',store)
        self.assertEqual(result,0)
        query=store.queries[0]
        self.assertIn('context-%3E%3ElocationId=eq.location',query)
        self.assertIn('limit=201',query)

    def test_observation_read_fails_closed_when_intent_cap_is_hit(self):
        store=ObserveStore(intents=[ObserveStore.intent() for _ in range(201)])
        with self.assertRaisesRegex(ValueError,'safety bound'):
            inbox.observe_submitted(store,'fixture','location')
        self.assertEqual(store.patches,[])


if __name__ == '__main__':
    unittest.main()
