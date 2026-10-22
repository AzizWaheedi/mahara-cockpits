// Meta's zero reads never overwrite a settled ad-day (2026-10-21):
// supabase/migrations/20261021k_meta_ad_days_zero_reads.sql against
// PGlite, on the production chain of cockpit_meta_ad_days_apply (20261016121700,
// 20261016210100, 20261017100000, 20261018120000 with the creative dashboard's
// tables it needs), with Supabase's default privileges emulated so a missing
// REVOKE shows. The shape of the zero read is Atlantis's on 21 Oct 09:07 Kuwait
// (Los Angeles days, 19 Oct: $0, 0 impressions, 0 clicks, link clicks and leads
// kept). Made-up ad accounts, ads and numbers; no provider is called.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

const FILE = "20261021k_meta_ad_days_zero_reads.sql";
/** md5 of this file's own body: its guard accepts it, so it applies twice. */
const MINE = "31c1e5724ff8dd063431367034e9031a";
/** The apply this file replaces, as 20261018120000 left it (live prosrc md5 on 21 Oct). */
const BEFORE = "20261018120000_meta_dashboard_feed.sql";
const CEO = "00000000-0000-4000-8000-0000000000c1";
const LA = "1111111111111"; // Los Angeles days, like Atlantis's 290802986
const RY = "2222222222222"; // Riyadh days
/** Kuwait 09:07 on 21 Oct: 23:07 on 20 Oct in Los Angeles, 09:07 on 21 Oct in Riyadh. */
const NOW = "2026-10-21T09:07:00+03:00";
const EARLIER = "2026-10-21T08:07:00+03:00";
const SIG = "public.cockpit_meta_ad_days_apply(jsonb)";

let db: PGlite;

const DASHBOARD = `
CREATE TABLE public.clients(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, meta_ad_account_id text UNIQUE,
  currency text NOT NULL DEFAULT 'USD', is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(),
  meta_business_id text, platform text NOT NULL DEFAULT 'meta', tiktok_advertiser_id text, ghl_location_id text,
  hidden_from_dashboard boolean NOT NULL DEFAULT false);
CREATE TABLE public.sync_jobs(client_id uuid PRIMARY KEY REFERENCES public.clients(id) ON DELETE CASCADE, last_synced_at timestamptz,
  last_sync_status text CHECK (last_sync_status = ANY (ARRAY['success','rate_limited','error','running'])), last_error text,
  next_eligible_sync timestamptz, last_backfill_at timestamptz);
CREATE TABLE public.ads_daily_snapshots(ad_id text NOT NULL, client_id uuid NOT NULL, date date NOT NULL, ad_name text, campaign_id text,
  campaign_name text, campaign_status text, effective_status text, spend numeric NOT NULL DEFAULT 0, impressions integer NOT NULL DEFAULT 0,
  clicks integer NOT NULL DEFAULT 0, ctr numeric, cpm numeric, leads integer NOT NULL DEFAULT 0, thumbnail_url text,
  last_synced_at timestamptz NOT NULL DEFAULT now(), platform text NOT NULL DEFAULT 'meta', link_clicks integer, smart_plus_ad_id text,
  PRIMARY KEY (ad_id, client_id, date));`;

const CLOCK = `CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_now() RETURNS timestamptz LANGUAGE sql STABLE SET search_path='' AS
  $$ SELECT current_setting('test.now')::timestamptz $$;
  REVOKE ALL ON FUNCTION public.cockpit_meta_ad_days_now() FROM PUBLIC, anon, authenticated, service_role;`;

