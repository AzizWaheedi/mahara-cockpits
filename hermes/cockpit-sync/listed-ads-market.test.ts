import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { collectMarket } from "./marketProducer";
import { type Reads, type Row, withNativeContext } from "./runtime";
import { archiveWinners } from "./winners";

// Default (b) of the cost per booking decisions, 23 Oct 2026: an ad on the
// compromise list (excludedAds.ts, 23 ids) never counts on any screen, so it
// leaves the market lens and is never archived or updated as a winner. The
// media publish refuses a plan that drops an archived winner, so the 3 listed
// winners already archived pass through as read; a database step takes them
// out after this release is live. The ids and amounts are the live ones of
// 23 Oct: SAFAD's outsider ad set 120254791600350066 ($375.10, no lead) and the
// 3 listed winners in the creative winnersArchive.

const SAFAD_ACCOUNT = "774492648699300";
const KHALIDA_ACCOUNT = "1275190574533155";
// An account that holds no listed ad (made up).
const OTHER_ACCOUNT = "555000000000001";
const SAFAD_OUTSIDER_SET = "120254791600350066";
const SAFAD_OUTSIDER_AD = "120254791600360066";
const KHALIDA_LISTED = "120246795745520088";
const LIWAN_LISTED = "120246624477980705";
const KHALIDA_LISTED_2 = "120247012327250088";

const insight = (spend: string, leads?: string) => ({
  data: [
    {
      spend,
      actions:
        leads === undefined ? [] : [{ action_type: "lead", value: leads }],
    },
  ],
});
const ad = (
  id: string,
  spend: string | undefined,
  leads?: string,
  message = "Build your home",
): Row => ({
  id,
  name: `ad ${id}`,
  creative: {
    id: `c${id}`,
    object_story_spec: { link_data: { message, name: "Construction" } },
  },
  ...(spend === undefined ? {} : { insights: insight(spend, leads) }),
});

function meta(over: {
  adsets: Record<string, Row[]>;
  ads: Record<string, Row[]>;
  window?: Row[];
}): Reads & { windowCalls: number } {
  const reads = {
    windowCalls: 0,
    async graph(path: string, params?: Row) {
      if (path.endsWith("/owned_ad_accounts"))
        return {
          data: [
            { id: `act_${SAFAD_ACCOUNT}`, name: "Safad Consulting" },
            { id: `act_${KHALIDA_ACCOUNT}`, name: "منشآت خالدة" },
            { id: `act_${OTHER_ACCOUNT}`, name: "Atlantis" },
          ],
        };
      if (path.endsWith("/client_ad_accounts")) return { data: [] };
      const sets = /^act_(\d+)\/adsets$/.exec(path);
      if (sets) return { data: over.adsets[sets[1]] ?? [] };
      const ads = /^(\d+)\/ads$/.exec(path);
      if (ads) return { data: over.ads[ads[1]] ?? [] };
      if (/^act_\d+\/insights$/.test(path)) {
        reads.windowCalls++;
        const level = String(params?.level);
        expect(params?.fields).toBe(level === "ad" ? "ad_id,adset_id,spend,actions" : "adset_id,spend,actions");
        // An ad-level row carries its ad set too; an ad set row has no ad id.
        return {
          data: (over.window ?? []).filter(r =>
            level === "ad" ? r.ad_id !== undefined : r.ad_id === undefined && r.adset_id !== undefined,
          ),
        };
      }
      throw new Error(`Unexpected path ${path}`);
    },
    async tool() {
      return {
        values: [
          ["Client Name", "Ad Account - Meta", "Country", "City", "Service"],
          ["Safad Consulting", SAFAD_ACCOUNT, "Saudi Arabia", "Riyadh", "Engineering consultancy"],
          ["منشآت خالدة", KHALIDA_ACCOUNT, "Saudi Arabia", "Riyadh", "Construction"],
          ["Atlantis", OTHER_ACCOUNT, "Kuwait", "Kuwait City", "Construction"],
        ],
      };
    },
    async fetch(): Promise<Response> {
      throw new Error("No fetch expected");
    },
    log(level: string) {
      if (level === "error") throw new Error("Market logged an error");
    },
  };
  return reads;
}

const market = (reads: Reads, prior: Row[] = []) =>
  withNativeContext(reads, { receipts: [] }, () =>
    collectMarket({ media: { marketPlays: prior } }),
  );

