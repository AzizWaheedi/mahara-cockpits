/**
 * The ClickUp KPI push's inputs gain the media sync's 7 days and a booking ledger by
 * campaign (migration 20261022z_clickup_kpi_inputs.sql, cost per booking build 2,
 * contract 2.7, audit R12) on an isolated PostgreSQL.
 *
 * The tables are the canonical ones (cockpit_campaigns from 20260923o and 20260927k,
 * the media statistics chain 20260927j, the media sources 20260927w, the native runs
 * table from 20260927x); the function is 20261009f's own definition with its grants,
 * then 20261022w (cockpit_media_week) and the file, applied twice. It checks the body
 * is the live one the file was written against, that every key the push read before is
 * unchanged apart from the two ledgers now starting 10 days back (were 8), the new
 * keys, the service role's grant and the guard.
 * Every client, campaign and number is invented.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import {
  actor,
  cockpitTestDb,
  member,
  migration,
  owner,
} from "./lib/cockpitTestDb";

const FILE = "20261022z_clickup_kpi_inputs.sql";
const SIG = "public.cockpit_clickup_writeback_inputs(boolean)";
/** The live body on 22 Oct (20261009f). */
const LIVE = "2e98bd0efe32770de5555fa3163f1266";
const BUYER = "00000000-0000-4000-8000-0000000000c9";

const DAY = 86400_000;
const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const kd = (n: number) =>
  new Date(Date.parse(`${today}T12:00:00Z`) - n * DAY)
    .toISOString()
    .slice(0, 10);

let db: PGlite;
type Row = Record<string, any>;
async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  await owner(db);
  return (await db.query<T>(text, params)).rows;
}
async function md5(): Promise<string | null> {
  return (
    await q<{ m: string | null }>(
      "SELECT (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure($1)) m",
      [SIG],
    )
  )[0].m;
}
async function acl(): Promise<string> {
  return (
    await q<{ a: string }>(
      "SELECT coalesce(proacl::text, '') a FROM pg_proc WHERE oid = to_regprocedure($1)",
      [SIG],
    )
  )[0].a;
}
async function apply() {
  await owner(db);
  await db.exec(migration(FILE));
}
async function refuses(sql: string, why: RegExp) {
  await owner(db);
  try {
    await expect(db.exec(sql)).rejects.toThrow(why);
  } finally {
    await db.exec("ROLLBACK");
  }
}
/** The inputs as the Edge Function reads them: the service role. */
async function inputs(withStats: boolean): Promise<Row> {
  await owner(db);
  await db.exec("SET ROLE service_role");
  try {
    return (
      await db.query<{ r: Row }>(
        "SELECT public.cockpit_clickup_writeback_inputs($1) r",
        [withStats],
      )
    ).rows[0].r;
  } finally {
    await owner(db);
  }
}
const sortBy = (xs: Row[], ...keys: string[]) =>
  [...xs].sort((a, b) => {
    for (const k of keys) {
      const c = String(a[k]).localeCompare(String(b[k]));
      if (c !== 0) return c;
    }
    return 0;
  });

let n = 0;
async function daily(
  campaignName: string,
  day: string,
  spend: number,
  leads: number,
) {
  n += 1;
  await q(
    `INSERT INTO public.cockpit_media_daily_stats(source_deployment,source_id,campaign_name,day,data)
     VALUES('fixture',$1,$2,$3,$4::jsonb)`,
    [
      `d${n}`,
      campaignName,
      day,
      JSON.stringify({
        campaignName,
        date: day,
        metaAdId: "7700000001",
        spend,
        leads,
        impressions: 100,
        linkClicks: 1,
      }),
    ],
  );
}
async function booking(
  campaignName: string,
  day: string,
  client: string | null,
) {
  n += 1;
  await q(
    `INSERT INTO public.cockpit_media_booking_events(source_deployment,source_id,campaign_name,day,data)
     VALUES('fixture',$1,$2,$3,$4::jsonb)`,
    [
      `b${n}`,
      campaignName,
      day,
      JSON.stringify({
        campaignName,
        date: day,
        status: "confirmed",
        ...(client === null ? {} : { client }),
      }),
    ],
  );
}