async function at(iso: string) {
  await owner(db);
  await db.query("SELECT set_config('test.now',$1,false)", [iso]);
}
async function service() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await db.exec("SET ROLE service_role");
}
async function svc(fn: string, p: unknown = {}): Promise<any> {
  await service();
  const r = await db.query<{ r: any }>(`SELECT public.${fn}($1::jsonb) AS r`, [
    JSON.stringify(p),
  ]);
  return r.rows[0].r;
}
async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  await owner(db);
  return (await db.query<T>(sql, params)).rows;
}
async function refused(
  fn: () => Promise<unknown>,
  code: string,
): Promise<string> {
  let caught: { code?: string; message?: string } | null = null;
  try {
    await fn();
  } catch (e) {
    caught = e as { code?: string; message?: string };
  }
  expect(caught?.code).toBe(code);
  return caught?.message ?? "";
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

const account = (accountId: string, timezone: string) => ({
  accountId,
  name: `Account ${accountId.slice(0, 2)}`,
  currency: "USD",
  timezone,
  status: 1,
  spend: 100,
  edge: "client",
});
const ZONES: Record<string, string> = {
  [LA]: "America/Los_Angeles",
  [RY]: "Asia/Riyadh",
};

/** One run of `job` with a days task per account over [since, until]; every task leased, by account. */
async function run(
  job: string,
  accounts: string[],
  since: string,
  until: string,
) {
  const begun = await svc("cockpit_meta_ad_days_begin", {
    job,
    requestedBy: "cron",
    graphVersion: "v25.0",
    window: { since, until },
    accounts: accounts.map(a => account(a, ZONES[a])),
    tasks: accounts.map(accountId => ({
      kind: "days",
      accountId,
      since,
      until,
    })),
  });
  expect(begun.started).toBe(true);
  const claimed = (await svc("cockpit_meta_ad_days_claim", {
    limit: 5,
    leaseSeconds: 300,
  })) as any[];
  return {
    runId: begun.runId as string,
    task: Object.fromEntries(claimed.map(t => [t.accountId, t])) as Record<
      string,
      any
    >,
  };
}
async function closeOpenRuns() {
  await owner(db);
  await db.exec(
    `UPDATE cockpit_meta_ad_day_tasks SET state='failed', lease_token=NULL, lease_until=NULL, error='closed by the test' WHERE state IN ('pending','running')`,
  );
  for (const r of await q<{ id: string }>(
    "SELECT id FROM cockpit_meta_ad_day_runs WHERE state='running'",
  ))
    await q("SELECT public.cockpit_meta_ad_days_finish($1::uuid)", [r.id]);
}
const apply = (
  t: any,
  fetchedAt: string,
  rows: unknown[],
  over: Record<string, unknown> = {},
) =>
  svc("cockpit_meta_ad_days_apply", {
    taskId: t.id,
    leaseToken: t.leaseToken,
    fetchedAt,
    rows,
    final: true,
    ...over,
  });

/** A delivered ad-day; `zero` is Meta's zero read of it, with what Meta kept passed in `over`. */
function adRow(
  accountId: string,
  adId: string,
  day: string,
  over: Record<string, unknown> = {},
) {
  return {
    account_id: accountId,
    day,
    campaign_id: "120000000000001",
    campaign_name: "Atlantis-mahara-7\\10",
    objective: "OUTCOME_LEADS",
    adset_id: "120000000000002",
    adset_name: "Broad",
    ad_id: adId,
    ad_name: `Ad ${adId.slice(-2)}`,
    spend: 7.51,
    impressions: 300,
    reach: 260,
    frequency: 1.15,
    clicks: 20,
    link_clicks: 8,
    leads: 2,
    lead_actions: 2,
    landing_page_views: null,
    video_plays: null,
    video_3s: null,
    video_p25: null,
    video_p50: null,
    video_p75: null,
    video_p100: null,
    thruplays: null,
    destination_type: "ON_AD",
    ...over,
  };
}
const zero = (
  accountId: string,
  adId: string,
  day: string,
  over: Record<string, unknown> = {},
) =>
  adRow(accountId, adId, day, {
    spend: 0,
    impressions: 0,
    reach: 0,
    frequency: 0,
    clicks: 0,
    link_clicks: 0,
    leads: 0,
    lead_actions: 0,
    ...over,
  });

async function stored(adId: string, day: string) {
  const [r] = await q<any>(
    `SELECT spend::float8 spend, spend_usd::float8 usd, impressions::int impressions, link_clicks::int link_clicks, leads::int leads,
            to_char(fetched_at AT TIME ZONE 'Asia/Kuwait','HH24:MI') read_at
       FROM cockpit_meta_ad_days WHERE ad_id = $1 AND day = $2::date`,
    [adId, day],
  );
  return r;
}
const taskRow = async (id: number) =>
  (
    await q<any>(
      "SELECT state, note, error, rows_read, changed FROM cockpit_meta_ad_day_tasks WHERE id = $1",
      [id],
    )
  )[0];

/** Store a delivered read at 08:07 Kuwait: the read a later zero read must not undo. */
async function settle(
  accountId: string,
  rows: unknown[],
  since: string,
  until: string,
) {
  await at(EARLIER);
  const { task } = await run("hourly", [accountId], since, until);
  const r = await apply(task[accountId], EARLIER, rows);
  expect(r.run).toBe("ok");
  await at(NOW);
}

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await db.exec(migration("20260921e_tap_charges.sql"));
  await db.exec(
    "REVOKE ALL ON public.cockpit_sync_state, public.cockpit_tap_charges FROM anon, authenticated;",
  );
  await member(db, CEO, "aziz@maharamedia.com", []);
  await owner(db);
  await db.exec(DASHBOARD);
  await db.exec(migration("20261010a_exclude_unauthorized_ads.sql"));
  await db.exec(migration("20261016121700_meta_ad_days.sql"));
  await db.exec(migration("20261016210100_meta_ad_days_checked.sql"));
  await db.exec(migration("20261017100000_meta_budgets.sql"));
  await db.exec(migration(BEFORE));
  await db.exec(migration(FILE));
  // Twice: the file is safe to apply again.
  await db.exec(migration(FILE));
  await db.exec(CLOCK);
  await at(NOW);
});

