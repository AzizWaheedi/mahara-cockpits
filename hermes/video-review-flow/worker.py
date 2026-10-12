#!/usr/bin/env python3
"""Video review transitions and client decisions, with durable provider receipts."""
from __future__ import annotations
import argparse, datetime as dt, fcntl, hashlib, importlib.util, json, os, re, sqlite3, sys, time, urllib.parse, urllib.request, urllib.error, uuid
from pathlib import Path

spec = importlib.util.spec_from_file_location('assignments', Path(__file__).resolve().parents[1]/'task-assignment-alerts/worker.py')
assignment = importlib.util.module_from_spec(spec); spec.loader.exec_module(assignment)
VIDEO_LIST = assignment.VIDEO_LIST
CUT_FIELD = 'c2aa2852-0370-4c94-bb78-6dfc56eb2aaf'
CSM = 'C09RZ0GS0V9'; EDITORS = 'C0BJF7RR09Y'; BUYERS = 'C0C8DLZGTMZ'
REVIEW_BASE = 'https://cockpit.maharamedia.com/editor/review/'


def cut(task):
    return next((f.get('value') for f in task.get('custom_fields',[]) if f.get('id') == CUT_FIELD), None)

def state(task):
    return str(task.get('status',{}).get('status','')).lower()

def fingerprint(task):
    return hashlib.sha256(json.dumps([state(task),cut(task)],ensure_ascii=False).encode()).hexdigest()

def event_id(key):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, 'mahara:video-review:'+key))

def open_db(path, bootstrap=False):
    if not Path(path).exists() and not bootstrap:
        raise RuntimeError('Review ledger is missing. Restore and reconcile it before sending.')
    db=sqlite3.connect(path); db.row_factory=sqlite3.Row
    db.executescript('''PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    create table if not exists meta(key text primary key,value text not null);
    create table if not exists tasks(id text primary key, fingerprint text not null, generation integer not null);
    create table if not exists actions(id text primary key,kind text not null,task_id text not null,payload text not null,state text not null default 'queued',receipt text,error text,attempts integer not null default 0,created_at real not null,sent_at real);
    ''')
    return db

def enqueue(db,key,kind,task_id,payload):
    db.execute('insert or ignore into actions(id,kind,task_id,payload,created_at) values(?,?,?,?,?)',
        (event_id(key),kind,task_id,json.dumps(payload,ensure_ascii=False),time.time()))

class API(assignment.API):
    def mutate(self, provider, path, body, method='POST'):
        if provider=='ClickUp':
            base='https://api.clickup.com/api/v2/'; headers={'Authorization':self.env['CLICKUP_API_TOKEN']}
        elif provider=='Supabase':
            base=self.env['DESK_SUPABASE_URL'].rstrip('/')+'/rest/v1/'
            assert base=='https://bldgtotkfmhoxmlzowdx.supabase.co/rest/v1/'
            headers={'Authorization':'Bearer '+self.env['DESK_SUPABASE_KEY'],'apikey':self.env['DESK_SUPABASE_KEY'],'Prefer':'return=representation'}
        else: raise ValueError('Unknown provider')
        try:
            req=urllib.request.Request(base+path,data=json.dumps(body).encode(),method=method,headers={**headers,'Content-Type':'application/json'})
            with self.opener(req,timeout=25) as r: raw=r.read()
            return json.loads(raw) if raw.strip() else None
        except urllib.error.HTTPError as e:
            raise assignment.ProviderError(provider, str(e.code), retry=e.code==429, ambiguous=e.code>=500) from None
        except (OSError,ValueError):
            raise assignment.ProviderError(provider,'Unknown result',ambiguous=True) from None

    def rows(self, table, query=''):
        rows=self.request('Supabase',table+'?'+query)
        if not isinstance(rows,list): raise ValueError('Incomplete review data')
        return rows

    def comment_receipt(self, task_id, marker):
        start=''
        for _ in range(30):
            data=self.request('ClickUp','task/'+task_id+'/comment'+start)
            rows=data.get('comments')
            if not isinstance(rows,list): raise ValueError('Incomplete comment history')
            for row in rows:
                if marker in str(row.get('comment_text','')): return str(row['id'])
            if len(rows)<25:return None
            last=rows[-1];start='?'+urllib.parse.urlencode({'start':last['date'],'start_id':last['id']})
        return None

    def roles(self, role, client=None):
        members=self.rows('cockpit_members','select=email,roles,clients&active=eq.true')
        eligible=[m['email'].lower() for m in members if role in m['roles'] and 'admin' not in m['roles'] and
            (not m['clients'] or client and any(str(c).strip().lower()==client.strip().lower() for c in m['clients']))]
        users=self.users()
        if not eligible or any(e not in users for e in eligible): raise ValueError('The reviewer or buyer Slack identity needs repair')
        return sorted({users[e] for e in eligible})

    def link(self, token):
        rows=self.rows('review_links','select=*&token=eq.'+urllib.parse.quote(token))
        if len(rows)!=1: raise ValueError('Review identity unavailable')
        return rows[0]

    def valid_link(self, link, task):
        return bool(not link['revoked'] and link['flow_task_id']==task['id'] and
            task.get('list',{}).get('id')==VIDEO_LIST and 'parent' in task and task['parent'] is None and not task.get('archived')
            and state(task)!='cancelled' and cut(task)==link['flow_source_url'] and
            (not link.get('expires_at') or dt.datetime.fromisoformat(link['expires_at']).timestamp()>time.time()))


