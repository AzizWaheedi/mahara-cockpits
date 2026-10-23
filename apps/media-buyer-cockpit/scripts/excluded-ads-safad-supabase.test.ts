/**
 * SAFAD's two outsider ads on the compromise list (migration
 * 20261023p_exclude_safad_unauthorized_ads.sql; the CEO's cost per booking decisions of
 * 23 Oct 2026, D0a: "Yes"; contract docs/client-performance/CPB-DECISIONS-20261023.md 1.1,
 * 3.1 and S7), then 20261021d (applied unchanged, after the native release N3 has published
 * one cycle) on an isolated PostgreSQL, after 20261010a and 20261021b.
 *
 * The same stubs and chain as excluded-ads-supabase.test.ts: the media tables, their audit
 * triggers and the native runs table come from the repo's own migrations (20260927j,
 * 20260927x and 20261009m); ads_daily_snapshots belongs to another team and is a stub with
 * its live columns and key. In order:
 *   - before 20261023p, 20261021d archives only the 21 listed ads' leftovers (it reads the
 *     list live) and leaves SAFAD's rows;
 *   - 20261023p refuses with the snapshot trigger switched off;
 *   - 20261023p lists both ads with their campaigns and account, archives SAFAD's 8 snapshot
 *     rows ($375.10, the live amounts of 13 to 21 Oct), writes one audit row, and a rerun
 *     changes nothing;
 *   - 20261021d refuses while the newest published plan carries ad 120254791600360066 or a
 *     row of it is stamped after that run started, and on a feed count out of step; then one
 *     run archives SAFAD's 8 media rows together with a 10 Oct leftover (as on ship day: 47
 *     rows, $3,452.64 live), restates source_rows, and a rerun changes nothing;
 *   - no audit row these files wrote carries an amount in "after".
 * The board's side of the Lucas shape (a listed ad with budget-days and no ad-day row takes
 * its campaign's budget out of Budget used) needs the board's budget fixtures, so it is in
 * board-api-supabase.test.ts, with the list row read from this file.
 * The listed ad ids, campaigns, account and amounts are the live ones; every other id,
 * client and amount is made up.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { cockpitTestDb, migration } from "./lib/cockpitTestDb";

const P = migration("20261023p_exclude_safad_unauthorized_ads.sql");
const D = migration("20261021d_excluded_ads_stats_leftovers.sql");

/** SAFAD's two outsider ads, their campaigns and account (20261023p). */
const MERCEDES = "120254791600360066";
const MERCEDES_CAMPAIGN = "120254791600340066";
const LUCAS = "120254896955290066";
const LUCAS_CAMPAIGN = "120254896955270066";
const SAFAD_ACCOUNT = "act_774492648699300";
/** SAFAD's live snapshot days of the first ad (read only on 23 Oct): $375.10 in all. */
const SAFAD_DAYS: [string, number][] = [
  ["2026-10-13", 0.01],
  ["2026-10-14", 228.26],
  ["2026-10-15", 146.83],
  ["2026-10-16", 0],
  ["2026-10-17", 0],
  ["2026-10-18", 0],
  ["2026-10-19", 0],
  ["2026-10-21", 0],
];
/** One ad 20261010a listed, and one 20261021b listed. */
const OLD1 = "120246795745520088";
/** Another 20261010a ad: its 10 Oct leftover is still there when 20261021d runs on ship day. */
const OLD2 = "52557072938435";
const KH1 = "120247012327250088";
/** Made up: an ad nobody listed, and two clients. */
const OWN = "900000000000123";
const SAFAD_CLIENT = "00000000-0000-4000-8000-0000000000c2";
const CLIENT = "00000000-0000-4000-8000-0000000000c1";

function extract(file: string, pattern: RegExp): string {
  const hit = migration(file).match(pattern);
  if (!hit) throw new Error(`${pattern} missing from ${file}`);
  return hit[0];
}

