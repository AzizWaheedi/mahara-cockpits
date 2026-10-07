"""Read-only native evidence. An empty queue is not worker activation evidence."""
from guard.context import SourceError
from guard.model import Check, fail, ok, unknown, age_min, parse_time

EXPECTED={
 'media':set('inbox clientLinks clientComments boardCards offBoardCampaigns manualChanges adChanges metaTree clickupMembers clientPrefs feedback syncRuns onboardings launchWatch trackingIssues marketPlays campaignChat'.split()),
 'csm':set('clients csTasks kpi appointments rosterDays churnEvents syncRuns clientProfiles decisions reportDocs outbox'.split()),
 'creative':set('clients creativeTasks videoJobs contentPosts touchLog campaigns ads metaTree funnels winnersArchive marketPlays blueprints'.split()),
}
SECTION_KEYS='money expenses growth webinar b2bAds delivery calls clients team hiring portal assets organic machine'.split()
# Match the existing SQL/view and Vercel watchdog. Queues are not worker heartbeats.
REQUIRED_CHECKS={*('section:'+key for key in SECTION_KEYS),'worker:media-core','worker:ceo-refresh','worker:team-calendar','queue:ask-ai','queue:eod','catalog:native'}

def run_native(ctx):
    """Consume the existing monitor contract. No publisher or migration is implied."""
    try:rows=ctx.rows('cockpit_native_monitor_state','snapshot',limit=1)
    except SourceError:return fail('The native monitor snapshot is unavailable. Its producer must be verified before retirement.')
    value=rows[0].get('snapshot') if rows else None
    if not isinstance(value,dict) or value.get('version')!=1 or not isinstance(value.get('checks'),list):
        return fail('The native worker summary is unavailable. Empty queues cannot verify activation.')
    age=age_min(value.get('checked_at'),ctx.now)
    if age is None or not 0<=age<=10:return fail('The native worker summary timestamp is unavailable or stale.')
    readings=value['checks'];keys=[r.get('key') for r in readings if isinstance(r,dict)]
    if len(keys)!=len(readings) or any(not isinstance(key,str) or not key for key in keys) or len(keys)!=len(set(keys)) or not REQUIRED_CHECKS.issubset(keys):
        return fail('The native worker summary is incomplete. Every required producer needs its own evidence.')
    for row in readings:
        if not isinstance(row['key'],str) or row.get('ok') is not True:
            return fail('A native producer, queue, source or provider check failed. Review its protected receipts.')
        age=age_min(row.get('at'),ctx.now);limit=row.get('max_age_min')
        needs_stamp=row['key'].startswith(('worker:','section:'))
        cap=90 if row['key']=='worker:media-core' else 45
        if limit is None:
            if needs_stamp or (row['key'].startswith('queue:') and row.get('at') is not None):
                return fail('A native producer or pending queue lacks its freshness requirement.')
            continue
        if not isinstance(limit,(int,float)) or isinstance(limit,bool) or not 0<limit<=cap or age is None or not 0<=age<=limit:
            return fail('A native reading is missing, stale or invalid. Review its doctor and receipts.')
    return ok('Native monitor checks pass. Job-worker activation still needs host and processed-job evidence.')

def run_sources(ctx):
    issues=[];verified=0
    try:
        for family,expected in EXPECTED.items():
            rows=ctx.rows('cockpit_'+family+'_source_state','table_name,ready,row_count,source_snapshot_at')
            names=[r.get('table_name') for r in rows]
            if len(names)!=len(set(names)) or set(names)!=expected:
                issues.append(f'{family}: the complete source inventory is unavailable')
            for row in rows:
                name=row.get('table_name');count=row.get('row_count');stamp=parse_time(row.get('source_snapshot_at'))
                if name not in expected:continue
                if row.get('ready') is not True or not isinstance(count,int) or isinstance(count,bool) or count<0 or stamp is None or stamp>ctx.now:
                    issues.append(f'{family}/{name}: reconciliation evidence is unavailable');continue
                actual=ctx.count('cockpit_'+family+'_sources',[('table_name','eq',name),('source_snapshot_at','eq',row['source_snapshot_at'])])
                if actual!=count:issues.append(f'{family}/{name}: declared and stored counts differ')
                else:verified+=1
    except SourceError:
        return unknown('Native source readiness could not be read. Restore Creative Triage access.')
    if issues:return fail('Native sources need reconciliation. Review the protected import plan.',evidence={'verified_tables':verified,'issues':issues})
    return ok('All 40 native source tables have matching verified counts and snapshot dates.',evidence={'verified_tables':verified})

def run_producer(ctx):
    try:
        rows=ctx.rows('cockpit_native_media_runs','status,published_at',where=[('status','eq','published')],order='published_at.desc',limit=1)
    except SourceError:return unknown('Native source producer evidence could not be read. Check its ledger and configuration.')
    if not rows:return unknown('No published native source run is recorded. Worker activation remains unverified.')
    age=age_min(rows[0].get('published_at'),ctx.now)
    if age is None or age<0:return unknown('The native source producer timestamp is unavailable or invalid.')
    if age>90:return fail('The native source producer has no recent publication. Check its approved schedule and receipts.',evidence={'last_publication_minutes':int(age)})
    return ok('A native source publication is recorded within 90 minutes. This does not certify the other workers.',evidence={'last_publication_minutes':int(age)})

CHECKS=(
 Check('native-source-readiness','supabase','Native source readiness','The cockpit history must have verified coverage.','high','Native source-state rows and matching source counts.','Missing, unready or mismatched source evidence.',run_sources,owner='the systems manager',action='Review the protected reconciliation plan. Apply only after approval.',confirm=2,urgent=True),
 Check('native-source-producer','workers','Native source producer','A real publication is required to verify the source producer.','high','The latest published cockpit_native_media_runs receipt.','No receipt or no publication within 90 minutes.',run_producer,owner='Hermes',action='Read the worker doctor, flock schedule and publication receipt.',confirm=3),
 Check('native-worker-summary','workers','Native worker evidence','Every replacement producer needs an independent successful reading.','high','The native monitor snapshot contract.','Missing publisher, required worker, timestamp or successful reading.',run_native,owner='Hermes',action='Verify the snapshot publisher and every worker before switching monitoring.',confirm=2,urgent=True),
)
