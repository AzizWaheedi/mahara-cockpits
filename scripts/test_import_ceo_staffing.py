"""Scoped staffing restoration contract; never writes to production in tests."""
import importlib.util
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

MODULE = Path(__file__).with_name('import-ceo-staffing.py')
SPEC = importlib.util.spec_from_file_location('staffing_import', MODULE)


def importer():
    module = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(module)
    return module


class StaffingImportTests(unittest.TestCase):
    def setUp(self):
        self.mod = importer()
        self.archive = Path('/opt/data/backups/cockpit-runtime-private/ceo-staffing-current-prod-1791461734394759922.zip')
        self.manifest = self.archive.with_name('ceo-staffing-current-prod-manifest.json')

    def test_exact_archive_yields_only_staffing_statuses_and_matching_audits(self):
        payload = self.mod.prepare(self.archive, self.manifest)
        self.assertEqual(len(payload['statuses']), 3)
        self.assertEqual(len(payload['audits']), 5)
        self.assertEqual({r['action'] for r in payload['audits']}, {'teamStatus.set'})
        self.assertEqual({r['rowId'] for r in payload['audits']}, {r['personKey'] for r in payload['statuses']})
        self.assertEqual(payload['source_sha256'], self.mod.EXPECTED_SHA256)
        self.assertNotIn('history_ready', json.dumps(payload))

    def test_tampered_manifest_or_archive_rejected(self):
        manifest = json.loads(self.manifest.read_text())
        manifest['snapshots'][0]['tables']['ceoAudit'] = 4
        with TemporaryDirectory() as tmp:
            path = Path(tmp) / 'manifest.json'
            path.write_text(json.dumps(manifest))
            with self.assertRaises(ValueError):
                self.mod.prepare(self.archive, path)
            path.write_text(self.manifest.read_text())
            with self.assertRaises(ValueError):
                self.mod.prepare(path, path)

    def test_missing_or_unmatched_audit_rejected_before_network(self):
        payload = self.mod.prepare(self.archive, self.manifest)
        payload['audits'].pop()
        with self.assertRaises(ValueError):
            self.mod.validate(payload)
        payload = self.mod.prepare(self.archive, self.manifest)
        payload['audits'][0]['rowId'] = 'sales_rep:unknown'
        with self.assertRaises(ValueError):
            self.mod.validate(payload)

    def test_source_payload_has_unique_exact_ids_and_final_audit_state(self):
        payload = self.mod.prepare(self.archive, self.manifest)
        self.assertEqual(len({r['_id'] for r in payload['statuses']}), 3)
        self.assertEqual(len({r['_id'] for r in payload['audits']}), 5)
        for status in payload['statuses']:
            last = max((a for a in payload['audits'] if a['rowId'] == status['personKey']), key=lambda a: a['at'])
            self.assertEqual(last['after'], {k: status[k] for k in ('personKey', 'status', 'since', 'setBy', 'setAt') if k in status} | ({'note': status['note']} if 'note' in status else {}))

    def test_readback_accepts_original_status_without_optional_note(self):
        from unittest.mock import patch
        from datetime import datetime, timezone
        payload = self.mod.prepare(self.archive, self.manifest)
        statuses = [dict(person_key=s['personKey'], status=s['status'], since=s['since'], note=s.get('note'), set_by=s['setBy'],
                         set_at=datetime.fromtimestamp(s['setAt']/1000, timezone.utc).isoformat(),
                         source_deployment=payload['deployment'], source_id=s['_id'], source_record=s) for s in payload['statuses']]
        audits = [dict(id=f'audit-{n}', action=a['action'], entity_type='cockpit_team_status', entity_id=a['rowId'], actor_email=a['by'],
                       source_app='media-buyer', source_system='convex', before=a.get('before'), after=a['after'],
                       created_at=datetime.fromtimestamp(a['at']/1000, timezone.utc).isoformat(),
                       metadata={'source_table':'ceoAudit', 'source_deployment':payload['deployment'], 'source_id':a['_id'], 'source_record':a}) for n,a in enumerate(payload['audits'])]
        with patch.object(self.mod, 'request', side_effect=[statuses, audits, [{'history_ready':False}]]) as request:
            result = self.mod.readback('https://example.test', 'not-real', payload)
        self.assertEqual(result['statuses'], 3)
        self.assertEqual(result['source_audits'], 5)
        self.assertEqual(request.call_count, 3)
        self.assertIn('entity_type=eq.cockpit_team_status', request.call_args_list[1].args[0])
        self.assertIn('metadata-%3E%3Esource_deployment=eq.', request.call_args_list[1].args[0])

    def test_readback_rejects_changed_audit_timestamp(self):
        from unittest.mock import patch
        from datetime import datetime, timezone
        payload = self.mod.prepare(self.archive, self.manifest)
        statuses = [dict(person_key=s['personKey'], status=s['status'], since=s['since'], note=s.get('note'), set_by=s['setBy'],
                         set_at=datetime.fromtimestamp(s['setAt']/1000, timezone.utc).isoformat(), source_deployment=payload['deployment'], source_id=s['_id'], source_record=s) for s in payload['statuses']]
        audits = [dict(id=f'audit-{n}', action=a['action'], entity_type='cockpit_team_status', entity_id=a['rowId'], actor_email=a['by'],
                       source_app='media-buyer', source_system='convex', before=a.get('before'), after=a['after'],
                       created_at='2000-01-01T00:00:00Z', metadata={'source_table':'ceoAudit', 'source_deployment':payload['deployment'], 'source_id':a['_id'], 'source_record':a}) for n,a in enumerate(payload['audits'])]
        with patch.object(self.mod, 'request', side_effect=[statuses, audits, [{'history_ready':False}]]) as request:
            with self.assertRaisesRegex(RuntimeError, 'audit mismatch'):
                self.mod.readback('https://example.test', 'not-real', payload)
        self.assertEqual(request.call_count, 2)

    def test_sql_is_scoped_guarded_and_does_not_mark_history_ready(self):
        sql = MODULE.parents[1].joinpath('supabase/migrations/20261008g_cockpit_ceo_staffing_import.sql').read_text()
        self.assertIn('SECURITY DEFINER', sql)
        self.assertIn('REVOKE ALL ON FUNCTION', sql)
        self.assertIn('GRANT EXECUTE ON FUNCTION', sql)
        self.assertIn('TO service_role', sql)
        self.assertIn('FOR UPDATE', sql)
        self.assertIn('cockpit_original_audit_source_identity', sql)
        self.assertNotIn('history_ready=true', sql.replace(' ', '').lower())
        self.assertNotIn('cockpit_native_bootstrap_inventory', sql)

    def test_import_does_not_lock_busy_audit_table(self):
        sql = MODULE.parents[1].joinpath('supabase/migrations/20261008g_cockpit_ceo_staffing_import.sql').read_text()
        import re
        self.assertIsNone(re.search(r'LOCK TABLE[^;]*cockpit_audit_log', sql, re.I))

    def test_credentials_select_explicit_cockpit_project_not_generic_supabase(self):
        from unittest.mock import patch
        with patch.dict('os.environ', {'SUPABASE_URL':'https://another-project.supabase.co',
                                      'SUPABASE_SERVICE_ROLE_KEY':'wrong-key',
                                      'COCKPIT_SUPABASE_URL':'https://bldgtotkfmhoxmlzowdx.supabase.co',
                                      'COCKPIT_SUPABASE_KEY':'cockpit-key'}, clear=True):
            self.assertEqual(self.mod.production_credentials(),
                             ('https://bldgtotkfmhoxmlzowdx.supabase.co','cockpit-key'))


if __name__ == '__main__':
    unittest.main()
