"""Native monitor boundaries. No network or provider writes."""
import unittest
from checks import native
from guard.context import Context
from guard.model import FAIL, OK
from tests import fakes


def snapshot():
    return {"version": 1, "checked_at": fakes.ago(0), "checks": [
        {"key": key, "name": key, "ok": True, "error": None, "at": fakes.ago(0), "max_age_min": 45}
        for key in native.REQUIRED_CHECKS]}


def context(value):
    return Context(fakes.config(Path(tempfile.gettempdir())/'guardian-native-test'), fakes.FakeDb({"cockpit_native_monitor_state": [{"snapshot": value}]}), None, now=fakes.NOW)


class Native(unittest.TestCase):
    def test_existing_monitor_contract_accepts_idle_queues_without_claiming_job_workers(self):
        value = snapshot()
        for row in value['checks']:
            if row['key'].startswith('queue:') or row['key']=='catalog:native':
                row.update(at=None,max_age_min=None)
        result=native.run_native(context(value))
        self.assertEqual(result.status,OK)
        self.assertIn('activation',result.summary.lower())
        value['checks']=[r for r in value['checks'] if r['key']!='worker:media-core']
        self.assertEqual(native.run_native(context(value)).status,FAIL)

    def test_an_additional_failed_provider_receipt_is_not_ignored(self):
        value=snapshot()
        value['checks'].append(dict(key='source:provider:fixture',ok=False,at=None,max_age_min=None))
        self.assertEqual(native.run_native(context(value)).status,FAIL)

    def test_malformed_summary_key_fails_without_a_parser_exception(self):
        value=snapshot()
        value['checks'].append(dict(key=['not-a-key'],ok=True,at=None,max_age_min=None))
        self.assertEqual(native.run_native(context(value)).status,FAIL)

    def test_a_producer_cannot_remove_its_freshness_requirement(self):
        value=snapshot()
        worker=next(r for r in value['checks'] if r['key']=='worker:media-core')
        worker.update(at=None,max_age_min=None)
        self.assertEqual(native.run_native(context(value)).status,FAIL)

    def test_existing_media_publication_window_is_90_minutes(self):
        value=snapshot()
        worker=next(r for r in value['checks'] if r['key']=='worker:media-core')
        worker.update(at=fakes.ago(80),max_age_min=90)
        self.assertEqual(native.run_native(context(value)).status,OK)
        worker['at']=fakes.ago(91)
        self.assertEqual(native.run_native(context(value)).status,FAIL)

    def test_missing_producer_fails_even_with_fresh_sections(self):
        value = snapshot()
        value["checks"] = [c for c in value["checks"] if c["key"] != "worker:media-core"]
        self.assertEqual(native.run_native(context(value)).status, FAIL)

    def test_boundary_and_future_timestamp(self):
        value = snapshot()
        value["checks"][0]["at"] = fakes.ago(45)
        self.assertEqual(native.run_native(context(value)).status, OK)
        value["checks"][0]["at"] = fakes.ago(45.001)
        self.assertEqual(native.run_native(context(value)).status, FAIL)
        value["checks"][0]["at"] = fakes.ago(-2)
        self.assertEqual(native.run_native(context(value)).status, FAIL)

    def test_failed_doctor_is_not_a_fresh_success(self):
        value = snapshot()
        value["checks"][0]["ok"] = False
        self.assertEqual(native.run_native(context(value)).status, FAIL)

    def test_absent_migration_and_empty_summary_fail(self):
        ctx = Context(fakes.config(Path(tempfile.gettempdir())/'guardian-native-test'), fakes.FakeDb(missing=("cockpit_native_monitor_state",)), None, now=fakes.NOW)
        self.assertEqual(native.run_native(ctx).status, FAIL)
        value = snapshot(); value["checks"] = []
        self.assertEqual(native.run_native(context(value)).status, FAIL)

    def test_native_outage_is_urgent_without_legacy_alert_suppression(self):
        check = native.CHECKS[0]
        self.assertTrue(check.urgent)
        self.assertIsNone(check.quiet_because)
        self.assertEqual(check.confirm, 2)

if __name__ == '__main__':
    unittest.main()


import unittest
import tempfile
from pathlib import Path
from datetime import timedelta
from checks import native, all_checks
from guard.model import OK, FAIL, UNKNOWN
from tests import fakes

def fixture():
    stamp=fakes.NOW.isoformat()
    tables={}
    for family,names in native.EXPECTED.items():
        tables['cockpit_'+family+'_source_state']=[dict(table_name=n,ready=True,row_count=0,source_snapshot_at=stamp) for n in names]
        tables['cockpit_'+family+'_sources']=[]
    return tables

class NativeTests(unittest.TestCase):
    def context(self,tables=None,db=None):
        tmp=self.enterContext(tempfile.TemporaryDirectory())
        return fakes.ctx(Path(tmp),db=db or fakes.FakeDb(tables or {}))
    def test_verified_empty_is_distinct_from_missing(self):
        tables=fixture();self.assertEqual(native.run_sources(self.context(tables=tables)).status,OK)
        tables['cockpit_csm_source_state'].pop();self.assertEqual(native.run_sources(self.context(tables=tables)).status,FAIL)

    def test_count_stamp_and_readiness_are_required(self):
        for patch in [dict(source_snapshot_at=None),dict(row_count=None),dict(row_count=True),dict(ready=False),dict(row_count=1)]:
            tables=fixture();tables['cockpit_media_source_state'][0].update(patch)
            self.assertEqual(native.run_sources(self.context(tables=tables)).status,FAIL)

    def test_database_failure_is_unknown(self):
        ctx=self.context(db=fakes.FakeDb(down=True));self.assertEqual(native.run_sources(ctx).status,UNKNOWN)

    def test_no_producer_receipt_is_not_a_running_worker(self):
        self.assertNotEqual(native.run_producer(self.context(tables={'cockpit_native_media_runs':[]})).status,OK)

    def test_only_a_recent_published_run_is_evidence(self):
        tables={'cockpit_native_media_runs':[dict(status='published',published_at=fakes.NOW.isoformat())]}
        self.assertEqual(native.run_producer(self.context(tables=tables)).status,OK)
        tables['cockpit_native_media_runs'][0]['published_at']=(fakes.NOW-timedelta(hours=2)).isoformat()
        self.assertNotEqual(native.run_producer(self.context(tables=tables)).status,OK)

    def test_source_producer_matches_the_authoritative_90_minute_window(self):
        tables={'cockpit_native_media_runs':[dict(status='published',published_at=(fakes.NOW-timedelta(minutes=80)).isoformat())]}
        self.assertEqual(native.run_producer(self.context(tables=tables)).status,OK)

    def test_native_mode_omits_only_convex_checks(self):
        hybrid={c.id for c in all_checks()};selected={c.id for c in all_checks('native')}
        self.assertIn('native-source-readiness',selected);self.assertIn('native-source-producer',selected)
        self.assertEqual(hybrid-selected,{c.id for c in __import__('checks.convex',fromlist=['CHECKS']).CHECKS})
        with self.assertRaises(ValueError):all_checks('typo')
