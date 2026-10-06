import base64
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).with_name('plan-cockpit-storage-import.py')


class StorageImportTests(unittest.TestCase):
    def snapshot(self, root, app, file_id='file-one', content=b'fixture-image', table='adStills', referenced=True, corrupt=False):
        deployment = {'media-buyer': 'adorable-seahorse-418', 'client-success': 'impressive-dinosaur-375'}[app]
        archive = root / (app + '.zip')
        checksum = hashlib.sha256(content).digest()
        storage = {'_id': file_id, '_creationTime': 1, 'sha256': base64.b64encode(checksum).decode(), 'size': len(content), 'contentType': 'image/jpeg', 'internalId': 'recorded-internal-id'}
        owner = {'_id': 'original-owner', '_creationTime': 1, 'key': 'c:123456', 'storageId': file_id, 'status': 'saved'}
        tables = {'_tables': [{'name': table, 'id': 2}], '_storage': [storage], table: [owner] if referenced else []}
        with zipfile.ZipFile(archive, 'w') as zipped:
            for name, rows in tables.items():
                zipped.writestr(name + '/documents.jsonl', ''.join(json.dumps(row) + '\n' for row in rows))
            zipped.writestr('_storage/' + file_id + '.jpeg', b'altered-image' if corrupt else content)
        return {'cockpit': app, 'deployment': deployment, 'path': str(archive), 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'captured_at': '2026-10-06T00:00:00+00:00', 'tables': {name: len(rows) for name, rows in tables.items()}}

    def run_plan(self, root, snapshots):
        manifest = root / 'manifest.json'
        plan = root / 'plan.json'
        manifest.write_text(json.dumps({'snapshots': snapshots}), encoding='utf-8')
        result = subprocess.run([sys.executable, str(SCRIPT), '--manifest', str(manifest), '--plan', str(plan)], capture_output=True, text=True)
        return result, json.loads(plan.read_text()) if plan.exists() else None

    def test_same_source_id_in_two_apps_never_merges_different_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result, plan = self.run_plan(root, [self.snapshot(root, 'media-buyer', content=b'first-image'), self.snapshot(root, 'client-success', content=b'different-image')])
            self.assertEqual(result.returncode, 0, result.stderr)
            files = plan['files']
            self.assertEqual({file['source_app'] for file in files}, {'media-buyer', 'client-success'})
            self.assertEqual(len({file['sha256'] for file in files}), 2)
            self.assertEqual({owner['source_id'] for file in files for owner in file['owners']}, {'original-owner'})

    def test_corrupt_bytes_cannot_receive_verified_file_mapping(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result, plan = self.run_plan(root, [self.snapshot(root, 'media-buyer', corrupt=True)])
            self.assertNotEqual(result.returncode, 0)
            self.assertIsNone(plan)

    def test_orphan_file_is_preserved_privately_not_published(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result, plan = self.run_plan(root, [self.snapshot(root, 'media-buyer', referenced=False)])
            self.assertEqual(result.returncode, 0, result.stderr)
            file = plan['files'][0]
            self.assertEqual(file['visibility'], 'private')
            self.assertIsNone(file['public_url'])
            self.assertFalse(file['verified'])
            self.assertEqual(file['owners'], [])

    def test_non_ad_image_owner_is_not_put_in_public_ad_bucket(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result, plan = self.run_plan(root, [self.snapshot(root, 'media-buyer', table='privateNotes')])
            self.assertEqual(result.returncode, 0, result.stderr)
            file = plan['files'][0]
            self.assertEqual(file['visibility'], 'private')
            self.assertIsNone(file['public_url'])
            self.assertEqual(file['owners'][0]['source_table'], 'privateNotes')

    def test_saved_still_has_exact_owner_and_stable_content_address(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result, plan = self.run_plan(root, [self.snapshot(root, 'media-buyer')])
            self.assertEqual(result.returncode, 0, result.stderr)
            file = plan['files'][0]
            self.assertEqual(file['visibility'], 'public-ad-image')
            self.assertEqual(file['owners'][0]['field'], 'storageId')
            self.assertEqual(file['owners'][0]['still_key'], 'c:123456')
            self.assertTrue(file['public_url'].endswith('/' + file['sha256']))
            self.assertFalse(file['verified'])
            self.assertEqual(plan['external_writes'], 0)


if __name__ == '__main__':
    unittest.main()
