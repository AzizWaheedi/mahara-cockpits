"""Prepare a paused native worker artifact. Never connects, installs or changes cron."""
import argparse
import hashlib
import json
import os
import zipfile
from pathlib import Path

DRY_RUN=True
# Explicit reviewed runtime inventory. New files never enter automatically.
REQUIRED=(
 'package.json',
 'bun.lock',
 'supabase/functions/cockpit-ceo-api/frequency.ts',
 'hermes/ceo-refresh/bun.lock',
 'hermes/ceo-refresh/native/adapters/assets.js',
 'hermes/ceo-refresh/native/adapters/b2bAds.js',
 'hermes/ceo-refresh/native/adapters/calls.js',
 'hermes/ceo-refresh/native/adapters/clients.js',
 'hermes/ceo-refresh/native/adapters/delivery.js',
 'hermes/ceo-refresh/native/adapters/expenses.js',
 'hermes/ceo-refresh/native/adapters/growth.js',
 'hermes/ceo-refresh/native/adapters/hiring.js',
 'hermes/ceo-refresh/native/adapters/machine.js',
 'hermes/ceo-refresh/native/adapters/money.js',
 'hermes/ceo-refresh/native/adapters/organic.js',
 'hermes/ceo-refresh/native/adapters/portal.js',
 'hermes/ceo-refresh/native/adapters/team.js',
 'hermes/ceo-refresh/native/adapters/webinar.js',
 'hermes/ceo-refresh/native/billing.js',
 'hermes/ceo-refresh/native/board.js',
 'hermes/ceo-refresh/native/callCenterContract.js',
 'hermes/ceo-refresh/native/callCenterProjection.js',
 'hermes/ceo-refresh/native/callCenterSource.js',
 'hermes/ceo-refresh/native/constants.js',
 'hermes/ceo-refresh/native/content.js',
 'hermes/ceo-refresh/native/data/clients.js',
 'hermes/ceo-refresh/native/data/delivery.js',
 'hermes/ceo-refresh/native/data/tap.js',
 'hermes/ceo-refresh/native/data/team.js',
 'hermes/ceo-refresh/native/data/triage.js',
 'hermes/ceo-refresh/native/extensions.js',
 'hermes/ceo-refresh/native/gate.js',
 'hermes/ceo-refresh/native/hiring/forms.js',
 'hermes/ceo-refresh/native/hiring/ghl.js',
 'hermes/ceo-refresh/native/hiring/settings.js',
 'hermes/ceo-refresh/native/hiring/setup.js',
 'hermes/ceo-refresh/native/hiring/spec.js',
 'hermes/ceo-refresh/native/manualMatch.js',
 'hermes/ceo-refresh/native/metrics.ts',
 'hermes/ceo-refresh/native/numbers.js',
 'hermes/ceo-refresh/native/sb.js',
 'hermes/ceo-refresh/native/settings.js',
 'hermes/ceo-refresh/native/teamRules.js',
 'hermes/ceo-refresh/native/time.js',
 'hermes/ceo-refresh/native/tools.js',
 'hermes/ceo-refresh/native/voids.js',
 'hermes/ceo-refresh/native/webinarAttribution.js',
 'hermes/ceo-refresh/native/webinarFollowUp.js',
 'hermes/ceo-refresh/native/webinarMetrics.ts',
 'hermes/ceo-refresh/native/webinarPage.js',
 'hermes/ceo-refresh/native/webinarReadiness.js',
 'hermes/ceo-refresh/native/webinarRoom.js',
 'hermes/ceo-refresh/native/webinarSql.js',
 'hermes/ceo-refresh/native/webinarTargetsModel.js',
 'hermes/ceo-refresh/native/workingHours.js',
 'hermes/ceo-refresh/native/writeGuard.js',
 'hermes/ceo-refresh/package.json',
 'hermes/ceo-refresh/providerTools.ts',
 'hermes/ceo-refresh/repository.ts',
 'hermes/ceo-refresh/run.sh',
 'hermes/ceo-refresh/runtime.ts',
 'hermes/ceo-refresh/worker.ts',
 'hermes/cockpit-ask-ai/scripts/askai.py',
 'hermes/cockpit-ask-ai/SKILL.md',
 'hermes/cockpit-guardian/checks/__init__.py',
 'hermes/cockpit-guardian/checks/claude_proxy.py',
 'hermes/cockpit-guardian/checks/convex.py',
 'hermes/cockpit-guardian/checks/edge_functions.py',
 'hermes/cockpit-guardian/checks/guardian_self.py',
 'hermes/cockpit-guardian/checks/hermes_monitors.py',
 'hermes/cockpit-guardian/checks/keys.py',
 'hermes/cockpit-guardian/checks/live_calls.py',
 'hermes/cockpit-guardian/checks/native.py',
 'hermes/cockpit-guardian/checks/pg_cron.py',
 'hermes/cockpit-guardian/checks/queues.py',
 'hermes/cockpit-guardian/checks/sites.py',
 'hermes/cockpit-guardian/checks/supabase.py',
 'hermes/cockpit-guardian/checks/syncs.py',
 'hermes/cockpit-guardian/checks/vps_cron.py',
 'hermes/cockpit-guardian/checks/vps_resources.py',
 'hermes/cockpit-guardian/checks/whatsapp.py',
 'hermes/cockpit-guardian/checks/worker_status.py',
 'hermes/cockpit-guardian/crontab.manifest',
 'hermes/cockpit-guardian/guard/__init__.py',
 'hermes/cockpit-guardian/guard/ai.py',
 'hermes/cockpit-guardian/guard/alerts.py',
 'hermes/cockpit-guardian/guard/beat.py',
 'hermes/cockpit-guardian/guard/config.py',
 'hermes/cockpit-guardian/guard/context.py',
 'hermes/cockpit-guardian/guard/db.py',
 'hermes/cockpit-guardian/guard/engine.py',
 'hermes/cockpit-guardian/guard/fixes.py',
 'hermes/cockpit-guardian/guard/host.py',
 'hermes/cockpit-guardian/guard/http.py',
 'hermes/cockpit-guardian/guard/jobs.py',
 'hermes/cockpit-guardian/guard/model.py',
 'hermes/cockpit-guardian/guard/redact.py',
 'hermes/cockpit-guardian/guard/report.py',
 'hermes/cockpit-guardian/guard/store.py',
 'hermes/cockpit-guardian/guard/vps_snapshot.py',
 'hermes/cockpit-guardian/guardian.py',
 'hermes/cockpit-guardian/PROMPT.md',
 'hermes/cockpit-guardian/README.md',
 'hermes/cockpit-sync/calculator.ts',
 'hermes/cockpit-sync/capture.ts',
 'hermes/cockpit-sync/clientCalendars.ts',
 'hermes/cockpit-sync/constants.ts',
 'hermes/cockpit-sync/creativeProducer.ts',
 'hermes/cockpit-sync/csmCadence.ts',
 'hermes/cockpit-sync/csmProducer.ts',
 'hermes/cockpit-sync/csmProfileCalculations.ts',
 'hermes/cockpit-sync/csmProviders.ts',
 'hermes/cockpit-sync/csmRoster.ts',
 'hermes/cockpit-sync/marketProducer.ts',
 'hermes/cockpit-sync/metaMedia.ts',
 'hermes/cockpit-sync/RUNBOOK.md',
 'hermes/cockpit-sync/runtime.ts',
 'hermes/cockpit-sync/stills.ts',
 'hermes/cockpit-sync/transport.ts',
 'hermes/cockpit-sync/winners.ts',
 'hermes/cockpit-sync/worker.ts',
 'hermes/eod-out/out.py',
 'hermes/eod-out/RUNBOOK.md',
 'hermes/eod-out/test_out.py',
 'hermes/inbox/inbox.py',
 'hermes/inbox/tools.py',
 'hermes/media-native/bun.lock',
 'hermes/media-native/doctor.ts',
 'hermes/media-native/package.json',
 'hermes/media-native/run.sh',
 'hermes/media-native/runbook.md',
 'hermes/media-native/tools.ts',
 'hermes/media-native/worker.ts',
 'hermes/team-sync/README.md',
 'hermes/team-sync/sync.py',
 'hermes/team-sync/test_sync.py',
 'hermes/webinar-pull/pull.py',
 'hermes/webinar-pull/test_pull.py',
)

