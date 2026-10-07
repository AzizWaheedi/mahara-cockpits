"""Plan finite archive-file migration. Read-only by default and by design.

A source checksum proves captured bytes, not a successful native upload.
Only recorded ad-still ownership permits a public ad-image destination.
Private or unreferenced bytes remain private. This program never uploads.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
import re
import sys
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit

SPEC = importlib.util.spec_from_file_location('cockpit_runtime_file_contract', Path(__file__).with_name('import-cockpit-runtime-sources.py'))
contracts = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(contracts)
PUBLIC_BUCKET = 'cockpit-ad-stills'
PRIVATE_BUCKET = 'cockpit-legacy-files'
FILE_ID = re.compile(r'^[A-Za-z0-9_-]{1,128}$')
STILL_KEY = re.compile(r'^[ca]:[0-9]{5,}$')
IMAGE_TYPES = {'image/jpeg', 'image/png', 'image/webp', 'image/gif'}


def references(value, ids, deployment, field=''):
    if isinstance(value, dict):
        for key, child in value.items():
            path = field + '.' + key if field else key
            if key == '_id':
                continue
            if isinstance(child, str) and child in ids:
                yield child, path
            elif isinstance(child, str):
                parsed = urlsplit(child)
                if parsed.scheme == 'https' and parsed.hostname in (deployment + '.convex.cloud', deployment + '.convex.site'):
                    candidate = unquote(parsed.path.rstrip('/').split('/')[-1])
                    if candidate in ids and '/storage/' in parsed.path:
                        yield candidate, path
            else:
                yield from references(child, ids, deployment, path)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from references(child, ids, deployment, field + '[' + str(index) + ']')


def build_plan(manifest):
    if not isinstance(manifest, dict) or not isinstance(manifest.get('snapshots'), list) or not manifest['snapshots']:
        raise ValueError('Complete explicit snapshot manifest required')
    apps = [item.get('cockpit', item.get('app')) for item in manifest['snapshots']]
    if len(apps) != len(set(apps)):
        raise ValueError('Duplicate application snapshot')
    files, sources = [], []
    for source in manifest['snapshots']:
        snapshot = contracts.load_snapshot(source)
        catalog = snapshot['tables'].get('_storage')
        if catalog is None:
            raise ValueError('Complete storage catalog required')
        records = {row['_id']: row for row in catalog}
        if any(not FILE_ID.fullmatch(key) for key in records):
            raise ValueError('Invalid storage identity')
        owners = defaultdict(list)
        for table, rows in snapshot['tables'].items():
            if table in ('_tables', '_storage'):
                continue
            for row in rows:
                for storage_id, field in references(row, records, snapshot['deployment']):
                    owners[storage_id].append({'source_table': table, 'source_id': row['_id'], 'field': field, 'still_key': row.get('key') if table == 'adStills' else None})
        with zipfile.ZipFile(snapshot['path']) as archive:
            members = [name for name in archive.namelist() if name.startswith('_storage/') and name != '_storage/documents.jsonl' and not name.endswith('/')]
            by_id = defaultdict(list)
            for name in members:
                if len(Path(name).parts) != 2 or '..' in Path(name).parts:
                    raise ValueError('Unsafe storage member path')
                by_id[Path(name).stem].append(name)
            if set(by_id) != set(records) or any(len(names) != 1 for names in by_id.values()):
                raise ValueError('Storage file/catalog inventory is missing or ambiguous')
            declared_files = source.get('storage')
            declared = {item['path']: item for item in declared_files} if declared_files is not None else None
            if declared is not None and (len(declared) != len(declared_files) or set(declared) != set(members)):
                raise ValueError('Storage checksum manifest does not match exact files')
            for storage_id, record in sorted(records.items()):
                member = by_id[storage_id][0]
                content = archive.read(member)
                digest = hashlib.sha256(content).digest()
                sha256 = digest.hex()
                try:
                    recorded_digest = base64.b64decode(record['sha256'], validate=True)
                except (ValueError, TypeError, KeyError):
                    raise ValueError('Invalid source storage checksum') from None
                if recorded_digest != digest or record.get('size') != len(content):
                    raise ValueError('Storage bytes checksum or size mismatch')
                if declared is not None and (declared[member].get('sha256') != sha256 or declared[member].get('bytes') != len(content)):
                    raise ValueError('Storage checksum differs from protected manifest')
                ownership = sorted(owners.get(storage_id, []), key=lambda owner: (owner['source_table'], owner['source_id'], owner['field']))
                public = bool(ownership) and record.get('contentType') in IMAGE_TYPES and all(owner['source_table'] == 'adStills' and isinstance(owner['still_key'], str) and STILL_KEY.fullmatch(owner['still_key']) for owner in ownership)
                bucket = PUBLIC_BUCKET if public else PRIVATE_BUCKET
                files.append({
                    'source_app': snapshot['app'], 'source_deployment': snapshot['deployment'],
                    'source_storage_id': storage_id, 'source_archive': snapshot['path'],
                    'source_archive_sha256': snapshot['sha256'], 'source_member': member,
                    'source_record': record, 'owners': ownership,
                    'sha256': sha256, 'bytes': len(content), 'content_type': record.get('contentType'),
                    'visibility': 'public-ad-image' if public else 'private', 'bucket': bucket,
                    'storage_path': sha256, 'verified': False,
                    'public_url': contracts.PROJECT_URL + '/storage/v1/object/public/' + bucket + '/' + sha256 if public else None,
                })
        sources.append({'source_app': snapshot['app'], 'deployment': snapshot['deployment'], 'path': snapshot['path'], 'sha256': snapshot['sha256'], 'captured_at': snapshot['captured_at'], 'files': len(catalog)})
    counts = Counter(file['visibility'] for file in files)
    return {
        'dry_run': True, 'external_writes': 0, 'project_ref': contracts.PROJECT_REF,
        'created_at': datetime.now(timezone.utc).isoformat(), 'sources': sources, 'files': files,
        'summary': {'source_files': len(files), 'unique_content_hashes': len({file['sha256'] for file in files}), 'public_ad_images': counts['public-ad-image'], 'private_retention_files': counts['private']},
        'ready_for_upload': True, 'verified_native_mappings': 0,
        'next_step': 'Upload one reviewed object through the native fenced storage helper and verify its bytes. Source checksums never imply a completed upload.',
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--plan', type=Path, required=True)
    args = parser.parse_args()
    manifest_path = contracts.core.ensure_outside_repo(args.manifest)
    output_path = contracts.core.ensure_outside_repo(args.plan)
    plan = build_plan(json.loads(manifest_path.read_text(encoding='utf-8')))
    data = json.dumps(plan, sort_keys=True, indent=2, ensure_ascii=False, allow_nan=False).encode()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(output_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, 'wb') as output:
        output.write(data)
    print(json.dumps({'dry_run': True, 'external_writes': 0, 'plan': str(output_path), 'plan_sha256': hashlib.sha256(data).hexdigest(), **plan['summary']}))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, zipfile.BadZipFile) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
