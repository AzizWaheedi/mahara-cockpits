import { expect, test } from 'bun:test';
import { readAdsWindow, readContentWindow } from './windows.ts';

// Meta: the account read, then whole-window insights per level. No row means no frequency.
type MetaParams = Record<string, string | number>;
const meta = (levels: Partial<Record<'ad' | 'adset' | 'campaign' | 'account', Record<string, unknown>[]>> = {}, timezone_name: string | undefined = 'America/Los_Angeles', calls: { path: string; params: MetaParams }[] = []) =>
  async (path: string, params: MetaParams = {}) => {
    calls.push({ path, params });
    if (path === 'act_746108264865897') return { account_status: 1, disable_reason: 0, balance: '0', currency: 'USD', ...(timezone_name ? { timezone_name } : {}) };
    return { data: levels[String(params.level) as 'ad'] ?? [], paging: {} };
  };
const NOW = () => Date.parse('2026-10-16T12:00:00Z');

const ad = (type: string, id: string, spend: number) => ({
  ad_id: id, ad_name: `${type} creative`, campaign_id: `${id}-campaign`, campaign_name: type,
  campaign_type: type, campaign_status: 'ACTIVE', effective_status: 'ACTIVE', thumbnail_url: null,
  adset_id: `${id}-set`, adset_name: `${type} set`, setter_name: null, setter_shown: 0,
  setter_due: 0, closer_name: null, closer_closes: 0,
  w7_spend: spend, w7_impressions: 1000, w7_clicks: 100, w7_link_clicks: 80,
  w7_meta_leads: 4, w7_leads: 3, w7_qualified_leads: 2, w7_not_ready_leads: 0,
  w7_intros_booked: 2, w7_intros_due: 1, w7_intros_shown: 1, w7_intros_qualified: 1,
  w7_intros_cancelled: 0, w7_intros_advanced: 1, w7_demos_booked: 1, w7_demos_due: 1,
  w7_demos_shown: 1, w7_demos_qualified: 1, w7_demos_cancelled: 0,
  w7_closes: 1, w7_contracted: 250, w7_cash: 100,
  w30_spend: spend, w30_impressions: 1000, w30_clicks: 100, w30_link_clicks: 80,
  w30_meta_leads: 4, w30_leads: 3, w30_qualified_leads: 2, w30_not_ready_leads: 0,
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
    readMeta: meta(),
    now: NOW,
  });

  expect(result.windows).toEqual({ from7: '2026-09-28', from30: '2026-09-28', to: '2026-10-04', metaUntil: '2026-10-04', metaTimeZone: 'America/Los_Angeles' });
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
    readMeta: meta(),
    now: NOW,
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