afterAll(async () => {
  await db?.close();
});

describe("a zero read cannot overwrite a settled day", () => {
  test("Atlantis's shape, read without the kept link clicks: the 08:07 read stands and the note counts it", async () => {
    const ads = ["52500000000000916", "52500000000000716"];
    await settle(
      LA,
      [
        adRow(LA, ads[0], "2026-10-19"),
        adRow(LA, ads[1], "2026-10-19", { spend: 3.71, impressions: 140 }),
      ],
      "2026-10-19",
      "2026-10-20",
    );

    // 09:07 Kuwait: 19 Oct has finished on Los Angeles' clock (it is 23:07 on 20 Oct there).
    const { runId, task } = await run(
      "hourly",
      [LA],
      "2026-10-19",
      "2026-10-20",
    );
    const r = await apply(
      task[LA],
      NOW,
      [zero(LA, ads[0], "2026-10-19"), zero(LA, ads[1], "2026-10-19")],
      {
        note: "Read in 2 pieces: Meta could not build 2026-10-19 to 2026-10-20 in one go.",
      },
    );
    expect(r).toMatchObject({
      keptZeroReads: 2,
      written: 0,
      inserted: 0,
      changed: 0,
      olderThanStored: 0,
      run: "ok",
    });
    expect(await stored(ads[0], "2026-10-19")).toEqual({
      spend: 7.51,
      usd: 7.51,
      impressions: 300,
      link_clicks: 8,
      leads: 2,
      read_at: "08:07",
    });
    expect(await stored(ads[1], "2026-10-19")).toMatchObject({
      spend: 3.71,
      impressions: 140,
      read_at: "08:07",
    });
    const t = await taskRow(task[LA].id);
    expect(t.note).toBe(
      "Kept 2 settled ad-days Meta read as $0 and 0 impressions; the earlier read stands. Read in 2 pieces: Meta could not build 2026-10-19 to 2026-10-20 in one go.",
    );
    expect(t.changed).toBe(0);
    const [run1] = await q<any>(
      "SELECT state FROM cockpit_meta_ad_day_runs WHERE id = $1",
      [runId],
    );
    expect(run1.state).toBe("ok");
  });

  test("the zeroed read with Atlantis's link clicks is refused: the task fails, the run reads partial and names the account", async () => {
    const ad = "52500000000000917";
    await settle(LA, [adRow(LA, ad, "2026-10-19")], "2026-10-19", "2026-10-20");
    const { runId, task } = await run(
      "hourly",
      [LA, RY],
      "2026-10-19",
      "2026-10-20",
    );
    const msg = await refused(
      () =>
        apply(task[LA], NOW, [
          zero(LA, ad, "2026-10-19", {
            link_clicks: 8,
            leads: 2,
            lead_actions: 2,
          }),
        ]),
      "22023",
    );
    expect(msg).toBe(
      `Meta's rows for act_${LA} held ad ${ad} on 2026-10-19: link clicks with no impressions (Meta zeroed the read); nothing was written`,
    );
    expect(await stored(ad, "2026-10-19")).toMatchObject({
      spend: 7.51,
      impressions: 300,
      read_at: "08:07",
    });
    // What run.ts does with a 22023: the task fails without a retry.
    expect(
      await svc("cockpit_meta_ad_days_fail", {
        taskId: task[LA].id,
        leaseToken: task[LA].leaseToken,
        error: msg,
        retry: false,
      }),
    ).toMatchObject({
      state: "failed",
    });
    expect(
      (
        await apply(task[RY], NOW, [
          adRow(RY, "52500000000000300", "2026-10-20"),
        ])
      ).run,
    ).toBe("partial");
    const [r] = await q<any>(
      "SELECT state, note FROM cockpit_meta_ad_day_runs WHERE id = $1",
      [runId],
    );
    expect(r.state).toBe("partial");
    expect(r.note).toContain(
      `Could not read Account 11 (${LA}): Meta's rows for act_${LA} held ad ${ad} on 2026-10-19: link clicks with no impressions`,
    );
    const [sync] = await q<any>(
      "SELECT ok FROM cockpit_sync_state WHERE key = 'meta-ad-days-hourly'",
    );
    expect(sync.ok).toBe(false);
  });

  test("link clicks with no clicks and no spend are refused too; Meta's own drift (more link clicks than clicks) is not", async () => {
    const { task } = await run("hourly", [RY], "2026-10-20", "2026-10-21");
    const msg = await refused(
      () =>
        apply(
          task[RY],
          NOW,
          [
            adRow(RY, "52500000000000301", "2026-10-20", {
              spend: 0,
              clicks: 0,
              link_clicks: 3,
            }),
          ],
          { final: false },
        ),
      "22023",
    );
    expect(msg).toContain(
      "link clicks with no clicks and no spend (Meta zeroed the read)",
    );
    // City Wood's real 23 Sep read: 6 link clicks against 5 clicks on $6.51 and 246 impressions.
    const r = await apply(task[RY], NOW, [
      adRow(RY, "52500000000000302", "2026-10-20", {
        spend: 6.51,
        impressions: 246,
        clicks: 5,
        link_clicks: 6,
      }),
    ]);
    expect(r).toMatchObject({ inserted: 1, written: 1, keptZeroReads: 0 });
    // NULL is "Meta did not return it", never a zero read.
    await closeOpenRuns();
    const again = await run("hourly", [RY], "2026-10-20", "2026-10-21");
    const n = await apply(again.task[RY], NOW, [
      adRow(RY, "52500000000000303", "2026-10-20", {
        impressions: null,
        clicks: null,
      }),
    ]);
    expect(n).toMatchObject({ inserted: 1 });
  });

  test("the kept rows add up over the calls of a task, and a retry counts afresh", async () => {
    const ads = ["52500000000000401", "52500000000000402", "52500000000000403"];
    await settle(
      RY,
      ads.map(a => adRow(RY, a, "2026-10-18")),
      "2026-10-18",
      "2026-10-21",
    );
    const { task } = await run("hourly", [RY], "2026-10-18", "2026-10-21");
    const note = "Ad statuses and thumbnails were not read: Meta was slow.";
    expect(
      await apply(
        task[RY],
        NOW,
        [zero(RY, ads[0], "2026-10-18"), zero(RY, ads[1], "2026-10-18")],
        { final: false, note },
      ),
    ).toMatchObject({
      keptZeroReads: 2,
    });
    expect(
      await apply(task[RY], NOW, [zero(RY, ads[2], "2026-10-18")], {
        final: false,
        note,
      }),
    ).toMatchObject({ keptZeroReads: 1 });
    expect((await taskRow(task[RY].id)).note).toBe(
      `Kept 3 settled ad-days Meta read as $0 and 0 impressions; the earlier read stands. ${note}`,
    );
    // A call without a note keeps the function's note after the count.
    await apply(task[RY], NOW, [adRow(RY, "52500000000000404", "2026-10-21")], {
      final: false,
    });
    expect((await taskRow(task[RY].id)).note).toBe(
      `Kept 3 settled ad-days Meta read as $0 and 0 impressions; the earlier read stands. ${note}`,
    );
    // The lease runs out; the retry's first call keeps one, and says one.
    await at("2026-10-21T09:15:00+03:00");
    const [retry] = (await svc("cockpit_meta_ad_days_claim", {
      limit: 1,
      leaseSeconds: 300,
    })) as any[];
    expect(retry.id).toBe(task[RY].id);
    await apply(retry, "2026-10-21T09:15:00+03:00", [
      zero(RY, ads[0], "2026-10-18"),
    ]);
    expect((await taskRow(task[RY].id)).note).toBe(
      `Kept 1 settled ad-day Meta read as $0 and 0 impressions; the earlier read stands. ${note}`,
    );
    await at(NOW);
    expect(await stored(ads[0], "2026-10-18")).toMatchObject({
      spend: 7.51,
      impressions: 300,
      read_at: "08:07",
    });
  });
});