def observe(db,tasks,baseline=False):
    with db:
        for task in tasks:
            if task.get('list',{}).get('id')!=VIDEO_LIST or 'parent' not in task: raise ValueError('Wrong video source')
            old=db.execute('select * from tasks where id=?',(task['id'],)).fetchone()
            fp=fingerprint(task); changed=old is None or old['fingerprint']!=fp
            generation=(old['generation'] if old else 0)+int(changed)
            db.execute('insert into tasks values(?,?,?) on conflict(id) do update set fingerprint=excluded.fingerprint,generation=excluded.generation',(task['id'],fp,generation))
            if baseline or not changed or not assignment.eligible(task,VIDEO_LIST): continue
            phase=state(task)
            if phase in ('internal review','internal approved','client approved'):
                enqueue(db,f"phase:{task['id']}:{generation}",'phase',task['id'],{'phase':phase,'fingerprint':fp})


def plan_reviews(db,api):
    links=api.rows('review_links','select=*&flow_task_id=not.is.null&revoked=eq.false&limit=1000')
    if len(links)>=1000: raise ValueError('Review paging needs expansion')
    errors=[]
    for link in links:
        try: plan_review(db,api,link)
        except Exception as exc:
            errors.append(str(exc) if isinstance(exc,(ValueError,assignment.ProviderError)) else 'Review source check failed')
    return errors


def plan_review(db,api,link):
    task=api.task(link['flow_task_id'])
    if not api.valid_link(link,task):
        api.mutate('Supabase','review_links?token=eq.'+urllib.parse.quote(link['token']),{'revoked':True,'flow_sync_error':'The cut or task changed. Prepare a new review.'},'PATCH')
        return
    if state(task)=='live 🚀':return
    if not link['flow_ready_at']:
        if state(task) not in ('internal approved','client review'):
            api.mutate('Supabase','review_links?token=eq.'+urllib.parse.quote(link['token']),{'flow_sync_error':'The task must be internally approved before client review.'},'PATCH');return
        if state(task)=='internal approved': api.mutate('ClickUp','task/'+task['id'],{'status':'client review'},'PUT')
        confirmed=api.task(task['id'])
        if state(confirmed)!='client review' or not api.valid_link(link,confirmed): raise ValueError('Client review status was not confirmed')
        api.mutate('Supabase','editor_jobs?task_id=eq.'+task['id'],{'status':'client review'},'PATCH')
        api.mutate('Supabase','review_links?token=eq.'+urllib.parse.quote(link['token']),{'flow_ready_at':assignment.utc(),'flow_sync_error':None},'PATCH')
    items=api.rows('review_items','select=id,task_id,decision,decided_at&token=eq.'+urllib.parse.quote(link['token']))
    if len(items)!=1 or items[0]['task_id']!=task['id']: raise ValueError('Review item/task binding is invalid')
    item=items[0]
    notes=api.rows('review_notes','select=id,body,at_seconds,task_id&item_id=eq.'+urllib.parse.quote(item['id'])+'&order=id&limit=1000')
    if len(notes)>=1000:raise ValueError('Review note paging needs expansion')
    with db:
        for note in notes:
            if note['task_id']!=task['id']: raise ValueError('Comment task binding is invalid')
            enqueue(db,'note:'+str(note['id']),'comment',task['id'],{'token':link['token'],'note':note,'who':link.get('reviewer_name') or link['client_name']})
        if item['decision']:
            enqueue(db,'decision:'+item['id']+':'+str(item['decided_at']),'decision',task['id'],{'token':link['token'],'item':item,'who':link.get('reviewer_name') or link['client_name']})

def finish(db,row,state_,receipt=None,error=None):
    with db:db.execute('update actions set state=?,receipt=?,error=? where id=?',(state_,receipt,error,row['id']))


