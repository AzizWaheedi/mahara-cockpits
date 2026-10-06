import type { SupabaseClient } from '@supabase/supabase-js';
import { getCockpitSupabaseClient } from '../auth/SupabaseAuthProvider';
import { campaignResults, creativeLaunchResult, trackingGroups, parseRows, object, number, type ChangeSource } from './mediaNativeModels';
import { kuwaitDay, shiftDay } from './changeResultsCore';
import { calendarMine, calendarWrite } from './nativeCalendarClient';

export const MEDIA_NATIVE_READS: Readonly<Record<string, true>> = {
  'market.forClient': true, 'tracking.issues': true, 'changeResults.forCampaign': true,
  'changeResults.forCreativeLaunch': true, 'chat.thread': true, 'chat.activity': true,
  'assist.get': true, 'assist.queueDepth': true, 'personalCalendars.mine': true,
  'cockpit.onboardings': true, 'cockpit.launchWatch': true, 'cockpit.winners': true,
};
export const MEDIA_NATIVE_WRITES: Readonly<Record<string, true>> = {
  'chat.ask': true, 'assist.enqueue': true, 'personalCalendars.link': true,
  'personalCalendars.unlink': true, 'cockpit.logManualChange': true,
};
export const isMediaNativeRead = (endpoint: string): boolean => Object.hasOwn(MEDIA_NATIVE_READS, endpoint);
export const isMediaNativeWrite = (endpoint: string): boolean => Object.hasOwn(MEDIA_NATIVE_WRITES, endpoint);
type Args = Record<string, unknown>;
const required = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`The ${field} is missing or invalid.`);
  return value;
};
const strings = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error(`The ${field} list is missing or invalid.`);
  return value;
};
const optionalString = (value: unknown, field: string): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error(`The ${field} is invalid.`);
  return value;
};
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
type PendingIntent = { id: string; args: Args };
const pending = new Map<string, Promise<PendingIntent>>();