def safe_file(source,path):
    relative=path.relative_to(source)
    if any((source/Path(*relative.parts[:i])).is_symlink() for i in range(1,len(relative.parts)+1)):
        raise ValueError('Symlinked runtime paths cannot enter the worker package')
    if source not in path.resolve().parents:
        raise ValueError('Worker source path escapes the source repository')
    return relative.as_posix()

def build_plan(source):
    source=Path(source).resolve()
    for name in REQUIRED:
        path=source/name
        safe_file(source,path)
        if not path.is_file():raise ValueError('Required runtime file is missing: '+name)
    selected={source/name for name in REQUIRED}
    files=[{'path':safe_file(source,p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in sorted(selected)]
    source_hash=hashlib.sha256(json.dumps(files,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    return {'version':1,'dry_run':DRY_RUN,'live_writes':0,'source_tree_sha256':source_hash,'files':files,
      'status':'PAUSED_LOCAL_ARTIFACT','activation_authorized':False,'retirement_authorized':False,
      'dependency_install':'bun install --cwd hermes/media-native --frozen-lockfile --ignore-scripts',
      'dependency_installs':['bun install --frozen-lockfile --ignore-scripts --production','bun install --cwd hermes/ceo-refresh --frozen-lockfile --ignore-scripts --production','bun install --cwd hermes/media-native --frozen-lockfile --ignore-scripts --production'],
      'doctors':['bun hermes/media-native/doctor.ts','bun hermes/cockpit-sync/worker.ts doctor --sources','bun hermes/ceo-refresh/worker.ts doctor','python3 hermes/cockpit-ask-ai/scripts/askai.py doctor','python3 hermes/cockpit-guardian/guardian.py doctor','python3 hermes/eod-out/out.py --doctor','python3 hermes/inbox/inbox.py --source-only --doctor','python3 hermes/team-sync/sync.py doctor','python3 hermes/webinar-pull/pull.py doctor'],
      'configuration_names':['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ACCESS_TOKEN','COCKPIT_MANAGEMENT_TOKEN','META_SYSTEM_TOKEN','CLICKUP_API_TOKEN','GOOGLE_SERVICE_ACCOUNT_JSON','GOOGLE_APPLICATION_CREDENTIALS','SLACK_BOT_TOKEN','ALERT_SLACK_TO','ANTHROPIC_API_KEY','TYPEFORM_TOKEN','FATHOM_API_KEY','FATHOM_CREATED_AFTER','GHL_CLIENT_PIT','CSM_CALENDAR_IDS','CREATIVE_CALENDAR_IDS','COCKPIT_MONITOR_BACKEND','DESK_SUPABASE_URL','DESK_SUPABASE_KEY','GOOGLE_CAL_CLIENT_ID','GOOGLE_CAL_CLIENT_SECRET','GOOGLE_CAL_REFRESH_TOKEN','COMPOSIO_API_KEY','ZOOM_ACCOUNT_ID','ZOOM_CLIENT_ID','ZOOM_CLIENT_SECRET','GHL_MAHARA_PIT','GHL_MAHARA_LOCATION','DEEPSEEK_API_KEY'],
      'monitor_backend':'hybrid','schedules_enabled':False,
      'disabled_schedule_examples':[
       '# DISABLED: */2 * * * * /bin/bash /srv/mahara-cockpits/hermes/media-native/run.sh --apply --limit 20',
       '# DISABLED: */15 * * * * flock -n /var/lock/cockpit-sync.lock bun /srv/mahara-cockpits/hermes/cockpit-sync/worker.ts --apply --report /private/cockpit-sync/run-$(date +\\%s).json',
       '# DISABLED: */15 * * * * /bin/bash /srv/mahara-cockpits/hermes/ceo-refresh/run.sh --apply'],
      'remaining_gates':['Review every dirty host edit before staging to an isolated new host directory.','Verify named host credentials and live provider permissions.','Reconcile original data and files before enabling producers.','Replace both legacy Ask AI copies and its Meta helpers with proven native contracts.','Update the separate portal monitor before retirement.','Approve writer freeze and activate one writer per provider.','Verify authenticated production and deletion-independent recovery.']}

def materialize(source,plan,destination):
    source=Path(source).resolve();destination=Path(destination).resolve()
    if destination==source or source in destination.parents:raise ValueError('Worker artifact must be outside the source repository')
    if destination.exists():raise ValueError('An existing worker artifact cannot be overwritten')
    if plan!=build_plan(source):raise ValueError('Worker source changed after planning')
    destination.parent.mkdir(parents=True,exist_ok=True)
    descriptor=os.open(destination,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(descriptor,'wb') as stream,zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('manifest.json',json.dumps(plan,sort_keys=True,indent=2))
        for row in plan['files']:archive.writestr(row['path'],(source/row['path']).read_bytes())
    return hashlib.sha256(destination.read_bytes()).hexdigest()

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',type=Path,default=Path(__file__).resolve().parents[1]);parser.add_argument('--out',type=Path);parser.add_argument('--materialize',action='store_true');args=parser.parse_args()
    plan=build_plan(args.source)
    if args.materialize:
        if args.out is None:parser.error('--materialize requires a new --out ZIP outside the source repository')
        sha=materialize(args.source,plan,args.out)
        print(json.dumps({'dry_run':True,'live_writes':0,'local_artifact_created':True,'artifact':str(args.out.resolve()),'sha256':sha,'files':len(plan['files']),'schedules_enabled':False}))
    else:print(json.dumps(plan,sort_keys=True))

if __name__=='__main__':main()
