/** Fictional receipts only. No network, credentials or live database. */
import {describe, expect, test} from 'bun:test';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {migration} from './lib/cockpitTestDb';

const PATCH = '20261027011000_upsell_monitor_web.sql';
const BASE = '20261026n_native_monitor_recent_provider_failures.sql';
const ledgers = ['cockpit_media_provider_health', 'cockpit_csm_provider_health', 'cockpit_ceo_provider_health'];
const md5 = (s: string) => createHash('md5').update(s).digest('hex');
type Check = {key: string; [key: string]: unknown};
async function fixture() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE SCHEMA storage;
    CREATE TABLE storage.objects(bucket_id text,name text);
    CREATE TABLE public.cockpit_monitor_receipts(id bigint GENERATED ALWAYS AS IDENTITY,resource text,ok boolean,created_at timestamptz DEFAULT now());
    CREATE TABLE public.cockpit_media_provider_health(id bigint GENERATED ALWAYS AS IDENTITY,provider text NOT NULL,resource text NOT NULL,method text,phase text,http_status int,created_at timestamptz DEFAULT now());
    CREATE TABLE public.cockpit_csm_provider_health(LIKE public.cockpit_media_provider_health INCLUDING ALL);
    CREATE TABLE public.cockpit_ceo_provider_health(LIKE public.cockpit_media_provider_health INCLUDING ALL);`);
  await db.exec(migration(BASE));
  // Live ACL read on 26 October: base owner only; wrapper service_role only.
  await db.exec(`REVOKE ALL ON FUNCTION public.cockpit_native_monitor_base() FROM PUBLIC,anon,authenticated,service_role;
    CREATE FUNCTION public.cockpit_native_monitor() RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT public.cockpit_native_monitor_base() $$;
    REVOKE ALL ON FUNCTION public.cockpit_native_monitor() FROM PUBLIC,anon,authenticated;
    GRANT EXECUTE ON FUNCTION public.cockpit_native_monitor() TO service_role;`);
  return db;
}
async function receipt(db: PGlite, table: string, provider: string, resource: string, phase: string, status: number | null, old = false) {
  await db.query(`INSERT INTO public.${table}(provider,resource,method,phase,http_status,created_at) VALUES($1,$2,'GET',$3,$4,now()-($5::int*interval '1 hour'))`, [provider,resource,phase,status,old ? 25 : 0]);
}
async function checks(db: PGlite): Promise<Check[]> {
  return (await db.query<{s: {checks: Check[]}}>('SELECT public.cockpit_native_monitor_base() s')).rows[0].s.checks;
}
async function catalog(db: PGlite) {
  return (await db.query(`SELECT proname, md5(prosrc) AS hash, proacl::text AS acl FROM pg_proc WHERE proname IN ('cockpit_native_monitor_base','cockpit_native_monitor') ORDER BY proname`)).rows;
}
const sources = (rows: Check[]) => rows.filter(c => c.key.startsWith('source:cockpit_'));

describe('web observations in the native monitor', () => {
  test('only expected web observations disappear; unknown oEmbed, real outages and all other checks remain', async () => {
    const db = await fixture();
    try {
      await db.exec("INSERT INTO storage.objects VALUES('pictures','exists.png')");
      const expected: string[] = [];
      for (const table of ledgers) {
        for (const [resource,phase,status] of [
          ['site:missing.acme.com','response',404], ['site:unknown.acme.com','unknown',null],
          ['site:firewall.acme.com','response',403], ['logo:missing.acme.com','response',404],
          ['thumbnail:missing.acme.com','unknown',null], ['oembed:private.acme.com','response',401],
          ['oembed:forbidden.acme.com','response',403], ['oembed:missing.acme.com','response',404],
        ] as const) await receipt(db, table, 'web', resource, phase, status);
        for (const [provider,resource,phase,status] of [
          ['web','oembed:outage.acme.com','response',500], ['web','oembed:limited.acme.com','response',429],
          ['web','oembed:unknown.acme.com','unknown',null], ['web','oembed:no-status.acme.com','response',null],
          ['web','other:acme.com','unknown',null], ['meta','site:unrelated.acme.com','response',404],
          ['storage','/storage/v1/object/pictures/missing.png','response',400],
        ] as const) {
          await receipt(db, table, provider, resource, phase, status);
          expected.push(`source:${table}:${md5(resource)}`);
        }
        await receipt(db, table, 'storage', '/storage/v1/object/pictures/exists.png', 'response', 400);
        await receipt(db, table, 'web', 'oembed:old.acme.com', 'response', 500, true);
        await receipt(db, table, 'web', 'oembed:intent.acme.com', 'intent', null);
        await receipt(db, table, 'web', 'oembed:recovered.acme.com', 'response', 500);
        await receipt(db, table, 'web', 'oembed:recovered.acme.com', 'response', 200);
      }
      const before = await checks(db);
      await db.exec(migration(PATCH));
      const after = await checks(db);
      expect(sources(before).length).toBe(expected.length + 8 * ledgers.length);
      expect(sources(after).map(c => c.key).sort()).toEqual(expected.sort());
      expect(after.filter(c => !c.key.startsWith('source:cockpit_'))).toEqual(before.filter(c => !c.key.startsWith('source:cockpit_')));
      // The patch changes the reader, never deletes source evidence.
      expect((await db.query<{n: number}>('SELECT count(*)::int n FROM public.cockpit_csm_provider_health')).rows[0].n).toBe(20);
    } finally { await db.close(); }
  }, 30000);

  test('reapply preserves owner-only base and service-only wrapper, including its exact definition', async () => {
    const db = await fixture();
    try {
      const before = await catalog(db);
      await db.exec(migration(PATCH));
      const first = await catalog(db);
      await db.exec(migration(PATCH));
      expect(await catalog(db)).toEqual(first);
      expect(first[0]).toEqual(before[0]); // wrapper is untouched
      expect(first[1].acl).toEqual(before[1].acl);
      for (const role of ['anon','authenticated','service_role']) {
        const r = (await db.query<{base: boolean; wrapper: boolean}>(`SELECT has_function_privilege($1,'public.cockpit_native_monitor_base()','EXECUTE') base, has_function_privilege($1,'public.cockpit_native_monitor()','EXECUTE') wrapper`, [role])).rows[0];
        expect(r).toEqual({base:false,wrapper:role === 'service_role'});
      }
      expect((await db.query<{s: {checks: Check[]}}>('SELECT public.cockpit_native_monitor() s')).rows[0].s.checks).toEqual(await checks(db));
    } finally { await db.close(); }
  }, 30000);

  test('definition drift or wider grants stop the migration before replacing anything', async () => {
    for (const drift of ['body','grant','other-role']) {
      const db = await fixture();
      try {
        if (drift === 'body') await db.exec("CREATE OR REPLACE FUNCTION public.cockpit_native_monitor_base() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$");
        else if (drift === 'grant') await db.exec('GRANT EXECUTE ON FUNCTION public.cockpit_native_monitor_base() TO service_role');
        else await db.exec('CREATE ROLE unexpected_reader; GRANT EXECUTE ON FUNCTION public.cockpit_native_monitor_base() TO unexpected_reader');
        const before = await catalog(db);
        await expect(db.exec(migration(PATCH))).rejects.toThrow(drift === 'body' ? 'not the definition' : 'grants changed');
        await db.exec('ROLLBACK');
        expect(await catalog(db)).toEqual(before);
      } finally { await db.close(); }
    }
  }, 30000);
});
