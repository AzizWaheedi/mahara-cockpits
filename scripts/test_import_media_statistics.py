import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec=importlib.util.spec_from_file_location("media_import",Path(__file__).with_name("import-media-statistics.py"))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class FakeApi:
    def __init__(self):
        self.tables={t:[] for t in m.TABLES.values()};self.writes=[];self.states={};self.corrupt=False
    def rows(self,t):return copy.deepcopy(sorted(self.tables[t],key=lambda r:r['source_id']))
    def insert(self,t,rows):
        self.writes.append((t,len(rows)));self.tables[t].extend(copy.deepcopy(rows))
        if self.corrupt:self.tables[t][-1]['data']['spend']=999
    def state(self,feed,ready,count,snapshot_at):self.states[feed]=ready
    def verify(self,t,rows):
        return {'matched':sum(r in self.tables[t] for r in rows),'total':len(self.tables[t])}

class ImportTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
        self.snapshot=self.root/'snapshot.zip';self.planpath=self.root/'plan.json';self.api=FakeApi()
        daily=[{'_id':str(i),'campaignName':'A','date':'2026-09-01','spend':10,'leads':1,'impressions':1000,'linkClicks':50} for i in range(3)]
        with zipfile.ZipFile(self.snapshot,'w') as z:
            z.writestr('dailyStats/documents.jsonl','\n'.join(json.dumps(x) for x in daily))
            z.writestr('bookingEvents/documents.jsonl',json.dumps({'_id':'b','campaignName':'A','date':'2026-09-01','status':'showed'}))
    def save(self):
        p=m.plan(self.snapshot,self.api,'2026-09-01T00:00:00Z');self.planpath.write_text(json.dumps(p),encoding='utf8');return m.digest(self.planpath)
    def test_dry_run_no_writes_and_full_readback(self):
        h=self.save();self.assertEqual(self.api.writes,[])
        result=m.apply(self.planpath,h,self.api)
        self.assertEqual(result['live_writes'],4);self.assertEqual(self.api.writes[:2],[(m.TABLES['dailyStats'],1),(m.TABLES['dailyStats'],2)])
        self.assertTrue(all(self.api.states.values()))
    def test_corrupt_canary_stops_remaining_writes(self):
        h=self.save();self.api.corrupt=True
        with self.assertRaises(ValueError):m.apply(self.planpath,h,self.api)
        self.assertEqual(len(self.api.writes),1);self.assertFalse(self.api.states['dailyStats'])
    def test_hash_source_and_target_changes_refuse_before_writes(self):
        h=self.save()
        with self.assertRaises(ValueError):m.apply(self.planpath,'0'*64,self.api)
        self.api.tables[m.TABLES['dailyStats']]=m.source_rows(self.snapshot)[m.TABLES['dailyStats']][:1]
        with self.assertRaises(ValueError):m.apply(self.planpath,h,self.api)
        self.assertEqual(self.api.writes,[])
    def test_existing_changed_records_are_never_overwritten(self):
        rows=m.source_rows(self.snapshot)[m.TABLES['dailyStats']]
        altered=copy.deepcopy(rows[0]);altered['data']['spend']=123
        with self.assertRaises(ValueError):m.compare(rows,[altered])
        self.assertEqual(altered['data']['spend'],123)
    def test_missing_source_table_is_not_empty_history(self):
        with zipfile.ZipFile(self.snapshot,'w') as z:z.writestr('dailyStats/documents.jsonl','')
        with self.assertRaises(ValueError):m.source_rows(self.snapshot)
    def test_plan_bound_to_destination_and_export_time(self):
        h=self.save();p=json.loads(self.planpath.read_text());p['project_url']='https://wrong.invalid';self.planpath.write_text(json.dumps(p))
        with self.assertRaises(ValueError):m.apply(self.planpath,m.digest(self.planpath),self.api)
        with self.assertRaises(ValueError):m.plan(self.snapshot,self.api,'2026-09-01')
    def test_finalize_after_interrupted_readback_never_replays_record_writes(self):
        h=self.save();self.api.tables=m.source_rows(self.snapshot)
        result=m.finalize(self.planpath,h,self.api)
        self.assertEqual(result['record_writes'],0);self.assertEqual(self.api.writes,[])
        self.assertTrue(all(self.api.states.values()))
        self.api.tables[m.TABLES['dailyStats']][0]['data']['spend']=99;self.api.states={}
        with self.assertRaises(ValueError):m.finalize(self.planpath,h,self.api)
        self.assertEqual(self.api.states,{})

if __name__=='__main__':unittest.main()
