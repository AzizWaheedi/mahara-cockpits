import type { SupabaseClient } from "@supabase/supabase-js";

// Range/attribution math preserved from convex/stats.ts at main 653fa6c.
// Source reads are supplied by the scoped SQL contract, never a Convex connection.
const MIN_IMPRESSIONS_FOR_RATE_CALLS = 1000;
const MIN_LINK_CLICKS_FOR_OPTIN = 50;

type Bucket = {
  key: string;
  spend: number;
  leads: number;
  impressions: number;
  linkClicks: number;
  frequency?: number;
  bookings: number;
  showed: number;
  /** False when no booking in this bucket could be tied to an ad. */
  bookingsAttributed: boolean;
  adIds: string[];
};

function empty(key: string): Bucket {
  return {
    key,
    spend: 0,
    leads: 0,
    impressions: 0,
    linkClicks: 0,
    frequency: undefined,
    bookings: 0,
    showed: 0,
    bookingsAttributed: true,
    adIds: [],
  };
}

function finish(b: Bucket) {
  const rateable = b.impressions >= MIN_IMPRESSIONS_FOR_RATE_CALLS;
  return {
    key: b.key,
    spend: b.spend,
    leads: b.leads,
    impressions: b.impressions,
    linkClicks: b.linkClicks,
    cpl: b.leads > 0 ? b.spend / b.leads : undefined,
    linkCtr: rateable ? (b.linkClicks / b.impressions) * 100 : undefined,
    cpm: rateable ? (b.spend / b.impressions) * 1000 : undefined,
    optInRate:
      b.linkClicks >= MIN_LINK_CLICKS_FOR_OPTIN
        ? (b.leads / b.linkClicks) * 100
        : undefined,
    frequency: b.frequency,
    bookings: b.bookings,
    showed: b.showed,
    // A cost per booking of "infinity" is not a number, it is a warning; we
    // return undefined and the screen says so in words.
    // A booking this week can come from an ad that last spent before this
    // window. Zero current spend is not a free booking or a $0 CPB.
    costPerBooking:
      b.bookings > 0 && b.spend > 0 ? b.spend / b.bookings : undefined,
    bookingRate: b.leads > 0 ? (b.bookings / b.leads) * 100 : undefined,
    bookingsAttributed: b.bookingsAttributed,
    adIds: b.adIds,
  };
}