/** The worker test's reading of a list migration (hermes/cockpit-sync/excludedAds.test.ts). */
function listedBy(sql: string): string[] {
  return [...sql.matchAll(/\(\s*'(\d+)',\s*'act_\d+'/g)].map(m => m[1]);
}

const STUBS = `
CREATE TABLE public.ads_daily_snapshots(ad_id text NOT NULL, client_id uuid NOT NULL, date date NOT NULL, ad_name text,
  campaign_id text, campaign_name text, campaign_status text, effective_status text, spend numeric NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0, clicks integer NOT NULL DEFAULT 0, ctr numeric, cpm numeric,
  leads integer NOT NULL DEFAULT 0, thumbnail_url text, last_synced_at timestamptz NOT NULL DEFAULT now(),
  platform text NOT NULL DEFAULT 'meta' CHECK (platform IN ('meta','tiktok')), link_clicks integer, smart_plus_ad_id text,
  PRIMARY KEY (ad_id, client_id, date));
CREATE TABLE public.cockpit_campaigns(id bigserial PRIMARY KEY, client_name text NOT NULL, meta_campaign_id text,
  raw_data jsonb NOT NULL DEFAULT '{}', source_deleted boolean NOT NULL DEFAULT false);
`;

let db: PGlite;
const one = async <T = any>(sql: string, params: unknown[] = []) =>
  (await db.query<T>(sql, params)).rows[0];
const n = async (sql: string, params: unknown[] = []) =>
  Number((await one<{ n: number }>(sql, params)).n);
const migrationRows = (id: string) =>
  n("SELECT count(*) n FROM cockpit_audit_log WHERE entity_id = $1", [id]);

async function refuses(sql: string, why: RegExp) {
  try {
    await expect(db.exec(sql)).rejects.toThrow(why);
  } finally {
    await db.exec("ROLLBACK");
  }
}

function daily(ad: string, day: string, spend: number) {
  return {
    _id: `${ad}:${day}`,
    campaignName: `Made-up campaign ${ad.slice(-3)}`,
    date: day,
    metaAdId: ad,
    adName: "Made-up ad",
    spend,
    leads: 0,
    impressions: 100,
    linkClicks: 1,
  };
}
async function addDaily(
  row: ReturnType<typeof daily>,
  importedAt: string,
  deployment = "native:media",
) {
  await db.query(
    "INSERT INTO cockpit_media_daily_stats(source_deployment,source_id,campaign_name,day,data,imported_at) VALUES($1,$2,$3,$4,$5,$6)",
    [deployment, row._id, row.campaignName, row.date, row, importedAt],
  );
}
async function published(
  created: string,
  publishedAt: string,
  dailyStats: unknown[] | null,
) {
  await db.query(
    `INSERT INTO cockpit_native_media_runs(run_id,lease_token,status,lease_expires_at,published_at,plan,created_at)
     VALUES(gen_random_uuid(),gen_random_uuid(),'published',$1::timestamptz + interval '30 minutes',$2,$3,$1)`,
    [
      created,
      publishedAt,
      dailyStats === null ? null : { version: 1, tables: { dailyStats } },
    ],
  );
}
function keys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keys);
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => [k, ...keys(v)]);
  return [];
}
const mediaRows = () => n("SELECT count(*) n FROM cockpit_media_daily_stats");
const sourceRows = () =>
  n(
    "SELECT source_rows n FROM cockpit_media_feed_state WHERE feed='dailyStats'",
  );

const safadMedia = SAFAD_DAYS.map(([d, s]) => daily(MERCEDES, d, s));

