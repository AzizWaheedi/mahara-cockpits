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
        def persist(_sb,thread,_team=()):
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

TEAM = ['Rasem Abdel Al', 'Nada Ali', 'Sabry Hassan', 'Ahmed Fathy', 'Daniya Saleh']

def wa(direction, speaker, minute, body='Text', delivery_status=None):
    return {'direction': direction, 'speaker': speaker, 'at': f'2026-10-01T11:{minute:02d}:00+00:00',
            'body': body, 'kind': 'text', 'delivery_status': delivery_status}

class DraftStore:
    apply = True
    def __init__(self, messages):
        self.messages = messages; self.saved = []
    def get(self, path):
        # The worker asks newest first.
        return list(reversed(self.messages)) if path.startswith('wa_messages?') else []
    def save_draft(self, thread, previous_drafted_at, draft):
        self.saved.append(draft); return [{'thread_id': thread['id']}]

class TeamStore(MainStore):
    def __init__(self, fail=False):
        super().__init__(); self.fail = fail
    def get(self, path):
        if path.startswith(('cockpit_people?', 'cockpit_members?')):
            self.queries.append(path)
            if self.fail: raise inbox.urllib.error.URLError('unreachable')
            if path.startswith('cockpit_people?'): return [{'name': 'Rasem Abdel All'}, {'name': ' Nada  Al Saed '}]
            return [{'name': 'Rasem Abdel All'}, {'name': None}]
        return super().get(path)

class InboxTeamTests(unittest.TestCase):
    """The rule is the cockpit's teamSpeaker and clientWaiting (clientBrief.ts)."""

    def test_the_team_is_told_apart_from_the_clients_people_by_name(self):
        for speaker in ('Rasem Abdel all', 'Nada | MaharaMedia', 'Karim@Maharamedia', 'Sabry', 'DANIYA', 'دانيا', 'مهارة'):
            with self.subTest(speaker=speaker):
                self.assertTrue(inbox.team_speaker(speaker, TEAM))
        # A client contact who shares a team member's first name is the client.
        for speaker in ('Ahmed Salama', 'Malak Rahal', 'M', None, '', 'Fathy Ahmed'):
            with self.subTest(speaker=speaker):
                self.assertFalse(inbox.team_speaker(speaker, TEAM))

    def test_a_one_letter_name_is_never_the_team(self):
        # "Mo" reduces to "m" too, so only the length rule keeps "M" out.
        self.assertFalse(inbox.team_speaker('M', TEAM + ['Mo Salah']))

    def test_a_lone_name_matches_letter_for_letter_never_by_consonants(self):
        roster = ['Ahmed Sabry', 'Abdulaziz Waheedi', 'Maria Lopez']
        self.assertTrue(inbox.team_speaker('Sabry', roster))
        self.assertTrue(inbox.team_speaker('Aziz', roster))
        # "Umar" and "Maria" share their consonants; a client named Umar is not the team.
        self.assertFalse(inbox.team_speaker('Umar', roster))
        self.assertFalse(inbox.team_speaker('Mo', roster))

    def test_markdown_in_a_name_is_read_the_way_the_cockpit_cleans_it(self):
        for speaker in ('Maha`ra', 'Ma**hara'):
            with self.subTest(speaker=speaker):
                self.assertTrue(inbox.team_speaker(speaker, []))
                self.assertTrue(inbox.team_speaker(speaker, TEAM))
        self.assertTrue(inbox.team_speaker('[Nada](https://x.y)', TEAM))
        self.assertFalse(inbox.team_speaker('[Nada](https://x.y)', []))
        self.assertFalse(inbox.team_speaker('[Team](https://mahara.com)', TEAM))
        self.assertTrue(inbox.team_speaker('Nada', ['Na**da Ali']))

    def test_without_team_names_only_a_mahara_name_is_the_team(self):
        self.assertTrue(inbox.team_speaker('Muhammed | MaharaMedia', []))
        self.assertFalse(inbox.team_speaker('Rasem Abdel all', []))
        self.assertFalse(inbox.team_speaker('Sabry', []))

    def test_a_chat_waits_on_us_only_when_the_client_wrote_last_not_a_team_member(self):
        self.assertIsNone(inbox.client_waiting([wa('inbound', 'Malak Rahal', 1), wa('inbound', 'Rasem Abdel all', 2)], TEAM))
        self.assertEqual(inbox.client_waiting([wa('inbound', 'Rasem Abdel all', 1), wa('inbound', 'Malak Rahal', 2)], TEAM)['at'],
                         '2026-10-01T11:02:00+00:00')
        self.assertIsNone(inbox.client_waiting([wa('inbound', None, 1), wa('outbound', None, 2)], TEAM))
        self.assertEqual(inbox.client_waiting([wa('outbound', None, 1), wa('inbound', None, 2)], TEAM)['at'],
                         '2026-10-01T11:02:00+00:00')

    def pull_group(self, speakers, team=TEAM):
        store = MemoryStore()
        messages = [{'id': f'm{i}', 'dateAdded': f'2026-10-01T11:0{i}:00Z', 'direction': 'inbound',
                     'body': f'👤 {name} (+96500000000)\n\nText', 'messageType': 'TYPE_CUSTOM_SMS'}
                    for i, name in enumerate(speakers)]
        with patch.object(inbox, 'ghl', return_value={'messages': {'messages': messages, 'nextPage': False}}):
            inbox.pull_thread(store, 'fixture', 'location', {'id': 'thread', 'contactId': 'contact', 'fullName': 'Group', 'phone': '+86123'},
                              datetime(2026, 9, 20, tzinfo=timezone.utc), team)
        return store.tables['wa_threads'][0]

    def test_a_team_member_writing_last_in_a_group_is_not_waiting_on_us(self):
        thread = self.pull_group(['Malak Rahal', 'Rasem Abdel all'])
        self.assertFalse(thread['awaiting_us'])
        self.assertEqual(thread['last_inbound_at'], '2026-10-01T11:00:00+00:00')
        self.assertEqual(thread['last_outbound_at'], '2026-10-01T11:01:00+00:00')

    def test_the_client_writing_after_a_team_member_is_waiting_on_us(self):
        thread = self.pull_group(['Sabry', 'Ahmed Salama'])
        self.assertTrue(thread['awaiting_us'])
        self.assertEqual(thread['last_inbound_at'], '2026-10-01T11:01:00+00:00')

    def test_without_team_names_a_plain_team_name_still_reads_as_the_client(self):
        self.assertTrue(self.pull_group(['Malak Rahal', 'Rasem Abdel all'], team=())['awaiting_us'])
        self.assertFalse(self.pull_group(['Malak Rahal', 'Nada | MaharaMedia'], team=())['awaiting_us'])

    def test_no_draft_when_a_team_member_wrote_last(self):
        store = DraftStore([wa('inbound', 'Malak Rahal', 1, 'When is the shoot?'), wa('inbound', 'Rasem Abdel all', 2, 'Thursday.')])
        with patch.object(inbox, 'deepseek', side_effect=AssertionError('no model call')):
            self.assertFalse(inbox.draft_for(store, {'id': 'thread', 'is_group': True}, TEAM))
        self.assertEqual(store.saved, [])

    def test_the_draft_answers_the_clients_people_and_shows_the_team_as_us(self):
        store = DraftStore([wa('inbound', 'Rasem Abdel all', 1, 'The shoot is Thursday.'), wa('inbound', 'Malak Rahal', 2, 'Which time?')])
        with patch.object(inbox, 'deepseek', return_value='{"ar": "الساعة ١٠", "en": "At 10.", "why": "Shoot time"}') as model:
            self.assertTrue(inbox.draft_for(store, {'id': 'thread', 'is_group': True}, TEAM))
        prompt = model.call_args.args[2]
        self.assertIn('US (Rasem Abdel all): The shoot is Thursday.', prompt)
        self.assertIn('Malak Rahal: Which time?', prompt)
        self.assertEqual(store.saved[0]['based_on'], 'Which time?')

    def test_a_delivered_reply_answers_the_client_and_a_pending_one_does_not(self):
        for status, drafted in (('delivered', False), ('read', False), ('pending', True), (None, True)):
            with self.subTest(status=status):
                store = DraftStore([wa('inbound', 'Malak Rahal', 1, 'Which time?'), wa('outbound', None, 2, 'At 10.', status)])
                with patch.object(inbox, 'deepseek', return_value='{"ar": "تمام", "en": "Done.", "why": "x"}'):
                    self.assertEqual(inbox.draft_for(store, {'id': 'thread', 'is_group': True}, TEAM), drafted)

