import { v } from "convex/values";
import { internal } from "../_generated/api";
import {
  type ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server";
import { authenticatedAction } from "../functions";
import { graph } from "../tools";
import { isCeoEmail } from "./gate";
import { addDays, kuwaitDay } from "./time";
import { WEBINAR_CAMPAIGN_NAME } from "./webinarSql";

/**
 * Reach and frequency for Mahara's own ad account over a chosen window, one
 * figure for the lead-gen campaigns and one for the retargeting campaigns
 * (Aziz, 2026-09-21: "Frequency, two figures ... each following the chart
 * timeframe").
 *
 * Frequency is impressions over the people reached, and reach is a count of
 * distinct people, so it cannot be added up from daily snapshot rows: the
 * same person on two days is one person. The only place that can give a
 * window's frequency is the Meta insights call with that window as its
 * time range, so that is what this reads, once per window, and keeps for
 * three hours.
 *
 * Campaigns are sorted the way the B2B dashboard sorts them
 * (`b2b_campaign_type`): a name with hiring or recruit in it is left out,
 * one with hammer them, retarget or remarket in it is retargeting, the rest
 * is lead gen.
 */

/** Mahara's own ad account, the one the Ads tab reads. */
const ACCOUNT = "746108264865897";
/** A window's figure is kept this long before it is read again. */
export const FRESH_MS = 3 * 60 * 60_000;
/** The longest window one read may cover. */
export const MAX_SPAN_DAYS = 400;

export type CampaignType = "lead_gen" | "retargeting" | "excluded" | "webinar";

const WEBINAR_NAME = new RegExp(WEBINAR_CAMPAIGN_NAME, "i");

/**
 * The B2B dashboard's rule, `public.b2b_campaign_type`, kept in step by hand,
 * plus the webinar: its campaigns are the webinar funnel's, never the call
 * funnel's lead gen (webinarSql.ts, 2026-09-23).
 */
export function campaignType(name: string | null | undefined): CampaignType {
  const n = name ?? "";
  if (/(hiring|recruit)/i.test(n)) return "excluded";
  if (/(hammer them|retarget|remarket)/i.test(n)) return "retargeting";
  if (WEBINAR_NAME.test(n)) return "webinar";
  return "lead_gen";
}

const vFigure = v.object({
  /** Campaigns of this type on the account, whether or not they ran in the window. */
  campaigns: v.number(),
  impressions: v.number(),
  /** Distinct people reached in the window. */
  reach: v.number(),
  /** Impressions over reach, as Meta computes it; null when nobody was reached. */
  frequency: v.union(v.number(), v.null()),
  spend: v.number(),
});

export type FrequencyFigure = {
  campaigns: number;
  impressions: number;
  reach: number;
  frequency: number | null;
  spend: number;
};

const readFields = {
  from: v.string(),
  to: v.string(),
  computedAt: v.number(),
  leadGen: v.union(vFigure, v.null()),
  retargeting: v.union(vFigure, v.null()),
  note: v.union(v.string(), v.null()),
};
const vRead = v.object(readFields);

export type FrequencyRead = {
  from: string;
  to: string;
  computedAt: number;
  /** Null when the account has no campaign of this type. */
  leadGen: FrequencyFigure | null;
  retargeting: FrequencyFigure | null;
  note: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Only a real, past, bounded window goes into the Meta call. */
export function checkRange(from: string, to: string): void {
  if (!DAY.test(from) || !DAY.test(to))
    throw new Error("frequency: days must be YYYY-MM-DD");
  if (from > to) throw new Error("frequency: the window ends before it starts");
  const today = kuwaitDay();
  if (to > today) throw new Error("frequency: the window ends in the future");
  if (from < addDays(to, -(MAX_SPAN_DAYS - 1)))
    throw new Error(`frequency: a window covers at most ${MAX_SPAN_DAYS} days`);
}

// biome-ignore lint/suspicious/noExplicitAny: Meta replies are untyped JSON
type Any = any;

const num = (x: unknown): number => {
  const n = typeof x === "number" ? x : Number(String(x ?? "").trim());
  return Number.isFinite(n) ? n : 0;
};

/** Every campaign on the account, id and name, paged. */
async function listCampaigns(): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const r: Any = await graph(`act_${ACCOUNT}/campaigns`, {
      fields: "id,name",
      limit: 200,
      ...(after ? { after } : {}),
    });
    for (const c of r?.data ?? [])
      if (c?.id) out.push({ id: String(c.id), name: String(c.name ?? "") });
    after = r?.paging?.cursors?.after;
    if (!r?.paging?.next || !after) break;
  }
  return out;
}