let before: { stats: Row; plain: Row; acl: string; md5: string | null };

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await db.exec("CREATE TABLE public.clients(id uuid PRIMARY KEY);");
  const campaigns = migration("20260923o_cockpit_domain_tables.sql").match(
    /CREATE TABLE IF NOT EXISTS public\.cockpit_campaigns \([\s\S]*?\n\);/,
  );
  const runs = migration("20260927x_cockpit_native_media_sync.sql").match(
    /CREATE TABLE IF NOT EXISTS public\.cockpit_native_media_runs \([\s\S]*?\n\);/,
  );
  const fn = migration("20261009f_clickup_writeback_native.sql").match(
    /CREATE OR REPLACE FUNCTION public\.cockpit_clickup_writeback_inputs\(p_with_stats boolean DEFAULT false\)[\s\S]*?\nEND \$\$;/,
  );
  const winners = migration("20260926m_cockpit_csm_state.sql").match(
    /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed[\s\S]*?END \$\$;/,
  );
  if (!campaigns || !runs || !fn || !winners)
    throw new Error("A canonical definition moved");
  await db.exec(campaigns[0]);
  for (const line of migration(
    "20260927k_cockpit_snapshot_reconcile.sql",
  ).match(
    /ALTER TABLE public\.cockpit_campaigns ADD COLUMN IF NOT EXISTS [^;]+;/g,
  ) ?? [])
    await db.exec(line);
  await db.exec(runs[0]);
  await db.exec(migration("20260927j_cockpit_media_statistics.sql"));
  await db.exec(migration("20261010c_cockpit_media_statistics_call_times.sql"));
  await db.exec(migration("20260927w_media_read_models.sql"));
  await db.exec(`CREATE TABLE public.winner_ads(ad_id text PRIMARY KEY, ad_name text, client text, spend numeric, leads int,
    cpl numeric, origin text, first_seen_at timestamptz, last_seen_at timestamptz);
    ALTER TABLE public.winner_ads ENABLE ROW LEVEL SECURITY;`);
  await db.exec(winners[0]);
  await db.exec(migration("20260927q_cockpit_winner_saves.sql"));
  // 20261009f's own definition and its grants (service role only).
  await db.exec(fn[0]);
  await db.exec(`REVOKE ALL ON FUNCTION public.cockpit_clickup_writeback_inputs(boolean) FROM PUBLIC,anon,authenticated;
    GRANT EXECUTE ON FUNCTION public.cockpit_clickup_writeback_inputs(boolean) TO service_role;`);
  await db.exec(migration("20261022w_media_week.sql"));
  await member(db, BUYER, "buyer-kpi@tests.invalid", ["media_buyer"]);
  await q("UPDATE public.cockpit_media_feed_state SET ready = true");

  // Two cards' campaigns and one stopped.
  for (const [name, task, deleted, raw] of [
    [
      "Alpha 1\\10",
      "tA",
      false,
      { spend7d: 70, leads7d: 7, bookings7d: 2, cpl: 10 },
    ],
    ["Beta 5\\10", "tB", false, { spend7d: 40, leads7d: 2, cpl: 20 }],
    ["Old 1\\9", "tO", true, {}],
  ] as const)
    await q(
      `INSERT INTO public.cockpit_campaigns(client_name,task_id,raw_data,source_deployment,source_id,source_deleted,synced_at)
       VALUES('Client Z',$1,$2::jsonb,'fixture',$3,$4,now())`,
      [
        task,
        JSON.stringify({
          campaignName: name,
          clientName: "Client Z",
          taskId: task,
          ...raw,
        }),
        task,
        deleted,
      ],
    );
  // Ad-days and bookings from 11 days back to yesterday.
  for (const d of [1, 2, 8, 9, 10, 11]) {
    await daily("Alpha 1\\10", kd(d), 10, 1);
    await booking("Alpha 1\\10", kd(d), "Client Z");
  }
  await daily("Beta 5\\10", kd(1), 20, 1);
  await booking("Beta 5\\10", kd(1), "Client Z");
  await booking("Beta 5\\10", kd(1), null); // no client on the event: in the ledger by campaign only
  await booking("Beta 5\\10", kd(9), "Client Z");

  before = {
    stats: await inputs(true),
    plain: await inputs(false),
    acl: await acl(),
    md5: await md5(),
  };
  await apply();
  await apply();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("the file", () => {
  test("is written against the live body, applies twice and keeps the service role's grant alone", async () => {
    expect(before.md5).toBe(LIVE);
    const sql = migration(FILE);
    expect(sql).toContain(`'${LIVE}'`);
    expect(sql).not.toContain(String.fromCodePoint(0x2014));
    const mine = await md5();
    expect(mine).not.toBe(LIVE);
    expect(sql).toContain(`'${mine}'`);
    expect(await acl()).toBe(before.acl);
    expect(before.acl).toContain("service_role=X");
    expect(before.acl).not.toContain("authenticated=X");
    await actor(db, BUYER);
    await expect(
      db.query("SELECT public.cockpit_clickup_writeback_inputs(true)"),
    ).rejects.toThrow(/permission denied/);
    await owner(db);
  });

  test("a body changed since refuses and changes nothing", async () => {
    const def = (
      await q<{ d: string }>(
        "SELECT pg_get_functiondef(to_regprocedure($1)) d",
        [SIG],
      )
    )[0].d;
    const mine = await md5();
    await q(def.replace("'workingDay',today", "'workingDay',today+0"));
    const changed = await md5();
    expect(changed).not.toBe(mine);
    await refuses(
      migration(FILE),
      /cockpit_clickup_writeback_inputs is not the definition this file was written against \(prosrc md5 [0-9a-f]{32}\)\. Re-read the live definition and rebase this file/,
    );
    expect(await md5()).toBe(changed);
    await q(def);
    expect(await md5()).toBe(mine);
  });
});

