"""Verified, staffing-only archive importer. No writes without reviewed SQL deployment and --apply.

The archive SHA and deployment are pinned; unrelated Convex tables are never parsed.
The SQL RPC is one atomic transaction. This tool never marks history ready: a later
source catch-up and end-to-end reconciliation must establish completeness first.
"""
import argparse
import hashlib
import json
import os
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

EXPECTED_SHA256 = 'bd4776356d073380745108ca10f2c19dbb8b194eafd2839d3d277d317c3ff3a8'
DEPLOYMENT = 'adorable-seahorse-418'
PROJECT_REF = 'bldgtotkfmhoxmlzowdx'
EXPECTED_STATUS_IDS = frozenset(('t175rzqxvjcf0mr8f8bxfajyk58exyw6', 't17afqve7mwxm77hbfzc7yn1358ewzd2', 't17bw1gpj3ddmk0tjv9hr49r098exc7a'))
EXPECTED_AUDIT_IDS = frozenset(('ss72tkaepfaaztbqawj0ms37kn8ex9fv', 'ss72xg14svsj7sapb1nwqnzh0h8exs8n', 'ss7956b93544znctktnpvsszjd8ewz1p', 'ss79d8h6zr1f1w8vpgzmehe10d8exxsy', 'ss79xbjch2gnnf7b4g4m74w8m18ewhsf'))


def validate(payload):
    statuses, audits = payload['statuses'], payload['audits']
    if payload.get('source_sha256') != EXPECTED_SHA256 or payload.get('deployment') != DEPLOYMENT:
        raise ValueError('Unapproved source')
    if [len(statuses), len(audits)] != [3, 5] or {r.get('_id') for r in statuses} != EXPECTED_STATUS_IDS or {r.get('_id') for r in audits} != EXPECTED_AUDIT_IDS:
        raise ValueError('Incomplete or duplicate staffing identities')
    keys = [r.get('personKey') for r in statuses]
    if len(set(keys)) != 3 or any(not isinstance(k, str) or not k for k in keys):
        raise ValueError('Invalid person keys')
    for s in statuses:
        if s.get('status') not in ('active', 'paused', 'left') or not isinstance(s.get('since'), str) or not isinstance(s.get('setBy'), str) or not isinstance(s.get('setAt'), (int, float)):
            raise ValueError('Invalid status fields')
    for a in audits:
        if a.get('action') != 'teamStatus.set' or a.get('table') != 'ceoTeamStatus' or a.get('rowId') not in keys or not isinstance(a.get('at'), (int, float)) or not isinstance(a.get('by'), str) or not isinstance(a.get('after'), dict):
            raise ValueError('Invalid staffing audit')
        if a['after'].get('personKey') != a['rowId'] or a['after'].get('setAt') != a['at'] or a['after'].get('setBy') != a['by']:
            raise ValueError('Audit after-state mismatch')
    for s in statuses:
        related = [a for a in audits if a['rowId'] == s['personKey']]
        if not related:
            raise ValueError('Unaudited status')
        latest = max(related, key=lambda a: a['at'])
        if latest['after'] != {k: s[k] for k in ('personKey', 'status', 'since', 'setBy', 'setAt', 'note') if k in s} or latest['at'] != s['setAt']:
            raise ValueError('Final status differs from source history')
    return payload


def prepare(archive_path, manifest_path):
    archive_path, manifest_path = Path(archive_path), Path(manifest_path)
    if hashlib.sha256(archive_path.read_bytes()).hexdigest() != EXPECTED_SHA256:
        raise ValueError('Archive SHA256 mismatch')
    manifest = json.loads(manifest_path.read_text())
    snapshots = manifest.get('snapshots', [])
    if len(snapshots) != 1 or snapshots[0].get('sha256') != EXPECTED_SHA256 or snapshots[0].get('deployment') != DEPLOYMENT or snapshots[0].get('cockpit') != 'media-buyer' or snapshots[0].get('tables', {}).get('ceoTeamStatus') != 3 or snapshots[0].get('tables', {}).get('ceoAudit') != 40:
        raise ValueError('Manifest does not match verified production archive')
    with zipfile.ZipFile(archive_path) as archive:
        def rows(name):
            member = name + '/documents.jsonl'
            if archive.getinfo(member).file_size > 100_000:
                raise ValueError('Scoped source table exceeds reviewed size')
            return [json.loads(line) for line in archive.read(member).splitlines() if line.strip()]
        statuses, all_audits = rows('ceoTeamStatus'), rows('ceoAudit')
    if len(all_audits) != 40:
        raise ValueError('Full source audit count changed')
    related = [r for r in all_audits if r.get('table') == 'ceoTeamStatus' or str(r.get('action', '')).startswith('teamStatus.')]
    return validate({'source_sha256': EXPECTED_SHA256, 'deployment': DEPLOYMENT, 'statuses': statuses, 'audits': related})


