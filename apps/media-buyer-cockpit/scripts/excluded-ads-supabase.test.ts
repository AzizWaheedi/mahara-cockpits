/**
 * The compromise-list migrations 20261021b, 20261021c and 20261021d on an
 * isolated PostgreSQL, after 20261010a.
 *
 * The media tables, their audit triggers and the native runs table come from
 * the repo's own migrations (20260927j, 20260927x and 20261009m, equal to the
 * live definitions on 2026-10-21). ads_daily_snapshots belongs to another team
 * and is a stub with its live columns and key; cockpit_campaigns is a stub with
 * the columns these migrations read. The listed ad ids are the ones the
 * migrations name. Every other id, client, campaign, day and amount is made up.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { cockpitTestDb, migration } from "./lib/cockpitTestDb";

const B = migration("20261021b_exclude_khalida_unauthorized_ads.sql");
const C = migration("20261021c_exclude_khalida_media_stats.sql");
const D = migration("20261021d_excluded_ads_stats_leftovers.sql");

/** The two ads 20261021b lists, the campaign 20261021c checks, and two ads 20261010a listed. */
const KH1 = "120247012327250088";
const KH2 = "120247083365360088";
const KH1_CAMPAIGN = "120247012327240088";
const OLD1 = "120246795745520088";
const OLD2 = "52557072938435";
/** Made up: an ad nobody listed, and a client. */
const OWN = "900000000000123";
const CLIENT = "00000000-0000-4000-8000-0000000000c1";

function extract(file: string, pattern: RegExp): string {
  const hit = migration(file).match(pattern);
  if (!hit) throw new Error(`${pattern} missing from ${file}`);
  return hit[0];
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
const auditCount = () => n("SELECT count(*) n FROM cockpit_audit_log");

/** A migration that refuses leaves its transaction aborted: roll it back, as a failed apply does. */
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
  sourceId: string,
  row: ReturnType<typeof daily>,
  importedAt: string,
  deployment = "native:media",
) {
  await db.query(
    "INSERT INTO cockpit_media_daily_stats(source_deployment,source_id,campaign_name,day,data,imported_at) VALUES($1,$2,$3,$4,$5,$6)",
    [deployment, sourceId, row.campaignName, row.date, row, importedAt],
  );
}

/** A published media cycle: its plan's daily rows, created and published at the given times. */
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

/** Every key anywhere in a JSON value. */
function keys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keys);
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => [k, ...keys(v)]);
  return [];
}

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

  // Before the exclusion: snapshots for both new ads and one ad nobody listed.
  for (const [ad, day, spend] of [
    [KH1, "2026-10-16", 10],
    [KH1, "2026-10-17", 20],
    [KH1, "2026-10-18", 0.5],
    [KH2, "2026-10-19", 0],
    [OWN, "2026-10-18", 7],
    [OLD1, "2026-09-26", 40],
  ] as const)
    await db.query(
      "INSERT INTO ads_daily_snapshots(ad_id,client_id,date,spend) VALUES($1,$2,$3,$4)",
      [ad, CLIENT, day, spend],
    );
  await db.exec(migration("20261010a_exclude_unauthorized_ads.sql"));

  // The media worker's daily rows: three for KH1 re-sent by the old worker at 10:25,
  // two leftovers of 20261010a ads from 10 Oct, and one of our own (imported elsewhere).
  const kh1 = [
    daily(KH1, "2026-10-16", 10),
    daily(KH1, "2026-10-17", 20),
    daily(KH1, "2026-10-18", 5),
  ];
  for (const row of kh1) await addDaily(row._id, row, "2026-10-21T10:25:10Z");
  await addDaily(
    "old-1",
    daily(OLD1, "2026-09-26", 100),
    "2026-10-10T11:53:00Z",
  );
  await addDaily(
    "old-2",
    daily(OLD2, "2026-10-01", 50),
    "2026-10-10T11:53:00Z",
  );
  await addDaily(
    "own-1",
    daily(OWN, "2026-10-18", 7),
    "2026-10-21T10:25:10Z",
    "fixture-import",
  );
  await db.exec(
    "UPDATE cockpit_media_feed_state SET ready=true, source_rows=CASE feed WHEN 'dailyStats' THEN 6 ELSE 0 END",
  );
  await db.query(
    "INSERT INTO cockpit_campaigns(client_name,meta_campaign_id) VALUES('Made-up client',$1),('Made-up client','900000000000999')",
    [KH1_CAMPAIGN],
  );
  // The old worker's last published cycle still carries KH1.
  await published("2026-10-21T10:15:02Z", "2026-10-21T10:25:11Z", [
    ...kh1,
    daily(OWN, "2026-10-18", 7),
  ]);

  // The live audit triggers, from here on.
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

