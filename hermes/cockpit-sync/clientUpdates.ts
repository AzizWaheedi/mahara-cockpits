import type {Row} from './runtime';

/**
 * The newest digested comments for one client card, in the shape the three
 * cockpits show (ClientUpdates.tsx): done digests from the last 60 days,
 * newest first, flattened, empty ones dropped, three per card.
 *
 * The native port of the media Convex query commentWatch.latestByTask. The
 * clientComments feed holds the raw rows: the ones imported from Convex and
 * the ones the native comment watch publishes (migration 20261009i).
 */
export function latestUpdates(rows: Row[] | undefined, taskId: unknown, now: number, perTask = 3, days = 60): Row[] {
  if (taskId === undefined || taskId === null || taskId === '') return [];
  const since = now - days * 86_400_000;
  const strings = (x: unknown) => (Array.isArray(x) ? x.map(String).filter(s => s.trim()) : []);
  return (rows ?? [])
    .filter(r => r?.taskId === taskId && r.status === 'done' && Number.isFinite(Number(r.at)) && Number(r.at) >= since)
    .sort((a, b) => Number(b.at) - Number(a.at))
    .map(r => {
      const d: Row = r.digest && typeof r.digest === 'object' ? r.digest : {};
      return {
        clientName: r.clientName, taskId: r.taskId, at: Number(r.at), kind: r.kind,
        summary: String(d.summary ?? '').trim(),
        nextSteps: strings(d.nextSteps), clientRequests: strings(d.clientRequests), risks: strings(d.risks),
        forAds: strings(d.forAds), forCreative: strings(d.forCreative),
      };
    })
    .filter(u => u.summary || u.nextSteps.length || u.clientRequests.length || u.risks.length || u.forAds.length || u.forCreative.length)
    .slice(0, perTask);
}