def slack_payload(row,task,channel,text,buttons):
    return {'channel':channel,'client_msg_id':row['id'],'text':text+' VR-'+row['id'],
        'unfurl_links':False,'unfurl_media':False,'blocks':[
        {'type':'section','text':{'type':'mrkdwn','text':text}},
        {'type':'actions','elements':[{'type':'button','text':{'type':'plain_text','text':label},'url':url} for label,url in buttons]}]}


def dispatch(db,api):
    # An interrupted send may have arrived. Only provider history can clear it.
    with db:db.execute("update actions set state='unknown' where state='sending'")
    for row in db.execute("select * from actions where state in('queued','unknown') order by created_at limit 50").fetchall():
        try: process_action(db,api,row)
        except Exception as exc:
            current=db.execute("select state from actions where id=?",(row["id"],)).fetchone()[0]
            finish(db,row,"unknown" if current in ('sending','unknown') else "queued",error=str(exc) if isinstance(exc,(ValueError,assignment.ProviderError)) else "Source check failed")
    # Accepted feedback becomes a separate durable editor alert. This also
    # recovers a crash after the ClickUp receipt and before enqueueing Slack.
    with db:
        for row in db.execute("select * from actions where kind='comment' and state='accepted'").fetchall():
            p=json.loads(row['payload'])
            enqueue(db,'feedback:'+row['id'],'feedback_slack',row['task_id'],{'token':p['token'],'text':p['note']['body'][:1500]})


