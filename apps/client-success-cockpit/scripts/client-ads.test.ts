import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adSetUrl,
  adsRange,
  adUrl,
  buildAdsModel,
  type ClientAdsRead,
  campaignUrl,
  chartSeries,
  fetchClientAds,
  scopeChanges,
  scopeTotals,
} from "../src/lib/clientAds";

const NOW = Date.parse("2026-10-12T09:00:00Z");
const STILL =
  "https://bldgtotkfmhoxmlzowdx.supabase.co/storage/v1/object/public/cockpit-ad-stills/" +
  "a".repeat(64);

const row = (
  date: string,
  campaignName: string,
  adId: string,
  adName: string,
  adSetName: string,
  spend: number,
  leads: number,
  impressions = 600,
  linkClicks = 6,
) => ({
  date,
  campaignName,
  adSetName,
  adName,
  adId,
  spend,
  leads,
  impressions,
  linkClicks,
  frequency: 1.2,
});

function read(over: Partial<ClientAdsRead> = {}): ClientAdsRead {
  return {
    clientName: "Castello Industries",
    start: "2026-09-01",
    end: "2026-09-30",
    statsAt: "2026-10-12T06:00:00Z",
    bookingsReady: true,
    coverage: { first: "2026-08-20", last: "2026-09-30" },
    feedFirst: "2026-08-13",
    campaigns: [
      {
        name: "LIVE",
        metaCampaignId: "111",
        accountId: "999",
        accountName: "castello add",
        currency: "USD",
        budgetDaily: 40,
        budgetLevel: "campaign",
        ended: false,
      },
      {
        name: "OLD",
        metaCampaignId: "222",
        accountId: "999",
        accountName: "castello add",
        currency: "USD",
        budgetDaily: 30,
        budgetLevel: "adset",
        ended: true,
      },
    ],
    adsets: [
      {
        id: "5001",
        name: "Leads 30d",
        campaignName: "LIVE",
        status: "ACTIVE",
        effectiveStatus: "ACTIVE",
      },
    ],
    ads: [
      {
        id: "7001",
        name: "Ad-1 gates",
        adsetId: "5001",
        campaignName: "LIVE",
        status: "ACTIVE",
        effectiveStatus: "ACTIVE",
        accountId: "999",
        creativeId: "8001",
        thumbUrl: undefined,
      },
      {
        id: "7002",
        name: "Ad-2 quiet",
        adsetId: "5001",
        campaignName: "LIVE",
        status: "PAUSED",
        effectiveStatus: "PAUSED",
        accountId: "999",
        creativeId: "8002",
        thumbUrl: undefined,
      },
    ],
    rows: [
      row(
        "2026-09-02",
        "LIVE",
        "7001",
        "Ad-1 gates",
        "Leads 30d",
        20,
        2,
        800,
        10,
      ),
      row(
        "2026-09-03",
        "LIVE",
        "7001",
        "Ad-1 gates",
        "Leads 30d",
        30,
        1,
        800,
        10,
      ),
      row("2026-09-03", "OLD", "7101", "Old ad", "Old set", 50, 5),
    ],
    history: [
      row("2026-08-30", "LIVE", "7001", "Ad-1 gates", "Leads 30d", 10, 0),
      row("2026-08-28", "OLD", "7102", "Old booker", "Old set", 25, 1),
    ],
    bookings: [
      {
        date: "2026-09-02",
        campaignName: "LIVE",
        adId: "7001",
        status: "showed",
        startTime: undefined,
        appointmentDate: "2026-09-05",
      },
      {
        date: "2026-09-03",
        campaignName: "LIVE",
        adId: undefined,
        status: "confirmed",
        startTime: "2026-09-04T10:00:00Z",
        appointmentDate: "2026-09-04",
      },
      {
        date: "2026-09-04",
        campaignName: "OLD",
        adId: "7102",
        status: "confirmed",
        startTime: "2026-10-20T10:00:00Z",
        appointmentDate: "2026-10-20",
      },
    ],
    verdicts: [
      {
        adId: "7001",
        adName: "Ad-1 gates",
        campaignName: "LIVE",
        verdict: "hold",
        reason: "CPL $15.38 is over the gate — watch, do not scale.",
      },
    ],
    stills: { "7001": { url: STILL, tinyUrl: undefined } },
    changes: [
      {
        day: "2026-09-02",
        at: 1,
        kind: "update_campaign_budget_scheduling_state",
        action: "Ad set budget scheduling enabled",
        actor: "Hasan",
        source: "meta_activity",
        subject: "Leads 30d",
        evidence: undefined,
        link: undefined,
      },
      {
        day: "2026-09-01",
        at: 2,
        kind: "update_campaign_budget",
        action: "Campaign budget updated",
        actor: undefined,
        source: "meta_activity",
        subject: "LIVE",
        evidence: undefined,
        link: undefined,
      },
      {
        day: "2026-09-03",
        at: 3,
        kind: "edit_images",
        action: "Images edited",
        actor: undefined,
        source: "meta_activity",
        subject: "castello add",
        evidence: undefined,
        link: undefined,
      },
    ],
    ...over,
  };
}

