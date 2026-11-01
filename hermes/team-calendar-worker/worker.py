#!/usr/bin/env python3
"""Drain at most one verified Team Calendar operation per tick.

Healthy runs are silent. Nonzero exit signals a Slack #health cron failure.
"""
import json
import os
import secrets
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/opt/data/repos/mahara-cockpits')
BUN = '/opt/data/bin/bun'  # stable copy; never point at a package cache
SOURCE = ROOT / 'apps/media-buyer-cockpit/api/team-calendar.ts'
PROJECT = 'https://bldgtotkfmhoxmlzowdx.supabase.co'


def fail(message):
    print('Team Calendar worker: ' + message)
    raise SystemExit(1)


def read_receipt(url, headers, opener=urllib.request.urlopen, sleep=time.sleep, waits=(0, 3, 8)):
    """Read the ready receipt, retrying because one slow read must not fail the run.

    Returns the parsed rows, or None when every try fails.
    """
    for wait in waits:
        if wait > 0:
            sleep(wait)
        try:
            request = urllib.request.Request(url, headers=headers)
            with opener(request, timeout=15) as response:
                return json.load(response)
        except Exception:
            continue
    return None


def main():
    env = os.environ.copy()
    for line in Path('/opt/data/bibi/api-keys.env').read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            env[key.strip()] = value.strip().strip('"\'')
    key = env.get('COCKPIT_SUPABASE_KEY', '')
    if env.get('COCKPIT_SUPABASE_URL', '').rstrip('/') != PROJECT or not key:
        fail('cockpit service credential is unavailable')
    if not all(env.get(k) for k in ('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN')):
        fail('Google Calendar credential is unavailable')
    if not SOURCE.is_file() or not Path(BUN).is_file():
        fail('tested Team Calendar code or Bun binary is missing')
    env['SUPABASE_URL'] = PROJECT
    env['SUPABASE_SERVICE_ROLE_KEY'] = key
    env['TEAM_CALENDAR_WRITES_ENABLED'] = 'true'
    env['CRON_SECRET'] = secrets.token_hex(32)
    js = "import {handler} from './apps/media-buyer-cockpit/api/team-calendar.ts'; const r=await handler(new Request('https://localhost/api/team-calendar?mode=cron',{headers:{authorization:'Bearer '+process.env.CRON_SECRET}})); const d=await r.json(); console.log(JSON.stringify({status:r.status,ready:d.ready,processed:d.processed,waiting:d.waiting,failed:d.failed}));"
    try:
        run = subprocess.run([BUN, '-e', js], cwd=ROOT, env=env, capture_output=True, text=True, timeout=90)
        result = json.loads(run.stdout.strip().splitlines()[-1])
    except (subprocess.TimeoutExpired, ValueError, IndexError):
        fail('handler timed out or returned an invalid response')
    if run.returncode or result.get('status') != 200 or result.get('ready') is not True:
        fail('handler failed; check private worker logs and service configuration')
    headers = {'apikey': key, 'Authorization': 'Bearer ' + key}
    # One slow or dropped read must not fail the run: try three times (1 Nov 2026,
    # a single failed read at 10:00 UTC posted a false #health failure).
    rows = read_receipt(PROJECT + '/rest/v1/cockpit_team_calendar_worker?select=*&limit=1', headers)
    if rows is None:
        fail('ready receipt could not be read back after 3 tries')
    if len(rows) != 1 or rows[0].get('ready') is not True:
        fail('ready receipt was not stored')
    # The contract may call this column checked_at or updated_at; fail if neither exists.
    timestamp = rows[0].get('checked_at') or rows[0].get('updated_at')
    if not timestamp:
        fail('ready receipt has no timestamp')
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(timestamp.replace('Z', '+00:00'))).total_seconds()
    if age > 120 or age < -30:
        fail('ready receipt is stale')
    # Deliberately no stdout on health: scheduler sends only failures to Slack.


if __name__ == '__main__':
    main()
