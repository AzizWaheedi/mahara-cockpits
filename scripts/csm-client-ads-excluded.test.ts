import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  actor,
  member,
  migration,
  owner,
} from "../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb";
import { nativeFeedDb } from "./lib/nativeFeedDb";

// The client page's Ads tab leaves out the ads on the compromise list
// (2026-10-21): 20261021j on top of the production chain of
// cockpit_csm_client_ads (20261012c, 20261012d, 20261013180100) and the list
// itself (20261010a). Canonical SQL throughout; only the rows are fixtures. The
// listed ad ids are 20261010a's (Liwan's three, Ideal Elite's one); every other
// id, name, day and amount is made up.

const FILE = "20261021j_csm_client_ads_excluded.sql";
/** md5 of this file's own body: its guard accepts it, so it applies twice. */
const MINE = "b7f7b6055141427e1947f54f096b0193";
const LEAD = "70000000-0000-4000-8000-000000000003",
  OTHER = "70000000-0000-4000-8000-000000000002";
const SIG = "public.cockpit_csm_client_ads(text,date,date)";
const OUT1 = "120246624477980705",
  OUT2 = "120246747852310705",
  OUT3 = "120246747887330705"; // Liwan's listed ads
const OUT_IE = "120252448730350064"; // Ideal Elite's listed ad
const OWN = "52500000000000001";
const LIWAN = "Liwan |MAHARA|10\\9",
  IDEAL = "Ideal Elite | Leads | Sep2026 | MHM™";
type Json = Record<string, any>;
let db: Awaited<ReturnType<typeof nativeFeedDb>>;
let before: Json, beforeIdeal: Json;

const campaign = (id: string, client: string, name: string) =>
  db.query(
    `INSERT INTO cockpit_campaigns(client_name,source_deployment,source_id,source_deleted,raw_data) VALUES($1,'test',$2,false,$3)`,
    [
      client,
      id,
      JSON.stringify({
        campaignName: name,
        clientName: client,
        accountName: `${client} ads`,
        metaCampaignId: `9${id}`,
        metaAccountId: "act_1",
        currency: "USD",
        budgetDaily: 20,
        budgetLevel: "campaign",
        verdict: "watch",
      }),
    ],
  );
let n = 0;
const stat = (
  name: string,
  day: string,
  ad: string | null,
  spend: number,
  sourceId?: string,
) =>
  db.query(
    `INSERT INTO cockpit_media_daily_stats(source_deployment,source_id,campaign_name,day,data) VALUES('test',$1,$2,$3::date,$4)`,
    [
      sourceId ?? `native:dailyStats:${++n}`,
      name,
      day,
      JSON.stringify({
        campaignName: name,
        date: day,
        spend,
        leads: 1,
        impressions: 500,
        linkClicks: 5,
        ...(ad === null ? { metaAdId: "" } : { metaAdId: ad }),
        adName: `Ad ${day}`,
        adSetName: "Leads",
      }),
    ],
  );
async function read(who: string | null, task: string) {
  await actor(db, who);
  try {
    return (
      await db.query<{ v: Json }>(
        "SELECT cockpit_csm_client_ads($1,$2::date,$3::date) v",
        [task, "2026-10-01", "2026-10-20"],
      )
    ).rows[0].v;
  } finally {
    await owner(db);
  }
}
const spend = (rows: Json[]) =>
  Math.round(rows.reduce((s, r) => s + Number(r.spend), 0) * 100) / 100;
/** A migration that refuses leaves its transaction aborted: roll it back, as a failed apply does. */
async function refuses(sql: string, why: RegExp) {
  try {
    await expect(db.exec(sql)).rejects.toThrow(why);
  } finally {
    await db.exec("ROLLBACK");
  }
}

