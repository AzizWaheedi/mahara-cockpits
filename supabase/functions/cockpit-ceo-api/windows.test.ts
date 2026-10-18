import { expect, test } from 'bun:test';
import { readAdsWindow, readContentWindow, treeSql } from './windows.ts';

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
  campaign_type: type, campaign_status: 'ACTIVE', effective_status: 'ACTIVE', thumbnail_url: null, last_seen: '2026-10-16',
  adset_id: `${id}-set`, adset_name: `${type} set`, setter_name: null, setter_shown: 0,
  setter_due: 0, closer_name: null, closer_closes: 0,
  w7_spend: spend, w7_impressions: 1000, w7_clicks: 100, w7_link_clicks: 80,
  w7_meta_leads: 4, w7_leads: 3, w7_qualified_leads: 2, w7_not_ready_leads: 0, w7_leads_to_intro: 2, w7_leads_to_confirmed_intro: 1, w7_leads_to_demo: 1,
  w7_intros_booked: 2, w7_intros_due: 1, w7_intros_shown: 1, w7_intros_qualified: 1,
  w7_intros_cancelled: 0, w7_intros_advanced: 1, w7_demos_booked: 1, w7_demos_due: 1,
  w7_demos_shown: 1, w7_demos_qualified: 1, w7_demos_shown_mature: 0, w7_demos_cancelled: 0,
  w7_closes: 1, w7_contracted: 250, w7_cash: 100,
  w30_spend: spend, w30_impressions: 1000, w30_clicks: 100, w30_link_clicks: 80,
  w30_meta_leads: 4, w30_leads: 3, w30_qualified_leads: 2, w30_not_ready_leads: 0, w30_leads_to_intro: 2, w30_leads_to_confirmed_intro: 1, w30_leads_to_demo: 1,
  w30_intros_booked: 2, w30_intros_due: 1, w30_intros_shown: 1, w30_intros_qualified: 1,
  w30_intros_cancelled: 0, w30_intros_advanced: 1, w30_demos_booked: 1, w30_demos_due: 1,
  w30_demos_shown: 1, w30_demos_qualified: 1, w30_demos_shown_mature: 0, w30_demos_cancelled: 0,
  w30_closes: 1, w30_contracted: 250, w30_cash: 100,
});