const PERIOD = { from: "2026-09-01", to: "2026-09-30" };

describe("the numbers add up as the media buyer's table does", () => {
  const m = buildAdsModel(read(), PERIOD, NOW);
  const live = m.campaigns.find(c => c.name === "LIVE");
  const old = m.campaigns.find(c => c.name === "OLD");
  const ad1 = live?.sets[0].ads.find(a => a.id === "7001");

  test("spend and leads count only the period, never the 30 days before", () => {
    expect(ad1?.t.spend).toBe(50);
    expect(ad1?.t.leads).toBe(3);
    expect(m.t.spend).toBe(100);
    expect(m.t.leads).toBe(8);
  });

  test("rates need 1,000 impressions", () => {
    expect(ad1?.t.linkCtr).toBeCloseTo(1.25);
    expect(ad1?.t.cpm).toBeCloseTo(31.25);
    const oldAd = old?.sets[0].ads.find(a => a.id === "7101");
    expect(oldAd?.t.linkCtr).toBeUndefined();
  });

  test("a booking goes to its ad, one with no ad only to its campaign", () => {
    expect(ad1?.t.booked).toBe(1);
    expect(live?.sets[0].t.booked).toBe(1);
    expect(live?.t.booked).toBe(2);
    expect(live?.unattributedCount).toBe(1);
    expect(m.t.booked).toBe(3);
    expect(m.unattributedCount).toBe(1);
  });

  test("an ad that booked after it stopped spending keeps its booking, at no cost", () => {
    const booker = old?.sets[0].ads.find(a => a.id === "7102");
    expect(booker?.t.booked).toBe(1);
    expect(booker?.t.spend).toBe(0);
    expect(booker?.t.cpb).toBeUndefined();
    expect(booker?.active).toBe(true);
  });

  test("attended is showed, or confirmed once the call's time has passed", () => {
    // showed (LIVE ad), confirmed and past (LIVE, no ad); the OLD call is still to come.
    expect(live?.t.attended).toBe(2);
    expect(old?.t.attended).toBe(0);
  });

  test("cost per booking needs spend and a booking", () => {
    expect(ad1?.t.cpb).toBe(50);
    expect(live?.t.cpb).toBe(25);
  });
});

describe("the tree", () => {
  const m = buildAdsModel(read(), PERIOD, NOW);
  const live = m.campaigns.find(c => c.name === "LIVE");
  const old = m.campaigns.find(c => c.name === "OLD");

  test("an ad Meta lists that did not spend is quiet, with Meta's status", () => {
    const quiet = live?.sets[0].ads.find(a => a.id === "7002");
    expect(quiet?.active).toBe(false);
    expect(quiet?.statusText).toBe("Paused");
  });

  test("an ad Meta no longer lists says when it last spent", () => {
    const oldAd = old?.sets[0].ads.find(a => a.id === "7101");
    expect(oldAd?.statusText).toBe("Not running, last spent 3 Sep");
    expect(old?.statusText).toBe("Ended");
    expect(live?.statusText).toBe("Active");
  });

  test("budgets read in words", () => {
    expect(live?.budgetText).toBe("$40 a day");
    expect(live?.sets[0].budgetText).toBe("Uses the campaign budget");
    expect(old?.budgetText).toBe("$30 a day, set on its ad sets");
  });

  test("the verdict reason carries no em dash", () => {
    const ad1 = live?.sets[0].ads.find(a => a.id === "7001");
    expect(ad1?.verdict?.label).toBe("Hold");
    expect(ad1?.verdict?.reason).not.toContain("—");
  });

  test("pictures come by ad id, and an active ad without one is counted", () => {
    const ad1 = live?.sets[0].ads.find(a => a.id === "7001");
    expect(ad1?.stillUrl).toBe(STILL);
    // 7101 and 7102 spent or booked and have no picture; 7002 is quiet.
    expect(m.missingPictures).toBe(2);
  });

  test("a client with campaigns in two currencies has no client currency", () => {
    const r = read();
    r.campaigns[1].currency = "SAR";
    expect(buildAdsModel(r, PERIOD, NOW).currency).toBeUndefined();
  });
});

describe("changes", () => {
  const m = buildAdsModel(read(), PERIOD, NOW);
  const live = m.campaigns.find(c => c.name === "LIVE");
  const set = live?.sets[0];
  const ad1 = set?.ads.find(a => a.id === "7001");

  test("a change filed under the campaign but naming an ad set is the ad set's", () => {
    const ch = m.changes.find(c => c.action.startsWith("Ad set budget"));
    expect(ch?.level).toBe("set");
    expect(ch?.setKeys).toEqual([set?.key ?? ""]);
  });

  test("a change that names nothing in the tree shows under all campaigns only", () => {
    const ch = m.changes.find(c => c.action === "Images edited");
    expect(ch?.level).toBe("account");
    expect(
      scopeChanges(m, { level: "campaign", campaign: "LIVE" }).map(
        c => c.action,
      ),
    ).not.toContain("Images edited");
    expect(scopeChanges(m, { level: "all" }).map(c => c.n)).toEqual([1, 2, 3]);
  });

  test("an ad shows the changes above it only once it ran", () => {
    const list = scopeChanges(m, {
      level: "ad",
      campaign: "LIVE",
      set: set?.key ?? "",
      ad: ad1?.key ?? "",
    });
    // The ad first spent on 30 Aug, so the 1 Sep campaign change shows.
    expect(list.map(c => c.action)).toEqual([
      "Campaign budget updated",
      "Ad set budget scheduling enabled",
    ]);
  });
});

