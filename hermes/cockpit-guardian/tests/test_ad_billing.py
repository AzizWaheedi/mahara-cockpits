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
        self.assertEqual(ad_billing.run(context(roster=[{'client_task_id':'one'}], bindings=[binding()])).status, 'ok')


def binding(good=1, **kw):
    return {'client_task_id': 'one', 'client_name': 'Ardon', 'enabled': True, 'manual_cutover_verified': True,
            'error': None, 'last_good_at': fakes.ago(good) if good is not None else None, **kw}


class StaleReads(unittest.TestCase):
    """19 Oct 2026: one run missed 3 of 17 clients, the next read all 17, and the old rule still paged."""

    def test_one_failed_run_does_not_page(self):
        cfg_error = '3 binding checks failed. Review the billing panel.'
        ctx = context(roster=[{'client_task_id': 'one'}],
                      bindings=[binding(good=6, error='Database request failed (network).')])
        ctx.db.tables['cockpit_ad_billing_config'][0]['last_error'] = cfg_error
        self.assertEqual(ad_billing.run(ctx).status, 'ok')

    def test_a_client_unread_for_20_minutes_pages(self):
        result = ad_billing.run(context(roster=[{'client_task_id': 'one'}], bindings=[binding(good=21, error='x')]))
        self.assertEqual(result.status, 'fail')
        self.assertTrue(result.urgent)
        self.assertIn('Ardon', result.summary)
        self.assertEqual(result.evidence['stale_clients'], 1)

    def test_a_client_never_read_pages(self):
        self.assertEqual(ad_billing.run(context(bindings=[binding(good=None)])).status, 'fail')

    def test_a_read_finishing_after_the_scan_started_is_fresh(self):
        self.assertEqual(ad_billing.run(context(bindings=[binding(good=-0.5)])).status, 'ok')

    def test_a_disabled_binding_is_not_read_and_does_not_page(self):
        self.assertEqual(ad_billing.run(context(bindings=[binding(good=None, enabled=False)])).status, 'ok')


class PausedClients(unittest.TestCase):
    """1 Nov 2026: four clients left Active in ClickUp and paged every scan as unread."""

    def test_a_client_not_active_is_paused_not_unread(self):
        result = ad_billing.run(context(bindings=[binding(good=90, error=ad_billing.NOT_ACTIVE)]))
        self.assertEqual(result.status, 'ok')
        self.assertIn('Paused (not Active in ClickUp): Ardon', result.summary)
        self.assertEqual(result.evidence['paused_clients'], 1)

    def test_a_paused_client_does_not_hide_an_unread_one(self):
        result = ad_billing.run(context(bindings=[binding(good=90, error=ad_billing.NOT_ACTIVE),
                                                  binding(good=30, error='Meta read failed', client_name='Other',
                                                          client_task_id='two')]))
        self.assertEqual(result.status, 'fail')
        self.assertEqual(result.evidence['stale_clients'], 1)
        self.assertIn('Other', result.summary)

    def test_a_paused_clients_waiting_card_does_not_page(self):
        card = {'id': 'card', 'state': 'queued', 'created_at': fakes.ago(60), 'attempts': 0, 'provider_id': None,
                'binding_id': 'b1'}
        result = ad_billing.run(context(bindings=[binding(good=90, error=ad_billing.NOT_ACTIVE, id='b1')],
                                        deliveries=[card]))
        self.assertEqual(result.status, 'ok')

    def test_a_paused_clients_failed_send_still_pages(self):
        card = {'id': 'card', 'state': 'failed', 'created_at': fakes.ago(60), 'attempts': 1, 'provider_id': None,
                'binding_id': 'b1'}
        result = ad_billing.run(context(bindings=[binding(good=90, error=ad_billing.NOT_ACTIVE, id='b1')],
                                        deliveries=[card]))
        self.assertEqual(result.status, 'fail')

    def test_an_active_clients_old_queued_card_still_pages(self):
        card = {'id': 'card', 'state': 'queued', 'created_at': fakes.ago(60), 'attempts': 0, 'provider_id': None,
                'binding_id': 'b1'}
        self.assertEqual(ad_billing.run(context(bindings=[binding(good=2, id='b1')], deliveries=[card])).status, 'fail')

    def test_a_client_back_to_active_is_watched_again(self):
        # The next run clears the error and refreshes last_good_at; a lasting other error pages as before.
        self.assertEqual(ad_billing.run(context(bindings=[binding(good=2)])).status, 'ok')
        self.assertEqual(ad_billing.run(context(bindings=[binding(good=25, error='Meta read failed')])).status, 'fail')
