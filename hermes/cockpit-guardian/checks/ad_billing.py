"""Independent read-only watchdog. Never sends a client message or retries a payment."""
from guard.model import Check, Result, NOT_DEPLOYED, PAUSED, age_min, fail, ok, parse_time, warn

# Active clients whose Meta ad account Mahara cannot access (Muhammed, 13 Oct 2026). They stay on the manual Make
# route, so counting them only kept this check warning for good. The worker excludes the Zeiad sandbox the same way.
NO_META_ACCESS = {'86ex4j8f3'}  # Brillant Touch Company


def _replaced(ctx, problems):
    """Failed notifications that never went out and that a newer status for the same client has replaced.

    Before every send the worker reads Meta again and stops if the status moved on. It records that safe stop as
    'failed', the same word as a send the provider refused, so the stop read as Broken for good (14 Oct 2026: a client
    turned unsettled at 12:05, paid within seconds, and both Slack cards stayed 'failed'). Nothing was sent, and the
    newer status has its own messages. Without a newer status nothing has taken the card's place, so it still counts."""
    unsent = [r for r in problems if r.get('state') == 'failed' and not r.get('attempts') and not r.get('provider_id')
              and r.get('binding_id')]
    if not unsent:
        return set()
    latest = {}
    for e in ctx.rows('cockpit_ad_billing_events', 'binding_id,created_at',
                      where=[('binding_id', 'in', sorted({r['binding_id'] for r in unsent}))]):
        at = parse_time(e.get('created_at'))
        if at and (e['binding_id'] not in latest or at > latest[e['binding_id']]):
            latest[e['binding_id']] = at
    return {r['id'] for r in unsent
            if latest.get(r['binding_id']) and parse_time(r.get('created_at'))
            and latest[r['binding_id']] > parse_time(r.get('created_at'))}


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
    # The worker starts on the same 5-minute marks as the guardian and finishes about 30 s later, so a scan that began
    # before it finished reads a finish time after the scan's own clock. That run is fresh, not missing: it was the
    # false "no completed run" Broken of 12 Oct 2026. Only a time more than 5 minutes ahead means a wrong clock.
    if age is None or not -5 <= age <= 15:
        return fail('Ad billing checks have no completed run within 15 minutes.', urgent=True)
    if cfg.get('last_error'):
        return fail('The last ad billing run failed. Review the media buyer billing panel.', urgent=True)
    problems = ctx.rows('cockpit_ad_billing_deliveries', 'id,state,created_at,attempts,provider_id,binding_id',
                        where=[('state', 'in', ['failed', 'unknown', 'queued', 'retry', 'claimed', 'sending'])], limit=250)
    replaced = _replaced(ctx, problems)
    blocked = [r for r in problems if r.get('id') not in replaced and (r.get('state') in ('failed', 'unknown') or
               (age_min(r.get('created_at'), ctx.now) or 0) > 15)]
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
