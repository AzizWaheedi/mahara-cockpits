const ACCOUNT = '746108264865897';
const MAX_SPAN_DAYS = 400;
const MAX_CAMPAIGN_PAGES = 10;
const MAX_LEVEL_PAGES = 20;
const KUWAIT_OFFSET_MS = 3 * 60 * 60_000;
const WEBINAR_NAME = /(webinar|webby|live[ _-]?training|training|تدريب|ويبينار|ويبنار)/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Row = Record<string, unknown>;
export type FrequencyFigure = {
  /** Campaigns of this kind that delivered (impressions above 0) in the window. */
  campaigns: number;
  /** Campaigns of this kind on the account, delivered or not. */
  listed: number;
  impressions: number;
  reach: number;
  frequency: number | null;
  spend: number;
};
export type FrequencyRead = {
  from: string;
  to: string;
  computedAt: number;
  leadGen: FrequencyFigure | null;
  retargeting: FrequencyFigure | null;
  note: string | null;
};
export type MetaRead = (path: string, params?: Record<string, string | number>) => Promise<Row>;

function validDay(day: string): boolean {
  if (!DAY.test(day)) return false;
  const date = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
}


function numeric(value: unknown, field: string): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Meta frequency response did not confirm ${field}.`);
  return parsed;
}

export function campaignKind(name: string): 'lead_gen' | 'retargeting' | 'excluded' | 'webinar' {
  if (/(hiring|recruit)/i.test(name)) return 'excluded';
  if (/(hammer them|retarget|remarket)/i.test(name)) return 'retargeting';
  if (WEBINAR_NAME.test(name)) return 'webinar';
  return 'lead_gen';
}

function checkRange(from: string, to: string, now: number): void {
  if (!validDay(from) || !validDay(to)) throw new Error('frequency: days must be YYYY-MM-DD');
  if (from > to) throw new Error('frequency: the window ends before it starts');
  const today = new Date(now + KUWAIT_OFFSET_MS).toISOString().slice(0, 10);
  if (to > today) throw new Error('frequency: the window ends in the future');
  const earliest = new Date(Date.parse(`${to}T00:00:00.000Z`) - (MAX_SPAN_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  if (from < earliest) throw new Error(`frequency: a window covers at most ${MAX_SPAN_DAYS} days`);
}

async function listCampaigns(readMeta: MetaRead): Promise<{ id: string; name: string }[]> {
  const campaigns: { id: string; name: string }[] = [];
  const seenIds = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < MAX_CAMPAIGN_PAGES; page += 1) {
    const result = await readMeta(`act_${ACCOUNT}/campaigns`, {
      fields: 'id,name',
      limit: 200,
      ...(after ? { after } : {}),
    });
    if (!Array.isArray(result.data)) throw new Error('Meta did not confirm the campaign list.');
    for (const item of result.data) {
      if (!isRow(item)) throw new Error('Meta returned an invalid campaign row.');
      if ((typeof item.id !== 'string' && typeof item.id !== 'number') || !String(item.id).trim()) throw new Error('Meta returned a campaign without an ID.');
      const id = String(item.id);
      if (seenIds.has(id)) throw new Error('Meta returned a duplicate campaign ID; no partial frequency result was accepted.');
      seenIds.add(id);
      campaigns.push({ id, name: typeof item.name === 'string' ? item.name : '' });
    }
    const paging = result.paging;
    if (!isRow(paging) || !paging.next) return campaigns;
    const cursors = paging.cursors;
    const next = isRow(cursors) ? cursors.after : null;
    if (typeof next !== 'string' || !next) throw new Error('Meta returned an incomplete campaign page.');
    if (page === MAX_CAMPAIGN_PAGES - 1) throw new Error('Meta campaign list exceeds the safe page limit.');
    after = next;
  }
  throw new Error('Meta campaign list was not confirmed.');
}

/**
 * One whole-window read over a set of campaigns. `delivered`, when given,
 * counts the campaigns that delivered in the window; without it `campaigns`
 * is every campaign in the set.
 */
export async function readInsights(readMeta: MetaRead, ids: string[], from: string, to: string, delivered?: (ids: string[]) => number): Promise<FrequencyFigure | null> {
  if (ids.length === 0) return null;
  const result = await readMeta(`act_${ACCOUNT}/insights`, {
    fields: 'impressions,reach,frequency,spend',
    level: 'account',
    time_range: JSON.stringify({ since: from, until: to }),
    filtering: JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: ids }]),
  });
  if (!Array.isArray(result.data)) throw new Error('Meta did not confirm the frequency insights.');
  const first = result.data[0];
  if (first === undefined) return { campaigns: delivered ? delivered(ids) : ids.length, listed: ids.length, impressions: 0, reach: 0, frequency: null, spend: 0 };
  if (!isRow(first)) throw new Error('Meta returned an invalid frequency row.');
  const row = first;
  const impressions = numeric(row.impressions, 'impressions');
  const reach = numeric(row.reach, 'reach');
  const spend = numeric(row.spend, 'spend');
  const reportedFrequency = row.frequency;
  const frequency = reportedFrequency === undefined || reportedFrequency === null
    ? reach > 0 ? Math.round((impressions / reach) * 100) / 100 : null
    : Math.round(numeric(reportedFrequency, 'frequency') * 100) / 100;
  return { campaigns: delivered ? delivered(ids) : ids.length, listed: ids.length, impressions, reach, frequency, spend: Math.round(spend * 100) / 100 };
}

/**
 * Meta's own frequency for one level over a whole window: impressions divided
 * by the distinct people reached across every day of it, the number Ads
 * Manager shows for those dates. It cannot be rebuilt from daily rows or from
 * the children of a row, because the same person seen on two days, or by two
 * ads, is one person.
 */
export type LevelFrequency = { impressions: number; reach: number; frequency: number | null };
export type FrequencyLevel = 'campaign' | 'adset' | 'ad';

export async function readLevelFrequency(
  readMeta: MetaRead,
  level: FrequencyLevel,
  from: string,
  to: string,
): Promise<Map<string, LevelFrequency>> {
  if (level !== 'campaign' && level !== 'adset' && level !== 'ad') throw new Error('frequency: unknown level');
  if (!validDay(from) || !validDay(to)) throw new Error('frequency: days must be YYYY-MM-DD');
  if (from > to) throw new Error('frequency: the window ends before it starts');
  const idField = `${level}_id`;
  const figures = new Map<string, LevelFrequency>();
  let after: string | undefined;
  for (let page = 0; page < MAX_LEVEL_PAGES; page += 1) {
    const result = await readMeta(`act_${ACCOUNT}/insights`, {
      level,
      fields: `${idField},impressions,reach,frequency`,
      time_range: JSON.stringify({ since: from, until: to }),
      limit: 500,
      ...(after ? { after } : {}),
    });
    if (!Array.isArray(result.data)) throw new Error(`Meta did not confirm the ${level} frequency insights.`);
    for (const item of result.data) {
      if (!isRow(item)) throw new Error(`Meta returned an invalid ${level} frequency row.`);
      const rawId = item[idField];
      if ((typeof rawId !== 'string' && typeof rawId !== 'number') || !String(rawId).trim()) throw new Error(`Meta returned a ${level} frequency row without an ID.`);
      const id = String(rawId);
      if (figures.has(id)) throw new Error(`Meta returned the same ${level} twice; no partial frequency result was accepted.`);
      const impressions = numeric(item.impressions, `${level} impressions`);
      const reach = numeric(item.reach, `${level} reach`);
      const reported = item.frequency;
      const frequency = reach === 0
        ? null
        : reported === undefined || reported === null
          ? Math.round((impressions / reach) * 100) / 100
          : Math.round(numeric(reported, `${level} frequency`) * 100) / 100;
      figures.set(id, { impressions, reach, frequency });
    }
    const paging = result.paging;
    if (!isRow(paging) || !paging.next) return figures;
    const cursors = paging.cursors;
    const next = isRow(cursors) ? cursors.after : null;
    if (typeof next !== 'string' || !next) throw new Error(`Meta returned an incomplete ${level} frequency page.`);
    if (page === MAX_LEVEL_PAGES - 1) throw new Error(`Meta ${level} frequency exceeds the safe page limit.`);
    after = next;
  }
  throw new Error(`Meta ${level} frequency was not confirmed.`);
}

/** The ad account's time zone when Meta does not say (Mahara's account runs on Pacific time). */
export const ACCOUNT_TIME_ZONE_FALLBACK = 'America/Los_Angeles';

/** The calendar day (YYYY-MM-DD) at `nowMs` in an IANA time zone. */
export function accountDay(nowMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(nowMs));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  const day = `${part('year')}-${part('month')}-${part('day')}`;
  if (!validDay(day)) throw new Error(`frequency: could not read the day in ${timeZone}`);
  return day;
}

/**
 * The last day Meta can report for a window ending `to`: Meta's days are the
 * account's days, and a day that has not started there has no rows yet.
 */
export function metaUntil(to: string, nowMs: number, timeZone: string): string {
  const today = accountDay(nowMs, timeZone);
  return to < today ? to : today;
}

export async function readFrequencyWindow(
  from: string,
  to: string,
  readMeta: MetaRead,
  now: () => number = Date.now,
): Promise<FrequencyRead> {
  const computedAt = now();
  checkRange(from, to, computedAt);
  const campaigns = await listCampaigns(readMeta);
  const classified = campaigns.map(campaign => ({ ...campaign, kind: campaignKind(campaign.name) }));
  const leadGenIds = classified.filter(campaign => campaign.kind === 'lead_gen').map(campaign => campaign.id);
  const retargetingIds = classified.filter(campaign => campaign.kind === 'retargeting').map(campaign => campaign.id);
  const excluded = campaigns.length - leadGenIds.length - retargetingIds.length;
  // The card counts the campaigns that delivered in the window (impressions
  // above 0), not every campaign whose name sorts it there; the totals are
  // unchanged. Meta leaves a campaign with no delivery out of its rows.
  const byCampaign = await readLevelFrequency(readMeta, 'campaign', from, to);
  const delivered = (ids: string[]) => ids.filter(id => (byCampaign.get(id)?.impressions ?? 0) > 0).length;
  const [leadGen, retargeting] = await Promise.all([
    readInsights(readMeta, leadGenIds, from, to, delivered),
    readInsights(readMeta, retargetingIds, from, to, delivered),
  ]);
  return {
    from,
    to,
    computedAt,
    leadGen,
    retargeting,
    note: `Read from Meta over ${from} to ${to}: ${delivered(leadGenIds)} of ${leadGenIds.length} lead-gen and ${delivered(retargetingIds)} of ${retargetingIds.length} retargeting campaigns on the account delivered${excluded > 0 ? `, ${excluded} hiring or webinar campaigns left out` : ''}. Reach is distinct people for the whole window, never a sum of days.`,
  };
}
function isRow(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// ---- Meta's own on and off ---------------------------------------------------
//
// The CEO, 2026-10-19: "Ads turning on and off in the CEO cockpit isn't
// working." Meta took every change, but the Ads tab read on and off from the
// B2B snapshots, which hold a row only for a day an ad delivered: an ad
// switched on read off until it spent and the sync caught up, and a stale
// ACTIVE row could outrank a switch-off. The Ads tab (hermes b2bAds.js and the
// custom range in windows.ts) now reads every campaign, ad set and ad on the
// account live, and keeps the snapshots for the numbers.
// It lives here, beside the other Graph reads both callers share, because the
// native worker package carries this file (scripts/prepare-native-worker-package.py).

/** A campaign, ad set or ad as Meta has it at the moment of the read. */
export type LiveObject = {
  id: string;
  name: string;
  /** The object's own switch (configured_status, else status): ACTIVE, PAUSED, DELETED or ARCHIVED. */
  status: string;
  /** Meta's effective_status: ACTIVE only when it and every parent are on and nothing stops it. */
  effectiveStatus: string;
  campaignId: string | null;
  adsetId: string | null;
};
export type LiveStatus = {
  /** When the read began (epoch ms): a change Meta confirmed before this is in it. */
  readAt: number;
  campaigns: Map<string, LiveObject>;
  adsets: Map<string, LiveObject>;
  ads: Map<string, LiveObject>;
};
export type LiveLevel = 'campaigns' | 'adsets' | 'ads';
const STATUS_FIELDS: Record<LiveLevel, string> = {
  campaigns: 'id,name,status,effective_status,configured_status',
  adsets: 'id,name,status,effective_status,configured_status,campaign_id',
  ads: 'id,name,status,effective_status,configured_status,adset_id,campaign_id',
};
const MAX_STATUS_PAGES = 20;
/** Never added to the tab as a new row (cockpit-media-api funnel.ts keeps them out the same way). */
export const GONE_STATUSES: ReadonlySet<string> = new Set(['DELETED', 'ARCHIVED']);
/** A row the tab holds that the live read did not list. */
export const NOT_LISTED = 'NOT_LISTED';

const idOrNull = (value: unknown): string | null =>
  (typeof value === 'string' || typeof value === 'number') && String(value).trim() ? String(value) : null;

async function listLevelStatus(readMeta: MetaRead, level: LiveLevel): Promise<Map<string, LiveObject>> {
  const out = new Map<string, LiveObject>();
  let after: string | undefined;
  for (let page = 0; page < MAX_STATUS_PAGES; page += 1) {
    const result = await readMeta(`act_${ACCOUNT}/${level}`, {
      fields: STATUS_FIELDS[level],
      limit: 500,
      ...(after ? { after } : {}),
    });
    if (!Array.isArray(result.data)) throw new Error(`Meta did not confirm the ${level} list.`);
    for (const item of result.data) {
      if (!isRow(item)) throw new Error(`Meta returned an invalid row in the ${level} list.`);
      const id = idOrNull(item.id);
      if (!id) throw new Error(`Meta returned a row in the ${level} list without an ID.`);
      if (out.has(id)) throw new Error(`Meta returned the same ID twice in the ${level} list; no partial status was accepted.`);
      const effectiveStatus = typeof item.effective_status === 'string' ? item.effective_status : '';
      if (!effectiveStatus) throw new Error(`Meta returned a row in the ${level} list without its effective status.`);
      const configured = typeof item.configured_status === 'string' && item.configured_status
        ? item.configured_status
        : typeof item.status === 'string' ? item.status : '';
      out.set(id, {
        id,
        name: typeof item.name === 'string' ? item.name : '',
        status: configured,
        effectiveStatus,
        campaignId: idOrNull(item.campaign_id),
        adsetId: idOrNull(item.adset_id),
      });
    }
    const paging = result.paging;
    if (!isRow(paging) || !paging.next) return out;
    const cursors = paging.cursors;
    const next = isRow(cursors) ? cursors.after : null;
    if (typeof next !== 'string' || !next) throw new Error(`Meta returned an incomplete ${level} page.`);
    if (page === MAX_STATUS_PAGES - 1) throw new Error(`Meta ${level} list exceeds the safe page limit.`);
    after = next;
  }
  throw new Error(`Meta ${level} list was not confirmed.`);
}

/**
 * Every campaign, ad set and ad on the account with Meta's own status, read
 * live (three paged GETs). Any failed or incomplete page fails the whole read,
 * so a caller never mixes a partial list with the snapshots.
 */
export async function readLiveStatus(readMeta: MetaRead, now: () => number = Date.now): Promise<LiveStatus> {
  const readAt = now();
  const campaigns = await listLevelStatus(readMeta, 'campaigns');
  const adsets = await listLevelStatus(readMeta, 'adsets');
  const ads = await listLevelStatus(readMeta, 'ads');
  return { readAt, campaigns, adsets, ads };
}

/**
 * One row's on and off from the live read: Meta's effective_status, and
 * running only when that is ACTIVE (a paused ad set or campaign already reads
 * ADSET_PAUSED or CAMPAIGN_PAUSED on its children). A row Meta did not list is
 * not running.
 *
 * `switchOn` is the row's own switch (configured_status ACTIVE), what the
 * cockpit's switch sets (cockpit-media-api setStatus) and so what it shows:
 * an ad switched on under a paused campaign is on and not running, as in Ads
 * Manager, and can be switched off from the cockpit. Running stays the count.
 */
export function liveState(live: LiveStatus, level: LiveLevel, id: string): { status: string; running: boolean; switchOn: boolean } {
  const found = live[level].get(id);
  if (!found) return { status: NOT_LISTED, running: false, switchOn: false };
  const running = found.effectiveStatus === 'ACTIVE';
  return { status: found.effectiveStatus, running, switchOn: found.status ? found.status === 'ACTIVE' : running };
}

/**
 * Ads Meta has running that the tab does not hold yet (no delivery in the
 * window, so no snapshot row): added so they can be switched. Deleted and
 * archived never are; ACTIVE already rules them out.
 */
export function liveOnlyAds(live: LiveStatus, held: ReadonlySet<string>): LiveObject[] {
  return [...live.ads.values()].filter(ad =>
    ad.effectiveStatus === 'ACTIVE' && !GONE_STATUSES.has(ad.status) && !held.has(ad.id) && ad.adsetId !== null && ad.campaignId !== null);
}

/** Why a row is not running, in Meta's words. */
export function offReason(status: string): string {
  switch (status) {
    case 'PAUSED': return 'Switched off in Meta.';
    case 'ADSET_PAUSED': return 'Its ad set is switched off in Meta.';
    case 'CAMPAIGN_PAUSED': return 'Its campaign is switched off in Meta.';
    case 'DELETED': return 'Deleted in Meta.';
    case 'ARCHIVED': return 'Archived in Meta.';
    case NOT_LISTED: return 'Meta no longer lists it: deleted or archived.';
    default: return `On in Meta but not delivering: Meta says ${status.toLowerCase().replace(/_/g, ' ') || 'nothing'}.`;
  }
}

function parseFigure(value: unknown): FrequencyFigure | null | undefined {
  if (value === null) return null;
  if (!isRow(value)) return undefined;
  const campaigns = value.campaigns;
  const listed = value.listed;
  const impressions = value.impressions;
  const reach = value.reach;
  const spend = value.spend;
  const frequency = value.frequency;
  // A read saved before `listed` counted every campaign, not the delivered ones: read again.
  if (typeof campaigns !== 'number' || !Number.isSafeInteger(campaigns) || campaigns < 0
    || typeof listed !== 'number' || !Number.isSafeInteger(listed) || listed < campaigns
    || typeof impressions !== 'number' || !Number.isFinite(impressions) || impressions < 0
    || typeof reach !== 'number' || !Number.isFinite(reach) || reach < 0
    || typeof spend !== 'number' || !Number.isFinite(spend) || spend < 0
    || (frequency !== null && (typeof frequency !== 'number' || !Number.isFinite(frequency) || frequency < 0))) return undefined;
  return { campaigns, listed, impressions, reach, frequency, spend };
}

export function parseFrequencyRead(value: unknown): FrequencyRead | null {
  if (!isRow(value) || typeof value.from !== 'string' || typeof value.to !== 'string'
    || !validDay(value.from) || !validDay(value.to) || value.from > value.to
    || typeof value.computedAt !== 'number' || !Number.isFinite(value.computedAt) || value.computedAt <= 0
    || (value.note !== null && typeof value.note !== 'string')) return null;
  const leadGen = parseFigure(value.leadGen);
  const retargeting = parseFigure(value.retargeting);
  if (leadGen === undefined || retargeting === undefined) return null;
  return { from: value.from, to: value.to, computedAt: value.computedAt, leadGen, retargeting, note: value.note };
}