describe("every other read still lands", () => {
  test("a real lower read of a finished day still updates it", async () => {
    const ad = "52500000000000501";
    await settle(LA, [adRow(LA, ad, "2026-10-19")], "2026-10-19", "2026-10-20");
    const { task } = await run("hourly", [LA], "2026-10-19", "2026-10-20");
    const r = await apply(task[LA], NOW, [
      adRow(LA, ad, "2026-10-19", {
        spend: 6.9,
        impressions: 280,
        clicks: 18,
        link_clicks: 7,
        leads: 1,
        lead_actions: 1,
      }),
    ]);
    expect(r).toMatchObject({ changed: 1, written: 1, keptZeroReads: 0 });
    expect(await stored(ad, "2026-10-19")).toEqual({
      spend: 6.9,
      usd: 6.9,
      impressions: 280,
      link_clicks: 7,
      leads: 1,
      read_at: "09:07",
    });
    // Spend 0 with impressions is a read Meta delivered: it lands too.
    await closeOpenRuns();
    const again = await run("hourly", [LA], "2026-10-19", "2026-10-20");
    expect(
      await apply(again.task[LA], NOW, [
        adRow(LA, ad, "2026-10-19", {
          spend: 0,
          impressions: 12,
          clicks: 0,
          link_clicks: 0,
          leads: 0,
          lead_actions: 0,
        }),
      ]),
    ).toMatchObject({ changed: 1, keptZeroReads: 0 });
    expect(await stored(ad, "2026-10-19")).toMatchObject({
      spend: 0,
      impressions: 12,
    });
  });

  test("today's row still updates from zero, and today is left to Meta's next hourly read", async () => {
    const ad = "52500000000000601";
    // 20 Oct is today in Los Angeles: an early read with no delivery yet.
    await settle(LA, [zero(LA, ad, "2026-10-20")], "2026-10-19", "2026-10-20");
    expect(await stored(ad, "2026-10-20")).toMatchObject({
      spend: 0,
      impressions: 0,
    });
    const { task } = await run("hourly", [LA], "2026-10-19", "2026-10-20");
    expect(
      await apply(
        task[LA],
        NOW,
        [adRow(LA, ad, "2026-10-20", { spend: 3.2, impressions: 150 })],
        { final: false },
      ),
    ).toMatchObject({
      changed: 1,
      keptZeroReads: 0,
    });
    expect(await stored(ad, "2026-10-20")).toMatchObject({
      spend: 3.2,
      impressions: 150,
      read_at: "09:07",
    });
    // A zero read of today replaces it: the hour after re-reads today.
    await at("2026-10-21T09:10:00+03:00");
    expect(
      await apply(task[LA], "2026-10-21T09:10:00+03:00", [
        zero(LA, ad, "2026-10-20"),
      ]),
    ).toMatchObject({ changed: 1, keptZeroReads: 0 });
    expect(await stored(ad, "2026-10-20")).toMatchObject({
      spend: 0,
      impressions: 0,
      read_at: "09:10",
    });
    await at(NOW);
  });

  test("a zeroed read of today is not refused: yesterday's rows in the same call land, and the day is judged once it has finished", async () => {
    const yAd = "52500000000000602";
    const tAd = "52500000000000603";
    // 09:07 Kuwait: 20 Oct is today in Los Angeles. Meta zeroes today's row but keeps its link clicks.
    const { task } = await run("hourly", [LA], "2026-10-19", "2026-10-20");
    expect(
      await apply(task[LA], NOW, [
        adRow(LA, yAd, "2026-10-19"),
        zero(LA, tAd, "2026-10-20", { link_clicks: 5 }),
      ]),
    ).toMatchObject({ inserted: 2, written: 2, keptZeroReads: 0, run: "ok" });
    expect(await stored(yAd, "2026-10-19")).toMatchObject({
      spend: 7.51,
      read_at: "09:07",
    });
    expect(await stored(tAd, "2026-10-20")).toMatchObject({
      spend: 0,
      impressions: 0,
      link_clicks: 5,
    });
    // 10:07 Kuwait: 20 Oct has finished in Los Angeles. The same zeroed read is refused now.
    await at("2026-10-21T10:07:00+03:00");
    const later = await run("hourly", [LA], "2026-10-20", "2026-10-21");
    expect(
      await refused(
        () =>
          apply(later.task[LA], "2026-10-21T10:07:00+03:00", [
            zero(LA, tAd, "2026-10-20", { link_clicks: 5 }),
          ]),
        "22023",
      ),
    ).toContain(
      `ad ${tAd} on 2026-10-20: link clicks with no impressions (Meta zeroed the read)`,
    );
    await closeOpenRuns();
    await at(NOW);
  });

  test("the day is the account's own: the same zero read of 20 Oct is kept on Riyadh's clock, not on Los Angeles'", async () => {
    const ryAd = "52500000000000701";
    const laAd = "52500000000000702";
    await settle(
      RY,
      [adRow(RY, ryAd, "2026-10-20")],
      "2026-10-20",
      "2026-10-21",
    );
    await settle(
      LA,
      [adRow(LA, laAd, "2026-10-20")],
      "2026-10-19",
      "2026-10-20",
    );
    const { task } = await run("hourly", [RY, LA], "2026-10-19", "2026-10-21");
    expect(
      await apply(task[RY], NOW, [zero(RY, ryAd, "2026-10-20")]),
    ).toMatchObject({ keptZeroReads: 1 });
    expect(
      await apply(task[LA], NOW, [zero(LA, laAd, "2026-10-20")]),
    ).toMatchObject({ keptZeroReads: 0, changed: 1 });
    expect(await stored(ryAd, "2026-10-20")).toMatchObject({
      spend: 7.51,
      read_at: "08:07",
    });
    expect(await stored(laAd, "2026-10-20")).toMatchObject({
      spend: 0,
      read_at: "09:07",
    });
  });

  test("an earlier read never replaces a later one, a zero read included", async () => {
    const ad = "52500000000000801";
    const { task } = await run("hourly", [RY], "2026-10-19", "2026-10-21");
    await apply(task[RY], NOW, [adRow(RY, ad, "2026-10-19")], { final: false });
    const r = await apply(task[RY], EARLIER, [zero(RY, ad, "2026-10-19")]);
    expect(r).toMatchObject({
      olderThanStored: 1,
      written: 0,
      keptZeroReads: 0,
    });
    expect(await stored(ad, "2026-10-19")).toMatchObject({
      spend: 7.51,
      read_at: "09:07",
    });
  });
});