beforeAll(async () => {
  db = await cockpitTestDb();
  await db.exec(STUBS);
  for (const pattern of [
    /CREATE OR REPLACE FUNCTION public\.cockpit_audit_strip_noise\(p jsonb\)[\s\S]*?\n\$\$;/,
    /CREATE OR REPLACE FUNCTION public\.cockpit_audit_is_noise\(p_old jsonb, p_new jsonb\)[\s\S]*?\n\$\$;/,
    /CREATE OR REPLACE FUNCTION public\.cockpit_native_audit\(\)[\s\S]*?\$function\$;/,
    /CREATE OR REPLACE FUNCTION public\.cockpit_media_feed_audit\(\)[\s\S]*?\$function\$;/,
  ])
    await db.exec(extract("20261009m_backend_hygiene.sql", pattern));
  for (const pattern of [
    /CREATE TABLE IF NOT EXISTS public\.cockpit_media_feed_state\([\s\S]*?\n\);/,
    /INSERT INTO public\.cockpit_media_feed_state\(feed\)[^;]*;/,
    /CREATE TABLE IF NOT EXISTS public\.cockpit_media_daily_stats\([\s\S]*?\n\);/,
  ])
    await db.exec(extract("20260927j_cockpit_media_statistics.sql", pattern));
  await db.exec(
    extract(
      "20260927x_cockpit_native_media_sync.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_native_media_runs \([\s\S]*?\n\);/,
    ),
  );

  // The dashboard's snapshots: SAFAD's eight live days of the first ad, a 20261021b ad, our own.
  for (const [day, spend] of SAFAD_DAYS)
    await db.query(
      "INSERT INTO ads_daily_snapshots(ad_id,client_id,date,spend,campaign_id) VALUES($1,$2,$3,$4,$5)",
      [MERCEDES, SAFAD_CLIENT, day, spend, MERCEDES_CAMPAIGN],
    );
  await db.query(
    "INSERT INTO ads_daily_snapshots(ad_id,client_id,date,spend) VALUES($1,$2,'2026-10-16',10),($3,$2,'2026-10-18',7)",
    [KH1, CLIENT, OWN],
  );
  await db.exec(migration("20261010a_exclude_unauthorized_ads.sql"));
  await db.exec(migration("20261021b_exclude_khalida_unauthorized_ads.sql"));

  // The media worker's daily rows: the 10 Oct leftover of a 20261010a ad, a 20261021b ad's
  // rows the old worker re-sent, SAFAD's eight (the live worker still carried them at 00:45
  // on 23 Oct) and one of our own.
  await addDaily(daily(OLD1, "2026-09-26", 100), "2026-10-10T11:53:00Z");
  await addDaily(daily(KH1, "2026-10-16", 10), "2026-10-21T10:25:10Z");
  for (const row of safadMedia) await addDaily(row, "2026-10-22T21:45:00Z");
  await addDaily(
    daily(OWN, "2026-10-18", 7),
    "2026-10-22T21:45:00Z",
    "fixture-import",
  );
  await db.exec(
    "UPDATE cockpit_media_feed_state SET ready=true, source_rows=CASE feed WHEN 'dailyStats' THEN 11 ELSE 0 END",
  );
  // The live worker's last cycle before 20261023p: no 21-list ad, SAFAD's ad still in it.
  await published("2026-10-22T21:35:02Z", "2026-10-22T21:45:01Z", [
    ...safadMedia,
    daily(OWN, "2026-10-18", 7),
  ]);

  await db.exec(
    extract(
      "20260927j_cockpit_media_statistics.sql",
      /CREATE TRIGGER cockpit_media_daily_audit[^;]*;/,
    ),
  );
  await db.exec(
    extract(
      "20260927j_cockpit_media_statistics.sql",
      /CREATE TRIGGER cockpit_media_feed_state_audit[^;]*;/,
    ),
  );
  await db.exec(
    extract(
      "20260927x_cockpit_native_media_sync.sql",
      /CREATE OR REPLACE TRIGGER cockpit_native_daily_delete_audit[^;]*;/,
    ),
  );
});
afterAll(async () => {
  await db?.close();
});

describe("the file as the worker and the board read it", () => {
  test("lists exactly the two ads, with their campaigns and SAFAD's account, in the form the worker test reads", () => {
    expect(listedBy(P)).toEqual([MERCEDES, LUCAS]);
    expect(P).toContain(
      `('${MERCEDES}', '${SAFAD_ACCOUNT}', '${MERCEDES_CAMPAIGN}', 'unauthorized_meta_incident_2026_10', 'aziz@maharamedia.com')`,
    );
    // The board needs the second campaign id to take Lucas's budget-day out (no ad-day row).
    expect(P).toContain(
      `('${LUCAS}', '${SAFAD_ACCOUNT}', '${LUCAS_CAMPAIGN}', 'unauthorized_meta_incident_2026_10', 'aziz@maharamedia.com')`,
    );
    expect(P).not.toContain(String.fromCodePoint(0x2014));
    // 19 + 2 + 2 = the worker's 23.
    const all = new Set([
      ...listedBy(migration("20261010a_exclude_unauthorized_ads.sql")),
      ...listedBy(migration("20261021b_exclude_khalida_unauthorized_ads.sql")),
      ...listedBy(P),
    ]);
    expect(all.size).toBe(23);
  });
});

