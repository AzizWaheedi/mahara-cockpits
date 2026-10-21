import { test, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { nativeFeedDb } from './lib/nativeFeedDb';
import { migration, owner } from '../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb';

type Manifest = Record<string, { count: number; hash: string }>;
type Db = Awaited<ReturnType<typeof nativeFeedDb>>;
const manifest = async (db: Db) => (await db.query<{ result: Manifest }>(
 'SELECT public.cockpit_native_manifest() AS result',
)).rows[0].result;
const compactMigration = '20261021173015_native_manifest_compact_fingerprint.sql';
const legacy = migration('20260927x_cockpit_native_media_sync.sql')
 .match(/CREATE OR REPLACE FUNCTION public\.cockpit_native_manifest\(\)[\s\S]*?END \$\$;/)?.[0];
if (!legacy) throw new Error('Canonical original manifest definition missing');

test('all original input tables and counts remain covered; empty tables are versioned', async () => {
 const db = await nativeFeedDb();
 try {
  await owner(db);
  const compact = await manifest(db);
  await db.exec(legacy);
  const original = await manifest(db);
  expect(Object.keys(compact).sort()).toEqual(Object.keys(original).sort());
  expect(Object.keys(compact)).toHaveLength(20);
  for (const [table, value] of Object.entries(compact)) {
   expect(value.count).toBe(original[table].count);
   expect(value.hash).toMatch(/^v2:sha256:[0-9a-f]{64}$/);
   expect(value.hash).not.toBe(original[table].hash);
   if (value.count === 0) expect(value.hash).toBe('v2:sha256:' + createHash('sha256').digest('hex'));
  }
 } finally { await db.close(); }
}, 30000);

test('full-row edits, inserts, deletes, snapshot changes and human notes change the revision', async () => {
 const db = await nativeFeedDb();
 try {
  await owner(db);
  const hash = async (table: string) => (await manifest(db))[table];
  const before = await hash('cockpit_native_stills');
  await db.exec(`INSERT INTO cockpit_native_stills(key, data) VALUES ('fictional', '{"nested":{"text":"مرحبا","empty":null},"array":[1,2]}')`);
  const inserted = await hash('cockpit_native_stills');
  expect(inserted.count).toBe(before.count + 1);
  expect(inserted.hash).not.toBe(before.hash);
  await db.exec(`UPDATE cockpit_native_stills SET data = jsonb_set(data, '{nested,text}', '"أهلا"') WHERE key='fictional'`);
  const edited = await hash('cockpit_native_stills');
  expect(edited.count).toBe(inserted.count);
  expect(edited.hash).not.toBe(inserted.hash);
  await db.exec(`UPDATE cockpit_native_stills SET data = data #- '{nested,empty}' WHERE key='fictional'`);
  expect((await hash('cockpit_native_stills')).hash).not.toBe(edited.hash);
  await db.exec(`DELETE FROM cockpit_native_stills WHERE key='fictional'`);
  expect(await hash('cockpit_native_stills')).toEqual(before);
  const snapshotBefore = await hash('cockpit_media_source_state');
  await db.exec(`UPDATE cockpit_media_source_state SET source_snapshot_at='2026-01-01T00:00:00Z' WHERE table_name='inbox'`);
  expect((await hash('cockpit_media_source_state')).hash).not.toBe(snapshotBefore.hash);
  const notesBefore = await hash('cockpit_client_profiles');
  await db.exec(`INSERT INTO cockpit_client_profiles(client_name, notes) VALUES ('Fictional', '["A human note"]')`);
  expect((await hash('cockpit_client_profiles')).hash).not.toBe(notesBefore.hash);
 } finally { await db.close(); }
}, 30000);

test('physical row order is irrelevant and duplicate logical payloads remain represented', async () => {
 const db = await nativeFeedDb();
 try {
  await owner(db);
  await db.exec(`INSERT INTO cockpit_native_stills(key,data) VALUES ('b','{"x":1}'),('a','{"x":1}')`);
  const before = await manifest(db);
  // Preserve every field, including timestamps, while reversing insertion order.
  await db.exec(`CREATE TEMP TABLE saved_stills AS SELECT * FROM cockpit_native_stills;
   DELETE FROM cockpit_native_stills;
   INSERT INTO cockpit_native_stills SELECT * FROM saved_stills ORDER BY key ASC`);
  expect(await manifest(db)).toEqual(before);
  await db.exec(`DELETE FROM cockpit_native_stills WHERE key='a'`);
  const after = await manifest(db);
  expect(after.cockpit_native_stills.count).toBe(1);
  expect(after.cockpit_native_stills.hash).not.toBe(before.cockpit_native_stills.hash);
 } finally { await db.close(); }
}, 30000);

test('large fictional history uses 32-byte aggregate inputs and catches a tail edit', async () => {
 const db = await nativeFeedDb();
 try {
  await owner(db);
  await db.exec(`INSERT INTO cockpit_native_stills(key,data)
   SELECT 'fixture-' || n, jsonb_build_object('history', repeat(md5(n::text), 128), 'n', n)
   FROM generate_series(1,2500) n`);
  const sizes = (await db.query<{ original: number; compact: number }>(`
   SELECT sum(octet_length(to_jsonb(t)::text))::float8 original,
          sum(octet_length(sha256(convert_to(to_jsonb(t)::text,'UTF8'))))::float8 compact
   FROM cockpit_native_stills t`)).rows[0];
  expect(sizes.compact).toBe(2500 * 32);
  expect(sizes.compact / sizes.original).toBeLessThan(0.01);
  const before = await manifest(db);
  await db.exec(`UPDATE cockpit_native_stills SET data = data || '{"tail":"changed"}' WHERE key='fixture-2500'`);
  const after = await manifest(db);
  expect(after.cockpit_native_stills.count).toBe(2500);
  expect(after.cockpit_native_stills.hash).not.toBe(before.cockpit_native_stills.hash);
  console.log(`Manifest aggregate input: ${sizes.original} -> ${sizes.compact} bytes (fictional fixture; not process memory)`);
 } finally { await db.close(); }
}, 30000);

test('migration is repeatable and does not expose the internal helper to API roles', async () => {
 const db = await nativeFeedDb();
 try {
  await owner(db);
  const before = await manifest(db);
  await db.exec(migration(compactMigration));
  expect(await manifest(db)).toEqual(before);
  for (const role of ['anon', 'authenticated', 'service_role']) {
   await db.exec(`RESET ROLE; SET ROLE ${role}`);
   await expect(manifest(db)).rejects.toMatchObject({ code: '42501' });
  }
 } finally { await db.close(); }
}, 30000);