// The CEO, 2026-10-16: frequency is Meta's own at each level for the range, the
// number Ads Manager shows for those dates, never the highest of the children.
test('custom range frequency comes from Meta per level, ends on Meta\'s day, and is never the highest child', async () => {
  const sfc = (n: number) => ({ ...ad('retargeting', `sfc-${n}`, 20), campaign_id: 'sfc', campaign_name: '[MhM] Hammer Them [SFC]', adset_id: `sfc-set-${n}`, adset_name: `SFC set ${n}` });
  const sqlResults: Record<string, unknown>[][] = [
    [{ ms: 1790800000000, last_day: '2026-10-15', first_day: '2025-01-01' }],
    [sfc(1), sfc(2), sfc(3), ad('lead_gen', 'lg', 100)],
    [{ w7_leads: 8, w30_leads: 8, w7_closes: 0, w30_closes: 0, w7_contracted: 0, w30_contracted: 0, w30_voided: 0 }],
  ];
  const calls: { path: string; params: MetaParams }[] = [];
  let query = 0;
  const result = await readAdsWindow('2026-10-10', '2026-10-16', {
    readSql: async () => sqlResults[query++],
    readMeta: meta({
      ad: [
        { ad_id: 'sfc-1', impressions: '400', reach: '210', frequency: '1.9' },
        { ad_id: 'sfc-2', impressions: '420', reach: '210', frequency: '2.0' },
        { ad_id: 'sfc-3', impressions: '452', reach: '220', frequency: '2.75' },
        { ad_id: 'lg', impressions: '16983', reach: '11000', frequency: '1.54' },
      ],
      adset: [{ adset_id: 'sfc-set-1', impressions: '400', reach: '210', frequency: '1.9' }],
      campaign: [
        { campaign_id: 'sfc', impressions: '1272', reach: '151', frequency: '8.4238' },
        { campaign_id: 'lg-campaign', impressions: '16983', reach: '8379', frequency: '2.0268' },
      ],
      account: [{ impressions: '16983', reach: '8379', frequency: '2.0268', spend: '100' }],
    }, 'America/Los_Angeles', calls),
    // 05:00 UTC: the 16th in Kuwait, still the 15th in Los Angeles.
    now: () => Date.parse('2026-10-16T05:00:00Z'),
  });

  expect(result.windows.metaUntil).toBe('2026-10-15');
  expect(result.windows.metaTimeZone).toBe('America/Los_Angeles');
  const insights = calls.filter(call => call.path.endsWith('/insights'));
  expect(insights.map(call => call.params.level)).toEqual(['ad', 'adset', 'campaign', 'account']);
  for (const call of insights) expect(JSON.parse(String(call.params.time_range))).toEqual({ since: '2026-10-10', until: '2026-10-15' });
  // The account row counts people over the lead-gen campaigns only.
  expect(JSON.parse(String(insights[3].params.filtering))[0].value).toEqual(['lg-campaign']);

  const campaign = result.campaigns.find(item => item.id === 'sfc')!;
  expect(campaign.w7.frequency).toBe(8.42);
  expect(campaign.w30.frequency).toBe(8.42);
  expect(campaign.w7.frequency).not.toBe(2.75);
  expect(campaign.adsets.find(set => set.id === 'sfc-set-1')!.w7.frequency).toBe(1.9);
  // Meta had no ad set row for set 2: unknown, never borrowed from its ad.
  expect(campaign.adsets.find(set => set.id === 'sfc-set-2')!.w7.frequency).toBeNull();
  const tired = campaign.adsets.find(set => set.id === 'sfc-set-3')!.ads[0];
  expect(tired.w7.frequency).toBe(2.75);
  expect(tired.verdict.verdict).toBe('fatiguing');
  expect(result.account.w7.frequency).toBe(2.03);
  expect(result.campaigns.find(item => item.id === 'lg-campaign')!.w7.frequency).toBe(2.03);
  expect(result.notes.some(note => note.text.includes("Frequency is Meta's own") && note.text.includes('through 2026-10-15'))).toBe(true);
  expect(result.notes.some(note => note.text.includes('highest of its ads'))).toBe(false);
});

test('custom range that has not started on Meta\'s days reads no frequency, and the account time zone falls back to Pacific', async () => {
  const sqlResults: Record<string, unknown>[][] = [
    [{ ms: 1790800000000, last_day: '2026-10-15', first_day: '2025-01-01' }],
    [ad('lead_gen', 'lg', 100)],
    [{ w7_leads: 3, w30_leads: 3, w7_closes: 0, w30_closes: 0, w7_contracted: 0, w30_contracted: 0, w30_voided: 0 }],
  ];
  const calls: { path: string; params: MetaParams }[] = [];
  let query = 0;
  const result = await readAdsWindow('2026-10-16', '2026-10-16', {
    readSql: async () => sqlResults[query++],
    readMeta: meta({}, undefined, calls),
    now: () => Date.parse('2026-10-16T05:00:00Z'),
  });
  expect(result.windows.metaTimeZone).toBe('America/Los_Angeles');
  expect(result.windows.metaUntil).toBe('2026-10-15');
  expect(calls.filter(call => call.path.endsWith('/insights'))).toHaveLength(0);
  expect(result.campaigns[0].w7.frequency).toBeNull();
  expect(result.account.w7.frequency).toBeNull();
});

test('custom range fails rather than falling back when Meta refuses a frequency read', async () => {
  const sqlResults: Record<string, unknown>[][] = [
    [{ ms: 1790800000000, last_day: '2026-10-15', first_day: '2025-01-01' }],
    [ad('lead_gen', 'lg', 100)],
    [{ w7_leads: 3, w30_leads: 3, w7_closes: 0, w30_closes: 0, w7_contracted: 0, w30_contracted: 0, w30_voided: 0 }],
  ];
  let query = 0;
  await expect(readAdsWindow('2026-10-10', '2026-10-15', {
    readSql: async () => sqlResults[query++],
    readMeta: async path => {
      if (path === 'act_746108264865897') return { account_status: 1, timezone_name: 'America/Los_Angeles' };
      throw new Error('Meta rejected the request (400 code 100)');
    },
    now: NOW,
  })).rejects.toThrow('Meta rejected');
});

test('the custom range no longer works frequency out of daily snapshots or the children', async () => {
  const source = await Bun.file(new URL('./windows.ts', import.meta.url)).text();
  expect(source).not.toContain('max(frequency)');
  expect(source).not.toContain('Math.max(target.frequency');
  expect(source).not.toContain('_freq');
});