describe("compromise list, SAFAD 2026-10-23", () => {
  test("before 20261023p, 20261021d archives only the 21 listed ads' leftovers and leaves SAFAD's", async () => {
    expect(await n("SELECT count(*) n FROM cockpit_excluded_ads")).toBe(21);
    expect(await mediaRows()).toBe(11);
    await db.exec(D);
    expect(
      (
        await db.query<any>(
          "SELECT DISTINCT data->>'metaAdId' ad FROM cockpit_media_daily_stats ORDER BY 1",
        )
      ).rows.map(r => r.ad),
    ).toEqual([MERCEDES, OWN].sort());
    expect(await mediaRows()).toBe(9);
    expect(await sourceRows()).toBe(9);
    const d = await one<any>(
      "SELECT * FROM cockpit_audit_log WHERE entity_id='migration 20261021d'",
    );
    expect(d.before).toEqual({ rows: 2, spend: 110, feed_source_rows: 11 });
    expect(d.after).toEqual({ rows: 0, archived: 2, feed_source_rows: 9 });
    expect(d.metadata.ads).toEqual([OLD1, KH1].sort());
  });

  test("20261023p refuses while the snapshot trigger is switched off", async () => {
    await db.exec(
      "ALTER TABLE ads_daily_snapshots DISABLE TRIGGER cockpit_skip_excluded_ad_snapshot",
    );
    await refuses(
      P,
      /cockpit_skip_excluded_ad_snapshot is missing or disabled/,
    );
    await db.exec(
      "ALTER TABLE ads_daily_snapshots ENABLE REPLICA TRIGGER cockpit_skip_excluded_ad_snapshot",
    );
    await refuses(
      P,
      /cockpit_skip_excluded_ad_snapshot is missing or disabled/,
    );
    await db.exec(
      "ALTER TABLE ads_daily_snapshots ENABLE TRIGGER cockpit_skip_excluded_ad_snapshot",
    );
    expect(await n("SELECT count(*) n FROM cockpit_excluded_ads")).toBe(21);
    expect(await migrationRows("migration 20261023p")).toBe(0);
  });

  test("20261023p lists both ads, archives SAFAD's 8 snapshot rows ($375.10), writes one audit row, and a rerun changes nothing", async () => {
    const archiveBefore = await n(
      "SELECT count(*) n FROM ads_daily_snapshots_excluded_archive",
    );
    await db.exec(P);
    expect(await n("SELECT count(*) n FROM cockpit_excluded_ads")).toBe(23);
    expect(
      (
        await db.query(
          "SELECT ad_id, account_id, campaign_id, reason, excluded_by FROM cockpit_excluded_ads WHERE ad_id = ANY($1) ORDER BY ad_id",
          [[MERCEDES, LUCAS]],
        )
      ).rows,
    ).toEqual([
      {
        ad_id: MERCEDES,
        account_id: SAFAD_ACCOUNT,
        campaign_id: MERCEDES_CAMPAIGN,
        reason: "unauthorized_meta_incident_2026_10",
        excluded_by: "aziz@maharamedia.com",
      },
      {
        ad_id: LUCAS,
        account_id: SAFAD_ACCOUNT,
        campaign_id: LUCAS_CAMPAIGN,
        reason: "unauthorized_meta_incident_2026_10",
        excluded_by: "aziz@maharamedia.com",
      },
    ]);
    expect(
      (await db.query("SELECT ad_id FROM ads_daily_snapshots ORDER BY ad_id"))
        .rows,
    ).toEqual([{ ad_id: OWN }]);
    const archived = await one<{ n: number; spend: string }>(
      "SELECT count(*) n, sum((row_data->>'spend')::numeric)::text spend FROM ads_daily_snapshots_excluded_archive WHERE row_data->>'ad_id' = $1",
      [MERCEDES],
    );
    expect(Number(archived.n)).toBe(8);
    expect(archived.spend).toBe("375.10");
    expect(
      await n("SELECT count(*) n FROM ads_daily_snapshots_excluded_archive"),
    ).toBe(archiveBefore + 8);

    const audit = (
      await db.query<any>(
        "SELECT * FROM cockpit_audit_log WHERE entity_id='migration 20261023p'",
      )
    ).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "media.excluded_ads.add",
      entity_type: "cockpit_excluded_ads",
      actor_email: "aziz@maharamedia.com",
      source_app: "media-buyer",
      source_system: "migration",
    });
    expect(audit[0].before).toEqual({
      listed: 21,
      ads_daily_snapshots: { rows: 8, spend: 375.1 },
    });
    expect(audit[0].after).toEqual({
      listed: 23,
      added: 2,
      snapshots_archived: 8,
      ads: [
        {
          ad_id: MERCEDES,
          account_id: SAFAD_ACCOUNT,
          campaign_id: MERCEDES_CAMPAIGN,
        },
        {
          ad_id: LUCAS,
          account_id: SAFAD_ACCOUNT,
          campaign_id: LUCAS_CAMPAIGN,
        },
      ],
    });
    expect(audit[0].metadata).toMatchObject({
      reason: "unauthorized_meta_incident_2026_10",
      client:
        "SAFAD Consultant Engineering (ClickUp 86ewvnqgz, location 7eAfjIoYYguSmDaLSz78)",
      sanctioned_by: "CEO, 2026-10-23",
    });
    expect(
      audit[0].metadata.evidence.map((e: any) => [e.ad_id, e.created_by]),
    ).toEqual([
      [MERCEDES, "Mercedes García"],
      [LUCAS, "Lucas J Ortiz"],
    ]);

    // The dashboard feed cannot write them back.
    await db.query(
      "INSERT INTO ads_daily_snapshots(ad_id,client_id,date,spend) VALUES($1,$2,'2026-10-22',3),($3,$2,'2026-10-22',4)",
      [MERCEDES, SAFAD_CLIENT, LUCAS],
    );
    expect(
      await n(
        "SELECT count(*) n FROM ads_daily_snapshots WHERE ad_id = ANY($1)",
        [[MERCEDES, LUCAS]],
      ),
    ).toBe(0);

    await db.exec(P);
    expect(await migrationRows("migration 20261023p")).toBe(1);
    expect(await n("SELECT count(*) n FROM cockpit_excluded_ads")).toBe(23);
    expect(
      await n("SELECT count(*) n FROM ads_daily_snapshots_excluded_archive"),
    ).toBe(archiveBefore + 8);
  });

  test("20261021d refuses until the worker carrying the list has published a cycle without SAFAD's ad", async () => {
    // The old release's last cycle still carries the first ad.
    await refuses(D, /still sent a listed ad/);
    // On ship day 20261021d archives SAFAD's rows together with the 10 Oct leftovers (39 rows
    // live); one stands for them here, written before any of these cycles, the feed count in step.
    // (Written as the 10 Oct publish wrote it: the audit trigger here is the test's, not the run's.)
    await db.exec(
      "ALTER TABLE cockpit_media_daily_stats DISABLE TRIGGER cockpit_media_daily_audit",
    );
    await addDaily(daily(OLD2, "2026-10-01", 50), "2026-10-10T11:53:00Z");
    await db.exec(
      "ALTER TABLE cockpit_media_daily_stats ENABLE TRIGGER cockpit_media_daily_audit",
    );
    await db.exec(
      "UPDATE cockpit_media_feed_state SET source_rows=10 WHERE feed='dailyStats'",
    );
    // N3's first cycle drops it from the plan, but one of its rows was stamped by that cycle.
    await published("2026-10-23T17:00:02Z", "2026-10-23T17:10:00Z", [
      daily(OWN, "2026-10-18", 7),
    ]);
    await db.query(
      "UPDATE cockpit_media_daily_stats SET imported_at='2026-10-23T17:10:00Z' WHERE source_id=$1",
      [`${MERCEDES}:2026-10-14`],
    );
    await refuses(D, /still sent a listed ad/);
    await db.query(
      "UPDATE cockpit_media_daily_stats SET imported_at='2026-10-22T21:45:00Z' WHERE source_id=$1",
      [`${MERCEDES}:2026-10-14`],
    );
    // A newer cycle whose stored plan is gone cannot be checked.
    await published("2026-10-23T17:15:02Z", "2026-10-23T17:25:00Z", null);
    await refuses(D, /No published media cycle with a plan/);
    await published("2026-10-23T17:30:02Z", "2026-10-23T17:40:00Z", [
      daily(OWN, "2026-10-18", 7),
    ]);
    expect(await mediaRows()).toBe(10);
    expect(await migrationRows("migration 20261021d")).toBe(1);
  });

  test("20261021d refuses when the feed count is out of step", async () => {
    await db.exec(
      "UPDATE cockpit_media_feed_state SET source_rows=11 WHERE feed='dailyStats'",
    );
    await refuses(D, /says 11 daily rows but the table holds 10/);
    await db.exec(
      "UPDATE cockpit_media_feed_state SET source_rows=10 WHERE feed='dailyStats'",
    );
  });

  test("20261021d archives SAFAD's 8 media rows ($375.10) with the leftovers in one run, restates the feed count, and a rerun changes nothing", async () => {
    await db.exec(D);
    expect(
      await n(
        "SELECT count(*) n FROM cockpit_media_daily_stats WHERE data->>'metaAdId' IN (SELECT ad_id FROM cockpit_excluded_ads)",
      ),
    ).toBe(0);
    expect(
      (
        await db.query<any>(
          "SELECT data->>'metaAdId' ad FROM cockpit_media_daily_stats",
        )
      ).rows,
    ).toEqual([{ ad: OWN }]);
    expect(await sourceRows()).toBe(1);
    const runs = (
      await db.query<any>(
        "SELECT before, after, metadata FROM cockpit_audit_log WHERE entity_id='migration 20261021d' ORDER BY created_at, id",
      )
    ).rows;
    expect(runs).toHaveLength(2);
    const safad = runs.find(r => r.metadata.ads.includes(MERCEDES));
    // One audit row for the run: SAFAD's 8 rows and the leftover, the amounts in "before" only.
    expect(safad.before).toEqual({
      rows: 9,
      spend: 425.1,
      feed_source_rows: 10,
    });
    expect(safad.after).toEqual({ rows: 0, archived: 9, feed_source_rows: 1 });
    expect(safad.metadata.ads).toEqual([OLD2, MERCEDES].sort());
    expect(
      await n(
        "SELECT count(*) n FROM ads_daily_snapshots_excluded_archive WHERE row_data->>'_table'='cockpit_media_daily_stats' AND row_data->'data'->>'metaAdId' = $1",
        [MERCEDES],
      ),
    ).toBe(8);

    const total = await n("SELECT count(*) n FROM cockpit_audit_log");
    await db.exec(D);
    expect(await n("SELECT count(*) n FROM cockpit_audit_log")).toBe(total);
    expect(await sourceRows()).toBe(1);
  });

  test("no audit row these files wrote carries an amount in after", async () => {
    const rows = (
      await db.query<any>("SELECT entity_id, after FROM cockpit_audit_log")
    ).rows;
    expect(
      rows
        .filter(r => /^migration 2026102(1b|1d|3p)$/.test(r.entity_id))
        .map(r => r.entity_id)
        .sort(),
    ).toEqual([
      "migration 20261021b",
      "migration 20261021d",
      "migration 20261021d",
      "migration 20261023p",
    ]);
    for (const r of rows) {
      expect(
        keys(r.after).filter(k => /spend|usd|amount|budget|cost|cpl/i.test(k)),
      ).toEqual([]);
      expect(keys(r.after)).not.toContain("data");
    }
  });
});
