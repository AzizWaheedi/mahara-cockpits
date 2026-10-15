import tempfile
import unittest
from pathlib import Path
from checks import ad_billing
from guard.context import Context
from tests import fakes


def context(age=1, apply=True, deliveries=None, bindings=None, roster=None, events=None):
    return Context(fakes.config(Path(tempfile.gettempdir())/'guardian-billing-test'), fakes.FakeDb({
        'cockpit_ad_billing_config': [{'apply': apply, 'last_finished_at': fakes.ago(age)}],
        'cockpit_ad_billing_deliveries': deliveries or [],
        'cockpit_ad_billing_bindings': bindings or [],
        'cockpit_ad_billing_roster': roster or [],
        'cockpit_ad_billing_events': events or [],
    }), None, now=fakes.NOW)


def stopped(**kw):
    """A card the worker stopped before sending: 'failed', no attempt, no receipt (14 Oct 2026)."""
    return {'id': 'card', 'state': 'failed', 'created_at': fakes.ago(10), 'attempts': 0, 'provider_id': None,
            'binding_id': 'khalida', **kw}


class SafeStops(unittest.TestCase):
    def test_a_stop_a_newer_status_replaced_is_not_a_problem(self):
        events = [{'binding_id': 'khalida', 'created_at': fakes.ago(10)}, {'binding_id': 'khalida', 'created_at': fakes.ago(5)}]
        self.assertEqual(ad_billing.run(context(deliveries=[stopped()], events=events)).status, 'ok')

    def test_a_stop_nothing_replaced_still_needs_a_person(self):
        events = [{'binding_id': 'khalida', 'created_at': fakes.ago(10)}]
        self.assertEqual(ad_billing.run(context(deliveries=[stopped()], events=events)).status, 'fail',
                         'the status may have flipped back: the warning never went out')

    def test_a_newer_status_for_another_client_does_not_count(self):
        events = [{'binding_id': 'other', 'created_at': fakes.ago(5)}]
        self.assertEqual(ad_billing.run(context(deliveries=[stopped()], events=events)).status, 'fail')

    def test_a_send_the_provider_refused_still_needs_a_person(self):
        events = [{'binding_id': 'khalida', 'created_at': fakes.ago(5)}]
        for card in (stopped(attempts=1), stopped(provider_id='1791968823.745549')):
            self.assertEqual(ad_billing.run(context(deliveries=[card], events=events)).status, 'fail', card)

    def test_an_unknown_result_is_never_excused(self):
        events = [{'binding_id': 'khalida', 'created_at': fakes.ago(5)}]
        self.assertEqual(ad_billing.run(context(deliveries=[stopped(state='unknown')], events=events)).status, 'fail')


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