test('custom ads window keeps webinar campaigns out of lead-gen account totals and returns the full nested consumer shape', async () => {
  const sqlResults: Record<string, unknown>[][] = [
    [{ ms: 1790800000000, last_day: '2026-10-03', first_day: '2025-01-01' }],
    [ad('lead_gen', 'ad-1', 100), ad('webinar', 'ad-2', 900)],
    [{ w7_leads: 8, w30_leads: 12, w7_closes: 2, w30_closes: 3, w7_contracted: 500, w30_contracted: 750, w30_voided: 1, ad_leads: 6, ad_closes: 2, ad_contracted: 500 }],
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
    [{ w7_leads: 8, w30_leads: 12, w7_closes: 2, w30_closes: 3, w7_contracted: 500, w30_contracted: 750, w30_voided: 0, ad_leads: 6, ad_closes: 2, ad_contracted: 500 }],
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
    [sfc(1), sfc(2), sfc(3), ad('lead_gen', 'lg', 20)],
    [{ w7_leads: 8, w30_leads: 8, w7_closes: 0, w30_closes: 0, w7_contracted: 0, w30_contracted: 0, w30_voided: 0, ad_leads: 12, ad_closes: 4, ad_contracted: 1000 }],
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
        { ad_id: 'lg', impressions: '16983', reach: '6175', frequency: '2.7502' },
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
  // Retargeting is never held to the lead gate, fatigue included.
  expect(tired.verdict.verdict).toBe('not_judged');
  const leadGen = result.campaigns.find(item => item.id === 'lg-campaign')!.adsets[0].ads[0];
  expect(leadGen.w7.frequency).toBe(2.75);
  expect(leadGen.verdict.verdict).toBe('fatiguing');
  expect(result.account.w7.frequency).toBe(2.03);
  expect(result.campaigns.find(item => item.id === 'lg-campaign')!.w7.frequency).toBe(2.03);
  expect(result.notes.some(note => note.text.includes("Frequency is Meta's own") && note.text.includes('through 2026-10-15'))).toBe(true);
  expect(result.notes.some(note => note.text.includes('highest of its ads'))).toBe(false);
});

test('custom range that has not started on Meta\'s days reads no frequency, and the account time zone falls back to Pacific', async () => {
  const sqlResults: Record<string, unknown>[][] = [
    [{ ms: 1790800000000, last_day: '2026-10-15', first_day: '2025-01-01' }],
    [ad('lead_gen', 'lg', 100)],
    [{ w7_leads: 3, w30_leads: 3, w7_closes: 0, w30_closes: 0, w7_contracted: 0, w30_contracted: 0, w30_voided: 0, ad_leads: 3, ad_closes: 1, ad_contracted: 250 }],
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
    [{ w7_leads: 3, w30_leads: 3, w7_closes: 0, w30_closes: 0, w7_contracted: 0, w30_contracted: 0, w30_voided: 0, ad_leads: 3, ad_closes: 1, ad_contracted: 250 }],
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

// Audit 2026-10-16: the custom range runs the same rules as the scheduled tab.
const adRow = (id: string, type: string, counts: Record<string, number>) => {
  const row: Record<string, unknown> = { ...ad(type, id, 0) };
  for (const key of Object.keys(row)) if (/^w(7|30)_/.test(key)) row[key] = 0;
  for (const [key, value] of Object.entries(counts)) { row[`w7_${key}`] = value; row[`w30_${key}`] = value; }
  return row;
};
const runRows = async (rows: Record<string, unknown>[], totals: Record<string, unknown> = { ad_leads: 0, ad_closes: 0, ad_contracted: 0 }) => {
  const sqlResults: Record<string, unknown>[][] = [
    [{ ms: 1790800000000, last_day: '2026-10-15', first_day: '2025-01-01' }],
    rows,
    [{ w7_leads: 0, w30_leads: 0, w7_closes: 0, w30_closes: 0, w7_contracted: 0, w30_contracted: 0, w30_voided: 0, ...totals }],
  ];
  let query = 0;
  return readAdsWindow('2026-10-10', '2026-10-16', { readSql: async () => sqlResults[query++], readMeta: meta(), now: NOW });
};
const adIn = (result: Awaited<ReturnType<typeof readAdsWindow>>, id: string) => result.campaigns.flatMap(c => c.adsets.flatMap(s => s.ads)).find(item => item.id === id)!;

test('custom range verdicts: retargeting is not judged, no lead is too early, a few cents is not "nothing spent"', async () => {
  const result = await runRows([
    adRow('margin-tax', 'lead_gen', { spend: 22.8, impressions: 900 }),
    adRow('hidden-tax', 'retargeting', { spend: 1.43, impressions: 300 }),
    adRow('lg-small', 'lead_gen', { spend: 0.77, impressions: 41 }),
    adRow('lg-none', 'lead_gen', { spend: 0 }),
    adRow('dear', 'lead_gen', { spend: 34.53, leads: 1 }),
    adRow('good', 'lead_gen', { spend: 20, leads: 2 }),
    // The CEO, 2026-10-18: per ad the funnel stops at the intro. Demos shown with nothing signed are the Sales tab's.
    adRow('old-demos', 'lead_gen', { spend: 20, leads: 2, demos_shown: 4, demos_shown_mature: 3 }),
    // Eight leads and none booked, though two older leads' appointments sit on the ad: per lead, it does not book.
    adRow('no-book', 'lead_gen', { spend: 40, leads: 8, intros_booked: 2 }),
    // Five leads booked an intro and none showed or stayed confirmed.
    adRow('unconfirmed', 'lead_gen', { spend: 20, leads: 6, leads_to_intro: 5, intros_booked: 7 }),
    adRow('few-intros', 'lead_gen', { spend: 20, leads: 6, leads_to_intro: 4 }),
  ]);
  const range = '2026-10-10 to 2026-10-16';
  expect(adIn(result, 'margin-tax').verdict).toEqual({ verdict: 'hold', reason: `$22.80 from ${range} and no lead yet: too early to judge against the $15 gate.`, owner: 'ads' });
  expect(adIn(result, 'hidden-tax').verdict).toEqual({ verdict: 'not_judged', reason: 'Retargeting is not judged on cost per lead.', owner: null });
  expect(adIn(result, 'lg-small').verdict).toEqual({ verdict: 'hold', reason: `Delivering, but only $0.77 and 41 impressions from ${range}: too little to judge.`, owner: 'ads' });
  expect(adIn(result, 'lg-none').verdict.verdict).toBe('no delivery');
  expect(adIn(result, 'dear').verdict.reason).toBe(`$34.53 a lead from ${range}, more than half again over the $15 gate.`);
  expect(adIn(result, 'good').verdict.verdict).toBe('scale');
  expect(adIn(result, 'old-demos').verdict.verdict).toBe('scale');
  expect(adIn(result, 'no-book').verdict).toEqual({ verdict: 'leads do not book', reason: `8 leads from ${range} and no intro booked. The ad is doing its job; the follow-up is not.`, owner: 'setter' });
  expect(adIn(result, 'unconfirmed').verdict).toEqual({ verdict: 'intros do not confirm', reason: `5 leads booked an intro from ${range} and none of them showed or stayed confirmed. That is the setter's confirming, not the ad.`, owner: 'setter' });
  expect(adIn(result, 'few-intros').verdict.verdict).toBe('scale');
  for (const item of result.campaigns.flatMap(c => c.adsets.flatMap(s => s.ads))) {
    expect(item.verdict.reason).not.toContain('$0.00');
    expect(item.verdict.reason).not.toContain('demo');
  }
  expect(result.verdicts).toEqual({ hold: 2, not_judged: 1, 'no delivery': 1, kill: 1, scale: 3, 'leads do not book': 1, 'intros do not confirm': 1 });
  const text = result.notes.map(note => note.text).join(' ');
  expect(text).toContain('"Leads do not book" and "intros do not confirm" are the setter.');
  expect(text).not.toMatch(/demos do not close|cost per demo/i);
});

test('custom range: intros and confirmed intros are per lead, and the constraint stops at the confirmed intro', async () => {
  const quiet = { impressions: 400, link_clicks: 10, leads: 3, leads_to_intro: 1 };
  const result = await runRows([
    // One lead, a no-show and its rebooking that showed: two appointments, one intro, one confirmed.
    adRow('rebooked', 'lead_gen', { spend: 10, leads: 1, leads_to_intro: 1, leads_to_confirmed_intro: 1, intros_booked: 2, leads_to_demo: 1, demos_booked: 2, demos_shown: 3, closes: 2 }),
    { ...adRow('weak', 'lead_gen', { spend: 50, impressions: 400, link_clicks: 10, leads: 6, leads_to_intro: 5, leads_to_confirmed_intro: 1 }), campaign_id: 'weak' },
    { ...adRow('strong', 'lead_gen', { spend: 50, impressions: 400, link_clicks: 10, leads: 6, leads_to_intro: 5, leads_to_confirmed_intro: 4, closes: 3 }), campaign_id: 'strong' },
    // The old demo stages would have blamed the closer here: five demos shown, no close, five account closes.
    { ...adRow('demos', 'lead_gen', { ...quiet, intros_due: 10, intros_shown: 10, intros_advanced: 2, demos_booked: 15, demos_shown: 5 }), campaign_id: 'demos' },
  ]);
  const rebooked = adIn(result, 'rebooked').w7;
  expect(rebooked).toMatchObject({ leadsToIntro: 1, leadsToConfirmedIntro: 1, bookRate: 1, costPerIntro: 10, costPerConfirmedIntro: 10, confirmedIntroRate: 1 });
  expect(rebooked.leadToDemo).toBe(1);
  const weak = result.campaigns.find(c => c.id === 'weak')!;
  expect(weak.w30).toMatchObject({ costPerIntro: 10, costPerConfirmedIntro: 50, confirmedIntroRate: 0.2 });
  // Confirmed over intros: 1 of 5 here against 6 of 12 across the account (rebooked, weak, strong, demos).
  expect(weak.constraint).toEqual({ stage: 'intros to confirmed intros', owner: 'setter', mine: 0.2, account: 0.5 });
  expect(weak.constraint!.mine).toBe(weak.w30.confirmedIntroRate!);
  expect(result.account.w30.closes).toBe(5);
  expect(result.campaigns.find(c => c.id === 'strong')!.constraint).toBeNull();
  expect(result.campaigns.find(c => c.id === 'demos')!.constraint).toBeNull();
  for (const c of result.campaigns) expect(c.constraint?.stage ?? '').not.toMatch(/demo|close/);
});

test('custom range coverage comes straight from the CRM and warns about records no ad row holds', async () => {
  const result = await runRows([adRow('one', 'lead_gen', { spend: 10, leads: 1, closes: 1, contracted: 6000 })], { ad_leads: 1, ad_closes: 2, ad_contracted: 9000 });
  expect(result.coverage.w30).toMatchObject({ adLeads: 1, adCloses: 2, adContracted: 9000 });
  const warn = result.notes.find(note => note.level === 'warn' && note.text.includes('could not place'));
  expect(warn?.text).toContain('the CRM holds 1 lead and 2 signed deals ($9,000) on this account\'s ads, and the ad rows add up to 1 and 1 ($6,000)');
});

// The CEO, 2026-10-16, on the $6,000 Makers deal: "put it in seen first". Calls
// and deals are credited to the ad that brought in the lead, when it is one of
// this account's ads; otherwise to the ad on the call or deal itself.
test('custom range credits calls and deals to the lead\'s ad, with the same SQL as the scheduled tab', async () => {
  const { treeSql: scheduled } = await import('../../../hermes/ceo-refresh/native/adapters/b2bAds.js');
  const strip = (sql: string) => sql.split('\n').map(line => line.replace(/--.*$/, '').trim()).filter(Boolean).join('\n');
  expect(strip(treeSql('2026-10-10', '2026-09-17', '2026-10-16'))).toBe(strip(scheduled('2026-10-10', '2026-09-17', '2026-10-16')));

  const { PGlite } = await import('../../../apps/media-buyer-cockpit/node_modules/@electric-sql/pglite');
  const db = new PGlite();
  const snap = (day: string, id: string, name: string, status: string, spend: number) =>
    `('${day}', '${id}', 'set', 'lg', '${name}', 'Set', 'MaharaMedia | Lead Gen', 'ACTIVE', '${status}', null, ${spend}, ${spend * 20}, ${spend}, ${spend / 2}, 0, '2026-10-16 09:00+00')`;
  await db.exec(`
    create table public.meta_ad_snapshots (date date, ad_id text, adset_id text, campaign_id text, ad_name text, adset_name text,
      campaign_name text, campaign_status text, effective_status text, thumbnail_url text,
      spend numeric, impressions numeric, clicks numeric, inline_link_clicks numeric, leads numeric, last_synced_at timestamptz);
    create table public.leads (contact_id text primary key, ad_id text, tags text[], lead_created_at timestamptz);
    create table public.calls (contact_id text, ad_id text, call_type text, booked_at timestamptz, start_at timestamptz, status text, assigned_user_id text);
    create table public.sales_reps (ghl_user_id text, display_name text);
    create table public.closed_deals (response_id text, contact_id text, ad_id text, submitted_at timestamptz,
      contracted_revenue numeric, cash_collected numeric, closer text);
    create table public.record_voids (entity text, record_id text);
    create function public.b2b_campaign_type(name text) returns text language sql immutable as $$ select 'lead_gen' $$;
    insert into public.meta_ad_snapshots values
      ${snap('2026-09-07', 'old', 'Lea Team sitting video | 20-2-26', 'PAUSED', 3)},
      ${['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16'].map(d => snap(d, 'live', 'Seen First | Hook 3', 'ACTIVE', 5)).join(',')};
    insert into public.leads values ('makers', 'live', '{roas-qualified}', '2026-10-11 05:00+00'), ('away', 'gone', '{roas-qualified}', '2026-10-11 05:00+00');
    insert into public.calls values
      ('makers', 'old', 'intro', '2026-10-11 07:00+00', '2026-10-12 08:00+00', 'showed', 'u1'),
      ('away', 'live', 'intro', '2026-10-12 07:00+00', '2026-10-13 08:00+00', 'showed', 'u1'),
      ('walkin', 'old', 'intro', '2026-10-12 07:00+00', '2026-10-13 08:00+00', 'showed', 'u1');
    insert into public.sales_reps values ('u1', 'Setter One');
    insert into public.closed_deals values
      ('makers-deal', 'makers', 'old', '2026-10-13 08:25+00', 6000, 500, 'Closer Two'),
      ('typed-in', 'makers', null, '2026-10-14 08:25+00', 1000, 100, 'Closer Two');
  `);
  const result = await readAdsWindow('2026-10-10', '2026-10-16', {
    readSql: async (_project, query) => (await db.query(query)).rows as Record<string, unknown>[],
    readMeta: meta(),
    now: NOW,
  });
  // The Makers call and deal (and a deal typed in with no ad) land on the lead's ad, "Seen First".
  expect(adIn(result, 'live').w7).toMatchObject({ introsBooked: 2, closes: 2, contracted: 7000, cash: 600 });
  // The Makers lead is on its own ad with a showed intro: one intro and one confirmed, at $35 each.
  expect(adIn(result, 'live').w7).toMatchObject({ leads: 1, leadsToIntro: 1, leadsToConfirmedIntro: 1, costPerIntro: 35, costPerConfirmedIntro: 35 });
  // "gone" is not one of this account's ads, so the call keeps its own ad; a contact with no lead row keeps its own.
  expect(adIn(result, 'old').w7).toMatchObject({ spend: 0, introsBooked: 1, closes: 0 });
  expect(result.account.w7).toMatchObject({ introsBooked: 3, closes: 2, contracted: 7000 });
  expect(result.coverage.w7).toMatchObject({ closes: 2, adCloses: 2, adContracted: 7000 });
  const text = result.notes.map(note => note.text).join(' ');
  expect(text).not.toContain('could not place');
  expect(text).toContain('Calls and deals are credited to the ad on the contact\'s lead record when it is one of this account\'s ads and was already running when the call was booked or the deal signed; otherwise they keep the ad on the call or deal.');
});