describe("compromise list, Munshaat Khalida 2026-10-21", () => {
  test("20261021c and 20261021d refuse before 20261021b lists the two ads", async () => {
    expect(await n("SELECT count(*) n FROM cockpit_excluded_ads")).toBe(19);
    await refuses(C, /Apply 20261021b/);
    // The 19 ads are already dropped by the live worker, so without this check d would run before the release.
    await refuses(D, /Apply 20261021b/);
    expect(await auditCount()).toBe(0);
    expect(await n("SELECT count(*) n FROM cockpit_media_daily_stats")).toBe(6);
  });

  test("20261021b refuses while the snapshot trigger is switched off", async () => {
    await db.exec(
      "ALTER TABLE ads_daily_snapshots DISABLE TRIGGER cockpit_skip_excluded_ad_snapshot",
    );
    await refuses(
      B,
      /cockpit_skip_excluded_ad_snapshot is missing or disabled/,
    );
    // Replica-only does not fire in the feed's normal sessions, so it counts as off.
    await db.exec(
      "ALTER TABLE ads_daily_snapshots ENABLE REPLICA TRIGGER cockpit_skip_excluded_ad_snapshot",
    );
    await refuses(
      B,
      /cockpit_skip_excluded_ad_snapshot is missing or disabled/,
    );
    await db.exec(
      "ALTER TABLE ads_daily_snapshots ENABLE TRIGGER cockpit_skip_excluded_ad_snapshot",
    );
    expect(await n("SELECT count(*) n FROM cockpit_excluded_ads")).toBe(19);
    expect(await auditCount()).toBe(0);
  });

  test("20261021b lists both ads, archives their snapshots, writes one audit row, and a rerun changes nothing", async () => {
    await db.exec(B);
    expect(await n("SELECT count(*) n FROM cockpit_excluded_ads")).toBe(21);
    const listed = (
      await db.query(
        "SELECT ad_id, account_id, campaign_id, reason, excluded_by FROM cockpit_excluded_ads WHERE ad_id = ANY($1) ORDER BY ad_id",
        [[KH1, KH2]],
      )
    ).rows;
    expect(listed).toEqual([
      {
        ad_id: KH1,
        account_id: "act_1275190574533155",
        campaign_id: KH1_CAMPAIGN,
        reason: "unauthorized_meta_incident_2026_10",
        excluded_by: "aziz@maharamedia.com",
      },
      {
        ad_id: KH2,
        account_id: "act_1275190574533155",
        campaign_id: "120247083365340088",
        reason: "unauthorized_meta_incident_2026_10",
        excluded_by: "aziz@maharamedia.com",
      },
    ]);
    expect(
      (await db.query("SELECT ad_id FROM ads_daily_snapshots ORDER BY ad_id"))
        .rows,
    ).toEqual([{ ad_id: OWN }]);
    expect(
      await n(
        "SELECT count(*) n FROM ads_daily_snapshots_excluded_archive WHERE row_data->>'ad_id' = ANY($1)",
        [[KH1, KH2]],
      ),
    ).toBe(4);

    const audit = (await db.query<any>("SELECT * FROM cockpit_audit_log")).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: "media.excluded_ads.add",
      entity_type: "cockpit_excluded_ads",
      entity_id: "migration 20261021b",
      actor_email: "aziz@maharamedia.com",
      source_app: "media-buyer",
      source_system: "migration",
    });
    expect(audit[0].before).toEqual({
      listed: 19,
      ads_daily_snapshots: { rows: 4, spend: 30.5 },
    });
    // Ids and counts only.
    expect(audit[0].after).toEqual({
      listed: 21,
      added: 2,
      snapshots_archived: 4,
      ads: [
        {
          ad_id: KH1,
          account_id: "act_1275190574533155",
          campaign_id: KH1_CAMPAIGN,
        },
        {
          ad_id: KH2,
          account_id: "act_1275190574533155",
          campaign_id: "120247083365340088",
        },
      ],
    });
    expect(audit[0].metadata.reason).toBe("unauthorized_meta_incident_2026_10");

    // The dashboard feed cannot write them back.
    await db.query(
      "INSERT INTO ads_daily_snapshots(ad_id,client_id,date,spend) VALUES($1,$2,'2026-10-20',3)",
      [KH1, CLIENT],
    );
    expect(
      await n("SELECT count(*) n FROM ads_daily_snapshots WHERE ad_id=$1", [
        KH1,
      ]),
    ).toBe(0);

    await db.exec(B);
    expect(await auditCount()).toBe(1);
    expect(await n("SELECT count(*) n FROM cockpit_excluded_ads")).toBe(21);
    // 4 from this migration, 1 from 20261010a.
    expect(
      await n("SELECT count(*) n FROM ads_daily_snapshots_excluded_archive"),
    ).toBe(5);
  });

  test("20261021c and 20261021d refuse until a published cycle on the new release has dropped the ads", async () => {
    // The old worker's cycle still carries KH1, even once "29/8 - Copy" leaves the board.
    await db.query(
      "UPDATE cockpit_campaigns SET source_deleted=true WHERE meta_campaign_id=$1",
      [KH1_CAMPAIGN],
    );
    await refuses(C, /still sends these ads/);
    await refuses(D, /still sent a listed ad/);
    await db.query(
      "UPDATE cockpit_campaigns SET source_deleted=false WHERE meta_campaign_id=$1",
      [KH1_CAMPAIGN],
    );

    // A newer cycle whose stored plan is gone cannot be checked.
    await published("2026-10-21T10:30:02Z", "2026-10-21T10:40:00Z", null);
    await refuses(C, /No published media cycle with a plan/);
    await refuses(D, /No published media cycle with a plan/);

    // The new release's first cycle: its plan drops both ads, but "29/8 - Copy" is still a live row.
    await published("2026-10-21T10:45:02Z", "2026-10-21T10:55:00Z", [
      daily(OWN, "2026-10-18", 7),
    ]);
    await refuses(C, /still sends these ads/);

    // A cycle that re-stamped a KH1 row (the publish sets imported_at on every row it sends).
    await db.query(
      "UPDATE cockpit_campaigns SET source_deleted=true WHERE meta_campaign_id=$1",
      [KH1_CAMPAIGN],
    );
    await db.query(
      "UPDATE cockpit_media_daily_stats SET imported_at='2026-10-21T10:55:00Z' WHERE source_id=$1",
      [`${KH1}:2026-10-16`],
    );
    await refuses(C, /still sends these ads/);
    await refuses(D, /still sent a listed ad/);
    await db.query(
      "UPDATE cockpit_media_daily_stats SET imported_at='2026-10-21T10:25:10Z' WHERE source_id=$1",
      [`${KH1}:2026-10-16`],
    );

    expect(await n("SELECT count(*) n FROM cockpit_media_daily_stats")).toBe(6);
    expect(
      await n(
        "SELECT count(*) n FROM cockpit_audit_log WHERE entity_id LIKE 'migration 20261021%'",
      ),
    ).toBe(1);
  });

  test("20261021c refuses when the feed count is already out of step", async () => {
    await db.exec(
      "UPDATE cockpit_media_feed_state SET source_rows=7 WHERE feed='dailyStats'",
    );
    await refuses(C, /says 7 daily rows but the table holds 6/);
    await refuses(D, /says 7 daily rows but the table holds 6/);
    await db.exec(
      "UPDATE cockpit_media_feed_state SET source_rows=6 WHERE feed='dailyStats'",
    );
  });

  test("20261021c archives the worker's rows for both ads, restates the feed count, and a rerun changes nothing", async () => {
    const before = await auditCount();
    const earlier = (
      await db.query<{ id: string }>("SELECT id FROM cockpit_audit_log")
    ).rows.map(r => r.id);
    await db.exec(C);
    expect(
      await n(
        "SELECT count(*) n FROM cockpit_media_daily_stats WHERE data->>'metaAdId' = ANY($1)",
        [[KH1, KH2]],
      ),
    ).toBe(0);
    expect(await n("SELECT count(*) n FROM cockpit_media_daily_stats")).toBe(3);
    // cockpit_native_media_state() refuses a cycle unless these agree.
    expect(
      await n(
        "SELECT source_rows n FROM cockpit_media_feed_state WHERE feed='dailyStats'",
      ),
    ).toBe(3);
    const archived = (
      await db.query<any>(
        "SELECT row_data FROM ads_daily_snapshots_excluded_archive WHERE row_data->>'_table'='cockpit_media_daily_stats'",
      )
    ).rows;
    expect(archived.map(r => r.row_data.data.metaAdId)).toEqual([
      KH1,
      KH1,
      KH1,
    ]);

    const mine = await one<any>(
      "SELECT * FROM cockpit_audit_log WHERE entity_id='migration 20261021c'",
    );
    expect(mine).toMatchObject({
      action: "media.excluded_ads.stats_archived",
      entity_type: "cockpit_media_daily_stats",
      actor_email: "aziz@maharamedia.com",
      source_system: "migration",
    });
    expect(mine.before).toEqual({ rows: 3, spend: 35, feed_source_rows: 6 });
    expect(mine.after).toEqual({ rows: 0, archived: 3, feed_source_rows: 3 });
    expect(mine.metadata.ads).toEqual([KH1, KH2]);
    // Plus the table triggers' rows: one per archived row (nothing after) and the feed count.
    const triggered = (
      await db.query<any>(
        "SELECT action, entity_type, after FROM cockpit_audit_log WHERE NOT (id = ANY($1::uuid[])) AND entity_id IS DISTINCT FROM 'migration 20261021c'",
        [earlier],
      )
    ).rows;
    expect(triggered.filter(r => r.action === "delete")).toEqual(
      Array(3).fill({
        action: "delete",
        entity_type: "cockpit_media_daily_stats",
        after: null,
      }),
    );
    expect(triggered.filter(r => r.action !== "delete")).toEqual([
      {
        action: "UPDATE",
        entity_type: "cockpit_media_feed_state",
        after: expect.objectContaining({ feed: "dailyStats", source_rows: 3 }),
      },
    ]);
    expect(await auditCount()).toBe(before + 5);

    await db.exec(C);
    expect(await auditCount()).toBe(before + 5);
    expect(
      await n(
        "SELECT source_rows n FROM cockpit_media_feed_state WHERE feed='dailyStats'",
      ),
    ).toBe(3);
  });

  test("20261021d archives the 10 Oct leftovers of every listed ad, and a rerun changes nothing", async () => {
    const before = await auditCount();
    await db.exec(D);
    expect(
      (
        await db.query<any>(
          "SELECT data->>'metaAdId' ad FROM cockpit_media_daily_stats",
        )
      ).rows,
    ).toEqual([{ ad: OWN }]);
    expect(
      await n(
        "SELECT source_rows n FROM cockpit_media_feed_state WHERE feed='dailyStats'",
      ),
    ).toBe(1);
    const mine = await one<any>(
      "SELECT * FROM cockpit_audit_log WHERE entity_id='migration 20261021d'",
    );
    expect(mine.before).toEqual({ rows: 2, spend: 150, feed_source_rows: 3 });
    expect(mine.after).toEqual({ rows: 0, archived: 2, feed_source_rows: 1 });
    expect(mine.metadata.ads).toEqual([OLD1, OLD2].sort());
    expect(await auditCount()).toBe(before + 4);

    await db.exec(D);
    expect(await auditCount()).toBe(before + 4);
    expect(
      await n(
        "SELECT count(*) n FROM ads_daily_snapshots_excluded_archive WHERE row_data->>'_table'='cockpit_media_daily_stats'",
      ),
    ).toBe(5);
  });

  test("no audit row these migrations wrote carries an amount in after", async () => {
    const rows = (
      await db.query<any>("SELECT entity_id, after FROM cockpit_audit_log")
    ).rows;
    expect(
      rows
        .filter(r => /^migration 20261021[bcd]$/.test(r.entity_id))
        .map(r => r.entity_id)
        .sort(),
    ).toEqual([
      "migration 20261021b",
      "migration 20261021c",
      "migration 20261021d",
    ]);
    for (const r of rows) {
      expect(
        keys(r.after).filter(k => /spend|usd|amount|budget|cost|cpl/i.test(k)),
      ).toEqual([]);
      expect(keys(r.after)).not.toContain("data");
    }
  });
});
