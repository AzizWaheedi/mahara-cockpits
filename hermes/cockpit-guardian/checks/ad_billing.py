"""Independent read-only watchdog. Never sends a client message or retries a payment."""
from guard.model import Check, Result, NOT_DEPLOYED, PAUSED, age_min, fail, ok, warn

# Active clients whose Meta ad account Mahara cannot access (Muhammed, 13 Oct 2026). They stay on the manual Make
# route, so counting them only kept this check warning for good. The worker excludes the Zeiad sandbox the same way.
NO_META_ACCESS = {'86ex4j8f3'}  # Brillant Touch Company


def run(ctx):
    if not ctx.exists('cockpit_ad_billing_config'):
        return Result(NOT_DEPLOYED, 'Ad billing monitoring has not been installed.')
    rows = ctx.rows('cockpit_ad_billing_config', 'apply,last_finished_at,last_error', limit=1)
    if not rows:
        return fail('The ad billing configuration is missing.')
    cfg = rows[0]
    if cfg.get('apply') is not True:
        return Result(PAUSED, 'Ad billing notifications are in preview mode.')
    age = age_min(cfg.get('last_finished_at'), ctx.now)
    if age is None or not 0 <= age <= 15:
        return fail('Ad billing checks have no completed run within 15 minutes.', urgent=True)
    if cfg.get('last_error'):
        return fail('The last ad billing run failed. Review the media buyer billing panel.', urgent=True)
    problems = ctx.rows('cockpit_ad_billing_deliveries', 'id,state,created_at',
                        where=[('state', 'in', ['failed', 'unknown', 'queued', 'retry', 'claimed', 'sending'])], limit=250)
    blocked = [r for r in problems if r.get('state') in ('failed', 'unknown') or
               (age_min(r.get('created_at'), ctx.now) or 0) > 15]
    if blocked:
        return fail('Ad billing notifications need delivery review. Do not resend an unknown result.',
                    evidence={'pending_review': len(blocked)}, urgent=True)
    roster = ctx.rows('cockpit_ad_billing_roster', 'client_task_id')
    bindings = ctx.rows('cockpit_ad_billing_bindings', 'client_task_id,enabled,manual_cutover_verified,error')
    covered = {b['client_task_id'] for b in bindings if b.get('enabled') and b.get('manual_cutover_verified') and not b.get('error')}
    missing = len([r for r in roster if r.get('client_task_id') not in covered | NO_META_ACCESS])
    if missing:
        return warn('Some active clients lack verified ad billing coverage.', evidence={'missing_clients': missing})
    return ok('Ad billing checks are current and no delivery is awaiting review.')


CHECKS = (Check('ad-billing-watch', 'workers', 'Ad billing alerts',
                'Payment warnings must reach the client and the media team.', 'high',
                'Billing heartbeat, delivery receipts and exact account coverage.',
                'A run is overdue by 15 minutes, a delivery needs review, or coverage is incomplete.',
                run, owner='the systems manager',
                action='Open Ad billing watch. Check source access and the exact account mapping. Reconcile unknown messages before retrying.',
                confirm=2, clear=2, urgent=True),)
