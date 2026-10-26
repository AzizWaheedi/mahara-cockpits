/**
 * Which funnel an ad set feeds (cockpit_media_funnel_kind, 20261026s), on an
 * isolated PGlite engine. The destinations are the ones Meta reports in
 * cockpit_meta_ad_days; the client page's "By funnel" lines rest on this.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, migration, owner } from "./lib/cockpitTestDb";

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