beforeAll(async () => {
  db = await nativeFeedDb();
  const gate = migration("20261006c_csm_onboarding_checkins.sql").match(
    /CREATE FUNCTION public\.cockpit_csm_client_gate_for_actor[\s\S]*?GRANT EXECUTE ON FUNCTION public\.cockpit_csm_client_gate\(text\) TO authenticated;/,
  )?.[0];
  if (!gate) throw new Error("Canonical client gate missing");
  await db.exec(gate);
  const changes = migration("20261011c_csm_call_store.sql").match(
    /CREATE TABLE IF NOT EXISTS public\.cockpit_csm_changes\([\s\S]*?\n\);/,
  )?.[0];
  if (!changes) throw new Error("Canonical change table missing");
  await db.exec(changes);
  // The list and its first 19 ads, as 20261010a wrote them (its snapshot trigger belongs to another team's table).
  const list = migration("20261010a_exclude_unauthorized_ads.sql").match(
    /create table if not exists public\.cockpit_excluded_ads[\s\S]*?on conflict \(ad_id\) do nothing;/,
  )?.[0];
  if (!list) throw new Error("Canonical compromise list missing");
  await db.exec(list);
  for (const name of [
    "20261012c_csm_client_ads.sql",
    "20261012d_csm_client_ads_feed_last.sql",
    "20261013180100_csm_client_ads_v3.sql",
  ])
    await db.exec(migration(name));
  await member(db, LEAD, "lead@tests.invalid", ["csm"]);
  await member(db, OTHER, "other@tests.invalid", ["csm"]);
  await db.query(
    "UPDATE cockpit_members SET clients=$1 WHERE auth_user_id=$2",
    [["Ideal Elite"], OTHER],
  );
  await db.exec(`UPDATE cockpit_csm_source_state SET ready=true,row_count=2,source_snapshot_at=now() WHERE table_name='clients';
  INSERT INTO cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) SELECT 'clients','liwan',ARRAY['Liwan Limited'],'{"_id":"liwan","name":"Liwan Limited","taskId":"cu-liwan"}',source_snapshot_at FROM cockpit_csm_source_state WHERE table_name='clients';
  INSERT INTO cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) SELECT 'clients','ie',ARRAY['Ideal Elite'],'{"_id":"ie","name":"Ideal Elite","taskId":"cu-ie"}',source_snapshot_at FROM cockpit_csm_source_state WHERE table_name='clients';
  UPDATE cockpit_media_feed_state SET ready=true,source_snapshot_at=now() WHERE feed IN('dailyStats','bookingEvents');`);
  await campaign("l1", "Liwan Limited", LIWAN);
  await campaign("i1", "Ideal Elite", IDEAL);
  // Liwan: its own ad, the outsiders' three (the 20261021 leftovers), and history on both sides.
  await stat(LIWAN, "2026-09-05", OUT1, 116.83);
  await stat(LIWAN, "2026-09-10", OWN, 12.5);
  await stat(LIWAN, "2026-10-02", OUT1, 515.38);
  await stat(LIWAN, "2026-10-03", OUT2, 248.27);
  await stat(LIWAN, "2026-10-04", OUT3, 253.0);
  await stat(LIWAN, "2026-10-05", OWN, 100.0);
  await stat(LIWAN, "2026-10-11", OWN, 94.58);
  // A row without an ad id is kept: nothing names it on the list.
  await stat(LIWAN, "2026-10-12", null, 0);
  // An older row keyed by its source id alone, when that id is a listed ad, is the listed ad's.
  await stat(LIWAN, "2026-10-13", null, 40.0, OUT2);
  // Ideal Elite: only the outsiders' ad ever spent.
  await stat(IDEAL, "2026-09-24", OUT_IE, 183.76);
  await stat(IDEAL, "2026-10-06", OUT_IE, 394.86);
  before = await read(LEAD, "cu-liwan");
  beforeIdeal = await read(LEAD, "cu-ie");
  await db.exec(migration(FILE));
  // Twice: the file is safe to apply again.
  await db.exec(migration(FILE));
});
afterAll(async () => {
  await db.close();
});