describe("the market lens leaves listed ads out", () => {
  test("SAFAD's outsider ad set holds only a listed ad: no play; its own ad set stays as it was", async () => {
    const reads = meta({
      adsets: {
        [SAFAD_ACCOUNT]: [
          {
            id: SAFAD_OUTSIDER_SET,
            name: "New Engagement Ad Set",
            targeting: { age_min: 18 },
            insights: insight("375.10"),
          },
          {
            id: "120251000000000010",
            name: "Safad | MAHARA | 16-8",
            targeting: { age_min: 25 },
            insights: insight("15.71", "3"),
          },
        ],
      },
      ads: {
        [SAFAD_OUTSIDER_SET]: [ad(SAFAD_OUTSIDER_AD, "375.10")],
        "120251000000000010": [ad("120251000000000011", "15.71", "3")],
      },
    });
    const plays = await market(reads);
    expect(plays.map(p => p.adsetId)).toEqual(["120251000000000010"]);
    expect(plays[0]).toMatchObject({
      client: "Safad Consulting",
      accountId: SAFAD_ACCOUNT,
      spend: 15.71,
      leads: 3,
      cpl: 5.24,
    });
    expect(plays[0].creatives.map((c: Row) => c.adId)).toEqual([
      "120251000000000011",
    ]);
  });

  test("a mixed ad set keeps its unlisted creatives; the listed one's spend and leads leave the totals and the cost per lead is worked out again", async () => {
    const reads = meta({
      adsets: {
        [KHALIDA_ACCOUNT]: [
          {
            id: "120246795745510088",
            name: "Khalida set",
            targeting: { age_min: 25 },
            insights: insight("500", "40"),
          },
        ],
      },
      ads: {
        "120246795745510088": [
          // The listed ad's copy asks a question; the play's traits never show it.
          ad(KHALIDA_LISTED, "300", "30", "Want a new home?"),
          ad("120246795745530088", "200", "10"),
        ],
      },
    });
    const [play, ...rest] = await market(reads);
    expect(rest).toHaveLength(0);
    expect(play).toMatchObject({ spend: 200, leads: 10, cpl: 20 });
    expect(play.creatives.map((c: Row) => c.adId)).toEqual([
      "120246795745530088",
    ]);
    expect(play.copyTraits).not.toContain("question hook");
  });

  test("a listed ad with no nested insight is read from the account's one ad-level window", async () => {
    const reads = meta({
      adsets: {
        [KHALIDA_ACCOUNT]: [
          {
            id: "120247012327240088",
            name: "29/8",
            targeting: { age_min: 25 },
            insights: insight("250.40", "12"),
          },
        ],
      },
      ads: {
        "120247012327240088": [
          ad(KHALIDA_LISTED_2, undefined),
          ad("120247012327260088", "83.40", "7"),
        ],
      },
      window: [{ ad_id: KHALIDA_LISTED_2, spend: "167", actions: [{ action_type: "lead", value: "5" }] }],
    });
    const [play] = await market(reads);
    expect(reads.windowCalls).toBe(1);
    expect(play).toMatchObject({ spend: 83.4, leads: 7, cpl: 11.91 });
  });

  test("spend left from unlisted ads Meta no longer lists keeps the play; leads never go below 0", async () => {
    const reads = meta({
      adsets: {
        [KHALIDA_ACCOUNT]: [
          {
            id: "120246795745540088",
            name: "Set with an archived ad",
            targeting: { age_min: 25 },
            insights: insight("400", "2"),
          },
        ],
      },
      ads: {
        "120246795745540088": [ad(KHALIDA_LISTED, "375.10", "3")],
      },
    });
    const [play] = await market(reads);
    expect(play).toMatchObject({ spend: 24.9, leads: 0, cpl: undefined });
    expect(play.creatives).toEqual([]);
  });

  test("a listed ad Meta leaves off the /ads edge is found in the account's ad-level window by its ad set; each listed ad counts once", async () => {
    const reads = meta({
      adsets: {
        [KHALIDA_ACCOUNT]: [
          {
            id: "120246699622920088",
            name: "Khalida set with a deleted listed ad",
            targeting: { age_min: 25 },
            insights: insight("500", "15"),
          },
        ],
      },
      ads: {
        "120246699622920088": [
          ad(KHALIDA_LISTED, "100", "5"),
          ad("120246699622930088", "210.17", "10"),
        ],
      },
      window: [
        // Deleted, so off the edge, but its spend is in the ad set's insight.
        { ad_id: "120246699622910088", adset_id: "120246699622920088", spend: "189.83", actions: [] },
        // On the edge as well: never taken out twice.
        { ad_id: KHALIDA_LISTED, adset_id: "120246699622920088", spend: "100", actions: [{ action_type: "lead", value: "5" }] },
        // A listed ad of another ad set stays out of this play's sums.
        { ad_id: "120246876560950088", adset_id: "120246876560960088", spend: "50", actions: [] },
        { ad_id: "120246699622930088", adset_id: "120246699622920088", spend: "210.17", actions: [{ action_type: "lead", value: "10" }] },
      ],
    });
    const [play, ...rest] = await market(reads);
    expect(rest).toHaveLength(0);
    expect(reads.windowCalls).toBe(1);
    expect(play).toMatchObject({ spend: 210.17, leads: 10, cpl: 21.02 });
    expect(play.creatives.map((c: Row) => c.adId)).toEqual(["120246699622930088"]);
  });

  test("an ad set whose only spend is a listed ad off the edge is no play", async () => {
    const reads = meta({
      adsets: {
        [KHALIDA_ACCOUNT]: [
          {
            id: "120246699622920088",
            name: "Khalida set",
            targeting: { age_min: 25 },
            insights: insight("189.83"),
          },
        ],
      },
      ads: { "120246699622920088": [] },
      window: [{ ad_id: "120246699622910088", adset_id: "120246699622920088", spend: "189.83", actions: [] }],
    });
    expect(await market(reads)).toEqual([]);
  });

  test("an account with no listed ad is untouched and needs no extra read", async () => {
    const reads = meta({
      adsets: {
        [OTHER_ACCOUNT]: [
          {
            id: "555555",
            name: "Broad",
            targeting: { age_min: 25 },
            insights: insight("120", "10"),
          },
        ],
      },
      ads: { "555555": [ad("333333", "120", "10")] },
    });
    const [play] = await market(reads);
    expect(play).toMatchObject({ spend: 120, leads: 10, cpl: 12 });
    expect(reads.windowCalls).toBe(0);
  });
});