/** One insights call for a set of campaigns over the window, at account level so reach is deduplicated. */
export async function readInsights(
  ids: string[],
  from: string,
  to: string,
): Promise<FrequencyFigure | null> {
  if (!ids.length) return null;
  const r: Any = await graph(`act_${ACCOUNT}/insights`, {
    fields: "impressions,reach,frequency,spend",
    level: "account",
    time_range: JSON.stringify({ since: from, until: to }),
    filtering: JSON.stringify([
      { field: "campaign.id", operator: "IN", value: ids },
    ]),
  });
  const row: Any = r?.data?.[0];
  if (!row)
    return {
      campaigns: ids.length,
      impressions: 0,
      reach: 0,
      frequency: null,
      spend: 0,
    };
  const impressions = num(row.impressions);
  const reach = num(row.reach);
  return {
    campaigns: ids.length,
    impressions,
    reach,
    frequency:
      row.frequency !== undefined && row.frequency !== null
        ? Math.round(num(row.frequency) * 100) / 100
        : reach > 0
          ? Math.round((impressions / reach) * 100) / 100
          : null,
    spend: Math.round(num(row.spend) * 100) / 100,
  };
}

/** Read Meta for the window and keep the result. Shared by the two entry points. */
async function computeRange(
  ctx: ActionCtx,
  from: string,
  to: string,
): Promise<FrequencyRead> {
  checkRange(from, to);
  const campaigns = await listCampaigns();
  const ids = (t: CampaignType) =>
    campaigns.filter(c => campaignType(c.name) === t).map(c => c.id);
  const leadGenIds = ids("lead_gen");
  const retargetingIds = ids("retargeting");
  const excluded = campaigns.length - leadGenIds.length - retargetingIds.length;
  const [leadGen, retargeting] = await Promise.all([
    readInsights(leadGenIds, from, to),
    readInsights(retargetingIds, from, to),
  ]);
  const read: FrequencyRead = {
    from,
    to,
    computedAt: Date.now(),
    leadGen,
    retargeting,
    note: `Read from Meta over ${from} to ${to}: ${leadGenIds.length} lead-gen and ${retargetingIds.length} retargeting campaigns on the account${excluded > 0 ? `, ${excluded} hiring campaigns left out` : ""}. Reach is distinct people for the whole window, so it is never a sum of days.`,
  };
  await ctx.runMutation(internal.ceo.frequency.save, read);
  return read;
}

/** Keep one row per window. */
export const save = internalMutation({
  args: readFields,
  returns: v.null(),
  handler: async (ctx, a) => {
    const row = await ctx.db
      .query("ceoFrequency")
      .withIndex("by_range", q => q.eq("from", a.from).eq("to", a.to))
      .first();
    if (row) await ctx.db.patch(row._id, a);
    else await ctx.db.insert("ceoFrequency", a);
    return null;
  },
});

/** The kept figure for a window, behind the CEO gate. */
export const cached = internalQuery({
  args: { userId: v.id("users"), from: v.string(), to: v.string() },
  returns: v.union(vRead, v.null()),
  handler: async (ctx, { userId, from, to }) => {
    const user = await ctx.db.get(userId);
    if (!isCeoEmail(user?.email))
      throw new Error("The CEO cockpit is Aziz's only.");
    const row = await ctx.db
      .query("ceoFrequency")
      .withIndex("by_range", q => q.eq("from", from).eq("to", to))
      .first();
    if (!row) return null;
    return {
      from: row.from,
      to: row.to,
      computedAt: row.computedAt,
      leadGen: row.leadGen,
      retargeting: row.retargeting,
      note: row.note,
    };
  },
});

/** From a command line or a cron: read one window now. */
export const compute = internalAction({
  args: { from: v.string(), to: v.string() },
  returns: vRead,
  handler: async (ctx, { from, to }) => computeRange(ctx, from, to),
});

/**
 * What the Marketing tab calls when the reader changes the timeframe: the
 * kept figure when it is under three hours old, otherwise a fresh read.
 */
export const forRange = authenticatedAction({
  args: { from: v.string(), to: v.string() },
  returns: vRead,
  handler: async (ctx, { from, to }): Promise<FrequencyRead> => {
    checkRange(from, to);
    const hit: FrequencyRead | null = await ctx.runQuery(
      internal.ceo.frequency.cached,
      { userId: ctx.userId, from, to },
    );
    if (hit && Date.now() - hit.computedAt < FRESH_MS) return hit;
    return computeRange(ctx, from, to);
  },
});
