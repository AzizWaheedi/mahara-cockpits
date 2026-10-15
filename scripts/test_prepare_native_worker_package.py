import ast,importlib.util,json,re,tempfile,unittest,zipfile,hashlib
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
    def test_helper_families_are_explicitly_hashed_and_packaged(self):
        helpers=[
            'hermes/webinar-pull/pull.py',
            'hermes/webinar-pull/test_pull.py',
            'hermes/eod-out/out.py',
            'hermes/eod-out/test_out.py',
            'hermes/eod-out/RUNBOOK.md',
            'hermes/team-sync/sync.py',
            'hermes/team-sync/test_sync.py',
            'hermes/team-sync/README.md',
        ]
        plan=module.build_plan(self.root)
        paths={row['path'] for row in plan['files']}
        for h in helpers:
            self.assertIn(h, paths)
        self.assertIn('python3 hermes/eod-out/out.py --doctor', plan['doctors'])
        self.assertIn('python3 hermes/team-sync/sync.py doctor', plan['doctors'])
        self.assertIn('python3 hermes/webinar-pull/pull.py doctor', plan['doctors'])
        out=Path(self.temp.name)/'bundle_helpers.zip'
        module.materialize(self.root,plan,out)
        with zipfile.ZipFile(out) as z:
            manifest=json.loads(z.read('manifest.json'))
            by_path={r['path']:r for r in manifest['files']}
            for h in helpers:
                self.assertIn(h, by_path)
                self.assertEqual(hashlib.sha256(z.read(h)).hexdigest(), by_path[h]['sha256'])
        for h in helpers:
            modified_plan=module.build_plan(self.root)
            (self.root/h).write_text('// modified content\n')
            with self.assertRaises(ValueError):
                module.materialize(self.root, modified_plan, Path(self.temp.name)/f'invalid_{Path(h).name}.zip')
            (self.root/h).write_text('// fixture\n')
    def test_runtime_symlinks_are_refused(self):
        required=self.root/module.REQUIRED[0];required.unlink();target=Path(self.temp.name)/'external.ts';target.write_text('// outside\n')
        try:required.symlink_to(target)
        except OSError:self.skipTest('Windows symlink privilege unavailable')
        with self.assertRaises(ValueError):module.build_plan(self.root)

    def test_native_csm_inbox_files_and_doctor_included_and_verified(self):
        inbox_files = ['hermes/inbox/inbox.py', 'hermes/inbox/tools.py']
        plan = module.build_plan(self.root)
        paths = {row['path'] for row in plan['files']}
        for f in inbox_files:
            self.assertIn(f, paths)
        self.assertIn('python3 hermes/inbox/inbox.py --source-only --doctor', plan['doctors'])
        self.assertIn('GHL_MAHARA_PIT', plan['configuration_names'])
        self.assertIn('GHL_MAHARA_LOCATION', plan['configuration_names'])
        self.assertIn('DEEPSEEK_API_KEY', plan['configuration_names'])

        # Missing inbox files fail build_plan
        (self.root / 'hermes/inbox/inbox.py').unlink()
        with self.assertRaises(ValueError):
            module.build_plan(self.root)
        (self.root / 'hermes/inbox/inbox.py').write_text('// fixture\n')

        # Credentials remain excluded
        inbox_secret = self.root / 'hermes/inbox/.env'
        inbox_secret.write_text('GHL_MAHARA_PIT=secret_token\nDEEPSEEK_API_KEY=secret_key\n')
        plan_with_secret = module.build_plan(self.root)
        self.assertNotIn('hermes/inbox/.env', {r['path'] for r in plan_with_secret['files']})


# The four entry points the native release runs. Every file their value
# imports reach (relative imports only; packages come from the frozen
# installs) must be in REQUIRED, or the release stops with "Cannot find
# module" on the VPS (2026-10-11: linkCtr.js, finance/targets.ts and
# churnCore.ts were reached and not listed, and convex.py was listed after
# 48339a6 deleted it, so the script could not build a release from main).
ENTRY_POINTS=(
    'hermes/ceo-refresh/worker.ts',
    'hermes/cockpit-sync/worker.ts',
    'hermes/media-native/worker.ts',
    'hermes/media-native/doctor.ts',
)
_BLOCK=re.compile(r'/\*.*?\*/',re.S)
_STATIC=re.compile(r'^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*["\']([^"\']+)["\']',re.M|re.S)
_BARE=re.compile(r'^\s*import\s*["\']([^"\']+)["\']',re.M)
_DYNAMIC=re.compile(r'\b(?:import|require)\(\s*["\']([^"\']+)["\']\s*\)')

