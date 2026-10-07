/** Server-only monitoring calls. Ledger failures must never disable the outside alert path. */
const SUPABASE_URL = 'https://bldgtotkfmhoxmlzowdx.supabase.co';
export function serviceConfig() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url === SUPABASE_URL && key ? {url, key} : null;
}
type Receipt = {resource: string; method: string; ok: boolean; http_status: number | null};
async function receipt(row: Receipt) {
  // The ledger's own transport is not recursively logged. A database outage is
  // exactly when Slack must still work; stderr is the independent fallback.
  const config = serviceConfig();
  if (!config) {console.error('watchdog ledger unavailable: missing service configuration'); return;}
  try {
    const response = await fetch(`${config.url}/rest/v1/cockpit_monitor_receipts`, {
      method: 'POST', headers: {apikey: config.key, Authorization: `Bearer ${config.key}`, 'Content-Type': 'application/json'},
      body: JSON.stringify(row), signal: AbortSignal.timeout(3000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch {
    console.error(`watchdog ledger unavailable; receipt ${JSON.stringify(row)}`);
  }
}
export async function monitoredFetch(urlText: string, init: RequestInit, options: {dry: boolean; expected: number[]}) {
  const url = new URL(urlText);
  if (url.protocol !== 'https:' || !['slack.com', new URL(SUPABASE_URL).hostname].includes(url.hostname))
    throw new Error('Unapproved monitoring host');
  const row: Receipt = {resource: `${url.hostname}${url.pathname}`, method: init.method ?? 'GET', ok: false, http_status: null};
  try {
    const response = await fetch(urlText, {...init, redirect: 'error'});
    row.http_status = response.status; row.ok = options.expected.includes(response.status);
    if (url.hostname === 'slack.com' && row.ok) {
      const body: unknown = await response.clone().json().catch(() => null);
      row.ok = typeof body === 'object' && body !== null && 'ok' in body && body.ok === true;
    }
    return response;
  } finally {
    if (!options.dry) await receipt(row);
  }
}
