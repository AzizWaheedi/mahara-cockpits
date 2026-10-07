type Row = Record<string, unknown>;
type ProviderHealth = (row: Row) => Promise<void>;
export type WorkspaceUser = { name: string; email: string; suspended: boolean; title: string | null };
const DIRECTORY_URL = 'https://admin.googleapis.com/admin/directory/v1/users';
const DIRECTORY_RESOURCE = 'admin.googleapis.com/admin/directory/v1/users';
const MAX_PAGES = 10;

function isObject(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function readDirectoryPages(
  token: string,
  health: ProviderHealth,
  request: typeof fetch = fetch,
): Promise<WorkspaceUser[]> {
  if (!token) throw new Error('Google Workspace directory authentication was not confirmed.');
  const users: WorkspaceUser[] = [];
  const emails = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(DIRECTORY_URL);
    url.searchParams.set('customer', 'my_customer');
    url.searchParams.set('maxResults', '200');
    url.searchParams.set('orderBy', 'email');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const receipt = { provider: 'google-directory', method: 'GET', resource: DIRECTORY_RESOURCE };
    await health({ ...receipt, phase: 'intent' });
    let response: Response;
    try {
      response = await request(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(25000) });
    } catch {
      await health({ ...receipt, phase: 'unknown' });
      throw new Error('Google Workspace directory read was not confirmed. Check its provider receipt before retrying.');
    }
    await health({ ...receipt, phase: 'response', http_status: response.status });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`Google Workspace returned an unreadable directory response (${response.status}).`);
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(`Google Workspace denied directory access (${response.status}). Authorize admin.directory.user.readonly domain-wide delegation for the configured service-account subject.`);
      }
      throw new Error(`Google Workspace directory read failed (${response.status}). Check the provider receipt.`);
    }
    if (!isObject(payload)) throw new Error('Google Workspace returned an invalid directory response.');
    if (payload.users !== undefined && !Array.isArray(payload.users)) throw new Error('Google Workspace returned an invalid users list.');
    const rawUsers: unknown[] = Array.isArray(payload.users) ? payload.users : [];
    for (const value of rawUsers) {
      if (!isObject(value)) throw new Error('Google Workspace returned an invalid user row.');
      const email = typeof value.primaryEmail === 'string' ? value.primaryEmail.trim() : '';
      if (!email || !/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error('Google Workspace returned a user without a valid primary email.');
      const normalized = normalizeEmail(email);
      if (emails.has(normalized)) throw new Error('Google Workspace returned a duplicate normalized email; no partial directory was accepted.');
      emails.add(normalized);
      const nameRow = isObject(value.name) ? value.name : null;
      const name = typeof nameRow?.fullName === 'string' && nameRow.fullName.trim() ? nameRow.fullName.trim() : email;
      const organizations = Array.isArray(value.organizations) ? value.organizations : [];
      const firstOrganization = organizations[0];
      const title = isObject(firstOrganization) && typeof firstOrganization.title === 'string' && firstOrganization.title.trim()
        ? firstOrganization.title.trim()
        : null;
      if (value.suspended !== undefined && typeof value.suspended !== 'boolean') throw new Error('Google Workspace returned an invalid account status.');
      users.push({ name, email, suspended: value.suspended === true, title });
    }
    const next = payload.nextPageToken;
    if (next === undefined || next === null || next === '') return users;
    if (typeof next !== 'string') throw new Error('Google Workspace returned an invalid directory page token.');
    if (page === MAX_PAGES - 1) throw new Error('Google Workspace directory exceeds the safe page limit; no partial import was accepted.');
    pageToken = next;
  }
  throw new Error('Google Workspace directory was not fully confirmed.');
}

export async function workspaceSourceHash(users: WorkspaceUser[], emails: string[] = []): Promise<string> {
  const canonicalUsers = users
    .map(user => [normalizeEmail(user.email), user.name.trim(), user.suspended, user.title?.trim() ?? null])
    .sort((left, right) => String(left[0]) < String(right[0]) ? -1 : String(left[0]) > String(right[0]) ? 1 : 0);
  const canonicalEmails = [...new Set(emails.map(normalizeEmail).filter(Boolean))].sort();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ users: canonicalUsers, emails: canonicalEmails })));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