/**
 * The live media publish's winners guard (cockpit_native_media_publish, last
 * defined by 20261022p, the body live on 23 Oct): every archived adId must come
 * back, and every key outside the refreshable list must keep its value (jsonb
 * containment). The refreshable keys are read from the migration itself.
 */
const PUBLISH_SQL = readFileSync(
  new URL("../../supabase/migrations/20261022p_native_publish_booking_day.sql", import.meta.url),
  "utf8",
);
const REFRESHABLE = (() => {
  const list = /retained @> \(item-ARRAY\[([^\]]+)\]\)/.exec(PUBLISH_SQL)?.[1];
  if (!list) throw new Error("The publish's winners guard was not found");
  return new Set([...list.matchAll(/'([^']+)'/g)].map(m => m[1]));
})();
function contains(outer: unknown, inner: unknown): boolean {
  if (Array.isArray(inner))
    return Array.isArray(outer) && inner.every(i => outer.some(o => contains(o, i)));
  if (inner !== null && typeof inner === "object")
    return (
      outer !== null &&
      typeof outer === "object" &&
      !Array.isArray(outer) &&
      Object.entries(inner).every(([k, v]) => k in (outer as Row) && contains((outer as Row)[k], v))
    );
  return outer === inner;
}
function publishRefusal(before: Row[], after: Row[]): string | undefined {
  for (const item of before) {
    const retained = after.find(row => row.adId === item.adId);
    if (!retained) return "Winner archive cannot delete history";
    const fixed = Object.fromEntries(Object.entries(item).filter(([k]) => !REFRESHABLE.has(k)));
    if (!contains(JSON.parse(JSON.stringify(retained)), JSON.parse(JSON.stringify(fixed))))
      return "Winner annotations or immutable identity changed";
  }
  return undefined;
}

