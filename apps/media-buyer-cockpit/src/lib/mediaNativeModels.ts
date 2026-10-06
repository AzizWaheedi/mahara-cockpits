import { compareChange, kuwaitDay, shiftDay, windowResult, type BookingRow, type DailyRow } from './changeResultsCore';
export type JsonRow = Record<string, unknown>;
export function object(value: unknown): JsonRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The media source returned an invalid object');
  return value as JsonRow;
}
export function parseRows(value: unknown): JsonRow[] {
  if (!Array.isArray(value)) throw new Error('The media source returned an invalid row list');
  return value.map(object);
}
export const text = (value: unknown): string => typeof value === 'string' ? value : '';
export function number(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`The source ${field} is missing or invalid`);
  return value;
}
export type ChangeSource = { adChanges: JsonRow[]; manualChanges: JsonRow[]; daily: JsonRow[]; bookings: JsonRow[] };
const meaningful = /budget|targeting|bid strategy|optimisation goal|optimization goal|created|ad updated|campaign status updated|ad set status updated/i;
const housekeeping = /name updated|finishes ad review|billed|delivered|balance/i;
function changes(source: ChangeSource) {
  return [
    ...source.adChanges.filter(row => text(row.actor) && row.actor !== 'Meta' && meaningful.test(text(row.eventType)) && !housekeeping.test(text(row.eventType))).map(row => ({ id: `meta:${text(row.activityHash) || text(row._id)}`, source: 'Meta', at: number(row.at, 'change date'), actor: text(row.actor), label: [text(row.eventType), text(row.objectName)].filter(Boolean).join(' · '), objectId: text(row.objectId) })),
    ...source.manualChanges.map(row => ({ id: `manual:${text(row._id)}`, source: 'Buyer note', at: number(row.at, 'change date'), actor: text(row.by), label: [text(row.what), text(row.adName)].filter(Boolean).join(' · '), objectId: '' })),
  ].sort((a, b) => b.at - a.at);
}
function grains(source: ChangeSource): { daily: (DailyRow & { metaAdId: string })[]; bookings: BookingRow[] } {
  return { daily: source.daily.map(row => ({ date: text(row.date), spend: number(row.spend, 'spend'), leads: number(row.leads, 'leads'), metaAdId: text(row.metaAdId) })), bookings: source.bookings.map(row => ({ date: text(row.date), adId: text(row.adId) })) };
}
export function campaignResults(source: ChangeSource, now = Date.now()) {
  const { daily, bookings } = grains(source);
  const cutoff = Date.parse(`${shiftDay(kuwaitDay(now), -14)}T00:00:00Z`) - 10800000;
  const recent = changes(source).filter(row => row.at >= cutoff);
  return { changes: recent.slice(0, 15).map(row => ({ ...row, result: compareChange(row, recent, daily, bookings, now) })), periodDays: 14, source: 'Meta activity and buyer notes; spend and leads from the verified daily ad feed; matched bookings from GHL. Imported history keeps its original collection date.' };
}
export function creativeLaunchResult(source: ChangeSource, args: { launchedAt: number; launchedAdId: string; sourceAdId?: string }, now = Date.now()) {
  if (!Number.isFinite(args.launchedAt) || args.launchedAt > now + 86400000) throw new Error('The launch date is invalid.');
  const { daily, bookings } = grains(source);
  const other = changes(source).filter(row => row.objectId !== args.launchedAdId);
  const campaign = compareChange({ id: 'creative-launch', at: args.launchedAt }, other, daily, bookings, now);
  return { campaign, sourceBefore: args.sourceAdId ? windowResult(campaign.before.from, campaign.before.to, daily.filter(row => row.metaAdId === args.sourceAdId), bookings.filter(row => row.adId === args.sourceAdId)) : null, replacementAfter: windowResult(campaign.after.from, campaign.after.to, daily.filter(row => row.metaAdId === args.launchedAdId), bookings.filter(row => row.adId === args.launchedAdId)) };
}
export function trackingGroups(rows: JsonRow[]) {
  const groups = new Map<string, { adName: string; issue: string }[]>();
  for (const row of rows) { const client = text(row.client); const ads = groups.get(client) ?? []; ads.push({ adName: text(row.adName), issue: text(row.issue) }); groups.set(client, ads); }
  return [...groups].map(([client, ads]) => ({ client, count: ads.length, ads })).sort((a, b) => b.count - a.count);
}
