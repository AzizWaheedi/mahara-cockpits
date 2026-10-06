import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
import { fetchCalendarEvents, fetchGoogleAccessToken, fetchSlackThreadReplies, generateAssistDraft, health, list, loadCreatives, postSlackQuestion, providerTransport, recordDurableFailure, recordDurableIntent, recordDurableReceipt, replyId, row, rpc, safeError, slackReceipt, sourceRows, str, UncertainOutcome, type Effect, type Row, type SourceContext } from './tools';

export type WorkerOptions = { apply: boolean; once?: boolean; limit?: number; supabaseClient?: SupabaseClient; fetchImpl?: typeof fetch };
export function workerClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for Creative Triage.');
  if (new URL(url).hostname !== 'bldgtotkfmhoxmlzowdx.supabase.co') throw new Error('Native media writes belong to Creative Triage, not B2B.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export class MediaNativeWorker {
  private readonly client: SupabaseClient;
  private readonly limit: number;
  constructor(private readonly options: WorkerOptions) {
    this.client = options.supabaseClient ?? workerClient();
    this.limit = options.once ? 1 : options.limit ?? 20;
    if (!Number.isInteger(this.limit) || this.limit < 1 || this.limit > 50) throw new Error('Worker limit must be between 1 and 50.');
  }
  async run() {
    const summary = { processed: 0, replies: 0, dryRun: !this.options.apply, errors: [] as string[] };
    if (!this.options.apply) {
      const data = row(await rpc(this.client, 'cockpit_media_native_claim', { p_apply: false }));
      if (data.dryRun !== true || typeof data.queued !== 'number') throw new Error('The read-only queue inspection returned an invalid result.');
      return { ...summary, queued: data.queued };
    }
    const deadline = Date.now() + 20 * 60_000;
    for (let i = 0; i < this.limit && Date.now() < deadline; i++) {
      const value = await rpc(this.client, 'cockpit_media_native_claim', { p_apply: true });
      if (value === null) break;
      const claim = row(value); if (claim.skipped === true) continue;
      const job = row(claim.job); const id = str(job.id); const token = str(job.claim_token); const operation = str(job.operation);
      let provider = operation === 'chat.deliver' ? 'slack' : operation === 'calendar.refresh' ? 'google_calendar' : 'assist';
      try {
        const guard = async () => {
          if (Date.now() >= deadline) throw new UncertainOutcome('The bounded run ended. Reconcile durable receipts before continuing.');
          return row(await rpc(this.client, 'cockpit_media_native_guard', { p_job_id: id, p_token: token }));
        };
        const context = await guard(); const record = row(context.record); const request = row(record.data);
        const fetchImpl = providerTransport(this.client, id, token, guard, this.options.fetchImpl);
        const effect: Effect = async (name, key, action) => {
          provider = name;
          const intent = await recordDurableIntent(this.client, id, token, name, key);
          if (intent.state === 'confirmed') return intent.response;
          if (intent.state === 'pending') throw new UncertainOutcome('A pending provider intent has no confirmed receipt. Reconciliation is required; nothing was resent.');
          try {
            await guard();
            const result = await action();
            await recordDurableReceipt(this.client, id, token, name, key, result);
            return result;
          } catch (error) {
            // Once an intent exists, a throw cannot prove whether the provider accepted it.
            throw new UncertainOutcome(`${safeError(error)} The provider outcome requires reconciliation; no automatic duplicate will be sent.`);
          }
        };
        const sourceContext: SourceContext = { campaign: context.campaign === null ? null : row(context.campaign), sources: row(context.sources), serviceAccountEmail: typeof context.serviceAccountEmail === 'string' ? context.serviceAccountEmail : undefined };
        let result: Row;
        if (operation === 'chat.deliver') {
          const receipt = slackReceipt(await effect('slack', 'complete', () => postSlackQuestion({ text: str(request.text), authorName: typeof request.authorName === 'string' ? request.authorName : undefined, campaignName: str(record.campaign_name), client: str(record.client_name), context: JSON.stringify(request.context) }, { fetchImpl })));
          result = { deliveredAt: Number(receipt.messageTs) * 1000, slackMessageTs: receipt.messageTs, slackChannel: receipt.channel };
        } else if (operation === 'assist.run') {
          result = row(await effect('assist', 'complete', async () => {
            const kind = str(request.kind); const out: Row = {};
            if (kind !== 'copy' && kind !== 'creative' && kind !== 'launch') throw new Error('Unsupported assist kind');
            if (kind === 'creative' || (kind === 'launch' && Array.isArray(request.driveLinks) && request.driveLinks.length > 0)) {
              out.media = await loadCreatives(request, sourceContext, { fetchImpl, effect, persist: media => rpc(this.client, 'cockpit_media_native_progress', { p_job_id: id, p_token: token, p_result: { media } }).then(() => undefined) });
            }
            if (kind !== 'creative') Object.assign(out, await effect('anthropic', 'copy', () => generateAssistDraft(request, sourceContext, { fetchImpl })));
            if (kind === 'creative') out.note = 'The requested assets are in the verified Meta creative library. No ad was created or published.';
            if (kind === 'launch') {
              const onboarding = sourceRows(sourceContext, 'onboardings')[0]; const watch = sourceRows(sourceContext, 'launchWatch')[0];
              const account = onboarding?.accountId || watch?.accountId;
              out.steps = [
                { label: 'Meta ad account', state: account ? 'done' : 'blocked', detail: account ? `Account ${account}` : 'No account in the verified client source.' },
                { label: 'Onboarding task in ClickUp', state: watch?.hasTask || onboarding?.taskId ? 'done' : 'blocked' },
                { label: 'Creatives', state: out.media ? 'done' : 'waiting', detail: out.media ? 'Assets imported into the library.' : 'Paste shared Drive links to import assets.' },
                { label: 'Ad copy written', state: 'done', detail: 'Five draft options below.' },
                { label: 'Campaign name', state: 'waiting', detail: `Use ${str(request.client)}-Mahara-1 unless you want something else.` },
                { label: 'Build the campaign', state: 'waiting', detail: 'Review the draft and open the builder. Nothing has been published.' },
              ];
              if (Array.isArray(watch?.issues)) for (const issue of watch.issues) (out.steps as Row[]).push({ label: str(issue), state: 'blocked' });
            }
            return { ...out, completedAt: Date.now() };
          }));
        } else if (operation === 'calendar.refresh') {
          result = row(await effect('google_calendar', 'complete', async () => {
            const now = Date.now(); const windowStart = now - 7 * 86400000; const windowEnd = now + 21 * 86400000;
            const accessToken = await fetchGoogleAccessToken('calendar', sourceContext.serviceAccountEmail ?? '', { fetchImpl });
            const calendarEvents = await fetchCalendarEvents(str(request.calendarId), accessToken, { fetchImpl, timeMin: windowStart, timeMax: windowEnd, owner: str(context.ownerEmail), clientNames: list(context.clients).map(str) });
            return { calendarEvents, windowStart, windowEnd, checkedAt: Date.now(), events: calendarEvents.length, note: null };
          }));
        } else throw new Error('Unsupported native job');
        await guard();
        await rpc(this.client, 'cockpit_media_native_finish', { p_id: id, p_token: token, p_result: result, p_state: 'ready' });
        summary.processed++;
      } catch (error) {
        const message = safeError(error); summary.errors.push(message);
        await health(this.client, id, token, provider, operation, false, { code: error instanceof UncertainOutcome ? 'reconciliation_required' : 'handler_failed' });
        try { await recordDurableFailure(this.client, id, token, provider, 'complete', error, error instanceof UncertainOutcome); }
        catch { summary.errors.push('The fenced failure update was rejected. Leave the job for lease-expiry reconciliation.'); }
      }
    }
    // Poll ongoing threads on every applied run, not just immediately after a new send.
    for (let i = 0; i < this.limit && Date.now() < deadline; i++) {
      const value = await rpc(this.client, 'cockpit_media_native_thread_claim'); if (value === null) break;
      const thread = row(value); const id = str(thread.id); const token = str(thread.claim_token);
      try {
        const guard = () => rpc(this.client, 'cockpit_media_native_thread_context', { p_id: id, p_token: token });
        const fetchImpl = providerTransport(this.client, null, null, guard, this.options.fetchImpl);
        const page = await fetchSlackThreadReplies(str(thread.channel), str(thread.thread_ts), { fetchImpl, cursor: typeof thread.cursor === 'string' ? thread.cursor : '' });
        for (const reply of page.replies) {
          await rpc(this.client, 'cockpit_media_native_thread_reply', { p_id: id, p_token: token, p_message_id: replyId(str(thread.channel), reply.ts), p_text: reply.text, p_author: reply.author }); summary.replies++;
        }
        await rpc(this.client, 'cockpit_media_native_thread_finish', { p_id: id, p_token: token, p_cursor: page.cursor });
      } catch (error) {
        await health(this.client, null, null, 'slack', 'reply_poll', false, { code: 'reply_poll_failed' });
        summary.errors.push(safeError(error));
      }
    }
    return summary;
  }
}
async function main() {
  const args = process.argv.slice(2); const apply = args.includes('--apply');
  if (apply && process.env.MEDIA_NATIVE_FLOCK !== '1') throw new Error('Use hermes/media-native/run.sh for applied processing under flock.');
  const limitAt = args.indexOf('--limit');
  const worker = new MediaNativeWorker({ apply, once: args.includes('--once'), limit: limitAt >= 0 ? Number(args[limitAt + 1]) : undefined });
  const result = await worker.run(); console.log(JSON.stringify(result)); if (result.errors.length) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(safeError(error)); process.exitCode = 1; });
