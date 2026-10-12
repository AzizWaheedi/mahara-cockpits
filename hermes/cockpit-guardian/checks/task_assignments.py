"""Read the task-alert heartbeat. Never replay an ambiguous Slack message."""
import json
from guard.model import Check, Result, NOT_DEPLOYED, PAUSED, age_min, fail, ok


def check_worker(ctx,key,label):
    rows = ctx.rows('cockpit_sync_state', 'ok,note,last_run_at', where=[('key', 'eq', key)], limit=1)
    if not rows:
        return Result(NOT_DEPLOYED, f'{label} have not been installed.')
    row = rows[0]
    age = age_min(row.get('last_run_at'), ctx.now)
    if age is None or not 0 <= age <= 10:
        return fail(f'{label} have no current heartbeat.', urgent=True)
    try:
        detail = json.loads(row.get('note') or '{}')
    except (ValueError, TypeError):
        return fail(f'Department task alert health is invalid.')
    if not detail.get('apply'):
        return Result(PAUSED, f'{label} are paused.')
    if row.get('ok') is not True:
        return fail(f'{label} need source, identity or delivery review. Do not resend unknown messages.', urgent=True)
    return ok(f'{label} are current and no delivery needs review.')


def run(ctx):
    return check_worker(ctx,'task-assignment-alerts','Department task alerts')

def video(ctx):
    return check_worker(ctx,'video-review-flow','Video review flow')

CHECKS = (Check('department-task-alerts', 'workers', 'Department task assignments',
               'Main-task assignments reach the correct Slack department.', 'high',
               'Assignment worker heartbeat and delivery state.',
               'A run is over ten minutes late or a delivery requires review.', run,
               owner='the systems manager', action='Check the task-assignment-alerts ledger and reconcile provider receipts before retrying.',
               confirm=2, clear=2, urgent=True),
 Check('video-review-flow', 'workers', 'Video review and approval',
       'Video review transitions and client comments reach the correct task and team.', 'high',
       'Video review worker heartbeat.', 'Source, identity or delivery needs review.', video,
       owner='the systems manager', action='Inspect the video-review-flow ledger; reconcile unknown provider outcomes before retrying.',
       confirm=2, clear=2, urgent=True),)