describe("the winners archive never adds or updates a listed ad", () => {
  const winner = (adId: string, spend: number, leads: number, extra: Row = {}) => ({
    _id: `w${adId}`,
    adId,
    origin: "auto",
    firstArchivedAt: 1,
    spend,
    leads,
    cpl: Math.round((spend / leads) * 100) / 100,
    ...extra,
  });

  test("the guard is read from the publish: spend and stillLive refresh, identity does not", () => {
    expect(REFRESHABLE.has("spend")).toBe(true);
    expect(REFRESHABLE.has("stillLive")).toBe(true);
    expect(REFRESHABLE.has("adId")).toBe(false);
    expect(REFRESHABLE.has("origin")).toBe(false);
    expect(REFRESHABLE.has("savedAt")).toBe(false);
    const before = [winner(KHALIDA_LISTED, 1287, 173)];
    expect(publishRefusal(before, [])).toBe("Winner archive cannot delete history");
    expect(publishRefusal(before, [{ ...before[0], origin: "manual" }])).toBe(
      "Winner annotations or immutable identity changed",
    );
    expect(publishRefusal(before, [{ ...before[0], spend: 1300, stillLive: false }])).toBeUndefined();
  });

  test("the 3 listed winners of 23 Oct pass through exactly as read, so the publish accepts the plan; every other winner stays, a saved one included", () => {
    const listed = [
      winner(KHALIDA_LISTED, 1287, 173, { campaignName: "Khalida 24/9" }),
      winner(LIWAN_LISTED, 801, 58),
      winner(KHALIDA_LISTED_2, 167, 72, { stillLive: false, retiredOn: "2026-10-21", previewSrc: "x" }),
    ];
    const state = {
      winners: [
        ...listed,
        winner("120240000000000001", 240, 24, { campaignName: "Khalida 24/9", previewSrc: "y" }),
        winner("120240000000000002", 150, 12, { origin: "manual", savedAt: 5, note: "Keep my note" }),
      ],
      dailyStats: [],
    };
    const before = JSON.parse(JSON.stringify(state.winners));
    const tables: Record<string, Row[]> = {
      // The campaign is answered in the tree and a qualifying listed creative is
      // in a play: neither touches a listed row.
      marketPlays: [
        {
          adsetId: "120246795745510088",
          client: "منشآت خالدة",
          accountId: KHALIDA_ACCOUNT,
          creatives: [{ adId: KHALIDA_LISTED, spend: 1400, leads: 180, cpl: 7.78, format: "image" }],
        },
      ],
      metaTree: [{ kind: "ad", metaId: KHALIDA_LISTED, campaignName: "Khalida 24/9", effectiveStatus: "PAUSED" }],
      dailyStats: [],
    };
    const out = archiveWinners(state, tables);
    expect(out.archived).toBe(5);
    expect(tables.winnersArchive.map(w => w.adId).sort()).toEqual(
      [KHALIDA_LISTED, LIWAN_LISTED, KHALIDA_LISTED_2, "120240000000000001", "120240000000000002"].sort(),
    );
    for (const row of listed) expect(tables.winnersArchive.find(w => w.adId === row.adId)).toEqual(row);
    // An unlisted winner is still refreshed as before.
    expect(tables.winnersArchive.find(w => w.adId === "120240000000000001")).toMatchObject({ stillLive: false });
    expect(tables.winnersArchive.find(w => w.adId === "120240000000000001")?.previewSrc).toBeUndefined();
    expect(tables.winnersArchive.find(w => w.adId === "120240000000000002")).toMatchObject({ note: "Keep my note", savedAt: 5 });
    expect(publishRefusal(before, tables.winnersArchive)).toBeUndefined();
    // The state the worker read is not changed.
    expect(state.winners).toEqual(before);
  });

  test("a listed creative that would qualify is never archived; an unlisted one is", () => {
    const tables: Record<string, Row[]> = {
      marketPlays: [
        {
          adsetId: "120246795745510088",
          client: "منشآت خالدة",
          accountId: KHALIDA_ACCOUNT,
          creatives: [
            { adId: KHALIDA_LISTED, spend: 1287, leads: 173, cpl: 7.44, format: "image" },
            { adId: "120246795745530088", spend: 200, leads: 20, cpl: 10, format: "image" },
          ],
        },
      ],
      metaTree: [],
      dailyStats: [],
    };
    archiveWinners({ winners: [], dailyStats: [] }, tables);
    expect(tables.winnersArchive.map(w => w.adId)).toEqual(["120246795745530088"]);
  });

  test("the gate comes from constants.ts: a creative over the $15 gate is never a winner", () => {
    const tables: Record<string, Row[]> = {
      marketPlays: [
        {
          adsetId: "1",
          client: "A",
          accountId: "1",
          creatives: [
            { adId: "900000000000001", spend: 150, leads: 9, cpl: 16.67, format: "image" },
            { adId: "900000000000002", spend: 150, leads: 10, cpl: 15, format: "image" },
          ],
        },
      ],
      metaTree: [],
      dailyStats: [],
    };
    archiveWinners({ winners: [], dailyStats: [] }, tables);
    expect(tables.winnersArchive.map(w => w.adId)).toEqual(["900000000000002"]);
  });
});
