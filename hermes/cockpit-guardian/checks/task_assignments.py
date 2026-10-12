"""Read the task-alert heartbeat. Never replay an ambiguous Slack message."""
import json
from guard.model import Check, Result, NOT_DEPLOYED, PAUSED, age_min, fail, ok


def run(ctx):
    rows = ctx.rows('cockpit_sync_state', 'ok,note,last_run_at', where=[('key', 'eq', 'task-assignment-alerts')], limit=1)
    if not rows:
        return Result(NOT_DEPLOYED, 'Department task alerts have not been installed.')
    row = rows[0]
    age = age_min(row.get('last_run_at'), ctx.now)
    if age is None or not 0 <= age <= 10:
        return fail('Department task alerts have no current heartbeat.', urgent=True)
    try:
        detail = json.loads(row.get('note') or '{}')
    except (ValueError, TypeError):
        return fail('Department task alert health is invalid.')
    if not detail.get('apply'):
        return Result(PAUSED, 'Department task alerts are paused.')
    if row.get('ok') is not True:
        return fail('Department task alerts need source, identity or delivery review. Do not resend unknown messages.', urgent=True)
    return ok('Department task alerts are current and no delivery needs review.')


CHECKS = (Check('department-task-alerts', 'workers', 'Department task assignments',
               'Main-task assignments reach the correct Slack department.', 'high',
               'Assignment worker heartbeat and delivery state.',
               'A run is over ten minutes late or a delivery requires review.', run,
               owner='the systems manager', action='Check the task-assignment-alerts ledger and reconcile provider receipts before retrying.',
               confirm=2, clear=2, urgent=True),)
