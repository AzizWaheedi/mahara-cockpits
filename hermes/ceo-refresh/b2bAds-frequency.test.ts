import { describe, expect, test } from "bun:test";
import { adsPayload } from "./native/adapters/b2bAds.js";
import { type Row, type Runtime, withRuntime } from "./runtime.ts";

/**
 * The CEO, 2026-10-16: the Ads tab's frequency is Meta's own at each level for
 * the whole window, the number Ads Manager shows for those dates. It was the
 * highest single day of each ad, and each parent the highest of its children:
 * [SFC] read 1.86 where Meta reads 8.42.
 */
const ACT = "act_746108264865897";
const FROM7 = "2026-10-10";
const FROM30 = "2026-09-17";
const TODAY = "2026-10-16";
// 05:00 UTC: the 16th in Kuwait, still the 15th in Los Angeles.
const NOW = Date.parse("2026-10-16T05:00:00Z");

const window = (a: string, spend: number) => ({
  [`${a}_spend`]: spend, [`${a}_impressions`]: 400, [`${a}_clicks`]: 20, [`${a}_link_clicks`]: 10,
  [`${a}_meta_leads`]: 3, [`${a}_leads`]: 3, [`${a}_qualified_leads`]: 2, [`${a}_not_ready_leads`]: 0,
  [`${a}_intros_booked`]: 1, [`${a}_intros_due`]: 1, [`${a}_intros_shown`]: 1, [`${a}_intros_qualified`]: 1,
  [`${a}_intros_cancelled`]: 0, [`${a}_intros_advanced`]: 1, [`${a}_demos_booked`]: 1, [`${a}_demos_due`]: 1,
  [`${a}_demos_shown`]: 1, [`${a}_demos_qualified`]: 1, [`${a}_demos_cancelled`]: 0,
  [`${a}_closes`]: 1, [`${a}_contracted`]: 100, [`${a}_cash`]: 50,
});
const adRow = (adId: string, adsetId: string, campaignId: string, campaignName: string, type: string) => ({
  ad_id: adId, adset_id: adsetId, campaign_id: campaignId, ad_name: `Ad ${adId}`, adset_name: `Set ${adsetId}`,
  campaign_name: campaignName, campaign_status: "ACTIVE", effective_status: "ACTIVE", thumbnail_url: null,
  campaign_type: type, setter_name: null, setter_shown: 0, setter_due: 0, closer_name: null, closer_closes: 0,
  ...window("w7", 20), ...window("w30", 20),
});
// The short-form content campaign: three ad sets of one ad each, reaching the same warm people.
const ROWS = [
  adRow("sfc-ad-1", "sfc-set-1", "sfc", "[MhM] Hammer Them [SFC]", "retargeting"),
  adRow("sfc-ad-2", "sfc-set-2", "sfc", "[MhM] Hammer Them [SFC]", "retargeting"),
  adRow("sfc-ad-3", "sfc-set-3", "sfc", "[MhM] Hammer Them [SFC]", "retargeting"),
  adRow("lg-ad-1", "lg-set-1", "lg", "MaharaMedia | Lead Gen | 4-12-25", "lead_gen"),
];

