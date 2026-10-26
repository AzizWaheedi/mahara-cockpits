"""Read-only native evidence. An empty queue is not worker activation evidence."""
import re
from guard.context import SourceError
from guard.model import Check, fail, ok, unknown, warn, age_min, parse_time

EXPECTED={
 'media':set('inbox clientLinks clientComments boardCards offBoardCampaigns manualChanges adChanges metaTree clickupMembers clientPrefs feedback syncRuns onboardings launchWatch trackingIssues marketPlays campaignChat'.split()),
 'csm':set('clients csTasks kpi appointments rosterDays churnEvents syncRuns clientProfiles decisions reportDocs outbox'.split()),
 'creative':set('clients creativeTasks videoJobs contentPosts touchLog campaigns ads metaTree funnels winnersArchive marketPlays blueprints'.split()),
}
SECTION_KEYS='money expenses growth webinar b2bAds delivery calls clients team hiring portal assets organic machine'.split()
# Match the existing SQL/view and Vercel watchdog. Queues are not worker heartbeats.
REQUIRED_CHECKS={*('section:'+key for key in SECTION_KEYS),'worker:media-core','worker:ceo-refresh','worker:team-calendar','queue:ask-ai','queue:eod','catalog:native'}
# The longest freshness window a reading may declare. Exception alerts work at most once an hour on the lead sync
# watch's cron and declare 150 minutes (PR 71, 26 Oct 2026); the 45-minute default read that as invalid.
MAX_AGE_CAP={'worker:media-core':90,'worker:exception-alerts':150}
# One provider call whose latest receipt failed (cockpit_native_monitor_base). A one-off call is never repeated, so
# these stayed Broken from 9 Oct 2026 without a name. They are a named warning; producers and sections still fail.
PROVIDER_RECEIPT=re.compile(r'^source:cockpit_[a-z]+_provider_health:')

def run_native(ctx):
    """Consume the existing monitor contract. No publisher or migration is implied."""
    try:rows=ctx.rows('cockpit_native_monitor_state','snapshot',limit=1)
    except SourceError:return fail('The native monitor snapshot is unavailable. Its producer must be verified before retirement.')
    value=rows[0].get('snapshot') if rows else None
    if not isinstance(value,dict) or value.get('version')!=1 or not isinstance(value.get('checks'),list):
        return fail('The native worker summary is unavailable. Empty queues cannot verify activation.')
    # checked_at is the database's time of this read, so it is always a little after the scan's start (ctx.now,
    # whole seconds): -0.015 min failed every scan from 9 Oct 2026. Only more than 5 minutes ahead is a wrong clock.
    age=age_min(value.get('checked_at'),ctx.now)
    if age is None or not -5<=age<=10:return fail('The native worker summary timestamp is unavailable or stale.')
    readings=value['checks'];keys=[r.get('key') for r in readings if isinstance(r,dict)]
    if len(keys)!=len(readings) or any(not isinstance(key,str) or not key for key in keys) or len(keys)!=len(set(keys)) or not REQUIRED_CHECKS.issubset(keys):
        return fail('The native worker summary is incomplete. Every required producer needs its own evidence.')
    providers=[]
    for row in readings:
        if PROVIDER_RECEIPT.match(row['key']) and row.get('ok') is not True:
            providers.append(row);continue
        if not isinstance(row['key'],str) or row.get('ok') is not True:
            return fail(f"Native reading {row.get('name') or row['key']} failed: {str(row.get('error') or 'no detail')[:120]}",
                        evidence={'key':row['key']})
        age=age_min(row.get('at'),ctx.now);limit=row.get('max_age_min')
        needs_stamp=row['key'].startswith(('worker:','section:'))
        cap=MAX_AGE_CAP.get(row['key'],45)
        if limit is None:
            if needs_stamp or (row['key'].startswith('queue:') and row.get('at') is not None):
                return fail('A native producer or pending queue lacks its freshness requirement.')
            continue
        if not isinstance(limit,(int,float)) or isinstance(limit,bool) or not 0<limit<=cap or age is None or not 0<=age<=limit:
            return fail(f"Native reading {row.get('name') or row['key']} is missing, stale or invalid. Review its doctor and receipts.",
                        evidence={'key':row['key'],'max_age_min':limit,'age_min':age})
    if providers:
        named=[f"{r.get('name') or 'Provider'} {r.get('detail') or r['key'].rsplit(':',1)[-1][:8]}" for r in providers]
        return warn(f"{len(providers)} provider call(s) failed on their latest try: {', '.join(named[:4])}"
                    f"{' and more' if len(named)>4 else ''}. Producers and sections pass.",
                    evidence={'failed_calls':len(providers),'calls':named[:20]},items=sorted(r['key'] for r in providers),
                    action='Read the named call in its provider ledger. A Meta 400 or 403 on one object is usually a '
                           'missing Page or account permission; a Google 403 is a sheet not shared with the worker.')
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

