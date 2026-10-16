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