describe("the chart", () => {
  test("cost per lead is a 7-day average that reaches into the days before", () => {
    const m = buildAdsModel(read(), PERIOD, NOW);
    const s = chartSeries(m, { level: "campaign", campaign: "LIVE" }, "cpl");
    const sep2 = s.points.find(p => p.key === "2026-09-02");
    // 27 Aug to 2 Sep: $10 (30 Aug) + $20 for 2 leads.
    expect(sep2?.y).toBe(15);
    expect(s.weekly).toBe(false);
  });

  test("booked at campaign level includes bookings no ad brought", () => {
    const m = buildAdsModel(read(), PERIOD, NOW);
    const s = chartSeries(m, { level: "campaign", campaign: "LIVE" }, "booked");
    expect(s.points.reduce((n, p) => n + (p.y ?? 0), 0)).toBe(2);
    expect(scopeTotals(m, { level: "campaign", campaign: "LIVE" }).booked).toBe(
      2,
    );
  });

  test("a period longer than 45 days charts by week", () => {
    const r = read({ start: "2026-08-13", end: "2026-10-11" });
    const m = buildAdsModel(r, { from: "2026-08-13", to: "2026-10-11" }, NOW);
    const s = chartSeries(m, { level: "all" }, "leads");
    expect(s.weekly).toBe(true);
    expect(s.points[0].label).toBe("Week of 13 Aug");
  });

  test("a period before the first imported day is cut, and says so", () => {
    const r = read({ start: "2026-08-01" });
    const m = buildAdsModel(r, { from: "2026-08-01", to: "2026-09-30" }, NOW);
    expect(m.cut).toBe(true);
    expect(m.dataFrom).toBe("2026-08-13");
  });

  test("a day after the last imported one ends the period, not a zero", () => {
    const r = read({
      start: "2026-10-10",
      end: "2026-10-12",
      feedLast: "2026-10-11",
    });
    const m = buildAdsModel(r, { from: "2026-10-10", to: "2026-10-12" }, NOW);
    expect(m.dataTo).toBe("2026-10-11");
    const s = chartSeries(m, { level: "all" }, "leads");
    expect(s.points.map(p => p.key)).toEqual(["2026-10-10", "2026-10-11"]);
  });

  test("a period with no imported day yet is empty", () => {
    const r = read({
      start: "2026-10-12",
      end: "2026-10-12",
      feedLast: "2026-10-11",
    });
    const m = buildAdsModel(r, { from: "2026-10-12", to: "2026-10-12" }, NOW);
    expect(m.dataTo < m.dataFrom).toBe(true);
  });
});

describe("reads and links", () => {
  test("the 30 days before the period read in the shape the server sends", async () => {
    // cockpit_csm_client_ads sends these rows without impressions, link
    // clicks or frequency. On 12 Oct every client with ads failed to read.
    const base = read();
    const payload = {
      ...base,
      history: base.history.map(r => ({
        date: r.date,
        campaignName: r.campaignName,
        adSetName: r.adSetName,
        adName: r.adName,
        adId: r.adId,
        spend: r.spend,
        leads: r.leads,
      })),
    };
    const client = {
      rpc: async () => ({ data: payload, error: null }),
    } as unknown as SupabaseClient;
    const got = await fetchClientAds(
      client,
      "task",
      "2026-09-01",
      "2026-09-30",
    );
    expect(got.history).toHaveLength(base.history.length);
    expect(got.history[0]?.impressions).toBe(0);
    expect(got.history[0]?.spend).toBe(base.history[0]?.spend);
  });

  test("never past today, never more than 400 days", () => {
    expect(adsRange("2000-01-01", "2026-12-31", "2026-10-12")).toEqual({
      start: "2025-09-08",
      end: "2026-10-12",
    });
  });

  test("Ads Manager opens the campaign, the ad set and the ad", () => {
    const c = { id: "111", accountId: "act_999" };
    expect(campaignUrl(c)).toBe(
      "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=999&selected_campaign_ids=111",
    );
    expect(adSetUrl({ id: "5001" }, c)).toBe(
      "https://adsmanager.facebook.com/adsmanager/manage/adsets?act=999&selected_adset_ids=5001",
    );
    expect(adSetUrl({ id: undefined }, c)).toBe(
      "https://adsmanager.facebook.com/adsmanager/manage/adsets?act=999&selected_campaign_ids=111",
    );
    expect(adUrl({ id: "7001", accountId: "999" })).toBe(
      "https://adsmanager.facebook.com/adsmanager/manage/ads?act=999&selected_ad_ids=7001",
    );
  });
});