// biome-ignore lint/suspicious/noExplicitAny: shared by the public and internal wrappers
async function computeRange(
  // biome-ignore lint/suspicious/noExplicitAny: query ctx
  ctx: any,
  {
    campaignName,
    start,
    end,
  }: { campaignName: string; start: string; end: string },
) {
  {
    const rows = await ctx.db
      .query("dailyStats")
      .withIndex("by_campaign_date", (q: any) =>
        q.eq("campaignName", campaignName).gte("date", start).lte("date", end),
      )
      .collect();
    const bookings = await ctx.db
      .query("bookingEvents")
      .withIndex("by_campaign_date", (q: any) =>
        q.eq("campaignName", campaignName).gte("date", start).lte("date", end),
      )
      .collect();

    const total = empty("total");
    const bySet = new Map<string, Bucket>();
    const byAd = new Map<string, Bucket>();
    // Ad id -> its ad set, so an attributed booking can be credited upward.
    const setOfAd = new Map<string, string>();
    const adNameOfId = new Map<string, string>();
    const days = new Set<string>();

    for (const r of rows) {
      days.add(r.date);
      const setName = r.adSetName ?? "unnamed ad set";
      const s = bySet.get(setName) ?? empty(setName);
      const a = byAd.get(r.adName) ?? empty(r.adName);
      for (const b of [total, s, a]) {
        b.spend += r.spend;
        b.leads += r.leads;
        b.impressions += r.impressions;
        b.linkClicks += r.linkClicks;
        if (r.frequency !== undefined) {
          b.frequency = Math.max(b.frequency ?? 0, r.frequency);
        }
      }
      if (r.metaAdId) {
        setOfAd.set(r.metaAdId, setName);
        adNameOfId.set(r.metaAdId, r.adName);
        if (!a.adIds.includes(r.metaAdId)) a.adIds.push(r.metaAdId);
        if (!s.adIds.includes(r.metaAdId)) s.adIds.push(r.metaAdId);
        if (!total.adIds.includes(r.metaAdId)) total.adIds.push(r.metaAdId);
      }
      bySet.set(setName, s);
      byAd.set(r.adName, a);
    }

    // The spend window may not contain the ad that produced a booking in it.
    // Look back at most 30 days for identities only, never add old spend to
    // this window. This keeps quiet ads and their bookings visible without
    // reporting a misleading $0 cost per booking.
    const missingIds = new Set(
      bookings
        .map((b: { adId?: string }) => b.adId)
        .filter(
          (id: string | undefined): id is string =>
            Boolean(id) && !adNameOfId.has(id as string),
        ),
    );
    if (missingIds.size) {
      const lookback = new Date(
        Date.parse(`${start}T00:00:00Z`) - 30 * 86400_000,
      )
        .toISOString()
        .slice(0, 10);
      const historical = await ctx.db
        .query("dailyStats")
        .withIndex("by_campaign_date", (q: any) =>
          q
            .eq("campaignName", campaignName)
            .gte("date", lookback)
            .lt("date", start),
        )
        .collect();
      for (const r of historical.reverse()) {
        if (!r.metaAdId || !missingIds.has(r.metaAdId)) continue;
        const setName = r.adSetName ?? "unnamed ad set";
        const s = bySet.get(setName) ?? empty(setName);
        // A quiet ad may share its display name with one that spent this
        // week. Give it a distinct row keyed by its Meta ID, or its booking
        // would be charged against the other ad's spend.
        const adKey =
          byAd.has(r.adName) && !byAd.get(r.adName)?.adIds.includes(r.metaAdId)
            ? `${r.adName} [${r.metaAdId}]`
            : r.adName;
        const a = byAd.get(adKey) ?? empty(adKey);
        setOfAd.set(r.metaAdId, setName);
        adNameOfId.set(r.metaAdId, adKey);
        if (!s.adIds.includes(r.metaAdId)) s.adIds.push(r.metaAdId);
        if (!a.adIds.includes(r.metaAdId)) a.adIds.push(r.metaAdId);
        bySet.set(setName, s);
        byAd.set(adKey, a);
        missingIds.delete(r.metaAdId);
      }
    }

    let attributed = 0;
    for (const b of bookings) {
      total.bookings += 1;
      if (b.status === "showed") total.showed += 1;
      const adName = b.adId ? adNameOfId.get(b.adId) : undefined;
      const setName = b.adId ? setOfAd.get(b.adId) : undefined;
      if (b.adId) attributed += 1;
      if (setName) {
        const s = bySet.get(setName);
        if (s) {
          s.bookings += 1;
          if (b.status === "showed") s.showed += 1;
        }
      }
      if (adName) {
        const a = byAd.get(adName);
        if (a) {
          a.bookings += 1;
          if (b.status === "showed") a.showed += 1;
        }
      }
    }
    // Ad set and ad level cost per booking is only honest when the bookings in
    // this range could actually be traced to an ad. If none could, say nothing
    // rather than print a number that is really the campaign's.
    const anyAttributed = attributed > 0;
    for (const b of [...bySet.values(), ...byAd.values()]) {
      b.bookingsAttributed = anyAttributed;
    }

    return {
      campaignName,
      start,
      end,
      days: days.size,
      hasData: rows.length > 0,
      total: finish(total),
      bookingsTotal: bookings.length,
      bookingsAttributed: attributed,
      adSets: [...bySet.values()].map(finish).sort((x, y) => y.spend - x.spend),
      ads: [...byAd.values()].map(finish).sort((x, y) => y.spend - x.spend),
    };
  }
}

export type MediaStatsData = {
  rows: Record<string, any>[];
  bookings: Record<string, any>[];
  historical: Record<string, any>[];
};

/**
 * How a range's bookings meet the media data's last day (2026-10-21, and
 * 2026-10-22 for a range wholly after it):
 * - the range ends on or before that day: nothing changes;
 * - the day falls inside the range: bookings are counted only through it
 *   (`through`), so they meet the spend they came from;
 * - the whole range comes after it (Today, or Yesterday before the nightly
 *   pull): there is no spend to pair with at all, so the bookings are kept
 *   as they are, a real count, and `spendNotIn` names the day so the cost
 *   reads "n/a" with the reason. Never 0 bookings, never "None yet".
 */
export function bookingsCap(
  range: { start: string; end: string },
  last: string | null | undefined,
): { through?: string; spendNotIn?: string } {
  if (!last || last >= range.end) return {};
  return last < range.start ? { spendNotIn: last } : { through: last };
}

/**
 * Every booking in a range read was credited to one of the ads it lists, so
 * an ad with none really has none and may be coloured on its spend. Carrying
 * an ad id is not enough: an id that maps to no row (its ad spent more than
 * 30 days before the range) leaves the booking unplaced, and it may be any
 * ad's (2026-10-22).
 */
export function everyBookingPlaced(
  read: { bookingsTotal?: number; ads?: { bookings?: number }[] } | undefined,
): boolean {
  const total = Number(read?.bookingsTotal ?? 0);
  if (!read || total <= 0) return false;
  const placed = (read.ads ?? []).reduce(
    (n, r) => n + Number(r.bookings ?? 0),
    0,
  );
  return placed === total;
}

