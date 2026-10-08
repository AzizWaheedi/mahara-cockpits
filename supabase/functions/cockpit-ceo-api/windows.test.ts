import { expect, test } from 'bun:test';
import { readAdsWindow, readContentWindow } from './windows.ts';

const ad = (type: string, id: string, spend: number) => ({
  ad_id: id, ad_name: `${type} creative`, campaign_id: `${id}-campaign`, campaign_name: type,
  campaign_type: type, campaign_status: 'ACTIVE', effective_status: 'ACTIVE', thumbnail_url: null,
  adset_id: `${id}-set`, adset_name: `${type} set`, setter_name: null, setter_shown: 0,
  setter_due: 0, closer_name: null, closer_closes: 0,
  w7_spend: spend, w7_impressions: 1000, w7_clicks: 100, w7_link_clicks: 80,
  w7_meta_leads: 4, w7_freq: 2, w7_leads: 3, w7_qualified_leads: 2, w7_not_ready_leads: 0,
  w7_intros_booked: 2, w7_intros_due: 1, w7_intros_shown: 1, w7_intros_qualified: 1,
  w7_intros_cancelled: 0, w7_intros_advanced: 1, w7_demos_booked: 1, w7_demos_due: 1,
  w7_demos_shown: 1, w7_demos_qualified: 1, w7_demos_cancelled: 0,
  w7_closes: 1, w7_contracted: 250, w7_cash: 100,
  w30_spend: spend, w30_impressions: 1000, w30_clicks: 100, w30_link_clicks: 80,
  w30_meta_leads: 4, w30_freq: 2, w30_leads: 3, w30_qualified_leads: 2, w30_not_ready_leads: 0,
  w30_intros_booked: 2, w30_intros_due: 1, w30_intros_shown: 1, w30_intros_qualified: 1,
  w30_intros_cancelled: 0, w30_intros_advanced: 1, w30_demos_booked: 1, w30_demos_due: 1,
  w30_demos_shown: 1, w30_demos_qualified: 1, w30_demos_cancelled: 0,
  w30_closes: 1, w30_contracted: 250, w30_cash: 100,
});

test('custom ads window keeps webinar campaigns out of lead-gen account totals and returns the full nested consumer shape', async () => {
  const sqlResults: Record<string, unknown>[][] = [
    [{ ms: 1790800000000, last_day: '2026-10-03', first_day: '2025-01-01' }],
    [ad('lead_gen', 'ad-1', 100), ad('webinar', 'ad-2', 900)],
    [{ w7_leads: 8, w30_leads: 12, w7_closes: 2, w30_closes: 3, w7_contracted: 500, w30_contracted: 750, w30_voided: 1 }],
  ];
  const queries: { project: string; query: string }[] = [];
  const result = await readAdsWindow('2026-09-28', '2026-10-04', {
    readSql: async (project, query) => { queries.push({ project, query }); return sqlResults[queries.length - 1]; },
    readMeta: async () => ({ account_status: 1, disable_reason: 0, balance: '0', currency: 'USD' }),
  });

  expect(result.windows).toEqual({ from7: '2026-09-28', from30: '2026-09-28', to: '2026-10-04' });
  expect(result.account.w7.spend).toBe(100);
  expect(result.account.w7.leads).toBe(3);
  expect(result.retargetingSpend.w7).toBe(0);
  expect(result.campaigns.map(campaign => campaign.type)).toEqual(['lead_gen', 'webinar']);
  expect(result.coverage.w7).toEqual({ leads: 8, adLeads: 6, closes: 2, adCloses: 2, contracted: 500, adContracted: 500 });
  expect(result.campaigns[0].adsets[0].ads[0].w7.roas).toBe(2.5);
  expect(queries.every(query => query.project === 'flwboeijllbtrufxkhts')).toBe(true);
});

