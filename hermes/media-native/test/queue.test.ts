import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { MediaNativeWorker } from '../worker';
import { replyId, row } from '../tools';
import { actor, BUYER, OTHER, WRONG_ROLE, UNCONFIRMED, FOUNDER, call, claim, database, enqueue, owner, sdk, type Database } from './database';

let db: Database;
let opened = false;
beforeEach(async () => { opened = false; db = await database(); opened = true; });
afterEach(async () => { if (opened) { opened = false; await db.close(); } });
const intent = (job: Record<string, unknown>, key = 'complete') => ({ p_job_id: job.id, p_token: job.claim_token, p_provider: 'slack', p_intent_hash: key });
const receipt = { messageTs: '1728000000.000001', channel: 'D123' };
async function status(id: string) {
  await owner(db);
  return (await db.query<{ state: string; data: Record<string, unknown> }>('SELECT j.state,r.data FROM public.cockpit_media_native_jobs j JOIN public.cockpit_media_native_records r ON r.id=j.record_id WHERE j.id=$1', [id])).rows[0];
}

describe('canonical native SQL authority and state transitions', () => {
  test('anonymous, unconfirmed, wrong role and unrelated client cannot enqueue or claim', async () => {
    for (const id of [null, WRONG_ROLE, UNCONFIRMED, OTHER]) {
      await actor(db, id);
      await expect(call(db, 'cockpit_media_native_write', { p_operation: 'chat.ask', p_args: { campaignId: 'Alpha-Campaign', campaignName: 'Alpha-Campaign', client: 'Alpha', text: 'Question' }, p_request_id: crypto.randomUUID(), p_apply: true })).rejects.toThrow();
      await expect(call(db, 'cockpit_media_native_claim', { p_apply: true })).rejects.toThrow();
    }
    await actor(db, BUYER);
    await expect(db.query('SELECT * FROM public.cockpit_media_native_receipts')).rejects.toThrow();
    await expect(call(db, 'cockpit_media_native_thread_claim')).rejects.toThrow();
    await actor(db, FOUNDER);
    const result = row(await call(db, 'cockpit_media_native_write', { p_operation: 'chat.ask', p_args: { campaignId: 'Beta-Campaign', campaignName: 'Beta-Campaign', client: 'Beta', text: 'Founder review' }, p_request_id: crypto.randomUUID(), p_apply: true }));
    expect(result.ok).toBe(true);
  });
  test('explicit apply, stable request ID and atomic claim preserve one job', async () => {
    await actor(db, BUYER); const id = crypto.randomUUID(); const args = { p_operation: 'chat.ask', p_args: { campaignId: 'Alpha-Campaign', campaignName: 'Alpha-Campaign', client: 'Alpha', text: 'Question' }, p_request_id: id };
    expect(row(await call(db, 'cockpit_media_native_write', args)).dryRun).toBe(true);
    await call(db, 'cockpit_media_native_write', { ...args, p_apply: true });
    await call(db, 'cockpit_media_native_write', { ...args, p_apply: true });
    const first = await claim(db);
    expect(first.job.id).toBe(id);
    expect(await call(db, 'cockpit_media_native_claim', { p_apply: true })).toBeNull();
    await expect(call(db, 'cockpit_media_native_worker_context', { p_id: id, p_token: crypto.randomUUID() })).rejects.toThrow();
    await owner(db);
    expect((await db.query<{ count: number }>('SELECT count(*)::int count FROM public.cockpit_media_native_jobs')).rows[0].count).toBe(1);
  });
  test('repeated pending intent is not a receipt and cannot produce sent or ready', async () => {
    const id = await enqueue(db); const { job } = await claim(db);
    expect(row(await call(db, 'cockpit_media_native_record_intent', intent(job))).state).toBe('new');
    expect(row(await call(db, 'cockpit_media_native_record_intent', intent(job))).state).toBe('pending');
    await expect(call(db, 'cockpit_media_native_finish', { p_id: id, p_token: job.claim_token, p_result: { delivered: true }, p_state: 'ready' })).rejects.toThrow();
    expect((await status(id)).state).toBe('working');
    expect((await db.query<{ count: number }>("SELECT count(*)::int count FROM public.cockpit_media_native_receipts WHERE stage='receipt'")).rows[0].count).toBe(0);
  });
  test('confirmed receipt allows fenced finish and creates an ongoing reply stream', async () => {
    const id = await enqueue(db); const { job } = await claim(db);
    await call(db, 'cockpit_media_native_record_intent', intent(job));
    await call(db, 'cockpit_media_native_record_receipt', { ...intent(job), p_response: receipt });
    const confirmed = row(await call(db, 'cockpit_media_native_record_intent', intent(job)));
    expect(confirmed).toEqual({ state: 'confirmed', response: receipt });
    await call(db, 'cockpit_media_native_finish', { p_id: id, p_token: job.claim_token, p_result: { slackMessageTs: receipt.messageTs, slackChannel: receipt.channel }, p_state: 'ready' });
    expect((await status(id)).data.status).toBe('sent');
    await db.exec('SET ROLE service_role');
    const thread = row(await call(db, 'cockpit_media_native_thread_claim'));
    const args = { p_id: id, p_token: thread.claim_token, p_message_id: replyId(receipt.channel, '1728000001.000001'), p_text: 'Reviewed by a human', p_author: 'U123' };
    await call(db, 'cockpit_media_native_thread_reply', args); await call(db, 'cockpit_media_native_thread_reply', args);
    await call(db, 'cockpit_media_native_thread_finish', { p_id: id, p_token: thread.claim_token, p_cursor: 'next' });
    await owner(db);
    expect((await db.query<{ count: number }>("SELECT count(*)::int count FROM public.cockpit_media_native_records WHERE data->>'kind'='reply'")).rows[0].count).toBe(1);
    expect((await status(id)).data.pending).toBe(false);
    expect((await db.query<{ count: number }>("SELECT count(*)::int count FROM public.cockpit_audit_log WHERE entity_type='cockpit_media_native_receipts'")).rows[0].count).toBe(2);
  });
  test('revocation after intent blocks receipt and finish without preventing failure health', async () => {
    const id = await enqueue(db); const { job } = await claim(db);
    await call(db, 'cockpit_media_native_record_intent', intent(job));
    await owner(db); await db.query('UPDATE public.cockpit_members SET active=false WHERE auth_user_id=$1', [BUYER]); await db.exec('SET ROLE service_role');
    await expect(call(db, 'cockpit_media_native_record_receipt', { ...intent(job), p_response: receipt })).rejects.toThrow();
    await expect(call(db, 'cockpit_media_native_finish', { p_id: id, p_token: job.claim_token, p_result: {}, p_state: 'ready' })).rejects.toThrow();
    await call(db, 'cockpit_media_native_health', { p_job_id: id, p_token: job.claim_token, p_provider: 'slack', p_operation: 'delivery', p_ok: false, p_detail: { code: 'revoked' } });
    await call(db, 'cockpit_media_native_record_failure', { ...intent(job), p_error: 'Reconcile the provider receipt.', p_reconcile: true });
    expect((await status(id)).state).toBe('reconcile');
  });
  test('client mapping, role and confirmation changes invalidate the current fence', async () => {
    const id = await enqueue(db); const { job } = await claim(db);
    await call(db, 'cockpit_media_native_guard', { p_job_id: id, p_token: job.claim_token });
    for (const mutation of [
      "UPDATE public.cockpit_members SET clients=ARRAY['Beta'] WHERE email='buyer@example.com'",
      "UPDATE public.cockpit_members SET roles=ARRAY['sales'] WHERE email='buyer@example.com'",
      "UPDATE auth.users SET email_confirmed_at=NULL WHERE email='buyer@example.com'",
      "UPDATE public.cockpit_campaigns SET raw_data=raw_data||'{\"clientName\":\"Beta\"}' WHERE client_name='Alpha'",
      "UPDATE public.cockpit_campaigns SET meta_account_id='act_999' WHERE client_name='Alpha'",
    ]) {
      await owner(db); await db.exec('BEGIN'); await db.exec(mutation); await db.exec('SET ROLE service_role');
      await expect(call(db, 'cockpit_media_native_guard', { p_job_id: id, p_token: job.claim_token })).rejects.toThrow();
      await db.exec('ROLLBACK');
    }
  });
  test('expired claims enter reconciliation and are never requeued or completed', async () => {
    const id = await enqueue(db); const { job } = await claim(db);
    await call(db, 'cockpit_media_native_record_intent', intent(job));
    await owner(db); await db.query("UPDATE public.cockpit_media_native_jobs SET claimed_at=now()-interval '31 minutes' WHERE id=$1", [id]); await db.exec('SET ROLE service_role');
    await expect(call(db, 'cockpit_media_native_record_receipt', { ...intent(job), p_response: receipt })).rejects.toThrow();
    expect(await call(db, 'cockpit_media_native_claim', { p_apply: true })).toBeNull();
    expect((await status(id)).state).toBe('reconcile');
    await db.exec('SET ROLE service_role'); expect(await call(db, 'cockpit_media_native_claim', { p_apply: true })).toBeNull();
  });
  test('calendar ownership revocation is rechecked after claim', async () => {
    await owner(db); await db.query("INSERT INTO public.cockpit_media_calendar_owners(actor_id,calendar_id,verified_by) VALUES($1,'personal@example.com','reviewed-admin')", [BUYER]);
    const id = await enqueue(db, 'personalCalendars.link', { calendarId: 'personal@example.com', bindingRevision: 0 }); const { job } = await claim(db);
    await call(db, 'cockpit_media_native_guard', { p_job_id: id, p_token: job.claim_token });
    await owner(db); await db.exec('DELETE FROM public.cockpit_media_calendar_owners'); await db.exec('SET ROLE service_role');
    await expect(call(db, 'cockpit_media_native_guard', { p_job_id: id, p_token: job.claim_token })).rejects.toThrow();
  });
  test('runtime uncertainty sends once, persists health and a second applied run never resends', async () => {
    const id = await enqueue(db); let posts = 0;
    const original = process.env.SLACK_BOT_TOKEN; process.env.SLACK_BOT_TOKEN = 'offline-fixture';
    try {
      const worker = new MediaNativeWorker({ apply: true, once: true, supabaseClient: sdk(db), fetchImpl: async input => {
        if (!String(input).includes('chat.postMessage')) throw new Error('Unexpected provider'); posts++; throw new Error('connection lost after send');
      } });
      await worker.run();
      expect((await status(id)).state).toBe('reconcile');
      await db.exec('SET ROLE service_role'); await worker.run();
      expect(posts).toBe(1);
      await owner(db);
      expect((await db.query<{ count: number }>('SELECT count(*)::int count FROM public.cockpit_media_native_health WHERE NOT ok')).rows[0].count).toBeGreaterThan(0);
    } finally { if (original === undefined) delete process.env.SLACK_BOT_TOKEN; else process.env.SLACK_BOT_TOKEN = original; }
  });
  test('runtime sees a repeated canonical pending intent and never calls Slack or marks sent', async () => {
    const id = await enqueue(db); let posts = 0;
    const client = sdk(db, async (name, value) => {
      if (name === 'cockpit_media_native_claim' && value !== null) {
        const job = row(row(value).job);
        await call(db, 'cockpit_media_native_record_intent', intent(job));
      }
    });
    await new MediaNativeWorker({ apply: true, once: true, supabaseClient: client, fetchImpl: async () => { posts++; throw new Error('No post was allowed'); } }).run();
    expect(posts).toBe(0);
    expect((await status(id)).state).toBe('reconcile');
    expect((await status(id)).data.status).not.toBe('sent');
  });
  test('runtime consumes a confirmed canonical receipt without repeating the POST', async () => {
    const id = await enqueue(db); let posts = 0;
    const client = sdk(db, async (name, value) => {
      if (name === 'cockpit_media_native_claim' && value !== null) {
        const job = row(row(value).job);
        await call(db, 'cockpit_media_native_record_intent', intent(job));
        await call(db, 'cockpit_media_native_record_receipt', { ...intent(job), p_response: receipt });
        await owner(db);
        await db.exec("UPDATE public.cockpit_media_native_threads SET checked_at=now()");
        await db.exec('SET ROLE service_role');
      }
    });
    const result = await new MediaNativeWorker({ apply: true, once: true, supabaseClient: client, fetchImpl: async () => { posts++; throw new Error('No post was allowed'); } }).run();
    expect(posts).toBe(0); expect(result.processed).toBe(1);
    expect((await status(id)).data.status).toBe('sent');
  });
  test('a revoked queued owner is skipped and a known failed job never claims again', async () => {
    const revokedId = await enqueue(db);
    await owner(db); await db.query('UPDATE public.cockpit_members SET active=false WHERE auth_user_id=$1', [BUYER]);
    await db.exec('SET ROLE service_role');
    expect(await call(db, 'cockpit_media_native_claim', { p_apply: true })).toEqual({ skipped: true });
    expect((await status(revokedId)).state).toBe('failed');
    await db.query('UPDATE public.cockpit_members SET active=true WHERE auth_user_id=$1', [BUYER]);
    const failedId = await enqueue(db); const { job } = await claim(db);
    await call(db, 'cockpit_media_native_finish', { p_id: failedId, p_token: job.claim_token, p_result: { error: 'Source validation failed before any provider call.' }, p_state: 'failed' });
    expect((await status(failedId)).data.status).toBe('failed');
    await db.exec('SET ROLE service_role');
    expect(await call(db, 'cockpit_media_native_claim', { p_apply: true })).toBeNull();
  });
  test('default runtime dry run has no claims, audit writes or provider traffic', async () => {
    const id = await enqueue(db);
    await owner(db); const before = (await db.query<{ count: number }>('SELECT count(*)::int count FROM public.cockpit_audit_log')).rows[0].count; await db.exec('SET ROLE service_role');
    const result = await new MediaNativeWorker({ apply: false, supabaseClient: sdk(db), fetchImpl: async () => { throw new Error('Dry run attempted network'); } }).run();
    expect(result.processed).toBe(0); expect(result.dryRun).toBe(true);
    expect((await status(id)).state).toBe('queued');
    expect((await db.query<{ count: number }>('SELECT count(*)::int count FROM public.cockpit_audit_log')).rows[0].count).toBe(before);
  });
});
