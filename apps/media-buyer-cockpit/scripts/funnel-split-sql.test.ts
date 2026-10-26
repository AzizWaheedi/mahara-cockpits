/**
 * Which funnel an ad set feeds (cockpit_media_funnel_kind, 20261026s), on an
 * isolated PGlite engine. The destinations are the ones Meta reports in
 * cockpit_meta_ad_days; the client page's "By funnel" lines rest on this.
 * Also which campaigns the funnel read names (cockpit_media_campaign_funnels,
 * 20261026u): listed ones as before, and a campaign on a current board card of
 * a client the seat may see.
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

const SQL = migration("20261026s_media_funnel_split.sql");
const KIND = SQL.match(
  /CREATE OR REPLACE FUNCTION public\.cockpit_media_funnel_kind\([\s\S]*?TO service_role;/,
)?.[0];

let db: PGlite;
beforeAll(async () => {
  if (!KIND)
    throw new Error("cockpit_media_funnel_kind missing from 20261026s");
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await db.exec(KIND);
});
afterAll(async () => {
  await db?.close();
});

const kindOf = async (objective: string | null, destination: string | null) =>
  (
    await db.query<{ k: string }>(
      "SELECT public.cockpit_media_funnel_kind($1, $2) AS k",
      [objective, destination],
    )
  ).rows[0].k;

describe("cockpit_media_funnel_kind", () => {
  test("names each destination Meta reports", async () => {
    await owner(db);
    const cases: [string | null, string | null, string][] = [
      // Seen in cockpit_meta_ad_days on 26 Oct 2026.
      ["OUTCOME_LEADS", "ON_AD", "form"],
      ["OUTCOME_LEADS", "WHATSAPP", "whatsapp"],
      // Merge Studio's and Atlantis's website lead campaigns report this.
      ["OUTCOME_LEADS", "UNDEFINED", "website"],
      ["LEAD_GENERATION", "UNDEFINED", "website"],
      ["OUTCOME_ENGAGEMENT", null, "other"],
      ["OUTCOME_SALES", null, "other"],
      // Meta's other destination types, not seen yet.
      ["LEAD_GENERATION", "ON_AD", "form"],
      ["OUTCOME_LEADS", "WEBSITE", "website"],
      ["OUTCOME_ENGAGEMENT", "WHATSAPP", "whatsapp"],
      ["OUTCOME_LEADS", "MESSAGING_INSTAGRAM_DIRECT_WHATSAPP", "whatsapp"],
      ["OUTCOME_ENGAGEMENT", "MESSENGER", "messenger"],
      ["OUTCOME_ENGAGEMENT", "INSTAGRAM_DIRECT", "instagram"],
      ["OUTCOME_LEADS", "LEAD_FROM_IG_DIRECT", "instagram"],
      ["OUTCOME_LEADS", "LEAD_FROM_MESSENGER", "messenger"],
      ["OUTCOME_LEADS", "MESSAGING_DIRECT", "chat"],
      // A lead campaign whose destination Meta did not give is not guessed.
      ["OUTCOME_LEADS", null, "unknown"],
      ["OUTCOME_TRAFFIC", "WEBSITE", "other"],
      [null, null, "other"],
    ];
    for (const [objective, destination, want] of cases)
      expect([
        objective,
        destination,
        await kindOf(objective, destination),
      ]).toEqual([objective, destination, want]);
  });

  test("only the service role may call it", async () => {
    await actor(db, null);
    await expect(kindOf("OUTCOME_LEADS", "ON_AD")).rejects.toThrow(
      /permission denied/,
    );
    await owner(db);
    const grants = await db.query<{ grantee: string }>(
      `SELECT grantee FROM information_schema.routine_privileges
        WHERE routine_name = 'cockpit_media_funnel_kind' AND privilege_type = 'EXECUTE'
        ORDER BY grantee`,
    );
    expect(
      grants.rows.map(r => r.grantee).filter(g => g !== "postgres"),
    ).toEqual(["service_role"]);
  });
});

describe("cockpit_media_campaign_funnels names a carded campaign not listed yet (20261026u)", () => {
  // 26 Oct 2026: Merge Studio's web campaign had its card from 17:36, but the
  // campaign list counts full days only, so only the instant form was listed.
  const FORM = "Merge Studio | Instant Form | Leads | Oct2026 | MHM™";
  const WEB = "Leads_Web_Form_Merge Studio_25/10";
  const OTHER = "Castello | Web form";
  const UNCARDED = "Merge Studio | No card";
  const [ADMIN, ALL, MERGE, CASTELLO] = [
    "00000000-0000-4000-8000-0000000000a1",
    "00000000-0000-4000-8000-0000000000a2",
    "00000000-0000-4000-8000-0000000000a3",
    "00000000-0000-4000-8000-0000000000a4",
  ];
  let fdb: PGlite;
  const pattern = (file: string, re: RegExp) => {
    const hit = migration(file).match(re);
    if (!hit) throw new Error(`A definition moved in ${file}`);
    return hit[0];
  };
  beforeAll(async () => {
    fdb = await cockpitTestDb({ supabaseDefaultPrivileges: true });
    await fdb.exec("CREATE TABLE public.clients(id uuid PRIMARY KEY);");
    await fdb.exec(
      pattern(
        "20260923o_cockpit_domain_tables.sql",
        /CREATE TABLE IF NOT EXISTS public\.cockpit_campaigns \([\s\S]*?\n\);/,
      ),
    );
    for (const line of migration(
      "20260927k_cockpit_snapshot_reconcile.sql",
    ).match(
      /ALTER TABLE public\.cockpit_campaigns ADD COLUMN IF NOT EXISTS [^;]+;/g,
    ) ?? [])
      await fdb.exec(line);
    await fdb.exec(migration("20260927j_cockpit_media_statistics.sql"));
    await fdb.exec(migration("20260927w_media_read_models.sql"));
    await fdb.exec(
      pattern(
        "20261016121700_meta_ad_days.sql",
        /CREATE TABLE IF NOT EXISTS public\.cockpit_meta_ad_days \([\s\S]*?\n\);/,
      ),
    );
    await fdb.exec(KIND ?? "");
    await fdb.exec(migration("20261026u_media_funnel_board_cards.sql"));

    await member(fdb, ADMIN, "admin-funnels@tests.invalid", ["admin"]);
    await member(fdb, ALL, "all-funnels@tests.invalid", ["media_buyer"]);
    await member(fdb, MERGE, "merge-funnels@tests.invalid", ["media_buyer"]);
    await member(fdb, CASTELLO, "castello-funnels@tests.invalid", [
      "media_buyer",
    ]);
    await fdb.query(
      "UPDATE public.cockpit_members SET clients=$2 WHERE auth_user_id=$1",
      [MERGE, ["mergestudio.kw"]],
    );
    await fdb.query(
      "UPDATE public.cockpit_members SET clients=$2 WHERE auth_user_id=$1",
      [CASTELLO, ["Castello Industries"]],
    );
    // The listed campaign: the instant form only.
    await fdb.query(
      `INSERT INTO public.cockpit_campaigns(client_name,meta_account_id,task_id,raw_data,source_deployment,source_id)
       VALUES('mergestudio.kw','1200680597801129','z8xmdvfphd',$1,'test','c1')`,
      [
        JSON.stringify({
          campaignName: FORM,
          clientName: "mergestudio.kw",
          accountName: "mergestudio.kw",
        }),
      ],
    );
    // The current board snapshot. A new card's client list is empty until its
    // campaign is listed; Castello's card is named by its tag.
    await fdb.exec(
      "UPDATE public.cockpit_media_source_state SET ready=true, row_count=3, source_snapshot_at='2026-10-26T19:00:00Z' WHERE table_name='boardCards'",
    );
    for (const [id, name, tag, clients] of [
      ["k1", FORM, "mergestudio.kw", ["mergestudio.kw"]],
      ["k2", WEB, "mergestudio.kw", []],
      ["k3", OTHER, "castello industries", []],
    ] as const)
      await fdb.query(
        `INSERT INTO public.cockpit_media_sources(table_name,source_id,client_names,data,source_snapshot_at)
         VALUES('boardCards',$1,$2,$3,'2026-10-26T19:00:00Z')`,
        [id, clients, JSON.stringify({ _id: id, name, tag, adStatus: "Live" })],
      );
    // A card from an older snapshot does not count.
    await fdb.query(
      `INSERT INTO public.cockpit_media_sources(table_name,source_id,client_names,data,source_snapshot_at)
       VALUES('boardCards','old',$1,$2,'2026-10-25T19:00:00Z')`,
      [
        ["mergestudio.kw"],
        JSON.stringify({
          _id: "old",
          name: UNCARDED,
          tag: "mergestudio.kw",
          adStatus: "Live",
        }),
      ],
    );
    for (const [i, campaign, destination, day, clicks, lpv] of [
      [1, FORM, "ON_AD", "2026-10-25", 40, 1],
      [2, WEB, "UNDEFINED", "2026-10-26", 14, 10],
      [3, OTHER, "UNDEFINED", "2026-10-26", 5, 4],
      [4, UNCARDED, "UNDEFINED", "2026-10-26", 3, 2],
    ] as const)
      await fdb.query(
        `INSERT INTO public.cockpit_meta_ad_days(account_id,account_currency,day,campaign_id,campaign_name,adset_id,ad_id,objective,destination_type,spend,spend_usd,usd_rate,link_clicks,landing_page_views,fetched_at)
         VALUES('1200680597801129','USD',$1,$2,$3,$4,$5,'OUTCOME_LEADS',$6,10,10,1,$7,$8,now())`,
        [
          day,
          `1202490209710000${i}`,
          campaign,
          `1202490209720000${i}`,
          `1202490209730000${i}`,
          destination,
          clicks,
          lpv,
        ],
      );
  });
  afterAll(async () => {
    await fdb?.close();
  });

  const read = async (who: string) => {
    await actor(fdb, who);
    const r = await fdb.query<{ r: any[] }>(
      "SELECT public.cockpit_media_campaign_funnels($1, '2026-09-27', '2026-10-26') AS r",
      [[FORM, WEB, OTHER, UNCARDED]],
    );
    await owner(fdb);
    return Object.fromEntries(
      r.rows[0].r.map((x: any) => [
        x.campaign,
        [x.kind, x.linkClicks, x.landingPageViews],
      ]),
    );
  };

  test("an admin and a seat with no client list read every carded campaign", async () => {
    for (const who of [ADMIN, ALL])
      expect(await read(who)).toEqual({
        [FORM]: ["form", 40, 1],
        [WEB]: ["website", 14, 10],
        [OTHER]: ["website", 5, 4],
      });
  });

  test("a seat with a client list reads only its clients' cards, by the card's tag", async () => {
    expect(await read(MERGE)).toEqual({
      [FORM]: ["form", 40, 1],
      [WEB]: ["website", 14, 10],
    });
    expect(await read(CASTELLO)).toEqual({ [OTHER]: ["website", 5, 4] });
  });

  test("a campaign with no current card and no listing is never named", async () => {
    for (const who of [ADMIN, MERGE])
      expect(Object.keys(await read(who))).not.toContain(UNCARDED);
  });
});