describe("20261021j: the Ads tab leaves out the compromise list", () => {
  test("before: the outsiders' rows counted as the client's", async () => {
    expect(spend(before.rows)).toBe(1251.23);
    expect(before.rows.map((r: Json) => r.adId)).toEqual(
      expect.arrayContaining([OUT1, OUT2, OUT3]),
    );
    expect(spend(beforeIdeal.rows)).toBe(394.86);
  });

  test("Liwan: only its own rows, $194.58 for 1-20 Oct, history and coverage too", async () => {
    const v = await read(LEAD, "cu-liwan");
    expect(spend(v.rows)).toBe(194.58);
    expect(v.rows.map((r: Json) => [r.date, r.adId])).toEqual([
      ["2026-10-05", OWN],
      ["2026-10-11", OWN],
      ["2026-10-12", ""],
    ]);
    expect(v.history.map((r: Json) => [r.date, r.adId])).toEqual([
      ["2026-09-10", OWN],
    ]);
    // The first listed day (5 Sep) no longer starts the client's numbers.
    expect(v.coverage).toEqual({ first: "2026-09-10", last: "2026-10-12" });
    expect(before.coverage).toEqual({
      first: "2026-09-05",
      last: "2026-10-13",
    });
  });

  test("a client whose only spend is the outsiders' has no ad numbers, never $0 of its own", async () => {
    const v = await read(OTHER, "cu-ie");
    expect(v.rows).toEqual([]);
    expect(v.history).toEqual([]);
    expect(v.coverage).toEqual({ first: null, last: null });
    expect(beforeIdeal.coverage).toEqual({
      first: "2026-09-24",
      last: "2026-10-06",
    });
  });

  test("a campaign of Mahara's whose name the outsiders copied stays listed, with no numbers of the outsiders'", async () => {
    // Live on 22 Oct: the outsiders' campaigns carried Mahara's own names (Ideal Elite's 120252448730360064 beside
    // Mahara's 120252287639780064, Khalida's 120246795745530088 beside Mahara's 120246329802450088), so their
    // leftover rows were filed under Mahara's campaign. The campaign row is Mahara's, its id is not on the list,
    // and it did not spend in the period: it stays in the list of campaigns that did not spend.
    const v = await read(OTHER, "cu-ie");
    expect(v.campaigns.map((c: Json) => [c.name, c.metaCampaignId])).toEqual([
      [IDEAL, "9i1"],
    ]);
    expect(beforeIdeal.campaigns).toEqual(v.campaigns);
    expect(v.rows).toEqual([]);
  });

  test("every other key comes back as before; the import's first and last day are unchanged", async () => {
    const v = await read(LEAD, "cu-liwan");
    const strip = (x: Json) => {
      const { at: _, rows: _r, history: _h, coverage: _c, ...rest } = x;
      return rest;
    };
    expect(Object.keys(v).sort()).toEqual(Object.keys(before).sort());
    expect(strip(v)).toEqual(strip(before));
    expect(v.feedFirst).toBe("2026-09-05");
    expect(v.feedLast).toBe("2026-10-13");
  });

  test("the gate is unchanged: a seat is refused a client off its list", async () => {
    await expect(read(OTHER, "cu-liwan")).rejects.toThrow(
      "That client is not on your access list",
    );
    await expect(read(null, "cu-liwan")).rejects.toThrow(/permission denied/);
  });

  test("it stays a read: stable, definer, empty search path, authenticated only", async () => {
    const p = (
      await db.query<Json>(
        `SELECT provolatile,prosecdef,proconfig,prosrc FROM pg_proc WHERE oid=$1::regprocedure`,
        [SIG],
      )
    ).rows[0];
    expect(p.provolatile).toBe("s");
    expect(p.prosecdef).toBe(true);
    expect(p.proconfig).toEqual(['search_path=""']);
    expect(p.prosrc).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(
      p.prosrc.match(
        /NOT EXISTS \(SELECT 1 FROM public\.cockpit_excluded_ads x/g,
      ),
    ).toHaveLength(2);
    const can = async (role: string) =>
      (
        await db.query<{ ok: boolean }>(
          `SELECT has_function_privilege($1,$2,'EXECUTE') ok`,
          [role, SIG],
        )
      ).rows[0].ok;
    expect(await can("authenticated")).toBe(true);
    expect(await can("anon")).toBe(false);
    expect(await can("service_role")).toBe(false);
  });

  test("the file refuses a definition it was not written against, and changes nothing", async () => {
    const src = async () =>
      (
        await db.query<{ s: string }>(
          `SELECT md5(prosrc) s FROM pg_proc WHERE oid=$1::regprocedure`,
          [SIG],
        )
      ).rows[0].s;
    const mine = await src();
    // The guard names this body: a change to it without the guard's hash would refuse every second apply.
    expect(mine).toBe(MINE);
    expect(migration(FILE)).toContain(`'${MINE}'`);
    // The live body before this file (20261013180100) is one the guard accepts.
    await db.exec(migration("20261013180100_csm_client_ads_v3.sql"));
    expect(await src()).toBe("68866291d824a87ad316bcbe7d28daf3");
    await db.exec(`CREATE OR REPLACE FUNCTION public.cockpit_csm_client_ads(p_task_id text,p_start date,p_end date) RETURNS jsonb
   LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN '{}'::jsonb; END $$;`);
    await refuses(
      migration(FILE),
      /not the definition this file was written against/,
    );
    await db.exec(migration("20261013180100_csm_client_ads_v3.sql"));
    await db.exec(migration(FILE));
    expect(await src()).toBe(mine);
  });
});