async function accountGuard(client: SupabaseClient) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error('Sign in again before using the media cockpit.');
  const id = data.user.id;
  let changed = false;
  const subscription = client.auth.onAuthStateChange((_event, session) => { if (session?.user.id !== id) changed = true; }).data.subscription;
  return {
    id,
    check: async () => {
      const { data: current, error: sessionError } = await client.auth.getSession();
      if (changed || sessionError || current.session?.user.id !== id) throw new Error('The signed-in account changed. This response was discarded; reload the view.');
    },
    release: () => subscription.unsubscribe(),
  };
}
async function rpcRead(client: SupabaseClient, name: string, args: Args): Promise<unknown> {
  const guard = await accountGuard(client);
  try {
    await guard.check();
    const { data, error } = await client.rpc(name, args);
    await guard.check();
    if (error) throw new Error(error.message);
    return data;
  } finally { guard.release(); }
}
export async function mediaNativeRead(operation: string, args: Args = {}, client: SupabaseClient = getCockpitSupabaseClient()): Promise<unknown> {
  if (operation === 'personalCalendars.mine') return calendarMine(client, 'media-buyer');
  const extended = operation === 'cockpit.onboardings' || operation === 'cockpit.launchWatch' || operation === 'cockpit.winners';
  const data = await rpcRead(client, extended ? 'cockpit_media_native_catalog_read' : 'cockpit_media_native_read', { p_operation: operation, p_args: args });
  if (data === null && operation === 'assist.get') return null;
  if (data === null || data === undefined) throw new Error(`The ${operation} source returned no result.`);
  return data;
}
export type WriteOptions = { apply?: boolean; requestId?: string; bindingRevision?: number };
export async function mediaNativeWrite(operation: string, args: Args, options: WriteOptions = {}, client: SupabaseClient = getCockpitSupabaseClient()): Promise<{ ok: boolean; id?: string; dryRun?: boolean }> {
  if (!isMediaNativeWrite(operation)) throw new Error('Unsupported native media write.');
  if (operation === 'personalCalendars.link' || operation === 'personalCalendars.unlink') return calendarWrite(client, 'media-buyer', operation, args, options);
  const guard = await accountGuard(client);
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical([operation, args])));
    const key = `cockpit-native-intent:${guard.id}:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
    let storage: Storage | undefined;
    try { if (typeof window !== 'undefined') storage = window.localStorage; } catch { /* Explicit request IDs remain usable without storage. */ }
    let intent: PendingIntent = { id: options.requestId ?? crypto.randomUUID(), args };
    let preparation: Promise<PendingIntent> | undefined;
    const retireAcknowledgedIntent = () => {
      if (preparation && pending.get(key) === preparation) pending.delete(key);
      // A delayed ACK for A must not remove a newer uncertain B from either store.
      try {
        const saved = storage?.getItem(key);
        if (saved && object(JSON.parse(saved)).id === intent.id) storage?.removeItem(key);
      } catch { /* Preserve storage that cannot be read or identified safely. */ }
    };
    if (options.apply === true) {
      preparation = pending.get(key);
      if (!preparation) {
        preparation = (async (): Promise<PendingIntent> => {
          let saved: string | null = null;
          try { saved = storage?.getItem(key) ?? null; } catch { storage = undefined; }
          if (saved) {
            const cached = object(JSON.parse(saved));
            return { id: required(cached.id, 'pending request ID'), args: object(cached.args) };
          }
          if (!storage && !options.requestId) throw new Error('Durable browser storage is unavailable. Supply a stable requestId before applying this operation.');
          const prepared = { id: intent.id, args };
          storage?.setItem(key, JSON.stringify(prepared));
          return prepared;
        })();
        pending.set(key, preparation);
        preparation.catch(() => { if (pending.get(key) === preparation) pending.delete(key); });
      }
      intent = await preparation;
      if (options.requestId && intent.id !== options.requestId) throw new Error('An uncertain request already exists for these inputs. Retry its original operation ID.');
    }
    await guard.check();
    const { data, error } = await client.rpc('cockpit_media_native_write', { p_operation: operation, p_args: intent.args, p_request_id: intent.id, p_apply: options.apply === true });
    await guard.check();
    if (error) throw new Error(error.message);
    const result = object(data);
    if (options.apply !== true) {
      if (result.dryRun !== true || result.ok !== false) throw new Error('The native dry-run result is invalid.');
      return { ok: false, dryRun: true };
    }
    if (result.ok !== true || result.id !== intent.id) throw new Error('The native write returned no matching receipt. Retain the operation ID and reconcile before retrying.');
    retireAcknowledgedIntent();
    return { ok: true, id: intent.id };
  } finally { guard.release(); }
}
async function fetchChangeResultsSource(client: SupabaseClient, campaignName: string, start: string, end: string): Promise<ChangeSource> {
  required(campaignName, 'campaign name');
  const guard = await accountGuard(client);
  try {
    const source = object(await mediaNativeRead('changeResults.source', { campaignName }, client));
    // Same canonical range contract as readMediaStats; keep raw per-ad grains for before/after calculations.
    const stats = object(await rpcRead(client, 'cockpit_media_statistics', { p_kind: 'range', p_campaign: campaignName, p_start: start, p_end: end }));
    const daily = parseRows(stats.rows); parseRows(stats.historical);
    const bookings = parseRows(stats.bookings);
    for (const item of [...daily, ...bookings]) {
      if (item.campaignName !== campaignName) throw new Error('The statistics source returned another campaign.');
      const date = required(item.date, 'statistics date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < start || date > end) throw new Error('The statistics source returned an out-of-range day.');
    }
    if (!daily.length) throw new Error('The daily feed does not cover this review period. Missing history is not zero.');
    for (const item of daily) { number(item.spend, 'spend'); number(item.leads, 'leads'); }
    await guard.check();
    return { adChanges: parseRows(source.adChanges), manualChanges: parseRows(source.manualChanges), daily, bookings };
  } finally { guard.release(); }
}
export async function marketForClient(args: { client: string }, client: SupabaseClient = getCockpitSupabaseClient()) {
  const data = object(await mediaNativeRead('market.forClient', { client: required(args.client, 'client name') }, client));
  return { city: optionalString(data.city, 'city'), serviceLine: optionalString(data.serviceLine, 'service line'), running: strings(data.running, 'running plays'), suggestions: parseRows(data.suggestions).map(item => ({ city: required(item.city, 'city'), playType: required(item.playType, 'play type'), interests: strings(item.interests, 'interests'), cpl: number(item.cpl, 'cost per lead'), clients: number(item.clients, 'client count') })), sourceAt: required(data.sourceAt, 'source timestamp') };
}
export async function trackingIssues(_args: Args = {}, client: SupabaseClient = getCockpitSupabaseClient()) {
  const data = object(await mediaNativeRead('tracking.issues', {}, client));
  const rows = parseRows(data.rows);
  for (const item of rows) { required(item.client, 'client name'); required(item.adName, 'ad name'); required(item.issue, 'tracking issue'); }
  return trackingGroups(rows);
}
export async function changeResultsForCampaign(args: { campaignName: string }, client: SupabaseClient = getCockpitSupabaseClient(), now = Date.now()) {
  return campaignResults(await fetchChangeResultsSource(client, args.campaignName, shiftDay(kuwaitDay(now), -18), kuwaitDay(now)), now);
}
export async function changeResultsForCreativeLaunch(args: { campaignName: string; sourceAdId?: string; launchedAdId: string; launchedAt: number }, client: SupabaseClient = getCockpitSupabaseClient(), now = Date.now()) {
  required(args.launchedAdId, 'launched ad ID'); number(args.launchedAt, 'launch timestamp');
  const day = kuwaitDay(args.launchedAt);
  return creativeLaunchResult(await fetchChangeResultsSource(client, args.campaignName, shiftDay(day, -3), shiftDay(day, 3)), args, now);
}
export async function chatThread(args: { campaignId: string }, client: SupabaseClient = getCockpitSupabaseClient()) {
  return parseRows(await mediaNativeRead('chat.thread', { campaignId: required(args.campaignId, 'campaign ID') }, client));
}
export async function chatActivity(args: { limit?: number } = {}, client: SupabaseClient = getCockpitSupabaseClient()) {
  const data = object(await mediaNativeRead('chat.activity', args, client));
  if (data.lastSyncAt !== null) number(data.lastSyncAt, 'last sync timestamp');
  if (data.lastSyncOk !== null && typeof data.lastSyncOk !== 'boolean') throw new Error('Invalid sync status.');
  return { recent: parseRows(data.recent), queued: number(data.queued, 'queued count'), waitingOnViktor: number(data.waitingOnViktor, 'waiting count'), lastSyncAt: data.lastSyncAt, lastSyncOk: data.lastSyncOk, problems: strings(data.problems, 'sync problems') };
}
export async function chatAsk(args: Args, options: WriteOptions = {}, client: SupabaseClient = getCockpitSupabaseClient()) {
  const result = await mediaNativeWrite('chat.ask', args, options, client);
  return result.dryRun ? result : { ok: result.ok };
}
export async function assistGet(args: { id: string }, client: SupabaseClient = getCockpitSupabaseClient()) {
  const value = await mediaNativeRead('assist.get', { id: required(args.id, 'request ID') }, client);
  if (value === null) return null;
  const data = object(value); required(data._id, 'request ID'); required(data.kind, 'assist kind'); required(data.status, 'assist status'); number(data.requestedAt, 'request timestamp');
  if (data.variants !== undefined) for (const variant of parseRows(data.variants)) { required(variant.headline, 'headline'); required(variant.message, 'ad copy'); }
  if (data.media !== undefined) for (const item of parseRows(data.media)) { required(item.name, 'asset name'); required(item.link, 'asset link'); }
  return data;
}
export async function assistQueueDepth(_args: Args = {}, client: SupabaseClient = getCockpitSupabaseClient()) {
  const data = object(await mediaNativeRead('assist.queueDepth', {}, client));
  return { queued: number(data.queued, 'queued count'), working: number(data.working, 'working count') };
}
export async function assistEnqueue(args: Args, options: WriteOptions = {}, client: SupabaseClient = getCockpitSupabaseClient()) {
  const result = await mediaNativeWrite('assist.enqueue', args, options, client);
  // The existing useAssist consumer watches the returned ID, not a write envelope.
  return result.dryRun ? result : required(result.id, 'queued request ID');
}
export async function cockpitLogManualChange(args: Args, options: WriteOptions = {}, client: SupabaseClient = getCockpitSupabaseClient()) {
  const result = await mediaNativeWrite('cockpit.logManualChange', args, options, client);
  return result.dryRun ? result : null;
}
const CAN_DO: Readonly<Record<string, true>> = { 'create leads campaign': true, 'create ad set': true, 'build ads': true, 'create lead form': true, 'select the correct lead form': true, 'add url parameters': true, 'duplicate ads': true };
export async function onboardings(client: SupabaseClient = getCockpitSupabaseClient()) {
  return parseRows(await mediaNativeRead('cockpit.onboardings', {}, client)).map(item => {
    let done = 0; let total = 0;
    const groups = parseRows(item.groups).map(group => ({ name: required(group.name, 'checklist group'), items: parseRows(group.items).map(step => {
      const name = required(step.name, 'checklist step'); if (typeof step.done !== 'boolean') throw new Error('Invalid onboarding step state.');
      total++; if (step.done) done++;
      return { name, done: step.done, viktorCanDo: Object.keys(CAN_DO).some(phrase => name.toLowerCase().includes(phrase)) };
    }) }));
    return { taskId: required(item.taskId, 'onboarding task ID'), taskUrl: optionalString(item.taskUrl, 'task URL'), client: required(item.client, 'client name'), status: required(item.status, 'onboarding status'), accountId: optionalString(item.accountId, 'account ID'), accountName: optionalString(item.accountName, 'account name'), accountIdSource: optionalString(item.accountIdSource, 'account source'), done, total, groups };
  });
}
export async function launchWatch(client: SupabaseClient = getCockpitSupabaseClient()) {
  return parseRows(await mediaNativeRead('cockpit.launchWatch', {}, client)).map(item => ({ ...item, client: required(item.client, 'client name'), issues: strings(item.issues, 'launch issues') })).sort((a, b) => b.issues.length - a.issues.length || a.client.localeCompare(b.client));
}
export async function winners(args: { serviceType?: string }, client: SupabaseClient = getCockpitSupabaseClient()) {
  const data = object(await mediaNativeRead('cockpit.winners', args, client));
  return { sameLine: parseRows(data.sameLine), rest: parseRows(data.rest) };
}
export async function handleMediaNativeCall(endpoint: string, args: Args = {}, options: WriteOptions = {}, client: SupabaseClient = getCockpitSupabaseClient()): Promise<unknown> {
  switch (endpoint) {
    case 'market.forClient': return marketForClient({ client: required(args.client, 'client name') }, client);
    case 'tracking.issues': return trackingIssues(args, client);
    case 'changeResults.forCampaign': return changeResultsForCampaign({ campaignName: required(args.campaignName, 'campaign name') }, client);
    case 'changeResults.forCreativeLaunch': return changeResultsForCreativeLaunch({ campaignName: required(args.campaignName, 'campaign name'), launchedAdId: required(args.launchedAdId, 'launched ad ID'), launchedAt: number(args.launchedAt, 'launch timestamp'), sourceAdId: optionalString(args.sourceAdId, 'source ad ID') }, client);
    case 'chat.thread': return chatThread({ campaignId: required(args.campaignId, 'campaign ID') }, client);
    case 'chat.activity': return chatActivity(args.limit === undefined ? {} : { limit: number(args.limit, 'activity limit') }, client);
    case 'chat.ask': return chatAsk(args, options, client);
    case 'assist.get': return assistGet({ id: required(args.id, 'request ID') }, client);
    case 'assist.queueDepth': return assistQueueDepth(args, client);
    case 'assist.enqueue': return assistEnqueue(args, options, client);
    case 'personalCalendars.mine': return calendarMine(client, 'media-buyer');
    case 'personalCalendars.link': {
      const result = await calendarWrite(client, 'media-buyer', 'personalCalendars.link', { calendarId: required(args.calendarId, 'calendar ID') }, options);
      return result.dryRun ? result : null;
    }
    case 'personalCalendars.unlink': {
      const result = await calendarWrite(client, 'media-buyer', 'personalCalendars.unlink', {}, options);
      return result.dryRun ? result : null;
    }
    case 'cockpit.logManualChange': return cockpitLogManualChange(args, options, client);
    case 'cockpit.onboardings': return onboardings(client);
    case 'cockpit.launchWatch': return launchWatch(client);
    case 'cockpit.winners': return winners({ serviceType: optionalString(args.serviceType, 'service type') }, client);
    default: throw new Error(`Unsupported native media endpoint: ${endpoint}`);
  }
}
