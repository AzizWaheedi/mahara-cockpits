import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { assistEnqueue, assistGet, assistQueueDepth, changeResultsForCampaign, chatAsk, chatThread, mediaNativeWrite, onboardings, launchWatch, winners } from '../../../apps/media-buyer-cockpit/src/lib/mediaNativeClient';
import { BUYER, database, owner, type Database } from './database';
import { browserDatabase } from './browserDatabase';

let db: Database;
let opened = false;
beforeEach(async () => { opened = false; db = await database(); opened = true; });
afterEach(async () => { if (opened) { opened = false; await db.close(); } });
async function source(table: string, id: string, client: string, data: Record<string, unknown>) {
  await owner(db);
  await db.query("INSERT INTO public.cockpit_media_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES($1,$2,$3,$4,'2026-10-04T00:00:00Z')", [table, id, [client], JSON.stringify({ ...data, _id: id })]);
  await db.query('UPDATE public.cockpit_media_source_state SET row_count=(SELECT count(*) FROM public.cockpit_media_sources WHERE table_name=$1) WHERE table_name=$1', [table]);
}
describe('native client over the actual SDK and canonical PostgreSQL', () => {
  test('chat reads preserve imported history, native questions and real action history without leaking clients', async () => {
    await source('campaignChat', 'legacy-chat', 'Alpha', { campaignName: 'Alpha-Campaign', campaignId: 'Alpha-Campaign', at: 1, author: 'viktor', text: 'Human historical reply', kind: 'reply', status: 'done', pending: false });
    const actionId = crypto.randomUUID();
    await owner(db);
    await db.query("INSERT INTO public.cockpit_media_actions(id,actor_id,operation,request,state) VALUES($1,$2,'edit.pauseAd','{}','confirmed')", [actionId, BUYER]);
    await db.query("INSERT INTO public.cockpit_campaign_action_messages(id,campaign_name,actor_id,text,at) VALUES($1,'Alpha-Campaign',$2,'Paused the ad',now())", [actionId, BUYER]);
    const client = await browserDatabase(db);
    expect(await chatAsk({ campaignName: 'Alpha-Campaign', campaignId: 'Alpha-Campaign', text: 'A new question' }, { apply: true, requestId: crypto.randomUUID() }, client)).toEqual({ ok: true });
    const rows = await chatThread({ campaignId: 'Alpha-Campaign' }, client);
    expect(rows.map(item => item.text).sort()).toEqual(['A new question', 'Human historical reply', 'Paused the ad']);
    await expect(chatThread({ campaignId: 'Beta-Campaign' }, client)).rejects.toThrow();
  });
  test('a delayed shared ACK cannot retire a newer uncertain intent', async () => {
    const a = crypto.randomUUID(); const b = crypto.randomUUID(); const c = crypto.randomUUID();
    let acknowledgeSecondA = () => {};
    let secondAArrived = () => {};
    const holdSecondA = new Promise<void>(resolve => { acknowledgeSecondA = resolve; });
    const sawSecondA = new Promise<void>(resolve => { secondAArrived = resolve; });
    let aCalls = 0; let loseB = true;
    const client = await browserDatabase(db, { afterRpc: async (name, args) => {
      if (name !== 'cockpit_media_native_write') return;
      if (args.p_request_id === a) {
        if (++aCalls === 1) await sawSecondA;
        else { secondAArrived(); await holdSecondA; }
      }
      if (args.p_request_id === b && loseB) { loseB = false; throw new Error('B committed; response lost'); }
    } });
    const args = { kind: 'copy', client: 'Alpha', brief: 'Interleaved acknowledgements' };
    const firstA = assistEnqueue(args, { apply: true, requestId: a }, client);
    const secondA = assistEnqueue(args, { apply: true, requestId: a }, client);
    expect(await firstA).toBe(a);
    await expect(assistEnqueue(args, { apply: true, requestId: b }, client)).rejects.toThrow();
    acknowledgeSecondA(); expect(await secondA).toBe(a);
    await expect(assistEnqueue(args, { apply: true, requestId: c }, client)).rejects.toThrow('uncertain request');
    expect(await assistEnqueue(args, { apply: true, requestId: b }, client)).toBe(b);
    await owner(db);
    expect((await db.query<{ count: number }>('SELECT count(*)::int count FROM public.cockpit_media_native_jobs')).rows[0].count).toBe(2);
  }, 15000);
  test('explicit apply returns the consumer request ID and polls the saved request', async () => {
    const client = await browserDatabase(db);
    const dry = await assistEnqueue({ kind: 'copy', client: 'Alpha', brief: 'Office copy' }, {}, client);
    expect(dry).toEqual({ ok: false, dryRun: true });
    const id = await assistEnqueue({ kind: 'copy', client: 'Alpha', brief: 'Office copy' }, { apply: true, requestId: crypto.randomUUID() }, client);
    expect(typeof id).toBe('string');
    const request = await assistGet({ id: String(id) }, client);
    expect(request?.brief).toBe('Office copy'); expect(request?.status).toBe('queued');
  });
  test('lost transport receipt preserves operation ID and does not duplicate an actual committed write', async () => {
    let lose = true;
    const client = await browserDatabase(db, { afterRpc: async name => { if (name === 'cockpit_media_native_write' && lose) { lose = false; throw new Error('connection lost after commit'); } } });
    const id = crypto.randomUUID(); const args = { kind: 'copy', client: 'Alpha', brief: 'Stable retry' };
    await expect(mediaNativeWrite('assist.enqueue', args, { apply: true, requestId: id }, client)).rejects.toThrow();
    await expect(mediaNativeWrite('assist.enqueue', args, { apply: true, requestId: crypto.randomUUID() }, client)).rejects.toThrow('uncertain');
    expect(await assistEnqueue(args, { apply: true, requestId: id }, client)).toBe(id);
    await owner(db);
    expect((await db.query<{ count: number }>("SELECT count(*)::int count FROM public.cockpit_media_native_records WHERE data->>'brief'='Stable retry'")).rows[0].count).toBe(1);
  });
  test('account switch discards an in-flight response', async () => {
    let switchAccount = async () => {};
    const client = await browserDatabase(db, { afterRpc: async name => { if (name === 'cockpit_media_native_read') await switchAccount(); } });
    switchAccount = async () => { await client.auth.signOut({ scope: 'local' }); };
    await expect(assistQueueDepth({}, client)).rejects.toThrow('account changed');
  });
  test('malformed source responses are errors, not fabricated zero counts', async () => {
    const client = await browserDatabase(db, { response: () => ({ queued: null, working: 0 }) });
    await expect(assistQueueDepth({}, client)).rejects.toThrow();
  });
  test('real source rows calculate before/after spend and reject another client', async () => {
    await source('manualChanges', 'change1', 'Alpha', { campaignName: 'Alpha-Campaign', at: Date.parse('2026-09-30T10:00:00Z'), by: 'Buyer', what: 'Budget increased' });
    await owner(db);
    await db.exec("UPDATE public.cockpit_media_feed_state SET ready=true,source_rows=0,source_snapshot_at='2026-10-04T00:00:00Z'");
    for (const day of ['2026-09-27', '2026-09-28', '2026-09-29', '2026-10-01', '2026-10-02', '2026-10-03']) {
      const after = day >= '2026-10-01';
      await db.query('INSERT INTO public.cockpit_media_daily_stats(source_deployment,source_id,campaign_name,day,data) VALUES($1,$2,$3,$4,$5)', ['offline', day, 'Alpha-Campaign', day, JSON.stringify({ campaignName: 'Alpha-Campaign', date: day, spend: after ? 100 : 80, leads: after ? 10 : 4, impressions: 2000, linkClicks: 80, metaAdId: '123' })]);
    }
    const client = await browserDatabase(db);
    const results = await changeResultsForCampaign({ campaignName: 'Alpha-Campaign' }, client, Date.parse('2026-10-04T12:00:00Z'));
    expect(results.changes[0].result.before.spend).toBe(240);
    expect(results.changes[0].result.before.cpl).toBe(20);
    expect(results.changes[0].result.after.spend).toBe(300);
    expect(results.changes[0].result.after.cpl).toBe(10);
    expect(results.changes[0].result.state).toBe('observed');
    await expect(changeResultsForCampaign({ campaignName: 'Beta-Campaign' }, client)).rejects.toThrow();
    await owner(db); await db.exec("UPDATE public.cockpit_media_feed_state SET ready=false WHERE feed='bookingEvents'");
    await expect(changeResultsForCampaign({ campaignName: 'Alpha-Campaign' }, client)).rejects.toThrow();
  });
  test('onboarding counts, executable steps and launch issue ordering preserve client scope', async () => {
    await source('onboardings', 'onb-a', 'Alpha', { client: 'Alpha', taskId: 'task-a', status: 'open', groups: [{ name: 'Build', items: [{ name: 'Create ad set', done: true }, { name: 'Confirm billing', done: false }] }] });
    await source('onboardings', 'onb-b', 'Beta', { client: 'Beta', taskId: 'task-b', status: 'open', groups: [] });
    await source('launchWatch', 'watch-a', 'Alpha', { client: 'Alpha', issues: ['Missing billing', 'Missing form'] });
    await source('launchWatch', 'watch-b', 'Beta', { client: 'Beta', issues: ['Hidden'] });
    const client = await browserDatabase(db);
    const onb = await onboardings(client);
    expect(onb.length).toBe(1); expect(onb[0].done).toBe(1); expect(onb[0].total).toBe(2);
    expect(onb[0].groups[0].items.map(step => step.viktorCanDo)).toEqual([true, false]);
    expect((await launchWatch(client)).map(item => item.client)).toEqual(['Alpha']);
  });
  test('winner catalog preserves stills, ranks eligible real facts and fails missing coverage', async () => {
    const client = await browserDatabase(db);
    await expect(winners({ serviceType: 'Offices' }, client)).rejects.toThrow();
    await owner(db);
    await db.exec("UPDATE public.cockpit_creative_source_state SET ready=true,row_count=0,source_snapshot_at='2026-10-04T00:00:00Z' WHERE table_name IN('campaigns','ads')");
    await db.query('INSERT INTO public.cockpit_ads(campaign_name,ad_name,meta_ad_id,spend,leads,still_url,raw_data) VALUES($1,$2,$3,100,10,$4,$5)', ['Alpha-Campaign', 'Office ad', '123', 'https://stills.invalid/saved.jpg', JSON.stringify({ _id: 'ad1', cpl: 10, stillTinyUrl: 'https://stills.invalid/tiny.jpg' })]);
    await db.query('INSERT INTO public.cockpit_ads(campaign_name,ad_name,spend,leads,raw_data) VALUES($1,$2,100,10,$3)', ['Beta-Campaign', 'Hidden ad', JSON.stringify({ _id: 'ad2', cpl: 10 })]);
    await db.exec("INSERT INTO public.cockpit_creative_sources(table_name,source_id,client_names,data,source_snapshot_at) SELECT 'campaigns',raw_data->>'_id',ARRAY[client_name],raw_data,'2026-10-04T00:00:00Z' FROM public.cockpit_campaigns");
    await db.exec("INSERT INTO public.cockpit_creative_sources(table_name,source_id,client_names,data,source_snapshot_at) SELECT 'ads',raw_data->>'_id',ARRAY[split_part(campaign_name,'-',1)],raw_data,'2026-10-04T00:00:00Z' FROM public.cockpit_ads");
    await db.exec("UPDATE public.cockpit_creative_source_state f SET row_count=(SELECT count(*) FROM public.cockpit_creative_sources s WHERE s.table_name=f.table_name) WHERE table_name IN('campaigns','ads')");
    const result = await winners({ serviceType: 'Offices' }, client);
    expect(result.sameLine.map(item => item.adName)).toEqual(['Office ad']);
    expect(result.sameLine[0].stillUrl).toBe('https://stills.invalid/saved.jpg'); expect(result.rest).toEqual([]);
    // Same campaign name is not an ownership key. A Beta creative must never be relabelled Alpha.
    await owner(db);
    await db.exec("UPDATE public.cockpit_campaigns SET raw_data=jsonb_set(raw_data,'{campaignName}','\"Alpha-Campaign\"') WHERE client_name='Beta'");
    await db.exec("UPDATE public.cockpit_ads SET campaign_name='Alpha-Campaign' WHERE raw_data->>'_id'='ad2'");
    await expect(winners({ serviceType: 'Offices' }, client)).rejects.toThrow('mapping');
    // Even after the name ambiguity is removed, a conflicting ad-owner source is not silently skipped.
    await owner(db);
    await db.exec("UPDATE public.cockpit_campaigns SET raw_data=jsonb_set(raw_data,'{campaignName}','\"Beta-Campaign\"') WHERE client_name='Beta'");
    await expect(winners({ serviceType: 'Offices' }, client)).rejects.toThrow('mapping');
  });
  test('winner catalog joins refreshed native mirrors to verified owners by unique Meta IDs', async () => {
    await owner(db);
    await db.exec("UPDATE public.cockpit_creative_source_state SET ready=true,row_count=0,source_snapshot_at='2026-10-04T00:00:00Z' WHERE table_name IN('campaigns','ads')");
    await db.exec("UPDATE public.cockpit_campaigns SET meta_campaign_id='555',raw_data=jsonb_set(jsonb_set(raw_data,'{_id}','\"native:campaigns:alpha\"'),'{syncedAt}','123') WHERE client_name='Alpha'");
    await db.query('INSERT INTO public.cockpit_ads(campaign_name,ad_name,meta_ad_id,spend,leads,raw_data) VALUES($1,$2,$3,100,10,$4)', ['Alpha-Campaign', 'Native ad', '777', JSON.stringify({ _id: 'native:ads:alpha', cpl: 10, syncedAt: 123 })]);
    await db.exec("INSERT INTO public.cockpit_creative_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('campaigns','legacy-campaign',ARRAY['Alpha'],'{\"_id\":\"legacy-campaign\",\"metaCampaignId\":\"555\",\"metaAccountId\":\"123\",\"syncedAt\":123,\"campaignName\":\"Alpha-Campaign\"}','2026-10-04T00:00:00Z'),('ads','legacy-ad',ARRAY['Alpha'],'{\"_id\":\"legacy-ad\",\"metaAdId\":\"777\",\"syncedAt\":123,\"campaignName\":\"Alpha-Campaign\"}','2026-10-04T00:00:00Z')");
    await db.exec("UPDATE public.cockpit_creative_source_state f SET row_count=(SELECT count(*) FROM public.cockpit_creative_sources s WHERE s.table_name=f.table_name) WHERE table_name IN('campaigns','ads')");
    const client = await browserDatabase(db);
    expect((await winners({ serviceType: 'Offices' }, client)).sameLine.map(item => item.adName)).toEqual(['Native ad']);
    await owner(db);
    await db.exec("UPDATE public.cockpit_creative_sources SET data=jsonb_set(data,'{syncedAt}','999') WHERE source_id='legacy-ad'");
    await expect(winners({ serviceType: 'Offices' }, client)).rejects.toThrow('mapping');
    await owner(db);
    await db.exec("UPDATE public.cockpit_creative_sources SET data=jsonb_set(data,'{syncedAt}','123') WHERE source_id='legacy-ad'");
    await db.exec("UPDATE public.cockpit_creative_sources SET source_snapshot_at='2026-10-05T00:00:00Z' WHERE table_name='ads'");
    await db.exec("UPDATE public.cockpit_creative_source_state SET source_snapshot_at='2026-10-05T00:00:00Z' WHERE table_name='ads'");
    await expect(winners({ serviceType: 'Offices' }, client)).rejects.toThrow('snapshots differ');
    await owner(db);
    await db.exec("UPDATE public.cockpit_creative_sources SET source_snapshot_at='2026-10-04T00:00:00Z' WHERE table_name='ads'");
    await db.exec("UPDATE public.cockpit_creative_source_state SET source_snapshot_at='2026-10-04T00:00:00Z' WHERE table_name='ads'");
    // A matching legacy row ID must not override a contradictory stable Meta ID.
    await owner(db);
    await db.exec("UPDATE public.cockpit_creative_sources SET source_id='native:ads:alpha',data=jsonb_set(jsonb_set(data,'{_id}','\"native:ads:alpha\"'),'{metaAdId}','\"wrong-ad\"') WHERE source_id='legacy-ad'");
    await expect(winners({ serviceType: 'Offices' }, client)).rejects.toThrow('mapping');
    await owner(db);
    await db.exec("UPDATE public.cockpit_creative_sources SET source_id='legacy-ad',data=jsonb_set(jsonb_set(data,'{_id}','\"legacy-ad\"'),'{metaAdId}','\"777\"') WHERE source_id='native:ads:alpha'");
    await db.exec("UPDATE public.cockpit_creative_sources SET source_id='native:campaigns:alpha',data=jsonb_set(jsonb_set(data,'{_id}','\"native:campaigns:alpha\"'),'{metaCampaignId}','\"wrong-campaign\"') WHERE source_id='legacy-campaign'");
    await expect(winners({ serviceType: 'Offices' }, client)).rejects.toThrow('mapping');
    await owner(db);
    await db.exec("UPDATE public.cockpit_creative_sources SET source_id='legacy-campaign',data=jsonb_set(jsonb_set(data,'{_id}','\"legacy-campaign\"'),'{metaCampaignId}','\"555\"') WHERE source_id='native:campaigns:alpha'");
    await db.exec("UPDATE public.cockpit_creative_sources SET data=jsonb_set(data,'{metaAccountId}','\"act_wrong\"') WHERE source_id='legacy-campaign'");
    await expect(winners({ serviceType: 'Offices' }, client)).rejects.toThrow('mapping');
    await owner(db);
    await db.exec("UPDATE public.cockpit_creative_sources SET data=data - 'metaAccountId' WHERE source_id='legacy-campaign'");
    await db.exec("UPDATE public.cockpit_creative_sources SET client_names=ARRAY['Beta'] WHERE source_id='legacy-ad'");
    await expect(winners({ serviceType: 'Offices' }, client)).rejects.toThrow('mapping');
    await owner(db);
    await db.exec("UPDATE public.cockpit_creative_sources SET client_names=ARRAY['Alpha'] WHERE source_id='legacy-ad'");
    await db.exec("INSERT INTO public.cockpit_creative_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES('ads','second-legacy-ad',ARRAY['Alpha'],'{\"_id\":\"second-legacy-ad\",\"metaAdId\":\"777\"}','2026-10-04T00:00:00Z')");
    await db.exec("UPDATE public.cockpit_creative_source_state SET row_count=2 WHERE table_name='ads'");
    await expect(winners({ serviceType: 'Offices' }, client)).rejects.toThrow('mapping');
  });
});