test('content window keeps voided deal totals separate and excludes paid and unnamed deals from organic revenue', async () => {
  let seenProject = '';
  const result = await readContentWindow('2026-09-01', '2026-09-30', {
    readSql: async (project) => {
      seenProject = project;
      return [{
        platforms: [{ platform: 'Instagram', contacts: '4', leads: '2', booked: '1', demos_shown: '1', closes: '1', contracted: '123.456', cash: '40' }],
        deals: [
          { source: 'Meta ads', deals: '1', contracted: '1000.005', cash: '500', with_ad: '1' },
          { source: 'TikTok', deals: '1', contracted: '9.999', cash: '4', with_ad: '0' },
          { source: 'Not answered', deals: '1', contracted: '20', cash: '10', with_ad: '0' },
        ],
        totals: { contacts: '4', leads: '2', paid_leads: '1', organic_leads: '1', reactivation_leads: '0', unnamed_leads: '0' },
        posts: [{ platform: 'Instagram', posts: '2', newest: '2026-09-29' }],
        voided: { deals: '1', contracted: '300', cash: '25' },
      }];
    },
  });

  expect(seenProject).toBe('flwboeijllbtrufxkhts');
  expect(result.platforms[0]).toEqual({ platform: 'Instagram', contacts: 4, leads: 2, booked: 1, demosShown: 1, closes: 1, contracted: 123.46, cash: 40, posts: 2, newestPost: '2026-09-29' });
  expect(result.dealsAll).toEqual({ deals: 3, contracted: 1030.01, cash: 514 });
  expect(result.dealsOrganic).toEqual({ deals: 1, contracted: 10, cash: 4 });
  expect(result.voided).toEqual({ deals: 1, contracted: 300, cash: 25 });
});

// The CEO, 2026-10-08: the Ads tab's CTR is link CTR. Link clicks Meta did not
// send are not known: never 0, and no rate or cost is worked out over them.
test('custom ads window shows link CTR, never CTR (all), and keeps unknown link clicks unknown', async () => {
  const unknown = { ...ad('lead_gen', 'ad-3', 50), w7_link_clicks: null, w30_link_clicks: null };
  const sqlResults: Record<string, unknown>[][] = [
    [{ ms: 1790800000000, last_day: '2026-10-03', first_day: '2025-01-01' }],
    [ad('lead_gen', 'ad-1', 100), unknown],
    [{ w7_leads: 8, w30_leads: 12, w7_closes: 2, w30_closes: 3, w7_contracted: 500, w30_contracted: 750, w30_voided: 0 }],
  ];
  const queries: string[] = [];
  const result = await readAdsWindow('2026-09-28', '2026-10-04', {
    readSql: async (_project, query) => { queries.push(query); return sqlResults[queries.length - 1]; },
    readMeta: async () => ({ account_status: 1, disable_reason: 0, balance: '0', currency: 'USD' }),
  });

  const known = result.campaigns.find(campaign => campaign.id === 'ad-1-campaign')!.adsets[0].ads[0].w7;
  expect(known.linkClicks).toBe(80);
  expect(known.ctrLink).toBe(0.08);
  expect(known.ctr).toBe(0.1);
  expect(known.ctrLink).not.toBe(known.ctr);
  expect(known.cpc).toBe(1.25);

  const missing = result.campaigns.find(campaign => campaign.id === 'ad-3-campaign')!.adsets[0].ads[0].w7;
  expect(missing.linkClicks).toBeNull();
  expect(missing.ctrLink).toBeNull();
  expect(missing.cpc).toBeNull();
  expect(missing.ctr).toBe(0.1);

  // One ad without a count makes the account's link clicks unknown, not 80.
  expect(result.account.w7.linkClicks).toBeNull();
  expect(result.account.w7.ctrLink).toBeNull();
  expect(result.account.w7.impressions).toBe(2000);

  // The query keeps a delivered day without a count as null instead of summing past it.
  expect(queries[1]).toContain('case when bool_and(inline_link_clicks is not null) then sum(inline_link_clicks) end as link_clicks');
  expect(queries[1]).not.toContain('coalesce(w7_ads.link_clicks,0)');
});
