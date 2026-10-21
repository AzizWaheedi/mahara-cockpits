import { describe, expect, test } from "bun:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adSetUrl,
  adsRange,
  adUrl,
  boardKnown,
  buildAdsModel,
  type ClientAdsRead,
  campaignUrl,
  chartSeries,
  fetchClientAds,
  findingsOf,
  lostByAdOf,
  mediaBuyerView,
  money,
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

  test("a client with a SAR and a USD campaign still adds up, in dollars", () => {
    // The worker stores SAR spend in dollars, so a second account currency
    // no longer hides the client's totals.
    const r = read();
    r.campaigns[1].currency = "SAR";
    const m = buildAdsModel(r, PERIOD, NOW);
    expect(m.currency).toBe("USD");
    expect(money(m.t.spend, m.currency)).toBe("$100");
    expect(money(m.t.cpl, m.currency, true)).toBe("$12.50");
    const s = chartSeries(m, { level: "all" }, "spend");
    expect(s.points.reduce((n, p) => n + (p.y ?? 0), 0)).toBe(100);
    const old = m.campaigns.find(c => c.name === "OLD");
    expect(old?.currency).toBe("USD");
    expect(old?.currencyNote).toBe("SAR account, shown in dollars");
    expect(m.campaigns.find(c => c.name === "LIVE")?.currencyNote).toBe(
      undefined,
    );
  });

  test("an account the worker does not convert keeps its code and its own totals", () => {
    // calculator.ts converts USD, SAR, QAR, AED and KWD, matched exactly; any
    // other code is stored as Meta gave it, so BHD 120 is not $120.
    const r = read();
    r.campaigns[1].currency = "BHD";
    const m = buildAdsModel(r, PERIOD, NOW);
    const old = m.campaigns.find(c => c.name === "OLD");
    expect(old?.currency).toBe("BHD");
    expect(money(old?.t.spend, old?.currency)).toBe("BHD 50");
    expect(old?.currencyNote).toBe(
      "BHD account, spend not converted to dollars",
    );
    // Dollars and dinars do not add up: the client has no one currency.
    expect(m.currency).toBeUndefined();
    // A code the sheet wrote in lower case is not converted either.
    r.campaigns[1].currency = "sar";
    const lower = buildAdsModel(r, PERIOD, NOW);
    expect(lower.campaigns.find(c => c.name === "OLD")?.currency).toBe("SAR");
    expect(lower.currency).toBeUndefined();
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

/**
 * The Ads tab (Aziz, 2026-10-13): v3 of cockpit_csm_client_ads adds the
 * media buyer board's call, findings, Ad Status, days live and lost leads per
 * ad to each campaign. A read from before v3 has none of them and still
 * renders; the tab then says the board's notes are not in yet.
 */
describe("the media buyer's board on the Ads tab", () => {
  const v3 = (base = read()) => ({
    ...base,
    campaigns: [
      {
        ...base.campaigns[0],
        verdict: "kill",
        reason: "$162 a booking — over the $80 line.",
        findings: [
          {
            constraint: "Cost per booking",
            severity: "fix",
            evidence: "$161.58 per booking against the $60 gate.",
            fixes: ["Cut the ad with the worst cost per booking."],
          },
          { constraint: "", severity: "fix", evidence: "no name", fixes: [] },
          "not a finding",
          {
            constraint: "In learning — leave it alone",
            severity: "optimization",
            evidence: "Live 3 days.",
            fixes: ["Leave it.", 4, " "],
          },
        ],
        boardAdStatus: "Paused",
        daysLive: 6.4,
        lostByAd: { "7001": 4, "7002": "2.0", "9999": 1, "7101": 0 },
      },
      {
        ...base.campaigns[1],
        verdict: "scale",
        reason: null,
        findings: [
          {
            constraint: "Room to scale",
            severity: "optimization",
            evidence: "Cheap.",
            fixes: ["Raise the budget."],
          },
        ],
        boardAdStatus: "Live",
        daysLive: 30,
        // The same client's pipeline, an older copy on an ended campaign.
        lostByAd: { "7001": 9 },
      },
    ],
  });

  async function parsed(payload: unknown) {
    const client = {
      rpc: async () => ({ data: payload, error: null }),
    } as unknown as SupabaseClient;
    return fetchClientAds(client, "task", "2026-09-01", "2026-09-30");
  }

  test("the new keys parse, and a read without them still renders", async () => {
    const now = await parsed(v3());
    expect(now.campaigns[0]).toMatchObject({
      verdict: "kill",
      boardAdStatus: "Paused",
      daysLive: 6.4,
    });
    expect(now.campaigns[0].findings).toHaveLength(4);
    expect(boardKnown(now)).toBe(true);
    // v3 sends null when the board wrote nothing: still a v3 read.
    const nulls = await parsed({
      ...read(),
      campaigns: read().campaigns.map(c => ({
        ...c,
        verdict: null,
        reason: null,
        findings: null,
        boardAdStatus: null,
        daysLive: null,
        lostByAd: null,
      })),
    });
    expect(boardKnown(nulls)).toBe(true);
    expect(nulls.campaigns[0].verdict).toBeUndefined();
    expect(lostByAdOf(nulls).known).toBe(false);

    // The shape before v3: no board keys at all.
    const old = await parsed(read());
    expect(boardKnown(old)).toBe(false);
    const m = buildAdsModel(old, { from: "2026-09-01", to: "2026-09-30" }, NOW);
    expect(m.campaigns.map(c => c.name).sort()).toEqual(["LIVE", "OLD"]);
    expect(mediaBuyerView(old, m)).toMatchObject({ known: false });
    expect(lostByAdOf(old, m)).toEqual({ known: false, tied: 0, rows: [] });
  });

  test("the board's call on each campaign that runs, decisions first", async () => {
    const r = await parsed(v3());
    const m = buildAdsModel(r, { from: "2026-09-01", to: "2026-09-30" }, NOW);
    const view = mediaBuyerView(r, m);
    // OLD has ended: the board no longer judges it.
    expect(view.campaigns.map(c => c.name)).toEqual(["LIVE"]);
    const live = view.campaigns[0];
    expect(live.verdict).toEqual({
      label: "Kill",
      tone: "bad",
      reason: "$162 a booking, over the $80 line.",
    });
    expect(live.daysLive).toBe(6);
    expect(live.needsDecision).toBe(true);
    // The board has it paused while an ad still runs on Meta.
    expect(live.offOnBoard).toBe(true);
    // Malformed findings are left out; em dashes read as commas.
    expect(live.findings).toEqual([
      {
        constraint: "Cost per booking",
        evidence: "$161.58 per booking against the $60 gate.",
        fixes: ["Cut the ad with the worst cost per booking."],
        optional: false,
      },
      {
        constraint: "In learning, leave it alone",
        evidence: "Live 3 days.",
        fixes: ["Leave it."],
        optional: true,
      },
    ]);
    expect(findingsOf(null)).toEqual([]);

    // A board that says Live is never flagged, and an unknown call reads plainly.
    const calm = mediaBuyerView({
      ...r,
      campaigns: [
        {
          ...r.campaigns[0],
          boardAdStatus: "Live",
          verdict: "no_delivery_yet",
          findings: [],
        },
        { ...r.campaigns[1], ended: false },
      ],
    });
    expect(calm.campaigns.map(c => c.name)).toEqual(["LIVE", "OLD"]);
    expect(calm.campaigns[0].offOnBoard).toBe(false);
    expect(calm.campaigns[0].verdict).toMatchObject({
      label: "No delivery yet",
      tone: "neutral",
    });
  });

  test("below KPI and off board read in the media buyer's words and tones", async () => {
    const r = await parsed(v3());
    // hermes/cockpit-sync/calculator.ts writes "below KPI" and "off board";
    // the media buyer shows them as a warning and a serious call.
    const view = mediaBuyerView({
      ...r,
      campaigns: [
        { ...r.campaigns[0], verdict: "below KPI", reason: null },
        { ...r.campaigns[1], ended: false, verdict: "off board" },
      ],
    });
    expect(view.campaigns.map(c => c.verdict)).toEqual([
      { label: "Below KPI", tone: "warn", reason: undefined },
      { label: "Off board", tone: "bad", reason: undefined },
    ]);
    // The same words on an ad's own verdict.
    const m = buildAdsModel(
      {
        ...r,
        verdicts: r.verdicts.map(v => ({ ...v, verdict: "below KPI" })),
      },
      { from: "2026-09-01", to: "2026-09-30" },
      NOW,
    );
    const ad1 = m.campaigns
      .flatMap(c => c.sets)
      .flatMap(x => x.ads)
      .find(a => a.id === "7001");
    expect(ad1?.verdict).toMatchObject({ label: "Below KPI", tone: "warn" });
  });

  test("lost leads per ad: one copy of the client's pipeline, never a sum", async () => {
    const r = await parsed(v3());
    const m = buildAdsModel(r, { from: "2026-09-01", to: "2026-09-30" }, NOW);
    const lost = lostByAdOf(r, m);
    expect(lost.known).toBe(true);
    // The live campaign's copy, not 4 + 9 for ad 7001; zero counts drop out.
    expect(lost.tied).toBe(7);
    expect(lost.rows.map(x => [x.adId, x.count, x.name])).toEqual([
      ["7001", 4, "Ad-1 gates"],
      ["7002", 2, "Ad-2 quiet"],
      ["9999", 1, "Ad 9999"],
    ]);
    expect(lost.rows[0].ad?.statusText).toBe("Active");
    expect(lost.rows[2].ad).toBeUndefined();
    // An ad the period does not list still opens in the client's account,
    // the one its counts came from, never whichever account was used last.
    expect(lost.rows[2].accountId).toBe("999");
    const r9 = lost.rows[2];
    expect(adUrl({ id: r9.adId, accountId: r9.accountId })).toBe(
      "https://adsmanager.facebook.com/adsmanager/manage/ads?act=999&selected_ad_ids=9999",
    );
    const elsewhere = lostByAdOf(
      {
        ...r,
        campaigns: [
          { ...r.campaigns[0], accountId: undefined },
          { ...r.campaigns[1], ended: false, accountId: "555", lostByAd: null },
        ],
      },
      m,
    );
    // The copy's campaign has no account: one that runs lends its own.
    expect(elsewhere.rows.find(x => x.adId === "9999")?.accountId).toBe("555");
    // An ad in the period keeps its own account.
    expect(elsewhere.rows.find(x => x.adId === "7001")?.accountId).toBe("999");

    // Two live copies of the same pipeline: the fuller one, still not a sum.
    const both = lostByAdOf(
      {
        ...r,
        campaigns: [
          r.campaigns[0],
          { ...r.campaigns[1], ended: false, lostByAd: { "7001": 5 } },
        ],
      },
      m,
    );
    expect(both.tied).toBe(7);
    // Only ended campaigns carry it: their copy is what is known.
    const ended = lostByAdOf({ ...r, campaigns: [{ ...r.campaigns[1] }] }, m);
    expect(ended.rows.map(x => [x.adId, x.count])).toEqual([["7001", 9]]);
    // An ad the period does not list is named from the board's verdicts.
    const named = lostByAdOf(
      {
        ...r,
        verdicts: [
          ...r.verdicts,
          {
            adId: "9999",
            adName: "Winter promo",
            campaignName: "LIVE",
            verdict: "kill",
            reason: undefined,
          },
        ],
      },
      m,
    );
    expect(named.rows.find(x => x.adId === "9999")?.name).toBe("Winter promo");
  });
});

/**
 * Ardon and Shades, 14 to 20 Oct 2026: SAR ad accounts, both CBO. Meta's
 * budgets are "17500" and "12000", SAR 175 and SAR 120 ($46.66 and $31.99);
 * spend arrives in dollars, $201.90 for 11 leads and $203.63 for 24. The page
 * read them as "SAR 202" and "SAR 18.35 a lead".
 */
describe("a SAR account's amounts are dollars", () => {
  const OCT = { from: "2026-10-14", to: "2026-10-20" };
  const OCT_NOW = Date.parse("2026-10-21T09:00:00Z");
  const ARDON = "Ardon_mahar-22\\9";
  const SHADES = "Shades|mahara|17\\10";
  type Campaign = ClientAdsRead["campaigns"][number];
  const sar = (c: Partial<Campaign> & { name: string }): Campaign => ({
    metaCampaignId: undefined,
    accountId: undefined,
    accountName: undefined,
    currency: "SAR",
    budgetDaily: undefined,
    budgetLevel: "campaign",
    ended: false,
    ...c,
  });
  const october = (
    campaigns: Campaign[],
    rows: ReturnType<typeof row>[],
  ): ClientAdsRead =>
    read({
      clientName: "Ardon",
      start: OCT.from,
      end: OCT.to,
      statsAt: "2026-10-21T06:00:00Z",
      feedLast: "2026-10-20",
      coverage: { first: "2026-09-22", last: "2026-10-20" },
      campaigns,
      adsets: [],
      ads: [],
      rows,
      history: [],
      bookings: [],
      verdicts: [],
      stills: {},
      changes: [],
    });
  const ARDON_CAMPAIGN = sar({
    name: ARDON,
    metaCampaignId: "120253219612130526",
    accountId: "718146936708597",
    accountName: "Ardon",
    // What the media worker stores once it converts Meta's "17500".
    budgetDaily: 46.66,
  });
  const ARDON_ROW = row(
    "2026-10-18",
    ARDON,
    "9001",
    "Villa reel",
    "Leads",
    201.9,
    11,
    9000,
  );
  const ardon = buildAdsModel(
    october([ARDON_CAMPAIGN], [ARDON_ROW]),
    OCT,
    OCT_NOW,
  );

  test("Ardon's spend, cost per lead and CPM read in dollars", () => {
    const c = ardon.campaigns[0];
    expect(c.currency).toBe("USD");
    expect(c.t.spend).toBeCloseTo(201.9);
    expect(money(c.t.spend, c.currency)).toBe("$202");
    expect(money(c.t.cpl, c.currency, true)).toBe("$18.35");
    expect(money(c.t.cpm, c.currency, true)).toBe("$22.43");
    expect(money(ardon.t.spend, ardon.currency)).toBe("$202");
    expect(c.currencyNote).toBe("SAR account, shown in dollars");
  });

  test("the daily budget reads in dollars, cents and all", () => {
    expect(ardon.campaigns[0].budgetText).toBe("$46.66 a day");
    const shades = buildAdsModel(
      october(
        [
          sar({
            name: SHADES,
            metaCampaignId: "120250793408940703",
            accountId: "762687672022667",
            accountName: "Shades",
            budgetDaily: 31.99,
          }),
        ],
        [row("2026-10-18", SHADES, "9101", "Pergola", "Leads", 203.63, 24)],
      ),
      OCT,
      OCT_NOW,
    ).campaigns[0];
    expect(shades.budgetText).toBe("$31.99 a day");
    expect(money(shades.t.spend, shades.currency)).toBe("$204");
    expect(money(shades.t.cpl, shades.currency, true)).toBe("$8.48");
    // A budget on the ad sets: two SAR ad sets of "10000" each.
    const sets = buildAdsModel(
      october(
        [
          sar({
            name: "EXAMPLE-SAR-ABO",
            budgetDaily: 53.32,
            budgetLevel: "adset",
          }),
        ],
        [],
      ),
      OCT,
      OCT_NOW,
    ).campaigns[0];
    expect(sets.budgetText).toBe("$53.32 a day, set on its ad sets");
  });

  test("an ended campaign on an account not in dollars shows no budget", () => {
    // Its row keeps what its last sync wrote: Meta's riyals before the worker
    // converted (Mofage, QAR, still holds 83), or dollars after. It spent in
    // the period, so its card is drawn.
    const ended = (currency: string, budgetDaily: number) =>
      buildAdsModel(
        october(
          [sar({ ...ARDON_CAMPAIGN, currency, budgetDaily, ended: true })],
          [ARDON_ROW],
        ),
        OCT,
        OCT_NOW,
      ).campaigns[0];
    const riyals = ended("SAR", 175);
    expect(riyals.active).toBe(true);
    expect(riyals.budgetText).toBe("");
    expect(riyals.currencyNote).toBe("SAR account, shown in dollars");
    expect(ended("QAR", 83).budgetText).toBe("");
    // A dollar account's budget was dollars before and after: it stays.
    expect(ended("USD", 40).budgetText).toBe("$40 a day");
  });

  test("a SAR and a USD campaign add up to the client's total", () => {
    const m = buildAdsModel(
      october(
        [
          ARDON_CAMPAIGN,
          {
            ...ARDON_CAMPAIGN,
            name: "EXAMPLE-USD",
            metaCampaignId: "333",
            accountId: "888",
            accountName: "example usd",
            currency: "USD",
            budgetDaily: 40,
          },
        ],
        [
          ARDON_ROW,
          row(
            "2026-10-18",
            "EXAMPLE-USD",
            "9002",
            "Pool",
            "Leads",
            100,
            4,
            5000,
          ),
        ],
      ),
      OCT,
      OCT_NOW,
    );
    expect(m.currency).toBe("USD");
    expect(money(m.t.spend, m.currency)).toBe("$302");
    expect(money(m.t.cpl, m.currency, true)).toBe("$20.13");
    expect(m.campaigns.find(c => c.name === "EXAMPLE-USD")?.currencyNote).toBe(
      undefined,
    );
  });

  test("a campaign row with no currency reads as dollars, as the worker does", () => {
    const blank = buildAdsModel(
      october([{ ...ARDON_CAMPAIGN, currency: undefined }], [ARDON_ROW]),
      OCT,
      OCT_NOW,
    ).campaigns[0];
    expect(blank.currency).toBe("USD");
    expect(blank.currencyNote).toBeUndefined();
  });
});
