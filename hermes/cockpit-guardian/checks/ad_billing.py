"""Independent read-only watchdog. Never sends a client message or retries a payment."""
from guard.model import Check, Result, NOT_DEPLOYED, PAUSED, age_min, fail, ok, parse_time, warn

# Active clients whose Meta ad account Mahara cannot access (Muhammed, 13 Oct 2026). They stay on the manual Make
# route, so counting them only kept this check warning for good. The worker excludes the Zeiad sandbox the same way.
NO_META_ACCESS = {'86ex4j8f3'}  # Brillant Touch Company

# A client counts as unverified only after this long without a successful read. The worker runs every 5 minutes and
# already retries each read 3 times, so 20 minutes is 3 or 4 failed runs in a row. The old rule paged on the run's own
# error: on 19 Oct 2026 the 14:40 run missed 3 of 17 clients, 14:45 read all 17, and the page still went out because
# two scans read the same 14:40 result (one after it finished, one before the next run replaced it).
STALE_READ_MIN = 20


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


def _stale(binding, now):
    age = age_min(binding.get('last_good_at'), now)
    return age is None or age > STALE_READ_MIN


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
    bindings = ctx.rows('cockpit_ad_billing_bindings',
                        'client_task_id,client_name,enabled,manual_cutover_verified,error,last_good_at')
    enabled = [b for b in bindings if b.get('enabled')]
    # A crashed run reads no client at all, so it shows here too once it has lasted 20 minutes.
    stale = [b for b in enabled if _stale(b, ctx.now)]
    if stale:
        names = ', '.join(sorted(b.get('client_name') or b.get('client_task_id') or '?' for b in stale))
        return fail(f'Ad billing has not read {len(stale)} client(s) for over {STALE_READ_MIN} minutes: {names}.',
                    evidence={'stale_clients': len(stale), 'last_run_error': cfg.get('last_error')}, urgent=True)
    problems = ctx.rows('cockpit_ad_billing_deliveries', 'id,state,created_at,attempts,provider_id,binding_id',
                        where=[('state', 'in', ['failed', 'unknown', 'queued', 'retry', 'claimed', 'sending'])], limit=250)
    replaced = _replaced(ctx, problems)
    blocked = [r for r in problems if r.get('id') not in replaced and (r.get('state') in ('failed', 'unknown') or
               (age_min(r.get('created_at'), ctx.now) or 0) > 15)]
    if blocked:
        return fail('Ad billing notifications need delivery review. Do not resend an unknown result.',
                    evidence={'pending_review': len(blocked)}, urgent=True)
    roster = ctx.rows('cockpit_ad_billing_roster', 'client_task_id')
    # A one-run read error is not missing coverage. A lasting one is caught above as a stale read.
    covered = {b['client_task_id'] for b in enabled if b.get('manual_cutover_verified')}
    missing = len([r for r in roster if r.get('client_task_id') not in covered | NO_META_ACCESS])
    if missing:
        return warn('Some active clients lack verified ad billing coverage.', evidence={'missing_clients': missing})
    return ok('Ad billing checks are current and no delivery is awaiting review.')


CHECKS = (Check('ad-billing-watch', 'workers', 'Ad billing alerts',
                'Payment warnings must reach the client and the media team.', 'high',
                'Billing heartbeat, delivery receipts and exact account coverage.',
                'A run is overdue by 15 minutes, a client has no good read for 20 minutes, a delivery needs review, '
                'or coverage is incomplete.',
                run, owner='the systems manager',
                action='Open Ad billing watch. Check source access and the exact account mapping. Reconcile unknown messages before retrying.',
                confirm=2, clear=2, urgent=True),)
