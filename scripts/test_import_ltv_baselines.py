"""R4 baseline import contract. Made-up cards and values; SQL goes to a fake, never to production."""
import importlib.util
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

MODULE = Path(__file__).with_name('import-ltv-baselines.py')
SPEC = importlib.util.spec_from_file_location('ltv_import', MODULE)


def importer():
    module = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(module)
    return module


def cid(n):
    return f'sh{n:030d}'


def source(ltv=26, book=True):
    rows = [{'_id': cid(i), '_creationTime': 1.0, 'at': 1789812249685, 'date': '2026-09-19', 'metric': 'money.ltv.card',
             'scope': f'client:86card{i:04d}', 'value': 1000 + i} for i in range(ltv)]
    if rows:
        rows[-1]['date'] = '2026-10-07'
    return {'deployment': 'adorable-seahorse-418', 'source': 'fixture', 'rule': 'earliest per card', 'ltv': rows,
            'book': ([{'_id': cid(900), 'at': 1790525158774, 'date': '2026-09-01', 'metric': 'money.book.projected', 'scope': 'company', 'value': 14332},
                      {'_id': cid(901), 'at': 1790525158774, 'date': '2026-09-01', 'metric': 'money.book.collected', 'scope': 'company', 'value': 4068}] if book else [])}


class FakeSql:
    """Answers the script's SELECTs from fixtures and records every statement."""

    def __init__(self, src, mirror_off=0, stored=None, preview_rows=None, gates=None):
        self.src, self.mirror_off, self.stored = src, mirror_off, stored or []
        self.preview_rows = preview_rows or []
        self.gates = gates or {'reconciled': False, 'revisions': '121/0', 'money_fresh': False, 'money_at': '2026-10-08 01:35', 'billing_fresh': True}
        self.seen = []

    def __call__(self, query):
        self.seen.append(query)
        if 'from public.cockpit_metric_values' in query:
            out = [{'what': 'ltv', 'day': '2026-09-21' if r['date'] == '2026-09-19' else '2026-10-07', 'scope': r['scope'], 'value': str(r['value'] + self.mirror_off)} for r in self.src['ltv']]
            out += [{'what': 'money.projected_mrr', 'day': '2026-09-30', 'scope': 'company', 'value': '14332.0000'},
                    {'what': 'money.collected_from_recurring', 'day': '2026-09-30', 'scope': 'company', 'value': '4068.0000'}]
            return out
        if query.startswith('with k(day, metric, scope)'):
            return self.stored
        if query.startswith('select (select history_ready'):
            return [self.gates]
        if query.startswith('with planned(scope, day, value)'):
            return self.preview_rows
        if query.startswith('begin;'):
            return []
        if 'count(*)::int as n, count(*) filter' in query:
            return [{'n': 28, 'ltv': 26}]
        if "action = 'ltv.baseline.import'" in query:
            return [{'n': 1}]
        raise AssertionError('Unexpected SQL: ' + query[:80])


