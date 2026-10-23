/**
 * One client's numbers over any range (migration 20261022x_media_client_range.sql,
 * cost per booking build 2, contract 2.5, audit R8) on an isolated PostgreSQL.
 *
 * The tables are the canonical ones (cockpit_campaigns from 20260923o and 20260927k,
 * the media statistics chain 20260927j and 20261010c, the media sources 20260927w,
 * the board's client spine and days from 20261016111157, the Meta store from
 * 20261016121700, the compromise list from 20261010a), then 20261022w and the file,
 * applied twice. Invented clients carry one case each:
 *   Client K: a live campaign, a stopped one, one whose card was retired (it counts,
 *     as Khalida's 4\10 does), an internal one (never), a repeated import of one
 *     ad-day (the newest counts), an ad on the compromise list (summed from the Meta
 *     store), an ad account it shares with Client KB (it counts once, under the
 *     first location) and one it shares with Client KC, a client the restricted seat
 *     may not read (its name is not shown to that seat).
 *   Client S: a renamed campaign whose old name the cockpit no longer lists, and its
 *     own pre-launch campaign in the Meta store (off board, as Shades').
 *   Client O: an outsiders' campaign (off board, as SAFAD's) and an outsider ad on the
 *     compromise list; no booking.
 *   Client D: done with you. Client M: a day the board has no figure for.
 *   Client N: no ad account. Client L's account: on no client (unmatched).
 *   Client Z: bookings and no spend on Mahara's campaigns (no cost per booking).
 *   Client P: only spend off Mahara's campaigns, one of them named as another
 *     client's Mahara campaign (off board all the same); not listed unless asked for.
 *   Client Q: no ad account, a booking event that carries its location.
 *   Client G: a day Meta holds for its Mahara campaign and the media data does not
 *     (named, no cost per booking); a day the two differ by a dollar is not a missing
 *     day.
 * The first day counted: the campaign list's first import, the media data's and the
 * Meta store's first days; before them nothing is counted.
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

const FILE = "20261022x_media_client_range.sql";
const SIG = "public.cockpit_media_client_range(date,date,text[])";

const CEO = "00000000-0000-4000-8000-0000000000f0";
const BUYER = "00000000-0000-4000-8000-0000000000f1";
const LIMITED = "00000000-0000-4000-8000-0000000000f2";
const CSM = "00000000-0000-4000-8000-0000000000f3";

const LOC = {
  K: "locA_rangeK",
  KB: "locB_rangeKB",
  S: "locC_rangeS",
  O: "locD_rangeO",
  D: "locE_rangeD",
  M: "locF_rangeM",
  N: "locG_rangeN",
  KC: "locH_rangeKC",
  Z: "locI_rangeZ",
  P: "locJ_rangeP",
  Q: "locK_rangeQ",
  G: "locL_rangeG",
};
const ACC = {
  K1: "1000000001",
  K2: "1000000002",
  K3: "1000000003",
  S1: "2000000001",
  O1: "3000000001",
  D1: "4000000001",
  M1: "5000000001",
  L1: "9000000001",
  Z1: "6100000001",
  P1: "6200000001",
  G1: "6300000001",
};

const DAY = 86400_000;
const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const kd = (n: number) =>
  new Date(Date.parse(`${today}T12:00:00Z`) - n * DAY)
    .toISOString()
    .slice(0, 10);
/** A day as the read writes it in a sentence: "5 Oct 2026". */
const said = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
/** When the cockpit's campaign list was first imported in the fixture. */
const LISTED_AT = new Date(Date.now() - 30 * DAY).toISOString();

let db: PGlite;
type Row = Record<string, any>;
async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  await owner(db);
  return (await db.query<T>(text, params)).rows;
}
async function apply() {
  await owner(db);
  await db.exec(migration(FILE));
}
async function md5(sig: string): Promise<string | null> {
  return (
    await q<{ m: string | null }>(
      "SELECT (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure($1)) m",
      [sig],
    )
  )[0].m;
}
async function refuses(sql: string, why: RegExp) {
  await owner(db);
  try {
    await expect(db.exec(sql)).rejects.toThrow(why);
  } finally {
    await db.exec("ROLLBACK");
  }
}
/** The read as a seat. */
async function read(
  who: string | null,
  start: string,
  end: string,
  accounts: string[] | null = null,
): Promise<Row> {
  await actor(db, who);
  try {
    return (
      await db.query<{ r: Row }>(
        "SELECT public.cockpit_media_client_range($1::date,$2::date,$3::text[]) r",
        [start, end, accounts],
      )
    ).rows[0].r;
  } finally {
    await owner(db);
  }
}
const byName = (r: Row) =>
  Object.fromEntries((r.clients as Row[]).map(c => [c.name, c]));

