import {stillKeyFor} from './metaMedia';
import type {Row} from './runtime';

/** Same spend/CPL and best-window rules as the former market archive. Never deletes. */
export function archiveWinners(state: Row, tables: Record<string, Row[]>) {
  if (!Array.isArray(state.winners) || !Array.isArray(tables.marketPlays)) throw new Error('Winner archive and current market source are required');
  const archive = new Map<string, Row>(state.winners.map((row: Row) => [String(row.adId), {...row}]));
  const tree = tables.metaTree ?? [], answered = new Set(tree.map(row => row.campaignName));
  const live = new Set(tree.filter(row => row.kind === 'ad' && !/paused|archived|deleted|disapproved/i.test(row.effectiveStatus ?? row.status ?? '')).map(row => String(row.metaId)));
  const campaignOf = new Map(tree.filter(row => row.kind === 'ad').map(row => [String(row.metaId), row.campaignName]));
  const windows = new Map<string, {from: string; to: string}>();
  for (const row of [...(state.dailyStats ?? []), ...(tables.dailyStats ?? [])]) {
    if (!row.metaAdId || !(row.spend > 0)) continue;
    const previous = windows.get(row.metaAdId);
    windows.set(row.metaAdId, {from: previous && previous.from < row.date ? previous.from : row.date, to: previous && previous.to > row.date ? previous.to : row.date});
  }
  const now = Date.now(), today = new Date(now + 10800000).toISOString().slice(0, 10);
  for (const play of tables.marketPlays) for (const creative of play.creatives ?? []) {
    if (!(creative.spend >= 100) || creative.cpl == null || creative.cpl > 15) continue;
    if (!creative.adId) throw new Error('Winning creative has no provider ad ID');
    const id = String(creative.adId), previous = archive.get(id);
    const next: Row = previous ?? {adId: id, origin: 'auto', firstArchivedAt: now};
    if (!previous || creative.spend >= Number(previous.spend ?? 0)) Object.assign(next, {spend: Math.round(creative.spend), leads: creative.leads, cpl: creative.cpl});
    for (const key of ['headline', 'body', 'cta', 'transcript', 'hook', 'voice']) if (next[key] == null && creative[key] != null) next[key] = creative[key];
    if (!next.format || next.format === 'unknown') next.format = creative.format;
    if (next.savedAt == null) Object.assign(next, {adName: creative.adName, client: play.client, serviceLine: play.serviceLine ?? 'Unknown', city: play.city ?? 'Unknown', country: play.country});
    for (const key of ['language', 'copyTraits', 'playType', 'interests', 'adsetName']) if (play[key] != null) next[key] = play[key];
    Object.assign(next, {creativeId: creative.creativeId ?? next.creativeId, accountId: String(play.accountId ?? next.accountId ?? '').replace(/^act_/, ''), campaignName: campaignOf.get(id) ?? next.campaignName, lastSeenAt: now});
    if (creative.thumbUrl) next.thumbUrl = creative.thumbUrl;
    if (!next.stillUrl) next.stillKey = stillKeyFor(next.creativeId, id);
    if (next.origin === 'manual' && !next.autoFirstAt) next.autoFirstAt = now;
    const window = windows.get(id);
    if (window) { next.wonFrom = next.wonFrom && next.wonFrom < window.from ? next.wonFrom : window.from; next.wonTo = next.wonTo && next.wonTo > window.to ? next.wonTo : window.to; }
    archive.set(id, next);
  }
  for (const [id, row] of archive) {
    const campaign = campaignOf.get(id) ?? row.campaignName;
    if (live.has(id) || answered.has(campaign)) { row.stillLive = live.has(id); row.retiredOn = row.stillLive ? undefined : row.retiredOn ?? today; }
    delete row.previewSrc;
  }
  tables.winnersArchive = [...archive.values()];
  return {archived: archive.size};
}