# Meta's names for a campaign, an ad set and an ad: the objects the change feed can place on the board.
CHANGE_OBJECTS=('CAMPAIGN_GROUP','CAMPAIGN','ADGROUP')
FEED_LAG_HOURS=24

def run_change_feed(ctx):
    """The Ads change feed keeps up with Meta's activity log. Its old source stopped on 2 Oct 2026 and the feed froze
    for three weeks: every cycle republished the old rows, so the snapshot stamps stayed fresh (24 Oct 2026). Compare
    the newest change in the feed with the newest campaign change in the log, never the stamp."""
    try:
        log=ctx.rows('cockpit_csm_meta_activities','event_time',where=[('object_type','in',CHANGE_OBJECTS)],order='event_time.desc',limit=1)
        feed=ctx.rows('cockpit_media_sources','data',where=[('table_name','eq','adChanges')])
    except SourceError:
        return unknown("The Ads change feed or Meta's activity log could not be read. Restore Creative Triage access.")
    newest_log=parse_time(log[0].get('event_time')) if log else None
    if newest_log is None:
        return unknown("Meta's activity log has no campaign change, so the Ads change feed cannot be compared.")
    stamps=[r['data'].get('at') for r in feed if isinstance(r.get('data'),dict)]
    newest_feed=parse_time(max((s for s in stamps if isinstance(s,(int,float)) and not isinstance(s,bool)),default=None))
    evidence={'newest_log_change':newest_log.isoformat(),'newest_feed_change':newest_feed.isoformat() if newest_feed else None,'feed_rows':len(feed)}
    if newest_feed is None or (newest_log-newest_feed).total_seconds()>FEED_LAG_HOURS*3600:
        return fail(f"The Ads change feed is more than {FEED_LAG_HOURS} hours behind Meta's activity log.",evidence=evidence)
    return ok("The Ads change feed keeps up with Meta's activity log.",evidence=evidence)

CHECKS=(
 Check('native-source-readiness','supabase','Native source readiness','The cockpit history must have verified coverage.','high','Native source-state rows and matching source counts.','Missing, unready or mismatched source evidence.',run_sources,owner='the systems manager',action='Review the protected reconciliation plan. Apply only after approval.',confirm=2,urgent=True),
 Check('native-source-producer','workers','Native source producer','A real publication is required to verify the source producer.','high','The latest published cockpit_native_media_runs receipt.','No receipt or no publication within 90 minutes.',run_producer,owner='Hermes',action='Read the worker doctor, flock schedule and publication receipt.',confirm=3),
 Check('native-change-feed','supabase','Ads change feed','Campaign changes and the learning guard in the media buyer cockpit stop updating.','medium',"The newest adChanges row in cockpit_media_sources against the newest campaign, ad set or ad change in cockpit_csm_meta_activities.",f'The feed is more than {FEED_LAG_HOURS} hours behind the log.',run_change_feed,owner='Hermes',action="Check that hermes/cockpit-sync reads cockpit_csm_meta_activities and that hermes/csm-calls still fills it.",confirm=2),
 Check('native-worker-summary','workers','Native worker evidence','Every replacement producer needs an independent successful reading.','high','The native monitor snapshot contract.','Missing publisher, required worker, timestamp or successful reading.',run_native,owner='Hermes',action='Verify the snapshot publisher and every worker before switching monitoring.',confirm=2,urgent=True),
)