class InboxTeamRunTests(unittest.TestCase):
    run_main = InboxActivationTests.run_main

    def test_the_run_reads_the_team_and_hands_it_to_the_scan_and_the_drafts(self):
        with patch.object(inbox, 'note') as note:
            code, store, scan, _, draft = self.run_main(['--apply'], store=TeamStore())
        self.assertEqual(code, 0)
        self.assertEqual(scan.call_args.args[4], ['Rasem Abdel All', 'Nada Al Saed'])
        self.assertEqual(draft.call_args.args[2], ['Rasem Abdel All', 'Nada Al Saed'])
        self.assertIn('Team names: 2 from cockpit_people and cockpit_members.', [call.args[0] for call in note.call_args_list])
        self.assertTrue(all('name=not.is.null' in path for path in store.queries if path.startswith(('cockpit_people?', 'cockpit_members?'))))

    def test_a_failed_team_read_falls_back_to_the_mahara_rule_and_says_so(self):
        with patch.object(inbox, 'note') as note:
            code, store, scan, _, draft = self.run_main(['--apply'], store=TeamStore(fail=True))
        self.assertEqual(code, 0)
        self.assertEqual(scan.call_args.args[4], [])
        self.assertEqual(draft.call_args.args[2], [])
        self.assertTrue(any('Team names could not be read (URLError). Only a Mahara name counts as the team this run' in call.args[0]
                            for call in note.call_args_list))
        self.assertEqual(store.patches[-1][1]['scan_since'], '2026-10-08T12:05:00+00:00')

    def test_doctor_says_when_there_are_no_team_names(self):
        with patch.object(inbox, 'note') as note:
            code, _, scan, _, _ = self.run_main(['--doctor'])
        self.assertEqual(code, 0)
        scan.assert_not_called()
        self.assertIn('No team names in cockpit_people or cockpit_members. Only a Mahara name counts as the team this run.',
                      [call.args[0] for call in note.call_args_list])

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