def process_action(db,api,row):
    p=json.loads(row['payload']); marker='VR-'+row['id']; task=api.task(row['task_id'])
    if not assignment.eligible(task,VIDEO_LIST):finish(db,row,'skipped');return
    payload=None; target=None; comment=None
    if row['kind']=='phase':
        if fingerprint(task)!=p['fingerprint']:finish(db,row,'skipped');return
        phase=p['phase']; task_url='https://app.clickup.com/t/'+task['id']
        buttons=[('Open video task',task_url)]
        if phase=='internal review':
            mentions=sorted(set(api.roles('creative')+api.roles('csm')))
            text='*Video ready for internal review*\n'+assignment.escape(task['name'])+'\n'+' '.join('<@'+x+'>' for x in mentions)+'\nApprove the cut in ClickUp as Internal Approved, or leave changes on the task.'
            if not cut(task):text+='\nThe Edited Video Link is missing. Add it before client review.'
            channel=CSM
        elif phase=='internal approved':
            mentions=api.roles('csm');channel=CSM
            text='*Prepare the client review*\n'+assignment.escape(task['name'])+'\n'+' '.join('<@'+x+'>' for x in mentions)+'\nThe internal review is approved. Prepare the link, then send it to the client.'
            buttons.insert(0,('Prepare client link','https://cockpit.maharamedia.com/client-success/inbox?videoTask='+task['id']))
        else:
            if not isinstance(cut(task),str) or not cut(task).startswith('https://'):
                raise ValueError('The approved cut link is missing. No launch alert was sent.')
            links=api.rows('review_links','select=token,flow_source_url&flow_task_id=eq.'+task['id']+'&revoked=eq.false')
            if links:
                if len(links)!=1 or links[0]['flow_source_url']!=cut(task):finish(db,row,'skipped');return
                decisions=api.rows('review_items','select=decision&token=eq.'+urllib.parse.quote(links[0]['token']))
                if len(decisions)!=1 or decisions[0]['decision']!='approved':finish(db,row,'skipped');return
            jobs=api.rows('editor_jobs','select=client_task_id&task_id=eq.'+task['id'])
            if len(jobs)!=1 or not jobs[0]['client_task_id']:raise ValueError('Approved video client mapping is missing')
            clients=api.rows('editor_clients','select=name&task_id=eq.'+urllib.parse.quote(jobs[0]['client_task_id']))
            if len(clients)!=1 or not clients[0]['name']:raise ValueError('Approved video client card is unavailable')
            # The first video tag can be an alias or production label. Scope
            # the buyer against the resolved client card, as the staff RPC does.
            mentions=api.roles('media_buyer',clients[0]['name']);channel=BUYERS
            text='*Client approved: ready to launch*\n'+assignment.escape(task['name'])+'\n'+' '.join('<@'+x+'>' for x in mentions)+'\nLaunch the approved cut, then move this task to Live after the ad is running.'
        payload=slack_payload(row,task,channel,text,buttons)
    else:
        link=api.link(p['token'])
        if not api.valid_link(link,task) or not link['flow_ready_at']:finish(db,row,'skipped');return
        if row['kind']=='comment':
            n=p['note'];stamp='' if n['at_seconds'] is None else f" ({int(n['at_seconds'])//60}:{int(n['at_seconds'])%60:02d})"
            comment=f"Client video feedback from {p['who']}{stamp}:\n{n['body']}\n\n{marker}"
        elif row['kind']=='decision':
            items=api.rows('review_items','select=decision,decided_at&id=eq.'+urllib.parse.quote(p['item']['id']))
            if len(items)!=1 or items[0]['decided_at']!=p['item']['decided_at'] or items[0]['decision']!=p['item']['decision']:finish(db,row,'skipped');return
            target='client approved' if p['item']['decision']=='approved' else 'update required'
            if state(task) not in ('client review','client approved','update required'):finish(db,row,'skipped');return
            # A status PUT is idempotent. Re-read before an uncertain retry.
            if state(task)!=target:api.mutate('ClickUp','task/'+task['id'],{'status':target},'PUT')
            current=api.task(task['id'])
            if state(current)!=target or not api.valid_link(link,current):raise ValueError('Client decision status not confirmed')
            api.mutate('Supabase','editor_jobs?task_id=eq.'+task['id'],{'status':target},'PATCH')
            comment=f"Client review: {p['item']['decision']}\nReviewed by: {p['who']}\n{REVIEW_BASE}{p['token']}\n\n{marker}"
        elif row['kind']=='feedback_slack':
            text='*Client video feedback*\n'+assignment.escape(task['name'])+'\n'+assignment.escape(p['text'])+'\nThe comments are saved on the ClickUp task.'
            payload=slack_payload(row,task,EDITORS,text,[('Read client comments','https://app.clickup.com/t/'+task['id'])])
    try:
        if row['state']=='unknown':
            receipt=api.find_receipt(payload['channel'],row['id'],int(row['sent_at']*1000)) if payload else api.comment_receipt(task['id'],marker)
            if receipt:finish(db,row,'accepted',receipt)
            return
        with db:db.execute("update actions set state='sending',attempts=attempts+1,sent_at=? where id=?",(time.time(),row['id']))
        if payload:receipt=api.send(payload)
        else:
            result=api.mutate('ClickUp','task/'+task['id']+'/comment',{'comment_text':comment,'notify_all':False})
            if not result or not result.get('id'):raise assignment.ProviderError('ClickUp','Missing comment receipt',ambiguous=True)
            receipt=str(result['id'])
        finish(db,row,'accepted',receipt)
    except assignment.ProviderError as exc:
        finish(db,row,'unknown' if exc.ambiguous else 'queued' if exc.retry and row['attempts']<4 else 'failed',error=str(exc))

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--config',required=True);parser.add_argument('--state-dir',required=True);parser.add_argument('--bootstrap',action='store_true')
    args=parser.parse_args();os.umask(0o077);folder=Path(args.state_dir);folder.mkdir(mode=0o700,parents=True,exist_ok=True)
    with (folder/'worker.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:return
        config=json.loads(Path(args.config).read_text());api=API(json.loads(Path(config['credentials_file']).read_text()));db=open_db(folder/'ledger.sqlite3',args.bootstrap)
        ready=db.execute("select value from meta where key='ready'").fetchone()
        if bool(ready)==args.bootstrap:raise RuntimeError('Use one explicit baseline; preserve the ledger after installation.')
        errors=[]
        try:
            observe(db,api.tasks(VIDEO_LIST),args.bootstrap)
            if args.bootstrap:
                with db:db.execute("insert into meta values('ready',?)",(assignment.utc(),))
            elif config.get('apply') is True:
                errors.extend(plan_reviews(db,api));dispatch(db,api)
        except Exception as exc:errors=[str(exc) if isinstance(exc,(ValueError,assignment.ProviderError)) else 'Review worker failed; inspect locally']
        states=dict(db.execute('select state,count(*) from actions group by state').fetchall())
        overdue=db.execute("select count(*) from actions where state='queued' and created_at<?",(time.time()-900,)).fetchone()[0]
        report={'apply':config.get('apply') is True,'at':assignment.utc(),'healthy':not errors and not overdue and not any(states.get(s) for s in ('unknown','failed')),'errors':errors,'states':states}
        stamp=assignment.utc()
        api.request('Supabase','cockpit_sync_state?on_conflict=key',{'key':'video-review-flow','last_run_at':stamp,'updated_at':stamp,'ok':report['healthy'],'note':json.dumps(report),'rows_seen':len(states)}, {'Prefer':'resolution=merge-duplicates,return=minimal'})
        with db:db.execute("insert into meta values('health',?) on conflict(key) do update set value=excluded.value",(json.dumps(report),))
        backup=folder/('ledger-'+dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d')+'.sqlite3')
        if not backup.exists():
            with sqlite3.connect(backup) as other:db.backup(other)
        for old in sorted(folder.glob('ledger-20*.sqlite3'))[:-7]:old.unlink()
        print(json.dumps(report),flush=True)
        if not report['healthy']:raise SystemExit(1)

if __name__=='__main__': main()