export async function computeMediaRange(
  data: MediaStatsData,
  args: {
    campaignName: string;
    start: string;
    end: string;
    /**
     * The last day the media data has spend for (mediaDataThrough): no
     * booking after it is counted, so a range ending today never sets
     * today's bookings against spend that stops yesterday.
     */
    bookingsThrough?: string | null;
  },
) {
  const { bookingsThrough, ...range } = args;
  const { through, spendNotIn } = bookingsCap(range, bookingsThrough);
  const bookings = through
    ? data.bookings.filter(b => String(b.date ?? "") <= through)
    : data.bookings;
  const context = {
    db: {
      query(table: string) {
        let rows =
          table === "dailyStats"
            ? [...data.historical, ...data.rows]
            : [...bookings];
        const conditions: ((r: Record<string, any>) => boolean)[] = [];
        const builder = {
          eq: (key: string, v: unknown) => {
            conditions.push(r => r[key] === v);
            return builder;
          },
          gte: (key: string, v: string) => {
            conditions.push(r => r[key] >= v);
            return builder;
          },
          lte: (key: string, v: string) => {
            conditions.push(r => r[key] <= v);
            return builder;
          },
          lt: (key: string, v: string) => {
            conditions.push(r => r[key] < v);
            return builder;
          },
        };
        return {
          withIndex(_index: string, filter: (q: typeof builder) => unknown) {
            filter(builder);
            rows = rows.filter(r => conditions.every(f => f(r)));
            return { collect: async () => rows };
          },
        };
      },
    },
  };
  const result = await computeRange(context, range);
  return {
    ...result,
    /** The last day whose bookings are counted, inside the range. */
    bookingsThrough: through,
    /**
     * The media data's last day, when the whole range comes after it: the
     * bookings are counted, their spend is not in yet.
     */
    spendNotIn,
  };
}

async function statistics(
  client: SupabaseClient,
  kind: string,
  args: Record<string, any> = {},
) {
  const { data, error } = await client.rpc("cockpit_media_statistics", {
    p_kind: kind,
    p_campaign: args.campaignName ?? null,
    p_start: args.start ?? null,
    p_end: args.end ?? null,
  });
  if (error) throw error;
  if (data === null || data === undefined)
    throw new Error("Statistics source did not return a result.");
  return data;
}

/** How long one coverage read serves every range read that asks for it. */
const COVERAGE_FRESH_MS = 60_000;
let coverageRead:
  | { client: SupabaseClient; at: number; value: Promise<any> }
  | undefined;

/**
 * The media data's first and last day across every campaign this seat reads
 * (kind "coverage"), read once and shared: the board's rows, an open panel,
 * a client's page, the funnel and the page's own note all land within a few
 * seconds of each other and get the same answer. A failed read is not kept.
 */
export function mediaCoverage(
  client: SupabaseClient,
  now = Date.now(),
): Promise<{ first?: string | null; last?: string | null }> {
  const held = coverageRead;
  if (held && held.client === client && now - held.at < COVERAGE_FRESH_MS)
    return held.value;
  const entry = { client, at: now, value: statistics(client, "coverage") };
  coverageRead = entry;
  entry.value.catch(() => {
    if (coverageRead === entry) coverageRead = undefined;
  });
  return entry.value;
}

/**
 * The last day the media data has spend for: Meta's numbers run to
 * yesterday, while a booking lands the moment it is made. A range ending
 * today (Today, Month to date, Year to date, a custom range) counted today's
 * bookings against spend that stops yesterday: City Wood's month to date
 * read $674.63 / 7 = $96.38 on 21 Oct, against $224.88 for its 3 bookings
 * to 20 Oct. So a range read that runs past this day counts bookings only
 * through it (bookingsCap); a range wholly after it keeps its bookings and
 * says its spend is not in yet. One day for the whole read, never each
 * campaign's own last day: Atlantis
 * 7\10 stopped spending on 17 Oct and still bought the bookings made on
 * 18-20 Oct (2026-10-21). Spend windows stay as picked: this month still
 * runs through today. Null when there is no media data at all.
 */
export async function mediaDataThrough(
  client: SupabaseClient,
): Promise<string | null> {
  const last = (await mediaCoverage(client))?.last;
  return typeof last === "string" && /^\d{4}-\d{2}-\d{2}$/.test(last)
    ? last
    : null;
}

export async function readMediaStats(
  client: SupabaseClient,
  kind: string,
  args: Record<string, any> = {},
) {
  if (kind === "coverage") return mediaCoverage(client);
  if (kind !== "range") return statistics(client, kind, args);
  const [data, bookingsThrough] = await Promise.all([
    statistics(client, kind, args),
    mediaDataThrough(client),
  ]);
  if (
    !Array.isArray(data.rows) ||
    !Array.isArray(data.bookings) ||
    !Array.isArray(data.historical)
  )
    throw new Error("Statistics source returned an invalid result.");
  return computeMediaRange(data, {
    campaignName: args.campaignName,
    start: args.start,
    end: args.end,
    bookingsThrough,
  });
}
