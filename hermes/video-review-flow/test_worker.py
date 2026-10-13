import copy, importlib.util, json, pathlib, tempfile, unittest
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('video_worker',pathlib.Path(__file__).with_name('worker.py'));w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)

def task(status='internal review',url='https://example.com/cut.mp4'):
 return {'id':'v1','name':'Video <@everyone>','list':{'id':w.VIDEO_LIST},'parent':None,'archived':False,'status':{'status':status,'type':'custom'},'custom_fields':[{'id':w.CUT_FIELD,'value':url}]}
class API:
 def __init__(self,t):self.t=t;self.sent=[];self.comments=[];self.changes=[];self.fail=None;self.receipt=None;self.link_data={'token':'token','flow_task_id':'v1','flow_source_url':'https://example.com/cut.mp4','flow_ready_at':'today','revoked':False,'expires_at':None}
 def task(self,id):return copy.deepcopy(self.t)
 def roles(self,role,client=None):return ['UCSM' if role=='csm' else 'UCD' if role=='creative' else 'UBUYER']
 def send(self,payload):
  self.sent.append(payload)
  if self.fail:raise self.fail
  return '123.456'
 def rows(self,table,query):
  if table=='editor_jobs':return [{'client_task_id':'c1','client':'Client'}]
  if table=='editor_clients':return [{'name':'Client'}]
  if table=='review_items':return [{'decision':'approved','decided_at':'now'}]
  return []
 def link(self,token):return self.link_data
 def valid_link(self,l,t):return w.API.valid_link(self,l,t)
 def find_receipt(self,*args):return self.receipt
 def comment_receipt(self,*args):return self.receipt
 def mutate(self,provider,path,body,method='POST'):
  self.changes.append((provider,path,body,method))
  if provider=='ClickUp' and method=='PUT':self.t['status']['status']=body['status'];return {'id':'v1'}
  if path.endswith('/comment'):
   self.comments.append(body)
   if self.fail:raise self.fail
   return {'id':'comment1'}
  return []
