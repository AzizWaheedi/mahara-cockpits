import importlib.util,json,tempfile,unittest,zipfile,hashlib
from pathlib import Path
spec=importlib.util.spec_from_file_location('package_prep',Path(__file__).with_name('prepare-native-worker-package.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)/'source';self.root.mkdir()
        for name in module.REQUIRED:
            p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('{}' if p.suffix=='.json' else '// fixture\n')
    def tearDown(self):self.temp.cleanup()
    def test_plan_never_writes_and_excludes_secrets(self):
        secret=self.root/'hermes/media-native/.env';secret.write_text('FAKE_SECRET=private')
        for name in ['service-account.json','export.json','copied-credential.py','private-notes.md']:
            (self.root/'hermes/media-native'/name).write_text('PRIVATE_ARTIFACT=fixture')
        plan=module.build_plan(self.root);self.assertTrue(plan['dry_run']);self.assertEqual(plan['live_writes'],0)
        self.assertNotIn(str(secret.relative_to(self.root)).replace('\\','/'),{r['path'] for r in plan['files']})
        self.assertTrue(all(not row['path'].endswith(('service-account.json','export.json','copied-credential.py','private-notes.md')) for row in plan['files']))
        self.assertFalse((Path(self.temp.name)/'bundle.zip').exists())

    def test_every_runtime_dependency_scope_has_its_original_manifest_and_lock(self):
        plan=module.build_plan(self.root)
        paths={row['path'] for row in plan['files']}
        self.assertTrue({'package.json','bun.lock','hermes/ceo-refresh/package.json','hermes/ceo-refresh/bun.lock','hermes/media-native/package.json','hermes/media-native/bun.lock'}.issubset(paths))
        self.assertEqual(len(plan['dependency_installs']),3)
        self.assertTrue(all('--frozen-lockfile' in command and '--ignore-scripts' in command for command in plan['dependency_installs']))
        self.assertIn('supabase/functions/cockpit-ceo-api/frequency.ts',paths)
    def test_materialization_is_local_hash_checked_and_never_overwrites(self):
        plan=module.build_plan(self.root);out=Path(self.temp.name)/'bundle.zip';module.materialize(self.root,plan,out)
        with zipfile.ZipFile(out) as z:
            manifest=json.loads(z.read('manifest.json'))
            for row in manifest['files']:self.assertEqual(hashlib.sha256(z.read(row['path'])).hexdigest(),row['sha256'])
        with self.assertRaises(ValueError):module.materialize(self.root,plan,out)
        with self.assertRaises(ValueError):module.materialize(self.root,plan,self.root/'bundle.zip')
    def test_missing_runtime_and_changed_source_are_refused(self):
        required=self.root/module.REQUIRED[0];plan=module.build_plan(self.root);required.write_text('// changed\n')
        with self.assertRaises(ValueError):module.materialize(self.root,plan,Path(self.temp.name)/'changed.zip')
        required.unlink()
        with self.assertRaises(ValueError):module.build_plan(self.root)
    def test_runtime_symlinks_are_refused(self):
        required=self.root/module.REQUIRED[0];required.unlink();target=Path(self.temp.name)/'external.ts';target.write_text('// outside\n')
        try:required.symlink_to(target)
        except OSError:self.skipTest('Windows symlink privilege unavailable')
        with self.assertRaises(ValueError):module.build_plan(self.root)