class LtvImportTests(unittest.TestCase):
    def setUp(self):
        self.mod = importer()
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)

    def write(self, data):
        path = Path(self.tmp.name) / 'source.json'
        path.write_text(json.dumps(data))
        return str(path)

    def run_main(self, args, fake):
        lines = []
        code = self.mod.main(args, sql=fake, out=lines.append)
        return code, '\n'.join(lines)

    def test_source_is_checked_before_anything_is_planned(self):
        self.mod.validate(source())
        bad = source(); bad['deployment'] = 'some-dev-deployment'
        with self.assertRaisesRegex(ValueError, 'production deployment'):
            self.mod.validate(bad)
        with self.assertRaisesRegex(ValueError, 'Expected 26'):
            self.mod.validate(source(ltv=25))
        twice = source(); twice['ltv'][1]['scope'] = twice['ltv'][0]['scope']
        with self.assertRaisesRegex(ValueError, 'two baselines'):
            self.mod.validate(twice)
        late = source(); late['ltv'][0]['date'] = '2026-09-18'
        with self.assertRaisesRegex(ValueError, 'outside the reviewed days'):
            self.mod.validate(late)
        nan = source(); nan['ltv'][0]['value'] = float('nan')
        with self.assertRaisesRegex(ValueError, 'invalid value'):
            self.mod.validate(nan)
        nobook = source(book=False)
        with self.assertRaisesRegex(ValueError, 'Expected'):
            self.mod.validate(nobook)

    def test_rows_keep_provenance_and_the_plan_hash_is_stable(self):
        rows = self.mod.plan_rows(source())
        self.assertEqual(len(rows), 28)
        first = rows[0]
        self.assertEqual(set(first), {'day', 'metric', 'scope', 'value', 'captured_at', 'source_deployment', 'source_id', 'source_record'})
        self.assertEqual(first['source_deployment'], 'adorable-seahorse-418')
        self.assertEqual(first['captured_at'], '2026-09-19T10:04:09.685000Z')
        self.assertEqual(self.mod.plan_sha(rows), self.mod.plan_sha(self.mod.plan_rows(source())))
        changed = source(); changed['ltv'][3]['value'] += 1
        self.assertNotEqual(self.mod.plan_sha(rows), self.mod.plan_sha(self.mod.plan_rows(changed)))

    def test_dry_run_writes_nothing_and_reports_the_second_source(self):
        fake = FakeSql(source())
        code, text = self.run_main(['--source', self.write(source())], fake)
        self.assertEqual(code, 0)
        self.assertIn('Second source: 28 of 28 equal the Convex-era mirror', text)
        self.assertIn('A commit would insert 28 of 28 rows', text)
        self.assertIn('Gates today: totals reconciled False (revision/totals 121/0)', text)
        self.assertFalse(any(q.startswith('begin;') for q in fake.seen))
        for q in fake.seen:
            self.assertRegex(q.lstrip().lower(), r'^(select|with)\b')
            self.assertNotRegex(q.lower(), r'\b(insert|update|delete)\b')

    def test_a_value_the_mirror_disagrees_with_is_named(self):
        fake = FakeSql(source(), mirror_off=5)
        _, text = self.run_main(['--source', self.write(source()), '--no-preview'], fake)
        self.assertIn('2 of 28 equal', text)
        self.assertIn('26 differ', text)
        self.assertIn('DIFFERS money.ltv.card client:86card0000', text)

    def test_apply_needs_the_printed_plan_and_runs_once(self):
        src = source()
        path = self.write(src)
        sha = self.mod.plan_sha(self.mod.plan_rows(src))
        with self.assertRaisesRegex(SystemExit, 'needs --plan'):
            self.run_main(['--source', path, '--apply', '--plan', 'f' * 64, '--no-preview'], FakeSql(src))
        fake = FakeSql(src)
        _, text = self.run_main(['--source', path, '--apply', '--plan', sha, '--no-preview'], fake)
        writes = [q for q in fake.seen if q.startswith('begin;')]
        self.assertEqual(len(writes), 1)
        self.assertIn('on conflict (day, metric, scope) do nothing', writes[0])
        self.assertIn("'ltv.baseline.import'", writes[0])
        self.assertIn('having count(*) > 0', writes[0])
        self.assertIn('Written. Read back: 28 of 28 rows (26 baselines); audit rows for this plan: 1.', text)
        # Already stored: a second apply finds nothing new and writes nothing.
        stored = [{'what': 'same_key', 'day': r['day'], 'metric': r['metric'], 'scope': r['scope'], 'value': str(r['value']), 'source_id': r['source_id']}
                  for r in self.mod.plan_rows(src)]
        again = FakeSql(src, stored=stored)
        _, text = self.run_main(['--source', path, '--apply', '--plan', sha, '--no-preview'], again)
        self.assertIn('Nothing to write.', text)
        self.assertFalse(any(q.startswith('begin;') for q in again.seen))

    def test_a_card_with_an_earlier_point_keeps_it(self):
        src = source()
        earlier = [{'what': 'earlier', 'day': '2026-09-15', 'metric': 'money.ltv.card', 'scope': src['ltv'][0]['scope'], 'value': '1', 'source_id': 'x'}]
        _, text = self.run_main(['--source', self.write(src), '--no-preview'], FakeSql(src, stored=earlier))
        self.assertIn('1 card(s) already have an earlier money.ltv.card point, which stays the baseline: client:86card0000', text)

    def test_preview_selects_like_ltv_preview(self):
        rows = [
            {'clickup_task_id': 'a', 'client_name': 'Paid since', 'stage': 'Active', 'base_day': '2026-09-19', 'baseline': '4500.00', 'logged': '3000.00', 'payment_count': 1, 'target': '7500.00', 'current': '4500.00', 'delta': '3000.00', 'eligible': True},
            {'clickup_task_id': 'b', 'client_name': 'Up to date', 'stage': 'Active', 'base_day': '2026-09-19', 'baseline': '2000.00', 'logged': '0', 'payment_count': 0, 'target': '2000.00', 'current': '2000.00', 'delta': '0.00', 'eligible': True},
            {'clickup_task_id': 'c', 'client_name': 'New card', 'stage': 'Onboarding', 'base_day': None, 'baseline': None, 'logged': '0', 'payment_count': 0, 'target': None, 'current': '900.00', 'delta': None, 'eligible': True},
            {'clickup_task_id': 'd', 'client_name': 'Paused one', 'stage': 'Paused', 'base_day': '2026-09-19', 'baseline': '1.00', 'logged': '0', 'payment_count': 0, 'target': '1.00', 'current': '5.00', 'delta': '-4.00', 'eligible': False},
        ]
        write, missing, outside = self.mod.preview(rows)
        self.assertEqual([r['client_name'] for r in write], ['Paid since'])
        self.assertEqual([r['client_name'] for r in missing], ['New card'])
        self.assertEqual(outside, 1)
        sql = self.mod.preview_sql(self.mod.plan_rows(source()))
        self.assertTrue(sql.startswith('with planned(scope, day, value)'))
        self.assertIn("'Paused','Stopped','CANCELLED ONBOARDING','SALES TEAM TO CONTACT'", sql)
        self.assertIn("x->>'direction' = 'in'", sql)
        self.assertIn('(x->>\'day\')::date >= r.base_day', sql)

    def test_quoting_markers_are_refused(self):
        rows = self.mod.plan_rows(source())
        rows[0]['source_record'] = {'note': '$rows$'}
        with self.assertRaisesRegex(ValueError, 'quoting marker'):
            self.mod.apply_sql(rows, 'x', 'y', 'z')


if __name__ == '__main__':
    unittest.main()
