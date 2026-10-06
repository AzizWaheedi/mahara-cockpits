const ACCOUNT = '746108264865897';
const MAX_SPAN_DAYS = 400;
const MAX_CAMPAIGN_PAGES = 10;
const KUWAIT_OFFSET_MS = 3 * 60 * 60_000;
const WEBINAR_NAME = /(webinar|webby|live[ _-]?training|training|تدريب|ويبينار|ويبنار)/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Row = Record<string, unknown>;
export type FrequencyFigure = {
  campaigns: number;
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

export async function readInsights(readMeta: MetaRead, ids: string[], from: string, to: string): Promise<FrequencyFigure | null> {
  if (ids.length === 0) return null;
  const result = await readMeta(`act_${ACCOUNT}/insights`, {
    fields: 'impressions,reach,frequency,spend',
    level: 'account',
    time_range: JSON.stringify({ since: from, until: to }),
    filtering: JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: ids }]),
  });
  if (!Array.isArray(result.data)) throw new Error('Meta did not confirm the frequency insights.');
  const first = result.data[0];
  if (first === undefined) return { campaigns: ids.length, impressions: 0, reach: 0, frequency: null, spend: 0 };
  if (!isRow(first)) throw new Error('Meta returned an invalid frequency row.');
  const row = first;
  const impressions = numeric(row.impressions, 'impressions');
  const reach = numeric(row.reach, 'reach');
  const spend = numeric(row.spend, 'spend');
  const reportedFrequency = row.frequency;
  const frequency = reportedFrequency === undefined || reportedFrequency === null
    ? reach > 0 ? Math.round((impressions / reach) * 100) / 100 : null
    : Math.round(numeric(reportedFrequency, 'frequency') * 100) / 100;
  return { campaigns: ids.length, impressions, reach, frequency, spend: Math.round(spend * 100) / 100 };
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
  const [leadGen, retargeting] = await Promise.all([
    readInsights(readMeta, leadGenIds, from, to),
    readInsights(readMeta, retargetingIds, from, to),
  ]);
  return {
    from,
    to,
    computedAt,
    leadGen,
    retargeting,
    note: `Read from Meta over ${from} to ${to}: ${leadGenIds.length} lead-gen and ${retargetingIds.length} retargeting campaigns on the account${excluded > 0 ? `, ${excluded} hiring or webinar campaigns left out` : ''}. Reach is distinct people for the whole window, never a sum of days.`,
  };
}
function isRow(value: unknown): value is Row {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseFigure(value: unknown): FrequencyFigure | null | undefined {
  if (value === null) return null;
  if (!isRow(value)) return undefined;
  const campaigns = value.campaigns;
  const impressions = value.impressions;
  const reach = value.reach;
  const spend = value.spend;
  const frequency = value.frequency;
  if (typeof campaigns !== 'number' || !Number.isSafeInteger(campaigns) || campaigns < 0
    || typeof impressions !== 'number' || !Number.isFinite(impressions) || impressions < 0
    || typeof reach !== 'number' || !Number.isFinite(reach) || reach < 0
    || typeof spend !== 'number' || !Number.isFinite(spend) || spend < 0
    || (frequency !== null && (typeof frequency !== 'number' || !Number.isFinite(frequency) || frequency < 0))) return undefined;
  return { campaigns, impressions, reach, frequency, spend };
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