class Tests(unittest.TestCase):
 def setUp(self):self.temp=tempfile.TemporaryDirectory();self.db=w.open_db(pathlib.Path(self.temp.name)/'ledger',True)
 def tearDown(self):self.db.close();self.temp.cleanup()
 def rows(self):return [dict(r) for r in self.db.execute('select * from actions')]
 def phase(self,status):
  t=task(status);w.observe(self.db,[t]);return API(t)
 def test_baseline_is_silent(self):w.observe(self.db,[task()],True);self.assertEqual(self.rows(),[])
 def test_unchanged_phase_is_silent(self):w.observe(self.db,[task()],True);w.observe(self.db,[task()]);self.assertEqual(self.rows(),[])
 def test_internal_review_mentions_both(self):
  api=self.phase('internal review');w.dispatch(self.db,api);self.assertEqual(len(api.sent),1);self.assertEqual(api.sent[0]['channel'],w.CSM);self.assertIn('<@UCSM>',api.sent[0]['text']);self.assertIn('<@UCD>',api.sent[0]['text']);self.assertIn('&lt;@everyone&gt;',api.sent[0]['text'])
 def test_internal_approved_has_exact_prepare_link(self):
  api=self.phase('internal approved');w.dispatch(self.db,api);self.assertIn('videoTask=v1',api.sent[0]['blocks'][1]['elements'][0]['url'])
 def test_client_review_does_not_notify_buyer(self):
  api=self.phase('client review');w.dispatch(self.db,api);self.assertEqual(api.sent,[])
 def test_client_approved_notifies_buyer(self):
  api=self.phase('client approved');w.dispatch(self.db,api);self.assertEqual(api.sent[0]['channel'],w.BUYERS);self.assertIn('<@UBUYER>',api.sent[0]['text']);self.assertIn('after the ad is running',api.sent[0]['text'])
 def test_buyer_scope_uses_client_card_not_first_video_tag(self):
  api=self.phase('client approved');original=api.rows;scopes=[]
  api.rows=lambda table,query: [{'name':'Canonical Client'}] if table=='editor_clients' else original(table,query)
  api.roles=lambda role,client=None: scopes.append((role,client)) or ['UBUYER']
  w.dispatch(self.db,api);self.assertEqual(scopes,[('media_buyer','Canonical Client')]);self.assertEqual(len(api.sent),1)
 def test_missing_client_card_blocks_buyer_alert(self):
  api=self.phase('client approved');original=api.rows
  api.rows=lambda table,query: [] if table=='editor_clients' else original(table,query)
  w.dispatch(self.db,api);self.assertEqual(api.sent,[]);self.assertEqual(self.rows()[0]['state'],'queued')
 def test_subtasks_excluded(self):
  t=task();t['parent']='p';w.observe(self.db,[t]);self.assertEqual(self.rows(),[])
 def test_wrong_list_refused(self):
  t=task();t['list']['id']='other';self.assertRaises(ValueError,w.observe,self.db,[t])
 def test_missing_parent_refused(self):
  t=task();del t['parent'];self.assertRaises(ValueError,w.observe,self.db,[t])
 def test_live_excluded(self):
  t=task('live 🚀');t['status']['type']='done';w.observe(self.db,[t]);self.assertEqual(self.rows(),[])
 def test_changed_cut_realerts_internal_review(self):
  w.observe(self.db,[task()],True);w.observe(self.db,[task(url='https://example.com/v2.mp4')]);self.assertEqual(len(self.rows()),1)
 def test_repeat_scan_no_duplicate(self):
  api=self.phase('internal review');w.dispatch(self.db,api);w.observe(self.db,[api.t]);w.dispatch(self.db,api);self.assertEqual(len(api.sent),1)
 def test_changed_status_before_send_skips(self):
  api=self.phase('internal review');api.t=task('in progress');w.dispatch(self.db,api);self.assertEqual(api.sent,[]);self.assertEqual(self.rows()[0]['state'],'skipped')
 def test_unknown_send_not_repeated(self):
  api=self.phase('internal review');api.fail=w.assignment.ProviderError('Slack','timeout',ambiguous=True);w.dispatch(self.db,api);w.dispatch(self.db,api);self.assertEqual(len(api.sent),1);self.assertEqual(self.rows()[0]['state'],'unknown')
 def test_unknown_send_reconciles(self):
  api=self.phase('internal review');api.fail=w.assignment.ProviderError('Slack','timeout',ambiguous=True);w.dispatch(self.db,api);api.receipt='1.2';w.dispatch(self.db,api);self.assertEqual(self.rows()[0]['state'],'accepted');self.assertEqual(len(api.sent),1)
 def test_history_failure_cannot_requeue_unknown_send(self):
  api=self.phase('internal review');api.fail=w.assignment.ProviderError('Slack','timeout',ambiguous=True);w.dispatch(self.db,api)
  def unavailable(*args):raise ValueError('History unavailable')
  api.find_receipt=unavailable;w.dispatch(self.db,api);w.dispatch(self.db,api);self.assertEqual(self.rows()[0]['state'],'unknown');self.assertEqual(len(api.sent),1)
 def test_approved_video_without_cut_does_not_notify(self):
  api=API(task('client approved',None));w.observe(self.db,[api.t]);w.dispatch(self.db,api);self.assertEqual(api.sent,[])
 def test_rejected_send_is_failed(self):
  api=self.phase('internal review');api.fail=w.assignment.ProviderError('Slack','not_in_channel');w.dispatch(self.db,api);self.assertEqual(self.rows()[0]['state'],'failed')
 def test_newer_cut_invalidates_link(self):self.assertFalse(API(task()).valid_link(API(task()).link_data,task(url='https://example.com/new.mp4')))
 def test_revoked_link_refused(self):
  api=API(task());api.link_data['revoked']=True;self.assertFalse(api.valid_link(api.link_data,api.t))
 def test_missing_ledger_refused(self):self.assertRaises(RuntimeError,w.open_db,pathlib.Path(self.temp.name)/'missing')
 def test_comment_saved_once_without_editor_channel_post(self):
  api=API(task('client review'))
  with self.db:w.enqueue(self.db,'note:1','comment','v1',{'token':'token','who':'Client','note':{'id':1,'body':'غيّروا الشعار','at_seconds':65}})
  w.dispatch(self.db,api);self.assertEqual(len(api.comments),1);self.assertIn('(1:05)',api.comments[0]['comment_text']);self.assertEqual(api.sent,[])
  w.dispatch(self.db,api);self.assertEqual(len(api.comments),1);self.assertEqual(api.sent,[]);self.assertEqual(len(self.rows()),1)
 def test_legacy_queued_feedback_does_not_post(self):
  api=API(task('client review'))
  with self.db:w.enqueue(self.db,'feedback:old','feedback_slack','v1',{'token':'token','text':'Change logo'})
  w.dispatch(self.db,api);self.assertEqual(api.sent,[]);self.assertEqual(self.rows()[0]['state'],'skipped')
 def test_legacy_interrupted_feedback_reconciles_in_original_channel(self):
  api=API(task('cancelled'));channels=[]
  with self.db:
   w.enqueue(self.db,'feedback:old','feedback_slack','v1',{'token':'token','text':'Change logo'})
   self.db.execute("update actions set state='sending',sent_at=123")
  api.find_receipt=lambda channel,*args:channels.append(channel) or None
  w.dispatch(self.db,api);self.assertEqual(self.rows()[0]['state'],'unknown')
  api.find_receipt=lambda channel,*args:channels.append(channel) or '123.456'
  w.dispatch(self.db,api);self.assertEqual(self.rows()[0]['state'],'accepted')
  self.assertEqual(channels,[w.EDITORS,w.EDITORS]);self.assertEqual(api.sent,[])
 def test_legacy_feedback_history_failure_stays_unknown(self):
  api=API(task())
  with self.db:
   w.enqueue(self.db,'feedback:old','feedback_slack','v1',{'token':'token','text':'Change logo'})
   self.db.execute("update actions set state='unknown',sent_at=123")
  def unavailable(*args):raise ValueError('History unavailable')
  api.find_receipt=unavailable;w.dispatch(self.db,api)
  self.assertEqual(self.rows()[0]['state'],'unknown');self.assertEqual(api.sent,[])
 def test_unknown_comment_not_repeated_or_announced(self):
  api=API(task('client review'));api.fail=w.assignment.ProviderError('ClickUp','timeout',ambiguous=True)
  with self.db:w.enqueue(self.db,'note:1','comment','v1',{'token':'token','who':'Client','note':{'id':1,'body':'Change logo','at_seconds':None}})
  w.dispatch(self.db,api);w.dispatch(self.db,api);self.assertEqual(len(api.comments),1);self.assertEqual(api.sent,[])
 def test_approval_updates_clickup_then_comment(self):
  api=API(task('client review'))
  with self.db:w.enqueue(self.db,'decision:1','decision','v1',{'token':'token','who':'Client','item':{'id':'i1','decision':'approved','decided_at':'now'}})
  w.dispatch(self.db,api);self.assertEqual(w.state(api.t),'client approved');self.assertEqual(len(api.comments),1)
 def test_superseded_decision_skipped(self):
  api=API(task('client review'))
  with self.db:w.enqueue(self.db,'decision:old','decision','v1',{'token':'token','who':'Client','item':{'id':'i1','decision':'changes','decided_at':'old'}})
  w.dispatch(self.db,api);self.assertEqual(api.changes,[]);self.assertEqual(self.rows()[0]['state'],'skipped')
 def test_broken_task_does_not_starve_other_tasks(self):
  api=self.phase('internal review')
  with self.db:w.enqueue(self.db,'other','phase','v2',{'phase':'internal review','fingerprint':w.fingerprint(api.t)})
  original=api.task
  def read(id):
   if id=='v1':raise ValueError('Source unavailable')
   t=original(id);t['id']=id;return t
  api.task=read;w.dispatch(self.db,api);self.assertEqual(len(api.sent),1)
if __name__=='__main__':unittest.main()