def _specifiers(text):
    text=_BLOCK.sub('',text)
    text='\n'.join(line for line in text.split('\n') if not line.lstrip().startswith('//'))
    for pattern in (_STATIC,_BARE,_DYNAMIC):
        for match in pattern.finditer(text):yield match.group(1)

def _resolve(importer,specifier):
    base=importer.parent/specifier
    candidates=[base]
    if base.suffix in ('.js','.mjs'):candidates.append(base.with_suffix('.ts'))
    candidates+=[Path(str(base)+ext) for ext in ('.ts','.js','.tsx','.mjs')]+[base/'index.ts',base/'index.js']
    for candidate in candidates:
        if candidate.is_file():return candidate.resolve()
    raise AssertionError(f'{importer}: cannot resolve {specifier}')

def runtime_imports(root):
    root=Path(root).resolve();seen=set();todo=[(root/name).resolve() for name in ENTRY_POINTS]
    while todo:
        path=todo.pop()
        if path in seen:continue
        seen.add(path)
        for specifier in _specifiers(path.read_text(encoding='utf-8')):
            if specifier.startswith('.'):todo.append(_resolve(path,specifier))
    return {path.relative_to(root).as_posix() for path in seen}

def _python_module(bases,dotted):
    for base in bases:
        for candidate in (base/(dotted.replace('.','/')+'.py'),base/dotted.replace('.','/')/'__init__.py'):
            if candidate.is_file():return candidate
    return None

def python_imports(root,names):
    """Local modules the listed Python files import (the guardian's checks package, the inbox's tools)."""
    root=Path(root).resolve();reached=set()
    for name in names:
        if not name.endswith('.py'):continue
        path=root/name
        if not path.is_file():continue
        bases=[path.parent]+[p for p in path.parents if root in p.parents and any(p.glob('*.py'))]
        for node in ast.walk(ast.parse(path.read_text(encoding='utf-8'))):
            found=[]
            if isinstance(node,ast.Import):
                found=[_python_module(bases,a.name) for a in node.names]
            elif isinstance(node,ast.ImportFrom) and node.level:
                base=path.parent
                for _ in range(node.level-1):base=base.parent
                found=[_python_module([base],node.module)] if node.module else [_python_module([base],a.name) for a in node.names]
            elif isinstance(node,ast.ImportFrom) and node.module:
                found=[_python_module(bases,node.module)]+[_python_module(bases,f'{node.module}.{a.name}') for a in node.names]
            reached|={f.resolve().relative_to(root).as_posix() for f in found if f}
    return reached

class RepositoryInventoryTests(unittest.TestCase):
    root=Path(__file__).resolve().parents[1]
    def test_every_listed_file_exists_in_the_repository(self):
        missing=[name for name in module.REQUIRED if not (self.root/name).is_file()]
        self.assertEqual(missing,[],'listed runtime files that do not exist: '+', '.join(missing))
    def test_every_file_the_entry_points_import_is_listed(self):
        reached=runtime_imports(self.root)
        for entry in ENTRY_POINTS:self.assertIn(entry,reached)
        unlisted=sorted(reached-set(module.REQUIRED))
        self.assertEqual(unlisted,[],'runtime imports missing from REQUIRED: '+', '.join(unlisted))
    def test_every_local_python_module_the_listed_files_import_is_listed(self):
        # 2026-10-11: checks/__init__.py imports checks/sections.py (48339a6), which was not listed.
        unlisted=sorted(python_imports(self.root,module.REQUIRED)-set(module.REQUIRED))
        self.assertEqual(unlisted,[],'Python modules missing from REQUIRED: '+', '.join(unlisted))
    def test_the_walker_skips_type_only_imports_and_follows_value_ones(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            for name in ENTRY_POINTS:
                p=root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('export {};\n')
            (root/'hermes/ceo-refresh/worker.ts').write_text('import type { T } from "./types";\n// import "./commented";\nimport { a } from "./lib/a.js";\nconst b = await import("./b");\n')
            (root/'hermes/ceo-refresh/lib').mkdir()
            (root/'hermes/ceo-refresh/lib/a.ts').write_text('export * from "../c.js";\n')
            (root/'hermes/ceo-refresh/c.js').write_text('export const c = 1;\n')
            (root/'hermes/ceo-refresh/b.ts').write_text('export {};\n')
            reached=runtime_imports(root)
            self.assertIn('hermes/ceo-refresh/lib/a.ts',reached)
            self.assertIn('hermes/ceo-refresh/c.js',reached)
            self.assertIn('hermes/ceo-refresh/b.ts',reached)
            self.assertNotIn('hermes/ceo-refresh/types.ts',reached)