type Insight = Record<string, string>;
const INSIGHTS: Record<string, Record<string, Insight[]>> = {
  [FROM7]: {
    ad: [
      { ad_id: "sfc-ad-1", impressions: "400", reach: "210", frequency: "1.9" },
      { ad_id: "sfc-ad-2", impressions: "420", reach: "210", frequency: "2.0" },
      { ad_id: "sfc-ad-3", impressions: "452", reach: "220", frequency: "2.05" },
      // Vid 15 - Hidden Tax: 1.93 at its highest day, 2.75 over the seven days.
      { ad_id: "lg-ad-1", impressions: "16983", reach: "6175", frequency: "2.7502" },
    ],
    adset: [
      { adset_id: "sfc-set-1", impressions: "400", reach: "210", frequency: "1.9" },
      { adset_id: "sfc-set-2", impressions: "420", reach: "210", frequency: "2.0" },
      { adset_id: "sfc-set-3", impressions: "452", reach: "220", frequency: "2.05" },
      { adset_id: "lg-set-1", impressions: "16983", reach: "8379", frequency: "2.0268" },
    ],
    campaign: [
      { campaign_id: "sfc", impressions: "1272", reach: "151", frequency: "8.423841" },
      { campaign_id: "lg", impressions: "16983", reach: "8379", frequency: "2.0268" },
    ],
    account: [{ impressions: "16983", reach: "8379", frequency: "2.0268", spend: "100" }],
  },
  [FROM30]: {
    ad: [{ ad_id: "sfc-ad-1", impressions: "400", reach: "200", frequency: "2.0" }],
    adset: [],
    campaign: [{ campaign_id: "sfc", impressions: "1300", reach: "150", frequency: "8.6667" }],
    account: [{ impressions: "20000", reach: "8968", frequency: "2.2302", spend: "300" }],
  },
};

type Call = { resource: string; params: Record<string, string | number> };
function fakeRuntime(calls: Call[], account: () => Row): Runtime {
  const read = async (_project: string, query: string): Promise<Row[]> => {
    if (query.includes("max(extract(epoch from last_synced_at)"))
      return [{ ms: NOW, last_day: "2026-10-15", first_day: "2025-01-01" }];
    if (query.trimStart().startsWith("with")) return ROWS as unknown as Row[];
    return [{ w7_leads: 12, w30_leads: 12, w7_closes: 4, w30_closes: 4, w7_contracted: 400, w30_contracted: 400, w30_voided: 0 }];
  };
  const graph = async (resource: string, params: Record<string, string | number> = {}): Promise<Row> => {
    calls.push({ resource, params });
    if (resource === ACT) return account();
    if (resource !== `${ACT}/insights`) throw new Error(`unexpected Meta read ${resource}`);
    const since = JSON.parse(String(params.time_range)).since as string;
    return { data: INSIGHTS[since][String(params.level)] ?? [], paging: {} } as unknown as Row;
  };
  return { env: () => undefined, read, repository: {} as Runtime["repository"], tools: { graph } as unknown as Runtime["tools"] };
}

const run = (calls: Call[], account: () => Row = () => ({ account_status: 1, currency: "USD", timezone_name: "America/Los_Angeles" })) =>
  withRuntime(fakeRuntime(calls, account), () => adsPayload(FROM7, FROM30, TODAY, NOW));

