import type { SupabaseClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
import { workerClient } from './worker';
import { row, safeError, str } from './tools';

export async function runMediaNativeDoctor(options: { supabaseClient?: SupabaseClient } = {}) {
  const checks: { name: string; ok: boolean; message: string }[] = [];
  let client: SupabaseClient;
  try { client = options.supabaseClient ?? workerClient(); }
  catch { return { healthy: false, checks: [{ name: 'database', ok: false, message: 'Configure Creative Triage SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.' }] }; }
  let serviceEmail: string | undefined;
  try {
    const { data, error } = await client.rpc('cockpit_media_native_claim', { p_apply: false });
    if (error || !data || data.dryRun !== true || typeof data.queued !== 'number') throw new Error('Invalid queue inspection');
    checks.push({ name: 'queue_read', ok: true, message: `${data.queued} queued jobs. This read did not claim them.` });
    for (const state of ['working', 'reconcile', 'failed']) {
      const result = await client.from('cockpit_media_native_jobs').select('id', { count: 'exact', head: true }).eq('state', state);
      if (result.error || result.count === null) checks.push({ name: `queue_${state}`, ok: false, message: 'Queue count unavailable; missing is not zero.' });
      else checks.push({ name: `queue_${state}`, ok: state === 'working' || result.count === 0, message: `${result.count} ${state} jobs.` });
    }
    const config = await client.from('cockpit_media_calendar_config').select('service_account_email').single();
    if (config.error) throw new Error('Missing calendar config');
    serviceEmail = str(row(config.data).service_account_email);
    checks.push({ name: 'calendar_identity', ok: true, message: `Configured service account: ${serviceEmail}. Sharing must still be verified by an applied read.` });
    for (const table of ['cockpit_media_native_receipts', 'cockpit_media_native_health', 'cockpit_media_native_threads']) {
      const result = await client.from(table).select('id').limit(1);
      checks.push({ name: table, ok: !result.error, message: result.error ? 'The service role cannot read this contract table.' : 'Service-role read is available. This does not prove browser permissions.' });
    }
  } catch { checks.push({ name: 'database_contract', ok: false, message: 'Required database contracts are unavailable. Apply reviewed migrations and check service-role grants.' }); }
  for (const name of ['SLACK_BOT_TOKEN', 'META_SYSTEM_TOKEN']) checks.push({ name, ok: Boolean(process.env[name]), message: process.env[name] ? 'Named key is configured; no provider call was made.' : 'Named key is missing. The corresponding operation cannot run.' });
  const providerKeyMap: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    gemini: 'GOOGLE_AI_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY',
  };
  const activeOrder = (process.env.AI_JSON_PROVIDERS || 'anthropic,openai,gemini,deepseek')
    .split(',')
    .map(x => x.trim())
    .filter(name => Boolean(providerKeyMap[name]));
  const configuredModels = activeOrder.filter(provider => Boolean(process.env[providerKeyMap[provider]]));
  checks.push({
    name: 'ai_model_provider',
    ok: configuredModels.length > 0,
    message: configuredModels.length > 0
      ? `Supported copy model provider configured (${configuredModels.join(', ')}). Real provider permissions are unverified.`
      : activeOrder.length > 0
      ? `No configured model key in active provider order (${activeOrder.join(', ')}). Real provider permissions are unverified.`
      : 'No supported providers enabled in AI_JSON_PROVIDERS.',
  });
  try {
    const account = row(JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? 'null'));
    const matches = str(account.client_email) === serviceEmail && str(account.private_key).includes('BEGIN PRIVATE KEY');
    checks.push({ name: 'google_service_account', ok: matches, message: matches ? 'Key identity matches the database configuration. No token exchange or sharing check was made.' : 'Key identity differs from the database configuration.' });
  } catch { checks.push({ name: 'google_service_account', ok: false, message: 'Configure valid GOOGLE_SERVICE_ACCOUNT_JSON for the verified service-account identity.' }); }
  return { healthy: checks.every(check => check.ok), checks };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runMediaNativeDoctor().then(report => { console.log(JSON.stringify(report, null, 2)); if (!report.healthy) process.exitCode = 1; }).catch(error => { console.error(safeError(error)); process.exitCode = 1; });