/** The canonical table definitions this read stands on. */
function canonical(file: string, re: RegExp): string {
  const hit = migration(file).match(re);
  if (!hit) throw new Error(`A table definition moved in ${file}`);
  return hit[0];
}

let n = 0;
async function campaign(
  name: string,
  client: string,
  account: string | null,
  raw: Row,
  extra: { deleted?: boolean; taskId?: string | null; updatedAt?: string } = {},
) {
  n += 1;
  await q(
    `INSERT INTO public.cockpit_campaigns(client_name,meta_account_id,task_id,raw_data,source_deployment,source_id,source_deleted,updated_at,created_at)
     VALUES($1,$2,$3,$4::jsonb,'fixture',$5,$6,coalesce($7::timestamptz, now()),$8)`,
    [
      client,
      account,
      extra.taskId ?? null,
      JSON.stringify({ campaignName: name, clientName: client, ...raw }),
      `c${n}`,
      extra.deleted ?? false,
      extra.updatedAt ?? null,
      LISTED_AT,
    ],
  );
}
async function daily(
  campaignName: string,
  day: string,
  ad: string,
  spend: number,
  leads = 0,
  extra: Row = {},
  importedAt: string | null = null,
) {
  n += 1;
  await q(
    `INSERT INTO public.cockpit_media_daily_stats(source_deployment,source_id,campaign_name,day,data,imported_at)
     VALUES('fixture',$1,$2,$3,$4::jsonb,coalesce($5::timestamptz, now()))`,
    [
      `d${n}`,
      campaignName,
      day,
      JSON.stringify({
        campaignName,
        date: day,
        metaAdId: ad,
        adName: `Ad ${ad}`,
        spend,
        leads,
        impressions: 100,
        linkClicks: 1,
        ...extra,
      }),
      importedAt,
    ],
  );
}
async function event(
  id: string,
  campaignName: string,
  day: string,
  loc: string,
  source = id,
) {
  await q(
    `INSERT INTO public.cockpit_media_booking_events(source_deployment,source_id,campaign_name,day,data)
     VALUES('fixture',$1,$2,$3,$4::jsonb)`,
    [
      source,
      campaignName,
      day,
      JSON.stringify({
        campaignName,
        date: day,
        eventId: id,
        locationId: loc,
        status: "confirmed",
      }),
    ],
  );
}
async function adDay(r: {
  account: string;
  day: string;
  campaign: string;
  campaignName: string;
  ad: string;
  spend: number;
  usd?: number | null;
  currency?: string;
}) {
  const usd = r.usd === undefined ? r.spend : r.usd;
  await q(
    `INSERT INTO public.cockpit_meta_ad_days(account_id,account_currency,day,campaign_id,campaign_name,ad_id,spend,spend_usd,usd_rate,fetched_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now())`,
    [
      r.account,
      r.currency ?? "USD",
      r.day,
      r.campaign,
      r.campaignName,
      r.ad,
      r.spend,
      usd,
      usd === null ? null : 1,
    ],
  );
}
/** The board's confirmed bookings: one row per day of the range, `skip` days left out. */
async function days(
  loc: string,
  booked: Record<number, number>,
  skip: number[] = [],
) {
  for (let d = 7; d >= 0; d--) {
    if (skip.includes(d)) continue;
    await q(
      "INSERT INTO public.cockpit_client_days(location_id,day,confirmed_bookings) VALUES($1,$2,$3)",
      [loc, kd(d), booked[d] ?? 0],
    );
  }
}

beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await db.exec("CREATE TABLE public.clients(id uuid PRIMARY KEY);");
  await db.exec(
    canonical(
      "20260923o_cockpit_domain_tables.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_campaigns \([\s\S]*?\n\);/,
    ),
  );
  for (const line of migration(
    "20260927k_cockpit_snapshot_reconcile.sql",
  ).match(
    /ALTER TABLE public\.cockpit_campaigns ADD COLUMN IF NOT EXISTS [^;]+;/g,
  ) ?? [])
    await db.exec(line);
  await db.exec(migration("20260927j_cockpit_media_statistics.sql"));
  await db.exec(migration("20261010c_cockpit_media_statistics_call_times.sql"));
  await db.exec(migration("20260927w_media_read_models.sql"));
  // 20261022w also replaces the winner numbers, so the winner saves stand under it as live.
  await db.exec(`CREATE TABLE public.winner_ads(ad_id text PRIMARY KEY, ad_name text, client text, spend numeric, leads int,
    cpl numeric, origin text, first_seen_at timestamptz, last_seen_at timestamptz);
    ALTER TABLE public.winner_ads ENABLE ROW LEVEL SECURITY;`);
  await db.exec(
    canonical(
      "20260926m_cockpit_csm_state.sql",
      /CREATE OR REPLACE FUNCTION public\.cockpit_client_allowed[\s\S]*?END \$\$;/,
    ),
  );
  await db.exec(migration("20260927q_cockpit_winner_saves.sql"));
  await db.exec(
    canonical(
      "20261016111157_board_facts.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_board_clients \([\s\S]*?\n\);/,
    ),
  );
  await db.exec(
    canonical(
      "20261016111157_board_facts.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_client_days \([\s\S]*?\n\);/,
    ),
  );
  await db.exec(
    canonical(
      "20261016121700_meta_ad_days.sql",
      /CREATE TABLE IF NOT EXISTS public\.cockpit_meta_ad_days \([\s\S]*?\n\);/,
    ),
  );
  await db.exec(
    canonical(
      "20261010a_exclude_unauthorized_ads.sql",
      /create table if not exists public\.cockpit_excluded_ads \([\s\S]*?\n\);/,
    ),
  );
  await db.exec(
    "ALTER TABLE public.cockpit_excluded_ads ENABLE ROW LEVEL SECURITY;",
  );
  await db.exec(migration("20261022w_media_week.sql"));

  await member(db, CEO, "aziz@maharamedia.com", []);
  await member(db, BUYER, "buyer-range@tests.invalid", ["media_buyer"]);
  await member(db, LIMITED, "limited-range@tests.invalid", ["media_buyer"]);
  await member(db, CSM, "csm-range@tests.invalid", ["csm"]);
  await q(
    "UPDATE public.cockpit_members SET clients=ARRAY['Client K'] WHERE auth_user_id=$1",
    [LIMITED],
  );
  await q("UPDATE public.cockpit_media_feed_state SET ready = true");

  // The board's client spine.
  for (const [name, loc, mode, accounts, status] of [
    ["Client K", LOC.K, "DFY", [ACC.K1, ACC.K2, ACC.K3], "Active"],
    ["Client KB", LOC.KB, "DFY", [ACC.K2], "Active"],
    ["Client KC", LOC.KC, "DFY", [ACC.K3], "Active"],
    ["Client Z", LOC.Z, "DFY", [ACC.Z1], "Active"],
    ["Client P", LOC.P, "DFY", [ACC.P1], "Cancelled"],
    ["Client Q", LOC.Q, "DFY", [], "Active"],
    ["Client G", LOC.G, "DFY", [ACC.G1], "Active"],
    ["Client S", LOC.S, "DFY", [ACC.S1], "Active"],
    ["Client O", LOC.O, "DFY", [ACC.O1], "Active"],
    ["Client D", LOC.D, "DWY", [ACC.D1], "Active"],
    ["Client M", LOC.M, "DFY", [ACC.M1], "Active"],
    ["Client N", LOC.N, "DFY", [], "Active"],
  ] as const)
    await q(
      "INSERT INTO public.cockpit_board_clients(location_id,clickup_id,client_name,status,service_mode,ad_account_ids) VALUES($1,$2,$3,$4,$5,$6)",
      [loc, `cu_${loc}`, name, status, mode, accounts],
    );

  // The cockpit's campaigns, stopped and deleted rows included.
  const old = new Date(Date.now() - 20 * DAY).toISOString();
  await campaign(
    "K live",
    "Client K",
    ACC.K2,
    { taskId: "t1" },
    { deleted: true, updatedAt: old },
  );
  await campaign("K live", "Client K", `act_${ACC.K1}`, {
    taskId: "t1",
    metaCampaignId: "6000000001",
  });
  await campaign(
    "K stopped",
    "Client K",
    ACC.K1,
    { taskId: "t2" },
    { deleted: true },
  );
  await campaign(
    "K retired",
    "Client K",
    ACC.K2,
    { retiredTaskId: "r3", onBoard: true },
    { deleted: true },
  );
  await campaign("K internal", "Client K", ACC.K1, {
    taskId: "t4",
    internal: true,
  });
  await campaign("S new", "Client S", ACC.S1, {
    taskId: "t5",
    metaCampaignId: "6000000005",
  });
  await campaign(
    "O mahara",
    "Client O",
    ACC.O1,
    { taskId: "t6" },
    { taskId: "t6" },
  );
  await campaign("D dwy", "Client D", ACC.D1, { taskId: "t7" });
  await campaign("M main", "Client M", ACC.M1, { taskId: "t8" });
  await campaign("L lost", "Client L", ACC.L1, { taskId: "t9" });
  await campaign("G main", "Client G", ACC.G1, {
    taskId: "t10",
    metaCampaignId: "6000000902",
  });

  // Media sync ad-days.
  for (let d = 7; d >= 1; d--)
    await daily("K live", kd(d), "7100000001", 10, 1);
  await daily("K live", kd(4), "7100000001", 999, 9, {}, old); // an older import of the same ad-day
  await daily("K live", kd(9), "7100000001", 1000, 1); // before the range
  await daily("K live", kd(2), "7100000099", 500, 0); // on the compromise list
  await daily("K stopped", kd(7), "7100000002", 20);
  await daily("K stopped", kd(6), "7100000002", 20);
  await daily("K retired", kd(5), "7100000003", 15, 0, {
    accountId: `act_${ACC.K2}`,
  });
  await daily("K internal", kd(3), "7100000004", 99, 3);
  await daily("S old", kd(6), "7200000001", 30, 1, {}, old);
  await daily("S old", kd(5), "7200000001", 29, 1, {}, old);
  await daily("S new", kd(5), "7200000001", 31, 1);
  await daily("S new", kd(4), "7200000001", 30, 1);
  await daily("S new", kd(3), "7200000001", 30, 1);
  await daily("O mahara", kd(4), "7300000001", 5);
  await daily("O outsiders", kd(3), "7300000099", 200);
  await daily("D dwy", kd(2), "7400000001", 50, 5);
  await daily("M main", kd(2), "7500000001", 40, 2);
  await daily("L lost", kd(2), "7900000001", 25, 1);
  await daily("G main", kd(5), "7600000001", 40, 2);
  await q(
    "INSERT INTO public.cockpit_excluded_ads(ad_id,account_id,reason) VALUES('7100000099',$1,'fixture'),('7300000098',$2,'fixture')",
    [ACC.K1, ACC.O1],
  );

  // The board's Meta store, whole accounts.
  await adDay({
    account: ACC.S1,
    day: kd(7),
    campaign: "6000000099",
    campaignName: "S pre-launch",
    ad: "8200000001",
    spend: 90.07,
  });
  await adDay({
    account: ACC.S1,
    day: kd(6),
    campaign: "6000000099",
    campaignName: "S pre-launch",
    ad: "8200000002",
    spend: 10,
    usd: null,
    currency: "XXX",
  });
  await adDay({
    account: ACC.S1,
    day: today,
    campaign: "6000000099",
    campaignName: "S pre-launch",
    ad: "8200000001",
    spend: 70,
  });
  await adDay({
    account: ACC.S1,
    day: kd(4),
    campaign: "6000000005",
    campaignName: "S renamed in Meta",
    ad: "7200000001",
    spend: 30,
  });
  await adDay({
    account: ACC.O1,
    day: kd(3),
    campaign: "6000000098",
    campaignName: "O outsiders",
    ad: "7300000099",
    spend: 200,
  });
  await adDay({
    account: ACC.O1,
    day: kd(2),
    campaign: "6000000097",
    campaignName: "O outsiders 2",
    ad: "7300000098",
    spend: 70,
  });
  await adDay({
    account: ACC.K1,
    day: kd(3),
    campaign: "6000000777",
    campaignName: "K live",
    ad: "7100000001",
    spend: 10,
  });
  // The listed ad as Meta holds it: $20 more than the media data has.
  await adDay({
    account: ACC.K1,
    day: kd(2),
    campaign: "6000000001",
    campaignName: "K live",
    ad: "7100000099",
    spend: 520,
  });
  // Client G: Meta holds a day of its Mahara campaign the media data does not, and a day
  // the two differ by a dollar (the media data's day stands).
  await adDay({
    account: ACC.G1,
    day: kd(5),
    campaign: "6000000902",
    campaignName: "G main",
    ad: "7600000001",
    spend: 41,
  });
  await adDay({
    account: ACC.G1,
    day: kd(4),
    campaign: "6000000902",
    campaignName: "G main",
    ad: "7600000001",
    spend: 25,
  });
  // Client P: spend off Mahara's campaigns only. "M main" is Client M's Mahara campaign
  // on another ad account, so here it is off board.
  await adDay({
    account: ACC.P1,
    day: kd(3),
    campaign: "6000000444",
    campaignName: "M main",
    ad: "8400000001",
    spend: 12,
  });
  await adDay({
    account: ACC.P1,
    day: kd(2),
    campaign: "6000000445",
    campaignName: "P own",
    ad: "8400000002",
    spend: 30,
  });

  // The board's confirmed bookings by booking day.
  await days(LOC.K, { 5: 1, 2: 1, 0: 5 });
  await days(LOC.KB, {});
  await days(LOC.S, { 4: 2 });
  await days(LOC.O, {});
  await days(LOC.D, { 2: 3 });
  await days(LOC.M, { 2: 1 }, [3]);
  await days(LOC.N, { 6: 1, 2: 1 });
  await days(LOC.Z, { 3: 2 });
  await days(LOC.P, {});
  await days(LOC.Q, { 3: 1 });
  await days(LOC.G, { 5: 1 });

  // The media sync's bookings.
  await event("eK1", "K live", kd(2), LOC.K);
  await event("eK2", "K stopped", kd(5), LOC.K);
  await event("eK2", "K stopped", kd(5), LOC.K, "eK2-again");
  await event("eK3", "K live", today, LOC.K);
  await event("eS1", "S new", kd(4), LOC.S);
  await event("eS2", "S new", kd(4), LOC.S);
  await event("eQ1", "Q not listed", kd(3), LOC.Q);

  await apply();
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("the file", () => {
  test("applies twice, creates one definer function the browser may call and anon may not", async () => {
    const once = await md5(SIG);
    await apply();
    expect(await md5(SIG)).toBe(once);
    expect(migration(FILE)).toContain(`'${once}'`);
    expect(migration(FILE)).not.toContain(String.fromCodePoint(0x2014));
    const [f] = await q<{
      acl: string;
      definer: boolean;
      cfg: string;
      vol: string;
    }>(
      "SELECT proacl::text acl, prosecdef definer, proconfig::text cfg, provolatile::text vol FROM pg_proc WHERE oid = to_regprocedure($1)",
      [SIG],
    );
    expect(f.definer).toBe(true);
    expect(f.cfg).toContain("search_path");
    expect(f.vol).toBe("s");
    expect(f.acl).toContain("authenticated=X");
    expect(f.acl).not.toContain("anon=X");
    expect(f.acl).not.toMatch(/(^|[{,])=X/);
    await actor(db, null);
    await expect(
      db.query("SELECT public.cockpit_media_client_range($1::date,$2::date)", [
        kd(7),
        kd(1),
      ]),
    ).rejects.toThrow(/permission denied/);
    await owner(db);
  });

  test("refuses a body it did not write, and refuses without cockpit_media_week", async () => {
    await q(`CREATE OR REPLACE FUNCTION public.cockpit_media_client_range(p_start date, p_end date, p_accounts text[] DEFAULT NULL)
      RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT '{}'::jsonb $$`);
    const changed = await md5(SIG);
    await refuses(
      migration(FILE),
      /cockpit_media_client_range is not the definition this file was written against \(prosrc md5 [0-9a-f]{32}\)\. Re-read the live definition and rebase this file/,
    );
    expect(await md5(SIG)).toBe(changed);
    await q(
      "DROP FUNCTION public.cockpit_media_client_range(date,date,text[])",
    );
    await q(
      "ALTER FUNCTION public.cockpit_media_week() RENAME TO cockpit_media_week_moved",
    );
    try {
      await refuses(
        migration(FILE),
        /cockpit_media_week is missing: apply 20261022w_media_week\.sql first/,
      );
    } finally {
      await q(
        "ALTER FUNCTION public.cockpit_media_week_moved() RENAME TO cockpit_media_week",
      );
    }
    await apply();
    expect(await md5(SIG)).not.toBe(changed);
  });
});

describe("who may read it", () => {
  test("a seat that is not a media buyer, admin or the CEO is refused", async () => {
    await actor(db, CSM);
    await expect(
      db.query("SELECT public.cockpit_media_client_range($1::date,$2::date)", [
        kd(7),
        kd(1),
      ]),
    ).rejects.toThrow("Verified media-buyer access required");
    await owner(db);
  });

  test("a range must be in order and under 400 days; account ids are digits", async () => {
    await expect(read(BUYER, kd(1), kd(7))).rejects.toThrow(
      "Choose a valid range of at most 400 days",
    );
    await expect(read(BUYER, kd(400), kd(0))).rejects.toThrow(
      "Choose a valid range of at most 400 days",
    );
    await expect(read(BUYER, kd(7), kd(1), ["abc"])).rejects.toThrow(
      "An ad account id is its digits, with or without act_",
    );
  });

  test("a restricted seat reads only its clients and none of the unmatched spend", async () => {
    const r = await read(LIMITED, kd(7), kd(1));
    expect((r.clients as Row[]).map(c => c.name)).toEqual(["Client K"]);
    expect(r.unmatched).toEqual([]);
    // Client KC is not this seat's: the note about the account it shares does not name it.
    expect(byName(r)["Client K"].why).toBe(
      `Ad account ${ACC.K2} is also linked to Client KB; its spend counts here, once, against this client's bookings only. Ad account ${ACC.K3} is also linked to another client; its spend counts here, once, against this client's bookings only.`,
    );
    expect(JSON.stringify(r)).not.toContain("Client KC");
    const k = await read(LIMITED, kd(7), kd(1), [ACC.K2]);
    expect((k.clients as Row[]).map(c => c.name)).toEqual([
      "Client K",
      "Client KB",
    ]);
  });

  test("the CEO and an unrestricted media buyer read the same", async () => {
    expect(await read(CEO, kd(7), kd(1))).toEqual(
      await read(BUYER, kd(7), kd(1)),
    );
  });

  test("no figure is shown before the daily history is verified", async () => {
    await q(
      "UPDATE public.cockpit_media_feed_state SET ready=false WHERE feed='dailyStats'",
    );
    try {
      await expect(read(BUYER, kd(7), kd(1))).rejects.toThrow(
        "Daily statistics history has not been imported and verified yet",
      );
    } finally {
      await q(
        "UPDATE public.cockpit_media_feed_state SET ready=true WHERE feed='dailyStats'",
      );
    }
  });
});

describe("the numbers, the last 7 days", () => {
  let r: Row;
  let c: Record<string, Row>;
  beforeAll(async () => {
    r = await read(BUYER, kd(7), kd(1));
    c = byName(r);
  });

  test("the range, its paired end and where it came from", () => {
    expect(r).toMatchObject({
      from: kd(7),
      to: kd(1),
      countedFrom: kd(7),
      through: kd(1),
      throughSource: "media data",
    });
    // Client P spent only off Mahara's campaigns and booked nothing: not listed.
    expect(Object.keys(c)).toEqual([
      "Client D",
      "Client G",
      "Client K",
      "Client M",
      "Client N",
      "Client O",
      "Client Q",
      "Client S",
      "Client Z",
    ]);
  });

  test("Client K: stopped and retired-card campaigns count, internal and listed ads never, one row per ad-day", () => {
    expect(c["Client K"]).toEqual({
      clickupId: `cu_${LOC.K}`,
      locationId: LOC.K,
      name: "Client K",
      serviceMode: "DFY",
      status: "Active",
      accounts: [ACC.K1, ACC.K2, ACC.K3],
      spend: 125,
      leads: 7,
      offBoardSpend: 0,
      excludedSpend: 520,
      campaigns: [
        {
          campaignName: "K live",
          spend: 70,
          leads: 7,
          bookings: 1,
          live: true,
        },
        {
          campaignName: "K stopped",
          spend: 40,
          leads: 0,
          bookings: 1,
          live: false,
        },
        {
          campaignName: "K retired",
          spend: 15,
          leads: 0,
          bookings: 0,
          live: false,
        },
      ],
      bookings: 2,
      days: 7,
      storedDays: 7,
      mediaBookings: 2,
      costPerBooking: 62.5,
      why: `Ad account ${ACC.K2} is also linked to Client KB; its spend counts here, once, against this client's bookings only. Ad account ${ACC.K3} is also linked to Client KC; its spend counts here, once, against this client's bookings only.`,
    });
  });

  test("Client S: a renamed campaign counts once, its own pre-launch spend is named off board", () => {
    expect(c["Client S"]).toMatchObject({
      spend: 121,
      leads: 4,
      offBoardSpend: 90.07,
      excludedSpend: 0,
      campaigns: [
        {
          campaignName: "S new",
          spend: 121,
          leads: 4,
          bookings: 2,
          live: true,
        },
      ],
      bookings: 2,
      mediaBookings: 2,
      costPerBooking: 60.5,
    });
    expect(c["Client S"].why).toBe(
      "Some of the account's other spend is in a currency with no fixed USD rate, so the spend off Mahara's campaigns is at least this.",
    );
  });

  test("Client O: outsiders' spend is off board, an outsider ad on the list is excluded, no booking is no cost", () => {
    expect(c["Client O"]).toMatchObject({
      spend: 5,
      leads: 0,
      offBoardSpend: 200,
      excludedSpend: 70,
      bookings: 0,
      mediaBookings: 0,
      costPerBooking: null,
      why: null,
    });
  });

  test("Client D, Client M and Client N: not known, never 0, with the reason", () => {
    expect(c["Client D"]).toMatchObject({
      spend: 50,
      leads: 5,
      bookings: null,
      storedDays: 7,
      mediaBookings: null,
      costPerBooking: null,
      why: "Done with you: the client books its own meetings.",
    });
    expect(c["Client M"]).toMatchObject({
      spend: 40,
      bookings: null,
      days: 7,
      storedDays: 6,
      costPerBooking: null,
      why: "Bookings are not stored for 1 of the 7 days.",
    });
    expect(c["Client N"]).toMatchObject({
      accounts: [],
      spend: null,
      leads: null,
      offBoardSpend: null,
      excludedSpend: null,
      bookings: 2,
      mediaBookings: null,
      costPerBooking: null,
      why: "No Meta ad account is linked to this client, so its spend is not known.",
    });
  });

  test("Client Q: no ad account, but its booking events carry its location, so the second source counts them", () => {
    expect(c["Client Q"]).toMatchObject({
      accounts: [],
      spend: null,
      bookings: 1,
      mediaBookings: 1,
      costPerBooking: null,
      why: "No Meta ad account is linked to this client, so its spend is not known.",
    });
  });

  test("Client G: a day Meta holds and the media data does not is named, and there is no cost per booking", () => {
    expect(c["Client G"]).toMatchObject({
      spend: 40,
      leads: 2,
      offBoardSpend: 0,
      bookings: 1,
      costPerBooking: null,
      why: "Meta holds $25.00 on Mahara's campaigns for days the media data does not have; the spend shown leaves it out, so there is no cost per booking.",
    });
  });

  test("Client Z: bookings and no spend on Mahara's campaigns is no cost per booking, never $0.00", () => {
    expect(c["Client Z"]).toMatchObject({
      accounts: [ACC.Z1],
      spend: 0,
      leads: 0,
      offBoardSpend: 0,
      bookings: 2,
      mediaBookings: 0,
      costPerBooking: null,
      why: "No spend on Mahara's campaigns is counted for these days, so there is no cost per booking.",
    });
  });

  test("Client P: spend off Mahara's campaigns alone is read when asked for, a same-named campaign on its account included", async () => {
    const p = byName(await read(BUYER, kd(7), kd(1), [ACC.P1]));
    expect(Object.keys(p)).toEqual(["Client P"]);
    expect(p["Client P"]).toMatchObject({
      spend: 0,
      leads: 0,
      offBoardSpend: 42,
      excludedSpend: 0,
      campaigns: [],
      bookings: 0,
      mediaBookings: 0,
      costPerBooking: null,
      why: null,
    });
  });

  test("Mahara's spend on an account no client has is listed apart", () => {
    expect(r.unmatched).toEqual([
      { account: ACC.L1, campaigns: ["L lost"], spend: 25 },
    ]);
  });
});

describe("the paired end and the account filter", () => {
  test("a range to today stops on the last day of data: today's bookings and spend are not in", async () => {
    const r = await read(BUYER, kd(7), today);
    expect(r).toMatchObject({ from: kd(7), to: today, through: kd(1) });
    const week = byName(await read(BUYER, kd(7), kd(1)));
    expect(byName(r)["Client K"]).toEqual(week["Client K"]);
    expect(byName(r)["Client S"].offBoardSpend).toBe(90.07);
  });

  test("overnight, the media sync's window ends two days back and every figure stops there", async () => {
    await q(
      "UPDATE public.cockpit_media_source_state SET ready=true, row_count=1, source_snapshot_at=now() WHERE table_name='clientLinks'",
    );
    await q(
      `INSERT INTO public.cockpit_media_sources(table_name,source_id,client_names,data,source_snapshot_at)
       SELECT 'clientLinks','k','{}',jsonb_build_object('_id','k','ads7d',jsonb_build_object('from',$1::text,'through',$2::text)),source_snapshot_at
       FROM public.cockpit_media_source_state WHERE table_name='clientLinks'`,
      [kd(8), kd(2)],
    );
    try {
      const r = await read(BUYER, kd(7), today);
      expect(r).toMatchObject({ through: kd(2), throughSource: "media sync" });
      const k = byName(r)["Client K"];
      expect(k).toMatchObject({
        spend: 115,
        leads: 6,
        bookings: 2,
        days: 6,
        storedDays: 6,
        costPerBooking: 57.5,
      });
      expect(byName(r)["Client M"]).toMatchObject({
        bookings: null,
        why: "Bookings are not stored for 1 of the 6 days.",
      });
    } finally {
      await q(
        "UPDATE public.cockpit_media_source_state SET ready=false WHERE table_name='clientLinks'",
      );
    }
  });

  test("a range wholly after the paired day: every figure null, with the reason", async () => {
    const r = await read(BUYER, today, today);
    expect(r).toMatchObject({
      from: today,
      to: today,
      countedFrom: null,
      through: kd(1),
    });
    expect(r.clients).toEqual([
      {
        clickupId: `cu_${LOC.K}`,
        locationId: LOC.K,
        name: "Client K",
        serviceMode: "DFY",
        status: "Active",
        accounts: [ACC.K1, ACC.K2, ACC.K3],
        spend: null,
        leads: null,
        offBoardSpend: null,
        excludedSpend: null,
        campaigns: [],
        bookings: null,
        days: null,
        storedDays: null,
        mediaBookings: null,
        costPerBooking: null,
        why: "Meta's numbers for these days are not in yet.",
      },
    ]);
    expect(r.unmatched).toEqual([]);
  });

  test("ad accounts narrow the read, act_ or not; a shared account names where it counts", async () => {
    const r = await read(BUYER, kd(7), kd(1), [`act_${ACC.K2}`, ACC.L1]);
    const c = byName(r);
    expect(Object.keys(c)).toEqual(["Client K", "Client KB"]);
    // Client KB's only account counts under Client K: its spend is not known here, never 0.
    expect(c["Client KB"]).toMatchObject({
      spend: null,
      leads: null,
      offBoardSpend: null,
      excludedSpend: null,
      bookings: 0,
      mediaBookings: null,
      costPerBooking: null,
      why: `Ad account ${ACC.K2} is also linked to Client K, so its numbers count there.`,
    });
    expect(c["Client K"].spend).toBe(125);
    expect(r.unmatched).toEqual([
      { account: ACC.L1, campaigns: ["L lost"], spend: 25 },
    ]);
  });

  test("before the booking history is verified, the second source is not shown", async () => {
    await q(
      "UPDATE public.cockpit_media_feed_state SET ready=false WHERE feed='bookingEvents'",
    );
    try {
      const k = byName(await read(BUYER, kd(7), kd(1)))["Client K"];
      expect(k.mediaBookings).toBeNull();
      expect(k.bookings).toBe(2);
      expect((k.campaigns as Row[]).map(x => x.bookings)).toEqual([
        null,
        null,
        null,
      ]);
      expect(k.why).toContain(
        "The media sync's booking history is not imported yet, so its count is not shown.",
      );
    } finally {
      await q(
        "UPDATE public.cockpit_media_feed_state SET ready=true WHERE feed='bookingEvents'",
      );
    }
  });
});

describe("the first day counted", () => {
  test("a range that starts before the Meta store's first day counts from it and says so", async () => {
    const r = await read(BUYER, kd(9), kd(1));
    expect(r).toMatchObject({
      from: kd(9),
      countedFrom: kd(7),
      through: kd(1),
    });
    const { why, ...k } = byName(r)["Client K"];
    const { why: weekWhy, ...week } = byName(await read(BUYER, kd(7), kd(1)))[
      "Client K"
    ];
    // The $1,000 on the day before is not in.
    expect(k).toEqual(week);
    expect(why).toBe(
      `Meta's numbers are stored from ${said(kd(7))}, so the days before it are not counted; these numbers count from ${said(kd(7))}. ${weekWhy}`,
    );
  });

  test("before the campaign list's first import Mahara's campaigns cannot be told apart, so those days are not counted", async () => {
    // First imported at noon Kuwait time three days ago: its campaigns are complete from the day after.
    await q("UPDATE public.cockpit_campaigns SET created_at = $1", [
      `${kd(3)}T09:00:00Z`,
    ]);
    try {
      const r = await read(BUYER, kd(7), kd(1));
      expect(r).toMatchObject({
        from: kd(7),
        countedFrom: kd(2),
        through: kd(1),
      });
      const k = byName(r)["Client K"];
      expect(k).toMatchObject({
        spend: 20,
        leads: 2,
        excludedSpend: 520,
        bookings: 1,
        days: 2,
        storedDays: 2,
        mediaBookings: 1,
        costPerBooking: 20,
      });
      expect(k.why).toStartWith(
        `The cockpit's campaign list starts on ${said(kd(2))}, so spend before it cannot be split into Mahara's campaigns and the client's own; these numbers count from ${said(kd(2))}. Ad account ${ACC.K2}`,
      );

      // A range wholly before it: every figure null, with the reason; the clients that booked are listed.
      const before = await read(BUYER, kd(7), kd(3));
      expect(before).toMatchObject({ countedFrom: null, through: kd(3) });
      expect(Object.keys(byName(before))).toEqual([
        "Client G",
        "Client K",
        "Client N",
        "Client Q",
        "Client S",
        "Client Z",
      ]);
      expect(byName(before)["Client K"]).toMatchObject({
        spend: null,
        leads: null,
        offBoardSpend: null,
        excludedSpend: null,
        campaigns: [],
        bookings: null,
        days: null,
        storedDays: null,
        mediaBookings: null,
        costPerBooking: null,
        why: `The cockpit's campaign list starts on ${said(kd(2))}, so spend before it cannot be split into Mahara's campaigns and the client's own.`,
      });
      expect(before.unmatched).toEqual([]);
    } finally {
      await q("UPDATE public.cockpit_campaigns SET created_at = $1", [
        LISTED_AT,
      ]);
    }
  });

  test("with no campaign list at all the read refuses rather than call every campaign the client's own", async () => {
    await q(
      "CREATE TABLE public.campaigns_aside AS SELECT * FROM public.cockpit_campaigns",
    );
    await q("DELETE FROM public.cockpit_campaigns");
    try {
      await expect(read(BUYER, kd(7), kd(1))).rejects.toThrow(
        "The cockpit's campaign list has not been imported yet",
      );
    } finally {
      await q(
        "INSERT INTO public.cockpit_campaigns SELECT * FROM public.campaigns_aside",
      );
      await q("DROP TABLE public.campaigns_aside");
    }
    expect(byName(await read(BUYER, kd(7), kd(1)))["Client K"].spend).toBe(125);
  });
});
