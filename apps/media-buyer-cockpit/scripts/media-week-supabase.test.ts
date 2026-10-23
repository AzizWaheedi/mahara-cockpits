/**
 * The 7-day window, one end for every reader (migration 20261022w_media_week.sql,
 * cost per booking build 2, contract 2.2 to 2.4) on an isolated PostgreSQL.
 *
 * It stands on the media statistics chain the live database ran (20260927j, then
 * 20261010c), the media sources (20260927w) and the winner saves (20260927q), checks
 * that those bodies are the live ones the file was written against, then applies the
 * file twice. It covers:
 * - cockpit_media_week(): "media data" before the sync publishes ads7d (the last day of
 *   the daily rows, never after yesterday) and "media sync" once the current ready
 *   clientLinks snapshot carries ads7d (an older snapshot, a malformed day and a feed
 *   that is not ready are ignored); service_role only.
 * - the coverage read gains bookingsThrough, weekFrom and weekSource; the range read is
 *   unchanged.
 * - cockpit_winner_numbers stops spend and bookings on the paired day and says which;
 *   a winner preview made today no longer counts today's bookings.
 * - the guard: a body changed since refuses and changes nothing; owners and grants stay.
 * Every person, client, ad and number is invented.
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

const FILE = "20261022w_media_week.sql";
const STATS_SIG = "public.cockpit_media_statistics(text,text,date,date)";
const WINNER_SIG = "public.cockpit_winner_numbers(text,text,date,date)";
const WEEK_SIG = "public.cockpit_media_week()";
/** The live bodies on 22 Oct (20261010c and 20260927q). */
const STATS_LIVE = "d800cf97035c9b261e72b6b02a0a41f4";
const WINNER_LIVE = "cbbacd4df63c8af8bda56918bda4d1f6";

const BUYER = "00000000-0000-4000-8000-0000000000e1";
const CSM = "00000000-0000-4000-8000-0000000000e2";
const CAMPAIGN = "Week campaign";
const AD = "7000000001";

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
async function md5(sig: string): Promise<string | null> {
  return (
    (
      await q<{ m: string | null }>(
        "SELECT (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure($1)) m",
        [sig],
      )
    )[0]?.m ?? null
  );
}
async function acl(sig: string): Promise<string> {
  return (
    await q<{ a: string }>(
      "SELECT coalesce(proacl::text, '') a FROM pg_proc WHERE oid = to_regprocedure($1)",
      [sig],
    )
  )[0].a;
}
async function apply() {
  await owner(db);
  await db.exec(migration(FILE));
}
async function week(): Promise<Row> {
  return (await q<{ w: Row }>("SELECT public.cockpit_media_week() w"))[0].w;
}
/** A migration that refuses leaves its transaction aborted: roll it back, as a failed apply does. */
async function refuses(sql: string, why: RegExp) {
  await owner(db);
  try {
    await expect(db.exec(sql)).rejects.toThrow(why);
  } finally {
    await db.exec("ROLLBACK");
  }
}
async function daily(id: string, day: string, spend: number, leads = 1) {
  await q(
    `INSERT INTO public.cockpit_media_daily_stats(source_deployment,source_id,campaign_name,day,data)
     VALUES('fixture',$1,$2,$3,$4::jsonb)`,
    [
      id,
      CAMPAIGN,
      day,
      JSON.stringify({
        campaignName: CAMPAIGN,
        date: day,
        metaAdId: AD,
        adName: "Ad",
        spend,
        leads,
        impressions: 1000,
        linkClicks: 10,
      }),
    ],
  );
}
async function booking(id: string, day: string, status = "confirmed") {
  await q(
    `INSERT INTO public.cockpit_media_booking_events(source_deployment,source_id,campaign_name,day,data)
     VALUES('fixture',$1,$2,$3,$4::jsonb)`,
    [
      id,
      CAMPAIGN,
      day,
      JSON.stringify({ campaignName: CAMPAIGN, date: day, adId: AD, status }),
    ],
  );
}
/** A clientLinks snapshot: rows with the given ads7d windows, the feed ready or not. */
async function snapshot(at: string, windows: unknown[], ready = true) {
  for (const [i, w] of windows.entries())
    await q(
      `INSERT INTO public.cockpit_media_sources(table_name,source_id,client_names,data,source_snapshot_at)
       VALUES('clientLinks',$1,'{}',$2::jsonb,$3)
       ON CONFLICT (table_name, source_id) DO UPDATE SET data = excluded.data, source_snapshot_at = excluded.source_snapshot_at`,
      [
        `link${i}`,
        JSON.stringify({
          _id: `link${i}`,
          taskId: `t${i}`,
          ...(w === undefined ? {} : { ads7d: w }),
        }),
        at,
      ],
    );
  await q(
    "UPDATE public.cockpit_media_source_state SET ready=$1, row_count=$2, source_snapshot_at=$3 WHERE table_name='clientLinks'",
    [ready, windows.length, at],
  );
}

