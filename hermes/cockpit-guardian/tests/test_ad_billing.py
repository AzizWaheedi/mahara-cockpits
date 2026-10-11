import tempfile
import unittest
from pathlib import Path
from checks import ad_billing
from guard.context import Context
from tests import fakes


def context(age=1, apply=True, deliveries=None, bindings=None, roster=None):
    return Context(fakes.config(Path(tempfile.gettempdir())/'guardian-billing-test'), fakes.FakeDb({
        'cockpit_ad_billing_config': [{'apply': apply, 'last_finished_at': fakes.ago(age)}],
        'cockpit_ad_billing_deliveries': deliveries or [],
        'cockpit_ad_billing_bindings': bindings or [],
        'cockpit_ad_billing_roster': roster or [],
    }), None, now=fakes.NOW)


class Billing(unittest.TestCase):
    def test_disabled_is_preview_not_healthy(self):
        self.assertEqual(ad_billing.run(context(apply=False)).status, 'paused')

    def test_stale_worker_is_urgent(self):
        result = ad_billing.run(context(age=16))
        self.assertEqual(result.status, 'fail')
        self.assertTrue(result.urgent)

    def test_unknown_provider_result_needs_review(self):
        self.assertEqual(ad_billing.run(context(deliveries=[{'id':'one','state':'unknown','created_at':fakes.ago(1)}])).status, 'fail')

    def test_missing_coverage_is_not_healthy(self):
        self.assertEqual(ad_billing.run(context(roster=[{'client_task_id':'one'}])).status, 'warn')

    def test_complete_idle_coverage(self):
        self.assertEqual(ad_billing.run(context(roster=[{'client_task_id':'one'}], bindings=[{'client_task_id':'one','enabled':True,'manual_cutover_verified':True}])).status, 'ok')