describe("the inputs", () => {
  test("without stats: every key as before, plus the media sync's window (media data until it publishes)", async () => {
    const after = await inputs(false);
    const { weekFrom, weekThrough, weekSource, ...rest } = after;
    expect(rest).toEqual(before.plain);
    expect({ weekFrom, weekThrough, weekSource }).toEqual({
      weekFrom: null,
      weekThrough: kd(1),
      weekSource: "media data",
    });
  });

  test("with stats: the old keys are unchanged but for the two ledgers, which now reach 10 days back", async () => {
    const after = await inputs(true);
    const {
      weekFrom,
      weekThrough,
      weekSource,
      bookingsByCampaign,
      daily: d,
      bookings: b,
      ...rest
    } = after;
    const { daily: d0, bookings: b0, ...rest0 } = before.stats;
    expect(rest).toEqual(rest0);
    expect(Object.keys(before.stats).sort()).toEqual(
      [
        "bookings",
        "bookingsReady",
        "campaigns",
        "daily",
        "dailyReady",
        "latestPublishAt",
        "latestSyncedAt",
        "workingDay",
      ].sort(),
    );
    const days = (xs: Row[]) => [...new Set(xs.map(x => x.day))].sort();
    expect(days(d0)).toEqual([kd(8), kd(2), kd(1)].sort());
    expect(days(d)).toEqual([kd(10), kd(9), kd(8), kd(2), kd(1)].sort());
    // Every row the push read before is still there, unchanged.
    for (const row of d0) expect(d).toContainEqual(row);
    for (const row of b0) expect(b).toContainEqual(row);
    expect(sortBy(b, "day")).toEqual(
      sortBy(
        [
          { client: "client z", day: kd(10), booked: 1 },
          { client: "client z", day: kd(9), booked: 2 },
          { client: "client z", day: kd(8), booked: 1 },
          { client: "client z", day: kd(2), booked: 1 },
          { client: "client z", day: kd(1), booked: 2 },
        ],
        "day",
      ),
    );
    expect({ weekFrom, weekThrough, weekSource }).toEqual({
      weekFrom: null,
      weekThrough: kd(1),
      weekSource: "media data",
    });
  });

  test("bookings by campaign and booking day, 10 days back, events with no client included", async () => {
    const { bookingsByCampaign } = await inputs(true);
    expect(bookingsByCampaign).toEqual([
      ...[10, 9, 8, 2, 1].map(x => ({
        campaignName: "Alpha 1\\10",
        day: kd(x),
        booked: 1,
      })),
      { campaignName: "Beta 5\\10", day: kd(9), booked: 1 },
      { campaignName: "Beta 5\\10", day: kd(1), booked: 2 },
    ]);
  });

  test("once the media sync publishes its window, the push gets it, start included", async () => {
    await q(
      "UPDATE public.cockpit_media_source_state SET ready=true, row_count=1, source_snapshot_at=now() WHERE table_name='clientLinks'",
    );
    await q(
      `INSERT INTO public.cockpit_media_sources(table_name,source_id,client_names,data,source_snapshot_at)
       SELECT 'clientLinks','z','{}',jsonb_build_object('_id','z','ads7d',jsonb_build_object('from',$1::text,'through',$2::text)),source_snapshot_at
       FROM public.cockpit_media_source_state WHERE table_name='clientLinks'`,
      [kd(9), kd(2)],
    );
    const after = await inputs(false);
    expect({
      weekFrom: after.weekFrom,
      weekThrough: after.weekThrough,
      weekSource: after.weekSource,
    }).toEqual({
      weekFrom: kd(9),
      weekThrough: kd(2),
      weekSource: "media sync",
    });
  });
});