let before: { stats: Row; range: Row; statsAcl: string; winnerAcl: string };

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await db.exec(`CREATE TABLE public.cockpit_campaigns(client_name text NOT NULL, raw_data jsonb NOT NULL);
    CREATE TABLE public.winner_ads(ad_id text PRIMARY KEY, ad_name text, client text, spend numeric, leads int, cpl numeric,
      origin text, first_seen_at timestamptz, last_seen_at timestamptz);
    ALTER TABLE public.winner_ads ENABLE ROW LEVEL SECURITY;`);
  const allowed = migration("20260926m_cockpit_csm_state.sql").match(
    /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed[\s\S]*?END \$\$;/,
  );
  if (!allowed) throw new Error("cockpit_client_allowed moved in 20260926m");
  await db.exec(allowed[0]);
  await db.exec(migration("20260927j_cockpit_media_statistics.sql"));
  await db.exec(migration("20261010c_cockpit_media_statistics_call_times.sql"));
  await db.exec(migration("20260927q_cockpit_winner_saves.sql"));
  await db.exec(migration("20260927w_media_read_models.sql"));
  await member(db, BUYER, "buyer-week@tests.invalid", ["media_buyer"]);
  await member(db, CSM, "csm-week@tests.invalid", ["csm"]);
  await q(
    "INSERT INTO public.cockpit_campaigns VALUES('Client W', $1::jsonb)",
    [JSON.stringify({ campaignName: CAMPAIGN, clientName: "Client W" })],
  );
  await q("UPDATE public.cockpit_media_feed_state SET ready = true");
  // Spend to yesterday; bookings on the days before, yesterday and today.
  for (let n = 6; n >= 1; n--) await daily(`d${n}`, kd(n), 20, 2);
  await booking("b5", kd(5), "showed");
  await booking("b3", kd(3));
  await booking("b2", kd(2));
  await booking("b1", kd(1));
  await booking("b0a", today);
  await booking("b0b", today);

  await actor(db, BUYER);
  before = {
    stats: (
      await db.query<{ r: Row }>(
        "SELECT public.cockpit_media_statistics('coverage') r",
      )
    ).rows[0].r,
    range: (
      await db.query<{ r: Row }>(
        "SELECT public.cockpit_media_statistics('range',$1,$2::date,$3::date) r",
        [CAMPAIGN, kd(6), today],
      )
    ).rows[0].r,
    statsAcl: "",
    winnerAcl: "",
  };
  before.statsAcl = await acl(STATS_SIG);
  before.winnerAcl = await acl(WINNER_SIG);
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("the file", () => {
  test("is written against the live bodies, which the repository chain reproduces", async () => {
    expect(await md5(STATS_SIG)).toBe(STATS_LIVE);
    expect(await md5(WINNER_SIG)).toBe(WINNER_LIVE);
    expect(await md5(WEEK_SIG)).toBeNull();
    const sql = migration(FILE);
    expect(sql).toContain(`'${STATS_LIVE}'`);
    expect(sql).toContain(`'${WINNER_LIVE}'`);
    expect(sql).not.toContain(String.fromCodePoint(0x2014));
  });

  test("applies twice; keeps owners and grants; the new function is the service role's alone", async () => {
    await apply();
    const once = {
      stats: await md5(STATS_SIG),
      winner: await md5(WINNER_SIG),
      week: await md5(WEEK_SIG),
    };
    await apply();
    expect({
      stats: await md5(STATS_SIG),
      winner: await md5(WINNER_SIG),
      week: await md5(WEEK_SIG),
    }).toEqual(once);
    expect(once.stats).not.toBe(STATS_LIVE);
    expect(once.winner).not.toBe(WINNER_LIVE);
    // The file names its own bodies, so its guard accepts them on the second run.
    const sql = migration(FILE);
    for (const m of Object.values(once)) expect(sql).toContain(`'${m}'`);
    expect(await acl(STATS_SIG)).toBe(before.statsAcl);
    expect(await acl(WINNER_SIG)).toBe(before.winnerAcl);
    expect(before.statsAcl).toContain("authenticated=X");
    expect(before.winnerAcl).not.toContain("authenticated=X");
    const weekAcl = await acl(WEEK_SIG);
    expect(weekAcl).toContain("service_role=X");
    expect(weekAcl).not.toContain("authenticated=X");
    expect(weekAcl).not.toContain("anon=X");
    expect(weekAcl).not.toMatch(/(^|[{,])=X/);
    const defs = await q<{ sig: string; definer: boolean; cfg: string }>(
      `SELECT oid::regprocedure::text sig, prosecdef definer, proconfig::text cfg FROM pg_proc
        WHERE oid IN (to_regprocedure($1), to_regprocedure($2), to_regprocedure($3)) ORDER BY 1`,
      [STATS_SIG, WINNER_SIG, WEEK_SIG],
    );
    expect(defs).toHaveLength(3);
    for (const d of defs) {
      expect(d.definer).toBe(true);
      expect(d.cfg).toContain("search_path");
    }
  });

  test("a browser seat cannot call the week or the winner numbers; the service role can", async () => {
    await actor(db, BUYER);
    await expect(
      db.query("SELECT public.cockpit_media_week()"),
    ).rejects.toThrow(/permission denied/);
    await expect(
      db.query(
        "SELECT public.cockpit_winner_numbers($1,$2,$3::date,$4::date)",
        [CAMPAIGN, AD, kd(6), today],
      ),
    ).rejects.toThrow(/permission denied/);
    await owner(db);
    await db.exec("SET ROLE service_role");
    try {
      expect(
        (await db.query<{ w: Row }>("SELECT public.cockpit_media_week() w"))
          .rows[0].w.source,
      ).toBe("media data");
    } finally {
      await owner(db);
    }
  });
});

describe("cockpit_media_week", () => {
  test("before the sync publishes its window: the media data's last day, no start", async () => {
    expect(await week()).toEqual({
      from: null,
      through: kd(1),
      source: "media data",
    });
    // A row for today (the sheet never has one) does not move it past yesterday.
    await daily("today", today, 5);
    expect((await week()).through).toBe(kd(1));
    await q(
      "DELETE FROM public.cockpit_media_daily_stats WHERE source_id IN ('today','d1')",
    );
    expect((await week()).through).toBe(kd(2));
    await daily("d1", kd(1), 20, 2);
  });

  test("the current ready clientLinks snapshot's window: earliest from, latest through", async () => {
    const at = new Date(Date.now() - 3600_000).toISOString();
    await snapshot(at, [
      { from: kd(8), through: kd(2) },
      { from: kd(8), through: kd(2) },
      undefined,
      { from: "not a day", through: "2026-13-40" },
      // Shaped like a day, but no such day: ignored, never an error for every reader.
      { from: "2026-02-30", through: "2026-09-31" },
    ]);
    expect(await week()).toEqual({
      from: kd(8),
      through: kd(2),
      source: "media sync",
    });
    await actor(db, BUYER);
    try {
      const cover = (
        await db.query<{ r: Row }>(
          "SELECT public.cockpit_media_statistics('coverage') r",
        )
      ).rows[0].r;
      expect(cover).toMatchObject({
        bookingsThrough: kd(2),
        weekSource: "media sync",
      });
    } finally {
      await owner(db);
    }
  });

  test("an older snapshot, a feed not ready and a window past yesterday are not trusted", async () => {
    // Rows of an older snapshot do not count.
    await q(
      `INSERT INTO public.cockpit_media_sources(table_name,source_id,client_names,data,source_snapshot_at)
       VALUES('clientLinks','old','{}',$1::jsonb,$2)`,
      [
        JSON.stringify({ _id: "old", ads7d: { from: kd(9), through: kd(1) } }),
        new Date(Date.now() - 86400_000).toISOString(),
      ],
    );
    expect((await week()).through).toBe(kd(2));
    // Not ready: back to the media data.
    await q(
      "UPDATE public.cockpit_media_source_state SET ready=false WHERE table_name='clientLinks'",
    );
    expect((await week()).source).toBe("media data");
    await q(
      "UPDATE public.cockpit_media_source_state SET ready=true WHERE table_name='clientLinks'",
    );
    // A window that claims today is held to yesterday.
    const at = new Date(Date.now() - 1800_000).toISOString();
    await snapshot(at, [{ from: kd(6), through: today }]);
    expect(await week()).toEqual({
      from: kd(6),
      through: kd(1),
      source: "media sync",
    });
  });
});

describe("the coverage read", () => {
  test("names the day bookings stop and where it came from; first and last are as before", async () => {
    // The overnight window: the sheet has not filled, so the sync's window ends two days back.
    const at = new Date(Date.now() - 600_000).toISOString();
    await snapshot(at, [{ from: kd(8), through: kd(2) }]);
    await actor(db, BUYER);
    const cov = (
      await db.query<{ r: Row }>(
        "SELECT public.cockpit_media_statistics('coverage') r",
      )
    ).rows[0].r;
    expect(cov).toEqual({
      ...before.stats,
      bookingsThrough: kd(2),
      weekFrom: kd(8),
      weekSource: "media sync",
    });
    expect(before.stats).toEqual({ first: kd(6), last: kd(1), rows: null });
  });

  test("before the sync publishes: the media data's day and no start", async () => {
    await q(
      "UPDATE public.cockpit_media_source_state SET ready=false WHERE table_name='clientLinks'",
    );
    await actor(db, BUYER);
    const cov = (
      await db.query<{ r: Row }>(
        "SELECT public.cockpit_media_statistics('coverage') r",
      )
    ).rows[0].r;
    expect(cov).toEqual({
      first: kd(6),
      last: kd(1),
      rows: null,
      bookingsThrough: kd(1),
      weekFrom: null,
      weekSource: "media data",
    });
  });

  test("the range read is unchanged, and the gate still refuses the wrong seat", async () => {
    await actor(db, BUYER);
    const range = (
      await db.query<{ r: Row }>(
        "SELECT public.cockpit_media_statistics('range',$1,$2::date,$3::date) r",
        [CAMPAIGN, kd(6), today],
      )
    ).rows[0].r;
    expect(range).toEqual(before.range);
    // The range read still returns today's bookings: the media buyer caps the range itself.
    expect(range.bookings.map((b: Row) => b.date)).toContain(today);
    await actor(db, CSM);
    await expect(
      db.query("SELECT public.cockpit_media_statistics('coverage')"),
    ).rejects.toThrow("Verified media-buyer access required");
    await actor(db, null);
    await expect(
      db.query("SELECT public.cockpit_media_statistics('coverage')"),
    ).rejects.toThrow();
  });
});

describe("cockpit_winner_numbers", () => {
  async function numbers(start: string, end: string): Promise<Row> {
    return (
      await q<{ r: Row }>(
        "SELECT public.cockpit_winner_numbers($1,$2,$3::date,$4::date) r",
        [CAMPAIGN, AD, start, end],
      )
    )[0].r;
  }

  test("a range to today stops on the media data's last day: today's bookings are left out", async () => {
    // Media data: through is yesterday. Six days of $20 spend; bookings 5, 3, 2 and 1 days back.
    const r = await numbers(kd(6), today);
    expect(r).toMatchObject({
      spend: 120,
      leads: 12,
      bookings: 4,
      showed: 1,
      costPerBooking: 30,
      rows: 6,
      through: kd(1),
    });
  });

  test("overnight, the sync's window ends two days back: spend and bookings both stop there", async () => {
    await q(
      "UPDATE public.cockpit_media_source_state SET ready=true WHERE table_name='clientLinks'",
    );
    const r = await numbers(kd(6), today);
    expect(r).toMatchObject({
      spend: 100,
      leads: 10,
      bookings: 3,
      costPerBooking: 33.33,
      rows: 5,
      through: kd(2),
    });
  });

  test("a range that ends before the window's end is its own end", async () => {
    const r = await numbers(kd(6), kd(4));
    expect(r).toMatchObject({
      spend: 60,
      bookings: 1,
      rows: 3,
      through: kd(4),
    });
  });

  test("the preview a media buyer saves from says the same", async () => {
    await q(
      "UPDATE public.cockpit_members SET clients='{}' WHERE auth_user_id=$1",
      [BUYER],
    );
    await actor(db, BUYER);
    const p = (
      await db.query<{ p: Row }>("SELECT public.cockpit_winner_preview($1) p", [
        { campaignName: CAMPAIGN, adId: AD, start: kd(6), end: today },
      ])
    ).rows[0].p;
    expect(p.adId).toBe(AD);
    expect(p.stats).toMatchObject({ bookings: 3, through: kd(2) });
    expect(p.window).toEqual({ start: kd(6), end: today });
  });
});

describe("the guard", () => {
  test("a body changed since refuses and changes nothing", async () => {
    const own = await md5(WINNER_SIG);
    await q(`CREATE OR REPLACE FUNCTION public.cockpit_winner_numbers(p_campaign text,p_id text,p_start date,p_end date)
      RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT '{}'::jsonb $$`);
    const changed = await md5(WINNER_SIG);
    await refuses(
      migration(FILE),
      /cockpit_winner_numbers is not the definition this file was written against \(prosrc md5 [0-9a-f]{32}\)\. Re-read the live definition and rebase this file/,
    );
    expect(await md5(WINNER_SIG)).toBe(changed);
    expect(await md5(STATS_SIG)).not.toBe(STATS_LIVE);
    // Put the file's own body back: the guard takes it again.
    const body = migration(FILE).match(
      /CREATE OR REPLACE FUNCTION public\.cockpit_winner_numbers[\s\S]*?\$fn\$;/,
    );
    if (!body) throw new Error("The winner numbers body moved in the file");
    await q(body[0]);
    expect(await md5(WINNER_SIG)).toBe(own);
  });

  test("a different cockpit_media_week refuses too", async () => {
    await q(`CREATE OR REPLACE FUNCTION public.cockpit_media_week() RETURNS jsonb LANGUAGE sql STABLE
      SECURITY DEFINER SET search_path='' AS $$ SELECT '{}'::jsonb $$`);
    await refuses(
      migration(FILE),
      /cockpit_media_week is not the definition this file was written against/,
    );
    await q("DROP FUNCTION public.cockpit_media_week()");
    // A missing function is created again; the replaced ones are the file's own.
    await apply();
    expect((await week()).source).toBe("media sync");
  });

  test("a missing replaced function refuses", async () => {
    await q(
      "ALTER FUNCTION public.cockpit_media_statistics(text,text,date,date) RENAME TO cockpit_media_statistics_moved",
    );
    try {
      await refuses(
        migration(FILE),
        /cockpit_media_statistics is not the definition this file was written against \(prosrc md5 missing\)/,
      );
    } finally {
      await q(
        "ALTER FUNCTION public.cockpit_media_statistics_moved(text,text,date,date) RENAME TO cockpit_media_statistics",
      );
    }
  });
});