def request(url, key, *, payload=None):
    headers = {'apikey': key, 'Authorization': 'Bearer ' + key, 'Accept': 'application/json'}
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=json.dumps(payload).encode() if payload is not None else None, headers=headers, method='POST' if payload is not None else 'GET')
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        # Do not print provider response: it might contain private source rows.
        raise RuntimeError(f'Staffing request rejected: HTTP {error.code}') from None


def readback(base, key, payload):
    root = base + '/rest/v1/'
    statuses = request(root + 'cockpit_team_status?select=person_key,status,since,note,set_by,set_at,source_deployment,source_id,source_record&source_deployment=eq.' + DEPLOYMENT, key)
    audit_filters = urllib.parse.urlencode({
        'source_system': 'eq.convex', 'entity_type': 'eq.cockpit_team_status',
        'metadata->>source_deployment': 'eq.' + DEPLOYMENT,
        'metadata->>source_table': 'eq.ceoAudit',
    })
    audits = request(root + 'cockpit_audit_log?select=id,action,entity_type,entity_id,actor_email,source_app,source_system,before,after,created_at,metadata&' + audit_filters, key)
    source_status = {s['_id']: s for s in payload['statuses']}
    source_audits = {a['_id']: a for a in payload['audits']}
    status_by_id = {r['source_id']: r for r in statuses}
    audit_by_id = {r['metadata']['source_id']: r for r in audits}
    if set(status_by_id) != set(source_status) or set(audit_by_id) != set(source_audits) or len(statuses) != 3 or len(audits) != 5:
        raise RuntimeError('Readback identity/count mismatch; readiness not changed')
    for sid, r in status_by_id.items():
        s = source_status[sid]
        if (r['source_record'] != s or r['source_deployment'] != DEPLOYMENT
                or any(r[k] != s.get(v) for k,v in [('person_key','personKey'),('status','status'),('since','since'),('note','note'),('set_by','setBy')])
                or datetime.fromisoformat(r['set_at'].replace('Z', '+00:00')) != datetime.fromtimestamp(s['setAt']/1000, timezone.utc)):
            raise RuntimeError('Readback status mismatch')
    for aid, r in audit_by_id.items():
        a = source_audits[aid]
        if (r['metadata'] != {'source_table': 'ceoAudit', 'source_deployment': DEPLOYMENT, 'source_id': aid, 'source_record': a}
                or r['action'] != a['action'] or r['entity_type'] != 'cockpit_team_status'
                or r['entity_id'] != a['rowId'] or r['actor_email'] != a['by']
                or r['source_app'] != 'media-buyer' or r['source_system'] != 'convex'
                or r['after'] != a['after'] or r['before'] != a.get('before')
                or datetime.fromisoformat(r['created_at'].replace('Z', '+00:00')) != datetime.fromtimestamp(a['at']/1000, timezone.utc)):
            raise RuntimeError('Readback audit mismatch')
    state = request(root + 'cockpit_team_status_state?select=history_ready&id=eq.true', key)
    if len(state) != 1 or state[0]['history_ready'] is not False:
        raise RuntimeError('Readback readiness unexpected')
    return {'statuses': len(statuses), 'source_audits': len(audits), 'history_ready': False, 'source_status_ids': sorted(status_by_id), 'source_audit_ids': sorted(audit_by_id), 'audit_row_ids': sorted(str(r['id']) for r in audits)}


def production_credentials():
    base = os.getenv('COCKPIT_SUPABASE_URL', '').rstrip('/')
    key = os.getenv('COCKPIT_SUPABASE_KEY')
    if base != 'https://' + PROJECT_REF + '.supabase.co' or not key:
        raise ValueError('Exact cockpit production URL and service role credential required')
    return base, key


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--apply', action='store_true', help='Only after reviewing and deploying scoped migration')
    args = parser.parse_args()
    payload = prepare(args.archive, args.manifest)
    if not args.apply:
        print(json.dumps({'dry_run': True, 'statuses': 3, 'source_audits': 5, 'archive_sha256': EXPECTED_SHA256, 'history_ready_changed': False}))
        return
    base, key = production_credentials()
    response = request(base + '/rest/v1/rpc/cockpit_ceo_staffing_import', key, payload={'p_payload': payload})
    checked = readback(base, key, payload)
    print(json.dumps({'rpc': response, 'readback': checked}))


if __name__ == '__main__':
    main()
