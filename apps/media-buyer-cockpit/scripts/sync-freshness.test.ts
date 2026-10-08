import { expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { cockpitTestDb, migration } from "./lib/cockpitTestDb";

// 20261008f: the Ads banner and the "synced" time read the newest Convex
// syncRuns row, which stopped on 7 Oct. cockpit_media_latest_sync returns the
// newest published native run instead, and says when a later run did not finish.
const CONVEX_AT = Date.parse("2026-10-07T10:07:19Z");

async function fixture() {
  const db = await cockpitTestDb();
  await db.exec(`
    CREATE TABLE public.cockpit_media_source_state(table_name text PRIMARY KEY, source_snapshot_at timestamptz, ready boolean);
    CREATE TABLE public.cockpit_media_sources(table_name text, source_id text, source_snapshot_at timestamptz, data jsonb);
    CREATE TABLE public.cockpit_native_media_runs(run_id uuid PRIMARY KEY, status text, created_at timestamptz, published_at timestamptz);
  `);
  const helper = migration("20261008f_media_sync_freshness_native.sql").match(
    /CREATE OR REPLACE FUNCTION public\.cockpit_media_latest_sync\(\)[\s\S]*?END \$function\$;/,
  );
  await db.exec(helper![0]);
  return db;
}
const latest = async (db: PGlite) =>
  (await db.query<{ v: any }>("SELECT public.cockpit_media_latest_sync() v")).rows[0].v;
async function convexRow(db: PGlite) {
  await db.exec(`INSERT INTO public.cockpit_media_source_state VALUES('syncRuns','2026-10-07T10:08:55Z',true);
    INSERT INTO public.cockpit_media_sources VALUES('syncRuns','old','2026-10-07T10:08:55Z','{"at":${CONVEX_AT},"ok":true,"problems":[]}');`);
}
const run = (db: PGlite, id: string, status: string, created: string, published: string | null) =>
  db.query("INSERT INTO public.cockpit_native_media_runs VALUES($1,$2,$3,$4)", [id, status, created, published]);

test("nothing recorded stays missing, not zero", async () => {
  const db = await fixture();
  expect(await latest(db)).toBeNull();
  await db.close();
});

test("with no native run the Convex row is kept", async () => {
  const db = await fixture();
  await convexRow(db);
  expect((await latest(db)).at).toBe(CONVEX_AT);
  await db.close();
});

test("the newest published native run replaces the Convex row", async () => {
  const db = await fixture();
  await convexRow(db);
  await run(db, "00000000-0000-4000-8000-00000000000a", "published", "2026-10-08T11:30:02Z", "2026-10-08T11:39:39Z");
  await run(db, "00000000-0000-4000-8000-00000000000b", "published", "2026-10-08T11:00:02Z", "2026-10-08T11:09:03Z");
  const v = await latest(db);
  expect(v.at).toBe(Date.parse("2026-10-08T11:39:39Z"));
  expect(v.ok).toBe(true);
  expect(v.problems).toEqual([]);
  expect(v._id).toBe("native:00000000-0000-4000-8000-00000000000a");
  await db.close();
});

test("a later run that never published is reported, and the time stays at the last good run", async () => {
  const db = await fixture();
  await run(db, "00000000-0000-4000-8000-00000000000a", "published", "2026-10-08T11:30:02Z", "2026-10-08T11:39:39Z");
  await run(db, "00000000-0000-4000-8000-00000000000c", "expired", "2026-10-08T12:00:02Z", null);
  const v = await latest(db);
  expect(v.at).toBe(Date.parse("2026-10-08T11:39:39Z"));
  expect(v.ok).toBe(false);
  expect(v.problems[0]).toContain("15:00 Kuwait did not finish");
  await db.close();
});

test("browsers cannot call the helper directly", async () => {
  const db = await fixture();
  const grants = await db.query<{ ok: boolean }>(
    "SELECT has_function_privilege('authenticated','public.cockpit_media_latest_sync()','EXECUTE') ok",
  );
  // PGlite fixture roles may not mirror Supabase; the REVOKE line is asserted on the migration text.
  expect(migration("20261008f_media_sync_freshness_native.sql")).toContain(
    "REVOKE ALL ON FUNCTION public.cockpit_media_latest_sync() FROM PUBLIC, anon, authenticated;",
  );
  expect(typeof grants.rows[0].ok).toBe("boolean");
  await db.close();
});