describe("the guards of 20261018120000 stand", () => {
  test("every row check is still there, word for word", async () => {
    const body = (src: string) => {
      const head = src.indexOf(
        "CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_apply",
      );
      return src.slice(head, src.indexOf("\n$$;", head));
    };
    const old = body(migration(BEFORE));
    const mine = body(migration(FILE));
    const whens = old
      .split("\n")
      .filter(
        l =>
          /^\s+WHEN /.test(l) ||
          /^\s+r\.video_plays/.test(l) ||
          /OR r\.destination_type LIKE/.test(l),
      );
    expect(whens.length).toBe(10);
    for (const l of whens) expect(mine).toContain(l);
    expect(mine).toContain("WHERE x.fetched_at <= EXCLUDED.fetched_at");
    for (const guard of [
      "PERFORM public.cockpit_meta_ad_days_require_service();",
      "t := public.cockpit_meta_ad_days_leased(p, ARRAY['days']);",
      "IF jsonb_array_length(v_rows) > 2000",
      "RAISE EXCEPTION 'fetchedAt must be when Meta answered, within the last hour'",
      "held one ad twice on a day; nothing was written",
    ])
      expect(mine).toContain(guard);
  });

  test("rows outside the task, from another account, twice or negative are still refused", async () => {
    const { task } = await run("hourly", [RY], "2026-10-20", "2026-10-21");
    const send = (rows: unknown[]) =>
      apply(task[RY], NOW, rows, { final: false });
    expect(
      await refused(
        () => send([adRow(RY, "52500000000000901", "2026-10-12")]),
        "22023",
      ),
    ).toContain("a day outside the task's days");
    expect(
      await refused(
        () => send([adRow(LA, "52500000000000901", "2026-10-20")]),
        "22023",
      ),
    ).toContain("a row from another ad account");
    expect(
      await refused(
        () =>
          send([adRow(RY, "52500000000000901", "2026-10-20", { spend: -1 })]),
        "22023",
      ),
    ).toContain("a negative number");
    expect(
      await refused(
        () =>
          send([
            adRow(RY, "52500000000000901", "2026-10-20"),
            adRow(RY, "52500000000000901", "2026-10-20"),
          ]),
        "22023",
      ),
    ).toContain("one ad twice on a day");
    expect(
      await refused(
        () => apply(task[RY], "2026-10-21T07:00:00+03:00", []),
        "22023",
      ),
    ).toContain("within the last hour");
    await closeOpenRuns();
  });

  test("it runs for the service role only, as the owner, with an empty search path", async () => {
    const [p] = await q<any>(
      "SELECT prosecdef, proconfig FROM pg_proc WHERE oid = $1::regprocedure",
      [SIG],
    );
    expect(p).toEqual({ prosecdef: true, proconfig: ['search_path=""'] });
    for (const role of ["anon", "authenticated", "service_role"]) {
      const [x] = await q<{ ok: boolean }>(
        "SELECT has_function_privilege($1, $2, 'EXECUTE') ok",
        [role, SIG],
      );
      expect({ role, ok: x.ok }).toEqual({ role, ok: role === "service_role" });
    }
  });

  test("the file refuses a definition it was not written against, and changes nothing", async () => {
    const md5 = async () =>
      (
        await q<{ m: string }>(
          "SELECT md5(prosrc) m FROM pg_proc WHERE oid = $1::regprocedure",
          [SIG],
        )
      )[0].m;
    const mine = await md5();
    // The guard names this body: a change to it without the guard's hash would refuse every second apply.
    expect(mine).toBe(MINE);
    expect(migration(FILE)).toContain(`'${MINE}'`);
    // The live body before this file is 20261018120000's.
    await owner(db);
    await db.exec(migration(BEFORE));
    expect(await md5()).toBe("8d81d8eb68621d56cdb8e9561578adb3");
    await db.exec(`CREATE OR REPLACE FUNCTION public.cockpit_meta_ad_days_apply(p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
      SET search_path='' AS $$ BEGIN RETURN '{}'::jsonb; END $$;`);
    await refuses(
      migration(FILE),
      /not the definition this file was written against/,
    );
    await db.exec(migration(BEFORE));
    await db.exec(migration(FILE));
    await db.exec(CLOCK);
    expect(await md5()).toBe(mine);
  });
});