describe("Our ads: frequency is Meta's own, per level, for the window", () => {
  test("a campaign shows Meta's campaign frequency, never the highest of its ads", async () => {
    const calls: Call[] = [];
    const { payload } = await run(calls);
    const sfc = payload.campaigns.find((c: { id: string }) => c.id === "sfc");
    expect(sfc.adsets.map((a: { ads: { w7: { frequency: number } }[] }) => a.ads[0].w7.frequency).sort()).toEqual([1.9, 2, 2.05]);
    expect(sfc.w7.frequency).toBe(8.42);
    expect(sfc.w7.frequency).not.toBe(2.05);
    expect(sfc.w30.frequency).toBe(8.67);
    expect(sfc.adsets.find((a: { id: string }) => a.id === "sfc-set-3").w7.frequency).toBe(2.05);
    // No row from Meta is unknown, never borrowed from a child or another window.
    expect(sfc.adsets.find((a: { id: string }) => a.id === "sfc-set-1").w30.frequency).toBeNull();
    expect(sfc.adsets.find((a: { id: string }) => a.id === "sfc-set-2").ads[0].w30.frequency).toBeNull();
  });

  test("the fatiguing verdict reads the ad's seven-day Meta frequency", async () => {
    const { payload } = await run([]);
    const lg = payload.campaigns.find((c: { id: string }) => c.id === "lg");
    const ad = lg.adsets[0].ads[0];
    expect(ad.w7.frequency).toBe(2.75);
    expect(ad.verdict.verdict).toBe("fatiguing");
    expect(ad.verdict.reason).toContain("Frequency 2.75");
    // The SFC ads sit under 2.5 on their own; the campaign's 8.42 is its people seeing many ads.
    const sfcAd = payload.campaigns.find((c: { id: string }) => c.id === "sfc").adsets[0].ads[0];
    expect(sfcAd.verdict.verdict).not.toBe("fatiguing");
  });

  test("the account row is Meta's read over the lead-gen campaigns, on Meta's days", async () => {
    const calls: Call[] = [];
    const { payload, sources } = await run(calls);
    expect(payload.account.w7.frequency).toBe(2.03);
    expect(payload.account.w30.frequency).toBe(2.23);
    expect(payload.windows).toEqual({ from7: FROM7, from30: FROM30, to: TODAY, metaUntil: "2026-10-15", metaTimeZone: "America/Los_Angeles" });
    expect(calls[0].resource).toBe(ACT);
    expect(String(calls[0].params.fields)).toContain("timezone_name");
    const insights = calls.filter(c => c.resource.endsWith("/insights"));
    expect(insights.map(c => [c.params.level, JSON.parse(String(c.params.time_range))])).toEqual([
      ["ad", { since: FROM7, until: "2026-10-15" }],
      ["adset", { since: FROM7, until: "2026-10-15" }],
      ["campaign", { since: FROM7, until: "2026-10-15" }],
      ["account", { since: FROM7, until: "2026-10-15" }],
      ["ad", { since: FROM30, until: "2026-10-15" }],
      ["adset", { since: FROM30, until: "2026-10-15" }],
      ["campaign", { since: FROM30, until: "2026-10-15" }],
      ["account", { since: FROM30, until: "2026-10-15" }],
    ]);
    for (const c of insights.filter(c => c.params.level === "account"))
      expect(JSON.parse(String(c.params.filtering))[0].value).toEqual(["lg"]);
    const note = payload.notes.map((n: { text: string }) => n.text).join(" ");
    expect(note).toContain("Frequency is Meta's own: impressions ÷ people reached over the window at each level, on Meta's account days (America/Los_Angeles, through 2026-10-15).");
    expect(note).not.toContain("highest of its ads");
    expect(sources.some((s: { name: string; ok: boolean }) => s.name.startsWith("Meta frequency") && s.ok)).toBe(true);
  });

  test("without the account's time zone the days are Pacific; a failed frequency read fails the section", async () => {
    const calls: Call[] = [];
    const { payload } = await run(calls, () => { throw new Error("Meta Graph API error 17"); });
    expect(payload.windows.metaTimeZone).toBe("America/Los_Angeles");
    expect(payload.windows.metaUntil).toBe("2026-10-15");
    expect(payload.campaigns.find((c: { id: string }) => c.id === "sfc").w7.frequency).toBe(8.42);

    const failing = fakeRuntime([], () => ({ account_status: 1, timezone_name: "America/Los_Angeles" }));
    const graph = failing.tools.graph;
    failing.tools.graph = async (resource, params) => {
      if (resource.endsWith("/insights") && params?.level === "campaign") throw new Error("Meta Graph API error 80000");
      return graph(resource, params);
    };
    await expect(withRuntime(failing, () => adsPayload(FROM7, FROM30, TODAY, NOW))).rejects.toThrow("80000");
  });

  test("no frequency is worked out of daily snapshots or children any more", async () => {
    const source = await Bun.file(new URL("./native/adapters/b2bAds.js", import.meta.url)).text();
    expect(source).not.toContain("max(frequency)");
    expect(source).not.toContain("Math.max(into.frequency");
    expect(source).not.toContain("_freq");
    expect(source).not.toContain("highest of its ads");
  });
});
